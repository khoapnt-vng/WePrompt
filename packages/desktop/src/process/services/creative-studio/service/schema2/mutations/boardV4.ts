/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_BEATS_PER_BOARD_V4,
  STUDIO_MAX_BOARDS_V4,
  STUDIO_MAX_SHOTS_PER_BOARD_V4,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type StudioBoardDraftBeatV4,
  type StudioCreateBoardMutationContextV4,
  type StudioCreateBoardMutationFailureV4,
  type StudioCreateBoardMutationResultV4,
  type StudioCreateBoardRequestV4,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV4 } from '../validation';
import { isCanonicalStudioPieceHandleV3 } from './pieceHandles';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isDenseInputArrayV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from './exactInputV4';
import { studioCanvasHandleIsTakenV4, studioPersistentIdentitiesV4 } from './projectAuthorityV4';

const REQUEST_KEYS = new Set(['projectId', 'expectedAuthoringRevision', 'handle', 'beats']);
const BEAT_KEYS = new Set(['title', 'story', 'targetSeconds', 'shots']);
const SHOT_KEYS = new Set(['shootingScript', 'durationSeconds']);
const CONTEXT_KEYS = new Set(['boardId', 'beatIds', 'shotIds', 'capturedAt']);

const refuse = (reason: StudioCreateBoardMutationFailureV4): StudioCreateBoardMutationResultV4 => ({
  status: 'refused',
  reason,
});

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;

const isStringWithin = (value: unknown, maximum: number, allowEmpty: boolean): value is string =>
  typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= maximum;

const snapshotBeat = (value: unknown): StudioBoardDraftBeatV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, BEAT_KEYS) ||
    !isStringWithin(value.title, 256, false) ||
    !isStringWithin(value.story, STUDIO_MAX_STORY_LENGTH, true) ||
    (value.targetSeconds !== null && !isIntegerInRange(value.targetSeconds, 1, 1_440)) ||
    !isDenseInputArrayV4(value.shots) ||
    value.shots.length === 0
  ) {
    return null;
  }
  const shots: StudioBoardDraftBeatV4['shots'] = [];
  for (const candidate of value.shots) {
    if (
      !isPlainInputRecordV4(candidate) ||
      !hasExactInputKeysV4(candidate, SHOT_KEYS) ||
      !isStringWithin(candidate.shootingScript, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH, false) ||
      !isIntegerInRange(candidate.durationSeconds, STUDIO_MIN_SHOT_SECONDS, STUDIO_MAX_SHOT_SECONDS)
    ) {
      return null;
    }
    shots.push({ shootingScript: candidate.shootingScript, durationSeconds: candidate.durationSeconds });
  }
  return { title: value.title, story: value.story, targetSeconds: value.targetSeconds as number | null, shots };
};

/** One exact parser shared by direct Board application and immutable proposal records. */
export const snapshotStudioBoardDraftBeatsV4 = (value: unknown): StudioBoardDraftBeatV4[] | null => {
  if (!isDenseInputArrayV4(value) || value.length === 0 || value.length > STUDIO_MAX_BEATS_PER_BOARD_V4) return null;
  const beats: StudioBoardDraftBeatV4[] = [];
  let shotCount = 0;
  for (const candidate of value) {
    const beat = snapshotBeat(candidate);
    if (beat === null) return null;
    shotCount += beat.shots.length;
    if (shotCount > STUDIO_MAX_SHOTS_PER_BOARD_V4) return null;
    beats.push(beat);
  }
  return beats;
};

const snapshotRequest = (value: unknown): StudioCreateBoardRequestV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, REQUEST_KEYS) ||
    !isSafeInputIdV4(value.projectId) ||
    !isIntegerInRange(value.expectedAuthoringRevision, 1, Number.MAX_SAFE_INTEGER) ||
    !isCanonicalStudioPieceHandleV3(value.handle)
  ) {
    return null;
  }
  const beats = snapshotStudioBoardDraftBeatsV4(value.beats);
  if (beats === null) return null;
  return {
    projectId: value.projectId,
    expectedAuthoringRevision: value.expectedAuthoringRevision,
    handle: value.handle,
    beats,
  };
};

