/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { decodeStudioProjectManifestV2 } from '@/process/services/creative-studio/service/briefFile';

const corpusRoot =
  process.env.STUDIO_LEGACY_CORPUS_DIR ??
  path.join(homedir(), 'weprompt-archived-projects', '2026-08-27-pre-migration');
const corpusIsAvailable = existsSync(corpusRoot);

describe.skipIf(!corpusIsAvailable)('Creative Studio pre-migration manifest corpus', () => {
  it('decodes all six archived projects without rewriting their historical records', () => {
    const projectDirectories = readdirSync(corpusRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
    expect(projectDirectories).toHaveLength(6);

    for (const projectDirectory of projectDirectories) {
      const root = path.join(corpusRoot, projectDirectory);
      const manifest = JSON.parse(readFileSync(path.join(root, 'project.json'), 'utf8')) as unknown;
      const brief = readFileSync(path.join(root, 'brief.md'), 'utf8');
      expect(decodeStudioProjectManifestV2(manifest, brief), projectDirectory).not.toBeNull();
    }
  });
});
