import { expect } from "chai";
import { bn254 } from "@noble/curves/bn254.js";
import hre from "hardhat";

import { ACTION } from "../helpers/actions.js";
import { SLOT } from "../helpers/slots.js";
import {
    buildActions,
    signActions,
    startGameWithDeck,
    wallet1,
    wallet2,
} from "../helpers/test-utils.js";
import { g1ToBytes, g2ToBytes, hashToG1 } from "../helpers/bn254.js";

const { ethers } = hre;

describe("Peek - Request Validation", function () {
    let escrow;
    let player1;
    let player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");
    let peekContract;

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        const peekAddress = await escrow.getPeekAddress();
        peekContract = await ethers.getContractAt("HeadsUpPokerPeek", peekAddress);

        await escrow.open(
            channelId,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            "0x",
            { value: deposit }
        );
        await escrow
            .connect(player2)
            .join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
        await startGameWithDeck(escrow, channelId, player1, player2);
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

    it("reverts hole A request when game ended with fold", async () => {
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

    it("reverts hole A request when game reached showdown", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await expect(
            escrow
                .connect(player1)
                .requestHoleA(channelId, actions, signatures)
        ).to.be.revertedWithCustomError(peekContract, "InvalidGameState");
    });

    it("opens hole A peek while hand is active", async () => {
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

    it("reverts flop request before preflop concludes", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await expect(
            escrow
                .connect(player1)
                .requestFlop(channelId, actions, signatures, [], [])
        ).to.be.revertedWithCustomError(peekContract, "InvalidGameState");
    });

    it("reverts turn request when flop betting is incomplete", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
        ];
        const { actions, signatures } = await buildSequence(specs);
        const handId = await escrow.getHandId(channelId);
        const dummyCard = {
            channelId,
            handId,
            player: player1.address,
            index: SLOT.TURN,
            decryptedCard: "0x",
        };

        await expect(
            escrow
                .connect(player1)
                .requestTurn(
                    channelId,
                    actions,
                    signatures,
                    dummyCard,
                    "0x"
                )
        ).to.be.revertedWithCustomError(peekContract, "InvalidGameState");
    });
});

describe("Peek - View", function () {
    let escrow;
    let player1;
    let player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    const G2 = bn254.G2.Point;

    it("verifies public keys are stored correctly", async function () {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();

        // Use fixed scalars
        const a = 12345n;
        const b = 67890n;

        const pkA_G2 = G2.BASE.multiply(a);
        const pkB_G2 = G2.BASE.multiply(b);

        const pkA_G2_bytes = g2ToBytes(pkA_G2);
        const pkB_G2_bytes = g2ToBytes(pkB_G2);

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

        // Get stored public keys
        const [storedPkA, storedPkB] = await escrow.getPublicKeys(channelId);

        expect(storedPkA).to.equal(pkA_G2_bytes);
        expect(storedPkB).to.equal(pkB_G2_bytes);
    });

    it("verifies deck is stored correctly", async function () {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();

        const a = 12345n;
        const b = 67890n;

        const pkA_G2_bytes = g2ToBytes(G2.BASE.multiply(a));
        const pkB_G2_bytes = g2ToBytes(G2.BASE.multiply(b));

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

        // Create deck
        const deck = [];
        const context = "test_poker_hand";
        for (let i = 0; i < 52; i++) {
            const R = hashToG1(context, i);
            const aR = R.multiply(a);
            const Y = aR.multiply(b);
            deck.push(g1ToBytes(Y));
        }

        await escrow.connect(player1).startGame(channelId, deck);
        await escrow.connect(player2).startGame(channelId, deck);

        // Get deck hash from the peek contract
        const peekAddress = await escrow.getPeekAddress();
        const peek = await ethers.getContractAt("HeadsUpPokerPeek", peekAddress);
        const expectedDeckHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [deck])
        );
        const storedDeckHash = await peek.getDeckHash(channelId);

        expect(storedDeckHash).to.equal(expectedDeckHash);
    });
});
