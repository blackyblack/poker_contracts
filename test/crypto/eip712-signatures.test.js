const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions.js");
const { domainSeparator, cardCommitDigest, actionDigest, handGenesis } = require("../helpers/hashes.js");
const { SLOT } = require("../helpers/slots.js");

describe("HeadsUpPokerEIP712", function () {
    let contract;

    const channelId = 7n;
    const mnemonic = "test test test test test test test test test test test junk";
    const wallet1 = ethers.Wallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/0");

    async function actionSign(wallet, action) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = contract.address;
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = actionDigest(domSep, action);
        const sig = wallet._signingKey().signDigest(digest);
        return ethers.utils.joinSignature(sig);
    }

    async function cardSign(wallet, cardCommit) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = contract.address;
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = cardCommitDigest(domSep, cardCommit);
        const sig = wallet._signingKey().signDigest(digest);
        return ethers.utils.joinSignature(sig);
    }

    beforeEach(async function () {
        const Helper = await ethers.getContractFactory("HeadsUpPokerEIP712");
        contract = await Helper.deploy();
        await contract.deployed();
    });

    it("recovers signer for Action", async function () {
        const action = {
            channelId,
            handId: 1n,
            seq: 1,
            action: ACTION.CHECK_CALL,
            amount: 100n,
            prevHash: handGenesis(channelId, 1n),
            sender: wallet1.address
        };

        const sig = await actionSign(wallet1, action);
        const recovered = await contract.recoverActionSigner(action, sig);
        expect(recovered).to.equal(wallet1.address);

        const badAction = { ...action, channelId: channelId + 1n };
        const badRecovered = await contract.recoverActionSigner(badAction, sig);
        expect(badRecovered).to.not.equal(wallet1.address);
    });

    it("recovers signer for CardCommit", async function () {
        const commit = {
            channelId,
            handId: 1n,
            slot: SLOT.A2,
            commitHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("commit")),
            prevHash: ethers.constants.HashZero
        };

        const sig = await cardSign(wallet1, commit);
        const recovered = await contract.recoverCommitSigner(commit, sig);
        expect(recovered).to.equal(wallet1.address);
    });
});
