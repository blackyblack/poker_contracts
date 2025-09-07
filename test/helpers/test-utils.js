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
 * @param {Array} players - Array of player addresses [player1, player2] (optional)
 * @returns {Array} Array of action objects
 */
function buildActions(specs, channelId = 1n, handId = 1n, players = null) {
    let seq = 0;
    let prevHash = handGenesis(channelId, handId);
    const actions = [];
    
    // Default players if not provided
    const defaultPlayers = players || [
        "0x1000000000000000000000000000000000000001", // player1 (small blind)
        "0x2000000000000000000000000000000000000002"  // player2 (big blind)
    ];
    
    for (const spec of specs) {
        let sender;
        
        if (spec.sender) {
            // Use explicitly provided sender
            sender = spec.sender;
        } else {
            // Auto-assign sender based on heads up poker rules
            if (seq === 0) {
                // First action: Small Blind - always player1 (dealer position)
                sender = defaultPlayers[0];
            } else if (seq === 1) {
                // Second action: Big Blind - always player2
                sender = defaultPlayers[1];
            } else {
                // For post-blind actions, we need to track game state to determine whose turn it is
                // This is a simplified version - for more complex scenarios, use explicit senders
                // Preflop after blinds: SB acts first (player1)
                // Postflop: BB acts first (player2)
                // For now, alternate starting with SB (player1) on action 2
                const actionsAfterBlinds = seq - 2;
                sender = defaultPlayers[actionsAfterBlinds % 2];
            }
        }
        
        const act = {
            channelId,
            handId,
            seq: seq++,
            action: spec.action,
            amount: spec.amount,
            prevHash,
            sender
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
        { action: ACTION.SMALL_BLIND, amount: 1n },
        { action: ACTION.BIG_BLIND, amount: 2n },
        { action: ACTION.CHECK_CALL, amount: 0n }, // SB calls to match BB
        { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks (flop)
        { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
        { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks (turn) 
        { action: ACTION.CHECK_CALL, amount: 0n }, // SB checks
        { action: ACTION.CHECK_CALL, amount: 0n }, // BB checks (river)
        { action: ACTION.CHECK_CALL, amount: 0n }  // SB checks -> showdown
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
    signActions,
    signCardCommit,
    buildCardCommit,
    playPlayer1WinsShowdown
};