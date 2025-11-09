import { expect } from "chai";
import hre from "hardhat";
import { bn254 } from "@noble/curves/bn254.js";

import { ACTION } from "../helpers/actions.js";
import { SLOT } from "../helpers/slots.js";
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

// TODO: rework for finalizeReveals plaintext verification path.
describe.skip("Showdown - DecryptedCard Verification", function () {
    let escrow;
    let player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    let crypto;
    let deck, canonicalDeck;
    let escrowAddress, chainId;

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        escrowAddress = await escrow.getAddress();
        chainId = (await ethers.provider.getNetwork()).chainId;

        // Setup cryptographic keys
        crypto = setupShowdownCrypto();

        // Open channel with public keys
        await escrow.open(
            channelId,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            crypto.pkA_G2_bytes,
            { value: deposit }
        );
        await escrow.connect(player2).join(
            channelId,
            ethers.ZeroAddress,
            crypto.pkB_G2_bytes,
            { value: deposit }
        );

        // Create decks
        deck = createEncryptedDeck(crypto.secretKeyA, crypto.secretKeyB);
        canonicalDeck = createCanonicalDeck();

        // Start game with deck
        await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
        await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);
    });

    async function initiateShowdown() {
        // Create a showdown scenario: both players check down
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
        const signatures = await signActions(actions, [wallet1, wallet2], escrowAddress, chainId);
        return await escrow.connect(player1).settle(channelId, actions, signatures);
    }

    it("should allow revealing cards using two-step decryption", async () => {
        await initiateShowdown();

        const handId = await escrow.getHandId(channelId);

        // Player 1 wants to reveal their hole cards (A1, A2)
        // Step 1: Player 2 provides partials for A1, A2 (removes their layer)
        const { decryptedCard: partialA1, signature: sigA1Partial } = await createPartialDecrypt(
            wallet2,
            crypto.secretKeyB,
            deck[SLOT.A1],
            SLOT.A1,
            channelId,
            handId,
            escrowAddress,
            chainId
        );

        const { decryptedCard: partialA2, signature: sigA2Partial } = await createPartialDecrypt(
            wallet2,
            crypto.secretKeyB,
            deck[SLOT.A2],
            SLOT.A2,
            channelId,
            handId,
            escrowAddress,
            chainId
        );

        // Step 2: Player 1 provides plaintexts for A1, A2 (removes their layer from partials)
        const { decryptedCard: plaintextA1, signature: sigA1Plain } = await createPlaintext(
            wallet1,
            crypto.secretKeyA,
            partialA1.decryptedCard,
            SLOT.A1,
            channelId,
            handId,
            escrowAddress,
            chainId
        );

        const { decryptedCard: plaintextA2, signature: sigA2Plain } = await createPlaintext(
            wallet1,
            crypto.secretKeyA,
            partialA2.decryptedCard,
            SLOT.A2,
            channelId,
            handId,
            escrowAddress,
            chainId
        );

        // Reveal cards with two-step verification
        await escrow.connect(player1).revealCards(
            channelId,
            [partialA1, partialA2],  // Other player's partials
            [sigA1Partial, sigA2Partial],  // Signatures for partials
            [plaintextA1, plaintextA2],  // Opener's plaintexts
            [sigA1Plain, sigA2Plain]  // Signatures for plaintexts
        );

        // Verify cards are stored
        const sd = await escrow.getShowdown(channelId);
        expect(sd.lockedCommitMask & (1 << SLOT.A1)).to.not.equal(0);
        expect(sd.lockedCommitMask & (1 << SLOT.A2)).to.not.equal(0);
    });

    it("should allow empty other partials array when reusing peek artifacts", async () => {
        // This test would demonstrate peek artifact reuse
        // For now, just verify the function signature works with empty arrays
        await initiateShowdown();

        const handId = await escrow.getHandId(channelId);

        // Create a plaintext directly
        const { decryptedCard: plaintextA1, signature: sigA1Plain } = await createPlaintext(
            wallet1,
            crypto.secretKeyA,
            deck[SLOT.A1],  // This will fail since we don't have the partial yet
            SLOT.A1,
            channelId,
            handId,
            escrowAddress,
            chainId
        );

        // This should fail because we need the partial
        await expect(
            escrow.connect(player1).revealCards(
                channelId,
                [],  // Empty - no partials provided
                [],
                [plaintextA1],
                [sigA1Plain]
            )
        ).to.be.revertedWithCustomError(escrow, "InvalidDecryptedCard");
    });
});
