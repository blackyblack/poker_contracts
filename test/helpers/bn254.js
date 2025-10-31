import { ethers } from "ethers";
import { bn254 } from "@noble/curves/bn254.js";

const Fr = bn254.fields.Fr;
const G1 = bn254.G1.Point;

/**
 * Hash a context and index to a G1 point deterministically
 */
export function hashToG1(context, index) {
    // Create a deterministic hash from context and index
    const hash = ethers.keccak256(
        ethers.solidityPacked(["string", "uint256"], [context, index])
    );

    // Use the hash as a scalar to multiply the generator
    const scalar = BigInt(hash) % Fr.ORDER;
    const point = G1.BASE.multiply(scalar);

    return point;
}

/**
 * Generate a random scalar in the Fr field
 * Ensures the scalar is non-zero by returning 1 as a fallback.
 * In the context of elliptic curve operations, scalar 1 is cryptographically
 * safe as it represents the identity operation (point · 1 = point).
 */
export function randomScalar() {
    const randomBytes = ethers.randomBytes(32);
    const scalar = BigInt(ethers.hexlify(randomBytes)) % Fr.ORDER;
    // Ensure we don't get 0 (probability: 1/Fr.ORDER ≈ 0)
    return scalar === 0n ? 1n : scalar;
}

/**
 * Convert a G1 point to bytes for Solidity (64 bytes: x||y)
 */
export function g1ToBytes(point) {
    const affine = point.toAffine();
    return ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(affine.x), 32),
        ethers.zeroPadValue(ethers.toBeHex(affine.y), 32)
    ]);
}

/**
 * Convert a G2 point to bytes for Solidity (128 bytes: x.a||x.b||y.a||y.b)
 * EVM format: [x_imaginary, x_real, y_imaginary, y_real]
 */
export function g2ToBytes(point) {
    const affine = point.toAffine();
    return ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(affine.x.c1), 32), // x imaginary
        ethers.zeroPadValue(ethers.toBeHex(affine.x.c0), 32), // x real
        ethers.zeroPadValue(ethers.toBeHex(affine.y.c1), 32), // y imaginary
        ethers.zeroPadValue(ethers.toBeHex(affine.y.c0), 32)  // y real
    ]);
}
