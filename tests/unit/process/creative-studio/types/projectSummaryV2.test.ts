/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  studioProjectSummaryV2Schema,
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
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 1,
  referenceAssetId: null,
  selectedTakeId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[]): StudioBeat => ({
  id,
  title: id,
  action: '',
  look: '',
  shotOrder,
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

const makeJob = (id: string, shotId: string, outputAssetIds: string[]): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  status: 'succeeded',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
  idempotencyKey: `idem_${id}`,
  providerJobId: 'remote_1',
  remoteStartedAt: timestamp,
  cancellationPolicy: 'none',
  outputAssetIds,
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makeProject = (): StudioProjectV2 => ({
  schemaVersion: 2,
  revision: 1,
  id: 'project_1',
  name: 'Project One',
  brief: '',
  rules: [],
  ruleListUndo: null,
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  beatOrder: [],
  beats: {},
  shots: {},
  bin: [],
  cuts: {},
  activeCutId: null,
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe('toStudioProjectSummaryV2', () => {
  it('uses stable active Beat-to-Shot order, skips unusable previews, and excludes parked beats', () => {
    const project = makeProject();
    project.beatOrder = ['section_2', 'section_1'];
    project.beats = {
      section_parked: makeBeat('section_parked', ['clip_parked']),
      section_1: makeBeat('section_1', ['clip_later']),
      section_2: makeBeat('section_2', ['clip_video_bad', 'clip_image']),
    };
    project.bin = [{ kind: 'beat', beatId: 'section_parked' }];
    project.shots = {
      clip_parked: makeShot('clip_parked', { selectedTakeId: 'asset_parked', assetIds: ['asset_parked'] }),
      clip_later: makeShot('clip_later', { selectedTakeId: 'asset_later', assetIds: ['asset_later'] }),
      clip_video_bad: makeShot('clip_video_bad', {
        mediaKind: 'video',
        durationSeconds: 4,
        selectedTakeId: 'asset_video',
        assetIds: ['asset_video'],
      }),
      clip_image: makeShot('clip_image', { selectedTakeId: 'asset_image', assetIds: ['asset_image'] }),
    };
    project.assets = {
      asset_parked: makeAsset('asset_parked', 'clip_parked'),
      asset_later: makeAsset('asset_later', 'clip_later'),
      asset_video: makeAsset('asset_video', 'clip_video_bad', {
        mediaKind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: 4,
      }),
      asset_image: makeAsset('asset_image', 'clip_image'),
    };

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
        beatId: 'section_2',
        shotId: 'clip_image',
        assetId: 'asset_image',
        beatPosition: 1,
        shotPosition: 2,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  it('uses the single canonical thumbnail from the selected video take producer', () => {
    const project = makeProject();
    project.beatOrder = ['section_1'];
    project.beats.section_1 = makeBeat('section_1', ['clip_1']);
    project.shots.clip_1 = makeShot('clip_1', {
      mediaKind: 'video',
      durationSeconds: 4,
      selectedTakeId: 'asset_video',
      assetIds: ['asset_video', 'asset_thumbnail'],
      jobIds: ['job_1'],
    });
    project.assets.asset_video = makeAsset('asset_video', 'clip_1', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 4,
    });
    project.assets.asset_thumbnail = makeAsset('asset_thumbnail', 'clip_1', {
      managedAsset: { collection: 'thumbnails', fileName: 'asset_thumbnail.png' },
    });
    project.jobs.job_1 = makeJob('job_1', 'clip_1', ['asset_video', 'asset_thumbnail']);

    expect(toStudioProjectSummaryV2(project).poster).toEqual({
      beatId: 'section_1',
      shotId: 'clip_1',
      assetId: 'asset_thumbnail',
      beatPosition: 1,
      shotPosition: 1,
    });
  });

  it.each([
    ['no thumbnail', []],
    ['multiple thumbnails', ['asset_thumbnail_1', 'asset_thumbnail_2']],
  ] as const)('omits poster for a selected video with %s', (_label, thumbnailIds) => {
    const project = makeProject();
    project.beatOrder = ['section_1'];
    project.beats.section_1 = makeBeat('section_1', ['clip_1']);
    project.shots.clip_1 = makeShot('clip_1', {
      mediaKind: 'video',
      durationSeconds: 4,
      selectedTakeId: 'asset_video',
      assetIds: ['asset_video', ...thumbnailIds],
      jobIds: ['job_1'],
    });
    project.assets.asset_video = makeAsset('asset_video', 'clip_1', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 4,
    });
    thumbnailIds.forEach((assetId) => {
      project.assets[assetId] = makeAsset(assetId, 'clip_1', {
        managedAsset: { collection: 'thumbnails', fileName: `${assetId}.png` },
      });
    });
    project.jobs.job_1 = makeJob('job_1', 'clip_1', ['asset_video', ...thumbnailIds]);

    const summary = toStudioProjectSummaryV2(project);
    expect(summary.selectedTakeCount).toBe(1);
    expect(Object.hasOwn(summary, 'poster')).toBe(false);
  });

  it('omits poster when a video producer mixes one canonical and one foreign thumbnail', () => {
    const project = makeProject();
    project.beatOrder = ['section_1'];
    project.beats.section_1 = makeBeat('section_1', ['clip_1']);
    project.shots.clip_1 = makeShot('clip_1', {
      mediaKind: 'video',
      durationSeconds: 4,
      selectedTakeId: 'asset_video',
      assetIds: ['asset_video', 'asset_thumbnail', 'asset_foreign_thumbnail'],
      jobIds: ['job_1'],
    });
    project.assets.asset_video = makeAsset('asset_video', 'clip_1', {
      mediaKind: 'video',
      mimeType: 'video/mp4',
      durationSeconds: 4,
    });
    project.assets.asset_thumbnail = makeAsset('asset_thumbnail', 'clip_1', {
      managedAsset: { collection: 'thumbnails', fileName: 'asset_thumbnail.png' },
    });
    project.assets.asset_foreign_thumbnail = makeAsset('asset_foreign_thumbnail', 'clip_2', {
      managedAsset: { collection: 'thumbnails', fileName: 'asset_foreign_thumbnail.png' },
    });
    project.jobs.job_1 = makeJob('job_1', 'clip_1', ['asset_video', 'asset_thumbnail', 'asset_foreign_thumbnail']);

    expect(Object.hasOwn(toStudioProjectSummaryV2(project), 'poster')).toBe(false);
  });

  it('omits poster from an empty project and rejects unknown summary keys', () => {
    const summary = toStudioProjectSummaryV2(makeProject());

    expect(Object.hasOwn(summary, 'poster')).toBe(false);
    expect(studioProjectSummaryV2Schema.safeParse({ ...summary, unexpected: true }).success).toBe(false);
  });
});
