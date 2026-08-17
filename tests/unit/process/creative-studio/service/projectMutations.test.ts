/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioAsset,
  StudioEditableScene,
  StudioJob,
  StudioProject,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import {
  applyStudioProjectFields,
  applyStudioSceneMutation,
  applyStudioSceneOrder,
  applyStudioTakeSelection,
} from '@process/services/creative-studio/service/projectMutations';

const makeEditableScene = (overrides: Partial<StudioEditableScene> = {}): StudioEditableScene => ({
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A cinematic product reveal',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 8,
  referenceAssetId: null,
  ...overrides,
});

const makeScene = (id: string, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  ...makeEditableScene({ title: `Scene ${id}` }),
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
  ...overrides,
});

const makeProject = (overrides: Partial<StudioProject> = {}): StudioProject => ({
  schemaVersion: 1,
  revision: 7,
  id: 'project_1',
  name: 'Launch film',
  brief: 'Introduce the next product',
  rules: [],
  ruleListUndo: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 16,
  resolution: '1080p',
  sceneOrder: ['scene_1'],
  scenes: { scene_1: makeScene('scene_1') },
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  ...overrides,
});

const makeAsset = (sceneId: string, id: string, overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id,
  projectId: 'project_1',
  sceneId,
  mediaKind: 'video',
  mimeType: 'video/mp4',
  managedAsset: { collection: 'assets', fileName: `${id}.mp4` },
  byteSize: 1024,
  sha256: 'a'.repeat(64),
  durationSeconds: 8,
  createdAt: '2026-08-16T00:00:00.000Z',
  ...overrides,
});

const makeJob = (sceneId: string, id: string, overrides: Partial<StudioJob> = {}): StudioJob => ({
  id,
  projectId: 'project_1',
  sceneId,
  status: 'needs_attention',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
  idempotencyKey: `${id}_key`,
  providerJobId: null,
  cancellationPolicy: 'queued_only',
  outputAssetIds: [],
  error: { code: 'submission_unknown', messageKey: 'studio.submissionUnknown' },
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
  ...overrides,
});

