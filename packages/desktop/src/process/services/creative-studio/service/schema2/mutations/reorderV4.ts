/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAssemblyV2,
  StudioBoardV2,
  StudioReorderBoardMemberRequestV4,
  StudioReorderMutationContextV4,
  StudioReorderMutationFailureV4,
  StudioReorderMutationResultV4,
  StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV4 } from '../validation';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from './exactInputV4';

const BEAT_REQUEST_KEYS = new Set(['kind', 'projectId', 'expectedAuthoringRevision', 'boardId', 'beatId', 'direction']);
const SHOT_REQUEST_KEYS = new Set(['kind', 'projectId', 'expectedAuthoringRevision', 'boardId', 'shotId', 'direction']);
const CONTEXT_KEYS = new Set(['capturedAt']);

const refuse = (reason: StudioReorderMutationFailureV4): StudioReorderMutationResultV4 => ({
  status: 'refused',
  reason,
});

const snapshotRequest = (value: unknown): StudioReorderBoardMemberRequestV4 | null => {
  if (!isPlainInputRecordV4(value)) return null;
  if (
    !isSafeInputIdV4(value.projectId) ||
    !Number.isSafeInteger(value.expectedAuthoringRevision) ||
    (value.expectedAuthoringRevision as number) < 1 ||
    !isSafeInputIdV4(value.boardId) ||
    (value.direction !== 'earlier' && value.direction !== 'later')
  ) {
    return null;
  }
  if (value.kind === 'beat' && hasExactInputKeysV4(value, BEAT_REQUEST_KEYS) && isSafeInputIdV4(value.beatId)) {
    return {
      kind: 'beat',
      projectId: value.projectId,
      expectedAuthoringRevision: value.expectedAuthoringRevision as number,
      boardId: value.boardId,
      beatId: value.beatId,
      direction: value.direction,
    };
  }
  if (value.kind === 'shot' && hasExactInputKeysV4(value, SHOT_REQUEST_KEYS) && isSafeInputIdV4(value.shotId)) {
    return {
      kind: 'shot',
      projectId: value.projectId,
      expectedAuthoringRevision: value.expectedAuthoringRevision as number,
      boardId: value.boardId,
      shotId: value.shotId,
      direction: value.direction,
    };
  }
  return null;
};

const snapshotContext = (value: unknown): StudioReorderMutationContextV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, CONTEXT_KEYS) ||
    !isCanonicalInputTimestampV4(value.capturedAt)
  ) {
    return null;
  }
  return { capturedAt: value.capturedAt };
};

const moveAdjacent = <T>(items: readonly T[], index: number, direction: 'earlier' | 'later'): T[] => {
  const target = direction === 'earlier' ? index - 1 : index + 1;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};

const withBoard = (project: StudioProjectV4, board: StudioBoardV2, capturedAt: string): StudioProjectV4 => ({
  ...project,
  revision: project.revision + 1,
  authoringRevision: project.authoringRevision + 1,
  boards: { ...project.boards, [board.id]: board },
  updatedAt: capturedAt,
});

const reorderBeat = (
  project: StudioProjectV4,
  board: StudioBoardV2,
  request: Extract<StudioReorderBoardMemberRequestV4, { kind: 'beat' }>,
  capturedAt: string
): StudioReorderMutationResultV4 => {
  const index = board.beatOrder.indexOf(request.beatId);
  if (index < 0) return refuse('member_not_found');
  const target = request.direction === 'earlier' ? index - 1 : index + 1;
  if (target < 0 || target >= board.beatOrder.length) return refuse('boundary_reached');
  const next = withBoard(
    project,
    { ...board, beatOrder: moveAdjacent(board.beatOrder, index, request.direction), updatedAt: capturedAt },
    capturedAt
  );
  return validateStudioProjectV4(next)
    ? { status: 'applied', project: next, consequence: { kind: 'free', crossedBeatBoundary: false } }
    : refuse('validation_failed');
};

