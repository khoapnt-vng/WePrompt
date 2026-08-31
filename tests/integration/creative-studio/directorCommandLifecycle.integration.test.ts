/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioJobRequest,
  type StudioJobV2,
  type StudioProjectV2,
  type StudioProjectStatusV2,
  type StudioQuotedGeneration,
  type StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioDirectorCommandWriterV2 } from '@process/resources/builtinMcp/studioDirectorCommandWriter';
import { registerStudioToolsV2 } from '@process/resources/builtinMcp/studioServer';
import {
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandMailboxV2,
} from '@process/services/creative-studio/service/directorCommandMailbox';
import {
  createStudioDirectorCommandProcessorV2,
  createStudioDirectorCommitTrackerV2,
} from '@process/services/creative-studio/service/directorCommandProcessor';
import { createStudioDirectorCommandServiceV2 } from '@process/services/creative-studio/service/directorCommandService';
import { createCreativeStudioServiceV2 } from '@process/services/creative-studio/service';
import {
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createStudioGenerationRequestTemplate,
  createStudioQuotedGenerationId,
  createStudioResolvedGenerationRequestPlan,
  deriveStudioInstructionProfileV2,
  studioGenerationCompositionDigestV2,
} from '@process/services/creative-studio/service/schema2/generation';
import { createCreativeStudioStore, type StudioProjectCommitFacts } from '@process/services/creative-studio/store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const waitForCondition = async <T>(
  read: () => T | null | Promise<T | null>,
  description: string,
  timeoutMs = 5_000
): Promise<T> => {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value !== null) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
};

const fileExists = async (file: string): Promise<boolean> => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const idSequence = (ids: string[]): (() => string) => {
  let index = 0;
  return () => ids[index++] ?? `generated_${index}`;
};

const refusedJobRecoveryStatusV2 = (
  projectId: string,
  projectRevision: number,
  jobId: string
): StudioProjectStatusV2 => ({
  projectId,
  projectRevision,
  catalogVersion: '0123456789abcdef',
  stages: [
    { id: 'brief', state: 'complete', summary: { stage: 'brief', hasBrief: true }, blockers: [] },
    {
      id: 'engines',
      state: 'complete',
      summary: { stage: 'engines', image: 'ready', video: 'ready' },
      blockers: [],
    },
    {
      id: 'references',
      state: 'complete',
      summary: { stage: 'references', plannedCount: 0, approvedCount: 0 },
      blockers: [],
    },
    {
      id: 'storyboard',
      state: 'not_started',
      summary: {
        stage: 'storyboard',
        beatCount: 0,
        shotCount: 0,
        authoredShotCount: 0,
        plannedSeconds: 0,
        targetSeconds: 5,
      },
      blockers: [],
    },
    {
      id: 'bindings',
      state: 'complete',
      summary: { stage: 'bindings', readyShotCount: 0, shotCount: 0, maxConditioningImages: 3 },
      blockers: [],
    },
    {
      id: 'production',
      state: 'blocked',
      summary: { stage: 'production', currentTakeCount: 0, shotCount: 0, activeJobCount: 0 },
      blockers: [
        {
          cause: 'generation_provider_unavailable',
          where: {
            kind: 'shot',
            beatId: 'beat_1',
            shotId: 'shot_1',
            beatPosition: 1,
            shotPosition: 1,
            jobId,
          },
          remedy: { kind: 'free_fix', op: 'terminalize_refused_job', jobId },
        },
      ],
    },
    {
      id: 'cut',
      state: 'not_started',
      summary: {
        stage: 'cut',
        currentTakeCount: 0,
        shotCount: 0,
        durationSeconds: null,
        targetSeconds: 5,
        structurallyPlayable: false,
      },
      blockers: [],
    },
  ],
  blockerCount: 1,
  advisories: [],
  boards: { currentPictureCount: 0, shotCount: 0 },
  detail: { shots: [], references: [] },
});

