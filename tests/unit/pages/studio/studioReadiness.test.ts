/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioAsset,
  StudioRendererJob,
  StudioRendererProject,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { canOpenSingleSceneReview, deriveStudioReadiness } from '@renderer/pages/studio/studioReadiness';

const scene = (id: string, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  title: id,
  purpose: '',
  visualPrompt: `Prompt for ${id}`,
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
  ...overrides,
});

const asset = (id: string, sceneId: string, overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id,
  projectId: 'project-1',
  sceneId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 128,
  sha256: id.padEnd(64, 'a').slice(0, 64),
  createdAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
});

const job = (id: string, sceneId: string, overrides: Partial<StudioRendererJob> = {}): StudioRendererJob => ({
  id,
  projectId: 'project-1',
  sceneId,
  status: 'succeeded',
  provider: { choiceId: 'choice-1', providerId: 'provider-1', model: 'model-1' },
  outputAssetIds: [],
  error: null,
  canRetryDownload: false,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
});

const project = (scenes: StudioScene[], overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Project',
  brief: '',
  aspectRatio: '16:9',
  targetDurationSeconds: scenes.reduce((total, item) => total + item.durationSeconds, 0),
  resolution: '720p',
  sceneOrder: scenes.map((item) => item.id),
  scenes: Object.fromEntries(scenes.map((item) => [item.id, item])),
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
});

