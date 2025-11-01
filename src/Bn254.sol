// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

error IncorrectSizeU();
error IncorrectSizeY();
error IncorrectSizePublicKey();
error PairingFailed();

/// @title Bn254
/// @notice Helper library for BN254 curve operations
library Bn254 {
    // BN254 curve parameters
    // Field modulus p
    uint256 private constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    
    // BN254 curve: y^2 = x^3 + 3
    uint256 private constant B = 3;

    // G2 base point (uncompressed, 128 bytes: x.a||x.b||y.a||y.b in big-endian)
    // EVM format for pairing precompile: [x_imaginary, x_real, y_imaginary, y_real]
    // This is the standard BN254 G2 generator
    bytes private constant G2_BASE = hex"198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa";

    /// @notice Verify a partial decryption using BN254 pairing
    /// @dev Checks e(U, pkG2) == e(Y, G2_BASE) via precompile 0x08
    /// Precompile format: Takes pairs of (G1, G2) points, returns 1 if product of pairings equals 1
    /// Input format for each pair: G1 (64 bytes: x||y), G2 (128 bytes: x.a||x.b||y.a||y.b)
    /// Total input: 384 bytes for 2 pairs (2 * (64 + 128))
    /// @param U G1 point U (64 bytes uncompressed: x||y big-endian)
    /// @param Y G1 point Y (64 bytes uncompressed: x||y big-endian)
    /// @param pkG2 G2 public key (128 bytes uncompressed: x.a||x.b||y.a||y.b big-endian)
    /// @return True if pairing check passes
    function verifyPartialDecrypt(
        bytes memory U,
        bytes memory Y,
        bytes memory pkG2
    ) internal view returns (bool) {
        if (U.length != 64)
            revert IncorrectSizeU();
        if (Y.length != 64)
            revert IncorrectSizeY();
        if (pkG2.length != 128)
            revert IncorrectSizePublicKey();

        uint256 yX;
        uint256 yY;

        assembly ("memory-safe") {
            yX := mload(add(Y, 32))
            yY := mload(add(Y, 64))
        }

        uint256 negYY = P - yY;
        bytes memory g2base = G2_BASE;

        bytes memory input = new bytes(384);

        assembly ("memory-safe") {
            let inputPtr := add(input, 32)

            mstore(inputPtr, mload(add(U, 32)))
            mstore(add(inputPtr, 32), mload(add(U, 64)))

            let pkPtr := add(pkG2, 32)
            mstore(add(inputPtr, 64), mload(pkPtr))
            mstore(add(inputPtr, 96), mload(add(pkPtr, 32)))
            mstore(add(inputPtr, 128), mload(add(pkPtr, 64)))
            mstore(add(inputPtr, 160), mload(add(pkPtr, 96)))
            mstore(add(input, 224), yX)
            mstore(add(input, 256), negYY)
            mstore(add(input, 288), mload(add(g2base, 32)))
            mstore(add(input, 320), mload(add(g2base, 64)))
            mstore(add(input, 352), mload(add(g2base, 96)))
            mstore(add(input, 384), mload(add(g2base, 128)))
        }
        
        // Call pairing precompile at 0x08
        uint256[1] memory result;
        bool success;
        assembly ("memory-safe") {
            success := staticcall(
                gas(),
                0x08,           // Pairing precompile
                add(input, 32), // Skip length prefix
                384,            // Input size
                result,
                32              // Output size (1 or 0)
            )
        }

        if (!success)
            revert PairingFailed();
        
        return result[0] == 1;
    }

    /// @notice Check if a G1 point lies on the BN254 curve
    /// @dev Verifies y^2 = x^3 + 3 (mod p)
    /// @param p G1 point (64 bytes uncompressed: x||y big-endian)
    /// @return True if point is on curve
    function isG1OnCurve(bytes memory p) internal pure returns (bool) {
        if (p.length != 64) {
            return false;
        }
        
        uint256 x;
        uint256 y;
        assembly ("memory-safe") {
            x := mload(add(p, 32))
            y := mload(add(p, 64))
        }
        
        // Check if point is infinity (0, 0)
        if (x == 0 && y == 0) {
            return true;
        }
        
        // Check if coordinates are in field
        if (x >= P || y >= P) {
            return false;
        }
        
        // Check curve equation: y^2 = x^3 + 3
        uint256 lhs = mulmod(y, y, P);
        uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), B, P);
        
        return lhs == rhs;
    }

    /// @notice Check if a G1 point is the point at infinity
    /// @dev In affine coordinates, infinity is represented as (0, 0)
    /// @param p G1 point (64 bytes uncompressed: x||y big-endian)
    /// @return True if point is infinity
    function isInfinity(bytes memory p) internal pure returns (bool) {
        if (p.length != 64) {
            return false;
        }
        
        uint256 x;
        uint256 y;
        assembly ("memory-safe") {
            x := mload(add(p, 32))
            y := mload(add(p, 64))
        }
        
        return x == 0 && y == 0;
    }
}
