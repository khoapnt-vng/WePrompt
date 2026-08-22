// @vitest-environment jsdom

import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAssetV2,
  StudioCascadeProgressV2,
  StudioRendererJobV2,
  StudioRendererProjectV2,
  StudioRendererChainStatusV2,
  StudioRendererWorkspaceStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  hasGenerationAffectingWorkspaceDrafts,
  buildStudioBarStats,
  countStoredWorkspaceDrafts,
  projectWorkspace,
  useWorkspaceDrafts,
} from '@/renderer/pages/studio/components/Workspace';

const makeAsset = (
  id: string,
  shotId: string | null,
  mediaKind: StudioAssetV2['mediaKind'] = 'image',
  collection: StudioAssetV2['managedAsset']['collection'] = 'assets',
  createdAt = '2026-08-19T00:00:00.000Z',
  durationSeconds = 4
): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : mediaKind === 'audio' ? 'audio/wav' : 'image/png',
  managedAsset: { collection, fileName: `${id}.bin` },
  byteSize: 10,
  sha256: 'a'.repeat(64),
  ...(mediaKind === 'video' || mediaKind === 'audio' ? { durationSeconds } : {}),
  createdAt,
});

const makeJob = (id: string, shotId: string, overrides: Partial<StudioRendererJobV2> = {}): StudioRendererJobV2 =>
  ({
    id,
    projectId: 'project_1',
    shotId,
    status: 'succeeded',
    provider: { choiceId: 'route_video', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [],
    outputAssetIdsByRole: { primary: null, poster: null },
    error: null,
    canCancel: false,
    canRetryDownload: false,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    purpose: 'video_take',
    generationIndex: 0,
    spendReceipt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }) as StudioRendererJobV2;

const makeShot = (id: string, line: string, chainBreak: 'none' | 'hard_cut' = 'hard_cut') => ({
  id,
  line,
  derivation: 'derived' as const,
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 4,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak,
  seedStillId: null,
  selectedTakeId: null,
  assetIds: [] as string[],
  jobIds: [] as string[],
});

const makeProject = (): StudioRendererProjectV2 =>
  ({
    schemaVersion: 2,
    revision: 3,
    id: 'project_1',
    name: 'Launch film',
    brief: 'A launch film.',
    rules: [],
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '720p',
    beatOrder: ['beat_1', 'beat_2'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: 'Open',
        look: 'Bright',
        actionRevision: 1,
        targetSeconds: 8,
        shotOrder: ['shot_1', 'shot_2'],
        lineHistory: [],
      },
      beat_2: {
        id: 'beat_2',
        title: 'Close',
        action: 'Close',
        look: 'Warm',
        actionRevision: 1,
        targetSeconds: 4,
        shotOrder: ['shot_3'],
        lineHistory: [],
      },
      beat_parked: {
        id: 'beat_parked',
        title: 'Parked beat',
        action: 'Parked',
        look: 'Muted',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_parked'],
        lineHistory: [],
      },
    },
    shots: {
      shot_1: makeShot('shot_1', 'First'),
      shot_2: makeShot('shot_2', 'Second', 'none'),
      shot_3: makeShot('shot_3', 'Third'),
      shot_parked: makeShot('shot_parked', 'Parked'),
    },
    bin: [],
    bedAssetId: null,
    matchToShotId: null,
    spendPolicy: null,
    imageRouteId: 'route_image',
    videoRouteId: 'route_video',
    assets: {},
    jobs: {},
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  }) as StudioRendererProjectV2;

const workspaceStatus = (revision = 3): StudioRendererWorkspaceStatusV2 => ({
  projectId: 'project_1',
  projectRevision: revision,
  undoTop: { entryId: 'undo_1', label: 'Edit shot', sourceRevision: 2 },
  dirtyShots: [{ shotId: 'shot_2', causes: ['continuity_stale'] }],
  cascadeProgress: [],
  parkEligibility: [],
});

const chainStatus = (revision = 3): StudioRendererChainStatusV2 => ({
  projectId: 'project_1',
  projectRevision: revision,
  conditioningFailures: [{ dependentShotId: 'shot_2', reason: 'conditioning_failed', canRetry: true }],
});

const cleanWorkspaceStatus = (revision = 3): StudioRendererWorkspaceStatusV2 => ({
  ...workspaceStatus(revision),
  dirtyShots: [],
  cascadeProgress: [],
});

const cleanChainStatus = (revision = 3): StudioRendererChainStatusV2 => ({
  ...chainStatus(revision),
  conditioningFailures: [],
});

const addSeed = (project: StudioRendererProjectV2, shotId: string, assetId = `seed_${shotId}`): void => {
  const seed = makeAsset(assetId, shotId, 'image', 'imports');
  project.assets[assetId] = seed;
  project.shots[shotId]!.assetIds.push(assetId);
};

const addSelectedVideo = (
  project: StudioRendererProjectV2,
  shotId: string,
  assetId = `take_${shotId}`,
  durationSeconds = 4
): void => {
  const video = makeAsset(assetId, shotId, 'video', 'assets', '2026-08-19T00:00:00.000Z', durationSeconds);
  project.assets[assetId] = video;
  project.shots[shotId]!.assetIds.push(assetId);
  project.shots[shotId]!.selectedTakeId = assetId;
};

const cascadeRow = (
  waitingReason: StudioCascadeProgressV2['waitingReason'],
  dependentShotId = 'shot_2'
): StudioCascadeProgressV2 => ({
  dependentShotId,
  upstreamShotId: 'shot_1',
  eligiblePrimaryAssetIds: [],
  canRetryConditioningFrame: waitingReason === 'conditioning_failed',
  canCancelWaiting: false,
  waitingReason,
});

describe('buildStudioBarStats', () => {
  const beat = (displayState: string, shotCount: number) =>
    ({ displayState, shots: Array.from({ length: shotCount }, (_, i) => ({ id: `s${i}` })) }) as never;

  it('counts the film the way the app bar states it', () => {
    // The drawn strip reads "9 BEATS · 2:58 OF 3:00 · 5 READY", so it needs the Beat count, the
    // clock pair, and how many Beats are actually ready — not how many exist.
    const stats = buildStudioBarStats({
      activeBeats: [beat('ready', 2), beat('rendering', 3), beat('ready', 1), beat('no_coverage', 0)],
      cut: { filmDurationSeconds: 178, targetDurationSeconds: 180 },
    } as never);

    expect(stats).toEqual({ beatCount: 4, shotCount: 6, readyCount: 2, filmSeconds: 178, targetSeconds: 180 });
  });

  it('counts only Beats that are ready, not those merely part done or rendering', () => {
    const stats = buildStudioBarStats({
      activeBeats: [beat('part_done', 1), beat('rendering', 1), beat('stale', 1), beat('draft', 1)],
      cut: { filmDurationSeconds: null, targetDurationSeconds: null },
    } as never);
    expect(stats.readyCount).toBe(0);
  });

  it('carries an unknown clock through rather than reporting zero', () => {
    // A film whose length is not yet known must not read as a zero-length film in the bar.
    const stats = buildStudioBarStats({
      activeBeats: [],
      cut: { filmDurationSeconds: null, targetDurationSeconds: 180 },
    } as never);
    expect(stats.filmSeconds).toBeNull();
    expect(stats.targetSeconds).toBe(180);
  });
});

