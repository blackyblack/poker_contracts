// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./Bn254.sol";

/// @title Bn254Test
/// @notice Test contract for Bn254 library functions
contract Bn254Test {
    using Bn254 for *;

    function verifyPartialDecrypt(
        bytes memory U,
        bytes memory Y,
        bytes memory pkG2
    ) external view returns (bool) {
        return Bn254.verifyPartialDecrypt(U, Y, pkG2);
    }

    function verifyDeckInclusion(
        bytes32 rootB,
        uint256 index,
        bytes32 L,
        bytes memory Y,
        bytes32[] memory proof
    ) external pure returns (bool) {
        return Bn254.verifyDeckInclusion(rootB, index, L, Y, proof);
    }

    function verifyAmapInclusion(
        bytes32 rootA,
        uint8 cardId,
        bytes memory R,
        bytes32[] memory proof
    ) external pure returns (bool) {
        return Bn254.verifyAmapInclusion(rootA, cardId, R, proof);
    }

    function isG1OnCurve(bytes memory p) external pure returns (bool) {
        return Bn254.isG1OnCurve(p);
    }

    function isInfinity(bytes memory p) external pure returns (bool) {
        return Bn254.isInfinity(p);
    }
}
