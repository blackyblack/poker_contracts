# Bn254 Library

## Overview

The `Bn254.sol` library provides stateless helper functions for BN254 curve operations and Merkle proof verification. All functions are `pure` or `view` with no state storage, making it a lightweight cryptographic utility library.

## Functions

### verifyPartialDecrypt

```solidity
function verifyPartialDecrypt(
    bytes memory U,
    bytes memory Y,
    bytes memory pkG2
) internal view returns (bool)
```

Verifies a partial decryption using BN254 pairing via the EVM precompile at address `0x08`.

**Parameters:**
- `U`: G1 point (64 bytes uncompressed: x||y in big-endian)
- `Y`: G1 point (64 bytes uncompressed: x||y in big-endian)
- `pkG2`: G2 public key (128 bytes uncompressed: x.a||x.b||y.a||y.b in big-endian)

**Returns:** `true` if the pairing check `e(U, pkG2) == e(Y, G2_BASE)` passes

**Implementation Details:**
- Uses the product-of-pairings approach: `e(U, pkG2) * e(-Y, G2_BASE) == 1`
- Negates the Y point by computing `(x, p - y)` where `p` is the BN254 field modulus
- Calls the pairing precompile with 384 bytes of input (2 pairs × 192 bytes per pair)

### verifyDeckInclusion

```solidity
function verifyDeckInclusion(
    bytes32 rootB,
    uint256 index,
    bytes32 L,
    bytes memory Y,
    bytes32[] memory proof
) internal pure returns (bool)
```

Verifies inclusion of a deck element in a Merkle tree.

**Parameters:**
- `rootB`: Merkle root for the deck
- `index`: Card index
- `L`: Commitment value (32 bytes)
- `Y`: G1 point (64 bytes)
- `proof`: Array of sibling hashes for Merkle proof

**Returns:** `true` if the inclusion proof is valid

**Implementation Details:**
- Computes leaf hash as `keccak256("Bdeck" || index || L || Y)`
- Uses standard binary Merkle tree verification

### verifyAmapInclusion

```solidity
function verifyAmapInclusion(
    bytes32 rootA,
    uint8 cardId,
    bytes memory R,
    bytes32[] memory proof
) internal pure returns (bool)
```

Verifies inclusion of an A-map element in a Merkle tree.

**Parameters:**
- `rootA`: Merkle root for the A-map
- `cardId`: Card identifier (typically 0-51)
- `R`: G1 point (64 bytes)
- `proof`: Array of sibling hashes for Merkle proof

**Returns:** `true` if the inclusion proof is valid

**Implementation Details:**
- Computes leaf hash as `keccak256("Amap" || cardId || R)`
- Uses standard binary Merkle tree verification

### isG1OnCurve

```solidity
function isG1OnCurve(bytes memory p) internal pure returns (bool)
```

Checks if a G1 point lies on the BN254 curve.

**Parameters:**
- `p`: G1 point (64 bytes uncompressed: x||y in big-endian)

**Returns:** `true` if the point satisfies `y^2 = x^3 + 3 (mod p)`

**Implementation Details:**
- Accepts the point at infinity `(0, 0)` as valid
- Validates coordinates are within the field modulus
- Verifies the BN254 curve equation

### isInfinity

```solidity
function isInfinity(bytes memory p) internal pure returns (bool)
```

Checks if a G1 point is the point at infinity.

**Parameters:**
- `p`: G1 point (64 bytes uncompressed: x||y in big-endian)

**Returns:** `true` if the point is `(0, 0)`

## Format Specifications

### G1 Points (64 bytes)
- Uncompressed format: `x || y`
- Each coordinate: 32 bytes, big-endian
- Example: BN254 generator `(1, 2)`

### G2 Points (128 bytes)
- Uncompressed format: `x.a || x.b || y.a || y.b`
- EVM format: imaginary part first, then real part
- Each component: 32 bytes, big-endian
- Total: 4 × 32 = 128 bytes

### Pairing Precompile (0x08)
- Input: Multiple pairs of (G1, G2) points
- Format per pair: G1 (64 bytes) || G2 (128 bytes) = 192 bytes
- Output: Single uint256 (1 if pairing product equals identity, 0 otherwise)

## Usage Example

```solidity
import "./Bn254.sol";

contract MyContract {
    using Bn254 for *;

    function checkPartialDecrypt(
        bytes memory U,
        bytes memory Y,
        bytes memory pkG2
    ) public view returns (bool) {
        // Verify curve membership
        require(Bn254.isG1OnCurve(U), "U not on curve");
        require(Bn254.isG1OnCurve(Y), "Y not on curve");
        require(!Bn254.isInfinity(U), "U is infinity");
        require(!Bn254.isInfinity(Y), "Y is infinity");
        
        // Verify partial decryption
        return Bn254.verifyPartialDecrypt(U, Y, pkG2);
    }
}
```

## Testing

The library includes comprehensive tests in `test/crypto/bn254.test.js` that demonstrate:

1. **Pairing Verification**: Tests that valid BN254 pairing inputs pass verification
2. **Merkle Inclusion**: Tests for both deck and A-map Merkle proofs
3. **Curve Checks**: Validates `isG1OnCurve` and `isInfinity` functions
4. **EIP-712 Integration**: Demonstrates signature recovery works with the existing EIP-712 infrastructure

## Security Considerations

- All inputs are validated for correct sizes
- The library uses `internal` functions to prevent external calls
- No state is stored, making the library stateless and safe for library use
- The pairing precompile is called with `staticcall` to prevent state changes
- Points are validated for curve membership before cryptographic operations

## BN254 Curve Parameters

- Field modulus: `p = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47`
- Curve equation: `y^2 = x^3 + 3`
- Curve order: ~254 bits
- Used in zkSNARKs (Groth16, etc.)
