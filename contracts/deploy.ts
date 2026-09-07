/**
 * Deploys FaceProof.sol and prints the exact .env line the API needs.
 *
 *   npm run contracts:deploy          # Polygon Amoy testnet
 *   npm run deploy:local -w @faceproof/contracts
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers, network } from 'hardhat';

const EXPLORERS: Record<string, string> = {
  amoy: 'https://amoy.polygonscan.com',
};

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();

  if (!deployer) {
    throw new Error(
      'No signer available. Set BLOCKCHAIN_PRIVATE_KEY in the repo root .env to a funded Polygon Amoy account.',
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  const chain = await ethers.provider.getNetwork();

  console.log('');
  console.log('  FaceProof contract deployment');
  console.log('  ─────────────────────────────');
  console.log(`  network    ${network.name} (chainId ${chain.chainId})`);
  console.log(`  deployer   ${deployer.address}`);
  console.log(`  balance    ${ethers.formatEther(balance)} POL`);
  console.log('');

  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} has a zero balance. Fund it from https://faucet.polygon.technology (select Polygon Amoy) and retry.`,
    );
  }

  const factory = await ethers.getContractFactory('FaceProof');
  const contract = await factory.deploy();

  console.log(`  submitting deployment transaction …`);
  const deploymentTx = contract.deploymentTransaction();
  if (deploymentTx) console.log(`  tx         ${deploymentTx.hash}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = deploymentTx ? await deploymentTx.wait() : null;

  const explorer = EXPLORERS[network.name];

  console.log('');
  console.log('  ✓ deployed');
  console.log(`  address    ${address}`);
  if (receipt) {
    console.log(`  block      ${receipt.blockNumber}`);
    console.log(`  gas used   ${receipt.gasUsed.toString()}`);
  }
  if (explorer) {
    console.log(`  explorer   ${explorer}/address/${address}`);
  }

  // Persist a deployment record so the address is not lost in scrollback.
  const outDir = path.resolve(__dirname, 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const record = {
    network: network.name,
    chainId: Number(chain.chainId),
    address,
    deployer: deployer.address,
    transactionHash: deploymentTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    deployedAt: new Date().toISOString(),
  };
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`  Deployment record written to contracts/deployments/${network.name}.json`);
  console.log('');
  console.log('  Add this line to your repo root .env:');
  console.log('');
  console.log(`    FACEPROOF_CONTRACT_ADDRESS=${address}`);
  console.log('');
}

main().catch((error: unknown) => {
  console.error('\n  Deployment failed:\n');
  console.error(error);
  process.exitCode = 1;
});
