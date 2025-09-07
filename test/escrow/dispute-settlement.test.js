const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { buildActions, signActions, wallet1, wallet2 } = require("../helpers/test-utils");

describe("HeadsUpPokerEscrow - Dispute Settlement", function () {
    let escrow;
    let player1, player2;
    let chainId;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("Settle Function", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should settle terminal fold sequences", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n } // Small blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled");

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            // Player 2 should win since player 1 folded
            expect(p1Stack).to.be.lessThan(deposit);
            expect(p2Stack).to.be.greaterThan(deposit);
        });

        it("should initiate showdown for showdown sequences", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n }, // SB
                { action: ACTION.BIG_BLIND, amount: 2n }, // BB
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks -> move to street 2
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks -> move to street 3
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }  // SB checks -> showdown
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.settle(channelId, actions, signatures)).to.emit(escrow, "ShowdownStarted").withArgs(channelId);
        });
    });

    describe("Dispute Function", function () {
        const channelId = 2n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should start dispute with non-terminal sequence", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n } // Raise - not terminal
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            const tx = await escrow.dispute(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "DisputeStarted")
                .withArgs(channelId, player1.address, 3);

            const dispute = await escrow.getDispute(channelId);
            expect(dispute.inProgress).to.be.true;
            expect(dispute.actionCount).to.equal(3);
        });

        it("should extend dispute with longer sequence", async function () {
            const handId = await escrow.getHandId(channelId);

            // First dispute with 3 actions
            const actions1 = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }
            ], channelId, handId);
            const signatures1 = await signActions(actions1, [wallet1, wallet2], await escrow.getAddress(), chainId);
            await escrow.dispute(channelId, actions1, signatures1);

            // Extend dispute with 4 actions
            const actions2 = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n },
                { action: ACTION.CHECK_CALL, amount: 0n } // Call the raise
            ], channelId, handId);
            const signatures2 = await signActions(actions2, [wallet1, wallet2], await escrow.getAddress(), chainId);

            const tx = await escrow.dispute(channelId, actions2, signatures2);
            await expect(tx)
                .to.emit(escrow, "DisputeExtended")
                .withArgs(channelId, player1.address, 4);

            const dispute = await escrow.getDispute(channelId);
            expect(dispute.actionCount).to.equal(4);
        });

        it("should reject shorter sequences when extending dispute", async function () {
            const handId = await escrow.getHandId(channelId);

            // First dispute with 3 actions
            const actions1 = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }
            ], channelId, handId);
            const signatures1 = await signActions(actions1, [wallet1, wallet2], await escrow.getAddress(), chainId);
            await escrow.dispute(channelId, actions1, signatures1);

            // Try to "extend" with only 2 actions - should fail
            const actions2 = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ], channelId, handId);
            const signatures2 = await signActions(actions2, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.dispute(channelId, actions2, signatures2))
                .to.be.revertedWithCustomError(escrow, "SequenceNotLonger");
        });

        it("should allow settle during dispute", async function () {
            const handId = await escrow.getHandId(channelId);

            // Start dispute first
            const disputeActions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ], channelId, handId);
            const disputeSignatures = await signActions(disputeActions, [wallet1, wallet2], await escrow.getAddress(), chainId);
            await escrow.dispute(channelId, disputeActions, disputeSignatures);

            // Try to settle - should pass
            const settleActions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, handId);
            const settleSignatures = await signActions(settleActions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.settle(channelId, settleActions, settleSignatures))
                .to.emit(escrow, "Settled");
        });

        it("should return correct dispute window", async function () {
            const window = await escrow.getDisputeWindow();
            expect(window).to.equal(3600); // 1 hour in seconds
        });

        it("should allow dispute with empty actions array (no blinds)", async function () {
            const handId = await escrow.getHandId(channelId);
            
            // Dispute with empty actions array - should be allowed
            await expect(escrow.dispute(channelId, [], []))
                .to.emit(escrow, "DisputeStarted");
        });

        it("should allow dispute with single action (missing big blind)", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n }
            ], channelId, handId);
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
            
            await expect(escrow.dispute(channelId, actions, signatures))
                .to.emit(escrow, "DisputeStarted");
        });

        it("should finalize dispute without blinds with no fund transfer", async function () {
            const handId = await escrow.getHandId(channelId);
            
            // Get initial balances
            const [initialP1, initialP2] = await escrow.stacks(channelId);
            
            // Start dispute with no actions
            await escrow.dispute(channelId, [], []);
            
            // Fast forward past dispute window
            await ethers.provider.send("evm_increaseTime", [3601]); // 1 hour + 1 second
            await ethers.provider.send("evm_mine");
            
            // Finalize dispute - should emit with address(0) as winner and 0 transfer amount
            await expect(escrow.finalizeDispute(channelId))
                .to.emit(escrow, "DisputeFinalized")
                .withArgs(channelId, ethers.ZeroAddress, 0);
            
            // Check that balances remain unchanged
            const [finalP1, finalP2] = await escrow.stacks(channelId);
            expect(finalP1).to.equal(initialP1);
            expect(finalP2).to.equal(initialP2);
            
            // Channel should be finalized
            const channel = await escrow.channels(channelId);
            expect(channel.finalized).to.be.true;
        });
    });

    describe("Finalize Dispute", function () {
        const channelId = 3n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should finalize dispute after window expires", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n } // Fold sequence
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
            await escrow.dispute(channelId, actions, signatures);

            // Fast forward past dispute window
            await ethers.provider.send("evm_increaseTime", [3601]); // 1 hour + 1 second
            await ethers.provider.send("evm_mine");

            const tx = await escrow.finalizeDispute(channelId);
            await expect(tx)
                .to.emit(escrow, "DisputeFinalized");

            // Check that channel is finalized
            const dispute = await escrow.getDispute(channelId);
            expect(dispute.inProgress).to.be.false;
        });

        it("should reject finalization before window expires", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
            await escrow.dispute(channelId, actions, signatures);

            await expect(escrow.finalizeDispute(channelId))
                .to.be.revertedWithCustomError(escrow, "DisputeStillActive");
        });
    });
});
