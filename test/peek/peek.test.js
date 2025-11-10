import { expect } from "chai";
import hre from "hardhat";

import { ACTION } from "../helpers/actions.js";
import {
    buildActions,
    signActions,
    startGameWithDeck,
    wallet1,
    wallet2,
    setupShowdownCrypto,
    createEncryptedDeck,
    createCanonicalDeck,
    createPartialDecrypt,
} from "../helpers/test-utils.js";

const { ethers } = hre;

const deckContext = "peek_request_deck";

describe("Peek - Request Validation", function () {
    let escrow;
    let player1;
    let player2;
    let crypto;
    let deck;
    let escrowAddress;
    let chainId;
    let peekContract;
    let actionVerifier;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        escrowAddress = await escrow.getAddress();
        chainId = (await ethers.provider.getNetwork()).chainId;
        const peekAddress = await escrow.getPeekAddress();
        peekContract = await ethers.getContractAt("HeadsUpPokerPeek", peekAddress);
        const verifierAddress = await escrow.getActionVerifierAddress();
        actionVerifier = await ethers.getContractAt(
            "HeadsUpPokerActionVerifier",
            verifierAddress
        );

        crypto = setupShowdownCrypto();
        deck = createEncryptedDeck(
            crypto.secretKeyA,
            crypto.secretKeyB,
            deckContext
        );
        const canonicalDeck = createCanonicalDeck(deckContext);

        await escrow.open(
            channelId,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            crypto.publicKeyA,
            { value: deposit }
        );
        await escrow
            .connect(player2)
            .join(channelId, ethers.ZeroAddress, crypto.publicKeyB, {
                value: deposit,
            });

        await startGameWithDeck(escrow, channelId, player1, player2, deck, canonicalDeck);
    });

    async function buildSequence(specs) {
        const handId = await escrow.getHandId(channelId);
        const actions = buildActions(specs, channelId, handId);
        const signatures = await signActions(
            actions,
            [wallet1, wallet2],
            escrowAddress,
            chainId
        );
        return { actions, signatures };
    }

    it("reverts hole A request when action sequence ends the hand", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.FOLD, amount: 0n, sender: wallet1.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await expect(
            escrow
                .connect(player1)
                .requestHoleA(channelId, actions, signatures)
        ).to.be.revertedWithCustomError(peekContract, "InvalidGameState");
    });

    it("opens hole A peek with active hand", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await escrow
            .connect(player1)
            .requestHoleA(channelId, actions, signatures);

        const state = await escrow.getPeek(channelId);
        expect(state.stage).to.equal(1); // HOLE_A
        expect(state.inProgress).to.equal(true);
        expect(state.obligatedHelper).to.equal(player2.address);
    });

    it("reverts hole A request with mismatched signatures", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address }
        ];
        const { actions, signatures } = await buildSequence(specs);
        const badSignatures = signatures.slice();
        badSignatures[0] = badSignatures[1];

        await expect(
            escrow
                .connect(player1)
                .requestHoleA(channelId, actions, badSignatures)
        ).to.be.revertedWithCustomError(
            actionVerifier,
            "ActionWrongSigner"
        );
    });

    it("requires requester partial decrypts for flop peek", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await expect(
            escrow
                .connect(player1)
                .requestFlop(channelId, actions, signatures, [])
        ).to.be.revertedWithCustomError(peekContract, "InvalidDecryptedCard");

        const requesterPartials = await Promise.all(
            [0, 1, 2].map(async idx => {
                const slot = 4 + idx; // FLOP slots
                const decryptedCard = await createPartialDecrypt(crypto.secretKeyA, deck[slot]);
                return decryptedCard;
            })
        );

        await escrow
            .connect(player1)
            .requestFlop(channelId, actions, signatures, requesterPartials);

        const state = await escrow.getPeek(channelId);
        expect(state.stage).to.equal(3); // FLOP
        expect(state.obligatedHelper).to.equal(player2.address);
    });
});

describe("Peek - View", function () {
    it("stores public keys and deck data", async () => {
        const [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        const escrow = await Escrow.deploy();
        const crypto = setupShowdownCrypto();
        const peek = await ethers.getContractAt(
            "HeadsUpPokerPeek",
            await escrow.getPeekAddress()
        );

        await escrow.open(
            1n,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            crypto.publicKeyA,
            { value: ethers.parseEther("1") }
        );
        await escrow
            .connect(player2)
            .join(1n, ethers.ZeroAddress, crypto.publicKeyB, {
                value: ethers.parseEther("1"),
            });

        const deck = createEncryptedDeck(
            crypto.secretKeyA,
            crypto.secretKeyB,
            deckContext
        );
        const canonicalDeck = createCanonicalDeck(deckContext);
        await startGameWithDeck(escrow, 1n, player1, player2, deck, canonicalDeck);

        const [pkA, pkB] = await escrow.getPublicKeys(1n);
        expect(pkA).to.equal(crypto.publicKeyA);
        expect(pkB).to.equal(crypto.publicKeyB);

        const storedDeck = await peek.getDeck(1n, 0);
        expect(storedDeck).to.equal(deck[0]);
    });
});