const locateShot = (board: StudioBoardV2, shotId: string): { beatId: string; index: number } | null => {
  for (const beatId of board.beatOrder) {
    const index = board.beats[beatId]!.shotOrder.indexOf(shotId);
    if (index >= 0) return { beatId, index };
  }
  return null;
};

const markAssemblyChainStale = (
  assembly: StudioAssemblyV2,
  affectedShotIds: readonly string[],
  nextShotOrder: readonly string[],
  sourceAuthoringRevision: number,
  capturedAt: string
): { assembly: StudioAssemblyV2; changed: boolean; staled: boolean } => {
  const affected = new Set(affectedShotIds);
  let changed = false;
  let staled = false;
  const pictureBindings = { ...assembly.pictureBindings };
  for (let index = 0; index < nextShotOrder.length; index += 1) {
    const shotId = nextShotOrder[index]!;
    const binding = pictureBindings[shotId]!;
    if (!affected.has(shotId)) continue;
    const join = index === 0 ? 'hard_cut' : binding.join;
    if (binding.source === null) {
      if (join !== binding.join) {
        pictureBindings[shotId] = { ...binding, join };
        changed = true;
      }
      continue;
    }
    pictureBindings[shotId] = {
      ...binding,
      join,
      staleness: {
        cause: 'chain',
        upstreamShotId: index === 0 ? null : nextShotOrder[index - 1]!,
        sourceAuthoringRevision,
        keptAt: null,
      },
    };
    changed = true;
    staled = true;
  }
  return changed
    ? { assembly: { ...assembly, pictureBindings, updatedAt: capturedAt }, changed, staled }
    : { assembly, changed, staled };
};

const normalizeAssemblyBeatHeads = (
  assembly: StudioAssemblyV2,
  board: StudioBoardV2,
  beatIds: readonly string[],
  capturedAt: string
): StudioAssemblyV2 => {
  let changed = false;
  const pictureBindings = { ...assembly.pictureBindings };
  for (const beatId of beatIds) {
    const firstShotId = board.beats[beatId]!.shotOrder[0]!;
    const binding = pictureBindings[firstShotId]!;
    if (binding.join === 'hard_cut') continue;
    pictureBindings[firstShotId] = { ...binding, join: 'hard_cut' };
    changed = true;
  }
  return changed ? { ...assembly, pictureBindings, updatedAt: capturedAt } : assembly;
};

const reorderShotWithinBeat = (
  project: StudioProjectV4,
  board: StudioBoardV2,
  request: Extract<StudioReorderBoardMemberRequestV4, { kind: 'shot' }>,
  beatId: string,
  index: number,
  capturedAt: string
): StudioReorderMutationResultV4 => {
  const beat = board.beats[beatId]!;
  const nextShotOrder = moveAdjacent(beat.shotOrder, index, request.direction);
  const earliestChangedIndex = Math.min(index, request.direction === 'earlier' ? index - 1 : index + 1);
  const affectedShotIds = nextShotOrder.slice(earliestChangedIndex);
  const nextBoard: StudioBoardV2 = {
    ...board,
    beats: { ...board.beats, [beatId]: { ...beat, shotOrder: nextShotOrder } },
    updatedAt: capturedAt,
  };
  const assemblies = { ...project.assemblies };
  const affectedAssemblyIds: string[] = [];
  for (const assemblyId of project.assemblyOrder) {
    const assembly = assemblies[assemblyId]!;
    if (assembly.boardId !== board.id) continue;
    const marked = markAssemblyChainStale(
      assembly,
      affectedShotIds,
      nextShotOrder,
      project.authoringRevision,
      capturedAt
    );
    assemblies[assemblyId] = marked.assembly;
    if (marked.staled) affectedAssemblyIds.push(assemblyId);
  }
  const next: StudioProjectV4 = {
    ...withBoard(project, nextBoard, capturedAt),
    assemblies,
  };
  return validateStudioProjectV4(next)
    ? {
        status: 'applied',
        project: next,
        consequence: {
          kind: 'chain_stale',
          requiresRerenderQuote: true,
          affectedAssemblyIds,
          affectedShotIds,
        },
      }
    : refuse('validation_failed');
};

