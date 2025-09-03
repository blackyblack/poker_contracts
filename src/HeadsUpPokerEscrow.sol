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
    error NoOverlap();
    error HashMismatch();
    error BoardOpenFailed();
    error HoleOpenFailed();
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
    error ReplayDidNotEndInFold();
    error NoActionsProvided();

    // ------------------------------------------------------------------
    // Showdown state
    // ------------------------------------------------------------------
    struct ShowdownState {
        address initiator;
        address opponent;
        uint256 deadline;
        bool inProgress;
        bytes32 oppHoleHash1;
        bytes32 oppHoleHash2;
        uint8[5] board;
        uint8[2] initiatorHole;
        uint16 lockedCommitMask;
        bytes32[9] lockedCommitHashes;
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
        uint256 nextHandId; // Local counter for this channel
        uint256 lastJoinedHandId; // Track when player2 last joined
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
    event FoldSettled(
        uint256 indexed channelId,
        address indexed winner,
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

        // Initialize nextHandId for new channels
        bool isNewChannel = (ch.player1 == address(0));
        if (isNewChannel) {
            ch.nextHandId = 1; // Start at 1 for new channels
        }
        // For reused channels, nextHandId keeps incrementing from previous value
        
        // Generate channel-local handId
        handId = ch.nextHandId++;

        ch.player1 = msg.sender;
        ch.player2 = opponent;
        ch.deposit1 += msg.value; // Add to existing deposit instead of overwriting
        // Note: Do not reset deposit2 to allow player2 to accumulate winnings
        ch.finalized = false;
        ch.handId = handId;
        ch.minSmallBlind = minSmallBlind;

        // Reset showdown state when reusing channel
        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) {
            sd.inProgress = false;
            sd.initiator = address(0);
            sd.opponent = address(0);
            sd.deadline = 0;
            sd.lockedCommitMask = 0;
        }

        emit ChannelOpened(channelId, msg.sender, opponent, msg.value, handId, minSmallBlind);
    }

    /// @notice Opponent joins an open channel by matching deposit
    function join(uint256 channelId) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.player2 != msg.sender) revert NotOpponent();
        if (ch.lastJoinedHandId == ch.handId) revert AlreadyJoined(); // Check if already joined this hand
        
        // Allow zero deposit only if there's existing deposit from previous games
        if (msg.value == 0 && ch.deposit2 == 0) revert NoDeposit();

        ch.deposit2 += msg.value; // Add to existing deposit instead of overwriting
        ch.lastJoinedHandId = ch.handId; // Mark as joined for this hand

        emit ChannelJoined(channelId, msg.sender, msg.value);
    }

    /// @notice Settles fold using co-signed action transcript verification  
    /// @param channelId The channel identifier
    /// @param actions Array of co-signed actions representing the poker hand
    /// @param signatures Array of signatures (2 per action: player1, player2)
    function settleFold(
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
        
        // Replay actions to verify they end in a fold
        (HeadsUpPokerReplay.End endType, uint8 folder, uint256 calledAmount) = replay.replayAndGetEndState(
            actions, 
            ch.deposit1, 
            ch.deposit2,
            ch.minSmallBlind
        );
        
        if (endType != HeadsUpPokerReplay.End.FOLD) revert ReplayDidNotEndInFold();
        
        // Winner is the non-folder
        address winner = folder == 0 ? ch.player2 : ch.player1;

        // Transfer only the called amount from loser to winner
        // This ensures uncalled chips never change hands
        if (winner == ch.player1) {
            ch.deposit1 += calledAmount;
            ch.deposit2 -= calledAmount;
        } else {
            ch.deposit1 -= calledAmount;
            ch.deposit2 += calledAmount;
        }

        ch.finalized = true;

        emit FoldSettled(channelId, winner, calledAmount);
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

    function verifyCoSignedCommits(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint16 allowedMask,
        address addrA,
        address addrB
    )
        internal
        view
        returns (
            bytes32[9] memory hashes,
            uint16 presentMask
        )
    {
        if (commits.length * 2 != sigs.length) revert SignatureLengthMismatch();
        uint16 seenMask;
        for (uint256 i = 0; i < commits.length; i++) {
            HeadsUpPokerEIP712.CardCommit calldata cc = commits[i];
            // Limit lifetime of locals to this block
            {
                uint8 slot = cc.slot;
                uint16 bit = uint16(1) << slot;

                if ((allowedMask & bit) == 0) revert CommitUnexpected(slot);
                if ((seenMask & bit) != 0) revert CommitDuplicate(slot);
                seenMask |= bit;

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

                hashes[slot] = cc.commitHash;
                presentMask |= bit;
            }
        }
    }

    // Applies a batch of commits/openings.
    function _applyCommitUpdate(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts,
        address submitter,
        bool requireOverlap
    ) internal returns (uint16 finalMask) {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        address addrA = ch.player1;
        address addrB = ch.player2;

        (
            bytes32[9] memory newHashes,
            uint16 newMask
        ) = verifyCoSignedCommits(
                channelId,
                commits,
                sigs,
                MASK_ALL,
                addrA,
                addrB
            );

        uint16 oldMask = sd.lockedCommitMask;

        // check for overlap with existing locked set if required
        if (requireOverlap && oldMask != 0) {
            if ((newMask & oldMask) == 0) revert NoOverlap();
            for (uint8 slot = 0; slot < 9; slot++) {
                uint16 bit = uint16(1) << slot;
                if (((newMask & oldMask) & bit) != 0) {
                    // Require exact match for existing commits (no overrides)
                    if (newHashes[slot] != sd.lockedCommitHashes[slot]) revert HashMismatch();
                }
            }
        }

        // merge new commits into locked set
        uint16 mergedMask = oldMask | newMask;
        for (uint8 slot2 = 0; slot2 < 9; slot2++) {
            uint16 bit2 = uint16(1) << slot2;
            if ((newMask & bit2) != 0) {
                // Update slot if it's new or if it matches existing hash
                if ((oldMask & bit2) == 0 || newHashes[slot2] == sd.lockedCommitHashes[slot2]) {
                    sd.lockedCommitHashes[slot2] = newHashes[slot2];
                }
            }
        }
        sd.lockedCommitMask = mergedMask;

        uint8 submitterSlot1;
        uint8 submitterSlot2;
        uint8 opp1;
        uint8 opp2;
        if (submitter == addrA) {
            submitterSlot1 = SLOT_A1;
            submitterSlot2 = SLOT_A2;
            opp1 = SLOT_B1;
            opp2 = SLOT_B2;
        } else {
            submitterSlot1 = SLOT_B1;
            submitterSlot2 = SLOT_B2;
            opp1 = SLOT_A1;
            opp2 = SLOT_A2;
        }

        if ((newMask & (uint16(1) << opp1)) != 0) {
            sd.oppHoleHash1 = newHashes[opp1];
        }
        if ((newMask & (uint16(1) << opp2)) != 0) {
            sd.oppHoleHash2 = newHashes[opp2];
        }

        bytes32 domainSeparator = _domainSeparatorV4();

        // Board
        for (uint256 i = 0; i < 5; i++) {
            uint8 slot = uint8(SLOT_FLOP1 + i);
            uint16 bit = uint16(1) << slot;
            if (((newMask & bit) == 0)) {
                continue;
            }
            bytes32 h = keccak256(
                abi.encodePacked(
                    domainSeparator,
                    channelId,
                    slot,
                    boardCodes[i],
                    boardSalts[i]
                )
            );
            if (h != newHashes[slot]) revert BoardOpenFailed();
            sd.board[i] = boardCodes[i];
        }

        for (uint256 i = 0; i < 2; i++) {
            uint8 slot = i == 0 ? submitterSlot1 : submitterSlot2;
            uint16 bit = uint16(1) << slot;
            if (((newMask & bit) == 0)) {
                continue;
            }
            bytes32 h = keccak256(
                abi.encodePacked(
                    domainSeparator,
                    channelId,
                    slot,
                    holeCodes[i],
                    holeSalts[i]
                )
            );
            if (h != newHashes[slot]) revert HoleOpenFailed();
            if (submitter == sd.initiator) {
                sd.initiatorHole[i] = holeCodes[i];
            }
        }

        return sd.lockedCommitMask;
    }

    function _forfeitToInitiator(uint256 channelId) internal {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        if (ch.finalized) return;
        ch.finalized = true;

        uint256 pot = ch.deposit1 + ch.deposit2;
        
        // Add pot to initiator's deposit instead of sending to address
        if (sd.initiator == ch.player1) {
            ch.deposit1 = pot;
            ch.deposit2 = 0;
        } else {
            ch.deposit1 = 0;
            ch.deposit2 = pot;
        }

        emit ShowdownFinalized(channelId, sd.initiator, pot);
    }

    function getShowdown(
        uint256 channelId
    ) external view returns (ShowdownState memory) {
        return showdowns[channelId];
    }

    /// @notice Player submits commitments and openings to start showdown
    function startShowdown(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts
    ) external nonReentrant {
        startShowdownInternal(channelId, commits, sigs, boardCodes, boardSalts, holeCodes, holeSalts, msg.sender);
    }

    /// @notice Player or third party submits commitments and openings to start showdown on behalf of a player
    function startShowdownOnBehalfOf(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts,
        address onBehalfOf
    ) external nonReentrant {
        startShowdownInternal(channelId, commits, sigs, boardCodes, boardSalts, holeCodes, holeSalts, onBehalfOf);
    }

    function startShowdownInternal(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts,
        address onBehalfOf
    ) internal {
        Channel storage ch = channels[channelId];
        if (ch.deposit1 == 0 || ch.deposit2 == 0) revert ChannelNotReady();
        if (onBehalfOf != ch.player1 && onBehalfOf != ch.player2) revert NotPlayer();

        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) revert ShowdownInProgress();

        sd.initiator = onBehalfOf;
        sd.opponent = onBehalfOf == ch.player1 ? ch.player2 : ch.player1;
        sd.deadline = block.timestamp + revealWindow;
        sd.inProgress = true;

        _applyCommitUpdate(
            channelId,
            commits,
            sigs,
            boardCodes,
            boardSalts,
            holeCodes,
            holeSalts,
            onBehalfOf,
            false
        );

        // Require initiator to open both hole cards
        uint8 initiatorSlot1 = onBehalfOf == ch.player1 ? SLOT_A1 : SLOT_B1;
        uint8 initiatorSlot2 = onBehalfOf == ch.player1 ? SLOT_A2 : SLOT_B2;
        if ((sd.lockedCommitMask & (uint16(1) << initiatorSlot1)) == 0 ||
            (sd.lockedCommitMask & (uint16(1) << initiatorSlot2)) == 0) {
            revert InitiatorHolesRequired();
        }

        emit ShowdownStarted(channelId);
        emit CommitsUpdated(channelId, onBehalfOf, sd.lockedCommitMask);
    }

    /// @notice Submit additional commits during reveal window
    function submitAdditionalCommits(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts
    ) external nonReentrant {
        submitAdditionalCommitsInternal(channelId, commits, sigs, boardCodes, boardSalts, holeCodes, holeSalts, msg.sender);
    }

    /// @notice Submit additional commits during reveal window on behalf of a player
    function submitAdditionalCommitsOnBehalfOf(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts,
        address onBehalfOf
    ) external nonReentrant {
        submitAdditionalCommitsInternal(channelId, commits, sigs, boardCodes, boardSalts, holeCodes, holeSalts, onBehalfOf);
    }

    function submitAdditionalCommitsInternal(
        uint256 channelId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts,
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
            boardCodes,
            boardSalts,
            holeCodes,
            holeSalts,
            onBehalfOf,
            // require non-empty overlap with the existing locked set
            true
        );
        emit CommitsUpdated(channelId, onBehalfOf, sd.lockedCommitMask);
    }

    /// @notice Finalize showdown using best commit set locked in dispute
    function finalizeShowdownWithCommits(
        uint256 channelId,
        uint8[2] calldata oppHoleCodes,
        bytes32[2] calldata oppHoleSalts
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.finalized) revert AlreadyFinalized();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (block.timestamp <= sd.deadline) revert StillRevealing();

        // TODO: forfeit to last acting player
        // require full commit set or forfeit to initiator
        if (sd.lockedCommitMask != MASK_ALL) {
            _forfeitToInitiator(channelId);
            return;
        }

        uint8 opp1 = sd.initiator == ch.player1 ? SLOT_B1 : SLOT_A1;
        uint8 opp2 = sd.initiator == ch.player1 ? SLOT_B2 : SLOT_A2;

        bytes32 domainSeparator = _domainSeparatorV4();

        for (uint256 i = 0; i < 2; i++) {
            uint8 slot = i == 0 ? opp1 : opp2;
            bytes32 expectedHash = i == 0 ? sd.oppHoleHash1 : sd.oppHoleHash2;

            bytes32 h = keccak256(
                abi.encodePacked(
                    domainSeparator,
                    channelId,
                    slot,
                    oppHoleCodes[i],
                    oppHoleSalts[i]
                )
            );
            if (h != expectedHash) revert OpponentHoleOpenFailed();
        }

        // TODO: Evaluate hands and determine actual winner
        uint8[7] memory player1Cards;
        uint8[7] memory player2Cards;
        
        // Determine which player is which based on the initiator
        if (sd.initiator == ch.player1) {
            // Initiator is player1, opponent is player2
            player1Cards[0] = sd.initiatorHole[0];
            player1Cards[1] = sd.initiatorHole[1];
            player2Cards[0] = oppHoleCodes[0];
            player2Cards[1] = oppHoleCodes[1];
        } else {
            // Initiator is player2, opponent is player1
            player1Cards[0] = oppHoleCodes[0];
            player1Cards[1] = oppHoleCodes[1];
            player2Cards[0] = sd.initiatorHole[0];
            player2Cards[1] = sd.initiatorHole[1];
        }
        
        // Add community cards to both hands
        for (uint256 i = 0; i < 5; i++) {
            player1Cards[i + 2] = sd.board[i];
            player2Cards[i + 2] = sd.board[i];
        }
        
        // Evaluate both hands
        uint256 player1Rank = PokerEvaluator.evaluateHand(player1Cards);
        uint256 player2Rank = PokerEvaluator.evaluateHand(player2Cards);
        
        // Determine winner (higher rank wins)
        address winner;
        if (player1Rank > player2Rank) {
            winner = ch.player1;
        } else if (player2Rank > player1Rank) {
            winner = ch.player2;
        } else {
            // Tie - default to initiator (could be changed to split pot)
            winner = sd.initiator;
        }

        ch.finalized = true;
        uint256 finalPot = ch.deposit1 + ch.deposit2;
        
        // Add pot to winner's deposit instead of sending to address
        if (winner == ch.player1) {
            ch.deposit1 = finalPot;
            ch.deposit2 = 0;
        } else {
            ch.deposit1 = 0;
            ch.deposit2 = finalPot;
        }

        emit ShowdownFinalized(channelId, winner, finalPot);
    }
}
