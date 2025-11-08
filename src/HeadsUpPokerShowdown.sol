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

    uint16 constant MASK_ALL = 0x01FF;

    uint256 public constant revealWindow = 1 hours;

    struct ShowdownState {
        uint256 deadline;
        bool inProgress;
        uint8[9] cards;
        uint16 lockedCommitMask;
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
    }

    function initiateShowdown(uint256 channelId, uint256 calledAmount) external onlyEscrow {
        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) revert ShowdownInProgress();

        sd.deadline = block.timestamp + revealWindow;
        sd.inProgress = true;
        sd.lockedCommitMask = 0;
        sd.calledAmount = calledAmount;

        for (uint8 i = 0; i < SLOT_RIVER + 1; i++) {
            sd.cards[i] = 0xFF;
        }
    }

    function revealCards(
        uint256 channelId,
        ChannelData calldata ch,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCardsOther,
        bytes[] calldata signaturesOther,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCardsOpener,
        bytes[] calldata signaturesOpener
    )
        external
        onlyEscrow
        returns (bool completed, address winner, uint256 wonAmount, uint16 mask)
    {
        if (ch.player1 == address(0) || ch.player2 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (block.timestamp > sd.deadline) revert Expired();

        mask = _applyCardReveal(
            channelId,
            ch,
            sd,
            decryptedCardsOther,
            signaturesOther,
            decryptedCardsOpener,
            signaturesOpener
        );

        completed = mask == MASK_ALL;
        if (completed) {
            (winner, wonAmount) = _calculateShowdownWinner(channelId, ch);
            sd.inProgress = false;
            sd.deadline = 0;
        }
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

        bool aRevealed = sd.cards[SLOT_A1] != 0xFF && sd.cards[SLOT_A2] != 0xFF;
        bool bRevealed = sd.cards[SLOT_B1] != 0xFF && sd.cards[SLOT_B2] != 0xFF;

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

    function _applyCardReveal(
        uint256 channelId,
        ChannelData calldata ch,
        ShowdownState storage sd,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCardsOther,
        bytes[] calldata signaturesOther,
        HeadsUpPokerEIP712.DecryptedCard[] calldata decryptedCardsOpener,
        bytes[] calldata signaturesOpener
    ) internal returns (uint16 mask) {
        if (decryptedCardsOther.length != signaturesOther.length)
            revert SignatureLengthMismatch();
        if (decryptedCardsOpener.length != signaturesOpener.length)
            revert SignatureLengthMismatch();

        mask = sd.lockedCommitMask;

        for (uint256 i = 0; i < decryptedCardsOpener.length; i++) {
            HeadsUpPokerEIP712.DecryptedCard calldata cardOpener = decryptedCardsOpener[i];
            uint8 slot = cardOpener.index;
            uint16 bit = uint16(1) << slot;

            if ((mask & bit) == bit) continue;

            if ((MASK_ALL & bit) == 0) revert CommitUnexpected(slot);
            if (cardOpener.channelId != channelId) revert CommitWrongChannel(slot);
            if (cardOpener.handId != ch.handId) revert ActionWrongHand();

            address opener = cardOpener.player;
            address other;
            bool openerIsPlayer1;

            if (opener == ch.player1 || opener == ch.player1Signer) {
                other = ch.player2;
                openerIsPlayer1 = true;
            } else if (opener == ch.player2 || opener == ch.player2Signer) {
                other = ch.player1;
                openerIsPlayer1 = false;
            } else {
                revert ActionInvalidSender();
            }

            bytes memory partialOther;
            bytes memory existingPartial = openerIsPlayer1
                ? peek.getRevealedCardB(channelId, slot)
                : peek.getRevealedCardA(channelId, slot);

            if (existingPartial.length == 64) {
                partialOther = existingPartial;
            } else {
                bool found = false;
                for (uint256 j = 0; j < decryptedCardsOther.length; j++) {
                    if (decryptedCardsOther[j].index == slot) {
                        _verifyPartialDecrypt(
                            channelId,
                            slot,
                            decryptedCardsOther[j],
                            signaturesOther[j],
                            other,
                            ch
                        );
                        partialOther = decryptedCardsOther[j].decryptedCard;
                        found = true;
                        break;
                    }
                }
                if (!found) revert InvalidDecryptedCard();
            }

            _verifyPlaintextFromPartial(
                cardOpener.decryptedCard,
                partialOther,
                openerIsPlayer1 ? _getPublicKeyA(channelId) : _getPublicKeyB(channelId),
                signaturesOpener[i],
                cardOpener,
                opener,
                ch
            );

            uint8 cardValue = peek.getCanonicalCard(channelId, cardOpener.decryptedCard);
            sd.cards[slot] = cardValue;
            mask |= bit;
        }

        sd.lockedCommitMask = mask;
    }

    function _verifyPlaintextFromPartial(
        bytes memory plaintext,
        bytes memory partialCard,
        bytes memory openerPublicKey,
        bytes calldata signature,
        HeadsUpPokerEIP712.DecryptedCard calldata decryptedCard,
        address expectedSigner,
        ChannelData calldata ch
    ) internal view {
        address expectedOptionalSigner = expectedSigner == ch.player1
            ? ch.player1Signer
            : ch.player2Signer;

        bytes32 digest = digestDecryptedCard(decryptedCard);
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
