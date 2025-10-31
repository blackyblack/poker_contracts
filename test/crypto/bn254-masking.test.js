import { expect } from "chai";
import hre from "hardhat";
import {
    generateSecretKey,
    pubkeyG2,
    hashToG1CardBase,
    wrap,
    unwrapInverse,
    finish,
    verifyPartialDecrypt,
    createDeck,
    maskDeck,
    unmaskDeck,
    shuffleArray,
    maskAndShufflePlayer1,
    maskAndShufflePlayer2,
    deckToSolidityFormat,
    g1PointToBytes,
    g2PointToBytes,
    createCardMapping
} from "../helpers/bn254-crypto.js";

const { ethers } = hre;

describe("BN254 Commutative Masking", function () {
    const ctx = "test-game-123";

    describe("Key Generation", function () {
        it("should generate valid secret keys", function () {
            const sk = generateSecretKey();
            
            expect(sk).to.be.a('bigint');
            expect(sk).to.be.greaterThan(0n);
        });

        it("should generate different keys each time", function () {
            const sk1 = generateSecretKey();
            const sk2 = generateSecretKey();
            
            expect(sk1).to.not.equal(sk2);
        });

        it("should compute G2 public key from secret key", function () {
            const sk = generateSecretKey();
            const pk = pubkeyG2(sk);
            
            expect(pk).to.not.be.undefined;
            const pkBytes = g2PointToBytes(pk);
            expect(pkBytes).to.have.length(258); // 0x + 128 bytes * 2 hex chars
        });
    });

    describe("Hash to G1 Card Base", function () {
        it("should generate deterministic card base points", function () {
            const R1 = hashToG1CardBase(ctx, 0);
            const R2 = hashToG1CardBase(ctx, 0);
            
            expect(R1.equals(R2)).to.be.true;
        });

        it("should generate different points for different card IDs", function () {
            const R0 = hashToG1CardBase(ctx, 0);
            const R1 = hashToG1CardBase(ctx, 1);
            
            expect(R0.equals(R1)).to.be.false;
        });

        it("should generate different points for different contexts", function () {
            const R1 = hashToG1CardBase("ctx1", 0);
            const R2 = hashToG1CardBase("ctx2", 0);
            
            expect(R1.equals(R2)).to.be.false;
        });
    });

    describe("Wrap and Unwrap", function () {
        it("should wrap and unwrap a point correctly", function () {
            const sk = generateSecretKey();
            const R = hashToG1CardBase(ctx, 42);
            
            const masked = wrap(R, sk);
            const unmasked = unwrapInverse(masked, sk);
            
            expect(unmasked.equals(R)).to.be.true;
        });

        it("should produce different masked points with different keys", function () {
            const sk1 = generateSecretKey();
            const sk2 = generateSecretKey();
            const R = hashToG1CardBase(ctx, 42);
            
            const masked1 = wrap(R, sk1);
            const masked2 = wrap(R, sk2);
            
            expect(masked1.equals(masked2)).to.be.false;
        });
    });

    describe("Commutative Property", function () {
        it("should satisfy commutativity: b·(a·R) = a·(b·R)", function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const R = hashToG1CardBase(ctx, 7);
            
            // Path 1: A masks first, then B
            const aR = wrap(R, skA);
            const baR = wrap(aR, skB);
            
            // Path 2: B masks first, then A
            const bR = wrap(R, skB);
            const abR = wrap(bR, skA);
            
            // Should be equal due to commutativity
            expect(baR.equals(abR)).to.be.true;
        });

        it("should unwrap in any order", function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const R = hashToG1CardBase(ctx, 7);
            
            // Double mask
            const aR = wrap(R, skA);
            const baR = wrap(aR, skB);
            
            // Unmask A first
            const unmaskedByA = unwrapInverse(baR, skA);
            const finalByB = unwrapInverse(unmaskedByA, skB);
            
            // Unmask B first
            const unmaskedByB = unwrapInverse(baR, skB);
            const finalByA = unwrapInverse(unmaskedByB, skA);
            
            // Both should recover R
            expect(finalByB.equals(R)).to.be.true;
            expect(finalByA.equals(R)).to.be.true;
        });
    });

    describe("Finish Operation", function () {
        it("should recover plaintext with finish", function () {
            const sk = generateSecretKey();
            const R = hashToG1CardBase(ctx, 42);
            
            const masked = wrap(R, sk);
            const recovered = finish(masked, sk);
            
            expect(recovered.equals(R)).to.be.true;
        });
    });

    describe("Deck Operations", function () {
        it("should create a deck of card base points", function () {
            const deck = createDeck(ctx, 9);
            
            expect(deck).to.have.length(9);
            expect(deck[0]).to.not.be.undefined;
            
            // All cards should be different
            for (let i = 0; i < deck.length; i++) {
                for (let j = i + 1; j < deck.length; j++) {
                    expect(deck[i].equals(deck[j])).to.be.false;
                }
            }
        });

        it("should mask entire deck", function () {
            const sk = generateSecretKey();
            const deck = createDeck(ctx, 9);
            
            const masked = maskDeck(deck, sk);
            
            expect(masked).to.have.length(9);
            // Masked cards should be different from originals
            for (let i = 0; i < deck.length; i++) {
                expect(masked[i].equals(deck[i])).to.be.false;
            }
        });

        it("should unmask entire deck", function () {
            const sk = generateSecretKey();
            const deck = createDeck(ctx, 9);
            
            const masked = maskDeck(deck, sk);
            const unmasked = unmaskDeck(masked, sk);
            
            // Should recover original deck
            for (let i = 0; i < deck.length; i++) {
                expect(unmasked[i].equals(deck[i])).to.be.true;
            }
        });

        it("should mask and shuffle by player 1", function () {
            const sk1 = generateSecretKey();
            const deck = createDeck(ctx, 9);
            
            const deck1 = maskAndShufflePlayer1(deck, sk1);
            
            expect(deck1).to.have.length(9);
        });

        it("should mask and shuffle by both players", function () {
            const sk1 = generateSecretKey();
            const sk2 = generateSecretKey();
            const deck = createDeck(ctx, 9);
            
            const deck1 = maskAndShufflePlayer1(deck, sk1);
            const deck2 = maskAndShufflePlayer2(deck1, sk2);
            
            expect(deck2).to.have.length(9);
        });

        it("should convert deck to Solidity format", function () {
            const sk1 = generateSecretKey();
            const sk2 = generateSecretKey();
            const deck = createDeck(ctx, 9);
            
            const deck1 = maskAndShufflePlayer1(deck, sk1);
            const deck2 = maskAndShufflePlayer2(deck1, sk2);
            const solidityDeck = deckToSolidityFormat(deck2);
            
            expect(solidityDeck).to.have.length(9);
            solidityDeck.forEach(card => {
                // 0x + 64 bytes * 2 hex chars = 130 chars
                expect(card).to.have.length(130);
                expect(card).to.match(/^0x[0-9a-f]{128}$/i);
            });
        });
    });

    describe("Card Mapping", function () {
        it("should create card ID to point mapping", function () {
            const mapping = createCardMapping(ctx, 52);
            
            expect(mapping.size).to.equal(52);
            
            // Verify mapping correctness
            const R0 = hashToG1CardBase(ctx, 0);
            const R0Hex = g1PointToBytes(R0);
            expect(mapping.get(R0Hex)).to.equal(0);
        });

        it("should allow card identification after unmasking", function () {
            const sk1 = generateSecretKey();
            const sk2 = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const mapping = createCardMapping(ctx, 9);
            
            // Double mask
            const deck1 = maskDeck(deck, sk1);
            const deck2 = maskDeck(deck1, sk2);
            
            // Unmask one card
            const card0Masked = deck2[0];
            const card0AfterB = unwrapInverse(card0Masked, sk2);
            const card0Plain = unwrapInverse(card0AfterB, sk1);
            
            // Identify card
            const card0Hex = g1PointToBytes(card0Plain);
            const cardId = mapping.get(card0Hex);
            
            expect(cardId).to.equal(0);
        });
    });

    describe("Format Conversion", function () {
        it("should convert G1 points to correct byte format", function () {
            const R = hashToG1CardBase(ctx, 0);
            const bytes = g1PointToBytes(R);
            
            // Should be 0x-prefixed hex string of 64 bytes
            expect(bytes).to.have.length(130); // 0x + 128 hex chars
            expect(bytes).to.match(/^0x[0-9a-f]{128}$/i);
        });

        it("should convert G2 points to correct byte format", function () {
            const sk = generateSecretKey();
            const pk = pubkeyG2(sk);
            const bytes = g2PointToBytes(pk);
            
            // Should be 0x-prefixed hex string of 128 bytes
            expect(bytes).to.have.length(258); // 0x + 256 hex chars
            expect(bytes).to.match(/^0x[0-9a-f]{256}$/i);
        });
    });

    describe("Shuffle Algorithm", function () {
        it("should shuffle arrays", function () {
            const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8];
            const shuffled = shuffleArray(arr);
            
            expect(shuffled).to.have.length(9);
            // All elements should still be present
            expect(shuffled.sort()).to.deep.equal(arr.sort());
        });
    });
});
