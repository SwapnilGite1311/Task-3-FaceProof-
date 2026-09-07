import { cosineSimilarity, platformWeight, quantizeScore } from '@faceproof/shared';

/**
 * Calibration of face-embedding cosine similarity.
 *
 * The 128-D descriptors produced by the face-recognition net occupy a narrow
 * cone: two *different* people typically score around 0.75-0.82 cosine, and the
 * same person 0.95+. Reporting the raw cosine as a percentage would therefore
 * be actively misleading ("81% similar" for two strangers).
 *
 * The model's documented decision boundary is a Euclidean distance of 0.6
 * between descriptors. For L2-normalised vectors, d^2 = 2(1 - cos), so
 * d = 0.6 corresponds to cos = 1 - 0.6^2 / 2 = 0.82.
 *
 * We therefore map cosine onto a score where **0.5 is exactly that boundary**:
 *
 *   cos <= 0.65  ->  0.00   (clearly different people)
 *   cos == 0.82  ->  0.50   (the model's own match threshold)
 *   cos == 1.00  ->  1.00   (identical embedding)
 *
 * The raw cosine is kept alongside the calibrated score so nothing is hidden.
 */
export const FACE_MATCH_COSINE = 0.82;
export const FACE_FLOOR_COSINE = 0.65;

export function calibrateFaceSimilarity(cosine: number): number {
  if (!Number.isFinite(cosine)) return 0;
  if (cosine >= 1) return 1;
  if (cosine >= FACE_MATCH_COSINE) {
    return 0.5 + (0.5 * (cosine - FACE_MATCH_COSINE)) / (1 - FACE_MATCH_COSINE);
  }
  if (cosine <= FACE_FLOOR_COSINE) return 0;
  return (0.5 * (cosine - FACE_FLOOR_COSINE)) / (FACE_MATCH_COSINE - FACE_FLOOR_COSINE);
}

/** Cosine of two colour signatures, remapped from [-1,1] into [0,1]. */
export function colorSimilarityOf(a: number[], b: number[]): number {
  const raw = cosineSimilarity(a, b);
  // Colour signatures are non-negative, so the practical range is [0,1] already;
  // clamp defensively rather than rescaling and distorting the value.
  return Math.min(1, Math.max(0, raw));
}

export interface CandidateSignals {
  /** Perceptual-hash similarity, present when the candidate image was fetched. */
  visualSimilarity?: number;
  colorSimilarity?: number;
  /** Calibrated face similarity, present when both images contained a face. */
  faceSimilarity?: number;
  /** Similarity as reported by the search provider, when it publishes one. */
  providerSimilarity?: number;
  sourceUrl: string;
  imageFetched: boolean;
  candidateFaceDetected: boolean;
  inputHasFace: boolean;
}

export interface ScoreResult {
  confidence: number;
  reasons: string[];
  warnings: string[];
}

/**
 * Combines the available signals into a single confidence value.
 *
 * The weighting depends on what could actually be measured, because a
 * candidate whose image is unreachable simply has less evidence behind it and
 * must not be allowed to score like one that was fully compared.
 */
export function scoreCandidate(signals: CandidateSignals): ScoreResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const platform = platformWeight(signals.sourceUrl);

  // No image to compare: the only signals left are the provider's own ranking
  // and the fact that the URL belongs to a known platform. That is weak, and it
  // is capped so it can never on its own clear a sensible threshold.
  if (!signals.imageFetched) {
    const provider = signals.providerSimilarity ?? 0;
    const confidence = Math.min(0.25, 0.15 * platform + 0.6 * provider * 0.25);
    warnings.push('Candidate image could not be downloaded, so no visual comparison was possible.');
    if (platform > 0) reasons.push('Source URL belongs to a recognised public platform');
    if (signals.providerSimilarity !== undefined) {
      reasons.push('Search provider ranked this result as similar');
    }
    return { confidence: quantizeScore(confidence), reasons, warnings };
  }

  const visual = signals.visualSimilarity ?? 0;
  const color = signals.colorSimilarity ?? 0;

  if (signals.faceSimilarity !== undefined) {
    const face = signals.faceSimilarity;
    const confidence = 0.55 * face + 0.3 * visual + 0.05 * color + 0.1 * platform;

    if (face >= 0.75) reasons.push('Face embeddings are a close match');
    else if (face >= 0.5) reasons.push('Face embeddings match above the model decision boundary');
    else warnings.push('Face embeddings fall below the model decision boundary');

    if (visual >= 0.9) reasons.push('Near-identical image composition (perceptual hash)');
    else if (visual >= 0.75) reasons.push('High visual similarity (perceptual hash)');

    if (platform > 0) reasons.push('Source URL belongs to a recognised public platform');

    return { confidence: quantizeScore(clamp(confidence)), reasons, warnings };
  }

  // The candidate image was analysed but contains no detectable face. It can
  // still be the same picture (a crop, a graphic, a group shot at low
  // resolution), so visual similarity carries the decision.
  const confidence = 0.7 * visual + 0.15 * color + 0.15 * platform;

  if (signals.inputHasFace && !signals.candidateFaceDetected) {
    warnings.push('No face was detected in the candidate image, so only visual signals were used.');
  }
  if (visual >= 0.9) reasons.push('Near-identical image composition (perceptual hash)');
  else if (visual >= 0.75) reasons.push('High visual similarity (perceptual hash)');
  if (color >= 0.95) reasons.push('Matching colour distribution');
  if (platform > 0) reasons.push('Source URL belongs to a recognised public platform');

  return { confidence: quantizeScore(clamp(confidence)), reasons, warnings };
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
