const { expect } = require("chai");
const { ethers } = require("hardhat");
const { CARD } = require("./cards");

describe("PokerEvaluator", function () {
    let evaluator;

    beforeEach(async function () {
        const PokerEvaluator = await ethers.getContractFactory("PokerEvaluator");
        evaluator = await PokerEvaluator.deploy();
    });

    // Helper to create test hands
    function makeHand(cards) {
        const hand = new Array(7).fill(0);
        for (let i = 0; i < cards.length && i < 7; i++) {
            hand[i] = cards[i];
        }
        return hand;
    }

    describe("Basic Hand Rankings", function () {
        it("should rank high card correctly", async function () {
            // A-K-Q-J-9 high (mixed suits)
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.KING_DIAMONDS, // King of Diamonds
                CARD.QUEEN_HEARTS,  // Queen of Hearts
                CARD.JACK_SPADES,   // Jack of Spades
                CARD.NINE_CLUBS,    // 9 of Clubs
                CARD.SEVEN_DIAMONDS,// 7 of Diamonds
                CARD.FIVE_HEARTS    // 5 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            
            // High card = 0, so rank should be 0 << 20 + kickers
            const handType = rank >> 20n;
            expect(handType).to.equal(0n); // HAND_HIGH_CARD
        });

        it("should rank pair correctly", async function () {
            // Pair of Aces with K-Q-J kickers
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.ACE_DIAMONDS,  // Ace of Diamonds
                CARD.KING_HEARTS,   // King of Hearts
                CARD.QUEEN_SPADES,  // Queen of Spades
                CARD.JACK_CLUBS,    // Jack of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(1n); // HAND_PAIR
        });

        it("should rank two pair correctly", async function () {
            // Aces and Kings with Queen kicker
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.ACE_DIAMONDS,  // Ace of Diamonds
                CARD.KING_HEARTS,   // King of Hearts
                CARD.KING_SPADES,   // King of Spades
                CARD.QUEEN_CLUBS,   // Queen of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(2n); // HAND_TWO_PAIR
        });

        it("should rank three of a kind correctly", async function () {
            // Three Aces with K-Q kickers
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.ACE_DIAMONDS,  // Ace of Diamonds
                CARD.ACE_HEARTS,    // Ace of Hearts
                CARD.KING_SPADES,   // King of Spades
                CARD.QUEEN_CLUBS,   // Queen of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(3n); // HAND_THREE_KIND
        });

        it("should rank straight correctly", async function () {
            // A-2-3-4-5 straight (wheel)
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.TWO_DIAMONDS,  // 2 of Diamonds
                CARD.THREE_HEARTS,  // 3 of Hearts
                CARD.FOUR_SPADES,   // 4 of Spades
                CARD.FIVE_CLUBS,    // 5 of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });

        it("should rank flush correctly", async function () {
            // Ace high flush in clubs
            const hand = makeHand([
                CARD.ACE_CLUBS,    // Ace of Clubs
                CARD.KING_CLUBS,   // King of Clubs
                CARD.JACK_CLUBS,   // Jack of Clubs
                CARD.NINE_CLUBS,   // 9 of Clubs
                CARD.SEVEN_CLUBS,  // 7 of Clubs
                CARD.FIVE_DIAMONDS,// 5 of Diamonds
                CARD.THREE_HEARTS  // 3 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(5n); // HAND_FLUSH
        });

        it("should rank full house correctly", async function () {
            // Aces full of Kings
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.ACE_DIAMONDS,  // Ace of Diamonds
                CARD.ACE_HEARTS,    // Ace of Hearts
                CARD.KING_SPADES,   // King of Spades
                CARD.KING_CLUBS,    // King of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(6n); // HAND_FULL_HOUSE
        });

        it("should rank four of a kind correctly", async function () {
            // Four Aces with King kicker
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.ACE_DIAMONDS,  // Ace of Diamonds
                CARD.ACE_HEARTS,    // Ace of Hearts
                CARD.ACE_SPADES,    // Ace of Spades
                CARD.KING_CLUBS,    // King of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(7n); // HAND_FOUR_KIND
        });

        it("should rank straight flush correctly", async function () {
            // 5-high straight flush in clubs (wheel)
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.TWO_CLUBS,     // 2 of Clubs
                CARD.THREE_CLUBS,   // 3 of Clubs
                CARD.FOUR_CLUBS,    // 4 of Clubs
                CARD.FIVE_CLUBS,    // 5 of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(8n); // HAND_STRAIGHT_FLUSH
        });
    });

    describe("Hand Comparison", function () {
        it("should rank flush higher than straight", async function () {
            // Straight: 10-J-Q-K-A
            const straight = makeHand([
                CARD.TEN_CLUBS,     // 10 of Clubs
                CARD.JACK_DIAMONDS, // Jack of Diamonds
                CARD.QUEEN_HEARTS,  // Queen of Hearts
                CARD.KING_SPADES,   // King of Spades
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.FIVE_DIAMONDS, // 5 of Diamonds
                CARD.THREE_HEARTS   // 3 of Hearts
            ]);

            // Flush: 7-high flush
            const flush = makeHand([
                CARD.SEVEN_CLUBS,   // 7 of Clubs
                CARD.FIVE_CLUBS,    // 5 of Clubs
                CARD.FOUR_CLUBS,    // 4 of Clubs
                CARD.THREE_CLUBS,   // 3 of Clubs
                CARD.TWO_CLUBS,     // 2 of Clubs
                CARD.KING_DIAMONDS, // King of Diamonds
                CARD.QUEEN_HEARTS   // Queen of Hearts
            ]);

            const straightRank = await evaluator.evaluateHand(straight);
            const flushRank = await evaluator.evaluateHand(flush);

            expect(flushRank).to.be.greaterThan(straightRank);
        });

        it("should rank higher pairs correctly", async function () {
            // Pair of Aces
            const acePair = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.ACE_DIAMONDS,  // Ace of Diamonds
                CARD.KING_HEARTS,   // King of Hearts
                CARD.QUEEN_SPADES,  // Queen of Spades
                CARD.JACK_CLUBS,    // Jack of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            // Pair of Kings
            const kingPair = makeHand([
                CARD.KING_CLUBS,    // King of Clubs
                CARD.KING_DIAMONDS, // King of Diamonds
                CARD.ACE_HEARTS,    // Ace of Hearts
                CARD.QUEEN_SPADES,  // Queen of Spades
                CARD.JACK_CLUBS,    // Jack of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const aceRank = await evaluator.evaluateHand(acePair);
            const kingRank = await evaluator.evaluateHand(kingPair);

            expect(aceRank).to.be.greaterThan(kingRank);
        });
    });

    describe("Edge Cases", function () {
        it("should handle ace-low straight correctly", async function () {
            // A-2-3-4-5 straight
            const hand = makeHand([
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.TWO_DIAMONDS,  // 2 of Diamonds
                CARD.THREE_HEARTS,  // 3 of Hearts
                CARD.FOUR_SPADES,   // 4 of Spades
                CARD.FIVE_CLUBS,    // 5 of Clubs
                CARD.NINE_DIAMONDS, // 9 of Diamonds
                CARD.SEVEN_HEARTS   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });

        it("should handle broadway straight correctly", async function () {
            // 10-J-Q-K-A straight
            const hand = makeHand([
                CARD.TEN_CLUBS,     // 10 of Clubs
                CARD.JACK_DIAMONDS, // Jack of Diamonds
                CARD.QUEEN_HEARTS,  // Queen of Hearts
                CARD.KING_SPADES,   // King of Spades
                CARD.ACE_CLUBS,     // Ace of Clubs
                CARD.FIVE_DIAMONDS, // 5 of Diamonds
                CARD.THREE_HEARTS   // 3 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });
    });
});