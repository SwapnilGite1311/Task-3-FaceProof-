import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import '@nomicfoundation/hardhat-toolbox';
import type { HardhatUserConfig } from 'hardhat/config';

// Contracts share the monorepo root .env with the API so the deployed address
// and the address the API talks to can never drift apart.
const rootEnv = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

const PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY?.trim();
const AMOY_RPC_URL = process.env.POLYGON_RPC_URL?.trim() || 'https://rpc-amoy.polygon.technology';
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY?.trim() || '';

const accounts = PRIVATE_KEY && /^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY) ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Polygon Amoy follows Ethereum mainnet; cancun is supported there.
      evmVersion: 'paris',
    },
  },
  paths: {
    // FaceProof.sol lives at the root of this package rather than in a nested
    // contracts/ directory, so point Hardhat at the package root.
    sources: '.',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // A standalone `hardhat node` on 8545. Useful for running the full
    // FaceProof pipeline against a real EVM chain without needing testnet
    // funds - handy when public faucets are unavailable.
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: POLYGONSCAN_API_KEY,
    },
    customChains: [
      {
        network: 'polygonAmoy',
        chainId: 80002,
        urls: {
          apiURL: 'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
