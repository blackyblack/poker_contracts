const { expect } = require("chai");
const { ethers } = require("hardhat");
const { domainSeparator, ZERO32 } = require("../helpers/hashes");
const { SLOT } = require("../helpers/slots");
const { CARD } = require("../helpers/cards");
const { buildCardCommit, wallet1, wallet2 } = require("../helpers/test-utils");

describe("HeadsUpPokerEscrow - Poker Evaluation Integration", function () {
    let escrow, player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1.0");

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();

        // Setup channel
        await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });

    async function setupShowdownWithCards(player1Cards, player2Cards, boardCards) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const dom = domainSeparator(escrow.target, chainId);

        const commits = [];
        const sigs = [];
        const objs = [];

        // Cards layout: [player1_hole1, player1_hole2, player2_hole1, player2_hole2, flop1, flop2, flop3, turn, river]
        const allCards = [...player1Cards, ...player2Cards, ...boardCards];
        const slots = [SLOT.A1, SLOT.A2, SLOT.B1, SLOT.B2, SLOT.FLOP1, SLOT.FLOP2, SLOT.FLOP3, SLOT.TURN, SLOT.RIVER];

        for (let i = 0; i < allCards.length; i++) {
            const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, slots[i], allCards[i]);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            objs.push(obj);
        }

        const boardSalts = boardCards.map((_, i) => objs[i + 4].salt);
        const player1Salts = player1Cards.map((_, i) => objs[i].salt);
        const player2Salts = player2Cards.map((_, i) => objs[i + 2].salt);

        const startCardCodes = [
            player1Cards[0],
            player1Cards[1],
            0xff,
            0xff,
            ...boardCards,
        ];
        const startCardSalts = [
            player1Salts[0],
            player1Salts[1],
            ZERO32,
            ZERO32,
            ...boardSalts,
        ];
        const revealCodes = [
            0xff,
            0xff,
            player2Cards[0],
            player2Cards[1],
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
        ];
        const revealSalts = [
            ZERO32,
            ZERO32,
            player2Salts[0],
            player2Salts[1],
            ZERO32,
            ZERO32,
            ZERO32,
            ZERO32,
            ZERO32,
        ];

        return { commits, sigs, startCardCodes, startCardSalts, revealCodes, revealSalts, player2Cards };
    }

    describe("Poker Hand Evaluation", function () {
        it("should determine winner correctly - pair beats high card", async function () {
            // Player 1: A♠ K♠ with A♣ 5♦ 3♥ 2♠ 7♣ board = Pair of Aces
            const player1Cards = [
                CARD.ACE_SPADES,
                CARD.KING_SPADES
            ];

            // Player 2: Q♥ J♥ with board = Queen high
            const player2Cards = [
                CARD.QUEEN_HEARTS,
                CARD.JACK_HEARTS
            ];

            // Board: A♣ 5♦ 3♥ 2♠ 7♣
            const boardCards = [
                CARD.ACE_CLUBS,
                CARD.FIVE_DIAMONDS,
                CARD.THREE_HEARTS,
                CARD.TWO_SPADES,
                CARD.SEVEN_CLUBS
            ];
            const { commits, sigs, startCardCodes, startCardSalts, revealCodes, revealSalts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            // Start showdown
            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, startCardCodes, startCardSalts);

            // Reveal opponent cards to finalize
            const tx = await escrow
                .connect(player2)
                .revealCards(channelId, commits, sigs, revealCodes, revealSalts);

            await expect(tx)
                .to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, deposit);

            // Verify player1 won (has the full pot)
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);
        });

        it("should determine winner correctly - straight beats pair", async function () {
            // Player 1: A♠ 2♠ with 3♣ 4♦ 5♥ 6♠ 8♣ board = 7-high straight
            const player1Cards = [
                CARD.ACE_SPADES,
                CARD.TWO_SPADES
            ];

            // Player 2: 9♥ 9♦ with board = Pair of 9s
            const player2Cards = [
                CARD.NINE_HEARTS,
                CARD.NINE_DIAMONDS
            ];

            // Board: 3♣ 4♦ 5♥ 6♠ 8♣
            const boardCards = [
                CARD.THREE_CLUBS,
                CARD.FOUR_DIAMONDS,
                CARD.FIVE_HEARTS,
                CARD.SIX_SPADES,
                CARD.EIGHT_CLUBS
            ];

            const { commits, sigs, startCardCodes, startCardSalts, revealCodes, revealSalts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, startCardCodes, startCardSalts);

            const tx = await escrow
                .connect(player2)
                .revealCards(channelId, commits, sigs, revealCodes, revealSalts);
            
            await expect(tx)
                .to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, deposit);

            // Verify player1 won with the straight
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);
        });

        it("should handle ties correctly", async function () {
            // Both players have the same pair on the board
            const player1Cards = [
                CARD.TWO_SPADES,
                CARD.THREE_SPADES
            ];

            const player2Cards = [
                CARD.FOUR_HEARTS,
                CARD.FIVE_DIAMONDS
            ];

            // Board: A♣ A♦ K♥ Q♠ J♣ - both players have pair of Aces
            const boardCards = [
                CARD.ACE_CLUBS,
                CARD.ACE_DIAMONDS,
                CARD.KING_HEARTS,
                CARD.QUEEN_SPADES,
                CARD.JACK_CLUBS
            ];

            const { commits, sigs, startCardCodes, startCardSalts, revealCodes, revealSalts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, startCardCodes, startCardSalts);

            const tx = await escrow
                .connect(player2)
                .revealCards(channelId, commits, sigs, revealCodes, revealSalts);
            
            // In case of tie no one wins anything (pot remains the same)
            await expect(tx)
                .to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, 0);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(deposit);
        });
    });
});