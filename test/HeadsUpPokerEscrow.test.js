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
                .withArgs(channelId, player1.address, player2.address, deposit);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(0);
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
            const initialBalance = await ethers.provider.getBalance(player1.address);

            const tx = await escrow.settleFold(channelId, player1.address);
            await expect(tx)
                .to.emit(escrow, "FoldSettled")
                .withArgs(channelId, player1.address, deposit * 2n);

            const finalBalance = await ethers.provider.getBalance(player1.address);
            expect(finalBalance).to.be.greaterThan(initialBalance);

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(0);
            expect(p2Stack).to.equal(0);
        });

        it("should allow fold settlement for player2 as winner", async function () {
            const initialBalance = await ethers.provider.getBalance(player2.address);

            const tx = await escrow.settleFold(channelId, player2.address);
            await expect(tx)
                .to.emit(escrow, "FoldSettled")
                .withArgs(channelId, player2.address, deposit * 2n);

            const finalBalance = await ethers.provider.getBalance(player2.address);
            expect(finalBalance).to.be.greaterThan(initialBalance);
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
});