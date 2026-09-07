import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../config/env';
import { AppError, ERROR_CODES, isAppError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface ErrorBody {
  error: string;
  code: string;
  stage: string | null;
  hint: string | null;
  details: Record<string, unknown> | null;
  requestId: string;
}

/**
 * Single place where an exception becomes an HTTP response.
 *
 * Clients get a stable `code` they can branch on and a `hint` they can act on;
 * they never get a stack trace or an internal message, because those leak
 * filesystem paths and dependency versions.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({
      error: `No route matches ${request.method} ${request.url}.`,
      code: ERROR_CODES.NOT_FOUND,
      stage: null,
      hint: null,
      details: null,
      requestId: request.id,
    } satisfies ErrorBody);
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const body = translate(error, request.id);

    const statusCode = statusFor(error, body.code);

    if (statusCode >= 500) {
      logger.error({ err: error, requestId: request.id, url: request.url }, 'Request failed');
    } else {
      logger.warn(
        { code: body.code, requestId: request.id, url: request.url, message: body.error },
        'Request rejected',
      );
    }

    reply.code(statusCode).send(body);
  });
}

function translate(error: unknown, requestId: string): ErrorBody {
  if (isAppError(error)) {
    return {
      error: error.message,
      code: error.code,
      stage: error.stage ?? null,
      hint: error.hint ?? null,
      details: error.details ?? null,
      requestId,
    };
  }

  if (error instanceof ZodError) {
    return {
      error: error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
      code: ERROR_CODES.VALIDATION_FAILED,
      stage: null,
      hint: null,
      details: null,
      requestId,
    };
  }

  const fastifyError = error as FastifyError;

  if (fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
    return {
      error: `The uploaded file exceeds the ${config.upload.maxSizeMb} MB limit.`,
      code: ERROR_CODES.IMAGE_TOO_LARGE,
      stage: null,
      hint: 'Compress or downscale the image and try again.',
      details: null,
      requestId,
    };
  }

  if (fastifyError.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
    return {
      error: 'The request must be multipart/form-data with the image in the "image" field.',
      code: ERROR_CODES.VALIDATION_FAILED,
      stage: null,
      hint: null,
      details: null,
      requestId,
    };
  }

  if (fastifyError.statusCode === 429) {
    return {
      error: 'Too many requests. Slow down and try again shortly.',
      code: ERROR_CODES.RATE_LIMITED,
      stage: null,
      hint: null,
      details: null,
      requestId,
    };
  }

  // Anything unrecognised is an internal fault; do not echo it back verbatim.
  return {
    error: config.isProduction
      ? 'An unexpected error occurred.'
      : ((error as Error)?.message ?? 'An unexpected error occurred.'),
    code: ERROR_CODES.INTERNAL,
    stage: null,
    hint: null,
    details: null,
    requestId,
  };
}

function statusFor(error: unknown, code: string): number {
  if (error instanceof AppError) return error.statusCode;
  if (error instanceof ZodError) return 400;
  const fastifyStatus = (error as FastifyError).statusCode;
  if (typeof fastifyStatus === 'number' && fastifyStatus >= 400) return fastifyStatus;
  return code === ERROR_CODES.INTERNAL ? 500 : 400;
}
