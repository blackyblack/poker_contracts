# CardVerifier Library

## Overview

The `CardVerifier` library provides functions to verify card decryption data in mental poker games using BN254 elliptic curve cryptography. It allows players to force their opponents to provide the necessary data to reveal hole cards and public cards (flop, turn, river), with cryptographic verification that the decryption is correct.

## Mental Poker Protocol

In mental poker, cards are encrypted using a two-party protocol:

1. **Encryption**: Both players sequentially encrypt the deck using their secret keys
2. **Distribution**: Cards are distributed in encrypted form
3. **Decryption**: To reveal a card, the appropriate player(s) must provide decryption data
   - For **hole cards**: Only the opponent needs to decrypt (since each player already knows their own cards)
   - For **public cards** (flop, turn, river): Both players must provide sequential decryptions

## Functions

### verifyHoleA

Verifies player A's hole cards (first two cards in the deck, at indices 0 and 1).

```solidity
function verifyHoleA(
    bytes memory pkB,
    bytes[] memory bDeckSigned,
    bytes memory card1Opener,
    bytes memory card2Opener
) internal view returns (bool)
```

**Parameters:**
- `pkB`: Player B's G2 public key (128 bytes)
- `bDeckSigned`: The fully encrypted deck (array of G1 points, each 64 bytes)
- `card1Opener`: First hole card decrypted by player B (G1 point, 64 bytes)
- `card2Opener`: Second hole card decrypted by player B (G1 point, 64 bytes)

**Returns:** `true` if both cards are correctly decrypted

**Verification:** Checks `e(bDeckSigned[i], pkB) == e(cardOpener[i], G2_BASE)` for i=0,1

### verifyHoleB

Verifies player B's hole cards (cards at indices 2 and 3 in the deck).

```solidity
function verifyHoleB(
    bytes memory pkA,
    bytes[] memory bDeckSigned,
    bytes memory card1Opener,
    bytes memory card2Opener
) internal view returns (bool)
```

**Parameters:**
- `pkA`: Player A's G2 public key (128 bytes)
- `bDeckSigned`: The fully encrypted deck (array of G1 points, each 64 bytes)
- `card1Opener`: Third card in deck decrypted by player A (G1 point, 64 bytes)
- `card2Opener`: Fourth card in deck decrypted by player A (G1 point, 64 bytes)

**Returns:** `true` if both cards are correctly decrypted

**Verification:** Checks `e(bDeckSigned[i], pkA) == e(cardOpener[i], G2_BASE)` for i=2,3

### verifyFlop

Verifies the three flop cards (cards at indices 4, 5, and 6 in the deck).

```solidity
function verifyFlop(
    bytes memory pkA,
    bytes memory pkB,
    bytes[] memory bDeckSigned,
    bytes[] memory cardAOpeners,
    bytes[] memory cardBOpeners
) internal view returns (bool)
```

**Parameters:**
- `pkA`: Player A's G2 public key (128 bytes)
- `pkB`: Player B's G2 public key (128 bytes)
- `bDeckSigned`: The fully encrypted deck (array of G1 points, each 64 bytes)
- `cardAOpeners`: Array of 3 G1 points partially decrypted by player A (each 64 bytes)
- `cardBOpeners`: Array of 3 G1 points fully decrypted by player B (each 64 bytes)

**Returns:** `true` if all three flop cards are correctly decrypted

**Verification:** For each flop card i (i=0,1,2):
1. `e(bDeckSigned[4+i], pkA) == e(cardAOpeners[i], G2_BASE)`
2. `e(cardAOpeners[i], pkB) == e(cardBOpeners[i], G2_BASE)`

### verifyTurn

Verifies the turn card (card at index 7 in the deck).

```solidity
function verifyTurn(
    bytes memory pkA,
    bytes memory pkB,
    bytes[] memory bDeckSigned,
    bytes memory cardAOpener,
    bytes memory cardBOpener
) internal view returns (bool)
```

**Parameters:**
- `pkA`: Player A's G2 public key (128 bytes)
- `pkB`: Player B's G2 public key (128 bytes)
- `bDeckSigned`: The fully encrypted deck (array of G1 points, each 64 bytes)
- `cardAOpener`: Turn card partially decrypted by player A (G1 point, 64 bytes)
- `cardBOpener`: Turn card fully decrypted by player B (G1 point, 64 bytes)

**Returns:** `true` if the turn card is correctly decrypted

**Verification:**
1. `e(bDeckSigned[7], pkA) == e(cardAOpener, G2_BASE)`
2. `e(cardAOpener, pkB) == e(cardBOpener, G2_BASE)`

### verifyRiver

Verifies the river card (card at index 8 in the deck).

```solidity
function verifyRiver(
    bytes memory pkA,
    bytes memory pkB,
    bytes[] memory bDeckSigned,
    bytes memory cardAOpener,
    bytes memory cardBOpener
) internal view returns (bool)
```

**Parameters:**
- `pkA`: Player A's G2 public key (128 bytes)
- `pkB`: Player B's G2 public key (128 bytes)
- `bDeckSigned`: The fully encrypted deck (array of G1 points, each 64 bytes)
- `cardAOpener`: River card partially decrypted by player A (G1 point, 64 bytes)
- `cardBOpener`: River card fully decrypted by player B (G1 point, 64 bytes)

**Returns:** `true` if the river card is correctly decrypted

**Verification:**
1. `e(bDeckSigned[8], pkA) == e(cardAOpener, G2_BASE)`
2. `e(cardAOpener, pkB) == e(cardBOpener, G2_BASE)`

## Usage Example

```solidity
import "./CardVerifier.sol";

contract PokerGame {
    function verifyPlayerAHoles(
        bytes memory pkB,
        bytes[] memory deck,
        bytes memory card1,
        bytes memory card2
    ) public view returns (bool) {
        return CardVerifier.verifyHoleA(pkB, deck, card1, card2);
    }
    
    function verifyFlopCards(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory deck,
        bytes[] memory aOpeners,
        bytes[] memory bOpeners
    ) public view returns (bool) {
        return CardVerifier.verifyFlop(pkA, pkB, deck, aOpeners, bOpeners);
    }
}
```

## Security Considerations

1. **Public Keys**: The G2 public keys must be generated correctly and kept consistent throughout the game
2. **Deck Integrity**: The `bDeckSigned` array must be the result of proper sequential encryption by both players
3. **Verification Order**: For public cards, player A's partial decryption must be verified before player B's
4. **Length Validation**: All functions include length checks to prevent incorrect data formats
5. **Pairing Checks**: The library uses BN254 pairing precompiles for cryptographic verification

## Dependencies

- `Bn254.sol`: Provides the `verifyPartialDecrypt` function using BN254 pairing precompiles
- Solidity 0.8.24

## Testing

Comprehensive tests are provided in `test/crypto/card-verifier.test.js`. Run tests with:

```bash
npm test
```

## License

MIT
