// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import {HeadsUpPokerPeek} from "./HeadsUpPokerPeek.sol";
import {HeadsUpPokerReplay} from "./HeadsUpPokerReplay.sol";
import {HeadsUpPokerShowdown} from "./HeadsUpPokerShowdown.sol";
import {Action} from "./HeadsUpPokerActions.sol";
import {HeadsUpPokerActionVerifier} from "./HeadsUpPokerActionVerifier.sol";
import "./HeadsUpPokerErrors.sol";
import {HeadsUpPokerView} from "./HeadsUpPokerView.sol";
import {IHeadsUpPokerEscrow} from "./interfaces/IHeadsUpPokerEscrow.sol";

/// @title HeadsUpPokerEscrow - Simple escrow contract for heads up poker matches using ETH only
contract HeadsUpPokerEscrow is
    Ownable,
    ReentrancyGuard,
    HeadsUpPokerEIP712,
    IHeadsUpPokerEscrow
{
    using HeadsUpPokerActionVerifier for Action[];
    
    HeadsUpPokerReplay private replay;

    // ------------------------------------------------------------------
    // Slot layout constants
    // ------------------------------------------------------------------
    uint256 public constant disputeWindow = 1 hours;
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

    struct Channel {
        address player1;
        address player2;
        uint256 deposit1;
        uint256 deposit2;
        bool finalized;
        uint256 handId;
        bool player2Joined;
        uint256 minSmallBlind;
        address player1Signer;
        address player2Signer;
        bool gameStarted;
        uint256 slashAmount;
        bytes32 deckHashPlayer1;
        bytes32 deckHashPlayer2;
        bytes32 canonicalDeckHashPlayer1;
        bytes32 canonicalDeckHashPlayer2;
    }

    mapping(uint256 => Channel) private channels;

    HeadsUpPokerPeek private peek;
    HeadsUpPokerShowdown private showdown;
    HeadsUpPokerView public viewContract;

    bool private helpersInitialized;

    event HelpersInitialized(
        address replay,
        address peek,
        address showdown,
        address viewContract
    );

    constructor() Ownable(msg.sender) {}

    // ---------------------------------------------------------------------
    // Helper configuration
    // ---------------------------------------------------------------------

    function initializeHelpers(
        HeadsUpPokerReplay replay_,
        HeadsUpPokerPeek peek_,
        HeadsUpPokerShowdown showdown_,
        HeadsUpPokerView viewContract_
    ) external onlyOwner {
        if (helpersInitialized) revert HelpersAlreadyConfigured();
        if (
            address(replay_) == address(0) ||
            address(peek_) == address(0) ||
            address(showdown_) == address(0) ||
            address(viewContract_) == address(0)
        ) revert HelpersNotConfigured();

        replay = replay_;
        peek = peek_;
        showdown = showdown_;
        viewContract = viewContract_;
        helpersInitialized = true;

        emit HelpersInitialized(
            address(replay_),
            address(peek_),
            address(showdown_),
            address(viewContract_)
        );
    }

    function helpersConfigured() public view returns (bool) {
        return helpersInitialized;
    }

    modifier helpersReady() {
        if (!helpersConfigured()) revert HelpersNotConfigured();
        _;
    }

    function _replay() private view returns (HeadsUpPokerReplay) {
        HeadsUpPokerReplay replay_ = replay;
        if (address(replay_) == address(0)) revert HelpersNotConfigured();
        return replay_;
    }

    function _peek() private view returns (HeadsUpPokerPeek) {
        HeadsUpPokerPeek peek_ = peek;
        if (address(peek_) == address(0)) revert HelpersNotConfigured();
        return peek_;
    }

    function _showdown() private view returns (HeadsUpPokerShowdown) {
        HeadsUpPokerShowdown showdown_ = showdown;
        if (address(showdown_) == address(0)) revert HelpersNotConfigured();
        return showdown_;
    }

    function _view() private view returns (HeadsUpPokerView) {
        HeadsUpPokerView viewContract_ = viewContract;
        if (address(viewContract_) == address(0)) revert HelpersNotConfigured();
        return viewContract_;
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
    event RevealsUpdated(
        uint256 indexed channelId,
        bool player1Revealed,
        bool player2Revealed
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
    event GameStarted(uint256 indexed channelId, bytes32 deckHash);

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

    function getChannelData(
        uint256 channelId
    ) external view override returns (ChannelData memory data) {
        Channel storage ch = channels[channelId];
        data.player1 = ch.player1;
        data.player2 = ch.player2;
        data.finalized = ch.finalized;
        data.gameStarted = ch.gameStarted;
        data.handId = ch.handId;
        data.deposit1 = ch.deposit1;
        data.deposit2 = ch.deposit2;
        data.slashAmount = ch.slashAmount;
        data.minSmallBlind = ch.minSmallBlind;
        data.player1Signer = ch.player1Signer;
        data.player2Signer = ch.player2Signer;
    }

    function domainSeparator()
        external
        view
        override
        returns (bytes32)
    {
        return DOMAIN_SEPARATOR();
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

    /// @notice Get partially revealed card by player A for a specific index
    /// @param channelId The channel identifier
    /// @param index The card index (0-8)
    /// @return The partially revealed card, or empty bytes if not revealed

    // ---------------------------------------------------------------------
    // Channel flow
    // ---------------------------------------------------------------------

    /// @notice Player1 opens a channel with an opponent by depositing ETH
    function open(
        uint256 channelId,
        address opponent,
        uint256 minSmallBlind,
        address player1Signer,
        uint256 slashAmount,
        bytes calldata publicKeyA
    ) external payable nonReentrant helpersReady returns (uint256 handId) {
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
        // TODO: maybe limit to deposit?
        ch.slashAmount = slashAmount;
        ch.deckHashPlayer1 = bytes32(0);
        ch.deckHashPlayer2 = bytes32(0);
        ch.canonicalDeckHashPlayer1 = bytes32(0);
        ch.canonicalDeckHashPlayer2 = bytes32(0);

        // Reset peek related storage via manager
        _peek().resetChannel(channelId);

        // Reset showdown state when reusing channel
        _showdown().resetChannel(channelId);

        // Reset dispute state when reusing channel
        DisputeState storage ds = disputes[channelId];
        if (ds.inProgress) {
            ds.inProgress = false;
            ds.deadline = 0;
            ds.actionCount = 0;
        }

        _peek().setPublicKeyA(channelId, publicKeyA);

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
        address player2Signer,
        bytes calldata publicKeyB
    ) external payable nonReentrant helpersReady {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.player2 != msg.sender) revert NotOpponent();
        if (ch.player2Joined) revert AlreadyJoined();

        // Allow zero deposit only if there's existing deposit from previous games
        if (msg.value == 0 && ch.deposit2 == 0) revert NoDeposit();

        ch.deposit2 += msg.value; // Add to existing deposit instead of overwriting
        ch.player2Joined = true;
        ch.player2Signer = player2Signer;
        _peek().setPublicKeyB(channelId, publicKeyB);

        emit ChannelJoined(channelId, msg.sender, msg.value);
    }

    /// @notice Both players must call this function with matching encrypted decks and canonical deck to start the game
    /// @dev The deck contains 9 encrypted cards for the 9 slots (hole cards + board cards).
    /// The canonicalDeck contains 52 unencrypted base points representing all possible cards in canonical order.
    /// This allows card-ID resolution by comparing decrypted G1 points against the canonical deck.
    /// @param channelId The channel identifier
    /// @param deck The encrypted deck to be used for this game (9 G1 encrypted card points, each 64 bytes)
    /// @param canonicalDeck The canonical deck (52 unencrypted G1 base points, each 64 bytes) for card-ID resolution
    function startGame(
        uint256 channelId,
        bytes[] calldata deck,
        bytes[] calldata canonicalDeck
    ) external nonReentrant helpersReady {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.player2Joined) revert ChannelNotReady();
        if (ch.gameStarted) revert GameAlreadyStarted();
        if (msg.sender != ch.player1 && msg.sender != ch.player2)
            revert NotPlayer();
        if (deck.length != SLOT_RIVER + 1) revert InvalidDeck();
        if (canonicalDeck.length != FULL_DECK_SIZE) revert InvalidDeck();

        bytes32 deckHash = keccak256(abi.encode(deck));
        bytes32 canonicalDeckHash = keccak256(abi.encode(canonicalDeck));

        if (msg.sender == ch.player1) {
            ch.deckHashPlayer1 = deckHash;
            ch.canonicalDeckHashPlayer1 = canonicalDeckHash;
        } else {
            ch.deckHashPlayer2 = deckHash;
            ch.canonicalDeckHashPlayer2 = canonicalDeckHash;
        }

        if (
            ch.deckHashPlayer1 == bytes32(0) || ch.deckHashPlayer2 == bytes32(0) ||
            ch.canonicalDeckHashPlayer1 == bytes32(0) || ch.canonicalDeckHashPlayer2 == bytes32(0)
        ) {
            return;
        }

        if (ch.deckHashPlayer1 != ch.deckHashPlayer2) {
            return;
        }

        if (ch.canonicalDeckHashPlayer1 != ch.canonicalDeckHashPlayer2) {
            return;
        }

        HeadsUpPokerPeek peekContract = _peek();
        peekContract.storeDeck(channelId, deck);
        peekContract.storeCanonicalDeck(channelId, canonicalDeck);

        ch.gameStarted = true;
        emit GameStarted(channelId, deckHash);
    }

    function _showdownData(
        Channel storage ch
    ) internal view returns (HeadsUpPokerShowdown.ChannelData memory data) {
        data.player1 = ch.player1;
        data.player2 = ch.player2;
        data.finalized = ch.finalized;
        data.handId = ch.handId;
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
    ) external nonReentrant helpersReady {
        Channel storage ch = channels[channelId];
        if (_showdown().isInProgress(channelId)) revert ShowdownInProgress();
        if (ch.player1 == address(0)) revert NoChannel();
        if (actions.length == 0) revert NoActionsProvided();
        if (ch.finalized) revert AlreadyFinalized();
        if (!ch.gameStarted) revert GameNotStarted();

        bytes32 escrowDomainSeparator = DOMAIN_SEPARATOR();

        _verifyActionsWithHelper(
            ch,
            channelId,
            actions,
            signatures,
            escrowDomainSeparator
        );

        // Replay actions to verify they are terminal and get end state
        (
            HeadsUpPokerReplay.End endType,
            uint8 folder,
            uint256 calledAmount
        ) = _replay().replayGame(
                actions,
                ch.deposit1,
                ch.deposit2,
                ch.minSmallBlind,
                ch.player1,
                ch.player2
            );

        if (endType != HeadsUpPokerReplay.End.FOLD) {
            _showdown().initiateShowdown(channelId, calledAmount);
            emit ShowdownStarted(channelId);
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
    ) external nonReentrant helpersReady {
        Channel storage ch = channels[channelId];
        DisputeState storage ds = disputes[channelId];

        if (_showdown().isInProgress(channelId)) revert ShowdownInProgress();
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();
        if (!ch.gameStarted) revert GameNotStarted();

        bytes32 escrowDomainSeparator = DOMAIN_SEPARATOR();

        _verifyActionsWithHelper(
            ch,
            channelId,
            actions,
            signatures,
            escrowDomainSeparator
        );

        // Must provide a longer sequence to extend dispute
        if (ds.inProgress && actions.length <= ds.actionCount)
            revert SequenceNotLonger();

        // Replay actions to get projected end state (handles both terminal and non-terminal)
        (
            HeadsUpPokerReplay.End endType,
            uint8 folder,
            uint256 calledAmount
        ) = _replay().replayIncompleteGame(
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
    function finalizeDispute(uint256 channelId)
        external
        nonReentrant
        helpersReady
    {
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
            _showdown().initiateShowdown(channelId, ds.calledAmount);
            emit ShowdownStarted(channelId);
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

    function _verifyActionsWithHelper(
        Channel storage ch,
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata signatures,
        bytes32 channelDomainSeparator
    ) private view {
        HeadsUpPokerActionVerifier.verifyActions(
            actions,
            signatures,
            channelId,
            ch.handId,
            ch.player1,
            ch.player2,
            ch.player1Signer,
            ch.player2Signer,
            channelDomainSeparator
        );
    }

    function _rewardWinner(
        uint256 channelId,
        address winner,
        uint256 wonAmount
    ) internal {
        Channel storage ch = channels[channelId];

        if (ch.finalized) return;
        ch.finalized = true;

        if (winner == ch.player1) {
            ch.deposit1 += wonAmount;
            ch.deposit2 -= wonAmount;
        } else {
            ch.deposit1 -= wonAmount;
            ch.deposit2 += wonAmount;
        }

        emit ShowdownFinalized(channelId, winner, wonAmount);
    }

    function getDispute(
        uint256 channelId
    ) external view returns (DisputeState memory) {
        return disputes[channelId];
    }

    function revealCards(
        uint256 channelId,
        bytes[] calldata decryptedCards
    ) external nonReentrant helpersReady {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        HeadsUpPokerShowdown showdownContract = _showdown();
        (bool player1Ready, bool player2Ready) = showdownContract.revealCards(
            channelId,
            _showdownData(ch),
            decryptedCards,
            msg.sender
        );

        emit RevealsUpdated(channelId, player1Ready, player2Ready);
    }

    function finalizeReveals(
        uint256 channelId,
        bytes[] calldata plaintextCards
    ) external nonReentrant helpersReady {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        HeadsUpPokerShowdown showdownContract = _showdown();
        (address winner, uint256 wonAmount) = showdownContract.finalizeReveals(
            channelId,
            _showdownData(ch),
            plaintextCards,
            msg.sender
        );

        _rewardWinner(channelId, winner, wonAmount);
    }

    function finalizeShowdown(uint256 channelId)
        external
        nonReentrant
        helpersReady
    {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        HeadsUpPokerShowdown showdownContract = _showdown();
        (address winner, uint256 wonAmount) = showdownContract.finalizeShowdown(
            channelId,
            _showdownData(ch)
        );

        _rewardWinner(channelId, winner, wonAmount);
    }

    function slashPeek(uint256 channelId)
        external
        nonReentrant
        helpersReady
    {
        Channel storage ch = channels[channelId];
        address obligatedHelper = _peek().slashPeek(channelId);

        uint256 slashAmt = ch.slashAmount;
        if (obligatedHelper == ch.player1) {
            if (ch.deposit1 < slashAmt) slashAmt = ch.deposit1;
            ch.deposit1 -= slashAmt;
            ch.deposit2 += slashAmt;
        } else {
            if (ch.deposit2 < slashAmt) slashAmt = ch.deposit2;
            ch.deposit2 -= slashAmt;
            ch.deposit1 += slashAmt;
        }

        ch.finalized = true;
    }
}
