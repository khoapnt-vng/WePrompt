/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioMutationBatchV2,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createStudioQuotedGenerationId,
  deriveStudioInstructionProfileV2,
  studioGenerationCompositionDigestV2,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  applyStudioMutationBatchV2,
  createStudioProjectReferenceIdV2,
  StudioMutationErrorV2,
  type StudioMutationReasonV2,
  validateStudioMutationOperationV2,
} from '@/process/services/creative-studio/service/schema2/mutations';
import { validateStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/validation';

const timestamp = '2026-08-17T00:00:00.000Z';
const laterTimestamp = '2026-08-17T00:00:01.000Z';
const digest = 'a'.repeat(64);
const provider = { providerId: 'provider_image', adapterId: 'weprompt-image-v1', model: 'model_1' } as const;
const videoProvider = {
  providerId: 'provider_video',
  adapterId: 'openrouter-video-v1',
  model: 'video_model_1',
} as const;

const makeShot = (id: string): StudioProjectV2['shots'][string] => ({
  id,
  shootingScript: '',
  durationSeconds: 5,
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

const makeProject = (): StudioProjectV2 => {
  const project = createEmptyStudioProjectV2(
    {
      name: 'Project One',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'project_1',
    timestamp
  );
  project.revision = 7;
  project.beatOrder = ['beat_1', 'beat_2'];
  project.beats = {
    beat_1: { id: 'beat_1', title: '', story: '', targetSeconds: null, shotOrder: ['shot_1', 'shot_2'] },
    beat_2: { id: 'beat_2', title: '', story: '', targetSeconds: null, shotOrder: [] },
  };
  project.shots = { shot_1: makeShot('shot_1'), shot_2: makeShot('shot_2') };
  expect(validateStudioProjectV2(project)).toBe(true);
  return project;
};

const mutationBatch = (project: StudioProjectV2, operations: StudioMutationOperationV2[]): StudioMutationBatchV2 => ({
  schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  projectId: project.id,
  expectedRevision: project.revision,
  operations,
});

const apply = (
  project: StudioProjectV2,
  operations: StudioMutationOperationV2[],
  mutationId = 'mutation_1',
  capturedAt = laterTimestamp
) => applyStudioMutationBatchV2(project, mutationBatch(project, operations), { mutationId, capturedAt });

const persist = (project: StudioProjectV2): StudioProjectV2 => {
  const persisted = structuredClone(project);
  persisted.revision += 1;
  expect(validateStudioProjectV2(persisted)).toBe(true);
  return persisted;
};

const expectReason = (
  project: StudioProjectV2,
  operations: StudioMutationOperationV2[],
  reasonCode: StudioMutationReasonV2
): void => {
  const before = structuredClone(project);
  expect(() => apply(project, operations, 'mutation_rejected')).toThrow(
    expect.objectContaining({ name: 'StudioMutationErrorV2', reasonCode })
  );
  expect(project).toEqual(before);
};

const importImage = (project: StudioProjectV2, shotId: string, assetId: string): StudioAssetV2 => {
  const asset: StudioAssetV2 = {
    id: assetId,
    projectId: project.id,
    shotId,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'imports', fileName: `${assetId}.png` },
    byteSize: 1,
    sha256: digest,
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: null,
    compositionDigest: null,
    createdAt: timestamp,
  };
  project.assets[assetId] = asset;
  project.shots[shotId]!.assetIds.push(assetId);
  return asset;
};

const addSucceededVideoTake = (project: StudioProjectV2, shotId: string, assetId: string): StudioAssetV2 => {
  const shot = project.shots[shotId]!;
  shot.shootingScript ||= shotId;
  const seed = project.assets[`seed_${shotId}`] ?? importImage(project, shotId, `seed_${shotId}`);
  shot.seedStillId = seed.id;
  const boundReferenceIds =
    shot.referenceBinding.status === 'ready'
      ? [
          ...shot.referenceBinding.characterReferenceIds,
          ...(shot.referenceBinding.backgroundReferenceId === null
            ? []
            : [shot.referenceBinding.backgroundReferenceId]),
        ]
      : [];
  const referenceInputs = boundReferenceIds.map((referenceId) => {
    const reference = project.references[referenceId];
    const referenceAsset =
      reference?.approvedAssetId === null || reference === undefined
        ? undefined
        : project.assets[reference.approvedAssetId];
    if (referenceAsset === undefined) throw new Error('video fixture requires approved bound references');
    return {
      referenceId,
      kind: reference.kind,
      assetId: referenceAsset.id,
      sha256: referenceAsset.sha256,
    };
  });
  const composition = composeStudioGenerationV2({
    projectRevision: project.revision,
    brief: project.brief,
    rules: project.rules,
    source: {
      kind: 'shot',
      beatId: 'beat_1',
      story: project.beats.beat_1!.story,
      shotId,
      shootingScript: shot.shootingScript,
    },
    purpose: 'video_take',
    referenceInputs,
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    route: videoProvider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(videoProvider, 'video_take', {
      kind: 'shot',
      beatId: 'beat_1',
      story: project.beats.beat_1!.story,
      shotId,
      shootingScript: shot.shootingScript,
    }),
  });
  const target = { kind: 'shot' as const, shotId };
  const requestPlan = {
    kind: 'resolved' as const,
    snapshot: {
      composition,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      durationSeconds: shot.durationSeconds,
      referenceInputs,
      conditioningInput: { kind: 'seed_still' as const, assetId: seed.id },
    },
  };
  const item = {
    id: createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision: project.revision,
      target,
      purpose: 'video_take',
    }),
    target,
    purpose: 'video_take' as const,
    routeId: 'video_route',
    generationCount: 1,
    requestPlan,
    rateUnit: 'second' as const,
    rateMinorUnits: 2,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (!totals) throw new Error('video fixture quote is invalid');
  const authorization = {
    id: `auth_${assetId}`,
    projectId: project.id,
    projectRevision: project.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    ...totals,
    expiresAt: '2026-08-17T00:05:00.000Z',
    confirmedAt: laterTimestamp,
    providerBindings: [{ itemId: item.id, provider: videoProvider }],
    idempotencyKeys: [{ itemId: item.id, key: `idem_${assetId}` }],
  };
  const jobId = `job_${assetId}`;
  const asset: StudioAssetV2 = {
    id: assetId,
    projectId: project.id,
    shotId,
    mediaKind: 'video',
    mimeType: 'video/mp4',
    managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
    byteSize: 1,
    sha256: digest,
    durationSeconds: shot.durationSeconds,
    projectReferenceId: null,
    generationReferenceAssetIds: referenceInputs.map(({ assetId: referenceAssetId }) => referenceAssetId),
    producerJobId: jobId,
    compositionDigest: studioGenerationCompositionDigestV2(composition),
    createdAt: laterTimestamp,
  };
  project.assets[assetId] = asset;
  project.jobs[jobId] = {
    id: jobId,
    projectId: project.id,
    target,
    status: 'succeeded',
    provider: videoProvider,
    idempotencyKey: `idem_${assetId}`,
    providerJobId: `remote_${assetId}`,
    remoteStartedAt: timestamp,
    cancellationPolicy: 'queued_and_running',
    outputAssetIds: [assetId],
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: timestamp,
    updatedAt: laterTimestamp,
    purpose: 'video_take',
    authorizationId: authorization.id,
    authorizationItemId: item.id,
    composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: 'video_take',
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: shot.durationSeconds,
      generationCount: 1,
      totalMinorUnits: totals.upperMinorUnits,
    },
    outputAssetIdsByRole: { primary: assetId, poster: null },
  };
  project.spendAuthorizations.push(authorization);
  shot.assetIds.push(assetId);
  shot.jobIds.push(jobId);
  if (shot.videoAssetId !== null) shot.supersededVideoAssetIds.push(shot.videoAssetId);
  shot.videoAssetId = assetId;
  project.revision += 1;
  expect(validateStudioProjectV2(project)).toBe(true);
  return asset;
};

const addFailedSeedJobWithBoundReferences = (project: StudioProjectV2, shotId: string, suffix: string): void => {
  const shot = project.shots[shotId]!;
  shot.shootingScript ||= shotId;
  if (shot.referenceBinding.status !== 'ready') throw new Error('seed fixture requires a ready binding');
  const referenceInputs = [
    ...shot.referenceBinding.characterReferenceIds,
    ...(shot.referenceBinding.backgroundReferenceId === null ? [] : [shot.referenceBinding.backgroundReferenceId]),
  ].map((referenceId) => {
    const reference = project.references[referenceId];
    const asset = reference?.approvedAssetId ? project.assets[reference.approvedAssetId] : undefined;
    if (reference === undefined || asset === undefined) throw new Error('seed fixture requires approved references');
    return { referenceId, kind: reference.kind, assetId: asset.id, sha256: asset.sha256 };
  });
  const source = {
    kind: 'shot' as const,
    beatId: 'beat_1',
    story: project.beats.beat_1!.story,
    shotId,
    shootingScript: shot.shootingScript,
  };
  const composition = composeStudioGenerationV2({
    projectRevision: project.revision,
    brief: project.brief,
    rules: project.rules,
    source,
    purpose: 'seed_still',
    referenceInputs,
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    route: provider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, 'seed_still', source),
  });
  const target = { kind: 'shot' as const, shotId };
  const requestPlan = {
    kind: 'resolved' as const,
    snapshot: {
      composition,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      durationSeconds: shot.durationSeconds,
      referenceInputs,
      conditioningInput: null,
    },
  };
  const item = {
    id: createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision: project.revision,
      target,
      purpose: 'seed_still',
    }),
    target,
    purpose: 'seed_still' as const,
    routeId: 'image_route',
    generationCount: 1,
    requestPlan,
    rateUnit: 'generation' as const,
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (!totals) throw new Error('seed fixture quote is invalid');
  const authorizationId = `auth_${suffix}`;
  const jobId = `job_${suffix}`;
  const authorization: StudioSpendAuthorization = {
    id: authorizationId,
    projectId: project.id,
    projectRevision: project.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    ...totals,
    expiresAt: '2026-08-17T00:05:00.000Z',
    confirmedAt: laterTimestamp,
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, key: `idem_${suffix}` }],
  };
  project.spendAuthorizations.push(authorization);
  project.jobs[jobId] = {
    id: jobId,
    projectId: project.id,
    target,
    status: 'failed',
    provider,
    idempotencyKey: `idem_${suffix}`,
    providerJobId: `remote_${suffix}`,
    remoteStartedAt: timestamp,
    cancellationPolicy: 'queued_and_running',
    outputAssetIds: [],
    error: { code: 'no_output', messageKey: 'conversation.creativeStudio.jobs.errors.noOutput' },
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: timestamp,
    updatedAt: laterTimestamp,
    purpose: 'seed_still',
    authorizationId,
    authorizationItemId: item.id,
    composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: {
      authorizationId,
      itemId: item.id,
      jobId,
      purpose: 'seed_still',
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: item.rateMinorUnits,
    },
    outputAssetIdsByRole: { primary: null, poster: null },
  };
  shot.jobIds.push(jobId);
  project.revision += 1;
  expect(validateStudioProjectV2(project)).toBe(true);
};

