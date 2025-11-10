import { expect } from "chai";
import hre from "hardhat";
import { ACTION } from "../helpers/actions.js";
import { domainSeparator, actionDigest, handGenesis } from "../helpers/hashes.js";

const { ethers } = hre;

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

    beforeEach(async function () {
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
});
