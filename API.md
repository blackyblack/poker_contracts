# Heads-Up Poker Contracts API

This document summarizes the externally visible interface of the on-chain contracts that power the heads-up poker experience. It focuses on the calls a backend integration will most commonly invoke or monitor while orchestrating matches and syncing state with off-chain services.

## Shared data structures

### `Action`
`Action` is the canonical move format that both players sign for every step in a hand. It ties each move to a channel, hand, and sender, and chains moves together through hashes to prevent tampering. The `action` field encodes the specific verb (small blind, big blind, fold, check/call, bet/raise), and `amount` carries the wagered value when applicable. [`Action` is defined in `HeadsUpPokerActions.sol`.](src/HeadsUpPokerActions.sol)

### Card commit slots and `CardCommit`
The showdown flow relies on EIP-712 card commitment messages. Card slots are numbered as constants (`SLOT_A1`, `SLOT_A2`, `SLOT_B1`, `SLOT_B2`, `SLOT_FLOP1`, `SLOT_FLOP2`, `SLOT_FLOP3`, `SLOT_TURN`, `SLOT_RIVER`). A `CardCommit` message fixes the channel, hand, slot, and the commitment hash that was previously exchanged off-chain. [`CardCommit` and the slot constants live in `HeadsUpPokerEIP712.sol`.](src/HeadsUpPokerEIP712.sol)

## `HeadsUpPokerEscrow`
This is the primary contract that tracks channel balances, enforces signed action sequences, and pays out results. It exposes the following integration points.

### Constants
- `revealWindow` – duration players have to reveal cards during a showdown (currently 1 hour).
- `disputeWindow` – time allowed for submitting longer action histories in a dispute (currently 1 hour).【F:src/HeadsUpPokerEscrow.sol†L24-L25】

### Events
Backends can subscribe to these topics to react to state transitions:
- `ChannelOpened`, `ChannelJoined`, `ChannelTopUp`
- `Settled`, `ShowdownStarted`, `ShowdownFinalized`, `CommitsUpdated`
- `DisputeStarted`, `DisputeExtended`, `DisputeFinalized`
- `Withdrawn`
Each event carries the channel id and relevant payload such as participant, amount, or the updated commit mask.【F:src/HeadsUpPokerEscrow.sol†L121-L177】

### Read-only helpers
- `stacks(channelId)` → `(uint256 p1, uint256 p2)`: returns current escrowed balances for both seats.【F:src/HeadsUpPokerEscrow.sol†L182-L187】
- `getHandId(channelId)` → `uint256`: current hand counter used to salt commitments and action chains.【F:src/HeadsUpPokerEscrow.sol†L189-L192】
- `getMinSmallBlind(channelId)` → `uint256`: minimum small blind enforced for the channel.【F:src/HeadsUpPokerEscrow.sol†L194-L199】
- `getShowdown(channelId)` → `ShowdownState`: inspect reveal deadlines, board/hole cards revealed so far, and the commit bitmask.【F:src/HeadsUpPokerEscrow.sol†L680-L689】
- `getDispute(channelId)` → `DisputeState`: view current dispute deadlines and projected outcomes.【F:src/HeadsUpPokerEscrow.sol†L680-L689】

### Channel lifecycle
- `open(channelId, opponent, minSmallBlind)` (payable): seat player 1, set the opponent address, optionally deposit ETH, and start a new hand id. Reuses existing balances when reopening a finished channel and resets showdown/dispute state.【F:src/HeadsUpPokerEscrow.sol†L227-L276】
- `join(channelId)` (payable): opponent matches deposits to activate the channel. Allows zero value only if previous winnings already left funds in escrow.【F:src/HeadsUpPokerEscrow.sol†L278-L292】
- `topUp(channelId)` (payable): lets player 1 add funds after player 2 has joined, but never beyond player 2’s total escrowed balance.【F:src/HeadsUpPokerEscrow.sol†L294-L309】

### Settlement and disputes
- `settle(channelId, actions, signatures)`: verifies a fully signed terminal action history. Fold endings settle immediately; showdown endings transition into the reveal phase with a locked called amount.【F:src/HeadsUpPokerEscrow.sol†L311-L375】
- `dispute(channelId, actions, signatures)`: submit or extend a non-terminal history to keep funds safe while players continue the game off-chain. Longer histories reset the dispute timer and store the projected result derived from `HeadsUpPokerReplay`.【F:src/HeadsUpPokerEscrow.sol†L377-L437】
- `finalizeDispute(channelId)`: after the dispute window expires, materialize the stored projection—either finalize a fold payout or trigger the showdown reveal flow for incomplete games.【F:src/HeadsUpPokerEscrow.sol†L439-L485】

### Showdown management
- `revealCards(channelId, cardCommits, signatures, cards, cardSalts)` / `revealCardsOnBehalfOf(...)`: during the reveal window, submit batched card openings signed by both players. Successfully verified openings update the commit mask and may auto-finalize when all nine slots are revealed.【F:src/HeadsUpPokerEscrow.sol†L715-L771】
- `finalizeShowdown(channelId)`: once the reveal window elapses, pay the pot to whichever player revealed while the other did not, or declare a tie if neither side showed valid cards.【F:src/HeadsUpPokerEscrow.sol†L774-L799】

### Withdrawals
- `withdraw(channelId)`: after a hand has been finalized, each player can pull their remaining escrow. The function zeroes their stored balance and emits `Withdrawn` on success.【F:src/HeadsUpPokerEscrow.sol†L201-L221】

## `HeadsUpPokerEIP712`
This helper contract exposes EIP-712 hash builders so the backend can mirror the exact digests used on-chain:
- `DOMAIN_SEPARATOR()` returns the live EIP-712 domain separator.【F:src/HeadsUpPokerEIP712.sol†L54-L55】
- `digestAction(Action act)` produces the typed-data hash for an action before signing.【F:src/HeadsUpPokerEIP712.sol†L61-L75】
- `digestCardCommit(CardCommit cc)` produces the typed-data hash for a card commitment.【F:src/HeadsUpPokerEIP712.sol†L77-L91】
- `recoverActionSigner(Action act, bytes sig)` and `recoverCommitSigner(CardCommit cc, bytes sig)` are convenience views that recover the signer from a provided signature, mirroring how the escrow verifies them.【F:src/HeadsUpPokerEIP712.sol†L96-L108】

## `HeadsUpPokerReplay`
`HeadsUpPokerReplay` deterministically replays signed action sequences to classify outcomes and compute the called amount that should change hands. It is deployed from `HeadsUpPokerEscrow` and can also be used off-chain to validate transcripts.

- `replayGame(actions, stackA, stackB, minSmallBlind, player1, player2)` → `(End end, uint8 folder, uint256 calledAmount)`: fully validates a complete hand, requiring the sequence to include blinds and terminate (fold or showdown). It returns the ending type, the folder index when applicable, and the amount that moved into the pot.【F:src/HeadsUpPokerReplay.sol†L412-L438】
- `replayIncompleteGame(actions, stackA, stackB, minSmallBlind, player1, player2)` → `(End end, uint8 folder, uint256 calledAmount)`: accepts prefixes of a hand, determines whether the current state implies a fold or pending showdown, and returns the same metadata plus the minimum contributed amount per player. Used to project outcomes during disputes.【F:src/HeadsUpPokerReplay.sol†L440-L475】

The `End` enum enumerates the possible end states (`FOLD`, `SHOWDOWN`, `NO_BLINDS`), which backend code can use to branch its settlement logic.【F:src/HeadsUpPokerReplay.sol†L7-L24】
