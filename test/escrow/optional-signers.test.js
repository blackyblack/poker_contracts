const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ACTION } = require("../helpers/actions");
const { buildActions, signActions, buildCardCommit, wallet1, wallet2, wallet3 } = require("../helpers/test-utils");

describe("HeadsUpPokerEscrow - Optional Signers", function () {
    let escrow;
    let player1, player2, signer1, signer2;
    let chainId;

    beforeEach(async function () {
        [player1, player2, signer1, signer2] = await ethers.getSigners();
        chainId = (await ethers.provider.getNetwork()).chainId;

        const HeadsUpPokerEscrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await HeadsUpPokerEscrow.deploy();
    });

    describe("Channel Creation with Optional Signers", function () {
        const channelId = 1n;

        it("should allow opening channel with optional signer for player1", async function () {
            const handId = await escrow.openWithSigner.staticCall(
                channelId,
                player2.address,
                1n, // minSmallBlind
                signer1.address
            );

            await expect(
                escrow.connect(player1).openWithSigner(
                    channelId,
                    player2.address,
                    1n,
                    signer1.address,
                    { value: 10n }
                )
            ).to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 10n, handId, 1n);
        });

        it("should allow joining channel with optional signer for player2", async function () {
            // Player1 opens channel first
            await escrow.connect(player1).open(channelId, player2.address, 1n, { value: 10n });

            await expect(
                escrow.connect(player2).joinWithSigner(channelId, signer2.address, { value: 10n })
            ).to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, 10n);
        });

        it("should work with traditional open/join without signers", async function () {
            // This should still work as before
            const handId = await escrow.open.staticCall(channelId, player2.address, 1n);

            await expect(
                escrow.connect(player1).open(channelId, player2.address, 1n, { value: 10n })
            ).to.emit(escrow, "ChannelOpened")
                .withArgs(channelId, player1.address, player2.address, 10n, handId, 1n);

            await expect(
                escrow.connect(player2).join(channelId, { value: 10n })
            ).to.emit(escrow, "ChannelJoined")
                .withArgs(channelId, player2.address, 10n);
        });
    });

    describe("Action Settlement with Optional Signers", function () {
        const channelId = 1n;
        let handId;

        beforeEach(async function () {
            // Open channel with player1 having an optional signer
            handId = await escrow.connect(player1).openWithSigner.staticCall(
                channelId,
                player2.address,
                1n,
                signer1.address
            );
            await escrow.connect(player1).openWithSigner(
                channelId,
                player2.address,
                1n,
                signer1.address,
                { value: 10n }
            );

            // Join with player2 having an optional signer
            await escrow.connect(player2).joinWithSigner(channelId, signer2.address, { value: 10n });
        });

        it("should accept actions signed by players themselves", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Sign with the players themselves
            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.emit(escrow, "Settled");
        });

        it("should accept actions signed by optional signers", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Sign with the optional signers instead of the players
            const signatures = await signActions(actions, [wallet3, wallet2], await escrow.getAddress(), chainId);

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.emit(escrow, "Settled");
        });

        it("should accept mix of player and optional signer signatures", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Mix: first action signed by optional signer, rest by players
            const domain = await escrow.DOMAIN_SEPARATOR();
            const sig1 = wallet3.signingKey.sign(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "bytes32"],
                [domain, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32", "address"],
                    [
                        ethers.keccak256(ethers.toUtf8Bytes("Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash,address sender)")),
                        actions[0].channelId,
                        actions[0].handId,
                        actions[0].seq,
                        actions[0].action,
                        actions[0].amount,
                        actions[0].prevHash,
                        actions[0].sender
                    ]
                ))]
            ))).serialized;

            const otherSigs = await signActions(actions.slice(1), [wallet2], await escrow.getAddress(), chainId);
            const signatures = [sig1, ...otherSigs];

            await expect(escrow.connect(player1).settle(channelId, actions, signatures))
                .to.emit(escrow, "Settled");
        });

        it("should reject actions signed by unauthorized addresses", async function () {
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.FOLD, amount: 0n, sender: player1.address }
            ], channelId, handId);

            // Try to sign with completely unauthorized wallet
            const unauthorizedWallet = ethers.Wallet.createRandom();
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

    describe("Card Commits with Optional Signers", function () {
        const channelId = 1n;
        let handId;

        beforeEach(async function () {
            // Set up a game that reaches showdown
            handId = await escrow.connect(player1).openWithSigner.staticCall(
                channelId,
                player2.address,
                1n,
                signer1.address
            );
            await escrow.connect(player1).openWithSigner(
                channelId,
                player2.address,
                1n,
                signer1.address,
                { value: 10n }
            );
            await escrow.connect(player2).joinWithSigner(channelId, signer2.address, { value: 10n });

            // Create actions leading to showdown (all call through to river)
            const actions = buildActions([
                { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1.address },
                { action: ACTION.BIG_BLIND, amount: 2n, sender: player2.address },
                { action: ACTION.CHECK_CALL, amount: 1n, sender: player1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player2.address },
                { action: ACTION.CHECK_CALL, amount: 0n, sender: player1.address }
            ], channelId, handId);

            const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
            await escrow.connect(player1).settle(channelId, actions, signatures);
        });

        it("should accept card commits signed by optional signers", async function () {
            const domainSeparator = await escrow.DOMAIN_SEPARATOR();
            
            // Create card commits using optional signers instead of players
            const commit = await buildCardCommit(
                wallet3, // signer1 (optional signer for player1) 
                wallet2, // player2's wallet (no optional signer set)
                domainSeparator,
                channelId,
                0, // SLOT_A1
                10, // card value
                handId
            );

            await expect(
                escrow.connect(player1).revealCards(
                    channelId,
                    [commit.cc],
                    [commit.sigA, commit.sigB],
                    [commit.card],
                    [commit.salt]
                )
            ).to.not.be.reverted;
        });
    });
});