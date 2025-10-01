import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: { enabled: true, runs: 200 },
            viaIR: true
        }
    },
    paths: {
        sources: "src",
        tests: "test",
    },
    typechain: {
        outDir: "typechain",
    },
    plugins: [hardhatToolboxMochaEthers],
};
