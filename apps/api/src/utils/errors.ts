import type { StageId } from '@faceproof/shared';

/** Stable machine-readable failure codes surfaced to the UI. */
export const ERROR_CODES = {
  INVALID_IMAGE: 'INVALID_IMAGE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  IMAGE_DECODE_FAILED: 'IMAGE_DECODE_FAILED',
  FACE_MODELS_MISSING: 'FACE_MODELS_MISSING',
  FACE_NOT_DETECTED: 'FACE_NOT_DETECTED',
  FACE_ENCODING_FAILED: 'FACE_ENCODING_FAILED',
  REVERSE_SEARCH_NOT_CONFIGURED: 'REVERSE_SEARCH_NOT_CONFIGURED',
  REVERSE_SEARCH_UNAVAILABLE: 'REVERSE_SEARCH_UNAVAILABLE',
  REVERSE_SEARCH_NO_RESULTS: 'REVERSE_SEARCH_NO_RESULTS',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  CANDIDATE_UNAVAILABLE: 'CANDIDATE_UNAVAILABLE',
  EVIDENCE_GENERATION_FAILED: 'EVIDENCE_GENERATION_FAILED',
  BLOCKCHAIN_NOT_CONFIGURED: 'BLOCKCHAIN_NOT_CONFIGURED',
  BLOCKCHAIN_SUBMIT_FAILED: 'BLOCKCHAIN_SUBMIT_FAILED',
  BLOCKCHAIN_CONFIRMATION_TIMEOUT: 'BLOCKCHAIN_CONFIRMATION_TIMEOUT',
  BLOCKCHAIN_INSUFFICIENT_FUNDS: 'BLOCKCHAIN_INSUFFICIENT_FUNDS',
  URL_REJECTED: 'URL_REJECTED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DEMO_MODE_BLOCKED: 'DEMO_MODE_BLOCKED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface AppErrorOptions {
  code: ErrorCode;
  statusCode?: number;
  stage?: StageId;
  /** Actionable next step shown verbatim in the UI. */
  hint?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly stage?: StageId;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 400;
    this.stage = options.stage;
    this.hint = options.hint;
    this.details = options.details;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      stage: this.stage ?? null,
      hint: this.hint ?? null,
      details: this.details ?? null,
    };
  }
}

/** Failure of a specific pipeline stage; always carries the stage it broke in. */
export class PipelineError extends AppError {
  constructor(message: string, options: AppErrorOptions & { stage: StageId }) {
    super(message, { statusCode: 422, ...options });
    this.name = 'PipelineError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
