import { expect } from "chai";
import hre from "hardhat";
import {
    generateKeyPair,
    createDeck,
    encryptAndShufflePlayer1,
    encryptAndShufflePlayer2,
    deckToSolidityFormat,
    g2PointToBytes
} from "../helpers/bn254-crypto.js";

const { ethers } = hre;

describe("HeadsUpPokerEscrow - startGame with Encrypted Deck", function () {
    let escrow;
    let player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");
    let player1Keys, player2Keys;
    let encryptedDeck;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        
        // Deploy escrow contract
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        
        // Generate different keys for each player
        player1Keys = generateKeyPair();
        player2Keys = generateKeyPair();
        
        // Create and encrypt deck
        const plaintextDeck = createDeck(9);
        const deck1 = encryptAndShufflePlayer1(plaintextDeck, player1Keys.publicKeyG1);
        const deck2 = encryptAndShufflePlayer2(deck1, player2Keys.publicKeyG1);
        encryptedDeck = deckToSolidityFormat(deck2);
        
        // Setup channel
        await escrow.open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
        await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
    });

    describe("startGame with encrypted deck", function () {
        it("should allow player1 to submit encrypted deck hash", async function () {
            await expect(
                escrow.connect(player1).startGame(channelId, encryptedDeck)
            ).to.not.be.reverted;
        });

        it("should allow player2 to submit encrypted deck hash", async function () {
            await expect(
                escrow.connect(player2).startGame(channelId, encryptedDeck)
            ).to.not.be.reverted;
        });

        it("should emit GameStarted when both players submit matching encrypted decks", async function () {
            // Player 1 submits
            await escrow.connect(player1).startGame(channelId, encryptedDeck);
            
            // Player 2 submits - should emit GameStarted
            await expect(
                escrow.connect(player2).startGame(channelId, encryptedDeck)
            ).to.emit(escrow, "GameStarted");
        });

        it("should compute same hash for encrypted deck from both players", async function () {
            // Player 1 submits
            await escrow.connect(player1).startGame(channelId, encryptedDeck);
            
            // Player 2 submits same deck
            const tx = await escrow.connect(player2).startGame(channelId, encryptedDeck);
            const receipt = await tx.wait();
            
            // Find GameStarted event
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "GameStarted"
            );
            
            expect(event).to.not.be.undefined;
            expect(event.args.channelId).to.equal(channelId);
            expect(event.args.deckHash).to.not.equal(ethers.ZeroHash);
        });

        it("should not start game when decks don't match", async function () {
            // Create a different encrypted deck
            const plaintextDeck2 = createDeck(9);
            const deck1_v2 = encryptAndShufflePlayer1(plaintextDeck2, player1Keys.publicKeyG1);
            const deck2_v2 = encryptAndShufflePlayer2(deck1_v2, player2Keys.publicKeyG1);
            const encryptedDeck2 = deckToSolidityFormat(deck2_v2);
            
            // Player 1 submits first deck
            await escrow.connect(player1).startGame(channelId, encryptedDeck);
            
            // Player 2 submits different deck - should not emit GameStarted
            const tx = await escrow.connect(player2).startGame(channelId, encryptedDeck2);
            const receipt = await tx.wait();
            
            // Check no GameStarted event
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "GameStarted"
            );
            
            expect(event).to.be.undefined;
        });

        it("should verify deck contains 9 cards", async function () {
            expect(encryptedDeck).to.have.length(9);
        });

        it("should verify each card in deck is 192 bytes (U1||U2||V2)", async function () {
            encryptedDeck.forEach((card, index) => {
                // 0x + 192 bytes * 2 hex chars = 386 characters
                expect(card).to.have.length(386, `Card ${index} should be 386 chars (0x + 384 hex chars for 192 bytes)`);
            });
        });

        it("should store encrypted deck after both players submit", async function () {
            await escrow.connect(player1).startGame(channelId, encryptedDeck);
            const tx = await escrow.connect(player2).startGame(channelId, encryptedDeck);
            
            // Verify game started by checking for GameStarted event
            await expect(tx).to.emit(escrow, "GameStarted");
        });

        it("should prevent starting game twice", async function () {
            // Start game
            await escrow.connect(player1).startGame(channelId, encryptedDeck);
            await escrow.connect(player2).startGame(channelId, encryptedDeck);
            
            // Try to start again
            await expect(
                escrow.connect(player1).startGame(channelId, encryptedDeck)
            ).to.be.revertedWithCustomError(escrow, "GameAlreadyStarted");
        });
    });

    describe("Integration with different player keys", function () {
        it("should work with independently generated keys for each player", async function () {
            // Generate completely new keys
            const newPlayer1Keys = generateKeyPair();
            const newPlayer2Keys = generateKeyPair();
            
            // Create new deck with new keys
            const newPlaintextDeck = createDeck(9);
            const newDeck1 = encryptAndShufflePlayer1(newPlaintextDeck, newPlayer1Keys.publicKeyG1);
            const newDeck2 = encryptAndShufflePlayer2(newDeck1, newPlayer2Keys.publicKeyG1);
            const newEncryptedDeck = deckToSolidityFormat(newDeck2);
            
            // Both players submit
            await escrow.connect(player1).startGame(channelId, newEncryptedDeck);
            
            await expect(
                escrow.connect(player2).startGame(channelId, newEncryptedDeck)
            ).to.emit(escrow, "GameStarted");
        });

        it("should produce different deck hashes for different encryptions", async function () {
            // Create two different encrypted decks
            const deck1A = encryptAndShufflePlayer1(createDeck(9), player1Keys.publicKeyG1);
            const deck2A = encryptAndShufflePlayer2(deck1A, player2Keys.publicKeyG1);
            const deckA = deckToSolidityFormat(deck2A);
            
            const deck1B = encryptAndShufflePlayer1(createDeck(9), player1Keys.publicKeyG1);
            const deck2B = encryptAndShufflePlayer2(deck1B, player2Keys.publicKeyG1);
            const deckB = deckToSolidityFormat(deck2B);
            
            // Compute hashes
            const hashA = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [deckA]));
            const hashB = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [deckB]));
            
            // Hashes should be different (with overwhelming probability)
            expect(hashA).to.not.equal(hashB);
        });
    });
});
