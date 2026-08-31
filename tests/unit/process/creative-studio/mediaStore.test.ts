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
import {
  STUDIO_EFFECTIVE_SILENCE_MEAN_DBFS_V1,
  STUDIO_EFFECTIVE_SILENCE_PEAK_DBFS_V1,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
} from '@/common/types/project/creativeStudioTypes';
import {
  createCreativeStudioStore,
  type CreativeStudioStore,
  type StudioProjectAuthoritySnapshotV2,
} from '@process/services/creative-studio/store';
import {
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
  deriveStudioInstructionProfileV2,
} from '@process/services/creative-studio/service/schema2/generation';
import { createStudioSpendReceiptV2 } from '@process/services/creative-studio/service/schema2/pricing';
import { createStudioExportCatalogStoreV2 } from '@process/services/creative-studio/service/schema2/exports/catalog';
import { StudioConditioningFrameError } from '@process/services/creative-studio/adapters/conditioningFrame';
import {
  classifyStudioVideoAudioLoudnessV2,
  createStudioMediaStore,
  CreativeStudioMediaError,
  getAvailableStudioDiskBytes,
  openVerifiedReadStream,
  STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION,
  studioImageHasVariationGridV2,
} from '@process/services/creative-studio/mediaStore';

const { createHashSpy, spawnCalls } = vi.hoisted(() => ({
  createHashSpy: vi.fn(),
  spawnCalls: [] as Array<{
    command: string;
    args: readonly string[];
    options: Parameters<typeof import('node:child_process').spawn>[2];
  }>,
}));

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

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const [command, commandArgs, options] = args;
      spawnCalls.push({ command, args: [...commandArgs], options });
      return actual.spawn(...args);
    },
  };
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwTpv5HwAENAIyeXoBdAAAAABJRU5ErkJggg==',
  'base64'
);
const mp4 = Buffer.from('000000186674797069736f6d00000000', 'hex');
const decodedMp4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPBbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAJxAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAArV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAJxAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAACcQAACAAAABAAAAAAItbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAACgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB2G1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAZhzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqscgRewEQAAAMABAAAAwAIPEiWEYABAAZo6EOPLIv9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAApYAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAoAAEAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAA4Y3R0cwAAAAAAAAAFAAAAAQAAgAAAAAABAAKAAAAAAAEAAQAAAAAAAwAAAAAAAAAEAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAACgAAAAEAAAA8c3RzegAAAAAAAAAAAAAACgAAAscAAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAAUc3RjbwAAAAAAAAABAAAD8QAAAJh1ZHRhAAAAkG1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAAY2lsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDEAAAA3qWNtdAAAAC9kYXRhAAAAAQAAAABTVFVESU9fUkFXX09VVFBVVF9CT0RZX1NFTlRJTkVMAAAACGZyZWUAAANEbWRhdAAAAq8GBf//q9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0xNiBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTMzIG1lPXVtaCBzdWJtZT0xMCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTI0IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz04IGJfcHlyYW1pZD0yIGJfYWRhcHQ9MiBiX2JpYXM9MCBkaXJlY3Q9MyB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD02MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAQZYiBAAL//vfUt8yy7gcjgQAAAAlBmgktiCv//vAAAAAJQZ4QhxBf/4aBAAAACQGeGCaIK/+SgAAAAAkBnhhGiCv/koEAAAAJAZ4YZogr/5KBAAAACQGeGK1IK/+SgQAAAAkBnhjNSCv/koEAAAAJAZ4Y7Ugr/5KAAAAACQGeGQ1IK/+SgA==',
  'base64'
);
const createWav = (sample = 0x80): Buffer => {
  const sampleRate = 8_000;
  const samples = Buffer.alloc(sampleRate, sample);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
};
const createCorruptAdpcmWav = (): Buffer => {
  const data = Buffer.alloc(256);
  data[2] = 0xff;
  const header = Buffer.alloc(60);
  header.write('RIFF', 0);
  header.writeUInt32LE(308, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(20, 16);
  header.writeUInt16LE(0x11, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8_000, 24);
  header.writeUInt32LE(Math.floor((8_000 * 256) / 505), 28);
  header.writeUInt16LE(256, 32);
  header.writeUInt16LE(4, 34);
  header.writeUInt16LE(2, 36);
  header.writeUInt16LE(505, 38);
  header.write('fact', 40);
  header.writeUInt32LE(4, 44);
  header.writeUInt32LE(505, 48);
  header.write('data', 52);
  header.writeUInt32LE(data.length, 56);
  return Buffer.concat([header, data]);
};
const wav = createWav();
const created: string[] = [];

const makeStoreV2 = async (
  options: {
    purpose?: StudioJobV2['purpose'];
    addSecondShot?: boolean;
    includeAuthorizedJob?: boolean;
    includeSeedAsset?: boolean;
    projectReferenceId?: string;
    projectReferenceKind?: 'character' | 'background';
    adapterId?: StudioJobV2['provider']['adapterId'];
    prompt?: string;
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
    boardStyle: options.purpose === 'board_still' ? 'grey_tone' : null,
    beatOrder: options.addSecondShot ? ['beat_1', 'beat_2'] : ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        story: 'An opening image establishes the film.',
        targetSeconds: null,
        shotOrder: ['shot_1'],
      },
      ...(options.addSecondShot
        ? {
            beat_2: {
              id: 'beat_2',
              title: 'Closing',
              story: 'A closing image resolves the film.',
              targetSeconds: null,
              shotOrder: ['shot_2'],
            },
          }
        : {}),
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        shootingScript: options.prompt ?? 'A precise opening frame.',
        durationSeconds: 5,
        trimInSeconds: null,
        trimOutSeconds: null,
        chainBreak: 'none',
        referenceBinding: {
          status: options.purpose === 'board_still' ? 'ready' : 'unassigned',
          characterReferenceIds: [],
          backgroundReferenceId: null,
        },
        seedStillId: null,
        dismissedSeedStillIds: [],
        boardAssetId: null,
        supersededBoardAssetIds: [],
        videoAssetId: null,
        supersededVideoAssetIds: [],
        assetIds: [],
        jobIds: [],
      },
      ...(options.addSecondShot
        ? {
            shot_2: {
              id: 'shot_2',
              shootingScript: 'A separate closing frame.',
              durationSeconds: 5,
              trimInSeconds: null,
              trimOutSeconds: null,
              chainBreak: 'none' as const,
              referenceBinding: {
                status: 'unassigned' as const,
                characterReferenceIds: [],
                backgroundReferenceId: null,
              },
              seedStillId: null,
              dismissedSeedStillIds: [],
              boardAssetId: null,
              supersededBoardAssetIds: [],
              videoAssetId: null,
              supersededVideoAssetIds: [],
              assetIds: [],
              jobIds: [],
            },
          }
        : {}),
    },
    ...(options.projectReferenceId === undefined
      ? {}
      : {
          referencePlanStatus: 'planned' as const,
          referenceOrder: [options.projectReferenceId],
          references: {
            [options.projectReferenceId]: {
              id: options.projectReferenceId,
              kind: options.projectReferenceKind ?? ('character' as const),
              label: 'Ming',
              prompt: 'A careful engineer',
              approvedAssetId: null,
              supersededAssetIds: [],
              jobIds: [],
              createdAt: current.updatedAt,
              updatedAt: current.updatedAt,
            },
          },
        }),
  }));
  let quoteBase = authored;
  const purpose = options.projectReferenceId === undefined ? (options.purpose ?? 'seed_still') : 'reference_image';
  if (purpose === 'video_take' || options.includeSeedAsset) {
    const importsDirectory = path.join(rootDir, authored.id, 'imports');
    await fs.mkdir(importsDirectory, { recursive: true });
    await fs.writeFile(path.join(importsDirectory, 'seed_v2.png'), png);
    quoteBase = await store.updateProjectV2(authored.id, (current) => {
      current.assets.seed_v2 = {
        id: 'seed_v2',
        projectId: current.id,
        shotId: 'shot_1',
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'seed_v2.png' },
        byteSize: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
        createdAt: current.updatedAt,
      };
      current.shots.shot_1!.assetIds.push('seed_v2');
      current.shots.shot_1!.seedStillId = 'seed_v2';
      return current;
    });
  }
  if (options.includeAuthorizedJob === false) {
    return { rootDir, store, project: quoteBase, authorization: null, item: null };
  }
  const provider = {
    providerId: 'provider_1',
    adapterId:
      options.adapterId ??
      (purpose === 'video_take' ? ('weprompt-media-gateway-v1' as const) : ('weprompt-image-v1' as const)),
    model: purpose === 'video_take' ? 'video-model' : 'image-model',
  };
  const target =
    options.projectReferenceId === undefined
      ? { kind: 'shot' as const, shotId: 'shot_1' }
      : { kind: 'reference' as const, referenceId: options.projectReferenceId };
  const source =
    target.kind === 'shot'
      ? {
          kind: 'shot' as const,
          beatId: 'beat_1',
          story: quoteBase.beats.beat_1!.story,
          shotId: target.shotId,
          shootingScript: options.prompt ?? quoteBase.shots.shot_1!.shootingScript,
        }
      : {
          kind: 'project_reference' as const,
          referenceId: target.referenceId,
          referenceKind: quoteBase.references[target.referenceId]!.kind,
          prompt: quoteBase.references[target.referenceId]!.prompt,
        };
  const referenceInputs: [] = [];
  const composition = composeStudioGenerationV2({
    projectRevision: quoteBase.revision,
    brief: quoteBase.brief,
    rules: quoteBase.rules,
    source,
    purpose,
    referenceInputs,
    aspectRatio: quoteBase.aspectRatio,
    resolution: quoteBase.resolution,
    route: provider,
    boardStyle: purpose === 'board_still' ? quoteBase.boardStyle : null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, purpose, source),
  });
  const requestPlan: Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> = {
    kind: 'resolved',
    snapshot: {
      composition,
      aspectRatio: quoteBase.aspectRatio,
      resolution: quoteBase.resolution,
      durationSeconds: purpose === 'board_still' ? 4 : 5,
      referenceInputs,
      conditioningInput: purpose === 'video_take' ? { kind: 'seed_still', assetId: 'seed_v2' } : null,
    },
  };
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId: quoteBase.id,
      projectRevision: quoteBase.revision,
      target,
      purpose,
    }),
    target,
    purpose,
    routeId: purpose === 'video_take' ? 'route_video' : 'route_image',
    generationCount: 1,
    requestPlan,
    rateUnit: purpose === 'video_take' ? 'second' : 'generation',
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (totals === null) throw new Error('invalid quote fixture');
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
    idempotencyKeys: [{ itemId: item.id, key: 'key_1' }],
  };
  const receipt = createStudioSpendReceiptV2({
    authorization,
    itemId: item.id,
    jobId: 'job_1',
  });
  const project = await store.updateProjectV2(quoteBase.id, (current) => {
    const job: StudioJobV2 = {
      id: 'job_1',
      projectId: current.id,
      target: structuredClone(target),
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
      composition,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: receipt,
      outputAssetIdsByRole: { primary: null, poster: null },
    };
    current.spendAuthorizations = [authorization];
    current.jobs.job_1 = job;
    if (target.kind === 'shot') current.shots[target.shotId]!.jobIds.push(job.id);
    else current.references[target.referenceId]!.jobIds.push(job.id);
    return current;
  });
  return { rootDir, store, project, authorization, item };
};

const addBoardRedrawJob = async (store: CreativeStudioStore, projectId: string): Promise<StudioProjectV2> => {
  const loaded = await store.getProjectV2(projectId);
  if (loaded.status !== 'supported') throw new Error('Board redraw fixture missing');
  const requestPlan = loaded.project.jobs.job_1?.requestPlan;
  const provider = loaded.project.jobs.job_1?.provider;
  if (requestPlan?.kind !== 'resolved' || provider === undefined) throw new Error('Board redraw authority missing');
  const target = { kind: 'shot' as const, shotId: 'shot_1' };
  const shot = loaded.project.shots.shot_1;
  const beat = loaded.project.beats.beat_1;
  if (shot === undefined || beat === undefined || loaded.project.boardStyle === null) {
    throw new Error('Board redraw source missing');
  }
  const composition = composeStudioGenerationV2({
    projectRevision: loaded.project.revision,
    brief: loaded.project.brief,
    rules: loaded.project.rules,
    source: {
      kind: 'shot',
      beatId: beat.id,
      story: beat.story,
      shotId: shot.id,
      shootingScript: shot.shootingScript,
    },
    purpose: 'board_still',
    referenceInputs: structuredClone(requestPlan.snapshot.referenceInputs),
    aspectRatio: loaded.project.aspectRatio,
    resolution: loaded.project.resolution,
    route: provider,
    boardStyle: loaded.project.boardStyle,
    instructionProfile: deriveStudioInstructionProfileV2(provider, 'board_still', {
      kind: 'shot',
      beatId: beat.id,
      story: beat.story,
      shotId: shot.id,
      shootingScript: shot.shootingScript,
    }),
  });
  const redrawRequestPlan: Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> = {
    kind: 'resolved',
    snapshot: {
      ...structuredClone(requestPlan.snapshot),
      composition,
      referenceInputs: structuredClone(composition.inputs.referenceInputs),
    },
  };
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId,
      projectRevision: loaded.project.revision,
      target,
      purpose: 'board_still',
    }),
    target,
    purpose: 'board_still',
    routeId: 'route_image',
    generationCount: 1,
    requestPlan: redrawRequestPlan,
    rateUnit: 'generation',
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (totals === null) throw new Error('Invalid Board redraw total');
  const authorization: StudioSpendAuthorization = {
    id: 'authorization_redraw',
    projectId,
    projectRevision: loaded.project.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'c'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-17T12:10:00.000Z',
    confirmedAt: '2026-08-17T12:05:01.000Z',
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, key: 'key_redraw' }],
  };
  const receipt = createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: 'job_redraw' });
  return store.updateProjectV2(projectId, (current) => {
    current.spendAuthorizations.push(authorization);
    current.jobs.job_redraw = {
      id: 'job_redraw',
      projectId,
      target,
      status: 'running',
      provider,
      idempotencyKey: 'key_redraw',
      providerJobId: null,
      cancellationPolicy: 'none',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: '2026-08-17T12:05:01.000Z',
      updatedAt: '2026-08-17T12:05:01.000Z',
      purpose: 'board_still',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      composition,
      requestPlan: structuredClone(redrawRequestPlan),
      requestSnapshot: structuredClone(redrawRequestPlan.snapshot),
      spendReceipt: receipt,
      outputAssetIdsByRole: { primary: null, poster: null },
    };
    current.shots.shot_1!.jobIds.push('job_redraw');
    return current;
  });
};

