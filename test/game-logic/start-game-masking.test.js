import { expect } from "chai";
import hre from "hardhat";
import {
    generateSecretKey,
    createDeck,
    maskDeck,
    shuffleArray,
    deckToSolidityFormat
} from "../helpers/bn254-crypto.js";

const { ethers } = hre;

describe("HeadsUpPokerEscrow - startGame with Commutative Masking", function () {
    let escrow;
    let player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");
    const ctx = "test-channel-1";

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        
        // Deploy escrow contract
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        
        // Setup channel
        await escrow.open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
        await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
    });

    describe("startGame with commutatively masked deck", function () {
        it("should allow player1 to submit masked deck", async function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deck1 = maskDeck(deck, skA);
            const deck2 = maskDeck(deck1, skB);
            const shuffled = shuffleArray(deck2);
            const solidityDeck = deckToSolidityFormat(shuffled);

            await expect(
                escrow.connect(player1).startGame(channelId, solidityDeck)
            ).to.not.be.reverted;
        });

        it("should allow player2 to submit masked deck", async function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deck1 = maskDeck(deck, skA);
            const deck2 = maskDeck(deck1, skB);
            const shuffled = shuffleArray(deck2);
            const solidityDeck = deckToSolidityFormat(shuffled);

            await expect(
                escrow.connect(player2).startGame(channelId, solidityDeck)
            ).to.not.be.reverted;
        });

        it("should emit GameStarted when both players submit matching decks", async function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deck1 = maskDeck(deck, skA);
            const deck2 = maskDeck(deck1, skB);
            const shuffled = shuffleArray(deck2);
            const solidityDeck = deckToSolidityFormat(shuffled);

            // Player 1 submits
            await escrow.connect(player1).startGame(channelId, solidityDeck);
            
            // Player 2 submits - should emit GameStarted
            await expect(
                escrow.connect(player2).startGame(channelId, solidityDeck)
            ).to.emit(escrow, "GameStarted");
        });

        it("should compute same hash for deck from both players", async function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deck1 = maskDeck(deck, skA);
            const deck2 = maskDeck(deck1, skB);
            const shuffled = shuffleArray(deck2);
            const solidityDeck = deckToSolidityFormat(shuffled);

            // Player 1 submits
            await escrow.connect(player1).startGame(channelId, solidityDeck);
            
            // Player 2 submits same deck
            const tx = await escrow.connect(player2).startGame(channelId, solidityDeck);
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
            // Create two different decks
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            
            const deck1a = createDeck(ctx + "-a", 9);
            const deck1b = maskDeck(deck1a, skA);
            const deck2a = maskDeck(deck1b, skB);
            const shuffledA = shuffleArray(deck2a);
            const solidityDeck1 = deckToSolidityFormat(shuffledA);
            
            const deck1b_v2 = createDeck(ctx + "-b", 9);
            const deck1b_v2_masked = maskDeck(deck1b_v2, skA);
            const deck2b = maskDeck(deck1b_v2_masked, skB);
            const shuffledB = shuffleArray(deck2b);
            const solidityDeck2 = deckToSolidityFormat(shuffledB);
            
            // Player 1 submits first deck
            await escrow.connect(player1).startGame(channelId, solidityDeck1);
            
            // Player 2 submits different deck - should not emit GameStarted
            const tx = await escrow.connect(player2).startGame(channelId, solidityDeck2);
            const receipt = await tx.wait();
            
            // Check no GameStarted event
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "GameStarted"
            );
            
            expect(event).to.be.undefined;
        });

        it("should verify deck contains 9 cards", function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deck1 = maskDeck(deck, skA);
            const deck2 = maskDeck(deck1, skB);
            const shuffled = shuffleArray(deck2);
            const solidityDeck = deckToSolidityFormat(shuffled);

            expect(solidityDeck).to.have.length(9);
        });

        it("should verify each card in deck is 64 bytes", function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deck1 = maskDeck(deck, skA);
            const deck2 = maskDeck(deck1, skB);
            const shuffled = shuffleArray(deck2);
            const solidityDeck = deckToSolidityFormat(shuffled);

            solidityDeck.forEach((card, index) => {
                // 0x + 64 bytes * 2 hex chars = 130 characters
                expect(card).to.have.length(130, `Card ${index} should be 130 chars (0x + 128 hex chars for 64 bytes)`);
            });
        });

        it("should prevent starting game twice", async function () {
            const skA = generateSecretKey();
            const skB = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deck1 = maskDeck(deck, skA);
            const deck2 = maskDeck(deck1, skB);
            const shuffled = shuffleArray(deck2);
            const solidityDeck = deckToSolidityFormat(shuffled);

            // Start game
            await escrow.connect(player1).startGame(channelId, solidityDeck);
            await escrow.connect(player2).startGame(channelId, solidityDeck);
            
            // Try to start again
            await expect(
                escrow.connect(player1).startGame(channelId, solidityDeck)
            ).to.be.revertedWithCustomError(escrow, "GameAlreadyStarted");
        });
    });

    describe("Integration with different player keys", function () {
        it("should work with independently generated keys for each player", async function () {
            // Generate completely new keys
            const newSkA = generateSecretKey();
            const newSkB = generateSecretKey();
            
            // Create new deck with new keys
            const newDeck = createDeck(ctx + "-new", 9);
            const newDeck1 = maskDeck(newDeck, newSkA);
            const newDeck2 = maskDeck(newDeck1, newSkB);
            const shuffled = shuffleArray(newDeck2);
            const newSolidityDeck = deckToSolidityFormat(shuffled);
            
            // Both players submit
            await escrow.connect(player1).startGame(channelId, newSolidityDeck);
            
            await expect(
                escrow.connect(player2).startGame(channelId, newSolidityDeck)
            ).to.emit(escrow, "GameStarted");
        });

        it("should produce different deck hashes for different maskings", async function () {
            // Create two differently masked decks
            const skA1 = generateSecretKey();
            const skB1 = generateSecretKey();
            const deck = createDeck(ctx, 9);
            const deckA = maskDeck(deck, skA1);
            const deckAB = maskDeck(deckA, skB1);
            const shuffledA = shuffleArray(deckAB);
            const solidityDeckA = deckToSolidityFormat(shuffledA);
            
            const skA2 = generateSecretKey();
            const skB2 = generateSecretKey();
            const deckC = maskDeck(deck, skA2);
            const deckCD = maskDeck(deckC, skB2);
            const shuffledB = shuffleArray(deckCD);
            const solidityDeckB = deckToSolidityFormat(shuffledB);
            
            // Compute hashes
            const hashA = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [solidityDeckA]));
            const hashB = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [solidityDeckB]));
            
            // Hashes should be different (with overwhelming probability)
            expect(hashA).to.not.equal(hashB);
        });
    });
});
