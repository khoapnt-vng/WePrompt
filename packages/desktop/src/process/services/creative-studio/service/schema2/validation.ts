/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';
import {
  isValidProviderJobId,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
  STUDIO_BOARD_STYLES_V2,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MAX_UNDO_ENTRIES,
  STUDIO_MAX_UNDO_LABEL_LENGTH,
  STUDIO_MAX_UNDO_PATCHES_PER_ENTRY,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioBeat,
  type StudioBinItem,
  type StudioGenerationCompositionInputSnapshotV2,
  type StudioGenerationCompositionV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioJobV2,
  type StudioJobPurpose,
  type StudioProjectReferenceV2,
  type StudioProjectV2,
  type StudioProviderAdapterId,
  type StudioProviderRef,
  type StudioQuotedGeneration,
  type StudioShot,
  type StudioSubmissionQuote,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_MANAGED_ASSET_COLLECTIONS_V2,
  isCanonicalStudioBedAudioAssetV2,
  isStudioReferenceImageMimeType,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import { STUDIO_RULE_LIMITS, hasRuleToken } from '@/common/types/project/creativeStudioRules';
import {
  calculateStudioQuoteTotals,
  calculateStudioQuotedGenerationAmounts,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
  recomposeStudioGenerationV2,
  studioGenerationCompositionMatchesAuthorityV2,
  studioGenerationCompositionsEqualV2,
  studioGenerationTargetKey,
  STUDIO_BOARD_REQUEST_DURATION_SECONDS,
} from './generation';
import { studioBoardAuthorizationScopeIsValidV2 } from './pricing/authorization';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const BOARD_STYLES: ReadonlySet<string> = new Set(STUDIO_BOARD_STYLES_V2);
const MEDIA_KINDS = new Set(['image', 'video', 'audio']);
const ADAPTER_IDS: ReadonlySet<StudioProviderAdapterId> = new Set([
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
]);
const JOB_STATUSES = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
  'succeeded',
  'failed',
  'cancelled',
  'waiting_for_conditioning',
]);
const JOB_ERROR_CODES = new Set([
  'invalid_request',
  'content_rejected',
  'auth',
  'quota',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'poll_deadline',
  'no_output',
  'seed_still_variation_grid',
  'submission_unknown',
  'download_failed',
  'unsupported',
  'unknown',
  'dependency_failed',
]);
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const PURPOSES: ReadonlySet<string> = new Set<StudioJobPurpose>([
  'seed_still',
  'board_still',
  'video_take',
  'reference_image',
]);
const RATE_UNITS = new Set(['generation', 'second']);
const FRAME_STATUSES = new Set(['pending', 'extracting', 'ready', 'failed']);
const FRAME_ERROR_CODES = new Set(['decode_failed', 'source_missing', 'storage_error']);
const FIXED_SHOT_REASONS = [
  'owned_asset',
  'owned_job',
  'video_asset',
  'seed_still',
  'conditioning_frame',
  'conditioning_input',
  'shooting_script',
] as const;

const PROJECT_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'revision',
  'id',
  'name',
  'brief',
  'rules',
  'aspectRatio',
  'targetDurationSeconds',
  'resolution',
  'boardStyle',
  'beatOrder',
  'beats',
  'shots',
  'referencePlanStatus',
  'referenceOrder',
  'references',
  'bin',
  'bedAssetId',
  'spendPolicy',
  'spendAuthorizations',
  'frameExtractions',
  'undoHistory',
  'imageRouteId',
  'videoRouteId',
  'assets',
  'jobs',
  'createdAt',
  'updatedAt',
]);
const PROJECT_OPTIONAL_KEYS = new Set(['forgeProjectId', 'briefConversationId']);
const BEAT_KEYS = new Set(['id', 'title', 'story', 'targetSeconds', 'shotOrder']);
const SHOT_KEYS = new Set([
  'id',
  'shootingScript',
  'durationSeconds',
  'trimInSeconds',
  'trimOutSeconds',
  'chainBreak',
  'referenceBinding',
  'seedStillId',
  'dismissedSeedStillIds',
  'boardAssetId',
  'supersededBoardAssetIds',
  'videoAssetId',
  'supersededVideoAssetIds',
  'assetIds',
  'jobIds',
]);
const ASSET_REQUIRED_KEYS = new Set([
  'id',
  'projectId',
  'shotId',
  'mediaKind',
  'mimeType',
  'managedAsset',
  'byteSize',
  'sha256',
  'projectReferenceId',
  'generationReferenceAssetIds',
  'producerJobId',
  'compositionDigest',
  'createdAt',
]);
const ASSET_OPTIONAL_KEYS = new Set(['width', 'height', 'durationSeconds']);
const MANAGED_ASSET_KEYS = new Set(['collection', 'fileName']);
const JOB_REQUIRED_KEYS = new Set([
  'id',
  'projectId',
  'target',
  'status',
  'provider',
  'idempotencyKey',
  'providerJobId',
  'cancellationPolicy',
  'outputAssetIds',
  'purpose',
  'authorizationId',
  'authorizationItemId',
  'composition',
  'requestPlan',
  'requestSnapshot',
  'spendReceipt',
  'outputAssetIdsByRole',
  'error',
  'retryOfJobId',
  'retryReason',
  'duplicateChargeAcknowledged',
  'duplicateChargeAcknowledgedAt',
  'createdAt',
  'updatedAt',
]);
const JOB_OPTIONAL_KEYS = new Set(['remoteStartedAt', 'progress']);
const PROVIDER_KEYS = new Set(['providerId', 'adapterId', 'model']);
const JOB_ERROR_KEYS = new Set(['code', 'messageKey']);
const OUTPUT_ROLE_KEYS = new Set(['primary', 'poster']);
const RULE_KEYS = new Set(['id', 'scope', 'text', 'predicate', 'createdAt']);
const RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const PROJECT_REFERENCE_KEYS = new Set([
  'id',
  'kind',
  'label',
  'prompt',
  'approvedAssetId',
  'supersededAssetIds',
  'jobIds',
  'createdAt',
  'updatedAt',
]);
const BIN_BEAT_KEYS = new Set(['kind', 'beatId', 'reason']);
const BIN_SHOT_KEYS = new Set(['kind', 'beatId', 'shotId', 'reason']);
const SPEND_POLICY_KEYS = new Set(['currency', 'maxPerBatchMinorUnits']);
const AUTHORIZATION_KEYS = new Set([
  'id',
  'projectId',
  'projectRevision',
  'originReferenceHandoffId',
  'rateCardDigest',
  'currency',
  'baseItems',
  'cascadeItems',
  'lowerMinorUnits',
  'upperMinorUnits',
  'expiresAt',
  'confirmedAt',
  'providerBindings',
  'idempotencyKeys',
]);
const QUOTED_ITEM_REQUIRED_KEYS = new Set([
  'id',
  'target',
  'purpose',
  'routeId',
  'generationCount',
  'requestPlan',
  'rateUnit',
  'rateMinorUnits',
]);
const PROVIDER_BINDING_KEYS = new Set(['itemId', 'provider']);
const IDEMPOTENCY_ENTRY_KEYS = new Set(['itemId', 'key']);
const REQUEST_PLAN_RESOLVED_KEYS = new Set(['kind', 'snapshot']);
const REQUEST_PLAN_DEFERRED_KEYS = new Set(['kind', 'template', 'dependency']);
const REQUEST_SNAPSHOT_KEYS = new Set([
  'composition',
  'aspectRatio',
  'resolution',
  'durationSeconds',
  'referenceInputs',
  'conditioningInput',
]);
const REQUEST_TEMPLATE_KEYS = new Set([
  'composition',
  'aspectRatio',
  'resolution',
  'durationSeconds',
  'referenceInputs',
]);
const REFERENCE_INPUT_KEYS = new Set(['referenceId', 'kind', 'assetId', 'sha256']);
const GENERATION_TARGET_SHOT_KEYS = new Set(['kind', 'shotId']);
const GENERATION_TARGET_REFERENCE_KEYS = new Set(['kind', 'referenceId']);
const COMPOSITION_KEYS = new Set(['inputs', 'prompt']);
const COMPOSITION_INPUT_KEYS = new Set([
  'schemaVersion',
  'projectRevision',
  'brief',
  'rules',
  'source',
  'purpose',
  'referenceInputs',
  'aspectRatio',
  'resolution',
  'route',
  'boardStyle',
  'instructionProfile',
]);
const COMPOSITION_SHOT_SOURCE_KEYS = new Set(['kind', 'beatId', 'story', 'shotId', 'shootingScript']);
const COMPOSITION_REFERENCE_SOURCE_KEYS = new Set(['kind', 'referenceId', 'referenceKind', 'prompt']);
const REFERENCE_BINDING_KEYS = new Set(['status', 'characterReferenceIds', 'backgroundReferenceId']);
const CONDITIONING_SEED_KEYS = new Set(['kind', 'assetId']);
const CONDITIONING_PREDECESSOR_KEYS = new Set([
  'kind',
  'predecessorShotId',
  'takeAssetId',
  'frameAssetId',
  'endpointSeconds',
]);
const DEPENDENCY_SEED_KEYS = new Set(['kind', 'upstreamItemId', 'shotId']);
const DEPENDENCY_PREDECESSOR_KEYS = new Set(['kind', 'upstreamItemId', 'predecessorShotId']);
const DEPENDENCY_EXISTING_PREDECESSOR_KEYS = new Set(['kind', 'predecessorShotId', 'takeAssetId', 'endpointSeconds']);
const FRAME_EXTRACTION_KEYS = new Set([
  'id',
  'shotId',
  'videoAssetId',
  'endpointSeconds',
  'frameAssetId',
  'status',
  'errorCode',
]);
const RECEIPT_KEYS = new Set([
  'authorizationId',
  'itemId',
  'jobId',
  'purpose',
  'routeId',
  'currency',
  'rateUnit',
  'rateMinorUnits',
  'durationSeconds',
  'generationCount',
  'totalMinorUnits',
]);
const UNDO_ENTRY_KEYS = new Set(['id', 'sourceRevision', 'label', 'patches']);
const PROJECT_PATCH_KEYS = new Set(['kind', 'before', 'afterDigest']);
const REFERENCE_CATALOG_PATCH_BEFORE_KEYS = new Set(['referencePlanStatus', 'referenceOrder', 'references']);
const PROJECT_PATCH_BEFORE_KEYS = new Set([
  'name',
  'aspectRatio',
  'resolution',
  'targetDurationSeconds',
  'boardStyle',
  'brief',
  'rules',
  'beatOrder',
  'imageRouteId',
  'videoRouteId',
  'spendPolicy',
  'bedAssetId',
]);
const BEAT_PATCH_KEYS = new Set(['kind', 'beatId', 'before', 'afterDigest']);
const SHOT_PATCH_KEYS = new Set(['kind', 'shotId', 'before', 'beforeBeatId', 'beforeIndex', 'afterDigest']);
const BIN_PATCH_KEYS = new Set(['kind', 'before', 'afterDigest']);
const SHOT_BEFORE_KEYS = new Set([...SHOT_KEYS].filter((key) => key !== 'assetIds' && key !== 'jobIds'));
const PROPOSED_SHOT_KEYS = new Set(['shotId', 'shootingScript', 'durationSeconds', 'chainBreak']);
const FIXED_SHOT_REVIEW_KEYS = new Set(['shotId', 'reasons']);

const INVALID_DATA_SNAPSHOT = Symbol('invalid-data-snapshot');
type DataPropertySnapshot = {
  key: PropertyKey;
  value: unknown;
  enumerable: boolean;
};
type DataNodeSnapshot = {
  source: object;
  target: object;
  properties: DataPropertySnapshot[];
};

const prototypeChainHasNoSerializationHook = (prototype: object | null): boolean => {
  let current = prototype;
  while (current !== null) {
    if (nodeTypes.isProxy(current)) return false;

    let toJsonDescriptor: PropertyDescriptor | undefined;
    let next: object | null;
    try {
      toJsonDescriptor = Reflect.getOwnPropertyDescriptor(current, 'toJSON');
      next = Reflect.getPrototypeOf(current);
    } catch {
      return false;
    }
    if (toJsonDescriptor !== undefined) return false;
    current = next;
  }
  return true;
};

const captureDataNode = (source: object): DataNodeSnapshot | undefined => {
  if (nodeTypes.isProxy(source)) return undefined;

  let isArray: boolean;
  let keys: PropertyKey[];
  let prototype: object | null;
  try {
    isArray = Array.isArray(source);
    keys = Reflect.ownKeys(source);
    prototype = Reflect.getPrototypeOf(source);
  } catch {
    // Revoked and hostile proxies are invalid persisted data.
    return undefined;
  }

  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  if (!prototypeChainHasNoSerializationHook(prototype)) return undefined;

  const properties: DataPropertySnapshot[] = [];
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(source, key);
    } catch {
      // Keep input-originating descriptor traps outside the validator proper.
      return undefined;
    }
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
    if (typeof key !== 'string' || key === 'toJSON') return undefined;
    if ((!isArray || key !== 'length') && descriptor.enumerable !== true) return undefined;
    properties.push({ key, value: descriptor.value, enumerable: descriptor.enumerable === true });
  }

  if (!isArray) {
    return { source, target: Object.create(null) as object, properties };
  }

  const length = properties.find(({ key }) => key === 'length')?.value;
  if (!Number.isInteger(length) || (length as number) < 0 || (length as number) > 0xffff_ffff) return undefined;
  const target: unknown[] = [];
  target.length = length as number;
  return { source, target, properties };
};

