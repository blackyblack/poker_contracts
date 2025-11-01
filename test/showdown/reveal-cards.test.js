import { expect } from "chai";
import hre from "hardhat";
import { ZERO32, domainSeparator, cardCommitDigest } from "../helpers/hashes.js";
import { SLOT } from "../helpers/slots.js";
import { CARD } from "../helpers/cards.js";
import { ACTION } from "../helpers/actions.js";
import { buildActions, signActions, buildCardCommit, wallet1, wallet2, wallet3, playPlayer1WinsShowdown, startGameWithDeck } from "../helpers/test-utils.js";

const { ethers } = hre;

const EMPTY_CODES = Array(9).fill(0xff);
const EMPTY_SALTS = Array(9).fill(ZERO32);

describe("Showdown - revealCards", function () {
    let escrow;
    let player1, player2;
    const channelId = 1n;
    let chainId;
    const deposit = ethers.parseEther("1");

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        await escrow.open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
        await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
        await startGameWithDeck(escrow, channelId, player1, player2);
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
            name: "bad B signature",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1, startCodesP2, startSaltsP2, objs, dom }) => {
                const digest = cardCommitDigest(dom, objs[2].cc);
                const badSig = wallet3.signingKey.sign(digest).serialized;
                sigs[5] = badSig; // B signature for commit index2
                // Ensure slot B1 is actually opened (not 0xFF), otherwise signature check is skipped
                const codes = [...startCodesP1];
                const salts = [...startSaltsP1];
                codes[2] = startCodesP2[2];
                salts[2] = startSaltsP2[2];
                return { commits, sigs, codes, salts };
            },
            error: "CommitWrongSignerB",
            errorArgs: [2],
        },
        {
            name: "mismatched card codes length",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1 }) => {
                return {
                    commits,
                    sigs,
                    codes: startCodesP1.slice(0, -1),
                    salts: startSaltsP1,
                };
            },
            error: "CardsLengthMismatch",
        },
        {
            name: "mismatched card salts length",
            setup: async ({ commits, sigs, startCodesP1, startSaltsP1 }) => {
                return {
                    commits,
                    sigs,
                    codes: startCodesP1,
                    salts: startSaltsP1.slice(0, -1),
                };
            },
            error: "CardSaltsLengthMismatch",
        },
    ];

    commitValidationTests.forEach(test => {
        it(`reverts on ${test.name}`, async () => {
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

            if (test.errorArgs) {
                await expectation.to.be.revertedWithCustomError(escrow, test.error).withArgs(...test.errorArgs);
            } else {
                await expectation.to.be.revertedWithCustomError(escrow, test.error);
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

        // Initiate showdown by settling to showdown
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        await escrow
            .connect(player1)
            .revealCards(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

        const sd = await escrow.getShowdown(channelId);
        expect(sd.inProgress).to.equal(true);
        // Check that the commit mask reflects the partial set (all except river)
        expect(Number(sd.lockedCommitMask)).to.equal(0xFF); // bits 0..7 set
    });

    it("happy path stores hashes and cards", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();

        // Initiate showdown by settling to showdown
        const showdownTx = await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        const rcpt = await showdownTx.wait();
        const block = await ethers.provider.getBlock(rcpt.blockNumber);

        await escrow
            .connect(player1)
            .revealCards(channelId, commits, sigs, startCodesP1, startSaltsP1);

        const sd = await escrow.getShowdown(channelId);
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

        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

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

    it("allows finalize after deadline when opponent holes not opened", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();
        const window = await escrow.revealWindow();

        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

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

        // showdown start by player1
        await escrow
            .connect(player1)
            .revealCards(channelId, partialCommits, partialSigs, partialCodes, partialSalts);

        // finalize before deadline should revert
        await expect(escrow.finalizeShowdown(channelId)).to.be.revertedWithCustomError(
            escrow,
            "StillRevealing"
        );

        // Fast forward past reveal window
        await ethers.provider.send("evm_increaseTime", [Number(window) + 1]); // 1 hour reveal window + 1 second
        await ethers.provider.send("evm_mine");

        const [initialBalance,] = await escrow.stacks(channelId);

        // reveal after deadline should revert
        await expect(
            escrow
                .connect(player1)
                .revealCards(channelId, [], [], [...EMPTY_CODES], [...EMPTY_SALTS])
        ).to.be.revertedWithCustomError(escrow, "Expired");

        // Finalize - should forfeit to initiator (player1) - revealed his cards
        await escrow.finalizeShowdown(channelId);

        const [finalBalance,] = await escrow.stacks(channelId);

        expect(finalBalance).to.be.greaterThan(initialBalance);
    });

    it("should result in tie when no cards are revealed", async () => {
        const window = await escrow.revealWindow();

        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        const [initialBalance1, initialBalance2] = await escrow.stacks(channelId);

        await ethers.provider.send("evm_increaseTime", [Number(window) + 1]);
        await ethers.provider.send("evm_mine");

        await escrow.finalizeShowdown(channelId);

        const [finalBalance1, finalBalance2] = await escrow.stacks(channelId);

        expect(finalBalance1).to.equal(initialBalance1);
        expect(finalBalance2).to.equal(initialBalance2);
    });

    it("should result in tie when both players reveal holes but board incomplete", async () => {
        const { commits, sigs, myHole, mySalts, oppHole, oppSalts } = await setup();
        const window = await escrow.revealWindow();

        const holeCommits = commits.slice(0, 4); // only hole cards
        const holeSigs = sigs.slice(0, 8);
        const codes = [...myHole, ...oppHole];
        const salts = [...mySalts, ...oppSalts];

        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        await escrow
            .connect(player1)
            .revealCards(channelId, holeCommits, holeSigs, codes, salts);

        await ethers.provider.send("evm_increaseTime", [Number(window) + 1]); // 1 hour reveal window + 1 second
        await ethers.provider.send("evm_mine");

        const [initialBalance,] = await escrow.stacks(channelId);

        await escrow.finalizeShowdown(channelId);

        const [finalBalance,] = await escrow.stacks(channelId);
        expect(finalBalance).to.be.equal(initialBalance);
    });

    it("should reward opponent when only they reveal both hole cards", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1, startCodesP2, startSaltsP2 } = await setup();
        const window = await escrow.revealWindow();

        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        const revealIndicesP1 = [0, 4, 5, 6, 7, 8];
        const commitsP1 = revealIndicesP1.map(i => commits[i]);
        const codesP1 = revealIndicesP1.map(i => startCodesP1[i]);
        const saltsP1 = revealIndicesP1.map(i => startSaltsP1[i]);
        const sigsP1 = [];
        revealIndicesP1.forEach(i => {
            sigsP1.push(sigs[i * 2], sigs[i * 2 + 1]);
        });

        await escrow
            .connect(player1)
            .revealCards(channelId, commitsP1, sigsP1, codesP1, saltsP1);

        const revealIndicesP2 = [2, 3];
        const commitsP2 = revealIndicesP2.map(i => commits[i]);
        const codesP2 = revealIndicesP2.map(i => startCodesP2[i]);
        const saltsP2 = revealIndicesP2.map(i => startSaltsP2[i]);
        const sigsP2 = [];
        revealIndicesP2.forEach(i => {
            sigsP2.push(sigs[i * 2], sigs[i * 2 + 1]);
        });

        // player1 reveals first but only one hole card, then player2 reveals both holes
        await escrow
            .connect(player2)
            .revealCards(channelId, commitsP2, sigsP2, codesP2, saltsP2);

        await ethers.provider.send("evm_increaseTime", [Number(window) + 1]);
        await ethers.provider.send("evm_mine");

        const [initialBalance1, initialBalance2] = await escrow.stacks(channelId);

        await escrow.finalizeShowdown(channelId);

        const [finalBalance1, finalBalance2] = await escrow.stacks(channelId);

        expect(finalBalance2).to.be.greaterThan(initialBalance2);
        expect(finalBalance1).to.be.lessThan(initialBalance1);
    });

    it("allows third party to submit additional commits", async () => {
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

        // Third party submits additional commit for river card
        const riverCommit = commits[8]; // River card commit
        const riverSigs = [sigs[16], sigs[17]]; // River card signatures

        await escrow
            .connect(thirdParty)
            .revealCards(
                channelId,
                [riverCommit],
                [...riverSigs],
                [startCodesP1[8]],
                [startSaltsP1[8]]
            );

        const sd = await escrow.getShowdown(channelId);
        expect(Number(sd.lockedCommitMask)).to.equal(0x1F3); // All slots now committed
    });

    it("ignore commit override", async () => {
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

    it("reverts when no showdown is in progress", async () => {
        const { commits, sigs, startCodesP1, startSaltsP1 } = await setup();

        // Try to reveal cards without initiating showdown first
        await expect(
            escrow
                .connect(player1)
                .revealCards(channelId, commits, sigs, startCodesP1, startSaltsP1)
        ).to.be.revertedWithCustomError(escrow, "NoShowdownInProgress");
    });

    it("should allow card reveals after settle-initiated showdown", async function () {
        const handId = await escrow.getHandId(channelId);

        // Initiate showdown via settle
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (first to act postflop),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (river),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        await escrow.connect(player1).settle(channelId, actions, signatures);

        // Prepare card commits for reveal
        const dom = domainSeparator(escrow.target, chainId);
        const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];

        const commits = [];
        const sigs = [];
        const cardCodes = [];
        const cardSalts = [];

        // Only reveal player1's cards
        const slots = [SLOT.A1, SLOT.A2];
        for (let i = 0; i < 2; i++) {
            const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, slots[i], player1Cards[i]);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            cardCodes.push(player1Cards[i]);
            cardSalts.push(obj.salt);
        }

        // Reveal player1's cards
        const revealTx = await escrow.connect(player1).revealCards(channelId, commits, sigs, cardCodes, cardSalts);
        await expect(revealTx).to.emit(escrow, "CommitsUpdated");

        // Verify cards were revealed
        const showdownState = await escrow.getShowdown(channelId);
        expect(showdownState.cards[SLOT.A1]).to.equal(player1Cards[0]);
        expect(showdownState.cards[SLOT.A2]).to.equal(player1Cards[1]);
        expect(showdownState.cards[SLOT.B1]).to.equal(0xFF); // Player2 cards still unrevealed
        expect(showdownState.cards[SLOT.B2]).to.equal(0xFF);
    });

    it("should automatically finalize when both players reveal cards", async function () {
        const handId = await escrow.getHandId(channelId);

        // Initiate showdown via settle
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (first to act postflop),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (river),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        await escrow.connect(player1).settle(channelId, actions, signatures);

        // Set up cards for both players and board
        const dom = domainSeparator(escrow.target, chainId);

        // Player1 gets better hand: Pair of Aces
        const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
        // Player2 gets worse hand: Queen high  
        const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
        // Board: A♣ 5♦ 3♥ 2♠ 7♣ - gives player1 pair of aces
        const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

        const allCards = [...player1Cards, ...player2Cards, ...boardCards];
        const slots = [SLOT.A1, SLOT.A2, SLOT.B1, SLOT.B2, SLOT.FLOP1, SLOT.FLOP2, SLOT.FLOP3, SLOT.TURN, SLOT.RIVER];

        const commits = [];
        const sigs = [];
        const cardCodes = [];
        const cardSalts = [];

        // Build commits for all cards
        for (let i = 0; i < allCards.length; i++) {
            const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, slots[i], allCards[i]);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            cardCodes.push(allCards[i]);
            cardSalts.push(obj.salt);
        }

        // Reveal all cards at once - should trigger automatic finalization
        const revealTx = await escrow.connect(player1).revealCards(channelId, commits, sigs, cardCodes, cardSalts);

        // Should emit ShowdownFinalized event with player1 as winner (pair beats high card)
        await expect(revealTx).to.emit(escrow, "ShowdownFinalized").withArgs(channelId, player1.address, 2n);

        // Verify player1 won
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit + 2n);
        expect(p2Stack).to.equal(deposit - 2n);
    });
});