const addTerminalPaidShotLineage = (project: StudioProjectV2, shotId: string): StudioProjectV2 => {
  const next = structuredClone(project);
  const shot = next.shots[shotId]!;
  const seedId = `${shotId}_seed`;
  const takeId = `${shotId}_take`;
  const seed: StudioAssetV2 = {
    id: seedId,
    projectId: next.id,
    shotId,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'imports', fileName: `${seedId}.png` },
    byteSize: 1,
    sha256: 'a'.repeat(64),
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: null,
    compositionDigest: null,
    createdAt: next.updatedAt,
  };
  const beat = Object.values(next.beats).find((candidate) => candidate.shotOrder.includes(shotId));
  if (beat === undefined) throw new Error('Expected the paid shot to have a Beat owner');
  const provider = { providerId: 'provider_1', adapterId: 'byteplus-seedance-v1', model: 'model_1' } as const;
  const source = {
    kind: 'shot' as const,
    beatId: beat.id,
    story: beat.story,
    shotId,
    shootingScript: shot.shootingScript,
  };
  const composition = composeStudioGenerationV2({
    projectRevision: next.revision,
    brief: next.brief,
    rules: next.rules,
    source,
    purpose: 'video_take',
    referenceInputs: [],
    aspectRatio: next.aspectRatio,
    resolution: next.resolution,
    route: provider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, 'video_take', source),
  });
  const requestPlan = createStudioResolvedGenerationRequestPlan({
    purpose: 'video_take',
    template: createStudioGenerationRequestTemplate({ composition, durationSeconds: shot.durationSeconds }),
    conditioningInput: { kind: 'seed_still', assetId: seedId },
  });
  const compositionDigest = studioGenerationCompositionDigestV2(composition);
  const take: StudioAssetV2 = {
    id: takeId,
    projectId: next.id,
    shotId,
    mediaKind: 'video',
    mimeType: 'video/mp4',
    managedAsset: { collection: 'assets', fileName: `${takeId}.mp4` },
    byteSize: 1,
    sha256: 'b'.repeat(64),
    durationSeconds: 10,
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: `${shotId}_job`,
    compositionDigest,
    createdAt: next.updatedAt,
  };
  const target = { kind: 'shot' as const, shotId };
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId: next.id,
      projectRevision: next.revision,
      target,
      purpose: 'video_take',
    }),
    target,
    purpose: 'video_take',
    routeId: 'video_route',
    generationCount: 1,
    requestPlan,
    rateUnit: 'second',
    rateMinorUnits: 2,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (totals === null) throw new Error('Expected finite paid quote');
  const authorizationId = `${shotId}_authorization`;
  const jobId = `${shotId}_job`;
  const authorization: StudioSpendAuthorization = {
    id: authorizationId,
    projectId: next.id,
    projectRevision: next.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'c'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-19T00:05:00.000Z',
    confirmedAt: '2026-08-19T00:00:01.000Z',
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, key: `${shotId}_idempotency` }],
  };
  const job: StudioJobV2 = {
    id: jobId,
    projectId: next.id,
    target,
    status: 'succeeded',
    provider,
    idempotencyKey: `${shotId}_idempotency`,
    providerJobId: `${shotId}_remote`,
    remoteStartedAt: '2026-08-19T00:00:02.000Z',
    cancellationPolicy: 'queued_and_running',
    outputAssetIds: [takeId],
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: '2026-08-19T00:00:01.000Z',
    updatedAt: '2026-08-19T00:00:02.000Z',
    purpose: 'video_take',
    authorizationId,
    authorizationItemId: item.id,
    composition,
    requestPlan: item.requestPlan,
    requestSnapshot: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot : null,
    spendReceipt: {
      authorizationId,
      itemId: item.id,
      jobId,
      purpose: 'video_take',
      routeId: item.routeId,
      currency: 'USD',
      rateUnit: 'second',
      rateMinorUnits: 2,
      durationSeconds: shot.durationSeconds,
      generationCount: 1,
      totalMinorUnits: shot.durationSeconds * 2,
    },
    outputAssetIdsByRole: { primary: takeId, poster: null },
  };
  next.videoRouteId = item.routeId;
  next.assets[seedId] = seed;
  next.assets[takeId] = take;
  next.jobs[jobId] = job;
  next.spendAuthorizations.push(authorization);
  shot.seedStillId = seedId;
  shot.videoAssetId = takeId;
  shot.assetIds.push(seedId, takeId);
  shot.jobIds.push(jobId);
  return next;
};

