# Heads-Up Poker Contracts API

This document summarizes the externally visible interface of the on-chain contracts that power the heads-up poker experience. It focuses on the calls a backend integration will most commonly invoke or monitor while orchestrating matches and syncing state with off-chain services.

## Shared data structures

### `Action`
`Action` is the canonical move format that both players sign for every step in a hand. It ties each move to a channel, hand, and sender, and chains moves together through hashes to prevent tampering. The `action` field encodes the specific verb (small blind, big blind, fold, check/call, bet/raise), and `amount` carries the wagered value when applicable. [`Action` is defined in `HeadsUpPokerActions.sol`.](src/HeadsUpPokerActions.sol)

### Card slots and deck layout
Showdowns operate on a nine-card deck laid out as constants (`SLOT_A1`, `SLOT_A2`, `SLOT_B1`, `SLOT_B2`, `SLOT_FLOP1`, `SLOT_FLOP2`, `SLOT_FLOP3`, `SLOT_TURN`, `SLOT_RIVER`). Each card starts as an encrypted BN254 point provided by both players during `startGame`. As players decrypt cards the points are matched against a canonical 52-card reference deck to resolve rank/suit pairs that `PokerEvaluator` can consume. The slot constants live in [`HeadsUpPokerEIP712.sol`](src/HeadsUpPokerEIP712.sol) and are reused across the escrow, peek, and showdown contracts.

## `HeadsUpPokerEscrow`
This is the primary contract that tracks channel balances, enforces signed action sequences, and pays out results. It exposes the following integration points.

### Constants
- `revealWindow` – duration players have to reveal cards during a showdown (currently 1 hour).
- `disputeWindow` – time allowed for submitting longer action histories in a dispute (currently 1 hour).

### Events
Backends can subscribe to these topics to react to state transitions:
- `ChannelOpened`, `ChannelJoined`, `ChannelTopUp`
- `GameStarted`
- `Settled`, `ShowdownStarted`, `ShowdownFinalized`, `RevealsUpdated`
- `DisputeStarted`, `DisputeExtended`, `DisputeFinalized`
- `Withdrawn`
Each event carries the channel id and relevant payload such as participant, amount, or the updated commit mask.

### Read-only helpers
- `stacks(channelId)` -> `(uint256 p1, uint256 p2)`: returns current escrowed balances for both seats.
- `getHandId(channelId)` -> `uint256`: current hand counter used to salt commitments and action chains.
- `getMinSmallBlind(channelId)` -> `uint256`: minimum small blind enforced for the channel.
- `getDispute(channelId)` -> `DisputeState`: view current dispute deadlines and projected outcomes.
- `getChannel(channelId)` -> `Channel`: returns the complete channel information including player addresses, deposits, finalization status, hand ID, join status, minimum small blind, and optional signing addresses for both players. Returns `address(0)` for optional signers if no optional signer is set.
- `viewContract()` -> `address`: returns the dedicated read-only facade for peek and showdown data.

### Channel lifecycle
- `open(channelId, opponent, minSmallBlind, player1Signer)` (payable): seat player 1, set the opponent address, optionally deposit ETH, and start a new hand id. The `player1Signer` parameter allows setting an optional additional signer address that can sign actions and card commits on behalf of player 1. Pass `address(0)` if no additional signer is needed. Reuses existing balances when reopening a finished channel and resets showdown/dispute state.
- `join(channelId, player2Signer)` (payable): opponent deposits ETH to activate the channel. The `player2Signer` parameter allows setting an optional additional signer address that can sign actions and card commits on behalf of player 2. Pass `address(0)` if no additional signer is needed. Allows zero value only if previous winnings already left funds in escrow.
- `startGame(channelId, deck, canonicalDeck)`: both players must call this function with matching encrypted decks (9 cards) and canonical decks (52 unencrypted base points) for the game to be considered started. The `deck` parameter contains 9 encrypted G1 points for the 9 slots (2 hole cards per player + 5 board cards). The `canonicalDeck` parameter contains 52 unencrypted G1 base points in canonical order representing all cards in a standard deck, enabling card-ID resolution by comparing decrypted points against these known values. Once both submissions match, the escrow forwards the deck to `HeadsUpPokerPeek` and emits `GameStarted`.
- `topUp(channelId)` (payable): lets player 1 add funds after player 2 has joined, but never beyond player 2’s total escrowed balance.

