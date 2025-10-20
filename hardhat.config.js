import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { ProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.HTTP_PROXY) {
    console.log("Using proxy for HTTP requests: " + process.env.HTTP_PROXY);
    const proxyAgent = new ProxyAgent(process.env.HTTP_PROXY);
    setGlobalDispatcher(proxyAgent);
}

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
