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

const existingPredecessorPlan = (): StudioGenerationRequestPlan =>
  ({
    kind: 'after_take_selection',
    template: {
      prompt: 'existing predecessor prompt',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 5,
      referenceInput: null,
    },
    dependency: {
      kind: 'existing_predecessor',
      predecessorShotId: 'shot_1',
      takeAssetId: 'primary_video',
      endpointSeconds: 8,
    },
  }) as StudioGenerationRequestPlan;

const item = (
  id: string,
  shotId: string,
  purpose: 'seed_still' | 'video_take',
  requestPlan: StudioGenerationRequestPlan
): StudioQuotedGeneration => ({
  id,
  shotId,
  purpose,
  routeId: `${purpose}_route`,
  generationCount: 1,
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

const projectFixture = (dependency: 'seed' | 'predecessor'): StudioProjectV2 => {
  const upstreamPurpose = dependency === 'seed' ? 'seed_still' : 'video_take';
  const upstreamPlan = resolvedPlan(upstreamPurpose);
  const dependentPlan = dependency === 'seed' ? deferredSeedPlan() : deferredPredecessorPlan();
  const upstream = item('item_upstream', 'shot_1', upstreamPurpose, upstreamPlan);
  const dependent = item('item_dependent', dependency === 'seed' ? 'shot_1' : 'shot_2', 'video_take', dependentPlan);
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
      { itemId: upstream.id, key: 'key_upstream' },
      { itemId: dependent.id, key: 'key_dependent' },
    ],
  };
  const upstreamJob = job('job_upstream', 'shot_1', upstream.id, upstreamPlan, {
    status: 'succeeded',
    purpose: upstreamPurpose,
    providerJobId: 'remote_upstream',
  });
  const dependentJob = job('job_dependent', dependent.shotId, dependent.id, dependentPlan);
  return {
    schemaVersion: 3,
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
        videoAssetId: null,
        supersededVideoAssetIds: [],
        assetIds: [],
        jobIds: [upstreamJob.id, ...(dependency === 'seed' ? [dependentJob.id] : [])],
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
        videoAssetId: null,
        supersededVideoAssetIds: [],
        assetIds: [],
        jobIds: dependency === 'predecessor' ? [dependentJob.id] : [],
      },
    },
    bin: [],
    bedAssetId: null,
    spendPolicy: null,
    spendAuthorizations: [authorization],
    frameExtractions: {},
    undoHistory: [],
    imageRouteId: 'seed_still_route',
    videoRouteId: 'video_take_route',
    assets: {},
    jobs: Object.fromEntries([upstreamJob, dependentJob].map((entry) => [entry.id, entry])),
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
  else project.shots.shot_1!.videoAssetId = primary.id;
  return primary;
};

const existingPredecessorProject = (): StudioProjectV2 => {
  const project = projectFixture('predecessor');
  const primary = installPrimary(project, 'video');
  const authorization = project.spendAuthorizations[0]!;
  const dependent = authorization.cascadeItems[0]!;
  const dependentJob = project.jobs.job_dependent!;
  const plan = existingPredecessorPlan();
  dependent.requestPlan = structuredClone(plan);
  dependentJob.requestPlan = structuredClone(plan);
  authorization.baseItems = [dependent];
  authorization.cascadeItems = [];
  authorization.providerBindings = authorization.providerBindings.filter(({ itemId }) => itemId === dependent.id);
  authorization.idempotencyKeys = authorization.idempotencyKeys.filter(({ itemId }) => itemId === dependent.id);
  delete project.jobs.job_upstream;
  project.shots.shot_1!.jobIds = [];
  expect(primary.id).toBe('primary_video');
  return project;
};

