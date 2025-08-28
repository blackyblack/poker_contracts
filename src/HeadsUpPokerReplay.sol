// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Action} from "./HeadsUpPokerActions.sol";

contract HeadsUpPokerReplay {
    enum End {
        FOLD,
        SHOWDOWN
    }

    uint8 private constant ACT_SMALL_BLIND = 0;
    uint8 private constant ACT_BIG_BLIND = 1;
    uint8 private constant ACT_FOLD = 2;
    uint8 private constant ACT_CHECK_CALL = 3;
    uint8 private constant ACT_BET_RAISE = 4;

    uint8 private constant MAX_RAISES_PER_STREET = 4;

    bytes32 private constant ACTION_TYPEHASH =
        keccak256(
            "Action(uint256 channelId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash)"
        );

    struct Game {
        uint256[2] stacks;
        uint256[2] contrib;
        uint256[2] total;
        bool[2] allIn;
        uint8 actor;
        uint8 street;
        uint256 toCall;
        uint256 lastRaise;
        bool checked;
        bool reopen;
        uint8 raiseCount;  // Number of raises on current street
    }

    function handGenesis(uint256 chId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("HUP_GENESIS", chId));
    }

    /// @notice Replays a sequence of actions and returns the terminal state
    /// @dev Reverts when an invalid transition is encountered
    function replayAndGetEndState(
        Action[] calldata actions,
        uint256 stackA,
        uint256 stackB
    ) external pure returns (End end, uint8 folder, uint256 potSize) {
        require(actions.length >= 2, "NO_BLINDS");

        Action calldata sb = actions[0];
        require(sb.prevHash == handGenesis(sb.channelId), "SB_PREV");
        require(sb.action == ACT_SMALL_BLIND, "SB_ACT");
        require(sb.seq == 0, "SB_SEQ");
        require(sb.amount > 0 && sb.amount <= stackA, "SB_AMT");

        Action calldata bb = actions[1];
        require(bb.seq == 1, "BB_SEQ");
        require(bb.prevHash == _hashAction(sb), "BB_PREV");
        require(bb.action == ACT_BIG_BLIND, "BB_ACT");
        require(bb.amount == sb.amount * 2, "BB_AMT");
        require(bb.amount <= stackB, "BB_STACK");

        uint256 bigBlind = bb.amount;

        Game memory g;
        g.stacks[0] = stackA - sb.amount;
        g.stacks[1] = stackB - bb.amount;
        g.contrib[0] = sb.amount;
        g.contrib[1] = bb.amount;
        g.total[0] = sb.amount;
        g.total[1] = bb.amount;
        if (g.stacks[0] == 0) g.allIn[0] = true;
        if (g.stacks[1] == 0) g.allIn[1] = true;
        g.actor = 0; // small blind acts first preflop
        g.street = 0;
        g.toCall = g.contrib[1] - g.contrib[0];
        g.lastRaise = bigBlind;
        g.checked = false;
        g.reopen = true;
        g.raiseCount = 1; // Big blind counts as first raise

        // If both players are all-in after blinds, go directly to showdown
        if (g.allIn[0] && g.allIn[1]) {
            return (End.SHOWDOWN, 0, g.total[0] + g.total[1]);
        }

        uint256[2] memory maxDeposit = [stackA, stackB];

        for (uint256 i = 2; i < actions.length; i++) {
            Action calldata act = actions[i];
            Action calldata prev = actions[i - 1];

            require(act.seq > prev.seq, "SEQ");
            require(act.prevHash == _hashAction(prev), "PREV_HASH");
            require(act.action > ACT_BIG_BLIND, "BLIND_ONLY_START");

            uint256 p = g.actor;
            uint256 opp = 1 - p;

            // allow to move to showdown if someone is all-in
            if (g.allIn[p]) {
                if (g.allIn[opp]) {
                    return (End.SHOWDOWN, 0, g.total[0] + g.total[1]);
                }
                require(act.action == ACT_CHECK_CALL && act.amount == 0, "PLAYER_ALLIN");
                return (End.SHOWDOWN, 0, g.total[0] + g.total[1]);
            }

            require(!g.allIn[p], "PLAYER_ALLIN");

            if (act.action == ACT_FOLD) {
                require(act.amount == 0, "FOLD_AMT");
                folder = uint8(p);
                end = End.FOLD;
                return (end, folder, g.total[0] + g.total[1]);
            }

            if (act.action == ACT_CHECK_CALL) {
                if (g.toCall > 0) {
                    require(act.amount == 0, "CALL_AMT");
                    uint256 callAmt = g.toCall;
                    if (g.stacks[p] < callAmt) {
                        callAmt = g.stacks[p];
                    }
                    g.contrib[p] += callAmt;
                    g.total[p] += callAmt;
                    // DEP_A, DEP_B checks are never reached
                    // keep for invariant checking
                    require(
                        g.total[p] <= maxDeposit[p],
                        p == 0 ? "DEP_A" : "DEP_B"
                    );
                    g.stacks[p] -= callAmt;
                    if (g.stacks[p] == 0) g.allIn[p] = true;
                    g.toCall = 0;
                    g.lastRaise = bigBlind;
                    g.checked = false;
                    g.reopen = true;
                    // if someone has all-in and no bet to call, we go to showdown
                    if (g.allIn[0] || g.allIn[1]) {
                        return (End.SHOWDOWN, 0, g.total[0] + g.total[1]);
                    }
                    g.street++;
                    require(g.street <= 3, "STREET_OVER");
                    g.contrib[0] = 0;
                    g.contrib[1] = 0;
                    g.actor = 1;
                    g.raiseCount = 0; // Reset raise counter for new street
                    continue;
                }
                // to call is 0, so this is a check
                require(act.amount == 0, "CHECK_AMT");
                if (g.checked) {
                    g.street++;
                    if (g.street == 4) {
                        return (End.SHOWDOWN, 0, g.total[0] + g.total[1]);
                    }
                    g.contrib[0] = 0;
                    g.contrib[1] = 0;
                    g.actor = 1;
                    g.checked = false;
                    g.reopen = true;
                    g.lastRaise = bigBlind;
                    g.raiseCount = 0; // Reset raise counter for new street
                } else {
                    g.checked = true;
                    g.actor = uint8(opp);
                }
                continue;
            }

            if (act.action == ACT_BET_RAISE) {
                require(act.amount > 0, "RAISE_ZERO");

                uint256 prevStack = g.stacks[p];
                require(act.amount <= prevStack, "RAISE_STACK");

                // Check reraise limit
                require(g.raiseCount < MAX_RAISES_PER_STREET, "RAISE_LIMIT");

                uint256 toCallBefore = g.toCall;
                uint256 minRaise = g.lastRaise;

                if (toCallBefore > 0) {
                    // check the bet was raised
                    require(act.amount > toCallBefore, "RAISE_INC");

                    uint256 raiseInc = act.amount - toCallBefore;

                    if (raiseInc < minRaise) {
                        // allow short all-in that does not re-open
                        require(act.amount == prevStack, "MIN_RAISE");
                        g.reopen = false;
                    } else {
                        // full raise
                        require(g.reopen, "NO_REOPEN");
                        g.reopen = true;
                        g.lastRaise = raiseInc;
                    }
                } else {
                    // starting a bet
                    if (act.amount < minRaise) {
                        // allow short all-in that does not re-open
                        require(act.amount == prevStack, "MIN_RAISE");
                        g.reopen = false;
                    } else {
                        g.reopen = true;
                        g.lastRaise = act.amount;
                    }
                }

                g.contrib[p] += act.amount;
                g.total[p] += act.amount;
                // DEP_A, DEP_B checks are never reached
                // keep for invariant checking
                require(
                    g.total[p] <= maxDeposit[p],
                    p == 0 ? "DEP_A" : "DEP_B"
                );

                g.stacks[p] = prevStack - act.amount;
                if (g.stacks[p] == 0) g.allIn[p] = true;

                uint256 newDiff = g.contrib[p] - g.contrib[opp];
                g.toCall = newDiff;
                g.checked = false;
                g.actor = uint8(opp);
                g.raiseCount++; // Increment raise counter
                continue;
            }

            revert("UNK_ACTION");
        }

        revert("HAND_NOT_DONE");
    }

    function _hashAction(Action calldata act) private pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    ACTION_TYPEHASH,
                    act.channelId,
                    act.seq,
                    act.action,
                    act.amount,
                    act.prevHash
                )
            );
    }
}
