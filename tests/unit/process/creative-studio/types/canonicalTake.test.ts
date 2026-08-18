/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioAsset, StudioAssetV2, StudioShot, StudioScene } from '@/common/types/project/creativeStudioTypes';
import {
  isCanonicalStudioGeneratedTake,
  isCanonicalStudioGeneratedTakeV2,
} from '@/common/types/project/creativeStudioCanonicalTake';

const makeScene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene_1',
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A cinematic studio product reveal',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 4,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: ['asset_1'],
  jobIds: [],
  reviewState: 'draft',
  ...overrides,
});

const makeAsset = (overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id: 'asset_1',
  projectId: 'project_1',
  sceneId: 'scene_1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
  byteSize: 1,
  sha256: '1'.repeat(64),
  createdAt: '2026-08-06T00:00:00.000Z',
  ...overrides,
});

describe('isCanonicalStudioGeneratedTake', () => {
  it.each([
    {
      label: 'accepts a matching generated take',
      asset: makeAsset(),
      projectId: 'project_1',
      scene: makeScene(),
      expected: true,
    },
    {
      label: 'rejects a take from another project',
      asset: makeAsset({ projectId: 'project_2' }),
      projectId: 'project_1',
      scene: makeScene(),
      expected: false,
    },
    {
      label: 'rejects a take from another scene',
      asset: makeAsset({ sceneId: 'scene_2' }),
      projectId: 'project_1',
      scene: makeScene(),
      expected: false,
    },
    {
      label: 'rejects a take with a different media kind',
      asset: makeAsset({ mediaKind: 'video', mimeType: 'video/mp4', durationSeconds: 4 }),
      projectId: 'project_1',
      scene: makeScene(),
      expected: false,
    },
    {
      label: 'rejects an imported asset',
      asset: makeAsset({ managedAsset: { collection: 'imports', fileName: 'asset_1.png' } }),
      projectId: 'project_1',
      scene: makeScene(),
      expected: false,
    },
    {
      label: 'rejects a thumbnail asset',
      asset: makeAsset({ managedAsset: { collection: 'thumbnails', fileName: 'asset_1.png' } }),
      projectId: 'project_1',
      scene: makeScene(),
      expected: false,
    },
    {
      label: 'rejects a take absent from the scene asset index',
      asset: makeAsset(),
      projectId: 'project_1',
      scene: makeScene({ assetIds: [] }),
      expected: false,
    },
  ])('$label', ({ asset, projectId, scene, expected }) => {
    expect(isCanonicalStudioGeneratedTake(asset, projectId, scene)).toBe(expected);
  });
});

const makeShot = (overrides: Partial<StudioShot> = {}): StudioShot => ({
  id: 'clip_1',
  line: 'A product reveal',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 1,
  referenceAssetId: null,
  selectedTakeId: null,
  assetIds: ['asset_1'],
  jobIds: [],
  ...overrides,
});

const makeAssetV2 = (overrides: Partial<StudioAssetV2> = {}): StudioAssetV2 => ({
  id: 'asset_1',
  projectId: 'project_1',
  shotId: 'clip_1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
  byteSize: 1,
  sha256: '1'.repeat(64),
  createdAt: '2026-08-17T00:00:00.000Z',
  ...overrides,
});

describe('isCanonicalStudioGeneratedTakeV2', () => {
  it.each([
    {
      label: 'accepts a matching generated take',
      asset: makeAssetV2(),
      projectId: 'project_1',
      shot: makeShot(),
      expected: true,
    },
    {
      label: 'rejects a take from another project',
      asset: makeAssetV2({ projectId: 'project_2' }),
      projectId: 'project_1',
      shot: makeShot(),
      expected: false,
    },
    {
      label: 'rejects a take from another shot',
      asset: makeAssetV2({ shotId: 'clip_2' }),
      projectId: 'project_1',
      shot: makeShot(),
      expected: false,
    },
    {
      label: 'rejects a take with a different media kind',
      asset: makeAssetV2({ mediaKind: 'video', mimeType: 'video/mp4', durationSeconds: 4 }),
      projectId: 'project_1',
      shot: makeShot(),
      expected: false,
    },
    {
      label: 'rejects an imported asset',
      asset: makeAssetV2({ managedAsset: { collection: 'imports', fileName: 'asset_1.png' } }),
      projectId: 'project_1',
      shot: makeShot(),
      expected: false,
    },
    {
      label: 'rejects a take absent from the shot asset index',
      asset: makeAssetV2(),
      projectId: 'project_1',
      shot: makeShot({ assetIds: [] }),
      expected: false,
    },
  ])('$label', ({ asset, projectId, shot, expected }) => {
    expect(isCanonicalStudioGeneratedTakeV2(asset, projectId, shot)).toBe(expected);
  });
});
