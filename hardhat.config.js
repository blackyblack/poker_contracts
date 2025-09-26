// Basic Hardhat v3 configuration
export default {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: { enabled: true, runs: 200 },
            viaIR: true
        }
    },
    paths: {
        sources: "src"
    }
};
