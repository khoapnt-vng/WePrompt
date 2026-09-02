/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_PIECES_V3,
  type StudioAssemblyPictureBindingV2,
  type StudioCanvasBlockSubjectV4,
  type StudioCanvasBinEntryV4,
  type StudioCanvasFailureV4,
  type StudioMemberStalenessV4,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { studioCanvasSubjectKeyV4 } from '../mutations/presentationV4';
import { validateStudioProjectV4 } from '../validation';

export type StudioAssemblyPictureTimelineEntryV4 = {
  beatId: string;
  beatPosition: number;
  shotId: string;
  shotPosition: number;
  binding: StudioAssemblyPictureBindingV2;
};

export type StudioCanvasPresentationV4 = {
  activeSubjects: StudioCanvasBlockSubjectV4[];
  /** Maximal adjacent Piece groups; singleton arrays are ordinary Piece blocks, never run records. */
  visiblePieceGroups: string[][];
  visibleShotIdsByBoard: Record<string, string[]>;
  bin: StudioCanvasBinEntryV4[];
  pieceCapacityUsed: number;
  pieceCapacityLimit: number;
  binItemCount: number;
  visibleBlockCount: number;
  density: StudioCanvasDensityV4;
};

export type StudioCanvasDensityV4 = 'generous' | 'default' | 'quiet';
export type StudioCanvasStaleActionV4 = 're_render_chain' | 'keep';
export type StudioCanvasFailureActionV4 = 'retry';

const requireProject = (value: unknown): StudioProjectV4 => {
  if (!validateStudioProjectV4(value)) throw new TypeError('invalid_schema_7_projection_input');
  return value;
};

/** Picture order has one authority: the referenced board's Beat/Shot reading order. */
export const deriveStudioAssemblyPictureTimelineV4 = (
  projectValue: unknown,
  assemblyId: string
): StudioAssemblyPictureTimelineEntryV4[] => {
  const project = requireProject(projectValue);
  if (!Object.hasOwn(project.assemblies, assemblyId)) throw new TypeError('assembly_not_found');
  const assembly = project.assemblies[assemblyId]!;
  const board = project.boards[assembly.boardId]!;
  return board.beatOrder.flatMap((beatId, beatPosition) =>
    board.beats[beatId]!.shotOrder.map((shotId, shotPosition) => ({
      beatId,
      beatPosition,
      shotId,
      shotPosition,
      binding: assembly.pictureBindings[shotId]!,
    }))
  );
};

const visiblePieceOrderV4 = (project: StudioProjectV4): string[] => {
  const binnedPieceIds = new Set(
    project.bin.flatMap((entry) => (entry.subject.kind === 'piece' ? [entry.subject.pieceId] : []))
  );
  return project.pieceOrder.filter((pieceId) => !binnedPieceIds.has(pieceId));
};

const visiblePieceGroupsV4 = (project: StudioProjectV4, visiblePieceOrder: readonly string[]): string[][] => {
  const groups: string[][] = [];
  for (const pieceId of visiblePieceOrder) {
    const piece = project.pieces[pieceId]!;
    const previousGroup = groups.at(-1);
    const previousPieceId = previousGroup?.at(-1);
    const previousPiece = previousPieceId === undefined ? undefined : project.pieces[previousPieceId];
    if (
      previousGroup !== undefined &&
      previousPiece !== undefined &&
      piece.runStem !== null &&
      piece.kind === previousPiece.kind &&
      piece.runStem === previousPiece.runStem
    ) {
      previousGroup.push(pieceId);
    } else {
      groups.push([pieceId]);
    }
  }
  return groups;
};

/** The visible Piece order is the only valid input to adjacency-derived run grouping. */
export const deriveStudioVisiblePieceOrderV4 = (projectValue: unknown): string[] =>
  visiblePieceOrderV4(requireProject(projectValue));

/** Run identity is adjacency-derived; no persisted run object or suffix parsing is admitted. */
export const deriveStudioVisiblePieceGroupsV4 = (projectValue: unknown): string[][] => {
  const project = requireProject(projectValue);
  return visiblePieceGroupsV4(project, visiblePieceOrderV4(project));
};

