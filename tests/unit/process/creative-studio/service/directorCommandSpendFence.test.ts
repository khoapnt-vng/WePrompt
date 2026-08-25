/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  type CreateStudioProjectInputV2,
  type StudioAssetV2,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorOperationV2,
  type StudioJobV2,
  type StudioProjectV2,
  type StudioQuotedGeneration,
  type StudioShot,
  type StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioDirectorCommandServiceV2 } from '@process/services/creative-studio/service/directorCommandService';
import {
  applyStudioMutationBatchV2,
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createEmptyStudioProjectV2,
  createStudioGenerationRequestTemplate,
  createStudioQuotedGenerationId,
  deriveStudioInstructionProfileV2,
  deriveStudioDirtyShotsV2,
  studioGenerationCompositionDigestV2,
  validateStudioProjectV2,
} from '@process/services/creative-studio/service/schema2';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const directorShotV2 = () => ({
  shootingScript: 'A clean product composition',
  durationSeconds: 5,
});

const directorCommandV2 = (
  project: StudioProjectV2,
  commandId: string,
  operations: StudioDirectorOperationV2[]
): StudioDirectorCommandRecordV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId,
  projectId: project.id,
  expectedRevision: project.revision,
  createdAt: '2026-08-17T00:00:00.000Z',
  deadlineAt: '2026-08-17T00:00:15.000Z',
  policy: 'auto_apply',
  operations,
});

