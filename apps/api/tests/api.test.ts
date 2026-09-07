import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildServer } from '../src/server';
import { ERROR_CODES } from '../src/utils/errors';

/** Builds a multipart/form-data body without pulling in another dependency. */
function multipart(
  parts: Array<{ name: string; filename?: string; contentType?: string; body: Buffer }>,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----faceprooftest${Date.now().toString(16)}`;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    const header =
      `--${boundary}\r\n` +
      `Content-Disposition: ${disposition}\r\n` +
      (part.contentType ? `Content-Type: ${part.contentType}\r\n` : '') +
      '\r\n';
    chunks.push(Buffer.from(header, 'utf8'), part.body, Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('HTTP API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves pipeline metadata', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.pipelineVersion).toBe('1.0.0');
    expect(body.stages).toHaveLength(8);
    expect(body.stages[0].id).toBe('image_analysis');
    expect(body.acceptedMimeTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(body.blockchain.chainId).toBe(80002);
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe(ERROR_CODES.NOT_FOUND);
    expect(response.json().requestId).toBeTruthy();
  });

  it('rejects a create request that is not multipart', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/verifications',
      headers: { 'content-type': 'application/json' },
      payload: { image: 'nope' },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('rejects multipart with no file part', async () => {
    const { payload, headers } = multipart([{ name: 'note', body: Buffer.from('hello') }]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/verifications',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('rejects a non-image file even when the client claims image/jpeg', async () => {
    const { payload, headers } = multipart([
      {
        name: 'image',
        filename: 'evil.jpg',
        contentType: 'image/jpeg',
        body: Buffer.from('<html><script>alert(1)</script></html>', 'utf8'),
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/verifications',
      headers,
      payload,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
  });

  it('rejects a real image that is too small to analyse', async () => {
    const tiny = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#334155' },
    })
      .png()
      .toBuffer();

    const { payload, headers } = multipart([
      { name: 'image', filename: 'tiny.png', contentType: 'image/png', body: tiny },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/verifications',
      headers,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(ERROR_CODES.INVALID_IMAGE);
    expect(response.json().error).toMatch(/minimum of 64x64/);
  });

  it('rejects a malformed verification id before touching the database', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/verifications/%2e%2e%2fetc%2fpasswd',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('rejects an unsigned temporary object request', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/temp/whatever.jpg?exp=1&sig=nope',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().code).toBeTruthy();
  });

  it('requires the signature query parameters on temporary objects', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/temp/whatever.jpg' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('sets hardening headers on every response', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('does not reflect an unknown origin in CORS headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/meta',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
