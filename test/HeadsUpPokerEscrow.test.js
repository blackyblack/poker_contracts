const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HeadsUpPokerEscrow", function () {
    let escrow;
    let player1, player2, other;

    beforeEach(async function () {
        [player1, player2, other] = await ethers.getSigners();

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("Channel Creation", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");

        it("should allow player1 to open a channel", async function () {
            await expect(escrow.connect(player1).open(channelId, player2.address, { value: deposit }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 1n); // Added handId as 5th argument

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(0);
            
            // Verify handId is set correctly
            const handId = await escrow.getHandId(channelId);
            expect(handId).to.equal(1n);
        });

        it("should reject opening channel with zero deposit", async function () {
            await expect(escrow.connect(player1).open(channelId, player2.address, { value: 0 }))
                .to.be.revertedWithCustomError(escrow, "NoDeposit");
        });

        it("should reject opening channel with invalid opponent", async function () {
            await expect(escrow.connect(player1).open(channelId, ethers.ZeroAddress, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "BadOpponent");

            await expect(escrow.connect(player1).open(channelId, player1.address, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "BadOpponent");
        });

        it("should generate local handIds per channel", async function () {
            const channelId1 = 100n;
            const channelId2 = 101n;
            
            await escrow.connect(player1).open(channelId1, player2.address, { value: deposit });
            const handId1 = await escrow.getHandId(channelId1);
            
            await escrow.connect(player1).open(channelId2, player2.address, { value: deposit });
            const handId2 = await escrow.getHandId(channelId2);
            
            // Both channels should start with handId = 1 (local to each channel)
            expect(handId1).to.equal(1n);
            expect(handId2).to.equal(1n);
        });

        it("should increment handId when same channel is reused", async function () {
            const channelId = 200n;
            
            // First hand in the channel
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            
            const handId1 = await escrow.getHandId(channelId);
            expect(handId1).to.equal(1n);
            
            // Simulate ending the first hand by settling on fold
            // This will finalize the channel and allow reuse
            await escrow.connect(player1).settleFold(channelId, player2.address);
            
            // Check channel is finalized
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(deposit * 2n); // Winner gets all
            
            // Both players withdraw their winnings
            await escrow.connect(player2).withdraw(channelId);
            
            // Verify channel is ready for reuse (deposits are 0)
            const [p1StackAfter, p2StackAfter] = await escrow.stacks(channelId);
            expect(p1StackAfter).to.equal(0);
            expect(p2StackAfter).to.equal(0);
            
            // Second hand in the same channel - should get handId = 2
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            const handId2 = await escrow.getHandId(channelId);
            expect(handId2).to.equal(2n);
        });
    });

    describe("Channel Joining", function () {
        const channelId = 2n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
        });

        it("should allow player2 to join the channel", async function () {
            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
                .to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, deposit);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(deposit);
        });

        it("should reject joining non-existent channel", async function () {
            const nonExistentId = 999n;

            await expect(escrow.connect(player2).join(nonExistentId, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "NoChannel");
        });

        it("should reject joining by wrong player", async function () {
            await expect(escrow.connect(other).join(channelId, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "NotOpponent");
        });

        it("should reject joining with zero deposit", async function () {
            await expect(escrow.connect(player2).join(channelId, { value: 0 }))
                .to.be.revertedWithCustomError(escrow, "NoDeposit");
        });

        it("should reject joining already joined channel", async function () {
            await escrow.connect(player2).join(channelId, { value: deposit });

            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "AlreadyJoined");
        });
    });

    describe("Fold Settlement", function () {
        const channelId = 3n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should allow fold settlement for player1 as winner", async function () {
            const tx = await escrow.settleFold(channelId, player1.address);
            await expect(tx)
                .to.emit(escrow, "FoldSettled")
                .withArgs(channelId, player1.address, deposit * 2n);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);
        });

        it("should allow fold settlement for player2 as winner", async function () {
            const tx = await escrow.settleFold(channelId, player2.address);
            await expect(tx)
                .to.emit(escrow, "FoldSettled")
                .withArgs(channelId, player2.address, deposit * 2n);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(deposit * 2n);
        });

        it("should reject fold settlement with invalid winner", async function () {
            await expect(escrow.settleFold(channelId, other.address))
                .to.be.revertedWithCustomError(escrow, "NotPlayer");
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
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit1 });

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit1);
            expect(p2Stack).to.equal(0);
        });

        it("should return correct stacks after joining", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit1 });
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
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            // Player1 wins by fold
            await escrow.settleFold(channelId, player1.address);

            // Check that player1 has the pot in their deposit
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);

            // Player1 withdraws winnings
            await escrow.connect(player1).withdraw(channelId);

            // Verify deposits are now zero
            const [p1StackAfter, p2StackAfter] = await escrow.stacks(channelId);
            expect(p1StackAfter).to.equal(0);
            expect(p2StackAfter).to.equal(0);

            // Second game - should be able to reuse the same channel
            await expect(escrow.connect(player1).open(channelId, player2.address, { value: deposit }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 2n);

            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
                .to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, deposit);

            const [p1StackSecond, p2StackSecond] = await escrow.stacks(channelId);
            expect(p1StackSecond).to.equal(deposit);
            expect(p2StackSecond).to.equal(deposit);
        });

        it("should reject opening channel that is not finalized", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });

            // Try to open again without finalizing first game
            await expect(escrow.connect(player1).open(channelId, player2.address, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "ChannelExists");
        });

        it("should allow reopening channel with remaining deposits", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            // Settle fold but don't withdraw
            await escrow.settleFold(channelId, player1.address);

            // Should now allow reopening while player1 still has winnings in deposit
            await expect(escrow.connect(player1).open(channelId, player2.address, { value: deposit }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, deposit, 2n);
        });

        it("should allow accumulating winnings without withdrawal", async function () {
            // First game
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);

            // Check winnings from first game
            let [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);

            // Second game without withdrawing - should be allowed now
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);

            // Check accumulated winnings from both games
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 4n); // Won both games
            expect(p2Stack).to.equal(0);
        });

        it("should allow winner to accumulate winnings over multiple games", async function () {
            // First game
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);

            // Check winnings from first game
            let [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);

            // Withdraw winnings
            await escrow.connect(player1).withdraw(channelId);

            // Second game with different stakes
            const deposit2 = ethers.parseEther("2.0");
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit2 });
            await escrow.connect(player2).join(channelId, { value: deposit2 });
            await escrow.settleFold(channelId, player1.address);

            // Check winnings from second game
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit2 * 2n);
            expect(p2Stack).to.equal(0);
        });

        it("should allow opening with zero ETH using existing deposits", async function () {
            // First game
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);

            // Check winnings from first game
            let [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);

            // Second game using existing winnings (0 ETH)
            await expect(escrow.connect(player1).open(channelId, player2.address, { value: 0 }))
                .to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 0, 2n);

            // Check that deposit1 is preserved from previous game
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n); // Same as before
            expect(p2Stack).to.equal(0);

            // Player2 joins normally
            await escrow.connect(player2).join(channelId, { value: deposit });
            
            // Check combined deposits
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n); // Player1's existing winnings
            expect(p2Stack).to.equal(deposit); // Player2's new deposit
        });

        it("should allow both players to use existing deposits with zero ETH", async function () {
            // First game - player2 wins
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player2.address);

            // Check winnings
            let [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(deposit * 2n);

            // Second game - both use existing winnings (player1 has none, player2 has winnings)
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit }); // Player1 adds new money
            
            // Player2 joins with zero ETH using existing winnings
            await expect(escrow.connect(player2).join(channelId, { value: 0 }))
                .to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, 0);

            // Check combined deposits
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit); // Player1's new deposit
            expect(p2Stack).to.equal(deposit * 2n); // Player2's existing winnings (unchanged)
        });

        it("should accumulate deposits correctly (critical bug fix test)", async function () {
            // First game - player1 wins
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);

            let [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n); // Won the pot
            expect(p2Stack).to.equal(0);

            // Second game - player1 adds more money (testing critical bug fix)
            const additionalDeposit = ethers.parseEther("0.5");
            await escrow.connect(player1).open(channelId, player2.address, { value: additionalDeposit });

            // CRITICAL: Check that previous winnings are NOT lost (bug was: deposit1 = msg.value instead of +=)
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n + additionalDeposit); // Previous winnings + new deposit
            expect(p2Stack).to.equal(0);

            // Player2 joins and they both play again
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);

            // Verify final accumulation
            [p1Stack, p2Stack] = await escrow.stacks(channelId);
            const expectedTotal = deposit * 2n + additionalDeposit + deposit; // All money goes to winner
            expect(p1Stack).to.equal(expectedTotal);
            expect(p2Stack).to.equal(0);
        });

        it("should reject joining a finalized channel", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            // Finalize via fold settlement
            await escrow.settleFold(channelId, player1.address);

            // Attempt to join again should fail (channel is finalized)
            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "AlreadyFinalized");
        });

        it("should reject joining after withdrawal (channel must be reopened)", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);
            await escrow.connect(player1).withdraw(channelId);

            // After withdrawal the channel should require a fresh open; join must fail
            await expect(escrow.connect(player2).join(channelId, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "AlreadyFinalized");
        });
    });

    describe("Pot to Deposit", function () {
        const channelId = 12n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should add fold settlement pot to winner's deposit", async function () {
            await escrow.settleFold(channelId, player1.address);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit * 2n);
            expect(p2Stack).to.equal(0);
        });

        it("should add fold settlement pot to player2's deposit", async function () {
            await escrow.settleFold(channelId, player2.address);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(deposit * 2n);
        });
    });

    describe("Withdraw Function", function () {
        const channelId = 13n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
            await escrow.settleFold(channelId, player1.address);
        });

        it("should allow winner to withdraw their balance", async function () {
            const initialBalance = await ethers.provider.getBalance(player1.address);

            const tx = await escrow.connect(player1).withdraw(channelId);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const finalBalance = await ethers.provider.getBalance(player1.address);

            // Should receive pot minus gas costs
            expect(finalBalance).to.be.closeTo(initialBalance + (deposit * 2n) - gasUsed, ethers.parseEther("0.001"));

            // Check deposits are zero after withdrawal
            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(0);
        });

        it("should reject withdrawal from non-finalized channel", async function () {
            const newChannelId = 14n;
            await escrow.connect(player1).open(newChannelId, player2.address, { value: deposit });

            await expect(escrow.connect(player1).withdraw(newChannelId))
                .to.be.revertedWithCustomError(escrow, "NotFinalized");
        });

        it("should reject withdrawal with no balance", async function () {
            await expect(escrow.connect(player2).withdraw(channelId))
                .to.be.revertedWithCustomError(escrow, "NoBalance");
        });

        it("should reject withdrawal by non-player", async function () {
            await expect(escrow.connect(other).withdraw(channelId))
                .to.be.revertedWithCustomError(escrow, "NoBalance");
        });
    });
});