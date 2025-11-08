// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import {HeadsUpPokerPeek} from "./HeadsUpPokerPeek.sol";
import {HeadsUpPokerReplay} from "./HeadsUpPokerReplay.sol";
import {HeadsUpPokerShowdown} from "./HeadsUpPokerShowdown.sol";
import {Action} from "./HeadsUpPokerActions.sol";
import "./HeadsUpPokerErrors.sol";

/// @title HeadsUpPokerEscrow - Simple escrow contract for heads up poker matches using ETH only
contract HeadsUpPokerEscrow is ReentrancyGuard, HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    HeadsUpPokerReplay private immutable replay;

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

    HeadsUpPokerPeek private immutable peek;
    HeadsUpPokerShowdown private immutable showdown;

    constructor() {
        replay = new HeadsUpPokerReplay();
        peek = new HeadsUpPokerPeek(address(this), replay);
        showdown = new HeadsUpPokerShowdown(address(this), peek);
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
    event PeekOpened(uint256 indexed channelId, uint8 indexed stage);
    event PeekServed(uint256 indexed channelId, uint8 indexed stage);
    event PeekSlashed(
        uint256 indexed channelId,
        uint8 indexed stage,
        address indexed obligatedHelper
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
    function getRevealedCardA(
        uint256 channelId,
        uint8 index
    ) external view returns (bytes memory) {
        return peek.getRevealedCardA(channelId, index);
    }

    /// @notice Get partially revealed card by player B for a specific index
    /// @param channelId The channel identifier
    /// @param index The card index (0-8)
    /// @return The partially revealed card, or empty bytes if not revealed
    function getRevealedCardB(
        uint256 channelId,
        uint8 index
    ) external view returns (bytes memory) {
        return peek.getRevealedCardB(channelId, index);
    }

    /// @notice Get the peek state for a channel
    function getPeek(
        uint256 channelId
    ) external view returns (HeadsUpPokerPeek.PeekState memory) {
        return peek.getPeek(channelId);
    }

    /// @notice Get the address of the peek contract
    function getPeekAddress() external view returns (address) {
        return address(peek);
    }

    /// @notice Get public keys for a channel
    function getPublicKeys(
        uint256 channelId
    ) external view returns (bytes memory, bytes memory) {
        return peek.getPublicKeys(channelId);
    }

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
        // TODO: maybe limit to deposit?
        ch.slashAmount = slashAmount;
        ch.deckHashPlayer1 = bytes32(0);
        ch.deckHashPlayer2 = bytes32(0);
        ch.canonicalDeckHashPlayer1 = bytes32(0);
        ch.canonicalDeckHashPlayer2 = bytes32(0);

        // Reset peek related storage via manager
        peek.resetChannel(channelId);

        // Reset showdown state when reusing channel
        showdown.resetChannel(channelId);

        // Reset dispute state when reusing channel
        DisputeState storage ds = disputes[channelId];
        if (ds.inProgress) {
            ds.inProgress = false;
            ds.deadline = 0;
            ds.actionCount = 0;
        }

        peek.setPublicKeyA(channelId, publicKeyA);

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
        peek.setPublicKeyB(channelId, publicKeyB);

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
    ) external nonReentrant {
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

        peek.storeDeck(channelId, deck);
        peek.storeCanonicalDeck(channelId, canonicalDeck);

        ch.gameStarted = true;
        emit GameStarted(channelId, deckHash);
    }

    function _channelData(
        Channel storage ch
    ) internal view returns (HeadsUpPokerPeek.ChannelData memory data) {
        data.player1 = ch.player1;
        data.player2 = ch.player2;
        data.player1Signer = ch.player1Signer;
        data.player2Signer = ch.player2Signer;
        data.finalized = ch.finalized;
        data.gameStarted = ch.gameStarted;
        data.handId = ch.handId;
        data.deposit1 = ch.deposit1;
        data.deposit2 = ch.deposit2;
        data.slashAmount = ch.slashAmount;
        data.minSmallBlind = ch.minSmallBlind;
    }

    function _showdownData(
        Channel storage ch
    ) internal view returns (HeadsUpPokerShowdown.ChannelData memory data) {
        data.player1 = ch.player1;
        data.player2 = ch.player2;
        data.player1Signer = ch.player1Signer;
        data.player2Signer = ch.player2Signer;
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
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (showdown.isInProgress(channelId)) revert ShowdownInProgress();
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
            showdown.initiateShowdown(channelId, calledAmount);
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
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        DisputeState storage ds = disputes[channelId];

        if (showdown.isInProgress(channelId)) revert ShowdownInProgress();
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
            showdown.initiateShowdown(channelId, ds.calledAmount);
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

        address player1Signer = channels[channelId].player1Signer;
        address player2Signer = channels[channelId].player2Signer;

        for (uint256 i = 0; i < actions.length; i++) {
            Action calldata action = actions[i];

            // Verify action belongs to correct channel and hand
            if (action.channelId != channelId) revert ActionWrongChannel();
            if (action.handId != handId) revert ActionWrongHand();

            // Verify sender is one of the valid players
            if (
                action.sender != player1 &&
                action.sender != player2 &&
                action.sender != player1Signer &&
                action.sender != player2Signer
            ) revert ActionInvalidSender();

            // Get EIP712 digest for this action
            bytes32 digest = digestAction(action);

            // Verify the sender signed this action OR an authorized signer signed it
            bytes calldata sig = signatures[i];
            address actualSigner = digest.recover(sig);

            if (!_isAuthorizedSigner(channelId, action.sender, actualSigner))
                revert ActionWrongSigner();
        }
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

    function getShowdown(
        uint256 channelId
    )
        external
        view
        returns (HeadsUpPokerShowdown.ShowdownState memory)
    {
        return showdown.getShowdown(channelId);
    }

    function getDispute(
        uint256 channelId
    ) external view returns (DisputeState memory) {
        return disputes[channelId];
    }

    function revealCardsPlayer1(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        (bool player1Ready, bool player2Ready) = showdown.revealCardsPlayer1(
            channelId,
            _showdownData(ch),
            decryptedCards,
            signatures
        );

        emit RevealsUpdated(channelId, player1Ready, player2Ready);
    }

    function revealCardsPlayer2(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        (bool player1Ready, bool player2Ready) = showdown.revealCardsPlayer2(
            channelId,
            _showdownData(ch),
            decryptedCards,
            signatures
        );

        emit RevealsUpdated(channelId, player1Ready, player2Ready);
    }

    function finalizeReveals(
        uint256 channelId,
        HeadsUpPokerShowdown.PlaintextCard[] calldata plaintextCards,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        (address winner, uint256 wonAmount) = showdown.finalizeReveals(
            channelId,
            _showdownData(ch),
            plaintextCards,
            signatures
        );

        _rewardWinner(channelId, winner, wonAmount);
    }

    function finalizeShowdown(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (ch.player1 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        (address winner, uint256 wonAmount) = showdown.finalizeShowdown(
            channelId,
            _showdownData(ch)
        );

        _rewardWinner(channelId, winner, wonAmount);
    }

    // ------------------------------------------------------------------
    // Peek Functions
    // ------------------------------------------------------------------

    function requestHoleA(
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata actionSignatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        _verifyActionSignatures(
            channelId,
            ch.handId,
            actions,
            actionSignatures,
            ch.player1,
            ch.player2
        );
        peek.requestHoleA(
            channelId,
            _channelData(ch),
            msg.sender,
            actions
        );
        emit PeekOpened(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.HOLE_A)
        );
    }

    function answerHoleA(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        peek.answerHoleA(
            channelId,
            _channelData(ch),
            msg.sender,
            decryptedCards,
            signatures
        );
        emit PeekServed(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.HOLE_A)
        );
    }

    function requestHoleB(
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata actionSignatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        _verifyActionSignatures(
            channelId,
            ch.handId,
            actions,
            actionSignatures,
            ch.player1,
            ch.player2
        );
        peek.requestHoleB(
            channelId,
            _channelData(ch),
            msg.sender,
            actions
        );
        emit PeekOpened(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.HOLE_B)
        );
    }

    function answerHoleB(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        peek.answerHoleB(
            channelId,
            _channelData(ch),
            msg.sender,
            decryptedCards,
            signatures
        );
        emit PeekServed(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.HOLE_B)
        );
    }

    function requestFlop(
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata actionSignatures,
        HeadsUpPokerEIP712.DecryptedCard[] calldata requesterDecryptedCards,
        bytes[] calldata requesterSignatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        _verifyActionSignatures(
            channelId,
            ch.handId,
            actions,
            actionSignatures,
            ch.player1,
            ch.player2
        );
        peek.requestFlop(
            channelId,
            _channelData(ch),
            msg.sender,
            actions,
            requesterDecryptedCards,
            requesterSignatures
        );
        emit PeekOpened(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.FLOP)
        );
    }

    function answerFlop(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        peek.answerFlop(
            channelId,
            _channelData(ch),
            msg.sender,
            decryptedCards,
            signatures
        );
        emit PeekServed(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.FLOP)
        );
    }

    function requestTurn(
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata actionSignatures,
        HeadsUpPokerEIP712.DecryptedCard calldata requesterDecryptedCard,
        bytes calldata requesterSignature
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        _verifyActionSignatures(
            channelId,
            ch.handId,
            actions,
            actionSignatures,
            ch.player1,
            ch.player2
        );
        peek.requestTurn(
            channelId,
            _channelData(ch),
            msg.sender,
            actions,
            requesterDecryptedCard,
            requesterSignature
        );
        emit PeekOpened(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.TURN)
        );
    }

    function answerTurn(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        bytes calldata signature
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        peek.answerTurn(
            channelId,
            _channelData(ch),
            msg.sender,
            decryptedCard,
            signature
        );
        emit PeekServed(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.TURN)
        );
    }

    function requestRiver(
        uint256 channelId,
        Action[] calldata actions,
        bytes[] calldata actionSignatures,
        HeadsUpPokerEIP712.DecryptedCard calldata requesterDecryptedCard,
        bytes calldata requesterSignature
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        _verifyActionSignatures(
            channelId,
            ch.handId,
            actions,
            actionSignatures,
            ch.player1,
            ch.player2
        );
        peek.requestRiver(
            channelId,
            _channelData(ch),
            msg.sender,
            actions,
            requesterDecryptedCard,
            requesterSignature
        );
        emit PeekOpened(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.RIVER)
        );
    }

    function answerRiver(
        uint256 channelId,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        bytes calldata signature
    ) external nonReentrant {
        Channel storage ch = channels[channelId];
        peek.answerRiver(
            channelId,
            _channelData(ch),
            msg.sender,
            decryptedCard,
            signature
        );
        emit PeekServed(
            channelId,
            uint8(HeadsUpPokerPeek.PeekStage.RIVER)
        );
    }

    function slashPeek(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        address obligatedHelper = peek.slashPeek(channelId);
        HeadsUpPokerPeek.PeekState memory frState = peek
            .getPeek(channelId);

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
        emit PeekSlashed(
            channelId,
            uint8(frState.stage),
            obligatedHelper
        );
    }
}
