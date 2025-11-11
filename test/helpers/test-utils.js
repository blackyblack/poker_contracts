import hre from "hardhat";
import { actionHash, actionDigest, handGenesis, domainSeparator } from "./hashes.js";
import { ACTION } from "./actions.js";

const { ethers } = hre;

export async function deployAndWireContracts() {
    const HeadsUpPokerEscrow = await ethers.getContractFactory(
        "HeadsUpPokerEscrow"
    );
    const HeadsUpPokerReplay = await ethers.getContractFactory(
        "HeadsUpPokerReplay"
    );
    const HeadsUpPokerPeek = await ethers.getContractFactory("HeadsUpPokerPeek");
    const HeadsUpPokerShowdown = await ethers.getContractFactory(
        "HeadsUpPokerShowdown"
    );
    const HeadsUpPokerView = await ethers.getContractFactory("HeadsUpPokerView");

    const replay = await HeadsUpPokerReplay.deploy();
    const peek = await HeadsUpPokerPeek.deploy();
    const showdown = await HeadsUpPokerShowdown.deploy();
    const view = await HeadsUpPokerView.deploy();
    const escrow = await HeadsUpPokerEscrow.deploy();

    await peek.transferOwnership(await escrow.getAddress());
    await showdown.transferOwnership(await escrow.getAddress());
    await view.transferOwnership(await escrow.getAddress());

    await escrow.initializeHelpers(
        await replay.getAddress(),
        await peek.getAddress(),
        await showdown.getAddress(),
        await view.getAddress()
    );

    await escrow.wireHelpers();

    return { escrow, replay, peek, showdown, view };
}

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
        publicKeyA: g2ToBytes(publicKeyA),
        publicKeyB: g2ToBytes(publicKeyB)
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
/// @param secretKey - Secret key of the player
/// @param encryptedCard - The encrypted card bytes (Y)
/// @returns Decrypted card bytes
export async function createPartialDecrypt(secretKey, encryptedCard) {
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

    return g1ToBytes(U);
}

/// @notice Create the final plaintext (both players' layers removed)
/// @param secretKey - Secret key of the player
/// @param partialCard - The partial decryption bytes (U_other)
/// @returns Plaintext card bytes
export async function createPlaintext(secretKey, partialCard) {
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

    return g1ToBytes(R);
}
