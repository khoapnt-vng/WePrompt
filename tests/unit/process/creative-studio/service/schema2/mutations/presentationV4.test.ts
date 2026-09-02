/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import {
  liftStudioCanvasSubjectsToBinV4,
  restoreStudioCanvasSubjectFromBinV4,
} from '@/process/services/creative-studio/service/schema2/mutations/presentationV4';
import { makePhase6Project, PHASE_6_CURRENT_AT } from '../../../../../../fixtures/creative-studio/phase6Project';

const liftedAt = '2026-09-02T00:00:03.000Z';
const restoredAt = '2026-09-02T00:00:04.000Z';

describe('schema-7 recoverable canvas presentation mutations', () => {
  it('lifts a selected Piece without changing authoring, media, history, or Assembly bindings', () => {
    const project = makePhase6Project();
    const before = {
      authoringRevision: project.authoringRevision,
      pieces: structuredClone(project.pieces),
      assets: structuredClone(project.assets),
      jobs: structuredClone(project.jobs),
      authorizations: structuredClone(project.spendAuthorizations),
      assemblies: structuredClone(project.assemblies),
    };

    const result = liftStudioCanvasSubjectsToBinV4(
      project,
      {
        projectId: project.id,
        expectedRevision: project.revision,
        subjects: [{ kind: 'piece', pieceId: 'piece_photo_1' }],
      },
      { entryIds: ['bin_1'], capturedAt: liftedAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.project.bin).toEqual([
      {
        id: 'bin_1',
        subject: { kind: 'piece', pieceId: 'piece_photo_1' },
        reason: 'lifted',
        liftedAt,
      },
    ]);
    expect({
      authoringRevision: result.project.authoringRevision,
      pieces: result.project.pieces,
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
      assemblies: result.project.assemblies,
    }).toEqual(before);
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('lifts several selected owners atomically in selection order', () => {
    const project = makePhase6Project();
    const result = liftStudioCanvasSubjectsToBinV4(
      project,
      {
        projectId: project.id,
        expectedRevision: project.revision,
        subjects: [
          { kind: 'board', boardId: 'board_1' },
          { kind: 'assembly', assemblyId: 'assembly_1' },
        ],
      },
      { entryIds: ['bin_board', 'bin_cut'], capturedAt: liftedAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.project.bin.map((entry) => entry.subject.kind)).toEqual(['board', 'assembly']);
    expect(result.project.boards.board_1).toBe(project.boards.board_1);
    expect(result.project.assemblies.assembly_1).toBe(project.assemblies.assembly_1);
  });

  it('restores one Bin entry without recreating or replacing its owner', () => {
    const project = makePhase6Project();
    project.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'piece', pieceId: 'piece_photo_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    const piece = project.pieces.piece_photo_1;
    const result = restoreStudioCanvasSubjectFromBinV4(
      project,
      { projectId: project.id, expectedRevision: project.revision, entryId: 'bin_1' },
      { entryIds: [], capturedAt: restoredAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.project.bin).toEqual([]);
    expect(result.project.pieces.piece_photo_1).toBe(piece);
    expect(result.project.authoringRevision).toBe(project.authoringRevision);
  });

  it('fails closed for stale revisions, duplicate selections, and already-binned subjects', () => {
    const project = makePhase6Project();
    const baseRequest = {
      projectId: project.id,
      expectedRevision: project.revision,
      subjects: [{ kind: 'piece' as const, pieceId: 'piece_photo_1' }],
    };

    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        { ...baseRequest, expectedRevision: project.revision - 1 },
        { entryIds: ['bin_1'], capturedAt: liftedAt }
      )
    ).toEqual({ status: 'refused', reason: 'stale_project' });
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        { ...baseRequest, subjects: [...baseRequest.subjects, ...baseRequest.subjects] },
        { entryIds: ['bin_1', 'bin_2'], capturedAt: liftedAt }
      )
    ).toEqual({ status: 'refused', reason: 'invalid_request' });

    project.bin = [
      {
        id: 'bin_existing',
        subject: { kind: 'piece', pieceId: 'piece_photo_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    expect(
      liftStudioCanvasSubjectsToBinV4(project, baseRequest, {
        entryIds: ['bin_1'],
        capturedAt: liftedAt,
      })
    ).toEqual({ status: 'refused', reason: 'already_binned' });
  });

  it('refuses missing subjects, colliding Main identities, and stale restore claims', () => {
    const project = makePhase6Project();
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        {
          projectId: project.id,
          expectedRevision: project.revision,
          subjects: [{ kind: 'board', boardId: 'board_missing' }],
        },
        { entryIds: ['bin_1'], capturedAt: liftedAt }
      )
    ).toEqual({ status: 'refused', reason: 'subject_not_found' });
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        {
          projectId: project.id,
          expectedRevision: project.revision,
          subjects: [{ kind: 'assembly', assemblyId: 'assembly_1' }],
        },
        { entryIds: ['asset_photo_1'], capturedAt: liftedAt }
      )
    ).toEqual({ status: 'refused', reason: 'identity_collision' });
    expect(
      restoreStudioCanvasSubjectFromBinV4(
        project,
        { projectId: project.id, expectedRevision: project.revision, entryId: 'bin_missing' },
        { entryIds: [], capturedAt: restoredAt }
      )
    ).toEqual({ status: 'refused', reason: 'bin_entry_not_found' });
  });

  it('does not invoke accessors or accept unknown subjects through the person-facing lift path', () => {
    let getterCalls = 0;
    const request = {
      projectId: 'project_7',
      expectedRevision: 2,
      subjects: [] as unknown[],
    };
    Object.defineProperty(request, 'subjects', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return [];
      },
    });

    expect(
      liftStudioCanvasSubjectsToBinV4(makePhase6Project(), request, {
        entryIds: [],
        capturedAt: liftedAt,
      })
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
    expect(getterCalls).toBe(0);
    expect(
      liftStudioCanvasSubjectsToBinV4(
        makePhase6Project(),
        {
          projectId: 'project_7',
          expectedRevision: 2,
          subjects: [{ kind: 'asset', assetId: 'asset_photo_1' }],
        },
        { entryIds: ['bin_1'], capturedAt: liftedAt }
      )
    ).toEqual({ status: 'refused', reason: 'invalid_request' });
  });
});