describe('projectWorkspace', () => {
  it('projects safe prototype-named Beat, Shot, asset, and Bin identities through own-key lookup', () => {
    const project = makeProject();
    const beatId = '__proto__';
    const shotId = 'constructor';
    const assetId = 'toString';
    const asset = makeAsset(assetId, shotId, 'image', 'imports');
    const binnedAssetId = 'constructor';
    const binnedAsset = makeAsset(binnedAssetId, shotId, 'image', 'imports');

    project.beatOrder = [beatId];
    project.beats = Object.create(null) as StudioRendererProjectV2['beats'];
    project.shots = Object.create(null) as StudioRendererProjectV2['shots'];
    project.assets = Object.create(null) as StudioRendererProjectV2['assets'];
    project.jobs = Object.create(null) as StudioRendererProjectV2['jobs'];
    project.beats[beatId] = {
      id: beatId,
      title: 'Prototype-safe beat',
      action: 'Keep the own property',
      look: 'Exact',
      actionRevision: 1,
      targetSeconds: 4,
      shotOrder: [shotId],
      lineHistory: [],
    };
    project.shots[shotId] = makeShot(shotId, 'Prototype-safe shot');
    project.shots[shotId]!.seedStillId = assetId;
    project.shots[shotId]!.assetIds.push(assetId, binnedAssetId);
    project.assets[assetId] = asset;
    project.assets[binnedAssetId] = binnedAsset;
    project.bin = [{ kind: 'take', assetId: binnedAssetId, reason: 'alternate' }];

    const result = projectWorkspace(project, null, null);

    expect(result.activeBeatIds).toEqual([beatId]);
    expect(result.activeShotIds).toEqual([shotId]);
    expect(result.activeBeats[0]).toMatchObject({ id: beatId, coverAssetId: assetId });
    expect(result.activeBeats[0]!.shots[0]).toMatchObject({
      id: shotId,
      effectiveSeedAssetId: assetId,
      coverAssetId: assetId,
    });
    expect(result.bin.items).toMatchObject([
      {
        kind: 'take',
        position: 1,
        identity: { kind: 'take', assetId: binnedAssetId, reason: 'alternate' },
        value: { assetId: binnedAssetId, shotId, beatId },
      },
    ]);
  });

  it('preserves one mixed canonical Bin order with 1-based positions and exact cloned identities', () => {
    const project = makeProject();
    project.shots.shot_lifted = makeShot('shot_lifted', 'Lifted shot');
    const binnedTake = makeAsset('take_parked', 'shot_parked', 'video');
    project.assets[binnedTake.id] = binnedTake;
    project.shots.shot_parked!.assetIds.push(binnedTake.id);
    project.bin = [
      { kind: 'take', assetId: binnedTake.id, reason: 'alternate' },
      { kind: 'beat', beatId: 'beat_parked', reason: 'lifted' },
      { kind: 'shot', beatId: 'beat_parked', shotId: 'shot_lifted', reason: 'lifted' },
    ];

    const result = projectWorkspace(project, workspaceStatus(), chainStatus());

    expect(result).toMatchObject({ workspaceStatusReady: true, chainStatusReady: true });
    expect(result.activeBeats.map((beat) => beat.id)).toEqual(['beat_1', 'beat_2']);
    expect(result.activeBeatIds).toEqual(['beat_1', 'beat_2']);
    expect(result.activeShotIds).toEqual(['shot_1', 'shot_2', 'shot_3']);
    expect(result.bin.items.map(({ kind, position, identity }) => ({ kind, position, identity }))).toEqual([
      { kind: 'take', position: 1, identity: project.bin[0] },
      { kind: 'beat', position: 2, identity: project.bin[1] },
      { kind: 'shot', position: 3, identity: project.bin[2] },
    ]);
    result.bin.items.forEach((row, index) => expect(row.identity).not.toBe(project.bin[index]));
    expect(result.bin.beats).toMatchObject([{ id: 'beat_parked', reason: 'lifted' }]);
    expect(result.bin.shots).toMatchObject([
      { id: 'shot_lifted', beatId: 'beat_parked', beatTitle: 'Parked beat', reason: 'lifted' },
    ]);
    expect(result.bin.takes).toMatchObject([
      {
        assetId: 'take_parked',
        shotId: 'shot_parked',
        beatId: 'beat_parked',
        beatTitle: 'Parked beat',
        shotLine: 'Parked',
        ownerBeatBinned: true,
        reason: 'alternate',
        mediaKind: 'video',
      },
    ]);
    expect(result.bin.items.map((row) => row.value)).toEqual([
      result.bin.takes[0],
      result.bin.beats[0],
      result.bin.shots[0],
    ]);
  });

  it('projects a binned Beat with normal Shot planning, deterministic cover, duration, and retained work', () => {
    const project = makeProject();
    addSeed(project, 'shot_parked', 'seed_parked');
    project.beats.beat_parked!.lineHistory = [
      { id: 'history_parked', shotOrdinal: 1, text: 'Earlier parked line', capturedAt: '2026-08-19T00:00:00.000Z' },
    ];
    project.bin = [{ kind: 'beat', beatId: 'beat_parked', reason: 'alternate' }];

    const result = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus());
    const beat = result.bin.beats[0]!;

    expect(beat).toMatchObject({
      id: 'beat_parked',
      reason: 'alternate',
      shotCount: 1,
      actualSeconds: 4,
      displayState: 'draft',
      coverAssetId: 'seed_parked',
      retainedWork: true,
    });
    expect(beat.shots[0]).toMatchObject({
      id: 'shot_parked',
      segmentHead: true,
      planningBoundary: { shotId: 'shot_parked', startSeconds: 0, endSeconds: 4 },
      effectiveSeedAssetId: 'seed_parked',
      coverAssetId: 'seed_parked',
    });
    expect(beat.lineHistory).toEqual(project.beats.beat_parked!.lineHistory);
    expect(beat.lineHistory).not.toBe(project.beats.beat_parked!.lineHistory);
  });

  it('keeps a lifted former segment head and every retained Take fact while its owner Beat is binned', () => {
    const project = makeProject();
    project.shots.shot_lifted = makeShot('shot_lifted', 'Lifted opening', 'none');
    const seed = makeAsset('seed_lifted', 'shot_lifted', 'image', 'imports', '2026-08-19T01:00:00.000Z');
    const alternateImage = makeAsset('image_alternate', 'shot_lifted', 'image', 'imports', '2026-08-19T02:00:00.000Z');
    const alternateVideo = makeAsset(
      'video_alternate',
      'shot_lifted',
      'video',
      'assets',
      '2026-08-19T03:00:00.000Z',
      9
    );
    const poster = makeAsset('poster_alternate', 'shot_lifted', 'image', 'thumbnails');
    Object.assign(project.assets, {
      [seed.id]: seed,
      [alternateImage.id]: alternateImage,
      [alternateVideo.id]: alternateVideo,
      [poster.id]: poster,
    });
    project.shots.shot_lifted!.seedStillId = seed.id;
    project.shots.shot_lifted!.assetIds.push(seed.id, alternateImage.id, alternateVideo.id, poster.id);
    project.shots.shot_lifted!.jobIds.push('job_alternate');
    project.jobs.job_alternate = makeJob('job_alternate', 'shot_lifted', {
      outputAssetIds: [alternateVideo.id, poster.id],
      outputAssetIdsByRole: { primary: alternateVideo.id, poster: poster.id },
    });
    project.bin = [
      { kind: 'beat', beatId: 'beat_parked', reason: 'lifted' },
      { kind: 'shot', beatId: 'beat_parked', shotId: 'shot_lifted', reason: 'lifted' },
      { kind: 'take', assetId: alternateImage.id, reason: 'lifted' },
      { kind: 'take', assetId: alternateVideo.id, reason: 'alternate' },
    ];

    const result = projectWorkspace(project, null, null);
    const shot = result.bin.shots[0]!;

    expect(shot).toMatchObject({
      id: 'shot_lifted',
      beatId: 'beat_parked',
      beatTitle: 'Parked beat',
      ownerBeatBinned: true,
      reason: 'lifted',
      chainBreak: 'none',
      segmentHead: false,
      effectiveSeedAssetId: null,
      coverAssetId: 'seed_lifted',
      takeCount: 3,
      retainedWork: true,
    });
    expect(shot.imageTakes.map((take) => take.assetId)).toEqual(['image_alternate', 'seed_lifted']);
    expect(shot.videoTakes).toMatchObject([
      {
        assetId: 'video_alternate',
        binReason: 'alternate',
        createdAt: '2026-08-19T03:00:00.000Z',
        sourceDurationSeconds: 9,
        posterAssetId: 'poster_alternate',
      },
    ]);
    expect(result.bin.takes).toMatchObject([
      {
        assetId: 'image_alternate',
        shotId: 'shot_lifted',
        shotLine: 'Lifted opening',
        beatId: 'beat_parked',
        beatTitle: 'Parked beat',
        ownerBeatBinned: true,
        createdAt: '2026-08-19T02:00:00.000Z',
        sourceDurationSeconds: null,
        posterAssetId: null,
        coverAssetId: 'image_alternate',
      },
      {
        assetId: 'video_alternate',
        shotId: 'shot_lifted',
        shotLine: 'Lifted opening',
        beatId: 'beat_parked',
        beatTitle: 'Parked beat',
        ownerBeatBinned: true,
        createdAt: '2026-08-19T03:00:00.000Z',
        sourceDurationSeconds: 9,
        posterAssetId: 'poster_alternate',
        coverAssetId: 'poster_alternate',
      },
    ]);
    expect(JSON.stringify(result.bin)).not.toMatch(/provider_safe|managedAsset|fileName|job_alternate/);
  });

  it('omits Bin entries when canonical owner facts are duplicated or malformed', () => {
    const ambiguous = makeProject();
    const ambiguousTake = makeAsset('take_ambiguous', 'shot_1', 'video');
    ambiguous.assets[ambiguousTake.id] = ambiguousTake;
    ambiguous.shots.shot_1!.assetIds.push(ambiguousTake.id);
    ambiguous.beats.beat_2!.shotOrder.push('shot_1');
    ambiguous.bin = [{ kind: 'take', assetId: ambiguousTake.id, reason: 'alternate' }];

    expect(projectWorkspace(ambiguous, null, null).bin).toEqual({ items: [], beats: [], shots: [], takes: [] });

    const malformed = makeProject();
    const malformedTake = makeAsset('take_malformed', 'shot_1', 'video');
    malformedTake.createdAt = 'not-a-timestamp';
    malformed.assets[malformedTake.id] = malformedTake;
    malformed.shots.shot_1!.assetIds.push(malformedTake.id);
    malformed.bin = [{ kind: 'take', assetId: malformedTake.id, reason: 'alternate' }];

    expect(projectWorkspace(malformed, null, null).bin).toEqual({ items: [], beats: [], shots: [], takes: [] });

    const malformedHistory = makeProject();
    malformedHistory.beats.beat_parked!.lineHistory = [null] as never;
    malformedHistory.bin = [{ kind: 'beat', beatId: 'beat_parked', reason: 'lifted' }];

    expect(() => projectWorkspace(malformedHistory, null, null)).not.toThrow();
    expect(projectWorkspace(malformedHistory, null, null).bin).toEqual({
      items: [],
      beats: [],
      shots: [],
      takes: [],
    });
  });

  it('keeps a canonical binned video Take but nulls ambiguous poster and malformed duration facts', () => {
    const project = makeProject();
    const video = makeAsset('take_uncertain', 'shot_1', 'video', 'assets', undefined, Number.NaN);
    const poster = makeAsset('poster_uncertain', 'shot_1', 'image', 'thumbnails');
    Object.assign(project.assets, { [video.id]: video, [poster.id]: poster });
    project.shots.shot_1!.assetIds.push(video.id, poster.id);
    project.shots.shot_1!.jobIds.push('job_uncertain_a', 'job_uncertain_b');
    project.jobs.job_uncertain_a = makeJob('job_uncertain_a', 'shot_1', {
      outputAssetIds: [video.id, poster.id],
      outputAssetIdsByRole: { primary: video.id, poster: poster.id },
    });
    project.jobs.job_uncertain_b = makeJob('job_uncertain_b', 'shot_1', {
      outputAssetIds: [video.id, poster.id],
      outputAssetIdsByRole: { primary: video.id, poster: poster.id },
    });
    project.bin = [{ kind: 'take', assetId: video.id, reason: 'alternate' }];

    const result = projectWorkspace(project, null, null);

    expect(result.bin.takes).toEqual([
      {
        assetId: 'take_uncertain',
        shotId: 'shot_1',
        shotLine: 'First',
        beatId: 'beat_1',
        beatTitle: 'Opening',
        ownerBeatBinned: false,
        reason: 'alternate',
        mediaKind: 'video',
        createdAt: '2026-08-19T00:00:00.000Z',
        sourceDurationSeconds: null,
        posterAssetId: null,
        coverAssetId: null,
      },
    ]);
  });

  it('counts eligible imported/generated image and video Takes while image-only coverage stays seed-ready', () => {
    const project = makeProject();
    const importedUpper = makeAsset('seed_Z', 'shot_1', 'image', 'imports', '2026-08-19T01:00:00.000Z');
    const importedLower = makeAsset('seed_a', 'shot_1', 'image', 'imports', '2026-08-19T01:00:00.000Z');
    const generatedImage = makeAsset('image_take', 'shot_1', 'image', 'assets', '2026-08-19T00:00:00.000Z');
    const video = makeAsset('video_take', 'shot_1', 'video', 'assets', '2026-08-19T00:00:00.000Z');
    Object.assign(project.assets, {
      [importedUpper.id]: importedUpper,
      [importedLower.id]: importedLower,
      [generatedImage.id]: generatedImage,
    });
    project.shots.shot_1!.assetIds.push(importedUpper.id, importedLower.id, generatedImage.id);

    let shot = projectWorkspace(project, null, null).activeBeats[0]!.shots[0]!;
    expect(shot).toMatchObject({
      takeCount: 3,
      coverAssetId: 'seed_a',
      displayState: 'seed_ready',
      hasEffectiveSeed: true,
    });

    project.assets[video.id] = video;
    project.shots.shot_1!.assetIds.push(video.id);
    shot = projectWorkspace(project, null, null).activeBeats[0]!.shots[0]!;
    expect(shot).toMatchObject({ takeCount: 4, displayState: 'takes_available' });
  });

  it('orders image and video Takes newest-first while preserving exact pins, posters, and Bin aliases', () => {
    const project = makeProject();
    const pinned = makeAsset('seed_pinned', 'shot_1', 'image', 'imports', '2026-08-19T01:00:00.000Z');
    const newestLower = makeAsset('seed_a', 'shot_1', 'image', 'assets', '2026-08-19T02:00:00.000Z');
    const newestUpper = makeAsset('seed_Z', 'shot_1', 'image', 'assets', '2026-08-19T02:00:00.000Z');
    const binnedImage = makeAsset('seed_binned', 'shot_1', 'image', 'imports', '2026-08-19T04:00:00.000Z');
    const selectedVideo = makeAsset('take_selected', 'shot_1', 'video', 'assets', '2026-08-19T03:00:00.000Z', 10);
    const binnedVideo = makeAsset('take_binned', 'shot_1', 'video', 'assets', '2026-08-19T05:00:00.000Z', 9);
    const poster = makeAsset('poster_selected', 'shot_1', 'image', 'thumbnails');
    Object.assign(project.assets, {
      [pinned.id]: pinned,
      [newestLower.id]: newestLower,
      [newestUpper.id]: newestUpper,
      [binnedImage.id]: binnedImage,
      [selectedVideo.id]: selectedVideo,
      [binnedVideo.id]: binnedVideo,
      [poster.id]: poster,
    });
    project.shots.shot_1!.assetIds.push(
      pinned.id,
      newestUpper.id,
      newestLower.id,
      binnedImage.id,
      selectedVideo.id,
      binnedVideo.id,
      poster.id
    );
    project.shots.shot_1!.seedStillId = pinned.id;
    project.shots.shot_1!.selectedTakeId = selectedVideo.id;
    project.shots.shot_1!.jobIds.push('job_selected');
    project.jobs.job_selected = makeJob('job_selected', 'shot_1', {
      outputAssetIds: [selectedVideo.id, poster.id],
      outputAssetIdsByRole: { primary: selectedVideo.id, poster: poster.id },
    });
    project.bin = [
      { kind: 'take', assetId: binnedImage.id, reason: 'lifted' },
      { kind: 'take', assetId: binnedVideo.id, reason: 'alternate' },
    ];

    let shot = projectWorkspace(project, null, null).activeBeats[0]!.shots[0]!;
    expect(shot.imageTakes.map((take) => take.assetId)).toEqual(['seed_binned', 'seed_a', 'seed_Z', 'seed_pinned']);
    expect(shot.imageTakes).toMatchObject([
      { binReason: 'lifted', explicitSeed: false, effectiveSeed: false },
      { binReason: null, explicitSeed: false, effectiveSeed: false },
      { binReason: null, explicitSeed: false, effectiveSeed: false },
      { binReason: null, explicitSeed: true, effectiveSeed: true },
    ]);
    expect(shot.videoTakes).toMatchObject([
      {
        assetId: 'take_binned',
        binReason: 'alternate',
        selected: false,
        sourceDurationSeconds: 9,
        posterAssetId: null,
      },
      {
        assetId: 'take_selected',
        binReason: null,
        selected: true,
        sourceDurationSeconds: 10,
        posterAssetId: 'poster_selected',
      },
    ]);

    project.shots.shot_1!.seedStillId = null;
    shot = projectWorkspace(project, null, null).activeBeats[0]!.shots[0]!;
    expect(shot).toMatchObject({ explicitSeedAssetId: null, effectiveSeedAssetId: 'seed_a' });
    expect(shot.imageTakes.find((take) => take.assetId === 'seed_a')).toMatchObject({ effectiveSeed: true });
  });

  it('prefers one exact succeeded selected-video poster and rejects malformed video poison', () => {
    const project = makeProject();
    const seed = makeAsset('seed_1', 'shot_1', 'image', 'imports');
    const video = makeAsset('take_1', 'shot_1', 'video');
    const poster = makeAsset('poster_1', 'shot_1', 'image', 'thumbnails');
    const poison = makeAsset('poison_video', 'shot_2', 'video', 'imports');
    Object.assign(project.assets, { seed_1: seed, take_1: video, poster_1: poster, poison_video: poison });
    project.shots.shot_1!.seedStillId = seed.id;
    project.shots.shot_1!.selectedTakeId = video.id;
    project.shots.shot_1!.assetIds.push(seed.id, video.id, poster.id);
    project.shots.shot_1!.jobIds.push('job_1');
    project.jobs.job_1 = makeJob('job_1', 'shot_1', {
      outputAssetIds: [video.id, poster.id],
      outputAssetIdsByRole: { primary: video.id, poster: poster.id },
    });
    project.shots.shot_2!.selectedTakeId = poison.id;
    project.shots.shot_2!.assetIds.push(poison.id);

    const result = projectWorkspace(project, null, null);

    expect(result.activeBeats[0]!.shots[0]).toMatchObject({
      coverAssetId: 'poster_1',
      takeCount: 2,
      displayState: 'selected_take',
    });
    expect(result.activeBeats[0]).toMatchObject({ coverAssetId: 'poster_1', retainedWork: true });
    expect(result.activeBeats[0]!.shots[1]).toMatchObject({ takeCount: 0, displayState: 'draft' });
  });

  it('retains paid work from an exact shot-owned job without exposing job identity', () => {
    const project = makeProject();
    project.shots.shot_3!.jobIds.push('job_failed');
    project.jobs.job_failed = makeJob('job_failed', 'shot_3', { status: 'failed' });

    const shot = projectWorkspace(project, null, null).activeBeats[1]!.shots[0]!;

    expect(shot.retainedWork).toBe(true);
    expect(shot).not.toHaveProperty('jobId');
    expect(JSON.stringify(shot)).not.toContain('provider_safe');
  });

  it('sums exact played duration from selected media and trims instead of planning duration', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.beats.beat_1!.shotOrder = ['shot_1'];
    project.shots.shot_1!.durationSeconds = 8;
    project.shots.shot_1!.trimInSeconds = 1;
    project.shots.shot_1!.trimOutSeconds = 2;
    addSeed(project, 'shot_1');
    addSelectedVideo(project, 'shot_1', 'take_10s', 10);

    const beat = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;

    expect(beat).toMatchObject({ targetSeconds: 8, actualSeconds: 7, displayState: 'ready' });
    expect(beat.actualSeconds).not.toBe(project.shots.shot_1!.durationSeconds);
    expect(beat.shots[0]).toMatchObject({
      durationSeconds: 8,
      trimInSeconds: 1,
      trimOutSeconds: 2,
      selectedTakeId: 'take_10s',
      selectedTakeSourceDurationSeconds: 10,
      playedDurationSeconds: 7,
      planningBoundary: { shotId: 'shot_1', startSeconds: 0, endSeconds: 8 },
    });

    project.assets.take_10s!.durationSeconds = Number.NaN;
    const unresolved = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(unresolved.actualSeconds).toBeNull();
    expect(unresolved.shots[0]).toMatchObject({
      selectedTakeId: 'take_10s',
      selectedTakeSourceDurationSeconds: null,
      playedDurationSeconds: null,
      displayState: 'takes_available',
    });
    expect(unresolved.displayState).toBe('draft');
  });

  it('projects segment heads and display-only downstream IDs only until the next hard cut', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.chainBreak = 'none';
    project.shots.shot_2!.chainBreak = 'none';
    project.shots.shot_4 = makeShot('shot_4', 'Fourth', 'none');
    project.shots.shot_5 = makeShot('shot_5', 'Fifth', 'hard_cut');
    project.beats.beat_1!.shotOrder = ['shot_1', 'shot_2', 'shot_4', 'shot_5'];
    addSeed(project, 'shot_2');

    const shots = projectWorkspace(project, null, null).activeBeats[0]!.shots;

    expect(shots.map((shot) => [shot.id, shot.segmentHead, shot.downstreamShotIds])).toEqual([
      ['shot_1', true, ['shot_2', 'shot_4']],
      ['shot_2', false, ['shot_4']],
      ['shot_4', false, []],
      ['shot_5', true, []],
    ]);
    expect(shots.map((shot) => shot.planningBoundary)).toEqual([
      { shotId: 'shot_1', startSeconds: 0, endSeconds: 4 },
      { shotId: 'shot_2', startSeconds: 4, endSeconds: 8 },
      { shotId: 'shot_4', startSeconds: 8, endSeconds: 12 },
      { shotId: 'shot_5', startSeconds: 12, endSeconds: 16 },
    ]);
    expect(shots[1]).toMatchObject({ effectiveSeedAssetId: null, hasEffectiveSeed: false });
    expect(shots[1]!.imageTakes).toHaveLength(1);
    expect(shots[1]!.imageTakes[0]).toMatchObject({ effectiveSeed: false });
  });

  it('derives line staleness only for derived lines and copies Beat history by value', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.beats.beat_1!.actionRevision = 2;
    project.beats.beat_1!.lineHistory = [
      { id: 'history_1', shotOrdinal: 1, text: 'Earlier line', capturedAt: '2026-08-19T00:00:00.000Z' },
    ];
    project.shots.shot_2!.derivation = 'detached';

    const beat = projectWorkspace(project, null, null).activeBeats[0]!;

    expect(beat.actionRevision).toBe(2);
    expect(beat.lineHistory).toEqual(project.beats.beat_1!.lineHistory);
    expect(beat.lineHistory).not.toBe(project.beats.beat_1!.lineHistory);
    expect(beat.lineHistory[0]).not.toBe(project.beats.beat_1!.lineHistory[0]);
    expect(beat.shots.map((shot) => [shot.id, shot.derivedFromActionRevision, shot.derivationStale])).toEqual([
      ['shot_1', 1, true],
      ['shot_2', 1, false],
    ]);
  });

  it('keeps uncovered duration nullable and distinguishes pending duration from a slate target', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.beats.beat_1!.shotOrder = [];
    project.beats.beat_1!.targetSeconds = null;

    let beat = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(beat).toMatchObject({ actualSeconds: null, targetSeconds: null, displayState: 'duration_pending' });

    project.beats.beat_1!.targetSeconds = 8;
    beat = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(beat).toMatchObject({ actualSeconds: null, targetSeconds: 8, displayState: 'no_coverage' });
  });

  it('requires an effective seed for the first Shot and every later hard-cut segment head', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.chainBreak = 'none';
    project.shots.shot_2!.chainBreak = 'hard_cut';
    addSeed(project, 'shot_1');

    let beat = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(beat.displayState).toBe('seed_pending');

    addSeed(project, 'shot_2');
    beat = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(beat.displayState).toBe('draft');
  });

  it.each(['choose_seed', 'choose_take', 'conditioning_failed', 'dependency_failed', 'cancelled'] as const)(
    'projects actionable or terminal cascade reason %s as part done ahead of an in-flight flag',
    (waitingReason) => {
      const project = makeProject();
      project.beatOrder = ['beat_1'];
      addSeed(project, 'shot_1');
      project.shots.shot_2!.jobIds.push('job_waiting');
      project.jobs.job_waiting = makeJob('job_waiting', 'shot_2', { status: 'waiting_for_conditioning' });
      const status = cleanWorkspaceStatus();
      status.cascadeProgress = [cascadeRow(waitingReason)];

      expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.displayState).toBe('part_done');
    }
  );

  it('projects a revision-matched conditioning failure as part done ahead of an in-flight flag', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    addSeed(project, 'shot_1');
    project.shots.shot_2!.jobIds.push('job_waiting');
    project.jobs.job_waiting = makeJob('job_waiting', 'shot_2', { status: 'waiting_for_conditioning' });

    expect(projectWorkspace(project, cleanWorkspaceStatus(), chainStatus()).activeBeats[0]!.displayState).toBe(
      'part_done'
    );
  });

  it.each(['upstream_running', 'conditioning_frame'] as const)(
    'projects cascade reason %s as rendering',
    (waitingReason) => {
      const project = makeProject();
      project.beatOrder = ['beat_1'];
      addSeed(project, 'shot_1');
      const status = cleanWorkspaceStatus();
      status.cascadeProgress = [cascadeRow(waitingReason)];

      expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.displayState).toBe('rendering');
    }
  );

  it('projects a job needing attention as needing attention, not as rendering', () => {
    // A needs_attention job has already failed — one of these carried
    // error.code 'provider_unavailable' with a real providerJobId. Counting it as work in flight
    // showed "Rendering" for thirty-five minutes on a render that was over in nine.
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.jobIds.push('job_attention');
    project.jobs.job_attention = makeJob('job_attention', 'shot_1', { status: 'needs_attention' });

    expect(projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.displayState).toBe(
      'needs_attention'
    );
  });

  it('still treats a job needing attention as blocking a fresh submission', () => {
    // Displaying it correctly must not make it re-submittable: the job may already have been
    // charged, which is why the record carries duplicateChargeAcknowledged at all.
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.jobIds.push('job_attention');
    project.jobs.job_attention = makeJob('job_attention', 'shot_1', { status: 'needs_attention' });

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.videoGenerationBlocked).toBe(true);
    expect(shot.videoGenerationInFlight).toBe(false);
  });

  it('projects owned generation activity as rendering ahead of stale and seed-pending states', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.jobIds.push('job_running');
    project.jobs.job_running = makeJob('job_running', 'shot_1', { status: 'running' });
    const status = cleanWorkspaceStatus();
    status.dirtyShots = [{ shotId: 'shot_2', causes: ['continuity_stale'] }];

    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.displayState).toBe('rendering');
  });

  it('projects matched dirty work as stale ahead of a missing segment seed', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    const status = cleanWorkspaceStatus();
    status.dirtyShots = [{ shotId: 'shot_2', causes: ['generation_out_of_date'] }];

    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.displayState).toBe('stale');
  });

  it('distinguishes status-pending, ready, and draft after higher-priority Beat states are clear', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    addSeed(project, 'shot_1');

    expect(projectWorkspace(project, cleanWorkspaceStatus(), null).activeBeats[0]!.displayState).toBe('status_pending');
    expect(projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.displayState).toBe(
      'draft'
    );

    addSelectedVideo(project, 'shot_1');
    addSelectedVideo(project, 'shot_2');
    expect(projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.displayState).toBe(
      'ready'
    );
  });

  it('fails closed on stale status and derives request-shape lock only from matched blockers', () => {
    const project = makeProject();
    const matched = workspaceStatus();
    matched.parkEligibility.push({
      subject: 'shot',
      action: 'park',
      beatId: 'beat_1',
      shotId: 'shot_1',
      assetId: null,
      allowed: false,
      blockers: [{ shotId: 'shot_1', code: 'bound_nonterminal_request' }],
    });

    const current = projectWorkspace(project, matched, chainStatus());
    expect(current.requestShapeLocked).toBe(true);
    expect(current.activeBeats[0]!.shots[1]!.dirtyCauses).toEqual(['continuity_stale']);
    const stale = projectWorkspace(project, workspaceStatus(2), chainStatus(2));
    expect(stale).toMatchObject({
      workspaceStatusReady: false,
      chainStatusReady: false,
      requestShapeLocked: false,
      undoTop: null,
      dirtyShots: [],
      cascadeProgress: [],
      parkEligibility: [],
      conditioningFailures: [],
    });
    expect(stale.activeBeats.flatMap((beat) => beat.shots).every((shot) => shot.dirtyCauses.length === 0)).toBe(true);
    expect(projectWorkspace(project, null, null)).toMatchObject({
      workspaceStatusReady: false,
      chainStatusReady: false,
    });
  });

  it('projects trim-aware film timing, a safe audio bed fade, and active Match To candidates', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = ['shot_1'];
    project.shots.shot_1!.trimInSeconds = 1;
    project.shots.shot_1!.trimOutSeconds = 2;
    addSelectedVideo(project, 'shot_1', 'take_10s', 10);
    project.beats.beat_2!.shotOrder = [];
    project.beats.beat_2!.targetSeconds = 4;
    const bed = makeAsset('audio_bed', null, 'audio', 'imports', '2026-08-19T02:00:00.000Z', 14);
    const alternate = makeAsset('audio_old', null, 'audio', 'imports', '2026-08-19T01:00:00.000Z', 12);
    project.assets[bed.id] = bed;
    project.assets[alternate.id] = alternate;
    project.bedAssetId = bed.id;
    project.matchToShotId = 'shot_1';

    const cut = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).cut;

    expect(cut).toMatchObject({
      orderReady: true,
      filmDurationSeconds: 11,
      beats: [
        { id: 'beat_1', durationKind: 'actual', durationSeconds: 7, shotCount: 1 },
        { id: 'beat_2', durationKind: 'target', durationSeconds: 4, shotCount: 0 },
      ],
      bed: {
        status: 'ready',
        assetId: 'audio_bed',
        sourceDurationSeconds: 14,
        fadeOutStartSeconds: 9,
        fadeOutEndSeconds: 11,
      },
      selectedMatchShotId: 'shot_1',
      matchSelectionInvalid: false,
    });
    expect(cut.audioImports.map(({ assetId, position }) => ({ assetId, position }))).toEqual([
      { assetId: 'audio_bed', position: 1 },
      { assetId: 'audio_old', position: 2 },
    ]);
    expect(cut.matchCandidates).toMatchObject([
      { shotId: 'shot_1', beatId: 'beat_1', beatTitle: 'Opening', line: 'First' },
    ]);
    expect(JSON.stringify(cut)).not.toContain('fileName');
    expect(JSON.stringify(cut)).not.toContain('sha256');
    expect(JSON.stringify(cut)).not.toContain('mimeType');
  });

  it("carries the project's target duration so the Cut can show the film against it", () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.beats.beat_1!.targetSeconds = 7;
    project.beats.beat_2!.shotOrder = [];
    project.beats.beat_2!.targetSeconds = 4;

    const cut = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).cut;

    // The film runs 11s against a 12s target. Without the target beside it the Cut can render the
    // clock but not the constraint, and the render gate is exactly that comparison.
    expect(cut.filmDurationSeconds).toBe(11);
    expect(cut.targetDurationSeconds).toBe(12);
  });

  it('fails Cut bed, duration, order, classification, and Match To facts closed', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.beats.beat_1!.targetSeconds = 8;
    project.beats.beat_2!.shotOrder = [];
    project.beats.beat_2!.targetSeconds = 4;
    const shortBed = makeAsset('audio_short', null, 'audio', 'imports', '2026-08-19T02:00:00.000Z', 10);
    const classified = makeAsset('audio_classified', null, 'audio', 'imports', '2026-08-19T03:00:00.000Z', 20);
    classified.briefReferenceRole = 'look';
    classified.briefReferenceLabel = 'Not a bed';
    project.assets[shortBed.id] = shortBed;
    project.assets[classified.id] = classified;
    project.bedAssetId = shortBed.id;
    project.matchToShotId = 'shot_parked';

    let cut = projectWorkspace(project, null, null).cut;
    expect(cut.audioImports.map((asset) => asset.assetId)).toEqual(['audio_short']);
    expect(cut.bed).toEqual({
      status: 'too_short',
      assetId: 'audio_short',
      sourceDurationSeconds: 10,
      requiredDurationSeconds: 12,
    });
    expect(cut).toMatchObject({ selectedMatchShotId: null, matchSelectionInvalid: true });

    project.beats.beat_2!.targetSeconds = null;
    cut = projectWorkspace(project, null, null).cut;
    expect(cut.filmDurationSeconds).toBeNull();
    expect(cut.bed).toMatchObject({ status: 'duration_pending', assetId: 'audio_short' });

    project.bedAssetId = 'missing_audio';
    cut = projectWorkspace(project, null, null).cut;
    expect(cut.bed).toEqual({ status: 'invalid', assetId: 'missing_audio' });

    project.beatOrder = ['beat_1', 'beat_1'];
    cut = projectWorkspace(project, null, null).cut;
    expect(cut).toMatchObject({ orderReady: false, filmDurationSeconds: null, matchCandidates: [] });
  });
});