const addReferenceCandidate = (project: StudioProjectV2, referenceId: string, assetId: string): void => {
  const reference = project.references[referenceId];
  if (!reference) throw new Error('candidate fixture requires a planned reference');
  const source = {
    kind: 'project_reference' as const,
    referenceId,
    referenceKind: reference.kind,
    prompt: reference.prompt,
  };
  const composition = composeStudioGenerationV2({
    projectRevision: project.revision,
    brief: project.brief,
    rules: project.rules,
    source,
    purpose: 'reference_image',
    referenceInputs: [],
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    route: provider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, 'reference_image', source),
  });
  const target = { kind: 'reference' as const, referenceId };
  const requestPlan = {
    kind: 'resolved' as const,
    snapshot: {
      composition,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      durationSeconds: 5,
      referenceInputs: [],
      conditioningInput: null,
    },
  };
  const item = {
    id: createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision: project.revision,
      target,
      purpose: 'reference_image',
    }),
    target,
    purpose: 'reference_image' as const,
    routeId: 'image_route',
    generationCount: 1,
    requestPlan,
    rateUnit: 'generation' as const,
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (!totals) throw new Error('candidate fixture quote is invalid');
  const authorization = {
    id: `auth_${assetId}`,
    projectId: project.id,
    projectRevision: project.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    ...totals,
    expiresAt: '2026-08-17T00:05:00.000Z',
    confirmedAt: laterTimestamp,
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, key: `idem_${assetId}` }],
  };
  const jobId = `job_${assetId}`;
  project.assets[assetId] = {
    id: assetId,
    projectId: project.id,
    shotId: null,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'assets', fileName: `${assetId}.png` },
    byteSize: 1,
    sha256: digest,
    projectReferenceId: referenceId,
    generationReferenceAssetIds: [],
    producerJobId: jobId,
    compositionDigest: studioGenerationCompositionDigestV2(composition),
    createdAt: timestamp,
  };
  project.jobs[jobId] = {
    id: jobId,
    projectId: project.id,
    target,
    status: 'succeeded',
    provider,
    idempotencyKey: `idem_${assetId}`,
    providerJobId: `remote_${assetId}`,
    remoteStartedAt: timestamp,
    cancellationPolicy: 'queued_and_running',
    outputAssetIds: [assetId],
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    purpose: 'reference_image',
    authorizationId: authorization.id,
    authorizationItemId: item.id,
    composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: 'reference_image',
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: item.rateMinorUnits,
    },
    outputAssetIdsByRole: { primary: assetId, poster: null },
  };
  project.spendAuthorizations.push(authorization);
  reference.jobIds.push(jobId);
  if (reference.approvedAssetId !== null) reference.supersededAssetIds.push(reference.approvedAssetId);
  reference.approvedAssetId = assetId;
  reference.updatedAt = laterTimestamp;
  project.revision += 1;
  expect(validateStudioProjectV2(project)).toBe(true);
};

const addQueuedReferenceJob = (project: StudioProjectV2, referenceId: string, suffix: string): void => {
  const reference = project.references[referenceId];
  if (!reference) throw new Error('queued reference fixture requires a planned reference');
  const source = {
    kind: 'project_reference' as const,
    referenceId,
    referenceKind: reference.kind,
    prompt: reference.prompt,
  };
  const composition = composeStudioGenerationV2({
    projectRevision: project.revision,
    brief: project.brief,
    rules: project.rules,
    source,
    purpose: 'reference_image',
    referenceInputs: [],
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    route: provider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, 'reference_image', source),
  });
  const target = { kind: 'reference' as const, referenceId };
  const requestPlan = {
    kind: 'resolved' as const,
    snapshot: {
      composition,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      durationSeconds: 5,
      referenceInputs: [],
      conditioningInput: null,
    },
  };
  const item = {
    id: createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision: project.revision,
      target,
      purpose: 'reference_image',
    }),
    target,
    purpose: 'reference_image' as const,
    routeId: 'image_route',
    generationCount: 1,
    requestPlan,
    rateUnit: 'generation' as const,
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (!totals) throw new Error('queued reference quote is invalid');
  const authorizationId = `auth_${suffix}`;
  const jobId = `job_${suffix}`;
  const idempotencyKey = `idem_${suffix}`;
  project.spendAuthorizations.push({
    id: authorizationId,
    projectId: project.id,
    projectRevision: project.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    ...totals,
    expiresAt: '2026-08-17T00:05:00.000Z',
    confirmedAt: laterTimestamp,
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, key: idempotencyKey }],
  });
  project.jobs[jobId] = {
    id: jobId,
    projectId: project.id,
    target,
    status: 'queued_local',
    provider,
    idempotencyKey,
    providerJobId: null,
    remoteStartedAt: null,
    cancellationPolicy: 'queued_and_running',
    outputAssetIds: [],
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    purpose: 'reference_image',
    authorizationId,
    authorizationItemId: item.id,
    composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: null,
    outputAssetIdsByRole: { primary: null, poster: null },
  };
  reference.jobIds.push(jobId);
  project.revision += 1;
  expect(validateStudioProjectV2(project)).toBe(true);
};

