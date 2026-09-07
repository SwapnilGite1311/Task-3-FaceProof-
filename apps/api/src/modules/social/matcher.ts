import {
  cosineSimilarity,
  evidenceStrengthFor,
  extractHandle,
  getDomain,
  detectPlatform,
  perceptualHashSimilarity,
  platformWeight,
  quantizeScore,
  type AnalysedCandidate,
  type MatchAnalysis,
  type ReverseSearchResult,
} from '@faceproof/shared';
import { config } from '../../config/env';
import { colorSignature, decodeImage, perceptualHash } from '../../utils/image';
import { logger } from '../../utils/logger';
import { fetchRemoteImage } from '../../utils/safe-fetch';
import { embedPrimaryFace } from '../face';
import { calibrateFaceSimilarity, colorSimilarityOf, scoreCandidate } from './scoring';

export interface MatchInput {
  /** Perceptual hash of the uploaded image. */
  inputPerceptualHash: string;
  /** Colour signature of the uploaded image. */
  inputColorSignature: number[];
  /** Embedding of the primary detected face, or undefined when none was found. */
  inputEmbedding?: number[];
  results: ReverseSearchResult[];
  onProgress?: (message: string, completed: number, total: number) => void;
}

/**
 * Downloads and compares reverse-search candidates, then picks the strongest
 * one that clears the configured threshold.
 *
 * Deliberate properties:
 *  - The first result is never assumed to be the match; every candidate is
 *    scored on its own evidence.
 *  - A candidate whose image cannot be fetched is reported as such rather than
 *    silently dropped or optimistically scored.
 *  - When nothing clears the threshold the function returns `bestMatch: null`
 *    together with a plain-language reason. It never promotes a weak candidate.
 */
export async function analyseCandidates(input: MatchInput): Promise<MatchAnalysis> {
  const threshold = config.matching.confidenceThreshold;
  const maxAnalysed = config.matching.maxCandidatesAnalysed;

  // Social sources first, then by provider ranking, so the analysis budget is
  // spent where a social-media match is most likely to be found.
  const ordered = [...input.results].sort((a, b) => {
    const weightDelta = platformWeight(b.sourceUrl) - platformWeight(a.sourceUrl);
    if (weightDelta !== 0) return weightDelta;
    return (b.similarity ?? 0) - (a.similarity ?? 0);
  });

  const toAnalyse = ordered.slice(0, maxAnalysed);
  const candidates: AnalysedCandidate[] = [];

  for (const [index, result] of toAnalyse.entries()) {
    input.onProgress?.(
      `Comparing candidate ${index + 1} of ${toAnalyse.length}${result.platform ? ` (${result.platform})` : ''}`,
      index,
      toAnalyse.length,
    );
    candidates.push(await analyseCandidate(result, input));
  }

  // Candidates that were never downloaded still appear in the report, but with
  // their own low confidence and an explicit warning.
  const untouched = ordered.slice(maxAnalysed).map((result) => describeUnanalysed(result));

  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const qualifying = ranked.filter((candidate) => candidate.confidence >= threshold);
  const bestMatch = qualifying[0] ?? null;

  const analysis: MatchAnalysis = {
    bestMatch,
    confidence: bestMatch?.confidence ?? (ranked[0]?.confidence ?? 0),
    evidenceStrength: bestMatch ? evidenceStrengthFor(bestMatch.confidence) : 'INSUFFICIENT',
    threshold,
    candidatesAnalysed: candidates.length,
    candidatesConsidered: input.results.length,
    candidates: [...ranked, ...untouched],
    matchReasons: bestMatch?.matchReasons ?? [],
  };

  if (!bestMatch) {
    analysis.rejectionReason = explainRejection(ranked, threshold, input.results.length);
  }

  logger.info(
    {
      considered: input.results.length,
      analysed: candidates.length,
      best: bestMatch?.confidence ?? null,
      threshold,
    },
    'Candidate analysis complete',
  );

  return analysis;
}

