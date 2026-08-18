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
  | 'beat_capacity_reached'
  | 'beat_shot_capacity_reached'
  | 'project_shot_capacity_reached'
  | 'invalid_shot_duration'
  | 'dependency_blocked'
  | 'identity_collision'
  | 'invalid_operation'
  | 'validation_failed';

export type StudioMutationApplyResultV2 = {
  project: StudioProjectV2;
  createdBeatIds: string[];
  createdShotIds: string[];
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
const BEAT_INPUT_KEYS = new Set(['title', 'action', 'look']);
const BEAT_CHANGE_KEYS = new Set(['title', 'action', 'look']);
const SHOT_INPUT_KEYS = new Set([
  'line',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const SHOT_CHANGE_KEYS = new Set([
  'line',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const BIN_BEAT_KEYS = new Set(['kind', 'beatId']);
const BIN_TAKE_KEYS = new Set(['kind', 'assetId']);
const OPERATION_KEYS: Readonly<Record<StudioMutationOperationV2['kind'], ReadonlySet<string>>> = {
  set_brief: new Set(['kind', 'brief']),
  add_beat: new Set(['kind', 'beatId', 'beat', 'firstShotId', 'firstShot', 'beforeBeatId']),
  edit_beat: new Set(['kind', 'beatId', 'changes']),
  reorder_beats: new Set(['kind', 'beatOrder']),
  park_beat: new Set(['kind', 'beatId']),
  restore_beat: new Set(['kind', 'beatId', 'beforeBeatId']),
  add_shot: new Set(['kind', 'beatId', 'shotId', 'shot', 'beforeShotId']),
  edit_shot: new Set(['kind', 'shotId', 'changes']),
  delete_shot: new Set(['kind', 'shotId']),
  reorder_shots: new Set(['kind', 'beatId', 'shotOrder']),
  park_take: new Set(['kind', 'shotId', 'assetId']),
  restore_take: new Set(['kind', 'shotId', 'assetId']),
  remove_bin_item: new Set(['kind', 'assetId']),
  reorder_bin: new Set(['kind', 'bin']),
  select_take: new Set(['kind', 'shotId', 'assetId']),
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
  isStringWithin(value.action, 4 * 1024) &&
  isStringWithin(value.look, 8 * 1024);

const isEditableBeatChanges = (value: unknown): value is StudioEditableBeatChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => BEAT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'title') || isStringWithin(value.title, 256)) &&
    (!Object.hasOwn(value, 'action') || isStringWithin(value.action, 4 * 1024)) &&
    (!Object.hasOwn(value, 'look') || isStringWithin(value.look, 8 * 1024))
  );
};

const isEditableShotShape = (value: unknown): value is StudioEditableShot =>
  isRecord(value) &&
  hasExactKeys(value, SHOT_INPUT_KEYS) &&
  isStringWithin(value.line, 8 * 1024) &&
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
    (!Object.hasOwn(value, 'line') || isStringWithin(value.line, 8 * 1024)) &&
    (!Object.hasOwn(value, 'narration') || isStringWithin(value.narration, 4 * 1024)) &&
    (!Object.hasOwn(value, 'onScreenText') || isStringWithin(value.onScreenText, 1024)) &&
    (!Object.hasOwn(value, 'mediaKind') || (typeof value.mediaKind === 'string' && MEDIA_KINDS.has(value.mediaKind))) &&
    (!Object.hasOwn(value, 'durationSeconds') || value.durationSeconds !== undefined) &&
    (!Object.hasOwn(value, 'referenceAssetId') || value.referenceAssetId === null || isSafeId(value.referenceAssetId))
  );
};

