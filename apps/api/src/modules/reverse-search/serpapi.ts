import type { ReverseSearchResult } from '@faceproof/shared';
import { config } from '../../config/env';
import { AppError, ERROR_CODES } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { safeFetch } from '../../utils/safe-fetch';
import { getStorageProvider } from '../storage';
import { normalizeResults, type RawResult } from './normalize';
import type { ReverseSearchContext, ReverseSearchProvider } from './types';

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';

interface SerpApiEnvelope {
  error?: string;
  search_metadata?: { id?: string; status?: string };
  visual_matches?: unknown[];
  image_results?: unknown[];
  inline_images?: unknown[];
  image_sizes?: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Base class for the two SerpApi engines.
 *
 * SerpApi fetches the image from a URL rather than accepting an upload, so the
 * image is written to temporary storage first and removed as soon as the search
 * returns — including when it throws.
 */
abstract class SerpApiProvider implements ReverseSearchProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly engine: string;
  /** Query parameter this engine uses to receive the image URL. */
  abstract readonly imageParam: string;

  readonly queryMode = 'image_url' as const;
  readonly credentialsUrl = 'https://serpapi.com/manage-api-key';

  assertConfigured(): void {
    if (!config.reverseSearch.apiKey) {
      throw new AppError('No SerpApi key is configured, so reverse image search cannot run.', {
        code: ERROR_CODES.REVERSE_SEARCH_NOT_CONFIGURED,
        statusCode: 503,
        hint: `Create a key at ${this.credentialsUrl} and set REVERSE_SEARCH_API_KEY in .env.`,
      });
    }
    getStorageProvider().assertUsable();
  }

  protected abstract extract(payload: SerpApiEnvelope): RawResult[];

  async search(image: Buffer, context?: ReverseSearchContext): Promise<ReverseSearchResult[]> {
    this.assertConfigured();

    const storage = getStorageProvider();
    context?.onProgress?.('Publishing a temporary, expiring copy of the image for the search engine');

    const object = await storage.putTemporary({
      buffer: image,
      contentType: context?.mimeType ?? 'image/jpeg',
      extension: context?.extension ?? '.jpg',
      ttlSeconds: config.storage.signedUrlTtlSeconds,
    });

    try {
      context?.onProgress?.(`Querying SerpApi (${this.engine})`);

      const url = new URL(SERPAPI_ENDPOINT);
      url.searchParams.set('engine', this.engine);
      url.searchParams.set(this.imageParam, object.url);
      url.searchParams.set('api_key', config.reverseSearch.apiKey as string);
      url.searchParams.set('no_cache', 'true');
      url.searchParams.set('hl', 'en');

      const response = await safeFetch(url.toString(), {
        timeoutMs: config.reverseSearch.timeoutMs,
        maxBytes: 8 * 1024 * 1024,
        headers: { accept: 'application/json' },
      });

      const payload = this.parse(response.body, response.status);
      const raw = this.extract(payload);

      logger.info(
        { provider: this.id, status: response.status, rawResults: raw.length },
        'Reverse image search completed',
      );

      return normalizeResults(raw, config.reverseSearch.maxResults);
    } finally {
      // The image must not stay publicly reachable longer than the search.
      await storage.removeTemporary(object.key);
    }
  }

