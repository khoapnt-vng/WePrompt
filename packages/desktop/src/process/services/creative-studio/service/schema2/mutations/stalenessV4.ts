/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioKeepStalePictureRequestV4,
  StudioProjectV4,
  StudioStalenessDecisionFailureV4,
  StudioStalenessDecisionResultV4,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV4 } from '../validation';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from './exactInputV4';

const PICTURE_REQUEST_KEYS = new Set(['kind', 'projectId', 'expectedAuthoringRevision', 'assemblyId', 'shotId']);
const CONTEXT_KEYS = new Set(['capturedAt']);

const refuse = (reason: StudioStalenessDecisionFailureV4): StudioStalenessDecisionResultV4 => ({
  status: 'refused',
  reason,
});

const snapshotRequest = (value: unknown): StudioKeepStalePictureRequestV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !isSafeInputIdV4(value.projectId) ||
    !Number.isSafeInteger(value.expectedAuthoringRevision) ||
    (value.expectedAuthoringRevision as number) < 1 ||
    !isSafeInputIdV4(value.assemblyId)
  ) {
    return null;
  }
  if (value.kind === 'picture' && hasExactInputKeysV4(value, PICTURE_REQUEST_KEYS) && isSafeInputIdV4(value.shotId)) {
    return {
      kind: 'picture',
      projectId: value.projectId,
      expectedAuthoringRevision: value.expectedAuthoringRevision as number,
      assemblyId: value.assemblyId,
      shotId: value.shotId,
    };
  }
  return null;
};

/** Records the person's bounded Keep decision without clearing the truthful stale state. */
export const keepStudioStalePictureV4 = (
  projectValue: unknown,
  requestValue: unknown,
  contextValue: unknown
): StudioStalenessDecisionResultV4 => {
  if (!validateStudioProjectV4(projectValue)) return refuse('invalid_project');
  const request = snapshotRequest(requestValue);
  if (
    request === null ||
    !isPlainInputRecordV4(contextValue) ||
    !hasExactInputKeysV4(contextValue, CONTEXT_KEYS) ||
    !isCanonicalInputTimestampV4(contextValue.capturedAt)
  ) {
    return refuse('invalid_request');
  }
  const project = projectValue;
  if (request.projectId !== project.id) return refuse('member_not_found');
  if (request.expectedAuthoringRevision !== project.authoringRevision) return refuse('stale_project');
  if (contextValue.capturedAt < project.updatedAt) return refuse('invalid_request');
  const assembly = project.assemblies[request.assemblyId];
  if (assembly === undefined) return refuse('member_not_found');
  const binding = assembly.pictureBindings[request.shotId];
  if (binding === undefined) return refuse('member_not_found');
  if (binding.staleness === null) return refuse('member_not_stale');
  if (binding.staleness.keptAt !== null) return refuse('already_kept');

  const nextBinding = {
    ...binding,
    staleness: { ...binding.staleness, keptAt: contextValue.capturedAt },
  };
  const nextAssembly = {
    ...assembly,
    pictureBindings: { ...assembly.pictureBindings, [request.shotId]: nextBinding },
    updatedAt: contextValue.capturedAt,
  };
  const next: StudioProjectV4 = {
    ...project,
    revision: project.revision + 1,
    authoringRevision: project.authoringRevision + 1,
    assemblies: { ...project.assemblies, [assembly.id]: nextAssembly },
    updatedAt: contextValue.capturedAt,
  };
  return validateStudioProjectV4(next) ? { status: 'applied', project: next } : refuse('validation_failed');
};
