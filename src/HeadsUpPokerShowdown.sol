// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {HeadsUpPokerPeek} from "./HeadsUpPokerPeek.sol";
import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import {PokerEvaluator} from "./PokerEvaluator.sol";
import {Bn254} from "./Bn254.sol";
import "./HeadsUpPokerErrors.sol";

contract HeadsUpPokerShowdown is Ownable, HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    uint256 public constant revealWindow = 1 hours;

    struct ShowdownState {
        uint256 deadline;
        bool inProgress;
        bool player1Revealed;
        bool player2Revealed;
        // Canonical card codes resolved from plaintext (rank | suit) once
        // `finalizeReveals` verifies the submitted deck opens. The indices map
        // to SLOT_* constants inherited from HeadsUpPokerEIP712.
        uint8[9] cards;
        // Amount currently locked in the showdown pot that should be awarded to
        // the winner when the reveal flow concludes.
        uint256 calledAmount;
    }

    struct ChannelData {
        address player1;
        address player2;
        bool finalized;
        uint256 handId;
    }

    address private escrow;
    HeadsUpPokerPeek private peek;

    bool private peekInitialized;

    event PeekConfigured(address escrow, address peek);

    mapping(uint256 => ShowdownState) private showdowns;
    mapping(uint256 => mapping(uint8 => bytes)) private revealedPartialsA;
    mapping(uint256 => mapping(uint8 => bytes)) private revealedPartialsB;

    modifier onlyEscrow() {
        address escrowAddress = escrow;
        if (escrowAddress == address(0)) revert HelpersNotConfigured();
        if (msg.sender != escrowAddress) revert NotEscrow();
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setPeek(
        address escrowAddress,
        HeadsUpPokerPeek peekAddress
    ) external onlyOwner {
        if (peekInitialized) revert HelpersAlreadyConfigured();
        if (escrowAddress == address(0) || address(peekAddress) == address(0)) {
            revert HelpersNotConfigured();
        }

        escrow = escrowAddress;
        peek = peekAddress;
        peekInitialized = true;

        emit PeekConfigured(escrowAddress, address(peekAddress));
    }

    function _peek() private view returns (HeadsUpPokerPeek) {
        HeadsUpPokerPeek peekAddress = peek;
        if (address(peekAddress) == address(0)) revert HelpersNotConfigured();
        return peekAddress;
    }

    function helpersConfigured() external view returns (bool) {
        return peekInitialized;
    }

    function getShowdown(uint256 channelId) external view returns (ShowdownState memory) {
        return showdowns[channelId];
    }

    function isInProgress(uint256 channelId) external view returns (bool) {
        return showdowns[channelId].inProgress;
    }

    function resetChannel(uint256 channelId) external onlyEscrow {
        delete showdowns[channelId];
        // don't delete revealed cards - they will be reset in initiateShowdown
    }

    function initiateShowdown(uint256 channelId, uint256 calledAmount) external onlyEscrow {
        ShowdownState storage sd = showdowns[channelId];
        if (sd.inProgress) revert ShowdownInProgress();

        // Start a fresh reveal window and clear any leftover per-card data.
        sd.deadline = block.timestamp + revealWindow;
        sd.inProgress = true;
        sd.player1Revealed = false;
        sd.player2Revealed = false;
        sd.calledAmount = calledAmount;

        for (uint8 i = 0; i <= SLOT_RIVER; i++) {
            delete revealedPartialsA[channelId][i];
            delete revealedPartialsB[channelId][i];
        }
    }

    function revealCards(
        uint256 channelId,
        ChannelData calldata ch,
        bytes[] calldata decryptedCards,
        address player
    ) external onlyEscrow returns (bool player1Ready, bool player2Ready) {
        if (ch.player1 == address(0) || ch.player2 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (block.timestamp > sd.deadline) revert Expired();

        if (decryptedCards.length != SLOT_RIVER + 1) revert PrerequisitesNotMet();

        bytes memory openerPublicKey;

        if (player == ch.player1) {
            if (sd.player1Revealed) revert RevealAlreadySubmitted();
            openerPublicKey = _getPublicKeyA(channelId);
        } else if (player == ch.player2) {
            if (sd.player2Revealed) revert RevealAlreadySubmitted();
            openerPublicKey = _getPublicKeyB(channelId);
        } else {
            revert ActionInvalidSender();
        }

        for (uint8 i = 0; i <= SLOT_RIVER; i++) {
            bytes calldata card = decryptedCards[i];

            _verifyPartialDecrypt(
                channelId,
                i,
                openerPublicKey,
                card
            );

            if (player == ch.player1) {
                revealedPartialsA[channelId][i] = card;
            } else {
                revealedPartialsB[channelId][i] = card;
            }
        }

        if (player == ch.player1) {
            sd.player1Revealed = true;
        } else {
            sd.player2Revealed = true;
        }

        if (sd.player1Revealed && sd.player2Revealed) {
            // Both players have revealed - extend the deadline to allow
            // for finalization.
            sd.deadline = block.timestamp + revealWindow;
        }

        return (sd.player1Revealed, sd.player2Revealed);
    }

    function finalizeReveals(
        uint256 channelId,
        ChannelData calldata ch,
        bytes[] calldata plaintextCards,
        address player
    ) external onlyEscrow returns (address winner, uint256 wonAmount) {
        if (ch.player1 == address(0) || ch.player2 == address(0)) revert NoChannel();
        if (ch.finalized) revert AlreadyFinalized();

        ShowdownState storage sd = showdowns[channelId];
        if (!sd.inProgress) revert NoShowdownInProgress();
        if (!sd.player1Revealed || !sd.player2Revealed) revert PrerequisitesNotMet();
        if (plaintextCards.length != SLOT_RIVER + 1) revert PrerequisitesNotMet();

        for (uint8 i = 0; i <= SLOT_RIVER; i++) {
            bytes calldata pc = plaintextCards[i];

            bytes memory partialOther;
            bytes memory openerPublicKey;

            if (player == ch.player1) {
                partialOther = revealedPartialsB[channelId][i];
                openerPublicKey = _getPublicKeyA(channelId);
            } else if (player == ch.player2) {
                partialOther = revealedPartialsA[channelId][i];
                openerPublicKey = _getPublicKeyB(channelId);
            } else {
                revert ActionInvalidSender();
            }

            _verifyPlaintextFromPartial(
                pc,
                partialOther,
                openerPublicKey
            );

            uint8 cardValue = _peek().getCanonicalCard(channelId, pc);
            sd.cards[i] = cardValue;
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

        // If both players revealed the full deck but failed to provide valid plaintexts
        // result in tie

        sd.inProgress = false;
        sd.deadline = 0;
    }

    function _verifyPlaintextFromPartial(
        bytes memory plaintext,
        bytes memory partialCard,
        bytes memory openerPublicKey
    ) internal view {
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
        bytes memory openerPublicKey,
        bytes calldata decryptedCard
    ) internal view {
        if (decryptedCard.length != 64) revert InvalidDecryptedCard();

        if (Bn254.isInfinity(decryptedCard)) revert InvalidDecryptedCard();
        if (!Bn254.isG1OnCurve(decryptedCard)) revert InvalidDecryptedCard();

        if (openerPublicKey.length != 128) revert InvalidDecryptedCard();

        bytes memory encryptedCard = _peek().getDeck(channelId, index);
        if (encryptedCard.length != 64) revert InvalidDeck();

        if (Bn254.isInfinity(encryptedCard)) revert InvalidDecryptedCard();
        if (!Bn254.isG1OnCurve(encryptedCard)) revert InvalidDecryptedCard();

        if (
            !Bn254.verifyPartialDecrypt(
                decryptedCard,
                encryptedCard,
                openerPublicKey
            )
        ) {
            revert InvalidDecryptedCard();
        }
    }

    function _getPublicKeyA(uint256 channelId) internal view returns (bytes memory) {
        (bytes memory pkA, ) = _peek().getPublicKeys(channelId);
        return pkA;
    }

    function _getPublicKeyB(uint256 channelId) internal view returns (bytes memory) {
        (, bytes memory pkB) = _peek().getPublicKeys(channelId);
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
