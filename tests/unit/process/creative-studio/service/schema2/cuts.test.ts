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
  StudioShot,
  StudioCutClipV2,
  StudioCutV2,
  StudioProjectV2,
  StudioBeat,
} from '@/common/types/project/creativeStudioTypes';
import {
  reconcileStudioCutsV2,
  studioClipHasCutDependencyV2,
} from '@/process/services/creative-studio/service/schema2/cuts';
import { validateStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/validation';

const timestamp = '2026-08-17T00:00:00.000Z';

const makeShot = (id: string, selectedAssetId: string): StudioShot => ({
  id,
  shotPrompt: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId,
  assetIds: [selectedAssetId],
  jobIds: [],
});

const makeBeat = (id: string, clipOrder: string[]): StudioBeat => ({
  id,
  title: '',
  storyLine: '',
  visualPrompt: '',
  clipOrder,
});

const makeAsset = (id: string, clipId: string, durationSeconds = 10): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  clipId,
  mediaKind: 'video',
  mimeType: 'video/mp4',
  managedAsset: { collection: 'assets', fileName: `${id}.mp4` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  durationSeconds,
  createdAt: timestamp,
});

const makeCutClip = (id: string, clipId: string, assetId: string): StudioCutClipV2 => ({
  id,
  clipId,
  assetId,
  sourceInSeconds: null,
  sourceOutSeconds: null,
  crop: null,
  filters: [],
});

