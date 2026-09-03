/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';
import {
  isValidProviderJobId,
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V4,
  STUDIO_BIN_BLOCKING_JOB_STATUSES_V4,
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V4,
  STUDIO_BOARD_STYLES_V2,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_ASSETS_V3,
  STUDIO_MAX_ASSETS_V4,
  STUDIO_MAX_ASSET_HISTORY_ENTRIES_PER_PIECE_V4,
  STUDIO_MAX_ASSEMBLIES_V4,
  STUDIO_MAX_BEATS_PER_BOARD_V4,
  STUDIO_MAX_BIN_ENTRIES_V4,
  STUDIO_MAX_BOARDS_V4,
  STUDIO_MAX_EXPORT_DIRECTORY_DEPTH,
  STUDIO_MAX_FRAME_EXTRACTIONS_V4,
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V4,
  STUDIO_MAX_VIDEO_ASSET_BYTES_V4,
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_JOBS_V3,
  STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3,
  STUDIO_MAX_PIECES_V3,
  STUDIO_MAX_PIECE_PRIOR_HANDLES_V3,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_SHOTS_PER_BOARD_V4,
  STUDIO_MAX_SOUND_BINDINGS_PER_ASSEMBLY_V4,
  STUDIO_MAX_SPEND_AUTHORIZATIONS_V3,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MAX_UNDO_ENTRIES,
  STUDIO_MAX_UNDO_ENTRIES_V3,
  STUDIO_MAX_UNDO_LABEL_LENGTH,
  STUDIO_MAX_UNDO_PATCHES_PER_ENTRY,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION_V3,
  STUDIO_PROJECT_SCHEMA_VERSION_V4,
  STUDIO_PIECE_PUBLICATION_INTENT_SCHEMA_VERSION_V4,
  STUDIO_EXPORT_SCHEMA_VERSION_V3,
  STUDIO_EXPORT_SCHEMA_VERSION_V4,
  isStudioProjectIdV4,
  type StudioAssetV2,
  type StudioAssetV3,
  type StudioAssetV4,
  type StudioAssemblyPictureBindingV2,
  type StudioAssemblyV2,
  type StudioBeat,
  type StudioBinItem,
  type StudioBoardBeatV4,
  type StudioBoardShotV4,
  type StudioBoardV2,
  type StudioCanvasBinEntryV4,
  type StudioCanvasBinSubjectV4,
  type StudioDerivedFrameAssetV4,
  type StudioFrameExtractionV4,
  type StudioGenerationCompositionInputSnapshotV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioJobV2,
  type StudioJobPurpose,
  type StudioPieceGenerationCompositionV3,
  type StudioPieceGenerationCompositionV4,
  type StudioPieceFirstFrameSnapshotV4,
  type StudioPieceMotionGenerationRequestPlanV4,
  type StudioPieceMotionGenerationRequestSnapshotV4,
  type StudioPieceConditioningInputSnapshotV3,
  type StudioPieceConditioningInputSnapshotV4,
  type StudioPieceGenerationRequestPlanV3,
  type StudioPieceGenerationRequestPlanV4,
  type StudioPieceGenerationTargetV3,
  type StudioPieceGenerationTargetV4,
  type StudioPieceJobRetryReasonV3,
  type StudioPieceJobV3,
  type StudioPieceJobV4,
  type StudioPieceAssetTombstoneV4,
  type StudioPieceCurrentAssetSnapshotV4,
  type StudioPieceGenerationAttemptV4,
  type StudioPiecePublicationIntentV4,
  type StudioPieceSpendReceiptV3,
  type StudioPieceSpendReceiptV4,
  type StudioPieceSpendAuthorizationV3,
  type StudioPieceSpendAuthorizationV4,
  type StudioPieceSubmissionQuoteV3,
  type StudioPieceSubmissionQuoteV4,
  type StudioPieceExportManifestV3,
  type StudioPieceExportManifestV4,
  type StudioPieceV2,
  type StudioProjectReferenceV2,
  type StudioProjectV2,
  type StudioProjectV3,
  type StudioProjectV4,
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
  createStudioPieceQuotedGenerationIdV3,
  createStudioQuotedGenerationId,
  isStudioPieceInstructionProfileV3,
  studioGenerationTargetKey,
  STUDIO_BOARD_REQUEST_DURATION_SECONDS,
} from './generation';
import { STUDIO_FIXED_SHOT_REASON_ORDER_V2 } from './mutations/fixedShots';
import { isCanonicalStudioPieceHandleV3 } from './mutations/pieceHandles';
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
  'attemptCount',
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

  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
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
    !isDenseArray(value.reasons, STUDIO_FIXED_SHOT_REASON_ORDER_V2.length) ||
    value.reasons.length === 0
  ) {
    return false;
  }
  let priorReasonIndex = -1;
  for (let index = 0; index < value.reasons.length; index += 1) {
    const reasonIndex = STUDIO_FIXED_SHOT_REASON_ORDER_V2.indexOf(
      value.reasons[index] as (typeof STUDIO_FIXED_SHOT_REASON_ORDER_V2)[number]
    );
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
      (value.managedAsset.collection !== 'assets' && value.managedAsset.collection !== 'imports')
    ) {
      return false;
    }
    if (
      value.managedAsset.collection === 'imports' &&
      (value.producerJobId !== null ||
        value.compositionDigest !== null ||
        value.generationReferenceAssetIds.length !== 0)
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
  // The prompt is an immutable record of what was reviewed and sent. Re-deriving it with today's
  // composer would make any instruction-text improvement retroactively invalidate durable history.
  // Exact quote/plan/snapshot/job equality below remains the integrity boundary for persisted bytes.
  return semanticShapeIsValid;
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
      value.retryReason === 'submission_unknown' ||
      value.retryReason === 'variation_grid') &&
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
    !isIntegerInRange(value.generationCount, 1, 2) ||
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
  if (value.generationCount !== 1 && value.purpose !== 'reference_image') return false;
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
      !providersEqual(composition.inputs.route, binding.provider)
    ) {
      return false;
    }
  }
  const expectedIdempotencyItemIds = items.flatMap((item) =>
    Array.from({ length: (item as StudioQuotedGeneration).generationCount }, () => (item as StudioQuotedGeneration).id)
  );
  if (
    !isDenseArray(value.idempotencyKeys, STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST * 2) ||
    value.idempotencyKeys.length !== expectedIdempotencyItemIds.length
  ) {
    return false;
  }
  const keys = new Set<string>();
  for (let entryIndex = 0; entryIndex < expectedIdempotencyItemIds.length; entryIndex += 1) {
    const entry = value.idempotencyKeys[entryIndex];
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, IDEMPOTENCY_ENTRY_KEYS) ||
      entry.itemId !== expectedIdempotencyItemIds[entryIndex] ||
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
    (value.errorCode !== null && (typeof value.errorCode !== 'string' || !FRAME_ERROR_CODES.has(value.errorCode))) ||
    !isIntegerInRange(value.attemptCount, 0, 3)
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
  if (value.status === 'ready') {
    return value.frameAssetId !== null && value.errorCode === null && (value.attemptCount as number) >= 1;
  }
  if (value.status === 'failed') {
    return value.frameAssetId === null && value.errorCode !== null && (value.attemptCount as number) >= 1;
  }
  if (value.status === 'extracting') {
    return value.frameAssetId === null && value.errorCode === null && (value.attemptCount as number) >= 1;
  }
  return value.frameAssetId === null && value.errorCode === null && (value.attemptCount as number) < 3;
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
    receipt.generationCount === 1 &&
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
    // A semantic Shot binding survives removal of its last current reference photo. Resolution and
    // quote preparation still fail closed on the missing approval; retaining the IDs lets a later
    // human-approved photo restore the exact binding instead of silently rewriting Shot intent.
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
    if (asset.shotId === null) {
      if (
        asset.mediaKind === 'image' &&
        asset.managedAsset.collection === 'imports' &&
        (asset.projectReferenceId === null ||
          !Object.hasOwn(project.references, asset.projectReferenceId) ||
          asset.producerJobId !== null ||
          asset.compositionDigest !== null ||
          asset.generationReferenceAssetIds.length !== 0 ||
          outputProducerByAssetId.has(asset.id))
      ) {
        return false;
      }
      continue;
    }
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
    const expectedVideoAssetId = successfulVideoAssetIds.at(-1) ?? null;
    const expectedSupersededVideoAssetIds = successfulVideoAssetIds.slice(0, -1);
    if (
      shot.videoAssetId !== expectedVideoAssetId ||
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
    if (job.retryReason === 'variation_grid') {
      if (
        !isExactProjectReferenceRetry ||
        predecessor.status !== 'failed' ||
        predecessor.error?.code !== 'seed_still_variation_grid' ||
        predecessor.authorizationId !== job.authorizationId ||
        predecessor.authorizationItemId !== job.authorizationItemId ||
        job.duplicateChargeAcknowledged
      ) {
        return false;
      }
    } else if (job.retryReason === 'submission_unknown') {
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
    idempotencyKeys: string[];
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
      const idempotencyKeys = authorization.idempotencyKeys
        .filter((entry) => entry.itemId === item.id)
        .map((entry) => entry.key);
      if (idempotencyKeys.length !== item.generationCount) return false;
      for (const idempotencyKey of idempotencyKeys) {
        if (globalIdempotencyKeys.has(idempotencyKey)) return false;
        globalIdempotencyKeys.add(idempotencyKey);
      }
      itemLinks.set(item.id, {
        authorization,
        item,
        provider: authorization.providerBindings[itemIndex]!.provider,
        idempotencyKeys,
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
      !link.idempotencyKeys.includes(job.idempotencyKey)
    ) {
      return false;
    }
    if (job.target.kind === 'reference' && !Object.hasOwn(project.references, job.target.referenceId)) {
      return false;
    }
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
      const producer = outputProducerByAssetId.get(reference.assetId);
      const importedReferenceSource =
        source?.managedAsset.collection === 'imports' &&
        source.producerJobId === null &&
        source.compositionDigest === null &&
        source.generationReferenceAssetIds.length === 0;
      const projectReferenceAuthority =
        projectReference?.approvedAssetId === reference.assetId ||
        projectReference?.supersededAssetIds.includes(reference.assetId) === true ||
        (isTerminalJob(job) &&
          ((producer?.status === 'succeeded' &&
            producer.purpose === 'reference_image' &&
            producer.target.kind === 'reference' &&
            producer.target.referenceId === reference.referenceId &&
            producer.outputAssetIdsByRole.primary === reference.assetId &&
            projectReference?.jobIds.includes(producer.id) === true) ||
            importedReferenceSource));
      if (!projectReferenceAuthority) return false;
      if (
        projectReference?.kind !== reference.kind ||
        source === undefined ||
        source.projectId !== project.id ||
        source.shotId !== null ||
        source.mediaKind !== 'image' ||
        (source.managedAsset.collection !== 'assets' && source.managedAsset.collection !== 'imports') ||
        (source.managedAsset.collection === 'imports' && !importedReferenceSource) ||
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

    const variationGridFailure = job.status === 'failed' && job.error?.code === 'seed_still_variation_grid';
    if (
      job.error?.code === 'seed_still_variation_grid' &&
      (!variationGridFailure || (job.purpose !== 'seed_still' && job.purpose !== 'reference_image'))
    ) {
      return false;
    }
    const receiptRequired =
      job.status === 'succeeded' ||
      (job.status === 'failed' &&
        (job.error?.code === 'no_output' || variationGridFailure || job.error?.code === 'download_failed'));
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
    if (jobs === undefined || jobs.length < 1 || jobs.length > link.item.generationCount) return false;
    const jobsByAttempt = link.idempotencyKeys.map((idempotencyKey) =>
      jobs.find((job) => job.idempotencyKey === idempotencyKey)
    );
    const firstAttempt = jobsByAttempt[0];
    if (firstAttempt === undefined || jobsByAttempt.slice(0, jobs.length).some((job) => job === undefined)) {
      return false;
    }
    if (jobsByAttempt.slice(jobs.length).some((job) => job !== undefined)) return false;
    if (link.item.generationCount === 2) {
      if (link.item.purpose !== 'reference_image' || link.item.target.kind !== 'reference') return false;
      const secondAttempt = jobsByAttempt[1];
      const firstAttemptGridFailed =
        firstAttempt.status === 'failed' && firstAttempt.error?.code === 'seed_still_variation_grid';
      if (
        (firstAttemptGridFailed && secondAttempt === undefined) ||
        (!firstAttemptGridFailed && secondAttempt !== undefined) ||
        (secondAttempt !== undefined &&
          (secondAttempt.retryOfJobId !== firstAttempt.id || secondAttempt.retryReason !== 'variation_grid'))
      ) {
        return false;
      }
    }
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
  if ([...jobsByItemId.values()].reduce((total, jobs) => total + jobs.length, 0) !== Object.keys(project.jobs).length) {
    return false;
  }

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

  const isCanonicalReferenceAsset = (referenceId: string, assetId: string): boolean => {
    const asset = ownValue(project.assets, assetId);
    if (
      asset?.projectId !== project.id ||
      asset.shotId !== null ||
      asset.projectReferenceId !== referenceId ||
      asset.mediaKind !== 'image'
    ) {
      return false;
    }
    if (asset.managedAsset.collection === 'imports') {
      return (
        asset.producerJobId === null &&
        asset.compositionDigest === null &&
        asset.generationReferenceAssetIds.length === 0
      );
    }
    if (asset.managedAsset.collection !== 'assets') return false;
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
      (reference.approvedAssetId !== null && !isCanonicalReferenceAsset(referenceId, reference.approvedAssetId)) ||
      reference.supersededAssetIds.some((assetId) => !isCanonicalReferenceAsset(referenceId, assetId))
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

const PROJECT_KEYS_V3 = new Set([
  'schemaVersion',
  'revision',
  'authoringRevision',
  'id',
  'name',
  'brief',
  'rules',
  'forgeProjectId',
  'briefConversationId',
  'pieceOrder',
  'pieces',
  'spendPolicy',
  'spendAuthorizations',
  'undoHistory',
  'assets',
  'jobs',
  'createdAt',
  'updatedAt',
]);
const PIECE_KEYS_V3 = new Set([
  'id',
  'kind',
  'handle',
  'priorHandles',
  'currentAssetId',
  'jobIds',
  'createdAt',
  'updatedAt',
]);
const ASSET_KEYS_V3 = new Set([
  'id',
  'projectId',
  'pieceId',
  'mediaKind',
  'mimeType',
  'managedAsset',
  'byteSize',
  'sha256',
  'width',
  'height',
  'createdAt',
  'origin',
  'producerJobId',
  'compositionDigest',
]);
const MANAGED_ASSET_KEYS_V3 = new Set(['collection', 'fileName']);
const PHOTO_SETTINGS_KEYS_V3 = new Set(['aspectRatio', 'resolution']);
const PIECE_TARGET_KEYS_V3 = new Set(['kind', 'pieceId']);
const PIECE_SOURCE_KEYS_V3 = new Set(['kind', 'pieceId', 'words', 'settings']);
const PIECE_CONDITIONING_INPUT_KEYS_V3 = new Set(['pieceId', 'assetId', 'sha256', 'mimeType', 'byteSize']);
const COMPOSITION_KEYS_V3 = new Set(['inputs', 'prompt']);
const COMPOSITION_INPUT_KEYS_V3 = new Set([
  'schemaVersion',
  'projectRevisionAtPreparation',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'brief',
  'rules',
  'source',
  'purpose',
  'conditioningInputs',
  'route',
  'instructionProfile',
]);
const REQUEST_PLAN_KEYS_V3 = new Set(['kind', 'snapshot']);
const REQUEST_SNAPSHOT_KEYS_V3 = new Set(['composition', 'settings', 'conditioningInputs']);
const QUOTED_ITEM_KEYS_V3 = new Set([
  'id',
  'target',
  'purpose',
  'routeId',
  'generationCount',
  'requestPlan',
  'rateUnit',
  'rateMinorUnits',
]);
const QUOTE_KEYS_V3 = new Set([
  'id',
  'reservationId',
  'quoteRevision',
  'projectId',
  'projectRevisionAtPreparation',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'rateCardDigest',
  'currency',
  'item',
  'lowerMinorUnits',
  'upperMinorUnits',
  'expiresAt',
]);
const AUTHORIZATION_KEYS_V3 = new Set([
  'id',
  'quote',
  'confirmedAt',
  'projectRevisionAtAuthorization',
  'cancellationPolicy',
  'providerBinding',
  'idempotencyKey',
]);
const SINGLE_PROVIDER_BINDING_KEYS_V3 = new Set(['itemId', 'provider']);
const SINGLE_IDEMPOTENCY_KEY_KEYS_V3 = new Set(['itemId', 'key']);
const RECEIPT_KEYS_V3 = new Set([
  'authorizationId',
  'quoteId',
  'quoteRevision',
  'itemId',
  'jobId',
  'purpose',
  'routeId',
  'currency',
  'rateUnit',
  'rateMinorUnits',
  'generationCount',
  'totalMinorUnits',
  'recordedAt',
]);
const JOB_KEYS_V3 = new Set([
  'id',
  'projectId',
  'target',
  'purpose',
  'status',
  'provider',
  'idempotencyKey',
  'providerSubmissionKind',
  'providerJobId',
  'remoteStartedAt',
  'cancellationPolicy',
  'outputAssetId',
  'error',
  'progress',
  'retryOfJobId',
  'retryReason',
  'duplicateChargeAcknowledged',
  'duplicateChargeAcknowledgedAt',
  'authorizationId',
  'authorizationItemId',
  'composition',
  'requestPlan',
  'spendReceipt',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'projectRevisionAtPreparation',
  'projectRevisionAtAuthorization',
  'createdAt',
  'updatedAt',
]);
const FILL_EMPTY_PUBLICATION_KEYS_V4 = new Set(['schemaVersion', 'kind']);
const REPLACE_CURRENT_PUBLICATION_KEYS_V4 = new Set(['schemaVersion', 'kind', 'currentAsset']);
const FIRST_ATTEMPT_KEYS_V4 = new Set(['kind']);
const RETRY_ATTEMPT_KEYS_V4 = new Set(['kind', 'sourceJobId', 'reason']);
const UNDO_ENTRY_KEYS_V3 = new Set(['id', 'sourceRevision', 'sourceAuthoringRevision', 'label', 'patches']);
const PIECE_CATALOG_PATCH_KEYS_V3 = new Set(['kind', 'pieceId', 'before', 'afterDigest']);
const PIECE_CATALOG_PATCH_BEFORE_KEYS_V3 = new Set(['handle', 'priorHandles']);
const PIECE_JOB_STATUSES_V3 = new Set<StudioPieceJobV3['status']>([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
  'succeeded',
  'failed',
  'cancelled',
]);
const PIECE_JOB_ERROR_CODES_V3 = new Set([
  'invalid_request',
  'content_rejected',
  'auth',
  'quota',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'poll_deadline',
  'no_output',
  'variation_grid',
  'submission_unknown',
  'download_failed',
  'unsupported',
  'unknown',
]);
const ACTIVE_PIECE_JOB_STATUSES_V3 = new Set<StudioPieceJobV3['status']>([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);
const PIECE_JOB_STATUSES_V4 = new Set<StudioPieceJobV4['status']>([
  ...PIECE_JOB_STATUSES_V3,
  'waiting_for_conditioning',
]);
const ACTIVE_PIECE_JOB_STATUSES_V4 = new Set<StudioPieceJobV4['status']>([
  ...ACTIVE_PIECE_JOB_STATUSES_V3,
  'waiting_for_conditioning',
]);
const NONTERMINAL_PIECE_JOB_STATUSES_V4 = new Set<StudioPieceJobV4['status']>([
  ...ACTIVE_PIECE_JOB_STATUSES_V4,
  'needs_attention',
]);
const LIVE_TOPOLOGY_PIECE_JOB_STATUSES_V4 = NONTERMINAL_PIECE_JOB_STATUSES_V4;

const isCanonicalPieceWordsV3 = (value: unknown): value is string =>
  isNonEmptyStringWithin(value, STUDIO_MAX_GENERATION_PROMPT_LENGTH) &&
  value === value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

const canonicalJsonV3 = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV3).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonV3(record[key])}`)
    .join(',')}}`;
};

const canonicalValuesEqualV3 = (left: unknown, right: unknown): boolean =>
  canonicalJsonV3(left) === canonicalJsonV3(right);

const pieceCompositionDigestV3 = (value: StudioPieceGenerationCompositionV3): string =>
  createHash('sha256').update(canonicalJsonV3(value), 'utf8').digest('hex');

const validatePiecePhotoSettingsV3 = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PHOTO_SETTINGS_KEYS_V3) &&
  typeof value.aspectRatio === 'string' &&
  ASPECT_RATIOS.has(value.aspectRatio) &&
  typeof value.resolution === 'string' &&
  RESOLUTIONS.has(value.resolution);

const validatePieceTargetV3 = (value: unknown): boolean =>
  isRecord(value) && hasExactKeys(value, PIECE_TARGET_KEYS_V3) && value.kind === 'piece' && isSafeId(value.pieceId);

const validatePieceConditioningInputsV3 = (value: unknown): value is StudioPieceConditioningInputSnapshotV3[] => {
  if (!isDenseArray(value, STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3)) return false;
  const pieceIds = new Set<string>();
  const assetIds = new Set<string>();
  return value.every((input) => {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, PIECE_CONDITIONING_INPUT_KEYS_V3) ||
      !isSafeId(input.pieceId) ||
      !isSafeId(input.assetId) ||
      !isLowercaseDigest(input.sha256) ||
      !isStudioReferenceImageMimeType(input.mimeType) ||
      !isIntegerInRange(input.byteSize, 1, STUDIO_MAX_IMAGE_ASSET_BYTES_V3) ||
      pieceIds.has(input.pieceId) ||
      assetIds.has(input.assetId)
    ) {
      return false;
    }
    pieceIds.add(input.pieceId);
    assetIds.add(input.assetId);
    return true;
  });
};

const pieceConditioningInputsEqualV3 = (left: unknown, right: unknown): boolean =>
  validatePieceConditioningInputsV3(left) &&
  validatePieceConditioningInputsV3(right) &&
  left.length === right.length &&
  left.every((input, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      input.pieceId === candidate.pieceId &&
      input.assetId === candidate.assetId &&
      input.sha256 === candidate.sha256 &&
      input.mimeType === candidate.mimeType &&
      input.byteSize === candidate.byteSize
    );
  });

