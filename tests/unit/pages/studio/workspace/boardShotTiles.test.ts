/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioProjectStatusBlockerV2,
  StudioProjectStatusRouteCatalogV2,
  StudioProjectStatusShotDetailV2,
  StudioProjectStatusStageIdV2,
  StudioProjectStatusStageV2,
  StudioProjectStatusV2,
  StudioRendererProjectV2,
  StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import {
  createEmptyStudioProjectV2,
  projectStudioChainStatusV2,
  projectStudioStatusV2,
  projectStudioWorkspaceStatusV2,
} from '@/process/services/creative-studio/service/schema2';
import {
  BOARD_SHOT_TILE_MAX_BLOCKERS,
  deriveBoardShotTiles,
} from '@/renderer/pages/studio/components/Workspace/Views/Board/boardShotTiles';
import {
  projectWorkspace,
  type WorkspaceBeatProjection,
  type WorkspaceProjection,
  type WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';
/*
 * Keep the hand-built renderer fixtures below for malformed-boundary coverage. The focused
 * cross-layer test also builds this projection from Main authority so the join cannot drift.
 */
const makeShot = (id: string, overrides: Partial<WorkspaceShotProjection> = {}): WorkspaceShotProjection => ({
  id,
  shootingScript: `Script ${id}`,
  durationSeconds: 4,
  chainBreak: 'none',
  trimInSeconds: null,
  trimOutSeconds: null,
  currentPicture: null,
  playedDurationSeconds: null,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  seedAuthorityStatusReady: true,
  seedAuthorizationLock: null,
  segmentHead: true,
  planningBoundary: { shotId: id, startSeconds: 0, endSeconds: 4 },
  frameBoundary: null,
  segmentState: { kind: 'no_picture' },
  dirtyCauses: [],
  downstreamShotIds: [],
  seedStills: [],
  firstFrames: [],
  generationProgressPercent: null,
  activeGenerationJob: null,
  coverAssetId: null,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  videoGenerationBlocked: false,
  seedGenerationBlocked: false,
  attentionJobs: [],
  latestVideoAttemptFailed: false,
  hasEffectiveSeed: false,
  ...overrides,
});

const makeBeat = (id: string, shots: WorkspaceShotProjection[]): WorkspaceBeatProjection => ({
  id,
  title: `Beat ${id}`,
  story: `Story ${id}`,
  targetSeconds: 8,
  sumSeconds: shots.length === 0 ? null : shots.reduce((total, shot) => total + shot.durationSeconds, 0),
  actualSeconds: null,
  displayState: 'draft',
  shots,
  coverAssetId: shots.find((shot) => shot.coverAssetId !== null)?.coverAssetId ?? null,
  retainedWork: false,
});

const makeProjection = (beats: WorkspaceBeatProjection[]): WorkspaceProjection => ({
  projectId: 'project_1',
  projectRevision: 7,
  activeBeats: beats,
  activeBeatIds: beats.map((beat) => beat.id),
  activeShotIds: beats.flatMap((beat) => beat.shots.map((shot) => shot.id)),
  coverageGapBeatIds: beats.filter((beat) => beat.shots.length === 0).map((beat) => beat.id),
  unscriptedShotIds: [],
  workspaceStatusReady: true,
  chainStatusReady: true,
  requestShapeLocked: false,
  cut: {
    orderReady: true,
    beats: [],
    filmDurationSeconds: null,
    targetDurationSeconds: 30,
    audioImports: [],
    bed: { status: 'none', assetId: null },
    coverCandidates: [],
  },
  bin: { items: [], beats: [], shots: [] },
  undoTop: null,
  boardPanels: [],
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: [],
  conditioningFailures: [],
});

const emptyStages = (projection: WorkspaceProjection): StudioProjectStatusStageV2[] => {
  const currentTakeCount = projection.activeBeats.reduce(
    (count, beat) => count + beat.shots.filter((shot) => shot.currentPicture !== null).length,
    0
  );
  const plannedSeconds = projection.activeBeats.reduce(
    (sum, beat) => sum + beat.shots.reduce((beatSum, shot) => beatSum + shot.durationSeconds, 0),
    0
  );
  return [
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
      state: 'complete',
      summary: {
        stage: 'storyboard',
        beatCount: projection.activeBeatIds.length,
        shotCount: projection.activeShotIds.length,
        authoredShotCount: projection.activeShotIds.length - projection.unscriptedShotIds.length,
        plannedSeconds,
        targetSeconds: 30,
      },
      blockers: [],
    },
    {
      id: 'bindings',
      state: 'complete',
      summary: {
        stage: 'bindings',
        readyShotCount: projection.activeShotIds.length,
        shotCount: projection.activeShotIds.length,
        maxConditioningImages: 3,
      },
      blockers: [],
    },
    {
      id: 'production',
      state:
        currentTakeCount === 0
          ? 'not_started'
          : currentTakeCount === projection.activeShotIds.length && projection.activeShotIds.length > 0
            ? 'complete'
            : 'in_progress',
      summary: {
        stage: 'production',
        currentTakeCount,
        shotCount: projection.activeShotIds.length,
        activeJobCount: 0,
      },
      blockers: [],
    },
    {
      id: 'cut',
      state:
        currentTakeCount === 0
          ? 'not_started'
          : currentTakeCount === projection.activeShotIds.length && projection.activeShotIds.length > 0
            ? 'complete'
            : 'in_progress',
      summary: {
        stage: 'cut',
        currentTakeCount,
        shotCount: projection.activeShotIds.length,
        durationSeconds:
          projection.activeShotIds.length > 0 && currentTakeCount === projection.activeShotIds.length
            ? plannedSeconds
            : null,
        targetSeconds: 30,
        structurallyPlayable:
          projection.activeShotIds.length > 0 && currentTakeCount === projection.activeShotIds.length,
      },
      blockers: [],
    },
  ];
};