const makeCut = (
  orderMode: StudioCutV2['orderMode'],
  clipOrder: string[],
  clips: Record<string, StudioCutClipV2>
): StudioCutV2 => ({
  id: 'cut_1',
  name: 'Cut One',
  orderMode,
  clipOrder,
  clips,
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
  sectionOrder: ['section_1', 'section_2'],
  sections: {
    section_1: makeBeat('section_1', ['clip_1']),
    section_2: makeBeat('section_2', ['clip_2']),
  },
  clips: {
    clip_1: makeShot('clip_1', 'asset_1'),
    clip_2: makeShot('clip_2', 'asset_2'),
  },
  shelf: [],
  cuts: {},
  activeCutId: null,
  assets: {
    asset_1: makeAsset('asset_1', 'clip_1'),
    asset_2: makeAsset('asset_2', 'clip_2'),
  },
  jobs: {},
  routing: { image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe('reconcileStudioCutsV2', () => {
  it('orders storyboard cut entries by active Section-to-Clip order', () => {
    const project = makeProject();
    project.sectionOrder = ['section_2', 'section_1'];
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1', 'cut_clip_2'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
      cut_clip_2: makeCutClip('cut_clip_2', 'clip_2', 'asset_2'),
    });

    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clipOrder).toEqual(['cut_clip_2', 'cut_clip_1']);
    expect(validateStudioProjectV2(next)).toBe(true);
  });

  it('creates a pristine storyboard entry for a newly selected active clip', () => {
    const project = makeProject();
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
    });

    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clipOrder).toEqual(['cut_clip_1', 'clip_clip_2']);
    expect(next.cuts.cut_1!.clips.clip_clip_2).toEqual(makeCutClip('clip_clip_2', 'clip_2', 'asset_2'));
  });

  it('creates a dormant storyboard entry when selection changes on a parked clip', () => {
    const project = makeProject();
    project.sectionOrder = ['section_1'];
    project.shelf = [{ kind: 'section', sectionId: 'section_2' }];
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
    });

    const next = reconcileStudioCutsV2(project, { kind: 'selection', clipId: 'clip_2' });

    expect(next.cuts.cut_1!.clipOrder).toEqual(['cut_clip_1', 'clip_clip_2']);
    expect(next.cuts.cut_1!.clips.clip_clip_2).toEqual(makeCutClip('clip_clip_2', 'clip_2', 'asset_2'));
  });

  it('preserves a deliberate cut take and trims during structural reconciliation', () => {
    const project = makeProject();
    project.assets.asset_1_alt = makeAsset('asset_1_alt', 'clip_1', 12);
    project.clips.clip_1!.assetIds.push('asset_1_alt');
    const deliberate = {
      ...makeCutClip('cut_clip_1', 'clip_1', 'asset_1_alt'),
      sourceInSeconds: 2,
      sourceOutSeconds: 8,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      filters: [{ id: 'exposure' as const, amount: 0.2 }],
    };
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1'], { cut_clip_1: deliberate });

    const next = reconcileStudioCutsV2(project, { kind: 'structure' });

    expect(next.cuts.cut_1!.clips.cut_clip_1).toEqual(deliberate);
    expect(next.cuts.cut_1!.clips.clip_clip_2).toEqual(makeCutClip('clip_clip_2', 'clip_2', 'asset_2'));
  });

  it('retargets only the selected clip during scoped selection reconciliation', () => {
    const project = makeProject();
    project.assets.asset_1_alt = makeAsset('asset_1_alt', 'clip_1', 6);
    project.assets.asset_2_alt = makeAsset('asset_2_alt', 'clip_2', 6);
    project.clips.clip_1!.assetIds.push('asset_1_alt');
    project.clips.clip_2!.assetIds.push('asset_2_alt');
    project.clips.clip_1!.selectedAssetId = 'asset_1_alt';
    project.clips.clip_2!.selectedAssetId = 'asset_2_alt';
    project.cuts.cut_1 = makeCut('manual', ['cut_clip_1', 'cut_clip_2'], {
      cut_clip_1: {
        ...makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
        sourceInSeconds: 4,
        sourceOutSeconds: 9,
      },
      cut_clip_2: makeCutClip('cut_clip_2', 'clip_2', 'asset_2'),
    });

    const next = reconcileStudioCutsV2(project, { kind: 'selection', clipId: 'clip_1' });

    expect(next.cuts.cut_1!.clips.cut_clip_1).toMatchObject({ assetId: 'asset_1_alt', sourceOutSeconds: 6 });
    expect(next.cuts.cut_1!.clips.cut_clip_2!.assetId).toBe('asset_2');
  });

  it('keeps parked-section decisions dormant after active storyboard entries', () => {
    const project = makeProject();
    const dormant = {
      ...makeCutClip('cut_clip_2', 'clip_2', 'asset_2'),
      sourceInSeconds: 2,
      sourceOutSeconds: 8,
      filters: [{ id: 'contrast' as const, amount: 0.25 }],
    };
    project.sectionOrder = ['section_1'];
    project.shelf = [{ kind: 'section', sectionId: 'section_2' }];
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_2', 'cut_clip_1'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
      cut_clip_2: dormant,
    });

    const parked = reconcileStudioCutsV2(project);

    expect(parked.cuts.cut_1!.clipOrder).toEqual(['cut_clip_1', 'cut_clip_2']);
    expect(parked.cuts.cut_1!.clips.cut_clip_2).toEqual(dormant);
  });

  it('restores a dormant decision to its active storyboard position', () => {
    const project = makeProject();
    const dormant = {
      ...makeCutClip('cut_clip_2', 'clip_2', 'asset_2'),
      sourceInSeconds: 2,
      sourceOutSeconds: 8,
      filters: [{ id: 'contrast' as const, amount: 0.25 }],
    };
    project.sectionOrder = ['section_2', 'section_1'];
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1', 'cut_clip_2'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
      cut_clip_2: dormant,
    });

    const restored = reconcileStudioCutsV2(project);

    expect(restored.cuts.cut_1!.clipOrder).toEqual(['cut_clip_2', 'cut_clip_1']);
    expect(restored.cuts.cut_1!.clips.cut_clip_2).toEqual(dormant);
  });

  it('retains the complete persisted manual order including dormant entries', () => {
    const project = makeProject();
    project.sectionOrder = ['section_1'];
    project.shelf = [{ kind: 'section', sectionId: 'section_2' }];
    project.cuts.cut_1 = makeCut('manual', ['cut_clip_2', 'cut_clip_1'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
      cut_clip_2: makeCutClip('cut_clip_2', 'clip_2', 'asset_2'),
    });

    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clipOrder).toEqual(['cut_clip_2', 'cut_clip_1']);
    expect(Object.keys(next.cuts.cut_1!.clips)).toHaveLength(2);
  });

  it('does not create an entry for a newly selected clip in manual mode', () => {
    const project = makeProject();
    project.cuts.cut_1 = makeCut('manual', ['cut_clip_1'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
    });

    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clipOrder).toEqual(['cut_clip_1']);
    expect(Object.values(next.cuts.cut_1!.clips).some((cutClip) => cutClip.clipId === 'clip_2')).toBe(false);
  });

  it('updates the selected asset and clamps an oversized out trim', () => {
    const project = makeProject();
    project.assets.asset_1_next = makeAsset('asset_1_next', 'clip_1', 6);
    project.clips.clip_1!.assetIds.push('asset_1_next');
    project.clips.clip_1!.selectedAssetId = 'asset_1_next';
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1'], {
      cut_clip_1: {
        ...makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
        sourceInSeconds: 4,
        sourceOutSeconds: 9,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        filters: [{ id: 'contrast', amount: 0.25 }],
      },
    });

    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clips.cut_clip_1).toMatchObject({
      assetId: 'asset_1_next',
      sourceInSeconds: 4,
      sourceOutSeconds: 6,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      filters: [{ id: 'contrast', amount: 0.25 }],
    });
  });

  it('allocates a collision-safe storyboard placement identity', () => {
    const project = makeProject();
    project.cuts.cut_1 = makeCut('storyboard', ['clip_clip_2'], {
      clip_clip_2: makeCutClip('clip_clip_2', 'clip_1', 'asset_1'),
    });

    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clipOrder).toEqual(['clip_clip_2', 'clip_clip_2_2']);
    expect(next.cuts.cut_1!.clips.clip_clip_2_2).toMatchObject({ clipId: 'clip_2', assetId: 'asset_2' });
  });

  it.each(['constructor', 'toString', '__proto__'])('preserves own magic cut identities named %s', (id) => {
    const project = makeProject();
    project.cuts = Object.fromEntries([
      [
        id,
        {
          ...makeCut('manual', [id], Object.fromEntries([[id, makeCutClip(id, 'clip_1', 'asset_1')]])),
          id,
        },
      ],
    ]);
    project.activeCutId = id;

    const next = reconcileStudioCutsV2(project);

    expect(Object.hasOwn(next.cuts, id)).toBe(true);
    expect(Object.hasOwn(next.cuts[id]!.clips, id)).toBe(true);
    expect(validateStudioProjectV2(next)).toBe(true);
  });

  it('clears both trims when the in point reaches the selected asset duration', () => {
    const project = makeProject();
    project.assets.asset_1_next = makeAsset('asset_1_next', 'clip_1', 4);
    project.clips.clip_1!.assetIds.push('asset_1_next');
    project.clips.clip_1!.selectedAssetId = 'asset_1_next';
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1'], {
      cut_clip_1: {
        ...makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
        sourceInSeconds: 4,
        sourceOutSeconds: 9,
      },
    });

    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clips.cut_clip_1).toMatchObject({
      assetId: 'asset_1_next',
      sourceInSeconds: null,
      sourceOutSeconds: null,
    });
  });

  it('does not mutate the source project or nested cut decisions', () => {
    const project = makeProject();
    project.cuts.cut_1 = makeCut('storyboard', ['cut_clip_1'], {
      cut_clip_1: {
        ...makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
        crop: { x: 0, y: 0, width: 1, height: 1 },
        filters: [{ id: 'exposure', amount: 0.25 }],
      },
    });
    const before = structuredClone(project);

    const next = reconcileStudioCutsV2(project);
    next.cuts.cut_1!.clips.cut_clip_1!.filters[0]!.amount = 0.5;

    expect(project).toEqual(before);
    expect(project.cuts.cut_1!.clips.cut_clip_1!.filters[0]!.amount).toBe(0.25);
  });

  it('does not invoke inherited cut-filter array methods', () => {
    const project = makeProject();
    const filters = [{ id: 'exposure' as const, amount: 0.25 }];
    Object.setPrototypeOf(filters, { map: null, [Symbol.iterator]: null });
    project.cuts.cut_1 = makeCut('manual', ['cut_clip_1'], {
      cut_clip_1: { ...makeCutClip('cut_clip_1', 'clip_1', 'asset_1'), filters },
    });

    expect(validateStudioProjectV2(project)).toBe(true);
    const next = reconcileStudioCutsV2(project);

    expect(next.cuts.cut_1!.clips.cut_clip_1!.filters).toEqual([{ id: 'exposure', amount: 0.25 }]);
  });
});

describe('studioClipHasCutDependencyV2', () => {
  it('reports a dependency from any cut, including a dormant clip entry', () => {
    const project = makeProject();
    project.sectionOrder = ['section_1'];
    project.shelf = [{ kind: 'section', sectionId: 'section_2' }];
    project.cuts.cut_1 = makeCut('manual', ['cut_clip_2'], {
      cut_clip_2: makeCutClip('cut_clip_2', 'clip_2', 'asset_2'),
    });

    expect(studioClipHasCutDependencyV2(project, 'clip_2')).toBe(true);
  });

  it('allows deletion when no cut entry names the clip', () => {
    const project = makeProject();
    project.cuts.cut_1 = makeCut('manual', ['cut_clip_1'], {
      cut_clip_1: makeCutClip('cut_clip_1', 'clip_1', 'asset_1'),
    });

    expect(studioClipHasCutDependencyV2(project, 'clip_2')).toBe(false);
  });
});
