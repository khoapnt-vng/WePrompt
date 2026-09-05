/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_DIRTY_SHOTS_REPORTED,
  type StudioAssetV2,
  type StudioConditioningInputSnapshot,
  type StudioGenerationRequestSnapshot,
  type StudioGenerationReferenceInputSnapshot,
  type StudioJobV2,
  type StudioJobPurpose,
  type StudioMediaModelRef,
  type StudioProjectV2,
  type StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  deriveStudioDirtyShotsV2,
  deriveStudioInboundShotReferencesV2,
  studioShotHasBlockingInboundReferenceV2,
} from '@/process/services/creative-studio/service/schema2/chain';
import {
  createStudioFrameExtractionId,
  createStudioGenerationRequestTemplate,
  composeStudioGenerationV2,
  deriveStudioInstructionProfileV2,
  studioGenerationCompositionDigestV2,
} from '@/process/services/creative-studio/service/schema2/generation';

const NOW = '2026-08-18T00:00:00.000Z';
const IMAGE_ROUTE_ID = 'image_route_1';
const VIDEO_ROUTE_ID = 'video_route_1';
const IMAGE_ROUTE = {
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1' as const,
  model: 'image-model',
};
const VIDEO_ROUTE = {
  providerId: 'provider_1',
  adapterId: 'byteplus-seedance-v1' as const,
  model: 'video-model',
};

