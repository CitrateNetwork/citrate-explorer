// Verification tool fixture project (EXP-S2): the hardhat-verify config that
// scripts/verify/capture-tool-fixtures.mjs runs. CAPTURE_URL is the recorder.
// Hardhat 2 loads its config as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("@nomicfoundation/hardhat-verify");
module.exports = {
  solidity: { version: "0.8.26", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: { citrate: { url: process.env.CAPTURE_RPC, chainId: 40204 } },
  etherscan: {
    apiKey: { citrate: "citrate" },
    customChains: [
      {
        network: "citrate",
        chainId: 40204,
        urls: { apiURL: `${process.env.CAPTURE_URL}/api`, browserURL: process.env.CAPTURE_URL },
      },
    ],
  },
  sourcify: { enabled: false },
};
