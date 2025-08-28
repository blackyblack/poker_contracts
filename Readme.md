# Poker Contracts

Contracts that resolve settlements for a Mental Poker game. Deposits are locked when the game starts and the pot is paid out when the game is settled.

## Features

- Heads-up poker game validation and replay
- Reraise attempt limit: Maximum of 4 raises per betting round to prevent excessive back-and-forth raising
- Support for all-in scenarios and minimum raise requirements
- Multi-street betting (preflop, flop, turn, river)

## Development

Install dependencies and compile the contracts with [Hardhat](https://hardhat.org/):

```
npm install
npm run compile
```
