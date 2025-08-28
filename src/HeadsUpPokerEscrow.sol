// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";

/// @title HeadsUpPokerEscrow - Simple escrow contract for heads up poker matches using ETH only
/// @notice Supports opening channels, joining, settling on fold and basic showdown flow
contract HeadsUpPokerEscrow is ReentrancyGuard, HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    // ------------------------------------------------------------------
    // Slot layout constants
    // ------------------------------------------------------------------
    uint16 constant MASK_ALL = 0x01FF; // bits 0..8
    uint8 constant SLOT_A1 = 0;
    uint8 constant SLOT_A2 = 1;
    uint8 constant SLOT_B1 = 2;
    uint8 constant SLOT_B2 = 3;
    uint8 constant SLOT_FLOP1 = 4;
    uint8 constant SLOT_FLOP2 = 5;
    uint8 constant SLOT_FLOP3 = 6;
    uint8 constant SLOT_TURN = 7;
    uint8 constant SLOT_RIVER = 8;

    uint256 public constant revealWindow = 1 hours;

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error CommitDuplicate(uint8 slot);
    error CommitWrongChannel(uint8 slot);
    error CommitWrongSignerA(uint8 slot);
    error CommitWrongSignerB(uint8 slot);
    error CommitUnexpected(uint8 slot);
    
    // Channel errors
    error ChannelExists();
    error BadOpponent();
    error NoDeposit();
    error NoChannel();
    error NotOpponent();
    error AlreadyJoined();
    error ShowdownInProgress();
    error NotPlayer();
    error PaymentFailed();
    
    // Commit verification errors
    error SignatureLengthMismatch();
    error NoOverlap();
    error HashMismatch();
    error ReferenceMismatch();
    error BoardOpeningFailed();
    error HoleOpeningFailed();
    error BadRoleIndex();
    
    // Showdown errors
    error NotReady();
    error ShowdownAlreadyInProgress();
    error InitiatorHolesRequired();
    error NoShowdownInProgress();
    error ShowdownExpired();
    error AlreadyFinalized();
    error StillRevealing();
    error OpponentHoleOpeningFailed();

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
        bytes32[9] lockedDealRefs;
        uint32 maxSeq;
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
    }

    mapping(uint256 => Channel) private channels;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event ChannelOpened(
        uint256 indexed channelId,
        address indexed player1,
        address indexed player2,
        uint256 amount
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
        uint16 newMask,
        uint32 maxSeq
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

    // ---------------------------------------------------------------------
    // Channel flow
    // ---------------------------------------------------------------------

    /// @notice Player1 opens a channel with an opponent by depositing ETH
    function open(
        uint256 channelId,
        address opponent
    ) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 != address(0)) revert ChannelExists();
        if (opponent == address(0) || opponent == msg.sender) revert BadOpponent();
        if (msg.value == 0) revert NoDeposit();

        ch.player1 = msg.sender;
        ch.player2 = opponent;
        ch.deposit1 = msg.value;

        emit ChannelOpened(channelId, msg.sender, opponent, msg.value);
    }

    /// @notice Opponent joins an open channel by matching deposit
    function join(uint256 channelId) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.player2 != msg.sender) revert NotOpponent();
        if (ch.deposit2 != 0) revert AlreadyJoined();
        if (msg.value == 0) revert NoDeposit();

        ch.deposit2 = msg.value;

        emit ChannelJoined(channelId, msg.sender, msg.value);
    }

    /// @notice Winner claims the entire pot when opponent folds
    function settleFold(
        uint256 channelId,
        address winner
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) revert ShowdownInProgress();
        if (winner != ch.player1 && winner != ch.player2) revert NotPlayer();

        // TODO: add verification that opponent actually folded

        uint256 pot = ch.deposit1 + ch.deposit2;

        ch.deposit1 = 0;
        ch.deposit2 = 0;

        (bool ok, ) = payable(winner).call{value: pot}("");
        if (!ok) revert PaymentFailed();

        emit FoldSettled(channelId, winner, pot);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------
    function toSlotKey(uint8 role, uint8 index) internal pure returns (uint8) {
        if (role == 0 && index < 2) return index; // player A
        if (role == 1 && index < 2) return uint8(2 + index); // player B
        if (role == 2 && index < 5) return uint8(4 + index); // board cards
        revert BadRoleIndex();
    }

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
            bytes32[9] memory dealRefs,
            uint16 presentMask,
            uint32 maxSeq
        )
    {
        if (commits.length * 2 != sigs.length) revert SignatureLengthMismatch();
        uint16 seenMask;
        for (uint256 i = 0; i < commits.length; i++) {
            HeadsUpPokerEIP712.CardCommit calldata cc = commits[i];
            // Limit lifetime of locals to this block
            {
                uint8 slot = toSlotKey(cc.role, cc.index);
                uint16 bit = uint16(1) << slot;

                if ((allowedMask & bit) == 0) revert CommitUnexpected(slot);
                if ((seenMask & bit) != 0) revert CommitDuplicate(slot);
                seenMask |= bit;

                if (cc.channelId != channelId) revert CommitWrongChannel(slot);

                if (cc.seq > maxSeq) {
                    maxSeq = cc.seq;
                }

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
                dealRefs[slot] = cc.dealRef;
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
    ) internal returns (uint16 finalMask, uint32 finalMaxSeq) {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        address addrA = ch.player1;
        address addrB = ch.player2;

        (
            bytes32[9] memory newHashes,
            bytes32[9] memory newDealRefs,
            uint16 newMask,
            uint32 newMaxSeq
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
                    if (newHashes[slot] != sd.lockedCommitHashes[slot]) revert HashMismatch();
                    if (newDealRefs[slot] != sd.lockedDealRefs[slot]) revert ReferenceMismatch();
                }
            }
        }

        // merge new commits into locked set
        uint16 mergedMask = oldMask | newMask;
        for (uint8 slot2 = 0; slot2 < 9; slot2++) {
            uint16 bit2 = uint16(1) << slot2;
            if (((newMask & ~oldMask) & bit2) != 0) {
                sd.lockedCommitHashes[slot2] = newHashes[slot2];
                sd.lockedDealRefs[slot2] = newDealRefs[slot2];
            }
        }
        sd.lockedCommitMask = mergedMask;

        if (newMaxSeq > sd.maxSeq) {
            sd.maxSeq = newMaxSeq;
        }

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
                    newDealRefs[slot],
                    boardCodes[i],
                    boardSalts[i]
                )
            );
            if (h != newHashes[slot]) revert BoardOpeningFailed();
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
                    newDealRefs[slot],
                    holeCodes[i],
                    holeSalts[i]
                )
            );
            if (h != newHashes[slot]) revert HoleOpeningFailed();
            if (submitter == sd.initiator) {
                sd.initiatorHole[i] = holeCodes[i];
            }
        }

        return (sd.lockedCommitMask, sd.maxSeq);
    }

    function _forfeitToInitiator(uint256 channelId) internal {
        Channel storage ch = channels[channelId];
        ShowdownState storage sd = showdowns[channelId];

        if (ch.finalized) return;
        ch.finalized = true;

        uint256 pot = ch.deposit1 + ch.deposit2;
        ch.deposit1 = 0;
        ch.deposit2 = 0;

        (bool ok, ) = payable(sd.initiator).call{value: pot}("");
        if (!ok) revert PaymentFailed();

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
        if (ch.deposit1 == 0 || ch.deposit2 == 0) revert NotReady();
        if (onBehalfOf != ch.player1 && onBehalfOf != ch.player2) revert NotPlayer();

        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) revert ShowdownAlreadyInProgress();

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
        if (
            (sd.lockedCommitMask & (uint16(1) << initiatorSlot1)) == 0 ||
            (sd.lockedCommitMask & (uint16(1) << initiatorSlot2)) == 0
        ) revert InitiatorHolesRequired();

        emit ShowdownStarted(channelId);
        emit CommitsUpdated(channelId, onBehalfOf, sd.lockedCommitMask, sd.maxSeq);
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
        if (block.timestamp > sd.deadline) revert ShowdownExpired();

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
        emit CommitsUpdated(channelId, onBehalfOf, sd.lockedCommitMask, sd.maxSeq);
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
                    sd.lockedDealRefs[slot],
                    oppHoleCodes[i],
                    oppHoleSalts[i]
                )
            );
            if (h != expectedHash) revert OpponentHoleOpeningFailed();
        }

        // TODO: Evaluate hands and determine actual winner
        address winner = sd.initiator;

        ch.finalized = true;
        uint256 finalPot = ch.deposit1 + ch.deposit2;
        ch.deposit1 = 0;
        ch.deposit2 = 0;

        (bool ok2, ) = payable(winner).call{value: finalPot}("");
        if (!ok2) revert PaymentFailed();

        emit ShowdownFinalized(channelId, winner, finalPot);
    }
}
