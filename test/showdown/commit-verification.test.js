const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZERO32, domainSeparator, cardCommitDigest } = require("../helpers/hashes");
const { SLOT } = require("../helpers/slots");
const { buildCardCommit, wallet1, wallet2, wallet3 } = require("../helpers/test-utils");

const EMPTY_CODES = Array(9).fill(0xff);
const EMPTY_SALTS = Array(9).fill(ZERO32);

describe("startShowdown & revealCards", function () {
    let escrow;
    let player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        await escrow.open(channelId, player2.address, 1n, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });

    async function setup() {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const dom = domainSeparator(escrow.target, chainId);

        const board = [1, 2, 3, 4, 5];
        const myHole = [10, 11];
        const oppHole = [20, 21];

        const commits = [];
        const sigs = [];
        const objs = [];

        const parts = [
            [SLOT.A1, myHole[0]],
            [SLOT.A2, myHole[1]],
            [SLOT.B1, oppHole[0]],
            [SLOT.B2, oppHole[1]],
            [SLOT.FLOP1, board[0]],
            [SLOT.FLOP2, board[1]],
            [SLOT.FLOP3, board[2]],
            [SLOT.TURN, board[3]],
            [SLOT.RIVER, board[4]],
        ];

        for (let i = 0; i < parts.length; i++) {
            const [slot, card] = parts[i];
            const obj = await buildCardCommit(
                wallet1,
                wallet2,
                dom,
                channelId,
                slot,
                card
            );
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            objs.push(obj);
        }

        const boardSalts = [
            objs[4].salt,
            objs[5].salt,
            objs[6].salt,
            objs[7].salt,
            objs[8].salt,
        ];
        const mySalts = [objs[0].salt, objs[1].salt];
        const oppSalts = [objs[2].salt, objs[3].salt];

        const startCodesP1 = [
            myHole[0],
            myHole[1],
            0xff,
            0xff,
            ...board,
        ];
        const startSaltsP1 = [
            mySalts[0],
            mySalts[1],
            ZERO32,
            ZERO32,
            ...boardSalts,
        ];

        const startCodesP2 = [
            0xff,
            0xff,
            oppHole[0],
            oppHole[1],
            ...board,
        ];
        const startSaltsP2 = [
            ZERO32,
            ZERO32,
            oppSalts[0],
            oppSalts[1],
            ...boardSalts,
        ];

        return {
            commits,
            sigs,
            board,
            boardSalts,
            myHole,
            mySalts,
            oppHole,
            oppSalts,
            objs,
            dom,
            startCodesP1,
            startSaltsP1,
            startCodesP2,
            startSaltsP2,
        };
    }

    // Table-driven tests for commit validation errors
    const commitValidationTests = [
        {
            name: "duplicate slot commit",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1, objs }) => {
                commits[3] = objs[2].cc;
                sigs[6] = objs[2].sigA;
                sigs[7] = objs[2].sigB;
                return { commits, sigs, codes: startCodesP1, salts: startSaltsP1 };
            },
            error: "CommitDuplicate",
            errorArgs: [2]
        },
        {
            name: "wrong channelId",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1 }) => {
                commits[0].channelId = channelId + 1n;
                return { commits, sigs, codes: startCodesP1, salts: startSaltsP1 };
            },
            error: "CommitWrongChannel",
            errorArgs: [0]
        },
        {
            name: "bad B signature",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1, objs, dom }) => {
                const digest = cardCommitDigest(dom, objs[2].cc);
                const badSig = wallet3.signingKey.sign(digest).serialized;
                sigs[5] = badSig; // B signature for commit index2
                return { commits, sigs, codes: startCodesP1, salts: startSaltsP1 };
            },
            error: "CommitWrongSignerB",
            errorArgs: [2]
        }
    ];

    commitValidationTests.forEach(test => {
        it(`reverts on ${test.name}`, async () => {
            const setupData = await setup();
            const { commits, sigs, codes, salts } = await test.setup(setupData);

            const expectation = expect(
                escrow.connect(player1).startShowdown(channelId, commits, sigs, codes, salts)
            ).to.be.revertedWithCustomError(escrow, test.error);

            if (test.errorArgs) {
                expectation.withArgs(...test.errorArgs);
            }
        });
    });

    it("allows partial commit sets", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1, startCodesP2, startSaltsP2 } = await setup();
        // Remove the last commit (river card)
        const partialCommits = commits.slice(0, -1);
        const partialSigs = sigs.slice(0, -2);
        let partialCodes = [...startCodesP1.slice(0, -1)];
        partialCodes[2] = startCodesP2[2];
        partialCodes[3] = startCodesP2[3];
        let partialSalts = [...startSaltsP1.slice(0, -1)];
        partialSalts[2] = startSaltsP2[2];
        partialSalts[3] = startSaltsP2[3];

        await escrow
            .connect(player1)
            .startShowdown(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

        const sd = await escrow.getShowdown(channelId);
        expect(sd.inProgress).to.equal(true);
        // Check that the commit mask reflects the partial set (all except river)
        expect(Number(sd.lockedCommitMask)).to.equal(0xFF); // bits 0..7 set
    });

    it("happy path stores hashes and cards", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();
        const tx = await escrow
            .connect(player1)
            .startShowdown(channelId, commits, sigs, startCodesP1, startSaltsP1);
        const rcpt = await tx.wait();
        const block = await ethers.provider.getBlock(rcpt.blockNumber);

        const sd = await escrow.getShowdown(channelId);
        expect(sd.initiator).to.equal(player1.address);
        expect(sd.opponent).to.equal(player2.address);
        expect(sd.inProgress).to.equal(true);
        const window = await escrow.revealWindow();
        expect(sd.deadline).to.equal(BigInt(block.timestamp) + window);
        expect(sd.cards.map(Number)).to.deep.equal(startCodesP1.map(Number));
    });

    it("allows submitting additional commits during reveal window", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1, startCodesP2, startSaltsP2, board, boardSalts } = await setup();

        // Start with partial commits (missing river card)
        const partialCommits = commits.slice(0, -1);
        const partialSigs = sigs.slice(0, -2);
        let partialCodes = [...startCodesP1.slice(0, -1)];
        partialCodes[2] = startCodesP2[2];
        partialCodes[3] = startCodesP2[3];
        let partialSalts = [...startSaltsP1.slice(0, -1)];
        partialSalts[2] = startSaltsP2[2];
        partialSalts[3] = startSaltsP2[3];

        await escrow
            .connect(player1)
            .startShowdown(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

        // Submit additional commit for river card
        const riverCommit = commits[8]; // River card commit
        const riverSigs = [sigs[16], sigs[17]]; // River card signatures

        await escrow
            .connect(player2)
            .revealCards(
                channelId,
                [riverCommit],
                [...riverSigs],
                [board[4]],
                [boardSalts[4]]
            );

        const sd = await escrow.getShowdown(channelId);
        expect(Number(sd.lockedCommitMask)).to.equal(0x1FF); // All slots now committed
    });

    it("allows finalize after deadline when opponent holes not opened", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();

        // Start with commits that don't include opponent holes
        const partialCommits = commits.slice(0, 2).concat(commits.slice(4)); // Skip opponent holes
        const partialSigs = [];
        for (let i = 0; i < 2; i++) {
            partialSigs.push(sigs[i * 2], sigs[i * 2 + 1]);
        }
        for (let i = 4; i < 9; i++) {
            partialSigs.push(sigs[i * 2], sigs[i * 2 + 1]);
        }
        const partialCodes = startCodesP1.slice(0, 2).concat(startCodesP1.slice(4));
        const partialSalts = startSaltsP1.slice(0, 2).concat(startSaltsP1.slice(4));

        await escrow
            .connect(player1)
            .startShowdown(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

        // finalize before deadline should revert
        await expect(escrow.finalizeShowdown(channelId)).to.be.revertedWithCustomError(
            escrow,
            "StillRevealing"
        );

        // Fast forward past reveal window
        await ethers.provider.send("evm_increaseTime", [3601]); // 1 hour + 1 second
        await ethers.provider.send("evm_mine");

        const [initialBalance,] = await escrow.stacks(channelId);

        // reveal after deadline should revert
        await expect(
            escrow
                .connect(player1)
                .revealCards(channelId, [], [], [...EMPTY_CODES], [...EMPTY_SALTS])
        ).to.be.revertedWithCustomError(escrow, "Expired");

        // Finalize - should forfeit to initiator (player1)
        await escrow.finalizeShowdown(channelId);

        const [finalBalance,] = await escrow.stacks(channelId);

        expect(finalBalance).to.be.greaterThan(initialBalance);
    });

    it("forfeits to initiator when both players reveal holes but board incomplete", async () => {
        const { commits, sigs, myHole, mySalts, oppHole, oppSalts } = await setup();

        const holeCommits = commits.slice(0, 4); // only hole cards
        const holeSigs = sigs.slice(0, 8);
        const codes = [...myHole, ...oppHole];
        const salts = [...mySalts, ...oppSalts];

        await escrow
            .connect(player1)
            .startShowdown(channelId, holeCommits, holeSigs, codes, salts);

        await ethers.provider.send("evm_increaseTime", [3601]);
        await ethers.provider.send("evm_mine");

        const [initialBalance,] = await escrow.stacks(channelId);

        await escrow.finalizeShowdown(channelId);

        const [finalBalance,] = await escrow.stacks(channelId);
        expect(finalBalance).to.be.greaterThan(initialBalance);
    });

    it("allows third party to start showdown on behalf of player1", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();
        const [, , thirdParty] = await ethers.getSigners();

        const tx = await escrow
            .connect(thirdParty)
            .startShowdownOnBehalfOf(channelId, commits, sigs, startCodesP1, startSaltsP1, player1.address);
        const rcpt = await tx.wait();
        const block = await ethers.provider.getBlock(rcpt.blockNumber);

        const sd = await escrow.getShowdown(channelId);
        expect(sd.initiator).to.equal(player1.address);
        expect(sd.opponent).to.equal(player2.address);
        expect(sd.inProgress).to.equal(true);
        const window = await escrow.revealWindow();
        expect(sd.deadline).to.equal(BigInt(block.timestamp) + window);
    });

    it("allows third party to start showdown on behalf of player2", async () => {
        const { commits, sigs, startCodesP2, startSaltsP2 } = await setup();
        const [, , thirdParty] = await ethers.getSigners();

        await escrow
            .connect(thirdParty)
            .startShowdownOnBehalfOf(channelId, commits, sigs, startCodesP2, startSaltsP2, player2.address);

        const sd = await escrow.getShowdown(channelId);
        expect(sd.initiator).to.equal(player2.address);
        expect(sd.opponent).to.equal(player1.address);
        expect(sd.inProgress).to.equal(true);
    });

    it("reverts when third party tries to start showdown for invalid player", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();
        const [, , thirdParty] = await ethers.getSigners();

        await expect(
            escrow
                .connect(thirdParty)
                .startShowdownOnBehalfOf(channelId, commits, sigs, startCodesP1, startSaltsP1, thirdParty.address)
        ).to.be.revertedWithCustomError(escrow, "NotPlayer");
    });

    it("allows third party to submit additional commits on behalf of player", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();
        const [, , thirdParty] = await ethers.getSigners();

        // Start with partial commits (missing river card)
        const partialCommits = commits.slice(0, -1);
        const partialSigs = sigs.slice(0, -2);
        const partialCodes = [...startCodesP1.slice(0, -1)];
        const partialSalts = [...startSaltsP1.slice(0, -1)];

        await escrow
            .connect(player1)
            .startShowdown(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

        // Third party submits additional commit for river card on behalf of player2
        const riverCommit = commits[8]; // River card commit
        const riverSigs = [sigs[16], sigs[17]]; // River card signatures

        await escrow
            .connect(thirdParty)
            .revealCardsOnBehalfOf(
                channelId,
                [riverCommit],
                [...riverSigs],
                [startCodesP1[8]],
                [startSaltsP1[8]],
                player2.address
            );

        const sd = await escrow.getShowdown(channelId);
        expect(Number(sd.lockedCommitMask)).to.equal(0x1F3); // All slots now committed
    });

    it("reverts when third party tries to submit commits for invalid player", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();
        const [, , thirdParty] = await ethers.getSigners();

        // Start showdown first
        await escrow
            .connect(player1)
            .startShowdown(channelId, commits, sigs, startCodesP1, startSaltsP1);

        // Third party tries to submit for invalid player
        await expect(
            escrow
                .connect(thirdParty)
                .revealCardsOnBehalfOf(
                    channelId,
                    [],
                    [],
                    [...EMPTY_CODES],
                    [...EMPTY_SALTS],
                    thirdParty.address
                )
        ).to.be.revertedWithCustomError(escrow, "NotPlayer");
    });

    it("rejects commit override with different hash", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1, dom } = await setup();

        // Start showdown with initial commits
        await escrow
            .connect(player1)
            .startShowdown(channelId, commits, sigs, startCodesP1, startSaltsP1);

        let sd = await escrow.getShowdown(channelId);
        expect(Number(sd.lockedCommitMask)).to.equal(0x1F3); // Player1 slots + board are committed

        // Create a new commit for slot 0 (player A, hole card 1)
        const newCommit = await buildCardCommit(
            wallet1,
            wallet2,
            dom,
            channelId,
            SLOT.A1,
            15 // different card
        );

        const overrideCodes = [15];
        const overrideSalts = [newCommit.salt];

        await escrow
            .connect(player1)
            .revealCards(
                channelId,
                [newCommit.cc],
                [newCommit.sigA, newCommit.sigB],
                overrideCodes,
                overrideSalts
            );

        // ignore override - hash is already locked
        sd = await escrow.getShowdown(channelId);
        expect(Number(sd.lockedCommitMask)).to.equal(0x1F3);
    });

    it("allows resubmitting identical commit", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();

        // Start showdown with initial commits
        await escrow
            .connect(player1)
            .startShowdown(channelId, commits, sigs, startCodesP1, startSaltsP1);

        let sd = await escrow.getShowdown(channelId);
        expect(Number(sd.lockedCommitMask)).to.equal(0x1F3); // Player1 slots + board are committed

        // Resubmit the exact same commit for slot 0
        const originalCommit = commits[0];
        const originalSigs = [sigs[0], sigs[1]];

        // This should succeed because locked commits are ignored
        await escrow
            .connect(player1)
            .revealCards(
                channelId,
                [originalCommit],
                originalSigs,
                [startCodesP1[0]],
                [startSaltsP1[0]]
            );

        // Verify the state is unchanged
        sd = await escrow.getShowdown(channelId);
        expect(Number(sd.lockedCommitMask)).to.equal(0x1F3);
    });

    // Table-driven tests for initiator hole card validation
    const initiatorValidationTests = [
        {
            name: "initiator does not provide both hole cards",
            player: "player1",
            setup: ({ commits, sigs, startCodesP1, startSaltsP1 }) => ({
                commits: commits.slice(2), // Skip player1's holes
                sigs: sigs.slice(4),
                codes: (() => {
                    const arr = startCodesP1.slice(2);
                    return arr;
                })(),
                salts: (() => {
                    const arr = startSaltsP1.slice(2);
                    return arr;
                })()
            })
        },
        {
            name: "initiator provides only one hole card",
            player: "player1",
            setup: ({ commits, sigs, startCodesP1, startSaltsP1 }) => ({
                commits: [commits[0]].concat(commits.slice(2)),
                sigs: [sigs[0], sigs[1]].concat(sigs.slice(4)),
                codes: (() => {
                    const arr = [startCodesP1[0]].concat(startCodesP1.slice(2));
                    return arr;
                })(),
                salts: (() => {
                    const arr = [startSaltsP1[0]].concat(startSaltsP1.slice(2));
                    arr[1] = ZERO32;
                    return arr;
                })()
            })
        },
        {
            name: "player2 initiator does not provide both hole cards",
            player: "player2",
            setup: ({ commits, sigs, startCodesP2, startSaltsP2 }) => ({
                commits: commits.slice(0, 2).concat(commits.slice(4)), // Skip player2's holes
                sigs: sigs.slice(0, 4).concat(sigs.slice(8)),
                codes: (() => {
                    const arr = startCodesP2.slice(0, 2).concat(startCodesP2.slice(4));
                    return arr;
                })(),
                salts: (() => {
                    const arr = startSaltsP2.slice(0, 2).concat(startSaltsP2.slice(4));
                    return arr;
                })()
            })
        }
    ];

    initiatorValidationTests.forEach(test => {
        it(`reverts when ${test.name}`, async () => {
            const setupData = await setup();
            const setup_result = test.setup({ ...setupData });

            const player = test.player === "player1" ? player1 : player2;

            await expect(
                escrow.connect(player).startShowdown(
                    channelId,
                    setup_result.commits,
                    setup_result.sigs,
                    setup_result.codes,
                    setup_result.salts
                )
            ).to.be.revertedWithCustomError(escrow, "InitiatorHolesRequired");
        });
    });
});
