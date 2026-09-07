import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReverseSearchSummary } from '@faceproof/shared';
import { prisma } from '../src/config/database';
import { analyzeFaces, encodingSummary } from '../src/modules/face';
import { buildEvidence, hashEvidence } from '../src/modules/evidence';
import { analyseCandidates } from '../src/modules/social';
import {
  createVerification,
  getVerificationDto,
  updateVerification,
  upsertBlockchainRecord,
  upsertMatch,
} from '../src/modules/verification/repository';
import {
  emitVerificationEvent,
  flushEvents,
  releaseEventCounter,
  replayEvents,
} from '../src/modules/verification/events';
import { applyStageUpdate, initialStages } from '../src/modules/verification/state';
import { colorSignature, decodeImage, perceptualHash } from '../src/utils/image';
import { sha256 } from '../src/utils/hash';

/**
 * Integration test: verification creation -> state changes -> evidence creation,
 * exercised against a real PostgreSQL database, the real face models and the
 * real event log.
 *
 * The external network calls (reverse-image search, blockchain) are the only
 * things not exercised here, because they need paid credentials and a funded
 * wallet; the search result set is therefore an explicitly empty one, which is
 * itself a genuine outcome the pipeline must handle correctly.
 */
const portrait = fs.readFileSync(path.join(__dirname, 'fixtures', 'pravatar-12.jpg'));

let databaseAvailable = false;
const createdIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    console.warn(
      '\n  [skipped] verification.integration.test.ts needs PostgreSQL.\n' +
        '  Start it with "npm run db:up" and apply migrations with "npm run prisma:migrate".\n',
    );
  }
}, 60_000);

