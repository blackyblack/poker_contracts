const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { buildActions } = require("../helpers/test-utils");

describe("HeadsUpPokerReplay - finishPartialHand", function () {
    let replay;

    beforeEach(async function () {
        const Replay = await ethers.getContractFactory("HeadsUpPokerReplay");
        replay = await Replay.deploy();
    });

    describe("Problem Statement Requirements", function () {
        it("should check to showdown on partial preflop with no bet (toCall == 0)", async function () {
            // Scenario: Both players posted blinds, SB called, BB to act with toCall == 0
            const gameState = {
                stacks: [8n, 8n], // After blinds: SB has 9, BB has 8 after BB posts 2
                contrib: [2n, 2n], // SB called to match BB 
                total: [2n, 2n],   // Total contributions equal
                allIn: [false, false],
                actor: 1, // Big blind to act
                street: 0, // Preflop
                toCall: 0n, // No amount to call
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(2n); // Min of both totals
        });

        it("should fold on single bet then timeout (toCall > 0)", async function () {
            // Scenario: BB bets on flop, SB to act with toCall > 0 but times out
            const gameState = {
                stacks: [6n, 5n], 
                contrib: [3n, 0n], // BB bet 3 on flop
                total: [5n, 5n],   // Previous contributions from preflop
                allIn: [false, false],
                actor: 0, // Small blind to act
                street: 1, // Flop
                toCall: 3n, // SB needs to call 3
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // Small blind (player 0) folded
            expect(calledAmount).to.equal(5n); // Min of both totals before the fold
        });

        it("should go to showdown on all-in on any street", async function () {
            // Scenario: Player 0 is all-in on turn
            const gameState = {
                stacks: [0n, 4n], 
                contrib: [6n, 4n], // Player 0 went all-in for 6
                total: [8n, 6n],   // Total contributions 
                allIn: [true, false],
                actor: 1, // Player 1 to act, facing all-in
                street: 2, // Turn
                toCall: 2n, // Player 1 needs 2 more to call the all-in
                lastRaise: 2n,
                checked: false,
                reopen: false, // All-in doesn't reopen
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN (all-in scenario)
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(6n); // Min of both totals
        });

        it("should go to showdown when both players are all-in", async function () {
            // Scenario: Both players all-in
            const gameState = {
                stacks: [0n, 0n],
                contrib: [8n, 6n], 
                total: [10n, 8n],   
                allIn: [true, true],
                actor: 0, // Doesn't matter who acts
                street: 1, // Flop
                toCall: 0n, // Both all-in, no more to call
                lastRaise: 2n,
                checked: false,
                reopen: false,
                raiseCount: 2
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(8n); // Min of both totals
        });
    });

    describe("Invalid sequences and edge cases", function () {
        it("should handle invalid street numbers gracefully", async function () {
            // Test with street > 3 (which would be invalid but we handle gracefully)
            const gameState = {
                stacks: [5n, 5n],
                contrib: [0n, 0n],
                total: [5n, 5n],
                allIn: [false, false],
                actor: 1,
                street: 4, // Beyond river - this should not happen in practice
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 0
            };

            // The function should handle this case gracefully and go to showdown
            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
            expect(calledAmount).to.equal(5n);
        });

        it("should handle actor index edge cases", async function () {
            // Test with actor values that are valid (0 or 1)
            const gameState = {
                stacks: [5n, 5n],
                contrib: [3n, 0n],
                total: [5n, 3n],
                allIn: [false, false],
                actor: 1, // Valid actor
                street: 2,
                toCall: 3n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 0);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // Player 1 folded
            expect(calledAmount).to.equal(3n);
        });

        it("should handle zero stacks correctly", async function () {
            // Player with zero stack should be considered all-in
            const gameState = {
                stacks: [0n, 5n],
                contrib: [10n, 8n],
                total: [10n, 8n],
                allIn: [true, false], // Player 0 is all-in
                actor: 0, // All-in player to act
                street: 1,
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 0
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
            expect(calledAmount).to.equal(8n);
        });

        it("should handle large toCall amounts", async function () {
            // Test with large toCall that exceeds stack
            const gameState = {
                stacks: [2n, 8n],
                contrib: [15n, 5n],
                total: [18n, 7n],
                allIn: [false, false],
                actor: 1, // Player 1 to act
                street: 3,
                toCall: 10n, // Large amount to call
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // Player 1 folded
            expect(calledAmount).to.equal(7n);
        });

        it("should properly handle checked state transitions", async function () {
            // Test when one player has already checked and we need to determine next action
            const gameState = {
                stacks: [6n, 6n],
                contrib: [0n, 0n],
                total: [4n, 4n],
                allIn: [false, false],
                actor: 0, // Player 0 to act after player 1 checked
                street: 2, // Turn
                toCall: 0n,
                lastRaise: 2n,
                checked: true, // Someone already checked
                reopen: true,
                raiseCount: 0
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(1n); // End.SHOWDOWN (will move to river)
            expect(folder).to.equal(0n);
            expect(calledAmount).to.equal(4n);
        });

        it("should handle game state with mismatched allIn flags and stacks", async function () {
            // Test defensive case where allIn flag doesn't match zero stack
            const gameState = {
                stacks: [0n, 5n],
                contrib: [8n, 5n],
                total: [10n, 7n],
                allIn: [false, false], // allIn flag not set despite zero stack
                actor: 0, // Player with zero stack to act
                street: 1,
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            // Function should still work correctly based on the allIn flag
            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(1n); // End.SHOWDOWN (due to toCall == 0)
            expect(folder).to.equal(0n);
            expect(calledAmount).to.equal(7n);
        });
    });

    describe("All-in scenarios", function () {
        it("should go to showdown when current actor is all-in", async function () {
            const gameState = {
                stacks: [0n, 5n],
                contrib: [10n, 8n],
                total: [10n, 8n],
                allIn: [true, false],
                actor: 0, // All-in player to act
                street: 1,
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 0
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(8n); // Min of both totals
        });
    });

    describe("Fold scenarios", function () {
        it("should fold when toCall > 0", async function () {
            const gameState = {
                stacks: [5n, 3n],
                contrib: [8n, 5n],
                total: [10n, 7n],
                allIn: [false, false],
                actor: 1, // Player 1 to act
                street: 1,
                toCall: 3n, // Has to call 3 to match
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // Player 1 folded
            expect(calledAmount).to.equal(7n); // Min of both totals
        });

        it("should fold the small blind when facing a big blind bet preflop", async function () {
            const gameState = {
                stacks: [8n, 6n],
                contrib: [1n, 2n],
                total: [1n, 2n],
                allIn: [false, false],
                actor: 0, // Small blind to act
                street: 0,
                toCall: 1n, // SB needs to call 1 more to match BB
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // Small blind (player 0) folded
            expect(calledAmount).to.equal(1n); // Min of both totals
        });
    });

    describe("Check to showdown scenarios", function () {
        it("should check to showdown from preflop when toCall is 0", async function () {
            const gameState = {
                stacks: [8n, 8n],
                contrib: [2n, 2n], // Both called, no one to call
                total: [2n, 2n],
                allIn: [false, false],
                actor: 1, // Big blind to act
                street: 0,
                toCall: 0n, // No amount to call
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(2n); // Min of both totals
        });

        it("should check to showdown from flop when toCall is 0", async function () {
            const gameState = {
                stacks: [6n, 6n],
                contrib: [0n, 0n], // Fresh street, no contributions yet
                total: [4n, 4n], // Previous total from preflop
                allIn: [false, false],
                actor: 1, // Big blind acts first postflop
                street: 1, // On flop
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 0
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(4n); // Min of both totals
        });

        it("should check to showdown from turn when toCall is 0", async function () {
            const gameState = {
                stacks: [6n, 6n],
                contrib: [0n, 0n],
                total: [4n, 4n],
                allIn: [false, false],
                actor: 1, // Big blind acts first postflop
                street: 2, // On turn
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 0
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(4n); // Min of both totals
        });

        it("should check to showdown from river when toCall is 0", async function () {
            const gameState = {
                stacks: [6n, 6n],
                contrib: [0n, 0n],
                total: [4n, 4n],
                allIn: [false, false],
                actor: 1, // Big blind acts first postflop
                street: 3, // On river
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 0
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n); // No folder in showdown
            expect(calledAmount).to.equal(4n); // Min of both totals
        });
    });

    describe("Edge cases", function () {
        it("should handle different stack sizes correctly", async function () {
            const gameState = {
                stacks: [15n, 3n], // Asymmetric stacks
                contrib: [5n, 7n],
                total: [5n, 7n],
                allIn: [false, false],
                actor: 0, // Player 0 to act
                street: 2,
                toCall: 2n, // Needs to call 2
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // Player 0 folded
            expect(calledAmount).to.equal(5n); // Min of both totals
        });

        it("should handle minimal contributions correctly", async function () {
            const gameState = {
                stacks: [9n, 8n],
                contrib: [1n, 2n],
                total: [1n, 2n],
                allIn: [false, false],
                actor: 0,
                street: 0,
                toCall: 1n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1); // BB player is 1
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // Player 0 folded
            expect(calledAmount).to.equal(1n); // Min of both totals
        });
    });

    describe("Integration with realistic game scenarios", function () {
        it("should handle timeout after SB calls BB preflop", async function () {
            // Realistic scenario: SB calls BB, then BB times out (toCall == 0)
            const gameState = {
                stacks: [8n, 8n], // Both have equal stacks after calling
                contrib: [2n, 2n], // Both put in equal amounts
                total: [2n, 2n],
                allIn: [false, false],
                actor: 1, // BB to act after SB called
                street: 0, // Preflop
                toCall: 0n, // No amount to call
                lastRaise: 2n,
                checked: false, // BB hasn't acted yet
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(1n); // End.SHOWDOWN (checks through all streets)
            expect(folder).to.equal(0n);
            expect(calledAmount).to.equal(2n);
        });

        it("should handle timeout after flop bet", async function () {
            // Realistic scenario: Went to flop, BB bets, SB times out (toCall > 0)
            const gameState = {
                stacks: [6n, 5n], // SB has 6, BB has 5 after bet
                contrib: [0n, 3n], // BB bet 3 on flop
                total: [2n, 5n], // Total including preflop
                allIn: [false, false],
                actor: 0, // SB to act
                street: 1, // Flop
                toCall: 3n, // SB needs to call 3
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(0n); // End.FOLD (SB folds)
            expect(folder).to.equal(0n); // SB folded
            expect(calledAmount).to.equal(2n); // Min total before fold
        });

        it("should handle river all-in timeout", async function () {
            // Realistic scenario: River, one player goes all-in, other times out
            const gameState = {
                stacks: [0n, 3n], // Player 0 went all-in
                contrib: [7n, 0n], // Player 0 bet all remaining 7
                total: [9n, 2n], // Previous contributions
                allIn: [true, false],
                actor: 1, // Player 1 facing all-in
                street: 3, // River
                toCall: 7n, // Needs to call 7
                lastRaise: 2n,
                checked: false,
                reopen: false, // All-in doesn't reopen
                raiseCount: 1
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(1n); // End.SHOWDOWN (all-in scenario)
            expect(folder).to.equal(0n);
            expect(calledAmount).to.equal(2n); // Min total
        });

        it("should handle check-check scenario on turn", async function () {
            // Realistic scenario: Made it to turn, both check through to river
            const gameState = {
                stacks: [5n, 5n],
                contrib: [0n, 0n], // Fresh turn street
                total: [5n, 5n], // Previous contributions
                allIn: [false, false],
                actor: 1, // BB acts first postflop
                street: 2, // Turn
                toCall: 0n,
                lastRaise: 2n,
                checked: false,
                reopen: true,
                raiseCount: 0
            };

            const [end, folder, calledAmount] = await replay.finishPartialHand(gameState, 1);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
            expect(calledAmount).to.equal(5n);
        });
    });
});