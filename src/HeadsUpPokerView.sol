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
    address public escrow;
    HeadsUpPokerPeek public peek;
    HeadsUpPokerShowdown public showdown;

    bool private contractsInitialized;

    event ContractsConfigured(address escrow, address peek, address showdown);

    constructor() Ownable(msg.sender) {}

    function setContracts(
        address escrow_,
        HeadsUpPokerPeek peek_,
        HeadsUpPokerShowdown showdown_
    ) external onlyOwner {
        if (contractsInitialized) revert HelpersAlreadyConfigured();
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
        contractsInitialized = true;

        emit ContractsConfigured(escrow_, address(peek_), address(showdown_));
    }

    modifier helpersReady() {
        if (!contractsInitialized) revert HelpersNotConfigured();
        _;
    }

    function helpersConfigured() external view returns (bool) {
        return contractsInitialized;
    }

    function getRevealedCardA(
        uint256 channelId,
        uint8 index
    ) external view helpersReady returns (bytes memory) {
        return peek.getRevealedCardA(channelId, index);
    }

    function getRevealedCardB(
        uint256 channelId,
        uint8 index
    ) external view helpersReady returns (bytes memory) {
        return peek.getRevealedCardB(channelId, index);
    }

    function getPeek(
        uint256 channelId
    ) external view helpersReady returns (HeadsUpPokerPeek.PeekState memory) {
        return peek.getPeek(channelId);
    }

    function getPeekAddress() external view helpersReady returns (address) {
        return address(peek);
    }

    function getShowdownAddress() external view helpersReady returns (address) {
        return address(showdown);
    }

    function getPublicKeys(
        uint256 channelId
    ) external view helpersReady returns (bytes memory, bytes memory) {
        return peek.getPublicKeys(channelId);
    }

    function getShowdown(
        uint256 channelId
    )
        external
        view
        helpersReady
        returns (HeadsUpPokerShowdown.ShowdownState memory)
    {
        return showdown.getShowdown(channelId);
    }
}