/**
 * Takes a getter-free, own-data-property snapshot before semantic validation.
 *
 * The catches are deliberately limited to reflection operations controlled by the input. Validation
 * bugs still escape instead of being converted into corrupt-data results.
 */
const snapshotOwnDataGraph = (value: unknown): unknown | typeof INVALID_DATA_SNAPSHOT => {
  if (typeof value !== 'object' || value === null) return value;

  const root = captureDataNode(value);
  if (root === undefined) return INVALID_DATA_SNAPSHOT;
  const snapshots = new Map<object, object>([[root.source, root.target]]);
  const pending = [root];

  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    const node = pending[pendingIndex]!;
    for (const property of node.properties) {
      if (Array.isArray(node.target) && property.key === 'length') continue;

      let propertyValue = property.value;
      if (typeof propertyValue === 'object' && propertyValue !== null) {
        const existing = snapshots.get(propertyValue);
        if (existing !== undefined) {
          propertyValue = existing;
        } else {
          const child = captureDataNode(propertyValue);
          if (child === undefined) return INVALID_DATA_SNAPSHOT;
          snapshots.set(child.source, child.target);
          pending.push(child);
          propertyValue = child.target;
        }
      }

      Object.defineProperty(node.target, property.key, {
        configurable: true,
        enumerable: property.enumerable,
        value: propertyValue,
        writable: true,
      });
    }
  }

  return root.target;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ownValue = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const hasKeys = (
  value: Record<string, unknown>,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string> = new Set()
): boolean => {
  const keys = Object.keys(value);
  return (
    [...required].every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.has(key) || optional.has(key))
  );
};

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isStringWithin = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;
const isNonEmptyStringWithin = (value: unknown, maximum: number): value is string =>
  isStringWithin(value, maximum) && value.trim().length > 0;
const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};
const isSafeFileName = (value: unknown): value is string =>
  isNonEmptyStringWithin(value, 256) &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\');
const isSafeModel = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value !== value.trim()) return false;
  return !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
};

const isDenseArray = (value: unknown, maximumLength = Number.MAX_SAFE_INTEGER): value is unknown[] => {
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

const arrayEvery = <T>(value: readonly T[], predicate: (item: T, index: number) => boolean): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (!predicate(value[index]!, index)) return false;
  }
  return true;
};

const arrayMap = <T, U>(value: readonly T[], mapper: (item: T, index: number) => U): U[] => {
  const result: U[] = [];
  for (let index = 0; index < value.length; index += 1) result.push(mapper(value[index]!, index));
  return result;
};

const isUniqueSafeIdArray = (value: unknown, maximumLength = Number.MAX_SAFE_INTEGER): value is string[] => {
  if (!isDenseArray(value, maximumLength)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (!isSafeId(id) || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
};

const validateRulePredicate = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, RULE_PREDICATE_KEYS) &&
    value.kind === 'forbidden_terms' &&
    isDenseArray(value.terms, STUDIO_RULE_LIMITS.maxTerms) &&
    value.terms.length > 0 &&
    arrayEvery(
      value.terms,
      (term) => isNonEmptyStringWithin(term, STUDIO_RULE_LIMITS.term) && hasRuleToken(term as string)
    ) &&
    new Set(arrayMap(value.terms, (term) => term)).size === value.terms.length);

const validateRules = (value: unknown): boolean =>
  isDenseArray(value, STUDIO_RULE_LIMITS.maxRules) &&
  arrayEvery(
    value,
    (rule) =>
      isRecord(rule) &&
      hasExactKeys(rule, RULE_KEYS) &&
      isSafeId(rule.id) &&
      rule.scope === 'project' &&
      isNonEmptyStringWithin(rule.text, STUDIO_RULE_LIMITS.text) &&
      validateRulePredicate(rule.predicate) &&
      isCanonicalTimestamp(rule.createdAt)
  ) &&
  new Set(arrayMap(value, (rule) => (rule as Record<string, unknown>).id)).size === value.length;

const isLowercaseDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isCurrency = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
const isNullableSafeId = (value: unknown): value is string | null => value === null || isSafeId(value);
const isNullableRouteId = isNullableSafeId;
const isNullableTrim = (value: unknown): value is number | null =>
  value === null || (isFiniteNonNegative(value) && value <= Number.MAX_SAFE_INTEGER);

const compositionDigest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

const validateBeat = (beatId: string, value: unknown): value is StudioBeat =>
  isRecord(value) &&
  hasExactKeys(value, BEAT_KEYS) &&
  value.id === beatId &&
  isSafeId(beatId) &&
  isStringWithin(value.title, 256) &&
  isStringWithin(value.story, STUDIO_MAX_STORY_LENGTH) &&
  (value.targetSeconds === null || isIntegerInRange(value.targetSeconds, 1, 1440)) &&
  isUniqueSafeIdArray(value.shotOrder, STUDIO_MAX_SHOTS_PER_BEAT);

const validateReferenceBinding = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, REFERENCE_BINDING_KEYS) &&
  (value.status === 'unassigned' || value.status === 'ready') &&
  isUniqueSafeIdArray(value.characterReferenceIds, STUDIO_MAX_PROJECT_REFERENCES) &&
  isNullableSafeId(value.backgroundReferenceId) &&
  (value.status === 'ready' ||
    ((value.characterReferenceIds as string[]).length === 0 && value.backgroundReferenceId === null));

const validateShotRecord = (
  shotId: string,
  value: unknown,
  keySet: ReadonlySet<string>,
  requireMembership: boolean
): value is StudioShot =>
  isRecord(value) &&
  hasExactKeys(value, keySet) &&
  value.id === shotId &&
  isSafeId(shotId) &&
  isStringWithin(value.shootingScript, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) &&
  isIntegerInRange(value.durationSeconds, STUDIO_MIN_SHOT_SECONDS, STUDIO_MAX_SHOT_SECONDS) &&
  isNullableTrim(value.trimInSeconds) &&
  isNullableTrim(value.trimOutSeconds) &&
  (value.chainBreak === 'none' || value.chainBreak === 'hard_cut') &&
  validateReferenceBinding(value.referenceBinding) &&
  isNullableSafeId(value.seedStillId) &&
  isUniqueSafeIdArray(value.dismissedSeedStillIds) &&
  isNullableSafeId(value.boardAssetId) &&
  isUniqueSafeIdArray(value.supersededBoardAssetIds) &&
  isNullableSafeId(value.videoAssetId) &&
  isUniqueSafeIdArray(value.supersededVideoAssetIds) &&
  (!requireMembership || (isUniqueSafeIdArray(value.assetIds) && isUniqueSafeIdArray(value.jobIds)));

const validateShot = (shotId: string, value: unknown): value is StudioShot =>
  validateShotRecord(shotId, value, SHOT_KEYS, true);

const validateProjectReference = (referenceId: string, value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PROJECT_REFERENCE_KEYS) &&
  value.id === referenceId &&
  isSafeId(referenceId) &&
  (value.kind === 'character' || value.kind === 'background') &&
  isNonEmptyStringWithin(value.label, STUDIO_MAX_REFERENCE_LABEL_LENGTH) &&
  value.label === (value.label as string).trim() &&
  isNonEmptyStringWithin(value.prompt, STUDIO_MAX_REFERENCE_PROMPT_LENGTH) &&
  value.prompt === (value.prompt as string).trim() &&
  isNullableSafeId(value.approvedAssetId) &&
  isUniqueSafeIdArray(value.supersededAssetIds) &&
  isUniqueSafeIdArray(value.jobIds) &&
  !value.supersededAssetIds.includes(value.approvedAssetId) &&
  isCanonicalTimestamp(value.createdAt) &&
  isCanonicalTimestamp(value.updatedAt) &&
  Date.parse(value.createdAt as string) <= Date.parse(value.updatedAt as string);

const validateProposedShotSnapshot = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSED_SHOT_KEYS) &&
  isSafeId(value.shotId) &&
  isStringWithin(value.shootingScript, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) &&
  isIntegerInRange(value.durationSeconds, STUDIO_MIN_SHOT_SECONDS, STUDIO_MAX_SHOT_SECONDS) &&
  (value.chainBreak === 'none' || value.chainBreak === 'hard_cut');

/** Validates one exact proposed-shot row without trusting prototypes, accessors, or serialization hooks. */
export const validateStudioProposedShotV2 = (value: unknown): boolean => {
  const snapshot = snapshotOwnDataGraph(value);
  return snapshot !== INVALID_DATA_SNAPSHOT && validateProposedShotSnapshot(snapshot);
};

const validateFixedShotReviewSnapshot = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, FIXED_SHOT_REVIEW_KEYS) ||
    !isSafeId(value.shotId) ||
    !isDenseArray(value.reasons, FIXED_SHOT_REASONS.length) ||
    value.reasons.length === 0
  ) {
    return false;
  }
  let priorReasonIndex = -1;
  for (let index = 0; index < value.reasons.length; index += 1) {
    const reasonIndex = FIXED_SHOT_REASONS.indexOf(value.reasons[index] as (typeof FIXED_SHOT_REASONS)[number]);
    if (reasonIndex <= priorReasonIndex) return false;
    priorReasonIndex = reasonIndex;
  }
  return true;
};

/** Validates one exact fixed-shot review row and its canonical reason order. */
export const validateStudioFixedShotReviewV2 = (value: unknown): boolean => {
  const snapshot = snapshotOwnDataGraph(value);
  return snapshot !== INVALID_DATA_SNAPSHOT && validateFixedShotReviewSnapshot(snapshot);
};

/** Validates a dense, unique list of fixed-shot review rows; Task 2 derives authoritative membership. */
export const validateStudioFixedShotReviewsV2 = (value: unknown): boolean => {
  const snapshot = snapshotOwnDataGraph(value);
  if (snapshot === INVALID_DATA_SNAPSHOT || !isDenseArray(snapshot, STUDIO_MAX_SHOTS_PER_PROJECT)) return false;
  const shotIds = new Set<string>();
  return arrayEvery(snapshot, (row) => {
    if (!validateFixedShotReviewSnapshot(row)) return false;
    const shotId = (row as Record<string, unknown>).shotId as string;
    if (shotIds.has(shotId)) return false;
    shotIds.add(shotId);
    return true;
  });
};

const validateAsset = (assetId: string, projectId: string, value: unknown): value is StudioAssetV2 => {
  if (
    !isRecord(value) ||
    !hasKeys(value, ASSET_REQUIRED_KEYS, ASSET_OPTIONAL_KEYS) ||
    !isRecord(value.managedAsset) ||
    !hasExactKeys(value.managedAsset, MANAGED_ASSET_KEYS) ||
    value.id !== assetId ||
    !isSafeId(assetId) ||
    value.projectId !== projectId ||
    (value.shotId !== null && !isSafeId(value.shotId)) ||
    typeof value.mediaKind !== 'string' ||
    !MEDIA_KINDS.has(value.mediaKind) ||
    !isNonEmptyStringWithin(value.mimeType, 256) ||
    typeof value.managedAsset.collection !== 'string' ||
    !STUDIO_MANAGED_ASSET_COLLECTIONS_V2.has(
      value.managedAsset.collection as StudioAssetV2['managedAsset']['collection']
    ) ||
    !isSafeFileName(value.managedAsset.fileName) ||
    !isIntegerInRange(value.byteSize, 0, Number.MAX_SAFE_INTEGER) ||
    !isLowercaseDigest(value.sha256) ||
    (value.width !== undefined && !isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER)) ||
    (value.height !== undefined && !isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER)) ||
    (value.mediaKind === 'image' && value.durationSeconds !== undefined) ||
    (value.mediaKind !== 'image' && !isFinitePositive(value.durationSeconds)) ||
    !isNullableSafeId(value.projectReferenceId) ||
    !isUniqueSafeIdArray(value.generationReferenceAssetIds, STUDIO_MAX_PROJECT_REFERENCES) ||
    !isNullableSafeId(value.producerJobId) ||
    (value.compositionDigest !== null && !isLowercaseDigest(value.compositionDigest)) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return false;
  }
  if (value.shotId === null && value.mediaKind === 'image') {
    if (
      !isSafeId(value.projectReferenceId) ||
      !isStudioReferenceImageMimeType(value.mimeType) ||
      value.managedAsset.collection !== 'assets'
    ) {
      return false;
    }
  } else if (value.shotId === null && value.mediaKind === 'audio') {
    if (!isCanonicalStudioBedAudioAssetV2(value as StudioAssetV2)) return false;
  } else if (value.shotId === null || value.mediaKind === 'audio') {
    return false;
  }
  if (
    value.shotId !== null &&
    value.managedAsset.collection === 'imports' &&
    (value.mediaKind !== 'image' || !isStudioReferenceImageMimeType(value.mimeType))
  ) {
    return false;
  }
  return value.shotId === null || value.projectReferenceId === null;
};

