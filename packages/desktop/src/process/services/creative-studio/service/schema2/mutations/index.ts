/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { hasRuleToken, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import { studioPlanningShotBoundariesV2 } from '@/common/types/project/creativeStudioProjectSummary';
import {
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_BIN_TAKE_ITEMS,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_LINE_HISTORY_PER_BEAT,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_MAX_UNDO_ENTRIES,
  STUDIO_MAX_UNDO_LABEL_LENGTH,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioBeat,
  type StudioBinItem,
  type StudioBriefRule,
  type StudioBriefRuleDraft,
  type StudioCoverageApplyResult,
  type StudioEditableBeatChanges,
  type StudioEditableBeat,
  type StudioEditableProjectSettingsChanges,
  type StudioEditableShot,
  type StudioEditableShotChanges,
  type StudioFixedShotReasonV2,
  type StudioJobV2,
  type StudioMutationBatchV2,
  type StudioMutationOperationV2,
  type StudioMutationReducerContextV2,
  type StudioProjectV2,
  type StudioShot,
  type StudioSpendPolicy,
  type StudioUndoPatch,
} from '@/common/types/project/creativeStudioTypes';
import { deriveStudioInboundShotReferencesV2 } from '../chain';
import { createStudioLineHistoryId } from './identity';
import { validateStudioFixedShotReviewsV2, validateStudioProjectV2, validateStudioProposedShotV2 } from '../validation';

export type StudioMutationReasonV2 =
  | 'beat_capacity_reached'
  | 'beat_shot_capacity_reached'
  | 'project_shot_capacity_reached'
  | 'take_bin_capacity_reached'
  | 'invalid_shot_duration'
  | 'dependency_blocked'
  | 'identity_collision'
  | 'invalid_operation'
  | 'undo_conflict'
  | 'validation_failed';

export type StudioMutationApplyResultV2 = {
  project: StudioProjectV2;
  createdBeatIds: string[];
  createdShotIds: string[];
  coverageResults: StudioCoverageApplyResult[];
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
const CURRENCY = /^[A-Z]{3}$/;
const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);
const BATCH_KEYS = new Set(['schemaVersion', 'projectId', 'expectedRevision', 'operations']);
const CONTEXT_KEYS = new Set(['mutationId', 'capturedAt']);
const PROJECT_CHANGE_KEYS = new Set(['name', 'aspectRatio', 'resolution', 'targetDurationSeconds']);
const BEAT_INPUT_KEYS = new Set(['title', 'action', 'look', 'targetSeconds']);
const BEAT_CHANGE_KEYS = new Set(BEAT_INPUT_KEYS);
const SHOT_INPUT_KEYS = new Set(['line', 'narration', 'onScreenText', 'durationSeconds']);
const SHOT_CHANGE_KEYS = new Set(SHOT_INPUT_KEYS);
const RULE_DRAFT_KEYS = new Set(['id', 'text', 'predicate']);
const RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const SPEND_POLICY_KEYS = new Set(['currency', 'maxPerBatchMinorUnits']);
const BIN_BEAT_KEYS = new Set(['kind', 'beatId', 'reason']);
const BIN_SHOT_KEYS = new Set(['kind', 'beatId', 'shotId', 'reason']);
const BIN_TAKE_KEYS = new Set(['kind', 'assetId', 'reason']);
const OPERATION_KEYS: Readonly<Record<StudioMutationOperationV2['kind'], ReadonlySet<string>>> = {
  edit_project: new Set(['kind', 'changes']),
  set_brief: new Set(['kind', 'brief']),
  set_rules: new Set(['kind', 'rules']),
  add_beat: new Set(['kind', 'beatId', 'beat', 'beforeBeatId']),
  edit_beat: new Set(['kind', 'beatId', 'changes']),
  reorder_beats: new Set(['kind', 'beatOrder']),
  park_beat: new Set(['kind', 'beatId']),
  restore_beat: new Set(['kind', 'beatId', 'beforeBeatId']),
  add_binned_beat: new Set(['kind', 'beatId', 'beat']),
  add_shot: new Set(['kind', 'beatId', 'shotId', 'shot', 'beforeShotId']),
  edit_shot: new Set(['kind', 'shotId', 'changes']),
  delete_shot: new Set(['kind', 'shotId']),
  park_shot: new Set(['kind', 'shotId']),
  restore_shot: new Set(['kind', 'shotId', 'beforeShotId']),
  reorder_shots: new Set(['kind', 'beatId', 'shotOrder']),
  apply_coverage: new Set(['kind', 'beatId', 'shots', 'fixedShots']),
  set_hard_cut: new Set(['kind', 'shotId', 'hardCut']),
  set_seed_still: new Set(['kind', 'shotId', 'assetId']),
  trim_shot: new Set(['kind', 'shotId', 'trimInSeconds', 'trimOutSeconds']),
  redetach_line: new Set(['kind', 'shotId', 'line']),
  rederive_line: new Set(['kind', 'shotId', 'line']),
  restore_line: new Set(['kind', 'shotId', 'historyEntryId']),
  park_take: new Set(['kind', 'shotId', 'assetId']),
  add_alternate_take: new Set(['kind', 'shotId', 'assetId']),
  restore_take: new Set(['kind', 'shotId', 'assetId']),
  reorder_bin: new Set(['kind', 'bin']),
  select_take: new Set(['kind', 'shotId', 'assetId']),
  set_routes: new Set(['kind', 'imageRouteId', 'videoRouteId']),
  set_spend_policy: new Set(['kind', 'policy']),
  set_match_to: new Set(['kind', 'shotId']),
  set_bed: new Set(['kind', 'assetId']),
  undo_last: new Set(['kind', 'entryId']),
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
  if (seen.has(value)) return false;
  seen.add(value);

  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return false;
    } else if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        (!descriptor.enumerable && !(Array.isArray(value) && key === 'length'))
      ) {
        return false;
      }
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
  isStringWithin(value.look, 8 * 1024) &&
  (value.targetSeconds === null ||
    (isInteger(value.targetSeconds) && value.targetSeconds >= 1 && value.targetSeconds <= 1440));

const isEditableBeatChanges = (value: unknown): value is StudioEditableBeatChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => BEAT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'title') || isStringWithin(value.title, 256)) &&
    (!Object.hasOwn(value, 'action') || isStringWithin(value.action, 4 * 1024)) &&
    (!Object.hasOwn(value, 'look') || isStringWithin(value.look, 8 * 1024)) &&
    (!Object.hasOwn(value, 'targetSeconds') ||
      value.targetSeconds === null ||
      (isInteger(value.targetSeconds) && value.targetSeconds >= 1 && value.targetSeconds <= 1440))
  );
};

const isEditableProjectChanges = (value: unknown): value is StudioEditableProjectSettingsChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => PROJECT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'name') ||
      (typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 256)) &&
    (!Object.hasOwn(value, 'aspectRatio') ||
      value.aspectRatio === '16:9' ||
      value.aspectRatio === '9:16' ||
      value.aspectRatio === '1:1' ||
      value.aspectRatio === '4:3' ||
      value.aspectRatio === '3:4') &&
    (!Object.hasOwn(value, 'resolution') || value.resolution === '720p' || value.resolution === '1080p') &&
    (!Object.hasOwn(value, 'targetDurationSeconds') ||
      (isInteger(value.targetDurationSeconds) &&
        value.targetDurationSeconds >= 5 &&
        value.targetDurationSeconds <= 1440))
  );
};

const isEditableShotShape = (value: unknown): value is StudioEditableShot =>
  isRecord(value) &&
  hasExactKeys(value, SHOT_INPUT_KEYS) &&
  isStringWithin(value.line, 8 * 1024) &&
  isStringWithin(value.narration, 4 * 1024) &&
  isStringWithin(value.onScreenText, 1024) &&
  isInteger(value.durationSeconds);

const isEditableShotChangesShape = (value: unknown): value is StudioEditableShotChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => SHOT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'line') || isStringWithin(value.line, 8 * 1024)) &&
    (!Object.hasOwn(value, 'narration') || isStringWithin(value.narration, 4 * 1024)) &&
    (!Object.hasOwn(value, 'onScreenText') || isStringWithin(value.onScreenText, 1024)) &&
    (!Object.hasOwn(value, 'durationSeconds') || isInteger(value.durationSeconds))
  );
};

const assertShotDuration = (value: number): void => {
  if (value < STUDIO_MIN_SHOT_SECONDS || value > STUDIO_MAX_SHOT_SECONDS) {
    fail('invalid_shot_duration');
  }
};

