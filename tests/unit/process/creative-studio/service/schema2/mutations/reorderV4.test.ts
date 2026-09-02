/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioProjectV4 } from '@/common/types/project/creativeStudioTypes';
import { applyStudioBoardMemberReorderV4 } from '@/process/services/creative-studio/service/schema2/mutations/reorderV4';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import {
  makePhase6Project,
  PHASE_6_AUTHORED_AT,
  PHASE_6_CREATED_AT,
  PHASE_6_CURRENT_AT,
} from '../../../../../../fixtures/creative-studio/phase6Project';

const movedAt = '2026-09-02T00:00:03.000Z';

const addSecondBeat = (project: StudioProjectV4): void => {
  const board = project.boards.board_1!;
  board.beatOrder.push('beat_2');
  board.beats.beat_2 = {
    id: 'beat_2',
    title: 'Departure',
    story: 'The harbour falls behind.',
    targetSeconds: 5,
    shotOrder: ['shot_3'],
  };
  board.shots.shot_3 = {
    id: 'shot_3',
    shootingScript: 'Wake trails behind the boat.',
    durationSeconds: 5,
    createdAt: PHASE_6_AUTHORED_AT,
    updatedAt: PHASE_6_CURRENT_AT,
  };
  project.assemblies.assembly_1!.pictureBindings.shot_3 = {
    shotId: 'shot_3',
    source: null,
    sourceInSeconds: 0,
    sourceOutSeconds: null,
    join: 'hard_cut',
    staleness: null,
  };
};

const requestBase = (project: StudioProjectV4) => ({
  projectId: project.id,
  expectedAuthoringRevision: project.authoringRevision,
  boardId: 'board_1',
});

