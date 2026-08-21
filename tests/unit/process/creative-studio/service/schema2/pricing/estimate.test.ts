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
  StudioPrepareSubmissionRequestV2,
  StudioProjectV2,
  StudioQuotedGeneration,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  createStudioDeferredGenerationRequestPlan,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
  createStudioResolvedGenerationRequestPlan,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  createStudioRateCardV2,
  createStudioSubmissionQuoteCoreV2,
  deriveStudioSubmissionQuoteCoresV2,
  evaluateStudioBudgetV2,
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

const template = {
  prompt: 'A precise cinematic frame',
  aspectRatio: '16:9',
  resolution: '1080p',
  durationSeconds: 8,
  referenceInput: null,
} as const;

const makeShot = (id: string): StudioProjectV2['shots'][string] => ({
  id,
  line: `Line for ${id}`,
  derivation: 'derived',
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 8,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  seedStillId: null,
  selectedTakeId: null,
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
      action: 'Move through the space',
      look: 'Clean daylight',
      actionRevision: 1,
      targetSeconds: null,
      shotOrder: [...shotIds],
      lineHistory: [],
    },
  },
  shots: Object.fromEntries(shotIds.map((shotId) => [shotId, makeShot(shotId)])),
  jobs: {},
});

const resolvedSeed = (): StudioGenerationRequestPlan =>
  createStudioResolvedGenerationRequestPlan({ purpose: 'seed_still', template, conditioningInput: null });

const resolvedVideo = (): StudioGenerationRequestPlan =>
  createStudioResolvedGenerationRequestPlan({
    purpose: 'video_take',
    template,
    conditioningInput: { kind: 'seed_still', assetId: 'take_seed' },
  });

const draft = (
  shotId: string,
  purpose: StudioQuotedGeneration['purpose'],
  generationCount: number,
  requestPlan: StudioGenerationRequestPlan
): StudioUnpricedQuotedGenerationV2 => ({
  shotId,
  purpose,
  routeId: purpose === 'seed_still' ? imageRate.routeId : videoRate.routeId,
  generationCount,
  requestPlan,
});

