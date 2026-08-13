/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as nodeFs } from 'node:fs';
import { watch as watchFileSystem } from 'node:fs';
import path from 'node:path';
import type {
  CreateStudioProjectInput,
  StudioAsset,
  StudioCancellationPolicy,
  StudioConnectionBinding,
  StudioCut,
  StudioCutClip,
  StudioCutFilter,
  StudioJob,
  StudioManagedAssetRef,
  StudioOutputRole,
  StudioProject,
  StudioProjectSummary,
  StudioProposal,
  StudioProposalPayload,
  StudioReferenceRequest,
  StudioRecordProposalInput,
  StudioProviderRef,
  StudioScene,
  StudioTextModelRef,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_RULE_LIMITS, type StudioBriefRule } from '@/common/types/project/creativeStudioRules';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import { STUDIO_MANAGED_ASSET_COLLECTIONS } from '@/common/types/project/creativeStudioManagedAssetCollections';
import { isValidProviderJobId } from '@process/services/creative-studio/adapters/types';
import { toStudioProjectSummary } from '@/common/types/project/creativeStudioProjectSummary';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const REVIEW_STATES = new Set(['draft', 'ready', 'generating', 'complete', 'blocked']);
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
const NONTERMINAL_JOB_STATUSES = new Set(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention']);
const JOB_RETRY_REASONS = new Set(['provider_failure', 'submission_unknown']);
const CANCELLATION_POLICIES = new Set<StudioCancellationPolicy>(['none', 'queued_only', 'queued_and_running']);
const JOB_OUTPUT_ROLES = new Set<StudioOutputRole>(['take', 'reference']);
const ADAPTER_IDS = new Set([
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
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
const PROVIDER_REF_KEYS = new Set(['providerId', 'adapterId', 'model']);
const ROUTING_KEYS = new Set(['storyboard', 'image', 'video']);
const TEXT_MODEL_REF_KEYS = new Set(['providerId', 'model']);
const JOB_ERROR_KEYS = new Set(['code', 'messageKey']);
const SCENE_KEYS = new Set([
  'id',
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
  'selectedAssetId',
  'assetIds',
  'jobIds',
  'reviewState',
]);
const ASSET_KEYS = new Set([
  'id',
  'projectId',
  'sceneId',
  'mediaKind',
  'mimeType',
  'managedAsset',
  'byteSize',
  'sha256',
  'width',
  'height',
  'durationSeconds',
  'createdAt',
  'sourceVisualPrompt',
]);
const MANAGED_ASSET_KEYS = new Set(['collection', 'fileName']);
const CUT_KEYS = new Set(['id', 'name', 'orderMode', 'clipOrder', 'clips']);
const CUT_CLIP_KEYS = new Set(['id', 'sceneId', 'assetId', 'sourceInSeconds', 'sourceOutSeconds', 'crop', 'filters']);
const NORMALISED_RECT_KEYS = new Set(['x', 'y', 'width', 'height']);
const CUT_FILTER_KEYS = new Set(['id', 'amount']);
const CUT_FILTER_IDS = new Set(['exposure', 'contrast', 'saturation', 'temperature']);
const JOB_KEYS = new Set([
  'id',
  'projectId',
  'sceneId',
  'status',
  'provider',
  'idempotencyKey',
  'providerJobId',
  'remoteStartedAt',
  'cancellationPolicy',
  'outputRole',
  'outputAssetIds',
  'error',
  'progress',
  'retryOfJobId',
  'retryReason',
  'duplicateChargeAcknowledged',
  'duplicateChargeAcknowledgedAt',
  'createdAt',
  'updatedAt',
]);
const CONNECTION_BINDING_KEYS = new Set([
  'schemaVersion',
  'id',
  'providerId',
  'adapterId',
  'model',
  'capabilities',
  'validatedAt',
]);
const CONNECTION_MANIFEST_KEYS = new Set(['schemaVersion', 'connections']);
const CONNECTION_CAPABILITY_KEYS = new Set([
  'mediaKinds',
  'audioModes',
  'aspectRatios',
  'resolutions',
  'minDurationSeconds',
  'maxDurationSeconds',
  'supportsFirstFrame',
  'cancellationPolicy',
]);
const FORBIDDEN_CONNECTION_KEY_FRAGMENTS = [
  'authorization',
  'credential',
  'token',
  'secret',
  'key',
  'url',
  'uri',
  'path',
  'base64',
  'bytes',
  'raw',
  'metadata',
] as const;
const FORBIDDEN_RENDERER_FIELDS = new Set([
  'path',
  'filepath',
  'sourcepath',
  'destinationpath',
  'url',
  'signedurl',
  'apikey',
  'credential',
  'credentials',
  'authorization',
  'bytes',
  'base64',
]);
const PROPOSAL_RECORD_KEYS = new Set([
  'schemaVersion',
  'id',
  'projectId',
  'status',
  'baseRevision',
  'payload',
  'createdAt',
  'decidedAt',
]);
const PROPOSAL_STORYBOARD_PAYLOAD_KEYS = new Set(['kind', 'sceneOrder', 'scenes']);
const PROPOSAL_PIN_RULE_PAYLOAD_KEYS = new Set(['kind', 'rule']);
const PROPOSAL_RULE_KEYS = new Set(['text', 'predicate']);
const PROPOSAL_SCENE_KEYS = new Set([
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const BRIEF_RULE_KEYS = new Set(['id', 'scope', 'text', 'predicate', 'createdAt']);
const BRIEF_RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const RULE_LIST_UNDO_KEYS = new Set(['capturedRevision', 'previousRules']);
const PROPOSAL_DECISION_KEYS = new Set(['schemaVersion', 'proposalId', 'status', 'decidedAt']);
const PROPOSAL_SLOT_KEYS = new Set(['schemaVersion', 'proposalId', 'reservedAt']);
const REFERENCE_REQUEST_SLOT_KEYS = new Set(['schemaVersion', 'requestId', 'reservedAt']);
const PROPOSAL_DECISION_STATUSES = new Set(['accepted', 'rejected', 'expired']);
const REFERENCE_REQUEST_RECORD_KEYS = new Set(['schemaVersion', 'id', 'projectId', 'sceneId', 'status', 'createdAt']);

export const STUDIO_PROPOSAL_MAX_RECORD_BYTES = 256 * 1024;
export const STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT = 50;
export const STUDIO_PROPOSAL_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const STUDIO_PROPOSAL_STALE_SLOT_MS = 60 * 1_000;

let temporaryFileCounter = 0;

type StoreErrorCode = 'invalid_payload' | 'not_found' | 'stale_project' | 'busy' | 'storage_error';

export class CreativeStudioStoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'CreativeStudioStoreError';
    this.code = code;
  }
}

export type CreativeStudioStore = {
  listProjects(): Promise<StudioProjectSummary[]>;
  listQuarantinedProjectIds(): Promise<string[]>;
  createProject(input: CreateStudioProjectInput): Promise<StudioProject>;
  getProject(projectId: string): Promise<StudioProject | null>;
  updateProject(
    projectId: string,
    update: (project: StudioProject) => StudioProject,
    expectedRevision?: number
  ): Promise<StudioProject>;
  deleteProject(projectId: string, expectedRevision: number): Promise<boolean>;
  listConnections(): Promise<StudioConnectionBinding[]>;
  saveConnection(binding: StudioConnectionBinding): Promise<StudioConnectionBinding>;
  removeConnection(connectionId: string): Promise<boolean>;
  recordProposal(input: StudioRecordProposalInput): Promise<StudioProposal>;
  listProposals(projectId: string): Promise<StudioProposal[]>;
  listPendingReferenceRequests(projectId: string): Promise<StudioReferenceRequest[]>;
  dismissReferenceRequests(projectId: string, requestIds: string[]): Promise<void>;
  acceptProposal(
    projectId: string,
    proposalId: string,
    update: (project: StudioProject, payload: StudioProposalPayload) => StudioProject
  ): Promise<{ proposal: StudioProposal; project: StudioProject; applied: boolean }>;
  rejectProposal(projectId: string, proposalId: string): Promise<StudioProposal>;
  reapAbandonedProposals(): Promise<void>;
  watchProposals(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>>;
  resolveProposalPaths(
    projectId: string
  ): Promise<{ projectDir: string; pendingDir: string; referencePendingDir: string }>;
  /** Main-process-only canonical project path; never return this through IPC. */
  getVerifiedProjectDirectory(projectId: string): Promise<string | null>;
};

export type CreativeStudioStoreDeps = {
  rootDir: string;
  now?: () => string;
  createId?: () => string;
  fs?: typeof nodeFs;
  logError?: (message: string, error: unknown) => void;
  watchProposalTree?: (input: {
    rootDir: string;
    onChange: (relativeFile: string) => void;
    onError: (error: Error) => void;
  }) => { close(): void };
};

type ProjectListingSweep = {
  projects: StudioProjectSummary[];
  quarantinedProjectIds: string[];
};

type JsonRecord = Record<string, unknown>;

type StudioProposalDecision = {
  schemaVersion: 1;
  proposalId: string;
  status: Exclude<StudioProposal['status'], 'pending'>;
  decidedAt: string;
};

type StudioProposalSlot = {
  schemaVersion: 1;
  proposalId: string;
  reservedAt: string;
};

type StudioReferenceRequestSlot = {
  schemaVersion: 1;
  requestId: string;
  reservedAt: string;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const containsForbiddenRendererField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenRendererField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nestedValue]) =>
      FORBIDDEN_RENDERER_FIELDS.has(key.toLowerCase()) || containsForbiddenRendererField(nestedValue)
  );
};

const normalizeConnectionFieldKey = (key: string): string =>
  key
    .normalize('NFKC')
    .replaceAll(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

const containsForbiddenConnectionField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenConnectionField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalized = normalizeConnectionFieldKey(key);
    return (
      FORBIDDEN_CONNECTION_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
      containsForbiddenConnectionField(nestedValue)
    );
  });
};

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isSafeProposalId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);
const isSafeConnectionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

const isString = (value: unknown): value is string => typeof value === 'string';

const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;

const isSafeConnectionModel = (value: unknown): value is string => {
  if (!isString(value) || value.length === 0 || value.length > 256 || value !== value.trim()) return false;
  return !value.split('').some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
};

const isSafeModel = isSafeConnectionModel;

