import type { VerificationDto, VerificationProofCheck } from '@faceproof/shared';
import { apiUrl } from './config';

export interface ApiErrorBody {
  error: string;
  code: string;
  stage: string | null;
  hint: string | null;
  details: Record<string, unknown> | null;
  requestId?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly hint: string | null;
  readonly stage: string | null;

  constructor(body: ApiErrorBody, status: number) {
    super(body.error);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    this.hint = body.hint;
    this.stage = body.stage;
  }
}

async function parseError(response: Response): Promise<never> {
  let body: ApiErrorBody;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = {
      error: `The API returned HTTP ${response.status}.`,
      code: 'HTTP_ERROR',
      stage: null,
      hint: null,
      details: null,
    };
  }
  throw new ApiError(body, response.status);
}

/** Wraps a network-level failure so the UI can distinguish it from a 4xx. */
async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new ApiError(
      {
        error: 'The FaceProof API is unreachable. Check that it is running and that NEXT_PUBLIC_API_URL is correct.',
        code: 'API_UNREACHABLE',
        stage: null,
        hint: 'Start it with `npm run dev:api` from the repository root.',
        details: { cause: error instanceof Error ? error.message : String(error) },
      },
      0,
    );
  }
}

export interface ApiMeta {
  pipelineVersion: string;
  stages: Array<{ id: string; ordinal: string; label: string; description: string }>;
  acceptedMimeTypes: string[];
  maxUploadBytes: number;
  maxUploadMb: number;
  demoMode: boolean;
  matchThreshold: number;
  blockchain: {
    network: string;
    chainId: number;
    explorerUrl: string;
    contractAddress: string | null;
  };
}

export async function fetchMeta(): Promise<ApiMeta> {
  const response = await request(apiUrl('/api/v1/meta'), { cache: 'no-store' });
  if (!response.ok) await parseError(response);
  return (await response.json()) as ApiMeta;
}

export async function createVerification(
  file: File,
  signal?: AbortSignal,
): Promise<VerificationDto> {
  const form = new FormData();
  form.append('image', file, file.name);

  const response = await request(apiUrl('/api/v1/verifications'), {
    method: 'POST',
    body: form,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) await parseError(response);
  return (await response.json()) as VerificationDto;
}

export async function fetchVerification(id: string): Promise<VerificationDto> {
  const response = await request(apiUrl(`/api/v1/verifications/${id}`), { cache: 'no-store' });
  if (!response.ok) await parseError(response);
  return (await response.json()) as VerificationDto;
}

export async function fetchProofCheck(id: string): Promise<VerificationProofCheck> {
  const response = await request(apiUrl(`/api/v1/verifications/${id}/verify`), {
    cache: 'no-store',
  });
  if (!response.ok) await parseError(response);
  return (await response.json()) as VerificationProofCheck;
}

export async function fetchEvidenceDocument(id: string): Promise<{ canonical: string; hash: string }> {
  const response = await request(apiUrl(`/api/v1/verifications/${id}/evidence`), {
    cache: 'no-store',
  });
  if (!response.ok) await parseError(response);
  return {
    canonical: await response.text(),
    hash: response.headers.get('x-faceproof-evidence-sha256') ?? '',
  };
}

export function imageUrlFor(id: string): string {
  return apiUrl(`/api/v1/verifications/${id}/image`);
}

export function certificateUrlFor(id: string): string {
  return apiUrl(`/api/v1/verifications/${id}/certificate`);
}

export function eventStreamUrlFor(id: string): string {
  return apiUrl(`/api/v1/verifications/${id}/events`);
}

export function evidenceUrlFor(id: string): string {
  return apiUrl(`/api/v1/verifications/${id}/evidence`);
}
