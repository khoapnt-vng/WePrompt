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
  StudioBeat,
  StudioGenerationRequestPlan,
  StudioJobV2,
  StudioProjectV2,
  StudioQuotedGeneration,
  StudioShot,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioFrameExtractionId } from '@/process/services/creative-studio/service/schema2/generation';
import {
  projectStudioChainBoundaryVerificationIdsV2,
  projectStudioChainStatusV2,
  projectStudioWorkspaceStatusV2,
} from '@/process/services/creative-studio/service/schema2/workspaceStatus';

const timestamp = '2026-08-17T00:00:00.000Z';
const digest = 'a'.repeat(64);

const makeShot = (id: string, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  line: '',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 5,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  seedStillId: null,
  selectedTakeId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[] = []): StudioBeat => ({
  id,
  title: '',
  action: '',
  look: '',
  actionRevision: 1,
  targetSeconds: null,
  shotOrder,
  lineHistory: [],
});

const makeProject = (shotOrder = ['shot_1', 'shot_2']): StudioProjectV2 => ({
  schemaVersion: 2,
  revision: 7,
  id: 'project_1',
  name: 'Project One',
  brief: '',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  beatOrder: ['beat_1'],
  beats: { beat_1: makeBeat('beat_1', shotOrder) },
  shots: Object.fromEntries(shotOrder.map((shotId) => [shotId, makeShot(shotId)])),
  bin: [],
  bedAssetId: null,
  matchToShotId: null,
  spendPolicy: null,
  spendAuthorizations: [],
  frameExtractions: {},
  undoHistory: [],
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makeAsset = (
  id: string,
  shotId: string,
  mediaKind: 'image' | 'video' = 'video',
  collection: StudioAssetV2['managedAsset']['collection'] = mediaKind === 'video' ? 'assets' : 'imports'
): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png',
  managedAsset: { collection, fileName: `${id}.${mediaKind === 'video' ? 'mp4' : 'png'}` },
  byteSize: 1,
  sha256: digest,
  ...(mediaKind === 'video' ? { durationSeconds: 10 } : {}),
  createdAt: timestamp,
});

const addAsset = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string,
  mediaKind: 'image' | 'video' = 'video',
  collection?: StudioAssetV2['managedAsset']['collection']
): StudioAssetV2 => {
  const asset = makeAsset(assetId, shotId, mediaKind, collection);
  project.assets[assetId] = asset;
  project.shots[shotId]!.assetIds.push(assetId);
  return asset;
};

const resolvedPlan = (
  conditioningInput: NonNullable<StudioJobV2['requestSnapshot']>['conditioningInput'] = null,
  prompt = 'prompt'
): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt,
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
    conditioningInput,
  },
});

const deferredPredecessorPlan = (
  upstreamItemId = 'item_upstream',
  predecessorShotId = 'shot_1'
): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'dependent prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
  },
  dependency: { kind: 'authorized_predecessor', upstreamItemId, predecessorShotId },
});

const deferredSeedPlan = (upstreamItemId = 'item_seed', shotId = 'shot_1'): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'seed-dependent prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
  },
  dependency: { kind: 'authorized_seed', upstreamItemId, shotId },
});

const makeItem = (
  id: string,
  shotId: string,
  requestPlan: StudioGenerationRequestPlan,
  purpose: StudioQuotedGeneration['purpose'] = 'video_take',
  generationCount = 1
): StudioQuotedGeneration => ({
  id,
  shotId,
  purpose,
  routeId: `${purpose}_route`,
  generationCount,
  requestPlan,
  rateUnit: purpose === 'seed_still' ? 'generation' : 'second',
  rateMinorUnits: 1,
});

