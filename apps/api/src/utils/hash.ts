import crypto from 'node:crypto';
import { canonicalJSONStringify } from '@faceproof/shared';

/** SHA-256 of raw bytes, lowercase hex. */
export function sha256(input: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function sha256Utf8(input: string): string {
  return crypto.createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');
}

/**
 * SHA-256 over the canonical serialisation of a JSON document.
 * Returns both the hash and the exact bytes that were hashed so callers can
 * show, store or re-verify the pre-image.
 */
export function hashCanonical(document: unknown): { canonical: string; hash: string } {
  const canonical = canonicalJSONStringify(document);
  return { canonical, hash: sha256Utf8(canonical) };
}

/** Adds the 0x prefix expected by bytes32 contract arguments. */
export function toBytes32(hexHash: string): string {
  const value = hexHash.startsWith('0x') ? hexHash.slice(2) : hexHash;
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Expected a 32 byte hex digest, received "${hexHash}".`);
  }
  return `0x${value.toLowerCase()}`;
}

export function hmacSha256(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time string comparison for signature checks. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
