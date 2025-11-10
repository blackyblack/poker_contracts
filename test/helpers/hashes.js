import { ethers } from "ethers";

export const ZERO32 = "0x" + "00".repeat(32);

export const DOMAIN_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    )
);
export const ACTION_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
        "Action(uint256 channelId,uint256 handId,uint32 seq,uint8 action,uint128 amount,bytes32 prevHash,address sender)"
    )
);

export const GENESIS = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256"], ["HUP_GENESIS", 1n]));

export function handGenesis(channelId, handId) {
    return ethers.keccak256(
        ethers.solidityPacked(["string", "uint256", "uint256"], ["HUP_GENESIS", channelId, handId]));
}

export const NAME_HASH = ethers.keccak256(ethers.toUtf8Bytes("HeadsUpPoker"));
export const VERSION_HASH = ethers.keccak256(ethers.toUtf8Bytes("1"));

export function domainSeparator(contract, chainId) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    return ethers.keccak256(
        abi.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, contract]
        )
    );
}

export function actionHash(action) {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    return ethers.keccak256(
        abi.encode(
            ["bytes32", "uint256", "uint256", "uint32", "uint8", "uint128", "bytes32", "address"],
            [
                ACTION_TYPEHASH,
                action.channelId,
                action.handId,
                action.seq,
                action.action,
                action.amount,
                action.prevHash,
                action.sender
            ]
        )
    );
}

export function actionDigest(dom, action) {
    const structHash = actionHash(action);
    return ethers.keccak256(
        ethers.concat([
            ethers.toUtf8Bytes("\x19\x01"),
            ethers.getBytes(dom),
            ethers.getBytes(structHash)
        ])
    );
}
