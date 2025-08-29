const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./actions");
const { actionHash, handGenesis } = require("./hashes");

// Helper to build actions with proper hashes and sequence numbers for a specific handId
function buildActionsWithHandId(specs, handId = 1n) {
    const channelId = 1n;
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

describe("HeadsUpPokerReplay - Alternating Small Blind", function () {
    let replay;

    beforeEach(async function () {
        const Replay = await ethers.getContractFactory("HeadsUpPokerReplay");
        replay = await Replay.deploy();
    });

    describe("Small Blind Alternation", function () {
        it("should have Player 0 as small blind for odd handId (handId=1)", async function () {
            // For handId=1 (odd), Player 0 should be small blind
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n } // Small blind folds
            ], 1n);

            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // Player 0 (small blind) folded
            expect(potSize).to.equal(3n); // SB: 1 + BB: 2
        });

        it("should have Player 1 as small blind for even handId (handId=2)", async function () {
            // For handId=2 (even), Player 1 should be small blind
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n } // Small blind folds
            ], 2n);

            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // Player 1 (small blind) folded
            expect(potSize).to.equal(3n); // SB: 1 + BB: 2
        });

        it("should have Player 0 as small blind for odd handId (handId=3)", async function () {
            // For handId=3 (odd), Player 0 should be small blind
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n } // Small blind folds
            ], 3n);

            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // Player 0 (small blind) folded
            expect(potSize).to.equal(3n); // SB: 1 + BB: 2
        });

        it("should have Player 1 as small blind for even handId (handId=4)", async function () {
            // For handId=4 (even), Player 1 should be small blind
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n } // Small blind folds
            ], 4n);

            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // Player 1 (small blind) folded
            expect(potSize).to.equal(3n); // SB: 1 + BB: 2
        });

        it("should correctly handle stack deductions for alternating small blind", async function () {
            // Test that stacks are correctly deducted based on who posts which blind
            // For handId=2 (even), Player 1 posts SB, Player 0 posts BB
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n }
                // Both all-in scenario to test stack deductions
            ], 2n);

            // Player 0 has 10 chips, Player 1 has 5 chips
            // Player 1 posts SB (5), Player 0 posts BB (10) - should go all-in
            const [end, , potSize] = await replay.replayAndGetEndState(actions, 10n, 5n);
            expect(end).to.equal(1n); // End.SHOWDOWN (both all-in)
            expect(potSize).to.equal(15n); // Total pot: 5 + 10 = 15
        });
    });

    describe("Stack Validation with Alternating Small Blind", function () {
        it("should validate small blind amount against correct player's stack for odd handId", async function () {
            // For handId=1 (odd), Player 0 is small blind - should validate against stackA
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 15n }, // More than stackA (10)
                { action: ACTION.BIG_BLIND, amount: 30n }
            ], 1n);

            await expect(replay.replayAndGetEndState(actions, 10n, 50n))
                .to.be.revertedWithCustomError(replay, "SmallBlindAmountInvalid");
        });

        it("should validate small blind amount against correct player's stack for even handId", async function () {
            // For handId=2 (even), Player 1 is small blind - should validate against stackB
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 15n }, // More than stackB (10)
                { action: ACTION.BIG_BLIND, amount: 30n }
            ], 2n);

            await expect(replay.replayAndGetEndState(actions, 50n, 10n))
                .to.be.revertedWithCustomError(replay, "SmallBlindAmountInvalid");
        });

        it("should validate big blind amount against correct player's stack for odd handId", async function () {
            // For handId=1 (odd), Player 0 is SB, Player 1 is BB - should validate BB against stackB
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n } // Exactly stackB
            ], 1n);

            // Should not revert - BB amount equals stackB
            const [end, , potSize] = await replay.replayAndGetEndState(actions, 50n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN (BB all-in)
            expect(potSize).to.equal(15n);
        });

        it("should validate big blind amount against correct player's stack for even handId", async function () {
            // For handId=2 (even), Player 1 is SB, Player 0 is BB - should validate BB against stackA
            const actions = buildActionsWithHandId([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n } // Exactly stackA
            ], 2n);

            // Should not revert - BB amount equals stackA
            const [end, , potSize] = await replay.replayAndGetEndState(actions, 10n, 50n);
            expect(end).to.equal(1n); // End.SHOWDOWN (BB all-in)
            expect(potSize).to.equal(15n);
        });
    });
});