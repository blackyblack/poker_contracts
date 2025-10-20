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
            // Create a deck with at least 2 cards where verification should pass
            const bDeckSigned = [G1, G1];
            const card1Opener = G1;
            const card2Opener = G1;
            const pkB = G2;

            const result = await contract.verifyHoleA(pkB, bDeckSigned, card1Opener, card2Opener);
            expect(result).to.be.true;
        });

        it("should reject invalid first hole card", async function () {
            const bDeckSigned = [G1, G1];
            const card1Opener = twoG1; // Different point
            const card2Opener = G1;
            const pkB = G2;

            const result = await contract.verifyHoleA(pkB, bDeckSigned, card1Opener, card2Opener);
            expect(result).to.be.false;
        });

        it("should reject invalid second hole card", async function () {
            const bDeckSigned = [G1, G1];
            const card1Opener = G1;
            const card2Opener = twoG1; // Different point
            const pkB = G2;

            const result = await contract.verifyHoleA(pkB, bDeckSigned, card1Opener, card2Opener);
            expect(result).to.be.false;
        });

        it("should revert if deck has less than 2 cards", async function () {
            const bDeckSigned = [G1];
            const card1Opener = G1;
            const card2Opener = G1;
            const pkB = G2;

            await expect(
                contract.verifyHoleA(pkB, bDeckSigned, card1Opener, card2Opener)
            ).to.be.revertedWith("Deck must have at least 2 cards");
        });

        it("should revert if card1Opener has invalid length", async function () {
            const bDeckSigned = [G1, G1];
            const card1Opener = ethers.zeroPadValue("0x01", 32); // Only 32 bytes
            const card2Opener = G1;
            const pkB = G2;

            await expect(
                contract.verifyHoleA(pkB, bDeckSigned, card1Opener, card2Opener)
            ).to.be.revertedWith("card1Opener must be 64 bytes");
        });

        it("should revert if card2Opener has invalid length", async function () {
            const bDeckSigned = [G1, G1];
            const card1Opener = G1;
            const card2Opener = ethers.zeroPadValue("0x01", 32); // Only 32 bytes
            const pkB = G2;

            await expect(
                contract.verifyHoleA(pkB, bDeckSigned, card1Opener, card2Opener)
            ).to.be.revertedWith("card2Opener must be 64 bytes");
        });
    });

    describe("verifyHoleB", function () {
        it("should verify valid hole cards for player B", async function () {
            const bDeckSigned = [G1, G1, G1, G1];
            const card1Opener = G1;
            const card2Opener = G1;
            const pkA = G2;

            const result = await contract.verifyHoleB(pkA, bDeckSigned, card1Opener, card2Opener);
            expect(result).to.be.true;
        });

        it("should reject invalid first hole card", async function () {
            const bDeckSigned = [G1, G1, G1, G1];
            const card1Opener = twoG1; // Different point
            const card2Opener = G1;
            const pkA = G2;

            const result = await contract.verifyHoleB(pkA, bDeckSigned, card1Opener, card2Opener);
            expect(result).to.be.false;
        });

        it("should reject invalid second hole card", async function () {
            const bDeckSigned = [G1, G1, G1, G1];
            const card1Opener = G1;
            const card2Opener = twoG1; // Different point
            const pkA = G2;

            const result = await contract.verifyHoleB(pkA, bDeckSigned, card1Opener, card2Opener);
            expect(result).to.be.false;
        });

        it("should revert if deck has less than 4 cards", async function () {
            const bDeckSigned = [G1, G1, G1];
            const card1Opener = G1;
            const card2Opener = G1;
            const pkA = G2;

            await expect(
                contract.verifyHoleB(pkA, bDeckSigned, card1Opener, card2Opener)
            ).to.be.revertedWith("Deck must have at least 4 cards");
        });

        it("should revert if card1Opener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1];
            const card1Opener = ethers.zeroPadValue("0x01", 32);
            const card2Opener = G1;
            const pkA = G2;

            await expect(
                contract.verifyHoleB(pkA, bDeckSigned, card1Opener, card2Opener)
            ).to.be.revertedWith("card1Opener must be 64 bytes");
        });

        it("should revert if card2Opener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1];
            const card1Opener = G1;
            const card2Opener = ethers.zeroPadValue("0x01", 32);
            const pkA = G2;

            await expect(
                contract.verifyHoleB(pkA, bDeckSigned, card1Opener, card2Opener)
            ).to.be.revertedWith("card2Opener must be 64 bytes");
        });
    });

    describe("verifyFlop", function () {
        it("should verify valid flop cards", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [G1, G1, G1];
            const cardBOpeners = [G1, G1, G1];
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners);
            expect(result).to.be.true;
        });

        it("should reject invalid first flop card from A", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [twoG1, G1, G1]; // First card invalid
            const cardBOpeners = [G1, G1, G1];
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners);
            expect(result).to.be.false;
        });

        it("should reject invalid second flop card from B", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [G1, G1, G1];
            const cardBOpeners = [G1, twoG1, G1]; // Second card invalid
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners);
            expect(result).to.be.false;
        });

        it("should revert if deck has less than 7 cards", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [G1, G1, G1];
            const cardBOpeners = [G1, G1, G1];
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners)
            ).to.be.revertedWith("Deck must have at least 7 cards");
        });

        it("should revert if cardAOpeners has wrong length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [G1, G1]; // Only 2 cards
            const cardBOpeners = [G1, G1, G1];
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners)
            ).to.be.revertedWith("cardAOpeners must have 3 elements");
        });

        it("should revert if cardBOpeners has wrong length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [G1, G1, G1];
            const cardBOpeners = [G1, G1]; // Only 2 cards
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners)
            ).to.be.revertedWith("cardBOpeners must have 3 elements");
        });

        it("should revert if cardAOpener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [ethers.zeroPadValue("0x01", 32), G1, G1];
            const cardBOpeners = [G1, G1, G1];
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners)
            ).to.be.revertedWith("cardAOpener must be 64 bytes");
        });

        it("should revert if cardBOpener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpeners = [G1, G1, G1];
            const cardBOpeners = [G1, ethers.zeroPadValue("0x01", 32), G1];
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyFlop(pkA, pkB, bDeckSigned, cardAOpeners, cardBOpeners)
            ).to.be.revertedWith("cardBOpener must be 64 bytes");
        });
    });

    describe("verifyTurn", function () {
        it("should verify valid turn card", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyTurn(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
            expect(result).to.be.true;
        });

        it("should reject invalid turn card from A", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = twoG1; // Different point
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyTurn(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
            expect(result).to.be.false;
        });

        it("should reject invalid turn card from B", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = twoG1; // Different point
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyTurn(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
            expect(result).to.be.false;
        });

        it("should revert if deck has less than 8 cards", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyTurn(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener)
            ).to.be.revertedWith("Deck must have at least 8 cards");
        });

        it("should revert if cardAOpener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = ethers.zeroPadValue("0x01", 32);
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyTurn(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener)
            ).to.be.revertedWith("cardAOpener must be 64 bytes");
        });

        it("should revert if cardBOpener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = ethers.zeroPadValue("0x01", 32);
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyTurn(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener)
            ).to.be.revertedWith("cardBOpener must be 64 bytes");
        });
    });

    describe("verifyRiver", function () {
        it("should verify valid river card", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyRiver(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
            expect(result).to.be.true;
        });

        it("should reject invalid river card from A", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = twoG1; // Different point
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyRiver(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
            expect(result).to.be.false;
        });

        it("should reject invalid river card from B", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = twoG1; // Different point
            const pkA = G2;
            const pkB = G2;

            const result = await contract.verifyRiver(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener);
            expect(result).to.be.false;
        });

        it("should revert if deck has less than 9 cards", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyRiver(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener)
            ).to.be.revertedWith("Deck must have at least 9 cards");
        });

        it("should revert if cardAOpener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = ethers.zeroPadValue("0x01", 32);
            const cardBOpener = G1;
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyRiver(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener)
            ).to.be.revertedWith("cardAOpener must be 64 bytes");
        });

        it("should revert if cardBOpener has invalid length", async function () {
            const bDeckSigned = [G1, G1, G1, G1, G1, G1, G1, G1, G1];
            const cardAOpener = G1;
            const cardBOpener = ethers.zeroPadValue("0x01", 32);
            const pkA = G2;
            const pkB = G2;

            await expect(
                contract.verifyRiver(pkA, pkB, bDeckSigned, cardAOpener, cardBOpener)
            ).to.be.revertedWith("cardBOpener must be 64 bytes");
        });
    });
});
