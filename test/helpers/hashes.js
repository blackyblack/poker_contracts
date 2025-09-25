const { ethers } = require("ethers");
const crypto = require("crypto");

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

/**
 * Derive A-specific cryptographic parameters from handKey and cardId
 * @param {string} handKeyA - 32-byte hex string hand key for player A
 * @param {number} cardId - Card identifier (0-51 for standard deck)
 * @returns {Object} Object containing { uid, label, kA, nonceA }
 */
function deriveA(handKeyA, cardId) {
    // Ensure handKeyA is a proper hex string
    const keyBuffer = Buffer.from(handKeyA.replace('0x', ''), 'hex');
    
    // uid = HMAC(handKeyA, "uid|"+cardId)
    const uidMessage = `uid|${cardId}`;
    const uid = crypto.createHmac('sha256', keyBuffer).update(uidMessage, 'utf8').digest();
    
    // label = SHA256(uid) (32B)
    const label = crypto.createHash('sha256').update(uid).digest();
    
    // kA = HMAC(handKeyA, "Akey|"+label) (32B)
    const kAMessage = Buffer.concat([Buffer.from('Akey|', 'utf8'), label]);
    const kA = crypto.createHmac('sha256', keyBuffer).update(kAMessage).digest();
    
    // nonceA = HMAC(handKeyA, "Anon|"+label)[0..11] (12B)
    const nonceMessage = Buffer.concat([Buffer.from('Anon|', 'utf8'), label]);
    const nonceFullHmac = crypto.createHmac('sha256', keyBuffer).update(nonceMessage).digest();
    const nonceA = nonceFullHmac.subarray(0, 12);
    
    return {
        uid: '0x' + uid.toString('hex'),
        label: '0x' + label.toString('hex'),
        kA: '0x' + kA.toString('hex'),
        nonceA: '0x' + nonceA.toString('hex')
    };
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
    deriveA
};
