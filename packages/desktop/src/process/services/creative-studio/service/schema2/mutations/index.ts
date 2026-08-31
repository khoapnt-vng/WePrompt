/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { hasRuleToken, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import { studioPlanningShotBoundariesV2 } from '@/common/types/project/creativeStudioProjectSummary';
import {
  STUDIO_BOARD_STYLES_V2,
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_MAX_UNDO_ENTRIES,
  STUDIO_MAX_UNDO_LABEL_LENGTH,
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
  type StudioMutationReasonV2 as StudioMutationReason,
  type StudioMutationReducerContextV2,
  type StudioProjectV2,
  type StudioReferenceDraftV2,
  type StudioShot,
  type StudioSpendPolicy,
  type StudioUndoPatch,
} from '@/common/types/project/creativeStudioTypes';
export type { StudioMutationReasonV2 } from '@/common/types/project/creativeStudioTypes';
import { deriveStudioInboundShotReferencesV2 } from '../projections/chain';
import { deriveStudioFixedShotReasonsV2, studioJobReferencesShotV2 } from './fixedShots';
import {
  resolveStudioCanonicalBoardAssetV2,
  resolveStudioCurrentBoardPanelAuthorityV2,
} from '../generation/boardPanel';
import { validateStudioFixedShotReviewsV2, validateStudioProjectV2, validateStudioProposedShotV2 } from '../validation';

export type StudioMutationApplyResultV2 = {
  project: StudioProjectV2;
  createdBeatIds: string[];
  createdShotIds: string[];
  coverageResults: StudioCoverageApplyResult[];
};

/** Exact bounded entity evidence captured from the draft at the reducer refusal site. */
export type StudioMutationFailureSubjectV2 = {
  shotId: string;
  fixedReasons: StudioFixedShotReasonV2[];
};

/** A bounded mutation failure safe for translation by the service boundary. */
export class StudioMutationErrorV2 extends Error {
  readonly reasonCode: StudioMutationReason;
  readonly operationIndex: number | null;
  readonly subjects: StudioMutationFailureSubjectV2[];

  constructor(
    reasonCode: StudioMutationReason,
    operationIndex: number | null = null,
    subjects: readonly StudioMutationFailureSubjectV2[] = []
  ) {
    super(reasonCode);
    this.name = 'StudioMutationErrorV2';
    this.reasonCode = reasonCode;
    this.operationIndex = operationIndex;
    this.subjects = subjects.slice(0, STUDIO_MAX_SHOTS_PER_PROJECT).map((subject) => ({
      shotId: subject.shotId,
      fixedReasons: [...subject.fixedReasons],
    }));
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
const PROJECT_CHANGE_KEYS = new Set(['name', 'aspectRatio', 'resolution', 'targetDurationSeconds', 'boardStyle']);
const BOARD_STYLES: ReadonlySet<string> = new Set(STUDIO_BOARD_STYLES_V2);
const BEAT_INPUT_KEYS = new Set(['title', 'story', 'targetSeconds']);
const BEAT_CHANGE_KEYS = new Set(BEAT_INPUT_KEYS);
const SHOT_INPUT_KEYS = new Set(['shootingScript', 'durationSeconds']);
const SHOT_CHANGE_KEYS = new Set(SHOT_INPUT_KEYS);
const RULE_DRAFT_KEYS = new Set(['id', 'text', 'predicate']);
const RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const PROJECT_REFERENCE_DRAFT_KEYS = new Set(['kind', 'label', 'prompt']);
const SPEND_POLICY_KEYS = new Set(['currency', 'maxPerBatchMinorUnits']);
const BIN_BEAT_KEYS = new Set(['kind', 'beatId', 'reason']);
const BIN_SHOT_KEYS = new Set(['kind', 'beatId', 'shotId', 'reason']);
const OPERATION_KEYS: Readonly<Record<StudioMutationOperationV2['kind'], ReadonlySet<string>>> = {
  edit_project: new Set(['kind', 'changes']),
  set_brief: new Set(['kind', 'brief']),
  set_rules: new Set(['kind', 'rules']),
  set_reference_plan: new Set(['kind', 'references']),
  amend_reference_plan: new Set(['kind', 'additions']),
  set_reference_label: new Set(['kind', 'referenceId', 'label']),
  set_reference_prompt: new Set(['kind', 'referenceId', 'prompt']),
  select_reference_image: new Set(['kind', 'referenceId', 'assetId']),
  remove_reference_image: new Set(['kind', 'referenceId', 'assetId']),
  set_shot_reference_binding: new Set(['kind', 'shotId', 'characterReferenceIds', 'backgroundReferenceId']),
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
  dismiss_seed_still: new Set(['kind', 'shotId', 'assetId']),
  promote_board_panel: new Set(['kind', 'shotId', 'boardAssetId']),
  trim_shot: new Set(['kind', 'shotId', 'trimInSeconds', 'trimOutSeconds']),
  reorder_bin: new Set(['kind', 'bin']),
  set_routes: new Set(['kind', 'imageRouteId', 'videoRouteId']),
  set_spend_policy: new Set(['kind', 'policy']),
  set_bed: new Set(['kind', 'assetId']),
  undo_last: new Set(['kind', 'entryId']),
};

const fail = (reasonCode: StudioMutationReason, subjects: readonly StudioMutationFailureSubjectV2[] = []): never => {
  throw new StudioMutationErrorV2(reasonCode, null, subjects);
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

const isProjectReferenceDraft = (value: unknown): value is StudioReferenceDraftV2 =>
  isRecord(value) &&
  hasExactKeys(value, PROJECT_REFERENCE_DRAFT_KEYS) &&
  (value.kind === 'character' || value.kind === 'background') &&
  typeof value.label === 'string' &&
  value.label.trim().length > 0 &&
  value.label === value.label.trim() &&
  value.label.length <= STUDIO_MAX_REFERENCE_LABEL_LENGTH &&
  typeof value.prompt === 'string' &&
  value.prompt.trim().length > 0 &&
  value.prompt === value.prompt.trim() &&
  value.prompt.length <= STUDIO_MAX_REFERENCE_PROMPT_LENGTH;

const isProjectReferenceDraftArray = (value: unknown): value is StudioReferenceDraftV2[] => {
  if (!isDenseArray(value, STUDIO_MAX_PROJECT_REFERENCES)) return false;
  const labels = new Set<string>();
  let sawBackground = false;
  for (const candidate of value) {
    if (!isProjectReferenceDraft(candidate)) return false;
    const labelIdentity = `${candidate.kind}\0${candidate.label}`;
    if (labels.has(labelIdentity) || (sawBackground && candidate.kind === 'character')) return false;
    labels.add(labelIdentity);
    if (candidate.kind === 'background') sawBackground = true;
  }
  return true;
};

const REFERENCE_ID_DOMAIN = 'creative-studio/project-reference/v1';

/** Main-owned, replay-stable identity for one Director-selected semantic reference. */
export const createStudioProjectReferenceIdV2 = (
  projectId: string,
  mutationId: string,
  operationIndex: number,
  referenceIndex: number
): string => {
  if (
    !isSafeId(projectId) ||
    !isSafeId(mutationId) ||
    !Number.isSafeInteger(operationIndex) ||
    operationIndex < 0 ||
    !Number.isSafeInteger(referenceIndex) ||
    referenceIndex < 0
  ) {
    throw new TypeError('Invalid Studio project-reference identity input');
  }
  const material = [REFERENCE_ID_DOMAIN, projectId, mutationId, String(operationIndex), String(referenceIndex)].join(
    '\0'
  );
  return `ref_${createHash('sha256').update(material, 'utf8').digest('hex')}`;
};

const isEditableBeat = (value: unknown): value is StudioEditableBeat =>
  isRecord(value) &&
  hasExactKeys(value, BEAT_INPUT_KEYS) &&
  isStringWithin(value.title, 256) &&
  isStringWithin(value.story, STUDIO_MAX_STORY_LENGTH) &&
  (value.targetSeconds === null ||
    (isInteger(value.targetSeconds) && value.targetSeconds >= 1 && value.targetSeconds <= 1440));

const isEditableBeatChanges = (value: unknown): value is StudioEditableBeatChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => BEAT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'title') || isStringWithin(value.title, 256)) &&
    (!Object.hasOwn(value, 'story') || isStringWithin(value.story, STUDIO_MAX_STORY_LENGTH)) &&
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
    (!Object.hasOwn(value, 'boardStyle') ||
      value.boardStyle === null ||
      (typeof value.boardStyle === 'string' && BOARD_STYLES.has(value.boardStyle))) &&
    (!Object.hasOwn(value, 'targetDurationSeconds') ||
      (isInteger(value.targetDurationSeconds) &&
        value.targetDurationSeconds >= 5 &&
        value.targetDurationSeconds <= 1440))
  );
};

