const { ethers } = require("hardhat");

const ZERO32 = "0x" + "00".repeat(32);

const DOMAIN_TYPEHASH = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    )
);
const ACTION_TYPEHASH = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(
        "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash,address sender)"
    )
);
const CARD_COMMIT_TYPEHASH = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(
        "CardCommit(uint256 channelId,uint256 handId,uint8 slot,bytes32 commitHash,bytes32 prevHash)"
    )
);

const GENESIS = ethers.utils.keccak256(
    ethers.utils.solidityPack(["string", "uint256"], ["HUP_GENESIS", 1n]));

function handGenesis(channelId, handId) {
    return ethers.utils.keccak256(
        ethers.utils.solidityPack(["string", "uint256", "uint256"], ["HUP_GENESIS", channelId, handId]));
}

const NAME_HASH = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("HeadsUpPoker"));
const VERSION_HASH = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("1"));

function domainSeparator(contract, chainId) {
    const abi = ethers.utils.defaultAbiCoder;
    return ethers.utils.keccak256(
        abi.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, contract]
        )
    );
}

function commitHash(dom, channelId, slot, card, salt) {
    return ethers.utils.keccak256(
        ethers.utils.solidityPack(
            ["bytes32", "uint256", "uint8", "uint8", "bytes32"],
            [dom, channelId, slot, card, salt]
        )
    );
}

function cardCommitDigest(dom, cc) {
    const abi = ethers.utils.defaultAbiCoder;
    const structHash = ethers.utils.keccak256(
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
    return ethers.utils.keccak256(ethers.utils.concat(["0x1901", dom, structHash]));
}

function actionHash(action) {
    const abi = ethers.utils.defaultAbiCoder;
    return ethers.utils.keccak256(
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
    return ethers.utils.keccak256(
        ethers.utils.concat([
            ethers.utils.toUtf8Bytes("\x19\x01"),
            dom,
            structHash
        ])
    );
}

module.exports = {
    ZERO32,
    DOMAIN_TYPEHASH,
    ACTION_TYPEHASH,
    CARD_COMMIT_TYPEHASH,
    GENESIS,
    NAME_HASH,
    VERSION_HASH,
    handGenesis,
    domainSeparator,
    commitHash,
    cardCommitDigest,
    actionHash,
    actionDigest
};
