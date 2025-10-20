# CardVerifier Library

## Overview

The `CardVerifier` library provides functions to verify card decryption data in mental poker games using BN254 elliptic curve cryptography. It allows players to force their opponents to provide the necessary data to reveal hole cards and public cards (flop, turn, river), with cryptographic verification that the decryption is correct.

## Mental Poker Protocol

In mental poker, cards are encrypted using a two-party protocol:

1. **Encryption**: Both players sequentially encrypt the deck using their secret keys
2. **Distribution**: Cards are distributed in encrypted form
3. **Decryption**: To reveal a card, the appropriate player(s) must provide decryption data
   - For **hole cards**: Only the opponent needs to decrypt (since each player already knows their own cards)
   - For **public cards** (flop, turn, river): Both players must independently decrypt from the encrypted deck

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

### verifyPublic

Verifies a public card at a specified index in the deck (used for flop, turn, and river cards).

```solidity
function verifyPublic(
    bytes memory pkA,
    bytes memory pkB,
    bytes[] memory bDeckSigned,
    bytes memory cardAOpener,
    bytes memory cardBOpener,
    uint256 cardIndex
) internal view returns (bool)
```

**Parameters:**
- `pkA`: Player A's G2 public key (128 bytes)
- `pkB`: Player B's G2 public key (128 bytes)
- `bDeckSigned`: The fully encrypted deck (array of G1 points, each 64 bytes)
- `cardAOpener`: Card decrypted by player A (G1 point, 64 bytes)
- `cardBOpener`: Card decrypted by player B (G1 point, 64 bytes)
- `cardIndex`: Index of the card in the deck (e.g., 4-6 for flop, 7 for turn, 8 for river)

**Returns:** `true` if the card is correctly decrypted by both players

**Verification:** Both players independently decrypt from the encrypted deck:
1. `e(bDeckSigned[cardIndex], pkA) == e(cardAOpener, G2_BASE)`
2. `e(bDeckSigned[cardIndex], pkB) == e(cardBOpener, G2_BASE)`

**Usage Examples:**
- Flop cards: `verifyPublic(pkA, pkB, deck, openerA, openerB, 4)` for first flop card
- Turn card: `verifyPublic(pkA, pkB, deck, openerA, openerB, 7)`
- River card: `verifyPublic(pkA, pkB, deck, openerA, openerB, 8)`

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
    
    function verifyFlopCard(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory deck,
        bytes memory aOpener,
        bytes memory bOpener,
        uint256 cardIndex
    ) public view returns (bool) {
        return CardVerifier.verifyPublic(pkA, pkB, deck, aOpener, bOpener, cardIndex);
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
