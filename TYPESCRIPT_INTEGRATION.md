# TypeScript Integration Guide

This project now includes TypeScript wrappers for all smart contracts, generated using TypeChain.

## Setup

The TypeScript integration is already configured and ready to use. All necessary dependencies are installed.

## Generating TypeScript Wrappers

### Automatic Generation

TypeScript wrappers are automatically generated when you run:

```bash
npm run build
```

This command will:
1. Compile the Solidity contracts (`npm run compile`)
2. Generate TypeScript wrappers (`npm run typechain`)

### Manual Generation

To generate only the TypeScript wrappers:

```bash
npm run typechain
```

## Generated Files

The TypeScript wrappers are generated in the `typechain-types/` directory:

- `typechain-types/index.ts` - Main exports for all contracts
- `typechain-types/[ContractName].ts` - Type definitions for each contract
- `typechain-types/factories/` - Contract factory classes for deployment and connection
- `typechain-types/common.ts` - Common type definitions

## Usage Examples

### Connecting to a Contract

```typescript
import { ethers } from "ethers";
import { HeadsUpPokerEIP712, HeadsUpPokerEIP712__factory } from "./typechain-types";

// Connect to deployed contract
async function connectToContract(address: string, provider: ethers.Provider): Promise<HeadsUpPokerEIP712> {
    return HeadsUpPokerEIP712__factory.connect(address, provider);
}

// Deploy new contract
async function deployContract(signer: ethers.Signer): Promise<HeadsUpPokerEIP712> {
    const factory = new HeadsUpPokerEIP712__factory(signer);
    return factory.deploy();
}
```

### Using Contract Methods

```typescript
async function exampleUsage(contract: HeadsUpPokerEIP712) {
    // Get domain separator
    const domainSeparator = await contract.DOMAIN_SEPARATOR();
    console.log("Domain separator:", domainSeparator);
    
    // Create an action struct
    const action: ActionStruct = {
        channelId: 1n,
        handId: 1n,
        seq: 1,
        action: 1,
        amount: 100n,
        prevHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        sender: "0x742B8b7F3C64B83e863f6A9e8EC9C5c3e5B1234F"
    };
    
    // Get digest for the action
    const digest = await contract.digestAction(action);
    console.log("Action digest:", digest);
}
```

### Type Safety

The generated types provide full type safety for contract interactions:

```typescript
// This will give TypeScript errors if types don't match
const action: ActionStruct = {
    channelId: "invalid", // Error: should be BigNumberish
    handId: 1n,
    // ... missing required fields will also cause errors
};
```

## Integration with Tests

The existing test files can be gradually migrated to use TypeScript for better type safety:

```typescript
// In test files, you can now import and use the generated types
import { HeadsUpPokerEIP712 } from "../typechain-types";
import type { ActionStruct } from "../typechain-types/HeadsUpPokerEIP712";

// Test functions can use proper types
async function createTestAction(): Promise<ActionStruct> {
    return {
        channelId: 1n,
        handId: 1n,
        seq: 1,
        action: ACTION.CHECK_CALL,
        amount: 100n,
        prevHash: handGenesis(1n, 1n),
        sender: wallet1.address
    };
}
```

## Available Scripts

- `npm run compile` - Compile Solidity contracts
- `npm run typechain` - Generate TypeScript wrappers
- `npm run build` - Compile contracts and generate TypeScript wrappers
- `npm run build:ts` - Compile TypeScript files (if you have any .ts source files)

## Configuration

The TypeChain configuration is in `hardhat.config.js`:

```javascript
typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
    alwaysGenerateOverloads: false,
    externalArtifacts: ["node_modules/@openzeppelin/contracts/build/contracts/*.json"]
}
```

This configuration:
- Outputs types to `typechain-types/` directory
- Targets ethers v6
- Includes OpenZeppelin contract types when available