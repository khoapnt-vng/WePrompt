/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAssemblyPictureBindingV2,
  StudioCanvasBinEntryV4,
  StudioCanvasFailureV4,
  StudioCanvasSubjectV4,
  StudioMemberStalenessV4,
  StudioProjectV4,
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
  activeSubjects: StudioCanvasSubjectV4[];
  bin: StudioCanvasBinEntryV4[];
};

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
  const assembly = project.assemblies[assemblyId];
  if (assembly === undefined) throw new TypeError('assembly_not_found');
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

/**
 * Canvas order is dependency-derived and never hand-authored. The Wave-1 dependency ladder is
 * source Pieces, then Boards, then their cuts; later kinds extend this derivation rather than add a
 * persisted block-order field.
 */
export const projectStudioCanvasPresentationV4 = (projectValue: unknown): StudioCanvasPresentationV4 => {
  const project = requireProject(projectValue);
  const binned = new Set(project.bin.map((entry) => studioCanvasSubjectKeyV4(entry.subject)));
  const activeSubjects: StudioCanvasSubjectV4[] = [
    ...project.pieceOrder.map((pieceId) => ({ kind: 'piece' as const, pieceId })),
    ...project.boardOrder.map((boardId) => ({ kind: 'board' as const, boardId })),
    ...project.assemblyOrder.map((assemblyId) => ({ kind: 'assembly' as const, assemblyId })),
  ].filter((subject) => !binned.has(studioCanvasSubjectKeyV4(subject)));
  return { activeSubjects, bin: project.bin.map((entry) => ({ ...entry, subject: { ...entry.subject } })) };
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