const makeAuthorization = (
  id: string,
  baseItems: StudioQuotedGeneration[],
  cascadeItems: StudioQuotedGeneration[] = []
): StudioSpendAuthorization => ({
  id,
  projectId: 'project_1',
  projectRevision: 6,
  originReferenceHandoffId: null,
  rateCardDigest: 'b'.repeat(64),
  currency: 'USD',
  baseItems,
  cascadeItems,
  lowerMinorUnits: 1,
  upperMinorUnits: 1,
  expiresAt: '2026-08-17T00:05:00.000Z',
  confirmedAt: timestamp,
  providerBindings: [...baseItems, ...cascadeItems].map((item) => ({
    itemId: item.id,
    provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
  })),
  idempotencyKeys: [...baseItems, ...cascadeItems].flatMap((item) =>
    Array.from({ length: item.generationCount }, (_, generationIndex) => ({
      itemId: item.id,
      generationIndex,
      key: `idem_${id}_${item.id}_${generationIndex}`,
    }))
  ),
});

const makeJob = (
  id: string,
  shotId: string,
  requestPlan: StudioGenerationRequestPlan,
  overrides: Partial<StudioJobV2> = {}
): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  status: requestPlan.kind === 'resolved' ? 'queued_local' : 'waiting_for_conditioning',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
  idempotencyKey: `idem_${id}`,
  providerJobId: null,
  cancellationPolicy: 'queued_and_running',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  purpose: 'video_take',
  authorizationId: 'auth_1',
  authorizationItemId: 'item_dependent',
  generationIndex: 0,
  requestPlan,
  requestSnapshot: requestPlan.kind === 'resolved' ? requestPlan.snapshot : null,
  spendReceipt: null,
  outputAssetIdsByRole: { primary: null, poster: null },
  ...overrides,
});

const addJob = (project: StudioProjectV2, job: StudioJobV2): void => {
  project.jobs[job.id] = job;
  project.shots[job.shotId]?.jobIds.push(job.id);
};

const addSucceededPrimary = (
  project: StudioProjectV2,
  authorizationId: string,
  item: StudioQuotedGeneration,
  assetId: string,
  generationIndex = 0
): StudioJobV2 => {
  const asset = addAsset(project, item.shotId, assetId, item.purpose === 'seed_still' ? 'image' : 'video', 'assets');
  const job = makeJob(`job_${assetId}`, item.shotId, item.requestPlan, {
    status: 'succeeded',
    purpose: item.purpose,
    authorizationId,
    authorizationItemId: item.id,
    generationIndex,
    providerJobId: `remote_${assetId}`,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
  });
  addJob(project, job);
  return job;
};

const makeCascadeProject = () => {
  const project = makeProject(['shot_1', 'shot_2']);
  const upstream = makeItem('item_upstream', 'shot_1', resolvedPlan(), 'video_take');
  const dependentPlan = deferredPredecessorPlan(upstream.id, 'shot_1');
  const dependent = makeItem('item_dependent', 'shot_2', dependentPlan, 'video_take');
  const authorization = makeAuthorization('auth_1', [upstream], [dependent]);
  project.spendAuthorizations.push(authorization);
  const upstreamJob = makeJob('job_upstream', 'shot_1', upstream.requestPlan, {
    status: 'running',
    authorizationId: authorization.id,
    authorizationItemId: upstream.id,
    providerJobId: 'remote_upstream',
  });
  const dependentJob = makeJob('job_dependent', 'shot_2', dependentPlan, {
    authorizationId: authorization.id,
    authorizationItemId: dependent.id,
  });
  addJob(project, upstreamJob);
  addJob(project, dependentJob);
  return { project, authorization, upstream, dependent, upstreamJob, dependentJob };
};

const exactKeys = (value: object): string[] => Object.keys(value).sort();

