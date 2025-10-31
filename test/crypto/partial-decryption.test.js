import { expect } from "chai";
import hre from "hardhat";
import { bn254 } from "@noble/curves/bn254.js";

const { ethers } = hre;

describe("Partial Decryption Tests", function () {
    let contract;
    const Fr = bn254.fields.Fr;
    const G1 = bn254.G1.Point;
    const G2 = bn254.G2.Point;

    beforeEach(async function () {
        const Bn254Test = await ethers.getContractFactory("Bn254Test");
        contract = await Bn254Test.deploy();
    });

    /**
     * Hash a context and index to a G1 point deterministically
     * This simulates HashToG1(ctx, k) from the problem statement
     */
    function hashToG1(context, index) {
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
     */
    function randomScalar() {
        const randomBytes = ethers.randomBytes(32);
        const scalar = BigInt(ethers.hexlify(randomBytes)) % Fr.ORDER;
        // Ensure we don't get 0
        return scalar === 0n ? 1n : scalar;
    }

    /**
     * Convert a G1 point to bytes for Solidity (64 bytes: x||y)
     */
    function g1ToBytes(point) {
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
    function g2ToBytes(point) {
        const affine = point.toAffine();
        return ethers.concat([
            ethers.zeroPadValue(ethers.toBeHex(affine.x.c1), 32), // x imaginary
            ethers.zeroPadValue(ethers.toBeHex(affine.x.c0), 32), // x real
            ethers.zeroPadValue(ethers.toBeHex(affine.y.c1), 32), // y imaginary
            ethers.zeroPadValue(ethers.toBeHex(affine.y.c0), 32)  // y real
        ]);
    }

    describe("Case: B helps A decrypt", function () {
        it("should verify partial decryption when B helps A", async function () {
            // Step 1: Pick random per-hand scalars a and b
            const a = randomScalar();
            const b = randomScalar();

            // Step 2: Derive public keys in G2
            const pkA_G2 = G2.BASE.multiply(a);
            const pkB_G2 = G2.BASE.multiply(b);

            // Step 3: Pick R = HashToG1(ctx, k)
            const context = "poker_hand_12345";
            const cardIndex = 0;
            const R = hashToG1(context, cardIndex);

            // Step 4: Build Y = b·(a·R)
            const aR = R.multiply(a);  // a·R
            const Y = aR.multiply(b);   // b·(a·R)

            // Step 5: B helps A - compute U = b^(-1)·Y
            const b_inv = Fr.inv(b);
            const U = Y.multiply(b_inv);

            // Step 6: Verify using CardVerifier.verifyPartialDecrypt
            const U_bytes = g1ToBytes(U);
            const Y_bytes = g1ToBytes(Y);
            const pkB_G2_bytes = g2ToBytes(pkB_G2);

            // This should verify that e(U, pkB_G2) == e(Y, G2_BASE)
            // Which means e(b^(-1)·Y, b·G2) == e(Y, G2)
            // Which simplifies to e(Y, G2) == e(Y, G2) ✓
            const verified = await contract.verifyPartialDecrypt(
                U_bytes,
                Y_bytes,
                pkB_G2_bytes
            );

            expect(verified).to.be.true;

            // Step 7: Finish locally - compute R' = a^(-1)·U
            const a_inv = Fr.inv(a);
            const R_prime = U.multiply(a_inv);

            // Step 8: Assert R' == R
            expect(R_prime.equals(R)).to.be.true;
        });

        it("should handle multiple cards with different scalars", async function () {
            // Test with different scalars for robustness
            const a = randomScalar();
            const b = randomScalar();

            const pkA_G2 = G2.BASE.multiply(a);
            const pkB_G2 = G2.BASE.multiply(b);

            const context = "poker_hand_67890";
            
            // Test with multiple card indices
            for (let cardIndex = 0; cardIndex < 3; cardIndex++) {
                const R = hashToG1(context, cardIndex);
                const aR = R.multiply(a);
                const Y = aR.multiply(b);
                const b_inv = Fr.inv(b);
                const U = Y.multiply(b_inv);

                const U_bytes = g1ToBytes(U);
                const Y_bytes = g1ToBytes(Y);
                const pkB_G2_bytes = g2ToBytes(pkB_G2);

                const verified = await contract.verifyPartialDecrypt(
                    U_bytes,
                    Y_bytes,
                    pkB_G2_bytes
                );

                expect(verified).to.be.true;

                const a_inv = Fr.inv(a);
                const R_prime = U.multiply(a_inv);
                expect(R_prime.equals(R)).to.be.true;
            }
        });
    });

    describe("Case: A helps B decrypt", function () {
        it("should verify partial decryption when A helps B", async function () {
            // Step 1: Pick random per-hand scalars a and b
            const a = randomScalar();
            const b = randomScalar();

            // Step 2: Derive public keys in G2
            const pkA_G2 = G2.BASE.multiply(a);
            const pkB_G2 = G2.BASE.multiply(b);

            // Step 3: Pick R = HashToG1(ctx, k)
            const context = "poker_hand_symmetric";
            const cardIndex = 2;
            const R = hashToG1(context, cardIndex);

            // Step 4: Build Y = b·(a·R) (same as before)
            const aR = R.multiply(a);
            const Y = aR.multiply(b);

            // Step 5: A helps B - compute U = a^(-1)·Y
            const a_inv = Fr.inv(a);
            const U = Y.multiply(a_inv);

            // Step 6: Verify using CardVerifier.verifyPartialDecrypt
            const U_bytes = g1ToBytes(U);
            const Y_bytes = g1ToBytes(Y);
            const pkA_G2_bytes = g2ToBytes(pkA_G2);

            // This should verify that e(U, pkA_G2) == e(Y, G2_BASE)
            // Which means e(a^(-1)·Y, a·G2) == e(Y, G2)
            // Which simplifies to e(Y, G2) == e(Y, G2) ✓
            const verified = await contract.verifyPartialDecrypt(
                U_bytes,
                Y_bytes,
                pkA_G2_bytes
            );

            expect(verified).to.be.true;

            // Step 7: Finish locally - compute R' = b^(-1)·U
            const b_inv = Fr.inv(b);
            const R_prime = U.multiply(b_inv);

            // Step 8: Assert R' == R
            expect(R_prime.equals(R)).to.be.true;
        });

        it("should handle edge cases with scalar 1", async function () {
            // Test with a = 1 (edge case)
            const a = 1n;
            const b = randomScalar();

            const pkA_G2 = G2.BASE.multiply(a);
            const pkB_G2 = G2.BASE.multiply(b);

            const context = "edge_case_test";
            const cardIndex = 0;
            const R = hashToG1(context, cardIndex);

            const aR = R.multiply(a);  // Should be R itself
            const Y = aR.multiply(b);

            const a_inv = Fr.inv(a);  // Should be 1
            const U = Y.multiply(a_inv);

            const U_bytes = g1ToBytes(U);
            const Y_bytes = g1ToBytes(Y);
            const pkA_G2_bytes = g2ToBytes(pkA_G2);

            const verified = await contract.verifyPartialDecrypt(
                U_bytes,
                Y_bytes,
                pkA_G2_bytes
            );

            expect(verified).to.be.true;

            const b_inv = Fr.inv(b);
            const R_prime = U.multiply(b_inv);
            expect(R_prime.equals(R)).to.be.true;
        });
    });

    describe("Symmetric verification - both players decrypt public cards", function () {
        it("should verify when both players provide correct partial decryptions", async function () {
            // Step 1: Pick random per-hand scalars a and b
            const a = randomScalar();
            const b = randomScalar();

            // Step 2: Derive public keys in G2
            const pkA_G2 = G2.BASE.multiply(a);
            const pkB_G2 = G2.BASE.multiply(b);

            // Step 3: Pick R = HashToG1(ctx, k)
            const context = "public_card_flop";
            const cardIndex = 4; // First flop card
            const R = hashToG1(context, cardIndex);

            // Step 4: Build Y = b·(a·R)
            const aR = R.multiply(a);
            const Y = aR.multiply(b);

            // Step 5: Both players provide partial decryptions
            // A provides: U_A = a^(-1)·Y
            const a_inv = Fr.inv(a);
            const U_A = Y.multiply(a_inv);

            // B provides: U_B = b^(-1)·Y
            const b_inv = Fr.inv(b);
            const U_B = Y.multiply(b_inv);

            // Step 6: Verify both partial decryptions
            const Y_bytes = g1ToBytes(Y);
            const U_A_bytes = g1ToBytes(U_A);
            const U_B_bytes = g1ToBytes(U_B);
            const pkA_G2_bytes = g2ToBytes(pkA_G2);
            const pkB_G2_bytes = g2ToBytes(pkB_G2);

            // Verify A's partial decryption
            const verifiedA = await contract.verifyPartialDecrypt(
                U_A_bytes,
                Y_bytes,
                pkA_G2_bytes
            );

            // Verify B's partial decryption
            const verifiedB = await contract.verifyPartialDecrypt(
                U_B_bytes,
                Y_bytes,
                pkB_G2_bytes
            );

            expect(verifiedA).to.be.true;
            expect(verifiedB).to.be.true;

            // Step 7: Each player can finish the decryption
            // A finishes: R' = b^(-1)·U_A
            const R_from_A = U_A.multiply(b_inv);
            expect(R_from_A.equals(R)).to.be.true;

            // B finishes: R' = a^(-1)·U_B
            const R_from_B = U_B.multiply(a_inv);
            expect(R_from_B.equals(R)).to.be.true;
        });
    });

    describe("Negative tests - invalid partial decryptions", function () {
        it("should reject when B provides wrong partial decryption", async function () {
            const a = randomScalar();
            const b = randomScalar();
            const wrong_scalar = randomScalar();

            const pkB_G2 = G2.BASE.multiply(b);

            const context = "test_invalid";
            const R = hashToG1(context, 0);
            const aR = R.multiply(a);
            const Y = aR.multiply(b);

            // B provides wrong U (using wrong_scalar instead of b^(-1))
            const wrong_inv = Fr.inv(wrong_scalar);
            const U_wrong = Y.multiply(wrong_inv);

            const U_wrong_bytes = g1ToBytes(U_wrong);
            const Y_bytes = g1ToBytes(Y);
            const pkB_G2_bytes = g2ToBytes(pkB_G2);

            const verified = await contract.verifyPartialDecrypt(
                U_wrong_bytes,
                Y_bytes,
                pkB_G2_bytes
            );

            expect(verified).to.be.false;
        });

        it("should reject when A provides wrong partial decryption", async function () {
            const a = randomScalar();
            const b = randomScalar();
            const wrong_scalar = randomScalar();

            const pkA_G2 = G2.BASE.multiply(a);

            const context = "test_invalid_A";
            const R = hashToG1(context, 1);
            const aR = R.multiply(a);
            const Y = aR.multiply(b);

            // A provides wrong U
            const wrong_inv = Fr.inv(wrong_scalar);
            const U_wrong = Y.multiply(wrong_inv);

            const U_wrong_bytes = g1ToBytes(U_wrong);
            const Y_bytes = g1ToBytes(Y);
            const pkA_G2_bytes = g2ToBytes(pkA_G2);

            const verified = await contract.verifyPartialDecrypt(
                U_wrong_bytes,
                Y_bytes,
                pkA_G2_bytes
            );

            expect(verified).to.be.false;
        });
    });
});
