/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioAssetV2, StudioShot } from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import { STUDIO_MANAGED_ASSET_COLLECTIONS_V2 } from '@/common/types/project/creativeStudioManagedAssetCollections';

const makeShot = (overrides: Partial<StudioShot> = {}): StudioShot => ({
  id: 'clip_1',
  line: 'A product reveal',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 4,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  seedStillId: null,
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
      label: 'accepts a generated video take for an all-video Shot',
      asset: makeAssetV2({ mediaKind: 'video', mimeType: 'video/mp4', durationSeconds: 4 }),
      projectId: 'project_1',
      shot: makeShot(),
      expected: true,
    },
    {
      label: 'rejects generated audio as a take',
      asset: makeAssetV2({ mediaKind: 'audio', mimeType: 'audio/wav', durationSeconds: 4 }),
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

describe('managed asset collection contracts', () => {
  it('freezes the Beat/Shot managed collection set', () => {
    expect([...STUDIO_MANAGED_ASSET_COLLECTIONS_V2]).toEqual(['assets', 'imports', 'thumbnails', 'conditioningFrames']);
    expect(STUDIO_MANAGED_ASSET_COLLECTIONS_V2.has('references' as never)).toBe(false);
  });
});