const operationSamples: StudioMutationOperationV2[] = [
  { kind: 'edit_project', changes: { name: 'Renamed' } },
  { kind: 'set_brief', brief: 'Brief' },
  { kind: 'set_rules', rules: [] },
  { kind: 'set_reference_plan', references: [] },
  {
    kind: 'amend_reference_plan',
    additions: [{ kind: 'background', label: 'Market', prompt: 'A recurring night market.' }],
  },
  { kind: 'set_reference_label', referenceId: 'ref_1', label: 'Updated name' },
  { kind: 'set_reference_prompt', referenceId: 'ref_1', prompt: 'Updated prompt' },
  { kind: 'select_reference_image', referenceId: 'ref_1', assetId: 'asset_1' },
  { kind: 'remove_reference_image', referenceId: 'ref_1', assetId: 'asset_1' },
  { kind: 'set_shot_reference_binding', shotId: 'shot_1', characterReferenceIds: [], backgroundReferenceId: null },
  {
    kind: 'add_beat',
    beatId: 'beat_3',
    beat: { title: 'Third', story: 'Story', targetSeconds: null },
    beforeBeatId: null,
  },
  { kind: 'edit_beat', beatId: 'beat_1', changes: { story: 'Story' } },
  { kind: 'reorder_beats', beatOrder: ['beat_2', 'beat_1'] },
  { kind: 'park_beat', beatId: 'beat_2' },
  { kind: 'restore_beat', beatId: 'beat_2', beforeBeatId: null },
  { kind: 'add_binned_beat', beatId: 'beat_3', beat: { title: 'Third', story: '', targetSeconds: null } },
  {
    kind: 'add_shot',
    beatId: 'beat_1',
    shotId: 'shot_3',
    shot: { shootingScript: 'Script', durationSeconds: 5 },
    beforeShotId: null,
  },
  { kind: 'edit_shot', shotId: 'shot_1', changes: { shootingScript: 'Script' } },
  { kind: 'delete_shot', shotId: 'shot_2' },
  { kind: 'park_shot', shotId: 'shot_2' },
  { kind: 'restore_shot', shotId: 'shot_2', beforeShotId: null },
  { kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot_2', 'shot_1'] },
  { kind: 'apply_coverage', beatId: 'beat_1', shots: [], fixedShots: [] },
  { kind: 'set_hard_cut', shotId: 'shot_2', hardCut: true },
  { kind: 'set_seed_still', shotId: 'shot_1', assetId: null },
  { kind: 'dismiss_seed_still', shotId: 'shot_1', assetId: 'seed_1' },
  { kind: 'select_video_take', shotId: 'shot_1', assetId: 'video_1' },
  { kind: 'remove_video_take', shotId: 'shot_1', assetId: 'video_1' },
  { kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: 'board_1' },
  { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: null, trimOutSeconds: null },
  { kind: 'reorder_bin', bin: [] },
  { kind: 'set_routes', imageRouteId: null, videoRouteId: null },
  { kind: 'set_spend_policy', policy: null },
  { kind: 'set_bed', assetId: null },
  { kind: 'undo_last', entryId: 'undo_1' },
];

describe('schema-5 mutation operation contract', () => {
  it('contains exactly the 35 current operations and validates each exact envelope', () => {
    expect(operationSamples).toHaveLength(35);
    expect(new Set(operationSamples.map(({ kind }) => kind))).toHaveLength(35);
    for (const operation of operationSamples) expect(validateStudioMutationOperationV2(operation)).toBe(true);
  });

  it.each([
    'redetach_line',
    'rederive_line',
    'restore_line',
    'set_project_references',
    'set_shot_background_reference',
  ])('rejects retired operation %s', (kind) => expect(validateStudioMutationOperationV2({ kind })).toBe(false));

  it.each([
    { kind: 'edit_beat', beatId: 'beat_1', changes: { action: 'Retired' } },
    { kind: 'edit_beat', beatId: 'beat_1', changes: { look: 'Retired' } },
    { kind: 'edit_shot', shotId: 'shot_1', changes: { line: 'Retired' } },
    { kind: 'edit_shot', shotId: 'shot_1', changes: { narration: 'Retired' } },
    { kind: 'edit_shot', shotId: 'shot_1', changes: { onScreenText: 'Retired' } },
  ])('rejects a retired authoring field in $kind', (operation) => {
    expect(validateStudioMutationOperationV2(operation)).toBe(false);
  });

  it('rejects malformed exact envelopes across every current operation family', () => {
    const malformed: unknown[] = [
      null,
      { kind: 'edit_project', changes: null },
      { kind: 'edit_project', changes: { name: '' } },
      { kind: 'set_brief', brief: 1 },
      { kind: 'set_rules', rules: {} },
      {
        kind: 'set_rules',
        rules: [
          { id: 'rule_1', text: 'Rule', predicate: null },
          { id: 'rule_1', text: 'Duplicate', predicate: null },
        ],
      },
      { kind: 'set_reference_plan', references: {} },
      {
        kind: 'set_reference_plan',
        references: [
          { id: 'ref_1', kind: 'character', label: 'Ming', prompt: 'Ming.' },
          { id: 'ref_1', kind: 'character', label: 'Mei', prompt: 'Mei.' },
        ],
      },
      {
        kind: 'set_reference_plan',
        references: [
          { kind: 'background', label: 'Market', prompt: 'Market.' },
          { kind: 'character', label: 'Ming', prompt: 'Ming.' },
        ],
      },
      { kind: 'amend_reference_plan', additions: [] },
      {
        kind: 'amend_reference_plan',
        additions: [{ kind: 'character', label: 'Ming', prompt: 'Ming.' }],
      },
      {
        kind: 'amend_reference_plan',
        additions: [{ id: 'director_id', kind: 'background', label: 'Market', prompt: 'Market.' }],
      },
      { kind: 'set_reference_label', referenceId: '', label: 'Updated name' },
      { kind: 'set_reference_label', referenceId: 'ref_1', label: '' },
      { kind: 'set_reference_prompt', referenceId: '', prompt: 'Updated prompt' },
      { kind: 'set_reference_prompt', referenceId: 'ref_1', prompt: '' },
      { kind: 'select_reference_image', referenceId: '', assetId: 'asset_1' },
      { kind: 'select_reference_image', referenceId: 'ref_1', assetId: '' },
      { kind: 'remove_reference_image', referenceId: '', assetId: 'asset_1' },
      { kind: 'remove_reference_image', referenceId: 'ref_1', assetId: '' },
      { kind: 'remove_reference_image', referenceId: 'ref_1', assetId: 'asset_1', deleteFile: true },
      {
        kind: 'set_shot_reference_binding',
        shotId: '',
        characterReferenceIds: [],
        backgroundReferenceId: null,
      },
      {
        kind: 'set_shot_reference_binding',
        shotId: 'shot_1',
        characterReferenceIds: ['ref_1', 'ref_1'],
        backgroundReferenceId: null,
      },
      {
        kind: 'set_shot_reference_binding',
        shotId: 'shot_1',
        characterReferenceIds: [],
        backgroundReferenceId: '',
      },
      {
        kind: 'add_beat',
        beatId: '',
        beat: { title: '', story: '', targetSeconds: null },
        beforeBeatId: null,
      },
      { kind: 'add_beat', beatId: 'beat_1', beat: null, beforeBeatId: null },
      {
        kind: 'add_beat',
        beatId: 'beat_1',
        beat: { title: '', story: '', targetSeconds: null },
        beforeBeatId: '',
      },
      { kind: 'edit_beat', beatId: '', changes: { story: 'Story' } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: {} },
      { kind: 'reorder_beats', beatOrder: ['beat_1', 'beat_1'] },
      { kind: 'park_beat', beatId: '' },
      { kind: 'restore_beat', beatId: '', beforeBeatId: null },
      { kind: 'restore_beat', beatId: 'beat_1', beforeBeatId: '' },
      { kind: 'add_binned_beat', beatId: '', beat: { title: '', story: '', targetSeconds: null } },
      { kind: 'add_binned_beat', beatId: 'beat_1', beat: null },
      {
        kind: 'add_shot',
        beatId: '',
        shotId: 'shot_1',
        shot: { shootingScript: '', durationSeconds: 5 },
        beforeShotId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: '',
        shot: { shootingScript: '', durationSeconds: 5 },
        beforeShotId: null,
      },
      { kind: 'add_shot', beatId: 'beat_1', shotId: 'shot_1', shot: null, beforeShotId: null },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_1',
        shot: { shootingScript: '', durationSeconds: 5 },
        beforeShotId: '',
      },
      { kind: 'edit_shot', shotId: '', changes: { shootingScript: 'Script' } },
      { kind: 'edit_shot', shotId: 'shot_1', changes: {} },
      { kind: 'delete_shot', shotId: '' },
      { kind: 'park_shot', shotId: '' },
      { kind: 'restore_shot', shotId: '', beforeShotId: null },
      { kind: 'restore_shot', shotId: 'shot_1', beforeShotId: '' },
      { kind: 'reorder_shots', beatId: '', shotOrder: [] },
      { kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot_1', 'shot_1'] },
      { kind: 'apply_coverage', beatId: '', shots: [], fixedShots: [] },
      { kind: 'apply_coverage', beatId: 'beat_1', shots: {}, fixedShots: [] },
      { kind: 'apply_coverage', beatId: 'beat_1', shots: [{}], fixedShots: [] },
      { kind: 'apply_coverage', beatId: 'beat_1', shots: [], fixedShots: [{}] },
      { kind: 'set_hard_cut', shotId: '', hardCut: true },
      { kind: 'set_hard_cut', shotId: 'shot_1', hardCut: 'yes' },
      { kind: 'set_seed_still', shotId: '', assetId: null },
      { kind: 'set_seed_still', shotId: 'shot_1', assetId: '' },
      { kind: 'dismiss_seed_still', shotId: '', assetId: 'seed_1' },
      { kind: 'dismiss_seed_still', shotId: 'shot_1', assetId: '' },
      { kind: 'select_video_take', shotId: '', assetId: 'video_1' },
      { kind: 'select_video_take', shotId: 'shot_1', assetId: '' },
      { kind: 'remove_video_take', shotId: '', assetId: 'video_1' },
      { kind: 'remove_video_take', shotId: 'shot_1', assetId: '' },
      { kind: 'promote_board_panel', shotId: '', boardAssetId: 'asset_1' },
      { kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: '' },
      { kind: 'trim_shot', shotId: '', trimInSeconds: null, trimOutSeconds: null },
      { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: -1, trimOutSeconds: null },
      { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: null, trimOutSeconds: -1 },
      { kind: 'reorder_bin', bin: {} },
      { kind: 'reorder_bin', bin: [{}] },
      { kind: 'set_routes', imageRouteId: '', videoRouteId: null },
      { kind: 'set_routes', imageRouteId: null, videoRouteId: '' },
      { kind: 'set_spend_policy', policy: {} },
      { kind: 'set_bed', assetId: '' },
      { kind: 'undo_last', entryId: '' },
    ];

    for (const operation of malformed) {
      expect(validateStudioMutationOperationV2(operation), JSON.stringify(operation)).toBe(false);
    }
  });

  it('accepts every schema-5 settings and optional-field variant at the parser boundary', () => {
    const valid: unknown[] = [
      { kind: 'edit_project', changes: { aspectRatio: '16:9' } },
      { kind: 'edit_project', changes: { aspectRatio: '9:16' } },
      { kind: 'edit_project', changes: { aspectRatio: '1:1' } },
      { kind: 'edit_project', changes: { aspectRatio: '4:3' } },
      { kind: 'edit_project', changes: { aspectRatio: '3:4' } },
      { kind: 'edit_project', changes: { resolution: '720p' } },
      { kind: 'edit_project', changes: { resolution: '1080p' } },
      { kind: 'edit_project', changes: { boardStyle: null } },
      { kind: 'edit_project', changes: { boardStyle: 'line_art' } },
      { kind: 'edit_project', changes: { targetDurationSeconds: 5 } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { title: 'Title' } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { targetSeconds: null } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { targetSeconds: 1 } },
      { kind: 'edit_shot', shotId: 'shot_1', changes: { durationSeconds: 5 } },
    ];
    for (const operation of valid) expect(validateStudioMutationOperationV2(operation)).toBe(true);
  });
});

describe('schema-5 project-setting consequence boundaries', () => {
  it('blocks request-shape changes while paid work is bound but keeps name and target editable', () => {
    const project = makeProject();
    const take = addSucceededVideoTake(project, 'shot_1', 'take_1');
    const job = project.jobs.job_take_1!;
    job.status = 'running';
    job.outputAssetIds = [];
    job.outputAssetIdsByRole = { primary: null, poster: null };
    job.spendReceipt = null;
    delete project.assets[take.id];
    project.shots.shot_1!.assetIds = project.shots.shot_1!.assetIds.filter((assetId) => assetId !== take.id);
    project.shots.shot_1!.videoAssetId = null;
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(project, [{ kind: 'edit_project', changes: { aspectRatio: '9:16' } }], 'dependency_blocked');
    expectReason(project, [{ kind: 'edit_project', changes: { resolution: '720p' } }], 'dependency_blocked');

    expect(apply(project, [{ kind: 'edit_project', changes: { name: 'Renamed while running' } }]).project.name).toBe(
      'Renamed while running'
    );
    expect(
      apply(project, [{ kind: 'edit_project', changes: { targetDurationSeconds: 45 } }]).project.targetDurationSeconds
    ).toBe(45);
  });
});

describe('schema-5 Story, Shooting script, and undo', () => {
  it('applies ordered Beat and Shot prose edits without synthesizing any other authoring field', () => {
    const project = makeProject();
    const result = apply(project, [
      {
        kind: 'add_beat',
        beatId: 'beat_3',
        beat: { title: 'Closing', story: 'Ming and Mei leave together.', targetSeconds: 7 },
        beforeBeatId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'beat_3',
        shotId: 'shot_3',
        shot: { shootingScript: 'Wide shot. They step into the rain.', durationSeconds: 7 },
        beforeShotId: null,
      },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { title: 'Opening', story: 'Ming arrives.' } },
      { kind: 'edit_shot', shotId: 'shot_1', changes: { shootingScript: 'Slow dolly toward Ming.' } },
    ]);

    expect(result.createdBeatIds).toEqual(['beat_3']);
    expect(result.createdShotIds).toEqual(['shot_3']);
    expect(result.project.beats.beat_1).toMatchObject({ title: 'Opening', story: 'Ming arrives.' });
    expect(result.project.shots.shot_1!.shootingScript).toBe('Slow dolly toward Ming.');
    expect(result.project.shots.shot_3).toMatchObject({
      shootingScript: 'Wide shot. They step into the rain.',
      referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
    });
    expect(result.project).not.toHaveProperty('action');
    expect(result.project.undoHistory).toHaveLength(1);
  });

  it('undoes one mixed Story/script mutation exactly after the persistence revision advances', () => {
    const original = makeProject();
    const changed = persist(
      apply(original, [
        { kind: 'edit_beat', beatId: 'beat_1', changes: { story: 'Changed Story' } },
        { kind: 'edit_shot', shotId: 'shot_1', changes: { shootingScript: 'Changed script' } },
      ]).project
    );
    const entryId = changed.undoHistory.at(-1)!.id;
    const undone = apply(changed, [{ kind: 'undo_last', entryId }], 'undo_mutation').project;
    expect(undone.beats.beat_1!.story).toBe('');
    expect(undone.shots.shot_1!.shootingScript).toBe('');
    expect(undone.undoHistory).toEqual([]);
  });

  it('rolls back the whole batch when a later operation is invalid', () => {
    const project = makeProject();
    expectReason(
      project,
      [
        { kind: 'edit_beat', beatId: 'beat_1', changes: { story: 'Would otherwise apply' } },
        { kind: 'edit_shot', shotId: 'missing', changes: { shootingScript: 'No owner' } },
      ],
      'invalid_operation'
    );
  });
});

