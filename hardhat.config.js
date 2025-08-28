require("@nomicfoundation/hardhat-toolbox");

module.exports = {
    solidity: {
        compilers: [
            {
                version: "0.8.24",
                settings: {
                    optimizer: { enabled: true, runs: 200 },
                    viaIR: true
                }
            }
        ]
    },
    paths: {
        sources: "src"
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true
        }
    }
};
