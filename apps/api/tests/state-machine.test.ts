import { describe, expect, it } from 'vitest';
import { STAGE_IDS, type StageStatusDto } from '@faceproof/shared';
import {
  StageTransitionError,
  applyStageUpdate,
  getStage,
  initialStages,
  isPipelineFinished,
  skipRemaining,
} from '../src/modules/verification/state';

const stageOf = (stages: StageStatusDto[], id: string) =>
  stages.find((stage) => stage.id === id) as StageStatusDto;

describe('initialStages', () => {
  it('creates one pending entry per declared pipeline stage, in order', () => {
    const stages = initialStages();
    expect(stages.map((stage) => stage.id)).toEqual(STAGE_IDS);
    expect(stages.every((stage) => stage.state === 'pending')).toBe(true);
    expect(stages.every((stage) => stage.startedAt === null)).toBe(true);
  });
});

describe('applyStageUpdate', () => {
  it('records a start timestamp when a stage begins processing', () => {
    const stages = applyStageUpdate(initialStages(), 'image_analysis', { state: 'processing' });
    const stage = stageOf(stages, 'image_analysis');
    expect(stage.state).toBe('processing');
    expect(stage.startedAt).toBeTruthy();
    expect(stage.completedAt).toBeNull();
  });

  it('records a completion timestamp and detail when a stage finishes', () => {
    let stages = applyStageUpdate(initialStages(), 'face_detection', { state: 'processing' });
    stages = applyStageUpdate(stages, 'face_detection', {
      state: 'completed',
      detail: '1 face found',
    });
    const stage = stageOf(stages, 'face_detection');
    expect(stage.state).toBe('completed');
    expect(stage.detail).toBe('1 face found');
    expect(stage.completedAt).toBeTruthy();
  });

  it('does not mutate the input array', () => {
    const original = initialStages();
    const snapshot = JSON.stringify(original);
    applyStageUpdate(original, 'image_analysis', { state: 'processing' });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('leaves other stages untouched', () => {
    const stages = applyStageUpdate(initialStages(), 'face_encoding', { state: 'processing' });
    expect(stageOf(stages, 'face_detection').state).toBe('pending');
    expect(stageOf(stages, 'blockchain_anchor').state).toBe('pending');
  });

  it('rejects completing a stage that never started', () => {
    expect(() => applyStageUpdate(initialStages(), 'complete', { state: 'completed' })).toThrow(
      StageTransitionError,
    );
  });

  it('rejects reopening a terminal stage', () => {
    let stages = applyStageUpdate(initialStages(), 'image_analysis', { state: 'processing' });
    stages = applyStageUpdate(stages, 'image_analysis', { state: 'completed' });
    expect(() => applyStageUpdate(stages, 'image_analysis', { state: 'processing' })).toThrow(
      StageTransitionError,
    );
    expect(() => applyStageUpdate(stages, 'image_analysis', { state: 'failed' })).toThrow(
      StageTransitionError,
    );
  });

  it('treats a repeated state as an idempotent detail update', () => {
    let stages = applyStageUpdate(initialStages(), 'reverse_image_search', { state: 'processing' });
    const startedAt = stageOf(stages, 'reverse_image_search').startedAt;

    stages = applyStageUpdate(stages, 'reverse_image_search', {
      state: 'processing',
      detail: 'Querying provider',
    });

    const stage = stageOf(stages, 'reverse_image_search');
    expect(stage.startedAt).toBe(startedAt);
    expect(stage.detail).toBe('Querying provider');
  });

  it('allows a pending stage to fail directly, which is what an early abort does', () => {
    const stages = applyStageUpdate(initialStages(), 'blockchain_anchor', {
      state: 'failed',
      error: 'Wallet not funded',
    });
    expect(stageOf(stages, 'blockchain_anchor').state).toBe('failed');
    expect(stageOf(stages, 'blockchain_anchor').error).toBe('Wallet not funded');
  });

  it('clears a previous error when a stage transitions successfully', () => {
    let stages = applyStageUpdate(initialStages(), 'social_verification', {
      state: 'processing',
      error: 'transient',
    });
    stages = applyStageUpdate(stages, 'social_verification', { state: 'completed' });
    expect(stageOf(stages, 'social_verification').error).toBeNull();
  });
});

describe('skipRemaining', () => {
  it('marks only pending stages as skipped', () => {
    let stages = applyStageUpdate(initialStages(), 'image_analysis', { state: 'processing' });
    stages = applyStageUpdate(stages, 'image_analysis', { state: 'completed' });
    stages = applyStageUpdate(stages, 'face_detection', { state: 'processing' });
    stages = applyStageUpdate(stages, 'face_detection', { state: 'failed', error: 'No face' });

    const skipped = skipRemaining(stages, 'Skipped because an earlier stage failed.');

    expect(stageOf(skipped, 'image_analysis').state).toBe('completed');
    expect(stageOf(skipped, 'face_detection').state).toBe('failed');
    expect(stageOf(skipped, 'face_encoding').state).toBe('skipped');
    expect(stageOf(skipped, 'blockchain_anchor').state).toBe('skipped');
    expect(stageOf(skipped, 'complete').detail).toMatch(/earlier stage failed/);
  });

  it('produces a finished pipeline', () => {
    expect(isPipelineFinished(initialStages())).toBe(false);
    expect(isPipelineFinished(skipRemaining(initialStages(), 'aborted'))).toBe(true);
  });
});

describe('a full successful run', () => {
  it('walks every stage from pending to completed', () => {
    let stages = initialStages();
    for (const id of STAGE_IDS) {
      stages = applyStageUpdate(stages, id, { state: 'processing' });
      stages = applyStageUpdate(stages, id, { state: 'completed', detail: `${id} ok` });
    }

    expect(stages.every((stage) => stage.state === 'completed')).toBe(true);
    expect(isPipelineFinished(stages)).toBe(true);
    expect(getStage(stages, 'complete')?.detail).toBe('complete ok');
  });
});
