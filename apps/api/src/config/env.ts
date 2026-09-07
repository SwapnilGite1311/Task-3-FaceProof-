import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Walks up from a starting directory looking for the monorepo root .env.
 * This keeps configuration in a single file regardless of whether the API is
 * started from source (`tsx src/server.ts`) or from `dist/`.
 */
function findEnvFiles(): string[] {
  const candidates: string[] = [];
  const roots = [process.cwd(), __dirname];

  for (const start of roots) {
    let dir = start;
    for (let depth = 0; depth < 8; depth += 1) {
      const envPath = path.join(dir, '.env');
      if (fs.existsSync(envPath) && !candidates.includes(envPath)) candidates.push(envPath);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates;
}

// dotenv does not override already-set variables, so the closest .env wins and
// the real process environment always wins over any file.
for (const file of findEnvFiles()) {
  dotenv.config({ path: file, quiet: true });
}

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean'
      ? value
      : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()),
  );

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const numeric = (fallback: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    });

export const REVERSE_SEARCH_PROVIDERS = [
  'serpapi_google_lens',
  'serpapi_google_reverse_image',
  'tineye',
] as const;

export type ReverseSearchProviderId = (typeof REVERSE_SEARCH_PROVIDERS)[number];

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: numeric(4000),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),

  DATABASE_URL: z.string().default(''),

  REVERSE_SEARCH_PROVIDER: z.enum(REVERSE_SEARCH_PROVIDERS).default('serpapi_google_lens'),
  REVERSE_SEARCH_API_KEY: optionalString,
  TINEYE_API_USERNAME: optionalString,
  TINEYE_API_PASSWORD: optionalString,
  REVERSE_SEARCH_TIMEOUT_MS: numeric(45_000),
  REVERSE_SEARCH_MAX_RESULTS: numeric(40),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_BUCKET: optionalString,
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_ENDPOINT: optionalString,
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_PUBLIC_BASE_URL: optionalString,
  STORAGE_SIGNED_URL_TTL_SECONDS: numeric(900),

  POLYGON_RPC_URL: z.string().default('https://rpc-amoy.polygon.technology'),
  BLOCKCHAIN_NETWORK: z.string().default('polygon-amoy'),
  BLOCKCHAIN_CHAIN_ID: numeric(80_002),
  BLOCKCHAIN_EXPLORER_URL: z.string().default('https://amoy.polygonscan.com'),
  BLOCKCHAIN_PRIVATE_KEY: optionalString,
  FACEPROOF_CONTRACT_ADDRESS: optionalString,
  BLOCKCHAIN_CONFIRMATIONS: numeric(1),
  BLOCKCHAIN_CONFIRMATION_TIMEOUT_MS: numeric(180_000),

  MATCH_CONFIDENCE_THRESHOLD: numeric(0.62),
  MATCH_MAX_CANDIDATES_ANALYSED: numeric(12),

  FACE_MODELS_DIR: z.string().default('./models'),
  FACE_MIN_CONFIDENCE: numeric(0.5),

  MAX_UPLOAD_SIZE_MB: numeric(10),
  RATE_LIMIT_MAX: numeric(60),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  SIGNING_SECRET: z.string().default(''),

  DEMO_MODE: booleanish.default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const raw = parsed.data;

/** Directory that holds face model weights, resolved against the api package. */
const apiRoot = path.resolve(__dirname, '..', '..');
const modelsDir = path.isAbsolute(raw.FACE_MODELS_DIR)
  ? raw.FACE_MODELS_DIR
  : path.resolve(apiRoot, raw.FACE_MODELS_DIR);

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const config = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  demoMode: raw.DEMO_MODE,

  apiRoot,
  tempDir: path.resolve(apiRoot, '.tmp'),
  uploadsDir: path.resolve(apiRoot, '.tmp', 'uploads'),

  server: {
    port: Math.trunc(raw.API_PORT),
    host: raw.API_HOST,
    corsOrigins: raw.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    publicBaseUrl: stripTrailingSlash(raw.PUBLIC_BASE_URL),
  },

  database: {
    url: raw.DATABASE_URL,
  },

  reverseSearch: {
    provider: raw.REVERSE_SEARCH_PROVIDER,
    apiKey: raw.REVERSE_SEARCH_API_KEY,
    tineyeUsername: raw.TINEYE_API_USERNAME,
    tineyePassword: raw.TINEYE_API_PASSWORD,
    timeoutMs: Math.trunc(raw.REVERSE_SEARCH_TIMEOUT_MS),
    maxResults: Math.trunc(raw.REVERSE_SEARCH_MAX_RESULTS),
  },

  storage: {
    provider: raw.STORAGE_PROVIDER,
    bucket: raw.STORAGE_BUCKET,
    region: raw.STORAGE_REGION,
    endpoint: raw.STORAGE_ENDPOINT,
    accessKey: raw.STORAGE_ACCESS_KEY,
    secretKey: raw.STORAGE_SECRET_KEY,
    publicBaseUrl: raw.STORAGE_PUBLIC_BASE_URL
      ? stripTrailingSlash(raw.STORAGE_PUBLIC_BASE_URL)
      : undefined,
    signedUrlTtlSeconds: Math.trunc(raw.STORAGE_SIGNED_URL_TTL_SECONDS),
  },

  blockchain: {
    rpcUrl: raw.POLYGON_RPC_URL,
    network: raw.BLOCKCHAIN_NETWORK,
    chainId: Math.trunc(raw.BLOCKCHAIN_CHAIN_ID),
    explorerUrl: stripTrailingSlash(raw.BLOCKCHAIN_EXPLORER_URL),
    privateKey: raw.BLOCKCHAIN_PRIVATE_KEY,
    contractAddress: raw.FACEPROOF_CONTRACT_ADDRESS,
    confirmations: Math.max(1, Math.trunc(raw.BLOCKCHAIN_CONFIRMATIONS)),
    confirmationTimeoutMs: Math.trunc(raw.BLOCKCHAIN_CONFIRMATION_TIMEOUT_MS),
  },

  matching: {
    confidenceThreshold: raw.MATCH_CONFIDENCE_THRESHOLD,
    maxCandidatesAnalysed: Math.trunc(raw.MATCH_MAX_CANDIDATES_ANALYSED),
  },

  face: {
    modelsDir,
    minConfidence: raw.FACE_MIN_CONFIDENCE,
  },

  upload: {
    maxSizeMb: raw.MAX_UPLOAD_SIZE_MB,
    maxBytes: Math.trunc(raw.MAX_UPLOAD_SIZE_MB * 1024 * 1024),
  },

  rateLimit: {
    max: Math.trunc(raw.RATE_LIMIT_MAX),
    window: raw.RATE_LIMIT_WINDOW,
  },

  signingSecret: raw.SIGNING_SECRET,
} as const;

