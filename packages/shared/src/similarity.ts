/** Vector maths used to compare face embeddings and perceptual hashes. */

export class SimilarityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimilarityError';
  }
}

/**
 * Cosine similarity of two vectors, returned in its natural range [-1, 1].
 * Throws on length mismatch or a zero-magnitude vector, because silently
 * returning 0 would look like "no similarity" rather than "invalid input".
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new SimilarityError(`Vector length mismatch: ${a.length} vs ${b.length}.`);
  }
  if (a.length === 0) {
    throw new SimilarityError('Cannot compute cosine similarity of empty vectors.');
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new SimilarityError(`Non-finite component at index ${i}.`);
    }
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  if (denominator === 0) {
    throw new SimilarityError('Cannot compute cosine similarity against a zero vector.');
  }

  const raw = dot / denominator;
  // Guard against |value| marginally exceeding 1 from accumulated float error.
  return Math.min(1, Math.max(-1, raw));
}

/** Cosine similarity remapped into [0, 1] for use as a display/score value. */
export function cosineSimilarityUnit(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return (cosineSimilarity(a, b) + 1) / 2;
}

/** Returns a new L2-normalised copy of the vector. */
export function l2Normalize(vector: ArrayLike<number>): number[] {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const v = vector[i] as number;
    if (!Number.isFinite(v)) throw new SimilarityError(`Non-finite component at index ${i}.`);
    sumSquares += v * v;
  }
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) throw new SimilarityError('Cannot normalise a zero vector.');

  const out = new Array<number>(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = (vector[i] as number) / magnitude;
  return out;
}

export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new SimilarityError(`Vector length mismatch: ${a.length} vs ${b.length}.`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Hamming distance between two equal-length lowercase hex strings. */
export function hexHammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new SimilarityError(`Hash length mismatch: ${a.length} vs ${b.length}.`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number.parseInt(a[i] as string, 16);
    const y = Number.parseInt(b[i] as string, 16);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      throw new SimilarityError(`Invalid hex digit at index ${i}.`);
    }
    let diff = x ^ y;
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

/**
 * Perceptual-hash similarity in [0, 1]: 1 means identical hashes, 0 means every
 * bit differs. For a 64-bit pHash, >= 0.90 (<= 6 differing bits) is a strong
 * signal that two images share the same visual content.
 */
export function perceptualHashSimilarity(a: string, b: string): number {
  const bits = a.length * 4;
  return 1 - hexHammingDistance(a, b) / bits;
}
