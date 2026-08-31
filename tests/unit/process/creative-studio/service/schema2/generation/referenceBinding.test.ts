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
  StudioProjectReferenceV2,
  StudioProjectV2,
  StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import { resolveStudioReferenceBindingV2 } from '@/process/services/creative-studio/service/schema2/generation/referenceBinding';

const timestamp = '2026-08-24T00:00:00.000Z';

const shot = (overrides: Partial<StudioShot> = {}): StudioShot => ({
  id: 'shot_reunion',
  shootingScript: 'Ming and Mei sit beneath the red awning.',
  durationSeconds: 5,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: {
    status: 'ready',
    characterReferenceIds: ['reference_ming', 'reference_mei'],
    backgroundReferenceId: 'reference_dai_pai_dong',
  },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const reference = (
  id: string,
  kind: StudioProjectReferenceV2['kind'],
  approvedAssetId: string | null
): StudioProjectReferenceV2 => ({
  id,
  kind,
  label: id,
  prompt: `${id} reference prompt`,
  approvedAssetId,
  supersededAssetIds: [],
  jobIds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
});

const asset = (id: string, projectReferenceId: string, sha256: string): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId: null,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 100,
  sha256,
  projectReferenceId,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
  createdAt: timestamp,
});

const project = (): StudioProjectV2 => {
  const value = createEmptyStudioProjectV2(
    {
      name: 'Reunion',
      brief: 'Ming and Mei reunite at a dai pai dong.',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'project_1',
    timestamp
  );
  value.referencePlanStatus = 'planned';
  value.referenceOrder = ['reference_ming', 'reference_mei', 'reference_dai_pai_dong'];
  value.references = {
    reference_ming: reference('reference_ming', 'character', 'asset_ming'),
    reference_mei: reference('reference_mei', 'character', 'asset_mei'),
    reference_dai_pai_dong: reference('reference_dai_pai_dong', 'background', 'asset_dai_pai_dong'),
  };
  value.shots.shot_reunion = shot();
  value.assets = {
    asset_ming: asset('asset_ming', 'reference_ming', 'a'.repeat(64)),
    asset_mei: asset('asset_mei', 'reference_mei', 'b'.repeat(64)),
    asset_dai_pai_dong: asset('asset_dai_pai_dong', 'reference_dai_pai_dong', 'c'.repeat(64)),
  };
  return value;
};

const resolve = (value: StudioProjectV2, maxConditioningImages = 3) =>
  resolveStudioReferenceBindingV2({ project: value, shotId: 'shot_reunion', maxConditioningImages });

describe('exact persisted Shot reference binding resolution', () => {
  it('resolves characters in persisted binding order, followed by the one persisted background', () => {
    expect(resolve(project())).toEqual({
      ok: true,
      referenceInputs: [
        { referenceId: 'reference_ming', kind: 'character', assetId: 'asset_ming', sha256: 'a'.repeat(64) },
        { referenceId: 'reference_mei', kind: 'character', assetId: 'asset_mei', sha256: 'b'.repeat(64) },
        {
          referenceId: 'reference_dai_pai_dong',
          kind: 'background',
          assetId: 'asset_dai_pai_dong',
          sha256: 'c'.repeat(64),
        },
      ],
    });
  });

  it('treats an explicitly ready empty binding as the exact no-reference decision', () => {
    const value = project();
    value.shots.shot_reunion!.referenceBinding = {
      status: 'ready',
      characterReferenceIds: [],
      backgroundReferenceId: null,
    };
    expect(resolve(value, 0)).toEqual({ ok: true, referenceInputs: [] });
  });

  it('refuses an unassigned Shot and reports the exact Shot identity', () => {
    const value = project();
    value.shots.shot_reunion!.referenceBinding = {
      status: 'unassigned',
      characterReferenceIds: [],
      backgroundReferenceId: null,
    };
    expect(resolve(value)).toEqual({ ok: false, shotId: 'shot_reunion', reason: 'unassigned' });
  });

  it('refuses unknown, wrong-kind, and unapproved semantic references', () => {
    const unknown = project();
    unknown.shots.shot_reunion!.referenceBinding.characterReferenceIds = ['reference_unknown'];
    expect(resolve(unknown)).toEqual({ ok: false, shotId: 'shot_reunion', reason: 'unknown_reference' });

    const wrongKind = project();
    wrongKind.references.reference_ming!.kind = 'background';
    expect(resolve(wrongKind)).toEqual({ ok: false, shotId: 'shot_reunion', reason: 'wrong_kind' });

    const unapproved = project();
    unapproved.references.reference_mei!.approvedAssetId = null;
    expect(resolve(unapproved)).toEqual({ ok: false, shotId: 'shot_reunion', reason: 'unapproved_reference' });
  });

  it('refuses missing, cross-reference, Shot-owned, non-image, and forged imported approved assets', () => {
    const cases: StudioProjectV2[] = [];
    const missing = project();
    delete missing.assets.asset_ming;
    cases.push(missing);
    const crossReference = project();
    crossReference.assets.asset_ming!.projectReferenceId = 'reference_mei';
    cases.push(crossReference);
    const shotOwned = project();
    shotOwned.assets.asset_ming!.shotId = 'shot_reunion';
    cases.push(shotOwned);
    const nonImage = project();
    nonImage.assets.asset_ming!.mediaKind = 'video';
    cases.push(nonImage);
    const forgedImport = project();
    forgedImport.assets.asset_ming!.managedAsset.collection = 'imports';
    forgedImport.assets.asset_ming!.producerJobId = 'forged_producer';
    cases.push(forgedImport);

    for (const value of cases) {
      expect(resolve(value)).toEqual({ ok: false, shotId: 'shot_reunion', reason: 'missing_asset' });
    }
  });

  it('freezes a canonical human import through the exact persisted Shot binding', () => {
    const value = project();
    value.assets.asset_ming!.managedAsset.collection = 'imports';

    const result = resolve(value);
    expect(result).toEqual({
      ok: true,
      referenceInputs: [
        { referenceId: 'reference_ming', kind: 'character', assetId: 'asset_ming', sha256: 'a'.repeat(64) },
        { referenceId: 'reference_mei', kind: 'character', assetId: 'asset_mei', sha256: 'b'.repeat(64) },
        {
          referenceId: 'reference_dai_pai_dong',
          kind: 'background',
          assetId: 'asset_dai_pai_dong',
          sha256: 'c'.repeat(64),
        },
      ],
    });
  });

  it('uses only the current canonical asset, not a superseded asset', () => {
    const value = project();
    value.references.reference_ming!.supersededAssetIds = ['asset_ming_old'];
    value.assets.asset_ming_old = asset('asset_ming_old', 'reference_ming', 'e'.repeat(64));

    const result = resolve(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referenceInputs[0]).toMatchObject({ assetId: 'asset_ming', sha256: 'a'.repeat(64) });
    expect(result.referenceInputs.map((input) => input.assetId)).not.toContain('asset_ming_old');
  });

  it('enforces route capacity before any provider or pricing work', () => {
    expect(resolve(project(), 2)).toEqual({
      ok: false,
      shotId: 'shot_reunion',
      reason: 'capacity_exceeded',
    });
    expect(resolve(project(), -1)).toEqual({
      ok: false,
      shotId: 'shot_reunion',
      reason: 'capacity_exceeded',
    });
  });

  it('fails closed for an unknown Shot identity', () => {
    expect(
      resolveStudioReferenceBindingV2({ project: project(), shotId: 'shot_missing', maxConditioningImages: 3 })
    ).toEqual({ ok: false, shotId: 'shot_missing', reason: 'unknown_reference' });
  });
});
