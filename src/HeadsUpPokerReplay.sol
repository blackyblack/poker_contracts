// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Action} from "./HeadsUpPokerActions.sol";

contract HeadsUpPokerReplay {
    enum End {
        FOLD,
        SHOWDOWN,
        NO_BLINDS
    }

    uint8 private constant ACT_SMALL_BLIND = 0;
    uint8 private constant ACT_BIG_BLIND = 1;
    uint8 private constant ACT_FOLD = 2;
    uint8 private constant ACT_CHECK_CALL = 3;
    uint8 private constant ACT_BET_RAISE = 4;

    uint8 private constant MAX_RAISES_PER_STREET = 4;

    bytes32 private constant ACTION_TYPEHASH =
        keccak256(
            "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash)"
        );

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error NoBlinds();
    error SmallBlindPrevHashInvalid();
    error SmallBlindActionInvalid();
    error SmallBlindSequenceInvalid();
    error SmallBlindAmountInvalid();
    error BigBlindSequenceInvalid();
    error BigBlindPrevHashInvalid();
    error BigBlindActionInvalid();
    error BigBlindAmountInvalid();
    error BigBlindStackInvalid();
    error SequenceInvalid();
    error PrevHashInvalid();
    error BlindOnlyStart();
    error PlayerAllIn();
    error FoldAmountInvalid();
    error CallAmountInvalid();
    error StreetOverflow();
    error CheckAmountInvalid();
    error RaiseAmountZero();
    error RaiseStackInvalid();
    error RaiseLimitExceeded();
    error RaiseInsufficientIncrease();
    error MinimumRaiseNotMet();
    error NoReopenAllowed();
    error UnknownAction();
    error HandNotDone();

    struct Game {
        uint256[2] stacks;
        uint256[2] contrib;
        uint256[2] total;
        bool[2] allIn;
        uint8 actor;
        uint8 bigBlindPlayer;
        uint256 bigBlindAmount;
        uint8 street;
        uint256 toCall;
        uint256 lastRaise;
        bool checked;
        bool reopen;
        uint8 raiseCount; // Number of raises on current street
    }

    struct ReplayResult {
        bool ended;
        End end;
        uint8 folder;
    }

    function handGenesis(
        uint256 chId,
        uint256 handId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("HUP_GENESIS", chId, handId));
    }

    /// @notice Determines which player should post the small blind based on handId
    /// @param handId The hand identifier
    /// @return smallBlindPlayer The player index (0 or 1) who should post small blind
    function getSmallBlindPlayer(uint256 handId) internal pure returns (uint8) {
        // Alternate starting player: odd handId -> Player 0, even handId -> Player 1
        return handId % 2 == 1 ? 0 : 1;
    }

    /// @notice Calculate the called amount - the minimum contribution between both players
    /// @dev This represents the amount that should transfer from loser to winner
    function _calculateCalledAmount(
        Game memory g
    ) private pure returns (uint256) {
        // The called amount is the minimum of what both players contributed
        // This ensures only the "called" portion changes hands
        return g.total[0] < g.total[1] ? g.total[0] : g.total[1];
    }

    function _initGame(
        Action calldata sb,
        Action calldata bb,
        uint256 stackA,
        uint256 stackB,
        uint256 minSmallBlind
    ) internal pure returns (Game memory g) {
        // TODO: allow game without blinds (e.g. sitout players)

        if (sb.prevHash != handGenesis(sb.channelId, sb.handId))
            revert SmallBlindPrevHashInvalid();
        if (sb.action != ACT_SMALL_BLIND) revert SmallBlindActionInvalid();
        if (sb.seq != 0) revert SmallBlindSequenceInvalid();

        if (bb.seq != 1) revert BigBlindSequenceInvalid();
        if (bb.prevHash != _hashAction(sb)) revert BigBlindPrevHashInvalid();
        if (bb.action != ACT_BIG_BLIND) revert BigBlindActionInvalid();
        if (bb.amount != sb.amount * 2) revert BigBlindAmountInvalid();

        uint8 smallBlindPlayer = getSmallBlindPlayer(sb.handId);
        uint8 bigBlindPlayer = 1 - smallBlindPlayer;

        if (smallBlindPlayer == 0) {
            if (
                sb.amount == 0 ||
                sb.amount < minSmallBlind ||
                sb.amount > stackA
            ) revert SmallBlindAmountInvalid();
            if (bb.amount > stackB) revert BigBlindStackInvalid();
        } else {
            if (
                sb.amount == 0 ||
                sb.amount < minSmallBlind ||
                sb.amount > stackB
            ) revert SmallBlindAmountInvalid();
            if (bb.amount > stackA) revert BigBlindStackInvalid();
        }

        // Initialize stacks/contrib/total based on who posted which blind
        if (smallBlindPlayer == 0) {
            g.stacks[0] = stackA - sb.amount;
            g.stacks[1] = stackB - bb.amount;
            g.contrib[0] = sb.amount;
            g.contrib[1] = bb.amount;
            g.total[0] = sb.amount;
            g.total[1] = bb.amount;
        } else {
            g.stacks[0] = stackA - bb.amount;
            g.stacks[1] = stackB - sb.amount;
            g.contrib[0] = bb.amount;
            g.contrib[1] = sb.amount;
            g.total[0] = bb.amount;
            g.total[1] = sb.amount;
        }

        if (g.stacks[0] == 0) g.allIn[0] = true;
        if (g.stacks[1] == 0) g.allIn[1] = true;

        g.actor = smallBlindPlayer; // SB acts first preflop
        g.bigBlindPlayer = bigBlindPlayer;
        g.bigBlindAmount = bb.amount;
        g.street = 0;
        g.toCall = bb.amount - sb.amount;
        g.lastRaise = bb.amount;
        g.checked = false;
        g.reopen = true;
        g.raiseCount = 1; // Big blind counts as first raise

        return g;
    }

    function _applyAction(
        Game memory g,
        Action calldata act,
        Action calldata prev
    ) internal pure returns (Game memory, ReplayResult memory) {
        if (act.seq <= prev.seq) revert SequenceInvalid();
        if (act.prevHash != _hashAction(prev)) revert PrevHashInvalid();
        if (act.action <= ACT_BIG_BLIND) revert BlindOnlyStart();

        uint256 p = g.actor;
        uint256 opp = 1 - p;

        // All-in handling
        if (g.allIn[p]) {
            if (g.allIn[opp]) {
                return (
                    g,
                    ReplayResult({ended: true, end: End.SHOWDOWN, folder: 0})
                );
            }
            if (act.action != ACT_CHECK_CALL || act.amount != 0)
                revert PlayerAllIn();
            return (
                g,
                ReplayResult({ended: true, end: End.SHOWDOWN, folder: 0})
            );
        }

        if (act.action == ACT_FOLD) {
            if (act.amount != 0) revert FoldAmountInvalid();
            return (
                g,
                ReplayResult({ended: true, end: End.FOLD, folder: uint8(p)})
            );
        }

        if (act.action == ACT_CHECK_CALL) {
            if (g.toCall > 0) {
                if (act.amount != 0) revert CallAmountInvalid();
                uint256 callAmt = g.toCall;
                if (g.stacks[p] < callAmt) {
                    callAmt = g.stacks[p];
                }
                g.total[p] += callAmt;

                g.stacks[p] -= callAmt;
                if (g.stacks[p] == 0) g.allIn[p] = true;
                g.toCall = 0;
                g.lastRaise = g.bigBlindAmount;
                g.checked = false;
                g.reopen = true;

                // cannot continue after CHECK when any of the players is all-in
                // if player1 was all-in and was called, he cannot raise any more
                // if player2 was all-in when calling, player1 cannot raise any more
                if (g.allIn[0] || g.allIn[1]) {
                    return (
                        g,
                        ReplayResult({
                            ended: true,
                            end: End.SHOWDOWN,
                            folder: 0
                        })
                    );
                }

                g.street++;
                if (g.street > 3) revert StreetOverflow();
                g.contrib[0] = 0;
                g.contrib[1] = 0;
                g.actor = g.bigBlindPlayer;
                g.raiseCount = 0;
                return (
                    g,
                    ReplayResult({ended: false, end: End.SHOWDOWN, folder: 0})
                );
            }

            // Check
            if (act.amount != 0) revert CheckAmountInvalid();
            if (g.checked) {
                g.street++;
                if (g.street == 4) {
                    // natural showdown
                    return (
                        g,
                        ReplayResult({
                            ended: true,
                            end: End.SHOWDOWN,
                            folder: 0
                        })
                    );
                }
                g.contrib[0] = 0;
                g.contrib[1] = 0;
                g.actor = g.bigBlindPlayer;
                g.checked = false;
                g.reopen = true;
                g.lastRaise = g.bigBlindAmount;
                g.raiseCount = 0;
            } else {
                g.checked = true;
                g.actor = uint8(opp);
            }
            return (
                g,
                ReplayResult({ended: false, end: End.SHOWDOWN, folder: 0})
            );
        }

        if (act.action == ACT_BET_RAISE) {
            if (act.amount == 0) revert RaiseAmountZero();

            uint256 prevStack = g.stacks[p];
            if (act.amount > prevStack) revert RaiseStackInvalid();

            if (g.raiseCount >= MAX_RAISES_PER_STREET)
                revert RaiseLimitExceeded();

            uint256 toCallBefore = g.toCall;
            uint256 minRaise = g.lastRaise;

            if (toCallBefore > 0) {
                if (act.amount <= toCallBefore)
                    revert RaiseInsufficientIncrease();

                uint256 raiseInc = act.amount - toCallBefore;

                if (raiseInc < minRaise) {
                    if (act.amount != prevStack) revert MinimumRaiseNotMet();
                    g.reopen = false;
                } else {
                    if (!g.reopen) revert NoReopenAllowed();
                    g.reopen = true;
                    g.lastRaise = raiseInc;
                }
            } else {
                if (act.amount < minRaise) {
                    if (act.amount != prevStack) revert MinimumRaiseNotMet();
                    g.reopen = false;
                } else {
                    g.reopen = true;
                    g.lastRaise = act.amount;
                }
            }

            g.contrib[p] += act.amount;
            g.total[p] += act.amount;

            g.stacks[p] = prevStack - act.amount;
            if (g.stacks[p] == 0) g.allIn[p] = true;

            uint256 newDiff = g.contrib[p] - g.contrib[opp];
            g.toCall = newDiff;
            g.checked = false;
            g.actor = uint8(opp);
            g.raiseCount++;

            return (
                g,
                ReplayResult({ended: false, end: End.SHOWDOWN, folder: 0})
            );
        }

        revert UnknownAction();
    }

    function _replayActions(
        Action[] calldata actions,
        uint256 stackA,
        uint256 stackB,
        uint256 minSmallBlind
    ) internal pure returns (ReplayResult memory res, Game memory g) {
        // Handle sequences without proper blinds
        if (actions.length < 2) {
            return (ReplayResult({ended: true, end: End.NO_BLINDS, folder: 0}), g);
        }

        Action calldata sb = actions[0];
        Action calldata bb = actions[1];

        // Check if we have valid blinds, otherwise treat as no blinds game
        if (sb.action != ACT_SMALL_BLIND || bb.action != ACT_BIG_BLIND) {
            return (ReplayResult({ended: true, end: End.NO_BLINDS, folder: 0}), g);
        }

        g = _initGame(sb, bb, stackA, stackB, minSmallBlind);

        // If both players are all-in after blinds, immediate showdown
        if (g.allIn[0] && g.allIn[1]) {
            return (
                ReplayResult({ended: true, end: End.SHOWDOWN, folder: 0}),
                g
            );
        }

        for (uint256 i = 2; i < actions.length; i++) {
            (g, res) = _applyAction(g, actions[i], actions[i - 1]);
            if (res.ended) {
                return (res, g);
            }
        }

        // Not ended by the sequence itself
        return (ReplayResult({ended: false, end: End.SHOWDOWN, folder: 0}), g);
    }

    function replayAndGetEndState(
        Action[] calldata actions,
        uint256 stackA,
        uint256 stackB,
        uint256 minSmallBlind
    ) external pure returns (End end, uint8 folder, uint256 calledAmount) {
        (ReplayResult memory res, Game memory g) = _replayActions(
            actions,
            stackA,
            stackB,
            minSmallBlind
        );

        // For NO_BLINDS games, called amount is always 0 and it's always ended
        if (res.end == End.NO_BLINDS) {
            return (res.end, res.folder, 0);
        }

        if (!res.ended) revert HandNotDone();

        calledAmount = _calculateCalledAmount(g);
        return (res.end, res.folder, calledAmount);
    }

    function replayPrefixAndGetEndState(
        Action[] calldata actions,
        uint256 stackA,
        uint256 stackB,
        uint256 minSmallBlind
    ) external pure returns (End end, uint8 folder, uint256 calledAmount) {
        (ReplayResult memory res, Game memory g) = _replayActions(
            actions,
            stackA,
            stackB,
            minSmallBlind
        );

        // For NO_BLINDS games, called amount is always 0
        if (res.end == End.NO_BLINDS) {
            return (res.end, res.folder, 0);
        }

        calledAmount = _calculateCalledAmount(g);

        // If already terminal by the sequence, return immediately
        if (res.ended) {
            return (res.end, res.folder, calledAmount);
        }

        // Apply finalization rules on non-terminal prefix
        if (g.toCall > 0) {
            return (End.FOLD, uint8(g.actor), calledAmount);
        }

        return (End.SHOWDOWN, 0, calledAmount);
    }

    function _hashAction(Action calldata act) private pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    ACTION_TYPEHASH,
                    act.channelId,
                    act.handId,
                    act.seq,
                    act.action,
                    act.amount,
                    act.prevHash
                )
            );
    }
}
