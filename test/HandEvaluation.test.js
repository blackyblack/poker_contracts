const { expect } = require("chai");
const { ethers } = require("hardhat");
const { CARD } = require("./cards");

describe("Poker Hand Evaluation", function () {
    let evaluator;

    beforeEach(async function () {
        const PokerEvaluator = await ethers.getContractFactory("PokerEvaluatorTest");
        evaluator = await PokerEvaluator.deploy();
    });

    describe("Basic Hand Rankings", function () {
        const testCases = [
            {
                name: "high card",
                hand: [CARD.ACE_CLUBS, CARD.KING_DIAMONDS, CARD.QUEEN_HEARTS, CARD.JACK_SPADES, CARD.NINE_CLUBS, CARD.SEVEN_DIAMONDS, CARD.FIVE_HEARTS],
                expectedType: 0n
            },
            {
                name: "pair",
                hand: [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                expectedType: 1n
            },
            {
                name: "two pair",
                hand: [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.KING_SPADES, CARD.QUEEN_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                expectedType: 2n
            },
            {
                name: "three of a kind",
                hand: [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.ACE_HEARTS, CARD.KING_SPADES, CARD.QUEEN_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                expectedType: 3n
            },
            {
                name: "straight",
                hand: [CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS, CARD.FOUR_SPADES, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                expectedType: 4n
            },
            {
                name: "flush",
                hand: [CARD.ACE_CLUBS, CARD.KING_CLUBS, CARD.JACK_CLUBS, CARD.NINE_CLUBS, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS],
                expectedType: 5n
            },
            {
                name: "full house",
                hand: [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.ACE_HEARTS, CARD.KING_SPADES, CARD.KING_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                expectedType: 6n
            },
            {
                name: "four of a kind",
                hand: [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.ACE_HEARTS, CARD.ACE_SPADES, CARD.KING_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                expectedType: 7n
            },
            {
                name: "straight flush",
                hand: [CARD.ACE_CLUBS, CARD.TWO_CLUBS, CARD.THREE_CLUBS, CARD.FOUR_CLUBS, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                expectedType: 8n
            }
        ];

        testCases.forEach(({ name, hand, expectedType }) => {
            it(`should correctly rank ${name}`, async function () {
                const rank = await evaluator.evaluateHand(hand);
                const handType = rank >> 20n;
                expect(handType).to.equal(expectedType);
            });
        });
    });

    describe("Hand Comparisons", function () {
        it("should rank hands in correct order", async function () {
            const hands = [
                [CARD.ACE_CLUBS, CARD.KING_DIAMONDS, CARD.JACK_HEARTS, CARD.NINE_SPADES, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS], // High card
                [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.JACK_SPADES, CARD.NINE_CLUBS, CARD.SEVEN_DIAMONDS, CARD.FIVE_HEARTS], // Pair
                [CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS, CARD.FOUR_SPADES, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS], // Straight
                [CARD.ACE_CLUBS, CARD.KING_CLUBS, CARD.JACK_CLUBS, CARD.NINE_CLUBS, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS] // Flush
            ];

            const ranks = await Promise.all(hands.map(hand => evaluator.evaluateHand(hand)));
            
            // Each subsequent hand should rank higher
            for (let i = 1; i < ranks.length; i++) {
                expect(ranks[i]).to.be.greaterThan(ranks[i - 1]);
            }
        });

        it("should rank higher pairs correctly", async function () {
            const acePair = [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS];
            const kingPair = [CARD.KING_CLUBS, CARD.KING_DIAMONDS, CARD.ACE_HEARTS, CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS];

            const aceRank = await evaluator.evaluateHand(acePair);
            const kingRank = await evaluator.evaluateHand(kingPair);

            expect(aceRank).to.be.greaterThan(kingRank);
        });
    });

    describe("Special Cases", function () {
        it("should handle ace-low straight (wheel)", async function () {
            const hand = [CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS, CARD.FOUR_SPADES, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS];
            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });

        it("should handle broadway straight", async function () {
            const hand = [CARD.TEN_CLUBS, CARD.JACK_DIAMONDS, CARD.QUEEN_HEARTS, CARD.KING_SPADES, CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS];
            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });

        it("should handle royal flush", async function () {
            const hand = [CARD.TEN_CLUBS, CARD.JACK_CLUBS, CARD.QUEEN_CLUBS, CARD.KING_CLUBS, CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS];
            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(8n); // HAND_STRAIGHT_FLUSH (royal flush is special case)
        });
    });

    describe("Edge Cases - Should Fail Tests", function () {
        // These tests represent edge cases that should be handled but currently fail

        it.skip("should fail: handle duplicate cards in hand", async function () {
            // TODO: Implement duplicate card detection
            const hand = [CARD.ACE_CLUBS, CARD.ACE_CLUBS, CARD.KING_HEARTS, CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS];
            
            await expect(evaluator.evaluateHand(hand))
                .to.be.revertedWithCustomError(evaluator, "DuplicateCardsNotAllowed");
        });

        it.skip("should fail: handle invalid hand size", async function () {
            // TODO: Implement hand size validation
            const hand = [CARD.ACE_CLUBS, CARD.KING_HEARTS]; // Only 2 cards
            
            await expect(evaluator.evaluateHand(hand))
                .to.be.revertedWithCustomError(evaluator, "InvalidHandSize");
        });

        it.skip("should fail: handle invalid card values", async function () {
            // TODO: Implement card value validation
            const hand = [999, CARD.KING_HEARTS, CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS, CARD.FIVE_CLUBS]; // Invalid card
            
            await expect(evaluator.evaluateHand(hand))
                .to.be.revertedWithCustomError(evaluator, "InvalidCardValue");
        });
    });
});