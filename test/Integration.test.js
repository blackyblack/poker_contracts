const { expect } = require("chai");
const { ethers } = require("hardhat");
const { domainSeparator, commitHash, cardCommitDigest, handGenesis } = require("./hashes");
const { SLOT } = require("./slots");
const { CARD } = require("./cards");

describe("Poker Game Integration", function () {
    let escrow, player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1.0");

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();

        // Setup channel
        await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });

    // Helper wallets for signing
    const wallet1 = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    const wallet2 = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

    async function signCommit(a, b, dom, cc) {
        const digest = cardCommitDigest(dom, cc);
        const sigA = a.signingKey.sign(digest).serialized;
        const sigB = b.signingKey.sign(digest).serialized;
        return [sigA, sigB];
    }

    async function buildCommit(a, b, dom, channelId, slot, card, handId = 1n) {
        const salt = ethers.hexlify(ethers.randomBytes(32));
        const cHash = commitHash(dom, channelId, slot, card, salt);
        const cc = {
            channelId,
            handId,
            slot,
            commitHash: cHash,
            prevHash: handGenesis(channelId, handId),
        };
        const [sigA, sigB] = await signCommit(a, b, dom, cc);
        return { cc, sigA, sigB, card, salt };
    }

    async function setupShowdownWithCards(player1Cards, player2Cards, boardCards) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const dom = domainSeparator(escrow.target, chainId);

        const commits = [];
        const sigs = [];
        const objs = [];

        const allCards = [...player1Cards, ...player2Cards, ...boardCards];
        const slots = [SLOT.A1, SLOT.A2, SLOT.B1, SLOT.B2, SLOT.FLOP1, SLOT.FLOP2, SLOT.FLOP3, SLOT.TURN, SLOT.RIVER];

        for (let i = 0; i < allCards.length; i++) {
            const obj = await buildCommit(wallet1, wallet2, dom, channelId, slots[i], allCards[i]);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            objs.push(obj);
        }

        const boardSalts = boardCards.map((_, i) => objs[i + 4].salt);
        const player1Salts = player1Cards.map((_, i) => objs[i].salt);
        const player2Salts = player2Cards.map((_, i) => objs[i + 2].salt);

        return { commits, sigs, boardCards, boardSalts, player1Cards, player1Salts, player2Salts, player2Cards };
    }

    describe("Complete Game Scenarios", function () {
        it("should complete a full game from deal to showdown", async function () {
            // High-level integration: pair beats high card
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

            const { commits, sigs, boardSalts, player1Salts, player2Salts, player2Cards: p2Cards } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            // Start showdown
            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts);

            // Fast forward past reveal window
            await ethers.provider.send("evm_increaseTime", [3600 + 1]);
            await ethers.provider.send("evm_mine");

            // Finalize showdown
            const tx = await escrow.finalizeShowdownWithCommits(channelId, p2Cards, player2Salts);
            
            await expect(tx)
                .to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, deposit * 2n);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);
        });

        it("should handle tie situations correctly", async function () {
            // Both players have same hand on board
            const player1Cards = [CARD.TWO_SPADES, CARD.THREE_SPADES];
            const player2Cards = [CARD.FOUR_HEARTS, CARD.FIVE_DIAMONDS];
            const boardCards = [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.QUEEN_SPADES, CARD.JACK_CLUBS];

            const { commits, sigs, boardSalts, player1Salts, player2Salts, player2Cards: p2Cards } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts);

            await ethers.provider.send("evm_increaseTime", [3600 + 1]);
            await ethers.provider.send("evm_mine");

            const tx = await escrow.finalizeShowdownWithCommits(channelId, p2Cards, player2Salts);
            
            // In tie, initiator wins
            await expect(tx)
                .to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, deposit * 2n);
        });

        it("should handle straight beating pair", async function () {
            const player1Cards = [CARD.ACE_SPADES, CARD.TWO_SPADES];
            const player2Cards = [CARD.NINE_HEARTS, CARD.NINE_DIAMONDS];
            const boardCards = [CARD.THREE_CLUBS, CARD.FOUR_DIAMONDS, CARD.FIVE_HEARTS, CARD.SIX_SPADES, CARD.EIGHT_CLUBS];

            const { commits, sigs, boardSalts, player1Salts, player2Salts, player2Cards: p2Cards } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts);

            await ethers.provider.send("evm_increaseTime", [3600 + 1]);
            await ethers.provider.send("evm_mine");

            const tx = await escrow.finalizeShowdownWithCommits(channelId, p2Cards, player2Salts);
            
            await expect(tx)
                .to.emit(escrow, "ShowdownFinalized")
                .withArgs(channelId, player1.address, deposit * 2n);
        });
    });

    describe("Attack Prevention Tests", function () {
        it("should prevent starting showdown by non-participant", async function () {
            const [,, attacker] = await ethers.getSigners();
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

            const { commits, sigs, boardSalts, player1Salts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await expect(
                escrow
                    .connect(attacker)
                    .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts)
            ).to.be.revertedWithCustomError(escrow, "NotPlayer");
        });

        it("should prevent showdown with invalid card commits", async function () {
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

            const { commits, sigs, boardSalts, player1Salts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            // Tamper with a commit
            commits[0].channelId = channelId + 1n;

            await expect(
                escrow
                    .connect(player1)
                    .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts)
            ).to.be.revertedWithCustomError(escrow, "CommitWrongChannel");
        });

        it("should prevent double-spending attacks through forfeit", async function () {
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

            const { commits, sigs, boardSalts, player1Salts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts);

            // Fast forward past reveal window
            await ethers.provider.send("evm_increaseTime", [3600 + 1]);
            await ethers.provider.send("evm_mine");

            // First finalization
            await escrow.finalizeShowdownWithCommits(channelId, [0, 0], [ethers.ZeroHash, ethers.ZeroHash]);

            // Attempt second finalization should fail
            await expect(
                escrow.finalizeShowdownWithCommits(channelId, [0, 0], [ethers.ZeroHash, ethers.ZeroHash])
            ).to.be.revertedWithCustomError(escrow, "ShowdownNotInProgress");
        });
    });

    describe("Showdown Edge Cases - Should Fail Tests", function () {
        // These represent proper poker scenarios that should work but currently fail

        it.skip("should fail: partial board reveal", async function () {
            // TODO: Implement partial board reveal functionality
            // Should allow revealing only flop, then turn, then river
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, 0, 0]; // Only flop

            const { commits, sigs, boardSalts, player1Salts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await expect(
                escrow
                    .connect(player1)
                    .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts)
            ).to.not.be.reverted;
        });

        it.skip("should fail: muck losing hand", async function () {
            // TODO: Implement hand mucking
            // Losing player should be able to muck without revealing
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.TWO_HEARTS, CARD.THREE_HEARTS]; // Losing hand
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.SEVEN_HEARTS, CARD.NINE_SPADES, CARD.JACK_CLUBS];

            // Player2 should be able to forfeit without revealing cards
            await expect(
                escrow.connect(player2).muckLosingHand(channelId)
            ).to.not.be.reverted;
        });

        it.skip("should fail: time-based forfeit", async function () {
            // TODO: Implement time-based actions
            // Players should have limited time to act
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

            // Start game but don't respond within time limit
            const { commits, sigs, boardSalts, player1Salts } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts);

            // Fast forward past action deadline
            await ethers.provider.send("evm_increaseTime", [300 + 1]); // 5 minutes + 1 second
            await ethers.provider.send("evm_mine");

            // Should be able to claim forfeit win
            await expect(
                escrow.connect(player1).claimForfeitWin(channelId)
            ).to.not.be.reverted;
        });

        it.skip("should fail: disputed showdown", async function () {
            // TODO: Implement dispute resolution
            // Should handle cases where players disagree on outcome
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

            // Both players claim to win
            await expect(
                escrow.connect(player1).disputeShowdownResult(channelId, "Player1 has pair of Aces")
            ).to.not.be.reverted;

            await expect(
                escrow.connect(player2).disputeShowdownResult(channelId, "Invalid board cards")
            ).to.not.be.reverted;
        });
    });

    describe("Gas Optimization Tests", function () {
        it("should handle large showdown efficiently", async function () {
            const player1Cards = [CARD.ACE_SPADES, CARD.KING_SPADES];
            const player2Cards = [CARD.QUEEN_HEARTS, CARD.JACK_HEARTS];
            const boardCards = [CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS, CARD.TWO_SPADES, CARD.SEVEN_CLUBS];

            const { commits, sigs, boardSalts, player1Salts, player2Salts, player2Cards: p2Cards } =
                await setupShowdownWithCards(player1Cards, player2Cards, boardCards);

            // Measure gas for showdown start
            const startTx = await escrow
                .connect(player1)
                .startShowdown(channelId, commits, sigs, boardCards, boardSalts, player1Cards, player1Salts);
            const startReceipt = await startTx.wait();

            await ethers.provider.send("evm_increaseTime", [3600 + 1]);
            await ethers.provider.send("evm_mine");

            // Measure gas for finalization
            const finalizeTx = await escrow.finalizeShowdownWithCommits(channelId, p2Cards, player2Salts);
            const finalizeReceipt = await finalizeTx.wait();

            // Verify gas usage is reasonable (adjust thresholds as needed)
            expect(startReceipt.gasUsed).to.be.lessThan(500000); // 500k gas limit
            expect(finalizeReceipt.gasUsed).to.be.lessThan(200000); // 200k gas limit
        });
    });
});