describe('Studio Director schema-2 real-boundary lifecycle', () => {
  it('commits one reducer revision before receipt-first cleanup and one notification', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-lifecycle-v2-'));
    roots.push(rootDir);
    const tracker = createStudioDirectorCommitTrackerV2();
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_v2_live',
      onProjectCommitted: tracker.observe,
    });
    const project: StudioProjectV2 = await store.createProjectV2({
      name: 'Director V2 lifecycle',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const mailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      watchCommandTree: () => ({ close: () => undefined }),
    });
    await mailbox.ensure(project.id);
    const onProjectUpdated = vi.fn();
    const processor = createStudioDirectorCommandProcessorV2({
      store,
      mailbox,
      service: createStudioDirectorCommandServiceV2({ store }),
      tracker,
      onProjectUpdated,
    });
    await processor.start();
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('schema-2 project directory missing');
    const commandId = 'command_v2_live';
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: project.id, projectDir },
      { createId: idSequence([commandId, 'lease_v2']) }
    );
    const pendingFile = path.join(projectDir, 'commands', 'pending', `${commandId}.json`);
    const applying = writer.apply({
      expectedRevision: project.revision,
      operations: [
        {
          kind: 'set_reference_plan',
          references: [
            {
              kind: 'character',
              label: 'Hero',
              prompt: 'Canonical visual reference for the hero.',
            },
          ],
        },
      ],
    });
    await waitForCondition(async () => ((await fileExists(pendingFile)) ? true : null), 'schema-2 pending publication');
    processor.trigger(project.id, commandId);

    await expect(applying).resolves.toMatchObject({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      status: 'applied',
      appliedRevision: project.revision + 1,
      createdBeatIds: [],
      createdShotIds: [],
    });
    const loadedApplied = await store.getProjectV2(project.id);
    if (loadedApplied.status !== 'supported') throw new Error('applied reference project missing');
    const referenceId = loadedApplied.project.referenceOrder[0]!;
    expect(loadedApplied.project).toMatchObject({
      revision: project.revision + 1,
      referenceOrder: [referenceId],
      references: {
        [referenceId]: { id: referenceId, label: 'Hero', prompt: 'Canonical visual reference for the hero.' },
      },
    });
    await expect(mailbox.readReceipt(project.id, commandId)).resolves.toMatchObject({
      status: 'valid',
      record: { status: 'applied', createdBeatIds: [], createdShotIds: [] },
    });
    await waitForCondition(
      async () =>
        !(await fileExists(pendingFile)) && !(await fileExists(path.join(projectDir, 'commands', 'slots', '0.slot')))
          ? true
          : null,
      'schema-2 receipt-first cleanup'
    );
    await waitForCondition(
      () => (onProjectUpdated.mock.calls.length === 1 ? true : null),
      'schema-2 renderer notification'
    );
    expect(await fileExists(pendingFile)).toBe(false);
    expect(await fileExists(path.join(projectDir, 'commands', 'slots', '0.slot'))).toBe(false);
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
    await processor.stop();
  });

  it('keeps a terminal-paid Beat byte-exact across park, restart, neighbor re-split, and original-owner restore', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-gate-one-paid-beat-v2-'));
    roots.push(rootDir);
    const now = '2026-08-19T00:00:03.000Z';
    const store = createCreativeStudioStore({ rootDir, now: () => now, createId: () => 'project_gate_one' });
    const project = await store.createProjectV2({
      name: 'Gate one paid Beat',
      brief: 'Preserve paid lineage through structural review.',
      aspectRatio: '16:9',
      targetDurationSeconds: 10,
      resolution: '720p',
    });
    const authored = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [
          {
            kind: 'add_beat',
            beatId: 'beat_paid',
            beat: { title: 'Paid', story: 'Show the hero in warm light.', targetSeconds: null },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'beat_paid',
            shotId: 'shot_paid',
            shot: { shootingScript: 'Hero frame', durationSeconds: 5 },
            beforeShotId: null,
          },
          {
            kind: 'add_beat',
            beatId: 'beat_neighbor',
            beat: { title: 'Neighbor', story: 'Resolve in cool light.', targetSeconds: null },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'beat_neighbor',
            shotId: 'shot_neighbor',
            shot: { shootingScript: 'Original neighbor', durationSeconds: 5 },
            beforeShotId: null,
          },
        ],
      },
      { mutationId: 'gate_one_authoring', capturedAt: now }
    );
    const paid = await store.updateProjectV2(
      project.id,
      (current) => addTerminalPaidShotLineage(current, 'shot_paid'),
      authored.project.revision,
      'gate-one:paid-lineage'
    );
    const paidLineage = structuredClone({
      beat: paid.beats.beat_paid,
      shot: paid.shots.shot_paid,
      assets: paid.assets,
      jobs: paid.jobs,
      authorizations: paid.spendAuthorizations,
    });

    const parked = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: paid.revision,
        operations: [{ kind: 'park_beat', beatId: 'beat_paid' }],
      },
      { mutationId: 'gate_one_park_paid', capturedAt: now }
    );
    expect(parked.project.bin).toEqual([{ kind: 'beat', beatId: 'beat_paid', reason: 'lifted' }]);
    expect(parked.project.bin).not.toContainEqual(expect.objectContaining({ kind: 'shot' }));

    const restartedStore = createCreativeStudioStore({ rootDir, now: () => now });
    await expect(restartedStore.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { beatOrder: ['beat_neighbor'], bin: [{ kind: 'beat', beatId: 'beat_paid', reason: 'lifted' }] },
    });
    const resplit = await restartedStore.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: parked.project.revision,
        operations: [
          {
            kind: 'apply_coverage',
            beatId: 'beat_neighbor',
            shots: [
              {
                shotId: 'shot_neighbor',
                shootingScript: 'Original neighbor',
                durationSeconds: 5,
                chainBreak: 'none',
              },
              {
                shotId: 'shot_neighbor_replacement',
                shootingScript: 'Reviewed replacement',
                durationSeconds: 5,
                chainBreak: 'none',
              },
            ],
            fixedShots: [{ shotId: 'shot_neighbor', reasons: ['shooting_script'] }],
          },
        ],
      },
      { mutationId: 'gate_one_resplit_neighbor', capturedAt: now }
    );
    expect(resplit.project.beats.beat_neighbor!.shotOrder).toEqual(['shot_neighbor', 'shot_neighbor_replacement']);
    expect({
      beat: resplit.project.beats.beat_paid,
      shot: resplit.project.shots.shot_paid,
      assets: resplit.project.assets,
      jobs: resplit.project.jobs,
      authorizations: resplit.project.spendAuthorizations,
    }).toEqual(paidLineage);

    const secondRestart = createCreativeStudioStore({ rootDir, now: () => now });
    const restored = await secondRestart.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: resplit.project.revision,
        operations: [{ kind: 'restore_beat', beatId: 'beat_paid', beforeBeatId: 'beat_neighbor' }],
      },
      { mutationId: 'gate_one_restore_original_beat', capturedAt: now }
    );
    expect(restored.project.beatOrder).toEqual(['beat_paid', 'beat_neighbor']);
    expect(restored.project.beats.beat_paid!.shotOrder).toEqual(['shot_paid']);
    expect(restored.project.bin).toEqual([]);
    expect({
      beat: restored.project.beats.beat_paid,
      shot: restored.project.shots.shot_paid,
      assets: restored.project.assets,
      jobs: restored.project.jobs,
      authorizations: restored.project.spendAuthorizations,
    }).toEqual(paidLineage);
  });

  it('carries a reviewed MCP proposal through one store revision and idempotent accepted retry after restart', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-proposal-v2-'));
    roots.push(rootDir);
    const onProjectCommitted = vi.fn();
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_v2_proposal',
      onProjectCommitted,
    });
    const project = await store.createProjectV2({
      name: 'Director V2 proposal lifecycle',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const seeded = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [
          {
            kind: 'add_beat',
            beatId: 'beat_direct',
            beat: {
              title: 'Opening',
              story: 'Reveal the product in cinematic studio light.',
              targetSeconds: null,
            },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'beat_direct',
            shotId: 'shot_direct',
            shot: {
              shootingScript: 'Initial shooting script',
              durationSeconds: 5,
            },
            beforeShotId: null,
          },
        ],
      },
      { mutationId: 'seed_direct_ids', capturedAt: new Date().toISOString() },
      'seed:direct-caller-ids'
    );
    expect(seeded).toMatchObject({
      createdBeatIds: ['beat_direct'],
      createdShotIds: ['shot_direct'],
      project: {
        beatOrder: ['beat_direct'],
        beats: { beat_direct: { shotOrder: ['shot_direct'] } },
      },
    });
    onProjectCommitted.mockClear();

    await expect(store.listProposalsV2(project.id)).resolves.toEqual([]);
    const proposalPaths = await store.resolveProposalPathsV2(project.id);
    const { projectDir, pendingDir } = proposalPaths;
    const server = new McpServer({ name: 'studio-v2-integration', version: '2.0.0' });
    registerStudioToolsV2(server, {
      projectId: project.id,
      projectDir,
      pendingDir,
      referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
    });
    const client = new Client({ name: 'studio-v2-integration-client', version: '2.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const proposed = await client.callTool({
        name: 'propose_storyboard',
        arguments: {
          base_revision: seeded.project.revision,
          operations: [
            {
              kind: 'edit_shot',
              shotId: 'shot_direct',
              changes: { shootingScript: 'Reviewed shooting script' },
            },
          ],
        },
      });
      expect(proposed.isError).not.toBe(true);

      const proposals = await store.listProposalsV2(project.id);
      expect(proposals).toHaveLength(1);
      const proposal = proposals[0];
      if (proposal === undefined) throw new Error('schema-2 proposal was not listed');
      expect(proposal).toMatchObject({
        projectId: project.id,
        status: 'pending',
        baseRevision: seeded.project.revision,
        payload: {
          kind: 'mutation_batch',
          operations: [
            {
              kind: 'edit_shot',
              shotId: 'shot_direct',
              changes: { shootingScript: 'Reviewed shooting script' },
            },
          ],
        },
      });

      const fixedReasons = [
        'owned_asset',
        'owned_job',
        'video_asset',
        'seed_still',
        'conditioning_frame',
        'conditioning_input',
        'shooting_script',
      ] as const;
      const fixedProposalResult = await client.callTool({
        name: 'propose_storyboard',
        arguments: {
          base_revision: seeded.project.revision,
          operations: [
            {
              kind: 'apply_coverage',
              beatId: 'beat_direct',
              shots: [
                {
                  shotId: 'shot_direct',
                  shootingScript: 'Initial shooting script',
                  durationSeconds: 5,
                  chainBreak: 'none',
                },
              ],
              fixedShots: [{ shotId: 'shot_direct', reasons: fixedReasons }],
            },
          ],
        },
      });
      expect(fixedProposalResult.isError, JSON.stringify(fixedProposalResult.content)).not.toBe(true);
      const fixedProjection = (await store.listProposalsV2(project.id)).find(
        (candidate) => candidate.id !== proposal.id
      );
      expect(fixedProjection).toMatchObject({
        status: 'pending',
        baseRevision: seeded.project.revision,
        payload: {
          kind: 'mutation_batch',
          operations: [
            {
              kind: 'apply_coverage',
              beatId: 'beat_direct',
              fixedShots: [{ shotId: 'shot_direct', reasons: fixedReasons }],
            },
          ],
        },
      });

      const providerAndSpendState = {
        assets: seeded.project.assets,
        jobs: seeded.project.jobs,
        spendPolicy: seeded.project.spendPolicy,
        spendAuthorizations: seeded.project.spendAuthorizations,
        frameExtractions: seeded.project.frameExtractions,
        imageRouteId: seeded.project.imageRouteId,
        videoRouteId: seeded.project.videoRouteId,
      };
      const accepted = await store.acceptProposalV2(project.id, proposal.id);
      expect(accepted).toMatchObject({
        applied: true,
        proposal: { id: proposal.id, status: 'accepted' },
        project: {
          revision: seeded.project.revision + 1,
          shots: {
            shot_direct: {
              shootingScript: 'Reviewed shooting script',
            },
          },
          ...providerAndSpendState,
        },
      });
      expect(onProjectCommitted).toHaveBeenCalledExactlyOnceWith({
        projectId: project.id,
        previousRevision: seeded.project.revision,
        committedRevision: seeded.project.revision + 1,
        committedAt: expect.any(String),
        commitTag: `proposal:${proposal.id}`,
      });

      const restartedCommit = vi.fn();
      const restartedStore = createCreativeStudioStore({ rootDir, onProjectCommitted: restartedCommit });
      const retried = await restartedStore.acceptProposalV2(project.id, proposal.id);
      expect(retried).toMatchObject({
        applied: false,
        proposal: { id: proposal.id, status: 'accepted' },
        project: {
          revision: seeded.project.revision + 1,
          shots: { shot_direct: { shootingScript: 'Reviewed shooting script' } },
          ...providerAndSpendState,
        },
      });
      expect(restartedCommit).not.toHaveBeenCalled();
      await expect(restartedStore.listProposalsV2(project.id)).resolves.toEqual([
        expect.objectContaining({ id: proposal.id, status: 'accepted' }),
        fixedProjection,
      ]);
      const proposalSlots = await readdir(path.join(projectDir, 'proposals', 'slots'));
      expect(proposalSlots.filter((name) => /^(?:0|[1-9]\d*)\.slot$/.test(name))).toHaveLength(1);
      expect(proposalSlots.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
      expect(proposalSlots.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('keeps a reviewed MCP reference generation handoff open across restart without project, spend, or provider work', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-reference-v2-'));
    roots.push(rootDir);
    const onProjectCommitted = vi.fn();
    const store = createCreativeStudioStore({
      rootDir,
      createId: idSequence(['project_v2_reference', 'handoff_v2_reference']),
      onProjectCommitted,
    });
    const project = await store.createProjectV2({
      name: 'Director V2 reference lifecycle',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 10,
      resolution: '720p',
    });
    const seeded = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [
          {
            kind: 'add_beat',
            beatId: 'beat_reference',
            beat: {
              title: 'Reference sequence',
              story: 'Establish the visual language in warm practical light.',
              targetSeconds: null,
            },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'beat_reference',
            shotId: 'shot_reference_1',
            shot: {
              shootingScript: 'Wide establishing frame',
              durationSeconds: 5,
            },
            beforeShotId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'beat_reference',
            shotId: 'shot_reference_2',
            shot: {
              shootingScript: 'Close product detail',
              durationSeconds: 5,
            },
            beforeShotId: null,
          },
          {
            kind: 'set_reference_plan',
            references: [
              {
                kind: 'character',
                label: 'Establishing character',
                prompt: 'Character reference for the establishing frame.',
              },
              {
                kind: 'character',
                label: 'Product character',
                prompt: 'Character reference for the product detail.',
              },
            ],
          },
        ],
      },
      { mutationId: 'seed_reference_shots', capturedAt: new Date().toISOString() },
      'seed:reference-shots'
    );
    const [establishingReferenceId, productReferenceId] = seeded.project.referenceOrder;
    if (establishingReferenceId === undefined || productReferenceId === undefined) {
      throw new Error('expected two app-owned reference identities');
    }
    const referenceIds = [establishingReferenceId, productReferenceId];
    onProjectCommitted.mockClear();

    const providerResolver = { listGenerationRoutes: vi.fn() };
    const jobManager = {
      dispatchAuthorizedJobsV2: vi.fn(),
      cancelJobV2: vi.fn(),
      retryJobV2: vi.fn(),
      retryDownloadV2: vi.fn(),
    };
    const onProjectUpdated = vi.fn();
    const createService = (serviceStore: ReturnType<typeof createCreativeStudioStore>) =>
      createCreativeStudioServiceV2({
        store: serviceStore,
        providerResolver: providerResolver as never,
        jobManager: jobManager as never,
        onProjectUpdated,
      });
    const service = createService(store);
    const referencePaths = await store.resolveReferenceRequestPathsV2(project.id);
    const server = new McpServer({ name: 'studio-v2-reference-integration', version: '2.0.0' });
    registerStudioToolsV2(server, {
      projectId: project.id,
      projectDir: referencePaths.projectDir,
      pendingDir: path.join(referencePaths.projectDir, 'proposals', 'pending'),
      referencePendingDir: referencePaths.pendingDir,
    });
    const client = new Client({ name: 'studio-v2-reference-integration-client', version: '2.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const requested = await client.callTool({
        name: 'studio_request_reference_images',
        arguments: { referenceIds },
      });
      expect(requested.isError).not.toBe(true);
      expect(requested.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('Nothing was generated') }),
      ]);

      const pendingEntries = await store.listReferenceRequestsV2(project.id);
      expect(pendingEntries).toHaveLength(1);
      const pending = pendingEntries[0];
      if (pending === undefined) throw new Error('schema-2 reference request was not listed');
      expect(pending).toEqual({
        request: expect.objectContaining({
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          projectId: project.id,
          referenceIds,
          status: 'pending',
        }),
        decision: null,
        receipt: null,
      });
      await expect(service.listReferenceRequests({ projectId: project.id })).resolves.toEqual([pending.request]);

      const decided = await store.decideReferenceRequestV2({
        projectId: project.id,
        requestId: pending.request.id,
        expectedRevision: seeded.project.revision,
        outcome: { kind: 'generation_gate' },
      });
      expect(decided).toMatchObject({
        request: { id: pending.request.id, referenceIds },
        decision: {
          requestId: pending.request.id,
          projectId: project.id,
          outcome: {
            kind: 'generation_gate',
            handoffId: 'handoff_v2_reference',
            referenceIds,
          },
        },
        receipt: null,
      });
      await expect(service.listReferenceRequests({ projectId: project.id })).resolves.toEqual([]);
      const handoffs = await service.listReferenceGenerationHandoffs({ projectId: project.id });
      expect(handoffs).toEqual([
        {
          handoffId: 'handoff_v2_reference',
          requestId: pending.request.id,
          referenceIds,
          decidedAt: expect.any(String),
          status: 'awaiting_spend',
          completedAt: null,
          counts: { queued: 0, running: 0, succeeded: 0, failed: 0 },
          resultAssetIds: [],
          failedReferenceIds: [],
        },
      ]);
      expect(Object.keys(handoffs[0]!)).toEqual([
        'handoffId',
        'requestId',
        'referenceIds',
        'decidedAt',
        'status',
        'counts',
        'resultAssetIds',
        'failedReferenceIds',
        'completedAt',
      ]);

      const restartedCommit = vi.fn();
      const restartedStore = createCreativeStudioStore({ rootDir, onProjectCommitted: restartedCommit });
      await expect(
        restartedStore.readReferenceGenerationHandoffV2(project.id, 'handoff_v2_reference')
      ).resolves.toEqual({ request: pending.request, decision: decided.decision, receipt: null });
      const restartedService = createService(restartedStore);
      await expect(restartedService.listReferenceGenerationHandoffs({ projectId: project.id })).resolves.toEqual(
        handoffs
      );
      restartedService.dispose();

      await expect(restartedStore.getProjectV2(project.id)).resolves.toEqual({
        status: 'supported',
        project: seeded.project,
      });
      const referenceSlots = await readdir(path.join(referencePaths.projectDir, 'reference-requests', 'slots'));
      expect(referenceSlots.filter((name) => name === '0.slot')).toEqual(['0.slot']);
      expect(referenceSlots.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
      expect(referenceSlots.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
      expect(onProjectCommitted).not.toHaveBeenCalled();
      expect(restartedCommit).not.toHaveBeenCalled();
      expect(onProjectUpdated).not.toHaveBeenCalled();
      expect(providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
      expect(jobManager.dispatchAuthorizedJobsV2).not.toHaveBeenCalled();
      expect(jobManager.cancelJobV2).not.toHaveBeenCalled();
      expect(jobManager.retryJobV2).not.toHaveBeenCalled();
      expect(jobManager.retryDownloadV2).not.toHaveBeenCalled();
    } finally {
      service.dispose();
      await server.close();
    }
  });

  it('repairs a free refused-job recovery receipt after publication failure without replaying its commit', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-free-recovery-repair-'));
    roots.push(rootDir);
    const tracker = createStudioDirectorCommitTrackerV2();
    const commitFacts: StudioProjectCommitFacts[] = [];
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_free_recovery_repair',
      onProjectCommitted: (facts) => {
        commitFacts.push(facts);
        tracker.observe(facts);
      },
    });
    const project = await store.createProjectV2({
      name: 'Director free recovery repair',
      brief: 'A refused job is waiting for free terminalization.',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    commitFacts.length = 0;
    const mailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      watchCommandTree: () => ({ close: () => undefined }),
    });
    await mailbox.ensure(project.id);
    let receiptWriteAttempts = 0;
    const processorMailbox: StudioDirectorCommandMailboxV2 = {
      ...mailbox,
      writeReceipt: async (projectId, receipt) => {
        receiptWriteAttempts += 1;
        if (receiptWriteAttempts === 1) throw new Error('injected free-recovery receipt publication failure');
        await mailbox.writeReceipt(projectId, receipt);
      },
    };
    const recovery = { op: 'terminalize_refused_job' as const, jobId: 'job_refused' };
    const reducerService = createStudioDirectorCommandServiceV2({ store });
    // Job-state eligibility is covered at the real job-manager boundary. This seam isolates the
    // command lifecycle while still committing through the real store with the command tag.
    const terminalizeRefusedJob = vi.fn(async (input: StudioJobRequest, commitTag: string) =>
      store.updateProjectV2(
        input.projectId,
        (current) => {
          current.brief = `Terminalized ${input.jobId}`;
          return current;
        },
        input.expectedRevision,
        commitTag
      )
    );
    const onProjectUpdated = vi.fn();
    const processor = createStudioDirectorCommandProcessorV2({
      store,
      mailbox: processorMailbox,
      service: {
        ...reducerService,
        getProjectStatus: async ({ projectId }) =>
          refusedJobRecoveryStatusV2(projectId, project.revision, recovery.jobId),
        listRoutes: async () => {
          throw new Error('route inventory must not be read by free recovery');
        },
        retryConditioningFrame: async () => {
          throw new Error('conditioning recovery must not run for a refused job');
        },
        terminalizeRefusedJob,
      },
      tracker,
      onProjectUpdated,
    });
    await processor.start();
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('free-recovery project directory missing');
    const commandId = 'command_free_recovery_repair';
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: project.id, projectDir },
      { createId: idSequence([commandId, 'lease_free_recovery_repair']) }
    );
    const pendingFile = path.join(projectDir, 'commands', 'pending', `${commandId}.json`);
    const slotFile = path.join(projectDir, 'commands', 'slots', '0.slot');
    const applying = writer.applyFreeFix({ expectedRevision: project.revision, recovery });
    await waitForCondition(async () => ((await fileExists(pendingFile)) ? true : null), 'free-recovery pending');

    processor.trigger(project.id, commandId);
    await waitForCondition(
      () => (receiptWriteAttempts === 1 && commitFacts.length === 1 ? true : null),
      'failed first recovery receipt publication'
    );
    expect(terminalizeRefusedJob).toHaveBeenCalledExactlyOnceWith(
      { projectId: project.id, expectedRevision: project.revision, jobId: recovery.jobId },
      commandId
    );
    expect(commitFacts).toEqual([
      expect.objectContaining({
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: project.revision + 1,
        commitTag: commandId,
      }),
    ]);
    expect(await fileExists(pendingFile)).toBe(true);

    processor.trigger(project.id, commandId);
    const expectedReceipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId,
      projectId: project.id,
      expectedRevision: project.revision,
      decidedAt: commitFacts[0]!.committedAt,
      status: 'applied' as const,
      appliedRevision: project.revision + 1,
      recovery,
    };
    await expect(applying).resolves.toEqual(expectedReceipt);
    await expect(mailbox.readReceipt(project.id, commandId)).resolves.toEqual({
      status: 'valid',
      record: expectedReceipt,
    });
    await waitForCondition(
      async () => (!(await fileExists(pendingFile)) && !(await fileExists(slotFile)) ? true : null),
      'free-recovery receipt-first cleanup'
    );
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1, brief: `Terminalized ${recovery.jobId}` },
    });

    processor.trigger(project.id, commandId);
    await processor.stop();
    expect(terminalizeRefusedJob).toHaveBeenCalledOnce();
    expect(commitFacts).toHaveLength(1);
    expect(receiptWriteAttempts).toBe(2);
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
    expect(await readdir(path.join(projectDir, 'commands', 'pending'))).toEqual([]);
    expect(await readdir(path.join(projectDir, 'commands', 'slots'))).toEqual([]);
  });

  it('repairs the real CAS crash window after receipt publication fails without replaying the reducer', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-lifecycle-v2-repair-'));
    roots.push(rootDir);
    const tracker = createStudioDirectorCommitTrackerV2();
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_v2_repair',
      onProjectCommitted: tracker.observe,
    });
    const project = await store.createProjectV2({
      name: 'Director V2 repair',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const mailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      watchCommandTree: () => ({ close: () => undefined }),
    });
    await mailbox.ensure(project.id);
    let failReceipt = true;
    const processorMailbox: StudioDirectorCommandMailboxV2 = {
      ...mailbox,
      writeReceipt: async (projectId, receipt) => {
        if (failReceipt) {
          failReceipt = false;
          throw new Error('injected schema-2 receipt publication failure');
        }
        await mailbox.writeReceipt(projectId, receipt);
      },
    };
    const service = createStudioDirectorCommandServiceV2({ store });
    const apply = vi.fn(service.apply);
    const onProjectUpdated = vi.fn();
    const processor = createStudioDirectorCommandProcessorV2({
      store,
      mailbox: processorMailbox,
      service: { apply },
      tracker,
      onProjectUpdated,
    });
    await processor.start();
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('schema-2 project directory missing');
    const commandId = 'command_v2_repair';
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: project.id, projectDir },
      { createId: idSequence([commandId, 'lease_v2_repair']) }
    );
    const pendingFile = path.join(projectDir, 'commands', 'pending', `${commandId}.json`);
    const applying = writer.apply({
      expectedRevision: project.revision,
      operations: [{ kind: 'set_brief', brief: 'Committed once, receipt repaired' }],
    });
    await waitForCondition(async () => ((await fileExists(pendingFile)) ? true : null), 'schema-2 repair pending');
    processor.trigger(project.id, commandId);

    await expect(applying).resolves.toMatchObject({ status: 'applied', appliedRevision: project.revision + 1 });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        revision: project.revision + 1,
        brief: 'Committed once, receipt repaired',
      },
    });
    expect(apply).toHaveBeenCalledOnce();
    await waitForCondition(
      () => (onProjectUpdated.mock.calls.length === 1 ? true : null),
      'schema-2 repaired notification'
    );
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
    await processor.stop();
  });
});
