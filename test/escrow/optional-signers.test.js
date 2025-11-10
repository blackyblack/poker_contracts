import { expect } from "chai";
import hre from "hardhat";
import { ACTION } from "../helpers/actions.js";
import { buildActions, signActions, wallet1, wallet2, wallet3, startGameWithDeck } from "../helpers/test-utils.js";
import { domainSeparator, actionDigest } from "../helpers/hashes.js";

const { ethers } = hre;

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

            const handId = await escrow.connect(player1).open.staticCall(
                channelId,
                player2.address,
                1n, // minSmallBlind
                signerAddress,
                0n, // slashAmount
                "0x", // publicKeyA
                { value: 10n }
            );

            await expect(
                escrow.connect(player1).open(
                    channelId,
                    player2.address,
                    1n,
                    signerAddress,
                    0n,
                    "0x",
                    { value: 10n }
                )
            ).to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 10n, handId, 1n);

            // Verify signer was set
            const channel = await escrow.getChannel(channelId);
            expect(channel.player1Signer).to.equal(signerAddress);
            expect(channel.player2Signer).to.equal(ethers.ZeroAddress);
        });

        it("should allow joining channel with optional signer for player2", async function () {
            // Player1 opens channel first
            await escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: 10n });

            const signerAddress = wallet3.address;
            await expect(
                escrow.connect(player2).join(channelId, signerAddress, "0x", { value: 10n })
            ).to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, 10n);

            // Verify signer was set
            const channel = await escrow.getChannel(channelId);
            expect(channel.player1Signer).to.equal(ethers.ZeroAddress);
            expect(channel.player2Signer).to.equal(signerAddress);
        });

        it("should work with traditional open/join without signers", async function () {
            const handId = await escrow.connect(player1).open.staticCall(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: 10n });

            await expect(
                escrow.connect(player1).open(channelId, player2.address, 1n, ethers.ZeroAddress, 0n, "0x", { value: 10n })
            ).to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 10n, handId, 1n);

            await expect(
                escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: 10n })
            ).to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, 10n);

            // Verify no signers were set
            const channel = await escrow.getChannel(channelId);
            expect(channel.player1Signer).to.equal(ethers.ZeroAddress);
            expect(channel.player2Signer).to.equal(ethers.ZeroAddress);

            // Verify additional channel information is available
            expect(channel.player1).to.equal(player1.address);
            expect(channel.player2).to.equal(player2.address);
            expect(channel.deposit1).to.equal(10n);
            expect(channel.deposit2).to.equal(10n);
            expect(channel.finalized).to.equal(false);
            expect(channel.handId).to.equal(handId);
            expect(channel.player2Joined).to.equal(true);
            expect(channel.minSmallBlind).to.equal(1n);
        });
    });

    describe("Settlement with Optional Signers", function () {
        const channelId = 1n;
        let handId;

        beforeEach(async function () {
            // Open channel with player1 having wallet3 as optional signer
            handId = await escrow.connect(player1).open.staticCall(
                channelId,
                player2.address,
                1n,
                wallet3.address,
                0n,
                "0x",
                { value: 10n }
            );
            await escrow.connect(player1).open(
                channelId,
                player2.address,
                1n,
                wallet3.address,
                0n,
                "0x",
                { value: 10n }
            );

            // Join without optional signer for player2
            await escrow.connect(player2).join(channelId, ethers.ZeroAddress, "0x", { value: 10n });

            // Start the game
            await startGameWithDeck(escrow, channelId, player1, player2);
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

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Replace player1's signature with wallet3's signature (the optional signer)
            const domain = domainSeparator(await escrow.getAddress(), chainId);
            const digest = actionDigest(domain, actions[2]);
            const sig = wallet3.signingKey.sign(digest).serialized;
            const wallet3Signatures = [signatures[0], signatures[1], sig];

            await expect(escrow.connect(player1).settle(channelId, actions, wallet3Signatures))
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

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            // Replace player1's signature with wallet3's signature (the optional signer)
            const domain = domainSeparator(await escrow.getAddress(), chainId);
            const digest = actionDigest(domain, actions[2]);
            const sig = unauthorizedWallet.signingKey.sign(digest).serialized;
            const unauthorizedSignatures = [signatures[0], signatures[1], sig];

            await expect(escrow.connect(player1).settle(channelId, actions, unauthorizedSignatures))
                .to.be.revertedWithCustomError(escrow, "ActionWrongSigner");
        });
    });
});
