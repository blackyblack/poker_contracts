// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./CardVerifier.sol";

/// @title CardVerifierTest
/// @notice Test contract for CardVerifier library
contract CardVerifierTest {
    /// @notice Test wrapper for verifyHoleA
    function verifyHoleA(
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory card1Opener,
        bytes memory card2Opener
    ) external view returns (bool) {
        return CardVerifier.verifyHoleA(pkB, bDeckSigned, card1Opener, card2Opener);
    }

    /// @notice Test wrapper for verifyHoleB
    function verifyHoleB(
        bytes memory pkA,
        bytes[] memory bDeckSigned,
        bytes memory card1Opener,
        bytes memory card2Opener
    ) external view returns (bool) {
        return CardVerifier.verifyHoleB(pkA, bDeckSigned, card1Opener, card2Opener);
    }

    /// @notice Test wrapper for verifyPublic
    function verifyPublic(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory cardAOpener,
        bytes memory cardBOpener,
        uint256 cardIndex
    ) external view returns (bool) {
        return CardVerifier.verifyPublic(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener, cardIndex);
    }
}
