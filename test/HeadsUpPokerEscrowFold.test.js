const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./actions");
const { actionHash, actionDigest, handGenesis, domainSeparator } = require("./hashes");

// Helper to build actions with proper hashes and sequence numbers
function buildActions(specs, channelId = 1n, handId = 1n) {
    let seq = 0;
    let prevHash = handGenesis(channelId, handId);
    const actions = [];
    for (const spec of specs) {
        const act = {
            channelId,
            handId,
            seq: seq++,
            action: spec.action,
            amount: spec.amount,
            prevHash
        };
        actions.push(act);
        prevHash = actionHash(act);
    }
    return actions;
}

// Helper to sign actions
async function signActions(actions, signers, contractAddress, chainId) {
    const signatures = [];
    const domain = domainSeparator(contractAddress, chainId);
    
    for (const action of actions) {
        const digest = actionDigest(domain, action);
        const sig1 = await signers[0].signMessage(ethers.getBytes(digest));
        const sig2 = await signers[1].signMessage(ethers.getBytes(digest));
        signatures.push(sig1, sig2);
    }
    return signatures;
}

describe("HeadsUpPokerEscrow - Secure Fold Settlement", function () {
    let escrow;
    let player1, player2, other;
    let chainId;

    beforeEach(async function () {
        [player1, player2, other] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("Secure Fold Settlement", function () {
        const channelId = 1n;
        const handId = 1n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should settle fold with valid co-signed action transcript", async function () {
            // Create a valid fold scenario: blinds + small blind folds
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n } // Small blind folds
            ], channelId, handId);

            // Sign all actions with both players
            const signatures = await signActions(actions, [player1, player2], await escrow.getAddress(), chainId);

            // Should succeed and declare player2 (big blind) as winner
            const tx = await escrow.settleFold(channelId, handId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "FoldSettled")
                .withArgs(channelId, player2.address, deposit * 2n);

            // Verify pot goes to player2 (the non-folder)
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(deposit * 2n);
        });

        it("should reject settlement with invalid signatures", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, handId);

            // Sign with wrong players (other instead of player2)
            const signatures = await signActions(actions, [player1, other], await escrow.getAddress(), chainId);

            await expect(escrow.settleFold(channelId, handId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongSignerB");
        });

        it("should reject settlement when actions don't end in fold", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // Call instead of fold
                { action: ACTION.CHECK_CALL, amount: 0n }  // Check -> goes to showdown
            ], channelId, handId);

            const signatures = await signActions(actions, [player1, player2], await escrow.getAddress(), chainId);

            await expect(escrow.settleFold(channelId, handId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ReplayDidNotEndInFold");
        });

        it("should reject settlement with wrong channel ID in actions", async function () {
            const wrongChannelId = 999n;
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], wrongChannelId, handId); // Wrong channel ID

            const signatures = await signActions(actions, [player1, player2], await escrow.getAddress(), chainId);

            await expect(escrow.settleFold(channelId, handId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongChannel");
        });

        it("should reject settlement with wrong hand ID in actions", async function () {
            const wrongHandId = 999n;
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, wrongHandId); // Wrong hand ID

            const signatures = await signActions(actions, [player1, player2], await escrow.getAddress(), chainId);

            await expect(escrow.settleFold(channelId, wrongHandId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongHand");
        });

        it("should reject settlement with empty actions array", async function () {
            const actions = [];
            const signatures = [];

            await expect(escrow.settleFold(channelId, handId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "NoActionsProvided");
        });

        it("should reject settlement with mismatched signature count", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, handId);

            // Provide wrong number of signatures (only 3 instead of 6)
            const signatures = ["0x00", "0x00", "0x00"];

            await expect(escrow.settleFold(channelId, handId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ActionSignatureLengthMismatch");
        });

        it("should handle big blind fold scenario correctly", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // Small blind raises
                { action: ACTION.FOLD, amount: 0n } // Big blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [player1, player2], await escrow.getAddress(), chainId);

            const tx = await escrow.settleFold(channelId, handId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "FoldSettled")
                .withArgs(channelId, player1.address, deposit * 2n); // Player1 wins

            // Verify pot goes to player1 (the non-folder)
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);
        });
    });
});