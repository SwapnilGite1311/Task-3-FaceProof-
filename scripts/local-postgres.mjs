/**
 * Zero-install PostgreSQL for development.
 *
 *   npm run db:local
 *
 * Docker is the documented path (`npm run db:up`), but it is a heavyweight
 * install on Windows. This starts a real PostgreSQL server from the
 * `embedded-postgres` package instead — same wire protocol, same SQL, no Docker
 * and no system-wide installation. Data lives in .pgdata/ (gitignored).
 *
 * Leave this running in its own terminal; Ctrl+C shuts the server down cleanly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/**
 * Removes a `postmaster.pid` left behind by a server that was killed rather
 * than shut down — closing the terminal window does exactly this, and without
 * cleanup every later start fails with "lock file already exists".
 * The file is only removed once we have confirmed the PID inside it is dead.
 */
function clearStaleLock(dataDir) {
  const lockFile = path.join(dataDir, 'postmaster.pid');
  if (!fs.existsSync(lockFile)) return false;

  const pid = Number.parseInt(fs.readFileSync(lockFile, 'utf8').split('\n')[0] ?? '', 10);
  if (Number.isInteger(pid) && pid > 0) {
    try {
      // Signal 0 tests for existence without touching the process.
      process.kill(pid, 0);
      console.error('');
      console.error(`  A PostgreSQL server is already running in ${dataDir} (pid ${pid}).`);
      console.error('  Use that one, or stop it before starting another.');
      console.error('');
      process.exit(1);
    } catch {
      // ESRCH: the process is gone, so the lock is stale.
    }
  }

  fs.rmSync(lockFile, { force: true });
  return true;
}

const DB_NAME = 'faceproof';
const USER = 'faceproof';
const PASSWORD = 'faceproof';
const PORT = 5432;

let EmbeddedPostgres;
try {
  const mod = await import('embedded-postgres');
  EmbeddedPostgres = mod.default ?? mod;
} catch {
  console.error('\n  embedded-postgres is not installed.\n');
  console.error('  Install it with:\n');
  console.error('    npm install -D embedded-postgres\n');
  console.error('  Or use Docker instead:  npm run db:up\n');
  process.exit(1);
}

const dataDir = path.join(repoRoot, '.pgdata');

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  // initdb otherwise inherits the Windows system locale, which produces a
  // WIN1252 cluster that cannot store any non-Latin-1 character. Reverse-image
  // search returns real page titles and handles — emoji, accents, non-Latin
  // scripts — so the database must be UTF-8. `--locale=C` keeps collation
  // predictable and is what the Docker postgres image effectively gives us.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

console.log('');
console.log('  Starting a local PostgreSQL server');
console.log('  ──────────────────────────────────');
console.log(`  data directory   ${dataDir}`);
console.log(`  port             ${PORT}`);
console.log('');

const initialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

if (initialised) {
  console.log('  · reusing the existing cluster');
  if (clearStaleLock(dataDir)) {
    console.log('  · cleared a stale lock file from a previous run');
  }
} else {
  await pg.initialise();
  console.log('  · cluster initialised');
}

await pg.start();
console.log('  · server started');

try {
  await pg.createDatabase(DB_NAME);
  console.log(`  · database "${DB_NAME}" created`);
} catch {
  console.log(`  · database "${DB_NAME}" already exists`);
}

// A cluster created before the UTF-8 flags were added silently corrupts any
// non-Latin-1 text, so refuse to hand it over rather than failing later on a
// real page title.
const client = pg.getPgClient(DB_NAME);
await client.connect();
const { rows } = await client.query('SHOW server_encoding');
const encoding = rows[0]?.server_encoding;
await client.end();

if (encoding !== 'UTF8') {
  console.error('');
  console.error(`  This cluster uses ${encoding} encoding, not UTF8.`);
  console.error('  It cannot store emoji, accented characters or non-Latin scripts, all of');
  console.error('  which appear in real reverse-image-search results.');
  console.error('');
  console.error('  Fix (this deletes local test data only):');
  console.error('    1. stop this server');
  console.error(`    2. delete ${dataDir}`);
  console.error('    3. npm run db:local');
  console.error('    4. npm run prisma:migrate');
  console.error('');
  await pg.stop();
  process.exit(1);
}
console.log(`  · encoding ${encoding}`);

console.log('');
console.log('  Ready. DATABASE_URL already points here:');
console.log(`    postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}?schema=public`);
console.log('');
console.log('  Next, in a second terminal:  npm run prisma:migrate');
console.log('  Leave this terminal open. Ctrl+C stops the server.');
console.log('');

const shutdown = async (signal) => {
  console.log(`\n  ${signal} — stopping PostgreSQL …`);
  try {
    await pg.stop();
    console.log('  Stopped.\n');
  } catch (error) {
    console.error('  Failed to stop cleanly:', error?.message ?? error);
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Hold the process open.
setInterval(() => {}, 1 << 30);