const validateProvider = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PROVIDER_KEYS) &&
  isSafeId(value.providerId) &&
  typeof value.adapterId === 'string' &&
  ADAPTER_IDS.has(value.adapterId as StudioProviderAdapterId) &&
  isSafeModel(value.model);

const providersEqual = (left: unknown, right: unknown): boolean =>
  isRecord(left) &&
  isRecord(right) &&
  left.providerId === right.providerId &&
  left.adapterId === right.adapterId &&
  left.model === right.model;

const validateReferenceInputs = (value: unknown): boolean => {
  if (!isDenseArray(value, STUDIO_MAX_PROJECT_REFERENCES)) return false;
  const referenceIds = new Set<string>();
  const assetIds = new Set<string>();
  return arrayEvery(value, (input) => {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, REFERENCE_INPUT_KEYS) ||
      !isSafeId(input.referenceId) ||
      referenceIds.has(input.referenceId) ||
      (input.kind !== 'character' && input.kind !== 'background') ||
      !isSafeId(input.assetId) ||
      assetIds.has(input.assetId) ||
      !isLowercaseDigest(input.sha256)
    ) {
      return false;
    }
    referenceIds.add(input.referenceId);
    assetIds.add(input.assetId);
    return true;
  });
};

const referencesEqual = (left: unknown, right: unknown): boolean =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every(
    (reference, index) =>
      isRecord(reference) &&
      isRecord(right[index]) &&
      reference.referenceId === right[index].referenceId &&
      reference.kind === right[index].kind &&
      reference.assetId === right[index].assetId &&
      reference.sha256 === right[index].sha256
  );

const validateGenerationTarget = (value: unknown): boolean =>
  isRecord(value) &&
  ((value.kind === 'shot' && hasExactKeys(value, GENERATION_TARGET_SHOT_KEYS) && isSafeId(value.shotId)) ||
    (value.kind === 'reference' &&
      hasExactKeys(value, GENERATION_TARGET_REFERENCE_KEYS) &&
      isSafeId(value.referenceId)));

const validateCompositionSource = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.kind === 'shot') {
    return (
      hasExactKeys(value, COMPOSITION_SHOT_SOURCE_KEYS) &&
      isSafeId(value.beatId) &&
      isStringWithin(value.story, STUDIO_MAX_STORY_LENGTH) &&
      isSafeId(value.shotId) &&
      isStringWithin(value.shootingScript, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH)
    );
  }
  return (
    value.kind === 'project_reference' &&
    hasExactKeys(value, COMPOSITION_REFERENCE_SOURCE_KEYS) &&
    isSafeId(value.referenceId) &&
    (value.referenceKind === 'character' || value.referenceKind === 'background') &&
    isNonEmptyStringWithin(value.prompt, STUDIO_MAX_REFERENCE_PROMPT_LENGTH)
  );
};

const expectedInstructionProfile = (
  route: StudioProviderRef,
  purpose: StudioJobPurpose,
  source: StudioGenerationCompositionInputSnapshotV2['source']
): string => {
  if (purpose === 'board_still') return `${route.adapterId}.board-still.v1`;
  if (purpose === 'seed_still') return `${route.adapterId}.seed-still.v1`;
  if (purpose === 'video_take') return `${route.adapterId}.video-take.v1`;
  return source.kind === 'project_reference' && source.referenceKind === 'character'
    ? `${route.adapterId}.reference-character.v1`
    : `${route.adapterId}.reference-background.v1`;
};

const validateComposition = (value: unknown): boolean => {
  if (!isRecord(value) || !hasExactKeys(value, COMPOSITION_KEYS) || !isRecord(value.inputs)) return false;
  const inputs = value.inputs;
  if (
    !(
      hasExactKeys(inputs, COMPOSITION_INPUT_KEYS) &&
      inputs.schemaVersion === STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION &&
      isIntegerInRange(inputs.projectRevision, 1, Number.MAX_SAFE_INTEGER) &&
      isStringWithin(inputs.brief, 16 * 1024) &&
      validateRules(inputs.rules) &&
      validateCompositionSource(inputs.source) &&
      typeof inputs.purpose === 'string' &&
      PURPOSES.has(inputs.purpose) &&
      validateReferenceInputs(inputs.referenceInputs) &&
      typeof inputs.aspectRatio === 'string' &&
      ASPECT_RATIOS.has(inputs.aspectRatio) &&
      typeof inputs.resolution === 'string' &&
      RESOLUTIONS.has(inputs.resolution) &&
      validateProvider(inputs.route) &&
      (inputs.boardStyle === null || (typeof inputs.boardStyle === 'string' && BOARD_STYLES.has(inputs.boardStyle))) &&
      typeof inputs.instructionProfile === 'string' &&
      isNonEmptyStringWithin(value.prompt, STUDIO_MAX_GENERATION_PROMPT_LENGTH)
    )
  ) {
    return false;
  }
  const source = inputs.source as StudioGenerationCompositionInputSnapshotV2['source'];
  const purpose = inputs.purpose as StudioJobPurpose;
  const route = inputs.route as StudioProviderRef;
  const semanticShapeIsValid =
    (purpose === 'reference_image') === (source.kind === 'project_reference') &&
    (purpose === 'board_still') === (inputs.boardStyle !== null) &&
    (purpose !== 'video_take' || (inputs.referenceInputs as unknown[]).length === 0) &&
    inputs.instructionProfile === expectedInstructionProfile(route, purpose, source);
  if (!semanticShapeIsValid) return false;
  try {
    const composition = value as unknown as StudioGenerationCompositionV2;
    return studioGenerationCompositionsEqualV2(composition, recomposeStudioGenerationV2(composition));
  } catch {
    return false;
  }
};

const validateConditioningInput = (value: unknown): boolean => {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === 'seed_still') {
    return hasExactKeys(value, CONDITIONING_SEED_KEYS) && isSafeId(value.assetId);
  }
  return (
    value.kind === 'predecessor_frame' &&
    hasExactKeys(value, CONDITIONING_PREDECESSOR_KEYS) &&
    isSafeId(value.predecessorShotId) &&
    isSafeId(value.takeAssetId) &&
    isSafeId(value.frameAssetId) &&
    isFinitePositive(value.endpointSeconds)
  );
};

const validateRequestFields = (value: Record<string, unknown>): boolean =>
  validateComposition(value.composition) &&
  typeof value.aspectRatio === 'string' &&
  ASPECT_RATIOS.has(value.aspectRatio) &&
  typeof value.resolution === 'string' &&
  RESOLUTIONS.has(value.resolution) &&
  isIntegerInRange(value.durationSeconds, STUDIO_MIN_SHOT_SECONDS, STUDIO_MAX_SHOT_SECONDS) &&
  validateReferenceInputs(value.referenceInputs) &&
  isRecord(value.composition) &&
  isRecord(value.composition.inputs) &&
  value.composition.inputs.aspectRatio === value.aspectRatio &&
  value.composition.inputs.resolution === value.resolution &&
  referencesEqual(value.composition.inputs.referenceInputs, value.referenceInputs);

const validateRequestSnapshot = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, REQUEST_SNAPSHOT_KEYS) &&
  validateRequestFields(value) &&
  validateConditioningInput(value.conditioningInput);

const validateRequestTemplate = (value: unknown): boolean =>
  isRecord(value) && hasExactKeys(value, REQUEST_TEMPLATE_KEYS) && validateRequestFields(value);

const validateDependency = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.kind === 'authorized_seed') {
    return hasExactKeys(value, DEPENDENCY_SEED_KEYS) && isSafeId(value.upstreamItemId) && isSafeId(value.shotId);
  }
  if (value.kind === 'existing_predecessor') {
    return (
      hasExactKeys(value, DEPENDENCY_EXISTING_PREDECESSOR_KEYS) &&
      isSafeId(value.predecessorShotId) &&
      isSafeId(value.takeAssetId) &&
      isFinitePositive(value.endpointSeconds)
    );
  }
  return (
    value.kind === 'authorized_predecessor' &&
    hasExactKeys(value, DEPENDENCY_PREDECESSOR_KEYS) &&
    isSafeId(value.upstreamItemId) &&
    isSafeId(value.predecessorShotId)
  );
};

const validateRequestPlan = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.kind === 'resolved') {
    return hasExactKeys(value, REQUEST_PLAN_RESOLVED_KEYS) && validateRequestSnapshot(value.snapshot);
  }
  return (
    value.kind === 'after_take_selection' &&
    hasExactKeys(value, REQUEST_PLAN_DEFERRED_KEYS) &&
    validateRequestTemplate(value.template) &&
    validateDependency(value.dependency)
  );
};

const requestPlanCompositionEquals = (plan: unknown, composition: unknown): boolean => {
  if (!isRecord(plan)) return false;
  const request = plan.kind === 'resolved' ? plan.snapshot : plan.template;
  return isRecord(request) && JSON.stringify(request.composition) === JSON.stringify(composition);
};

const conditioningInputsEqual = (left: unknown, right: unknown): boolean => {
  if (left === null || right === null) return left === right;
  if (!isRecord(left) || !isRecord(right) || left.kind !== right.kind) return false;
  if (left.kind === 'seed_still') return left.assetId === right.assetId;
  return (
    left.predecessorShotId === right.predecessorShotId &&
    left.takeAssetId === right.takeAssetId &&
    left.frameAssetId === right.frameAssetId &&
    left.endpointSeconds === right.endpointSeconds
  );
};

const requestNonConditioningFieldsEqual = (left: unknown, right: unknown): boolean =>
  isRecord(left) &&
  isRecord(right) &&
  JSON.stringify(left.composition) === JSON.stringify(right.composition) &&
  left.aspectRatio === right.aspectRatio &&
  left.resolution === right.resolution &&
  left.durationSeconds === right.durationSeconds &&
  referencesEqual(left.referenceInputs, right.referenceInputs);

const requestSnapshotsEqual = (left: unknown, right: unknown): boolean =>
  requestNonConditioningFieldsEqual(left, right) &&
  isRecord(left) &&
  isRecord(right) &&
  conditioningInputsEqual(left.conditioningInput, right.conditioningInput);

const requestPlansEqual = (left: unknown, right: unknown): boolean => {
  if (!isRecord(left) || !isRecord(right) || left.kind !== right.kind) return false;
  if (left.kind === 'resolved') return requestSnapshotsEqual(left.snapshot, right.snapshot);
  if (!requestNonConditioningFieldsEqual(left.template, right.template)) return false;
  const leftDependency = left.dependency;
  const rightDependency = right.dependency;
  if (!isRecord(leftDependency) || !isRecord(rightDependency) || leftDependency.kind !== rightDependency.kind) {
    return false;
  }
  if (leftDependency.kind === 'authorized_seed') {
    return (
      leftDependency.upstreamItemId === rightDependency.upstreamItemId &&
      leftDependency.shotId === rightDependency.shotId
    );
  }
  if (leftDependency.kind === 'existing_predecessor') {
    return (
      leftDependency.predecessorShotId === rightDependency.predecessorShotId &&
      leftDependency.takeAssetId === rightDependency.takeAssetId &&
      leftDependency.endpointSeconds === rightDependency.endpointSeconds
    );
  }
  return (
    leftDependency.upstreamItemId === rightDependency.upstreamItemId &&
    leftDependency.predecessorShotId === rightDependency.predecessorShotId
  );
};

const validateReceipt = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, RECEIPT_KEYS) &&
  isSafeId(value.authorizationId) &&
  isSafeId(value.itemId) &&
  isSafeId(value.jobId) &&
  typeof value.purpose === 'string' &&
  PURPOSES.has(value.purpose) &&
  isSafeId(value.routeId) &&
  isCurrency(value.currency) &&
  typeof value.rateUnit === 'string' &&
  RATE_UNITS.has(value.rateUnit) &&
  isIntegerInRange(value.rateMinorUnits, 1, Number.MAX_SAFE_INTEGER) &&
  (value.durationSeconds === null ||
    isIntegerInRange(value.durationSeconds, STUDIO_MIN_SHOT_SECONDS, STUDIO_MAX_SHOT_SECONDS)) &&
  value.generationCount === 1 &&
  isIntegerInRange(value.totalMinorUnits, 0, Number.MAX_SAFE_INTEGER);