const isCanonicalIsoTimestamp = (value: unknown): value is string => {
  if (!isString(value) || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isSafeAssetFileName = (value: unknown): value is string =>
  isNonEmptyString(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');

const asArrayOfSafeIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(isSafeId);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));

const validateProposalScene = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_SCENE_KEYS) &&
  isString(value.title) &&
  value.title.length <= 256 &&
  isString(value.purpose) &&
  value.purpose.length <= 256 &&
  isString(value.visualPrompt) &&
  value.visualPrompt.length <= 8 * 1024 &&
  isString(value.narration) &&
  value.narration.length <= 4 * 1024 &&
  isString(value.onScreenText) &&
  value.onScreenText.length <= 1024 &&
  isString(value.mediaKind) &&
  MEDIA_KINDS.has(value.mediaKind) &&
  isIntegerInRange(value.durationSeconds, 1, 60) &&
  (value.referenceAssetId === null || isSafeId(value.referenceAssetId));

const validateBriefRulePredicate = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, BRIEF_RULE_PREDICATE_KEYS) &&
    value.kind === 'forbidden_terms' &&
    Array.isArray(value.terms) &&
    value.terms.length > 0 &&
    value.terms.length <= STUDIO_RULE_LIMITS.maxTerms &&
    value.terms.every((term) => isNonEmptyString(term) && term.length <= STUDIO_RULE_LIMITS.term) &&
    new Set(value.terms).size === value.terms.length);

/**
 * A rule on the project record is always project-scoped. The organisation layer is code-resident
 * (ORGANISATION_STUDIO_RULES) and is refused here on purpose: a locked rule cached on disk could be
 * edited out of the file by hand, which is exactly what "locked" must not mean.
 */
const validateBriefRule = (value: unknown): value is StudioBriefRule =>
  isRecord(value) &&
  hasExactKeys(value, BRIEF_RULE_KEYS) &&
  isSafeId(value.id) &&
  value.scope === 'project' &&
  isNonEmptyString(value.text) &&
  value.text.length <= STUDIO_RULE_LIMITS.text &&
  validateBriefRulePredicate(value.predicate) &&
  isCanonicalIsoTimestamp(value.createdAt);

const validateBriefRules = (value: unknown): value is StudioBriefRule[] =>
  Array.isArray(value) &&
  value.length <= STUDIO_RULE_LIMITS.maxRules &&
  value.every(validateBriefRule) &&
  new Set(value.map((rule) => (rule as StudioBriefRule).id)).size === value.length;

const validateRuleListUndo = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, RULE_LIST_UNDO_KEYS) &&
    isIntegerInRange(value.capturedRevision, 1, Number.MAX_SAFE_INTEGER) &&
    validateBriefRules(value.previousRules));

const validateStoryboardProposalPayload = (value: Record<string, unknown>): boolean => {
  if (!isRecord(value.scenes) || !hasExactKeys(value, PROPOSAL_STORYBOARD_PAYLOAD_KEYS)) return false;
  const scenes = value.scenes;
  const sceneOrder = value.sceneOrder;
  if (!asArrayOfSafeIds(sceneOrder)) return false;
  const sceneIds = Object.keys(scenes);
  return (
    sceneOrder.length > 0 &&
    sceneOrder.length <= 24 &&
    new Set(sceneOrder).size === sceneOrder.length &&
    sceneIds.length === sceneOrder.length &&
    sceneIds.every((sceneId) => sceneOrder.includes(sceneId) && validateProposalScene(scenes[sceneId]))
  );
};

const validatePinRuleProposalPayload = (value: Record<string, unknown>): boolean =>
  hasExactKeys(value, PROPOSAL_PIN_RULE_PAYLOAD_KEYS) &&
  isRecord(value.rule) &&
  hasExactKeys(value.rule, PROPOSAL_RULE_KEYS) &&
  isNonEmptyString(value.rule.text) &&
  value.rule.text.length <= STUDIO_RULE_LIMITS.text &&
  validateBriefRulePredicate(value.rule.predicate);

const validateProposalPayload = (value: unknown): value is StudioProposalPayload => {
  if (!isRecord(value) || containsForbiddenRendererField(value)) return false;
  if (value.kind === 'replace_storyboard') return validateStoryboardProposalPayload(value);
  if (value.kind === 'pin_rule') return validatePinRuleProposalPayload(value);
  return false;
};

const validateProposalRecord = (projectId: string, proposalId: string, value: unknown): value is StudioProposal =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_RECORD_KEYS) &&
  value.schemaVersion === 1 &&
  value.id === proposalId &&
  isSafeProposalId(value.id) &&
  value.projectId === projectId &&
  value.status === 'pending' &&
  isIntegerInRange(value.baseRevision, 1, Number.MAX_SAFE_INTEGER) &&
  validateProposalPayload(value.payload) &&
  isCanonicalIsoTimestamp(value.createdAt) &&
  value.decidedAt === null;

const validateProposalDecision = (proposalId: string, value: unknown): value is StudioProposalDecision =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_DECISION_KEYS) &&
  value.schemaVersion === 1 &&
  value.proposalId === proposalId &&
  isSafeProposalId(value.proposalId) &&
  isString(value.status) &&
  PROPOSAL_DECISION_STATUSES.has(value.status) &&
  isCanonicalIsoTimestamp(value.decidedAt);

const validateProposalSlot = (value: unknown): value is StudioProposalSlot =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_SLOT_KEYS) &&
  value.schemaVersion === 1 &&
  isSafeProposalId(value.proposalId) &&
  isCanonicalIsoTimestamp(value.reservedAt);

const validateReferenceRequestSlot = (value: unknown): value is StudioReferenceRequestSlot =>
  isRecord(value) &&
  hasExactKeys(value, REFERENCE_REQUEST_SLOT_KEYS) &&
  value.schemaVersion === 1 &&
  isSafeProposalId(value.requestId) &&
  isCanonicalIsoTimestamp(value.reservedAt);

const validateReferenceRequestRecord = (
  project: StudioProject,
  requestId: string,
  value: unknown
): value is StudioReferenceRequest =>
  isRecord(value) &&
  hasExactKeys(value, REFERENCE_REQUEST_RECORD_KEYS) &&
  value.schemaVersion === 1 &&
  value.id === requestId &&
  isSafeProposalId(value.id) &&
  value.projectId === project.id &&
  isSafeId(value.sceneId) &&
  project.scenes[value.sceneId] !== undefined &&
  value.status === 'pending' &&
  isCanonicalIsoTimestamp(value.createdAt);

const validateProviderRef = (value: unknown): value is StudioProviderRef =>
  isRecord(value) &&
  hasExactKeys(value, PROVIDER_REF_KEYS) &&
  isSafeId(value.providerId) &&
  isString(value.adapterId) &&
  ADAPTER_IDS.has(value.adapterId) &&
  isNonEmptyString(value.model);

const validateTextModelRef = (value: unknown): value is StudioTextModelRef =>
  isRecord(value) && hasExactKeys(value, TEXT_MODEL_REF_KEYS) && isSafeId(value.providerId) && isSafeModel(value.model);

const validateConnectionBinding = (value: unknown): value is StudioConnectionBinding => {
  if (!isRecord(value) || !isRecord(value.capabilities)) return false;
  const capabilities = value.capabilities;
  const mediaKinds = capabilities.mediaKinds;
  const validKinds =
    Array.isArray(mediaKinds) &&
    mediaKinds.length > 0 &&
    mediaKinds.length <= 2 &&
    mediaKinds.every((kind) => isString(kind) && MEDIA_KINDS.has(kind)) &&
    new Set(mediaKinds).size === mediaKinds.length;
  const optionalAudioModes =
    capabilities.audioModes === undefined ||
    (Array.isArray(capabilities.audioModes) &&
      capabilities.audioModes.length === 1 &&
      capabilities.audioModes[0] === 'none');
  const optionalAspectRatios =
    capabilities.aspectRatios === undefined ||
    (Array.isArray(capabilities.aspectRatios) &&
      capabilities.aspectRatios.length <= 5 &&
      capabilities.aspectRatios.every((ratio) => isString(ratio) && ASPECT_RATIOS.has(ratio)) &&
      new Set(capabilities.aspectRatios).size === capabilities.aspectRatios.length);
  const optionalResolutions =
    capabilities.resolutions === undefined ||
    (Array.isArray(capabilities.resolutions) &&
      capabilities.resolutions.length <= 2 &&
      capabilities.resolutions.every((resolution) => isString(resolution) && RESOLUTIONS.has(resolution)) &&
      new Set(capabilities.resolutions).size === capabilities.resolutions.length);
  const validAdapterCapabilities =
    value.adapterId === 'weprompt-image-v1'
      ? Array.isArray(mediaKinds) &&
        mediaKinds.length === 1 &&
        mediaKinds[0] === 'image' &&
        capabilities.audioModes === undefined
      : (value.adapterId === 'byteplus-seedance-v1' ||
          value.adapterId === 'weprompt-media-gateway-v1' ||
          value.adapterId === 'openrouter-video-v1') &&
        Array.isArray(mediaKinds) &&
        mediaKinds.length === 1 &&
        mediaKinds[0] === 'video' &&
        Array.isArray(capabilities.audioModes) &&
        capabilities.audioModes.length === 1 &&
        capabilities.audioModes[0] === 'none';
  return (
    Object.keys(value).length === CONNECTION_BINDING_KEYS.size &&
    Object.keys(value).every((key) => CONNECTION_BINDING_KEYS.has(key)) &&
    value.schemaVersion === 1 &&
    isSafeConnectionId(value.id) &&
    isSafeConnectionId(value.providerId) &&
    isString(value.adapterId) &&
    ADAPTER_IDS.has(value.adapterId) &&
    isSafeConnectionModel(value.model) &&
    Object.keys(capabilities).every((key) => CONNECTION_CAPABILITY_KEYS.has(key)) &&
    validKinds &&
    validAdapterCapabilities &&
    optionalAudioModes &&
    optionalAspectRatios &&
    optionalResolutions &&
    (capabilities.supportsFirstFrame === undefined || typeof capabilities.supportsFirstFrame === 'boolean') &&
    isString(capabilities.cancellationPolicy) &&
    CANCELLATION_POLICIES.has(capabilities.cancellationPolicy as StudioCancellationPolicy) &&
    (capabilities.minDurationSeconds === undefined || isIntegerInRange(capabilities.minDurationSeconds, 1, 60)) &&
    (capabilities.maxDurationSeconds === undefined || isIntegerInRange(capabilities.maxDurationSeconds, 1, 60)) &&
    (capabilities.minDurationSeconds === undefined ||
      capabilities.maxDurationSeconds === undefined ||
      (capabilities.minDurationSeconds as number) <= (capabilities.maxDurationSeconds as number)) &&
    isCanonicalIsoTimestamp(value.validatedAt) &&
    !containsForbiddenConnectionField(value)
  );
};