const validatePieceCompositionV3 = (value: unknown): value is StudioPieceGenerationCompositionV3 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, COMPOSITION_KEYS_V3) ||
    !isRecord(value.inputs) ||
    !hasExactKeys(value.inputs, COMPOSITION_INPUT_KEYS_V3)
  ) {
    return false;
  }
  const inputs = value.inputs;
  if (
    inputs.schemaVersion !== STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3 ||
    !isIntegerInRange(inputs.projectRevisionAtPreparation, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(inputs.authoringRevision, 1, Number.MAX_SAFE_INTEGER) ||
    (inputs.authoringRevision as number) > (inputs.projectRevisionAtPreparation as number) ||
    inputs.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V3 ||
    !isLowercaseDigest(inputs.authoringFingerprint) ||
    !isStringWithin(inputs.brief, 16 * 1024) ||
    !validateRules(inputs.rules) ||
    !isRecord(inputs.source) ||
    !hasExactKeys(inputs.source, PIECE_SOURCE_KEYS_V3) ||
    inputs.source.kind !== 'piece' ||
    !isSafeId(inputs.source.pieceId) ||
    !isCanonicalPieceWordsV3(inputs.source.words) ||
    !validatePiecePhotoSettingsV3(inputs.source.settings) ||
    inputs.purpose !== 'piece_image' ||
    !validatePieceConditioningInputsV3(inputs.conditioningInputs) ||
    !validateProvider(inputs.route) ||
    (inputs.route as StudioProviderRef).adapterId !== 'weprompt-image-v1' ||
    !isStudioPieceInstructionProfileV3(inputs.instructionProfile) ||
    !isNonEmptyStringWithin(value.prompt, STUDIO_MAX_GENERATION_PROMPT_LENGTH)
  ) {
    return false;
  }
  return true;
};

const photoSettingsEqualV3 = (left: unknown, right: unknown): boolean =>
  isRecord(left) && isRecord(right) && left.aspectRatio === right.aspectRatio && left.resolution === right.resolution;

const validatePieceRequestPlanV3 = (value: unknown): value is StudioPieceGenerationRequestPlanV3 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REQUEST_PLAN_KEYS_V3) ||
    value.kind !== 'resolved' ||
    !isRecord(value.snapshot) ||
    !hasExactKeys(value.snapshot, REQUEST_SNAPSHOT_KEYS_V3) ||
    !validatePieceCompositionV3(value.snapshot.composition) ||
    !validatePiecePhotoSettingsV3(value.snapshot.settings) ||
    !validatePieceConditioningInputsV3(value.snapshot.conditioningInputs)
  ) {
    return false;
  }
  return (
    photoSettingsEqualV3(value.snapshot.settings, value.snapshot.composition.inputs.source.settings) &&
    pieceConditioningInputsEqualV3(
      value.snapshot.composition.inputs.conditioningInputs,
      value.snapshot.conditioningInputs
    )
  );
};

const validatePieceQuotedGenerationV3 = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, QUOTED_ITEM_KEYS_V3) ||
    !isSafeId(value.id) ||
    !validatePieceTargetV3(value.target) ||
    value.purpose !== 'piece_image' ||
    !isSafeId(value.routeId) ||
    value.generationCount !== 1 ||
    !validatePieceRequestPlanV3(value.requestPlan) ||
    value.rateUnit !== 'generation' ||
    !isIntegerInRange(value.rateMinorUnits, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return false;
  }
  const target = value.target as Record<string, unknown>;
  const composition = (value.requestPlan as StudioPieceGenerationRequestPlanV3).snapshot.composition;
  return target.pieceId === composition.inputs.source.pieceId && value.purpose === composition.inputs.purpose;
};

const validatePieceQuoteV3 = (
  value: unknown,
  projectId: string,
  currentRevision: number,
  currentAuthoringRevision: number
): value is StudioPieceSubmissionQuoteV3 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, QUOTE_KEYS_V3) ||
    !isSafeId(value.id) ||
    !isSafeId(value.reservationId) ||
    !isIntegerInRange(value.quoteRevision, 1, Number.MAX_SAFE_INTEGER) ||
    value.projectId !== projectId ||
    !isIntegerInRange(value.projectRevisionAtPreparation, 1, currentRevision) ||
    !isIntegerInRange(value.authoringRevision, 1, currentAuthoringRevision) ||
    (value.authoringRevision as number) > (value.projectRevisionAtPreparation as number) ||
    value.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V3 ||
    !isLowercaseDigest(value.authoringFingerprint) ||
    !isLowercaseDigest(value.rateCardDigest) ||
    !isCurrency(value.currency) ||
    !validatePieceQuotedGenerationV3(value.item) ||
    !isIntegerInRange(value.lowerMinorUnits, 1, Number.MAX_SAFE_INTEGER) ||
    value.upperMinorUnits !== value.lowerMinorUnits ||
    !isCanonicalTimestamp(value.expiresAt)
  ) {
    return false;
  }
  const item = value.item as Record<string, unknown>;
  const requestPlan = item.requestPlan as StudioPieceGenerationRequestPlanV3;
  const inputs = requestPlan.snapshot.composition.inputs;
  return (
    item.id ===
      createStudioPieceQuotedGenerationIdV3({
        projectId: value.projectId,
        reservationId: value.reservationId,
        quoteId: value.id,
        quoteRevision: value.quoteRevision,
        target: item.target as StudioPieceGenerationTargetV3,
        purpose: 'piece_image',
      }) &&
    item.rateMinorUnits === value.lowerMinorUnits &&
    inputs.projectRevisionAtPreparation === value.projectRevisionAtPreparation &&
    inputs.authoringRevision === value.authoringRevision &&
    inputs.authoringFingerprintVersion === value.authoringFingerprintVersion &&
    inputs.authoringFingerprint === value.authoringFingerprint
  );
};

const validatePieceAuthorizationV3 = (
  value: unknown,
  project: StudioProjectV3
): value is StudioPieceSpendAuthorizationV3 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, AUTHORIZATION_KEYS_V3) ||
    !isSafeId(value.id) ||
    !validatePieceQuoteV3(value.quote, project.id, project.revision, project.authoringRevision) ||
    value.id === value.quote.id ||
    value.id === value.quote.item.id ||
    value.quote.id === value.quote.item.id ||
    !isCanonicalTimestamp(value.confirmedAt) ||
    !isIntegerInRange(value.projectRevisionAtAuthorization, 1, project.revision) ||
    (value.projectRevisionAtAuthorization as number) <= value.quote.projectRevisionAtPreparation ||
    value.confirmedAt >= value.quote.expiresAt ||
    (value.cancellationPolicy !== 'none' &&
      value.cancellationPolicy !== 'queued_only' &&
      value.cancellationPolicy !== 'queued_and_running') ||
    !isRecord(value.providerBinding) ||
    !hasExactKeys(value.providerBinding, SINGLE_PROVIDER_BINDING_KEYS_V3) ||
    value.providerBinding.itemId !== value.quote.item.id ||
    !validateProvider(value.providerBinding.provider) ||
    !isRecord(value.idempotencyKey) ||
    !hasExactKeys(value.idempotencyKey, SINGLE_IDEMPOTENCY_KEY_KEYS_V3) ||
    value.idempotencyKey.itemId !== value.quote.item.id ||
    !isSafeId(value.idempotencyKey.key)
  ) {
    return false;
  }
  return providersEqual(value.providerBinding.provider, value.quote.item.requestPlan.snapshot.composition.inputs.route);
};

const validatePieceReceiptV3 = (value: unknown): value is StudioPieceSpendReceiptV3 =>
  isRecord(value) &&
  hasExactKeys(value, RECEIPT_KEYS_V3) &&
  isSafeId(value.authorizationId) &&
  isSafeId(value.quoteId) &&
  isIntegerInRange(value.quoteRevision, 1, Number.MAX_SAFE_INTEGER) &&
  isSafeId(value.itemId) &&
  isSafeId(value.jobId) &&
  value.purpose === 'piece_image' &&
  isSafeId(value.routeId) &&
  isCurrency(value.currency) &&
  value.rateUnit === 'generation' &&
  isIntegerInRange(value.rateMinorUnits, 1, Number.MAX_SAFE_INTEGER) &&
  value.generationCount === 1 &&
  value.totalMinorUnits === value.rateMinorUnits &&
  isCanonicalTimestamp(value.recordedAt);

const validatePieceJobV3 = (jobId: string, projectId: string, value: unknown): value is StudioPieceJobV3 => {
  if (!isRecord(value) || !hasExactKeys(value, JOB_KEYS_V3)) return false;
  const errorIsValid =
    value.error === null ||
    (isRecord(value.error) &&
      hasExactKeys(value.error, JOB_ERROR_KEYS) &&
      typeof value.error.code === 'string' &&
      PIECE_JOB_ERROR_CODES_V3.has(value.error.code) &&
      isNonEmptyStringWithin(value.error.messageKey, 256));
  if (
    value.id !== jobId ||
    !isSafeId(jobId) ||
    value.projectId !== projectId ||
    !validatePieceTargetV3(value.target) ||
    value.purpose !== 'piece_image' ||
    typeof value.status !== 'string' ||
    !PIECE_JOB_STATUSES_V3.has(value.status as StudioPieceJobV3['status']) ||
    !validateProvider(value.provider) ||
    !isSafeId(value.idempotencyKey) ||
    (value.providerSubmissionKind !== null &&
      value.providerSubmissionKind !== 'complete' &&
      value.providerSubmissionKind !== 'remote') ||
    (value.providerJobId !== null &&
      (typeof value.providerJobId !== 'string' || !isValidProviderJobId(value.providerJobId))) ||
    (value.remoteStartedAt !== null && !isCanonicalTimestamp(value.remoteStartedAt)) ||
    (value.providerJobId === null) !== (value.remoteStartedAt === null) ||
    (value.cancellationPolicy !== 'none' &&
      value.cancellationPolicy !== 'queued_only' &&
      value.cancellationPolicy !== 'queued_and_running') ||
    !isNullableSafeId(value.outputAssetId) ||
    !errorIsValid ||
    (value.progress !== null && !isFiniteInRange(value.progress, 0, 100)) ||
    !isNullableSafeId(value.retryOfJobId) ||
    (value.retryReason !== null &&
      value.retryReason !== 'provider_failure' &&
      value.retryReason !== 'submission_unknown' &&
      value.retryReason !== 'variation_grid' &&
      value.retryReason !== 'cancelled') ||
    (value.retryOfJobId === null) !== (value.retryReason === null) ||
    typeof value.duplicateChargeAcknowledged !== 'boolean' ||
    (value.duplicateChargeAcknowledgedAt !== null && !isCanonicalTimestamp(value.duplicateChargeAcknowledgedAt)) ||
    (value.retryReason === 'submission_unknown'
      ? !value.duplicateChargeAcknowledged || value.duplicateChargeAcknowledgedAt === null
      : value.duplicateChargeAcknowledged || value.duplicateChargeAcknowledgedAt !== null) ||
    !isSafeId(value.authorizationId) ||
    !isSafeId(value.authorizationItemId) ||
    !validatePieceCompositionV3(value.composition) ||
    !validatePieceRequestPlanV3(value.requestPlan) ||
    !canonicalValuesEqualV3(value.requestPlan.snapshot.composition, value.composition) ||
    (value.spendReceipt !== null && !validatePieceReceiptV3(value.spendReceipt)) ||
    !isIntegerInRange(value.authoringRevision, 1, Number.MAX_SAFE_INTEGER) ||
    value.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V3 ||
    !isLowercaseDigest(value.authoringFingerprint) ||
    !isIntegerInRange(value.projectRevisionAtPreparation, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.projectRevisionAtAuthorization, 1, Number.MAX_SAFE_INTEGER) ||
    (value.projectRevisionAtAuthorization as number) <= (value.projectRevisionAtPreparation as number) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt
  ) {
    return false;
  }
  const target = value.target as Record<string, unknown>;
  const composition = value.composition as StudioPieceGenerationCompositionV3;
  if (
    target.pieceId !== composition.inputs.source.pieceId ||
    value.purpose !== composition.inputs.purpose ||
    !providersEqual(value.provider, composition.inputs.route) ||
    value.authoringRevision !== composition.inputs.authoringRevision ||
    value.authoringFingerprintVersion !== composition.inputs.authoringFingerprintVersion ||
    value.authoringFingerprint !== composition.inputs.authoringFingerprint ||
    value.projectRevisionAtPreparation !== composition.inputs.projectRevisionAtPreparation
  ) {
    return false;
  }
  const status = value.status as StudioPieceJobV3['status'];
  const errorCode = isRecord(value.error) && typeof value.error.code === 'string' ? value.error.code : null;
  if (status === 'needs_attention' && errorCode !== 'submission_unknown' && errorCode !== 'poll_deadline') {
    return false;
  }
  if (
    status === 'queued_local' &&
    (value.providerSubmissionKind !== null ||
      value.providerJobId !== null ||
      value.remoteStartedAt !== null ||
      value.progress !== null ||
      value.error !== null)
  ) {
    return false;
  }
  if (
    status === 'submitting' &&
    (value.providerSubmissionKind !== null ||
      value.providerJobId !== null ||
      value.remoteStartedAt !== null ||
      value.progress !== null ||
      value.error !== null)
  ) {
    return false;
  }
  const hasRemoteSubmission =
    value.providerSubmissionKind === 'remote' && value.providerJobId !== null && value.remoteStartedAt !== null;
  const hasCompleteSubmission =
    value.providerSubmissionKind === 'complete' && value.providerJobId === null && value.remoteStartedAt === null;
  if (
    (value.providerSubmissionKind === 'remote' && !hasRemoteSubmission) ||
    (value.providerSubmissionKind !== 'remote' && (value.providerJobId !== null || value.remoteStartedAt !== null))
  ) {
    return false;
  }
  if (
    (status === 'queued_remote' ||
      status === 'running' ||
      (status === 'needs_attention' && errorCode === 'poll_deadline')) &&
    !hasRemoteSubmission
  ) {
    return false;
  }
  if ((status === 'succeeded' || value.spendReceipt !== null) && !hasRemoteSubmission && !hasCompleteSubmission) {
    return false;
  }
  if (
    value.providerSubmissionKind === 'complete' &&
    !(
      status === 'succeeded' ||
      (status === 'failed' &&
        (errorCode === 'no_output' || errorCode === 'variation_grid' || errorCode === 'download_failed')) ||
      (status === 'needs_attention' && errorCode === 'submission_unknown' && value.spendReceipt !== null)
    )
  ) {
    return false;
  }
  if (
    value.providerSubmissionKind === 'remote' &&
    ((status === 'needs_attention' && errorCode !== 'poll_deadline') || errorCode === 'submission_unknown')
  ) {
    return false;
  }
  if (errorCode === 'variation_grid' && status !== 'failed') return false;
  if (errorCode === 'poll_deadline' && status !== 'needs_attention') return false;
  if (errorCode === 'submission_unknown' && status !== 'failed' && status !== 'needs_attention') {
    return false;
  }
  const receiptRequired =
    status === 'succeeded' ||
    (status === 'failed' &&
      (errorCode === 'no_output' || errorCode === 'variation_grid' || errorCode === 'download_failed'));
  const receiptAllowed =
    receiptRequired ||
    status === 'running' ||
    (status === 'needs_attention' && (errorCode === 'poll_deadline' || errorCode === 'submission_unknown'));
  if ((receiptRequired && value.spendReceipt === null) || (!receiptAllowed && value.spendReceipt !== null)) {
    return false;
  }
  if (status === 'succeeded') {
    return value.outputAssetId !== null && value.error === null;
  }
  if (value.outputAssetId !== null) return false;
  if (status === 'failed' || status === 'needs_attention') return value.error !== null;
  if (ACTIVE_PIECE_JOB_STATUSES_V3.has(status)) return value.error === null;
  return status === 'cancelled' && value.error === null;
};

const isPieceRetryReasonV4 = (value: unknown): value is StudioPieceJobRetryReasonV3 =>
  value === 'provider_failure' || value === 'submission_unknown' || value === 'variation_grid' || value === 'cancelled';

const validatePieceCurrentAssetSnapshotV4 = (value: unknown): value is StudioPieceCurrentAssetSnapshotV4 => {
  if (
    !isRecord(value) ||
    !(value.mediaKind === 'image'
      ? hasExactKeys(value, PHOTO_CURRENT_ASSET_SNAPSHOT_KEYS_V4)
      : hasExactKeys(value, MOTION_CURRENT_ASSET_SNAPSHOT_KEYS_V4)) ||
    !isSafeId(value.pieceId) ||
    !isSafeId(value.assetId) ||
    value.role !== 'primary' ||
    (value.mediaKind === 'image'
      ? !isStudioReferenceImageMimeType(value.mimeType)
      : value.mediaKind !== 'video' || (value.mimeType !== 'video/mp4' && value.mimeType !== 'video/webm')) ||
    !isIntegerInRange(
      value.byteSize,
      1,
      value.mediaKind === 'video' ? STUDIO_MAX_VIDEO_ASSET_BYTES_V4 : STUDIO_MAX_IMAGE_ASSET_BYTES_V4
    ) ||
    !isLowercaseDigest(value.sha256) ||
    !isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER) ||
    (value.mediaKind === 'video' && !isFiniteInRange(value.durationSeconds, Number.EPSILON, 86_400)) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return false;
  }
  if (value.origin === 'imported') {
    return value.producerJobId === null && value.compositionDigest === null;
  }
  return value.origin === 'generated' && isSafeId(value.producerJobId) && isLowercaseDigest(value.compositionDigest);
};

const validatePiecePublicationIntentV4 = (value: unknown): value is StudioPiecePublicationIntentV4 => {
  if (!isRecord(value) || value.schemaVersion !== STUDIO_PIECE_PUBLICATION_INTENT_SCHEMA_VERSION_V4) {
    return false;
  }
  if (value.kind === 'fill_empty') return hasExactKeys(value, FILL_EMPTY_PUBLICATION_KEYS_V4);
  return (
    value.kind === 'replace_current' &&
    hasExactKeys(value, REPLACE_CURRENT_PUBLICATION_KEYS_V4) &&
    validatePieceCurrentAssetSnapshotV4(value.currentAsset)
  );
};

const validatePieceGenerationAttemptV4 = (value: unknown): value is StudioPieceGenerationAttemptV4 => {
  if (!isRecord(value)) return false;
  if (value.kind === 'first') return hasExactKeys(value, FIRST_ATTEMPT_KEYS_V4);
  return (
    value.kind === 'retry' &&
    hasExactKeys(value, RETRY_ATTEMPT_KEYS_V4) &&
    isSafeId(value.sourceJobId) &&
    isPieceRetryReasonV4(value.reason)
  );
};

const PIECE_IMAGE_EXTENSION_BY_MIME_TYPE_V3: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const isCanonicalPieceManagedAssetFileNameV3 = (assetId: string, mimeType: string, value: unknown): value is string => {
  const extension = PIECE_IMAGE_EXTENSION_BY_MIME_TYPE_V3.get(mimeType);
  return extension !== undefined && isSafeFileName(value) && value === `${assetId}.${extension}`;
};

const validatePieceAssetV3 = (assetId: string, projectId: string, value: unknown): value is StudioAssetV3 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ASSET_KEYS_V3) ||
    value.id !== assetId ||
    !isSafeId(assetId) ||
    value.projectId !== projectId ||
    !isSafeId(value.pieceId) ||
    value.mediaKind !== 'image' ||
    !isStudioReferenceImageMimeType(value.mimeType) ||
    !isRecord(value.managedAsset) ||
    !hasExactKeys(value.managedAsset, MANAGED_ASSET_KEYS_V3) ||
    !isCanonicalPieceManagedAssetFileNameV3(assetId, value.mimeType, value.managedAsset.fileName) ||
    !isIntegerInRange(value.byteSize, 1, STUDIO_MAX_IMAGE_ASSET_BYTES_V3) ||
    !isLowercaseDigest(value.sha256) ||
    !isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return false;
  }
  if (value.origin === 'imported') {
    return (
      value.managedAsset.collection === 'imports' && value.producerJobId === null && value.compositionDigest === null
    );
  }
  return (
    value.origin === 'generated' &&
    value.managedAsset.collection === 'assets' &&
    isSafeId(value.producerJobId) &&
    isLowercaseDigest(value.compositionDigest)
  );
};

const validatePieceRecordV3 = (pieceId: string, value: unknown): value is StudioPieceV2 =>
  isRecord(value) &&
  hasExactKeys(value, PIECE_KEYS_V3) &&
  value.id === pieceId &&
  isSafeId(pieceId) &&
  value.kind === 'photograph' &&
  isCanonicalStudioPieceHandleV3(value.handle) &&
  isDenseArray(value.priorHandles, STUDIO_MAX_PIECE_PRIOR_HANDLES_V3) &&
  arrayEvery(value.priorHandles, isCanonicalStudioPieceHandleV3) &&
  new Set(value.priorHandles).size === value.priorHandles.length &&
  !value.priorHandles.includes(value.handle) &&
  isNullableSafeId(value.currentAssetId) &&
  isUniqueSafeIdArray(value.jobIds, STUDIO_MAX_JOBS_PER_PIECE_V3) &&
  isCanonicalTimestamp(value.createdAt) &&
  isCanonicalTimestamp(value.updatedAt) &&
  value.createdAt <= value.updatedAt;

const validateUndoHistoryV3 = (value: unknown, project: StudioProjectV3): boolean => {
  if (!isDenseArray(value, STUDIO_MAX_UNDO_ENTRIES_V3)) return false;
  const entryIds = new Set<string>();
  let previousSourceRevision = 0;
  let previousSourceAuthoringRevision = 0;
  for (let entryIndex = 0; entryIndex < value.length; entryIndex += 1) {
    const entry = value[entryIndex];
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, UNDO_ENTRY_KEYS_V3) ||
      !isSafeId(entry.id) ||
      entryIds.has(entry.id) ||
      !isIntegerInRange(entry.sourceRevision, 1, project.revision) ||
      !isIntegerInRange(entry.sourceAuthoringRevision, 1, project.authoringRevision) ||
      (entry.sourceAuthoringRevision as number) > (entry.sourceRevision as number) ||
      (entry.sourceRevision as number) <= previousSourceRevision ||
      (entry.sourceAuthoringRevision as number) <= previousSourceAuthoringRevision ||
      !isNonEmptyStringWithin(entry.label, STUDIO_MAX_UNDO_LABEL_LENGTH) ||
      !isDenseArray(entry.patches, 1) ||
      entry.patches.length !== 1
    ) {
      return false;
    }
    entryIds.add(entry.id as string);
    previousSourceRevision = entry.sourceRevision as number;
    previousSourceAuthoringRevision = entry.sourceAuthoringRevision as number;
    const patch = entry.patches[0];
    if (
      !isRecord(patch) ||
      !hasExactKeys(patch, PIECE_CATALOG_PATCH_KEYS_V3) ||
      patch.kind !== 'piece_catalog' ||
      !isSafeId(patch.pieceId) ||
      !Object.hasOwn(project.pieces, patch.pieceId) ||
      !isRecord(patch.before) ||
      !hasExactKeys(patch.before, PIECE_CATALOG_PATCH_BEFORE_KEYS_V3) ||
      !isCanonicalStudioPieceHandleV3(patch.before.handle) ||
      !isDenseArray(patch.before.priorHandles, STUDIO_MAX_PIECE_PRIOR_HANDLES_V3) ||
      !arrayEvery(patch.before.priorHandles, isCanonicalStudioPieceHandleV3) ||
      new Set(patch.before.priorHandles).size !== patch.before.priorHandles.length ||
      patch.before.priorHandles.includes(patch.before.handle) ||
      !isLowercaseDigest(patch.afterDigest)
    ) {
      return false;
    }
  }
  return true;
};