async function analyseCandidate(
  result: ReverseSearchResult,
  input: MatchInput,
): Promise<AnalysedCandidate> {
  const base: AnalysedCandidate = {
    sourceUrl: result.sourceUrl,
    imageFetched: false,
    candidateFaceDetected: false,
    confidence: 0,
    matchReasons: [],
    warnings: [],
  };

  if (result.title) base.title = result.title;
  if (result.imageUrl) base.imageUrl = result.imageUrl;
  if (result.thumbnailUrl) base.thumbnailUrl = result.thumbnailUrl;

  const domain = result.domain ?? getDomain(result.sourceUrl);
  if (domain) base.domain = domain;

  const platform = result.platform ?? detectPlatform(result.sourceUrl);
  if (platform) base.platform = platform;

  const handle = extractHandle(result.sourceUrl);
  if (handle) base.handle = handle;

  // Prefer the full-size image; fall back to the provider thumbnail, which is
  // lower resolution but still comparable.
  const imageCandidates = [result.imageUrl, result.thumbnailUrl].filter(
    (value): value is string => typeof value === 'string' && !value.startsWith('data:'),
  );

  if (imageCandidates.length === 0) {
    base.unavailableReason = 'The search provider did not expose a fetchable image URL.';
    const scored = scoreCandidate({
      sourceUrl: result.sourceUrl,
      imageFetched: false,
      candidateFaceDetected: false,
      inputHasFace: Boolean(input.inputEmbedding),
      ...(result.similarity !== undefined ? { providerSimilarity: result.similarity } : {}),
    });
    base.confidence = scored.confidence;
    base.matchReasons = scored.reasons;
    base.warnings = [...scored.warnings, base.unavailableReason];
    return base;
  }

  let buffer: Buffer | null = null;
  let lastReason = 'Unknown error.';

  for (const url of imageCandidates) {
    const fetched = await fetchRemoteImage(url, { referer: result.sourceUrl });
    if (fetched.image) {
      buffer = fetched.image.buffer;
      break;
    }
    lastReason = fetched.reason;
  }

  if (!buffer) {
    base.unavailableReason = lastReason;
    const scored = scoreCandidate({
      sourceUrl: result.sourceUrl,
      imageFetched: false,
      candidateFaceDetected: false,
      inputHasFace: Boolean(input.inputEmbedding),
      ...(result.similarity !== undefined ? { providerSimilarity: result.similarity } : {}),
    });
    base.confidence = scored.confidence;
    base.matchReasons = scored.reasons;
    base.warnings = [...scored.warnings, lastReason];
    return base;
  }

  try {
    const decoded = await decodeImage(buffer);
    base.imageFetched = true;

    const [candidateHash, candidateColor] = await Promise.all([
      perceptualHash(buffer),
      colorSignature(buffer),
    ]);

    const visualSimilarity = quantizeScore(
      perceptualHashSimilarity(input.inputPerceptualHash, candidateHash),
    );
    const colorSimilarity = quantizeScore(
      colorSimilarityOf(input.inputColorSignature, candidateColor),
    );

    base.visualSimilarity = visualSimilarity;
    base.colorSimilarity = colorSimilarity;

    let faceSimilarity: number | undefined;

    if (input.inputEmbedding) {
      const candidateEmbedding = await embedPrimaryFace(buffer);
      if (candidateEmbedding) {
        base.candidateFaceDetected = true;
        const cosine = cosineSimilarity(input.inputEmbedding, candidateEmbedding);
        base.faceCosine = quantizeScore(cosine);
        faceSimilarity = quantizeScore(calibrateFaceSimilarity(cosine));
        base.faceSimilarity = faceSimilarity;
        // Release the biometric vector as soon as the comparison is done.
        candidateEmbedding.fill(0);
      }
    }

    const scored = scoreCandidate({
      sourceUrl: result.sourceUrl,
      imageFetched: true,
      candidateFaceDetected: base.candidateFaceDetected,
      inputHasFace: Boolean(input.inputEmbedding),
      visualSimilarity,
      colorSimilarity,
      ...(faceSimilarity !== undefined ? { faceSimilarity } : {}),
      ...(result.similarity !== undefined ? { providerSimilarity: result.similarity } : {}),
    });

    base.confidence = scored.confidence;
    base.matchReasons = scored.reasons;
    base.warnings = scored.warnings;

    logger.debug(
      {
        sourceUrl: result.sourceUrl,
        visualSimilarity,
        faceSimilarity: faceSimilarity ?? null,
        confidence: base.confidence,
        candidateSize: `${decoded.width}x${decoded.height}`,
      },
      'Candidate compared',
    );

    return base;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'The candidate image could not be decoded.';
    base.imageFetched = false;
    base.unavailableReason = reason;
    base.warnings.push(reason);
    base.confidence = 0;
    return base;
  }
}

function describeUnanalysed(result: ReverseSearchResult): AnalysedCandidate {
  const candidate: AnalysedCandidate = {
    sourceUrl: result.sourceUrl,
    imageFetched: false,
    candidateFaceDetected: false,
    confidence: 0,
    matchReasons: [],
    warnings: ['Outside the analysis budget (MATCH_MAX_CANDIDATES_ANALYSED); not compared.'],
    unavailableReason: 'Not analysed.',
  };
  if (result.title) candidate.title = result.title;
  if (result.imageUrl) candidate.imageUrl = result.imageUrl;
  if (result.thumbnailUrl) candidate.thumbnailUrl = result.thumbnailUrl;

  const domain = result.domain ?? getDomain(result.sourceUrl);
  if (domain) candidate.domain = domain;

  const platform = result.platform ?? detectPlatform(result.sourceUrl);
  if (platform) candidate.platform = platform;

  return candidate;
}

function explainRejection(
  ranked: AnalysedCandidate[],
  threshold: number,
  consideredCount: number,
): string {
  if (consideredCount === 0) {
    return 'The reverse-image search returned no results at all, so there was nothing to compare against.';
  }
  if (ranked.length === 0) {
    return 'None of the returned results exposed an image that could be downloaded and compared.';
  }

  const best = ranked[0] as AnalysedCandidate;
  const unreachable = ranked.filter((candidate) => !candidate.imageFetched).length;
  const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

  const parts = [
    `The reverse-image search returned ${consideredCount} candidate${consideredCount === 1 ? '' : 's'}, but none met the ${percentage(threshold)} confidence threshold.`,
    `The strongest candidate reached ${percentage(best.confidence)}.`,
  ];

  if (unreachable > 0) {
    parts.push(
      `${unreachable} candidate image${unreachable === 1 ? '' : 's'} could not be downloaded — private accounts, deleted posts and hotlink protection all produce this.`,
    );
  }

  return parts.join(' ');
}