export const studioCanvasDensityV4 = (visibleBlockCount: number): StudioCanvasDensityV4 => {
  if (!Number.isSafeInteger(visibleBlockCount) || visibleBlockCount < 0) {
    throw new TypeError('invalid_visible_block_count');
  }
  return visibleBlockCount <= 3 ? 'generous' : visibleBlockCount <= 8 ? 'default' : 'quiet';
};

/**
 * Canvas order is dependency-derived and never hand-authored. The Wave-1 dependency ladder is
 * source Pieces, then Boards, then their cuts; later kinds extend this derivation rather than add a
 * persisted block-order field.
 */
export const projectStudioCanvasPresentationV4 = (projectValue: unknown): StudioCanvasPresentationV4 => {
  const project = requireProject(projectValue);
  const binned = new Set(project.bin.map((entry) => studioCanvasSubjectKeyV4(entry.subject)));
  const visiblePieceOrder = visiblePieceOrderV4(project);
  const visiblePieceGroups = visiblePieceGroupsV4(project, visiblePieceOrder);
  const activeSubjects: StudioCanvasBlockSubjectV4[] = visiblePieceOrder.map((pieceId) => ({
    kind: 'piece',
    pieceId,
  }));
  const visibleShotIdsByBoard = Object.create(null) as Record<string, string[]>;

  for (const boardId of project.boardOrder) {
    const boardSubject = { kind: 'board' as const, boardId };
    if (binned.has(studioCanvasSubjectKeyV4(boardSubject))) continue;
    const board = project.boards[boardId]!;
    const visibleShotIds = board.beatOrder
      .flatMap((beatId) => board.beats[beatId]!.shotOrder)
      .filter((shotId) => !binned.has(studioCanvasSubjectKeyV4({ kind: 'board_shot', boardId, shotId })));
    if (visibleShotIds.length === 0) continue;
    visibleShotIdsByBoard[boardId] = visibleShotIds;
    activeSubjects.push(boardSubject);
  }

  for (const assemblyId of project.assemblyOrder) {
    const subject = { kind: 'assembly' as const, assemblyId };
    if (!binned.has(studioCanvasSubjectKeyV4(subject))) activeSubjects.push(subject);
  }

  const bin = project.bin
    .map((entry) => ({ ...entry, subject: { ...entry.subject } }))
    .toSorted((left, right) => (left.liftedAt === right.liftedAt ? 0 : left.liftedAt > right.liftedAt ? -1 : 1));
  const nonPieceBlockCount = activeSubjects.length - visiblePieceOrder.length;
  const visibleBlockCount = visiblePieceGroups.length + nonPieceBlockCount;
  return {
    activeSubjects,
    visiblePieceGroups,
    visibleShotIdsByBoard,
    bin,
    pieceCapacityUsed: project.pieceOrder.length,
    pieceCapacityLimit: STUDIO_MAX_PIECES_V3,
    binItemCount: project.bin.length,
    visibleBlockCount,
    density: studioCanvasDensityV4(visibleBlockCount),
  };
};

export const studioCanvasActionsForStalenessV4 = (
  staleness: StudioMemberStalenessV4
): readonly StudioCanvasStaleActionV4[] =>
  staleness.keptAt !== null ? [] : staleness.cause === 'chain' ? ['re_render_chain', 'keep'] : ['keep'];

/** A spent failure never offers an unqualified retry; returned silence is the sharpest case. */
export const studioCanvasActionsForFailureV4 = (
  failure: StudioCanvasFailureV4
): readonly StudioCanvasFailureActionV4[] => (failure.costTruth === 'not_spent' ? ['retry'] : []);

export const studioCanvasStatusUsesConditionsRegionV4 = (status: string): boolean =>
  status === 'generating' || status === 'proposed' || status === 'needs_budget';

export const studioCanvasStatusNeedsAttentionV4 = (status: string): boolean =>
  status === 'proposed' ||
  status === 'needs_budget' ||
  status === 'failed' ||
  status === 'stale' ||
  status === 'queued' ||
  status === 'generating' ||
  status === 'rendering';
