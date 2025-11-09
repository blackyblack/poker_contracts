// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {Action} from "./HeadsUpPokerActions.sol";
import {Bn254} from "./Bn254.sol";
import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import {HeadsUpPokerReplay} from "./HeadsUpPokerReplay.sol";
import "./HeadsUpPokerErrors.sol";

contract HeadsUpPokerPeek is HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    enum PeekStage {
        NONE,
        HOLE_A,
        HOLE_B,
        FLOP,
        TURN,
        RIVER
    }

    uint8 constant STREET_FLOP = 1;
    uint8 constant STREET_TURN = 2;
    uint8 constant STREET_RIVER = 3;

    struct PeekState {
        PeekStage stage;
        bool inProgress;
        bool served;
        uint256 deadline;
        address obligatedHelper;
    }

    struct ChannelData {
        address player1;
        address player2;
        bool finalized;
        bool gameStarted;
        uint256 handId;
        uint256 deposit1;
        uint256 deposit2;
        uint256 slashAmount;
        uint256 minSmallBlind;
    }

    struct GameValidation {
        bool ended;
        uint8 street;
    }

    uint256 public constant peekWindow = 1 hours;

    address private immutable escrow;
    HeadsUpPokerReplay private immutable replay;

    // channelId => PeekState
    mapping(uint256 => PeekState) private peeks;
    // channelId => slot => revealed card from player A
    mapping(uint256 => mapping(uint8 => bytes)) private revealedCardsA;
    // channelId => slot => revealed card from player B
    mapping(uint256 => mapping(uint8 => bytes)) private revealedCardsB;
    // channelId => deck of encrypted cards (9 cards for the 9 slots)
    mapping(uint256 => bytes[]) private decks;
    // channelId => canonical deck (52 unencrypted base points for card-ID resolution)
    // Maps from unencrypted card (G1 point, 64 bytes) to canonical card index (1-52)
    mapping(uint256 => mapping(bytes => uint8)) private canonicalDecks;
    // channelId => public key of player A
    mapping(uint256 => bytes) private publicKeyA;
    // channelId => public key of player B
    mapping(uint256 => bytes) private publicKeyB;

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow();
        _;
    }

    constructor(address escrowAddress, HeadsUpPokerReplay replayAddress) {
        if (escrowAddress == address(0)) revert NotEscrow();
        escrow = escrowAddress;
        replay = replayAddress;
    }

    // ------------------------------------------------------------------
    // View helpers
    // ------------------------------------------------------------------
    function getPeek(
        uint256 channelId
    ) external view returns (PeekState memory) {
        return peeks[channelId];
    }

    function getRevealedCardA(
        uint256 channelId,
        uint8 index
    ) external view returns (bytes memory) {
        return revealedCardsA[channelId][index];
    }

    function getRevealedCardB(
        uint256 channelId,
        uint8 index
    ) external view returns (bytes memory) {
        return revealedCardsB[channelId][index];
    }

    function getPublicKeys(
        uint256 channelId
    ) external view returns (bytes memory, bytes memory) {
        return (publicKeyA[channelId], publicKeyB[channelId]);
    }

    function getDeckHash(uint256 channelId) external view returns (bytes32) {
        return keccak256(abi.encode(decks[channelId]));
    }

    function isDeckSet(uint256 channelId) external view returns (bool) {
        return decks[channelId].length == HeadsUpPokerEIP712.SLOT_RIVER + 1;
    }

    /// @notice Get a specific card from the deck
    /// @param channelId The channel identifier
    /// @param index The card index (0-8)
    /// @return The encrypted card at the specified index
    function getDeck(
        uint256 channelId,
        uint8 index
    ) external view returns (bytes memory) {
        if (index > HeadsUpPokerEIP712.SLOT_RIVER) revert InvalidDeck();
        if (decks[channelId].length != HeadsUpPokerEIP712.SLOT_RIVER + 1)
            revert InvalidDeck();
        return decks[channelId][index];
    }

    // ------------------------------------------------------------------
    // Channel setup helpers
    // ------------------------------------------------------------------
    function resetChannel(uint256 channelId) external onlyEscrow {
        delete peeks[channelId];
        delete publicKeyA[channelId];
        delete publicKeyB[channelId];
        // Skip deleting decks to save gas - they will be reset anyway
        for (
            uint8 i = HeadsUpPokerEIP712.SLOT_A1;
            i <= HeadsUpPokerEIP712.SLOT_RIVER;
            i++
        ) {
            delete revealedCardsA[channelId][i];
            delete revealedCardsB[channelId][i];
        }
    }

    function setPublicKeyA(
        uint256 channelId,
        bytes calldata key
    ) external onlyEscrow {
        publicKeyA[channelId] = key;
    }

    function setPublicKeyB(
        uint256 channelId,
        bytes calldata key
    ) external onlyEscrow {
        publicKeyB[channelId] = key;
    }

    function storeDeck(
        uint256 channelId,
        bytes[] calldata deck
    ) external onlyEscrow {
        decks[channelId] = deck;
    }

    /// @notice Store the canonical deck (52 unencrypted base points) for card-ID resolution
    /// @param channelId The channel identifier
    /// @param canonicalDeck Array of 52 unencrypted G1 base points (each 64 bytes)
    function storeCanonicalDeck(
        uint256 channelId,
        bytes[] calldata canonicalDeck
    ) external onlyEscrow {
        if (canonicalDeck.length != FULL_DECK_SIZE) revert InvalidDeck();
        for (uint8 i = 0; i < FULL_DECK_SIZE; i++) {
            canonicalDecks[channelId][canonicalDeck[i]] = i + 1; // Store index + 1 to avoid default zero value
        }
    }

    /// @notice Find a canonical card value by its unencrypted G1 base point
    /// @param channelId The channel identifier
    /// @param cardPoint The unencrypted G1 base point for the card
    /// @return The canonical card value for PokerEvaluator
    function getCanonicalCard(
        uint256 channelId,
        bytes memory cardPoint
    ) external view returns (uint8) {
        uint8 index = canonicalDecks[channelId][cardPoint];
        if (index == 0) revert InvalidUnencryptedCard();
        index -= 1; // Adjust back to zero-based index
        uint8 suit = index % 4;
        // rank starts from 1 (Ace) to 13 (King)
        uint8 rank = index / 4 + 1;
        // lower 4 bits: rank (1-13), upper 4 bits: suit (0-3)
        return (rank & 0x0F) | ((suit & 0x0F) << 4);
    }

    function requestHoleA(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        Action[] calldata actions
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (ch.finalized) revert AlreadyFinalized();
        if (fr.inProgress || fr.stage != PeekStage.NONE)
            revert PeekInProgress();
        if (requester != ch.player1) revert NotPlayer();

        _ensureActiveGame(ch, actions);

        if (revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_A1].length != 0)
            revert PrerequisitesNotMet();
        if (revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_A2].length != 0)
            revert PrerequisitesNotMet();

        _openPeek(fr, PeekStage.HOLE_A, ch.player2);
    }

    function answerHoleA(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        bytes[] calldata decryptedCards
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        _requirePeekActive(fr, PeekStage.HOLE_A);
        if (helper != fr.obligatedHelper) {
            revert ActionInvalidSender();
        }

        uint8[] memory indices = _indices(
            HeadsUpPokerEIP712.SLOT_A1,
            HeadsUpPokerEIP712.SLOT_A2
        );
        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCards,
            indices,
            ch
        );

        _completePeek(fr);
    }

    function requestHoleB(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        Action[] calldata actions
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert PeekInProgress();
        if (requester != ch.player2) revert NotPlayer();
        _ensureActiveGame(ch, actions);

        if (revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_B1].length != 0)
            revert PrerequisitesNotMet();
        if (revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_B2].length != 0)
            revert PrerequisitesNotMet();

        _openPeek(fr, PeekStage.HOLE_B, ch.player1);
    }

    function answerHoleB(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        bytes[] calldata decryptedCards
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        _requirePeekActive(fr, PeekStage.HOLE_B);
        if (helper != fr.obligatedHelper) {
            revert ActionInvalidSender();
        }

        uint8[] memory indices = _indices(
            HeadsUpPokerEIP712.SLOT_B1,
            HeadsUpPokerEIP712.SLOT_B2
        );
        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCards,
            indices,
            ch
        );

        _completePeek(fr);
    }

    function requestFlop(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        Action[] calldata actions,
        bytes[] calldata requesterDecryptedCards
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert PeekInProgress();
        if (requester != ch.player1 && requester != ch.player2)
            revert NotPlayer();
        _ensureCommunityStage(ch, actions, STREET_FLOP);
        if (requesterDecryptedCards.length != 3) revert InvalidDecryptedCard();

        address obligatedHelper = requester == ch.player1
            ? ch.player2
            : ch.player1;

        if (requester == ch.player1) {
            if (
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_FLOP1]
                    .length !=
                0 ||
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_FLOP2]
                    .length !=
                0 ||
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_FLOP3]
                    .length !=
                0
            ) revert PrerequisitesNotMet();
        } else {
            if (
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_FLOP1]
                    .length !=
                0 ||
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_FLOP2]
                    .length !=
                0 ||
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_FLOP3]
                    .length !=
                0
            ) revert PrerequisitesNotMet();
        }

        uint8[] memory flopIndices = _indices(
            HeadsUpPokerEIP712.SLOT_FLOP1,
            HeadsUpPokerEIP712.SLOT_FLOP2,
            HeadsUpPokerEIP712.SLOT_FLOP3
        );
        _verifyAndStore(
            channelId,
            requester,
            requesterDecryptedCards,
            flopIndices,
            ch
        );

        _openPeek(fr, PeekStage.FLOP, obligatedHelper);
    }

    function answerFlop(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        bytes[] calldata decryptedCards
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        _requirePeekActive(fr, PeekStage.FLOP);
        if (helper != fr.obligatedHelper) {
            revert ActionInvalidSender();
        }

        uint8[] memory flopIndices = _indices(
            HeadsUpPokerEIP712.SLOT_FLOP1,
            HeadsUpPokerEIP712.SLOT_FLOP2,
            HeadsUpPokerEIP712.SLOT_FLOP3
        );
        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCards,
            flopIndices,
            ch
        );

        _completePeek(fr);
    }

    function requestTurn(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        Action[] calldata actions,
        bytes calldata requesterDecryptedCard
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert PeekInProgress();
        if (requester != ch.player1 && requester != ch.player2)
            revert NotPlayer();

        _ensureCommunityStage(ch, actions, STREET_TURN);

        address obligatedHelper = requester == ch.player1
            ? ch.player2
            : ch.player1;

        if (requester == ch.player1) {
            if (
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_TURN]
                    .length != 0
            ) {
                revert PrerequisitesNotMet();
            }
        } else {
            if (
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_TURN]
                    .length != 0
            ) {
                revert PrerequisitesNotMet();
            }
        }

        _verifyAndStore(
            channelId,
            requester,
            requesterDecryptedCard,
            HeadsUpPokerEIP712.SLOT_TURN,
            ch
        );

        _openPeek(fr, PeekStage.TURN, obligatedHelper);
    }

    function answerTurn(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        bytes calldata decryptedCard
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        _requirePeekActive(fr, PeekStage.TURN);
        if (helper != fr.obligatedHelper) {
            revert ActionInvalidSender();
        }

        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCard,
            HeadsUpPokerEIP712.SLOT_TURN,
            ch
        );

        _completePeek(fr);
    }

    function requestRiver(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        Action[] calldata actions,
        bytes calldata requesterDecryptedCard
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert PeekInProgress();
        if (requester != ch.player1 && requester != ch.player2)
            revert NotPlayer();

        _ensureCommunityStage(ch, actions, STREET_RIVER);

        address obligatedHelper = requester == ch.player1
            ? ch.player2
            : ch.player1;

        if (requester == ch.player1) {
            if (
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_RIVER]
                    .length != 0
            ) {
                revert PrerequisitesNotMet();
            }
        } else {
            if (
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_RIVER]
                    .length != 0
            ) {
                revert PrerequisitesNotMet();
            }
        }

        _verifyAndStore(
            channelId,
            requester,
            requesterDecryptedCard,
            HeadsUpPokerEIP712.SLOT_RIVER,
            ch
        );

        _openPeek(fr, PeekStage.RIVER, obligatedHelper);
    }

    function answerRiver(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        bytes calldata decryptedCard
    ) external onlyEscrow {
        PeekState storage fr = peeks[channelId];

        _requirePeekActive(fr, PeekStage.RIVER);
        if (helper != fr.obligatedHelper) {
            revert ActionInvalidSender();
        }

        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCard,
            HeadsUpPokerEIP712.SLOT_RIVER,
            ch
        );

        _completePeek(fr);
    }

    function slashPeek(
        uint256 channelId
    ) external onlyEscrow returns (address obligatedHelper) {
        PeekState storage fr = peeks[channelId];

        if (!fr.inProgress) revert NoPeekInProgress();
        if (block.timestamp <= fr.deadline) revert PeekNotExpired();
        if (fr.served) revert PeekAlreadyServed();

        obligatedHelper = fr.obligatedHelper;
        fr.inProgress = false;
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------
    function _requirePeekActive(
        PeekState storage fr,
        PeekStage stage
    ) internal view {
        if (!fr.inProgress) revert NoPeekInProgress();
        if (fr.stage != stage) revert PeekWrongStage();
        if (fr.served) revert PeekAlreadyServed();
        if (block.timestamp > fr.deadline) revert Expired();
    }

    function _openPeek(
        PeekState storage fr,
        PeekStage stage,
        address obligatedHelper
    ) internal {
        fr.stage = stage;
        fr.inProgress = true;
        fr.served = false;
        fr.deadline = block.timestamp + peekWindow;
        fr.obligatedHelper = obligatedHelper;
    }

    function _completePeek(PeekState storage fr) internal {
        fr.served = true;
        fr.inProgress = false;
    }

    function _verifyAndStore(
        uint256 channelId,
        address player,
        bytes[] calldata decryptedCards,
        uint8[] memory indices,
        ChannelData calldata ch
    ) internal {
        uint256 length = indices.length;
        if (decryptedCards.length != length) revert InvalidDecryptedCard();
        bool storeInA = player == ch.player1;

        for (uint256 i = 0; i < length; i++) {
            uint8 index = indices[i];
            _verifyDecryptedCard(
                channelId,
                index,
                decryptedCards[i],
                storeInA
            );
            if (storeInA) {
                revealedCardsA[channelId][index] = decryptedCards[i];
            } else {
                revealedCardsB[channelId][index] = decryptedCards[i];
            }
        }
    }

    function _verifyAndStore(
        uint256 channelId,
        address player,
        bytes calldata decryptedCard,
        uint8 index,
        ChannelData calldata ch
    ) internal {
        bool storeInA = player == ch.player1;

        _verifyDecryptedCard(
            channelId,
            index,
            decryptedCard,
            storeInA
        );
        if (storeInA) {
            revealedCardsA[channelId][index] = decryptedCard;
        } else {
            revealedCardsB[channelId][index] = decryptedCard;
        }
    }

    function _indices(uint8 a) private pure returns (uint8[] memory arr) {
        arr = new uint8[](1);
        arr[0] = a;
    }

    function _indices(
        uint8 a,
        uint8 b
    ) private pure returns (uint8[] memory arr) {
        arr = new uint8[](2);
        arr[0] = a;
        arr[1] = b;
    }

    function _indices(
        uint8 a,
        uint8 b,
        uint8 c
    ) private pure returns (uint8[] memory arr) {
        arr = new uint8[](3);
        arr[0] = a;
        arr[1] = b;
        arr[2] = c;
    }

    function _verifyDecryptedCard(
        uint256 channelId,
        uint8 index,
        bytes calldata decryptedCard,
        bool isPlayerA
    ) internal view {
        bytes memory publicKey = isPlayerA ? publicKeyA[channelId] : publicKeyB[channelId];

        bytes storage encryptedCard = decks[channelId][index];

        if (decryptedCard.length != 64 || encryptedCard.length != 64) {
            revert InvalidDecryptedCard();
        }

        // Validate G1 points before pairing check
        if (Bn254.isInfinity(decryptedCard)) {
            revert InvalidDecryptedCard();
        }
        if (!Bn254.isG1OnCurve(decryptedCard)) {
            revert InvalidDecryptedCard();
        }
        if (Bn254.isInfinity(encryptedCard)) {
            revert InvalidDecryptedCard();
        }
        if (!Bn254.isG1OnCurve(encryptedCard)) {
            revert InvalidDecryptedCard();
        }

        if (
            !Bn254.verifyPartialDecrypt(decryptedCard, encryptedCard, publicKey)
        ) {
            revert InvalidDecryptedCard();
        }
    }

    function _ensureCommunityStage(
        ChannelData calldata ch,
        Action[] calldata actions,
        uint8 requiredStreet
    ) internal view {
        if (actions.length == 0) revert NoActionsProvided();
        GameValidation memory gv;
        (gv.ended, , gv.street) = replay.replayState(
            actions,
            ch.deposit1,
            ch.deposit2,
            ch.minSmallBlind,
            ch.player1,
            ch.player2
        );

        if (gv.ended) {
            revert InvalidGameState();
        }
        if (gv.street < requiredStreet) {
            revert InvalidGameState();
        }
    }

    function _ensureActiveGame(
        ChannelData calldata ch,
        Action[] calldata actions
    ) internal view {
        if (actions.length == 0) revert NoActionsProvided();
        GameValidation memory gv;
        (gv.ended, , gv.street) = replay.replayState(
            actions,
            ch.deposit1,
            ch.deposit2,
            ch.minSmallBlind,
            ch.player1,
            ch.player2
        );
        if (gv.ended) {
            revert InvalidGameState();
        }
    }

    function _requireDeck(uint256 channelId) internal view {
        if (decks[channelId].length != HeadsUpPokerEIP712.SLOT_RIVER + 1)
            revert InvalidDeck();
    }
}