describe('projectStudioWorkspaceStatusV2', () => {
  it('projects undo top and active park targets before Bin-order restore targets by value', () => {
    const project = makeProject(['shot_1', 'shot_2']);
    project.beatOrder.push('beat_2');
    project.beats.beat_2 = makeBeat('beat_2', ['shot_3']);
    project.shots.shot_3 = makeShot('shot_3');
    project.beats.beat_alt = makeBeat('beat_alt');
    project.shots.shot_parked = makeShot('shot_parked');
    const activeTake = addAsset(project, 'shot_1', 'take_active', 'image', 'imports');
    const binnedTake = addAsset(project, 'shot_1', 'take_binned', 'image', 'imports');
    project.bin = [
      { kind: 'take', assetId: binnedTake.id, reason: 'alternate' },
      { kind: 'shot', beatId: 'beat_2', shotId: 'shot_parked', reason: 'lifted' },
      { kind: 'beat', beatId: 'beat_alt', reason: 'alternate' },
    ];
    project.undoHistory.push({
      id: 'mutation_7',
      sourceRevision: 7,
      label: 'edit_shot',
      patches: [],
    });
    const before = structuredClone(project);

    const status = projectStudioWorkspaceStatusV2(project);

    expect(project).toEqual(before);
    expect(status).toMatchObject({
      projectId: 'project_1',
      projectRevision: 7,
      undoTop: { entryId: 'mutation_7', sourceRevision: 7, label: 'edit_shot' },
      dirtyShots: [],
      cascadeProgress: [],
    });
    expect(
      status.parkEligibility.map(({ subject, action, beatId, shotId, assetId }) => ({
        subject,
        action,
        beatId,
        shotId,
        assetId,
      }))
    ).toEqual([
      { subject: 'beat', action: 'park', beatId: 'beat_1', shotId: null, assetId: null },
      { subject: 'shot', action: 'park', beatId: 'beat_1', shotId: 'shot_1', assetId: null },
      { subject: 'take', action: 'park', beatId: 'beat_1', shotId: 'shot_1', assetId: activeTake.id },
      { subject: 'shot', action: 'park', beatId: 'beat_1', shotId: 'shot_2', assetId: null },
      { subject: 'beat', action: 'park', beatId: 'beat_2', shotId: null, assetId: null },
      { subject: 'shot', action: 'park', beatId: 'beat_2', shotId: 'shot_3', assetId: null },
      { subject: 'take', action: 'restore', beatId: 'beat_1', shotId: 'shot_1', assetId: binnedTake.id },
      { subject: 'shot', action: 'restore', beatId: 'beat_2', shotId: 'shot_parked', assetId: null },
      { subject: 'beat', action: 'restore', beatId: 'beat_alt', shotId: null, assetId: null },
    ]);
    expect(status.parkEligibility.every((row) => row.allowed === (row.blockers.length === 0))).toBe(true);
    expect(exactKeys(status.undoTop!)).toEqual(['entryId', 'label', 'sourceRevision']);
    expect(exactKeys(status.parkEligibility[0]!)).toEqual([
      'action',
      'allowed',
      'assetId',
      'beatId',
      'blockers',
      'shotId',
      'subject',
    ]);
    project.undoHistory[0]!.label = 'mutated later';
    expect(status.undoTop?.label).toBe('edit_shot');
  });

  it('uses the shared dirty-shot projection without exposing generation authority', () => {
    const project = makeProject(['shot_1']);
    const take = addAsset(project, 'shot_1', 'take_1');
    project.shots.shot_1!.selectedTakeId = take.id;
    const job = makeJob('job_take', 'shot_1', resolvedPlan(null, 'stale prompt'), {
      status: 'succeeded',
      authorizationItemId: 'item_take',
      providerJobId: 'remote_take',
      outputAssetIds: [take.id],
      outputAssetIdsByRole: { primary: take.id, poster: null },
      spendReceipt: {
        authorizationId: 'auth_1',
        itemId: 'item_take',
        jobId: 'job_take',
        purpose: 'video_take',
        routeId: 'old_route',
        currency: 'USD',
        rateUnit: 'second',
        rateMinorUnits: 1,
        durationSeconds: 5,
        generationIndex: 0,
        generationCount: 1,
        totalMinorUnits: 5,
      },
    });
    addJob(project, job);

    const status = projectStudioWorkspaceStatusV2(project);

    expect(status.dirtyShots).toEqual([{ shotId: 'shot_1', causes: ['generation_out_of_date'] }]);
    expect(exactKeys(status)).toEqual([
      'cascadeProgress',
      'currentVideoJobs',
      'dirtyShots',
      'parkEligibility',
      'projectId',
      'projectRevision',
      'undoTop',
    ]);
    expect(exactKeys(status.dirtyShots[0]!)).toEqual(['causes', 'shotId']);
  });

  it('deduplicates Beat/Shot blockers in contained-shot and frozen code order', () => {
    const project = makeProject(['shot_1', 'shot_2']);
    project.matchToShotId = 'shot_1';
    addJob(
      project,
      makeJob('job_own', 'shot_1', resolvedPlan(), {
        status: 'running',
        providerJobId: 'remote_own',
      })
    );
    addJob(
      project,
      makeJob(
        'job_downstream',
        'shot_2',
        resolvedPlan({
          kind: 'predecessor_frame',
          predecessorShotId: 'shot_1',
          takeAssetId: 'take_1',
          frameAssetId: 'frame_asset_1',
          endpointSeconds: 10,
        }),
        { status: 'running', providerJobId: 'remote_downstream' }
      )
    );
    addJob(project, makeJob('job_waiting', 'shot_2', deferredPredecessorPlan('item_upstream', 'shot_1')));
    project.frameExtractions.frame_pending = {
      id: 'frame_pending',
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 10,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
    };

    const status = projectStudioWorkspaceStatusV2(project);
    const beat = status.parkEligibility.find((row) => row.subject === 'beat' && row.action === 'park')!;
    const shot = status.parkEligibility.find(
      (row) => row.subject === 'shot' && row.action === 'park' && row.shotId === 'shot_1'
    )!;
    const expected = [
      { shotId: 'shot_1', code: 'current_match_to' },
      { shotId: 'shot_1', code: 'own_nonterminal_job' },
      { shotId: 'shot_1', code: 'own_pending_frame' },
      { shotId: 'shot_1', code: 'downstream_nonterminal_job' },
      { shotId: 'shot_1', code: 'downstream_pending_frame' },
      { shotId: 'shot_1', code: 'waiting_authorization_dependency' },
      { shotId: 'shot_1', code: 'bound_nonterminal_request' },
    ];
    expect(beat.blockers).toEqual([
      ...expected,
      { shotId: 'shot_2', code: 'own_nonterminal_job' },
      { shotId: 'shot_2', code: 'bound_nonterminal_request' },
    ]);
    expect(shot.blockers).toEqual(expected);
    expect(beat.allowed).toBe(false);
    expect(shot.allowed).toBe(false);
  });

  it('reports the reachable Shot-restore and Take-Bin capacity blockers with exact identities', () => {
    const shotIds = Array.from({ length: 8 }, (_, index) => `shot_${index}`);
    const project = makeProject(shotIds);
    project.shots.shot_parked = makeShot('shot_parked');
    project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_parked', reason: 'lifted' });
    const activeTake = addAsset(project, 'shot_0', 'take_active', 'image', 'imports');
    for (let index = 0; index < 96; index += 1) {
      const asset = addAsset(project, 'shot_0', `take_bin_${index}`, 'image', 'imports');
      project.bin.push({ kind: 'take', assetId: asset.id, reason: 'alternate' });
    }

    const status = projectStudioWorkspaceStatusV2(project);
    const takeRow = status.parkEligibility.find((row) => row.assetId === activeTake.id)!;
    const shotRestore = status.parkEligibility.find((row) => row.subject === 'shot' && row.action === 'restore')!;
    expect(takeRow.blockers).toEqual([{ shotId: 'shot_0', code: 'take_bin_capacity_reached' }]);
    expect(shotRestore.blockers).toEqual([{ shotId: null, code: 'beat_shot_capacity_reached' }]);
    expect(status.parkEligibility.flatMap((row) => row.blockers)).not.toContainEqual(
      expect.objectContaining({ code: 'beat_capacity_reached' })
    );
  });

  it('orders every Take-specific blocker without exposing the dependent job or item', () => {
    const project = makeProject(['shot_1', 'shot_2']);
    const take = addAsset(project, 'shot_1', 'take_blocked');
    project.shots.shot_1!.selectedTakeId = take.id;
    addJob(
      project,
      makeJob('job_producer', 'shot_1', resolvedPlan(), {
        status: 'succeeded',
        authorizationItemId: 'item_upstream',
        providerJobId: 'remote_producer',
        outputAssetIds: [take.id],
        outputAssetIdsByRole: { primary: take.id, poster: null },
      })
    );
    addJob(project, makeJob('job_waiting', 'shot_2', deferredPredecessorPlan('item_upstream', 'shot_1')));
    addJob(
      project,
      makeJob(
        'job_bound',
        'shot_2',
        resolvedPlan({
          kind: 'predecessor_frame',
          predecessorShotId: 'shot_1',
          takeAssetId: take.id,
          frameAssetId: 'frame_asset',
          endpointSeconds: 10,
        }),
        { status: 'running', providerJobId: 'remote_bound' }
      )
    );
    for (let index = 0; index < 96; index += 1) {
      const binned = addAsset(project, 'shot_1', `binned_${index}`, 'image', 'imports');
      project.bin.push({ kind: 'take', assetId: binned.id, reason: 'alternate' });
    }

    const row = projectStudioWorkspaceStatusV2(project).parkEligibility.find(
      (candidate) => candidate.subject === 'take' && candidate.action === 'park' && candidate.assetId === take.id
    )!;
    expect(row.blockers).toEqual([
      { shotId: 'shot_1', code: 'waiting_authorization_dependency' },
      { shotId: 'shot_1', code: 'current_selected_take' },
      { shotId: 'shot_1', code: 'nonterminal_conditioning_use' },
      { shotId: 'shot_1', code: 'take_bin_capacity_reached' },
    ]);
    expect(row).not.toHaveProperty('jobId');
    expect(row).not.toHaveProperty('itemId');
  });
});

