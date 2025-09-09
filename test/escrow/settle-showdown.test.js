const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { SLOT } = require("../helpers/slots");
const { CARD } = require("../helpers/cards");
const { buildActions, signActions, wallet1, wallet2, buildCardCommit } = require("../helpers/test-utils");
const { domainSeparator } = require("../helpers/hashes");

describe("Settle to Showdown", function () {
    let escrow, player1, player2;
    let chainId;
    const channelId = 1n;
    const deposit = 10n;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();

        // Open channel and join
        await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });

    it("should initiate showdown when settle resolves to showdown", async function () {
        const handId = await escrow.getHandId(channelId);

        // Create actions that lead to showdown (both players check down)
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (flop)
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn)
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address },  // BB checks (river),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

        // This should not revert but should initiate showdown
        const tx = await escrow.connect(player1).settle(channelId, actions, signatures);

        // Verify ShowdownStarted event was emitted
        await expect(tx).to.emit(escrow, "ShowdownStarted").withArgs(channelId);

        // Verify showdown state was set up
        const showdownState = await escrow.getShowdown(channelId);
        expect(showdownState.inProgress).to.be.true;

        // Channel should not be finalized yet - requires card reveals
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit);
        expect(p2Stack).to.equal(deposit);
    });

    it("should prevent duplicate settle calls after showdown initiated", async function () {
        const handId = await escrow.getHandId(channelId);

        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (first to act postflop),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (river),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

        // First settle should work
        await escrow.connect(player1).settle(channelId, actions, signatures);

        // Second settle should revert due to showdown in progress
        await expect(escrow.connect(player2).settle(channelId, actions, signatures))
            .to.be.revertedWithCustomError(escrow, "ShowdownInProgress");
    });

    it("should still handle fold endings normally", async function () {
        const handId = await escrow.getHandId(channelId);

        // Create actions that lead to fold
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.FOLD, amount: 0n, sender: player1.address } // SB folds
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

        const tx = await escrow.connect(player1).settle(channelId, actions, signatures);

        // Should emit Settled event for fold, not ShowdownStarted
        await expect(tx).to.emit(escrow, "Settled");
        await expect(tx).to.not.emit(escrow, "ShowdownStarted");

        // Channel should be finalized
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p2Stack).to.be.gt(deposit); // Player2 should have won
    });

    it("should allow card reveals after settle-initiated showdown", async function () {
        const handId = await escrow.getHandId(channelId);

        // Initiate showdown via settle
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (first to act postflop),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (river),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        await escrow.connect(player1).settle(channelId, actions, signatures);

        // Prepare card commits for reveal
        const dom = domainSeparator(escrow.target, chainId);
        const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];

        const commits = [];
        const sigs = [];
        const cardCodes = [];
        const cardSalts = [];

        // Only reveal player1's cards
        const slots = [SLOT.A1, SLOT.A2];
        for (let i = 0; i < 2; i++) {
            const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, slots[i], player1Cards[i]);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            cardCodes.push(player1Cards[i]);
            cardSalts.push(obj.salt);
        }

        // Reveal player1's cards
        const revealTx = await escrow.connect(player1).revealCards(channelId, commits, sigs, cardCodes, cardSalts);
        await expect(revealTx).to.emit(escrow, "CommitsUpdated");

        // Verify cards were revealed
        const showdownState = await escrow.getShowdown(channelId);
        expect(showdownState.cards[SLOT.A1]).to.equal(player1Cards[0]);
        expect(showdownState.cards[SLOT.A2]).to.equal(player1Cards[1]);
        expect(showdownState.cards[SLOT.B1]).to.equal(0xFF); // Player2 cards still unrevealed
        expect(showdownState.cards[SLOT.B2]).to.equal(0xFF);
    });

    it("should automatically finalize when both players reveal cards", async function () {
        const handId = await escrow.getHandId(channelId);

        // Initiate showdown via settle
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (first to act postflop),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (river),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        await escrow.connect(player1).settle(channelId, actions, signatures);

        // Set up cards for both players and board
        const dom = domainSeparator(escrow.target, chainId);

        // Player1 gets better hand: Pair of Aces
        const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
        // Player2 gets worse hand: Queen high  
        const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
        // Board: A♣ 5♦ 3♥ 2♠ 7♣ - gives player1 pair of aces
        const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

        const allCards = [...player1Cards, ...player2Cards, ...boardCards];
        const slots = [SLOT.A1, SLOT.A2, SLOT.B1, SLOT.B2, SLOT.FLOP1, SLOT.FLOP2, SLOT.FLOP3, SLOT.TURN, SLOT.RIVER];

        const commits = [];
        const sigs = [];
        const cardCodes = [];
        const cardSalts = [];

        // Build commits for all cards
        for (let i = 0; i < allCards.length; i++) {
            const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, slots[i], allCards[i]);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            cardCodes.push(allCards[i]);
            cardSalts.push(obj.salt);
        }

        // Reveal all cards at once - should trigger automatic finalization
        const revealTx = await escrow.connect(player1).revealCards(channelId, commits, sigs, cardCodes, cardSalts);

        // Should emit ShowdownFinalized event with player1 as winner (pair beats high card)
        await expect(revealTx).to.emit(escrow, "ShowdownFinalized").withArgs(channelId, player1.address, 2n);

        // Verify player1 won
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit + 2n);
        expect(p2Stack).to.equal(deposit - 2n);
    });

    it("should handle finalization when only one player reveals cards", async function () {
        const handId = await escrow.getHandId(channelId);

        // Initiate showdown via settle
        const actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB calls,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (first to act postflop),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks (turn),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (turn),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }, // SB checks,
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks (river),
            { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }  // SB checks -> showdown
        ], channelId, handId);

        const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
        await escrow.connect(player1).settle(channelId, actions, signatures);

        // Only player1 reveals cards
        const dom = domainSeparator(escrow.target, chainId);
        const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];

        const commits = [];
        const sigs = [];
        const cardCodes = [];
        const cardSalts = [];

        const slots = [SLOT.A1, SLOT.A2];
        for (let i = 0; i < 2; i++) {
            const obj = await buildCardCommit(wallet1, wallet2, dom, channelId, slots[i], player1Cards[i]);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            cardCodes.push(player1Cards[i]);
            cardSalts.push(obj.salt);
        }

        await escrow.connect(player1).revealCards(channelId, commits, sigs, cardCodes, cardSalts);

        // Fast forward past the reveal deadline
        await ethers.provider.send("evm_increaseTime", [3700]); // 1 hour + 100 seconds
        await ethers.provider.send("evm_mine");

        // Finalize showdown - player1 should win since they're the only one who revealed
        const finalizeTx = await escrow.finalizeShowdown(channelId);
        await expect(finalizeTx).to.emit(escrow, "ShowdownFinalized").withArgs(channelId, player1.address, 2n);

        // Verify player1 won the pot
        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(deposit + 2n);
        expect(p2Stack).to.equal(deposit - 2n);
    });
});