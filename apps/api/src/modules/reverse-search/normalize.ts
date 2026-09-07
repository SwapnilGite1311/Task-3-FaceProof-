import {
  detectPlatform,
  getDomain,
  validateExternalUrl,
  type ReverseSearchResult,
} from '@faceproof/shared';

/** Tracking parameters that only make results look different from each other. */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'igshid',
  'igsh',
  'ref_src',
  'ref_url',
  's',
  'si',
];

/** Canonical form of a result URL, used for de-duplication. */
export function canonicalizeResultUrl(value: string): string | null {
  const validation = validateExternalUrl(value);
  if (!validation.ok || !validation.url) return null;

  const url = validation.url;
  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  url.hash = '';
  // Trailing slashes are not significant for de-duplication purposes.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

function clampSimilarity(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  // Providers report either 0..1 or 0..100; normalise both into 0..1.
  const normalized = value > 1 ? value / 100 : value;
  if (normalized < 0) return 0;
  if (normalized > 1) return 1;
  return normalized;
}

function cleanText(value: unknown, maxLength = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

/** Keeps only image URLs we would actually be willing to fetch. */
function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  // data: URIs are common for provider thumbnails and are safe to keep as-is.
  if (value.startsWith('data:image/')) return value.length <= 2_000_000 ? value : undefined;
  return validateExternalUrl(value).ok ? value : undefined;
}

export interface RawResult {
  title?: unknown;
  sourceUrl?: unknown;
  imageUrl?: unknown;
  thumbnailUrl?: unknown;
  similarity?: unknown;
  platform?: unknown;
}

/**
 * Turns provider-specific payloads into the shared `ReverseSearchResult` shape.
 *
 * Anything that fails URL validation is dropped rather than repaired: a result
 * we cannot safely fetch is not evidence, and inventing a plausible URL would
 * defeat the purpose of the pipeline. De-duplication keeps the first (highest
 * ranked) occurrence of each canonical source URL.
 */
export function normalizeResults(raw: RawResult[], maxResults: number): ReverseSearchResult[] {
  const seen = new Set<string>();
  const out: ReverseSearchResult[] = [];

  for (const entry of raw) {
    if (typeof entry.sourceUrl !== 'string') continue;

    const canonical = canonicalizeResultUrl(entry.sourceUrl);
    if (!canonical) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);

    const domain = getDomain(canonical);
    const platform =
      (typeof entry.platform === 'string' ? entry.platform : undefined) ?? detectPlatform(canonical);

    const result: ReverseSearchResult = { sourceUrl: canonical };

    const title = cleanText(entry.title);
    if (title) result.title = title;

    const imageUrl = safeImageUrl(entry.imageUrl);
    if (imageUrl) result.imageUrl = imageUrl;

    const thumbnailUrl = safeImageUrl(entry.thumbnailUrl);
    if (thumbnailUrl) result.thumbnailUrl = thumbnailUrl;

    if (domain) result.domain = domain;
    if (platform) result.platform = platform;

    const similarity = clampSimilarity(entry.similarity);
    if (similarity !== undefined) result.similarity = similarity;

    out.push(result);
    if (out.length >= maxResults) break;
  }

  return out;
}

/** Number of results that came from a recognised social platform. */
export function countSocialResults(results: ReverseSearchResult[]): number {
  return results.filter((result) => Boolean(result.platform)).length;
}