const isRuleDraft = (value: unknown): value is StudioBriefRuleDraft => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RULE_DRAFT_KEYS) ||
    !isSafeId(value.id) ||
    typeof value.text !== 'string' ||
    value.text.trim().length === 0 ||
    value.text.length > STUDIO_RULE_LIMITS.text
  ) {
    return false;
  }
  if (value.predicate === null) return true;
  if (
    !isRecord(value.predicate) ||
    !hasExactKeys(value.predicate, RULE_PREDICATE_KEYS) ||
    value.predicate.kind !== 'forbidden_terms' ||
    !isDenseArray(value.predicate.terms, STUDIO_RULE_LIMITS.maxTerms) ||
    value.predicate.terms.length === 0
  ) {
    return false;
  }
  const terms = new Set<string>();
  for (const term of value.predicate.terms) {
    if (
      typeof term !== 'string' ||
      term.trim().length === 0 ||
      term.length > STUDIO_RULE_LIMITS.term ||
      !hasRuleToken(term) ||
      terms.has(term)
    ) {
      return false;
    }
    terms.add(term);
  }
  return true;
};

const isRuleDraftArray = (value: unknown): value is StudioBriefRuleDraft[] => {
  if (!isDenseArray(value, STUDIO_RULE_LIMITS.maxRules)) return false;
  const ids = new Set<string>();
  for (const rule of value) {
    if (!isRuleDraft(rule) || ids.has(rule.id)) return false;
    ids.add(rule.id);
  }
  return true;
};

const isNullableTrim = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && !Object.is(value, -0));

const isSpendPolicy = (value: unknown): value is StudioSpendPolicy =>
  isRecord(value) &&
  hasExactKeys(value, SPEND_POLICY_KEYS) &&
  typeof value.currency === 'string' &&
  CURRENCY.test(value.currency) &&
  isInteger(value.maxPerBatchMinorUnits) &&
  value.maxPerBatchMinorUnits >= 0;

const isBinItem = (value: unknown): value is StudioBinItem => {
  if (!isRecord(value)) return false;
  if (value.kind === 'beat') {
    return (
      hasExactKeys(value, BIN_BEAT_KEYS) &&
      isSafeId(value.beatId) &&
      (value.reason === 'lifted' || value.reason === 'alternate')
    );
  }
  if (value.kind === 'shot') {
    return (
      hasExactKeys(value, BIN_SHOT_KEYS) &&
      isSafeId(value.beatId) &&
      isSafeId(value.shotId) &&
      value.reason === 'lifted'
    );
  }
  if (value.kind === 'take') {
    return (
      hasExactKeys(value, BIN_TAKE_KEYS) &&
      isSafeId(value.assetId) &&
      (value.reason === 'lifted' || value.reason === 'alternate')
    );
  }
  return false;
};

const isBinItemArray = (value: unknown): value is StudioBinItem[] => {
  if (!isDenseArray(value, STUDIO_MAX_BIN_BEAT_ITEMS + STUDIO_MAX_BIN_SHOT_ITEMS + STUDIO_MAX_BIN_TAKE_ITEMS)) {
    return false;
  }
  const counts = { beat: 0, shot: 0, take: 0 };
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isBinItem(item)) return false;
    counts[item.kind] += 1;
  }
  return (
    counts.beat <= STUDIO_MAX_BIN_BEAT_ITEMS &&
    counts.shot <= STUDIO_MAX_BIN_SHOT_ITEMS &&
    counts.take <= STUDIO_MAX_BIN_TAKE_ITEMS
  );
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
    case 'edit_project':
      if (!isEditableProjectChanges(operation.changes)) fail('invalid_operation');
      return;
    case 'set_brief':
      if (!isStringWithin(operation.brief, 16 * 1024)) fail('invalid_operation');
      return;
    case 'set_rules':
      if (!isRuleDraftArray(operation.rules)) fail('invalid_operation');
      return;
    case 'add_beat':
      if (!isSafeId(operation.beatId) || !isEditableBeat(operation.beat) || !isSafeAnchor(operation.beforeBeatId)) {
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
    case 'add_binned_beat':
      if (!isSafeId(operation.beatId) || !isEditableBeat(operation.beat)) fail('invalid_operation');
      return;
    case 'add_shot':
      if (
        !isSafeId(operation.beatId) ||
        !isSafeId(operation.shotId) ||
        !isEditableShotShape(operation.shot) ||
        !isSafeAnchor(operation.beforeShotId)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'edit_shot':
      if (!isSafeId(operation.shotId) || !isEditableShotChangesShape(operation.changes)) fail('invalid_operation');
      return;
    case 'delete_shot':
    case 'park_shot':
      if (!isSafeId(operation.shotId)) fail('invalid_operation');
      return;
    case 'restore_shot':
      if (!isSafeId(operation.shotId) || !isSafeAnchor(operation.beforeShotId)) fail('invalid_operation');
      return;
    case 'reorder_shots':
      if (!isSafeId(operation.beatId) || !isUniqueSafeIdArray(operation.shotOrder, STUDIO_MAX_SHOTS_PER_BEAT)) {
        fail('invalid_operation');
      }
      return;
    case 'apply_coverage':
      if (
        !isSafeId(operation.beatId) ||
        !isDenseArray(operation.shots, STUDIO_MAX_SHOTS_PER_BEAT) ||
        operation.shots.some((shot) => !validateStudioProposedShotV2(shot)) ||
        !validateStudioFixedShotReviewsV2(operation.fixedShots)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'set_hard_cut':
      if (!isSafeId(operation.shotId) || typeof operation.hardCut !== 'boolean') fail('invalid_operation');
      return;
    case 'set_seed_still':
      if (!isSafeId(operation.shotId) || !isSafeAnchor(operation.assetId)) fail('invalid_operation');
      return;
    case 'trim_shot':
      if (
        !isSafeId(operation.shotId) ||
        !isNullableTrim(operation.trimInSeconds) ||
        !isNullableTrim(operation.trimOutSeconds)
      ) {
        fail('invalid_operation');
      }
      return;
    case 'redetach_line':
      if (!isSafeId(operation.shotId) || !isStringWithin(operation.line, 8 * 1024)) fail('invalid_operation');
      return;
    case 'rederive_line':
      if (!isSafeId(operation.shotId) || !isStringWithin(operation.line, 8 * 1024) || operation.line.length < 1) {
        fail('invalid_operation');
      }
      return;
    case 'restore_line':
      if (!isSafeId(operation.shotId) || !isSafeId(operation.historyEntryId)) fail('invalid_operation');
      return;
    case 'park_take':
    case 'add_alternate_take':
    case 'restore_take':
    case 'select_take':
      if (!isSafeId(operation.shotId) || !isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'reorder_bin':
      if (!isBinItemArray(operation.bin)) fail('invalid_operation');
      return;
    case 'set_routes':
      if (!isSafeAnchor(operation.imageRouteId) || !isSafeAnchor(operation.videoRouteId)) fail('invalid_operation');
      return;
    case 'set_spend_policy':
      if (operation.policy !== null && !isSpendPolicy(operation.policy)) fail('invalid_operation');
      return;
    case 'set_match_to':
      if (!isSafeAnchor(operation.shotId)) fail('invalid_operation');
      return;
    case 'set_bed':
      if (!isSafeAnchor(operation.assetId)) fail('invalid_operation');
      return;
    case 'undo_last':
      if (!isSafeId(operation.entryId)) fail('invalid_operation');
      return;
  }
};

/** Exact, side-effect-free parser used by persisted proposal and Director boundaries. */
export const validateStudioMutationOperationV2 = (value: unknown): value is StudioMutationOperationV2 => {
  if (!hasOnlyDataPropertiesDeep(value)) return false;
  try {
    const snapshot: unknown = structuredClone(value);
    assertOperationShape(snapshot);
    return true;
  } catch {
    return false;
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

const assertContext = (value: unknown): StudioMutationReducerContextV2 => {
  if (!isRecord(value) || !hasExactKeys(value, CONTEXT_KEYS)) {
    return fail('invalid_operation');
  }
  if (!isSafeId(value.mutationId)) return fail('invalid_operation');
  const mutationId = value.mutationId;
  if (typeof value.capturedAt !== 'string' || value.capturedAt.length !== 24) return fail('invalid_operation');
  const capturedAt = value.capturedAt;
  const timestamp = Date.parse(capturedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== capturedAt) fail('invalid_operation');
  return { mutationId, capturedAt };
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
  item.kind === 'beat' ? `beat:${item.beatId}` : item.kind === 'shot' ? `shot:${item.shotId}` : `take:${item.assetId}`;

const findActiveShotOwner = (project: StudioProjectV2, shotId: string): StudioBeat | undefined => {
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat?.shotOrder.includes(shotId)) return beat;
  }
  return undefined;
};

const shotOwnerLocation = (
  project: StudioProjectV2,
  shotId: string
): { beatId: string | null; index: number | null } => {
  const owner = findActiveShotOwner(project, shotId);
  if (owner !== undefined) return { beatId: owner.id, index: owner.shotOrder.indexOf(shotId) };
  const binned = project.bin.find((item) => item.kind === 'shot' && item.shotId === shotId);
  return binned?.kind === 'shot' ? { beatId: binned.beatId, index: null } : { beatId: null, index: null };
};

const binHasTake = (project: StudioProjectV2, assetId: string): boolean =>
  project.bin.some((item) => item.kind === 'take' && item.assetId === assetId);

const assertCanonicalTake = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string
): [StudioShot, StudioAssetV2] => {
  const shot = ownValue(project.shots, shotId);
  const asset = ownValue(project.assets, assetId);
  if (
    shot === undefined ||
    asset === undefined ||
    asset.projectId !== project.id ||
    asset.shotId !== shot.id ||
    (asset.mediaKind !== 'image' && asset.mediaKind !== 'video') ||
    (asset.managedAsset.collection !== 'assets' &&
      !(asset.mediaKind === 'image' && asset.managedAsset.collection === 'imports')) ||
    !shot.assetIds.includes(asset.id)
  ) {
    fail('invalid_operation');
  }
  return [shot, asset];
};

const assertCanonicalVideoTake = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string
): [StudioShot, StudioAssetV2] => {
  const result = assertCanonicalTake(project, shotId, assetId);
  if (result[1].mediaKind !== 'video' || result[1].managedAsset.collection !== 'assets') fail('invalid_operation');
  return result;
};

const assertCanonicalSeed = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string
): [StudioShot, StudioAssetV2] => {
  const shot = ownValue(project.shots, shotId);
  const asset = ownValue(project.assets, assetId);
  if (
    shot === undefined ||
    asset?.projectId !== project.id ||
    asset.shotId !== shot.id ||
    asset.mediaKind !== 'image' ||
    (asset.managedAsset.collection !== 'assets' && asset.managedAsset.collection !== 'imports') ||
    !shot.assetIds.includes(asset.id) ||
    binHasTake(project, asset.id)
  ) {
    fail('invalid_operation');
  }
  return [shot, asset];
};

