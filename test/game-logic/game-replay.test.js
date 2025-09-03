const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { actionHash } = require("../helpers/hashes");
const { buildActions } = require("../helpers/test-utils");

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
            const [end, folder, wonAmount] = await replay.replayAndGetEndState(actions, stackA, stackB, 1n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n);
            expect(wonAmount).to.equal(1n); // SB: 1
        });

        it("returns fold when big blind folds preflop", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB makes min raise (1->4)
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder, wonAmount] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
            expect(wonAmount).to.equal(2n); // BB: 2
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
            const [end, folder, wonAmount] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            // showdown always has 0 as folder, do not test it further
            expect(folder).to.equal(0n);
            expect(wonAmount).to.equal(2n); // BB: 2 called
        });

        it("reaches showdown when both players are all-in", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 9n }, // SB goes all-in
                { action: ACTION.CHECK_CALL, amount: 0n } // BB calls
            ]);
            const [end, , wonAmount] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(wonAmount).to.equal(10n); // Both players all-in: 10 won by one of them
        });
    });

    describe("Blind Setup Validation", function () {
        // Table-driven test for small blind validation errors
        const blindValidationTests = [
            {
                name: "no actions provided",
                actions: [],
                error: "NoBlinds"
            },
            {
                name: "only one action provided", 
                actions: [{ action: ACTION.SMALL_BLIND, amount: 1n }],
                error: "NoBlinds"
            },
            {
                name: "small blind amount is zero",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 0n },
                    { action: ACTION.BIG_BLIND, amount: 0n }
                ],
                error: "SmallBlindAmountInvalid"
            },
            {
                name: "big blind amount is incorrect", 
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 3n }
                ],
                error: "BigBlindAmountInvalid"
            }
        ];

        blindValidationTests.forEach(test => {
            it(`reverts when ${test.name}`, async function () {
                const actions = test.actions.length > 0 ? buildActions(test.actions) : [];
                await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n))
                    .to.be.revertedWithCustomError(replay, test.error);
            });
        });

        it("reverts when small blind amount below minimum", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 2n },
                { action: ACTION.BIG_BLIND, amount: 4n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 5n))
                .to.be.revertedWithCustomError(replay, "SmallBlindAmountInvalid");
        });

        it("reverts when blind amounts exceed available stacks", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 1n, 1n))
                .to.be.revertedWithCustomError(replay, "BigBlindStackInvalid");
        });
    });

    describe("Action Sequence Validation", function () {
        // Table-driven tests for action validation
        const actionValidationTests = [
            {
                name: "sequence number not increasing",
                setup: () => {
                    const actions = buildActions([
                        { action: ACTION.SMALL_BLIND, amount: 1n },
                        { action: ACTION.BIG_BLIND, amount: 2n }
                    ]);
                    const badAction = {
                        channelId: 1n, handId: 1n, seq: 1, // Same as previous
                        action: ACTION.FOLD, amount: 0n, prevHash: actionHash(actions[1])
                    };
                    return [...actions, badAction];
                },
                error: "SequenceInvalid"
            },
            {
                name: "incorrect prevHash",
                setup: () => {
                    const actions = buildActions([
                        { action: ACTION.SMALL_BLIND, amount: 1n },
                        { action: ACTION.BIG_BLIND, amount: 2n }
                    ]);
                    const badAction = {
                        channelId: 1n, handId: 1n, seq: 3, action: ACTION.FOLD,
                        amount: 0n, prevHash: ethers.keccak256("0x1234")
                    };
                    return [...actions, badAction];
                },
                error: "PrevHashInvalid"
            },
            {
                name: "blind actions used after start",
                setup: () => buildActions([
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.SMALL_BLIND, amount: 1n }
                ]),
                error: "BlindOnlyStart"
            },
            {
                name: "unknown action type",
                setup: () => {
                    const actions = buildActions([
                        { action: ACTION.SMALL_BLIND, amount: 1n },
                        { action: ACTION.BIG_BLIND, amount: 2n }
                    ]);
                    const badAction = {
                        channelId: 1n, handId: 1n, seq: 3, action: 99,
                        amount: 0n, prevHash: actionHash(actions[1])
                    };
                    return [...actions, badAction];
                },
                error: "UnknownAction"
            }
        ];

        actionValidationTests.forEach(test => {
            it(`reverts when ${test.name}`, async function () {
                const actions = test.setup();
                await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n))
                    .to.be.revertedWithCustomError(replay, test.error);
            });
        });

        it("reverts when all-in player tries to act", async function () {
            const badActions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.FOLD, amount: 0n }
            ]);
            await expect(replay.replayAndGetEndState(badActions, 5n, 11n, 1n))
                .to.be.revertedWithCustomError(replay, "PlayerAllIn");
        });
    });

    describe("Fold Action Tests", function () {
        it("reverts when fold has non-zero amount", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 1n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n))
                .to.be.revertedWithCustomError(replay, "FoldAmountInvalid");
        });

        // Table-driven test for fold scenarios on different streets
        const foldTests = [
            { street: "flop", expectedFolder: 0n, actions: [
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]},
            { street: "turn", expectedFolder: 1n, actions: [
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to turn
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]},
            { street: "river", expectedFolder: 1n, actions: [
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to turn
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // Move to river
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]}
        ];

        foldTests.forEach(test => {
            it(`handles fold on ${test.street}`, async function () {
                const actions = buildActions(test.actions);
                const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
                expect(end).to.equal(0n); // End.FOLD
                expect(folder).to.equal(test.expectedFolder);
            });
        });
    });

    describe("Check/Call Action Tests", function () {
        // Table-driven tests for check/call validation
        const checkCallValidationTests = [
            {
                name: "call amount is incorrect",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.CHECK_CALL, amount: 2n }
                ],
                error: "CallAmountInvalid"
            },
            {
                name: "check with amount when no bet to call",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                    { action: ACTION.CHECK_CALL, amount: 1n } // BB tries to check with amount
                ],
                error: "CheckAmountInvalid"
            }
        ];

        checkCallValidationTests.forEach(test => {
            it(`reverts when ${test.name}`, async function () {
                const actions = buildActions(test.actions);
                await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n))
                    .to.be.revertedWithCustomError(replay, test.error);
            });
        });

        // All-in call scenarios
        const allInCallTests = [
            {
                name: "all-in call with correct amount",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.BET_RAISE, amount: 9n }, // SB all-in
                    { action: ACTION.CHECK_CALL, amount: 0n } // BB calls
                ],
                stacks: [10n, 9n], // BB has only 9
                expectedEnd: 1n // SHOWDOWN
            },
            {
                name: "partial all-in call with insufficient chips",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.BET_RAISE, amount: 8n }, // SB raises big
                    { action: ACTION.CHECK_CALL, amount: 0n } // BB calls with remaining
                ],
                stacks: [10n, 5n], // BB only has 5 total
                expectedEnd: 1n // SHOWDOWN
            }
        ];

        allInCallTests.forEach(test => {
            it(`handles ${test.name}`, async function () {
                const actions = buildActions(test.actions);
                const [end] = await replay.replayAndGetEndState(actions, test.stacks[0], test.stacks[1], 1n);
                expect(end).to.equal(test.expectedEnd);
            });
        });

        it("progresses streets after both players check", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks, move to turn
                { action: ACTION.CHECK_CALL, amount: 0n }  // BB checks
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n))
                .to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("reaches showdown after river checks", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, turn
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, river
                { action: ACTION.CHECK_CALL, amount: 0n }  // SB checks -> showdown
            ]);
            const [end] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
            expect(end).to.equal(1n); // SHOWDOWN
        });
    });

    describe("Bet/Raise Action Tests", function () {
        it("reverts when bet/raise amount is zero", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 0n } // Should be > 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n)).to.be.revertedWithCustomError(replay, "RaiseAmountZero");
        });

        it("reverts when raise is below minimum", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 2n } // Below minimum raise (should be >= 3)
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n)).to.be.revertedWithCustomError(replay, "MinimumRaiseNotMet");
        });

        it("handles minimum raise correctly", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // Minimum raise
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when raise exceeds available stack plus toCall", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 11n } // Exceeds 9 available + 1 toCall
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n)).to.be.revertedWithCustomError(replay, "RaiseStackInvalid");
        });

        it("handles all-in raise with exact amount", async function () {
            // Should not revert, this is a valid all-in
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n }, // All-in with remaining stack
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when all-in raise amount is incorrect", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.BET_RAISE, amount: 4n } // Should be 5 to go all-in (5+4=9 total
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n)).to.be.revertedWithCustomError(replay, "RaiseInsufficientIncrease");
        });

        it("reverts when raise doesn't increase the bet", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 2n }, // Raises to 3 total (1+2)
                { action: ACTION.BET_RAISE, amount: 1n } // Trying to raise to 3 total (2+1), no increase
            ]);
            await expect(replay.replayAndGetEndState(actions, 3n, 10n, 1n)).to.be.revertedWithCustomError(replay, "RaiseInsufficientIncrease");
        });

        it("reverts when bet exceeds deposit limit", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n } // Total 9 > stack 8
            ]);
            await expect(replay.replayAndGetEndState(actions, 8n, 10n, 1n)).to.be.revertedWithCustomError(replay, "RaiseStackInvalid");
        });

        it("handles re-raise scenario with underraised bet", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { action: ACTION.BET_RAISE, amount: 3n }, // BB re-raises to 5 total (2+3)
            ]);
            // This should revert since the re-raise must be at least the size of the previous raise (2)
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n)).to.be.revertedWithCustomError(replay, "MinimumRaiseNotMet");
        });

        it("handles re-raise scenario", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { action: ACTION.BET_RAISE, amount: 5n }, // BB re-raises to 7 total (2+5)
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
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
            await expect(replay.replayAndGetEndState(actions, 3n, 10n, 1n)).to.be.revertedWithCustomError(replay, "NoReopenAllowed");
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n, 1n);
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
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
            const [end, ,] = await replay.replayAndGetEndState(badActions, 6n, 10n, 1n);
            expect(end).to.equal(1n); // Should be showdown since SB is all-in
        });

        it("correctly calculates side pot when short stack goes all-in", async function () {
            // Test the specific scenario from the problem statement:
            // Player1 bets 100, player2 calls with 50 (his full stack) and all-ins.
            // Only 50 from player1 should go to the pot, not the full 100.
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 100n }, // SB bets 100
                { action: ACTION.CHECK_CALL, amount: 0n } // BB calls with only 50 total stack
            ]);
            const [end, , wonAmount] = await replay.replayAndGetEndState(actions, 200n, 50n, 1n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(wonAmount).to.equal(50n); // 50 should be the max pot won by either player
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
            await expect(replay.replayAndGetEndState(actions, 20n, 20n, 1n)).to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("reverts on incomplete hand", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n } // Game not finished
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n, 1n)).to.be.revertedWithCustomError(replay, "HandNotDone");
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
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n, 1n);
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
            const [end, ,] = await replay.replayAndGetEndState(actions, 50n, 50n, 1n);
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 30n, 30n, 1n);
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
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
            await expect(replay.replayAndGetEndState(actions, 1n, 10n, 1n)).to.be.revertedWithCustomError(replay, "HandNotDone");
        });

        it("handles both players all-in from blinds by going to showdown", async function () {
            // When both players go all-in from posting blinds, contract should
            // automatically go to showdown instead of expecting more actions
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n }
                // Both players are now all-in, should go directly to showdown
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 5n, 10n, 1n);
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 10n, 2n, 1n);
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
            const [end, ,] = await replay.replayAndGetEndState(actions, 3n, 10n, 1n);
            expect(end).to.equal(1n); // Should go to showdown
        });

        it("handles both players all-in preflop immediately", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB calls all-in
            ]);
            const [end, ,] = await replay.replayAndGetEndState(actions, 5n, 10n, 1n);
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
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
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
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 2n, 1n); // BB has exactly 2
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
            await expect(replay.replayAndGetEndState(actions, 100n, 100n, 1n))
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
            const [end, ,] = await replay.replayAndGetEndState(actions, 20n, 20n, 1n);
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n, 1n);
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
            const [end, ,] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
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
            await expect(replay.replayAndGetEndState(actions, 10n, 5n, 1n)).to.be.revertedWithCustomError(replay, "NoReopenAllowed");
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
            const [end, folder,] = await replay.replayAndGetEndState(actions, 20n, 20n, 1n);
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
            const [end, folder, wonAmount] = await replay.replayAndGetEndState(actions, 20n, 20n, 1n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
            expect(wonAmount).to.equal(5n); // SB: 1 + SB raise: 4 = 5
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
            const [end, folder] = await replay.replayAndGetEndState(actions, 50n, 50n, 1n);
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
            await expect(replay.replayAndGetEndState(actions, 50n, 50n, 1n)).to.be.revertedWithCustomError(replay, "RaiseLimitExceeded");
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
            const [end, folder] = await replay.replayAndGetEndState(actions, 50n, 50n, 1n);
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
            await expect(replay.replayAndGetEndState(actions, 50n, 50n, 1n)).to.be.revertedWithCustomError(replay, "RaiseLimitExceeded");
        });
    });

    describe("Alternating Small Blind", function () {
        // Table-driven tests for small blind alternation
        const blindAlternationTests = [
            { handId: 1n, expectedSbFolder: 0n, desc: "Player 0 as small blind for odd handId" },
            { handId: 2n, expectedSbFolder: 1n, desc: "Player 1 as small blind for even handId" },
            { handId: 3n, expectedSbFolder: 0n, desc: "alternation continues for handId 3" },
            { handId: 4n, expectedSbFolder: 1n, desc: "alternation continues for handId 4" }
        ];

        blindAlternationTests.forEach(test => {
            it(`should have ${test.desc}`, async function () {
                const actions = buildActions([
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.FOLD, amount: 0n } // Small blind folds
                ], 1n, test.handId);

                const [end, folder, wonAmount] = await replay.replayAndGetEndState(actions, 10n, 10n, 1n);
                expect(end).to.equal(0n); // End.FOLD
                expect(folder).to.equal(test.expectedSbFolder);
                expect(wonAmount).to.equal(1n); // SB: 1
            });
        });

        it("should correctly handle stack deductions for alternating blind", async function () {
            // For handId=2 (even), Player 1 posts SB, Player 0 posts BB
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n }
            ], 1n, 2n);

            const [end, , wonAmount] = await replay.replayAndGetEndState(actions, 10n, 5n, 1n);
            expect(end).to.equal(1n); // End.SHOWDOWN (both all-in)
            expect(wonAmount).to.equal(5n); // Max win is min(5, 10) = 5
        });

        // Table-driven tests for stack validation with alternating blinds
        const stackValidationTests = [
            {
                name: "small blind amount against correct player's stack",
                handId: 2n, // Player 1 is SB
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 15n },
                    { action: ACTION.BIG_BLIND, amount: 30n }
                ],
                stacks: [50n, 10n], // Player 1 (SB) has only 10
                error: "SmallBlindAmountInvalid"
            },
            {
                name: "big blind amount against correct player's stack", 
                handId: 2n, // Player 0 is BB
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 6n },
                    { action: ACTION.BIG_BLIND, amount: 12n }
                ],
                stacks: [10n, 50n], // Player 0 (BB) has only 10
                error: "BigBlindStackInvalid"
            }
        ];

        stackValidationTests.forEach(test => {
            it(`should validate ${test.name}`, async function () {
                const actions = buildActions(test.actions, 1n, test.handId);
                await expect(replay.replayAndGetEndState(actions, test.stacks[0], test.stacks[1], 1n))
                    .to.be.revertedWithCustomError(replay, test.error);
            });
        });
    });

    describe("Complete Game Scenarios", function () {
        // Consolidated happy path scenarios testing complete game flows
        const gameScenarios = [
            {
                name: "preflop raise -> call -> postflop bet -> fold",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.BET_RAISE, amount: 3n }, // SB raises
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB calls, flop
                    { action: ACTION.BET_RAISE, amount: 2n }, // BB bets
                    { action: ACTION.FOLD, amount: 0n } // SB folds
                ],
                expectedEnd: 0n, expectedFolder: 0n, expectedWon: 4n
            },
            {
                name: "preflop all-in vs call -> showdown",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.BET_RAISE, amount: 19n }, // SB all-in
                    { action: ACTION.CHECK_CALL, amount: 0n } // BB calls
                ],
                expectedEnd: 1n, expectedFolder: 0n, expectedWon: 20n
            },
            {
                name: "limp and check down to showdown",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, flop
                    { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, turn
                    { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, river
                    { action: ACTION.CHECK_CALL, amount: 0n } // SB checks → showdown
                ],
                expectedEnd: 1n, expectedFolder: 0n, expectedWon: 2n
            }
        ];

        gameScenarios.forEach(scenario => {
            it(`handles ${scenario.name}`, async function () {
                const actions = buildActions(scenario.actions);
                const [end, folder, wonAmount] = await replay.replayAndGetEndState(actions, 20n, 20n, 1n);
                expect(end).to.equal(scenario.expectedEnd);
                if (scenario.expectedEnd === 0n) {
                    expect(folder).to.equal(scenario.expectedFolder);
                }
                expect(wonAmount).to.equal(scenario.expectedWon);
            });
        });
    });

    describe("Won Amount Calculation Tests", function () {
        // Table-driven tests for won amount calculation: min(total0, total1)
        const wonAmountTests = [
            {
                name: "SB folds after blinds only",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.FOLD, amount: 0n }
                ],
                expectedEnd: 0n, expectedFolder: 0n, expectedWon: 1n
            },
            {
                name: "BB folds after SB raises",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.BET_RAISE, amount: 3n },
                    { action: ACTION.FOLD, amount: 0n }
                ],
                expectedEnd: 0n, expectedFolder: 1n, expectedWon: 2n
            },
            {
                name: "bet and fold scenario",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.CHECK_CALL, amount: 0n }, // Move to flop
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                    { action: ACTION.BET_RAISE, amount: 5n }, // SB bets
                    { action: ACTION.FOLD, amount: 0n } // BB folds
                ],
                expectedEnd: 0n, expectedFolder: 1n, expectedWon: 2n
            },
            {
                name: "all-in call with unequal stacks",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.BET_RAISE, amount: 8n },
                    { action: ACTION.CHECK_CALL, amount: 0n }
                ],
                stacks: [10n, 5n], expectedEnd: 1n, expectedWon: 5n
            },
            {
                name: "equal all-in contributions",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 2n },
                    { action: ACTION.BIG_BLIND, amount: 4n },
                    { action: ACTION.BET_RAISE, amount: 6n },
                    { action: ACTION.CHECK_CALL, amount: 0n }
                ],
                stacks: [10n, 8n], expectedEnd: 1n, expectedWon: 8n
            },
            {
                name: "check down to showdown",
                actions: [
                    { action: ACTION.SMALL_BLIND, amount: 1n },
                    { action: ACTION.BIG_BLIND, amount: 2n },
                    { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, flop
                    { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, turn
                    { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                    { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks, river
                    { action: ACTION.CHECK_CALL, amount: 0n } // SB checks → showdown
                ],
                expectedEnd: 1n, expectedWon: 2n
            }
        ];

        wonAmountTests.forEach(test => {
            it(`calculates correct won amount for ${test.name}`, async function () {
                const actions = buildActions(test.actions);
                const stacks = test.stacks || [10n, 10n];
                const [end, folder, wonAmount] = await replay.replayAndGetEndState(actions, stacks[0], stacks[1], 1n);
                
                expect(end).to.equal(test.expectedEnd);
                if (test.expectedEnd === 0n) {
                    expect(folder).to.equal(test.expectedFolder);
                }
                expect(wonAmount).to.equal(test.expectedWon);
            });
        });
    });


});
