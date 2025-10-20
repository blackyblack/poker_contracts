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

    /// @notice Test wrapper for verifyFlop
    function verifyFlop(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes[] memory cardAOpeners,
        bytes[] memory cardBOpeners
    ) external view returns (bool) {
        return CardVerifier.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners);
    }

    /// @notice Test wrapper for verifyTurn
    function verifyTurn(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory cardAOpener,
        bytes memory cardBOpener
    ) external view returns (bool) {
        return CardVerifier.verifyTurn(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
    }

    /// @notice Test wrapper for verifyRiver
    function verifyRiver(
        bytes memory pkA,
        bytes memory pkB,
        bytes[] memory bDeckSigned,
        bytes memory cardAOpener,
        bytes memory cardBOpener
    ) external view returns (bool) {
        return CardVerifier.verifyRiver(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
    }
}
