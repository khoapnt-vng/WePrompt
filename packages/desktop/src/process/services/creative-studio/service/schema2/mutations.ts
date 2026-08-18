/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_ITEMS,
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_TAKE_ITEMS,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioShot,
  type StudioEditableShot,
  type StudioEditableShotChanges,
  type StudioEditableBeat,
  type StudioEditableBeatChanges,
  type StudioJobV2,
  type StudioMutationBatchV2,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioBeat,
  type StudioBinItem,
} from '@/common/types/project/creativeStudioTypes';
import { reconcileStudioCutsV2, studioClipHasCutDependencyV2, type StudioCutReconciliationScopeV2 } from './cuts';
import { validateStudioProjectV2 } from './validation';

export type StudioMutationReasonV2 =
  | 'section_capacity_reached'
  | 'section_clip_capacity_reached'
  | 'project_clip_capacity_reached'
  | 'invalid_clip_duration'
  | 'dependency_blocked'
  | 'identity_collision'
  | 'invalid_operation'
  | 'validation_failed';

export type StudioMutationApplyResultV2 = {
  project: StudioProjectV2;
  createdSectionIds: string[];
  createdClipIds: string[];
};

/** A bounded mutation failure safe for translation by the service boundary. */
export class StudioMutationErrorV2 extends Error {
  readonly reasonCode: StudioMutationReasonV2;

  constructor(reasonCode: StudioMutationReasonV2) {
    super(reasonCode);
    this.name = 'StudioMutationErrorV2';
    this.reasonCode = reasonCode;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const MEDIA_KINDS = new Set(['image', 'video']);
const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);
const BATCH_KEYS = new Set(['schemaVersion', 'projectId', 'expectedRevision', 'operations']);
const BEAT_INPUT_KEYS = new Set(['title', 'storyLine', 'visualPrompt']);
const BEAT_CHANGE_KEYS = new Set(['title', 'storyLine', 'visualPrompt']);
const SHOT_INPUT_KEYS = new Set([
  'shotPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const SHOT_CHANGE_KEYS = new Set([
  'shotPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const BIN_BEAT_KEYS = new Set(['kind', 'sectionId']);
const BIN_ASSET_KEYS = new Set(['kind', 'assetId']);
const OPERATION_KEYS: Readonly<Record<StudioMutationOperationV2['kind'], ReadonlySet<string>>> = {
  set_brief: new Set(['kind', 'brief']),
  add_section: new Set(['kind', 'sectionId', 'section', 'firstClipId', 'firstClip', 'beforeSectionId']),
  edit_section: new Set(['kind', 'sectionId', 'changes']),
  reorder_sections: new Set(['kind', 'sectionOrder']),
  park_section: new Set(['kind', 'sectionId']),
  restore_section: new Set(['kind', 'sectionId', 'beforeSectionId']),
  add_clip: new Set(['kind', 'sectionId', 'clipId', 'clip', 'beforeClipId']),
  edit_clip: new Set(['kind', 'clipId', 'changes']),
  delete_clip: new Set(['kind', 'clipId']),
  reorder_clips: new Set(['kind', 'sectionId', 'clipOrder']),
  park_take: new Set(['kind', 'clipId', 'assetId']),
  select_shelved_take: new Set(['kind', 'clipId', 'assetId']),
  remove_shelf_alias: new Set(['kind', 'assetId']),
  reorder_shelf: new Set(['kind', 'shelf']),
  select_take: new Set(['kind', 'clipId', 'assetId']),
};

const fail = (reasonCode: StudioMutationReasonV2): never => {
  throw new StudioMutationErrorV2(reasonCode);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));

const ownValue = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const defineOwn = <T>(record: Record<string, T>, id: string, value: T): void => {
  Object.defineProperty(record, id, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
};

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isStringWithin = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;
const isSafeAnchor = (value: unknown): value is string | null => value === null || isSafeId(value);
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);

const isDenseArray = (value: unknown, maximumLength: number): value is unknown[] => {
  try {
    if (!Array.isArray(value) || value.length > maximumLength || Reflect.ownKeys(value).length !== value.length + 1) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const hasOnlyDataPropertiesDeep = (value: unknown, seen = new Set<object>()): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return true;
  seen.add(value);

  try {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return false;
      if (!hasOnlyDataPropertiesDeep(descriptor.value, seen)) return false;
    }
  } catch {
    return false;
  }

  return true;
};

const isUniqueSafeIdArray = (value: unknown, maximumLength: number): value is string[] => {
  if (!isDenseArray(value, maximumLength)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (!isSafeId(id) || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
};

const isEditableBeat = (value: unknown): value is StudioEditableBeat =>
  isRecord(value) &&
  hasExactKeys(value, BEAT_INPUT_KEYS) &&
  isStringWithin(value.title, 256) &&
  isStringWithin(value.storyLine, 4 * 1024) &&
  isStringWithin(value.visualPrompt, 8 * 1024);

const isEditableBeatChanges = (value: unknown): value is StudioEditableBeatChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => BEAT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'title') || isStringWithin(value.title, 256)) &&
    (!Object.hasOwn(value, 'storyLine') || isStringWithin(value.storyLine, 4 * 1024)) &&
    (!Object.hasOwn(value, 'visualPrompt') || isStringWithin(value.visualPrompt, 8 * 1024))
  );
};

