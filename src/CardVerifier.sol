// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./Bn254.sol";

/// @title CardVerifier
/// @notice Library for verifying card decryption data in poker games
/// @dev Uses BN254 pairing to verify partial decryptions of encrypted cards.
/// In mental poker, cards are encrypted by both players. To reveal:
/// - Hole cards: opponent provides decryption (since the player already knows their own cards)
/// - Public cards: both players provide decryptions in sequence
library CardVerifier {
    /// @notice Verify hole cards for player A (first two cards in deck)
    /// @dev Verifies cards at positions 0 and 1 using BN254 pairing.
    /// Player B must provide decryptions to reveal Player A's hole cards.
    /// Checks: e(bDeckSigned[i], pkB) == e(cardOpener[i], G2_BASE)
    /// @param pkB G2 public key of player B (128 bytes)
    /// @param bDeckSigned Final deck encrypted by both players (array of G1 points, each 64 bytes)
    /// @param card1Opener G1 point representing first card decrypted by B (64 bytes)
    /// @param card2Opener G1 point representing second card decrypted by B (64 bytes)
    /// @return True if both cards are correctly decrypted
    function verifyHoleA(
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory card1Opener,
        bytes memory card2Opener
    ) internal view returns (bool) {
        require(bDeckSigned.length >= 2, "Deck must have at least 2 cards");
        require(card1Opener.length == 64, "card1Opener must be 64 bytes");
        require(card2Opener.length == 64, "card2Opener must be 64 bytes");
        
        // Verify first hole card (position 0)
        bool card1Valid = Bn254.verifyPartialDecrypt(
            bDeckSigned[0],
            card1Opener,
            pkB
        );
        
        // Verify second hole card (position 1)
        bool card2Valid = Bn254.verifyPartialDecrypt(
            bDeckSigned[1],
            card2Opener,
            pkB
        );
        
        return card1Valid && card2Valid;
    }

    /// @notice Verify hole cards for player B (third and fourth cards in deck)
    /// @dev Verifies cards at positions 2 and 3 using BN254 pairing.
    /// Player A must provide decryptions to reveal Player B's hole cards.
    /// Checks: e(bDeckSigned[i], pkA) == e(cardOpener[i], G2_BASE)
    /// @param pkA G2 public key of player A (128 bytes)
    /// @param bDeckSigned Final deck encrypted by both players (array of G1 points, each 64 bytes)
    /// @param card1Opener G1 point representing third card decrypted by A (64 bytes)
    /// @param card2Opener G1 point representing fourth card decrypted by A (64 bytes)
    /// @return True if both cards are correctly decrypted
    function verifyHoleB(
        bytes memory pkA,
        bytes[] memory bDeckSigned,
        bytes memory card1Opener,
        bytes memory card2Opener
    ) internal view returns (bool) {
        require(bDeckSigned.length >= 4, "Deck must have at least 4 cards");
        require(card1Opener.length == 64, "card1Opener must be 64 bytes");
        require(card2Opener.length == 64, "card2Opener must be 64 bytes");
        
        // Verify first hole card for B (position 2)
        bool card1Valid = Bn254.verifyPartialDecrypt(
            bDeckSigned[2],
            card1Opener,
            pkA
        );
        
        // Verify second hole card for B (position 3)
        bool card2Valid = Bn254.verifyPartialDecrypt(
            bDeckSigned[3],
            card2Opener,
            pkA
        );
        
        return card1Valid && card2Valid;
    }

    /// @notice Verify public card(s) at specified index/indices
    /// @dev Verifies public cards using both players' public keys with symmetric verification.
    /// Both players must provide independent decryptions from the same encrypted deck.
    /// Checks: e(bDeckSigned[cardIndex], pkA) == e(cardAOpener, G2_BASE) AND
    ///         e(bDeckSigned[cardIndex], pkB) == e(cardBOpener, G2_BASE)
    /// @param pkA G2 public key of player A (128 bytes)
    /// @param pkB G2 public key of player B (128 bytes)
    /// @param bDeckSigned Final deck encrypted by both players (array of G1 points, each 64 bytes)
    /// @param cardAOpener G1 point representing card decrypted by A (64 bytes)
    /// @param cardBOpener G1 point representing card decrypted by B (64 bytes)
    /// @param cardIndex Index of the card in the deck to verify
    /// @return True if the card is correctly decrypted by both players
    function verifyPublic(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory cardAOpener,
        bytes memory cardBOpener,
        uint256 cardIndex
    ) internal view returns (bool) {
        require(bDeckSigned.length > cardIndex, "Card index out of bounds");
        require(cardAOpener.length == 64, "cardAOpener must be 64 bytes");
        require(cardBOpener.length == 64, "cardBOpener must be 64 bytes");
        
        // Verify decrypt by A
        bool validA = Bn254.verifyPartialDecrypt(
            bDeckSigned[cardIndex],
            cardAOpener,
            pkA
        );
        
        // Verify decrypt by B
        bool validB = Bn254.verifyPartialDecrypt(
            bDeckSigned[cardIndex],
            cardBOpener,
            pkB
        );
        
        return validA && validB;
    }
}
