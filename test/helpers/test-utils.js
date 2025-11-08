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

// Helper to create a mock deck (9 cards, each 64 bytes) - we only use up to RIVER
export function createMockDeck() {
    const deck = [];
    for (let i = 0; i < 9; i++) {
        // Create a 64-byte mock card
        deck.push(ethers.hexlify(ethers.randomBytes(64)));
    }
    return deck;
}

// Helper to create a mock canonical deck (52 unencrypted base points, each 64 bytes)
export function createMockCanonicalDeck() {
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
// @param deck - Optional encrypted deck array (defaults to mock deck)
// @param canonicalDeck - Optional canonical deck array (defaults to mock canonical deck)
export async function startGameWithDeck(escrow, channelId, player1, player2, deck = null, canonicalDeck = null) {
    if (!deck) {
        deck = createMockDeck();
    }
    if (!canonicalDeck) {
        canonicalDeck = createMockCanonicalDeck();
    }
    await escrow.connect(player1).startGame(channelId, deck, canonicalDeck);
    await escrow.connect(player2).startGame(channelId, deck, canonicalDeck);
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

// ------------------------------------------------------------------
// Cryptographic helpers for showdown with DecryptedCard
// ------------------------------------------------------------------

import { bn254 } from "@noble/curves/bn254.js";
import { hashToG1, g1ToBytes, g2ToBytes } from "./bn254.js";

const Fr = bn254.fields.Fr;
const G2 = bn254.G2.Point;

/// @notice Setup crypto keys for testing showdown
/// @returns Object with secret keys and public keys for both players
export function setupShowdownCrypto() {
    const secretKeyA = 12345n;
    const secretKeyB = 67890n;
    const publicKeyA = G2.BASE.multiply(secretKeyA);
    const publicKeyB = G2.BASE.multiply(secretKeyB);
    
    return {
        secretKeyA,
        secretKeyB,
        publicKeyA,
        publicKeyB,
        pkA_G2_bytes: g2ToBytes(publicKeyA),
        pkB_G2_bytes: g2ToBytes(publicKeyB),
    };
}

/// @notice Create an encrypted deck for testing
/// @param secretKeyA - Player A's secret key
/// @param secretKeyB - Player B's secret key
/// @param context - Context string for hashing
/// @returns Array of 9 encrypted G1 points
export function createEncryptedDeck(secretKeyA, secretKeyB, context = "test_poker_hand") {
    const deck = [];
    for (let i = 0; i < 9; i++) {
        const R = hashToG1(context, i);
        const aR = R.multiply(secretKeyA);
        const Y = aR.multiply(secretKeyB);
        deck.push(g1ToBytes(Y));
    }
    return deck;
}

/// @notice Create a canonical deck for card ID resolution
/// @param context - Context string for hashing
/// @returns Array of 52 unencrypted G1 base points
export function createCanonicalDeck(context = "canonical_deck") {
    const canonicalDeck = [];
    for (let i = 0; i < 52; i++) {
        const R = hashToG1(context, i);
        canonicalDeck.push(g1ToBytes(R));
    }
    return canonicalDeck;
}

/// @notice Create a partial decryption (one player removes their layer)
/// @param signer - Wallet that signs the partial decryption
/// @param secretKey - Secret key of the player
/// @param encryptedCard - The encrypted card bytes (Y)
/// @param slot - Card slot index
/// @param channelId - Channel ID
/// @param handId - Hand ID
/// @param escrowAddress - Address of escrow contract for EIP712 domain
/// @param chainId - Chain ID for EIP712 domain
/// @returns Object with decryptedCard struct and signature
export async function createPartialDecrypt(
    signer,
    secretKey,
    encryptedCard,
    slot,
    channelId,
    handId,
    escrowAddress,
    chainId
) {
    const G1 = bn254.G1.Point;
    
    // Convert encrypted card bytes to G1 point
    // encryptedCard is 64 bytes: x||y (each 32 bytes)
    const xHex = encryptedCard.slice(0, 66);  // 0x + 64 hex chars (32 bytes)
    const yHex = '0x' + encryptedCard.slice(66); // Remaining 64 hex chars (32 bytes)
    
    const x = BigInt(xHex);
    const y = BigInt(yHex);
    
    const Y = G1.fromAffine({ x, y });
    
    // Compute partial decryption: U = scalar^(-1) · Y
    const scalar_inv = Fr.inv(secretKey);
    const U = Y.multiply(scalar_inv);

    const decryptedCard = {
        channelId,
        handId,
        player: signer.address,
        index: slot,
        decryptedCard: g1ToBytes(U),
    };

    // Sign the decrypted card
    const domain = domainSeparator(escrowAddress, chainId);
    
    const DECRYPTED_CARD_TYPEHASH = ethers.keccak256(
        ethers.toUtf8Bytes(
            "DecryptedCard(uint256 channelId,uint256 handId,address player,uint8 index,bytes decryptedCard)"
        )
    );
    
    const structHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "uint256", "uint256", "address", "uint8", "bytes32"],
            [
                DECRYPTED_CARD_TYPEHASH,
                decryptedCard.channelId,
                decryptedCard.handId,
                decryptedCard.player,
                decryptedCard.index,
                ethers.keccak256(decryptedCard.decryptedCard),
            ]
        )
    );
    
    const digest = ethers.keccak256(
        ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domain, structHash])
    );
    
    const signature = signer.signingKey.sign(digest).serialized;

    return { decryptedCard, signature };
}

