// @vitest-environment jsdom

import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioCascadeProgressV2,
  type StudioRendererJobV2,
  type StudioRendererProjectV2,
  type StudioRendererChainStatusV2,
  type StudioRendererWorkspaceStatusV2,
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
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
});

const makeJob = (id: string, shotId: string, overrides: Partial<StudioRendererJobV2> = {}): StudioRendererJobV2 =>
  ({
    id,
    projectId: 'project_1',
    target: { kind: 'shot', shotId },
    status: 'succeeded',
    provider: { choiceId: 'route_video', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [],
    outputAssetIdsByRole: { primary: null, poster: null },
    error: null,
    canCancel: false,
    canRetry: false,
    canRetryDownload: false,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    purpose: 'video_take',
    spendReceipt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }) as StudioRendererJobV2;

const makeShot = (id: string, shootingScript: string, chainBreak: 'none' | 'hard_cut' = 'hard_cut') => ({
  id,
  shootingScript,
  durationSeconds: 4,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak,
  referenceBinding: {
    status: 'ready' as const,
    characterReferenceIds: [] as string[],
    backgroundReferenceId: null,
  },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [] as string[],
  videoAssetId: null,
  supersededVideoAssetIds: [] as string[],
  assetIds: [] as string[],
  jobIds: [] as string[],
});

const makeProject = (): StudioRendererProjectV2 =>
  ({
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    revision: 3,
    id: 'project_1',
    name: 'Launch film',
    brief: 'A launch film.',
    rules: [],
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '720p',
    boardStyle: null,
    beatOrder: ['beat_1', 'beat_2'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        story: 'Open',
        targetSeconds: 8,
        shotOrder: ['shot_1', 'shot_2'],
      },
      beat_2: {
        id: 'beat_2',
        title: 'Close',
        story: 'Close',
        targetSeconds: 4,
        shotOrder: ['shot_3'],
      },
      beat_parked: {
        id: 'beat_parked',
        title: 'Parked beat',
        story: 'Parked',
        targetSeconds: null,
        shotOrder: ['shot_parked'],
      },
    },
    shots: {
      shot_1: makeShot('shot_1', 'First'),
      shot_2: makeShot('shot_2', 'Second', 'none'),
      shot_3: makeShot('shot_3', 'Third'),
      shot_parked: makeShot('shot_parked', 'Parked'),
    },
    referencePlanStatus: 'unplanned',
    referenceOrder: [],
    references: {},
    bin: [],
    bedAssetId: null,
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
  boardPanels: [
    { shotId: 'shot_1', assetId: null, producerJobId: null, latestJobId: null, staleCauses: [] },
    { shotId: 'shot_2', assetId: null, producerJobId: null, latestJobId: null, staleCauses: [] },
    { shotId: 'shot_3', assetId: null, producerJobId: null, latestJobId: null, staleCauses: [] },
  ],
  cascadeProgress: [],
  currentVideoJobs: [
    { shotId: 'shot_1', jobIds: [] },
    { shotId: 'shot_2', jobIds: [] },
    { shotId: 'shot_3', jobIds: [] },
  ],
  parkEligibility: [],
});