describe('schema-7 typed Board reorder authority', () => {
  it('reorders Beats for free without touching exact Assembly bindings or spend history', () => {
    const project = makePhase6Project();
    addSecondBeat(project);
    const before = {
      assemblies: structuredClone(project.assemblies),
      assets: structuredClone(project.assets),
      jobs: structuredClone(project.jobs),
      authorizations: structuredClone(project.spendAuthorizations),
    };

    const result = applyStudioBoardMemberReorderV4(
      project,
      { ...requestBase(project), kind: 'beat', beatId: 'beat_1', direction: 'later' },
      { capturedAt: movedAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.consequence).toEqual({ kind: 'free', crossedBeatBoundary: false });
    expect(result.project.boards.board_1!.beatOrder).toEqual(['beat_2', 'beat_1']);
    expect({
      assemblies: result.project.assemblies,
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
    }).toEqual(before);
    expect(result.project.authoringRevision).toBe(project.authoringRevision + 1);
  });

  it('moves a Shot across a Beat boundary for free and normalizes the new Beat head locally', () => {
    const project = makePhase6Project();
    addSecondBeat(project);

    const result = applyStudioBoardMemberReorderV4(
      project,
      { ...requestBase(project), kind: 'shot', shotId: 'shot_2', direction: 'later' },
      { capturedAt: movedAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.consequence).toEqual({ kind: 'free', crossedBeatBoundary: true });
    expect(result.project.boards.board_1!.beats.beat_1!.shotOrder).toEqual(['shot_1']);
    expect(result.project.boards.board_1!.beats.beat_2!.shotOrder).toEqual(['shot_2', 'shot_3']);
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_2!.join).toBe('hard_cut');
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_2!.staleness).toBeNull();
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('marks the moved chain head stale but stops at an independent hard-cut reset', () => {
    const project = makePhase6Project();
    project.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    };
    const before = {
      assets: structuredClone(project.assets),
      jobs: structuredClone(project.jobs),
      authorizations: structuredClone(project.spendAuthorizations),
    };

    const result = applyStudioBoardMemberReorderV4(
      project,
      { ...requestBase(project), kind: 'shot', shotId: 'shot_2', direction: 'earlier' },
      { capturedAt: movedAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.consequence).toEqual({
      kind: 'chain_stale',
      requiresRerenderQuote: true,
      affectedAssemblyIds: ['assembly_1'],
      affectedShotIds: ['shot_2'],
    });
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_2).toMatchObject({
      source: { pieceId: 'piece_photo_1', assetId: 'asset_photo_1' },
      join: 'hard_cut',
      staleness: {
        cause: 'chain',
        upstreamShotId: null,
        sourceAuthoringRevision: project.authoringRevision,
        keptAt: null,
      },
    });
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_1!.staleness).toBeNull();
    expect({
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
    }).toEqual(before);
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('propagates staleness through the changed match-previous segment', () => {
    const project = makePhase6Project();
    const board = project.boards.board_1!;
    board.beats.beat_1!.shotOrder.push('shot_3');
    board.shots.shot_3 = {
      id: 'shot_3',
      shootingScript: 'The rope clears the final bollard.',
      durationSeconds: 5,
      createdAt: PHASE_6_AUTHORED_AT,
      updatedAt: PHASE_6_CURRENT_AT,
    };
    project.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    };
    project.assemblies.assembly_1!.pictureBindings.shot_3 = {
      shotId: 'shot_3',
      source: { pieceId: 'piece_photo_1', assetId: 'asset_photo_1' },
      sourceInSeconds: 0,
      sourceOutSeconds: null,
      join: 'match_previous',
      staleness: null,
    };
    expect(validateStudioProjectV4(project)).toBe(true);

    const result = applyStudioBoardMemberReorderV4(
      project,
      { ...requestBase(project), kind: 'shot', shotId: 'shot_2', direction: 'later' },
      { capturedAt: movedAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.consequence).toEqual({
      kind: 'chain_stale',
      requiresRerenderQuote: true,
      affectedAssemblyIds: ['assembly_1'],
      affectedShotIds: ['shot_3', 'shot_2'],
    });
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_3!.staleness?.upstreamShotId).toBe('shot_1');
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_2!.staleness?.upstreamShotId).toBe('shot_3');
  });

  it('reports a priced chain consequence even when no rendered binding needs marking yet', () => {
    const project = makePhase6Project();
    project.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;

    const result = applyStudioBoardMemberReorderV4(
      project,
      { ...requestBase(project), kind: 'shot', shotId: 'shot_2', direction: 'earlier' },
      { capturedAt: movedAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.consequence).toEqual({
      kind: 'chain_stale',
      requiresRerenderQuote: true,
      affectedAssemblyIds: [],
      affectedShotIds: ['shot_2'],
    });
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_1!.staleness).toBeNull();
  });

  it('refuses outer boundaries and a cross-Beat move that would leave an empty Beat', () => {
    const project = makePhase6Project();
    expect(
      applyStudioBoardMemberReorderV4(
        project,
        { ...requestBase(project), kind: 'beat', beatId: 'beat_1', direction: 'earlier' },
        { capturedAt: movedAt }
      )
    ).toEqual({ status: 'refused', reason: 'boundary_reached' });
    expect(
      applyStudioBoardMemberReorderV4(
        project,
        { ...requestBase(project), kind: 'shot', shotId: 'shot_1', direction: 'earlier' },
        { capturedAt: movedAt }
      )
    ).toEqual({ status: 'refused', reason: 'boundary_reached' });

    addSecondBeat(project);
    expect(
      applyStudioBoardMemberReorderV4(
        project,
        { ...requestBase(project), kind: 'shot', shotId: 'shot_3', direction: 'earlier' },
        { capturedAt: movedAt }
      )
    ).toEqual({ status: 'refused', reason: 'boundary_reached' });
  });

  it('fails closed for stale, missing, extra-key, and accessor-backed requests', () => {
    const project = makePhase6Project();
    const exact = { ...requestBase(project), kind: 'shot', shotId: 'shot_2', direction: 'earlier' } as const;
    expect(
      applyStudioBoardMemberReorderV4(
        project,
        { ...exact, expectedAuthoringRevision: project.authoringRevision - 1 },
        { capturedAt: movedAt }
      )
    ).toEqual({ status: 'refused', reason: 'stale_project' });
    expect(
      applyStudioBoardMemberReorderV4(project, { ...exact, shotId: 'shot_missing' }, { capturedAt: movedAt })
    ).toEqual({ status: 'refused', reason: 'member_not_found' });
    expect(
      applyStudioBoardMemberReorderV4(project, { ...exact, boardId: 'board_missing' }, { capturedAt: movedAt })
    ).toEqual({ status: 'refused', reason: 'member_not_found' });
    for (const boardId of ['constructor', 'toString', '__proto__']) {
      expect(() =>
        applyStudioBoardMemberReorderV4(project, { ...exact, boardId }, { capturedAt: movedAt })
      ).not.toThrow();
      expect(applyStudioBoardMemberReorderV4(project, { ...exact, boardId }, { capturedAt: movedAt })).toEqual({
        status: 'refused',
        reason: 'member_not_found',
      });
    }
    expect(
      applyStudioBoardMemberReorderV4(project, { ...exact, projectId: 'project_missing' }, { capturedAt: movedAt })
    ).toEqual({ status: 'refused', reason: 'member_not_found' });
    expect(
      applyStudioBoardMemberReorderV4(project, { ...exact, canvasBlockId: 'piece_photo_1' }, { capturedAt: movedAt })
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
    expect(applyStudioBoardMemberReorderV4(project, exact, { capturedAt: 'not-a-date' })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioBoardMemberReorderV4(project, exact, { capturedAt: '+012345-01-01T00:00:00.000Z' })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioBoardMemberReorderV4(project, exact, { capturedAt: PHASE_6_CREATED_AT })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(applyStudioBoardMemberReorderV4({ schemaVersion: 7 }, exact, { capturedAt: movedAt })).toEqual({
      status: 'refused',
      reason: 'invalid_project',
    });
    expect(applyStudioBoardMemberReorderV4(project, new Proxy(exact, {}), { capturedAt: movedAt })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    const revoked = Proxy.revocable(exact, {});
    revoked.revoke();
    expect(() => applyStudioBoardMemberReorderV4(project, revoked.proxy, { capturedAt: movedAt })).not.toThrow();
    expect(applyStudioBoardMemberReorderV4(project, revoked.proxy, { capturedAt: movedAt })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });

    let getterCalls = 0;
    const request = { ...exact } as Record<string, unknown>;
    Object.defineProperty(request, 'shotId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'shot_2';
      },
    });
    expect(applyStudioBoardMemberReorderV4(project, request, { capturedAt: movedAt })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(getterCalls).toBe(0);

    const context = {} as Record<string, unknown>;
    Object.defineProperty(context, 'capturedAt', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return movedAt;
      },
    });
    expect(applyStudioBoardMemberReorderV4(project, exact, context)).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(getterCalls).toBe(0);
  });
});
