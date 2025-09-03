# Test Organization

This directory contains tests organized by domain/functionality to improve maintainability and reduce duplication.

## Domain Structure

### `crypto/` - Cryptographic Functions
- `eip712-signatures.test.js` - Tests for EIP-712 signature verification and recovery

### `escrow/` - Financial & Escrow Management
- `escrow-management.test.js` - Tests for deposit management, channel lifecycle, withdrawals

### `evaluation/` - Poker Hand Evaluation
- `hand-ranking.test.js` - Tests for poker hand ranking algorithms
- `evaluation-integration.test.js` - Integration tests between poker evaluation and game contracts

### `game-logic/` - Core Game Logic
- `game-replay.test.js` - Tests for action replay, game flow validation, and rules enforcement

### `showdown/` - Card Commits & Showdown
- `commit-verification.test.js` - Tests for card commitment schemes and showdown verification

### `helpers/` - Shared Utilities
- `test-utils.js` - Consolidated helper functions (buildActions, signActions, buildCommit, etc.)
- `actions.js` - Action type constants
- `cards.js` - Card constants and utilities
- `hashes.js` - Cryptographic hash functions
- `slots.js` - Slot constants for card positions

## Key Improvements

### Removed Duplications
- Consolidated duplicate `buildActions` functions from multiple test files
- Unified `buildCommit` and `signCommit` helper functions
- Centralized wallet initialization code
- Eliminated duplicate import statements

### Better Organization
- Tests are now grouped by their primary domain/functionality
- Related helper utilities are co-located in the helpers directory
- Clear separation between different aspects of the system

### Maintainability
- Changes to shared utilities only need to be made in one place
- Test structure clearly reflects the system architecture
- Easier to find and update tests for specific functionality

## Usage

All tests maintain their original functionality and assertions. The only changes are:
- File locations and names for better organization
- Import paths updated to use shared utilities
- Removal of duplicated helper functions

Run tests as before using `npm run test` - Hardhat will automatically discover and run all `.test.js` files in subdirectories.