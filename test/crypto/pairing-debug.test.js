import { expect } from "chai";
import hre from "hardhat";
import {
    generateSecretKey,
    pubkeyG2,
    hashToG1CardBase,
    unwrapInverse,
    g1PointToBytes,
    g2PointToBytes
} from "../helpers/bn254-crypto.js";

const { ethers } = hre;

describe("Pairing Verification Debug", function () {
    let contract;

    beforeEach(async function () {
        const Bn254Test = await ethers.getContractFactory("Bn254Test");
        contract = await Bn254Test.deploy();
    });

    it("should verify correct unwrapping with pairing check", async function () {
        const sk = generateSecretKey();
        const pk = pubkeyG2(sk);
        
        // Create a test point
        const U = hashToG1CardBase("test", 0);
        
        // "Unwrap" means multiply by sk^{-1}
        const Y = unwrapInverse(U, sk);
        
        // Convert to bytes
        const UBytes = g1PointToBytes(U);
        const YBytes = g1PointToBytes(Y);
        const pkBytes = g2PointToBytes(pk);
        
        console.log('Testing pairing check: e(Y, pk) == e(U, G2)');
        console.log('This verifies Y = sk^{-1} · U');
        
        // The contract checks: e(U, pk) == e(Y, G2)
        // But we want to check: e(Y, pk) == e(U, G2)
        // These are NOT the same!
        
        // Let's test what the contract actually checks
        const result = await contract.verifyPartialDecrypt(UBytes, YBytes, pkBytes);
        
        console.log('Result:', result);
        console.log('U:', UBytes.substring(0, 20));
        console.log('Y:', YBytes.substring(0, 20));
        
        // The contract checks e(U, pk) == e(Y, G2)
        // If Y = sk^{-1} · U, then:
        // e(U, sk·G2) vs e(sk^{-1}·U, G2)
        // e(U, G2)^sk vs e(U, G2)^{sk^{-1}}
        // These are NOT equal unless sk = sk^{-1}
        
        // So the verification will FAIL for correct unwrapping!
    });
});
