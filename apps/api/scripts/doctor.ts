/**
 * Preflight check. Run this before a demo:
 *
 *   npm run doctor -w @faceproof/api
 *
 * It reports on every external dependency the real pipeline needs, and exits
 * non-zero if any of them would make a verification fail.
 */
import { config, inspectConfiguration } from '../src/config/env';
import { prisma } from '../src/config/database';
import { missingModelFiles } from '../src/modules/face/models';
import { getReverseSearchProvider } from '../src/modules/reverse-search';
import { getBlockchainService } from '../src/modules/blockchain';
import { errorMessage } from '../src/utils/errors';

const PASS = '  [32m✓[0m';
const FAIL = '  [31m✗[0m';
const WARN = '  [33m![0m';

let failures = 0;

function pass(label: string, detail = ''): void {
  console.log(`${PASS} ${label}${detail ? `  [2m${detail}[0m` : ''}`);
}
function fail(label: string, detail: string): void {
  failures += 1;
  console.log(`${FAIL} ${label}`);
  console.log(`      [2m${detail}[0m`);
}
function warn(label: string, detail: string): void {
  console.log(`${WARN} ${label}`);
  console.log(`      [2m${detail}[0m`);
}

async function main(): Promise<void> {
  console.log('');
  console.log('  FaceProof preflight');
  console.log('  ═══════════════════');
  console.log('');

  // ── Configuration ──────────────────────────────────────────────────────────
  console.log('  Configuration');
  const issues = inspectConfiguration();
  if (issues.length === 0) {
    pass('All required environment variables are set');
  }
  for (const issue of issues) {
    if (issue.fatal) fail(issue.key, issue.message);
    else warn(issue.key, issue.message);
  }
  if (config.demoMode) {
    warn('DEMO_MODE', 'Demo mode is on: no real search and no real transaction will happen.');
  }
  console.log('');

  // ── Database ───────────────────────────────────────────────────────────────
  console.log('  Database');
  try {
    await prisma.$queryRaw`SELECT 1`;
    const count = await prisma.verification.count();
    pass('PostgreSQL reachable', `${count} verification(s) stored`);
  } catch (error) {
    const message = errorMessage(error);
    if (/does not exist|relation .* does not exist|P2021/i.test(message)) {
      fail('Schema not applied', 'Run: npm run prisma:migrate');
    } else {
      fail('PostgreSQL unreachable', `${message}\n      Start it with: npm run db:up`);
    }
  }
  console.log('');

  // ── Face models ────────────────────────────────────────────────────────────
  console.log('  Face models');
  const missing = missingModelFiles();
  if (missing.length === 0) {
    pass('All model weights present', config.face.modelsDir);
  } else {
    fail(`${missing.length} model file(s) missing`, `Run: npm run models:fetch\n      ${missing.join(', ')}`);
  }
  console.log('');

  // ── Reverse image search ───────────────────────────────────────────────────
  console.log('  Reverse image search');
  try {
    const provider = getReverseSearchProvider();
    provider.assertConfigured();
    pass(provider.label, `receives the image by ${provider.queryMode.replace('_', ' ')}`);
    if (provider.queryMode === 'image_url') {
      console.log(
        `      [2mThe provider will fetch: ${config.server.publicBaseUrl}/api/v1/temp/…[0m`,
      );
      console.log('      [2mThat URL must be reachable from the public internet.[0m');
    }
  } catch (error) {
    fail('Not configured', errorMessage(error));
  }
  console.log('');

  // ── Blockchain ─────────────────────────────────────────────────────────────
  console.log('  Blockchain');
  try {
    const status = await getBlockchainService().status();
    pass('RPC reachable', `${status.networkName} (chain ${status.chainId})`);

    if (status.contractDeployed) {
      pass('Contract found at address', status.contractAddress);
    } else {
      fail(
        'No contract at FACEPROOF_CONTRACT_ADDRESS',
        `Nothing is deployed at ${status.contractAddress} on this network. Run: npm run contracts:deploy`,
      );
    }

    const balance = Number(status.balanceWei) / 1e18;
    if (balance === 0) {
      fail(
        'Signing wallet has no POL',
        `Fund ${status.address} at https://faucet.polygon.technology (select Polygon Amoy).`,
      );
    } else if (balance < 0.02) {
      warn(
        'Signing wallet is nearly empty',
        `${status.address} holds ${balance} POL — enough for only a few transactions.`,
      );
    } else {
      pass('Signing wallet funded', `${status.address} · ${balance} POL`);
    }
  } catch (error) {
    fail('Blockchain unavailable', errorMessage(error));
  }
  console.log('');

  // ── Verdict ────────────────────────────────────────────────────────────────
  if (failures === 0) {
    console.log('  [32mReady.[0m Start the stack with: npm run dev');
  } else {
    console.log(
      `  [31m${failures} problem(s) would make a real verification fail.[0m Fix them and run this again.`,
    );
    process.exitCode = 1;
  }
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error('\n  Preflight crashed:\n');
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
