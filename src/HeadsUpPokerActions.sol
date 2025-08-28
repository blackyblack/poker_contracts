// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

struct Action {
    uint256 channelId;
    uint32 seq;
    uint8 action;
    uint128 amount;
    bytes32 prevHash;
}
