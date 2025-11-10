import { expect } from "chai";
import hre from "hardhat";
import { bn254 } from "@noble/curves/bn254.js";
import { hashToG1, randomScalar, g1ToBytes, g2ToBytes } from "../helpers/bn254.js";

const { ethers } = hre;

describe("Partial Decryption", function () {
    let contract;
    const Fr = bn254.fields.Fr;
    const G2 = bn254.G2.Point;

    beforeEach(async function () {
        const Bn254Test = await ethers.getContractFactory("Bn254Test");
        contract = await Bn254Test.deploy();
    });

    describe("B helps A decrypt", function () {
        it("should verify partial decryption when B helps A", async function () {
            // Step 1: Pick random per-hand scalars a and b
            const a = randomScalar();
            const b = randomScalar();

            // Step 2: Derive public keys in G2
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
            const publicKeyB = g2ToBytes(pkB_G2);

            // This should verify that e(U, pkB_G2) == e(Y, G2_BASE)
            const verified = await contract.verifyPartialDecrypt(
                U_bytes,
                Y_bytes,
                publicKeyB
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
                const publicKeyB = g2ToBytes(pkB_G2);

                const verified = await contract.verifyPartialDecrypt(
                    U_bytes,
                    Y_bytes,
                    publicKeyB
                );

                expect(verified).to.be.true;

                const a_inv = Fr.inv(a);
                const R_prime = U.multiply(a_inv);
                expect(R_prime.equals(R)).to.be.true;
            }
        });
    });

    describe("A helps B decrypt", function () {
        it("should verify partial decryption when A helps B", async function () {
            // Step 1: Pick random per-hand scalars a and b
            const a = randomScalar();
            const b = randomScalar();

            // Step 2: Derive public keys in G2
            const pkA_G2 = G2.BASE.multiply(a);

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
            const publicKeyA = g2ToBytes(pkA_G2);

            // This should verify that e(U, pkA_G2) == e(Y, G2_BASE)
            const verified = await contract.verifyPartialDecrypt(
                U_bytes,
                Y_bytes,
                publicKeyA
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

            const context = "edge_case_test";
            const cardIndex = 0;
            const R = hashToG1(context, cardIndex);

            const aR = R.multiply(a);  // Should be R itself
            const Y = aR.multiply(b);

            const a_inv = Fr.inv(a);  // Should be 1
            const U = Y.multiply(a_inv);

            const U_bytes = g1ToBytes(U);
            const Y_bytes = g1ToBytes(Y);
            const publicKeyA = g2ToBytes(pkA_G2);

            const verified = await contract.verifyPartialDecrypt(
                U_bytes,
                Y_bytes,
                publicKeyA
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
            const publicKeyA = g2ToBytes(pkA_G2);
            const publicKeyB = g2ToBytes(pkB_G2);

            // Verify A's partial decryption
            const verifiedA = await contract.verifyPartialDecrypt(
                U_A_bytes,
                Y_bytes,
                publicKeyA
            );

            // Verify B's partial decryption
            const verifiedB = await contract.verifyPartialDecrypt(
                U_B_bytes,
                Y_bytes,
                publicKeyB
            );

            expect(verifiedA).to.be.true;
            expect(verifiedB).to.be.true;

            // Step 7: Each player can finish the decryption
            // B finishes: R' = b^(-1)·U_A
            const R_from_A = U_A.multiply(b_inv);
            expect(R_from_A.equals(R)).to.be.true;

            // A finishes: R' = a^(-1)·U_B
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
            const publicKeyB = g2ToBytes(pkB_G2);

            const verified = await contract.verifyPartialDecrypt(
                U_wrong_bytes,
                Y_bytes,
                publicKeyB
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
            const publicKeyA = g2ToBytes(pkA_G2);

            const verified = await contract.verifyPartialDecrypt(
                U_wrong_bytes,
                Y_bytes,
                publicKeyA
            );

            expect(verified).to.be.false;
        });
    });
});
