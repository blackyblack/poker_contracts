// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Action} from "./HeadsUpPokerActions.sol";

/// @title HeadsUpPokerEIP712
/// @notice Helper contract for hashing and recovering EIP712 signed messages
contract HeadsUpPokerEIP712 is EIP712 {
    using ECDSA for bytes32;

    // ---------------------------------------------------------------------
    // Typehashes
    // ---------------------------------------------------------------------
    bytes32 private constant ACTION_TYPEHASH =
        keccak256(
            "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash)"
        );
    bytes32 private constant CARD_COMMIT_TYPEHASH =
        keccak256(
            "CardCommit(uint256 channelId,uint256 handId,uint32 seq,uint8 role,uint8 index,bytes32 dealRef,bytes32 commitHash,bytes32 prevHash)"
        );

    // ---------------------------------------------------------------------
    // Struct definitions
    // ---------------------------------------------------------------------
    struct CardCommit {
        uint256 channelId;
        uint256 handId;
        uint32 seq;
        uint8 role;
        uint8 index;
        bytes32 dealRef;
        bytes32 commitHash;
        bytes32 prevHash;
    }

    constructor() EIP712("HeadsUpPoker", "1") {}

    // ---------------------------------------------------------------------
    // Domain separator
    // ---------------------------------------------------------------------
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Digest helpers
    // ---------------------------------------------------------------------
    function digestAction(Action calldata act) public view returns (bytes32) {
        bytes32 structHash = keccak256(
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
        return _hashTypedDataV4(structHash);
    }

    function digestCardCommit(
        CardCommit calldata cc
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                CARD_COMMIT_TYPEHASH,
                cc.channelId,
                cc.handId,
                cc.seq,
                cc.role,
                cc.index,
                cc.dealRef,
                cc.commitHash,
                cc.prevHash
            )
        );
        return _hashTypedDataV4(structHash);
    }

    // ---------------------------------------------------------------------
    // Signature recovery
    // ---------------------------------------------------------------------
    function recoverActionSigner(
        Action calldata act,
        bytes calldata sig
    ) external view returns (address) {
        return digestAction(act).recover(sig);
    }

    function recoverCommitSigner(
        CardCommit calldata cc,
        bytes calldata sig
    ) external view returns (address) {
        return digestCardCommit(cc).recover(sig);
    }
}

