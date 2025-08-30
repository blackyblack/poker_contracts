const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PokerEvaluator Gas Efficiency", function () {
    let evaluatorTest;

    beforeEach(async function () {
        const PokerEvaluatorTest = await ethers.getContractFactory("PokerEvaluatorTest");
        evaluatorTest = await PokerEvaluatorTest.deploy();
    });

    // Helper function to create a card
    function makeCard(suit, rank) {
        return (suit << 4) | rank;
    }

    // Helper to create test hands
    function makeHand(cards) {
        const hand = new Array(7).fill(0);
        for (let i = 0; i < cards.length && i < 7; i++) {
            hand[i] = cards[i];
        }
        return hand;
    }

    describe("Gas Usage Tests", function () {
        it("should use reasonable gas for high card evaluation", async function () {
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 13), // King of Diamonds
                makeCard(2, 12), // Queen of Hearts
                makeCard(3, 11), // Jack of Spades
                makeCard(0, 9),  // 9 of Clubs
                makeCard(1, 7),  // 7 of Diamonds
                makeCard(2, 5)   // 5 of Hearts
            ]);

            const tx = await evaluatorTest.evaluateHand(hand);
            const receipt = await tx.wait();
            
            console.log(`High card evaluation gas used: ${receipt.gasUsed}`);
            // Should be well under 100k gas for efficient evaluation
            expect(receipt.gasUsed).to.be.lessThan(100000);
        });

        it("should use reasonable gas for flush evaluation", async function () {
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(0, 13), // King of Clubs
                makeCard(0, 11), // Jack of Clubs
                makeCard(0, 9),  // 9 of Clubs
                makeCard(0, 7),  // 7 of Clubs
                makeCard(1, 5),  // 5 of Diamonds
                makeCard(2, 3)   // 3 of Hearts
            ]);

            const tx = await evaluatorTest.evaluateHand(hand);
            const receipt = await tx.wait();
            
            console.log(`Flush evaluation gas used: ${receipt.gasUsed}`);
            expect(receipt.gasUsed).to.be.lessThan(100000);
        });

        it("should use reasonable gas for straight flush evaluation", async function () {
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(0, 2),  // 2 of Clubs
                makeCard(0, 3),  // 3 of Clubs
                makeCard(0, 4),  // 4 of Clubs
                makeCard(0, 5),  // 5 of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const tx = await evaluatorTest.evaluateHand(hand);
            const receipt = await tx.wait();
            
            console.log(`Straight flush evaluation gas used: ${receipt.gasUsed}`);
            expect(receipt.gasUsed).to.be.lessThan(100000);
        });

        it("should efficiently handle multiple evaluations", async function () {
            const hands = [
                // High card
                makeHand([makeCard(0, 1), makeCard(1, 13), makeCard(2, 11), makeCard(3, 9), makeCard(0, 7), makeCard(1, 5), makeCard(2, 3)]),
                // Pair
                makeHand([makeCard(0, 1), makeCard(1, 1), makeCard(2, 13), makeCard(3, 11), makeCard(0, 9), makeCard(1, 7), makeCard(2, 5)]),
                // Two pair
                makeHand([makeCard(0, 1), makeCard(1, 1), makeCard(2, 13), makeCard(3, 13), makeCard(0, 11), makeCard(1, 9), makeCard(2, 7)]),
                // Straight
                makeHand([makeCard(0, 1), makeCard(1, 2), makeCard(2, 3), makeCard(3, 4), makeCard(0, 5), makeCard(1, 9), makeCard(2, 7)]),
                // Flush
                makeHand([makeCard(0, 1), makeCard(0, 13), makeCard(0, 11), makeCard(0, 9), makeCard(0, 7), makeCard(1, 5), makeCard(2, 3)])
            ];

            let totalGas = 0n;
            for (const hand of hands) {
                const tx = await evaluatorTest.evaluateHand(hand);
                const receipt = await tx.wait();
                totalGas += receipt.gasUsed;
            }

            console.log(`Total gas for 5 evaluations: ${totalGas}`);
            console.log(`Average gas per evaluation: ${totalGas / 5n}`);
            
            // Average should be well under 100k gas per evaluation
            expect(totalGas / 5n).to.be.lessThan(100000);
        });
    });

    describe("Correctness Verification", function () {
        it("should return consistent results for the same hand", async function () {
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 1),  // Ace of Diamonds
                makeCard(2, 13), // King of Hearts
                makeCard(3, 12), // Queen of Spades
                makeCard(0, 11), // Jack of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const result1 = await evaluatorTest.evaluateHand(hand);
            const result2 = await evaluatorTest.evaluateHand(hand);
            
            expect(result1).to.equal(result2);
        });

        it("should rank hands in correct order", async function () {
            // High card
            const highCard = makeHand([
                makeCard(0, 1), makeCard(1, 13), makeCard(2, 11), makeCard(3, 9), 
                makeCard(0, 7), makeCard(1, 5), makeCard(2, 3)
            ]);

            // Pair
            const pair = makeHand([
                makeCard(0, 1), makeCard(1, 1), makeCard(2, 13), makeCard(3, 11), 
                makeCard(0, 9), makeCard(1, 7), makeCard(2, 5)
            ]);

            // Straight
            const straight = makeHand([
                makeCard(0, 1), makeCard(1, 2), makeCard(2, 3), makeCard(3, 4), 
                makeCard(0, 5), makeCard(1, 9), makeCard(2, 7)
            ]);

            // Flush
            const flush = makeHand([
                makeCard(0, 1), makeCard(0, 13), makeCard(0, 11), makeCard(0, 9), 
                makeCard(0, 7), makeCard(1, 5), makeCard(2, 3)
            ]);

            const highCardRank = await evaluatorTest.evaluateHand(highCard);
            const pairRank = await evaluatorTest.evaluateHand(pair);
            const straightRank = await evaluatorTest.evaluateHand(straight);
            const flushRank = await evaluatorTest.evaluateHand(flush);

            // Verify correct ordering
            expect(pairRank).to.be.greaterThan(highCardRank);
            expect(straightRank).to.be.greaterThan(pairRank);
            expect(flushRank).to.be.greaterThan(straightRank);
        });
    });
});