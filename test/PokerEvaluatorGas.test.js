const { expect } = require("chai");
const { ethers } = require("hardhat");
const { CARD } = require("./cards");

describe("PokerEvaluator Gas Efficiency", function () {
    let evaluatorTest;

    beforeEach(async function () {
        const PokerEvaluatorTest = await ethers.getContractFactory("PokerEvaluatorTest");
        evaluatorTest = await PokerEvaluatorTest.deploy();
    });

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
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.KING_DIAMONDS, // King of Diamonds
                CARD.QUEEN_HEARTS,  // Queen of Hearts
                CARD.JACK_SPADES,   // Jack of Spades
                CARD.NINE_CLUBS,    // 9 of Clubs
                CARD.SEVEN_DIAMONDS,// 7 of Diamonds
                CARD.FIVE_HEARTS    // 5 of Hearts
            ]);

            const tx = await evaluatorTest.evaluateHand(hand);
            const receipt = await tx.wait();
            
            console.log(`High card evaluation gas used: ${receipt.gasUsed}`);
            // Should be well under 100k gas for efficient evaluation
            expect(receipt.gasUsed).to.be.lessThan(100000);
        });

        it("should use reasonable gas for flush evaluation", async function () {
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.KING_CLUBS,    // King of Clubs
                CARD.JACK_CLUBS,    // Jack of Clubs
                CARD.NINE_CLUBS,    // 9 of Clubs
                CARD.SEVEN_CLUBS,   // 7 of Clubs
                CARD.FIVE_DIAMONDS, // 5 of Diamonds
                CARD.THREE_HEARTS   // 3 of Hearts
            ]);

            const tx = await evaluatorTest.evaluateHand(hand);
            const receipt = await tx.wait();
            
            console.log(`Flush evaluation gas used: ${receipt.gasUsed}`);
            expect(receipt.gasUsed).to.be.lessThan(100000);
        });

        it("should use reasonable gas for straight flush evaluation", async function () {
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.TWO_CLUBS,     // 2 of Clubs
                CARD.THREE_CLUBS,   // 3 of Clubs
                CARD.FOUR_CLUBS,    // 4 of Clubs
                CARD.FIVE_CLUBS,    // 5 of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const tx = await evaluatorTest.evaluateHand(hand);
            const receipt = await tx.wait();
            
            console.log(`Straight flush evaluation gas used: ${receipt.gasUsed}`);
            expect(receipt.gasUsed).to.be.lessThan(100000);
        });

        it("should efficiently handle multiple evaluations", async function () {
            const hands = [
                // High card
                makeHand([CARD.ACE_CLUBS, CARD.KING_DIAMONDS, CARD.JACK_HEARTS, CARD.NINE_SPADES, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS]),
                // Pair
                makeHand([CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.JACK_SPADES, CARD.NINE_CLUBS, CARD.SEVEN_DIAMONDS, CARD.FIVE_HEARTS]),
                // Two pair
                makeHand([CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.KING_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS]),
                // Straight
                makeHand([CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS, CARD.FOUR_SPADES, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS]),
                // Flush
                makeHand([CARD.ACE_CLUBS, CARD.KING_CLUBS, CARD.JACK_CLUBS, CARD.NINE_CLUBS, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS])
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
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.ACE_DIAMONDS,  // Ace of Diamonds
                CARD.KING_HEARTS,   // King of Hearts
                CARD.QUEEN_SPADES,  // Queen of Spades
                CARD.JACK_CLUBS,    // Jack of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const result1 = await evaluatorTest.evaluateHand(hand);
            const result2 = await evaluatorTest.evaluateHand(hand);
            
            expect(result1).to.equal(result2);
        });

        it("should rank hands in correct order", async function () {
            // High card
            const highCard = makeHand([
                CARD.ACE_CLUBS, CARD.KING_DIAMONDS, CARD.JACK_HEARTS, CARD.NINE_SPADES, 
                CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS
            ]);

            // Pair
            const pair = makeHand([
                CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.JACK_SPADES, 
                CARD.NINE_CLUBS, CARD.SEVEN_DIAMONDS, CARD.FIVE_HEARTS
            ]);

            // Straight
            const straight = makeHand([
                CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS, CARD.FOUR_SPADES, 
                CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
            ]);

            // Flush
            const flush = makeHand([
                CARD.ACE_CLUBS, CARD.KING_CLUBS, CARD.JACK_CLUBS, CARD.NINE_CLUBS, 
                CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS
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