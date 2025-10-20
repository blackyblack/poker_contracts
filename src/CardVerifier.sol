// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./Bn254.sol";

/// @title CardVerifier
/// @notice Library for verifying card decryption data in poker games
/// @dev Uses BN254 pairing to verify partial decryptions of encrypted cards
library CardVerifier {
    /// @notice Verify hole cards for player A (first two cards in deck)
    /// @dev Verifies cards at positions 0 and 1 using BN254 pairing
    /// @param pkB G2 public key of player B (128 bytes)
    /// @param bDeckSigned Final deck signed by player B (array of G1 points, each 64 bytes)
    /// @param card1Opener G1 point representing decrypted first card by B (64 bytes)
    /// @param card2Opener G1 point representing decrypted second card by B (64 bytes)
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
    /// @dev Verifies cards at positions 2 and 3 using BN254 pairing
    /// @param pkA G2 public key of player A (128 bytes)
    /// @param bDeckSigned Final deck signed by player A (array of G1 points, each 64 bytes)
    /// @param card1Opener G1 point representing decrypted third card by A (64 bytes)
    /// @param card2Opener G1 point representing decrypted fourth card by A (64 bytes)
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

    /// @notice Verify flop cards (cards 5, 6, 7 in deck)
    /// @dev Verifies three flop cards using both players' public keys
    /// @param pkA G2 public key of player A (128 bytes)
    /// @param pkB G2 public key of player B (128 bytes)
    /// @param bDeckSigned Final deck (array of G1 points, each 64 bytes)
    /// @param cardAOpeners Array of 3 G1 points representing cards decrypted by A (each 64 bytes)
    /// @param cardBOpeners Array of 3 G1 points representing cards decrypted by B (each 64 bytes)
    /// @return True if all three flop cards are correctly decrypted
    function verifyFlop(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes[] memory cardAOpeners,
        bytes[] memory cardBOpeners
    ) internal view returns (bool) {
        require(bDeckSigned.length >= 7, "Deck must have at least 7 cards");
        require(cardAOpeners.length == 3, "cardAOpeners must have 3 elements");
        require(cardBOpeners.length == 3, "cardBOpeners must have 3 elements");
        
        // Verify flop cards at positions 4, 5, 6
        for (uint256 i = 0; i < 3; i++) {
            require(cardAOpeners[i].length == 64, "cardAOpener must be 64 bytes");
            require(cardBOpeners[i].length == 64, "cardBOpener must be 64 bytes");
            
            // Verify partial decrypt by A
            bool validA = Bn254.verifyPartialDecrypt(
                bDeckSigned[4 + i],
                cardAOpeners[i],
                pkA
            );
            
            // Verify partial decrypt by B
            bool validB = Bn254.verifyPartialDecrypt(
                cardAOpeners[i],
                cardBOpeners[i],
                pkB
            );
            
            if (!validA || !validB) {
                return false;
            }
        }
        
        return true;
    }

    /// @notice Verify turn card (card 8 in deck)
    /// @dev Verifies the turn card using both players' public keys
    /// @param pkA G2 public key of player A (128 bytes)
    /// @param pkB G2 public key of player B (128 bytes)
    /// @param bDeckSigned Final deck (array of G1 points, each 64 bytes)
    /// @param cardAOpener G1 point representing card decrypted by A (64 bytes)
    /// @param cardBOpener G1 point representing card decrypted by B (64 bytes)
    /// @return True if the turn card is correctly decrypted
    function verifyTurn(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory cardAOpener,
        bytes memory cardBOpener
    ) internal view returns (bool) {
        require(bDeckSigned.length >= 8, "Deck must have at least 8 cards");
        require(cardAOpener.length == 64, "cardAOpener must be 64 bytes");
        require(cardBOpener.length == 64, "cardBOpener must be 64 bytes");
        
        // Verify turn card at position 7
        // Verify partial decrypt by A
        bool validA = Bn254.verifyPartialDecrypt(
            bDeckSigned[7],
            cardAOpener,
            pkA
        );
        
        // Verify partial decrypt by B
        bool validB = Bn254.verifyPartialDecrypt(
            cardAOpener,
            cardBOpener,
            pkB
        );
        
        return validA && validB;
    }

    /// @notice Verify river card (card 9 in deck)
    /// @dev Verifies the river card using both players' public keys
    /// @param pkA G2 public key of player A (128 bytes)
    /// @param pkB G2 public key of player B (128 bytes)
    /// @param bDeckSigned Final deck (array of G1 points, each 64 bytes)
    /// @param cardAOpener G1 point representing card decrypted by A (64 bytes)
    /// @param cardBOpener G1 point representing card decrypted by B (64 bytes)
    /// @return True if the river card is correctly decrypted
    function verifyRiver(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory cardAOpener,
        bytes memory cardBOpener
    ) internal view returns (bool) {
        require(bDeckSigned.length >= 9, "Deck must have at least 9 cards");
        require(cardAOpener.length == 64, "cardAOpener must be 64 bytes");
        require(cardBOpener.length == 64, "cardBOpener must be 64 bytes");
        
        // Verify river card at position 8
        // Verify partial decrypt by A
        bool validA = Bn254.verifyPartialDecrypt(
            bDeckSigned[8],
            cardAOpener,
            pkA
        );
        
        // Verify partial decrypt by B
        bool validB = Bn254.verifyPartialDecrypt(
            cardAOpener,
            cardBOpener,
            pkB
        );
        
        return validA && validB;
    }
}
