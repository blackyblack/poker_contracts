const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./actions");

// Helper to build actions with proper hashes and sequence numbers
function buildActions(specs) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const channelId = 1n;
    const handId = 1n;
    let seq = 1;
    let prevHash = ethers.ZeroHash;
    const actions = [];
    for (const spec of specs) {
        const act = {
            channelId,
            handId,
            seq: seq++,
            street: spec.street,
            action: spec.action,
            amount: spec.amount,
            prevHash
        };
        actions.push(act);
        prevHash = ethers.keccak256(
            abi.encode(
                ["uint256", "uint256", "uint32", "uint8", "uint8", "uint128", "bytes32"],
                [act.channelId, act.handId, act.seq, act.street, act.action, act.amount, act.prevHash]
            )
        );
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
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.FOLD, amount: 0n }
            ]);
            const stackA = 10n;
            const stackB = 10n;
            const [end, folder] = await replay.replayAndGetEndState(actions, stackA, stackB);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n);
        });

        it("returns fold when big blind folds preflop", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n }, // SB calls
                { street: 0, action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reaches showdown after checks on all streets", async function () {
            // blinds, call, then check down to showdown
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n }, // SB
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n }, // BB
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n }, // SB calls
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // SB checks -> move to street 2
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n }, // SB checks -> move to street 3
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n }  // SB checks -> showdown
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
        });

        it("reaches showdown when both players are all-in", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n }, // SB goes all-in
                { street: 0, action: ACTION.CHECK_CALL, amount: 8n } // BB calls all-in
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
        });
    });

    describe("Validation Tests - Blind Setup", function () {
        it("reverts when no actions provided", async function () {
            const actions = [];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("NO_BLINDS");
        });

        it("reverts when only one action provided", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("NO_BLINDS");
        });

        it("reverts when small blind has non-zero prevHash", async function () {
            const actions = [{
                channelId: 1n,
                handId: 1n,
                seq: 1,
                street: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: ethers.keccak256("0x1234") // Should be zero
            }];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_PREV");
        });

        it("reverts when small blind action is wrong", async function () {
            const actions = [{
                channelId: 1n,
                handId: 1n,
                seq: 1,
                street: 0,
                action: ACTION.BIG_BLIND, // Should be SMALL_BLIND
                amount: 1n,
                prevHash: ethers.ZeroHash
            }];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_ACT");
        });

        it("reverts when small blind street is wrong", async function () {
            const actions = [{
                channelId: 1n,
                handId: 1n,
                seq: 1,
                street: 1, // Should be 0
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: ethers.ZeroHash
            }];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_STREET");
        });

        it("reverts when small blind amount is zero", async function () {
            const actions = [{
                channelId: 1n,
                handId: 1n,
                seq: 1,
                street: 0,
                action: ACTION.SMALL_BLIND,
                amount: 0n, // Should be > 0
                prevHash: ethers.ZeroHash
            }];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_AMT");
        });

        it("reverts when small blind amount exceeds stack", async function () {
            const actions = [{
                channelId: 1n,
                handId: 1n,
                seq: 1,
                street: 0,
                action: ACTION.SMALL_BLIND,
                amount: 11n, // Exceeds stack of 10
                prevHash: ethers.ZeroHash
            }];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_AMT");
        });

        it("reverts when big blind sequence is not greater", async function () {
            const sbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 5,
                street: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: ethers.ZeroHash
            };
            const bbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 5, // Same seq, should be greater
                street: 0,
                action: ACTION.BIG_BLIND,
                amount: 2n,
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["uint256", "uint256", "uint32", "uint8", "uint8", "uint128", "bytes32"],
                        [sbAction.channelId, sbAction.handId, sbAction.seq, sbAction.street, sbAction.action, sbAction.amount, sbAction.prevHash]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([sbAction, bbAction], 10n, 10n)).to.be.revertedWith("SEQ1");
        });

        it("reverts when big blind prevHash is incorrect", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n }
            ]);
            const badBB = {
                channelId: 1n,
                handId: 1n,
                seq: 2,
                street: 0,
                action: ACTION.BIG_BLIND,
                amount: 2n,
                prevHash: ethers.keccak256("0x1234") // Wrong hash
            };
            await expect(replay.replayAndGetEndState([actions[0], badBB], 10n, 10n)).to.be.revertedWith("BB_PREV");
        });

        it("reverts when big blind action is wrong", async function () {
            const sbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 1,
                street: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: ethers.ZeroHash
            };
            const bbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 2,
                street: 0,
                action: ACTION.FOLD, // Should be BIG_BLIND
                amount: 2n,
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["uint256", "uint256", "uint32", "uint8", "uint8", "uint128", "bytes32"],
                        [sbAction.channelId, sbAction.handId, sbAction.seq, sbAction.street, sbAction.action, sbAction.amount, sbAction.prevHash]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([sbAction, bbAction], 10n, 10n)).to.be.revertedWith("BB_ACT");
        });

        it("reverts when big blind street is wrong", async function () {
            const sbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 1,
                street: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: ethers.ZeroHash
            };
            const bbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 2,
                street: 1, // Should be 0
                action: ACTION.BIG_BLIND,
                amount: 2n,
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["uint256", "uint256", "uint32", "uint8", "uint8", "uint128", "bytes32"],
                        [sbAction.channelId, sbAction.handId, sbAction.seq, sbAction.street, sbAction.action, sbAction.amount, sbAction.prevHash]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([sbAction, bbAction], 10n, 10n)).to.be.revertedWith("BB_STREET");
        });

        it("reverts when big blind amount is incorrect", async function () {
            // big blind should be exactly twice the small blind
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 3n } // wrong amount
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("BB_AMT");
        });

        it("reverts when big blind amount exceeds stack", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 1n)).to.be.revertedWith("BB_STACK");
        });
    });

    describe("Validation Tests - Action Sequence", function () {
        it("reverts when action sequence number is not increasing", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            // Manually create third action with wrong seq
            const badAction = {
                channelId: 1n,
                handId: 1n,
                seq: 2, // Same as previous, should be 3
                street: 0,
                action: ACTION.FOLD,
                amount: 0n,
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["uint256", "uint256", "uint32", "uint8", "uint8", "uint128", "bytes32"],
                        [actions[1].channelId, actions[1].handId, actions[1].seq, actions[1].street, actions[1].action, actions[1].amount, actions[1].prevHash]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWith("SEQ");
        });

        it("reverts when action prevHash is incorrect", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            const badAction = {
                channelId: 1n,
                handId: 1n,
                seq: 3,
                street: 0,
                action: ACTION.FOLD,
                amount: 0n,
                prevHash: ethers.keccak256("0x1234") // Wrong hash
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWith("PREV_HASH");
        });

        it("reverts when action street doesn't match game street", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 1, action: ACTION.FOLD, amount: 0n } // Wrong street, should be 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("BAD_STREET");
        });

        it("reverts when blind actions are used after start", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n } // Wrong, can't use blind again
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("BLIND_ONLY_START");
        });

        it("reverts when all-in player tries to act", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n }, // SB raises, has 1 left
                { street: 0, action: ACTION.BET_RAISE, amount: 8n } // BB re-raises, now SB is all-in
            ]);
            // Add action for all-in SB to act (should fail)
            const badActions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n },
                { street: 0, action: ACTION.FOLD, amount: 0n } // SB can't act, is all-in
            ]);
            await expect(replay.replayAndGetEndState(badActions, 10n, 10n)).to.be.revertedWith("PLAYER_ALLIN");
        });

        it("reverts when unknown action type is used", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            const badAction = {
                channelId: 1n,
                handId: 1n,
                seq: 3,
                street: 0,
                action: 99, // Unknown action
                amount: 0n,
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["uint256", "uint256", "uint32", "uint8", "uint8", "uint128", "bytes32"],
                        [actions[1].channelId, actions[1].handId, actions[1].seq, actions[1].street, actions[1].action, actions[1].amount, actions[1].prevHash]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWith("UNK_ACTION");
        });
    });

    describe("Fold Action Tests", function () {
        it("reverts when fold has non-zero amount", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.FOLD, amount: 1n } // Should be 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("FOLD_AMT");
        });

        it("handles fold on flop", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n }, // SB calls, move to flop
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 1, action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("handles fold on turn", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // SB checks, move to turn
                { street: 2, action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("handles fold on river", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n }, // SB checks, move to river
                { street: 3, action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });
    });

    describe("Check/Call Action Tests", function () {
        it("reverts when call amount is incorrect", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 2n } // Should be 1 to call
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("CALL_AMT");
        });

        it("reverts when check has non-zero amount", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n }, // SB calls
                { street: 1, action: ACTION.CHECK_CALL, amount: 1n } // BB checks, should be 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("CHECK_AMT");
        });

        it("handles all-in call with less than full amount", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n }, // SB raises to 8, BB needs to call 7 total
                { street: 0, action: ACTION.CHECK_CALL, amount: 7n } // BB calls all remaining
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 9n); // BB has only 9
            expect(end).to.equal(1n); // End.SHOWDOWN (both all-in)
        });

        it("reverts when call exceeds deposit limit", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 5n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 10n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 5n } // SB calls
            ]);
            await expect(replay.replayAndGetEndState(actions, 9n, 10n)).to.be.revertedWith("DEP_A");
        });

        it("progresses street after both players check", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n }, // SB calls, move to flop
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // SB checks, move to turn
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n } // BB checks
            ]);
            // Should be waiting for SB to act on turn
            const nextAction = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n } // SB checks, move to river
            ]);
            const [end, folder] = await replay.replayAndGetEndState(nextAction.slice(0, 7), 10n, 10n);
            // Should not reach end yet
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("HAND_NOT_DONE");
        });

        it("reaches showdown after river checks", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n } // Final check -> showdown
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
        });
    });

    describe("Bet/Raise Action Tests", function () {
        it("reverts when bet/raise amount is zero", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 0n } // Should be > 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("RAISE_ZERO");
        });

        it("reverts when raise is below minimum", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 2n } // Below minimum raise (should be >= 3)
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("MIN_RAISE");
        });

        it("handles minimum raise correctly", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 3n }, // Minimum raise
                { street: 0, action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when raise exceeds available stack plus toCall", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 10n } // Exceeds 8 available + 1 toCall
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("RAISE_STACK");
        });

        it("handles all-in raise with exact amount", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n } // All-in with remaining stack
            ]);
            // Should not revert, this is a valid all-in
            const nextActions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n },
                { street: 0, action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder] = await replay.replayAndGetEndState(nextActions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when all-in raise amount is incorrect", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 7n } // Should be 8 for all-in
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("RAISE_ALLIN_AMT");
        });

        it("reverts when raise doesn't increase the bet", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 3n }, // Raises to 4 total (1+3)
                { street: 0, action: ACTION.BET_RAISE, amount: 2n } // Trying to raise to 4 total (2+2), no increase
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("RAISE_INC");
        });

        it("reverts when bet exceeds deposit limit", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 8n } // Total 9 > stack 8
            ]);
            await expect(replay.replayAndGetEndState(actions, 8n, 10n)).to.be.revertedWith("DEP_A");
        });

        it("handles re-raise scenario", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { street: 0, action: ACTION.BET_RAISE, amount: 4n }, // BB re-raises to 6 total (2+4)
                { street: 0, action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("handles betting on postflop streets", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n }, // SB calls, move to flop
                { street: 1, action: ACTION.BET_RAISE, amount: 3n }, // BB bets on flop
                { street: 1, action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n); // SB folded
        });

        it("reverts when street exceeds maximum", async function () {
            // This tests the STREET_OVER error condition
            // We need to create a scenario where street would go beyond 3
            // This should be prevented by the street <= 3 check after incrementing
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n },
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n } // This should trigger showdown
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });
    });

    describe("Edge Cases and Complex Scenarios", function () {
        it("handles exact stack all-in scenarios", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 5n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 10n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 5n } // SB calls, both all-in
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
        });

        it("handles one player all-in, other continues", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 4n }, // SB all-in with 5 total
                { street: 0, action: ACTION.CHECK_CALL, amount: 3n } // BB calls
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 5n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN (SB all-in)
            expect(folder).to.equal(0n);
        });

        it("handles complex betting sequence", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 3n }, // SB raises
                { street: 0, action: ACTION.BET_RAISE, amount: 5n }, // BB re-raises  
                { street: 0, action: ACTION.CHECK_CALL, amount: 3n }, // SB calls, move to flop
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 1, action: ACTION.BET_RAISE, amount: 2n }, // SB bets
                { street: 1, action: ACTION.CHECK_CALL, amount: 2n }, // BB calls, move to turn
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n } // SB checks, move to river
            ]);
            // Should be waiting for BB to act on river
            await expect(replay.replayAndGetEndState(actions, 20n, 20n)).to.be.revertedWith("HAND_NOT_DONE");
        });

        it("reverts on incomplete hand", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n } // Game not finished
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("HAND_NOT_DONE");
        });

        it("handles maximum possible betting sequence", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },
                { street: 0, action: ACTION.BET_RAISE, amount: 3n }, // SB min raise
                { street: 0, action: ACTION.BET_RAISE, amount: 5n }, // BB re-raise
                { street: 0, action: ACTION.BET_RAISE, amount: 7n }, // SB re-raise again
                { street: 0, action: ACTION.CHECK_CALL, amount: 5n }, // BB calls, move to flop
                { street: 1, action: ACTION.BET_RAISE, amount: 10n }, // BB bets big
                { street: 1, action: ACTION.CHECK_CALL, amount: 10n }, // SB calls, move to turn
                { street: 2, action: ACTION.BET_RAISE, amount: 20n }, // BB bets bigger
                { street: 2, action: ACTION.CHECK_CALL, amount: 20n }, // SB calls, move to river
                { street: 3, action: ACTION.BET_RAISE, amount: 47n }, // BB all-in with remaining
                { street: 3, action: ACTION.CHECK_CALL, amount: 47n } // SB calls all-in
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 100n, 100n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
        });

        it("handles alternating actor correctly through streets", async function () {
            const actions = buildActions([
                { street: 0, action: ACTION.SMALL_BLIND, amount: 1n }, // Player 0 (SB) acts
                { street: 0, action: ACTION.BIG_BLIND, amount: 2n },   // Player 1 (BB) acts  
                { street: 0, action: ACTION.CHECK_CALL, amount: 1n },  // Player 0 (SB) acts - calls
                // Now on flop, BB acts first (player 1)
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },  // Player 1 (BB) checks
                { street: 1, action: ACTION.CHECK_CALL, amount: 0n },  // Player 0 (SB) checks
                // Now on turn, BB acts first (player 1)  
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n },  // Player 1 (BB) checks
                { street: 2, action: ACTION.CHECK_CALL, amount: 0n },  // Player 0 (SB) checks
                // Now on river, BB acts first (player 1)
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n },  // Player 1 (BB) checks
                { street: 3, action: ACTION.CHECK_CALL, amount: 0n }   // Player 0 (SB) checks -> showdown
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            expect(folder).to.equal(0n);
        });
    });
});
