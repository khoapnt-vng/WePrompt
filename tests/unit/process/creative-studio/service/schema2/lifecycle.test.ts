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
  StudioJobV2,
  StudioProjectV2,
  StudioQuotedGeneration,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import {
  advanceStudioWaitingBindingsV2,
  createStudioFrameExtractionId,
} from '@/process/services/creative-studio/service/schema2';

const capturedAt = '2026-08-17T00:00:05.000Z';
const createdAt = '2026-08-17T00:00:00.000Z';

const resolvedPlan = (purpose: 'seed_still' | 'video_take'): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt: `${purpose} prompt`,
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
    conditioningInput: null,
  },
});

const deferredPredecessorPlan = (): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'dependent prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
  },
  dependency: { kind: 'authorized_predecessor', upstreamItemId: 'item_upstream', predecessorShotId: 'shot_1' },
});

const deferredSeedPlan = (): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'seed-dependent prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
  },
  dependency: { kind: 'authorized_seed', upstreamItemId: 'item_upstream', shotId: 'shot_1' },
});

const item = (
  id: string,
  shotId: string,
  purpose: 'seed_still' | 'video_take',
  requestPlan: StudioGenerationRequestPlan,
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

const job = (
  id: string,
  shotId: string,
  authorizationItemId: string,
  requestPlan: StudioGenerationRequestPlan,
  overrides: Partial<StudioJobV2> = {}
): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  status: requestPlan.kind === 'resolved' ? 'queued_local' : 'waiting_for_conditioning',
  provider: { providerId: 'provider_1', adapterId: 'openrouter-video-v1', model: 'model_1' },
  idempotencyKey: `key_${id}`,
  providerJobId: null,
  cancellationPolicy: 'queued_and_running',
  outputAssetIds: [],
  purpose: 'video_take',
  authorizationId: 'auth_1',
  authorizationItemId,
  generationIndex: 0,
  requestPlan,
  requestSnapshot: requestPlan.kind === 'resolved' ? requestPlan.snapshot : null,
  spendReceipt: null,
  outputAssetIdsByRole: { primary: null, poster: null },
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const asset = (
  id: string,
  shotId: string,
  mediaKind: 'image' | 'video',
  collection: StudioAssetV2['managedAsset']['collection'] = 'assets'
): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png',
  managedAsset: { collection, fileName: `${id}.${mediaKind === 'video' ? 'mp4' : 'png'}` },
  byteSize: 8,
  sha256: 'a'.repeat(64),
  ...(mediaKind === 'video' ? { durationSeconds: 10 } : {}),
  createdAt,
});