const canonicalizeConnectionBinding = (value: unknown): StudioConnectionBinding | null => {
  if (!isRecord(value) || !isRecord(value.capabilities)) return null;
  const capabilities = value.capabilities;
  const hasPolicy = Object.hasOwn(capabilities, 'cancellationPolicy');
  const hasLegacy = Object.hasOwn(capabilities, 'cancellation');
  if (hasPolicy && hasLegacy) return null;

  let cancellationPolicy: StudioCancellationPolicy;
  if (hasPolicy) {
    if (!isString(capabilities.cancellationPolicy)) return null;
    cancellationPolicy = capabilities.cancellationPolicy as StudioCancellationPolicy;
    if (!CANCELLATION_POLICIES.has(cancellationPolicy)) return null;
  } else if (hasLegacy) {
    if (typeof capabilities.cancellation !== 'boolean') return null;
    cancellationPolicy = capabilities.cancellation ? 'queued_only' : 'none';
  } else {
    cancellationPolicy = 'none';
  }

  const { cancellation: _legacyCancellation, ...canonicalCapabilities } = capabilities;
  const candidate = {
    ...value,
    capabilities: { ...canonicalCapabilities, cancellationPolicy },
  };
  return validateConnectionBinding(candidate) ? candidate : null;
};

const validateScene = (sceneId: string, value: unknown): value is StudioScene => {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).length === SCENE_KEYS.size &&
    Object.keys(value).every((key) => SCENE_KEYS.has(key)) &&
    value.id === sceneId &&
    isSafeId(sceneId) &&
    isString(value.title) &&
    isString(value.purpose) &&
    isString(value.visualPrompt) &&
    isString(value.narration) &&
    isString(value.onScreenText) &&
    isString(value.mediaKind) &&
    MEDIA_KINDS.has(value.mediaKind) &&
    isIntegerInRange(value.durationSeconds, 1, 60) &&
    (value.referenceAssetId === null || isSafeId(value.referenceAssetId)) &&
    (value.selectedAssetId === null || isSafeId(value.selectedAssetId)) &&
    asArrayOfSafeIds(value.assetIds) &&
    new Set(value.assetIds).size === value.assetIds.length &&
    asArrayOfSafeIds(value.jobIds) &&
    new Set(value.jobIds).size === value.jobIds.length &&
    isString(value.reviewState) &&
    REVIEW_STATES.has(value.reviewState)
  );
};

const validateAsset = (
  assetId: string,
  projectId: string,
  sceneIds: Set<string>,
  value: unknown
): value is StudioAsset => {
  if (!isRecord(value) || !isRecord(value.managedAsset)) return false;
  return (
    Object.keys(value).every((key) => ASSET_KEYS.has(key)) &&
    Object.keys(value.managedAsset).length === MANAGED_ASSET_KEYS.size &&
    Object.keys(value.managedAsset).every((key) => MANAGED_ASSET_KEYS.has(key)) &&
    value.id === assetId &&
    isSafeId(assetId) &&
    value.projectId === projectId &&
    (value.sceneId === null || (isSafeId(value.sceneId) && sceneIds.has(value.sceneId))) &&
    isString(value.mediaKind) &&
    MEDIA_KINDS.has(value.mediaKind) &&
    isNonEmptyString(value.mimeType) &&
    isString(value.managedAsset.collection) &&
    STUDIO_MANAGED_ASSET_COLLECTIONS.has(value.managedAsset.collection as StudioManagedAssetRef['collection']) &&
    isSafeAssetFileName(value.managedAsset.fileName) &&
    isIntegerInRange(value.byteSize, 0, Number.MAX_SAFE_INTEGER) &&
    isString(value.sha256) &&
    /^[a-f0-9]{64}$/i.test(value.sha256) &&
    (value.width === undefined || isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER)) &&
    (value.height === undefined || isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER)) &&
    (value.durationSeconds === undefined ||
      (isFiniteInRange(value.durationSeconds, 0, Number.MAX_SAFE_INTEGER) && value.durationSeconds > 0)) &&
    isNonEmptyString(value.createdAt) &&
    (value.sourceVisualPrompt === undefined || isString(value.sourceVisualPrompt))
  );
};

const validateNormalisedRect = (value: unknown): boolean => {
  if (!isRecord(value) || !hasExactKeys(value, NORMALISED_RECT_KEYS)) return false;
  return (
    isFiniteInRange(value.x, 0, 1) &&
    isFiniteInRange(value.y, 0, 1) &&
    isFiniteInRange(value.width, 0, 1) &&
    value.width > 0 &&
    isFiniteInRange(value.height, 0, 1) &&
    value.height > 0 &&
    value.x + value.width <= 1 &&
    value.y + value.height <= 1
  );
};

const validateCutFilter = (value: unknown): value is StudioCutFilter =>
  isRecord(value) &&
  hasExactKeys(value, CUT_FILTER_KEYS) &&
  isString(value.id) &&
  CUT_FILTER_IDS.has(value.id) &&
  isFiniteInRange(value.amount, -1, 1);

const validateTrimPoint = (value: unknown): value is number | null =>
  value === null || isFiniteInRange(value, 0, Number.MAX_VALUE);

const validateCutClip = (
  clipId: string,
  projectId: string,
  scenes: Record<string, StudioScene>,
  assets: Record<string, StudioAsset>,
  value: unknown
): value is StudioCutClip => {
  if (!isRecord(value) || !hasExactKeys(value, CUT_CLIP_KEYS)) return false;
  const scene = isSafeId(value.sceneId) ? scenes[value.sceneId] : undefined;
  const asset = isSafeId(value.assetId) ? assets[value.assetId] : undefined;
  if (
    value.id !== clipId ||
    !isSafeId(clipId) ||
    scene === undefined ||
    asset === undefined ||
    !isCanonicalStudioGeneratedTake(asset, projectId, scene) ||
    !validateTrimPoint(value.sourceInSeconds) ||
    !validateTrimPoint(value.sourceOutSeconds) ||
    (value.sourceInSeconds !== null &&
      value.sourceOutSeconds !== null &&
      value.sourceInSeconds >= value.sourceOutSeconds) ||
    (value.crop !== null && !validateNormalisedRect(value.crop)) ||
    !Array.isArray(value.filters) ||
    !value.filters.every(validateCutFilter)
  ) {
    return false;
  }
  const filterIds = value.filters.map((filter) => filter.id);
  if (new Set(filterIds).size !== filterIds.length) return false;
  if (asset.durationSeconds === undefined) return true;
  return (
    (value.sourceInSeconds === null || value.sourceInSeconds <= asset.durationSeconds) &&
    (value.sourceOutSeconds === null || value.sourceOutSeconds <= asset.durationSeconds)
  );
};

const validateCut = (
  cutId: string,
  projectId: string,
  scenes: Record<string, StudioScene>,
  assets: Record<string, StudioAsset>,
  value: unknown
): value is StudioCut => {
  if (!isRecord(value) || !isRecord(value.clips) || !hasExactKeys(value, CUT_KEYS)) return false;
  const clips = value.clips;
  const clipIds = Object.keys(clips);
  return (
    value.id === cutId &&
    isSafeId(cutId) &&
    isString(value.name) &&
    (value.orderMode === 'storyboard' || value.orderMode === 'manual') &&
    asArrayOfSafeIds(value.clipOrder) &&
    value.clipOrder.length === clipIds.length &&
    new Set(value.clipOrder).size === value.clipOrder.length &&
    value.clipOrder.every((clipId) => Object.hasOwn(clips, clipId)) &&
    clipIds.every((clipId) => validateCutClip(clipId, projectId, scenes, assets, clips[clipId]))
  );
};

const validateCuts = (
  cuts: Record<string, unknown>,
  projectId: string,
  scenes: Record<string, StudioScene>,
  assets: Record<string, StudioAsset>
): cuts is Record<string, StudioCut> =>
  Object.keys(cuts).every((cutId) => validateCut(cutId, projectId, scenes, assets, cuts[cutId]));

const IMPLICIT_CUT_ID = 'cut_1';

export type ResolvedStudioCutState = {
  cuts: Record<string, StudioCut>;
  activeCutId: string | null;
};

const selectedTake = (project: StudioProject, scene: StudioScene): StudioAsset | null => {
  if (scene.selectedAssetId === null) return null;
  const asset = project.assets[scene.selectedAssetId];
  return asset !== undefined && isCanonicalStudioGeneratedTake(asset, project.id, scene) ? asset : null;
};

const implicitClipIdBase = (sceneId: string, suffix = ''): string =>
  `clip_${sceneId}`.slice(0, 256 - suffix.length) + suffix;

const allocateClipId = (sceneId: string, occupied: ReadonlySet<string>): string => {
  const base = implicitClipIdBase(sceneId);
  if (!occupied.has(base)) return base;
  let suffix = 2;
  while (occupied.has(implicitClipIdBase(sceneId, `_${suffix}`))) suffix += 1;
  return implicitClipIdBase(sceneId, `_${suffix}`);
};

const pristineClip = (scene: StudioScene, asset: StudioAsset, id: string): StudioCutClip => ({
  id,
  sceneId: scene.id,
  assetId: asset.id,
  sourceInSeconds: null,
  sourceOutSeconds: null,
  crop: null,
  filters: [],
});

const deriveImplicitCut = (project: StudioProject): StudioCut => {
  const clips: Record<string, StudioCutClip> = {};
  const clipOrder: string[] = [];
  const occupied = new Set<string>();
  for (const sceneId of project.sceneOrder) {
    const scene = project.scenes[sceneId];
    if (scene === undefined) continue;
    const asset = selectedTake(project, scene);
    if (asset === null) continue;
    const clipId = allocateClipId(scene.id, occupied);
    occupied.add(clipId);
    clips[clipId] = pristineClip(scene, asset, clipId);
    clipOrder.push(clipId);
  }
  return {
    id: IMPLICIT_CUT_ID,
    name: project.name,
    orderMode: 'storyboard',
    clipOrder,
    clips,
  };
};