const isEditableShotShape = (value: unknown): value is StudioEditableShot =>
  isRecord(value) &&
  hasExactKeys(value, SHOT_INPUT_KEYS) &&
  isStringWithin(value.shootingScript, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) &&
  isInteger(value.durationSeconds);

const isEditableShotChangesShape = (value: unknown): value is StudioEditableShotChanges => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => SHOT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'shootingScript') ||
      isStringWithin(value.shootingScript, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH)) &&
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
  return false;
};

const isBinItemArray = (value: unknown): value is StudioBinItem[] => {
  if (!isDenseArray(value, STUDIO_MAX_BIN_BEAT_ITEMS + STUDIO_MAX_BIN_SHOT_ITEMS)) {
    return false;
  }
  const counts = { beat: 0, shot: 0 };
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isBinItem(item)) return false;
    counts[item.kind] += 1;
  }
  return counts.beat <= STUDIO_MAX_BIN_BEAT_ITEMS && counts.shot <= STUDIO_MAX_BIN_SHOT_ITEMS;
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
    case 'set_reference_plan':
      if (!isProjectReferenceDraftArray(operation.references)) fail('invalid_operation');
      return;
    case 'amend_reference_plan':
      if (
        !isProjectReferenceDraftArray(operation.additions) ||
        operation.additions.length === 0 ||
        operation.additions.some((reference) => reference.kind !== 'background')
      ) {
        fail('invalid_operation');
      }
      return;
    case 'set_reference_label':
      if (
        !isSafeId(operation.referenceId) ||
        !isStringWithin(operation.label, STUDIO_MAX_REFERENCE_LABEL_LENGTH) ||
        operation.label.length === 0 ||
        operation.label !== operation.label.trim()
      ) {
        fail('invalid_operation');
      }
      return;
    case 'set_reference_prompt':
      if (
        !isSafeId(operation.referenceId) ||
        !isStringWithin(operation.prompt, STUDIO_MAX_REFERENCE_PROMPT_LENGTH) ||
        operation.prompt.length === 0 ||
        operation.prompt !== operation.prompt.trim()
      ) {
        fail('invalid_operation');
      }
      return;
    case 'select_reference_image':
    case 'remove_reference_image':
      if (!isSafeId(operation.referenceId) || !isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'set_shot_reference_binding':
      if (
        !isSafeId(operation.shotId) ||
        !isUniqueSafeIdArray(operation.characterReferenceIds, STUDIO_MAX_PROJECT_REFERENCES) ||
        !isSafeAnchor(operation.backgroundReferenceId)
      ) {
        fail('invalid_operation');
      }
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
    case 'dismiss_seed_still':
      if (!isSafeId(operation.shotId) || !isSafeId(operation.assetId)) fail('invalid_operation');
      return;
    case 'promote_board_panel':
      if (!isSafeId(operation.shotId) || !isSafeId(operation.boardAssetId)) fail('invalid_operation');
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
    case 'reorder_bin':
      if (!isBinItemArray(operation.bin)) fail('invalid_operation');
      return;
    case 'set_routes':
      if (!isSafeAnchor(operation.imageRouteId) || !isSafeAnchor(operation.videoRouteId)) fail('invalid_operation');
      return;
    case 'set_spend_policy':
      if (operation.policy !== null && !isSpendPolicy(operation.policy)) fail('invalid_operation');
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
    envelope.schemaVersion !== STUDIO_MUTATION_BATCH_SCHEMA_VERSION ||
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
  item.kind === 'beat' ? `beat:${item.beatId}` : `shot:${item.shotId}`;

const findActiveShotOwner = (project: StudioProjectV2, shotId: string): StudioBeat | undefined => {
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat?.shotOrder.includes(shotId)) return beat;
  }
  return undefined;
};

