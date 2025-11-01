import { expect } from "chai";
import hre from "hardhat";
import { ACTION } from "../helpers/actions.js";
import { buildActions, signActions, wallet1, wallet2, startGameWithDeck, createMockDeck, settleBasicFold } from "../helpers/test-utils.js";

const { ethers } = hre;

describe("HeadsUpPokerEscrow Management", function () {
    let escrow;
    let player1, player2, other;
    let chainId;

    beforeEach(async function () {
        [player1, player2, other] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("Channel Creation", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");

        // Table-driven tests for channel creation validation
        const creationValidationTests = [
            {
                name: "zero deposit",
                setup: () => ({ deposit: 0, minBlind: 1n, opponent: null }),
                error: "NoDeposit"
            },
            {
                name: "zero minSmallBlind",
                setup: () => ({ deposit, minBlind: 0n, opponent: null }),
                error: "InvalidMinSmallBlind"
            },
            {
                name: "zero address opponent",
                setup: () => ({ deposit, minBlind: 1n, opponent: ethers.ZeroAddress }),
                error: "BadOpponent"
            },
            {
                name: "self as opponent",
                setup: () => ({ deposit, minBlind: 1n, opponent: "self" }),
                error: "BadOpponent"
            }
        ];

        it("should allow player1 to open a channel", async function () {
            const minSmallBlind = 1n;
            await expect(escrow.connect(player1).open(channelId, player2.address, minSmallBlind, ethers.ZeroAddress, 0n, "0x", { value: deposit }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 1n, minSmallBlind);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(0);

            const handId = await escrow.getHandId(channelId);
            expect(handId).to.equal(1n);

            const minBlind = await escrow.getMinSmallBlind(channelId);
            expect(minBlind).to.equal(minSmallBlind);
        });

        creationValidationTests.forEach(test => {
            it(`should reject opening channel with ${test.name}`, async function () {
                const setup = test.setup();
                const opponent = setup.opponent === "self" ? player1.address :
                    setup.opponent === null ? player2.address : setup.opponent;

                await expect(escrow.connect(player1).open(channelId, opponent, setup.minBlind, ethers.ZeroAddress, 0n, "0x", { value: setup.deposit }))
                    .to.be.revertedWithCustomError(escrow, test.error);
            });
        });

        it("should reject opening duplicate channel", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "ChannelExists");
        });

        it("should generate incremental handIds per channel", async function () {
            const channelId1 = 100n;
            const channelId2 = 101n;

            await escrow.connect(player1).open(channelId1, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player1).open(channelId2, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });

            expect(await escrow.getHandId(channelId1)).to.equal(1n);
            expect(await escrow.getHandId(channelId2)).to.equal(1n);
        });
    });

    describe("Channel Joining", function () {
        const channelId = 2n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
        });

        it("should allow player2 to join the channel", async function () {
            await expect(escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit }))
                .to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, deposit);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(deposit);
        });

        // Table-driven tests for join validation errors
        const joinValidationTests = [
            {
                name: "non-existent channel",
                setup: () => ({ channelId: 999n, player: "player2", deposit }),
                error: "NoChannel"
            },
            {
                name: "wrong player",
                setup: () => ({ channelId, player: "other", deposit }),
                error: "NotOpponent"
            },
            {
                name: "zero deposit",
                setup: () => ({ channelId, player: "player2", deposit: 0 }),
                error: "NoDeposit"
            }
        ];

        joinValidationTests.forEach(test => {
            it(`should reject joining ${test.name}`, async function () {
                const setup = test.setup();
                const player = setup.player === "player2" ? player2 : other;

                await expect(escrow.connect(player).join(setup.channelId, ethers.ZeroAddress, "0x", { value: setup.deposit }))
                    .to.be.revertedWithCustomError(escrow, test.error);
            });
        });

        it("should reject joining already joined channel", async function () {
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await expect(escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "AlreadyJoined");
        });
    });

    describe("Channel Top Up", function () {
        const channelId = 5n;
        const player1Deposit = ethers.parseEther("1.0");
        const player2Deposit = ethers.parseEther("2.0");
        const topUpAmount = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: player1Deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: player2Deposit });
        });

        it("should allow player1 to top up to match player2's deposit", async function () {
            await expect(escrow.connect(player1).topUp(channelId, { value: topUpAmount }))
                .to.emit(escrow, "ChannelTopUp")
                .withArgs(channelId, player1.address, topUpAmount);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(player1Deposit + topUpAmount);
            expect(p2Stack).to.equal(player2Deposit);
        });

        it("should revert when top up would exceed player2 deposit", async function () {
            const excessiveTopUp = ethers.parseEther("1.1");
            await expect(escrow.connect(player1).topUp(channelId, { value: excessiveTopUp }))
                .to.be.revertedWithCustomError(escrow, "DepositExceedsOpponent");
        });

        it("should revert when player2 has not joined yet", async function () {
            const newChannelId = 6n;
            await escrow
                .connect(player1)
                .open(newChannelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: player1Deposit });

            await expect(escrow.connect(player1).topUp(newChannelId, { value: topUpAmount }))
                .to.be.revertedWithCustomError(escrow, "ChannelNotReady");
        });

        it("should revert when non-player1 tries to top up", async function () {
            await expect(escrow.connect(player2).topUp(channelId, { value: topUpAmount }))
                .to.be.revertedWithCustomError(escrow, "NotPlayer");
        });

        it("should revert when zero value top up provided", async function () {
            await expect(escrow.connect(player1).topUp(channelId))
                .to.be.revertedWithCustomError(escrow, "NoDeposit");
        });
    });

    describe("Start Game", function () {
        const channelId = 10n;
        const deposit = ethers.parseEther("1.0");
        let deck;
        let deckHash;

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            deck = createMockDeck();
            deckHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [deck]));
        });

        it("should allow player1 to submit deck hash", async function () {
            await escrow.connect(player1).startGame(channelId, deck);
            const channel = await escrow.getChannel(channelId);
            expect(channel.deckHashPlayer1).to.equal(deckHash);
            expect(channel.gameStarted).to.be.false; // Not started yet, waiting for player2
        });

        it("should allow player2 to submit deck hash", async function () {
            await escrow.connect(player2).startGame(channelId, deck);
            const channel = await escrow.getChannel(channelId);
            expect(channel.deckHashPlayer2).to.equal(deckHash);
            expect(channel.gameStarted).to.be.false; // Not started yet, waiting for player1
        });

        it("should emit GameStarted when both players submit matching hashes", async function () {
            await escrow.connect(player1).startGame(channelId, deck);
            
            const tx = await escrow.connect(player2).startGame(channelId, deck);
            await expect(tx)
                .to.emit(escrow, "GameStarted")
                .withArgs(channelId, deckHash);

            const channel = await escrow.getChannel(channelId);
            expect(channel.gameStarted).to.be.true;
        });

        it("should not start game when hashes don't match", async function () {
            const deck1 = createMockDeck();
            const deck2 = createMockDeck();

            await escrow.connect(player1).startGame(channelId, deck1);
            await escrow.connect(player2).startGame(channelId, deck2);
            
            // Game should not have started
            const channel = await escrow.getChannel(channelId);
            expect(channel.gameStarted).to.be.false;
        });

        it("should revert when game already started", async function () {
            await escrow.connect(player1).startGame(channelId, deck);
            await escrow.connect(player2).startGame(channelId, deck);

            await expect(escrow.connect(player1).startGame(channelId, deck))
                .to.be.revertedWithCustomError(escrow, "GameAlreadyStarted");
        });

        it("should revert when channel doesn't exist", async function () {
            const nonExistentChannel = 999n;
            await expect(escrow.connect(player1).startGame(nonExistentChannel, deck))
                .to.be.revertedWithCustomError(escrow, "NoChannel");
        });

        it("should revert when player2 hasn't joined", async function () {
            const newChannelId = 11n;
            await escrow.connect(player1).open(newChannelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });

            await expect(escrow.connect(player1).startGame(newChannelId, deck))
                .to.be.revertedWithCustomError(escrow, "ChannelNotReady");
        });

        it("should revert when non-player tries to start game", async function () {
            await expect(escrow.connect(other).startGame(channelId, deck))
                .to.be.revertedWithCustomError(escrow, "NotPlayer");
        });

        it("should reset game state when opening new hand", async function () {
            await escrow.connect(player1).startGame(channelId, deck);
            await escrow.connect(player2).startGame(channelId, deck);

            const handId = 1n;
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
            await escrow.settle(channelId, actions, signatures);

            // Open new hand
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            
            const channel = await escrow.getChannel(channelId);
            expect(channel.gameStarted).to.be.false;
            expect(channel.deckHashPlayer1).to.equal(ethers.ZeroHash);
            expect(channel.deckHashPlayer2).to.equal(ethers.ZeroHash);
        });
    });

    describe("View Functions", function () {
        const channelId = 10n;
        const deposit1 = ethers.parseEther("1.0");
        const deposit2 = ethers.parseEther("2.0");

        it("should return correct stacks for empty channel", async function () {
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(0);
        });

        it("should return correct stacks after opening", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit1 });

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit1);
            expect(p2Stack).to.equal(0);
        });

        it("should return correct stacks after joining", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit1 });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit2 });

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit1);
            expect(p2Stack).to.equal(deposit2);
        });
    });

    describe("Channel Reuse", function () {
        const channelId = 11n;
        const deposit = ethers.parseEther("1.0");

        it("should allow reusing channel after fold settlement and withdrawal", async function () {
            // First game
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await startGameWithDeck(escrow, channelId, player1, player2);
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);
            await escrow.connect(player1).withdraw(channelId);

            // Second game - should be able to reuse the same channel
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 2n, 1n);

            await expect(escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit }))
                .to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, deposit);
        });

        it("should allow reopening with remaining deposits", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await startGameWithDeck(escrow, channelId, player1, player2);
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);

            // Don't withdraw, try to reopen with remaining deposits
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 2n, 1n);
        });

        it("should accumulate winnings without withdrawal", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await startGameWithDeck(escrow, channelId, player1, player2);
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);

            // Check winnings accumulation
            let [p1Stack, _] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + 2n); // Won BB

            // Second game without withdrawing
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await startGameWithDeck(escrow, channelId, player1, player2);
            // reverse order of wallets since player1 is now BB
            await settleBasicFold(escrow, channelId, player2.address, wallet2, wallet1, chainId);

            // Check accumulated winnings
            [p1Stack, _] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n + 3n); // Accumulated winnings
        });

        it("should handle zero ETH deposits using existing winnings", async function () {
            // First game
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await startGameWithDeck(escrow, channelId, player1, player2);
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);

            // Second game using existing winnings (0 ETH)
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: 0 }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 0, 2n, 1n);

            // Player2 joins normally
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });

            // Verify combined deposits preserved previous winnings
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + 2n); // Player1's existing winnings
            expect(p2Stack).to.equal(deposit - 2n + deposit); // Player2's new deposit
        });

        it("should reject opening channel that is not finalized", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "ChannelExists");
        });
    });

    describe("Withdraw Function", function () {
        const channelId = 13n;
        const handId = 1n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: deposit });
            await startGameWithDeck(escrow, channelId, player1, player2);
        });

        it("should allow winner to withdraw their balance", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.BET_RAISE, amount: ethers.parseEther("0.1"), sender: player1.address }, // Small blind raises,
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address }, // BB checks,
                { action: ACTION.FOLD, amount: 0n, sender: player1.address } // Small blind folds
            ], channelId, handId);

            // Sign all actions with both players
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Should succeed and declare player2 (big blind) as winner
            const foldTx = await escrow.settle(channelId, actions, signatures);
            await expect(foldTx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player2.address, ethers.parseEther("0.1") + 1n);

            const initialBalance = await ethers.provider.getBalance(player2.address);

            const tx = await escrow.connect(player2).withdraw(channelId);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const finalBalance = await ethers.provider.getBalance(player2.address);

            // Should receive pot minus gas costs
            expect(finalBalance).to.be.closeTo(initialBalance + ethers.parseEther("1.1") - gasUsed, ethers.parseEther("0.001"));

            // Check player2 deposit is zero after withdrawal
            const [_, p2Stack] = await escrow.stacks(channelId);
            expect(p2Stack).to.equal(0);
        });

        it("should reject withdrawal from non-finalized channel", async function () {
            const newChannelId = 14n;
            await escrow.connect(player1).open(newChannelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: deposit });

            await expect(escrow.connect(player1).withdraw(newChannelId))
                .to.be.revertedWithCustomError(escrow, "NotFinalized");
        });

        it("should reject withdrawal with no balance", async function () {
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);
            await escrow.connect(player2).withdraw(channelId);
            // Check deposits are zero after withdrawal
            const [_, p2Stack] = await escrow.stacks(channelId);
            expect(p2Stack).to.equal(0);
            await expect(escrow.connect(player2).withdraw(channelId))
                .to.be.revertedWithCustomError(escrow, "NoBalance");
        });

        it("should reject withdrawal by non-player", async function () {
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);
            await expect(escrow.connect(other).withdraw(channelId))
                .to.be.revertedWithCustomError(escrow, "NoBalance");
        });
    });
});
