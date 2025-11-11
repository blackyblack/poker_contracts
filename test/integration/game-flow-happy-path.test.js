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
    deployAndWireContracts,
} from "../helpers/test-utils.js";

const { ethers } = hre;

/**
 * Integration tests for happy path scenarios where both players cooperate
 * and complete the full game flow:
 * 1. Both players join the game
 * 2. Both players start the game with encrypted and canonical decks
 * 3. Game is finalized after either a showdown or fold
 */
describe("Integration Tests - Happy Path", function () {
    let escrow, showdown;
    let player1, player2;
    let chainId;
    const channelId = 1n;
    const deposit = ethers.parseEther("1.0");
    const minSmallBlind = 1n;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        ({ escrow, showdown } = await deployAndWireContracts());
        chainId = (await ethers.provider.getNetwork()).chainId;
    });

    describe("Complete Game Flow - Showdown", function () {
        it("should complete full game: open, join, start, showdown, reveal, finalize, withdraw", async function () {
            // Step 1: Setup crypto first (needed for opening channel)
            const crypto = setupShowdownCrypto();
            
            // Step 2: Player 1 opens channel with public key
            await expect(
                escrow.connect(player1).open(
                    channelId,
                    player2.address,
                    minSmallBlind,
                    ethers.ZeroAddress,
                    0n,
                    crypto.publicKeyA,
                    { value: deposit }
                )
            )
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 1n, minSmallBlind);

            // Step 3: Player 2 joins channel with public key
            await expect(
                escrow.connect(player2).join(channelId, ethers.ZeroAddress, crypto.publicKeyB, { value: deposit })
            )
                .to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, deposit);

            // Verify stacks after joining
            let [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(deposit);

            // Step 4: Setup encrypted and canonical decks
            const deckContext = "happy_path_showdown";
            const deck = createEncryptedDeck(
                crypto.secretKeyA,
                crypto.secretKeyB,
                deckContext
            );

            // Create desired cards for the game
            const desiredCards = [
                CARD.ACE_SPADES,    // Player A hole 1
                CARD.ACE_HEARTS,    // Player A hole 2
                CARD.KING_SPADES,   // Player B hole 1
                CARD.KING_HEARTS,   // Player B hole 2
                CARD.TWO_CLUBS,     // Flop 1
                CARD.SEVEN_DIAMONDS, // Flop 2
                CARD.NINE_HEARTS,    // Flop 3
                CARD.FOUR_SPADES,    // Turn
                CARD.FIVE_CLUBS,     // River
            ];

            const canonicalDeck = createCanonicalDeck("canonical_deck");
            for (let i = 0; i < desiredCards.length; i++) {
                const plaintext = g1ToBytes(hashToG1(deckContext, i));
                canonicalDeck[cardToIndex(desiredCards[i])] = plaintext;
            }

            // Step 5: Both players start game with matching decks
            const deckHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [deck]));
            
            await expect(
                escrow.connect(player1).startGame(channelId, deck, canonicalDeck)
            ).to.not.be.reverted;

            await expect(
                escrow.connect(player2).startGame(channelId, deck, canonicalDeck)
            )
                .to.emit(escrow, "GameStarted")
                .withArgs(channelId, deckHash);

            // Step 6: Play through to showdown (check down all streets)
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address }, // Pre-flop
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address }, // Flop
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address }, // Turn
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address }, // River
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address }, // Showdown
            ];

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.emit(escrow, "ShowdownStarted")
                .withArgs(channelId);

            // Step 7: Both players reveal their cards
            const player1Partials = [];
            for (let i = 0; i < deck.length; i++) {
                const decryptedCard = await createPartialDecrypt(crypto.secretKeyA, deck[i]);
                player1Partials.push(decryptedCard);
            }

            await expect(
                escrow.connect(player1).revealCards(channelId, player1Partials)
            )
                .to.emit(escrow, "RevealsUpdated")
                .withArgs(channelId, true, false);

            const player2Partials = [];
            for (let i = 0; i < deck.length; i++) {
                const decryptedCard = await createPartialDecrypt(crypto.secretKeyB, deck[i]);
                player2Partials.push(decryptedCard);
            }

            await expect(
                escrow.connect(player2).revealCards(channelId, player2Partials)
            )
                .to.emit(escrow, "RevealsUpdated")
                .withArgs(channelId, true, true);

            // Step 8: Finalize reveals with plaintexts
            const plaintexts = [];
            for (let i = 0; i < player2Partials.length; i++) {
                const decryptedCard = await createPlaintext(crypto.secretKeyA, player2Partials[i]);
                plaintexts.push(decryptedCard);
            }

            // Player 1 wins with pair of aces vs pair of kings
            await expect(
                escrow.connect(player1).finalizeReveals(channelId, plaintexts)
            )
                .to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, 2n);

            // Step 9: Both players withdraw
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + 2n);
            expect(p2Stack).to.equal(deposit - 2n);

            const p1BalanceBefore = await ethers.provider.getBalance(player1.address);
            await expect(escrow.connect(player1).withdraw(channelId))
                .to.emit(escrow, "Withdrawn")
                .withArgs(channelId, player1.address, deposit + 2n);

            const p1BalanceAfter = await ethers.provider.getBalance(player1.address);
            expect(p1BalanceAfter).to.be.gt(p1BalanceBefore);

            const p2BalanceBefore = await ethers.provider.getBalance(player2.address);
            await expect(escrow.connect(player2).withdraw(channelId))
                .to.emit(escrow, "Withdrawn")
                .withArgs(channelId, player2.address, deposit - 2n);

            const p2BalanceAfter = await ethers.provider.getBalance(player2.address);
            expect(p2BalanceAfter).to.be.gt(p2BalanceBefore);

            // Verify stacks are zero after withdrawal
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(0);
        });
    });

    describe("Complete Game Flow - Fold", function () {
        it("should complete full game: open, join, start, fold, withdraw", async function () {
            // Step 1: Setup crypto
            const crypto = setupShowdownCrypto();
            
            // Step 2: Player 1 opens channel
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                crypto.publicKeyA,
                { value: deposit }
            );

            // Step 3: Player 2 joins channel
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, crypto.publicKeyB, { value: deposit });

            // Step 4: Setup decks
            const deckContext = "happy_path_fold";
            const deck = createEncryptedDeck(
                crypto.secretKeyA,
                crypto.secretKeyB,
                deckContext
            );
            const canonicalDeck = createCanonicalDeck("canonical_deck");

            // Step 5: Both players start game with matching decks
            await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
            await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);

            // Step 6: Play with a fold
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.BET_RAISE, amount: 3n, sender: wallet1.address }, // Small blind raises
                { action: ACTION.FOLD, amount: 0n, sender: wallet2.address } // Big blind folds
            ];

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            const calledAmount = 2n; // Big blind folds, so min(1+3, 2) = 2

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player1.address, calledAmount);

            // Step 7: Verify balances and withdraw
            let [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + calledAmount);
            expect(p2Stack).to.equal(deposit - calledAmount);

            await escrow.connect(player1).withdraw(channelId);
            await escrow.connect(player2).withdraw(channelId);

            // Verify stacks are zero after withdrawal
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(0);
        });
    });

    describe("Game with Proper Encrypted and Canonical Decks", function () {
        it("should verify encrypted deck is properly created with BN254 cryptography", async function () {
            // Setup crypto first
            const crypto = setupShowdownCrypto();
            
            // Open and join channel with public keys
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                crypto.publicKeyA,
                { value: deposit }
            );
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, crypto.publicKeyB, { value: deposit });

            // Setup crypto properly
            const deckContext = "encrypted_deck_test";
            const deck = createEncryptedDeck(
                crypto.secretKeyA,
                crypto.secretKeyB,
                deckContext
            );

            // Verify deck has correct number of cards
            expect(deck.length).to.equal(9);

            // Verify each card is 64 bytes (BN254 G1 point)
            for (const card of deck) {
                expect(ethers.getBytes(card).length).to.equal(64);
            }

            // Create canonical deck
            const canonicalDeck = createCanonicalDeck("canonical_deck");
            expect(canonicalDeck.length).to.equal(52);

            // Verify each canonical card is 64 bytes
            for (const card of canonicalDeck) {
                expect(ethers.getBytes(card).length).to.equal(64);
            }

            // Start game with these decks - should not revert
            const deckHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [deck]));
            
            await expect(
                escrow.connect(player1).startGame(channelId, deck, canonicalDeck)
            ).to.not.be.reverted;

            await expect(
                escrow.connect(player2).startGame(channelId, deck, canonicalDeck)
            )
                .to.emit(escrow, "GameStarted")
                .withArgs(channelId, deckHash);
        });

        it("should verify canonical deck is used for card resolution after decryption", async function () {
            // Setup crypto first
            const crypto = setupShowdownCrypto();
            
            // Setup channel with public keys
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                crypto.publicKeyA,
                { value: deposit }
            );
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, crypto.publicKeyB, { value: deposit });

            // Create deck with known cards
            const deckContext = "canonical_verification";
            const deck = createEncryptedDeck(
                crypto.secretKeyA,
                crypto.secretKeyB,
                deckContext
            );

            const desiredCards = [
                CARD.ACE_SPADES,
                CARD.KING_HEARTS,
                CARD.QUEEN_DIAMONDS,
                CARD.JACK_CLUBS,
                CARD.TEN_SPADES,
                CARD.NINE_HEARTS,
                CARD.EIGHT_DIAMONDS,
                CARD.SEVEN_CLUBS,
                CARD.SIX_SPADES,
            ];

            // Setup canonical deck with these specific cards
            const canonicalDeck = createCanonicalDeck("canonical_deck");
            for (let i = 0; i < desiredCards.length; i++) {
                const plaintext = g1ToBytes(hashToG1(deckContext, i));
                canonicalDeck[cardToIndex(desiredCards[i])] = plaintext;
            }

            // Start game
            await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
            await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);

            // Play to showdown
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
                await escrow.getAddress(),
                chainId
            );

            await escrow.connect(player1).settle(channelId, actions, signatures);

            // Reveal cards
            const player1Partials = [];
            for (let i = 0; i < deck.length; i++) {
                player1Partials.push(await createPartialDecrypt(crypto.secretKeyA, deck[i]));
            }
            await escrow.connect(player1).revealCards(channelId, player1Partials);

            const player2Partials = [];
            for (let i = 0; i < deck.length; i++) {
                player2Partials.push(await createPartialDecrypt(crypto.secretKeyB, deck[i]));
            }
            await escrow.connect(player2).revealCards(channelId, player2Partials);

            // Finalize and verify cards are resolved correctly
            const plaintexts = [];
            for (let i = 0; i < player2Partials.length; i++) {
                plaintexts.push(await createPlaintext(crypto.secretKeyA, player2Partials[i]));
            }

            await escrow.connect(player1).finalizeReveals(channelId, plaintexts);

            // Verify the cards were resolved correctly
            const sd = await showdown.getShowdown(channelId);
            expect(sd.cards[SLOT.A1]).to.equal(desiredCards[SLOT.A1]);
            expect(sd.cards[SLOT.A2]).to.equal(desiredCards[SLOT.A2]);
            expect(sd.cards[SLOT.B1]).to.equal(desiredCards[SLOT.B1]);
            expect(sd.cards[SLOT.B2]).to.equal(desiredCards[SLOT.B2]);
            expect(sd.cards[SLOT.FLOP1]).to.equal(desiredCards[SLOT.FLOP1]);
            expect(sd.cards[SLOT.FLOP2]).to.equal(desiredCards[SLOT.FLOP2]);
            expect(sd.cards[SLOT.FLOP3]).to.equal(desiredCards[SLOT.FLOP3]);
            expect(sd.cards[SLOT.TURN]).to.equal(desiredCards[SLOT.TURN]);
            expect(sd.cards[SLOT.RIVER]).to.equal(desiredCards[SLOT.RIVER]);
        });
    });
});