describe('workspace cascade progress', () => {
  it('projects upstream-running then choose-take with bounded canonical primary IDs', () => {
    const running = makeCascadeProject();
    expect(projectStudioWorkspaceStatusV2(running.project).cascadeProgress).toEqual([
      {
        dependentShotId: 'shot_2',
        upstreamShotId: 'shot_1',
        eligiblePrimaryAssetIds: [],
        canRetryConditioningFrame: false,
        canCancelWaiting: true,
        waitingReason: 'upstream_running',
      },
    ]);
    expect(exactKeys(projectStudioWorkspaceStatusV2(running.project).cascadeProgress[0]!)).toEqual([
      'canCancelWaiting',
      'canRetryConditioningFrame',
      'dependentShotId',
      'eligiblePrimaryAssetIds',
      'upstreamShotId',
      'waitingReason',
    ]);

    running.upstreamJob.status = 'succeeded';
    running.upstreamJob.providerJobId = 'remote_upstream';
    running.upstream.generationCount = 2;
    const take = addAsset(running.project, 'shot_1', 'take_1');
    running.upstreamJob.outputAssetIds = [take.id];
    running.upstreamJob.outputAssetIdsByRole = { primary: take.id, poster: null };
    addSucceededPrimary(running.project, running.authorization.id, running.upstream, 'take_2', 1);
    expect(projectStudioWorkspaceStatusV2(running.project).cascadeProgress).toEqual([
      {
        dependentShotId: 'shot_2',
        upstreamShotId: 'shot_1',
        eligiblePrimaryAssetIds: ['take_1', 'take_2'],
        canRetryConditioningFrame: false,
        canCancelWaiting: true,
        waitingReason: 'choose_take',
      },
    ]);
  });

  it('projects pending and failed exact conditioning frames with independent action flags', () => {
    const fixture = makeCascadeProject();
    fixture.upstreamJob.status = 'succeeded';
    const take = addAsset(fixture.project, 'shot_1', 'take_1');
    fixture.upstreamJob.outputAssetIds = [take.id];
    fixture.upstreamJob.outputAssetIdsByRole = { primary: take.id, poster: null };
    fixture.project.shots.shot_1!.durationSeconds = 8;
    fixture.project.shots.shot_1!.selectedTakeId = take.id;
    const frameId = createStudioFrameExtractionId({ shotId: 'shot_1', takeAssetId: take.id, endpointSeconds: 10 });
    fixture.project.frameExtractions[frameId] = {
      id: frameId,
      shotId: 'shot_1',
      takeAssetId: take.id,
      endpointSeconds: 10,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
    };

    expect(projectStudioWorkspaceStatusV2(fixture.project).cascadeProgress[0]).toMatchObject({
      waitingReason: 'conditioning_frame',
      canRetryConditioningFrame: false,
      canCancelWaiting: true,
      eligiblePrimaryAssetIds: ['take_1'],
    });
    fixture.project.frameExtractions[frameId] = {
      ...fixture.project.frameExtractions[frameId]!,
      status: 'failed',
      errorCode: 'decode_failed',
    };
    expect(projectStudioWorkspaceStatusV2(fixture.project).cascadeProgress[0]).toMatchObject({
      waitingReason: 'conditioning_failed',
      canRetryConditioningFrame: true,
      canCancelWaiting: true,
    });
    fixture.project.frameExtractions[frameId]!.takeAssetId = 'replacement_take';
    expect(projectStudioWorkspaceStatusV2(fixture.project).cascadeProgress[0]).toMatchObject({
      waitingReason: 'conditioning_frame',
      canRetryConditioningFrame: false,
    });
  });

  it('gives dependency-failed precedence over cancelled siblings and emits all-cancelled separately', () => {
    const fixture = makeCascadeProject();
    fixture.dependent.generationCount = 2;
    fixture.dependentJob.status = 'failed';
    fixture.dependentJob.error = { code: 'dependency_failed', messageKey: 'dependency_failed' };
    const cancelled = makeJob('job_dependent_cancelled', 'shot_2', fixture.dependent.requestPlan, {
      status: 'cancelled',
      authorizationId: fixture.authorization.id,
      authorizationItemId: fixture.dependent.id,
      generationIndex: 1,
    });
    addJob(fixture.project, cancelled);

    expect(projectStudioWorkspaceStatusV2(fixture.project).cascadeProgress[0]).toEqual({
      dependentShotId: 'shot_2',
      upstreamShotId: 'shot_1',
      eligiblePrimaryAssetIds: [],
      canRetryConditioningFrame: false,
      canCancelWaiting: false,
      waitingReason: 'dependency_failed',
    });
    fixture.dependentJob.status = 'cancelled';
    fixture.dependentJob.error = null;
    expect(projectStudioWorkspaceStatusV2(fixture.project).cascadeProgress[0]).toMatchObject({
      waitingReason: 'cancelled',
      canRetryConditioningFrame: false,
      canCancelWaiting: false,
      eligiblePrimaryAssetIds: [],
    });

    fixture.dependentJob.providerJobId = 'remote_cancelled';
    expect(projectStudioWorkspaceStatusV2(fixture.project).cascadeProgress).toEqual([]);
  });

  it('projects choose-seed and suppresses older waiting history when the latest item is runnable', () => {
    const project = makeProject(['shot_1']);
    const seedItem = makeItem('item_seed', 'shot_1', resolvedPlan(), 'seed_still');
    const dependentPlan = deferredSeedPlan(seedItem.id, 'shot_1');
    const dependent = makeItem('item_seed_dependent', 'shot_1', dependentPlan);
    const oldAuthorization = makeAuthorization('auth_old', [seedItem], [dependent]);
    project.spendAuthorizations.push(oldAuthorization);
    addSucceededPrimary(project, oldAuthorization.id, seedItem, 'seed_primary');
    addJob(
      project,
      makeJob('job_seed_dependent', 'shot_1', dependentPlan, {
        authorizationId: oldAuthorization.id,
        authorizationItemId: dependent.id,
      })
    );
    expect(projectStudioWorkspaceStatusV2(project).cascadeProgress[0]).toMatchObject({
      waitingReason: 'choose_seed',
      upstreamShotId: 'shot_1',
      eligiblePrimaryAssetIds: ['seed_primary'],
    });

    const latestItem = makeItem('item_latest', 'shot_1', resolvedPlan());
    const latestAuthorization = makeAuthorization('auth_latest', [latestItem]);
    project.spendAuthorizations.push(latestAuthorization);
    addJob(
      project,
      makeJob('job_latest', 'shot_1', latestItem.requestPlan, {
        status: 'queued_local',
        authorizationId: latestAuthorization.id,
        authorizationItemId: latestItem.id,
      })
    );
    expect(projectStudioWorkspaceStatusV2(project).cascadeProgress).toEqual([]);
  });

  it('projects exact latest video authorization jobs for every active Shot in film order', () => {
    const fixture = makeCascadeProject();
    expect(projectStudioWorkspaceStatusV2(fixture.project).currentVideoJobs).toEqual([
      { shotId: 'shot_1', jobIds: ['job_upstream'] },
      { shotId: 'shot_2', jobIds: ['job_dependent'] },
    ]);

    const latestItem = makeItem('item_latest', 'shot_1', resolvedPlan());
    const latestAuthorization = makeAuthorization('auth_latest', [latestItem]);
    fixture.project.spendAuthorizations.push(latestAuthorization);
    addJob(
      fixture.project,
      makeJob('job_latest', 'shot_1', latestItem.requestPlan, {
        authorizationId: latestAuthorization.id,
        authorizationItemId: latestItem.id,
      })
    );

    const rows = projectStudioWorkspaceStatusV2(fixture.project).currentVideoJobs;
    expect(rows).toEqual([
      { shotId: 'shot_1', jobIds: ['job_latest'] },
      { shotId: 'shot_2', jobIds: ['job_dependent'] },
    ]);
    expect(rows.map(exactKeys)).toEqual([
      ['jobIds', 'shotId'],
      ['jobIds', 'shotId'],
    ]);
  });
});

