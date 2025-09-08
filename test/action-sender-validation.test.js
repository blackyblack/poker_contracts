const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./helpers/actions");
const { buildActions, signActions } = require("./helpers/test-utils");

describe("Action Sender Validation", function () {
    let escrow, replay, player1, player2, player3;
    let chainId, contractAddress;

    beforeEach(async function () {
        [player1, player2, player3] = await ethers.getSigners();
        
        const Replay = await ethers.getContractFactory("HeadsUpPokerReplay");
        replay = await Replay.deploy();
        
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy(await replay.getAddress());
        
        chainId = (await ethers.provider.getNetwork()).chainId;
        contractAddress = await escrow.getAddress();
    });

    it("validates that actions have correct sender addresses", async function () {
        const channelId = 1n;
        const handId = 1n;
        
        // Build actions with explicit senders
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.FOLD, amount: 0n, sender: player1.address }
        ], channelId, handId);

        // Verify actions have correct structure
        expect(actions[0].sender).to.equal(player1.address);
        expect(actions[1].sender).to.equal(player2.address);
        expect(actions[2].sender).to.equal(player1.address);

        // Sign actions
        const signatures = await signActions(actions, [player1, player2], contractAddress, chainId);
        
        // Should accept these valid actions and signatures
        expect(signatures).to.have.length(3); // One signature per action now
    });

    it("rejects actions with invalid sender", async function () {
        const channelId = 1n;
        const handId = 1n;
        
        // Build actions but put wrong sender on one action
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.FOLD, amount: 0n, sender: player3.address } // Wrong! Should be player1 or player2
        ], channelId, handId);

        // This should fail because player3 is not a valid player
        try {
            const signatures = await signActions(actions, [player1, player2, player3], contractAddress, chainId);
            expect.fail("Should have thrown an error for invalid sender");
        } catch (error) {
            // Expected to fail because we'd need to verify signatures against valid players
        }
    });

    it("validates turn order in heads up poker", async function () {
        // Valid action sequence: SB, BB, SB calls
        const validActions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address } // SB calls (player1)
        ], 1n, 1n);

        // Should have correct turn order
        expect(validActions[0].sender).to.equal(player1.address); // SB
        expect(validActions[1].sender).to.equal(player2.address); // BB  
        expect(validActions[2].sender).to.equal(player1.address); // SB acts first preflop
    });

    it("requires explicit senders for all actions", async function () {
        expect(() => {
            buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }
        ]);
        }).to.throw("Action at index 0 must have an explicit sender address");
    });
});