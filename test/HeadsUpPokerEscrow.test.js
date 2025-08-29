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

        it("should reject opening duplicate channel", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });

            await expect(escrow.connect(player1).open(channelId, player2.address, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "ChannelExists");
        });

        it("should generate monotonically increasing handIds", async function () {
            const channelId1 = 100n;
            const channelId2 = 101n;
            
            await escrow.connect(player1).open(channelId1, player2.address, { value: deposit });
            const handId1 = await escrow.getHandId(channelId1);
            
            await escrow.connect(player1).open(channelId2, player2.address, { value: deposit });
            const handId2 = await escrow.getHandId(channelId2);
            
            expect(handId2).to.be.greaterThan(handId1);
            expect(handId2).to.equal(handId1 + 1n);
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
                .withArgs(channelId, player1.address, player2.address, deposit);

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

        it("should reject opening channel with remaining deposits", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            // Settle fold but don't withdraw
            await escrow.settleFold(channelId, player1.address);

            // Try to open again while player1 still has winnings in deposit
            await expect(escrow.connect(player1).open(channelId, player2.address, { value: deposit }))
                .to.be.revertedWithCustomError(escrow, "ChannelExists");
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