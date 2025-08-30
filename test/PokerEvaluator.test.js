const { expect } = require("chai");
const { ethers } = require("hardhat");
const { CARD } = require("./cards");

describe("PokerEvaluator", function () {
    let evaluator;

    beforeEach(async function () {
        const PokerEvaluator = await ethers.getContractFactory("PokerEvaluatorTest");
        evaluator = await PokerEvaluator.deploy();
    });

    describe("Basic Hand Rankings", function () {
        it("should rank high card correctly", async function () {
            // A-K-Q-J-9 high (mixed suits)
            const hand = [
                CARD.ACE_CLUBS,
                CARD.KING_DIAMONDS,
                CARD.QUEEN_HEARTS,
                CARD.JACK_SPADES,
                CARD.NINE_CLUBS,
                CARD.SEVEN_DIAMONDS,
                CARD.FIVE_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);

            // High card = 0, so rank should be 0 << 20 + kickers
            const handType = rank >> 20n;
            expect(handType).to.equal(0n); // HAND_HIGH_CARD
        });

        it("should rank pair correctly", async function () {
            // Pair of Aces with K-Q-J kickers
            const hand = [
                CARD.ACE_CLUBS,
                CARD.ACE_DIAMONDS,
                CARD.KING_HEARTS,
                CARD.QUEEN_SPADES,
                CARD.JACK_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(1n); // HAND_PAIR
        });

        it("should rank two pair correctly", async function () {
            // Aces and Kings with Queen kicker
            const hand = [
                CARD.ACE_CLUBS,
                CARD.ACE_DIAMONDS,
                CARD.KING_HEARTS,
                CARD.KING_SPADES,
                CARD.QUEEN_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(2n); // HAND_TWO_PAIR
        });

        it("should rank three of a kind correctly", async function () {
            // Three Aces with K-Q kickers
            const hand = [
                CARD.ACE_CLUBS,
                CARD.ACE_DIAMONDS,
                CARD.ACE_HEARTS,
                CARD.KING_SPADES,
                CARD.QUEEN_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(3n); // HAND_THREE_KIND
        });

        it("should rank straight correctly", async function () {
            // A-2-3-4-5 straight (wheel)
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

        it("should rank flush correctly", async function () {
            // Ace high flush in clubs
            const hand = [
                CARD.ACE_CLUBS,
                CARD.KING_CLUBS,
                CARD.JACK_CLUBS,
                CARD.NINE_CLUBS,
                CARD.SEVEN_CLUBS,
                CARD.FIVE_DIAMONDS,
                CARD.THREE_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(5n); // HAND_FLUSH
        });

        it("should rank full house correctly", async function () {
            // Aces full of Kings
            const hand = [
                CARD.ACE_CLUBS,
                CARD.ACE_DIAMONDS,
                CARD.ACE_HEARTS,
                CARD.KING_SPADES,
                CARD.KING_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(6n); // HAND_FULL_HOUSE
        });

        it("should rank four of a kind correctly", async function () {
            // Four Aces with King kicker
            const hand = [
                CARD.ACE_CLUBS,
                CARD.ACE_DIAMONDS,
                CARD.ACE_HEARTS,
                CARD.ACE_SPADES,
                CARD.KING_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(7n); // HAND_FOUR_KIND
        });

        it("should rank straight flush correctly", async function () {
            // 5-high straight flush in clubs (wheel)
            const hand = [
                CARD.ACE_CLUBS,
                CARD.TWO_CLUBS,
                CARD.THREE_CLUBS,
                CARD.FOUR_CLUBS,
                CARD.FIVE_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(8n); // HAND_STRAIGHT_FLUSH
        });
    });

    describe("Hand Comparison", function () {
        it("should rank flush higher than straight", async function () {
            // Straight: 10-J-Q-K-A
            const straight = [
                CARD.TEN_CLUBS,
                CARD.JACK_DIAMONDS,
                CARD.QUEEN_HEARTS,
                CARD.KING_SPADES,
                CARD.ACE_CLUBS,
                CARD.FIVE_DIAMONDS,
                CARD.THREE_HEARTS
            ];

            // Flush: 7-high flush
            const flush = [
                CARD.SEVEN_CLUBS,
                CARD.FIVE_CLUBS,
                CARD.FOUR_CLUBS,
                CARD.THREE_CLUBS,
                CARD.TWO_CLUBS,
                CARD.KING_DIAMONDS,
                CARD.QUEEN_HEARTS
            ];

            const straightRank = await evaluator.evaluateHand(straight);
            const flushRank = await evaluator.evaluateHand(flush);

            expect(flushRank).to.be.greaterThan(straightRank);
        });

        it("should rank higher pairs correctly", async function () {
            // Pair of Aces
            const acePair = [
                CARD.ACE_CLUBS,
                CARD.ACE_DIAMONDS,
                CARD.KING_HEARTS,
                CARD.QUEEN_SPADES,
                CARD.JACK_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            // Pair of Kings
            const kingPair = [
                CARD.KING_CLUBS,
                CARD.KING_DIAMONDS,
                CARD.ACE_HEARTS,
                CARD.QUEEN_SPADES,
                CARD.JACK_CLUBS,
                CARD.NINE_DIAMONDS,
                CARD.SEVEN_HEARTS
            ];

            const aceRank = await evaluator.evaluateHand(acePair);
            const kingRank = await evaluator.evaluateHand(kingPair);

            expect(aceRank).to.be.greaterThan(kingRank);
        });

        it("should rank hands in correct order", async function () {
            // High card
            const highCard = [
                CARD.ACE_CLUBS, CARD.KING_DIAMONDS, CARD.JACK_HEARTS, CARD.NINE_SPADES,
                CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS
            ];

            // Pair
            const pair = [
                CARD.ACE_CLUBS, CARD.ACE_DIAMONDS, CARD.KING_HEARTS, CARD.JACK_SPADES,
                CARD.NINE_CLUBS, CARD.SEVEN_DIAMONDS, CARD.FIVE_HEARTS
            ];

            // Straight
            const straight = [
                CARD.ACE_CLUBS, CARD.TWO_DIAMONDS, CARD.THREE_HEARTS, CARD.FOUR_SPADES,
                CARD.FIVE_CLUBS, CARD.NINE_DIAMONDS, CARD.SEVEN_HEARTS
            ];

            // Flush
            const flush = [
                CARD.ACE_CLUBS, CARD.KING_CLUBS, CARD.JACK_CLUBS, CARD.NINE_CLUBS,
                CARD.SEVEN_CLUBS, CARD.FIVE_DIAMONDS, CARD.THREE_HEARTS
            ];

            const highCardRank = await evaluator.evaluateHand(highCard);
            const pairRank = await evaluator.evaluateHand(pair);
            const straightRank = await evaluator.evaluateHand(straight);
            const flushRank = await evaluator.evaluateHand(flush);

            // Verify correct ordering
            expect(pairRank).to.be.greaterThan(highCardRank);
            expect(straightRank).to.be.greaterThan(pairRank);
            expect(flushRank).to.be.greaterThan(straightRank);
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