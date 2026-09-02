/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_BIN_BLOCKING_JOB_STATUSES_V4,
  STUDIO_MAX_BIN_ENTRIES_V4,
  STUDIO_MAX_BIN_LIFT_SUBJECTS_V4,
  type StudioBinEligibilityDecisionV4,
  type StudioCanvasBinSubjectV4,
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
import { studioPersistentIdentitiesV4 } from './projectAuthorityV4';

const LIFT_REQUEST_KEYS = new Set(['projectId', 'expectedRevision', 'subjects']);
const RESTORE_REQUEST_KEYS = new Set(['projectId', 'expectedRevision', 'entryId']);
const CONTEXT_KEYS = new Set(['projectId', 'projectRevision', 'entryIds', 'decisions', 'capturedAt']);
const DECISION_KEYS = new Set(['subject', 'state']);
const PIECE_SUBJECT_KEYS = new Set(['kind', 'pieceId']);
const BOARD_SUBJECT_KEYS = new Set(['kind', 'boardId']);
const BOARD_SHOT_SUBJECT_KEYS = new Set(['kind', 'boardId', 'shotId']);
const ASSEMBLY_SUBJECT_KEYS = new Set(['kind', 'assemblyId']);
const BIN_BLOCKING_JOB_STATUSES_V4 = new Set<string>(STUDIO_BIN_BLOCKING_JOB_STATUSES_V4);

const refuse = (reason: StudioPresentationMutationFailureV4): StudioPresentationMutationResultV4 => ({
  status: 'refused',
  reason,
});

export const snapshotStudioCanvasBinSubjectV4 = (value: unknown): StudioCanvasBinSubjectV4 | null => {
  if (!isPlainInputRecordV4(value)) return null;
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  if (kindDescriptor === undefined || !Object.hasOwn(kindDescriptor, 'value')) return null;
  const kind = kindDescriptor.value;
  if (kind === 'piece' && hasExactInputKeysV4(value, PIECE_SUBJECT_KEYS) && isSafeInputIdV4(value.pieceId)) {
    return { kind: 'piece', pieceId: value.pieceId };
  }
  if (kind === 'board' && hasExactInputKeysV4(value, BOARD_SUBJECT_KEYS) && isSafeInputIdV4(value.boardId)) {
    return { kind: 'board', boardId: value.boardId };
  }
  if (
    kind === 'board_shot' &&
    hasExactInputKeysV4(value, BOARD_SHOT_SUBJECT_KEYS) &&
    isSafeInputIdV4(value.boardId) &&
    isSafeInputIdV4(value.shotId)
  ) {
    return { kind: 'board_shot', boardId: value.boardId, shotId: value.shotId };
  }
  if (kind === 'assembly' && hasExactInputKeysV4(value, ASSEMBLY_SUBJECT_KEYS) && isSafeInputIdV4(value.assemblyId)) {
    return { kind: 'assembly', assemblyId: value.assemblyId };
  }
  return null;
};

export const studioCanvasSubjectKeyV4 = (subject: StudioCanvasBinSubjectV4): string => {
  switch (subject.kind) {
    case 'piece':
      return `piece:${subject.pieceId}`;
    case 'board':
      return `board:${subject.boardId}`;
    case 'board_shot':
      return `board_shot:${subject.boardId}:${subject.shotId}`;
    case 'assembly':
      return `assembly:${subject.assemblyId}`;
  }
};

const subjectExists = (project: StudioProjectV4, subject: StudioCanvasBinSubjectV4): boolean => {
  switch (subject.kind) {
    case 'piece':
      return Object.hasOwn(project.pieces, subject.pieceId);
    case 'board':
      return Object.hasOwn(project.boards, subject.boardId);
    case 'board_shot':
      return (
        Object.hasOwn(project.boards, subject.boardId) &&
        Object.hasOwn(project.boards[subject.boardId]!.shots, subject.shotId)
      );
    case 'assembly':
      return Object.hasOwn(project.assemblies, subject.assemblyId);
  }
};

const subjectIsUsedByFilm = (project: StudioProjectV4, subject: StudioCanvasBinSubjectV4): boolean => {
  switch (subject.kind) {
    case 'piece':
      return Object.values(project.assemblies).some(
        (assembly) =>
          Object.values(assembly.pictureBindings).some((binding) => binding.source?.pieceId === subject.pieceId) ||
          Object.values(assembly.soundBindings).some((binding) => binding.source?.pieceId === subject.pieceId)
      );
    case 'board':
    case 'board_shot':
      return Object.values(project.assemblies).some((assembly) => assembly.boardId === subject.boardId);
    case 'assembly':
      return false;
  }
};

