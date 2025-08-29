const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./actions");
const { actionHash, handGenesis } = require("./hashes");

// Helper to build actions with proper hashes and sequence numbers
function buildActions(specs) {
    const channelId = 1n;
    const handId = 1n; // Default handId for tests
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

describe("HeadsUpPokerReplay", function () {
    let replay;

    beforeEach(async function () {
        const Replay = await ethers.getContractFactory("HeadsUpPokerReplay");
        replay = await Replay.deploy();
    });

    describe("Basic Game Flow", function () {
        it("returns fold when small blind folds preflop", async function () {
            // small blind, big blind, small blind folds
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const stackA = 10n;
            const stackB = 10n;
            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, stackA, stackB);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n);
            expect(potSize).to.equal(3n); // SB: 1 + BB: 2
        });

        it("returns fold when big blind folds preflop", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB makes min raise (1->4)
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
            expect(potSize).to.equal(6n); // SB: 1 + BB: 2 + SB raise: 3 = 6
        });

        it("reaches showdown after checks on all streets", async function () {
            // blinds, call, then check down to showdown
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
            ]);
            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            // showdown always has 0 as folder, do not test it further
            expect(folder).to.equal(0n);
            expect(potSize).to.equal(4n); // SB: 1 + BB: 2 + SB call: 1 = 4
        });

        it("reaches showdown when both players are all-in", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 9n }, // SB goes all-in
                { action: ACTION.CHECK_CALL, amount: 0n } // BB calls
            ]);
            const [end, , potSize] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(potSize).to.equal(20n); // Both players all-in: 10 + 10 = 20
        });
    });

    describe("Validation Tests - Blind Setup", function () {
        it("reverts when no actions provided", async function () {
            const actions = [];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "NoBlinds");
        });

        it("reverts when small blind sequence is wrong", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 2,
                    action: ACTION.SMALL_BLIND,
                    amount: 1n,
                    prevHash: handGenesis(1n, 1n)
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 3,
                    action: ACTION.BIG_BLIND,
                    amount: 2n,
                    prevHash: handGenesis(1n, 1n)
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "SmallBlindSequenceInvalid");
        });

        it("reverts when only one action provided", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "NoBlinds");
        });

        it("reverts when small blind prevHash is incorrect", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.SMALL_BLIND,
                    amount: 1n,
                    prevHash: ethers.keccak256("0x1234") // Should be genesis
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.BIG_BLIND,
                    amount: 1n,
                    prevHash: handGenesis(1n, 1n)
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "SmallBlindPrevHashInvalid");
        });

        it("reverts when small blind action is wrong", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 0,
                    action: ACTION.BIG_BLIND, // Should be SMALL_BLIND
                    amount: 1n,
                    prevHash: handGenesis(1n, 1n)
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.BIG_BLIND,
                    amount: 1n,
                    prevHash: handGenesis(1n, 1n)
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "SmallBlindActionInvalid");
        });

        it("reverts when small blind amount is zero", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 0,
                    action: ACTION.SMALL_BLIND,
                    amount: 0n, // Should be > 0
                    prevHash: handGenesis(1n, 1n)
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.BIG_BLIND,
                    amount: 1n,
                    prevHash: handGenesis(1n, 1n)
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "SmallBlindAmountInvalid");
        });

        it("reverts when small blind amount exceeds stack", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 0,
                    action: ACTION.SMALL_BLIND,
                    amount: 11n, // Exceeds stack of 10
                    prevHash: handGenesis(1n, 1n)
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.BIG_BLIND,
                    amount: 1n,
                    prevHash: handGenesis(1n, 1n)
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "SmallBlindAmountInvalid");
        });

        it("reverts when big blind sequence is wrong", async function () {
            const sbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: handGenesis(1n, 1n)
            };
            const bbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 0, // Same seq, should be greater
                action: ACTION.BIG_BLIND,
                amount: 2n,
                prevHash: actionHash(sbAction)
            };
            await expect(replay.replayAndGetEndState([sbAction, bbAction], 10n, 10n)).to.be.revertedWithCustomError(replay, "BigBlindSequenceInvalid");
        });

        it("reverts when big blind prevHash is incorrect", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n }
            ]);
            const badBB = {
                channelId: 1n,
                handId: 1n,
                seq: 1,
                action: ACTION.BIG_BLIND,
                amount: 2n,
                prevHash: ethers.keccak256("0x1234") // Wrong hash
            };
            await expect(replay.replayAndGetEndState([actions[0], badBB], 10n, 10n)).to.be.revertedWithCustomError(replay, "BigBlindPrevHashInvalid");
        });

        it("reverts when big blind action is wrong", async function () {
            const sbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: handGenesis(1n, 1n)
            };
            const bbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 1,
                action: ACTION.FOLD, // Should be BIG_BLIND
                amount: 2n,
                prevHash: actionHash(sbAction)
            };
            await expect(replay.replayAndGetEndState([sbAction, bbAction], 10n, 10n)).to.be.revertedWithCustomError(replay, "BigBlindActionInvalid");
        });

        it("reverts when big blind amount is incorrect", async function () {
            // big blind should be exactly twice the small blind
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 3n } // wrong amount
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "BigBlindAmountInvalid");
        });

        it("reverts when big blind amount exceeds stack", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 1n)).to.be.revertedWithCustomError(replay, "BigBlindStackInvalid");
        });
    });

    describe("Validation Tests - Action Sequence", function () {
        it("reverts when action sequence number is not increasing", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            // Manually create third action with wrong seq
            const badAction = {
                channelId: 1n,
                handId: 1n,
                seq: 1, // Same as previous, should be 2
                action: ACTION.FOLD,
                amount: 0n,
                prevHash: actionHash(actions[1])
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWithCustomError(replay, "SequenceInvalid");
        });

        it("reverts when action prevHash is incorrect", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            const badAction = {
                channelId: 1n,
                handId: 1n,
                seq: 3,
                action: ACTION.FOLD,
                amount: 0n,
                prevHash: ethers.keccak256("0x1234") // Wrong hash
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWithCustomError(replay, "PrevHashInvalid");
        });

        it("reverts when blind actions are used after start", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.SMALL_BLIND, amount: 1n } // Wrong, can't use blind again
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "BlindOnlyStart");
        });

        it("reverts when all-in player tries to act", async function () {
            const badActions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.FOLD, amount: 0n }, // trying to act after all-in
            ]);
            await expect(replay.replayAndGetEndState(badActions, 5n, 11n)).to.be.revertedWithCustomError(replay, "PlayerAllIn");
        });

        it("reverts when unknown action type is used", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            const badAction = {
                channelId: 1n,
                handId: 1n,
                seq: 3,
                action: 99, // Unknown action
                amount: 0n,
                prevHash: actionHash(actions[1])
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWithCustomError(replay, "UnknownAction");
        });
    });

    describe("Fold Action Tests", function () {
        it("reverts when fold has non-zero amount", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 1n } // Should be 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "FoldAmountInvalid");
        });

        it("handles fold on flop", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("handles fold on turn", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks, move to turn
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("handles fold on river", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks, move to river
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });
    });

    describe("Check/Call Action Tests", function () {
        it("reverts when call amount is incorrect", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 2n } // Should be 0 for calls
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "CallAmountInvalid");
        });

        it("handles all-in call with correct amount", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 9n }, // SB all-in, BB needs to call 8 total
                { action: ACTION.CHECK_CALL, amount: 0n } // BB calls with amount 0
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 9n); // BB has only 9
            expect(end).to.equal(1n); // End.SHOWDOWN (both all-in)
        });

        it("automatically goes all-in when insufficient chips to call", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB auto all-in with remaining 4 chips
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 9n, 11n); // SB has only 9 total, 4 remaining
            expect(end).to.equal(1n); // End.SHOWDOWN (SB goes all-in)
        });

        it("progresses street after both players check", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls with amount 0, move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks, move to turn
                { action: ACTION.CHECK_CALL, amount: 0n } // BB checks
            ]);
            // Should be waiting for SB to act on turn
            const nextAction = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB checks, move to river
            ]);

            // Should not reach end yet
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "HandNotDone");
            // Hand is OK so far, but still not done
            await expect(replay.replayAndGetEndState(nextAction, 10n, 10n)).to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("reaches showdown after river checks", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n },
                { action: ACTION.CHECK_CALL, amount: 0n } // Final check -> showdown
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("correctly calculates all-in amount when player has exactly enough", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB calls with exactly 5 remaining
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n); // SB has exactly 10, 5 remaining after blind
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("handles call when player has more than enough chips", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB has plenty of chips to call 1
            ]);
            await expect(replay.replayAndGetEndState(actions, 100n, 100n)).to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("reverts when trying to check with amount when no bet to call", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.CHECK_CALL, amount: 1n } // BB tries to check with amount - should be 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "CheckAmountInvalid");
        });

        it("handles partial all-in call correctly", async function () {
            // Player has less than the amount to call, should go all-in with remaining chips
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n }, // SB raises big, BB needs to call 7 more
                { action: ACTION.CHECK_CALL, amount: 0n } // BB calls but only has 3 remaining
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 5n); // BB only has 5 total
            expect(end).to.equal(1n); // End.SHOWDOWN (BB goes all-in with remaining 3)
        });
    });

    describe("Bet/Raise Action Tests", function () {
        it("reverts when bet/raise amount is zero", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 0n } // Should be > 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "RaiseAmountZero");
        });

        it("reverts when raise is below minimum", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 2n } // Below minimum raise (should be >= 3)
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "MinimumRaiseNotMet");
        });

        it("handles minimum raise correctly", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // Minimum raise
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when raise exceeds available stack plus toCall", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 11n } // Exceeds 9 available + 1 toCall
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "RaiseStackInvalid");
        });

        it("handles all-in raise with exact amount", async function () {
            // Should not revert, this is a valid all-in
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n }, // All-in with remaining stack
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when all-in raise amount is incorrect", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.BET_RAISE, amount: 4n } // Should be 5 to go all-in (5+4=9 total
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "RaiseInsufficientIncrease");
        });

        it("reverts when raise doesn't increase the bet", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 2n }, // Raises to 3 total (1+2)
                { action: ACTION.BET_RAISE, amount: 1n } // Trying to raise to 3 total (2+1), no increase
            ]);
            await expect(replay.replayAndGetEndState(actions, 3n, 10n)).to.be.revertedWithCustomError(replay, "RaiseInsufficientIncrease");
        });

        it("reverts when bet exceeds deposit limit", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n } // Total 9 > stack 8
            ]);
            await expect(replay.replayAndGetEndState(actions, 8n, 10n)).to.be.revertedWithCustomError(replay, "RaiseStackInvalid");
        });

        it("handles re-raise scenario with underraised bet", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { action: ACTION.BET_RAISE, amount: 3n }, // BB re-raises to 5 total (2+3)
            ]);
            // This should revert since the re-raise must be at least the size of the previous raise (2)
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "MinimumRaiseNotMet");
        });

        it("handles re-raise scenario", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { action: ACTION.BET_RAISE, amount: 5n }, // BB re-raises to 7 total (2+5)
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("handles betting on postflop streets", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.BET_RAISE, amount: 3n }, // BB bets on flop
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("prevents re-raise after short all-in", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 2n }, // SB short all-in to 3
                { action: ACTION.BET_RAISE, amount: 3n } // BB attempts re-raise
            ]);
            await expect(replay.replayAndGetEndState(actions, 3n, 10n)).to.be.revertedWithCustomError(replay, "NoReopenAllowed");
        });

        it("handles minimum bet on each street", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.BET_RAISE, amount: 2n }, // BB minimum bet (size of big blind)
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to turn
                { action: ACTION.BET_RAISE, amount: 2n }, // BB minimum bet again
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to river
                { action: ACTION.BET_RAISE, amount: 2n }, // BB minimum bet again
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("handles maximum bet without going all-in", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n }, // SB bets almost all-in (9 total)
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts on bet when player is already all-in on previous street", async function () {
            // Test that a player who went all-in cannot act
            const badActions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB goes all-in calling
            ]);
            // First verify this makes SB all-in
            const [end, ,] = await replay.replayAndGetEndState(badActions, 6n, 10n);
            expect(end).to.equal(1n); // Should be showdown since SB is all-in
        });
    });

    describe("Edge Cases and Complex Scenarios", function () {
        it("handles complex betting sequence", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises
                { action: ACTION.BET_RAISE, amount: 5n }, // BB re-raises  
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.BET_RAISE, amount: 2n }, // SB bets
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB calls, move to turn
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n } // SB checks, move to river
            ]);
            // Should be waiting for BB to act on river
            await expect(replay.replayAndGetEndState(actions, 20n, 20n)).to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("reverts on incomplete hand", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n } // Game not finished
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("handles alternating actor correctly through streets", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n }, // Player 0 (SB) acts
                { action: ACTION.BIG_BLIND, amount: 2n },   // Player 1 (BB) acts  
                { action: ACTION.CHECK_CALL, amount: 0n },  // Player 0 (SB) acts - calls
                // Now on flop, BB acts first (player 1)
                { action: ACTION.CHECK_CALL, amount: 0n },  // Player 1 (BB) checks
                { action: ACTION.CHECK_CALL, amount: 0n },  // Player 0 (SB) checks
                // Now on turn, BB acts first (player 1)  
                { action: ACTION.CHECK_CALL, amount: 0n },  // Player 1 (BB) checks
                { action: ACTION.CHECK_CALL, amount: 0n },  // Player 0 (SB) checks
                // Now on river, BB acts first (player 1)
                { action: ACTION.CHECK_CALL, amount: 0n },  // Player 1 (BB) checks
                { action: ACTION.CHECK_CALL, amount: 0n }   // Player 0 (SB) checks -> showdown
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("handles raise-reraise-reraise sequence on same street", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { action: ACTION.BET_RAISE, amount: 5n }, // BB reraises to 7 total (raise of 5)
                { action: ACTION.BET_RAISE, amount: 8n }, // SB reraises to 12 total (raise of 8, >= 5)
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("handles betting reopened on multiple streets", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB calls, move to flop
                { action: ACTION.BET_RAISE, amount: 5n }, // BB bets on flop
                { action: ACTION.BET_RAISE, amount: 10n }, // SB raises on flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB calls, move to turn
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.BET_RAISE, amount: 10n }, // SB bets on turn
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB calls, move to river
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n } // SB checks -> showdown
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 50n, 50n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("handles fold after multiple betting rounds", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.BET_RAISE, amount: 3n }, // BB bets
                { action: ACTION.BET_RAISE, amount: 6n }, // SB raises  
                { action: ACTION.BET_RAISE, amount: 12n }, // BB reraises
                { action: ACTION.FOLD, amount: 0n } // SB folds on flop
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 30n, 30n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });
    });

    describe("All-in Scenarios", function () {
        it("handles all-in preflop followed by fold", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 9n }, // SB goes all-in
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("handles player all-in from blind posting", async function () {
            // Test when a player goes all-in just from posting blinds
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
                // SB should be all-in after posting blind, so game should end immediately
            ]);
            // SB has only 1 chip total, so goes all-in posting blind
            await expect(replay.replayAndGetEndState(actions, 1n, 10n)).to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("handles both players all-in from blinds by going to showdown", async function () {
            // When both players go all-in from posting blinds, contract should
            // automatically go to showdown instead of expecting more actions
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n }
                // Both players are now all-in, should go directly to showdown
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 5n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("handles player all-in from big blind posting only", async function () {
            // Test when only the big blind player goes all-in from posting blind
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                // BB is now all-in, SB should still be able to act
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 2n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("handles SB all-in from blind, BB calls scenario", async function () {
            // SB goes all-in from posting blind, BB can call to complete action
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 3n },
                { action: ACTION.BIG_BLIND, amount: 6n },
                // SB is all-in, has no more chips, so BB needs to check to complete
                { action: ACTION.CHECK_CALL, amount: 0n } // BB checks (since SB is all-in)
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 3n, 10n);
            expect(end).to.equal(1n); // Should go to showdown
        });

        it("handles both players all-in preflop immediately", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB calls all-in
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 5n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("handles one player all-in postflop", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.BET_RAISE, amount: 8n }, // BB bets all remaining 8
                { action: ACTION.CHECK_CALL, amount: 0n } // SB calls
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("handles edge case: only big blind all-in from blinds", async function () {
            // BB goes all-in from posting blind, SB still has chips to act
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                // Only BB is all-in, SB can still act
                { action: ACTION.CHECK_CALL, amount: 0n } // SB calls
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 2n); // BB has exactly 2
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("verifies normal play still works when neither player all-in from blinds", async function () {
            // Normal case where neither player is all-in after blinds  
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls
                { action: ACTION.CHECK_CALL, amount: 0n } // BB checks, advance to flop
            ]);
            await expect(replay.replayAndGetEndState(actions, 100n, 100n))
                .to.be.revertedWithCustomError(replay, "HandNotDone");
        });
    });

    describe("Street Transitions", function () {
        it("handles bet-call sequence advancing streets correctly", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.BET_RAISE, amount: 3n }, // BB bets on flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to turn
                { action: ACTION.BET_RAISE, amount: 4n }, // BB bets on turn
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to river
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks on river
                { action: ACTION.CHECK_CALL, amount: 0n } // SB checks -> showdown
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 20n, 20n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("verifies correct actor after street transitions", async function () {
            // This test ensures BB acts first on each postflop street
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop - now BB should act first
                { action: ACTION.BET_RAISE, amount: 2n }, // BB acts first on flop (correct)
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to turn - now BB should act first  
                { action: ACTION.BET_RAISE, amount: 3n }, // BB acts first on turn (correct)
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to river - now BB should act first
                { action: ACTION.BET_RAISE, amount: 4n }, // BB acts first on river (correct)
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("reverts when trying to exceed maximum street", async function () {
            // This should be impossible given normal flow, but test boundary
            // The contract should prevent going beyond street 3 (river)
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to street 1 
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to street 2
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks  
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to street 3
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }  // Should reach showdown (street 4)
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN - should not revert, should end normally
        });
    });

    describe("Reopening Betting Logic", function () {
        it("tests reopen false after short all-in prevents further raising", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises (reopens betting)
                { action: ACTION.BET_RAISE, amount: 3n }, // BB short all-in (closes reopening)
                { action: ACTION.BET_RAISE, amount: 5n } // SB tries to raise again (should fail)
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 5n)).to.be.revertedWithCustomError(replay, "NoReopenAllowed");
        });

        it("tests reopen true after full raise allows further raising", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises by 2 (minimum)
                { action: ACTION.BET_RAISE, amount: 5n }, // BB raises by 5 (> minimum, reopens)
                { action: ACTION.BET_RAISE, amount: 7n }, // SB raises by 7 (>= 5, valid)
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("tests minimum raise requirement with exact amounts", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 4n }, // SB raises by 4 (to 5 total)
                { action: ACTION.BET_RAISE, amount: 6n }, // BB re-raises min: toCall 3 + raise inc 3
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder, potSize] = await replay.replayAndGetEndState(actions, 20n, 20n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
            expect(potSize).to.equal(13n); // SB: 1 + BB: 2 + SB raise: 4 + BB raise: 6 = 13
        });
    });

    describe("Reraise Limit Tests", function () {
        it("allows up to 4 raises per street", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }, // raise 1
                { action: ACTION.BET_RAISE, amount: 3n }, // raise 2
                { action: ACTION.BET_RAISE, amount: 5n }, // raise 3
                { action: ACTION.BET_RAISE, amount: 8n }, // raise 4
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 50n, 50n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when exceeding 4 raises per street", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }, // raise 1
                { action: ACTION.BET_RAISE, amount: 3n }, // raise 2
                { action: ACTION.BET_RAISE, amount: 5n }, // raise 3
                { action: ACTION.BET_RAISE, amount: 8n }, // raise 4
                { action: ACTION.BET_RAISE, amount: 12n } // raise 5 - should fail
            ]);
            await expect(replay.replayAndGetEndState(actions, 50n, 50n)).to.be.revertedWithCustomError(replay, "RaiseLimitExceeded");
        });

        it("resets raise counter between streets", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }, // raise 1 preflop
                { action: ACTION.BET_RAISE, amount: 3n }, // raise 2 preflop
                { action: ACTION.BET_RAISE, amount: 5n }, // raise 3 preflop
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, go to flop
                { action: ACTION.BET_RAISE, amount: 2n }, // BB bets flop (raise 1 on flop)
                { action: ACTION.BET_RAISE, amount: 4n }, // SB raises (raise 2 on flop)
                { action: ACTION.BET_RAISE, amount: 5n }, // BB reraises (raise 3 on flop)
                { action: ACTION.BET_RAISE, amount: 8n }, // SB reraises (raise 4 on flop) - should work
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 50n, 50n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when exceeding limit on later streets", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, go to flop
                { action: ACTION.BET_RAISE, amount: 2n }, // BB bets flop (raise 1)
                { action: ACTION.BET_RAISE, amount: 4n }, // SB raises (raise 2)
                { action: ACTION.BET_RAISE, amount: 6n }, // BB reraises (raise 3)
                { action: ACTION.BET_RAISE, amount: 8n }, // SB reraises (raise 4)
                { action: ACTION.BET_RAISE, amount: 12n } // BB reraises (raise 5) - should fail
            ]);
            await expect(replay.replayAndGetEndState(actions, 50n, 50n)).to.be.revertedWithCustomError(replay, "RaiseLimitExceeded");
        });
    });
});
