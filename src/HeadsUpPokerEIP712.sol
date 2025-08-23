// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    // ---------------------------------------------------------------------
    // Typehashes
    // ---------------------------------------------------------------------
    bytes32 private constant EIP712DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,uint256 channelId)"
        );
    bytes32 private constant ACTION_TYPEHASH =
        keccak256(
            "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 street,uint8 action,uint128 amount,bytes32 prevHash)"
        );
    bytes32 private constant CARD_COMMIT_TYPEHASH =
        keccak256(
            "CardCommit(uint256 channelId,uint256 handId,uint32 seq,uint8 role,uint8 index,bytes32 dealRef,bytes32 commitHash,bytes32 prevHash)"
        );
    bytes32 private constant NAME_HASH = keccak256(bytes("HeadsUpPoker"));
    bytes32 private constant VERSION_HASH = keccak256(bytes("1"));

    // ---------------------------------------------------------------------
    // Struct definitions
    // ---------------------------------------------------------------------
    struct Action {
        uint256 channelId;
        uint256 handId;
        uint32 seq;
        uint8 street;
        uint8 action;
        uint128 amount;
        bytes32 prevHash;
    }

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

    // ---------------------------------------------------------------------
    // Domain separator
    // ---------------------------------------------------------------------
    function DOMAIN_SEPARATOR(uint256 channelId) public view returns (bytes32) {
        return _domainSeparator(channelId);
    }

    function _domainSeparator(
        uint256 channelId
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    EIP712DOMAIN_TYPEHASH,
                    NAME_HASH,
                    VERSION_HASH,
                    block.chainid,
                    address(this),
                    channelId
                )
            );
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
                act.street,
                act.action,
                act.amount,
                act.prevHash
            )
        );
        return
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    _domainSeparator(act.channelId),
                    structHash
                )
            );
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
        return
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    _domainSeparator(cc.channelId),
                    structHash
                )
            );
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