const validateJob = (jobId: string, projectId: string, value: unknown): value is StudioJobV2 => {
  if (!isRecord(value) || !hasKeys(value, JOB_REQUIRED_KEYS, JOB_OPTIONAL_KEYS)) return false;
  const errorIsValid =
    value.error === null ||
    (isRecord(value.error) &&
      hasExactKeys(value.error, JOB_ERROR_KEYS) &&
      typeof value.error.code === 'string' &&
      JOB_ERROR_CODES.has(value.error.code) &&
      isNonEmptyStringWithin(value.error.messageKey, 256));
  const outputRolesAreValid =
    isRecord(value.outputAssetIdsByRole) &&
    hasExactKeys(value.outputAssetIdsByRole, OUTPUT_ROLE_KEYS) &&
    isNullableSafeId(value.outputAssetIdsByRole.primary) &&
    isNullableSafeId(value.outputAssetIdsByRole.poster) &&
    (value.outputAssetIdsByRole.primary === null ||
      value.outputAssetIdsByRole.primary !== value.outputAssetIdsByRole.poster);
  return (
    value.id === jobId &&
    isSafeId(jobId) &&
    value.projectId === projectId &&
    validateGenerationTarget(value.target) &&
    typeof value.status === 'string' &&
    JOB_STATUSES.has(value.status) &&
    validateProvider(value.provider) &&
    isSafeId(value.idempotencyKey) &&
    (value.providerJobId === null ||
      (typeof value.providerJobId === 'string' && isValidProviderJobId(value.providerJobId))) &&
    (value.remoteStartedAt === undefined ||
      (value.providerJobId === null ? value.remoteStartedAt === null : isCanonicalTimestamp(value.remoteStartedAt))) &&
    (value.cancellationPolicy === 'none' ||
      value.cancellationPolicy === 'queued_only' ||
      value.cancellationPolicy === 'queued_and_running') &&
    isUniqueSafeIdArray(value.outputAssetIds) &&
    typeof value.purpose === 'string' &&
    PURPOSES.has(value.purpose) &&
    (value.purpose === 'reference_image') === (isRecord(value.target) && value.target.kind === 'reference') &&
    isSafeId(value.authorizationId) &&
    isSafeId(value.authorizationItemId) &&
    validateComposition(value.composition) &&
    validateRequestPlan(value.requestPlan) &&
    requestPlanCompositionEquals(value.requestPlan, value.composition) &&
    (value.requestSnapshot === null || validateRequestSnapshot(value.requestSnapshot)) &&
    (value.spendReceipt === null || validateReceipt(value.spendReceipt)) &&
    outputRolesAreValid &&
    errorIsValid &&
    (value.progress === undefined || isFiniteInRange(value.progress, 0, 100)) &&
    (value.retryOfJobId === null || isSafeId(value.retryOfJobId)) &&
    (value.retryReason === null ||
      value.retryReason === 'provider_failure' ||
      value.retryReason === 'submission_unknown') &&
    ((value.retryOfJobId === null && value.retryReason === null) ||
      (value.retryOfJobId !== null && value.retryReason !== null)) &&
    typeof value.duplicateChargeAcknowledged === 'boolean' &&
    (value.duplicateChargeAcknowledgedAt === null || isCanonicalTimestamp(value.duplicateChargeAcknowledgedAt)) &&
    (value.duplicateChargeAcknowledged
      ? value.retryReason === 'submission_unknown' && value.duplicateChargeAcknowledgedAt !== null
      : value.duplicateChargeAcknowledgedAt === null) &&
    isCanonicalTimestamp(value.createdAt) &&
    isCanonicalTimestamp(value.updatedAt)
  );
};

const retryGraphHasCycle = (jobs: Record<string, StudioJobV2>): boolean => {
  const states = new Map<string, 'visiting' | 'visited'>();
  for (const startJobId of Object.keys(jobs)) {
    if (states.get(startJobId) === 'visited') continue;
    const path: string[] = [];
    let jobId: string | null = startJobId;
    while (jobId !== null) {
      const state = states.get(jobId);
      if (state === 'visiting') return true;
      if (state === 'visited') break;
      const job = ownValue(jobs, jobId);
      if (job === undefined) break;
      states.set(jobId, 'visiting');
      path.push(jobId);
      jobId = job.retryOfJobId !== null && Object.hasOwn(jobs, job.retryOfJobId) ? job.retryOfJobId : null;
    }
    for (const visitedJobId of path) states.set(visitedJobId, 'visited');
  }
  return false;
};

const binItemIsExact = (value: unknown): value is StudioBinItem => {
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

const validateBinStructure = (value: unknown): value is StudioBinItem[] => {
  if (!isDenseArray(value, STUDIO_MAX_BIN_BEAT_ITEMS + STUDIO_MAX_BIN_SHOT_ITEMS)) {
    return false;
  }
  let beatCount = 0;
  let shotCount = 0;
  const identities = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!binItemIsExact(item)) return false;
    let identity: string;
    if (item.kind === 'beat') {
      beatCount += 1;
      identity = `beat:${item.beatId}`;
    } else {
      shotCount += 1;
      identity = `shot:${item.shotId}`;
    }
    if (beatCount > STUDIO_MAX_BIN_BEAT_ITEMS || shotCount > STUDIO_MAX_BIN_SHOT_ITEMS || identities.has(identity)) {
      return false;
    }
    identities.add(identity);
  }
  return true;
};

const validateSpendPolicy = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, SPEND_POLICY_KEYS) &&
    isCurrency(value.currency) &&
    isIntegerInRange(value.maxPerBatchMinorUnits, 0, Number.MAX_SAFE_INTEGER));

const validateQuotedItem = (value: unknown, projectId: string, projectRevision: number): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, QUOTED_ITEM_REQUIRED_KEYS) ||
    !isSafeId(value.id) ||
    !validateGenerationTarget(value.target) ||
    typeof value.purpose !== 'string' ||
    !PURPOSES.has(value.purpose) ||
    !isSafeId(value.routeId) ||
    value.generationCount !== 1 ||
    !validateRequestPlan(value.requestPlan) ||
    typeof value.rateUnit !== 'string' ||
    !RATE_UNITS.has(value.rateUnit) ||
    !isIntegerInRange(value.rateMinorUnits, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return false;
  }
  const plan = value.requestPlan as Record<string, unknown>;
  const target = value.target as StudioQuotedGeneration['target'];
  if ((value.purpose === 'reference_image') !== (target.kind === 'reference')) return false;
  if (value.purpose === 'seed_still' || value.purpose === 'reference_image') {
    if (
      value.rateUnit !== 'generation' ||
      plan.kind !== 'resolved' ||
      !isRecord(plan.snapshot) ||
      plan.snapshot.conditioningInput !== null
    ) {
      return false;
    }
  } else if (value.purpose === 'board_still') {
    if (
      value.rateUnit !== 'generation' ||
      plan.kind !== 'resolved' ||
      !isRecord(plan.snapshot) ||
      plan.snapshot.durationSeconds !== STUDIO_BOARD_REQUEST_DURATION_SECONDS ||
      !Array.isArray(plan.snapshot.referenceInputs) ||
      plan.snapshot.conditioningInput !== null
    ) {
      return false;
    }
  } else if (
    value.rateUnit !== 'second' ||
    (plan.kind === 'resolved' &&
      (!isRecord(plan.snapshot) ||
        !Array.isArray(plan.snapshot.referenceInputs) ||
        plan.snapshot.referenceInputs.length !== 0 ||
        plan.snapshot.conditioningInput === null)) ||
    (plan.kind === 'after_take_selection' &&
      (!isRecord(plan.template) ||
        !Array.isArray(plan.template.referenceInputs) ||
        plan.template.referenceInputs.length !== 0))
  ) {
    return false;
  }
  const request = plan.kind === 'resolved' ? plan.snapshot : plan.template;
  if (!isRecord(request) || !isRecord(request.composition) || !isRecord(request.composition.inputs)) return false;
  const compositionInputs = request.composition.inputs;
  const source = compositionInputs.source;
  if (
    compositionInputs.projectRevision !== projectRevision ||
    compositionInputs.purpose !== value.purpose ||
    !isRecord(source) ||
    (target.kind === 'shot'
      ? source.kind !== 'shot' || source.shotId !== target.shotId
      : source.kind !== 'project_reference' || source.referenceId !== target.referenceId)
  ) {
    return false;
  }
  return (
    value.id ===
      createStudioQuotedGenerationId({
        projectId,
        projectRevision,
        target,
        purpose: value.purpose as StudioJobPurpose,
      }) &&
    calculateStudioQuotedGenerationAmounts(value as Parameters<typeof calculateStudioQuotedGenerationAmounts>[0]) !==
      null
  );
};

const validateAuthorizationShape = (value: unknown, projectId: string, currentRevision: number): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, AUTHORIZATION_KEYS) ||
    !isSafeId(value.id) ||
    value.projectId !== projectId ||
    !isIntegerInRange(value.projectRevision, 1, Number.MAX_SAFE_INTEGER) ||
    (value.projectRevision as number) >= currentRevision ||
    !isNullableSafeId(value.originReferenceHandoffId) ||
    !isLowercaseDigest(value.rateCardDigest) ||
    !isCurrency(value.currency) ||
    !isDenseArray(value.baseItems, STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) ||
    !isDenseArray(value.cascadeItems, STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) ||
    !isIntegerInRange(value.lowerMinorUnits, 0, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.upperMinorUnits, 0, Number.MAX_SAFE_INTEGER) ||
    (value.lowerMinorUnits as number) > (value.upperMinorUnits as number) ||
    !isCanonicalTimestamp(value.expiresAt) ||
    !isCanonicalTimestamp(value.confirmedAt) ||
    (value.confirmedAt as string) >= (value.expiresAt as string)
  ) {
    return false;
  }
  const items = [...value.baseItems, ...value.cascadeItems];
  if (items.length === 0 || items.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) return false;
  const itemIds = new Set<string>();
  const generationAuthorityKeys = new Set<string>();
  const shotIds = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!validateQuotedItem(item, projectId, value.projectRevision as number)) return false;
    const quoted = item as Record<string, unknown>;
    const itemId = quoted.id as string;
    const target = quoted.target as StudioQuotedGeneration['target'];
    const generationAuthorityKey = `${studioGenerationTargetKey(target)}\0${quoted.purpose as string}`;
    if (itemIds.has(itemId) || generationAuthorityKeys.has(generationAuthorityKey)) return false;
    itemIds.add(itemId);
    generationAuthorityKeys.add(generationAuthorityKey);
    if (target.kind === 'shot') shotIds.add(target.shotId);
    if (shotIds.size > STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST) return false;
  }
  if (!studioBoardAuthorizationScopeIsValidV2(value as unknown as StudioSubmissionQuote)) return false;
  const totals = calculateStudioQuoteTotals(items as Parameters<typeof calculateStudioQuoteTotals>[0]);
  if (
    totals === null ||
    totals.lowerMinorUnits !== value.lowerMinorUnits ||
    totals.upperMinorUnits !== value.upperMinorUnits
  ) {
    return false;
  }
  if (!isDenseArray(value.providerBindings, items.length) || value.providerBindings.length !== items.length) {
    return false;
  }
  for (let index = 0; index < items.length; index += 1) {
    const binding = value.providerBindings[index];
    const item = items[index] as StudioQuotedGeneration;
    const composition =
      item.requestPlan.kind === 'resolved'
        ? item.requestPlan.snapshot.composition
        : item.requestPlan.template.composition;
    if (
      !isRecord(binding) ||
      !hasExactKeys(binding, PROVIDER_BINDING_KEYS) ||
      binding.itemId !== (items[index] as Record<string, unknown>).id ||
      !validateProvider(binding.provider) ||
      !studioGenerationCompositionMatchesAuthorityV2(composition, {
        projectRevision: value.projectRevision as number,
        target: item.target,
        purpose: item.purpose,
        provider: binding.provider as StudioProviderRef,
      })
    ) {
      return false;
    }
  }
  if (!isDenseArray(value.idempotencyKeys, items.length) || value.idempotencyKeys.length !== items.length) {
    return false;
  }
  const keys = new Set<string>();
  for (let entryIndex = 0; entryIndex < items.length; entryIndex += 1) {
    const item = items[entryIndex];
    const quoted = item as Record<string, unknown>;
    const entry = value.idempotencyKeys[entryIndex];
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, IDEMPOTENCY_ENTRY_KEYS) ||
      entry.itemId !== quoted.id ||
      !isSafeId(entry.key) ||
      keys.has(entry.key)
    ) {
      return false;
    }
    keys.add(entry.key);
  }
  return true;
};

const validateFrameExtractionShape = (frameId: string, value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, FRAME_EXTRACTION_KEYS) ||
    value.id !== frameId ||
    !isSafeId(frameId) ||
    !isSafeId(value.shotId) ||
    !isSafeId(value.videoAssetId) ||
    !isFinitePositive(value.endpointSeconds) ||
    !isNullableSafeId(value.frameAssetId) ||
    typeof value.status !== 'string' ||
    !FRAME_STATUSES.has(value.status) ||
    (value.errorCode !== null && (typeof value.errorCode !== 'string' || !FRAME_ERROR_CODES.has(value.errorCode)))
  ) {
    return false;
  }
  if (
    value.id !==
    createStudioFrameExtractionId({
      shotId: value.shotId as string,
      videoAssetId: value.videoAssetId as string,
      endpointSeconds: value.endpointSeconds as number,
    })
  ) {
    return false;
  }
  if (value.status === 'ready') return value.frameAssetId !== null && value.errorCode === null;
  if (value.status === 'failed') return value.frameAssetId === null && value.errorCode !== null;
  return value.frameAssetId === null && value.errorCode === null;
};

