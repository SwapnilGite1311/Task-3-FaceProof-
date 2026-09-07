import {
  PIPELINE_VERSION,
  quantizeScore,
  type EvidenceDocument,
  type FaceDetectionSummary,
  type FaceEncodingSummary,
  type ImageAnalysis,
  type MatchAnalysis,
  type ReverseSearchSummary,
} from '@faceproof/shared';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from '../face';
import { hashCanonical } from '../../utils/hash';

export interface EvidenceInput {
  verificationId: string;
  verifiedAt: Date;
  image: ImageAnalysis;
  face: FaceDetectionSummary;
  encoding: FaceEncodingSummary | null;
  search: ReverseSearchSummary;
  match: MatchAnalysis;
}

/**
 * Builds the canonical evidence document.
 *
 * Rules that make the hash reproducible by a third party:
 *  - every field is either a primitive or an array of strings,
 *  - all scores are quantised to 6 decimals so float noise cannot change the
 *    digest when the document is rebuilt on another machine,
 *  - timestamps are ISO-8601 in UTC with millisecond precision,
 *  - absent values are explicit `null`, never omitted, so the key set is fixed.
 *
 * Deliberately absent: face embeddings, the image bytes, and any personal data
 * beyond the public URL the search provider itself returned.
 */
export function buildEvidence(input: EvidenceInput): EvidenceDocument {
  const best = input.match.bestMatch;
  const matchFound = best !== null;

  return {
    pipelineVersion: PIPELINE_VERSION,
    verificationId: input.verificationId,
    verifiedAt: input.verifiedAt.toISOString(),

    inputImageHash: input.image.sha256,
    inputImagePerceptualHash: input.image.perceptualHash,
    inputImageBytes: input.image.byteSize,
    inputImageWidth: input.image.width,
    inputImageHeight: input.image.height,

    faceDetected: input.face.faceDetected,
    faceCount: input.face.faceCount,
    faceDetector: input.face.detector,
    faceEmbeddingModel: input.encoding?.model ?? EMBEDDING_MODEL_ID,
    faceEmbeddingDimensions: input.encoding?.dimensions ?? EMBEDDING_DIMENSIONS,

    reverseSearchProvider: input.search.provider,
    reverseSearchResultCount: input.search.totalResults,

    matchFound,
    matchedPlatform: best?.platform ?? null,
    matchedPostUrl: best?.sourceUrl ?? null,
    matchedImageUrl: best?.imageUrl ?? null,
    visualSimilarity: best?.visualSimilarity !== undefined ? quantizeScore(best.visualSimilarity) : null,
    faceSimilarity: best?.faceSimilarity !== undefined ? quantizeScore(best.faceSimilarity) : null,
    confidence: matchFound ? quantizeScore(input.match.confidence) : null,
    evidenceStrength: input.match.evidenceStrength,
    // Sorted so the array order cannot vary between runs.
    matchReasons: [...(best?.matchReasons ?? [])].sort(),
  };
}

/**
 * Canonicalises and hashes an evidence document.
 * Returns the exact bytes that were hashed so callers can display or re-verify
 * the pre-image rather than having to trust the digest.
 */
export function hashEvidence(document: EvidenceDocument): { canonical: string; hash: string } {
  return hashCanonical(document);
}

/**
 * Recomputes the hash of a stored document. Used by the independent
 * verification endpoint to detect tampering with the database record.
 */
export function recomputeEvidenceHash(stored: unknown): string {
  return hashCanonical(stored).hash;
}
