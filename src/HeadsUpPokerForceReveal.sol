// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {Bn254} from "./Bn254.sol";
import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import "./HeadsUpPokerErrors.sol";

contract HeadsUpPokerForceReveal is HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

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
    }

    struct ChannelData {
        address player1;
        address player2;
        address player1Signer;
        address player2Signer;
        bool finalized;
        bool gameStarted;
        uint256 handId;
        uint256 deposit1;
        uint256 deposit2;
        uint256 slashAmount;
    }

    uint256 public constant forceRevealWindow = 1 hours;

    address private immutable escrow;

    // channelId => ForceRevealState
    mapping(uint256 => ForceRevealState) private forceReveals;
    // channelId => slot => revealed card from player A
    mapping(uint256 => mapping(uint8 => bytes)) private revealedCardsA;
    // channelId => slot => revealed card from player B
    mapping(uint256 => mapping(uint8 => bytes)) private revealedCardsB;
    // channelId => deck of encrypted cards
    mapping(uint256 => bytes[]) private decks;
    // channelId => public key of player A
    mapping(uint256 => bytes) private publicKeyA;
    // channelId => public key of player B
    mapping(uint256 => bytes) private publicKeyB;

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow();
        _;
    }

    constructor(address escrowAddress) {
        if (escrowAddress == address(0)) revert NotEscrow();
        escrow = escrowAddress;
    }

    // ------------------------------------------------------------------
    // View helpers
    // ------------------------------------------------------------------
    function getForceReveal(uint256 channelId) external view returns (ForceRevealState memory) {
        return forceReveals[channelId];
    }

    function getRevealedCardA(uint256 channelId, uint8 index) external view returns (bytes memory) {
        return revealedCardsA[channelId][index];
    }

    function getRevealedCardB(uint256 channelId, uint8 index) external view returns (bytes memory) {
        return revealedCardsB[channelId][index];
    }

    function getPublicKeys(uint256 channelId) external view returns (bytes memory, bytes memory) {
        return (publicKeyA[channelId], publicKeyB[channelId]);
    }

    function getDeckHash(uint256 channelId) external view returns (bytes32) {
        return keccak256(abi.encode(decks[channelId]));
    }

    function isDeckSet(uint256 channelId) external view returns (bool) {
        return decks[channelId].length == 52;
    }

    // ------------------------------------------------------------------
    // Channel setup helpers
    // ------------------------------------------------------------------
    function resetChannel(uint256 channelId) external onlyEscrow {
        delete forceReveals[channelId];
        delete publicKeyA[channelId];
        delete publicKeyB[channelId];
        delete decks[channelId];
        for (uint8 i = HeadsUpPokerEIP712.SLOT_A1; i <= HeadsUpPokerEIP712.SLOT_RIVER; i++) {
            delete revealedCardsA[channelId][i];
            delete revealedCardsB[channelId][i];
        }
    }

    function setPublicKeyA(uint256 channelId, bytes calldata key) external onlyEscrow {
        publicKeyA[channelId] = key;
    }

    function setPublicKeyB(uint256 channelId, bytes calldata key) external onlyEscrow {
        publicKeyB[channelId] = key;
    }

    function storeDeck(uint256 channelId, bytes[] calldata deck) external onlyEscrow {
        decks[channelId] = deck;
    }

    function requestHoleA(
        uint256 channelId,
        ChannelData calldata ch,
        address requester
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (ch.finalized) revert AlreadyFinalized();
        if (fr.inProgress || fr.stage != ForceRevealStage.NONE) revert ForceRevealInProgress();
        if (requester != ch.player1) revert NotPlayer();
        if (
            revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_A1].length != 0 ||
            revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_A2].length != 0
        ) revert PrerequisitesNotMet();

        _openForceReveal(fr, ForceRevealStage.HOLE_A, ch.player2);
    }

    function answerHoleA(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        _requireForceRevealActive(fr, ForceRevealStage.HOLE_A);
        _verifySender(ch, helper, fr.obligatedHelper);

        uint8[] memory indices = _indices(
            HeadsUpPokerEIP712.SLOT_A1,
            HeadsUpPokerEIP712.SLOT_A2
        );
        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCards,
            signatures,
            indices,
            ch
        );

        _completeForceReveal(fr);
    }

    function requestHoleB(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert ForceRevealInProgress();
        if (requester != ch.player2 && requester != ch.player2Signer) revert NotPlayer();
        if (
            revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_B1].length != 0 ||
            revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_B2].length != 0
        ) revert PrerequisitesNotMet();

        bool needPrereqs = revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_A2].length == 0;
        if (needPrereqs) {
            uint8[] memory indices = _indices(HeadsUpPokerEIP712.SLOT_A2);
            _verifyAndStore(
                channelId,
                ch.player2,
                decryptedCards,
                signatures,
                indices,
                ch
            );
        }

        _openForceReveal(fr, ForceRevealStage.HOLE_B, ch.player1);
    }

    function answerHoleB(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        _requireForceRevealActive(fr, ForceRevealStage.HOLE_B);
        _verifySender(ch, helper, fr.obligatedHelper);

        uint8[] memory indices = _indices(
            HeadsUpPokerEIP712.SLOT_B1,
            HeadsUpPokerEIP712.SLOT_B2
        );
        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCards,
            signatures,
            indices,
            ch
        );

        _completeForceReveal(fr);
    }

    function requestFlop(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        HeadsUpPokerEIP712.DecryptedCard[] calldata requesterDecryptedCards,
        bytes[] calldata requesterSignatures,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert ForceRevealInProgress();
        if (requester != ch.player1 && requester != ch.player2) revert NotPlayer();
        if (
            requesterDecryptedCards.length != 3 ||
            requesterSignatures.length != 3
        ) revert InvalidDecryptedCard();

        bool needPrereqs = revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_B2].length == 0;
        if (needPrereqs) {
            uint8[] memory indices = _indices(HeadsUpPokerEIP712.SLOT_B2);
            _verifyAndStore(
                channelId,
                ch.player1,
                decryptedCards,
                signatures,
                indices,
                ch
            );
        }

        address obligatedHelper = requester == ch.player1 ? ch.player2 : ch.player1;

        if (requester == ch.player1) {
            if (
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_FLOP1].length != 0 ||
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_FLOP2].length != 0 ||
                revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_FLOP3].length != 0
            ) revert PrerequisitesNotMet();
        } else {
            if (
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_FLOP1].length != 0 ||
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_FLOP2].length != 0 ||
                revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_FLOP3].length != 0
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
            requesterSignatures,
            flopIndices,
            ch
        );

        _openForceReveal(fr, ForceRevealStage.FLOP, obligatedHelper);
    }

    function answerFlop(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        _requireForceRevealActive(fr, ForceRevealStage.FLOP);
        _verifySender(ch, helper, fr.obligatedHelper);

        uint8[] memory flopIndices = _indices(
            HeadsUpPokerEIP712.SLOT_FLOP1,
            HeadsUpPokerEIP712.SLOT_FLOP2,
            HeadsUpPokerEIP712.SLOT_FLOP3
        );
        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCards,
            signatures,
            flopIndices,
            ch
        );

        _completeForceReveal(fr);
    }

    function requestTurn(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        HeadsUpPokerEIP712.DecryptedCard calldata requesterDecryptedCard,
        bytes calldata requesterSignature,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert ForceRevealInProgress();
        if (requester != ch.player1 && requester != ch.player2) revert NotPlayer();

        address obligatedHelper = requester == ch.player1 ? ch.player2 : ch.player1;

        if (requester == ch.player1) {
            if (revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_TURN].length != 0) {
                revert PrerequisitesNotMet();
            }
            bool needPrereqs = revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_FLOP3].length == 0;
            if (needPrereqs) {
                uint8[] memory indices = _indices(HeadsUpPokerEIP712.SLOT_FLOP3);
                _verifyAndStore(
                    channelId,
                    ch.player1,
                    decryptedCards,
                    signatures,
                    indices,
                    ch
                );
            }
        } else {
            if (revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_TURN].length != 0) {
                revert PrerequisitesNotMet();
            }
            bool needPrereqs = revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_FLOP3].length == 0;
            if (needPrereqs) {
                uint8[] memory indices = _indices(HeadsUpPokerEIP712.SLOT_FLOP3);
                _verifyAndStore(
                    channelId,
                    ch.player2,
                    decryptedCards,
                    signatures,
                    indices,
                    ch
                );
            }
        }

        _verifyAndStore(
            channelId,
            requester,
            requesterDecryptedCard,
            requesterSignature,
            HeadsUpPokerEIP712.SLOT_TURN,
            ch
        );

        _openForceReveal(fr, ForceRevealStage.TURN, obligatedHelper);
    }

    function answerTurn(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        bytes calldata signature
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        _requireForceRevealActive(fr, ForceRevealStage.TURN);
        _verifySender(ch, helper, fr.obligatedHelper);

        _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCard,
            signature,
            HeadsUpPokerEIP712.SLOT_TURN,
            ch
        );

        _completeForceReveal(fr);
    }

    function requestRiver(
        uint256 channelId,
        ChannelData calldata ch,
        address requester,
        HeadsUpPokerEIP712.DecryptedCard calldata requesterDecryptedCard,
        bytes calldata requesterSignature,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        if (ch.player1 == address(0)) revert NoChannel();
        if (!ch.gameStarted) revert GameNotStarted();
        _requireDeck(channelId);
        if (fr.inProgress) revert ForceRevealInProgress();
        if (requester != ch.player1 && requester != ch.player2) revert NotPlayer();

        address obligatedHelper = requester == ch.player1 ? ch.player2 : ch.player1;

        if (requester == ch.player1) {
            if (revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_RIVER].length != 0) {
                revert PrerequisitesNotMet();
            }
            bool needPrereqs = revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_TURN].length == 0;
            if (needPrereqs) {
                uint8[] memory indices = _indices(HeadsUpPokerEIP712.SLOT_TURN);
                _verifyAndStore(
                    channelId,
                    ch.player1,
                    decryptedCards,
                    signatures,
                    indices,
                    ch
                );
            }
        } else {
            if (revealedCardsA[channelId][HeadsUpPokerEIP712.SLOT_RIVER].length != 0) {
                revert PrerequisitesNotMet();
            }
            bool needPrereqs = revealedCardsB[channelId][HeadsUpPokerEIP712.SLOT_TURN].length == 0;
            if (needPrereqs) {
                uint8[] memory indices = _indices(HeadsUpPokerEIP712.SLOT_TURN);
                _verifyAndStore(
                    channelId,
                    ch.player2,
                    decryptedCards,
                    signatures,
                    indices,
                    ch
                );
            }
        }

        _verifyAndStore(
            channelId,
            requester,
            requesterDecryptedCard,
            requesterSignature,
            HeadsUpPokerEIP712.SLOT_RIVER,
            ch
        );

        _openForceReveal(fr, ForceRevealStage.RIVER, obligatedHelper);
    }

    function answerRiver(
        uint256 channelId,
        ChannelData calldata ch,
        address helper,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        bytes calldata signature
    ) external onlyEscrow {
        ForceRevealState storage fr = forceReveals[channelId];

        _requireForceRevealActive(fr, ForceRevealStage.RIVER);
        _verifySender(ch, helper, fr.obligatedHelper);

         _verifyAndStore(
            channelId,
            fr.obligatedHelper,
            decryptedCard,
            signature,
            HeadsUpPokerEIP712.SLOT_RIVER,
            ch
        );

        _completeForceReveal(fr);
    }

    function slashForceReveal(uint256 channelId) external onlyEscrow returns (address obligatedHelper) {
        ForceRevealState storage fr = forceReveals[channelId];

        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (block.timestamp <= fr.deadline) revert ForceRevealNotExpired();
        if (fr.served) revert ForceRevealAlreadyServed();

        obligatedHelper = fr.obligatedHelper;
        fr.inProgress = false;
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------
    function _requireForceRevealActive(ForceRevealState storage fr, ForceRevealStage stage) internal view {
        if (!fr.inProgress) revert NoForceRevealInProgress();
        if (fr.stage != stage) revert ForceRevealWrongStage();
        if (fr.served) revert ForceRevealAlreadyServed();
        if (block.timestamp > fr.deadline) revert Expired();
    }

    function _openForceReveal(
        ForceRevealState storage fr,
        ForceRevealStage stage,
        address obligatedHelper
    ) internal {
        fr.stage = stage;
        fr.inProgress = true;
        fr.served = false;
        fr.deadline = block.timestamp + forceRevealWindow;
        fr.obligatedHelper = obligatedHelper;
    }

    function _completeForceReveal(ForceRevealState storage fr) internal {
        fr.served = true;
        fr.inProgress = false;
    }

    function _verifyAndStore(
        uint256 channelId,
        address expectedSigner,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures,
        uint8[] memory indices,
        ChannelData calldata ch
    ) internal {
        uint256 length = indices.length;
        if (decryptedCards.length != length || signatures.length != length) {
            revert InvalidDecryptedCard();
        }
        bool storeInA = expectedSigner == ch.player1 || expectedSigner == ch.player1Signer;

        for (uint256 i = 0; i < length; i++) {
            uint8 index = indices[i];
            _verifyDecryptedCard(
                channelId,
                index,
                decryptedCards[i],
                signatures[i],
                expectedSigner,
                ch
            );
            _storeCard(
                channelId,
                index,
                decryptedCards[i].decryptedCard,
                storeInA
            );
        }
    }

    function _verifyAndStore(
        uint256 channelId,
        address expectedSigner,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        bytes calldata signature,
        uint8 index,
        ChannelData calldata ch
    ) internal {
        bool storeInA = expectedSigner == ch.player1 || expectedSigner == ch.player1Signer;

        _verifyDecryptedCard(
            channelId,
            index,
            decryptedCard,
            signature,
            expectedSigner,
            ch
        );
        _storeCard(
            channelId,
            index,
            decryptedCard.decryptedCard,
            storeInA
        );
    }

    function _storeCard(
        uint256 channelId,
        uint8 index,
        bytes memory card,
        bool storeInA
    ) internal {
        if (storeInA) {
            revealedCardsA[channelId][index] = card;
        } else {
            revealedCardsB[channelId][index] = card;
        }
    }

    function _indices(uint8 a) private pure returns (uint8[] memory arr) {
        arr = new uint8[](1);
        arr[0] = a;
    }

    function _indices(uint8 a, uint8 b) private pure returns (uint8[] memory arr) {
        arr = new uint8[](2);
        arr[0] = a;
        arr[1] = b;
    }

    function _indices(uint8 a, uint8 b, uint8 c) private pure returns (uint8[] memory arr) {
        arr = new uint8[](3);
        arr[0] = a;
        arr[1] = b;
        arr[2] = c;
    }

    function _verifySender(
        ChannelData calldata ch,
        address sender,
        address expectedSender
    ) internal pure {
        address expectedOptionalSigner = expectedSender == ch.player1
            ? ch.player1Signer
            : ch.player2Signer;

        if (sender != expectedSender && sender != expectedOptionalSigner) {
            revert ActionInvalidSender();
        }
    }

    function _verifyDecryptedCard(
        uint256 channelId,
        uint8 index,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        bytes calldata signature,
        address expectedSigner,
        ChannelData calldata ch
    ) internal view {
        uint256 handId = ch.handId;
        address expectedOptionalSigner = expectedSigner == ch.player1
            ? ch.player1Signer
            : ch.player2Signer;

        bytes memory publicKey = expectedSigner == ch.player1
            ? publicKeyA[channelId]
            : publicKeyB[channelId];

        bytes storage encryptedCard = decks[channelId][index];

        if (
            decryptedCard.channelId != channelId ||
            decryptedCard.handId != handId ||
            decryptedCard.index != index ||
            (decryptedCard.player != expectedSigner &&
                decryptedCard.player != expectedOptionalSigner)
        ) {
            revert InvalidDecryptedCard();
        }
        if (
            decryptedCard.decryptedCard.length != 64 ||
            encryptedCard.length != 64
        ) {
            revert InvalidDecryptedCard();
        }

        bytes32 digest = digestDecryptedCard(decryptedCard);
        if (
            digest.recover(signature) != expectedSigner &&
            digest.recover(signature) != expectedOptionalSigner
        ) {
            revert InvalidDecryptedCard();
        }

        if (
            !Bn254.verifyPartialDecrypt(
                decryptedCard.decryptedCard,
                encryptedCard,
                publicKey
            )
        ) {
            revert InvalidDecryptedCard();
        }
    }

    function _requireDeck(uint256 channelId) internal view {
        if (decks[channelId].length != 52) revert InvalidDeck();
    }
}
