import fs from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import type {
  MatchAnalysis,
  ReverseSearchSummary,
  StageId,
  StageStatusDto,
  VerificationStatus,
} from '@faceproof/shared';
import { config } from '../../config/env';
import { AppError, ERROR_CODES, errorMessage, isAppError } from '../../utils/errors';
import { colorSignature } from '../../utils/image';
import { logger } from '../../utils/logger';
import { getBlockchainService } from '../blockchain';
import { buildEvidence, hashEvidence } from '../evidence';
import {
  analyzeFaces,
  dropEmbeddings,
  encodingSummary,
  putEmbeddings,
} from '../face';
import { runReverseSearch } from '../reverse-search';
import { analyseCandidates } from '../social';
import { emitVerificationEvent, flushEvents, releaseEventCounter } from './events';
import {
  toImageAnalysis,
  requireVerification,
  updateVerification,
  upsertBlockchainRecord,
  upsertMatch,
  type VerificationWithRelations,
} from './repository';
import { applyStageUpdate, skipRemaining, type StageUpdate } from './state';

/** Guards against two workers racing on the same verification in one process. */
const running = new Set<string>();

export function isRunning(id: string): boolean {
  return running.has(id);
}

/**
 * Runs the full verification pipeline.
 *
 * Every stage writes its own state to the database and emits an event before
 * moving on, so `GET /verifications/:id` and the SSE stream always describe the
 * same reality. Nothing is reported as complete before the work behind it has
 * actually happened.
 */
