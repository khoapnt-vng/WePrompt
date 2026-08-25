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
  StudioJobV2,
  StudioProjectV2,
  StudioQuotedGeneration,
  StudioShot,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
} from '@/common/types/project/creativeStudioTypes';
import {
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createStudioQuotedGenerationId,
  deriveStudioInstructionProfileV2,
  studioGenerationCompositionDigestV2,
} from '@/process/services/creative-studio/service/schema2/generation';
import { createStudioSpendReceiptV2 } from '@/process/services/creative-studio/service/schema2/pricing';
import { validateStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/validation';
import {
  composeStudioEditorFolderV2,
  createStudioBlackSlatePngV2,
  type StudioEditorFolderVerifiedMediaV2,
} from '@/process/services/creative-studio/service/schema2/exports/editorFolder';

const NOW = '2026-08-20T00:00:00.000Z';
const DIGEST = 'a'.repeat(64);
const PROVIDER = {
  providerId: 'provider_1',
  adapterId: 'weprompt-media-gateway-v1' as const,
  model: 'video-model',
};

const makeShot = (id: string, chainBreak: StudioShot['chainBreak']): StudioShot => ({
  id,
  shootingScript: `Shooting script for ${id}`,
  durationSeconds: 8,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak,
  referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
  seedStillId: null,
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
});

const makeProject = (): StudioProjectV2 => {
  const project: StudioProjectV2 = {
    schemaVersion: 5,
    revision: 1,
    id: 'project_1',
    name: 'Editor package',
    brief: 'A complete active film.',
    rules: [],
    briefConversationId: null,
    aspectRatio: '16:9',
    targetDurationSeconds: 30,
    resolution: '1080p',
    boardStyle: null,
    beatOrder: ['beat_1', 'beat_2'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Covered beat',
        story: 'First story',
        targetSeconds: null,
        shotOrder: ['shot_1', 'shot_2'],
      },
      beat_2: {
        id: 'beat_2',
        title: 'Uncovered beat',
        story: 'Second story',
        targetSeconds: 5,
        shotOrder: [],
      },
    },
    shots: {
      shot_1: makeShot('shot_1', 'none'),
      shot_2: makeShot('shot_2', 'hard_cut'),
    },
    referencePlanStatus: 'unplanned',
    referenceOrder: [],
    references: {},
    bin: [],
    bedAssetId: 'bed_1',
    spendPolicy: null,
    spendAuthorizations: [],
    frameExtractions: {},
    undoHistory: [],
    imageRouteId: null,
    videoRouteId: 'route_video',
    assets: {},
    jobs: {},
    createdAt: NOW,
    updatedAt: NOW,
  };

  const items: StudioQuotedGeneration[] = [];
  for (const [index, shotId] of ['shot_1', 'shot_2'].entries()) {
    const shot = project.shots[shotId]!;
    const assetId = `take_${index + 1}`;
    const seedId = `seed_${index + 1}`;
    const durationSeconds = index === 0 ? 10 : 12;
    const target = { kind: 'shot' as const, shotId };
    const source = {
      kind: 'shot' as const,
      beatId: 'beat_1',
      story: project.beats.beat_1!.story,
      shotId,
      shootingScript: shot.shootingScript,
    };
    const composition = composeStudioGenerationV2({
      projectRevision: project.revision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: 'video_take',
      referenceInputs: [],
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: PROVIDER,
      boardStyle: null,
      instructionProfile: deriveStudioInstructionProfileV2(PROVIDER, 'video_take', source),
    });
    const requestPlan = {
      kind: 'resolved' as const,
      snapshot: {
        composition,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        durationSeconds: shot.durationSeconds,
        referenceInputs: [],
        conditioningInput: { kind: 'seed_still' as const, assetId: seedId },
      },
    };
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        target,
        purpose: 'video_take',
      }),
      target,
      purpose: 'video_take',
      routeId: project.videoRouteId!,
      generationCount: 1,
      requestPlan,
      rateUnit: 'second',
      rateMinorUnits: 1,
    };
    items.push(item);
    project.assets[seedId] = {
      id: seedId,
      projectId: project.id,
      shotId,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: `${seedId}.png` },
      byteSize: 5,
      sha256: DIGEST,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
      createdAt: NOW,
    };
    project.assets[assetId] = {
      id: assetId,
      projectId: project.id,
      shotId,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
      byteSize: index + 10,
      sha256: DIGEST,
      durationSeconds,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: `job_${index + 1}`,
      compositionDigest: studioGenerationCompositionDigestV2(composition),
      createdAt: NOW,
    };
    shot.seedStillId = seedId;
    shot.videoAssetId = assetId;
    shot.assetIds = [seedId, assetId];
    shot.jobIds = [`job_${index + 1}`];
  }
  project.shots.shot_1!.trimInSeconds = 1;
  project.shots.shot_1!.trimOutSeconds = 2;

  const totals = calculateStudioQuoteTotals(items);
  if (totals === null) throw new Error('invalid editor-folder quote fixture');
  const authorization: StudioSpendAuthorization = {
    id: 'authorization_1',
    projectId: project.id,
    projectRevision: project.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: items,
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-20T00:05:00.000Z',
    confirmedAt: '2026-08-20T00:00:01.000Z',
    providerBindings: items.map((item) => ({ itemId: item.id, provider: PROVIDER })),
    idempotencyKeys: items.map((item, index) => ({
      itemId: item.id,
      key: `key_${index + 1}`,
    })),
  };
  project.spendAuthorizations = [authorization];
  project.revision = authorization.projectRevision + 1;
  for (const [index, item] of items.entries()) {
    const jobId = `job_${index + 1}`;
    const assetId = `take_${index + 1}`;
    const job: StudioJobV2 = {
      id: jobId,
      projectId: project.id,
      target: structuredClone(item.target),
      status: 'succeeded',
      provider: PROVIDER,
      idempotencyKey: `key_${index + 1}`,
      providerJobId: `provider_job_${index + 1}`,
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
      purpose: 'video_take',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      composition: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot.composition : null!,
      requestPlan: item.requestPlan,
      requestSnapshot: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot : null,
      spendReceipt: createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId }),
      outputAssetIdsByRole: { primary: assetId, poster: null },
    };
    project.jobs[jobId] = job;
  }
  project.assets.bed_1 = {
    id: 'bed_1',
    projectId: project.id,
    shotId: null,
    mediaKind: 'audio',
    mimeType: 'audio/wav',
    managedAsset: { collection: 'imports', fileName: 'bed_1.wav' },
    byteSize: 20,
    sha256: 'c'.repeat(64),
    durationSeconds: 30,
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: null,
    compositionDigest: null,
    createdAt: NOW,
  };
  expect(validateStudioProjectV2(project)).toBe(true);
  return project;
};

