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
            "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash)"
        )
    );
    const CARD_COMMIT_TYPEHASH = ethers.keccak256(
        ethers.toUtf8Bytes(
            "CardCommit(uint256 channelId,uint256 handId,uint32 seq,uint8 role,uint8 index,bytes32 dealRef,bytes32 commitHash,bytes32 prevHash)"
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
            handId: 1n,
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
                ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32"],
                [
                    ACTION_TYPEHASH,
                    action.channelId,
                    action.handId,
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
            handId: 5n,
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
                    commit.handId,
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

    describe("verifyCoSignedCommits", function () {
        it("should verify commits with valid co-signatures from both roles", async function () {
            const [player1, player2] = await ethers.getSigners();
            
            // Create test commits - one for each role for slot 0
            const commits = [
                {
                    channelId,
                    handId: 1n,
                    seq: 1,
                    role: 0, // Player 1
                    index: 0, // slot 0
                    dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal1")),
                    commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit1")),
                    prevHash: ethers.ZeroHash
                },
                {
                    channelId,
                    handId: 1n,
                    seq: 2,
                    role: 1, // Player 2
                    index: 0, // same slot 0
                    dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal1")),
                    commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit1")), // Same commitHash for the slot
                    prevHash: ethers.ZeroHash
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const verifyingContract = await contract.getAddress();
            const domSep = domainSeparator(chainId, verifyingContract, channelId);

            // Create signatures for each commit (one signature per commit)
            const sigs = [];
            const wallet1 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/0");
            const wallet2 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/1");
            const wallets = [wallet1, wallet2];

            for (let i = 0; i < commits.length; i++) {
                const commit = commits[i];
                const structHash = ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        [
                            "bytes32", "uint256", "uint256", "uint32", "uint8", "uint8",
                            "bytes32", "bytes32", "bytes32"
                        ],
                        [
                            CARD_COMMIT_TYPEHASH,
                            commit.channelId,
                            commit.handId,
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

                // Each commit signed by the corresponding wallet (role-based)
                sigs.push(wallets[commit.role].signingKey.sign(digest).serialized);
            }

            const result = await contract.verifyCoSignedCommits(commits, sigs);
            expect(result.slots).to.deep.equal([0]);
            expect(result.commitHashes[0]).to.equal(commits[0].commitHash);
        });

        it("should reject commits with mismatched slots", async function () {
            const commits = [
                {
                    channelId,
                    handId: 1n,
                    seq: 1,
                    role: 0,
                    index: 0, // slot 0
                    dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal1")),
                    commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit1")),
                    prevHash: ethers.ZeroHash
                },
                {
                    channelId,
                    handId: 1n,
                    seq: 2,
                    role: 1,
                    index: 1, // Different slot - should fail
                    dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal2")),
                    commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit2")),
                    prevHash: ethers.ZeroHash
                }
            ];

            const sigs = ["0x00", "0x00"]; // Dummy sigs for this test
            await expect(contract.verifyCoSignedCommits(commits, sigs))
                .to.be.revertedWith("SLOT_MISMATCH");
        });

        it("should reject commits with wrong signature count", async function () {
            const commits = [{
                channelId,
                handId: 1n,
                seq: 1,
                role: 0,
                index: 0,
                dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal1")),
                commitHash: ethers.keccak256(ethers.toUtf8Bytes("commit1")),
                prevHash: ethers.ZeroHash
            }];

            const sigs = ["0x00"]; // Odd number
            await expect(contract.verifyCoSignedCommits(commits, sigs))
                .to.be.revertedWith("MUST_HAVE_PAIRS");
        });
    });

    describe("checkOpen", function () {
        beforeEach(async function () {
            // First verify some commits so we have data to check against
            const testCards = ethers.toUtf8Bytes("test cards");
            const commits = [
                {
                    channelId,
                    handId: 1n,
                    seq: 1,
                    role: 0,
                    index: 5, // slot 5
                    dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal1")),
                    commitHash: ethers.keccak256(ethers.concat([testCards, ethers.ZeroHash])),
                    prevHash: ethers.ZeroHash
                },
                {
                    channelId,
                    handId: 1n,
                    seq: 2,
                    role: 1,
                    index: 5, // same slot 5
                    dealRef: ethers.keccak256(ethers.toUtf8Bytes("deal1")),
                    commitHash: ethers.keccak256(ethers.concat([testCards, ethers.ZeroHash])),
                    prevHash: ethers.ZeroHash
                }
            ];

            const chainId = (await ethers.provider.getNetwork()).chainId;
            const verifyingContract = await contract.getAddress();
            const domSep = domainSeparator(chainId, verifyingContract, channelId);

            const wallet1 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/0");
            const wallet2 = ethers.Wallet.fromPhrase(mnemonic, "m/44'/60'/0'/0/1");
            const wallets = [wallet1, wallet2];

            const sigs = [];
            for (let i = 0; i < commits.length; i++) {
                const commit = commits[i];
                const structHash = ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        [
                            "bytes32", "uint256", "uint256", "uint32", "uint8", "uint8",
                            "bytes32", "bytes32", "bytes32"
                        ],
                        [
                            CARD_COMMIT_TYPEHASH,
                            commit.channelId,
                            commit.handId,
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

                sigs.push(wallets[commit.role].signingKey.sign(digest).serialized);
            }

            await contract.verifyCoSignedCommits(commits, sigs);
        });

        it("should return true for correct card reveal", async function () {
            const code = ethers.toUtf8Bytes("test cards");
            const salt = ethers.ZeroHash;
            
            const result = await contract.checkOpen(5, code, salt);
            expect(result).to.be.true;
        });

        it("should return false for incorrect card reveal", async function () {
            const code = ethers.toUtf8Bytes("wrong cards");
            const salt = ethers.ZeroHash;
            
            const result = await contract.checkOpen(5, code, salt);
            expect(result).to.be.false;
        });

        it("should revert for non-existent slot", async function () {
            const code = ethers.toUtf8Bytes("any cards");
            const salt = ethers.ZeroHash;
            
            await expect(contract.checkOpen(99, code, salt))
                .to.be.revertedWith("NO_COMMIT");
        });
    });
});

