// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title HeadsUpPokerEscrow - Simple escrow contract for heads up poker matches using ETH only
/// @notice Supports opening channels, joining, settling on fold and basic showdown flow
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract HeadsUpPokerEscrow is ReentrancyGuard {
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

    mapping(bytes32 => Channel) private channels;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event ChannelOpened(bytes32 indexed channelId, address indexed player1, address indexed player2, uint256 amount);
    event ChannelJoined(bytes32 indexed channelId, address indexed player, uint256 amount);
    event FoldSettled(bytes32 indexed channelId, address indexed winner, uint256 amount);
    event HoleCardsCommitted(bytes32 indexed channelId, address indexed player, bytes32 commit);
    event ShowdownStarted(bytes32 indexed channelId);
    event HoleCardsRevealed(bytes32 indexed channelId, address indexed player, uint8 card1, uint8 card2);
    event ShowdownFinalized(bytes32 indexed channelId, address indexed winner, uint256 amount);

    // ---------------------------------------------------------------------
    // View helpers
    // ---------------------------------------------------------------------
    function stacks(bytes32 channelId) external view returns (uint256 p1, uint256 p2) {
        Channel storage ch = channels[channelId];
        return (ch.deposit1, ch.deposit2);
    }

    // ---------------------------------------------------------------------
    // Channel flow
    // ---------------------------------------------------------------------

    /// @notice Player1 opens a channel with an opponent by depositing ETH
    function open(bytes32 channelId, address opponent) external payable nonReentrant {
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
    function join(bytes32 channelId) external payable nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.player1 != address(0), "NO_CHANNEL");
        require(ch.player2 == msg.sender, "NOT_OPP");
        require(ch.deposit2 == 0, "JOINED");
        require(msg.value > 0, "NO_DEPOSIT");

        ch.deposit2 = msg.value;

        emit ChannelJoined(channelId, msg.sender, msg.value);
    }

    /// @notice Winner claims the entire pot when opponent folds
    function settleFold(bytes32 channelId, address winner) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(!ch.showdown, "SHOWDOWN");
        require(winner == ch.player1 || winner == ch.player2, "NOT_PLAYER");

        uint256 pot = ch.deposit1 + ch.deposit2;
        require(pot > 0, "NO_POT");

        ch.deposit1 = 0;
        ch.deposit2 = 0;

        (bool ok, ) = payable(winner).call{value: pot}("");
        require(ok, "PAY_FAIL");

        emit FoldSettled(channelId, winner, pot);
    }

    /// @notice Player submits commitment to their hole cards to start showdown
    function startShowdown(bytes32 channelId, bytes32 commit) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.deposit1 > 0 && ch.deposit2 > 0, "NOT_READY");
        require(msg.sender == ch.player1 || msg.sender == ch.player2, "NOT_PLAYER");
        require(ch.holeCardCommit[msg.sender] == bytes32(0), "COMMITTED");

        ch.holeCardCommit[msg.sender] = commit;
        emit HoleCardsCommitted(channelId, msg.sender, commit);

        if (ch.holeCardCommit[ch.player1] != bytes32(0) && ch.holeCardCommit[ch.player2] != bytes32(0)) {
            ch.showdown = true;
            emit ShowdownStarted(channelId);
        }
    }

    /// @notice Reveal actual hole cards and verify against commitment
    function revealHoleCards(bytes32 channelId, uint8 card1, uint8 card2, bytes32 salt) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.showdown, "NO_SHOWDOWN");
        require(msg.sender == ch.player1 || msg.sender == ch.player2, "NOT_PLAYER");
        require(ch.revealedHoleCards[msg.sender].length == 0, "REVEALED");

        bytes32 commit = keccak256(abi.encodePacked(card1, card2, salt));
        require(commit == ch.holeCardCommit[msg.sender], "BAD_REVEAL");

        ch.revealedHoleCards[msg.sender] = abi.encodePacked(card1, card2);
        emit HoleCardsRevealed(channelId, msg.sender, card1, card2);
    }

    /// @notice Finalize showdown and send pot to winner after both players revealed
    function finalizeShowdown(bytes32 channelId, address winner) external nonReentrant {
        Channel storage ch = channels[channelId];
        require(ch.showdown, "NO_SHOWDOWN");
        require(!ch.finalized, "FINALIZED");
        require(ch.revealedHoleCards[ch.player1].length > 0 && ch.revealedHoleCards[ch.player2].length > 0, "NOT_REVEALED");
        require(winner == ch.player1 || winner == ch.player2, "NOT_PLAYER");

        ch.finalized = true;
        uint256 pot = ch.deposit1 + ch.deposit2;
        ch.deposit1 = 0;
        ch.deposit2 = 0;

        (bool ok, ) = payable(winner).call{value: pot}("");
        require(ok, "PAY_FAIL");

        emit ShowdownFinalized(channelId, winner, pot);
    }
}

