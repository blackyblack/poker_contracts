# Poker Contracts Test Suite

This directory contains a comprehensive and well-organized test suite for the poker contracts. The tests have been refactored to remove duplicates, group functionality logically, and include both working tests and planned tests for incomplete features.

## Test File Organization

### Core Test Files

1. **GameLogic.test.js** - Tests for poker game rules and betting logic
   - Basic game flow (folds, showdowns, all-ins)
   - Betting rules and validation
   - Street progression and actor handling
   - Attack prevention and edge cases
   - "Should fail" tests for incomplete poker rules

2. **HandEvaluation.test.js** - Tests for poker hand ranking and evaluation
   - Basic hand rankings (high card through straight flush)
   - Hand comparisons and tie-breaking
   - Special cases (wheel, broadway, royal flush)
   - Edge case validations

3. **Integration.test.js** - End-to-end integration tests
   - Complete game scenarios from deal to showdown
   - Complex poker hand evaluations
   - Gas optimization tests
   - Multi-component interaction tests

4. **CommitReveal.test.js** - Security tests for commit-reveal scheme
   - Commit validation and signature verification
   - Reveal phase security and timing
   - Third-party action handling
   - Attack prevention and timeout handling

5. **EscrowCore.test.js** - Core escrow functionality tests
   - Channel creation and management
   - Fold settlement mechanisms
   - Withdrawal and timeout handling
   - Security and reentrancy protection

6. **HeadsUpPokerEIP712.test.js** - EIP712 signature verification tests
   - Action signature recovery
   - Commit signature validation
   - Domain separation testing

### Helper Files

- **actions.js** - Action type constants and utilities
- **cards.js** - Card constants and definitions  
- **hashes.js** - Cryptographic hash and signature utilities
- **slots.js** - Card slot definitions for commit-reveal

## Test Categories

### Working Tests
These tests validate currently implemented functionality and should all pass.

### "Should Fail" Tests
These tests are marked with `.skip` and represent proper poker functionality that should work but currently fails because the implementation is incomplete. Each test includes a TODO comment explaining what needs to be implemented.

Examples of "should fail" tests:
- Betting out of turn validation
- String bet detection
- Table stakes enforcement
- Proper turn-based action validation
- Time-based forfeit mechanisms
- Partial board reveals
- Hand mucking capabilities

### Attack Prevention Tests
These tests verify protection against common attack vectors:
- Betting without playing (grief attacks)
- Premature showdown initiation
- Stack manipulation attacks
- Duplicate action submissions
- Commit replay attacks
- Gas limit exploits

## Key Improvements Made

1. **Removed Duplicates**: Eliminated ~800 lines of redundant test code
2. **Logical Grouping**: Organized tests by functionality rather than implementation details
3. **Clear Documentation**: Each test has descriptive names and comments
4. **Attack Scenarios**: Added comprehensive attack prevention tests
5. **Edge Cases**: Consolidated edge case testing with clear expectations
6. **Future Planning**: "Should fail" tests provide roadmap for missing features

## Running Tests

```bash
# Run all tests
npm test

# Run specific test files
npx hardhat test test/GameLogic.test.js
npx hardhat test test/HandEvaluation.test.js
npx hardhat test test/Integration.test.js
npx hardhat test test/CommitReveal.test.js
npx hardhat test test/EscrowCore.test.js
npx hardhat test test/HeadsUpPokerEIP712.test.js
```

## Test Coverage Areas

### Game Logic Coverage
- Preflop, flop, turn, river betting
- All-in scenarios and side pots  
- Minimum raise enforcement
- Betting limits and stack validation
- Street progression and actor alternation

### Security Coverage
- Commit-reveal scheme security
- Signature validation
- Replay attack prevention
- Timeout and forfeit handling
- Reentrancy protection

### Poker Rules Coverage
- Basic betting actions (check, call, bet, raise, fold)
- Blind posting and alternation
- Hand rankings and evaluation
- Showdown resolution
- Win condition determination

### Integration Coverage
- Complete game flows
- Multi-component interactions
- Gas optimization
- Real-world scenario simulation

## Notes for Developers

1. **"Should Fail" Tests**: Before implementing new features, check the "should fail" tests to understand expected behavior
2. **Attack Tests**: When adding new functionality, ensure corresponding attack prevention tests exist
3. **Gas Limits**: Integration tests include gas limit validations to prevent DoS attacks
4. **Edge Cases**: All boundary conditions and edge cases are explicitly tested
5. **Documentation**: Each test includes clear descriptions of what it validates

This refactored test suite provides a solid foundation for continued development while clearly identifying areas that need implementation.