### Settlement and disputes
- `settle(channelId, actions, signatures)`: verifies a fully signed terminal action history. Each action must be signed by either the player themselves or their designated optional signer (if set). Requires the game to be started (both players have submitted matching deck hashes). Fold endings settle immediately; showdown endings transition into the reveal phase with a locked called amount.
- `dispute(channelId, actions, signatures)`: submit or extend a non-terminal history to force stale players continue the game off-chain. Actions must be signed by either the players themselves or their designated optional signers. Requires the game to be started (both players have submitted matching deck hashes). Longer histories reset the dispute timer and store the projected result derived from `HeadsUpPokerReplay`.
- `finalizeDispute(channelId)`: after the dispute window expires finalize a fold payout or trigger the showdown reveal flow for incomplete games.

### Showdown management
- `revealCards(channelId, decryptedCards)`: players call this function from the escrow to submit their partial decrypts for every slot. The escrow forwards the array to `HeadsUpPokerShowdown`, which verifies each BN254 point against the stored encrypted deck and the caller's public key. Each successful call flags the player as having revealed.
- `finalizeReveals(channelId, plaintextCards)`: after both players have revealed their partial decrypts, anyone (typically a backend) can combine them off-chain to produce plaintext cards and pass the result here. The showdown contract cross-checks the plaintext against the opposing partial decrypt and resolves the canonical card codes that power hand evaluation.
- `finalizeShowdown(channelId)`: once the reveal window elapses, determine the final payout. If both players revealed and provided valid plaintexts the showdown evaluates the hands and rewards the winner. If only one side revealed, that player wins the locked called amount by default. If neither side cooperated the hand is treated as a tie.

### Withdrawals
- `withdraw(channelId)`: after a hand has been finalized, each player can pull their remaining escrow. The function zeroes their stored balance and emits `Withdrawn` on success.

## `HeadsUpPokerEIP712`
This helper contract exposes EIP-712 hash builders so the backend can mirror the exact digests used on-chain:
- `DOMAIN_SEPARATOR()` returns the live EIP-712 domain separator.
- `digestAction(Action act)` produces the typed-data hash for an action before signing.
- `digestCardCommit(CardCommit cc)` produces the typed-data hash for a historical card commitment message. While the live showdown flow relies on encrypted decks, this helper remains available for tools that still need to verify legacy commitments.
- `recoverActionSigner(Action act, bytes sig)` and `recoverCommitSigner(CardCommit cc, bytes sig)` are convenience views that recover the signer from a provided signature, mirroring how the escrow verifies them.

## `HeadsUpPokerReplay`
`HeadsUpPokerReplay` deterministically replays signed action sequences to classify outcomes and compute the called amount that should change hands. It is deployed from `HeadsUpPokerEscrow` and can also be used off-chain to validate transcripts.

- `replayGame(actions, stackA, stackB, minSmallBlind, player1, player2)` -> `(End end, uint8 folder, uint256 calledAmount)`: fully validates a complete hand, requiring the sequence to include blinds and terminate (fold or showdown). It returns the ending type, the folder index when applicable, and the amount that moved into the pot.
- `replayIncompleteGame(actions, stackA, stackB, minSmallBlind, player1, player2)` -> `(End end, uint8 folder, uint256 calledAmount)`: accepts prefixes of a hand, determines whether the current state implies a fold or pending showdown, and returns the same metadata plus the minimum contributed amount per player. Used to project outcomes during disputes.

The `End` enum enumerates the possible end states (`FOLD`, `SHOWDOWN`, `NO_BLINDS`), which backend code can use to branch its settlement logic.
