import type {
  BlockchainRecord,
  Match,
  Prisma,
  Verification as VerificationRow,
} from '@prisma/client';
import type {
  BlockchainRecordDto,
  EvidenceDocument,
  FaceDetectionSummary,
  FaceEncodingSummary,
  ImageAnalysis,
  MatchAnalysis,
  ReverseSearchSummary,
  StageStatusDto,
  VerificationDto,
  VerificationStatus,
} from '@faceproof/shared';
import { config } from '../../config/env';
import { prisma } from '../../config/database';
import { AppError, ERROR_CODES } from '../../utils/errors';
import { initialStages } from './state';

export type VerificationWithRelations = VerificationRow & {
  match: Match | null;
  blockchainRecord: BlockchainRecord | null;
};

const INCLUDE = { match: true, blockchainRecord: true } as const;

export async function findVerification(id: string): Promise<VerificationWithRelations | null> {
  return prisma.verification.findUnique({ where: { id }, include: INCLUDE });
}

export async function requireVerification(id: string): Promise<VerificationWithRelations> {
  const record = await findVerification(id);
  if (!record) {
    throw new AppError(`No verification exists with id "${id}".`, {
      code: ERROR_CODES.NOT_FOUND,
      statusCode: 404,
    });
  }
  return record;
}

export interface CreateVerificationInput {
  filename: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  inputImageHash: string;
  perceptualHash: string;
  storagePath: string;
}

export async function createVerification(
  input: CreateVerificationInput,
): Promise<VerificationWithRelations> {
  return prisma.verification.create({
    data: {
      ...input,
      status: 'pending',
      demo: config.demoMode,
      stages: initialStages() as unknown as Prisma.InputJsonValue,
    },
    include: INCLUDE,
  });
}

export async function updateVerification(
  id: string,
  data: Prisma.VerificationUpdateInput,
): Promise<VerificationWithRelations> {
  return prisma.verification.update({ where: { id }, data, include: INCLUDE });
}

export async function upsertMatch(
  verificationId: string,
  analysis: MatchAnalysis,
): Promise<void> {
  const best = analysis.bestMatch;

  const payload = {
    platform: best?.platform ?? null,
    handle: best?.handle ?? null,
    postUrl: best?.sourceUrl ?? null,
    imageUrl: best?.imageUrl ?? null,
    title: best?.title ?? null,
    domain: best?.domain ?? null,
    visualSimilarity: best?.visualSimilarity ?? null,
    faceSimilarity: best?.faceSimilarity ?? null,
    confidence: best ? analysis.confidence : null,
    evidenceStrength: analysis.evidenceStrength,
    matchReasons: best?.matchReasons ?? [],
    candidatesAnalysed: analysis.candidatesAnalysed,
  };

  await prisma.match.upsert({
    where: { verificationId },
    create: { verificationId, ...payload },
    update: payload,
  });
}

export interface BlockchainRecordInput {
  network: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  evidenceHash: string;
  timestamp: Date;
  blockNumber?: bigint | null;
  confirmations?: number | null;
  gasUsed?: string | null;
  status: 'submitting' | 'confirmed' | 'failed';
  error?: string | null;
}

export async function upsertBlockchainRecord(
  verificationId: string,
  input: BlockchainRecordInput,
): Promise<void> {
  const payload = {
    network: input.network,
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    transactionHash: input.transactionHash,
    evidenceHash: input.evidenceHash,
    timestamp: input.timestamp,
    blockNumber: input.blockNumber ?? null,
    confirmations: input.confirmations ?? null,
    gasUsed: input.gasUsed ?? null,
    status: input.status,
    error: input.error ?? null,
  };

  await prisma.blockchainRecord.upsert({
    where: { verificationId },
    create: { verificationId, ...payload },
    update: payload,
  });
}

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

function asJson<T>(value: Prisma.JsonValue | null): T | null {
  return value === null || value === undefined ? null : (value as unknown as T);
}

export function toImageAnalysis(record: VerificationRow): ImageAnalysis {
  return {
    filename: record.filename,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    sha256: record.inputImageHash,
    perceptualHash: record.perceptualHash,
  };
}

export function toBlockchainDto(record: BlockchainRecord | null): BlockchainRecordDto | null {
  if (!record) return null;
  return {
    network: record.network,
    chainId: record.chainId,
    contractAddress: record.contractAddress,
    transactionHash: record.transactionHash,
    blockNumber: record.blockNumber !== null ? record.blockNumber.toString() : null,
    evidenceHash: record.evidenceHash,
    timestamp: record.timestamp.toISOString(),
    explorerTxUrl: config.blockchain.explorerUrl
      ? `${config.blockchain.explorerUrl}/tx/${record.transactionHash}`
      : null,
    explorerContractUrl: config.blockchain.explorerUrl
      ? `${config.blockchain.explorerUrl}/address/${record.contractAddress}`
      : null,
    confirmations: record.confirmations,
    gasUsed: record.gasUsed,
    status: record.status as BlockchainRecordDto['status'],
    error: record.error,
  };
}

export function toDto(record: VerificationWithRelations): VerificationDto {
  const stages = asJson<StageStatusDto[]>(record.stages) ?? initialStages();

  return {
    id: record.id,
    status: record.status as VerificationStatus,
    demo: record.demo,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    error: record.error,
    errorCode: record.errorCode,
    image: toImageAnalysis(record),
    imageUrl: `/api/v1/verifications/${record.id}/image`,
    stages,
    face: asJson<FaceDetectionSummary>(record.faceData),
    encoding: asJson<FaceEncodingSummary>(record.encodingData),
    reverseSearch: asJson<ReverseSearchSummary>(record.reverseSearchData),
    match: asJson<MatchAnalysis>(record.matchData),
    evidence: asJson<EvidenceDocument>(record.evidence),
    evidenceHash: record.evidenceHash,
    blockchain: toBlockchainDto(record.blockchainRecord),
  };
}

export async function getVerificationDto(id: string): Promise<VerificationDto> {
  return toDto(await requireVerification(id));
}