/// @notice Create the final plaintext (both players' layers removed)
/// @param signer - Wallet that signs the plaintext
/// @param secretKey - Secret key of the player
/// @param partialCard - The partial decryption bytes (U_other)
/// @param slot - Card slot index
/// @param channelId - Channel ID
/// @param handId - Hand ID
/// @param escrowAddress - Address of escrow contract for EIP712 domain
/// @param chainId - Chain ID for EIP712 domain
/// @returns Object with decryptedCard struct (containing plaintext) and signature
export async function createPlaintext(
    signer,
    secretKey,
    partialCard,
    slot,
    channelId,
    handId,
    escrowAddress,
    chainId
) {
    const G1 = bn254.G1.Point;
    
    // Convert partial card bytes to G1 point
    // partialCard is 64 bytes: x||y (each 32 bytes)
    const xHex = partialCard.slice(0, 66);  // 0x + 64 hex chars (32 bytes)
    const yHex = '0x' + partialCard.slice(66); // Remaining 64 hex chars (32 bytes)
    
    const x = BigInt(xHex);
    const y = BigInt(yHex);
    
    const U_other = G1.fromAffine({ x, y });
    
    // Compute final plaintext: R = scalar^(-1) · U_other
    const scalar_inv = Fr.inv(secretKey);
    const R = U_other.multiply(scalar_inv);

    const decryptedCard = {
        channelId,
        handId,
        player: signer.address,
        index: slot,
        decryptedCard: g1ToBytes(R),  // This is the final plaintext
    };

    // Sign the decrypted card
    const domain = domainSeparator(escrowAddress, chainId);
    
    const DECRYPTED_CARD_TYPEHASH = ethers.keccak256(
        ethers.toUtf8Bytes(
            "DecryptedCard(uint256 channelId,uint256 handId,address player,uint8 index,bytes decryptedCard)"
        )
    );
    
    const structHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "uint256", "uint256", "address", "uint8", "bytes32"],
            [
                DECRYPTED_CARD_TYPEHASH,
                decryptedCard.channelId,
                decryptedCard.handId,
                decryptedCard.player,
                decryptedCard.index,
                ethers.keccak256(decryptedCard.decryptedCard),
            ]
        )
    );
    
    const digest = ethers.keccak256(
        ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domain, structHash])
    );
    
    const signature = signer.signingKey.sign(digest).serialized;

    return { decryptedCard, signature };
}