const reorderShotAcrossBeats = (
  project: StudioProjectV4,
  board: StudioBoardV2,
  request: Extract<StudioReorderBoardMemberRequestV4, { kind: 'shot' }>,
  beatId: string,
  capturedAt: string
): StudioReorderMutationResultV4 => {
  const beatIndex = board.beatOrder.indexOf(beatId);
  const targetBeatIndex = request.direction === 'earlier' ? beatIndex - 1 : beatIndex + 1;
  if (targetBeatIndex < 0 || targetBeatIndex >= board.beatOrder.length) return refuse('boundary_reached');
  const source = board.beats[beatId]!;
  if (source.shotOrder.length === 1) return refuse('boundary_reached');
  const targetBeatId = board.beatOrder[targetBeatIndex]!;
  const target = board.beats[targetBeatId]!;
  const sourceShotOrder = source.shotOrder.filter((shotId) => shotId !== request.shotId);
  const targetShotOrder =
    request.direction === 'earlier' ? [...target.shotOrder, request.shotId] : [request.shotId, ...target.shotOrder];
  const nextBoard: StudioBoardV2 = {
    ...board,
    beats: {
      ...board.beats,
      [beatId]: { ...source, shotOrder: sourceShotOrder },
      [targetBeatId]: { ...target, shotOrder: targetShotOrder },
    },
    updatedAt: capturedAt,
  };
  const assemblies = { ...project.assemblies };
  for (const assemblyId of project.assemblyOrder) {
    const assembly = assemblies[assemblyId]!;
    if (assembly.boardId === board.id) {
      assemblies[assemblyId] = normalizeAssemblyBeatHeads(assembly, nextBoard, [beatId, targetBeatId], capturedAt);
    }
  }
  const next = { ...withBoard(project, nextBoard, capturedAt), assemblies };
  return validateStudioProjectV4(next)
    ? { status: 'applied', project: next, consequence: { kind: 'free', crossedBeatBoundary: true } }
    : refuse('validation_failed');
};

const reorderShot = (
  project: StudioProjectV4,
  board: StudioBoardV2,
  request: Extract<StudioReorderBoardMemberRequestV4, { kind: 'shot' }>,
  capturedAt: string
): StudioReorderMutationResultV4 => {
  const location = locateShot(board, request.shotId);
  if (location === null) return refuse('member_not_found');
  const order = board.beats[location.beatId]!.shotOrder;
  const target = request.direction === 'earlier' ? location.index - 1 : location.index + 1;
  return target >= 0 && target < order.length
    ? reorderShotWithinBeat(project, board, request, location.beatId, location.index, capturedAt)
    : reorderShotAcrossBeats(project, board, request, location.beatId, capturedAt);
};

/**
 * Applies one exact adjacent move. It never creates a quote, authorization, Job, or spend receipt;
 * an intra-Beat move records playable chain-stale media and names the quote still required.
 */
export const applyStudioBoardMemberReorderV4 = (
  projectValue: unknown,
  requestValue: unknown,
  contextValue: unknown
): StudioReorderMutationResultV4 => {
  if (!validateStudioProjectV4(projectValue)) return refuse('invalid_project');
  const request = snapshotRequest(requestValue);
  const context = snapshotContext(contextValue);
  if (request === null || context === null) return refuse('invalid_request');
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('member_not_found');
  if (request.expectedAuthoringRevision !== project.authoringRevision) return refuse('stale_project');
  if (context.capturedAt < project.updatedAt) return refuse('invalid_request');
  const board = project.boards[request.boardId];
  if (board === undefined) return refuse('member_not_found');
  return request.kind === 'beat'
    ? reorderBeat(project, board, request, context.capturedAt)
    : reorderShot(project, board, request, context.capturedAt);
};
