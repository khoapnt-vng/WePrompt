/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceShotProjection } from '../workspaceProjection';

export const WORKSPACE_SHOT_STATUS_WORDS = ['notReady', 'ready', 'queued', 'rendering', 'rendered', 'failed'] as const;

export type WorkspaceShotStatusWord = (typeof WORKSPACE_SHOT_STATUS_WORDS)[number];

export type WorkspaceShotStatus = {
  word: WorkspaceShotStatusWord;
  stale: boolean;
  latestAttemptFailed: boolean;
};

export type WorkspaceShotStatusInput = Pick<
  WorkspaceShotProjection,
  | 'segmentState'
  | 'attentionJobs'
  | 'videoGenerationInFlight'
  | 'seedGenerationInFlight'
  | 'currentPicture'
  | 'dirtyCauses'
  | 'latestVideoAttemptFailed'
  | 'hasEffectiveSeed'
>;

const current = (word: WorkspaceShotStatusWord): WorkspaceShotStatus => ({
  word,
  stale: false,
  latestAttemptFailed: false,
});

/** One shared six-word Shot status with staleness carried only as a qualifier. */
export const deriveWorkspaceShotStatus = (
  shot: WorkspaceShotStatusInput,
  conditioningFailed: boolean
): WorkspaceShotStatus => {
  const stale =
    shot.segmentState.kind === 'stale' ||
    shot.segmentState.kind === 'needs_rerender' ||
    shot.dirtyCauses.includes('continuity_stale') ||
    shot.dirtyCauses.includes('generation_out_of_date');
  const rendered = (): WorkspaceShotStatus => ({
    word: 'rendered',
    stale,
    latestAttemptFailed: shot.latestVideoAttemptFailed,
  });
  if (conditioningFailed) return shot.currentPicture === null ? current('failed') : rendered();
  if (shot.segmentState.kind === 'rendering') return current('rendering');
  if (
    shot.segmentState.kind === 'queued' ||
    shot.segmentState.kind === 'waiting_on_shot' ||
    shot.segmentState.kind === 'waiting_on_frame'
  ) {
    return current('queued');
  }
  if (
    shot.segmentState.kind === 'never_dispatched' ||
    shot.segmentState.kind === 'failed_unbilled' ||
    shot.segmentState.kind === 'needs_attention' ||
    shot.attentionJobs.length > 0
  ) {
    return shot.currentPicture === null ? current('failed') : rendered();
  }
  if (shot.videoGenerationInFlight || shot.seedGenerationInFlight) return current('rendering');
  if (shot.currentPicture !== null) return rendered();
  if (stale) {
    return { word: 'rendered', stale: true, latestAttemptFailed: false };
  }
  return current(shot.hasEffectiveSeed ? 'ready' : 'notReady');
};
