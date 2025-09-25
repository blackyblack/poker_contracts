const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { buildActions, signActions, wallet1, wallet2, wallet3 } = require("../helpers/test-utils");

describe("HeadsUpPokerEscrow - Optional Signers", function () {
    let escrow;
    let player1, player2;
    let chainId;

    beforeEach(async function () {
        [player1, player2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("Channel Creation with Optional Signers", function () {
        const channelId = 1n;

        it("should allow opening channel with optional signer for player1", async function () {
            const signerAddress = wallet3.address;
            
            const handId = await escrow.connect(player1).openWithSigner.staticCall(
                channelId,
                player2.address,
                1n, // minSmallBlind
                signerAddress
            );

            await expect(
                escrow.connect(player1).openWithSigner(
                    channelId,
                    player2.address,
                    1n,
                    signerAddress,
                    { value: 10n }
                )
            ).to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 10n, handId, 1n);

            // Verify signer was set
            const [p1Signer, p2Signer] = await escrow.getSigners(channelId);
            expect(p1Signer).to.equal(signerAddress);
            expect(p2Signer).to.equal(ethers.ZeroAddress);
        });

        it("should allow joining channel with optional signer for player2", async function () {
            // Player1 opens channel first
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: 10n });

            const signerAddress = wallet3.address;
            await expect(
                escrow.connect(player2).joinWithSigner(channelId, signerAddress, { value: 10n })
            ).to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, 10n);

            // Verify signer was set
            const [p1Signer, p2Signer] = await escrow.getSigners(channelId);
            expect(p1Signer).to.equal(ethers.ZeroAddress);
            expect(p2Signer).to.equal(signerAddress);
        });

        it("should work with traditional open/join without signers", async function () {
            // This should still work as before
            const handId = await escrow.connect(player1).open.staticCall(channelId, player2.address, 1n);

            await expect(
                escrow.connect(player1).open(channelId, player2.address, 1n, { value: 10n })
            ).to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 10n, handId, 1n);

            await expect(
                escrow.connect(player2).join(channelId, { value: 10n })
            ).to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, 10n);

            // Verify no signers were set
            const [p1Signer, p2Signer] = await escrow.getSigners(channelId);
            expect(p1Signer).to.equal(ethers.ZeroAddress);
            expect(p2Signer).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Action Settlement with Optional Signers", function () {
        const channelId = 1n;
        let handId;

        beforeEach(async function () {
            // Open channel with player1 having wallet3 as optional signer
            handId = await escrow.connect(player1).openWithSigner.staticCall(
                channelId,
                player2.address,
                1n,
                wallet3.address
            );
            await escrow.connect(player1).openWithSigner(
                channelId,
                player2.address,
                1n,
                wallet3.address,
                { value: 10n }
            );

            // Join without optional signer for player2
            await escrow.connect(player2).join(channelId, { value: 10n });
        });

        it("should accept actions signed by players themselves", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Sign with the players themselves (wallet1 corresponds to player1, wallet2 to player2)
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.emit(escrow, "Settled");
        });

        it("should accept actions signed by optional signer for player1", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Sign first and third actions (player1's actions) with wallet3 (optional signer)
            // Sign second action (player2's action) with wallet2 (player2)
            const signatures = await signActions(actions, [wallet3, wallet2, wallet3], await escrow.getAddress(), chainId);

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.emit(escrow, "Settled");
        });

        it("should reject actions signed by unauthorized addresses", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Create an unauthorized wallet
            const unauthorizedWallet = ethers.Wallet.createRandom();
            
            // Try to sign all actions with unauthorized wallet
            const signatures = [];
            for (const action of actions) {
                const digest = await escrow.digestAction(action);
                const sig = unauthorizedWallet.signingKey.sign(digest).serialized;
                signatures.push(sig);
            }

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongSigner");
        });
    });
});