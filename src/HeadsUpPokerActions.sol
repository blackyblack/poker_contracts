// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct Action {
    uint256 channelId;
    uint256 handId;
    uint32 seq;
    uint8 street;
    uint8 action;
    uint128 amount;
    bytes32 prevHash;
}