/** Resolves legacy projects to a pristine in-memory cut without mutating or persisting them. */
export const resolveStudioCutState = (project: StudioProject): ResolvedStudioCutState => {
  if (project.cuts !== undefined && project.activeCutId !== undefined) {
    return { cuts: project.cuts, activeCutId: project.activeCutId };
  }
  const cut = deriveImplicitCut(project);
  return { cuts: { [cut.id]: cut }, activeCutId: cut.id };
};

const clampClipToAsset = (clip: StudioCutClip, asset: StudioAsset): StudioCutClip => {
  if (asset.durationSeconds === undefined) return { ...clip, assetId: asset.id };
  if (clip.sourceInSeconds !== null && clip.sourceInSeconds >= asset.durationSeconds) {
    return { ...clip, assetId: asset.id, sourceInSeconds: null, sourceOutSeconds: null };
  }
  return {
    ...clip,
    assetId: asset.id,
    sourceOutSeconds: clip.sourceOutSeconds === null ? null : Math.min(clip.sourceOutSeconds, asset.durationSeconds),
  };
};

const reconcileCut = (project: StudioProject, cut: StudioCut): StudioCut => {
  const clips: Record<string, StudioCutClip> = {};
  const priorOrder = [...cut.clipOrder];
  const orderedExistingIds = [
    ...priorOrder,
    ...Object.keys(cut.clips).filter((clipId) => !priorOrder.includes(clipId)),
  ];
  for (const clipId of orderedExistingIds) {
    const clip = cut.clips[clipId];
    const scene = clip === undefined ? undefined : project.scenes[clip.sceneId];
    const asset = scene === undefined ? null : selectedTake(project, scene);
    if (clip === undefined || asset === null) continue;
    clips[clipId] = clampClipToAsset(clip, asset);
  }

  const occupied = new Set(Object.keys(clips));
  const addedIds: string[] = [];
  if (cut.orderMode === 'storyboard') {
    for (const sceneId of project.sceneOrder) {
      const scene = project.scenes[sceneId];
      if (scene === undefined || Object.values(clips).some((clip) => clip.sceneId === sceneId)) continue;
      const asset = selectedTake(project, scene);
      if (asset === null) continue;
      const clipId = allocateClipId(sceneId, occupied);
      occupied.add(clipId);
      addedIds.push(clipId);
      clips[clipId] = pristineClip(scene, asset, clipId);
    }
  }

  const retainedPriorOrder = priorOrder.filter((clipId) => Object.hasOwn(clips, clipId));
  const clipOrder =
    cut.orderMode === 'manual'
      ? [...retainedPriorOrder, ...addedIds]
      : project.sceneOrder.flatMap((sceneId) =>
          [...retainedPriorOrder, ...addedIds].filter((clipId) => clips[clipId]?.sceneId === sceneId)
        );
  return { ...cut, clipOrder, clips };
};

/** Keeps already-persisted cuts aligned with canonical selection and storyboard changes. */
export const reconcilePersistedStudioCuts = (project: StudioProject): StudioProject => {
  if (project.cuts === undefined || project.activeCutId === undefined) return project;
  return {
    ...project,
    cuts: Object.fromEntries(Object.entries(project.cuts).map(([cutId, cut]) => [cutId, reconcileCut(project, cut)])),
  };
};

const validateJob = (jobId: string, projectId: string, sceneIds: Set<string>, value: unknown): value is StudioJob => {
  if (!isRecord(value)) return false;
  const errorIsValid =
    value.error === null ||
    (isRecord(value.error) &&
      Object.keys(value.error).length === JOB_ERROR_KEYS.size &&
      Object.keys(value.error).every((key) => JOB_ERROR_KEYS.has(key)) &&
      isString(value.error.code) &&
      JOB_ERROR_CODES.has(value.error.code) &&
      isNonEmptyString(value.error.messageKey));
  return (
    Object.keys(value).every((key) => JOB_KEYS.has(key)) &&
    value.id === jobId &&
    isSafeId(jobId) &&
    value.projectId === projectId &&
    isSafeId(value.sceneId) &&
    sceneIds.has(value.sceneId) &&
    isString(value.status) &&
    JOB_STATUSES.has(value.status) &&
    validateProviderRef(value.provider) &&
    isSafeId(value.idempotencyKey) &&
    (value.providerJobId === null || (isString(value.providerJobId) && isValidProviderJobId(value.providerJobId))) &&
    (!Object.hasOwn(value, 'remoteStartedAt') ||
      (value.providerJobId === null
        ? value.remoteStartedAt === null
        : isCanonicalIsoTimestamp(value.remoteStartedAt))) &&
    isString(value.cancellationPolicy) &&
    CANCELLATION_POLICIES.has(value.cancellationPolicy as StudioCancellationPolicy) &&
    (value.outputRole === undefined ||
      (isString(value.outputRole) && JOB_OUTPUT_ROLES.has(value.outputRole as StudioOutputRole))) &&
    asArrayOfSafeIds(value.outputAssetIds) &&
    new Set(value.outputAssetIds).size === value.outputAssetIds.length &&
    errorIsValid &&
    (value.progress === undefined ||
      (typeof value.progress === 'number' &&
        Number.isFinite(value.progress) &&
        value.progress >= 0 &&
        value.progress <= 100)) &&
    (value.retryOfJobId === null || isSafeId(value.retryOfJobId)) &&
    (value.retryReason === null || (isString(value.retryReason) && JOB_RETRY_REASONS.has(value.retryReason))) &&
    typeof value.duplicateChargeAcknowledged === 'boolean' &&
    (value.duplicateChargeAcknowledgedAt === null || isCanonicalIsoTimestamp(value.duplicateChargeAcknowledgedAt)) &&
    ((value.retryOfJobId === null && value.retryReason === null) ||
      (value.retryOfJobId !== null && value.retryReason !== null)) &&
    (value.duplicateChargeAcknowledged
      ? value.retryReason === 'submission_unknown' && value.duplicateChargeAcknowledgedAt !== null
      : value.duplicateChargeAcknowledgedAt === null) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
};

/** Defaults lineage fields added during Task 6 without weakening schema-v1 validation. */
const migrateSchemaV1Project = (value: unknown): unknown => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.jobs)) return value;
  let changed = false;
  const jobs = Object.fromEntries(
    Object.entries(value.jobs).map(([jobId, candidate]) => {
      if (!isRecord(candidate)) return [jobId, candidate];
      const job = { ...candidate };
      if (!Object.hasOwn(job, 'retryOfJobId')) {
        job.retryOfJobId = null;
        changed = true;
      }
      if (!Object.hasOwn(job, 'retryReason')) {
        job.retryReason = null;
        changed = true;
      }
      if (!Object.hasOwn(job, 'duplicateChargeAcknowledged')) {
        job.duplicateChargeAcknowledged = false;
        changed = true;
      }
      if (!Object.hasOwn(job, 'duplicateChargeAcknowledgedAt')) {
        job.duplicateChargeAcknowledgedAt = null;
        changed = true;
      }
      if (!Object.hasOwn(job, 'cancellationPolicy')) {
        job.cancellationPolicy = 'none';
        changed = true;
      }
      return [jobId, job];
    })
  );
  const routing =
    isRecord(value.routing) && !Object.hasOwn(value.routing, 'storyboard')
      ? { ...value.routing, storyboard: null }
      : value.routing;
  // Defaulted here, before validateProject runs at readProject, so a manifest written before rules
  // existed reads back rather than being quarantined. The migrator is unconditional for any record
  // that could otherwise pass validation, which is what makes it safe to validate `rules` as
  // required in the same change.
  const rulesMissing = !Object.hasOwn(value, 'rules');
  const ruleListUndoMissing = !Object.hasOwn(value, 'ruleListUndo');
  return changed || routing !== value.routing || rulesMissing || ruleListUndoMissing
    ? {
        ...value,
        jobs,
        routing,
        ...(rulesMissing ? { rules: [] } : {}),
        ...(ruleListUndoMissing ? { ruleListUndo: null } : {}),
      }
    : value;
};

const retryGraphHasCycle = (jobs: Record<string, StudioJob>): boolean => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (jobId: string): boolean => {
    if (visiting.has(jobId)) return true;
    if (visited.has(jobId)) return false;
    visiting.add(jobId);
    const predecessorId = jobs[jobId]?.retryOfJobId;
    if (predecessorId !== null && predecessorId !== undefined && Object.hasOwn(jobs, predecessorId)) {
      if (visit(predecessorId)) return true;
    }
    visiting.delete(jobId);
    visited.add(jobId);
    return false;
  };
  return Object.keys(jobs).some(visit);
};

