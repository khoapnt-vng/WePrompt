/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  studioPlanningShotBoundariesV2,
  studioProjectSummaryV2Schema,
  studioShotPlayedDurationV2,
  toStudioFilmDurationV2,
  toStudioProjectSummaryV2,
} from '@/common/types/project/creativeStudioProjectSummary';
import type {
  StudioAssetV2,
  StudioShot,
  StudioJobV2,
  StudioProjectV2,
  StudioBeat,
} from '@/common/types/project/creativeStudioTypes';

const timestamp = '2026-08-17T00:00:00.000Z';

const makeShot = (id: string, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  line: '',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 4,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  seedStillId: null,
  selectedTakeId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[], overrides: Partial<StudioBeat> = {}): StudioBeat => ({
  id,
  title: id,
  action: '',
  look: '',
  actionRevision: 1,
  targetSeconds: null,
  shotOrder,
  lineHistory: [],
  ...overrides,
});

const makeAsset = (id: string, shotId: string, overrides: Partial<StudioAssetV2> = {}): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  createdAt: timestamp,
  ...overrides,
});

const makeJob = (
  id: string,
  shotId: string,
  outputAssetIds: string[],
  overrides: Partial<StudioJobV2> = {}
): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  status: 'succeeded',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
  idempotencyKey: `idem_${id}`,
  providerJobId: 'remote_1',
  remoteStartedAt: timestamp,
  cancellationPolicy: 'none',
  purpose: 'video_take',
  authorizationId: 'authorization_1',
  authorizationItemId: 'item_1',
  generationIndex: 0,
  requestPlan: {
    kind: 'resolved',
    snapshot: {
      prompt: 'A cinematic shot',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 4,
      referenceInput: null,
      conditioningInput: { kind: 'seed_still', assetId: 'seed_1' },
    },
  },
  requestSnapshot: {
    prompt: 'A cinematic shot',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 4,
    referenceInput: null,
    conditioningInput: { kind: 'seed_still', assetId: 'seed_1' },
  },
  spendReceipt: null,
  outputAssetIds,
  outputAssetIdsByRole: {
    primary: outputAssetIds[0] ?? null,
    poster: outputAssetIds[1] ?? null,
  },
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const makeProject = (): StudioProjectV2 => ({
  schemaVersion: 2,
  revision: 1,
  id: 'project_1',
  name: 'Project One',
  brief: '',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  beatOrder: [],
  beats: {},
  shots: {},
  bin: [],
  bedAssetId: null,
  matchToShotId: null,
  spendPolicy: null,
  spendAuthorizations: [],
  frameExtractions: {},
  undoHistory: [],
  assets: {},
  jobs: {},
  imageRouteId: null,
  videoRouteId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe('toStudioProjectSummaryV2', () => {
  it('uses active Beat-to-Shot order and excludes binned Beats and Shots', () => {
    const project = makeProject();
    project.beatOrder = ['beat_2', 'beat_1'];
    project.beats = {
      beat_parked: makeBeat('beat_parked', ['shot_parked']),
      beat_1: makeBeat('beat_1', ['shot_later']),
      beat_2: makeBeat('beat_2', ['shot_without_cover', 'shot_cover']),
    };
    project.bin = [
      { kind: 'beat', beatId: 'beat_parked', reason: 'lifted' },
      { kind: 'shot', beatId: 'beat_2', shotId: 'shot_binned', reason: 'lifted' },
    ];
    project.shots = {
      shot_parked: makeShot('shot_parked', { selectedTakeId: 'take_parked', assetIds: ['take_parked'] }),
      shot_binned: makeShot('shot_binned', { selectedTakeId: 'take_binned', assetIds: ['take_binned'] }),
      shot_later: makeShot('shot_later', { selectedTakeId: 'take_later', assetIds: ['take_later'] }),
      shot_without_cover: makeShot('shot_without_cover', {
        selectedTakeId: 'take_without_cover',
        assetIds: ['take_without_cover'],
      }),
      shot_cover: makeShot('shot_cover', {
        selectedTakeId: 'take_cover',
        assetIds: ['take_cover', 'poster_cover'],
        jobIds: ['job_cover'],
      }),
    };
    project.assets = {
      take_parked: makeAsset('take_parked', 'shot_parked', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: 10,
      }),
      take_binned: makeAsset('take_binned', 'shot_binned', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: 10,
      }),
      take_later: makeAsset('take_later', 'shot_later', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: 10,
      }),
      take_without_cover: makeAsset('take_without_cover', 'shot_without_cover', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: 10,
      }),
      take_cover: makeAsset('take_cover', 'shot_cover', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: 10,
      }),
      poster_cover: makeAsset('poster_cover', 'shot_cover', {
        managedAsset: { collection: 'thumbnails', fileName: 'poster_cover.png' },
      }),
    };
    project.jobs.job_cover = makeJob('job_cover', 'shot_cover', ['take_cover', 'poster_cover']);

    expect(toStudioProjectSummaryV2(project)).toEqual({
      id: 'project_1',
      name: 'Project One',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
      beatCount: 2,
      shotCount: 3,
      selectedTakeCount: 3,
      poster: {
        beatId: 'beat_2',
        shotId: 'shot_cover',
        assetId: 'poster_cover',
        beatPosition: 1,
        shotPosition: 2,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  it('uses the role-addressed poster even when the producer has a third unroled output', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.beats.beat_1 = makeBeat('beat_1', ['shot_1']);
    project.shots.shot_1 = makeShot('shot_1', {
      selectedTakeId: 'take_1',
      assetIds: ['take_1', 'unroled_output', 'poster_1'],
      jobIds: ['job_1'],
    });
    project.assets.take_1 = makeAsset('take_1', 'shot_1', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 10,
    });
    project.assets.unroled_output = makeAsset('unroled_output', 'shot_1');
    project.assets.poster_1 = makeAsset('poster_1', 'shot_1', {
      managedAsset: { collection: 'thumbnails', fileName: 'poster_1.png' },
    });
    project.jobs.job_1 = makeJob('job_1', 'shot_1', ['take_1', 'unroled_output', 'poster_1'], {
      outputAssetIdsByRole: { primary: 'take_1', poster: 'poster_1' },
    });

    expect(toStudioProjectSummaryV2(project).poster).toEqual({
      beatId: 'beat_1',
      shotId: 'shot_1',
      assetId: 'poster_1',
      beatPosition: 1,
      shotPosition: 1,
    });
  });

  it.each([
    { label: 'a missing role', outputAssetIds: ['take_1'], posterId: null, posterOwner: null },
    {
      label: 'duplicate output membership',
      outputAssetIds: ['take_1', 'poster_1', 'poster_1'],
      posterId: 'poster_1',
      posterOwner: 'shot_1',
    },
    {
      label: 'a cross-owned role asset',
      outputAssetIds: ['take_1', 'poster_1'],
      posterId: 'poster_1',
      posterOwner: 'shot_other',
    },
  ])('omits a poster for $label', ({ outputAssetIds, posterId, posterOwner }) => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.beats.beat_1 = makeBeat('beat_1', ['shot_1']);
    project.shots.shot_1 = makeShot('shot_1', {
      selectedTakeId: 'take_1',
      assetIds: ['take_1', ...(posterId === null ? [] : [posterId])],
      jobIds: ['job_1'],
    });
    project.assets.take_1 = makeAsset('take_1', 'shot_1', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 10,
    });
    if (posterId !== null && posterOwner !== null) {
      project.assets[posterId] = makeAsset(posterId, posterOwner, {
        managedAsset: { collection: 'thumbnails', fileName: `${posterId}.png` },
      });
    }
    project.jobs.job_1 = makeJob('job_1', 'shot_1', outputAssetIds, {
      outputAssetIdsByRole: { primary: 'take_1', poster: posterId },
    });

    const summary = toStudioProjectSummaryV2(project);
    expect(summary.selectedTakeCount).toBe(1);
    expect(Object.hasOwn(summary, 'poster')).toBe(false);
  });

  it('accepts the 24-minute target boundary and rejects values or keys outside the summary contract', () => {
    const project = makeProject();
    project.targetDurationSeconds = 1440;
    const summary = toStudioProjectSummaryV2(project);

    expect(studioProjectSummaryV2Schema.safeParse(summary).success).toBe(true);
    expect(studioProjectSummaryV2Schema.safeParse({ ...summary, targetDurationSeconds: 1441 }).success).toBe(false);
    expect(studioProjectSummaryV2Schema.safeParse({ ...summary, unexpected: true }).success).toBe(false);
  });

  it('omits a poster from an empty project', () => {
    const summary = toStudioProjectSummaryV2(makeProject());

    expect(Object.hasOwn(summary, 'poster')).toBe(false);
  });
});

