import hre from "hardhat";
import { actionHash, actionDigest, handGenesis, domainSeparator, commitHash, cardCommitDigest } from "./hashes.js";
import { ACTION } from "./actions.js";

const { ethers } = hre;

// Standard test wallet private keys
export const wallet1 = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
export const wallet2 = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
export const wallet3 = new ethers.Wallet(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
);

// Helper to build actions with proper hashes and sequence numbers
// @param specs - Array of action specifications {action, amount, sender}
// @param channelId - Channel ID (default: 1n)
// @param handId - Hand ID (default: 1n)
// @returns Array of action objects
export function buildActions(specs, channelId = 1n, handId = 1n) {
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

// Helper to sign actions
// @param actions - Array of actions to sign
// @param signers - Array of wallet signers
// @param contractAddress - Contract address for domain separator
// @param chainId - Chain ID for domain separator
// @returns Array of signatures
export async function signActions(actions, signers, contractAddress, chainId) {
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

// Helper to sign a commit for a card
// @param a - First wallet signer
// @param b - Second wallet signer
// @param dom - Domain separator
// @param cc - Card commit object
// @returns Array of two signatures [sigA, sigB]
export async function signCardCommit(a, b, dom, cc) {
    const digest = cardCommitDigest(dom, cc);
    const sigA = a.signingKey.sign(digest).serialized;
    const sigB = b.signingKey.sign(digest).serialized;
    return [sigA, sigB];
}

// Helper to build a card commit with signatures
// @param a - First wallet signer
// @param b - Second wallet signer
// @param dom - Domain separator
// @param channelId - Channel ID
// @param slot - Card slot
// @param card - Card value
// @param handId - Hand ID (default: 1n)
// @returns Commit object with signatures and metadata
export async function buildCardCommit(a, b, dom, channelId, slot, card, handId = 1n) {
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

// Helper to create a mock deck (52 cards, each 64 bytes) - full canonical deck
export function createMockDeck() {
    const deck = [];
    for (let i = 0; i < 52; i++) {
        // Create a 64-byte mock card
        deck.push(ethers.hexlify(ethers.randomBytes(64)));
    }
    return deck;
}

// Helper to start a game by having both players submit the same deck
// @param escrow - The escrow contract
// @param channelId - Channel ID
// @param player1 - Player 1 signer
// @param player2 - Player 2 signer
// @param deck - Optional deck array (defaults to mock deck)
export async function startGameWithDeck(escrow, channelId, player1, player2, deck = null) {
    if (!deck) {
        deck = createMockDeck();
    }
    await escrow.connect(player1).startGame(channelId, deck);
    await escrow.connect(player2).startGame(channelId, deck);
}

// Helper to play a basic showdown game where player1 wins 2 chips
export async function playPlayer1WinsShowdown(escrow, channelId, player1, player1Wallet, player2Wallet) {
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

// Helper to settle fold scenario in tests
export async function settleBasicFold(escrow, channelId, winner, wallet1, wallet2, chainId) {
    const handId = await escrow.getHandId(channelId);

    if (handId % 2n === 0n) {
        if (winner === wallet1.address) {
            winner = wallet2.address;
        } else {
            winner = wallet1.address;
        }
    }

    // Determine who should fold to make the winner win
    let actions;
    if (winner === wallet1.address) {
        // Player2 should fold, so player1 wins
        actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.BET_RAISE, amount: 3n, sender: wallet1.address }, // Small blind raises,
            { action: ACTION.FOLD, amount: 0n, sender: wallet2.address } // Big blind folds
        ], channelId, handId);
    } else {
        // Player1 should fold, so player2 wins  
        actions = buildActions([
            { action: ACTION.SMALL_BLIND, amount: 1n, sender: wallet1.address },
            { action: ACTION.BIG_BLIND, amount: 2n, sender: wallet2.address },
            { action: ACTION.FOLD, amount: 0n, sender: wallet1.address } // Small blind folds
        ], channelId, handId);
    }

    const signatures = await signActions(actions, [wallet1, wallet2], await escrow.getAddress(), chainId);
    return escrow.settle(channelId, actions, signatures);
}