const pieceRetryGraphHasCycleV3 = (jobs: Record<string, StudioPieceJobV3>): boolean => {
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

/**
 * Derives the only paid-retry reason admitted by Pilot 1. Download and poll recovery stay on their
 * existing same-Job paths; minting a fresh paid Job for either would require a separate product
 * ruling and duplicate-spend contract.
 */
export const studioPieceRetryReasonForPredecessorV3 = (
  predecessor: Pick<StudioPieceJobV3, 'status' | 'error'>
): StudioPieceJobRetryReasonV3 | null => {
  if (predecessor.status === 'cancelled') return 'cancelled';
  if (
    (predecessor.status === 'failed' || predecessor.status === 'needs_attention') &&
    predecessor.error?.code === 'submission_unknown'
  ) {
    return 'submission_unknown';
  }
  if (predecessor.status !== 'failed' || predecessor.error === null) return null;
  if (predecessor.error.code === 'variation_grid') return 'variation_grid';
  if (predecessor.error.code === 'download_failed' || predecessor.error.code === 'poll_deadline') return null;
  return 'provider_failure';
};

const pieceRetryReasonMatchesPredecessorV3 = (
  reason: StudioPieceJobRetryReasonV3,
  predecessor: StudioPieceJobV3
): boolean => studioPieceRetryReasonForPredecessorV3(predecessor) === reason;

type StudioProjectAssetLineageValidationV4 = {
  /** Current, retained, and evicted asset identities, each mapped to its one owning Piece. */
  owners: ReadonlyMap<string, string>;
  tombstones: ReadonlyMap<string, StudioPieceAssetTombstoneV4>;
  versionsByPiece: ReadonlyMap<string, StudioPieceMediaVersionV4[]>;
};

/**
 * Validates the exact inactive schema-6 Pilot project contract without defaults or schema-5
 * compatibility. Frozen composition prompts are checked only for shape and stored consistency.
 */
const validateStudioProjectV3Snapshot = (
  value: unknown,
  assetLineage: StudioProjectAssetLineageValidationV4 | null
): value is StudioProjectV3 => {
  const dataSnapshot = snapshotOwnDataGraph(value);
  if (dataSnapshot === INVALID_DATA_SNAPSHOT) return false;
  value = dataSnapshot;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PROJECT_KEYS_V3) ||
    value.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION_V3 ||
    !isIntegerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.authoringRevision, 1, value.revision as number) ||
    !isSafeId(value.id) ||
    !isNonEmptyStringWithin(value.name, 256) ||
    value.name !== (value.name as string).trim() ||
    !isStringWithin(value.brief, 16 * 1024) ||
    !validateRules(value.rules) ||
    !isNullableSafeId(value.forgeProjectId) ||
    !isNullableSafeId(value.briefConversationId) ||
    !isUniqueSafeIdArray(value.pieceOrder, STUDIO_MAX_PIECES_V3) ||
    !isRecord(value.pieces) ||
    !validateSpendPolicy(value.spendPolicy) ||
    !isDenseArray(value.spendAuthorizations, STUDIO_MAX_SPEND_AUTHORIZATIONS_V3) ||
    !isDenseArray(value.undoHistory, STUDIO_MAX_UNDO_ENTRIES_V3) ||
    !isRecord(value.assets) ||
    !isRecord(value.jobs) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt
  ) {
    return false;
  }

  const project = value as StudioProjectV3;
  const pieceIds = Object.keys(project.pieces);
  const assetIds = Object.keys(project.assets);
  const jobIds = Object.keys(project.jobs);
  if (
    !arrayEvery(project.rules, (rule) => rule.createdAt >= project.createdAt && rule.createdAt <= project.updatedAt) ||
    pieceIds.length > STUDIO_MAX_PIECES_V3 ||
    assetIds.length > (assetLineage === null ? STUDIO_MAX_ASSETS_V3 : STUDIO_MAX_PIECES_V3 + STUDIO_MAX_JOBS_V3) ||
    jobIds.length > STUDIO_MAX_JOBS_V3 ||
    project.pieceOrder.length !== pieceIds.length ||
    !arrayEvery(project.pieceOrder, (pieceId) => Object.hasOwn(project.pieces, pieceId)) ||
    !pieceIds.every((pieceId) => validatePieceRecordV3(pieceId, project.pieces[pieceId])) ||
    !jobIds.every((jobId) => validatePieceJobV3(jobId, project.id, project.jobs[jobId])) ||
    !validateUndoHistoryV3(project.undoHistory, project)
  ) {
    return false;
  }

  const managedAssetPaths = new Set<string>();
  for (const assetId of assetIds) {
    const asset = ownValue(project.assets, assetId);
    if (isRecord(asset) && isRecord(asset.managedAsset)) {
      const { collection, fileName } = asset.managedAsset;
      if (typeof collection === 'string' && typeof fileName === 'string') {
        const managedAssetPath = `${collection}/${fileName}`;
        if (managedAssetPaths.has(managedAssetPath)) return false;
        managedAssetPaths.add(managedAssetPath);
      }
    }
    if (!validatePieceAssetV3(assetId, project.id, asset)) return false;
  }

  const handleNamespace = new Set<string>();
  const currentAssetOwners = new Map<string, string>();
  const jobOwners = new Map<string, { pieceId: string; position: number }>();
  for (const piece of Object.values(project.pieces)) {
    for (const handle of [piece.handle, ...piece.priorHandles]) {
      if (handleNamespace.has(handle)) return false;
      handleNamespace.add(handle);
    }
    if (
      piece.createdAt < project.createdAt ||
      piece.updatedAt > project.updatedAt ||
      (piece.currentAssetId === null && piece.jobIds.length === 0)
    ) {
      return false;
    }
    if (piece.currentAssetId !== null) {
      if (currentAssetOwners.has(piece.currentAssetId)) return false;
      currentAssetOwners.set(piece.currentAssetId, piece.id);
    }
    let previousCreatedAt = '';
    for (let position = 0; position < piece.jobIds.length; position += 1) {
      const jobId = piece.jobIds[position]!;
      const job = ownValue(project.jobs, jobId);
      if (
        job === undefined ||
        job.target.pieceId !== piece.id ||
        job.createdAt < piece.createdAt ||
        job.createdAt > piece.updatedAt ||
        job.createdAt < previousCreatedAt ||
        jobOwners.has(jobId)
      ) {
        return false;
      }
      previousCreatedAt = job.createdAt;
      jobOwners.set(jobId, { pieceId: piece.id, position });
    }
    if (piece.jobIds.filter((jobId) => ACTIVE_PIECE_JOB_STATUSES_V3.has(project.jobs[jobId]!.status)).length > 1) {
      return false;
    }
  }
  if (
    jobOwners.size !== jobIds.length ||
    (assetLineage === null
      ? currentAssetOwners.size !== assetIds.length
      : assetIds.some((assetId) => !assetLineage.owners.has(assetId)))
  ) {
    return false;
  }

  for (const asset of Object.values(project.assets)) {
    const piece = ownValue(project.pieces, asset.pieceId);
    if (
      piece === undefined ||
      asset.id === piece.id ||
      (assetLineage === null ? piece.currentAssetId !== asset.id : assetLineage.owners.get(asset.id) !== piece.id) ||
      (assetLineage === null && currentAssetOwners.get(asset.id) !== piece.id) ||
      asset.createdAt < piece.createdAt ||
      asset.createdAt > piece.updatedAt ||
      asset.createdAt > project.updatedAt
    ) {
      return false;
    }
    if (asset.origin === 'imported') {
      if (assetLineage === null && piece.jobIds.length !== 0) return false;
      continue;
    }
    const producer = ownValue(project.jobs, asset.producerJobId);
    if (
      producer === undefined ||
      asset.id === producer.id ||
      producer.target.pieceId !== piece.id ||
      producer.status !== 'succeeded' ||
      producer.outputAssetId !== asset.id ||
      asset.createdAt < producer.createdAt ||
      asset.createdAt > producer.updatedAt ||
      asset.compositionDigest !== pieceCompositionDigestV3(producer.composition)
    ) {
      return false;
    }
  }

  const authorizationsById = new Map<string, StudioPieceSpendAuthorizationV3>();
  const quoteIds = new Set<string>();
  const reservationIds = new Set<string>();
  const authorizationItemIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const persistentIdentities = new Set<string>([project.id, ...pieceIds, ...assetIds, ...jobIds]);
  if (persistentIdentities.size !== 1 + pieceIds.length + assetIds.length + jobIds.length) return false;
  const undoSourceRevisions = new Set(project.undoHistory.map((entry) => entry.sourceRevision));
  let previousAuthorizationRevision = 0;
  let previousConfirmedAt = '';
  for (let index = 0; index < project.spendAuthorizations.length; index += 1) {
    const authorization = project.spendAuthorizations[index]!;
    if (
      !validatePieceAuthorizationV3(authorization, project) ||
      authorization.confirmedAt < project.createdAt ||
      authorization.confirmedAt > project.updatedAt ||
      authorization.projectRevisionAtAuthorization <= previousAuthorizationRevision ||
      authorization.confirmedAt < previousConfirmedAt ||
      undoSourceRevisions.has(authorization.projectRevisionAtAuthorization) ||
      authorizationsById.has(authorization.id) ||
      quoteIds.has(authorization.quote.id) ||
      reservationIds.has(authorization.quote.reservationId) ||
      authorizationItemIds.has(authorization.quote.item.id) ||
      idempotencyKeys.has(authorization.idempotencyKey.key)
    ) {
      return false;
    }
    const linkedIdentities = [
      authorization.id,
      authorization.quote.id,
      authorization.quote.reservationId,
      authorization.quote.item.id,
      authorization.idempotencyKey.key,
    ];
    if (
      new Set(linkedIdentities).size !== linkedIdentities.length ||
      linkedIdentities.some((identity) => persistentIdentities.has(identity))
    ) {
      return false;
    }
    authorizationsById.set(authorization.id, authorization);
    for (const identity of linkedIdentities) persistentIdentities.add(identity);
    previousAuthorizationRevision = authorization.projectRevisionAtAuthorization;
    previousConfirmedAt = authorization.confirmedAt;
    quoteIds.add(authorization.quote.id);
    reservationIds.add(authorization.quote.reservationId);
    authorizationItemIds.add(authorization.quote.item.id);
    idempotencyKeys.add(authorization.idempotencyKey.key);
  }
  if (authorizationsById.size !== jobIds.length) return false;

  const retryChildren = new Set<string>();
  const usedAuthorizationIds = new Set<string>();
  for (const job of Object.values(project.jobs)) {
    const piece = ownValue(project.pieces, job.target.pieceId);
    const owner = jobOwners.get(job.id);
    const authorization = authorizationsById.get(job.authorizationId);
    if (
      piece === undefined ||
      owner?.pieceId !== piece.id ||
      authorization === undefined ||
      usedAuthorizationIds.has(job.authorizationId) ||
      authorization.quote.item.id !== job.authorizationItemId ||
      authorization.quote.item.target.pieceId !== piece.id ||
      !canonicalValuesEqualV3(authorization.quote.item.requestPlan, job.requestPlan) ||
      !providersEqual(authorization.providerBinding.provider, job.provider) ||
      authorization.cancellationPolicy !== job.cancellationPolicy ||
      authorization.idempotencyKey.key !== job.idempotencyKey ||
      authorization.projectRevisionAtAuthorization !== job.projectRevisionAtAuthorization ||
      authorization.quote.projectRevisionAtPreparation !== job.projectRevisionAtPreparation ||
      authorization.quote.authoringRevision !== job.authoringRevision ||
      authorization.quote.authoringFingerprint !== job.authoringFingerprint ||
      !arrayEvery(
        job.composition.inputs.rules,
        (rule) => rule.createdAt >= project.createdAt && rule.createdAt <= authorization.confirmedAt
      ) ||
      job.createdAt < authorization.confirmedAt ||
      (job.remoteStartedAt !== null && (job.remoteStartedAt < job.createdAt || job.remoteStartedAt > job.updatedAt)) ||
      (job.duplicateChargeAcknowledgedAt !== null &&
        (job.duplicateChargeAcknowledgedAt < authorization.confirmedAt ||
          job.duplicateChargeAcknowledgedAt > job.createdAt)) ||
      (job.spendReceipt !== null &&
        (job.spendReceipt.recordedAt < authorization.confirmedAt ||
          job.spendReceipt.recordedAt < job.createdAt ||
          (job.remoteStartedAt !== null && job.spendReceipt.recordedAt < job.remoteStartedAt) ||
          job.spendReceipt.recordedAt > job.updatedAt ||
          job.spendReceipt.authorizationId !== authorization.id ||
          job.spendReceipt.quoteId !== authorization.quote.id ||
          job.spendReceipt.quoteRevision !== authorization.quote.quoteRevision ||
          job.spendReceipt.itemId !== authorization.quote.item.id ||
          job.spendReceipt.jobId !== job.id ||
          job.spendReceipt.routeId !== authorization.quote.item.routeId ||
          job.spendReceipt.currency !== authorization.quote.currency ||
          job.spendReceipt.rateMinorUnits !== authorization.quote.item.rateMinorUnits)) ||
      job.updatedAt > project.updatedAt
    ) {
      return false;
    }
    for (const input of job.requestPlan.snapshot.conditioningInputs) {
      const referencePiece = ownValue(project.pieces, input.pieceId);
      const referenceAsset =
        ownValue(project.assets, input.assetId) ??
        (assetLineage === null ? undefined : assetLineage.tombstones.get(input.assetId));
      if (
        referencePiece === undefined ||
        referencePiece.id === piece.id ||
        (assetLineage === null
          ? referencePiece.currentAssetId !== input.assetId
          : assetLineage.owners.get(input.assetId) !== referencePiece.id) ||
        referencePiece.createdAt > authorization.confirmedAt ||
        referenceAsset === undefined ||
        ('projectId' in referenceAsset && referenceAsset.projectId !== project.id) ||
        ('pieceId' in referenceAsset && referenceAsset.pieceId !== referencePiece.id) ||
        referenceAsset.sha256 !== input.sha256 ||
        referenceAsset.mimeType !== input.mimeType ||
        referenceAsset.byteSize !== input.byteSize ||
        referenceAsset.createdAt > authorization.confirmedAt
      ) {
        return false;
      }
    }
    usedAuthorizationIds.add(job.authorizationId);
    if (job.status === 'succeeded') {
      const asset =
        ownValue(project.assets, job.outputAssetId!) ??
        (assetLineage === null ? undefined : assetLineage.tombstones.get(job.outputAssetId!));
      if (
        asset?.origin !== 'generated' ||
        (assetLineage === null
          ? !('pieceId' in asset) || asset.pieceId !== piece.id || piece.currentAssetId !== asset.id
          : assetLineage.owners.get(asset.id) !== piece.id) ||
        job.spendReceipt === null
      ) {
        return false;
      }
    }
    if (job.retryOfJobId === null) {
      if (assetLineage === null && owner.position !== 0) return false;
      continue;
    }
    if (retryChildren.has(job.retryOfJobId)) return false;
    retryChildren.add(job.retryOfJobId);
    const predecessor = ownValue(project.jobs, job.retryOfJobId);
    const predecessorOwner = predecessor === undefined ? undefined : jobOwners.get(predecessor.id);
    if (
      predecessor === undefined ||
      predecessorOwner?.pieceId !== piece.id ||
      predecessorOwner.position >= owner.position ||
      predecessor.updatedAt > job.createdAt ||
      predecessor.purpose !== job.purpose ||
      predecessor.composition.inputs.source.words !== job.composition.inputs.source.words ||
      !photoSettingsEqualV3(predecessor.composition.inputs.source.settings, job.composition.inputs.source.settings) ||
      !pieceConditioningInputsEqualV3(
        predecessor.requestPlan.snapshot.conditioningInputs,
        job.requestPlan.snapshot.conditioningInputs
      ) ||
      job.retryReason === null ||
      !pieceRetryReasonMatchesPredecessorV3(job.retryReason, predecessor)
    ) {
      return false;
    }
  }
  if (usedAuthorizationIds.size !== authorizationsById.size || pieceRetryGraphHasCycleV3(project.jobs)) return false;

  return true;
};

export const validateStudioProjectV3 = (value: unknown): value is StudioProjectV3 =>
  validateStudioProjectV3Snapshot(value, null);

const PROJECT_KEYS_V4 = new Set([
  ...PROJECT_KEYS_V3,
  'boardOrder',
  'boards',
  'assemblyOrder',
  'assemblies',
  'bin',
  'frameExtractions',
  'derivedFrames',
]);
const PIECE_KEYS_V4 = new Set([...PIECE_KEYS_V3, 'runStem', 'assetHistory']);
const RETAINED_ASSET_HISTORY_KEYS_V4 = new Set(['state', 'assetIdsByRole', 'supersededAt']);
const EVICTED_ASSET_HISTORY_KEYS_V4 = new Set(['state', 'assetsByRole', 'supersededAt', 'evictedAt']);
const ASSET_IDS_BY_ROLE_KEYS_V4 = new Set(['primary', 'poster']);
const PHOTO_ASSET_KEYS_V4 = new Set([
  'id',
  'projectId',
  'pieceId',
  'mediaKind',
  'role',
  'mimeType',
  'managedAsset',
  'byteSize',
  'sha256',
  'width',
  'height',
  'createdAt',
  'origin',
  'producerJobId',
  'compositionDigest',
]);
const MOTION_ASSET_KEYS_V4 = new Set([...PHOTO_ASSET_KEYS_V4, 'durationSeconds']);
const PHOTO_ASSET_TOMBSTONE_KEYS_V4 = new Set(
  [...PHOTO_ASSET_KEYS_V4].filter((key) => key !== 'projectId' && key !== 'pieceId' && key !== 'managedAsset')
);
const MOTION_ASSET_TOMBSTONE_KEYS_V4 = new Set([...PHOTO_ASSET_TOMBSTONE_KEYS_V4, 'durationSeconds']);
const PHOTO_CURRENT_ASSET_SNAPSHOT_KEYS_V4 = new Set(
  [...PHOTO_ASSET_KEYS_V4]
    .filter((key) => key !== 'id' && key !== 'projectId' && key !== 'managedAsset')
    .concat('assetId')
);
const MOTION_CURRENT_ASSET_SNAPSHOT_KEYS_V4 = new Set([...PHOTO_CURRENT_ASSET_SNAPSHOT_KEYS_V4, 'durationSeconds']);
const MANAGED_ASSET_KEYS_V4 = new Set(['collection', 'fileName']);
const DERIVED_FRAME_ASSET_KEYS_V4 = new Set([
  'id',
  'projectId',
  'targetPieceId',
  'extractionId',
  'mediaKind',
  'role',
  'mimeType',
  'managedAsset',
  'byteSize',
  'sha256',
  'width',
  'height',
  'createdAt',
]);
const FRAME_EXTRACTION_KEYS_V4 = new Set([
  'id',
  'projectId',
  'targetPieceId',
  'jobId',
  'assemblyId',
  'boardId',
  'dependentShotId',
  'predecessorShotId',
  'sourcePieceId',
  'sourceVideoAssetId',
  'sourceVideoSha256',
  'endpointSeconds',
  'frameAssetId',
  'status',
  'errorCode',
  'attemptCount',
  'createdAt',
  'updatedAt',
]);
const PHOTO_SETTINGS_KEYS_V4 = new Set(['kind', 'aspectRatio', 'resolution']);
const MOTION_SETTINGS_KEYS_V4 = new Set(['kind', 'aspectRatio', 'resolution', 'requestedDurationSeconds']);
const PIECE_SOURCE_KEYS_V4 = new Set(['kind', 'pieceId', 'words', 'settings']);
const PIECE_INPUT_KEYS_V4 = new Set(['pieceId', 'assetId', 'sha256', 'mimeType', 'byteSize']);
const DIRECT_FIRST_FRAME_KEYS_V4 = new Set(['kind', ...PIECE_INPUT_KEYS_V4]);
const PREDECESSOR_FIRST_FRAME_KEYS_V4 = new Set([
  'kind',
  'assemblyId',
  'boardId',
  'dependentShotId',
  'predecessorShotId',
  'sourcePieceId',
  'sourceVideoAssetId',
  'sourceVideoSha256',
  'endpointSeconds',
  'frameExtractionId',
  'frameAssetId',
  'frameSha256',
  'frameMimeType',
  'frameByteSize',
]);
const PHOTO_COMPOSITION_INPUT_KEYS_V4 = new Set([
  'schemaVersion',
  'projectRevisionAtPreparation',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'brief',
  'rules',
  'source',
  'purpose',
  'conditioningInputs',
  'route',
  'instructionProfile',
]);
const MOTION_COMPOSITION_INPUT_KEYS_V4 = new Set(
  [...PHOTO_COMPOSITION_INPUT_KEYS_V4].filter((key) => key !== 'conditioningInputs').concat('firstFrame')
);
const PHOTO_REQUEST_SNAPSHOT_KEYS_V4 = new Set(['composition', 'settings', 'conditioningInputs']);
const MOTION_REQUEST_SNAPSHOT_KEYS_V4 = new Set(['composition', 'settings', 'firstFrame']);
const QUOTED_ITEM_BASE_KEYS_V4 = [
  'id',
  'target',
  'purpose',
  'routeId',
  'generationCount',
  'requestPlan',
  'rateUnit',
  'rateMinorUnits',
  'publication',
  'attempt',
];
const PHOTO_QUOTED_ITEM_KEYS_V4 = new Set(QUOTED_ITEM_BASE_KEYS_V4);
const MOTION_QUOTED_ITEM_KEYS_V4 = new Set([
  ...QUOTED_ITEM_BASE_KEYS_V4,
  'requestedDurationSeconds',
  'billedDurationSeconds',
]);
const PHOTO_RECEIPT_KEYS_V4 = new Set(RECEIPT_KEYS_V3);
const MOTION_RECEIPT_KEYS_V4 = new Set([...RECEIPT_KEYS_V3, 'requestedDurationSeconds', 'billedDurationSeconds']);
const JOB_BASE_KEYS_V4 = [
  'id',
  'projectId',
  'target',
  'purpose',
  'status',
  'provider',
  'idempotencyKey',
  'providerSubmissionKind',
  'providerJobId',
  'remoteStartedAt',
  'cancellationPolicy',
  'outputAssetIdsByRole',
  'error',
  'progress',
  'publication',
  'attempt',
  'duplicateChargeAcknowledged',
  'duplicateChargeAcknowledgedAt',
  'authorizationId',
  'authorizationItemId',
  'composition',
  'requestPlan',
  'spendReceipt',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'projectRevisionAtPreparation',
  'projectRevisionAtAuthorization',
  'createdAt',
  'updatedAt',
] as const;
const PHOTO_JOB_KEYS_V4 = new Set(JOB_BASE_KEYS_V4);
const MOTION_JOB_KEYS_V4 = new Set([...JOB_BASE_KEYS_V4, 'requestSnapshot']);
const BOARD_KEYS_V4 = new Set([
  'id',
  'handle',
  'priorHandles',
  'beatOrder',
  'beats',
  'shots',
  'createdAt',
  'updatedAt',
]);
const BOARD_BEAT_KEYS_V4 = new Set(['id', 'title', 'story', 'targetSeconds', 'shotOrder']);
const BOARD_SHOT_KEYS_V4 = new Set(['id', 'shootingScript', 'durationSeconds', 'createdAt', 'updatedAt']);
const ASSEMBLY_KEYS_V4 = new Set([
  'id',
  'handle',
  'priorHandles',
  'boardId',
  'pictureBindings',
  'soundBindingOrder',
  'soundBindings',
  'createdAt',
  'updatedAt',
]);
const ASSEMBLY_PICTURE_BINDING_KEYS_V4 = new Set([
  'shotId',
  'source',
  'sourceInSeconds',
  'sourceOutSeconds',
  'join',
  'staleness',
]);
const ASSEMBLY_PICTURE_SOURCE_KEYS_V4 = new Set(['pieceId', 'assetId']);
const CHAIN_STALENESS_KEYS_V4 = new Set(['cause', 'upstreamShotId', 'sourceAuthoringRevision', 'keptAt']);
const BIN_ENTRY_KEYS_V4 = new Set(['id', 'subject', 'reason', 'liftedAt']);
const PIECE_BIN_SUBJECT_KEYS_V4 = new Set(['kind', 'pieceId']);
const BOARD_BIN_SUBJECT_KEYS_V4 = new Set(['kind', 'boardId']);
const BOARD_SHOT_BIN_SUBJECT_KEYS_V4 = new Set(['kind', 'boardId', 'shotId']);
const ASSEMBLY_BIN_SUBJECT_KEYS_V4 = new Set(['kind', 'assemblyId']);
const BIN_BLOCKING_JOB_STATUSES_V4 = new Set<string>(STUDIO_BIN_BLOCKING_JOB_STATUSES_V4);

