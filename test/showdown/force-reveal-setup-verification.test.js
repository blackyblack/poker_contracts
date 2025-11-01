import { expect } from "chai";
import hre from "hardhat";
import { bn254 } from "@noble/curves/bn254.js";

import { hashToG1, g1ToBytes, g2ToBytes } from "../helpers/bn254.js";

const { ethers } = hre;

describe("Force Reveal - setup verification", function () {
    let escrow;
    let player1;
    let player2;
    const channelId = 1n;
    const deposit = ethers.parseEther("1");
    
    const Fr = bn254.fields.Fr;
    const G2 = bn254.G2.Point;
    
    it("verifies public keys are stored correctly", async function () {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();

        // Use fixed scalars
        const a = 12345n;
        const b = 67890n;
        
        const pkA_G2 = G2.BASE.multiply(a);
        const pkB_G2 = G2.BASE.multiply(b);
        
        const pkA_G2_bytes = g2ToBytes(pkA_G2);
        const pkB_G2_bytes = g2ToBytes(pkB_G2);

        await escrow.open(
            channelId,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            pkA_G2_bytes,
            { value: deposit }
        );
        await escrow
            .connect(player2)
            .join(channelId, ethers.ZeroAddress, pkB_G2_bytes, { value: deposit });

        // Get stored public keys
        const [storedPkA, storedPkB] = await escrow.getPublicKeys(channelId);
        
        expect(storedPkA).to.equal(pkA_G2_bytes);
        expect(storedPkB).to.equal(pkB_G2_bytes);
    });
    
    it("verifies deck is stored correctly", async function () {
        [player1, player2] = await ethers.getSigners();
        const Escrow = await ethers.getContractFactory("HeadsUpPokerEscrow");
        escrow = await Escrow.deploy();

        const a = 12345n;
        const b = 67890n;
        
        const pkA_G2_bytes = g2ToBytes(G2.BASE.multiply(a));
        const pkB_G2_bytes = g2ToBytes(G2.BASE.multiply(b));

        await escrow.open(
            channelId,
            player2.address,
            1n,
            ethers.ZeroAddress,
            0n,
            pkA_G2_bytes,
            { value: deposit }
        );
        await escrow
            .connect(player2)
            .join(channelId, ethers.ZeroAddress, pkB_G2_bytes, { value: deposit });

        // Create deck
        const deck = [];
        const context = "test_poker_hand";
        for (let i = 0; i < 9; i++) {
            const R = hashToG1(context, i);
            const aR = R.multiply(a);
            const Y = aR.multiply(b);
            deck.push(g1ToBytes(Y));
        }

        await escrow.connect(player1).startGame(channelId, deck);
        await escrow.connect(player2).startGame(channelId, deck);

        // Get deck hash from the force reveal contract
        const forceRevealAddress = await escrow.getForceRevealAddress();
        const forceReveal = await ethers.getContractAt("HeadsUpPokerForceReveal", forceRevealAddress);
        const expectedDeckHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [deck])
        );
        const storedDeckHash = await forceReveal.getDeckHash(channelId);
        
        expect(storedDeckHash).to.equal(expectedDeckHash);
    });
});
