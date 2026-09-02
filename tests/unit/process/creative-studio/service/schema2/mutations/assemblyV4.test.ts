/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioCreateAssemblyMutationContextV4,
  StudioCreateAssemblyRequestV4,
  StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_MAX_ASSEMBLIES_V4 } from '@/common/types/project/creativeStudioTypes';
import { applyStudioCreateAssemblyV4 } from '@/process/services/creative-studio/service/schema2/mutations/assemblyV4';
import { deriveStudioAssemblyPictureTimelineV4 } from '@/process/services/creative-studio/service/schema2/projections/canvasV4';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import { makePhase6Project } from '../../../../../../fixtures/creative-studio/phase6Project';

const capturedAt = '2026-09-02T00:00:03.000Z';

const projectWithoutAssembly = (): StudioProjectV4 => {
  const project = makePhase6Project();
  project.assemblyOrder = [];
  project.assemblies = {};
  return project;
};

const request = (project: StudioProjectV4): StudioCreateAssemblyRequestV4 => ({
  projectId: project.id,
  expectedAuthoringRevision: project.authoringRevision,
  boardId: 'board_1',
  handle: 'the_cut',
});

const context = (): StudioCreateAssemblyMutationContextV4 => ({
  assemblyId: 'assembly_1',
  capturedAt,
});

describe('schema-7 deterministic Assembly creation substrate', () => {
  it('creates exact slates over Board order without storing another picture order or spending', () => {
    const project = projectWithoutAssembly();
    const before = {
      pieces: structuredClone(project.pieces),
      assets: structuredClone(project.assets),
      jobs: structuredClone(project.jobs),
      authorizations: structuredClone(project.spendAuthorizations),
      board: structuredClone(project.boards.board_1),
    };

    const result = applyStudioCreateAssemblyV4(project, request(project), context());

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.assemblyId).toBe('assembly_1');
    expect(result.project.assemblyOrder).toEqual(['assembly_1']);
    expect(Object.hasOwn(result.project.assemblies.assembly_1!, 'pictureOrder')).toBe(false);
    expect(result.project.assemblies.assembly_1!.pictureBindings).toEqual({
      shot_1: {
        shotId: 'shot_1',
        source: null,
        sourceInSeconds: 0,
        sourceOutSeconds: null,
        join: 'hard_cut',
        staleness: null,
      },
      shot_2: {
        shotId: 'shot_2',
        source: null,
        sourceInSeconds: 0,
        sourceOutSeconds: null,
        join: 'match_previous',
        staleness: null,
      },
    });
    expect(deriveStudioAssemblyPictureTimelineV4(result.project, 'assembly_1').map((row) => row.shotId)).toEqual([
      'shot_1',
      'shot_2',
    ]);
    expect({
      pieces: result.project.pieces,
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
      board: result.project.boards.board_1,
    }).toEqual(before);
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('fails closed for stale authority, missing Board, handle reuse, and identity collision', () => {
    const project = projectWithoutAssembly();

    expect(
      applyStudioCreateAssemblyV4(
        project,
        { ...request(project), expectedAuthoringRevision: project.authoringRevision - 1 },
        context()
      )
    ).toEqual({ status: 'refused', reason: 'stale_project' });
    expect(applyStudioCreateAssemblyV4(project, { ...request(project), boardId: 'board_missing' }, context())).toEqual({
      status: 'refused',
      reason: 'board_not_found',
    });
    for (const boardId of ['constructor', 'toString', '__proto__']) {
      expect(() => applyStudioCreateAssemblyV4(project, { ...request(project), boardId }, context())).not.toThrow();
      expect(applyStudioCreateAssemblyV4(project, { ...request(project), boardId }, context())).toEqual({
        status: 'refused',
        reason: 'board_not_found',
      });
    }
    expect(applyStudioCreateAssemblyV4(project, { ...request(project), handle: 'storyboard' }, context())).toEqual({
      status: 'refused',
      reason: 'handle_taken',
    });
    expect(
      applyStudioCreateAssemblyV4(project, request(project), { ...context(), assemblyId: 'asset_photo_1' })
    ).toEqual({ status: 'refused', reason: 'identity_collision' });
    expect(
      applyStudioCreateAssemblyV4(project, { ...request(project), projectId: 'project_missing' }, context())
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
  });

  it('accepts a safe prototype-looking Assembly id as an own project record', () => {
    const project = projectWithoutAssembly();
    const result = applyStudioCreateAssemblyV4(project, request(project), {
      ...context(),
      assemblyId: '__proto__',
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(Object.hasOwn(result.project.assemblies, '__proto__')).toBe(true);
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('refuses capacity and timestamps older than the current project snapshot', () => {
    const project = makePhase6Project();
    for (let index = 2; index <= STUDIO_MAX_ASSEMBLIES_V4; index += 1) {
      const id = `assembly_${index}`;
      project.assemblyOrder.push(id);
      project.assemblies[id] = {
        ...structuredClone(project.assemblies.assembly_1!),
        id,
        handle: `cut_${index}`,
      };
    }
    expect(validateStudioProjectV4(project)).toBe(true);
    expect(applyStudioCreateAssemblyV4(project, request(project), { ...context(), assemblyId: 'assembly_25' })).toEqual(
      {
        status: 'refused',
        reason: 'capacity_reached',
      }
    );

    const openProject = projectWithoutAssembly();
    expect(
      applyStudioCreateAssemblyV4(openProject, request(openProject), {
        ...context(),
        capturedAt: '2026-09-02T00:00:01.000Z',
      })
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
  });

  it('rejects caller-minted extras, malformed context, accessors, proxies, and invalid projects', () => {
    const project = projectWithoutAssembly();
    const extra = { ...request(project), assemblyId: 'caller_owned' };
    const invalidHandle = { ...request(project), handle: '#not-canonical' };
    let getterCalls = 0;
    const unsafe = request(project);
    Object.defineProperty(unsafe, 'handle', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'unsafe';
      },
    });

    for (const invalid of [extra, invalidHandle, unsafe, new Proxy(request(project), {})]) {
      expect(applyStudioCreateAssemblyV4(project, invalid, context())).toEqual({
        status: 'refused',
        reason: 'invalid_request',
      });
    }
    const revokedRequest = Proxy.revocable(request(project), {});
    revokedRequest.revoke();
    expect(() => applyStudioCreateAssemblyV4(project, revokedRequest.proxy, context())).not.toThrow();
    expect(applyStudioCreateAssemblyV4(project, revokedRequest.proxy, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(getterCalls).toBe(0);
    expect(applyStudioCreateAssemblyV4(project, request(project), { ...context(), capturedAt: 'not-a-date' })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(
      applyStudioCreateAssemblyV4(project, request(project), {
        ...context(),
        capturedAt: '+012345-01-01T00:00:00.000Z',
      })
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
    expect(applyStudioCreateAssemblyV4({ ...project, schemaVersion: 6 }, request(project), context())).toEqual({
      status: 'refused',
      reason: 'invalid_project',
    });
  });
});
