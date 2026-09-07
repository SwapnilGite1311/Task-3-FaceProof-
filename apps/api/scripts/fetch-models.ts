/**
 * Puts the face model weights in place.
 *
 * Preferred path: copy them out of the installed `@vladmandic/face-api`
 * package, which ships the weights it was built against — no network needed and
 * no version skew. Fallback: download the same files from the jsDelivr CDN copy
 * of that exact package version.
 *
 *   npm run models:fetch
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config/env';
import { REQUIRED_MODEL_FILES } from '../src/modules/face/models';

const packageJsonPath = require.resolve('@vladmandic/face-api/package.json');
const packageRoot = path.dirname(packageJsonPath);
const packageVersion = (JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string })
  .version;
const bundledModelDir = path.join(packageRoot, 'model');

const CDN_BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${packageVersion}/model`;

async function copyFromPackage(file: string, destination: string): Promise<boolean> {
  const source = path.join(bundledModelDir, file);
  if (!fs.existsSync(source)) return false;
  await fsp.copyFile(source, destination);
  return true;
}

async function downloadFromCdn(file: string, destination: string): Promise<void> {
  const url = `${CDN_BASE}/${file}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (HTTP ${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error(`Downloaded ${url} but the file was empty.`);
  await fsp.writeFile(destination, buffer);
}

async function main(): Promise<void> {
  await fsp.mkdir(config.face.modelsDir, { recursive: true });

  console.log('');
  console.log('  FaceProof model weights');
  console.log('  ───────────────────────');
  console.log(`  target      ${config.face.modelsDir}`);
  console.log(`  face-api    ${packageVersion}`);
  console.log('');

  let copied = 0;
  let downloaded = 0;
  let skipped = 0;

  for (const file of REQUIRED_MODEL_FILES) {
    const destination = path.join(config.face.modelsDir, file);

    if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
      console.log(`  · ${file} (already present)`);
      skipped += 1;
      continue;
    }

    if (await copyFromPackage(file, destination)) {
      console.log(`  ✓ ${file} (copied from node_modules)`);
      copied += 1;
      continue;
    }

    process.stdout.write(`  ↓ ${file} (downloading) …`);
    await downloadFromCdn(file, destination);
    process.stdout.write('\r');
    console.log(`  ✓ ${file} (downloaded)            `);
    downloaded += 1;
  }

  const totalBytes = REQUIRED_MODEL_FILES.reduce(
    (sum, file) => sum + fs.statSync(path.join(config.face.modelsDir, file)).size,
    0,
  );

  console.log('');
  console.log(
    `  Done — ${copied} copied, ${downloaded} downloaded, ${skipped} already present (${(totalBytes / 1024 / 1024).toFixed(1)} MB total).`,
  );
  console.log('');
}

main().catch((error: unknown) => {
  console.error('\n  Model download failed:\n');
  console.error(error);
  process.exitCode = 1;
});
