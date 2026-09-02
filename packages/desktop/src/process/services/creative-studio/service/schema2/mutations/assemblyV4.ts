/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_ASSEMBLIES_V4,
  type StudioAssemblyPictureBindingV2,
  type StudioAssemblyV2,
  type StudioCreateAssemblyMutationContextV4,
  type StudioCreateAssemblyMutationFailureV4,
  type StudioCreateAssemblyMutationResultV4,
  type StudioCreateAssemblyRequestV4,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV4 } from '../validation';
import { isCanonicalStudioPieceHandleV3 } from './pieceHandles';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from './exactInputV4';
import { studioCanvasHandleIsTakenV4, studioPersistentIdentitiesV4 } from './projectAuthorityV4';

const REQUEST_KEYS = new Set(['projectId', 'expectedAuthoringRevision', 'boardId', 'handle']);
const CONTEXT_KEYS = new Set(['assemblyId', 'capturedAt']);

const refuse = (reason: StudioCreateAssemblyMutationFailureV4): StudioCreateAssemblyMutationResultV4 => ({
  status: 'refused',
  reason,
});

const snapshotRequest = (value: unknown): StudioCreateAssemblyRequestV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, REQUEST_KEYS) ||
    !isSafeInputIdV4(value.projectId) ||
    !Number.isSafeInteger(value.expectedAuthoringRevision) ||
    (value.expectedAuthoringRevision as number) < 1 ||
    !isSafeInputIdV4(value.boardId) ||
    !isCanonicalStudioPieceHandleV3(value.handle)
  ) {
    return null;
  }
  return {
    projectId: value.projectId,
    expectedAuthoringRevision: value.expectedAuthoringRevision as number,
    boardId: value.boardId,
    handle: value.handle,
  };
};

const snapshotContext = (value: unknown): StudioCreateAssemblyMutationContextV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, CONTEXT_KEYS) ||
    !isSafeInputIdV4(value.assemblyId) ||
    !isCanonicalInputTimestampV4(value.capturedAt)
  ) {
    return null;
  }
  return { assemblyId: value.assemblyId, capturedAt: value.capturedAt };
};

/**
 * Creates one cut substrate over an existing Board. Every Shot receives one exact timed slate
 * binding, while the Board remains the sole picture-order authority and no generation or spend
 * occurs. This pure mutation is not itself a Director proposal surface.
 */
export const applyStudioCreateAssemblyV4 = (
  projectValue: unknown,
  requestValue: unknown,
  contextValue: unknown
): StudioCreateAssemblyMutationResultV4 => {
  if (!validateStudioProjectV4(projectValue)) return refuse('invalid_project');
  const request = snapshotRequest(requestValue);
  const context = snapshotContext(contextValue);
  if (request === null || context === null) return refuse('invalid_request');
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('invalid_request');
  if (request.expectedAuthoringRevision !== project.authoringRevision) return refuse('stale_project');
  if (context.capturedAt < project.updatedAt) return refuse('invalid_request');
  if (project.assemblyOrder.length >= STUDIO_MAX_ASSEMBLIES_V4) return refuse('capacity_reached');
  if (!Object.hasOwn(project.boards, request.boardId)) return refuse('board_not_found');
  const board = project.boards[request.boardId]!;
  if (studioCanvasHandleIsTakenV4(project, request.handle)) return refuse('handle_taken');
  if (studioPersistentIdentitiesV4(project).has(context.assemblyId)) return refuse('identity_collision');

  const pictureBindings = Object.create(null) as Record<string, StudioAssemblyPictureBindingV2>;
  for (const beatId of board.beatOrder) {
    const shotOrder = board.beats[beatId]!.shotOrder;
    for (let index = 0; index < shotOrder.length; index += 1) {
      const shotId = shotOrder[index]!;
      pictureBindings[shotId] = {
        shotId,
        source: null,
        sourceInSeconds: 0,
        sourceOutSeconds: null,
        join: index === 0 ? 'hard_cut' : 'match_previous',
        staleness: null,
      };
    }
  }
  const assembly: StudioAssemblyV2 = {
    id: context.assemblyId,
    handle: request.handle,
    priorHandles: [],
    boardId: board.id,
    pictureBindings,
    soundBindingOrder: [],
    soundBindings: {},
    createdAt: context.capturedAt,
    updatedAt: context.capturedAt,
  };
  const next = {
    ...project,
    revision: project.revision + 1,
    authoringRevision: project.authoringRevision + 1,
    assemblyOrder: [...project.assemblyOrder, assembly.id],
    assemblies: { ...project.assemblies, [assembly.id]: assembly },
    updatedAt: context.capturedAt,
  };
  return validateStudioProjectV4(next)
    ? { status: 'applied', project: next, assemblyId: assembly.id }
    : refuse('validation_failed');
};
