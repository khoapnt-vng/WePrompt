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
  createEmptyStudioProjectV3,
  validateStudioProjectV2,
  validateStudioProjectV3,
} from '@/process/services/creative-studio/service/schema2';

describe('createEmptyStudioProjectV2', () => {
  it('creates the exact empty schema-5 project state with the hidden Board style default', () => {
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
      schemaVersion: 5,
      revision: 1,
      id: 'project_1',
      name: 'Project One',
      brief: 'A launch film',
      rules: [],
      forgeProjectId: 'forge_1',
      briefConversationId: null,
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
      boardStyle: 'grey_tone',
      beatOrder: [],
      beats: {},
      shots: {},
      referencePlanStatus: 'unplanned',
      referenceOrder: [],
      references: {},
      bin: [],
      bedAssetId: null,
      spendPolicy: null,
      spendAuthorizations: [],
      frameExtractions: {},
      undoHistory: [],
      assets: {},
      jobs: {},
      imageRouteId: null,
      videoRouteId: null,
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

describe('createEmptyStudioProjectV3', () => {
  it('creates the exact empty schema-6 Pilot state without film fields', () => {
    const project = createEmptyStudioProjectV3(
      {
        name: '  Project Four  ',
        brief: 'One standalone photograph',
        forgeProjectId: 'forge_4',
      },
      'project_4',
      '2026-08-30T00:00:00.000Z'
    );

    expect(project).toEqual({
      schemaVersion: 6,
      revision: 1,
      authoringRevision: 1,
      id: 'project_4',
      name: 'Project Four',
      brief: 'One standalone photograph',
      rules: [],
      forgeProjectId: 'forge_4',
      briefConversationId: null,
      pieceOrder: [],
      pieces: {},
      spendPolicy: null,
      spendAuthorizations: [],
      undoHistory: [],
      assets: {},
      jobs: {},
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });
    expect(validateStudioProjectV3(project)).toBe(true);
    expect(validateStudioProjectV2(project)).toBe(false);
    expect(Object.hasOwn(project, 'beats')).toBe(false);
    expect(Object.hasOwn(project, 'shots')).toBe(false);
    expect(Object.hasOwn(project, 'aspectRatio')).toBe(false);
  });

  it('persists absent optional integrations as required nulls', () => {
    const project = createEmptyStudioProjectV3(
      { name: 'Project Four', brief: '' },
      'project_4',
      '2026-08-30T00:00:00.000Z'
    );

    expect(project.forgeProjectId).toBeNull();
    expect(project.briefConversationId).toBeNull();
    expect(Object.hasOwn(project, 'forgeProjectId')).toBe(true);
    expect(Object.hasOwn(project, 'briefConversationId')).toBe(true);
  });

  it('rejects invalid or film-shaped creation inputs instead of defaulting them', () => {
    expect(() =>
      createEmptyStudioProjectV3({ name: '   ', brief: '' }, 'project_4', '2026-08-30T00:00:00.000Z')
    ).toThrow(TypeError);
    expect(() =>
      createEmptyStudioProjectV3(
        {
          name: 'Project Four',
          brief: '',
          aspectRatio: '16:9',
        } as never,
        'project_4',
        '2026-08-30T00:00:00.000Z'
      )
    ).toThrow(TypeError);
    expect(() =>
      createEmptyStudioProjectV3(
        { name: 'Project Four', brief: '', forgeProjectId: null } as never,
        'project_4',
        '2026-08-30T00:00:00.000Z'
      )
    ).toThrow(TypeError);
  });

  it('rejects non-enumerable fields, accessors, and Proxy inputs without invoking input code', () => {
    const nonEnumerable = { name: 'Project Four', brief: '' };
    Object.defineProperty(nonEnumerable, 'brief', {
      configurable: true,
      enumerable: false,
      value: '',
    });
    expect(() => createEmptyStudioProjectV3(nonEnumerable, 'project_4', '2026-08-30T00:00:00.000Z')).toThrow(TypeError);

    let getterCalls = 0;
    const accessor = { brief: '' } as { name: string; brief: string };
    Object.defineProperty(accessor, 'name', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'Project Four';
      },
    });
    expect(() => createEmptyStudioProjectV3(accessor, 'project_4', '2026-08-30T00:00:00.000Z')).toThrow(TypeError);
    expect(getterCalls).toBe(0);

    const proxied = new Proxy({ name: 'Project Four', brief: '' }, {});
    expect(() => createEmptyStudioProjectV3(proxied, 'project_4', '2026-08-30T00:00:00.000Z')).toThrow(TypeError);
  });
});