  private parse(body: Buffer, status: number): SerpApiEnvelope {
    let payload: SerpApiEnvelope;
    try {
      payload = JSON.parse(body.toString('utf8')) as SerpApiEnvelope;
    } catch (error) {
      throw new AppError(`SerpApi returned a non-JSON response (HTTP ${status}).`, {
        code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
        statusCode: 502,
        cause: error,
      });
    }

    if (status === 401) {
      throw new AppError('SerpApi rejected the API key.', {
        code: ERROR_CODES.REVERSE_SEARCH_NOT_CONFIGURED,
        statusCode: 503,
        hint: `Check REVERSE_SEARCH_API_KEY against ${this.credentialsUrl}.`,
      });
    }
    if (status === 429) {
      throw new AppError('SerpApi rate limit or monthly search quota reached.', {
        code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
        statusCode: 503,
        hint: 'Wait for the quota to reset or upgrade the SerpApi plan, then retry.',
      });
    }

    if (payload.error) {
      // SerpApi reports "hasn't returned any results" as an error string; that
      // is a legitimate empty result, not a failure of the integration.
      if (/didn.?t return any results|hasn.?t returned any results/i.test(payload.error)) {
        return { visual_matches: [], image_results: [] };
      }
      throw new AppError(`SerpApi error: ${payload.error}`, {
        code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
        statusCode: 502,
        hint: this.hintForError(payload.error),
      });
    }

    if (status >= 400) {
      throw new AppError(`SerpApi returned HTTP ${status}.`, {
        code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
        statusCode: 502,
      });
    }

    return payload;
  }

  private hintForError(message: string): string | undefined {
    if (/url|fetch|download|invalid image/i.test(message)) {
      return 'SerpApi has to download the image from PUBLIC_BASE_URL (or your S3 bucket). Make sure that URL is reachable from the public internet — a localhost address will always fail.';
    }
    return undefined;
  }
}

/**
 * Google Lens via SerpApi. This is the default because Lens indexes social
 * platforms far more aggressively than classic reverse image search, which is
 * what makes a genuine social-media match realistic.
 */
export class SerpApiGoogleLensProvider extends SerpApiProvider {
  readonly id = 'serpapi_google_lens';
  readonly label = 'SerpApi · Google Lens';
  readonly engine = 'google_lens';
  readonly imageParam = 'url';

  protected extract(payload: SerpApiEnvelope): RawResult[] {
    const matches = Array.isArray(payload.visual_matches) ? payload.visual_matches : [];

    return matches.flatMap((entry): RawResult[] => {
      const record = asRecord(entry);
      if (!record) return [];

      const source = asRecord(record.source);

      return [
        {
          title: record.title,
          sourceUrl: record.link,
          imageUrl: record.image ?? record.original_image,
          thumbnailUrl: record.thumbnail,
          // Google Lens does not publish a numeric similarity; leave it unset
          // rather than inventing one. Similarity is measured locally instead.
          similarity: undefined,
          platform: typeof source?.name === 'string' ? undefined : undefined,
        },
      ];
    });
  }
}

/** Classic Google reverse image search via SerpApi. */
export class SerpApiGoogleReverseImageProvider extends SerpApiProvider {
  readonly id = 'serpapi_google_reverse_image';
  readonly label = 'SerpApi · Google Reverse Image';
  readonly engine = 'google_reverse_image';
  readonly imageParam = 'image_url';

  protected extract(payload: SerpApiEnvelope): RawResult[] {
    const organic = Array.isArray(payload.image_results) ? payload.image_results : [];
    const inline = Array.isArray(payload.inline_images) ? payload.inline_images : [];
    const sizes = Array.isArray(payload.image_sizes) ? payload.image_sizes : [];

    const fromOrganic = organic.flatMap((entry): RawResult[] => {
      const record = asRecord(entry);
      if (!record) return [];
      return [
        {
          title: record.title,
          sourceUrl: record.link,
          thumbnailUrl: record.thumbnail,
          imageUrl: record.original,
        },
      ];
    });

    const fromInline = inline.flatMap((entry): RawResult[] => {
      const record = asRecord(entry);
      if (!record) return [];
      return [
        {
          title: record.title ?? record.source,
          sourceUrl: record.link ?? record.source_link,
          thumbnailUrl: record.thumbnail,
          imageUrl: record.original,
        },
      ];
    });

    const fromSizes = sizes.flatMap((entry): RawResult[] => {
      const record = asRecord(entry);
      if (!record) return [];
      return [
        {
          title: record.title,
          sourceUrl: record.link,
          thumbnailUrl: record.thumbnail,
          imageUrl: record.original,
        },
      ];
    });

    return [...fromOrganic, ...fromSizes, ...fromInline];
  }
}
