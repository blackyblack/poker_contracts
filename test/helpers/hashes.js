const { ethers } = require("ethers");
const { hkdf } = require("@noble/hashes/hkdf");
const { sha256 } = require("@noble/hashes/sha256");

const ZERO32 = "0x" + "00".repeat(32);

const DOMAIN_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    )
);
const ACTION_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
        "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash,address sender)"
    )
);
const CARD_COMMIT_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
        "CardCommit(uint256 channelId,uint256 handId,uint8 slot,bytes32 commitHash,bytes32 prevHash)"
    )
);

const GENESIS = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256"], ["HUP_GENESIS", 1n]));

function handGenesis(channelId, handId) {
    return ethers.keccak256(
        ethers.solidityPacked(["string", "uint256", "uint256"], ["HUP_GENESIS", channelId, handId]));
}

const NAME_HASH = ethers.keccak256(ethers.toUtf8Bytes("HeadsUpPoker"));
const VERSION_HASH = ethers.keccak256(ethers.toUtf8Bytes("1"));

function domainSeparator(contract, chainId) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    return ethers.keccak256(
        abi.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, contract]
        )
    );
}

function commitHash(dom, channelId, slot, card, salt) {
    return ethers.keccak256(
        ethers.solidityPacked(
            ["bytes32", "uint256", "uint8", "uint8", "bytes32"],
            [dom, channelId, slot, card, salt]
        )
    );
}

function cardCommitDigest(dom, cc) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const structHash = ethers.keccak256(
        abi.encode(
            [
                "bytes32",
                "uint256",
                "uint256",
                "uint8",
                "bytes32",
                "bytes32",
            ],
            [
                CARD_COMMIT_TYPEHASH,
                cc.channelId,
                cc.handId,
                cc.slot,
                cc.commitHash,
                cc.prevHash,
            ]
        )
    );
    return ethers.keccak256(ethers.concat(["0x1901", dom, structHash]));
}

function actionHash(action) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    return ethers.keccak256(
        abi.encode(
            ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32", "address"],
            [
                ACTION_TYPEHASH,
                action.channelId,
                action.handId,
                action.seq,
                action.action,
                action.amount,
                action.prevHash,
                action.sender
            ]
        )
    );
}

function actionDigest(dom, action) {
    const structHash = actionHash(action);
    return ethers.keccak256(
        ethers.concat([
            ethers.toUtf8Bytes("\x19\x01"),
            ethers.getBytes(dom),
            ethers.getBytes(structHash)
        ])
    );
}

function ctx(chainId, contract, channelId, handId) {
    return ethers.keccak256(
        ethers.solidityPacked(
            ["uint256", "address", "uint256", "uint256", "string"],
            [chainId, contract, channelId, handId, "mp/ctx/v1"]
        )
    );
}

function deriveHandKey(master, ctx, who) {
    if (who !== "A" && who !== "B") {
        throw new Error('who parameter must be "A" or "B"');
    }
    
    const info = ethers.toUtf8Bytes(`mp/${who}/hand`);
    const salt = ethers.getBytes(ctx);
    const masterBytes = ethers.getBytes(master);
    
    return hkdf(sha256, masterBytes, salt, info, 32);
}

module.exports = {
    DOMAIN_TYPEHASH,
    ACTION_TYPEHASH,
    CARD_COMMIT_TYPEHASH,
    GENESIS,
    ZERO32,
    NAME_HASH,
    VERSION_HASH,
    domainSeparator,
    commitHash,
    cardCommitDigest,
    actionHash,
    actionDigest,
    handGenesis,
    ctx,
    deriveHandKey
};