describe('deriveStudioReadiness', () => {
  it('derives every scene status in stable storyboard order', () => {
    const generating = scene('generating', { jobIds: ['active'] });
    const generated = scene('generated', { selectedAssetId: 'selected', assetIds: ['selected'], jobIds: ['done-1'] });
    const needsSelection = scene('needs-selection', { assetIds: ['variation'], jobIds: ['done-2'] });
    const needsAttention = scene('needs-attention', { jobIds: ['failed'] });
    const needsPrompt = scene('needs-prompt', { visualPrompt: '   ' });
    const ready = scene('ready');
    const summary = deriveStudioReadiness(
      project([generating, generated, needsSelection, needsAttention, needsPrompt, ready], {
        assets: {
          selected: asset('selected', generated.id),
          variation: asset('variation', needsSelection.id),
        },
        jobs: {
          active: job('active', generating.id, { status: 'queued_remote' }),
          'done-1': job('done-1', generated.id, { outputAssetIds: ['selected'] }),
          'done-2': job('done-2', needsSelection.id, { outputAssetIds: ['variation'] }),
          failed: job('failed', needsAttention.id, { status: 'failed' }),
        },
      })
    );

    expect(summary.sceneStatuses).toEqual({
      generating: 'generating',
      generated: 'generated',
      'needs-selection': 'needs_selection',
      'needs-attention': 'needs_attention',
      'needs-prompt': 'needs_prompt',
      ready: 'ready',
    });
    expect(summary.readySceneIds).toEqual(['ready']);
    expect(summary.selectedAssetCount).toBe(1);
  });

  it('reports a missing title as needing a title, not a prompt, when the visual is already written', () => {
    const missingTitle = scene('missing-title', { title: '   ' });
    const summary = deriveStudioReadiness(project([missingTitle]));

    // The scene factory supplies a visual prompt, so `needs_prompt` here would
    // send the user to a field that is already filled — the defect this guards.
    expect(missingTitle.visualPrompt.trim().length).toBeGreaterThan(0);
    expect(summary.sceneStatuses[missingTitle.id]).toBe('needs_title');
    expect(summary.readySceneIds).toEqual([]);
  });

  it('still reports a missing prompt as needing a prompt when the title is present', () => {
    const missingPrompt = scene('missing-prompt', { visualPrompt: '  ' });
    const summary = deriveStudioReadiness(project([missingPrompt]));

    expect(summary.sceneStatuses[missingPrompt.id]).toBe('needs_prompt');
    expect(summary.readySceneIds).toEqual([]);
  });

  it('gives a missing title precedence over active jobs and generated outputs', () => {
    const active = scene('active-missing-title', { title: '', jobIds: ['active'] });
    const generated = scene('generated-missing-title', {
      title: '   ',
      selectedAssetId: 'selected',
      assetIds: ['selected'],
      jobIds: ['succeeded'],
    });
    const summary = deriveStudioReadiness(
      project([active, generated], {
        assets: { selected: asset('selected', generated.id) },
        jobs: {
          active: job('active', active.id, { status: 'running' }),
          succeeded: job('succeeded', generated.id, { outputAssetIds: ['selected'] }),
        },
      })
    );

    expect(summary.sceneStatuses).toEqual({
      'active-missing-title': 'needs_title',
      'generated-missing-title': 'needs_title',
    });
    expect(summary.readySceneIds).toEqual([]);
    expect(summary.selectedAssetCount).toBe(1);
  });

  it.each(['queued_local', 'submitting', 'queued_remote', 'running'] as const)(
    'treats a canonical %s job as generating even when a selected output exists',
    (status) => {
      const current = scene('scene-1', {
        selectedAssetId: 'asset-1',
        assetIds: ['asset-1'],
        jobIds: ['succeeded', 'active'],
      });
      const summary = deriveStudioReadiness(
        project([current], {
          assets: { 'asset-1': asset('asset-1', current.id) },
          jobs: {
            succeeded: job('succeeded', current.id, { outputAssetIds: ['asset-1'] }),
            active: job('active', current.id, { status }),
          },
        })
      );

      expect(summary.sceneStatuses[current.id]).toBe('generating');
    }
  );

  it('rejects foreign and malformed asset and job references', () => {
    const current = scene('scene-1', {
      selectedAssetId: 'selected',
      assetIds: ['selected', 'output'],
      jobIds: ['foreign-active', 'malformed-active', 'succeeded'],
    });
    const summary = deriveStudioReadiness(
      project([current], {
        assets: {
          selected: asset('selected', current.id, { projectId: 'other-project' }),
          output: asset('wrong-id', current.id),
        },
        jobs: {
          'foreign-active': job('foreign-active', current.id, { projectId: 'other-project', status: 'running' }),
          'malformed-active': job('wrong-id', current.id, { status: 'running' }),
          succeeded: job('succeeded', current.id, { outputAssetIds: ['selected', 'output'] }),
        },
      })
    );

    expect(summary.sceneStatuses[current.id]).toBe('ready');
    expect(summary.selectedAssetCount).toBe(0);
  });

  it('uses only the latest canonical terminal job when deriving attention', () => {
    const recovered = scene('recovered', { jobIds: ['failed', 'cancelled'] });
    const attention = scene('attention', { jobIds: ['cancelled-2', 'needs-attention'] });
    const summary = deriveStudioReadiness(
      project([recovered, attention], {
        jobs: {
          failed: job('failed', recovered.id, { status: 'failed' }),
          cancelled: job('cancelled', recovered.id, { status: 'cancelled' }),
          'cancelled-2': job('cancelled-2', attention.id, { status: 'cancelled' }),
          'needs-attention': job('needs-attention', attention.id, { status: 'needs_attention' }),
        },
      })
    );

    expect(summary.sceneStatuses).toEqual({ recovered: 'ready', attention: 'needs_attention' });
    expect(summary.readySceneIds).toEqual(['recovered']);
  });

  it.each([
    { target: 15, expected: 0 },
    { target: 12, expected: 3 },
    { target: 20, expected: -5 },
  ])('reports a duration delta of $expected when target is $target', ({ target, expected }) => {
    const first = scene('first', { durationSeconds: 5 });
    const second = scene('second', { durationSeconds: 10 });

    expect(deriveStudioReadiness(project([first, second], { targetDurationSeconds: target }))).toMatchObject({
      totalSceneCount: 2,
      durationDeltaSeconds: expected,
    });
  });

  it('reports the total shot duration, not only its delta against the target', () => {
    const first = scene('first', { durationSeconds: 5 });
    const second = scene('second', { durationSeconds: 10 });

    expect(deriveStudioReadiness(project([first, second], { targetDurationSeconds: 12 }))).toMatchObject({
      durationTotalSeconds: 15,
      durationDeltaSeconds: 3,
    });
  });

  it('counts a duplicated shot once in the total, as the canonical order does', () => {
    const first = scene('first', { durationSeconds: 5 });
    const second = scene('second', { durationSeconds: 10 });
    const duplicated = project([first, second], { sceneOrder: ['first', 'second', 'first'] });

    expect(deriveStudioReadiness(duplicated)).toMatchObject({
      totalSceneCount: 2,
      durationTotalSeconds: 15,
    });
  });

  it.each(['generated', 'needs_selection'] as const)(
    'keeps a %s scene out of single-scene review when its canonical visual prompt is blank',
    (status) => {
      expect(canOpenSingleSceneReview(status, '   ')).toBe(false);
    }
  );

  it('keeps nonblank generated scenes eligible for explicit regeneration', () => {
    expect(canOpenSingleSceneReview('generated', 'A revised cinematic frame')).toBe(true);
  });
});
