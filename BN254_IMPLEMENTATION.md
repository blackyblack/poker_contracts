# BN254 Encryption Implementation Summary

## Overview
This implementation adds BN254 elliptic curve encryption/decryption primitives for mental poker card verification, along with comprehensive tests using different encryption keys for each player.

## Components Implemented

### 1. BN254 Cryptography Helper (`test/helpers/bn254-crypto.js`)

**Core Functions:**
- `generateKeyPair()` - Generates random BN254 keypairs (secretKey, publicKeyG1, publicKeyG2)
- `encodeCard(cardValue)` - Encodes card values as BN254 G1 points
- `encryptPoint(message, publicKeyG1)` - ElGamal encryption on G1
- `partialDecrypt(U, secretKey)` - Partial decryption for multi-party scenarios
- `decryptPoint(ciphertext, secretKey)` - Full decryption
- `decodeCard(point)` - Recovers card value from G1 point

**Mental Poker Functions:**
- `encryptAndShufflePlayer1(deck, pk1)` - Player 1 encrypts and shuffles deck
- `encryptAndShufflePlayer2(deck1, pk2)` - Player 2 re-encrypts and shuffles
- `deckToSolidityFormat(deck)` - Converts encrypted deck to Solidity-compatible format
- `g1PointToBytes(point)` - Converts G1 points to 64-byte hex strings
- `g2PointToBytes(point)` - Converts G2 points to 128-byte hex strings

**Encryption Scheme:**
- Uses ElGamal encryption on BN254 curve
- Double encryption: Player 1 encrypts, then Player 2 re-encrypts
- Final deck format: Each card contains (U1, U2, V2) - 192 bytes total
  - U1: Player 1's randomness (for Player 1's partial decrypt)
  - U2: Player 2's randomness (for Player 2's partial decrypt)
  - V2: Fully encrypted card value

### 2. Test Suites

#### BN254 Encryption Tests (`test/crypto/bn254-encryption.test.js`)
- Key generation and validation (15 tests)
- Card encoding/decoding
- Single and double layer encryption
- Deck operations (creation, encryption, shuffling)
- Format conversions

#### Card Verification with Different Keys (`test/crypto/card-verifier-with-keys.test.js`)
- **Player A hole card verification** (2 tests)
  - Verifies valid partial decryptions with Player 2's key
  - Rejects invalid decryptions
  
- **Player B hole card verification** (2 tests)
  - Verifies valid partial decryptions with Player 1's key
  - Rejects invalid decryptions
  
- **Full deck verification** (1 test)
  - Verifies all hole cards for both players using different keys

**Note:** Public card verification tests are skipped because the current CardVerifier design doesn't fully support double encryption for public cards (it expects both players to decrypt the same U value, which isn't compatible with independent random ness from each player).

#### StartGame Integration Tests (`test/game-logic/start-game-encrypted.test.js`)
- **Basic startGame functionality** (9 tests)
  - Both players can submit encrypted deck hashes
  - GameStarted event is emitted when hashes match
  - Prevents game start when hashes don't match
  - Validates deck structure (9 cards, 192 bytes each)
  - Prevents starting game twice

- **Integration tests** (2 tests)
  - Works with independently generated keys
  - Different encryptions produce different hashes

### 3. Dependencies Added
- `@noble/curves` - BN254 curve operations library

## Key Features

### Different Keys for Each Player
All new tests use different, independently generated BN254 keypairs for Player 1 and Player 2, as required.

### Proper Double Encryption
The implementation correctly handles double encryption:
1. Player 1 encrypts deck with their key: (U1, V1) = (r1·G1, M + r1·pk1)
2. Player 2 re-encrypts with their key: (U2, V2) = (r2·G1, V1 + r2·pk2)
3. Final: V2 = M + r1·pk1 + r2·pk2

### Partial Decryption Verification
- Player B verifies Player A's hole cards using U2 (Player 2's randomness)
- Player A verifies Player B's hole cards using U1 (Player 1's randomness)
- Verification uses BN254 pairing: e(U, pkG2) == e(Y, G2_BASE)

### Deck Format for startGame
- Each card: U1 (64 bytes) || U2 (64 bytes) || V2 (64 bytes) = 192 bytes
- Deck has 9 cards (for Texas Hold'em: 2 hole cards per player + 5 community cards)
- Both players submit the same encrypted deck to startGame
- Game starts when both hashes match and GameStarted event is emitted

## Test Results
- **Total tests:** 263 passing (32 new tests added)
- **4 pending** (public card verification - design limitation noted)
- **All original tests still pass** - no regressions

## Files Modified/Created
- `test/helpers/bn254-crypto.js` - New encryption helper (273 lines)
- `test/crypto/bn254-encryption.test.js` - Encryption tests (226 lines)
- `test/crypto/card-verifier-with-keys.test.js` - Card verification tests (293 lines)
- `test/game-logic/start-game-encrypted.test.js` - Integration tests (184 lines)
- `test/crypto/bn254-verify-debug.test.js` - Debug test (42 lines)
- `test/helpers/test-utils.js` - Added createEncryptedDeck helper
- `package.json` - Added @noble/curves dependency
- `package-lock.json` - Updated with new dependency

## Usage Example

```javascript
import { generateKeyPair, createDeck, encryptAndShufflePlayer1, 
         encryptAndShufflePlayer2, deckToSolidityFormat } from './test/helpers/bn254-crypto.js';

// Generate different keys for each player
const player1Keys = generateKeyPair();
const player2Keys = generateKeyPair();

// Create and encrypt deck
const plaintextDeck = createDeck(9);
const deck1 = encryptAndShufflePlayer1(plaintextDeck, player1Keys.publicKeyG1);
const deck2 = encryptAndShufflePlayer2(deck1, player2Keys.publicKeyG1);
const solidityDeck = deckToSolidityFormat(deck2);

// Submit to contract
await escrow.connect(player1).startGame(channelId, solidityDeck);
await escrow.connect(player2).startGame(channelId, solidityDeck);
// GameStarted event is emitted
```

## Limitations and Future Work

1. **Public Card Verification**: The current CardVerifier.verifyPublic() design doesn't support proper double encryption. It expects both players to verify the same U value, but in double encryption, each player has their own independent randomness (U1 and U2). This would require redesigning the verification logic.

2. **Full Decryption**: The implementation shows how to partially decrypt (remove one layer), but doesn't include helpers for full decryption to recover the original card value. This would require both players to provide their partial decryptions in sequence.

3. **Deck Storage**: The on-chain deck format stores all three components (U1, U2, V2). This could be optimized depending on actual usage patterns.