export async function runVerification(verificationId: string): Promise<void> {
  if (running.has(verificationId)) {
    logger.warn({ verificationId }, 'Verification is already running; ignoring duplicate start');
    return;
  }
  running.add(verificationId);

  const record = await requireVerification(verificationId);
  let stages: StageStatusDto[] = (record.stages as unknown as StageStatusDto[]) ?? [];

  const setStage = async (stageId: StageId, update: StageUpdate): Promise<void> => {
    stages = applyStageUpdate(stages, stageId, update);
    await updateVerification(verificationId, {
      stages: stages as unknown as Prisma.InputJsonValue,
    });
    await emitVerificationEvent(verificationId, 'stage.updated', {
      stage: stageId,
      state: update.state,
      ...(update.detail ? { detail: update.detail } : {}),
      ...(update.error ? { error: update.error } : {}),
    });
  };

  const started = Date.now();

  try {
    await updateVerification(verificationId, { status: 'processing' });
    await emitVerificationEvent(verificationId, 'verification.created', { verificationId });

    const imageBuffer = await readOriginal(record);

    // ── 01 Image analysis ────────────────────────────────────────────────────
    await setStage('image_analysis', { state: 'processing' });
    const image = toImageAnalysis(record);
    const inputColorSignature = await colorSignature(imageBuffer);
    await setStage('image_analysis', {
      state: 'completed',
      detail: `${image.width} × ${image.height} · ${image.mimeType}`,
    });
    await emitVerificationEvent(verificationId, 'image.analyzed', { image });

    // ── 02 Face detection ────────────────────────────────────────────────────
    await setStage('face_detection', { state: 'processing' });
    await emitVerificationEvent(verificationId, 'face.detecting', {});

    const analysis = await analyzeFaces(imageBuffer, image.width, image.height);

    if (!analysis.summary.faceDetected) {
      await emitVerificationEvent(verificationId, 'face.not-detected', {
        message: 'No face was detected in the submitted image.',
      });
      throw new AppError('No face was detected in the submitted image.', {
        code: ERROR_CODES.FACE_NOT_DETECTED,
        statusCode: 422,
        stage: 'face_detection',
        hint: 'Use a photo where a face is clearly visible, reasonably large and not heavily obscured.',
      });
    }

    putEmbeddings(verificationId, analysis.embeddings);

    const multipleFaces = analysis.summary.faceCount > 1;
    await updateVerification(verificationId, {
      faceDetected: true,
      faceCount: analysis.summary.faceCount,
      faceDetector: analysis.summary.detector,
      faceData: analysis.summary as unknown as Prisma.InputJsonValue,
    });
    await setStage('face_detection', {
      state: 'completed',
      detail: multipleFaces
        ? `${analysis.summary.faceCount} faces found — the highest-confidence face is used for matching`
        : '1 face found',
    });
    await emitVerificationEvent(verificationId, 'face.detected', { face: analysis.summary });

    // ── 03 Face encoding ─────────────────────────────────────────────────────
    await setStage('face_encoding', { state: 'processing' });
    await emitVerificationEvent(verificationId, 'face.encoding', {});

    const encoding = encodingSummary(analysis.summary.durationMs);
    await updateVerification(verificationId, {
      encodingData: encoding as unknown as Prisma.InputJsonValue,
    });
    await setStage('face_encoding', {
      state: 'completed',
      detail: `${encoding.dimensions}-D embedding generated (held in memory only)`,
    });
    await emitVerificationEvent(verificationId, 'face.encoded', { encoding });

    // ── 04 Reverse image search ──────────────────────────────────────────────
    await setStage('reverse_image_search', { state: 'processing' });

    let search: ReverseSearchSummary;
    try {
      await emitVerificationEvent(verificationId, 'reverse-search.started', {
        provider: config.reverseSearch.provider,
        query: 'image',
      });

      search = await runReverseSearch(imageBuffer, {
        mimeType: image.mimeType,
        extension: extensionFor(image.mimeType),
        onProgress: (message) => {
          void emitVerificationEvent(verificationId, 'reverse-search.progress', { message });
        },
      });
    } catch (error) {
      const message = errorMessage(error);
      await emitVerificationEvent(verificationId, 'reverse-search.failed', { message });
      throw error;
    }

    await updateVerification(verificationId, {
      reverseSearchProvider: search.provider,
      reverseSearchData: search as unknown as Prisma.InputJsonValue,
    });
    await setStage('reverse_image_search', {
      state: 'completed',
      detail:
        search.totalResults === 0
          ? (search.note ?? 'No public copies of this image were found')
          : `${search.totalResults} candidate${search.totalResults === 1 ? '' : 's'} found · ${search.socialResults} on social platforms`,
    });
    await emitVerificationEvent(verificationId, 'reverse-search.completed', { search });

    // ── 05 Social verification ───────────────────────────────────────────────
    await setStage('social_verification', { state: 'processing' });
    await emitVerificationEvent(verificationId, 'match.analyzing', {
      message:
        search.totalResults === 0
          ? 'Nothing to compare — the search returned no candidates'
          : 'Downloading and comparing candidate images',
      completed: 0,
      total: Math.min(search.totalResults, config.matching.maxCandidatesAnalysed),
    });

    const match: MatchAnalysis = await analyseCandidates({
      inputPerceptualHash: image.perceptualHash,
      inputColorSignature,
      ...(analysis.embeddings[0] ? { inputEmbedding: analysis.embeddings[0] } : {}),
      results: search.results,
      onProgress: (message, completed, total) => {
        void emitVerificationEvent(verificationId, 'match.analyzing', {
          message,
          completed,
          total,
        });
      },
    });

    await updateVerification(verificationId, {
      matchData: match as unknown as Prisma.InputJsonValue,
    });
    await upsertMatch(verificationId, match);

    if (match.bestMatch) {
      await setStage('social_verification', {
        state: 'completed',
        detail: `Match found on ${match.bestMatch.platform ?? match.bestMatch.domain ?? 'an external source'} · ${(match.confidence * 100).toFixed(1)}% confidence`,
      });
      await emitVerificationEvent(verificationId, 'match.found', { match });
    } else {
      await setStage('social_verification', {
        state: 'completed',
        detail: 'No candidate met the verification threshold',
      });
      await emitVerificationEvent(verificationId, 'match.not-found', { match });
    }

    // ── 06 Evidence generation ───────────────────────────────────────────────
    await setStage('evidence_generation', { state: 'processing' });

    const evidence = buildEvidence({
      verificationId,
      verifiedAt: new Date(),
      image,
      face: analysis.summary,
      encoding,
      search,
      match,
    });
    const { hash: evidenceHash, canonical } = hashEvidence(evidence);

    await updateVerification(verificationId, {
      evidence: evidence as unknown as Prisma.InputJsonValue,
      evidenceHash,
    });
    await emitVerificationEvent(verificationId, 'evidence.created', { evidence });
    await emitVerificationEvent(verificationId, 'evidence.hashed', { evidenceHash });
    await setStage('evidence_generation', {
      state: 'completed',
      detail: `SHA-256 over ${canonical.length} canonical bytes`,
    });

    // ── 07 Blockchain anchor ─────────────────────────────────────────────────
    await setStage('blockchain_anchor', { state: 'processing' });

    const chain = getBlockchainService();
    const submitted = await chain.createRecord({
      evidenceHash,
      platform: evidence.matchedPlatform,
      postUrl: evidence.matchedPostUrl,
    });

    await upsertBlockchainRecord(verificationId, {
      network: submitted.network,
      chainId: submitted.chainId,
      contractAddress: submitted.contractAddress,
      transactionHash: submitted.transactionHash,
      evidenceHash,
      timestamp: new Date(),
      status: 'submitting',
    });
    await emitVerificationEvent(verificationId, 'blockchain.submitting', {
      network: submitted.network,
      contractAddress: submitted.contractAddress,
      transactionHash: submitted.transactionHash,
    });
    await setStage('blockchain_anchor', {
      state: 'processing',
      detail: `Transaction ${submitted.transactionHash} submitted — waiting for confirmation`,
    });

    const confirmed = await chain.waitForConfirmation(submitted.transactionHash);

    await upsertBlockchainRecord(verificationId, {
      network: confirmed.network,
      chainId: confirmed.chainId,
      contractAddress: confirmed.contractAddress,
      transactionHash: confirmed.transactionHash,
      evidenceHash,
      timestamp: confirmed.blockTimestamp,
      blockNumber: BigInt(confirmed.blockNumber),
      confirmations: confirmed.confirmations,
      gasUsed: confirmed.gasUsed,
      status: 'confirmed',
    });

    const refreshed = await requireVerification(verificationId);
    await emitVerificationEvent(verificationId, 'blockchain.confirmed', {
      blockchain: blockchainDtoOf(refreshed),
    });
    await setStage('blockchain_anchor', {
      state: 'completed',
      detail: `Confirmed in block ${confirmed.blockNumber}`,
    });

    // ── 08 Complete ──────────────────────────────────────────────────────────
    const status: VerificationStatus = match.bestMatch ? 'completed' : 'completed_no_match';

    await setStage('complete', { state: 'processing' });
    await updateVerification(verificationId, { status, completedAt: new Date() });
    await setStage('complete', {
      state: 'completed',
      detail: match.bestMatch
        ? 'Verification complete — evidence anchored'
        : 'Verification complete — no reliable match, analysis anchored',
    });
    await emitVerificationEvent(verificationId, 'verification.completed', { status });

    logger.info(
      { verificationId, status, durationMs: Date.now() - started },
      'Verification pipeline finished',
    );
  } catch (error) {
    await handleFailure(verificationId, error, stages);
  } finally {
    // Biometric vectors never outlive the job that needed them.
    dropEmbeddings(verificationId);
    await flushEvents(verificationId).catch(() => undefined);
    releaseEventCounter(verificationId);
    running.delete(verificationId);
  }
}

