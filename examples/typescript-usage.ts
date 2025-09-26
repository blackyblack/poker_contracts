import { ethers } from "ethers";
import { 
    HeadsUpPokerEIP712, 
    HeadsUpPokerEIP712__factory
} from "../typechain-types";
import type { ActionStruct } from "../typechain-types/HeadsUpPokerEIP712";

/**
 * Example script demonstrating TypeScript integration with Poker Contracts
 */

// Example: Connect to an existing contract
async function connectToPokerContract(
    contractAddress: string, 
    provider: ethers.Provider
): Promise<HeadsUpPokerEIP712> {
    return HeadsUpPokerEIP712__factory.connect(contractAddress, provider);
}

// Example: Deploy a new contract
async function deployPokerContract(signer: ethers.Signer): Promise<HeadsUpPokerEIP712> {
    const factory = new HeadsUpPokerEIP712__factory(signer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    return contract;
}

// Example: Use the contract with type safety
async function demonstrateContractUsage(contract: HeadsUpPokerEIP712) {
    console.log("=== HeadsUpPokerEIP712 Contract Demo ===");
    
    // Get the domain separator
    const domainSeparator = await contract.DOMAIN_SEPARATOR();
    console.log("Domain Separator:", domainSeparator);
    
    // Create a properly typed action
    const action: ActionStruct = {
        channelId: BigInt(1),
        handId: BigInt(1),
        seq: 1,
        action: 1, // CHECK_CALL
        amount: BigInt(100),
        prevHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        sender: "0x742B8b7F3C64B83e863f6A9e8EC9C5c3e5B1234F"
    };
    
    // Get the digest for this action
    const digest = await contract.digestAction(action);
    console.log("Action Digest:", digest);
    
    // Example of a card commit
    const cardCommit = {
        channelId: BigInt(1),
        handId: BigInt(1),
        slot: 0, // SLOT_A1
        commitHash: ethers.keccak256(ethers.toUtf8Bytes("test-commit")),
        prevHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
    };
    
    const commitDigest = await contract.digestCardCommit(cardCommit);
    console.log("Card Commit Digest:", commitDigest);
}

// Example usage with error handling and type safety
async function main() {
    try {
        // This would normally be your provider and signer
        // const provider = new ethers.JsonRpcProvider("http://localhost:8545");
        // const signer = new ethers.Wallet("private-key", provider);
        
        console.log("TypeScript integration example for Poker Contracts");
        console.log("This demonstrates type-safe contract interactions");
        
        // In a real scenario, you would:
        // 1. Deploy or connect to the contract
        // const contract = await deployPokerContract(signer);
        // 2. Use the contract with full type safety
        // await demonstrateContractUsage(contract);
        
    } catch (error) {
        console.error("Error:", error);
    }
}

// Type-safe helper functions
export function createAction(
    channelId: bigint,
    handId: bigint,
    seq: number,
    action: number,
    amount: bigint,
    prevHash: string,
    sender: string
): ActionStruct {
    return {
        channelId,
        handId,
        seq,
        action,
        amount,
        prevHash,
        sender
    };
}

export function createCardCommit(
    channelId: bigint,
    handId: bigint,
    slot: number,
    commitHash: string,
    prevHash: string
) {
    return {
        channelId,
        handId,
        slot,
        commitHash,
        prevHash
    };
}

// Export the main functions for use in other modules
export { 
    connectToPokerContract, 
    deployPokerContract, 
    demonstrateContractUsage 
};

if (require.main === module) {
    main();
}