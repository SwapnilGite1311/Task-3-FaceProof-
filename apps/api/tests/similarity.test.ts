import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  cosineSimilarityUnit,
  euclideanDistance,
  hexHammingDistance,
  l2Normalize,
  perceptualHashSimilarity,
  SimilarityError,
} from '@faceproof/shared';
import {
  FACE_FLOOR_COSINE,
  FACE_MATCH_COSINE,
  calibrateFaceSimilarity,
  scoreCandidate,
} from '../src/modules/social/scoring';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  it('returns 1 for parallel vectors of different magnitude', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
  });

  it('returns -1 for opposed vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 12);
  });

  it('is symmetric', () => {
    const a = [0.3, -0.7, 0.2, 0.9];
    const b = [-0.1, 0.5, 0.4, 0.2];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 15);
  });

  it('never exceeds the [-1, 1] range despite float error', () => {
    const vector = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 1e-3);
    const value = cosineSimilarity(vector, vector);
    expect(value).toBeLessThanOrEqual(1);
    expect(value).toBeGreaterThanOrEqual(-1);
  });

  it('rejects mismatched lengths, empty input and zero vectors', () => {
    expect(() => cosineSimilarity([1, 2], [1])).toThrow(SimilarityError);
    expect(() => cosineSimilarity([], [])).toThrow(SimilarityError);
    expect(() => cosineSimilarity([0, 0], [1, 1])).toThrow(/zero vector/);
    expect(() => cosineSimilarity([Number.NaN, 1], [1, 1])).toThrow(/Non-finite/);
  });

  it('maps into [0,1] via cosineSimilarityUnit', () => {
    expect(cosineSimilarityUnit([1, 0], [1, 0])).toBeCloseTo(1, 12);
    expect(cosineSimilarityUnit([1, 0], [-1, 0])).toBeCloseTo(0, 12);
    expect(cosineSimilarityUnit([1, 0], [0, 1])).toBeCloseTo(0.5, 12);
  });
});

describe('l2Normalize', () => {
  it('produces a unit vector', () => {
    const unit = l2Normalize([3, 4]);
    expect(unit).toEqual([0.6, 0.8]);
    expect(Math.hypot(...unit)).toBeCloseTo(1, 12);
  });

  it('preserves cosine similarity', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    expect(cosineSimilarity(l2Normalize(a), l2Normalize(b))).toBeCloseTo(cosineSimilarity(a, b), 12);
  });

  it('rejects a zero vector', () => {
    expect(() => l2Normalize([0, 0, 0])).toThrow(SimilarityError);
  });
});

describe('euclideanDistance', () => {
  it('matches the Pythagorean expectation', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });

  it('relates to cosine as d^2 = 2(1 - cos) for unit vectors', () => {
    const a = l2Normalize([0.4, 0.9, -0.2]);
    const b = l2Normalize([0.5, 0.8, -0.1]);
    const d = euclideanDistance(a, b);
    expect(d * d).toBeCloseTo(2 * (1 - cosineSimilarity(a, b)), 10);
  });
});

describe('perceptual hash comparison', () => {
  it('counts differing bits', () => {
    expect(hexHammingDistance('0', '1')).toBe(1);
    expect(hexHammingDistance('f', '0')).toBe(4);
    expect(hexHammingDistance('00', 'ff')).toBe(8);
  });

  it('scores identical hashes at 1 and inverted hashes at 0', () => {
    const hash = 'a1b2c3d4e5f60718';
    expect(perceptualHashSimilarity(hash, hash)).toBe(1);
    expect(perceptualHashSimilarity('0000000000000000', 'ffffffffffffffff')).toBe(0);
  });

  it('rejects hashes of different lengths', () => {
    expect(() => perceptualHashSimilarity('abcd', 'ab')).toThrow(SimilarityError);
  });
});

describe('face similarity calibration', () => {
  it('places the model decision boundary at exactly 0.5', () => {
    expect(calibrateFaceSimilarity(FACE_MATCH_COSINE)).toBeCloseTo(0.5, 10);
  });

  it('maps an identical embedding to 1', () => {
    expect(calibrateFaceSimilarity(1)).toBe(1);
  });

  it('floors clearly different people at 0', () => {
    expect(calibrateFaceSimilarity(FACE_FLOOR_COSINE)).toBe(0);
    expect(calibrateFaceSimilarity(0.4)).toBe(0);
  });

  it('is monotonically increasing', () => {
    let previous = -1;
    for (let cosine = 0.5; cosine <= 1; cosine += 0.01) {
      const value = calibrateFaceSimilarity(cosine);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('scores a same-person re-encode far above a different person', () => {
    // Values measured from the real pipeline on re-compressed photographs.
    expect(calibrateFaceSimilarity(0.9991)).toBeGreaterThan(0.99);
    expect(calibrateFaceSimilarity(0.8093)).toBeLessThan(0.5);
  });
});

describe('candidate scoring', () => {
  const socialUrl = 'https://www.instagram.com/p/Cabcdefghij/';

  it('caps confidence when the candidate image could not be downloaded', () => {
    const result = scoreCandidate({
      sourceUrl: socialUrl,
      imageFetched: false,
      candidateFaceDetected: false,
      inputHasFace: true,
      providerSimilarity: 1,
    });
    expect(result.confidence).toBeLessThanOrEqual(0.25);
    expect(result.warnings.join(' ')).toMatch(/could not be downloaded/i);
  });

  it('scores an exact same-image, same-face candidate very highly', () => {
    const result = scoreCandidate({
      sourceUrl: socialUrl,
      imageFetched: true,
      candidateFaceDetected: true,
      inputHasFace: true,
      visualSimilarity: 1,
      colorSimilarity: 1,
      faceSimilarity: 0.99,
    });
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.reasons).toContain('Face embeddings are a close match');
  });

  it('scores a visually identical image with a different face below threshold', () => {
    const result = scoreCandidate({
      sourceUrl: socialUrl,
      imageFetched: true,
      candidateFaceDetected: true,
      inputHasFace: true,
      visualSimilarity: 0.6,
      colorSimilarity: 0.8,
      faceSimilarity: 0.2,
    });
    expect(result.confidence).toBeLessThan(0.62);
    expect(result.warnings.join(' ')).toMatch(/below the model decision boundary/i);
  });

  it('gives a non-social source no platform credit', () => {
    const social = scoreCandidate({
      sourceUrl: socialUrl,
      imageFetched: true,
      candidateFaceDetected: false,
      inputHasFace: true,
      visualSimilarity: 0.9,
      colorSimilarity: 0.9,
    });
    const random = scoreCandidate({
      sourceUrl: 'https://some-random-blog.example.org/post/1',
      imageFetched: true,
      candidateFaceDetected: false,
      inputHasFace: true,
      visualSimilarity: 0.9,
      colorSimilarity: 0.9,
    });
    expect(social.confidence).toBeGreaterThan(random.confidence);
  });

  it('always returns a confidence inside [0,1]', () => {
    const result = scoreCandidate({
      sourceUrl: socialUrl,
      imageFetched: true,
      candidateFaceDetected: true,
      inputHasFace: true,
      visualSimilarity: 1,
      colorSimilarity: 1,
      faceSimilarity: 1,
      providerSimilarity: 1,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