const isEditableShotShape = (value: unknown): value is StudioEditableShot =>
  isRecord(value) &&
  hasExactKeys(value, SHOT_INPUT_KEYS) &&
  isStringWithin(value.shotPrompt, 8 * 1024) &&
  isStringWithin(value.narration, 4 * 1024) &&
  isStringWithin(value.onScreenText, 1024) &&
  typeof value.mediaKind === 'string' &&
  MEDIA_KINDS.has(value.mediaKind) &&
  Object.hasOwn(value, 'durationSeconds') &&
  (value.referenceAssetId === null || isSafeId(value.referenceAssetId));

const isEditableShotChangesShape = (value: unknown): value is StudioEditableShotChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => SHOT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'shotPrompt') || isStringWithin(value.shotPrompt, 8 * 1024)) &&
    (!Object.hasOwn(value, 'narration') || isStringWithin(value.narration, 4 * 1024)) &&
    (!Object.hasOwn(value, 'onScreenText') || isStringWithin(value.onScreenText, 1024)) &&
    (!Object.hasOwn(value, 'mediaKind') || (typeof value.mediaKind === 'string' && MEDIA_KINDS.has(value.mediaKind))) &&
    (!Object.hasOwn(value, 'durationSeconds') || value.durationSeconds !== undefined) &&
    (!Object.hasOwn(value, 'referenceAssetId') || value.referenceAssetId === null || isSafeId(value.referenceAssetId))
  );
};

const isBinItem = (value: unknown): value is StudioBinItem => {
  if (!isRecord(value)) return false;
  if (value.kind === 'section') return hasExactKeys(value, BIN_BEAT_KEYS) && isSafeId(value.sectionId);
  if (value.kind === 'asset') return hasExactKeys(value, BIN_ASSET_KEYS) && isSafeId(value.assetId);
  return false;
};

const isBinItemArray = (value: unknown): value is StudioBinItem[] => {
  if (!isDenseArray(value, STUDIO_MAX_BIN_ITEMS)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!isBinItem(value[index])) return false;
  }
  return true;
};

