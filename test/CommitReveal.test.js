const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZERO32, domainSeparator, commitHash, cardCommitDigest, handGenesis } = require("./hashes");
const { SLOT } = require("./slots");

describe("Commit-Reveal Security", function () {
    let escrow, player1, player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");

    // Test wallets for signing
    const wallet1 = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    const wallet2 = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const wallet3 = new ethers.Wallet("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

    beforeEach(async () => {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();
        await escrow.open(channelId, player2.address, { value: deposit });
        await escrow.connect(player2).join(channelId, { value: deposit });
    });

    async function signCommit(a, b, dom, cc) {
        const digest = cardCommitDigest(dom, cc);
        const sigA = a.signingKey.sign(digest).serialized;
        const sigB = b.signingKey.sign(digest).serialized;
        return [sigA, sigB];
    }

    async function buildCommit(a, b, dom, channelId, slot, card, handId = 1n) {
        const salt = ethers.hexlify(ethers.randomBytes(32));
        const cHash = commitHash(dom, channelId, slot, card, salt);
        const cc = {
            channelId,
            handId,
            slot,
            commitHash: cHash,
            prevHash: handGenesis(channelId, handId),
        };
        const [sigA, sigB] = await signCommit(a, b, dom, cc);
        return { cc, sigA, sigB, salt, card, slot };
    }

    async function setupBasicCommits() {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const dom = domainSeparator(escrow.target, chainId);

        const board = [1, 2, 3, 4, 5];
        const myHole = [10, 11];
        const oppHole = [20, 21];

        const commits = [];
        const sigs = [];
        const objs = [];

        const cardSlotPairs = [
            [SLOT.A1, myHole[0]], [SLOT.A2, myHole[1]],
            [SLOT.B1, oppHole[0]], [SLOT.B2, oppHole[1]],
            [SLOT.FLOP1, board[0]], [SLOT.FLOP2, board[1]], [SLOT.FLOP3, board[2]],
            [SLOT.TURN, board[3]], [SLOT.RIVER, board[4]]
        ];

        for (const [slot, card] of cardSlotPairs) {
            const obj = await buildCommit(wallet1, wallet2, dom, channelId, slot, card);
            commits.push(obj.cc);
            sigs.push(obj.sigA, obj.sigB);
            objs.push(obj);
        }

        const boardSalts = board.map((_, i) => objs[i + 4].salt);
        const mySalts = myHole.map((_, i) => objs[i].salt);

        return { commits, sigs, board, boardSalts, myHole, mySalts, objs, dom };
    }

    describe("Commit Validation", function () {
        it("should reject duplicate slot commits", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts, objs } = await setupBasicCommits();
            
            // Create duplicate by copying commit
            commits[3] = objs[2].cc;
            sigs[6] = objs[2].sigA;
            sigs[7] = objs[2].sigB;

            await expect(
                escrow.connect(player1)
                    .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
            ).to.be.revertedWithCustomError(escrow, "CommitDuplicate")
              .withArgs(2);
        });

        it("should reject commits for wrong channel", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();
            commits[0].channelId = channelId + 1n;

            await expect(
                escrow.connect(player1)
                    .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
            ).to.be.revertedWithCustomError(escrow, "CommitWrongChannel")
              .withArgs(0);
        });

        it("should reject invalid signatures", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts, objs, dom } = await setupBasicCommits();
            
            // Sign with wrong wallet
            const digest = cardCommitDigest(dom, objs[2].cc);
            const badSig = wallet3.signingKey.sign(digest).serialized;
            sigs[5] = badSig; // B signature for commit index 2

            await expect(
                escrow.connect(player1)
                    .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
            ).to.be.revertedWithCustomError(escrow, "CommitWrongSignerB")
              .withArgs(2);
        });
    });

    describe("Reveal Phase Security", function () {
        it("should handle partial commit sets", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();
            
            // Remove river card commit
            const partialCommits = commits.slice(0, -1);
            const partialSigs = sigs.slice(0, -2);
            const partialBoard = [...board];
            partialBoard[4] = 0;
            const partialBoardSalts = [...boardSalts];
            partialBoardSalts[4] = ZERO32;

            await escrow.connect(player1)
                .startShowdown(channelId, partialCommits, partialSigs, partialBoard, partialBoardSalts, myHole, mySalts);

            const sd = await escrow.getShowdown(channelId);
            expect(sd.inProgress).to.equal(true);
            expect(Number(sd.lockedCommitMask)).to.equal(0xFF); // All except river
        });

        it("should allow submitting additional commits during reveal", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            // Start with partial commits
            const partialCommits = commits.slice(0, -1);
            const partialSigs = sigs.slice(0, -2);
            const partialBoard = [...board];
            partialBoard[4] = 0;
            const partialBoardSalts = [...boardSalts];
            partialBoardSalts[4] = ZERO32;

            await escrow.connect(player1)
                .startShowdown(channelId, partialCommits, partialSigs, partialBoard, partialBoardSalts, myHole, mySalts);

            // Submit additional commits
            const riverCommit = commits[8];
            const turnCommit = commits[7];
            const riverSigs = [sigs[16], sigs[17]];
            const turnSigs = [sigs[14], sigs[15]];

            await escrow.connect(player2)
                .submitAdditionalCommits(
                    channelId,
                    [turnCommit, riverCommit],
                    [...turnSigs, ...riverSigs],
                    board,
                    boardSalts,
                    myHole,
                    mySalts
                );

            const sd = await escrow.getShowdown(channelId);
            expect(Number(sd.lockedCommitMask)).to.equal(0x1FF); // All slots committed
        });

        it("should prevent commit hash mismatches", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts, dom } = await setupBasicCommits();

            await escrow.connect(player1)
                .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts);

            // Try to override with different hash
            const newCommit = await buildCommit(wallet1, wallet2, dom, channelId, SLOT.A1, 15);

            await expect(
                escrow.connect(player1)
                    .submitAdditionalCommits(
                        channelId,
                        [newCommit.cc],
                        [newCommit.sigA, newCommit.sigB],
                        board,
                        boardSalts,
                        [15, myHole[1]],
                        [newCommit.salt, mySalts[1]]
                    )
            ).to.be.revertedWithCustomError(escrow, "HashMismatch");
        });

        it("should allow resubmitting identical commits", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            await escrow.connect(player1)
                .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts);

            // Resubmit same commit
            await escrow.connect(player1)
                .submitAdditionalCommits(
                    channelId,
                    [commits[0]],
                    [sigs[0], sigs[1]],
                    board,
                    boardSalts,
                    myHole,
                    mySalts
                );

            const sd = await escrow.getShowdown(channelId);
            expect(Number(sd.lockedCommitMask)).to.equal(0x1FF);
        });
    });

    describe("Third Party Actions", function () {
        it("should allow third party to start showdown on behalf of player", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();
            const [,, thirdParty] = await ethers.getSigners();

            const tx = await escrow.connect(thirdParty)
                .startShowdownOnBehalfOf(channelId, commits, sigs, board, boardSalts, myHole, mySalts, player1.address);

            const sd = await escrow.getShowdown(channelId);
            expect(sd.initiator).to.equal(player1.address);
            expect(sd.inProgress).to.equal(true);
        });

        it("should reject third party actions for invalid players", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();
            const [,, thirdParty] = await ethers.getSigners();

            await expect(
                escrow.connect(thirdParty)
                    .startShowdownOnBehalfOf(channelId, commits, sigs, board, boardSalts, myHole, mySalts, thirdParty.address)
            ).to.be.revertedWithCustomError(escrow, "NotPlayer");
        });
    });

    describe("Forfeit and Timeout Handling", function () {
        it("should handle forfeit when opponent doesn't reveal", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            // Start without opponent holes
            const partialCommits = commits.slice(0, 2).concat(commits.slice(4));
            const partialSigs = [];
            for (let i = 0; i < 2; i++) {
                partialSigs.push(sigs[i * 2], sigs[i * 2 + 1]);
            }
            for (let i = 4; i < 9; i++) {
                partialSigs.push(sigs[i * 2], sigs[i * 2 + 1]);
            }

            await escrow.connect(player1)
                .startShowdown(channelId, partialCommits, partialSigs, board, boardSalts, myHole, mySalts);

            // Fast forward past reveal window
            await ethers.provider.send("evm_increaseTime", [3601]);
            await ethers.provider.send("evm_mine");

            const [initialBalance,] = await escrow.stacks(channelId);

            // Finalize with forfeit
            await escrow.finalizeShowdownWithCommits(channelId, [0, 0], [ZERO32, ZERO32]);

            const [finalBalance,] = await escrow.stacks(channelId);
            expect(finalBalance).to.be.greaterThan(initialBalance);
        });
    });

    describe("Attack Prevention", function () {
        it("should require initiator to provide both hole cards", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            // Skip initiator's hole cards
            const partialCommits = commits.slice(2);
            const partialSigs = sigs.slice(4);

            await expect(
                escrow.connect(player1)
                    .startShowdown(channelId, partialCommits, partialSigs, board, boardSalts, myHole, mySalts)
            ).to.be.revertedWithCustomError(escrow, "InitiatorHolesRequired");
        });

        it("should prevent showdown replay attacks", async () => {
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            await escrow.connect(player1)
                .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts);

            // Fast forward and finalize
            await ethers.provider.send("evm_increaseTime", [3601]);
            await ethers.provider.send("evm_mine");
            await escrow.finalizeShowdownWithCommits(channelId, [0, 0], [ZERO32, ZERO32]);

            // Attempt second showdown should fail
            await expect(
                escrow.connect(player1)
                    .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
            ).to.be.revertedWithCustomError(escrow, "ShowdownAlreadyInProgress");
        });
    });

    describe("Commit-Reveal Edge Cases - Should Fail Tests", function () {
        // These represent proper commit-reveal features that should work but currently fail

        it.skip("should fail: commit binding to specific game state", async function () {
            // TODO: Implement game state binding
            // Commits should be bound to specific game state to prevent reuse
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            // Use commits from different game state
            await expect(
                escrow.connect(player1)
                    .startShowdown(channelId + 1n, commits, sigs, board, boardSalts, myHole, mySalts)
            ).to.be.revertedWithCustomError(escrow, "CommitGameStateMismatch");
        });

        it.skip("should fail: time-locked reveals", async function () {
            // TODO: Implement time-locked reveals
            // Should prevent revealing cards before commit phase is complete
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            // Try to reveal immediately after committing
            await escrow.connect(player1)
                .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts);

            await expect(
                escrow.finalizeShowdownWithCommits(channelId, [20, 21], [ethers.ZeroHash, ethers.ZeroHash])
            ).to.be.revertedWithCustomError(escrow, "RevealTooEarly");
        });

        it.skip("should fail: commit freshness validation", async function () {
            // TODO: Implement commit freshness
            // Should prevent reusing old commits from previous games
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            // Mark commits as stale
            await ethers.provider.send("evm_increaseTime", [86400]); // 24 hours
            await ethers.provider.send("evm_mine");

            await expect(
                escrow.connect(player1)
                    .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
            ).to.be.revertedWithCustomError(escrow, "CommitsStale");
        });

        it.skip("should fail: verifiable random card generation", async function () {
            // TODO: Implement verifiable randomness
            // Card commits should include proof of randomness
            const { commits, sigs, board, boardSalts, myHole, mySalts } = await setupBasicCommits();

            await expect(
                escrow.connect(player1)
                    .startShowdownWithRandomnessProof(channelId, commits, sigs, board, boardSalts, myHole, mySalts, "randomness_proof")
            ).to.not.be.reverted;
        });
    });
});