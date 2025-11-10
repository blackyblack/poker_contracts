import { expect } from "chai";
import hre from "hardhat";

import { ACTION } from "../helpers/actions.js";
import { SLOT } from "../helpers/slots.js";
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

const deckContext = "peek_answer_deck";

describe("Peek - answer functions", function () {
    let escrow;
    let player1;
    let player2;
    let view;
    let crypto;
    let deck;
    let escrowAddress;
    let chainId;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        view = await ethers.getContractAt(
            "HeadsUpPokerView",
            await escrow.viewContract()
        );
        escrowAddress = await escrow.getAddress();
        chainId = (await ethers.provider.getNetwork()).chainId;

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

    async function partialDecrypt(secretKey, slot) {
        const decryptedCard = await createPartialDecrypt(secretKey, deck[slot]);
        return decryptedCard;
    }

    it("serves hole A peek with helper partial decrypts", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await escrow
            .connect(player1)
            .requestHoleA(channelId, actions, signatures);

        const partialA1 = await partialDecrypt(crypto.secretKeyB, SLOT.A1);
        const partialA2 = await partialDecrypt(crypto.secretKeyB, SLOT.A2);

        await escrow
            .connect(player2)
            .answerHoleA(channelId, [partialA1, partialA2]);

        const state = await view.getPeek(channelId);
        expect(state.inProgress).to.equal(false);
        expect(state.served).to.equal(true);
        expect(await view.getRevealedCardB(channelId, SLOT.A1)).to.equal(partialA1);
        expect(await view.getRevealedCardB(channelId, SLOT.A2)).to.equal(partialA2);
    });

    it("reverts when non-helper attempts to answer hole A", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await escrow
            .connect(player1)
            .requestHoleA(channelId, actions, signatures);

        const partial = await partialDecrypt(crypto.secretKeyB, SLOT.A1);

        await expect(
            escrow.connect(player1).answerHoleA(channelId, [partial, partial])
        ).to.be.revertedWithCustomError(escrow, "ActionInvalidSender");
    });

    it("allows flop peek when requester supplies own partials", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        const requesterPartials = await Promise.all([
            partialDecrypt(crypto.secretKeyA, SLOT.FLOP1),
            partialDecrypt(crypto.secretKeyA, SLOT.FLOP2),
            partialDecrypt(crypto.secretKeyA, SLOT.FLOP3),
        ]);

        await escrow
            .connect(player1)
            .requestFlop(channelId, actions, signatures, requesterPartials);

        const helperPartials = await Promise.all([
            partialDecrypt(crypto.secretKeyB, SLOT.FLOP1),
            partialDecrypt(crypto.secretKeyB, SLOT.FLOP2),
            partialDecrypt(crypto.secretKeyB, SLOT.FLOP3),
        ]);

        await escrow
            .connect(player2)
            .answerFlop(channelId, helperPartials);

        const state = await view.getPeek(channelId);
        expect(state.inProgress).to.equal(false);
        expect(state.served).to.equal(true);
        expect(await view.getRevealedCardB(channelId, SLOT.FLOP1)).to.equal(
            helperPartials[0]
        );
    });
});
