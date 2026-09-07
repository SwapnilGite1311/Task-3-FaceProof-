import type { ReverseSearchResult } from '@faceproof/shared';

export interface ReverseSearchContext {
  /** Media type of the buffer, e.g. `image/jpeg`. */
  mimeType: string;
  /** File extension including the dot, e.g. `.jpg`. */
  extension: string;
  /** Progress callback surfaced to the UI over SSE. */
  onProgress?: (message: string) => void;
}

/**
 * Contract every reverse-image-search integration implements.
 *
 * `search` takes the raw image bytes. Providers that can only search by URL are
 * responsible for uploading the bytes to temporary storage themselves and for
 * removing them afterwards, so callers never have to care which kind they got.
 */
export interface ReverseSearchProvider {
  readonly id: string;
  readonly label: string;
  /** How the provider receives the image. Reported in the evidence document. */
  readonly queryMode: 'image_url' | 'image_upload';
  /** Where to get credentials, shown in configuration errors. */
  readonly credentialsUrl: string;

  search(image: Buffer, context?: ReverseSearchContext): Promise<ReverseSearchResult[]>;

  /** Throws an AppError with an actionable hint when credentials are missing. */
  assertConfigured(): void;
}