const makeProject = (): StudioProjectV2 => {
  const project = createEmptyStudioProjectV2(
    {
      name: 'Chain project',
      brief: 'Tell one coherent visual story.',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'project_1',
    NOW
  );
  project.videoRouteId = VIDEO_ROUTE_ID;
  return project;
};

const makeShot = (shotId: string): StudioShot => ({
  id: shotId,
  shootingScript: `Shooting script for ${shotId}`,
  durationSeconds: 8,
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

const makeAsset = (
  project: StudioProjectV2,
  shotId: string | null,
  assetId: string,
  mediaKind: 'image' | 'video',
  collection: StudioAssetV2['managedAsset']['collection'],
  createdAt = NOW
): StudioAssetV2 => ({
  id: assetId,
  projectId: project.id,
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png',
  managedAsset: { collection, fileName: `${assetId}.${mediaKind === 'video' ? 'mp4' : 'png'}` },
  byteSize: 1,
  sha256: assetId.padEnd(64, 'a').slice(0, 64),
  ...(mediaKind === 'video' ? { durationSeconds: 10 } : {}),
  createdAt,
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
});

const makeComposition = (
  project: StudioProjectV2,
  beatId: string,
  shot: StudioShot,
  purpose: Exclude<StudioJobPurpose, 'reference_image'>,
  route: StudioMediaModelRef,
  referenceInputs: readonly StudioGenerationReferenceInputSnapshot[] = []
) => {
  const beat = project.beats[beatId]!;
  const source = {
    kind: 'shot' as const,
    beatId: beat.id,
    story: beat.story,
    shotId: shot.id,
    shootingScript: shot.shootingScript,
  };
  return composeStudioGenerationV2({
    projectRevision: project.revision,
    brief: project.brief,
    rules: project.rules,
    source,
    purpose,
    referenceInputs: [...referenceInputs],
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    route,
    boardStyle: purpose === 'board_still' ? project.boardStyle : null,
    instructionProfile: deriveStudioInstructionProfileV2(route, purpose, source),
  });
};

const makeSnapshot = (
  project: StudioProjectV2,
  beatId: string,
  shot: StudioShot,
  conditioningInput: StudioConditioningInputSnapshot
): StudioGenerationRequestSnapshot => {
  const composition = makeComposition(project, beatId, shot, 'video_take', VIDEO_ROUTE);
  return {
    ...createStudioGenerationRequestTemplate({
      composition,
      durationSeconds: shot.durationSeconds,
    }),
    conditioningInput,
  };
};

const makeJob = (
  project: StudioProjectV2,
  shot: StudioShot,
  jobId: string,
  assetId: string,
  snapshot: StudioGenerationRequestSnapshot
): StudioJobV2 => ({
  id: jobId,
  projectId: project.id,
  target: { kind: 'shot', shotId: shot.id },
  status: 'succeeded',
  provider: snapshot.composition.inputs.route,
  idempotencyKey: `idem_${jobId}`,
  providerJobId: `provider_${jobId}`,
  remoteStartedAt: NOW,
  cancellationPolicy: 'queued_and_running',
  outputAssetIds: [assetId],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  purpose: snapshot.composition.inputs.purpose,
  authorizationId: `authorization_${jobId}`,
  authorizationItemId: `item_${jobId}`,
  composition: snapshot.composition,
  requestPlan: { kind: 'resolved', snapshot },
  requestSnapshot: snapshot,
  spendReceipt: {
    authorizationId: `authorization_${jobId}`,
    itemId: `item_${jobId}`,
    jobId,
    purpose: snapshot.composition.inputs.purpose,
    routeId: VIDEO_ROUTE_ID,
    currency: 'USD',
    rateUnit: snapshot.composition.inputs.purpose === 'video_take' ? 'second' : 'generation',
    rateMinorUnits: 1,
    durationSeconds: snapshot.composition.inputs.purpose === 'video_take' ? shot.durationSeconds : null,
    generationCount: 1,
    totalMinorUnits: snapshot.composition.inputs.purpose === 'video_take' ? shot.durationSeconds : 1,
  },
  outputAssetIdsByRole: { primary: assetId, poster: null },
});

const addBeat = (project: StudioProjectV2, beatId: string): void => {
  project.beatOrder.push(beatId);
  project.beats[beatId] = {
    id: beatId,
    title: beatId,
    story: `Story for ${beatId}`,
    targetSeconds: null,
    shotOrder: [],
  };
};

const addCurrentHeadShot = (project: StudioProjectV2, beatId: string, shotId: string): StudioShot => {
  const shot = makeShot(shotId);
  const seedId = `${shotId}_seed`;
  const takeId = `${shotId}_take`;
  const jobId = `${shotId}_job`;
  project.beats[beatId]!.shotOrder.push(shotId);
  project.shots[shotId] = shot;
  project.assets[seedId] = makeAsset(project, shotId, seedId, 'image', 'imports');
  project.assets[takeId] = makeAsset(project, shotId, takeId, 'video', 'assets');
  shot.seedStillId = seedId;
  shot.videoAssetId = takeId;
  shot.assetIds = [seedId, takeId];
  shot.jobIds = [jobId];
  const snapshot = makeSnapshot(project, beatId, shot, { kind: 'seed_still', assetId: seedId });
  project.jobs[jobId] = makeJob(project, shot, jobId, takeId, snapshot);
  return shot;
};

const addReadyFrame = (
  project: StudioProjectV2,
  predecessor: StudioShot,
  frameAssetId: string
): StudioConditioningInputSnapshot => {
  const take = project.assets[predecessor.videoAssetId!]!;
  const endpointSeconds = take.durationSeconds! - (predecessor.trimOutSeconds ?? 0);
  const extractionId = createStudioFrameExtractionId({
    shotId: predecessor.id,
    videoAssetId: take.id,
    endpointSeconds,
  });
  project.frameExtractions[extractionId] = {
    id: extractionId,
    shotId: predecessor.id,
    videoAssetId: take.id,
    endpointSeconds,
    frameAssetId,
    status: 'ready',
    errorCode: null,
  };
  return {
    kind: 'predecessor_frame',
    predecessorShotId: predecessor.id,
    takeAssetId: take.id,
    frameAssetId,
    endpointSeconds,
  };
};

const addFollowerShot = (
  project: StudioProjectV2,
  beatId: string,
  shotId: string,
  predecessor: StudioShot
): StudioShot => {
  const shot = makeShot(shotId);
  const takeId = `${shotId}_take`;
  const jobId = `${shotId}_job`;
  project.beats[beatId]!.shotOrder.push(shotId);
  project.shots[shotId] = shot;
  project.assets[takeId] = makeAsset(project, shotId, takeId, 'video', 'assets');
  shot.videoAssetId = takeId;
  shot.assetIds = [takeId];
  shot.jobIds = [jobId];
  const conditioning = addReadyFrame(project, predecessor, `${predecessor.id}_frame`);
  const snapshot = makeSnapshot(project, beatId, shot, conditioning);
  project.jobs[jobId] = makeJob(project, shot, jobId, takeId, snapshot);
  return shot;
};

const makeTwoShotProject = (): StudioProjectV2 => {
  const project = makeProject();
  addBeat(project, 'beat_1');
  const first = addCurrentHeadShot(project, 'beat_1', 'shot_1');
  addFollowerShot(project, 'beat_1', 'shot_2', first);
  return project;
};

describe('deriveStudioDirtyShotsV2', () => {
  it('reports unique dirty shots in active film order through the frozen cap', () => {
    const project = makeProject();
    for (let beatIndex = 0; beatIndex < 12; beatIndex += 1) {
      const beatId = `beat_${beatIndex + 1}`;
      addBeat(project, beatId);
      for (let shotIndex = 0; shotIndex < 8; shotIndex += 1) {
        const shot = addCurrentHeadShot(project, beatId, `shot_${beatIndex * 8 + shotIndex + 1}`);
        if (shotIndex > 0) shot.chainBreak = 'hard_cut';
      }
    }
    project.videoRouteId = 'video_route_changed';

    const dirty = deriveStudioDirtyShotsV2(project);

    expect(dirty).toHaveLength(STUDIO_MAX_DIRTY_SHOTS_REPORTED);
    expect(dirty.map(({ shotId }) => shotId)).toEqual(
      Array.from({ length: STUDIO_MAX_DIRTY_SHOTS_REPORTED }, (_, index) => `shot_${index + 1}`)
    );
    expect(dirty.every(({ causes }) => causes.join(',') === 'generation_out_of_date')).toBe(true);
  });

  it('treats head trim as continuity-neutral and tail trim as a downstream endpoint change', () => {
    const headTrimmed = makeTwoShotProject();
    headTrimmed.shots.shot_1!.trimInSeconds = 1;
    expect(deriveStudioDirtyShotsV2(headTrimmed)).toEqual([]);

    const tailTrimmed = makeTwoShotProject();
    tailTrimmed.shots.shot_1!.trimOutSeconds = 2;
    expect(deriveStudioDirtyShotsV2(tailTrimmed)).toEqual([
      { shotId: 'shot_2', causes: ['continuity_stale', 'generation_out_of_date'] },
    ]);
  });

  it.each([
    [
      'missing take duration',
      (project: StudioProjectV2): void => {
        delete project.assets.shot_1_take!.durationSeconds;
      },
    ],
    [
      'non-finite take duration',
      (project: StudioProjectV2): void => {
        project.assets.shot_1_take!.durationSeconds = Number.NaN;
      },
    ],
    [
      'zero take duration',
      (project: StudioProjectV2): void => {
        project.assets.shot_1_take!.durationSeconds = 0;
      },
    ],
    [
      'non-positive trimmed endpoint',
      (project: StudioProjectV2): void => {
        project.shots.shot_1!.trimOutSeconds = 10;
      },
    ],
    [
      'mismatched extraction id',
      (project: StudioProjectV2): void => {
        Object.values(project.frameExtractions)[0]!.id = 'wrong_extraction_id';
      },
    ],
    [
      'non-ready extraction',
      (project: StudioProjectV2): void => {
        Object.values(project.frameExtractions)[0]!.status = 'extracting';
      },
    ],
    [
      'missing frame asset',
      (project: StudioProjectV2): void => {
        Object.values(project.frameExtractions)[0]!.frameAssetId = null;
      },
    ],
    [
      'mismatched extraction shot',
      (project: StudioProjectV2): void => {
        Object.values(project.frameExtractions)[0]!.shotId = 'wrong_shot';
      },
    ],
    [
      'mismatched extraction take',
      (project: StudioProjectV2): void => {
        Object.values(project.frameExtractions)[0]!.videoAssetId = 'wrong_take';
      },
    ],
    [
      'mismatched extraction endpoint',
      (project: StudioProjectV2): void => {
        Object.values(project.frameExtractions)[0]!.endpointSeconds += 1;
      },
    ],
  ])('fails closed for a %s', (_label, corrupt) => {
    const project = makeTwoShotProject();
    corrupt(project);

    expect(deriveStudioDirtyShotsV2(project)).toEqual([
      { shotId: 'shot_2', causes: ['continuity_stale', 'generation_out_of_date'] },
    ]);
  });

  it('skips malformed active traversal and non-canonical picture pointers without duplicating rows', () => {
    const project = makeProject();
    project.beatOrder.push('missing_beat');
    addBeat(project, 'beat_1');
    addCurrentHeadShot(project, 'beat_1', 'shot_1');
    project.beats.beat_1!.shotOrder.push('missing_shot');
    addBeat(project, 'beat_2');
    project.beats.beat_2!.shotOrder.push('shot_1');
    project.videoRouteId = 'video_route_changed';

    expect(deriveStudioDirtyShotsV2(project)).toEqual([{ shotId: 'shot_1', causes: ['generation_out_of_date'] }]);

    project.shots.shot_1!.videoAssetId = null;
    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);

    project.shots.shot_1!.videoAssetId = 'shot_1_seed';
    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);

    project.shots.shot_1!.videoAssetId = 'shot_1_take';
    expect(deriveStudioDirtyShotsV2(project)).toEqual([{ shotId: 'shot_1', causes: ['generation_out_of_date'] }]);
  });

  it('uses an eligible unpinned seed when comparing a current head request', () => {
    const project = makeTwoShotProject();
    project.shots.shot_1!.seedStillId = null;

    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);
  });

  it('grandfathers an existing current video that was conditioned on a historical Board frame', () => {
    const project = makeTwoShotProject();
    const shot = project.shots.shot_1!;
    const board = project.assets.shot_1_seed!;
    project.imageRouteId = IMAGE_ROUTE_ID;
    board.managedAsset.collection = 'boardStills';
    shot.boardAssetId = board.id;
    const composition = makeComposition(project, 'beat_1', shot, 'board_still', IMAGE_ROUTE);
    composition.inputs.instructionProfile = 'weprompt-image-v1.board-still.v1';
    composition.prompt = composition.prompt.replace(
      'weprompt-image-v1.board-still.v2',
      'weprompt-image-v1.board-still.v1'
    );
    const snapshot: StudioGenerationRequestSnapshot = {
      ...createStudioGenerationRequestTemplate({ composition, durationSeconds: 4 }),
      conditioningInput: null,
    };
    const producer = makeJob(project, shot, 'shot_1_board_job', board.id, snapshot);
    producer.spendReceipt!.routeId = IMAGE_ROUTE_ID;
    project.jobs[producer.id] = producer;
    shot.jobIds.unshift(producer.id);
    board.producerJobId = producer.id;
    board.compositionDigest = studioGenerationCompositionDigestV2(composition);

    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);
  });

  it('does not use a newer displaced project-reference output as an implicit seed', () => {
    const project = makeTwoShotProject();
    const shot = project.shots.shot_1!;
    shot.seedStillId = null;
    const referenceId = 'reference_character';
    project.referenceOrder = [referenceId];
    project.referencePlanStatus = 'planned';
    project.references[referenceId] = {
      id: referenceId,
      kind: 'character',
      label: 'Ming',
      prompt: 'A stable character sheet for Ming.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const historicalReferenceOutput = makeAsset(
      project,
      null,
      'historical_reference_output',
      'image',
      'assets',
      '2026-08-18T00:00:01.000Z'
    );
    historicalReferenceOutput.projectReferenceId = referenceId;
    project.assets[historicalReferenceOutput.id] = historicalReferenceOutput;

    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);
  });

  it('never treats a newer Board panel as an implicit first frame', () => {
    const project = makeTwoShotProject();
    const shot = project.shots.shot_1!;
    shot.seedStillId = null;
    const board = makeAsset(project, shot.id, 'shot_1_board', 'image', 'boardStills', '2026-08-18T00:00:01.000Z');
    project.assets[board.id] = board;
    shot.boardAssetId = board.id;
    shot.assetIds.push(board.id);

    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);
  });

  it('revalidates a generated seed and its frozen Brief reference before treating a segment head as current', () => {
    const project = makeTwoShotProject();
    const shot = project.shots.shot_1!;
    const seedId = 'shot_1_generated_seed';
    const referenceId = 'brief_reference_1';
    const referenceSha = 'b'.repeat(64);
    project.imageRouteId = 'image_route_1';
    project.assets[seedId] = makeAsset(project, shot.id, seedId, 'image', 'assets');
    project.referencePlanStatus = 'planned';
    project.referenceOrder = [referenceId];
    project.references[referenceId] = {
      id: referenceId,
      kind: 'character',
      label: 'Reference character',
      prompt: 'The approved recurring character.',
      approvedAssetId: referenceId,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    project.assets[referenceId] = { ...makeAsset(project, null, referenceId, 'image', 'assets'), sha256: referenceSha };
    project.assets[referenceId]!.projectReferenceId = referenceId;
    shot.referenceBinding = {
      status: 'ready',
      characterReferenceIds: [referenceId],
      backgroundReferenceId: null,
    };
    shot.seedStillId = seedId;
    shot.assetIds.push(seedId);

    const referenceInputs = [{ referenceId, kind: 'character' as const, assetId: referenceId, sha256: referenceSha }];
    const imageRoute = {
      providerId: 'provider_image',
      adapterId: 'weprompt-image-v1' as const,
      model: 'image-model',
    };
    const seedSnapshot: StudioGenerationRequestSnapshot = {
      ...createStudioGenerationRequestTemplate({
        composition: makeComposition(project, 'beat_1', shot, 'seed_still', imageRoute, referenceInputs),
        durationSeconds: shot.durationSeconds,
      }),
      conditioningInput: null,
    };
    const seedJob = makeJob(project, shot, 'shot_1_seed_job', seedId, seedSnapshot);
    seedJob.purpose = 'seed_still';
    seedJob.requestPlan = { kind: 'resolved', snapshot: seedSnapshot };
    seedJob.requestSnapshot = seedSnapshot;
    seedJob.provider = imageRoute;
    seedJob.composition = seedSnapshot.composition;
    seedJob.spendReceipt = {
      ...seedJob.spendReceipt!,
      purpose: 'seed_still',
      routeId: project.imageRouteId,
      rateUnit: 'generation',
      durationSeconds: null,
      totalMinorUnits: 1,
    };
    project.jobs[seedJob.id] = seedJob;
    shot.jobIds.unshift(seedJob.id);

    const takeJob = project.jobs.shot_1_job!;
    const takeSnapshot = makeSnapshot(project, 'beat_1', shot, { kind: 'seed_still', assetId: seedId });
    takeJob.requestPlan = { kind: 'resolved', snapshot: takeSnapshot };
    takeJob.requestSnapshot = takeSnapshot;

    expect(deriveStudioDirtyShotsV2(project)).toEqual([]);

    project.assets[referenceId]!.sha256 = 'c'.repeat(64);
    expect(deriveStudioDirtyShotsV2(project)).toContainEqual({
      shotId: shot.id,
      causes: ['generation_out_of_date'],
    });
  });

  it('separates route/template drift from unchanged conditioning', () => {
    const templateChanged = makeTwoShotProject();
    templateChanged.brief = 'A different authored Brief.';
    expect(deriveStudioDirtyShotsV2(templateChanged)).toEqual([
      { shotId: 'shot_1', causes: ['generation_out_of_date'] },
      { shotId: 'shot_2', causes: ['generation_out_of_date'] },
    ]);

    const routeChanged = makeTwoShotProject();
    routeChanged.videoRouteId = 'video_route_changed';
    expect(deriveStudioDirtyShotsV2(routeChanged)).toEqual([
      { shotId: 'shot_1', causes: ['generation_out_of_date'] },
      { shotId: 'shot_2', causes: ['generation_out_of_date'] },
    ]);
  });

  it('detects both a human hard cut and an upstream picture replacement', () => {
    const hardCut = makeTwoShotProject();
    hardCut.shots.shot_2!.chainBreak = 'hard_cut';
    const secondSeedId = 'shot_2_seed';
    hardCut.assets[secondSeedId] = makeAsset(hardCut, 'shot_2', secondSeedId, 'image', 'imports');
    hardCut.shots.shot_2!.assetIds.push(secondSeedId);
    hardCut.shots.shot_2!.seedStillId = secondSeedId;
    expect(deriveStudioDirtyShotsV2(hardCut)).toContainEqual({
      shotId: 'shot_2',
      causes: ['continuity_stale', 'generation_out_of_date'],
    });

    const selectionChanged = makeTwoShotProject();
    const first = selectionChanged.shots.shot_1!;
    const replacementId = 'shot_1_take_replacement';
    const replacementJobId = 'shot_1_job_replacement';
    selectionChanged.assets[replacementId] = makeAsset(selectionChanged, first.id, replacementId, 'video', 'assets');
    first.assetIds.push(replacementId);
    first.supersededVideoAssetIds.push(first.videoAssetId!);
    first.videoAssetId = replacementId;
    const replacementSnapshot = makeSnapshot(selectionChanged, 'beat_1', first, {
      kind: 'seed_still',
      assetId: first.seedStillId!,
    });
    selectionChanged.jobs[replacementJobId] = makeJob(
      selectionChanged,
      first,
      replacementJobId,
      replacementId,
      replacementSnapshot
    );
    first.jobIds.push(replacementJobId);
    addReadyFrame(selectionChanged, first, 'shot_1_replacement_frame');

    expect(deriveStudioDirtyShotsV2(selectionChanged)).toContainEqual({
      shotId: 'shot_2',
      causes: ['continuity_stale', 'generation_out_of_date'],
    });
  });
});

