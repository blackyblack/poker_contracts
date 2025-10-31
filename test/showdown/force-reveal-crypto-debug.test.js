import { expect } from "chai";
import hre from "hardhat";
import { bn254 } from "@noble/curves/bn254.js";

import { hashToG1, randomScalar, g1ToBytes, g2ToBytes } from "../helpers/bn254.js";

const { ethers } = hre;

describe("Force Reveal - crypto debug", function () {
    let contract;
    const Fr = bn254.fields.Fr;
    const G2 = bn254.G2.Point;

    beforeEach(async function () {
        const Bn254Test = await ethers.getContractFactory("Bn254Test");
        contract = await Bn254Test.deploy();
    });

    it("verifies the crypto setup matches what contract expects", async function () {
        // Generate scalars
        const a = randomScalar();
        const b = randomScalar();
        
        // Derive public keys
        const pkA_G2 = G2.BASE.multiply(a);
        const pkB_G2 = G2.BASE.multiply(b);
        
        // Create an encrypted card
        const context = "test_poker_hand";
        const R = hashToG1(context, 0);
        const aR = R.multiply(a);
        const Y = aR.multiply(b);  // Fully encrypted: b·(a·R)
        
        // B helps A decrypt: compute U = b^(-1)·Y = a·R
        const b_inv = Fr.inv(b);
        const U = Y.multiply(b_inv);
        
        // Verify pairing: e(U, pkB_G2) == e(Y, G2_BASE)
        const U_bytes = g1ToBytes(U);
        const Y_bytes = g1ToBytes(Y);
        const pkB_G2_bytes = g2ToBytes(pkB_G2);
        
        const verified = await contract.verifyPartialDecrypt(
            U_bytes,
            Y_bytes,
            pkB_G2_bytes
        );
        
        expect(verified).to.be.true;
        
        // Check that U is on curve and not infinity
        const uOnCurve = await contract.isG1OnCurve(U_bytes);
        const uInfinity = await contract.isInfinity(U_bytes);
        expect(uOnCurve).to.be.true;
        expect(uInfinity).to.be.false;
        
        // Check that Y is on curve and not infinity
        const yOnCurve = await contract.isG1OnCurve(Y_bytes);
        const yInfinity = await contract.isInfinity(Y_bytes);
        expect(yOnCurve).to.be.true;
        expect(yInfinity).to.be.false;
    });
});
