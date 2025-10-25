// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import {PokerEvaluator} from "./PokerEvaluator.sol";
import {HeadsUpPokerReplay} from "./HeadsUpPokerReplay.sol";
import {Action} from "./HeadsUpPokerActions.sol";
import {Bn254} from "./Bn254.sol";

/// @title HeadsUpPokerEscrow - Simple escrow contract for heads up poker matches using ETH only
/// @notice Supports opening channels, joining, settling on fold and basic showdown flow
contract HeadsUpPokerEscrow is ReentrancyGuard, HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    HeadsUpPokerReplay private immutable replay;

    // ------------------------------------------------------------------
    // Slot layout constants
    // ------------------------------------------------------------------
    uint16 constant MASK_ALL = 0x01FF; // bits 0..8

    uint256 public constant revealWindow = 1 hours;
    uint256 public constant disputeWindow = 1 hours;
    uint256 public constant forceRevealWindow = 1 hours;

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error CommitDuplicate(uint8 slot);
    error CommitWrongChannel(uint8 slot);
    error CommitWrongSignerA(uint8 slot);
    error CommitWrongSignerB(uint8 slot);
    error CommitUnexpected(uint8 slot);

    error NotFinalized();
    error PaymentFailed();
    error NoBalance();
    error ChannelExists();
    error BadOpponent();
    error InvalidMinSmallBlind();
    error NoDeposit();
    error NoChannel();
    error NotOpponent();
    error AlreadyJoined();
    error AlreadyFinalized();
    error DepositExceedsOpponent();
    error ShowdownInProgress();
    error NotPlayer();
    error SignatureLengthMismatch();
    error CardsLengthMismatch();
    error CardSaltsLengthMismatch();
    error NoOverlap();
    error HashMismatch();
    error ChannelNotReady();
    error BadRoleIndex();
    error SequenceTooLow();
    error Expired();
    error NoShowdownInProgress();
    error StillRevealing();
    error OpponentHoleOpenFailed();
    error InitiatorHolesRequired();
    error ActionSignatureLengthMismatch();
    error ActionWrongChannel();
    error ActionWrongHand();
    error ActionInvalidSender();
    error ActionWrongSigner();
    error NoActionsProvided();
    error DisputeInProgress();
    error NoDisputeInProgress();
    error DisputeStillActive();
    error SequenceTooShort();
    error SequenceNotLonger();
    error GameNotStarted();
    error DeckHashMismatch();
    error GameAlreadyStarted();
    error ForceRevealInProgress();
    error NoForceRevealInProgress();
    error ForceRevealNotExpired();
    error ForceRevealAlreadyServed();
    error ForceRevealWrongStage();
    error InvalidDecryptResp();
    error PrerequisitesNotMet();
    error InvalidBDeck();

    // ------------------------------------------------------------------
    // Dispute state
    // ------------------------------------------------------------------
    struct DisputeState {
        bool inProgress;
        uint256 deadline;
        uint256 actionCount;
        HeadsUpPokerReplay.End endType;
        uint8 folder;
        uint256 calledAmount;
    }

    mapping(uint256 => DisputeState) private disputes;

    // ------------------------------------------------------------------
    // Showdown state
    // ------------------------------------------------------------------
    struct ShowdownState {
        uint256 deadline;
        bool inProgress;
        uint8[9] cards;
        uint16 lockedCommitMask;
        uint256 calledAmount;
    }

    mapping(uint256 => ShowdownState) private showdowns;

    // ------------------------------------------------------------------
    // Force Reveal state
    // ------------------------------------------------------------------
    enum ForceRevealStage {
        NONE,
        HOLE_A,
        HOLE_B,
        FLOP,
        TURN,
        RIVER
    }

    struct ForceRevealState {
        ForceRevealStage stage;
        bool inProgress;
        bool served;
        uint256 deadline;
        address obligatedHelper;
        uint8[] indices;
    }

    mapping(uint256 => ForceRevealState) private forceReveals;
    mapping(uint256 => mapping(uint8 => bytes)) private revealedCards; // channelId => index => decrypted U point
    // ---------------------------------------------------------------------
    // Channel storage
    // ---------------------------------------------------------------------
    struct Channel {
        address player1;
        address player2;
        uint256 deposit1;
        uint256 deposit2;
        bool finalized;
        uint256 handId;
        bool player2Joined; // Track if player2 joined current hand
        uint256 minSmallBlind; // Minimum small blind amount for this channel
        address player1Signer; // Optional additional signing address for player1
        address player2Signer; // Optional additional signing address for player2
        bool gameStarted; // True when both players have submitted matching deck hashes
        uint256 slashAmount; // Amount to slash for failed force reveals
    }

    mapping(uint256 => Channel) private channels;
    mapping(uint256 => bytes[]) private decks; // channelId => deck (52 G1 points)

    constructor() {
        replay = new HeadsUpPokerReplay();
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event ChannelOpened(
        uint256 indexed channelId,
        address indexed player1,
        address indexed player2,
        uint256 amount,
        uint256 handId,
        uint256 minSmallBlind
    );
    event ChannelJoined(
        uint256 indexed channelId,
        address indexed player,
        uint256 amount
    );
    event ChannelTopUp(
        uint256 indexed channelId,
        address indexed player,
        uint256 amount
    );
    event ShowdownStarted(uint256 indexed channelId);
    event ShowdownFinalized(
        uint256 indexed channelId,
        address indexed winner,
        uint256 amount
    );
    event CommitsUpdated(
        uint256 indexed channelId,
        uint16 newMask
    );
    event Withdrawn(
        uint256 indexed channelId,
        address indexed player,
        uint256 amount
    );
    event DisputeStarted(
        uint256 indexed channelId,
        address indexed submitter,
        uint256 actionCount
    );
    event DisputeExtended(
        uint256 indexed channelId,
        address indexed submitter,
        uint256 actionCount
    );
    event DisputeFinalized(
        uint256 indexed channelId,
        address indexed winner,
        uint256 amount
    );
    event Settled(
        uint256 indexed channelId,
        address indexed winner,
        uint256 amount
    );
    event GameStarted(
        uint256 indexed channelId,
        bytes32 deckHash
    );
    event ForceRevealOpened(
        uint256 indexed channelId,
        uint8 indexed stage,
        uint8[] indices
    );
    event ForceRevealServed(
        uint256 indexed channelId,
        uint8 indexed stage,
        uint8[] indices
    );
    event ForceRevealSlashed(
        uint256 indexed channelId,
        uint8 indexed stage,
        uint8[] indices,
        address indexed slashedPlayer
    );

    // ---------------------------------------------------------------------
    // View helpers
    // ---------------------------------------------------------------------
    function stacks(
        uint256 channelId
    ) external view returns (uint256 p1, uint256 p2) {
        Channel storage ch = channels[channelId];
        return (ch.deposit1, ch.deposit2);
    }

    /// @notice Get the handId for a channel
    function getHandId(uint256 channelId) external view returns (uint256) {
        return channels[channelId].handId;
    }

    /// @notice Get the minimum small blind for a channel
    function getMinSmallBlind(
        uint256 channelId
    ) external view returns (uint256) {
        return channels[channelId].minSmallBlind;
    }

    /// @notice Get the complete channel information
    function getChannel(
        uint256 channelId
    ) external view returns (Channel memory) {
        return channels[channelId];
    }

    /// @notice Player withdraws their deposit from a finalized channel
    function withdraw(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (!ch.finalized) revert NotFinalized();

        uint256 amount;
        if (msg.sender == ch.player1 && ch.deposit1 > 0) {
            amount = ch.deposit1;
            ch.deposit1 = 0;
        } else if (msg.sender == ch.player2 && ch.deposit2 > 0) {
            amount = ch.deposit2;
            ch.deposit2 = 0;
        } else {
            revert NoBalance();
        }

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert PaymentFailed();

        emit Withdrawn(channelId, msg.sender, amount);
    }

    /// @notice Get revealed card for a specific index
    /// @param channelId The channel identifier
    /// @param index The card index (0-51)
    /// @return The revealed card U point, or empty bytes if not revealed
    function getRevealedCard(uint256 channelId, uint8 index) external view returns (bytes memory) {
        return revealedCards[channelId][index];
    }

    /// @notice Get the force reveal state for a channel
    function getForceReveal(
        uint256 channelId
    ) external view returns (ForceRevealState memory) {
        return forceReveals[channelId];
    }

    // ---------------------------------------------------------------------
    // Channel flow
    // ---------------------------------------------------------------------

    /// @notice Player1 opens a channel with an opponent by depositing ETH
    function open(
        uint256 channelId,
        address opponent,
        uint256 minSmallBlind,
        address player1Signer
    ) external payable nonReentrant returns (uint256 handId) {
        Channel storage ch = channels[channelId];
        if (ch.player1 != address(0) && !ch.finalized) revert ChannelExists();
        if (opponent == address(0) || opponent == msg.sender)
            revert BadOpponent();
        if (minSmallBlind == 0) revert InvalidMinSmallBlind();

        // Allow zero deposit only if there's existing deposit from previous games
        if (msg.value == 0 && ch.deposit1 == 0) revert NoDeposit();

        handId = ++ch.handId;

        ch.player1 = msg.sender;
        ch.player2 = opponent;
        ch.deposit1 += msg.value; // Add to existing deposit instead of overwriting
        // Note: Do not reset deposit2 to allow player2 to accumulate winnings
        ch.finalized = false;
        ch.player2Joined = false;
        ch.minSmallBlind = minSmallBlind;
        ch.player1Signer = player1Signer;
        ch.gameStarted = false;
        ch.slashAmount = 0;

        // Reset deck storage
        delete decks[channelId];

        // Reset showdown state when reusing channel
        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) {
            sd.inProgress = false;
            sd.deadline = 0;
            sd.lockedCommitMask = 0;
        }

        // Reset dispute state when reusing channel
        DisputeState storage ds = disputes[channelId];
        if (ds.inProgress) {
            ds.inProgress = false;
            ds.deadline = 0;
            ds.actionCount = 0;
        }

        // Reset force reveal state
        ForceRevealState storage fr = forceReveals[channelId];
        if (fr.inProgress) {
            fr.inProgress = false;
            fr.stage = ForceRevealStage.NONE;
        }

        emit ChannelOpened(
            channelId,
            msg.sender,
            opponent,
            msg.value,
            handId,
            minSmallBlind
        );
    }

    /// @notice Opponent joins an open channel by matching deposit
    function join(
        uint256 channelId,
        address player2Signer
    ) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.player2 != msg.sender) revert NotOpponent();
        if (ch.player2Joined) revert AlreadyJoined();

        // Allow zero deposit only if there's existing deposit from previous games
        if (msg.value == 0 && ch.deposit2 == 0) revert NoDeposit();

        ch.deposit2 += msg.value; // Add to existing deposit instead of overwriting
        ch.player2Joined = true;
        ch.player2Signer = player2Signer;

        emit ChannelJoined(channelId, msg.sender, msg.value);
    }

    /// @notice Both players must call this function with matching decks to start the game
    /// @param channelId The channel identifier
    /// @param deck The deck to be used for this game (52 G1 encrypted card points, each 64 bytes)
    /// @param slashAmount The amount to slash for failed force reveals
    function startGame(uint256 channelId, bytes[] calldata deck, uint256 slashAmount) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.player2Joined) revert ChannelNotReady();
        if (ch.gameStarted) revert GameAlreadyStarted();
        if (msg.sender != ch.player1 && msg.sender != ch.player2) revert NotPlayer();
        if (deck.length != 52) revert InvalidBDeck();
        if (slashAmount == 0) revert InvalidMinSmallBlind(); // Reusing error

        bytes32 deckHash = _hashBDeck(deck);
        
        if (decks[channelId].length == 0) {
            // First player submits deck
            decks[channelId] = deck;
            ch.slashAmount = slashAmount;
        } else {
            // Second player verifies deck matches
            if (deckHash != _hashBDeck(decks[channelId])) revert DeckHashMismatch();
            if (slashAmount != ch.slashAmount) revert InvalidMinSmallBlind(); // Reusing error
            ch.gameStarted = true;
            emit GameStarted(channelId, deckHash);
        }
    }

    /// @notice Allows player1 to top up their deposit after player2 has joined
    /// @dev Player1's total deposit after top up cannot exceed player2's total deposit
    function topUp(uint256 channelId) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (msg.sender != ch.player1) revert NotPlayer();
        if (ch.finalized) revert AlreadyFinalized();
        if (!ch.player2Joined) revert ChannelNotReady();
        if (msg.value == 0) revert NoDeposit();
        if (ch.deposit1 + msg.value > ch.deposit2)
            revert DepositExceedsOpponent();

        ch.deposit1 += msg.value;

        emit ChannelTopUp(channelId, msg.sender, msg.value);
    }

    /// @notice Settles terminal action sequences (Fold or Showdown)
    /// @dev Showdown endings redirect to showdown mechanism.
    /// @param channelId The channel identifier
    /// @param actions Array of actions representing the poker hand
    /// @param signatures Array of signatures for corresponding actions (signed by the sender of each action)
    function settle(
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        if (sd.inProgress) revert ShowdownInProgress();
        if (ch.player1 == address(0)) revert NoChannel();
        if (actions.length == 0) revert NoActionsProvided();
        if (ch.finalized) revert AlreadyFinalized();
        if (!ch.gameStarted) revert GameNotStarted();

        // Verify signatures for all actions
        _verifyActionSignatures(
            channelId,
            ch.handId,
            actions,
            signatures,
            ch.player1,
            ch.player2
        );

        // Replay actions to verify they are terminal and get end state
        (
            HeadsUpPokerReplay.End endType,
            uint8 folder,
            uint256 calledAmount
        ) = replay.replayGame(
                actions,
                ch.deposit1,
                ch.deposit2,
                ch.minSmallBlind,
                ch.player1,
                ch.player2
            );

        if (endType != HeadsUpPokerReplay.End.FOLD) {
            // Initiate showdown state - players must reveal cards to determine winner
            _initiateShowdown(channelId, calledAmount);
            return; // Exit early - settlement will happen after card reveals
        }

        address winner;

        // Winner is the non-folder
        winner = folder == 0 ? ch.player2 : ch.player1;

        // Transfer only the called amount from loser to winner
        if (winner == ch.player1) {
            ch.deposit1 += calledAmount;
            ch.deposit2 -= calledAmount;
        } else {
            ch.deposit1 -= calledAmount;
            ch.deposit2 += calledAmount;
        }

        ch.finalized = true;
        emit Settled(channelId, winner, calledAmount);
    }

    /// @notice Start or extend a dispute with a non-terminal action sequence
    /// @dev Verifies signatures and projects end state. Longer sequences reset the timer.
    /// @param channelId The channel identifier
    /// @param actions Array of actions representing the poker hand
    /// @param signatures Array of signatures for corresponding actions (signed by the sender of each action)
    function dispute(
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];
        DisputeState storage ds = disputes[channelId];

        if (sd.inProgress) revert ShowdownInProgress();
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();
        if (!ch.gameStarted) revert GameNotStarted();

        // Verify signatures for all actions
        _verifyActionSignatures(
            channelId,
            ch.handId,
            actions,
            signatures,
            ch.player1,
            ch.player2
        );

        // Must provide a longer sequence to extend dispute
        if (ds.inProgress && actions.length <= ds.actionCount)
            revert SequenceNotLonger();

        // Replay actions to get projected end state (handles both terminal and non-terminal)
        (
            HeadsUpPokerReplay.End endType,
            uint8 folder,
            uint256 calledAmount
        ) = replay.replayIncompleteGame(
                actions,
                ch.deposit1,
                ch.deposit2,
                ch.minSmallBlind,
                ch.player1,
                ch.player2
            );

        // Update dispute state (no need to store actions, just the projected outcome)
        bool wasInProgress = ds.inProgress;
        ds.inProgress = true;
        ds.deadline = block.timestamp + disputeWindow;
        ds.actionCount = actions.length;
        ds.endType = endType;
        ds.folder = folder;
        ds.calledAmount = calledAmount;

        if (wasInProgress) {
            emit DisputeExtended(channelId, msg.sender, actions.length);
        } else {
            emit DisputeStarted(channelId, msg.sender, actions.length);
        }
    }

    /// @notice Finalize dispute after dispute window has passed
    /// @dev Applies the projected outcome from the longest submitted sequence.
    /// For fold outcomes, transfers called amount. For showdown outcomes waits for cards reveal.
    /// @param channelId The channel identifier
    function finalizeDispute(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        DisputeState storage ds = disputes[channelId];

        if (!ds.inProgress) revert NoDisputeInProgress();
        if (block.timestamp <= ds.deadline) revert DisputeStillActive();
        if (ch.finalized) revert AlreadyFinalized();

        // Finalize based on the projected end state

        if (ds.endType == HeadsUpPokerReplay.End.NO_BLINDS) {
            // For games without blinds, finalize without transferring any funds
            ds.inProgress = false;
            ch.finalized = true;
            emit DisputeFinalized(channelId, address(0), 0);
            return;
        }

        if (ds.endType != HeadsUpPokerReplay.End.FOLD) {
            // Initiate showdown state - players must reveal cards to determine winner
            _initiateShowdown(channelId, ds.calledAmount);
            return;
        }

        // Winner is the non-folder
        address winner = ds.folder == 0 ? ch.player2 : ch.player1;
        uint256 transferAmount = ds.calledAmount;

        // Transfer the appropriate amount
        if (winner == ch.player1) {
            ch.deposit1 += transferAmount;
            ch.deposit2 -= transferAmount;
        } else {
            ch.deposit1 -= transferAmount;
            ch.deposit2 += transferAmount;
        }

        // Clean up dispute state
        ds.inProgress = false;

        ch.finalized = true;
        emit DisputeFinalized(channelId, winner, transferAmount);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    // Reduce stack pressure: move signer checks into a small helper.
    function _checkSigners(
        uint256 channelId,
        uint8 slot,
        bytes32 digest,
        bytes calldata sigA,
        bytes calldata sigB,
        address playerA,
        address playerB
    ) private view {
        address actualSignerA = digest.recover(sigA);
        address actualSignerB = digest.recover(sigB);

        if (!_isAuthorizedSigner(channelId, playerA, actualSignerA))
            revert CommitWrongSignerA(slot);
        if (!_isAuthorizedSigner(channelId, playerB, actualSignerB))
            revert CommitWrongSignerB(slot);
    }

    /// @notice Check if signer is authorized to sign for a player
    /// @param channelId The channel identifier
    /// @param player The player address
    /// @param signer The signer address
    /// @return True if signer is authorized to sign for the player
    function _isAuthorizedSigner(
        uint256 channelId,
        address player,
        address signer
    ) private view returns (bool) {
        Channel storage ch = channels[channelId];

        if (player == ch.player1) {
            return
                signer == ch.player1 ||
                (ch.player1Signer != address(0) && signer == ch.player1Signer);
        }
        if (player == ch.player2) {
            return
                signer == ch.player2 ||
                (ch.player2Signer != address(0) && signer == ch.player2Signer);
        }

        return false;
    }

    /// @notice Verifies that all actions are signed by the action sender
    /// @param channelId The channel identifier
    /// @param handId The hand identifier
    /// @param actions Array of actions to verify
    /// @param signatures Array of signatures of the corresponding actions (signed by the sender of each action)
    /// @param player1 Address of player1
    /// @param player2 Address of player2
    function _verifyActionSignatures(
        uint256 channelId,
        uint256 handId,
        Action[] calldata actions,
        bytes[] calldata signatures,
        address player1,
        address player2
    ) private view {
        if (actions.length != signatures.length)
            revert ActionSignatureLengthMismatch();

        for (uint256 i = 0; i < actions.length; i++) {
            Action calldata action = actions[i];

            // Verify action belongs to correct channel and hand
            if (action.channelId != channelId) revert ActionWrongChannel();
            if (action.handId != handId) revert ActionWrongHand();

            // Verify sender is one of the valid players
            if (action.sender != player1 && action.sender != player2)
                revert ActionInvalidSender();

            // Get EIP712 digest for this action
            bytes32 digest = digestAction(action);

            // Verify the sender signed this action OR an authorized signer signed it
            bytes calldata sig = signatures[i];
            address actualSigner = digest.recover(sig);

            if (!_isAuthorizedSigner(channelId, action.sender, actualSigner))
                revert ActionWrongSigner();
        }
    }

    // helper function to reduce stack pressure
    function _validateCardCommitLengths(
        uint256 commitCount,
        uint256 sigCount,
        uint256 cardCount,
        uint256 saltCount
    ) private pure {
        if (commitCount * 2 != sigCount) revert SignatureLengthMismatch();
        if (commitCount != cardCount) revert CardsLengthMismatch();
        if (commitCount != saltCount) revert CardSaltsLengthMismatch();
    }

    // Applies a batch of card commits/openings.
    /// @param signatures Array of signatures of cards (signed by player1 and player2)
    function _applyCardCommit(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata cardCommits,
        bytes[] calldata signatures,
        uint8[] calldata cards,
        bytes32[] calldata cardSalts
    ) internal {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        _validateCardCommitLengths(
            cardCommits.length,
            signatures.length,
            cards.length,
            cardSalts.length
        );

        uint16 mask = sd.lockedCommitMask;
        uint16 seenMask;

        for (uint256 i = 0; i < cardCommits.length; i++) {
            HeadsUpPokerEIP712.CardCommit calldata cc = cardCommits[i];
            uint8 slot = cc.slot;
            uint16 bit = uint16(1) << slot;

            if ((MASK_ALL & bit) == 0) revert CommitUnexpected(slot);
            if ((seenMask & bit) == bit) revert CommitDuplicate(slot);
            seenMask |= bit;

            if (cards[i] == 0xFF) continue;

            if (mask & bit == bit) continue; // already locked, skip

            if (cc.channelId != channelId) revert CommitWrongChannel(slot);

            _checkSigners(
                channelId,
                slot,
                digestCardCommit(cc),
                signatures[i * 2],
                signatures[i * 2 + 1],
                ch.player1,
                ch.player2
            );

            if (
                keccak256(
                    abi.encodePacked(
                        _domainSeparatorV4(),
                        channelId,
                        slot,
                        cards[i],
                        cardSalts[i]
                    )
                ) != cc.commitHash
            ) revert HashMismatch();

            sd.cards[slot] = cards[i];
            mask |= bit;
        }
        sd.lockedCommitMask = mask;

        // finalize automatically if all cards revealed and commits present
        if (mask == MASK_ALL) {
            _rewardShowdown(channelId);
        }
    }

    function _rewardShowdown(uint256 channelId) internal {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        // not necessary but saves some gas
        if (ch.finalized) return;

        uint8[7] memory player1Cards;
        uint8[7] memory player2Cards;

        player1Cards[0] = sd.cards[SLOT_A1];
        player1Cards[1] = sd.cards[SLOT_A2];
        player2Cards[0] = sd.cards[SLOT_B1];
        player2Cards[1] = sd.cards[SLOT_B2];

        for (uint256 i = 0; i < 5; i++) {
            uint8 card = sd.cards[uint8(SLOT_FLOP1 + i)];
            player1Cards[i + 2] = card;
            player2Cards[i + 2] = card;
        }

        uint256 player1Rank = PokerEvaluator.evaluateHand(player1Cards);
        uint256 player2Rank = PokerEvaluator.evaluateHand(player2Cards);

        address winner;
        uint256 wonAmount = sd.calledAmount;
        if (player1Rank > player2Rank) {
            winner = ch.player1;
        } else if (player2Rank > player1Rank) {
            winner = ch.player2;
        } else {
            // no reward on tie
            winner = ch.player1;
            wonAmount = 0;
        }

        _rewardWinner(channelId, winner, wonAmount);
    }

    function _rewardWinner(
        uint256 channelId,
        address winner,
        uint256 wonAmount
    ) internal {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        if (ch.finalized) return;
        ch.finalized = true;
        sd.inProgress = false;

        if (winner == ch.player1) {
            ch.deposit1 += wonAmount;
            ch.deposit2 -= wonAmount;
        } else {
            ch.deposit1 -= wonAmount;
            ch.deposit2 += wonAmount;
        }

        emit ShowdownFinalized(channelId, winner, wonAmount);
    }

    function getShowdown(
        uint256 channelId
    ) external view returns (ShowdownState memory) {
        return showdowns[channelId];
    }

    function getDispute(
        uint256 channelId
    ) external view returns (DisputeState memory) {
        return disputes[channelId];
    }

    /// @notice Initiates showdown state
    /// @dev Sets up showdown state without requiring initial card commits
    /// @param channelId The channel identifier
    function _initiateShowdown(
        uint256 channelId,
        uint256 calledAmount
    ) internal {
        ShowdownState storage sd = showdowns[channelId];

        // Set up showdown state without requiring initial commits
        sd.deadline = block.timestamp + revealWindow;
        sd.inProgress = true;
        sd.lockedCommitMask = 0;
        sd.calledAmount = calledAmount;

        // Initialize all cards as unrevealed
        for (uint8 i = 0; i < 9; i++) {
            sd.cards[i] = 0xFF;
        }

        emit ShowdownStarted(channelId);
    }

    /// @notice Reveal additional cards and/or commits during reveal window
    function revealCards(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata cardCommits,
        bytes[] calldata signatures,
        uint8[] calldata cards,
        bytes32[] calldata cardSalts
    ) external nonReentrant {
        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();

        if (block.timestamp > sd.deadline) revert Expired();

        _applyCardCommit(channelId, cardCommits, signatures, cards, cardSalts);
        emit CommitsUpdated(channelId, sd.lockedCommitMask);
    }

    /// @notice Finalize showdown after reveal window has passed
    function finalizeShowdown(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        // not necessary but saves some gas
        if (ch.finalized) revert AlreadyFinalized();
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (block.timestamp <= sd.deadline) revert StillRevealing();

        bool aRevealed = sd.cards[SLOT_A1] != 0xFF && sd.cards[SLOT_A2] != 0xFF;
        bool bRevealed = sd.cards[SLOT_B1] != 0xFF && sd.cards[SLOT_B2] != 0xFF;

        // default case: neither player revealed any cards or both revealed without full board
        address winner = ch.player1;
        uint256 wonAmount = 0;

        if (aRevealed && !bRevealed) {
            wonAmount = sd.calledAmount;
        } else if (!aRevealed && bRevealed) {
            winner = ch.player2;
            wonAmount = sd.calledAmount;
        }

        _rewardWinner(channelId, winner, wonAmount);
    }

    // ------------------------------------------------------------------
    // Force Reveal Functions
    // ------------------------------------------------------------------

    /// @notice Request force reveal of Player A's hole cards
    /// @dev Only player A can request. No prerequisites. Helper = B.
    /// @param channelId The channel identifier
    function requestHoleA(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        if (fr.inProgress) revert ForceRevealInProgress();
        if (msg.sender != ch.player1 && msg.sender != ch.player1Signer) revert NotPlayer();
        if (decks[channelId].length != 52) revert InvalidBDeck();

        // Indices for A's two holes (positions 0, 1 in the deck)
        uint8[] memory indices = new uint8[](2);
        indices[0] = 0;
        indices[1] = 1;

        fr.stage = ForceRevealStage.HOLE_A;
        fr.inProgress = true;
        fr.served = false;
        fr.deadline = block.timestamp + forceRevealWindow;
        fr.obligatedHelper = ch.player2; // B must answer
        fr.indices = indices;

        emit ForceRevealOpened(channelId, uint8(ForceRevealStage.HOLE_A), indices);
    }

    /// @notice Answer force reveal for Player A's hole cards
    /// @dev Player B provides DecryptResp for indices 0 and 1
    /// @param channelId The channel identifier
    /// @param decryptResps Array of 2 DecryptResp structs (for indices 0 and 1)
    /// @param signatures Array of 2 signatures from helper (B)
    /// @param pkHelperG2 Helper's G2 public key (128 bytes)
    function answerHoleA(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp[] calldata decryptResps,
        bytes[] calldata signatures,
        bytes calldata pkHelperG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (fr.stage != ForceRevealStage.HOLE_A) revert ForceRevealWrongStage();
        if (fr.served) revert ForceRevealAlreadyServed();
        if (block.timestamp > fr.deadline) revert Expired();
        if (decryptResps.length != 2 || signatures.length != 2) revert InvalidDecryptResp();
        if (pkHelperG2.length != 128) revert InvalidDecryptResp();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        // Verify A's hole 1 (index 0)
        _verifyDecryptResp(channelId, deckHash, fr.indices[0], decryptResps[0], signatures[0], fr.obligatedHelper, deck[fr.indices[0]], pkHelperG2);
        // Verify A's hole 2 (index 1)
        _verifyDecryptResp(channelId, deckHash, fr.indices[1], decryptResps[1], signatures[1], fr.obligatedHelper, deck[fr.indices[1]], pkHelperG2);

        // Store revealed cards
        revealedCards[channelId][fr.indices[0]] = decryptResps[0].U;
        revealedCards[channelId][fr.indices[1]] = decryptResps[1].U;

        fr.served = true;
        emit ForceRevealServed(channelId, uint8(ForceRevealStage.HOLE_A), fr.indices);
    }

    /// @notice Slash the obligated helper for any force reveal stage
    /// @dev Can be called after deadline expires without answer
    /// @param channelId The channel identifier
    function slashForceReveal(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (block.timestamp <= fr.deadline) revert ForceRevealNotExpired();
        if (fr.served) revert ForceRevealAlreadyServed();

        // Determine which player to slash based on obligated helper
        uint256 slashAmt = ch.slashAmount;
        if (fr.obligatedHelper == ch.player1) {
            if (ch.deposit1 < slashAmt) slashAmt = ch.deposit1;
            ch.deposit1 -= slashAmt;
            ch.deposit2 += slashAmt;
        } else {
            if (ch.deposit2 < slashAmt) slashAmt = ch.deposit2;
            ch.deposit2 -= slashAmt;
            ch.deposit1 += slashAmt;
        }
        
        ch.finalized = true;
        fr.inProgress = false;
        emit ForceRevealSlashed(channelId, uint8(fr.stage), fr.indices, fr.obligatedHelper);
    }

    /// @notice Request force reveal of Player B's hole cards
    /// @dev Only player B can request. Prerequisites optional (checked if indices not already revealed). Helper = A.
    /// @param channelId The channel identifier
    /// @param prerequisiteResps Optional array of 2 DecryptResp structs for A's holes (indices 0,1) signed by B
    /// @param prerequisiteSigs Optional array of 2 signatures from B
    /// @param pkPrereqG2 Helper B's G2 public key for verifying prerequisites (only if prerequisites provided)
    function requestHoleB(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp[] calldata prerequisiteResps,
        bytes[] calldata prerequisiteSigs,
        bytes calldata pkPrereqG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        if (fr.inProgress) revert ForceRevealInProgress();
        if (msg.sender != ch.player2 && msg.sender != ch.player2Signer) revert NotPlayer();
        
        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        // Verify prerequisites only if A's holes not already revealed via force reveal
        bool needPrereqs = (revealedCards[channelId][0].length == 0 || revealedCards[channelId][1].length == 0);
        if (needPrereqs) {
            if (prerequisiteResps.length != 2 || prerequisiteSigs.length != 2) revert PrerequisitesNotMet();
            if (pkPrereqG2.length != 128) revert InvalidBDeck();
            
            // Verify A's hole 1 (index 0) signed by B
            _verifyDecryptResp(channelId, deckHash, 0, prerequisiteResps[0], prerequisiteSigs[0], ch.player2, deck[0], pkPrereqG2);
            // Verify A's hole 2 (index 1) signed by B
            _verifyDecryptResp(channelId, deckHash, 1, prerequisiteResps[1], prerequisiteSigs[1], ch.player2, deck[1], pkPrereqG2);
            
            // Store revealed cards
            revealedCards[channelId][0] = prerequisiteResps[0].U;
            revealedCards[channelId][1] = prerequisiteResps[1].U;
        }

        // Indices for B's two holes (positions 2, 3 in the deck)
        uint8[] memory indices = new uint8[](2);
        indices[0] = 2;
        indices[1] = 3;

        fr.stage = ForceRevealStage.HOLE_B;
        fr.inProgress = true;
        fr.served = false;
        fr.deadline = block.timestamp + forceRevealWindow;
        fr.obligatedHelper = ch.player1; // A must answer
        fr.indices = indices;

        emit ForceRevealOpened(channelId, uint8(ForceRevealStage.HOLE_B), indices);
    }

    /// @notice Answer force reveal for Player B's hole cards
    /// @param channelId The channel identifier
    /// @param decryptResps Array of 2 DecryptResp structs (for indices 2 and 3)
    /// @param signatures Array of 2 signatures from helper (A)
    /// @param pkHelperG2 Helper's G2 public key (128 bytes)
    function answerHoleB(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp[] calldata decryptResps,
        bytes[] calldata signatures,
        bytes calldata pkHelperG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (fr.stage != ForceRevealStage.HOLE_B) revert ForceRevealWrongStage();
        if (fr.served) revert ForceRevealAlreadyServed();
        if (block.timestamp > fr.deadline) revert Expired();
        if (decryptResps.length != 2 || signatures.length != 2) revert InvalidDecryptResp();
        if (pkHelperG2.length != 128) revert InvalidDecryptResp();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        // Verify B's hole 1 (index 2)
        _verifyDecryptResp(channelId, deckHash, fr.indices[0], decryptResps[0], signatures[0], fr.obligatedHelper, deck[fr.indices[0]], pkHelperG2);
        // Verify B's hole 2 (index 3)
        _verifyDecryptResp(channelId, deckHash, fr.indices[1], decryptResps[1], signatures[1], fr.obligatedHelper, deck[fr.indices[1]], pkHelperG2);

        // Store revealed cards
        revealedCards[channelId][fr.indices[0]] = decryptResps[0].U;
        revealedCards[channelId][fr.indices[1]] = decryptResps[1].U;

        fr.served = true;
        emit ForceRevealServed(channelId, uint8(ForceRevealStage.HOLE_B), fr.indices);
    }

    /// @notice Request force reveal of flop cards
    /// @dev Either player can request. Prerequisites optional. Requesting player must provide their DecryptResps.
    /// @param channelId The channel identifier
    /// @param requesterDecryptResps Requesting player's DecryptResp for the 3 flop cards
    /// @param requesterSigs Requesting player's signatures for the 3 flop cards
    /// @param prerequisiteResps Optional array of 4 DecryptResp: [A-hole1, A-hole2, B-hole1, B-hole2]
    /// @param prerequisiteSigs Optional array of 4 signatures: first 2 from B, next 2 from A
    /// @param pkBG2 Helper B's G2 public key (only if prerequisites provided)
    /// @param pkAG2 Helper A's G2 public key (only if prerequisites provided)
    /// @param pkRequesterG2 Requesting player's G2 public key
    function requestFlop(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp[] calldata requesterDecryptResps,
        bytes[] calldata requesterSigs,
        HeadsUpPokerEIP712.DecryptResp[] calldata prerequisiteResps,
        bytes[] calldata prerequisiteSigs,
        bytes calldata pkBG2,
        bytes calldata pkAG2,
        bytes calldata pkRequesterG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        if (fr.inProgress) revert ForceRevealInProgress();
        if (msg.sender != ch.player1 && msg.sender != ch.player1Signer && msg.sender != ch.player2 && msg.sender != ch.player2Signer) revert NotPlayer();
        if (requesterDecryptResps.length != 3 || requesterSigs.length != 3) revert InvalidDecryptResp();
        if (pkRequesterG2.length != 128) revert InvalidBDeck();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        // Verify prerequisites only if holes not already revealed
        bool needPrereqs = (revealedCards[channelId][0].length == 0 || revealedCards[channelId][1].length == 0 ||
                           revealedCards[channelId][2].length == 0 || revealedCards[channelId][3].length == 0);
        if (needPrereqs) {
            if (prerequisiteResps.length != 4 || prerequisiteSigs.length != 4) revert PrerequisitesNotMet();
            if (pkBG2.length != 128 || pkAG2.length != 128) revert InvalidBDeck();
            
            // Verify A's holes signed by B
            _verifyDecryptResp(channelId, deckHash, 0, prerequisiteResps[0], prerequisiteSigs[0], ch.player2, deck[0], pkBG2);
            _verifyDecryptResp(channelId, deckHash, 1, prerequisiteResps[1], prerequisiteSigs[1], ch.player2, deck[1], pkBG2);
            // Verify B's holes signed by A
            _verifyDecryptResp(channelId, deckHash, 2, prerequisiteResps[2], prerequisiteSigs[2], ch.player1, deck[2], pkAG2);
            _verifyDecryptResp(channelId, deckHash, 3, prerequisiteResps[3], prerequisiteSigs[3], ch.player1, deck[3], pkAG2);
            
            // Store revealed cards
            revealedCards[channelId][0] = prerequisiteResps[0].U;
            revealedCards[channelId][1] = prerequisiteResps[1].U;
            revealedCards[channelId][2] = prerequisiteResps[2].U;
            revealedCards[channelId][3] = prerequisiteResps[3].U;
        }

        // Determine requester and obligated helper
        address requester = (msg.sender == ch.player1 || msg.sender == ch.player1Signer) ? ch.player1 : ch.player2;
        address obligatedHelper = (requester == ch.player1) ? ch.player2 : ch.player1;

        // Verify requester's flop DecryptResps
        _verifyDecryptResp(channelId, deckHash, 4, requesterDecryptResps[0], requesterSigs[0], requester, deck[4], pkRequesterG2);
        _verifyDecryptResp(channelId, deckHash, 5, requesterDecryptResps[1], requesterSigs[1], requester, deck[5], pkRequesterG2);
        _verifyDecryptResp(channelId, deckHash, 6, requesterDecryptResps[2], requesterSigs[2], requester, deck[6], pkRequesterG2);

        // Store requester's flop cards
        revealedCards[channelId][4] = requesterDecryptResps[0].U;
        revealedCards[channelId][5] = requesterDecryptResps[1].U;
        revealedCards[channelId][6] = requesterDecryptResps[2].U;

        // Flop indices are 4, 5, 6
        uint8[] memory indices = new uint8[](3);
        indices[0] = 4;
        indices[1] = 5;
        indices[2] = 6;

        fr.stage = ForceRevealStage.FLOP;
        fr.inProgress = true;
        fr.served = false;
        fr.deadline = block.timestamp + forceRevealWindow;
        fr.obligatedHelper = obligatedHelper;
        fr.indices = indices;

        emit ForceRevealOpened(channelId, uint8(ForceRevealStage.FLOP), indices);
    }

    /// @notice Answer force reveal for flop cards
    /// @param channelId The channel identifier
    /// @param bDeck Array of 52 G1 encrypted card points (Y values)
    /// @notice Answer force reveal for flop cards
    /// @dev Helper provides their DecryptResps for the 3 flop cards. Flop cards are now fully revealed with both players' responses.
    /// @param channelId The channel identifier
    /// @param decryptResps Array of 3 DecryptResp structs (for indices 4, 5, 6) from helper
    /// @param signatures Array of 3 signatures from helper
    /// @param pkHelperG2 Helper's G2 public key (128 bytes)
    function answerFlop(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp[] calldata decryptResps,
        bytes[] calldata signatures,
        bytes calldata pkHelperG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (fr.stage != ForceRevealStage.FLOP) revert ForceRevealWrongStage();
        if (fr.served) revert ForceRevealAlreadyServed();
        if (block.timestamp > fr.deadline) revert Expired();
        if (decryptResps.length != 3 || signatures.length != 3) revert InvalidDecryptResp();
        if (pkHelperG2.length != 128) revert InvalidDecryptResp();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        // Verify flop card 1 (index 4)
        _verifyDecryptResp(channelId, deckHash, fr.indices[0], decryptResps[0], signatures[0], fr.obligatedHelper, deck[fr.indices[0]], pkHelperG2);
        // Verify flop card 2 (index 5)
        _verifyDecryptResp(channelId, deckHash, fr.indices[1], decryptResps[1], signatures[1], fr.obligatedHelper, deck[fr.indices[1]], pkHelperG2);
        // Verify flop card 3 (index 6)
        _verifyDecryptResp(channelId, deckHash, fr.indices[2], decryptResps[2], signatures[2], fr.obligatedHelper, deck[fr.indices[2]], pkHelperG2);

        fr.served = true;
        emit ForceRevealServed(channelId, uint8(ForceRevealStage.FLOP), fr.indices);
    }

    /// @notice Request force reveal of turn card
    /// @dev Either player can request. Prerequisites optional. Requesting player provides their DecryptResp.
    /// @param channelId The channel identifier
    /// @param channelId The channel identifier  
    /// @param requesterDecryptResp Requesting player's DecryptResp for the turn card
    /// @param requesterSig Requesting player's signature
    /// @param pkRequesterG2 Requesting player's G2 public key
    function requestTurn(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp calldata requesterDecryptResp,
        bytes calldata requesterSig,
        bytes calldata pkRequesterG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        if (fr.inProgress) revert ForceRevealInProgress();
        if (msg.sender != ch.player1 && msg.sender != ch.player1Signer && msg.sender != ch.player2 && msg.sender != ch.player2Signer) revert NotPlayer();
        if (pkRequesterG2.length != 128) revert InvalidBDeck();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        // Verify flop cards are already revealed (indices 4, 5, 6)
        if (revealedCards[channelId][4].length == 0 || revealedCards[channelId][5].length == 0 || revealedCards[channelId][6].length == 0) {
            revert PrerequisitesNotMet();
        }

        // Determine requester and obligated helper
        address requester = (msg.sender == ch.player1 || msg.sender == ch.player1Signer) ? ch.player1 : ch.player2;
        address obligatedHelper = (requester == ch.player1) ? ch.player2 : ch.player1;

        // Verify requester's turn DecryptResp
        _verifyDecryptResp(channelId, deckHash, 7, requesterDecryptResp, requesterSig, requester, deck[7], pkRequesterG2);

        // Store requester's turn card
        revealedCards[channelId][7] = requesterDecryptResp.U;

        // Turn index is 7
        uint8[] memory indices = new uint8[](1);
        indices[0] = 7;

        fr.stage = ForceRevealStage.TURN;
        fr.inProgress = true;
        fr.served = false;
        fr.deadline = block.timestamp + forceRevealWindow;
        fr.obligatedHelper = obligatedHelper;
        fr.indices = indices;

        emit ForceRevealOpened(channelId, uint8(ForceRevealStage.TURN), indices);
    }

    /// @notice Answer force reveal for turn card
    /// @param channelId The channel identifier
    /// @param decryptResp DecryptResp struct for index 7 from helper
    /// @param signature Signature from helper
    /// @param pkHelperG2 Helper's G2 public key (128 bytes)
    function answerTurn(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp calldata decryptResp,
        bytes calldata signature,
        bytes calldata pkHelperG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (fr.stage != ForceRevealStage.TURN) revert ForceRevealWrongStage();
        if (fr.served) revert ForceRevealAlreadyServed();
        if (block.timestamp > fr.deadline) revert Expired();
        if (pkHelperG2.length != 128) revert InvalidDecryptResp();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        _verifyDecryptResp(channelId, deckHash, fr.indices[0], decryptResp, signature, fr.obligatedHelper, deck[fr.indices[0]], pkHelperG2);

        fr.served = true;
        emit ForceRevealServed(channelId, uint8(ForceRevealStage.TURN), fr.indices);
    }

    /// @notice Request force reveal of river card
    /// @dev Either player can request. Prerequisites checked. Requesting player provides their DecryptResp.
    /// @param channelId The channel identifier
    /// @param requesterDecryptResp Requesting player's DecryptResp for the river card
    /// @param requesterSig Requesting player's signature
    /// @param pkRequesterG2 Requesting player's G2 public key
    function requestRiver(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp calldata requesterDecryptResp,
        bytes calldata requesterSig,
        bytes calldata pkRequesterG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        if (fr.inProgress) revert ForceRevealInProgress();
        if (msg.sender != ch.player1 && msg.sender != ch.player1Signer && msg.sender != ch.player2 && msg.sender != ch.player2Signer) revert NotPlayer();
        if (pkRequesterG2.length != 128) revert InvalidBDeck();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        // Verify turn card is already revealed (index 7)
        if (revealedCards[channelId][7].length == 0) {
            revert PrerequisitesNotMet();
        }

        // Determine requester and obligated helper
        address requester = (msg.sender == ch.player1 || msg.sender == ch.player1Signer) ? ch.player1 : ch.player2;
        address obligatedHelper = (requester == ch.player1) ? ch.player2 : ch.player1;

        // Verify requester's river DecryptResp
        _verifyDecryptResp(channelId, deckHash, 8, requesterDecryptResp, requesterSig, requester, deck[8], pkRequesterG2);

        // Store requester's river card
        revealedCards[channelId][8] = requesterDecryptResp.U;

        // River index is 8
        uint8[] memory indices = new uint8[](1);
        indices[0] = 8;

        fr.stage = ForceRevealStage.RIVER;
        fr.inProgress = true;
        fr.served = false;
        fr.deadline = block.timestamp + forceRevealWindow;
        fr.obligatedHelper = obligatedHelper;
        fr.indices = indices;

        emit ForceRevealOpened(channelId, uint8(ForceRevealStage.RIVER), indices);
    }

    /// @notice Answer force reveal for river card
    /// @param channelId The channel identifier
    /// @param decryptResp DecryptResp struct for index 8 from helper
    /// @param signature Signature from helper
    /// @param pkHelperG2 Helper's G2 public key (128 bytes)
    function answerRiver(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptResp calldata decryptResp,
        bytes calldata signature,
        bytes calldata pkHelperG2
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ForceRevealState storage fr = forceReveals[channelId];

        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (fr.stage != ForceRevealStage.RIVER) revert ForceRevealWrongStage();
        if (fr.served) revert ForceRevealAlreadyServed();
        if (block.timestamp > fr.deadline) revert Expired();
        if (pkHelperG2.length != 128) revert InvalidDecryptResp();

        bytes[] storage deck = decks[channelId];
        bytes32 deckHash = _hashBDeck(deck);

        _verifyDecryptResp(
            channelId,
            deckHash,
            fr.indices[0],
            decryptResp,
            signature,
            fr.obligatedHelper,
            deck[fr.indices[0]],
            pkHelperG2
        );

        fr.served = true;
        emit ForceRevealServed(channelId, uint8(ForceRevealStage.RIVER), fr.indices);
    }

    /// @notice Internal helper to compute the hash of bDeck
    /// @dev Hashes all 52 encrypted card points
    function _hashBDeck(bytes[] calldata bDeck) internal pure returns (bytes32) {
        return keccak256(abi.encode(bDeck));
    }

    /// @notice Internal helper to compute the hash of bDeck from storage
    /// @dev Hashes all 52 encrypted card points
    function _hashBDeck(bytes[] storage bDeck) internal view returns (bytes32) {
        return keccak256(abi.encode(bDeck));
    }

    /// @notice Internal helper to verify a DecryptResp
    /// @dev Verifies EIP-712 signature and BN254 pairing
    function _verifyDecryptResp(
        uint256 channelId,
        bytes32 deckHash,
        uint8 index,
        HeadsUpPokerEIP712.DecryptResp calldata decryptResp,
        bytes calldata signature,
        address expectedSigner,
        bytes storage Y,
        bytes calldata pkHelperG2
    ) internal view {
        // Verify DecryptResp matches the expected values
        if (decryptResp.channelId != channelId || decryptResp.deckHash != deckHash || decryptResp.index != index) {
            revert InvalidDecryptResp();
        }
        if (decryptResp.U.length != 64 || Y.length != 64 || pkHelperG2.length != 128) {
            revert InvalidDecryptResp();
        }

        // Verify EIP-712 signature
        if (digestDecryptResp(decryptResp).recover(signature) != expectedSigner) {
            revert InvalidDecryptResp();
        }
        
        // Verify BN254 pairing: e(U, pk_helper_G2) == e(Y, G2_BASE)
        if (!Bn254.verifyPartialDecrypt(decryptResp.U, Y, pkHelperG2)) {
            revert InvalidDecryptResp();
        }
    }
}
