import { STAGE_IDS, type StageId, type StageState, type StageStatusDto } from '@faceproof/shared';

/**
 * Pipeline stage state machine.
 *
 * The frontend renders exactly what this produces, so the rules are enforced
 * here rather than in the UI: a stage cannot complete without having started,
 * and a terminal stage cannot be reopened. That is what keeps the live pipeline
 * an honest reflection of the backend instead of a decorative animation.
 */
const ALLOWED_TRANSITIONS: Record<StageState, StageState[]> = {
  pending: ['processing', 'skipped', 'failed'],
  processing: ['completed', 'failed', 'skipped'],
  completed: [],
  failed: [],
  skipped: [],
};

export class StageTransitionError extends Error {
  constructor(stage: StageId, from: StageState, to: StageState) {
    super(`Invalid stage transition for ${stage}: ${from} -> ${to}.`);
    this.name = 'StageTransitionError';
  }
}

export function initialStages(): StageStatusDto[] {
  return STAGE_IDS.map((id) => ({
    id,
    state: 'pending',
    detail: null,
    startedAt: null,
    completedAt: null,
    error: null,
  }));
}

export function isTerminalState(state: StageState): boolean {
  return state === 'completed' || state === 'failed' || state === 'skipped';
}

export interface StageUpdate {
  state: StageState;
  detail?: string | null;
  error?: string | null;
}

/**
 * Returns a new stage array with one stage updated.
 * Re-applying the same state is a no-op so retries and duplicate progress
 * callbacks cannot corrupt the timeline.
 */
export function applyStageUpdate(
  stages: StageStatusDto[],
  stageId: StageId,
  update: StageUpdate,
): StageStatusDto[] {
  const now = new Date().toISOString();

  return stages.map((stage) => {
    if (stage.id !== stageId) return stage;

    if (stage.state === update.state) {
      return {
        ...stage,
        detail: update.detail !== undefined ? update.detail : stage.detail,
        error: update.error !== undefined ? update.error : stage.error,
      };
    }

    const allowed = ALLOWED_TRANSITIONS[stage.state];
    if (!allowed.includes(update.state)) {
      throw new StageTransitionError(stageId, stage.state, update.state);
    }

    return {
      ...stage,
      state: update.state,
      detail: update.detail !== undefined ? update.detail : stage.detail,
      error: update.error !== undefined ? update.error : null,
      startedAt: update.state === 'processing' ? now : stage.startedAt,
      completedAt: isTerminalState(update.state) ? now : stage.completedAt,
    };
  });
}

/**
 * Marks every stage that never started as skipped. Called when the pipeline
 * aborts, so the UI shows "skipped" rather than leaving stages spinning.
 */
export function skipRemaining(stages: StageStatusDto[], reason: string): StageStatusDto[] {
  const now = new Date().toISOString();
  return stages.map((stage) =>
    stage.state === 'pending'
      ? { ...stage, state: 'skipped' as const, detail: reason, completedAt: now }
      : stage,
  );
}

export function getStage(stages: StageStatusDto[], stageId: StageId): StageStatusDto | undefined {
  return stages.find((stage) => stage.id === stageId);
}

/** True when every stage has reached a terminal state. */
export function isPipelineFinished(stages: StageStatusDto[]): boolean {
  return stages.every((stage) => isTerminalState(stage.state));
}