const isBinItem = (value: unknown): value is StudioBinItem => {
  if (!isRecord(value)) return false;
  if (value.kind === 'beat') return hasExactKeys(value, BIN_BEAT_KEYS) && isSafeId(value.beatId);
  if (value.kind === 'take') return hasExactKeys(value, BIN_TAKE_KEYS) && isSafeId(value.assetId);
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
    case 'add_beat':
      if (
        !isSafeId(operation.beatId) ||
        !isRecord(operation.beat) ||
        !hasExactKeys(operation.beat, BEAT_INPUT_KEYS) ||
        !isSafeId(operation.firstShotId) ||
        !isRecord(operation.firstShot) ||
        !hasExactKeys(operation.firstShot, SHOT_INPUT_KEYS) ||
        !isSafeAnchor(operation.beforeBeatId)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'edit_beat':
      if (!isSafeId(operation.beatId) || !isEditableBeatChanges(operation.changes)) fail('invalid_operation');
      return;
    case 'reorder_beats':
      if (!isUniqueSafeIdArray(operation.beatOrder, STUDIO_MAX_BEATS)) fail('invalid_operation');
      return;
    case 'park_beat':
      if (!isSafeId(operation.beatId)) fail('invalid_operation');
      return;
    case 'restore_beat':
      if (!isSafeId(operation.beatId) || !isSafeAnchor(operation.beforeBeatId)) fail('invalid_operation');
      return;
    case 'add_shot':
      if (
        !isSafeId(operation.beatId) ||
        !isSafeId(operation.shotId) ||
        !isRecord(operation.shot) ||
        !hasExactKeys(operation.shot, SHOT_INPUT_KEYS) ||
        !isSafeAnchor(operation.beforeShotId)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'edit_shot':
      if (!isSafeId(operation.shotId) || !isEditableShotChangesShape(operation.changes)) fail('invalid_operation');
      return;
    case 'delete_shot':
      if (!isSafeId(operation.shotId)) fail('invalid_operation');
      return;
    case 'reorder_shots':
      if (!isSafeId(operation.beatId) || !isUniqueSafeIdArray(operation.shotOrder, STUDIO_MAX_SHOTS_PER_BEAT)) {
        fail('invalid_operation');
      }
      return;
    case 'park_take':
    case 'restore_take':
    case 'select_take':
      if (!isSafeId(operation.shotId) || !isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'remove_bin_item':
      if (!isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'reorder_bin':
      if (!isBinItemArray(operation.bin)) fail('invalid_operation');
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
  if (!isInteger(value) || value < minimum || value > maximum) fail('invalid_shot_duration');
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
  item.kind === 'beat' ? `beat:${item.beatId}` : `take:${item.assetId}`;

const findShotOwner = (project: StudioProjectV2, shotId: string): StudioBeat | undefined =>
  Object.values(project.beats).find((beat) => beat.shotOrder.includes(shotId));

const assetHasCutDependency = (project: StudioProjectV2, assetId: string): boolean =>
  Object.values(project.cuts).some((cut) => Object.values(cut.clips).some((cutClip) => cutClip.assetId === assetId));

const binHasTake = (project: StudioProjectV2, assetId: string): boolean =>
  project.bin.some((item) => item.kind === 'take' && item.assetId === assetId);

const assertCanonicalTake = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string
): [StudioShot, StudioAssetV2] => {
  const shot = ownValue(project.shots, shotId);
  const asset = ownValue(project.assets, assetId);
  if (shot === undefined || asset === undefined || !isCanonicalStudioGeneratedTakeV2(asset, project.id, shot)) {
    fail('invalid_operation');
  }
  return [shot, asset];
};

const assertReferenceAsset = (project: StudioProjectV2, shot: StudioShot): void => {
  if (shot.referenceAssetId === null) return;
  const asset = ownValue(project.assets, shot.referenceAssetId);
  if (asset === undefined || asset.shotId !== shot.id || !shot.assetIds.includes(asset.id)) {
    fail('invalid_operation');
  }
};

const binCounts = (bin: readonly StudioBinItem[]): { beats: number; takes: number } => ({
  beats: bin.filter((item) => item.kind === 'beat').length,
  takes: bin.filter((item) => item.kind === 'take').length,
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
  const knownBeatIds = new Set(Object.keys(draft.beats));
  const knownShotIds = new Set(Object.keys(draft.shots));
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

      case 'add_beat': {
        if (operation.beforeBeatId !== null && !draft.beatOrder.includes(operation.beforeBeatId)) {
          fail('invalid_operation');
        }
        if (Object.keys(draft.beats).length >= STUDIO_MAX_BEATS) fail('beat_capacity_reached');
        if (Object.keys(draft.shots).length >= STUDIO_MAX_SHOTS_PER_PROJECT) fail('project_shot_capacity_reached');
        if (knownBeatIds.has(operation.beatId) || knownShotIds.has(operation.firstShotId)) {
          fail('identity_collision');
        }
        if (!isEditableBeat(operation.beat) || !isEditableShotShape(operation.firstShot)) {
          fail('invalid_operation');
        }
        if (operation.firstShot.referenceAssetId !== null) fail('invalid_operation');
        assertShotDuration(operation.firstShot.mediaKind, operation.firstShot.durationSeconds);

        const beat: StudioBeat = {
          id: operation.beatId,
          title: operation.beat.title,
          action: operation.beat.action,
          look: operation.beat.look,
          shotOrder: [operation.firstShotId],
        };
        const shot: StudioShot = {
          id: operation.firstShotId,
          ...operation.firstShot,
          selectedTakeId: null,
          assetIds: [],
          jobIds: [],
        };
        defineOwn(draft.beats, beat.id, beat);
        defineOwn(draft.shots, shot.id, shot);
        draft.beatOrder = insertBefore(draft.beatOrder, beat.id, operation.beforeBeatId);
        knownBeatIds.add(beat.id);
        knownShotIds.add(shot.id);
        createdBeatIds.push(beat.id);
        createdShotIds.push(shot.id);
        break;
      }

      case 'edit_beat': {
        const beat = ownValue(draft.beats, operation.beatId);
        if (beat === undefined) fail('invalid_operation');
        defineOwn(draft.beats, beat.id, { ...beat, ...operation.changes, id: beat.id });
        break;
      }

      case 'reorder_beats':
        if (!isExactPermutation(draft.beatOrder, operation.beatOrder, (id) => id)) fail('invalid_operation');
        draft.beatOrder = copyArray(operation.beatOrder);
        cutReconciliation = { kind: 'structure' };
        break;

      case 'park_beat': {
        const activeIndex = draft.beatOrder.indexOf(operation.beatId);
        if (activeIndex < 0 || ownValue(draft.beats, operation.beatId) === undefined) fail('invalid_operation');
        const counts = binCounts(draft.bin);
        if (draft.bin.length >= STUDIO_MAX_BIN_ITEMS || counts.beats >= STUDIO_MAX_BIN_BEAT_ITEMS) {
          fail('validation_failed');
        }
        draft.beatOrder = draft.beatOrder.filter((beatId) => beatId !== operation.beatId);
        draft.bin = [...draft.bin, { kind: 'beat', beatId: operation.beatId }];
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'restore_beat': {
        const binIndex = draft.bin.findIndex((item) => item.kind === 'beat' && item.beatId === operation.beatId);
        if (binIndex < 0 || ownValue(draft.beats, operation.beatId) === undefined) fail('invalid_operation');
        if (operation.beforeBeatId !== null && !draft.beatOrder.includes(operation.beforeBeatId)) {
          fail('invalid_operation');
        }
        draft.bin = [...draft.bin.slice(0, binIndex), ...draft.bin.slice(binIndex + 1)];
        draft.beatOrder = insertBefore(draft.beatOrder, operation.beatId, operation.beforeBeatId);
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'add_shot': {
        const beat = ownValue(draft.beats, operation.beatId);
        if (beat === undefined) fail('invalid_operation');
        if (operation.beforeShotId !== null && !beat.shotOrder.includes(operation.beforeShotId)) {
          fail('invalid_operation');
        }
        if (beat.shotOrder.length >= STUDIO_MAX_SHOTS_PER_BEAT) fail('beat_shot_capacity_reached');
        if (Object.keys(draft.shots).length >= STUDIO_MAX_SHOTS_PER_PROJECT) fail('project_shot_capacity_reached');
        if (knownShotIds.has(operation.shotId)) fail('identity_collision');
        if (!isEditableShotShape(operation.shot)) fail('invalid_operation');
        if (operation.shot.referenceAssetId !== null) fail('invalid_operation');
        assertShotDuration(operation.shot.mediaKind, operation.shot.durationSeconds);

        const shot: StudioShot = {
          id: operation.shotId,
          ...operation.shot,
          selectedTakeId: null,
          assetIds: [],
          jobIds: [],
        };
        defineOwn(draft.shots, shot.id, shot);
        defineOwn(draft.beats, beat.id, {
          ...beat,
          shotOrder: insertBefore(beat.shotOrder, shot.id, operation.beforeShotId),
        });
        knownShotIds.add(shot.id);
        createdShotIds.push(shot.id);
        break;
      }

      case 'edit_shot': {
        const current = ownValue(draft.shots, operation.shotId);
        if (current === undefined) fail('invalid_operation');
        const next: StudioShot = { ...current, ...operation.changes, id: current.id };
        assertShotDuration(next.mediaKind, next.durationSeconds);
        assertReferenceAsset(draft, next);
        const mediaKindChanged = current.mediaKind !== next.mediaKind;
        const hasBinnedTake = draft.bin.some((item) => {
          if (item.kind !== 'take') return false;
          return ownValue(draft.assets, item.assetId)?.shotId === current.id;
        });
        const hasNonterminalJob = current.jobIds.some((jobId) => {
          const job = ownValue(draft.jobs, jobId);
          return job !== undefined && NONTERMINAL_JOB_STATUSES.has(job.status);
        });
        if (
          mediaKindChanged &&
          (hasBinnedTake ||
            current.selectedTakeId !== null ||
            studioClipHasCutDependencyV2(draft, current.id) ||
            hasNonterminalJob)
        ) {
          fail('dependency_blocked');
        }
        defineOwn(draft.shots, next.id, next);
        break;
      }

      case 'delete_shot': {
        const shot = ownValue(draft.shots, operation.shotId);
        const owner = findShotOwner(draft, operation.shotId);
        if (shot === undefined || owner === undefined) fail('invalid_operation');
        const hasBinAlias = draft.bin.some((item) => {
          if (item.kind !== 'take') return false;
          return ownValue(draft.assets, item.assetId)?.shotId === shot.id;
        });
        if (
          shot.assetIds.length > 0 ||
          shot.jobIds.length > 0 ||
          hasBinAlias ||
          studioClipHasCutDependencyV2(draft, shot.id)
        ) {
          fail('dependency_blocked');
        }
        delete draft.shots[shot.id];
        defineOwn(draft.beats, owner.id, {
          ...owner,
          shotOrder: owner.shotOrder.filter((shotId) => shotId !== shot.id),
        });
        break;
      }

      case 'reorder_shots': {
        const beat = ownValue(draft.beats, operation.beatId);
        if (beat === undefined || !isExactPermutation(beat.shotOrder, operation.shotOrder, (id) => id)) {
          fail('invalid_operation');
        }
        defineOwn(draft.beats, beat.id, { ...beat, shotOrder: copyArray(operation.shotOrder) });
        cutReconciliation = { kind: 'structure' };
        break;
      }

      case 'park_take': {
        const [shot] = assertCanonicalTake(draft, operation.shotId, operation.assetId);
        if (binHasTake(draft, operation.assetId)) fail('invalid_operation');
        if (shot.selectedTakeId === operation.assetId || assetHasCutDependency(draft, operation.assetId)) {
          fail('dependency_blocked');
        }
        const counts = binCounts(draft.bin);
        if (draft.bin.length >= STUDIO_MAX_BIN_ITEMS || counts.takes >= STUDIO_MAX_BIN_TAKE_ITEMS) {
          fail('validation_failed');
        }
        draft.bin = [...draft.bin, { kind: 'take', assetId: operation.assetId }];
        break;
      }

      case 'restore_take': {
        const [shot] = assertCanonicalTake(draft, operation.shotId, operation.assetId);
        const binIndex = draft.bin.findIndex((item) => item.kind === 'take' && item.assetId === operation.assetId);
        if (binIndex < 0) fail('invalid_operation');
        draft.bin = [...draft.bin.slice(0, binIndex), ...draft.bin.slice(binIndex + 1)];
        defineOwn(draft.shots, shot.id, { ...shot, selectedTakeId: operation.assetId });
        cutReconciliation = { kind: 'selection', clipId: shot.id };
        break;
      }

      case 'remove_bin_item': {
        const binIndex = draft.bin.findIndex((item) => item.kind === 'take' && item.assetId === operation.assetId);
        if (binIndex < 0) fail('invalid_operation');
        const asset = ownValue(draft.assets, operation.assetId);
        const shot = asset?.shotId === null || asset === undefined ? undefined : ownValue(draft.shots, asset.shotId);
        if (shot?.selectedTakeId === operation.assetId || assetHasCutDependency(draft, operation.assetId)) {
          fail('dependency_blocked');
        }
        draft.bin = [...draft.bin.slice(0, binIndex), ...draft.bin.slice(binIndex + 1)];
        break;
      }

      case 'reorder_bin':
        if (!isExactPermutation(draft.bin, operation.bin, binIdentity)) fail('invalid_operation');
        draft.bin = [];
        for (let index = 0; index < operation.bin.length; index += 1) {
          draft.bin.push({ ...operation.bin[index]! });
        }
        break;

      case 'select_take': {
        const [shot] = assertCanonicalTake(draft, operation.shotId, operation.assetId);
        if (binHasTake(draft, operation.assetId)) fail('invalid_operation');
        defineOwn(draft.shots, shot.id, { ...shot, selectedTakeId: operation.assetId });
        cutReconciliation = { kind: 'selection', clipId: shot.id };
        break;
      }
    }

    if (cutReconciliation !== null) draft = reconcileStudioCutsV2(draft, cutReconciliation);
  }

  if (!validateStudioProjectV2(draft)) fail('validation_failed');
  return { project: draft, createdBeatIds, createdShotIds };
};
