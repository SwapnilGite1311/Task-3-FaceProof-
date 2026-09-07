import type {
  BlockchainRecordDto,
  EvidenceDocument,
  FaceDetectionSummary,
  FaceEncodingSummary,
  ImageAnalysis,
  MatchAnalysis,
  ReverseSearchSummary,
  StageId,
  StageState,
  VerificationStatus,
} from './types';

/** Every event name the API may push over the SSE stream. */
export const VERIFICATION_EVENTS = [
  'verification.created',
  'image.analyzed',
  'face.detecting',
  'face.detected',
  'face.not-detected',
  'face.encoding',
  'face.encoded',
  'reverse-search.started',
  'reverse-search.progress',
  'reverse-search.completed',
  'reverse-search.failed',
  'match.analyzing',
  'match.found',
  'match.not-found',
  'evidence.created',
  'evidence.hashed',
  'blockchain.submitting',
  'blockchain.confirmed',
  'blockchain.failed',
  'verification.completed',
  'verification.failed',
  'stage.updated',
] as const;

export type VerificationEventName = (typeof VERIFICATION_EVENTS)[number];

export interface VerificationEventPayloads {
  'verification.created': { verificationId: string };
  'image.analyzed': { image: ImageAnalysis };
  'face.detecting': Record<string, never>;
  'face.detected': { face: FaceDetectionSummary };
  'face.not-detected': { message: string };
  'face.encoding': Record<string, never>;
  'face.encoded': { encoding: FaceEncodingSummary };
  'reverse-search.started': { provider: string; query: string };
  'reverse-search.progress': { message: string; completed?: number; total?: number };
  'reverse-search.completed': { search: ReverseSearchSummary };
  'reverse-search.failed': { message: string };
  'match.analyzing': { message: string; completed?: number; total?: number };
  'match.found': { match: MatchAnalysis };
  'match.not-found': { match: MatchAnalysis };
  'evidence.created': { evidence: EvidenceDocument };
  'evidence.hashed': { evidenceHash: string };
  'blockchain.submitting': { network: string; contractAddress: string; transactionHash?: string };
  'blockchain.confirmed': { blockchain: BlockchainRecordDto };
  'blockchain.failed': { message: string };
  'verification.completed': { status: VerificationStatus };
  'verification.failed': { message: string; code: string };
  'stage.updated': { stage: StageId; state: StageState; detail?: string; error?: string };
}

export interface VerificationEvent<
  N extends VerificationEventName = VerificationEventName,
> {
  /** Monotonic per-verification sequence number, used for SSE replay. */
  seq: number;
  name: N;
  verificationId: string;
  at: string;
  data: VerificationEventPayloads[N];
}

export type AnyVerificationEvent = {
  [N in VerificationEventName]: VerificationEvent<N>;
}[VerificationEventName];