describe('projectStudioChainStatusV2', () => {
  const makeFailedChain = () => {
    const project = makeProject(['shot_1', 'shot_2']);
    const take = addAsset(project, 'shot_1', 'take_1');
    project.shots.shot_1!.selectedTakeId = take.id;
    project.shots.shot_1!.trimOutSeconds = 2;
    const frameId = createStudioFrameExtractionId({ shotId: 'shot_1', takeAssetId: take.id, endpointSeconds: 8 });
    project.frameExtractions[frameId] = {
      id: frameId,
      shotId: 'shot_1',
      takeAssetId: take.id,
      endpointSeconds: 8,
      frameAssetId: null,
      status: 'failed',
      errorCode: 'decode_failed',
    };
    return { project, frameId };
  };

  it('projects only the exact current active-chain failure in film order with safe keys', () => {
    const { project } = makeFailedChain();
    const status = projectStudioChainStatusV2(project);
    expect(status).toEqual({
      projectId: 'project_1',
      projectRevision: 7,
      conditioningFailures: [{ dependentShotId: 'shot_2', reason: 'conditioning_failed', canRetry: true }],
      boundaries: [
        {
          upstreamShotId: 'shot_1',
          dependentShotId: 'shot_2',
          status: 'gone',
          frameAssetId: null,
        },
      ],
    });
    expect(exactKeys(status.conditioningFailures[0]!)).toEqual(['canRetry', 'dependentShotId', 'reason']);
    expect(exactKeys(status.boundaries[0]!)).toEqual(['dependentShotId', 'frameAssetId', 'status', 'upstreamShotId']);
  });

  it('suppresses changed endpoints, nonfailed states, hard cuts, and a current nonterminal owner', () => {
    const changed = makeFailedChain();
    changed.project.shots.shot_1!.trimOutSeconds = 1;
    expect(projectStudioChainStatusV2(changed.project).conditioningFailures).toEqual([]);

    const pending = makeFailedChain();
    pending.project.frameExtractions[pending.frameId]!.status = 'pending';
    pending.project.frameExtractions[pending.frameId]!.errorCode = null;
    expect(projectStudioChainStatusV2(pending.project).conditioningFailures).toEqual([]);

    const hardCut = makeFailedChain();
    hardCut.project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(projectStudioChainStatusV2(hardCut.project).conditioningFailures).toEqual([]);

    const owned = makeFailedChain();
    addJob(owned.project, makeJob('job_current_owner', 'shot_2', deferredPredecessorPlan('item_upstream', 'shot_1')));
    expect(projectStudioChainStatusV2(owned.project).conditioningFailures).toEqual([]);
  });

  it('projects empty, verified on-disk, and fail-closed ready frame boundaries without leaking extraction authority', () => {
    const project = makeProject(['shot_1', 'shot_2', 'shot_3']);
    const firstTake = addAsset(project, 'shot_1', 'take_1');
    project.shots.shot_1!.selectedTakeId = firstTake.id;
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: firstTake.id,
      endpointSeconds: 10,
    });
    const frame = addAsset(project, 'shot_1', 'frame_1', 'image', 'conditioningFrames');
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      takeAssetId: firstTake.id,
      endpointSeconds: 10,
      frameAssetId: frame.id,
      status: 'ready',
      errorCode: null,
    };

    expect(projectStudioChainBoundaryVerificationIdsV2(project)).toEqual([extractionId]);
    expect(projectStudioChainStatusV2(project).boundaries).toEqual([
      { upstreamShotId: 'shot_1', dependentShotId: 'shot_2', status: 'gone', frameAssetId: null },
      { upstreamShotId: 'shot_2', dependentShotId: 'shot_3', status: 'empty', frameAssetId: null },
    ]);

    const verified = new Map([
      [
        extractionId,
        {
          extractionId,
          shotId: 'shot_1',
          takeAssetId: firstTake.id,
          endpointSeconds: 10,
          frameAssetId: frame.id,
          byteSize: frame.byteSize,
          sha256: frame.sha256,
        },
      ],
    ]);
    const projected = projectStudioChainStatusV2(project, verified);
    expect(projected.boundaries[0]).toEqual({
      upstreamShotId: 'shot_1',
      dependentShotId: 'shot_2',
      status: 'on_disk',
      frameAssetId: 'frame_1',
    });
    expect(JSON.stringify(projected.boundaries)).not.toContain(extractionId);

    verified.set(extractionId, { ...verified.get(extractionId)!, frameAssetId: 'wrong_frame' });
    expect(projectStudioChainStatusV2(project, verified).boundaries[0]).toMatchObject({
      status: 'gone',
      frameAssetId: null,
    });
  });

  it('omits hard cuts and fails changed, pending, or malformed extraction ownership closed', () => {
    const { project, frameId } = makeFailedChain();
    project.frameExtractions[frameId]!.status = 'pending';
    project.frameExtractions[frameId]!.errorCode = null;
    expect(projectStudioChainStatusV2(project).boundaries[0]).toMatchObject({ status: 'empty', frameAssetId: null });

    project.frameExtractions[frameId]!.status = 'ready';
    project.frameExtractions[frameId]!.frameAssetId = 'frame_missing';
    expect(projectStudioChainBoundaryVerificationIdsV2(project)).toEqual([frameId]);
    expect(projectStudioChainStatusV2(project).boundaries[0]).toMatchObject({ status: 'gone', frameAssetId: null });

    project.frameExtractions[frameId]!.takeAssetId = 'take_other';
    expect(projectStudioChainBoundaryVerificationIdsV2(project)).toEqual([]);
    expect(projectStudioChainStatusV2(project).boundaries[0]).toMatchObject({ status: 'gone', frameAssetId: null });

    project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(projectStudioChainStatusV2(project).boundaries).toEqual([]);
  });
});
