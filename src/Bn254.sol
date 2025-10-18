// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Bn254
/// @notice Stateless helper library for BN254 curve operations and Merkle proofs
/// @dev All functions are pure/view with no state storage
library Bn254 {
    // BN254 curve parameters
    // Field modulus p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
    uint256 private constant P = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47;
    
    // BN254 curve: y^2 = x^3 + 3
    uint256 private constant B = 3;

    // G2 base point (uncompressed, 128 bytes: x.a||x.b||y.a||y.b in big-endian)
    // EVM format for pairing precompile: [x_imaginary, x_real, y_imaginary, y_real]
    // This is the standard BN254 G2 generator
    // x = (11559732032986387107991004021392285783925812861821192530917403151452391805634,
    //      10857046999023057135944570762232829481370756359578518086990519993285655852781)
    // y = (4082367875863433681332203403145435568316851327593401208105741076214120093531,
    //      8495653923123431417604973247489272438418190587263600148770280649306958101930)
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
        require(U.length == 64, "U must be 64 bytes");
        require(Y.length == 64, "Y must be 64 bytes");
        require(pkG2.length == 128, "pkG2 must be 128 bytes");

        // Build pairing input for e(U, pkG2) * e(-Y, G2_BASE) == 1
        // Format: [a1_x, a1_y, b1_x.a, b1_x.b, b1_y.a, b1_y.b, a2_x, a2_y, b2_x.a, b2_x.b, b2_y.a, b2_y.b]
        // where each element is 32 bytes
        
        bytes memory input = new bytes(384); // 12 * 32 = 384 bytes
        
        // First pairing: e(U, pkG2)
        // Copy U (G1 point, 64 bytes)
        for (uint256 i = 0; i < 64; i++) {
            input[i] = U[i];
        }
        // Copy pkG2 (G2 point, 128 bytes)
        for (uint256 i = 0; i < 128; i++) {
            input[64 + i] = pkG2[i];
        }
        
        // Second pairing: e(-Y, G2_BASE)
        // Negate Y: (x, p - y)
        uint256 yX;
        uint256 yY;
        assembly {
            yX := mload(add(Y, 32))
            yY := mload(add(Y, 64))
        }
        uint256 negYY = P - yY;
        
        // Copy negated Y (G1 point)
        assembly {
            mstore(add(input, 224), yX)      // offset 192 + 32
            mstore(add(input, 256), negYY)   // offset 224 + 32
        }
        
        // Copy G2_BASE (128 bytes)
        for (uint256 i = 0; i < 128; i++) {
            input[256 + i] = G2_BASE[i];
        }
        
        // Call pairing precompile at 0x08
        uint256[1] memory result;
        bool success;
        assembly {
            success := staticcall(
                gas(),
                0x08,           // Pairing precompile
                add(input, 32), // Skip length prefix
                384,            // Input size
                result,
                32              // Output size (1 or 0)
            )
        }
        
        require(success, "Pairing precompile failed");
        return result[0] == 1;
    }

    /// @notice Verify inclusion of a deck element in Merkle tree
    /// @dev Recomputes leaf = keccak256("Bdeck" || index || L || Y) and verifies Merkle proof
    /// @param rootB Merkle root for deck
    /// @param index Card index
    /// @param L Commitment value (32 bytes)
    /// @param Y G1 point (64 bytes)
    /// @param proof Merkle proof (array of sibling hashes)
    /// @return True if inclusion proof is valid
    function verifyDeckInclusion(
        bytes32 rootB,
        uint256 index,
        bytes32 L,
        bytes memory Y,
        bytes32[] memory proof
    ) internal pure returns (bool) {
        require(Y.length == 64, "Y must be 64 bytes");
        
        // Compute leaf: keccak256("Bdeck" || index || L || Y)
        bytes32 leaf = keccak256(abi.encodePacked("Bdeck", index, L, Y));
        
        return verifyMerkleProof(proof, rootB, leaf, index);
    }

    /// @notice Verify inclusion of an A-map element in Merkle tree
    /// @dev Checks keccak256("Amap" || cardId || R) against rootA
    /// @param rootA Merkle root for A-map
    /// @param cardId Card identifier (0-51 typically)
    /// @param R G1 point (64 bytes)
    /// @param proof Merkle proof (array of sibling hashes)
    /// @return True if inclusion proof is valid
    function verifyAmapInclusion(
        bytes32 rootA,
        uint8 cardId,
        bytes memory R,
        bytes32[] memory proof
    ) internal pure returns (bool) {
        require(R.length == 64, "R must be 64 bytes");
        
        // Compute leaf: keccak256("Amap" || cardId || R)
        bytes32 leaf = keccak256(abi.encodePacked("Amap", cardId, R));
        
        return verifyMerkleProof(proof, rootA, leaf, cardId);
    }

    /// @notice Verify a Merkle proof
    /// @dev Internal helper for Merkle verification
    /// @param proof Array of sibling hashes
    /// @param root Expected Merkle root
    /// @param leaf Leaf hash to verify
    /// @param index Leaf index for determining left/right position
    /// @return True if proof is valid
    function verifyMerkleProof(
        bytes32[] memory proof,
        bytes32 root,
        bytes32 leaf,
        uint256 index
    ) private pure returns (bool) {
        bytes32 computedHash = leaf;
        
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            
            if (index % 2 == 0) {
                // Current node is left child
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                // Current node is right child
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
            
            index = index / 2;
        }
        
        return computedHash == root;
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
        assembly {
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
        assembly {
            x := mload(add(p, 32))
            y := mload(add(p, 64))
        }
        
        return x == 0 && y == 0;
    }
}