const chainStatus = (revision = 3): StudioRendererChainStatusV2 => ({
  projectId: 'project_1',
  projectRevision: revision,
  conditioningFailures: [{ dependentShotId: 'shot_2', reason: 'conditioning_failed', canRetry: true }],
  boundaries: [
    {
      upstreamShotId: 'shot_1',
      dependentShotId: 'shot_2',
      status: 'empty',
      frameAssetId: null,
    },
  ],
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

const addCurrentVideo = (
  project: StudioRendererProjectV2,
  shotId: string,
  assetId = `take_${shotId}`,
  durationSeconds = 4
): void => {
  const video = makeAsset(assetId, shotId, 'video', 'assets', '2026-08-19T00:00:00.000Z', durationSeconds);
  project.assets[assetId] = video;
  project.shots[shotId]!.assetIds.push(assetId);
  project.shots[shotId]!.videoAssetId = assetId;
};

const addCurrentBoardPanel = (
  project: StudioRendererProjectV2,
  shotId: string,
  assetId = `board_${shotId}`,
  jobId = `job_${assetId}`
): StudioRendererJobV2 => {
  const asset = makeAsset(assetId, shotId, 'image', 'boardStills');
  project.assets[asset.id] = asset;
  const shot = project.shots[shotId]!;
  shot.assetIds.push(asset.id);
  shot.boardAssetId = asset.id;
  const job = makeJob(jobId, shotId, {
    status: 'succeeded',
    purpose: 'board_still',
    provider: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      purpose: 'board_still',
      routeId: 'route_image',
      currency: 'USD',
      rateUnit: 'generation',
      rateMinorUnits: 1,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: 1,
    },
  });
  project.jobs[job.id] = job;
  shot.jobIds.push(job.id);
  return job;
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
  it('projects Board freshness independently and retains the current panel while a paid redraw is drawing', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const producer = addCurrentBoardPanel(project, 'shot_1');
    const redraw = makeJob('job_board_redraw', 'shot_1', {
      status: 'running',
      purpose: 'board_still',
      provider: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
    });
    project.jobs[redraw.id] = redraw;
    project.shots.shot_1!.jobIds.push(redraw.id);
    const status = cleanWorkspaceStatus();
    status.boardPanels[0] = {
      shotId: 'shot_1',
      assetId: 'board_shot_1',
      producerJobId: producer.id,
      latestJobId: redraw.id,
      staleCauses: ['request_out_of_date'],
    };

    expect(projectWorkspace(project, status, null).boardPanels[0]).toEqual({
      shotId: 'shot_1',
      assetId: 'board_shot_1',
      producerJobId: producer.id,
      latestJobId: redraw.id,
      staleCauses: ['request_out_of_date'],
      freshness: 'stale',
      activity: 'drawing',
      recovery: null,
    });
  });

  it('projects only sanitized recovery authority for the exact latest Board job needing attention', () => {
    const project = makeProject();
    project.boardStyle = 'line_art';
    const attention = makeJob('job_board_attention', 'shot_1', {
      status: 'needs_attention',
      purpose: 'board_still',
      provider: { choiceId: 'route_secret', providerId: 'provider_secret', model: 'model_secret' },
      error: {
        code: 'submission_unknown',
        messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
      },
      canCancel: false,
      canRetry: true,
    });
    project.jobs[attention.id] = attention;
    project.shots.shot_1!.jobIds.push(attention.id);
    const status = cleanWorkspaceStatus();
    status.boardPanels[0] = {
      shotId: 'shot_1',
      assetId: null,
      producerJobId: null,
      latestJobId: attention.id,
      staleCauses: [],
    };

    const panel = projectWorkspace(project, status, cleanChainStatus()).boardPanels[0]!;
    expect(panel).toMatchObject({
      activity: 'needs_attention',
      recovery: {
        jobId: attention.id,
        canRetry: true,
        canCancel: false,
        canRetryDownload: false,
        submissionUnknown: true,
      },
    });
    expect(Object.keys(panel.recovery ?? {}).toSorted()).toEqual([
      'canCancel',
      'canRetry',
      'canRetryDownload',
      'jobId',
      'submissionUnknown',
    ]);
    expect(JSON.stringify(panel)).not.toContain('provider_secret');
    expect(JSON.stringify(panel)).not.toContain('messageKey');
    expect(projectWorkspace(project, null, null).boardPanels[0]!.recovery).toBeNull();
  });

  it('projects only the no-charge download retry for an exact latest Board download failure', () => {
    const project = makeProject();
    project.boardStyle = 'colour_key';
    const failed = makeJob('job_board_download', 'shot_1', {
      status: 'failed',
      purpose: 'board_still',
      provider: { choiceId: 'route_secret', providerId: 'provider_secret', model: 'model_secret' },
      error: {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
      canRetryDownload: true,
    });
    project.jobs[failed.id] = failed;
    project.shots.shot_1!.jobIds.push(failed.id);
    const status = cleanWorkspaceStatus();
    status.boardPanels[0] = {
      shotId: 'shot_1',
      assetId: null,
      producerJobId: null,
      latestJobId: failed.id,
      staleCauses: [],
    };

    const panel = projectWorkspace(project, status, cleanChainStatus()).boardPanels[0]!;
    expect(panel).toMatchObject({
      freshness: 'missing',
      activity: 'failed',
      recovery: {
        jobId: failed.id,
        canRetry: false,
        canCancel: false,
        canRetryDownload: true,
        submissionUnknown: false,
      },
    });
    expect(JSON.stringify(panel)).not.toContain('provider_secret');
    expect(JSON.stringify(panel)).not.toContain('messageKey');

    failed.error = {
      code: 'provider_unavailable',
      messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
    };
    expect(projectWorkspace(project, status, cleanChainStatus()).boardPanels[0]!.recovery).toBeNull();
  });

  it.each([
    ['queued_local', 'queued'],
    ['submitting', 'queued'],
    ['queued_remote', 'queued'],
    ['running', 'drawing'],
    ['needs_attention', 'needs_attention'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ] as const)('projects latest missing-panel job activity %s as %s', (jobStatus, activity) => {
    const project = makeProject();
    project.boardStyle = 'line_art';
    const job = makeJob(`job_board_${jobStatus}`, 'shot_1', { status: jobStatus, purpose: 'board_still' });
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);
    const status = cleanWorkspaceStatus();
    status.boardPanels[0] = {
      shotId: 'shot_1',
      assetId: null,
      producerJobId: null,
      latestJobId: job.id,
      staleCauses: [],
    };

    expect(projectWorkspace(project, status, null).boardPanels[0]).toMatchObject({
      assetId: null,
      freshness: 'missing',
      activity,
    });
  });

  it('fails Board status closed on a revision race or non-film-order rows without affecting video readiness', () => {
    const project = makeProject();
    const staleRevision = cleanWorkspaceStatus(2);
    const reordered = cleanWorkspaceStatus();
    reordered.boardPanels = [reordered.boardPanels[1]!, reordered.boardPanels[0]!, reordered.boardPanels[2]!];

    const revisionPending = projectWorkspace(project, staleRevision, cleanChainStatus());
    const orderPending = projectWorkspace(project, reordered, cleanChainStatus());

    expect(revisionPending.boardPanels.every((panel) => panel.freshness === 'status_pending')).toBe(true);
    expect(orderPending.boardPanels.every((panel) => panel.activity === 'status_pending')).toBe(true);
    expect(orderPending.activeBeats[0]!.shots[0]!.segmentState).not.toEqual({ kind: 'status_pending' });
  });

  it('fails a forged Board producer route status closed while preserving its locally valid image', () => {
    const project = makeProject();
    project.boardStyle = 'colour_key';
    const producer = addCurrentBoardPanel(project, 'shot_1');
    const status = cleanWorkspaceStatus();
    status.boardPanels[0] = {
      shotId: 'shot_1',
      assetId: 'board_shot_1',
      producerJobId: producer.id,
      latestJobId: producer.id,
      staleCauses: ['route_out_of_date'],
    };

    expect(projectWorkspace(project, status, cleanChainStatus()).boardPanels[0]).toMatchObject({
      assetId: 'board_shot_1',
      freshness: 'status_pending',
      activity: 'status_pending',
    });
  });

  it('projects one current picture plus its current-first take history without rendered-count facts', () => {
    const project = makeProject();
    const superseded = makeAsset('video_superseded', 'shot_1', 'video', 'assets', '2026-08-19T01:00:00.000Z', 9);
    project.assets[superseded.id] = superseded;
    project.shots.shot_1!.assetIds.push(superseded.id);
    addCurrentVideo(project, 'shot_1', 'video_current', 10);
    const currentJob = makeJob('job_video_current', 'shot_1', {
      outputAssetIds: ['video_current'],
      outputAssetIdsByRole: { primary: 'video_current', poster: null },
      composition: {
        inputs: {
          schemaVersion: 1,
          projectRevision: project.revision,
          brief: project.brief,
          rules: project.rules,
          source: {
            kind: 'shot',
            beatId: 'beat_1',
            story: project.beats.beat_1!.story,
            shotId: 'shot_1',
            shootingScript: 'First',
          },
          purpose: 'video_take',
          referenceInputs: [],
          aspectRatio: project.aspectRatio,
          resolution: project.resolution,
          route: {
            providerId: 'provider_safe',
            adapterId: 'openrouter-video-v1',
            model: 'model_safe',
          },
          boardStyle: null,
          instructionProfile: 'openrouter-video-v1.video-take.v1',
        },
        prompt: 'System instructions\nPROJECT: A launch film.\nOUTPUT: First',
      },
    });
    project.jobs[currentJob.id] = currentJob;
    project.shots.shot_1!.jobIds.push(currentJob.id);

    const cleanShot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(cleanShot.currentPicture).toMatchObject({ prompt: 'First', promptChanged: false });
    expect(cleanShot.videoTakes).toMatchObject([{ assetId: 'video_current', prompt: 'First', promptChanged: false }]);

    project.shots.shot_1!.shootingScript = 'Edited after the take fired';

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;

    expect(shot).toEqual(
      expect.objectContaining({
        currentPicture: expect.objectContaining({
          assetId: 'video_current',
          posterAssetId: null,
          prompt: 'First',
          promptChanged: true,
          sourceDurationSeconds: 10,
        }),
        displayState: 'rendered',
        segmentState: { kind: 'rendered' },
      })
    );
    expect(shot.videoTakes).toMatchObject([
      { assetId: 'video_current', current: true, prompt: 'First', promptChanged: true },
    ]);
    expect(shot).not.toHaveProperty('takeCount');
  });

  it('judges each retained video take against the Shot script frozen by its own producer', () => {
    const project = makeProject();
    const retained = makeAsset('video_retained', 'shot_1', 'video', 'assets', '2026-08-19T01:00:00.000Z', 9);
    project.assets[retained.id] = retained;
    project.shots.shot_1!.assetIds.push(retained.id);
    project.shots.shot_1!.supersededVideoAssetIds = [retained.id];
    const retainedJob = makeJob('job_video_retained', 'shot_1', {
      outputAssetIds: [retained.id],
      outputAssetIdsByRole: { primary: retained.id, poster: null },
      composition: {
        inputs: {
          schemaVersion: 1,
          projectRevision: project.revision,
          brief: project.brief,
          rules: project.rules,
          source: {
            kind: 'shot',
            beatId: 'beat_1',
            story: project.beats.beat_1!.story,
            shotId: 'shot_1',
            shootingScript: 'Earlier version of the Shot',
          },
          purpose: 'video_take',
          referenceInputs: [],
          aspectRatio: project.aspectRatio,
          resolution: project.resolution,
          route: {
            providerId: 'provider_safe',
            adapterId: 'openrouter-video-v1',
            model: 'model_safe',
          },
          boardStyle: null,
          instructionProfile: 'openrouter-video-v1.video-take.v1',
        },
        prompt: 'System instructions\nPROJECT: A launch film.\nOUTPUT: Earlier version of the Shot',
      },
    });
    project.jobs[retainedJob.id] = retainedJob;
    project.shots.shot_1!.jobIds.push(retainedJob.id);

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.videoTakes).toMatchObject([
      {
        assetId: retained.id,
        current: false,
        prompt: 'Earlier version of the Shot',
        promptChanged: true,
      },
    ]);
  });

  it('reads only own asset keys when projecting the current picture', () => {
    const project = makeProject();
    const inherited = makeAsset('video_inherited', 'shot_1', 'video');
    project.assets = Object.assign(Object.create({ video_inherited: inherited }), project.assets);
    project.shots.shot_1!.assetIds.push(inherited.id);
    project.shots.shot_1!.videoAssetId = inherited.id;

    const result = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus());

    expect(result.activeBeats[0]!.shots[0]!.currentPicture).toBeNull();
  });

  it('preserves canonical Beat and Shot Bin order with exact 1-based positions', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = ['shot_1'];
    project.bin = [
      { kind: 'beat', beatId: 'beat_parked', reason: 'alternate' },
      { kind: 'shot', beatId: 'beat_1', shotId: 'shot_2', reason: 'lifted' },
    ];

    const result = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus());

    expect(result.bin.items).toMatchObject([
      {
        kind: 'beat',
        position: 1,
        identity: { kind: 'beat', beatId: 'beat_parked', reason: 'alternate' },
      },
      {
        kind: 'shot',
        position: 2,
        identity: { kind: 'shot', beatId: 'beat_1', shotId: 'shot_2', reason: 'lifted' },
      },
    ]);
    expect(result.bin.beats).toHaveLength(1);
    expect(result.bin.shots).toHaveLength(1);
    expect(result.bin).not.toHaveProperty('takes');
  });

  it('keeps a binned Shot current picture, seed stills, and retained-work facts', () => {
    const project = makeProject();
    project.bin = [{ kind: 'beat', beatId: 'beat_parked', reason: 'lifted' }];
    addSeed(project, 'shot_parked', 'seed_parked');
    addCurrentVideo(project, 'shot_parked', 'video_parked', 7);

    const result = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus());
    const shot = result.bin.beats[0]!.shots[0]!;

    expect(shot).toMatchObject({
      currentPicture: {
        assetId: 'video_parked',
        posterAssetId: null,
        sourceDurationSeconds: 7,
      },
      retainedWork: true,
      seedStills: [{ assetId: 'seed_parked', effectiveSeed: true }],
    });
  });

  it('orders seed stills newest-first and projects current-first retained take history', () => {
    const project = makeProject();
    const older = makeAsset('seed_older', 'shot_1', 'image', 'assets', '2026-08-19T00:00:00.000Z');
    const newer = makeAsset('seed_newer', 'shot_1', 'image', 'imports', '2026-08-19T02:00:00.000Z');
    const superseded = makeAsset('video_old', 'shot_1', 'video', 'assets', '2026-08-19T01:00:00.000Z', 8);
    for (const asset of [older, newer, superseded]) {
      project.assets[asset.id] = asset;
      project.shots.shot_1!.assetIds.push(asset.id);
    }
    project.shots.shot_1!.seedStillId = older.id;
    project.shots.shot_1!.supersededVideoAssetIds = [superseded.id];
    addCurrentVideo(project, 'shot_1', 'video_current', 10);

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;

    expect(shot.seedStills).toMatchObject([
      { assetId: 'seed_newer', explicitSeed: false, effectiveSeed: false },
      { assetId: 'seed_older', explicitSeed: true, effectiveSeed: true },
    ]);
    expect(shot.currentPicture).toMatchObject({ assetId: 'video_current', sourceDurationSeconds: 10 });
    expect(shot.videoTakes).toMatchObject([
      { assetId: 'video_current', current: true },
      { assetId: 'video_old', current: false },
    ]);
  });

  it('keeps dismissed seed media retained while excluding it from the strip and automatic current choice', () => {
    const project = makeProject();
    const older = makeAsset('seed_retained', 'shot_1', 'image', 'assets', '2026-08-19T01:00:00.000Z');
    const dismissed = makeAsset('seed_dismissed', 'shot_1', 'image', 'imports', '2026-08-19T02:00:00.000Z');
    for (const asset of [older, dismissed]) {
      project.assets[asset.id] = asset;
      project.shots.shot_1!.assetIds.push(asset.id);
    }
    project.shots.shot_1!.dismissedSeedStillIds = [dismissed.id];

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;

    expect(shot.firstFrames).toMatchObject([{ assetId: older.id, effectiveSeed: true }]);
    expect(project.assets[dismissed.id]).toBe(dismissed);
    expect(project.shots.shot_1!.assetIds).toContain(dismissed.id);
  });

  it('projects a stale inherited boundary frame as the effective first frame without inventing a pin', () => {
    const project = makeProject();
    const inherited = makeAsset('frame_from_shot_1', 'shot_1', 'image', 'conditioningFrames');
    project.assets[inherited.id] = inherited;
    project.shots.shot_1!.assetIds.push(inherited.id);
    const chain = cleanChainStatus();
    chain.boundaries[0] = {
      upstreamShotId: 'shot_1',
      dependentShotId: 'shot_2',
      status: 'on_disk',
      frameAssetId: inherited.id,
    };

    const shot = projectWorkspace(project, workspaceStatus(), chain).activeBeats[0]!.shots[1]!;

    expect(shot.firstFrames).toMatchObject([
      {
        assetId: inherited.id,
        effectiveSeed: true,
        explicitSeed: false,
        firstFrameChanged: true,
        origin: 'inherited',
        sourceShotNumber: 1,
      },
    ]);
  });

  it('keeps a newer imported first frame visible but non-current while exact authorized seed work is waiting', () => {
    const project = makeProject();
    project.shots.shot_2!.chainBreak = 'hard_cut';
    const authorized = makeAsset('seed_authorized', 'shot_2', 'image', 'assets', '2026-08-19T01:00:00.000Z');
    const imported = makeAsset('seed_imported', 'shot_2', 'image', 'imports', '2026-08-19T02:00:00.000Z');
    for (const asset of [authorized, imported]) {
      project.assets[asset.id] = asset;
      project.shots.shot_2!.assetIds.push(asset.id);
    }
    const status: StudioRendererWorkspaceStatusV2 = {
      ...cleanWorkspaceStatus(),
      cascadeProgress: [
        {
          dependentShotId: 'shot_2',
          upstreamShotId: 'shot_2',
          eligiblePrimaryAssetIds: [authorized.id],
          canRetryConditioningFrame: false,
          canCancelWaiting: true,
          waitingReason: 'choose_seed',
        },
      ],
    };
    const chain: StudioRendererChainStatusV2 = { ...cleanChainStatus(), boundaries: [] };

    for (const [projectInput, statusInput, chainInput] of [
      [project, status, chain],
      [structuredClone(project), structuredClone(status), structuredClone(chain)],
    ] as const) {
      const shot = projectWorkspace(projectInput, statusInput, chainInput).activeBeats[0]!.shots[1]!;

      expect(shot).toMatchObject({
        effectiveSeedAssetId: null,
        hasEffectiveSeed: false,
        seedAuthorityStatusReady: true,
        seedAuthorizationLock: {
          compatibleAssetIds: [authorized.id],
          canCancelWaiting: true,
          waitingReason: 'choose_seed',
        },
      });
      expect(shot.seedStills).toMatchObject([
        { assetId: imported.id, createdAt: imported.createdAt, explicitSeed: false, effectiveSeed: false },
        { assetId: authorized.id, createdAt: authorized.createdAt, explicitSeed: false, effectiveSeed: false },
      ]);
    }
  });

  it('fails seed controls closed when duplicate cascade authority makes the lock ambiguous', () => {
    const project = makeProject();
    project.shots.shot_2!.chainBreak = 'hard_cut';
    addSeed(project, 'shot_2', 'seed_imported');
    const row: StudioCascadeProgressV2 = {
      dependentShotId: 'shot_2',
      upstreamShotId: 'shot_2',
      eligiblePrimaryAssetIds: [],
      canRetryConditioningFrame: false,
      canCancelWaiting: true,
      waitingReason: 'upstream_running',
    };
    const status = { ...cleanWorkspaceStatus(), cascadeProgress: [row, { ...row }] };
    const shot = projectWorkspace(project, status, { ...cleanChainStatus(), boundaries: [] }).activeBeats[0]!.shots[1]!;

    expect(shot).toMatchObject({
      effectiveSeedAssetId: null,
      hasEffectiveSeed: false,
      seedAuthorityStatusReady: false,
      seedAuthorizationLock: null,
    });
    expect(shot.seedStills).toEqual([expect.objectContaining({ assetId: 'seed_imported', effectiveSeed: false })]);
  });

  it('keeps reference outputs and jobs out of Shot seed, activity, and recovery state', () => {
    const project = makeProject();
    const shot = project.shots.shot_1!;
    const referenceAsset = makeAsset('reference_background', null, 'image', 'assets', '2026-08-19T03:00:00.000Z');
    referenceAsset.projectReferenceId = 'ref_background';
    project.assets[referenceAsset.id] = referenceAsset;
    shot.assetIds.push(referenceAsset.id);
    shot.seedStillId = referenceAsset.id;

    const succeeded = makeJob('job_reference_succeeded', shot.id, {
      purpose: 'reference_image',
      target: { kind: 'reference', referenceId: 'ref_background' },
      outputAssetIds: [referenceAsset.id],
      outputAssetIdsByRole: { primary: referenceAsset.id, poster: null },
    });
    const running = makeJob('job_reference_running', shot.id, {
      purpose: 'reference_image',
      target: { kind: 'reference', referenceId: 'ref_background' },
      status: 'running',
    });
    const attention = makeJob('job_reference_attention', shot.id, {
      purpose: 'reference_image',
      target: { kind: 'reference', referenceId: 'ref_background' },
      status: 'needs_attention',
      error: { code: 'submission_unknown', messageKey: 'submissionUnknown' },
      canRetry: true,
    });
    for (const job of [succeeded, running, attention]) {
      project.jobs[job.id] = job;
      shot.jobIds.push(job.id);
    }

    const projected = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;

    expect(projected).toMatchObject({
      explicitSeedAssetId: null,
      effectiveSeedAssetId: null,
      seedStills: [],
      displayState: 'draft',
      retainedWork: false,
      seedGenerationInFlight: false,
      seedGenerationBlocked: false,
      attentionJobs: [],
      hasEffectiveSeed: false,
    });
  });

  it('admits only an explicitly pinned Board panel into the first-frame choices and never into fallback', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addCurrentBoardPanel(project, 'shot_1');
    addCurrentBoardPanel(project, 'shot_2');

    const beforePromotion = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(beforePromotion.shots[0]).toMatchObject({
      explicitSeedAssetId: null,
      effectiveSeedAssetId: null,
      seedStills: [],
    });
    expect(beforePromotion.shots[1]!.seedStills).toEqual([]);

    project.shots.shot_1!.seedStillId = 'board_shot_1';
    const afterPromotion = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(afterPromotion.shots[0]).toMatchObject({
      explicitSeedAssetId: 'board_shot_1',
      effectiveSeedAssetId: 'board_shot_1',
      hasEffectiveSeed: true,
      seedStills: [
        {
          assetId: 'board_shot_1',
          explicitSeed: true,
          effectiveSeed: true,
        },
      ],
    });
    expect(afterPromotion.shots[1]!.seedStills).toEqual([]);
  });

  it('uses one exact succeeded current-picture poster and rejects a cross-owned video', () => {
    const project = makeProject();
    addSeed(project, 'shot_1');
    addCurrentVideo(project, 'shot_1', 'video_current', 6);
    const poster = makeAsset('poster_current', 'shot_1', 'image', 'thumbnails');
    project.assets[poster.id] = poster;
    project.shots.shot_1!.assetIds.push(poster.id);
    const job = makeJob('job_current', 'shot_1', {
      outputAssetIds: ['video_current', poster.id],
      outputAssetIdsByRole: { primary: 'video_current', poster: poster.id },
    });
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);

    project.shots.shot_2!.videoAssetId = 'video_current';
    project.shots.shot_2!.assetIds.push('video_current');

    const result = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus());

    expect(result.activeBeats[0]!.shots[0]!.currentPicture).toMatchObject({
      assetId: 'video_current',
      posterAssetId: 'poster_current',
    });
    expect(result.activeBeats[0]!.shots[1]!.currentPicture).toBeNull();
  });

  it('treats missing producing-script authority as unknown rather than evidence of an edit', () => {
    const project = makeProject();
    addCurrentVideo(project, 'shot_1', 'video_without_source', 6);
    const job = makeJob('job_without_source', 'shot_1', {
      outputAssetIds: ['video_without_source'],
      outputAssetIdsByRole: { primary: 'video_without_source', poster: null },
    });
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.currentPicture).toMatchObject({ prompt: 'First', promptChanged: false });
    expect(shot.videoTakes).toMatchObject([{ prompt: 'First', promptChanged: false }]);
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

  it('sums exact played duration from the current picture and trims instead of planning duration', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.beats.beat_1!.shotOrder = ['shot_1'];
    project.shots.shot_1!.durationSeconds = 8;
    project.shots.shot_1!.trimInSeconds = 1;
    project.shots.shot_1!.trimOutSeconds = 2;
    addSeed(project, 'shot_1');
    addCurrentVideo(project, 'shot_1', 'video_10s', 10);

    const beat = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;

    expect(beat).toMatchObject({ targetSeconds: 8, actualSeconds: 7, displayState: 'ready' });
    expect(beat.actualSeconds).not.toBe(project.shots.shot_1!.durationSeconds);
    expect(beat.shots[0]).toMatchObject({
      durationSeconds: 8,
      trimInSeconds: 1,
      trimOutSeconds: 2,
      currentPicture: {
        assetId: 'video_10s',
        posterAssetId: null,
        sourceDurationSeconds: 10,
      },
      playedDurationSeconds: 7,
      planningBoundary: { shotId: 'shot_1', startSeconds: 0, endSeconds: 8 },
    });

    project.assets.video_10s!.durationSeconds = Number.NaN;
    const unresolved = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!;
    expect(unresolved.actualSeconds).toBeNull();
    expect(unresolved.shots[0]).toMatchObject({
      currentPicture: null,
      playedDurationSeconds: null,
      displayState: 'seed_ready',
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
    expect(shots[1]!.seedStills).toHaveLength(1);
    expect(shots[1]!.seedStills[0]).toMatchObject({ effectiveSeed: false });
  });

  it('projects Story and Shooting script without retired derivation metadata', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.beats.beat_1!.story = 'Ming reaches the night market.';
    project.shots.shot_2!.shootingScript = 'Wide shot of Ming under the red awning.';

    const beat = projectWorkspace(project, null, null).activeBeats[0]!;

    expect(beat.story).toBe('Ming reaches the night market.');
    expect(beat.shots[1]!.shootingScript).toBe('Wide shot of Ming under the red awning.');
    expect(JSON.stringify(beat)).not.toMatch(/actionRevision|lineHistory|derivation/);
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

  it.each(['choose_seed', 'conditioning_failed', 'dependency_failed', 'cancelled'] as const)(
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

  it('projects only exact owned attention-job recovery capabilities without provider authority', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.jobIds.push('job_retry', 'job_cancel');
    project.jobs.job_retry = makeJob('job_retry', 'shot_1', {
      status: 'needs_attention',
      purpose: 'video_take',
      error: {
        code: 'submission_unknown',
        messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
      },
      canRetry: true,
    });
    project.jobs.job_cancel = makeJob('job_cancel', 'shot_1', {
      status: 'needs_attention',
      purpose: 'seed_still',
      error: {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
      canCancel: true,
      canRetry: true,
    });
    project.jobs.forged = makeJob('forged', 'shot_1', { status: 'needs_attention', canRetry: true });

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.attentionJobs).toEqual([
      {
        id: 'job_retry',
        purpose: 'video_take',
        error: {
          code: 'submission_unknown',
          messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
        },
        canCancel: false,
        canRetry: true,
      },
      {
        id: 'job_cancel',
        purpose: 'seed_still',
        error: {
          code: 'provider_unavailable',
          messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
        },
        canCancel: true,
        canRetry: true,
      },
    ]);
    expect(JSON.stringify(shot.attentionJobs)).not.toContain('providerJobId');
  });

  it('projects a terminal content refusal as actionable copy without retry authority', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.jobIds.push('job_content_refused');
    project.jobs.job_content_refused = makeJob('job_content_refused', 'shot_1', {
      status: 'failed',
      purpose: 'video_take',
      error: {
        code: 'content_rejected',
        messageKey: 'conversation.creativeStudio.jobs.errors.contentRejected',
      },
      canCancel: false,
      canRetry: false,
    });

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.attentionJobs).toEqual([
      {
        id: 'job_content_refused',
        purpose: 'video_take',
        error: {
          code: 'content_rejected',
          messageKey: 'conversation.creativeStudio.jobs.errors.contentRejected',
        },
        canCancel: false,
        canRetry: false,
      },
    ]);
  });

  it('keeps Board failures out of the legacy first-frame and video recovery surface', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.jobIds.push('job_board_attention');
    project.jobs.job_board_attention = makeJob('job_board_attention', 'shot_1', {
      status: 'needs_attention',
      purpose: 'board_still',
      error: {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
      canRetry: true,
    });

    const shot = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.attentionJobs).toEqual([]);
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

    addCurrentVideo(project, 'shot_1');
    addCurrentVideo(project, 'shot_2');
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

  it('projects trim-aware film timing, a safe audio bed fade, and active cover candidates', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = ['shot_1'];
    project.shots.shot_1!.trimInSeconds = 1;
    project.shots.shot_1!.trimOutSeconds = 2;
    addCurrentVideo(project, 'shot_1', 'video_10s', 10);
    project.beats.beat_2!.shotOrder = [];
    project.beats.beat_2!.targetSeconds = 4;
    const bed = makeAsset('audio_bed', null, 'audio', 'imports', '2026-08-19T02:00:00.000Z', 14);
    const alternate = makeAsset('audio_old', null, 'audio', 'imports', '2026-08-19T01:00:00.000Z', 12);
    project.assets[bed.id] = bed;
    project.assets[alternate.id] = alternate;
    project.bedAssetId = bed.id;

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
    });
    expect(cut.audioImports.map(({ assetId, position }) => ({ assetId, position }))).toEqual([
      { assetId: 'audio_bed', position: 1 },
      { assetId: 'audio_old', position: 2 },
    ]);
    expect(cut.coverCandidates).toMatchObject([
      { shotId: 'shot_1', beatId: 'beat_1', beatTitle: 'Opening', shootingScript: 'First' },
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

  it('projects revision-matched frame boundaries onto only their exact dependent Shot', () => {
    const project = makeProject();
    const current = projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus());
    expect(current.activeBeats[0]!.shots.map((shot) => [shot.id, shot.frameBoundary])).toEqual([
      ['shot_1', null],
      [
        'shot_2',
        {
          upstreamShotId: 'shot_1',
          dependentShotId: 'shot_2',
          status: 'empty',
          frameAssetId: null,
        },
      ],
    ]);

    const poisoned = cleanChainStatus();
    poisoned.boundaries.push({
      upstreamShotId: 'shot_3',
      dependentShotId: 'shot_2',
      status: 'on_disk',
      frameAssetId: 'forged_frame',
    });
    expect(
      projectWorkspace(project, cleanWorkspaceStatus(), poisoned).activeBeats[0]!.shots[1]!.frameBoundary
    ).toBeNull();
    expect(
      projectWorkspace(project, cleanWorkspaceStatus(), cleanChainStatus(2)).activeBeats[0]!.shots[1]!
    ).toMatchObject({ frameBoundary: null, segmentState: { kind: 'status_pending' } });
  });

  it('derives queued and provider-progress rendering only from the exact current video-job wave', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    addSeed(project, 'shot_1');
    project.shots.shot_1!.jobIds.push('job_old_failure', 'job_current');
    project.jobs.job_old_failure = makeJob('job_old_failure', 'shot_1', {
      status: 'failed',
      error: { code: 'provider_error', messageKey: 'provider_error' },
    });
    project.jobs.job_current = makeJob('job_current', 'shot_1', { status: 'queued_remote' });
    const status = cleanWorkspaceStatus();
    status.currentVideoJobs.find((row) => row.shotId === 'shot_1')!.jobIds = ['job_current'];

    let shot = projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.segmentState).toEqual({ kind: 'queued' });

    project.jobs.job_current!.status = 'running';
    project.jobs.job_current!.progress = 40;
    shot = projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!;
    expect(shot.segmentState).toEqual({ kind: 'rendering', progressPercent: 40, showingStill: false });

    project.jobs.job_current!.progress = undefined;
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'rendering',
      progressPercent: null,
      showingStill: false,
    });
  });

  it('keeps a continuous waiting job on the exact frame boundary and fails missing authority closed', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_2!.jobIds.push('job_waiting_frame');
    project.jobs.job_waiting_frame = makeJob('job_waiting_frame', 'shot_2', {
      status: 'waiting_for_conditioning',
    });
    const status = cleanWorkspaceStatus();
    status.currentVideoJobs.find((row) => row.shotId === 'shot_2')!.jobIds = ['job_waiting_frame'];

    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[1]!.segmentState).toEqual({
      kind: 'waiting_on_frame',
    });

    const missing = cleanChainStatus();
    missing.boundaries = [];
    expect(projectWorkspace(project, status, missing).activeBeats[0]!.shots[1]!.segmentState).toEqual({
      kind: 'status_pending',
    });

    const frame = makeAsset('frame_ready', 'shot_1', 'image', 'conditioningFrames');
    project.assets[frame.id] = frame;
    project.shots.shot_1!.assetIds.push(frame.id);
    const ready = cleanChainStatus();
    ready.boundaries = [
      {
        upstreamShotId: 'shot_1',
        dependentShotId: 'shot_2',
        status: 'on_disk',
        frameAssetId: frame.id,
      },
    ];
    expect(projectWorkspace(project, status, ready).activeBeats[0]!.shots[1]!.segmentState).toEqual({
      kind: 'queued',
    });
  });

  it('reports live current-wave siblings ahead of a terminal sibling failure', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_1!.jobIds.push('job_failed_sibling', 'job_live_sibling');
    project.jobs.job_failed_sibling = makeJob('job_failed_sibling', 'shot_1', {
      status: 'failed',
      error: { code: 'provider_error', messageKey: 'provider_error' },
    });
    project.jobs.job_live_sibling = makeJob('job_live_sibling', 'shot_1', { status: 'running', progress: 40 });
    const status = cleanWorkspaceStatus();
    status.currentVideoJobs.find((row) => row.shotId === 'shot_1')!.jobIds = ['job_failed_sibling', 'job_live_sibling'];

    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'rendering',
      progressPercent: 40,
      showingStill: false,
    });

    project.jobs.job_live_sibling!.status = 'queued_remote';
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'queued',
    });
  });

  it('gives exact cascade barriers precedence and resolves only a preceding Shot number', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    project.shots.shot_2!.jobIds.push('job_waiting');
    project.jobs.job_waiting = makeJob('job_waiting', 'shot_2', { status: 'waiting_for_conditioning' });
    const status = cleanWorkspaceStatus();
    status.currentVideoJobs.find((row) => row.shotId === 'shot_2')!.jobIds = ['job_waiting'];

    status.cascadeProgress = [cascadeRow('upstream_running')];
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[1]!.segmentState).toEqual({
      kind: 'waiting_on_shot',
      upstreamShotNumber: 1,
    });

    status.cascadeProgress = [cascadeRow('conditioning_frame')];
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[1]!.segmentState).toEqual({
      kind: 'waiting_on_frame',
    });

    status.cascadeProgress = [cascadeRow('dependency_failed')];
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[1]!.segmentState).toEqual({
      kind: 'never_dispatched',
    });
  });

  it('does not call a provider-submitted cancellation never dispatched', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    const cancelled = makeJob('job_cancelled_remote', 'shot_1', { status: 'cancelled' });
    project.jobs[cancelled.id] = cancelled;
    project.shots.shot_1!.jobIds.push(cancelled.id);
    const status = cleanWorkspaceStatus();
    status.currentVideoJobs.find((row) => row.shotId === 'shot_1')!.jobIds = [cancelled.id];

    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'no_picture',
    });
  });

  it('projects current failures, dirty playable work, and the rendered-picture fact in fail-closed precedence', () => {
    const project = makeProject();
    project.beatOrder = ['beat_1'];
    const failed = makeJob('job_failed_current', 'shot_1', {
      status: 'failed',
      error: { code: 'provider_error', messageKey: 'provider_error' },
      spendReceipt: null,
    });
    project.jobs[failed.id] = failed;
    project.shots.shot_1!.jobIds.push(failed.id);
    const status = cleanWorkspaceStatus();
    status.currentVideoJobs.find((row) => row.shotId === 'shot_1')!.jobIds = [failed.id];

    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'failed_unbilled',
    });

    failed.status = 'needs_attention';
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'needs_attention',
    });

    failed.status = 'succeeded';
    failed.error = null;
    const superseded = makeAsset('video_old', 'shot_1', 'video', 'assets', '2026-08-19T01:00:00.000Z');
    const current = makeAsset('video_current', 'shot_1', 'video', 'assets', '2026-08-19T02:00:00.000Z');
    Object.assign(project.assets, { [superseded.id]: superseded, [current.id]: current });
    project.shots.shot_1!.assetIds.push(superseded.id, current.id);
    project.shots.shot_1!.supersededVideoAssetIds = [superseded.id];
    project.shots.shot_1!.videoAssetId = current.id;
    const previousJob = makeJob('job_previous_current', 'shot_1', {
      status: 'succeeded',
      outputAssetIds: [superseded.id],
      outputAssetIdsByRole: { primary: superseded.id, poster: null },
    });
    project.jobs[previousJob.id] = previousJob;
    project.shots.shot_1!.jobIds.push(previousJob.id);
    failed.outputAssetIds = [current.id];
    failed.outputAssetIdsByRole.primary = current.id;
    status.currentVideoJobs.find((row) => row.shotId === 'shot_1')!.jobIds = [previousJob.id, failed.id];
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'rendered',
    });

    status.currentVideoJobs.find((row) => row.shotId === 'shot_1')!.jobIds = [failed.id];
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'rendered',
    });

    status.dirtyShots = [{ shotId: 'shot_1', causes: ['generation_out_of_date'] }];
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'needs_rerender',
    });
    status.dirtyShots = [{ shotId: 'shot_1', causes: ['generation_out_of_date', 'continuity_stale'] }];
    expect(projectWorkspace(project, status, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'stale',
    });
  });

  it('fails a missing or duplicate current-wave row to status pending instead of trusting historical jobs', () => {
    const project = makeProject();
    const missing = cleanWorkspaceStatus();
    missing.currentVideoJobs = missing.currentVideoJobs.filter((row) => row.shotId !== 'shot_1');
    expect(projectWorkspace(project, missing, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'status_pending',
    });

    const duplicate = cleanWorkspaceStatus();
    duplicate.currentVideoJobs.push({ shotId: 'shot_1', jobIds: [] });
    expect(projectWorkspace(project, duplicate, cleanChainStatus()).activeBeats[0]!.shots[0]!.segmentState).toEqual({
      kind: 'status_pending',
    });
  });

  it('fails Cut bed, duration, and order facts closed while admitting canonical audio imports', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.beats.beat_1!.targetSeconds = 8;
    project.beats.beat_2!.shotOrder = [];
    project.beats.beat_2!.targetSeconds = 4;
    const shortBed = makeAsset('audio_short', null, 'audio', 'imports', '2026-08-19T02:00:00.000Z', 10);
    const classified = makeAsset('audio_classified', null, 'audio', 'imports', '2026-08-19T03:00:00.000Z', 20);
    project.assets[shortBed.id] = shortBed;
    project.assets[classified.id] = classified;
    project.bedAssetId = shortBed.id;

    let cut = projectWorkspace(project, null, null).cut;
    expect(cut.audioImports.map((asset) => asset.assetId)).toEqual(['audio_classified', 'audio_short']);
    expect(cut.bed).toEqual({
      status: 'too_short',
      assetId: 'audio_short',
      sourceDurationSeconds: 10,
      requiredDurationSeconds: 12,
    });
    project.beats.beat_2!.targetSeconds = null;
    cut = projectWorkspace(project, null, null).cut;
    expect(cut.filmDurationSeconds).toBeNull();
    expect(cut.bed).toMatchObject({ status: 'duration_pending', assetId: 'audio_short' });

    project.bedAssetId = 'missing_audio';
    cut = projectWorkspace(project, null, null).cut;
    expect(cut.bed).toEqual({ status: 'invalid', assetId: 'missing_audio' });

    project.beatOrder = ['beat_1', 'beat_1'];
    cut = projectWorkspace(project, null, null).cut;
    expect(cut).toMatchObject({ orderReady: false, filmDurationSeconds: null, coverCandidates: [] });
  });
});