const makeInput = (): StudioSubmissionQuoteEstimateInputV2 => {
  const seedId = createStudioQuotedGenerationId({
    projectId: 'project_1',
    projectRevision: 7,
    shotId: 'shot_1',
    purpose: 'seed_still',
  });
  const upstreamVideoId = createStudioQuotedGenerationId({
    projectId: 'project_1',
    projectRevision: 7,
    shotId: 'shot_1',
    purpose: 'video_take',
  });
  return {
    project: makeProject(),
    originReferenceHandoffId: null,
    rateCard: createStudioRateCardV2([imageRate, videoRate]),
    baseItems: [draft('shot_1', 'seed_still', 2, resolvedSeed())],
    cascadeItems: [
      draft(
        'shot_1',
        'video_take',
        3,
        createStudioDeferredGenerationRequestPlan({
          template,
          dependency: { kind: 'authorized_seed', upstreamItemId: seedId, shotId: 'shot_1' },
        })
      ),
      draft(
        'shot_2',
        'video_take',
        4,
        createStudioDeferredGenerationRequestPlan({
          template,
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
    Partial<Pick<StudioAssetV2, 'durationSeconds' | 'briefReferenceRole' | 'briefReferenceLabel'>>
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
    ...(asset.briefReferenceRole === undefined ? {} : { briefReferenceRole: asset.briefReferenceRole }),
    ...(asset.briefReferenceLabel === undefined ? {} : { briefReferenceLabel: asset.briefReferenceLabel }),
    createdAt: '2026-08-18T00:00:00.000Z',
  };
  project.assets[result.id] = result;
  if (result.shotId !== null) project.shots[result.shotId]!.assetIds.push(result.id);
  return result;
};

const makeDerivationProject = (): StudioProjectV2 => {
  const project = createEmptyStudioProjectV2(
    {
      name: 'Quote derivation',
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
    action: 'Move through the space',
    look: 'Clean daylight',
    actionRevision: 1,
    targetSeconds: null,
    shotOrder: ['shot_1', 'shot_2', 'shot_3'],
    lineHistory: [],
  };
  for (const shotId of project.beats.beat_1.shotOrder) project.shots[shotId] = makeShot(shotId);
  const seed = addDerivationAsset(project, {
    id: 'seed_1',
    shotId: 'shot_1',
    mediaKind: 'image',
    managedAsset: { collection: 'imports', fileName: 'seed_1.png' },
  });
  project.shots.shot_1!.seedStillId = seed.id;
  return project;
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
  purpose: StudioQuotedGeneration['purpose'],
  generationCount = 1,
  referenceAssetId: string | null = null
): StudioPrepareSubmissionRequestV2['baseChoices'][number] => ({
  shotId,
  purpose,
  generationCount,
  referenceAssetId,
});

describe('schema-2 Studio estimates', () => {
  it('derives byte-identical base rows and the complete downstream symbolic graph', () => {
    const project = makeDerivationProject();
    const request = prepareRequest(
      [choice('shot_1', 'video_take', 2)],
      [choice('shot_2', 'video_take', 3), choice('shot_3', 'video_take', 4)]
    );

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request,
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.request).toEqual(request);
    expect(options.withCascade?.baseItems).toEqual(options.baseOnly.baseItems);
    expect(options.baseOnly.cascadeItems).toEqual([]);
    expect(options.withCascade?.cascadeItems.map(({ shotId, requestPlan }) => [shotId, requestPlan])).toEqual([
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
              shotId: 'shot_1',
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
              shotId: 'shot_2',
              purpose: 'video_take',
            }),
          },
        }),
      ],
    ]);
    expect(options.baseOnly.lowerMinorUnits).toBe(56);
    expect(options.baseOnly.upperMinorUnits).toBe(112);
    expect(options.withCascade).toMatchObject({ lowerMinorUnits: 168, upperMinorUnits: 504 });
  });

  it('derives a same-shot video barrier after a reviewed head seed', () => {
    const project = makeDerivationProject();
    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest(
        [choice('shot_1', 'seed_still', 2)],
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
      request: prepareRequest([choice('shot_1', 'seed_still', 2)], []),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.request.cascadeChoices).toEqual([
      choice('shot_1', 'video_take'),
      choice('shot_2', 'video_take'),
      choice('shot_3', 'video_take'),
    ]);
    expect(options.withCascade?.cascadeItems.map(({ shotId, generationCount }) => [shotId, generationCount])).toEqual([
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
      shotId: 'shot_3',
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
      [choice('shot_1', 'seed_still', 2)],
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

  it('derives an exact seed-only handoff quote for arbitrary ordered active shots without video authority', () => {
    const project = makeDerivationProject();
    const request: StudioPrepareSubmissionRequestV2 = {
      ...prepareRequest([choice('shot_2', 'seed_still'), choice('shot_3', 'seed_still')], []),
      originReferenceHandoffId: 'handoff_1',
    };

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request,
      rateCard: createStudioRateCardV2([imageRate]),
    });

    expect(options.request).toEqual(request);
    expect(options.withCascade).toBeNull();
    expect(options.baseOnly).toMatchObject({
      originReferenceHandoffId: 'handoff_1',
      lowerMinorUnits: 50,
      upperMinorUnits: 50,
      cascadeItems: [],
      baseItems: [
        { shotId: 'shot_2', purpose: 'seed_still', routeId: 'image_route', generationCount: 1 },
        { shotId: 'shot_3', purpose: 'seed_still', routeId: 'image_route', generationCount: 1 },
      ],
    });
    expect(options.baseOnly.baseItems.every((item) => item.requestPlan.kind === 'resolved')).toBe(true);
    expect(JSON.stringify(options)).not.toContain('video_route');
  });

  it.each([
    ['video purpose', [choice('shot_2', 'video_take')], []],
    ['multiple generations', [choice('shot_2', 'seed_still', 2)], []],
    ['reference asset', [choice('shot_2', 'seed_still', 1, 'brief_ref')], []],
    ['cascade row', [choice('shot_2', 'seed_still')], [choice('shot_2', 'video_take')]],
  ])('rejects a reference handoff with %s', (_label, baseChoices, cascadeChoices) => {
    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({
        project: makeDerivationProject(),
        request: {
          ...prepareRequest(baseChoices, cascadeChoices),
          originReferenceHandoffId: 'handoff_1',
        },
        rateCard: createStudioRateCardV2([imageRate, videoRate]),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
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
    project.shots.shot_1!.selectedTakeId = take.id;
    project.shots.shot_1!.trimOutSeconds = 2;
    const frame = addDerivationAsset(project, {
      id: 'frame_1',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'conditioningFrames', fileName: 'frame_1.png' },
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: take.id,
      endpointSeconds: 8,
    });
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      takeAssetId: take.id,
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

  it('freezes only an active classified Brief reference into a seed template', () => {
    const project = makeDerivationProject();
    const reference = addDerivationAsset(project, {
      id: 'brief_ref',
      shotId: null,
      mediaKind: 'image',
      managedAsset: { collection: 'imports', fileName: 'brief_ref.png' },
      briefReferenceRole: 'look',
      briefReferenceLabel: 'Atrium',
    });

    const options = deriveStudioSubmissionQuoteCoresV2({
      project,
      request: prepareRequest(
        [choice('shot_1', 'seed_still', 1, reference.id)],
        [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
      ),
      rateCard: createStudioRateCardV2([imageRate, videoRate]),
    });

    expect(options.baseOnly.baseItems[0]?.requestPlan).toEqual(
      expect.objectContaining({
        kind: 'resolved',
        snapshot: expect.objectContaining({ referenceInput: { assetId: reference.id, sha256: reference.sha256 } }),
      })
    );

    delete reference.briefReferenceRole;
    delete reference.briefReferenceLabel;
    expect(() =>
      deriveStudioSubmissionQuoteCoresV2({
        project,
        request: prepareRequest(
          [choice('shot_1', 'seed_still', 1, reference.id)],
          [choice('shot_1', 'video_take'), choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        ),
        rateCard: createStudioRateCardV2([imageRate, videoRate]),
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_reference' }));
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
    expect(hardCutOptions.withCascade?.cascadeItems.map(({ shotId }) => shotId)).toEqual(['shot_2']);

    const inFlight = makeDerivationProject();
    inFlight.jobs.external_job = {
      shotId: 'shot_2',
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

  it('rejects malformed counts, video references, missing inputs, and hostile request shapes', () => {
    const project = makeDerivationProject();
    const rateCard = createStudioRateCardV2([imageRate, videoRate]);
    const derive = (request: unknown) => deriveStudioSubmissionQuoteCoresV2({ project, request, rateCard });

    expect(() =>
      derive(
        prepareRequest(
          [choice('shot_1', 'video_take', 0)],
          [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        )
      )
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
    expect(() =>
      derive(
        prepareRequest(
          [choice('shot_1', 'video_take', 5)],
          [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        )
      )
    ).toThrow(expect.objectContaining({ code: 'invalid_prepare_request' }));
    expect(() =>
      derive(
        prepareRequest(
          [choice('shot_1', 'video_take', 1, 'brief_ref')],
          [choice('shot_2', 'video_take'), choice('shot_3', 'video_take')]
        )
      )
    ).toThrow(expect.objectContaining({ code: 'invalid_reference' }));

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

    const symbolicSeed = makeInput();
    symbolicSeed.baseItems[0] = draft(
      'shot_1',
      'seed_still',
      1,
      createStudioDeferredGenerationRequestPlan({
        template,
        dependency: { kind: 'authorized_seed', upstreamItemId: 'upstream_item', shotId: 'shot_1' },
      })
    );
    expectQuoteCode(symbolicSeed, 'invalid_dependency');
  });

  it('prices base and symbolic cascade lines from one exact ordered graph', () => {
    const quote = createStudioSubmissionQuoteCoreV2(makeInput());

    expect(quote.baseItems).toHaveLength(1);
    expect(quote.cascadeItems).toHaveLength(2);
    expect(quote.baseItems[0]?.id).toBe(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        shotId: 'shot_1',
        purpose: 'seed_still',
      })
    );
    expect(quote.lowerMinorUnits).toBe(137);
    expect(quote.upperMinorUnits).toBe(442);
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
    inactive.baseItems[0] = draft('shot_parked', 'seed_still', 1, resolvedSeed());
    expect(() => createStudioSubmissionQuoteCoreV2(inactive)).toThrow(
      expect.objectContaining({ code: 'inactive_shot' })
    );

    const inFlight = makeInput();
    inFlight.project.jobs.job_1 = {
      shotId: 'shot_1',
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
      shotId: 'shot_2',
      purpose: 'video_take',
    });
    future.cascadeItems[0] = draft(
      'shot_1',
      'video_take',
      1,
      createStudioDeferredGenerationRequestPlan({
        template,
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
      baseItems: shotIds.map((shotId) => draft(shotId, 'video_take', 1, resolvedVideo())),
      cascadeItems: [],
    };

    input.baseItems.length = 24;
    expect(createStudioSubmissionQuoteCoreV2(input).baseItems).toHaveLength(24);
    input.baseItems.push(draft('shot_25', 'video_take', 1, resolvedVideo()));
    expect(() => createStudioSubmissionQuoteCoreV2(input)).toThrow(expect.objectContaining({ code: 'invalid_quote' }));
  });

  it('fails closed on unsafe line arithmetic', () => {
    const input = makeInput();
    input.rateCard = createStudioRateCardV2([imageRate, { ...videoRate, rateMinorUnits: Number.MAX_SAFE_INTEGER }]);

    expect(() => createStudioSubmissionQuoteCoreV2(input)).toThrow(expect.objectContaining({ code: 'unsafe_total' }));
  });

  it('derives every budget branch from the quote upper bound', () => {
    const quote = createStudioSubmissionQuoteCoreV2(makeInput());

    expect(evaluateStudioBudgetV2(quote, null)).toEqual({ allowed: true, verdict: { kind: 'no_policy' } });
    expect(evaluateStudioBudgetV2(quote, { currency: 'USD', maxPerBatchMinorUnits: 442 })).toEqual({
      allowed: true,
      verdict: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 442 },
    });
    expect(evaluateStudioBudgetV2(quote, { currency: 'USD', maxPerBatchMinorUnits: 441 })).toEqual({
      allowed: false,
      reason: 'over_cap',
      verdict: { kind: 'over_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 441 },
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
      upperMinorUnits: 442,
      budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 500 },
    });
    expect(projected.baseItems[0]).toEqual({
      shotId: 'shot_1',
      purpose: 'seed_still',
      route: { choiceId: 'image_route', providerId: 'image-provider', model: 'image-model' },
      generationCount: 2,
      durationSeconds: null,
      oneGenerationMinorUnits: 25,
      requestedTotalMinorUnits: 50,
      waitsForTakeSelection: false,
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('requestPlan');
    expect(serialized).not.toContain('rateCardDigest');
    expect(serialized).not.toContain('item_');
    expect(serialized).not.toContain('rateMinorUnits');
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

    expect(projected.baseItems[0]).toMatchObject({ purpose: 'video_take', durationSeconds: 8 });
  });
});