describe('Studio project mutation helpers', () => {
  it('applies editable project fields without mutating the input project', () => {
    const project = makeProject();
    const before = structuredClone(project);

    const updated = applyStudioProjectFields(project, {
      name: 'Edited launch film',
      aspectRatio: '9:16',
      resolution: '720p',
    });

    expect(updated).toMatchObject({ name: 'Edited launch film', aspectRatio: '9:16', resolution: '720p' });
    expect(updated).not.toBe(project);
    expect(project).toEqual(before);
  });

  it('adds a ready scene without mutating the input project or editable scene', () => {
    const project = makeProject({ sceneOrder: [], scenes: {} });
    const editable = makeEditableScene();
    const projectBefore = structuredClone(project);
    const sceneBefore = structuredClone(editable);

    const updated = applyStudioSceneMutation(project, { sceneId: 'scene_2', scene: editable });

    expect(updated.sceneOrder).toEqual(['scene_2']);
    expect(updated.scenes.scene_2).toMatchObject({ id: 'scene_2', selectedAssetId: null, reviewState: 'ready' });
    expect(project).toEqual(projectBefore);
    expect(editable).toEqual(sceneBefore);
  });

  it('preserves main-owned history when editing a scene', () => {
    const take = makeAsset('scene_1', 'take_1');
    const job = makeJob('scene_1', 'job_1', {
      status: 'succeeded',
      providerJobId: 'remote_1',
      outputAssetIds: ['take_1'],
      error: null,
    });
    const project = makeProject({
      scenes: {
        scene_1: makeScene('scene_1', {
          selectedAssetId: 'take_1',
          assetIds: ['take_1'],
          jobIds: ['job_1'],
          reviewState: 'complete',
        }),
      },
      assets: { take_1: take },
      jobs: { job_1: job },
    });

    const updated = applyStudioSceneMutation(project, {
      sceneId: 'scene_1',
      scene: makeEditableScene({ title: 'Edited opening' }),
    });

    expect(updated.scenes.scene_1).toMatchObject({
      title: 'Edited opening',
      selectedAssetId: 'take_1',
      assetIds: ['take_1'],
      jobIds: ['job_1'],
      reviewState: 'complete',
    });
  });

  it('removes an empty scene and reconciles persisted cuts', () => {
    const project = makeProject({
      cuts: {
        cut_1: {
          id: 'cut_1',
          name: 'Launch film',
          orderMode: 'manual',
          clipOrder: ['clip_scene_1'],
          clips: {
            clip_scene_1: {
              id: 'clip_scene_1',
              sceneId: 'scene_1',
              assetId: 'missing_take',
              sourceInSeconds: null,
              sourceOutSeconds: null,
              crop: null,
              filters: [],
            },
          },
        },
      },
      activeCutId: 'cut_1',
    });

    const updated = applyStudioSceneMutation(project, { sceneId: 'scene_1', scene: null });

    expect(updated.sceneOrder).toEqual([]);
    expect(updated.scenes).toEqual({});
    expect(updated.cuts?.cut_1).toMatchObject({ clipOrder: [], clips: {} });
  });

  it('rejects malformed editable scene fields', () => {
    const project = makeProject();

    expect(() =>
      applyStudioSceneMutation(project, {
        sceneId: 'scene_1',
        scene: makeEditableScene({ title: 'x'.repeat(257) }),
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_payload', message: 'Invalid Studio scene title' }));
  });

  it('rejects a reference that is not an image owned by the edited scene', () => {
    const foreignReference = makeAsset('scene_2', 'reference_1', {
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'reference_1.png' },
    });
    const project = makeProject({ assets: { reference_1: foreignReference } });

    expect(() =>
      applyStudioSceneMutation(project, {
        sceneId: 'scene_1',
        scene: makeEditableScene({ referenceAssetId: 'reference_1' }),
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'invalid_payload',
        message: 'Studio reference asset does not belong to its scene',
      })
    );
  });

  it('blocks a media-kind change while the scene has an active job', () => {
    const project = makeProject({
      scenes: { scene_1: makeScene('scene_1', { jobIds: ['job_1'], reviewState: 'blocked' }) },
      jobs: { job_1: makeJob('scene_1', 'job_1') },
    });

    expect(() =>
      applyStudioSceneMutation(project, {
        sceneId: 'scene_1',
        scene: makeEditableScene({ mediaKind: 'image' }),
      })
    ).toThrowError(expect.objectContaining({ code: 'busy' }));
  });

  it('clears only an incompatible selected take on an allowed media-kind change', () => {
    const selected = makeAsset('scene_1', 'take_video');
    const reference = makeAsset('scene_1', 'reference_image', {
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'reference_image.png' },
      durationSeconds: undefined,
    });
    const project = makeProject({
      scenes: {
        scene_1: makeScene('scene_1', {
          selectedAssetId: 'take_video',
          assetIds: ['take_video', 'reference_image'],
          reviewState: 'complete',
        }),
      },
      assets: { take_video: selected, reference_image: reference },
    });
    const before = structuredClone(project);

    const updated = applyStudioSceneMutation(project, {
      sceneId: 'scene_1',
      scene: makeEditableScene({ mediaKind: 'image', referenceAssetId: 'reference_image' }),
    });

    expect(updated.scenes.scene_1).toMatchObject({
      selectedAssetId: null,
      referenceAssetId: 'reference_image',
      assetIds: ['take_video', 'reference_image'],
      reviewState: 'ready',
    });
    expect(project).toEqual(before);
  });

  it('applies an exact scene permutation and reconciles storyboard cut order without mutating input', () => {
    const take1 = makeAsset('scene_1', 'take_1');
    const take2 = makeAsset('scene_2', 'take_2');
    const project = makeProject({
      sceneOrder: ['scene_1', 'scene_2'],
      scenes: {
        scene_1: makeScene('scene_1', { selectedAssetId: 'take_1', assetIds: ['take_1'], reviewState: 'complete' }),
        scene_2: makeScene('scene_2', { selectedAssetId: 'take_2', assetIds: ['take_2'], reviewState: 'complete' }),
      },
      assets: { take_1: take1, take_2: take2 },
      cuts: {
        cut_1: {
          id: 'cut_1',
          name: 'Launch film',
          orderMode: 'storyboard',
          clipOrder: ['clip_scene_1', 'clip_scene_2'],
          clips: {
            clip_scene_1: {
              id: 'clip_scene_1',
              sceneId: 'scene_1',
              assetId: 'take_1',
              sourceInSeconds: null,
              sourceOutSeconds: null,
              crop: null,
              filters: [],
            },
            clip_scene_2: {
              id: 'clip_scene_2',
              sceneId: 'scene_2',
              assetId: 'take_2',
              sourceInSeconds: null,
              sourceOutSeconds: null,
              crop: null,
              filters: [],
            },
          },
        },
      },
      activeCutId: 'cut_1',
    });
    const before = structuredClone(project);

    const updated = applyStudioSceneOrder(project, ['scene_2', 'scene_1']);

    expect(updated.sceneOrder).toEqual(['scene_2', 'scene_1']);
    expect(updated.cuts?.cut_1.clipOrder).toEqual(['clip_scene_2', 'clip_scene_1']);
    expect(project).toEqual(before);
  });

  it('rejects a scene order that is not an exact permutation', () => {
    const project = makeProject({
      sceneOrder: ['scene_1', 'scene_2'],
      scenes: { scene_1: makeScene('scene_1'), scene_2: makeScene('scene_2') },
    });

    expect(() => applyStudioSceneOrder(project, ['scene_1', 'scene_1'])).toThrowError(
      expect.objectContaining({
        code: 'invalid_payload',
        message: 'Studio scene order must be an exact permutation',
      })
    );
  });

  it('selects a canonical take and reconciles the persisted cut without mutating input', () => {
    const firstTake = makeAsset('scene_1', 'take_1');
    const shorterTake = makeAsset('scene_1', 'take_2', { durationSeconds: 4 });
    const project = makeProject({
      scenes: {
        scene_1: makeScene('scene_1', {
          selectedAssetId: 'take_1',
          assetIds: ['take_1', 'take_2'],
          reviewState: 'complete',
        }),
      },
      assets: { take_1: firstTake, take_2: shorterTake },
      cuts: {
        cut_1: {
          id: 'cut_1',
          name: 'Launch film',
          orderMode: 'storyboard',
          clipOrder: ['clip_scene_1'],
          clips: {
            clip_scene_1: {
              id: 'clip_scene_1',
              sceneId: 'scene_1',
              assetId: 'take_1',
              sourceInSeconds: 1,
              sourceOutSeconds: 7,
              crop: null,
              filters: [],
            },
          },
        },
      },
      activeCutId: 'cut_1',
    });
    const before = structuredClone(project);

    const updated = applyStudioTakeSelection(project, { sceneId: 'scene_1', assetId: 'take_2' });

    expect(updated.scenes.scene_1.selectedAssetId).toBe('take_2');
    expect(updated.cuts?.cut_1.clips.clip_scene_1).toMatchObject({ assetId: 'take_2', sourceOutSeconds: 4 });
    expect(project).toEqual(before);
  });

  it('rejects selecting a non-take asset', () => {
    const importedReference = makeAsset('scene_1', 'reference_1', {
      managedAsset: { collection: 'imports', fileName: 'reference_1.mp4' },
    });
    const project = makeProject({
      scenes: { scene_1: makeScene('scene_1', { assetIds: ['reference_1'] }) },
      assets: { reference_1: importedReference },
    });

    expect(() => applyStudioTakeSelection(project, { sceneId: 'scene_1', assetId: 'reference_1' })).toThrowError(
      expect.objectContaining({
        code: 'invalid_payload',
        message: 'Studio asset does not belong to its selected scene',
      })
    );
  });
});