const snapshotIdList = (value: unknown): string[] | null => {
  if (!isDenseInputArrayV4(value)) return null;
  const ids: string[] = [];
  for (const candidate of value) {
    if (!isSafeInputIdV4(candidate)) return null;
    ids.push(candidate);
  }
  return new Set(ids).size === ids.length ? ids : null;
};

const snapshotContext = (value: unknown): StudioCreateBoardMutationContextV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, CONTEXT_KEYS) ||
    !isSafeInputIdV4(value.boardId) ||
    !isCanonicalInputTimestampV4(value.capturedAt)
  ) {
    return null;
  }
  const beatIds = snapshotIdList(value.beatIds);
  const shotIds = snapshotIdList(value.shotIds);
  return beatIds === null || shotIds === null
    ? null
    : { boardId: value.boardId, beatIds, shotIds, capturedAt: value.capturedAt };
};

/**
 * Applies the authored contents of one accepted Board proposal. The request contains no durable
 * identities; Main supplies those separately and the mutation performs no generation or spend.
 */
export const applyStudioCreateBoardV4 = (
  projectValue: unknown,
  requestValue: unknown,
  contextValue: unknown
): StudioCreateBoardMutationResultV4 => {
  if (!validateStudioProjectV4(projectValue)) return refuse('invalid_project');
  const request = snapshotRequest(requestValue);
  const context = snapshotContext(contextValue);
  if (request === null || context === null) return refuse('invalid_request');
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('invalid_request');
  if (request.expectedAuthoringRevision !== project.authoringRevision) return refuse('stale_project');
  if (context.capturedAt < project.updatedAt) return refuse('invalid_request');
  if (project.boardOrder.length >= STUDIO_MAX_BOARDS_V4) return refuse('capacity_reached');
  if (studioCanvasHandleIsTakenV4(project, request.handle)) return refuse('handle_taken');
  const shotCount = request.beats.reduce((total, beat) => total + beat.shots.length, 0);
  if (context.beatIds.length !== request.beats.length || context.shotIds.length !== shotCount) {
    return refuse('invalid_request');
  }
  const issuedIds = [context.boardId, ...context.beatIds, ...context.shotIds];
  const existingIds = studioPersistentIdentitiesV4(project);
  if (new Set(issuedIds).size !== issuedIds.length || issuedIds.some((id) => existingIds.has(id))) {
    return refuse('identity_collision');
  }

  let shotCursor = 0;
  const beats = Object.create(null) as StudioProjectV4['boards'][string]['beats'];
  const shots = Object.create(null) as StudioProjectV4['boards'][string]['shots'];
  for (let beatIndex = 0; beatIndex < request.beats.length; beatIndex += 1) {
    const draft = request.beats[beatIndex]!;
    const beatId = context.beatIds[beatIndex]!;
    const shotOrder: string[] = [];
    for (const shotDraft of draft.shots) {
      const shotId = context.shotIds[shotCursor]!;
      shotCursor += 1;
      shotOrder.push(shotId);
      shots[shotId] = {
        id: shotId,
        shootingScript: shotDraft.shootingScript,
        durationSeconds: shotDraft.durationSeconds,
        createdAt: context.capturedAt,
        updatedAt: context.capturedAt,
      };
    }
    beats[beatId] = {
      id: beatId,
      title: draft.title,
      story: draft.story,
      targetSeconds: draft.targetSeconds,
      shotOrder,
    };
  }
  const board: StudioProjectV4['boards'][string] = {
    id: context.boardId,
    handle: request.handle,
    priorHandles: [],
    beatOrder: [...context.beatIds],
    beats,
    shots,
    createdAt: context.capturedAt,
    updatedAt: context.capturedAt,
  };
  const next: StudioProjectV4 = {
    ...project,
    revision: project.revision + 1,
    authoringRevision: project.authoringRevision + 1,
    boardOrder: [...project.boardOrder, board.id],
    boards: { ...project.boards, [board.id]: board },
    updatedAt: context.capturedAt,
  };
  return validateStudioProjectV4(next)
    ? {
        status: 'applied',
        project: next,
        boardId: board.id,
        createdBeatIds: [...context.beatIds],
        createdShotIds: [...context.shotIds],
      }
    : refuse('validation_failed');
};
