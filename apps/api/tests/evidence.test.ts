import { describe, expect, it } from 'vitest';
import {
  PIPELINE_VERSION,
  type AnalysedCandidate,
  type FaceDetectionSummary,
  type ImageAnalysis,
  type MatchAnalysis,
  type ReverseSearchSummary,
} from '@faceproof/shared';
import { buildEvidence, hashEvidence, recomputeEvidenceHash } from '../src/modules/evidence';
import { sha256Utf8 } from '../src/utils/hash';

const image: ImageAnalysis = {
  filename: 'portrait.jpg',
  mimeType: 'image/jpeg',
  byteSize: 42078,
  width: 600,
  height: 600,
  sha256: 'a'.repeat(64),
  perceptualHash: '34d94c1f863cd23a',
};

const face: FaceDetectionSummary = {
  faceDetected: true,
  faceCount: 1,
  faces: [
    {
      index: 0,
      score: 0.9812,
      box: { x: 120, y: 80, width: 240, height: 300 },
      relativeBox: { x: 0.2, y: 0.133333, width: 0.4, height: 0.5 },
      landmarkCount: 68,
    },
  ],
  detector: 'ssd_mobilenetv1@face-api-1.7',
  durationMs: 812,
};

const encoding = {
  dimensions: 128,
  model: 'face_recognition_resnet34@face-api-1.7',
  normalized: true,
  durationMs: 812,
};

const search: ReverseSearchSummary = {
  provider: 'SerpApi · Google Lens',
  query: 'image_url',
  totalResults: 14,
  socialResults: 5,
  durationMs: 4200,
  results: [],
};

const bestMatch: AnalysedCandidate = {
  sourceUrl: 'https://www.instagram.com/p/Cabcdefghij/',
  imageUrl: 'https://scontent.cdninstagram.com/v/abc.jpg',
  platform: 'Instagram',
  handle: '@someone',
  domain: 'instagram.com',
  imageFetched: true,
  candidateFaceDetected: true,
  visualSimilarity: 0.968_75,
  colorSimilarity: 0.991_2,
  faceSimilarity: 0.942_1,
  faceCosine: 0.9,
  confidence: 0.913_4,
  matchReasons: ['High visual similarity (perceptual hash)', 'Face embeddings are a close match'],
  warnings: [],
};

const match: MatchAnalysis = {
  bestMatch,
  confidence: 0.913_4,
  evidenceStrength: 'HIGH',
  threshold: 0.62,
  candidatesAnalysed: 12,
  candidatesConsidered: 14,
  candidates: [bestMatch],
  matchReasons: bestMatch.matchReasons,
};

const verifiedAt = new Date('2026-09-05T12:34:56.789Z');

const input = {
  verificationId: 'clz0000000000000000000000',
  verifiedAt,
  image,
  face,
  encoding,
  search,
  match,
};

describe('buildEvidence', () => {
  it('captures the pipeline version so records stay distinguishable', () => {
    expect(buildEvidence(input).pipelineVersion).toBe(PIPELINE_VERSION);
  });

  it('records the match details verbatim from the analysis', () => {
    const evidence = buildEvidence(input);
    expect(evidence.matchFound).toBe(true);
    expect(evidence.matchedPlatform).toBe('Instagram');
    expect(evidence.matchedPostUrl).toBe('https://www.instagram.com/p/Cabcdefghij/');
    expect(evidence.visualSimilarity).toBe(0.96875);
    expect(evidence.faceSimilarity).toBe(0.9421);
    expect(evidence.evidenceStrength).toBe('HIGH');
  });

  it('uses explicit nulls rather than omitting keys when there is no match', () => {
    const evidence = buildEvidence({
      ...input,
      match: {
        ...match,
        bestMatch: null,
        confidence: 0.31,
        evidenceStrength: 'INSUFFICIENT',
        matchReasons: [],
      },
    });

    expect(evidence.matchFound).toBe(false);
    expect(evidence).toHaveProperty('matchedPlatform', null);
    expect(evidence).toHaveProperty('matchedPostUrl', null);
    expect(evidence).toHaveProperty('visualSimilarity', null);
    expect(evidence).toHaveProperty('faceSimilarity', null);
    expect(evidence).toHaveProperty('confidence', null);
  });

  it('never leaks biometric data or the image itself', () => {
    const evidence = buildEvidence(input);

    // Only the model identity and the dimension count are recorded — never the
    // vector itself. Assert structurally: no value anywhere in the document is
    // a numeric array, which is the only shape an embedding could take.
    const numericArrays: unknown[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        if (value.some((item) => typeof item === 'number')) numericArrays.push(value);
        value.forEach(walk);
        return;
      }
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(evidence);
    expect(numericArrays).toEqual([]);

    // And no raw image bytes smuggled in as a string.
    const serialised = JSON.stringify(evidence);
    expect(serialised).not.toMatch(/data:image\//);
    expect(serialised).not.toMatch(/[A-Za-z0-9+/]{256,}={0,2}/);

    expect(evidence.faceEmbeddingDimensions).toBe(128);
    expect(evidence.faceEmbeddingModel).toBe('face_recognition_resnet34@face-api-1.7');
  });

  it('sorts match reasons so array order cannot vary between runs', () => {
    const shuffled = buildEvidence({
      ...input,
      match: {
        ...match,
        bestMatch: { ...bestMatch, matchReasons: [...bestMatch.matchReasons].reverse() },
      },
    });
    expect(shuffled.matchReasons).toEqual([...bestMatch.matchReasons].sort());
  });

  it('serialises the timestamp as ISO-8601 UTC', () => {
    expect(buildEvidence(input).verifiedAt).toBe('2026-09-05T12:34:56.789Z');
  });
});

describe('hashEvidence', () => {
  it('is deterministic for identical input', () => {
    expect(hashEvidence(buildEvidence(input)).hash).toBe(hashEvidence(buildEvidence(input)).hash);
  });

  it('hashes exactly the canonical bytes it returns', () => {
    const { canonical, hash } = hashEvidence(buildEvidence(input));
    expect(hash).toBe(sha256Utf8(canonical));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any single field changes', () => {
    const baseline = hashEvidence(buildEvidence(input)).hash;

    const differentUrl = hashEvidence(
      buildEvidence({
        ...input,
        match: {
          ...match,
          bestMatch: { ...bestMatch, sourceUrl: 'https://www.instagram.com/p/Cdifferent/' },
        },
      }),
    ).hash;

    const differentScore = hashEvidence(
      buildEvidence({
        ...input,
        match: { ...match, bestMatch: { ...bestMatch, faceSimilarity: 0.9422 } },
      }),
    ).hash;

    const differentTime = hashEvidence(
      buildEvidence({ ...input, verifiedAt: new Date('2026-09-05T12:34:56.790Z') }),
    ).hash;

    expect(new Set([baseline, differentUrl, differentScore, differentTime]).size).toBe(4);
  });

  it('recomputes to the same digest from the stored document', () => {
    const evidence = buildEvidence(input);
    const { hash } = hashEvidence(evidence);
    // Round-trip through JSON the way the database would.
    const stored = JSON.parse(JSON.stringify(evidence)) as unknown;
    expect(recomputeEvidenceHash(stored)).toBe(hash);
  });

  it('detects tampering with the stored document', () => {
    const evidence = buildEvidence(input);
    const { hash } = hashEvidence(evidence);
    const tampered = { ...evidence, matchedPostUrl: 'https://www.instagram.com/p/Cevil/' };
    expect(recomputeEvidenceHash(tampered)).not.toBe(hash);
  });
});
