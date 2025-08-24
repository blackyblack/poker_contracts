// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Action} from "./HeadsUpPokerActions.sol";

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

    // ---------------------------------------------------------------------
    // Commit verification / opening
    // ---------------------------------------------------------------------

    /// @dev mapping of compact slot => commit hash
    mapping(uint256 => bytes32) private _commitBySlot;

    /// @notice Verify a batch of co-signed card commitments
    /// @dev Expects two signatures per commit. Signers must remain
    /// consistent across the entire batch. Each slot (role/index pair)
    /// may only appear once. Returns a compact array mapping slot to
    /// commit hash where the array index represents the slot.
    function verifyCoSignedCommits(
        CardCommit[] calldata commits,
        bytes[] calldata sigs
    ) external returns (bytes32[] memory) {
        require(commits.length * 2 == sigs.length, "SIG_COUNT");

        uint256 bitmapLo;
        uint256 bitmapHi;
        uint256 maxSlot;
        address signerA;
        address signerB;

        for (uint256 i = 0; i < commits.length; i++) {
            CardCommit calldata cc = commits[i];
            uint256 slot = (uint256(cc.role) << 8) | uint256(cc.index);

            // ensure unique slot
            if (slot < 256) {
                uint256 mask = 1 << slot;
                require(bitmapLo & mask == 0, "DUP_SLOT");
                bitmapLo |= mask;
            } else {
                uint256 mask = 1 << (slot - 256);
                require(bitmapHi & mask == 0, "DUP_SLOT");
                bitmapHi |= mask;
            }

            bytes32 digest = digestCardCommit(cc);
            address a = digest.recover(sigs[2 * i]);
            address b = digest.recover(sigs[2 * i + 1]);
            require(a != address(0) && b != address(0) && a != b, "BAD_SIG");

            if (i == 0) {
                signerA = a;
                signerB = b;
            } else {
                require(
                    (a == signerA && b == signerB) ||
                        (a == signerB && b == signerA),
                    "SIG_MISMATCH"
                );
            }

            _commitBySlot[slot] = cc.commitHash;
            if (slot > maxSlot) maxSlot = slot;
        }

        bytes32[] memory map = new bytes32[](maxSlot + 1);
        for (uint256 i = 0; i < commits.length; i++) {
            uint256 slot = (uint256(commits[i].role) << 8) |
                uint256(commits[i].index);
            map[slot] = commits[i].commitHash;
        }
        return map;
    }

    /// @notice Verify an opening against previously stored commitment
    /// @param slot compact role/index slot identifier
    /// @param code revealed code being opened
    /// @param salt salt used in original commitment
    function checkOpen(
        uint256 slot,
        bytes calldata code,
        bytes32 salt
    ) external view {
        bytes32 expected = _commitBySlot[slot];
        require(expected != bytes32(0), "NO_COMMIT");
        bytes32 actual = keccak256(abi.encodePacked(code, salt));
        require(actual == expected, "BAD_OPEN");
    }

    // ---------------------------------------------------------------------
}