const shotDetails = (projection: WorkspaceProjection): StudioProjectStatusShotDetailV2[] =>
  projection.activeBeats.flatMap((beat, beatIndex) =>
    beat.shots.map((shot, shotIndex) => ({
      beatId: beat.id,
      shotId: shot.id,
      beatPosition: beatIndex + 1,
      shotPosition: shotIndex + 1,
      seedStillAssetId: shot.effectiveSeedAssetId,
      videoAssetId: shot.currentPicture?.assetId ?? null,
      latestGenerationJob: null,
      binding: { status: 'ready' as const, selectedCount: 0, limit: 3 },
      conditioning: null,
    }))
  );

const makeStatus = (
  projection: WorkspaceProjection,
  overrides: Partial<StudioProjectStatusV2> = {}
): StudioProjectStatusV2 => ({
  projectId: projection.projectId,
  projectRevision: projection.projectRevision,
  catalogVersion: '0123456789abcdef',
  stages: emptyStages(projection),
  blockerCount: 0,
  advisories: [],
  boards: {
    currentPictureCount: projection.activeBeats.reduce(
      (count, beat) => count + beat.shots.filter((shot) => shot.currentPicture !== null).length,
      0
    ),
    shotCount: projection.activeShotIds.length,
  },
  detail: { shots: shotDetails(projection), references: [] },
  ...overrides,
});

const blocker = (
  cause: StudioProjectStatusBlockerV2['cause'],
  where: StudioProjectStatusBlockerV2['where']
): StudioProjectStatusBlockerV2 => ({
  cause,
  where,
  remedy: { kind: 'owner_only', reason: 'review_project_data' },
});

const withStageBlockers = (
  stages: StudioProjectStatusStageV2[],
  stageId: StudioProjectStatusStageIdV2,
  blockers: StudioProjectStatusBlockerV2[]
): StudioProjectStatusStageV2[] =>
  stages.map((stage) =>
    stage.id === stageId
      ? ({ ...stage, state: blockers.length === 0 ? stage.state : 'blocked', blockers } as StudioProjectStatusStageV2)
      : stage
  );

const makeAuthorityShot = (id: string, shootingScript: string): StudioShot => ({
  id,
  shootingScript,
  durationSeconds: 4,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: { status: 'ready', characterReferenceIds: [], backgroundReferenceId: null },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
});

const readyStatusRoutes = (): StudioProjectStatusRouteCatalogV2 => {
  const route = (kind: 'image' | 'video') => ({
    choiceId: `${kind}_route`,
    providerId: `${kind}_provider`,
    providerName: `${kind} provider`,
    model: `${kind}_model`,
    integrationLabelKey: kind === 'image' ? ('imageApi' as const) : ('openRouterVideo' as const),
    health: 'available' as const,
    kind,
    constraints: {
      aspectRatios: ['16:9' as const],
      resolutions: ['1080p' as const],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: true,
      maxConditioningImages: kind === 'image' ? 3 : 0,
      silentOutput: true,
    },
  });
  const image = route('image');
  const video = route('video');
  return {
    status: 'available',
    catalog: {
      catalogVersion: 'catalog_1',
      image: {
        status: 'ready',
        selected: { choiceId: image.choiceId, providerId: image.providerId, model: image.model },
        selectedRoute: image,
        selectionIssue: null,
        options: [image],
      },
      video: {
        status: 'ready',
        selected: { choiceId: video.choiceId, providerId: video.providerId, model: video.model },
        selectedRoute: video,
        selectionIssue: null,
        options: [video],
      },
    },
  };
};

