// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PokerEvaluator - Gas-efficient 7-card poker hand evaluator
/// @notice Evaluates the best 5-card poker hand from 7 cards and returns a sortable rank
/// @dev Uses bit masks and precomputed lookups for maximum gas efficiency
///
/// Design choices for gas optimization:
/// - Card encoding: 4 bits suit + 4 bits rank (fits in uint8)
/// - Rank counting: Packed into single uint256 (4 bits per rank)
/// - Suit counting: Packed into single uint256 (4 bits per suit)
/// - Straight detection: Bit mask operations for O(1) lookup
/// - Flush detection: Single pass count, then extract flush cards
/// - Hand ranking: Single uint256 with hand type in high bits, kickers in low bits
/// - Memory usage: Fixed-size arrays to avoid dynamic allocation
///
/// Card encoding format:
/// - Suit: 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades (upper 4 bits)
/// - Rank: 1=Ace, 2-10=pip cards, 11=Jack, 12=Queen, 13=King (lower 4 bits)
/// - Internal rank conversion: Ace=14 for proper high-card comparison
///
/// Rank format (24 bits used):
/// - Bits 20-23: Hand type (0-8)
/// - Bits 16-19: Primary rank (quads, trips, high pair, or high card)
/// - Bits 12-15: Secondary rank (full house pair, two pair low, or second kicker)
/// - Bits 8-11:  Third rank (third kicker)
/// - Bits 4-7:   Fourth rank (fourth kicker)
/// - Bits 0-3:   Fifth rank (fifth kicker)
library PokerEvaluator {
    // Hand type constants (higher values = better hands)
    uint256 constant HAND_HIGH_CARD = 0;
    uint256 constant HAND_PAIR = 1;
    uint256 constant HAND_TWO_PAIR = 2;
    uint256 constant HAND_THREE_KIND = 3;
    uint256 constant HAND_STRAIGHT = 4;
    uint256 constant HAND_FLUSH = 5;
    uint256 constant HAND_FULL_HOUSE = 6;
    uint256 constant HAND_FOUR_KIND = 7;
    uint256 constant HAND_STRAIGHT_FLUSH = 8;

    // Rank constants (A=14, K=13, Q=12, J=11, 10=10, ..., 2=2)
    uint8 constant ACE = 14;
    uint8 constant KING = 13;
    uint8 constant QUEEN = 12;
    uint8 constant JACK = 11;

    // Suit constants
    uint8 constant CLUBS = 0;
    uint8 constant DIAMONDS = 1;
    uint8 constant HEARTS = 2;
    uint8 constant SPADES = 3;

    /// @notice Evaluates 7 cards and returns the best 5-card hand rank
    /// @param cards Array of 7 cards encoded as uint8 (4 bits suit + 4 bits rank)
    /// @return rank Sortable hand rank where higher values beat lower values
    function evaluateHand(uint8[7] memory cards) internal pure returns (uint256 rank) {
        // Extract suits and ranks for efficient processing
        uint8[7] memory suits;
        uint8[7] memory ranks;
        
        for (uint256 i = 0; i < 7; i++) {
            suits[i] = cards[i] >> 4;  // Upper 4 bits = suit
            ranks[i] = cards[i] & 0x0F; // Lower 4 bits = rank
            
            // Convert rank encoding: 1=Ace, 2-10=face value, 11=J, 12=Q, 13=K
            // to internal: 14=Ace, 2-10=face value, 11=J, 12=Q, 13=K
            if (ranks[i] == 1) {
                ranks[i] = ACE;
            }
        }

        // Count ranks and suits for efficient hand detection
        uint256 rankCounts = 0; // 4 bits per rank (0-15), packed into uint256
        uint256 suitCounts = 0; // 4 bits per suit (0-3), packed into uint256
        
        for (uint256 i = 0; i < 7; i++) {
            uint8 currentRank = ranks[i];
            uint8 currentSuit = suits[i];
            
            // Increment rank count (4 bits per rank, starting at rank*4)
            uint256 rankOffset = currentRank * 4;
            uint256 currentRankCount = (rankCounts >> rankOffset) & 0x0F;
            rankCounts = (rankCounts & ~(0x0F << rankOffset)) | ((currentRankCount + 1) << rankOffset);
            
            // Increment suit count (4 bits per suit, starting at suit*4)
            uint256 suitOffset = currentSuit * 4;
            uint256 currentSuitCount = (suitCounts >> suitOffset) & 0x0F;
            suitCounts = (suitCounts & ~(0x0F << suitOffset)) | ((currentSuitCount + 1) << suitOffset);
        }

        // Check for flush
        bool isFlush = false;
        uint8 flushSuit = 0;
        for (uint8 suit = 0; suit < 4; suit++) {
            uint256 suitOffset = suit * 4;
            uint256 count = (suitCounts >> suitOffset) & 0x0F;
            if (count >= 5) {
                isFlush = true;
                flushSuit = suit;
                break;
            }
        }

        // Check for straight
        (bool isStraight, uint8 straightHigh) = _checkStraight(rankCounts);

        // Check for straight flush
        if (isFlush && isStraight) {
            bool isStraightFlush = _checkStraightFlush(cards, flushSuit);
            if (isStraightFlush) {
                // Straight flush: base rank + straight high card
                return (HAND_STRAIGHT_FLUSH << 20) | (uint256(straightHigh) << 16);
            }
        }

        // Analyze rank patterns for pairs, trips, quads
        (uint8 quads, uint8 trips, uint8 pairs1, uint8 pairs2, uint8[5] memory kickers) = _analyzeRanks(rankCounts);

        if (quads > 0) {
            // Four of a kind: quads rank + kicker
            return (HAND_FOUR_KIND << 20) | (uint256(quads) << 16) | (uint256(kickers[0]) << 12);
        }

        if (trips > 0 && pairs1 > 0) {
            // Full house: trips rank + pair rank
            return (HAND_FULL_HOUSE << 20) | (uint256(trips) << 16) | (uint256(pairs1) << 12);
        }

        if (isFlush) {
            // Flush: get 5 highest cards of flush suit
            uint8[5] memory flushCards = _getFlushCards(cards, flushSuit);
            return (HAND_FLUSH << 20) | 
                   (uint256(flushCards[0]) << 16) | 
                   (uint256(flushCards[1]) << 12) | 
                   (uint256(flushCards[2]) << 8) | 
                   (uint256(flushCards[3]) << 4) | 
                   uint256(flushCards[4]);
        }

        if (isStraight) {
            // Straight: straight high card
            return (HAND_STRAIGHT << 20) | (uint256(straightHigh) << 16);
        }

        if (trips > 0) {
            // Three of a kind: trips rank + 2 kickers
            return (HAND_THREE_KIND << 20) | 
                   (uint256(trips) << 16) | 
                   (uint256(kickers[0]) << 12) | 
                   (uint256(kickers[1]) << 8);
        }

        if (pairs1 > 0 && pairs2 > 0) {
            // Two pair: higher pair + lower pair + kicker
            uint8 highPair = pairs1 > pairs2 ? pairs1 : pairs2;
            uint8 lowPair = pairs1 > pairs2 ? pairs2 : pairs1;
            return (HAND_TWO_PAIR << 20) | 
                   (uint256(highPair) << 16) | 
                   (uint256(lowPair) << 12) | 
                   (uint256(kickers[0]) << 8);
        }

        if (pairs1 > 0) {
            // One pair: pair rank + 3 kickers
            return (HAND_PAIR << 20) | 
                   (uint256(pairs1) << 16) | 
                   (uint256(kickers[0]) << 12) | 
                   (uint256(kickers[1]) << 8) | 
                   (uint256(kickers[2]) << 4);
        }

        // High card: 5 highest cards
        return (HAND_HIGH_CARD << 20) | 
               (uint256(kickers[0]) << 16) | 
               (uint256(kickers[1]) << 12) | 
               (uint256(kickers[2]) << 8) | 
               (uint256(kickers[3]) << 4) | 
               uint256(kickers[4]);
    }

    /// @dev Check for straight using bit manipulation
    function _checkStraight(uint256 rankCounts) private pure returns (bool, uint8) {
        // Create a bit mask where bit i is set if rank i appears
        uint256 rankMask = 0;
        for (uint8 rank = 2; rank <= ACE; rank++) {
            uint256 rankOffset = rank * 4;
            uint256 count = (rankCounts >> rankOffset) & 0x0F;
            if (count > 0) {
                rankMask |= (1 << rank);
            }
        }

        // Check for A-2-3-4-5 straight (wheel)
        if ((rankMask & 0x403C) == 0x403C) { // A(14), 2, 3, 4, 5
            return (true, 5); // 5-high straight
        }

        // Check for regular straights (5 consecutive ranks)
        for (uint8 high = 6; high <= ACE; high++) {
            uint256 straightMask = 0x1F << (high - 4); // 5 consecutive bits
            if ((rankMask & straightMask) == straightMask) {
                return (true, high);
            }
        }

        return (false, 0);
    }

    /// @dev Check if there's a straight flush in the given suit
    function _checkStraightFlush(uint8[7] memory cards, uint8 flushSuit) private pure returns (bool) {
        uint256 suitRankMask = 0;
        
        for (uint256 i = 0; i < 7; i++) {
            uint8 suit = cards[i] >> 4;
            if (suit == flushSuit) {
                uint8 rank = cards[i] & 0x0F;
                if (rank == 1) rank = ACE; // Convert ace
                suitRankMask |= (1 << rank);
            }
        }

        // Check for A-2-3-4-5 straight flush
        if ((suitRankMask & 0x403C) == 0x403C) {
            return true;
        }

        // Check for regular straight flushes
        for (uint8 high = 6; high <= ACE; high++) {
            uint256 straightMask = 0x1F << (high - 4);
            if ((suitRankMask & straightMask) == straightMask) {
                return true;
            }
        }

        return false;
    }

    /// @dev Analyze rank counts to find pairs, trips, quads and kickers
    function _analyzeRanks(uint256 rankCounts) private pure returns (
        uint8 quads,
        uint8 trips, 
        uint8 pairs1,
        uint8 pairs2,
        uint8[5] memory kickers
    ) {
        uint8 kickerCount = 0;
        
        // Analyze from high to low for proper kicker ordering
        for (uint16 rank = ACE; rank >= 2 && kickerCount < 5; rank--) {
            uint256 rankOffset = rank * 4;
            uint256 count = (rankCounts >> rankOffset) & 0x0F;
            
            if (count == 4) {
                quads = uint8(rank);
            } else if (count == 3) {
                trips = uint8(rank);
            } else if (count == 2) {
                if (pairs1 == 0) {
                    pairs1 = uint8(rank);
                } else {
                    pairs2 = uint8(rank);
                }
            } else if (count == 1 && kickerCount < 5) {
                kickers[kickerCount++] = uint8(rank);
            }
        }
        
        return (quads, trips, pairs1, pairs2, kickers);
    }

    /// @dev Get the 5 highest cards of the flush suit
    function _getFlushCards(uint8[7] memory cards, uint8 flushSuit) private pure returns (uint8[5] memory) {
        uint8[7] memory flushRanks;
        uint8 flushCount = 0;
        
        // Collect all cards of the flush suit
        for (uint256 i = 0; i < 7; i++) {
            uint8 suit = cards[i] >> 4;
            if (suit == flushSuit) {
                uint8 rank = cards[i] & 0x0F;
                if (rank == 1) rank = ACE; // Convert ace
                flushRanks[flushCount++] = rank;
            }
        }
        
        // Sort flush ranks in descending order (bubble sort is fine for 7 cards)
        for (uint256 i = 0; i < flushCount - 1; i++) {
            for (uint256 j = 0; j < flushCount - 1 - i; j++) {
                if (flushRanks[j] < flushRanks[j + 1]) {
                    uint8 temp = flushRanks[j];
                    flushRanks[j] = flushRanks[j + 1];
                    flushRanks[j + 1] = temp;
                }
            }
        }
        
        uint8[5] memory result;
        for (uint256 i = 0; i < 5; i++) {
            result[i] = flushRanks[i];
        }
        return result;
    }
}