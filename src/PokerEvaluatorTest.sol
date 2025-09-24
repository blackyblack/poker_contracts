// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./PokerEvaluator.sol";

/// @title PokerEvaluatorTest - Test contract for PokerEvaluator library
contract PokerEvaluatorTest {
    /// @notice Public wrapper to test the evaluateHand function
    function evaluateHand(uint8[7] memory cards) public pure returns (uint256) {
        return PokerEvaluator.evaluateHand(cards);
    }
}