/** Work whose progress or cost truth still needs attention may never be quieted inside the Bin. */
export const studioCanvasSubjectHasBlockingWorkV4 = (
  project: StudioProjectV4,
  subject: StudioCanvasBinSubjectV4
): boolean => {
  if (subject.kind !== 'piece' || !Object.hasOwn(project.pieces, subject.pieceId)) return false;
  return project.pieces[subject.pieceId]!.jobIds.some(
    (jobId) => Object.hasOwn(project.jobs, jobId) && BIN_BLOCKING_JOB_STATUSES_V4.has(project.jobs[jobId]!.status)
  );
};

const subjectBoardId = (subject: StudioCanvasBinSubjectV4): string | null =>
  subject.kind === 'board' || subject.kind === 'board_shot' ? subject.boardId : null;

const subjectsOverlap = (left: StudioCanvasBinSubjectV4, right: StudioCanvasBinSubjectV4): boolean => {
  const leftBoardId = subjectBoardId(left);
  return (
    leftBoardId !== null &&
    leftBoardId === subjectBoardId(right) &&
    ((left.kind === 'board' && right.kind === 'board_shot') || (left.kind === 'board_shot' && right.kind === 'board'))
  );
};

const snapshotDecision = (value: unknown): StudioBinEligibilityDecisionV4 | null => {
  if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, DECISION_KEYS)) return null;
  const subject = snapshotStudioCanvasBinSubjectV4(value.subject);
  if (subject === null || (value.state !== 'clear' && value.state !== 'proposed' && value.state !== 'needs_budget')) {
    return null;
  }
  return { subject, state: value.state };
};

