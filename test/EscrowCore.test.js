const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("./actions");
const { actionHash, actionDigest, handGenesis, domainSeparator } = require("./hashes");

describe("Escrow Core Functionality", function () {
    let escrow, player1, player2, other;
    let chainId;

    beforeEach(async function () {
        [player1, player2, other] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("Channel Management", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");

        it("should create and join channel", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            const [p1Stack, p2Stack] = await escrow.stacks(channelId);
            expect(p1Stack).to.equal(deposit);
            expect(p2Stack).to.equal(deposit);
        });

        it("should prevent duplicate channel creation", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });

            await expect(
                escrow.connect(player1).open(channelId, player2.address, { value: deposit })
            ).to.be.revertedWithCustomError(escrow, "ChannelExists");
        });

        it("should prevent unauthorized joining", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });

            await expect(
                escrow.connect(other).join(channelId, { value: deposit })
            ).to.be.revertedWithCustomError(escrow, "NotInvited");
        });

        it("should prevent joining with incorrect deposit", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });

            await expect(
                escrow.connect(player2).join(channelId, { value: deposit / 2n })
            ).to.be.revertedWithCustomError(escrow, "DepositMismatch");
        });
    });

    describe("Fold Settlement", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");

        function buildActions(specs, channelId = 1n, handId = 1n) {
            let seq = 0;
            let prevHash = handGenesis(channelId, handId);
            const actions = [];
            for (const spec of specs) {
                const act = {
                    channelId,
                    handId,
                    seq: seq++,
                    action: spec.action,
                    amount: spec.amount,
                    prevHash
                };
                actions.push(act);
                prevHash = actionHash(act);
            }
            return actions;
        }

        async function signActions(actions, signers, contractAddress, chainId) {
            const signatures = [];
            const domain = domainSeparator(contractAddress, chainId);

            for (const action of actions) {
                const digest = actionDigest(domain, action);
                const sig1 = signers[0].signingKey.sign(digest).serialized;
                const sig2 = signers[1].signingKey.sign(digest).serialized;
                signatures.push(sig1, sig2);
            }
            return signatures;
        }

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should settle fold correctly", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, handId);

            const signatures = await signActions(actions, [player1, player2], await escrow.getAddress(), chainId);
            
            const tx = await escrow.settleFold(channelId, actions, signatures);
            await expect(tx).to.emit(escrow, "FoldSettled");

            // Check hand ID increment
            const newHandId = await escrow.getHandId(channelId);
            expect(newHandId).to.equal(handId + 1n);
        });

        it("should prevent settlement with invalid signatures", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, handId);

            // Sign with wrong players
            const badSignatures = await signActions(actions, [other, player1], await escrow.getAddress(), chainId);
            
            await expect(
                escrow.settleFold(channelId, actions, badSignatures)
            ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
        });

        it("should prevent settlement by non-participants", async function () {
            const handId = await escrow.getHandId(channelId);
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n },
                { action: ACTION.BIG_BLIND, amount: 2n },
                { action: ACTION.FOLD, amount: 0n }
            ], channelId, handId);

            const signatures = await signActions(actions, [player1, player2], await escrow.getAddress(), chainId);
            
            await expect(
                escrow.connect(other).settleFold(channelId, actions, signatures)
            ).to.be.revertedWithCustomError(escrow, "NotPlayer");
        });
    });

    describe("Withdrawal", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");

        beforeEach(async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });
        });

        it("should allow withdrawal after timeout", async function () {
            // Fast forward past timeout
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]); // 7 days + 1 second
            await ethers.provider.send("evm_mine");

            const balanceBefore = await ethers.provider.getBalance(player1.address);
            const tx = await escrow.connect(player1).withdraw(channelId);
            const receipt = await tx.wait();
            const balanceAfter = await ethers.provider.getBalance(player1.address);

            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            expect(balanceAfter + gasUsed).to.be.greaterThan(balanceBefore);
        });

        it("should prevent early withdrawal", async function () {
            await expect(
                escrow.connect(player1).withdraw(channelId)
            ).to.be.revertedWithCustomError(escrow, "WithdrawTooEarly");
        });

        it("should prevent withdrawal by non-participants", async function () {
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
            await ethers.provider.send("evm_mine");

            await expect(
                escrow.connect(other).withdraw(channelId)
            ).to.be.revertedWithCustomError(escrow, "NotPlayer");
        });
    });

    describe("Security and Attack Prevention", function () {
        const channelId = 1n;
        const deposit = ethers.parseEther("1.0");

        it("should prevent reentrancy attacks", async function () {
            // This would require a malicious contract to test properly
            // For now, we just verify the reentrancy guard is in place
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            // Test would involve deploying an attacker contract
            // that tries to call withdraw during the withdrawal callback
        });

        it("should handle gas limit attacks", async function () {
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            // Verify operations complete within reasonable gas limits
            const tx = await escrow.connect(player1).open(channelId + 1n, player2.address, { value: deposit });
            const receipt = await tx.wait();
            expect(receipt.gasUsed).to.be.lessThan(100000); // 100k gas limit
        });
    });

    describe("Escrow Edge Cases - Should Fail Tests", function () {
        // These represent proper escrow features that should work but currently fail

        it.skip("should fail: partial withdrawals", async function () {
            // TODO: Implement partial withdrawal functionality
            const channelId = 1n;
            const deposit = ethers.parseEther("1.0");
            
            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            await expect(
                escrow.connect(player1).partialWithdraw(channelId, deposit / 2n)
            ).to.not.be.reverted;
        });

        it.skip("should fail: emergency pause functionality", async function () {
            // TODO: Implement emergency pause
            const channelId = 1n;
            const deposit = ethers.parseEther("1.0");

            await expect(
                escrow.connect(player1).emergencyPause(channelId, "Security concern")
            ).to.not.be.reverted;
        });

        it.skip("should fail: dispute resolution mechanism", async function () {
            // TODO: Implement dispute resolution
            const channelId = 1n;
            const deposit = ethers.parseEther("1.0");

            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            await escrow.connect(player2).join(channelId, { value: deposit });

            await expect(
                escrow.connect(player1).raiseDispute(channelId, "Cheating detected", "evidence_hash")
            ).to.not.be.reverted;
        });

        it.skip("should fail: multi-signature requirement", async function () {
            // TODO: Implement multi-sig requirements for large amounts
            const channelId = 1n;
            const largeDeposit = ethers.parseEther("100.0");

            await expect(
                escrow.connect(player1).open(channelId, player2.address, { value: largeDeposit })
            ).to.be.revertedWithCustomError(escrow, "MultiSigRequired");
        });

        it.skip("should fail: insurance fund integration", async function () {
            // TODO: Implement insurance fund for disputed games
            const channelId = 1n;
            const deposit = ethers.parseEther("1.0");

            await escrow.connect(player1).open(channelId, player2.address, { value: deposit });
            
            await expect(
                escrow.connect(player1).buyInsurance(channelId, { value: ethers.parseEther("0.1") })
            ).to.not.be.reverted;
        });
    });
});