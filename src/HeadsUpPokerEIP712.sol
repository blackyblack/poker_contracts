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
            "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash)"
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
    // Storage for verified commits
    // ---------------------------------------------------------------------
    mapping(uint8 => bytes32) private verifiedCommits;

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
    // Commit verification functions
    // ---------------------------------------------------------------------
    
    /// @notice Verify co-signed commits ensuring one commit per slot with both signatures
    /// @param commits Array of card commits to verify (must include commits from both roles for each slot)
    /// @param sigs Array of signatures corresponding to commits (one signature per commit)
    /// @return slots Array of verified slots
    /// @return commitHashes Array of corresponding commit hashes
    function verifyCoSignedCommits(
        CardCommit[] calldata commits,
        bytes[] calldata sigs
    ) external returns (uint8[] memory slots, bytes32[] memory commitHashes) {
        require(sigs.length == commits.length, "INVALID_SIG_COUNT");
        require(commits.length % 2 == 0, "MUST_HAVE_PAIRS");
        
        uint256 numSlots = commits.length / 2;
        slots = new uint8[](numSlots);
        commitHashes = new bytes32[](numSlots);
        
        // Track commits by slot and role
        bool[256][2] memory tempSlotRoleUsed; // [role][slot]
        
        // First pass: validate all commits and signatures
        for (uint256 i = 0; i < commits.length; i++) {
            CardCommit calldata commit = commits[i];
            bytes calldata sig = sigs[i];
            
            require(commit.role <= 1, "INVALID_ROLE");
            require(!tempSlotRoleUsed[commit.role][commit.index], "DUPLICATE_ROLE_SLOT");
            
            // Verify signature
            address signer = digestCardCommit(commit).recover(sig);
            require(signer != address(0), "INVALID_SIGNER");
            
            tempSlotRoleUsed[commit.role][commit.index] = true;
        }
        
        // Second pass: ensure we have both roles for each slot and collect results
        uint256 slotIndex = 0;
        for (uint256 i = 0; i < commits.length; i += 2) {
            CardCommit calldata commit1 = commits[i];
            CardCommit calldata commit2 = commits[i + 1];
            
            // Ensure these commits are for the same slot but different roles
            require(commit1.index == commit2.index, "SLOT_MISMATCH");
            require(commit1.role != commit2.role, "SAME_ROLE");
            require((commit1.role == 0 && commit2.role == 1) || 
                    (commit1.role == 1 && commit2.role == 0), "INVALID_ROLE_PAIR");
            
            // Store verified commit (use role 0's commitHash as canonical)
            uint8 slot = commit1.index;
            bytes32 commitHash = commit1.role == 0 ? commit1.commitHash : commit2.commitHash;
            verifiedCommits[slot] = commitHash;
            
            slots[slotIndex] = slot;
            commitHashes[slotIndex] = commitHash;
            slotIndex++;
        }
    }
    
    /// @notice Check if opened cards match the committed hash for a slot
    /// @param slot The slot index to check
    /// @param code The cards being revealed (packed as bytes)
    /// @param salt The salt used in the original commitment
    /// @return True if the opened cards match the stored commitment
    function checkOpen(
        uint8 slot,
        bytes calldata code,
        bytes32 salt
    ) external view returns (bool) {
        bytes32 storedCommit = verifiedCommits[slot];
        require(storedCommit != bytes32(0), "NO_COMMIT");
        
        // Recompute commitment hash using the same pattern as in escrow
        bytes32 recomputedCommit = keccak256(abi.encodePacked(code, salt));
        
        return recomputedCommit == storedCommit;
    }

    // ---------------------------------------------------------------------
}
