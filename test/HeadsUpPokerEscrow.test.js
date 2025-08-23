const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HeadsUpPokerEscrow", function () {
  let escrow;
  let owner, player1, player2, other;
  
  beforeEach(async function () {
    [owner, player1, player2, other] = await ethers.getSigners();
    
    const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
    escrow = await HeadsUpPokerEscrow.deploy();
  });

  describe("Channel Creation", function () {
    const channelId = ethers.keccak256(ethers.toUtf8Bytes("test-channel-1"));
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
        .to.be.revertedWith("NO_DEPOSIT");
    });

    it("should reject opening channel with invalid opponent", async function () {
      await expect(escrow.connect(player1).open(channelId, ethers.ZeroAddress, { value: deposit }))
        .to.be.revertedWith("BAD_OPP");
      
      await expect(escrow.connect(player1).open(channelId, player1.address, { value: deposit }))
        .to.be.revertedWith("BAD_OPP");
    });

    it("should reject opening duplicate channel", async function () {
      await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
      
      await expect(escrow.connect(player1).open(channelId, player2.address, { value: deposit }))
        .to.be.revertedWith("EXISTS");
    });
  });

  describe("Channel Joining", function () {
    const channelId = ethers.keccak256(ethers.toUtf8Bytes("test-channel-2"));
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
      const nonExistentId = ethers.keccak256(ethers.toUtf8Bytes("non-existent"));
      
      await expect(escrow.connect(player2).join(nonExistentId, { value: deposit }))
        .to.be.revertedWith("NO_CHANNEL");
    });

    it("should reject joining by wrong player", async function () {
      await expect(escrow.connect(other).join(channelId, { value: deposit }))
        .to.be.revertedWith("NOT_OPP");
    });

    it("should reject joining with zero deposit", async function () {
      await expect(escrow.connect(player2).join(channelId, { value: 0 }))
        .to.be.revertedWith("NO_DEPOSIT");
    });

    it("should reject joining already joined channel", async function () {
      await escrow.connect(player2).join(channelId, { value: deposit });
      
      await expect(escrow.connect(player2).join(channelId, { value: deposit }))
        .to.be.revertedWith("JOINED");
    });
  });

  describe("Fold Settlement", function () {
    const channelId = ethers.keccak256(ethers.toUtf8Bytes("test-channel-3"));
    const deposit = ethers.parseEther("1.0");

    beforeEach(async function () {
      await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
      await escrow.connect(player2).join(channelId, { value: deposit });
    });

    it("should allow fold settlement for player1 as winner", async function () {
      const initialBalance = await player1.getBalance();
      
      await expect(escrow.settleFold(channelId, player1.address))
        .to.emit(escrow, "FoldSettled")
        .withArgs(channelId, player1.address, deposit.mul(2));

      const finalBalance = await player1.getBalance();
      expect(finalBalance.sub(initialBalance)).to.equal(deposit.mul(2));

      const [p1Stack, p2Stack] = await escrow.stacks(channelId);
      expect(p1Stack).to.equal(0);
      expect(p2Stack).to.equal(0);
    });

    it("should allow fold settlement for player2 as winner", async function () {
      const initialBalance = await player2.getBalance();
      
      await expect(escrow.settleFold(channelId, player2.address))
        .to.emit(escrow, "FoldSettled")
        .withArgs(channelId, player2.address, deposit.mul(2));

      const finalBalance = await player2.getBalance();
      expect(finalBalance.sub(initialBalance)).to.equal(deposit.mul(2));
    });

    it("should reject fold settlement with invalid winner", async function () {
      await expect(escrow.settleFold(channelId, other.address))
        .to.be.revertedWith("NOT_PLAYER");
    });

    it("should reject fold settlement with no pot", async function () {
      const emptyChannelId = ethers.keccak256(ethers.toUtf8Bytes("empty-channel"));
      
      await expect(escrow.settleFold(emptyChannelId, player1.address))
        .to.be.revertedWith("NO_POT");
    });
  });

  describe("Showdown Flow", function () {
    const channelId = ethers.keccak256(ethers.toUtf8Bytes("test-channel-4"));
    const deposit = ethers.parseEther("1.0");
    
    // Test hole cards and salt
    const card1_p1 = 1, card2_p1 = 2;
    const card1_p2 = 3, card2_p2 = 4;
    const salt_p1 = ethers.keccak256(ethers.toUtf8Bytes("salt1"));
    const salt_p2 = ethers.keccak256(ethers.toUtf8Bytes("salt2"));
    
    let commit_p1, commit_p2;

    beforeEach(async function () {
      await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
      await escrow.connect(player2).join(channelId, { value: deposit });
      
      commit_p1 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "uint8", "bytes32"], [card1_p1, card2_p1, salt_p1]
      ));
      commit_p2 = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "uint8", "bytes32"], [card1_p2, card2_p2, salt_p2]
      ));
    });

    describe("Committing Hole Cards", function () {
      it("should allow players to commit hole cards", async function () {
        await expect(escrow.connect(player1).startShowdown(channelId, commit_p1))
          .to.emit(escrow, "HoleCardsCommitted")
          .withArgs(channelId, player1.address, commit_p1);
      });

      it("should start showdown when both players commit", async function () {
        await escrow.connect(player1).startShowdown(channelId, commit_p1);
        
        await expect(escrow.connect(player2).startShowdown(channelId, commit_p2))
          .to.emit(escrow, "HoleCardsCommitted")
          .withArgs(channelId, player2.address, commit_p2)
          .and.to.emit(escrow, "ShowdownStarted")
          .withArgs(channelId);
      });

      it("should reject commitment by non-players", async function () {
        await expect(escrow.connect(other).startShowdown(channelId, commit_p1))
          .to.be.revertedWith("NOT_PLAYER");
      });

      it("should reject double commitment", async function () {
        await escrow.connect(player1).startShowdown(channelId, commit_p1);
        
        await expect(escrow.connect(player1).startShowdown(channelId, commit_p1))
          .to.be.revertedWith("COMMITTED");
      });

      it("should reject commitment on channel not ready", async function () {
        const newChannelId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("not-ready"));
        await escrow.connect(player1).open(newChannelId, player2.address, { value: deposit });
        
        await expect(escrow.connect(player1).startShowdown(newChannelId, commit_p1))
          .to.be.revertedWith("NOT_READY");
      });
    });

    describe("Revealing Hole Cards", function () {
      beforeEach(async function () {
        await escrow.connect(player1).startShowdown(channelId, commit_p1);
        await escrow.connect(player2).startShowdown(channelId, commit_p2);
      });

      it("should allow revealing hole cards with correct salt", async function () {
        await expect(escrow.connect(player1).revealHoleCards(channelId, card1_p1, card2_p1, salt_p1))
          .to.emit(escrow, "HoleCardsRevealed")
          .withArgs(channelId, player1.address, card1_p1, card2_p1);
      });

      it("should reject revealing with incorrect salt", async function () {
        const wrongSalt = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
        
        await expect(escrow.connect(player1).revealHoleCards(channelId, card1_p1, card2_p1, wrongSalt))
          .to.be.revertedWith("BAD_REVEAL");
      });

      it("should reject revealing by non-players", async function () {
        await expect(escrow.connect(other).revealHoleCards(channelId, card1_p1, card2_p1, salt_p1))
          .to.be.revertedWith("NOT_PLAYER");
      });

      it("should reject double reveal", async function () {
        await escrow.connect(player1).revealHoleCards(channelId, card1_p1, card2_p1, salt_p1);
        
        await expect(escrow.connect(player1).revealHoleCards(channelId, card1_p1, card2_p1, salt_p1))
          .to.be.revertedWith("REVEALED");
      });

      it("should reject reveal before showdown started", async function () {
        const newChannelId = ethers.keccak256(ethers.toUtf8Bytes("no-showdown"));
        await escrow.connect(player1).open(newChannelId, player2.address, { value: deposit });
        await escrow.connect(player2).join(newChannelId, { value: deposit });
        
        await expect(escrow.connect(player1).revealHoleCards(newChannelId, card1_p1, card2_p1, salt_p1))
          .to.be.revertedWith("NO_SHOWDOWN");
      });
    });

    describe("Finalizing Showdown", function () {
      beforeEach(async function () {
        await escrow.connect(player1).startShowdown(channelId, commit_p1);
        await escrow.connect(player2).startShowdown(channelId, commit_p2);
        await escrow.connect(player1).revealHoleCards(channelId, card1_p1, card2_p1, salt_p1);
        await escrow.connect(player2).revealHoleCards(channelId, card1_p2, card2_p2, salt_p2);
      });

      it("should finalize showdown with player1 as winner", async function () {
        const initialBalance = await player1.getBalance();
        
        await expect(escrow.finalizeShowdown(channelId, player1.address))
          .to.emit(escrow, "ShowdownFinalized")
          .withArgs(channelId, player1.address, deposit.mul(2));

        const finalBalance = await player1.getBalance();
        expect(finalBalance.sub(initialBalance)).to.equal(deposit.mul(2));

        const [p1Stack, p2Stack] = await escrow.stacks(channelId);
        expect(p1Stack).to.equal(0);
        expect(p2Stack).to.equal(0);
      });

      it("should finalize showdown with player2 as winner", async function () {
        const initialBalance = await player2.getBalance();
        
        await expect(escrow.finalizeShowdown(channelId, player2.address))
          .to.emit(escrow, "ShowdownFinalized")
          .withArgs(channelId, player2.address, deposit.mul(2));

        const finalBalance = await player2.getBalance();
        expect(finalBalance.sub(initialBalance)).to.equal(deposit.mul(2));
      });

      it("should reject finalizing with invalid winner", async function () {
        await expect(escrow.finalizeShowdown(channelId, other.address))
          .to.be.revertedWith("NOT_PLAYER");
      });

      it("should reject double finalization", async function () {
        await escrow.finalizeShowdown(channelId, player1.address);
        
        await expect(escrow.finalizeShowdown(channelId, player2.address))
          .to.be.revertedWith("FINALIZED");
      });

      it("should reject finalizing before both reveals", async function () {
        const newChannelId = ethers.keccak256(ethers.toUtf8Bytes("partial-reveal"));
        await escrow.connect(player1).open(newChannelId, player2.address, { value: deposit });
        await escrow.connect(player2).join(newChannelId, { value: deposit });
        await escrow.connect(player1).startShowdown(newChannelId, commit_p1);
        await escrow.connect(player2).startShowdown(newChannelId, commit_p2);
        await escrow.connect(player1).revealHoleCards(newChannelId, card1_p1, card2_p1, salt_p1);
        
        await expect(escrow.finalizeShowdown(newChannelId, player1.address))
          .to.be.revertedWith("NOT_REVEALED");
      });

      it("should reject finalizing before showdown started", async function () {
        const newChannelId = ethers.keccak256(ethers.toUtf8Bytes("no-showdown-2"));
        await escrow.connect(player1).open(newChannelId, player2.address, { value: deposit });
        await escrow.connect(player2).join(newChannelId, { value: deposit });
        
        await expect(escrow.finalizeShowdown(newChannelId, player1.address))
          .to.be.revertedWith("NO_SHOWDOWN");
      });
    });
  });

  describe("Security and Access Control", function () {
    const channelId = ethers.keccak256(ethers.toUtf8Bytes("security-test"));
    const deposit = ethers.parseEther("1.0");

    it("should prevent fold settlement during showdown", async function () {
      await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
      await escrow.connect(player2).join(channelId, { value: deposit });
      
      const commit = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "uint8", "bytes32"], [1, 2, ethers.keccak256(ethers.toUtf8Bytes("salt"))]
      ));
      
      await escrow.connect(player1).startShowdown(channelId, commit);
      await escrow.connect(player2).startShowdown(channelId, commit);
      
      await expect(escrow.settleFold(channelId, player1.address))
        .to.be.revertedWith("SHOWDOWN");
    });
  });

  describe("View Functions", function () {
    const channelId = ethers.keccak256(ethers.toUtf8Bytes("view-test"));
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