describe('studioPlanningShotBoundariesV2', () => {
  it('returns dense cumulative integer boundaries in active Shot order and supports empty coverage', () => {
    const beat = makeBeat('beat_1', ['shot_2', 'shot_1']);
    const shots = {
      shot_1: makeShot('shot_1', { durationSeconds: 6 }),
      shot_2: makeShot('shot_2', { durationSeconds: 4 }),
    };

    expect(studioPlanningShotBoundariesV2(beat, shots)).toEqual([
      { shotId: 'shot_2', startSeconds: 0, endSeconds: 4 },
      { shotId: 'shot_1', startSeconds: 4, endSeconds: 10 },
    ]);
    expect(studioPlanningShotBoundariesV2(makeBeat('beat_empty', []), shots)).toEqual([]);
  });

  it('keeps planning geometry at 0–8 when selected media and trims play for 9 seconds', () => {
    const project = makeProject();
    const shot = makeShot('shot_1', {
      durationSeconds: 8,
      trimOutSeconds: 1,
      selectedTakeId: 'take_1',
      assetIds: ['take_1'],
    });
    project.shots.shot_1 = shot;
    project.assets.take_1 = makeAsset('take_1', 'shot_1', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 10,
    });

    expect(studioPlanningShotBoundariesV2(makeBeat('beat_1', ['shot_1']), project.shots)).toEqual([
      { shotId: 'shot_1', startSeconds: 0, endSeconds: 8 },
    ]);
    expect(studioShotPlayedDurationV2(project, shot)).toBe(9);
    expect(studioShotPlayedDurationV2(project, makeShot('shot_2', { durationSeconds: 8 }))).toBe(8);
  });

  it('fails closed for duplicate, missing, mismatched, or hostile Shot ownership', () => {
    const shot = makeShot('shot_1');
    const hostileShots = Object.create(null) as Record<string, StudioShot>;
    hostileShots.__proto__ = makeShot('__proto__');

    expect(studioPlanningShotBoundariesV2(makeBeat('beat_1', ['shot_1', 'shot_1']), { shot_1: shot })).toBeNull();
    expect(studioPlanningShotBoundariesV2(makeBeat('beat_1', ['shot_missing']), { shot_1: shot })).toBeNull();
    expect(
      studioPlanningShotBoundariesV2(makeBeat('beat_1', ['shot_1']), { shot_1: makeShot('shot_other') })
    ).toBeNull();
    expect(studioPlanningShotBoundariesV2(makeBeat('beat_1', ['__proto__']), hostileShots)).toBeNull();
  });
});

