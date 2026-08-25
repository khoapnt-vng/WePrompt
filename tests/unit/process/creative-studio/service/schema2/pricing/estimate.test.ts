/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_SHOTS_PER_BEAT,
  type StudioAssetV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioJobPurpose,
  type StudioMediaModelRef,
  type StudioPrepareGenerationChoiceV2,
  type StudioPrepareSubmissionRequestV2,
  type StudioProjectV2,
  type StudioQuotedGeneration,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  composeStudioGenerationV2,
  createStudioDeferredGenerationRequestPlan,
  createStudioBoardGenerationRequestPlanForShot,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
  createStudioResolvedGenerationRequestPlan,
  deriveStudioInstructionProfileV2,
  studioGenerationCompositionDigestV2,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  createStudioRateCardV2,
  createStudioSubmissionQuoteCoreV2,
  deriveStudioProjectReferenceSubmissionQuoteGraphV2 as deriveStudioProjectReferenceSubmissionQuoteGraphV2Impl,
  deriveStudioSubmissionQuoteCoresV2 as deriveStudioSubmissionQuoteCoresV2Impl,
  deriveStudioSubmissionQuoteGraphV2 as deriveStudioSubmissionQuoteGraphV2Impl,
  evaluateStudioBudgetV2,
  priceStudioSubmissionQuoteGraphV2,
  studioSubmissionQuoteCoresEqual,
  toStudioRendererSubmissionQuoteV2,
  type StudioSubmissionQuoteEstimateInputV2,
  type StudioUnpricedQuotedGenerationV2,
} from '@/process/services/creative-studio/service/schema2/pricing';

const imageRate = {
  routeId: 'image_route',
  kind: 'image',
  currency: 'USD',
  rateUnit: 'generation',
  rateMinorUnits: 25,
} as const;

const videoRate = {
  routeId: 'video_route',
  kind: 'video',
  currency: 'USD',
  rateUnit: 'second',
  rateMinorUnits: 7,
} as const;

const imageProvider: StudioMediaModelRef = {
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1',
  model: 'image-model',
};
const videoProvider: StudioMediaModelRef = {
  providerId: 'provider_video',
  adapterId: 'openrouter-video-v1',
  model: 'video-model',
};
const resolveRoute = (routeId: string, purpose: StudioJobPurpose) => {
  if (routeId === imageRate.routeId && purpose !== 'video_take') {
    return { provider: imageProvider, maxConditioningImages: 24 };
  }
  if (routeId === videoRate.routeId && purpose === 'video_take') {
    return { provider: videoProvider, maxConditioningImages: 0 };
  }
  throw new Error('missing test route');
};

const deriveStudioSubmissionQuoteCoresV2 = (
  input: Omit<Parameters<typeof deriveStudioSubmissionQuoteCoresV2Impl>[0], 'resolveRoute'> &
    Partial<Pick<Parameters<typeof deriveStudioSubmissionQuoteCoresV2Impl>[0], 'resolveRoute'>>
) => deriveStudioSubmissionQuoteCoresV2Impl({ ...input, resolveRoute: input.resolveRoute ?? resolveRoute });

const deriveStudioSubmissionQuoteGraphV2 = (
  input: Omit<Parameters<typeof deriveStudioSubmissionQuoteGraphV2Impl>[0], 'resolveRoute'> &
    Partial<Pick<Parameters<typeof deriveStudioSubmissionQuoteGraphV2Impl>[0], 'resolveRoute'>>
) => deriveStudioSubmissionQuoteGraphV2Impl({ ...input, resolveRoute: input.resolveRoute ?? resolveRoute });

const deriveStudioProjectReferenceSubmissionQuoteGraphV2 = (
  input: Omit<Parameters<typeof deriveStudioProjectReferenceSubmissionQuoteGraphV2Impl>[0], 'resolveRoute'> &
    Partial<Pick<Parameters<typeof deriveStudioProjectReferenceSubmissionQuoteGraphV2Impl>[0], 'resolveRoute'>>
) =>
  deriveStudioProjectReferenceSubmissionQuoteGraphV2Impl({
    ...input,
    resolveRoute: input.resolveRoute ?? resolveRoute,
  });

const makeShot = (id: string): StudioProjectV2['shots'][string] => ({
  id,
  shootingScript: `Shooting script for ${id}`,
  durationSeconds: 8,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: { status: 'ready', characterReferenceIds: [], backgroundReferenceId: null },
  seedStillId: null,
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
});

const makeProject = (shotIds = ['shot_1', 'shot_2']): StudioSubmissionQuoteEstimateInputV2['project'] => ({
  id: 'project_1',
  revision: 7,
  beatOrder: ['beat_1'],
  beats: {
    beat_1: {
      id: 'beat_1',
      title: 'Opening',
      story: 'Move through the clean daylight space.',
      targetSeconds: null,
      shotOrder: [...shotIds],
    },
  },
  shots: Object.fromEntries(shotIds.map((shotId) => [shotId, makeShot(shotId)])),
  references: {},
  jobs: {},
});

const compositionFor = (
  shotId: string,
  purpose: Exclude<StudioJobPurpose, 'reference_image'>,
  referenceInputs: readonly StudioGenerationReferenceInputSnapshot[] = []
) => {
  const route = purpose === 'video_take' ? videoProvider : imageProvider;
  const source = {
    kind: 'shot' as const,
    beatId: 'beat_1',
    story: 'Move through the clean daylight space.',
    shotId,
    shootingScript: `Shooting script for ${shotId}`,
  };
  return composeStudioGenerationV2({
    projectRevision: 7,
    brief: 'A precise cinematic frame.',
    rules: [],
    source,
    purpose,
    referenceInputs: [...referenceInputs],
    aspectRatio: '16:9',
    resolution: '1080p',
    route,
    boardStyle: purpose === 'board_still' ? 'grey_tone' : null,
    instructionProfile: deriveStudioInstructionProfileV2(route, purpose, source),
  });
};

const templateFor = (shotId: string, purpose: Exclude<StudioJobPurpose, 'reference_image'>) => {
  const composition = compositionFor(shotId, purpose);
  return {
    composition,
    aspectRatio: composition.inputs.aspectRatio,
    resolution: composition.inputs.resolution,
    durationSeconds: purpose === 'board_still' ? 4 : 8,
    referenceInputs: composition.inputs.referenceInputs,
  };
};

const resolvedSeed = (shotId = 'shot_1'): StudioGenerationRequestPlan =>
  createStudioResolvedGenerationRequestPlan({
    purpose: 'seed_still',
    template: templateFor(shotId, 'seed_still'),
    conditioningInput: null,
  });

const resolvedVideo = (shotId = 'shot_1'): StudioGenerationRequestPlan =>
  createStudioResolvedGenerationRequestPlan({
    purpose: 'video_take',
    template: templateFor(shotId, 'video_take'),
    conditioningInput: { kind: 'seed_still', assetId: 'take_seed' },
  });

const resolvedBoard = (shotId = 'shot_1'): StudioGenerationRequestPlan =>
  createStudioResolvedGenerationRequestPlan({
    purpose: 'board_still',
    template: templateFor(shotId, 'board_still'),
    conditioningInput: null,
  });

const draft = (
  shotId: string,
  purpose: StudioQuotedGeneration['purpose'],
  generationCount: number,
  requestPlan: StudioGenerationRequestPlan
): StudioUnpricedQuotedGenerationV2 => ({
  target: { kind: 'shot', shotId },
  purpose,
  routeId: purpose === 'video_take' ? videoRate.routeId : imageRate.routeId,
  generationCount,
  requestPlan,
});

const makeInput = (): StudioSubmissionQuoteEstimateInputV2 => {
  const seedId = createStudioQuotedGenerationId({
    projectId: 'project_1',
    projectRevision: 7,
    target: { kind: 'shot', shotId: 'shot_1' },
    purpose: 'seed_still',
  });
  const upstreamVideoId = createStudioQuotedGenerationId({
    projectId: 'project_1',
    projectRevision: 7,
    target: { kind: 'shot', shotId: 'shot_1' },
    purpose: 'video_take',
  });
  return {
    project: makeProject(),
    originReferenceHandoffId: null,
    rateCard: createStudioRateCardV2([imageRate, videoRate]),
    baseItems: [draft('shot_1', 'seed_still', 1, resolvedSeed())],
    cascadeItems: [
      draft(
        'shot_1',
        'video_take',
        1,
        createStudioDeferredGenerationRequestPlan({
          template: templateFor('shot_1', 'video_take'),
          dependency: { kind: 'authorized_seed', upstreamItemId: seedId, shotId: 'shot_1' },
        })
      ),
      draft(
        'shot_2',
        'video_take',
        1,
        createStudioDeferredGenerationRequestPlan({
          template: templateFor('shot_2', 'video_take'),
          dependency: {
            kind: 'authorized_predecessor',
            upstreamItemId: upstreamVideoId,
            predecessorShotId: 'shot_1',
          },
        })
      ),
    ],
  };
};