const projectFixture = (dependency: 'seed' | 'predecessor', siblingCount = 1): StudioProjectV2 => {
  const upstreamPurpose = dependency === 'seed' ? 'seed_still' : 'video_take';
  const upstreamPlan = resolvedPlan(upstreamPurpose);
  const dependentPlan = dependency === 'seed' ? deferredSeedPlan() : deferredPredecessorPlan();
  const upstream = item('item_upstream', 'shot_1', upstreamPurpose, upstreamPlan);
  const dependent = item(
    'item_dependent',
    dependency === 'seed' ? 'shot_1' : 'shot_2',
    'video_take',
    dependentPlan,
    siblingCount
  );
  const authorization: StudioSpendAuthorization = {
    id: 'auth_1',
    projectId: 'project_1',
    projectRevision: 6,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [upstream],
    cascadeItems: [dependent],
    lowerMinorUnits: 1,
    upperMinorUnits: 1,
    expiresAt: '2026-08-17T00:05:00.000Z',
    confirmedAt: createdAt,
    providerBindings: [upstream, dependent].map((quoted) => ({
      itemId: quoted.id,
      provider: { providerId: 'provider_1', adapterId: 'openrouter-video-v1', model: 'model_1' },
    })),
    idempotencyKeys: [
      { itemId: upstream.id, generationIndex: 0, key: 'key_upstream' },
      ...Array.from({ length: siblingCount }, (_, generationIndex) => ({
        itemId: dependent.id,
        generationIndex,
        key: `key_dependent_${generationIndex}`,
      })),
    ],
  };
  const upstreamJob = job('job_upstream', 'shot_1', upstream.id, upstreamPlan, {
    status: 'succeeded',
    purpose: upstreamPurpose,
    providerJobId: 'remote_upstream',
  });
  const dependentJobs = Array.from({ length: siblingCount }, (_, generationIndex) =>
    job(`job_dependent_${generationIndex}`, dependent.shotId, dependent.id, dependentPlan, { generationIndex })
  );
  return {
    schemaVersion: 2,
    revision: 7,
    id: 'project_1',
    name: 'Project',
    brief: '',
    rules: [],
    briefConversationId: null,
    aspectRatio: '16:9',
    targetDurationSeconds: 10,
    resolution: '1080p',
    beatOrder: ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: '',
        action: '',
        look: '',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_1', 'shot_2'],
        lineHistory: [],
      },
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        line: '',
        derivation: 'derived',
        derivedFromActionRevision: 1,
        narration: '',
        onScreenText: '',
        durationSeconds: 5,
        trimInSeconds: null,
        trimOutSeconds: dependency === 'predecessor' ? 2 : null,
        chainBreak: 'none',
        seedStillId: null,
        selectedTakeId: null,
        assetIds: [],
        jobIds: [upstreamJob.id, ...(dependency === 'seed' ? dependentJobs.map(({ id }) => id) : [])],
      },
      shot_2: {
        id: 'shot_2',
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
        jobIds: dependency === 'predecessor' ? dependentJobs.map(({ id }) => id) : [],
      },
    },
    bin: [],
    bedAssetId: null,
    matchToShotId: null,
    spendPolicy: null,
    spendAuthorizations: [authorization],
    frameExtractions: {},
    undoHistory: [],
    imageRouteId: 'seed_still_route',
    videoRouteId: 'video_take_route',
    assets: {},
    jobs: Object.fromEntries([upstreamJob, ...dependentJobs].map((entry) => [entry.id, entry])),
    createdAt,
    updatedAt: createdAt,
  };
};

const installPrimary = (project: StudioProjectV2, mediaKind: 'image' | 'video'): StudioAssetV2 => {
  const primary = asset(`primary_${mediaKind}`, 'shot_1', mediaKind);
  project.assets[primary.id] = primary;
  project.shots.shot_1!.assetIds.push(primary.id);
  const producer = project.jobs.job_upstream!;
  producer.outputAssetIds = [primary.id];
  producer.outputAssetIdsByRole.primary = primary.id;
  if (mediaKind === 'image') project.shots.shot_1!.seedStillId = primary.id;
  else project.shots.shot_1!.selectedTakeId = primary.id;
  return primary;
};

