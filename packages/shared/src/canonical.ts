/**
 * Deterministic JSON canonicalisation (JCS / RFC 8785 style).
 *
 * The evidence hash is only meaningful if *anyone* can recompute it byte for
 * byte, so the serialisation must be fully specified:
 *
 *  - object keys sorted by UTF-16 code unit (the default `Array#sort` order),
 *  - no insignificant whitespace,
 *  - `undefined` object members dropped, `undefined` array members become null,
 *  - non-finite numbers rejected rather than silently coerced,
 *  - `-0` normalised to `0`,
 *  - strings escaped by `JSON.stringify`, which already emits the shortest
 *    valid escape sequence for every code point.
 */

export class CanonicalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalisationError';
  }
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export function canonicalJSONStringify(value: unknown): string {
  return serialise(value, new WeakSet(), '$');
}

function serialise(value: unknown, seen: WeakSet<object>, path: string): string {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'string') return JSON.stringify(value);
  if (type === 'boolean') return value ? 'true' : 'false';

  if (type === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new CanonicalisationError(
        `Non-finite number at ${path}; evidence documents must be exactly reproducible.`,
      );
    }
    // JSON has no signed zero. Normalise so -0 and 0 hash identically.
    return Object.is(n, -0) ? '0' : JSON.stringify(n);
  }

  if (type === 'bigint') {
    throw new CanonicalisationError(
      `BigInt at ${path} cannot be canonicalised; convert it to a string first.`,
    );
  }

  if (type === 'undefined' || type === 'function' || type === 'symbol') {
    throw new CanonicalisationError(`Value of type ${type} at ${path} is not serialisable.`);
  }

  const obj = value as object;

  if (seen.has(obj)) {
    throw new CanonicalisationError(`Circular reference at ${path}.`);
  }
  seen.add(obj);

  try {
    if (Array.isArray(obj)) {
      const items = obj.map((item, i) =>
        item === undefined ? 'null' : serialise(item, seen, `${path}[${i}]`),
      );
      return `[${items.join(',')}]`;
    }

    if (obj instanceof Date) {
      // Dates are ambiguous across runtimes; force callers to be explicit.
      throw new CanonicalisationError(
        `Date at ${path} must be converted to an ISO-8601 string before canonicalisation.`,
      );
    }

    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();

    const members = keys.map(
      (key) => `${JSON.stringify(key)}:${serialise(record[key], seen, `${path}.${key}`)}`,
    );
    return `{${members.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Rounds a similarity/confidence score to a fixed precision so that a value
 * recomputed on another machine cannot differ in the 17th decimal place and
 * silently invalidate the evidence hash.
 */
export function quantizeScore(value: number, decimals = 6): number {
  if (!Number.isFinite(value)) {
    throw new CanonicalisationError('Cannot quantize a non-finite score.');
  }
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
