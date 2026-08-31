/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type StudioAssetV3,
  type StudioMutationOperationV3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  applyStudioMutationBatchV3,
  parseStudioMutationBatchV3,
  studioPieceCatalogDigestV3,
  validateStudioMutationOperationV3,
} from '@/process/services/creative-studio/service/schema2/mutations/pieceCatalogV3';
import { validateStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/validation';

const T0 = '2026-08-30T00:00:00.000Z';
const T1 = '2026-08-30T00:00:01.000Z';
const T2 = '2026-08-30T00:00:02.000Z';
const T3 = '2026-08-30T00:00:03.000Z';
const T4 = '2026-08-30T00:00:04.000Z';
const T5 = '2026-08-30T00:00:05.000Z';

const importedProject = (secondPiece = false): StudioProjectV3 => {
  const project = createEmptyStudioProjectV3({ name: 'Pilot', brief: '' }, 'project_1', T0);
  const addPiece = (pieceId: string, handle: string, assetId: string): void => {
    const asset: StudioAssetV3 = {
      id: assetId,
      projectId: project.id,
      pieceId,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: `${assetId}.png` },
      byteSize: 8,
      sha256: 'a'.repeat(64),
      width: 800,
      height: 600,
      createdAt: T2,
      origin: 'imported',
      producerJobId: null,
      compositionDigest: null,
    };
    project.pieceOrder.push(pieceId);
    project.pieces[pieceId] = {
      id: pieceId,
      kind: 'photograph',
      handle,
      priorHandles: [],
      currentAssetId: assetId,
      jobIds: [],
      createdAt: T1,
      updatedAt: T2,
    };
    project.assets[assetId] = asset;
  };
  addPiece('piece_1', 'portrait', 'asset_1');
  if (secondPiece) addPiece('piece_2', 'background', 'asset_2');
  project.revision = 2;
  project.authoringRevision = 2;
  project.updatedAt = T2;
  expect(validateStudioProjectV3(project)).toBe(true);
  return project;
};

const batch = (project: StudioProjectV3, operations: StudioMutationOperationV3[]) => ({
  schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  projectId: project.id,
  expectedAuthoringRevision: project.authoringRevision,
  operations,
});