const snapshotContext = (value: unknown): StudioPresentationMutationContextV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, CONTEXT_KEYS) ||
    !isDenseInputArrayV4(value.entryIds) ||
    !isDenseInputArrayV4(value.decisions)
  )
    return null;
  if (
    !isSafeInputIdV4(value.projectId) ||
    typeof value.projectRevision !== 'number' ||
    !Number.isSafeInteger(value.projectRevision) ||
    value.projectRevision < 1
  )
    return null;
  if (!value.entryIds.every(isSafeInputIdV4) || new Set(value.entryIds).size !== value.entryIds.length) return null;
  if (!isCanonicalInputTimestampV4(value.capturedAt)) return null;
  const decisions = value.decisions.map(snapshotDecision);
  if (decisions.some((decision) => decision === null)) return null;
  const snapshot = decisions as StudioBinEligibilityDecisionV4[];
  if (new Set(snapshot.map((decision) => studioCanvasSubjectKeyV4(decision.subject))).size !== snapshot.length)
    return null;
  return {
    projectId: value.projectId,
    projectRevision: value.projectRevision,
    entryIds: [...value.entryIds],
    decisions: snapshot,
    capturedAt: value.capturedAt,
  };
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
    value.subjects.length > STUDIO_MAX_BIN_LIFT_SUBJECTS_V4
  ) {
    return null;
  }
  const subjects = value.subjects.map(snapshotStudioCanvasBinSubjectV4);
  if (subjects.some((subject) => subject === null)) return null;
  return {
    projectId: value.projectId,
    expectedRevision: value.expectedRevision,
    subjects: subjects as StudioCanvasBinSubjectV4[],
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
  if (request === null) return refuse('invalid_request');
  const subjectKeys = request.subjects.map(studioCanvasSubjectKeyV4);
  if (new Set(subjectKeys).size !== subjectKeys.length) return refuse('invalid_request');
  const context = snapshotContext(contextValue);
  if (context === null) return refuse('invalid_authority');
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('subject_not_found');
  if (request.expectedRevision !== project.revision) return refuse('stale_project');
  if (
    context.projectId !== project.id ||
    context.projectRevision !== project.revision ||
    context.capturedAt < project.updatedAt ||
    context.entryIds.length !== request.subjects.length ||
    context.decisions.length !== request.subjects.length
  ) {
    return refuse('invalid_authority');
  }
  const existingSubjects = new Set(project.bin.map((entry) => studioCanvasSubjectKeyV4(entry.subject)));
  if (subjectKeys.some((key) => existingSubjects.has(key))) return refuse('already_binned');
  if (
    request.subjects.some((subject, index) =>
      request.subjects.slice(index + 1).some((other) => subjectsOverlap(subject, other))
    ) ||
    request.subjects.some(
      (subject) =>
        subject.kind === 'board_shot' &&
        project.bin.some((entry) => entry.subject.kind === 'board' && entry.subject.boardId === subject.boardId)
    )
  ) {
    return refuse('overlapping_subject');
  }
  if (context.decisions.some((decision, index) => studioCanvasSubjectKeyV4(decision.subject) !== subjectKeys[index])) {
    return refuse('invalid_authority');
  }
  if (context.decisions.some((decision) => decision.state === 'proposed')) return refuse('proposal_pending');
  if (context.decisions.some((decision) => decision.state === 'needs_budget')) return refuse('quote_pending');
  if (request.subjects.some((subject) => !subjectExists(project, subject))) return refuse('subject_not_found');
  if (request.subjects.some((subject) => studioCanvasSubjectHasBlockingWorkV4(project, subject))) {
    return refuse('work_in_progress');
  }
  if (request.subjects.some((subject) => subjectIsUsedByFilm(project, subject))) return refuse('subject_in_film');
  const ids = studioPersistentIdentitiesV4(project);
  if (context.entryIds.some((entryId) => ids.has(entryId))) return refuse('identity_collision');

  const requestedShotIdsByBoard = new Map<string, Set<string>>();
  const boardsToCollapse = new Set(
    request.subjects.flatMap((subject) => (subject.kind === 'board' ? [subject.boardId] : []))
  );
  for (const subject of request.subjects) {
    if (subject.kind !== 'board_shot') continue;
    const shotIds = requestedShotIdsByBoard.get(subject.boardId) ?? new Set<string>();
    shotIds.add(subject.shotId);
    requestedShotIdsByBoard.set(subject.boardId, shotIds);
  }
  for (const [boardId, requestedShotIds] of requestedShotIdsByBoard) {
    const existingShotIds = new Set(
      project.bin.flatMap((entry) =>
        entry.subject.kind === 'board_shot' && entry.subject.boardId === boardId ? [entry.subject.shotId] : []
      )
    );
    const board = project.boards[boardId]!;
    const allShotIds = board.beatOrder.flatMap((beatId) => board.beats[beatId]!.shotOrder);
    if (allShotIds.every((shotId) => existingShotIds.has(shotId) || requestedShotIds.has(shotId))) {
      boardsToCollapse.add(boardId);
    }
  }

  const emittedBoards = new Set<string>();
  const liftedEntries = request.subjects.flatMap((subject, index) => {
    const boardId = subject.kind === 'board' || subject.kind === 'board_shot' ? subject.boardId : null;
    if (boardId !== null && boardsToCollapse.has(boardId)) {
      if (emittedBoards.has(boardId)) return [];
      emittedBoards.add(boardId);
      return [
        {
          id: context.entryIds[index]!,
          subject: { kind: 'board' as const, boardId },
          reason: 'lifted' as const,
          liftedAt: context.capturedAt,
        },
      ];
    }
    return [
      {
        id: context.entryIds[index]!,
        subject,
        reason: 'lifted' as const,
        liftedAt: context.capturedAt,
      },
    ];
  });
  const retainedBin = project.bin.filter(
    (entry) => entry.subject.kind !== 'board_shot' || !boardsToCollapse.has(entry.subject.boardId)
  );
  if (liftedEntries.length + retainedBin.length > STUDIO_MAX_BIN_ENTRIES_V4) return refuse('capacity_reached');

  const next: StudioProjectV4 = {
    ...project,
    revision: project.revision + 1,
    bin: [...liftedEntries, ...retainedBin],
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
  if (request === null) return refuse('invalid_request');
  const context = snapshotContext(contextValue);
  if (context === null) return refuse('invalid_authority');
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('bin_entry_not_found');
  if (request.expectedRevision !== project.revision) return refuse('stale_project');
  if (
    context.projectId !== project.id ||
    context.projectRevision !== project.revision ||
    context.entryIds.length !== 0 ||
    context.decisions.length !== 0 ||
    context.capturedAt < project.updatedAt
  ) {
    return refuse('invalid_authority');
  }
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