export type AppConfig = typeof config;

export interface ConfigIssue {
  key: string;
  message: string;
  fatal: boolean;
}

const SECRET_HINT =
  "Generate one with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"";

/**
 * Reports configuration problems that would make a *real* verification fail.
 * The server refuses to start on fatal issues rather than producing records
 * that look real but are not.
 */
export function inspectConfiguration(): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (!config.database.url) {
    issues.push({
      key: 'DATABASE_URL',
      message: 'A PostgreSQL connection string is required.',
      fatal: true,
    });
  }

  if (!config.signingSecret || config.signingSecret.length < 32) {
    issues.push({
      key: 'SIGNING_SECRET',
      message: `Set a random secret of at least 32 characters. ${SECRET_HINT}`,
      fatal: config.isProduction,
    });
  }

  if (config.demoMode) {
    issues.push({
      key: 'DEMO_MODE',
      message:
        'Demo mode is ON. Reverse search and blockchain anchoring are stubbed, records are flagged demo and rejected by /verify. Set DEMO_MODE=false for real verifications.',
      fatal: config.isProduction,
    });
    return issues;
  }

  // -- Reverse image search ---------------------------------------------------
  if (config.reverseSearch.provider.startsWith('serpapi')) {
    if (!config.reverseSearch.apiKey) {
      issues.push({
        key: 'REVERSE_SEARCH_API_KEY',
        message: 'A SerpApi key is required for the selected reverse-search provider.',
        fatal: true,
      });
    }
    const needsPublicUrl =
      config.storage.provider === 'local' && isLoopbackBaseUrl(config.server.publicBaseUrl);
    if (needsPublicUrl) {
      issues.push({
        key: 'PUBLIC_BASE_URL',
        message:
          'SerpApi fetches the image by URL, so PUBLIC_BASE_URL must be reachable from the internet (use a tunnel such as cloudflared or ngrok) or STORAGE_PROVIDER must be set to s3.',
        fatal: true,
      });
    }
  }

  if (config.reverseSearch.provider === 'tineye') {
    if (!config.reverseSearch.tineyeUsername || !config.reverseSearch.tineyePassword) {
      issues.push({
        key: 'TINEYE_API_USERNAME',
        message: 'TinEye requires both TINEYE_API_USERNAME and TINEYE_API_PASSWORD.',
        fatal: true,
      });
    }
  }

  // -- Storage ----------------------------------------------------------------
  if (config.storage.provider === 's3') {
    if (!config.storage.bucket) {
      issues.push({ key: 'STORAGE_BUCKET', message: 'Required when STORAGE_PROVIDER=s3.', fatal: true });
    }
    if (!config.storage.accessKey) {
      issues.push({
        key: 'STORAGE_ACCESS_KEY',
        message: 'Required when STORAGE_PROVIDER=s3.',
        fatal: true,
      });
    }
    if (!config.storage.secretKey) {
      issues.push({
        key: 'STORAGE_SECRET_KEY',
        message: 'Required when STORAGE_PROVIDER=s3.',
        fatal: true,
      });
    }
  }

  // -- Blockchain -------------------------------------------------------------
  if (!config.blockchain.privateKey) {
    issues.push({
      key: 'BLOCKCHAIN_PRIVATE_KEY',
      message: 'A funded Polygon Amoy private key is required to anchor evidence.',
      fatal: true,
    });
  } else if (!/^0x[0-9a-fA-F]{64}$/.test(config.blockchain.privateKey)) {
    issues.push({
      key: 'BLOCKCHAIN_PRIVATE_KEY',
      message: 'Must be a 0x-prefixed 64 character hex string.',
      fatal: true,
    });
  }

  if (!config.blockchain.contractAddress) {
    issues.push({
      key: 'FACEPROOF_CONTRACT_ADDRESS',
      message:
        'Deploy contracts/FaceProof.sol first (npm run contracts:deploy) and paste the printed address here.',
      fatal: true,
    });
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(config.blockchain.contractAddress)) {
    issues.push({
      key: 'FACEPROOF_CONTRACT_ADDRESS',
      message: 'Must be a 0x-prefixed 40 character hex address.',
      fatal: true,
    });
  }

  return issues;
}

function isLoopbackBaseUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  } catch {
    return true;
  }
}

export function fatalConfigurationIssues(): ConfigIssue[] {
  return inspectConfiguration().filter((issue) => issue.fatal);
}