describe('advanceStudioWaitingBindingsV2', () => {
  it('binds every non-cancelled sibling to an explicitly selected seed from the exact upstream item', () => {
    const project = projectFixture('seed', 3);
    const primary = installPrimary(project, 'image');
    project.jobs.job_dependent_1!.status = 'cancelled';

    const result = advanceStudioWaitingBindingsV2(project, capturedAt);

    expect(result).toEqual({
      dispatchJobIds: ['job_dependent_0', 'job_dependent_2'],
      extractionIds: [],
      projectChanged: true,
    });
    expect(project.jobs.job_dependent_0).toMatchObject({
      status: 'queued_local',
      updatedAt: capturedAt,
      requestSnapshot: { conditioningInput: { kind: 'seed_still', assetId: primary.id } },
    });
    expect(project.jobs.job_dependent_2!.requestSnapshot).toEqual(project.jobs.job_dependent_0!.requestSnapshot);
    expect(project.jobs.job_dependent_1).toMatchObject({ status: 'cancelled', requestSnapshot: null });

    const replay = advanceStudioWaitingBindingsV2(project, capturedAt);
    expect(replay).toEqual({ dispatchJobIds: [], extractionIds: [], projectChanged: false });
  });

  it('derives the selected Take endpoint, persists one frame request, then binds to the ready frame', () => {
    const project = projectFixture('predecessor', 2);
    const primary = installPrimary(project, 'video');
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: primary.id,
      endpointSeconds: 8,
    });

    expect(advanceStudioWaitingBindingsV2(project, capturedAt)).toEqual({
      dispatchJobIds: [],
      extractionIds: [extractionId],
      projectChanged: true,
    });
    expect(project.frameExtractions[extractionId]).toEqual({
      id: extractionId,
      shotId: 'shot_1',
      takeAssetId: primary.id,
      endpointSeconds: 8,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
    });
    expect(advanceStudioWaitingBindingsV2(project, capturedAt)).toEqual({
      dispatchJobIds: [],
      extractionIds: [extractionId],
      projectChanged: false,
    });

    const frame = asset('frame_1', 'shot_1', 'image', 'conditioningFrames');
    project.assets[frame.id] = frame;
    project.shots.shot_1!.assetIds.push(frame.id);
    project.frameExtractions[extractionId] = {
      ...project.frameExtractions[extractionId]!,
      status: 'ready',
      frameAssetId: frame.id,
    };
    expect(advanceStudioWaitingBindingsV2(project, capturedAt)).toEqual({
      dispatchJobIds: [],
      extractionIds: [extractionId],
      projectChanged: false,
    });
    const bound = advanceStudioWaitingBindingsV2(
      project,
      capturedAt,
      new Map([
        [
          extractionId,
          {
            extractionId,
            shotId: 'shot_1',
            takeAssetId: primary.id,
            endpointSeconds: 8,
            frameAssetId: frame.id,
            byteSize: frame.byteSize,
            sha256: frame.sha256,
          },
        ],
      ])
    );
    expect(bound).toEqual({
      dispatchJobIds: ['job_dependent_0', 'job_dependent_1'],
      extractionIds: [],
      projectChanged: true,
    });
    expect(project.jobs.job_dependent_0!.requestSnapshot?.conditioningInput).toEqual({
      kind: 'predecessor_frame',
      predecessorShotId: 'shot_1',
      takeAssetId: primary.id,
      frameAssetId: frame.id,
      endpointSeconds: 8,
    });
  });

  it('distinguishes exhausted primaries from malformed or incomplete authority', () => {
    const cases: Array<{ mutate: (project: StudioProjectV2) => void; terminalizes: boolean }> = [
      { mutate: () => {}, terminalizes: true },
      {
        mutate: (project) => {
          installPrimary(project, 'image');
          project.jobs.job_upstream!.authorizationId = 'another_authorization';
        },
        terminalizes: false,
      },
      {
        mutate: (project) => {
          const primary = installPrimary(project, 'image');
          const duplicate = structuredClone(project.jobs.job_upstream!);
          duplicate.id = 'job_duplicate';
          duplicate.idempotencyKey = 'key_duplicate';
          project.jobs[duplicate.id] = duplicate;
          project.shots.shot_1!.jobIds.push(duplicate.id);
          expect(primary.id).toBe('primary_image');
        },
        terminalizes: false,
      },
      {
        mutate: (project) => {
          const primary = installPrimary(project, 'image');
          project.bin.push({ kind: 'take', assetId: primary.id, reason: 'lifted' });
        },
        terminalizes: true,
      },
      {
        mutate: (project) => {
          const primary = installPrimary(project, 'image');
          project.jobs.job_upstream!.outputAssetIdsByRole = { primary: null, poster: primary.id };
        },
        terminalizes: true,
      },
    ];

    for (const { mutate, terminalizes } of cases) {
      const project = projectFixture('seed');
      mutate(project);
      const before = structuredClone(project);
      expect(advanceStudioWaitingBindingsV2(project, capturedAt)).toEqual({
        dispatchJobIds: [],
        extractionIds: [],
        projectChanged: terminalizes,
      });
      if (terminalizes) {
        expect(project.jobs.job_dependent_0).toMatchObject({
          status: 'failed',
          error: { code: 'dependency_failed', messageKey: 'dependency_failed' },
          updatedAt: capturedAt,
        });
      } else {
        expect(project).toEqual(before);
      }
    }
  });

  it('does not bind failed frames, all-cancelled items, attempted siblings, or a non-asset video primary', () => {
    const failedFrame = projectFixture('predecessor');
    const primary = installPrimary(failedFrame, 'video');
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: primary.id,
      endpointSeconds: 8,
    });
    failedFrame.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      takeAssetId: primary.id,
      endpointSeconds: 8,
      frameAssetId: null,
      status: 'failed',
      errorCode: 'decode_failed',
    };
    expect(advanceStudioWaitingBindingsV2(failedFrame, capturedAt).projectChanged).toBe(false);

    const cancelled = projectFixture('seed');
    installPrimary(cancelled, 'image');
    cancelled.jobs.job_dependent_0!.status = 'cancelled';
    expect(advanceStudioWaitingBindingsV2(cancelled, capturedAt).projectChanged).toBe(false);

    const attempted = projectFixture('seed');
    installPrimary(attempted, 'image');
    attempted.jobs.job_dependent_0!.providerJobId = 'already_attempted';
    expect(advanceStudioWaitingBindingsV2(attempted, capturedAt).projectChanged).toBe(false);

    const importedVideo = projectFixture('predecessor');
    const imported = installPrimary(importedVideo, 'video');
    imported.managedAsset.collection = 'imports';
    expect(advanceStudioWaitingBindingsV2(importedVideo, capturedAt).projectChanged).toBe(true);
    expect(importedVideo.jobs.job_dependent_0).toMatchObject({
      status: 'failed',
      error: { code: 'dependency_failed', messageKey: 'dependency_failed' },
    });
  });

  it('atomically dependency-fails the transitive unbound frontier only after the upstream item is exhausted', () => {
    const project = projectFixture('seed', 2);
    const authorization = project.spendAuthorizations[0]!;
    const upstream = authorization.baseItems[0]!;
    upstream.generationCount = 2;
    authorization.idempotencyKeys.splice(1, 0, {
      itemId: upstream.id,
      generationIndex: 1,
      key: 'key_upstream_1',
    });
    const secondUpstream = structuredClone(project.jobs.job_upstream!);
    secondUpstream.id = 'job_upstream_1';
    secondUpstream.idempotencyKey = 'key_upstream_1';
    secondUpstream.generationIndex = 1;
    secondUpstream.status = 'running';
    secondUpstream.providerJobId = 'remote_upstream_1';
    project.jobs[secondUpstream.id] = secondUpstream;
    project.shots.shot_1!.jobIds.splice(1, 0, secondUpstream.id);
    project.jobs.job_upstream!.status = 'failed';
    project.jobs.job_upstream!.error = { code: 'no_output', messageKey: 'no_output' };

    expect(advanceStudioWaitingBindingsV2(project, capturedAt)).toEqual({
      dispatchJobIds: [],
      extractionIds: [],
      projectChanged: false,
    });
    expect(project.jobs.job_dependent_0!.status).toBe('waiting_for_conditioning');

    const transitivePlan: StudioGenerationRequestPlan = {
      kind: 'after_take_selection',
      template: {
        prompt: 'transitive prompt',
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 5,
        referenceInput: null,
      },
      dependency: { kind: 'authorized_predecessor', upstreamItemId: 'item_dependent', predecessorShotId: 'shot_1' },
    };
    const transitiveItem = item('item_transitive', 'shot_2', 'video_take', transitivePlan);
    authorization.cascadeItems.push(transitiveItem);
    authorization.providerBindings.push({
      itemId: transitiveItem.id,
      provider: { providerId: 'provider_1', adapterId: 'openrouter-video-v1', model: 'model_1' },
    });
    authorization.idempotencyKeys.push({ itemId: transitiveItem.id, generationIndex: 0, key: 'key_transitive' });
    const transitiveJob = job('job_transitive', 'shot_2', transitiveItem.id, transitivePlan);
    project.jobs[transitiveJob.id] = transitiveJob;
    project.shots.shot_2!.jobIds.push(transitiveJob.id);
    project.jobs.job_dependent_1!.status = 'cancelled';
    secondUpstream.status = 'failed';
    secondUpstream.error = { code: 'no_output', messageKey: 'no_output' };

    const terminalized = advanceStudioWaitingBindingsV2(project, capturedAt);
    expect(terminalized).toEqual({ dispatchJobIds: [], extractionIds: [], projectChanged: true });
    expect(project.jobs.job_dependent_0).toMatchObject({
      status: 'failed',
      error: { code: 'dependency_failed' },
      updatedAt: capturedAt,
    });
    expect(project.jobs.job_dependent_1).toMatchObject({ status: 'cancelled', error: null });
    expect(project.jobs.job_transitive).toMatchObject({ status: 'failed', error: { code: 'dependency_failed' } });
  });
});
