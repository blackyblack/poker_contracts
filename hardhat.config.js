require("@nomicfoundation/hardhat-toolbox");

// The built-in compiler (auto-downloaded if not yet present) can be overridden by setting SOLC
// If set, we assume it's a native compiler which matches the required Solidity version.
/*subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(
    async (args, _hre, runSuper) => {
        console.log("subtask TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD");
        if (process.env.SOLC !== undefined) {
            const versionOutput = execSync(`${process.env.SOLC} --version`, { encoding: 'utf8' }).trim();
            const longVersion = versionOutput.match(/Version: (.+)/)?.[1] || `${args.solcVersion}+commit.unknown.Linux.g++`;
            console.log(
                "Using Solidity compiler set in SOLC:",
                process.env.SOLC,
                ", longVersion:",
                longVersion
            );
            return {
                compilerPath: process.env.SOLC,
                isSolcJs: true, // false for native compiler
                version: args.solcVersion,
                longVersion,
            };
        } else {
            // fall back to the default
            return runSuper();
        }
    }
);*/

module.exports = {
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
};
