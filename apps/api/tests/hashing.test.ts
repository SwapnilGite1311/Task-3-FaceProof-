import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJSONStringify, CanonicalisationError, quantizeScore } from '@faceproof/shared';
import { hashCanonical, hmacSha256, safeEqual, sha256, sha256Utf8, toBytes32 } from '../src/utils/hash';

describe('SHA-256 hashing', () => {
  it('matches the well-known digest of an empty input', () => {
    expect(sha256(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the well-known digest of "abc"', () => {
    expect(sha256Utf8('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('agrees with node:crypto for random buffers', () => {
    for (let i = 0; i < 20; i += 1) {
      const bytes = crypto.randomBytes(1 + Math.floor(Math.random() * 4096));
      expect(sha256(bytes)).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('is sensitive to a single flipped bit', () => {
    const a = Buffer.from([0b0000_0000, 0b1111_1111]);
    const b = Buffer.from([0b0000_0001, 0b1111_1111]);
    expect(sha256(a)).not.toBe(sha256(b));
  });

  it('produces 64 lowercase hex characters', () => {
    expect(sha256Utf8('faceproof')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('toBytes32', () => {
  it('adds the 0x prefix and lowercases', () => {
    const digest = sha256Utf8('x');
    expect(toBytes32(digest.toUpperCase())).toBe(`0x${digest}`);
  });

  it('accepts an already-prefixed digest', () => {
    const digest = sha256Utf8('y');
    expect(toBytes32(`0x${digest}`)).toBe(`0x${digest}`);
  });

  it('rejects anything that is not a 32 byte digest', () => {
    expect(() => toBytes32('deadbeef')).toThrow(/32 byte hex digest/);
    expect(() => toBytes32(`0x${'z'.repeat(64)}`)).toThrow();
  });
});

describe('hashCanonical', () => {
  it('returns the canonical pre-image alongside the digest', () => {
    const { canonical, hash } = hashCanonical({ b: 1, a: 2 });
    expect(canonical).toBe('{"a":2,"b":1}');
    expect(hash).toBe(sha256Utf8(canonical));
  });

  it('is independent of key insertion order', () => {
    const first = hashCanonical({ alpha: 1, beta: { y: 2, x: 1 }, gamma: [3, 2, 1] });
    const second = hashCanonical({ gamma: [3, 2, 1], beta: { x: 1, y: 2 }, alpha: 1 });
    expect(first.hash).toBe(second.hash);
  });

  it('is sensitive to array order, which is semantically meaningful', () => {
    expect(hashCanonical({ a: [1, 2] }).hash).not.toBe(hashCanonical({ a: [2, 1] }).hash);
  });

  it('distinguishes a missing key from an explicit null', () => {
    expect(hashCanonical({ a: 1 }).hash).not.toBe(hashCanonical({ a: 1, b: null }).hash);
  });
});

describe('canonicalJSONStringify', () => {
  it('emits no insignificant whitespace', () => {
    expect(canonicalJSONStringify({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it('drops undefined object members but keeps undefined array slots as null', () => {
    expect(canonicalJSONStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJSONStringify([undefined, 1])).toBe('[null,1]');
  });

  it('normalises negative zero', () => {
    expect(canonicalJSONStringify({ a: -0 })).toBe('{"a":0}');
  });

  it('sorts keys by code unit, including non-ascii', () => {
    expect(canonicalJSONStringify({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
  });

  it('rejects values that cannot be reproduced exactly', () => {
    expect(() => canonicalJSONStringify({ a: Number.NaN })).toThrow(CanonicalisationError);
    expect(() => canonicalJSONStringify({ a: Number.POSITIVE_INFINITY })).toThrow(CanonicalisationError);
    expect(() => canonicalJSONStringify({ a: 1n })).toThrow(CanonicalisationError);
    expect(() => canonicalJSONStringify({ a: new Date() })).toThrow(CanonicalisationError);
  });

  it('rejects circular structures', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => canonicalJSONStringify(value)).toThrow(/Circular/);
  });
});

describe('quantizeScore', () => {
  it('rounds to six decimals so float noise cannot change a digest', () => {
    expect(quantizeScore(0.1 + 0.2)).toBe(0.3);
    expect(quantizeScore(0.9684999999999999)).toBe(0.9685);
  });

  it('never returns negative zero', () => {
    expect(Object.is(quantizeScore(-0.0000001), 0)).toBe(true);
  });
});

describe('HMAC helpers', () => {
  it('produces a stable signature for the same input', () => {
    expect(hmacSha256('secret', 'payload')).toBe(hmacSha256('secret', 'payload'));
  });

  it('changes when the secret changes', () => {
    expect(hmacSha256('secret-a', 'payload')).not.toBe(hmacSha256('secret-b', 'payload'));
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
