import { expect } from "chai";
import hre from "hardhat";
import {
    generateKeyPair,
    encodeCard,
    encryptPoint,
    decryptPoint,
    partialDecrypt,
    completeDecrypt,
    decodeCard,
    createDeck,
    encryptDeck,
    encryptAndShufflePlayer1,
    encryptAndShufflePlayer2,
    deckToSolidityFormat,
    g1PointToBytes,
    g2PointToBytes
} from "../helpers/bn254-crypto.js";

const { ethers } = hre;

describe("BN254 Encryption/Decryption", function () {
    describe("Key Generation", function () {
        it("should generate valid keypairs", function () {
            const keypair = generateKeyPair();
            
            expect(keypair.secretKey).to.be.a('bigint');
            expect(keypair.publicKeyG1).to.not.be.undefined;
            expect(keypair.publicKeyG2).to.not.be.undefined;
            
            // Check G1 public key is valid
            const g1Bytes = g1PointToBytes(keypair.publicKeyG1);
            expect(g1Bytes).to.have.length(130); // 0x + 64 bytes * 2 hex chars
            
            // Check G2 public key is valid
            const g2Bytes = g2PointToBytes(keypair.publicKeyG2);
            expect(g2Bytes).to.have.length(258); // 0x + 128 bytes * 2 hex chars
        });

        it("should generate different keypairs each time", function () {
            const keypair1 = generateKeyPair();
            const keypair2 = generateKeyPair();
            
            expect(keypair1.secretKey).to.not.equal(keypair2.secretKey);
        });
    });

    describe("Card Encoding/Decoding", function () {
        it("should encode and decode cards correctly", function () {
            for (let i = 0; i < 10; i++) {
                const encoded = encodeCard(i);
                const decoded = decodeCard(encoded);
                expect(decoded).to.equal(i);
            }
        });

        it("should encode different cards to different points", function () {
            const card1 = encodeCard(0);
            const card2 = encodeCard(1);
            
            expect(card1.equals(card2)).to.be.false;
        });
    });

    describe("Single Layer Encryption/Decryption", function () {
        it("should encrypt and decrypt a card", function () {
            const keypair = generateKeyPair();
            const cardValue = 42;
            const card = encodeCard(cardValue);
            
            const encrypted = encryptPoint(card, keypair.publicKeyG1);
            const decrypted = decryptPoint(encrypted, keypair.secretKey);
            const decoded = decodeCard(decrypted);
            
            expect(decoded).to.equal(cardValue);
        });

        it("should produce different ciphertexts for same plaintext", function () {
            const keypair = generateKeyPair();
            const card = encodeCard(42);
            
            const encrypted1 = encryptPoint(card, keypair.publicKeyG1);
            const encrypted2 = encryptPoint(card, keypair.publicKeyG1);
            
            // Different randomness should produce different ciphertexts
            expect(encrypted1.U.equals(encrypted2.U)).to.be.false;
            expect(encrypted1.V.equals(encrypted2.V)).to.be.false;
        });

        it("should support partial decryption", function () {
            const keypair = generateKeyPair();
            const card = encodeCard(42);
            
            const encrypted = encryptPoint(card, keypair.publicKeyG1);
            const Y = partialDecrypt(encrypted.U, keypair.secretKey);
            const decrypted = completeDecrypt(encrypted.V, Y);
            const decoded = decodeCard(decrypted);
            
            expect(decoded).to.equal(42);
        });
    });

    describe("Double Encryption (Mental Poker)", function () {
        it("should encrypt by player 1, then player 2, then decrypt by both", function () {
            const player1 = generateKeyPair();
            const player2 = generateKeyPair();
            const cardValue = 7;
            const card = encodeCard(cardValue);
            
            // Player 1 encrypts
            const enc1 = encryptPoint(card, player1.publicKeyG1);
            
            // Player 2 encrypts the result (both U and V components)
            const enc2U = encryptPoint(enc1.U, player2.publicKeyG1);
            const enc2V = encryptPoint(enc1.V, player2.publicKeyG1);
            
            // Player 2 partially decrypts first
            const Y2_U = partialDecrypt(enc2U.U, player2.secretKey);
            const Y2_V = partialDecrypt(enc2V.U, player2.secretKey);
            const intermediate_U = completeDecrypt(enc2U.V, Y2_U);
            const intermediate_V = completeDecrypt(enc2V.V, Y2_V);
            
            // Player 1 partially decrypts
            const Y1 = partialDecrypt(intermediate_U, player1.secretKey);
            const finalCard = completeDecrypt(intermediate_V, Y1);
            
            const decoded = decodeCard(finalCard);
            expect(decoded).to.equal(cardValue);
        });
    });

    describe("Deck Operations", function () {
        it("should create a deck of encoded cards", function () {
            const deck = createDeck(9); // 9 cards for poker
            
            expect(deck).to.have.length(9);
            expect(deck[0]).to.not.be.undefined;
            expect(deck[8]).to.not.be.undefined;
        });

        it("should encrypt a deck", function () {
            const keypair = generateKeyPair();
            const deck = createDeck(9);
            
            const encrypted = encryptDeck(deck, keypair.publicKeyG1);
            
            expect(encrypted).to.have.length(9);
            expect(encrypted[0].U).to.not.be.undefined;
            expect(encrypted[0].V).to.not.be.undefined;
        });

        it("should encrypt and shuffle by player 1", function () {
            const player1 = generateKeyPair();
            const deck = createDeck(9);
            
            const encrypted = encryptAndShufflePlayer1(deck, player1.publicKeyG1);
            
            expect(encrypted).to.have.length(9);
        });

        it("should encrypt and shuffle by both players", function () {
            const player1 = generateKeyPair();
            const player2 = generateKeyPair();
            const deck = createDeck(9);
            
            const deck1 = encryptAndShufflePlayer1(deck, player1.publicKeyG1);
            const deck2 = encryptAndShufflePlayer2(deck1, player2.publicKeyG1);
            
            expect(deck2).to.have.length(9);
            expect(deck2[0].U1).to.not.be.undefined;
            expect(deck2[0].U2).to.not.be.undefined;
            expect(deck2[0].V2).to.not.be.undefined;
        });

        it("should convert deck to Solidity format", function () {
            const player1 = generateKeyPair();
            const player2 = generateKeyPair();
            const deck = createDeck(9);
            
            const deck1 = encryptAndShufflePlayer1(deck, player1.publicKeyG1);
            const deck2 = encryptAndShufflePlayer2(deck1, player2.publicKeyG1);
            const solidityDeck = deckToSolidityFormat(deck2);
            
            expect(solidityDeck).to.have.length(9);
            solidityDeck.forEach(card => {
                // 0x + 192 bytes * 2 hex chars = 386 chars (U1||U2||V2)
                expect(card).to.have.length(386);
                expect(card).to.match(/^0x[0-9a-f]{384}$/i);
            });
        });
    });

    describe("Format Conversion", function () {
        it("should convert G1 points to correct byte format", function () {
            const keypair = generateKeyPair();
            const g1Bytes = g1PointToBytes(keypair.publicKeyG1);
            
            // Should be 0x-prefixed hex string of 64 bytes
            expect(g1Bytes).to.have.length(130); // 0x + 128 hex chars
            expect(g1Bytes).to.match(/^0x[0-9a-f]{128}$/i);
        });

        it("should convert G2 points to correct byte format", function () {
            const keypair = generateKeyPair();
            const g2Bytes = g2PointToBytes(keypair.publicKeyG2);
            
            // Should be 0x-prefixed hex string of 128 bytes
            expect(g2Bytes).to.have.length(258); // 0x + 256 hex chars
            expect(g2Bytes).to.match(/^0x[0-9a-f]{256}$/i);
        });
    });
});
