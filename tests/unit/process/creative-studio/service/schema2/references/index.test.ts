/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioJobV2,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  approveStudioProjectReferenceV2,
  StudioProjectReferenceApprovalErrorV2,
} from '@/process/services/creative-studio/service/schema2/references';

const CREATED_AT = '2026-08-17T00:00:00.000Z';
const APPROVED_AT = '2026-08-17T00:00:01.000Z';
const DIGEST = 'a'.repeat(64);

const makeAsset = (id: string): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId: 'shot_1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 1,
  sha256: DIGEST,
  referenceAssetIds: [],
  createdAt: CREATED_AT,
});

const makeJob = (
  id: string,
  status: StudioJobV2['status'],
  referenceInputs: StudioGenerationReferenceInputSnapshot[] = []
): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId: 'shot_1',
  status,
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
  idempotencyKey: `idempotency_${id}`,
  providerJobId: status === 'succeeded' ? `remote_${id}` : null,
  cancellationPolicy: 'queued_and_running',
  outputAssetIds: status === 'succeeded' ? ['asset_candidate'] : [],
  purpose: 'seed_still',
  authorizationId: `authorization_${id}`,
  authorizationItemId: `item_${id}`,
  requestPlan: {
    kind: 'resolved',
    snapshot: {
      prompt: 'A frozen reference prompt',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 5,
      referenceInputs,
      conditioningInput: null,
    },
  },
  requestSnapshot: {
    prompt: 'A frozen reference prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInputs,
    conditioningInput: null,
  },
  spendReceipt: null,
  outputAssetIdsByRole: {
    primary: status === 'succeeded' ? 'asset_candidate' : null,
    poster: null,
  },
  error: status === 'failed' ? { code: 'provider_unavailable', messageKey: 'providerUnavailable' } : null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

const makeProject = (approvedAssetId: string | null = null): StudioProjectV2 => {
  const candidateJob = {
    ...makeJob('job_candidate', 'succeeded'),
    projectReferenceId: 'reference_character',
  };
  const assets: StudioProjectV2['assets'] = { asset_candidate: makeAsset('asset_candidate') };
  if (approvedAssetId !== null) assets[approvedAssetId] = makeAsset(approvedAssetId);
  return {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    revision: 7,
    id: 'project_1',
    name: 'Reference approval',
    brief: 'A concise story',
    rules: [],
    briefConversationId: null,
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '1080p',
    boardStyle: null,
    beatOrder: ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: 'Introduce the character',
        look: 'A quiet room',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_1'],
        lineHistory: [],
      },
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        line: 'Ming enters',
        derivation: 'derived',
        derivedFromActionRevision: 1,
        narration: '',
        onScreenText: '',
        durationSeconds: 5,
        trimInSeconds: null,
        trimOutSeconds: null,
        chainBreak: 'none',
        referenceIds: ['reference_character'],
        seedStillId: null,
        boardAssetId: null,
        supersededBoardAssetIds: [],
        videoAssetId: null,
        supersededVideoAssetIds: [],
        assetIds: Object.keys(assets),
        jobIds: [candidateJob.id],
      },
    },
    referenceOrder: ['reference_character'],
    references: {
      reference_character: {
        id: 'reference_character',
        kind: 'character',
        label: 'Ming',
        prompt: 'A careful engineer',
        candidateAssetId: 'asset_candidate',
        candidateJobId: candidateJob.id,
        approvedAssetId,
        supersededAssetIds: [],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    },
    bin: [],
    bedAssetId: null,
    spendPolicy: null,
    spendAuthorizations: [],
    frameExtractions: {},
    undoHistory: [],
    imageRouteId: 'route_image',
    videoRouteId: null,
    assets,
    jobs: { [candidateJob.id]: candidateJob },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
};

const approve = (project: StudioProjectV2, candidateAssetId = 'asset_candidate'): StudioProjectV2 =>
  approveStudioProjectReferenceV2({
    project,
    referenceId: 'reference_character',
    candidateAssetId,
    approvedAt: APPROVED_AT,
  });