describe('active film duration projections', () => {
  it('sums covered playback and non-null slate targets without counting binned content', () => {
    const project = makeProject();
    project.beatOrder = ['beat_covered', 'beat_slate', 'beat_unknown'];
    project.beats = {
      beat_covered: makeBeat('beat_covered', ['shot_selected', 'shot_planned']),
      beat_slate: makeBeat('beat_slate', [], { targetSeconds: 5 }),
      beat_unknown: makeBeat('beat_unknown', [], { targetSeconds: null }),
      beat_parked: makeBeat('beat_parked', ['shot_parked'], { targetSeconds: 30 }),
    };
    project.shots = {
      shot_selected: makeShot('shot_selected', {
        durationSeconds: 8,
        trimOutSeconds: 1,
        selectedTakeId: 'take_selected',
        assetIds: ['take_selected'],
      }),
      shot_planned: makeShot('shot_planned', { durationSeconds: 8 }),
      shot_binned: makeShot('shot_binned', { durationSeconds: 15 }),
      shot_parked: makeShot('shot_parked', { durationSeconds: 15 }),
    };
    project.assets.take_selected = makeAsset('take_selected', 'shot_selected', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 10,
    });
    project.bin = [
      { kind: 'beat', beatId: 'beat_parked', reason: 'lifted' },
      { kind: 'shot', beatId: 'beat_covered', shotId: 'shot_binned', reason: 'lifted' },
    ];

    expect(toStudioFilmDurationV2(project)).toEqual({ knownSeconds: 22, unresolvedBeatIds: ['beat_unknown'] });
  });

  it('marks missing coverage and unsafe aggregate arithmetic unresolved instead of coercing it to zero', () => {
    const missingProject = makeProject();
    missingProject.beatOrder = ['beat_missing'];
    missingProject.beats.beat_missing = makeBeat('beat_missing', ['shot_missing']);

    expect(toStudioFilmDurationV2(missingProject)).toEqual({
      knownSeconds: 0,
      unresolvedBeatIds: ['beat_missing'],
    });

    const unsafeProject = makeProject();
    unsafeProject.beatOrder = ['beat_unsafe'];
    unsafeProject.beats.beat_unsafe = makeBeat('beat_unsafe', ['shot_1', 'shot_2']);
    unsafeProject.shots = {
      shot_1: makeShot('shot_1', { selectedTakeId: 'take_1', assetIds: ['take_1'] }),
      shot_2: makeShot('shot_2', { selectedTakeId: 'take_2', assetIds: ['take_2'] }),
    };
    unsafeProject.assets = {
      take_1: makeAsset('take_1', 'shot_1', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: Number.MAX_SAFE_INTEGER,
      }),
      take_2: makeAsset('take_2', 'shot_2', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: Number.MAX_SAFE_INTEGER,
      }),
    };

    expect(toStudioFilmDurationV2(unsafeProject)).toEqual({
      knownSeconds: 0,
      unresolvedBeatIds: ['beat_unsafe'],
    });
  });

  it('rejects invalid trims and invalid unselected planning duration', () => {
    const project = makeProject();
    const selected = makeShot('shot_1', {
      trimInSeconds: 5,
      trimOutSeconds: 5,
      selectedTakeId: 'take_1',
      assetIds: ['take_1'],
    });
    project.assets.take_1 = makeAsset('take_1', 'shot_1', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 10,
    });

    expect(studioShotPlayedDurationV2(project, selected)).toBeNull();
    expect(studioShotPlayedDurationV2(project, makeShot('shot_2', { durationSeconds: 3 }))).toBeNull();
  });
});
