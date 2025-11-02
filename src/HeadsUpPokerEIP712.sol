// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Action} from "./HeadsUpPokerActions.sol";

/// @title HeadsUpPokerEIP712
/// @notice Helper contract for hashing and recovering EIP712 signed messages
contract HeadsUpPokerEIP712 is EIP712 {
    using ECDSA for bytes32;

    // possible values for slot
    uint8 constant SLOT_A1 = 0;
    uint8 constant SLOT_A2 = 1;
    uint8 constant SLOT_B1 = 2;
    uint8 constant SLOT_B2 = 3;
    uint8 constant SLOT_FLOP1 = 4;
    uint8 constant SLOT_FLOP2 = 5;
    uint8 constant SLOT_FLOP3 = 6;
    uint8 constant SLOT_TURN = 7;
    uint8 constant SLOT_RIVER = 8;
    
    // Full deck size (52 cards)
    uint8 constant FULL_DECK_SIZE = 52;

    // ---------------------------------------------------------------------
    // Typehashes
    // ---------------------------------------------------------------------
    bytes32 internal constant ACTION_TYPEHASH =
        keccak256(
            "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash,address sender)"
        );
    bytes32 internal constant CARD_COMMIT_TYPEHASH =
        keccak256(
            "CardCommit(uint256 channelId,uint256 handId,uint8 slot,bytes32 commitHash,bytes32 prevHash)"
        );
    bytes32 internal constant DECRYPTED_CARD_TYPEHASH =
        keccak256(
            "DecryptedCard(uint256 channelId,uint256 handId,address player,uint8 index,bytes decryptedCard)"
        );

    // ---------------------------------------------------------------------
    // Struct definitions
    // ---------------------------------------------------------------------
    struct CardCommit {
        uint256 channelId;
        uint256 handId;
        // i.e. SLOT_A1, SLOT_A2, SLOT_B1, SLOT_B2, SLOT_FLOP1, SLOT_FLOP2, SLOT_FLOP3, SLOT_TURN, SLOT_RIVER
        uint8 slot;
        // i.e. keccak256( slot || cardCode || salt )
        bytes32 commitHash;
        bytes32 prevHash;
    }

    struct DecryptedCard {
        uint256 channelId;
        uint256 handId;
        address player; // address of the player decrypting the card
        uint8 index;
        bytes decryptedCard; // G1 partial decrypt point (64 bytes)
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
                act.prevHash,
                act.sender
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
                cc.slot,
                cc.commitHash,
                cc.prevHash
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function digestDecryptedCard(DecryptedCard calldata dr) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                DECRYPTED_CARD_TYPEHASH,
                dr.channelId,
                dr.handId,
                dr.player,
                dr.index,
                keccak256(dr.decryptedCard)
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

    function recoverDecryptedCardSigner(
        DecryptedCard calldata dr,
        bytes calldata sig
    ) external view returns (address) {
        return digestDecryptedCard(dr).recover(sig);
    }
}
