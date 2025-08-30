# Side Pot Implementation

## Problem Statement
When a short-stacked player goes all-in for less than the full bet amount, only the amount they can match should go into the pot. For example:
- Player1 bets 100 USD
- Player2 calls with 50 USD (his full stack) and goes all-in
- Only 50 USD from Player1 should go to the pot, not the full 100 USD

## Solution Implemented

### 1. HeadsUpPokerReplay.sol Changes
**Location**: ACT_CHECK_CALL handler (lines ~189-199)

**Logic Added**:
When a player calls but has insufficient chips:
1. Reduce the call amount to their available stack
2. Calculate the excess contribution from the opponent
3. Return the excess amount to the opponent's stack and reduce their total contribution

**Code**:
```solidity
// Handle side pot: if caller can't match full bet, reduce opponent's contribution
if (g.stacks[p] < callAmt) {
    callAmt = g.stacks[p];
    
    // Calculate how much the opponent should return (side pot logic)
    uint256 excessContrib = g.contrib[opp] - g.contrib[p] - callAmt;
    if (excessContrib > 0) {
        g.contrib[opp] -= excessContrib;
        g.total[opp] -= excessContrib;
        g.stacks[opp] += excessContrib; // Return excess to opponent's stack
    }
}
```

### 2. HeadsUpPokerEscrow.sol Changes
**Location**: settleFold function (lines ~264-287)

**Logic Added**:
1. Use the actual pot amount returned by the replay instead of summing deposits
2. Calculate unused deposits and handle them appropriately
3. Winner gets the pot plus any unused deposits; loser gets back only unused deposits

**Code**:
```solidity
// Use actual pot from replay (handles side pots correctly)
// Calculate unused deposits that should be returned
uint256 totalDeposits = ch.deposit1 + ch.deposit2;
uint256 unusedAmount = totalDeposits > actualPot ? totalDeposits - actualPot : 0;

// Add pot to winner's deposit and handle unused amount
if (winner == ch.player1) {
    ch.deposit1 = actualPot + unusedAmount; // Winner gets pot plus any unused deposits
    ch.deposit2 = 0;
} else {
    ch.deposit1 = unusedAmount; // Non-winner gets back unused deposits
    ch.deposit2 = actualPot;
}
```

## Example Scenarios

### Scenario 1: Side Pot Needed
- Initial: Player0=200 chips, Player1=50 chips
- SB: 1, BB: 2
- Player0 raises to 100 total
- Player1 calls all-in with remaining 48 chips

**Before fix**: Pot = 150 (1+2+100+47)
**After fix**: Pot = 100 (1+2+50+47), Player0 gets back 50

### Scenario 2: No Side Pot Needed
- Initial: Player0=200 chips, Player1=200 chips  
- SB: 1, BB: 2
- Player0 raises to 50 total
- Player1 calls with 48 chips

**Result**: Pot = 100 (both players contribute 50), no changes needed

## Test Cases Added
1. `correctly calculates side pot when short stack goes all-in`: Tests the exact scenario from the problem statement

## Limitations
- Showdown settlement functions still use deposit sums instead of replay pot calculation
- A complete fix for showdown cases would require architectural changes to pass action sequences to showdown functions

## Files Modified
1. `src/HeadsUpPokerReplay.sol`: Added side pot logic
2. `src/HeadsUpPokerEscrow.sol`: Updated settleFold to use replay pot
3. `test/HeadsUpPokerReplay.test.js`: Added test case for side pot scenario