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

    bytes32 private constant CARD_COMMIT_TYPEHASH =
        keccak256(
            "CardCommit(uint256 channelId,uint256 handId,uint32 seq,uint8 role,uint8 index,bytes32 dealRef,bytes32 commitHash,bytes32 prevHash)"
        );

    uint256 public constant revealWindow = 1 hours;

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error CommitDuplicate(uint8 slot);
    error CommitWrongChannel(uint8 slot);
    error CommitWrongHand(uint8 slot);
    error CommitWrongSignerA(uint8 slot);
    error CommitWrongSignerB(uint8 slot);
    error CommitUnexpected(uint8 slot);

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
        bool showdown;
        mapping(address => bytes32) holeCardCommit;
        mapping(address => bytes) revealedHoleCards;
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
    event HoleCardsCommitted(
        uint256 indexed channelId,
        address indexed player,
        bytes32 commit
    );
    event ShowdownStarted(uint256 indexed channelId);
    event HoleCardsRevealed(
        uint256 indexed channelId,
        address indexed player,
        uint8 card1,
        uint8 card2
    );
    event ShowdownFinalized(
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

    // ---------------------------------------------------------------------
    // Channel flow
    // ---------------------------------------------------------------------

    /// @notice Player1 opens a channel with an opponent by depositing ETH
    function open(
        uint256 channelId,
        address opponent
    ) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.player1 == address(0), "EXISTS");
        require(opponent != address(0) && opponent != msg.sender, "BAD_OPP");
        require(msg.value > 0, "NO_DEPOSIT");

        ch.player1 = msg.sender;
        ch.player2 = opponent;
        ch.deposit1 = msg.value;

        emit ChannelOpened(channelId, msg.sender, opponent, msg.value);
    }

    /// @notice Opponent joins an open channel by matching deposit
    function join(uint256 channelId) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.player1 != address(0), "NO_CHANNEL");
        require(ch.player2 == msg.sender, "NOT_OPP");
        require(ch.deposit2 == 0, "JOINED");
        require(msg.value > 0, "NO_DEPOSIT");

        ch.deposit2 = msg.value;

        emit ChannelJoined(channelId, msg.sender, msg.value);
    }

    /// @notice Winner claims the entire pot when opponent folds
    function settleFold(
        uint256 channelId,
        address winner
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(!ch.showdown, "SHOWDOWN");
        require(winner == ch.player1 || winner == ch.player2, "NOT_PLAYER");

        // TODO: add verification that opponent actually folded

        uint256 pot = ch.deposit1 + ch.deposit2;

        ch.deposit1 = 0;
        ch.deposit2 = 0;

        (bool ok, ) = payable(winner).call{value: pot}("");
        require(ok, "PAY_FAIL");

        emit FoldSettled(channelId, winner, pot);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------
    function toSlotKey(uint8 role, uint8 index) internal pure returns (uint8) {
        if (role == 0 && index < 2) return index; // player A
        if (role == 1 && index < 2) return uint8(2 + index); // player B
        if (role == 2 && index < 5) return uint8(4 + index); // board cards
        revert("bad role/index");
    }

    function verifyCoSignedCommits(
        uint256 channelId,
        uint256 handId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint16 requiredMask,
        address addrA,
        address addrB,
        bytes32 domainSeparator
    ) internal pure returns (bytes32[9] memory hashes, uint16 presentMask) {
        require(commits.length * 2 == sigs.length, "SIG_LEN");
        uint16 seenMask;
        for (uint256 i = 0; i < commits.length; i++) {
            HeadsUpPokerEIP712.CardCommit calldata cc = commits[i];
            uint8 slot = toSlotKey(cc.role, cc.index);
            uint16 bit = uint16(1) << slot;
            if ((requiredMask & bit) == 0) revert CommitUnexpected(slot);
            if (seenMask & bit != 0) revert CommitDuplicate(slot);
            seenMask |= bit;
            if (cc.channelId != channelId) revert CommitWrongChannel(slot);
            if (cc.handId != handId) revert CommitWrongHand(slot);

            bytes32 structHash = keccak256(
                abi.encode(
                    CARD_COMMIT_TYPEHASH,
                    cc.channelId,
                    cc.handId,
                    cc.seq,
                    cc.role,
                    cc.index,
                    cc.dealRef,
                    cc.commitHash,
                    cc.prevHash
                )
            );
            bytes32 digest = keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, structHash)
            );
            address recA = digest.recover(sigs[i * 2]);
            if (recA != addrA) revert CommitWrongSignerA(slot);
            address recB = digest.recover(sigs[i * 2 + 1]);
            if (recB != addrB) revert CommitWrongSignerB(slot);

            hashes[slot] = cc.commitHash;
            presentMask |= bit;
        }
    }

    function getShowdown(
        uint256 channelId
    ) external view returns (ShowdownState memory) {
        return showdowns[channelId];
    }

    /// @notice Player submits commitments and openings to start showdown
    function startShowdown(
        uint256 channelId,
        uint256 handId,
        HeadsUpPokerEIP712.CardCommit[] calldata commits,
        bytes[] calldata sigs,
        uint8[5] calldata boardCodes,
        bytes32[5] calldata boardSalts,
        uint8[2] calldata holeCodes,
        bytes32[2] calldata holeSalts
    ) external nonReentrant {

        Channel storage ch = channels[channelId];
        require(ch.deposit1 > 0 && ch.deposit2 > 0, "NOT_READY");
        require(msg.sender == ch.player1 || msg.sender == ch.player2, "NOT_PLAYER");

        ShowdownState storage sd = showdowns[channelId];
        require(!sd.inProgress, "IN_PROGRESS");

        address addrA = ch.player1;
        address addrB = ch.player2;
        bytes32 domainSeparator = _domainSeparator(channelId);

        (bytes32[9] memory hashes, uint16 presentMask) = verifyCoSignedCommits(
            channelId,
            handId,
            commits,
            sigs,
            MASK_ALL,
            addrA,
            addrB,
            domainSeparator
        );

        require((presentMask & MASK_ALL) == MASK_ALL, "missing commit slot(s)");

        // Map dealRefs by slot
        bytes32[9] memory dealRefs;
        for (uint256 i = 0; i < commits.length; i++) {
            uint8 slot = toSlotKey(commits[i].role, commits[i].index);
            dealRefs[slot] = commits[i].dealRef;
        }

        // Verify board openings
        for (uint256 i = 0; i < 5; i++) {
            uint8 slot = uint8(SLOT_FLOP1 + i);
            bytes32 h = keccak256(
                abi.encodePacked(
                    domainSeparator,
                    channelId,
                    handId,
                    slot,
                    dealRefs[slot],
                    boardCodes[i],
                    boardSalts[i]
                )
            );
            require(h == hashes[slot], "BOARD_OPEN");
            sd.board[i] = boardCodes[i];
        }

        // Determine roles
        uint8 slot1;
        uint8 slot2;
        uint8 opp1;
        uint8 opp2;
        if (msg.sender == addrA) {
            slot1 = SLOT_A1;
            slot2 = SLOT_A2;
            opp1 = SLOT_B1;
            opp2 = SLOT_B2;
            sd.initiator = addrA;
            sd.opponent = addrB;
        } else {
            slot1 = SLOT_B1;
            slot2 = SLOT_B2;
            opp1 = SLOT_A1;
            opp2 = SLOT_A2;
            sd.initiator = addrB;
            sd.opponent = addrA;
        }

        for (uint256 i = 0; i < 2; i++) {
            uint8 slot = i == 0 ? slot1 : slot2;
            bytes32 h = keccak256(
                abi.encodePacked(
                    domainSeparator,
                    channelId,
                    handId,
                    slot,
                    dealRefs[slot],
                    holeCodes[i],
                    holeSalts[i]
                )
            );
            require(h == hashes[slot], "HOLE_OPEN");
            sd.initiatorHole[i] = holeCodes[i];
        }

        sd.oppHoleHash1 = hashes[opp1];
        sd.oppHoleHash2 = hashes[opp2];
        sd.deadline = block.timestamp + revealWindow;
        sd.inProgress = true;

        emit ShowdownStarted(channelId);
    }

    /// @notice Reveal actual hole cards and verify against commitment
    function revealHoleCards(
        uint256 channelId,
        uint8 card1,
        uint8 card2,
        bytes32 salt
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.showdown, "NO_SHOWDOWN");
        require(
            msg.sender == ch.player1 || msg.sender == ch.player2,
            "NOT_PLAYER"
        );
        require(ch.revealedHoleCards[msg.sender].length == 0, "REVEALED");

        bytes32 commit = keccak256(abi.encodePacked(card1, card2, salt));
        require(commit == ch.holeCardCommit[msg.sender], "BAD_REVEAL");

        ch.revealedHoleCards[msg.sender] = abi.encodePacked(card1, card2);
        emit HoleCardsRevealed(channelId, msg.sender, card1, card2);
    }

    /// @notice Finalize showdown and send pot to winner after both players revealed
    function finalizeShowdown(
        uint256 channelId,
        address winner
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.showdown, "NO_SHOWDOWN");
        require(!ch.finalized, "FINALIZED");
        require(
            ch.revealedHoleCards[ch.player1].length > 0 &&
                ch.revealedHoleCards[ch.player2].length > 0,
            "NOT_REVEALED"
        );
        require(winner == ch.player1 || winner == ch.player2, "NOT_PLAYER");

        // TODO: add verification that winner actually has the best hand

        ch.finalized = true;
        uint256 pot = ch.deposit1 + ch.deposit2;
        ch.deposit1 = 0;
        ch.deposit2 = 0;

        (bool ok, ) = payable(winner).call{value: pot}("");
        require(ok, "PAY_FAIL");

        emit ShowdownFinalized(channelId, winner, pot);
    }
}