const addVideoRedrawJob = async (
  store: CreativeStudioStore,
  projectId: string,
  options: { interruptFirstDownload?: boolean } = {}
): Promise<StudioProjectV2> => {
  const loaded = await store.getProjectV2(projectId);
  if (loaded.status !== 'supported') throw new Error('Video redraw fixture missing');
  const original = loaded.project.jobs.job_1;
  const shot = loaded.project.shots.shot_1;
  const beat = loaded.project.beats.beat_1;
  if (
    original?.purpose !== 'video_take' ||
    original.requestPlan?.kind !== 'resolved' ||
    shot === undefined ||
    beat === undefined ||
    shot.seedStillId === null
  ) {
    throw new Error('Video redraw authority missing');
  }
  const target = { kind: 'shot' as const, shotId: shot.id };
  const source = {
    kind: 'shot' as const,
    beatId: beat.id,
    story: beat.story,
    shotId: shot.id,
    shootingScript: shot.shootingScript,
  };
  const provider = structuredClone(original.provider);
  const referenceInputs = structuredClone(original.requestPlan.snapshot.referenceInputs);
  const composition = composeStudioGenerationV2({
    projectRevision: loaded.project.revision,
    brief: loaded.project.brief,
    rules: loaded.project.rules,
    source,
    purpose: 'video_take',
    referenceInputs,
    aspectRatio: loaded.project.aspectRatio,
    resolution: loaded.project.resolution,
    route: provider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, 'video_take', source),
  });
  const requestPlan: Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> = {
    kind: 'resolved',
    snapshot: {
      composition,
      aspectRatio: loaded.project.aspectRatio,
      resolution: loaded.project.resolution,
      durationSeconds: shot.durationSeconds,
      referenceInputs,
      conditioningInput: { kind: 'seed_still', assetId: shot.seedStillId },
    },
  };
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId,
      projectRevision: loaded.project.revision,
      target,
      purpose: 'video_take',
    }),
    target,
    purpose: 'video_take',
    routeId: 'route_video',
    generationCount: 1,
    requestPlan,
    rateUnit: 'second',
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (totals === null) throw new Error('Invalid video redraw total');
  const authorization: StudioSpendAuthorization = {
    id: 'authorization_video_redraw',
    projectId,
    projectRevision: loaded.project.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'd'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-17T12:10:00.000Z',
    confirmedAt: '2026-08-17T12:05:01.000Z',
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, key: 'key_video_redraw' }],
  };
  const receipt = createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: 'job_video_redraw' });
  return store.updateProjectV2(projectId, (current) => {
    if (options.interruptFirstDownload === true) {
      const interruptedDownload = current.jobs.job_1!;
      interruptedDownload.status = 'failed';
      interruptedDownload.providerJobId = 'remote_job_1';
      interruptedDownload.error = { code: 'download_failed', messageKey: 'downloadFailed' };
    }
    current.spendAuthorizations.push(authorization);
    current.jobs.job_video_redraw = {
      id: 'job_video_redraw',
      projectId,
      target,
      status: 'running',
      provider,
      idempotencyKey: 'key_video_redraw',
      providerJobId: null,
      cancellationPolicy: 'none',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: '2026-08-17T12:05:01.000Z',
      updatedAt: '2026-08-17T12:05:01.000Z',
      purpose: 'video_take',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      composition,
      requestPlan: structuredClone(requestPlan),
      requestSnapshot: structuredClone(requestPlan.snapshot),
      spendReceipt: receipt,
      outputAssetIdsByRole: { primary: null, poster: null },
    };
    current.shots.shot_1!.jobIds.push('job_video_redraw');
    return current;
  });
};

const idSequence = (...ids: string[]): (() => string) => {
  let index = 0;
  return () => ids[index++] ?? `asset_${index}`;
};

const wrapFinalProjectCommitAuthorization = (
  store: CreativeStudioStore,
  beforeFinalAuthorization: () => Promise<void>
): CreativeStudioStore => ({
  ...store,
  withProjectAuthorityV2: <T>(
    projectId: string,
    operation: (snapshot: StudioProjectAuthoritySnapshotV2) => Promise<T>
  ): Promise<T> =>
    store.withProjectAuthorityV2(projectId, (snapshot) =>
      operation({
        ...snapshot,
        commit: (update, expectedRevision, commitTag, authorizeBeforeReplace) => {
          let authorizationCount = 0;
          return snapshot.commit(update, expectedRevision, commitTag, async () => {
            authorizationCount += 1;
            if (authorizationCount === 2) await beforeFinalAuthorization();
            await authorizeBeforeReplace?.();
          });
        },
      })
    ),
});

type AmbiguousProjectCommitFailure = 'post_project_rename' | 'project_directory_sync';

const createAmbiguousProjectCommitFs = (
  projectDirectory: string,
  failure: AmbiguousProjectCommitFailure
): { fs: typeof fs; state: { injected: boolean } } => {
  const projectFile = path.join(projectDirectory, 'project.json');
  const state = { injected: false };
  let projectRenameObserved = false;
  const failingFs = new Proxy(fs, {
    get(target, property, receiver) {
      if (property === 'rename') {
        return async (...args: Parameters<typeof fs.rename>): ReturnType<typeof fs.rename> => {
          await fs.rename(...args);
          if (path.resolve(String(args[1])) === projectFile) projectRenameObserved = true;
        };
      }
      if (property === 'lstat') {
        return async (...args: Parameters<typeof fs.lstat>): ReturnType<typeof fs.lstat> => {
          if (
            failure === 'post_project_rename' &&
            projectRenameObserved &&
            !state.injected &&
            path.resolve(String(args[0])) === projectFile
          ) {
            state.injected = true;
            throw Object.assign(new Error('injected post-project-rename lstat failure'), { code: 'EIO' });
          }
          return fs.lstat(...args);
        };
      }
      if (property !== 'open') return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof fs.open>) => {
        const openedPath = path.resolve(String(args[0]));
        const handle = await fs.open(...args);
        if (openedPath !== projectDirectory) return handle;
        return new Proxy(handle, {
          get(handleTarget, handleProperty, handleReceiver) {
            if (handleProperty === 'sync') {
              return async (): Promise<void> => {
                await handleTarget.sync();
                if (failure === 'project_directory_sync' && projectRenameObserved && !state.injected) {
                  state.injected = true;
                  throw Object.assign(new Error('injected project-directory sync failure'), { code: 'EIO' });
                }
              };
            }
            const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
            return typeof value === 'function' ? value.bind(handleTarget) : value;
          },
        });
      };
    },
  }) as typeof fs;
  return { fs: failingFs, state };
};