const validateProjectPatchReferences = (order: unknown, references: unknown): boolean => {
  if (!isUniqueSafeIdArray(order, STUDIO_MAX_PROJECT_REFERENCES) || !isRecord(references)) return false;
  const referenceIds = Object.keys(references);
  if (
    referenceIds.length !== order.length ||
    !referenceIds.every((referenceId) => validateProjectReference(referenceId, references[referenceId])) ||
    !arrayEvery(order, (referenceId) => Object.hasOwn(references, referenceId))
  ) {
    return false;
  }
  let sawBackground = false;
  for (const referenceId of order) {
    const reference = references[referenceId] as StudioProjectReferenceV2;
    if (sawBackground && reference.kind === 'character') return false;
    if (reference.kind === 'background') sawBackground = true;
  }
  return true;
};

const validateProjectPatchBefore = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PROJECT_PATCH_BEFORE_KEYS) &&
  isNonEmptyStringWithin(value.name, 256) &&
  typeof value.aspectRatio === 'string' &&
  ASPECT_RATIOS.has(value.aspectRatio) &&
  typeof value.resolution === 'string' &&
  RESOLUTIONS.has(value.resolution) &&
  isIntegerInRange(value.targetDurationSeconds, 5, 1440) &&
  (value.boardStyle === null || (typeof value.boardStyle === 'string' && BOARD_STYLES.has(value.boardStyle))) &&
  isStringWithin(value.brief, 16 * 1024) &&
  validateRules(value.rules) &&
  isUniqueSafeIdArray(value.beatOrder, STUDIO_MAX_BEATS) &&
  isNullableRouteId(value.imageRouteId) &&
  isNullableRouteId(value.videoRouteId) &&
  validateSpendPolicy(value.spendPolicy) &&
  isNullableSafeId(value.bedAssetId);

const validateUndoPatch = (value: unknown): boolean => {
  if (!isRecord(value) || !isLowercaseDigest(value.afterDigest)) return false;
  if (value.kind === 'project_fields') {
    return hasExactKeys(value, PROJECT_PATCH_KEYS) && validateProjectPatchBefore(value.before);
  }
  if (value.kind === 'reference_catalog') {
    if (
      !hasExactKeys(value, PROJECT_PATCH_KEYS) ||
      !isRecord(value.before) ||
      !hasExactKeys(value.before, REFERENCE_CATALOG_PATCH_BEFORE_KEYS) ||
      (value.before.referencePlanStatus !== 'unplanned' && value.before.referencePlanStatus !== 'planned') ||
      !validateProjectPatchReferences(value.before.referenceOrder, value.before.references)
    ) {
      return false;
    }
    return (
      value.before.referencePlanStatus === 'planned' ||
      ((value.before.referenceOrder as unknown[]).length === 0 &&
        Object.keys(value.before.references as Record<string, unknown>).length === 0)
    );
  }
  if (value.kind === 'beat_fields') {
    return (
      hasExactKeys(value, BEAT_PATCH_KEYS) &&
      isSafeId(value.beatId) &&
      (value.before === null || validateBeat(value.beatId, value.before))
    );
  }
  if (value.kind === 'shot_fields') {
    return (
      hasExactKeys(value, SHOT_PATCH_KEYS) &&
      isSafeId(value.shotId) &&
      (value.before === null || validateShotRecord(value.shotId, value.before, SHOT_BEFORE_KEYS, false)) &&
      isNullableSafeId(value.beforeBeatId) &&
      (value.beforeIndex === null || isIntegerInRange(value.beforeIndex, 0, STUDIO_MAX_SHOTS_PER_BEAT - 1)) &&
      (value.before === null ? value.beforeBeatId === null && value.beforeIndex === null : value.beforeBeatId !== null)
    );
  }
  return value.kind === 'bin' && hasExactKeys(value, BIN_PATCH_KEYS) && validateBinStructure(value.before);
};

const validateUndoHistory = (value: unknown, currentRevision: number): boolean => {
  if (!isDenseArray(value, STUDIO_MAX_UNDO_ENTRIES)) return false;
  const entryIds = new Set<string>();
  for (let entryIndex = 0; entryIndex < value.length; entryIndex += 1) {
    const entry = value[entryIndex];
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, UNDO_ENTRY_KEYS) ||
      !isSafeId(entry.id) ||
      entryIds.has(entry.id) ||
      !isIntegerInRange(entry.sourceRevision, 1, currentRevision) ||
      !isNonEmptyStringWithin(entry.label, STUDIO_MAX_UNDO_LABEL_LENGTH) ||
      !isDenseArray(entry.patches, STUDIO_MAX_UNDO_PATCHES_PER_ENTRY) ||
      entry.patches.length === 0
    ) {
      return false;
    }
    entryIds.add(entry.id);
    let hasProjectPatch = false;
    let hasReferenceCatalogPatch = false;
    let hasBinPatch = false;
    const beatIds = new Set<string>();
    const shotIds = new Set<string>();
    for (let patchIndex = 0; patchIndex < entry.patches.length; patchIndex += 1) {
      const patch = entry.patches[patchIndex];
      if (!validateUndoPatch(patch) || !isRecord(patch)) return false;
      if (patch.kind === 'project_fields') {
        if (hasProjectPatch) return false;
        hasProjectPatch = true;
      } else if (patch.kind === 'reference_catalog') {
        if (hasReferenceCatalogPatch) return false;
        hasReferenceCatalogPatch = true;
      } else if (patch.kind === 'bin') {
        if (hasBinPatch) return false;
        hasBinPatch = true;
      } else if (patch.kind === 'beat_fields') {
        if (beatIds.has(patch.beatId as string)) return false;
        beatIds.add(patch.beatId as string);
      } else {
        if (shotIds.has(patch.shotId as string)) return false;
        shotIds.add(patch.shotId as string);
      }
    }
  }
  return true;
};

const isTerminalJob = (job: StudioJobV2): boolean => TERMINAL_JOB_STATUSES.has(job.status);
const hasProviderAttempt = (job: StudioJobV2): boolean =>
  job.providerJobId !== null ||
  (job.remoteStartedAt !== undefined && job.remoteStartedAt !== null) ||
  job.progress !== undefined;
const hasNoOutput = (job: StudioJobV2): boolean =>
  job.outputAssetIds.length === 0 &&
  job.outputAssetIdsByRole.primary === null &&
  job.outputAssetIdsByRole.poster === null;