const binCounts = (bin: readonly StudioBinItem[]): { beats: number; shots: number; takes: number } => ({
  beats: bin.filter((item) => item.kind === 'beat').length,
  shots: bin.filter((item) => item.kind === 'shot').length,
  takes: bin.filter((item) => item.kind === 'take').length,
});

const hasBoundNonterminalJob = (
  project: StudioProjectV2,
  predicate: (job: StudioJobV2) => boolean = () => true
): boolean =>
  Object.values(project.jobs).some(
    (job) =>
      NONTERMINAL_JOB_STATUSES.has(job.status) &&
      (job.requestSnapshot !== null ||
        (job.requestPlan.kind === 'after_take_selection' &&
          job.requestPlan.dependency.kind === 'existing_predecessor')) &&
      predicate(job)
  );

const takeHasNonterminalConditioningUse = (project: StudioProjectV2, assetId: string): boolean =>
  Object.values(project.jobs).some((job) => {
    if (!NONTERMINAL_JOB_STATUSES.has(job.status)) return false;
    const conditioning = job.requestSnapshot?.conditioningInput;
    return (
      (job.requestPlan.kind === 'after_take_selection' &&
        job.requestPlan.dependency.kind === 'existing_predecessor' &&
        job.requestPlan.dependency.takeAssetId === assetId) ||
      (conditioning?.kind === 'seed_still' && conditioning.assetId === assetId) ||
      (conditioning?.kind === 'predecessor_frame' && conditioning.takeAssetId === assetId)
    );
  });

const takeIsLastSelectableForWaitingDependency = (project: StudioProjectV2, assetId: string): boolean => {
  const producer = Object.values(project.jobs).find(
    (job) => job.status === 'succeeded' && job.outputAssetIdsByRole.primary === assetId
  );
  if (producer === undefined) return false;
  const hasWaitingDependent = Object.values(project.jobs).some(
    (job) =>
      NONTERMINAL_JOB_STATUSES.has(job.status) &&
      job.requestPlan.kind === 'after_take_selection' &&
      ((job.requestPlan.dependency.kind === 'existing_predecessor' &&
        job.requestPlan.dependency.takeAssetId === assetId) ||
        (job.requestPlan.dependency.kind !== 'existing_predecessor' &&
          job.requestPlan.dependency.upstreamItemId === producer.authorizationItemId))
  );
  if (!hasWaitingDependent) return false;
  const selectablePrimaryIds = new Set<string>();
  for (const sibling of Object.values(project.jobs)) {
    if (sibling.authorizationItemId !== producer.authorizationItemId || sibling.status !== 'succeeded') continue;
    const primaryId = sibling.outputAssetIdsByRole.primary;
    if (primaryId === null || binHasTake(project, primaryId)) continue;
    const asset = ownValue(project.assets, primaryId);
    if (
      asset !== undefined &&
      asset.projectId === project.id &&
      asset.shotId === producer.shotId &&
      (asset.mediaKind === 'image' || asset.mediaKind === 'video') &&
      ownValue(project.shots, producer.shotId)?.assetIds.includes(asset.id)
    ) {
      selectablePrimaryIds.add(primaryId);
    }
  }
  return selectablePrimaryIds.size === 1 && selectablePrimaryIds.has(assetId);
};

const seedMatchesWaitingAuthorizedDependencies = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string | null
): boolean => {
  const waitingJobs = Object.values(project.jobs).filter(
    (job) =>
      job.shotId === shotId &&
      job.purpose === 'video_take' &&
      job.status === 'waiting_for_conditioning' &&
      job.requestSnapshot === null &&
      job.requestPlan.kind === 'after_take_selection' &&
      job.requestPlan.dependency.kind === 'authorized_seed'
  );
  if (waitingJobs.length === 0 || assetId === null) return true;

  return waitingJobs.every((waitingJob) => {
    if (
      waitingJob.requestPlan.kind !== 'after_take_selection' ||
      waitingJob.requestPlan.dependency.kind !== 'authorized_seed'
    ) {
      return false;
    }
    const dependency = waitingJob.requestPlan.dependency;
    const authorization = project.spendAuthorizations.find((candidate) => candidate.id === waitingJob.authorizationId);
    const upstreamItem = authorization
      ? [...authorization.baseItems, ...authorization.cascadeItems].find(
          (item) => item.id === dependency.upstreamItemId
        )
      : undefined;
    if (
      authorization === undefined ||
      dependency.shotId !== shotId ||
      upstreamItem?.shotId !== shotId ||
      upstreamItem.purpose !== 'seed_still'
    ) {
      return false;
    }

    return Object.values(project.jobs).some(
      (producer) =>
        producer.authorizationId === authorization.id &&
        producer.authorizationItemId === upstreamItem.id &&
        producer.shotId === shotId &&
        producer.purpose === 'seed_still' &&
        producer.status === 'succeeded' &&
        producer.outputAssetIdsByRole.primary === assetId &&
        producer.outputAssetIds.includes(assetId)
    );
  });
};

const projectFields = (project: StudioProjectV2): Extract<StudioUndoPatch, { kind: 'project_fields' }>['before'] => ({
  name: project.name,
  aspectRatio: project.aspectRatio,
  resolution: project.resolution,
  targetDurationSeconds: project.targetDurationSeconds,
  brief: project.brief,
  rules: structuredClone(project.rules),
  beatOrder: [...project.beatOrder],
  imageRouteId: project.imageRouteId,
  videoRouteId: project.videoRouteId,
  spendPolicy: project.spendPolicy === null ? null : { ...project.spendPolicy },
  bedAssetId: project.bedAssetId,
  matchToShotId: project.matchToShotId,
});

