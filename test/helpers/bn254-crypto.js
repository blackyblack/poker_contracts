/**
 * BN254 encryption/decryption helpers for mental poker
 * 
 * This implements ElGamal encryption on the BN254 curve.
 * Mental poker requires double encryption where each player encrypts the deck.
 */

import { bn254 } from '@noble/curves/bn254.js';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';

// BN254 G1 generator point
const G1 = bn254.G1.Point.BASE;

// BN254 G2 generator point  
const G2 = bn254.G2.Point.BASE;

/**
 * Generate a random BN254 keypair
 * @returns {Object} { secretKey: bigint, publicKeyG1: Point, publicKeyG2: Point }
 */
export function generateKeyPair() {
    // Generate random secret key using proper random generation
    const secretKeyBytes = bn254.utils.randomSecretKey();
    const secretKey = BigInt('0x' + Buffer.from(secretKeyBytes).toString('hex'));
    
    // Compute public keys
    const publicKeyG1 = G1.multiply(secretKey);
    const publicKeyG2 = G2.multiply(secretKey);
    
    return {
        secretKey,
        publicKeyG1,
        publicKeyG2
    };
}

// Cache for card encoding lookups
const cardEncodingCache = new Map();

/**
 * Encode a card value as a BN254 G1 point using hash-to-curve
 * @param {number} cardValue - Card value (0-51 for standard deck, 0-255 for byte)
 * @returns {Point} G1 point representing the card
 */
export function encodeCard(cardValue) {
    // Check cache first
    if (cardEncodingCache.has(cardValue)) {
        return cardEncodingCache.get(cardValue);
    }
    
    // Simple encoding: multiply generator by (cardValue + 1)
    // We add 1 to avoid the identity element for card 0
    const scalar = bn254.fields.Fr.create(BigInt(cardValue) + 1n);
    const point = G1.multiply(scalar);
    
    // Cache the result
    cardEncodingCache.set(cardValue, point);
    
    return point;
}

/**
 * Encrypt a G1 point using ElGamal encryption
 * @param {Point} message - G1 point to encrypt (the card)
 * @param {Point} publicKeyG1 - Recipient's public key on G1
 * @param {bigint} randomness - Optional randomness (for deterministic testing)
 * @returns {Object} { U: Point, V: Point } - Encrypted point pair
 */
export function encryptPoint(message, publicKeyG1, randomness = null) {
    // Generate random scalar r using proper random generation
    let r;
    if (randomness !== null) {
        r = randomness;
    } else {
        const rBytes = bn254.utils.randomSecretKey();
        r = BigInt('0x' + Buffer.from(rBytes).toString('hex'));
    }
    
    // U = r * G1
    const U = G1.multiply(r);
    
    // V = M + r * pk
    const V = message.add(publicKeyG1.multiply(r));
    
    return { U, V };
}

/**
 * Partially decrypt an encrypted point (remove one layer of encryption)
 * @param {Point} U - First component of ciphertext
 * @param {bigint} secretKey - Secret key for decryption
 * @returns {Point} Y - Partial decryption (U * secretKey)
 */
export function partialDecrypt(U, secretKey) {
    // Y = U * sk = (r * G1) * sk = r * (sk * G1) = r * pk
    return U.multiply(secretKey);
}

/**
 * Complete decryption using partial decryption
 * @param {Point} V - Second component of ciphertext
 * @param {Point} Y - Partial decryption from partialDecrypt
 * @returns {Point} M - Decrypted message
 */
export function completeDecrypt(V, Y) {
    // M = V - Y = (M + r * pk) - (r * pk) = M
    return V.subtract(Y);
}

/**
 * Fully decrypt an encrypted point
 * @param {Object} ciphertext - { U: Point, V: Point }
 * @param {bigint} secretKey - Secret key for decryption
 * @returns {Point} Decrypted message
 */
export function decryptPoint(ciphertext, secretKey) {
    const Y = partialDecrypt(ciphertext.U, secretKey);
    return completeDecrypt(ciphertext.V, Y);
}

/**
 * Decode a card from a G1 point (reverse of encodeCard)
 * @param {Point} point - G1 point to decode
 * @returns {number} Card value (0-51 for standard deck)
 */
export function decodeCard(point) {
    // Check cache (reverse lookup)
    for (const [cardValue, cachedPoint] of cardEncodingCache.entries()) {
        if (point.equals(cachedPoint)) {
            return cardValue;
        }
    }
    
    // Brute force search for values not in cache (should be rare after first use)
    for (let i = 0; i < 256; i++) {
        const testPoint = encodeCard(i);
        if (point.equals(testPoint)) {
            return i;
        }
    }
    throw new Error('Could not decode card - point not found in valid range');
}

/**
 * Convert a G1 point to bytes for Solidity (uncompressed format: x || y)
 * @param {Point} point - G1 point
 * @returns {string} Hex string of 64 bytes (32 bytes x, 32 bytes y)
 */
export function g1PointToBytes(point) {
    const affine = point.toAffine();
    const x = ethers.zeroPadValue(ethers.toBeHex(affine.x), 32);
    const y = ethers.zeroPadValue(ethers.toBeHex(affine.y), 32);
    return ethers.concat([x, y]);
}

/**
 * Convert a G2 point to bytes for Solidity (uncompressed format)
 * G2 points are in Fp2, so each coordinate is (a, b) where the value is a + b*i
 * EVM format: x.a || x.b || y.a || y.b (imaginary first, then real)
 * @param {Point} point - G2 point
 * @returns {string} Hex string of 128 bytes
 */
