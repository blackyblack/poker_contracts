const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./actions");

describe("HeadsUpPokerEIP712", function () {
    let contract;

    const channelId = 7n;
    const mnemonic = "test test test test test test test test test test test junk";

    const DOMAIN_TYPEHASH = ethers.keccak256(
        ethers.toUtf8Bytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,uint256 channelId)"
        )
    );
    const ACTION_TYPEHASH = ethers.keccak256(
        ethers.toUtf8Bytes(
            "Action(uint256 channelId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash)"
        )
    );
    const CARD_COMMIT_TYPEHASH = ethers.keccak256(
        ethers.toUtf8Bytes(
            "CardCommit(uint256 channelId,uint32 seq,uint8 role,uint8 index,bytes32 dealRef,bytes32 commitHash,bytes32 prevHash)"
        )
    );

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        const Helper = await ethers.getContractFactory("HeadsUpPokerEIP712");
        contract = await Helper.deploy();
    });

    function domainSeparator(chainId, verifyingContract, channelId) {
        const nameHash = ethers.keccak256(ethers.toUtf8Bytes("HeadsUpPoker"));
        const versionHash = ethers.keccak256(ethers.toUtf8Bytes("1"));
        return ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "bytes32", "bytes32", "uint256", "address", "uint256"],
                [DOMAIN_TYPEHASH, nameHash, versionHash, chainId, verifyingContract, channelId]
            )
        );
    }

    it("recovers signer for Action", async function () {
        const action = {
            channelId,
            seq: 1,
            action: ACTION.CHECK_CALL,
            amount: 100n,
            prevHash: ethers.ZeroHash
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(chainId, verifyingContract, channelId);
        const structHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "uint256", "uint32", "uint8", "uint128", "bytes32"],
                [
                    ACTION_TYPEHASH,
                    action.channelId,
                    action.seq,
                    action.action,
                    action.amount,
                    action.prevHash
                ]
            )
        );
        const digest = ethers.keccak256(
            ethers.concat([
                ethers.toUtf8Bytes("\x19\x01"),
                ethers.getBytes(domSep),
                ethers.getBytes(structHash)
            ])
        );
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
            seq: 2,
            role: 1,
            index: 0,
            dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal")),
            commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit")),
            prevHash: ethers.ZeroHash
        };

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const verifyingContract = await contract.getAddress();
        const domSep = domainSeparator(chainId, verifyingContract, channelId);
        const structHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                [
                    "bytes32",
                    "uint256",
                    "uint32",
                    "uint8",
                    "uint8",
                    "bytes32",
                    "bytes32",
                    "bytes32"
                ],
                [
                    CARD_COMMIT_TYPEHASH,
                    commit.channelId,
                    commit.seq,
                    commit.role,
                    commit.index,
                    commit.dealRef,
                    commit.commitHash,
                    commit.prevHash
                ]
            )
        );
        const digest = ethers.keccak256(
            ethers.concat([
                ethers.toUtf8Bytes("\x19\x01"),
                ethers.getBytes(domSep),
                ethers.getBytes(structHash)
            ])
        );
        const wallet2 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/1");
        const sig = wallet2.signingKey.sign(digest).serialized;
        const recovered = await contract.recoverCommitSigner(commit, sig);
        expect(recovered).to.equal(wallet2.address);
    });
});

