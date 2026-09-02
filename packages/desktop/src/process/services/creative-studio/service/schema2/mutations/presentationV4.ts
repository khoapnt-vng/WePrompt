/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_BIN_ENTRIES_V4,
  type StudioCanvasSubjectV4,
  type StudioLiftToBinRequestV4,
  type StudioPresentationMutationContextV4,
  type StudioPresentationMutationFailureV4,
  type StudioPresentationMutationResultV4,
  type StudioProjectV4,
  type StudioRestoreFromBinRequestV4,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV4 } from '../validation';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isDenseInputArrayV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from './exactInputV4';

const LIFT_REQUEST_KEYS = new Set(['projectId', 'expectedRevision', 'subjects']);
const RESTORE_REQUEST_KEYS = new Set(['projectId', 'expectedRevision', 'entryId']);
const CONTEXT_KEYS = new Set(['entryIds', 'capturedAt']);
const PIECE_SUBJECT_KEYS = new Set(['kind', 'pieceId']);
const BOARD_SUBJECT_KEYS = new Set(['kind', 'boardId']);
const ASSEMBLY_SUBJECT_KEYS = new Set(['kind', 'assemblyId']);

const refuse = (reason: StudioPresentationMutationFailureV4): StudioPresentationMutationResultV4 => ({
  status: 'refused',
  reason,
});

const snapshotLiftableSubject = (value: unknown): StudioCanvasSubjectV4 | null => {
  if (!isPlainInputRecordV4(value)) return null;
  if (value.kind === 'piece' && hasExactInputKeysV4(value, PIECE_SUBJECT_KEYS) && isSafeInputIdV4(value.pieceId)) {
    return { kind: 'piece', pieceId: value.pieceId };
  }
  if (value.kind === 'board' && hasExactInputKeysV4(value, BOARD_SUBJECT_KEYS) && isSafeInputIdV4(value.boardId)) {
    return { kind: 'board', boardId: value.boardId };
  }
  if (
    value.kind === 'assembly' &&
    hasExactInputKeysV4(value, ASSEMBLY_SUBJECT_KEYS) &&
    isSafeInputIdV4(value.assemblyId)
  ) {
    return { kind: 'assembly', assemblyId: value.assemblyId };
  }
  return null;
};

export const studioCanvasSubjectKeyV4 = (subject: StudioCanvasSubjectV4): string => {
  switch (subject.kind) {
    case 'piece':
      return `piece:${subject.pieceId}`;
    case 'board':
      return `board:${subject.boardId}`;
    case 'assembly':
      return `assembly:${subject.assemblyId}`;
  }
};

const subjectExists = (project: StudioProjectV4, subject: StudioCanvasSubjectV4): boolean => {
  switch (subject.kind) {
    case 'piece':
      return Object.hasOwn(project.pieces, subject.pieceId);
    case 'board':
      return Object.hasOwn(project.boards, subject.boardId);
    case 'assembly':
      return Object.hasOwn(project.assemblies, subject.assemblyId);
  }
};

const persistentIds = (project: StudioProjectV4): Set<string> =>
  new Set([
    project.id,
    ...Object.keys(project.pieces),
    ...Object.keys(project.assets),
    ...Object.keys(project.jobs),
    ...Object.keys(project.boards),
    ...Object.values(project.boards).flatMap((board) => [...Object.keys(board.beats), ...Object.keys(board.shots)]),
    ...Object.keys(project.assemblies),
    ...Object.values(project.assemblies).flatMap((assembly) => Object.keys(assembly.soundBindings)),
    ...project.bin.map((entry) => entry.id),
  ]);

const snapshotContext = (value: unknown): StudioPresentationMutationContextV4 | null => {
  if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, CONTEXT_KEYS) || !isDenseInputArrayV4(value.entryIds))
    return null;
  if (!value.entryIds.every(isSafeInputIdV4) || new Set(value.entryIds).size !== value.entryIds.length) return null;
  if (!isCanonicalInputTimestampV4(value.capturedAt)) return null;
  return { entryIds: [...value.entryIds], capturedAt: value.capturedAt };
};

