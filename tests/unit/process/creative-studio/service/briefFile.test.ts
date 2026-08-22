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

describe('Creative Studio brief file manifest', () => {
  it('persists only digest metadata while hydrating the runtime prose from brief.md', () => {
    const manifest = createStudioProjectManifestV2(project());

    expect(manifest).not.toHaveProperty('brief');
    expect(manifest.briefFile).toEqual({ schemaVersion: 1, sha256: studioBriefSha256('The original Brief.') });
    expect(decodeStudioProjectManifestV2(manifest, 'An outside edit.')).toEqual({
      kind: 'brief_file',
      project: { ...project(), brief: 'An outside edit.' },
      synchronized: false,
    });
  });

  it('accepts an exact legacy manifest for migration and gives a present file authority over its cache', () => {
    expect(decodeStudioProjectManifestV2(project(), null)).toEqual({
      kind: 'legacy',
      project: project(),
      synchronized: false,
    });
    expect(decodeStudioProjectManifestV2(project(), 'An outside edit.')).toMatchObject({
      kind: 'legacy',
      project: { brief: 'An outside edit.' },
      synchronized: false,
    });
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
