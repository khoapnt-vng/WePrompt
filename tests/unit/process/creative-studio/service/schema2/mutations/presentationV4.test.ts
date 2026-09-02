/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioBinDecisionStateV4,
  StudioCanvasBinSubjectV4,
  StudioPresentationMutationContextV4,
  StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  liftStudioCanvasSubjectsToBinV4,
  restoreStudioCanvasSubjectFromBinV4,
  studioCanvasSubjectHasBlockingWorkV4,
} from '@/process/services/creative-studio/service/schema2/mutations/presentationV4';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import { makePhase6Project, PHASE_6_CURRENT_AT } from '../../../../../../fixtures/creative-studio/phase6Project';

const liftedAt = '2026-09-02T00:00:03.000Z';
const liftedLaterAt = '2026-09-02T00:00:04.000Z';
const restoredAt = '2026-09-02T00:00:05.000Z';

const withoutAssembly = (): StudioProjectV4 => {
  const project = makePhase6Project();
  project.assemblyOrder = [];
  project.assemblies = {};
  expect(validateStudioProjectV4(project)).toBe(true);
  return project;
};

const authority = (
  project: StudioProjectV4,
  subjects: StudioCanvasBinSubjectV4[],
  entryIds: string[],
  states: StudioBinDecisionStateV4[] = subjects.map(() => 'clear'),
  capturedAt = liftedAt
): StudioPresentationMutationContextV4 => ({
  projectId: project.id,
  projectRevision: project.revision,
  entryIds,
  decisions: subjects.map((subject, index) => ({ subject, state: states[index]! })),
  capturedAt,
});

const lift = (
  project: StudioProjectV4,
  subjects: StudioCanvasBinSubjectV4[],
  entryIds: string[],
  context = authority(project, subjects, entryIds)
) =>
  liftStudioCanvasSubjectsToBinV4(
    project,
    { projectId: project.id, expectedRevision: project.revision, subjects },
    context
  );