const validateProject = (value: unknown): value is StudioProject => {
  if (
    !isRecord(value) ||
    !isRecord(value.scenes) ||
    !isRecord(value.assets) ||
    !isRecord(value.jobs) ||
    !isRecord(value.routing)
  ) {
    return false;
  }
  const scenes = value.scenes;
  const assets = value.assets;
  const jobs = value.jobs;
  const routing = value.routing;
  const projectId = value.id;
  const sceneOrder = value.sceneOrder;
  const cutsPresent = Object.hasOwn(value, 'cuts');
  const activeCutIdPresent = Object.hasOwn(value, 'activeCutId');
  if (containsForbiddenRendererField(value)) return false;
  if (
    value.schemaVersion !== 1 ||
    !isSafeId(projectId) ||
    !isIntegerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isNonEmptyString(value.name) ||
    !isString(value.brief) ||
    !validateBriefRules(value.rules) ||
    !validateRuleListUndo(value.ruleListUndo) ||
    (value.forgeProjectId !== undefined && !isSafeId(value.forgeProjectId)) ||
    (value.briefConversationId !== undefined &&
      value.briefConversationId !== null &&
      !isSafeId(value.briefConversationId)) ||
    !isString(value.aspectRatio) ||
    !ASPECT_RATIOS.has(value.aspectRatio) ||
    !isIntegerInRange(value.targetDurationSeconds, 5, 60) ||
    !isString(value.resolution) ||
    !RESOLUTIONS.has(value.resolution) ||
    !asArrayOfSafeIds(sceneOrder) ||
    cutsPresent !== activeCutIdPresent ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    !hasExactKeys(routing, ROUTING_KEYS) ||
    (routing.storyboard !== null && !validateTextModelRef(routing.storyboard)) ||
    (routing.image !== null && !validateProviderRef(routing.image)) ||
    (routing.video !== null && !validateProviderRef(routing.video))
  ) {
    return false;
  }

  const sceneIds = Object.keys(scenes);
  if (
    sceneIds.some((sceneId) => !validateScene(sceneId, scenes[sceneId])) ||
    sceneOrder.length !== sceneIds.length ||
    new Set(sceneOrder).size !== sceneOrder.length ||
    sceneOrder.some((sceneId) => !Object.hasOwn(scenes, sceneId))
  ) {
    return false;
  }

  const sceneIdSet = new Set(sceneIds);
  if (Object.keys(assets).some((assetId) => !validateAsset(assetId, projectId, sceneIdSet, assets[assetId]))) {
    return false;
  }
  if (Object.keys(jobs).some((jobId) => !validateJob(jobId, projectId, sceneIdSet, jobs[jobId]))) {
    return false;
  }

  const typedScenes = scenes as Record<string, StudioScene>;
  const typedAssets = assets as Record<string, StudioAsset>;
  const typedJobs = jobs as Record<string, StudioJob>;
  if (cutsPresent) {
    if (!isRecord(value.cuts)) return false;
    const cuts = value.cuts;
    const activeCutId = value.activeCutId;
    if (activeCutId !== null) {
      if (!isSafeId(activeCutId) || !Object.hasOwn(cuts, activeCutId)) return false;
    }
    if (!validateCuts(cuts, projectId, typedScenes, typedAssets)) return false;
  }
  if (retryGraphHasCycle(typedJobs)) return false;
  const assetsHaveReverseLinks = Object.values(typedAssets).every(
    (asset) => asset.sceneId === null || typedScenes[asset.sceneId]?.assetIds.includes(asset.id)
  );
  const jobsHaveReverseLinks = Object.values(typedJobs).every((job) =>
    typedScenes[job.sceneId]?.jobIds.includes(job.id)
  );
  const retryLineageIsValid = Object.values(typedJobs).every((job) => {
    if (job.retryOfJobId === null) return true;
    const predecessor = typedJobs[job.retryOfJobId];
    const owningScene = typedScenes[job.sceneId];
    if (predecessor === undefined || owningScene === undefined || predecessor.sceneId !== job.sceneId) return false;
    const predecessorIndex = owningScene.jobIds.indexOf(predecessor.id);
    const retryIndex = owningScene.jobIds.indexOf(job.id);
    if (predecessorIndex < 0 || retryIndex < 0 || predecessorIndex >= retryIndex) return false;
    if (job.retryReason === 'submission_unknown') {
      return (
        (predecessor.status === 'needs_attention' || predecessor.status === 'failed') &&
        predecessor.error?.code === 'submission_unknown' &&
        job.duplicateChargeAcknowledged &&
        job.duplicateChargeAcknowledgedAt !== null
      );
    }
    return (
      job.retryReason === 'provider_failure' &&
      predecessor.status === 'failed' &&
      predecessor.error?.code !== 'submission_unknown' &&
      predecessor.error?.code !== 'download_failed' &&
      !job.duplicateChargeAcknowledged
    );
  });
  if (!assetsHaveReverseLinks || !jobsHaveReverseLinks || !retryLineageIsValid) return false;
  return sceneIds.every((sceneId) => {
    const scene = typedScenes[sceneId];
    const linkedAssetsAreValid = scene.assetIds.every(
      (assetId) => typedAssets[assetId]?.projectId === projectId && typedAssets[assetId]?.sceneId === sceneId
    );
    const linkedJobsAreValid = scene.jobIds.every(
      (jobId) => typedJobs[jobId]?.projectId === projectId && typedJobs[jobId]?.sceneId === sceneId
    );
    const selectedAssetIsValid =
      scene.selectedAssetId === null ||
      (typedAssets[scene.selectedAssetId]?.projectId === projectId &&
        typedAssets[scene.selectedAssetId]?.sceneId === sceneId);
    const referenceAssetIsValid =
      scene.referenceAssetId === null ||
      (typedAssets[scene.referenceAssetId]?.projectId === projectId &&
        typedAssets[scene.referenceAssetId]?.sceneId === sceneId);
    const jobOutputsAreValid = scene.jobIds.every((jobId) =>
      typedJobs[jobId].outputAssetIds.every(
        (assetId) => typedAssets[assetId]?.projectId === projectId && typedAssets[assetId]?.sceneId === sceneId
      )
    );
    return (
      linkedAssetsAreValid && linkedJobsAreValid && selectedAssetIsValid && referenceAssetIsValid && jobOutputsAreValid
    );
  });
};

const toSummary = (project: StudioProject): StudioProjectSummary => toStudioProjectSummary(project);

