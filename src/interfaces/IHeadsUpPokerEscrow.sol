// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IHeadsUpPokerEscrow {
    struct ChannelData {
        address player1;
        address player2;
        bool finalized;
        bool gameStarted;
        uint256 handId;
        uint256 deposit1;
        uint256 deposit2;
        uint256 slashAmount;
        uint256 minSmallBlind;
        address player1Signer;
        address player2Signer;
        uint256 startDeadline;
    }

    function getChannelData(
        uint256 channelId
    ) external view returns (ChannelData memory);

    function domainSeparator() external view returns (bytes32);

    function finalizeStaleChannel(uint256 channelId) external;
}