describe('advanceStudioWaitingBindingsV2', () => {
  it('holds an existing predecessor authorization to the exact current picture, endpoint, and live boundary', () => {
    const project = existingPredecessorProject();
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: 'primary_video',
      endpointSeconds: 8,
    });

    expect(advanceStudioWaitingBindingsV2(project, capturedAt)).toEqual({
      dispatchJobIds: [],
      extractionIds: [extractionId],
      projectChanged: true,
    });
    expect(project.jobs.job_dependent!.status).toBe('waiting_for_conditioning');

    project.shots.shot_1!.trimOutSeconds = 1;
    expect(advanceStudioWaitingBindingsV2(project, capturedAt)).toEqual({
      dispatchJobIds: [],
      extractionIds: [],
      projectChanged: false,
    });
    expect(project.jobs.job_dependent!.status).toBe('waiting_for_conditioning');
    project.shots.shot_1!.trimOutSeconds = 2;

    const frame = asset('frame_existing', 'shot_1', 'image', 'conditioningFrames');
    project.assets[frame.id] = frame;
    project.shots.shot_1!.assetIds.push(frame.id);
    project.frameExtractions[extractionId] = {
      ...project.frameExtractions[extractionId]!,
      status: 'ready',
      frameAssetId: frame.id,
    };
    expect(
      advanceStudioWaitingBindingsV2(
        project,
        capturedAt,
        new Map([
          [
            extractionId,
            {
              extractionId,
              shotId: 'shot_1',
              videoAssetId: 'primary_video',
              endpointSeconds: 8,
              frameAssetId: frame.id,
              byteSize: frame.byteSize,
              sha256: frame.sha256,
            },
          ],
        ])
      )
    ).toEqual({ dispatchJobIds: ['job_dependent'], extractionIds: [], projectChanged: true });
    expect(project.jobs.job_dependent).toMatchObject({
      status: 'queued_local',
      requestSnapshot: {
        conditioningInput: {
          kind: 'predecessor_frame',
          predecessorShotId: 'shot_1',
          takeAssetId: 'primary_video',
          endpointSeconds: 8,
          frameAssetId: frame.id,
        },
      },
    });
  });

  it('binds the exact dependent job to the canonical seed from its authorized upstream item', () => {
    const project = projectFixture('seed');
    const primary = installPrimary(project, 'image');

    const result = advanceStudioWaitingBindingsV2(project, capturedAt);

    expect(result).toEqual({
      dispatchJobIds: ['job_dependent'],
      extractionIds: [],
      projectChanged: true,
    });
    expect(project.jobs.job_dependent).toMatchObject({
      status: 'queued_local',
      updatedAt: capturedAt,
      requestSnapshot: { conditioningInput: { kind: 'seed_still', assetId: primary.id } },
    });

    const replay = advanceStudioWaitingBindingsV2(project, capturedAt);
    expect(replay).toEqual({ dispatchJobIds: [], extractionIds: [], projectChanged: false });
  });

  it('derives the current-picture endpoint, persists one frame request, then binds to the ready frame', () => {
    const project = projectFixture('predecessor');
    const primary = installPrimary(project, 'video');
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: primary.id,
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
      videoAssetId: primary.id,
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
            videoAssetId: primary.id,
            endpointSeconds: 8,
            frameAssetId: frame.id,
            byteSize: frame.byteSize,
            sha256: frame.sha256,
          },
        ],
      ])
    );
    expect(bound).toEqual({
      dispatchJobIds: ['job_dependent'],
      extractionIds: [],
      projectChanged: true,
    });
    expect(project.jobs.job_dependent!.requestSnapshot?.conditioningInput).toEqual({
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
        expect(project.jobs.job_dependent).toMatchObject({
          status: 'failed',
          error: { code: 'dependency_failed', messageKey: 'dependency_failed' },
          updatedAt: capturedAt,
        });
      } else {
        expect(project).toEqual(before);
      }
    }
  });

  it('does not bind failed frames, a cancelled or attempted job, or a non-asset video primary', () => {
    const failedFrame = projectFixture('predecessor');
    const primary = installPrimary(failedFrame, 'video');
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: primary.id,
      endpointSeconds: 8,
    });
    failedFrame.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      videoAssetId: primary.id,
      endpointSeconds: 8,
      frameAssetId: null,
      status: 'failed',
      errorCode: 'decode_failed',
    };
    expect(advanceStudioWaitingBindingsV2(failedFrame, capturedAt).projectChanged).toBe(false);

    const cancelled = projectFixture('seed');
    installPrimary(cancelled, 'image');
    cancelled.jobs.job_dependent!.status = 'cancelled';
    expect(advanceStudioWaitingBindingsV2(cancelled, capturedAt).projectChanged).toBe(false);

    const attempted = projectFixture('seed');
    installPrimary(attempted, 'image');
    attempted.jobs.job_dependent!.providerJobId = 'already_attempted';
    expect(advanceStudioWaitingBindingsV2(attempted, capturedAt).projectChanged).toBe(false);

    const importedVideo = projectFixture('predecessor');
    const imported = installPrimary(importedVideo, 'video');
    imported.managedAsset.collection = 'imports';
    expect(advanceStudioWaitingBindingsV2(importedVideo, capturedAt).projectChanged).toBe(true);
    expect(importedVideo.jobs.job_dependent).toMatchObject({
      status: 'failed',
      error: { code: 'dependency_failed', messageKey: 'dependency_failed' },
    });
  });

  it('atomically dependency-fails the unbound video frontier when the one seed job is rejected as a grid', () => {
    const project = projectFixture('seed');
    const authorization = project.spendAuthorizations[0]!;
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
    authorization.idempotencyKeys.push({ itemId: transitiveItem.id, key: 'key_transitive' });
    const transitiveJob = job('job_transitive', 'shot_2', transitiveItem.id, transitivePlan);
    project.jobs[transitiveJob.id] = transitiveJob;
    project.shots.shot_2!.jobIds.push(transitiveJob.id);
    project.jobs.job_upstream!.status = 'failed';
    project.jobs.job_upstream!.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
    };

    const terminalized = advanceStudioWaitingBindingsV2(project, capturedAt);
    expect(terminalized).toEqual({ dispatchJobIds: [], extractionIds: [], projectChanged: true });
    expect(project.jobs.job_dependent).toMatchObject({
      status: 'failed',
      error: { code: 'dependency_failed' },
      updatedAt: capturedAt,
    });
    expect(project.jobs.job_transitive).toMatchObject({ status: 'failed', error: { code: 'dependency_failed' } });
  });
});
