const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO32 = "0x" + "00".repeat(32);

const GENESIS = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256"], ["HUP_GENESIS", 1n]));

const DOMAIN_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
  )
);
const NAME_HASH = ethers.keccak256(ethers.toUtf8Bytes("HeadsUpPoker"));
const VERSION_HASH = ethers.keccak256(ethers.toUtf8Bytes("1"));
const CARD_COMMIT_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "CardCommit(uint256 channelId,uint32 seq,uint8 role,uint8 index,bytes32 commitHash,bytes32 prevHash)"
  )
);

// Hardhat default account private keys
const wallet1 = new ethers.Wallet(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const wallet2 = new ethers.Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const wallet3 = new ethers.Wallet(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
);

function domainSeparator(contract, chainId) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, contract]
    )
  );
}

function toSlotKey(role, index) {
  if (role === 0 && index < 2) return index;
  if (role === 1 && index < 2) return 2 + index;
  if (role === 2 && index < 5) return 4 + index;
  throw new Error("bad role/index");
}

function commitHash(dom, channelId, slot, card, salt) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint256", "uint8", "uint8", "bytes32"],
      [dom, channelId, slot, card, salt]
    )
  );
}

function commitDigest(dom, cc) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const structHash = ethers.keccak256(
    abi.encode(
      [
        "bytes32",
        "uint256",
        "uint32",
        "uint8",
        "uint8",
        "bytes32",
        "bytes32",
      ],
      [
        CARD_COMMIT_TYPEHASH,
        cc.channelId,
        cc.seq,
        cc.role,
        cc.index,
        cc.commitHash,
        cc.prevHash,
      ]
    )
  );
  return ethers.keccak256(ethers.concat(["0x1901", dom, structHash]));
}

async function signCommit(a, b, dom, cc) {
  const digest = commitDigest(dom, cc);
  const sigA = a.signingKey.sign(digest).serialized;
  const sigB = b.signingKey.sign(digest).serialized;
  return [sigA, sigB];
}

async function buildCommit(a, b, dom, channelId, role, index, card, seq) {
  const slot = toSlotKey(role, index);
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const cHash = commitHash(dom, channelId, slot, card, salt);
  const cc = {
    channelId,
    seq,
    role,
    index,
    commitHash: cHash,
    prevHash: GENESIS,
  };
  const [sigA, sigB] = await signCommit(a, b, dom, cc);
  return { cc, sigA, sigB, salt, card, slot };
}

