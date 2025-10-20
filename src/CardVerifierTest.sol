// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./CardVerifier.sol";

/// @title CardVerifierTest
/// @notice Test contract for CardVerifier library
contract CardVerifierTest {
    /// @notice Test wrapper for verifyHoleA
    function verifyHoleA(
        bytes memory pkB,
        bytes memory card1Encrypted,
        bytes memory card1Opener,
        bytes memory card2Encrypted,
        bytes memory card2Opener
    ) external view returns (bool) {
        return CardVerifier.verifyHoleA(
            pkB,
            card1Encrypted,
            card1Opener,
            card2Encrypted,
            card2Opener
        );
    }

    /// @notice Test wrapper for verifyHoleB
    function verifyHoleB(
        bytes memory pkA,
        bytes memory card1Encrypted,
        bytes memory card1Opener,
        bytes memory card2Encrypted,
        bytes memory card2Opener
    ) external view returns (bool) {
        return CardVerifier.verifyHoleB(
            pkA,
            card1Encrypted,
            card1Opener,
            card2Encrypted,
            card2Opener
        );
    }

    /// @notice Test wrapper for verifyPublic
    function verifyPublic(
        bytes memory pkA,
        bytes memory pkB,
        bytes memory cardEncrypted,
        bytes memory cardAOpener,
        bytes memory cardBOpener
    ) external view returns (bool) {
        return CardVerifier.verifyPublic(
            pkA,
            pkB,
            cardEncrypted,
            cardAOpener,
            cardBOpener
        );
    }
}
