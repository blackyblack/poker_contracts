# Card Positions in Poker Deck

This document clarifies the mapping between card positions in the deck and poker terminology.

## Deck Layout

```
Index | Card          | Description           | Verification Function
------|---------------|-----------------------|----------------------
0     | Card 1        | Player A Hole Card 1  | verifyHoleA
1     | Card 2        | Player A Hole Card 2  | verifyHoleA
2     | Card 3        | Player B Hole Card 1  | verifyHoleB
3     | Card 4        | Player B Hole Card 2  | verifyHoleB
4     | Card 5        | Flop Card 1           | verifyFlop
5     | Card 6        | Flop Card 2           | verifyFlop
6     | Card 7        | Flop Card 3           | verifyFlop
7     | Card 8        | Turn Card             | verifyTurn
8     | Card 9        | River Card            | verifyRiver
```

## Verification Requirements

### Hole Cards
- **Player A's Hole Cards (indices 0, 1)**: Only Player B needs to provide decryption
  - Player A already knows their own cards
  - Player B must prove they correctly decrypted these cards
  
- **Player B's Hole Cards (indices 2, 3)**: Only Player A needs to provide decryption
  - Player B already knows their own cards
  - Player A must prove they correctly decrypted these cards

### Public Cards
- **Flop Cards (indices 4, 5, 6)**: Both players must provide decryption
  - Player A provides partial decryption
  - Player B provides final decryption from Player A's partial result
  
- **Turn Card (index 7)**: Both players must provide decryption
  - Sequential decryption: A first, then B
  
- **River Card (index 8)**: Both players must provide decryption
  - Sequential decryption: A first, then B

## Cryptographic Protocol

The verification uses BN254 elliptic curve pairing to ensure correct decryption.

### For Hole Cards (opponent only)
```
e(bDeckSigned[i], pkOpponent) == e(opener[i], G2_BASE)
```

### For Public Cards (both players)
```
e(bDeckSigned[i], pkA) == e(openerA[i], G2_BASE)
e(openerA[i], pkB) == e(openerB[i], G2_BASE)
```

### Notation
- `bDeckSigned` - fully encrypted deck (encrypted by both players)
- `pkA`, `pkB` - public keys of players A and B (G2 points)
- `opener` - partial decryption provided by a player (G1 point)
- `G2_BASE` - BN254 G2 generator point
- `e()` - BN254 pairing function

## Usage in Smart Contracts

The CardVerifier library can be used to enforce that opponents provide correct decryption data:

1. **During showdown**: Force opponent to reveal hole cards by a deadline
2. **Dispute resolution**: If a player doesn't provide decryption, they forfeit
3. **Public card verification**: Both players must cooperate to reveal community cards

This ensures fair play and prevents players from refusing to reveal cards when they lose.