afterAll(async () => {
  if (databaseAvailable && createdIds.length > 0) {
    await prisma.verification.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect();
});

describe('verification lifecycle', () => {
  it('persists creation, stage transitions, events and evidence', async () => {
    if (!databaseAvailable) return;

    // ── Creation ──────────────────────────────────────────────────────────
    const decoded = await decodeImage(portrait);
    const inputImageHash = sha256(portrait);
    const inputPerceptualHash = await perceptualHash(portrait);

    const created = await createVerification({
      filename: 'pravatar-12.jpg',
      mimeType: decoded.mimeType,
      byteSize: decoded.byteSize,
      width: decoded.width,
      height: decoded.height,
      inputImageHash,
      perceptualHash: inputPerceptualHash,
      storagePath: path.join(__dirname, 'fixtures', 'pravatar-12.jpg'),
    });
    createdIds.push(created.id);

    expect(created.status).toBe('pending');
    expect(created.evidenceHash).toBeNull();

    let dto = await getVerificationDto(created.id);
    expect(dto.stages).toHaveLength(8);
    expect(dto.stages.every((stage) => stage.state === 'pending')).toBe(true);
    expect(dto.imageUrl).toBe(`/api/v1/verifications/${created.id}/image`);

    await emitVerificationEvent(created.id, 'verification.created', {
      verificationId: created.id,
    });

    // ── State changes ─────────────────────────────────────────────────────
    let stages = initialStages();
    const advance = async (
      stage: Parameters<typeof applyStageUpdate>[1],
      detail?: string,
    ): Promise<void> => {
      stages = applyStageUpdate(stages, stage, { state: 'processing' });
      await updateVerification(created.id, { stages: stages as never });
      await emitVerificationEvent(created.id, 'stage.updated', { stage, state: 'processing' });

      stages = applyStageUpdate(stages, stage, { state: 'completed', ...(detail ? { detail } : {}) });
      await updateVerification(created.id, { stages: stages as never });
      await emitVerificationEvent(created.id, 'stage.updated', { stage, state: 'completed' });
    };

    await updateVerification(created.id, { status: 'processing' });
    await advance('image_analysis', `${decoded.width} × ${decoded.height}`);

    dto = await getVerificationDto(created.id);
    expect(dto.status).toBe('processing');
    expect(dto.stages[0]?.state).toBe('completed');
    expect(dto.stages[0]?.startedAt).toBeTruthy();
    expect(dto.stages[1]?.state).toBe('pending');

    // ── Real face analysis ────────────────────────────────────────────────
    const analysis = await analyzeFaces(portrait, decoded.width, decoded.height);
    expect(analysis.summary.faceDetected).toBe(true);

    await updateVerification(created.id, {
      faceDetected: true,
      faceCount: analysis.summary.faceCount,
      faceDetector: analysis.summary.detector,
      faceData: analysis.summary as never,
    });
    await advance('face_detection', `${analysis.summary.faceCount} face(s) found`);
    await emitVerificationEvent(created.id, 'face.detected', { face: analysis.summary });

    const encoding = encodingSummary(analysis.summary.durationMs);
    await updateVerification(created.id, { encodingData: encoding as never });
    await advance('face_encoding');

    dto = await getVerificationDto(created.id);
    expect(dto.face?.faceCount).toBe(analysis.summary.faceCount);
    expect(dto.encoding?.dimensions).toBe(128);
    // Crucially: the embedding itself must not have been persisted.
    expect(JSON.stringify(dto)).not.toMatch(/[A-Za-z0-9+/]{200,}/);

    // ── Search + candidate analysis (genuine empty result set) ────────────
    const search: ReverseSearchSummary = {
      provider: 'integration-test (no external call)',
      query: 'image_upload',
      totalResults: 0,
      socialResults: 0,
      durationMs: 0,
      results: [],
      note: 'No external search was performed in this test.',
    };
    await updateVerification(created.id, {
      reverseSearchProvider: search.provider,
      reverseSearchData: search as never,
    });
    await advance('reverse_image_search', 'No candidates');

    const match = await analyseCandidates({
      inputPerceptualHash,
      inputColorSignature: await colorSignature(portrait),
      inputEmbedding: analysis.embeddings[0] as number[],
      results: search.results,
    });
    await updateVerification(created.id, { matchData: match as never });
    await upsertMatch(created.id, match);
    await advance('social_verification', 'No candidate met the threshold');

    expect(match.bestMatch).toBeNull();

    const matchRow = await prisma.match.findUnique({ where: { verificationId: created.id } });
    expect(matchRow).not.toBeNull();
    expect(matchRow?.postUrl).toBeNull();
    expect(matchRow?.evidenceStrength).toBe('INSUFFICIENT');

    // ── Evidence creation ─────────────────────────────────────────────────
    const evidence = buildEvidence({
      verificationId: created.id,
      verifiedAt: new Date(),
      image: {
        filename: 'pravatar-12.jpg',
        mimeType: decoded.mimeType,
        byteSize: decoded.byteSize,
        width: decoded.width,
        height: decoded.height,
        sha256: inputImageHash,
        perceptualHash: inputPerceptualHash,
      },
      face: analysis.summary,
      encoding,
      search,
      match,
    });
    const { hash: evidenceHash } = hashEvidence(evidence);

    await updateVerification(created.id, { evidence: evidence as never, evidenceHash });
    await advance('evidence_generation', 'SHA-256 computed');

    dto = await getVerificationDto(created.id);
    expect(dto.evidenceHash).toBe(evidenceHash);
    expect(dto.evidence?.verificationId).toBe(created.id);
    expect(dto.evidence?.matchFound).toBe(false);
    // The stored document must still reproduce the stored hash.
    expect(hashEvidence(dto.evidence!).hash).toBe(evidenceHash);

    // ── Blockchain record in its pre-confirmation state ───────────────────
    await upsertBlockchainRecord(created.id, {
      network: 'polygon-amoy',
      chainId: 80002,
      contractAddress: '0x' + '1'.repeat(40),
      transactionHash: '0x' + '2'.repeat(64),
      evidenceHash,
      timestamp: new Date(),
      status: 'submitting',
    });

    dto = await getVerificationDto(created.id);
    expect(dto.blockchain?.status).toBe('submitting');
    expect(dto.blockchain?.blockNumber).toBeNull();
    expect(dto.blockchain?.explorerTxUrl).toContain('/tx/0x22222');

    await upsertBlockchainRecord(created.id, {
      network: 'polygon-amoy',
      chainId: 80002,
      contractAddress: '0x' + '1'.repeat(40),
      transactionHash: '0x' + '2'.repeat(64),
      evidenceHash,
      timestamp: new Date(),
      blockNumber: 26_000_001n,
      confirmations: 1,
      gasUsed: '120000',
      status: 'confirmed',
    });
    await advance('blockchain_anchor', 'Confirmed');
    await advance('complete');

    await updateVerification(created.id, {
      status: 'completed_no_match',
      completedAt: new Date(),
    });

    // ── Final state ───────────────────────────────────────────────────────
    dto = await getVerificationDto(created.id);
    expect(dto.status).toBe('completed_no_match');
    expect(dto.completedAt).toBeTruthy();
    expect(dto.stages.every((stage) => stage.state === 'completed')).toBe(true);
    expect(dto.blockchain?.status).toBe('confirmed');
    expect(dto.blockchain?.blockNumber).toBe('26000001');

    // ── Event log is gap-free and ordered, so SSE replay is faithful ──────
    await flushEvents(created.id);
    const events = await replayEvents(created.id);
    expect(events.length).toBeGreaterThan(10);
    expect(events[0]?.name).toBe('verification.created');
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index + 1),
    );

    const fromMiddle = await replayEvents(created.id, 5);
    expect(fromMiddle[0]?.seq).toBe(6);

    releaseEventCounter(created.id);
  });

  it('cascades deletes so no orphan rows survive', async () => {
    if (!databaseAvailable) return;

    const record = await createVerification({
      filename: 'cascade.jpg',
      mimeType: 'image/jpeg',
      byteSize: 100,
      width: 200,
      height: 200,
      inputImageHash: 'd'.repeat(64),
      perceptualHash: '0'.repeat(16),
      storagePath: '/tmp/cascade.jpg',
    });

    await upsertBlockchainRecord(record.id, {
      network: 'polygon-amoy',
      chainId: 80002,
      contractAddress: '0x' + '3'.repeat(40),
      transactionHash: '0x' + '4'.repeat(64),
      evidenceHash: 'e'.repeat(64),
      timestamp: new Date(),
      status: 'submitting',
    });
    await emitVerificationEvent(record.id, 'verification.created', { verificationId: record.id });
    await flushEvents(record.id);

    await prisma.verification.delete({ where: { id: record.id } });

    expect(
      await prisma.blockchainRecord.findUnique({ where: { verificationId: record.id } }),
    ).toBeNull();
    expect(await prisma.verificationEvent.count({ where: { verificationId: record.id } })).toBe(0);

    releaseEventCounter(record.id);
  });
});