describe('Board Shot tile projection', () => {
  it('joins Main-derived blank-script authority to only the exact renderer Shot', () => {
    const project = createEmptyStudioProjectV2(
      {
        name: 'Cross-layer blocker',
        brief: 'One blank script and one authored script.',
        aspectRatio: '16:9',
        targetDurationSeconds: 8,
        resolution: '1080p',
      },
      'project_1',
      '2026-08-28T00:00:00.000Z'
    );
    project.imageRouteId = 'image_route';
    project.videoRouteId = 'video_route';
    project.referencePlanStatus = 'planned';
    project.beatOrder = ['beat_1'];
    project.beats.beat_1 = {
      id: 'beat_1',
      title: 'Opening',
      story: 'An exact two-Shot story.',
      targetSeconds: null,
      shotOrder: ['shot_blank', 'shot_authored'],
    };
    project.shots.shot_blank = makeAuthorityShot('shot_blank', ' \n ');
    project.shots.shot_authored = makeAuthorityShot('shot_authored', 'A complete Shooting script.');

    const projection = projectWorkspace(
      project as unknown as StudioRendererProjectV2,
      projectStudioWorkspaceStatusV2(project),
      projectStudioChainStatusV2(project)
    );
    const status = projectStudioStatusV2(project, readyStatusRoutes(), { detail: true });
    const result = deriveBoardShotTiles(projection, status);

    expect(result).not.toBeNull();
    expect(result!.blockerStatusAvailable).toBe(true);
    expect(
      result!.beats[0]!.shots[0]!.blockers.filter((item) => item.value.cause === 'shooting_script_required')
    ).toEqual([
      expect.objectContaining({
        stage: 'storyboard',
        value: expect.objectContaining({
          cause: 'shooting_script_required',
          where: expect.objectContaining({ shotId: 'shot_blank' }),
        }),
      }),
    ]);
    expect(result!.beats[0]!.shots[1]!.blockers).not.toContainEqual(
      expect.objectContaining({ value: expect.objectContaining({ cause: 'shooting_script_required' }) })
    );
  });

  it('derives isolated media, six-word status, chain labels, and Beat counts only from live Shot facts', () => {
    const stalePicture = {
      assetId: 'video_stale',
      posterAssetId: 'poster_stale',
      sourceDurationSeconds: 4,
      createdAt: '2026-08-28T00:00:00.000Z',
      prompt: 'Stale prompt',
      promptChanged: false,
      firstFrameChanged: false,
    };
    const projection = makeProjection([
      makeBeat('beat_1', [
        makeShot('shot_1', {
          currentPicture: stalePicture,
          segmentState: { kind: 'failed_unbilled' },
          dirtyCauses: ['continuity_stale'],
          latestVideoAttemptFailed: true,
          generationProgressPercent: 23,
          activeGenerationJob: { id: 'job_hidden', purpose: 'video_take', canCancel: true },
        }),
        makeShot('shot_2', {
          segmentHead: false,
          currentPicture: { ...stalePicture, assetId: 'video_2', posterAssetId: null },
          videoGenerationInFlight: true,
          seedGenerationInFlight: true,
          latestVideoAttemptFailed: true,
          generationProgressPercent: null,
          activeGenerationJob: null,
        }),
        makeShot('shot_3', {
          chainBreak: 'hard_cut',
          segmentHead: true,
          coverAssetId: 'cover_3',
          hasEffectiveSeed: true,
          effectiveSeedAssetId: 'cover_3',
        }),
        makeShot('shot_4', { chainBreak: 'hard_cut' }),
        makeShot('shot_5', { segmentHead: false, segmentState: { kind: 'queued' } }),
        makeShot('shot_6', { chainBreak: 'hard_cut' }),
      ]),
    ]);
    projection.conditioningFailures = [
      {
        upstreamShotId: 'shot_5',
        dependentShotId: 'shot_6',
        extractionId: null,
        status: 'missing',
        errorCode: null,
      },
    ];

    const result = deriveBoardShotTiles(projection, makeStatus(projection));
    expect(result).not.toBeNull();
    const beat = result!.beats[0]!;
    expect(beat.beat).not.toHaveProperty('targetSeconds');
    expect(projection.activeBeats[0]!.targetSeconds).toBe(8);
    expect(beat.shots.map((shot) => shot.shotId)).toEqual(['shot_1', 'shot_2', 'shot_3', 'shot_4', 'shot_5', 'shot_6']);
    expect(beat.shots.map((shot) => shot.status)).toEqual([
      { word: 'rendered', stale: true, latestAttemptFailed: true },
      { word: 'rendering', stale: false, latestAttemptFailed: false },
      { word: 'ready', stale: false, latestAttemptFailed: false },
      { word: 'notReady', stale: false, latestAttemptFailed: false },
      { word: 'queued', stale: false, latestAttemptFailed: false },
      { word: 'failed', stale: false, latestAttemptFailed: false },
    ]);
    expect(beat.shots.map((shot) => shot.media)).toEqual([
      { kind: 'poster', assetId: 'poster_stale' },
      { kind: 'video', assetId: 'video_2' },
      { kind: 'cover', assetId: 'cover_3' },
      null,
      null,
      null,
    ]);
    expect(beat.shots.map((shot) => shot.chain)).toEqual([
      { kind: 'head' },
      { kind: 'after', beatPosition: 1, shotPosition: 1 },
      { kind: 'head' },
      { kind: 'head' },
      { kind: 'after', beatPosition: 1, shotPosition: 4 },
      { kind: 'head' },
    ]);
    expect(beat).toMatchObject({ shotCount: 6, renderedCount: 2, staleCount: 1, inFlightCount: 1 });

    const changedTelemetry = makeProjection([
      makeBeat(
        'beat_1',
        projection.activeBeats[0]!.shots.map((shot) => ({
          ...shot,
          activeGenerationJob:
            shot.id === 'shot_3' ? { id: 'job_irrelevant', purpose: 'seed_still' as const, canCancel: false } : null,
          generationProgressPercent: shot.id === 'shot_3' ? 99 : null,
        }))
      ),
    ]);
    changedTelemetry.conditioningFailures = projection.conditioningFailures;
    expect(deriveBoardShotTiles(changedTelemetry, makeStatus(changedTelemetry))).toEqual(result);
  });

  it('separates global blockers from bounded exact-Shot blockers in canonical stage order', () => {
    const projection = makeProjection([makeBeat('beat_1', [makeShot('shot_1'), makeShot('shot_2')])]);
    const projectBlocker = blocker('reference_plan_invalid', { kind: 'project' });
    const routeBlocker = blocker('route_not_selected', { kind: 'route', routeKind: 'video' });
    const referenceBinding = blocker('reference_binding_unassigned', {
      kind: 'shot',
      beatId: 'beat_1',
      shotId: 'shot_1',
      beatPosition: 1,
      shotPosition: 1,
      jobId: null,
    });
    const otherShot = blocker('generation_timeout', {
      kind: 'shot',
      beatId: 'beat_1',
      shotId: 'shot_2',
      beatPosition: 1,
      shotPosition: 2,
      jobId: 'job_2',
    });
    const ignoredReference = blocker('reference_approval_required', {
      kind: 'reference',
      referenceId: 'reference_1',
      jobId: null,
    });
    let stages = emptyStages(projection);
    stages = withStageBlockers(stages, 'engines', [routeBlocker, routeBlocker]);
    stages = withStageBlockers(stages, 'references', [projectBlocker, ignoredReference]);
    stages = withStageBlockers(stages, 'bindings', [referenceBinding]);
    stages = withStageBlockers(stages, 'production', [otherShot]);
    const status = makeStatus(projection, { stages, blockerCount: 6 });

    const result = deriveBoardShotTiles(projection, status)!;
    expect(result.blockerStatusAvailable).toBe(true);
    expect(result.globalBlockers).toEqual([
      { stage: 'engines', value: routeBlocker, reviewReferenceBinding: false },
      { stage: 'references', value: projectBlocker, reviewReferenceBinding: false },
    ]);
    expect(result.beats[0]!.shots[0]!.blockers).toEqual([
      { stage: 'bindings', value: referenceBinding, reviewReferenceBinding: true },
    ]);
    expect(result.beats[0]!.shots[1]!.blockers).toEqual([
      { stage: 'production', value: otherShot, reviewReferenceBinding: false },
    ]);

    const shotCauses: StudioProjectStatusBlockerV2['cause'][] = [
      'seed_selection_required',
      'seed_generation_required',
      'conditioning_frame_required',
      'extraction_failed',
      'dependency_failed',
      'generation_invalid_request',
      'generation_content_rejected',
      'generation_auth',
      'generation_quota',
      'generation_rate_limited',
      'generation_provider_unavailable',
      'generation_timeout',
      'generation_poll_deadline',
      'generation_no_output',
      'generation_variation_grid',
      'generation_submission_unknown',
    ];
    const distinct = shotCauses.map((cause, index) =>
      blocker(cause, {
        kind: 'shot',
        beatId: 'beat_1',
        shotId: 'shot_1',
        beatPosition: 1,
        shotPosition: 1,
        jobId: `job_${index}`,
      })
    );
    const bounded = makeStatus(projection, {
      stages: withStageBlockers(emptyStages(projection), 'production', distinct),
      blockerCount: distinct.length,
    });
    expect(deriveBoardShotTiles(projection, bounded)!.beats[0]!.shots[0]!.blockers).toHaveLength(
      BOARD_SHOT_TILE_MAX_BLOCKERS
    );
  });

  it.each([
    ['absent status', (projection: WorkspaceProjection) => null],
    ['wrong project', (projection: WorkspaceProjection) => makeStatus(projection, { projectId: 'project_other' })],
    ['wrong revision', (projection: WorkspaceProjection) => makeStatus(projection, { projectRevision: 8 })],
    ['null detail', (projection: WorkspaceProjection) => makeStatus(projection, { detail: null })],
    [
      'missing detail Shot',
      (projection: WorkspaceProjection) =>
        makeStatus(projection, { detail: { shots: shotDetails(projection).slice(0, 1), references: [] } }),
    ],
    [
      'extra detail Shot',
      (projection: WorkspaceProjection) =>
        makeStatus(projection, {
          detail: {
            shots: [
              ...shotDetails(projection),
              { ...shotDetails(projection)[0]!, shotId: 'shot_extra', shotPosition: 3 },
            ],
            references: [],
          },
        }),
    ],
    [
      'duplicate detail Shot',
      (projection: WorkspaceProjection) =>
        makeStatus(projection, {
          detail: { shots: [shotDetails(projection)[0]!, shotDetails(projection)[0]!], references: [] },
        }),
    ],
    [
      'mispositioned detail Shot',
      (projection: WorkspaceProjection) =>
        makeStatus(projection, {
          detail: {
            shots: shotDetails(projection).map((detail, index) =>
              index === 0 ? { ...detail, shotPosition: 99 } : detail
            ),
            references: [],
          },
        }),
    ],
    [
      'wrong stage order',
      (projection: WorkspaceProjection) => {
        const stages = emptyStages(projection);
        return makeStatus(projection, { stages: [stages[1]!, stages[0]!, ...stages.slice(2)] });
      },
    ],
  ])('withholds blockers but keeps live projection status for %s', (_case, statusFor) => {
    const projection = makeProjection([makeBeat('beat_1', [makeShot('shot_1'), makeShot('shot_2')])]);
    const result = deriveBoardShotTiles(projection, statusFor(projection));
    expect(result).not.toBeNull();
    expect(result!.blockerStatusAvailable).toBe(false);
    expect(result!.globalBlockers).toEqual([]);
    expect(result!.beats[0]!.shots.map((shot) => shot.status.word)).toEqual(['notReady', 'notReady']);
    expect(result!.beats[0]!.shots.every((shot) => !shot.blockersAvailable && shot.blockers.length === 0)).toBe(true);
  });

  it('fails closed for malformed projection order, duplicate identity, and impossible predecessor facts', () => {
    const base = makeProjection([makeBeat('beat_1', [makeShot('shot_1'), makeShot('shot_2')])]);
    expect(deriveBoardShotTiles({ ...base, activeShotIds: ['shot_2', 'shot_1'] }, makeStatus(base))).toBeNull();
    expect(
      deriveBoardShotTiles(
        {
          ...base,
          activeBeats: [makeBeat('beat_1', [makeShot('shot_1'), makeShot('shot_1')])],
        },
        makeStatus(base)
      )
    ).toBeNull();
    expect(
      deriveBoardShotTiles(
        {
          ...base,
          activeBeats: [makeBeat('beat_1', [makeShot('shot_1', { segmentHead: false }), makeShot('shot_2')])],
        },
        makeStatus(base)
      )
    ).toBeNull();
  });
});