describe("verifyCoSignedCommits & startShowdown", function () {
  let escrow;
  let player1, player2;
  const channelId = 1n;
  const deposit = ethers.parseEther("1");

  beforeEach(async () => {
    [player1, player2] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
    escrow = await Escrow.deploy();
    await escrow.open(channelId, player2.address, { value: deposit });
    await escrow.connect(player2).join(channelId, { value: deposit });
  });

  async function setup() {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const dom = domainSeparator(escrow.target, chainId);

    const board = [1, 2, 3, 4, 5];
    const myHole = [10, 11];
    const oppHole = [20, 21];

    const commits = [];
    const sigs = [];
    const objs = [];

    const parts = [
      [0, 0, myHole[0]],
      [0, 1, myHole[1]],
      [1, 0, oppHole[0]],
      [1, 1, oppHole[1]],
      [2, 0, board[0]],
      [2, 1, board[1]],
      [2, 2, board[2]],
      [2, 3, board[3]],
      [2, 4, board[4]],
    ];

    for (let i = 0; i < parts.length; i++) {
      const [role, index, card] = parts[i];
      const obj = await buildCommit(
        wallet1,
        wallet2,
        dom,
        channelId,
        role,
        index,
        card,
        i
      );
      commits.push(obj.cc);
      sigs.push(obj.sigA, obj.sigB);
      objs.push(obj);
    }

    const boardSalts = [
      objs[4].salt,
      objs[5].salt,
      objs[6].salt,
      objs[7].salt,
      objs[8].salt,
    ];
    const mySalts = [objs[0].salt, objs[1].salt];

    return { commits, sigs, board, boardSalts, myHole, mySalts, objs, dom };
  }

  it("reverts on duplicate slot commit", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts, objs } = await setup();
    commits[3] = objs[2].cc;
    sigs[6] = objs[2].sigA;
    sigs[7] = objs[2].sigB;

    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
    )
      .to.be.revertedWithCustomError(escrow, "CommitDuplicate")
      .withArgs(2);
  });

  it("reverts on wrong channelId", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    commits[0].channelId = channelId + 1n;

    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
    )
      .to.be.revertedWithCustomError(escrow, "CommitWrongChannel")
      .withArgs(0);
  });

  it("reverts on bad B signature", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts, objs, dom } = await setup();
    const digest = commitDigest(dom, objs[2].cc);
    const badSig = wallet3.signingKey.sign(digest).serialized;
    sigs[5] = badSig; // B signature for commit index2

    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts)
    )
      .to.be.revertedWithCustomError(escrow, "CommitWrongSignerB")
      .withArgs(2);
  });

  it("allows partial commit sets", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    // Remove the last commit (river card)
    const partialCommits = commits.slice(0, -1);
    const partialSigs = sigs.slice(0, -2);
    // Set river card and salt to 0 since it's not committed
    const partialBoard = [...board];
    partialBoard[4] = 0;
    const partialBoardSalts = [...boardSalts];
    partialBoardSalts[4] = ZERO32;

    const _tx = await escrow
      .connect(player1)
      .startShowdown(channelId, partialCommits, partialSigs, partialBoard, partialBoardSalts, myHole, mySalts);
    
    const sd = await escrow.getShowdown(channelId);
    expect(sd.inProgress).to.equal(true);
    // Check that the commit mask reflects the partial set (all except river)
    expect(Number(sd.lockedCommitMask)).to.equal(0xFF); // bits 0..7 set
  });

  it("happy path stores hashes and cards", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts, objs } = await setup();
    const tx = await escrow
      .connect(player1)
      .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts);
    const rcpt = await tx.wait();
    const block = await ethers.provider.getBlock(rcpt.blockNumber);

    const sd = await escrow.getShowdown(channelId);
    expect(sd.initiator).to.equal(player1.address);
    expect(sd.opponent).to.equal(player2.address);
    expect(sd.inProgress).to.equal(true);
    const window = await escrow.revealWindow();
    expect(sd.deadline).to.equal(BigInt(block.timestamp) + window);
    expect(sd.board.map(Number)).to.deep.equal(board);
    expect(sd.initiatorHole.map(Number)).to.deep.equal(myHole);
    expect(sd.oppHoleHash1).to.equal(objs[2].cc.commitHash);
    expect(sd.oppHoleHash2).to.equal(objs[3].cc.commitHash);
  });

  it("allows submitting additional commits during reveal window", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    
    // Start with partial commits (missing river card)
    const partialCommits = commits.slice(0, -1);
    const partialSigs = sigs.slice(0, -2);
    const partialBoard = [...board];
    partialBoard[4] = 0;
    const partialBoardSalts = [...boardSalts];
    partialBoardSalts[4] = ZERO32;

    await escrow
      .connect(player1)
      .startShowdown(channelId, partialCommits, partialSigs, partialBoard, partialBoardSalts, myHole, mySalts);

    // Submit additional commit for river card
    const riverCommit = commits[8]; // River card commit
    // Also submit turn card to pass overlap check
    const turnCommit = commits[7]; // Turn card commit
    const riverSigs = [sigs[16], sigs[17]]; // River card signatures
    const turnSigs = [sigs[14], sigs[15]]; // Turn card signatures
    const fullBoard = board;
    const fullBoardSalts = boardSalts;

    await escrow
      .connect(player2)
      .submitAdditionalCommits(
        channelId,
        [turnCommit, riverCommit],
        [...turnSigs, ...riverSigs],
        fullBoard,
        fullBoardSalts,
        myHole,
        mySalts
      );

    const sd = await escrow.getShowdown(channelId);
    expect(Number(sd.lockedCommitMask)).to.equal(0x1FF); // All slots now committed
  });

  it("allows forfeit finalization when opponent holes not opened", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    
    // Start with commits that don't include opponent holes
    const partialCommits = commits.slice(0, 2).concat(commits.slice(4)); // Skip opponent holes
    const partialSigs = [];
    for (let i = 0; i < 2; i++) {
      partialSigs.push(sigs[i * 2], sigs[i * 2 + 1]);
    }
    for (let i = 4; i < 9; i++) {
      partialSigs.push(sigs[i * 2], sigs[i * 2 + 1]);
    }

    await escrow
      .connect(player1)
      .startShowdown(channelId, partialCommits, partialSigs, board, boardSalts, myHole, mySalts);

    // Fast forward past reveal window
    await ethers.provider.send("evm_increaseTime", [3601]); // 1 hour + 1 second
    await ethers.provider.send("evm_mine");

    const initialBalance = await ethers.provider.getBalance(player1.address);

    // Finalize - should forfeit to initiator (player1)
    await escrow.finalizeShowdownWithCommits(channelId, [0, 0], [ZERO32, ZERO32]);

    const finalBalance = await ethers.provider.getBalance(player1.address);
    expect(finalBalance).to.be.greaterThan(initialBalance);
  });

  it("allows third party to start showdown on behalf of player1", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    const [, , thirdParty] = await ethers.getSigners();
    
    const tx = await escrow
      .connect(thirdParty)
      .startShowdownOnBehalfOf(channelId, commits, sigs, board, boardSalts, myHole, mySalts, player1.address);
    const rcpt = await tx.wait();
    const block = await ethers.provider.getBlock(rcpt.blockNumber);

    const sd = await escrow.getShowdown(channelId);
    expect(sd.initiator).to.equal(player1.address);
    expect(sd.opponent).to.equal(player2.address);
    expect(sd.inProgress).to.equal(true);
    const window = await escrow.revealWindow();
    expect(sd.deadline).to.equal(BigInt(block.timestamp) + window);
  });

  it("allows third party to start showdown on behalf of player2", async () => {
    const { commits, sigs, board, boardSalts, objs } = await setup();
    const [, , thirdParty] = await ethers.getSigners();

    const myHole = [objs[2].card, objs[3].card];
    const mySalts = [objs[2].salt, objs[3].salt];
    const _tx = await escrow
      .connect(thirdParty)
      .startShowdownOnBehalfOf(channelId, commits, sigs, board, boardSalts, myHole, mySalts, player2.address);

    const sd = await escrow.getShowdown(channelId);
    expect(sd.initiator).to.equal(player2.address);
    expect(sd.opponent).to.equal(player1.address);
    expect(sd.inProgress).to.equal(true);
  });

  it("reverts when third party tries to start showdown for invalid player", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    const [, , thirdParty] = await ethers.getSigners();
    
    await expect(
      escrow
        .connect(thirdParty)
        .startShowdownOnBehalfOf(channelId, commits, sigs, board, boardSalts, myHole, mySalts, thirdParty.address)
    ).to.be.revertedWith("NOT_PLAYER");
  });

  it("allows third party to submit additional commits on behalf of player", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    const [, , thirdParty] = await ethers.getSigners();
    
    // Start with partial commits (missing river card)
    const partialCommits = commits.slice(0, -1);
    const partialSigs = sigs.slice(0, -2);
    const partialBoard = [...board];
    partialBoard[4] = 0;
    const partialBoardSalts = [...boardSalts];
    partialBoardSalts[4] = ZERO32;

    await escrow
      .connect(player1)
      .startShowdown(channelId, partialCommits, partialSigs, partialBoard, partialBoardSalts, myHole, mySalts);

    // Third party submits additional commit for river card on behalf of player2
    const riverCommit = commits[8]; // River card commit
    const turnCommit = commits[7]; // Turn card commit
    const riverSigs = [sigs[16], sigs[17]]; // River card signatures
    const turnSigs = [sigs[14], sigs[15]]; // Turn card signatures
    const fullBoard = board;
    const fullBoardSalts = boardSalts;

    await escrow
      .connect(thirdParty)
      .submitAdditionalCommitsOnBehalfOf(
        channelId,
        [turnCommit, riverCommit],
        [...turnSigs, ...riverSigs],
        fullBoard,
        fullBoardSalts,
        myHole,
        mySalts,
        player2.address
      );

    const sd = await escrow.getShowdown(channelId);
    expect(Number(sd.lockedCommitMask)).to.equal(0x1FF); // All slots now committed
  });

  it("reverts when third party tries to submit commits for invalid player", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    const [, , thirdParty] = await ethers.getSigners();
    
    // Start showdown first
    await escrow
      .connect(player1)
      .startShowdown(channelId, commits, sigs, board, boardSalts, myHole, mySalts);

    // Third party tries to submit for invalid player
    await expect(
      escrow
        .connect(thirdParty)
        .submitAdditionalCommitsOnBehalfOf(
          channelId,
          [],
          [],
          board,
          boardSalts,
          myHole,
          mySalts,
          thirdParty.address
        )
    ).to.be.revertedWith("NOT_PLAYER");
  });

  it("reverts when initiator does not provide both hole cards", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    
    // Create commits without initiator's hole cards (player1's holes are slots 0,1)
    const partialCommits = commits.slice(2); // Skip player1's holes (commits[0], commits[1])
    const partialSigs = sigs.slice(4); // Skip corresponding signatures
    
    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, partialCommits, partialSigs, board, boardSalts, myHole, mySalts)
    ).to.be.revertedWith("INITIATOR_HOLES_REQUIRED");
  });

  it("reverts when initiator provides only one hole card", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    
    // Create commits with only one of initiator's hole cards
    const partialCommits = [commits[0]].concat(commits.slice(2)); // Include only first hole card
    const partialSigs = [sigs[0], sigs[1]].concat(sigs.slice(4)); // Include corresponding sigs
    
    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, partialCommits, partialSigs, board, boardSalts, myHole, mySalts)
    ).to.be.revertedWith("INITIATOR_HOLES_REQUIRED");
  });

  it("reverts when player2 initiator does not provide both hole cards", async () => {
    const { commits, sigs, board, boardSalts, objs } = await setup();
    
    // When player2 initiates, they need to provide their hole cards (commits[2], commits[3])
    const player2Hole = [objs[2].card, objs[3].card];
    const player2Salts = [objs[2].salt, objs[3].salt];
    
    // Create commits without player2's hole cards (slots 2,3)
    const partialCommits = commits.slice(0, 2).concat(commits.slice(4)); // Skip player2's holes
    const partialSigs = sigs.slice(0, 4).concat(sigs.slice(8)); // Skip corresponding signatures
    
    await expect(
      escrow
        .connect(player2)
        .startShowdown(channelId, partialCommits, partialSigs, board, boardSalts, player2Hole, player2Salts)
    ).to.be.revertedWith("INITIATOR_HOLES_REQUIRED");
  });
});
