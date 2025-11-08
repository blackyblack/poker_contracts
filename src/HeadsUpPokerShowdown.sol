// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HeadsUpPokerPeek} from "./HeadsUpPokerPeek.sol";
import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import {PokerEvaluator} from "./PokerEvaluator.sol";
import {Bn254} from "./Bn254.sol";
import "./HeadsUpPokerErrors.sol";

contract HeadsUpPokerShowdown is HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    uint256 public constant revealWindow = 1 hours;

    struct ShowdownState {
        uint256 deadline;
        bool inProgress;
        bool player1Revealed;
        bool player2Revealed;
        uint8[9] cards;
        uint256 calledAmount;
    }

    struct ChannelData {
        address player1;
        address player2;
        address player1Signer;
        address player2Signer;
        bool finalized;
        uint256 handId;
    }

    address private immutable escrow;
    HeadsUpPokerPeek private immutable peek;

    mapping(uint256 => ShowdownState) private showdowns;
    mapping(uint256 => mapping(uint8 => bytes)) private revealedPartialsA;
    mapping(uint256 => mapping(uint8 => bytes)) private revealedPartialsB;

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow();
        _;
    }

    constructor(address escrowAddress, HeadsUpPokerPeek peekAddress) {
        escrow = escrowAddress;
        peek = peekAddress;
    }

    function getShowdown(uint256 channelId) external view returns (ShowdownState memory) {
        return showdowns[channelId];
    }

    function isInProgress(uint256 channelId) external view returns (bool) {
        return showdowns[channelId].inProgress;
    }

    function resetChannel(uint256 channelId) external onlyEscrow {
        delete showdowns[channelId];
        for (uint8 i = 0; i < SLOT_RIVER + 1; i++) {
            delete revealedPartialsA[channelId][i];
            delete revealedPartialsB[channelId][i];
        }
    }

    function initiateShowdown(uint256 channelId, uint256 calledAmount) external onlyEscrow {
        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) revert ShowdownInProgress();

        sd.deadline = block.timestamp + revealWindow;
        sd.inProgress = true;
        sd.player1Revealed = false;
        sd.player2Revealed = false;
        sd.calledAmount = calledAmount;

        for (uint8 i = 0; i < SLOT_RIVER + 1; i++) {
            sd.cards[i] = 0xFF;
            delete revealedPartialsA[channelId][i];
            delete revealedPartialsB[channelId][i];
        }
    }

    function revealCardsPlayer1(
        uint256 channelId,
        ChannelData calldata ch,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow returns (bool player1Ready, bool player2Ready) {
        return _revealCards(channelId, ch, decryptedCards, signatures, true);
    }

    function revealCardsPlayer2(
        uint256 channelId,
        ChannelData calldata ch,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures
    ) external onlyEscrow returns (bool player1Ready, bool player2Ready) {
        return _revealCards(channelId, ch, decryptedCards, signatures, false);
    }

    struct PlaintextCard {
        uint8 index;
        bytes plaintext;
        address opener;
    }

    function finalizeReveals(
        uint256 channelId,
        ChannelData calldata ch,
        PlaintextCard[] calldata plaintextCards,
        bytes[] calldata signatures
    ) external onlyEscrow returns (address winner, uint256 wonAmount) {
        if (ch.player1 == address(0) || ch.player2 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (!sd.player1Revealed || !sd.player2Revealed) revert PrerequisitesNotMet();
        if (plaintextCards.length != signatures.length) revert SignatureLengthMismatch();

        bool[SLOT_RIVER + 1] memory seen;

        for (uint256 i = 0; i < plaintextCards.length; i++) {
            PlaintextCard calldata pc = plaintextCards[i];
            uint8 slot = pc.index;
            if (slot > SLOT_RIVER) revert InvalidDecryptedCard();
            if (seen[slot]) revert InvalidDecryptedCard();
            seen[slot] = true;

            bytes memory partialOther;
            bytes memory openerPublicKey;

            if (
                pc.opener == ch.player1 ||
                pc.opener == ch.player1Signer
            ) {
                partialOther = revealedPartialsB[channelId][slot];
                openerPublicKey = _getPublicKeyA(channelId);
            } else if (
                pc.opener == ch.player2 ||
                pc.opener == ch.player2Signer
            ) {
                partialOther = revealedPartialsA[channelId][slot];
                openerPublicKey = _getPublicKeyB(channelId);
            } else {
                revert ActionInvalidSender();
            }

            if (partialOther.length != 64) revert InvalidDecryptedCard();

            HeadsUpPokerEIP712.DecryptedCard memory wrapped = HeadsUpPokerEIP712
                .DecryptedCard({
                    channelId: channelId,
                    handId: ch.handId,
                    player: pc.opener,
                    index: slot,
                    decryptedCard: pc.plaintext
                });

            _verifyPlaintextFromPartial(
                pc.plaintext,
                partialOther,
                openerPublicKey,
                signatures[i],
                wrapped,
                pc.opener,
                ch
            );

            uint8 cardValue = peek.getCanonicalCard(channelId, pc.plaintext);
            sd.cards[slot] = cardValue;
        }

        for (uint8 slot = 0; slot <= SLOT_RIVER; slot++) {
            if (!seen[slot]) revert PrerequisitesNotMet();
        }

        (winner, wonAmount) = _calculateShowdownWinner(channelId, ch);
        sd.inProgress = false;
        sd.deadline = 0;
    }

    function finalizeShowdown(
        uint256 channelId,
        ChannelData calldata ch
    ) external onlyEscrow returns (address winner, uint256 wonAmount) {
        if (ch.player1 == address(0) || ch.player2 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (block.timestamp <= sd.deadline) revert StillRevealing();

        bool aRevealed = sd.player1Revealed;
        bool bRevealed = sd.player2Revealed;

        winner = ch.player1;
        wonAmount = 0;

        if (aRevealed && !bRevealed) {
            wonAmount = sd.calledAmount;
        } else if (!aRevealed && bRevealed) {
            winner = ch.player2;
            wonAmount = sd.calledAmount;
        }

        sd.inProgress = false;
        sd.deadline = 0;
    }

    function _revealCards(
        uint256 channelId,
        ChannelData calldata ch,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCards,
        bytes[] calldata signatures,
        bool isPlayer1
    ) internal returns (bool player1Ready, bool player2Ready) {
        if (ch.player1 == address(0) || ch.player2 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();
        if (decryptedCards.length != signatures.length) revert SignatureLengthMismatch();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (block.timestamp > sd.deadline) revert Expired();

        if (isPlayer1) {
            if (sd.player1Revealed) revert RevealAlreadySubmitted();
        } else {
            if (sd.player2Revealed) revert RevealAlreadySubmitted();
        }

        bool[SLOT_RIVER + 1] memory required;
        if (isPlayer1) {
            required[SLOT_A1] = true;
            required[SLOT_A2] = true;
        } else {
            required[SLOT_B1] = true;
            required[SLOT_B2] = true;
        }
        required[SLOT_FLOP1] = true;
        required[SLOT_FLOP2] = true;
        required[SLOT_FLOP3] = true;
        required[SLOT_TURN] = true;
        required[SLOT_RIVER] = true;

        bool[SLOT_RIVER + 1] memory visited;

        address expectedSigner = isPlayer1 ? ch.player1 : ch.player2;

        for (uint256 i = 0; i < decryptedCards.length; i++) {
            HeadsUpPokerEIP712.DecryptedCard calldata card = decryptedCards[i];
            uint8 slot = card.index;
            if (slot > SLOT_RIVER) revert InvalidDecryptedCard();
            if (!required[slot]) revert CommitUnexpected(slot);
            if (visited[slot]) revert InvalidDecryptedCard();
            visited[slot] = true;

            _verifyPartialDecrypt(
                channelId,
                slot,
                card,
                signatures[i],
                expectedSigner,
                ch
            );

            if (isPlayer1) {
                revealedPartialsA[channelId][slot] = card.decryptedCard;
            } else {
                revealedPartialsB[channelId][slot] = card.decryptedCard;
            }
        }

        for (uint8 slot = 0; slot <= SLOT_RIVER; slot++) {
            if (required[slot] && !visited[slot]) revert PrerequisitesNotMet();
        }

        if (isPlayer1) {
            sd.player1Revealed = true;
        } else {
            sd.player2Revealed = true;
        }

        return (sd.player1Revealed, sd.player2Revealed);
    }

    function _verifyPlaintextFromPartial(
        bytes memory plaintext,
        bytes memory partialCard,
        bytes memory openerPublicKey,
        bytes calldata signature,
        HeadsUpPokerEIP712.DecryptedCard memory decryptedCard,
        address expectedSigner,
        ChannelData calldata ch
    ) internal view {
        address expectedOptionalSigner = expectedSigner == ch.player1
            ? ch.player1Signer
            : ch.player2Signer;

        bytes32 structHash = keccak256(
            abi.encode(
                DECRYPTED_CARD_TYPEHASH,
                decryptedCard.channelId,
                decryptedCard.handId,
                decryptedCard.player,
                decryptedCard.index,
                keccak256(decryptedCard.decryptedCard)
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        if (recovered != expectedSigner && recovered != expectedOptionalSigner) {
            revert InvalidDecryptedCard();
        }

        if (plaintext.length != 64) revert InvalidDecryptedCard();
        if (partialCard.length != 64) revert InvalidDecryptedCard();
        if (openerPublicKey.length != 128) revert InvalidDecryptedCard();

        if (Bn254.isInfinity(plaintext)) revert InvalidDecryptedCard();
        if (!Bn254.isG1OnCurve(plaintext)) revert InvalidDecryptedCard();
        if (Bn254.isInfinity(partialCard)) revert InvalidDecryptedCard();
        if (!Bn254.isG1OnCurve(partialCard)) revert InvalidDecryptedCard();

        if (!Bn254.verifyPartialDecrypt(plaintext, partialCard, openerPublicKey)) {
            revert InvalidDecryptedCard();
        }
    }

    function _verifyPartialDecrypt(
        uint256 channelId,
        uint8 index,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        bytes calldata signature,
        address expectedSigner,
        ChannelData calldata ch
    ) internal view {
        address expectedOptionalSigner = expectedSigner == ch.player1
            ? ch.player1Signer
            : ch.player2Signer;

        if (
            decryptedCard.channelId != channelId ||
            decryptedCard.handId != ch.handId ||
            decryptedCard.index != index ||
            (decryptedCard.player != expectedSigner &&
                decryptedCard.player != expectedOptionalSigner)
        ) {
            revert InvalidDecryptedCard();
        }

        if (decryptedCard.decryptedCard.length != 64) revert InvalidDecryptedCard();

        bytes32 digest = digestDecryptedCard(decryptedCard);
        address recovered = digest.recover(signature);
        if (recovered != expectedSigner && recovered != expectedOptionalSigner) {
            revert InvalidDecryptedCard();
        }

        if (Bn254.isInfinity(decryptedCard.decryptedCard)) revert InvalidDecryptedCard();
        if (!Bn254.isG1OnCurve(decryptedCard.decryptedCard)) revert InvalidDecryptedCard();

        bytes memory publicKey = expectedSigner == ch.player1
            ? _getPublicKeyA(channelId)
            : _getPublicKeyB(channelId);

        if (publicKey.length != 128) revert InvalidDecryptedCard();

        bytes memory encryptedCard = peek.getDeck(channelId, index);
        if (encryptedCard.length != 64) revert InvalidDeck();

        if (Bn254.isInfinity(encryptedCard)) revert InvalidDecryptedCard();
        if (!Bn254.isG1OnCurve(encryptedCard)) revert InvalidDecryptedCard();

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

    function _getPublicKeyA(uint256 channelId) internal view returns (bytes memory) {
        (bytes memory pkA, ) = peek.getPublicKeys(channelId);
        return pkA;
    }

    function _getPublicKeyB(uint256 channelId) internal view returns (bytes memory) {
        (, bytes memory pkB) = peek.getPublicKeys(channelId);
        return pkB;
    }

    function _calculateShowdownWinner(
        uint256 channelId,
        ChannelData calldata ch
    ) internal view returns (address winner, uint256 wonAmount) {
        ShowdownState storage sd = showdowns[channelId];

        uint8[7] memory player1Cards;
        uint8[7] memory player2Cards;

        player1Cards[0] = sd.cards[SLOT_A1];
        player1Cards[1] = sd.cards[SLOT_A2];
        player2Cards[0] = sd.cards[SLOT_B1];
        player2Cards[1] = sd.cards[SLOT_B2];

        for (uint8 i = 0; i < 5; i++) {
            uint8 card = sd.cards[uint8(SLOT_FLOP1 + i)];
            player1Cards[i + 2] = card;
            player2Cards[i + 2] = card;
        }

        uint256 player1Rank = PokerEvaluator.evaluateHand(player1Cards);
        uint256 player2Rank = PokerEvaluator.evaluateHand(player2Cards);

        wonAmount = sd.calledAmount;

        if (player1Rank > player2Rank) {
            winner = ch.player1;
        } else if (player2Rank > player1Rank) {
            winner = ch.player2;
        } else {
            winner = ch.player1;
            wonAmount = 0;
        }
    }
}
