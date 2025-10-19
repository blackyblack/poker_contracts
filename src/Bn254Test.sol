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

    function isG1OnCurve(bytes memory p) external pure returns (bool) {
        return Bn254.isG1OnCurve(p);
    }

    function isInfinity(bytes memory p) external pure returns (bool) {
        return Bn254.isInfinity(p);
    }
}
