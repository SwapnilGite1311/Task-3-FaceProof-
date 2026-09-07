import type { ReverseSearchResult } from '@faceproof/shared';
import { config } from '../../config/env';
import { AppError, ERROR_CODES } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { safeFetch, type SafeFetchOptions } from '../../utils/safe-fetch';
import { normalizeResults, type RawResult } from './normalize';
import type { ReverseSearchContext, ReverseSearchProvider } from './types';

const TINEYE_ENDPOINT = 'https://api.tineye.com/rest/search/';

interface TinEyeBacklink {
  backlink?: string;
  url?: string;
  crawl_date?: string;
}

interface TinEyeMatch {
  domain?: string;
  image_url?: string;
  score?: number;
  width?: number;
  height?: number;
  backlinks?: TinEyeBacklink[];
}

interface TinEyeEnvelope {
  code?: number;
  messages?: string[];
  stats?: Record<string, unknown>;
  results?: { matches?: TinEyeMatch[] } | TinEyeMatch[];
}

/**
 * TinEye reverse image search.
 *
 * Chosen as the second provider specifically because it accepts a **direct
 * multipart upload**, so it needs neither object storage nor a publicly
 * reachable PUBLIC_BASE_URL. That makes it the pragmatic choice for a local
 * demo behind NAT. The trade-off is coverage: TinEye indexes exact and
 * derivative copies rather than semantically similar images, and its social
 * platform coverage is thinner than Google Lens.
 */
export class TinEyeProvider implements ReverseSearchProvider {
  readonly id = 'tineye';
  readonly label = 'TinEye';
  readonly queryMode = 'image_upload' as const;
  readonly credentialsUrl = 'https://services.tineye.com/TinEyeAPI';

  assertConfigured(): void {
    if (!config.reverseSearch.tineyeUsername || !config.reverseSearch.tineyePassword) {
      throw new AppError('TinEye credentials are not configured, so reverse image search cannot run.', {
        code: ERROR_CODES.REVERSE_SEARCH_NOT_CONFIGURED,
        statusCode: 503,
        hint: `Set TINEYE_API_USERNAME and TINEYE_API_PASSWORD in .env. Keys are issued at ${this.credentialsUrl}.`,
      });
    }
  }

  async search(image: Buffer, context?: ReverseSearchContext): Promise<ReverseSearchResult[]> {
    this.assertConfigured();
    context?.onProgress?.('Uploading the image directly to TinEye');

    const form = new FormData();
    const filename = `upload${context?.extension ?? '.jpg'}`;
    form.append(
      'image_upload',
      new Blob([new Uint8Array(image)], { type: context?.mimeType ?? 'image/jpeg' }),
      filename,
    );

    const url = new URL(TINEYE_ENDPOINT);
    url.searchParams.set('limit', String(Math.min(100, config.reverseSearch.maxResults)));
    url.searchParams.set('sort', 'score');
    url.searchParams.set('order', 'desc');

    const credentials = Buffer.from(
      `${config.reverseSearch.tineyeUsername}:${config.reverseSearch.tineyePassword}`,
    ).toString('base64');

    const response = await safeFetch(url.toString(), {
      method: 'POST',
      // Node's global FormData and undici's own FormData are structurally
      // identical but nominally distinct types; undici accepts this at runtime.
      body: form as unknown as SafeFetchOptions['body'],
      timeoutMs: config.reverseSearch.timeoutMs,
      maxBytes: 8 * 1024 * 1024,
      headers: {
        authorization: `Basic ${credentials}`,
        accept: 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new AppError('TinEye rejected the API credentials.', {
        code: ERROR_CODES.REVERSE_SEARCH_NOT_CONFIGURED,
        statusCode: 503,
        hint: 'Check TINEYE_API_USERNAME and TINEYE_API_PASSWORD.',
      });
    }
    if (response.status === 429) {
      throw new AppError('TinEye search quota exhausted.', {
        code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
        statusCode: 503,
        hint: 'Wait for the quota window to reset or top up the TinEye bundle.',
      });
    }

    let payload: TinEyeEnvelope;
    try {
      payload = JSON.parse(response.body.toString('utf8')) as TinEyeEnvelope;
    } catch (error) {
      throw new AppError(`TinEye returned a non-JSON response (HTTP ${response.status}).`, {
        code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
        statusCode: 502,
        cause: error,
      });
    }

    if (response.status >= 400 || (payload.code !== undefined && payload.code >= 400)) {
      const detail = payload.messages?.join('; ') || `HTTP ${response.status}`;
      throw new AppError(`TinEye error: ${detail}`, {
        code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
        statusCode: 502,
      });
    }

    const matches = Array.isArray(payload.results)
      ? payload.results
      : (payload.results?.matches ?? []);

    // TinEye groups every page that hosts a given image under one match, so a
    // single match can produce several distinct source URLs.
    const raw: RawResult[] = matches.flatMap((match): RawResult[] => {
      const backlinks = match.backlinks ?? [];
      if (backlinks.length === 0) {
        return match.image_url
          ? [{ sourceUrl: match.image_url, imageUrl: match.image_url, similarity: match.score }]
          : [];
      }
      return backlinks.map((backlink) => ({
        title: backlink.backlink,
        sourceUrl: backlink.backlink ?? match.image_url,
        imageUrl: backlink.url ?? match.image_url,
        thumbnailUrl: match.image_url,
        similarity: match.score,
      }));
    });

    logger.info(
      { provider: this.id, matches: matches.length, rawResults: raw.length },
      'Reverse image search completed',
    );

    return normalizeResults(raw, config.reverseSearch.maxResults);
  }
}
