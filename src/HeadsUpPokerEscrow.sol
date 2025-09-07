// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import {PokerEvaluator} from "./PokerEvaluator.sol";
import {HeadsUpPokerReplay} from "./HeadsUpPokerReplay.sol";
import {Action} from "./HeadsUpPokerActions.sol";

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
    error ActionWrongSignerA();
    error ActionWrongSignerB();
    error NoActionsProvided();
    error DisputeInProgress();
    error NoDisputeInProgress();
    error DisputeStillActive();
    error SequenceTooShort();
    error SequenceNotLonger();

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
    }

    mapping(uint256 => Channel) private channels;

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
    event ShowdownStarted(uint256 indexed channelId);
    event ShowdownFinalized(
        uint256 indexed channelId,
        address indexed winner,
        uint256 amount
    );
    event CommitsUpdated(
        uint256 indexed channelId,
        address indexed submitter,
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
    function getMinSmallBlind(uint256 channelId) external view returns (uint256) {
        return channels[channelId].minSmallBlind;
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

    // ---------------------------------------------------------------------
    // Channel flow
    // ---------------------------------------------------------------------

    /// @notice Player1 opens a channel with an opponent by depositing ETH
    function open(
        uint256 channelId,
        address opponent,
        uint256 minSmallBlind
    ) external payable nonReentrant returns (uint256 handId) {
        Channel storage ch = channels[channelId];
        if (ch.player1 != address(0) && !ch.finalized) revert ChannelExists();
        if (opponent == address(0) || opponent == msg.sender) revert BadOpponent();
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

        emit ChannelOpened(channelId, msg.sender, opponent, msg.value, handId, minSmallBlind);
    }

    /// @notice Opponent joins an open channel by matching deposit
    function join(uint256 channelId) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.player2 != msg.sender) revert NotOpponent();
        if (ch.player2Joined) revert AlreadyJoined();
        
        // Allow zero deposit only if there's existing deposit from previous games
        if (msg.value == 0 && ch.deposit2 == 0) revert NoDeposit();

        ch.deposit2 += msg.value; // Add to existing deposit instead of overwriting
        ch.player2Joined = true;

        emit ChannelJoined(channelId, msg.sender, msg.value);
    }

    /// @notice Settles terminal action sequences (Fold or Showdown)
    /// @dev Currently only supports Fold endings. Showdown endings redirect to showdown mechanism.
    /// @param channelId The channel identifier
    /// @param actions Array of co-signed actions representing the poker hand
    /// @param signatures Array of signatures (2 per action: player1, player2)
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
        
        // Verify signatures for all actions
        _verifyActionSignatures(channelId, ch.handId, actions, signatures, ch.player1, ch.player2);
        
        // Replay actions to verify they are terminal and get end state
        (HeadsUpPokerReplay.End endType, uint8 folder, uint256 calledAmount) = replay.replayGame(
            actions, 
            ch.deposit1, 
            ch.deposit2,
            ch.minSmallBlind
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
    /// @param actions Array of co-signed actions representing the poker hand
    /// @param signatures Array of signatures (2 per action: player1, player2)
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
        
        // Verify signatures for all actions
        _verifyActionSignatures(channelId, ch.handId, actions, signatures, ch.player1, ch.player2);
        
        // Check if this is starting a new dispute or extending an existing one
        if (ds.inProgress) {
            // Must provide a longer sequence to extend dispute
            if (actions.length <= ds.actionCount) revert SequenceNotLonger();
        }
        
        // Replay actions to get projected end state (handles both terminal and non-terminal)
        (HeadsUpPokerReplay.End endType, uint8 folder, uint256 calledAmount) = replay.replayIncompleteGame(
            actions, 
            ch.deposit1, 
            ch.deposit2,
            ch.minSmallBlind
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
        uint8 slot,
        bytes32 digest,
        bytes calldata sigA,
        bytes calldata sigB,
        address addrA,
        address addrB
    ) private pure {
        if (digest.recover(sigA) != addrA) revert CommitWrongSignerA(slot);
        if (digest.recover(sigB) != addrB) revert CommitWrongSignerB(slot);
    }

    /// @notice Verifies that all actions are co-signed by both players
    /// @param channelId The channel identifier 
    /// @param handId The hand identifier
    /// @param actions Array of actions to verify
    /// @param signatures Array of signatures (2 per action: player1, player2)
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
        if (actions.length * 2 != signatures.length) revert ActionSignatureLengthMismatch();
        
        for (uint256 i = 0; i < actions.length; i++) {
            Action calldata action = actions[i];
            
            // Verify action belongs to correct channel and hand
            if (action.channelId != channelId) revert ActionWrongChannel();
            if (action.handId != handId) revert ActionWrongHand();
            
            // Get EIP712 digest for this action
            bytes32 digest = digestAction(action);
            
            // Verify both players signed this action
            bytes calldata sig1 = signatures[i * 2];
            bytes calldata sig2 = signatures[i * 2 + 1];
            
            if (digest.recover(sig1) != player1) revert ActionWrongSignerA();
            if (digest.recover(sig2) != player2) revert ActionWrongSignerB();
        }
    }

    // Applies a batch of commits/openings.
    function _applyCommitUpdate(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[] calldata cardCodes,
        bytes32[] calldata cardSalts
    ) internal {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        address addrA = ch.player1;
        address addrB = ch.player2;

        if (commits.length * 2 != sigs.length) revert SignatureLengthMismatch();
        if (commits.length != cardCodes.length) revert CardsLengthMismatch();
        if (commits.length != cardSalts.length) revert CardSaltsLengthMismatch();

        bytes32 domainSeparator = _domainSeparatorV4();

        uint16 mask = sd.lockedCommitMask;
        uint16 seenMask;
        for (uint256 i = 0; i < commits.length; i++) {
            HeadsUpPokerEIP712.CardCommit calldata cc = commits[i];
            uint8 slot = cc.slot;
            uint16 bit = uint16(1) << slot;

            if ((MASK_ALL & bit) == 0) revert CommitUnexpected(slot);
            if ((seenMask & bit) == bit) revert CommitDuplicate(slot);
            seenMask |= bit;

            uint8 code = cardCodes[i];
            if (code == 0xFF) continue;

            if (mask & bit == bit) continue; // already locked, skip

            if (cc.channelId != channelId) revert CommitWrongChannel(slot);

            bytes32 digest = digestCardCommit(cc);
            _checkSigners(
                slot,
                digest,
                sigs[i * 2],
                sigs[i * 2 + 1],
                addrA,
                addrB
            );

            bytes32 h = keccak256(
                abi.encodePacked(
                    domainSeparator,
                    channelId,
                    slot,
                    code,
                    cardSalts[i]
                )
            );
            if (h != cc.commitHash) revert HashMismatch();

            sd.cards[slot] = code;

            mask = mask | bit;
        }
        sd.lockedCommitMask = mask;

        // finalize automatically if all cards revealed and commits present
        if (sd.lockedCommitMask == MASK_ALL) {
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

        _forfeitTo(channelId, winner, wonAmount);
    }

    function _forfeitTo(uint256 channelId, address winner, uint256 wonAmount) internal {
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

    /// @notice Get the dispute window duration
    function getDisputeWindow() external pure returns (uint256) {
        return disputeWindow;
    }

    // TODO: remove `startShowdown`

    /// @notice Player submits commitments and openings to start showdown
    function startShowdown(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[] calldata cardCodes,
        bytes32[] calldata cardSalts
    ) external nonReentrant {
        startShowdownInternal(channelId, commits, sigs, cardCodes, cardSalts, msg.sender);
    }

    /// @notice Player or third party submits commitments and openings to start showdown on behalf of a player
    function startShowdownOnBehalfOf(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[] calldata cardCodes,
        bytes32[] calldata cardSalts,
        address onBehalfOf
    ) external nonReentrant {
        startShowdownInternal(channelId, commits, sigs, cardCodes, cardSalts, onBehalfOf);
    }

    function startShowdownInternal(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[] calldata cardCodes,
        bytes32[] calldata cardSalts,
        address onBehalfOf
    ) internal {
        Channel storage ch = channels[channelId];
        DisputeState storage ds = disputes[channelId];
        
        if (ch.deposit1 == 0 || ch.deposit2 == 0) revert ChannelNotReady();
        if (ds.inProgress) revert DisputeInProgress();
        if (onBehalfOf != ch.player1 && onBehalfOf != ch.player2) revert NotPlayer();

        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) revert ShowdownInProgress();

        sd.deadline = block.timestamp + revealWindow;
        sd.inProgress = true;
        sd.lockedCommitMask = 0;
        for (uint8 i = 0; i < 9; i++) {
            sd.cards[i] = 0xFF;
        }

        _applyCommitUpdate(
            channelId,
            commits,
            sigs,
            cardCodes,
            cardSalts
        );

        uint8 initiatorSlot1 = onBehalfOf == ch.player1 ? SLOT_A1 : SLOT_B1;
        uint8 initiatorSlot2 = onBehalfOf == ch.player1 ? SLOT_A2 : SLOT_B2;
        if (
            (sd.lockedCommitMask & (uint16(1) << initiatorSlot1)) == 0 ||
            (sd.lockedCommitMask & (uint16(1) << initiatorSlot2)) == 0 ||
            sd.cards[initiatorSlot1] == 0xFF ||
            sd.cards[initiatorSlot2] == 0xFF
        ) {
            revert InitiatorHolesRequired();
        }

        emit ShowdownStarted(channelId);
        emit CommitsUpdated(channelId, onBehalfOf, sd.lockedCommitMask);
    }

    /// @notice Initiates showdown state
    /// @dev Unlike startShowdownInternal, this doesn't require initial card commits
    /// @param channelId The channel identifier
    function _initiateShowdown(uint256 channelId, uint256 calledAmount) internal {
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
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[] calldata cardCodes,
        bytes32[] calldata cardSalts
    ) external nonReentrant {
        revealCardsInternal(channelId, commits, sigs, cardCodes, cardSalts, msg.sender);
    }

    /// @notice Reveal cards on behalf of a player
    function revealCardsOnBehalfOf(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[] calldata cardCodes,
        bytes32[] calldata cardSalts,
        address onBehalfOf
    ) external nonReentrant {
        revealCardsInternal(channelId, commits, sigs, cardCodes, cardSalts, onBehalfOf);
    }

    function revealCardsInternal(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[] calldata cardCodes,
        bytes32[] calldata cardSalts,
        address onBehalfOf
    ) internal {
        Channel storage ch = channels[channelId];
        
        if (onBehalfOf != ch.player1 && onBehalfOf != ch.player2) revert NotPlayer();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();

        if (block.timestamp > sd.deadline) revert Expired();

        _applyCommitUpdate(
            channelId,
            commits,
            sigs,
            cardCodes,
            cardSalts
        );
        emit CommitsUpdated(channelId, onBehalfOf, sd.lockedCommitMask);
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

        uint256 wonAmount = sd.calledAmount;
        address winner = ch.player1;
        if (aRevealed && bRevealed) {
            wonAmount = 0; // tie if both revealed but failed to provide board cards
        } else if (aRevealed) {
            winner = ch.player1;
        } else if (bRevealed) {
            winner = ch.player2;
        }

        _forfeitTo(channelId, winner, wonAmount);
    }
}
