/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  StudioGenerationRequestPlan,
  StudioJobV2,
  StudioProjectV2,
  StudioQuotedGeneration,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';
import {
  calculateStudioQuoteTotals,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
} from '@process/services/creative-studio/service/schema2/generation';
import { createStudioSpendReceiptV2 } from '@process/services/creative-studio/service/schema2/pricing';
import { StudioConditioningFrameError } from '@process/services/creative-studio/adapters/conditioningFrame';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';

const { createHashSpy } = vi.hoisted(() => ({ createHashSpy: vi.fn() }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    createHash: (...args: Parameters<typeof actual.createHash>) => {
      createHashSpy(...args);
      return actual.createHash(...args);
    },
  };
});

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mp4 = Buffer.from('000000186674797069736f6d00000000', 'hex');
const created: string[] = [];

const makeStoreV2 = async (
  options: {
    purpose?: StudioJobV2['purpose'];
    addSecondShot?: boolean;
    includeAuthorizedJob?: boolean;
    briefReference?: boolean;
    adapterId?: StudioJobV2['provider']['adapterId'];
  } = {}
) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-v2-'));
  created.push(rootDir);
  const store = createCreativeStudioStore({
    rootDir,
    createId: () => 'project_v2',
    now: () => '2026-08-17T12:00:00.000Z',
  });
  const createdProject = await store.createProjectV2({
    name: 'Schema Two Film',
    brief: '',
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '1080p',
  });
  const authored = await store.updateProjectV2(createdProject.id, (current) => ({
    ...current,
    beatOrder: options.addSecondShot ? ['beat_1', 'beat_2'] : ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: '',
        look: 'A visual language inherited by the shot',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_1'],
        lineHistory: [],
      },
      ...(options.addSecondShot
        ? {
            beat_2: {
              id: 'beat_2',
              title: 'Closing',
              action: '',
              look: '',
              actionRevision: 1,
              targetSeconds: null,
              shotOrder: ['shot_2'],
              lineHistory: [],
            },
          }
        : {}),
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        line: 'A precise opening frame',
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
        jobIds: [],
      },
      ...(options.addSecondShot
        ? {
            shot_2: {
              id: 'shot_2',
              line: 'A separate closing frame',
              derivation: 'derived' as const,
              derivedFromActionRevision: 1,
              narration: '',
              onScreenText: '',
              durationSeconds: 5,
              trimInSeconds: null,
              trimOutSeconds: null,
              chainBreak: 'none' as const,
              seedStillId: null,
              selectedTakeId: null,
              assetIds: [],
              jobIds: [],
            },
          }
        : {}),
    },
  }));
  let quoteBase = authored;
  const purpose = options.purpose ?? 'seed_still';
  if (purpose === 'video_take' || options.briefReference) {
    const importsDirectory = path.join(rootDir, authored.id, 'imports');
    await fs.mkdir(importsDirectory, { recursive: true });
    if (purpose === 'video_take') await fs.writeFile(path.join(importsDirectory, 'seed_v2.png'), png);
    if (options.briefReference) await fs.writeFile(path.join(importsDirectory, 'brief_v2.png'), png);
    quoteBase = await store.updateProjectV2(authored.id, (current) => {
      if (purpose === 'video_take') {
        current.assets.seed_v2 = {
          id: 'seed_v2',
          projectId: current.id,
          shotId: 'shot_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'seed_v2.png' },
          byteSize: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
          createdAt: current.updatedAt,
        };
        current.shots.shot_1!.assetIds.push('seed_v2');
        current.shots.shot_1!.seedStillId = 'seed_v2';
      }
      if (options.briefReference) {
        current.assets.brief_v2 = {
          id: 'brief_v2',
          projectId: current.id,
          shotId: null,
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'brief_v2.png' },
          byteSize: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
          briefReferenceRole: 'cast',
          briefReferenceLabel: 'Cast reference',
          createdAt: current.updatedAt,
        };
      }
      return current;
    });
  }
  if (options.includeAuthorizedJob === false) {
    return { rootDir, store, project: quoteBase, authorization: null, item: null };
  }
  const requestPlan: Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> = {
    kind: 'resolved',
    snapshot: {
      prompt: purpose === 'seed_still' ? 'A frozen seed prompt' : 'A frozen video prompt',
      aspectRatio: quoteBase.aspectRatio,
      resolution: quoteBase.resolution,
      durationSeconds: 5,
      referenceInput: options.briefReference
        ? { assetId: 'brief_v2', sha256: createHash('sha256').update(png).digest('hex') }
        : null,
      conditioningInput: purpose === 'video_take' ? { kind: 'seed_still', assetId: 'seed_v2' } : null,
    },
  };
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId: quoteBase.id,
      projectRevision: quoteBase.revision,
      shotId: 'shot_1',
      purpose,
    }),
    shotId: 'shot_1',
    purpose,
    routeId: purpose === 'seed_still' ? 'route_image' : 'route_video',
    generationCount: 1,
    requestPlan,
    rateUnit: purpose === 'seed_still' ? 'generation' : 'second',
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (totals === null) throw new Error('invalid quote fixture');
  const provider = {
    providerId: 'provider_1',
    adapterId:
      options.adapterId ??
      (purpose === 'seed_still' ? ('weprompt-image-v1' as const) : ('weprompt-media-gateway-v1' as const)),
    model: purpose === 'seed_still' ? 'image-model' : 'video-model',
  };
  const authorization: StudioSpendAuthorization = {
    id: 'authorization_v2',
    projectId: quoteBase.id,
    projectRevision: quoteBase.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-17T12:05:00.000Z',
    confirmedAt: '2026-08-17T12:00:01.000Z',
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, generationIndex: 0, key: 'key_1' }],
  };
  const receipt = createStudioSpendReceiptV2({
    authorization,
    itemId: item.id,
    jobId: 'job_1',
    generationIndex: 0,
  });
  const project = await store.updateProjectV2(quoteBase.id, (current) => {
    const job: StudioJobV2 = {
      id: 'job_1',
      projectId: current.id,
      shotId: 'shot_1',
      status: 'running',
      provider,
      idempotencyKey: 'key_1',
      providerJobId: null,
      cancellationPolicy: 'none',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: current.updatedAt,
      updatedAt: current.updatedAt,
      purpose,
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      generationIndex: 0,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: receipt,
      outputAssetIdsByRole: { primary: null, poster: null },
    };
    current.spendAuthorizations = [authorization];
    current.jobs.job_1 = job;
    current.shots.shot_1!.jobIds.push('job_1');
    return current;
  });
  return { rootDir, store, project, authorization, item };
};