async function handleFailure(
  verificationId: string,
  error: unknown,
  stages: StageStatusDto[],
): Promise<void> {
  const appError = isAppError(error)
    ? error
    : new AppError(errorMessage(error), {
        code: ERROR_CODES.INTERNAL,
        statusCode: 500,
        cause: error,
      });

  logger.error(
    { verificationId, code: appError.code, stage: appError.stage, err: error },
    'Verification pipeline failed',
  );

  let next = stages;

  // Fail the stage that was in flight, then mark everything after it skipped.
  const activeStage =
    appError.stage ?? stages.find((stage) => stage.state === 'processing')?.id ?? null;

  if (activeStage) {
    try {
      next = applyStageUpdate(next, activeStage, {
        state: 'failed',
        detail: appError.hint ?? null,
        error: appError.message,
      });
      // The event log has to describe the failure too, otherwise a client that
      // replays the stream reconstructs a stage list that disagrees with the
      // database - the last thing it heard about this stage was "processing".
      await emitVerificationEvent(verificationId, 'stage.updated', {
        stage: activeStage,
        state: 'failed',
        ...(appError.hint ? { detail: appError.hint } : {}),
        error: appError.message,
      }).catch(() => undefined);
    } catch {
      // The stage was already terminal; leave the recorded state alone.
    }
  }

  const skipReason = 'Skipped because an earlier stage failed.';
  const pendingBefore = next.filter((stage) => stage.state === 'pending').map((stage) => stage.id);
  next = skipRemaining(next, skipReason);

  for (const stageId of pendingBefore) {
    await emitVerificationEvent(verificationId, 'stage.updated', {
      stage: stageId,
      state: 'skipped',
      detail: skipReason,
    }).catch(() => undefined);
  }

  if (appError.code === ERROR_CODES.BLOCKCHAIN_SUBMIT_FAILED ||
      appError.code === ERROR_CODES.BLOCKCHAIN_CONFIRMATION_TIMEOUT ||
      appError.code === ERROR_CODES.BLOCKCHAIN_INSUFFICIENT_FUNDS ||
      appError.code === ERROR_CODES.BLOCKCHAIN_NOT_CONFIGURED ||
      appError.code === ERROR_CODES.DEMO_MODE_BLOCKED) {
    await recordBlockchainFailure(verificationId, appError.message).catch(() => undefined);
    await emitVerificationEvent(verificationId, 'blockchain.failed', {
      message: appError.message,
    }).catch(() => undefined);
  }

  await updateVerification(verificationId, {
    status: 'failed',
    error: appError.message,
    errorCode: appError.code,
    completedAt: new Date(),
    stages: next as unknown as Prisma.InputJsonValue,
  }).catch((updateError) => {
    logger.error({ err: updateError, verificationId }, 'Could not persist the failure state');
  });

  await emitVerificationEvent(verificationId, 'verification.failed', {
    message: appError.message,
    code: appError.code,
  }).catch(() => undefined);
}

