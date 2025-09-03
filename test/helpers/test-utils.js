const { ethers } = require("hardhat");
const { actionHash, actionDigest, handGenesis, domainSeparator, commitHash, cardCommitDigest } = require("./hashes");

// Standard test wallet private keys
const wallet1 = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const wallet2 = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const wallet3 = new ethers.Wallet(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
);

/**
 * Helper to build actions with proper hashes and sequence numbers
 * @param {Array} specs - Array of action specifications {action, amount}
 * @param {bigint} channelId - Channel ID (default: 1n)
 * @param {bigint} handId - Hand ID (default: 1n)
 * @returns {Array} Array of action objects
 */
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

/**
 * Helper to sign actions
 * @param {Array} actions - Array of actions to sign
 * @param {Array} signers - Array of wallet signers
 * @param {string} contractAddress - Contract address for domain separator
 * @param {bigint} chainId - Chain ID for domain separator
 * @returns {Array} Array of signatures
 */
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

/**
 * Helper to sign a commit for a card
 * @param {Object} a - First wallet signer
 * @param {Object} b - Second wallet signer
 * @param {string} dom - Domain separator
 * @param {Object} cc - Card commit object
 * @returns {Array} Array of two signatures [sigA, sigB]
 */
async function signCardCommit(a, b, dom, cc) {
    const digest = cardCommitDigest(dom, cc);
    const sigA = a.signingKey.sign(digest).serialized;
    const sigB = b.signingKey.sign(digest).serialized;
    return [sigA, sigB];
}

/**
 * Helper to build a card commit with signatures
 * @param {Object} a - First wallet signer
 * @param {Object} b - Second wallet signer
 * @param {string} dom - Domain separator
 * @param {bigint} channelId - Channel ID
 * @param {number} slot - Card slot
 * @param {number} card - Card value
 * @param {bigint} handId - Hand ID (default: 1n)
 * @returns {Object} Commit object with signatures and metadata
 */
async function buildCardCommit(a, b, dom, channelId, slot, card, handId = 1n) {
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const cHash = commitHash(dom, channelId, slot, card, salt);
    const cc = {
        channelId,
        handId,
        slot,
        commitHash: cHash,
        prevHash: handGenesis(channelId, handId),
    };
    const [sigA, sigB] = await signCardCommit(a, b, dom, cc);
    return { cc, sigA, sigB, salt, card, slot };
}

module.exports = {
    wallet1,
    wallet2,
    wallet3,
    buildActions,
    signActions,
    signCardCommit,
    buildCardCommit
};