const idSequence = (...ids: string[]): (() => string) => {
  let index = 0;
  return () => ids[index++] ?? `asset_${index}`;
};

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('createStudioMediaStore schema 2 final lifecycle', () => {
  it('commits a seed primary by purpose and role without auto-pinning or selecting it', async () => {
    const { store, project } = await makeStoreV2();
    const media = createStudioMediaStore({ store, createId: () => 'seed_output_1' });

    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });

    expect(asset).toMatchObject({
      id: 'seed_output_1',
      projectId: project.id,
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'seed_output_1.png' },
      sourceLook: 'A frozen seed prompt',
    });
    expect(asset).not.toHaveProperty('durationSeconds');
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            seedStillId: null,
            selectedTakeId: null,
            assetIds: ['seed_output_1'],
            jobIds: ['job_1'],
          },
        },
        jobs: {
          job_1: {
            status: 'succeeded',
            outputAssetIds: ['seed_output_1'],
            outputAssetIdsByRole: { primary: 'seed_output_1', poster: null },
          },
        },
      },
    });
  });

  it('persists the decoded video duration and keeps it immutable after planning-duration edits', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const probeVideoDurationSecondsV2 = vi.fn(async () => 10);
    const media = createStudioMediaStore({
      store,
      createId: () => 'take_1',
      probeVideoDurationSecondsV2,
    });

    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      declaredByteSize: mp4.length,
      durationSeconds: 5,
      body: Readable.from([mp4]),
    });

    expect(asset.durationSeconds).toBe(10);
    expect(probeVideoDurationSecondsV2).toHaveBeenCalledWith({
      filePath: expect.stringMatching(/[/\\]assets[/\\]take_1\.mp4$/),
      byteSize: mp4.length,
      sha256: createHash('sha256').update(mp4).digest('hex'),
    });
    const edited = await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.durationSeconds = 8;
      return current;
    });
    expect(edited.assets.take_1!.durationSeconds).toBe(10);
    const restarted = await store.getProjectV2(project.id);
    expect(restarted.status === 'supported' ? restarted.project.assets.take_1!.durationSeconds : null).toBe(10);
  });

  it('cleans a video whose finalized bytes cannot produce a decoded duration', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: () => 'invalid_video',
      probeVideoDurationSecondsV2: async () => {
        throw new Error('undecodable');
      },
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? Object.keys(loaded.project.assets) : null).toEqual(['seed_v2']);
    await expect(fs.access(path.join(rootDir, project.id, 'assets', 'invalid_video.mp4'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('cleans every V2 managed-output byte, signature, identity, and duration refusal', async () => {
    const imageFixture = await makeStoreV2();
    const imageMedia = createStudioMediaStore({
      store: imageFixture.store,
      createId: idSequence('size_mismatch', 'empty_output', 'mime_mismatch'),
    });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length + 1,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/jpeg',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    let overflowConsumed = false;
    const overflowMedia = createStudioMediaStore({
      store: imageFixture.store,
      createId: () => 'overflow_output',
      limits: { imageOutputMaxBytes: png.length - 1 },
    });
    await expect(
      overflowMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          overflowConsumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    expect(overflowConsumed).toBe(true);

    const unsafeIdMedia = createStudioMediaStore({ store: imageFixture.store, createId: () => '../unsafe' });
    await expect(
      unsafeIdMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const videoFixture = await makeStoreV2({ purpose: 'video_take' });
    const durations = [Number.NaN, 0, Number.MAX_SAFE_INTEGER + 1];
    let durationIndex = 0;
    const videoMedia = createStudioMediaStore({
      store: videoFixture.store,
      createId: idSequence('duration_nan', 'duration_zero', 'duration_oversized'),
      probeVideoDurationSecondsV2: async () => durations[durationIndex++]!,
    });
    for (const assetId of ['duration_nan', 'duration_zero', 'duration_oversized']) {
      // eslint-disable-next-line no-await-in-loop -- Every decoded-duration boundary must clean independently.
      await expect(
        videoMedia.persistProviderOutputForJobV2({
          projectId: videoFixture.project.id,
          shotId: 'shot_1',
          jobId: 'job_1',
          mediaKind: 'video',
          declaredMimeType: 'video/mp4',
          body: Readable.from([mp4]),
        })
      ).rejects.toMatchObject({ code: 'invalid_media' });
      // eslint-disable-next-line no-await-in-loop -- Each refused final identity must be absent.
      await expect(
        fs.access(path.join(videoFixture.rootDir, videoFixture.project.id, 'assets', `${assetId}.mp4`))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('rejects purpose/media and image-duration mismatches before consuming provider bytes', async () => {
    const imageFixture = await makeStoreV2();
    const videoFixture = await makeStoreV2({ purpose: 'video_take' });
    const imageMedia = createStudioMediaStore({ store: imageFixture.store });
    const videoMedia = createStudioMediaStore({ store: videoFixture.store });
    let consumed = 0;
    const body = async function* (): AsyncGenerator<Buffer> {
      consumed += 1;
      yield png;
    };

    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: body(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        durationSeconds: 5,
        body: body(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      videoMedia.persistProviderOutputForJobV2({
        projectId: videoFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: body(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    expect(consumed).toBe(0);
  });

  it('persists the video poster through the explicit role map and refuses a duplicate', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'poster_1', 'must_not_allocate'),
      probeVideoDurationSecondsV2: async () => 10,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const poster = await media.persistProviderPosterForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      primaryAssetId: 'take_1',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    expect(poster).toMatchObject({
      id: 'poster_1',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails' },
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        shots: { shot_1: { selectedTakeId: null } },
        jobs: {
          job_1: {
            outputAssetIds: ['take_1', 'poster_1'],
            outputAssetIdsByRole: { primary: 'take_1', poster: 'poster_1' },
          },
        },
      },
    });

    let consumed = false;
    await expect(
      media.persistProviderPosterForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        primaryAssetId: 'take_1',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });
    expect(consumed).toBe(false);
  });

  it('persists a renderer-captured V2 poster only after the canonical video is selected', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_captured', 'poster_captured'),
      probeVideoDurationSecondsV2: async () => 10,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const capturedInput = {
      projectId: project.id,
      shotId: 'shot_1',
      videoAssetId: 'take_captured',
      width: 1,
      height: 1,
      declaredByteSize: png.length,
      body: Readable.from([png]),
    };
    await expect(media.persistCapturedPosterV2(capturedInput)).rejects.toMatchObject({ code: 'job_inactive' });

    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_captured';
      return current;
    });
    const poster = await media.persistCapturedPosterV2({ ...capturedInput, body: Readable.from([png]) });
    expect(poster).toMatchObject({
      id: 'poster_captured',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails' },
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        jobs: {
          job_1: {
            outputAssetIds: ['take_captured', 'poster_captured'],
            outputAssetIdsByRole: { primary: 'take_captured', poster: 'poster_captured' },
          },
        },
        shots: { shot_1: { selectedTakeId: 'take_captured' } },
      },
    });
  });

  it('persists and reopens a V2 project render without attaching it to a shot', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('render_v2', 'render_v2_new'),
      now: () => '2026-08-17T12:00:00.000Z',
      probeVideoDurationSecondsV2: async () => 12,
    });
    const rendered = await media.persistProjectOutputV2({
      projectId: project.id,
      declaredMimeType: 'video/mp4',
      declaredByteSize: mp4.length,
      width: 1920,
      height: 1080,
      durationSeconds: 12,
      body: Readable.from([mp4]),
    });
    expect(rendered).toMatchObject({
      id: 'render_v2',
      projectId: project.id,
      shotId: null,
      durationSeconds: 12,
      managedAsset: { collection: 'assets', fileName: 'render_v2.mp4' },
    });
    await expect(media.getLatestProjectOutputV2(project.id)).resolves.toEqual(rendered);
    const newer = await media.persistProjectOutputV2({
      projectId: project.id,
      declaredMimeType: 'video/mp4',
      width: 1920,
      height: 1080,
      body: Readable.from([mp4]),
    });
    await expect(createStudioMediaStore({ store }).getLatestProjectOutputV2(project.id)).resolves.toEqual(newer);
    await expect(media.getLatestProjectOutputV2('../project')).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(media.getLatestProjectOutputV2('missing_project')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects non-finite and non-positive V2 render durations from managed metadata', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const media = createStudioMediaStore({
      store,
      createId: () => 'render_v2_duration_guard',
      probeVideoDurationSecondsV2: async () => 12,
    });
    const rendered = await media.persistProjectOutputV2({
      projectId: project.id,
      declaredMimeType: 'video/mp4',
      width: 1920,
      height: 1080,
      body: Readable.from([mp4]),
    });
    const metadataPath = path.join(rootDir, project.id, 'assets', `${rendered.id}.render-v2.json`);
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Record<string, unknown>;
    for (const durationSeconds of ['not-a-number', 0]) {
      metadata.durationSeconds = durationSeconds;
      // eslint-disable-next-line no-await-in-loop -- Each scalar proves a separate short-circuit branch.
      await fs.writeFile(metadataPath, JSON.stringify(metadata));
      // eslint-disable-next-line no-await-in-loop -- Reopen from disk for each hostile value.
      await expect(media.getLatestProjectOutputV2(project.id)).resolves.toBeNull();
    }
  });

  it('imports a human seed candidate without pinning, selecting, authorizing, or spending', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'human-seed.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'human_seed_1' });

    const imported = await media.importReferenceFromPathV2({
      projectId: project.id,
      shotId: 'shot_1',
      sourcePath,
      expectedRevision: project.revision,
      returnProject: true,
    });

    expect(imported.asset).toMatchObject({
      id: 'human_seed_1',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'imports' },
    });
    expect(imported.project).toMatchObject({
      spendAuthorizations: [],
      jobs: {},
      shots: {
        shot_1: {
          assetIds: ['human_seed_1'],
          seedStillId: null,
          selectedTakeId: null,
          jobIds: [],
        },
      },
    });
  });

  it('rejects imports for individually binned Shots and Shots contained by binned Beats before staging bytes', async () => {
    await Promise.all(
      (['shot', 'beat'] as const).map(async (binKind) => {
        const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
        const sourcePath = path.join(rootDir, `${binKind}-binned-reference.png`);
        await fs.writeFile(sourcePath, png);
        const inactive = await store.updateProjectV2(project.id, (current) => {
          if (binKind === 'shot') {
            current.beats.beat_1!.shotOrder = [];
            current.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
          } else {
            current.beatOrder = [];
            current.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
          }
          return current;
        });
        const projectDirectory = path.join(rootDir, project.id);
        const entriesBefore = (await fs.readdir(projectDirectory, { recursive: true })).sort();
        const projectBefore = JSON.stringify(inactive);
        const media = createStudioMediaStore({ store, createId: () => `inactive_${binKind}_asset` });

        await expect(
          media.importReferenceFromPathV2({
            projectId: project.id,
            shotId: 'shot_1',
            sourcePath,
            expectedRevision: inactive.revision,
          })
        ).rejects.toMatchObject({ code: 'invalid_media' });

        const loaded = await store.getProjectV2(project.id);
        expect(loaded.status).toBe('supported');
        expect(loaded.status === 'supported' ? JSON.stringify(loaded.project) : null).toBe(projectBefore);
        expect((await fs.readdir(projectDirectory, { recursive: true })).sort()).toEqual(entriesBefore);
      })
    );
  });

  it('rechecks active Beat ownership inside the import commit and cleans staged bytes on refusal', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'concurrently-binned-reference.png');
    await fs.writeFile(sourcePath, png);
    const binned = structuredClone(project);
    binned.beatOrder = [];
    binned.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    const updateProjectV2 = vi.fn(
      async (_projectId: string, update: (current: StudioProjectV2) => StudioProjectV2): Promise<StudioProjectV2> =>
        update(structuredClone(binned))
    );
    const concurrentStore: CreativeStudioStore = { ...store, updateProjectV2 };
    const media = createStudioMediaStore({
      store: concurrentStore,
      createId: () => 'concurrently_binned_asset',
    });

    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(updateProjectV2).toHaveBeenCalledOnce();
    expect(await fs.readdir(path.join(rootDir, project.id, 'parts')).catch(() => [])).toEqual([]);
    expect(await fs.readdir(path.join(rootDir, project.id, 'imports')).catch(() => [])).toEqual([]);
    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? loaded.project : null).toEqual(project);
  });

  it('imports, labels, and safely detaches a V2 Brief reference', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'cast portrait.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'brief_imported' });
    const asset = await media.importReferenceFromPathV2({
      projectId: project.id,
      briefReferenceRole: 'cast',
      sourcePath,
      expectedRevision: project.revision,
    });
    expect(asset).toMatchObject({
      id: 'brief_imported',
      shotId: null,
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'cast portrait',
    });
    const imported = await store.getProjectV2(project.id);
    if (imported.status !== 'supported') throw new Error('Brief import fixture missing');
    const detached = await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: asset.id,
      expectedRevision: imported.project.revision,
    });
    expect(detached.assets).not.toHaveProperty(asset.id);
    await expect(fs.access(path.join(rootDir, project.id, 'imports', 'brief_imported.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('imports JPEG and WebP V2 references and safely detaches a Look reference', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from([0x00])]);
    const jpegPath = path.join(rootDir, 'look-reference.jpg');
    const webpPath = path.join(rootDir, 'cast-reference.webp');
    await Promise.all([fs.writeFile(jpegPath, jpeg), fs.writeFile(webpPath, webp)]);
    const media = createStudioMediaStore({
      store,
      createId: idSequence('brief_look_jpeg', 'brief_cast_webp'),
    });
    const look = await media.importReferenceFromPathV2({
      projectId: project.id,
      briefReferenceRole: 'look',
      sourcePath: jpegPath,
      expectedRevision: project.revision,
    });
    expect(look).toMatchObject({ id: 'brief_look_jpeg', mimeType: 'image/jpeg', briefReferenceRole: 'look' });
    let loaded = await store.getProjectV2(project.id);
    if (loaded.status !== 'supported') throw new Error('V2 JPEG fixture missing');
    const cast = await media.importReferenceFromPathV2({
      projectId: project.id,
      briefReferenceRole: 'cast',
      sourcePath: webpPath,
      expectedRevision: loaded.project.revision,
    });
    expect(cast).toMatchObject({ id: 'brief_cast_webp', mimeType: 'image/webp', briefReferenceRole: 'cast' });
    loaded = await store.getProjectV2(project.id);
    if (loaded.status !== 'supported') throw new Error('V2 WebP fixture missing');
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: look.id,
        expectedRevision: loaded.project.revision,
      })
    ).resolves.not.toHaveProperty(`assets.${look.id}`);
  });

  it('detaches valid V2 Brief metadata after its managed directory is already absent', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const withMissingBytes = await store.updateProjectV2(project.id, (current) => {
      current.assets.brief_missing_bytes = {
        id: 'brief_missing_bytes',
        projectId: current.id,
        shotId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'brief_missing_bytes.png' },
        byteSize: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        briefReferenceRole: 'cast',
        briefReferenceLabel: 'Missing bytes',
        createdAt: current.updatedAt,
      };
      return current;
    });
    const media = createStudioMediaStore({ store });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'brief_missing_bytes',
        expectedRevision: withMissingBytes.revision,
      })
    ).resolves.not.toHaveProperty('assets.brief_missing_bytes');
  });

  it('refuses to detach a shot-owned V2 seed through the Brief-reference seam', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take', includeAuthorizedJob: false });
    const media = createStudioMediaStore({ store });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'seed_v2',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('enforces V2 import media, revision, ownership, and Brief-capacity boundaries', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const imagePath = path.join(rootDir, 'reference.png');
    const videoPath = path.join(rootDir, 'reference.mp4');
    await fs.writeFile(imagePath, png);
    await fs.writeFile(videoPath, mp4);
    let idOrdinal = 0;
    const media = createStudioMediaStore({ store, createId: () => `import_case_${++idOrdinal}` });

    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'missing_shot',
        sourcePath: imagePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath: imagePath,
        expectedRevision: project.revision - 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        briefReferenceRole: 'look',
        sourcePath: videoPath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      createStudioMediaStore({ store, createId: () => '../unsafe' }).importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath: imagePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const importedIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- Capacity must be proven at every committed revision.
      const loaded = await store.getProjectV2(project.id);
      if (loaded.status !== 'supported') throw new Error('Brief capacity fixture missing');
      // eslint-disable-next-line no-await-in-loop -- Imports are intentionally serialized by revision.
      const imported = await media.importReferenceFromPathV2({
        projectId: project.id,
        briefReferenceRole: index % 2 === 0 ? 'cast' : 'look',
        sourcePath: imagePath,
        expectedRevision: loaded.project.revision,
      });
      importedIds.push(imported.id);
    }
    const full = await store.getProjectV2(project.id);
    if (full.status !== 'supported') throw new Error('Brief capacity fixture missing');
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        briefReferenceRole: 'cast',
        sourcePath: imagePath,
        expectedRevision: full.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: importedIds[0]!,
        expectedRevision: full.project.revision - 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'missing_asset',
        expectedRevision: full.project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('fails closed when a nonterminal immutable request still owns a Brief reference', async () => {
    const { rootDir, store, project } = await makeStoreV2({ briefReference: true });
    const media = createStudioMediaStore({ store });
    const managedPath = path.join(rootDir, project.id, 'imports', 'brief_v2.png');

    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'brief_v2',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'media_in_use' });
    await expect(fs.readFile(managedPath)).resolves.toEqual(png);
    expect(await store.getProjectV2(project.id)).toEqual({ status: 'supported', project });

    const terminal = await store.updateProjectV2(project.id, (current) => {
      const job = current.jobs.job_1!;
      job.status = 'failed';
      job.error = { code: 'no_output', messageKey: 'conversation.creativeStudio.jobs.errors.noOutput' };
      return current;
    });
    const detached = await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: 'brief_v2',
      expectedRevision: terminal.revision,
    });
    expect(detached.assets).not.toHaveProperty('brief_v2');
    expect(detached.jobs.job_1!.requestSnapshot?.referenceInput).toEqual({
      assetId: 'brief_v2',
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    await expect(fs.access(managedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('re-proves V2 provider-input bytes and refuses a same-path replacement', async () => {
    const { rootDir, store, project } = await makeStoreV2({ briefReference: true });
    const media = createStudioMediaStore({ store });
    const input = await media.resolveProviderInputV2(project.id, 'brief_v2');
    const chunks: Buffer[] = [];
    for await (const chunk of await input.openStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);
    await expect(input.asDataUrl(1.5)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(input.asDataUrl(png.length - 1)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(input.asDataUrl(png.length)).resolves.toBe(`data:image/png;base64,${png.toString('base64')}`);

    const managedPath = path.join(rootDir, project.id, 'imports', 'brief_v2.png');
    await fs.writeFile(managedPath, Buffer.concat([png, Buffer.from('replacement')]));
    await expect(media.resolveProviderInputV2(project.id, 'brief_v2')).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('rejects hostile V2 provider metadata before allocating or consuming a body', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const createId = vi.fn(() => 'must_not_allocate');
    const media = createStudioMediaStore({ store, createId });
    const cases: Array<[string, (input: Record<string, unknown>) => void]> = [
      ['unsafe project', (input) => (input.projectId = '../project')],
      ['unsafe shot', (input) => (input.shotId = '../shot')],
      ['unsafe job', (input) => (input.jobId = '../job')],
      ['wrong kind', (input) => (input.mediaKind = 'audio')],
      ['missing MIME', (input) => (input.declaredMimeType = null)],
      ['fractional width', (input) => (input.width = 1.5)],
      ['zero width', (input) => (input.width = 0)],
      ['fractional height', (input) => (input.height = 1.5)],
      ['zero height', (input) => (input.height = 0)],
      ['fractional bytes', (input) => (input.declaredByteSize = 1.5)],
      ['negative bytes', (input) => (input.declaredByteSize = -1)],
      ['non-finite duration', (input) => (input.durationSeconds = Number.NaN)],
      ['zero duration', (input) => (input.durationSeconds = 0)],
      ['oversized duration', (input) => (input.durationSeconds = Number.MAX_SAFE_INTEGER + 1)],
    ];

    for (const [label, mutate] of cases) {
      let consumed = false;
      const input: Record<string, unknown> = {
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop
      await expect(media.persistProviderOutputForJobV2(input as never), label).rejects.toMatchObject({
        code: 'invalid_media',
      });
      expect(consumed, label).toBe(false);
    }
    expect(createId).not.toHaveBeenCalled();
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed V2 media envelopes before allocating, reading, or mutating storage', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const createId = vi.fn(() => 'unused_asset');
    const media = createStudioMediaStore({ store, createId });
    const sourcePath = '/must/not/be/read.png';
    const importCases: Array<Record<string, unknown>> = [
      {
        projectId: '../project',
        shotId: 'shot_1',
        expectedRevision: project.revision,
        sourcePath,
      },
      {
        projectId: project.id,
        shotId: '../shot',
        expectedRevision: project.revision,
        sourcePath,
      },
      {
        projectId: project.id,
        briefReferenceRole: 'organisation',
        expectedRevision: project.revision,
        sourcePath,
      },
      { projectId: project.id, expectedRevision: project.revision, sourcePath },
      {
        projectId: project.id,
        shotId: 'shot_1',
        briefReferenceRole: 'cast',
        expectedRevision: project.revision,
        sourcePath,
      },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: 1.5, sourcePath },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: 0, sourcePath },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: project.revision, sourcePath: 42 },
    ];
    for (const input of importCases) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile envelope must refuse independently.
      await expect(media.importReferenceFromPathV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    const detachCases: Array<Record<string, unknown>> = [
      { projectId: '../project', assetId: 'asset_1', expectedRevision: 1 },
      { projectId: project.id, assetId: '../asset', expectedRevision: 1 },
      { projectId: project.id, assetId: 'asset_1', expectedRevision: 1.5 },
      { projectId: project.id, assetId: 'asset_1', expectedRevision: 0 },
    ];
    for (const input of detachCases) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile envelope must refuse independently.
      await expect(media.detachBriefReferenceV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    for (const input of [
      {
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        primaryAssetId: '../primary',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      },
      {
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        primaryAssetId: 'primary_1',
        declaredMimeType: 'video/mp4',
        body: Readable.from([png]),
      },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Each poster authority field must refuse independently.
      await expect(media.persistProviderPosterForJobV2(input)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    const capturedCases: Array<(input: Record<string, unknown>) => void> = [
      (input) => (input.projectId = '../project'),
      (input) => (input.shotId = '../shot'),
      (input) => (input.videoAssetId = '../video'),
      (input) => (input.width = 1.5),
      (input) => (input.width = 0),
      (input) => (input.height = 1.5),
      (input) => (input.height = 0),
      (input) => (input.declaredByteSize = 1.5),
      (input) => (input.declaredByteSize = -1),
    ];
    for (const mutate of capturedCases) {
      const input: Record<string, unknown> = {
        projectId: project.id,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        width: 1,
        height: 1,
        body: Readable.from([png]),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop -- Every scalar boundary must refuse independently.
      await expect(media.persistCapturedPosterV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    const outputCases: Array<(input: Record<string, unknown>) => void> = [
      (input) => (input.projectId = '../project'),
      (input) => (input.declaredMimeType = 'video/webm'),
      (input) => (input.width = 1.5),
      (input) => (input.width = 0),
      (input) => (input.height = 1.5),
      (input) => (input.height = 0),
      (input) => (input.declaredByteSize = 1.5),
      (input) => (input.declaredByteSize = 0),
      (input) => (input.durationSeconds = Number.NaN),
      (input) => (input.durationSeconds = 0),
    ];
    for (const mutate of outputCases) {
      const input: Record<string, unknown> = {
        projectId: project.id,
        declaredMimeType: 'video/mp4',
        width: 1,
        height: 1,
        body: Readable.from([mp4]),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop -- Every scalar boundary must refuse independently.
      await expect(media.persistProjectOutputV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    await expect(
      media.extractConditioningFrameV2({ projectId: '../project', extractionId: 'frame_1' })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.extractConditioningFrameV2({ projectId: project.id, extractionId: '../frame' })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.verifyConditioningFrameV2({ projectId: '../project', extractionId: 'frame_1' })
    ).resolves.toBeNull();
    await expect(
      media.verifyConditioningFrameV2({ projectId: project.id, extractionId: '../frame' })
    ).resolves.toBeNull();
    await expect(media.resolveAssetV2('../project', 'asset_1')).resolves.toBeNull();
    await expect(media.resolveAssetV2(project.id, '../asset')).resolves.toBeNull();
    await expect(media.resolveAssetV2(project.id, 'missing_asset')).resolves.toBeNull();
    await expect(media.resolveProviderInputV2(project.id, 'missing_asset')).rejects.toMatchObject({
      code: 'invalid_media',
    });

    const sparse: string[] = [];
    sparse.length = 1;
    for (const ids of [null, sparse, ['../project'], [project.id, project.id]] as unknown[]) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile recovery list must refuse independently.
      await expect(media.resumeConditioningFramesV2(ids as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }
    expect(createId).not.toHaveBeenCalled();
  });

  it('rejects every malformed ready-frame proof before touching managed bytes', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const extractionId = 'extraction_1';
    const frameId = 'frame_1';
    const base = structuredClone(project);
    base.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 5,
      status: 'ready',
      frameAssetId: frameId,
      errorCode: null,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
    };
    base.assets[frameId] = {
      id: frameId,
      projectId: base.id,
      shotId: 'shot_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'conditioningFrames', fileName: 'frame_1.png' },
      byteSize: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      createdAt: base.createdAt,
    };
    base.shots.shot_1!.assetIds.push(frameId);

    const cases: Array<StudioProjectV2 | null> = [
      null,
      { ...structuredClone(base), frameExtractions: {} },
      (() => {
        const candidate = structuredClone(base);
        candidate.frameExtractions[extractionId]!.status = 'pending';
        candidate.frameExtractions[extractionId]!.frameAssetId = null;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.frameExtractions[extractionId]!.status = 'failed';
        candidate.frameExtractions[extractionId]!.frameAssetId = null;
        candidate.frameExtractions[extractionId]!.errorCode = 'decode_failed';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.frameExtractions[extractionId]!.frameAssetId = null;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        delete candidate.assets[frameId];
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.projectId = 'foreign_project';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.shotId = 'foreign_shot';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.mediaKind = 'video';
        candidate.assets[frameId]!.mimeType = 'video/mp4';
        candidate.assets[frameId]!.durationSeconds = 5;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.managedAsset.collection = 'assets';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.shots.shot_1!.assetIds = [];
        return candidate;
      })(),
    ];

    for (const candidate of cases) {
      const wrappedStore = {
        ...store,
        getProjectV2: vi.fn(async () =>
          candidate === null
            ? { status: 'unsupported_prototype_schema' as const, schemaVersion: 1 }
            : { status: 'supported' as const, project: structuredClone(candidate) }
        ),
      };
      const media = createStudioMediaStore({ store: wrappedStore as CreativeStudioStore });
      // eslint-disable-next-line no-await-in-loop -- Each malformed proof is independently authoritative.
      await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toBeNull();
      // eslint-disable-next-line no-await-in-loop -- Extraction must reject the same malformed durable authority.
      await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toBeDefined();
    }
  });

  it('cleans only schema-2 orphan parts and leaves prototype storage untouched', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-v2-cleanup-'));
    created.push(rootDir);
    const store = createCreativeStudioStore({
      rootDir,
      createId: idSequence('project_v2'),
      now: () => '2026-08-17T12:00:00.000Z',
    });
    const prototypeDirectory = path.join(rootDir, 'prototype_1');
    await fs.mkdir(prototypeDirectory);
    await fs.writeFile(path.join(prototypeDirectory, 'project.json'), JSON.stringify({ schemaVersion: 1 }));
    await store.createProjectV2({
      name: 'Schema Two',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const canonicalRoot = await fs.realpath(rootDir);
    const prototypeParts = path.join(canonicalRoot, 'prototype_1', 'parts');
    const v2Parts = path.join(canonicalRoot, 'project_v2', 'parts');
    await fs.mkdir(prototypeParts);
    await fs.mkdir(v2Parts);
    await fs.writeFile(path.join(prototypeParts, 'prototype.part'), 'prototype');
    await fs.writeFile(path.join(v2Parts, 'orphan.part'), 'partial');
    await fs.writeFile(path.join(v2Parts, 'keep.txt'), 'keep');

    await createStudioMediaStore({ store }).cleanupOrphanPartsV2();

    await expect(fs.readFile(path.join(prototypeParts, 'prototype.part'), 'utf8')).resolves.toBe('prototype');
    await expect(fs.access(path.join(v2Parts, 'orphan.part'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(v2Parts, 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });

  it('extracts one trim-aware local conditioning frame and coalesces duplicate scheduling', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    let releaseExtraction!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const conditioningFrameExtractor = vi.fn(async (input: { destinationPath: string }) => {
      await extractionGate;
      await fs.writeFile(input.destinationPath, png);
      return { source: 'local_decode' as const };
    });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_asset_1'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 8,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.shots.shot_1!.trimOutSeconds = 2;
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 8,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    const first = media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const duplicate = media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(conditioningFrameExtractor).toHaveBeenCalledOnce());
    releaseExtraction();
    await expect(first).resolves.toMatchObject({
      id: extractionId,
      status: 'ready',
      frameAssetId: 'frame_asset_1',
      errorCode: null,
    });
    expect(conditioningFrameExtractor).toHaveBeenCalledWith({
      sourcePath: expect.stringMatching(/[/\\]assets[/\\]take_1\.mp4$/),
      sourceExpectation: {
        byteSize: mp4.length,
        sha256: createHash('sha256').update(mp4).digest('hex'),
      },
      destinationPath: expect.stringMatching(/[/\\]parts[/\\]frame_asset_1\.part$/),
      endpointSeconds: 8,
      sourceDurationSeconds: 10,
      providerLastFramePath: null,
      providerLastFrameExpectation: null,
      allowProviderLastFrame: false,
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        assets: {
          frame_asset_1: {
            shotId: 'shot_1',
            mediaKind: 'image',
            managedAsset: { collection: 'conditioningFrames', fileName: 'frame_asset_1.png' },
          },
        },
        shots: { shot_1: { assetIds: ['seed_v2', 'take_1', 'frame_asset_1'] } },
      },
    });
    const resolved = await media.resolveAssetV2(project.id, 'frame_asset_1');
    const chunks: Buffer[] = [];
    for await (const chunk of await resolved!.openVerifiedStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);

    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_asset_1.png');
    const originalStats = await fs.stat(framePath);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toEqual({
      extractionId,
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 8,
      frameAssetId: 'frame_asset_1',
      byteSize: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });

    const replacement = Buffer.from(png);
    replacement[replacement.length - 1] ^= 0xff;
    await fs.writeFile(framePath, replacement);
    await fs.utimes(framePath, originalStats.atime, originalStats.mtime);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toBeNull();

    await fs.writeFile(framePath, png);
    await fs.utimes(framePath, originalStats.atime, originalStats.mtime);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.not.toBeNull();
    const renamedReplacement = path.join(rootDir, 'same-header-replacement.png');
    await fs.writeFile(renamedReplacement, replacement);
    await fs.utimes(renamedReplacement, originalStats.atime, originalStats.mtime);
    await fs.rename(renamedReplacement, framePath);
    await fs.utimes(framePath, originalStats.atime, originalStats.mtime);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toBeNull();
  });

  it('records a stable local extraction failure without creating frame bytes or paid work', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_asset_1'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor: async () => {
        throw new StudioConditioningFrameError('decode_failed');
      },
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 10,
    });
    const before = await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toMatchObject({
      code: 'decode_failed',
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: {
          [extractionId]: { status: 'failed', frameAssetId: null, errorCode: 'decode_failed' },
        },
        spendAuthorizations: before.spendAuthorizations,
        jobs: before.jobs,
      },
    });
    await expect(fs.access(path.join(rootDir, project.id, 'parts', 'frame_asset_1.part'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('persists each conditioning-frame byte, signature, quota, disk, and identity refusal', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const setupMedia = createStudioMediaStore({
      store,
      createId: () => 'take_for_failures',
      probeVideoDurationSecondsV2: async () => 10,
    });
    await setupMedia.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_for_failures',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_for_failures';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_for_failures',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    const scenarios = [
      {
        id: 'frame_empty',
        expectedCode: 'decode_failed',
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, Buffer.alloc(0)),
      },
      {
        id: 'frame_video',
        expectedCode: 'decode_failed',
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, mp4),
      },
      {
        id: 'frame_asset_cap',
        expectedCode: 'invalid_media',
        limits: { imageOutputMaxBytes: png.length - 1 },
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
      {
        id: 'frame_project_cap',
        expectedCode: 'invalid_media',
        limits: { projectMaxBytes: 1 },
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
      {
        id: 'frame_no_disk',
        expectedCode: 'storage_error',
        diskBytes: 0,
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
      {
        id: '../unsafe_frame',
        expectedCode: 'storage_error',
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
    ] as const;

    for (const scenario of scenarios) {
      const conditioningFrameExtractor = vi.fn(async ({ destinationPath }: { destinationPath: string }) => {
        await scenario.extract(destinationPath);
        return { source: 'local_decode' as const };
      });
      const media = createStudioMediaStore({
        store,
        createId: () => scenario.id,
        conditioningFrameExtractor,
        ...('limits' in scenario ? { limits: scenario.limits } : {}),
        ...('diskBytes' in scenario ? { getAvailableDiskBytes: async () => scenario.diskBytes } : {}),
      });
      // eslint-disable-next-line no-await-in-loop -- Every frame refusal must persist independently.
      await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toMatchObject({
        code: scenario.expectedCode,
      });
      // eslint-disable-next-line no-await-in-loop -- Reset is the explicit provider-free retry transition.
      await store.updateProjectV2(project.id, (current) => {
        const extraction = current.frameExtractions[extractionId]!;
        expect(extraction).toMatchObject({ status: 'failed', frameAssetId: null });
        extraction.status = 'pending';
        extraction.errorCode = null;
        return current;
      });
      expect(conditioningFrameExtractor).toHaveBeenCalledTimes(scenario.id.startsWith('../') ? 0 : 1);
    }
    expect(await fs.readdir(path.join(rootDir, project.id, 'conditioningFrames')).catch(() => [])).toEqual([]);
  });

  it('adopts only an exact untrimmed Seedance provider last frame', async () => {
    const { store, project } = await makeStoreV2({
      purpose: 'video_take',
      adapterId: 'byteplus-seedance-v1',
    });
    const conditioningFrameExtractor = vi.fn(async (input: { destinationPath: string }) => {
      await fs.writeFile(input.destinationPath, png);
      return { source: 'provider_last_frame' as const };
    });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'poster_1', 'frame_asset_1'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    await media.persistProviderPosterForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      primaryAssetId: 'take_1',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    await media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    expect(conditioningFrameExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        allowProviderLastFrame: true,
        providerLastFramePath: expect.stringMatching(/[/\\]thumbnails[/\\]poster_1\.png$/),
        providerLastFrameExpectation: {
          byteSize: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
        },
      })
    );
  });

  it('re-derives a deleted ready frame into the same asset identity during recovery', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const conditioningFrameExtractor = vi.fn(async (input: { destinationPath: string }) => {
      await fs.writeFile(input.destinationPath, png);
      return { source: 'local_decode' as const };
    });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_asset_1', 'must_not_allocate'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });
    await media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_asset_1.png');
    await fs.rm(framePath);

    await media.resumeConditioningFramesV2([project.id]);

    expect(conditioningFrameExtractor).toHaveBeenCalledTimes(2);
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: { [extractionId]: { status: 'ready', frameAssetId: 'frame_asset_1' } },
        jobs: { job_1: { id: 'job_1', status: 'succeeded' } },
      },
    });
    await expect(fs.readFile(framePath)).resolves.toEqual(png);
  });
});