afterEach(async () => {
  spawnCalls.length = 0;
  await Promise.all(created.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

/**
 * 76 cases that write real bytes, hashes and quota state to disk. The same sweep found 7 of them
 * over 2s, second only to the job manager.
 *
 * Under full-suite parallelism these exceeded the 10s global testTimeout and failed the push gate on
 * timing rather than on merit. The ceiling is set on the suite because which case loses the race
 * under load is arbitrary — the first such failure in this file family was a 1.35s case, not the
 * slowest. It is a hang-detector, not a performance budget: a genuine hang still fails, just later,
 * and no assertion is weakened. See tests/unit/assets/prepareAioncoreActionsArtifact.test.ts, where
 * 30s was tried for the same class of case and proved too tight.
 */
const MEDIA_STORE_TIMEOUT_MS = 120_000;

describe('createStudioMediaStore schema 2 final lifecycle', { timeout: MEDIA_STORE_TIMEOUT_MS }, () => {
  it('classifies effective silence at both profile boundaries and becomes audible above either boundary', () => {
    expect(
      classifyStudioVideoAudioLoudnessV2(STUDIO_EFFECTIVE_SILENCE_MEAN_DBFS_V1, STUDIO_EFFECTIVE_SILENCE_PEAK_DBFS_V1)
    ).toEqual({
      status: 'effectively_silent',
      meanVolumeDbfs: STUDIO_EFFECTIVE_SILENCE_MEAN_DBFS_V1,
      peakVolumeDbfs: STUDIO_EFFECTIVE_SILENCE_PEAK_DBFS_V1,
    });
    expect(classifyStudioVideoAudioLoudnessV2(null, null)).toEqual({
      status: 'effectively_silent',
      meanVolumeDbfs: null,
      peakVolumeDbfs: null,
    });
    expect(
      classifyStudioVideoAudioLoudnessV2(
        STUDIO_EFFECTIVE_SILENCE_MEAN_DBFS_V1 + 0.001,
        STUDIO_EFFECTIVE_SILENCE_PEAK_DBFS_V1
      ).status
    ).toBe('audible');
    expect(
      classifyStudioVideoAudioLoudnessV2(
        STUDIO_EFFECTIVE_SILENCE_MEAN_DBFS_V1,
        STUDIO_EFFECTIVE_SILENCE_PEAK_DBFS_V1 + 0.001
      ).status
    ).toBe('audible');
  });

  it('detects repeated quartile sheet seams without rejecting one strong central edge', () => {
    const image = (panelValues: readonly number[]): Uint8Array => {
      const width = 40;
      const height = 12;
      const channels = 3;
      return Uint8Array.from({ length: width * height * channels }, (_, byteIndex) => {
        const pixel = Math.floor(byteIndex / channels);
        const column = pixel % width;
        return panelValues[Math.min(panelValues.length - 1, Math.floor(column / 10))]!;
      });
    };
    expect(studioImageHasVariationGridV2({ data: image([10, 230, 20, 240]), width: 40, height: 12, channels: 3 })).toBe(
      true
    );
    expect(studioImageHasVariationGridV2({ data: image([10, 10, 230, 230]), width: 40, height: 12, channels: 3 })).toBe(
      false
    );
  });

  it('detects repeated subject layouts on a continuous background only when repetition analysis is requested', () => {
    const width = 120;
    const height = 72;
    const channels = 3;
    const render = (repeatAcrossQuarters: boolean): Uint8Array => {
      const bytes = new Uint8Array(width * height * channels);
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const localColumn = repeatAcrossQuarters ? column % 30 : column;
          const subjectCenter = repeatAcrossQuarters ? 15 : 60;
          const body = row >= 24 && row <= 62 && Math.abs(localColumn - subjectCenter) <= 6;
          const head = (row - 16) ** 2 + (localColumn - subjectCenter) ** 2 <= 36;
          const value = body || head ? 32 : 172 + Math.floor(column / 24) + (row >= 50 ? 8 : 0);
          const offset = (row * width + column) * channels;
          bytes[offset] = value;
          bytes[offset + 1] = value;
          bytes[offset + 2] = value;
        }
      }
      return bytes;
    };
    const repeated = render(true);
    const single = render(false);

    expect(studioImageHasVariationGridV2({ data: repeated, width, height, channels })).toBe(true);
    expect(
      studioImageHasVariationGridV2({ data: repeated, width, height, channels, detectRepeatedSubjects: false })
    ).toBe(false);
    expect(studioImageHasVariationGridV2({ data: single, width, height, channels })).toBe(false);
  });

  it('rejects stale expected read proofs both before open and after content verification', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-read-proof-v2-'));
    created.push(rootDir);
    const filePath = path.join(rootDir, 'proof.png');
    await fs.writeFile(filePath, png);
    const stats = await fs.lstat(filePath);
    const proof = {
      dev: String(stats.dev),
      ino: String(stats.ino),
      byteSize: png.length,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      sha256: createHash('sha256').update(png).digest('hex'),
      mimeType: 'image/png',
      verifyContent: true,
    };

    await Promise.all(
      [
        { ...proof, dev: 'foreign' },
        { ...proof, ino: 'foreign' },
        { ...proof, byteSize: proof.byteSize + 1 },
        { ...proof, mtimeMs: proof.mtimeMs + 1 },
        { ...proof, ctimeMs: proof.ctimeMs + 1 },
      ].map(async (staleProof) => {
        await expect(
          openVerifiedReadStream(filePath, undefined, undefined, undefined, staleProof)
        ).rejects.toMatchObject({ code: 'storage_error' });
      })
    );
    await Promise.all(
      [
        { ...proof, sha256: 'f'.repeat(64) },
        { ...proof, mimeType: 'image/jpeg' },
      ].map(async (staleProof) => {
        await expect(
          openVerifiedReadStream(filePath, undefined, undefined, undefined, staleProof)
        ).rejects.toMatchObject({ code: 'storage_error' });
      })
    );

    const unverified = await openVerifiedReadStream(filePath, undefined, undefined, undefined, {
      ...proof,
      verifyContent: false,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of unverified) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);
    expect(unverified.closed).toBe(true);
    expect(unverified.emit('error', new Error('late close after end'))).toBe(true);

    const replacementPath = path.join(rootDir, 'replacement.png');
    await fs.writeFile(replacementPath, Buffer.concat([png, Buffer.from([0x01])]));
    await expect(
      openVerifiedReadStream(filePath, undefined, undefined, async () => {
        await fs.rename(replacementPath, filePath);
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('rejects invalid configured limits and unsafe filesystem capacity reports', async () => {
    const { store } = await makeStoreV2({ includeAuthorizedJob: false });
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(() => createStudioMediaStore({ store, limits: { referenceMaxBytes: limit } }), String(limit)).toThrow(
        expect.objectContaining({ code: 'storage_error' })
      );
    }

    const statfs = vi.spyOn(fs, 'statfs');
    try {
      statfs.mockResolvedValueOnce({ bavail: -1, bsize: 1 } as Awaited<ReturnType<typeof fs.statfs>>);
      await expect(getAvailableStudioDiskBytes('/volume')).rejects.toMatchObject({ code: 'storage_error' });
      statfs.mockResolvedValueOnce({
        bavail: Number.MAX_SAFE_INTEGER,
        bsize: 2,
      } as Awaited<ReturnType<typeof fs.statfs>>);
      await expect(getAvailableStudioDiskBytes('/volume')).resolves.toBe(Number.MAX_SAFE_INTEGER);
      statfs.mockRejectedValueOnce(new Error('private statfs failure'));
      await expect(getAvailableStudioDiskBytes('/volume')).rejects.toMatchObject({ code: 'storage_error' });
    } finally {
      statfs.mockRestore();
    }
  });

  it.each([
    ['not-found confirmation', ['supported', 'not_found']],
    ['unsupported confirmation', ['supported', 'unsupported_prototype_schema']],
    ['not-found final proof', ['supported', 'supported', 'not_found']],
    ['unsupported final proof', ['supported', 'supported', 'unsupported_prototype_schema']],
  ] as const)('fails closed when project classification changes at the %s', async (_label, statuses) => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'classification-race.png');
    await fs.writeFile(sourcePath, png);
    let index = 0;
    const wrappedStore = {
      ...store,
      getProjectV2: vi.fn(async () => {
        const status = statuses[Math.min(index, statuses.length - 1)]!;
        index += 1;
        if (status === 'supported') return { status, project: structuredClone(project) };
        return { status, projectId: project.id };
      }),
    } as CreativeStudioStore;
    const media = createStudioMediaStore({ store: wrappedStore, createId: () => 'classification_asset' });

    await expect(
      media.importSeedStillFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({
      code: statuses.at(-1) === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'not_found',
    });
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a vanished verified project directory before allocating managed storage', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'missing-authority.png');
    await fs.writeFile(sourcePath, png);
    const wrappedStore = {
      ...store,
      getVerifiedProjectDirectoryV2: vi.fn(async () => null),
    } as CreativeStudioStore;
    const media = createStudioMediaStore({ store: wrappedStore, createId: () => 'missing_authority_asset' });

    await expect(
      media.importSeedStillFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([Number.NaN, -1, 0, png.length - 1])(
    'refuses an unusable disk-capacity report of %s before consuming provider bytes',
    async (availableBytes) => {
      const { rootDir, store, project } = await makeStoreV2();
      let consumed = false;
      const media = createStudioMediaStore({
        store,
        createId: () => 'disk_refused_output',
        getAvailableDiskBytes: async () => availableBytes,
      });

      await expect(
        media.persistProviderOutputForJobV2({
          projectId: project.id,
          shotId: 'shot_1',
          jobId: 'job_1',
          mediaKind: 'image',
          declaredMimeType: 'image/png',
          declaredByteSize: png.length,
          body: (async function* () {
            consumed = true;
            yield png;
          })(),
        })
      ).rejects.toMatchObject({ code: 'storage_error' });

      expect(consumed).toBe(false);
      await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('stops an undeclared provider body at the exact disk ceiling and removes its staged bytes', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const media = createStudioMediaStore({
      store,
      createId: () => 'disk_bounded_output',
      getAvailableDiskBytes: async () => png.length - 1,
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
  });

  it('refuses provider bytes when durable assets have already consumed the project capacity', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeSeedAsset: true });
    let consumed = false;
    const media = createStudioMediaStore({ store, limits: { projectMaxBytes: png.length } });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(consumed).toBe(false);
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('counts retained export bytes in the final human-import admission and removes refused managed bytes', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'export-cap-reference.png');
    await fs.writeFile(sourcePath, png);
    const withManagedMediaAuthority = vi.fn(
      async <T>(
        authority: StudioProjectAuthoritySnapshotV2,
        operation: (facts: Readonly<{ catalogRevision: number; managedByteSize: number }>) => Promise<T>
      ): Promise<T> => {
        expect(authority.project.id).toBe(project.id);
        await authority.assertCurrent?.();
        return operation(Object.freeze({ catalogRevision: 2, managedByteSize: 1 }));
      }
    );
    const media = createStudioMediaStore({
      store,
      createId: () => 'export_cap_reference',
      limits: { projectMaxBytes: png.length },
      withManagedMediaAuthority,
    });

    await expect(
      media.importSeedStillFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(withManagedMediaAuthority).toHaveBeenCalledOnce();
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        revision: project.revision,
        assets: {},
        shots: { shot_1: { assetIds: [] } },
      },
    });
    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
    await expect(fs.readdir(path.join(rootDir, project.id, 'imports'))).resolves.toEqual([]);
  });

  it('counts retained export bytes in the final provider-output admission', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const withManagedMediaAuthority = vi.fn(
      async <T>(
        _authority: StudioProjectAuthoritySnapshotV2,
        operation: (facts: Readonly<{ catalogRevision: number; managedByteSize: number }>) => Promise<T>
      ): Promise<T> => operation(Object.freeze({ catalogRevision: 2, managedByteSize: 1 }))
    );
    const media = createStudioMediaStore({
      store,
      createId: () => 'export_cap_provider',
      limits: { projectMaxBytes: png.length },
      withManagedMediaAuthority,
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(withManagedMediaAuthority).toHaveBeenCalledOnce();
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        revision: project.revision,
        assets: {},
        jobs: { job_1: { status: 'running', outputAssetIds: [] } },
      },
    });
    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
    await expect(fs.readdir(path.join(rootDir, project.id, 'assets'))).resolves.toEqual([]);
  });

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
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: 'job_1',
      compositionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(asset).not.toHaveProperty('durationSeconds');
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            seedStillId: null,
            dismissedSeedStillIds: [],
            videoAssetId: null,
            supersededVideoAssetIds: [],
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

  it('commits a project-reference primary only as the exact candidate authority', async () => {
    const { store, project } = await makeStoreV2({ projectReferenceId: 'reference_character' });
    const media = createStudioMediaStore({ store, createId: () => 'reference_candidate_output' });

    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: null,
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });

    expect(asset).toMatchObject({
      id: 'reference_candidate_output',
      projectId: project.id,
      shotId: null,
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'reference_candidate_output.png' },
      projectReferenceId: 'reference_character',
      generationReferenceAssetIds: [],
      producerJobId: 'job_1',
      compositionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        references: {
          reference_character: {
            approvedAssetId: 'reference_candidate_output',
            supersededAssetIds: [],
          },
        },
        shots: {
          shot_1: {
            referenceBinding: {
              status: 'unassigned',
              characterReferenceIds: [],
              backgroundReferenceId: null,
            },
            seedStillId: null,
            dismissedSeedStillIds: [],
            boardAssetId: null,
            assetIds: [],
          },
        },
        jobs: {
          job_1: {
            status: 'succeeded',
            target: { kind: 'reference', referenceId: 'reference_character' },
            outputAssetIdsByRole: { primary: 'reference_candidate_output', poster: null },
          },
        },
      },
    });
  });

  it.each([
    { label: 'first frame', options: {}, detectRepeatedSubjects: false },
    {
      label: 'project reference',
      options: { projectReferenceId: 'reference_character' },
      detectRepeatedSubjects: true,
    },
    {
      label: 'background reference',
      options: { projectReferenceId: 'reference_background', projectReferenceKind: 'background' as const },
      detectRepeatedSubjects: false,
    },
  ])(
    'rejects a detected variation grid before it becomes the current $label',
    async ({ options, detectRepeatedSubjects }) => {
      const { rootDir, store, project } = await makeStoreV2(options);
      const detectImageVariationGridV2 = vi.fn(async () => true);
      const media = createStudioMediaStore({
        store,
        createId: () => 'refused_grid_output',
        detectImageVariationGridV2,
      });

      await expect(
        media.persistProviderOutputForJobV2({
          projectId: project.id,
          shotId: 'projectReferenceId' in options ? null : 'shot_1',
          jobId: 'job_1',
          mediaKind: 'image',
          declaredMimeType: 'image/png',
          declaredByteSize: png.length,
          body: Readable.from([png]),
        })
      ).rejects.toMatchObject({ code: 'seed_still_variation_grid' });

      expect(detectImageVariationGridV2).toHaveBeenCalledExactlyOnceWith({
        filePath: expect.stringMatching(/[/\\]assets[/\\]refused_grid_output\.png$/),
        detectRepeatedSubjects,
      });
      const loaded = await store.getProjectV2(project.id);
      if (loaded.status !== 'supported') throw new Error('Grid-refusal project disappeared');
      expect(loaded.project.assets).not.toHaveProperty('refused_grid_output');
      expect(loaded.project.jobs.job_1).toMatchObject({ status: 'running', outputAssetIds: [] });
      if ('projectReferenceId' in options) {
        expect(loaded.project.references[options.projectReferenceId]!.approvedAssetId).toBeNull();
      } else {
        expect(loaded.project.shots.shot_1!.seedStillId).toBeNull();
      }
      await expect(fs.readdir(path.join(rootDir, project.id, 'assets'))).resolves.toEqual([]);
    }
  );

  it('commits an exact live project-reference candidate after an unrelated Shot changes', async () => {
    const { store, project } = await makeStoreV2({ projectReferenceId: 'reference_character' });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.shootingScript = 'An unrelated revised Shooting script.';
      return current;
    });
    const media = createStudioMediaStore({ store, createId: () => 'detached_reference_candidate_output' });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: null,
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      })
    ).resolves.toMatchObject({
      id: 'detached_reference_candidate_output',
      shotId: null,
      projectReferenceId: 'reference_character',
      generationReferenceAssetIds: [],
    });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        references: {
          reference_character: {
            approvedAssetId: 'detached_reference_candidate_output',
          },
        },
        shots: {
          shot_1: {
            shootingScript: 'An unrelated revised Shooting script.',
            assetIds: [],
          },
        },
        jobs: {
          job_1: {
            status: 'succeeded',
            target: { kind: 'reference', referenceId: 'reference_character' },
          },
        },
      },
    });
  });

  it('refuses and cleans a project-reference output when its generation job becomes terminal before commit', async () => {
    const { rootDir, store, project } = await makeStoreV2({ projectReferenceId: 'reference_character' });
    const staleAuthorityStore = {
      ...store,
      withProjectAuthorityV2: <T>(
        projectId: string,
        operation: (snapshot: StudioProjectAuthoritySnapshotV2) => Promise<T>
      ): Promise<T> =>
        store.withProjectAuthorityV2(projectId, (snapshot) =>
          operation({
            ...snapshot,
            commit: (update, expectedRevision, commitTag, authorizeBeforeReplace) =>
              snapshot.commit(
                (current) => {
                  current.jobs.job_1!.status = 'failed';
                  current.jobs.job_1!.error = {
                    code: 'no_output',
                    messageKey: 'conversation.creativeStudio.jobs.errors.noOutput',
                  };
                  return update(current);
                },
                expectedRevision,
                commitTag,
                authorizeBeforeReplace
              ),
          })
        ),
    } as CreativeStudioStore;
    const media = createStudioMediaStore({
      store: staleAuthorityStore,
      createId: () => 'stale_reference_candidate_output',
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: null,
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });

    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        assets: {},
        references: {
          reference_character: { approvedAssetId: null },
        },
        jobs: { job_1: { status: 'running', outputAssetIds: [] } },
      },
    });
    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
    await expect(fs.readdir(path.join(rootDir, project.id, 'assets'))).resolves.toEqual([]);
  });

  it('publishes a Board primary to its isolated collection and selects it atomically', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const media = createStudioMediaStore({ store, createId: () => 'board_output_1' });

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
      id: 'board_output_1',
      mediaKind: 'image',
      managedAsset: { collection: 'boardStills', fileName: 'board_output_1.png' },
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: 'job_1',
      compositionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(fs.readFile(path.join(rootDir, project.id, 'boardStills', 'board_output_1.png'))).resolves.toEqual(
      png
    );
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            seedStillId: null,
            dismissedSeedStillIds: [],
            boardAssetId: 'board_output_1',
            supersededBoardAssetIds: [],
            videoAssetId: null,
            assetIds: ['board_output_1'],
          },
        },
        jobs: {
          job_1: {
            status: 'succeeded',
            outputAssetIds: ['board_output_1'],
            outputAssetIdsByRole: { primary: 'board_output_1', poster: null },
          },
        },
      },
    });
  });

  it('persists concurrent paid outputs under fresh same-project authority without retrying provider work', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still', addSecondShot: true });
    await store.updateProjectV2(project.id, (current) => {
      const firstJob = current.jobs.job_1;
      const secondShot = current.shots.shot_2;
      const secondBeat = current.beats.beat_2;
      if (firstJob === undefined || secondShot === undefined || secondBeat === undefined) {
        throw new Error('Concurrent Board fixture was incomplete');
      }
      secondShot.referenceBinding.status = 'ready';
      const target = { kind: 'shot' as const, shotId: secondShot.id };
      const composition = composeStudioGenerationV2({
        projectRevision: current.revision,
        brief: current.brief,
        rules: current.rules,
        source: {
          kind: 'shot',
          beatId: secondBeat.id,
          story: secondBeat.story,
          shotId: secondShot.id,
          shootingScript: secondShot.shootingScript,
        },
        purpose: 'board_still',
        referenceInputs: [],
        aspectRatio: current.aspectRatio,
        resolution: current.resolution,
        route: firstJob.provider,
        boardStyle: current.boardStyle,
        instructionProfile: deriveStudioInstructionProfileV2(firstJob.provider, 'board_still', {
          kind: 'shot',
          beatId: secondBeat.id,
          story: secondBeat.story,
          shotId: secondShot.id,
          shootingScript: secondShot.shootingScript,
        }),
      });
      const requestPlan: Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> = {
        kind: 'resolved',
        snapshot: {
          composition,
          aspectRatio: current.aspectRatio,
          resolution: current.resolution,
          durationSeconds: 4,
          referenceInputs: [],
          conditioningInput: null,
        },
      };
      const item: StudioQuotedGeneration = {
        id: createStudioQuotedGenerationId({
          projectId: current.id,
          projectRevision: current.revision,
          target,
          purpose: 'board_still',
        }),
        target,
        purpose: 'board_still',
        routeId: 'route_image',
        generationCount: 1,
        requestPlan,
        rateUnit: 'generation',
        rateMinorUnits: 3,
      };
      const authorization: StudioSpendAuthorization = {
        id: 'authorization_concurrent',
        projectId: current.id,
        projectRevision: current.revision,
        originReferenceHandoffId: null,
        rateCardDigest: 'd'.repeat(64),
        currency: 'USD',
        baseItems: [item],
        cascadeItems: [],
        lowerMinorUnits: 3,
        upperMinorUnits: 3,
        expiresAt: '2026-08-17T12:05:00.000Z',
        confirmedAt: '2026-08-17T12:00:02.000Z',
        providerBindings: [{ itemId: item.id, provider: firstJob.provider }],
        idempotencyKeys: [{ itemId: item.id, key: 'key_concurrent' }],
      };
      const job: StudioJobV2 = {
        id: 'job_concurrent',
        projectId: current.id,
        target,
        status: 'running',
        provider: firstJob.provider,
        idempotencyKey: 'key_concurrent',
        providerJobId: null,
        cancellationPolicy: 'none',
        outputAssetIds: [],
        purpose: 'board_still',
        authorizationId: authorization.id,
        authorizationItemId: item.id,
        composition,
        requestPlan,
        requestSnapshot: requestPlan.snapshot,
        spendReceipt: createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: 'job_concurrent' }),
        outputAssetIdsByRole: { primary: null, poster: null },
        error: null,
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: current.updatedAt,
        updatedAt: current.updatedAt,
      };
      current.spendAuthorizations.push(authorization);
      current.jobs[job.id] = job;
      secondShot.jobIds.push(job.id);
      return current;
    });
    const unlockedGetProjectV2 = vi.fn(async () => {
      throw new Error('Provider output preparation must use queued project authority');
    });
    const unlockedGetVerifiedProjectDirectoryV2 = vi.fn(async () => {
      throw new Error('Provider output preparation must use queued project authority');
    });
    const providerOutputStore = {
      ...store,
      getProjectV2: unlockedGetProjectV2,
      getVerifiedProjectDirectoryV2: unlockedGetVerifiedProjectDirectoryV2,
    } as CreativeStudioStore;
    const exportCatalogStore = createStudioExportCatalogStoreV2();
    const media = createStudioMediaStore({
      store: providerOutputStore,
      withManagedMediaAuthority: exportCatalogStore.withManagedMediaAuthority.bind(exportCatalogStore),
      createId: idSequence('board_output_concurrent_1', 'board_output_concurrent_2'),
    });
    let markSlowWriteStarted!: () => void;
    let releaseSlowWrite!: () => void;
    const slowWriteStarted = new Promise<void>((resolve) => {
      markSlowWriteStarted = resolve;
    });
    const slowWriteRelease = new Promise<void>((resolve) => {
      releaseSlowWrite = resolve;
    });
    const firstPromise = media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: (async function* () {
        markSlowWriteStarted();
        await slowWriteRelease;
        yield png;
      })(),
    });
    await slowWriteStarted;
    const secondPromise = media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_2',
      jobId: 'job_concurrent',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });
    const [second, first] = await Promise.all([secondPromise.finally(() => releaseSlowWrite()), firstPromise]);

    expect(new Set([first.id, second.id])).toEqual(new Set(['board_output_concurrent_1', 'board_output_concurrent_2']));
    const loaded = await store.getProjectV2(project.id);
    if (loaded.status !== 'supported') throw new Error('Concurrent Board result was unavailable');
    expect(loaded.project.assets[first.id]?.producerJobId).toBe('job_1');
    expect(loaded.project.assets[second.id]?.producerJobId).toBe('job_concurrent');
    expect(loaded.project.shots.shot_1).toMatchObject({
      boardAssetId: first.id,
      supersededBoardAssetIds: [],
      assetIds: [first.id],
    });
    expect(loaded.project.shots.shot_2).toMatchObject({
      boardAssetId: second.id,
      supersededBoardAssetIds: [],
      assetIds: [second.id],
    });
    expect(loaded.project.jobs.job_1).toMatchObject({
      status: 'succeeded',
      outputAssetIdsByRole: { primary: first.id },
    });
    expect(loaded.project.jobs.job_concurrent).toMatchObject({
      status: 'succeeded',
      outputAssetIdsByRole: { primary: second.id },
    });
    expect(unlockedGetProjectV2).not.toHaveBeenCalled();
    expect(unlockedGetVerifiedProjectDirectoryV2).not.toHaveBeenCalled();
    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
  });

  it.each([8 * 1024 + 1, 20 * 1024])(
    'persists a valid %i-character Shooting script in the frozen Board composition',
    async (scriptLength) => {
      const shootingScript = 'p'.repeat(scriptLength);
      const { store, project } = await makeStoreV2({ purpose: 'board_still', prompt: shootingScript });
      const media = createStudioMediaStore({ store, createId: () => 'board_output_long_prompt' });

      const asset = await media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      });
      const loaded = await store.getProjectV2(project.id);

      expect(asset).not.toHaveProperty('sourceLook');
      expect(loaded).toMatchObject({
        status: 'supported',
        project: {
          assets: { board_output_long_prompt: { id: 'board_output_long_prompt' } },
          jobs: {
            job_1: {
              status: 'succeeded',
              requestSnapshot: {
                composition: {
                  inputs: { source: { kind: 'shot', shootingScript } },
                  prompt: expect.stringContaining(shootingScript),
                },
              },
              outputAssetIdsByRole: { primary: 'board_output_long_prompt', poster: null },
            },
          },
        },
      });
    }
  );

  it('keeps the current Board panel when redraw capacity cannot hold both immutable outputs', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'board_still' });
    const firstMedia = createStudioMediaStore({ store, createId: () => 'board_output_1' });
    await firstMedia.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    await addBoardRedrawJob(store, project.id);
    let consumed = false;
    const boundedMedia = createStudioMediaStore({
      store,
      createId: () => 'board_output_refused',
      limits: { projectMaxBytes: png.length * 2 - 1 },
    });

    await expect(
      boundedMedia.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_redraw',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(consumed).toBe(false);
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        shots: { shot_1: { boardAssetId: 'board_output_1', supersededBoardAssetIds: [] } },
        jobs: { job_redraw: { status: 'running', outputAssetIds: [] } },
      },
    });
  });

  it('swaps a successful redraw while retaining the prior panel, bytes, and paid lineage', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('board_output_1', 'board_output_2'),
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    await addBoardRedrawJob(store, project.id);

    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_redraw',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            boardAssetId: 'board_output_2',
            supersededBoardAssetIds: ['board_output_1'],
            assetIds: ['board_output_1', 'board_output_2'],
          },
        },
        assets: {
          board_output_1: { managedAsset: { collection: 'boardStills' } },
          board_output_2: { managedAsset: { collection: 'boardStills' } },
        },
        jobs: {
          job_1: { status: 'succeeded', outputAssetIds: ['board_output_1'] },
          job_redraw: { status: 'succeeded', outputAssetIds: ['board_output_2'] },
        },
      },
    });
    await expect(fs.readFile(path.join(rootDir, project.id, 'boardStills', 'board_output_1.png'))).resolves.toEqual(
      png
    );
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
    const committed = await store.getProjectV2(project.id);
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    expect(committed).toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            videoAssetId: 'take_1',
            supersededVideoAssetIds: [],
          },
        },
        frameExtractions: {
          [extractionId]: {
            id: extractionId,
            shotId: 'shot_1',
            videoAssetId: 'take_1',
            endpointSeconds: 10,
            frameAssetId: null,
            status: 'pending',
            errorCode: null,
            attemptCount: 0,
          },
        },
      },
    });
    expect(
      committed.status === 'supported' ? Object.hasOwn(committed.project.shots.shot_1!, 'selectedTakeId') : true
    ).toBe(false);
    const edited = await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.durationSeconds = 8;
      return current;
    });
    expect(edited.assets.take_1!.durationSeconds).toBe(10);
    const restarted = await store.getProjectV2(project.id);
    expect(restarted.status === 'supported' ? restarted.project.assets.take_1!.durationSeconds : null).toBe(10);
  });

  it('analyzes only verified managed video bytes through the injected seam and fails closed', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const probeVideoAudioContentV2 = vi
      .fn()
      .mockImplementationOnce(async ({ openVerifiedStream }: { openVerifiedStream: () => Promise<Readable> }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of await openVerifiedStream()) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks)).toEqual(mp4);
        return { status: 'audible' as const, meanVolumeDbfs: -22, peakVolumeDbfs: -4 };
      })
      .mockRejectedValueOnce(new Error('probe unavailable'));
    const media = createStudioMediaStore({
      store,
      createId: () => 'take_audio_analysis',
      probeVideoDurationSecondsV2: async () => 10,
      probeVideoAudioContentV2,
    });
    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    await expect(media.analyzeVideoAudioV2(project.id, asset.id)).resolves.toEqual({
      status: 'audible',
      meanVolumeDbfs: -22,
      peakVolumeDbfs: -4,
    });
    await expect(media.analyzeVideoAudioV2(project.id, asset.id)).resolves.toEqual({
      status: 'unavailable',
      meanVolumeDbfs: null,
      peakVolumeDbfs: null,
    });
    await expect(media.analyzeVideoAudioV2(project.id, 'missing_asset')).resolves.toEqual({
      status: 'unavailable',
      meanVolumeDbfs: null,
      peakVolumeDbfs: null,
    });
    expect(probeVideoAudioContentV2).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest successful video job current when an older download finishes last', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    await addVideoRedrawJob(store, project.id, { interruptFirstDownload: true });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('video_newer', 'video_older'),
      probeVideoDurationSecondsV2: async () => 10,
    });

    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_video_redraw',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.trimInSeconds = 2;
      current.shots.shot_1!.trimOutSeconds = 1;
      return current;
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status).toBe('supported');
    if (loaded.status !== 'supported') throw new Error('Expected supported project');
    const shot = loaded.project.shots.shot_1!;
    expect(shot.jobIds).toEqual(['job_1', 'job_video_redraw']);
    expect(shot.videoAssetId).toBe('video_newer');
    expect(shot.supersededVideoAssetIds).toEqual(['video_older']);
    expect(shot.trimInSeconds).toBe(2);
    expect(shot.trimOutSeconds).toBe(1);
    expect(shot.assetIds).toEqual(expect.arrayContaining(['video_newer', 'video_older']));
    expect(loaded.project.jobs.job_1).toMatchObject({
      status: 'succeeded',
      outputAssetIds: ['video_older'],
      outputAssetIdsByRole: { primary: 'video_older' },
      spendReceipt: expect.objectContaining({ jobId: 'job_1' }),
    });
    expect(loaded.project.jobs.job_video_redraw).toMatchObject({
      status: 'succeeded',
      outputAssetIds: ['video_newer'],
      outputAssetIdsByRole: { primary: 'video_newer' },
      spendReceipt: expect.objectContaining({ jobId: 'job_video_redraw' }),
    });
    expect(loaded.project.assets.video_older).toMatchObject({
      producerJobId: 'job_1',
      compositionDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(loaded.project.assets.video_newer).toMatchObject({
      producerJobId: 'job_video_redraw',
      compositionDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    const videoAssetIds = ['video_older', 'video_newer'];
    for (const videoAssetId of videoAssetIds) {
      const extractionId = createStudioFrameExtractionId({
        shotId: 'shot_1',
        videoAssetId,
        endpointSeconds: 10,
      });
      expect(loaded.project.frameExtractions[extractionId]).toMatchObject({
        videoAssetId,
        endpointSeconds: 10,
        status: 'pending',
      });
    }
    await Promise.all(
      videoAssetIds.map((videoAssetId) =>
        expect(fs.readFile(path.join(rootDir, project.id, 'assets', `${videoAssetId}.mp4`))).resolves.toEqual(mp4)
      )
    );
  });

  it('clears asset-specific trims when a replacement video becomes current', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('video_first', 'video_replacement'),
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
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.trimInSeconds = 2;
      current.shots.shot_1!.trimOutSeconds = 1;
      return current;
    });
    await addVideoRedrawJob(store, project.id);

    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_video_redraw',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            videoAssetId: 'video_replacement',
            supersededVideoAssetIds: ['video_first'],
            trimInSeconds: null,
            trimOutSeconds: null,
          },
        },
        frameExtractions: {
          [createStudioFrameExtractionId({
            shotId: 'shot_1',
            videoAssetId: 'video_replacement',
            endpointSeconds: 10,
          })]: {
            videoAssetId: 'video_replacement',
            endpointSeconds: 10,
            status: 'pending',
          },
        },
      },
    });
  });

  it('hands a verified video to production ffprobe through a seekable inherited descriptor', async () => {
    const valid = await makeStoreV2({ purpose: 'video_take' });
    const validMedia = createStudioMediaStore({ store: valid.store, createId: () => 'decoded_video' });
    await expect(
      validMedia.persistProviderOutputForJobV2({
        projectId: valid.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([decodedMp4]),
      })
    ).resolves.toMatchObject({ id: 'decoded_video', durationSeconds: 10 });

    expect(spawnCalls).toEqual([
      {
        command: expect.any(String),
        args: [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          '-fd',
          '3',
          'fd:',
        ],
        options: {
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'ignore', expect.any(Number)],
          windowsHide: true,
        },
      },
    ]);
  });

  it('uses the production ffprobe path to reject and clean an undecodable video output', async () => {
    const invalid = await makeStoreV2({ purpose: 'video_take' });
    const invalidMedia = createStudioMediaStore({ store: invalid.store, createId: () => 'undecodable_video' });
    await expect(
      invalidMedia.persistProviderOutputForJobV2({
        projectId: invalid.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      fs.access(path.join(invalid.rootDir, invalid.project.id, 'assets', 'undecodable_video.mp4'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
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
    const imageAsVideoFixture = await makeStoreV2();
    const imageDurationFixture = await makeStoreV2();
    const videoFixture = await makeStoreV2({ purpose: 'video_take' });
    const imageAsVideoMedia = createStudioMediaStore({ store: imageAsVideoFixture.store });
    const imageDurationMedia = createStudioMediaStore({ store: imageDurationFixture.store });
    const videoMedia = createStudioMediaStore({ store: videoFixture.store });
    let consumed = 0;
    const body = async function* (): AsyncGenerator<Buffer> {
      consumed += 1;
      yield png;
    };

    await expect(
      imageAsVideoMedia.persistProviderOutputForJobV2({
        projectId: imageAsVideoFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: body(),
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });
    await expect(
      imageDurationMedia.persistProviderOutputForJobV2({
        projectId: imageDurationFixture.project.id,
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
    ).rejects.toMatchObject({ code: 'job_inactive' });
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
        shots: { shot_1: { videoAssetId: 'take_1', supersededVideoAssetIds: [] } },
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

  it('persists a renderer-captured V2 poster for the atomically assigned current picture', async () => {
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
    const poster = await media.persistCapturedPosterV2(capturedInput);
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
        shots: { shot_1: { videoAssetId: 'take_captured', supersededVideoAssetIds: [] } },
      },
    });
  });

  it('imports a human seed candidate without pinning, selecting, authorizing, or spending', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'human-seed.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'human_seed_1' });

    const imported = await media.importSeedStillFromPathV2({
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
          dismissedSeedStillIds: [],
          videoAssetId: null,
          supersededVideoAssetIds: [],
          jobIds: [],
        },
      },
    });
  });

  it('imports a human reference as the exact current canonical image while preserving history and bindings', async () => {
    const referenceId = 'reference_character';
    const { rootDir, store, project } = await makeStoreV2({
      projectReferenceId: referenceId,
      includeAuthorizedJob: false,
    });
    const importsDirectory = path.join(rootDir, project.id, 'imports');
    await fs.mkdir(importsDirectory, { recursive: true });
    await fs.writeFile(path.join(importsDirectory, 'reference_existing.png'), png);
    const existingHash = createHash('sha256').update(png).digest('hex');
    const prepared = await store.updateProjectV2(project.id, (current) => {
      current.assets.reference_existing = {
        id: 'reference_existing',
        projectId: current.id,
        shotId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'reference_existing.png' },
        byteSize: png.length,
        sha256: existingHash,
        projectReferenceId: referenceId,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
        createdAt: '2026-08-17T12:00:02.000Z',
      };
      current.references[referenceId]!.approvedAssetId = 'reference_existing';
      current.references[referenceId]!.updatedAt = '2026-08-17T12:00:02.000Z';
      current.shots.shot_1!.referenceBinding = {
        status: 'ready',
        characterReferenceIds: [referenceId],
        backgroundReferenceId: null,
      };
      return current;
    });
    const bindingsBefore = structuredClone(prepared.shots.shot_1!.referenceBinding);
    const existingBefore = structuredClone(prepared.assets.reference_existing);
    const sourceBytes = Buffer.concat([png, Buffer.from([0x01])]);
    const sourcePath = path.join(rootDir, 'ming-import.png');
    await fs.writeFile(sourcePath, sourceBytes);
    const media = createStudioMediaStore({
      store,
      createId: () => 'reference_imported',
      now: () => '2026-08-17T12:00:03.000Z',
    });

    const imported = await media.importReferenceImageFromPathV2({
      projectId: project.id,
      referenceId,
      sourcePath,
      expectedRevision: prepared.revision,
      returnProject: true,
    });

    expect(imported.asset).toEqual({
      id: 'reference_imported',
      projectId: project.id,
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'reference_imported.png' },
      byteSize: sourceBytes.length,
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
      projectReferenceId: referenceId,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
      createdAt: '2026-08-17T12:00:03.000Z',
    });
    expect(imported.project.references[referenceId]).toMatchObject({
      approvedAssetId: 'reference_imported',
      supersededAssetIds: ['reference_existing'],
      jobIds: [],
      updatedAt: '2026-08-17T12:00:03.000Z',
    });
    expect(imported.project.assets.reference_existing).toEqual(existingBefore);
    expect(imported.project.shots.shot_1!.referenceBinding).toEqual(bindingsBefore);
    expect(imported.project.jobs).toEqual(prepared.jobs);
    expect(imported.project.spendAuthorizations).toEqual(prepared.spendAuthorizations);
    expect(JSON.stringify(imported.project)).not.toContain(sourcePath);
    await expect(fs.readFile(path.join(importsDirectory, 'reference_imported.png'))).resolves.toEqual(sourceBytes);
  });

  it('refuses stale, unknown-reference, and invalid reference imports without retaining media', async () => {
    await Promise.all(
      (['stale', 'unknown', 'invalid_media'] as const).map(async (kind) => {
        const referenceId = 'reference_character';
        const { rootDir, store, project } = await makeStoreV2({
          projectReferenceId: referenceId,
          includeAuthorizedJob: false,
        });
        const sourcePath = path.join(rootDir, `${kind}.png`);
        await fs.writeFile(sourcePath, kind === 'invalid_media' ? Buffer.from('not an image') : png);
        const assetId = `reference_${kind}`;
        const media = createStudioMediaStore({ store, createId: () => assetId });

        await expect(
          media.importReferenceImageFromPathV2({
            projectId: project.id,
            referenceId: kind === 'unknown' ? 'reference_unknown' : referenceId,
            sourcePath,
            expectedRevision: kind === 'stale' ? project.revision - 1 : project.revision,
          })
        ).rejects.toMatchObject({
          code: kind === 'stale' ? 'stale_project' : kind === 'unknown' ? 'not_found' : 'invalid_media',
        });
        const loaded = await store.getProjectV2(project.id);
        expect(loaded.status).toBe('supported');
        expect(loaded.status === 'supported' ? loaded.project.assets[assetId] : undefined).toBeUndefined();
        await expect(fs.access(path.join(rootDir, project.id, 'imports', `${assetId}.png`))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      })
    );
  });

  it('rechecks active reference generation at final import commit and removes staged bytes', async () => {
    const referenceId = 'reference_character';
    const { rootDir, store, project } = await makeStoreV2({ projectReferenceId: referenceId });
    const sourcePath = path.join(rootDir, 'concurrent-reference-import.png');
    await fs.writeFile(sourcePath, png);
    const initiallyIdle = structuredClone(project);
    initiallyIdle.jobs.job_1!.status = 'cancelled';
    initiallyIdle.jobs.job_1!.error = null;
    const racingStore = {
      ...store,
      getProjectV2: vi.fn(async () => ({ status: 'supported' as const, project: structuredClone(initiallyIdle) })),
    } as CreativeStudioStore;
    const media = createStudioMediaStore({ store: racingStore, createId: () => 'reference_race_import' });

    await expect(
      media.importReferenceImageFromPathV2({
        projectId: project.id,
        referenceId,
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'busy' });

    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toEqual({ status: 'supported', project });
    expect(await fs.readdir(path.join(rootDir, project.id, 'parts')).catch(() => [])).toEqual([]);
    expect(await fs.readdir(path.join(rootDir, project.id, 'imports')).catch(() => [])).toEqual([]);
  });

  it('refuses a managed-file replacement at the final project commit authorization', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'final-authorization-seed.png');
    const replacementPath = path.join(rootDir, 'foreign-replacement.png');
    const replacementBytes = Buffer.concat([png, Buffer.from([0xff])]);
    await Promise.all([fs.writeFile(sourcePath, png), fs.writeFile(replacementPath, replacementBytes)]);
    const managedPath = path.join(rootDir, project.id, 'imports', 'final_authorization_seed.png');
    const guardedStore = wrapFinalProjectCommitAuthorization(store, async () => {
      await fs.rename(replacementPath, managedPath);
    });
    const media = createStudioMediaStore({
      store: guardedStore,
      createId: () => 'final_authorization_seed',
    });

    await expect(
      media.importSeedStillFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
    await expect(fs.readFile(managedPath)).resolves.toEqual(replacementBytes);
    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
  });

  it('imports one verified WAV bed and records exactly one undoable set-bed revision', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'score.wav');
    await fs.writeFile(sourcePath, wav);
    const probeBedAudioV2 = vi.fn(async () => ({
      durationSeconds: 1,
      audioStreamCount: 1,
      otherStreamCount: 0,
    }));
    const media = createStudioMediaStore({
      store,
      createId: () => 'bed_audio_1',
      createMutationId: () => 'bed_import_mutation_1',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2,
    });

    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });

    expect(imported.asset).toEqual({
      id: 'bed_audio_1',
      projectId: project.id,
      shotId: null,
      mediaKind: 'audio',
      mimeType: 'audio/wav',
      managedAsset: { collection: 'imports', fileName: 'bed_audio_1.wav' },
      byteSize: wav.length,
      sha256: createHash('sha256').update(wav).digest('hex'),
      durationSeconds: 1,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
      createdAt: '2026-08-17T12:05:00.000Z',
    });
    expect(imported.project).toMatchObject({
      revision: project.revision + 1,
      bedAssetId: 'bed_audio_1',
      undoHistory: [
        {
          id: 'bed_import_mutation_1',
          sourceRevision: project.revision + 1,
          label: 'set_bed',
          patches: [{ kind: 'project_fields', before: { bedAssetId: null } }],
        },
      ],
    });
    expect(probeBedAudioV2).toHaveBeenCalledWith({
      filePath: expect.stringMatching(/\/project_v2\/parts\/bed_audio_1\.part$/),
      byteSize: wav.length,
      sha256: createHash('sha256').update(wav).digest('hex'),
    });

    const resolved = await media.resolveAssetV2(project.id, imported.asset.id);
    const chunks: Buffer[] = [];
    if (resolved === null) throw new Error('Imported WAV did not resolve');
    for await (const chunk of await resolved.openVerifiedStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(wav);

    const undone = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: imported.project.revision,
        operations: [{ kind: 'undo_last', entryId: 'bed_import_mutation_1' }],
      },
      { mutationId: 'undo_bed_import_1', capturedAt: '2026-08-17T12:06:00.000Z' }
    );
    expect(undone.project.bedAssetId).toBeNull();
    expect(undone.project.assets).toHaveProperty('bed_audio_1');
    await expect(fs.readFile(path.join(rootDir, project.id, 'imports', 'bed_audio_1.wav'))).resolves.toEqual(wav);
  });

  it('makes both bed publication directory entries durable before committing the project', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'durable-score.wav');
    await fs.writeFile(sourcePath, wav);
    const projectDirectory = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDirectory === null) throw new Error('Missing durable bed project directory');
    const importsDirectory = path.join(projectDirectory, 'imports');
    const partsDirectory = path.join(projectDirectory, 'parts');
    const partPath = path.join(projectDirectory, 'parts', 'durable_bed.part');
    const events: string[] = [];
    const observedStore: CreativeStudioStore = {
      ...store,
      withProjectAuthorityV2: <T>(
        projectId: string,
        operation: (snapshot: StudioProjectAuthoritySnapshotV2) => Promise<T>
      ): Promise<T> =>
        store.withProjectAuthorityV2(projectId, (snapshot) =>
          operation({
            ...snapshot,
            commit: (update, expectedRevision, commitTag, authorizeBeforeReplace) => {
              events.push('project_commit');
              return snapshot.commit(update, expectedRevision, commitTag, authorizeBeforeReplace);
            },
          })
        ),
    };
    const media = createStudioMediaStore({
      store: observedStore,
      createId: () => 'durable_bed',
      createMutationId: () => 'durable_bed_mutation',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
      afterV2ManagedDirectorySync: async (directory) => {
        if (directory === importsDirectory) events.push('imports_synced');
        if (directory === partsDirectory) {
          const partExists = await fs.access(partPath).then(
            () => true,
            () => false
          );
          if (!partExists) events.push('parts_synced_after_unlink');
        }
      },
    });

    await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });

    expect(events.slice(0, 3)).toEqual(['imports_synced', 'parts_synced_after_unlink', 'project_commit']);
  });

  it.each(['imports', 'parts'] as const)(
    'refuses and rolls back a bed import when the %s publication directory cannot be synced',
    async (failingDirectory) => {
      const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
      const sourcePath = path.join(rootDir, `${failingDirectory}-sync-score.wav`);
      await fs.writeFile(sourcePath, wav);
      const projectDirectory = await store.getVerifiedProjectDirectoryV2(project.id);
      if (projectDirectory === null) throw new Error('Missing sync-failure bed project directory');
      const importsDirectory = path.join(projectDirectory, 'imports');
      const partsDirectory = path.join(projectDirectory, 'parts');
      const partPath = path.join(projectDirectory, 'parts', `bed_${failingDirectory}_sync.part`);
      let importsSynced = false;
      let injected = false;
      const media = createStudioMediaStore({
        store,
        createId: () => `bed_${failingDirectory}_sync`,
        createMutationId: () => `bed_${failingDirectory}_sync_mutation`,
        now: () => '2026-08-17T12:05:00.000Z',
        probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
        afterV2ManagedDirectorySync: async (directory) => {
          if (directory === importsDirectory) importsSynced = true;
          const partExists = await fs.access(partPath).then(
            () => true,
            () => false
          );
          const shouldFail =
            !injected &&
            (failingDirectory === 'imports'
              ? directory === importsDirectory
              : directory === partsDirectory && importsSynced && !partExists);
          if (!shouldFail) return;
          injected = true;
          throw Object.assign(new Error(`injected ${failingDirectory} directory sync failure`), { code: 'EIO' });
        },
      });

      await expect(
        media.importBedAudioFromPathV2({
          projectId: project.id,
          sourcePath,
          expectedRevision: project.revision,
        })
      ).rejects.toMatchObject({ code: 'storage_error' });

      expect(injected).toBe(true);
      await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
      await expect(fs.readdir(path.join(projectDirectory, 'imports'))).resolves.toEqual([]);
      await expect(fs.readdir(path.join(projectDirectory, 'parts'))).resolves.toEqual([]);
    }
  );

  it('hands verified WAV metadata to production ffprobe through a seekable inherited descriptor', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const validPath = path.join(rootDir, 'decoded-score.wav');
    await fs.writeFile(validPath, wav);
    const media = createStudioMediaStore({
      store,
      createId: () => 'decoded_bed',
      createMutationId: () => 'decoded_bed_mutation',
      now: () => '2026-08-17T12:05:00.000Z',
      ffprobeBinary: process.env.FFPROBE_PATH ?? 'ffprobe',
      ffmpegBinary: process.env.FFMPEG_PATH ?? 'ffmpeg',
    });

    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath: validPath,
      expectedRevision: project.revision,
    });
    expect(imported.asset).toMatchObject({
      id: 'decoded_bed',
      mimeType: 'audio/wav',
      durationSeconds: 1,
    });

    expect(spawnCalls[0]).toEqual({
      command: process.env.FFPROBE_PATH ?? 'ffprobe',
      args: [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,duration:format=duration',
        '-of',
        'json',
        '-fd',
        '3',
        'fd:',
      ],
      options: {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore', expect.any(Number)],
        windowsHide: true,
      },
    });
  });

  it('hands a verified WAV decode to production ffmpeg through a seekable inherited descriptor', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const validPath = path.join(rootDir, 'decoded-score.wav');
    await fs.writeFile(validPath, wav);
    const media = createStudioMediaStore({
      store,
      createId: () => 'decoded_bed',
      createMutationId: () => 'decoded_bed_mutation',
      now: () => '2026-08-17T12:05:00.000Z',
      ffprobeBinary: process.env.FFPROBE_PATH ?? 'ffprobe',
      ffmpegBinary: process.env.FFMPEG_PATH ?? 'ffmpeg',
    });

    await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath: validPath,
      expectedRevision: project.revision,
    });

    expect(spawnCalls[1]).toEqual({
      command: process.env.FFMPEG_PATH ?? 'ffmpeg',
      args: [
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-fd',
        '3',
        '-i',
        'fd:',
        '-map',
        '0:a:0',
        '-progress',
        'pipe:1',
        '-nostats',
        '-f',
        'null',
        '-',
      ],
      options: {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore', expect.any(Number)],
        windowsHide: true,
      },
    });
  });

  it('rejects a corrupt single audio stream through configured and environment production binaries', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const validPath = path.join(rootDir, 'decoded-score.wav');
    const corruptPath = path.join(rootDir, 'corrupt-adpcm.wav');
    await Promise.all([fs.writeFile(validPath, wav), fs.writeFile(corruptPath, createCorruptAdpcmWav())]);
    const media = createStudioMediaStore({
      store,
      createId: () => 'decoded_bed',
      createMutationId: () => 'decoded_bed_mutation',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath: validPath,
      expectedRevision: project.revision,
    });

    const defaultMedia = createStudioMediaStore({ store, createId: () => 'corrupt_bed' });
    await expect(
      defaultMedia.importBedAudioFromPathV2({
        projectId: project.id,
        sourcePath: corruptPath,
        expectedRevision: imported.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    vi.stubEnv('FFPROBE_PATH', 'ffprobe');
    vi.stubEnv('FFMPEG_PATH', 'ffmpeg');
    try {
      const environmentMedia = createStudioMediaStore({ store, createId: () => 'corrupt_bed_from_environment' });
      await expect(
        environmentMedia.importBedAudioFromPathV2({
          projectId: project.id,
          sourcePath: corruptPath,
          expectedRevision: imported.project.revision,
        })
      ).rejects.toMatchObject({ code: 'invalid_media' });
    } finally {
      vi.unstubAllEnvs();
    }
    await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project: imported.project });
    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
    await expect(fs.readdir(path.join(rootDir, project.id, 'imports'))).resolves.toEqual(['decoded_bed.wav']);
  });

  it('resolves export media from an already-held project authority without re-entering the project queue', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'authority-score.wav');
    await fs.writeFile(sourcePath, wav);
    const importer = createStudioMediaStore({
      store,
      createId: () => 'authority_bed',
      createMutationId: () => 'authority_bed_import',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await importer.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });
    const reentrantRead = vi.fn(async () => {
      throw new Error('project queue was re-entered while its authority was held');
    });
    const guardedStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'getProjectV2') return reentrantRead;
        return Reflect.get(target, property, receiver);
      },
    });
    const exportMedia = createStudioMediaStore({ store: guardedStore });
    const bytes = await store.withProjectAuthorityV2(project.id, async (authority) => {
      const resolved = await exportMedia.resolveAssetWithProjectAuthorityV2(authority, imported.asset.id);
      if (resolved === null) throw new Error('Authority-bound export media did not resolve');
      const chunks: Buffer[] = [];
      for await (const chunk of await resolved.openVerifiedStream()) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    });

    expect(bytes).toEqual(wav);
    expect(reentrantRead).not.toHaveBeenCalled();
  });

  it('counts retained export bytes before publishing a bed import', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'export-cap-bed.wav');
    await fs.writeFile(sourcePath, wav);
    const withManagedMediaAuthority = vi.fn(
      async <T>(
        _authority: StudioProjectAuthoritySnapshotV2,
        operation: (facts: Readonly<{ catalogRevision: number; managedByteSize: number }>) => Promise<T>
      ): Promise<T> => operation(Object.freeze({ catalogRevision: 2, managedByteSize: 1 }))
    );
    const media = createStudioMediaStore({
      store,
      createId: () => 'export_cap_bed',
      createMutationId: () => 'export_cap_bed_mutation',
      limits: { projectMaxBytes: wav.length },
      withManagedMediaAuthority,
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });

    await expect(
      media.importBedAudioFromPathV2({
        projectId: project.id,
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(withManagedMediaAuthority).toHaveBeenCalledOnce();
    await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
    await expect(fs.readdir(path.join(rootDir, project.id, 'parts'))).resolves.toEqual([]);
    await expect(fs.readdir(path.join(rootDir, project.id, 'imports'))).resolves.toEqual([]);
  });

  it('retains a replaced bed and detaches only the named unselected WAV', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const firstPath = path.join(rootDir, 'first.wav');
    const secondPath = path.join(rootDir, 'second.wav');
    await Promise.all([fs.writeFile(firstPath, wav), fs.writeFile(secondPath, createWav(0x81))]);
    const media = createStudioMediaStore({
      store,
      createId: idSequence('bed_first', 'bed_second'),
      createMutationId: idSequence('bed_first_mutation', 'bed_second_mutation'),
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const first = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath: firstPath,
      expectedRevision: project.revision,
    });
    const second = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath: secondPath,
      expectedRevision: first.project.revision,
    });

    expect(second.project.bedAssetId).toBe('bed_second');
    expect(Object.keys(second.project.assets)).toEqual(['bed_first', 'bed_second']);
    await expect(
      media.detachBedAudioV2({
        projectId: project.id,
        assetId: 'bed_second',
        expectedRevision: second.project.revision,
      })
    ).rejects.toMatchObject({ code: 'media_in_use' });

    const detached = await media.detachBedAudioV2({
      projectId: project.id,
      assetId: 'bed_first',
      expectedRevision: second.project.revision,
    });
    expect(detached.assets).not.toHaveProperty('bed_first');
    expect(detached).toMatchObject({ bedAssetId: 'bed_second', undoHistory: second.project.undoHistory });
    await expect(fs.access(path.join(rootDir, project.id, 'imports', 'bed_first.wav'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.readFile(path.join(rootDir, project.id, 'imports', 'bed_second.wav'))).resolves.toEqual(
      createWav(0x81)
    );
  });

  it('refuses bed detach when the managed WAV is replaced at final project authorization', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'detach-final-authorization.wav');
    await fs.writeFile(sourcePath, wav);
    const setupMedia = createStudioMediaStore({
      store,
      createId: () => 'bed_detach_final_authorization',
      createMutationId: () => 'bed_detach_final_authorization_import',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await setupMedia.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });
    const cleared = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: imported.project.revision,
        operations: [{ kind: 'set_bed', assetId: null }],
      },
      { mutationId: 'clear_bed_before_final_authorization', capturedAt: '2026-08-17T12:06:00.000Z' }
    );
    const managedPath = path.join(rootDir, project.id, 'imports', 'bed_detach_final_authorization.wav');
    const replacementPath = path.join(rootDir, 'foreign-bed-replacement.wav');
    const replacementBytes = createWav(0x91);
    await fs.writeFile(replacementPath, replacementBytes);
    const guardedStore = wrapFinalProjectCommitAuthorization(store, async () => {
      await fs.rename(replacementPath, managedPath);
    });
    const guardedMedia = createStudioMediaStore({ store: guardedStore });

    await expect(
      guardedMedia.detachBedAudioV2({
        projectId: project.id,
        expectedRevision: cleared.project.revision,
        assetId: imported.asset.id,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project: cleared.project });
    await expect(fs.readFile(managedPath)).resolves.toEqual(replacementBytes);
  });

  it('rejects non-WAV and multi-stream bed inputs without publishing an asset', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const imagePath = path.join(rootDir, 'not-a-bed.png');
    const wavPath = path.join(rootDir, 'multi-stream.wav');
    await Promise.all([fs.writeFile(imagePath, png), fs.writeFile(wavPath, wav)]);
    const probeBedAudioV2 = vi.fn(async () => ({
      durationSeconds: 1,
      audioStreamCount: 2,
      otherStreamCount: 0,
    }));
    const media = createStudioMediaStore({
      store,
      createId: idSequence('bed_wrong_kind', 'bed_multi_stream'),
      createMutationId: idSequence('mutation_wrong_kind', 'mutation_multi_stream'),
      probeBedAudioV2,
    });

    await expect(
      media.importBedAudioFromPathV2({
        projectId: project.id,
        sourcePath: imagePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.importBedAudioFromPathV2({
        projectId: project.id,
        sourcePath: wavPath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(await store.getProjectV2(project.id)).toEqual({ status: 'supported', project });
    expect(await fs.readdir(path.join(rootDir, project.id, 'parts')).catch(() => [])).toEqual([]);
    expect(await fs.readdir(path.join(rootDir, project.id, 'imports')).catch(() => [])).toEqual([]);
    expect(probeBedAudioV2).toHaveBeenCalledOnce();
  });

  it('refuses a long bed import when the main lifecycle closes before mutation', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'close-during-probe.wav');
    await fs.writeFile(sourcePath, wav);
    let active = true;
    const assertActive = (): void => {
      if (!active) throw new CreativeStudioMediaError('job_inactive');
    };
    const media = createStudioMediaStore({
      store,
      createId: () => 'bed_closed_import',
      createMutationId: () => 'bed_closed_import_mutation',
      probeBedAudioV2: async () => {
        active = false;
        return { durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 };
      },
    });

    await expect(
      media.importBedAudioFromPathV2({
        projectId: project.id,
        sourcePath,
        expectedRevision: project.revision,
        assertActive,
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });

    expect(await store.getProjectV2(project.id)).toEqual({ status: 'supported', project });
    expect(await fs.readdir(path.join(rootDir, project.id, 'parts')).catch(() => [])).toEqual([]);
    expect(await fs.readdir(path.join(rootDir, project.id, 'imports')).catch(() => [])).toEqual([]);
  });

  it('refuses detach while a verified export read claim is live', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'live-export-read.wav');
    await fs.writeFile(sourcePath, wav);
    const media = createStudioMediaStore({
      store,
      createId: () => 'bed_live_read',
      createMutationId: () => 'bed_live_read_import',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });
    const cleared = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: imported.project.revision,
        operations: [{ kind: 'set_bed', assetId: null }],
      },
      { mutationId: 'clear_live_read_bed', capturedAt: '2026-08-17T12:06:00.000Z' }
    );
    const resolved = await media.resolveAssetV2(project.id, imported.asset.id);
    if (resolved === null) throw new Error('Live-read bed did not resolve');
    const stream = await resolved.openVerifiedStream();

    await expect(
      media.detachBedAudioV2({
        projectId: project.id,
        assetId: imported.asset.id,
        expectedRevision: cleared.project.revision,
      })
    ).rejects.toMatchObject({ code: 'media_in_use' });

    const closed = new Promise<void>((resolve) => stream.once('close', () => resolve()));
    stream.destroy();
    await closed;
    await expect(
      media.detachBedAudioV2({
        projectId: project.id,
        assetId: imported.asset.id,
        expectedRevision: cleared.project.revision,
      })
    ).resolves.not.toHaveProperty(`assets.${imported.asset.id}`);
  });

  it('clears a published detach intent if lifecycle closes before its project mutation', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'close-before-detach-commit.wav');
    await fs.writeFile(sourcePath, wav);
    const media = createStudioMediaStore({
      store,
      createId: () => 'bed_closed_detach',
      createMutationId: () => 'bed_closed_detach_import',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });
    const cleared = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: imported.project.revision,
        operations: [{ kind: 'set_bed', assetId: null }],
      },
      { mutationId: 'clear_closed_detach_bed', capturedAt: '2026-08-17T12:06:00.000Z' }
    );
    let activeChecks = 0;
    const assertActive = (): void => {
      activeChecks += 1;
      if (activeChecks >= 3) throw new CreativeStudioMediaError('job_inactive');
    };

    await expect(
      media.detachBedAudioV2({
        projectId: project.id,
        assetId: imported.asset.id,
        expectedRevision: cleared.project.revision,
        assertActive,
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });

    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? loaded.project.assets : {}).toHaveProperty(imported.asset.id);
    await expect(fs.readFile(path.join(rootDir, project.id, 'imports', 'bed_closed_detach.wav'))).resolves.toEqual(wav);
    expect(await fs.readdir(path.join(rootDir, project.id, 'parts'))).toEqual([]);
  });

  it.each(['post_project_rename', 'project_directory_sync'] as const)(
    'preserves an import journal across an ambiguous %s failure and rolls back safely on restart',
    async (failure) => {
      const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
      const sourcePath = path.join(rootDir, `${failure}-import.wav`);
      await fs.writeFile(sourcePath, wav);
      const projectDirectory = await store.getVerifiedProjectDirectoryV2(project.id);
      if (projectDirectory === null) throw new Error('Ambiguous import project directory missing');
      const originalProjectManifest = await fs.readFile(path.join(projectDirectory, 'project.json'));
      const injected = createAmbiguousProjectCommitFs(projectDirectory, failure);
      const failingStore = createCreativeStudioStore({
        rootDir,
        fs: injected.fs,
        now: () => '2026-08-17T12:07:00.000Z',
      });
      const media = createStudioMediaStore({
        store: failingStore,
        createId: () => `bed_${failure}`,
        createMutationId: () => `bed_${failure}_mutation`,
        now: () => '2026-08-17T12:05:00.000Z',
        probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
      });
      const managedPath = path.join(projectDirectory, 'imports', `bed_${failure}.wav`);
      const intentPath = path.join(projectDirectory, 'parts', `bed-import-bed_${failure}.json`);

      await expect(
        media.importBedAudioFromPathV2({
          projectId: project.id,
          sourcePath,
          expectedRevision: project.revision,
        })
      ).rejects.toMatchObject({ code: 'storage_error' });

      expect(injected.state.injected).toBe(true);
      await expect(fs.readFile(managedPath)).resolves.toEqual(wav);
      await expect(fs.access(intentPath)).resolves.toBeUndefined();

      await fs.writeFile(path.join(projectDirectory, 'project.json'), originalProjectManifest);
      const restartedStore = createCreativeStudioStore({
        rootDir,
        now: () => '2026-08-17T12:08:00.000Z',
      });
      await createStudioMediaStore({ store: restartedStore }).cleanupOrphanPartsV2();

      await expect(restartedStore.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
      await expect(fs.access(managedPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.access(intentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it.each(['post_project_rename', 'project_directory_sync'] as const)(
    'preserves a detach journal across an ambiguous %s failure and restores bytes on restart rollback',
    async (failure) => {
      const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
      const sourcePath = path.join(rootDir, `${failure}-detach.wav`);
      await fs.writeFile(sourcePath, wav);
      const baseMedia = createStudioMediaStore({
        store,
        createId: () => `detachable_${failure}`,
        createMutationId: () => `detachable_${failure}_import`,
        now: () => '2026-08-17T12:05:00.000Z',
        probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
      });
      const imported = await baseMedia.importBedAudioFromPathV2({
        projectId: project.id,
        sourcePath,
        expectedRevision: project.revision,
      });
      const cleared = await store.applyMutationBatchV2(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: project.id,
          expectedRevision: imported.project.revision,
          operations: [{ kind: 'set_bed', assetId: null }],
        },
        {
          mutationId: `clear_detachable_${failure}`,
          capturedAt: '2026-08-17T12:06:00.000Z',
        }
      );
      const projectDirectory = await store.getVerifiedProjectDirectoryV2(project.id);
      if (projectDirectory === null) throw new Error('Ambiguous detach project directory missing');
      const clearedProjectManifest = await fs.readFile(path.join(projectDirectory, 'project.json'));
      const injected = createAmbiguousProjectCommitFs(projectDirectory, failure);
      const failingStore = createCreativeStudioStore({
        rootDir,
        fs: injected.fs,
        now: () => '2026-08-17T12:07:00.000Z',
      });
      const failingMedia = createStudioMediaStore({ store: failingStore });
      const assetId = imported.asset.id;
      const managedPath = path.join(projectDirectory, 'imports', `${assetId}.wav`);
      const intentPath = path.join(projectDirectory, 'parts', `bed-detach-${assetId}.json`);

      await expect(
        failingMedia.detachBedAudioV2({
          projectId: project.id,
          expectedRevision: cleared.project.revision,
          assetId,
        })
      ).rejects.toMatchObject({ code: 'storage_error' });

      expect(injected.state.injected).toBe(true);
      await expect(fs.readFile(managedPath)).resolves.toEqual(wav);
      await expect(fs.access(intentPath)).resolves.toBeUndefined();

      await fs.writeFile(path.join(projectDirectory, 'project.json'), clearedProjectManifest);
      const restartedStore = createCreativeStudioStore({
        rootDir,
        now: () => '2026-08-17T12:08:00.000Z',
      });
      await createStudioMediaStore({ store: restartedStore }).cleanupOrphanPartsV2();

      await expect(restartedStore.getProjectV2(project.id)).resolves.toEqual({
        status: 'supported',
        project: cleared.project,
      });
      await expect(fs.readFile(managedPath)).resolves.toEqual(wav);
      await expect(fs.access(intentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('fails closed when detached audio bytes no longer match their canonical identity', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'replace-before-detach.wav');
    await fs.writeFile(sourcePath, wav);
    const media = createStudioMediaStore({
      store,
      createId: () => 'bed_replaced',
      createMutationId: () => 'bed_replaced_import',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });
    const cleared = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: imported.project.revision,
        operations: [{ kind: 'set_bed', assetId: null }],
      },
      { mutationId: 'clear_replaced_bed', capturedAt: '2026-08-17T12:06:00.000Z' }
    );
    const managedPath = path.join(rootDir, project.id, 'imports', 'bed_replaced.wav');
    await fs.writeFile(managedPath, createWav(0x81));

    await expect(
      media.detachBedAudioV2({
        projectId: project.id,
        assetId: 'bed_replaced',
        expectedRevision: cleared.project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? loaded.project.assets : {}).toHaveProperty('bed_replaced');
    await expect(fs.readFile(managedPath)).resolves.toEqual(createWav(0x81));
  });

  it('finishes only an identity-bound committed detach intent during restart cleanup', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'retained.wav');
    await fs.writeFile(sourcePath, wav);
    const media = createStudioMediaStore({
      store,
      createId: () => 'bed_retained',
      createMutationId: () => 'bed_retained_import',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('Bed cleanup project directory missing');
    const importsDir = path.join(projectDir, 'imports');
    const partsDir = path.join(projectDir, 'parts');
    const managedPath = path.join(importsDir, 'bed_retained.wav');
    const managedStats = await fs.lstat(managedPath);
    await store.updateProjectV2(
      project.id,
      (current) => {
        current.bedAssetId = null;
        delete current.assets.bed_retained;
        return current;
      },
      imported.project.revision
    );
    const intentPath = path.join(partsDir, 'bed-detach-bed_retained.json');
    await Promise.all([
      fs.writeFile(path.join(importsDir, 'unclaimed_audio.wav'), createWav(0x81)),
      fs.writeFile(path.join(importsDir, 'foreign.txt'), 'preserve me'),
      fs.writeFile(
        intentPath,
        `${JSON.stringify({
          schemaVersion: STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION,
          kind: 'detach_bed_audio',
          projectId: project.id,
          expectedRevision: imported.project.revision,
          asset: imported.asset,
          managedIdentity: { dev: String(managedStats.dev), ino: String(managedStats.ino) },
        })}\n`
      ),
    ]);
    await fs.rename(managedPath, `${managedPath}.bed-quarantine`);

    await media.cleanupOrphanPartsV2();

    await expect(fs.access(managedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(`${managedPath}.bed-quarantine`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(intentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(importsDir, 'unclaimed_audio.wav'))).resolves.toEqual(createWav(0x81));
    await expect(fs.readFile(path.join(importsDir, 'foreign.txt'), 'utf8')).resolves.toBe('preserve me');
  });

  it('rolls back an identity-bound pre-commit import intent during restart cleanup', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('Bed import repair project directory missing');
    const importsDir = path.join(projectDir, 'imports');
    const partsDir = path.join(projectDir, 'parts');
    await Promise.all([fs.mkdir(importsDir), fs.mkdir(partsDir)]);
    const managedPath = path.join(importsDir, 'bed_interrupted_import.wav');
    await fs.writeFile(managedPath, wav);
    const managedStats = await fs.lstat(managedPath);
    const asset = {
      id: 'bed_interrupted_import',
      projectId: project.id,
      shotId: null,
      mediaKind: 'audio',
      mimeType: 'audio/wav',
      managedAsset: { collection: 'imports', fileName: 'bed_interrupted_import.wav' },
      byteSize: wav.length,
      sha256: createHash('sha256').update(wav).digest('hex'),
      durationSeconds: 1,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
      createdAt: '2026-08-17T12:05:00.000Z',
    } as const;
    const intentPath = path.join(partsDir, 'bed-import-bed_interrupted_import.json');
    await fs.writeFile(
      intentPath,
      `${JSON.stringify({
        schemaVersion: STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION,
        kind: 'import_bed_audio',
        projectId: project.id,
        expectedRevision: project.revision,
        asset,
        managedIdentity: { dev: String(managedStats.dev), ino: String(managedStats.ino) },
      })}\n`
    );
    const media = createStudioMediaStore({ store });

    await media.cleanupOrphanPartsV2();

    await expect(fs.access(managedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(intentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.getProjectV2(project.id)).toEqual({ status: 'supported', project });
  });

  it('clears an uncommitted detach intent while preserving its still-referenced WAV', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'uncommitted-detach.wav');
    await fs.writeFile(sourcePath, wav);
    const media = createStudioMediaStore({
      store,
      createId: () => 'bed_uncommitted',
      createMutationId: () => 'bed_uncommitted_import',
      now: () => '2026-08-17T12:05:00.000Z',
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });
    const imported = await media.importBedAudioFromPathV2({
      projectId: project.id,
      sourcePath,
      expectedRevision: project.revision,
    });
    const cleared = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: imported.project.revision,
        operations: [{ kind: 'set_bed', assetId: null }],
      },
      { mutationId: 'clear_uncommitted_bed', capturedAt: '2026-08-17T12:06:00.000Z' }
    );
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('Bed cleanup project directory missing');
    const managedPath = path.join(projectDir, 'imports', 'bed_uncommitted.wav');
    const managedStats = await fs.lstat(managedPath);
    const intentPath = path.join(projectDir, 'parts', 'bed-detach-bed_uncommitted.json');
    await fs.writeFile(
      intentPath,
      `${JSON.stringify({
        schemaVersion: STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION,
        kind: 'detach_bed_audio',
        projectId: project.id,
        expectedRevision: cleared.project.revision,
        asset: imported.asset,
        managedIdentity: { dev: String(managedStats.dev), ino: String(managedStats.ino) },
      })}\n`
    );
    await fs.rename(intentPath, `${intentPath}.bed-quarantine`);

    await media.cleanupOrphanPartsV2();

    await expect(fs.readFile(managedPath)).resolves.toEqual(wav);
    await expect(fs.access(intentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(`${intentPath}.bed-quarantine`)).rejects.toMatchObject({ code: 'ENOENT' });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? loaded.project.assets : {}).toHaveProperty('bed_uncommitted');
  });

  it('rejects malformed bed import and detach envelopes before allocating managed bytes', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'envelope.wav');
    await fs.writeFile(sourcePath, wav);
    const media = createStudioMediaStore({
      store,
      probeBedAudioV2: async () => ({ durationSeconds: 1, audioStreamCount: 1, otherStreamCount: 0 }),
    });

    await expect(
      media.importBedAudioFromPathV2({
        projectId: project.id,
        sourcePath,
        expectedRevision: project.revision,
        extra: true,
      } as never)
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.detachBedAudioV2({ projectId: project.id, expectedRevision: project.revision, assetId: '../bed' })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
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
        const entriesBefore = (await fs.readdir(projectDirectory, { recursive: true })).toSorted();
        const projectBefore = JSON.stringify(inactive);
        const media = createStudioMediaStore({ store, createId: () => `inactive_${binKind}_asset` });

        await expect(
          media.importSeedStillFromPathV2({
            projectId: project.id,
            shotId: 'shot_1',
            sourcePath,
            expectedRevision: inactive.revision,
          })
        ).rejects.toMatchObject({ code: 'invalid_media' });

        const loaded = await store.getProjectV2(project.id);
        expect(loaded.status).toBe('supported');
        expect(loaded.status === 'supported' ? JSON.stringify(loaded.project) : null).toBe(projectBefore);
        expect((await fs.readdir(projectDirectory, { recursive: true })).toSorted()).toEqual(entriesBefore);
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
    const projectDirectory = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDirectory === null) throw new Error('Missing active-ownership project directory');
    const withProjectAuthorityV2 = vi.fn(
      async (
        _projectId: string,
        operation: (snapshot: StudioProjectAuthoritySnapshotV2) => Promise<unknown>
      ): Promise<unknown> =>
        operation({
          project: structuredClone(binned),
          projectDir: projectDirectory,
          assertCurrent: async () => undefined,
          commit: async (update) => update(structuredClone(binned)),
        })
    );
    const concurrentStore = { ...store, withProjectAuthorityV2 } as CreativeStudioStore;
    const media = createStudioMediaStore({
      store: concurrentStore,
      createId: () => 'concurrently_binned_asset',
    });

    await expect(
      media.importSeedStillFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(withProjectAuthorityV2).toHaveBeenCalledOnce();
    expect(await fs.readdir(path.join(rootDir, project.id, 'parts')).catch(() => [])).toEqual([]);
    expect(await fs.readdir(path.join(rootDir, project.id, 'imports')).catch(() => [])).toEqual([]);
    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? loaded.project : null).toEqual(project);
  });

  it('re-proves V2 provider-input bytes and refuses a same-path replacement', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeSeedAsset: true });
    const media = createStudioMediaStore({ store });
    const input = await media.resolveProviderInputV2(project.id, 'seed_v2');
    const chunks: Buffer[] = [];
    for await (const chunk of await input.openStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);
    await expect(input.asDataUrl(1.5)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(input.asDataUrl(png.length - 1)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(input.asDataUrl(png.length)).resolves.toBe(`data:image/png;base64,${png.toString('base64')}`);

    const managedPath = path.join(rootDir, project.id, 'imports', 'seed_v2.png');
    await fs.writeFile(managedPath, Buffer.concat([png, Buffer.from('replacement')]));
    await expect(media.resolveProviderInputV2(project.id, 'seed_v2')).rejects.toMatchObject({ code: 'invalid_media' });
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
        shotId: 'shot_1',
        expectedRevision: project.revision,
        sourcePath,
        extra: true,
      },
      { projectId: project.id, expectedRevision: project.revision, sourcePath },
      {
        projectId: project.id,
        shotId: 'shot_1',
        expectedRevision: project.revision,
        sourcePath,
        returnProject: 'yes',
      },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: 1.5, sourcePath },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: 0, sourcePath },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: project.revision, sourcePath: 42 },
    ];
    for (const input of importCases) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile envelope must refuse independently.
      await expect(media.importSeedStillFromPathV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }
    const referenceImportCases: Array<Record<string, unknown>> = [
      {
        projectId: project.id,
        referenceId: '../reference',
        expectedRevision: project.revision,
        sourcePath,
      },
      {
        projectId: project.id,
        referenceId: 'reference_1',
        expectedRevision: project.revision,
        sourcePath,
        extra: true,
      },
      {
        projectId: project.id,
        referenceId: 'reference_1',
        shotId: 'shot_1',
        expectedRevision: project.revision,
        sourcePath,
      },
      { projectId: project.id, expectedRevision: project.revision, sourcePath },
      {
        projectId: project.id,
        referenceId: 'reference_1',
        expectedRevision: project.revision,
        sourcePath,
        returnProject: 'yes',
      },
    ];
    for (const input of referenceImportCases) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile envelope must refuse independently.
      await expect(media.importReferenceImageFromPathV2(input as never)).rejects.toMatchObject({
        code: 'invalid_media',
      });
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
      videoAssetId: 'take_1',
      endpointSeconds: 5,
      status: 'ready',
      frameAssetId: frameId,
      errorCode: null,
      attemptCount: 1,
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

  it('cleans a crash-orphaned Board publication while preserving every manifest-owned Board still', async () => {
    const { rootDir, store, project } = await makeStoreV2({
      purpose: 'board_still',
      prompt: 'A precise opening frame in the approved storyboard style.',
    });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('board_output_owned', 'board_output_redraw'),
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });
    const routed = await store.updateProjectV2(project.id, (current) => ({
      ...current,
      imageRouteId: 'route_image',
    }));
    const promoted = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: routed.revision,
        operations: [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: 'board_output_owned' }],
      },
      { mutationId: 'promote_board_before_restart', capturedAt: '2026-08-17T12:04:00.000Z' }
    );
    expect(promoted.project.shots.shot_1).toMatchObject({
      seedStillId: 'board_output_owned',
      dismissedSeedStillIds: [],
      boardAssetId: 'board_output_owned',
      chainBreak: 'none',
    });
    await addBoardRedrawJob(store, project.id);
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_redraw',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });
    const projectDirectory = path.join(rootDir, project.id);
    const partsDirectory = path.join(projectDirectory, 'parts');
    const boardDirectory = path.join(projectDirectory, 'boardStills');
    const crashPartPath = path.join(partsDirectory, 'board_output_crashed.part');
    const crashBoardPath = path.join(boardDirectory, 'board_output_crashed.png');
    await fs.writeFile(crashPartPath, png);
    await fs.link(crashPartPath, crashBoardPath);
    const restartedStore = createCreativeStudioStore({
      rootDir,
      createId: () => 'must_not_allocate',
      now: () => '2026-08-17T12:10:00.000Z',
    });

    await createStudioMediaStore({ store: restartedStore }).cleanupOrphanPartsV2();

    await expect(fs.access(crashPartPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(crashBoardPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      Promise.all(
        ['board_output_owned.png', 'board_output_redraw.png'].map((fileName) =>
          fs.readFile(path.join(boardDirectory, fileName))
        )
      )
    ).resolves.toEqual([png, png]);
    const restarted = await restartedStore.getProjectV2(project.id);
    expect(restarted).toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            seedStillId: 'board_output_owned',
            dismissedSeedStillIds: [],
            boardAssetId: 'board_output_redraw',
            supersededBoardAssetIds: ['board_output_owned'],
            chainBreak: 'none',
          },
        },
        assets: {
          board_output_owned: { managedAsset: { collection: 'boardStills' } },
          board_output_redraw: { managedAsset: { collection: 'boardStills' } },
        },
      },
    });
    if (restarted.status !== 'supported') throw new Error('Promoted Board project did not survive restart');
    expect(Object.keys(restarted.project.assets).toSorted()).toEqual(['board_output_owned', 'board_output_redraw']);
  });

  it('retires an empty interrupted-cleanup shell and continues cleaning Board orphans', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const boardDirectory = path.join(rootDir, project.id, 'boardStills');
    const quarantineDirectory = path.join(boardDirectory, '.studio-cleanup-AbC123');
    const orphanPath = path.join(boardDirectory, 'board_output_orphan.png');
    await fs.mkdir(quarantineDirectory, { recursive: true });
    await fs.writeFile(orphanPath, png);

    await createStudioMediaStore({ store }).cleanupOrphanPartsV2();

    await expect(fs.access(quarantineDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(orphanPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves populated interrupted-cleanup quarantine without blocking Board recovery', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const boardDirectory = path.join(rootDir, project.id, 'boardStills');
    const quarantineDirectory = path.join(boardDirectory, '.studio-cleanup-AbC123');
    const quarantinedPath = path.join(quarantineDirectory, 'unverified.png');
    const orphanPath = path.join(boardDirectory, 'board_output_orphan.png');
    await fs.mkdir(quarantineDirectory, { recursive: true });
    await fs.writeFile(quarantinedPath, png);
    await fs.writeFile(orphanPath, png);

    await createStudioMediaStore({ store }).cleanupOrphanPartsV2();

    await expect(fs.readFile(quarantinedPath)).resolves.toEqual(png);
    await expect(fs.access(orphanPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves an exact restored cleanup hardlink pair across repeated Board restart recovery', async () => {
    const { rootDir, project } = await makeStoreV2({ purpose: 'board_still' });
    const boardDirectory = path.join(rootDir, project.id, 'boardStills');
    const quarantineDirectory = path.join(boardDirectory, '.studio-cleanup-AbC123');
    const fileName = 'board_output_restored.png';
    const quarantinedPath = path.join(quarantineDirectory, fileName);
    const restoredPath = path.join(boardDirectory, fileName);
    await fs.mkdir(quarantineDirectory, { recursive: true });
    await fs.writeFile(quarantinedPath, png);
    await fs.link(quarantinedPath, restoredPath);
    const restartedStore = createCreativeStudioStore({
      rootDir,
      createId: () => 'must_not_allocate',
      now: () => '2026-08-17T12:10:00.000Z',
    });
    const restartedMedia = createStudioMediaStore({ store: restartedStore });

    await restartedMedia.cleanupOrphanPartsV2();
    await restartedMedia.cleanupOrphanPartsV2();

    await expect(Promise.all([fs.readFile(quarantinedPath), fs.readFile(restoredPath)])).resolves.toEqual([png, png]);
    const [quarantined, restored] = await Promise.all([fs.lstat(quarantinedPath), fs.lstat(restoredPath)]);
    expect(quarantined.ino).toBe(restored.ino);
    expect([quarantined.nlink, restored.nlink]).toEqual([2, 2]);
  });

  it.each(['third_link', 'multiple_entries', 'inode_mismatch'] as const)(
    'rejects an adversarial %s cleanup quarantine without deleting either pathname',
    async (kind) => {
      const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
      const boardDirectory = path.join(rootDir, project.id, 'boardStills');
      const quarantineDirectory = path.join(boardDirectory, '.studio-cleanup-AbC123');
      const fileName = 'board_output_ambiguous.png';
      const quarantinedPath = path.join(quarantineDirectory, fileName);
      const topLevelPath = path.join(boardDirectory, fileName);
      const auxiliaryPath = path.join(rootDir, `board_output_${kind}.png`);
      const secondaryQuarantinePath = path.join(quarantineDirectory, 'second-entry.png');
      const replacement = Buffer.concat([png, Buffer.from([0x01])]);
      await fs.mkdir(quarantineDirectory, { recursive: true });
      await fs.writeFile(quarantinedPath, png);
      if (kind === 'inode_mismatch') {
        await fs.link(quarantinedPath, auxiliaryPath);
        await fs.writeFile(topLevelPath, replacement);
      } else {
        await fs.link(quarantinedPath, topLevelPath);
        if (kind === 'third_link') await fs.link(quarantinedPath, auxiliaryPath);
        else await fs.writeFile(secondaryQuarantinePath, replacement);
      }

      await expect(createStudioMediaStore({ store }).cleanupOrphanPartsV2()).rejects.toMatchObject({
        code: 'storage_error',
      });

      await expect(fs.readFile(quarantinedPath)).resolves.toEqual(png);
      await expect(fs.readFile(topLevelPath)).resolves.toEqual(kind === 'inode_mismatch' ? replacement : png);
      await expect(fs.readFile(kind === 'multiple_entries' ? secondaryQuarantinePath : auxiliaryPath)).resolves.toEqual(
        kind === 'multiple_entries' ? replacement : png
      );
    }
  );

  it('rejects an exact cleanup hardlink pair when the top-level Board pathname is manifest-owned', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('board_output_owned'),
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });
    const boardDirectory = path.join(rootDir, project.id, 'boardStills');
    const quarantineDirectory = path.join(boardDirectory, '.studio-cleanup-AbC123');
    const fileName = 'board_output_owned.png';
    const ownedPath = path.join(boardDirectory, fileName);
    const quarantinedPath = path.join(quarantineDirectory, fileName);
    await fs.mkdir(quarantineDirectory);
    await fs.link(ownedPath, quarantinedPath);

    await expect(media.cleanupOrphanPartsV2()).rejects.toMatchObject({ code: 'storage_error' });

    await expect(Promise.all([fs.readFile(ownedPath), fs.readFile(quarantinedPath)])).resolves.toEqual([png, png]);
  });

  it.each(['symlink', 'directory', 'hardlink'] as const)(
    'rejects an unreferenced Board %s without touching its external authority',
    async (kind) => {
      const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
      const boardDirectory = path.join(rootDir, project.id, 'boardStills');
      const unsafePath = path.join(boardDirectory, 'unsafe.png');
      const outsidePath = path.join(rootDir, `outside-${kind}.png`);
      await fs.mkdir(boardDirectory);
      await fs.writeFile(outsidePath, png);
      if (kind === 'symlink') await fs.symlink(outsidePath, unsafePath);
      else if (kind === 'directory') await fs.mkdir(unsafePath);
      else await fs.link(outsidePath, unsafePath);

      await expect(createStudioMediaStore({ store }).cleanupOrphanPartsV2()).rejects.toMatchObject({
        code: 'storage_error',
      });

      const unsafeStats = await fs.lstat(unsafePath);
      expect(
        kind === 'symlink' ? unsafeStats.isSymbolicLink() : kind === 'directory' ? unsafeStats.isDirectory() : true
      ).toBe(true);
      await expect(fs.readFile(outsidePath)).resolves.toEqual(png);
    }
  );

  it('rejects a Board orphan identity swap and preserves the winning replacement', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const boardDirectory = path.join(rootDir, project.id, 'boardStills');
    const orphanPath = path.join(boardDirectory, 'board_output_orphan.png');
    const replacementPath = path.join(rootDir, 'board_output_replacement.png');
    const replacement = Buffer.concat([png, Buffer.from([0x01])]);
    await fs.mkdir(boardDirectory);
    await fs.writeFile(orphanPath, png);
    await fs.writeFile(replacementPath, replacement);
    let swapped = false;
    const media = createStudioMediaStore({
      store,
      beforeCleanupOwnership: async (filePath) => {
        if (path.basename(filePath) !== path.basename(orphanPath) || swapped) return;
        swapped = true;
        await fs.rm(filePath);
        await fs.rename(replacementPath, filePath);
      },
    });

    await expect(media.cleanupOrphanPartsV2()).rejects.toMatchObject({ code: 'storage_error' });

    expect(swapped).toBe(true);
    await expect(fs.readFile(orphanPath)).resolves.toEqual(replacement);
  });

  it('rejects a project-authority race before removing an unreferenced Board still', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const boardDirectory = path.join(rootDir, project.id, 'boardStills');
    const orphanPath = path.join(boardDirectory, 'board_output_orphan.png');
    await fs.mkdir(boardDirectory);
    await fs.writeFile(orphanPath, png);
    let revised = false;
    const media = createStudioMediaStore({
      store,
      beforeCleanupOwnership: async (filePath) => {
        if (path.basename(filePath) !== path.basename(orphanPath) || revised) return;
        revised = true;
        await store.updateProjectV2(project.id, (current) => ({ ...current, name: 'Revised during cleanup' }));
      },
    });

    await expect(media.cleanupOrphanPartsV2()).rejects.toMatchObject({ code: 'storage_error' });

    expect(revised).toBe(true);
    await expect(fs.readFile(orphanPath)).resolves.toEqual(png);
  });

  it('rejects a hardlink introduced at the Board cleanup ownership fence', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'board_still' });
    const boardDirectory = path.join(rootDir, project.id, 'boardStills');
    const orphanPath = path.join(boardDirectory, 'board_output_orphan.png');
    const outsideLink = path.join(rootDir, 'board_output_winning_link.png');
    await fs.mkdir(boardDirectory);
    await fs.writeFile(orphanPath, png);
    let linked = false;
    const media = createStudioMediaStore({
      store,
      beforeCleanupOwnership: async (filePath) => {
        if (path.basename(filePath) !== path.basename(orphanPath) || linked) return;
        linked = true;
        await fs.link(filePath, outsideLink);
      },
    });

    await expect(media.cleanupOrphanPartsV2()).rejects.toMatchObject({ code: 'storage_error' });

    expect(linked).toBe(true);
    await expect(Promise.all([fs.readFile(orphanPath), fs.readFile(outsideLink)])).resolves.toEqual([png, png]);
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
      videoAssetId: 'take_1',
      endpointSeconds: 8,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.shots.shot_1!.trimOutSeconds = 2;
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 8,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
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
      videoAssetId: 'take_1',
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    const before = await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
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

  it('retries a failed continuity frame on resume with durable bounded backoff', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const conditioningFrameExtractor = vi
      .fn<(input: { destinationPath: string }) => Promise<{ source: 'local_decode' }>>()
      .mockRejectedValueOnce(new StudioConditioningFrameError('decode_failed'))
      .mockImplementation(async ({ destinationPath }) => {
        await fs.writeFile(destinationPath, png);
        return { source: 'local_decode' };
      });
    const sleepConditioningFrameRetry = vi.fn(async () => undefined);
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_failed', 'frame_recovered'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
      sleepConditioningFrameRetry,
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
      };
      return current;
    });

    await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toMatchObject({
      code: 'decode_failed',
    });
    await media.resumeConditioningFramesV2([project.id]);

    expect(sleepConditioningFrameRetry).toHaveBeenCalledExactlyOnceWith(250);
    expect(conditioningFrameExtractor).toHaveBeenCalledTimes(2);
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: {
          [extractionId]: { status: 'ready', frameAssetId: 'frame_recovered', errorCode: null, attemptCount: 2 },
        },
      },
    });
  });

  it('stops retrying a permanently failed continuity frame after three durable attempts', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const conditioningFrameExtractor = vi.fn(async () => {
      throw new StudioConditioningFrameError('decode_failed');
    });
    const sleepConditioningFrameRetry = vi.fn(async () => undefined);
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_attempt_1', 'frame_attempt_2', 'frame_attempt_3'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
      sleepConditioningFrameRetry,
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
      };
      return current;
    });

    await media.resumeConditioningFramesV2([project.id]);
    await media.resumeConditioningFramesV2([project.id]);

    expect(conditioningFrameExtractor).toHaveBeenCalledTimes(3);
    expect(sleepConditioningFrameRetry.mock.calls).toEqual([[250], [1_000]]);
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: {
          [extractionId]: { status: 'failed', frameAssetId: null, errorCode: 'decode_failed', attemptCount: 3 },
        },
      },
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
      videoAssetId: 'take_for_failures',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_for_failures';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_for_failures',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
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
        extraction.attemptCount = 0;
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
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

  it('replaces corrupt ready-frame bytes without changing the asset or extraction identity', async () => {
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
      };
      return current;
    });
    await media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_asset_1.png');
    await fs.writeFile(framePath, Buffer.concat([png, Buffer.from([0x01])]));
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toBeNull();

    await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toMatchObject({
      id: extractionId,
      status: 'ready',
      frameAssetId: 'frame_asset_1',
    });

    expect(conditioningFrameExtractor).toHaveBeenCalledTimes(2);
    await expect(fs.readFile(framePath)).resolves.toEqual(png);
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: { [extractionId]: { id: extractionId, frameAssetId: 'frame_asset_1', status: 'ready' } },
        assets: { frame_asset_1: { id: 'frame_asset_1' } },
      },
    });
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toMatchObject({
      extractionId,
      frameAssetId: 'frame_asset_1',
    });
  });

  it('refuses a ready-frame symlink without decoding or touching its target', async () => {
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
      };
      return current;
    });
    await media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_asset_1.png');
    const outsidePath = path.join(rootDir, 'outside.png');
    const outsideBytes = Buffer.concat([png, Buffer.from([0x02])]);
    await fs.writeFile(outsidePath, outsideBytes);
    await fs.rm(framePath);
    await fs.symlink(outsidePath, framePath);
    const before = await store.getProjectV2(project.id);

    await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(conditioningFrameExtractor).toHaveBeenCalledTimes(1);
    expect((await fs.lstat(framePath)).isSymbolicLink()).toBe(true);
    await expect(fs.readFile(outsidePath)).resolves.toEqual(outsideBytes);
    await expect(store.getProjectV2(project.id)).resolves.toEqual(before);
  });

  it('preserves a replacement that wins the ready-frame cleanup ownership race', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const setupMedia = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_asset_1'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor: async (input) => {
        await fs.writeFile(input.destinationPath, png);
        return { source: 'local_decode' };
      },
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
      videoAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
      };
      return current;
    });
    await setupMedia.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_asset_1.png');
    await fs.writeFile(framePath, Buffer.concat([png, Buffer.from([0x01])]));
    const winningBytes = Buffer.concat([png, Buffer.from([0x02])]);
    let replaced = false;
    const repairMedia = createStudioMediaStore({
      store,
      createId: () => 'must_not_allocate',
      conditioningFrameExtractor: async (input) => {
        await fs.writeFile(input.destinationPath, png);
        return { source: 'local_decode' };
      },
      beforeCleanupOwnership: async (filePath) => {
        if (path.basename(filePath) !== 'frame_asset_1.png' || replaced) return;
        replaced = true;
        await fs.rm(filePath);
        await fs.writeFile(filePath, winningBytes);
      },
    });
    const before = await store.getProjectV2(project.id);

    await expect(repairMedia.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toMatchObject(
      {
        code: 'storage_error',
      }
    );

    expect(replaced).toBe(true);
    await expect(fs.readFile(framePath)).resolves.toEqual(winningBytes);
    await expect(store.getProjectV2(project.id)).resolves.toEqual(before);
  });

  it('removes a refused ready-frame repair even when the stale asset id remains recorded', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const extract = async (input: { destinationPath: string }): Promise<{ source: 'local_decode' }> => {
      await fs.writeFile(input.destinationPath, png);
      return { source: 'local_decode' };
    };
    const setupMedia = createStudioMediaStore({
      store,
      createId: idSequence('take_for_refused_repair', 'frame_for_refused_repair'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor: extract,
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
      videoAssetId: 'take_for_refused_repair',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.videoAssetId = 'take_for_refused_repair';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        videoAssetId: 'take_for_refused_repair',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
        attemptCount: 0,
      };
      return current;
    });
    await setupMedia.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_for_refused_repair.png');
    await fs.rm(framePath);
    let active = true;
    const guardedStore = wrapFinalProjectCommitAuthorization(store, async () => {
      active = false;
    });
    const replacementFrame = Buffer.concat([png, Buffer.from([0x01])]);
    const recoveryMedia = createStudioMediaStore({
      store: guardedStore,
      createId: () => 'must_not_allocate_for_ready_repair',
      assertActive: () => {
        if (!active) throw new CreativeStudioMediaError('job_inactive');
      },
      conditioningFrameExtractor: async (input) => {
        await fs.writeFile(input.destinationPath, replacementFrame);
        return { source: 'local_decode' };
      },
    });

    await expect(
      recoveryMedia.extractConditioningFrameV2({ projectId: project.id, extractionId })
    ).rejects.toMatchObject({ code: 'storage_error' });

    await expect(fs.access(framePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: { [extractionId]: { status: 'ready', frameAssetId: 'frame_for_refused_repair' } },
        assets: { frame_for_refused_repair: { id: 'frame_for_refused_repair' } },
      },
    });
  });
});
