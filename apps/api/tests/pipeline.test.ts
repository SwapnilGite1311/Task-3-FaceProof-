import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  cosineSimilarity,
  perceptualHashSimilarity,
  type ImageAnalysis,
  type ReverseSearchSummary,
} from '@faceproof/shared';
import { analyzeFaces, encodingSummary } from '../src/modules/face';
import { analyseCandidates } from '../src/modules/social';
import { buildEvidence, hashEvidence, renderCertificate } from '../src/modules/evidence';
import { colorSignature, decodeImage, perceptualHash, sniffImageType } from '../src/utils/image';
import { sha256 } from '../src/utils/hash';
import { initialStages, applyStageUpdate } from '../src/modules/verification/state';

const FIXTURES = path.join(__dirname, 'fixtures');
const portraitPath = path.join(FIXTURES, 'pravatar-12.jpg');
const otherPortraitPath = path.join(FIXTURES, 'pravatar-47.jpg');

const portrait = fs.readFileSync(portraitPath);
const otherPortrait = fs.readFileSync(otherPortraitPath);

describe('image validation and fingerprinting', () => {
  it('identifies media types from magic bytes, not from the filename', () => {
    expect(sniffImageType(portrait)?.mimeType).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('<html>'))).toBeNull();
    expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
  });

  it('decodes a real photograph and reports its true dimensions', async () => {
    const decoded = await decodeImage(portrait);
    expect(decoded.mimeType).toBe('image/jpeg');
    expect(decoded.width).toBeGreaterThan(64);
    expect(decoded.height).toBeGreaterThan(64);
    expect(decoded.byteSize).toBe(portrait.length);
  });

  it('rejects a truncated file rather than analysing a partial image', async () => {
    await expect(decodeImage(portrait.subarray(0, 200))).rejects.toThrow();
  });

  it('produces a 64-bit perceptual hash', async () => {
    const hash = await perceptualHash(portrait);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keeps the perceptual hash stable across re-encoding and downscaling', async () => {
    const republished = await sharp(portrait).resize(320).jpeg({ quality: 60 }).toBuffer();
    const similarity = perceptualHashSimilarity(
      await perceptualHash(portrait),
      await perceptualHash(republished),
    );
    // This is the property the whole match step depends on: a social platform
    // re-encodes what it hosts, and the fingerprint has to survive that.
    expect(similarity).toBeGreaterThan(0.9);
  });

  it('separates two different photographs', async () => {
    const similarity = perceptualHashSimilarity(
      await perceptualHash(portrait),
      await perceptualHash(otherPortrait),
    );
    expect(similarity).toBeLessThan(0.8);
  });

  it('changes the SHA-256 when a single byte of the file changes', () => {
    const mutated = Buffer.from(portrait);
    mutated[mutated.length - 1] = (mutated[mutated.length - 1]! + 1) % 256;
    expect(sha256(mutated)).not.toBe(sha256(portrait));
  });
});

describe('face detection and encoding', () => {
  it('detects a face and produces a normalised 128-D embedding', async () => {
    const decoded = await decodeImage(portrait);
    const analysis = await analyzeFaces(portrait, decoded.width, decoded.height);

    expect(analysis.summary.faceDetected).toBe(true);
    expect(analysis.summary.faceCount).toBeGreaterThanOrEqual(1);

    const face = analysis.summary.faces[0]!;
    expect(face.score).toBeGreaterThan(0.5);
    expect(face.landmarkCount).toBe(68);
    expect(face.box.width).toBeGreaterThan(0);
    expect(face.box.x + face.box.width).toBeLessThanOrEqual(decoded.width + 1);
    expect(face.relativeBox.x).toBeGreaterThanOrEqual(0);
    expect(face.relativeBox.x + face.relativeBox.width).toBeLessThanOrEqual(1.001);

    const embedding = analysis.embeddings[0]!;
    expect(embedding).toHaveLength(128);
    expect(Math.hypot(...embedding)).toBeCloseTo(1, 6);
  });

  it('recognises the same face after a social-media style re-upload', async () => {
    const republished = await sharp(portrait).resize(320).jpeg({ quality: 62 }).toBuffer();

    const original = await decodeImage(portrait);
    const copy = await decodeImage(republished);

    const a = await analyzeFaces(portrait, original.width, original.height);
    const b = await analyzeFaces(republished, copy.width, copy.height);

    const similarity = cosineSimilarity(a.embeddings[0]!, b.embeddings[0]!);
    expect(similarity).toBeGreaterThan(0.95);
  });

  it('separates two different people well below the model threshold', async () => {
    const first = await decodeImage(portrait);
    const second = await decodeImage(otherPortrait);

    const a = await analyzeFaces(portrait, first.width, first.height);
    const b = await analyzeFaces(otherPortrait, second.width, second.height);

    const similarity = cosineSimilarity(a.embeddings[0]!, b.embeddings[0]!);
    expect(similarity).toBeLessThan(0.82);
  });

  it('reports no face for an image that contains none', async () => {
    const blank = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#1b2430' },
    })
      .png()
      .toBuffer();

    const analysis = await analyzeFaces(blank, 400, 400);
    expect(analysis.summary.faceDetected).toBe(false);
    expect(analysis.embeddings).toHaveLength(0);
  });
});

