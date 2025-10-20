import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("CardVerifier", function () {
    let contract;

    // BN254 G1 generator: (1, 2)
    const G1 = ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(1n), 32),
        ethers.zeroPadValue(ethers.toBeHex(2n), 32)
    ]);

    // BN254 G2 generator (uncompressed, 128 bytes)
    const G2 = ethers.concat([
        "0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2",
        "0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed",
        "0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b",
        "0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"
    ]);

    // A different valid G1 point for testing
    const twoG1 = ethers.concat([
        "0x030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd3",
        "0x15ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4"
    ]);

    beforeEach(async function () {
        const CardVerifierTest = await ethers.getContractFactory("CardVerifierTest");
        contract = await CardVerifierTest.deploy();
    });

    describe("verifyHoleA", function () {
        it("should verify valid hole cards for player A", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = G1;
            const pkB = G2;

            const result = await contract.verifyHoleA(
                pkB,
                card1Encrypted,
                card1Opener,
                card2Encrypted,
                card2Opener
            );
            expect(result).to.be.true;
        });

        it("should reject invalid first hole card", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = twoG1; // Different point
            const card2Opener = G1;
            const pkB = G2;

            const result = await contract.verifyHoleA(
                pkB,
                card1Encrypted,
                card1Opener,
                card2Encrypted,
                card2Opener
            );
            expect(result).to.be.false;
        });

        it("should reject invalid second hole card", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = twoG1; // Different point
            const pkB = G2;

            const result = await contract.verifyHoleA(
                pkB,
                card1Encrypted,
                card1Opener,
                card2Encrypted,
                card2Opener
            );
            expect(result).to.be.false;
        });

        it("should revert if card1Encrypted has invalid length", async function () {
            const card1Encrypted = ethers.zeroPadValue("0x01", 32); // Only 32 bytes
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = G1;
            const pkB = G2;

            await expect(
                contract.verifyHoleA(
                    pkB,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card1Encrypted must be 64 bytes");
        });

        it("should revert if card1Opener has invalid length", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = ethers.zeroPadValue("0x01", 32); // Only 32 bytes
            const card2Opener = G1;
            const pkB = G2;

            await expect(
                contract.verifyHoleA(
                    pkB,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card1Opener must be 64 bytes");
        });

        it("should revert if card2Opener has invalid length", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = ethers.zeroPadValue("0x01", 32); // Only 32 bytes
            const pkB = G2;

            await expect(
                contract.verifyHoleA(
                    pkB,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card2Opener must be 64 bytes");
        });

        it("should revert if card2Encrypted has invalid length", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = ethers.zeroPadValue("0x01", 32); // Only 32 bytes
            const card1Opener = G1;
            const card2Opener = G1;
            const pkB = G2;

            await expect(
                contract.verifyHoleA(
                    pkB,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card2Encrypted must be 64 bytes");
        });
    });

    describe("verifyHoleB", function () {
        it("should verify valid hole cards for player B", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = G1;
            const pkA = G2;

            const result = await contract.verifyHoleB(
                pkA,
                card1Encrypted,
                card1Opener,
                card2Encrypted,
                card2Opener
            );
            expect(result).to.be.true;
        });

        it("should reject invalid first hole card", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = twoG1; // Different point
            const card2Opener = G1;
            const pkA = G2;

            const result = await contract.verifyHoleB(
                pkA,
                card1Encrypted,
                card1Opener,
                card2Encrypted,
                card2Opener
            );
            expect(result).to.be.false;
        });

        it("should reject invalid second hole card", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = twoG1; // Different point
            const pkA = G2;

            const result = await contract.verifyHoleB(
                pkA,
                card1Encrypted,
                card1Opener,
                card2Encrypted,
                card2Opener
            );
            expect(result).to.be.false;
        });

        it("should revert if card1Encrypted has invalid length", async function () {
            const card1Encrypted = ethers.zeroPadValue("0x01", 32);
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = G1;
            const pkA = G2;

            await expect(
                contract.verifyHoleB(
                    pkA,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card1Encrypted must be 64 bytes");
        });

        it("should revert if card1Opener has invalid length", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = ethers.zeroPadValue("0x01", 32);
            const card2Opener = G1;
            const pkA = G2;

            await expect(
                contract.verifyHoleB(
                    pkA,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card1Opener must be 64 bytes");
        });

        it("should revert if card2Opener has invalid length", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = G1;
            const card1Opener = G1;
            const card2Opener = ethers.zeroPadValue("0x01", 32);
            const pkA = G2;

            await expect(
                contract.verifyHoleB(
                    pkA,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card2Opener must be 64 bytes");
        });

        it("should revert if card2Encrypted has invalid length", async function () {
            const card1Encrypted = G1;
            const card2Encrypted = ethers.zeroPadValue("0x01", 32);
            const card1Opener = G1;
            const card2Opener = G1;
            const pkA = G2;

            await expect(
                contract.verifyHoleB(
                    pkA,
                    card1Encrypted,
                    card1Opener,
                    card2Encrypted,
                    card2Opener
                )
            ).to.be.revertedWith("card2Encrypted must be 64 bytes");
        });
    });

    describe("verifyPublic", function () {
        it("should verify valid public card", async function () {
            const cardEncrypted = G1;
            const cardAOpener = G1;
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyPublic(
                pkA,
                pkB,
                cardEncrypted,
                cardAOpener,
                cardBOpener
            );
            expect(result).to.be.true;
        });

        it("should reject invalid card from A", async function () {
            const cardEncrypted = G1;
            const cardAOpener = twoG1; // Different point
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyPublic(
                pkA,
                pkB,
                cardEncrypted,
                cardAOpener,
                cardBOpener
            );
            expect(result).to.be.false;
        });

        it("should reject invalid card from B", async function () {
            const cardEncrypted = G1;
            const cardAOpener = G1;
            const cardBOpener = twoG1; // Different point
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyPublic(
                pkA,
                pkB,
                cardEncrypted,
                cardAOpener,
                cardBOpener
            );
            expect(result).to.be.false;
        });

        it("should revert if cardAOpener has invalid length", async function () {
            const cardEncrypted = G1;
            const cardAOpener = ethers.zeroPadValue("0x01", 32);
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyPublic(
                    pkA,
                    pkB,
                    cardEncrypted,
                    cardAOpener,
                    cardBOpener
                )
            ).to.be.revertedWith("cardAOpener must be 64 bytes");
        });

        it("should revert if cardBOpener has invalid length", async function () {
            const cardEncrypted = G1;
            const cardAOpener = G1;
            const cardBOpener = ethers.zeroPadValue("0x01", 32);
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyPublic(
                    pkA,
                    pkB,
                    cardEncrypted,
                    cardAOpener,
                    cardBOpener
                )
            ).to.be.revertedWith("cardBOpener must be 64 bytes");
        });

        it("should revert if cardEncrypted has invalid length", async function () {
            const cardEncrypted = ethers.zeroPadValue("0x01", 32);
            const cardAOpener = G1;
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyPublic(
                    pkA,
                    pkB,
                    cardEncrypted,
                    cardAOpener,
                    cardBOpener
                )
            ).to.be.revertedWith("cardEncrypted must be 64 bytes");
        });
    });
});
