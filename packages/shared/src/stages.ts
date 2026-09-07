import type { StageId, StageState, StageStatusDto } from './types';

export interface StageDefinition {
  id: StageId;
  /** Two digit ordinal shown in the pipeline UI. */
  ordinal: string;
  label: string;
  description: string;
}

export const PIPELINE_STAGES: StageDefinition[] = [
  {
    id: 'image_analysis',
    ordinal: '01',
    label: 'IMAGE ANALYSIS',
    description: 'Validate the upload, read its dimensions and fingerprint the exact bytes.',
  },
  {
    id: 'face_detection',
    ordinal: '02',
    label: 'FACE DETECTION',
    description: 'Locate faces and their bounding boxes with an SSD MobileNet V1 detector.',
  },
  {
    id: 'face_encoding',
    ordinal: '03',
    label: 'FACE ENCODING',
    description: 'Produce a 128-dimension embedding from the strongest detected face.',
  },
  {
    id: 'reverse_image_search',
    ordinal: '04',
    label: 'REVERSE IMAGE SEARCH',
    description: 'Query a live reverse-image-search provider for public occurrences of the image.',
  },
  {
    id: 'social_verification',
    ordinal: '05',
    label: 'SOCIAL MEDIA VERIFICATION',
    description: 'Download candidate images and compare them visually and facially.',
  },
  {
    id: 'evidence_generation',
    ordinal: '06',
    label: 'EVIDENCE GENERATION',
    description: 'Build the canonical evidence document and hash it with SHA-256.',
  },
  {
    id: 'blockchain_anchor',
    ordinal: '07',
    label: 'BLOCKCHAIN ANCHOR',
    description: 'Write the evidence hash to the FaceProof contract on Polygon Amoy.',
  },
  {
    id: 'complete',
    ordinal: '08',
    label: 'COMPLETE',
    description: 'The verification record is final and independently checkable.',
  },
];

export const STAGE_IDS: StageId[] = PIPELINE_STAGES.map((stage) => stage.id);

export function getStageDefinition(id: StageId): StageDefinition {
  const found = PIPELINE_STAGES.find((stage) => stage.id === id);
  if (!found) throw new Error(`Unknown pipeline stage: ${id}`);
  return found;
}

/**
 * Applies a stage state to a stage list, returning a new array.
 *
 * Unlike the API's state machine, this helper does not enforce transitions: the
 * client is a follower, and its job is to render whatever the backend reports,
 * not to second-guess it. Timestamps are filled in so a client that joins mid
 * run still shows a plausible timeline.
 */
export function applyStageState(
  stages: StageStatusDto[],
  stageId: StageId,
  update: { state: StageState; detail?: string | null; error?: string | null },
): StageStatusDto[] {
  const now = new Date().toISOString();

  return stages.map((stage) => {
    if (stage.id !== stageId) return stage;
    const terminal =
      update.state === 'completed' || update.state === 'failed' || update.state === 'skipped';

    return {
      ...stage,
      state: update.state,
      detail: update.detail !== undefined ? update.detail : stage.detail,
      error: update.error !== undefined ? update.error : stage.error,
      startedAt: stage.startedAt ?? (update.state === 'processing' ? now : stage.startedAt),
      completedAt: terminal ? (stage.completedAt ?? now) : stage.completedAt,
    };
  });
}
