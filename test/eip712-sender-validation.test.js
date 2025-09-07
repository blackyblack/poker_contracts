const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./helpers/actions");
const { domainSeparator, actionDigest, handGenesis } = require("./helpers/hashes");

describe("HeadsUpPokerEIP712 with Sender", function () {
    let contract, player1, player2;
    const channelId = 7n;
    const mnemonic = "test test test test test test test test test test test junk";

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        const Helper = await ethers.getContractFactory("HeadsUpPokerEIP712");
        contract = await Helper.deploy();
    });

    it("recovers signer for Action with sender field", async function () {
        const wallet1 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/0");
        
        const action = {
            channelId,
            handId: 1n,
            seq: 1,
            action: ACTION.CHECK_CALL,
            amount: 100n,
            prevHash: handGenesis(channelId, 1n),
            sender: wallet1.address
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = actionDigest(domSep, action);
        const sig = wallet1.signingKey.sign(digest).serialized;
        const recovered = await contract.recoverActionSigner(action, sig);
        
        expect(recovered).to.equal(wallet1.address);
    });

    it("fails to verify action signed by different address than sender", async function () {
        const wallet1 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/0");
        const wallet2 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/1");
        
        const action = {
            channelId,
            handId: 1n,
            seq: 1,
            action: ACTION.CHECK_CALL,
            amount: 100n,
            prevHash: handGenesis(channelId, 1n),
            sender: wallet1.address  // Action claims to be from wallet1
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = actionDigest(domSep, action);
        const sig = wallet2.signingKey.sign(digest).serialized; // But signed by wallet2
        const recovered = await contract.recoverActionSigner(action, sig);
        
        expect(recovered).to.not.equal(wallet1.address);
        expect(recovered).to.equal(wallet2.address);
    });

    it("correctly includes sender in action digest", async function () {
        const wallet1 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/0");
        
        const action1 = {
            channelId,
            handId: 1n,
            seq: 1,
            action: ACTION.CHECK_CALL,
            amount: 100n,
            prevHash: handGenesis(channelId, 1n),
            sender: wallet1.address
        };

        const action2 = {
            ...action1,
            sender: player1.address  // Different sender
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(verifyingContract, chainId);
        
        const digest1 = actionDigest(domSep, action1);
        const digest2 = actionDigest(domSep, action2);
        
        // Different senders should produce different digests
        expect(digest1).to.not.equal(digest2);
    });
});