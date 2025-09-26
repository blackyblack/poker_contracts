# Poker Contracts

Smart contracts that let two players stake funds, play a heads-up poker hand off-chain, and settle the result on Ethereum. The system keeps escrowed balances safe, resolves disputes from the signed action history, and awards the pot once cards are revealed.

## High-level flow

1. **Fund a channel.** Each player deposits matching stakes to open a heads-up game and can withdraw only after a hand is finalized.
2. **Play off-chain.** Players exchange signed moves; the contracts only see the final transcript or dispute evidence when settlement is requested.
3. **Settle the hand.** The escrow contract verifies the transcript, coordinates card reveals if needed, and pays out the winner or splits the pot.

## Contract components

- **HeadsUpPokerEscrow** – Manages player balances, settlement windows, and dispute timers for each game channel.
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

## TypeScript Integration

This project includes full TypeScript support with generated type-safe wrappers for all contracts using TypeChain.

### Generate TypeScript wrappers

```bash
npm run build        # Compile contracts and generate TypeScript wrappers
npm run typechain    # Generate TypeScript wrappers only
```

The generated TypeScript wrappers provide:
- Full type safety for contract interactions
- Auto-completion in IDEs
- Compile-time error checking
- Ethers.js v6 compatibility

See [TYPESCRIPT_INTEGRATION.md](./TYPESCRIPT_INTEGRATION.md) for detailed usage examples and documentation.
