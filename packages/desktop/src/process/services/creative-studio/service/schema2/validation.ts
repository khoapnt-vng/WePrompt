/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isValidProviderJobId,
  STUDIO_MAX_CLIPS_PER_PROJECT,
  STUDIO_MAX_CLIPS_PER_SECTION,
  STUDIO_MAX_CUT_PLACEMENT_CLIPS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_MAX_SECTIONS,
  STUDIO_MAX_SHELF_ITEMS,
  STUDIO_MAX_SHELF_SECTION_ITEMS,
  STUDIO_MAX_SHELF_TAKE_ALIASES,
  STUDIO_MAX_VIDEO_CLIP_SECONDS,
  STUDIO_MIN_VIDEO_CLIP_SECONDS,
  type StudioAssetV2,
  type StudioClip,
  type StudioCutClipV2,
  type StudioCutFilter,
  type StudioCutV2,
  type StudioJobV2,
  type StudioProjectV2,
  type StudioProviderAdapterId,
  type StudioSection,
  type StudioShelfItem,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  STUDIO_MANAGED_ASSET_COLLECTIONS,
  STUDIO_MAX_ACTIVE_BRIEF_REFERENCES,
  isStudioBriefReferenceLabel,
  isStudioReferenceImageMimeType,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import { STUDIO_RULE_LIMITS, hasRuleToken } from '@/common/types/project/creativeStudioRules';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
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
]);
const JOB_ERROR_CODES = new Set([
  'invalid_request',
  'auth',
  'quota',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'poll_deadline',
  'no_output',
  'submission_unknown',
  'download_failed',
  'unsupported',
  'unknown',
]);
const CUT_FILTER_IDS = new Set(['exposure', 'contrast', 'saturation', 'temperature']);

const PROJECT_REQUIRED_KEYS = new Set([
  'schemaVersion',
  'revision',
  'id',
  'name',
  'brief',
  'rules',
  'ruleListUndo',
  'aspectRatio',
  'targetDurationSeconds',
  'resolution',
  'sectionOrder',
  'sections',
  'clips',
  'shelf',
  'cuts',
  'activeCutId',
  'assets',
  'jobs',
  'routing',
  'createdAt',
  'updatedAt',
]);
const PROJECT_OPTIONAL_KEYS = new Set(['forgeProjectId', 'briefConversationId']);
const SECTION_KEYS = new Set(['id', 'title', 'storyLine', 'visualPrompt', 'clipOrder']);
const CLIP_KEYS = new Set([
  'id',
  'shotPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
  'selectedAssetId',
  'assetIds',
  'jobIds',
]);
const ASSET_REQUIRED_KEYS = new Set([
  'id',
  'projectId',
  'clipId',
  'mediaKind',
  'mimeType',
  'managedAsset',
  'byteSize',
  'sha256',
  'createdAt',
]);
const ASSET_OPTIONAL_KEYS = new Set([
  'width',
  'height',
  'durationSeconds',
  'briefReferenceRole',
  'briefReferenceLabel',
  'sourceVisualPrompt',
  'sourceReferenceAssetIds',
  'sourceAspectRatio',
  'sourceResolution',
]);
const MANAGED_ASSET_KEYS = new Set(['collection', 'fileName']);
const JOB_REQUIRED_KEYS = new Set([
  'id',
  'projectId',
  'clipId',
  'status',
  'provider',
  'idempotencyKey',
  'providerJobId',
  'cancellationPolicy',
  'outputAssetIds',
  'error',
  'retryOfJobId',
  'retryReason',
  'duplicateChargeAcknowledged',
  'duplicateChargeAcknowledgedAt',
  'createdAt',
  'updatedAt',
]);
const JOB_OPTIONAL_KEYS = new Set(['remoteStartedAt', 'outputRole', 'referenceInputSnapshot', 'progress']);
const PROVIDER_KEYS = new Set(['providerId', 'adapterId', 'model']);
const JOB_ERROR_KEYS = new Set(['code', 'messageKey']);
const REFERENCE_INPUT_KEYS = new Set([
  'sourceVisualPrompt',
  'conditioningReferenceAssetIds',
  'aspectRatio',
  'resolution',
]);
const ROUTING_KEYS = new Set(['image', 'video']);
const CUT_KEYS = new Set(['id', 'name', 'orderMode', 'clipOrder', 'clips']);
const CUT_CLIP_KEYS = new Set(['id', 'clipId', 'assetId', 'sourceInSeconds', 'sourceOutSeconds', 'crop', 'filters']);
const RECT_KEYS = new Set(['x', 'y', 'width', 'height']);
const FILTER_KEYS = new Set(['id', 'amount']);
const RULE_KEYS = new Set(['id', 'scope', 'text', 'predicate', 'createdAt']);
const RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const RULE_UNDO_KEYS = new Set(['capturedRevision', 'previousRules']);
const SHELF_SECTION_KEYS = new Set(['kind', 'sectionId']);
const SHELF_ASSET_KEYS = new Set(['kind', 'assetId']);

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
const isUniqueSafeIdArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isSafeId) && new Set(value).size === value.length;