describe('schema-7 recoverable canvas presentation mutations', () => {
  it('lifts an unused Piece without changing authoring, media, history, or Assembly state', () => {
    const project = withoutAssembly();
    const before = {
      authoringRevision: project.authoringRevision,
      pieces: structuredClone(project.pieces),
      assets: structuredClone(project.assets),
      jobs: structuredClone(project.jobs),
      authorizations: structuredClone(project.spendAuthorizations),
      undoHistory: structuredClone(project.undoHistory),
      assemblies: structuredClone(project.assemblies),
    };
    const subject = { kind: 'piece' as const, pieceId: 'piece_photo_1' };

    const result = lift(project, [subject], ['bin_1']);

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.project.bin).toEqual([{ id: 'bin_1', subject, reason: 'lifted', liftedAt }]);
    expect(result.project.revision).toBe(project.revision + 1);
    expect(result.project.updatedAt).toBe(liftedAt);
    expect({
      authoringRevision: result.project.authoringRevision,
      pieces: result.project.pieces,
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
      undoHistory: result.project.undoHistory,
      assemblies: result.project.assemblies,
    }).toEqual(before);
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('lifts and restores one unused Board Shot without recreating its Board', () => {
    const project = withoutAssembly();
    const subject = { kind: 'board_shot' as const, boardId: 'board_1', shotId: 'shot_2' };
    const board = project.boards.board_1;
    const lifted = lift(project, [subject], ['bin_shot']);
    expect(lifted.status).toBe('applied');
    if (lifted.status !== 'applied') return;
    expect(lifted.project.boards.board_1).toBe(board);

    const restored = restoreStudioCanvasSubjectFromBinV4(
      lifted.project,
      { projectId: project.id, expectedRevision: lifted.project.revision, entryId: 'bin_shot' },
      authority(lifted.project, [], [], [], restoredAt)
    );

    expect(restored.status).toBe('applied');
    if (restored.status !== 'applied') return;
    expect(restored.project.bin).toEqual([]);
    expect(restored.project.boards.board_1).toBe(board);
    expect(restored.project.authoringRevision).toBe(project.authoringRevision);
  });

  it('fails closed for stale, missing, wrong-project, and forged restore authority', () => {
    const project = withoutAssembly();
    const subject = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    const lifted = lift(project, [subject], ['bin_piece']);
    expect(lifted.status).toBe('applied');
    if (lifted.status !== 'applied') return;
    const validRequest = {
      projectId: lifted.project.id,
      expectedRevision: lifted.project.revision,
      entryId: 'bin_piece',
    };
    const validAuthority = authority(lifted.project, [], [], [], restoredAt);

    expect(
      restoreStudioCanvasSubjectFromBinV4(
        lifted.project,
        { ...validRequest, expectedRevision: project.revision },
        validAuthority
      )
    ).toEqual({ status: 'refused', reason: 'stale_project' });
    expect(
      restoreStudioCanvasSubjectFromBinV4(
        lifted.project,
        { ...validRequest, projectId: 'project_other' },
        validAuthority
      )
    ).toEqual({ status: 'refused', reason: 'bin_entry_not_found' });
    expect(
      restoreStudioCanvasSubjectFromBinV4(lifted.project, { ...validRequest, entryId: 'bin_missing' }, validAuthority)
    ).toEqual({ status: 'refused', reason: 'bin_entry_not_found' });
    expect(
      restoreStudioCanvasSubjectFromBinV4(lifted.project, validRequest, {
        ...validAuthority,
        entryIds: ['caller_invented'],
      })
    ).toEqual({ status: 'refused', reason: 'invalid_authority' });
    expect(
      restoreStudioCanvasSubjectFromBinV4(lifted.project, { ...validRequest, extra: true }, validAuthority)
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
    expect(lifted.project.bin).toHaveLength(1);
  });

  it('refuses every retained film dependency, including null-source slates and binned cuts', () => {
    const project = makePhase6Project();
    project.bin = [
      {
        id: 'bin_cut',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    const subjects: StudioCanvasBinSubjectV4[] = [
      { kind: 'piece', pieceId: 'piece_photo_1' },
      { kind: 'board', boardId: 'board_1' },
      { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_2' },
    ];

    for (const [index, subject] of subjects.entries()) {
      expect(lift(project, [subject], [`bin_refused_${index}`])).toEqual({
        status: 'refused',
        reason: 'subject_in_film',
      });
    }
    expect(project.bin).toHaveLength(1);
  });

  it('refuses a mixed selection atomically when one owner is used by the film', () => {
    const project = makePhase6Project();
    const subjects: StudioCanvasBinSubjectV4[] = [
      { kind: 'assembly', assemblyId: 'assembly_1' },
      { kind: 'board', boardId: 'board_1' },
    ];

    expect(lift(project, subjects, ['bin_cut', 'bin_board'])).toEqual({
      status: 'refused',
      reason: 'subject_in_film',
    });
    expect(project.bin).toEqual([]);
  });

  it('never quiets active or unresolved Piece work inside the Bin', () => {
    const project = withoutAssembly();
    const subject = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    project.pieces.piece_photo_1!.jobIds = ['job_active'];

    for (const status of ['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention'] as const) {
      project.jobs.job_active = { status } as StudioProjectV4['jobs'][string];
      expect(studioCanvasSubjectHasBlockingWorkV4(project, subject), status).toBe(true);
    }
    for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
      project.jobs.job_active = { status } as StudioProjectV4['jobs'][string];
      expect(studioCanvasSubjectHasBlockingWorkV4(project, subject), status).toBe(false);
    }
    expect(studioCanvasSubjectHasBlockingWorkV4(project, { kind: 'board', boardId: 'board_1' })).toBe(false);
  });

  it('honours exact authority-context proposal and quote decisions before mutating', () => {
    const project = withoutAssembly();
    const piece = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    const board = { kind: 'board' as const, boardId: 'board_1' };

    expect(lift(project, [piece], ['bin_piece'], authority(project, [piece], ['bin_piece'], ['proposed']))).toEqual({
      status: 'refused',
      reason: 'proposal_pending',
    });
    expect(lift(project, [piece], ['bin_piece'], authority(project, [piece], ['bin_piece'], ['needs_budget']))).toEqual(
      { status: 'refused', reason: 'quote_pending' }
    );
    expect(lift(project, [piece], ['bin_piece'], authority(project, [board], ['bin_piece']))).toEqual({
      status: 'refused',
      reason: 'invalid_authority',
    });
    expect(
      lift(project, [piece], ['bin_piece'], {
        ...authority(project, [piece], ['bin_piece']),
        projectRevision: project.revision - 1,
      })
    ).toEqual({ status: 'refused', reason: 'invalid_authority' });
    expect(project.bin).toEqual([]);
  });

  it('refuses proposal and quote presentation blocks before their durable owners exist', () => {
    const project = withoutAssembly();
    const futureBoard = { kind: 'board' as const, boardId: 'board_future' };
    const futurePiece = { kind: 'piece' as const, pieceId: 'piece_future' };

    expect(
      lift(
        project,
        [futureBoard],
        ['bin_future_board'],
        authority(project, [futureBoard], ['bin_future_board'], ['proposed'])
      )
    ).toEqual({ status: 'refused', reason: 'proposal_pending' });
    expect(
      lift(
        project,
        [futurePiece],
        ['bin_future_piece'],
        authority(project, [futurePiece], ['bin_future_piece'], ['needs_budget'])
      )
    ).toEqual({ status: 'refused', reason: 'quote_pending' });
  });

  it('rejects duplicate, overlapping, already-binned, missing, and wrong-owner subjects', () => {
    const project = withoutAssembly();
    const piece = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    const board = { kind: 'board' as const, boardId: 'board_1' };
    const shot = { kind: 'board_shot' as const, boardId: 'board_1', shotId: 'shot_1' };

    expect(lift(project, [piece, piece], ['bin_1', 'bin_2'])).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(lift(project, [board, shot], ['bin_board', 'bin_shot'])).toEqual({
      status: 'refused',
      reason: 'overlapping_subject',
    });
    expect(
      lift(project, [{ kind: 'board_shot', boardId: 'board_1', shotId: 'shot_missing' }], ['bin_missing'])
    ).toEqual({ status: 'refused', reason: 'subject_not_found' });
    expect(
      lift(project, [{ kind: 'board_shot', boardId: 'board_missing', shotId: 'shot_1' }], ['bin_wrong_owner'])
    ).toEqual({ status: 'refused', reason: 'subject_not_found' });

    const first = lift(project, [shot], ['bin_shot']);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    expect(lift(first.project, [shot], ['bin_again'])).toEqual({ status: 'refused', reason: 'already_binned' });
    const wholeBoard = lift(first.project, [board], ['bin_board']);
    expect(wholeBoard.status).toBe('applied');
    if (wholeBoard.status !== 'applied') return;
    expect(wholeBoard.project.bin).toEqual([{ id: 'bin_board', subject: board, reason: 'lifted', liftedAt }]);
  });

  it('canonicalizes the last lifted Board member to one whole-Board Bin entry', () => {
    const project = withoutAssembly();
    const firstSubject = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    const first = lift(project, [firstSubject], ['bin_piece']);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const firstShot = { kind: 'board_shot' as const, boardId: 'board_1', shotId: 'shot_1' };
    const partial = lift(
      first.project,
      [firstShot],
      ['bin_shot_1'],
      authority(first.project, [firstShot], ['bin_shot_1'], undefined, liftedLaterAt)
    );
    expect(partial.status).toBe('applied');
    if (partial.status !== 'applied') return;
    const lastShot = { kind: 'board_shot' as const, boardId: 'board_1', shotId: 'shot_2' };
    const completed = lift(
      partial.project,
      [lastShot],
      ['bin_shot_2'],
      authority(partial.project, [lastShot], ['bin_shot_2'], undefined, restoredAt)
    );

    expect(completed.status).toBe('applied');
    if (completed.status !== 'applied') return;
    expect(completed.project.bin).toEqual([
      {
        id: 'bin_shot_2',
        subject: { kind: 'board', boardId: 'board_1' },
        reason: 'lifted',
        liftedAt: restoredAt,
      },
      { id: 'bin_piece', subject: firstSubject, reason: 'lifted', liftedAt },
    ]);
  });

  it('canonicalizes a bulk lift of every Board member using the first selected member identity', () => {
    const project = withoutAssembly();
    const subjects: StudioCanvasBinSubjectV4[] = [
      { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_2' },
      { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_1' },
    ];

    const result = lift(project, subjects, ['bin_selected_first', 'bin_selected_second']);

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.project.bin).toEqual([
      {
        id: 'bin_selected_first',
        subject: { kind: 'board', boardId: 'board_1' },
        reason: 'lifted',
        liftedAt,
      },
    ]);
    expect(result.project.bin.some((entry) => entry.id === 'bin_selected_second')).toBe(false);
  });

  it('checks issued Bin IDs against the complete durable identity namespace', () => {
    const project = withoutAssembly();
    const piece = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    expect(lift(project, [piece], ['asset_photo_1'])).toEqual({
      status: 'refused',
      reason: 'identity_collision',
    });
  });

  it('fails closed for malformed person input and caller-invented authority', () => {
    const project = withoutAssembly();
    const subject = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    let getterCalls = 0;
    const request = { projectId: project.id, expectedRevision: project.revision } as Record<string, unknown>;
    Object.defineProperty(request, 'subjects', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return [subject];
      },
    });

    expect(liftStudioCanvasSubjectsToBinV4(project, request, authority(project, [subject], ['bin_1']))).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(getterCalls).toBe(0);
    const accessorSubject = { pieceId: 'piece_photo_1' };
    Object.defineProperty(accessorSubject, 'kind', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'piece';
      },
    });
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        { projectId: project.id, expectedRevision: project.revision, subjects: [accessorSubject] },
        authority(project, [subject], ['bin_1'])
      )
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
    expect(getterCalls).toBe(0);
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        {
          projectId: project.id,
          expectedRevision: project.revision,
          subjects: [{ kind: 'asset', assetId: 'asset_photo_1' }],
        },
        authority(project, [subject], ['bin_1'])
      )
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        { projectId: project.id, expectedRevision: project.revision, subjects: [subject] },
        { ...authority(project, [subject], ['bin_1']), extra: true }
      )
    ).toEqual({ status: 'refused', reason: 'invalid_authority' });
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        { projectId: project.id, expectedRevision: project.revision, subjects: [subject] },
        { ...authority(project, [subject], ['bin_1']), decisions: [] }
      )
    ).toEqual({ status: 'refused', reason: 'invalid_authority' });
  });

  it('refuses persisted arrays with non-canonical prototypes without invoking inherited methods', () => {
    const nullPrototype = withoutAssembly();
    Object.setPrototypeOf(nullPrototype.bin, null);
    const subject = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    expect(
      liftStudioCanvasSubjectsToBinV4(
        nullPrototype,
        { projectId: nullPrototype.id, expectedRevision: nullPrototype.revision, subjects: [subject] },
        authority(nullPrototype, [subject], ['bin_1'])
      )
    ).toEqual({ status: 'refused', reason: 'invalid_project' });

    let inheritedMapCalls = 0;
    const hostilePrototype = Object.create(Array.prototype) as unknown[];
    Object.defineProperty(hostilePrototype, 'map', {
      value: () => {
        inheritedMapCalls += 1;
        throw new Error('must not run');
      },
    });
    const customPrototype = withoutAssembly();
    Object.setPrototypeOf(customPrototype.bin, hostilePrototype);
    expect(
      liftStudioCanvasSubjectsToBinV4(
        customPrototype,
        { projectId: customPrototype.id, expectedRevision: customPrototype.revision, subjects: [subject] },
        authority(customPrototype, [subject], ['bin_1'])
      )
    ).toEqual({ status: 'refused', reason: 'invalid_project' });
    expect(inheritedMapCalls).toBe(0);
  });
});