const snapshotLiftRequest = (value: unknown): StudioLiftToBinRequestV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, LIFT_REQUEST_KEYS) ||
    !isDenseInputArrayV4(value.subjects)
  )
    return null;
  if (
    !isSafeInputIdV4(value.projectId) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    value.subjects.length === 0 ||
    value.subjects.length > STUDIO_MAX_BIN_ENTRIES_V4
  ) {
    return null;
  }
  const subjects = value.subjects.map(snapshotLiftableSubject);
  if (subjects.some((subject) => subject === null)) return null;
  return {
    projectId: value.projectId,
    expectedRevision: value.expectedRevision,
    subjects: subjects as StudioCanvasSubjectV4[],
  };
};

const snapshotRestoreRequest = (value: unknown): StudioRestoreFromBinRequestV4 | null => {
  if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, RESTORE_REQUEST_KEYS)) return null;
  if (
    !isSafeInputIdV4(value.projectId) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    !isSafeInputIdV4(value.entryId)
  ) {
    return null;
  }
  return { projectId: value.projectId, expectedRevision: value.expectedRevision, entryId: value.entryId };
};

export const liftStudioCanvasSubjectsToBinV4 = (
  projectValue: unknown,
  requestValue: unknown,
  contextValue: unknown
): StudioPresentationMutationResultV4 => {
  if (!validateStudioProjectV4(projectValue)) return refuse('invalid_project');
  const request = snapshotLiftRequest(requestValue);
  const context = snapshotContext(contextValue);
  if (request === null || context === null || context.entryIds.length !== request.subjects.length) {
    return refuse('invalid_request');
  }
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('subject_not_found');
  if (request.expectedRevision !== project.revision) return refuse('stale_project');
  if (context.capturedAt < project.updatedAt) return refuse('invalid_request');
  if (project.bin.length + request.subjects.length > STUDIO_MAX_BIN_ENTRIES_V4) return refuse('capacity_reached');

  const subjectKeys = request.subjects.map(studioCanvasSubjectKeyV4);
  if (new Set(subjectKeys).size !== subjectKeys.length) return refuse('invalid_request');
  if (request.subjects.some((subject) => !subjectExists(project, subject))) return refuse('subject_not_found');
  const existingSubjects = new Set(project.bin.map((entry) => studioCanvasSubjectKeyV4(entry.subject)));
  if (subjectKeys.some((key) => existingSubjects.has(key))) return refuse('already_binned');
  const ids = persistentIds(project);
  if (context.entryIds.some((entryId) => ids.has(entryId))) return refuse('identity_collision');

  const next: StudioProjectV4 = {
    ...project,
    revision: project.revision + 1,
    bin: [
      ...project.bin,
      ...request.subjects.map((subject, index) => ({
        id: context.entryIds[index]!,
        subject,
        reason: 'lifted' as const,
        liftedAt: context.capturedAt,
      })),
    ],
    updatedAt: context.capturedAt,
  };
  return validateStudioProjectV4(next) ? { status: 'applied', project: next } : refuse('validation_failed');
};

export const restoreStudioCanvasSubjectFromBinV4 = (
  projectValue: unknown,
  requestValue: unknown,
  contextValue: unknown
): StudioPresentationMutationResultV4 => {
  if (!validateStudioProjectV4(projectValue)) return refuse('invalid_project');
  const request = snapshotRestoreRequest(requestValue);
  const context = snapshotContext(contextValue);
  if (request === null || context === null || context.entryIds.length !== 0) return refuse('invalid_request');
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('bin_entry_not_found');
  if (request.expectedRevision !== project.revision) return refuse('stale_project');
  if (context.capturedAt < project.updatedAt) return refuse('invalid_request');
  const index = project.bin.findIndex((entry) => entry.id === request.entryId);
  if (index < 0) return refuse('bin_entry_not_found');

  const next: StudioProjectV4 = {
    ...project,
    revision: project.revision + 1,
    bin: [...project.bin.slice(0, index), ...project.bin.slice(index + 1)],
    updatedAt: context.capturedAt,
  };
  return validateStudioProjectV4(next) ? { status: 'applied', project: next } : refuse('validation_failed');
};
