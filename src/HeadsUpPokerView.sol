// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

import {HeadsUpPokerPeek} from "./HeadsUpPokerPeek.sol";
import {HeadsUpPokerShowdown} from "./HeadsUpPokerShowdown.sol";
import "./HeadsUpPokerErrors.sol";

/// @title HeadsUpPokerView - Read-only facade for HeadsUpPoker contracts
/// @notice Provides read access to peek and showdown state without exposing
///         the storage contracts directly from the escrow.
contract HeadsUpPokerView is Ownable {
    address public immutable escrow;
    HeadsUpPokerPeek public immutable peek;
    HeadsUpPokerShowdown public immutable showdown;

    constructor(address escrow_, HeadsUpPokerPeek peek_, HeadsUpPokerShowdown showdown_) Ownable(msg.sender) {
        if (
            escrow_ == address(0) ||
            address(peek_) == address(0) ||
            address(showdown_) == address(0)
        ) {
            revert HelpersNotConfigured();
        }

        escrow = escrow_;
        peek = peek_;
        showdown = showdown_;
    }

    function getRevealedCardA(
        uint256 channelId,
        uint8 index
    ) external view returns (bytes memory) {
        return peek.getRevealedCardA(channelId, index);
    }

    function getRevealedCardB(
        uint256 channelId,
        uint8 index
    ) external view returns (bytes memory) {
        return peek.getRevealedCardB(channelId, index);
    }

    function getPeek(
        uint256 channelId
    ) external view returns (HeadsUpPokerPeek.PeekState memory) {
        return peek.getPeek(channelId);
    }

    function getPeekAddress() external view returns (address) {
        return address(peek);
    }

    function getShowdownAddress() external view returns (address) {
        return address(showdown);
    }

    function getPublicKeys(
        uint256 channelId
    ) external view returns (bytes memory, bytes memory) {
        return peek.getPublicKeys(channelId);
    }

    function getShowdown(
        uint256 channelId
    )
        external
        view
        returns (HeadsUpPokerShowdown.ShowdownState memory)
    {
        return showdown.getShowdown(channelId);
    }
}
