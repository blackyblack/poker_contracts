import { expect } from "chai";
import hre from "hardhat";
import { ACTION } from "../helpers/actions.js";
import { SLOT } from "../helpers/slots.js";
import {
    buildActions,
    signActions,
    wallet1,
    wallet2,
    setupShowdownCrypto,
    createEncryptedDeck,
    createCanonicalDeck,
    createMockDeck,
    createMockCanonicalDeck,
    createPartialDecrypt,
    deployAndWireContracts,
} from "../helpers/test-utils.js";

const { ethers } = hre;

/**
 * Integration tests for bad actor scenarios where one player stops responding
 * at various steps of the game flow. Tests cover:
 * 1. Player does not join
 * 2. Player does not start the game
 * 3. Player starts with bad/mismatched deck
 * 4. Player does not act on their turn (dispute mechanism)
 * 5. Player does not help reveal cards (peek contract)
 * 6. Player does not reveal on showdown
 */
describe("Integration Tests - Bad Actors", function () {
    let escrow, peek, showdown;
    let player1, player2;
    let chainId;
    const channelId = 1n;
    const deposit = ethers.parseEther("1.0");
    const minSmallBlind = 1n;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        ({ escrow, peek, showdown } = await deployAndWireContracts());
        chainId = (await ethers.provider.getNetwork()).chainId;
    });

    describe("Player Does Not Join", function () {
        it("should allow player 1 to open but player 2 never joins", async function () {
            // Player 1 opens channel
            await expect(
                escrow.connect(player1).open(
                    channelId,
                    player2.address,
                    minSmallBlind,
                    ethers.ZeroAddress,
                    0n,
                    "0x",
                    { value: deposit }
                )
            )
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 1n, minSmallBlind);

            // Verify channel state - only player 1 has balance
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(0);

            // Player 2 never joins - verify we cannot start game
            const deck = createMockDeck();
            const canonicalDeck = createMockCanonicalDeck();

            await expect(
                escrow.connect(player1).startGame(channelId, deck, canonicalDeck)
            ).to.be.revertedWithCustomError(escrow, "ChannelNotReady");
        });

        it("should allow player 1 to withdraw if player 2 never joins after deadline", async function () {
            // Player 1 opens channel
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                "0x",
                { value: deposit }
            );

            // Player 2 never joins - get the deadline window
            const startDeadlineWindow = await escrow.startDeadlineWindow();

            // Fast forward past the deadline
            await ethers.provider.send("evm_increaseTime", [Number(startDeadlineWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Finalize the stale channel
            await expect(
                escrow.connect(player1).finalizeStaleChannel(channelId)
            ).to.emit(escrow, "ChannelStaleFinalized")
                .withArgs(channelId);

            // Verify channel is finalized
            const channel = await escrow.getChannel(channelId);
            expect(channel.finalized).to.be.true;

            // Now player 1 can withdraw their funds
            await expect(
                escrow.connect(player1).withdraw(channelId)
            ).to.emit(escrow, "Withdrawn")
                .withArgs(channelId, player1.address, deposit);

            // Verify player 1's balance is zero after withdrawal
            const [p1Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
        });
    });

    describe("Player Does Not Start The Game", function () {
        beforeEach(async function () {
            // Both players join
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                "0x",
                { value: deposit }
            );
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
        });

        it("should prevent game start if only one player submits deck", async function () {
            const deck = createMockDeck();
            const canonicalDeck = createMockCanonicalDeck();

            // Player 1 submits deck
            await expect(
                escrow.connect(player1).startGame(channelId, deck, canonicalDeck)
            ).to.not.be.reverted;

            // Player 2 does not submit deck - game should not start
            // Try to settle should fail
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.FOLD, amount: 0n, sender: wallet1.address }
            ];

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Settlement should fail because game hasn't started
            await expect(
                escrow.connect(player1).settle(channelId, actions, signatures)
            ).to.be.revertedWithCustomError(escrow, "GameNotStarted");
        });

        it("should prevent game start if neither player submits deck", async function () {
            // Neither player submits deck
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.FOLD, amount: 0n, sender: wallet1.address }
            ];

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Settlement should fail
            await expect(
                escrow.connect(player1).settle(channelId, actions, signatures)
            ).to.be.revertedWithCustomError(escrow, "GameNotStarted");
        });

        it("should allow finalization if only one player submits deck after deadline", async function () {
            const deck = createMockDeck();
            const canonicalDeck = createMockCanonicalDeck();

            // Player 1 submits deck
            await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);

            // Player 2 does not submit deck
            // Fast forward past the deadline
            const startDeadlineWindow = await escrow.startDeadlineWindow();
            await ethers.provider.send("evm_increaseTime", [Number(startDeadlineWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Finalize the stale channel
            await expect(
                escrow.connect(player1).finalizeStaleChannel(channelId)
            ).to.emit(escrow, "ChannelStaleFinalized")
                .withArgs(channelId);

            // Verify channel is finalized
            const channel = await escrow.getChannel(channelId);
            expect(channel.finalized).to.be.true;

            // Both players can withdraw their funds
            await expect(
                escrow.connect(player1).withdraw(channelId)
            ).to.emit(escrow, "Withdrawn")
                .withArgs(channelId, player1.address, deposit);

            await expect(
                escrow.connect(player2).withdraw(channelId)
            ).to.emit(escrow, "Withdrawn")
                .withArgs(channelId, player2.address, deposit);
        });

        it("should allow finalization if neither player submits deck after deadline", async function () {
            // Neither player submits deck
            // Fast forward past the deadline
            const startDeadlineWindow = await escrow.startDeadlineWindow();
            await ethers.provider.send("evm_increaseTime", [Number(startDeadlineWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Finalize the stale channel
            await expect(
                escrow.connect(player1).finalizeStaleChannel(channelId)
            ).to.emit(escrow, "ChannelStaleFinalized")
                .withArgs(channelId);

            // Verify channel is finalized
            const channel = await escrow.getChannel(channelId);
            expect(channel.finalized).to.be.true;

            // Both players can withdraw their funds
            await expect(
                escrow.connect(player1).withdraw(channelId)
            ).to.emit(escrow, "Withdrawn")
                .withArgs(channelId, player1.address, deposit);

            await expect(
                escrow.connect(player2).withdraw(channelId)
            ).to.emit(escrow, "Withdrawn")
                .withArgs(channelId, player2.address, deposit);
        });
    });

    describe("Player Starts With Bad Deck", function () {
        beforeEach(async function () {
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                "0x",
                { value: deposit }
            );
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
        });

        it("should prevent game start if players submit mismatched decks", async function () {
            const deck1 = createMockDeck();
            const deck2 = createMockDeck(); // Different deck
            const canonicalDeck = createMockCanonicalDeck();

            // Player 1 submits first deck
            await escrow.connect(player1).startGame(channelId, deck1, canonicalDeck);

            // Player 2 submits different deck - game should not start
            await escrow.connect(player2).startGame(channelId, deck2, canonicalDeck);

            // Verify game has not started
            const channel = await escrow.getChannel(channelId);
            expect(channel.gameStarted).to.be.false;

            // Game should not have started - verify settle fails
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.FOLD, amount: 0n, sender: wallet1.address }
            ];

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            await expect(
                escrow.connect(player1).settle(channelId, actions, signatures)
            ).to.be.revertedWithCustomError(escrow, "GameNotStarted");
        });

        it("should prevent game start if players submit mismatched canonical decks", async function () {
            const deck = createMockDeck();
            const canonicalDeck1 = createMockCanonicalDeck();
            const canonicalDeck2 = createMockCanonicalDeck(); // Different canonical deck

            // Player 1 submits first canonical deck
            await escrow.connect(player1).startGame(channelId, deck, canonicalDeck1);

            // Player 2 submits different canonical deck - game should not start
            await escrow.connect(player2).startGame(channelId, deck, canonicalDeck2);

            // Verify game has not started
            const channel = await escrow.getChannel(channelId);
            expect(channel.gameStarted).to.be.false;
        });

        it("should prevent game start with invalid deck size", async function () {
            const invalidDeck = createMockDeck().slice(0, 5); // Only 5 cards instead of 9
            const canonicalDeck = createMockCanonicalDeck();

            await expect(
                escrow.connect(player1).startGame(channelId, invalidDeck, canonicalDeck)
            ).to.be.revertedWithCustomError(peek, "InvalidDeck");
        });

        it("should prevent game start with invalid canonical deck size", async function () {
            const deck = createMockDeck();
            const invalidCanonicalDeck = createMockCanonicalDeck().slice(0, 30); // Only 30 cards instead of 52

            await expect(
                escrow.connect(player1).startGame(channelId, deck, invalidCanonicalDeck)
            ).to.be.revertedWithCustomError(peek, "InvalidDeck");
        });
    });

    describe("Player Does Not Act On Their Turn (Dispute Mechanism)", function () {
        beforeEach(async function () {
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                "0x",
                { value: deposit }
            );
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });

            const deck = createMockDeck();
            const canonicalDeck = createMockCanonicalDeck();
            await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
            await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);
        });

        it("should allow dispute when player stops responding mid-game", async function () {
            const handId = await escrow.getHandId(channelId);

            // Partial action sequence - player 2 doesn't respond after small blind posts
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.BET_RAISE, amount: 3n, sender: wallet1.address }
                // Player 2 should respond but doesn't
            ];

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Player 1 can start a dispute with incomplete game
            await expect(
                escrow.connect(player1).dispute(channelId, actions, signatures)
            ).to.emit(escrow, "DisputeStarted");

            // Verify dispute state exists
            const dispute = await escrow.getDispute(channelId);
            expect(dispute.inProgress).to.equal(true);
        });

        it("should allow dispute to be extended with longer action history", async function () {
            const handId = await escrow.getHandId(channelId);

            // First partial sequence
            const actionSpecs1 = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address }
            ];

            const actions1 = buildActions(actionSpecs1, channelId, handId);
            const signatures1 = await signActions(
                actions1,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            await escrow.connect(player1).dispute(channelId, actions1, signatures1);

            // Extended sequence
            const actionSpecs2 = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address }
            ];

            const actions2 = buildActions(actionSpecs2, channelId, handId);
            const signatures2 = await signActions(
                actions2,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Should extend dispute with longer history
            await expect(
                escrow.connect(player2).dispute(channelId, actions2, signatures2)
            ).to.emit(escrow, "DisputeExtended");
        });

        it("should finalize dispute after timeout", async function () {
            const handId = await escrow.getHandId(channelId);

            // Submit incomplete game ending in fold
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.FOLD, amount: 0n, sender: wallet1.address }
            ];

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            await escrow.connect(player1).dispute(channelId, actions, signatures);

            // Get dispute window duration
            const disputeWindow = await escrow.disputeWindow();

            // Fast forward time past dispute window
            await ethers.provider.send("evm_increaseTime", [Number(disputeWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Finalize dispute
            await expect(
                escrow.connect(player1).finalizeDispute(channelId)
            ).to.emit(escrow, "DisputeFinalized");

            // Winner should have received the pot
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p2Stack).to.be.gt(p1Stack); // Player 2 wins when player 1 folds
        });
    });

    describe("Player Does Not Help Reveal Cards (Peek Contract)", function () {
        let crypto, deck, canonicalDeck;
        const slashAmount = ethers.parseEther("0.1"); // Set a non-zero slash amount

        beforeEach(async function () {
            crypto = setupShowdownCrypto();

            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                slashAmount,
                crypto.publicKeyA,
                { value: deposit }
            );
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, crypto.publicKeyB, { value: deposit });
            const deckContext = "peek_bad_actor_test";
            deck = createEncryptedDeck(
                crypto.secretKeyA,
                crypto.secretKeyB,
                deckContext
            );
            canonicalDeck = createCanonicalDeck(deckContext);

            await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
            await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);
        });

        it("should allow peek contract to help reveal hole cards when player cooperates", async function () {
            // Verify peek contract has access to the deck and public keys
            const [pkA, pkB] = await peek.getPublicKeys(channelId);
            expect(pkA).to.not.equal("0x");
            expect(pkB).to.not.equal("0x");

            // Player 1 requests to peek at their own hole cards (Player 2 must help)
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Request peek for hole cards A
            await expect(
                peek.connect(player1).requestHoleA(channelId, actions, signatures)
            ).to.emit(peek, "PeekOpened")
                .withArgs(channelId, 1); // HOLE_A stage

            // Player 2 (helper) provides partial decrypts
            const partialA1 = await createPartialDecrypt(crypto.secretKeyB, deck[SLOT.A1]);
            const partialA2 = await createPartialDecrypt(crypto.secretKeyB, deck[SLOT.A2]);

            await expect(
                peek.connect(player2).answerHoleA(channelId, [partialA1, partialA2])
            ).to.emit(peek, "PeekServed")
                .withArgs(channelId, 1);

            // Verify cards were revealed
            const revealedA1 = await peek.getRevealedCardB(channelId, SLOT.A1);
            const revealedA2 = await peek.getRevealedCardB(channelId, SLOT.A2);
            expect(revealedA1).to.equal(partialA1);
            expect(revealedA2).to.equal(partialA2);
        });

        it("should slash player who does not help reveal hole cards (requestHoleA)", async function () {
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Player 1 requests peek
            await peek.connect(player1).requestHoleA(channelId, actions, signatures);

            const peekState = await peek.getPeek(channelId);
            expect(peekState.inProgress).to.be.true;
            expect(peekState.obligatedHelper).to.equal(player2.address);

            // Player 2 does NOT respond - fast forward past peek window
            const peekWindow = await peek.peekWindow();
            await ethers.provider.send("evm_increaseTime", [Number(peekWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Get initial deposits
            const channelBefore = await escrow.getChannel(channelId);
            const p1DepositBefore = channelBefore.deposit1;
            const p2DepositBefore = channelBefore.deposit2;

            // Slash the non-cooperative player
            await expect(
                escrow.connect(player1).slashPeek(channelId)
            ).to.emit(peek, "PeekSlashed");

            // Verify player 2 was slashed and player 1 received the slash amount
            const channelAfter = await escrow.getChannel(channelId);
            expect(channelAfter.deposit1).to.equal(p1DepositBefore + slashAmount);
            expect(channelAfter.deposit2).to.equal(p2DepositBefore - slashAmount);

            // Verify channel is finalized
            expect(channelAfter.finalized).to.be.true;
        });

        it("should slash player who does not help reveal hole cards (requestHoleB)", async function () {
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            ];
            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Player 2 requests peek for their hole cards (Player 1 must help)
            await peek.connect(player2).requestHoleB(channelId, actions, signatures);

            const peekState = await peek.getPeek(channelId);
            expect(peekState.inProgress).to.be.true;
            expect(peekState.obligatedHelper).to.equal(player1.address);

            // Player 1 does NOT respond - fast forward past peek window
            const peekWindow = await peek.peekWindow();
            await ethers.provider.send("evm_increaseTime", [Number(peekWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Get initial deposits
            const channelBefore = await escrow.getChannel(channelId);
            const p1DepositBefore = channelBefore.deposit1;
            const p2DepositBefore = channelBefore.deposit2;

            // Slash the non-cooperative player
            await expect(
                escrow.connect(player2).slashPeek(channelId)
            ).to.emit(peek, "PeekSlashed");

            // Verify player 1 was slashed and player 2 received the slash amount
            const channelAfter = await escrow.getChannel(channelId);
            expect(channelAfter.deposit1).to.equal(p1DepositBefore - slashAmount);
            expect(channelAfter.deposit2).to.equal(p2DepositBefore + slashAmount);

            // Verify channel is finalized
            expect(channelAfter.finalized).to.be.true;
        });

        it("should slash player who does not help reveal flop cards", async function () {
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
            ];
            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Player 1 provides their partial decrypts for flop and requests peek
            const requesterPartials = await Promise.all([
                createPartialDecrypt(crypto.secretKeyA, deck[SLOT.FLOP1]),
                createPartialDecrypt(crypto.secretKeyA, deck[SLOT.FLOP2]),
                createPartialDecrypt(crypto.secretKeyA, deck[SLOT.FLOP3]),
            ]);

            await peek.connect(player1).requestFlop(
                channelId,
                actions,
                signatures,
                requesterPartials
            );

            const peekState = await peek.getPeek(channelId);
            expect(peekState.inProgress).to.be.true;
            expect(peekState.obligatedHelper).to.equal(player2.address);

            // Player 2 does NOT respond - fast forward past peek window
            const peekWindow = await peek.peekWindow();
            await ethers.provider.send("evm_increaseTime", [Number(peekWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Get initial deposits
            const channelBefore = await escrow.getChannel(channelId);
            const p1DepositBefore = channelBefore.deposit1;
            const p2DepositBefore = channelBefore.deposit2;

            // Slash the non-cooperative player
            await expect(
                escrow.connect(player1).slashPeek(channelId)
            ).to.emit(peek, "PeekSlashed");

            // Verify player 2 was slashed
            const channelAfter = await escrow.getChannel(channelId);
            expect(channelAfter.deposit1).to.equal(p1DepositBefore + slashAmount);
            expect(channelAfter.deposit2).to.equal(p2DepositBefore - slashAmount);
        });

        it("should slash player who does not help reveal turn card", async function () {
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            ];
            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Player 1 provides their partial decrypt for turn and requests peek
            const requesterPartial = await createPartialDecrypt(crypto.secretKeyA, deck[SLOT.TURN]);

            await peek.connect(player1).requestTurn(
                channelId,
                actions,
                signatures,
                requesterPartial
            );

            const peekState = await peek.getPeek(channelId);
            expect(peekState.inProgress).to.be.true;
            expect(peekState.obligatedHelper).to.equal(player2.address);

            // Player 2 does NOT respond - fast forward past peek window
            const peekWindow = await peek.peekWindow();
            await ethers.provider.send("evm_increaseTime", [Number(peekWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Get initial deposits
            const channelBefore = await escrow.getChannel(channelId);
            const p1DepositBefore = channelBefore.deposit1;
            const p2DepositBefore = channelBefore.deposit2;

            // Slash the non-cooperative player
            await expect(
                escrow.connect(player1).slashPeek(channelId)
            ).to.emit(peek, "PeekSlashed");

            // Verify player 2 was slashed
            const channelAfter = await escrow.getChannel(channelId);
            expect(channelAfter.deposit1).to.equal(p1DepositBefore + slashAmount);
            expect(channelAfter.deposit2).to.equal(p2DepositBefore - slashAmount);
        });

        it("should slash player who does not help reveal river card", async function () {
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: wallet1.address },
            ];
            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            // Player 2 provides their partial decrypt for river and requests peek
            const requesterPartial = await createPartialDecrypt(crypto.secretKeyB, deck[SLOT.RIVER]);

            await peek.connect(player2).requestRiver(
                channelId,
                actions,
                signatures,
                requesterPartial
            );

            const peekState = await peek.getPeek(channelId);
            expect(peekState.inProgress).to.be.true;
            expect(peekState.obligatedHelper).to.equal(player1.address);

            // Player 1 does NOT respond - fast forward past peek window
            const peekWindow = await peek.peekWindow();
            await ethers.provider.send("evm_increaseTime", [Number(peekWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Get initial deposits
            const channelBefore = await escrow.getChannel(channelId);
            const p1DepositBefore = channelBefore.deposit1;
            const p2DepositBefore = channelBefore.deposit2;

            // Slash the non-cooperative player
            await expect(
                escrow.connect(player2).slashPeek(channelId)
            ).to.emit(peek, "PeekSlashed");

            // Verify player 1 was slashed
            const channelAfter = await escrow.getChannel(channelId);
            expect(channelAfter.deposit1).to.equal(p1DepositBefore - slashAmount);
            expect(channelAfter.deposit2).to.equal(p2DepositBefore + slashAmount);
        });
    });

    describe("Player Does Not Reveal On Showdown", function () {
        let crypto, deck, canonicalDeck;

        beforeEach(async function () {
            crypto = setupShowdownCrypto();

            await escrow.connect(player1).open(
                channelId,
                player2.address,
                minSmallBlind,
                ethers.ZeroAddress,
                0n,
                crypto.publicKeyA,
                { value: deposit }
            );
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, crypto.publicKeyB, { value: deposit });
            const deckContext = "showdown_no_reveal";
            deck = createEncryptedDeck(
                crypto.secretKeyA,
                crypto.secretKeyB,
                deckContext
            );
            canonicalDeck = createCanonicalDeck("canonical_deck");

            await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
            await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);
        });

        it("should award pot to player who reveals when opponent does not", async function () {
            // Play to showdown
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
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

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            await escrow.connect(player1).settle(channelId, actions, signatures);

            // Only player 1 reveals
            const player1Partials = [];
            for (let i = 0; i < deck.length; i++) {
                player1Partials.push(await createPartialDecrypt(crypto.secretKeyA, deck[i]));
            }
            await escrow.connect(player1).revealCards(channelId, player1Partials);

            // Player 2 does NOT reveal

            // Fast forward past reveal window
            const revealWindow = await showdown.revealWindow();
            await ethers.provider.send("evm_increaseTime", [Number(revealWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Finalize showdown - player 1 should win by default
            await expect(
                escrow.connect(player1).finalizeShowdown(channelId)
            ).to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, 2n);

            // Verify player 1 won
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + 2n);
            expect(p2Stack).to.equal(deposit - 2n);
        });

        it("should handle tie when neither player reveals", async function () {
            // Play to showdown
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
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

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            await escrow.connect(player1).settle(channelId, actions, signatures);

            // Neither player reveals

            // Fast forward past reveal window
            const revealWindow = await showdown.revealWindow();
            await ethers.provider.send("evm_increaseTime", [Number(revealWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Finalize showdown - should be a tie
            await expect(
                escrow.connect(player1).finalizeShowdown(channelId)
            ).to.emit(escrow, "ShowdownFinalized");

            // Verify stacks are unchanged (tie)
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(deposit);
        });

        it("should handle case where only second player reveals", async function () {
            // Play to showdown
            const handId = await escrow.getHandId(channelId);
            const actionSpecs = [
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

            const actions = buildActions(actionSpecs, channelId, handId);
            const signatures = await signActions(
                actions,
                [wallet1, wallet2],
                await escrow.getAddress(),
                chainId
            );

            await escrow.connect(player1).settle(channelId, actions, signatures);

            // Only player 2 reveals
            const player2Partials = [];
            for (let i = 0; i < deck.length; i++) {
                player2Partials.push(await createPartialDecrypt(crypto.secretKeyB, deck[i]));
            }
            await escrow.connect(player2).revealCards(channelId, player2Partials);

            // Player 1 does NOT reveal

            // Fast forward past reveal window
            const revealWindow = await showdown.revealWindow();
            await ethers.provider.send("evm_increaseTime", [Number(revealWindow) + 1]);
            await ethers.provider.send("evm_mine", []);

            // Finalize showdown - player 2 should win by default
            await expect(
                escrow.connect(player2).finalizeShowdown(channelId)
            ).to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player2.address, 2n);

            // Verify player 2 won
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit - 2n);
            expect(p2Stack).to.equal(deposit + 2n);
        });
    });
});
