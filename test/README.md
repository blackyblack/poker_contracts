# HeadsUpPokerEscrow Tests

This directory contains comprehensive tests for the HeadsUpPokerEscrow smart contract.

## Test Structure

The test suite covers all major functionality of the HeadsUpPokerEscrow contract:

### 1. Channel Creation
- ✅ Opening channels with valid parameters
- ✅ Rejecting invalid opponents (zero address, self)
- ✅ Rejecting zero deposits
- ✅ Preventing duplicate channels

### 2. Channel Joining
- ✅ Successful joining by the designated opponent
- ✅ Rejecting non-existent channels
- ✅ Rejecting unauthorized players
- ✅ Rejecting zero deposits
- ✅ Preventing double joining

### 3. Fold Settlement
- ✅ Successful settlement for both players
- ✅ Proper ETH transfer to winner
- ✅ Stack clearing after settlement
- ✅ Access control validation
- ✅ Edge case handling (empty pot)

### 4. Showdown Flow
#### Committing Hole Cards
- ✅ Valid commitments by both players
- ✅ Automatic showdown start when both commit
- ✅ Access control (players only)
- ✅ Preventing double commits
- ✅ Channel readiness validation

#### Revealing Hole Cards
- ✅ Valid reveals with correct salt
- ✅ Rejecting incorrect salt/commitments
- ✅ Access control enforcement
- ✅ Preventing double reveals
- ✅ Showdown state validation

#### Finalizing Showdown
- ✅ Successful finalization for both players
- ✅ Proper ETH transfer to winner
- ✅ Preventing double finalization
- ✅ Ensuring both players revealed
- ✅ Showdown state validation

### 5. Security & Access Control
- ✅ Preventing fold settlement during showdown
- ✅ Reentrancy protection (via ReentrancyGuard)
- ✅ Player authorization checks

### 6. View Functions
- ✅ Stack reporting for various channel states
- ✅ Correct values for empty, opened, and joined channels

## Running Tests

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run all tests
npm run test

# Run specific test file
npx hardhat test test/HeadsUpPokerEscrow.test.js

# Run with coverage
npx hardhat coverage
```

## Test Coverage

The test suite provides comprehensive coverage of:
- All public/external functions
- All error conditions and edge cases
- State transitions and validations
- ETH handling and transfers
- Access control mechanisms
- Event emissions

## Note

These tests use Hardhat's testing framework with Chai assertions and ethers.js for contract interactions. The tests are designed to work with the Hardhat local network for fast execution.