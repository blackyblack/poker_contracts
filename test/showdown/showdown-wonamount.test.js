const { expect } = require("chai");
const { ethers } = require("hardhat");
const { domainSeparator, ZERO32 } = require("../helpers/hashes");
const { SLOT } = require("../helpers/slots");
const { CARD } = require("../helpers/cards");
const { buildCardCommit, wallet1, wallet2 } = require("../helpers/test-utils");

// Helper to prepare full commit set with given cards
async function setupShowdownWithCards(escrow, channelId, player1Cards, player2Cards, boardCards) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const dom = domainSeparator(escrow.target, chainId);

    const commits = [];
    const sigs = [];
    const objs = [];

    const allCards = [...player1Cards, ...player2Cards, ...boardCards];
    const slots = [
        SLOT.A1,
        SLOT.A2,
        SLOT.B1,
        SLOT.B2,
        SLOT.FLOP1,
        SLOT.FLOP2,
        SLOT.FLOP3,
        SLOT.TURN,
        SLOT.RIVER,
    ];

    for (let i = 0; i < allCards.length; i++) {
        const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, slots[i], allCards[i]);
        commits.push(obj.cc);
        sigs.push(obj.sigA, obj.sigB);
        objs.push(obj);
    }

    const boardSalts = boardCards.map((_, i) => objs[i + 4].salt);
    const player1Salts = player1Cards.map((_, i) => objs[i].salt);
    const player2Salts = player2Cards.map((_, i) => objs[i + 2].salt);

    return { commits, sigs, boardCards, boardSalts, player1Cards, player1Salts, player2Cards, player2Salts };
}

describe("Showdown pot calculation", function () {
    let escrow, player1, player2;
    const channelId = 1n;
    const deposit = 10n;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });

    it("uses full deposits instead of called amount due to missing action replay", async function () {
        // Player 1: A♠ K♠, Player 2: Q♥ J♥, Board: A♣ 5♦ 3♥ 2♠ 7♣
        const p1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
        const p2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
        const board = [
            CARD.ACE_CLUBS,
            CARD.FIVE_DIAMONDS,
            CARD.THREE_HEARTS,
            CARD.TWO_SPADES,
            CARD.SEVEN_CLUBS,
        ];

        const {
            commits,
            sigs,
            boardCards,
            boardSalts,
            player1Cards,
            player1Salts,
            player2Cards,
            player2Salts,
        } = await setupShowdownWithCards(escrow, channelId, p1Cards, p2Cards, board);

        // Start showdown by player1
        await escrow
            .connect(player1)
            .startShowdown(channelId, commits, sigs, [...player1Cards, 0xFF, 0xFF, ...boardCards], [...player1Salts, ZERO32, ZERO32, ...boardSalts]);

        // Move time forward past reveal window
        await ethers.provider.send("evm_increaseTime", [3600 + 1]);
        await ethers.provider.send("evm_mine");

        const tx = await escrow.revealCards(channelId, commits, sigs, [...player1Cards, ...player2Cards, ...boardCards], [...player1Salts, ...player2Salts, ...boardSalts]);

        // TODO: The pot should be only the called amount (e.g., 4n) once action replay is implemented
        await expect(tx)
            .to.emit(escrow, "ShowdownFinalized")
            .withArgs(channelId, player1.address, deposit * 2n); // TODO: fix expectation to called amount

        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit * 2n); // TODO: should equal 12n after proper replay
        expect(p2Stack).to.equal(0n); // TODO: should equal 8n after proper replay
    });
});