describe('deriveStudioInboundShotReferencesV2', () => {
  it('orders every live blocker category and ignores terminal historical consumers', () => {
    const project = makeTwoShotProject();
    const target = project.shots.shot_1!;
    const dependent = project.shots.shot_2!;
    const downstreamSnapshot = project.jobs.shot_2_job!.requestSnapshot!;
    const { conditioningInput: _downstreamConditioning, ...downstreamTemplate } = downstreamSnapshot;

    project.jobs.own_running = {
      ...project.jobs.shot_1_job!,
      id: 'own_running',
      status: 'running',
      requestSnapshot: project.jobs.shot_1_job!.requestSnapshot,
    };
    target.jobIds.push('own_running');
    project.jobs.downstream_running = {
      ...project.jobs.shot_2_job!,
      id: 'downstream_running',
      status: 'running',
      requestSnapshot: downstreamSnapshot,
    };
    project.jobs.downstream_waiting = {
      ...project.jobs.shot_2_job!,
      id: 'downstream_waiting',
      target: { kind: 'shot', shotId: 'shot_3' },
      status: 'waiting_for_conditioning',
      requestPlan: {
        kind: 'after_take_selection',
        template: downstreamTemplate,
        dependency: {
          kind: 'authorized_predecessor',
          upstreamItemId: 'item_upstream',
          predecessorShotId: target.id,
        },
      },
      requestSnapshot: null,
    };
    project.jobs.downstream_terminal = {
      ...project.jobs.downstream_running,
      id: 'downstream_terminal',
      status: 'succeeded',
    };
    const pendingFrameId = createStudioFrameExtractionId({
      shotId: target.id,
      videoAssetId: target.videoAssetId!,
      endpointSeconds: 9,
    });
    project.frameExtractions[pendingFrameId] = {
      id: pendingFrameId,
      shotId: target.id,
      videoAssetId: target.videoAssetId!,
      endpointSeconds: 9,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
    };

    const references = deriveStudioInboundShotReferencesV2(project, [target.id]);

    expect(references).toEqual([
      { shotId: target.id, dependentShotId: target.id, kind: 'own_nonterminal_job' },
      { shotId: target.id, dependentShotId: target.id, kind: 'own_pending_frame' },
      { shotId: target.id, dependentShotId: dependent.id, kind: 'downstream_nonterminal_job' },
      { shotId: target.id, dependentShotId: 'shot_3', kind: 'downstream_nonterminal_job' },
      { shotId: target.id, dependentShotId: dependent.id, kind: 'downstream_pending_frame' },
      { shotId: target.id, dependentShotId: 'shot_3', kind: 'waiting_authorization_dependency' },
      { shotId: target.id, dependentShotId: target.id, kind: 'bound_nonterminal_request' },
      { shotId: target.id, dependentShotId: dependent.id, kind: 'bound_nonterminal_request' },
    ]);
    expect(studioShotHasBlockingInboundReferenceV2(project, target.id)).toBe(true);

    delete project.jobs.own_running;
    delete project.jobs.downstream_running;
    delete project.jobs.downstream_waiting;
    delete project.frameExtractions[pendingFrameId];
    expect(deriveStudioInboundShotReferencesV2(project, [target.id])).toEqual([]);
    expect(studioShotHasBlockingInboundReferenceV2(project, target.id)).toBe(false);
  });

  it('derives authorized-seed and seed-asset dependencies while leaving a tail pending frame local', () => {
    const project = makeTwoShotProject();
    const target = project.shots.shot_1!;
    const downstream = project.jobs.shot_2_job!;
    const { conditioningInput: _downstreamConditioning, ...downstreamTemplate } = downstream.requestSnapshot!;
    project.jobs.seed_waiter = {
      ...downstream,
      id: 'seed_waiter',
      target: { kind: 'shot', shotId: 'shot_3' },
      status: 'waiting_for_conditioning',
      requestPlan: {
        kind: 'after_take_selection',
        template: downstreamTemplate,
        dependency: {
          kind: 'authorized_seed',
          upstreamItemId: 'seed_item',
          shotId: target.id,
        },
      },
      requestSnapshot: null,
    };
    project.jobs.seed_bound = {
      ...downstream,
      id: 'seed_bound',
      target: { kind: 'shot', shotId: 'shot_4' },
      status: 'running',
      requestSnapshot: {
        ...downstream.requestSnapshot!,
        conditioningInput: { kind: 'seed_still', assetId: target.seedStillId! },
      },
    };

    expect(deriveStudioInboundShotReferencesV2(project, [target.id])).toEqual(
      expect.arrayContaining([
        { shotId: target.id, dependentShotId: 'shot_3', kind: 'downstream_nonterminal_job' },
        { shotId: target.id, dependentShotId: 'shot_3', kind: 'waiting_authorization_dependency' },
        { shotId: target.id, dependentShotId: 'shot_4', kind: 'downstream_nonterminal_job' },
        { shotId: target.id, dependentShotId: 'shot_4', kind: 'bound_nonterminal_request' },
      ])
    );

    const tail = project.shots.shot_2!;
    const pendingFrameId = createStudioFrameExtractionId({
      shotId: tail.id,
      videoAssetId: tail.videoAssetId!,
      endpointSeconds: 9,
    });
    project.frameExtractions[pendingFrameId] = {
      id: pendingFrameId,
      shotId: tail.id,
      videoAssetId: tail.videoAssetId!,
      endpointSeconds: 9,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
    };
    expect(deriveStudioInboundShotReferencesV2(project, [tail.id])).toContainEqual({
      shotId: tail.id,
      dependentShotId: tail.id,
      kind: 'own_pending_frame',
    });
  });
});
