const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { SLOT } = require("../helpers/slots");
const { CARD } = require("../helpers/cards");
const { buildActions, signActions, wallet1, wallet2, buildCardCommit, playPlayer1WinsShowdown } = require("../helpers/test-utils");
const { domainSeparator } = require("../helpers/hashes");

describe("Commit Verification - revealCards", function () {
    let escrow, player1, player2;
    let chainId;
    const channelId = 1n;
    const deposit = 10n;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();

        // Open channel and join
        await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });

    async function setup() {
        // Generate domain separator
        const dom = domainSeparator(await escrow.getAddress(), chainId);

        // Generate all card commits (slots 0-8: A1, A2, B1, B2, FLOP1, FLOP2, FLOP3, TURN, RIVER)
        const objs = [];
        for (let i = 0; i < 9; i++) {
            const card = 2 + i; // Cards 2-10
            const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, i, card);
            objs.push(obj);
        }

        const commits = objs.map(obj => obj.cc);
        const sigs = objs.flatMap(obj => [obj.sigA, obj.sigB]);

        // Player 1's cards (slots 0, 1, 4, 5, 6, 7, 8 for A1, A2, FLOP1, FLOP2, FLOP3, TURN, RIVER)
        const startCodesP1 = [2, 3, 0xFF, 0xFF, 6, 7, 8, 9, 10]; // 0xFF means not revealing
        const startSaltsP1 = objs.map(obj => obj.salt);

        // Player 2's cards (slots 2, 3 for B1, B2)
        const startCodesP2 = [0xFF, 0xFF, 4, 5, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
        const startSaltsP2 = objs.map(obj => obj.salt);

        // Hole cards only
        const myHole = [startCodesP1[0], startCodesP1[1]];  // Player1's holes
        const mySalts = [startSaltsP1[0], startSaltsP1[1]];
        const oppHole = [startCodesP2[2], startCodesP2[3]]; // Player2's holes  
        const oppSalts = [startSaltsP2[2], startSaltsP2[3]];

        // Board cards
        const board = [6, 7, 8, 9, 10];
        const boardSalts = [startSaltsP1[4], startSaltsP1[5], startSaltsP1[6], startSaltsP1[7], startSaltsP1[8]];

        return {
            commits,
            sigs,
            startCodesP1,
            startSaltsP1,
            startCodesP2,
            startSaltsP2,
            myHole,
            mySalts,
            oppHole,
            oppSalts,
            board,
            boardSalts,
            objs,
            dom
        };
    }

    const EMPTY_CODES = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    const EMPTY_SALTS = ["0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(32)];

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
            errorArgs: [2],
        },
        {
            name: "wrong channelId",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1 }) => {
                commits[0].channelId = channelId + 1n;
                return { commits, sigs, codes: startCodesP1, salts: startSaltsP1 };
            },
            error: "CommitWrongChannel",
            errorArgs: [0],
        },
        {
            name: "signature length mismatch",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1 }) => {
                sigs.pop(); // Remove one signature
                return { commits, sigs, codes: startCodesP1, salts: startSaltsP1 };
            },
            error: "SignatureLengthMismatch",
            errorArgs: [],
        },
        {
            name: "cards length mismatch",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1 }) => {
                const codes = [...startCodesP1];
                codes.pop(); // Remove one card code
                return { commits, sigs, codes, salts: startSaltsP1 };
            },
            error: "CardsLengthMismatch",
            errorArgs: [],
        },
        {
            name: "card salts length mismatch",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1 }) => {
                const salts = [...startSaltsP1];
                salts.pop(); // Remove one salt
                return { commits, sigs, codes: startCodesP1, salts };
            },
            error: "CardSaltsLengthMismatch",
            errorArgs: [],
        }
    ];

    commitValidationTests.forEach(test => {
        it(`reverts when ${test.name}`, async () => {
            const setupData = await setup();
            const { commits, sigs, codes, salts } = await test.setup(setupData);

            // Start showdown first with a simple game
            await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

            // Try to reveal cards with invalid data
            const expectation = expect(
                escrow
                    .connect(player1)
                    .revealCards(channelId, commits, sigs, codes, salts)
            );

            if (test.errorArgs.length > 0) {
                await expectation.to.be.revertedWithCustomError(escrow, test.error).withArgs(...test.errorArgs);
            } else {
                await expectation.to.be.revertedWithCustomError(escrow, test.error);
            }
        });
    });

    it("allows submitting additional commits during reveal window", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1, board, boardSalts } = await setup();

        // Initiate showdown by settling to showdown
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        // Submit partial commits first (missing river card)
        const partialCommits = commits.slice(0, -1);
        const partialSigs = sigs.slice(0, -2);
        const partialCodes = [...startCodesP1.slice(0, -1)];
        const partialSalts = [...startSaltsP1.slice(0, -1)];

        await escrow
            .connect(player1)
            .revealCards(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

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

    it("allows third party to submit additional commits on behalf of player", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();
        const [, , thirdParty] = await ethers.getSigners();

        // Initiate showdown by settling to showdown
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        // Submit partial commits first (missing river card)
        const partialCommits = commits.slice(0, -1);
        const partialSigs = sigs.slice(0, -2);
        const partialCodes = [...startCodesP1.slice(0, -1)];
        const partialSalts = [...startSaltsP1.slice(0, -1)];

        await escrow
            .connect(player1)
            .revealCards(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

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

        // Initiate showdown by settling to showdown
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

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

        // Initiate showdown by settling to showdown
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        // Start showdown with initial commits
        await escrow
            .connect(player1)
            .revealCards(channelId, commits, sigs, startCodesP1, startSaltsP1);

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

        // Initiate showdown by settling to showdown
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        // Start showdown with initial commits
        await escrow
            .connect(player1)
            .revealCards(channelId, commits, sigs, startCodesP1, startSaltsP1);

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

    it("reverts when no showdown is in progress", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();

        // Try to reveal cards without initiating showdown first
        await expect(
            escrow
                .connect(player1)
                .revealCards(channelId, commits, sigs, startCodesP1, startSaltsP1)
        ).to.be.revertedWithCustomError(escrow, "NoShowdownInProgress");
    });

    it("should result in tie when both players reveal holes but board incomplete", async () => {
        const { commits, sigs, myHole, mySalts, oppHole, oppSalts } = await setup();

        const holeCommits = commits.slice(0, 4); // only hole cards
        const holeSigs = sigs.slice(0, 8);
        const codes = [...myHole, ...oppHole];
        const salts = [...mySalts, ...oppSalts];

        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        await escrow
            .connect(player1)
            .revealCards(channelId, holeCommits, holeSigs, codes, salts);

        await ethers.provider.send("evm_increaseTime", [3601]);
        await ethers.provider.send("evm_mine");

        const [initialBalance,] = await escrow.stacks(channelId);

        await escrow.finalizeShowdown(channelId);

        const [finalBalance,] = await escrow.stacks(channelId);

        // Should be unchanged (tie) since both revealed holes but no board
        expect(finalBalance).to.equal(initialBalance);
    });
});