const makeMaximumCapacityProject = (): StudioProjectV2 => {
  const project = makeProject();
  const firstAuthorization = project.spendAuthorizations[0]!;
  const provider = firstAuthorization.providerBindings[0]!.provider;
  const authorizationCount = Math.ceil(STUDIO_MAX_SHOTS_PER_PROJECT / STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST);
  const authorizations: StudioSpendAuthorization[] = [firstAuthorization];
  for (let authorizationIndex = 1; authorizationIndex < authorizationCount; authorizationIndex += 1) {
    authorizations.push({
      ...firstAuthorization,
      id: `authorization_${authorizationIndex + 1}`,
      projectRevision: authorizationIndex + 1,
      baseItems: [],
      cascadeItems: [],
      lowerMinorUnits: 0,
      upperMinorUnits: 0,
      providerBindings: [],
      idempotencyKeys: [],
    });
  }
  project.revision = authorizationCount + 1;
  project.spendAuthorizations = authorizations;

  const activeBeatCount = Math.ceil(STUDIO_MAX_SHOTS_PER_PROJECT / STUDIO_MAX_SHOTS_PER_BEAT);
  for (let beatGroup = 1; beatGroup < activeBeatCount; beatGroup += 1) {
    const beatId = `beat_${beatGroup + 2}`;
    project.beatOrder.push(beatId);
    project.beats[beatId] = {
      id: beatId,
      title: `Maximum-capacity beat ${beatGroup + 1}`,
      story: `Story for maximum-capacity beat ${beatGroup + 1}`,
      targetSeconds: null,
      shotOrder: [],
    };
  }

  const pendingJobs: Array<{
    authorization: StudioSpendAuthorization;
    item: StudioQuotedGeneration;
    jobId: string;
    assetId: string;
  }> = [];
  for (let index = 3; index <= STUDIO_MAX_SHOTS_PER_PROJECT; index += 1) {
    const shotId = `shot_${index}`;
    const assetId = `take_${index}`;
    const seedId = `seed_${index}`;
    const jobId = `job_${index}`;
    const beatGroup = Math.floor((index - 1) / STUDIO_MAX_SHOTS_PER_BEAT);
    const beatId = beatGroup === 0 ? 'beat_1' : `beat_${beatGroup + 2}`;
    const authorizationIndex = Math.floor((index - 1) / STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST);
    const authorization = authorizations[authorizationIndex]!;
    const target = { kind: 'shot' as const, shotId };
    const source = {
      kind: 'shot' as const,
      beatId,
      story: project.beats[beatId]!.story,
      shotId,
      shootingScript: `Shooting script for ${shotId}`,
    };
    const composition = composeStudioGenerationV2({
      projectRevision: authorization.projectRevision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: 'video_take',
      referenceInputs: [],
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: provider,
      boardStyle: null,
      instructionProfile: deriveStudioInstructionProfileV2(provider, 'video_take', source),
    });
    const requestPlan = {
      kind: 'resolved' as const,
      snapshot: {
        composition,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        durationSeconds: 8,
        referenceInputs: [],
        conditioningInput: { kind: 'seed_still' as const, assetId: seedId },
      },
    };
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: authorization.projectRevision,
        target,
        purpose: 'video_take',
      }),
      target,
      purpose: 'video_take',
      routeId: project.videoRouteId!,
      generationCount: 1,
      requestPlan,
      rateUnit: 'second',
      rateMinorUnits: 1,
    };
    authorization.baseItems.push(item);
    authorization.providerBindings.push({ itemId: item.id, provider });
    authorization.idempotencyKeys.push({ itemId: item.id, key: `key_${index}` });

    project.shots[shotId] = {
      ...makeShot(shotId, 'hard_cut'),
      seedStillId: seedId,
      videoAssetId: assetId,
      assetIds: [seedId, assetId],
      jobIds: [jobId],
    };
    project.beats[beatId]!.shotOrder.push(shotId);
    project.assets[seedId] = {
      id: seedId,
      projectId: project.id,
      shotId,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: `${seedId}.png` },
      byteSize: 5,
      sha256: DIGEST,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
      createdAt: NOW,
    };
    project.assets[assetId] = {
      id: assetId,
      projectId: project.id,
      shotId,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
      byteSize: index + 10,
      sha256: DIGEST,
      durationSeconds: 8,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: jobId,
      compositionDigest: studioGenerationCompositionDigestV2(composition),
      createdAt: NOW,
    };
    pendingJobs.push({ authorization, item, jobId, assetId });
  }

  for (const authorization of authorizations) {
    const totals = calculateStudioQuoteTotals([...authorization.baseItems, ...authorization.cascadeItems]);
    if (totals === null) throw new Error('invalid maximum-capacity quote fixture');
    authorization.lowerMinorUnits = totals.lowerMinorUnits;
    authorization.upperMinorUnits = totals.upperMinorUnits;
  }
  for (const { authorization, item, jobId, assetId } of pendingJobs) {
    project.jobs[jobId] = {
      id: jobId,
      projectId: project.id,
      target: structuredClone(item.target),
      status: 'succeeded',
      provider,
      idempotencyKey: `key_${item.target.kind === 'shot' ? item.target.shotId.slice('shot_'.length) : ''}`,
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
      purpose: 'video_take',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      composition: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot.composition : null!,
      requestPlan: item.requestPlan,
      requestSnapshot: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot : null,
      spendReceipt: createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId }),
      outputAssetIdsByRole: { primary: assetId, poster: null },
    };
  }
  project.assets.bed_1!.durationSeconds = 1_000;
  expect(validateStudioProjectV2(project)).toBe(true);
  return project;
};

