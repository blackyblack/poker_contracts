import { expect } from "chai";
import hre from "hardhat";
import { bn254 } from "@noble/curves/bn254.js";

import { ACTION } from "../helpers/actions.js";
import { SLOT } from "../helpers/slots.js";
import { buildActions, signActions, startGameWithDeck, wallet1, wallet2 } from "../helpers/test-utils.js";
import { hashToG1, g1ToBytes, g2ToBytes } from "../helpers/bn254.js";
import { domainSeparator } from "../helpers/hashes.js";

const { ethers } = hre;

describe("Peek - answer functions", function () {
    let escrow;
    let player1;
    let player2;
    let peekAddress;
    let peekContract;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");
    
    // Crypto setup
    const Fr = bn254.fields.Fr;
    const G2 = bn254.G2.Point;
    let secretKeyA, secretKeyB;  // scalars (private keys) for players
    let publicKeyA, publicKeyB;  // public keys
    let deck;  // encrypted deck

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        peekAddress = await escrow.getPeekAddress();
        peekContract = await ethers.getContractAt("HeadsUpPokerPeek", peekAddress);

        // Generate per-hand scalars (use fixed values for reproducibility)
        secretKeyA = 12345n;
        secretKeyB = 67890n;

        // Derive public keys
        publicKeyA = G2.BASE.multiply(secretKeyA);
        publicKeyB = G2.BASE.multiply(secretKeyB);

        const pkA_G2_bytes = g2ToBytes(publicKeyA);
        const pkB_G2_bytes = g2ToBytes(publicKeyB);

        await escrow.open(
            channelId,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            pkA_G2_bytes,
            { value: deposit }
        );
        await escrow
            .connect(player2)
            .join(channelId, ethers.ZeroAddress, pkB_G2_bytes, { value: deposit });

        // Create encrypted deck (9 cards)
        deck = [];
        const context = "test_poker_hand";
        for (let i = 0; i < 9; i++) {
            const R = hashToG1(context, i);
            const aR = R.multiply(secretKeyA);
            const Y = aR.multiply(secretKeyB);
            deck.push(g1ToBytes(Y));
        }

        await startGameWithDeck(escrow, channelId, player1, player2, deck);
    });

    async function buildSequence(specs) {
        const handId = await escrow.getHandId(channelId);
        const actions = buildActions(specs, channelId, handId);
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const signatures = await signActions(
            actions,
            [wallet1, wallet2],
            await escrow.getAddress(),
            chainId
        );
        return { actions, signatures };
    }

    // Helper to create a decrypted card structure and signature
    async function createDecryptedCard(signer, secretKey, index, channelId, handId) {
        const context = "test_poker_hand";
        const R = hashToG1(context, index);
        const aR = R.multiply(secretKeyA);
        const Y = aR.multiply(secretKeyB);

        // Compute partial decryption: U = scalar^(-1) · Y
        const scalar_inv = Fr.inv(secretKey);
        const U = Y.multiply(scalar_inv);

        const decryptedCard = {
            channelId,
            handId,
            player: signer.address,
            index,
            decryptedCard: g1ToBytes(U),
        };

        // Sign the decrypted card
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const domain = domainSeparator(peekAddress, chainId);
        
        // Build digest manually following EIP712 spec
        const DECRYPTED_CARD_TYPEHASH = ethers.keccak256(
            ethers.toUtf8Bytes(
                "DecryptedCard(uint256 channelId,uint256 handId,address player,uint8 index,bytes decryptedCard)"
            )
        );
        
        const structHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "uint256", "uint256", "address", "uint8", "bytes32"],
                [
                    DECRYPTED_CARD_TYPEHASH,
                    decryptedCard.channelId,
                    decryptedCard.handId,
                    decryptedCard.player,
                    decryptedCard.index,
                    ethers.keccak256(decryptedCard.decryptedCard),
                ]
            )
        );
        
        const digest = ethers.keccak256(
            ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domain, structHash])
        );
        
        const signature = signer.signingKey.sign(digest).serialized;

        return { decryptedCard, signature };
    }

    describe("answerHoleA", function () {
        it("successfully answers hole A peek request", async () => {
            // Request hole A
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            await escrow
                .connect(player1)
                .requestHoleA(channelId, actions, signatures);

            // Verify peek is active
            const fr = await escrow.getPeek(channelId);
            expect(fr.inProgress).to.equal(true);
            expect(fr.stage).to.equal(1); // HOLE_A

            // Answer with player2 (obligated helper)
            const handId = await escrow.getHandId(channelId);
            const { decryptedCard: card1, signature: sig1 } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.A1, channelId, handId);
            const { decryptedCard: card2, signature: sig2 } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.A2, channelId, handId);

            await escrow
                .connect(player2)
                .answerHoleA(channelId, [card1, card2], [sig1, sig2]);

            // Verify peek is completed
            const frAfter = await escrow.getPeek(channelId);
            expect(frAfter.inProgress).to.equal(false);
            expect(frAfter.served).to.equal(true);

            // Verify cards are stored
            const revealedCard1 = await escrow.getRevealedCardB(channelId, SLOT.A1);
            const revealedCard2 = await escrow.getRevealedCardB(channelId, SLOT.A2);
            expect(revealedCard1).to.equal(card1.decryptedCard);
            expect(revealedCard2).to.equal(card2.decryptedCard);
        });

        it("reverts when wrong player tries to answer", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            await escrow
                .connect(player1)
                .requestHoleA(channelId, actions, signatures);

            const handId = await escrow.getHandId(channelId);
            const { decryptedCard: card1, signature: sig1 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.A1, channelId, handId);
            const { decryptedCard: card2, signature: sig2 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.A2, channelId, handId);

            await expect(
                escrow
                    .connect(player1)
                    .answerHoleA(channelId, [card1, card2], [sig1, sig2])
            ).to.be.revertedWithCustomError(escrow, "ActionInvalidSender");
        });

        it("reverts with invalid G1 point at infinity", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            await escrow
                .connect(player1)
                .requestHoleA(channelId, actions, signatures);

            const handId = await escrow.getHandId(channelId);
            
            // Create valid card for A2
            const { decryptedCard: card2, signature: sig2 } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.A2, channelId, handId);

            // Create invalid card with point at infinity for A1
            const infinityPoint = ethers.zeroPadValue("0x00", 64);
            const decryptedCard1 = {
                channelId,
                handId,
                player: wallet2.address,
                index: SLOT.A1,
                decryptedCard: infinityPoint,
            };

            // Sign it
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const domain = domainSeparator(peekAddress, chainId);
            const DECRYPTED_CARD_TYPEHASH = ethers.keccak256(
                ethers.toUtf8Bytes(
                    "DecryptedCard(uint256 channelId,uint256 handId,address player,uint8 index,bytes decryptedCard)"
                )
            );
            const structHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256", "uint256", "address", "uint8", "bytes32"],
                    [
                        DECRYPTED_CARD_TYPEHASH,
                        decryptedCard1.channelId,
                        decryptedCard1.handId,
                        decryptedCard1.player,
                        decryptedCard1.index,
                        ethers.keccak256(decryptedCard1.decryptedCard),
                    ]
                )
            );
            const digest = ethers.keccak256(
                ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domain, structHash])
            );
            const sig1 = wallet2.signingKey.sign(digest).serialized;

            await expect(
                escrow
                    .connect(player2)
                    .answerHoleA(channelId, [decryptedCard1, card2], [sig1, sig2])
            ).to.be.revertedWithCustomError(peekContract, "InvalidDecryptedCard");
        });

        it("reverts with invalid G1 point not on curve", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            await escrow
                .connect(player1)
                .requestHoleA(channelId, actions, signatures);

            const handId = await escrow.getHandId(channelId);
            
            // Create valid card for A2
            const { decryptedCard: card2, signature: sig2 } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.A2, channelId, handId);

            // Create invalid card with point not on curve for A1
            const invalidPoint = ethers.concat([
                ethers.zeroPadValue("0x01", 32),
                ethers.zeroPadValue("0x02", 32)
            ]);
            const decryptedCard1 = {
                channelId,
                handId,
                player: wallet2.address,
                index: SLOT.A1,
                decryptedCard: invalidPoint,
            };

            // Sign it
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const domain = domainSeparator(peekAddress, chainId);
            const DECRYPTED_CARD_TYPEHASH = ethers.keccak256(
                ethers.toUtf8Bytes(
                    "DecryptedCard(uint256 channelId,uint256 handId,address player,uint8 index,bytes decryptedCard)"
                )
            );
            const structHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256", "uint256", "address", "uint8", "bytes32"],
                    [
                        DECRYPTED_CARD_TYPEHASH,
                        decryptedCard1.channelId,
                        decryptedCard1.handId,
                        decryptedCard1.player,
                        decryptedCard1.index,
                        ethers.keccak256(decryptedCard1.decryptedCard),
                    ]
                )
            );
            const digest = ethers.keccak256(
                ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domain, structHash])
            );
            const sig1 = wallet2.signingKey.sign(digest).serialized;

            await expect(
                escrow
                    .connect(player2)
                    .answerHoleA(channelId, [decryptedCard1, card2], [sig1, sig2])
            ).to.be.revertedWithCustomError(peekContract, "InvalidDecryptedCard");
        });
    });

    describe("answerHoleB", function () {
        it("successfully answers hole B peek request", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            await escrow
                .connect(player2)
                .requestHoleB(channelId, actions, signatures);

            const fr = await escrow.getPeek(channelId);
            expect(fr.inProgress).to.equal(true);
            expect(fr.stage).to.equal(2); // HOLE_B

            const handId = await escrow.getHandId(channelId);
            const { decryptedCard: card1, signature: sig1 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.B1, channelId, handId);
            const { decryptedCard: card2, signature: sig2 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.B2, channelId, handId);

            await escrow
                .connect(player1)
                .answerHoleB(channelId, [card1, card2], [sig1, sig2]);

            const frAfter = await escrow.getPeek(channelId);
            expect(frAfter.inProgress).to.equal(false);
            expect(frAfter.served).to.equal(true);

            const revealedCard1 = await escrow.getRevealedCardA(channelId, SLOT.B1);
            const revealedCard2 = await escrow.getRevealedCardA(channelId, SLOT.B2);
            expect(revealedCard1).to.equal(card1.decryptedCard);
            expect(revealedCard2).to.equal(card2.decryptedCard);
        });

        it("reverts when no peek in progress", async () => {
            const handId = await escrow.getHandId(channelId);
            const { decryptedCard: card1, signature: sig1 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.B1, channelId, handId);
            const { decryptedCard: card2, signature: sig2 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.B2, channelId, handId);

            await expect(
                escrow
                    .connect(player1)
                    .answerHoleB(channelId, [card1, card2], [sig1, sig2])
            ).to.be.revertedWithCustomError(peekContract, "NoPeekInProgress");
        });
    });

    describe("answerFlop", function () {
        it("successfully answers flop peek request", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            const handId = await escrow.getHandId(channelId);
            
            // Player 1 requests with their decryptions
            const { decryptedCard: p1card1, signature: p1sig1 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.FLOP1, channelId, handId);
            const { decryptedCard: p1card2, signature: p1sig2 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.FLOP2, channelId, handId);
            const { decryptedCard: p1card3, signature: p1sig3 } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.FLOP3, channelId, handId);

            await escrow
                .connect(player1)
                .requestFlop(
                    channelId,
                    actions,
                    signatures,
                    [p1card1, p1card2, p1card3],
                    [p1sig1, p1sig2, p1sig3]
                );

            const fr = await escrow.getPeek(channelId);
            expect(fr.inProgress).to.equal(true);
            expect(fr.stage).to.equal(3); // FLOP

            // Player 2 answers
            const { decryptedCard: p2card1, signature: p2sig1 } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.FLOP1, channelId, handId);
            const { decryptedCard: p2card2, signature: p2sig2 } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.FLOP2, channelId, handId);
            const { decryptedCard: p2card3, signature: p2sig3 } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.FLOP3, channelId, handId);

            await escrow
                .connect(player2)
                .answerFlop(channelId, [p2card1, p2card2, p2card3], [p2sig1, p2sig2, p2sig3]);

            const frAfter = await escrow.getPeek(channelId);
            expect(frAfter.inProgress).to.equal(false);
            expect(frAfter.served).to.equal(true);
        });
    });

    describe("answerTurn", function () {
        it("successfully answers turn peek request", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            const handId = await escrow.getHandId(channelId);
            
            const { decryptedCard: p1card, signature: p1sig } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.TURN, channelId, handId);

            await escrow
                .connect(player1)
                .requestTurn(channelId, actions, signatures, p1card, p1sig);

            const fr = await escrow.getPeek(channelId);
            expect(fr.inProgress).to.equal(true);
            expect(fr.stage).to.equal(4); // TURN

            const { decryptedCard: p2card, signature: p2sig } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.TURN, channelId, handId);

            await escrow
                .connect(player2)
                .answerTurn(channelId, p2card, p2sig);

            const frAfter = await escrow.getPeek(channelId);
            expect(frAfter.inProgress).to.equal(false);
            expect(frAfter.served).to.equal(true);
        });
    });

    describe("answerRiver", function () {
        it("successfully answers river peek request", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            const handId = await escrow.getHandId(channelId);
            
            const { decryptedCard: p1card, signature: p1sig } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.RIVER, channelId, handId);

            await escrow
                .connect(player1)
                .requestRiver(channelId, actions, signatures, p1card, p1sig);

            const fr = await escrow.getPeek(channelId);
            expect(fr.inProgress).to.equal(true);
            expect(fr.stage).to.equal(5); // RIVER

            const { decryptedCard: p2card, signature: p2sig } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.RIVER, channelId, handId);

            await escrow
                .connect(player2)
                .answerRiver(channelId, p2card, p2sig);

            const frAfter = await escrow.getPeek(channelId);
            expect(frAfter.inProgress).to.equal(false);
            expect(frAfter.served).to.equal(true);
        });

        it("reverts when answering wrong stage", async () => {
            const specs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            ];
            const { actions, signatures } = await buildSequence(specs);

            const handId = await escrow.getHandId(channelId);
            
            // Request TURN
            const { decryptedCard: p1card, signature: p1sig } = 
                await createDecryptedCard(wallet1, secretKeyA, SLOT.TURN, channelId, handId);

            await escrow
                .connect(player1)
                .requestTurn(channelId, actions, signatures, p1card, p1sig);

            // Try to answer with RIVER (wrong stage)
            const { decryptedCard: p2card, signature: p2sig } = 
                await createDecryptedCard(wallet2, secretKeyB, SLOT.RIVER, channelId, handId);

            await expect(
                escrow
                    .connect(player2)
                    .answerRiver(channelId, p2card, p2sig)
            ).to.be.revertedWithCustomError(peekContract, "PeekWrongStage");
        });
    });
});
