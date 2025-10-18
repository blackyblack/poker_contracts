import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

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

    describe("verifyDeckInclusion", function () {
        it("verifies valid Merkle proof for deck leaf", async function () {
            // Build a simple 4-leaf Merkle tree for deck
            const index = 2n;
            const L = ethers.keccak256(ethers.toUtf8Bytes("commitment_L"));
            
            // Y is a dummy G1 point (using generator for simplicity)
            const Y = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            // Compute leaf: keccak256("Bdeck" || index || L || Y)
            const leaf2 = ethers.keccak256(
                ethers.concat([
                    ethers.toUtf8Bytes("Bdeck"),
                    ethers.zeroPadValue(ethers.toBeHex(index), 32),
                    L,
                    Y
                ])
            );
            
            // Create dummy siblings for a 4-leaf tree (index 2)
            // Tree structure:
            //        root
            //       /    \
            //     h01    h23
            //    /  \    /  \
            //  l0  l1  l2  l3
            
            // For leaf at index 2, we need: sibling l3, then sibling h01
            const leaf3 = ethers.keccak256(ethers.toUtf8Bytes("leaf3"));
            const h23 = ethers.keccak256(ethers.concat([leaf2, leaf3]));
            
            const leaf0 = ethers.keccak256(ethers.toUtf8Bytes("leaf0"));
            const leaf1 = ethers.keccak256(ethers.toUtf8Bytes("leaf1"));
            const h01 = ethers.keccak256(ethers.concat([leaf0, leaf1]));
            
            const root = ethers.keccak256(ethers.concat([h01, h23]));
            
            const proof = [leaf3, h01];
            
            const result = await contract.verifyDeckInclusion(root, index, L, Y, proof);
            expect(result).to.be.true;
        });

        it("rejects invalid proof", async function () {
            const index = 0n;
            const L = ethers.keccak256(ethers.toUtf8Bytes("commitment_L"));
            const Y = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            const leaf = ethers.keccak256(
                ethers.concat([
                    ethers.toUtf8Bytes("Bdeck"),
                    ethers.zeroPadValue(ethers.toBeHex(index), 32),
                    L,
                    Y
                ])
            );
            
            const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes("wrong_root"));
            const proof = [ethers.keccak256(ethers.toUtf8Bytes("sibling"))];
            
            const result = await contract.verifyDeckInclusion(wrongRoot, index, L, Y, proof);
            expect(result).to.be.false;
        });
    });

    describe("verifyAmapInclusion", function () {
        it("verifies valid Merkle proof for A-map leaf", async function () {
            const cardId = 5;
            
            // R is a dummy G1 point
            const R = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            // Compute leaf: keccak256("Amap" || cardId || R)
            const leaf5 = ethers.keccak256(
                ethers.concat([
                    ethers.toUtf8Bytes("Amap"),
                    ethers.zeroPadValue(ethers.toBeHex(cardId), 1),
                    R
                ])
            );
            
            // Build a simple 8-leaf tree, cardId 5 is at index 5
            // For index 5 (binary: 101), path is: right, left, right
            // Need siblings: [4], [6,7 parent], [0-3 parent]
            
            const leaf4 = ethers.keccak256(ethers.toUtf8Bytes("leaf4"));
            const h45 = ethers.keccak256(ethers.concat([leaf4, leaf5]));
            
            const leaf6 = ethers.keccak256(ethers.toUtf8Bytes("leaf6"));
            const leaf7 = ethers.keccak256(ethers.toUtf8Bytes("leaf7"));
            const h67 = ethers.keccak256(ethers.concat([leaf6, leaf7]));
            
            const h47 = ethers.keccak256(ethers.concat([h45, h67]));
            
            const leaf0 = ethers.keccak256(ethers.toUtf8Bytes("leaf0"));
            const leaf1 = ethers.keccak256(ethers.toUtf8Bytes("leaf1"));
            const h01 = ethers.keccak256(ethers.concat([leaf0, leaf1]));
            
            const leaf2 = ethers.keccak256(ethers.toUtf8Bytes("leaf2"));
            const leaf3 = ethers.keccak256(ethers.toUtf8Bytes("leaf3"));
            const h23 = ethers.keccak256(ethers.concat([leaf2, leaf3]));
            
            const h03 = ethers.keccak256(ethers.concat([h01, h23]));
            
            const root = ethers.keccak256(ethers.concat([h03, h47]));
            
            const proof = [leaf4, h67, h03];
            
            const result = await contract.verifyAmapInclusion(root, cardId, R, proof);
            expect(result).to.be.true;
        });

        it("rejects invalid proof", async function () {
            const cardId = 0;
            const R = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes("wrong_root"));
            const proof = [ethers.keccak256(ethers.toUtf8Bytes("sibling"))];
            
            const result = await contract.verifyAmapInclusion(wrongRoot, cardId, R, proof);
            expect(result).to.be.false;
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
            // x = (10857046999023057135944570762232829481370756359578518086990519993285655852781,
            //      11559732032986387107991004021392285783925812861821192530917403151452391805634)
            // y = (8495653923123431417604973247489272438418190587263600148770280649306958101930,
            //      4082367875863433681332203403145435568316851327593401208105741076214120093531)
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

        it("rejects invalid sizes", async function () {
            const shortU = ethers.zeroPadValue("0x01", 32);
            const G1 = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            const G2 = ethers.concat([
                "0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2",
                "0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed",
                "0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b",
                "0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"
            ]);
            
            await expect(
                contract.verifyPartialDecrypt(shortU, G1, G2)
            ).to.be.revertedWith("U must be 64 bytes");
        });
    });
});
