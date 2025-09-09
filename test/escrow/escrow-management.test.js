const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { domainSeparator, actionDigest } = require("../helpers/hashes");
const { buildActions, signActions, wallet1, wallet2, wallet3 } = require("../helpers/test-utils");

// Helper to settle fold scenario in tests
async function settleBasicFold(escrow, channelId, winner, wallet1, wallet2, chainId) {
    const handId = await escrow.getHandId(channelId);

    if (handId % 2n === 0n) {
        if (winner === wallet1.address) {
            winner = wallet2.address;
        } else {
            winner = wallet1.address;
        }
    }

    // Determine who should fold to make the winner win
    let actions;
    if (winner === wallet1.address) {
        // Player2 should fold, so player1 wins
        actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.BET_RAISE, amount: 3n, sender: wallet1.address }, // Small blind raises,
            { action: ACTION.FOLD, amount: 0n, sender: wallet2.address } // Big blind folds
        ], channelId, handId);
    } else {
        // Player1 should fold, so player2 wins  
        actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.FOLD, amount: 0n, sender: wallet1.address } // Small blind folds
        ], channelId, handId);
    }

    const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
    return escrow.settle(channelId, actions, signatures);
}

describe("HeadsUpPokerEscrow", function () {
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
            await expect(escrow.connect(player1).open(channelId, player2.address, minSmallBlind, { value: deposit }))
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

                await expect(escrow.connect(player1).open(channelId, opponent, setup.minBlind, { value: setup.deposit }))
                    .to.be.revertedWithCustomError(escrow, test.error);
            });
        });

        it("should reject opening duplicate channel", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "ChannelExists");
        });

        it("should generate incremental handIds per channel", async function () {
            const channelId1 = 100n;
            const channelId2 = 101n;

            await escrow.connect(player1).open(channelId1, player2.address, 1n, { value: deposit });
            await escrow.connect(player1).open(channelId2, player2.address, 1n, { value: deposit });

            expect(await escrow.getHandId(channelId1)).to.equal(1n);
            expect(await escrow.getHandId(channelId2)).to.equal(1n);
        });
    });

    describe("Channel Joining", function () {
        const channelId = 2n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
        });

        it("should allow player2 to join the channel", async function () {
            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
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

                await expect(escrow.connect(player).join(setup.channelId, { value: setup.deposit }))
                    .to.be.revertedWithCustomError(escrow, test.error);
            });
        });

        it("should reject joining already joined channel", async function () {
            await escrow.connect(player2).join(channelId, { value: deposit });
            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "AlreadyJoined");
        });
    });

    describe("Fold Settlement", function () {
        const channelId = 3n;
        const handId = 1n; // Use the handId from the channel
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should allow fold settlement for player1 as winner", async function () {
            // Create scenario where player2 (big blind) folds, making player1 the winner
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.BET_RAISE, amount: 3n, sender: player1.address }, // Small blind raises,
                { action: ACTION.FOLD, amount: 0n, sender: player2.address } // Big blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1+3, 2) = min(4, 2) = 2
            const calledAmount = 2n;

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player1.address, calledAmount);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + calledAmount);
            expect(p2Stack).to.equal(deposit - calledAmount);
        });

        it("should allow fold settlement for player2 as winner", async function () {
            // Create scenario where player1 (small blind) folds, making player2 the winner
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address } // Small blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1, 2) = 1
            const calledAmount = 1n;

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player2.address, calledAmount);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit - calledAmount);
            expect(p2Stack).to.equal(deposit + calledAmount);
        });

        it("should reject fold settlement with invalid signatures", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Sign with wrong players
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            const domain = domainSeparator(await escrow.getAddress(), chainId);
            const digest = actionDigest(domain, actions[0]);
            const sig = wallet3.signingKey.sign(digest).serialized;
            const badSignatures = [sig, signatures[1], signatures[2]];

            await expect(escrow.settle(channelId, actions, badSignatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongSigner");
        });

        it("should settle fold with valid co-signed action transcript", async function () {
            // Create a valid fold scenario: blinds + small blind folds
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address } // Small blind folds
            ], channelId, handId);

            // Sign all actions with both players
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1, 2) = 1
            const calledAmount = 1n;

            // Should succeed and declare player2 (big blind) as winner
            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player2.address, calledAmount);

            // Verify only called amount transfers
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit - calledAmount);
            expect(p2Stack).to.equal(deposit + calledAmount);
        });

        it("should reject settlement with invalid signatures", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Sign with wrong players (other instead of player2)
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            const domain = domainSeparator(await escrow.getAddress(), chainId);
            const digest = actionDigest(domain, actions[0]);
            const sig = wallet3.signingKey.sign(digest).serialized;
            const badSignatures = [sig, signatures[1], signatures[2]];

            await expect(escrow.settle(channelId, actions, badSignatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongSigner");
        });

        it("should reject settlement with wrong channel ID in actions", async function () {
            const wrongChannelId = 999n;
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], wrongChannelId, handId); // Wrong channel ID

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongChannel");
        });

        it("should reject settlement with wrong hand ID in actions", async function () {
            const wrongHandId = 999n;
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, wrongHandId); // Wrong hand ID

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongHand");
        });

        it("should reject settlement with empty actions array", async function () {
            const actions = [];
            const signatures = [];

            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "NoActionsProvided");
        });

        it("should reject settlement with mismatched signature count", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Provide wrong number of signatures (only 2 instead of 3)
            const badSignatures = signatures.slice(0, 2);

            await expect(escrow.settle(channelId, actions, badSignatures))
                .to.be.revertedWithCustomError(escrow, "ActionSignatureLengthMismatch");
        });

        it("should reject duplicate settlement", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.BET_RAISE, amount: 3n, sender: player1.address }, // Small blind raises,
                { action: ACTION.FOLD, amount: 0n, sender: player2.address } // Big blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1+3, 2) = min(4, 2) = 2
            const calledAmount = 2n;

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player1.address, calledAmount);
            await expect(escrow.settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "AlreadyFinalized");
        });

        it("should handle big blind fold scenario correctly", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.BET_RAISE, amount: 3n, sender: player1.address }, // Small blind raises,
                { action: ACTION.FOLD, amount: 0n, sender: player2.address } // Big blind folds
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Calculate expected called amount: min(1+3, 2) = 2
            const calledAmount = 2n;

            const tx = await escrow.settle(channelId, actions, signatures);
            await expect(tx)
                .to.emit(escrow, "Settled")
                .withArgs(channelId, player1.address, calledAmount);

            // Verify only called amount transfers
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + calledAmount);
            expect(p2Stack).to.equal(deposit - calledAmount);
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
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit1 });

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit1);
            expect(p2Stack).to.equal(0);
        });

        it("should return correct stacks after joining", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit1 });
            await escrow.connect(player2).join(channelId, { value: deposit2 });

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
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);
            await escrow.connect(player1).withdraw(channelId);

            // Second game - should be able to reuse the same channel
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 2n, 1n);

            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
                .to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, deposit);
        });

        // Table-driven tests for reuse scenarios
        const reuseScenarios = [
            {
                name: "allow reopening with remaining deposits",
                beforeWithdraw: true,
                expectSuccess: true
            },
            {
                name: "accumulate winnings without withdrawal",
                beforeWithdraw: false,
                expectSuccess: true,
                testWinnings: true
            }
        ];

        reuseScenarios.forEach(scenario => {
            it(`should ${scenario.name}`, async function () {
                await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
                await escrow.connect(player2).join(channelId, { value: deposit });
                await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);

                if (scenario.beforeWithdraw) {
                    // Don't withdraw, try to reopen with remaining deposits
                    await expect(escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit }))
                        .to.emit(escrow, "ChannelOpened")
                        .withArgs(channelId, player1.address, player2.address, deposit, 2n, 1n);
                } else if (scenario.testWinnings) {
                    // Check winnings accumulation
                    let [p1Stack, _] = await escrow.stacks(channelId);
                    expect(p1Stack).to.equal(deposit + 2n); // Won BB

                    // Second game without withdrawing
                    await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
                    await escrow.connect(player2).join(channelId, { value: deposit });
                    // reverse order of wallets since player1 is now BB
                    await settleBasicFold(escrow, channelId, player2.address, wallet2, wallet1, chainId);

                    // Check accumulated winnings
                    [p1Stack, p2Stack] = await escrow.stacks(channelId);
                    expect(p1Stack).to.equal(deposit * 2n + 3n); // Accumulated winnings
                }
            });
        });

        it("should handle zero ETH deposits using existing winnings", async function () {
            // First game
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);

            // Second game using existing winnings (0 ETH)
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, { value: 0 }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 0, 2n, 1n);

            // Player2 joins normally
            await escrow.connect(player2).join(channelId, { value: deposit });

            // Verify combined deposits preserved previous winnings
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + 2n); // Player1's existing winnings
            expect(p2Stack).to.equal(deposit - 2n + deposit); // Player2's new deposit
        });

        it("should reject opening channel that is not finalized", async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await expect(escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "ChannelExists");
        });
    });

    describe("Pot to Deposit", function () {
        const channelId = 12n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should add fold settlement called amount to winner's deposit", async function () {
            await settleBasicFold(escrow, channelId, player1.address, wallet1, wallet2, chainId);

            // Player1 wins scenario: contributions are 4 vs 2, called amount = 2
            const calledAmount = 2n;
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit + calledAmount);
            expect(p2Stack).to.equal(deposit - calledAmount);
        });

        it("should add fold settlement called amount to player2's deposit", async function () {
            await settleBasicFold(escrow, channelId, player2.address, wallet1, wallet2, chainId);

            // Player2 wins scenario: contributions are 1 vs 2, called amount = 1
            const calledAmount = 1n;
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit - calledAmount);
            expect(p2Stack).to.equal(deposit + calledAmount);
        });
    });

    describe("Withdraw Function", function () {
        const channelId = 13n;
        const handId = 1n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
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
            await escrow.connect(player1).open(newChannelId, player2.address, 1n, { value: deposit });

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