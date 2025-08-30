const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PokerEvaluator", function () {
    let evaluator;

    beforeEach(async function () {
        const PokerEvaluator = await ethers.getContractFactory("PokerEvaluator");
        evaluator = await PokerEvaluator.deploy();
    });

    // Helper function to create a card
    // suit: 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades
    // rank: 1=Ace, 2-10=face value, 11=Jack, 12=Queen, 13=King
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

    describe("Basic Hand Rankings", function () {
        it("should rank high card correctly", async function () {
            // A-K-Q-J-9 high (mixed suits)
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 13), // King of Diamonds
                makeCard(2, 12), // Queen of Hearts
                makeCard(3, 11), // Jack of Spades
                makeCard(0, 9),  // 9 of Clubs
                makeCard(1, 7),  // 7 of Diamonds
                makeCard(2, 5)   // 5 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            
            // High card = 0, so rank should be 0 << 20 + kickers
            const handType = rank >> 20n;
            expect(handType).to.equal(0n); // HAND_HIGH_CARD
        });

        it("should rank pair correctly", async function () {
            // Pair of Aces with K-Q-J kickers
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 1),  // Ace of Diamonds
                makeCard(2, 13), // King of Hearts
                makeCard(3, 12), // Queen of Spades
                makeCard(0, 11), // Jack of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(1n); // HAND_PAIR
        });

        it("should rank two pair correctly", async function () {
            // Aces and Kings with Queen kicker
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 1),  // Ace of Diamonds
                makeCard(2, 13), // King of Hearts
                makeCard(3, 13), // King of Spades
                makeCard(0, 12), // Queen of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(2n); // HAND_TWO_PAIR
        });

        it("should rank three of a kind correctly", async function () {
            // Three Aces with K-Q kickers
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 1),  // Ace of Diamonds
                makeCard(2, 1),  // Ace of Hearts
                makeCard(3, 13), // King of Spades
                makeCard(0, 12), // Queen of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(3n); // HAND_THREE_KIND
        });

        it("should rank straight correctly", async function () {
            // A-2-3-4-5 straight (wheel)
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 2),  // 2 of Diamonds
                makeCard(2, 3),  // 3 of Hearts
                makeCard(3, 4),  // 4 of Spades
                makeCard(0, 5),  // 5 of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });

        it("should rank flush correctly", async function () {
            // Ace high flush in clubs
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(0, 13), // King of Clubs
                makeCard(0, 11), // Jack of Clubs
                makeCard(0, 9),  // 9 of Clubs
                makeCard(0, 7),  // 7 of Clubs
                makeCard(1, 5),  // 5 of Diamonds
                makeCard(2, 3)   // 3 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(5n); // HAND_FLUSH
        });

        it("should rank full house correctly", async function () {
            // Aces full of Kings
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 1),  // Ace of Diamonds
                makeCard(2, 1),  // Ace of Hearts
                makeCard(3, 13), // King of Spades
                makeCard(0, 13), // King of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(6n); // HAND_FULL_HOUSE
        });

        it("should rank four of a kind correctly", async function () {
            // Four Aces with King kicker
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 1),  // Ace of Diamonds
                makeCard(2, 1),  // Ace of Hearts
                makeCard(3, 1),  // Ace of Spades
                makeCard(0, 13), // King of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(7n); // HAND_FOUR_KIND
        });

        it("should rank straight flush correctly", async function () {
            // 5-high straight flush in clubs (wheel)
            const hand = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(0, 2),  // 2 of Clubs
                makeCard(0, 3),  // 3 of Clubs
                makeCard(0, 4),  // 4 of Clubs
                makeCard(0, 5),  // 5 of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
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
                makeCard(0, 10), // 10 of Clubs
                makeCard(1, 11), // Jack of Diamonds
                makeCard(2, 12), // Queen of Hearts
                makeCard(3, 13), // King of Spades
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 5),  // 5 of Diamonds
                makeCard(2, 3)   // 3 of Hearts
            ]);

            // Flush: 7-high flush
            const flush = makeHand([
                makeCard(0, 7),  // 7 of Clubs
                makeCard(0, 5),  // 5 of Clubs
                makeCard(0, 4),  // 4 of Clubs
                makeCard(0, 3),  // 3 of Clubs
                makeCard(0, 2),  // 2 of Clubs
                makeCard(1, 13), // King of Diamonds
                makeCard(2, 12)  // Queen of Hearts
            ]);

            const straightRank = await evaluator.evaluateHand(straight);
            const flushRank = await evaluator.evaluateHand(flush);

            expect(flushRank).to.be.greaterThan(straightRank);
        });

        it("should rank higher pairs correctly", async function () {
            // Pair of Aces
            const acePair = makeHand([
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 1),  // Ace of Diamonds
                makeCard(2, 13), // King of Hearts
                makeCard(3, 12), // Queen of Spades
                makeCard(0, 11), // Jack of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            // Pair of Kings
            const kingPair = makeHand([
                makeCard(0, 13), // King of Clubs
                makeCard(1, 13), // King of Diamonds
                makeCard(2, 1),  // Ace of Hearts
                makeCard(3, 12), // Queen of Spades
                makeCard(0, 11), // Jack of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
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
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 2),  // 2 of Diamonds
                makeCard(2, 3),  // 3 of Hearts
                makeCard(3, 4),  // 4 of Spades
                makeCard(0, 5),  // 5 of Clubs
                makeCard(1, 9),  // 9 of Diamonds
                makeCard(2, 7)   // 7 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });

        it("should handle broadway straight correctly", async function () {
            // 10-J-Q-K-A straight
            const hand = makeHand([
                makeCard(0, 10), // 10 of Clubs
                makeCard(1, 11), // Jack of Diamonds
                makeCard(2, 12), // Queen of Hearts
                makeCard(3, 13), // King of Spades
                makeCard(0, 1),  // Ace of Clubs
                makeCard(1, 5),  // 5 of Diamonds
                makeCard(2, 3)   // 3 of Hearts
            ]);

            const rank = await evaluator.evaluateHand(hand);
            const handType = rank >> 20n;
            expect(handType).to.equal(4n); // HAND_STRAIGHT
        });
    });
});