import Fastify, { type FastifyInstance } from 'fastify';
import {
  PIPELINE_VERSION,
  PIPELINE_STAGES,
  ACCEPTED_IMAGE_MIME_TYPES,
} from '@faceproof/shared';
import { config, fatalConfigurationIssues, inspectConfiguration } from './config/env';
import { connectDatabase, disconnectDatabase, prisma } from './config/database';
import { registerErrorHandler } from './middleware/error-handler';
import { registerSecurity } from './middleware/security';
import { getBlockchainService } from './modules/blockchain';
import { getActiveBackend, missingModelFiles, sweepEmbeddings, warmUpFaceModels } from './modules/face';
import { getReverseSearchProvider } from './modules/reverse-search';
import { sweepPublicTempFiles } from './modules/storage';
import { verificationRoutes } from './modules/verification';
import { errorMessage } from './utils/errors';
import { logger } from './utils/logger';
import { closeSafeAgent } from './utils/safe-fetch';
import { ensureRuntimeDirectories, sweepTempFiles } from './utils/tempfile';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: config.upload.maxBytes + 1024 * 1024,
    routerOptions: {
      // A verification id is a cuid; nothing legitimate needs a long URL here.
      maxParamLength: 128,
    },
  });

  await registerSecurity(app);
  registerErrorHandler(app);

  app.addHook('onResponse', async (request, reply) => {
    if (request.url.endsWith('/events')) return;
    logger.debug(
      {
        method: request.method,
        url: request.url,
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });

  // ── Meta ──────────────────────────────────────────────────────────────────
  app.get('/api/v1/health', async () => {
    const issues = inspectConfiguration();
    const models = missingModelFiles();

    let blockchain: Record<string, unknown>;
    try {
      blockchain = { ...(await getBlockchainService().status()), reachable: true };
    } catch (error) {
      blockchain = { reachable: false, error: errorMessage(error) };
    }

    let reverseSearch: Record<string, unknown>;
    try {
      const provider = getReverseSearchProvider();
      provider.assertConfigured();
      reverseSearch = { provider: provider.label, queryMode: provider.queryMode, configured: true };
    } catch (error) {
      reverseSearch = {
        provider: config.reverseSearch.provider,
        configured: false,
        error: errorMessage(error),
      };
    }

    const ready =
      issues.every((issue) => !issue.fatal) &&
      models.length === 0 &&
      blockchain.reachable === true &&
      reverseSearch.configured === true;

    return {
      status: ready ? 'ready' : 'degraded',
      demoMode: config.demoMode,
      pipelineVersion: PIPELINE_VERSION,
      face: {
        backend: getActiveBackend(),
        modelsDir: config.face.modelsDir,
        missingModels: models,
      },
      reverseSearch,
      blockchain,
      storage: { provider: config.storage.provider },
      configuration: issues.map((issue) => ({
        key: issue.key,
        message: issue.message,
        fatal: issue.fatal,
      })),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  app.get('/api/v1/meta', async () => ({
    pipelineVersion: PIPELINE_VERSION,
    stages: PIPELINE_STAGES,
    acceptedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
    maxUploadBytes: config.upload.maxBytes,
    maxUploadMb: config.upload.maxSizeMb,
    demoMode: config.demoMode,
    matchThreshold: config.matching.confidenceThreshold,
    blockchain: {
      network: config.blockchain.network,
      chainId: config.blockchain.chainId,
      explorerUrl: config.blockchain.explorerUrl,
      contractAddress: config.blockchain.contractAddress ?? null,
    },
  }));

  await app.register(verificationRoutes, { prefix: '/api/v1' });

  return app;
}

/** Periodic housekeeping: expired temp files and released embeddings. */
function startMaintenance(): NodeJS.Timeout {
  return setInterval(
    () => {
      void (async () => {
        const [temp, publicTemp] = await Promise.all([
          sweepTempFiles(),
          sweepPublicTempFiles(config.storage.signedUrlTtlSeconds * 1000 * 2),
        ]);
        const embeddings = sweepEmbeddings();
        if (temp + publicTemp + embeddings > 0) {
          logger.debug({ temp, publicTemp, embeddings }, 'Maintenance sweep');
        }
      })();
    },
    5 * 60 * 1000,
  ).unref();
}

async function start(): Promise<void> {
  const fatal = fatalConfigurationIssues();

  if (fatal.length > 0) {
    logger.error('FaceProof cannot start with the current configuration:');
    for (const issue of fatal) logger.error(`  ${issue.key}: ${issue.message}`);
    logger.error('Fix the values above in your .env file (see .env.example) and start again.');
    process.exit(1);
  }

  for (const issue of inspectConfiguration()) {
    logger.warn(`${issue.key}: ${issue.message}`);
  }

  await ensureRuntimeDirectories();
  await connectDatabase();

  const app = await buildServer();
  const maintenance = startMaintenance();

  // Load the models in the background so the port opens immediately.
  void warmUpFaceModels();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    clearInterval(maintenance);
    try {
      await app.close();
      await closeSafeAgent();
      await disconnectDatabase();
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  await app.listen({ port: config.server.port, host: config.server.host });

  logger.info(
    {
      url: `http://localhost:${config.server.port}`,
      demoMode: config.demoMode,
      reverseSearchProvider: config.reverseSearch.provider,
      network: config.blockchain.network,
    },
    'FaceProof API listening',
  );

  if (config.demoMode) {
    logger.warn(
      'DEMO_MODE=true — reverse search returns nothing and no blockchain transaction will be sent. Set DEMO_MODE=false for real verifications.',
    );
  }
}

// Only auto-start when executed directly; tests import buildServer instead.
if (require.main === module) {
  start().catch((error: unknown) => {
    logger.error({ err: error }, 'Failed to start the FaceProof API');
    void prisma.$disconnect();
    process.exit(1);
  });
}