describe('useWorkspaceDrafts', () => {
  const storageKey = 'aionui:creative-studio:v2:workspace-drafts:project_1';

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('preserves intentional null values and a true null base through conflict detection', async () => {
    let canonical = {
      'beat.beat_1.targetSeconds': 4 as number | null,
      'beat.beat_2.targetSeconds': null as number | null,
    };
    const view = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: canonical,
        activeBeatIds: [],
        activeShotIds: [],
      })
    );
    act(() => {
      view.result.current.setValue('beat.beat_1.targetSeconds', null);
      view.result.current.setValue('beat.beat_2.targetSeconds', 6);
    });
    expect(view.result.current.value('beat.beat_1.targetSeconds')).toBeNull();
    canonical = { 'beat.beat_1.targetSeconds': 4, 'beat.beat_2.targetSeconds': 8 };
    view.rerender();
    await waitFor(() => expect(view.result.current.conflictKeys).toEqual(['beat.beat_2.targetSeconds']));
    expect(view.result.current.entries['beat.beat_2.targetSeconds']).toEqual({ baseValue: null, value: 6 });
  });

  it('uses session storage across remount and keeps gate preferences out of close dirty count', async () => {
    const input = {
      projectId: 'project_1',
      projectRevision: 3,
      canonicalValues: { name: 'A', 'gate.choices': '{}' },
      activeBeatIds: ['beat_1'],
      activeShotIds: ['shot_1'],
    };
    const first = renderHook(() => useWorkspaceDrafts(input));
    act(() => {
      first.result.current.setValue('name', 'Draft A');
      first.result.current.setValue('gate.choices', '{"shot_1:seed_still":{"generationCount":2}}');
      first.result.current.selectBeat('beat_1');
      first.result.current.selectShot('shot_1', 'replace');
    });
    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toContain('Draft A'));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(first.result.current.dirtyCount).toBe(1);
    first.unmount();
    const second = renderHook(() => useWorkspaceDrafts(input));
    expect(second.result.current.value('name')).toBe('Draft A');
    expect(second.result.current.selection.selectedBeatId).toBe('beat_1');
    expect(second.result.current.selection.selectedShotIds).toEqual(['shot_1']);
  });

  it('retains bounded drafts and global close count when session storage rejects a write', async () => {
    const input = {
      projectId: 'project_1',
      projectRevision: 3,
      canonicalValues: { name: 'A' },
      activeBeatIds: [] as string[],
      activeShotIds: [] as string[],
    };
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === storageKey) throw new DOMException('Quota', 'QuotaExceededError');
      return Reflect.apply(originalSetItem, window.sessionStorage, [key, value]);
    });
    const first = renderHook(() => useWorkspaceDrafts(input));
    act(() => first.result.current.setValue('name', 'Draft A'));
    expect(first.result.current.dirtyCount).toBe(1);
    expect(countStoredWorkspaceDrafts()).toBe(1);
    expect(countStoredWorkspaceDrafts('project_1')).toBe(0);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();

    first.unmount();
    const second = renderHook(() => useWorkspaceDrafts(input));
    expect(second.result.current.value('name')).toBe('Draft A');
    expect(second.result.current.dirtyCount).toBe(1);

    setItem.mockRestore();
    act(() => second.result.current.reset('name'));
    await waitFor(() => expect(countStoredWorkspaceDrafts()).toBe(0));
  });

  it('caches a counted backing envelope before session storage becomes unreadable', async () => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: { name: { baseValue: 'A', value: 'Draft A' } },
        selection: {
          selectedBeatId: 'beat_1',
          selectedShotIds: ['shot_1', 42, 'x'.repeat(513)],
          anchorShotId: 'shot_1',
        },
      })
    );
    expect(countStoredWorkspaceDrafts()).toBe(1);
    const sessionStorage = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Unavailable', 'SecurityError');
    });
    expect(countStoredWorkspaceDrafts()).toBe(1);

    const view = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: { name: 'A' },
        activeBeatIds: ['beat_1'],
        activeShotIds: ['shot_1'],
      })
    );
    expect(view.result.current.value('name')).toBe('Draft A');
    expect(view.result.current.selection).toEqual({
      selectedBeatId: 'beat_1',
      selectedShotIds: ['shot_1'],
      anchorShotId: 'shot_1',
    });
    sessionStorage.mockRestore();
    act(() => view.result.current.reset('name'));
    await waitFor(() => expect(countStoredWorkspaceDrafts()).toBe(0));
  });

  it('hydrates custom storage before its first enabled write', async () => {
    const projectId = 'project_custom_storage';
    const customStorageKey = `aionui:creative-studio:v2:workspace-drafts:${projectId}`;
    window.localStorage.setItem(
      customStorageKey,
      JSON.stringify({
        version: 2,
        projectId,
        sourceRevision: 3,
        entries: { name: { baseValue: 'A', value: 'Stored draft' } },
        selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
      })
    );
    let enabled = false;
    const view = renderHook(() =>
      useWorkspaceDrafts({
        projectId,
        projectRevision: 3,
        canonicalValues: { name: 'A' },
        activeBeatIds: [],
        activeShotIds: [],
        storage: window.localStorage,
        enabled,
      })
    );

    act(() => view.result.current.setValue('name', 'Ignored while disabled'));
    expect(view.result.current.value('name')).toBe('A');
    enabled = true;
    view.rerender();

    await waitFor(() => expect(view.result.current.value('name')).toBe('Stored draft'));
    expect(window.localStorage.getItem(customStorageKey)).toContain('Stored draft');
  });

  it('recovers the last trusted draft when its backing envelope becomes malformed', async () => {
    const projectId = 'project_corrupt_backing';
    const corruptStorageKey = `aionui:creative-studio:v2:workspace-drafts:${projectId}`;
    const input = {
      projectId,
      projectRevision: 3,
      canonicalValues: { name: 'A' },
      activeBeatIds: [] as string[],
      activeShotIds: [] as string[],
    };
    const first = renderHook(() => useWorkspaceDrafts(input));
    act(() => first.result.current.setValue('name', 'Trusted draft'));
    await waitFor(() => expect(window.sessionStorage.getItem(corruptStorageKey)).toContain('Trusted draft'));
    first.unmount();

    window.sessionStorage.setItem(corruptStorageKey, '{not-json');
    expect(countStoredWorkspaceDrafts()).toBe(1);
    const restored = renderHook(() => useWorkspaceDrafts(input));
    expect(restored.result.current.value('name')).toBe('Trusted draft');

    act(() => restored.result.current.reset('name'));
    await waitFor(() => expect(countStoredWorkspaceDrafts()).toBe(0));
  });

  it('rejects out-of-scope draft values and selection identities without creating phantom work', () => {
    const view = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_guarded_inputs',
        projectRevision: 3,
        canonicalValues: { name: 'A' },
        activeBeatIds: ['beat_1'],
        activeShotIds: ['shot_1'],
      })
    );

    act(() => {
      view.result.current.setValue('__proto__', 'unsafe');
      view.result.current.setValue('name', Number.POSITIVE_INFINITY);
      view.result.current.setValue('unknown', 'draft');
      view.result.current.reset('unknown');
      view.result.current.resetIfValue('name', Number.POSITIVE_INFINITY);
      view.result.current.resetIfValue('name', 'A');
      view.result.current.selectBeat('beat_missing');
      view.result.current.selectShot('shot_missing');
    });

    expect(view.result.current.entries).toEqual({});
    expect(view.result.current.selection).toEqual({
      selectedBeatId: null,
      selectedShotIds: [],
      anchorShotId: null,
    });
    expect(view.result.current.value('unknown')).toBeUndefined();
  });

  it('persists Beat-only selection without counting it as an unsaved draft', async () => {
    const input = {
      projectId: 'project_1',
      projectRevision: 3,
      canonicalValues: {},
      activeBeatIds: ['beat_1'],
      activeShotIds: [] as string[],
    };
    const first = renderHook(() => useWorkspaceDrafts(input));
    act(() => first.result.current.selectBeat('beat_1'));
    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toContain('"selectedBeatId":"beat_1"'));
    expect(first.result.current.dirtyCount).toBe(0);

    first.unmount();
    const second = renderHook(() => useWorkspaceDrafts(input));
    expect(second.result.current.selection.selectedBeatId).toBe('beat_1');
    act(() => second.result.current.selectBeat(null));
    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBeNull());
  });

  it('filters Beat identity independently without changing Shot selection', async () => {
    let activeBeatIds = ['beat_1', 'beat_2'];
    const view = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: {},
        activeBeatIds,
        activeShotIds: ['shot_1', 'shot_2'],
      })
    );
    act(() => {
      view.result.current.selectShot('shot_1', 'replace');
      view.result.current.selectBeat('beat_2');
    });
    expect(view.result.current.selection).toEqual({
      selectedBeatId: 'beat_2',
      selectedShotIds: ['shot_1'],
      anchorShotId: 'shot_1',
    });

    act(() => view.result.current.clearSelection());
    expect(view.result.current.selection).toEqual({
      selectedBeatId: 'beat_2',
      selectedShotIds: [],
      anchorShotId: null,
    });
    act(() => view.result.current.selectShot('shot_2', 'replace'));

    activeBeatIds = ['beat_1'];
    view.rerender();
    await waitFor(() => expect(view.result.current.selection.selectedBeatId).toBeNull());
    expect(view.result.current.selection.selectedShotIds).toEqual(['shot_2']);
  });

  it('atomically resets only the value that was saved and preserves a newer edit', () => {
    const longShotKey = `shot.${'x'.repeat(256)}.trimInSeconds`;
    const view = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: { [longShotKey]: 0 },
        activeBeatIds: ['beat_1'],
        activeShotIds: ['shot_1'],
      })
    );
    act(() => view.result.current.setValue(longShotKey, 0.5));
    expect(view.result.current.value(longShotKey)).toBe(0.5);

    act(() => view.result.current.setValue(longShotKey, 1));
    act(() => view.result.current.resetIfValue(longShotKey, 0.5));
    expect(view.result.current.value(longShotKey)).toBe(1);
    expect(view.result.current.dirtyKeys).toEqual([longShotKey]);

    act(() => view.result.current.resetIfValue(longShotKey, 1));
    expect(view.result.current.value(longShotKey)).toBe(0);
    expect(view.result.current.dirtyKeys).toEqual([]);
  });

  it('round-trips the 1,024-field project draft cap and refuses the next field', async () => {
    const keys = Array.from({ length: 1_025 }, (_, index) => `shot.shot_${index}.line`);
    const canonicalValues = Object.fromEntries(keys.map((key) => [key, 'base']));
    const input = {
      projectId: 'project_1',
      projectRevision: 3,
      canonicalValues,
      activeBeatIds: ['beat_1'],
      activeShotIds: ['shot_1'],
    };
    const first = renderHook(() => useWorkspaceDrafts(input));
    act(() => {
      keys.forEach((key, index) => first.result.current.setValue(key, `draft_${index}`));
    });

    expect(Object.keys(first.result.current.entries)).toHaveLength(1_024);
    expect(first.result.current.value(keys[1_023]!)).toBe('draft_1023');
    expect(first.result.current.value(keys[1_024]!)).toBe('base');
    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toContain('draft_1023'));

    first.unmount();
    const second = renderHook(() => useWorkspaceDrafts(input));
    expect(Object.keys(second.result.current.entries)).toHaveLength(1_024);
    expect(second.result.current.value(keys[1_023]!)).toBe('draft_1023');
    expect(second.result.current.value(keys[1_024]!)).toBe('base');
  });

  it('refuses an update above the persisted 1 MiB bound and round-trips every accepted field', async () => {
    const keys = Array.from({ length: 140 }, (_, index) => `shot.shot_${index}.line`);
    const canonicalValues = Object.fromEntries(keys.map((key) => [key, '']));
    const input = {
      projectId: 'project_1',
      projectRevision: 3,
      canonicalValues,
      activeBeatIds: ['beat_1'],
      activeShotIds: ['shot_1'],
    };
    const first = renderHook(() => useWorkspaceDrafts(input));
    const maximumValue = 'x'.repeat(8_192);
    act(() => keys.forEach((key) => first.result.current.setValue(key, maximumValue)));

    expect(Object.keys(first.result.current.entries).length).toBeLessThan(keys.length);
    expect(first.result.current.value(keys.at(-1)!)).toBe('');
    await waitFor(() => {
      const persisted = window.sessionStorage.getItem(storageKey);
      expect(persisted).not.toBeNull();
      expect(persisted!.length).toBeLessThanOrEqual(1_048_576);
    });
    const acceptedKeys = Object.keys(first.result.current.entries);

    first.unmount();
    const second = renderHook(() => useWorkspaceDrafts(input));
    expect(Object.keys(second.result.current.entries)).toEqual(acceptedKeys);
    expect(acceptedKeys.every((key) => second.result.current.value(key) === maximumValue)).toBe(true);
  });

  it('treats every Beat and Shot draft namespace as generation-affecting', () => {
    expect(hasGenerationAffectingWorkspaceDrafts(['beat.beat_1.action'])).toBe(true);
    expect(hasGenerationAffectingWorkspaceDrafts(['beat.beat_1.look'])).toBe(true);
    expect(hasGenerationAffectingWorkspaceDrafts(['shot.shot_1.trimOutSeconds'])).toBe(true);
    expect(hasGenerationAffectingWorkspaceDrafts(['shot.shot_1.onScreenText'])).toBe(true);
    expect(hasGenerationAffectingWorkspaceDrafts(['settings.name', 'gate.choices'])).toBe(false);
  });

  it.each([
    ['valid', '[{"id":"rule_1","text":"Keep the subject centered"}]'],
    ['malformed', '{not-json'],
  ] as const)(
    'synchronously discards a %s legacy Brief rules draft without contaminating current draft state',
    async (_payloadKind, legacyRulesValue) => {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 2,
          projectId: 'project_1',
          sourceRevision: 3,
          entries: {
            'brief.rules': {
              baseValue: '[{"id":"old_rule","text":"Old rule"}]',
              value: legacyRulesValue,
            },
            'settings.name': { baseValue: 'Launch film', value: 'Renamed film' },
          },
          selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
        })
      );

      const view = renderHook(() =>
        useWorkspaceDrafts({
          projectId: 'project_1',
          projectRevision: 3,
          canonicalValues: {
            'brief.rules': '[]',
            'settings.name': 'Launch film',
          },
          activeBeatIds: [],
          activeShotIds: [],
        })
      );

      expect({
        entries: Object.fromEntries(Object.entries(view.result.current.entries)),
        dirtyKeys: view.result.current.dirtyKeys,
        dirtyCount: view.result.current.dirtyCount,
        conflictKeys: view.result.current.conflictKeys,
        staleRevision: view.result.current.staleRevision,
        legacyGenerationAffecting: hasGenerationAffectingWorkspaceDrafts(['brief.rules']),
        currentGenerationAffecting: hasGenerationAffectingWorkspaceDrafts(view.result.current.dirtyKeys),
      }).toEqual({
        entries: {
          'settings.name': { baseValue: 'Launch film', value: 'Renamed film' },
        },
        dirtyKeys: ['settings.name'],
        dirtyCount: 1,
        conflictKeys: [],
        staleRevision: false,
        legacyGenerationAffecting: false,
        currentGenerationAffecting: false,
      });

      await waitFor(() => {
        const persisted = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '{}') as {
          entries?: Record<string, unknown>;
        };
        expect(persisted.entries).toEqual({
          'settings.name': { baseValue: 'Launch film', value: 'Renamed film' },
        });
      });
    }
  );

  it('rejects stored prototype keys, deduplicates active order, and caps runtime selection', () => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {
          __proto__: { baseValue: 'x', value: 'y' },
          constructor: { baseValue: 'x', value: 'y' },
          safe: { baseValue: 'A', value: 'B' },
        },
        selection: { selectedShotIds: ['shot_2', 'shot_1', 'shot_2'], anchorShotId: 'shot_2' },
      })
    );
    const decoded = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: { safe: 'A' },
        activeBeatIds: ['beat_1'],
        activeShotIds: ['shot_1', 'shot_2'],
      })
    );
    expect(Object.keys(decoded.result.current.entries)).toEqual(['safe']);
    expect(decoded.result.current.selection.selectedBeatId).toBeNull();
    expect(decoded.result.current.selection.selectedShotIds).toEqual(['shot_1', 'shot_2']);

    const shots = Array.from({ length: 300 }, (_, index) => `range_${index}`);
    const capped = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_2',
        projectRevision: 1,
        canonicalValues: {},
        activeBeatIds: [],
        activeShotIds: shots,
      })
    );
    act(() => capped.result.current.selectShot(shots[0]!, 'replace'));
    act(() => capped.result.current.selectShot(shots[299]!, 'range'));
    expect(capped.result.current.selection.selectedShotIds).toHaveLength(256);
  });
});

describe('Workspace structure', () => {
  it('keeps source direct children capped and every child directory non-trivial', () => {
    const root = resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/Workspace');
    const children = readdirSync(root);
    expect(children.length).toBeLessThanOrEqual(10);
    for (const child of children) {
      const path = resolve(root, child);
      if (statSync(path).isDirectory()) expect(readdirSync(path).length).toBeGreaterThanOrEqual(2);
    }
  });
});