const proofsFor = (project: StudioProjectV2, ...assetIds: string[]): StudioEditorFolderVerifiedMediaV2[] =>
  assetIds.map((assetId) => {
    const asset = project.assets[assetId]!;
    return { assetId, byteSize: asset.byteSize, sha256: asset.sha256 };
  });

const expectCode = (operation: () => unknown, code: string): void => {
  expect(operation).toThrow(expect.objectContaining({ code }));
};

describe('composeStudioEditorFolderV2', () => {
  it('freezes active order, trim-derived time, one slate, verified media, and the bed end fade', () => {
    const project = makeProject();
    const result = composeStudioEditorFolderV2(project, proofsFor(project, 'take_1', 'take_2', 'bed_1'));

    expect(result.timeline.durationSeconds).toBe(24);
    expect(result.timeline.beats).toEqual([
      {
        beatId: 'beat_1',
        title: 'Covered beat',
        timelineStartSeconds: 0,
        durationSeconds: 19,
        entries: [
          {
            kind: 'shot',
            shotId: 'shot_1',
            videoAssetId: 'take_1',
            relativePath: 'media/shot-001.mp4',
            timelineStartSeconds: 0,
            sourceInSeconds: 1,
            sourceOutSeconds: 8,
            durationSeconds: 7,
            chainBreak: 'none',
          },
          {
            kind: 'shot',
            shotId: 'shot_2',
            videoAssetId: 'take_2',
            relativePath: 'media/shot-002.mp4',
            timelineStartSeconds: 7,
            sourceInSeconds: 0,
            sourceOutSeconds: 12,
            durationSeconds: 12,
            chainBreak: 'hard_cut',
          },
        ],
      },
      {
        beatId: 'beat_2',
        title: 'Uncovered beat',
        timelineStartSeconds: 19,
        durationSeconds: 5,
        entries: [
          {
            kind: 'slate',
            relativePath: 'media/slate.png',
            timelineStartSeconds: 19,
            durationSeconds: 5,
          },
        ],
      },
    ]);
    expect(result.timeline.bed).toEqual({
      assetId: 'bed_1',
      relativePath: 'media/bed.wav',
      sourceInSeconds: 0,
      sourceOutSeconds: 24,
      fadeOutStartSeconds: 22,
      fadeOutEndSeconds: 24,
    });
    expect(Buffer.from(result.timelineBytes).toString('utf8')).toBe(JSON.stringify(result.timeline));
    expect(result.files.map(({ relativePath }) => relativePath)).toEqual([
      'media/bed.wav',
      'media/shot-001.mp4',
      'media/shot-002.mp4',
      'media/slate.png',
      'timeline.json',
    ]);
    expect(result.files.filter(({ relativePath }) => relativePath === 'media/slate.png')).toHaveLength(1);
    expect(result.manifest.map(({ relativePath }) => relativePath)).toEqual(
      result.files.map(({ relativePath }) => relativePath)
    );
    expect(result.fileCount).toBe(5);
    expect(result.byteSize).toBe(result.manifest.reduce((sum, entry) => sum + entry.byteSize, 0));
  });

  it('reuses one deterministic resolution-correct slate across every truly empty active beat', () => {
    const project = makeProject();
    project.beatOrder.push('beat_3');
    project.beats.beat_3 = {
      id: 'beat_3',
      title: 'Another uncovered beat',
      story: '',
      targetSeconds: 3,
      shotOrder: [],
    };
    const result = composeStudioEditorFolderV2(project, proofsFor(project, 'take_1', 'take_2', 'bed_1'));
    const slate = result.files.find(({ relativePath }) => relativePath === 'media/slate.png');
    if (slate?.kind !== 'generated') throw new Error('missing generated slate');
    const png = Buffer.from(slate.bytes);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(1920);
    expect(png.readUInt32BE(20)).toBe(1080);
    expect(slate.bytes).toEqual(createStudioBlackSlatePngV2(1920, 1080));
    expect(
      result.timeline.beats.flatMap(({ entries }) => entries).filter((entry) => entry.kind === 'slate')
    ).toHaveLength(2);
    expect(result.files.filter(({ relativePath }) => relativePath === 'media/slate.png')).toHaveLength(1);
  });

  it('renders 720p slates at every supported non-landscape aspect ratio without a bed', () => {
    const dimensions = {
      '9:16': { width: 720, height: 1280 },
      '1:1': { width: 720, height: 720 },
      '4:3': { width: 960, height: 720 },
      '3:4': { width: 720, height: 960 },
    } as const;

    for (const [aspectRatio, expected] of Object.entries(dimensions)) {
      const project = makeProject();
      project.resolution = '720p';
      project.aspectRatio = aspectRatio as StudioProjectV2['aspectRatio'];
      project.bedAssetId = null;
      const result = composeStudioEditorFolderV2(project, proofsFor(project, 'take_1', 'take_2'));
      const slate = result.files.find(({ relativePath }) => relativePath === 'media/slate.png');
      if (slate?.kind !== 'generated') throw new Error('missing generated slate');
      const png = Buffer.from(slate.bytes);
      expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(expected);
      expect(result.timeline.bed).toBeNull();
    }
  });

  it('refuses covered beats with zero or only some pictures instead of substituting slates', () => {
    for (const pictureCount of [0, 1]) {
      const project = makeProject();
      for (let index = pictureCount; index < 2; index += 1) {
        const shotId = `shot_${index + 1}`;
        const assetId = `take_${index + 1}`;
        const jobId = `job_${index + 1}`;
        const shot = project.shots[shotId]!;
        shot.videoAssetId = null;
        shot.assetIds = shot.assetIds.filter((id) => id !== assetId);
        shot.jobIds = [];
        shot.trimInSeconds = null;
        shot.trimOutSeconds = null;
        delete project.assets[assetId];
        delete project.jobs[jobId];
      }
      const authorization = project.spendAuthorizations[0]!;
      authorization.baseItems = authorization.baseItems.filter(
        (item) => item.target.kind === 'shot' && project.shots[item.target.shotId]!.videoAssetId
      );
      authorization.providerBindings = authorization.providerBindings.filter(({ itemId }) =>
        authorization.baseItems.some((item) => item.id === itemId)
      );
      authorization.idempotencyKeys = authorization.idempotencyKeys.filter(({ itemId }) =>
        authorization.baseItems.some((item) => item.id === itemId)
      );
      if (authorization.baseItems.length === 0) project.spendAuthorizations = [];
      else {
        const totals = calculateStudioQuoteTotals(authorization.baseItems)!;
        authorization.lowerMinorUnits = totals.lowerMinorUnits;
        authorization.upperMinorUnits = totals.upperMinorUnits;
      }
      const pictureIds = Array.from({ length: pictureCount }, (_, index) => `take_${index + 1}`);
      expectCode(
        () => composeStudioEditorFolderV2(project, proofsFor(project, ...pictureIds, 'bed_1')),
        'coverage_incomplete'
      );
    }
  });

  it('refuses pending empty-beat duration, invalid proof sets, and a noncanonical picture pointer', () => {
    const pending = makeProject();
    pending.beats.beat_2!.targetSeconds = null;
    expectCode(
      () => composeStudioEditorFolderV2(pending, proofsFor(pending, 'take_1', 'take_2', 'bed_1')),
      'duration_pending'
    );

    const missing = makeProject();
    expectCode(() => composeStudioEditorFolderV2(missing, proofsFor(missing, 'take_1', 'bed_1')), 'invalid_media');
    const replaced = proofsFor(missing, 'take_1', 'take_2', 'bed_1');
    replaced[1] = { ...replaced[1]!, sha256: 'd'.repeat(64) };
    expectCode(() => composeStudioEditorFolderV2(missing, replaced), 'invalid_media');
    const extra = [
      ...proofsFor(missing, 'take_1', 'take_2', 'bed_1'),
      { assetId: 'unused', byteSize: 1, sha256: DIGEST },
    ];
    expectCode(() => composeStudioEditorFolderV2(missing, extra), 'invalid_media');

    const malformed = makeProject();
    malformed.shots.shot_1!.videoAssetId = 'seed_1';
    expectCode(
      () => composeStudioEditorFolderV2(malformed, proofsFor(malformed, 'take_1', 'take_2', 'bed_1')),
      'invalid_project'
    );
  });

  it('trims a longer bed to film duration and refuses a bed shorter than the active film', () => {
    const longer = makeProject();
    longer.assets.bed_1!.durationSeconds = 60;
    expect(
      composeStudioEditorFolderV2(longer, proofsFor(longer, 'take_1', 'take_2', 'bed_1')).timeline.bed
    ).toMatchObject({
      sourceOutSeconds: 24,
      fadeOutStartSeconds: 22,
      fadeOutEndSeconds: 24,
    });

    const shorter = makeProject();
    shorter.assets.bed_1!.durationSeconds = 23.999;
    expectCode(
      () => composeStudioEditorFolderV2(shorter, proofsFor(shorter, 'take_1', 'take_2', 'bed_1')),
      'bed_too_short'
    );
  });

  it.each([
    ['a non-WAV MIME type', (asset: StudioAssetV2) => (asset.mimeType = 'audio/mpeg')],
    ['a noncanonical managed name', (asset: StudioAssetV2) => (asset.managedAsset.fileName = 'foreign.wav')],
    ['visual dimensions', (asset: StudioAssetV2) => (asset.height = 1)],
  ])('refuses editor-folder bed audio with %s', (_label, mutate) => {
    const project = makeProject();
    mutate(project.assets.bed_1!);
    expectCode(
      () => composeStudioEditorFolderV2(project, proofsFor(project, 'take_1', 'take_2', 'bed_1')),
      'invalid_project'
    );
  });

  it('composes the maximum canonical project into 99 files below the artifact capacity', () => {
    const project = makeMaximumCapacityProject();
    const takeIds = Array.from({ length: STUDIO_MAX_SHOTS_PER_PROJECT }, (_, index) => `take_${index + 1}`);
    const result = composeStudioEditorFolderV2(project, proofsFor(project, ...takeIds, 'bed_1'));

    expect(result.fileCount).toBe(99);
    expect(result.fileCount).toBeLessThan(STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT);
    expect(result.files).toHaveLength(99);
    expect(result.files.filter(({ kind }) => kind === 'managed_asset')).toHaveLength(97);
    expect(result.files.filter(({ kind }) => kind === 'generated')).toHaveLength(2);
    expect(result.timeline.beats).toHaveLength(13);
    expect(result.timeline.beats.flatMap(({ entries }) => entries).filter(({ kind }) => kind === 'shot')).toHaveLength(
      STUDIO_MAX_SHOTS_PER_PROJECT
    );
    expect(result.files.at(-1)?.relativePath).toBe('timeline.json');
  });
});
