import { logger } from '../../utils/logger';

/**
 * In-memory, time-limited store for face embeddings.
 *
 * Privacy requirement: biometric vectors must not be written to the database,
 * to disk, or to the blockchain. They exist only for as long as a verification
 * job needs them to compare against candidate images, then they are zeroed and
 * dropped. A TTL sweep guarantees release even if a job crashes mid-pipeline.
 */
const TTL_MS = 15 * 60 * 1000;

interface Entry {
  embeddings: number[][];
  expiresAt: number;
}

const store = new Map<string, Entry>();

export function putEmbeddings(verificationId: string, embeddings: number[][]): void {
  store.set(verificationId, { embeddings, expiresAt: Date.now() + TTL_MS });
}

export function getEmbeddings(verificationId: string): number[][] | undefined {
  const entry = store.get(verificationId);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    dropEmbeddings(verificationId);
    return undefined;
  }
  return entry.embeddings;
}

export function getPrimaryEmbedding(verificationId: string): number[] | undefined {
  return getEmbeddings(verificationId)?.[0];
}

/** Overwrites the vectors before releasing them so they do not linger in heap. */
export function dropEmbeddings(verificationId: string): void {
  const entry = store.get(verificationId);
  if (entry) {
    for (const vector of entry.embeddings) vector.fill(0);
    store.delete(verificationId);
  }
}

export function sweepEmbeddings(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) {
      for (const vector of entry.embeddings) vector.fill(0);
      store.delete(id);
      removed += 1;
    }
  }
  if (removed > 0) logger.debug({ removed }, 'Expired face embeddings released');
  return removed;
}

export function embeddingStoreSize(): number {
  return store.size;
}
