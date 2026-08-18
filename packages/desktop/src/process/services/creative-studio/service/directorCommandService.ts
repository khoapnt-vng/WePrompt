/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_MAX_SCENES,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorOperationV1,
  type StudioEditableScene,
  type StudioProject,
  type StudioProjectV2,
  type StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError, type CreativeStudioStore } from '@process/services/creative-studio/store';
import {
  applyStudioProjectFields,
  applyStudioSceneMutation,
  applyStudioSceneOrder,
  applyStudioTakeSelection,
} from './projectMutations';
import { applyStudioMutationBatchV2, StudioMutationErrorV2, type StudioMutationReasonV2 } from './schema2';

export type StudioDirectorCommandApplyResult = {
  project: StudioProject;
  appliedRevision: number;
  createdSceneIds: string[];
};

export type StudioDirectorCommandApplyErrorCode =
  | 'deadline_elapsed'
  | 'project_over_capacity'
  | 'scene_limit_exceeded'
  | 'validation_failed';

/** Bounded precommit outcome consumed by the main-process command processor. */
export class StudioDirectorCommandApplyError extends Error {
  readonly reasonCode: StudioDirectorCommandApplyErrorCode;

  constructor(reasonCode: StudioDirectorCommandApplyErrorCode) {
    super(reasonCode);
    this.name = 'StudioDirectorCommandApplyError';
    this.reasonCode = reasonCode;
  }
}

export type StudioDirectorCommitAttribution = Readonly<{
  commitTag: string;
}>;

export type StudioDirectorCommandService = {
  apply(
    command: StudioDirectorCommandRecordV1,
    latestApplyStartMs: number,
    attribution: StudioDirectorCommitAttribution
  ): Promise<StudioDirectorCommandApplyResult>;
};

export type StudioDirectorCommandServiceDeps = {
  store: CreativeStudioStore;
  now?: () => number;
};

export type StudioDirectorCommandApplyResultV2 = {
  project: StudioProjectV2;
  appliedRevision: number;
  createdBeatIds: string[];
  createdShotIds: string[];
};

export type StudioDirectorCommandApplyErrorCodeV2 = 'deadline_elapsed' | StudioMutationReasonV2;

/** Bounded schema-2 precommit outcome consumed by the staged main-process command processor. */
export class StudioDirectorCommandApplyErrorV2 extends Error {
  readonly reasonCode: StudioDirectorCommandApplyErrorCodeV2;

  constructor(reasonCode: StudioDirectorCommandApplyErrorCodeV2) {
    super(reasonCode);
    this.name = 'StudioDirectorCommandApplyErrorV2';
    this.reasonCode = reasonCode;
  }
}

export type StudioDirectorCommandServiceV2 = {
  apply(
    command: StudioDirectorCommandRecordV2,
    latestApplyStartMs: number,
    attribution: StudioDirectorCommitAttribution
  ): Promise<StudioDirectorCommandApplyResultV2>;
};

export type StudioDirectorCommandServiceDepsV2 = {
  store: Pick<CreativeStudioStore, 'updateProjectV2'>;
  now?: () => number;
};

const applyError = (reasonCode: StudioDirectorCommandApplyErrorCode): StudioDirectorCommandApplyError =>
  new StudioDirectorCommandApplyError(reasonCode);

const isProjectStoreError = (error: unknown): error is CreativeStudioStoreError =>
  error instanceof CreativeStudioStoreError &&
  (error.code === 'stale_project' || error.code === 'not_found' || error.code === 'storage_error');

const editableSceneWithChanges = (
  scene: StudioScene,
  changes: Extract<StudioDirectorOperationV1, { kind: 'edit_scene' }>['changes']
): StudioEditableScene => ({
  title: changes.title ?? scene.title,
  purpose: changes.purpose ?? scene.purpose,
  visualPrompt: changes.visualPrompt ?? scene.visualPrompt,
  narration: changes.narration ?? scene.narration,
  onScreenText: changes.onScreenText ?? scene.onScreenText,
  mediaKind: scene.mediaKind,
  durationSeconds: changes.durationSeconds ?? scene.durationSeconds,
  referenceAssetId: scene.referenceAssetId,
});

const addScene = (
  project: StudioProject,
  operation: Extract<StudioDirectorOperationV1, { kind: 'add_scene' }>
): StudioProject => {
  let next = applyStudioSceneMutation(project, {
    sceneId: operation.sceneId,
    scene: {
      title: operation.scene.title,
      purpose: operation.scene.purpose,
      visualPrompt: operation.scene.visualPrompt,
      narration: operation.scene.narration,
      onScreenText: operation.scene.onScreenText,
      mediaKind: operation.scene.mediaKind,
      durationSeconds: operation.scene.durationSeconds,
      referenceAssetId: null,
    },
  });
  if (operation.beforeSceneId === null) return next;
  const order = next.sceneOrder.filter((sceneId) => sceneId !== operation.sceneId);
  const anchorIndex = order.indexOf(operation.beforeSceneId);
  if (anchorIndex < 0) throw applyError('validation_failed');
  order.splice(anchorIndex, 0, operation.sceneId);
  next = applyStudioSceneOrder(next, order);
  return next;
};