const segmentShotIdsFromHead = (project: StudioProjectV2, headShotId: string): string[] | null => {
  const beat = findActiveShotOwner(project, headShotId);
  if (beat === undefined) return null;
  const headIndex = beat.shotOrder.indexOf(headShotId);
  const head = ownValue(project.shots, headShotId);
  if (head === undefined || headIndex < 0 || (headIndex !== 0 && head.chainBreak !== 'hard_cut')) return null;
  const segmentShotIds: string[] = [];
  for (let shotIndex = headIndex; shotIndex < beat.shotOrder.length; shotIndex += 1) {
    const shotId = beat.shotOrder[shotIndex]!;
    const shot = ownValue(project.shots, shotId);
    if (shot === undefined) return null;
    if (shotIndex > headIndex && shot.chainBreak === 'hard_cut') break;
    segmentShotIds.push(shotId);
  }
  return segmentShotIds;
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
    !shot.assetIds.includes(asset.id)
  ) {
    fail('invalid_operation');
  }
  return [shot, asset];
};

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

const jobTargetsShot = (job: StudioJobV2, shotId: string): boolean =>
  job.target.kind === 'shot' && job.target.shotId === shotId;

const jobTargetsReference = (job: StudioJobV2, referenceId: string): boolean =>
  job.target.kind === 'reference' && job.target.referenceId === referenceId;

const jobUsesProjectReferenceAsset = (job: StudioJobV2, referenceId: string, assetId: string): boolean =>
  job.composition.inputs.referenceInputs.some(
    (input) => input.referenceId === referenceId && input.assetId === assetId
  );

const hasCanonicalProjectReferenceAsset = (
  project: StudioProjectV2,
  referenceId: string,
  assetId: string | null
): boolean => {
  const reference = ownValue(project.references, referenceId);
  if (reference === undefined || assetId === null) return false;
  const asset = ownValue(project.assets, assetId);
  if (
    asset?.id !== assetId ||
    asset.projectId !== project.id ||
    asset.mediaKind !== 'image' ||
    (asset.managedAsset.collection !== 'assets' && asset.managedAsset.collection !== 'imports') ||
    asset.shotId !== null ||
    asset.projectReferenceId !== reference.id
  ) {
    return false;
  }
  if (asset.managedAsset.collection === 'imports') {
    return (
      asset.producerJobId === null && asset.compositionDigest === null && asset.generationReferenceAssetIds.length === 0
    );
  }
  const producer = Object.values(project.jobs).filter(
    (job) =>
      job.projectId === project.id &&
      jobTargetsReference(job, reference.id) &&
      job.purpose === 'reference_image' &&
      job.status === 'succeeded' &&
      job.outputAssetIdsByRole.primary === asset.id &&
      job.outputAssetIds.filter((assetId) => assetId === asset.id).length === 1
  );
  if (producer.length !== 1) return false;
  return reference.jobIds.includes(producer[0]!.id);
};

const hasCanonicalApprovedProjectReferenceAsset = (project: StudioProjectV2, referenceId: string): boolean => {
  const reference = ownValue(project.references, referenceId);
  return hasCanonicalProjectReferenceAsset(project, referenceId, reference?.approvedAssetId ?? null);
};

const hasBoardHistory = (project: StudioProjectV2): boolean =>
  Object.values(project.jobs).some((job) => job.purpose === 'board_still') ||
  Object.values(project.shots).some((shot) => shot.boardAssetId !== null || shot.supersededBoardAssetIds.length > 0);

