const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./actions");

const GENESIS = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256", "uint256"], ["HUP_GENESIS", 1n, 1n]));

const ACTION_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
        "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash)"
    )
);

// Helper to build actions with proper hashes and sequence numbers
function buildActions(specs) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const channelId = 1n;
    const handId = 1n;
    let seq = 0;
    let prevHash = GENESIS;
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
        prevHash = ethers.keccak256(
            abi.encode(
                ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32"],
                [
                    ACTION_TYPEHASH,
                    act.channelId,
                    act.handId,
                    act.seq,
                    act.action,
                    act.amount,
                    act.prevHash
                ]
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
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const stackA = 10n;
            const stackB = 10n;
            const [end, folder] = await replay.replayAndGetEndState(actions, stackA, stackB);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(0n);
        });

        it("returns fold when big blind folds preflop", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB makes min raise (1->4)
                { action: ACTION.FOLD, amount: 0n } // BB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
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
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
            // showdown always has 0 as folder, do not test it further
            expect(folder).to.equal(0n);
        });

        it("reaches showdown when both players are all-in", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 9n }, // SB goes all-in
                { action: ACTION.CHECK_CALL, amount: 0n } // BB calls
            ]);
            const [end] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });
    });

    describe("Validation Tests - Blind Setup", function () {
        it("reverts when no actions provided", async function () {
            const actions = [];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("NO_BLINDS");
        });

        it("reverts when small blind sequence is wrong", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 2,
                    action: ACTION.SMALL_BLIND,
                    amount: 1n,
                    prevHash: GENESIS
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 3,
                    action: ACTION.BIG_BLIND,
                    amount: 2n,
                    prevHash: GENESIS
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_SEQ");
        });

        it("reverts when only one action provided", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("NO_BLINDS");
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
                    prevHash: GENESIS
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_PREV");
        });

        it("reverts when small blind action is wrong", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 0,
                    action: ACTION.BIG_BLIND, // Should be SMALL_BLIND
                    amount: 1n,
                    prevHash: GENESIS
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.BIG_BLIND,
                    amount: 1n,
                    prevHash: GENESIS
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_ACT");
        });

        it("reverts when small blind amount is zero", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 0,
                    action: ACTION.SMALL_BLIND,
                    amount: 0n, // Should be > 0
                    prevHash: GENESIS
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.BIG_BLIND,
                    amount: 1n,
                    prevHash: GENESIS
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_AMT");
        });

        it("reverts when small blind amount exceeds stack", async function () {
            const actions = [
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 0,
                    action: ACTION.SMALL_BLIND,
                    amount: 11n, // Exceeds stack of 10
                    prevHash: GENESIS
                },
                {
                    channelId: 1n,
                    handId: 1n,
                    seq: 1,
                    action: ACTION.BIG_BLIND,
                    amount: 1n,
                    prevHash: GENESIS
                }
            ];
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("SB_AMT");
        });

        it("reverts when big blind sequence is wrong", async function () {
            const sbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: GENESIS
            };
            const bbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 0, // Same seq, should be greater
                action: ACTION.BIG_BLIND,
                amount: 2n,
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32"],
                        [
                            ACTION_TYPEHASH,
                            sbAction.channelId,
                            sbAction.handId,
                            sbAction.seq,
                            sbAction.action,
                            sbAction.amount,
                            sbAction.prevHash
                        ]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([sbAction, bbAction], 10n, 10n)).to.be.revertedWith("BB_SEQ");
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
            await expect(replay.replayAndGetEndState([actions[0], badBB], 10n, 10n)).to.be.revertedWith("BB_PREV");
        });

        it("reverts when big blind action is wrong", async function () {
            const sbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 0,
                action: ACTION.SMALL_BLIND,
                amount: 1n,
                prevHash: GENESIS
            };
            const bbAction = {
                channelId: 1n,
                handId: 1n,
                seq: 1,
                action: ACTION.FOLD, // Should be BIG_BLIND
                amount: 2n,
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32"],
                        [
                            ACTION_TYPEHASH,
                            sbAction.channelId,
                            sbAction.handId,
                            sbAction.seq,
                            sbAction.action,
                            sbAction.amount,
                            sbAction.prevHash
                        ]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([sbAction, bbAction], 10n, 10n)).to.be.revertedWith("BB_ACT");
        });

        it("reverts when big blind amount is incorrect", async function () {
            // big blind should be exactly twice the small blind
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 3n } // wrong amount
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("BB_AMT");
        });

        it("reverts when big blind amount exceeds stack", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n }
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 1n)).to.be.revertedWith("BB_STACK");
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
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32"],
                        [
                            ACTION_TYPEHASH,
                            actions[1].channelId,
                            actions[1].handId,
                            actions[1].seq,
                            actions[1].action,
                            actions[1].amount,
                            actions[1].prevHash
                        ]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWith("SEQ");
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
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWith("PREV_HASH");
        });

        it("reverts when blind actions are used after start", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.SMALL_BLIND, amount: 1n } // Wrong, can't use blind again
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("BLIND_ONLY_START");
        });

        it("reverts when all-in player tries to act", async function () {
            const badActions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.FOLD, amount: 0n }, // trying to act after all-in
            ]);
            await expect(replay.replayAndGetEndState(badActions, 5n, 10n)).to.be.revertedWith("PLAYER_ALLIN");
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
                prevHash: ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32"],
                        [
                            ACTION_TYPEHASH,
                            actions[1].channelId,
                            actions[1].handId,
                            actions[1].seq,
                            actions[1].action,
                            actions[1].amount,
                            actions[1].prevHash
                        ]
                    )
                )
            };
            await expect(replay.replayAndGetEndState([...actions, badAction], 10n, 10n)).to.be.revertedWith("UNK_ACTION");
        });
    });

    describe("Fold Action Tests", function () {
        it("reverts when fold has non-zero amount", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 1n } // Should be 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("FOLD_AMT");
        });

        it("handles fold on flop", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to flop
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
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
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
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
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
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
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("CALL_AMT");
        });

        it("handles all-in call with correct amount", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 9n }, // SB all-in, BB needs to call 8 total
                { action: ACTION.CHECK_CALL, amount: 0n } // BB calls with amount 0
            ]);
            const [end] = await replay.replayAndGetEndState(actions, 10n, 9n); // BB has only 9
            expect(end).to.equal(1n); // End.SHOWDOWN (both all-in)
        });

        it("automatically goes all-in when insufficient chips to call", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB auto all-in with remaining 4 chips
            ]);
            const [end] = await replay.replayAndGetEndState(actions, 9n, 11n); // SB has only 9 total, 4 remaining
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
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("HAND_NOT_DONE");
            // Hand is OK so far, but still not done
            await expect(replay.replayAndGetEndState(nextAction, 10n, 10n)).to.be.revertedWith("HAND_NOT_DONE");
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
            const [end] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("correctly calculates all-in amount when player has exactly enough", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB calls with exactly 5 remaining
            ]);
            const [end] = await replay.replayAndGetEndState(actions, 10n, 10n); // SB has exactly 10, 5 remaining after blind
            expect(end).to.equal(1n); // End.SHOWDOWN
        });

        it("handles call when player has more than enough chips", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n } // SB has plenty of chips to call 1
            ]);
            await expect(replay.replayAndGetEndState(actions, 100n, 100n)).to.be.revertedWith("HAND_NOT_DONE");
        });
    });

    describe("Bet/Raise Action Tests", function () {
        it("reverts when bet/raise amount is zero", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 0n } // Should be > 0
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("RAISE_ZERO");
        });

        it("reverts when raise is below minimum", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 2n } // Below minimum raise (should be >= 3)
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("MIN_RAISE");
        });

        it("handles minimum raise correctly", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // Minimum raise
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when raise exceeds available stack plus toCall", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 11n } // Exceeds 9 available + 1 toCall
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("RAISE_STACK");
        });

        it("handles all-in raise with exact amount", async function () {
            // Should not revert, this is a valid all-in
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n }, // All-in with remaining stack
                { action: ACTION.FOLD, amount: 0n }
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(0n); // End.FOLD
            expect(folder).to.equal(1n); // BB folded
        });

        it("reverts when all-in raise amount is incorrect", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 5n },
                { action: ACTION.BIG_BLIND, amount: 10n },
                { action: ACTION.BET_RAISE, amount: 4n } // Should be 5 to go all-in (5+4=9 total
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("RAISE_INC");
        });

        it("reverts when raise doesn't increase the bet", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 2n }, // Raises to 3 total (1+2)
                { action: ACTION.BET_RAISE, amount: 1n } // Trying to raise to 3 total (2+1), no increase
            ]);
            await expect(replay.replayAndGetEndState(actions, 3n, 10n)).to.be.revertedWith("RAISE_INC");
        });

        it("reverts when bet exceeds deposit limit", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 8n } // Total 9 > stack 8
            ]);
            await expect(replay.replayAndGetEndState(actions, 8n, 10n)).to.be.revertedWith("RAISE_STACK");
        });

        it("handles re-raise scenario with underraised bet", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { action: ACTION.BET_RAISE, amount: 3n }, // BB re-raises to 5 total (2+3)
            ]);
            // This should revert since the re-raise must be at least the size of the previous raise (2)
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("MIN_RAISE");
        });

        it("handles re-raise scenario", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB raises to 4 total
                { action: ACTION.BET_RAISE, amount: 5n }, // BB re-raises to 7 total (2+5)
                { action: ACTION.FOLD, amount: 0n } // SB folds
            ]);
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
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
            const [end, folder] = await replay.replayAndGetEndState(actions, 10n, 10n);
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
            await expect(replay.replayAndGetEndState(actions, 3n, 10n)).to.be.revertedWith("NO_REOPEN");
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
            await expect(replay.replayAndGetEndState(actions, 20n, 20n)).to.be.revertedWith("HAND_NOT_DONE");
        });

        it("reverts on incomplete hand", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.CHECK_CALL, amount: 0n } // Game not finished
            ]);
            await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("HAND_NOT_DONE");
        });

        // TODO: this might be longer, limit betting rounds in contract
        it("handles maximum possible betting sequence", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.BET_RAISE, amount: 3n }, // SB min raise
                { action: ACTION.BET_RAISE, amount: 5n }, // BB re-raise
                { action: ACTION.BET_RAISE, amount: 7n }, // SB re-raise again
                { action: ACTION.CHECK_CALL, amount: 0n }, // BB calls, move to turn
                { action: ACTION.BET_RAISE, amount: 10n }, // BB bets bigger
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to river
                { action: ACTION.BET_RAISE, amount: 20n }, // BB bets bigger
                { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls, move to river
                { action: ACTION.BET_RAISE, amount: 47n }, // BB all-in with remaining
                { action: ACTION.CHECK_CALL, amount: 0n } // SB calls all-in
            ]);
            const [end] = await replay.replayAndGetEndState(actions, 100n, 88n);
            expect(end).to.equal(1n); // End.SHOWDOWN
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
            const [end] = await replay.replayAndGetEndState(actions, 10n, 10n);
            expect(end).to.equal(1n); // End.SHOWDOWN
        });
    });
});
