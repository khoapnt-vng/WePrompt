/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  type StudioCreateBoardMutationContextV4,
  type StudioCreateBoardRequestV4,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { applyStudioCreateBoardV4 } from '@/process/services/creative-studio/service/schema2/mutations/boardV4';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import { makePhase6Project } from '../../../../../../fixtures/creative-studio/phase6Project';

const capturedAt = '2026-09-02T00:00:03.000Z';

const request = (project: StudioProjectV4): StudioCreateBoardRequestV4 => ({
  projectId: project.id,
  expectedAuthoringRevision: project.authoringRevision,
  handle: 'departure_board',
  beats: [
    {
      title: 'Departure',
      story: 'The boat leaves the harbour.',
      targetSeconds: 10,
      shots: [
        { shootingScript: 'The rope drops into the water.', durationSeconds: 4 },
        { shootingScript: 'The boat clears the harbour wall.', durationSeconds: 6 },
      ],
    },
  ],
});

const context = (): StudioCreateBoardMutationContextV4 => ({
  boardId: 'board_2',
  beatIds: ['beat_2'],
  shotIds: ['shot_3', 'shot_4'],
  capturedAt,
});

describe('schema-7 Board proposal application', () => {
  it('commits one accepted Board without generation, spend, Assembly, or a second picture order', () => {
    const project = makePhase6Project();
    const before = {
      pieces: structuredClone(project.pieces),
      assets: structuredClone(project.assets),
      jobs: structuredClone(project.jobs),
      authorizations: structuredClone(project.spendAuthorizations),
      assemblies: structuredClone(project.assemblies),
    };

    const result = applyStudioCreateBoardV4(project, request(project), context());

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.boardId).toBe('board_2');
    expect(result.createdBeatIds).toEqual(['beat_2']);
    expect(result.createdShotIds).toEqual(['shot_3', 'shot_4']);
    expect(result.project.boardOrder).toEqual(['board_1', 'board_2']);
    expect(result.project.boards.board_2).toMatchObject({
      id: 'board_2',
      handle: 'departure_board',
      priorHandles: [],
      beatOrder: ['beat_2'],
      beats: { beat_2: { shotOrder: ['shot_3', 'shot_4'] } },
    });
    expect(Object.hasOwn(result.project.boards.board_2!, 'pictureOrder')).toBe(false);
    expect(result.project.assemblyOrder).toEqual(project.assemblyOrder);
    expect({
      pieces: result.project.pieces,
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
      assemblies: result.project.assemblies,
    }).toEqual(before);
    expect(result.project.authoringRevision).toBe(project.authoringRevision + 1);
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('fails closed for stale authority, a taken handle, or any identity collision', () => {
    const project = makePhase6Project();

    expect(
      applyStudioCreateBoardV4(
        project,
        { ...request(project), expectedAuthoringRevision: project.authoringRevision - 1 },
        context()
      )
    ).toEqual({ status: 'refused', reason: 'stale_project' });
    expect(applyStudioCreateBoardV4(project, { ...request(project), handle: 'storyboard' }, context())).toEqual({
      status: 'refused',
      reason: 'handle_taken',
    });
    expect(
      applyStudioCreateBoardV4(project, request(project), { ...context(), shotIds: ['piece_photo_1', 'shot_4'] })
    ).toEqual({ status: 'refused', reason: 'identity_collision' });
    expect(
      applyStudioCreateBoardV4(project, request(project), {
        ...context(),
        beatIds: ['new_id'],
        shotIds: ['new_id', 'x'],
      })
    ).toEqual({ status: 'refused', reason: 'identity_collision' });
  });

  it('stores safe prototype-looking Main ids as own data records', () => {
    const project = makePhase6Project();
    const result = applyStudioCreateBoardV4(project, request(project), {
      ...context(),
      beatIds: ['__proto__'],
      shotIds: ['constructor', 'toString'],
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(Object.hasOwn(result.project.boards.board_2!.beats, '__proto__')).toBe(true);
    expect(Object.hasOwn(result.project.boards.board_2!.shots, 'constructor')).toBe(true);
    expect(Object.hasOwn(result.project.boards.board_2!.shots, 'toString')).toBe(true);
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('rejects malformed authored facts and mismatched Main-issued identity counts', () => {
    const project = makePhase6Project();
    const extraKey = { ...request(project), boardId: 'caller_owned' };
    const emptyBeat = { ...request(project), beats: [] };
    const emptyShots = structuredClone(request(project));
    emptyShots.beats[0]!.shots = [];
    const emptyTitle = structuredClone(request(project));
    emptyTitle.beats[0]!.title = '';
    const tooLong = structuredClone(request(project));
    tooLong.beats[0]!.shots[0]!.shootingScript = 'x'.repeat(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH + 1);

    expect(applyStudioCreateBoardV4(project, extraKey, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioCreateBoardV4(project, emptyBeat, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioCreateBoardV4(project, emptyShots, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioCreateBoardV4(project, emptyTitle, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioCreateBoardV4(project, tooLong, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioCreateBoardV4(project, request(project), { ...context(), shotIds: ['shot_3'] })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
  });

  it('does not invoke request accessors or accept proxy inputs', () => {
    const project = makePhase6Project();
    let getterCalls = 0;
    const unsafe = request(project) as StudioCreateBoardRequestV4 & { handle: string };
    Object.defineProperty(unsafe, 'handle', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'unsafe';
      },
    });

    expect(applyStudioCreateBoardV4(project, unsafe, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(getterCalls).toBe(0);

    const nestedUnsafe = request(project);
    Object.defineProperty(nestedUnsafe.beats, '0', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return request(project).beats[0];
      },
    });
    expect(applyStudioCreateBoardV4(project, nestedUnsafe, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(getterCalls).toBe(0);
    expect(applyStudioCreateBoardV4(project, new Proxy(request(project), {}), context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    const revokedRequest = Proxy.revocable(request(project), {});
    revokedRequest.revoke();
    expect(() => applyStudioCreateBoardV4(project, revokedRequest.proxy, context())).not.toThrow();
    expect(applyStudioCreateBoardV4(project, revokedRequest.proxy, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });

    const prototypeLessBeats = request(project).beats;
    Object.setPrototypeOf(prototypeLessBeats, null);
    expect(applyStudioCreateBoardV4(project, { ...request(project), beats: prototypeLessBeats }, context())).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(
      applyStudioCreateBoardV4(project, request(project), {
        ...context(),
        capturedAt: '+012345-01-01T00:00:00.000Z',
      })
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
    expect(applyStudioCreateBoardV4({ ...project, schemaVersion: 6 }, request(project), context())).toEqual({
      status: 'refused',
      reason: 'invalid_project',
    });
  });
});
