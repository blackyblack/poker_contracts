import { expect } from "chai";
import hre from "hardhat";

import { ACTION } from "../helpers/actions.js";
import { SLOT } from "../helpers/slots.js";
import {
    buildActions,
    signActions,
    startGameWithDeckHash,
    wallet1,
    wallet2,
} from "../helpers/test-utils.js";

const { ethers } = hre;

describe("Force Reveal - game state validation", function () {
    let escrow;
    let player1;
    let player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();

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
        await startGameWithDeckHash(escrow, channelId, player1, player2);
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
        ).to.be.rejectedWith(Error, /InvalidGameState/);
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
        ).to.be.rejectedWith(Error, /InvalidGameState/);
    });

    it("opens hole A force reveal while hand is active", async () => {
        const specs = [
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
        ];
        const { actions, signatures } = await buildSequence(specs);

        await escrow
            .connect(player1)
            .requestHoleA(channelId, actions, signatures);

        const state = await escrow.getForceReveal(channelId);
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
        ).to.be.rejectedWith(Error, /InvalidGameState/);
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
        ).to.be.rejectedWith(Error, /InvalidGameState/);
    });
});