const addDerivationAsset = (
  project: StudioProjectV2,
  asset: Pick<StudioAssetV2, 'id' | 'shotId' | 'mediaKind' | 'managedAsset'> &
    Partial<
      Pick<
        StudioAssetV2,
        'durationSeconds' | 'projectReferenceId' | 'generationReferenceAssetIds' | 'producerJobId' | 'compositionDigest'
      >
    >
): StudioAssetV2 => {
  const result: StudioAssetV2 = {
    id: asset.id,
    projectId: project.id,
    shotId: asset.shotId,
    mediaKind: asset.mediaKind,
    mimeType: asset.mediaKind === 'video' ? 'video/mp4' : asset.mediaKind === 'audio' ? 'audio/mpeg' : 'image/png',
    managedAsset: asset.managedAsset,
    byteSize: 10,
    sha256: 'a'.repeat(64),
    ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
    createdAt: '2026-08-18T00:00:00.000Z',
    projectReferenceId: asset.projectReferenceId ?? null,
    generationReferenceAssetIds: asset.generationReferenceAssetIds ?? [],
    producerJobId: asset.producerJobId ?? null,
    compositionDigest: asset.compositionDigest ?? null,
  };
  project.assets[result.id] = result;
  if (result.shotId !== null) project.shots[result.shotId]!.assetIds.push(result.id);
  return result;
};

const makePendingCharacterReference = (id: string, label: string): StudioProjectV2['references'][string] => ({
  id,
  kind: 'character',
  label,
  prompt: `A stable character sheet for ${label}.`,
  approvedAssetId: null,
  supersededAssetIds: [],
  jobIds: [],
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
});

const makeDerivationProject = (): StudioProjectV2 => {
  const project = createEmptyStudioProjectV2(
    {
      name: 'Quote composition',
      brief: 'A quiet journey through a changing space.',
      aspectRatio: '16:9',
      targetDurationSeconds: 24,
      resolution: '1080p',
    },
    'project_1',
    '2026-08-18T00:00:00.000Z'
  );
  project.revision = 7;
  project.imageRouteId = imageRate.routeId;
  project.videoRouteId = videoRate.routeId;
  project.beatOrder = ['beat_1'];
  project.beats.beat_1 = {
    id: 'beat_1',
    title: 'Opening',
    story: 'Move through the clean daylight space.',
    targetSeconds: null,
    shotOrder: ['shot_1', 'shot_2', 'shot_3'],
  };
  for (const shotId of project.beats.beat_1.shotOrder) project.shots[shotId] = makeShot(shotId);
  const backgroundAsset = addDerivationAsset(project, {
    id: 'approved_background',
    shotId: null,
    mediaKind: 'image',
    managedAsset: { collection: 'assets', fileName: 'approved_background.png' },
    projectReferenceId: 'reference_background',
  });
  project.referencePlanStatus = 'planned';
  project.referenceOrder = ['reference_background'];
  project.references.reference_background = {
    id: 'reference_background',
    kind: 'background',
    label: 'Recurring space',
    prompt: 'The same clean daylight atrium.',
    approvedAssetId: backgroundAsset.id,
    supersededAssetIds: [],
    jobIds: [],
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  };
  for (const shotId of project.beats.beat_1.shotOrder) {
    project.shots[shotId]!.referenceBinding = {
      status: 'ready',
      characterReferenceIds: [],
      backgroundReferenceId: 'reference_background',
    };
  }
  const seed = addDerivationAsset(project, {
    id: 'seed_1',
    shotId: 'shot_1',
    mediaKind: 'image',
    managedAsset: { collection: 'imports', fileName: 'seed_1.png' },
  });
  project.shots.shot_1!.seedStillId = seed.id;
  return project;
};

const makeBoardDerivationProject = (shotCount = 3): StudioProjectV2 => {
  const project = makeDerivationProject();
  const shotIds = Array.from({ length: shotCount }, (_, index) => `shot_${index + 1}`);
  project.boardStyle = 'grey_tone';
  const beatIds = Array.from(
    { length: Math.ceil(shotCount / STUDIO_MAX_SHOTS_PER_BEAT) },
    (_, index) => `beat_${index + 1}`
  );
  project.beatOrder = beatIds;
  project.beats = Object.fromEntries(
    beatIds.map((beatId, beatIndex) => [
      beatId,
      {
        id: beatId,
        title: beatIndex === 0 ? 'Opening' : `Beat ${beatIndex + 1}`,
        story: beatIndex === 0 ? 'Move through the clean daylight space.' : `Story ${beatIndex + 1}`,
        targetSeconds: null,
        shotOrder: shotIds.slice(beatIndex * STUDIO_MAX_SHOTS_PER_BEAT, (beatIndex + 1) * STUDIO_MAX_SHOTS_PER_BEAT),
      },
    ])
  );
  project.shots = Object.fromEntries(shotIds.map((shotId) => [shotId, makeShot(shotId)]));
  project.assets = {};
  project.referencePlanStatus = 'planned';
  project.referenceOrder = [];
  project.references = {};
  return project;
};

const addCurrentBoardPanel = (project: StudioProjectV2, shotId: string, assetId = `board_${shotId}`): StudioAssetV2 => {
  project.boardStyle = 'grey_tone';
  const beat = Object.values(project.beats).find((candidate) => candidate.shotOrder.includes(shotId));
  const shot = project.shots[shotId];
  if (beat === undefined || shot === undefined) throw new Error('Board fixture requires one active Shot');
  const requestPlan = createStudioBoardGenerationRequestPlanForShot({
    project,
    beat,
    shot,
    route: imageProvider,
    referenceInputs: [],
  });
  if (requestPlan === null || requestPlan.kind !== 'resolved') throw new Error('Board fixture request must resolve');
  const asset = addDerivationAsset(project, {
    id: assetId,
    shotId,
    mediaKind: 'image',
    managedAsset: { collection: 'boardStills', fileName: `${assetId}.png` },
  });
  const jobId = `job_${assetId}`;
  project.jobs[jobId] = {
    id: jobId,
    projectId: project.id,
    target: { kind: 'shot', shotId },
    status: 'succeeded',
    provider: imageProvider,
    idempotencyKey: `idem_${assetId}`,
    providerJobId: `remote_${assetId}`,
    remoteStartedAt: '2026-08-18T00:00:00.000Z',
    cancellationPolicy: 'queued_and_running',
    outputAssetIds: [asset.id],
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    purpose: 'board_still',
    authorizationId: `auth_${assetId}`,
    authorizationItemId: `item_${assetId}`,
    composition: requestPlan.snapshot.composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: {
      authorizationId: `auth_${assetId}`,
      itemId: `item_${assetId}`,
      jobId,
      purpose: 'board_still',
      routeId: project.imageRouteId!,
      currency: 'USD',
      rateUnit: 'generation',
      rateMinorUnits: imageRate.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: imageRate.rateMinorUnits,
    },
    outputAssetIdsByRole: { primary: asset.id, poster: null },
  };
  asset.producerJobId = jobId;
  asset.compositionDigest = studioGenerationCompositionDigestV2(requestPlan.snapshot.composition);
  asset.generationReferenceAssetIds = requestPlan.snapshot.referenceInputs.map((reference) => reference.assetId);
  shot.jobIds.push(jobId);
  shot.boardAssetId = asset.id;
  return asset;
};

const addSelectedVideo = (project: StudioProjectV2, shotId: string, assetId = `video_${shotId}`): StudioAssetV2 => {
  const asset = addDerivationAsset(project, {
    id: assetId,
    shotId,
    mediaKind: 'video',
    managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
    durationSeconds: project.shots[shotId]!.durationSeconds,
  });
  project.shots[shotId]!.videoAssetId = asset.id;
  return asset;
};

const prepareRequest = (
  baseChoices: StudioPrepareSubmissionRequestV2['baseChoices'],
  cascadeChoices: StudioPrepareSubmissionRequestV2['cascadeChoices']
): StudioPrepareSubmissionRequestV2 => ({
  projectId: 'project_1',
  expectedRevision: 7,
  originReferenceHandoffId: null,
  baseChoices,
  cascadeChoices,
});

const choice = (
  shotId: string,
  purpose: StudioPrepareGenerationChoiceV2['purpose']
): StudioPrepareSubmissionRequestV2['baseChoices'][number] => ({
  target: { kind: 'shot', shotId },
  purpose,
});

