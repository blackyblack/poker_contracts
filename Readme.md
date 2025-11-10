# Poker Contracts

Smart contracts that let two players stake funds, play a heads-up poker hand off-chain, and settle the result on Ethereum. The system keeps escrowed balances safe, resolves disputes from the signed action history, and awards the pot once cards are revealed.

## High-level flow

1. **Fund a channel.** Each player deposits matching stakes to open a heads-up game and can withdraw only after a hand is finalized.
2. **Play off-chain.** Players exchange signed moves; the contracts only see the final transcript or dispute evidence when settlement is requested.
3. **Reveal cards.** When a transcript reaches showdown both players decrypt their portions of the encrypted deck within a one-hour window. The `HeadsUpPokerShowdown` contract validates partial decrypts and the resulting plaintext cards against the canonical deck provided at game start.
4. **Settle the hand.** Once plaintext cards are verified the escrow contract evaluates both seven-card hands with `PokerEvaluator` and awards the called amount to the winner (or declares a tie).

## Contract components

- **HeadsUpPokerEscrow** – Manages player balances, settlement windows, and dispute timers for each game channel.
- **HeadsUpPokerPeek** – Stores the shared encrypted deck, the canonical deck used to resolve decrypted cards, and helper reveals that occur mid-hand (hole card peeks, community card deals).
- **HeadsUpPokerShowdown** – Tracks the reveal window, validates partial decrypts submitted by each player, records the verified plaintext cards, and determines the winner when the reveal flow concludes.
- **HeadsUpPokerReplay** – Recreates the betting sequence to ensure the submitted transcript follows poker rules before funds move.
- **HeadsUpPokerEIP712 & HeadsUpPokerActions** – Share the typed-data domain and struct layouts used for action and card signatures.
- **PokerEvaluator** – Scores two seven-card hands to decide winners during showdowns.

## Development quickstart

Install dependencies and run the Hardhat tasks provided in `package.json`:

```bash
npm install
npm run compile
npm test
```