const validateRulePredicate = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, RULE_PREDICATE_KEYS) &&
    value.kind === 'forbidden_terms' &&
    Array.isArray(value.terms) &&
    value.terms.length > 0 &&
    value.terms.length <= STUDIO_RULE_LIMITS.maxTerms &&
    value.terms.every(
      (term) => isNonEmptyStringWithin(term, STUDIO_RULE_LIMITS.term) && hasRuleToken(term as string)
    ) &&
    new Set(value.terms).size === value.terms.length);

const validateRules = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length <= STUDIO_RULE_LIMITS.maxRules &&
  value.every(
    (rule) =>
      isRecord(rule) &&
      hasExactKeys(rule, RULE_KEYS) &&
      isSafeId(rule.id) &&
      rule.scope === 'project' &&
      isNonEmptyStringWithin(rule.text, STUDIO_RULE_LIMITS.text) &&
      validateRulePredicate(rule.predicate) &&
      isCanonicalTimestamp(rule.createdAt)
  ) &&
  new Set(value.map((rule) => (rule as Record<string, unknown>).id)).size === value.length;

const validateRuleUndo = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, RULE_UNDO_KEYS) &&
    isIntegerInRange(value.capturedRevision, 1, Number.MAX_SAFE_INTEGER) &&
    validateRules(value.previousRules));

const validateSection = (sectionId: string, value: unknown): value is StudioSection =>
  isRecord(value) &&
  hasExactKeys(value, SECTION_KEYS) &&
  value.id === sectionId &&
  isSafeId(sectionId) &&
  isStringWithin(value.title, 256) &&
  isStringWithin(value.storyLine, 4 * 1024) &&
  isStringWithin(value.visualPrompt, 8 * 1024) &&
  isUniqueSafeIdArray(value.clipOrder) &&
  value.clipOrder.length <= STUDIO_MAX_CLIPS_PER_SECTION;

const validateClip = (clipId: string, value: unknown): value is StudioClip => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, CLIP_KEYS) ||
    value.id !== clipId ||
    !isSafeId(clipId) ||
    !isStringWithin(value.shotPrompt, 8 * 1024) ||
    !isStringWithin(value.narration, 4 * 1024) ||
    !isStringWithin(value.onScreenText, 1024) ||
    typeof value.mediaKind !== 'string' ||
    !MEDIA_KINDS.has(value.mediaKind) ||
    (value.referenceAssetId !== null && !isSafeId(value.referenceAssetId)) ||
    (value.selectedAssetId !== null && !isSafeId(value.selectedAssetId)) ||
    !isUniqueSafeIdArray(value.assetIds) ||
    !isUniqueSafeIdArray(value.jobIds)
  ) {
    return false;
  }
  return value.mediaKind === 'video'
    ? isIntegerInRange(value.durationSeconds, STUDIO_MIN_VIDEO_CLIP_SECONDS, STUDIO_MAX_VIDEO_CLIP_SECONDS)
    : isIntegerInRange(value.durationSeconds, 1, 60);
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
    (value.clipId !== null && !isSafeId(value.clipId)) ||
    typeof value.mediaKind !== 'string' ||
    !MEDIA_KINDS.has(value.mediaKind) ||
    !isNonEmptyStringWithin(value.mimeType, 256) ||
    typeof value.managedAsset.collection !== 'string' ||
    !STUDIO_MANAGED_ASSET_COLLECTIONS.has(
      value.managedAsset.collection as StudioAssetV2['managedAsset']['collection']
    ) ||
    !isSafeFileName(value.managedAsset.fileName) ||
    !isIntegerInRange(value.byteSize, 0, Number.MAX_SAFE_INTEGER) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(value.sha256) ||
    (value.width !== undefined && !isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER)) ||
    (value.height !== undefined && !isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER)) ||
    (value.durationSeconds !== undefined &&
      !isFiniteInRange(value.durationSeconds, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER)) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return false;
  }
  const hasRole = value.briefReferenceRole !== undefined;
  const hasLabel = value.briefReferenceLabel !== undefined;
  if (hasRole !== hasLabel) return false;
  if (value.clipId === null) {
    if (
      !hasRole ||
      (value.briefReferenceRole !== 'cast' && value.briefReferenceRole !== 'look') ||
      !isStudioBriefReferenceLabel(value.briefReferenceLabel) ||
      value.mediaKind !== 'image' ||
      !isStudioReferenceImageMimeType(value.mimeType) ||
      value.managedAsset.collection !== 'imports'
    ) {
      return false;
    }
  } else if (hasRole) {
    return false;
  }
  if (value.sourceVisualPrompt !== undefined && typeof value.sourceVisualPrompt !== 'string') return false;
  const hasReferenceIds = value.sourceReferenceAssetIds !== undefined;
  const hasAspectRatio = value.sourceAspectRatio !== undefined;
  const hasResolution = value.sourceResolution !== undefined;
  if (hasReferenceIds !== hasAspectRatio || hasAspectRatio !== hasResolution) return false;
  return (
    !hasReferenceIds ||
    (isUniqueSafeIdArray(value.sourceReferenceAssetIds) &&
      value.sourceReferenceAssetIds.length <= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES &&
      value.sourceVisualPrompt !== undefined &&
      value.mediaKind === 'image' &&
      isStudioReferenceImageMimeType(value.mimeType) &&
      value.clipId !== null &&
      value.managedAsset.collection === 'references' &&
      typeof value.sourceAspectRatio === 'string' &&
      ASPECT_RATIOS.has(value.sourceAspectRatio) &&
      typeof value.sourceResolution === 'string' &&
      RESOLUTIONS.has(value.sourceResolution))
  );
};

