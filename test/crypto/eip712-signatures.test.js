const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { domainSeparator, cardCommitDigest, actionDigest, handGenesis } = require("../helpers/hashes");
const { SLOT } = require("../helpers/slots");

describe("HeadsUpPokerEIP712", function () {
    let contract;

    const channelId = 7n;
    const mnemonic = "test test test test test test test test test test test junk";

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        const Helper = await ethers.getContractFactory("HeadsUpPokerEIP712");
        contract = await Helper.deploy();
    });

    it("recovers signer for Action", async function () {
        const action = {
            channelId,
            handId: 1n,
            seq: 1,
            action: ACTION.CHECK_CALL,
            amount: 100n,
            prevHash: handGenesis(channelId, 1n),
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = actionDigest(domSep, action);
        const wallet1 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/0");
        const sig = wallet1.signingKey.sign(digest).serialized;
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
            commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit")),
            prevHash: ethers.ZeroHash
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = cardCommitDigest(domSep, commit);
        const wallet2 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/1");
        const sig = wallet2.signingKey.sign(digest).serialized;
        const recovered = await contract.recoverCommitSigner(commit, sig);
        expect(recovered).to.equal(wallet2.address);
    });
});