export function g2PointToBytes(point) {
    const affine = point.toAffine();
    
    // G2 coordinates are in Fp2: {c0: real part, c1: imaginary part}
    // EVM expects: [x_imaginary, x_real, y_imaginary, y_real]
    const xImag = ethers.zeroPadValue(ethers.toBeHex(affine.x.c1), 32);
    const xReal = ethers.zeroPadValue(ethers.toBeHex(affine.x.c0), 32);
    const yImag = ethers.zeroPadValue(ethers.toBeHex(affine.y.c1), 32);
    const yReal = ethers.zeroPadValue(ethers.toBeHex(affine.y.c0), 32);
    
    return ethers.concat([xImag, xReal, yImag, yReal]);
}

/**
 * Encrypt a full deck with a player's public key
 * @param {Array<Point>} deck - Array of G1 points representing cards
 * @param {Point} publicKeyG1 - Player's public key on G1
 * @returns {Array<Object>} Array of encrypted cards { U, V }
 */
export function encryptDeck(deck, publicKeyG1) {
    return deck.map(card => encryptPoint(card, publicKeyG1));
}

/**
 * Shuffle an array using Fisher-Yates algorithm with cryptographically secure randomness
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
export function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        // Use cryptographically secure random bytes
        const randomBuffer = randomBytes(4);
        const randomValue = randomBuffer.readUInt32BE(0);
        // Calculate j with uniform distribution
        const j = Math.floor((randomValue / 0x100000000) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Create a standard deck of cards (0-51 representing a 52-card deck)
 * For poker we only need 9 cards per hand, but we can create a full deck
 * @returns {Array<Point>} Array of G1 points representing cards
 */
export function createDeck(numCards = 52) {
    const deck = [];
    for (let i = 0; i < numCards; i++) {
        deck.push(encodeCard(i));
    }
    return deck;
}

/**
 * Encrypt and shuffle a deck by player 1
 * @param {Array<Point>} plaintextDeck - Array of plaintext card points
 * @param {Point} player1PublicKeyG1 - Player 1's public key on G1
 * @returns {Array<Object>} Shuffled and encrypted deck
 */
export function encryptAndShufflePlayer1(plaintextDeck, player1PublicKeyG1) {
    const encrypted = encryptDeck(plaintextDeck, player1PublicKeyG1);
    return shuffleArray(encrypted);
}

/**
 * Re-encrypt and shuffle a deck by player 2 (already encrypted by player 1)
 * Each card in the input is { U, V } from player 1's encryption
 * Player 2 adds another layer: (U1, V1) -> (U2, V2) = (r2*G1, V1 + r2*pk2)
 * @param {Array<Object>} player1Deck - Deck encrypted by player 1 [{ U, V }]
 * @param {Point} player2PublicKeyG1 - Player 2's public key on G1
 * @returns {Array<Object>} Doubly encrypted and shuffled deck with both U values
 */
export function encryptAndShufflePlayer2(player1Deck, player2PublicKeyG1) {
    // For each card { U: U1, V: V1 }, create new layer of encryption
    // Result: { U1: U1, U2: U2, V2: V2 } where (U2, V2) = encrypt(V1)
    const doubleEncrypted = player1Deck.map(card => {
        const r2Bytes = bn254.utils.randomSecretKey();
        const r2 = BigInt('0x' + Buffer.from(r2Bytes).toString('hex'));
        const U2 = G1.multiply(r2);
        const V2 = card.V.add(player2PublicKeyG1.multiply(r2));
        
        return { 
            U1: card.U,  // Keep U1 for player 1's decryption
            U2: U2,      // U2 for player 2's decryption
            V2: V2       // Final encrypted value
        };
    });
    
    return shuffleArray(doubleEncrypted);
}

/**
 * Convert a doubly encrypted deck to Solidity format
 * For mental poker with 2 players, the deck needs to contain:
 * - U1: Player 1's randomness (for Player 1's partial decrypt)
 * - U2: Player 2's randomness (for Player 2's partial decrypt)  
 * - V2: The fully encrypted card value
 * 
 * For startGame, we pass an array where each element contains all three values
 * 
 * @param {Array<Object>} deck - Doubly encrypted deck with { U1, U2, V2 }
 * @returns {Array<string>} Array of hex strings, each containing U1||U2||V2 (192 bytes total)
 */
export function deckToSolidityFormat(deck) {
    // Each card is represented as U1 (64 bytes) || U2 (64 bytes) || V2 (64 bytes)
    return deck.map(card => {
        const u1Bytes = g1PointToBytes(card.U1);
        const u2Bytes = g1PointToBytes(card.U2);
        const v2Bytes = g1PointToBytes(card.V2);
        return ethers.concat([u1Bytes, u2Bytes, v2Bytes]);
    });
}

/**
 * Generate partial decryptions for player's hole cards
 * @param {Array<Object>} deck - Doubly encrypted deck with { U1, U2, V2 }
 * @param {Array<number>} indices - Indices of cards to decrypt
 * @param {bigint} secretKey - Player's secret key
 * @param {number} player - Player number (1 or 2) - determines which U to use
 * @returns {Array<string>} Array of partial decryptions as hex strings (64 bytes each)
 */
export function generatePartialDecryptions(deck, indices, secretKey, player) {
    return indices.map(idx => {
        const card = deck[idx];
        // Player 2 uses U2, Player 1 uses U1
        const U = player === 2 ? card.U2 : card.U1;
        const Y = partialDecrypt(U, secretKey);
        return g1PointToBytes(Y);
    });
}
