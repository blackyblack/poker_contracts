/**
 * Comprehensive card enum for poker tests
 * 
 * Card encoding: (suit << 4) | rank
 * - Suits: 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades
 * - Ranks: 1=Ace, 2-10=face value, 11=Jack, 12=Queen, 13=King
 */

// Helper function to create a card
function makeCard(suit, rank) {
    return (suit << 4) | rank;
}

// Helper function to get card index (0-51) from card encoding
export function cardToIndex(card) {
    const rank = card & 0x0f;
    const suit = (card >> 4) & 0x0f;
    return (rank - 1) * 4 + suit;
}

export const CARD = {
    // Clubs (suit = 0)
    ACE_CLUBS: makeCard(0, 1),
    TWO_CLUBS: makeCard(0, 2),
    THREE_CLUBS: makeCard(0, 3),
    FOUR_CLUBS: makeCard(0, 4),
    FIVE_CLUBS: makeCard(0, 5),
    SIX_CLUBS: makeCard(0, 6),
    SEVEN_CLUBS: makeCard(0, 7),
    EIGHT_CLUBS: makeCard(0, 8),
    NINE_CLUBS: makeCard(0, 9),
    TEN_CLUBS: makeCard(0, 10),
    JACK_CLUBS: makeCard(0, 11),
    QUEEN_CLUBS: makeCard(0, 12),
    KING_CLUBS: makeCard(0, 13),

    // Diamonds (suit = 1)
    ACE_DIAMONDS: makeCard(1, 1),
    TWO_DIAMONDS: makeCard(1, 2),
    THREE_DIAMONDS: makeCard(1, 3),
    FOUR_DIAMONDS: makeCard(1, 4),
    FIVE_DIAMONDS: makeCard(1, 5),
    SIX_DIAMONDS: makeCard(1, 6),
    SEVEN_DIAMONDS: makeCard(1, 7),
    EIGHT_DIAMONDS: makeCard(1, 8),
    NINE_DIAMONDS: makeCard(1, 9),
    TEN_DIAMONDS: makeCard(1, 10),
    JACK_DIAMONDS: makeCard(1, 11),
    QUEEN_DIAMONDS: makeCard(1, 12),
    KING_DIAMONDS: makeCard(1, 13),

    // Hearts (suit = 2)
    ACE_HEARTS: makeCard(2, 1),
    TWO_HEARTS: makeCard(2, 2),
    THREE_HEARTS: makeCard(2, 3),
    FOUR_HEARTS: makeCard(2, 4),
    FIVE_HEARTS: makeCard(2, 5),
    SIX_HEARTS: makeCard(2, 6),
    SEVEN_HEARTS: makeCard(2, 7),
    EIGHT_HEARTS: makeCard(2, 8),
    NINE_HEARTS: makeCard(2, 9),
    TEN_HEARTS: makeCard(2, 10),
    JACK_HEARTS: makeCard(2, 11),
    QUEEN_HEARTS: makeCard(2, 12),
    KING_HEARTS: makeCard(2, 13),

    // Spades (suit = 3)
    ACE_SPADES: makeCard(3, 1),
    TWO_SPADES: makeCard(3, 2),
    THREE_SPADES: makeCard(3, 3),
    FOUR_SPADES: makeCard(3, 4),
    FIVE_SPADES: makeCard(3, 5),
    SIX_SPADES: makeCard(3, 6),
    SEVEN_SPADES: makeCard(3, 7),
    EIGHT_SPADES: makeCard(3, 8),
    NINE_SPADES: makeCard(3, 9),
    TEN_SPADES: makeCard(3, 10),
    JACK_SPADES: makeCard(3, 11),
    QUEEN_SPADES: makeCard(3, 12),
    KING_SPADES: makeCard(3, 13),

    // Alternative naming patterns for convenience
    // Short suit names
    AC: makeCard(0, 1), // Ace of Clubs
    KC: makeCard(0, 13), // King of Clubs
    QC: makeCard(0, 12), // Queen of Clubs
    JC: makeCard(0, 11), // Jack of Clubs

    AD: makeCard(1, 1), // Ace of Diamonds
    KD: makeCard(1, 13), // King of Diamonds
    QD: makeCard(1, 12), // Queen of Diamonds
    JD: makeCard(1, 11), // Jack of Diamonds

    AH: makeCard(2, 1), // Ace of Hearts
    KH: makeCard(2, 13), // King of Hearts
    QH: makeCard(2, 12), // Queen of Hearts
    JH: makeCard(2, 11), // Jack of Hearts

    AS: makeCard(3, 1), // Ace of Spades
    KS: makeCard(3, 13), // King of Spades
    QS: makeCard(3, 12), // Queen of Spades
    JS: makeCard(3, 11), // Jack of Spades
};