const authoredShot = (shot: StudioShot): Omit<StudioShot, 'assetIds' | 'jobIds'> => {
  const { assetIds: _assetIds, jobIds: _jobIds, ...authored } = shot;
  return structuredClone(authored);
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const authoredDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

type ShotBefore = {
  before: Omit<StudioShot, 'assetIds' | 'jobIds'> | null;
  beforeBeatId: string | null;
  beforeIndex: number | null;
};

type UndoTracker = {
  projectBefore: ReturnType<typeof projectFields> | null;
  beats: Map<string, StudioBeat | null>;
  shots: Map<string, ShotBefore>;
  binBefore: StudioBinItem[] | null;
};

const createUndoTracker = (): UndoTracker => ({
  projectBefore: null,
  beats: new Map(),
  shots: new Map(),
  binBefore: null,
});

const touchProject = (tracker: UndoTracker, project: StudioProjectV2): void => {
  if (tracker.projectBefore === null) tracker.projectBefore = projectFields(project);
};

const touchBeat = (tracker: UndoTracker, project: StudioProjectV2, beatId: string): void => {
  if (!tracker.beats.has(beatId)) {
    const beat = ownValue(project.beats, beatId);
    tracker.beats.set(beatId, beat === undefined ? null : structuredClone(beat));
  }
};

const touchShot = (tracker: UndoTracker, project: StudioProjectV2, shotId: string): void => {
  if (tracker.shots.has(shotId)) return;
  const shot = ownValue(project.shots, shotId);
  const owner = shotOwnerLocation(project, shotId);
  tracker.shots.set(shotId, {
    before: shot === undefined ? null : authoredShot(shot),
    beforeBeatId: owner.beatId,
    beforeIndex: owner.index,
  });
};

const touchBin = (tracker: UndoTracker, project: StudioProjectV2): void => {
  if (tracker.binBefore === null) tracker.binBefore = structuredClone(project.bin);
};

const currentShotFragment = (project: StudioProjectV2, shotId: string): unknown => {
  const shot = ownValue(project.shots, shotId);
  const owner = shotOwnerLocation(project, shotId);
  return {
    value: shot === undefined ? null : authoredShot(shot),
    beatId: owner.beatId,
    index: owner.index,
  };
};

const buildUndoPatches = (tracker: UndoTracker, project: StudioProjectV2): StudioUndoPatch[] => {
  const patches: StudioUndoPatch[] = [];
  if (tracker.projectBefore !== null) {
    patches.push({
      kind: 'project_fields',
      before: tracker.projectBefore,
      afterDigest: authoredDigest(projectFields(project)),
    });
  }
  for (const [beatId, before] of tracker.beats) {
    patches.push({
      kind: 'beat_fields',
      beatId,
      before,
      afterDigest: authoredDigest(ownValue(project.beats, beatId) ?? null),
    });
  }
  for (const [shotId, before] of tracker.shots) {
    patches.push({
      kind: 'shot_fields',
      shotId,
      ...before,
      afterDigest: authoredDigest(currentShotFragment(project, shotId)),
    });
  }
  if (tracker.binBefore !== null) {
    patches.push({ kind: 'bin', before: tracker.binBefore, afterDigest: authoredDigest(project.bin) });
  }
  return patches;
};

const archiveDetachedLine = (
  project: StudioProjectV2,
  tracker: UndoTracker,
  shot: StudioShot,
  replacement: string | null,
  context: StudioMutationReducerContextV2,
  operationIndex: number,
  entryIndex: number
): void => {
  if (shot.derivation !== 'detached' || shot.line.length === 0 || shot.line === replacement) return;
  const owner = findActiveShotOwner(project, shot.id);
  if (owner === undefined) fail('invalid_operation');
  touchBeat(tracker, project, owner.id);
  const entry = {
    id: createStudioLineHistoryId(context.mutationId, operationIndex, shot.id, entryIndex),
    shotOrdinal: owner.shotOrder.indexOf(shot.id) + 1,
    text: shot.line,
    capturedAt: context.capturedAt,
  };
  defineOwn(project.beats, owner.id, {
    ...owner,
    lineHistory: [...owner.lineHistory, entry].slice(-STUDIO_MAX_LINE_HISTORY_PER_BEAT),
  });
};

const FIXED_REASON_ORDER: readonly StudioFixedShotReasonV2[] = [
  'owned_asset',
  'owned_job',
  'selected_take',
  'seed_still',
  'conditioning_frame',
  'conditioning_input',
  'match_to',
  'narration',
  'on_screen_text',
];

const jobReferencesShot = (project: StudioProjectV2, job: StudioJobV2, shotId: string): boolean => {
  if (job.requestPlan.kind === 'after_take_selection') {
    const dependency = job.requestPlan.dependency;
    if (
      (dependency.kind === 'authorized_seed' && dependency.shotId === shotId) ||
      (dependency.kind !== 'authorized_seed' && dependency.predecessorShotId === shotId)
    ) {
      return true;
    }
  }
  const input = job.requestSnapshot?.conditioningInput;
  if (input?.kind === 'predecessor_frame' && input.predecessorShotId === shotId) return true;
  if (input?.kind === 'seed_still') return ownValue(project.assets, input.assetId)?.shotId === shotId;
  return false;
};

const fixedReasons = (project: StudioProjectV2, shot: StudioShot): StudioFixedShotReasonV2[] => {
  const present = new Set<StudioFixedShotReasonV2>();
  if (shot.assetIds.length > 0) present.add('owned_asset');
  if (shot.jobIds.length > 0) present.add('owned_job');
  if (shot.selectedTakeId !== null) present.add('selected_take');
  if (shot.seedStillId !== null) present.add('seed_still');
  if (Object.values(project.frameExtractions).some((frame) => frame.shotId === shot.id))
    present.add('conditioning_frame');
  if (Object.values(project.jobs).some((job) => jobReferencesShot(project, job, shot.id)))
    present.add('conditioning_input');
  if (project.matchToShotId === shot.id) present.add('match_to');
  if (shot.narration.length > 0) present.add('narration');
  if (shot.onScreenText.length > 0) present.add('on_screen_text');
  return FIXED_REASON_ORDER.filter((reason) => present.has(reason));
};

const shotHasDestructiveDependency = (project: StudioProjectV2, shot: StudioShot): boolean =>
  shot.assetIds.length > 0 ||
  shot.jobIds.length > 0 ||
  shot.selectedTakeId !== null ||
  shot.seedStillId !== null ||
  shot.narration.length > 0 ||
  shot.onScreenText.length > 0 ||
  project.bin.some((item) => item.kind === 'take' && ownValue(project.assets, item.assetId)?.shotId === shot.id) ||
  Object.values(project.frameExtractions).some((frame) => frame.shotId === shot.id) ||
  deriveStudioInboundShotReferencesV2(project, [shot.id]).length > 0;

const sameValue = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

const removeShotFromMembership = (project: StudioProjectV2, shotId: string): void => {
  for (const beat of Object.values(project.beats)) {
    if (beat.shotOrder.includes(shotId)) {
      defineOwn(project.beats, beat.id, { ...beat, shotOrder: beat.shotOrder.filter((id) => id !== shotId) });
    }
  }
  project.bin = project.bin.filter((item) => item.kind !== 'shot' || item.shotId !== shotId);
};

const verifyUndoDigest = (project: StudioProjectV2, patch: StudioUndoPatch): boolean => {
  switch (patch.kind) {
    case 'project_fields':
      return authoredDigest(projectFields(project)) === patch.afterDigest;
    case 'beat_fields':
      return authoredDigest(ownValue(project.beats, patch.beatId) ?? null) === patch.afterDigest;
    case 'shot_fields':
      return authoredDigest(currentShotFragment(project, patch.shotId)) === patch.afterDigest;
    case 'bin':
      return authoredDigest(project.bin) === patch.afterDigest;
  }
};

const undoPatchChangesChainBreak = (project: StudioProjectV2, patch: StudioUndoPatch): boolean => {
  if (patch.kind !== 'shot_fields') return false;
  const currentChainBreak = ownValue(project.shots, patch.shotId)?.chainBreak;
  const restoredChainBreak = patch.before?.chainBreak;
  return (
    currentChainBreak !== restoredChainBreak && (currentChainBreak === 'hard_cut' || restoredChainBreak === 'hard_cut')
  );
};

const applyUndoEntry = (project: StudioProjectV2, entryId: string): StudioProjectV2 => {
  const entry = project.undoHistory.at(-1);
  if (entry === undefined || entry.id !== entryId || entry.patches.some((patch) => !verifyUndoDigest(project, patch))) {
    return fail('undo_conflict');
  }
  if (entry.patches.some((patch) => undoPatchChangesChainBreak(project, patch))) fail('undo_conflict');

  const draft = structuredClone(project);
  for (const patch of entry.patches.toReversed()) {
    if (patch.kind !== 'shot_fields') continue;
    const current = ownValue(draft.shots, patch.shotId);
    if (patch.before === null) {
      if (current === undefined || shotHasDestructiveDependency(draft, current)) fail('undo_conflict');
      removeShotFromMembership(draft, patch.shotId);
      delete draft.shots[patch.shotId];
      continue;
    }
    removeShotFromMembership(draft, patch.shotId);
    defineOwn(draft.shots, patch.shotId, {
      ...structuredClone(patch.before),
      assetIds: current === undefined ? [] : [...current.assetIds],
      jobIds: current === undefined ? [] : [...current.jobIds],
    });
    if (patch.beforeBeatId !== null && patch.beforeIndex !== null) {
      const beat = ownValue(draft.beats, patch.beforeBeatId);
      if (beat === undefined || patch.beforeIndex < 0 || patch.beforeIndex > beat.shotOrder.length)
        fail('undo_conflict');
      defineOwn(draft.beats, beat.id, {
        ...beat,
        shotOrder: [
          ...beat.shotOrder.slice(0, patch.beforeIndex),
          patch.shotId,
          ...beat.shotOrder.slice(patch.beforeIndex),
        ],
      });
    }
  }

  for (const patch of entry.patches.toReversed()) {
    if (patch.kind !== 'beat_fields') continue;
    const current = ownValue(draft.beats, patch.beatId);
    if (patch.before === null) {
      if (current === undefined || current.shotOrder.length > 0) fail('undo_conflict');
      draft.beatOrder = draft.beatOrder.filter((id) => id !== patch.beatId);
      draft.bin = draft.bin.filter((item) => item.kind !== 'beat' || item.beatId !== patch.beatId);
      delete draft.beats[patch.beatId];
    } else {
      defineOwn(draft.beats, patch.beatId, structuredClone(patch.before));
    }
  }

  for (const patch of entry.patches.toReversed()) {
    if (patch.kind === 'project_fields') {
      Object.assign(draft, structuredClone(patch.before));
    } else if (patch.kind === 'bin') {
      draft.bin = structuredClone(patch.before);
    }
  }
  draft.undoHistory = draft.undoHistory.slice(0, -1);
  if (!validateStudioProjectV2(draft)) fail('undo_conflict');
  return draft;
};

/**
 * Applies one ordered mutation batch to an isolated draft. Persistence owns CAS,
 * timestamps, revision advancement, and renderer projection.
 */
export const applyStudioMutationBatchV2 = (
  project: StudioProjectV2,
  batch: StudioMutationBatchV2,
  context: StudioMutationReducerContextV2
): StudioMutationApplyResultV2 => {
  if (!validateStudioProjectV2(project)) fail('validation_failed');
  if (!hasOnlyDataPropertiesDeep(batch) || !hasOnlyDataPropertiesDeep(context)) fail('invalid_operation');
  let draft: StudioProjectV2;
  let batchSnapshot: unknown;
  let contextSnapshot: unknown;
  try {
    draft = structuredClone(project);
    batchSnapshot = structuredClone(batch as unknown);
    contextSnapshot = structuredClone(context as unknown);
  } catch {
    fail('validation_failed');
  }
  const reducerContext = assertContext(contextSnapshot);
  const operations = assertBatchEnvelope(draft, batchSnapshot);
  for (const operation of operations) assertOperationShape(operation);
  if (operations.some((operation) => (operation as StudioMutationOperationV2).kind === 'undo_last')) {
    if (operations.length !== 1) fail('invalid_operation');
    const operation = operations[0] as Extract<StudioMutationOperationV2, { kind: 'undo_last' }>;
    const undone = applyUndoEntry(draft, operation.entryId);
    return { project: undone, createdBeatIds: [], createdShotIds: [], coverageResults: [] };
  }
  if (draft.undoHistory.some((entry) => entry.id === reducerContext.mutationId)) fail('identity_collision');
  const knownBeatIds = new Set(Object.keys(draft.beats));
  const knownShotIds = new Set(Object.keys(draft.shots));
  const createdBeatIds: string[] = [];
  const createdShotIds: string[] = [];
  const coverageResults: StudioCoverageApplyResult[] = [];
  const tracker = createUndoTracker();
  const historyEntryCounts = new Map<number, number>();

  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const rawOperation = operations[operationIndex];
    assertOperationShape(rawOperation);
    const operation = rawOperation;

    switch (operation.kind) {
      case 'edit_project': {
        const changes = operation.changes;
        if (
          Object.entries(changes).every(([key, value]) =>
            Object.is(draft[key as keyof StudioEditableProjectSettingsChanges], value)
          )
        ) {
          fail('invalid_operation');
        }
        const aspectRatioChanged = Object.hasOwn(changes, 'aspectRatio') && changes.aspectRatio !== draft.aspectRatio;
        const resolutionChanged = Object.hasOwn(changes, 'resolution') && changes.resolution !== draft.resolution;
        if ((aspectRatioChanged || resolutionChanged) && hasBoundNonterminalJob(draft)) {
          fail('dependency_blocked');
        }
        touchProject(tracker, draft);
        Object.assign(draft, changes);
        break;
      }

      case 'set_brief':
        if (draft.brief === operation.brief) fail('invalid_operation');
        if (hasBoundNonterminalJob(draft)) fail('dependency_blocked');
        touchProject(tracker, draft);
        draft.brief = operation.brief;
        break;

      case 'set_rules': {
        const existingById = new Map(draft.rules.map((rule) => [rule.id, rule]));
        const rules: StudioBriefRule[] = operation.rules.map((rule) => ({
          id: rule.id,
          scope: 'project',
          text: rule.text,
          predicate: rule.predicate === null ? null : { kind: 'forbidden_terms', terms: [...rule.predicate.terms] },
          createdAt: existingById.get(rule.id)?.createdAt ?? reducerContext.capturedAt,
        }));
        if (sameValue(draft.rules, rules)) fail('invalid_operation');
        if (hasBoundNonterminalJob(draft)) fail('dependency_blocked');
        touchProject(tracker, draft);
        draft.rules = rules;
        break;
      }

      case 'add_beat': {
        if (operation.beforeBeatId !== null && !draft.beatOrder.includes(operation.beforeBeatId)) {
          fail('invalid_operation');
        }
        if (Object.keys(draft.beats).length >= STUDIO_MAX_BEATS) fail('beat_capacity_reached');
        if (knownBeatIds.has(operation.beatId)) fail('identity_collision');

        touchProject(tracker, draft);
        touchBeat(tracker, draft, operation.beatId);
        const beat: StudioBeat = {
          id: operation.beatId,
          title: operation.beat.title,
          action: operation.beat.action,
          look: operation.beat.look,
          actionRevision: 1,
          targetSeconds: operation.beat.targetSeconds,
          shotOrder: [],
          lineHistory: [],
        };
        defineOwn(draft.beats, beat.id, beat);
        draft.beatOrder = insertBefore(draft.beatOrder, beat.id, operation.beforeBeatId);
        knownBeatIds.add(beat.id);
        createdBeatIds.push(beat.id);
        break;
      }

      case 'add_binned_beat': {
        if (Object.keys(draft.beats).length >= STUDIO_MAX_BEATS) fail('beat_capacity_reached');
        if (knownBeatIds.has(operation.beatId)) fail('identity_collision');
        touchBeat(tracker, draft, operation.beatId);
        touchBin(tracker, draft);
        defineOwn(draft.beats, operation.beatId, {
          id: operation.beatId,
          title: operation.beat.title,
          action: operation.beat.action,
          look: operation.beat.look,
          actionRevision: 1,
          targetSeconds: operation.beat.targetSeconds,
          shotOrder: [],
          lineHistory: [],
        });
        draft.bin.push({ kind: 'beat', beatId: operation.beatId, reason: 'alternate' });
        knownBeatIds.add(operation.beatId);
        createdBeatIds.push(operation.beatId);
        break;
      }

      case 'edit_beat': {
        const beat = ownValue(draft.beats, operation.beatId);
        if (beat === undefined) fail('invalid_operation');
        if (
          Object.entries(operation.changes).every(([key, value]) => Object.is(beat[key as keyof StudioBeat], value))
        ) {
          fail('invalid_operation');
        }
        const actionChanged = Object.hasOwn(operation.changes, 'action') && operation.changes.action !== beat.action;
        const lookChanged = Object.hasOwn(operation.changes, 'look') && operation.changes.look !== beat.look;
        const ownsMatchTarget = draft.matchToShotId !== null && beat.shotOrder.includes(draft.matchToShotId);
        if (
          lookChanged &&
          hasBoundNonterminalJob(draft, (job) => beat.shotOrder.includes(job.shotId) || ownsMatchTarget)
        ) {
          fail('dependency_blocked');
        }
        if (actionChanged && beat.actionRevision >= Number.MAX_SAFE_INTEGER) {
          fail('validation_failed');
        }
        touchBeat(tracker, draft, beat.id);
        defineOwn(draft.beats, beat.id, {
          ...beat,
          ...operation.changes,
          id: beat.id,
          actionRevision: actionChanged ? beat.actionRevision + 1 : beat.actionRevision,
        });
        break;
      }

      case 'reorder_beats':
        if (!isExactPermutation(draft.beatOrder, operation.beatOrder, (id) => id)) fail('invalid_operation');
        if (sameValue(draft.beatOrder, operation.beatOrder)) fail('invalid_operation');
        touchProject(tracker, draft);
        draft.beatOrder = copyArray(operation.beatOrder);
        break;

      case 'park_beat': {
        const activeIndex = draft.beatOrder.indexOf(operation.beatId);
        const beat = ownValue(draft.beats, operation.beatId);
        if (activeIndex < 0 || beat === undefined) fail('invalid_operation');
        if (deriveStudioInboundShotReferencesV2(draft, beat.shotOrder).length > 0) fail('dependency_blocked');
        touchProject(tracker, draft);
        touchBin(tracker, draft);
        draft.beatOrder = draft.beatOrder.filter((beatId) => beatId !== operation.beatId);
        draft.bin = [...draft.bin, { kind: 'beat', beatId: operation.beatId, reason: 'lifted' }];
        break;
      }

      case 'restore_beat': {
        const binIndex = draft.bin.findIndex((item) => item.kind === 'beat' && item.beatId === operation.beatId);
        if (binIndex < 0 || ownValue(draft.beats, operation.beatId) === undefined) fail('invalid_operation');
        if (operation.beforeBeatId !== null && !draft.beatOrder.includes(operation.beforeBeatId)) {
          fail('invalid_operation');
        }
        touchProject(tracker, draft);
        touchBin(tracker, draft);
        draft.bin = [...draft.bin.slice(0, binIndex), ...draft.bin.slice(binIndex + 1)];
        draft.beatOrder = insertBefore(draft.beatOrder, operation.beatId, operation.beforeBeatId);
        break;
      }

      case 'add_shot': {
        const beat = ownValue(draft.beats, operation.beatId);
        if (beat === undefined) fail('invalid_operation');
        assertShotDuration(operation.shot.durationSeconds);
        if (operation.beforeShotId !== null && !beat.shotOrder.includes(operation.beforeShotId)) {
          fail('invalid_operation');
        }
        if (beat.shotOrder.length >= STUDIO_MAX_SHOTS_PER_BEAT) fail('beat_shot_capacity_reached');
        if (Object.keys(draft.shots).length >= STUDIO_MAX_SHOTS_PER_PROJECT) fail('project_shot_capacity_reached');
        if (knownShotIds.has(operation.shotId)) fail('identity_collision');
        if (
          operation.beforeShotId !== null &&
          hasBoundNonterminalJob(draft, (job) => job.shotId === operation.beforeShotId)
        ) {
          fail('dependency_blocked');
        }

        touchBeat(tracker, draft, beat.id);
        touchShot(tracker, draft, operation.shotId);
        const shot: StudioShot = {
          id: operation.shotId,
          ...operation.shot,
          derivation: 'derived',
          derivedFromActionRevision: beat.actionRevision,
          trimInSeconds: null,
          trimOutSeconds: null,
          chainBreak: 'none',
          seedStillId: null,
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
        if (Object.hasOwn(operation.changes, 'durationSeconds')) {
          assertShotDuration(operation.changes.durationSeconds!);
        }
        if (
          Object.entries(operation.changes).every(([key, value]) => Object.is(current[key as keyof StudioShot], value))
        ) {
          fail('invalid_operation');
        }
        const lineChanged = Object.hasOwn(operation.changes, 'line') && operation.changes.line !== current.line;
        const durationChanged =
          Object.hasOwn(operation.changes, 'durationSeconds') &&
          operation.changes.durationSeconds !== current.durationSeconds;
        if (
          (lineChanged &&
            hasBoundNonterminalJob(
              draft,
              (job) => job.shotId === current.id || (draft.matchToShotId === current.id && job.shotId !== current.id)
            )) ||
          (durationChanged && hasBoundNonterminalJob(draft, (job) => job.shotId === current.id))
        ) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, current.id);
        if (lineChanged) {
          const historyIndex = historyEntryCounts.get(operationIndex) ?? 0;
          archiveDetachedLine(
            draft,
            tracker,
            current,
            operation.changes.line ?? null,
            reducerContext,
            operationIndex,
            historyIndex
          );
          historyEntryCounts.set(operationIndex, historyIndex + 1);
        }
        const next: StudioShot = {
          ...current,
          ...operation.changes,
          id: current.id,
          ...(lineChanged ? { derivation: 'detached' as const, derivedFromActionRevision: null } : {}),
        };
        defineOwn(draft.shots, next.id, next);
        break;
      }

      case 'delete_shot': {
        const shot = ownValue(draft.shots, operation.shotId);
        const owner = findActiveShotOwner(draft, operation.shotId);
        if (shot === undefined || owner === undefined) fail('invalid_operation');
        if (shotHasDestructiveDependency(draft, shot)) fail('dependency_blocked');
        touchBeat(tracker, draft, owner.id);
        touchShot(tracker, draft, shot.id);
        const historyIndex = historyEntryCounts.get(operationIndex) ?? 0;
        archiveDetachedLine(draft, tracker, shot, null, reducerContext, operationIndex, historyIndex);
        historyEntryCounts.set(operationIndex, historyIndex + 1);
        delete draft.shots[shot.id];
        const currentOwner = ownValue(draft.beats, owner.id);
        if (currentOwner === undefined) fail('invalid_operation');
        defineOwn(draft.beats, owner.id, {
          ...currentOwner,
          shotOrder: currentOwner.shotOrder.filter((shotId) => shotId !== shot.id),
        });
        break;
      }

      case 'park_shot': {
        const shot = ownValue(draft.shots, operation.shotId);
        const owner = findActiveShotOwner(draft, operation.shotId);
        if (shot === undefined || owner === undefined) fail('invalid_operation');
        if (deriveStudioInboundShotReferencesV2(draft, [shot.id]).length > 0) fail('dependency_blocked');
        touchBeat(tracker, draft, owner.id);
        touchBin(tracker, draft);
        defineOwn(draft.beats, owner.id, {
          ...owner,
          shotOrder: owner.shotOrder.filter((shotId) => shotId !== shot.id),
        });
        draft.bin.push({ kind: 'shot', beatId: owner.id, shotId: shot.id, reason: 'lifted' });
        break;
      }

      case 'restore_shot': {
        const binIndex = draft.bin.findIndex(
          (item) => item.kind === 'shot' && item.shotId === operation.shotId && item.reason === 'lifted'
        );
        const item = binIndex < 0 ? undefined : draft.bin[binIndex];
        if (item === undefined || item.kind !== 'shot' || ownValue(draft.shots, operation.shotId) === undefined) {
          fail('invalid_operation');
        }
        const beatId = (item as Extract<StudioBinItem, { kind: 'shot' }>).beatId;
        const beat = ownValue(draft.beats, beatId);
        if (beat === undefined) fail('invalid_operation');
        if (operation.beforeShotId !== null && !beat.shotOrder.includes(operation.beforeShotId)) {
          fail('invalid_operation');
        }
        if (beat.shotOrder.length >= STUDIO_MAX_SHOTS_PER_BEAT) fail('beat_shot_capacity_reached');
        if (hasBoundNonterminalJob(draft, (job) => job.shotId === operation.beforeShotId)) {
          fail('dependency_blocked');
        }
        touchBeat(tracker, draft, beat.id);
        touchBin(tracker, draft);
        draft.bin = [...draft.bin.slice(0, binIndex), ...draft.bin.slice(binIndex + 1)];
        defineOwn(draft.beats, beat.id, {
          ...beat,
          shotOrder: insertBefore(beat.shotOrder, operation.shotId, operation.beforeShotId),
        });
        break;
      }

      case 'reorder_shots': {
        const beat = ownValue(draft.beats, operation.beatId);
        if (beat === undefined || !isExactPermutation(beat.shotOrder, operation.shotOrder, (id) => id)) {
          fail('invalid_operation');
        }
        if (sameValue(beat.shotOrder, operation.shotOrder)) fail('invalid_operation');
        if (hasBoundNonterminalJob(draft, (job) => beat.shotOrder.includes(job.shotId))) fail('dependency_blocked');
        touchBeat(tracker, draft, beat.id);
        defineOwn(draft.beats, beat.id, { ...beat, shotOrder: copyArray(operation.shotOrder) });
        break;
      }

      case 'apply_coverage': {
        const beat = ownValue(draft.beats, operation.beatId);
        if (beat === undefined || !draft.beatOrder.includes(beat.id)) fail('invalid_operation');
        const proposedIds = operation.shots.map((shot) => shot.shotId);
        if (new Set(proposedIds).size !== proposedIds.length) fail('invalid_operation');
        const currentIds = new Set(beat.shotOrder);
        for (const proposed of operation.shots) {
          const existing = ownValue(draft.shots, proposed.shotId);
          if (
            (existing === undefined && proposed.chainBreak === 'hard_cut') ||
            (existing !== undefined && currentIds.has(existing.id) && existing.chainBreak !== proposed.chainBreak)
          ) {
            fail('invalid_operation');
          }
        }
        const expectedFixed = beat.shotOrder.flatMap((shotId) => {
          const shot = ownValue(draft.shots, shotId);
          if (shot === undefined) return [];
          const reasons = fixedReasons(draft, shot);
          return reasons.length === 0 ? [] : [{ shotId, reasons }];
        });
        if (!sameValue(operation.fixedShots, expectedFixed)) fail('dependency_blocked');

        const newIds = proposedIds.filter((shotId) => !currentIds.has(shotId));
        for (const shotId of newIds) {
          if (knownShotIds.has(shotId)) fail('identity_collision');
        }
        const removedIds = beat.shotOrder.filter((shotId) => !proposedIds.includes(shotId));
        if (Object.keys(draft.shots).length - removedIds.length + newIds.length > STUDIO_MAX_SHOTS_PER_PROJECT) {
          fail('project_shot_capacity_reached');
        }

        const currentBoundaries = studioPlanningShotBoundariesV2(beat, draft.shots);
        if (currentBoundaries === null) fail('validation_failed');
        const currentBoundaryById = new Map(currentBoundaries.map((boundary) => [boundary.shotId, boundary]));
        let proposedCursor = 0;
        for (const proposed of operation.shots) {
          const existing = ownValue(draft.shots, proposed.shotId);
          if (existing !== undefined && !currentIds.has(existing.id)) fail('invalid_operation');
          const proposedEnd = proposedCursor + proposed.durationSeconds;
          if (expectedFixed.some((fixed) => fixed.shotId === proposed.shotId)) {
            const currentBoundary = currentBoundaryById.get(proposed.shotId);
            if (
              currentBoundary === undefined ||
              currentBoundary.startSeconds !== proposedCursor ||
              currentBoundary.endSeconds !== proposedEnd ||
              existing === undefined ||
              existing.line !== proposed.line ||
              existing.narration !== proposed.narration ||
              existing.onScreenText !== proposed.onScreenText ||
              existing.durationSeconds !== proposed.durationSeconds ||
              existing.chainBreak !== proposed.chainBreak
            ) {
              fail('dependency_blocked');
            }
          }
          proposedCursor = proposedEnd;
        }
        if (expectedFixed.some((fixed) => !proposedIds.includes(fixed.shotId))) fail('dependency_blocked');

        touchBeat(tracker, draft, beat.id);
        for (const shotId of removedIds) {
          const shot = ownValue(draft.shots, shotId);
          if (shot === undefined || shotHasDestructiveDependency(draft, shot)) fail('dependency_blocked');
          touchShot(tracker, draft, shotId);
          const historyIndex = historyEntryCounts.get(operationIndex) ?? 0;
          archiveDetachedLine(draft, tracker, shot, null, reducerContext, operationIndex, historyIndex);
          historyEntryCounts.set(operationIndex, historyIndex + 1);
          delete draft.shots[shotId];
        }

        for (const proposed of operation.shots) {
          const existing = ownValue(draft.shots, proposed.shotId);
          if (existing === undefined) {
            touchShot(tracker, draft, proposed.shotId);
            defineOwn(draft.shots, proposed.shotId, {
              id: proposed.shotId,
              line: proposed.line,
              derivation: 'derived',
              derivedFromActionRevision: beat.actionRevision,
              narration: proposed.narration,
              onScreenText: proposed.onScreenText,
              durationSeconds: proposed.durationSeconds,
              trimInSeconds: null,
              trimOutSeconds: null,
              chainBreak: proposed.chainBreak,
              seedStillId: null,
              selectedTakeId: null,
              assetIds: [],
              jobIds: [],
            });
            knownShotIds.add(proposed.shotId);
            createdShotIds.push(proposed.shotId);
            continue;
          }
          if (expectedFixed.some((fixed) => fixed.shotId === existing.id)) continue;
          const lineChanged = existing.line !== proposed.line;
          if (
            !lineChanged &&
            existing.narration === proposed.narration &&
            existing.onScreenText === proposed.onScreenText &&
            existing.durationSeconds === proposed.durationSeconds &&
            existing.chainBreak === proposed.chainBreak
          ) {
            continue;
          }
          touchShot(tracker, draft, existing.id);
          if (lineChanged) {
            const historyIndex = historyEntryCounts.get(operationIndex) ?? 0;
            archiveDetachedLine(draft, tracker, existing, proposed.line, reducerContext, operationIndex, historyIndex);
            historyEntryCounts.set(operationIndex, historyIndex + 1);
          }
          defineOwn(draft.shots, existing.id, {
            ...existing,
            line: proposed.line,
            narration: proposed.narration,
            onScreenText: proposed.onScreenText,
            durationSeconds: proposed.durationSeconds,
            chainBreak: proposed.chainBreak,
            ...(lineChanged ? { derivation: 'derived' as const, derivedFromActionRevision: beat.actionRevision } : {}),
          });
        }
        defineOwn(draft.beats, beat.id, { ...ownValue(draft.beats, beat.id)!, shotOrder: [...proposedIds] });
        coverageResults.push({
          beatId: beat.id,
          createdShotIds: proposedIds.filter((id) => newIds.includes(id)),
          retainedShotIds: proposedIds.filter((id) => currentIds.has(id)),
          removedShotIds: removedIds,
          fixedShotIds: proposedIds.filter((id) => expectedFixed.some((fixed) => fixed.shotId === id)),
        });
        break;
      }

      case 'set_hard_cut': {
        return fail('invalid_operation');
      }

      case 'set_seed_still': {
        const shot = ownValue(draft.shots, operation.shotId);
        if (shot === undefined || findActiveShotOwner(draft, shot.id) === undefined) fail('invalid_operation');
        if (operation.assetId !== null) assertCanonicalSeed(draft, shot.id, operation.assetId);
        if (shot.seedStillId === operation.assetId) fail('invalid_operation');
        if (!seedMatchesWaitingAuthorizedDependencies(draft, shot.id, operation.assetId)) {
          fail('dependency_blocked');
        }
        if (hasBoundNonterminalJob(draft, (job) => job.shotId === shot.id)) fail('dependency_blocked');
        touchShot(tracker, draft, shot.id);
        defineOwn(draft.shots, shot.id, { ...shot, seedStillId: operation.assetId });
        break;
      }

      case 'trim_shot': {
        const shot = ownValue(draft.shots, operation.shotId);
        if (shot === undefined || findActiveShotOwner(draft, shot.id) === undefined) fail('invalid_operation');
        if (shot.selectedTakeId === null) fail('invalid_operation');
        const [, selected] = assertCanonicalVideoTake(draft, shot.id, shot.selectedTakeId);
        const sourceDuration = selected.durationSeconds;
        if (
          typeof sourceDuration !== 'number' ||
          (operation.trimInSeconds !== null && operation.trimInSeconds >= sourceDuration) ||
          (operation.trimOutSeconds !== null && operation.trimOutSeconds >= sourceDuration) ||
          (operation.trimInSeconds ?? 0) + (operation.trimOutSeconds ?? 0) >= sourceDuration
        ) {
          fail('invalid_operation');
        }
        if (shot.trimInSeconds === operation.trimInSeconds && shot.trimOutSeconds === operation.trimOutSeconds) {
          fail('invalid_operation');
        }
        if (
          shot.trimOutSeconds !== operation.trimOutSeconds &&
          hasBoundNonterminalJob(draft, (job) => jobReferencesShot(draft, job, shot.id))
        ) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, shot.id);
        defineOwn(draft.shots, shot.id, {
          ...shot,
          trimInSeconds: operation.trimInSeconds,
          trimOutSeconds: operation.trimOutSeconds,
        });
        break;
      }

      case 'redetach_line': {
        const shot = ownValue(draft.shots, operation.shotId);
        if (shot === undefined || findActiveShotOwner(draft, shot.id) === undefined) fail('invalid_operation');
        if (shot.line === operation.line && shot.derivation === 'detached') fail('invalid_operation');
        if (hasBoundNonterminalJob(draft, (job) => job.shotId === shot.id || draft.matchToShotId === shot.id)) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, shot.id);
        const historyIndex = historyEntryCounts.get(operationIndex) ?? 0;
        archiveDetachedLine(draft, tracker, shot, operation.line, reducerContext, operationIndex, historyIndex);
        historyEntryCounts.set(operationIndex, historyIndex + 1);
        defineOwn(draft.shots, shot.id, {
          ...shot,
          line: operation.line,
          derivation: 'detached',
          derivedFromActionRevision: null,
        });
        break;
      }

      case 'rederive_line': {
        const shot = ownValue(draft.shots, operation.shotId);
        const owner = shot === undefined ? undefined : findActiveShotOwner(draft, shot.id);
        if (shot === undefined || owner === undefined) fail('invalid_operation');
        if (
          shot.line === operation.line &&
          shot.derivation === 'derived' &&
          shot.derivedFromActionRevision === owner.actionRevision
        ) {
          fail('invalid_operation');
        }
        if (hasBoundNonterminalJob(draft, (job) => job.shotId === shot.id || draft.matchToShotId === shot.id)) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, shot.id);
        const historyIndex = historyEntryCounts.get(operationIndex) ?? 0;
        archiveDetachedLine(draft, tracker, shot, operation.line, reducerContext, operationIndex, historyIndex);
        historyEntryCounts.set(operationIndex, historyIndex + 1);
        defineOwn(draft.shots, shot.id, {
          ...shot,
          line: operation.line,
          derivation: 'derived',
          derivedFromActionRevision: owner.actionRevision,
        });
        break;
      }

      case 'restore_line': {
        const shot = ownValue(draft.shots, operation.shotId);
        const owner = shot === undefined ? undefined : findActiveShotOwner(draft, shot.id);
        const history = owner?.lineHistory.find((entry) => entry.id === operation.historyEntryId);
        if (shot === undefined || owner === undefined || history === undefined) fail('invalid_operation');
        if (shot.line === history.text && shot.derivation === 'detached') fail('invalid_operation');
        if (hasBoundNonterminalJob(draft, (job) => job.shotId === shot.id || draft.matchToShotId === shot.id)) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, shot.id);
        const historyIndex = historyEntryCounts.get(operationIndex) ?? 0;
        archiveDetachedLine(draft, tracker, shot, history.text, reducerContext, operationIndex, historyIndex);
        historyEntryCounts.set(operationIndex, historyIndex + 1);
        defineOwn(draft.shots, shot.id, {
          ...shot,
          line: history.text,
          derivation: 'detached',
          derivedFromActionRevision: null,
        });
        break;
      }

      case 'park_take':
      case 'add_alternate_take': {
        const [shot] = assertCanonicalTake(draft, operation.shotId, operation.assetId);
        if (findActiveShotOwner(draft, shot.id) === undefined) fail('invalid_operation');
        if (binHasTake(draft, operation.assetId)) fail('invalid_operation');
        if (shot.selectedTakeId === operation.assetId || shot.seedStillId === operation.assetId) {
          fail('dependency_blocked');
        }
        if (
          takeHasNonterminalConditioningUse(draft, operation.assetId) ||
          takeIsLastSelectableForWaitingDependency(draft, operation.assetId)
        ) {
          fail('dependency_blocked');
        }
        if (binCounts(draft.bin).takes >= STUDIO_MAX_BIN_TAKE_ITEMS) fail('take_bin_capacity_reached');
        touchBin(tracker, draft);
        draft.bin.push({
          kind: 'take',
          assetId: operation.assetId,
          reason: operation.kind === 'park_take' ? 'lifted' : 'alternate',
        });
        break;
      }

      case 'restore_take': {
        assertCanonicalTake(draft, operation.shotId, operation.assetId);
        const binIndex = draft.bin.findIndex((item) => item.kind === 'take' && item.assetId === operation.assetId);
        if (binIndex < 0) fail('invalid_operation');
        touchBin(tracker, draft);
        draft.bin = [...draft.bin.slice(0, binIndex), ...draft.bin.slice(binIndex + 1)];
        break;
      }

      case 'reorder_bin':
        if (
          !isExactPermutation(draft.bin, operation.bin, binIdentity) ||
          operation.bin.some((item) => {
            const current = draft.bin.find((candidate) => binIdentity(candidate) === binIdentity(item));
            return current === undefined || !sameValue(current, item);
          }) ||
          sameValue(draft.bin, operation.bin)
        ) {
          fail('invalid_operation');
        }
        touchBin(tracker, draft);
        draft.bin = structuredClone(operation.bin);
        break;

      case 'select_take': {
        const [shot, asset] = assertCanonicalVideoTake(draft, operation.shotId, operation.assetId);
        if (findActiveShotOwner(draft, shot.id) === undefined) fail('invalid_operation');
        if (binHasTake(draft, operation.assetId)) fail('invalid_operation');
        if (shot.selectedTakeId === operation.assetId) fail('invalid_operation');
        const duration = asset.durationSeconds;
        if (
          typeof duration !== 'number' ||
          (shot.trimInSeconds ?? 0) >= duration ||
          (shot.trimOutSeconds ?? 0) >= duration ||
          (shot.trimInSeconds ?? 0) + (shot.trimOutSeconds ?? 0) >= duration
        ) {
          fail('invalid_operation');
        }
        if (hasBoundNonterminalJob(draft, (job) => jobReferencesShot(draft, job, shot.id))) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, shot.id);
        defineOwn(draft.shots, shot.id, { ...shot, selectedTakeId: operation.assetId });
        break;
      }

      case 'set_routes': {
        if (draft.imageRouteId === operation.imageRouteId && draft.videoRouteId === operation.videoRouteId) {
          fail('invalid_operation');
        }
        if (
          draft.imageRouteId !== operation.imageRouteId &&
          hasBoundNonterminalJob(draft, (job) => job.purpose === 'seed_still')
        ) {
          fail('dependency_blocked');
        }
        if (
          draft.videoRouteId !== operation.videoRouteId &&
          hasBoundNonterminalJob(draft, (job) => job.purpose === 'video_take')
        ) {
          fail('dependency_blocked');
        }
        touchProject(tracker, draft);
        draft.imageRouteId = operation.imageRouteId;
        draft.videoRouteId = operation.videoRouteId;
        break;
      }

      case 'set_spend_policy':
        if (sameValue(draft.spendPolicy, operation.policy)) fail('invalid_operation');
        touchProject(tracker, draft);
        draft.spendPolicy = operation.policy === null ? null : { ...operation.policy };
        break;

      case 'set_match_to':
        if (operation.shotId !== null && findActiveShotOwner(draft, operation.shotId) === undefined) {
          fail('invalid_operation');
        }
        if (draft.matchToShotId === operation.shotId) fail('invalid_operation');
        if (hasBoundNonterminalJob(draft)) fail('dependency_blocked');
        touchProject(tracker, draft);
        draft.matchToShotId = operation.shotId;
        break;

      case 'set_bed': {
        if (operation.assetId !== null) {
          const asset = ownValue(draft.assets, operation.assetId);
          if (
            asset === undefined ||
            asset.projectId !== draft.id ||
            asset.shotId !== null ||
            asset.mediaKind !== 'audio' ||
            asset.managedAsset.collection !== 'imports' ||
            Object.hasOwn(asset, 'briefReferenceRole') ||
            Object.hasOwn(asset, 'briefReferenceLabel')
          ) {
            fail('invalid_operation');
          }
        }
        if (draft.bedAssetId === operation.assetId) fail('invalid_operation');
        touchProject(tracker, draft);
        draft.bedAssetId = operation.assetId;
        break;
      }

      case 'undo_last':
        fail('invalid_operation');
    }
  }

  const patches = buildUndoPatches(tracker, draft);
  if (patches.length === 0) fail('invalid_operation');
  const label = operations.length === 1 ? (operations[0] as StudioMutationOperationV2).kind : 'mutation_batch';
  if (label.length > STUDIO_MAX_UNDO_LABEL_LENGTH || draft.revision >= Number.MAX_SAFE_INTEGER) {
    fail('validation_failed');
  }
  draft.undoHistory = [
    ...draft.undoHistory,
    {
      id: reducerContext.mutationId,
      sourceRevision: draft.revision + 1,
      label,
      patches,
    },
  ].slice(-STUDIO_MAX_UNDO_ENTRIES);

  const validationCandidate: StudioProjectV2 = { ...draft, revision: draft.revision + 1 };
  if (!validateStudioProjectV2(validationCandidate)) fail('validation_failed');
  return { project: draft, createdBeatIds, createdShotIds, coverageResults };
};