const expectApprovalCode = (operation: () => unknown, code: string): void => {
  try {
    operation();
    throw new Error('Expected approval to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(StudioProjectReferenceApprovalErrorV2);
    expect((error as StudioProjectReferenceApprovalErrorV2).code).toBe(code);
  }
};

describe('approveStudioProjectReferenceV2', () => {
  it('promotes only the exact succeeded candidate without mutating the input project', () => {
    const project = makeProject();
    const before = structuredClone(project);

    const approved = approve(project);

    expect(project).toEqual(before);
    expect(approved.references.reference_character).toMatchObject({
      candidateAssetId: 'asset_candidate',
      candidateJobId: 'job_candidate',
      approvedAssetId: 'asset_candidate',
      supersededAssetIds: [],
      updatedAt: APPROVED_AT,
    });
  });

  it('approves terminal candidate provenance after its proxy Shot changes composition', () => {
    const project = makeProject();
    project.shots.shot_1!.referenceIds = [];

    expect(approve(project).references.reference_character).toMatchObject({
      candidateJobId: 'job_candidate',
      approvedAssetId: 'asset_candidate',
    });
  });

  it('appends the replaced approval to immutable history in order', () => {
    const project = makeProject('asset_approved');
    project.references.reference_character!.supersededAssetIds = ['asset_first'];
    project.assets.asset_first = makeAsset('asset_first');
    project.shots.shot_1!.assetIds.push('asset_first');

    const approved = approve(project);

    expect(approved.references.reference_character).toMatchObject({
      approvedAssetId: 'asset_candidate',
      supersededAssetIds: ['asset_first', 'asset_approved'],
    });
    expect(project.references.reference_character!.supersededAssetIds).toEqual(['asset_first']);
  });

  it.each([
    {
      label: 'stale candidate id',
      mutate: (_project: StudioProjectV2) => undefined,
      candidateAssetId: 'asset_stale',
    },
    {
      label: 'wrong candidate job destination',
      mutate: (project: StudioProjectV2) => {
        project.jobs.job_candidate!.projectReferenceId = 'reference_other';
      },
      candidateAssetId: 'asset_candidate',
    },
    {
      label: 'unfinished candidate job',
      mutate: (project: StudioProjectV2) => {
        project.jobs.job_candidate!.status = 'running';
      },
      candidateAssetId: 'asset_candidate',
    },
    {
      label: 'already approved candidate',
      mutate: (project: StudioProjectV2) => {
        project.references.reference_character!.approvedAssetId = 'asset_candidate';
      },
      candidateAssetId: 'asset_candidate',
    },
  ])('fails closed for a $label', ({ mutate, candidateAssetId }) => {
    const project = makeProject();
    mutate(project);
    expectApprovalCode(() => approve(project, candidateAssetId), 'invalid_authority');
  });

  it.each(['queued_local', 'running', 'needs_attention'] as const)(
    'blocks replacement while the old approval is bound to %s work',
    (status) => {
      const project = makeProject('asset_approved');
      const consumer = makeJob('job_consumer', status, [{ assetId: 'asset_approved', sha256: DIGEST }]);
      project.jobs[consumer.id] = consumer;
      project.shots.shot_1!.jobIds.push(consumer.id);

      expectApprovalCode(() => approve(project), 'approved_asset_busy');
      expect(project.references.reference_character!.approvedAssetId).toBe('asset_approved');
      expect(project.references.reference_character!.supersededAssetIds).toEqual([]);
    }
  );

  it('allows replacement after every consumer of the old approval is terminal', () => {
    const project = makeProject('asset_approved');
    const consumer = makeJob('job_consumer', 'succeeded', [{ assetId: 'asset_approved', sha256: DIGEST }]);
    project.jobs[consumer.id] = consumer;
    project.shots.shot_1!.jobIds.push(consumer.id);

    expect(approve(project).references.reference_character).toMatchObject({
      approvedAssetId: 'asset_candidate',
      supersededAssetIds: ['asset_approved'],
    });
  });
});
