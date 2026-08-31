/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyStudioProjectV2 } from '@process/services/creative-studio/service/schema2';
import {
  createStudioProjectManifestV2,
  decodeStudioProjectManifestV2,
  STUDIO_BRIEF_METADATA_SCHEMA_VERSION,
  studioBriefSha256,
} from '@process/services/creative-studio/service/briefFile';

const project = () =>
  createEmptyStudioProjectV2(
    {
      name: 'Brief authority',
      brief: 'The original Brief.',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'project_brief_file',
    '2026-08-22T00:00:00.000Z'
  );

const projectWithShot = () => {
  const empty = project();
  return {
    ...empty,
    beatOrder: ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        story: 'A quiet room comes into view.',
        targetSeconds: null,
        shotOrder: ['shot_1'],
      },
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        shootingScript: 'The camera crosses the room.',
        durationSeconds: 4,
        trimInSeconds: null,
        trimOutSeconds: null,
        chainBreak: 'none' as const,
        referenceBinding: { status: 'unassigned' as const, characterReferenceIds: [], backgroundReferenceId: null },
        seedStillId: null,
        dismissedSeedStillIds: [],
        boardAssetId: null,
        supersededBoardAssetIds: [],
        videoAssetId: null,
        supersededVideoAssetIds: [],
        assetIds: [],
        jobIds: [],
      },
    },
  };
};

const projectWithUndoHistory = () => {
  const withShot = projectWithShot();
  const { assetIds: _assetIds, jobIds: _jobIds, ...shotBefore } = withShot.shots.shot_1;
  return {
    ...withShot,
    undoHistory: [
      {
        id: 'undo_1',
        sourceRevision: 1,
        label: 'Shot edits',
        patches: [
          {
            kind: 'shot_fields' as const,
            shotId: 'shot_1',
            before: shotBefore,
            beforeBeatId: 'beat_1',
            beforeIndex: 0,
            afterDigest: 'a'.repeat(64),
          },
        ],
      },
    ],
  };
};

describe('Creative Studio brief file manifest', () => {
  it('persists only digest metadata while hydrating the runtime prose from brief.md', () => {
    const manifest = createStudioProjectManifestV2(project());

    expect(manifest).not.toHaveProperty('brief');
    expect(manifest.briefFile).toEqual({
      schemaVersion: STUDIO_BRIEF_METADATA_SCHEMA_VERSION,
      sha256: studioBriefSha256('The original Brief.'),
    });
    expect(decodeStudioProjectManifestV2(manifest, 'An outside edit.')).toEqual({
      project: { ...project(), brief: 'An outside edit.' },
      synchronized: false,
    });
  });

  it('rejects an inline-Brief project instead of treating it as a migration source', () => {
    expect(decodeStudioProjectManifestV2(project(), null)).toBeNull();
    expect(decodeStudioProjectManifestV2(project(), 'An outside edit.')).toBeNull();
  });

  it('opens a previous-build manifest by defaulting only its absent dismissed seed list', () => {
    const current = projectWithShot();
    const manifest = createStudioProjectManifestV2(current);
    const previousBuildManifest = structuredClone(manifest);
    delete (previousBuildManifest.shots.shot_1 as Partial<(typeof current.shots)['shot_1']>).dismissedSeedStillIds;

    expect(decodeStudioProjectManifestV2(previousBuildManifest, current.brief)).toEqual({
      project: current,
      synchronized: true,
    });
  });

  it('opens a previous-build manifest whose undo history holds a legacy Shot snapshot', () => {
    // `SHOT_BEFORE_KEYS` derives from `SHOT_KEYS`, so adding a required Shot field also tightened
    // undo-patch validation. Normalizing only the live `shots` map leaves every project that has
    // ever been edited unopenable.
    const current = projectWithUndoHistory();
    const manifest = createStudioProjectManifestV2(current);
    const previousBuildManifest = structuredClone(manifest);
    delete (previousBuildManifest.shots.shot_1 as Record<string, unknown>).dismissedSeedStillIds;
    delete (previousBuildManifest.undoHistory[0]!.patches[0]! as { before: Record<string, unknown> }).before
      .dismissedSeedStillIds;

    expect(decodeStudioProjectManifestV2(previousBuildManifest, current.brief)).toEqual({
      project: current,
      synchronized: true,
    });
  });

  it('still rejects a malformed dismissed seed list instead of normalizing it', () => {
    const current = projectWithShot();
    const manifest = createStudioProjectManifestV2(current);

    expect(
      decodeStudioProjectManifestV2(
        {
          ...manifest,
          shots: { ...manifest.shots, shot_1: { ...manifest.shots.shot_1, dismissedSeedStillIds: null } },
        },
        current.brief
      )
    ).toBeNull();
  });

  it('fails closed on missing current prose, malformed metadata, and an oversized hydrated Brief', () => {
    const manifest = createStudioProjectManifestV2(project());

    expect(decodeStudioProjectManifestV2(manifest, null)).toBeNull();
    expect(
      decodeStudioProjectManifestV2({ ...manifest, briefFile: { schemaVersion: 1, sha256: 'not-a-digest' } }, 'x')
    ).toBeNull();
    expect(decodeStudioProjectManifestV2(manifest, 'x'.repeat(16 * 1024 + 1))).toBeNull();
  });
});