const validateProvider = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PROVIDER_KEYS) &&
  isSafeId(value.providerId) &&
  typeof value.adapterId === 'string' &&
  ADAPTER_IDS.has(value.adapterId as StudioProviderAdapterId) &&
  isSafeModel(value.model);

const validateJob = (jobId: string, projectId: string, value: unknown): value is StudioJobV2 => {
  if (!isRecord(value) || !hasKeys(value, JOB_REQUIRED_KEYS, JOB_OPTIONAL_KEYS)) return false;
  const errorIsValid =
    value.error === null ||
    (isRecord(value.error) &&
      hasExactKeys(value.error, JOB_ERROR_KEYS) &&
      typeof value.error.code === 'string' &&
      JOB_ERROR_CODES.has(value.error.code) &&
      isNonEmptyStringWithin(value.error.messageKey, 256));
  const snapshotIsValid =
    value.referenceInputSnapshot === undefined ||
    (value.outputRole === 'reference' &&
      isRecord(value.referenceInputSnapshot) &&
      hasExactKeys(value.referenceInputSnapshot, REFERENCE_INPUT_KEYS) &&
      isNonEmptyStringWithin(value.referenceInputSnapshot.sourceVisualPrompt, 4 * 1024) &&
      value.referenceInputSnapshot.sourceVisualPrompt === value.referenceInputSnapshot.sourceVisualPrompt.trim() &&
      isUniqueSafeIdArray(value.referenceInputSnapshot.conditioningReferenceAssetIds) &&
      value.referenceInputSnapshot.conditioningReferenceAssetIds.length <= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES &&
      typeof value.referenceInputSnapshot.aspectRatio === 'string' &&
      ASPECT_RATIOS.has(value.referenceInputSnapshot.aspectRatio) &&
      typeof value.referenceInputSnapshot.resolution === 'string' &&
      RESOLUTIONS.has(value.referenceInputSnapshot.resolution));
  return (
    value.id === jobId &&
    isSafeId(jobId) &&
    value.projectId === projectId &&
    isSafeId(value.clipId) &&
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
    (value.outputRole === undefined || value.outputRole === 'take' || value.outputRole === 'reference') &&
    snapshotIsValid &&
    isUniqueSafeIdArray(value.outputAssetIds) &&
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

const validateRoute = (value: unknown): boolean => value === null || validateProvider(value);

const validateRect = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, RECT_KEYS) &&
  isFiniteInRange(value.x, 0, 1) &&
  isFiniteInRange(value.y, 0, 1) &&
  isFiniteInRange(value.width, Number.MIN_VALUE, 1) &&
  isFiniteInRange(value.height, Number.MIN_VALUE, 1) &&
  (value.x as number) + (value.width as number) <= 1 &&
  (value.y as number) + (value.height as number) <= 1;

const validateFilter = (value: unknown): value is StudioCutFilter =>
  isRecord(value) &&
  hasExactKeys(value, FILTER_KEYS) &&
  typeof value.id === 'string' &&
  CUT_FILTER_IDS.has(value.id) &&
  isFiniteInRange(value.amount, -1, 1);

const validateCutClip = (cutClipId: string, project: StudioProjectV2, value: unknown): value is StudioCutClipV2 => {
  if (!isRecord(value) || !hasExactKeys(value, CUT_CLIP_KEYS)) return false;
  const clip = isSafeId(value.clipId) ? ownValue(project.clips, value.clipId) : undefined;
  const asset = isSafeId(value.assetId) ? ownValue(project.assets, value.assetId) : undefined;
  if (
    value.id !== cutClipId ||
    !isSafeId(cutClipId) ||
    clip === undefined ||
    asset === undefined ||
    !isCanonicalStudioGeneratedTakeV2(asset, project.id, clip) ||
    (value.sourceInSeconds !== null && !isFiniteInRange(value.sourceInSeconds, 0, Number.MAX_VALUE)) ||
    (value.sourceOutSeconds !== null && !isFiniteInRange(value.sourceOutSeconds, 0, Number.MAX_VALUE)) ||
    (value.sourceInSeconds !== null &&
      value.sourceOutSeconds !== null &&
      (value.sourceInSeconds as number) >= (value.sourceOutSeconds as number)) ||
    (value.crop !== null && !validateRect(value.crop)) ||
    !Array.isArray(value.filters) ||
    !value.filters.every(validateFilter)
  ) {
    return false;
  }
  const filterIds = value.filters.map((filter) => (filter as StudioCutFilter).id);
  if (new Set(filterIds).size !== filterIds.length) return false;
  if (asset.durationSeconds === undefined) return true;
  const sourceInSeconds = value.sourceInSeconds as number | null;
  const sourceOutSeconds = value.sourceOutSeconds as number | null;
  return (
    (sourceInSeconds === null || sourceInSeconds <= asset.durationSeconds) &&
    (sourceOutSeconds === null || sourceOutSeconds <= asset.durationSeconds)
  );
};

const validateCut = (cutId: string, project: StudioProjectV2, value: unknown): value is StudioCutV2 => {
  if (!isRecord(value) || !hasExactKeys(value, CUT_KEYS) || !isRecord(value.clips)) return false;
  const cutClips = value.clips;
  const cutClipIds = Object.keys(cutClips);
  if (
    value.id !== cutId ||
    !isSafeId(cutId) ||
    !isNonEmptyStringWithin(value.name, 256) ||
    (value.orderMode !== 'storyboard' && value.orderMode !== 'manual') ||
    !isUniqueSafeIdArray(value.clipOrder) ||
    value.clipOrder.length > STUDIO_MAX_CUT_PLACEMENT_CLIPS ||
    value.clipOrder.length !== cutClipIds.length ||
    !value.clipOrder.every((cutClipId) => Object.hasOwn(cutClips, cutClipId)) ||
    !cutClipIds.every((cutClipId) => validateCutClip(cutClipId, project, cutClips[cutClipId]))
  ) {
    return false;
  }
  const ownedClipIds = cutClipIds.map((cutClipId) => (cutClips[cutClipId] as StudioCutClipV2).clipId);
  return new Set(ownedClipIds).size === ownedClipIds.length;
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

const shelfItemIsExact = (value: unknown): value is StudioShelfItem => {
  if (!isRecord(value)) return false;
  if (value.kind === 'section') return hasExactKeys(value, SHELF_SECTION_KEYS) && isSafeId(value.sectionId);
  if (value.kind === 'asset') return hasExactKeys(value, SHELF_ASSET_KEYS) && isSafeId(value.assetId);
  return false;
};

/** Validates the complete persisted schema-2 project contract without I/O or normalization. */
export const validateStudioProjectV2 = (value: unknown): value is StudioProjectV2 => {
  if (
    !isRecord(value) ||
    !hasKeys(value, PROJECT_REQUIRED_KEYS, PROJECT_OPTIONAL_KEYS) ||
    value.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
    !isIntegerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isSafeId(value.id) ||
    !isNonEmptyStringWithin(value.name, 256) ||
    !isStringWithin(value.brief, 16 * 1024) ||
    !validateRules(value.rules) ||
    !validateRuleUndo(value.ruleListUndo) ||
    (value.forgeProjectId !== undefined && !isSafeId(value.forgeProjectId)) ||
    (value.briefConversationId !== undefined &&
      value.briefConversationId !== null &&
      !isSafeId(value.briefConversationId)) ||
    typeof value.aspectRatio !== 'string' ||
    !ASPECT_RATIOS.has(value.aspectRatio) ||
    !isIntegerInRange(value.targetDurationSeconds, 5, 60) ||
    typeof value.resolution !== 'string' ||
    !RESOLUTIONS.has(value.resolution) ||
    !isUniqueSafeIdArray(value.sectionOrder) ||
    !isRecord(value.sections) ||
    !isRecord(value.clips) ||
    !Array.isArray(value.shelf) ||
    value.shelf.length > STUDIO_MAX_SHELF_ITEMS ||
    !value.shelf.every(shelfItemIsExact) ||
    !isRecord(value.cuts) ||
    (value.activeCutId !== null && !isSafeId(value.activeCutId)) ||
    !isRecord(value.assets) ||
    !isRecord(value.jobs) ||
    !isRecord(value.routing) ||
    !hasExactKeys(value.routing, ROUTING_KEYS) ||
    !validateRoute(value.routing.image) ||
    !validateRoute(value.routing.video) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt)
  ) {
    return false;
  }

  const project = value as StudioProjectV2;
  const sectionIds = Object.keys(project.sections);
  const clipIds = Object.keys(project.clips);
  if (
    sectionIds.length > STUDIO_MAX_SECTIONS ||
    clipIds.length > STUDIO_MAX_CLIPS_PER_PROJECT ||
    !sectionIds.every((sectionId) => validateSection(sectionId, project.sections[sectionId])) ||
    !clipIds.every((clipId) => validateClip(clipId, project.clips[clipId])) ||
    !project.sectionOrder.every((sectionId) => Object.hasOwn(project.sections, sectionId))
  ) {
    return false;
  }

  const clipOwners = new Map<string, string>();
  for (const sectionId of sectionIds) {
    for (const clipId of project.sections[sectionId]!.clipOrder) {
      if (!Object.hasOwn(project.clips, clipId) || clipOwners.has(clipId)) return false;
      clipOwners.set(clipId, sectionId);
    }
  }
  if (clipOwners.size !== clipIds.length) return false;

  const assetIds = Object.keys(project.assets);
  const jobIds = Object.keys(project.jobs);
  if (
    !assetIds.every((assetId) => validateAsset(assetId, project.id, project.assets[assetId])) ||
    !jobIds.every((jobId) => validateJob(jobId, project.id, project.jobs[jobId]))
  ) {
    return false;
  }

  const clipAssetIdsByClipId = new Map<string, ReadonlySet<string>>();
  const clipJobPositionsByClipId = new Map<string, ReadonlyMap<string, number>>();
  for (const clip of Object.values(project.clips)) {
    clipAssetIdsByClipId.set(clip.id, new Set(clip.assetIds));
    clipJobPositionsByClipId.set(clip.id, new Map(clip.jobIds.map((jobId, index) => [jobId, index])));
  }

  const projectReferenceCount = Object.values(project.assets).filter((asset) => asset.clipId === null).length;
  if (projectReferenceCount > STUDIO_MAX_ACTIVE_BRIEF_REFERENCES) return false;
  for (const asset of Object.values(project.assets)) {
    if (asset.clipId !== null) {
      const clip = ownValue(project.clips, asset.clipId);
      if (clip === undefined || !clipAssetIdsByClipId.get(clip.id)?.has(asset.id)) return false;
    }
    if (
      asset.sourceReferenceAssetIds !== undefined &&
      !asset.sourceReferenceAssetIds.every((sourceId) => {
        const source = ownValue(project.assets, sourceId);
        return (
          source?.clipId === null &&
          source.mediaKind === 'image' &&
          source.managedAsset.collection === 'imports' &&
          source.briefReferenceRole !== undefined &&
          source.briefReferenceLabel !== undefined
        );
      })
    ) {
      return false;
    }
  }

  for (const job of Object.values(project.jobs)) {
    const clip = ownValue(project.clips, job.clipId);
    if (clip === undefined || !clipJobPositionsByClipId.get(clip.id)?.has(job.id)) return false;
    if (
      !job.outputAssetIds.every((assetId) => {
        const asset = ownValue(project.assets, assetId);
        return asset?.clipId === clip.id && clipAssetIdsByClipId.get(clip.id)?.has(assetId) === true;
      })
    ) {
      return false;
    }
    if (
      job.referenceInputSnapshot !== undefined &&
      !job.referenceInputSnapshot.conditioningReferenceAssetIds.every((sourceId) => {
        const source = ownValue(project.assets, sourceId);
        return source?.clipId === null && source.managedAsset.collection === 'imports';
      })
    ) {
      return false;
    }
  }

  for (const clip of Object.values(project.clips)) {
    if (!clip.assetIds.every((assetId) => ownValue(project.assets, assetId)?.clipId === clip.id)) return false;
    if (!clip.jobIds.every((jobId) => ownValue(project.jobs, jobId)?.clipId === clip.id)) return false;
    if (clip.selectedAssetId !== null) {
      const selected = ownValue(project.assets, clip.selectedAssetId);
      if (selected === undefined || !isCanonicalStudioGeneratedTakeV2(selected, project.id, clip)) return false;
    }
    if (clip.referenceAssetId !== null) {
      const reference = ownValue(project.assets, clip.referenceAssetId);
      if (reference?.clipId !== clip.id || !clipAssetIdsByClipId.get(clip.id)?.has(reference.id)) return false;
    }
  }

  if (retryGraphHasCycle(project.jobs)) return false;
  for (const job of Object.values(project.jobs)) {
    if (job.retryOfJobId === null) continue;
    const predecessor = ownValue(project.jobs, job.retryOfJobId);
    const owner = ownValue(project.clips, job.clipId);
    if (predecessor === undefined || owner === undefined || predecessor.clipId !== job.clipId) return false;
    const ownerJobPositions = clipJobPositionsByClipId.get(owner.id);
    const predecessorIndex = ownerJobPositions?.get(predecessor.id);
    const retryIndex = ownerJobPositions?.get(job.id);
    if (predecessorIndex === undefined || retryIndex === undefined || predecessorIndex >= retryIndex) return false;
    if (job.retryReason === 'submission_unknown') {
      if (
        (predecessor.status !== 'needs_attention' && predecessor.status !== 'failed') ||
        predecessor.error?.code !== 'submission_unknown' ||
        !job.duplicateChargeAcknowledged
      ) {
        return false;
      }
    } else if (
      job.retryReason !== 'provider_failure' ||
      predecessor.status !== 'failed' ||
      predecessor.error?.code === 'submission_unknown' ||
      predecessor.error?.code === 'download_failed' ||
      job.duplicateChargeAcknowledged
    ) {
      return false;
    }
  }

  const cutIds = Object.keys(project.cuts);
  if (!cutIds.every((cutId) => validateCut(cutId, project, project.cuts[cutId]))) return false;
  if (project.activeCutId !== null && !Object.hasOwn(project.cuts, project.activeCutId)) return false;

  const activeSectionIds = new Set(project.sectionOrder);
  const shelfIdentityKeys = new Set<string>();
  const parkedSectionIds = new Set<string>();
  let parkedSectionItemCount = 0;
  let takeAliasItemCount = 0;
  const cutAssetIds = new Set(
    Object.values(project.cuts).flatMap((cut) => Object.values(cut.clips).map((cutClip) => cutClip.assetId))
  );
  for (const item of project.shelf) {
    const identityKey = item.kind === 'section' ? `section:${item.sectionId}` : `asset:${item.assetId}`;
    if (shelfIdentityKeys.has(identityKey)) return false;
    shelfIdentityKeys.add(identityKey);
    if (item.kind === 'section') {
      parkedSectionItemCount += 1;
      if (parkedSectionItemCount > STUDIO_MAX_SHELF_SECTION_ITEMS) return false;
      if (!Object.hasOwn(project.sections, item.sectionId) || activeSectionIds.has(item.sectionId)) return false;
      parkedSectionIds.add(item.sectionId);
      continue;
    }
    takeAliasItemCount += 1;
    if (takeAliasItemCount > STUDIO_MAX_SHELF_TAKE_ALIASES) return false;
    const asset = ownValue(project.assets, item.assetId);
    if (asset?.clipId === null || asset === undefined) return false;
    const clip = ownValue(project.clips, asset.clipId);
    if (
      clip === undefined ||
      !isCanonicalStudioGeneratedTakeV2(asset, project.id, clip) ||
      clip.selectedAssetId === asset.id ||
      cutAssetIds.has(asset.id)
    ) {
      return false;
    }
  }

  return sectionIds.every(
    (sectionId) => Number(activeSectionIds.has(sectionId)) + Number(parkedSectionIds.has(sectionId)) === 1
  );
};
