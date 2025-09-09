const { ethers } = require("hardhat");
const { actionHash, actionDigest, handGenesis, domainSeparator, commitHash, cardCommitDigest } = require("./hashes");
const { ACTION } = require("./actions");

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
 * @param {Array} specs - Array of action specifications {action, amount, sender}
 * @param {bigint} channelId - Channel ID (default: 1n)
 * @param {bigint} handId - Hand ID (default: 1n)
 * @returns {Array} Array of action objects
 */
function buildActions(specs, channelId = 1n, handId = 1n) {
    let seq = 0;
    let prevHash = handGenesis(channelId, handId);
    const actions = [];
    
    for (const spec of specs) {
        if (!spec.sender) {
            throw new Error(`Action at index ${seq} must have an explicit sender address`);
        }
        
        const act = {
            channelId,
            handId,
            seq: seq++,
            action: spec.action,
            amount: spec.amount,
            prevHash,
            sender: spec.sender
        };
        actions.push(act);
        prevHash = actionHash(act);
    }
    return actions;
}

/**
 * Helper to build standard blinds actions
 * @param {bigint} sbAmount - Small blind amount
 * @param {bigint} bbAmount - Big blind amount  
 * @param {address} player1 - Player 1 address (small blind for handId % 2 == 1)
 * @param {address} player2 - Player 2 address
 * @param {bigint} handId - Hand ID to determine dealer position (default: 1n)
 * @param {bigint} channelId - Channel ID (default: 1n)
 * @returns {Array} Array of blind actions
 */
function buildBlinds(sbAmount, bbAmount, player1, player2, handId = 1n, channelId = 1n) {
    // In heads-up, dealer is small blind
    // handId % 2 determines dealer: 1 = player1, 0 = player2
    const isPlayer1Dealer = handId % 2n === 1n;
    const sbPlayer = isPlayer1Dealer ? player1 : player2;
    const bbPlayer = isPlayer1Dealer ? player2 : player1;
    
    return buildActions([
        { action: ACTION.SMALL_BLIND, amount: sbAmount, sender: sbPlayer },
        { action: ACTION.BIG_BLIND, amount: bbAmount, sender: bbPlayer }
    ], channelId, handId);
}

/**
 * Helper to build a basic fold sequence (blinds + fold)
 * @param {address} folder - Address of the player who folds
 * @param {address} player1 - Player 1 address
 * @param {address} player2 - Player 2 address
 * @param {bigint} handId - Hand ID (default: 1n)
 * @param {bigint} channelId - Channel ID (default: 1n)
 * @returns {Array} Array of actions ending in fold
 */
function buildFoldSequence(folder, player1, player2, handId = 1n, channelId = 1n) {
    const blinds = buildBlinds(1n, 2n, player1, player2, handId, channelId);
    const foldAction = buildActions([
        { action: ACTION.FOLD, amount: 0n, sender: folder }
    ], channelId, handId);
    foldAction[0].seq = 2;
    foldAction[0].prevHash = blinds[1] ? actionHash(blinds[1]) : blinds[0] ? actionHash(blinds[0]) : handGenesis(channelId, handId);
    
    return [...blinds, ...foldAction];
}

/**
 * Helper to build a check-down sequence (blinds + checks to showdown)
 * @param {address} player1 - Player 1 address
 * @param {address} player2 - Player 2 address
 * @param {bigint} handId - Hand ID (default: 1n) 
 * @param {bigint} channelId - Channel ID (default: 1n)
 * @returns {Array} Array of actions leading to showdown
 */
function buildCheckDownSequence(player1, player2, handId = 1n, channelId = 1n) {
    // Start with blinds
    const isPlayer1Dealer = handId % 2n === 1n;
    const sbPlayer = isPlayer1Dealer ? player1 : player2;
    const bbPlayer = isPlayer1Dealer ? player2 : player1;
    
    return buildActions([
        { action: ACTION.SMALL_BLIND, amount: 1n, sender: sbPlayer },
        { action: ACTION.BIG_BLIND, amount: 2n, sender: bbPlayer },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: sbPlayer }, // SB calls
        { action: ACTION.CHECK_CALL, amount: 0n, sender: bbPlayer }, // BB checks (flop)
        { action: ACTION.CHECK_CALL, amount: 0n, sender: bbPlayer }, // BB checks (first to act postflop)
        { action: ACTION.CHECK_CALL, amount: 0n, sender: sbPlayer }, // SB checks
        { action: ACTION.CHECK_CALL, amount: 0n, sender: bbPlayer }, // BB checks (turn)
        { action: ACTION.CHECK_CALL, amount: 0n, sender: sbPlayer }, // SB checks  
        { action: ACTION.CHECK_CALL, amount: 0n, sender: bbPlayer }  // BB checks (river -> showdown)
    ], channelId, handId);
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
        
        // Find which signer matches the action sender
        let signer = null;
        for (const s of signers) {
            if (s.address.toLowerCase() === action.sender.toLowerCase()) {
                signer = s;
                break;
            }
        }
        
        if (!signer) {
            throw new Error(`No signer found for sender ${action.sender}`);
        }
        
        const sig = signer.signingKey.sign(digest).serialized;
        signatures.push(sig);
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

/**
 * Helper to play a basic showdown game where player1 wins 2 chips
 */
async function playPlayer1WinsShowdown(escrow, channelId, player1, player1Wallet, player2Wallet) {
    // Simple sequence where both players put in 2 chips (blinds) and check down
    const actionSpecs = [
        { action: ACTION.SMALL_BLIND, amount: 1n, sender: player1Wallet.address },
        { action: ACTION.BIG_BLIND, amount: 2n, sender: player2Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player1Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player2Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player2Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player1Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player2Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player1Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player2Wallet.address },
        { action: ACTION.CHECK_CALL, amount: 0n, sender: player1Wallet.address }
    ];

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const handId = await escrow.getHandId(channelId);
    const actions = buildActions(actionSpecs, channelId, handId);
    const signatures = await signActions(actions, [player1Wallet, player2Wallet], await escrow.getAddress(), chainId);
    return await escrow.connect(player1).settle(channelId, actions, signatures);
}

module.exports = {
    wallet1,
    wallet2,
    wallet3,
    buildActions,
    buildBlinds,
    buildFoldSequence,
    buildCheckDownSequence,
    signActions,
    signCardCommit,
    buildCardCommit,
    playPlayer1WinsShowdown
};