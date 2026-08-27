/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioJobPurpose,
  StudioJobStatusV2,
  StudioRendererJobV2,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { deriveReferenceRemovalBlockers } from '@/renderer/pages/studio/components/Workspace/Views/References/referenceRemovalBlockers';

const PROJECT_ID = 'project_1';
const REFERENCE_ID = 'reference_ming';
const ASSET_ID = 'asset_ming_current';

const job = (input: {
  id: string;
  target?: StudioRendererJobV2['target'];
  status?: StudioJobStatusV2;
  purpose?: StudioJobPurpose;
  referenceId?: string;
  assetId?: string;
  canRetryDownload?: boolean;
  createdAt?: string;
}): StudioRendererJobV2 =>
  ({
    id: input.id,
    projectId: PROJECT_ID,
    target: input.target ?? { kind: 'shot', shotId: 'shot_1b' },
    status: input.status ?? 'running',
    purpose: input.purpose ?? 'video_take',
    composition: {
      inputs: {
        referenceInputs:
          input.referenceId === undefined
            ? []
            : [
                {
                  referenceId: input.referenceId,
                  kind: 'character',
                  label: 'Ming',
                  assetId: input.assetId ?? ASSET_ID,
                },
              ],
      },
    },
    error:
      input.status === 'failed'
        ? { code: 'download_failed', messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed' }
        : null,
    canRetryDownload: input.canRetryDownload ?? input.status === 'failed',
    createdAt: input.createdAt ?? '2026-08-27T10:00:00.000Z',
  }) as StudioRendererJobV2;

const project = (jobs: StudioRendererJobV2[]): StudioRendererProjectV2 =>
  ({
    id: PROJECT_ID,
    referencePlanStatus: 'planned',
    referenceOrder: [REFERENCE_ID],
    references: {
      [REFERENCE_ID]: {
        id: REFERENCE_ID,
        kind: 'character',
        label: 'Ming',
        prompt: 'Ming in a red jacket',
        approvedAssetId: ASSET_ID,
        supersededAssetIds: ['asset_ming_old'],
        jobIds: ['job_reference_active'],
      },
    },
    assets: {
      [ASSET_ID]: {
        id: ASSET_ID,
        projectId: PROJECT_ID,
        shotId: null,
        mediaKind: 'image',
        managedAsset: { collection: 'imports', fileName: 'ming.png' },
        projectReferenceId: REFERENCE_ID,
        producerJobId: null,
        compositionDigest: null,
        generationReferenceAssetIds: [],
      },
    },
    beatOrder: ['beat_1', 'beat_2'],
    beats: {
      beat_1: { id: 'beat_1', title: 'One', story: 'One', targetSeconds: null, shotOrder: ['shot_1a', 'shot_1b'] },
      beat_2: { id: 'beat_2', title: 'Two', story: 'Two', targetSeconds: null, shotOrder: ['shot_2a'] },
    },
    shots: {
      shot_1a: { id: 'shot_1a', jobIds: [] },
      shot_1b: {
        id: 'shot_1b',
        jobIds: jobs
          .filter((candidate) => candidate.target.kind === 'shot' && candidate.target.shotId === 'shot_1b')
          .map(({ id }) => id),
      },
      shot_2a: {
        id: 'shot_2a',
        jobIds: jobs
          .filter((candidate) => candidate.target.kind === 'shot' && candidate.target.shotId === 'shot_2a')
          .map(({ id }) => id),
      },
      shot_retained: {
        id: 'shot_retained',
        jobIds: jobs
          .filter((candidate) => candidate.target.kind === 'shot' && candidate.target.shotId === 'shot_retained')
          .map(({ id }) => id),
      },
    },
    bin: [],
    jobs: Object.fromEntries(jobs.map((candidate) => [candidate.id, candidate])),
  }) as StudioRendererProjectV2;

describe('reference removal blockers', () => {
  it('classifies the exact Main-owned blocker branches and reports one-based active Shot positions', () => {
    const authority = project([
      job({
        id: 'job_reference_active',
        target: { kind: 'reference', referenceId: REFERENCE_ID },
        purpose: 'reference_image',
      }),
      job({ id: 'job_active_consumer', referenceId: REFERENCE_ID }),
      job({
        id: 'job_download_recovery',
        target: { kind: 'shot', shotId: 'shot_2a' },
        status: 'failed',
        referenceId: REFERENCE_ID,
      }),
    ]);

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([
      expect.objectContaining({
        kind: 'download_recovery',
        recoveryAction: 'retry_download',
        jobId: 'job_download_recovery',
        createdAt: '2026-08-27T10:00:00.000Z',
        shotId: 'shot_2a',
        beatPosition: 2,
        shotPosition: 1,
      }),
      expect.objectContaining({
        kind: 'active_asset_consumer',
        jobId: 'job_active_consumer',
        shotId: 'shot_1b',
        beatPosition: 1,
        shotPosition: 2,
      }),
      expect.objectContaining({
        kind: 'active_reference_job',
        jobId: 'job_reference_active',
        referenceId: REFERENCE_ID,
        assetId: ASSET_ID,
        shotId: null,
        beatPosition: null,
        shotPosition: null,
      }),
    ]);
  });

  it('keeps retained Shot consumers visible without inventing a film position', () => {
    const authority = project([
      job({
        id: 'job_retained',
        target: { kind: 'shot', shotId: 'shot_retained' },
        referenceId: REFERENCE_ID,
      }),
      job({
        id: 'job_retained_download',
        target: { kind: 'shot', shotId: 'shot_retained' },
        status: 'failed',
        referenceId: REFERENCE_ID,
      }),
    ]);
    authority.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_retained', reason: 'lifted' });

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'download_recovery',
          recoveryAction: 'restore_shot',
          retainedOwner: {
            kind: 'shot',
            beatId: 'beat_1',
            shotId: 'shot_retained',
            reason: 'lifted',
          },
          jobId: 'job_retained_download',
          shotId: 'shot_retained',
          beatId: null,
          beatPosition: null,
          shotPosition: null,
        }),
        expect.objectContaining({
          kind: 'active_asset_consumer',
          jobId: 'job_retained',
          shotId: 'shot_retained',
          beatId: null,
          beatPosition: null,
          shotPosition: null,
        }),
      ])
    );
  });

  it('carries the exact binned Beat identity for a retained Shot download', () => {
    const authority = project([
      job({
        id: 'job_retained_download',
        target: { kind: 'shot', shotId: 'shot_retained' },
        status: 'failed',
        referenceId: REFERENCE_ID,
      }),
    ]);
    authority.beats.beat_retained = {
      id: 'beat_retained',
      title: 'Retained',
      story: 'Retained',
      targetSeconds: 4,
      shotOrder: ['shot_retained'],
    };
    authority.bin.push({ kind: 'beat', beatId: 'beat_retained', reason: 'alternate' });

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([
      expect.objectContaining({
        kind: 'download_recovery',
        recoveryAction: 'restore_shot',
        jobId: 'job_retained_download',
        retainedOwner: { kind: 'beat', beatId: 'beat_retained', reason: 'alternate' },
      }),
    ]);
  });

  it('fails closed when a retained failed-download Shot has no exact Bin owner', () => {
    const authority = project([
      job({
        id: 'job_retained_download',
        target: { kind: 'shot', shotId: 'shot_retained' },
        status: 'failed',
        referenceId: REFERENCE_ID,
      }),
    ]);

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([
      { kind: 'invalid_authority', referenceId: REFERENCE_ID, assetId: ASSET_ID },
    ]);
  });

  it('ignores terminal, non-recoverable, superseded-asset, wrong-reference, and unowned jobs', () => {
    const authority = project([
      job({ id: 'job_succeeded', status: 'succeeded', referenceId: REFERENCE_ID }),
      job({
        id: 'job_nonrecoverable',
        status: 'failed',
        referenceId: REFERENCE_ID,
        canRetryDownload: false,
      }),
      job({ id: 'job_old_asset', referenceId: REFERENCE_ID, assetId: 'asset_ming_old' }),
      job({ id: 'job_wrong_reference', referenceId: 'reference_mei' }),
    ]);

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([]);
  });

  it('does not block removal for a failed replacement-reference download that never used the current asset', () => {
    const authority = project([
      job({
        id: 'job_reference_active',
        target: { kind: 'reference', referenceId: REFERENCE_ID },
        status: 'failed',
        purpose: 'reference_image',
        canRetryDownload: true,
      }),
    ]);

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([]);
  });

  it('orders actionable recovery first, then creation time and job id regardless of record insertion order', () => {
    const jobs = [
      job({
        id: 'job_z',
        target: { kind: 'shot', shotId: 'shot_2a' },
        referenceId: REFERENCE_ID,
        createdAt: '2026-08-27T10:00:02.000Z',
      }),
      job({ id: 'job_b', referenceId: REFERENCE_ID, createdAt: '2026-08-27T10:00:01.000Z' }),
      job({ id: 'job_a', referenceId: REFERENCE_ID, createdAt: '2026-08-27T10:00:01.000Z' }),
      job({
        id: 'job_recover',
        target: { kind: 'shot', shotId: 'shot_2a' },
        status: 'failed',
        referenceId: REFERENCE_ID,
        createdAt: '2026-08-27T10:00:03.000Z',
      }),
    ];

    const forward = deriveReferenceRemovalBlockers(project(jobs), REFERENCE_ID).map(({ jobId }) => jobId);
    const reverse = deriveReferenceRemovalBlockers(project([...jobs].toReversed()), REFERENCE_ID).map(
      ({ jobId }) => jobId
    );

    expect(forward).toEqual(['job_recover', 'job_a', 'job_b', 'job_z']);
    expect(reverse).toEqual(forward);
  });

  it('does not derive a retry surface when there is no exact current approved reference asset', () => {
    const authority = project([job({ id: 'job_1', referenceId: REFERENCE_ID })]);
    authority.references[REFERENCE_ID]!.approvedAssetId = null;

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([]);
    expect(deriveReferenceRemovalBlockers(authority, 'reference_missing')).toEqual([]);
  });

  it('fails closed when a generated current asset has ambiguous exact producers', () => {
    const producer = job({
      id: 'job_reference_active',
      target: { kind: 'reference', referenceId: REFERENCE_ID },
      status: 'succeeded',
      purpose: 'reference_image',
    });
    producer.outputAssetIds = [ASSET_ID];
    producer.outputAssetIdsByRole = { primary: ASSET_ID, poster: null };
    const authority = project([producer]);
    authority.assets[ASSET_ID]!.managedAsset = { collection: 'assets', fileName: 'ming.png' };
    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([]);

    const duplicate = structuredClone(producer);
    duplicate.id = 'job_reference_duplicate';
    authority.jobs[duplicate.id] = duplicate;
    authority.references[REFERENCE_ID]!.jobIds.push(duplicate.id);

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([
      { kind: 'invalid_authority', referenceId: REFERENCE_ID, assetId: ASSET_ID },
    ]);
  });

  it.each([
    {
      label: 'reference plan is not planned',
      change: (authority: StudioRendererProjectV2) => {
        authority.referencePlanStatus = 'unplanned';
      },
    },
    {
      label: 'reference order is ambiguous',
      change: (authority: StudioRendererProjectV2) => authority.referenceOrder.push(REFERENCE_ID),
    },
    {
      label: 'approved asset is absent',
      change: (authority: StudioRendererProjectV2) => delete authority.assets[ASSET_ID],
    },
    {
      label: 'approved asset belongs to another project',
      change: (authority: StudioRendererProjectV2) => {
        authority.assets[ASSET_ID]!.projectId = 'project_other';
      },
    },
    {
      label: 'approved asset belongs to another reference',
      change: (authority: StudioRendererProjectV2) => {
        authority.assets[ASSET_ID]!.projectReferenceId = 'reference_other';
      },
    },
    {
      label: 'approved asset is Shot-owned',
      change: (authority: StudioRendererProjectV2) => {
        authority.assets[ASSET_ID]!.shotId = 'shot_1b';
      },
    },
    {
      label: 'approved asset is not an image',
      change: (authority: StudioRendererProjectV2) => {
        authority.assets[ASSET_ID]!.mediaKind = 'video';
      },
    },
    {
      label: 'imported asset has generated provenance',
      change: (authority: StudioRendererProjectV2) => {
        authority.assets[ASSET_ID]!.producerJobId = 'job_unexpected';
      },
    },
    {
      label: 'generated asset has no exact succeeded reference producer',
      change: (authority: StudioRendererProjectV2) => {
        authority.assets[ASSET_ID]!.managedAsset = { collection: 'assets', fileName: 'ming.png' };
      },
    },
  ])('derives an invalid-authority blocker when the $label', ({ change }) => {
    const authority = project([job({ id: 'job_1', referenceId: REFERENCE_ID })]);
    change(authority);

    expect(deriveReferenceRemovalBlockers(authority, REFERENCE_ID)).toEqual([
      {
        kind: 'invalid_authority',
        referenceId: REFERENCE_ID,
        assetId: ASSET_ID,
      },
    ]);
  });

  it('fails closed when a Main-blocking job has the wrong project or no renderer owner', () => {
    const wrongProject = job({
      id: 'job_wrong_project',
      target: { kind: 'reference', referenceId: REFERENCE_ID },
      purpose: 'reference_image',
    });
    wrongProject.projectId = 'project_other';
    const unowned = job({
      id: 'job_unowned_reference',
      target: { kind: 'reference', referenceId: REFERENCE_ID },
      purpose: 'reference_image',
    });

    expect(deriveReferenceRemovalBlockers(project([wrongProject]), REFERENCE_ID)).toEqual([
      { kind: 'invalid_authority', referenceId: REFERENCE_ID, assetId: ASSET_ID },
    ]);
    expect(deriveReferenceRemovalBlockers(project([unowned]), REFERENCE_ID)).toEqual([
      { kind: 'invalid_authority', referenceId: REFERENCE_ID, assetId: ASSET_ID },
    ]);
    expect(
      deriveReferenceRemovalBlockers(
        project([
          job({ id: 'job_unowned', target: { kind: 'shot', shotId: 'missing_shot' }, referenceId: REFERENCE_ID }),
        ]),
        REFERENCE_ID
      )
    ).toEqual([{ kind: 'invalid_authority', referenceId: REFERENCE_ID, assetId: ASSET_ID }]);
  });
});