const COMPOSITION_KEYS_V4 = new Set(['inputs', 'prompt']);
const RESOLVED_REQUEST_PLAN_KEYS_V4 = new Set(['kind', 'snapshot']);
const DEFERRED_REQUEST_PLAN_KEYS_V4 = new Set(['kind', 'template', 'dependency']);
const MOTION_REQUEST_TEMPLATE_KEYS_V4 = new Set(['composition', 'settings']);
const PREDECESSOR_DEPENDENCY_KEYS_V4 = new Set([
  'kind',
  'upstreamItemId',
  'assemblyId',
  'boardId',
  'dependentShotId',
  'predecessorShotId',
  'sourcePieceId',
]);
const PIECE_QUOTED_GENERATION_ID_NAMESPACE_V4 = 'creative-studio/piece-quoted-generation/v2';
const PIECE_MOTION_ADAPTERS_V4 = new Set<StudioProviderAdapterId>([
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
]);
const PIECE_ASSET_EXTENSION_BY_MIME_TYPE_V4: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
]);

const validatePieceSettingsV4 = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const common =
    typeof value.aspectRatio === 'string' &&
    ASPECT_RATIOS.has(value.aspectRatio) &&
    typeof value.resolution === 'string' &&
    RESOLUTIONS.has(value.resolution);
  if (value.kind === 'photograph') return hasExactKeys(value, PHOTO_SETTINGS_KEYS_V4) && common;
  return (
    value.kind === 'motion' &&
    hasExactKeys(value, MOTION_SETTINGS_KEYS_V4) &&
    common &&
    isIntegerInRange(value.requestedDurationSeconds, 4, 15)
  );
};

const pieceSettingsEqualV4 = (left: unknown, right: unknown): boolean =>
  validatePieceSettingsV4(left) && validatePieceSettingsV4(right) && canonicalValuesEqualV3(left, right);

const validatePieceInputSnapshotV4 = (value: unknown): value is StudioPieceConditioningInputSnapshotV4 =>
  isRecord(value) &&
  hasExactKeys(value, PIECE_INPUT_KEYS_V4) &&
  isSafeId(value.pieceId) &&
  isSafeId(value.assetId) &&
  isLowercaseDigest(value.sha256) &&
  isStudioReferenceImageMimeType(value.mimeType) &&
  isIntegerInRange(value.byteSize, 1, STUDIO_MAX_IMAGE_ASSET_BYTES_V4);

const validatePieceFirstFrameSnapshotV4 = (value: unknown): value is StudioPieceFirstFrameSnapshotV4 => {
  if (!isRecord(value)) return false;
  if (value.kind === 'piece_image') {
    return (
      hasExactKeys(value, DIRECT_FIRST_FRAME_KEYS_V4) &&
      validatePieceInputSnapshotV4({
        pieceId: value.pieceId,
        assetId: value.assetId,
        sha256: value.sha256,
        mimeType: value.mimeType,
        byteSize: value.byteSize,
      })
    );
  }
  return (
    value.kind === 'predecessor_frame' &&
    hasExactKeys(value, PREDECESSOR_FIRST_FRAME_KEYS_V4) &&
    isSafeId(value.assemblyId) &&
    isSafeId(value.boardId) &&
    isSafeId(value.dependentShotId) &&
    isSafeId(value.predecessorShotId) &&
    value.dependentShotId !== value.predecessorShotId &&
    isSafeId(value.sourcePieceId) &&
    isSafeId(value.sourceVideoAssetId) &&
    isLowercaseDigest(value.sourceVideoSha256) &&
    isFiniteInRange(value.endpointSeconds, Number.EPSILON, 86_400) &&
    isSafeId(value.frameExtractionId) &&
    isSafeId(value.frameAssetId) &&
    isLowercaseDigest(value.frameSha256) &&
    isStudioReferenceImageMimeType(value.frameMimeType) &&
    isIntegerInRange(value.frameByteSize, 1, STUDIO_MAX_IMAGE_ASSET_BYTES_V4)
  );
};

const validatePieceConditioningInputsV4 = (value: unknown): value is StudioPieceConditioningInputSnapshotV4[] => {
  if (!isDenseArray(value, STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3)) return false;
  const pieceIds = new Set<string>();
  const assetIds = new Set<string>();
  return value.every(
    (input) =>
      validatePieceInputSnapshotV4(input) &&
      !pieceIds.has(input.pieceId) &&
      !assetIds.has(input.assetId) &&
      Boolean(pieceIds.add(input.pieceId)) &&
      Boolean(assetIds.add(input.assetId))
  );
};

const pieceInputsEqualV4 = (left: unknown, right: unknown): boolean =>
  validatePieceConditioningInputsV4(left) &&
  validatePieceConditioningInputsV4(right) &&
  canonicalValuesEqualV3(left, right);

const isStudioPieceInstructionProfileV4 = (
  value: unknown,
  purpose: StudioPieceJobV4['purpose'],
  route: StudioProviderRef
): boolean => {
  if (purpose === 'piece_image') return isStudioPieceInstructionProfileV3(value);
  return (
    typeof value === 'string' &&
    value.startsWith(`${route.adapterId}.piece-motion.v`) &&
    /^[a-z0-9-]+\.piece-motion\.v[1-9][0-9]*$/u.test(value)
  );
};

