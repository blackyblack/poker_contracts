// Focused test for the new fold settlement behavior
// Testing the won amount calculation specifically

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Copy helper functions from main test file
const ACTION = {
    SMALL_BLIND: 0,
    BIG_BLIND: 1,
    CHECK_CALL: 2,
    BET_RAISE: 3,
    FOLD: 4
};

function buildActions(actionData, channelId, handId) {
    const actions = [];
    let prevHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint256", "uint256"], ["HUP_GENESIS", channelId, handId]));
    
    for (let i = 0; i < actionData.length; i++) {
        const action = {
            channelId: channelId,
            handId: handId,
            seq: i,
            prevHash: prevHash,
            action: actionData[i].action,
            amount: actionData[i].amount
        };
        
        actions.push(action);
        
        // Calculate next prevHash
        prevHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "uint256", "uint256", "bytes32", "uint8", "uint256"],
            [action.channelId, action.handId, action.seq, action.prevHash, action.action, action.amount]
        ));
    }
    
    return actions;
}

async function signActions(actions, wallets, contractAddress, chainId) {
    const signatures = [];
    
    for (const action of actions) {
        for (const wallet of wallets) {
            const domain = {
                name: "HeadsUpPoker",
                version: "1",
                chainId: chainId,
                verifyingContract: contractAddress
            };
            
            const types = {
                Action: [
                    { name: "channelId", type: "uint256" },
                    { name: "handId", type: "uint256" },
                    { name: "seq", type: "uint256" },
                    { name: "prevHash", type: "bytes32" },
                    { name: "action", type: "uint8" },
                    { name: "amount", type: "uint256" }
                ]
            };
            
            const signature = await wallet.signTypedData(domain, types, action);
            signatures.push(signature);
        }
    }
    
    return signatures;
}

describe("HeadsUpPokerEscrow - Won Amount Settlement", function () {
    let escrow;
    let replay;
    let player1, player2;
    let wallet1, wallet2;
    let chainId;
    
    const channelId = 100n;
    const handId = 1n;
    const deposit = ethers.parseEther("1.0"); // 1 ETH each
    
    before(async function () {
        chainId = (await ethers.provider.getNetwork()).chainId;
        
        [player1, player2] = await ethers.getSigners();
        wallet1 = player1;
        wallet2 = player2;
        
        // Deploy replay contract
        const HeadsUpPokerReplay = await ethers.getContractFactory("HeadsUpPokerReplay");
        replay = await HeadsUpPokerReplay.deploy();
        
        // Deploy escrow contract
        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy(await replay.getAddress());
    });
    
    beforeEach(async function () {
        // Open and join channel with 1 ETH each
        await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });
    
    afterEach(async function () {
        // Clean up by withdrawing if possible
        try {
            await escrow.connect(player1).withdraw(channelId);
            await escrow.connect(player2).withdraw(channelId);
        } catch (e) {
            // Ignore errors if nothing to withdraw
        }
    });
    
    it("should transfer only the won amount when player2 folds", async function () {
        // Scenario: Player1 posts small blind, Player2 posts big blind and folds
        // Player1 contributes: 0.01 ETH (small blind)
        // Player2 contributes: 0.02 ETH (big blind), then folds
        // Expected won amount: 0.02 ETH (what player2 contributed)
        
        const smallBlind = ethers.parseEther("0.01");
        const bigBlind = ethers.parseEther("0.02");
        
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: smallBlind },
            { action: ACTION.BIG_BLIND, amount: bigBlind },
            { action: ACTION.FOLD, amount: 0n } // Big blind folds
        ], channelId, handId);
        
        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        
        const tx = await escrow.settleFold(channelId, actions, signatures);
        
        // Should emit the won amount (what the folder contributed)
        await expect(tx)
            .to.emit(escrow, "FoldSettled")
            .withArgs(channelId, player1.address, bigBlind);
        
        // Check final deposits
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        
        // Player1 should get their original deposit + won amount
        expect(p1Stack).to.equal(deposit + bigBlind);
        // Player2 should get their original deposit - won amount  
        expect(p2Stack).to.equal(deposit - bigBlind);
        
        // Total should be conserved
        expect(p1Stack + p2Stack).to.equal(deposit * 2n);
    });
    
    it("should transfer only the won amount when player1 folds", async function () {
        // Scenario: Player1 posts small blind and folds immediately
        // Player1 contributes: 0.01 ETH (small blind), then folds
        // Player2 contributes: 0.02 ETH (big blind)
        // Expected won amount: 0.01 ETH (what player1 contributed)
        
        const smallBlind = ethers.parseEther("0.01");
        const bigBlind = ethers.parseEther("0.02");
        
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: smallBlind },
            { action: ACTION.BIG_BLIND, amount: bigBlind },
            { action: ACTION.FOLD, amount: 0n } // Small blind folds
        ], channelId, handId);
        
        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        
        const tx = await escrow.settleFold(channelId, actions, signatures);
        
        // Should emit the won amount (what the folder contributed)
        await expect(tx)
            .to.emit(escrow, "FoldSettled")
            .withArgs(channelId, player2.address, smallBlind);
        
        // Check final deposits
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        
        // Player1 should get their original deposit - won amount
        expect(p1Stack).to.equal(deposit - smallBlind);
        // Player2 should get their original deposit + won amount
        expect(p2Stack).to.equal(deposit + smallBlind);
        
        // Total should be conserved
        expect(p1Stack + p2Stack).to.equal(deposit * 2n);
    });
    
    it("should handle larger bets correctly", async function () {
        // Scenario: More realistic poker with bigger bets
        // Player1 posts small blind, Player2 posts big blind, Player1 raises, Player2 folds
        
        const smallBlind = ethers.parseEther("0.05");  // 0.05 ETH
        const bigBlind = ethers.parseEther("0.10");    // 0.10 ETH
        const raiseAmount = ethers.parseEther("0.20");  // 0.20 ETH
        
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: smallBlind },
            { action: ACTION.BIG_BLIND, amount: bigBlind },
            { action: ACTION.BET_RAISE, amount: raiseAmount }, // Small blind raises
            { action: ACTION.FOLD, amount: 0n } // Big blind folds
        ], channelId, handId);
        
        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        
        const tx = await escrow.settleFold(channelId, actions, signatures);
        
        // Player2 contributed only the big blind (0.10 ETH) before folding
        const expectedWonAmount = bigBlind;
        
        await expect(tx)
            .to.emit(escrow, "FoldSettled")
            .withArgs(channelId, player1.address, expectedWonAmount);
        
        // Check final deposits
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        
        expect(p1Stack).to.equal(deposit + expectedWonAmount);
        expect(p2Stack).to.equal(deposit - expectedWonAmount);
        expect(p1Stack + p2Stack).to.equal(deposit * 2n);
    });
});