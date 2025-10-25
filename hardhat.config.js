import "@nomicfoundation/hardhat-toolbox";

export default {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: { enabled: true, runs: 1 },
            viaIR: true,
            evmVersion: "paris"
        }
    },
    gasReporter: {
        enabled: false,
    },
    paths: {
        sources: "src",
        tests: "test",
    },
    typechain: {
        outDir: "typechain",
    },
};
