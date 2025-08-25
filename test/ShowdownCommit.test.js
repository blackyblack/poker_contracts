const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO32 = "0x" + "00".repeat(32);
const DOMAIN_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,uint256 channelId)"
  )
);
const NAME_HASH = ethers.keccak256(ethers.toUtf8Bytes("HeadsUpPoker"));
const VERSION_HASH = ethers.keccak256(ethers.toUtf8Bytes("1"));
const CARD_COMMIT_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "CardCommit(uint256 channelId,uint256 handId,uint32 seq,uint8 role,uint8 index,bytes32 dealRef,bytes32 commitHash,bytes32 prevHash)"
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

function domainSeparator(channelId, contract, chainId) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    abi.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address", "uint256"],
      [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, contract, channelId]
    )
  );
}

function toSlotKey(role, index) {
  if (role === 0 && index < 2) return index;
  if (role === 1 && index < 2) return 2 + index;
  if (role === 2 && index < 5) return 4 + index;
  throw new Error("bad role/index");
}

function commitHash(dom, channelId, handId, slot, dealRef, card, salt) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint256", "uint256", "uint8", "bytes32", "uint8", "bytes32"],
      [dom, channelId, handId, slot, dealRef, card, salt]
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
        "uint256",
        "uint32",
        "uint8",
        "uint8",
        "bytes32",
        "bytes32",
        "bytes32",
      ],
      [
        CARD_COMMIT_TYPEHASH,
        cc.channelId,
        cc.handId,
        cc.seq,
        cc.role,
        cc.index,
        cc.dealRef,
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

async function buildCommit(a, b, dom, channelId, handId, role, index, card, seq) {
  const slot = toSlotKey(role, index);
  const dealRef = ethers.hexlify(ethers.randomBytes(32));
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const cHash = commitHash(dom, channelId, handId, slot, dealRef, card, salt);
  const cc = {
    channelId,
    handId,
    seq,
    role,
    index,
    dealRef,
    commitHash: cHash,
    prevHash: ZERO32,
  };
  const [sigA, sigB] = await signCommit(a, b, dom, cc);
  return { cc, sigA, sigB, salt, card, slot };
}

describe("verifyCoSignedCommits & startShowdown", function () {
  let escrow;
  let player1, player2, other;
  const channelId = 1n;
  const handId = 1n;
  const deposit = ethers.parseEther("1");

  beforeEach(async () => {
    [player1, player2, other] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
    escrow = await Escrow.deploy();
    await escrow.open(channelId, player2.address, { value: deposit });
    await escrow.connect(player2).join(channelId, { value: deposit });
  });

  async function setup() {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const dom = domainSeparator(channelId, escrow.target, chainId);

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
        handId,
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
        .startShowdown(channelId, handId, commits, sigs, board, boardSalts, myHole, mySalts)
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
        .startShowdown(channelId, handId, commits, sigs, board, boardSalts, myHole, mySalts)
    )
      .to.be.revertedWithCustomError(escrow, "CommitWrongChannel")
      .withArgs(0);
  });

  it("reverts on wrong handId", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    commits[1].handId = handId + 1n;

    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, handId, commits, sigs, board, boardSalts, myHole, mySalts)
    )
      .to.be.revertedWithCustomError(escrow, "CommitWrongHand")
      .withArgs(1);
  });

  it("reverts on bad B signature", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts, objs, dom } = await setup();
    const digest = commitDigest(dom, objs[2].cc);
    const badSig = wallet3.signingKey.sign(digest).serialized;
    sigs[5] = badSig; // B signature for commit index2

    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, handId, commits, sigs, board, boardSalts, myHole, mySalts)
    )
      .to.be.revertedWithCustomError(escrow, "CommitWrongSignerB")
      .withArgs(2);
  });

  it("reverts when a slot is missing", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts } = await setup();
    commits.pop();
    sigs.pop();
    sigs.pop();

    await expect(
      escrow
        .connect(player1)
        .startShowdown(channelId, handId, commits, sigs, board, boardSalts, myHole, mySalts)
    ).to.be.revertedWith("missing commit slot(s)");
  });

  it("happy path stores hashes and cards", async () => {
    const { commits, sigs, board, boardSalts, myHole, mySalts, objs } = await setup();
    const tx = await escrow
      .connect(player1)
      .startShowdown(channelId, handId, commits, sigs, board, boardSalts, myHole, mySalts);
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
});
