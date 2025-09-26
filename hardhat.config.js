require("@nomicfoundation/hardhat-toolbox");
require("@typechain/hardhat");
require("@typechain/ethers-v6");

module.exports = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: { enabled: true, runs: 200 },
            viaIR: true
        }
    },
    paths: {
        sources: "src"
    },
    typechain: {
        outDir: "typechain-types",
        target: "ethers-v6",
        alwaysGenerateOverloads: false,
        externalArtifacts: ["node_modules/@openzeppelin/contracts/build/contracts/*.json"]
    }
};