async function recordBlockchainFailure(verificationId: string, message: string): Promise<void> {
  const record = await requireVerification(verificationId);
  if (!record.evidenceHash) return;

  await upsertBlockchainRecord(verificationId, {
    network: config.blockchain.network,
    chainId: config.blockchain.chainId,
    contractAddress: config.blockchain.contractAddress ?? '',
    transactionHash: record.blockchainRecord?.transactionHash ?? '',
    evidenceHash: record.evidenceHash,
    timestamp: new Date(),
    status: 'failed',
    error: message,
  });
}

function blockchainDtoOf(record: VerificationWithRelations) {
  const chain = record.blockchainRecord;
  if (!chain) {
    throw new AppError('Blockchain record disappeared mid-pipeline.', {
      code: ERROR_CODES.INTERNAL,
      statusCode: 500,
    });
  }
  return {
    network: chain.network,
    chainId: chain.chainId,
    contractAddress: chain.contractAddress,
    transactionHash: chain.transactionHash,
    blockNumber: chain.blockNumber !== null ? chain.blockNumber.toString() : null,
    evidenceHash: chain.evidenceHash,
    timestamp: chain.timestamp.toISOString(),
    explorerTxUrl: `${config.blockchain.explorerUrl}/tx/${chain.transactionHash}`,
    explorerContractUrl: `${config.blockchain.explorerUrl}/address/${chain.contractAddress}`,
    confirmations: chain.confirmations,
    gasUsed: chain.gasUsed,
    status: chain.status as 'submitting' | 'confirmed' | 'failed',
    error: chain.error,
  };
}

async function readOriginal(record: VerificationWithRelations): Promise<Buffer> {
  try {
    return await fs.readFile(record.storagePath);
  } catch (error) {
    throw new AppError('The uploaded image is no longer available on disk.', {
      code: ERROR_CODES.INVALID_IMAGE,
      statusCode: 410,
      stage: 'image_analysis',
      cause: error,
      hint: 'Temporary uploads are cleaned up periodically. Start a new verification.',
    });
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}