const validateOpeningCommand = (project: StudioProject, operations: readonly StudioDirectorOperationV1[]): string[] => {
  const addOperationCount = operations.reduce(
    (count, operation) => count + (operation.kind === 'add_scene' ? 1 : 0),
    0
  );
  if (project.sceneOrder.length + addOperationCount > STUDIO_MAX_SCENES) {
    throw applyError('scene_limit_exceeded');
  }
  if (operations.length === 0) throw applyError('validation_failed');
  const openingSceneIds = new Set(Object.keys(project.scenes));
  const createdSceneIds: string[] = [];
  const addSceneIds = new Set<string>();
  let hasReorder = false;

  for (const operation of operations) {
    if (operation.kind === 'reorder_scenes') {
      hasReorder = true;
      continue;
    }
    if (operation.kind !== 'add_scene') continue;
    if (
      openingSceneIds.has(operation.sceneId) ||
      addSceneIds.has(operation.sceneId) ||
      (operation.beforeSceneId !== null && !openingSceneIds.has(operation.beforeSceneId))
    ) {
      throw applyError('validation_failed');
    }
    addSceneIds.add(operation.sceneId);
    createdSceneIds.push(operation.sceneId);
  }

  if (addSceneIds.size > 0 && hasReorder) throw applyError('validation_failed');
  return createdSceneIds;
};

const applyOperation = (project: StudioProject, operation: StudioDirectorOperationV1): StudioProject => {
  if (operation.kind === 'set_brief') {
    return applyStudioProjectFields(project, { brief: operation.brief });
  }
  if (operation.kind === 'add_scene') return addScene(project, operation);
  if (operation.kind === 'edit_scene') {
    const scene = project.scenes[operation.sceneId];
    if (scene === undefined) throw applyError('validation_failed');
    return applyStudioSceneMutation(project, {
      sceneId: operation.sceneId,
      scene: editableSceneWithChanges(scene, operation.changes),
    });
  }
  if (operation.kind === 'reorder_scenes') return applyStudioSceneOrder(project, operation.sceneOrder);
  if (operation.kind === 'select_take') {
    return applyStudioTakeSelection(project, { sceneId: operation.sceneId, assetId: operation.assetId });
  }
  throw applyError('validation_failed');
};

/** Creates the main-only atomic command service. It performs no renderer notification. */
export const createStudioDirectorCommandService = (
  deps: StudioDirectorCommandServiceDeps
): StudioDirectorCommandService => {
  const now = deps.now ?? Date.now;
  return {
    async apply(command, latestApplyStartMs, attribution) {
      let createdSceneIds: string[] = [];
      try {
        const project = await deps.store.updateProject(
          command.projectId,
          (openingProject) => {
            try {
              if (now() >= latestApplyStartMs) throw applyError('deadline_elapsed');
              if (openingProject.sceneOrder.length > STUDIO_MAX_SCENES) {
                throw applyError('project_over_capacity');
              }
              createdSceneIds = validateOpeningCommand(openingProject, command.operations);
              return command.operations.reduce(applyOperation, openingProject);
            } catch (error) {
              if (error instanceof StudioDirectorCommandApplyError) throw error;
              throw applyError('validation_failed');
            }
          },
          command.expectedRevision,
          attribution.commitTag
        );
        return { project, appliedRevision: project.revision, createdSceneIds: [...createdSceneIds] };
      } catch (error) {
        if (error instanceof StudioDirectorCommandApplyError || isProjectStoreError(error)) throw error;
        throw applyError('validation_failed');
      }
    },
  };
};

const applyErrorV2 = (reasonCode: StudioDirectorCommandApplyErrorCodeV2): StudioDirectorCommandApplyErrorV2 =>
  new StudioDirectorCommandApplyErrorV2(reasonCode);

const isProjectStoreErrorV2 = (error: unknown): error is CreativeStudioStoreError =>
  error instanceof CreativeStudioStoreError &&
  (error.code === 'stale_project' ||
    error.code === 'not_found' ||
    error.code === 'busy' ||
    error.code === 'storage_error' ||
    error.code === 'unsupported_prototype_schema');

/** Creates the staged schema-2 atomic command service without registering it in the runtime. */
export const createStudioDirectorCommandServiceV2 = (
  deps: StudioDirectorCommandServiceDepsV2
): StudioDirectorCommandServiceV2 => {
  const now = deps.now ?? Date.now;
  return {
    async apply(command, latestApplyStartMs, attribution) {
      let createdBeatIds: string[] = [];
      let createdShotIds: string[] = [];
      try {
        const project = await deps.store.updateProjectV2(
          command.projectId,
          (openingProject) => {
            try {
              if (now() >= latestApplyStartMs) throw applyErrorV2('deadline_elapsed');
              const applied = applyStudioMutationBatchV2(openingProject, {
                schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
                projectId: command.projectId,
                expectedRevision: command.expectedRevision,
                operations: command.operations,
              });
              createdBeatIds = [...applied.createdBeatIds];
              createdShotIds = [...applied.createdShotIds];
              return applied.project;
            } catch (error) {
              if (error instanceof StudioDirectorCommandApplyErrorV2) throw error;
              if (error instanceof StudioMutationErrorV2) throw applyErrorV2(error.reasonCode);
              throw applyErrorV2('validation_failed');
            }
          },
          command.expectedRevision,
          attribution.commitTag
        );
        return {
          project,
          appliedRevision: project.revision,
          createdBeatIds: [...createdBeatIds],
          createdShotIds: [...createdShotIds],
        };
      } catch (error) {
        if (error instanceof StudioDirectorCommandApplyErrorV2 || isProjectStoreErrorV2(error)) throw error;
        throw applyErrorV2('validation_failed');
      }
    },
  };
};