/** Validates schema-7 composition shape and arm correlation without recomposing frozen prompt text. */
export const validateStudioPieceGenerationCompositionV4 = (
  value: unknown
): value is StudioPieceGenerationCompositionV4 => {
  if (!isRecord(value) || !hasExactKeys(value, COMPOSITION_KEYS_V4) || !isRecord(value.inputs)) return false;
  const inputs = value.inputs;
  const photoArm = inputs.purpose === 'piece_image' && hasExactKeys(inputs, PHOTO_COMPOSITION_INPUT_KEYS_V4);
  const motionArm = inputs.purpose === 'piece_motion' && hasExactKeys(inputs, MOTION_COMPOSITION_INPUT_KEYS_V4);
  if (
    (!photoArm && !motionArm) ||
    inputs.schemaVersion !== STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V4 ||
    !isIntegerInRange(inputs.projectRevisionAtPreparation, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(inputs.authoringRevision, 1, inputs.projectRevisionAtPreparation as number) ||
    inputs.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V4 ||
    !isLowercaseDigest(inputs.authoringFingerprint) ||
    !isStringWithin(inputs.brief, 16 * 1024) ||
    !validateRules(inputs.rules) ||
    !isRecord(inputs.source) ||
    !hasExactKeys(inputs.source, PIECE_SOURCE_KEYS_V4) ||
    inputs.source.kind !== 'piece' ||
    !isSafeId(inputs.source.pieceId) ||
    !isCanonicalPieceWordsV3(inputs.source.words) ||
    !validatePieceSettingsV4(inputs.source.settings) ||
    !validateProvider(inputs.route) ||
    !isStudioPieceInstructionProfileV4(
      inputs.instructionProfile,
      inputs.purpose as StudioPieceJobV4['purpose'],
      inputs.route as StudioProviderRef
    ) ||
    !isNonEmptyStringWithin(value.prompt, STUDIO_MAX_GENERATION_PROMPT_LENGTH)
  ) {
    return false;
  }
  if (photoArm) {
    return (
      (inputs.source as Record<string, unknown>).settings !== undefined &&
      (inputs.source.settings as Record<string, unknown>).kind === 'photograph' &&
      (inputs.route as StudioProviderRef).adapterId === 'weprompt-image-v1' &&
      validatePieceConditioningInputsV4(inputs.conditioningInputs)
    );
  }
  return (
    (inputs.source.settings as Record<string, unknown>).kind === 'motion' &&
    PIECE_MOTION_ADAPTERS_V4.has((inputs.route as StudioProviderRef).adapterId) &&
    (inputs.firstFrame === null || validatePieceFirstFrameSnapshotV4(inputs.firstFrame))
  );
};

export const studioPieceGenerationCompositionDigestV4 = (value: StudioPieceGenerationCompositionV4): string =>
  createHash('sha256').update(canonicalJsonV3(value), 'utf8').digest('hex');

const validatePieceMotionRequestSnapshotV4 = (value: unknown): value is StudioPieceMotionGenerationRequestSnapshotV4 =>
  isRecord(value) &&
  hasExactKeys(value, MOTION_REQUEST_SNAPSHOT_KEYS_V4) &&
  validateStudioPieceGenerationCompositionV4(value.composition) &&
  value.composition.inputs.purpose === 'piece_motion' &&
  validatePieceSettingsV4(value.settings) &&
  (value.settings as Record<string, unknown>).kind === 'motion' &&
  pieceSettingsEqualV4(value.settings, value.composition.inputs.source.settings) &&
  (value.firstFrame === null || validatePieceFirstFrameSnapshotV4(value.firstFrame)) &&
  canonicalValuesEqualV3(value.firstFrame, value.composition.inputs.firstFrame);

const validatePieceRequestPlanV4 = (value: unknown): value is StudioPieceGenerationRequestPlanV4 => {
  if (!isRecord(value)) return false;
  if (value.kind === 'after_upstream_completion') {
    if (
      !hasExactKeys(value, DEFERRED_REQUEST_PLAN_KEYS_V4) ||
      !isRecord(value.template) ||
      !hasExactKeys(value.template, MOTION_REQUEST_TEMPLATE_KEYS_V4) ||
      !validateStudioPieceGenerationCompositionV4(value.template.composition) ||
      value.template.composition.inputs.purpose !== 'piece_motion' ||
      value.template.composition.inputs.firstFrame !== null ||
      !validatePieceSettingsV4(value.template.settings) ||
      (value.template.settings as Record<string, unknown>).kind !== 'motion' ||
      !pieceSettingsEqualV4(value.template.settings, value.template.composition.inputs.source.settings) ||
      !isRecord(value.dependency) ||
      !hasExactKeys(value.dependency, PREDECESSOR_DEPENDENCY_KEYS_V4)
    ) {
      return false;
    }
    const dependency = value.dependency;
    return (
      dependency.kind === 'authorized_predecessor' &&
      isSafeId(dependency.upstreamItemId) &&
      isSafeId(dependency.assemblyId) &&
      isSafeId(dependency.boardId) &&
      isSafeId(dependency.dependentShotId) &&
      isSafeId(dependency.predecessorShotId) &&
      dependency.dependentShotId !== dependency.predecessorShotId &&
      isSafeId(dependency.sourcePieceId)
    );
  }
  if (
    value.kind !== 'resolved' ||
    !hasExactKeys(value, RESOLVED_REQUEST_PLAN_KEYS_V4) ||
    !isRecord(value.snapshot) ||
    !validateStudioPieceGenerationCompositionV4(value.snapshot.composition)
  )
    return false;
  const composition = value.snapshot.composition;
  if (composition.inputs.purpose === 'piece_image') {
    return (
      hasExactKeys(value.snapshot, PHOTO_REQUEST_SNAPSHOT_KEYS_V4) &&
      validatePieceSettingsV4(value.snapshot.settings) &&
      (value.snapshot.settings as Record<string, unknown>).kind === 'photograph' &&
      pieceSettingsEqualV4(value.snapshot.settings, composition.inputs.source.settings) &&
      pieceInputsEqualV4(value.snapshot.conditioningInputs, composition.inputs.conditioningInputs)
    );
  }
  return (
    validatePieceMotionRequestSnapshotV4(value.snapshot) &&
    canonicalValuesEqualV3(value.snapshot.composition, composition)
  );
};

const pieceRequestPlanCompositionV4 = (plan: StudioPieceGenerationRequestPlanV4): StudioPieceGenerationCompositionV4 =>
  plan.kind === 'resolved' ? plan.snapshot.composition : plan.template.composition;

const motionSnapshotResolvesTemplateV4 = (
  snapshot: StudioPieceMotionGenerationRequestSnapshotV4,
  plan: Extract<StudioPieceMotionGenerationRequestPlanV4, { kind: 'after_upstream_completion' }>
): boolean => {
  const materializedInputs = snapshot.composition.inputs;
  if (materializedInputs.purpose !== 'piece_motion') return false;
  return (
    pieceSettingsEqualV4(snapshot.settings, plan.template.settings) &&
    snapshot.firstFrame !== null &&
    canonicalValuesEqualV3(
      { ...snapshot.composition, inputs: { ...materializedInputs, firstFrame: null } },
      plan.template.composition
    )
  );
};

export const createStudioPieceQuotedGenerationIdV4 = (input: {
  projectId: string;
  reservationId: string;
  quoteId: string;
  quoteRevision: number;
  target: StudioPieceGenerationTargetV4;
  purpose: StudioPieceJobV4['purpose'];
}): string => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, new Set(['projectId', 'reservationId', 'quoteId', 'quoteRevision', 'target', 'purpose'])) ||
    !isStudioProjectIdV4(input.projectId) ||
    !isSafeId(input.reservationId) ||
    !isSafeId(input.quoteId) ||
    !isIntegerInRange(input.quoteRevision, 1, Number.MAX_SAFE_INTEGER) ||
    !validatePieceTargetV3(input.target) ||
    (input.purpose !== 'piece_image' && input.purpose !== 'piece_motion')
  ) {
    throw new TypeError('quoted generation identity input must be exact');
  }
  const canonical = [
    PIECE_QUOTED_GENERATION_ID_NAMESPACE_V4,
    input.projectId,
    input.reservationId,
    input.quoteId,
    String(input.quoteRevision),
    `piece:${input.target.pieceId}`,
    input.purpose,
  ].join('\0');
  return `item_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

const validatePieceQuotedGenerationV4 = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const photoArm = value.purpose === 'piece_image' && hasExactKeys(value, PHOTO_QUOTED_ITEM_KEYS_V4);
  const motionArm = value.purpose === 'piece_motion' && hasExactKeys(value, MOTION_QUOTED_ITEM_KEYS_V4);
  if (
    (!photoArm && !motionArm) ||
    !isSafeId(value.id) ||
    !validatePieceTargetV3(value.target) ||
    !isSafeId(value.routeId) ||
    value.generationCount !== 1 ||
    !validatePieceRequestPlanV4(value.requestPlan) ||
    !isIntegerInRange(value.rateMinorUnits, 1, Number.MAX_SAFE_INTEGER) ||
    !validatePiecePublicationIntentV4(value.publication) ||
    !validatePieceGenerationAttemptV4(value.attempt)
  ) {
    return false;
  }
  const composition = pieceRequestPlanCompositionV4(value.requestPlan);
  const target = value.target as StudioPieceGenerationTargetV3;
  if (target.pieceId !== composition.inputs.source.pieceId || value.purpose !== composition.inputs.purpose) {
    return false;
  }
  if (photoArm) return value.rateUnit === 'generation';
  return (
    value.rateUnit === 'second' &&
    isIntegerInRange(value.requestedDurationSeconds, 4, 15) &&
    isIntegerInRange(value.billedDurationSeconds, 4, 15) &&
    composition.inputs.purpose === 'piece_motion' &&
    value.requestedDurationSeconds === composition.inputs.source.settings.requestedDurationSeconds
  );
};

const quotedGenerationTotalV4 = (item: StudioPieceSubmissionQuoteV4['item']): number =>
  item.purpose === 'piece_image' ? item.rateMinorUnits : item.rateMinorUnits * item.billedDurationSeconds;

const validatePieceQuoteV4 = (
  value: unknown,
  projectId: string,
  currentRevision: number,
  currentAuthoringRevision: number
): value is StudioPieceSubmissionQuoteV4 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, QUOTE_KEYS_V3) ||
    !isSafeId(value.id) ||
    !isSafeId(value.reservationId) ||
    !isIntegerInRange(value.quoteRevision, 1, Number.MAX_SAFE_INTEGER) ||
    value.projectId !== projectId ||
    !isIntegerInRange(value.projectRevisionAtPreparation, 1, currentRevision) ||
    !isIntegerInRange(value.authoringRevision, 1, currentAuthoringRevision) ||
    (value.authoringRevision as number) > (value.projectRevisionAtPreparation as number) ||
    value.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V4 ||
    !isLowercaseDigest(value.authoringFingerprint) ||
    !isLowercaseDigest(value.rateCardDigest) ||
    !isCurrency(value.currency) ||
    !validatePieceQuotedGenerationV4(value.item) ||
    !isIntegerInRange(value.lowerMinorUnits, 1, Number.MAX_SAFE_INTEGER) ||
    value.upperMinorUnits !== value.lowerMinorUnits ||
    !isCanonicalTimestamp(value.expiresAt)
  ) {
    return false;
  }
  const item = value.item as StudioPieceSubmissionQuoteV4['item'];
  const inputs = pieceRequestPlanCompositionV4(item.requestPlan).inputs;
  return (
    item.id ===
      createStudioPieceQuotedGenerationIdV4({
        projectId: value.projectId,
        reservationId: value.reservationId,
        quoteId: value.id,
        quoteRevision: value.quoteRevision,
        target: item.target,
        purpose: item.purpose,
      }) &&
    quotedGenerationTotalV4(item) === value.lowerMinorUnits &&
    inputs.projectRevisionAtPreparation === value.projectRevisionAtPreparation &&
    inputs.authoringRevision === value.authoringRevision &&
    inputs.authoringFingerprintVersion === value.authoringFingerprintVersion &&
    inputs.authoringFingerprint === value.authoringFingerprint
  );
};

const validatePieceAuthorizationV4 = (
  value: unknown,
  project: StudioProjectV4
): value is StudioPieceSpendAuthorizationV4 =>
  isRecord(value) &&
  hasExactKeys(value, AUTHORIZATION_KEYS_V3) &&
  isSafeId(value.id) &&
  validatePieceQuoteV4(value.quote, project.id, project.revision, project.authoringRevision) &&
  value.id !== value.quote.id &&
  value.id !== value.quote.item.id &&
  value.quote.id !== value.quote.item.id &&
  isCanonicalTimestamp(value.confirmedAt) &&
  isIntegerInRange(value.projectRevisionAtAuthorization, 1, project.revision) &&
  value.projectRevisionAtAuthorization > value.quote.projectRevisionAtPreparation &&
  value.confirmedAt < value.quote.expiresAt &&
  (value.cancellationPolicy === 'none' ||
    value.cancellationPolicy === 'queued_only' ||
    value.cancellationPolicy === 'queued_and_running') &&
  isRecord(value.providerBinding) &&
  hasExactKeys(value.providerBinding, SINGLE_PROVIDER_BINDING_KEYS_V3) &&
  value.providerBinding.itemId === value.quote.item.id &&
  validateProvider(value.providerBinding.provider) &&
  providersEqual(
    value.providerBinding.provider,
    pieceRequestPlanCompositionV4(value.quote.item.requestPlan).inputs.route
  ) &&
  isRecord(value.idempotencyKey) &&
  hasExactKeys(value.idempotencyKey, SINGLE_IDEMPOTENCY_KEY_KEYS_V3) &&
  value.idempotencyKey.itemId === value.quote.item.id &&
  isSafeId(value.idempotencyKey.key);

const validatePieceReceiptV4 = (value: unknown): value is StudioPieceSpendReceiptV4 => {
  if (!isRecord(value)) return false;
  const photoArm = value.purpose === 'piece_image' && hasExactKeys(value, PHOTO_RECEIPT_KEYS_V4);
  const motionArm = value.purpose === 'piece_motion' && hasExactKeys(value, MOTION_RECEIPT_KEYS_V4);
  if (
    (!photoArm && !motionArm) ||
    !isSafeId(value.authorizationId) ||
    !isSafeId(value.quoteId) ||
    !isIntegerInRange(value.quoteRevision, 1, Number.MAX_SAFE_INTEGER) ||
    !isSafeId(value.itemId) ||
    !isSafeId(value.jobId) ||
    !isSafeId(value.routeId) ||
    !isCurrency(value.currency) ||
    !isIntegerInRange(value.rateMinorUnits, 1, Number.MAX_SAFE_INTEGER) ||
    value.generationCount !== 1 ||
    !isIntegerInRange(value.totalMinorUnits, 1, Number.MAX_SAFE_INTEGER) ||
    !isCanonicalTimestamp(value.recordedAt)
  ) {
    return false;
  }
  if (photoArm) return value.rateUnit === 'generation' && value.totalMinorUnits === value.rateMinorUnits;
  return (
    value.rateUnit === 'second' &&
    isIntegerInRange(value.requestedDurationSeconds, 4, 15) &&
    isIntegerInRange(value.billedDurationSeconds, 4, 15) &&
    value.totalMinorUnits === value.rateMinorUnits * value.billedDurationSeconds
  );
};

const validatePieceJobV4 = (jobId: string, projectId: string, value: unknown): value is StudioPieceJobV4 => {
  if (!isRecord(value)) return false;
  const photoArm = value.purpose === 'piece_image' && hasExactKeys(value, PHOTO_JOB_KEYS_V4);
  const motionArm = value.purpose === 'piece_motion' && hasExactKeys(value, MOTION_JOB_KEYS_V4);
  if (!photoArm && !motionArm) return false;
  const errorIsValid =
    value.error === null ||
    (isRecord(value.error) &&
      hasExactKeys(value.error, JOB_ERROR_KEYS) &&
      typeof value.error.code === 'string' &&
      PIECE_JOB_ERROR_CODES_V3.has(value.error.code) &&
      isNonEmptyStringWithin(value.error.messageKey, 256));
  if (
    value.id !== jobId ||
    !isSafeId(jobId) ||
    value.projectId !== projectId ||
    !validatePieceTargetV3(value.target) ||
    typeof value.status !== 'string' ||
    !PIECE_JOB_STATUSES_V4.has(value.status as StudioPieceJobV4['status']) ||
    !validateProvider(value.provider) ||
    !isSafeId(value.idempotencyKey) ||
    (value.providerSubmissionKind !== null &&
      value.providerSubmissionKind !== 'complete' &&
      value.providerSubmissionKind !== 'remote') ||
    (value.providerJobId !== null &&
      (typeof value.providerJobId !== 'string' || !isValidProviderJobId(value.providerJobId))) ||
    (value.remoteStartedAt !== null && !isCanonicalTimestamp(value.remoteStartedAt)) ||
    (value.providerJobId === null) !== (value.remoteStartedAt === null) ||
    (value.cancellationPolicy !== 'none' &&
      value.cancellationPolicy !== 'queued_only' &&
      value.cancellationPolicy !== 'queued_and_running') ||
    !isRecord(value.outputAssetIdsByRole) ||
    !hasExactKeys(value.outputAssetIdsByRole, ASSET_IDS_BY_ROLE_KEYS_V4) ||
    !isNullableSafeId(value.outputAssetIdsByRole.primary) ||
    !isNullableSafeId(value.outputAssetIdsByRole.poster) ||
    (value.outputAssetIdsByRole.primary !== null &&
      value.outputAssetIdsByRole.primary === value.outputAssetIdsByRole.poster) ||
    !errorIsValid ||
    (value.progress !== null && !isFiniteInRange(value.progress, 0, 100)) ||
    !validatePiecePublicationIntentV4(value.publication) ||
    !validatePieceGenerationAttemptV4(value.attempt) ||
    typeof value.duplicateChargeAcknowledged !== 'boolean' ||
    (value.duplicateChargeAcknowledgedAt !== null && !isCanonicalTimestamp(value.duplicateChargeAcknowledgedAt)) ||
    (value.attempt.kind === 'retry' && value.attempt.reason === 'submission_unknown'
      ? !value.duplicateChargeAcknowledged || value.duplicateChargeAcknowledgedAt === null
      : value.duplicateChargeAcknowledged || value.duplicateChargeAcknowledgedAt !== null) ||
    !isSafeId(value.authorizationId) ||
    !isSafeId(value.authorizationItemId) ||
    !validateStudioPieceGenerationCompositionV4(value.composition) ||
    !validatePieceRequestPlanV4(value.requestPlan) ||
    (value.spendReceipt !== null && !validatePieceReceiptV4(value.spendReceipt)) ||
    !isIntegerInRange(value.authoringRevision, 1, Number.MAX_SAFE_INTEGER) ||
    value.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V4 ||
    !isLowercaseDigest(value.authoringFingerprint) ||
    !isIntegerInRange(value.projectRevisionAtPreparation, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.projectRevisionAtAuthorization, 1, Number.MAX_SAFE_INTEGER) ||
    value.projectRevisionAtAuthorization <= value.projectRevisionAtPreparation ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt
  ) {
    return false;
  }
  const requestPlan = value.requestPlan as StudioPieceGenerationRequestPlanV4;
  const requestCorrelationValid = photoArm
    ? value.status !== 'waiting_for_conditioning' &&
      requestPlan.kind === 'resolved' &&
      requestPlan.snapshot.composition.inputs.purpose === 'piece_image' &&
      canonicalValuesEqualV3(requestPlan.snapshot.composition, value.composition)
    : requestPlan.kind === 'resolved'
      ? value.status !== 'waiting_for_conditioning' &&
        validatePieceMotionRequestSnapshotV4(value.requestSnapshot) &&
        canonicalValuesEqualV3(requestPlan.snapshot, value.requestSnapshot) &&
        canonicalValuesEqualV3(requestPlan.snapshot.composition, value.composition)
      : canonicalValuesEqualV3(requestPlan.template.composition, value.composition) &&
        (value.requestSnapshot === null
          ? value.status === 'waiting_for_conditioning' || value.status === 'cancelled'
          : value.status !== 'waiting_for_conditioning' &&
            validatePieceMotionRequestSnapshotV4(value.requestSnapshot) &&
            value.requestSnapshot.firstFrame !== null &&
            motionSnapshotResolvesTemplateV4(value.requestSnapshot, requestPlan));
  if (!requestCorrelationValid) return false;
  const unresolvedDeferred =
    motionArm && requestPlan.kind === 'after_upstream_completion' && value.requestSnapshot === null;
  if (
    unresolvedDeferred &&
    ((value.status !== 'waiting_for_conditioning' && value.status !== 'cancelled') ||
      value.providerSubmissionKind !== null ||
      value.providerJobId !== null ||
      value.remoteStartedAt !== null ||
      value.outputAssetIdsByRole.primary !== null ||
      value.outputAssetIdsByRole.poster !== null ||
      value.error !== null ||
      value.progress !== null ||
      value.spendReceipt !== null)
  )
    return false;
  const composition = value.composition as StudioPieceGenerationCompositionV4;
  const target = value.target as StudioPieceGenerationTargetV3;
  if (
    target.pieceId !== composition.inputs.source.pieceId ||
    value.purpose !== composition.inputs.purpose ||
    !providersEqual(value.provider, composition.inputs.route) ||
    value.authoringRevision !== composition.inputs.authoringRevision ||
    value.authoringFingerprintVersion !== composition.inputs.authoringFingerprintVersion ||
    value.authoringFingerprint !== composition.inputs.authoringFingerprint ||
    value.projectRevisionAtPreparation !== composition.inputs.projectRevisionAtPreparation ||
    (value.purpose === 'piece_image' && value.outputAssetIdsByRole.poster !== null)
  ) {
    return false;
  }
  const status = value.status as StudioPieceJobV4['status'];
  const errorCode = isRecord(value.error) && typeof value.error.code === 'string' ? value.error.code : null;
  if (status === 'needs_attention' && errorCode !== 'submission_unknown' && errorCode !== 'poll_deadline') return false;
  if (
    (status === 'waiting_for_conditioning' || status === 'queued_local' || status === 'submitting') &&
    (value.providerSubmissionKind !== null ||
      value.providerJobId !== null ||
      value.remoteStartedAt !== null ||
      value.progress !== null ||
      value.error !== null)
  ) {
    return false;
  }
  const hasRemoteSubmission =
    value.providerSubmissionKind === 'remote' && value.providerJobId !== null && value.remoteStartedAt !== null;
  const hasCompleteSubmission =
    value.providerSubmissionKind === 'complete' && value.providerJobId === null && value.remoteStartedAt === null;
  if (
    (value.providerSubmissionKind === 'remote' && !hasRemoteSubmission) ||
    (value.providerSubmissionKind !== 'remote' && (value.providerJobId !== null || value.remoteStartedAt !== null)) ||
    ((status === 'queued_remote' ||
      status === 'running' ||
      (status === 'needs_attention' && errorCode === 'poll_deadline')) &&
      !hasRemoteSubmission) ||
    ((status === 'succeeded' || value.spendReceipt !== null) && !hasRemoteSubmission && !hasCompleteSubmission)
  ) {
    return false;
  }
  if (
    value.providerSubmissionKind === 'complete' &&
    !(
      status === 'succeeded' ||
      (status === 'failed' &&
        (errorCode === 'no_output' || errorCode === 'variation_grid' || errorCode === 'download_failed')) ||
      (status === 'needs_attention' && errorCode === 'submission_unknown' && value.spendReceipt !== null)
    )
  ) {
    return false;
  }
  if (
    value.providerSubmissionKind === 'remote' &&
    ((status === 'needs_attention' && errorCode !== 'poll_deadline') || errorCode === 'submission_unknown')
  ) {
    return false;
  }
  if (
    (errorCode === 'variation_grid' && status !== 'failed') ||
    (errorCode === 'poll_deadline' && status !== 'needs_attention') ||
    (errorCode === 'submission_unknown' && status !== 'failed' && status !== 'needs_attention')
  ) {
    return false;
  }
  const receiptRequired =
    status === 'succeeded' ||
    (status === 'failed' &&
      (errorCode === 'no_output' || errorCode === 'variation_grid' || errorCode === 'download_failed'));
  const receiptAllowed =
    receiptRequired ||
    status === 'running' ||
    (status === 'needs_attention' && (errorCode === 'poll_deadline' || errorCode === 'submission_unknown'));
  if ((receiptRequired && value.spendReceipt === null) || (!receiptAllowed && value.spendReceipt !== null))
    return false;
  if (status === 'succeeded') {
    return value.outputAssetIdsByRole.primary !== null && value.error === null;
  }
  if (value.outputAssetIdsByRole.primary !== null || value.outputAssetIdsByRole.poster !== null) return false;
  if (status === 'failed' || status === 'needs_attention') return value.error !== null;
  if (ACTIVE_PIECE_JOB_STATUSES_V4.has(status)) return value.error === null;
  return status === 'cancelled' && value.error === null;
};

const validatePieceRecordV4 = (pieceId: string, value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PIECE_KEYS_V4) &&
  value.id === pieceId &&
  isSafeId(pieceId) &&
  (value.kind === 'photograph' || value.kind === 'motion') &&
  isCanonicalStudioPieceHandleV3(value.handle) &&
  (value.runStem === null || isCanonicalStudioPieceHandleV3(value.runStem)) &&
  validatePriorHandlesV4(value.priorHandles, value.handle as string) &&
  isNullableSafeId(value.currentAssetId) &&
  isUniqueSafeIdArray(value.jobIds, STUDIO_MAX_JOBS_PER_PIECE_V3) &&
  isDenseArray(value.assetHistory, STUDIO_MAX_ASSET_HISTORY_ENTRIES_PER_PIECE_V4) &&
  isCanonicalTimestamp(value.createdAt) &&
  isCanonicalTimestamp(value.updatedAt) &&
  value.createdAt <= value.updatedAt;

const isCanonicalPieceManagedAssetFileNameV4 = (assetId: string, mimeType: string, value: unknown): value is string => {
  const extension = PIECE_ASSET_EXTENSION_BY_MIME_TYPE_V4.get(mimeType);
  return extension !== undefined && isSafeFileName(value) && value === `${assetId}.${extension}`;
};

const validatePieceAssetFactsV4 = (value: unknown, tombstone: boolean): value is StudioAssetV4 => {
  if (!isRecord(value)) return false;
  const motion = value.mediaKind === 'video';
  const keys = tombstone
    ? motion
      ? MOTION_ASSET_TOMBSTONE_KEYS_V4
      : PHOTO_ASSET_TOMBSTONE_KEYS_V4
    : motion
      ? MOTION_ASSET_KEYS_V4
      : PHOTO_ASSET_KEYS_V4;
  if (
    !hasExactKeys(value, keys) ||
    !isSafeId(value.id) ||
    (!tombstone && (!isSafeId(value.projectId) || !isSafeId(value.pieceId))) ||
    (motion
      ? value.role !== 'primary' ||
        (value.mimeType !== 'video/mp4' && value.mimeType !== 'video/webm') ||
        !isFiniteInRange(value.durationSeconds, Number.EPSILON, 86_400)
      : (value.role !== 'primary' && value.role !== 'poster') || !isStudioReferenceImageMimeType(value.mimeType)) ||
    !isIntegerInRange(value.byteSize, 1, motion ? STUDIO_MAX_VIDEO_ASSET_BYTES_V4 : STUDIO_MAX_IMAGE_ASSET_BYTES_V4) ||
    !isLowercaseDigest(value.sha256) ||
    !isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return false;
  }
  if (!tombstone) {
    if (
      !isRecord(value.managedAsset) ||
      !hasExactKeys(value.managedAsset, MANAGED_ASSET_KEYS_V4) ||
      !isCanonicalPieceManagedAssetFileNameV4(value.id, value.mimeType as string, value.managedAsset.fileName)
    ) {
      return false;
    }
  }
  const managedCollection =
    tombstone || !isRecord(value.managedAsset) ? null : (value.managedAsset.collection as unknown);
  if (value.origin === 'imported') {
    return (
      value.role === 'primary' &&
      (tombstone || managedCollection === 'imports') &&
      value.producerJobId === null &&
      value.compositionDigest === null
    );
  }
  return (
    value.origin === 'generated' &&
    (tombstone || managedCollection === 'assets') &&
    isSafeId(value.producerJobId) &&
    isLowercaseDigest(value.compositionDigest)
  );
};

const validatePieceAssetV4 = (assetId: string, projectId: string, value: unknown): value is StudioAssetV4 =>
  validatePieceAssetFactsV4(value, false) && value.id === assetId && value.projectId === projectId;

const validatePieceAssetTombstoneV4 = (value: unknown): value is StudioPieceAssetTombstoneV4 =>
  validatePieceAssetFactsV4(value, true);

const validateDerivedFrameAssetV4 = (
  assetId: string,
  projectId: string,
  value: unknown
): value is StudioDerivedFrameAssetV4 =>
  isRecord(value) &&
  hasExactKeys(value, DERIVED_FRAME_ASSET_KEYS_V4) &&
  value.id === assetId &&
  isSafeId(assetId) &&
  value.projectId === projectId &&
  isSafeId(value.targetPieceId) &&
  isSafeId(value.extractionId) &&
  value.mediaKind === 'image' &&
  value.role === 'conditioning_frame' &&
  isStudioReferenceImageMimeType(value.mimeType) &&
  isRecord(value.managedAsset) &&
  hasExactKeys(value.managedAsset, MANAGED_ASSET_KEYS_V4) &&
  value.managedAsset.collection === 'assets' &&
  isCanonicalPieceManagedAssetFileNameV4(assetId, value.mimeType, value.managedAsset.fileName) &&
  isIntegerInRange(value.byteSize, 1, STUDIO_MAX_IMAGE_ASSET_BYTES_V4) &&
  isLowercaseDigest(value.sha256) &&
  isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER) &&
  isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER) &&
  isCanonicalTimestamp(value.createdAt);

const validateFrameExtractionV4 = (
  extractionId: string,
  projectId: string,
  value: unknown
): value is StudioFrameExtractionV4 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, FRAME_EXTRACTION_KEYS_V4) ||
    value.id !== extractionId ||
    !isSafeId(extractionId) ||
    value.projectId !== projectId ||
    !isSafeId(value.targetPieceId) ||
    !isSafeId(value.jobId) ||
    !isSafeId(value.assemblyId) ||
    !isSafeId(value.boardId) ||
    !isSafeId(value.dependentShotId) ||
    !isSafeId(value.predecessorShotId) ||
    value.dependentShotId === value.predecessorShotId ||
    !isSafeId(value.sourcePieceId) ||
    !isSafeId(value.sourceVideoAssetId) ||
    !isLowercaseDigest(value.sourceVideoSha256) ||
    !isFiniteInRange(value.endpointSeconds, Number.EPSILON, 86_400) ||
    !isNullableSafeId(value.frameAssetId) ||
    (value.status !== 'pending' &&
      value.status !== 'extracting' &&
      value.status !== 'ready' &&
      value.status !== 'failed') ||
    (value.errorCode !== null &&
      value.errorCode !== 'decode_failed' &&
      value.errorCode !== 'source_missing' &&
      value.errorCode !== 'storage_error') ||
    !isIntegerInRange(value.attemptCount, 0, 3) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt
  )
    return false;
  if (value.status === 'ready')
    return value.frameAssetId !== null && value.errorCode === null && value.attemptCount >= 1;
  if (value.status === 'failed')
    return value.frameAssetId === null && value.errorCode !== null && value.attemptCount >= 1;
  if (value.status === 'extracting')
    return value.frameAssetId === null && value.errorCode === null && value.attemptCount >= 1;
  return value.frameAssetId === null && value.errorCode === null && value.attemptCount === 0;
};

type StudioAssetFactsV4 = StudioAssetV4 | StudioPieceAssetTombstoneV4;
type StudioPieceMediaVersionV4 = {
  state: 'current' | 'retained' | 'evicted';
  primary: StudioAssetFactsV4;
  poster: StudioAssetFactsV4 | null;
  supersededAt: string | null;
};

const pieceAssetMatchesKindV4 = (
  pieceKind: StudioProjectV4['pieces'][string]['kind'],
  asset: StudioAssetFactsV4
): boolean =>
  asset.role === 'primary' &&
  ((pieceKind === 'photograph' && asset.mediaKind === 'image') ||
    (pieceKind === 'motion' && asset.mediaKind === 'video'));

const effectivePieceJobCompositionV4 = (job: StudioPieceJobV4): StudioPieceGenerationCompositionV4 =>
  job.purpose === 'piece_motion' && job.requestSnapshot !== null ? job.requestSnapshot.composition : job.composition;

const generatedVersionPairIsValidV4 = (
  project: StudioProjectV4,
  pieceId: string,
  primary: StudioAssetFactsV4,
  poster: StudioAssetFactsV4 | null
): boolean => {
  if (primary.origin === 'imported') return poster === null;
  const job = ownValue(project.jobs, primary.producerJobId);
  if (
    job === undefined ||
    job.status !== 'succeeded' ||
    job.target.pieceId !== pieceId ||
    job.outputAssetIdsByRole.primary !== primary.id ||
    primary.compositionDigest !== studioPieceGenerationCompositionDigestV4(effectivePieceJobCompositionV4(job))
  ) {
    return false;
  }
  if (poster === null) return job.outputAssetIdsByRole.poster === null;
  return (
    primary.mediaKind === 'video' &&
    poster.mediaKind === 'image' &&
    poster.role === 'poster' &&
    poster.origin === 'generated' &&
    poster.producerJobId === job.id &&
    poster.compositionDigest === primary.compositionDigest &&
    poster.createdAt === primary.createdAt &&
    job.outputAssetIdsByRole.poster === poster.id
  );
};

/** Resolves each media version as a primary plus its optional poster, never as two versions. */
const projectAssetLineageV4 = (project: StudioProjectV4): StudioProjectAssetLineageValidationV4 | null => {
  const owners = new Map<string, string>();
  const tombstones = new Map<string, StudioPieceAssetTombstoneV4>();
  const versionsByPiece = new Map<string, StudioPieceMediaVersionV4[]>();
  const liveAssetIds = new Set<string>();
  const add = (asset: StudioAssetFactsV4, pieceId: string, live: boolean): boolean => {
    if (owners.has(asset.id) || (live && 'pieceId' in asset && asset.pieceId !== pieceId)) return false;
    owners.set(asset.id, pieceId);
    if (live) liveAssetIds.add(asset.id);
    else tombstones.set(asset.id, asset as StudioPieceAssetTombstoneV4);
    return true;
  };
  for (const piece of Object.values(project.pieces)) {
    const versions: StudioPieceMediaVersionV4[] = [];
    let previousSupersededAt = '';
    let previousEvictedAt = '';
    let importedCount = 0;
    let retainedHistorySeen = false;
    for (const entry of piece.assetHistory) {
      if (
        !isRecord(entry) ||
        !isCanonicalTimestamp(entry.supersededAt) ||
        entry.supersededAt < piece.createdAt ||
        entry.supersededAt > piece.updatedAt ||
        entry.supersededAt < previousSupersededAt
      ) {
        return null;
      }
      let primary: StudioAssetFactsV4;
      let poster: StudioAssetFactsV4 | null;
      if (entry.state === 'retained' && hasExactKeys(entry, RETAINED_ASSET_HISTORY_KEYS_V4)) {
        retainedHistorySeen = true;
        if (
          !isRecord(entry.assetIdsByRole) ||
          !hasExactKeys(entry.assetIdsByRole, ASSET_IDS_BY_ROLE_KEYS_V4) ||
          !isSafeId(entry.assetIdsByRole.primary) ||
          !isNullableSafeId(entry.assetIdsByRole.poster) ||
          entry.assetIdsByRole.primary === entry.assetIdsByRole.poster
        ) {
          return null;
        }
        const retainedPrimary = ownValue(project.assets, entry.assetIdsByRole.primary as string);
        const retainedPoster =
          entry.assetIdsByRole.poster === null
            ? null
            : (ownValue(project.assets, entry.assetIdsByRole.poster as string) ?? null);
        if (retainedPrimary === undefined || (entry.assetIdsByRole.poster !== null && retainedPoster === null))
          return null;
        primary = retainedPrimary;
        poster = retainedPoster;
        if (!add(primary, piece.id, true) || (poster !== null && !add(poster, piece.id, true))) return null;
      } else if (
        entry.state === 'evicted' &&
        !retainedHistorySeen &&
        hasExactKeys(entry, EVICTED_ASSET_HISTORY_KEYS_V4) &&
        isRecord(entry.assetsByRole) &&
        hasExactKeys(entry.assetsByRole, ASSET_IDS_BY_ROLE_KEYS_V4) &&
        validatePieceAssetTombstoneV4(entry.assetsByRole.primary) &&
        (entry.assetsByRole.poster === null || validatePieceAssetTombstoneV4(entry.assetsByRole.poster)) &&
        isCanonicalTimestamp(entry.evictedAt) &&
        entry.evictedAt >= entry.supersededAt &&
        entry.evictedAt >= previousEvictedAt &&
        entry.evictedAt <= project.updatedAt
      ) {
        primary = entry.assetsByRole.primary;
        poster = entry.assetsByRole.poster;
        previousEvictedAt = entry.evictedAt;
        if (!add(primary, piece.id, false) || (poster !== null && !add(poster, piece.id, false))) return null;
      } else {
        return null;
      }
      if (
        !pieceAssetMatchesKindV4(piece.kind, primary) ||
        primary.createdAt < (versions.at(-1)?.primary.createdAt ?? piece.createdAt) ||
        primary.createdAt > entry.supersededAt ||
        (poster !== null && poster.createdAt !== primary.createdAt) ||
        !generatedVersionPairIsValidV4(project, piece.id, primary, poster)
      ) {
        return null;
      }
      if (primary.origin === 'imported') importedCount += 1;
      versions.push({ state: entry.state, primary, poster, supersededAt: entry.supersededAt });
      previousSupersededAt = entry.supersededAt;
    }
    if (piece.currentAssetId !== null) {
      const primary = ownValue(project.assets, piece.currentAssetId);
      if (primary === undefined || !pieceAssetMatchesKindV4(piece.kind, primary) || !add(primary, piece.id, true))
        return null;
      const producer = primary.origin === 'generated' ? ownValue(project.jobs, primary.producerJobId) : undefined;
      const posterId = producer?.outputAssetIdsByRole.poster ?? null;
      const poster = posterId === null ? null : (ownValue(project.assets, posterId) ?? null);
      if (
        (posterId !== null && poster === null) ||
        (poster !== null && !add(poster, piece.id, true)) ||
        primary.createdAt < piece.createdAt ||
        primary.createdAt > piece.updatedAt ||
        (previousSupersededAt !== '' && primary.createdAt < previousSupersededAt) ||
        !generatedVersionPairIsValidV4(project, piece.id, primary, poster)
      ) {
        return null;
      }
      if (primary.origin === 'imported') importedCount += 1;
      versions.push({ state: 'current', primary, poster, supersededAt: null });
    } else if (piece.assetHistory.length !== 0) {
      return null;
    }
    if (
      importedCount > 1 ||
      (importedCount === 1 && versions[0]?.primary.origin !== 'imported') ||
      versions.slice(importedCount).some((version) => version.primary.origin !== 'generated') ||
      versions.length > piece.jobIds.length + importedCount
    ) {
      return null;
    }
    versionsByPiece.set(piece.id, versions);
  }
  const projectAssetIds = Object.keys(project.assets);
  if (projectAssetIds.length !== liveAssetIds.size || projectAssetIds.some((id) => !liveAssetIds.has(id))) return null;
  return { owners, tombstones, versionsByPiece };
};

const currentAssetSnapshotMatchesV4 = (
  snapshot: StudioPieceCurrentAssetSnapshotV4,
  pieceId: string,
  asset: StudioAssetFactsV4
): boolean => {
  const { id: _id, ...facts } = asset;
  const expected = { ...facts, pieceId, assetId: asset.id } as Record<string, unknown>;
  delete expected.projectId;
  delete expected.managedAsset;
  return canonicalValuesEqualV3(snapshot, expected);
};

/** Replays immutable publication intent across primary media versions; poster artifacts follow their version. */
const validatePiecePublicationLineageV4 = (
  project: StudioProjectV4,
  assetLineage: StudioProjectAssetLineageValidationV4
): boolean => {
  const authorizations = new Map(project.spendAuthorizations.map((authorization) => [authorization.id, authorization]));
  for (const piece of Object.values(project.pieces)) {
    const versions = assetLineage.versionsByPiece.get(piece.id) ?? [];
    const importedFirst = versions[0]?.primary.origin === 'imported';
    const generatedVersions = versions.slice(importedFirst ? 1 : 0);
    const succeededJobs = piece.jobIds.flatMap((jobId) => {
      const job = ownValue(project.jobs, jobId);
      return job?.status === 'succeeded' ? [job] : [];
    });
    if (
      succeededJobs.length !== generatedVersions.length ||
      succeededJobs.some((job, index) => job.outputAssetIdsByRole.primary !== generatedVersions[index]?.primary.id)
    ) {
      return false;
    }
    let simulatedCurrent: StudioAssetFactsV4 | null = importedFirst ? versions[0]!.primary : null;
    let successfulIndex = 0;
    let previousJobId: string | null = null;
    let previousUpdatedAt = '';
    for (const jobId of piece.jobIds) {
      const job = ownValue(project.jobs, jobId);
      const authorization = job === undefined ? undefined : authorizations.get(job.authorizationId);
      if (
        job === undefined ||
        authorization === undefined ||
        job.createdAt < previousUpdatedAt ||
        !canonicalValuesEqualV3(authorization.quote.item.publication, job.publication) ||
        !canonicalValuesEqualV3(authorization.quote.item.attempt, job.attempt)
      ) {
        return false;
      }
      if (job.attempt.kind === 'retry') {
        const predecessor = ownValue(project.jobs, job.attempt.sourceJobId);
        if (
          job.attempt.sourceJobId !== previousJobId ||
          predecessor === undefined ||
          !canonicalValuesEqualV3(predecessor.publication, job.publication)
        ) {
          return false;
        }
      }
      if (job.publication.kind === 'fill_empty') {
        if (simulatedCurrent !== null) return false;
      } else if (
        simulatedCurrent === null ||
        job.publication.currentAsset.assetId !== simulatedCurrent.id ||
        !currentAssetSnapshotMatchesV4(job.publication.currentAsset, piece.id, simulatedCurrent) ||
        simulatedCurrent.createdAt > authorization.confirmedAt
      ) {
        return false;
      }
      if (job.status === 'succeeded') {
        const version = generatedVersions[successfulIndex];
        if (version === undefined || version.primary.createdAt !== job.updatedAt) return false;
        if (simulatedCurrent !== null) {
          const historyEntry = piece.assetHistory[successfulIndex + (importedFirst ? 0 : -1)];
          if (
            historyEntry === undefined ||
            historyEntry.supersededAt !== version.primary.createdAt ||
            (historyEntry.state === 'retained'
              ? historyEntry.assetIdsByRole.primary
              : historyEntry.assetsByRole.primary.id) !== simulatedCurrent.id
          ) {
            return false;
          }
        }
        simulatedCurrent = version.primary;
        successfulIndex += 1;
      }
      previousJobId = job.id;
      previousUpdatedAt = job.updatedAt;
    }
    if (successfulIndex !== generatedVersions.length || (simulatedCurrent?.id ?? null) !== piece.currentAssetId) {
      return false;
    }
  }
  return true;
};

const isCanonicalNonNegativeNumberV4 = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0) && value >= 0 && value <= maximum;

const validateSourceRangeV4 = (sourceInSeconds: unknown, sourceOutSeconds: unknown): boolean =>
  isCanonicalNonNegativeNumberV4(sourceInSeconds, 86_400) &&
  (sourceOutSeconds === null ||
    (isCanonicalNonNegativeNumberV4(sourceOutSeconds, 86_400) && sourceOutSeconds > sourceInSeconds));

const validatePriorHandlesV4 = (value: unknown, currentHandle: string): value is string[] =>
  isDenseArray(value, STUDIO_MAX_PIECE_PRIOR_HANDLES_V3) &&
  new Set(value).size === value.length &&
  arrayEvery(
    value,
    (handle) => typeof handle === 'string' && handle !== currentHandle && isCanonicalStudioPieceHandleV3(handle)
  );

const validateBoardBeatV4 = (id: string, value: unknown): value is StudioBoardBeatV4 =>
  isRecord(value) &&
  hasExactKeys(value, BOARD_BEAT_KEYS_V4) &&
  value.id === id &&
  isNonEmptyStringWithin(value.title, 256) &&
  isStringWithin(value.story, STUDIO_MAX_STORY_LENGTH) &&
  (value.targetSeconds === null || isIntegerInRange(value.targetSeconds, 1, 1_440)) &&
  isUniqueSafeIdArray(value.shotOrder, STUDIO_MAX_SHOTS_PER_BOARD_V4) &&
  value.shotOrder.length > 0;

const validateBoardShotV4 = (
  id: string,
  value: unknown,
  boardCreatedAt: string,
  boardUpdatedAt: string
): value is StudioBoardShotV4 =>
  isRecord(value) &&
  hasExactKeys(value, BOARD_SHOT_KEYS_V4) &&
  value.id === id &&
  isNonEmptyStringWithin(value.shootingScript, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) &&
  isIntegerInRange(value.durationSeconds, STUDIO_MIN_SHOT_SECONDS, STUDIO_MAX_SHOT_SECONDS) &&
  isCanonicalTimestamp(value.createdAt) &&
  isCanonicalTimestamp(value.updatedAt) &&
  value.createdAt >= boardCreatedAt &&
  value.createdAt <= value.updatedAt &&
  value.updatedAt <= boardUpdatedAt;

const validateBoardV4 = (
  id: string,
  value: unknown,
  projectCreatedAt: string,
  projectUpdatedAt: string
): value is StudioBoardV2 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BOARD_KEYS_V4) ||
    value.id !== id ||
    !isCanonicalStudioPieceHandleV3(value.handle) ||
    !validatePriorHandlesV4(value.priorHandles, value.handle as string) ||
    !isUniqueSafeIdArray(value.beatOrder, STUDIO_MAX_BEATS_PER_BOARD_V4) ||
    value.beatOrder.length === 0 ||
    !isRecord(value.beats) ||
    !isRecord(value.shots) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.createdAt < projectCreatedAt ||
    value.createdAt > value.updatedAt ||
    value.updatedAt > projectUpdatedAt
  ) {
    return false;
  }
  const board = value as StudioBoardV2;
  const beatIds = Object.keys(board.beats);
  const shotIds = Object.keys(board.shots);
  if (
    beatIds.length !== board.beatOrder.length ||
    shotIds.length === 0 ||
    shotIds.length > STUDIO_MAX_SHOTS_PER_BOARD_V4 ||
    !arrayEvery(board.beatOrder, (beatId) => Object.hasOwn(board.beats, beatId)) ||
    !beatIds.every((beatId) => validateBoardBeatV4(beatId, board.beats[beatId])) ||
    !shotIds.every((shotId) => validateBoardShotV4(shotId, board.shots[shotId], board.createdAt, board.updatedAt))
  ) {
    return false;
  }
  const orderedShots = board.beatOrder.flatMap((beatId) => board.beats[beatId]!.shotOrder);
  return (
    orderedShots.length === shotIds.length &&
    new Set(orderedShots).size === shotIds.length &&
    arrayEvery(orderedShots, (shotId) => Object.hasOwn(board.shots, shotId))
  );
};

const validateChainStalenessV4 = (
  value: unknown,
  shotId: string,
  expectedUpstreamShotId: string | null,
  board: StudioBoardV2,
  authoringRevision: number,
  projectCreatedAt: string,
  projectUpdatedAt: string
): boolean =>
  isRecord(value) &&
  hasExactKeys(value, CHAIN_STALENESS_KEYS_V4) &&
  value.cause === 'chain' &&
  value.upstreamShotId === expectedUpstreamShotId &&
  (value.upstreamShotId === null ||
    (isSafeId(value.upstreamShotId) &&
      value.upstreamShotId !== shotId &&
      Object.hasOwn(board.shots, value.upstreamShotId))) &&
  isIntegerInRange(value.sourceAuthoringRevision, 1, authoringRevision) &&
  (value.keptAt === null ||
    (isCanonicalTimestamp(value.keptAt) && value.keptAt >= projectCreatedAt && value.keptAt <= projectUpdatedAt));

const validateAssemblyPictureBindingV4 = (
  shotId: string,
  value: unknown,
  upstreamShotId: string | null,
  board: StudioBoardV2,
  assemblyUpdatedAt: string,
  project: StudioProjectV4,
  assetLineage: StudioProjectAssetLineageValidationV4
): value is StudioAssemblyPictureBindingV2 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ASSEMBLY_PICTURE_BINDING_KEYS_V4) ||
    value.shotId !== shotId ||
    !validateSourceRangeV4(value.sourceInSeconds, value.sourceOutSeconds) ||
    (value.join !== 'hard_cut' && value.join !== 'match_previous') ||
    (upstreamShotId === null && value.join !== 'hard_cut') ||
    (value.staleness !== null &&
      !validateChainStalenessV4(
        value.staleness,
        shotId,
        value.join === 'hard_cut' ? null : upstreamShotId,
        board,
        project.authoringRevision,
        project.createdAt,
        project.updatedAt
      ))
  ) {
    return false;
  }
  if (value.source === null) {
    return value.sourceInSeconds === 0 && value.sourceOutSeconds === null && value.staleness === null;
  }
  if (!isRecord(value.source) || !hasExactKeys(value.source, ASSEMBLY_PICTURE_SOURCE_KEYS_V4)) return false;
  const piece = ownValue(project.pieces, value.source.pieceId as string);
  if (!isSafeId(value.source.pieceId) || piece === undefined) return false;
  if (value.source.assetId === null) {
    return (
      piece.currentAssetId === null &&
      value.sourceInSeconds === 0 &&
      value.sourceOutSeconds === null &&
      value.staleness === null
    );
  }
  const asset = ownValue(project.assets, value.source.assetId as string);
  if (
    !isSafeId(value.source.assetId) ||
    asset === undefined ||
    asset.createdAt > assemblyUpdatedAt ||
    assetLineage.owners.get(asset.id) !== piece.id ||
    asset.role !== 'primary' ||
    (piece.kind === 'photograph' ? asset.mediaKind !== 'image' : asset.mediaKind !== 'video')
  ) {
    return false;
  }
  if (asset.mediaKind === 'image') return value.sourceInSeconds === 0 && value.sourceOutSeconds === null;
  const sourceEndSeconds = value.sourceOutSeconds === null ? asset.durationSeconds : (value.sourceOutSeconds as number);
  return (
    (value.sourceInSeconds as number) < asset.durationSeconds &&
    sourceEndSeconds <= asset.durationSeconds &&
    sourceEndSeconds - (value.sourceInSeconds as number) === board.shots[shotId]!.durationSeconds
  );
};

const validateAssemblyV4 = (
  id: string,
  value: unknown,
  project: StudioProjectV4,
  assetLineage: StudioProjectAssetLineageValidationV4
): value is StudioAssemblyV2 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ASSEMBLY_KEYS_V4) ||
    value.id !== id ||
    !isCanonicalStudioPieceHandleV3(value.handle) ||
    !validatePriorHandlesV4(value.priorHandles, value.handle as string) ||
    !isSafeId(value.boardId) ||
    !isRecord(value.pictureBindings) ||
    !isUniqueSafeIdArray(value.soundBindingOrder, STUDIO_MAX_SOUND_BINDINGS_PER_ASSEMBLY_V4) ||
    !isRecord(value.soundBindings) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    value.createdAt < project.createdAt ||
    value.createdAt > value.updatedAt ||
    value.updatedAt > project.updatedAt
  ) {
    return false;
  }
  const assembly = value as StudioAssemblyV2;
  const board = ownValue(project.boards, assembly.boardId);
  if (board === undefined || assembly.createdAt < board.createdAt) return false;
  const pictureIds = Object.keys(assembly.pictureBindings);
  const orderedShotIds = board.beatOrder.flatMap((beatId) => board.beats[beatId]!.shotOrder);
  if (
    pictureIds.length !== orderedShotIds.length ||
    !arrayEvery(orderedShotIds, (shotId) => Object.hasOwn(assembly.pictureBindings, shotId)) ||
    Object.keys(assembly.soundBindings).length !== 0 ||
    assembly.soundBindingOrder.length !== 0
  ) {
    return false;
  }
  for (const beatId of board.beatOrder) {
    const shotOrder = board.beats[beatId]!.shotOrder;
    for (let index = 0; index < shotOrder.length; index += 1) {
      const shotId = shotOrder[index]!;
      if (
        !validateAssemblyPictureBindingV4(
          shotId,
          assembly.pictureBindings[shotId],
          index === 0 ? null : shotOrder[index - 1]!,
          board,
          assembly.updatedAt,
          project,
          assetLineage
        )
      ) {
        return false;
      }
    }
  }
  return true;
};

const binSubjectKeyV4 = (entry: StudioCanvasBinEntryV4): string => {
  switch (entry.subject.kind) {
    case 'piece':
      return `piece:${entry.subject.pieceId}`;
    case 'board':
      return `board:${entry.subject.boardId}`;
    case 'board_shot':
      return `board_shot:${entry.subject.boardId}:${entry.subject.shotId}`;
    case 'assembly':
      return `assembly:${entry.subject.assemblyId}`;
  }
};

const binSubjectIsUsedByRetainedAssemblyV4 = (subject: StudioCanvasBinSubjectV4, project: StudioProjectV4): boolean => {
  if (subject.kind === 'assembly') return false;
  for (const assemblyId of project.assemblyOrder) {
    const assembly = ownValue(project.assemblies, assemblyId);
    if (assembly === undefined) return true;
    if (subject.kind === 'board') {
      if (assembly.boardId === subject.boardId) return true;
      continue;
    }
    if (subject.kind === 'board_shot') {
      if (assembly.boardId === subject.boardId && ownValue(assembly.pictureBindings, subject.shotId) !== undefined) {
        return true;
      }
      continue;
    }
    for (const shotId of Object.keys(assembly.pictureBindings)) {
      const binding = ownValue(assembly.pictureBindings, shotId);
      if (binding?.source !== null && binding?.source.pieceId === subject.pieceId) return true;
    }
    for (const soundBindingId of Object.keys(assembly.soundBindings)) {
      const binding = ownValue(assembly.soundBindings, soundBindingId);
      if (binding?.source !== null && binding?.source.pieceId === subject.pieceId) return true;
    }
  }
  return false;
};

const nonterminalJobDependsOnPieceV4 = (project: StudioProjectV4, pieceId: string): boolean =>
  Object.values(project.jobs).some((job) => {
    if (!NONTERMINAL_PIECE_JOB_STATUSES_V4.has(job.status) || job.target.pieceId === pieceId) return false;
    if (job.purpose === 'piece_image') {
      return job.requestPlan.snapshot.conditioningInputs.some((input) => input.pieceId === pieceId);
    }
    if (job.requestPlan.kind === 'after_upstream_completion' && job.requestPlan.dependency.sourcePieceId === pieceId) {
      return true;
    }
    const firstFrame =
      job.requestSnapshot?.firstFrame ??
      (job.requestPlan.kind === 'resolved' ? job.requestPlan.snapshot.firstFrame : null);
    return (
      firstFrame !== null &&
      (firstFrame.kind === 'piece_image' ? firstFrame.pieceId === pieceId : firstFrame.sourcePieceId === pieceId)
    );
  });

const nonterminalJobDependsOnAssemblyV4 = (project: StudioProjectV4, assemblyId: string): boolean =>
  Object.values(project.jobs).some(
    (job) =>
      NONTERMINAL_PIECE_JOB_STATUSES_V4.has(job.status) &&
      job.purpose === 'piece_motion' &&
      job.requestPlan.kind === 'after_upstream_completion' &&
      job.requestPlan.dependency.assemblyId === assemblyId
  );

const validateBinEntryV4 = (
  value: unknown,
  project: StudioProjectV4,
  persistentIdentities: Set<string>
): value is StudioCanvasBinEntryV4 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BIN_ENTRY_KEYS_V4) ||
    !isSafeId(value.id) ||
    persistentIdentities.has(value.id) ||
    !isCanonicalTimestamp(value.liftedAt) ||
    value.liftedAt < project.createdAt ||
    value.liftedAt > project.updatedAt ||
    !isRecord(value.subject)
  ) {
    return false;
  }
  if (
    value.subject.kind === 'piece' &&
    hasExactKeys(value.subject, PIECE_BIN_SUBJECT_KEYS_V4) &&
    isSafeId(value.subject.pieceId)
  ) {
    const piece = ownValue(project.pieces, value.subject.pieceId);
    return (
      value.reason === 'lifted' &&
      piece !== undefined &&
      value.liftedAt >= piece.updatedAt &&
      !nonterminalJobDependsOnPieceV4(project, piece.id) &&
      !piece.jobIds.some((jobId) => {
        const job = ownValue(project.jobs, jobId);
        return job !== undefined && BIN_BLOCKING_JOB_STATUSES_V4.has(job.status);
      })
    );
  }
  if (
    value.subject.kind === 'board' &&
    hasExactKeys(value.subject, BOARD_BIN_SUBJECT_KEYS_V4) &&
    isSafeId(value.subject.boardId)
  ) {
    const board = ownValue(project.boards, value.subject.boardId);
    return value.reason === 'lifted' && board !== undefined && value.liftedAt >= board.updatedAt;
  }
  if (
    value.subject.kind === 'board_shot' &&
    hasExactKeys(value.subject, BOARD_SHOT_BIN_SUBJECT_KEYS_V4) &&
    isSafeId(value.subject.boardId) &&
    isSafeId(value.subject.shotId)
  ) {
    const board = ownValue(project.boards, value.subject.boardId);
    const shot = board === undefined ? undefined : ownValue(board.shots, value.subject.shotId);
    return value.reason === 'lifted' && board !== undefined && shot !== undefined && value.liftedAt >= shot.updatedAt;
  }
  if (
    value.subject.kind === 'assembly' &&
    hasExactKeys(value.subject, ASSEMBLY_BIN_SUBJECT_KEYS_V4) &&
    isSafeId(value.subject.assemblyId)
  ) {
    const assembly = ownValue(project.assemblies, value.subject.assemblyId);
    return (
      value.reason === 'lifted' &&
      assembly !== undefined &&
      value.liftedAt >= assembly.updatedAt &&
      !nonterminalJobDependsOnAssemblyV4(project, assembly.id)
    );
  }
  return false;
};

/**
 * Validates the exact inactive schema-7 Wave-1 envelope. Schema 6 is intentionally rejected and is
 * never defaulted into the new board, Assembly, or Bin collections.
 */
export const validateStudioProjectV4 = (value: unknown): value is StudioProjectV4 => {
  const dataSnapshot = snapshotOwnDataGraph(value);
  if (
    dataSnapshot === INVALID_DATA_SNAPSHOT ||
    !isRecord(dataSnapshot) ||
    !hasExactKeys(dataSnapshot, PROJECT_KEYS_V4)
  ) {
    return false;
  }
  const projectSnapshot = dataSnapshot;
  if (
    projectSnapshot.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION_V4 ||
    !isIntegerInRange(projectSnapshot.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(projectSnapshot.authoringRevision, 1, projectSnapshot.revision as number) ||
    !isStudioProjectIdV4(projectSnapshot.id) ||
    !isNonEmptyStringWithin(projectSnapshot.name, 256) ||
    projectSnapshot.name !== (projectSnapshot.name as string).trim() ||
    !isStringWithin(projectSnapshot.brief, 16 * 1024) ||
    !validateRules(projectSnapshot.rules) ||
    !isNullableSafeId(projectSnapshot.forgeProjectId) ||
    !isNullableSafeId(projectSnapshot.briefConversationId) ||
    !isUniqueSafeIdArray(projectSnapshot.pieceOrder, STUDIO_MAX_PIECES_V3) ||
    !isRecord(projectSnapshot.pieces) ||
    !validateSpendPolicy(projectSnapshot.spendPolicy) ||
    !isDenseArray(projectSnapshot.spendAuthorizations, STUDIO_MAX_SPEND_AUTHORIZATIONS_V3) ||
    !isDenseArray(projectSnapshot.undoHistory, STUDIO_MAX_UNDO_ENTRIES_V3) ||
    !isRecord(projectSnapshot.assets) ||
    !isRecord(projectSnapshot.jobs) ||
    !isUniqueSafeIdArray(projectSnapshot.boardOrder, STUDIO_MAX_BOARDS_V4) ||
    !isRecord(projectSnapshot.boards) ||
    !isUniqueSafeIdArray(projectSnapshot.assemblyOrder, STUDIO_MAX_ASSEMBLIES_V4) ||
    !isRecord(projectSnapshot.assemblies) ||
    !isDenseArray(projectSnapshot.bin, STUDIO_MAX_BIN_ENTRIES_V4) ||
    !isRecord(projectSnapshot.frameExtractions) ||
    !isRecord(projectSnapshot.derivedFrames) ||
    !isCanonicalTimestamp(projectSnapshot.createdAt) ||
    !isCanonicalTimestamp(projectSnapshot.updatedAt) ||
    projectSnapshot.createdAt > projectSnapshot.updatedAt
  ) {
    return false;
  }
  const project = projectSnapshot as StudioProjectV4;
  const pieceIds = Object.keys(project.pieces);
  const assetIds = Object.keys(project.assets);
  const jobIds = Object.keys(project.jobs);
  const frameExtractionIds = Object.keys(project.frameExtractions);
  const derivedFrameIds = Object.keys(project.derivedFrames);
  if (
    !arrayEvery(project.rules, (rule) => rule.createdAt >= project.createdAt && rule.createdAt <= project.updatedAt) ||
    pieceIds.length > STUDIO_MAX_PIECES_V3 ||
    assetIds.length > STUDIO_MAX_ASSETS_V4 ||
    jobIds.length > STUDIO_MAX_JOBS_V3 ||
    frameExtractionIds.length > STUDIO_MAX_FRAME_EXTRACTIONS_V4 ||
    derivedFrameIds.length > STUDIO_MAX_FRAME_EXTRACTIONS_V4 ||
    project.pieceOrder.length !== pieceIds.length ||
    !arrayEvery(project.pieceOrder, (pieceId) => Object.hasOwn(project.pieces, pieceId)) ||
    !pieceIds.every((pieceId) => validatePieceRecordV4(pieceId, project.pieces[pieceId])) ||
    !assetIds.every((assetId) => validatePieceAssetV4(assetId, project.id, project.assets[assetId])) ||
    !jobIds.every((jobId) => validatePieceJobV4(jobId, project.id, project.jobs[jobId])) ||
    !frameExtractionIds.every((id) => validateFrameExtractionV4(id, project.id, project.frameExtractions[id])) ||
    !derivedFrameIds.every((id) => validateDerivedFrameAssetV4(id, project.id, project.derivedFrames[id])) ||
    !validateUndoHistoryV3(project.undoHistory, project as unknown as StudioProjectV3)
  ) {
    return false;
  }

  const managedAssetPaths = new Set<string>();
  for (const asset of Object.values(project.assets)) {
    const path = `${asset.managedAsset.collection}/${asset.managedAsset.fileName}`;
    if (managedAssetPaths.has(path)) return false;
    managedAssetPaths.add(path);
  }
  for (const asset of Object.values(project.derivedFrames)) {
    const path = `${asset.managedAsset.collection}/${asset.managedAsset.fileName}`;
    if (managedAssetPaths.has(path)) return false;
    managedAssetPaths.add(path);
  }

  const handleNamespace = new Set<string>();
  const jobOwners = new Map<string, { pieceId: string; position: number }>();
  for (const piece of Object.values(project.pieces)) {
    for (const handle of [piece.handle, ...piece.priorHandles]) {
      if (handleNamespace.has(handle)) return false;
      handleNamespace.add(handle);
    }
    if (
      piece.createdAt < project.createdAt ||
      piece.updatedAt > project.updatedAt ||
      (piece.currentAssetId === null && piece.jobIds.length === 0)
    ) {
      return false;
    }
    let previousCreatedAt = '';
    for (let position = 0; position < piece.jobIds.length; position += 1) {
      const jobId = piece.jobIds[position]!;
      const job = ownValue(project.jobs, jobId);
      const nextJob = ownValue(project.jobs, piece.jobIds[position + 1] ?? '');
      const resumableUnknownHasExactRetry =
        job?.status === 'needs_attention' &&
        job.error?.code === 'submission_unknown' &&
        nextJob?.attempt.kind === 'retry' &&
        nextJob.attempt.sourceJobId === job.id &&
        nextJob.attempt.reason === 'submission_unknown';
      const jobMustRemainFinal =
        job !== undefined &&
        (ACTIVE_PIECE_JOB_STATUSES_V4.has(job.status) ||
          (job.status === 'needs_attention' && job.error?.code === 'poll_deadline'));
      if (
        job === undefined ||
        job.target.pieceId !== piece.id ||
        (piece.kind === 'photograph' ? job.purpose !== 'piece_image' : job.purpose !== 'piece_motion') ||
        job.createdAt < piece.createdAt ||
        job.createdAt > piece.updatedAt ||
        job.updatedAt > piece.updatedAt ||
        job.createdAt < previousCreatedAt ||
        (jobMustRemainFinal && position !== piece.jobIds.length - 1) ||
        (job.status === 'needs_attention' &&
          job.error?.code === 'submission_unknown' &&
          position !== piece.jobIds.length - 1 &&
          !resumableUnknownHasExactRetry) ||
        jobOwners.has(jobId)
      ) {
        return false;
      }
      previousCreatedAt = job.createdAt;
      jobOwners.set(jobId, { pieceId: piece.id, position });
    }
    if (
      piece.jobIds.filter((jobId) => {
        const job = project.jobs[jobId]!;
        return (
          ACTIVE_PIECE_JOB_STATUSES_V4.has(job.status) ||
          (job.status === 'needs_attention' && job.error?.code === 'poll_deadline')
        );
      }).length > 1
    ) {
      return false;
    }
  }
  if (jobOwners.size !== jobIds.length) return false;

  const assetLineage = projectAssetLineageV4(project);
  if (assetLineage === null || !validatePiecePublicationLineageV4(project, assetLineage)) return false;

  const authorizationsById = new Map<string, StudioPieceSpendAuthorizationV4>();
  const quoteIds = new Set<string>();
  const reservationIds = new Set<string>();
  const authorizationItemIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const undoSourceRevisions = new Set(project.undoHistory.map((entry) => entry.sourceRevision));
  let previousAuthorizationRevision = 0;
  let previousConfirmedAt = '';
  for (const authorization of project.spendAuthorizations) {
    if (
      !validatePieceAuthorizationV4(authorization, project) ||
      authorization.confirmedAt < project.createdAt ||
      authorization.confirmedAt > project.updatedAt ||
      authorization.projectRevisionAtAuthorization <= previousAuthorizationRevision ||
      authorization.confirmedAt < previousConfirmedAt ||
      undoSourceRevisions.has(authorization.projectRevisionAtAuthorization) ||
      authorizationsById.has(authorization.id) ||
      quoteIds.has(authorization.quote.id) ||
      reservationIds.has(authorization.quote.reservationId) ||
      authorizationItemIds.has(authorization.quote.item.id) ||
      idempotencyKeys.has(authorization.idempotencyKey.key)
    ) {
      return false;
    }
    authorizationsById.set(authorization.id, authorization);
    quoteIds.add(authorization.quote.id);
    reservationIds.add(authorization.quote.reservationId);
    authorizationItemIds.add(authorization.quote.item.id);
    idempotencyKeys.add(authorization.idempotencyKey.key);
    previousAuthorizationRevision = authorization.projectRevisionAtAuthorization;
    previousConfirmedAt = authorization.confirmedAt;
  }
  if (authorizationsById.size !== jobIds.length) return false;

  const retryParents = new Set<string>();
  const usedAuthorizationIds = new Set<string>();
  const inputMatchesProject = (
    input: StudioPieceConditioningInputSnapshotV4,
    targetPieceId: string,
    confirmedAt: string,
    requireManagedBytes: boolean
  ): boolean => {
    const referencePiece = ownValue(project.pieces, input.pieceId);
    const asset = ownValue(project.assets, input.assetId) ?? assetLineage.tombstones.get(input.assetId);
    const version = assetLineage.versionsByPiece
      .get(input.pieceId)
      ?.find((candidate) => candidate.primary.id === input.assetId);
    return (
      referencePiece !== undefined &&
      referencePiece.id !== targetPieceId &&
      referencePiece.kind === 'photograph' &&
      assetLineage.owners.get(input.assetId) === referencePiece.id &&
      asset !== undefined &&
      (!requireManagedBytes || ownValue(project.assets, input.assetId) !== undefined) &&
      version !== undefined &&
      (version.supersededAt === null || confirmedAt < version.supersededAt) &&
      asset.mediaKind === 'image' &&
      asset.role === 'primary' &&
      asset.sha256 === input.sha256 &&
      asset.mimeType === input.mimeType &&
      asset.byteSize === input.byteSize &&
      asset.createdAt <= confirmedAt
    );
  };
  for (const job of Object.values(project.jobs)) {
    const piece = ownValue(project.pieces, job.target.pieceId);
    const owner = jobOwners.get(job.id);
    const authorization = authorizationsById.get(job.authorizationId);
    if (
      piece === undefined ||
      owner?.pieceId !== piece.id ||
      authorization === undefined ||
      usedAuthorizationIds.has(job.authorizationId) ||
      authorization.quote.item.id !== job.authorizationItemId ||
      authorization.quote.item.target.pieceId !== piece.id ||
      authorization.quote.item.purpose !== job.purpose ||
      !canonicalValuesEqualV3(authorization.quote.item.requestPlan, job.requestPlan) ||
      !providersEqual(authorization.providerBinding.provider, job.provider) ||
      authorization.cancellationPolicy !== job.cancellationPolicy ||
      authorization.idempotencyKey.key !== job.idempotencyKey ||
      authorization.projectRevisionAtAuthorization !== job.projectRevisionAtAuthorization ||
      authorization.quote.projectRevisionAtPreparation !== job.projectRevisionAtPreparation ||
      authorization.quote.authoringRevision !== job.authoringRevision ||
      authorization.quote.authoringFingerprintVersion !== job.authoringFingerprintVersion ||
      authorization.quote.authoringFingerprint !== job.authoringFingerprint ||
      !arrayEvery(
        job.composition.inputs.rules,
        (rule) => rule.createdAt >= project.createdAt && rule.createdAt <= authorization.confirmedAt
      ) ||
      job.createdAt < authorization.confirmedAt ||
      (job.remoteStartedAt !== null && (job.remoteStartedAt < job.createdAt || job.remoteStartedAt > job.updatedAt)) ||
      (job.duplicateChargeAcknowledgedAt !== null &&
        (job.duplicateChargeAcknowledgedAt < authorization.confirmedAt ||
          job.duplicateChargeAcknowledgedAt > job.createdAt)) ||
      job.updatedAt > project.updatedAt
    ) {
      return false;
    }
    if (job.purpose === 'piece_image') {
      if (
        !job.requestPlan.snapshot.conditioningInputs.every((input) =>
          inputMatchesProject(
            input,
            piece.id,
            authorization.confirmedAt,
            NONTERMINAL_PIECE_JOB_STATUSES_V4.has(job.status)
          )
        )
      )
        return false;
    } else if (job.requestPlan.kind === 'resolved' && job.requestPlan.snapshot.firstFrame?.kind === 'piece_image') {
      const { kind: _kind, ...input } = job.requestPlan.snapshot.firstFrame;
      if (
        !inputMatchesProject(
          input,
          piece.id,
          authorization.confirmedAt,
          NONTERMINAL_PIECE_JOB_STATUSES_V4.has(job.status)
        )
      ) {
        return false;
      }
    }
    if (job.spendReceipt !== null) {
      const item = authorization.quote.item;
      if (
        job.spendReceipt.authorizationId !== authorization.id ||
        job.spendReceipt.quoteId !== authorization.quote.id ||
        job.spendReceipt.quoteRevision !== authorization.quote.quoteRevision ||
        job.spendReceipt.itemId !== item.id ||
        job.spendReceipt.jobId !== job.id ||
        job.spendReceipt.purpose !== item.purpose ||
        job.spendReceipt.routeId !== item.routeId ||
        job.spendReceipt.currency !== authorization.quote.currency ||
        job.spendReceipt.rateUnit !== item.rateUnit ||
        job.spendReceipt.rateMinorUnits !== item.rateMinorUnits ||
        job.spendReceipt.totalMinorUnits !== quotedGenerationTotalV4(item) ||
        (item.purpose === 'piece_motion' &&
          (job.spendReceipt.purpose !== 'piece_motion' ||
            job.spendReceipt.requestedDurationSeconds !== item.requestedDurationSeconds ||
            job.spendReceipt.billedDurationSeconds !== item.billedDurationSeconds)) ||
        job.spendReceipt.recordedAt < authorization.confirmedAt ||
        job.spendReceipt.recordedAt < job.createdAt ||
        (job.remoteStartedAt !== null && job.spendReceipt.recordedAt < job.remoteStartedAt) ||
        job.spendReceipt.recordedAt > job.updatedAt
      ) {
        return false;
      }
    }
    if (job.status === 'succeeded') {
      const primaryId = job.outputAssetIdsByRole.primary!;
      const primary = ownValue(project.assets, primaryId) ?? assetLineage.tombstones.get(primaryId);
      if (
        primary?.origin !== 'generated' ||
        primary.role !== 'primary' ||
        assetLineage.owners.get(primary.id) !== piece.id ||
        job.spendReceipt === null
      ) {
        return false;
      }
    }
    usedAuthorizationIds.add(job.authorizationId);
    if (job.attempt.kind === 'first') continue;
    if (retryParents.has(job.attempt.sourceJobId)) return false;
    retryParents.add(job.attempt.sourceJobId);
    const predecessor = ownValue(project.jobs, job.attempt.sourceJobId);
    const predecessorOwner = predecessor === undefined ? undefined : jobOwners.get(predecessor.id);
    const predecessorReason =
      predecessor?.status === 'cancelled'
        ? 'cancelled'
        : (predecessor?.status === 'failed' || predecessor?.status === 'needs_attention') &&
            predecessor.error?.code === 'submission_unknown'
          ? 'submission_unknown'
          : predecessor?.status === 'failed' && predecessor.error?.code === 'variation_grid'
            ? 'variation_grid'
            : predecessor?.status === 'failed' &&
                predecessor.error !== null &&
                predecessor.error.code !== 'download_failed' &&
                predecessor.error.code !== 'poll_deadline'
              ? 'provider_failure'
              : null;
    if (
      predecessor === undefined ||
      predecessorOwner?.pieceId !== piece.id ||
      predecessorOwner.position >= owner.position ||
      predecessor.id !== piece.jobIds[owner.position - 1] ||
      predecessor.updatedAt > job.createdAt ||
      predecessor.updatedAt > authorization.confirmedAt ||
      predecessor.purpose !== job.purpose ||
      predecessorReason !== job.attempt.reason ||
      predecessor.composition.inputs.source.words !== job.composition.inputs.source.words ||
      !pieceSettingsEqualV4(predecessor.composition.inputs.source.settings, job.composition.inputs.source.settings) ||
      (job.purpose === 'piece_image'
        ? predecessor.purpose !== 'piece_image' ||
          !pieceInputsEqualV4(
            predecessor.requestPlan.snapshot.conditioningInputs,
            job.requestPlan.snapshot.conditioningInputs
          )
        : predecessor.purpose !== 'piece_motion' ||
          !canonicalValuesEqualV3(predecessor.requestPlan, job.requestPlan) ||
          !canonicalValuesEqualV3(predecessor.requestSnapshot, job.requestSnapshot))
    ) {
      return false;
    }
  }
  if (usedAuthorizationIds.size !== authorizationsById.size) return false;

  if (
    !isUniqueSafeIdArray(project.boardOrder, STUDIO_MAX_BOARDS_V4) ||
    !isRecord(project.boards) ||
    !isUniqueSafeIdArray(project.assemblyOrder, STUDIO_MAX_ASSEMBLIES_V4) ||
    !isRecord(project.assemblies) ||
    !isDenseArray(project.bin, STUDIO_MAX_BIN_ENTRIES_V4)
  ) {
    return false;
  }
  const boardIds = Object.keys(project.boards);
  const assemblyIds = Object.keys(project.assemblies);
  if (
    boardIds.length !== project.boardOrder.length ||
    assemblyIds.length !== project.assemblyOrder.length ||
    !arrayEvery(project.boardOrder, (boardId) => Object.hasOwn(project.boards, boardId)) ||
    !arrayEvery(project.assemblyOrder, (assemblyId) => Object.hasOwn(project.assemblies, assemblyId)) ||
    !boardIds.every((boardId) =>
      validateBoardV4(boardId, project.boards[boardId], project.createdAt, project.updatedAt)
    ) ||
    !assemblyIds.every((assemblyId) =>
      validateAssemblyV4(assemblyId, project.assemblies[assemblyId], project, assetLineage)
    )
  ) {
    return false;
  }

  const extractionByFrameAssetId = new Map<string, StudioFrameExtractionV4>();
  const extractionByJobId = new Set<string>();
  for (const extraction of Object.values(project.frameExtractions)) {
    const targetPiece = ownValue(project.pieces, extraction.targetPieceId);
    const ownerJob = ownValue(project.jobs, extraction.jobId);
    const ownerFirstFrame =
      ownerJob?.purpose !== 'piece_motion'
        ? null
        : (ownerJob.requestSnapshot?.firstFrame ??
          (ownerJob.requestPlan.kind === 'resolved' ? ownerJob.requestPlan.snapshot.firstFrame : null));
    const ownerDependency =
      ownerJob?.purpose === 'piece_motion' && ownerJob.requestPlan.kind === 'after_upstream_completion'
        ? ownerJob.requestPlan.dependency
        : null;
    const ownerAuthorization = ownerJob === undefined ? undefined : authorizationsById.get(ownerJob.authorizationId);
    const ownerDependencyMatches =
      ownerDependency !== null &&
      ownerDependency.assemblyId === extraction.assemblyId &&
      ownerDependency.boardId === extraction.boardId &&
      ownerDependency.dependentShotId === extraction.dependentShotId &&
      ownerDependency.predecessorShotId === extraction.predecessorShotId &&
      ownerDependency.sourcePieceId === extraction.sourcePieceId;
    const requiresCurrentTopology = ownerJob !== undefined && LIVE_TOPOLOGY_PIECE_JOB_STATUSES_V4.has(ownerJob.status);
    const assembly = ownValue(project.assemblies, extraction.assemblyId);
    const board = ownValue(project.boards, extraction.boardId);
    const sourcePiece = ownValue(project.pieces, extraction.sourcePieceId);
    const sourceAsset =
      ownValue(project.assets, extraction.sourceVideoAssetId) ??
      assetLineage.tombstones.get(extraction.sourceVideoAssetId);
    const dependentBinding =
      assembly === undefined ? undefined : ownValue(assembly.pictureBindings, extraction.dependentShotId);
    const predecessorBinding =
      assembly === undefined ? undefined : ownValue(assembly.pictureBindings, extraction.predecessorShotId);
    const beat =
      board === undefined
        ? undefined
        : Object.values(board.beats).find((candidate) => candidate.shotOrder.includes(extraction.dependentShotId));
    const dependentIndex = beat?.shotOrder.indexOf(extraction.dependentShotId) ?? -1;
    const expectedPredecessorId = dependentIndex > 0 ? beat!.shotOrder[dependentIndex - 1] : null;
    const expectedEndpoint =
      predecessorBinding?.sourceOutSeconds ?? (sourceAsset?.mediaKind === 'video' ? sourceAsset.durationSeconds : null);
    if (
      targetPiece?.kind !== 'motion' ||
      ownerJob?.purpose !== 'piece_motion' ||
      ownerJob.target.pieceId !== targetPiece.id ||
      (extraction.status === 'ready'
        ? ownerFirstFrame?.kind !== 'predecessor_frame' ||
          ownerFirstFrame.frameExtractionId !== extraction.id ||
          (ownerDependency !== null && !ownerDependencyMatches)
        : (extraction.status === 'pending' || extraction.status === 'extracting'
            ? ownerJob.status !== 'waiting_for_conditioning'
            : ownerJob.status !== 'waiting_for_conditioning' && ownerJob.status !== 'cancelled') ||
          ownerJob.requestSnapshot !== null ||
          !ownerDependencyMatches) ||
      (requiresCurrentTopology &&
        (assembly === undefined ||
          board === undefined ||
          assembly.boardId !== board.id ||
          expectedPredecessorId !== extraction.predecessorShotId ||
          dependentBinding?.source?.pieceId !== targetPiece.id ||
          predecessorBinding?.source?.pieceId !== sourcePiece?.id ||
          predecessorBinding?.source?.assetId !== extraction.sourceVideoAssetId ||
          expectedEndpoint !== extraction.endpointSeconds)) ||
      sourcePiece?.kind !== 'motion' ||
      sourceAsset?.mediaKind !== 'video' ||
      sourceAsset.role !== 'primary' ||
      extraction.endpointSeconds > sourceAsset.durationSeconds ||
      assetLineage.owners.get(sourceAsset.id) !== sourcePiece.id ||
      sourceAsset.sha256 !== extraction.sourceVideoSha256 ||
      extractionByJobId.has(extraction.jobId) ||
      (ownerDependency !== null &&
        (ownerJob === undefined ||
          ownerAuthorization === undefined ||
          extraction.createdAt < ownerAuthorization.confirmedAt ||
          extraction.createdAt < ownerJob.createdAt ||
          extraction.updatedAt > ownerJob.updatedAt)) ||
      extraction.createdAt < targetPiece.createdAt ||
      extraction.updatedAt > targetPiece.updatedAt ||
      extraction.createdAt < sourceAsset.createdAt ||
      ((extraction.status === 'pending' || extraction.status === 'extracting') &&
        ownValue(project.assets, extraction.sourceVideoAssetId) === undefined) ||
      extraction.updatedAt > project.updatedAt
    ) {
      return false;
    }
    extractionByJobId.add(extraction.jobId);
    if (extraction.frameAssetId === null) continue;
    const frame = ownValue(project.derivedFrames, extraction.frameAssetId);
    if (
      frame === undefined ||
      extractionByFrameAssetId.has(frame.id) ||
      frame.extractionId !== extraction.id ||
      frame.targetPieceId !== extraction.targetPieceId ||
      frame.createdAt < extraction.createdAt ||
      frame.createdAt > extraction.updatedAt ||
      (ownerDependency !== null && (ownerJob === undefined || frame.createdAt > ownerJob.updatedAt))
    ) {
      return false;
    }
    extractionByFrameAssetId.set(frame.id, extraction);
  }
  if (
    Object.keys(project.derivedFrames).length !== extractionByFrameAssetId.size ||
    Object.keys(project.derivedFrames).some((id) => !extractionByFrameAssetId.has(id))
  ) {
    return false;
  }

  const isSameJobOrRetryDescendant = (job: StudioPieceJobV4, ancestorJobId: string): boolean => {
    const visited = new Set<string>();
    let current: StudioPieceJobV4 | undefined = job;
    while (current !== undefined && !visited.has(current.id)) {
      if (current.id === ancestorJobId) return true;
      visited.add(current.id);
      current = current.attempt.kind === 'retry' ? ownValue(project.jobs, current.attempt.sourceJobId) : undefined;
    }
    return false;
  };

  const predecessorSnapshotMatchesProject = (
    snapshot: Extract<StudioPieceFirstFrameSnapshotV4, { kind: 'predecessor_frame' }>,
    job: StudioPieceJobV4,
    confirmedAt: string,
    materializedAfterAuthorization: boolean
  ): boolean => {
    const extraction = ownValue(project.frameExtractions, snapshot.frameExtractionId);
    const frame = ownValue(project.derivedFrames, snapshot.frameAssetId);
    const materializer = extraction === undefined ? undefined : ownValue(project.jobs, extraction.jobId);
    const materializerAuthorization =
      materializer === undefined ? undefined : authorizationsById.get(materializer.authorizationId);
    const sourceVersion =
      extraction === undefined
        ? undefined
        : assetLineage.versionsByPiece
            .get(extraction.sourcePieceId)
            ?.find((version) => version.primary.id === extraction.sourceVideoAssetId);
    if (
      extraction === undefined ||
      extraction.status !== 'ready' ||
      extraction.frameAssetId !== snapshot.frameAssetId ||
      frame === undefined ||
      frame.targetPieceId !== job.target.pieceId ||
      (materializedAfterAuthorization
        ? materializer?.purpose !== 'piece_motion' ||
          materializerAuthorization === undefined ||
          !isSameJobOrRetryDescendant(job, materializer.id) ||
          extraction.createdAt < materializerAuthorization.confirmedAt ||
          frame.createdAt < materializerAuthorization.confirmedAt ||
          extraction.updatedAt > materializer.updatedAt ||
          frame.createdAt > materializer.updatedAt
        : frame.createdAt > confirmedAt) ||
      (!materializedAfterAuthorization &&
        (sourceVersion === undefined ||
          (sourceVersion.supersededAt !== null && confirmedAt >= sourceVersion.supersededAt))) ||
      (NONTERMINAL_PIECE_JOB_STATUSES_V4.has(job.status) &&
        ownValue(project.assets, extraction.sourceVideoAssetId) === undefined)
    )
      return false;
    const expected = {
      kind: 'predecessor_frame',
      assemblyId: extraction.assemblyId,
      boardId: extraction.boardId,
      dependentShotId: extraction.dependentShotId,
      predecessorShotId: extraction.predecessorShotId,
      sourcePieceId: extraction.sourcePieceId,
      sourceVideoAssetId: extraction.sourceVideoAssetId,
      sourceVideoSha256: extraction.sourceVideoSha256,
      endpointSeconds: extraction.endpointSeconds,
      frameExtractionId: extraction.id,
      frameAssetId: frame.id,
      frameSha256: frame.sha256,
      frameMimeType: frame.mimeType,
      frameByteSize: frame.byteSize,
    };
    if (!canonicalValuesEqualV3(snapshot, expected)) return false;
    return true;
  };

  for (const job of Object.values(project.jobs)) {
    if (job.purpose !== 'piece_motion') continue;
    const authorization = authorizationsById.get(job.authorizationId)!;
    if (job.requestPlan.kind === 'after_upstream_completion') {
      const dependency = job.requestPlan.dependency;
      const requiresCurrentTopology = LIVE_TOPOLOGY_PIECE_JOB_STATUSES_V4.has(job.status);
      const upstreamAuthorization = project.spendAuthorizations.find(
        (candidate) => candidate.quote.item.id === dependency.upstreamItemId
      );
      const assembly = ownValue(project.assemblies, dependency.assemblyId);
      const board = ownValue(project.boards, dependency.boardId);
      const beat =
        board === undefined
          ? undefined
          : Object.values(board.beats).find((candidate) => candidate.shotOrder.includes(dependency.dependentShotId));
      const dependentIndex = beat?.shotOrder.indexOf(dependency.dependentShotId) ?? -1;
      const upstreamJobs = Object.values(project.jobs).filter(
        (candidate) => candidate.authorizationItemId === dependency.upstreamItemId
      );
      const upstreamJob = upstreamJobs.length === 1 ? upstreamJobs[0] : undefined;
      const upstreamPrimaryId = upstreamJob?.outputAssetIdsByRole.primary ?? null;
      const upstreamPrimary = upstreamPrimaryId === null ? undefined : ownValue(project.assets, upstreamPrimaryId);
      const upstreamCanStillResolve =
        upstreamJob !== undefined &&
        (NONTERMINAL_PIECE_JOB_STATUSES_V4.has(upstreamJob.status) ||
          (upstreamJob.status === 'succeeded' &&
            upstreamPrimary?.origin === 'generated' &&
            upstreamPrimary.mediaKind === 'video' &&
            upstreamPrimary.role === 'primary' &&
            upstreamPrimary.pieceId === dependency.sourcePieceId &&
            upstreamPrimary.producerJobId === upstreamJob.id));
      const selectedSourceAssetId = assembly?.pictureBindings[dependency.predecessorShotId]?.source?.assetId ?? null;
      const selectedSourceAsset =
        selectedSourceAssetId === null ? undefined : ownValue(project.assets, selectedSourceAssetId);
      const selectedSourceEndpoint =
        selectedSourceAsset?.mediaKind === 'video'
          ? (assembly?.pictureBindings[dependency.predecessorShotId]?.sourceOutSeconds ??
            selectedSourceAsset.durationSeconds)
          : null;
      const materializedFirstFrame = job.requestSnapshot?.firstFrame;
      const materializedSourceAsset =
        materializedFirstFrame?.kind !== 'predecessor_frame'
          ? undefined
          : (ownValue(project.assets, materializedFirstFrame.sourceVideoAssetId) ??
            assetLineage.tombstones.get(materializedFirstFrame.sourceVideoAssetId));
      if (
        upstreamAuthorization === undefined ||
        upstreamAuthorization.confirmedAt > authorization.confirmedAt ||
        upstreamAuthorization.projectRevisionAtAuthorization > authorization.quote.projectRevisionAtPreparation ||
        upstreamAuthorization.quote.item.target.pieceId !== dependency.sourcePieceId ||
        upstreamAuthorization.quote.item.purpose !== 'piece_motion' ||
        upstreamJob === undefined ||
        upstreamJob.authorizationId !== upstreamAuthorization.id ||
        upstreamJob.target.pieceId !== dependency.sourcePieceId ||
        upstreamJob.purpose !== 'piece_motion' ||
        (job.requestSnapshot === null && job.status === 'waiting_for_conditioning' && !upstreamCanStillResolve) ||
        (job.requestSnapshot !== null &&
          (materializedFirstFrame?.kind !== 'predecessor_frame' ||
            upstreamJob.status !== 'succeeded' ||
            upstreamJob.outputAssetIdsByRole.primary !== materializedFirstFrame.sourceVideoAssetId ||
            materializedSourceAsset?.origin !== 'generated' ||
            materializedSourceAsset.producerJobId !== upstreamJob.id)) ||
        (requiresCurrentTopology &&
          (assembly?.boardId !== board?.id ||
            dependentIndex <= 0 ||
            beat!.shotOrder[dependentIndex - 1] !== dependency.predecessorShotId ||
            assembly?.pictureBindings[dependency.dependentShotId]?.source?.pieceId !== job.target.pieceId ||
            assembly?.pictureBindings[dependency.dependentShotId]?.join !== 'match_previous' ||
            assembly?.pictureBindings[dependency.predecessorShotId]?.source?.pieceId !== dependency.sourcePieceId ||
            (selectedSourceAssetId !== null &&
              (upstreamJob.status !== 'succeeded' ||
                upstreamJob.outputAssetIdsByRole.primary !== selectedSourceAssetId ||
                selectedSourceAsset?.origin !== 'generated' ||
                selectedSourceAsset.mediaKind !== 'video' ||
                selectedSourceAsset.role !== 'primary' ||
                selectedSourceAsset.pieceId !== dependency.sourcePieceId ||
                selectedSourceAsset.producerJobId !== upstreamJob.id)) ||
            (materializedFirstFrame?.kind === 'predecessor_frame' &&
              (selectedSourceAssetId !== materializedFirstFrame.sourceVideoAssetId ||
                selectedSourceEndpoint !== materializedFirstFrame.endpointSeconds))))
      )
        return false;
    }
    const firstFrame =
      job.requestSnapshot?.firstFrame ??
      (job.requestPlan.kind === 'resolved' ? job.requestPlan.snapshot.firstFrame : null);
    if (
      firstFrame?.kind === 'predecessor_frame' &&
      !predecessorSnapshotMatchesProject(
        firstFrame,
        job,
        authorization.confirmedAt,
        job.requestPlan.kind === 'after_upstream_completion'
      )
    )
      return false;
  }
  const persistentIdentities = new Set<string>();
  const addUniqueIdentities = (identities: readonly string[]): boolean => {
    if (
      new Set(identities).size !== identities.length ||
      identities.some((identity) => persistentIdentities.has(identity))
    ) {
      return false;
    }
    identities.forEach((identity) => persistentIdentities.add(identity));
    return true;
  };
  if (
    !addUniqueIdentities([
      project.id,
      ...project.rules.map((rule) => rule.id),
      ...Object.keys(project.pieces),
      ...assetLineage.owners.keys(),
      ...Object.keys(project.jobs),
      ...Object.keys(project.frameExtractions),
      ...Object.keys(project.derivedFrames),
      ...project.undoHistory.map((entry) => entry.id),
    ])
  ) {
    return false;
  }
  for (const authorization of project.spendAuthorizations) {
    if (
      !addUniqueIdentities([
        authorization.id,
        authorization.quote.id,
        authorization.quote.reservationId,
        authorization.quote.item.id,
        authorization.idempotencyKey.key,
      ])
    )
      return false;
  }
  const handles = new Set<string>();
  for (const piece of Object.values(project.pieces)) {
    handles.add(piece.handle);
    piece.priorHandles.forEach((handle) => handles.add(handle));
  }
  for (const board of Object.values(project.boards)) {
    const boardIdentities = [board.id, ...Object.keys(board.beats), ...Object.keys(board.shots)];
    if (!addUniqueIdentities(boardIdentities)) return false;
    for (const handle of [board.handle, ...board.priorHandles]) {
      if (handles.has(handle)) return false;
      handles.add(handle);
    }
  }
  for (const assembly of Object.values(project.assemblies)) {
    const assemblyIdentities = [assembly.id, ...Object.keys(assembly.soundBindings)];
    if (!addUniqueIdentities(assemblyIdentities)) return false;
    for (const handle of [assembly.handle, ...assembly.priorHandles]) {
      if (handles.has(handle)) return false;
      handles.add(handle);
    }
  }

  const binnedSubjects = new Set<string>();
  const binnedBoardIds = new Set<string>();
  const binnedShotCountsByBoard = new Map<string, number>();
  let priorBinLiftedAt: string | null = null;
  for (const entry of project.bin) {
    if (!validateBinEntryV4(entry, project, persistentIdentities)) return false;
    if (priorBinLiftedAt !== null && entry.liftedAt > priorBinLiftedAt) return false;
    priorBinLiftedAt = entry.liftedAt;
    const subjectKey = binSubjectKeyV4(entry);
    if (binnedSubjects.has(subjectKey)) return false;
    if (binSubjectIsUsedByRetainedAssemblyV4(entry.subject, project)) return false;
    if (entry.subject.kind === 'piece') {
      const piece = ownValue(project.pieces, entry.subject.pieceId);
      if (piece?.assetHistory.some((version) => version.state === 'evicted' && version.evictedAt > entry.liftedAt)) {
        return false;
      }
    }
    if (entry.subject.kind === 'board') binnedBoardIds.add(entry.subject.boardId);
    if (entry.subject.kind === 'board_shot') {
      binnedShotCountsByBoard.set(entry.subject.boardId, (binnedShotCountsByBoard.get(entry.subject.boardId) ?? 0) + 1);
    }
    binnedSubjects.add(subjectKey);
    persistentIdentities.add(entry.id);
  }
  for (const [boardId, binnedShotCount] of binnedShotCountsByBoard) {
    const board = ownValue(project.boards, boardId);
    if (binnedBoardIds.has(boardId) || board === undefined || binnedShotCount >= Object.keys(board.shots).length) {
      return false;
    }
  }
  return true;
};

const EXPORT_MANIFEST_KEYS_V3 = new Set([
  'schemaVersion',
  'exportId',
  'projectId',
  'sourceRevision',
  'piece',
  'asset',
  'provenance',
  'exportedAt',
]);
const EXPORT_PIECE_KEYS_V3 = new Set(['id', 'kind', 'handleAtExport']);
const EXPORT_ASSET_KEYS_V3 = new Set([
  'id',
  'sha256',
  'mimeType',
  'byteSize',
  'width',
  'height',
  'createdAt',
  'relativePath',
]);
const EXPORT_IMPORTED_PROVENANCE_KEYS_V3 = new Set(['origin']);
const EXPORT_GENERATED_PROVENANCE_KEYS_V3 = new Set([
  'origin',
  'producerJobId',
  'provider',
  'composition',
  'requestPlan',
  'authorizationId',
  'quoteId',
  'quoteRevision',
  'receipt',
]);
const EXPORT_GENERATED_PROVENANCE_KEYS_V4 = new Set([
  'origin',
  'producerJobId',
  'provider',
  'composition',
  'requestPlan',
  'publication',
  'attempt',
  'authorizationId',
  'quoteId',
  'quoteRevision',
  'receipt',
]);

const WINDOWS_RESERVED_EXPORT_NAME_V3 = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const UNSAFE_EXPORT_PATH_CHARACTER_V3 = /[\p{C}<>:"|?*]/u;
const MAX_EXPORT_RELATIVE_PATH_BYTES_V3 = 1024;
const MAX_EXPORT_PATH_SEGMENT_SCALARS_V3 = 256;
const MAX_EXPORT_PATH_SEGMENT_BYTES_V3 = 512;

const isSafeRelativeExportPathV3 = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_EXPORT_RELATIVE_PATH_BYTES_V3 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:/u.test(value) ||
    value !== value.normalize('NFKC')
  ) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.length <= STUDIO_MAX_EXPORT_DIRECTORY_DEPTH &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.endsWith('.') &&
        !segment.endsWith(' ') &&
        [...segment].length <= MAX_EXPORT_PATH_SEGMENT_SCALARS_V3 &&
        Buffer.byteLength(segment, 'utf8') <= MAX_EXPORT_PATH_SEGMENT_BYTES_V3 &&
        !UNSAFE_EXPORT_PATH_CHARACTER_V3.test(segment) &&
        !WINDOWS_RESERVED_EXPORT_NAME_V3.test(segment)
    )
  );
};

/** Validates the inactive exact schema-3 standalone-Piece export sidecar. */
export const validateStudioPieceExportManifestV3 = (value: unknown): value is StudioPieceExportManifestV3 => {
  const dataSnapshot = snapshotOwnDataGraph(value);
  if (dataSnapshot === INVALID_DATA_SNAPSHOT) return false;
  value = dataSnapshot;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, EXPORT_MANIFEST_KEYS_V3) ||
    value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V3 ||
    !isSafeId(value.exportId) ||
    !isSafeId(value.projectId) ||
    !isIntegerInRange(value.sourceRevision, 1, Number.MAX_SAFE_INTEGER) ||
    !isRecord(value.piece) ||
    !hasExactKeys(value.piece, EXPORT_PIECE_KEYS_V3) ||
    !isSafeId(value.piece.id) ||
    value.piece.kind !== 'photograph' ||
    !isCanonicalStudioPieceHandleV3(value.piece.handleAtExport) ||
    !isRecord(value.asset) ||
    !hasExactKeys(value.asset, EXPORT_ASSET_KEYS_V3) ||
    !isSafeId(value.asset.id) ||
    !isLowercaseDigest(value.asset.sha256) ||
    !isStudioReferenceImageMimeType(value.asset.mimeType) ||
    !isIntegerInRange(value.asset.byteSize, 1, STUDIO_MAX_IMAGE_ASSET_BYTES_V3) ||
    !isIntegerInRange(value.asset.width, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.asset.height, 1, Number.MAX_SAFE_INTEGER) ||
    !isCanonicalTimestamp(value.asset.createdAt) ||
    !isSafeRelativeExportPathV3(value.asset.relativePath) ||
    !isCanonicalTimestamp(value.exportedAt) ||
    value.asset.createdAt > value.exportedAt ||
    !isRecord(value.provenance)
  ) {
    return false;
  }
  if (value.provenance.origin === 'imported') {
    return hasExactKeys(value.provenance, EXPORT_IMPORTED_PROVENANCE_KEYS_V3);
  }
  return (
    value.provenance.origin === 'generated' &&
    hasExactKeys(value.provenance, EXPORT_GENERATED_PROVENANCE_KEYS_V3) &&
    isSafeId(value.provenance.producerJobId) &&
    validateProvider(value.provenance.provider) &&
    validatePieceCompositionV3(value.provenance.composition) &&
    value.piece.id === value.provenance.composition.inputs.source.pieceId &&
    providersEqual(value.provenance.provider, value.provenance.composition.inputs.route) &&
    validatePieceRequestPlanV3(value.provenance.requestPlan) &&
    canonicalValuesEqualV3(value.provenance.requestPlan.snapshot.composition, value.provenance.composition) &&
    isSafeId(value.provenance.authorizationId) &&
    isSafeId(value.provenance.quoteId) &&
    isIntegerInRange(value.provenance.quoteRevision, 1, Number.MAX_SAFE_INTEGER) &&
    validatePieceReceiptV3(value.provenance.receipt) &&
    value.provenance.receipt.authorizationId === value.provenance.authorizationId &&
    value.provenance.receipt.quoteId === value.provenance.quoteId &&
    value.provenance.receipt.quoteRevision === value.provenance.quoteRevision &&
    value.provenance.receipt.jobId === value.provenance.producerJobId
  );
};

/** Validates only canonical export-4 sidecars; export 3 and motion/poster payloads fail closed. */
export const validateStudioPieceExportManifestV4 = (value: unknown): value is StudioPieceExportManifestV4 => {
  const dataSnapshot = snapshotOwnDataGraph(value);
  if (dataSnapshot === INVALID_DATA_SNAPSHOT) return false;
  value = dataSnapshot;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, EXPORT_MANIFEST_KEYS_V3) ||
    value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V4 ||
    !isSafeId(value.exportId) ||
    !isSafeId(value.projectId) ||
    !isIntegerInRange(value.sourceRevision, 1, Number.MAX_SAFE_INTEGER) ||
    !isRecord(value.piece) ||
    !hasExactKeys(value.piece, EXPORT_PIECE_KEYS_V3) ||
    !isSafeId(value.piece.id) ||
    value.piece.kind !== 'photograph' ||
    !isCanonicalStudioPieceHandleV3(value.piece.handleAtExport) ||
    !isRecord(value.asset) ||
    !hasExactKeys(value.asset, EXPORT_ASSET_KEYS_V3) ||
    !isSafeId(value.asset.id) ||
    !isLowercaseDigest(value.asset.sha256) ||
    !isStudioReferenceImageMimeType(value.asset.mimeType) ||
    !isIntegerInRange(value.asset.byteSize, 1, STUDIO_MAX_IMAGE_ASSET_BYTES_V4) ||
    !isIntegerInRange(value.asset.width, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.asset.height, 1, Number.MAX_SAFE_INTEGER) ||
    !isCanonicalTimestamp(value.asset.createdAt) ||
    !isSafeRelativeExportPathV3(value.asset.relativePath) ||
    !isCanonicalTimestamp(value.exportedAt) ||
    value.asset.createdAt > value.exportedAt ||
    !isRecord(value.provenance)
  ) {
    return false;
  }
  if (value.provenance.origin === 'imported') {
    return hasExactKeys(value.provenance, EXPORT_IMPORTED_PROVENANCE_KEYS_V3);
  }
  if (
    value.provenance.origin !== 'generated' ||
    !hasExactKeys(value.provenance, EXPORT_GENERATED_PROVENANCE_KEYS_V4) ||
    !isSafeId(value.provenance.producerJobId) ||
    !validateProvider(value.provenance.provider) ||
    !validateStudioPieceGenerationCompositionV4(value.provenance.composition) ||
    value.provenance.composition.inputs.purpose !== 'piece_image' ||
    value.piece.id !== value.provenance.composition.inputs.source.pieceId ||
    !providersEqual(value.provenance.provider, value.provenance.composition.inputs.route) ||
    !validatePieceRequestPlanV4(value.provenance.requestPlan) ||
    value.provenance.requestPlan.kind !== 'resolved' ||
    value.provenance.requestPlan.snapshot.composition.inputs.purpose !== 'piece_image' ||
    !canonicalValuesEqualV3(value.provenance.requestPlan.snapshot.composition, value.provenance.composition) ||
    !validatePiecePublicationIntentV4(value.provenance.publication) ||
    !validatePieceGenerationAttemptV4(value.provenance.attempt) ||
    !isSafeId(value.provenance.authorizationId) ||
    !isSafeId(value.provenance.quoteId) ||
    !isIntegerInRange(value.provenance.quoteRevision, 1, Number.MAX_SAFE_INTEGER) ||
    !validatePieceReceiptV4(value.provenance.receipt) ||
    value.provenance.receipt.purpose !== 'piece_image'
  ) {
    return false;
  }
  return (
    value.provenance.receipt.authorizationId === value.provenance.authorizationId &&
    value.provenance.receipt.quoteId === value.provenance.quoteId &&
    value.provenance.receipt.quoteRevision === value.provenance.quoteRevision &&
    value.provenance.receipt.jobId === value.provenance.producerJobId
  );
};