const isCanonicalImageTake = (asset: StudioAssetV2 | undefined, shotId: string): asset is StudioAssetV2 =>
  asset !== undefined &&
  asset.shotId === shotId &&
  asset.mediaKind === 'image' &&
  (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports');

const isCanonicalBoardStill = (asset: StudioAssetV2 | undefined, shotId: string): asset is StudioAssetV2 =>
  asset !== undefined &&
  asset.shotId === shotId &&
  asset.mediaKind === 'image' &&
  asset.managedAsset.collection === 'boardStills';

const isCanonicalVideoTake = (asset: StudioAssetV2 | undefined, shotId: string): asset is StudioAssetV2 =>
  asset !== undefined &&
  asset.shotId === shotId &&
  asset.mediaKind === 'video' &&
  asset.managedAsset.collection === 'assets' &&
  asset.durationSeconds !== undefined;

const requestReferences = (job: StudioJobV2): StudioGenerationReferenceInputSnapshot[] => {
  const request = job.requestPlan.kind === 'resolved' ? job.requestPlan.snapshot : job.requestPlan.template;
  return request.referenceInputs;
};

const requestDurationSeconds = (plan: StudioJobV2['requestPlan']): number =>
  plan.kind === 'resolved' ? plan.snapshot.durationSeconds : plan.template.durationSeconds;

const validateReceiptAgainstJob = (
  job: StudioJobV2,
  item: StudioProjectV2['spendAuthorizations'][number]['baseItems'][number],
  authorization: StudioProjectV2['spendAuthorizations'][number]
): boolean => {
  if (job.spendReceipt === null) return false;
  const receipt = job.spendReceipt;
  const amounts = calculateStudioQuotedGenerationAmounts(item);
  if (amounts === null) return false;
  const expectedDuration = item.purpose === 'video_take' ? requestDurationSeconds(item.requestPlan) : null;
  return (
    receipt.authorizationId === authorization.id &&
    receipt.itemId === item.id &&
    receipt.jobId === job.id &&
    receipt.purpose === item.purpose &&
    receipt.routeId === item.routeId &&
    receipt.currency === authorization.currency &&
    receipt.rateUnit === item.rateUnit &&
    receipt.rateMinorUnits === item.rateMinorUnits &&
    receipt.durationSeconds === expectedDuration &&
    receipt.generationCount === item.generationCount &&
    receipt.totalMinorUnits === amounts.oneGenerationMinorUnits
  );
};

/** Validates the complete persisted schema-2 project contract without I/O or normalization. */
export const validateStudioProjectV2 = (value: unknown): value is StudioProjectV2 => {
  const dataSnapshot = snapshotOwnDataGraph(value);
  if (dataSnapshot === INVALID_DATA_SNAPSHOT) return false;
  value = dataSnapshot;

  if (
    !isRecord(value) ||
    !hasKeys(value, PROJECT_REQUIRED_KEYS, PROJECT_OPTIONAL_KEYS) ||
    value.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
    !isIntegerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isSafeId(value.id) ||
    !isNonEmptyStringWithin(value.name, 256) ||
    !isStringWithin(value.brief, 16 * 1024) ||
    !validateRules(value.rules) ||
    (value.forgeProjectId !== undefined && !isSafeId(value.forgeProjectId)) ||
    (value.briefConversationId !== undefined &&
      value.briefConversationId !== null &&
      !isSafeId(value.briefConversationId)) ||
    typeof value.aspectRatio !== 'string' ||
    !ASPECT_RATIOS.has(value.aspectRatio) ||
    !isIntegerInRange(value.targetDurationSeconds, 5, 1440) ||
    typeof value.resolution !== 'string' ||
    !RESOLUTIONS.has(value.resolution) ||
    (value.boardStyle !== null && (typeof value.boardStyle !== 'string' || !BOARD_STYLES.has(value.boardStyle))) ||
    !isUniqueSafeIdArray(value.beatOrder, STUDIO_MAX_BEATS) ||
    !isRecord(value.beats) ||
    !isRecord(value.shots) ||
    (value.referencePlanStatus !== 'unplanned' && value.referencePlanStatus !== 'planned') ||
    !isUniqueSafeIdArray(value.referenceOrder, STUDIO_MAX_PROJECT_REFERENCES) ||
    !isRecord(value.references) ||
    !validateBinStructure(value.bin) ||
    !isNullableSafeId(value.bedAssetId) ||
    !validateSpendPolicy(value.spendPolicy) ||
    !isDenseArray(value.spendAuthorizations) ||
    !isRecord(value.frameExtractions) ||
    !validateUndoHistory(value.undoHistory, value.revision as number) ||
    !isNullableRouteId(value.imageRouteId) ||
    !isNullableRouteId(value.videoRouteId) ||
    !isRecord(value.assets) ||
    !isRecord(value.jobs) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt)
  ) {
    return false;
  }

  const project = value as StudioProjectV2;
  const beatIds = Object.keys(project.beats);
  const shotIds = Object.keys(project.shots);
  const referenceIds = Object.keys(project.references);
  if (
    beatIds.length > STUDIO_MAX_BEATS ||
    shotIds.length > STUDIO_MAX_SHOTS_PER_PROJECT ||
    referenceIds.length > STUDIO_MAX_PROJECT_REFERENCES ||
    !beatIds.every((beatId) => validateBeat(beatId, project.beats[beatId])) ||
    !shotIds.every((shotId) => validateShot(shotId, project.shots[shotId])) ||
    !referenceIds.every((referenceId) => validateProjectReference(referenceId, project.references[referenceId])) ||
    (project.referencePlanStatus === 'unplanned' && referenceIds.length !== 0) ||
    project.referenceOrder.length !== referenceIds.length ||
    !arrayEvery(project.referenceOrder, (referenceId) => Object.hasOwn(project.references, referenceId)) ||
    !arrayEvery(project.beatOrder, (beatId) => Object.hasOwn(project.beats, beatId))
  ) {
    return false;
  }

  const activeBeatIds = new Set(arrayMap(project.beatOrder, (beatId) => beatId));
  const binnedBeatIds = new Set<string>();
  const binnedShotOwnerIds = new Map<string, string>();
  for (let binIndex = 0; binIndex < project.bin.length; binIndex += 1) {
    const item = project.bin[binIndex]!;
    if (item.kind === 'beat') {
      if (!Object.hasOwn(project.beats, item.beatId) || activeBeatIds.has(item.beatId)) return false;
      binnedBeatIds.add(item.beatId);
    } else {
      if (!Object.hasOwn(project.beats, item.beatId) || !Object.hasOwn(project.shots, item.shotId)) return false;
      binnedShotOwnerIds.set(item.shotId, item.beatId);
    }
  }
  for (const beatId of beatIds) {
    if (Number(activeBeatIds.has(beatId)) + Number(binnedBeatIds.has(beatId)) !== 1) return false;
  }

  const shotOwners = new Map<string, string>();
  for (const beatId of beatIds) {
    const shotOrder = project.beats[beatId]!.shotOrder;
    for (let shotIndex = 0; shotIndex < shotOrder.length; shotIndex += 1) {
      const shotId = shotOrder[shotIndex]!;
      if (!Object.hasOwn(project.shots, shotId) || shotOwners.has(shotId)) return false;
      shotOwners.set(shotId, beatId);
    }
  }
  for (const [shotId, beatId] of binnedShotOwnerIds) {
    if (shotOwners.has(shotId)) return false;
    shotOwners.set(shotId, beatId);
  }
  if (shotOwners.size !== shotIds.length) return false;

  const referenceLabels = new Set<string>();
  let sawBackgroundReference = false;
  for (const referenceId of project.referenceOrder) {
    const reference = ownValue(project.references, referenceId);
    if (reference === undefined || (sawBackgroundReference && reference.kind === 'character')) return false;
    const labelIdentity = `${reference.kind}\0${reference.label}`;
    if (referenceLabels.has(labelIdentity)) return false;
    referenceLabels.add(labelIdentity);
    if (reference.kind === 'background') sawBackgroundReference = true;
  }
  for (const shot of Object.values(project.shots)) {
    const bindingReferenceIds = [
      ...shot.referenceBinding.characterReferenceIds,
      ...(shot.referenceBinding.backgroundReferenceId === null ? [] : [shot.referenceBinding.backgroundReferenceId]),
    ];
    for (const referenceId of bindingReferenceIds) {
      const reference = ownValue(project.references, referenceId);
      if (reference === undefined) return false;
      if (
        shot.referenceBinding.characterReferenceIds.includes(referenceId)
          ? reference.kind !== 'character'
          : reference.kind !== 'background'
      ) {
        return false;
      }
    }
    if (
      shot.referenceBinding.status === 'ready' &&
      bindingReferenceIds.some((referenceId) => project.references[referenceId]?.approvedAssetId === null)
    ) {
      return false;
    }
  }

  const inactiveShotIds = new Set<string>(binnedShotOwnerIds.keys());
  for (const [shotId, beatId] of shotOwners) {
    const beat = ownValue(project.beats, beatId);
    const shot = ownValue(project.shots, shotId);
    if (beat === undefined || shot === undefined) return false;
    if (binnedBeatIds.has(beatId)) inactiveShotIds.add(shotId);
  }
  for (const beat of Object.values(project.beats)) {
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const shot = ownValue(project.shots, beat.shotOrder[shotIndex]!);
      if (shot === undefined) return false;
      const isSegmentHead = shotIndex === 0 || shot.chainBreak === 'hard_cut';
      if (!isSegmentHead && shot.seedStillId !== null) return false;
    }
  }

  const assetIds = Object.keys(project.assets);
  const jobIds = Object.keys(project.jobs);
  if (
    !assetIds.every((assetId) => validateAsset(assetId, project.id, project.assets[assetId])) ||
    !jobIds.every((jobId) => validateJob(jobId, project.id, project.jobs[jobId]))
  ) {
    return false;
  }

  const shotAssetIdsByShotId = new Map<string, ReadonlySet<string>>();
  const shotJobPositionsByShotId = new Map<string, ReadonlyMap<string, number>>();
  const referenceJobPositionsByReferenceId = new Map<string, ReadonlyMap<string, number>>();
  for (const shot of Object.values(project.shots)) {
    shotAssetIdsByShotId.set(shot.id, new Set(arrayMap(shot.assetIds, (assetId) => assetId)));
    shotJobPositionsByShotId.set(shot.id, new Map(arrayMap(shot.jobIds, (jobId, index) => [jobId, index] as const)));
  }
  for (const reference of Object.values(project.references)) {
    referenceJobPositionsByReferenceId.set(
      reference.id,
      new Map(arrayMap(reference.jobIds, (jobId, index) => [jobId, index] as const))
    );
  }

  for (const asset of Object.values(project.assets)) {
    if (asset.shotId !== null) {
      const shot = ownValue(project.shots, asset.shotId);
      if (shot === undefined || !shotAssetIdsByShotId.get(shot.id)?.has(asset.id)) return false;
    }
  }

  if (project.bedAssetId !== null) {
    const bed = ownValue(project.assets, project.bedAssetId);
    if (bed === undefined || !isCanonicalStudioBedAudioAssetV2(bed)) {
      return false;
    }
  }
  for (const job of Object.values(project.jobs)) {
    if (job.target.kind === 'shot') {
      const shot = ownValue(project.shots, job.target.shotId);
      if (shot === undefined || !shotJobPositionsByShotId.get(shot.id)?.has(job.id)) return false;
      if (
        !arrayEvery(job.outputAssetIds, (assetId) => {
          const asset = ownValue(project.assets, assetId);
          return asset?.shotId === shot.id && shotAssetIdsByShotId.get(shot.id)?.has(assetId) === true;
        })
      ) {
        return false;
      }
    } else {
      const reference = ownValue(project.references, job.target.referenceId);
      if (reference === undefined || !reference.jobIds.includes(job.id)) return false;
      if (
        !arrayEvery(job.outputAssetIds, (assetId) => {
          const asset = ownValue(project.assets, assetId);
          return asset?.shotId === null && asset.projectReferenceId === reference.id;
        })
      ) {
        return false;
      }
    }
  }

  const outputProducerByAssetId = new Map<string, StudioJobV2>();
  for (const shot of Object.values(project.shots)) {
    if (!arrayEvery(shot.assetIds, (assetId) => ownValue(project.assets, assetId)?.shotId === shot.id)) return false;
    if (
      !arrayEvery(shot.jobIds, (jobId) => {
        const job = ownValue(project.jobs, jobId);
        return job?.target.kind === 'shot' && job.target.shotId === shot.id;
      })
    ) {
      return false;
    }
  }

  if (
    project.boardStyle === null &&
    (Object.values(project.jobs).some((job) => job.purpose === 'board_still') ||
      Object.values(project.shots).some(
        (shot) => shot.boardAssetId !== null || shot.supersededBoardAssetIds.length > 0
      ))
  ) {
    return false;
  }

  for (const job of Object.values(project.jobs)) {
    if ((job.status === 'failed') !== (job.error !== null) && job.status !== 'needs_attention') return false;
    if (job.status !== 'failed' && job.status !== 'needs_attention' && job.error !== null) return false;
    if (job.status === 'waiting_for_conditioning' && job.error !== null) return false;
    if (job.error?.code === 'dependency_failed' && job.status !== 'failed') return false;
    if (job.status === 'queued_local' || job.status === 'waiting_for_conditioning') {
      if (hasProviderAttempt(job)) return false;
    }
    if (job.status === 'succeeded') {
      if (job.outputAssetIdsByRole.primary === null) return false;
    } else if (job.outputAssetIdsByRole.primary !== null || job.outputAssetIdsByRole.poster !== null) {
      return false;
    }
    if (job.purpose !== 'video_take' && job.outputAssetIdsByRole.poster !== null) return false;
    if (
      job.purpose === 'board_still' &&
      job.status === 'succeeded' &&
      (job.outputAssetIds.length !== 1 || job.outputAssetIds[0] !== job.outputAssetIdsByRole.primary)
    ) {
      return false;
    }
    for (const outputAssetId of job.outputAssetIds) {
      const output = ownValue(project.assets, outputAssetId);
      const outputCollectionIsValid =
        job.purpose === 'board_still'
          ? output?.managedAsset.collection === 'boardStills'
          : output?.managedAsset.collection === 'assets' || output?.managedAsset.collection === 'thumbnails';
      const expectedShotId = job.target.kind === 'shot' ? job.target.shotId : null;
      const expectedProjectReferenceId = job.target.kind === 'reference' ? job.target.referenceId : null;
      const expectedReferenceAssetIds = requestReferences(job).map((reference) => reference.assetId);
      if (
        output === undefined ||
        output.shotId !== expectedShotId ||
        output.projectReferenceId !== expectedProjectReferenceId ||
        output.producerJobId !== job.id ||
        output.compositionDigest !== compositionDigest(job.composition) ||
        output.generationReferenceAssetIds.length !== expectedReferenceAssetIds.length ||
        output.generationReferenceAssetIds.some((assetId, index) => assetId !== expectedReferenceAssetIds[index]) ||
        !outputCollectionIsValid ||
        outputProducerByAssetId.has(outputAssetId)
      ) {
        return false;
      }
      outputProducerByAssetId.set(outputAssetId, job);
    }
    const primaryId = job.outputAssetIdsByRole.primary;
    if (primaryId !== null) {
      if (!job.outputAssetIds.includes(primaryId)) return false;
      const primary = ownValue(project.assets, primaryId);
      const targetShotId = job.target.kind === 'shot' ? job.target.shotId : null;
      if (
        primary === undefined ||
        (job.purpose === 'seed_still' &&
          (primary.managedAsset.collection !== 'assets' || primary.mediaKind !== 'image')) ||
        (job.purpose === 'board_still' && (targetShotId === null || !isCanonicalBoardStill(primary, targetShotId))) ||
        (job.purpose === 'video_take' &&
          (primary.managedAsset.collection !== 'assets' ||
            primary.mediaKind !== 'video' ||
            primary.durationSeconds === undefined)) ||
        (job.purpose === 'reference_image' &&
          (job.target.kind !== 'reference' ||
            primary.shotId !== null ||
            primary.projectReferenceId !== job.target.referenceId ||
            primary.mediaKind !== 'image' ||
            primary.managedAsset.collection !== 'assets'))
      ) {
        return false;
      }
    }
    const posterId = job.outputAssetIdsByRole.poster;
    if (posterId !== null) {
      if (!job.outputAssetIds.includes(posterId)) return false;
      const poster = ownValue(project.assets, posterId);
      if (
        job.purpose !== 'video_take' ||
        poster === undefined ||
        poster.mediaKind !== 'image' ||
        poster.managedAsset.collection !== 'thumbnails'
      ) {
        return false;
      }
    }
  }

  const frameByAssetId = new Map<string, StudioProjectV2['frameExtractions'][string]>();
  for (const frameId of Object.keys(project.frameExtractions)) {
    const frame = ownValue(project.frameExtractions, frameId);
    if (frame === undefined || !validateFrameExtractionShape(frameId, frame)) return false;
    const take = ownValue(project.assets, frame.videoAssetId);
    const takeProducer = take === undefined ? undefined : outputProducerByAssetId.get(take.id);
    if (
      !isCanonicalVideoTake(take, frame.shotId) ||
      !shotAssetIdsByShotId.get(frame.shotId)?.has(take.id) ||
      frame.endpointSeconds > take.durationSeconds! ||
      takeProducer?.status !== 'succeeded' ||
      takeProducer.purpose !== 'video_take' ||
      takeProducer.outputAssetIdsByRole.primary !== take.id
    ) {
      return false;
    }
    if (frame.frameAssetId !== null) {
      const frameAsset = ownValue(project.assets, frame.frameAssetId);
      if (
        frameAsset === undefined ||
        frameAsset.shotId !== frame.shotId ||
        frameAsset.mediaKind !== 'image' ||
        frameAsset.managedAsset.collection !== 'conditioningFrames' ||
        !shotAssetIdsByShotId.get(frame.shotId)?.has(frameAsset.id) ||
        frameByAssetId.has(frameAsset.id) ||
        outputProducerByAssetId.has(frameAsset.id)
      ) {
        return false;
      }
      frameByAssetId.set(frameAsset.id, frame);
    }
  }

  for (const asset of Object.values(project.assets)) {
    if (asset.shotId === null) continue;
    if (asset.managedAsset.collection === 'boardStills') {
      const producer = outputProducerByAssetId.get(asset.id);
      if (
        producer?.status !== 'succeeded' ||
        producer.purpose !== 'board_still' ||
        producer.outputAssetIdsByRole.primary !== asset.id
      ) {
        return false;
      }
    } else if (asset.managedAsset.collection === 'imports') {
      if (asset.mediaKind !== 'image' || outputProducerByAssetId.has(asset.id) || frameByAssetId.has(asset.id)) {
        return false;
      }
    } else if (asset.managedAsset.collection === 'conditioningFrames') {
      if (!frameByAssetId.has(asset.id)) return false;
    } else if (!outputProducerByAssetId.has(asset.id)) {
      return false;
    }
  }

  const isCanonicalPrimary = (asset: StudioAssetV2 | undefined, shotId: string, purpose: StudioJobV2['purpose']) => {
    if (purpose === 'seed_still') {
      if (!isCanonicalImageTake(asset, shotId)) return false;
      if (asset.managedAsset.collection === 'imports') return !outputProducerByAssetId.has(asset.id);
    } else if (purpose === 'board_still') {
      if (!isCanonicalBoardStill(asset, shotId)) return false;
    } else if (!isCanonicalVideoTake(asset, shotId)) {
      return false;
    }
    const producer = outputProducerByAssetId.get(asset.id);
    return (
      producer?.status === 'succeeded' &&
      producer.purpose === purpose &&
      producer.target.kind === 'shot' &&
      producer.target.shotId === shotId &&
      producer.outputAssetIdsByRole.primary === asset.id
    );
  };
  const isCanonicalSeedSelection = (asset: StudioAssetV2 | undefined, shotId: string): boolean =>
    isCanonicalPrimary(asset, shotId, 'seed_still') || isCanonicalPrimary(asset, shotId, 'board_still');
  const isCurrentExistingPredecessor = (
    dependency: Extract<StudioGenerationRequestPlan, { kind: 'after_take_selection' }>['dependency'],
    dependentShotId: string
  ): boolean => {
    if (dependency.kind !== 'existing_predecessor') return false;
    const predecessorOwner = shotOwners.get(dependency.predecessorShotId);
    const dependentOwner = shotOwners.get(dependentShotId);
    const beat = predecessorOwner === undefined ? undefined : ownValue(project.beats, predecessorOwner);
    const predecessor = ownValue(project.shots, dependency.predecessorShotId);
    const dependent = ownValue(project.shots, dependentShotId);
    const take = ownValue(project.assets, dependency.takeAssetId);
    const dependentIndex = beat?.shotOrder.indexOf(dependentShotId) ?? -1;
    if (
      predecessorOwner === undefined ||
      dependentOwner !== predecessorOwner ||
      !activeBeatIds.has(predecessorOwner) ||
      dependentIndex <= 0 ||
      beat?.shotOrder[dependentIndex - 1] !== dependency.predecessorShotId ||
      inactiveShotIds.has(dependency.predecessorShotId) ||
      inactiveShotIds.has(dependentShotId) ||
      dependent?.chainBreak !== 'none' ||
      predecessor?.videoAssetId !== dependency.takeAssetId ||
      !isCanonicalPrimary(take, dependency.predecessorShotId, 'video_take') ||
      take.durationSeconds === undefined
    ) {
      return false;
    }
    const endpointSeconds = take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
    if (!Object.is(endpointSeconds, dependency.endpointSeconds)) return false;
    let extractionId: string;
    try {
      extractionId = createStudioFrameExtractionId({
        shotId: dependency.predecessorShotId,
        videoAssetId: dependency.takeAssetId,
        endpointSeconds: dependency.endpointSeconds,
      });
    } catch {
      return false;
    }
    const extraction = ownValue(project.frameExtractions, extractionId);
    return (
      extraction?.id === extractionId &&
      extraction.shotId === dependency.predecessorShotId &&
      extraction.videoAssetId === dependency.takeAssetId &&
      Object.is(extraction.endpointSeconds, dependency.endpointSeconds)
    );
  };

  for (const shot of Object.values(project.shots)) {
    if (
      (shot.seedStillId !== null &&
        (shot.dismissedSeedStillIds.includes(shot.seedStillId) ||
          !isCanonicalSeedSelection(ownValue(project.assets, shot.seedStillId), shot.id))) ||
      shot.dismissedSeedStillIds.some((assetId) => {
        const asset = ownValue(project.assets, assetId);
        return (
          asset === undefined ||
          asset.shotId !== shot.id ||
          asset.mediaKind !== 'image' ||
          (asset.managedAsset.collection !== 'assets' &&
            asset.managedAsset.collection !== 'imports' &&
            asset.managedAsset.collection !== 'boardStills')
        );
      })
    ) {
      return false;
    }
    const successfulBoardAssetIds = shot.jobIds.flatMap((jobId) => {
      const job = ownValue(project.jobs, jobId);
      return job?.status === 'succeeded' && job.purpose === 'board_still' && job.outputAssetIdsByRole.primary !== null
        ? [job.outputAssetIdsByRole.primary]
        : [];
    });
    const expectedBoardAssetId = successfulBoardAssetIds.at(-1) ?? null;
    const expectedSupersededBoardAssetIds = successfulBoardAssetIds.slice(0, -1);
    if (
      shot.boardAssetId !== expectedBoardAssetId ||
      shot.supersededBoardAssetIds.length !== expectedSupersededBoardAssetIds.length ||
      shot.supersededBoardAssetIds.some((assetId, index) => assetId !== expectedSupersededBoardAssetIds[index])
    ) {
      return false;
    }
    if (
      shot.boardAssetId !== null &&
      !isCanonicalPrimary(ownValue(project.assets, shot.boardAssetId), shot.id, 'board_still')
    ) {
      return false;
    }
    const successfulVideoAssetIds = shot.jobIds.flatMap((jobId) => {
      const job = ownValue(project.jobs, jobId);
      return job?.status === 'succeeded' && job.purpose === 'video_take' && job.outputAssetIdsByRole.primary !== null
        ? [job.outputAssetIdsByRole.primary]
        : [];
    });
    const expectedSupersededVideoAssetIds = successfulVideoAssetIds.filter((assetId) => assetId !== shot.videoAssetId);
    if (
      (shot.videoAssetId !== null && !successfulVideoAssetIds.includes(shot.videoAssetId)) ||
      shot.supersededVideoAssetIds.length !== expectedSupersededVideoAssetIds.length ||
      shot.supersededVideoAssetIds.some((assetId, index) => assetId !== expectedSupersededVideoAssetIds[index])
    ) {
      return false;
    }
    if (shot.videoAssetId === null) {
      if (shot.trimInSeconds !== null || shot.trimOutSeconds !== null) return false;
      continue;
    }
    const selected = ownValue(project.assets, shot.videoAssetId);
    if (!isCanonicalPrimary(selected, shot.id, 'video_take')) return false;
    const trimIn = shot.trimInSeconds ?? 0;
    const trimOut = shot.trimOutSeconds ?? 0;
    if (
      trimIn >= selected.durationSeconds! ||
      trimOut >= selected.durationSeconds! ||
      trimIn + trimOut >= selected.durationSeconds!
    ) {
      return false;
    }
  }

  if (retryGraphHasCycle(project.jobs)) return false;
  const retriedPredecessorIds = new Set<string>();
  for (const job of Object.values(project.jobs)) {
    if (job.retryOfJobId === null) continue;
    if (retriedPredecessorIds.has(job.retryOfJobId)) return false;
    retriedPredecessorIds.add(job.retryOfJobId);
    const predecessor = ownValue(project.jobs, job.retryOfJobId);
    if (
      predecessor === undefined ||
      studioGenerationTargetKey(predecessor.target) !== studioGenerationTargetKey(job.target)
    ) {
      return false;
    }
    const ownerJobPositions =
      job.target.kind === 'shot'
        ? shotJobPositionsByShotId.get(job.target.shotId)
        : referenceJobPositionsByReferenceId.get(job.target.referenceId);
    const predecessorIndex = ownerJobPositions?.get(predecessor.id);
    const retryIndex = ownerJobPositions?.get(job.id);
    if (predecessorIndex === undefined || retryIndex === undefined || predecessorIndex >= retryIndex) return false;
    if (predecessor.purpose !== job.purpose) return false;
    const isExactProjectReferenceRetry = job.target.kind === 'reference';
    const isProjectReferencePollDeadline =
      isExactProjectReferenceRetry && predecessor.status === 'failed' && predecessor.error?.code === 'poll_deadline';
    if (job.retryReason === 'submission_unknown') {
      const isSubmissionUnknownPredecessor =
        predecessor.error?.code === 'submission_unknown' &&
        (predecessor.status === 'failed' ||
          (!isExactProjectReferenceRetry && predecessor.status === 'needs_attention'));
      if ((!isSubmissionUnknownPredecessor && !isProjectReferencePollDeadline) || !job.duplicateChargeAcknowledged) {
        return false;
      }
    } else {
      const isProviderFailurePredecessor =
        predecessor.status === 'failed' &&
        predecessor.error?.code !== 'submission_unknown' &&
        predecessor.error?.code !== 'download_failed' &&
        (!isExactProjectReferenceRetry || predecessor.error?.code !== 'poll_deadline');
      const isProjectReferenceCancellation = isExactProjectReferenceRetry && predecessor.status === 'cancelled';
      if (
        job.retryReason !== 'provider_failure' ||
        (!isProviderFailurePredecessor && !isProjectReferenceCancellation) ||
        job.duplicateChargeAcknowledged
      ) {
        return false;
      }
    }
  }

  type Authorization = StudioProjectV2['spendAuthorizations'][number];
  type QuotedItem = Authorization['baseItems'][number];
  type ItemLink = {
    authorization: Authorization;
    item: QuotedItem;
    provider: Authorization['providerBindings'][number]['provider'];
    idempotencyKey: string;
  };
  const authorizationIds = new Set<string>();
  const referenceHandoffOriginIds = new Set<string>();
  const itemLinks = new Map<string, ItemLink>();
  const globalIdempotencyKeys = new Set<string>();
  for (let authorizationIndex = 0; authorizationIndex < project.spendAuthorizations.length; authorizationIndex += 1) {
    const authorization = project.spendAuthorizations[authorizationIndex]!;
    if (
      !validateAuthorizationShape(authorization, project.id, project.revision) ||
      authorizationIds.has(authorization.id)
    ) {
      return false;
    }
    authorizationIds.add(authorization.id);
    if (authorization.originReferenceHandoffId !== null) {
      if (referenceHandoffOriginIds.has(authorization.originReferenceHandoffId)) return false;
      referenceHandoffOriginIds.add(authorization.originReferenceHandoffId);
    }
    const items = [...authorization.baseItems, ...authorization.cascadeItems];
    const itemPositions = new Map<string, number>();
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex]!;
      if (itemLinks.has(item.id)) return false;
      if (item.target.kind === 'reference') {
        const targetReference = ownValue(project.references, item.target.referenceId);
        if (
          item.purpose !== 'reference_image' ||
          targetReference === undefined ||
          (item.requestPlan.kind === 'resolved' && item.requestPlan.snapshot.referenceInputs.length !== 0)
        ) {
          return false;
        }
      } else if (!Object.hasOwn(project.shots, item.target.shotId) || item.purpose === 'reference_image') {
        return false;
      }
      itemPositions.set(item.id, itemIndex);
      const idempotencyKey = authorization.idempotencyKeys[itemIndex]!.key;
      if (globalIdempotencyKeys.has(idempotencyKey)) return false;
      globalIdempotencyKeys.add(idempotencyKey);
      itemLinks.set(item.id, {
        authorization,
        item,
        provider: authorization.providerBindings[itemIndex]!.provider,
        idempotencyKey,
      });
    }
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex]!;
      if (item.requestPlan.kind !== 'after_take_selection') continue;
      const dependency = item.requestPlan.dependency;
      if (dependency.kind === 'existing_predecessor') continue;
      const upstreamPosition = itemPositions.get(dependency.upstreamItemId);
      const upstream = items[upstreamPosition ?? -1];
      if (upstreamPosition === undefined || upstreamPosition >= itemIndex || upstream === undefined) return false;
      if (dependency.kind === 'authorized_seed') {
        if (
          upstream.purpose !== 'seed_still' ||
          upstream.target.kind !== 'shot' ||
          upstream.target.shotId !== dependency.shotId ||
          item.target.kind !== 'shot' ||
          item.target.shotId !== dependency.shotId
        ) {
          return false;
        }
      } else {
        if (
          upstream.purpose !== 'video_take' ||
          upstream.target.kind !== 'shot' ||
          upstream.target.shotId !== dependency.predecessorShotId ||
          item.target.kind !== 'shot' ||
          shotOwners.get(upstream.target.shotId) !== shotOwners.get(item.target.shotId)
        ) {
          return false;
        }
      }
    }
  }

  const jobsByLogicalEntry = new Map<string, StudioJobV2>();
  const jobsByItemId = new Map<string, StudioJobV2[]>();
  for (const job of Object.values(project.jobs)) {
    const link = itemLinks.get(job.authorizationItemId);
    if (
      link === undefined ||
      link.authorization.id !== job.authorizationId ||
      studioGenerationTargetKey(link.item.target) !== studioGenerationTargetKey(job.target) ||
      link.item.purpose !== job.purpose ||
      !requestPlansEqual(link.item.requestPlan, job.requestPlan) ||
      !providersEqual(link.provider, job.provider) ||
      link.idempotencyKey !== job.idempotencyKey
    ) {
      return false;
    }
    if (job.target.kind === 'reference' && !Object.hasOwn(project.references, job.target.referenceId)) {
      return false;
    }
    const logicalEntry = `${job.authorizationId}\0${job.authorizationItemId}`;
    if (jobsByLogicalEntry.has(logicalEntry)) return false;
    jobsByLogicalEntry.set(logicalEntry, job);
    const itemJobs = jobsByItemId.get(job.authorizationItemId) ?? [];
    itemJobs.push(job);
    jobsByItemId.set(job.authorizationItemId, itemJobs);

    const plan = job.requestPlan;
    if (plan.kind === 'resolved') {
      if (
        job.requestSnapshot === null ||
        !requestSnapshotsEqual(plan.snapshot, job.requestSnapshot) ||
        job.status === 'waiting_for_conditioning' ||
        job.error?.code === 'dependency_failed'
      ) {
        return false;
      }
    } else if (job.requestSnapshot !== null) {
      if (
        !requestNonConditioningFieldsEqual(plan.template, job.requestSnapshot) ||
        job.requestSnapshot.conditioningInput === null
      ) {
        return false;
      }
    } else {
      const isWaiting = job.status === 'waiting_for_conditioning' && job.error === null;
      const isDependencyFailed = job.status === 'failed' && job.error?.code === 'dependency_failed';
      const isPrebindCancelled = job.status === 'cancelled';
      if ((!isWaiting && !isDependencyFailed && !isPrebindCancelled) || hasProviderAttempt(job) || !hasNoOutput(job)) {
        return false;
      }
      if (
        isWaiting &&
        plan.dependency.kind === 'existing_predecessor' &&
        (job.target.kind !== 'shot' || !isCurrentExistingPredecessor(plan.dependency, job.target.shotId))
      ) {
        return false;
      }
    }

    const references = requestReferences(job);
    const producedReferenceAssetIds = references.map((reference) => reference.assetId);
    for (const outputAssetId of job.outputAssetIds) {
      const output = ownValue(project.assets, outputAssetId);
      if (
        output === undefined ||
        output.generationReferenceAssetIds.length !== producedReferenceAssetIds.length ||
        output.generationReferenceAssetIds.some((assetId, index) => assetId !== producedReferenceAssetIds[index])
      ) {
        return false;
      }
    }
    for (const reference of references) {
      const source = ownValue(project.assets, reference.assetId);
      const projectReference = ownValue(project.references, reference.referenceId);
      const projectReferenceAuthority =
        projectReference?.approvedAssetId === reference.assetId ||
        projectReference?.supersededAssetIds.includes(reference.assetId) === true;
      if (!projectReferenceAuthority) return false;
      if (
        projectReference?.kind !== reference.kind ||
        source === undefined ||
        source.projectId !== project.id ||
        source.shotId !== null ||
        source.mediaKind !== 'image' ||
        source.managedAsset.collection !== 'assets' ||
        source.projectReferenceId !== reference.referenceId ||
        source.sha256 !== reference.sha256
      ) {
        return false;
      }
    }
    if (job.requestSnapshot !== null) {
      const conditioning = job.requestSnapshot.conditioningInput;
      if (plan.kind === 'after_take_selection') {
        const dependency = plan.dependency;
        if (dependency.kind === 'authorized_seed') {
          const producer =
            conditioning?.kind === 'seed_still' ? outputProducerByAssetId.get(conditioning.assetId) : undefined;
          if (
            conditioning?.kind !== 'seed_still' ||
            producer?.authorizationId !== job.authorizationId ||
            producer.authorizationItemId !== dependency.upstreamItemId
          ) {
            return false;
          }
        } else if (dependency.kind === 'authorized_predecessor') {
          const producer =
            conditioning?.kind === 'predecessor_frame'
              ? outputProducerByAssetId.get(conditioning.takeAssetId)
              : undefined;
          if (
            conditioning?.kind !== 'predecessor_frame' ||
            conditioning.predecessorShotId !== dependency.predecessorShotId ||
            producer?.authorizationId !== job.authorizationId ||
            producer.authorizationItemId !== dependency.upstreamItemId
          ) {
            return false;
          }
        } else if (
          conditioning?.kind !== 'predecessor_frame' ||
          conditioning.predecessorShotId !== dependency.predecessorShotId ||
          conditioning.takeAssetId !== dependency.takeAssetId ||
          !Object.is(conditioning.endpointSeconds, dependency.endpointSeconds)
        ) {
          return false;
        }
      }
      if (conditioning?.kind === 'seed_still') {
        if (
          job.target.kind !== 'shot' ||
          !isCanonicalSeedSelection(ownValue(project.assets, conditioning.assetId), job.target.shotId)
        ) {
          return false;
        }
      } else if (conditioning?.kind === 'predecessor_frame') {
        const take = ownValue(project.assets, conditioning.takeAssetId);
        const frame = ownValue(project.assets, conditioning.frameAssetId);
        const extraction = frameByAssetId.get(conditioning.frameAssetId);
        if (
          !isCanonicalVideoTake(take, conditioning.predecessorShotId) ||
          frame === undefined ||
          frame.shotId !== conditioning.predecessorShotId ||
          frame.mediaKind !== 'image' ||
          frame.managedAsset.collection !== 'conditioningFrames' ||
          extraction?.status !== 'ready' ||
          extraction.shotId !== conditioning.predecessorShotId ||
          extraction.videoAssetId !== conditioning.takeAssetId ||
          extraction.endpointSeconds !== conditioning.endpointSeconds ||
          extraction.frameAssetId !== conditioning.frameAssetId ||
          ((plan.kind !== 'after_take_selection' || plan.dependency.kind !== 'existing_predecessor') &&
            (job.target.kind !== 'shot' ||
              shotOwners.get(conditioning.predecessorShotId) !== shotOwners.get(job.target.shotId)))
        ) {
          return false;
        }
      }
    }

    const seedStillVariationGridFailure = job.status === 'failed' && job.error?.code === 'seed_still_variation_grid';
    if (
      job.error?.code === 'seed_still_variation_grid' &&
      (!seedStillVariationGridFailure || job.purpose !== 'seed_still')
    ) {
      return false;
    }
    const receiptRequired =
      job.status === 'succeeded' ||
      (job.status === 'failed' &&
        (job.error?.code === 'no_output' || seedStillVariationGridFailure || job.error?.code === 'download_failed'));
    const receiptAllowed = receiptRequired || job.status === 'running';
    if (
      (receiptRequired && job.spendReceipt === null) ||
      (!receiptAllowed && job.spendReceipt !== null) ||
      (job.spendReceipt !== null && !validateReceiptAgainstJob(job, link.item, link.authorization))
    ) {
      return false;
    }
  }

  for (const link of itemLinks.values()) {
    const jobs = jobsByItemId.get(link.item.id);
    if (jobs === undefined || jobs.length !== 1) return false;
    const logicalEntry = `${link.authorization.id}\0${link.item.id}`;
    if (!jobsByLogicalEntry.has(logicalEntry)) return false;
    if (!jobs.every((job) => requestPlansEqual(job.requestPlan, link.item.requestPlan))) return false;
    if (link.item.requestPlan.kind === 'after_take_selection') {
      const concreteJobs = jobs.filter((job) => job.requestSnapshot !== null);
      const nonCancelledJobs = jobs.filter((job) => job.status !== 'cancelled');
      if (concreteJobs.length > 0) {
        const concrete = concreteJobs[0]!.requestSnapshot;
        if (
          nonCancelledJobs.some(
            (job) =>
              job.requestSnapshot === null ||
              job.status === 'waiting_for_conditioning' ||
              job.error?.code === 'dependency_failed' ||
              !requestSnapshotsEqual(job.requestSnapshot, concrete)
          ) ||
          concreteJobs.some((job) => !requestSnapshotsEqual(job.requestSnapshot, concrete)) ||
          jobs.some((job) => job.requestSnapshot === null && hasProviderAttempt(job))
        ) {
          return false;
        }
      } else {
        const liveCategories = new Set(
          nonCancelledJobs.map((job) =>
            job.status === 'waiting_for_conditioning'
              ? 'waiting'
              : job.error?.code === 'dependency_failed'
                ? 'failed'
                : 'other'
          )
        );
        if (liveCategories.has('other') || liveCategories.size > 1) return false;
      }
    }
  }
  if (jobsByLogicalEntry.size !== Object.keys(project.jobs).length) return false;

  const liveProjectReferenceIds = new Set<string>();
  for (const job of Object.values(project.jobs)) {
    if (job.target.kind !== 'reference' || isTerminalJob(job)) continue;
    if (liveProjectReferenceIds.has(job.target.referenceId)) return false;
    liveProjectReferenceIds.add(job.target.referenceId);
  }

  for (const link of itemLinks.values()) {
    const jobs = jobsByItemId.get(link.item.id)!;
    if (!jobs.some((job) => !isTerminalJob(job))) continue;
    for (const otherLink of itemLinks.values()) {
      if (otherLink.item.id === link.item.id) continue;
      if (
        studioGenerationTargetKey(otherLink.item.target) !== studioGenerationTargetKey(link.item.target) ||
        otherLink.item.purpose !== link.item.purpose
      ) {
        continue;
      }
      if (jobsByItemId.get(otherLink.item.id)?.some((job) => !isTerminalJob(job))) return false;
    }
  }

  for (const link of itemLinks.values()) {
    if (link.item.requestPlan.kind !== 'after_take_selection') continue;
    const dependency = link.item.requestPlan.dependency;
    if (dependency.kind === 'existing_predecessor') continue;
    const upstreamJobs = jobsByItemId.get(dependency.upstreamItemId);
    if (upstreamJobs === undefined) return false;
    const upstreamHasNonterminalJob = upstreamJobs.some((upstreamJob) => !isTerminalJob(upstreamJob));
    const upstreamHasCanonicalPrimary = upstreamJobs.some(
      (upstreamJob) =>
        upstreamJob.status === 'succeeded' &&
        upstreamJob.target.kind === 'shot' &&
        upstreamJob.outputAssetIdsByRole.primary !== null &&
        isCanonicalPrimary(
          ownValue(project.assets, upstreamJob.outputAssetIdsByRole.primary),
          upstreamJob.target.shotId,
          upstreamJob.purpose
        )
    );
    for (const job of jobsByItemId.get(link.item.id) ?? []) {
      if (job.requestSnapshot !== null || job.status === 'cancelled') continue;
      const dependencyIsExhausted = !upstreamHasNonterminalJob && !upstreamHasCanonicalPrimary;
      if (
        (job.error?.code === 'dependency_failed' && !dependencyIsExhausted) ||
        (job.status === 'waiting_for_conditioning' && dependencyIsExhausted)
      ) {
        return false;
      }
    }
  }

  const isReferenceOutput = (referenceId: string, assetId: string): boolean => {
    const producer = outputProducerByAssetId.get(assetId);
    return (
      producer?.status === 'succeeded' &&
      producer.purpose === 'reference_image' &&
      producer.target.kind === 'reference' &&
      producer.target.referenceId === referenceId &&
      producer.outputAssetIdsByRole.primary === assetId
    );
  };
  for (const referenceId of project.referenceOrder) {
    const reference = ownValue(project.references, referenceId)!;
    let previousCreatedAt = '';
    for (const jobId of reference.jobIds) {
      const job = ownValue(project.jobs, jobId);
      if (
        job === undefined ||
        job.target.kind !== 'reference' ||
        job.target.referenceId !== referenceId ||
        job.purpose !== 'reference_image' ||
        job.createdAt < previousCreatedAt
      ) {
        return false;
      }
      previousCreatedAt = job.createdAt;
    }
    if (
      Object.values(project.jobs).some(
        (job) =>
          job.target.kind === 'reference' &&
          job.target.referenceId === referenceId &&
          !reference.jobIds.includes(job.id)
      )
    ) {
      return false;
    }
    if (
      (reference.approvedAssetId !== null && !isReferenceOutput(referenceId, reference.approvedAssetId)) ||
      reference.supersededAssetIds.some((assetId) => !isReferenceOutput(referenceId, assetId))
    ) {
      return false;
    }
  }

  for (const shotId of inactiveShotIds) {
    const shot = ownValue(project.shots, shotId);
    if (shot === undefined) return false;
    if (shot.jobIds.some((jobId) => !isTerminalJob(ownValue(project.jobs, jobId)!))) return false;
    if (
      Object.values(project.frameExtractions).some(
        (frame) => frame.shotId === shotId && (frame.status === 'pending' || frame.status === 'extracting')
      )
    ) {
      return false;
    }
    const ownedAssets = new Set(shot.assetIds);
    for (const job of Object.values(project.jobs)) {
      if (isTerminalJob(job)) continue;
      const conditioning = job.requestSnapshot?.conditioningInput;
      if (
        (conditioning?.kind === 'seed_still' && ownedAssets.has(conditioning.assetId)) ||
        (conditioning?.kind === 'predecessor_frame' &&
          (conditioning.predecessorShotId === shotId ||
            ownedAssets.has(conditioning.takeAssetId) ||
            ownedAssets.has(conditioning.frameAssetId)))
      ) {
        return false;
      }
      if (job.requestPlan.kind === 'after_take_selection') {
        const dependency = job.requestPlan.dependency;
        if (dependency.kind === 'existing_predecessor') {
          if (job.requestSnapshot === null && !isTerminalJob(job) && dependency.predecessorShotId === shotId) {
            return false;
          }
        } else {
          const upstream = itemLinks.get(dependency.upstreamItemId)?.item;
          if (upstream?.target.kind === 'shot' && upstream.target.shotId === shotId) return false;
        }
      }
    }
  }

  return true;
};
