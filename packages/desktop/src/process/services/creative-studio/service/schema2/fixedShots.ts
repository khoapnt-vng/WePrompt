/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioFixedShotReasonV2,
  StudioJobV2,
  StudioProjectV2,
  StudioShot,
} from '@/common/types/project/creativeStudioTypes';

/** Canonical precedence shared by reducer validation, Director input, and storyboard reads. */
export const STUDIO_FIXED_SHOT_REASON_ORDER_V2 = [
  'owned_asset',
  'owned_job',
  'video_asset',
  'seed_still',
  'conditioning_frame',
  'conditioning_input',
  'shooting_script',
] as const satisfies readonly StudioFixedShotReasonV2[];

const own = <Value>(record: Record<string, Value>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

/** Exact Shot-dependency predicate shared with mutations that must fence conditioning consumers. */
export const studioJobReferencesShotV2 = (project: StudioProjectV2, job: StudioJobV2, shotId: string): boolean => {
  if (job.requestPlan.kind === 'after_take_selection') {
    const dependency = job.requestPlan.dependency;
    if (
      (dependency.kind === 'authorized_seed' && dependency.shotId === shotId) ||
      (dependency.kind !== 'authorized_seed' && dependency.predecessorShotId === shotId)
    ) {
      return true;
    }
  }
  const input = job.requestSnapshot?.conditioningInput;
  if (input?.kind === 'predecessor_frame' && input.predecessorShotId === shotId) return true;
  if (input?.kind === 'seed_still') return own(project.assets, input.assetId)?.shotId === shotId;
  return false;
};

/** Exact reducer-owned fixedness for one validated Shot, returned in canonical precedence. */
export const deriveStudioFixedShotReasonsV2 = (
  project: StudioProjectV2,
  shot: StudioShot
): StudioFixedShotReasonV2[] => {
  const present = new Set<StudioFixedShotReasonV2>();
  if (shot.assetIds.length > 0) present.add('owned_asset');
  if (shot.jobIds.length > 0) present.add('owned_job');
  if (shot.videoAssetId !== null) present.add('video_asset');
  if (shot.seedStillId !== null) present.add('seed_still');
  if (Object.values(project.frameExtractions).some((frame) => frame.shotId === shot.id)) {
    present.add('conditioning_frame');
  }
  if (Object.values(project.jobs).some((job) => studioJobReferencesShotV2(project, job, shot.id))) {
    present.add('conditioning_input');
  }
  if (shot.shootingScript.length > 0) present.add('shooting_script');
  return STUDIO_FIXED_SHOT_REASON_ORDER_V2.filter((reason) => present.has(reason));
};
