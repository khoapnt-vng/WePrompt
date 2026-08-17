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
  StudioClip,
  StudioJobV2,
  StudioProjectV2,
  StudioSection,
} from '@/common/types/project/creativeStudioTypes';

const timestamp = '2026-08-17T00:00:00.000Z';

const makeClip = (id: string, overrides: Partial<StudioClip> = {}): StudioClip => ({
  id,
  shotPrompt: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 1,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeSection = (id: string, clipOrder: string[]): StudioSection => ({
  id,
  title: id,
  storyLine: '',
  visualPrompt: '',
  clipOrder,
});

const makeAsset = (id: string, clipId: string, overrides: Partial<StudioAssetV2> = {}): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  clipId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  createdAt: timestamp,
  ...overrides,
});

const makeJob = (id: string, clipId: string, outputAssetIds: string[]): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  clipId,
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
  sectionOrder: [],
  sections: {},
  clips: {},
  shelf: [],
  cuts: {},
  activeCutId: null,
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe('toStudioProjectSummaryV2', () => {
  it('uses stable active Section-to-Clip order, skips unusable previews, and excludes parked sections', () => {
    const project = makeProject();
    project.sectionOrder = ['section_2', 'section_1'];
    project.sections = {
      section_parked: makeSection('section_parked', ['clip_parked']),
      section_1: makeSection('section_1', ['clip_later']),
      section_2: makeSection('section_2', ['clip_video_bad', 'clip_image']),
    };
    project.shelf = [{ kind: 'section', sectionId: 'section_parked' }];
    project.clips = {
      clip_parked: makeClip('clip_parked', { selectedAssetId: 'asset_parked', assetIds: ['asset_parked'] }),
      clip_later: makeClip('clip_later', { selectedAssetId: 'asset_later', assetIds: ['asset_later'] }),
      clip_video_bad: makeClip('clip_video_bad', {
        mediaKind: 'video',
        durationSeconds: 4,
        selectedAssetId: 'asset_video',
        assetIds: ['asset_video'],
      }),
      clip_image: makeClip('clip_image', { selectedAssetId: 'asset_image', assetIds: ['asset_image'] }),
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
      sectionCount: 2,
      clipCount: 3,
      selectedAssetCount: 3,
      poster: {
        sectionId: 'section_2',
        clipId: 'clip_image',
        assetId: 'asset_image',
        sectionPosition: 1,
        clipPosition: 2,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  it('uses the single canonical thumbnail from the selected video take producer', () => {
    const project = makeProject();
    project.sectionOrder = ['section_1'];
    project.sections.section_1 = makeSection('section_1', ['clip_1']);
    project.clips.clip_1 = makeClip('clip_1', {
      mediaKind: 'video',
      durationSeconds: 4,
      selectedAssetId: 'asset_video',
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
      sectionId: 'section_1',
      clipId: 'clip_1',
      assetId: 'asset_thumbnail',
      sectionPosition: 1,
      clipPosition: 1,
    });
  });

  it.each([
    ['no thumbnail', []],
    ['multiple thumbnails', ['asset_thumbnail_1', 'asset_thumbnail_2']],
  ] as const)('omits poster for a selected video with %s', (_label, thumbnailIds) => {
    const project = makeProject();
    project.sectionOrder = ['section_1'];
    project.sections.section_1 = makeSection('section_1', ['clip_1']);
    project.clips.clip_1 = makeClip('clip_1', {
      mediaKind: 'video',
      durationSeconds: 4,
      selectedAssetId: 'asset_video',
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
    expect(summary.selectedAssetCount).toBe(1);
    expect(Object.hasOwn(summary, 'poster')).toBe(false);
  });

  it('omits poster when a video producer mixes one canonical and one foreign thumbnail', () => {
    const project = makeProject();
    project.sectionOrder = ['section_1'];
    project.sections.section_1 = makeSection('section_1', ['clip_1']);
    project.clips.clip_1 = makeClip('clip_1', {
      mediaKind: 'video',
      durationSeconds: 4,
      selectedAssetId: 'asset_video',
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