describe('no-match pipeline (offline)', () => {
  it('runs creation, stage transitions and evidence creation without inventing a match', async () => {
    // 1. Image analysis
    const decoded = await decodeImage(portrait);
    const image: ImageAnalysis = {
      filename: 'portrait.jpg',
      mimeType: decoded.mimeType,
      byteSize: decoded.byteSize,
      width: decoded.width,
      height: decoded.height,
      sha256: sha256(portrait),
      perceptualHash: await perceptualHash(portrait),
    };

    let stages = initialStages();
    stages = applyStageUpdate(stages, 'image_analysis', { state: 'processing' });
    stages = applyStageUpdate(stages, 'image_analysis', { state: 'completed' });

    // 2 + 3. Face detection and encoding
    stages = applyStageUpdate(stages, 'face_detection', { state: 'processing' });
    const analysis = await analyzeFaces(portrait, image.width, image.height);
    stages = applyStageUpdate(stages, 'face_detection', { state: 'completed' });

    stages = applyStageUpdate(stages, 'face_encoding', { state: 'processing' });
    const encoding = encodingSummary(analysis.summary.durationMs);
    stages = applyStageUpdate(stages, 'face_encoding', { state: 'completed' });

    // 4. A genuine search that legitimately found nothing.
    stages = applyStageUpdate(stages, 'reverse_image_search', { state: 'processing' });
    const search: ReverseSearchSummary = {
      provider: 'SerpApi · Google Lens',
      query: 'image_url',
      totalResults: 0,
      socialResults: 0,
      durationMs: 3120,
      results: [],
      note: 'The provider completed the search successfully but found no public copies of this image.',
    };
    stages = applyStageUpdate(stages, 'reverse_image_search', { state: 'completed' });

    // 5. Candidate analysis over an empty candidate set.
    stages = applyStageUpdate(stages, 'social_verification', { state: 'processing' });
    const match = await analyseCandidates({
      inputPerceptualHash: image.perceptualHash,
      inputColorSignature: await colorSignature(portrait),
      inputEmbedding: analysis.embeddings[0]!,
      results: search.results,
    });
    stages = applyStageUpdate(stages, 'social_verification', { state: 'completed' });

    expect(match.bestMatch).toBeNull();
    expect(match.evidenceStrength).toBe('INSUFFICIENT');
    expect(match.rejectionReason).toMatch(/no results/i);

    // 6. Evidence is still produced, and honestly says there was no match.
    stages = applyStageUpdate(stages, 'evidence_generation', { state: 'processing' });
    const evidence = buildEvidence({
      verificationId: 'test_offline_pipeline',
      verifiedAt: new Date('2026-09-05T00:00:00.000Z'),
      image,
      face: analysis.summary,
      encoding,
      search,
      match,
    });
    const { hash, canonical } = hashEvidence(evidence);
    stages = applyStageUpdate(stages, 'evidence_generation', { state: 'completed' });

    expect(evidence.faceDetected).toBe(true);
    expect(evidence.matchFound).toBe(false);
    expect(evidence.matchedPostUrl).toBeNull();
    expect(evidence.confidence).toBeNull();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(canonical).inputImageHash).toBe(image.sha256);

    expect(stages.filter((stage) => stage.state === 'completed')).toHaveLength(6);
    expect(stages.filter((stage) => stage.state === 'pending')).toHaveLength(2);
  });
});

describe('evidence certificate', () => {
  it('renders a PDF for a completed verification', async () => {
    const pdf = await renderCertificate({
      id: 'test_certificate',
      status: 'completed_no_match',
      demo: false,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:01:00.000Z',
      completedAt: '2026-09-05T00:01:00.000Z',
      error: null,
      errorCode: null,
      image: {
        filename: 'portrait.jpg',
        mimeType: 'image/jpeg',
        byteSize: 42078,
        width: 600,
        height: 600,
        sha256: 'a'.repeat(64),
        perceptualHash: '34d94c1f863cd23a',
      },
      imageUrl: '/api/v1/verifications/test_certificate/image',
      stages: initialStages(),
      face: {
        faceDetected: true,
        faceCount: 1,
        faces: [],
        detector: 'ssd_mobilenetv1@face-api-1.7',
        durationMs: 800,
      },
      encoding: {
        dimensions: 128,
        model: 'face_recognition_resnet34@face-api-1.7',
        normalized: true,
        durationMs: 800,
      },
      reverseSearch: {
        provider: 'SerpApi · Google Lens',
        query: 'image_url',
        totalResults: 0,
        socialResults: 0,
        durationMs: 3000,
        results: [],
      },
      match: {
        bestMatch: null,
        confidence: 0,
        evidenceStrength: 'INSUFFICIENT',
        threshold: 0.62,
        candidatesAnalysed: 0,
        candidatesConsidered: 0,
        candidates: [],
        matchReasons: [],
        rejectionReason: 'The reverse-image search returned no results.',
      },
      evidence: null,
      evidenceHash: 'b'.repeat(64),
      blockchain: null,
    });

    // Page text lives in a compressed content stream, so assert on the
    // container: a valid PDF header, a terminated xref table, and metadata.
    const text = pdf.toString('latin1');
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Page');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('renders a PDF for a failed verification without claiming success', async () => {
    const pdf = await renderCertificate({
      id: 'test_failed',
      status: 'failed',
      demo: false,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:30.000Z',
      completedAt: '2026-09-05T00:00:30.000Z',
      error: 'No face was detected in the submitted image.',
      errorCode: 'FACE_NOT_DETECTED',
      image: {
        filename: 'landscape.jpg',
        mimeType: 'image/jpeg',
        byteSize: 10_000,
        width: 800,
        height: 600,
        sha256: 'c'.repeat(64),
        perceptualHash: '0123456789abcdef',
      },
      imageUrl: '/api/v1/verifications/test_failed/image',
      stages: initialStages(),
      face: null,
      encoding: null,
      reverseSearch: null,
      match: null,
      evidence: null,
      evidenceHash: null,
      blockchain: null,
    });

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
