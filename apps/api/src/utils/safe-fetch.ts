import dns from 'node:dns';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { isPrivateAddress, validateExternalUrl } from '@faceproof/shared';
import { AppError, ERROR_CODES } from './errors';
import { logger } from './logger';
import { sniffImageType } from './image';

/**
 * SSRF defence, part 2 of 2 (part 1 is the pure URL validation in
 * `@faceproof/shared/url`).
 *
 * A hostname that passes structural validation can still resolve to a private
 * address, either by design (`internal.example.com -> 10.0.0.5`) or through DNS
 * rebinding. The only reliable fix is to check the address the socket is
 * actually about to connect to, so we install a custom `lookup` on the undici
 * agent: every candidate address is filtered, and the connection fails outright
 * if nothing public survives.
 */
type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void;

function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error);
      return;
    }

    const allowed = addresses.filter((entry) => !isPrivateAddress(entry.address));

    if (allowed.length === 0) {
      callback(
        new AppError(
          `Refusing to connect to ${hostname}: it resolves only to private or reserved addresses.`,
          { code: ERROR_CODES.URL_REJECTED, statusCode: 400 },
        ) as NodeJS.ErrnoException,
      );
      return;
    }

    if (options.all) {
      callback(null, allowed);
    } else {
      const first = allowed[0] as dns.LookupAddress;
      callback(null, first.address, first.family);
    }
  });
}

let agent: Agent | null = null;

function getAgent(): Agent {
  if (!agent) {
    agent = new Agent({
      connect: {
        lookup: safeLookup as never,
        timeout: 10_000,
      },
      headersTimeout: 20_000,
      bodyTimeout: 30_000,
      // Candidate images come from many different hosts; keep the pool small.
      connections: 16,
    });
  }
  return agent;
}

export async function closeSafeAgent(): Promise<void> {
  if (agent) {
    await agent.close();
    agent = null;
  }
}

const DEFAULT_USER_AGENT =
  'FaceProof/1.0 (+https://github.com/faceproof; verification pipeline; contact via repository)';

const MAX_REDIRECTS = 4;

export interface SafeFetchOptions {
  /** Abort after this many milliseconds. */
  timeoutMs?: number;
  /** Hard cap on the number of bytes read from the response body. */
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD' | 'POST';
  body?: UndiciRequestInit['body'];
  /** Allow plain http. Only used for local development storage URLs. */
  allowHttp?: boolean;
}

export interface SafeFetchResult {
  status: number;
  url: string;
  contentType: string | null;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Performs an outbound HTTP request with every hop validated.
 *
 * Redirects are followed manually so that each `Location` is re-checked; a
 * public URL that 302s to `http://169.254.169.254/` is stopped at the hop.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const {
    timeoutMs = 15_000,
    maxBytes = 12 * 1024 * 1024,
    headers = {},
    method = 'GET',
    body,
    allowHttp = false,
  } = options;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const validation = validateExternalUrl(currentUrl, { allowHttp });
    if (!validation.ok || !validation.url) {
      throw new AppError(`Blocked outbound request: ${validation.message ?? 'invalid URL'}`, {
        code: ERROR_CODES.URL_REJECTED,
        statusCode: 400,
        details: { url: currentUrl, reason: validation.reason ?? 'unknown' },
      });
    }

    const response = await undiciFetch(validation.url.toString(), {
      method,
      body: hop === 0 ? body : undefined,
      redirect: 'manual',
      dispatcher: getAgent(),
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
        accept: '*/*',
        ...headers,
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      // Drain so the connection can be reused.
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new AppError(`Redirect without a Location header from ${currentUrl}.`, {
          code: ERROR_CODES.CANDIDATE_UNAVAILABLE,
          statusCode: 502,
        });
      }
      currentUrl = new URL(location, validation.url).toString();
      continue;
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new AppError(
        `Remote resource is ${declaredLength} bytes, above the ${maxBytes} byte limit.`,
        { code: ERROR_CODES.CANDIDATE_UNAVAILABLE, statusCode: 413 },
      );
    }

    const buffer = await readCapped(response.body, maxBytes);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    return {
      status: response.status,
      url: validation.url.toString(),
      contentType: response.headers.get('content-type'),
      headers: responseHeaders,
      body: buffer,
    };
  }

  throw new AppError(`Too many redirects while fetching ${rawUrl}.`, {
    code: ERROR_CODES.CANDIDATE_UNAVAILABLE,
    statusCode: 502,
  });
}

/**
 * Reads a stream but stops as soon as the cap is exceeded, so a server that
 * lies about (or omits) Content-Length cannot exhaust memory.
 */
async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);

  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AppError(`Remote response exceeded the ${maxBytes} byte limit.`, {
          code: ERROR_CODES.CANDIDATE_UNAVAILABLE,
          statusCode: 413,
        });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
    await stream.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks, total);
}

export interface RemoteImage {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  byteSize: number;
}

/**
 * Downloads a candidate image found by the reverse-image search.
 *
 * Returns `null` rather than throwing when the image is simply unavailable
 * (deleted post, login wall, hotlink protection). That is an expected outcome
 * on social platforms and must be reported honestly, not treated as a crash.
 */
export async function fetchRemoteImage(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number; referer?: string } = {},
): Promise<{ image: RemoteImage } | { image: null; reason: string }> {
  const { timeoutMs = 15_000, maxBytes = 12 * 1024 * 1024, referer } = options;

  try {
    const response = await safeFetch(url, {
      timeoutMs,
      maxBytes,
      headers: {
        accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5',
        ...(referer ? { referer } : {}),
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { image: null, reason: `Access denied by the host (HTTP ${response.status}).` };
    }
    if (response.status === 404 || response.status === 410) {
      return { image: null, reason: `Image no longer available (HTTP ${response.status}).` };
    }
    if (response.status >= 400) {
      return { image: null, reason: `Host returned HTTP ${response.status}.` };
    }
    if (response.body.length === 0) {
      return { image: null, reason: 'Host returned an empty response.' };
    }

    // Trust the bytes, not the header - some CDNs serve images as octet-stream.
    const sniffed = sniffImageType(response.body);
    if (!sniffed) {
      return {
        image: null,
        reason: `Response was not a decodable image (content-type: ${response.contentType ?? 'unknown'}).`,
      };
    }

    return {
      image: {
        buffer: response.body,
        contentType: sniffed.mimeType,
        finalUrl: response.url,
        byteSize: response.body.length,
      },
    };
  } catch (error) {
    const reason =
      error instanceof AppError
        ? error.message
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'The host did not respond in time.'
          : error instanceof Error
            ? error.message
            : 'Unknown network error.';
    logger.debug({ url, reason }, 'Candidate image could not be fetched');
    return { image: null, reason };
  }
}
