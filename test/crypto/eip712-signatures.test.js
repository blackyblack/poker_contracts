import { expect } from "chai";
import { ethers } from "hardhat";
import { ACTION } from "../helpers/actions.js";
import { domainSeparator, cardCommitDigest, actionDigest, handGenesis } from "../helpers/hashes.js";
import { SLOT } from "../helpers/slots.js";

describe("HeadsUpPokerEIP712", function () {
    let contract;

    const channelId = 7n;
    const mnemonic = "test test test test test test test test test test test junk";
    const wallet1 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/0");

    async function actionSign(wallet, action) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = actionDigest(domSep, action);
        return wallet.signingKey.sign(digest).serialized;
    }

    async function cardSign(wallet, cardCommit) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(verifyingContract, chainId);
        const digest = cardCommitDigest(domSep, cardCommit);
        return wallet.signingKey.sign(digest).serialized;
    }

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
            commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit")),
            prevHash: ethers.ZeroHash
        };

        const sig = await cardSign(wallet1, commit);
        const recovered = await contract.recoverCommitSigner(commit, sig);
        expect(recovered).to.equal(wallet1.address);
    });
});
