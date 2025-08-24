require("@nomicfoundation/hardhat-toolbox");

module.exports = {
    solidity: {
        compilers: [
            {
                version: "0.8.26",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
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
