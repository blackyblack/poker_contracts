import { expect } from "chai";
import hre from "hardhat";

import { ACTION } from "../helpers/actions.js";
import { SLOT } from "../helpers/slots.js";
import { CARD, cardToIndex } from "../helpers/cards.js";
import { hashToG1, g1ToBytes } from "../helpers/bn254.js";
import {
    buildActions,
    signActions,
    wallet1,
    wallet2,
    setupShowdownCrypto,
    createEncryptedDeck,
    createCanonicalDeck,
    createPartialDecrypt,
    createPlaintext,
} from "../helpers/test-utils.js";

const { ethers } = hre;

const deckContext = "showdown_decrypted_deck";
const desiredCards = [
    CARD.ACE_SPADES,
    CARD.ACE_HEARTS,
    CARD.KING_SPADES,
    CARD.KING_HEARTS,
    CARD.TWO_CLUBS,
    CARD.SEVEN_DIAMONDS,
    CARD.NINE_HEARTS,
    CARD.FOUR_SPADES,
    CARD.FIVE_CLUBS,
];

describe("Showdown - DecryptedCard Verification", function () {
    let escrow;
    let player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    let crypto;
    let deck;
    let escrowAddress;
    let chainId;
    let showdownContract;
    let view;

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        escrowAddress = await escrow.getAddress();
        chainId = (await ethers.provider.getNetwork()).chainId;
        view = await ethers.getContractAt(
            "HeadsUpPokerView",
            await escrow.viewContract()
        );

        crypto = setupShowdownCrypto();

        const showdownAddress = await view.getShowdownAddress();
        showdownContract = await ethers.getContractAt(
            "HeadsUpPokerShowdown",
            showdownAddress
        );

        await escrow.open(
            channelId,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            crypto.publicKeyA,
            { value: deposit }
        );
        await escrow.connect(player2).join(
            channelId,
            ethers.ZeroAddress,
            crypto.publicKeyB,
            { value: deposit }
        );

        deck = createEncryptedDeck(
            crypto.secretKeyA,
            crypto.secretKeyB,
            deckContext
        );

        const canonicalDeck = createCanonicalDeck("canonical_deck");
        for (let i = 0; i < desiredCards.length; i++) {
            const plaintext = g1ToBytes(hashToG1(deckContext, i));
            canonicalDeck[cardToIndex(desiredCards[i])] = plaintext;
        }

        await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
        await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);
    });

    async function initiateShowdown() {
        const handId = await escrow.getHandId(channelId);
        const actionSpecs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
        ];

        const actions = buildActions(actionSpecs, channelId, handId);
        const signatures = await signActions(
            actions,
            [wallet1, wallet2],
            escrowAddress,
            chainId
        );
        await escrow.connect(player1).settle(channelId, actions, signatures);
    }

    async function generatePartials(secretKey) {
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

    it("allows both players to reveal and finalize the deck", async () => {
        await initiateShowdown();

        const player1Partials = await generatePartials(crypto.secretKeyA);
        await expect(
            escrow.connect(player1).revealCards(channelId, player1Partials)
        )
            .to.emit(escrow, "RevealsUpdated")
            .withArgs(channelId, true, false);

        const player2Partials = await generatePartials(crypto.secretKeyB);
        await expect(
            escrow.connect(player2).revealCards(channelId, player2Partials)
        )
            .to.emit(escrow, "RevealsUpdated")
            .withArgs(channelId, true, true);

        const plaintexts = await generatePlaintexts(crypto.secretKeyA, player2Partials);

        await expect(
            escrow.connect(player1).finalizeReveals(channelId, plaintexts)
        )
            .to.emit(escrow, "ShowdownFinalized")
            .withArgs(channelId, player1.address, 2n);

        const sd = await view.getShowdown(channelId);
        expect(sd.inProgress).to.equal(false);
        expect(sd.player1Revealed).to.equal(true);
        expect(sd.player2Revealed).to.equal(true);
        expect(sd.cards[SLOT.A1]).to.equal(desiredCards[SLOT.A1]);
        expect(sd.cards[SLOT.A2]).to.equal(desiredCards[SLOT.A2]);
        expect(sd.cards[SLOT.B1]).to.equal(desiredCards[SLOT.B1]);
        expect(sd.cards[SLOT.B2]).to.equal(desiredCards[SLOT.B2]);
    });

    it("requires both players to reveal before finalizing", async () => {
        await initiateShowdown();

        const player1Partials = await generatePartials(crypto.secretKeyA);
        await escrow.connect(player1).revealCards(channelId, player1Partials);

        const player2Partials = await generatePartials(crypto.secretKeyB);

        const plaintexts = await generatePlaintexts(crypto.secretKeyA, player2Partials);

        await expect(
            escrow.connect(player1).finalizeReveals(channelId, plaintexts)
        ).to.be.revertedWithCustomError(showdownContract, "PrerequisitesNotMet");
    });

    it("rejects reveal calls with incorrect card counts", async () => {
        await initiateShowdown();

        const player1Partials = await generatePartials(crypto.secretKeyA);

        await expect(
            escrow
                .connect(player1)
                .revealCards(channelId, player1Partials.slice(0, 2))
        ).to.be.revertedWithCustomError(showdownContract, "PrerequisitesNotMet");
    });
});
