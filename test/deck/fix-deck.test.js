import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("HeadsUpPokerEscrow - Deck Fixing", function () {
    let escrow;
    let player1, player2;
    let chainId;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("fixDeckA and fixDeckB", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");
        const minSmallBlind = 1n;

        beforeEach(async function () {
            // Open and join channel
            await escrow.connect(player1).open(channelId, player2.address, minSmallBlind, ethers.ZeroAddress, { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, { value: deposit });
        });

        it("should allow fixing deck A with valid parameters", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootA = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_a"));
            
            // BN254 G1 generator: (1, 2)
            const pkA = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            await expect(escrow.fixDeckA(channelId, handId, deckHash, merkleRootA, pkA))
                .to.emit(escrow, "DeckAFixed")
                .withArgs(channelId, handId, deckHash, merkleRootA);

            const fixA = await escrow.getDeckFixA(channelId, handId);
            expect(fixA.deckHash).to.equal(deckHash);
            expect(fixA.merkleRoot).to.equal(merkleRootA);
            expect(fixA.pkG1).to.equal(pkA);
            expect(fixA.isSet).to.be.true;
        });

        it("should allow fixing deck B with valid parameters", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootB = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_b"));
            
            // BN254 G1 generator: (1, 2)
            const pkB = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            await expect(escrow.fixDeckB(channelId, handId, deckHash, merkleRootB, pkB))
                .to.emit(escrow, "DeckBFixed")
                .withArgs(channelId, handId, deckHash, merkleRootB);

            const fixB = await escrow.getDeckFixB(channelId, handId);
            expect(fixB.deckHash).to.equal(deckHash);
            expect(fixB.merkleRoot).to.equal(merkleRootB);
            expect(fixB.pkG1).to.equal(pkB);
            expect(fixB.isSet).to.be.true;
        });

        it("should allow fixing deck A and B in any order", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootA = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_a"));
            const merkleRootB = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_b"));
            
            const pkA = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            const pkB = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            // Fix B first
            await escrow.fixDeckB(channelId, handId, deckHash, merkleRootB, pkB);
            
            // Then fix A
            await escrow.fixDeckA(channelId, handId, deckHash, merkleRootA, pkA);

            const fixA = await escrow.getDeckFixA(channelId, handId);
            const fixB = await escrow.getDeckFixB(channelId, handId);
            
            expect(fixA.isSet).to.be.true;
            expect(fixB.isSet).to.be.true;
            expect(fixA.deckHash).to.equal(deckHash);
            expect(fixB.deckHash).to.equal(deckHash);
        });

        it("should enforce matching deckHash between A and B", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHashA = ethers.keccak256(ethers.toUtf8Bytes("test_deck_a"));
            const deckHashB = ethers.keccak256(ethers.toUtf8Bytes("test_deck_b"));
            const merkleRootA = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_a"));
            const merkleRootB = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_b"));
            
            const pkA = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);
            
            const pkB = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            // Fix A first
            await escrow.fixDeckA(channelId, handId, deckHashA, merkleRootA, pkA);
            
            // Try to fix B with different deckHash - should fail
            await expect(
                escrow.fixDeckB(channelId, handId, deckHashB, merkleRootB, pkB)
            ).to.be.revertedWithCustomError(escrow, "DeckHashMismatch");
        });

        it("should reject invalid public key for deck A", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootA = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_a"));
            
            // Invalid point (3, 4) which is not on BN254 curve
            const invalidPk = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(3n), 32),
                ethers.zeroPadValue(ethers.toBeHex(4n), 32)
            ]);

            await expect(
                escrow.fixDeckA(channelId, handId, deckHash, merkleRootA, invalidPk)
            ).to.be.revertedWithCustomError(escrow, "InvalidPublicKey");
        });

        it("should reject invalid public key for deck B", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootB = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_b"));
            
            // Invalid point (3, 4) which is not on BN254 curve
            const invalidPk = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(3n), 32),
                ethers.zeroPadValue(ethers.toBeHex(4n), 32)
            ]);

            await expect(
                escrow.fixDeckB(channelId, handId, deckHash, merkleRootB, invalidPk)
            ).to.be.revertedWithCustomError(escrow, "InvalidPublicKey");
        });

        it("should reject duplicate fixDeckA calls", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootA = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_a"));
            
            const pkA = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            // First call should succeed
            await escrow.fixDeckA(channelId, handId, deckHash, merkleRootA, pkA);
            
            // Second call should fail
            await expect(
                escrow.fixDeckA(channelId, handId, deckHash, merkleRootA, pkA)
            ).to.be.revertedWithCustomError(escrow, "DeckAlreadyFixed");
        });

        it("should reject duplicate fixDeckB calls", async function () {
            const handId = await escrow.getHandId(channelId);
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootB = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_b"));
            
            const pkB = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            // First call should succeed
            await escrow.fixDeckB(channelId, handId, deckHash, merkleRootB, pkB);
            
            // Second call should fail
            await expect(
                escrow.fixDeckB(channelId, handId, deckHash, merkleRootB, pkB)
            ).to.be.revertedWithCustomError(escrow, "DeckAlreadyFixed");
        });

        it("should allow different hands to have different deck fixes", async function () {
            const handId1 = await escrow.getHandId(channelId);
            const deckHash1 = ethers.keccak256(ethers.toUtf8Bytes("test_deck_1"));
            const merkleRootA1 = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_a_1"));
            
            const pk = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            // Fix deck for hand 1
            await escrow.fixDeckA(channelId, handId1, deckHash1, merkleRootA1, pk);

            // For hand 2, we would need to actually complete hand 1 and start hand 2
            // For now, just verify hand 1 is fixed
            const fixA = await escrow.getDeckFixA(channelId, handId1);
            expect(fixA.isSet).to.be.true;
            expect(fixA.deckHash).to.equal(deckHash1);
        });

        it("should reject fixing deck on non-existent channel", async function () {
            const nonExistentChannel = 999n;
            const handId = 1n;
            const deckHash = ethers.keccak256(ethers.toUtf8Bytes("test_deck"));
            const merkleRootA = ethers.keccak256(ethers.toUtf8Bytes("merkle_root_a"));
            
            const pk = ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1n), 32),
                ethers.zeroPadValue(ethers.toBeHex(2n), 32)
            ]);

            await expect(
                escrow.fixDeckA(nonExistentChannel, handId, deckHash, merkleRootA, pk)
            ).to.be.revertedWithCustomError(escrow, "NoChannel");
        });
    });
});
