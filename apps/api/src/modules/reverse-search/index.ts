import type { ReverseSearchResult, ReverseSearchSummary } from '@faceproof/shared';
import { config } from '../../config/env';
import { AppError, ERROR_CODES, isAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { countSocialResults } from './normalize';
import {
  SerpApiGoogleLensProvider,
  SerpApiGoogleReverseImageProvider,
} from './serpapi';
import { TinEyeProvider } from './tineye';
import type { ReverseSearchContext, ReverseSearchProvider } from './types';

/**
 * Demo provider.
 *
 * It deliberately returns **no results** and says so. Fabricating social-media
 * hits or similarity scores here would produce evidence that looks real and is
 * not, which is exactly what this project must never do. Demo mode exists to
 * exercise the pipeline UI (stage transitions, the no-match state, error
 * states) without spending API quota — nothing more.
 */
class DemoProvider implements ReverseSearchProvider {
  readonly id = 'demo';
  readonly label = 'Demo (no search performed)';
  readonly queryMode = 'image_upload' as const;
  readonly credentialsUrl = 'https://serpapi.com/manage-api-key';

  assertConfigured(): void {
    /* always available */
  }

  async search(): Promise<ReverseSearchResult[]> {
    return [];
  }
}

let provider: ReverseSearchProvider | null = null;

export function getReverseSearchProvider(): ReverseSearchProvider {
  if (provider) return provider;

  if (config.demoMode) {
    provider = new DemoProvider();
    return provider;
  }

  switch (config.reverseSearch.provider) {
    case 'serpapi_google_lens':
      provider = new SerpApiGoogleLensProvider();
      break;
    case 'serpapi_google_reverse_image':
      provider = new SerpApiGoogleReverseImageProvider();
      break;
    case 'tineye':
      provider = new TinEyeProvider();
      break;
    default:
      throw new AppError(`Unknown reverse search provider "${config.reverseSearch.provider}".`, {
        code: ERROR_CODES.REVERSE_SEARCH_NOT_CONFIGURED,
        statusCode: 500,
        hint: 'Set REVERSE_SEARCH_PROVIDER to serpapi_google_lens, serpapi_google_reverse_image or tineye.',
      });
  }

  return provider;
}

/** Test seam: forget the cached provider so config changes take effect. */
export function resetReverseSearchProvider(): void {
  provider = null;
}

export interface RunSearchOptions {
  mimeType: string;
  extension: string;
  onProgress?: (message: string) => void;
}

/**
 * Runs the configured provider and wraps the outcome in a summary.
 *
 * An empty result set is a legitimate outcome (the image genuinely is not
 * indexed anywhere) and is reported as such — not as a failure and certainly
 * not padded out with invented candidates.
 */
export async function runReverseSearch(
  image: Buffer,
  options: RunSearchOptions,
): Promise<ReverseSearchSummary> {
  const active = getReverseSearchProvider();
  active.assertConfigured();

  const started = Date.now();
  const context: ReverseSearchContext = {
    mimeType: options.mimeType,
    extension: options.extension,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };

  try {
    const results = await active.search(image, context);
    const durationMs = Date.now() - started;

    const summary: ReverseSearchSummary = {
      provider: active.label,
      query: active.queryMode,
      totalResults: results.length,
      socialResults: countSocialResults(results),
      durationMs,
      results,
    };

    if (results.length === 0) {
      summary.note = config.demoMode
        ? 'DEMO_MODE is enabled, so no reverse-image search was performed. Set DEMO_MODE=false to run a real search.'
        : 'The provider completed the search successfully but found no public copies of this image.';
    }

    return summary;
  } catch (error) {
    if (isAppError(error)) throw error;

    const message = error instanceof Error ? error.message : 'Unknown reverse search failure.';
    logger.error({ err: error, provider: active.id }, 'Reverse image search failed');

    throw new AppError(`Reverse image search failed: ${message}`, {
      code: ERROR_CODES.REVERSE_SEARCH_UNAVAILABLE,
      statusCode: 502,
      cause: error,
      stage: 'reverse_image_search',
    });
  }
}

export { canonicalizeResultUrl, countSocialResults, normalizeResults } from './normalize';
export { SerpApiGoogleLensProvider, SerpApiGoogleReverseImageProvider, TinEyeProvider };
export type { ReverseSearchContext, ReverseSearchProvider } from './types';
