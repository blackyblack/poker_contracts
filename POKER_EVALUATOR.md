# Gas-Efficient 7-Card Poker Evaluator

This implementation provides a highly gas-efficient poker hand evaluator for 7-card hands (2 hole cards + 5 community cards), designed specifically for on-chain poker applications.

## Features

- **Gas Optimized**: Designed to minimize gas usage through bit manipulation and packed data structures
- **Single Function Call**: Returns a single sortable `uint256` rank for easy comparison
- **Complete Evaluation**: Handles all poker hand types from high card to straight flush
- **Kicker Support**: Properly ranks hands with identical patterns by kicker cards
- **7-Card Input**: Automatically finds the best 5-card hand from 7 cards

## Design Principles

### Card Encoding
Cards are encoded as `uint8` values with:
- **Upper 4 bits**: Suit (0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades)
- **Lower 4 bits**: Rank (1=Ace, 2-10=pip cards, 11=Jack, 12=Queen, 13=King)

Example: `makeCard(2, 1)` creates Ace of Hearts = `0x21`

### Gas Optimizations

1. **Packed Counting**: Rank and suit counts are packed into single `uint256` values using 4 bits per rank/suit
2. **Bit Mask Straights**: Straight detection uses bit manipulation for O(1) lookup
3. **Single Pass Analysis**: Most hand analysis done in one loop through the 7 cards
4. **Fixed Arrays**: No dynamic memory allocation, all arrays are fixed-size
5. **Efficient Sorting**: Uses simple sorts appropriate for small fixed-size arrays

### Ranking System

The returned rank is a 24-bit value structured as:
```
Bits 20-23: Hand type (0=High Card, 1=Pair, ..., 8=Straight Flush)
Bits 16-19: Primary rank (quads, trips, high pair, or high card)
Bits 12-15: Secondary rank (kickers)
Bits 8-11:  Third rank
Bits 4-7:   Fourth rank  
Bits 0-3:   Fifth rank
```

Higher rank values always beat lower rank values, making comparison trivial.

## Usage

### Basic Usage

```solidity
import {PokerEvaluator} from "./PokerEvaluator.sol";

contract PokerGame {
    function compareHands(uint8[7] memory hand1, uint8[7] memory hand2) 
        public pure returns (address winner) 
    {
        uint256 rank1 = PokerEvaluator.evaluateHand(hand1);
        uint256 rank2 = PokerEvaluator.evaluateHand(hand2);
        
        if (rank1 > rank2) {
            return player1;
        } else if (rank2 > rank1) {
            return player2;
        } else {
            return address(0); // Tie
        }
    }
}
```

### Integration Example

The HeadsUpPokerEscrow contract demonstrates integration:

```solidity
// Evaluate both hands
uint256 player1Rank = PokerEvaluator.evaluateHand(player1Cards);
uint256 player2Rank = PokerEvaluator.evaluateHand(player2Cards);

// Determine winner (higher rank wins)
address winner;
if (player1Rank > player2Rank) {
    winner = ch.player1;
} else if (player2Rank > player1Rank) {
    winner = ch.player2;
} else {
    // Tie - default to initiator
    winner = sd.initiator;
}
```

## Supported Hand Types

1. **High Card** (0): A-K-Q-J-9 high
2. **Pair** (1): A-A-K-Q-J
3. **Two Pair** (2): A-A-K-K-Q
4. **Three of a Kind** (3): A-A-A-K-Q  
5. **Straight** (4): A-2-3-4-5 or 10-J-Q-K-A
6. **Flush** (5): Any 5 cards of same suit
7. **Full House** (6): A-A-A-K-K
8. **Four of a Kind** (7): A-A-A-A-K
9. **Straight Flush** (8): 5-6-7-8-9 all same suit

## Testing

The implementation includes comprehensive tests:

- `PokerEvaluator.test.js`: Basic hand ranking tests
- `PokerEvaluatorGas.test.js`: Gas efficiency verification  
- `PokerEvaluationIntegration.test.js`: Integration with HeadsUpPokerEscrow

## Gas Performance

Typical gas usage per evaluation:
- High Card: ~50,000 gas
- Pair/Two Pair: ~55,000 gas  
- Straight/Flush: ~60,000 gas
- Complex hands: ~65,000 gas

All evaluations complete well under 100,000 gas, making it suitable for on-chain settlement.

## Security Considerations

- **Pure Functions**: All evaluation is done in pure functions with no state changes
- **Overflow Protection**: Uses appropriate data types to prevent overflow
- **Deterministic**: Same input always produces same output
- **No External Calls**: Self-contained with no external dependencies