describe('Studio Director schema-2 dynamic spend fence', () => {
  it('applies every current schema-2 Director mutation kind while every paid boundary remains poisoned', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-spend-fence-v2-'));
    roots.push(rootDir);
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_v2',
      now: () => '2026-08-17T00:00:00.000Z',
    });
    const input: CreateStudioProjectInputV2 = {
      name: 'Schema-2 spend fence',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 15,
      resolution: '1080p',
    };
    let project = await store.createProjectV2(input);
    const paidBoundaryNames = [
      'submitScenes',
      'submitShots',
      'retryJob',
      'retryJobV2',
      'retryDownload',
      'retryDownloadV2',
      'cancelJob',
      'cancelJobV2',
      'renderCut',
      'renderCutV2',
      'listConnectionCandidates',
      'listGenerationRoutes',
      'isGenerationRouteAvailable',
      'validateConnection',
      'validateRequest',
      'submit',
      'poll',
      'cancel',
    ] as const;
    const paidBoundaries = Object.fromEntries(
      paidBoundaryNames.map((name) => [
        name,
        vi.fn(() => {
          throw new Error(`${name} must stay unreachable`);
        }),
      ])
    ) as Record<(typeof paidBoundaryNames)[number], ReturnType<typeof vi.fn>>;
    const service = createStudioDirectorCommandServiceV2({
      store: Object.assign(store, paidBoundaries),
      now: () => Date.parse('2026-08-17T00:00:01.000Z'),
    });
    const apply = async (commandId: string, operations: StudioDirectorOperationV2[]): Promise<StudioProjectV2> => {
      const result = await service.apply(
        directorCommandV2(project, commandId, operations),
        Date.parse('2026-08-17T00:00:14.000Z'),
        { commitTag: `spend-fence:${commandId}` }
      );
      project = result.project;
      return project;
    };

    project = await store.updateProjectV2(
      project.id,
      (openingProject) =>
        applyStudioMutationBatchV2(
          openingProject,
          {
            schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
            projectId: openingProject.id,
            expectedRevision: openingProject.revision,
            operations: [
              {
                kind: 'add_beat',
                beatId: 'section_1',
                beat: { title: 'Opening', story: 'Warm sunrise.', targetSeconds: null },
                beforeBeatId: null,
              },
              {
                kind: 'add_shot',
                beatId: 'section_1',
                shotId: 'clip_1',
                shot: directorShotV2(),
                beforeShotId: null,
              },
              {
                kind: 'add_beat',
                beatId: 'section_2',
                beat: { title: 'Close', story: 'Soft evening light.', targetSeconds: null },
                beforeBeatId: null,
              },
              {
                kind: 'add_shot',
                beatId: 'section_2',
                shotId: 'clip_2',
                shot: directorShotV2(),
                beforeShotId: null,
              },
              {
                kind: 'add_shot',
                beatId: 'section_1',
                shotId: 'clip_3',
                shot: { shootingScript: '', durationSeconds: 5 },
                beforeShotId: null,
              },
              {
                kind: 'add_binned_beat',
                beatId: 'alternate_1',
                beat: { title: 'Alternate one', story: '', targetSeconds: null },
              },
              {
                kind: 'add_binned_beat',
                beatId: 'alternate_2',
                beat: { title: 'Alternate two', story: '', targetSeconds: null },
              },
            ],
          },
          { mutationId: 'seed_spend_fence_structure', capturedAt: '2026-08-17T00:00:00.000Z' }
        ).project,
      project.revision,
      'seed_spend_fence_structure'
    );

    await apply('command_set_brief', [{ kind: 'set_brief', brief: 'Director-authored free edits' }]);
    await apply('command_reorder_beats', [{ kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] }]);
    await apply('command_reorder_shots', [
      { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_3', 'clip_1'] },
    ]);
    await apply('command_delete_shot', [{ kind: 'delete_shot', shotId: 'clip_3' }]);
    await apply('command_reorder_bin', [
      {
        kind: 'reorder_bin',
        bin: [
          { kind: 'beat', beatId: 'alternate_2', reason: 'alternate' },
          { kind: 'beat', beatId: 'alternate_1', reason: 'alternate' },
        ],
      },
    ]);
    await apply('command_set_reference_plan', [{ kind: 'set_reference_plan', references: [] }]);
    await apply('command_set_shot_reference_binding', [
      {
        kind: 'set_shot_reference_binding',
        shotId: 'clip_1',
        characterReferenceIds: [],
        backgroundReferenceId: null,
      },
    ]);

    expect(project).toMatchObject({
      brief: 'Director-authored free edits',
      beatOrder: ['section_2', 'section_1'],
      beats: {
        section_1: { story: 'Warm sunrise.', shotOrder: ['clip_1'] },
      },
      shots: {
        clip_1: {
          shootingScript: 'A clean product composition',
          referenceBinding: {
            status: 'ready',
            characterReferenceIds: [],
            backgroundReferenceId: null,
          },
          videoAssetId: null,
          supersededVideoAssetIds: [],
        },
      },
      referencePlanStatus: 'planned',
      referenceOrder: [],
      bin: [
        { kind: 'beat', beatId: 'alternate_2', reason: 'alternate' },
        { kind: 'beat', beatId: 'alternate_1', reason: 'alternate' },
      ],
    });
    expect(project.shots).not.toHaveProperty('clip_3');
    for (const boundary of Object.values(paidBoundaries)) expect(boundary).not.toHaveBeenCalled();
  });

  it('uses the real dirty-shot oracle to reject a direct request edit without committing it', async () => {
    const openedAt = '2026-08-17T00:00:00.000Z';
    const confirmedAt = '2026-08-17T00:00:01.000Z';
    const project = createEmptyStudioProjectV2(
      {
        name: 'Schema-2 staleness fence',
        brief: 'A clean product launch story',
        aspectRatio: '16:9',
        targetDurationSeconds: 15,
        resolution: '1080p',
      },
      'project_v2',
      openedAt
    );
    project.videoRouteId = 'video_route_1';
    project.referencePlanStatus = 'planned';
    project.beatOrder = ['beat_1'];
    project.beats.beat_1 = {
      id: 'beat_1',
      title: 'Opening',
      story: 'Reveal the product in clean daylight on brushed metal.',
      targetSeconds: null,
      shotOrder: ['shot_1'],
    };
    const shot: StudioShot = {
      id: 'shot_1',
      shootingScript: 'A composed hero shot.',
      durationSeconds: 8,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'none',
      referenceBinding: { status: 'ready', characterReferenceIds: [], backgroundReferenceId: null },
      seedStillId: 'seed_1',
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: 'take_1',
      supersededVideoAssetIds: [],
      assetIds: ['seed_1', 'take_1'],
      jobIds: ['job_1'],
    };
    project.shots.shot_1 = shot;
    const seed: StudioAssetV2 = {
      id: 'seed_1',
      projectId: project.id,
      shotId: shot.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'seed_1.png' },
      byteSize: 1,
      sha256: 'a'.repeat(64),
      createdAt: openedAt,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
    };
    const provider = { providerId: 'provider_1', adapterId: 'byteplus-seedance-v1' as const, model: 'video-model' };
    const source = {
      kind: 'shot' as const,
      beatId: 'beat_1',
      story: project.beats.beat_1.story,
      shotId: shot.id,
      shootingScript: shot.shootingScript,
    };
    const composition = composeStudioGenerationV2({
      projectRevision: project.revision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: 'video_take',
      referenceInputs: [],
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: provider,
      boardStyle: null,
      instructionProfile: deriveStudioInstructionProfileV2(provider, 'video_take', source),
    });
    const take: StudioAssetV2 = {
      id: 'take_1',
      projectId: project.id,
      shotId: shot.id,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'take_1.mp4' },
      byteSize: 1,
      sha256: 'b'.repeat(64),
      durationSeconds: 10,
      createdAt: confirmedAt,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: 'job_1',
      compositionDigest: studioGenerationCompositionDigestV2(composition),
    };
    project.assets.seed_1 = seed;
    project.assets.take_1 = take;
    const requestSnapshot = {
      ...createStudioGenerationRequestTemplate({
        composition,
        durationSeconds: shot.durationSeconds,
      }),
      conditioningInput: { kind: 'seed_still' as const, assetId: seed.id },
    };
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        target: { kind: 'shot', shotId: shot.id },
        purpose: 'video_take',
      }),
      target: { kind: 'shot', shotId: shot.id },
      purpose: 'video_take',
      routeId: project.videoRouteId,
      generationCount: 1,
      requestPlan: { kind: 'resolved', snapshot: requestSnapshot },
      rateUnit: 'second',
      rateMinorUnits: 2,
    };
    const totals = calculateStudioQuoteTotals([item]);
    if (totals === null) throw new Error('canonical quote fixture must have finite totals');
    const authorization: StudioSpendAuthorization = {
      id: 'authorization_1',
      projectId: project.id,
      projectRevision: project.revision,
      originReferenceHandoffId: null,
      rateCardDigest: 'c'.repeat(64),
      currency: 'USD',
      baseItems: [item],
      cascadeItems: [],
      lowerMinorUnits: totals.lowerMinorUnits,
      upperMinorUnits: totals.upperMinorUnits,
      expiresAt: '2026-08-17T00:05:00.000Z',
      confirmedAt,
      providerBindings: [{ itemId: item.id, provider }],
      idempotencyKeys: [{ itemId: item.id, key: 'idem_job_1' }],
    };
    const job: StudioJobV2 = {
      id: 'job_1',
      projectId: project.id,
      target: { kind: 'shot', shotId: shot.id },
      status: 'succeeded',
      provider,
      idempotencyKey: authorization.idempotencyKeys[0]!.key,
      providerJobId: 'remote_job_1',
      remoteStartedAt: confirmedAt,
      cancellationPolicy: 'queued_and_running',
      outputAssetIds: [take.id],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: confirmedAt,
      updatedAt: confirmedAt,
      purpose: item.purpose,
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      composition,
      requestPlan: item.requestPlan,
      requestSnapshot,
      spendReceipt: {
        authorizationId: authorization.id,
        itemId: item.id,
        jobId: 'job_1',
        purpose: item.purpose,
        routeId: item.routeId,
        currency: authorization.currency,
        rateUnit: item.rateUnit,
        rateMinorUnits: item.rateMinorUnits,
        durationSeconds: shot.durationSeconds,
        generationCount: item.generationCount,
        totalMinorUnits: totals.upperMinorUnits,
      },
      outputAssetIdsByRole: { primary: take.id, poster: null },
    };
    project.spendAuthorizations = [authorization];
    project.jobs.job_1 = job;
    project.revision += 1;
    project.updatedAt = confirmedAt;

    const operation: StudioDirectorOperationV2 = {
      kind: 'set_brief',
      brief: 'A newly authored project Brief.',
    };
    expect(validateStudioProjectV2(project)).toBe(true);
    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);
    const reviewedMutation = applyStudioMutationBatchV2(
      project,
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [operation],
      },
      { mutationId: 'reviewed_edit', capturedAt: confirmedAt }
    ).project;
    const reviewedCandidate: StudioProjectV2 = {
      ...reviewedMutation,
      revision: project.revision + 1,
      updatedAt: '2026-08-17T00:00:02.000Z',
    };
    expect(validateStudioProjectV2(reviewedCandidate)).toBe(true);
    expect(deriveStudioDirtyShotsV2(reviewedCandidate)).toEqual([
      { shotId: shot.id, causes: ['generation_out_of_date'] },
    ]);

    const durableBefore = structuredClone(project);
    let durableProject = structuredClone(project);
    const updateProjectV2 = vi.fn(
      async (
        projectId: string,
        update: (candidate: StudioProjectV2) => StudioProjectV2,
        expectedRevision?: number,
        commitTag?: string
      ): Promise<StudioProjectV2> => {
        expect({ projectId, expectedRevision, commitTag }).toEqual({
          projectId: project.id,
          expectedRevision: project.revision,
          commitTag: 'spend-fence:command_stale',
        });
        const candidate = update(structuredClone(durableProject));
        durableProject = {
          ...candidate,
          revision: durableProject.revision + 1,
          updatedAt: '2026-08-17T00:00:02.000Z',
        };
        return structuredClone(durableProject);
      }
    );
    const service = createStudioDirectorCommandServiceV2({
      store: { updateProjectV2 },
      now: () => Date.parse('2026-08-17T00:00:01.000Z'),
    });

    await expect(
      service.apply(directorCommandV2(project, 'command_stale', [operation]), Date.parse('2026-08-17T00:00:14.000Z'), {
        commitTag: 'spend-fence:command_stale',
      })
    ).rejects.toMatchObject({ reasonCode: 'operation_not_permitted' });

    expect(durableProject).toEqual(durableBefore);
    expect(deriveStudioDirtyShotsV2(durableProject)).toEqual([]);
    expect(updateProjectV2).toHaveBeenCalledTimes(1);
  });
});
