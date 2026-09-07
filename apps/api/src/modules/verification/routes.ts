import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canonicalJSONStringify } from '@faceproof/shared';
import { config } from '../../config/env';
import { AppError, ERROR_CODES } from '../../utils/errors';
import { sha256 } from '../../utils/hash';
import { decodeImage, perceptualHash } from '../../utils/image';
import { logger } from '../../utils/logger';
import { writeUpload } from '../../utils/tempfile';
import { renderCertificate } from '../evidence';
import { resolveSignedTempFile } from '../storage';
import { replayEvents, subscribe } from './events';
import { runVerification } from './orchestrator';
import { checkProof } from './proof';
import {
  createVerification,
  getVerificationDto,
  requireVerification,
  toDto,
  updateVerification,
} from './repository';

const idParams = z.object({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Malformed verification id.'),
});

const tempParams = z.object({ key: z.string().min(1).max(128) });
const tempQuery = z.object({ exp: z.string().min(1), sig: z.string().min(1) });

function parseParams<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message ?? 'Invalid request parameters.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      statusCode: 400,
    });
  }
  return result.data;
}

export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  // ── Create ────────────────────────────────────────────────────────────────
  app.post('/verifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const file = await request.file({
      limits: { fileSize: config.upload.maxBytes, files: 1 },
    });

    if (!file) {
      throw new AppError('No image was uploaded.', {
        code: ERROR_CODES.VALIDATION_FAILED,
        statusCode: 400,
        hint: 'Send the image as multipart/form-data under the field name "image".',
      });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      // @fastify/multipart throws this once the byte limit is exceeded.
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(`The image exceeds the ${config.upload.maxSizeMb} MB upload limit.`, {
          code: ERROR_CODES.IMAGE_TOO_LARGE,
          statusCode: 413,
        });
      }
      throw error;
    }

    if (buffer.length > config.upload.maxBytes) {
      throw new AppError(`The image exceeds the ${config.upload.maxSizeMb} MB upload limit.`, {
        code: ERROR_CODES.IMAGE_TOO_LARGE,
        statusCode: 413,
      });
    }

    // Validation, hashing and perceptual hashing all run on the exact bytes we
    // received, before anything is written anywhere.
    const decoded = await decodeImage(buffer, file.mimetype);
    const inputImageHash = sha256(buffer);
    const phash = await perceptualHash(buffer);

    const record = await createVerification({
      filename: sanitiseFilename(file.filename ?? `upload${decoded.extension}`),
      mimeType: decoded.mimeType,
      byteSize: decoded.byteSize,
      width: decoded.width,
      height: decoded.height,
      inputImageHash,
      perceptualHash: phash,
      storagePath: '',
    });

    // The upload is named after the row id, which the database generates, so
    // the file can only be written once the row exists.
    const storagePath = await writeUpload(record.id, buffer, decoded.extension);
    const withPath = await updateVerification(record.id, { storagePath });

    // Fire and forget: the client follows progress over SSE.
    void runVerification(record.id).catch((error: unknown) => {
      logger.error({ err: error, verificationId: record.id }, 'Unhandled verification failure');
    });

    return reply.code(201).send(toDto(withPath));
  });

  // ── Current state ─────────────────────────────────────────────────────────
  app.get('/verifications/:id', async (request) => {
    const { id } = parseParams(idParams, request.params);
    return getVerificationDto(id);
  });

  // ── Completed results ─────────────────────────────────────────────────────
  app.get('/verifications/:id/results', async (request, reply) => {
    const { id } = parseParams(idParams, request.params);
    const dto = await getVerificationDto(id);

    if (dto.status === 'pending' || dto.status === 'processing') {
      return reply.code(202).send({
        status: dto.status,
        message: 'The verification is still running. Subscribe to /events for live progress.',
        stages: dto.stages,
      });
    }
    return dto;
  });

  // ── Canonical evidence ────────────────────────────────────────────────────
  app.get('/verifications/:id/evidence', async (request, reply) => {
    const { id } = parseParams(idParams, request.params);
    const record = await requireVerification(id);

    if (!record.evidence) {
      throw new AppError('No evidence document has been generated for this verification yet.', {
        code: ERROR_CODES.NOT_FOUND,
        statusCode: 404,
      });
    }

    // Serve the canonical bytes verbatim: this is the exact pre-image of the
    // hash, so a third party can pipe it into sha256sum and get the same digest.
    const canonical = canonicalJSONStringify(record.evidence);

    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('x-faceproof-evidence-sha256', record.evidenceHash ?? '')
      .header('content-disposition', `inline; filename="faceproof-evidence-${id}.json"`)
      .send(canonical);
  });

  // ── Independent proof check ───────────────────────────────────────────────
  app.get('/verifications/:id/verify', async (request) => {
    const { id } = parseParams(idParams, request.params);
    return checkProof(id);
  });

  // ── Original image ────────────────────────────────────────────────────────
  app.get('/verifications/:id/image', async (request, reply) => {
    const { id } = parseParams(idParams, request.params);
    const record = await requireVerification(id);

    if (!record.storagePath || !fs.existsSync(record.storagePath)) {
      throw new AppError('The original image is no longer stored.', {
        code: ERROR_CODES.NOT_FOUND,
        statusCode: 404,
      });
    }

    return reply
      .header('content-type', record.mimeType)
      .header('cache-control', 'private, max-age=3600')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('x-content-type-options', 'nosniff')
      .send(fs.createReadStream(record.storagePath));
  });

  // ── PDF certificate ───────────────────────────────────────────────────────
  app.get('/verifications/:id/certificate', async (request, reply) => {
    const { id } = parseParams(idParams, request.params);
    const dto = await getVerificationDto(id);

    if (dto.status === 'pending' || dto.status === 'processing') {
      throw new AppError('The verification is still running, so no certificate can be issued yet.', {
        code: ERROR_CODES.VALIDATION_FAILED,
        statusCode: 409,
      });
    }

    const pdf = await renderCertificate(dto);

    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="faceproof-certificate-${id}.pdf"`)
      .header('content-length', String(pdf.length))
      .send(pdf);
  });

  // ── Live events (SSE) ─────────────────────────────────────────────────────
  app.get('/verifications/:id/events', async (request, reply) => {
    const { id } = parseParams(idParams, request.params);
    await requireVerification(id);

    const lastEventId = Number(request.headers['last-event-id'] ?? 0);
    const afterSeq = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

    reply.hijack();
    const stream = reply.raw;

    stream.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and friends will otherwise buffer the stream into uselessness.
      'x-accel-buffering': 'no',
      ...corsHeadersFor(request),
    });

    let closed = false;
    const write = (payload: string): void => {
      if (!closed) stream.write(payload);
    };

    const send = (event: { seq: number; name: string; at: string; data: unknown }): void => {
      write(`id: ${event.seq}\n`);
      write(`event: ${event.name}\n`);
      write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Replay first so a late subscriber catches up, then stream live events.
    // Events emitted during the replay are buffered and flushed afterwards to
    // preserve ordering.
    const buffered: Array<{ seq: number; name: string; at: string; data: unknown }> = [];
    let replaying = true;

    const unsubscribe = subscribe(id, (event) => {
      if (replaying) buffered.push(event);
      else send(event);
    });

    const heartbeat = setInterval(() => write(': keep-alive\n\n'), 20_000);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };

    stream.on('close', cleanup);
    stream.on('error', cleanup);

    try {
      const history = await replayEvents(id, afterSeq);
      let highestSeq = afterSeq;
      for (const event of history) {
        send(event);
        highestSeq = Math.max(highestSeq, event.seq);
      }
      replaying = false;
      for (const event of buffered) {
        if (event.seq > highestSeq) send(event);
      }
      buffered.length = 0;
    } catch (error) {
      logger.error({ err: error, verificationId: id }, 'Failed to replay verification events');
      write(`event: stream.error\ndata: ${JSON.stringify({ message: 'Replay failed.' })}\n\n`);
      cleanup();
      stream.end();
    }
  });

  // ── Signed temporary image (used by URL-based search providers) ───────────
  app.get('/temp/:key', async (request, reply) => {
    const { key } = parseParams(tempParams, request.params);
    const { exp, sig } = parseParams(tempQuery, request.query);

    const resolved = await resolveSignedTempFile(key, exp, sig);
    const stat = await fsp.stat(resolved.filePath);

    return reply
      .header('content-type', resolved.contentType)
      .header('content-length', String(stat.size))
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('x-robots-tag', 'noindex, noimageindex')
      .send(fs.createReadStream(resolved.filePath));
  });
}

/**
 * SSE bypasses the normal reply lifecycle, so CORS headers have to be written
 * onto the raw response manually.
 */
function corsHeadersFor(request: FastifyRequest): Record<string, string> {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && config.server.corsOrigins.includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      vary: 'Origin',
    };
  }
  return {};
}

/** Keeps a user-supplied filename displayable without letting it reach the FS. */
function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  return base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'upload';
}
