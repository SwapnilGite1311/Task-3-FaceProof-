import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/env';
import { ERROR_CODES } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Registers CORS, rate limiting, upload limits and response hardening.
 *
 * The API serves JSON and images only — it never renders HTML — so the headers
 * are aimed at stopping a response from being interpreted as anything other
 * than what it is.
 */
export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin(origin, callback) {
      // Same-origin and non-browser clients (curl, the SSE reconnect probe)
      // send no Origin header at all.
      if (!origin) return callback(null, true);
      if (config.server.corsOrigins.includes(origin)) return callback(null, true);
      logger.warn({ origin }, 'Blocked a cross-origin request');
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'accept', 'last-event-id'],
    exposedHeaders: ['x-faceproof-evidence-sha256', 'content-disposition'],
    maxAge: 600,
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.upload.maxBytes,
      files: 1,
      fields: 8,
      fieldSize: 4096,
      // A multipart part header longer than this is an attack, not a filename.
      headerPairs: 64,
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
    // SSE streams are long-lived; counting them would exhaust the budget of a
    // client that is simply watching one verification.
    allowList: () => false,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      error: `Rate limit exceeded: at most ${context.max} requests per ${context.after}.`,
      code: ERROR_CODES.RATE_LIMITED,
      stage: null,
      hint: 'Wait for the window to reset before retrying.',
      details: null,
    }),
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-resource-policy', 'same-site');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
}
