const { expect } = require("chai");
const { ethers } = require("hardhat");
const { CARD } = require("../helpers/cards");

describe("PokerEvaluator", function () {
    let evaluator;

    beforeEach(async function () {
        const PokerEvaluator = await ethers.getContractFactory("PokerEvaluatorTest");
        evaluator = await PokerEvaluator.deploy();
    });

    describe("Hand Rankings", function () {
        // Table-driven tests for all hand types
        const handRankingTests = [
            {
                name: "high card",
                hand: [
                    CARD.ACE_CLUBS, CARD.KING_DIAMONDS, CARD.QUEEN_HEARTS,
                    CARD.JACK_SPADES, CARD.NINE_CLUBS, CARD.SEVEN_DIAMONDS, CARD.FIVE_HEARTS
                ],
                expectedType: 0n
            },
            {
                name: "pair of aces",
                hand: [
                    CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS,
                    CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
                ],
                expectedType: 1n
            },
            {
                name: "two pair - aces and kings",
                hand: [
                    CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS,
                    CARD.KING_SPADES, CARD.QUEEN_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
                ],
                expectedType: 2n
            },
            {
                name: "three of a kind - aces",
                hand: [
                    CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.ACE_HEARTS,
                    CARD.KING_SPADES, CARD.QUEEN_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
                ],
                expectedType: 3n
            },
            {
                name: "straight - wheel (A-2-3-4-5)",
                hand: [
                    CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS,
                    CARD.FOUR_SPADES, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
                ],
                expectedType: 4n
            },
            {
                name: "flush - ace high clubs",
                hand: [
                    CARD.ACE_CLUBS, CARD.KING_CLUBS, CARD.JACK_CLUBS,
                    CARD.NINE_CLUBS, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS
                ],
                expectedType: 5n
            },
            {
                name: "full house - aces over kings",
                hand: [
                    CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.ACE_HEARTS,
                    CARD.KING_SPADES, CARD.KING_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
                ],
                expectedType: 6n
            },
            {
                name: "four of a kind - aces",
                hand: [
                    CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.ACE_HEARTS,
                    CARD.ACE_SPADES, CARD.KING_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
                ],
                expectedType: 7n
            },
            {
                name: "straight flush - wheel in clubs",
                hand: [
                    CARD.ACE_CLUBS, CARD.TWO_CLUBS, CARD.THREE_CLUBS,
                    CARD.FOUR_CLUBS, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
                ],
                expectedType: 8n
            }
        ];

        handRankingTests.forEach(test => {
            it(`should correctly rank ${test.name}`, async function () {
                const rank = await evaluator.evaluateHand(test.hand);
                const handType = rank >> 20n;
                expect(handType).to.equal(test.expectedType);
            });
        });
    });

    describe("Hand Comparisons", function () {
        // Table-driven tests for hand comparisons
        const comparisonTests = [
            {
                name: "flush beats straight",
                hand1: { // Straight: 10-J-Q-K-A
                    cards: [CARD.TEN_CLUBS, CARD.JACK_DIAMONDS, CARD.QUEEN_HEARTS,
                    CARD.KING_SPADES, CARD.ACE_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS],
                    description: "broadway straight"
                },
                hand2: { // Flush: 7-high clubs
                    cards: [CARD.SEVEN_CLUBS, CARD.FIVE_CLUBS, CARD.FOUR_CLUBS,
                    CARD.THREE_CLUBS, CARD.TWO_CLUBS, CARD.KING_DIAMONDS, CARD.QUEEN_HEARTS],
                    description: "seven-high flush"
                },
                winner: "hand2"
            },
            {
                name: "pair of aces beats pair of kings",
                hand1: { // Pair of Aces
                    cards: [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS,
                    CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                    description: "pair of aces"
                },
                hand2: { // Pair of Kings
                    cards: [CARD.KING_CLUBS, CARD.KING_DIAMONDS, CARD.ACE_HEARTS,
                    CARD.QUEEN_SPADES, CARD.JACK_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                    description: "pair of kings"
                },
                winner: "hand1"
            }
        ];

        comparisonTests.forEach(test => {
            it(`${test.name}`, async function () {
                const rank1 = await evaluator.evaluateHand(test.hand1.cards);
                const rank2 = await evaluator.evaluateHand(test.hand2.cards);

                if (test.winner === "hand1") {
                    expect(rank1).to.be.greaterThan(rank2);
                } else {
                    expect(rank2).to.be.greaterThan(rank1);
                }
            });
        });

        it("should rank hands in correct hierarchical order", async function () {
            // Test the basic hierarchy: pair > high card, straight > pair, flush > straight
            const hands = {
                highCard: [CARD.ACE_CLUBS, CARD.KING_DIAMONDS, CARD.JACK_HEARTS,
                CARD.NINE_SPADES, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS],
                pair: [CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS,
                CARD.JACK_SPADES, CARD.NINE_CLUBS, CARD.SEVEN_DIAMONDS, CARD.FIVE_HEARTS],
                straight: [CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS,
                CARD.FOUR_SPADES, CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS],
                flush: [CARD.ACE_CLUBS, CARD.KING_CLUBS, CARD.JACK_CLUBS,
                CARD.NINE_CLUBS, CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS]
            };

            const ranks = {};
            for (const [type, cards] of Object.entries(hands)) {
                ranks[type] = await evaluator.evaluateHand(cards);
            }

            // Verify correct hierarchical ordering
            expect(ranks.pair).to.be.greaterThan(ranks.highCard);
            expect(ranks.straight).to.be.greaterThan(ranks.pair);
            expect(ranks.flush).to.be.greaterThan(ranks.straight);
        });
    });

    describe("Edge Cases", function () {
        it("should handle ace-low straight correctly", async function () {
            // A-2-3-4-5 straight
            const hand = [
                CARD.ACE_CLUBS,
                CARD.TWO_DIAMONDS,
                CARD.THREE_HEARTS,
                CARD.FOUR_SPADES,
                CARD.FIVE_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });

        it("should handle broadway straight correctly", async function () {
            // 10-J-Q-K-A straight
            const hand = [
                CARD.TEN_CLUBS,
                CARD.JACK_DIAMONDS,
                CARD.QUEEN_HEARTS,
                CARD.KING_SPADES,
                CARD.ACE_CLUBS,
                CARD.FIVE_DIAMONDS,
                CARD.THREE_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });
    });
});
