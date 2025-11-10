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
    
    /// @notice Full deck size representing all 52 cards in a standard deck
    /// @dev Used for card-ID resolution. The canonical deck contains 52 unencrypted
    /// base points that allow identification of card values from decrypted G1 points.
    uint8 constant FULL_DECK_SIZE = 52;

    // ---------------------------------------------------------------------
    // Typehashes
    // ---------------------------------------------------------------------
    bytes32 internal constant ACTION_TYPEHASH =
        keccak256(
            "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash,address sender)"
        );

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

    // ---------------------------------------------------------------------
    // Signature recovery
    // ---------------------------------------------------------------------
    function recoverActionSigner(
        Action calldata act,
        bytes calldata sig
    ) external view returns (address) {
        return digestAction(act).recover(sig);
    }
}