const assertOperationShape: (value: unknown) => asserts value is StudioMutationOperationV2 = (value) => {
  if (!isRecord(value)) fail('invalid_operation');
  const operation = value as Record<string, unknown>;
  if (typeof operation.kind !== 'string' || !Object.hasOwn(OPERATION_KEYS, operation.kind)) {
    fail('invalid_operation');
  }
  const kind = operation.kind as StudioMutationOperationV2['kind'];
  if (!hasExactKeys(operation, OPERATION_KEYS[kind])) fail('invalid_operation');

  switch (kind) {
    case 'set_brief':
      if (!isStringWithin(operation.brief, 16 * 1024)) fail('invalid_operation');
      return;
    case 'add_section':
      if (
        !isSafeId(operation.sectionId) ||
        !isRecord(operation.section) ||
        !hasExactKeys(operation.section, BEAT_INPUT_KEYS) ||
        !isSafeId(operation.firstClipId) ||
        !isRecord(operation.firstClip) ||
        !hasExactKeys(operation.firstClip, SHOT_INPUT_KEYS) ||
        !isSafeAnchor(operation.beforeSectionId)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'edit_section':
      if (!isSafeId(operation.sectionId) || !isEditableBeatChanges(operation.changes)) fail('invalid_operation');
      return;
    case 'reorder_sections':
      if (!isUniqueSafeIdArray(operation.sectionOrder, STUDIO_MAX_BEATS)) fail('invalid_operation');
      return;
    case 'park_section':
      if (!isSafeId(operation.sectionId)) fail('invalid_operation');
      return;
    case 'restore_section':
      if (!isSafeId(operation.sectionId) || !isSafeAnchor(operation.beforeSectionId)) fail('invalid_operation');
      return;
    case 'add_clip':
      if (
        !isSafeId(operation.sectionId) ||
        !isSafeId(operation.clipId) ||
        !isRecord(operation.clip) ||
        !hasExactKeys(operation.clip, SHOT_INPUT_KEYS) ||
        !isSafeAnchor(operation.beforeClipId)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'edit_clip':
      if (!isSafeId(operation.clipId) || !isEditableShotChangesShape(operation.changes)) fail('invalid_operation');
      return;
    case 'delete_clip':
      if (!isSafeId(operation.clipId)) fail('invalid_operation');
      return;
    case 'reorder_clips':
      if (!isSafeId(operation.sectionId) || !isUniqueSafeIdArray(operation.clipOrder, STUDIO_MAX_SHOTS_PER_BEAT)) {
        fail('invalid_operation');
      }
      return;
    case 'park_take':
    case 'select_shelved_take':
    case 'select_take':
      if (!isSafeId(operation.clipId) || !isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'remove_shelf_alias':
      if (!isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'reorder_shelf':
      if (!isBinItemArray(operation.shelf)) fail('invalid_operation');
      return;
  }
};

const assertBatchEnvelope = (project: StudioProjectV2, batch: unknown): unknown[] => {
  if (!isRecord(batch)) fail('invalid_operation');
  const envelope = batch as Record<string, unknown>;
  if (
    !hasExactKeys(envelope, BATCH_KEYS) ||
    envelope.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
    envelope.projectId !== project.id ||
    envelope.expectedRevision !== project.revision ||
    !isInteger(envelope.expectedRevision) ||
    !isDenseArray(envelope.operations, STUDIO_MAX_MUTATION_OPERATIONS) ||
    envelope.operations.length < 1
  ) {
    fail('invalid_operation');
  }
  return envelope.operations as unknown[];
};

const assertShotDuration: (mediaKind: StudioShot['mediaKind'], value: unknown) => asserts value is number = (
  mediaKind,
  value
) => {
  const minimum = mediaKind === 'video' ? STUDIO_MIN_SHOT_SECONDS : 1;
  const maximum = mediaKind === 'video' ? STUDIO_MAX_SHOT_SECONDS : 60;
  if (!isInteger(value) || value < minimum || value > maximum) fail('invalid_clip_duration');
};

const insertBefore = (values: readonly string[], value: string, before: string | null): string[] => {
  if (before === null) return [...values, value];
  const index = values.indexOf(before);
  if (index < 0) fail('invalid_operation');
  return [...values.slice(0, index), value, ...values.slice(index)];
};

const isExactPermutation = <T>(current: readonly T[], next: readonly T[], identity: (value: T) => string): boolean => {
  if (current.length !== next.length) return false;
  const currentIdentities = new Set<string>();
  const nextIdentities = new Set<string>();
  for (let index = 0; index < current.length; index += 1) currentIdentities.add(identity(current[index]!));
  for (let index = 0; index < next.length; index += 1) {
    const nextIdentity = identity(next[index]!);
    if (nextIdentities.has(nextIdentity) || !currentIdentities.has(nextIdentity)) return false;
    nextIdentities.add(nextIdentity);
  }
  return true;
};

const copyArray = <T>(value: readonly T[]): T[] => {
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) result.push(value[index]!);
  return result;
};

const binIdentity = (item: StudioBinItem): string =>
  item.kind === 'section' ? `section:${item.sectionId}` : `asset:${item.assetId}`;

const findShotOwner = (project: StudioProjectV2, shotId: string): StudioBeat | undefined =>
  Object.values(project.sections).find((beat) => beat.clipOrder.includes(shotId));

const assetHasCutDependency = (project: StudioProjectV2, assetId: string): boolean =>
  Object.values(project.cuts).some((cut) => Object.values(cut.clips).some((cutClip) => cutClip.assetId === assetId));

const binHasAsset = (project: StudioProjectV2, assetId: string): boolean =>
  project.shelf.some((item) => item.kind === 'asset' && item.assetId === assetId);

const assertCanonicalTake = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string
): [StudioShot, StudioAssetV2] => {
  const shot = ownValue(project.clips, shotId);
  const asset = ownValue(project.assets, assetId);
  if (shot === undefined || asset === undefined || !isCanonicalStudioGeneratedTakeV2(asset, project.id, shot)) {
    fail('invalid_operation');
  }
  return [shot, asset];
};

const assertReferenceAsset = (project: StudioProjectV2, shot: StudioShot): void => {
  if (shot.referenceAssetId === null) return;
  const asset = ownValue(project.assets, shot.referenceAssetId);
  if (asset === undefined || asset.clipId !== shot.id || !shot.assetIds.includes(asset.id)) {
    fail('invalid_operation');
  }
};

const binCounts = (bin: readonly StudioBinItem[]): { beats: number; assets: number } => ({
  beats: bin.filter((item) => item.kind === 'section').length,
  assets: bin.filter((item) => item.kind === 'asset').length,
});

/**
 * Applies one ordered mutation batch to an isolated draft. Persistence owns CAS,
 * timestamps, revision advancement, and renderer projection.
 */
export const applyStudioMutationBatchV2 = (
  project: StudioProjectV2,
  batch: StudioMutationBatchV2
): StudioMutationApplyResultV2 => {
  if (!validateStudioProjectV2(project)) fail('validation_failed');
  let draft: StudioProjectV2;
  try {
    draft = structuredClone(project);
  } catch {
    fail('validation_failed');
  }
  if (!hasOnlyDataPropertiesDeep(batch)) fail('invalid_operation');
  let batchSnapshot: unknown;
  try {
    batchSnapshot = structuredClone(batch as unknown);
  } catch {
    fail('invalid_operation');
  }
  const operations = assertBatchEnvelope(draft, batchSnapshot);
  const knownBeatIds = new Set(Object.keys(draft.sections));
  const knownShotIds = new Set(Object.keys(draft.clips));
  const createdBeatIds: string[] = [];
  const createdShotIds: string[] = [];

  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const rawOperation = operations[operationIndex];
    assertOperationShape(rawOperation);
    const operation = rawOperation;
    let cutReconciliation: StudioCutReconciliationScopeV2 | null = null;

    switch (operation.kind) {
      case 'set_brief':
        draft.brief = operation.brief;
        break;

      case 'add_section': {
        if (operation.beforeSectionId !== null && !draft.sectionOrder.includes(operation.beforeSectionId)) {
          fail('invalid_operation');
        }
        if (Object.keys(draft.sections).length >= STUDIO_MAX_BEATS) fail('section_capacity_reached');
        if (Object.keys(draft.clips).length >= STUDIO_MAX_SHOTS_PER_PROJECT) fail('project_clip_capacity_reached');
        if (knownBeatIds.has(operation.sectionId) || knownShotIds.has(operation.firstClipId)) {
          fail('identity_collision');
        }
        if (!isEditableBeat(operation.section) || !isEditableShotShape(operation.firstClip)) {
          fail('invalid_operation');
        }
        if (operation.firstClip.referenceAssetId !== null) fail('invalid_operation');
        assertShotDuration(operation.firstClip.mediaKind, operation.firstClip.durationSeconds);

        const beat: StudioBeat = {
          id: operation.sectionId,
          title: operation.section.title,
          storyLine: operation.section.storyLine,
          visualPrompt: operation.section.visualPrompt,
          clipOrder: [operation.firstClipId],
        };
        const shot: StudioShot = {
          id: operation.firstClipId,
          ...operation.firstClip,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
        };
        defineOwn(draft.sections, beat.id, beat);
        defineOwn(draft.clips, shot.id, shot);
        draft.sectionOrder = insertBefore(draft.sectionOrder, beat.id, operation.beforeSectionId);
        knownBeatIds.add(beat.id);
        knownShotIds.add(shot.id);
        createdBeatIds.push(beat.id);
        createdShotIds.push(shot.id);
        break;
      }

      case 'edit_section': {
        const beat = ownValue(draft.sections, operation.sectionId);
        if (beat === undefined) fail('invalid_operation');
        defineOwn(draft.sections, beat.id, { ...beat, ...operation.changes, id: beat.id });
        break;
      }

      case 'reorder_sections':
        if (!isExactPermutation(draft.sectionOrder, operation.sectionOrder, (id) => id)) fail('invalid_operation');
        draft.sectionOrder = copyArray(operation.sectionOrder);
        cutReconciliation = { kind: 'structure' };
        break;

      case 'park_section': {
        const activeIndex = draft.sectionOrder.indexOf(operation.sectionId);
        if (activeIndex < 0 || ownValue(draft.sections, operation.sectionId) === undefined) fail('invalid_operation');
        const counts = binCounts(draft.shelf);
        if (draft.shelf.length >= STUDIO_MAX_BIN_ITEMS || counts.beats >= STUDIO_MAX_BIN_BEAT_ITEMS) {
          fail('validation_failed');
        }
        draft.sectionOrder = draft.sectionOrder.filter((beatId) => beatId !== operation.sectionId);
        draft.shelf = [...draft.shelf, { kind: 'section', sectionId: operation.sectionId }];
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'restore_section': {
        const binIndex = draft.shelf.findIndex(
          (item) => item.kind === 'section' && item.sectionId === operation.sectionId
        );
        if (binIndex < 0 || ownValue(draft.sections, operation.sectionId) === undefined) fail('invalid_operation');
        if (operation.beforeSectionId !== null && !draft.sectionOrder.includes(operation.beforeSectionId)) {
          fail('invalid_operation');
        }
        draft.shelf = [...draft.shelf.slice(0, binIndex), ...draft.shelf.slice(binIndex + 1)];
        draft.sectionOrder = insertBefore(draft.sectionOrder, operation.sectionId, operation.beforeSectionId);
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'add_clip': {
        const beat = ownValue(draft.sections, operation.sectionId);
        if (beat === undefined) fail('invalid_operation');
        if (operation.beforeClipId !== null && !beat.clipOrder.includes(operation.beforeClipId)) {
          fail('invalid_operation');
        }
        if (beat.clipOrder.length >= STUDIO_MAX_SHOTS_PER_BEAT) fail('section_clip_capacity_reached');
        if (Object.keys(draft.clips).length >= STUDIO_MAX_SHOTS_PER_PROJECT) fail('project_clip_capacity_reached');
        if (knownShotIds.has(operation.clipId)) fail('identity_collision');
        if (!isEditableShotShape(operation.clip)) fail('invalid_operation');
        if (operation.clip.referenceAssetId !== null) fail('invalid_operation');
        assertShotDuration(operation.clip.mediaKind, operation.clip.durationSeconds);

        const shot: StudioShot = {
          id: operation.clipId,
          ...operation.clip,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
        };
        defineOwn(draft.clips, shot.id, shot);
        defineOwn(draft.sections, beat.id, {
          ...beat,
          clipOrder: insertBefore(beat.clipOrder, shot.id, operation.beforeClipId),
        });
        knownShotIds.add(shot.id);
        createdShotIds.push(shot.id);
        break;
      }

      case 'edit_clip': {
        const current = ownValue(draft.clips, operation.clipId);
        if (current === undefined) fail('invalid_operation');
        const next: StudioShot = { ...current, ...operation.changes, id: current.id };
        assertShotDuration(next.mediaKind, next.durationSeconds);
        assertReferenceAsset(draft, next);
        const mediaKindChanged = current.mediaKind !== next.mediaKind;
        const hasBinnedTake = draft.shelf.some((item) => {
          if (item.kind !== 'asset') return false;
          return ownValue(draft.assets, item.assetId)?.clipId === current.id;
        });
        const hasNonterminalJob = current.jobIds.some((jobId) => {
          const job = ownValue(draft.jobs, jobId);
          return job !== undefined && NONTERMINAL_JOB_STATUSES.has(job.status);
        });
        if (
          mediaKindChanged &&
          (hasBinnedTake ||
            current.selectedAssetId !== null ||
            studioClipHasCutDependencyV2(draft, current.id) ||
            hasNonterminalJob)
        ) {
          fail('dependency_blocked');
        }
        defineOwn(draft.clips, next.id, next);
        break;
      }

      case 'delete_clip': {
        const shot = ownValue(draft.clips, operation.clipId);
        const owner = findShotOwner(draft, operation.clipId);
        if (shot === undefined || owner === undefined) fail('invalid_operation');
        const hasBinAlias = draft.shelf.some((item) => {
          if (item.kind !== 'asset') return false;
          return ownValue(draft.assets, item.assetId)?.clipId === shot.id;
        });
        if (
          shot.assetIds.length > 0 ||
          shot.jobIds.length > 0 ||
          hasBinAlias ||
          studioClipHasCutDependencyV2(draft, shot.id)
        ) {
          fail('dependency_blocked');
        }
        delete draft.clips[shot.id];
        defineOwn(draft.sections, owner.id, {
          ...owner,
          clipOrder: owner.clipOrder.filter((shotId) => shotId !== shot.id),
        });
        break;
      }

      case 'reorder_clips': {
        const beat = ownValue(draft.sections, operation.sectionId);
        if (beat === undefined || !isExactPermutation(beat.clipOrder, operation.clipOrder, (id) => id)) {
          fail('invalid_operation');
        }
        defineOwn(draft.sections, beat.id, { ...beat, clipOrder: copyArray(operation.clipOrder) });
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'park_take': {
        const [shot] = assertCanonicalTake(draft, operation.clipId, operation.assetId);
        if (binHasAsset(draft, operation.assetId)) fail('invalid_operation');
        if (shot.selectedAssetId === operation.assetId || assetHasCutDependency(draft, operation.assetId)) {
          fail('dependency_blocked');
        }
        const counts = binCounts(draft.shelf);
        if (draft.shelf.length >= STUDIO_MAX_BIN_ITEMS || counts.assets >= STUDIO_MAX_BIN_TAKE_ITEMS) {
          fail('validation_failed');
        }
        draft.shelf = [...draft.shelf, { kind: 'asset', assetId: operation.assetId }];
        break;
      }

      case 'select_shelved_take': {
        const [shot] = assertCanonicalTake(draft, operation.clipId, operation.assetId);
        const binIndex = draft.shelf.findIndex((item) => item.kind === 'asset' && item.assetId === operation.assetId);
        if (binIndex < 0) fail('invalid_operation');
        draft.shelf = [...draft.shelf.slice(0, binIndex), ...draft.shelf.slice(binIndex + 1)];
        defineOwn(draft.clips, shot.id, { ...shot, selectedAssetId: operation.assetId });
        cutReconciliation = { kind: 'selection', clipId: shot.id };
        break;
      }

      case 'remove_shelf_alias': {
        const binIndex = draft.shelf.findIndex((item) => item.kind === 'asset' && item.assetId === operation.assetId);
        if (binIndex < 0) fail('invalid_operation');
        const asset = ownValue(draft.assets, operation.assetId);
        const shot = asset?.clipId === null || asset === undefined ? undefined : ownValue(draft.clips, asset.clipId);
        if (shot?.selectedAssetId === operation.assetId || assetHasCutDependency(draft, operation.assetId)) {
          fail('dependency_blocked');
        }
        draft.shelf = [...draft.shelf.slice(0, binIndex), ...draft.shelf.slice(binIndex + 1)];
        break;
      }

      case 'reorder_shelf':
        if (!isExactPermutation(draft.shelf, operation.shelf, binIdentity)) fail('invalid_operation');
        draft.shelf = [];
        for (let index = 0; index < operation.shelf.length; index += 1) {
          draft.shelf.push({ ...operation.shelf[index]! });
        }
        break;

      case 'select_take': {
        const [shot] = assertCanonicalTake(draft, operation.clipId, operation.assetId);
        if (binHasAsset(draft, operation.assetId)) fail('invalid_operation');
        defineOwn(draft.clips, shot.id, { ...shot, selectedAssetId: operation.assetId });
        cutReconciliation = { kind: 'selection', clipId: shot.id };
        break;
      }
    }

    if (cutReconciliation !== null) draft = reconcileStudioCutsV2(draft, cutReconciliation);
  }

  if (!validateStudioProjectV2(draft)) fail('validation_failed');
  return { project: draft, createdSectionIds: createdBeatIds, createdClipIds: createdShotIds };
};