const compareSummaries = (left: StudioProjectSummary, right: StudioProjectSummary): number => {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const createProjectFromInput = (input: CreateStudioProjectInput, id: string, timestamp: string): StudioProject => ({
  schemaVersion: 1,
  revision: 1,
  id,
  name: input.name.trim(),
  brief: input.brief,
  rules: [],
  ruleListUndo: null,
  ...(input.forgeProjectId === undefined ? {} : { forgeProjectId: input.forgeProjectId }),
  briefConversationId: null,
  aspectRatio: input.aspectRatio,
  targetDurationSeconds: input.targetDurationSeconds,
  resolution: input.resolution,
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Creates an atomic, manifest-backed store for Creative Studio projects. */
export const createCreativeStudioStore = (deps: CreativeStudioStoreDeps): CreativeStudioStore => {
  const rootDir = path.resolve(deps.rootDir);
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? (() => crypto.randomUUID().replaceAll('-', '_'));
  const fs = deps.fs ?? nodeFs;
  const logError = deps.logError ?? ((message: string, error: unknown): void => console.error(message, error));
  const watchProposalTree =
    deps.watchProposalTree ??
    ((input: {
      rootDir: string;
      onChange: (relativeFile: string) => void;
      onError: (error: Error) => void;
    }): { close(): void } => {
      const watcher = watchFileSystem(input.rootDir, { recursive: true, encoding: 'utf8' }, (_eventType, fileName) => {
        if (fileName !== null) input.onChange(fileName);
      });
      watcher.on('error', input.onError);
      return { close: () => watcher.close() };
    });
  const queues = new Map<string, Promise<unknown>>();
  const proposalReapedAt = new Map<string, number>();
  let summaryQueue: Promise<unknown> = Promise.resolve();
  let connectionsQueue: Promise<unknown> = Promise.resolve();
  let sharedListingSweep:
    | { result: ProjectListingSweep; remainingConsumer: 'projects' | 'quarantinedProjectIds' }
    | undefined;

  const requireSafeId = (projectId: string): void => {
    if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
  };

  const isInsideRoot = (canonicalRoot: string, target: string): boolean =>
    target === canonicalRoot || target.startsWith(canonicalRoot + path.sep);

  const storageError = (error: unknown, fallback: string): CreativeStudioStoreError =>
    new CreativeStudioStoreError('storage_error', error instanceof Error ? error.message : fallback);

  const canonicalRoot = async (): Promise<string> => {
    try {
      await fs.mkdir(rootDir, { recursive: true });
      const stats = await fs.lstat(rootDir);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio root must be a directory');
      }
      return await fs.realpath(rootDir);
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio root is unavailable');
    }
  };

  const resolveRootChild = (root: string, child: string): string => {
    const resolved = path.resolve(root, child);
    if (!isInsideRoot(root, resolved)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage target escaped its root');
    }
    return resolved;
  };

  const assertRegularFileOrMissing = async (file: string): Promise<void> => {
    try {
      const stats = await fs.lstat(file);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage file is not a regular file');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return;
      throw storageError(error, 'Creative Studio storage file is unavailable');
    }
  };

  const projectDirectory = async (
    root: string,
    projectId: string,
    createIfMissing: boolean
  ): Promise<string | null> => {
    requireSafeId(projectId);
    const directory = resolveRootChild(root, projectId);
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT')
        throw storageError(error, 'Creative Studio project directory is unavailable');
      if (!createIfMissing) return null;
      try {
        await fs.mkdir(directory);
      } catch (mkdirError) {
        throw storageError(mkdirError, 'Creative Studio project directory could not be created');
      }
      const createdStats = await fs.lstat(directory);
      if (!createdStats.isDirectory() || createdStats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
    }

    try {
      const canonicalDirectory = await fs.realpath(directory);
      if (!isInsideRoot(root, canonicalDirectory) || canonicalDirectory === root) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory escaped its root');
      }
      return canonicalDirectory;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio project directory is unavailable');
    }
  };

  const projectFile = async (root: string, projectId: string, createDirectory: boolean): Promise<string | null> => {
    const directory = await projectDirectory(root, projectId, createDirectory);
    if (directory === null) return null;
    const file = resolveRootChild(directory, 'project.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const summariesFile = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'projects.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const connectionsFile = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'connections.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const safeNestedDirectory = async (
    root: string,
    parent: string,
    name: string,
    createIfMissing: boolean
  ): Promise<string | null> => {
    const directory = resolveRootChild(parent, name);
    if (!isInsideRoot(root, directory)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio queue directory escaped its root');
    }
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio queue directory is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Creative Studio queue directory is unavailable');
      }
      if (!createIfMissing) return null;
      try {
        await fs.mkdir(directory);
      } catch (mkdirError) {
        throw storageError(mkdirError, 'Creative Studio queue directory could not be created');
      }
    }
    try {
      const canonicalDirectory = await fs.realpath(directory);
      if (canonicalDirectory !== directory || !isInsideRoot(root, canonicalDirectory)) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio queue directory is unsafe');
      }
      return canonicalDirectory;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio queue directory is unavailable');
    }
  };

  const proposalDirectories = async (
    root: string,
    projectId: string,
    createIfMissing: boolean
  ): Promise<{ root: string; pending: string; decisions: string; slots: string } | null> => {
    const project = await projectDirectory(root, projectId, false);
    if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    const proposalRoot = await safeNestedDirectory(root, project, 'proposals', createIfMissing);
    if (proposalRoot === null) return null;
    const pending = await safeNestedDirectory(root, proposalRoot, 'pending', createIfMissing);
    const decisions = await safeNestedDirectory(root, proposalRoot, 'decisions', createIfMissing);
    if (pending === null || decisions === null) return null;
    const slots = await safeNestedDirectory(root, proposalRoot, 'slots', true);
    if (slots === null) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal slots are unavailable');
    }
    return { root: proposalRoot, pending, decisions, slots };
  };

  const referenceRequestDirectories = async (
    root: string,
    projectId: string,
    createIfMissing: boolean
  ): Promise<{ root: string; pending: string; slots: string } | null> => {
    const project = await projectDirectory(root, projectId, false);
    if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    const requestRoot = await safeNestedDirectory(root, project, 'reference-requests', createIfMissing);
    if (requestRoot === null) return null;
    const pending = await safeNestedDirectory(root, requestRoot, 'pending', createIfMissing);
    if (pending === null) return null;
    const slots = await safeNestedDirectory(root, requestRoot, 'slots', true);
    if (slots === null) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio reference request slots are unavailable');
    }
    return { root: requestRoot, pending, slots };
  };

  const readConnections = async (root: string): Promise<StudioConnectionBinding[]> => {
    const file = await connectionsFile(root);
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      if (
        !isRecord(parsed) ||
        Object.keys(parsed).length !== CONNECTION_MANIFEST_KEYS.size ||
        !Object.keys(parsed).every((key) => CONNECTION_MANIFEST_KEYS.has(key)) ||
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.connections)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio connection manifest');
      }
      const connections = parsed.connections.map(canonicalizeConnectionBinding);
      if (connections.some((connection) => connection === null)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio connection manifest');
      }
      return (connections as StudioConnectionBinding[]).toSorted((left, right) => left.id.localeCompare(right.id));
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio connection storage read failed'
      );
    }
  };

  const enqueueConnections = <T>(work: () => Promise<T>): Promise<T> => {
    const next = connectionsQueue.catch((): undefined => undefined).then(work);
    connectionsQueue = next.catch((): undefined => undefined);
    return next;
  };

  const writeJsonAtomic = async (root: string, file: string, value: unknown): Promise<void> => {
    const parent = path.dirname(file);
    if (!isInsideRoot(root, parent)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage target escaped its root');
    }
    const parentStats = await fs.lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (await fs.realpath(parent)) !== parent) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage parent is unsafe');
    }
    await assertRegularFileOrMissing(file);
    const temporaryFile = `${file}.${process.pid}.${++temporaryFileCounter}.tmp`;
    let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      temporaryHandle = await fs.open(temporaryFile, 'wx');
      await temporaryHandle.writeFile(JSON.stringify(value, null, 2), { encoding: 'utf8' });
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = undefined;
      await fs.rename(temporaryFile, file);
      const directoryHandle = await fs.open(parent, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await temporaryHandle?.close().catch((): undefined => undefined);
      await fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage write failed'
      );
    }
  };

  const writeJsonExclusiveAtomic = async (root: string, file: string, serialized: string): Promise<void> => {
    const parent = path.dirname(file);
    if (!isInsideRoot(root, parent)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal target escaped its root');
    }
    const parentStats = await fs.lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (await fs.realpath(parent)) !== parent) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal parent is unsafe');
    }
    const temporaryFile = `${file}.${process.pid}.${++temporaryFileCounter}.tmp`;
    let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      temporaryHandle = await fs.open(temporaryFile, 'wx');
      await temporaryHandle.writeFile(serialized, { encoding: 'utf8' });
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = undefined;
      await fs.link(temporaryFile, file);
      await fs.rm(temporaryFile);
      const directoryHandle = await fs.open(parent, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await temporaryHandle?.close().catch((): undefined => undefined);
      await fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
      if (isRecord(error) && error.code === 'EEXIST') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal already exists');
      }
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio proposal write failed'
      );
    }
  };

  const pendingRecordFileEntries = async (directory: string): Promise<import('node:fs').Dirent[]> => {
    try {
      return await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw storageError(error, 'Creative Studio proposal directory could not be read');
    }
  };

  const readBoundedPendingRecordJson = async (
    file: string,
    region: 'proposal' | 'reference request' = 'proposal'
  ): Promise<unknown> => {
    const stats = await fs.lstat(file);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > STUDIO_PROPOSAL_MAX_RECORD_BYTES) {
      throw new CreativeStudioStoreError('storage_error', `Creative Studio ${region} record is unsafe`);
    }
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  };

  const readProposalRecords = async (
    projectId: string,
    directories: { pending: string }
  ): Promise<StudioProposal[]> => {
    const entries = await pendingRecordFileEntries(directories.pending);
    const proposals: StudioProposal[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId)) continue;
      try {
        const value = await readBoundedPendingRecordJson(path.join(directories.pending, entry.name));
        if (validateProposalRecord(projectId, proposalId, value)) proposals.push(value);
        else logError('[CreativeStudio] Ignoring malformed proposal record', new Error('InvalidProposalRecord'));
      } catch (error) {
        logError('[CreativeStudio] Ignoring unreadable proposal record', error);
      }
    }
    return proposals;
  };

  const readReferenceRequestRecords = async (
    project: StudioProject,
    directories: { pending: string }
  ): Promise<StudioReferenceRequest[]> => {
    const entries = await pendingRecordFileEntries(directories.pending);
    const requests: StudioReferenceRequest[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId)) continue;
      try {
        // The bounded queue contains at most 50 records and logs each malformed entry independently.
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(
          path.join(directories.pending, entry.name),
          'reference request'
        );
        if (validateReferenceRequestRecord(project, requestId, value)) requests.push(value);
        else {
          logError(
            '[CreativeStudio] Ignoring malformed reference request record',
            new Error('InvalidReferenceRequestRecord')
          );
        }
      } catch (error) {
        logError('[CreativeStudio] Ignoring unreadable reference request record', error);
      }
    }
    return requests;
  };

  const readProposalDecisions = async (directories: {
    decisions: string;
  }): Promise<Map<string, StudioProposalDecision>> => {
    const entries = await pendingRecordFileEntries(directories.decisions);
    const decisions = new Map<string, StudioProposalDecision>();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId)) continue;
      try {
        const value = await readBoundedPendingRecordJson(path.join(directories.decisions, entry.name));
        if (validateProposalDecision(proposalId, value)) decisions.set(proposalId, value);
        else logError('[CreativeStudio] Ignoring malformed proposal decision', new Error('InvalidProposalDecision'));
      } catch (error) {
        logError('[CreativeStudio] Ignoring unreadable proposal decision', error);
      }
    }
    return decisions;
  };

  const effectiveProposal = (proposal: StudioProposal, decision: StudioProposalDecision | undefined): StudioProposal =>
    decision === undefined
      ? proposal
      : {
          ...proposal,
          status: decision.status,
          decidedAt: decision.decidedAt,
        };

  const reserveProposalSlot = async (slotsDirectory: string, proposalId: string): Promise<string> => {
    const reservation: StudioProposalSlot = {
      schemaVersion: 1,
      proposalId,
      reservedAt: now(),
    };
    for (let index = 0; index < STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT; index += 1) {
      const file = path.join(slotsDirectory, `${index}.slot`);
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      try {
        // Slot creation is the cross-process pending-capacity compare-and-set.
        // eslint-disable-next-line no-await-in-loop
        handle = await fs.open(file, 'wx');
        // eslint-disable-next-line no-await-in-loop
        await handle.writeFile(JSON.stringify(reservation), { encoding: 'utf8' });
        // eslint-disable-next-line no-await-in-loop
        await handle.sync();
        // eslint-disable-next-line no-await-in-loop
        await handle.close();
        handle = undefined;
        return file;
      } catch (error) {
        await handle?.close().catch((): undefined => undefined);
        if (isRecord(error) && error.code === 'EEXIST') continue;
        await fs.rm(file, { force: true }).catch((): undefined => undefined);
        throw storageError(error, 'Studio proposal capacity could not be reserved');
      }
    }
    throw new CreativeStudioStoreError('busy', 'Studio proposal inbox is full');
  };

  const releaseProposalSlotFile = async (file: string): Promise<void> => {
    await fs.rm(file, { force: true });
  };

  const cleanupPendingRecordSlots = async <Slot extends { reservedAt: string }>(
    directories: { slots: string },
    liveRecordIds: Set<string>,
    validateSlot: (value: unknown) => value is Slot,
    recordIdOf: (slot: Slot) => string,
    region: 'Proposal' | 'Reference request'
  ): Promise<void> => {
    const entries = await pendingRecordFileEntries(directories.slots);
    const retainedRecordIds = new Set<string>();
    const cutoff = Date.parse(now()) - STUDIO_PROPOSAL_STALE_SLOT_MS;
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.slot$/.test(entry.name)) continue;
      const file = path.join(directories.slots, entry.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(
          file,
          region === 'Proposal' ? 'proposal' : 'reference request'
        );
        const slot = validateSlot(value) ? value : undefined;
        const recordId = slot === undefined ? undefined : recordIdOf(slot);
        const retain = recordId !== undefined && liveRecordIds.has(recordId) && !retainedRecordIds.has(recordId);
        if (retain) {
          retainedRecordIds.add(recordId);
          continue;
        }
        const activeReservation =
          recordId !== undefined &&
          !liveRecordIds.has(recordId) &&
          slot !== undefined &&
          Date.parse(slot.reservedAt) > cutoff;
        if (activeReservation) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotFile(file);
      } catch (error) {
        logError(`[CreativeStudio] ${region} slot cleanup failed`, error);
      }
    }
  };

  const cleanupProposalSlots = async (directories: { slots: string }, proposals: StudioProposal[]): Promise<void> =>
    cleanupPendingRecordSlots(
      directories,
      new Set(proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => proposal.id)),
      validateProposalSlot,
      (slot) => slot.proposalId,
      'Proposal'
    );

  const cleanupReferenceRequestSlots = async (
    directories: { slots: string },
    requests: StudioReferenceRequest[]
  ): Promise<void> =>
    cleanupPendingRecordSlots(
      directories,
      new Set(requests.map((request) => request.id)),
      validateReferenceRequestSlot,
      (slot) => slot.requestId,
      'Reference request'
    );

  const releaseProposalSlot = async (directories: { slots: string }, proposalId: string): Promise<void> => {
    const entries = await pendingRecordFileEntries(directories.slots);
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.slot$/.test(entry.name)) continue;
      const file = path.join(directories.slots, entry.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(file);
        if (!validateProposalSlot(value) || value.proposalId !== proposalId) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotFile(file);
      } catch (error) {
        logError('[CreativeStudio] Proposal slot release failed', error);
      }
    }
  };

  const releaseReferenceRequestSlots = async (
    directories: { slots: string },
    requestIds: ReadonlySet<string>
  ): Promise<void> => {
    const entries = await pendingRecordFileEntries(directories.slots);
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.slot$/.test(entry.name)) continue;
      const file = path.join(directories.slots, entry.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(file);
        if (!validateReferenceRequestSlot(value) || !requestIds.has(value.requestId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotFile(file);
      } catch (error) {
        logError('[CreativeStudio] Reference request slot release failed', error);
      }
    }
  };

  const appendProposalDecision = async (
    root: string,
    decisionsDirectory: string,
    proposalId: string,
    status: StudioProposalDecision['status']
  ): Promise<StudioProposalDecision> => {
    const decision: StudioProposalDecision = {
      schemaVersion: 1,
      proposalId,
      status,
      decidedAt: now(),
    };
    await writeJsonExclusiveAtomic(root, path.join(decisionsDirectory, `${proposalId}.json`), JSON.stringify(decision));
    return decision;
  };

  const reapPendingProposals = async (
    root: string,
    directories: { pending: string; decisions: string; slots: string }
  ): Promise<void> => {
    const [proposals, decisions] = await Promise.all([
      readProposalRecords(path.basename(path.dirname(path.dirname(directories.pending))), directories),
      readProposalDecisions(directories),
    ]);
    const cutoff = Date.parse(now()) - STUDIO_PROPOSAL_PENDING_TTL_MS;
    for (const proposal of proposals) {
      if (decisions.has(proposal.id) || Date.parse(proposal.createdAt) > cutoff) continue;
      try {
        // A bounded project ledger has at most 50 live pending records.
        // eslint-disable-next-line no-await-in-loop
        const decision = await appendProposalDecision(root, directories.decisions, proposal.id, 'expired');
        decisions.set(proposal.id, decision);
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlot(directories, proposal.id);
      } catch (error) {
        if (!(error instanceof CreativeStudioStoreError) || error.code !== 'invalid_payload') throw error;
      }
    }
    await cleanupProposalSlots(
      directories,
      proposals.map((proposal) => effectiveProposal(proposal, decisions.get(proposal.id)))
    );
  };

  const reapPendingProposalsBeforeWrite = async (
    root: string,
    projectId: string,
    directories: { pending: string; decisions: string; slots: string }
  ): Promise<void> => {
    const currentTime = Date.parse(now());
    const lastReapedAt = proposalReapedAt.get(projectId);
    if (lastReapedAt !== undefined && currentTime - lastReapedAt < STUDIO_PROPOSAL_STALE_SLOT_MS) return;
    await reapPendingProposals(root, directories);
    proposalReapedAt.set(projectId, currentTime);
  };

  const reapPendingReferenceRequests = async (
    project: StudioProject,
    directories: { pending: string; slots: string }
  ): Promise<void> => {
    const requests = await readReferenceRequestRecords(project, directories);
    const cutoff = Date.parse(now()) - STUDIO_PROPOSAL_PENDING_TTL_MS;
    const retained: StudioReferenceRequest[] = [];
    for (const request of requests) {
      if (Date.parse(request.createdAt) > cutoff) {
        retained.push(request);
        continue;
      }
      try {
        // A bounded project ledger has at most 50 live pending records.
        // eslint-disable-next-line no-await-in-loop
        await fs.rm(path.join(directories.pending, `${request.id}.json`));
      } catch (error) {
        retained.push(request);
        logError('[CreativeStudio] Reference request expiry failed', error);
      }
    }
    await cleanupReferenceRequestSlots(directories, retained);
  };

  const listProjectProposals = async (
    root: string,
    projectId: string,
    directories: { pending: string; decisions: string; slots: string }
  ): Promise<StudioProposal[]> => {
    await reapPendingProposals(root, directories);
    const [proposals, decisions] = await Promise.all([
      readProposalRecords(projectId, directories),
      readProposalDecisions(directories),
    ]);
    const effective = proposals
      .map((proposal) => effectiveProposal(proposal, decisions.get(proposal.id)))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    await cleanupProposalSlots(directories, effective);
    return effective;
  };

  const readProject = async (root: string, projectId: string): Promise<StudioProject | null> => {
    try {
      const file = await projectFile(root, projectId, false);
      if (file === null) return null;
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      const migrated = migrateSchemaV1Project(raw);
      if (validateProject(migrated) && migrated.id === projectId) return migrated;
      throw new CreativeStudioStoreError('storage_error', 'Malformed Studio project manifest');
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage read failed'
      );
    }
  };

  const readAllProjects = async (
    root: string
  ): Promise<{ projects: StudioProject[]; quarantinedProjectIds: string[] }> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return { projects: [], quarantinedProjectIds: [] };
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage read failed'
      );
    }
    const unsafeProjectEntry = entries.find((entry) => isSafeId(entry.name) && entry.isSymbolicLink());
    if (unsafeProjectEntry !== undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
    }
    const projectEntries = entries
      .filter((entry) => entry.isDirectory() && isSafeId(entry.name))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    const settledProjects = await Promise.allSettled(projectEntries.map((entry) => readProject(root, entry.name)));
    const projects: StudioProject[] = [];
    const quarantinedProjectIds: string[] = [];
    settledProjects.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value !== null) projects.push(result.value);
        return;
      }
      const projectId = projectEntries[index].name;
      quarantinedProjectIds.push(projectId);
      logError(`[CreativeStudio] Quarantined corrupt project manifest: ${projectId}`, result.reason);
    });
    return { projects, quarantinedProjectIds };
  };

  const repairSummaryIndex = (): Promise<ProjectListingSweep> => {
    const rebuild = async (): Promise<ProjectListingSweep> => {
      const root = await canonicalRoot();
      const indexFile = await summariesFile(root);
      const { projects, quarantinedProjectIds } = await readAllProjects(root);
      const summaries = projects.map(toSummary).toSorted(compareSummaries);
      let existing: unknown = null;
      try {
        existing = JSON.parse(await fs.readFile(indexFile, 'utf8')) as unknown;
      } catch {
        // A missing or malformed summary is repaired from the per-project source of truth below.
      }
      const next = { schemaVersion: 1, projects: summaries };
      if (!sameJson(existing, next)) await writeJsonAtomic(root, indexFile, next);
      return { projects: summaries, quarantinedProjectIds };
    };
    const next = summaryQueue.catch((): undefined => undefined).then(() => rebuild());
    summaryQueue = next.catch((): undefined => undefined);
    return next;
  };

  const enqueue = <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(projectId) ?? Promise.resolve();
    const next = previous.catch((): undefined => undefined).then(() => work());
    queues.set(projectId, next);
    void next
      .finally(() => {
        if (queues.get(projectId) === next) queues.delete(projectId);
      })
      .catch((): undefined => undefined);
    return next;
  };

  const updateProjectInsideQueue = async (
    root: string,
    projectId: string,
    update: (project: StudioProject) => StudioProject,
    expectedRevision?: number
  ): Promise<StudioProject> => {
    await summariesFile(root);
    const current = await readProject(root, projectId);
    if (current === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const updated = update(structuredClone(current));
    if (!isRecord(updated) || updated.id !== current.id || updated.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    const next: StudioProject = {
      ...updated,
      schemaVersion: 1,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    if (!validateProject(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project payload');
    }
    const file = await projectFile(root, projectId, false);
    if (file === null) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio project storage is unavailable');
    }
    await writeJsonAtomic(root, file, next);
    await repairSummaryIndex();
    return next;
  };

  const listProposalsThroughQueue = (projectId: string): Promise<StudioProposal[]> =>
    enqueue(projectId, async (): Promise<StudioProposal[]> => {
      const root = await canonicalRoot();
      const project = await readProject(root, projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const directories = await proposalDirectories(root, projectId, false);
      return directories === null ? [] : listProjectProposals(root, projectId, directories);
    });

  const listReferenceRequestsThroughQueue = (projectId: string): Promise<StudioReferenceRequest[]> =>
    enqueue(projectId, async (): Promise<StudioReferenceRequest[]> => {
      const root = await canonicalRoot();
      const project = await readProject(root, projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const directories = await referenceRequestDirectories(root, projectId, false);
      if (directories === null) return [];
      return (await readReferenceRequestRecords(project, directories)).toSorted(
        (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
    });

  return {
    async listProjects(): Promise<StudioProjectSummary[]> {
      if (sharedListingSweep?.remainingConsumer === 'projects') {
        const { result } = sharedListingSweep;
        sharedListingSweep = undefined;
        return result.projects;
      }
      const result = await repairSummaryIndex();
      sharedListingSweep = { result, remainingConsumer: 'quarantinedProjectIds' };
      return result.projects;
    },

    async listQuarantinedProjectIds(): Promise<string[]> {
      if (sharedListingSweep?.remainingConsumer === 'quarantinedProjectIds') {
        const { result } = sharedListingSweep;
        sharedListingSweep = undefined;
        return result.quarantinedProjectIds;
      }
      const result = await repairSummaryIndex();
      sharedListingSweep = { result, remainingConsumer: 'projects' };
      return result.quarantinedProjectIds;
    },

    async createProject(input: CreateStudioProjectInput): Promise<StudioProject> {
      if (Object.hasOwn(input, 'id')) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project ids are generated by the store');
      }
      const projectId = createId();
      if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      sharedListingSweep = undefined;
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        await summariesFile(root);
        const candidate = createProjectFromInput(input, projectId, now());
        if (!validateProject(candidate))
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project payload');
        if (await readProject(root, projectId))
          throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
        const file = await projectFile(root, projectId, true);
        if (file === null)
          throw new CreativeStudioStoreError('storage_error', 'Creative Studio project storage is unavailable');
        await writeJsonAtomic(root, file, candidate);
        await repairSummaryIndex();
        return candidate;
      });
    },

    async getProject(projectId: string): Promise<StudioProject | null> {
      if (!isSafeId(projectId)) return null;
      return readProject(await canonicalRoot(), projectId);
    },

    async getVerifiedProjectDirectory(projectId: string): Promise<string | null> {
      if (!isSafeId(projectId)) return null;
      return projectDirectory(await canonicalRoot(), projectId, false);
    },

    async resolveProposalPaths(
      projectId: string
    ): Promise<{ projectDir: string; pendingDir: string; referencePendingDir: string }> {
      if (!isSafeId(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        const project = await projectDirectory(root, projectId, false);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const directories = await proposalDirectories(root, projectId, true);
        const referenceDirectories = await referenceRequestDirectories(root, projectId, true);
        if (directories === null || referenceDirectories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal storage is unavailable');
        }
        return {
          projectDir: project,
          pendingDir: directories.pending,
          referencePendingDir: referenceDirectories.pending,
        };
      });
    },

    async recordProposal(input: StudioRecordProposalInput): Promise<StudioProposal> {
      if (!isSafeId(input.projectId) || !isSafeProposalId(input.proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      if (!isIntegerInRange(input.baseRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal revision');
      }
      return enqueue(input.projectId, async () => {
        const root = await canonicalRoot();
        const project = await readProject(root, input.projectId);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const candidate: StudioProposal = {
          schemaVersion: 1,
          id: input.proposalId,
          projectId: input.projectId,
          status: 'pending',
          baseRevision: input.baseRevision,
          payload: structuredClone(input.payload),
          createdAt: now(),
          decidedAt: null,
        };
        if (!validateProposalRecord(input.projectId, input.proposalId, candidate)) {
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal record');
        }
        const serialized = JSON.stringify(candidate);
        if (Buffer.byteLength(serialized, 'utf8') > STUDIO_PROPOSAL_MAX_RECORD_BYTES) {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal record is too large');
        }
        const directories = await proposalDirectories(root, input.projectId, true);
        if (directories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal storage is unavailable');
        }
        await reapPendingProposalsBeforeWrite(root, input.projectId, directories);
        const slot = await reserveProposalSlot(directories.slots, input.proposalId);
        try {
          await writeJsonExclusiveAtomic(root, path.join(directories.pending, `${input.proposalId}.json`), serialized);
        } catch (error) {
          await releaseProposalSlotFile(slot).catch((): undefined => undefined);
          throw error;
        }
        return candidate;
      });
    },

    async listProposals(projectId: string): Promise<StudioProposal[]> {
      if (!isSafeId(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      return listProposalsThroughQueue(projectId);
    },

    async listPendingReferenceRequests(projectId: string): Promise<StudioReferenceRequest[]> {
      if (!isSafeId(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      return listReferenceRequestsThroughQueue(projectId);
    },

    async dismissReferenceRequests(projectId: string, requestIds: string[]): Promise<void> {
      if (
        !isSafeId(projectId) ||
        requestIds.length === 0 ||
        requestIds.length > STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT ||
        new Set(requestIds).size !== requestIds.length ||
        requestIds.some((requestId) => !isSafeProposalId(requestId))
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request identities');
      }
      await enqueue(projectId, async (): Promise<void> => {
        const root = await canonicalRoot();
        const project = await readProject(root, projectId);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const directories = await referenceRequestDirectories(root, projectId, false);
        if (directories === null) return;
        const requests = await readReferenceRequestRecords(project, directories);
        const requestedIds = new Set(requestIds);
        const dismissibleIds = new Set(
          requests.filter((request) => requestedIds.has(request.id)).map((request) => request.id)
        );
        for (const requestId of dismissibleIds) {
          try {
            // The bounded queue contains at most 50 records.
            // eslint-disable-next-line no-await-in-loop
            await fs.rm(path.join(directories.pending, `${requestId}.json`));
          } catch (error) {
            if (!isRecord(error) || error.code !== 'ENOENT') {
              throw storageError(error, 'Creative Studio reference request could not be dismissed');
            }
          }
        }
        await releaseReferenceRequestSlots(directories, dismissibleIds);
        await cleanupReferenceRequestSlots(
          directories,
          requests.filter((request) => !dismissibleIds.has(request.id))
        );
      });
    },

    async rejectProposal(projectId: string, proposalId: string): Promise<StudioProposal> {
      if (!isSafeId(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        const project = await readProject(root, projectId);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const directories = await proposalDirectories(root, projectId, false);
        if (directories === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        const proposal = (await listProjectProposals(root, projectId, directories)).find(
          (candidate) => candidate.id === proposalId
        );
        if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        if (proposal.status === 'rejected') return proposal;
        if (proposal.status !== 'pending') {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
        }
        const decision = await appendProposalDecision(root, directories.decisions, proposalId, 'rejected');
        await releaseProposalSlot(directories, proposalId);
        return effectiveProposal(proposal, decision);
      });
    },

    async reapAbandonedProposals(): Promise<void> {
      const root = await canonicalRoot();
      const { projects } = await readAllProjects(root);
      await Promise.all(
        projects.map((project) =>
          enqueue(project.id, async () => {
            const [directories, referenceDirectories] = await Promise.all([
              proposalDirectories(root, project.id, false),
              referenceRequestDirectories(root, project.id, false),
            ]);
            if (directories !== null) {
              await reapPendingProposals(root, directories);
              proposalReapedAt.set(project.id, Date.parse(now()));
            }
            if (referenceDirectories !== null) {
              await reapPendingReferenceRequests(project, referenceDirectories);
            }
          })
        )
      );
    },

    async watchProposals(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>> {
      const root = await canonicalRoot();
      let closed = false;
      const observedStatuses = new Map<string, StudioProposal['status'] | StudioReferenceRequest['status']>();
      const validateAndNotify = async (relativeFile: string): Promise<void> => {
        const segments = path.normalize(relativeFile).split(path.sep);
        const isProposalChange =
          segments[1] === 'proposals' && (segments[2] === 'pending' || segments[2] === 'decisions');
        const isReferenceRequestChange = segments[1] === 'reference-requests' && segments[2] === 'pending';
        if (
          segments.length !== 4 ||
          !isSafeId(segments[0]) ||
          (!isProposalChange && !isReferenceRequestChange) ||
          !segments[3].endsWith('.json')
        ) {
          return;
        }
        const projectId = segments[0];
        const recordId = segments[3].slice(0, -'.json'.length);
        if (!isSafeProposalId(recordId)) return;
        try {
          const record = isProposalChange
            ? (await listProposalsThroughQueue(projectId)).find((candidate) => candidate.id === recordId)
            : (await listReferenceRequestsThroughQueue(projectId)).find((candidate) => candidate.id === recordId);
          if (closed || record === undefined) return;
          const key = `${projectId}:${recordId}`;
          if (observedStatuses.get(key) === record.status) return;
          observedStatuses.set(key, record.status);
          listener(projectId, recordId);
        } catch (error) {
          if (!closed) logError('[CreativeStudio] Proposal watcher ignored an invalid record', error);
        }
      };
      let watcher: { close(): void };
      try {
        watcher = watchProposalTree({
          rootDir: root,
          onChange: (relativeFile) => {
            if (!closed) void validateAndNotify(relativeFile);
          },
          onError: (error) => {
            if (!closed) logError('[CreativeStudio] Proposal watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Creative Studio proposal watcher could not start');
      }
      return async () => {
        if (closed) return;
        closed = true;
        watcher.close();
      };
    },

    async acceptProposal(
      projectId: string,
      proposalId: string,
      update: (project: StudioProject, payload: StudioProposalPayload) => StudioProject
    ): Promise<{ proposal: StudioProposal; project: StudioProject; applied: boolean }> {
      if (!isSafeId(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        const current = await readProject(root, projectId);
        if (current === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const directories = await proposalDirectories(root, projectId, false);
        if (directories === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        const proposal = (await listProjectProposals(root, projectId, directories)).find(
          (candidate) => candidate.id === proposalId
        );
        if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        if (proposal.status === 'accepted') return { proposal, project: current, applied: false };
        if (proposal.status !== 'pending') {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
        }
        const project = await updateProjectInsideQueue(
          root,
          projectId,
          (candidate) => update(candidate, structuredClone(proposal.payload)),
          proposal.baseRevision
        );
        const decision = await appendProposalDecision(root, directories.decisions, proposalId, 'accepted');
        await releaseProposalSlot(directories, proposalId);
        return { proposal: effectiveProposal(proposal, decision), project, applied: true };
      });
    },

    async updateProject(
      projectId: string,
      update: (project: StudioProject) => StudioProject,
      expectedRevision?: number
    ): Promise<StudioProject> {
      if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      sharedListingSweep = undefined;
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        return updateProjectInsideQueue(root, projectId, update, expectedRevision);
      });
    },

    async deleteProject(projectId: string, expectedRevision: number): Promise<boolean> {
      if (!isSafeId(projectId)) return false;
      if (!isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      sharedListingSweep = undefined;
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        await summariesFile(root);
        const current = await readProject(root, projectId);
        if (current === null) return false;
        if (Object.values(current.jobs).some((job) => NONTERMINAL_JOB_STATUSES.has(job.status))) {
          throw new CreativeStudioStoreError('busy', 'Studio project has active generation jobs');
        }
        if (current.revision !== expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        try {
          const targetDir = await projectDirectory(root, projectId, false);
          if (targetDir === null) return false;
          await fs.rm(targetDir, { recursive: true, force: false });
        } catch (error) {
          throw new CreativeStudioStoreError(
            'storage_error',
            error instanceof Error ? error.message : 'Studio project deletion failed'
          );
        }
        await repairSummaryIndex();
        return true;
      });
    },

    async listConnections(): Promise<StudioConnectionBinding[]> {
      return readConnections(await canonicalRoot());
    },

    async saveConnection(binding: StudioConnectionBinding): Promise<StudioConnectionBinding> {
      const canonicalBinding = canonicalizeConnectionBinding(binding);
      if (canonicalBinding === null) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio connection binding');
      }
      return enqueueConnections(async () => {
        const root = await canonicalRoot();
        const current = await readConnections(root);
        const next = [
          ...current.filter(
            (connection) =>
              connection.id !== canonicalBinding.id &&
              !(
                connection.providerId === canonicalBinding.providerId &&
                connection.adapterId === canonicalBinding.adapterId &&
                connection.model === canonicalBinding.model
              )
          ),
          structuredClone(canonicalBinding),
        ].toSorted((left, right) => left.id.localeCompare(right.id));
        await writeJsonAtomic(root, await connectionsFile(root), { schemaVersion: 1, connections: next });
        return structuredClone(canonicalBinding);
      });
    },

    async removeConnection(connectionId: string): Promise<boolean> {
      if (!isSafeConnectionId(connectionId)) return false;
      return enqueueConnections(async () => {
        const root = await canonicalRoot();
        const current = await readConnections(root);
        const next = current.filter((connection) => connection.id !== connectionId);
        if (next.length === current.length) return false;
        await writeJsonAtomic(root, await connectionsFile(root), { schemaVersion: 1, connections: next });
        return true;
      });
    },
  };
};
