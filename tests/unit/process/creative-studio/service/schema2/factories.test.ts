/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  createEmptyStudioProjectV2,
  validateStudioProjectV2,
} from '@/process/services/creative-studio/service/schema2';

describe('createEmptyStudioProjectV2', () => {
  it('creates the exact empty schema-2 project state', () => {
    const project = createEmptyStudioProjectV2(
      {
        name: '  Project One  ',
        brief: 'A launch film',
        forgeProjectId: 'forge_1',
        aspectRatio: '16:9',
        targetDurationSeconds: 30,
        resolution: '1080p',
      },
      'project_1',
      '2026-08-17T00:00:00.000Z'
    );

    expect(project).toEqual({
      schemaVersion: 2,
      revision: 1,
      id: 'project_1',
      name: 'Project One',
      brief: 'A launch film',
      rules: [],
      ruleListUndo: null,
      forgeProjectId: 'forge_1',
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
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    });
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('omits an absent Forge project identity instead of persisting undefined', () => {
    const project = createEmptyStudioProjectV2(
      {
        name: 'Project One',
        brief: '',
        aspectRatio: '9:16',
        targetDurationSeconds: 15,
        resolution: '720p',
      },
      'project_1',
      '2026-08-17T00:00:00.000Z'
    );

    expect(Object.hasOwn(project, 'forgeProjectId')).toBe(false);
  });

  it('throws TypeError instead of constructing an invalid project', () => {
    expect(() =>
      createEmptyStudioProjectV2(
        {
          name: '   ',
          brief: '',
          aspectRatio: '9:16',
          targetDurationSeconds: 15,
          resolution: '720p',
        },
        'project_1',
        '2026-08-17T00:00:00.000Z'
      )
    ).toThrow(TypeError);
  });
});
