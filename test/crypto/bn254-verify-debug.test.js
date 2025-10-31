import { expect } from "chai";
import hre from "hardhat";
import {
    generateKeyPair,
    createDeck,
    encryptAndShufflePlayer1,
    encryptAndShufflePlayer2,
    partialDecrypt,
    g1PointToBytes,
    g2PointToBytes
} from "../helpers/bn254-crypto.js";

const { ethers } = hre;

describe("Single Card Verification Debug", function () {
    it("should verify a single card with proper encryption", async function () {
        const Bn254Test = await ethers.getContractFactory("Bn254Test");
        const bn254Contract = await Bn254Test.deploy();
        
        // Generate keys
        const player1Keys = generateKeyPair();
        const player2Keys = generateKeyPair();
        
        // Create and encrypt deck
        const deck = createDeck(9);
        const deck1 = encryptAndShufflePlayer1(deck, player1Keys.publicKeyG1);
        const deck2 = encryptAndShufflePlayer2(deck1, player2Keys.publicKeyG1);
        
        // Test card 0 (Player A's first hole card)
        const cardEncrypted = g1PointToBytes(deck2[0].U2);
        const cardOpener = g1PointToBytes(partialDecrypt(deck2[0].U2, player2Keys.secretKey));
        const pkB = g2PointToBytes(player2Keys.publicKeyG2);
        
        const result = await bn254Contract.verifyPartialDecrypt(
            cardEncrypted,
            cardOpener,
            pkB
        );
        
        expect(result).to.be.true;
    });
});
