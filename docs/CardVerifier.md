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
    bytes memory card1Encrypted,
    bytes memory card1Opener,
    bytes memory card2Encrypted,
    bytes memory card2Opener
) internal view returns (bool)
```

**Parameters:**
- `pkB`: Player B's G2 public key (128 bytes)
- `card1Encrypted`: First hole card encrypted by both players (G1 point, 64 bytes)
- `card1Opener`: First hole card decrypted by player B (G1 point, 64 bytes)
- `card2Encrypted`: Second hole card encrypted by both players (G1 point, 64 bytes)
- `card2Opener`: Second hole card decrypted by player B (G1 point, 64 bytes)

**Returns:** `true` if both cards are correctly decrypted

**Verification:** Checks `e(cardEncrypted, pkB) == e(cardOpener, G2_BASE)` for each hole card

### verifyHoleB

Verifies player B's hole cards (cards at indices 2 and 3 in the deck).

```solidity
function verifyHoleB(
    bytes memory pkA,
    bytes memory card1Encrypted,
    bytes memory card1Opener,
    bytes memory card2Encrypted,
    bytes memory card2Opener
) internal view returns (bool)
```

**Parameters:**
- `pkA`: Player A's G2 public key (128 bytes)
- `card1Encrypted`: Third card in deck encrypted by both players (G1 point, 64 bytes)
- `card1Opener`: Third card decrypted by player A (G1 point, 64 bytes)
- `card2Encrypted`: Fourth card in deck encrypted by both players (G1 point, 64 bytes)
- `card2Opener`: Fourth card decrypted by player A (G1 point, 64 bytes)

**Returns:** `true` if both cards are correctly decrypted

**Verification:** Checks `e(cardEncrypted, pkA) == e(cardOpener, G2_BASE)` for each hole card

### verifyPublic

Verifies a public card at a specified index in the deck (used for flop, turn, and river cards).

```solidity
function verifyPublic(
    bytes memory pkA,
    bytes memory pkB,
    bytes memory cardEncrypted,
    bytes memory cardAOpener,
    bytes memory cardBOpener
) internal view returns (bool)
```

**Parameters:**
- `pkA`: Player A's G2 public key (128 bytes)
- `pkB`: Player B's G2 public key (128 bytes)
- `cardEncrypted`: Public card encrypted by both players (G1 point, 64 bytes)
- `cardAOpener`: Card decrypted by player A (G1 point, 64 bytes)
- `cardBOpener`: Card decrypted by player B (G1 point, 64 bytes)

**Returns:** `true` if the card is correctly decrypted by both players

**Verification:** Both players independently decrypt the same encrypted card:
1. `e(cardEncrypted, pkA) == e(cardAOpener, G2_BASE)`
2. `e(cardEncrypted, pkB) == e(cardBOpener, G2_BASE)`

**Usage Examples:**
- Flop cards: `verifyPublic(pkA, pkB, cardEncrypted, openerA, openerB)`
- Turn card: `verifyPublic(pkA, pkB, cardEncrypted, openerA, openerB)`
- River card: `verifyPublic(pkA, pkB, cardEncrypted, openerA, openerB)`

## Usage Example

```solidity
import "./CardVerifier.sol";

contract PokerGame {
    function verifyPlayerAHoles(
        bytes memory pkB,
        bytes memory card1Encrypted,
        bytes memory card1Opener,
        bytes memory card2Encrypted,
        bytes memory card2Opener
    ) public view returns (bool) {
        return CardVerifier.verifyHoleA(
            pkB,
            card1Encrypted,
            card1Opener,
            card2Encrypted,
            card2Opener
        );
    }

    function verifyFlopCard(
        bytes memory pkA,
        bytes memory pkB,
        bytes memory cardEncrypted,
        bytes memory aOpener,
        bytes memory bOpener
    ) public view returns (bool) {
        return CardVerifier.verifyPublic(
            pkA,
            pkB,
            cardEncrypted,
            aOpener,
            bOpener
        );
    }
}
```

## Security Considerations

1. **Public Keys**: The G2 public keys must be generated correctly and kept consistent throughout the game
2. **Deck Integrity**: The encrypted card bytes must be sourced from the jointly encrypted deck
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