describe('schema-5 reference lifecycle mutations', () => {
  it('creates one ordered plan, supports an explicitly empty plan, and refuses replanning', () => {
    const project = makeProject();
    const mutationId = 'reference_plan';
    const planned = apply(
      project,
      [
        {
          kind: 'set_reference_plan',
          references: [
            { kind: 'character', label: 'Ming', prompt: 'Ming in a red rain jacket.' },
            {
              kind: 'background',
              label: 'Dai pai dong',
              prompt: 'A compact dai pai dong under a red awning.',
            },
          ],
        },
      ],
      mutationId
    ).project;
    const mingId = createStudioProjectReferenceIdV2(project.id, mutationId, 0, 0);
    const backgroundId = createStudioProjectReferenceIdV2(project.id, mutationId, 0, 1);
    expect(planned.referencePlanStatus).toBe('planned');
    expect(planned.referenceOrder).toEqual([mingId, backgroundId]);
    expect(planned.references[mingId]).toMatchObject({
      id: mingId,
      kind: 'character',
      label: 'Ming',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
    });
    expectReason(persist(planned), [{ kind: 'set_reference_plan', references: [] }], 'invalid_operation');

    const empty = apply(makeProject(), [{ kind: 'set_reference_plan', references: [] }]).project;
    expect(empty).toMatchObject({ referencePlanStatus: 'planned', referenceOrder: [], references: {} });
  });

  it('binds an empty reference decision on a film that plans no references at all', () => {
    // A film with no named characters and no recurring places never leaves `unplanned`, because
    // nothing was ever planned. An empty binding references nothing, so it has nothing to validate
    // against a plan and must not be gated behind one.
    const project = makeProject();
    expect(project.referencePlanStatus).toBe('unplanned');

    const bound = apply(
      project,
      [
        {
          kind: 'set_shot_reference_binding',
          shotId: 'shot_1',
          characterReferenceIds: [],
          backgroundReferenceId: null,
        },
      ],
      'bind_nothing'
    ).project;

    expect(bound.shots.shot_1!.referenceBinding).toEqual({
      status: 'ready',
      characterReferenceIds: [],
      backgroundReferenceId: null,
    });
    expect(bound.referencePlanStatus).toBe('unplanned');
  });

  it('still refuses a non-empty binding while the reference plan is unplanned', () => {
    const project = makeProject();
    expectReason(
      project,
      [
        {
          kind: 'set_shot_reference_binding',
          shotId: 'shot_1',
          characterReferenceIds: ['ref_1'],
          backgroundReferenceId: null,
        },
      ],
      'invalid_operation'
    );
  });

  it('adds a background to a character-only plan without changing approvals, asset hashes, or Shot bindings', () => {
    let project = persist(
      apply(
        makeProject(),
        [
          {
            kind: 'set_reference_plan',
            references: [{ kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' }],
          },
        ],
        'plan_ming'
      ).project
    );
    const mingId = project.referenceOrder[0]!;
    addReferenceCandidate(project, mingId, 'asset_ming_approved');
    project = persist(
      apply(
        project,
        [
          {
            kind: 'set_shot_reference_binding',
            shotId: 'shot_1',
            characterReferenceIds: [mingId],
            backgroundReferenceId: null,
          },
        ],
        'bind_ming'
      ).project
    );
    const existingReference = structuredClone(project.references[mingId]);
    const assets = structuredClone(project.assets);
    const bindings = Object.fromEntries(
      Object.entries(project.shots).map(([shotId, shot]) => [shotId, structuredClone(shot.referenceBinding)])
    );
    const existingOrder = [...project.referenceOrder];

    const mutationId = 'add_dai_pai_dong';
    const amended = persist(
      apply(
        project,
        [
          {
            kind: 'amend_reference_plan',
            additions: [
              {
                kind: 'background',
                label: 'Dai pai dong',
                prompt: 'A compact dai pai dong beneath a red awning at night.',
              },
            ],
          },
        ],
        mutationId
      ).project
    );
    const backgroundId = createStudioProjectReferenceIdV2(project.id, mutationId, 0, 0);

    expect(amended.referenceOrder).toEqual([...existingOrder, backgroundId]);
    expect(amended.references[mingId]).toEqual(existingReference);
    expect(amended.assets).toEqual(assets);
    expect(amended.assets.asset_ming_approved?.sha256).toBe(digest);
    expect(
      Object.fromEntries(Object.entries(amended.shots).map(([shotId, shot]) => [shotId, shot.referenceBinding]))
    ).toEqual(bindings);
    expect(amended.references[backgroundId]).toEqual({
      id: backgroundId,
      kind: 'background',
      label: 'Dai pai dong',
      prompt: 'A compact dai pai dong beneath a red awning at night.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: laterTimestamp,
      updatedAt: laterTimestamp,
    });
    expect(validateStudioProjectV2(amended)).toBe(true);
  });

  it('fails duplicate, stale, and invalid reference-plan amendments atomically', () => {
    const planned = persist(
      apply(makeProject(), [
        {
          kind: 'set_reference_plan',
          references: [
            { kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' },
            { kind: 'background', label: 'Market', prompt: 'A recurring market.' },
          ],
        },
      ]).project
    );
    const addition = {
      kind: 'amend_reference_plan' as const,
      additions: [{ kind: 'background' as const, label: 'Dai pai dong', prompt: 'A recurring food stall.' }],
    };

    expectReason(
      planned,
      [
        {
          kind: 'amend_reference_plan',
          additions: [{ kind: 'background', label: 'Market', prompt: 'A different market prompt.' }],
        },
      ],
      'invalid_operation'
    );
    expectReason(
      planned,
      [
        {
          kind: 'amend_reference_plan',
          additions: [
            { kind: 'background', label: 'Arcade', prompt: 'An old arcade.' },
            { kind: 'background', label: 'Arcade', prompt: 'The same semantic background twice.' },
          ],
        },
      ],
      'invalid_operation'
    );
    expectReason(planned, [addition, addition], 'invalid_operation');
    expectReason(makeProject(), [addition], 'invalid_operation');

    for (const malformed of [
      { kind: 'amend_reference_plan', additions: [] },
      {
        kind: 'amend_reference_plan',
        additions: [{ kind: 'character', label: 'Mei', prompt: 'Mei character sheet.' }],
      },
      {
        kind: 'amend_reference_plan',
        additions: [{ kind: 'background', label: ' Arcade', prompt: 'Untrimmed label.' }],
      },
      {
        kind: 'amend_reference_plan',
        additions: [{ kind: 'background', label: 'Arcade', prompt: 'Arcade.', approvedAssetId: 'asset_injected' }],
      },
    ]) {
      expect(validateStudioMutationOperationV2(malformed), JSON.stringify(malformed)).toBe(false);
    }

    const before = structuredClone(planned);
    const staleBatch = { ...mutationBatch(planned, [addition]), expectedRevision: planned.revision - 1 };
    expect(() =>
      applyStudioMutationBatchV2(planned, staleBatch, {
        mutationId: 'stale_amendment',
        capturedAt: laterTimestamp,
      })
    ).toThrow(expect.objectContaining({ reasonCode: 'invalid_operation' }));
    expect(planned).toEqual(before);
  });

  it('edits regeneration prompts and selects only an exact historical image', () => {
    let project = apply(makeProject(), [
      {
        kind: 'set_reference_plan',
        references: [{ kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' }],
      },
    ]).project;
    const referenceId = project.referenceOrder[0]!;
    project = persist(project);
    addReferenceCandidate(project, referenceId, 'asset_candidate_1');
    project = persist(
      apply(
        project,
        [{ kind: 'set_reference_prompt', referenceId, prompt: 'Revised Ming character sheet.' }],
        'edit_prompt'
      ).project
    );
    expect(project.references[referenceId]?.prompt).toBe('Revised Ming character sheet.');
    expectReason(
      project,
      [{ kind: 'select_reference_image', referenceId, assetId: 'asset_other' }],
      'invalid_operation'
    );
    expect(project.references[referenceId]).toMatchObject({
      approvedAssetId: 'asset_candidate_1',
      supersededAssetIds: [],
    });

    addReferenceCandidate(project, referenceId, 'asset_candidate_2');
    const replaced = apply(
      project,
      [{ kind: 'select_reference_image', referenceId, assetId: 'asset_candidate_1' }],
      'select_candidate_1'
    ).project;
    expect(replaced.references[referenceId]).toMatchObject({
      approvedAssetId: 'asset_candidate_1',
      supersededAssetIds: ['asset_candidate_2'],
    });
  });

  it('drops only the current reference take while preserving provenance, bindings, and terminal frozen inputs', () => {
    let project = apply(makeProject(), [
      {
        kind: 'set_reference_plan',
        references: [{ kind: 'character', label: 'Ming', prompt: 'Ming character reference.' }],
      },
    ]).project;
    const referenceId = project.referenceOrder[0]!;
    project = persist(project);
    addReferenceCandidate(project, referenceId, 'asset_reference_01');
    project = persist(project);
    addReferenceCandidate(project, referenceId, 'asset_reference_02');
    project = persist(
      apply(
        project,
        [
          {
            kind: 'set_shot_reference_binding',
            shotId: 'shot_1',
            characterReferenceIds: [referenceId],
            backgroundReferenceId: null,
          },
        ],
        'bind_reference_for_removal'
      ).project
    );
    addFailedSeedJobWithBoundReferences(project, 'shot_1', 'seed_with_reference');

    const recoverableDownload = structuredClone(project);
    recoverableDownload.jobs.job_seed_with_reference!.error = {
      code: 'download_failed',
      messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
    };
    expect(validateStudioProjectV2(recoverableDownload)).toBe(true);
    expectReason(
      recoverableDownload,
      [{ kind: 'remove_reference_image', referenceId, assetId: 'asset_reference_02' }],
      'dependency_blocked'
    );

    const localDownloadFailure = structuredClone(recoverableDownload);
    localDownloadFailure.jobs.job_seed_with_reference!.providerJobId = null;
    localDownloadFailure.jobs.job_seed_with_reference!.remoteStartedAt = null;
    expect(validateStudioProjectV2(localDownloadFailure)).toBe(true);
    expect(
      apply(
        localDownloadFailure,
        [{ kind: 'remove_reference_image', referenceId, assetId: 'asset_reference_02' }],
        'remove_after_local_download_failure'
      ).project.references[referenceId]
    ).toMatchObject({ approvedAssetId: 'asset_reference_01', supersededAssetIds: [] });

    const assetsBefore = structuredClone(project.assets);
    const jobsBefore = structuredClone(project.jobs);
    const authorizationsBefore = structuredClone(project.spendAuthorizations);
    const bindingBefore = structuredClone(project.shots.shot_1!.referenceBinding);
    const removed = persist(
      apply(
        project,
        [{ kind: 'remove_reference_image', referenceId, assetId: 'asset_reference_02' }],
        'remove_reference_02'
      ).project
    );

    expect(removed.references[referenceId]).toMatchObject({
      approvedAssetId: 'asset_reference_01',
      supersededAssetIds: [],
    });
    expect(removed.assets).toEqual(assetsBefore);
    expect(removed.jobs).toEqual(jobsBefore);
    expect(removed.spendAuthorizations).toEqual(authorizationsBefore);
    expect(removed.shots.shot_1!.referenceBinding).toEqual(bindingBefore);
    expect(
      removed.jobs.job_seed_with_reference?.composition.inputs.referenceInputs.map(({ assetId }) => assetId)
    ).toEqual(['asset_reference_02']);
    expect(validateStudioProjectV2(removed)).toBe(true);

    const lastRemoved = persist(
      apply(
        removed,
        [{ kind: 'remove_reference_image', referenceId, assetId: 'asset_reference_01' }],
        'remove_reference_01'
      ).project
    );
    expect(lastRemoved.references[referenceId]).toMatchObject({ approvedAssetId: null, supersededAssetIds: [] });
    expect(lastRemoved.shots.shot_1!.referenceBinding).toEqual(bindingBefore);
    expect(validateStudioProjectV2(lastRemoved)).toBe(true);

    const undoEntry = lastRemoved.undoHistory.at(-1);
    if (undoEntry === undefined) throw new Error('reference removal must be undoable');
    const undone = apply(lastRemoved, [{ kind: 'undo_last', entryId: undoEntry.id }], 'undo_reference_removal').project;
    expect(undone.references[referenceId]?.approvedAssetId).toBe('asset_reference_01');
    expect(undone.assets).toEqual(assetsBefore);
    expect(undone.shots.shot_1!.referenceBinding).toEqual(bindingBefore);
  });

  it('rejects stale, cross-reference, non-current, and live reference-image removals atomically', () => {
    let project = apply(makeProject(), [
      {
        kind: 'set_reference_plan',
        references: [
          { kind: 'character', label: 'Ming', prompt: 'Ming.' },
          { kind: 'character', label: 'Mei', prompt: 'Mei.' },
        ],
      },
    ]).project;
    const [mingId, meiId] = project.referenceOrder;
    if (mingId === undefined || meiId === undefined) throw new Error('expected references');
    project = persist(project);
    addReferenceCandidate(project, mingId, 'asset_ming_01');
    project = persist(project);
    addReferenceCandidate(project, mingId, 'asset_ming_02');

    expectReason(
      project,
      [{ kind: 'remove_reference_image', referenceId: mingId, assetId: 'asset_ming_01' }],
      'invalid_operation'
    );
    expectReason(
      project,
      [{ kind: 'remove_reference_image', referenceId: meiId, assetId: 'asset_ming_02' }],
      'invalid_operation'
    );

    const live = structuredClone(project);
    addQueuedReferenceJob(live, mingId, 'live_reference');
    expectReason(
      live,
      [{ kind: 'remove_reference_image', referenceId: mingId, assetId: 'asset_ming_02' }],
      'dependency_blocked'
    );

    const staleBatch = {
      ...mutationBatch(project, [
        { kind: 'remove_reference_image' as const, referenceId: mingId, assetId: 'asset_ming_02' },
      ]),
      expectedRevision: project.revision - 1,
    };
    const before = structuredClone(project);
    expect(() =>
      applyStudioMutationBatchV2(project, staleBatch, {
        mutationId: 'stale_reference_removal',
        capturedAt: laterTimestamp,
      })
    ).toThrow(expect.objectContaining({ reasonCode: 'invalid_operation' }));
    expect(project).toEqual(before);
  });

  it('renames a semantic reference without replacing identity, approval, provenance, or Shot bindings', () => {
    let project = apply(makeProject(), [
      {
        kind: 'set_reference_plan',
        references: [
          { kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' },
          { kind: 'character', label: 'Mei', prompt: 'Mei character sheet.' },
        ],
      },
    ]).project;
    const [mingId, meiId] = project.referenceOrder;
    if (mingId === undefined || meiId === undefined) throw new Error('Expected two reference identities');
    project = persist(project);
    addReferenceCandidate(project, mingId, 'asset_ming_1');
    project = persist(project);
    addReferenceCandidate(project, mingId, 'asset_ming_2');
    project = persist(
      apply(
        project,
        [
          {
            kind: 'set_shot_reference_binding',
            shotId: 'shot_1',
            characterReferenceIds: [mingId],
            backgroundReferenceId: null,
          },
        ],
        'bind_reference_before_rename'
      ).project
    );
    const approvalBefore = structuredClone(project.references[mingId]);
    const bindingBefore = structuredClone(project.shots.shot_1!.referenceBinding);
    const assetsBefore = structuredClone(project.assets);
    const jobsBefore = structuredClone(project.jobs);

    const renamed = persist(
      apply(
        project,
        [
          { kind: 'set_reference_label', referenceId: mingId, label: 'Ming Wong' },
          { kind: 'set_reference_prompt', referenceId: mingId, prompt: 'Updated Ming character sheet.' },
        ],
        'rename_reference'
      ).project
    );

    expect(renamed.referenceOrder).toEqual(project.referenceOrder);
    expect(renamed.references[mingId]).toMatchObject({
      id: mingId,
      kind: 'character',
      label: 'Ming Wong',
      prompt: 'Updated Ming character sheet.',
      approvedAssetId: approvalBefore?.approvedAssetId,
      supersededAssetIds: approvalBefore?.supersededAssetIds,
      jobIds: approvalBefore?.jobIds,
    });
    expect(renamed.shots.shot_1!.referenceBinding).toEqual(bindingBefore);
    expect(renamed.assets).toEqual(assetsBefore);
    expect(renamed.jobs).toEqual(jobsBefore);
    expectReason(
      renamed,
      [{ kind: 'set_reference_label', referenceId: mingId, label: renamed.references[meiId]!.label }],
      'invalid_operation'
    );
  });

  it('mints replay-stable app-owned identities that vary by mutation and position', () => {
    const operation: StudioMutationOperationV2 = {
      kind: 'set_reference_plan',
      references: [
        { kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' },
        {
          kind: 'background',
          label: 'Dai pai dong',
          prompt: 'Dai pai dong background sheet.',
        },
      ],
    };
    const first = apply(makeProject(), [operation], 'reference_identity').project;
    const replay = apply(makeProject(), [operation], 'reference_identity').project;
    const otherMutation = apply(makeProject(), [operation], 'reference_identity_other').project;

    expect(first.referenceOrder).toEqual(replay.referenceOrder);
    expect(new Set(first.referenceOrder).size).toBe(2);
    expect(first.referenceOrder).not.toEqual(otherMutation.referenceOrder);
    expect(first.referenceOrder.every((referenceId) => /^ref_[a-f0-9]{64}$/.test(referenceId))).toBe(true);
  });

  it('records an explicit no-reference Shot decision and rejects an unapproved semantic binding', () => {
    const planned = apply(makeProject(), [
      {
        kind: 'set_reference_plan',
        references: [{ kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' }],
      },
    ]).project;
    const referenceId = planned.referenceOrder[0]!;
    const project = persist(planned);
    const ready = apply(
      project,
      [
        {
          kind: 'set_shot_reference_binding',
          shotId: 'shot_1',
          characterReferenceIds: [],
          backgroundReferenceId: null,
        },
      ],
      'bind_no_references'
    ).project;
    expect(ready.shots.shot_1!.referenceBinding).toEqual({
      status: 'ready',
      characterReferenceIds: [],
      backgroundReferenceId: null,
    });
    expectReason(
      project,
      [
        {
          kind: 'set_shot_reference_binding',
          shotId: 'shot_1',
          characterReferenceIds: [referenceId],
          backgroundReferenceId: null,
        },
      ],
      'invalid_operation'
    );
  });

  it('persists the Director-selected character order instead of catalogue order', () => {
    let project = persist(
      apply(makeProject(), [
        {
          kind: 'set_reference_plan',
          references: [
            { kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' },
            { kind: 'character', label: 'Mei', prompt: 'Mei character sheet.' },
          ],
        },
      ]).project
    );
    const [mingId, meiId] = project.referenceOrder;
    if (mingId === undefined || meiId === undefined) throw new Error('Expected two app-owned reference identities');

    addReferenceCandidate(project, mingId, 'asset_ming');
    addReferenceCandidate(project, meiId, 'asset_mei');

    const bound = persist(
      apply(
        project,
        [
          {
            kind: 'set_shot_reference_binding',
            shotId: 'shot_1',
            characterReferenceIds: [meiId, mingId],
            backgroundReferenceId: null,
          },
        ],
        'bind_mei_then_ming'
      ).project
    );

    expect(bound.shots.shot_1!.referenceBinding).toEqual({
      status: 'ready',
      characterReferenceIds: [meiId, mingId],
      backgroundReferenceId: null,
    });
    expect(validateStudioProjectV2(bound)).toBe(true);
  });
});

describe('schema-5 coverage, park, and deterministic controls', () => {
  it('preserves a fixed authored Shooting script while replacing only the free coverage interval', () => {
    const project = makeProject();
    project.shots.shot_1!.shootingScript = 'Keep this reviewed script.';
    const result = apply(project, [
      {
        kind: 'apply_coverage',
        beatId: 'beat_1',
        shots: [
          {
            shotId: 'shot_1',
            shootingScript: 'Keep this reviewed script.',
            durationSeconds: 5,
            chainBreak: 'none',
          },
          {
            shotId: 'shot_3',
            shootingScript: 'New coverage script.',
            durationSeconds: 6,
            chainBreak: 'none',
          },
        ],
        fixedShots: [{ shotId: 'shot_1', reasons: ['shooting_script'] }],
      },
    ]);
    expect(result.project.beats.beat_1!.shotOrder).toEqual(['shot_1', 'shot_3']);
    expect(result.project.shots.shot_1!.shootingScript).toBe('Keep this reviewed script.');
    expect(result.project.shots.shot_3).toMatchObject({
      shootingScript: 'New coverage script.',
      durationSeconds: 6,
      chainBreak: 'none',
      referenceBinding: { status: 'unassigned' },
    });
    expect(result.coverageResults).toEqual([
      {
        beatId: 'beat_1',
        createdShotIds: ['shot_3'],
        retainedShotIds: ['shot_1'],
        removedShotIds: ['shot_2'],
        fixedShotIds: ['shot_1'],
      },
    ]);
  });

  it('rejects a coverage review that omits or misstates the exact fixed Shooting-script reason', () => {
    const project = makeProject();
    project.shots.shot_1!.shootingScript = 'Fixed script.';
    const shots = [
      { shotId: 'shot_1', shootingScript: 'Fixed script.', durationSeconds: 5, chainBreak: 'none' as const },
    ];
    expectReason(project, [{ kind: 'apply_coverage', beatId: 'beat_1', shots, fixedShots: [] }], 'dependency_blocked');
    expect(
      validateStudioMutationOperationV2({
        kind: 'apply_coverage',
        beatId: 'beat_1',
        shots,
        fixedShots: [{ shotId: 'shot_1', reasons: ['narration'] }],
      })
    ).toBe(false);
  });

  it('parks, reorders, and restores Shots and Beats without deleting their records', () => {
    let project = persist(apply(makeProject(), [{ kind: 'park_shot', shotId: 'shot_1' }]).project);
    expect(project.beats.beat_1!.shotOrder).toEqual(['shot_2']);
    expect(project.bin).toContainEqual({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
    project = persist(
      apply(project, [{ kind: 'restore_shot', shotId: 'shot_1', beforeShotId: 'shot_2' }], 'restore_shot').project
    );
    expect(project.beats.beat_1!.shotOrder).toEqual(['shot_1', 'shot_2']);

    project = persist(apply(project, [{ kind: 'park_beat', beatId: 'beat_2' }], 'park_beat').project);
    expect(project.beatOrder).toEqual(['beat_1']);
    expect(project.bin).toContainEqual({ kind: 'beat', beatId: 'beat_2', reason: 'lifted' });
    const restored = apply(
      project,
      [{ kind: 'restore_beat', beatId: 'beat_2', beforeBeatId: 'beat_1' }],
      'restore_beat'
    ).project;
    expect(restored.beatOrder).toEqual(['beat_2', 'beat_1']);
  });

  it('sets routes, spend policy, and a human seed through deterministic operations', () => {
    const project = makeProject();
    importImage(project, 'shot_1', 'seed_import');
    const result = apply(project, [
      { kind: 'set_routes', imageRouteId: 'image_route', videoRouteId: 'video_route' },
      { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 2500 } },
      { kind: 'set_seed_still', shotId: 'shot_1', assetId: 'seed_import' },
    ]).project;
    expect(result).toMatchObject({
      imageRouteId: 'image_route',
      videoRouteId: 'video_route',
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 2500 },
    });
    expect(result.shots.shot_1!.seedStillId).toBe('seed_import');
  });

  it('dismisses a seed candidate without deleting its retained media provenance', () => {
    const project = makeProject();
    const imported = importImage(project, 'shot_1', 'seed_import');
    project.shots.shot_1!.seedStillId = imported.id;

    const result = apply(project, [{ kind: 'dismiss_seed_still', shotId: 'shot_1', assetId: imported.id }]).project;

    expect(result.shots.shot_1).toMatchObject({
      seedStillId: null,
      dismissedSeedStillIds: [imported.id],
      assetIds: [imported.id],
    });
    expect(result.assets[imported.id]).toEqual(imported);
  });

  it('restores an older successful take for free and removes only the current pointer', () => {
    const project = makeProject();
    const older = addSucceededVideoTake(project, 'shot_1', 'video_older');
    const newer = addSucceededVideoTake(project, 'shot_1', 'video_newer');

    const restored = persist(
      apply(project, [{ kind: 'select_video_take', shotId: 'shot_1', assetId: older.id }]).project
    );
    expect(restored.shots.shot_1).toMatchObject({
      videoAssetId: older.id,
      supersededVideoAssetIds: [newer.id],
      trimInSeconds: null,
      trimOutSeconds: null,
    });
    expect(restored.assets[older.id]).toEqual(older);
    expect(restored.assets[newer.id]).toEqual(newer);
    expect(restored.spendAuthorizations).toEqual(project.spendAuthorizations);

    const removed = apply(
      restored,
      [{ kind: 'remove_video_take', shotId: 'shot_1', assetId: older.id }],
      'remove_take'
    ).project;
    expect(removed.shots.shot_1).toMatchObject({
      videoAssetId: null,
      supersededVideoAssetIds: [older.id, newer.id],
    });
    expect(removed.assets[older.id]).toEqual(older);
    expect(removed.assets[newer.id]).toEqual(newer);
    expect(removed.spendAuthorizations).toEqual(project.spendAuthorizations);
  });

  it('rejects missing identities, invalid placements, and exact no-op reducer requests', () => {
    const beat = { title: '', story: '', targetSeconds: null };
    const shot = { shootingScript: '', durationSeconds: 5 };
    const cases: Array<{
      label: string;
      operations: StudioMutationOperationV2[];
      reasonCode: StudioMutationReasonV2;
    }> = [
      { label: 'unchanged brief', operations: [{ kind: 'set_brief', brief: '' }], reasonCode: 'invalid_operation' },
      { label: 'unchanged rules', operations: [{ kind: 'set_rules', rules: [] }], reasonCode: 'invalid_operation' },
      {
        label: 'missing Beat anchor',
        operations: [{ kind: 'add_beat', beatId: 'beat_3', beat, beforeBeatId: 'missing' }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'duplicate active Beat',
        operations: [{ kind: 'add_beat', beatId: 'beat_1', beat, beforeBeatId: null }],
        reasonCode: 'identity_collision',
      },
      {
        label: 'duplicate binned Beat',
        operations: [{ kind: 'add_binned_beat', beatId: 'beat_1', beat }],
        reasonCode: 'identity_collision',
      },
      {
        label: 'missing Beat edit',
        operations: [{ kind: 'edit_beat', beatId: 'missing', changes: { story: 'Changed' } }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged Beat edit',
        operations: [{ kind: 'edit_beat', beatId: 'beat_1', changes: { story: '' } }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'incomplete Beat permutation',
        operations: [{ kind: 'reorder_beats', beatOrder: ['beat_1'] }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged Beat order',
        operations: [{ kind: 'reorder_beats', beatOrder: ['beat_1', 'beat_2'] }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Beat to park',
        operations: [{ kind: 'park_beat', beatId: 'missing' }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Beat to restore',
        operations: [{ kind: 'restore_beat', beatId: 'missing', beforeBeatId: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Shot owner Beat',
        operations: [{ kind: 'add_shot', beatId: 'missing', shotId: 'shot_3', shot, beforeShotId: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Shot anchor',
        operations: [{ kind: 'add_shot', beatId: 'beat_1', shotId: 'shot_3', shot, beforeShotId: 'missing' }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'duplicate Shot',
        operations: [{ kind: 'add_shot', beatId: 'beat_1', shotId: 'shot_1', shot, beforeShotId: null }],
        reasonCode: 'identity_collision',
      },
      {
        label: 'missing Shot edit',
        operations: [{ kind: 'edit_shot', shotId: 'missing', changes: { shootingScript: 'Changed' } }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged Shot duration',
        operations: [{ kind: 'edit_shot', shotId: 'shot_1', changes: { durationSeconds: 5 } }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Shot delete',
        operations: [{ kind: 'delete_shot', shotId: 'missing' }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Shot to park',
        operations: [{ kind: 'park_shot', shotId: 'missing' }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Shot to restore',
        operations: [{ kind: 'restore_shot', shotId: 'missing', beforeShotId: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing Shot owner for reorder',
        operations: [{ kind: 'reorder_shots', beatId: 'missing', shotOrder: [] }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'incomplete Shot permutation',
        operations: [{ kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot_1'] }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged Shot order',
        operations: [{ kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot_1', 'shot_2'] }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'retired hard-cut setter',
        operations: [{ kind: 'set_hard_cut', shotId: 'shot_1', hardCut: true }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'missing seed Shot',
        operations: [{ kind: 'set_seed_still', shotId: 'missing', assetId: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged seed',
        operations: [{ kind: 'set_seed_still', shotId: 'shot_1', assetId: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged routes',
        operations: [{ kind: 'set_routes', imageRouteId: null, videoRouteId: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged spend policy',
        operations: [{ kind: 'set_spend_policy', policy: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged sound bed',
        operations: [{ kind: 'set_bed', assetId: null }],
        reasonCode: 'invalid_operation',
      },
      {
        label: 'unchanged empty Bin',
        operations: [{ kind: 'reorder_bin', bin: [] }],
        reasonCode: 'invalid_operation',
      },
    ];

    for (const { label, operations, reasonCode } of cases) {
      expectReason(makeProject(), operations, reasonCode);
      expect(label).not.toBe('');
    }
  });

  it('requires undo and board-panel promotion to be isolated mutation batches', () => {
    expectReason(
      makeProject(),
      [
        { kind: 'undo_last', entryId: 'undo_1' },
        { kind: 'set_brief', brief: 'Changed' },
      ],
      'invalid_operation'
    );
    expectReason(
      makeProject(),
      [
        { kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: 'board_1' },
        { kind: 'set_brief', brief: 'Changed' },
      ],
      'invalid_operation'
    );
  });

  it('reorders mixed Shot and Beat Bin entries without changing their identity or reason', () => {
    let project = persist(
      apply(makeProject(), [
        { kind: 'park_shot', shotId: 'shot_1' },
        { kind: 'park_beat', beatId: 'beat_2' },
      ]).project
    );
    expect(project.bin).toEqual([
      { kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' },
      { kind: 'beat', beatId: 'beat_2', reason: 'lifted' },
    ]);

    project = persist(apply(project, [{ kind: 'reorder_bin', bin: project.bin.toReversed() }], 'reorder_bin').project);
    expect(project.bin.map((item) => item.kind)).toEqual(['beat', 'shot']);
    expectReason(project, [{ kind: 'reorder_bin', bin: structuredClone(project.bin) }], 'invalid_operation');

    const changedReason = structuredClone(project.bin);
    const binnedBeat = changedReason.find((item) => item.kind === 'beat');
    if (!binnedBeat || binnedBeat.kind !== 'beat') throw new Error('expected binned Beat fixture');
    binnedBeat.reason = 'alternate';
    expectReason(project, [{ kind: 'reorder_bin', bin: changedReason }], 'invalid_operation');
  });

  it('supports duration edits and clearing persisted optional controls', () => {
    let project = persist(
      apply(makeProject(), [
        { kind: 'edit_shot', shotId: 'shot_1', changes: { durationSeconds: 6 } },
        { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 2500 } },
      ]).project
    );
    expect(project.shots.shot_1!.durationSeconds).toBe(6);
    expect(project.spendPolicy).not.toBeNull();

    project = apply(project, [{ kind: 'set_spend_policy', policy: null }], 'clear_spend_policy').project;
    expect(project.spendPolicy).toBeNull();
  });
});

describe('schema-5 mutation bounds and hostile input totality', () => {
  it('enforces the Beat cap and ordered-operation cap without partial changes', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let index = 1; index <= STUDIO_MAX_BEATS; index += 1) {
      const beatId = `beat_${index}`;
      project.beatOrder.push(beatId);
      project.beats[beatId] = { id: beatId, title: '', story: '', targetSeconds: null, shotOrder: [] };
    }
    expectReason(
      project,
      [
        {
          kind: 'add_beat',
          beatId: 'beat_25',
          beat: { title: '', story: '', targetSeconds: null },
          beforeBeatId: null,
        },
      ],
      'beat_capacity_reached'
    );

    const tooMany = Array.from({ length: STUDIO_MAX_MUTATION_OPERATIONS + 1 }, (_, index) => ({
      kind: 'set_brief' as const,
      brief: `Brief ${index}`,
    }));
    expectReason(makeProject(), tooMany, 'invalid_operation');
  });

  it('rejects unknown, hidden, symbol, accessor, and proxy data without invoking hostile code', () => {
    expect(validateStudioMutationOperationV2({ kind: 'set_brief', brief: '', extra: true })).toBe(false);

    const hidden = { kind: 'set_brief', brief: '' };
    Object.defineProperty(hidden, 'hidden', { value: true });
    expect(validateStudioMutationOperationV2(hidden)).toBe(false);

    const symbol = { kind: 'set_brief', brief: '', [Symbol('extra')]: true };
    expect(validateStudioMutationOperationV2(symbol)).toBe(false);

    let calls = 0;
    const accessor = { kind: 'set_brief' } as { kind: string; brief?: string };
    Object.defineProperty(accessor, 'brief', {
      enumerable: true,
      get() {
        calls += 1;
        return '';
      },
    });
    expect(validateStudioMutationOperationV2(accessor)).toBe(false);
    expect(calls).toBe(0);
    expect(validateStudioMutationOperationV2(new Proxy({ kind: 'set_brief', brief: '' }, {}))).toBe(false);

    const cyclic: Record<string, unknown> = { kind: 'set_brief', brief: '' };
    cyclic.self = cyclic;
    expect(validateStudioMutationOperationV2(cyclic)).toBe(false);

    const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(customPrototype, { kind: 'set_brief', brief: '' });
    expect(validateStudioMutationOperationV2(customPrototype)).toBe(false);

    const customArrayPrototype = ['ref_1'];
    Object.setPrototypeOf(customArrayPrototype, null);
    expect(
      validateStudioMutationOperationV2({
        kind: 'set_shot_reference_binding',
        shotId: 'shot_1',
        characterReferenceIds: customArrayPrototype,
        backgroundReferenceId: null,
      })
    ).toBe(false);

    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = { id: 'ref_1', kind: 'character', label: 'Ming', prompt: 'Ming.' };
    Object.defineProperty(sparse, 'extra', { value: true, enumerable: true, writable: true, configurable: true });
    expect(validateStudioMutationOperationV2({ kind: 'set_reference_plan', references: sparse })).toBe(false);
  });

  it('rejects malformed batch and context envelopes without mutating the project', () => {
    const project = makeProject();
    const before = structuredClone(project);
    const wrongVersion = {
      ...mutationBatch(project, [{ kind: 'set_brief', brief: 'Changed' }]),
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION + 1,
    };
    expect(() =>
      applyStudioMutationBatchV2(project, wrongVersion as StudioMutationBatchV2, {
        mutationId: 'wrong_version',
        capturedAt: laterTimestamp,
      })
    ).toThrow(StudioMutationErrorV2);
    const malformed = { ...mutationBatch(project, [{ kind: 'set_brief', brief: 'Changed' }]), extra: true };
    expect(() =>
      applyStudioMutationBatchV2(project, malformed as StudioMutationBatchV2, {
        mutationId: 'malformed',
        capturedAt: laterTimestamp,
      })
    ).toThrow(StudioMutationErrorV2);

    const validBatch = mutationBatch(project, [{ kind: 'set_brief', brief: 'Changed' }]);
    const sparseOperations: unknown[] = [];
    sparseOperations.length = 2;
    sparseOperations[1] = { kind: 'set_brief', brief: 'Changed' };
    Object.defineProperty(sparseOperations, 'extra', {
      value: true,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const badBatches: unknown[] = [
      null,
      { ...validBatch, projectId: 'another_project' },
      { ...validBatch, expectedRevision: 1.5 },
      { ...validBatch, operations: [] },
      { ...validBatch, operations: sparseOperations },
    ];
    for (const badBatch of badBatches) {
      expect(() =>
        applyStudioMutationBatchV2(project, badBatch as StudioMutationBatchV2, {
          mutationId: 'bad_batch',
          capturedAt: laterTimestamp,
        })
      ).toThrow(StudioMutationErrorV2);
    }

    const badContexts: unknown[] = [
      null,
      { mutationId: 'bad_context', capturedAt: laterTimestamp, extra: true },
      { mutationId: '', capturedAt: laterTimestamp },
      { mutationId: 'bad_context', capturedAt: 1 },
      { mutationId: 'bad_context', capturedAt: 'short' },
      { mutationId: 'bad_context', capturedAt: '2026-99-99T00:00:00.000Z' },
      { mutationId: 'bad_context', capturedAt: '2026-08-17t00:00:01.000z' },
    ];
    for (const badContext of badContexts) {
      expect(() =>
        applyStudioMutationBatchV2(project, validBatch, badContext as { mutationId: string; capturedAt: string })
      ).toThrow(StudioMutationErrorV2);
    }
    expect(project).toEqual(before);
  });
});
