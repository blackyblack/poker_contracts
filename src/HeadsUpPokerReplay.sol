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

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error NoBlinds();
    error SmallBlindPrevious();
    error SmallBlindAction();
    error SmallBlindSequence();
    error SmallBlindAmount();
    error BigBlindSequence();
    error BigBlindPrevious();
    error BigBlindAction();
    error BigBlindAmount();
    error BigBlindStack();
    error SequenceError();
    error PreviousHashError();
    error BlindOnlyStart();
    error PlayerAllIn();
    error FoldAmount();
    error CallAmount();
    error DepositA();
    error DepositB();
    error StreetOver();
    error CheckAmount();
    error RaiseZero();
    error RaiseStack();
    error RaiseLimit();
    error RaiseIncrement();
    error MinimumRaise();
    error NoReopen();
    error UnknownAction();
    error HandNotDone();

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
        if (actions.length < 2) revert NoBlinds();

        Action calldata sb = actions[0];
        if (sb.prevHash != handGenesis(sb.channelId)) revert SmallBlindPrevious();
        if (sb.action != ACT_SMALL_BLIND) revert SmallBlindAction();
        if (sb.seq != 0) revert SmallBlindSequence();
        if (sb.amount == 0 || sb.amount > stackA) revert SmallBlindAmount();

        Action calldata bb = actions[1];
        if (bb.seq != 1) revert BigBlindSequence();
        if (bb.prevHash != _hashAction(sb)) revert BigBlindPrevious();
        if (bb.action != ACT_BIG_BLIND) revert BigBlindAction();
        if (bb.amount != sb.amount * 2) revert BigBlindAmount();
        if (bb.amount > stackB) revert BigBlindStack();

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

            if (act.seq <= prev.seq) revert SequenceError();
            if (act.prevHash != _hashAction(prev)) revert PreviousHashError();
            if (act.action <= ACT_BIG_BLIND) revert BlindOnlyStart();

            uint256 p = g.actor;
            uint256 opp = 1 - p;

            // allow to move to showdown if someone is all-in
            if (g.allIn[p]) {
                if (g.allIn[opp]) {
                    return (End.SHOWDOWN, 0, g.total[0] + g.total[1]);
                }
                if (act.action != ACT_CHECK_CALL || act.amount != 0) revert PlayerAllIn();
                return (End.SHOWDOWN, 0, g.total[0] + g.total[1]);
            }

            if (g.allIn[p]) revert PlayerAllIn();

            if (act.action == ACT_FOLD) {
                if (act.amount != 0) revert FoldAmount();
                folder = uint8(p);
                end = End.FOLD;
                return (end, folder, g.total[0] + g.total[1]);
            }

            if (act.action == ACT_CHECK_CALL) {
                if (g.toCall > 0) {
                    if (act.amount != 0) revert CallAmount();
                    uint256 callAmt = g.toCall;
                    if (g.stacks[p] < callAmt) {
                        callAmt = g.stacks[p];
                    }
                    g.contrib[p] += callAmt;
                    g.total[p] += callAmt;
                    // DEP_A, DEP_B checks are never reached
                    // keep for invariant checking
                    if (g.total[p] > maxDeposit[p]) {
                        if (p == 0) revert DepositA();
                        else revert DepositB();
                    }
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
                    if (g.street > 3) revert StreetOver();
                    g.contrib[0] = 0;
                    g.contrib[1] = 0;
                    g.actor = 1;
                    g.raiseCount = 0; // Reset raise counter for new street
                    continue;
                }
                // to call is 0, so this is a check
                if (act.amount != 0) revert CheckAmount();
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
                if (act.amount == 0) revert RaiseZero();

                uint256 prevStack = g.stacks[p];
                if (act.amount > prevStack) revert RaiseStack();

                // Check reraise limit
                if (g.raiseCount >= MAX_RAISES_PER_STREET) revert RaiseLimit();

                uint256 toCallBefore = g.toCall;
                uint256 minRaise = g.lastRaise;

                if (toCallBefore > 0) {
                    // check the bet was raised
                    if (act.amount <= toCallBefore) revert RaiseIncrement();

                    uint256 raiseInc = act.amount - toCallBefore;

                    if (raiseInc < minRaise) {
                        // allow short all-in that does not re-open
                        if (act.amount != prevStack) revert MinimumRaise();
                        g.reopen = false;
                    } else {
                        // full raise
                        if (!g.reopen) revert NoReopen();
                        g.reopen = true;
                        g.lastRaise = raiseInc;
                    }
                } else {
                    // starting a bet
                    if (act.amount < minRaise) {
                        // allow short all-in that does not re-open
                        if (act.amount != prevStack) revert MinimumRaise();
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
                if (g.total[p] > maxDeposit[p]) {
                    if (p == 0) revert DepositA();
                    else revert DepositB();
                }

                g.stacks[p] = prevStack - act.amount;
                if (g.stacks[p] == 0) g.allIn[p] = true;

                uint256 newDiff = g.contrib[p] - g.contrib[opp];
                g.toCall = newDiff;
                g.checked = false;
                g.actor = uint8(opp);
                g.raiseCount++; // Increment raise counter
                continue;
            }

            revert UnknownAction();
        }

        revert HandNotDone();
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
