// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {Action} from "./HeadsUpPokerActions.sol";
import {HeadsUpPokerEIP712} from "./HeadsUpPokerEIP712.sol";
import "./HeadsUpPokerErrors.sol";

/// @title HeadsUpPokerActionVerifier
/// @notice Stateless helper that validates action signatures bound to the escrow EIP712 domain.
contract HeadsUpPokerActionVerifier is HeadsUpPokerEIP712 {
    using ECDSA for bytes32;

    /// @notice Verifies that each action in `actions` is signed by an authorized signer.
    /// @param actions Array of actions to verify.
    /// @param signatures Corresponding signatures for each action.
    /// @param channelId Expected channel identifier for the actions.
    /// @param handId Expected hand identifier for the actions.
    /// @param player1 Address of the first player.
    /// @param player2 Address of the second player.
    /// @param player1Signer Optional delegate signer for player1.
    /// @param player2Signer Optional delegate signer for player2.
    /// @param domainSeparator EIP712 domain separator of the escrow contract.
    function verifyActions(
        Action[] calldata actions,
        bytes[] calldata signatures,
        uint256 channelId,
        uint256 handId,
        address player1,
        address player2,
        address player1Signer,
        address player2Signer,
        bytes32 domainSeparator
    ) external pure {
        if (actions.length != signatures.length) revert ActionSignatureLengthMismatch();

        for (uint256 i = 0; i < actions.length; i++) {
            Action calldata action = actions[i];
            address sender = action.sender;

            if (action.channelId != channelId) revert ActionWrongChannel();
            if (action.handId != handId) revert ActionWrongHand();

            bool validSender;
            if (sender == player1 || sender == player2) {
                validSender = true;
            } else if (player1Signer != address(0) && sender == player1Signer) {
                validSender = true;
            } else if (player2Signer != address(0) && sender == player2Signer) {
                validSender = true;
            }
            if (!validSender) revert ActionInvalidSender();

            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    domainSeparator,
                    hashAction(action)
                )
            );

            address actualSigner = digest.recover(signatures[i]);
            if (
                !_isAuthorizedSigner(
                    sender,
                    actualSigner,
                    player1,
                    player2,
                    player1Signer,
                    player2Signer
                )
            ) revert ActionWrongSigner();
        }
    }

    function _isAuthorizedSigner(
        address player,
        address signer,
        address player1,
        address player2,
        address player1Signer,
        address player2Signer
    ) private pure returns (bool) {
        if (player == player1) {
            return signer == player1 || (player1Signer != address(0) && signer == player1Signer);
        }
        if (player == player2) {
            return signer == player2 || (player2Signer != address(0) && signer == player2Signer);
        }

        return false;
    }
}
