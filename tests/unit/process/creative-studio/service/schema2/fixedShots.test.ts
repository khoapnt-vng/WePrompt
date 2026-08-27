/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioAssetV2,
  StudioGenerationRequestPlan,
  StudioGenerationRequestSnapshot,
  StudioJobV2,
  StudioProjectV2,
  StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  deriveStudioFixedShotReasonsV2,
  studioJobReferencesShotV2,
} from '@/process/services/creative-studio/service/schema2/fixedShots';

const NOW = '2026-08-28T00:00:00.000Z';

const project = (): StudioProjectV2 =>
  createEmptyStudioProjectV2(
    {
      name: 'Fixed Shot audit',
      brief: 'Test fixed Shot reasons.',
      aspectRatio: '16:9',
      targetDurationSeconds: 20,
      resolution: '1080p',
    },
    'project_fixed',
    NOW
  );

const shot = (id = 'shot_1'): StudioShot => ({
  id,
  shootingScript: '',
  durationSeconds: 4,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
});

const requestPlanJob = (
  id: string,
  requestPlan: StudioGenerationRequestPlan,
  requestSnapshot: StudioGenerationRequestSnapshot | null = null
): StudioJobV2 => ({ id, requestPlan, requestSnapshot }) as StudioJobV2;

const template = {
  composition: null as never,
  aspectRatio: '16:9' as const,
  resolution: '1080p' as const,
  durationSeconds: 4,
  referenceInputs: [],
};

const snapshot = (conditioningInput: StudioGenerationRequestSnapshot['conditioningInput']) =>
  ({
    ...template,
    conditioningInput,
  }) as StudioGenerationRequestSnapshot;

describe('schema-5 fixed Shot reasons', () => {
  it('returns no reason for a fresh Shot and all seven reasons in canonical precedence', () => {
    const value = project();
    const current = shot();
    expect(deriveStudioFixedShotReasonsV2(value, current)).toEqual([]);

    current.assetIds = ['asset_owned'];
    current.jobIds = ['job_owned'];
    current.videoAssetId = 'asset_video';
    current.seedStillId = 'asset_seed';
    current.shootingScript = 'Existing authored work.';
    value.frameExtractions.frame_1 = { shotId: current.id } as never;
    value.jobs.job_conditioning = requestPlanJob('job_conditioning', {
      kind: 'after_take_selection',
      template,
      dependency: { kind: 'authorized_seed', upstreamItemId: 'item_1', shotId: current.id },
    });

    expect(deriveStudioFixedShotReasonsV2(value, current)).toEqual([
      'owned_asset',
      'owned_job',
      'video_asset',
      'seed_still',
      'conditioning_frame',
      'conditioning_input',
      'shooting_script',
    ]);
  });

  it('recognizes authorized-seed and both predecessor after-take dependencies', () => {
    const value = project();
    const target = shot();
    const plans: StudioGenerationRequestPlan[] = [
      {
        kind: 'after_take_selection',
        template,
        dependency: { kind: 'authorized_seed', upstreamItemId: 'seed_item', shotId: target.id },
      },
      {
        kind: 'after_take_selection',
        template,
        dependency: {
          kind: 'authorized_predecessor',
          upstreamItemId: 'take_item',
          predecessorShotId: target.id,
        },
      },
      {
        kind: 'after_take_selection',
        template,
        dependency: {
          kind: 'existing_predecessor',
          predecessorShotId: target.id,
          takeAssetId: 'take_1',
          endpointSeconds: 4,
        },
      },
    ];

    plans.forEach((plan, index) => {
      expect(studioJobReferencesShotV2(value, requestPlanJob(`job_${index}`, plan), target.id)).toBe(true);
    });
  });

  it('recognizes predecessor-frame and seed-still request snapshots', () => {
    const value = project();
    const target = shot();
    value.assets.seed_1 = { id: 'seed_1', shotId: target.id } as StudioAssetV2;
    const predecessor = requestPlanJob(
      'job_predecessor',
      { kind: 'resolved', snapshot: snapshot({ kind: 'predecessor_frame', predecessorShotId: target.id }) },
      snapshot({ kind: 'predecessor_frame', predecessorShotId: target.id })
    );
    const seed = requestPlanJob(
      'job_seed',
      { kind: 'resolved', snapshot: snapshot({ kind: 'seed_still', assetId: 'seed_1' }) },
      snapshot({ kind: 'seed_still', assetId: 'seed_1' })
    );

    expect(studioJobReferencesShotV2(value, predecessor, target.id)).toBe(true);
    expect(studioJobReferencesShotV2(value, seed, target.id)).toBe(true);
  });

  it('fails closed for unrelated dependencies and missing or unrelated seed assets', () => {
    const value = project();
    const target = shot();
    value.assets.other_seed = { id: 'other_seed', shotId: 'shot_other' } as StudioAssetV2;
    const jobs = [
      requestPlanJob('resolved', { kind: 'resolved', snapshot: snapshot(null) }, snapshot(null)),
      requestPlanJob('authorized_other', {
        kind: 'after_take_selection',
        template,
        dependency: { kind: 'authorized_seed', upstreamItemId: 'seed_item', shotId: 'shot_other' },
      }),
      requestPlanJob(
        'predecessor_other',
        { kind: 'resolved', snapshot: snapshot({ kind: 'predecessor_frame', predecessorShotId: 'shot_other' }) },
        snapshot({ kind: 'predecessor_frame', predecessorShotId: 'shot_other' })
      ),
      requestPlanJob(
        'seed_missing',
        { kind: 'resolved', snapshot: snapshot({ kind: 'seed_still', assetId: 'missing_seed' }) },
        snapshot({ kind: 'seed_still', assetId: 'missing_seed' })
      ),
      requestPlanJob(
        'seed_other',
        { kind: 'resolved', snapshot: snapshot({ kind: 'seed_still', assetId: 'other_seed' }) },
        snapshot({ kind: 'seed_still', assetId: 'other_seed' })
      ),
    ];

    jobs.forEach((job) => expect(studioJobReferencesShotV2(value, job, target.id)).toBe(false));
  });
});
