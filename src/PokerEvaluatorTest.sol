// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./PokerEvaluator.sol";

/// @title PokerEvaluatorTest - Test contract for PokerEvaluator library
contract PokerEvaluatorTest {
    
    /// @notice Public wrapper to test the evaluateHand function
    function evaluateHand(uint8[7] memory cards) public pure returns (uint256) {
        return PokerEvaluator.evaluateHand(cards);
    }
    
    /// @notice Helper to create a card for testing
    /// @param suit 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades
    /// @param rank 1=Ace, 2-10=face value, 11=Jack, 12=Queen, 13=King
    function makeCard(uint8 suit, uint8 rank) public pure returns (uint8) {
        return (suit << 4) | rank;
    }
    
    /// @notice Test a simple hand evaluation
    function testSimpleHand() public pure returns (uint256) {
        uint8[7] memory hand;
        // Create a simple high card hand: A-K-Q-J-9-7-5
        hand[0] = (0 << 4) | 1;  // Ace of Clubs
        hand[1] = (1 << 4) | 13; // King of Diamonds  
        hand[2] = (2 << 4) | 12; // Queen of Hearts
        hand[3] = (3 << 4) | 11; // Jack of Spades
        hand[4] = (0 << 4) | 9;  // 9 of Clubs
        hand[5] = (1 << 4) | 7;  // 7 of Diamonds
        hand[6] = (2 << 4) | 5;  // 5 of Hearts
        
        return PokerEvaluator.evaluateHand(hand);
    }
}