const deriveFirstSeedQuote = (project: StudioProjectV2) =>
  deriveStudioSubmissionQuoteCoresV2({
    project,
    request: prepareRequest([choice('shot_1', 'seed_still')], []),
    rateCard: createStudioRateCardV2([imageRate]),
  });

const continuityRequest = (
  shotId: string,
  hardCut: boolean,
  requiresSeedGeneration: boolean
): StudioPrepareSubmissionRequestV2 =>
  ({
    projectId: 'project_1',
    expectedRevision: 7,
    originReferenceHandoffId: null,
    baseChoices: [],
    cascadeChoices: [],
    continuityChange: { shotId, hardCut, requiresSeedGeneration },
  }) as unknown as StudioPrepareSubmissionRequestV2;

const boardPromotionRequest = (shotId: string, boardAssetId: string): StudioPrepareSubmissionRequestV2 => ({
  projectId: 'project_1',
  expectedRevision: 7,
  originReferenceHandoffId: null,
  baseChoices: [],
  cascadeChoices: [],
  boardPromotion: { shotId, boardAssetId },
});

describe('schema-2 Studio estimates', () => {
  it('derives one image-priced resolved Board item per selected Shot in film order', () => {
    const project = makeBoardDerivationProject();
    const request = prepareRequest(
      [choice('shot_1', 'board_still'), choice('shot_2', 'board_still'), choice('shot_3', 'board_still')],
      []
    );

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request,
      rateCard: createStudioRateCardV2([imageRate]),
    });

    expect(options.withCascade).toBeNull();
    expect(options.baseOnly).toMatchObject({
      lowerMinorUnits: 75,
      upperMinorUnits: 75,
      cascadeItems: [],
      baseItems: [
        {
          target: { kind: 'shot', shotId: 'shot_1' },
          purpose: 'board_still',
          routeId: 'image_route',
          rateUnit: 'generation',
        },
        {
          target: { kind: 'shot', shotId: 'shot_2' },
          purpose: 'board_still',
          routeId: 'image_route',
          rateUnit: 'generation',
        },
        {
          target: { kind: 'shot', shotId: 'shot_3' },
          purpose: 'board_still',
          routeId: 'image_route',
          rateUnit: 'generation',
        },
      ],
    });
    const firstPlan = options.baseOnly.baseItems[0]!.requestPlan;
    expect(firstPlan).toEqual(
      expect.objectContaining({
        kind: 'resolved',
        snapshot: expect.objectContaining({
          durationSeconds: 4,
          referenceInputs: [],
          conditioningInput: null,
        }),
      })
    );
    expect(firstPlan.kind === 'resolved' ? firstPlan.snapshot.composition.prompt : '').toContain(
      'STORY\nMove through the clean daylight space.'
    );
    expect(firstPlan.kind === 'resolved' ? firstPlan.snapshot.composition.prompt : '').toContain(
      'BOARD STYLE\nUse a restrained grey-tone storyboard drawing'
    );
  });

  it('accepts exactly 24 Board Shots and refuses a twenty-fifth', () => {
    const project = makeBoardDerivationProject(25);
    const rateCard = createStudioRateCardV2([imageRate]);
    const choices = project.beatOrder.flatMap((beatId) =>
      project.beats[beatId]!.shotOrder.map((shotId) => choice(shotId, 'board_still'))
    );

    expect(
      deriveStudioSubmissionQuoteCoresV2({
        project,
        request: prepareRequest(choices.slice(0, 24), []),
        rateCard,
      }).baseOnly.baseItems
    ).toHaveLength(24);
    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({ project, request: prepareRequest(choices, []), rateCard })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
  });

  it.each([
    [
      'mixed purpose',
      prepareRequest([choice('shot_1', 'board_still'), choice('shot_2', 'seed_still')], []),
      'invalid_prepare_request',
    ],
    [
      'cascade row',
      prepareRequest([choice('shot_1', 'board_still')], [choice('shot_2', 'board_still')]),
      'invalid_prepare_request',
    ],
    [
      'renderer reference',
      {
        ...prepareRequest([choice('shot_1', 'board_still')], []),
        baseChoices: [{ ...choice('shot_1', 'board_still'), referenceAssetId: 'reference_1' }],
      },
      'invalid_prepare_request',
    ],
    [
      'out-of-order rows',
      prepareRequest([choice('shot_2', 'board_still'), choice('shot_1', 'board_still')], []),
      'invalid_prepare_request',
    ],
  ] as const)('refuses a Board batch with %s', (_label, request, code) => {
    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({
        project: makeBoardDerivationProject(),
        request,
        rateCard: createStudioRateCardV2([imageRate]),
      })
    ).toThrow(expect.objectContaining({ code }));
  });

  it('refuses Board handoffs, continuity envelopes, unset style, and in-flight Board work', () => {
    const project = makeBoardDerivationProject();
    const rateCard = createStudioRateCardV2([imageRate]);
    const board = prepareRequest([choice('shot_1', 'board_still')], []);

    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({
        project,
        request: { ...board, originReferenceHandoffId: 'handoff_1' },
        rateCard,
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({
        project,
        request: { ...board, continuityChange: { shotId: 'shot_1', hardCut: true, requiresSeedGeneration: false } },
        rateCard,
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    project.boardStyle = null;
    expect(() => deriveStudioSubmissionQuoteCoresV2({ project, request: board, rateCard })).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
    project.boardStyle = 'grey_tone';
    project.jobs.job_board = {
      target: { kind: 'shot', shotId: 'shot_1' },
      purpose: 'board_still',
      status: 'running',
    } as StudioProjectV2['jobs'][string];
    expect(() => deriveStudioSubmissionQuoteCoresV2({ project, request: board, rateCard })).toThrow(
      expect.objectContaining({ code: 'in_flight' })
    );
  });

  it('prices only selected takes in the promoted Board panel segment and derives against the candidate pin', () => {
    const project = makeBoardDerivationProject(4);
    const panel = addCurrentBoardPanel(project, 'shot_1');
    addSelectedVideo(project, 'shot_1');
    addSelectedVideo(project, 'shot_2');
    project.shots.shot_4!.chainBreak = 'hard_cut';
    addSelectedVideo(project, 'shot_4');

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: boardPromotionRequest('shot_1', panel.id),
      rateCard: createStudioRateCardV2([videoRate]),
    });

    expect(options.withCascade).toBeNull();
    expect(options.baseOnly.cascadeItems).toEqual([]);
    expect(
      options.baseOnly.baseItems.map(({ target, purpose }) => [
        target.kind === 'shot' ? target.shotId : target.referenceId,
        purpose,
      ])
    ).toEqual([
      ['shot_1', 'video_take'],
      ['shot_2', 'video_take'],
    ]);
    expect(options.baseOnly.baseItems[0]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'resolved',
        snapshot: expect.objectContaining({ conditioningInput: { kind: 'seed_still', assetId: panel.id } }),
      })
    );
    expect(options.baseOnly.baseItems[1]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'after_take_selection',
        dependency: expect.objectContaining({
          kind: 'authorized_predecessor',
          predecessorShotId: 'shot_1',
        }),
      })
    );
    expect(project.shots.shot_1!.seedStillId).toBeNull();
    expect(JSON.stringify(options)).not.toContain('shot_4');
  });

  it('refuses paid Board promotion when no selected take would be made stale', () => {
    const project = makeBoardDerivationProject();
    const panel = addCurrentBoardPanel(project, 'shot_1');
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({ project, request: boardPromotionRequest('shot_1', panel.id) })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
  });

  it('refuses non-head, mismatched, stale, in-flight, and mixed Board promotion intents', () => {
    const nonHead = makeBoardDerivationProject();
    const nonHeadPanel = addCurrentBoardPanel(nonHead, 'shot_2');
    addSelectedVideo(nonHead, 'shot_2');
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({
        project: nonHead,
        request: boardPromotionRequest('shot_2', nonHeadPanel.id),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const project = makeBoardDerivationProject();
    const panel = addCurrentBoardPanel(project, 'shot_1');
    addSelectedVideo(project, 'shot_1');
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({
        project,
        request: boardPromotionRequest('shot_1', 'other_board'),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const stale = structuredClone(project);
    stale.shots.shot_1!.shootingScript = 'Changed after Board generation';
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({ project: stale, request: boardPromotionRequest('shot_1', panel.id) })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const alreadyPinned = structuredClone(project);
    alreadyPinned.shots.shot_1!.seedStillId = panel.id;
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({
        project: alreadyPinned,
        request: boardPromotionRequest('shot_1', panel.id),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const inFlight = structuredClone(project);
    const producer = inFlight.jobs[`job_${panel.id}`]!;
    inFlight.jobs.job_board_redraw = {
      ...producer,
      id: 'job_board_redraw',
      status: 'running',
      providerJobId: 'remote_board_redraw',
      idempotencyKey: 'idem_board_redraw',
      outputAssetIds: [],
      outputAssetIdsByRole: { primary: null, poster: null },
      spendReceipt: null,
    };
    inFlight.shots.shot_1!.jobIds.push('job_board_redraw');
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({ project: inFlight, request: boardPromotionRequest('shot_1', panel.id) })
    ).toThrow(expect.objectContaining({ code: 'in_flight' }));

    const pendingFrame = structuredClone(project);
    const selected = pendingFrame.assets.video_shot_1!;
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: selected.id,
      endpointSeconds: selected.durationSeconds!,
    });
    pendingFrame.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      videoAssetId: selected.id,
      endpointSeconds: selected.durationSeconds!,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
    };
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({
        project: pendingFrame,
        request: boardPromotionRequest('shot_1', panel.id),
      })
    ).toThrow(expect.objectContaining({ code: 'in_flight' }));

    const mixedChoice = {
      ...boardPromotionRequest('shot_1', panel.id),
      baseChoices: [choice('shot_1', 'video_take')],
    };
    const mixedContinuity = {
      ...boardPromotionRequest('shot_1', panel.id),
      continuityChange: { shotId: 'shot_2', hardCut: true, requiresSeedGeneration: true },
    };
    const handoff = { ...boardPromotionRequest('shot_1', panel.id), originReferenceHandoffId: 'handoff_1' };
    for (const request of [mixedChoice, mixedContinuity, handoff]) {
      expect(() => deriveStudioSubmissionQuoteGraphV2({ project, request })).toThrow(
        expect.objectContaining({ code: 'invalid_prepare_request' })
      );
    }
  });

  it('prices one mandatory sever graph from an exact reusable seed through the next hard cut', () => {
    const project = makeDerivationProject();
    project.beats.beat_1!.shotOrder.push('shot_4');
    project.shots.shot_4 = makeShot('shot_4');
    project.shots.shot_4!.chainBreak = 'hard_cut';
    const reusableSeed = addDerivationAsset(project, {
      id: 'seed_2',
      shotId: 'shot_2',
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'seed_2.png' },
    });

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: continuityRequest('shot_2', true, false),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.withCascade).toBeNull();
    expect(options.baseOnly.baseItems).toEqual([
      expect.objectContaining({
        target: { kind: 'shot', shotId: 'shot_2' },
        purpose: 'video_take',
        generationCount: 1,
        requestPlan: expect.objectContaining({
          kind: 'resolved',
          snapshot: expect.objectContaining({ conditioningInput: { kind: 'seed_still', assetId: reusableSeed.id } }),
        }),
      }),
      expect.objectContaining({
        target: { kind: 'shot', shotId: 'shot_3' },
        purpose: 'video_take',
        generationCount: 1,
        requestPlan: expect.objectContaining({
          kind: 'after_take_selection',
          dependency: expect.objectContaining({
            kind: 'authorized_predecessor',
            predecessorShotId: 'shot_2',
          }),
        }),
      }),
    ]);
    expect(options.baseOnly.cascadeItems).toEqual([]);
    expect(JSON.stringify(options)).not.toContain('shot_4');
  });

  it('does not reuse a displaced project-reference output as a Shot seed', () => {
    const project = makeDerivationProject();
    const historicalReferenceOutput = addDerivationAsset(project, {
      id: 'historical_reference_output',
      shotId: null,
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'historical_reference_output.png' },
      projectReferenceId: 'reference_background',
    });
    expect(historicalReferenceOutput.projectReferenceId).toBe('reference_background');

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: continuityRequest('shot_2', true, true),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(
      options.baseOnly.baseItems.map(({ target, purpose, generationCount }) => [
        target.kind === 'shot' ? target.shotId : target.referenceId,
        purpose,
        generationCount,
      ])
    ).toEqual([
      ['shot_2', 'seed_still', 1],
      ['shot_2', 'video_take', 1],
      ['shot_3', 'video_take', 1],
    ]);
  });

  it('prices exactly one new seed and one mandatory replacement per affected Shot when sever has no seed', () => {
    const project = makeDerivationProject();

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: continuityRequest('shot_2', true, true),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.withCascade).toBeNull();
    expect(
      options.baseOnly.baseItems.map(({ target, purpose, generationCount }) => [
        target.kind === 'shot' ? target.shotId : target.referenceId,
        purpose,
        generationCount,
      ])
    ).toEqual([
      ['shot_2', 'seed_still', 1],
      ['shot_2', 'video_take', 1],
      ['shot_3', 'video_take', 1],
    ]);
    expect(options.baseOnly.baseItems[1]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'after_take_selection',
        dependency: expect.objectContaining({ kind: 'authorized_seed', shotId: 'shot_2' }),
      })
    );
  });

  it('snapshots the exact trim-aware existing predecessor for one mandatory rejoin graph', () => {
    const project = makeDerivationProject();
    project.shots.shot_2!.chainBreak = 'hard_cut';
    const predecessorTake = addDerivationAsset(project, {
      id: 'take_1',
      shotId: 'shot_1',
      mediaKind: 'video',
      managedAsset: { collection: 'assets', fileName: 'take_1.mp4' },
      durationSeconds: 10,
    });
    project.shots.shot_1!.videoAssetId = predecessorTake.id;
    project.shots.shot_1!.trimOutSeconds = 2;

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: continuityRequest('shot_2', false, false),
      rateCard: createStudioRateCardV2([videoRate]),
    });

    expect(options.withCascade).toBeNull();
    expect(
      options.baseOnly.baseItems.map(({ target, purpose, generationCount }) => [
        target.kind === 'shot' ? target.shotId : target.referenceId,
        purpose,
        generationCount,
      ])
    ).toEqual([
      ['shot_2', 'video_take', 1],
      ['shot_3', 'video_take', 1],
    ]);
    expect(options.baseOnly.baseItems[0]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'after_take_selection',
        dependency: {
          kind: 'existing_predecessor',
          predecessorShotId: 'shot_1',
          takeAssetId: predecessorTake.id,
          endpointSeconds: 8,
        },
      })
    );
  });

  it.each([
    ['first Shot', continuityRequest('shot_1', true, true)],
    ['no-op sever', continuityRequest('shot_2', false, false)],
  ])('rejects a continuity quote for the %s without consulting paid routes', (_label, request) => {
    expect(() => deriveStudioSubmissionQuoteGraphV2({ project: makeDerivationProject(), request })).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
  });

  it('rejects a renderer seed-route hint that disagrees with canonical main-owned eligibility', () => {
    const missingSeed = makeDerivationProject();
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({
        project: missingSeed,
        request: continuityRequest('shot_2', true, false),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const reusableSeed = makeDerivationProject();
    addDerivationAsset(reusableSeed, {
      id: 'seed_2',
      shotId: 'shot_2',
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'seed_2.png' },
    });
    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({
        project: reusableSeed,
        request: continuityRequest('shot_2', true, true),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
  });

  it('refuses an in-flight mandatory continuity row instead of truncating its paid graph', () => {
    const project = makeDerivationProject();
    project.jobs.active_downstream = {
      target: { kind: 'shot', shotId: 'shot_3' },
      purpose: 'video_take',
      status: 'running',
    } as StudioProjectV2['jobs'][string];

    expect(() =>
      deriveStudioSubmissionQuoteGraphV2({
        project,
        request: continuityRequest('shot_2', true, true),
      })
    ).toThrow(expect.objectContaining({ code: 'in_flight' }));
  });

  it('derives byte-identical base rows and the complete downstream symbolic graph', () => {
    const project = makeDerivationProject();
    const request = prepareRequest(
      [choice('shot_1', 'video_take')],
      [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    );

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request,
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.request).toEqual(request);
    expect(options.withCascade?.baseItems).toEqual(options.baseOnly.baseItems);
    expect(options.baseOnly.cascadeItems).toEqual([]);
    expect(
      options.withCascade?.cascadeItems.map(({ target, requestPlan }) => [
        target.kind === 'shot' ? target.shotId : target.referenceId,
        requestPlan,
      ])
    ).toEqual([
      [
        'shot_2',
        expect.objectContaining({
          kind: 'after_take_selection',
          dependency: {
            kind: 'authorized_predecessor',
            predecessorShotId: 'shot_1',
            upstreamItemId: createStudioQuotedGenerationId({
              projectId: project.id,
              projectRevision: project.revision,
              target: { kind: 'shot', shotId: 'shot_1' },
              purpose: 'video_take',
            }),
          },
        }),
      ],
      [
        'shot_3',
        expect.objectContaining({
          kind: 'after_take_selection',
          dependency: {
            kind: 'authorized_predecessor',
            predecessorShotId: 'shot_2',
            upstreamItemId: createStudioQuotedGenerationId({
              projectId: project.id,
              projectRevision: project.revision,
              target: { kind: 'shot', shotId: 'shot_2' },
              purpose: 'video_take',
            }),
          },
        }),
      ],
    ]);
    expect(options.baseOnly.lowerMinorUnits).toBe(56);
    expect(options.baseOnly.upperMinorUnits).toBe(56);
    expect(options.withCascade).toMatchObject({ lowerMinorUnits: 168, upperMinorUnits: 168 });
  });

  it('derives a same-shot video barrier after a reviewed head seed', () => {
    const project = makeDerivationProject();
    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest(
        [choice('shot_1', 'seed_still')],
        [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
      ),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.withCascade?.cascadeItems[0]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'after_take_selection',
        dependency: {
          kind: 'authorized_seed',
          shotId: 'shot_1',
          upstreamItemId: options.baseOnly.baseItems[0]!.id,
        },
      })
    );
    expect(
      options.withCascade?.cascadeItems.slice(1).every((item) => item.requestPlan.kind === 'after_take_selection')
    ).toBe(true);
  });

  it('derives the canonical same-shot and downstream cascade when an ordinary seed request leaves it empty', () => {
    const project = makeDerivationProject();
    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest([choice('shot_1', 'seed_still')], []),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.request.cascadeChoices).toEqual([
      choice('shot_1', 'video_take'),
      choice('shot_2', 'video_take'),
      choice('shot_3', 'video_take'),
    ]);
    expect(
      options.withCascade?.cascadeItems.map(({ target, generationCount }) => [
        target.kind === 'shot' ? target.shotId : target.referenceId,
        generationCount,
      ])
    ).toEqual([
      ['shot_1', 1],
      ['shot_2', 1],
      ['shot_3', 1],
    ]);
  });

  it('derives only eligible downstream video choices across hard-cut and in-flight boundaries', () => {
    const project = makeDerivationProject();
    project.beats.beat_1!.shotOrder.push('shot_4', 'shot_5');
    project.shots.shot_4 = makeShot('shot_4');
    project.shots.shot_5 = makeShot('shot_5');
    project.shots.shot_4!.chainBreak = 'hard_cut';
    const hardCutSeed = addDerivationAsset(project, {
      id: 'seed_4',
      shotId: 'shot_4',
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'seed_4.png' },
    });
    project.shots.shot_4!.seedStillId = hardCutSeed.id;
    project.jobs.external_job = {
      target: { kind: 'shot', shotId: 'shot_3' },
      purpose: 'video_take',
      status: 'queued_remote',
    } as StudioProjectV2['jobs'][string];

    const beforeBarrier = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest([choice('shot_1', 'video_take')], []),
      rateCard: createStudioRateCardV2([videoRate]),
    });
    const afterHardCut = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest([choice('shot_4', 'video_take')], []),
      rateCard: createStudioRateCardV2([videoRate]),
    });

    expect(beforeBarrier.request.cascadeChoices).toEqual([choice('shot_2', 'video_take')]);
    expect(afterHardCut.request.cascadeChoices).toEqual([choice('shot_5', 'video_take')]);
  });

  it('keeps an exact seed base quote when only its cascade route or rate is unavailable', () => {
    const project = makeDerivationProject();
    const request = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    );
    const available = deriveStudioSubmissionQuoteCoresV2({
      project,
      request,
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });
    const missingRate = deriveStudioSubmissionQuoteCoresV2({
      project,
      request,
      rateCard: createStudioRateCardV2([imageRate]),
    });
    const missingRouteProject = structuredClone(project);
    missingRouteProject.videoRouteId = null;
    const missingRoute = deriveStudioSubmissionQuoteCoresV2({
      project: missingRouteProject,
      request,
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(available.withCascade).not.toBeNull();
    expect(available.withCascade?.rateCardDigest).not.toBe(available.baseOnly.rateCardDigest);
    expect(missingRate).toEqual({ request, baseOnly: available.baseOnly, withCascade: null });
    expect(missingRoute).toEqual({ request, baseOnly: available.baseOnly, withCascade: null });
  });

  it('does not hide a missing base route as cascade unavailability', () => {
    const project = makeDerivationProject();
    project.imageRouteId = null;

    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({
        project,
        request: prepareRequest(
          [choice('shot_1', 'seed_still')],
          [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        ),
        rateCard: createStudioRateCardV2([imageRate, videoRate]),
      })
    ).toThrow(expect.objectContaining({ code: 'missing_route' }));
  });

  it('resolves the exact current predecessor frame when no earlier option item supplies it', () => {
    const project = makeDerivationProject();
    const take = addDerivationAsset(project, {
      id: 'take_1',
      shotId: 'shot_1',
      mediaKind: 'video',
      managedAsset: { collection: 'assets', fileName: 'take_1.mp4' },
      durationSeconds: 10,
    });
    project.shots.shot_1!.videoAssetId = take.id;
    project.shots.shot_1!.trimOutSeconds = 2;
    const frame = addDerivationAsset(project, {
      id: 'frame_1',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'conditioningFrames', fileName: 'frame_1.png' },
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
    });
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
      frameAssetId: frame.id,
      status: 'ready',
      errorCode: null,
    };
    project.shots.shot_3!.chainBreak = 'hard_cut';

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest([choice('shot_2', 'video_take')], []),
      rateCard: createStudioRateCardV2([videoRate]),
    });

    expect(options.withCascade).toBeNull();
    expect(options.baseOnly.baseItems[0]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'resolved',
        snapshot: expect.objectContaining({
          conditioningInput: {
            kind: 'predecessor_frame',
            predecessorShotId: 'shot_1',
            takeAssetId: 'take_1',
            frameAssetId: 'frame_1',
            endpointSeconds: 8,
          },
        }),
      })
    );
  });

  it('freezes multiple approved characters and exactly one background in canonical reference order', () => {
    const project = makeDerivationProject();
    project.boardStyle = 'grey_tone';
    const characterA = addDerivationAsset(project, {
      id: 'approved_character_a',
      shotId: null,
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'approved_character_a.png' },
      projectReferenceId: 'reference_character_a',
    });
    const characterB = addDerivationAsset(project, {
      id: 'approved_character_b',
      shotId: null,
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'approved_character_b.png' },
      projectReferenceId: 'reference_character_b',
    });
    const background = project.references.reference_background!;
    project.referenceOrder = ['reference_character_a', 'reference_character_b', background.id];
    project.references = {
      reference_character_a: {
        id: 'reference_character_a',
        kind: 'character',
        label: 'Ming',
        prompt: 'A precise character sheet for Ming.',
        approvedAssetId: characterA.id,
        supersededAssetIds: [],
        jobIds: [],
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
      reference_character_b: {
        id: 'reference_character_b',
        kind: 'character',
        label: 'Mei',
        prompt: 'A precise character sheet for Mei.',
        approvedAssetId: characterB.id,
        supersededAssetIds: [],
        jobIds: [],
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
      [background.id]: background,
    };
    project.shots.shot_1!.referenceBinding = {
      status: 'ready',
      characterReferenceIds: ['reference_character_a', 'reference_character_b'],
      backgroundReferenceId: background.id,
    };

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest([choice('shot_1', 'board_still')], []),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.baseOnly.baseItems[0]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'resolved',
        snapshot: expect.objectContaining({
          referenceInputs: [
            {
              referenceId: 'reference_character_a',
              kind: 'character',
              assetId: characterA.id,
              sha256: characterA.sha256,
            },
            {
              referenceId: 'reference_character_b',
              kind: 'character',
              assetId: characterB.id,
              sha256: characterB.sha256,
            },
            {
              referenceId: background.id,
              kind: 'background',
              assetId: background.approvedAssetId,
              sha256: project.assets[background.approvedAssetId!]!.sha256,
            },
          ],
        }),
      })
    );

    const rendererQuote = toStudioRendererSubmissionQuoteV2(
      { ...options.baseOnly, id: 'quote_bound_board', expiresAt: '2026-08-18T00:05:00.000Z' },
      null,
      (routeId) => ({ choiceId: routeId, providerId: 'image-provider', model: 'image-model' }),
      (referenceId) => {
        const reference = project.references[referenceId];
        return reference === undefined ? null : { kind: reference.kind, label: reference.label };
      }
    );
    expect(rendererQuote.baseItems[0]?.referenceTarget).toBeNull();
    expect(rendererQuote.baseItems[0]?.composition.inputs.referenceInputs).toEqual([
      { referenceId: 'reference_character_a', kind: 'character', label: 'Ming', assetId: characterA.id },
      { referenceId: 'reference_character_b', kind: 'character', label: 'Mei', assetId: characterB.id },
      {
        referenceId: background.id,
        kind: 'background',
        label: 'Recurring space',
        assetId: background.approvedAssetId,
      },
    ]);
    const serializedRendererQuote = JSON.stringify(rendererQuote);
    expect(serializedRendererQuote).not.toContain('sha256');
    expect(serializedRendererQuote).not.toContain(characterA.sha256);
    expect(serializedRendererQuote).not.toContain('requestPlan');

    project.shots.shot_1!.referenceBinding.backgroundReferenceId = 'reference_character_a';
    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({
        project,
        request: prepareRequest([choice('shot_1', 'seed_still')], []),
        rateCard: createStudioRateCardV2([imageRate]),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_reference' }));
  });

  it('fails closed for malformed, ambiguous, missing, or unapproved Shot reference composition', () => {
    const unknown = makeDerivationProject();
    unknown.shots.shot_1!.referenceBinding.backgroundReferenceId = 'reference_unknown';

    const duplicate = makeDerivationProject();
    duplicate.shots.shot_1!.referenceBinding.characterReferenceIds = ['reference_background'];

    const ambiguousBackground = makeDerivationProject();
    const secondBackgroundAsset = addDerivationAsset(ambiguousBackground, {
      id: 'approved_background_2',
      shotId: null,
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'approved_background_2.png' },
      projectReferenceId: 'reference_background_2',
    });
    ambiguousBackground.referenceOrder.push('reference_background_2');
    ambiguousBackground.references.reference_background_2 = {
      id: 'reference_background_2',
      kind: 'background',
      label: 'Second recurring space',
      prompt: 'A different location that makes the Shot ambiguous.',
      approvedAssetId: secondBackgroundAsset.id,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    };
    ambiguousBackground.shots.shot_1!.referenceBinding.characterReferenceIds = ['reference_background_2'];

    const missing = makeDerivationProject();
    missing.shots.shot_1!.referenceBinding = {
      status: 'unassigned',
      characterReferenceIds: [],
      backgroundReferenceId: null,
    };

    const unapprovedCharacter = makeDerivationProject();
    unapprovedCharacter.referenceOrder.unshift('reference_character');
    unapprovedCharacter.references.reference_character = makePendingCharacterReference('reference_character', 'Ming');
    unapprovedCharacter.shots.shot_1!.referenceBinding.characterReferenceIds = ['reference_character'];

    const unapprovedBackground = makeDerivationProject();
    unapprovedBackground.references.reference_background!.approvedAssetId = null;

    for (const project of [
      unknown,
      duplicate,
      ambiguousBackground,
      missing,
      unapprovedCharacter,
      unapprovedBackground,
    ]) {
      expect(() => deriveFirstSeedQuote(project)).toThrow(expect.objectContaining({ code: 'invalid_reference' }));
    }
  });

  it('keeps two direct semantic reference targets distinct and gates backgrounds on character approval', () => {
    const project = makeDerivationProject();
    const background = project.references.reference_background!;
    project.referenceOrder = ['reference_ming', 'reference_mei', background.id];
    project.references = {
      reference_ming: makePendingCharacterReference('reference_ming', 'Ming'),
      reference_mei: makePendingCharacterReference('reference_mei', 'Mei'),
      [background.id]: background,
    };

    const graph = deriveStudioProjectReferenceSubmissionQuoteGraphV2({
      project,
      request: {
        projectId: project.id,
        expectedRevision: project.revision,
        referenceIds: ['reference_ming', 'reference_mei'],
      },
    });
    const quote = priceStudioSubmissionQuoteGraphV2({
      project,
      graph,
      rateCard: createStudioRateCardV2([imageRate]),
    }).baseOnly;
    expect(quote.baseItems.map((item) => [item.target, item.purpose])).toEqual([
      [{ kind: 'reference', referenceId: 'reference_ming' }, 'reference_image'],
      [{ kind: 'reference', referenceId: 'reference_mei' }, 'reference_image'],
    ]);
    expect(new Set(quote.baseItems.map((item) => item.id)).size).toBe(2);
    const rendererQuote = toStudioRendererSubmissionQuoteV2(
      { ...quote, id: 'quote_reference_characters', expiresAt: '2026-08-18T00:05:00.000Z' },
      null,
      (routeId) => ({ choiceId: routeId, providerId: 'image-provider', model: 'image-model' }),
      (referenceId) => {
        const reference = project.references[referenceId];
        return reference === undefined ? null : { kind: reference.kind, label: reference.label };
      }
    );
    expect(rendererQuote.baseItems.map((item) => [item.target, item.purpose])).toEqual([
      [{ kind: 'reference', referenceId: 'reference_ming' }, 'reference_image'],
      [{ kind: 'reference', referenceId: 'reference_mei' }, 'reference_image'],
    ]);
    expect(rendererQuote.baseItems.map((item) => item.referenceTarget)).toEqual([
      { referenceId: 'reference_ming', kind: 'character', label: 'Ming' },
      { referenceId: 'reference_mei', kind: 'character', label: 'Mei' },
    ]);

    expect(() =>
      deriveStudioProjectReferenceSubmissionQuoteGraphV2({
        project,
        request: {
          projectId: project.id,
          expectedRevision: project.revision,
          referenceIds: [background.id],
        },
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_reference' }));
  });

  it('regenerates an approved reference after its prior direct job reached a terminal state', () => {
    const project = makeDerivationProject();
    const reference = project.references.reference_background!;
    const terminalJobId = 'job_terminal_reference_background';
    project.jobs[terminalJobId] = {
      id: terminalJobId,
      projectId: project.id,
      target: { kind: 'reference', referenceId: reference.id },
      status: 'succeeded',
      purpose: 'reference_image',
    } as StudioProjectV2['jobs'][string];
    reference.jobIds.push(terminalJobId);

    const graph = deriveStudioProjectReferenceSubmissionQuoteGraphV2({
      project,
      request: {
        projectId: project.id,
        expectedRevision: project.revision,
        referenceIds: [reference.id],
      },
    });

    expect(graph.baseItems).toEqual([
      expect.objectContaining({
        target: { kind: 'reference', referenceId: reference.id },
        purpose: 'reference_image',
      }),
    ]);
  });

  it('allows a failed direct-reference retry after an unrelated Shot is parked', () => {
    const project = makeDerivationProject();
    const reference = project.references.reference_background!;
    const failedJobId = 'job_failed_reference_background';
    project.jobs[failedJobId] = {
      id: failedJobId,
      projectId: project.id,
      target: { kind: 'reference', referenceId: reference.id },
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
      purpose: 'reference_image',
    } as StudioProjectV2['jobs'][string];
    reference.jobIds.push(failedJobId);
    project.beats.beat_1!.shotOrder = ['shot_1', 'shot_3'];
    project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_2', reason: 'lifted' });

    expect(
      deriveStudioProjectReferenceSubmissionQuoteGraphV2({
        project,
        request: {
          projectId: project.id,
          expectedRevision: project.revision,
          referenceIds: [reference.id],
        },
      }).baseItems
    ).toEqual([
      expect.objectContaining({
        target: { kind: 'reference', referenceId: reference.id },
        purpose: 'reference_image',
      }),
    ]);
  });

  it('blocks a project-reference quote while that semantic reference has live direct work', () => {
    const project = makeDerivationProject();
    const reference = project.references.reference_background!;
    const liveJobId = 'job_live_reference_background';
    project.jobs[liveJobId] = {
      id: liveJobId,
      projectId: project.id,
      target: { kind: 'reference', referenceId: reference.id },
      status: 'running',
      purpose: 'reference_image',
    } as StudioProjectV2['jobs'][string];
    reference.jobIds.push(liveJobId);

    expect(() =>
      deriveStudioProjectReferenceSubmissionQuoteGraphV2({
        project,
        request: {
          projectId: project.id,
          expectedRevision: project.revision,
          referenceIds: [reference.id],
        },
      })
    ).toThrow(expect.objectContaining({ code: 'in_flight' }));
  });

  it('rejects incomplete nonempty, extra, reordered, and wrong-purpose cascade choices', () => {
    const project = makeDerivationProject();
    const derive = (cascadeChoices: StudioPrepareSubmissionRequestV2['cascadeChoices']) =>
      deriveStudioSubmissionQuoteCoresV2({
        project,
        request: prepareRequest([choice('shot_1', 'video_take')], cascadeChoices),
        rateCard: createStudioRateCardV2([videoRate]),
      });

    expect(() => derive([choice('shot_2', 'video_take')])).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
    expect(() =>
      derive([choice('shot_2', 'video_take'), choice('shot_3', 'video_take'), choice('shot_1', 'seed_still')])
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
    expect(() => derive([choice('shot_3', 'video_take'), choice('shot_2', 'video_take')])).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
    expect(() => derive([choice('shot_2', 'seed_still'), choice('shot_3', 'video_take')])).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
  });

  it('keeps dependent rows out of the independent base set and requires seed anchors to head segments', () => {
    const project = makeDerivationProject();
    const rateCard = createStudioRateCardV2([imageRate, videoRate]);
    const derive = (baseChoices: StudioPrepareSubmissionRequestV2['baseChoices']) =>
      deriveStudioSubmissionQuoteCoresV2({ project, request: prepareRequest(baseChoices, []), rateCard });

    expect(() => derive([choice('shot_1', 'seed_still'), choice('shot_1', 'video_take')])).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
    expect(() => derive([choice('shot_1', 'video_take'), choice('shot_2', 'video_take')])).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
    expect(() => derive([choice('shot_2', 'seed_still')])).toThrow(
      expect.objectContaining({ code: 'invalid_prepare_request' })
    );
  });

  it('stops cascade closure at hard cuts and at an external in-flight barrier', () => {
    const hardCut = makeDerivationProject();
    hardCut.shots.shot_3!.chainBreak = 'hard_cut';
    const rateCard = createStudioRateCardV2([videoRate]);
    const hardCutOptions = deriveStudioSubmissionQuoteCoresV2({
      project: hardCut,
      request: prepareRequest([choice('shot_1', 'video_take')], [choice('shot_2', 'video_take')]),
      rateCard,
    });
    expect(
      hardCutOptions.withCascade?.cascadeItems.map(({ target }) =>
        target.kind === 'shot' ? target.shotId : target.referenceId
      )
    ).toEqual(['shot_2']);

    const inFlight = makeDerivationProject();
    inFlight.jobs.external_job = {
      target: { kind: 'shot', shotId: 'shot_2' },
      purpose: 'video_take',
      status: 'queued_remote',
    } as StudioProjectV2['jobs'][string];
    const inFlightOptions = deriveStudioSubmissionQuoteCoresV2({
      project: inFlight,
      request: prepareRequest([choice('shot_1', 'video_take')], []),
      rateCard,
    });
    expect(inFlightOptions.withCascade).toBeNull();
  });

  it('rejects legacy counts, video references, missing inputs, and hostile request shapes', () => {
    const project = makeDerivationProject();
    const rateCard = createStudioRateCardV2([imageRate, videoRate]);
    const derive = (request: unknown) => deriveStudioSubmissionQuoteCoresV2({ project, request, rateCard });

    expect(() =>
      derive(
        prepareRequest(
          [{ ...choice('shot_1', 'video_take'), generationCount: 0 } as never],
          [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        )
      )
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
    expect(() =>
      derive(
        prepareRequest(
          [{ ...choice('shot_1', 'video_take'), generationCount: 1 } as never],
          [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        )
      )
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
    expect(() =>
      derive(
        prepareRequest(
          [{ ...choice('shot_1', 'video_take'), referenceAssetId: 'brief_ref' } as never],
          [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        )
      )
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    project.shots.shot_1!.seedStillId = null;
    project.shots.shot_1!.assetIds = [];
    delete project.assets.seed_1;
    expect(() =>
      derive(
        prepareRequest(
          [choice('shot_1', 'video_take')],
          [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        )
      )
    ).toThrow(expect.objectContaining({ code: 'missing_conditioning' }));

    const request = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    ) as StudioPrepareSubmissionRequestV2 & { unexpected?: boolean };
    request.unexpected = true;
    expect(() => derive(request)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const accessor = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    );
    Object.defineProperty(accessor, 'projectId', { enumerable: true, get: () => 'project_1' });
    expect(() => derive(accessor)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    expect(() => derive(null)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const inherited = Object.create(
      prepareRequest(
        [choice('shot_1', 'seed_still')],
        [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
      )
    );
    expect(() => derive(inherited)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const symbolKeyed = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    ) as StudioPrepareSubmissionRequestV2 & { [key: symbol]: unknown };
    delete (symbolKeyed as Partial<StudioPrepareSubmissionRequestV2>).cascadeChoices;
    symbolKeyed[Symbol('cascadeChoices')] = [];
    expect(() => derive(symbolKeyed)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const nullArrayPrototype = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    );
    Object.setPrototypeOf(nullArrayPrototype.baseChoices, null);
    expect(() => derive(nullArrayPrototype)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const sparseChoices = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    );
    const sparseBaseChoices: StudioPrepareSubmissionRequestV2['baseChoices'] = [];
    sparseBaseChoices.length = 1;
    sparseChoices.baseChoices = sparseBaseChoices;
    expect(() => derive(sparseChoices)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const hiddenChoice = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    );
    Object.defineProperty(hiddenChoice.baseChoices, 0, {
      value: hiddenChoice.baseChoices[0],
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(() => derive(hiddenChoice)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const inheritedChoice = prepareRequest(
      [choice('shot_1', 'seed_still')],
      [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
    );
    inheritedChoice.baseChoices[0] = Object.create(inheritedChoice.baseChoices[0]);
    expect(() => derive(inheritedChoice)).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));

    const nullPrototypeRequest = Object.assign(
      Object.create(null),
      prepareRequest(
        [choice('shot_1', 'seed_still')],
        [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
      )
    );
    expect(
      deriveStudioSubmissionQuoteCoresV2({ project: makeDerivationProject(), request: nullPrototypeRequest, rateCard })
    ).toMatchObject({ baseOnly: { baseItems: [{ purpose: 'seed_still' }] } });
  });

  it('rejects hostile low-level quote arrays, handoff identity, activity, and purpose/dependency mismatches', () => {
    const expectQuoteCode = (input: StudioSubmissionQuoteEstimateInputV2, code: string): void => {
      expect(() => createStudioSubmissionQuoteCoreV2(input)).toThrow(expect.objectContaining({ code }));
    };

    const nonArray = makeInput();
    (nonArray as unknown as { baseItems: unknown }).baseItems = {};
    expectQuoteCode(nonArray, 'invalid_quote');

    const sparse = makeInput();
    const sparseBaseItems: StudioSubmissionQuoteEstimateInputV2['baseItems'] = [];
    sparseBaseItems.length = 1;
    sparse.baseItems = sparseBaseItems;
    expectQuoteCode(sparse, 'invalid_quote');

    const unsafeHandoff = makeInput();
    unsafeHandoff.originReferenceHandoffId = 'not safe';
    expectQuoteCode(unsafeHandoff, 'invalid_quote');

    const missingBeat = makeInput();
    delete missingBeat.project.beats.beat_1;
    expectQuoteCode(missingBeat, 'inactive_shot');

    const wrongPurpose = makeInput();
    wrongPurpose.baseItems[0] = {
      ...wrongPurpose.baseItems[0]!,
      purpose: 'thumbnail',
    } as unknown as StudioUnpricedQuotedGenerationV2;
    expectQuoteCode(wrongPurpose, 'invalid_quote');

    const repeatedGeneration = makeInput();
    repeatedGeneration.baseItems[0] = { ...repeatedGeneration.baseItems[0]!, generationCount: 2 };
    expectQuoteCode(repeatedGeneration, 'invalid_quote');

    const symbolicSeed = makeInput();
    symbolicSeed.baseItems[0] = draft(
      'shot_1',
      'seed_still',
      1,
      createStudioDeferredGenerationRequestPlan({
        template: templateFor('shot_1', 'video_take'),
        dependency: { kind: 'authorized_seed', upstreamItemId: 'upstream_item', shotId: 'shot_1' },
      })
    );
    expectQuoteCode(symbolicSeed, 'invalid_dependency');
  });

  it('rejects noncanonical Board scope at the low-level quote boundary', () => {
    const boardInput = (): StudioSubmissionQuoteEstimateInputV2 => ({
      project: makeProject(),
      originReferenceHandoffId: null,
      rateCard: createStudioRateCardV2([imageRate]),
      baseItems: [draft('shot_1', 'board_still', 1, resolvedBoard())],
      cascadeItems: [],
    });
    const expectInvalidQuote = (input: StudioSubmissionQuoteEstimateInputV2): void => {
      expect(() => createStudioSubmissionQuoteCoreV2(input)).toThrow(
        expect.objectContaining({ code: 'invalid_quote' })
      );
    };

    const mixed = boardInput();
    mixed.baseItems.push(draft('shot_2', 'seed_still', 1, resolvedSeed('shot_2')));
    expectInvalidQuote(mixed);

    const cascaded = boardInput();
    cascaded.cascadeItems.push(draft('shot_2', 'board_still', 1, resolvedBoard('shot_2')));
    expectInvalidQuote(cascaded);

    const handedOff = boardInput();
    handedOff.originReferenceHandoffId = 'handoff_1';
    expectInvalidQuote(handedOff);
  });

  it('prices base and symbolic cascade lines from one exact ordered graph', () => {
    const quote = createStudioSubmissionQuoteCoreV2(makeInput());

    expect(quote.baseItems).toHaveLength(1);
    expect(quote.cascadeItems).toHaveLength(2);
    expect(quote.baseItems[0]?.id).toBe(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'seed_still',
      })
    );
    expect(quote.lowerMinorUnits).toBe(137);
    expect(quote.upperMinorUnits).toBe(137);
    expect(quote.currency).toBe('USD');
    expect(quote.cascadeItems.map((item) => item.requestPlan.kind)).toEqual([
      'after_take_selection',
      'after_take_selection',
    ]);
  });

  it('rejects duplicate pairs, inactive shots, in-flight work, and mixed currencies', () => {
    const duplicate = makeInput();
    duplicate.cascadeItems[0] = { ...duplicate.baseItems[0]! };
    expect(() => createStudioSubmissionQuoteCoreV2(duplicate)).toThrow(
      expect.objectContaining({ code: 'duplicate_shot_purpose' })
    );

    const inactive = makeInput();
    inactive.baseItems[0] = draft('shot_parked', 'seed_still', 1, resolvedSeed('shot_parked'));
    expect(() => createStudioSubmissionQuoteCoreV2(inactive)).toThrow(
      expect.objectContaining({ code: 'inactive_shot' })
    );

    const inFlight = makeInput();
    inFlight.project.jobs.job_1 = {
      target: { kind: 'shot', shotId: 'shot_1' },
      referenceTarget: null,
      purpose: 'seed_still',
      status: 'queued_local',
    } as StudioProjectV2['jobs'][string];
    expect(() => createStudioSubmissionQuoteCoreV2(inFlight)).toThrow(expect.objectContaining({ code: 'in_flight' }));

    const mixed = makeInput();
    mixed.rateCard = createStudioRateCardV2([imageRate, { ...videoRate, currency: 'EUR' }]);
    expect(() => createStudioSubmissionQuoteCoreV2(mixed)).toThrow(expect.objectContaining({ code: 'mixed_currency' }));
  });

  it('rejects future, cross-chain, and hard-cut symbolic dependencies', () => {
    const future = makeInput();
    const futureId = createStudioQuotedGenerationId({
      projectId: 'project_1',
      projectRevision: 7,
      target: { kind: 'shot', shotId: 'shot_2' },
      purpose: 'video_take',
    });
    future.cascadeItems[0] = draft(
      'shot_1',
      'video_take',
      1,
      createStudioDeferredGenerationRequestPlan({
        template: templateFor('shot_1', 'video_take'),
        dependency: { kind: 'authorized_seed', upstreamItemId: futureId, shotId: 'shot_1' },
      })
    );
    expect(() => createStudioSubmissionQuoteCoreV2(future)).toThrow(
      expect.objectContaining({ code: 'invalid_dependency' })
    );

    const hardCut = makeInput();
    hardCut.project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(() => createStudioSubmissionQuoteCoreV2(hardCut)).toThrow(
      expect.objectContaining({ code: 'invalid_dependency' })
    );
  });

  it('enforces the combined 24-shot graph limit', () => {
    const shotIds = Array.from({ length: 25 }, (_, index) => `shot_${index + 1}`);
    const input: StudioSubmissionQuoteEstimateInputV2 = {
      project: makeProject(shotIds),
      originReferenceHandoffId: null,
      rateCard: createStudioRateCardV2([videoRate]),
      baseItems: shotIds.map((shotId) => draft(shotId, 'video_take', 1, resolvedVideo(shotId))),
      cascadeItems: [],
    };

    input.baseItems.length = 24;
    expect(createStudioSubmissionQuoteCoreV2(input).baseItems).toHaveLength(24);
    input.baseItems.push(draft('shot_25', 'video_take', 1, resolvedVideo('shot_25')));
    expect(() => createStudioSubmissionQuoteCoreV2(input)).toThrow(expect.objectContaining({ code: 'invalid_quote' }));
  });

  it('fails closed on unsafe pricing arithmetic', () => {
    const input = makeInput();
    input.rateCard = createStudioRateCardV2([imageRate, { ...videoRate, rateMinorUnits: Number.MAX_SAFE_INTEGER }]);

    expect(() => createStudioSubmissionQuoteCoreV2(input)).toThrow(expect.objectContaining({ code: 'unsafe_total' }));
  });

  it('derives every budget branch from the quote upper bound', () => {
    const quote = createStudioSubmissionQuoteCoreV2(makeInput());

    expect(evaluateStudioBudgetV2(quote, null)).toEqual({ allowed: true, verdict: { kind: 'no_policy' } });
    expect(evaluateStudioBudgetV2(quote, { currency: 'USD', maxPerBatchMinorUnits: 137 })).toEqual({
      allowed: true,
      verdict: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 137 },
    });
    expect(evaluateStudioBudgetV2(quote, { currency: 'USD', maxPerBatchMinorUnits: 136 })).toEqual({
      allowed: false,
      reason: 'over_cap',
      verdict: { kind: 'over_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 136 },
    });
    expect(evaluateStudioBudgetV2(quote, { currency: 'EUR', maxPerBatchMinorUnits: 999 })).toEqual({
      allowed: false,
      reason: 'currency_mismatch',
      verdict: { kind: 'currency_mismatch', policyCurrency: 'EUR', maxPerBatchMinorUnits: 999 },
    });
  });

  it('compares quote cores independently from object key order and detects authority changes', () => {
    const quote = createStudioSubmissionQuoteCoreV2(makeInput());
    const reordered = JSON.parse(JSON.stringify(quote)) as typeof quote;

    expect(studioSubmissionQuoteCoresEqual(quote, reordered)).toBe(true);
    reordered.upperMinorUnits += 1;
    expect(studioSubmissionQuoteCoresEqual(quote, reordered)).toBe(false);
  });

  it('projects exact renderer rows without item, request, or rate authority', () => {
    const core = createStudioSubmissionQuoteCoreV2(makeInput());
    const quote = { ...core, id: 'quote_1', expiresAt: '2026-08-18T00:05:00.000Z' };
    const projected = toStudioRendererSubmissionQuoteV2(
      quote,
      { currency: 'USD', maxPerBatchMinorUnits: 500 },
      (routeId, purpose) => ({
        choiceId: routeId,
        providerId: purpose === 'seed_still' ? 'image-provider' : 'video-provider',
        model: purpose === 'seed_still' ? 'image-model' : 'video-model',
      })
    );

    expect(projected).toMatchObject({
      id: 'quote_1',
      lowerMinorUnits: 137,
      upperMinorUnits: 137,
      budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 500 },
    });
    expect(projected.baseItems[0]).toEqual({
      target: { kind: 'shot', shotId: 'shot_1' },
      referenceTarget: null,
      purpose: 'seed_still',
      route: { choiceId: 'image_route', providerId: 'image-provider', model: 'image-model' },
      generationCount: 1,
      durationSeconds: null,
      conditioningAssetId: null,
      oneGenerationMinorUnits: 25,
      requestedTotalMinorUnits: 25,
      composition: compositionFor('shot_1', 'seed_still'),
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('requestPlan');
    expect(serialized).not.toContain('rateCardDigest');
    expect(serialized).not.toContain('item_');
    expect(serialized).not.toContain('rateMinorUnits');
  });

  it('projects Board image pricing with no billable duration', () => {
    const project = makeBoardDerivationProject(1);
    const core = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest([choice('shot_1', 'board_still')], []),
      rateCard: createStudioRateCardV2([imageRate]),
    }).baseOnly;
    const projected = toStudioRendererSubmissionQuoteV2(
      { ...core, id: 'quote_board', expiresAt: '2026-08-18T00:05:00.000Z' },
      null,
      (routeId) => ({ choiceId: routeId, providerId: 'image-provider', model: 'image-model' })
    );

    expect(projected.baseItems[0]).toMatchObject({ purpose: 'board_still', durationSeconds: null });
  });

  it('projects the frozen duration for a resolved video base row', () => {
    const input = makeInput();
    input.rateCard = createStudioRateCardV2([videoRate]);
    input.baseItems = [draft('shot_1', 'video_take', 1, resolvedVideo())];
    input.cascadeItems = [];
    const core = createStudioSubmissionQuoteCoreV2(input);
    const projected = toStudioRendererSubmissionQuoteV2(
      { ...core, id: 'quote_video', expiresAt: '2026-08-18T00:05:00.000Z' },
      null,
      (routeId) => ({ choiceId: routeId, providerId: 'video-provider', model: 'video-model' })
    );

    expect(projected.baseItems[0]).toMatchObject({
      purpose: 'video_take',
      durationSeconds: 8,
      conditioningAssetId: 'take_seed',
    });
  });
});
