/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioEditableScene,
  StudioJob,
  StudioProject,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import { requestedMediaKind } from '@/common/types/project/creativeStudioOutputRole';
import { CreativeStudioStoreError, reconcilePersistedStudioCuts } from '@process/services/creative-studio/store';

const MEDIA_KINDS = new Set(['image', 'video']);
const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJob['status']> = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

/** Fields that may be changed by the Studio project editor. */
export type StudioProjectFieldPatch = Partial<
  Pick<StudioProject, 'name' | 'brief' | 'aspectRatio' | 'targetDurationSeconds' | 'resolution'>
>;

/** A safe, stable service error that can cross only through the bridge error mapper. */
export class CreativeStudioServiceError extends Error {
  readonly code:
    | 'invalid_payload'
    | 'storyboard_exists'
    | 'planning_unavailable'
    | 'busy'
    | 'provider_error'
    | 'invalid_route';

  constructor(code: CreativeStudioServiceError['code']) {
    super(code);
    this.name = 'CreativeStudioServiceError';
    this.code = code;
  }
}

const invalid = (message: string): CreativeStudioStoreError => new CreativeStudioStoreError('invalid_payload', message);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum;

const assertText: (value: unknown, maximum: number, label: string, required?: boolean) => asserts value is string = (
  value,
  maximum,
  label,
  required = false
) => {
  if (typeof value !== 'string' || value.length > maximum || (required && value.trim().length === 0)) {
    throw invalid(`Invalid Studio ${label}`);
  }
};

/** Validates the complete renderer-editable scene payload before persistence work begins. */
export const assertStudioEditableScene = (scene: StudioEditableScene): void => {
  assertText(scene.title, 256, 'scene title');
  assertText(scene.purpose, 256, 'scene purpose');
  assertText(scene.visualPrompt, 8 * 1024, 'scene visual prompt');
  assertText(scene.narration, 4 * 1024, 'scene narration');
  assertText(scene.onScreenText, 1024, 'scene on-screen text');
  if (!MEDIA_KINDS.has(scene.mediaKind)) throw invalid('Invalid Studio scene media kind');
  if (!isIntegerInRange(scene.durationSeconds, 1, 60)) throw invalid('Invalid Studio scene duration');
  if (scene.referenceAssetId !== null && !/^[A-Za-z0-9_-]{1,256}$/.test(scene.referenceAssetId)) {
    throw invalid('Invalid Studio reference asset id');
  }
};

const editableSceneReviewState = (scene: StudioEditableScene): StudioScene['reviewState'] =>
  scene.title.trim().length > 0 && scene.visualPrompt.trim().length > 0 ? 'ready' : 'draft';

/** Applies the whitelisted project fields without mutating the source project. */
export function applyStudioProjectFields(project: StudioProject, patch: StudioProjectFieldPatch): StudioProject {
  return {
    ...project,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.brief === undefined ? {} : { brief: patch.brief }),
    ...(patch.aspectRatio === undefined ? {} : { aspectRatio: patch.aspectRatio }),
    ...(patch.targetDurationSeconds === undefined ? {} : { targetDurationSeconds: patch.targetDurationSeconds }),
    ...(patch.resolution === undefined ? {} : { resolution: patch.resolution }),
  };
}

/** Applies one validated scene add, edit, or removal without mutating the source project. */
export function applyStudioSceneMutation(
  project: StudioProject,
  input: { sceneId: string; scene: StudioEditableScene | null }
): StudioProject {
  if (input.scene !== null) assertStudioEditableScene(input.scene);
  const next = structuredClone(project);
  if (input.scene === null) {
    if (!Object.hasOwn(next.scenes, input.sceneId)) {
      throw new CreativeStudioStoreError('not_found', 'Studio scene not found');
    }
    const scene = next.scenes[input.sceneId];
    if (scene.assetIds.length > 0 || scene.jobIds.length > 0) {
      throw invalid('Studio scene with assets or jobs cannot be removed');
    }
    delete next.scenes[input.sceneId];
    next.sceneOrder = next.sceneOrder.filter((sceneId) => sceneId !== input.sceneId);
    return reconcilePersistedStudioCuts(next);
  }
  if (!Object.hasOwn(next.scenes, input.sceneId) && next.sceneOrder.length >= 24) {
    throw invalid('Studio project has too many scenes');
  }
  if (input.scene.referenceAssetId !== null) {
    const reference = next.assets[input.scene.referenceAssetId];
    if (
      reference === undefined ||
      reference.projectId !== next.id ||
      reference.sceneId !== input.sceneId ||
      reference.mediaKind !== 'image'
    ) {
      throw invalid('Studio reference asset does not belong to its scene');
    }
  }

  const current = next.scenes[input.sceneId];
  if (current === undefined) {
    next.scenes[input.sceneId] = {
      id: input.sceneId,
      ...input.scene,
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: editableSceneReviewState(input.scene),
    };
  } else {
    const mediaKindChanged = current.mediaKind !== input.scene.mediaKind;
    if (
      mediaKindChanged &&
      current.jobIds.some((jobId) => {
        const job = next.jobs[jobId];
        return job !== undefined && NONTERMINAL_JOB_STATUSES.has(job.status);
      })
    ) {
      throw new CreativeStudioServiceError('busy');
    }
    const selectedAsset = current.selectedAssetId === null ? undefined : next.assets[current.selectedAssetId];
    const selectedAssetId =
      mediaKindChanged && selectedAsset?.mediaKind !== requestedMediaKind(input.scene.mediaKind, 'take')
        ? null
        : current.selectedAssetId;
    next.scenes[input.sceneId] = {
      ...current,
      ...input.scene,
      id: current.id,
      selectedAssetId,
      assetIds: [...current.assetIds],
      jobIds: [...current.jobIds],
      reviewState: mediaKindChanged ? editableSceneReviewState(input.scene) : current.reviewState,
    };
  }
  if (!next.sceneOrder.includes(input.sceneId)) next.sceneOrder.push(input.sceneId);
  return reconcilePersistedStudioCuts(next);
}

/** Applies an exact storyboard scene permutation without mutating the source project. */
export function applyStudioSceneOrder(project: StudioProject, sceneOrder: readonly string[]): StudioProject {
  if (
    project.sceneOrder.length !== sceneOrder.length ||
    new Set(sceneOrder).size !== sceneOrder.length ||
    sceneOrder.some((sceneId) => !Object.hasOwn(project.scenes, sceneId))
  ) {
    throw invalid('Studio scene order must be an exact permutation');
  }
  return reconcilePersistedStudioCuts({ ...project, sceneOrder: [...sceneOrder] });
}

/** Selects a canonical generated take without mutating the source project. */
export function applyStudioTakeSelection(
  project: StudioProject,
  input: { sceneId: string; assetId: string }
): StudioProject {
  const scene = project.scenes[input.sceneId];
  const asset = project.assets[input.assetId];
  if (scene === undefined || asset === undefined || !isCanonicalStudioGeneratedTake(asset, project.id, scene)) {
    throw invalid('Studio asset does not belong to its selected scene');
  }
  return reconcilePersistedStudioCuts({
    ...project,
    scenes: {
      ...project.scenes,
      [input.sceneId]: { ...scene, selectedAssetId: input.assetId },
    },
  });
}
