import { expect } from "chai";
import hre from "hardhat";
import { ACTION } from "../helpers/actions.js";
import { domainSeparator, actionDigest } from "../helpers/hashes.js";
import { buildActions, signActions, wallet1, wallet2, wallet3, startGameWithDeck } from "../helpers/test-utils.js";

const { ethers } = hre;

describe("HeadsUpPokerEscrow Fold Settlement", function () {
    let escrow;
    let player1, player2;
    let chainId;
    let actionVerifier;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
        actionVerifier = await ethers.getContractAt(
            "HeadsUpPokerActionVerifier",
            await escrow.getActionVerifierAddress()
        );
    });

    describe("Fold Settlement", function () {
        const channelId = 3n;
        const handId = 1n; // Use the handId from the channel
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await startGameWithDeck(escrow, channelId, player1, player2);
        });

        it("should allow fold settlement for player1 as winner", async function () {
            // Create scenario where player2 (big blind) folds, making player1 the winner
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.BET_RAISE, amount: 3n, sender: player1.address }, // Small blind raises,
                { action: ACTION.FOLD, amount: 0n, sender: player2.address } // Big blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1+3, 2) = min(4, 2) = 2
            const calledAmount = 2n;

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player1.address, calledAmount);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + calledAmount);
            expect(p2Stack).to.equal(deposit - calledAmount);
        });

        it("should allow fold settlement for player2 as winner", async function () {
            // Create scenario where player1 (small blind) folds, making player2 the winner
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address } // Small blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1, 2) = 1
            const calledAmount = 1n;

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player2.address, calledAmount);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit - calledAmount);
            expect(p2Stack).to.equal(deposit + calledAmount);
        });

        it("should reject fold settlement with invalid signatures", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Sign with wrong players
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            const domain = domainSeparator(await escrow.getAddress(), chainId);
            const digest = actionDigest(domain, actions[0]);
            const sig = wallet3.signingKey.sign(digest).serialized;
            const badSignatures = [sig, signatures[1], signatures[2]];

            await expect(escrow.settle(channelId, actions, badSignatures))
                .to.be.revertedWithCustomError(actionVerifier, "ActionWrongSigner");
        });

        it("should reject settlement with wrong channel ID in actions", async function () {
            const wrongChannelId = 999n;
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], wrongChannelId, handId); // Wrong channel ID

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(actionVerifier, "ActionWrongChannel");
        });

        it("should reject settlement with wrong hand ID in actions", async function () {
            const wrongHandId = 999n;
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, wrongHandId); // Wrong hand ID

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(actionVerifier, "ActionWrongHand");
        });

        it("should reject settlement with empty actions array", async function () {
            const actions = [];
            const signatures = [];

            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "NoActionsProvided");
        });

        it("should reject settlement with mismatched signature count", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Provide wrong number of signatures (only 2 instead of 3)
            const badSignatures = signatures.slice(0, 2);

            await expect(escrow.settle(channelId, actions, badSignatures))
                .to.be.revertedWithCustomError(actionVerifier, "ActionSignatureLengthMismatch");
        });

        it("should reject duplicate settlement", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.BET_RAISE, amount: 3n, sender: player1.address }, // Small blind raises,
                { action: ACTION.FOLD, amount: 0n, sender: player2.address } // Big blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1+3, 2) = min(4, 2) = 2
            const calledAmount = 2n;

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player1.address, calledAmount);
            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "AlreadyFinalized");
        });

        it("should revert settle when game not started", async function () {
            const handId = 1n;
            const newChannelId = 42n;
            await escrow.connect(player1).open(newChannelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(newChannelId, ethers.ZeroAddress, "0x", { value: deposit });

            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], newChannelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.settle(newChannelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "GameNotStarted");
        });

        it("should initiate showdown when settle resolves to showdown", async function () {
            const handId = await escrow.getHandId(channelId);

            // Create actions that lead to showdown (both players check down)
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (flop)
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn)
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address },  // BB checks (river),
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // This should not revert but should initiate showdown
            const tx = await escrow.connect(player1).settle(channelId, actions, signatures);

            // Verify ShowdownStarted event was emitted
            await expect(tx).to.emit(escrow, "ShowdownStarted").withArgs(channelId);

            // Verify showdown state was set up
            const showdownState = await escrow.getShowdown(channelId);
            expect(showdownState.inProgress).to.be.true;

            // Channel should not be finalized yet - requires card reveals
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(deposit);
        });

        it("should prevent duplicate settle calls after showdown initiated", async function () {
            const handId = await escrow.getHandId(channelId);

            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls,
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (first to act postflop),
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn),
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (river),
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // First settle should work
            await escrow.connect(player1).settle(channelId, actions, signatures);

            // Second settle should revert due to showdown in progress
            await expect(escrow.connect(player2).settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ShowdownInProgress");
        });
    });
});
