import { expect } from "chai";
import hre from "hardhat";

import { CARD, cardToIndex } from "../helpers/cards.js";
import { SLOT } from "../helpers/slots.js";
import { hashToG1, g1ToBytes } from "../helpers/bn254.js";
import {
    wallet1,
    wallet2,
    setupShowdownCrypto,
    createEncryptedDeck,
    createCanonicalDeck,
    createPartialDecrypt,
    createPlaintext,
    playPlayer1WinsShowdown,
    startGameWithDeck,
    deployAndWireContracts,
} from "../helpers/test-utils.js";

const { ethers } = hre;

const deckContext = "hand_ranking_deck";

describe("HeadsUpPokerEscrow - Poker Hand Ranking Integration", function () {
    let escrow;
    let showdown;
    let player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1.0");

    let crypto;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        ({ escrow, showdown } = await deployAndWireContracts());

        crypto = setupShowdownCrypto();

        await escrow
            .connect(player1)
            .open(
                channelId,
                player2.address,
                1n,
                ethers.ZeroAddress,
                0n,
                crypto.publicKeyA,
                { value: deposit }
            );
        await escrow
            .connect(player2)
            .join(channelId, ethers.ZeroAddress, crypto.publicKeyB, {
                value: deposit,
            });
    });

    function buildDeckForCards(cardCodes) {
        const deck = createEncryptedDeck(
            crypto.secretKeyA,
            crypto.secretKeyB,
            deckContext
        );
        const canonicalDeck = createCanonicalDeck("canonical_deck");
        for (let i = 0; i < cardCodes.length; i++) {
            const plaintext = g1ToBytes(hashToG1(deckContext, i));
            canonicalDeck[cardToIndex(cardCodes[i])] = plaintext;
        }
        return { deck, canonicalDeck };
    }

    async function generatePartials(secretKey, deck) {
        const partials = [];
        for (let i = 0; i < deck.length; i++) {
            const decryptedCard = await createPartialDecrypt(secretKey, deck[i]);
            partials.push(decryptedCard);
        }
        return partials;
    }

    async function generatePlaintexts(secretKey, otherPartials) {
        const plaintexts = [];
        for (let i = 0; i < otherPartials.length; i++) {
            const decryptedCard = await createPlaintext(secretKey, otherPartials[i]);
            plaintexts.push(decryptedCard);
        }
        return plaintexts;
    }

    async function completeRevealFlow(deck, finalizeAsPlayer1 = true) {
        const player1Partials = await generatePartials(crypto.secretKeyA, deck);
        await escrow
            .connect(player1)
            .revealCards(channelId, player1Partials);

        const player2Partials = await generatePartials(crypto.secretKeyB, deck);
        await escrow
            .connect(player2)
            .revealCards(channelId, player2Partials);

        if (finalizeAsPlayer1) {
            const plaintexts = await generatePlaintexts(crypto.secretKeyA, player2Partials);
            return escrow
                .connect(player1)
                .finalizeReveals(channelId, plaintexts);
        }

        const plaintexts = await generatePlaintexts(crypto.secretKeyB, player1Partials);
        return escrow
            .connect(player2)
            .finalizeReveals(channelId, plaintexts);
    }

    it("determines winner correctly - pair beats high card", async function () {
        const desiredCards = [
            CARD.ACE_SPADES,
            CARD.KING_SPADES,
            CARD.QUEEN_HEARTS,
            CARD.JACK_HEARTS,
            CARD.ACE_CLUBS,
            CARD.FIVE_DIAMONDS,
            CARD.THREE_HEARTS,
            CARD.TWO_SPADES,
            CARD.SEVEN_CLUBS,
        ];

        const { deck, canonicalDeck } = buildDeckForCards(desiredCards);
        await startGameWithDeck(escrow, channelId, player1, player2, deck, canonicalDeck);
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        const finalizeTx = await completeRevealFlow(deck, true);
        await expect(finalizeTx)
            .to.emit(escrow, "ShowdownFinalized")
            .withArgs(channelId, player1.address, 2n);

        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit + 2n);
        expect(p2Stack).to.equal(deposit - 2n);

        const sd = await showdown.getShowdown(channelId);
        expect(sd.cards[SLOT.A1]).to.equal(desiredCards[SLOT.A1]);
        expect(sd.cards[SLOT.B1]).to.equal(desiredCards[SLOT.B1]);
    });

    it("determines winner correctly - straight beats pair", async function () {
        const desiredCards = [
            CARD.ACE_SPADES,
            CARD.TWO_SPADES,
            CARD.NINE_HEARTS,
            CARD.NINE_DIAMONDS,
            CARD.THREE_CLUBS,
            CARD.FOUR_DIAMONDS,
            CARD.FIVE_HEARTS,
            CARD.SIX_SPADES,
            CARD.EIGHT_CLUBS,
        ];

        const { deck, canonicalDeck } = buildDeckForCards(desiredCards);
        await startGameWithDeck(escrow, channelId, player1, player2, deck, canonicalDeck);
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        const finalizeTx = await completeRevealFlow(deck, true);
        await expect(finalizeTx)
            .to.emit(escrow, "ShowdownFinalized")
            .withArgs(channelId, player1.address, 2n);

        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit + 2n);
        expect(p2Stack).to.equal(deposit - 2n);
    });

    it("handles ties correctly", async function () {
        const desiredCards = [
            CARD.TWO_SPADES,
            CARD.THREE_SPADES,
            CARD.FOUR_HEARTS,
            CARD.FIVE_DIAMONDS,
            CARD.ACE_CLUBS,
            CARD.ACE_DIAMONDS,
            CARD.KING_HEARTS,
            CARD.QUEEN_SPADES,
            CARD.JACK_CLUBS,
        ];

        const { deck, canonicalDeck } = buildDeckForCards(desiredCards);
        await startGameWithDeck(escrow, channelId, player1, player2, deck, canonicalDeck);
        await playPlayer1WinsShowdown(escrow, channelId, player1, wallet1, wallet2);

        const finalizeTx = await completeRevealFlow(deck, true);
        await expect(finalizeTx)
            .to.emit(escrow, "ShowdownFinalized")
            .withArgs(channelId, player1.address, 0n);

        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit);
        expect(p2Stack).to.equal(deposit);
    });
});