describe('schema-6 mutation parser and Piece-catalog reducer', () => {
  it('admits every declared exact operation and rejects create/delete or extra keys', () => {
    const operations: StudioMutationOperationV3[] = [
      { kind: 'edit_project', name: 'New name' },
      { kind: 'set_brief', brief: 'A portrait' },
      { kind: 'set_rules', rules: [] },
      { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 500 } },
      { kind: 'rename_piece', pieceId: 'piece_1', handle: 'Ảnh đêm' },
      { kind: 'undo_last', entryId: 'mutation_1' },
    ];
    for (const operation of operations) expect(validateStudioMutationOperationV3(operation), operation.kind).toBe(true);
    expect(validateStudioMutationOperationV3({ kind: 'create_piece', pieceId: 'piece_2' })).toBe(false);
    expect(validateStudioMutationOperationV3({ kind: 'delete_piece', pieceId: 'piece_1' })).toBe(false);
    expect(validateStudioMutationOperationV3({ ...operations[0], unexpected: true })).toBe(false);
    for (const kind of ['create_piece', 'delete_piece']) {
      expect(() =>
        parseStudioMutationBatchV3({
          schemaVersion: 6,
          projectId: 'project_1',
          expectedAuthoringRevision: 2,
          operations: [{ kind, pieceId: 'piece_2' }],
        })
      ).toThrow(expect.objectContaining({ reasonCode: 'invalid_operation' }));
    }
    expect(() =>
      parseStudioMutationBatchV3({
        schemaVersion: 6,
        projectId: 'project_1',
        expectedAuthoringRevision: 2,
        operations: [{ kind: 'rename_piece', pieceId: 'piece_1', handle: '../bad' }],
      })
    ).toThrow(expect.objectContaining({ reasonCode: 'invalid_handle' }));
  });

  it('rejects accessors, proxies, sparse arrays, and mixed undo without invoking hostile input', () => {
    let getterCalls = 0;
    const hostile = {
      schemaVersion: 6,
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
      operations: [{ kind: 'set_brief', brief: 'safe' }],
    };
    Object.defineProperty(hostile, 'operations', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });
    expect(() => parseStudioMutationBatchV3(hostile)).toThrow(
      expect.objectContaining({ reasonCode: 'invalid_operation' })
    );
    expect(getterCalls).toBe(0);
    expect(() =>
      parseStudioMutationBatchV3(new Proxy(batch(importedProject(), [{ kind: 'set_brief', brief: 'x' }]), {}))
    ).toThrow(expect.objectContaining({ reasonCode: 'invalid_operation' }));

    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() => parseStudioMutationBatchV3({ ...batch(importedProject(), []), operations: sparse })).toThrow(
      expect.objectContaining({ reasonCode: 'invalid_operation' })
    );
    expect(() =>
      parseStudioMutationBatchV3(
        batch(importedProject(), [
          { kind: 'undo_last', entryId: 'mutation_1' },
          { kind: 'set_brief', brief: 'x' },
        ])
      )
    ).toThrow(expect.objectContaining({ reasonCode: 'invalid_operation' }));
  });

  it('applies non-catalog authored fields atomically and increments both revisions once', () => {
    const project = importedProject();
    const applied = applyStudioMutationBatchV3(
      project,
      batch(project, [
        { kind: 'edit_project', name: 'Renamed project' },
        { kind: 'set_brief', brief: 'One quiet portrait' },
        {
          kind: 'set_rules',
          rules: [{ id: 'rule_1', text: 'No text', predicate: { kind: 'forbidden_terms', terms: ['letters'] } }],
        },
        { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 500 } },
      ]),
      { mutationId: 'mutation_1', capturedAt: T3 }
    );

    expect(project.name).toBe('Pilot');
    expect(applied.result).toEqual({ projectId: 'project_1', revision: 3, authoringRevision: 3 });
    expect(applied.project).toMatchObject({
      revision: 3,
      authoringRevision: 3,
      name: 'Renamed project',
      brief: 'One quiet portrait',
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 500 },
      updatedAt: T3,
    });
    expect(applied.project.rules[0]).toMatchObject({ id: 'rule_1', scope: 'project', createdAt: T3 });
    expect(applied.project.pieces.piece_1).toMatchObject({ handle: 'portrait', priorHandles: [] });
    expect(applied.project.undoHistory).toEqual([]);
    expect(validateStudioProjectV3(applied.project)).toBe(true);
  });

  it('renames and undoes the Piece catalog through singleton batches', () => {
    const project = importedProject();
    const renamed = applyStudioMutationBatchV3(
      project,
      batch(project, [{ kind: 'rename_piece', pieceId: 'piece_1', handle: 'Ảnh đêm' }]),
      { mutationId: 'mutation_1', capturedAt: T3 }
    );

    expect(project.pieces.piece_1).toMatchObject({ handle: 'portrait', priorHandles: [] });
    expect(renamed.result).toEqual({ projectId: 'project_1', revision: 3, authoringRevision: 3 });
    expect(renamed.project.pieces.piece_1).toMatchObject({
      handle: 'ảnh_đêm',
      priorHandles: ['portrait'],
      currentAssetId: 'asset_1',
    });
    expect(renamed.project.undoHistory).toHaveLength(1);
    expect(renamed.project.undoHistory[0]).toMatchObject({
      id: 'mutation_1',
      sourceRevision: 3,
      sourceAuthoringRevision: 3,
      label: 'rename_piece',
    });

    const undone = applyStudioMutationBatchV3(
      renamed.project,
      batch(renamed.project, [{ kind: 'undo_last', entryId: 'mutation_1' }]),
      { mutationId: 'mutation_2', capturedAt: T4 }
    );
    expect(undone.result).toEqual({ projectId: 'project_1', revision: 4, authoringRevision: 4 });
    expect(undone.project.pieces.piece_1).toMatchObject({
      handle: 'portrait',
      priorHandles: [],
      currentAssetId: 'asset_1',
    });
    expect(undone.project.undoHistory).toEqual([]);
    expect(validateStudioProjectV3(undone.project)).toBe(true);
  });

  it('refuses a rename mixed with any other operation in either order', () => {
    const project = importedProject();
    const mixedBatches: StudioMutationOperationV3[][] = [
      [
        { kind: 'rename_piece', pieceId: 'piece_1', handle: 'second' },
        { kind: 'set_brief', brief: 'mixed' },
      ],
      [
        { kind: 'set_brief', brief: 'mixed' },
        { kind: 'rename_piece', pieceId: 'piece_1', handle: 'second' },
      ],
    ];
    for (const operations of mixedBatches) {
      const value = batch(project, operations);
      expect(() => parseStudioMutationBatchV3(value)).toThrow(
        expect.objectContaining({ reasonCode: 'invalid_operation' })
      );
      expect(() => applyStudioMutationBatchV3(project, value, { mutationId: 'mutation_1', capturedAt: T3 })).toThrow(
        expect.objectContaining({ reasonCode: 'invalid_operation' })
      );
    }
    expect(project).toEqual(importedProject());
  });

  it('uses authoringRevision for staleness while tolerating a runtime-only revision before undo', () => {
    const project = importedProject();
    const renamed = applyStudioMutationBatchV3(
      project,
      batch(project, [{ kind: 'rename_piece', pieceId: 'piece_1', handle: 'Second' }]),
      { mutationId: 'mutation_1', capturedAt: T3 }
    ).project;

    const runtimeAdvanced = structuredClone(renamed);
    runtimeAdvanced.revision += 1;
    runtimeAdvanced.updatedAt = T4;
    expect(validateStudioProjectV3(runtimeAdvanced)).toBe(true);
    const undone = applyStudioMutationBatchV3(
      runtimeAdvanced,
      batch(runtimeAdvanced, [{ kind: 'undo_last', entryId: 'mutation_1' }]),
      { mutationId: 'mutation_2', capturedAt: T5 }
    ).project;
    expect(undone.revision).toBe(5);
    expect(undone.authoringRevision).toBe(4);
    expect(undone.pieces.piece_1).toMatchObject({ handle: 'portrait', priorHandles: [] });
    expect(undone.pieces.piece_1?.currentAssetId).toBe('asset_1');
    expect(undone.undoHistory).toEqual([]);

    expect(() =>
      applyStudioMutationBatchV3(
        undone,
        { ...batch(undone, [{ kind: 'set_brief', brief: 'stale' }]), expectedAuthoringRevision: 3 },
        { mutationId: 'mutation_3', capturedAt: T5 }
      )
    ).toThrow(expect.objectContaining({ reasonCode: 'authoring_revision_conflict' }));
  });

  it('refuses undo after any authored Piece-catalog digest conflict', () => {
    const project = importedProject();
    const renamed = applyStudioMutationBatchV3(
      project,
      batch(project, [{ kind: 'rename_piece', pieceId: 'piece_1', handle: 'Second' }]),
      { mutationId: 'mutation_1', capturedAt: T3 }
    ).project;
    const digestAfterRename = studioPieceCatalogDigestV3(renamed);
    const conflicted = structuredClone(renamed);
    conflicted.pieces.piece_1!.handle = 'third';
    conflicted.pieces.piece_1!.priorHandles.push('second');
    conflicted.pieces.piece_1!.updatedAt = T4;
    conflicted.revision += 1;
    conflicted.authoringRevision += 1;
    conflicted.updatedAt = T4;
    expect(studioPieceCatalogDigestV3(conflicted)).not.toBe(digestAfterRename);
    expect(validateStudioProjectV3(conflicted)).toBe(true);
    expect(() =>
      applyStudioMutationBatchV3(conflicted, batch(conflicted, [{ kind: 'undo_last', entryId: 'mutation_1' }]), {
        mutationId: 'mutation_2',
        capturedAt: T5,
      })
    ).toThrow(expect.objectContaining({ reasonCode: 'undo_conflict' }));
  });

  it('fails closed on missing Pieces and collisions with another current handle', () => {
    const project = importedProject(true);
    for (const operation of [
      { kind: 'rename_piece', pieceId: 'missing', handle: 'fresh' },
      { kind: 'rename_piece', pieceId: 'piece_1', handle: 'Background' },
    ] as const) {
      expect(() =>
        applyStudioMutationBatchV3(project, batch(project, [operation]), {
          mutationId: 'mutation_1',
          capturedAt: T3,
        })
      ).toThrow(StudioMutationErrorMatcher(operation.pieceId === 'missing' ? 'piece_not_found' : 'handle_collision'));
    }
  });
});

const StudioMutationErrorMatcher = (reasonCode: string) => expect.objectContaining({ reasonCode });