describe('useWorkspaceDrafts', () => {
  const storageKey = 'aionui:creative-studio:v3:workspace-drafts:project_1';

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
      first.result.current.setValue('gate.choices', '{"shot_1:seed_still":{"purpose":"seed_still"}}');
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
        version: 3,
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
    const customStorageKey = `aionui:creative-studio:v3:workspace-drafts:${projectId}`;
    window.localStorage.setItem(
      customStorageKey,
      JSON.stringify({
        version: 3,
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
    const corruptStorageKey = `aionui:creative-studio:v3:workspace-drafts:${projectId}`;
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
    const keys = Array.from({ length: 1_025 }, (_, index) => `shot.shot_${index}.shootingScript`);
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
    const keys = Array.from({ length: 140 }, (_, index) => `shot.shot_${index}.shootingScript`);
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

  it('round-trips a schema-5 maximum-length Shooting script and rejects only an oversized script', async () => {
    const projectId = 'project_long_script';
    const shootingScriptKey = 'shot.shot_1.shootingScript';
    const maximumScript = 'x'.repeat(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH);
    const input = {
      projectId,
      projectRevision: 3,
      canonicalValues: { [shootingScriptKey]: '' },
      activeBeatIds: ['beat_1'],
      activeShotIds: ['shot_1'],
    };
    const first = renderHook(() => useWorkspaceDrafts(input));
    act(() => first.result.current.setValue(shootingScriptKey, maximumScript));
    expect(first.result.current.value(shootingScriptKey)).toBe(maximumScript);
    await waitFor(() =>
      expect(window.sessionStorage.getItem(`aionui:creative-studio:v3:workspace-drafts:${projectId}`)).toContain(
        maximumScript
      )
    );

    first.unmount();
    const second = renderHook(() => useWorkspaceDrafts(input));
    expect(second.result.current.value(shootingScriptKey)).toBe(maximumScript);
    act(() => second.result.current.setValue(shootingScriptKey, `${maximumScript}x`));
    expect(second.result.current.value(shootingScriptKey)).toBe(maximumScript);
  });

  it('treats every Beat and Shot draft namespace as generation-affecting', () => {
    expect(hasGenerationAffectingWorkspaceDrafts(['beat.beat_1.story'])).toBe(true);
    expect(hasGenerationAffectingWorkspaceDrafts(['shot.shot_1.trimOutSeconds'])).toBe(true);
    expect(hasGenerationAffectingWorkspaceDrafts(['shot.shot_1.shootingScript'])).toBe(true);
    expect(hasGenerationAffectingWorkspaceDrafts(['settings.name', 'gate.choices'])).toBe(false);
  });

  it.each([
    ['valid', '[{"id":"rule_1","text":"Keep the subject centered"}]'],
    ['malformed', '{not-json'],
  ] as const)(
    'synchronously discards %s retired rules, name, and target drafts without contaminating current state',
    async (_payloadKind, legacyRulesValue) => {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 3,
          projectId: 'project_1',
          sourceRevision: 3,
          entries: {
            'brief.rules': {
              baseValue: '[{"id":"old_rule","text":"Old rule"}]',
              value: legacyRulesValue,
            },
            'settings.name': { baseValue: 'Launch film', value: 'Renamed film' },
            'settings.targetDurationSeconds': { baseValue: 30, value: 45 },
            'brief.text': { baseValue: 'Launch film', value: 'A tighter launch film' },
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
            'settings.targetDurationSeconds': 30,
            'brief.text': 'Launch film',
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
          'brief.text': { baseValue: 'Launch film', value: 'A tighter launch film' },
        },
        dirtyKeys: ['brief.text'],
        dirtyCount: 1,
        conflictKeys: [],
        staleRevision: false,
        legacyGenerationAffecting: false,
        currentGenerationAffecting: true,
      });

      await waitFor(() => {
        const persisted = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '{}') as {
          entries?: Record<string, unknown>;
        };
        expect(persisted.entries).toEqual({
          'brief.text': { baseValue: 'Launch film', value: 'A tighter launch film' },
        });
      });
    }
  );

  it('rejects stored prototype keys, deduplicates active order, and caps runtime selection', () => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 3,
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
