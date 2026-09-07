/**
 * Core domain types shared by the FaceProof API and web client.
 *
 * IMPORTANT: nothing in this package may import a Node built-in — the web app
 * bundles these modules into the browser.
 */

/** Lifecycle of a verification job. */
export type VerificationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_no_match'
  | 'failed';

/** Per-stage state rendered by the live pipeline UI. */
export type StageState = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export type StageId =
  | 'image_analysis'
  | 'face_detection'
  | 'face_encoding'
  | 'reverse_image_search'
  | 'social_verification'
  | 'evidence_generation'
  | 'blockchain_anchor'
  | 'complete';

/** Evidence strength buckets derived from the combined confidence score. */
export type EvidenceStrength = 'HIGH' | 'MODERATE' | 'LOW' | 'INSUFFICIENT';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  /** Index of the face in detection order (highest score first). */
  index: number;
  /** Detector confidence in [0,1]. */
  score: number;
  /** Bounding box in *pixels* of the original image. */
  box: BoundingBox;
  /** Bounding box expressed as fractions of image width/height, for overlays. */
  relativeBox: BoundingBox;
  /** Number of landmark points the model produced (0 when unavailable). */
  landmarkCount: number;
}

export interface FaceDetectionSummary {
  faceDetected: boolean;
  faceCount: number;
  faces: DetectedFace[];
  /** Identifier of the detector that produced this result. */
  detector: string;
  /** Wall-clock duration of the detection pass, milliseconds. */
  durationMs: number;
}

export interface FaceEncodingSummary {
  /** Length of the produced embedding vector. */
  dimensions: number;
  /** Identifier of the embedding model. */
  model: string;
  /** True when the embedding vector is L2-normalised. */
  normalized: boolean;
  durationMs: number;
}

export interface ImageAnalysis {
  filename: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  /** SHA-256 of the exact uploaded bytes, lowercase hex. */
  sha256: string;
  /** 64-bit perceptual hash (DCT based), lowercase hex. */
  perceptualHash: string;
}

/** Normalised result returned by every reverse-image-search provider. */
export interface ReverseSearchResult {
  title?: string;
  sourceUrl: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  domain?: string;
  platform?: string;
  /** Similarity as reported by the provider itself, when it exposes one. */
  similarity?: number;
}

export interface ReverseSearchSummary {
  provider: string;
  query: 'image_url' | 'image_upload';
  totalResults: number;
  socialResults: number;
  durationMs: number;
  results: ReverseSearchResult[];
  /** Present when the provider succeeded but returned nothing. */
  note?: string;
}

/** A reverse-search candidate after it has actually been fetched and compared. */
export interface AnalysedCandidate {
  sourceUrl: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  domain?: string;
  platform?: string;
  handle?: string;
  /** True when the candidate image was successfully downloaded and decoded. */
  imageFetched: boolean;
  /** Reason the candidate image could not be analysed, when applicable. */
  unavailableReason?: string;
  /** Perceptual-hash similarity in [0,1]. Undefined when the image was unreachable. */
  visualSimilarity?: number;
  /** Colour-signature similarity in [0,1]; a secondary ranking signal. */
  colorSimilarity?: number;
  /**
   * Calibrated face similarity in [0,1] where 0.5 is the standard decision
   * boundary of the embedding model. Undefined when either image had no face.
   */
  faceSimilarity?: number;
  /** Raw cosine similarity of the two unit-length embeddings, in [-1,1]. */
  faceCosine?: number;
  /** True when at least one face was detected in the candidate image. */
  candidateFaceDetected: boolean;
  /** Weighted combination of all available signals, in [0,1]. */
  confidence: number;
  matchReasons: string[];
  warnings: string[];
}

export interface MatchAnalysis {
  bestMatch: AnalysedCandidate | null;
  confidence: number;
  evidenceStrength: EvidenceStrength;
  threshold: number;
  candidatesAnalysed: number;
  candidatesConsidered: number;
  candidates: AnalysedCandidate[];
  matchReasons: string[];
  /** Human readable explanation shown when no candidate cleared the threshold. */
  rejectionReason?: string;
}

/**
 * Canonical evidence document. This exact shape (after canonicalisation) is
 * what gets SHA-256'd and anchored on chain — changing it changes every hash,
 * hence `pipelineVersion`.
 */
export interface EvidenceDocument {
  pipelineVersion: string;
  verificationId: string;
  verifiedAt: string;
  inputImageHash: string;
  inputImagePerceptualHash: string;
  inputImageBytes: number;
  inputImageWidth: number;
  inputImageHeight: number;
  faceDetected: boolean;
  faceCount: number;
  faceDetector: string;
  faceEmbeddingModel: string;
  faceEmbeddingDimensions: number;
  reverseSearchProvider: string;
  reverseSearchResultCount: number;
  matchFound: boolean;
  matchedPlatform: string | null;
  matchedPostUrl: string | null;
  matchedImageUrl: string | null;
  visualSimilarity: number | null;
  faceSimilarity: number | null;
  confidence: number | null;
  evidenceStrength: EvidenceStrength;
  matchReasons: string[];
}

export interface BlockchainRecordDto {
  network: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string | null;
  evidenceHash: string;
  timestamp: string;
  /** Null on networks with no block explorer, e.g. a local dev chain. */
  explorerTxUrl: string | null;
  explorerContractUrl: string | null;
  confirmations: number | null;
  gasUsed: string | null;
  status: 'submitting' | 'confirmed' | 'failed';
  error?: string | null;
}

export interface StageStatusDto {
  id: StageId;
  state: StageState;
  detail?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface VerificationDto {
  id: string;
  status: VerificationStatus;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  errorCode: string | null;
  image: ImageAnalysis;
  /** URL on the API that serves the original upload back for display. */
  imageUrl: string;
  stages: StageStatusDto[];
  face: FaceDetectionSummary | null;
  encoding: FaceEncodingSummary | null;
  reverseSearch: ReverseSearchSummary | null;
  match: MatchAnalysis | null;
  evidence: EvidenceDocument | null;
  evidenceHash: string | null;
  blockchain: BlockchainRecordDto | null;
}

/** Result of the independent re-verification endpoint. */
export interface VerificationProofCheck {
  verificationId: string;
  evidenceHashStored: string;
  evidenceHashRecomputed: string;
  evidenceHashMatches: boolean;
  onChainFound: boolean;
  onChainEvidenceHash: string | null;
  onChainPlatform: string | null;
  onChainPostUrl: string | null;
  onChainTimestamp: string | null;
  onChainVerifier: string | null;
  onChainMatches: boolean;
  transactionHash: string | null;
  explorerTxUrl: string | null;
  verdict: 'VALID' | 'TAMPERED' | 'NOT_ANCHORED' | 'UNVERIFIABLE';
  checkedAt: string;
  notes: string[];
}
