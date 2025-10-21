import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

describe("Bn254", function () {
    let contract;

    beforeEach(async function () {
        const Bn254Test = await ethers.getContractFactory("Bn254Test");
        contract = await Bn254Test.deploy();
    });

    describe("isG1OnCurve", function () {
        it("accepts BN254 generator point", async function () {
            // BN254 G1 generator: (1, 2)
            const g1 = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            expect(await contract.isG1OnCurve(g1)).to.be.true;
        });

        it("accepts point at infinity", async function () {
            const infinity = ethers.concat([
                ethers.ZeroHash,
                ethers.ZeroHash
            ]);
            expect(await contract.isG1OnCurve(infinity)).to.be.true;
        });

        it("rejects point not on curve", async function () {
            // Random point (3, 4) which is not on BN254 curve
            const badPoint = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(3n), 32),
                ethers.zeroPadValue(ethers.toBeHex(4n), 32)
            ]);
            expect(await contract.isG1OnCurve(badPoint)).to.be.false;
        });

        it("rejects invalid length", async function () {
            const shortPoint = ethers.zeroPadValue("0x01", 32);
            expect(await contract.isG1OnCurve(shortPoint)).to.be.false;
        });
    });

    describe("isInfinity", function () {
        it("detects point at infinity", async function () {
            const infinity = ethers.concat([
                ethers.ZeroHash,
                ethers.ZeroHash
            ]);
            expect(await contract.isInfinity(infinity)).to.be.true;
        });

        it("rejects non-infinity point", async function () {
            const g1 = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            expect(await contract.isInfinity(g1)).to.be.false;
        });
    });

    describe("verifyPartialDecrypt", function () {
        it("verifies valid BN254 pairing for partial decryption", async function () {
            // For this test, we need valid BN254 pairing inputs
            // Using a known valid pairing: e(G1, G2) * e(-G1, G2) == 1
            // This simplifies to: e(G1, G2) == e(G1, G2), which should pass
            
            // BN254 G1 generator: (1, 2)
            const G1 = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            // BN254 G2 generator (uncompressed, 128 bytes)
            // EVM format: x.a||x.b||y.a||y.b (imaginary first, then real)
            const G2 = ethers.concat([
                // x.a (imaginary part of x)
                "0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2",
                // x.b (real part of x)
                "0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed",
                // y.a (imaginary part of y)
                "0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b",
                // y.b (real part of y)
                "0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"
            ]);
            
            // For a valid partial decrypt proof:
            // e(U, pkG2) == e(Y, G2_BASE)
            // We can use U = Y = G1 and pkG2 = G2 for a trivial valid case
            const U = G1;
            const Y = G1;
            const pkG2 = G2;
            
            const result = await contract.verifyPartialDecrypt(U, Y, pkG2);
            expect(result).to.be.true;
        });

        it("fails to verify incorrect partial decryption", async function () {
            // Create a scenario where the pairing check should fail
            // Use U = G1 generator, Y = 2*G1 (different point), pkG2 = G2
            // This will fail because e(G1, G2) != e(2*G1, G2_BASE)
            
            const G1 = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            // A different G1 point: 2*G1 = (x', y')
            // Using a valid BN254 point that's not the generator
            const twoG1 = ethers.concat([
                "0x030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd3",
                "0x15ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4"
            ]);
            
            const G2 = ethers.concat([
                "0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2",
                "0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed",
                "0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b",
                "0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"
            ]);
            
            const U = G1;
            const Y = twoG1;  // Different point
            const pkG2 = G2;
            
            const result = await contract.verifyPartialDecrypt(U, Y, pkG2);
            expect(result).to.be.false;
        });

        it("rejects invalid sizes", async function () {
            const shortU = ethers.zeroPadValue("0x01", 32);
            const G1 = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            const G2 = ethers.concat([
                // x.a (imaginary part of x)
                "0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2",
                // x.b (real part of x)
                "0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed",
                // y.a (imaginary part of y)
                "0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b",
                // y.b (real part of y)
                "0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"
            ]);
            
            await expect(
                contract.verifyPartialDecrypt(shortU, G1, G2)
            ).to.be.revertedWith("U must be 64 bytes");
        });
    });
});