const seedMatchesWaitingAuthorizedDependencies = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string | null
): boolean => {
  const waitingJobs = Object.values(project.jobs).filter(
    (job) =>
      jobTargetsShot(job, shotId) &&
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
      upstreamItem?.target.kind !== 'shot' ||
      upstreamItem.target.shotId !== shotId ||
      upstreamItem.purpose !== 'seed_still'
    ) {
      return false;
    }

    return Object.values(project.jobs).some(
      (producer) =>
        producer.authorizationId === authorization.id &&
        producer.authorizationItemId === upstreamItem.id &&
        jobTargetsShot(producer, shotId) &&
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
  boardStyle: project.boardStyle,
  brief: project.brief,
  rules: structuredClone(project.rules),
  beatOrder: [...project.beatOrder],
  imageRouteId: project.imageRouteId,
  videoRouteId: project.videoRouteId,
  spendPolicy: project.spendPolicy === null ? null : { ...project.spendPolicy },
  bedAssetId: project.bedAssetId,
});

const referenceCatalog = (
  project: StudioProjectV2
): Extract<StudioUndoPatch, { kind: 'reference_catalog' }>['before'] => ({
  referencePlanStatus: project.referencePlanStatus,
  referenceOrder: [...project.referenceOrder],
  references: structuredClone(project.references),
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
    .toSorted()
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
  referenceCatalogBefore: ReturnType<typeof referenceCatalog> | null;
  beats: Map<string, StudioBeat | null>;
  shots: Map<string, ShotBefore>;
  binBefore: StudioBinItem[] | null;
};

const createUndoTracker = (): UndoTracker => ({
  projectBefore: null,
  referenceCatalogBefore: null,
  beats: new Map(),
  shots: new Map(),
  binBefore: null,
});

const touchProject = (tracker: UndoTracker, project: StudioProjectV2): void => {
  if (tracker.projectBefore === null) tracker.projectBefore = projectFields(project);
};

const touchReferenceCatalog = (tracker: UndoTracker, project: StudioProjectV2): void => {
  if (tracker.referenceCatalogBefore === null) tracker.referenceCatalogBefore = referenceCatalog(project);
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
  if (tracker.referenceCatalogBefore !== null) {
    patches.push({
      kind: 'reference_catalog',
      before: tracker.referenceCatalogBefore,
      afterDigest: authoredDigest(referenceCatalog(project)),
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

const shotHasDestructiveDependency = (project: StudioProjectV2, shot: StudioShot): boolean =>
  shot.assetIds.length > 0 ||
  shot.jobIds.length > 0 ||
  shot.videoAssetId !== null ||
  shot.seedStillId !== null ||
  shot.shootingScript.length > 0 ||
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
    case 'reference_catalog':
      return authoredDigest(referenceCatalog(project)) === patch.afterDigest;
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

const undoPatchClearsBoardStyleWithHistory = (project: StudioProjectV2, patch: StudioUndoPatch): boolean =>
  patch.kind === 'project_fields' && patch.before.boardStyle === null && hasBoardHistory(project);

const applyUndoEntry = (project: StudioProjectV2, entryId: string): StudioProjectV2 => {
  if (hasBoundNonterminalJob(project, (job) => job.purpose === 'board_still')) fail('undo_conflict');
  const entry = project.undoHistory.at(-1);
  if (entry === undefined || entry.id !== entryId || entry.patches.some((patch) => !verifyUndoDigest(project, patch))) {
    return fail('undo_conflict');
  }
  if (entry.patches.some((patch) => undoPatchChangesChainBreak(project, patch))) fail('undo_conflict');
  if (entry.patches.some((patch) => undoPatchClearsBoardStyleWithHistory(project, patch))) fail('undo_conflict');
  if (entry.label === 'promote_board_panel') {
    const promotionPatch = entry.patches.length === 1 ? entry.patches[0] : undefined;
    const segmentShotIds =
      promotionPatch?.kind === 'shot_fields' ? segmentShotIdsFromHead(project, promotionPatch.shotId) : null;
    if (segmentShotIds === null || deriveStudioInboundShotReferencesV2(project, segmentShotIds).length > 0) {
      fail('undo_conflict');
    }
  }

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
    } else if (patch.kind === 'reference_catalog') {
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
  if (
    operations.some((operation) => (operation as StudioMutationOperationV2).kind === 'promote_board_panel') &&
    operations.length !== 1
  ) {
    fail('invalid_operation');
  }
  if (draft.undoHistory.some((entry) => entry.id === reducerContext.mutationId)) fail('identity_collision');
  const knownBeatIds = new Set(Object.keys(draft.beats));
  const knownShotIds = new Set(Object.keys(draft.shots));
  const createdBeatIds: string[] = [];
  const createdShotIds: string[] = [];
  const coverageResults: StudioCoverageApplyResult[] = [];
  const tracker = createUndoTracker();

  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const rawOperation = operations[operationIndex];
    assertOperationShape(rawOperation);
    const operation = rawOperation;

    // Keep the long reducer switch aligned with its established shape while adding typed operation context.
    // oxfmt-ignore
    try {
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
        const boardStyleChanged = Object.hasOwn(changes, 'boardStyle') && changes.boardStyle !== draft.boardStyle;
        if ((aspectRatioChanged || resolutionChanged) && hasBoundNonterminalJob(draft)) {
          fail('dependency_blocked');
        }
        if (boardStyleChanged && hasBoundNonterminalJob(draft, (job) => job.purpose === 'board_still')) {
          fail('dependency_blocked');
        }
        if (boardStyleChanged && changes.boardStyle === null && hasBoardHistory(draft)) {
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

      case 'set_reference_plan': {
        if (
          draft.referencePlanStatus !== 'unplanned' ||
          draft.referenceOrder.length !== 0 ||
          Object.keys(draft.references).length !== 0
        ) {
          fail('invalid_operation');
        }
        const references: StudioProjectV2['references'] = {};
        const referenceIds = operation.references.map((_reference, referenceIndex) =>
          createStudioProjectReferenceIdV2(draft.id, reducerContext.mutationId, operationIndex, referenceIndex)
        );
        for (let referenceIndex = 0; referenceIndex < operation.references.length; referenceIndex += 1) {
          const reference = operation.references[referenceIndex]!;
          const referenceId = referenceIds[referenceIndex]!;
          defineOwn(references, referenceId, {
            ...reference,
            id: referenceId,
            approvedAssetId: null,
            supersededAssetIds: [],
            jobIds: [],
            createdAt: reducerContext.capturedAt,
            updatedAt: reducerContext.capturedAt,
          });
        }
        touchReferenceCatalog(tracker, draft);
        draft.referencePlanStatus = 'planned';
        draft.referenceOrder = referenceIds;
        draft.references = references;
        break;
      }

      case 'amend_reference_plan': {
        if (
          draft.referencePlanStatus !== 'planned' ||
          draft.referenceOrder.length + operation.additions.length > STUDIO_MAX_PROJECT_REFERENCES
        ) {
          fail('invalid_operation');
        }
        const existingDrafts = draft.referenceOrder.map((referenceId) => {
          const reference = ownValue(draft.references, referenceId);
          if (reference === undefined) fail('invalid_operation');
          return { kind: reference.kind, label: reference.label, prompt: reference.prompt };
        });
        if (!isProjectReferenceDraftArray([...existingDrafts, ...operation.additions])) {
          fail('invalid_operation');
        }
        const referenceIds = operation.additions.map((_reference, referenceIndex) =>
          createStudioProjectReferenceIdV2(draft.id, reducerContext.mutationId, operationIndex, referenceIndex)
        );
        if (
          referenceIds.some(
            (referenceId) =>
              ownValue(draft.references, referenceId) !== undefined || draft.referenceOrder.includes(referenceId)
          )
        ) {
          fail('invalid_operation');
        }
        touchReferenceCatalog(tracker, draft);
        for (let referenceIndex = 0; referenceIndex < operation.additions.length; referenceIndex += 1) {
          const reference = operation.additions[referenceIndex]!;
          const referenceId = referenceIds[referenceIndex]!;
          defineOwn(draft.references, referenceId, {
            ...reference,
            id: referenceId,
            approvedAssetId: null,
            supersededAssetIds: [],
            jobIds: [],
            createdAt: reducerContext.capturedAt,
            updatedAt: reducerContext.capturedAt,
          });
        }
        draft.referenceOrder.push(...referenceIds);
        break;
      }

      case 'set_reference_prompt': {
        const reference = ownValue(draft.references, operation.referenceId);
        if (
          draft.referencePlanStatus !== 'planned' ||
          reference === undefined ||
          reference.prompt === operation.prompt
        ) {
          fail('invalid_operation');
        }
        if (hasBoundNonterminalJob(draft, (job) => jobTargetsReference(job, reference.id))) {
          fail('dependency_blocked');
        }
        touchReferenceCatalog(tracker, draft);
        defineOwn(draft.references, reference.id, {
          ...reference,
          prompt: operation.prompt,
          updatedAt: reducerContext.capturedAt,
        });
        break;
      }

      case 'set_reference_label': {
        const reference = ownValue(draft.references, operation.referenceId);
        if (draft.referencePlanStatus !== 'planned' || reference === undefined || reference.label === operation.label) {
          fail('invalid_operation');
        }
        const candidateDrafts = draft.referenceOrder.map((referenceId) => {
          const candidate = ownValue(draft.references, referenceId);
          if (candidate === undefined) fail('invalid_operation');
          return {
            kind: candidate.kind,
            label: candidate.id === reference.id ? operation.label : candidate.label,
            prompt: candidate.prompt,
          };
        });
        if (!isProjectReferenceDraftArray(candidateDrafts)) fail('invalid_operation');
        if (hasBoundNonterminalJob(draft, (job) => jobTargetsReference(job, reference.id))) {
          fail('dependency_blocked');
        }
        touchReferenceCatalog(tracker, draft);
        defineOwn(draft.references, reference.id, {
          ...reference,
          label: operation.label,
          updatedAt: reducerContext.capturedAt,
        });
        break;
      }

      case 'select_reference_image': {
        const reference = ownValue(draft.references, operation.referenceId);
        if (
          draft.referencePlanStatus !== 'planned' ||
          reference === undefined ||
          reference.approvedAssetId === operation.assetId ||
          !reference.supersededAssetIds.includes(operation.assetId) ||
          !hasCanonicalProjectReferenceAsset(draft, reference.id, operation.assetId)
        ) {
          fail('invalid_operation');
        }
        if (hasBoundNonterminalJob(draft, (job) => jobTargetsReference(job, reference.id))) {
          fail('dependency_blocked');
        }
        const supersededAssetIds = reference.supersededAssetIds.filter((assetId) => assetId !== operation.assetId);
        if (reference.approvedAssetId !== null) supersededAssetIds.push(reference.approvedAssetId);
        touchReferenceCatalog(tracker, draft);
        defineOwn(draft.references, reference.id, {
          ...reference,
          approvedAssetId: operation.assetId,
          supersededAssetIds,
          updatedAt: reducerContext.capturedAt,
        });
        break;
      }

      case 'remove_reference_image': {
        const reference = ownValue(draft.references, operation.referenceId);
        if (
          draft.referencePlanStatus !== 'planned' ||
          reference === undefined ||
          reference.approvedAssetId !== operation.assetId ||
          !hasCanonicalProjectReferenceAsset(draft, reference.id, operation.assetId)
        ) {
          fail('invalid_operation');
        }
        if (
          Object.values(draft.jobs).some((job) => {
            const usesAsset = jobUsesProjectReferenceAsset(job, reference.id, operation.assetId);
            return (
              (NONTERMINAL_JOB_STATUSES.has(job.status) && (jobTargetsReference(job, reference.id) || usesAsset)) ||
              (job.status === 'failed' &&
                job.error?.code === 'download_failed' &&
                job.providerJobId !== null &&
                usesAsset)
            );
          })
        ) {
          fail('dependency_blocked');
        }

        const visibleAssetIds = [...new Set([operation.assetId, ...reference.supersededAssetIds])].toSorted(
          (left, right) => {
            const leftAsset = ownValue(draft.assets, left);
            const rightAsset = ownValue(draft.assets, right);
            const byCreatedAt = (leftAsset?.createdAt ?? '').localeCompare(rightAsset?.createdAt ?? '');
            return byCreatedAt === 0 ? left.localeCompare(right) : byCreatedAt;
          }
        );
        const removedIndex = visibleAssetIds.indexOf(operation.assetId);
        if (removedIndex < 0) fail('invalid_operation');
        const remainingAssetIds = visibleAssetIds.filter((assetId) => assetId !== operation.assetId);
        const approvedAssetId =
          remainingAssetIds.length === 0
            ? null
            : remainingAssetIds[Math.min(Math.max(0, removedIndex - 1), remainingAssetIds.length - 1)]!;

        touchReferenceCatalog(tracker, draft);
        defineOwn(draft.references, reference.id, {
          ...reference,
          approvedAssetId,
          supersededAssetIds:
            approvedAssetId === null ? [] : remainingAssetIds.filter((assetId) => assetId !== approvedAssetId),
          updatedAt: reducerContext.capturedAt,
        });
        break;
      }

      case 'set_shot_reference_binding': {
        const shot = ownValue(draft.shots, operation.shotId);
        // An empty decision references nothing, so it has nothing to validate against the plan. A
        // film with no named characters and no recurring places never leaves `unplanned`, and
        // requiring a plan there left every Shot permanently `unassigned` and unrenderable.
        const bindsNothing = operation.characterReferenceIds.length === 0 && operation.backgroundReferenceId === null;
        if (
          (draft.referencePlanStatus !== 'planned' && !bindsNothing) ||
          shot === undefined ||
          findActiveShotOwner(draft, shot.id) === undefined
        ) {
          fail('invalid_operation');
        }
        for (const referenceId of operation.characterReferenceIds) {
          const reference = ownValue(draft.references, referenceId);
          if (reference?.kind !== 'character' || !hasCanonicalApprovedProjectReferenceAsset(draft, referenceId)) {
            fail('invalid_operation');
          }
        }
        if (operation.backgroundReferenceId !== null) {
          const background = ownValue(draft.references, operation.backgroundReferenceId);
          if (
            background?.kind !== 'background' ||
            !hasCanonicalApprovedProjectReferenceAsset(draft, operation.backgroundReferenceId)
          ) {
            fail('invalid_operation');
          }
        }
        const nextBinding: StudioShot['referenceBinding'] = {
          status: 'ready',
          characterReferenceIds: [...operation.characterReferenceIds],
          backgroundReferenceId: operation.backgroundReferenceId,
        };
        if (sameValue(shot.referenceBinding, nextBinding)) fail('invalid_operation');
        touchShot(tracker, draft, shot.id);
        defineOwn(draft.shots, shot.id, { ...shot, referenceBinding: nextBinding });
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
          story: operation.beat.story,
          targetSeconds: operation.beat.targetSeconds,
          shotOrder: [],
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
          story: operation.beat.story,
          targetSeconds: operation.beat.targetSeconds,
          shotOrder: [],
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
        const storyChanged = Object.hasOwn(operation.changes, 'story') && operation.changes.story !== beat.story;
        if (
          storyChanged &&
          hasBoundNonterminalJob(draft, (job) => beat.shotOrder.some((id) => jobTargetsShot(job, id)))
        ) {
          fail('dependency_blocked');
        }
        touchBeat(tracker, draft, beat.id);
        defineOwn(draft.beats, beat.id, {
          ...beat,
          ...operation.changes,
          id: beat.id,
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
          hasBoundNonterminalJob(draft, (job) => jobTargetsShot(job, operation.beforeShotId))
        ) {
          fail('dependency_blocked');
        }

        touchBeat(tracker, draft, beat.id);
        touchShot(tracker, draft, operation.shotId);
        const shot: StudioShot = {
          id: operation.shotId,
          ...operation.shot,
          trimInSeconds: null,
          trimOutSeconds: null,
          chainBreak: 'none',
          referenceBinding: {
            status: 'unassigned',
            characterReferenceIds: [],
            backgroundReferenceId: null,
          },
          seedStillId: null,
          dismissedSeedStillIds: [],
          boardAssetId: null,
          supersededBoardAssetIds: [],
          videoAssetId: null,
          supersededVideoAssetIds: [],
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
        const scriptChanged =
          Object.hasOwn(operation.changes, 'shootingScript') &&
          operation.changes.shootingScript !== current.shootingScript;
        const durationChanged =
          Object.hasOwn(operation.changes, 'durationSeconds') &&
          operation.changes.durationSeconds !== current.durationSeconds;
        if (
          (scriptChanged && hasBoundNonterminalJob(draft, (job) => jobTargetsShot(job, current.id))) ||
          (durationChanged && hasBoundNonterminalJob(draft, (job) => jobTargetsShot(job, current.id)))
        ) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, current.id);
        const next: StudioShot = {
          ...current,
          ...operation.changes,
          id: current.id,
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
        if (hasBoundNonterminalJob(draft, (job) => jobTargetsShot(job, operation.beforeShotId))) {
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
        if (hasBoundNonterminalJob(draft, (job) => beat.shotOrder.some((shotId) => jobTargetsShot(job, shotId)))) {
          fail('dependency_blocked');
        }
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
          const reasons = deriveStudioFixedShotReasonsV2(draft, shot);
          return reasons.length === 0 ? [] : [{ shotId, reasons }];
        });
        if (!sameValue(operation.fixedShots, expectedFixed)) {
          const expectedById = new Map(expectedFixed.map((fixed) => [fixed.shotId, fixed]));
          const suppliedById = new Map(operation.fixedShots.map((fixed) => [fixed.shotId, fixed]));
          const mismatchedById = new Map<string, StudioMutationFailureSubjectV2>();
          const addMismatch = (shotId: string, reasons: StudioFixedShotReasonV2[]): void => {
            if (!mismatchedById.has(shotId)) {
              mismatchedById.set(shotId, { shotId, fixedReasons: [...reasons] });
            }
          };
          for (const expected of expectedFixed) {
            const supplied = suppliedById.get(expected.shotId);
            if (supplied === undefined || !sameValue(supplied.reasons, expected.reasons)) {
              addMismatch(expected.shotId, expected.reasons);
            }
          }
          for (const supplied of operation.fixedShots) {
            if (expectedById.has(supplied.shotId)) continue;
            const shot = ownValue(draft.shots, supplied.shotId);
            addMismatch(supplied.shotId, shot === undefined ? [] : deriveStudioFixedShotReasonsV2(draft, shot));
          }
          if (mismatchedById.size === 0) {
            expectedFixed.forEach((fixed, index) => {
              if (operation.fixedShots[index]?.shotId !== fixed.shotId) {
                addMismatch(fixed.shotId, fixed.reasons);
              }
            });
          }
          fail('dependency_blocked', [...mismatchedById.values()]);
        }

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
          const fixed = expectedFixed.find((candidate) => candidate.shotId === proposed.shotId);
          if (fixed !== undefined) {
            const currentBoundary = currentBoundaryById.get(proposed.shotId);
            if (
              currentBoundary === undefined ||
              currentBoundary.startSeconds !== proposedCursor ||
              currentBoundary.endSeconds !== proposedEnd ||
              existing === undefined ||
              existing.shootingScript !== proposed.shootingScript ||
              existing.durationSeconds !== proposed.durationSeconds ||
              existing.chainBreak !== proposed.chainBreak
            ) {
              fail('dependency_blocked', [{ shotId: fixed.shotId, fixedReasons: [...fixed.reasons] }]);
            }
          }
          proposedCursor = proposedEnd;
        }
        const omittedFixed = expectedFixed.filter((fixed) => !proposedIds.includes(fixed.shotId));
        if (omittedFixed.length > 0) {
          fail(
            'dependency_blocked',
            omittedFixed.map((fixed) => ({ shotId: fixed.shotId, fixedReasons: [...fixed.reasons] }))
          );
        }

        touchBeat(tracker, draft, beat.id);
        for (const shotId of removedIds) {
          const shot = ownValue(draft.shots, shotId);
          if (shot === undefined) fail('dependency_blocked', [{ shotId, fixedReasons: [] }]);
          if (shotHasDestructiveDependency(draft, shot)) {
            fail('dependency_blocked', [
              { shotId: shot.id, fixedReasons: deriveStudioFixedShotReasonsV2(draft, shot) },
            ]);
          }
          touchShot(tracker, draft, shotId);
          delete draft.shots[shotId];
        }

        for (const proposed of operation.shots) {
          const existing = ownValue(draft.shots, proposed.shotId);
          if (existing === undefined) {
            touchShot(tracker, draft, proposed.shotId);
            defineOwn(draft.shots, proposed.shotId, {
              id: proposed.shotId,
              shootingScript: proposed.shootingScript,
              durationSeconds: proposed.durationSeconds,
              trimInSeconds: null,
              trimOutSeconds: null,
              chainBreak: proposed.chainBreak,
              referenceBinding: {
                status: 'unassigned',
                characterReferenceIds: [],
                backgroundReferenceId: null,
              },
              seedStillId: null,
              dismissedSeedStillIds: [],
              boardAssetId: null,
              supersededBoardAssetIds: [],
              videoAssetId: null,
              supersededVideoAssetIds: [],
              assetIds: [],
              jobIds: [],
            });
            knownShotIds.add(proposed.shotId);
            createdShotIds.push(proposed.shotId);
            continue;
          }
          if (expectedFixed.some((fixed) => fixed.shotId === existing.id)) continue;
          if (
            existing.shootingScript === proposed.shootingScript &&
            existing.durationSeconds === proposed.durationSeconds &&
            existing.chainBreak === proposed.chainBreak
          ) {
            continue;
          }
          touchShot(tracker, draft, existing.id);
          defineOwn(draft.shots, existing.id, {
            ...existing,
            shootingScript: proposed.shootingScript,
            durationSeconds: proposed.durationSeconds,
            chainBreak: proposed.chainBreak,
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
        if (operation.assetId !== null && shot.dismissedSeedStillIds.includes(operation.assetId)) {
          fail('invalid_operation');
        }
        if (shot.seedStillId === operation.assetId) fail('invalid_operation');
        if (!seedMatchesWaitingAuthorizedDependencies(draft, shot.id, operation.assetId)) {
          fail('dependency_blocked');
        }
        if (hasBoundNonterminalJob(draft, (job) => jobTargetsShot(job, shot.id))) fail('dependency_blocked');
        touchShot(tracker, draft, shot.id);
        defineOwn(draft.shots, shot.id, { ...shot, seedStillId: operation.assetId });
        break;
      }

      case 'dismiss_seed_still': {
        const shot = ownValue(draft.shots, operation.shotId);
        const ordinary = shot === undefined ? null : ownValue(draft.assets, operation.assetId);
        const board =
          shot === undefined
            ? null
            : (resolveStudioCanonicalBoardAssetV2(draft, shot, operation.assetId)?.asset ?? null);
        const asset =
          ordinary?.projectId === draft.id &&
          ordinary.shotId === operation.shotId &&
          ordinary.mediaKind === 'image' &&
          (ordinary.managedAsset.collection === 'assets' || ordinary.managedAsset.collection === 'imports') &&
          shot?.assetIds.includes(ordinary.id)
            ? ordinary
            : board;
        if (
          shot === undefined ||
          asset === null ||
          findActiveShotOwner(draft, shot.id) === undefined ||
          shot.dismissedSeedStillIds.includes(asset.id)
        ) {
          fail('invalid_operation');
        }
        if (
          hasBoundNonterminalJob(
            draft,
            (job) => jobTargetsShot(job, shot.id) || studioJobReferencesShotV2(draft, job, shot.id)
          )
        ) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, shot.id);
        defineOwn(draft.shots, shot.id, {
          ...shot,
          seedStillId: shot.seedStillId === asset.id ? null : shot.seedStillId,
          dismissedSeedStillIds: [...shot.dismissedSeedStillIds, asset.id],
        });
        break;
      }

      case 'promote_board_panel': {
        const authority = resolveStudioCurrentBoardPanelAuthorityV2(draft, operation.shotId, operation.boardAssetId);
        if (
          authority === null ||
          (authority.shotIndex !== 0 && authority.shot.chainBreak !== 'hard_cut') ||
          authority.shot.dismissedSeedStillIds.includes(operation.boardAssetId) ||
          authority.shot.seedStillId === operation.boardAssetId
        ) {
          fail('invalid_operation');
        }
        const segmentShotIds = segmentShotIdsFromHead(draft, authority.shot.id);
        if (segmentShotIds === null) fail('invalid_operation');
        if (deriveStudioInboundShotReferencesV2(draft, segmentShotIds).length > 0) {
          fail('dependency_blocked');
        }
        touchShot(tracker, draft, authority.shot.id);
        defineOwn(draft.shots, authority.shot.id, {
          ...authority.shot,
          seedStillId: operation.boardAssetId,
        });
        break;
      }

      case 'trim_shot': {
        const shot = ownValue(draft.shots, operation.shotId);
        if (shot === undefined || findActiveShotOwner(draft, shot.id) === undefined) fail('invalid_operation');
        if (shot.videoAssetId === null) fail('invalid_operation');
        const [, selected] = assertCanonicalVideoTake(draft, shot.id, shot.videoAssetId);
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
          hasBoundNonterminalJob(draft, (job) => studioJobReferencesShotV2(draft, job, shot.id))
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

      case 'set_routes': {
        if (draft.imageRouteId === operation.imageRouteId && draft.videoRouteId === operation.videoRouteId) {
          fail('invalid_operation');
        }
        if (
          draft.imageRouteId !== operation.imageRouteId &&
          hasBoundNonterminalJob(
            draft,
            (job) => job.purpose === 'seed_still' || job.purpose === 'board_still' || job.purpose === 'reference_image'
          )
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

      case 'set_bed': {
        if (operation.assetId !== null) {
          const asset = ownValue(draft.assets, operation.assetId);
          if (
            asset === undefined ||
            asset.projectId !== draft.id ||
            asset.shotId !== null ||
            asset.mediaKind !== 'audio' ||
            asset.managedAsset.collection !== 'imports'
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
    } catch (error) {
      if (error instanceof StudioMutationErrorV2 && error.operationIndex === null) {
        throw new StudioMutationErrorV2(error.reasonCode, operationIndex, error.subjects);
      }
      throw error;
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
