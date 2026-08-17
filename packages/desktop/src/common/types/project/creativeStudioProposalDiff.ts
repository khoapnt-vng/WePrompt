/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioEditableScene,
  StudioEditableSceneField,
  StudioProposalDiff,
  StudioProposalSceneChange,
  StudioReplaceStoryboardProposalPayload,
} from './creativeStudioTypes';

/**
 * Declaration order of the fields a proposal may rewrite. It is also the order a shot's changed
 * fields are reported in, so the summary reads the same way twice for the same edit.
 */
export const EDITABLE_SCENE_FIELDS = [
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
] as const satisfies readonly StudioEditableSceneField[];

/** The storyboard region a proposal would replace. Both project projections satisfy it. */
export type StudioProposalDiffSource = {
  sceneOrder: string[];
  scenes: Record<string, StudioEditableScene>;
};

const changedFields = (current: StudioEditableScene, proposed: StudioEditableScene): StudioEditableSceneField[] =>
  EDITABLE_SCENE_FIELDS.filter((field) => current[field] !== proposed[field]);

/**
 * What a proposal would change, matched by shot position rather than by scene id.
 *
 * `propose_storyboard` is a whole-script replace that mints fresh scene ids every call, so id-based
 * matching reports every re-proposal as a total rewrite. Position is the only stable pairing, and it
 * is also what a reader means by "shot 2".
 */
export const computeStudioProposalDiff = (
  current: StudioProposalDiffSource,
  payload: StudioReplaceStoryboardProposalPayload
): StudioProposalDiff => {
  const currentScenes = current.sceneOrder
    .map((sceneId) => current.scenes[sceneId])
    .filter((scene): scene is StudioEditableScene => scene !== undefined);
  const proposedScenes = payload.sceneOrder
    .map((sceneId) => payload.scenes[sceneId])
    .filter((scene): scene is StudioEditableScene => scene !== undefined);
  const paired = Math.min(currentScenes.length, proposedScenes.length);
  const changed: StudioProposalSceneChange[] = [];
  for (let position = 0; position < paired; position += 1) {
    const fields = changedFields(currentScenes[position], proposedScenes[position]);
    if (fields.length > 0) changed.push({ position: position + 1, fields });
  }
  return {
    added: Math.max(0, proposedScenes.length - currentScenes.length),
    removed: Math.max(0, currentScenes.length - proposedScenes.length),
    changed,
  };
};

const isEditableSceneField = (value: unknown): value is StudioEditableSceneField =>
  typeof value === 'string' && (EDITABLE_SCENE_FIELDS as readonly string[]).includes(value);

const normaliseSceneChange = (value: unknown): StudioProposalSceneChange | null => {
  if (typeof value !== 'object' || value === null) return null;
  const change = value as Partial<StudioProposalSceneChange>;
  if (!Number.isInteger(change.position) || (change.position as number) < 1) return null;
  if (!Array.isArray(change.fields) || !change.fields.every(isEditableSceneField)) return null;
  return { position: change.position as number, fields: [...change.fields] };
};

/**
 * IPC-boundary normaliser. A proposal recorded before the diff existed carries no `diff` at all, and a
 * renderer must never crash on — or trust the shape of — a field it did not compute itself.
 */
export const normaliseStudioProposalDiff = (value: unknown): StudioProposalDiff | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const diff = value as Partial<StudioProposalDiff>;
  if (!Number.isInteger(diff.added) || !Number.isInteger(diff.removed)) return undefined;
  if ((diff.added as number) < 0 || (diff.removed as number) < 0) return undefined;
  if (!Array.isArray(diff.changed)) return undefined;
  const changed = diff.changed.map(normaliseSceneChange);
  if (changed.some((change) => change === null)) return undefined;
  return {
    added: diff.added as number,
    removed: diff.removed as number,
    changed: changed as StudioProposalSceneChange[],
  };
};
