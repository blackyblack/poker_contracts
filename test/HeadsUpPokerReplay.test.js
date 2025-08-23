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
        expect(folder).to.equal(ethers.ZeroAddress);
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
        expect(folder).to.equal(ethers.ZeroAddress);
    });

    it("reverts when big blind amount is incorrect", async function () {
        // big blind should be exactly twice the small blind
        const actions = buildActions([
            { street: 0, action: ACTION.SMALL_BLIND, amount: 1n },
            { street: 0, action: ACTION.BIG_BLIND, amount: 3n } // wrong amount
        ]);
        await expect(replay.replayAndGetEndState(actions, 10n, 10n)).to.be.revertedWith("BB_AMT");
    });
});
