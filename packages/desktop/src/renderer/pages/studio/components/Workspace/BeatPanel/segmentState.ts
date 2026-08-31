/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioCascadeProgressV2,
  StudioRendererChainBoundaryV2,
  StudioRendererDirtyShotV2,
  StudioRendererJobV2,
} from '@/common/types/project/creativeStudioTypes';

export type WorkspaceShotSegmentState =
  | { kind: 'status_pending' }
  | { kind: 'no_picture' }
  | { kind: 'queued' }
  | { kind: 'waiting_on_shot'; upstreamShotNumber: number }
  | { kind: 'waiting_on_frame' }
  | { kind: 'rendering'; progressPercent: number | null; showingStill: boolean }
  | { kind: 'rendered' }
  | { kind: 'needs_rerender' }
  | { kind: 'stale' }
  | { kind: 'failed_unbilled' }
  | { kind: 'never_dispatched' }
  | { kind: 'needs_attention' };

type SegmentStateJob = Pick<
  StudioRendererJobV2,
  'id' | 'status' | 'progress' | 'spendReceipt' | 'outputAssetIds' | 'outputAssetIdsByRole'
>;

export type WorkspaceShotSegmentStateInput = {
  statusReady: boolean;
  cascade: StudioCascadeProgressV2 | null;
  upstreamShotNumber: number | null;
  conditioningFailed: boolean;
  expectsFrameBoundary: boolean;
  frameBoundary: StudioRendererChainBoundaryV2 | null;
  currentVideoJobs: readonly SegmentStateJob[] | null;
  dirtyCauses: readonly StudioRendererDirtyShotV2['causes'][number][];
  hasCurrentPicture: boolean;
};

const progressFromOneRunningJob = (jobs: readonly SegmentStateJob[]): number | null => {
  const running = jobs.filter((job) => job.status === 'running');
  if (running.length !== 1) return null;
  const progress = running[0]!.progress;
  return typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100
    ? progress
    : null;
};

/** Derives one honest coverage-segment state from revision-matched, current-wave facts only. */
export const deriveWorkspaceShotSegmentState = (input: WorkspaceShotSegmentStateInput): WorkspaceShotSegmentState => {
  if (!input.statusReady || input.currentVideoJobs === null) return { kind: 'status_pending' };
  if (input.cascade !== null && input.currentVideoJobs.length === 0) return { kind: 'status_pending' };

  switch (input.cascade?.waitingReason) {
    case 'conditioning_failed':
    case 'dependency_failed':
    case 'cancelled':
      return { kind: 'never_dispatched' };
    case 'choose_seed':
      return { kind: 'needs_attention' };
    case 'conditioning_frame':
      return { kind: 'waiting_on_frame' };
    case 'upstream_running':
      return input.upstreamShotNumber === null
        ? { kind: 'queued' }
        : { kind: 'waiting_on_shot', upstreamShotNumber: input.upstreamShotNumber };
    case undefined:
      break;
  }

  if (input.conditioningFailed) return { kind: 'never_dispatched' };
  if (input.currentVideoJobs.some((job) => job.status === 'running')) {
    return {
      kind: 'rendering',
      progressPercent: progressFromOneRunningJob(input.currentVideoJobs),
      showingStill: false,
    };
  }
  const waitsForConditioning = input.currentVideoJobs.some((job) => job.status === 'waiting_for_conditioning');
  if (waitsForConditioning && input.expectsFrameBoundary) {
    if (input.frameBoundary === null) return { kind: 'status_pending' };
    if (input.frameBoundary.status !== 'on_disk') return { kind: 'waiting_on_frame' };
  }
  if (
    input.currentVideoJobs.some(
      (job) =>
        job.status === 'waiting_for_conditioning' ||
        job.status === 'queued_local' ||
        job.status === 'submitting' ||
        job.status === 'queued_remote'
    )
  ) {
    return { kind: 'queued' };
  }

  if (input.currentVideoJobs.some((job) => job.status === 'needs_attention')) return { kind: 'needs_attention' };

  const failed = input.currentVideoJobs.filter((job) => job.status === 'failed');
  if (failed.some((job) => job.spendReceipt !== null)) return { kind: 'needs_attention' };
  if (failed.length > 0) return { kind: 'failed_unbilled' };

  if (input.dirtyCauses.includes('continuity_stale')) return { kind: 'stale' };
  if (input.dirtyCauses.includes('generation_out_of_date')) return { kind: 'needs_rerender' };
  if (input.hasCurrentPicture) return { kind: 'rendered' };
  return { kind: 'no_picture' };
};
