/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import { watch as watchFileSystem } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  isUnsupportedStudioPrototypeSchemaVersion,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES,
  STUDIO_PROPOSAL_V2_PENDING_TTL_MS,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  type CreateStudioProjectInputV2,
  type StudioCancellationPolicy,
  type StudioConnectionBinding,
  type StudioMutationBatchV2,
  type StudioMutationReducerContextV2,
  type StudioProjectListResultV2,
  type StudioProjectSummaryV2,
  type StudioProjectV2,
  type StudioProposalCommitAttributionV2,
  type StudioProposalDecisionV2,
  type StudioProposalRecordV2,
  type StudioRecordProposalInputV2,
  type StudioProposalSlotV2,
  type StudioProposalV2,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestSlotV2,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import { StudioProposalWriteError, writeProposalRecordV2 } from '@process/resources/builtinMcp/studioProposalWriter';
import { toStudioProjectSummaryV2 } from '@/common/types/project/creativeStudioProjectSummary';
import {
  canonicalizeRecordRoot,
  readBoundedRegularFileWithIdentity,
  resolveCompleteDirectorySet,
  resolveConfinedRecordPath,
} from '../service/recordIo';
import {
  parseStudioProposalDecisionV2,
  parseStudioProposalRecordV2,
  parseStudioProposalSlotV2,
  parseStudioReferenceGenerationHandoffReceiptV2,
  parseStudioReferenceRequestDecisionV2,
  parseStudioReferenceRequestSlotV2,
  parseStudioReferenceRequestV2,
} from '../service/directorCommandContracts';
import {
  applyStudioMutationBatchV2,
  createEmptyStudioProjectV2,
  validateStudioProjectV2,
  type StudioMutationApplyResultV2,
} from '../service/schema2';
import { studioProposalOperationsV2 } from '../service/schema2/mutations/proposalReview';
import {
  decodeStudioProjectManifestV2,
  STUDIO_BRIEF_FILE_MAX_BYTES,
  STUDIO_BRIEF_FILE_NAME,
} from '../service/briefFile';
import {
  CreativeStudioStoreError,
  StudioProjectConfirmationError,
  type CreativeStudioStore,
  type CreativeStudioStoreDeps,
  type StudioDecideReferenceRequestInputV2,
  type StudioDeepReadonly,
  type StudioPaidRecoveryProposalConfirmationInputV2,
  type StudioProjectAuthoritySnapshotV2,
  type StudioProjectCommitFacts,
  type StudioProjectConfirmationInputV2,
  type StudioProjectConfirmationResultV2,
  type StudioProjectDeletionAuthoritySnapshotV2,
  type StudioProjectInventoryV2,
  type StudioProjectStoreLoadResultV2,
  type StudioProposalAcceptanceResultV2,
  type StudioReadonlyProjectV2,
  type StudioRecordReferenceGenerationHandoffReceiptInputV2,
  type StudioReferenceDecisionIntentV2,
  type StudioReferenceGenerationHandoffConfirmationInputV2,
  type StudioReferenceGenerationHandoffStoreV2,
  type StudioReferenceRequestLedgerEntryV2,
} from './contracts';
import { hasTopLevelPriorProjectSchemaVersion } from './projectRecords';
import { createStudioDeletionAuthorityV2 } from './deletionAuthority';
import {
  createStudioProjectTransactionsV2,
  type StudioDirectoryAuthorityV2 as DirectoryAuthorityV2,
  type StudioFileIdentityV2 as FileIdentityV2,
  type StudioProjectFileInspectionV2 as ProjectFileInspectionV2,
} from './projectTransactions';

export * from './contracts';

type StudioReferenceGenerationDecisionV2 = StudioReferenceRequestDecisionV2 & {
  outcome: Extract<StudioReferenceRequestDecisionV2['outcome'], { kind: 'generation_gate' }>;
};

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const STUDIO_PROJECT_V2_MAX_ID_LENGTH = 256;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const CANCELLATION_POLICIES = new Set<StudioCancellationPolicy>(['none', 'queued_only', 'queued_and_running']);
const ADAPTER_IDS = new Set([
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
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
  'supportedDurationSeconds',
  'supportsFirstFrame',
  'maxConditioningImages',
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
const PROPOSAL_COMMIT_ATTRIBUTION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'proposalId',
  'projectId',
  'baseRevision',
  'appliedRevision',
  'beforeProjectSha256',
  'afterProjectSha256',
  'createdBeatIds',
  'createdShotIds',
  'authorizationId',
  'decidedAt',
]);
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const PROPOSAL_V2_DIRECTORY_NAMES = ['pending', 'decisions', 'slots', 'commits'] as const;
const PROPOSAL_V2_COMMIT_FILE_SUFFIX = '.json';
const IDENTITY_BOUND_CLEANUP_PATTERN = /^(.*)\.(0|[1-9]\d*)_(0|[1-9]\d*)_([a-f0-9]{64})\.cleanup$/;
const REFERENCE_REQUEST_V2_DIRECTORY_NAMES = ['pending', 'decisions', 'slots', 'receipts'] as const;
const REFERENCE_DECIDE_INPUT_KEYS = new Set(['projectId', 'requestId', 'expectedRevision', 'outcome']);
const REFERENCE_REJECTED_INTENT_KEYS = new Set(['kind']);
const REFERENCE_RECEIPT_INPUT_KEYS = new Set(['projectId', 'handoffId', 'expectedRevision', 'result']);
const REFERENCE_DISMISSED_RESULT_KEYS = new Set(['kind']);
const REFERENCE_CONFIRMED_RESULT_KEYS = new Set(['kind', 'authorizationId']);

export const STUDIO_PROPOSAL_MAX_RECORD_BYTES = STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES;
export const STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT = STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT;
export const STUDIO_PROPOSAL_PENDING_TTL_MS = STUDIO_PROPOSAL_V2_PENDING_TTL_MS;
export const STUDIO_PROJECT_V2_MAX_RECORD_BYTES = 64 * 1024 * 1024;
const STUDIO_PROPOSAL_STALE_SLOT_MS = 60 * 1_000;

const isCanonicalV2SlotFileName = (value: string, capacity: number): boolean => {
  const match = /^(0|[1-9]\d*)\.slot$/.exec(value);
  if (match?.[1] === undefined) return false;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 && index < capacity;
};

type ProjectListingSweepV2 = {
  supportedProjectIds: string[];
  projectRevisions: { projectId: string; revision: number }[];
  summaries: StudioProjectSummaryV2[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

type JsonRecord = Record<string, unknown>;

type ProposalDirectoriesV2 = {
  root: DirectoryAuthorityV2;
  pending: DirectoryAuthorityV2;
  decisions: DirectoryAuthorityV2;
  slots: DirectoryAuthorityV2;
  commits: DirectoryAuthorityV2;
  project: DirectoryAuthorityV2;
};

type IdentifiedRecordV2<RecordType> = {
  file: string;
  bytes: string;
  identity: FileIdentityV2;
  record: RecordType;
  quarantined: boolean;
};

type ProposalLedgerV2 = {
  directories: ProposalDirectoriesV2;
  proposals: Map<string, IdentifiedRecordV2<StudioProposalRecordV2>>;
  decisions: Map<string, IdentifiedRecordV2<StudioProposalDecisionV2>>;
  slots: Map<string, IdentifiedRecordV2<StudioProposalSlotV2>[]>;
  attributions: IdentifiedRecordV2<StudioProposalCommitAttributionV2>[];
  journalResidues: Array<
    | {
        family: 'decisions';
        identified: IdentifiedRecordV2<StudioProposalDecisionV2>;
        namedFile: string;
        effective: boolean;
      }
    | {
        family: 'commits';
        identified: IdentifiedRecordV2<StudioProposalCommitAttributionV2>;
        namedFile: string;
        effective: boolean;
      }
  >;
  writerResidues: Array<{
    family: 'pending' | 'slots';
    identified: IdentifiedRecordV2<null>;
    namedFile: string;
    phase: 'tmp' | 'ready' | 'cleanup';
    effective: boolean;
  }>;
};

type ReferenceRequestDirectoriesV2 = {
  root: DirectoryAuthorityV2;
  pending: DirectoryAuthorityV2;
  decisions: DirectoryAuthorityV2;
  slots: DirectoryAuthorityV2;
  receipts: DirectoryAuthorityV2;
  project: DirectoryAuthorityV2;
};

type ReferenceRequestLedgerV2 = {
  directories: ReferenceRequestDirectoriesV2;
  requests: Map<string, IdentifiedRecordV2<StudioReferenceRequestV2>>;
  decisions: Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>;
  slots: Map<string, IdentifiedRecordV2<StudioReferenceRequestSlotV2>[]>;
  receipts: Map<string, IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>>;
  generationDecisions: Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>;
  journalResidues: Array<
    | {
        family: 'decisions';
        identified: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
        namedFile: string;
        effective: boolean;
      }
    | {
        family: 'receipts';
        identified: IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>;
        namedFile: string;
        effective: boolean;
      }
  >;
  writerResidues: Array<{
    family: 'pending' | 'slots';
    identified: IdentifiedRecordV2<null>;
    namedFile: string;
    phase: 'tmp' | 'ready' | 'cleanup';
    effective: boolean;
  }>;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
const isSafeIdV2 = (value: unknown): value is string =>
  isSafeId(value) && value.length <= STUDIO_PROJECT_V2_MAX_ID_LENGTH;
const isSafeProposalId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);
const isSafeConnectionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isString = (value: unknown): value is string => typeof value === 'string';

const isSafeConnectionModel = (value: unknown): value is string => {
  if (!isString(value) || value.length === 0 || value.length > 256 || value !== value.trim()) return false;
  return !value.split('').some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
};

const isCanonicalIsoTimestamp = (value: unknown): value is string => {
  if (!isString(value) || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isStudioMutationReducerContextV2 = (value: unknown): value is StudioMutationReducerContextV2 => {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === 2 &&
    keys.every((key) => key === 'mutationId' || key === 'capturedAt') &&
    isSafeIdV2(value.mutationId) &&
    isCanonicalIsoTimestamp(value.capturedAt)
  );
};

const cloneConfirmationValue = <T>(value: T, label: string): T => {
  try {
    return structuredClone(value);
  } catch {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must be structured-cloneable`);
  }
};

const deepFreezeConfirmationValue = <T>(value: T, label: string): StudioDeepReadonly<T> => {
  const pending: object[] = [];
  const seen = new WeakSet<object>();
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') pending.push(value as object);

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const isArray = Array.isArray(current);
    const prototype = Reflect.getPrototypeOf(current);
    if (
      (!isArray && prototype !== Object.prototype && prototype !== null) ||
      (isArray && prototype !== Array.prototype)
    ) {
      throw new CreativeStudioStoreError('invalid_payload', `${label} must contain only plain data`);
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw new CreativeStudioStoreError('invalid_payload', `${label} must contain only data properties`);
      }
      const child = descriptor.value as unknown;
      if ((typeof child === 'object' && child !== null) || typeof child === 'function') pending.push(child as object);
    }
    Object.freeze(current);
  }

  return value as StudioDeepReadonly<T>;
};

const cloneAndFreezeConfirmationValue = <T>(value: T, label: string): StudioDeepReadonly<T> =>
  deepFreezeConfirmationValue(cloneConfirmationValue(value, label), label);

const assertSynchronousConfirmationResult = (value: unknown, label: string): void => {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
  let then: unknown;
  try {
    then = Reflect.get(value, 'then');
  } catch {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must return synchronously`);
  }
  if (typeof then === 'function') {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must return synchronously`);
  }
};

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.size &&
    ownKeys.every((key) =>
      typeof key === 'string'
        ? keys.has(key) && Object.hasOwn(Reflect.getOwnPropertyDescriptor(value, key) ?? {}, 'value')
        : false
    )
  );
};

const isUniqueSafeIdArrayV2 = (value: unknown, maximum: number): value is string[] =>
  Array.isArray(value) && value.length <= maximum && value.every(isSafeIdV2) && new Set(value).size === value.length;

const validateProposalCommitAttributionV2 = (
  projectId: string,
  proposalId: string,
  value: unknown
): value is StudioProposalCommitAttributionV2 =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_COMMIT_ATTRIBUTION_KEYS) &&
  value.schemaVersion === STUDIO_PROPOSAL_SCHEMA_VERSION_V2 &&
  (value.kind === 'mutation' || value.kind === 'paid_recovery') &&
  value.proposalId === proposalId &&
  value.projectId === projectId &&
  isSafeProposalId(value.proposalId) &&
  isSafeIdV2(value.projectId) &&
  isIntegerInRange(value.baseRevision, 1, Number.MAX_SAFE_INTEGER - 1) &&
  value.appliedRevision === value.baseRevision + 1 &&
  typeof value.beforeProjectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.beforeProjectSha256) &&
  typeof value.afterProjectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.afterProjectSha256) &&
  isUniqueSafeIdArrayV2(value.createdBeatIds, STUDIO_MAX_BEATS) &&
  isUniqueSafeIdArrayV2(value.createdShotIds, STUDIO_MAX_SHOTS_PER_PROJECT) &&
  (value.kind === 'mutation'
    ? value.authorizationId === null
    : isSafeProposalId(value.authorizationId) &&
      value.createdBeatIds.length === 0 &&
      value.createdShotIds.length === 0) &&
  isCanonicalIsoTimestamp(value.decidedAt);

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const identityBoundCleanupNameV2 = (identified: IdentifiedRecordV2<unknown>): string =>
  `${identified.file}.${identified.identity.dev}_${identified.identity.ino}_${sha256Utf8(identified.bytes)}.cleanup`;

const parseIdentityBoundCleanupNameV2 = (
  name: string
): { namedFileName: string; identity: FileIdentityV2; digest: string } | null => {
  const match = IDENTITY_BOUND_CLEANUP_PATTERN.exec(name);
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return null;
  }
  const dev = Number(match[2]);
  const ino = Number(match[3]);
  if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino)) return null;
  return { namedFileName: match[1], identity: { dev, ino }, digest: match[4] };
};

const serializeJsonExact = (value: unknown): string => JSON.stringify(value, null, 2);

const validateConnectionBinding = (value: unknown, allowLegacyOpenRouter = false): value is StudioConnectionBinding => {
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
      (capabilities.audioModes[0] === 'none' ||
        (value.adapterId === 'openrouter-video-v1' && capabilities.audioModes[0] === 'audio')));
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
  const supportedDurationSeconds = capabilities.supportedDurationSeconds;
  const optionalSupportedDurations =
    supportedDurationSeconds === undefined ||
    (Array.isArray(supportedDurationSeconds) &&
      supportedDurationSeconds.length > 0 &&
      supportedDurationSeconds.length <= 12 &&
      supportedDurationSeconds.every(
        (duration, index) =>
          isIntegerInRange(duration, 4, 15) &&
          (index === 0 || (supportedDurationSeconds[index - 1] as number) < duration)
      ));
  const supportedDurationEndpointsMatch =
    supportedDurationSeconds === undefined ||
    (Array.isArray(supportedDurationSeconds) &&
      capabilities.minDurationSeconds === supportedDurationSeconds[0] &&
      capabilities.maxDurationSeconds === supportedDurationSeconds.at(-1));
  const validAdapterCapabilities =
    value.adapterId === 'weprompt-image-v1'
      ? Array.isArray(mediaKinds) &&
        mediaKinds.length === 1 &&
        mediaKinds[0] === 'image' &&
        capabilities.audioModes === undefined
      : value.adapterId === 'openrouter-video-v1'
        ? Array.isArray(mediaKinds) &&
          mediaKinds.length === 1 &&
          mediaKinds[0] === 'video' &&
          Array.isArray(capabilities.audioModes) &&
          capabilities.audioModes.length === 1 &&
          (capabilities.audioModes[0] === 'none' || capabilities.audioModes[0] === 'audio') &&
          Array.isArray(capabilities.aspectRatios) &&
          capabilities.aspectRatios.length > 0 &&
          Array.isArray(capabilities.resolutions) &&
          capabilities.resolutions.length > 0 &&
          (allowLegacyOpenRouter ||
            (Array.isArray(capabilities.supportedDurationSeconds) &&
              capabilities.supportedDurationSeconds.length > 0)) &&
          capabilities.maxConditioningImages === 0 &&
          capabilities.cancellationPolicy === 'none'
        : (value.adapterId === 'byteplus-seedance-v1' || value.adapterId === 'weprompt-media-gateway-v1') &&
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
    (capabilities.maxConditioningImages === undefined || isIntegerInRange(capabilities.maxConditioningImages, 0, 6)) &&
    isString(capabilities.cancellationPolicy) &&
    CANCELLATION_POLICIES.has(capabilities.cancellationPolicy as StudioCancellationPolicy) &&
    (capabilities.minDurationSeconds === undefined || isIntegerInRange(capabilities.minDurationSeconds, 1, 60)) &&
    (capabilities.maxDurationSeconds === undefined || isIntegerInRange(capabilities.maxDurationSeconds, 1, 60)) &&
    optionalSupportedDurations &&
    (capabilities.minDurationSeconds === undefined ||
      capabilities.maxDurationSeconds === undefined ||
      (capabilities.minDurationSeconds as number) <= (capabilities.maxDurationSeconds as number)) &&
    supportedDurationEndpointsMatch &&
    isCanonicalIsoTimestamp(value.validatedAt) &&
    !containsForbiddenConnectionField(value)
  );
};

const canonicalizeConnectionBinding = (
  value: unknown,
  allowLegacyOpenRouter = false
): StudioConnectionBinding | null => {
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
  return validateConnectionBinding(candidate, allowLegacyOpenRouter) ? candidate : null;
};

const compareSummariesV2 = (left: StudioProjectSummaryV2, right: StudioProjectSummaryV2): number => {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Creates an atomic, manifest-backed store for Creative Studio projects. */
export const createCreativeStudioStore = (deps: CreativeStudioStoreDeps): CreativeStudioStore => {
  const rootDir = path.resolve(deps.rootDir);
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? (() => crypto.randomUUID().replaceAll('-', '_'));
  const fs = deps.fs ?? nodeFs;
  const onProjectCommitted = deps.onProjectCommitted;
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
  let summaryV2Queue: Promise<unknown> = Promise.resolve();
  let connectionsQueue: Promise<unknown> = Promise.resolve();

  const safeLogError = (message: string, error: unknown): void => {
    try {
      logError(message, error);
    } catch {
      // Logging is diagnostic and cannot veto an already-authoritative project commit.
    }
  };

  const observeProjectCommit = (facts: StudioProjectCommitFacts): void => {
    if (onProjectCommitted === undefined) return;
    let observerResult: unknown;
    try {
      observerResult = (onProjectCommitted as (observed: StudioProjectCommitFacts) => unknown)(facts);
    } catch (error) {
      safeLogError('[CreativeStudio] Project commit observer failed', error);
      return;
    }
    if ((typeof observerResult !== 'object' || observerResult === null) && typeof observerResult !== 'function') {
      return;
    }
    try {
      if (typeof Reflect.get(observerResult, 'then') !== 'function') return;
      void Promise.resolve(observerResult).catch((error: unknown): void => {
        safeLogError('[CreativeStudio] Project commit observer rejected', error);
      });
    } catch (error) {
      safeLogError('[CreativeStudio] Project commit observer rejected', error);
    }
  };

  const requireSafeId = (projectId: string): void => {
    if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
  };

  const isInsideRoot = (canonicalRoot: string, target: string): boolean =>
    target === canonicalRoot || target.startsWith(canonicalRoot + path.sep);

  const storageError = (error: unknown, fallback: string): CreativeStudioStoreError =>
    new CreativeStudioStoreError('storage_error', error instanceof Error ? error.message : fallback);

  const canonicalRoot = async (): Promise<string> => {
    try {
      return await canonicalizeRecordRoot({ fs, rootDir });
    } catch (error) {
      throw storageError(error, 'Creative Studio root is unavailable');
    }
  };

  const existingCanonicalRootV2 = async (): Promise<string | null> => {
    try {
      const stats = await fs.lstat(rootDir);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio root is unsafe');
      }
      return await fs.realpath(rootDir);
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw storageError(error, 'Creative Studio root is unavailable');
    }
  };

  const writableCanonicalRootV2 = async (): Promise<string> => (await existingCanonicalRootV2()) ?? canonicalRoot();

  const resolveRootChild = (root: string, child: string): string => {
    try {
      return resolveConfinedRecordPath(root, root, child);
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage target escaped its root');
    }
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

  const createProjectDirectoryV2 = async (root: string, projectId: string): Promise<string> => {
    if (!isSafeIdV2(projectId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
    }
    const directory = resolveRootChild(root, projectId);
    try {
      await fs.mkdir(directory);
    } catch (error) {
      if (isRecord(error) && error.code === 'EEXIST') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
      }
      throw storageError(error, 'Creative Studio project directory could not be created');
    }
    try {
      const stats = await fs.lstat(directory);
      const canonicalDirectory = await fs.realpath(directory);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        !isInsideRoot(root, canonicalDirectory) ||
        canonicalDirectory === root
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
      return canonicalDirectory;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio project directory is unavailable');
    }
  };

  const summariesFileV2 = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'projects-v2.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const sniffOversizedStudioProjectSchema = async (
    root: string,
    file: string,
    preliminaryStats: Awaited<ReturnType<typeof fs.lstat>>
  ): Promise<boolean> => {
    const parent = path.dirname(file);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const parentStats = await fs.lstat(parent);
      if (
        parentStats.isSymbolicLink() ||
        !parentStats.isDirectory() ||
        (await fs.realpath(parent)) !== parent ||
        !isInsideRoot(root, parent)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio project directory is unsafe');
      }
      const flags =
        process.platform === 'win32'
          ? fsConstants.O_RDONLY
          : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
      handle = await fs.open(file, flags);
      const openedStats = await handle.stat();
      if (
        !openedStats.isFile() ||
        openedStats.dev !== preliminaryStats.dev ||
        openedStats.ino !== preliminaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file changed during schema inspection');
      }

      const isPriorProjectSchema = await hasTopLevelPriorProjectSchemaVersion(handle, openedStats.size);
      const [finalHandleStats, finalPathStats, finalParentStats, finalParent] = await Promise.all([
        handle.stat(),
        fs.lstat(file),
        fs.lstat(parent),
        fs.realpath(parent),
      ]);
      if (
        finalHandleStats.size !== openedStats.size ||
        finalHandleStats.mtimeMs !== openedStats.mtimeMs ||
        finalHandleStats.ctimeMs !== openedStats.ctimeMs ||
        finalPathStats.isSymbolicLink() ||
        !finalPathStats.isFile() ||
        finalPathStats.dev !== openedStats.dev ||
        finalPathStats.ino !== openedStats.ino ||
        finalParentStats.isSymbolicLink() ||
        !finalParentStats.isDirectory() ||
        finalParentStats.dev !== parentStats.dev ||
        finalParentStats.ino !== parentStats.ino ||
        finalParent !== parent
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file changed during schema inspection');
      }
      return isPriorProjectSchema;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Schema-2 Studio file could not be inspected');
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  };

  const readBoundedStudioV2File = async (
    root: string,
    file: string
  ): Promise<
    { status: 'bytes'; bytes: string; identity: FileIdentityV2 } | { status: 'unsupported_prototype_schema' } | null
  > => {
    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(file);
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw storageError(error, 'Schema-2 Studio file is unavailable');
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file is unsafe');
    }
    if (stats.size > STUDIO_PROJECT_V2_MAX_RECORD_BYTES) {
      if (await sniffOversizedStudioProjectSchema(root, file, stats)) {
        return { status: 'unsupported_prototype_schema' };
      }
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file is too large');
    }
    try {
      const record = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file,
        maxBytes: stats.size,
      });
      return record === null ? null : { status: 'bytes', bytes: record.bytes, identity: record.identity };
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio file could not be read');
    }
  };

  const connectionsFile = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'connections.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const sameIdentityV2 = (left: FileIdentityV2, right: FileIdentityV2): boolean =>
    left.dev === right.dev && left.ino === right.ino;

  const captureDirectoryAuthorityV2 = async (directory: string): Promise<DirectoryAuthorityV2> => {
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
      }
      return { path: directory, dev: stats.dev, ino: stats.ino };
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio directory authority is unavailable');
    }
  };

  const assertDirectoryAuthorityV2 = async (authority: DirectoryAuthorityV2): Promise<void> => {
    const current = await captureDirectoryAuthorityV2(authority.path);
    if (!sameIdentityV2(current, authority)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
    }
  };

  const syncDirectoryAuthorityV2 = async (authority: DirectoryAuthorityV2): Promise<void> => {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      await assertDirectoryAuthorityV2(authority);
      handle = await fs.open(authority.path, 'r');
      const stats = await handle.stat();
      if (!stats.isDirectory() || !sameIdentityV2(stats, authority)) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      await assertDirectoryAuthorityV2(authority);
    } catch (error) {
      await handle?.close().catch((): undefined => undefined);
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio directory sync failed');
    }
  };

  const {
    assertProjectSnapshotCurrentV2,
    recoverBriefTransactionV2,
    serializeProjectV2ForWrite,
    synchronizeBriefFileV2InsideQueue,
    writeBytesAtomic,
    writeJsonAtomic,
    writeProjectFilesV2,
  } = createStudioProjectTransactionsV2({
    fs,
    now,
    maxProjectBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
    resolveRootChild,
    assertRegularFileOrMissing,
    assertDirectoryAuthority: assertDirectoryAuthorityV2,
    syncDirectoryAuthority: syncDirectoryAuthorityV2,
    assertPathAbsent: (file) => assertPathAbsentV2(file),
    inspectProjectFile: (root, projectId) => inspectProjectFileV2(root, projectId),
    requireSupportedProjectInspection: (inspected) => requireSupportedProjectInspectionV2(inspected),
    observeProjectCommit,
    storageError,
  });

  const resolveProposalDirectoriesV2 = async (input: {
    root: string;
    project: DirectoryAuthorityV2;
    createIfWhollyAbsent: boolean;
    snapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ProposalDirectoriesV2 | null> => {
    await assertDirectoryAuthorityV2(input.project);
    let resolved: ({ root: string } & Record<(typeof PROPOSAL_V2_DIRECTORY_NAMES)[number], string>) | null;
    try {
      resolved = await resolveCompleteDirectorySet({
        fs,
        canonicalRoot: input.root,
        parent: input.project.path,
        rootName: 'proposals',
        childNames: PROPOSAL_V2_DIRECTORY_NAMES,
        createIfWhollyAbsent: input.createIfWhollyAbsent,
        authorizeBeforePublish:
          input.snapshot === undefined
            ? undefined
            : () => assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot! }),
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal directories are unavailable');
    }
    if (resolved === null) {
      if (input.snapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      }
      return null;
    }
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    const directories: ProposalDirectoriesV2 = {
      project: input.project,
      root: await captureDirectoryAuthorityV2(resolved.root),
      pending: await captureDirectoryAuthorityV2(resolved.pending),
      decisions: await captureDirectoryAuthorityV2(resolved.decisions),
      slots: await captureDirectoryAuthorityV2(resolved.slots),
      commits: await captureDirectoryAuthorityV2(resolved.commits),
    };
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.commits),
    ]);
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    return directories;
  };

  const assertProposalDirectoryAuthoritiesV2 = async (directories: ProposalDirectoriesV2): Promise<void> => {
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.commits),
    ]);
  };

  const resolveReferenceRequestDirectoriesV2 = async (input: {
    root: string;
    project: DirectoryAuthorityV2;
    createIfWhollyAbsent: boolean;
    snapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ReferenceRequestDirectoriesV2 | null> => {
    await assertDirectoryAuthorityV2(input.project);
    let resolved: ({ root: string } & Record<(typeof REFERENCE_REQUEST_V2_DIRECTORY_NAMES)[number], string>) | null;
    try {
      resolved = await resolveCompleteDirectorySet({
        fs,
        canonicalRoot: input.root,
        parent: input.project.path,
        rootName: 'reference-requests',
        childNames: REFERENCE_REQUEST_V2_DIRECTORY_NAMES,
        createIfWhollyAbsent: input.createIfWhollyAbsent,
        authorizeBeforePublish:
          input.snapshot === undefined
            ? undefined
            : () => assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot! }),
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio reference request directories are unavailable');
    }
    if (resolved === null) {
      if (input.snapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      }
      return null;
    }
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    const directories: ReferenceRequestDirectoriesV2 = {
      project: input.project,
      root: await captureDirectoryAuthorityV2(resolved.root),
      pending: await captureDirectoryAuthorityV2(resolved.pending),
      decisions: await captureDirectoryAuthorityV2(resolved.decisions),
      slots: await captureDirectoryAuthorityV2(resolved.slots),
      receipts: await captureDirectoryAuthorityV2(resolved.receipts),
    };
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.receipts),
    ]);
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    return directories;
  };

  const assertReferenceRequestDirectoryAuthoritiesV2 = async (
    directories: ReferenceRequestDirectoriesV2
  ): Promise<void> => {
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.receipts),
    ]);
  };

  const reconcileJournalPublicationResiduesV2 = async <RecordType>(input: {
    root: string;
    authority: DirectoryAuthorityV2;
    maxBytes?: number;
    validateNamedBase: (namedBase: string) => boolean;
    parseRecord: (namedBase: string, value: unknown) => RecordType | null;
    deferCleanup?: boolean;
  }): Promise<Array<{ identified: IdentifiedRecordV2<RecordType>; namedFile: string; effective: boolean }>> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    const deferred: Array<{ identified: IdentifiedRecordV2<RecordType>; namedFile: string; effective: boolean }> = [];
    const entries = await readStableDirectoryEntriesV2(input.authority);
    for (const entry of entries) {
      if (!entry.name.endsWith('.publish')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is unsafe');
      }
      const temporaryFile = path.join(input.authority.path, entry.name);
      const namedFile = temporaryFile.slice(0, -'.publish'.length);
      const namedBase = path.basename(namedFile);
      if (!input.validateNamedBase(namedBase)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        [temporary, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: temporaryFile,
            maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio proposal publication residue could not be inspected');
      }
      if (temporary === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue changed');
      }
      if (named !== null && (!sameIdentityV2(temporary.identity, named.identity) || temporary.bytes !== named.bytes)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is ambiguous');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(temporary.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      const record = input.parseRecord(namedBase, decoded);
      if (record === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      const identified: IdentifiedRecordV2<RecordType> = {
        file: temporaryFile,
        bytes: temporary.bytes,
        identity: temporary.identity,
        record,
        quarantined: false,
      };
      await assertIdentifiedRecordCurrentV2({ root: input.root, authority: input.authority, identified, maxBytes });
      if (input.deferCleanup) {
        deferred.push({ identified, namedFile, effective: named === null });
        continue;
      }
      try {
        await fs.rm(temporaryFile);
      } catch (error) {
        throw storageError(error, 'Studio proposal publication residue could not be removed');
      }
      await syncDirectoryAuthorityV2(input.authority);
    }
    return deferred;
  };

  const reconcileOwnedPendingPublicationResiduesV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    maxBytes: number;
    validateNamedBase: (namedBase: string) => boolean;
    validateRecord: (namedBase: string, value: unknown) => boolean;
    allowForeignNamedPhase?: boolean;
    deferCleanup?: boolean;
  }): Promise<
    Array<{
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready';
      effective: boolean;
    }>
  > => {
    const deferred: Array<{
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready';
      effective: boolean;
    }> = [];
    const entries = await readStableDirectoryEntriesV2(input.authority);
    for (const entry of entries) {
      const match = /^(.*)\.\d+_\d+\.(tmp|ready)$/.exec(entry.name);
      if (match === null) continue;
      const namedBase = match[1];
      if (namedBase === undefined || !input.validateNamedBase(namedBase) || !entry.isFile() || entry.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      const temporaryFile = path.join(input.authority.path, entry.name);
      const namedFile = path.join(input.authority.path, namedBase);
      let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        [temporary, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: temporaryFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio pending publication residue could not be inspected');
      }
      const foreignNamedPhase =
        named !== null &&
        (temporary === null || temporary.bytes !== named.bytes || !sameIdentityV2(temporary.identity, named.identity));
      if (temporary === null || (foreignNamedPhase && input.allowForeignNamedPhase !== true)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is ambiguous');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(temporary.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      if (!input.validateRecord(namedBase, decoded)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      if (match[2] === 'ready') {
        const preparation = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: `${temporaryFile.slice(0, -'.ready'.length)}.tmp`,
          maxBytes: input.maxBytes,
        });
        if (
          preparation === null ||
          preparation.bytes !== temporary.bytes ||
          !sameIdentityV2(preparation.identity, temporary.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is ambiguous');
        }
      }
      const identified: IdentifiedRecordV2<null> = {
        file: temporaryFile,
        bytes: temporary.bytes,
        identity: temporary.identity,
        record: null,
        quarantined: false,
      };
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified,
        maxBytes: input.maxBytes,
      });
      if (input.deferCleanup) {
        deferred.push({
          identified,
          namedFile,
          phase: match[2] === 'ready' ? 'ready' : 'tmp',
          effective: match[2] === 'ready' && named === null,
        });
        continue;
      }
      await syncDirectoryAuthorityV2(input.authority);
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified,
        maxBytes: input.maxBytes,
      });
      try {
        await fs.rm(temporaryFile);
      } catch (error) {
        throw storageError(error, 'Studio pending publication residue could not be removed');
      }
      await syncDirectoryAuthorityV2(input.authority);
    }
    return deferred;
  };

  const reconcileOwnedSlotCleanupResiduesV2 = async <SlotRecord>(input: {
    root: string;
    pending: DirectoryAuthorityV2;
    slots: DirectoryAuthorityV2;
    maxBytes: number;
    capacity: number;
    recordId: (record: SlotRecord) => string;
    validatePending: (recordId: string, value: unknown) => boolean;
    parse: (
      value: unknown
    ) => { status: 'valid'; record: SlotRecord } | { status: 'unsupported_prototype_schema' } | { status: 'invalid' };
    deferCleanup?: boolean;
  }): Promise<Array<{ identified: IdentifiedRecordV2<SlotRecord>; namedFile: string; effective: boolean }>> => {
    const deferred: Array<{
      identified: IdentifiedRecordV2<SlotRecord>;
      namedFile: string;
      effective: boolean;
    }> = [];
    const entries = await readStableDirectoryEntriesV2(input.slots);
    for (const entry of entries) {
      const match = /^((?:0|[1-9]\d*)\.slot)\.\d+_\d+\.cleanup$/.exec(entry.name);
      if (match === null) continue;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        match[1] === undefined ||
        !isCanonicalV2SlotFileName(match[1], input.capacity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup residue is malformed');
      }
      const quarantineFile = path.join(input.slots.path, entry.name);
      const namedFile = path.join(input.slots.path, match[1]);
      const quarantined = await parseIdentifiedJsonV2({
        root: input.root,
        file: quarantineFile,
        maxBytes: input.maxBytes,
        parse: input.parse,
      });
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        named = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: namedFile,
          maxBytes: input.maxBytes,
        });
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup named authority could not be inspected');
      }
      if (named !== null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(named.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup named record is malformed');
        }
        const parsed = input.parse(decoded);
        if (
          parsed.status !== 'valid' ||
          input.recordId(parsed.record) !== input.recordId(quarantined.record) ||
          named.bytes !== quarantined.bytes ||
          !sameIdentityV2(named.identity, quarantined.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup residue is ambiguous');
        }
      }
      await assertDirectoryAuthorityV2(input.pending);
      const pendingFile = path.join(input.pending.path, `${input.recordId(quarantined.record)}.json`);
      let pending: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        pending = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: pendingFile,
          maxBytes: input.maxBytes,
        });
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup residue pending authority could not be inspected');
      }
      if (pending !== null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(pending.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup pending record is malformed');
        }
        if (!input.validatePending(input.recordId(quarantined.record), decoded)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup pending record is malformed');
        }
      }
      await Promise.all([
        assertDirectoryAuthorityV2(input.pending),
        assertDirectoryAuthorityV2(input.slots),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.slots,
          identified: quarantined,
          maxBytes: input.maxBytes,
        }),
        ...(pending === null
          ? []
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.pending,
                identified: {
                  file: pendingFile,
                  bytes: pending.bytes,
                  identity: pending.identity,
                  record: null,
                  quarantined: false,
                },
                maxBytes: input.maxBytes,
              }),
            ]),
        ...(named === null
          ? [assertPathAbsentV2(namedFile)]
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.slots,
                identified: {
                  file: namedFile,
                  bytes: named.bytes,
                  identity: named.identity,
                  record: null,
                  quarantined: false,
                },
                maxBytes: input.maxBytes,
              }),
            ]),
      ]);
      if (input.deferCleanup) {
        deferred.push({ identified: quarantined, namedFile, effective: named === null && pending !== null });
        continue;
      }
      try {
        if (named !== null || pending === null) await fs.rm(quarantineFile);
        else await fs.rename(quarantineFile, namedFile);
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup residue could not be reconciled');
      }
      await syncDirectoryAuthorityV2(input.slots);
    }
    return deferred;
  };

  const publishImmutableJournalRecordV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    file: string;
    bytes: string;
    maxBytes?: number;
    authorizeBeforeLink?: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
    retainTemporary?: boolean;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    const temporaryFile = `${input.file}.publish`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let temporaryOwned = false;
    let linked = false;
    let temporaryIdentity: Awaited<ReturnType<Awaited<ReturnType<typeof fs.open>>['stat']>> | undefined;
    let identifiedTemporary: IdentifiedRecordV2<null> | undefined;
    try {
      await assertDirectoryAuthorityV2(input.authority);
      await Promise.all([assertPathAbsentV2(input.file), assertPathAbsentV2(temporaryFile)]);
      handle = await fs.open(temporaryFile, 'wx');
      temporaryOwned = true;
      temporaryIdentity = await handle.stat();
      if (!temporaryIdentity.isFile()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary is unsafe');
      }
      await handle.writeFile(input.bytes, { encoding: 'utf8' });
      await handle.sync();
      const writtenIdentity = await handle.stat();
      if (
        !writtenIdentity.isFile() ||
        writtenIdentity.dev !== temporaryIdentity.dev ||
        writtenIdentity.ino !== temporaryIdentity.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary is unsafe');
      }
      await handle.close();
      handle = undefined;
      await assertDirectoryAuthorityV2(input.authority);
      identifiedTemporary = {
        file: temporaryFile,
        bytes: input.bytes,
        identity: temporaryIdentity,
        record: null,
        quarantined: false,
      };
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: identifiedTemporary,
        maxBytes,
      });
      await input.authorizeBeforeLink?.(identifiedTemporary);
      await Promise.all([
        assertDirectoryAuthorityV2(input.authority),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: identifiedTemporary,
          maxBytes,
        }),
        assertPathAbsentV2(input.file),
      ]);
      // Re-run caller authority after every asynchronous publication proof. The only remaining
      // source race is the adjacent lstat/link syscall edge, and the hard link itself still
      // enforces exclusive destination publication.
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: identifiedTemporary,
        maxBytes,
      });
      await input.authorizeBeforeLink?.(identifiedTemporary);
      await fs.link(temporaryFile, input.file);
      linked = true;
      await syncDirectoryAuthorityV2(input.authority);
      const named = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.file,
        maxBytes,
      });
      if (
        named === null ||
        named.bytes !== input.bytes ||
        named.identity.dev !== temporaryIdentity.dev ||
        named.identity.ino !== temporaryIdentity.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication changed');
      }
      if (!input.retainTemporary) {
        const namedAuthority: IdentifiedRecordV2<null> = { ...identifiedTemporary, file: input.file };
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.authority,
            identified: identifiedTemporary,
            maxBytes,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.authority,
            identified: namedAuthority,
            maxBytes,
          }),
        ]);
        await fs.rm(temporaryFile);
        await syncDirectoryAuthorityV2(input.authority);
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: namedAuthority,
          maxBytes,
        });
      }
    } catch (error) {
      await handle?.close().catch((): undefined => undefined);
      if (temporaryOwned && !linked && temporaryIdentity !== undefined) {
        try {
          const current = await fs.lstat(temporaryFile);
          if (
            current.isSymbolicLink() ||
            !current.isFile() ||
            current.dev !== temporaryIdentity.dev ||
            current.ino !== temporaryIdentity.ino
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary changed');
          }
          await fs.rm(temporaryFile);
        } catch {
          // A replaced or ambiguous temporary is foreign authority and must be preserved.
        }
      }
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Studio proposal immutable publication failed');
    }
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
      const connections = parsed.connections.map((connection) => canonicalizeConnectionBinding(connection, true));
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

  const inspectProjectFileV2 = async (root: string, projectId: string): Promise<ProjectFileInspectionV2> => {
    const directoryPath = await projectDirectory(root, projectId, false);
    if (directoryPath === null) return { status: 'not_found', projectId };
    const directory = await captureDirectoryAuthorityV2(directoryPath);
    const file = resolveRootChild(directory.path, 'project.json');
    await assertRegularFileOrMissing(file);
    const initialRecord = await readBoundedStudioV2File(root, file);
    if (initialRecord === null) return { status: 'not_found', projectId };
    if (initialRecord.status === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema', projectId };
    }
    let initialParsed: unknown;
    try {
      initialParsed = JSON.parse(initialRecord.bytes) as unknown;
    } catch {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    if (isRecord(initialParsed) && isUnsupportedStudioPrototypeSchemaVersion(initialParsed.schemaVersion)) {
      return { status: 'unsupported_prototype_schema', projectId };
    }
    if (!isRecord(initialParsed) || initialParsed.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION) {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    await recoverBriefTransactionV2(root, directory, initialRecord);
    await assertRegularFileOrMissing(file);
    const record = await readBoundedStudioV2File(root, file);
    if (record === null) return { status: 'not_found', projectId };
    if (record.status === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema', projectId };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(record.bytes) as unknown;
    } catch {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    if (isRecord(parsed) && isUnsupportedStudioPrototypeSchemaVersion(parsed.schemaVersion)) {
      return { status: 'unsupported_prototype_schema', projectId };
    }
    let briefFile: Extract<ProjectFileInspectionV2, { status: 'supported' }>['briefFile'];
    try {
      const briefRecord = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: resolveRootChild(directory.path, STUDIO_BRIEF_FILE_NAME),
        maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
      });
      if (briefRecord === null) {
        return {
          status: 'malformed_v2',
          projectId,
          error: new CreativeStudioStoreError('storage_error', 'Schema-5 Studio Brief is missing'),
        };
      }
      briefFile = { status: 'present', ...briefRecord };
    } catch (error) {
      return {
        status: 'malformed_v2',
        projectId,
        error: storageError(error, 'Schema-2 Studio Brief could not be read'),
      };
    }
    const decoded = decodeStudioProjectManifestV2(parsed, briefFile.status === 'present' ? briefFile.bytes : null);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
      decoded === null ||
      decoded.project.id !== projectId
    ) {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    await assertDirectoryAuthorityV2(directory);
    return {
      status: 'supported',
      project: decoded.project,
      bytes: record.bytes,
      identity: record.identity,
      directory,
      briefFile,
      briefSynchronized: decoded.synchronized,
    };
  };

  const readStableDirectoryEntriesV2 = async (authority: DirectoryAuthorityV2): Promise<import('node:fs').Dirent[]> => {
    try {
      await assertDirectoryAuthorityV2(authority);
      const entries = await fs.readdir(authority.path, { withFileTypes: true });
      await assertDirectoryAuthorityV2(authority);
      return entries.toSorted((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Schema-2 Studio proposal directory could not be read');
    }
  };

  const parseIdentifiedJsonV2 = async <RecordType>(input: {
    root: string;
    file: string;
    quarantined?: boolean;
    maxBytes?: number;
    parse: (
      value: unknown
    ) => { status: 'valid'; record: RecordType } | { status: 'unsupported_prototype_schema' } | { status: 'invalid' };
  }): Promise<IdentifiedRecordV2<RecordType>> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    let identified: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      identified = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.file,
        maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal record is unsafe');
    }
    if (identified === null) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal record changed during read');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(identified.bytes) as unknown;
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal record');
    }
    const result = input.parse(parsed);
    if (result.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError(
        'unsupported_prototype_schema',
        'Unsupported prototype Studio proposal schema'
      );
    }
    if (result.status !== 'valid') {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal record');
    }
    return {
      file: input.file,
      bytes: identified.bytes,
      identity: identified.identity,
      record: result.record,
      quarantined: input.quarantined ?? false,
    };
  };

  const parseAttributionRecordV2 = (
    projectId: string,
    proposalId: string,
    value: unknown
  ):
    | { status: 'valid'; record: StudioProposalCommitAttributionV2 }
    | { status: 'unsupported_prototype_schema' }
    | { status: 'invalid' } => {
    if (
      isRecord(value) &&
      Number.isSafeInteger(value.schemaVersion) &&
      (value.schemaVersion as number) >= 1 &&
      (value.schemaVersion as number) < STUDIO_PROPOSAL_SCHEMA_VERSION_V2
    ) {
      return { status: 'unsupported_prototype_schema' };
    }
    return validateProposalCommitAttributionV2(projectId, proposalId, value)
      ? { status: 'valid', record: value }
      : { status: 'invalid' };
  };

  const readProposalLedgerV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
  }): Promise<ProposalLedgerV2> => {
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const pendingResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.pending,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
      validateRecord: (namedBase, value) => {
        const proposalId = namedBase.slice(0, -'.json'.length);
        return parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }).status === 'valid';
      },
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotPublicationResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.slots,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) => isCanonicalV2SlotFileName(namedBase, STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT),
      validateRecord: (_namedBase, value) => parseStudioProposalSlotV2(value).status === 'valid',
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotCleanupResidues = await reconcileOwnedSlotCleanupResiduesV2({
      root: input.root,
      pending: input.directories.pending,
      slots: input.directories.slots,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      capacity: STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
      recordId: (slot: StudioProposalSlotV2) => slot.proposalId,
      validatePending: (proposalId, value) =>
        parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }).status === 'valid',
      parse: parseStudioProposalSlotV2,
      deferCleanup: true,
    });
    const [decisionResidues, attributionResidues] = await Promise.all([
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.decisions,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const proposalId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioProposalDecisionV2({ proposalId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.commits,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith(PROPOSAL_V2_COMMIT_FILE_SUFFIX) &&
          isSafeProposalId(namedBase.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length)),
        parseRecord: (namedBase, value) => {
          const proposalId = namedBase.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length);
          const parsed = parseAttributionRecordV2(input.projectId, proposalId, value);
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
    ]);
    const [rawPendingEntries, rawDecisionEntries, rawSlotEntries, rawCommitEntries] = await Promise.all([
      readStableDirectoryEntriesV2(input.directories.pending),
      readStableDirectoryEntriesV2(input.directories.decisions),
      readStableDirectoryEntriesV2(input.directories.slots),
      readStableDirectoryEntriesV2(input.directories.commits),
    ]);
    const decisionResidueNames = new Set(decisionResidues.map((residue) => path.basename(residue.identified.file)));
    const attributionResidueNames = new Set(
      attributionResidues.map((residue) => path.basename(residue.identified.file))
    );
    const pendingResidueNames = new Set(pendingResidues.map((record) => path.basename(record.identified.file)));
    const slotResidueNames = new Set([
      ...slotPublicationResidues.map((record) => path.basename(record.identified.file)),
      ...slotCleanupResidues.map((record) => path.basename(record.identified.file)),
    ]);
    const pendingEntries = rawPendingEntries.filter((entry) => !pendingResidueNames.has(entry.name));
    const slotEntries = rawSlotEntries.filter((entry) => !slotResidueNames.has(entry.name));
    const decisionEntries = rawDecisionEntries.filter((entry) => !decisionResidueNames.has(entry.name));
    const commitEntries = rawCommitEntries.filter((entry) => !attributionResidueNames.has(entry.name));
    const proposals = new Map<string, IdentifiedRecordV2<StudioProposalRecordV2>>();
    const decisions = new Map<string, IdentifiedRecordV2<StudioProposalDecisionV2>>();
    const slots = new Map<string, IdentifiedRecordV2<StudioProposalSlotV2>[]>();
    const attributions: IdentifiedRecordV2<StudioProposalCommitAttributionV2>[] = [];

    for (const entry of pendingEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal directory');
      }
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId) || proposals.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal identity');
      }
      // The proposal ledger is bounded by its slot family.
      // eslint-disable-next-line no-await-in-loop
      const proposal = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.pending.path, entry.name),
        parse: (value) => parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }),
      });
      proposals.set(proposalId, proposal);
    }
    for (const residue of pendingResidues) {
      if (!residue.effective) continue;
      const proposalId = path.basename(residue.namedFile, '.json');
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal recovery record');
      }
      const parsed = parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value });
      if (parsed.status !== 'valid' || proposals.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous schema-2 Studio proposal recovery record');
      }
      proposals.set(proposalId, { ...residue.identified, record: parsed.record });
    }
    for (const entry of decisionEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal decision directory');
      }
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId) || decisions.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal decision identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const decision = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.decisions.path, entry.name),
        parse: (value) => parseStudioProposalDecisionV2({ proposalId, value }),
      });
      decisions.set(proposalId, decision);
    }

    for (const entry of slotEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedSlot = cleanup?.namedFileName ?? entry.name;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !isCanonicalV2SlotFileName(namedSlot, STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot directory');
      }
      // eslint-disable-next-line no-await-in-loop
      const slot = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.slots.path, entry.name),
        quarantined,
        parse: parseStudioProposalSlotV2,
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(slot.identity, cleanup.identity) || sha256Utf8(slot.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal cleanup authority mismatch');
      }
      const held = slots.get(slot.record.proposalId) ?? [];
      held.push(slot);
      slots.set(slot.record.proposalId, held);
    }
    for (const residue of slotCleanupResidues) {
      if (!residue.effective) continue;
      const effective = { ...residue.identified, quarantined: false };
      const held = slots.get(effective.record.proposalId) ?? [];
      held.push(effective);
      slots.set(effective.record.proposalId, held);
    }
    for (const residue of slotPublicationResidues) {
      if (!residue.effective) continue;
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot recovery');
      }
      const parsed = parseStudioProposalSlotV2(value);
      if (parsed.status !== 'valid') {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot recovery');
      }
      const held = slots.get(parsed.record.proposalId) ?? [];
      held.push({ ...residue.identified, record: parsed.record });
      slots.set(parsed.record.proposalId, held);
    }

    for (const entry of commitEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedCommit = cleanup?.namedFileName ?? entry.name;
      if (!entry.isFile() || entry.isSymbolicLink() || !namedCommit.endsWith(PROPOSAL_V2_COMMIT_FILE_SUFFIX)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio proposal attribution directory');
      }
      const proposalId = namedCommit.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length);
      if (!isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio proposal attribution identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const attribution = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.commits.path, entry.name),
        quarantined,
        parse: (value) => parseAttributionRecordV2(input.projectId, proposalId, value),
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(attribution.identity, cleanup.identity) || sha256Utf8(attribution.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal cleanup authority mismatch');
      }
      attributions.push(attribution);
    }
    for (const residue of decisionResidues) {
      if (!residue.effective) continue;
      const proposalId = path.basename(residue.namedFile, '.json');
      if (decisions.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal decision publication');
      }
      decisions.set(proposalId, residue.identified);
    }
    for (const residue of attributionResidues) {
      if (residue.effective) attributions.push(residue.identified);
    }

    await assertProposalDirectoryAuthoritiesV2(input.directories);
    if (attributions.length > 1) {
      throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal commit attribution');
    }
    for (const [proposalId, decision] of decisions) {
      const proposal = proposals.get(proposalId);
      if (
        proposal === undefined ||
        decision.record.proposalId !== proposalId ||
        Date.parse(decision.record.decidedAt) < Date.parse(proposal.record.createdAt) ||
        (decision.record.status === 'expired' &&
          Date.parse(decision.record.decidedAt) <
            Date.parse(proposal.record.createdAt) + STUDIO_PROPOSAL_PENDING_TTL_MS)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision has no immutable proposal');
      }
    }
    for (const [proposalId, held] of slots) {
      if (held.length > 1) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal slot authority');
      }
      const proposal = proposals.get(proposalId);
      if (proposal !== undefined && decisions.get(proposalId) === undefined && held[0].quarantined) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal slot is quarantined');
      }
    }
    for (const proposalId of proposals.keys()) {
      if (decisions.has(proposalId)) continue;
      const held = slots.get(proposalId) ?? [];
      if (held.length !== 1 || held[0].quarantined) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal has no exact slot authority');
      }
    }
    const unresolvedCount = [...proposals.keys()].filter((proposalId) => !decisions.has(proposalId)).length;
    // Terminal proposal sources and decisions are immutable audit history. They are
    // deliberately excluded from the live admission cap and never turn an otherwise
    // readable project into a permanent storage error solely because history grew.
    if (unresolvedCount > STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal ledger exceeds its capacity');
    }
    return {
      directories: input.directories,
      proposals,
      decisions,
      slots,
      attributions,
      journalResidues: [
        ...decisionResidues.map((residue) => Object.assign({ family: `decisions` as const }, residue)),
        ...attributionResidues.map((residue) => Object.assign({ family: `commits` as const }, residue)),
      ],
      writerResidues: [
        ...pendingResidues.map((residue) => Object.assign({ family: `pending` as const }, residue)),
        ...slotPublicationResidues.map((residue) => Object.assign({ family: `slots` as const }, residue)),
        ...slotCleanupResidues.map(({ identified, namedFile }) => ({
          family: 'slots' as const,
          identified: { ...identified, record: null } as IdentifiedRecordV2<null>,
          namedFile,
          phase: 'cleanup' as const,
          effective: true,
        })),
      ],
    };
  };

  const assertProposalLedgerEntrySetCurrentV2 = async (
    ledger: ProposalLedgerV2,
    publication?: {
      decision?: IdentifiedRecordV2<null>;
      attribution?: IdentifiedRecordV2<null>;
    }
  ): Promise<void> => {
    const root = path.dirname(ledger.directories.project.path);
    const assertEntries = async (
      authority: DirectoryAuthorityV2,
      records: readonly IdentifiedRecordV2<unknown>[]
    ): Promise<void> => {
      const expected = new Map(records.map((record) => [path.basename(record.file), record]));
      const entries = await readStableDirectoryEntriesV2(authority);
      const observed = new Set<string>();
      for (const entry of entries) {
        const identified = expected.get(entry.name);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
        }
        if (identified === undefined) {
          const named = entry.name.endsWith('.publish')
            ? expected.get(entry.name.slice(0, -'.publish'.length))
            : undefined;
          if (named === undefined) {
            throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
          }
          // A just-published immutable journal may have its durable recovery twin before the
          // caller refreshes the ledger. Admit only the exact same inode and bytes.
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: { ...named, file: path.join(authority.path, entry.name) },
          });
          continue;
        }
        observed.add(entry.name);
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({ root, authority, identified });
      }
      if ([...expected.keys()].some((name) => !observed.has(name))) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
      }
      await assertDirectoryAuthorityV2(authority);
    };
    await Promise.all([
      assertEntries(ledger.directories.pending, [
        ...ledger.proposals.values(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'pending').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.decisions, [
        ...ledger.decisions.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'decisions')
          .map((residue) => residue.identified),
        ...(publication?.decision === undefined ? [] : [publication.decision]),
      ]),
      assertEntries(ledger.directories.slots, [
        ...[...ledger.slots.values()].flat(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'slots').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.commits, [
        ...ledger.attributions,
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'commits')
          .map((residue) => residue.identified),
        ...(publication?.attribution === undefined ? [] : [publication.attribution]),
      ]),
    ]);
    await assertProposalDirectoryAuthoritiesV2(ledger.directories);
  };

  const cleanupJournalPublicationResidueV2 = async <RecordType>(input: {
    root: string;
    authority: DirectoryAuthorityV2;
    identified: IdentifiedRecordV2<RecordType>;
    namedFile: string;
    effective: boolean;
    maxBytes: number;
    authorizeProject: () => Promise<void>;
  }): Promise<IdentifiedRecordV2<RecordType>> => {
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.identified,
      maxBytes: input.maxBytes,
    });
    if (input.effective) {
      await assertPathAbsentV2(input.namedFile);
      await input.authorizeProject();
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.identified,
        maxBytes: input.maxBytes,
      });
      try {
        await fs.link(input.identified.file, input.namedFile);
      } catch (error) {
        if (!isRecord(error) || error.code !== 'EEXIST') {
          throw storageError(error, 'Studio journal publication residue could not be promoted');
        }
      }
      await syncDirectoryAuthorityV2(input.authority);
      const named = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.namedFile,
        maxBytes: input.maxBytes,
      });
      if (
        named === null ||
        named.bytes !== input.identified.bytes ||
        !sameIdentityV2(named.identity, input.identified.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio journal publication promotion changed');
      }
    }
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.identified,
      maxBytes: input.maxBytes,
    });
    const named = await readBoundedRegularFileWithIdentity({
      fs,
      canonicalRoot: input.root,
      file: input.namedFile,
      maxBytes: input.maxBytes,
    });
    if (
      named === null ||
      named.bytes !== input.identified.bytes ||
      !sameIdentityV2(named.identity, input.identified.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio journal publication authority changed');
    }
    await input.authorizeProject();
    const identifiedNamed: IdentifiedRecordV2<RecordType> = { ...input.identified, file: input.namedFile };
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: identifiedNamed,
      maxBytes: input.maxBytes,
    });
    // Keep the recognized publication companion as a durable recovery hardlink. It is removed
    // only with the terminal relation that makes the underlying journal record unnecessary.
    return identifiedNamed;
  };

  const cleanupProposalJournalPublicationResiduesV2 = async (
    root: string,
    ledger: ProposalLedgerV2,
    authorizeProject: () => Promise<void>
  ): Promise<ProposalLedgerV2> => {
    const current: ProposalLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions),
      attributions: [...ledger.attributions],
      journalResidues: [...ledger.journalResidues],
    };
    for (const residue of ledger.journalResidues) {
      const authority = current.directories[residue.family];
      await assertProposalLedgerEntrySetCurrentV2(current);
      if (residue.family === 'decisions') {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) current.decisions.set(residue.identified.record.proposalId, named);
      } else {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) {
          current.attributions = current.attributions.map((attribution) =>
            attribution.file === residue.identified.file ? named : attribution
          );
        }
      }
      current.journalResidues = current.journalResidues.map((candidate) =>
        candidate.identified.file === residue.identified.file ? { ...candidate, effective: false } : candidate
      );
    }
    return current;
  };

  const removeJournalPublicationCompanionV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    named: IdentifiedRecordV2<unknown>;
    maxBytes: number;
    authorize: () => Promise<void>;
  }): Promise<void> => {
    const companionFile = `${input.named.file}.publish`;
    let companion: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      companion = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: companionFile,
        maxBytes: input.maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Studio journal recovery companion could not be inspected');
    }
    if (companion === null) return;
    if (companion.bytes !== input.named.bytes || !sameIdentityV2(companion.identity, input.named.identity)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio journal recovery companion is ambiguous');
    }
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.named,
        maxBytes: input.maxBytes,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: {
          file: companionFile,
          bytes: companion.bytes,
          identity: companion.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: input.maxBytes,
      }),
    ]);
    await input.authorize();
    try {
      await fs.rm(companionFile);
    } catch (error) {
      throw storageError(error, 'Studio journal recovery companion could not be removed');
    }
    await syncDirectoryAuthorityV2(input.authority);
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.named,
      maxBytes: input.maxBytes,
    });
  };

  const cleanupCapturedWriterResiduesV2 = async <SlotRecord>(input: {
    root: string;
    pending: DirectoryAuthorityV2;
    slots: DirectoryAuthorityV2;
    residues: Array<{
      family: 'pending' | 'slots';
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready' | 'cleanup';
      effective: boolean;
    }>;
    maxBytes: number;
    capacity: number;
    parseSlot: (
      value: unknown
    ) => { status: 'valid'; record: SlotRecord } | { status: 'unsupported_prototype_schema' } | { status: 'invalid' };
    recordId: (record: SlotRecord) => string;
    validatePending: (recordId: string, value: unknown) => boolean;
    authorizeProject: () => Promise<void>;
    recoveryAction: (residue: {
      family: 'pending' | 'slots';
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready' | 'cleanup';
      effective: boolean;
    }) => Promise<'promote' | 'rollback' | 'retain'>;
  }): Promise<void> => {
    const orderedResidues = [...input.residues].toSorted(
      (left, right) => Number(right.phase === 'ready') - Number(left.phase === 'ready')
    );
    const removedResidueFiles = new Set<string>();
    const assertValidForeignNamedPhaseV2 = (collision: {
      family: 'pending' | 'slots';
      namedFile: string;
      phaseBytes: string;
      namedBytes: string;
    }): void => {
      let phaseValue: unknown;
      let namedValue: unknown;
      try {
        phaseValue = JSON.parse(collision.phaseBytes) as unknown;
        namedValue = JSON.parse(collision.namedBytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
      if (collision.family === 'pending') {
        const namedBase = path.basename(collision.namedFile);
        if (!namedBase.endsWith('.json')) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        const recordId = namedBase.slice(0, -'.json'.length);
        if (!input.validatePending(recordId, phaseValue) || !input.validatePending(recordId, namedValue)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        return;
      }
      const phaseSlot = input.parseSlot(phaseValue);
      const namedSlot = input.parseSlot(namedValue);
      if (
        phaseSlot.status !== 'valid' ||
        namedSlot.status !== 'valid' ||
        input.recordId(phaseSlot.record) === input.recordId(namedSlot.record)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
    };
    for (const residue of orderedResidues) {
      if (removedResidueFiles.has(residue.identified.file)) continue;
      const authority = residue.family === 'pending' ? input.pending : input.slots;
      if (residue.identified.file.endsWith('.tmp')) {
        const readyFile = `${residue.identified.file.slice(0, -'.tmp'.length)}.ready`;
        const namedFile = residue.identified.file.replace(/\.\d+_\d+\.tmp$/, '');
        const [ready, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: readyFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
        ]);
        const namedIsExact =
          named !== null &&
          named.bytes === residue.identified.bytes &&
          sameIdentityV2(named.identity, residue.identified.identity);
        if (named !== null && !namedIsExact) {
          assertValidForeignNamedPhaseV2({
            family: residue.family,
            namedFile,
            phaseBytes: residue.identified.bytes,
            namedBytes: named.bytes,
          });
        }
        if (ready !== null) {
          if (
            ready.bytes !== residue.identified.bytes ||
            !sameIdentityV2(ready.identity, residue.identified.identity) ||
            named === null
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
          }
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          continue;
        }
        if (named !== null && !namedIsExact) {
          const identifiedNamed: IdentifiedRecordV2<null> = {
            file: namedFile,
            bytes: named.bytes,
            identity: named.identity,
            record: null,
            quarantined: false,
          };
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          await input.authorizeProject();
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          await input.authorizeProject();
          try {
            await fs.rm(residue.identified.file);
            await syncDirectoryAuthorityV2(authority);
          } catch (error) {
            throw storageError(error, 'Studio writer collision residue could not be rolled back');
          }
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: identifiedNamed,
            maxBytes: input.maxBytes,
          });
          removedResidueFiles.add(residue.identified.file);
          continue;
        }
      }
      const readyMatch = /^(.*)\.\d+_\d+\.ready$/.exec(path.basename(residue.identified.file));
      if (readyMatch?.[1] !== undefined) {
        const namedFile = residue.namedFile;
        let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
        let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
        try {
          // eslint-disable-next-line no-await-in-loop
          [named, temporary] = await Promise.all([
            readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: namedFile,
              maxBytes: input.maxBytes,
            }),
            readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: `${residue.identified.file.slice(0, -'.ready'.length)}.tmp`,
              maxBytes: input.maxBytes,
            }),
          ]);
        } catch (error) {
          throw storageError(error, 'Studio writer recovery authority could not be inspected');
        }
        if (
          temporary === null ||
          temporary.bytes !== residue.identified.bytes ||
          !sameIdentityV2(temporary.identity, residue.identified.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        if (
          named !== null &&
          (named.bytes !== residue.identified.bytes || !sameIdentityV2(named.identity, residue.identified.identity))
        ) {
          assertValidForeignNamedPhaseV2({
            family: residue.family,
            namedFile,
            phaseBytes: residue.identified.bytes,
            namedBytes: named.bytes,
          });

          const temporaryFile = `${residue.identified.file.slice(0, -'.ready'.length)}.tmp`;
          const identifiedTemporary: IdentifiedRecordV2<null> = {
            file: temporaryFile,
            bytes: temporary.bytes,
            identity: temporary.identity,
            record: null,
            quarantined: false,
          };
          const identifiedNamed: IdentifiedRecordV2<null> = {
            file: namedFile,
            bytes: named.bytes,
            identity: named.identity,
            record: null,
            quarantined: false,
          };
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedTemporary,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          // A distinct valid inode owns the exclusive canonical name, proving this phase never
          // committed. Roll back only the exact owned pair, ready first so an interrupted cleanup
          // leaves canonical + tmp, which remains safely recoverable on the next fence.
          await input.authorizeProject();
          try {
            await fs.rm(residue.identified.file);
            await syncDirectoryAuthorityV2(authority);
            await input.authorizeProject();
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority,
                identified: identifiedTemporary,
                maxBytes: input.maxBytes,
              }),
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority,
                identified: identifiedNamed,
                maxBytes: input.maxBytes,
              }),
            ]);
            await fs.rm(temporaryFile);
            await syncDirectoryAuthorityV2(authority);
          } catch (error) {
            throw storageError(error, 'Studio writer collision residue could not be rolled back');
          }
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: identifiedNamed,
            maxBytes: input.maxBytes,
          });
          removedResidueFiles.add(residue.identified.file);
          removedResidueFiles.add(temporaryFile);
          continue;
        }
        // The durable ready hardlink remains beside the immutable pending record. It is recovery
        // authority if the canonical name is lost; terminal slot cleanup removes its own twin.
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        if (named === null) {
          if (!residue.effective) {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery phase is not committed');
          }
          // eslint-disable-next-line no-await-in-loop
          const action = await input.recoveryAction(residue);
          if (action === 'rollback') {
            // eslint-disable-next-line no-await-in-loop
            await input.authorizeProject();
            // eslint-disable-next-line no-await-in-loop
            await assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            });
            // eslint-disable-next-line no-await-in-loop
            await input.authorizeProject();
            try {
              // eslint-disable-next-line no-await-in-loop
              await fs.rm(residue.identified.file);
            } catch (error) {
              throw storageError(error, 'Studio writer recovery reservation could not be rolled back');
            }
            // eslint-disable-next-line no-await-in-loop
            await syncDirectoryAuthorityV2(authority);
            continue;
          }
          if (action !== 'promote') {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery relation is incomplete');
          }
          // eslint-disable-next-line no-await-in-loop
          await assertPathAbsentV2(namedFile);
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          // Re-prove the phase inode after the asynchronous project/relation fence. A live writer
          // may be completing the same phase concurrently, so exclusive-link EEXIST is accepted
          // only when it already names this exact inode.
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: residue.identified,
            maxBytes: input.maxBytes,
          });
          // Project/schema authority is the terminal cooperative fence before the exclusive link.
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.link(residue.identified.file, namedFile);
          } catch (error) {
            if (!isRecord(error) || error.code !== 'EEXIST') {
              throw storageError(error, 'Studio writer recovery authority could not be promoted');
            }
            // eslint-disable-next-line no-await-in-loop
            const existing = await readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: namedFile,
              maxBytes: input.maxBytes,
            });
            if (
              existing === null ||
              existing.bytes !== residue.identified.bytes ||
              !sameIdentityV2(existing.identity, residue.identified.identity)
            ) {
              throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority changed');
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await syncDirectoryAuthorityV2(authority);
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: { ...residue.identified, file: namedFile },
            maxBytes: input.maxBytes,
          });
        }
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        continue;
      }
      if (residue.family === 'pending' || residue.identified.file.endsWith('.tmp')) {
        // The complete ledger already classified this exact temporary. Never rescan the family:
        // a subprocess may be publishing a different record concurrently.
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        } catch (error) {
          throw storageError(error, 'Studio writer publication residue could not be removed');
        }
        // eslint-disable-next-line no-await-in-loop
        await syncDirectoryAuthorityV2(authority);
        continue;
      }

      const cleanupMatch = /^((?:0|[1-9]\d*)\.slot)\.\d+_\d+\.cleanup$/.exec(path.basename(residue.identified.file));
      let decoded: unknown;
      try {
        decoded = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup residue is malformed');
      }
      const parsed = input.parseSlot(decoded);
      if (
        cleanupMatch?.[1] === undefined ||
        !isCanonicalV2SlotFileName(cleanupMatch[1], input.capacity) ||
        parsed.status !== 'valid'
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup residue is malformed');
      }
      const namedFile = path.join(input.slots.path, cleanupMatch[1]);
      const pendingFile = path.join(input.pending.path, `${input.recordId(parsed.record)}.json`);
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let pending: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        // eslint-disable-next-line no-await-in-loop
        [named, pending] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: pendingFile,
            maxBytes: input.maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio writer slot cleanup authority could not be inspected');
      }
      if (
        named !== null &&
        (named.bytes !== residue.identified.bytes || !sameIdentityV2(named.identity, residue.identified.identity))
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup authority is ambiguous');
      }
      if (pending !== null) {
        let pendingValue: unknown;
        try {
          pendingValue = JSON.parse(pending.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer pending authority is malformed');
        }
        if (!input.validatePending(input.recordId(parsed.record), pendingValue)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer pending authority is malformed');
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await input.authorizeProject();
      // eslint-disable-next-line no-await-in-loop
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.slots,
        identified: residue.identified,
        maxBytes: input.maxBytes,
      });
      if (named !== null) {
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.slots,
          identified: { ...residue.identified, file: namedFile },
          maxBytes: input.maxBytes,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await assertPathAbsentV2(namedFile);
      }
      if (pending !== null) {
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.pending,
          identified: {
            file: pendingFile,
            bytes: pending.bytes,
            identity: pending.identity,
            record: null,
            quarantined: false,
          },
          maxBytes: input.maxBytes,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await assertPathAbsentV2(pendingFile);
      }
      // Project/schema authority is the last awaited fence before changing the captured slot
      // pathname. New writer residues outside this frozen ledger are never consulted or touched.
      // eslint-disable-next-line no-await-in-loop
      await input.authorizeProject();
      try {
        if (named === null && pending !== null) {
          // eslint-disable-next-line no-await-in-loop
          await fs.link(residue.identified.file, namedFile);
          // eslint-disable-next-line no-await-in-loop
          await syncDirectoryAuthorityV2(input.slots);
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.slots,
            identified: { ...residue.identified, file: namedFile },
            maxBytes: input.maxBytes,
          });
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.slots,
            identified: residue.identified,
            maxBytes: input.maxBytes,
          });
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        }
      } catch (error) {
        throw storageError(error, 'Studio writer slot cleanup residue could not be reconciled');
      }
      // eslint-disable-next-line no-await-in-loop
      await syncDirectoryAuthorityV2(input.slots);
    }
  };

  const removeReadyPublicationCompanionV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    named: IdentifiedRecordV2<unknown>;
    maxBytes: number;
    authorize: () => Promise<void>;
  }): Promise<void> => {
    const namedBase = path.basename(input.named.file);
    const entries = await readStableDirectoryEntriesV2(input.authority);
    const candidates = entries.filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.startsWith(`${namedBase}.`) &&
        /^\d+_\d+\.(tmp|ready)$/.test(entry.name.slice(namedBase.length + 1))
    );
    if (candidates.length > 2) {
      throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
    }
    // Remove the durable ready phase before its temporary hardlink. If cleanup is
    // interrupted between the two unlinks, canonical + tmp remains a recoverable
    // state; canonical + ready without its required tmp twin is intentionally not.
    const ordered = candidates.toSorted(
      (left, right) => Number(right.name.endsWith('.ready')) - Number(left.name.endsWith('.ready'))
    );
    for (const candidate of ordered) {
      const companionFile = path.join(input.authority.path, candidate.name);
      // eslint-disable-next-line no-await-in-loop
      const companion = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: companionFile,
        maxBytes: input.maxBytes,
      });
      if (
        companion === null ||
        companion.bytes !== input.named.bytes ||
        !sameIdentityV2(companion.identity, input.named.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
      // eslint-disable-next-line no-await-in-loop
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.named,
        maxBytes: input.maxBytes,
      });
      // eslint-disable-next-line no-await-in-loop
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: {
          file: companionFile,
          bytes: companion.bytes,
          identity: companion.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: input.maxBytes,
      });
      // eslint-disable-next-line no-await-in-loop
      await input.authorize();
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(companionFile);
      // eslint-disable-next-line no-await-in-loop
      await syncDirectoryAuthorityV2(input.authority);
    }
  };

  const cleanupProposalWriterResiduesV2 = async (
    root: string,
    projectId: string,
    ledger: ProposalLedgerV2,
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>
  ): Promise<void> => {
    if (ledger.writerResidues.length === 0) return;
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    await cleanupCapturedWriterResiduesV2({
      root,
      pending: ledger.directories.pending,
      slots: ledger.directories.slots,
      residues: ledger.writerResidues,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      capacity: STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
      parseSlot: parseStudioProposalSlotV2,
      recordId: (slot) => slot.proposalId,
      validatePending: (proposalId, value) =>
        parseStudioProposalRecordV2({ projectId, proposalId, value }).status === 'valid',
      authorizeProject: () => assertProjectSnapshotCurrentV2({ root, snapshot: projectSnapshot }),
      recoveryAction: async (residue) => {
        if (residue.phase !== 'ready' || !residue.effective) return 'retain';
        if (residue.family === 'pending') {
          const proposalId = path.basename(residue.namedFile, '.json');
          const decision = ledger.decisions.get(proposalId);
          const counterpart = decision ?? ledger.slots.get(proposalId)?.[0];
          if (counterpart === undefined) return 'retain';
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: decision === undefined ? ledger.directories.slots : ledger.directories.decisions,
            identified: counterpart,
            maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          });
          return 'promote';
        }
        let value: unknown;
        try {
          value = JSON.parse(residue.identified.bytes) as unknown;
        } catch {
          return 'retain';
        }
        const parsed = parseStudioProposalSlotV2(value);
        if (parsed.status !== 'valid') return 'retain';
        const proposal = ledger.proposals.get(parsed.record.proposalId);
        const decision = ledger.decisions.get(parsed.record.proposalId);
        if (proposal === undefined) {
          await assertPathAbsentV2(path.join(ledger.directories.pending.path, `${parsed.record.proposalId}.json`));
          return 'rollback';
        }
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: ledger.directories.pending,
          identified: proposal,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
        });
        if (decision !== undefined) {
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: ledger.directories.decisions,
            identified: decision,
            maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          });
          return 'rollback';
        }
        return 'promote';
      },
    });
  };

  const readReferenceRequestLedgerV2 = async (input: {
    root: string;
    projectId: string;
    directories: ReferenceRequestDirectoriesV2;
  }): Promise<ReferenceRequestLedgerV2> => {
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const pendingResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.pending,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
      validateRecord: (namedBase, value) => {
        const requestId = namedBase.slice(0, -'.json'.length);
        return parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }).status === 'valid';
      },
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotPublicationResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.slots,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        isCanonicalV2SlotFileName(namedBase, STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT),
      validateRecord: (_namedBase, value) => parseStudioReferenceRequestSlotV2(value).status === 'valid',
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotCleanupResidues = await reconcileOwnedSlotCleanupResiduesV2({
      root: input.root,
      pending: input.directories.pending,
      slots: input.directories.slots,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      capacity: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      recordId: (slot: StudioReferenceRequestSlotV2) => slot.requestId,
      validatePending: (requestId, value) =>
        parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }).status === 'valid',
      parse: parseStudioReferenceRequestSlotV2,
      deferCleanup: true,
    });
    const [decisionResidues, receiptResidues] = await Promise.all([
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.decisions,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const requestId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioReferenceRequestDecisionV2({ projectId: input.projectId, requestId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.receipts,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const handoffId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioReferenceGenerationHandoffReceiptV2({ handoffId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
    ]);
    const [rawPendingEntries, rawDecisionEntries, rawSlotEntries, rawReceiptEntries] = await Promise.all([
      readStableDirectoryEntriesV2(input.directories.pending),
      readStableDirectoryEntriesV2(input.directories.decisions),
      readStableDirectoryEntriesV2(input.directories.slots),
      readStableDirectoryEntriesV2(input.directories.receipts),
    ]);
    const decisionResidueNames = new Set(decisionResidues.map((residue) => path.basename(residue.identified.file)));
    const receiptResidueNames = new Set(receiptResidues.map((residue) => path.basename(residue.identified.file)));
    const pendingResidueNames = new Set(pendingResidues.map((record) => path.basename(record.identified.file)));
    const slotResidueNames = new Set([
      ...slotPublicationResidues.map((record) => path.basename(record.identified.file)),
      ...slotCleanupResidues.map((record) => path.basename(record.identified.file)),
    ]);
    const pendingEntries = rawPendingEntries.filter((entry) => !pendingResidueNames.has(entry.name));
    const slotEntries = rawSlotEntries.filter((entry) => !slotResidueNames.has(entry.name));
    const decisionEntries = rawDecisionEntries.filter((entry) => !decisionResidueNames.has(entry.name));
    const receiptEntries = rawReceiptEntries.filter((entry) => !receiptResidueNames.has(entry.name));
    const requests = new Map<string, IdentifiedRecordV2<StudioReferenceRequestV2>>();
    const decisions = new Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>();
    const slots = new Map<string, IdentifiedRecordV2<StudioReferenceRequestSlotV2>[]>();
    const receipts = new Map<string, IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>>();
    const generationDecisions = new Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>();

    for (const entry of pendingEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio reference request directory');
      }
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId) || requests.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio reference request identity');
      }
      // The reference request ledger is bounded by its slot family.
      // eslint-disable-next-line no-await-in-loop
      const request = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.pending.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }),
      });
      requests.set(requestId, request);
    }
    for (const residue of pendingResidues) {
      if (!residue.effective) continue;
      const requestId = path.basename(residue.namedFile, '.json');
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request recovery record');
      }
      const parsed = parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value });
      if (parsed.status !== 'valid' || requests.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference request recovery record');
      }
      requests.set(requestId, { ...residue.identified, record: parsed.record });
    }
    for (const entry of decisionEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request decision directory');
      }
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId) || decisions.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request decision identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const decision = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.decisions.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceRequestDecisionV2({ projectId: input.projectId, requestId, value }),
      });
      decisions.set(requestId, decision);
    }

    for (const entry of slotEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedSlot = cleanup?.namedFileName ?? entry.name;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !isCanonicalV2SlotFileName(namedSlot, STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request slot directory');
      }
      // eslint-disable-next-line no-await-in-loop
      const slot = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.slots.path, entry.name),
        quarantined,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: parseStudioReferenceRequestSlotV2,
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(slot.identity, cleanup.identity) || sha256Utf8(slot.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference cleanup authority mismatch');
      }
      const held = slots.get(slot.record.requestId) ?? [];
      held.push(slot);
      slots.set(slot.record.requestId, held);
    }
    for (const residue of slotCleanupResidues) {
      if (!residue.effective) continue;
      const effective = { ...residue.identified, quarantined: false };
      const held = slots.get(effective.record.requestId) ?? [];
      held.push(effective);
      slots.set(effective.record.requestId, held);
    }
    for (const residue of slotPublicationResidues) {
      if (!residue.effective) continue;
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference slot recovery record');
      }
      const parsed = parseStudioReferenceRequestSlotV2(value);
      if (parsed.status !== 'valid') {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference slot recovery record');
      }
      const held = slots.get(parsed.record.requestId) ?? [];
      held.push({ ...residue.identified, record: parsed.record });
      slots.set(parsed.record.requestId, held);
    }

    for (const entry of receiptEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference handoff receipt directory');
      }
      const handoffId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(handoffId) || receipts.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference handoff receipt identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const receipt = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.receipts.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceGenerationHandoffReceiptV2({ handoffId, value }),
      });
      receipts.set(handoffId, receipt);
    }
    for (const residue of decisionResidues) {
      if (!residue.effective) continue;
      const requestId = path.basename(residue.namedFile, '.json');
      if (decisions.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference decision publication');
      }
      decisions.set(requestId, residue.identified);
    }
    for (const residue of receiptResidues) {
      if (!residue.effective) continue;
      const handoffId = path.basename(residue.namedFile, '.json');
      if (receipts.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference receipt publication');
      }
      receipts.set(handoffId, residue.identified);
    }

    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    for (const [requestId, decision] of decisions) {
      const request = requests.get(requestId);
      if (request === undefined || decision.record.requestId !== requestId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision has no immutable request');
      }
      if (Date.parse(decision.record.decidedAt) < Date.parse(request.record.createdAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision predates its request');
      }
      if (
        decision.record.outcome.kind === 'expired' &&
        Date.parse(decision.record.decidedAt) <
          Date.parse(request.record.createdAt) + STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision expires its request early');
      }
      if (decision.record.outcome.kind === 'generation_gate') {
        const outcome = decision.record.outcome;
        if (
          outcome.referenceIds.length !== request.record.referenceIds.length ||
          !outcome.referenceIds.every((referenceId, index) => referenceId === request.record.referenceIds[index]) ||
          generationDecisions.has(outcome.handoffId)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference generation handoff');
        }
        generationDecisions.set(outcome.handoffId, decision);
      }
    }
    for (const [handoffId, receipt] of receipts) {
      const decision = generationDecisions.get(handoffId);
      if (
        decision === undefined ||
        decision.record.requestId !== receipt.record.requestId ||
        Date.parse(receipt.record.completedAt) < Date.parse(decision.record.decidedAt)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt has no exact decision');
      }
    }
    for (const [requestId, held] of slots) {
      if (held.length > 1) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference request slot authority');
      }
      const request = requests.get(requestId);
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      if (
        request !== undefined &&
        (decision === undefined || (decision.outcome.kind === 'generation_gate' && !receipt))
      ) {
        if (held[0].quarantined) {
          throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request slot is quarantined');
        }
      }
    }
    for (const requestId of requests.keys()) {
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      const live = decision === undefined || (decision.outcome.kind === 'generation_gate' && receipt === undefined);
      if (!live) continue;
      const held = slots.get(requestId) ?? [];
      if (held.length !== 1 || held[0].quarantined) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Pending Studio reference request has no exact slot authority'
        );
      }
    }
    for (const [requestId, request] of requests) {
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      const requiresSlot =
        decision === undefined || (decision.outcome.kind === 'generation_gate' && receipt === undefined);
      if (requiresSlot && slots.get(requestId)?.length !== 1) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request has no exact slot');
      }
      if (request.record.projectId !== input.projectId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference request project authority mismatch');
      }
    }
    const liveCount = [...requests.keys()].filter((requestId) => {
      const decision = decisions.get(requestId)?.record;
      return (
        decision === undefined ||
        (decision.outcome.kind === 'generation_gate' && !receipts.has(decision.outcome.handoffId))
      );
    }).length;
    // Immutable terminal relations are retained as audit history. Only requests
    // which still hold a slot participate in the live reference-request cap.
    if (liveCount > STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio reference request ledger exceeds capacity');
    }
    return {
      directories: input.directories,
      requests,
      decisions,
      slots,
      receipts,
      generationDecisions,
      journalResidues: [
        ...decisionResidues.map((residue) => Object.assign({ family: `decisions` as const }, residue)),
        ...receiptResidues.map((residue) => Object.assign({ family: `receipts` as const }, residue)),
      ],
      writerResidues: [
        ...pendingResidues.map((residue) => Object.assign({ family: `pending` as const }, residue)),
        ...slotPublicationResidues.map((residue) => Object.assign({ family: `slots` as const }, residue)),
        ...slotCleanupResidues.map(({ identified, namedFile }) => ({
          family: 'slots' as const,
          identified: { ...identified, record: null } as IdentifiedRecordV2<null>,
          namedFile,
          phase: 'cleanup' as const,
          effective: true,
        })),
      ],
    };
  };

  const assertReferenceRequestLedgerEntrySetCurrentV2 = async (
    ledger: ReferenceRequestLedgerV2,
    publication?: {
      decision?: IdentifiedRecordV2<null>;
      receipt?: IdentifiedRecordV2<null>;
    }
  ): Promise<void> => {
    const root = path.dirname(ledger.directories.project.path);
    const assertEntries = async (
      authority: DirectoryAuthorityV2,
      records: readonly IdentifiedRecordV2<unknown>[]
    ): Promise<void> => {
      const expected = new Map(records.map((record) => [path.basename(record.file), record]));
      const entries = await readStableDirectoryEntriesV2(authority);
      const observed = new Set<string>();
      for (const entry of entries) {
        const identified = expected.get(entry.name);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
        }
        if (identified === undefined) {
          const named = entry.name.endsWith('.publish')
            ? expected.get(entry.name.slice(0, -'.publish'.length))
            : undefined;
          if (named === undefined) {
            throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
          }
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: { ...named, file: path.join(authority.path, entry.name) },
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
          continue;
        }
        observed.add(entry.name);
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root,
          authority,
          identified,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
      }
      if ([...expected.keys()].some((name) => !observed.has(name))) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
      }
      await assertDirectoryAuthorityV2(authority);
    };
    await Promise.all([
      assertEntries(ledger.directories.pending, [
        ...ledger.requests.values(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'pending').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.decisions, [
        ...ledger.decisions.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'decisions')
          .map((residue) => residue.identified),
        ...(publication?.decision === undefined ? [] : [publication.decision]),
      ]),
      assertEntries(ledger.directories.slots, [
        ...[...ledger.slots.values()].flat(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'slots').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.receipts, [
        ...ledger.receipts.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'receipts')
          .map((residue) => residue.identified),
        ...(publication?.receipt === undefined ? [] : [publication.receipt]),
      ]),
    ]);
    await assertReferenceRequestDirectoryAuthoritiesV2(ledger.directories);
  };

  const cleanupReferenceJournalPublicationResiduesV2 = async (
    root: string,
    ledger: ReferenceRequestLedgerV2,
    authorizeProject: () => Promise<void>
  ): Promise<ReferenceRequestLedgerV2> => {
    const current: ReferenceRequestLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions),
      receipts: new Map(ledger.receipts),
      generationDecisions: new Map(ledger.generationDecisions),
      journalResidues: [...ledger.journalResidues],
    };
    for (const residue of ledger.journalResidues) {
      const authority = current.directories[residue.family];
      await assertReferenceRequestLedgerEntrySetCurrentV2(current);
      if (residue.family === 'decisions') {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) {
          current.decisions.set(residue.identified.record.requestId, named);
          if (residue.identified.record.outcome.kind === 'generation_gate') {
            current.generationDecisions.set(residue.identified.record.outcome.handoffId, named);
          }
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) current.receipts.set(residue.identified.record.handoffId, named);
      }
      current.journalResidues = current.journalResidues.map((candidate) =>
        candidate.identified.file === residue.identified.file ? { ...candidate, effective: false } : candidate
      );
    }
    return current;
  };

  const cleanupReferenceWriterResiduesV2 = async (
    root: string,
    projectId: string,
    ledger: ReferenceRequestLedgerV2,
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>
  ): Promise<void> => {
    if (ledger.writerResidues.length === 0) return;
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await cleanupCapturedWriterResiduesV2({
      root,
      pending: ledger.directories.pending,
      slots: ledger.directories.slots,
      residues: ledger.writerResidues,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      capacity: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      parseSlot: parseStudioReferenceRequestSlotV2,
      recordId: (slot) => slot.requestId,
      validatePending: (requestId, value) =>
        parseStudioReferenceRequestV2({ projectId, requestId, value }).status === 'valid',
      authorizeProject: () => assertProjectSnapshotCurrentV2({ root, snapshot: projectSnapshot }),
      recoveryAction: async (residue) => {
        if (residue.phase !== 'ready' || !residue.effective) return 'retain';
        if (residue.family === 'pending') {
          const requestId = path.basename(residue.namedFile, '.json');
          const decision = ledger.decisions.get(requestId);
          const receipt =
            decision?.record.outcome.kind === 'generation_gate'
              ? ledger.receipts.get(decision.record.outcome.handoffId)
              : undefined;
          const counterpart =
            decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined)
              ? ledger.slots.get(requestId)?.[0]
              : (receipt ?? decision);
          if (counterpart === undefined) return 'retain';
          const authority =
            decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined)
              ? ledger.directories.slots
              : receipt === undefined
                ? ledger.directories.decisions
                : ledger.directories.receipts;
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: counterpart,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
          return 'promote';
        }
        let value: unknown;
        try {
          value = JSON.parse(residue.identified.bytes) as unknown;
        } catch {
          return 'retain';
        }
        const parsed = parseStudioReferenceRequestSlotV2(value);
        if (parsed.status !== 'valid') return 'retain';
        const request = ledger.requests.get(parsed.record.requestId);
        const decision = ledger.decisions.get(parsed.record.requestId);
        const receipt =
          decision?.record.outcome.kind === 'generation_gate'
            ? ledger.receipts.get(decision.record.outcome.handoffId)
            : undefined;
        if (request === undefined) {
          await assertPathAbsentV2(path.join(ledger.directories.pending.path, `${parsed.record.requestId}.json`));
          return 'rollback';
        }
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: ledger.directories.pending,
          identified: request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
        const live =
          decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined);
        if (live) return 'promote';
        const terminal = receipt ?? decision;
        if (terminal !== undefined) {
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: receipt === undefined ? ledger.directories.decisions : ledger.directories.receipts,
            identified: terminal,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
        }
        return 'rollback';
      },
    });
  };

  const assertIdentifiedRecordCurrentV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    identified: IdentifiedRecordV2<unknown>;
    maxBytes?: number;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    await assertDirectoryAuthorityV2(input.authority);
    let current: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.identified.file,
        maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal authority changed');
    }
    if (
      current === null ||
      current.bytes !== input.identified.bytes ||
      !sameIdentityV2(current.identity, input.identified.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal authority changed');
    }
    await assertDirectoryAuthorityV2(input.authority);
  };

  const quarantineRemoveIdentifiedRecordV2 = async <RecordType>(input: {
    root: string;
    authority: DirectoryAuthorityV2;
    identified: IdentifiedRecordV2<RecordType>;
    authorize: () => Promise<void>;
    maxBytes?: number;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    let quarantineFile = input.identified.file;
    if (!input.identified.quarantined) {
      quarantineFile = identityBoundCleanupNameV2(input.identified);
      await assertIdentifiedRecordCurrentV2({ ...input, maxBytes });
      await input.authorize();
      await Promise.all([assertIdentifiedRecordCurrentV2({ ...input, maxBytes }), assertPathAbsentV2(quarantineFile)]);
      await input.authorize();
      try {
        await fs.rename(input.identified.file, quarantineFile);
      } catch (error) {
        throw storageError(error, 'Studio proposal record could not be quarantined');
      }
      await syncDirectoryAuthorityV2(input.authority);
      const renamed: IdentifiedRecordV2<RecordType> = {
        ...input.identified,
        file: quarantineFile,
        quarantined: true,
      };
      try {
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: renamed,
          maxBytes,
        });
      } catch (error) {
        try {
          await Promise.all([assertDirectoryAuthorityV2(input.authority), assertPathAbsentV2(input.identified.file)]);
          await fs.rename(quarantineFile, input.identified.file);
          await syncDirectoryAuthorityV2(input.authority);
        } catch (restoreError) {
          throw storageError(restoreError, 'Studio proposal quarantine replacement could not be restored');
        }
        if (error instanceof CreativeStudioStoreError) throw error;
        throw storageError(error, 'Studio proposal record changed while being quarantined');
      }
    }

    const quarantined: IdentifiedRecordV2<RecordType> = {
      ...input.identified,
      file: quarantineFile,
      quarantined: true,
    };
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: quarantined,
      maxBytes,
    });
    await input.authorize();
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: quarantined,
      maxBytes,
    });
    await input.authorize();
    try {
      await fs.rm(quarantineFile);
    } catch (error) {
      throw storageError(error, 'Studio proposal quarantine could not be removed');
    }
    await syncDirectoryAuthorityV2(input.authority);
  };

  const effectiveProposalV2 = (
    proposal: StudioProposalRecordV2,
    decision: StudioProposalDecisionV2 | undefined
  ): StudioProposalV2 =>
    decision === undefined
      ? proposal
      : {
          ...proposal,
          status: decision.status,
          decidedAt: decision.decidedAt,
        };

  const operationCreatedIdentityOrderV2 = (input: {
    proposal: StudioProposalRecordV2;
    existingBeatIds?: ReadonlySet<string>;
    existingShotIds?: ReadonlySet<string>;
    createdBeatEvidence?: ReadonlySet<string>;
    createdShotEvidence?: ReadonlySet<string>;
  }): { createdBeatIds: string[]; createdShotIds: string[] } => {
    if (input.proposal.payload.kind !== 'mutation_batch') return { createdBeatIds: [], createdShotIds: [] };
    const beats = new Set(input.existingBeatIds ?? []);
    const shots = new Set(input.existingShotIds ?? []);
    const createdBeatIds: string[] = [];
    const createdShotIds: string[] = [];
    const considerBeat = (beatId: string): void => {
      const isCreated = input.createdBeatEvidence?.has(beatId) ?? !beats.has(beatId);
      if (isCreated && !createdBeatIds.includes(beatId)) createdBeatIds.push(beatId);
      beats.add(beatId);
    };
    const considerShot = (shotId: string): void => {
      const isCreated = input.createdShotEvidence?.has(shotId) ?? !shots.has(shotId);
      if (isCreated && !createdShotIds.includes(shotId)) createdShotIds.push(shotId);
      shots.add(shotId);
    };
    for (const operation of input.proposal.payload.operations) {
      if (operation.kind === 'add_beat' || operation.kind === 'add_binned_beat') considerBeat(operation.beatId);
      else if (operation.kind === 'add_shot') considerShot(operation.shotId);
      else if (operation.kind === 'apply_coverage') {
        for (const shot of operation.shots) considerShot(shot.shotId);
      }
    }
    return { createdBeatIds, createdShotIds };
  };

  const sameOrderedIdsV2 = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((id, index) => id === right[index]);

  const assertAttributionCreatedIdsV2 = (input: {
    attribution: StudioProposalCommitAttributionV2;
    proposal: StudioProposalRecordV2;
    project: StudioProjectV2;
    state: 'before' | 'after';
  }): void => {
    if (input.attribution.kind === 'paid_recovery') {
      if (
        input.proposal.payload.kind !== 'paid_recovery' ||
        input.attribution.authorizationId === null ||
        input.attribution.createdBeatIds.length !== 0 ||
        input.attribution.createdShotIds.length !== 0
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution scope mismatch');
      }
      const matching = input.project.spendAuthorizations.filter(
        (authorization) => authorization.id === input.attribution.authorizationId
      );
      if (input.state === 'before') {
        if (matching.length !== 0) {
          throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery authorization predates commit');
        }
      } else if (matching.length !== 1 || matching[0]?.confirmedAt !== input.attribution.decidedAt) {
        throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery authorization proof mismatch');
      }
      return;
    }
    if (input.proposal.payload.kind === 'paid_recovery' || input.attribution.authorizationId !== null) {
      throw new CreativeStudioStoreError('storage_error', 'Studio mutation attribution scope mismatch');
    }
    let expected: { createdBeatIds: string[]; createdShotIds: string[] };
    if (input.state === 'before') {
      expected = operationCreatedIdentityOrderV2({
        proposal: input.proposal,
        existingBeatIds: new Set(Object.keys(input.project.beats)),
        existingShotIds: new Set(Object.keys(input.project.shots)),
      });
    } else {
      const undo = input.project.undoHistory.at(-1);
      if (
        undo === undefined ||
        undo.id !== input.proposal.id ||
        undo.sourceRevision !== input.attribution.appliedRevision
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Studio proposal attribution has no matching undo authority'
        );
      }
      const createdBeatEvidence = new Set(
        undo.patches
          .filter((patch) => patch.kind === 'beat_fields' && patch.before === null)
          .map((patch) => (patch.kind === 'beat_fields' ? patch.beatId : ''))
      );
      const createdShotEvidence = new Set(
        undo.patches
          .filter((patch) => patch.kind === 'shot_fields' && patch.before === null)
          .map((patch) => (patch.kind === 'shot_fields' ? patch.shotId : ''))
      );
      expected = operationCreatedIdentityOrderV2({
        proposal: input.proposal,
        createdBeatEvidence,
        createdShotEvidence,
      });
      if (
        expected.createdBeatIds.length !== createdBeatEvidence.size ||
        expected.createdShotIds.length !== createdShotEvidence.size
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution created identities mismatch');
      }
    }
    if (
      !sameOrderedIdsV2(input.attribution.createdBeatIds, expected.createdBeatIds) ||
      !sameOrderedIdsV2(input.attribution.createdShotIds, expected.createdShotIds)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution created identities mismatch');
    }
  };

  const assertPathAbsentV2 = async (file: string): Promise<void> => {
    try {
      await fs.lstat(file);
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal authority changed');
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Studio proposal authority could not be verified');
      }
    }
  };

  const {
    deleteSupportedProjectV2InsideQueue,
    finishProjectDeletionV2,
    projectDeletionPathsV2,
    readProjectDeletionMarkerV2,
  } = createStudioDeletionAuthorityV2({
    fs,
    maxProjectBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
    resolveRootChild,
    captureDirectoryAuthority: captureDirectoryAuthorityV2,
    assertDirectoryAuthority: assertDirectoryAuthorityV2,
    syncDirectoryAuthority: syncDirectoryAuthorityV2,
    assertPathAbsent: assertPathAbsentV2,
    assertProjectSnapshotCurrent: assertProjectSnapshotCurrentV2,
    assertIdentifiedRecordCurrent: (input) => assertIdentifiedRecordCurrentV2(input),
    publishImmutableJournalRecord: (input) => publishImmutableJournalRecordV2(input),
    inspectProjectFile: (root, projectId) => inspectProjectFileV2(root, projectId),
    requireSupportedProjectInspection: (inspected) => requireSupportedProjectInspectionV2(inspected),
    summariesFile: summariesFileV2,
    storageError,
  });

  const publishProposalDecisionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
    proposal: IdentifiedRecordV2<StudioProposalRecordV2>;
    status: StudioProposalDecisionV2['status'];
    decidedAt: string;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioProposalDecisionV2>> => {
    if (Date.parse(input.decidedAt) < Date.parse(input.proposal.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision predates its proposal');
    }
    const decision: StudioProposalDecisionV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      proposalId: input.proposal.record.id,
      status: input.status,
      decidedAt: input.decidedAt,
    };
    const file = path.join(input.directories.decisions.path, `${input.proposal.record.id}.json`);
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.directories.pending,
      identified: input.proposal,
    });
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.decisions,
      file,
      bytes: serializeJsonExact(decision),
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      parse: (value) => parseStudioProposalDecisionV2({ proposalId: decision.proposalId, value }),
    });
    if (
      published.record.status !== decision.status ||
      published.record.decidedAt !== decision.decidedAt ||
      published.bytes !== serializeJsonExact(decision)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal decision changed at publication');
    }
    return published;
  };

  const releaseProposalSlotV2 = async (input: {
    root: string;
    ledger: ProposalLedgerV2;
    proposal: IdentifiedRecordV2<StudioProposalRecordV2>;
    decision: IdentifiedRecordV2<StudioProposalDecisionV2>;
    slot: IdentifiedRecordV2<StudioProposalSlotV2> | undefined;
    projectSnapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<void> => {
    if (input.slot === undefined) return;
    const authorize = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(input.ledger.directories);
      if (input.projectSnapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      }
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.pending,
          identified: input.proposal,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.decisions,
          identified: input.decision,
        }),
      ]);
      if (input.projectSnapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      }
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
    });
  };

  const resolveProposalAttributionV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<Extract<ProjectFileInspectionV2, { status: 'supported' }>> => {
    const directories = await resolveProposalDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: false,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return input.snapshot;
    }
    let ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    const effectiveAcceptedDecisions = ledger.journalResidues.filter(
      (residue) =>
        residue.family === 'decisions' && residue.effective && residue.identified.record.status === 'accepted'
    );
    if (
      effectiveAcceptedDecisions.some((residue) => {
        const attribution = ledger.attributions[0]?.record;
        return (
          attribution === undefined ||
          attribution.proposalId !== residue.identified.record.proposalId ||
          attribution.decidedAt !== residue.identified.record.decidedAt
        );
      })
    ) {
      throw new CreativeStudioStoreError(
        'storage_error',
        'Studio accepted proposal decision has no exact commit attribution'
      );
    }
    if (ledger.attributions.length === 0) {
      ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
      );
      await Promise.all([
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
        assertProposalLedgerEntrySetCurrentV2(ledger),
      ]);
      if (ledger.writerResidues.length > 0) {
        await cleanupProposalWriterResiduesV2(input.root, input.projectId, ledger, input.snapshot);
        ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
        await Promise.all([
          assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
          assertProposalLedgerEntrySetCurrentV2(ledger),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      }
      return input.snapshot;
    }

    const identifiedAttribution = ledger.attributions[0];
    const attribution = identifiedAttribution.record;
    const proposal = ledger.proposals.get(attribution.proposalId);
    const decision = ledger.decisions.get(attribution.proposalId);
    const heldSlots = ledger.slots.get(attribution.proposalId) ?? [];
    const slot = heldSlots[0];
    if (
      proposal === undefined ||
      proposal.record.baseRevision !== attribution.baseRevision ||
      Date.parse(attribution.decidedAt) < Date.parse(proposal.record.createdAt) ||
      heldSlots.length !== 1 ||
      slot === undefined ||
      slot.record.proposalId !== attribution.proposalId ||
      slot.quarantined
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution authority mismatch');
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
      ...(decision === undefined
        ? []
        : [
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.decisions,
              identified: decision,
            }),
          ]),
    ]);
    await assertProposalDirectoryAuthoritiesV2(directories);

    const projectDigest = sha256Utf8(input.snapshot.bytes);
    const isExactBefore =
      input.snapshot.project.revision === attribution.baseRevision && projectDigest === attribution.beforeProjectSha256;
    const isExactAfter =
      input.snapshot.project.revision === attribution.appliedRevision &&
      projectDigest === attribution.afterProjectSha256;
    if (isExactBefore === isExactAfter) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution project facts mismatch');
    }

    if (isExactBefore) {
      if (decision !== undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Uncommitted Studio proposal has a terminal decision');
      }
      assertAttributionCreatedIdsV2({
        attribution,
        proposal: proposal.record,
        project: input.snapshot.project,
        state: 'before',
      });
      ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
      );
      await Promise.all([
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
        assertProposalLedgerEntrySetCurrentV2(ledger),
      ]);
      const cleanedAttribution = ledger.attributions[0];
      if (cleanedAttribution === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution disappeared during repair');
      }
      const authorize = async (): Promise<void> => {
        await assertProposalDirectoryAuthoritiesV2(directories);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
          assertPathAbsentV2(path.join(directories.decisions.path, `${attribution.proposalId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      };
      await removeJournalPublicationCompanionV2({
        root: input.root,
        authority: directories.commits,
        named: cleanedAttribution,
        maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
        authorize,
      });
      await quarantineRemoveIdentifiedRecordV2({
        root: input.root,
        authority: directories.commits,
        identified: cleanedAttribution,
        authorize,
      });
      const fresh = await inspectProjectFileV2(input.root, input.projectId);
      if (fresh.status !== 'supported') {
        throw new CreativeStudioStoreError('storage_error', 'Studio project authority changed during proposal repair');
      }
      const postRepairLedger = await readProposalLedgerV2({
        root: input.root,
        projectId: input.projectId,
        directories,
      });
      await assertProposalLedgerEntrySetCurrentV2(postRepairLedger);
      await cleanupProposalWriterResiduesV2(input.root, input.projectId, postRepairLedger, fresh);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: fresh });
      return fresh;
    }

    const effectiveDecisionResidue = ledger.journalResidues.some(
      (residue) =>
        residue.family === 'decisions' &&
        residue.effective &&
        residue.identified.record.proposalId === attribution.proposalId
    );
    if (
      input.snapshot.project.updatedAt !== attribution.decidedAt ||
      (identifiedAttribution.quarantined && (decision === undefined || effectiveDecisionResidue))
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Committed Studio proposal attribution timestamp mismatch');
    }
    assertAttributionCreatedIdsV2({
      attribution,
      proposal: proposal.record,
      project: input.snapshot.project,
      state: 'after',
    });
    let acceptedDecision = decision;
    if (acceptedDecision !== undefined) {
      if (
        acceptedDecision.record.status !== 'accepted' ||
        acceptedDecision.record.decidedAt !== attribution.decidedAt
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution decision mismatch');
      }
    }
    ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertProposalLedgerEntrySetCurrentV2(ledger),
    ]);
    const cleanedAttribution = ledger.attributions[0];
    if (cleanedAttribution === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution disappeared during repair');
    }
    acceptedDecision = ledger.decisions.get(attribution.proposalId);
    if (acceptedDecision === undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await assertProposalDirectoryAuthoritiesV2(directories);
      acceptedDecision = await publishProposalDecisionV2({
        root: input.root,
        projectId: input.projectId,
        directories,
        proposal,
        status: 'accepted',
        decidedAt: attribution.decidedAt,
        authorizeBeforeLink: async (temporary) => {
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          await assertProposalLedgerEntrySetCurrentV2(ledger, { decision: temporary });
          await Promise.all([
            assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
            assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.commits,
              identified: cleanedAttribution,
            }),
            assertPathAbsentV2(path.join(directories.decisions.path, `${attribution.proposalId}.json`)),
          ]);
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        },
      });
    }
    const resolvedLedger: ProposalLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions).set(attribution.proposalId, acceptedDecision),
    };
    await assertProposalLedgerEntrySetCurrentV2(resolvedLedger);

    const authorizeAttributionCleanup = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.decisions,
          identified: acceptedDecision,
        }),
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeJournalPublicationCompanionV2({
      root: input.root,
      authority: directories.commits,
      named: cleanedAttribution,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize: authorizeAttributionCleanup,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: directories.commits,
      identified: cleanedAttribution,
      authorize: authorizeAttributionCleanup,
    });
    const repairedLedger: ProposalLedgerV2 = { ...resolvedLedger, attributions: [] };
    await releaseProposalSlotV2({
      root: input.root,
      ledger: repairedLedger,
      proposal,
      decision: acceptedDecision,
      slot,
      projectSnapshot: input.snapshot,
    });
    const fresh = await inspectProjectFileV2(input.root, input.projectId);
    if (fresh.status !== 'supported') {
      throw new CreativeStudioStoreError('storage_error', 'Studio project authority changed during proposal repair');
    }
    const postRepairLedger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    await assertProposalLedgerEntrySetCurrentV2(postRepairLedger);
    await cleanupProposalWriterResiduesV2(input.root, input.projectId, postRepairLedger, fresh);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: fresh });
    return fresh;
  };

  const isReferenceGenerationDecisionV2 = (
    decision: StudioReferenceRequestDecisionV2
  ): decision is StudioReferenceGenerationDecisionV2 => decision.outcome.kind === 'generation_gate';

  const publishReferenceRequestDecisionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ReferenceRequestDirectoriesV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    outcome: StudioReferenceRequestDecisionV2['outcome'];
    decidedAt: string;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioReferenceRequestDecisionV2>> => {
    const decision: StudioReferenceRequestDecisionV2 = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      requestId: input.request.record.id,
      projectId: input.projectId,
      decidedAt: input.decidedAt,
      outcome: structuredClone(input.outcome),
    };
    const bytes = serializeJsonExact(decision);
    const file = path.join(input.directories.decisions.path, `${decision.requestId}.json`);
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.decisions,
      file,
      bytes,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      parse: (value) =>
        parseStudioReferenceRequestDecisionV2({
          projectId: input.projectId,
          requestId: decision.requestId,
          value,
        }),
    });
    if (published.bytes !== bytes) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision changed at publication');
    }
    return published;
  };

  const publishReferenceGenerationHandoffReceiptV2 = async (input: {
    root: string;
    directories: ReferenceRequestDirectoriesV2;
    receipt: StudioReferenceGenerationHandoffReceiptV2;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>> => {
    const bytes = serializeJsonExact(input.receipt);
    const file = path.join(input.directories.receipts.path, `${input.receipt.handoffId}.json`);
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.receipts,
      file,
      bytes,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      parse: (value) => parseStudioReferenceGenerationHandoffReceiptV2({ handoffId: input.receipt.handoffId, value }),
    });
    if (published.bytes !== bytes) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt changed at publication');
    }
    return published;
  };

  const assertPendingReferenceRequestSlotV2 = (
    ledger: ReferenceRequestLedgerV2,
    requestId: string
  ): IdentifiedRecordV2<StudioReferenceRequestSlotV2> => {
    const held = ledger.slots.get(requestId) ?? [];
    if (held.length !== 1 || held[0].quarantined) {
      throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request has no exact slot');
    }
    return held[0];
  };

  const releaseReferenceRequestSlotV2 = async (input: {
    root: string;
    ledger: ReferenceRequestLedgerV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
    receipt?: IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2> | undefined;
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<void> => {
    if (input.slot === undefined) return;
    const authorize = async (): Promise<void> => {
      await assertReferenceRequestDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.pending,
          identified: input.request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.decisions,
          identified: input.decision,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        ...(input.receipt === undefined
          ? []
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.ledger.directories.receipts,
                identified: input.receipt,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
            ]),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
  };

  const referenceAuthorizationByHandoffV2 = (
    project: StudioProjectV2
  ): Map<string, StudioProjectV2['spendAuthorizations'][number]> => {
    const authorizations = new Map<string, StudioProjectV2['spendAuthorizations'][number]>();
    for (const authorization of project.spendAuthorizations) {
      const handoffId = authorization.originReferenceHandoffId;
      if (handoffId === null) continue;
      if (authorizations.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference authorization origin');
      }
      authorizations.set(handoffId, authorization);
    }
    return authorizations;
  };

  const assertReferenceAuthorizationRelationsV2 = (input: {
    project: StudioProjectV2;
    ledger: ReferenceRequestLedgerV2;
  }): Array<{
    handoffId: string;
    authorization: StudioProjectV2['spendAuthorizations'][number];
    decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  }> => {
    const authorizations = referenceAuthorizationByHandoffV2(input.project);
    const missing: Array<{
      handoffId: string;
      authorization: StudioProjectV2['spendAuthorizations'][number];
      decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
      request: IdentifiedRecordV2<StudioReferenceRequestV2>;
      slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
    }> = [];
    for (const [handoffId, authorization] of authorizations) {
      const decision = input.ledger.generationDecisions.get(handoffId);
      if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization has no reference handoff decision');
      }
      const generationOutcome = decision.record.outcome;
      const request = input.ledger.requests.get(decision.record.requestId);
      if (request === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference request is missing');
      }
      if (
        authorization.cascadeItems.length !== 0 ||
        authorization.baseItems.length !== generationOutcome.referenceIds.length ||
        Date.parse(authorization.confirmedAt) < Date.parse(decision.record.decidedAt) ||
        !authorization.baseItems.every(
          (item, index) =>
            item.purpose === 'reference_image' &&
            item.target.kind === 'reference' &&
            item.target.referenceId === generationOutcome.referenceIds[index] &&
            (item.generationCount === 1 || item.generationCount === 2) &&
            item.requestPlan.kind === 'resolved' &&
            item.requestPlan.snapshot.referenceInputs.length === 0
        )
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference handoff scope mismatch');
      }
      const receipt = input.ledger.receipts.get(handoffId);
      if (receipt === undefined) {
        missing.push({
          handoffId,
          authorization,
          decision,
          request,
          slot: assertPendingReferenceRequestSlotV2(input.ledger, request.record.id),
        });
      } else if (
        receipt.record.result.kind !== 'confirmed' ||
        receipt.record.result.authorizationId !== authorization.id ||
        receipt.record.completedAt !== authorization.confirmedAt
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference receipt mismatch');
      }
    }
    for (const [handoffId, receipt] of input.ledger.receipts) {
      const authorization = authorizations.get(handoffId);
      if (receipt.record.result.kind === 'dismissed') {
        if (authorization !== undefined) {
          throw new CreativeStudioStoreError('storage_error', 'Dismissed Studio reference handoff has authorization');
        }
      } else if (
        authorization === undefined ||
        receipt.record.result.authorizationId !== authorization.id ||
        receipt.record.completedAt !== authorization.confirmedAt
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Confirmed Studio reference handoff has no exact authorization'
        );
      }
    }
    return missing;
  };

  const resolveReferenceAuthorizationReceiptsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<Extract<ProjectFileInspectionV2, { status: 'supported' }>> => {
    const directories = await resolveReferenceRequestDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: false,
    });
    if (directories === null) {
      if (input.snapshot.project.spendAuthorizations.some((authorization) => authorization.originReferenceHandoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference authorization ledger is missing');
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return input.snapshot;
    }
    let ledger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    let missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    const activeReferencePositions = new Map(
      input.snapshot.project.referenceOrder.map((referenceId, index) => [referenceId, index])
    );
    for (const residue of ledger.journalResidues) {
      if (residue.family !== 'decisions' || !residue.effective) continue;
      const decision = residue.identified.record;
      const request = ledger.requests.get(decision.requestId);
      if (request === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision has no immutable request');
      }
      if (decision.outcome.kind === 'generation_gate') {
        let previous = -1;
        for (const referenceId of request.record.referenceIds) {
          const reference = Object.hasOwn(input.snapshot.project.references, referenceId)
            ? input.snapshot.project.references[referenceId]
            : undefined;
          const position = activeReferencePositions.get(referenceId);
          if (reference?.id !== referenceId || position === undefined || position <= previous) {
            throw new CreativeStudioStoreError(
              'storage_error',
              'Studio reference generation publication is no longer active'
            );
          }
          previous = position;
        }
      }
    }
    ledger = await cleanupReferenceJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    for (const repair of missing) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.pending,
          identified: repair.request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.decisions,
          identified: repair.decision,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.slots,
          identified: repair.slot,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertPathAbsentV2(path.join(directories.receipts.path, `${repair.handoffId}.json`)),
      ]);
      const receiptRecord: StudioReferenceGenerationHandoffReceiptV2 = {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        handoffId: repair.handoffId,
        requestId: repair.request.record.id,
        completedAt: repair.authorization.confirmedAt,
        result: { kind: 'confirmed', authorizationId: repair.authorization.id },
      };
      // A project has a bounded authorization ledger and repairs remain sequentially attributable.
      // eslint-disable-next-line no-await-in-loop
      const receipt = await publishReferenceGenerationHandoffReceiptV2({
        root: input.root,
        directories,
        receipt: receiptRecord,
        authorizeBeforeLink: async (temporary) => {
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { receipt: temporary });
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.pending,
              identified: repair.request,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.decisions,
              identified: repair.decision,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.slots,
              identified: repair.slot,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertPathAbsentV2(path.join(directories.receipts.path, `${repair.handoffId}.json`)),
          ]);
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        },
      });
      ledger = { ...ledger, receipts: new Map(ledger.receipts).set(repair.handoffId, receipt) };
      await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      // eslint-disable-next-line no-await-in-loop
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request: repair.request,
        decision: repair.decision,
        receipt,
        slot: repair.slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(repair.request.record.id);
      ledger = { ...ledger, slots };
    }
    for (const [handoffId, receipt] of ledger.receipts) {
      const decision = ledger.generationDecisions.get(handoffId);
      if (decision === undefined) continue;
      const request = ledger.requests.get(decision.record.requestId);
      const slot = ledger.slots.get(decision.record.requestId)?.[0];
      if (request === undefined || slot === undefined) continue;
      // eslint-disable-next-line no-await-in-loop
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request,
        decision,
        receipt,
        slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(request.record.id);
      ledger = { ...ledger, slots };
    }
    const postRepairLedger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger: postRepairLedger });
    await cleanupReferenceWriterResiduesV2(input.root, input.projectId, postRepairLedger, input.snapshot);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return input.snapshot;
  };

  const inspectProjectWithAttributionFenceV2InsideQueue = async (
    root: string,
    projectId: string
  ): Promise<ProjectFileInspectionV2> => {
    const deletion = await readProjectDeletionMarkerV2(root, projectId);
    if (deletion !== null) {
      const paths = projectDeletionPathsV2(root, projectId);
      let liveTarget = false;
      let quarantine = false;
      try {
        await fs.lstat(paths.projectDirectory);
        liveTarget = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio pending deletion target could not be inspected');
        }
      }
      try {
        await fs.lstat(paths.quarantineDirectory);
        quarantine = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio pending deletion quarantine could not be inspected');
        }
      }
      if (liveTarget && !quarantine) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion requires an explicit retry');
      }
      await finishProjectDeletionV2(root, deletion);
      return { status: 'not_found', projectId };
    }
    const inspected = await inspectProjectFileV2(root, projectId);
    if (inspected.status !== 'supported') return inspected;
    const proposalResolved = await resolveProposalAttributionV2InsideQueue({ root, projectId, snapshot: inspected });
    const referenceResolved = await resolveReferenceAuthorizationReceiptsV2InsideQueue({
      root,
      projectId,
      snapshot: proposalResolved,
    });
    return synchronizeBriefFileV2InsideQueue(root, referenceResolved);
  };

  const inspectProjectThroughAttributionFenceV2 = (root: string, projectId: string): Promise<ProjectFileInspectionV2> =>
    enqueue(projectId, () => inspectProjectWithAttributionFenceV2InsideQueue(root, projectId));

  const requireSupportedProjectInspectionV2 = (
    inspected: ProjectFileInspectionV2
  ): Extract<ProjectFileInspectionV2, { status: 'supported' }> => {
    if (inspected.status === 'supported') return inspected;
    if (inspected.status === 'not_found') {
      throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    }
    if (inspected.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
    }
    throw inspected.error;
  };

  const readCleanProposalLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<ProposalLedgerV2 | null> => {
    let snapshot = input.snapshot;
    let directories = await resolveProposalDirectoriesV2({
      root: input.root,
      project: snapshot.directory,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      snapshot,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot });
      return null;
    }
    let ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    if (ledger.attributions.length > 0) {
      snapshot = await resolveProposalAttributionV2InsideQueue({
        root: input.root,
        projectId: input.projectId,
        snapshot,
      });
      directories = await resolveProposalDirectoriesV2({
        root: input.root,
        project: snapshot.directory,
        createIfWhollyAbsent: false,
      });
      if (directories === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution removed its directory family');
      }
      ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
      if (ledger.attributions.length > 0) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution did not resolve');
      }
    }
    return ledger;
  };

  const assertPendingProposalSlotV2 = (
    ledger: ProposalLedgerV2,
    proposalId: string
  ): IdentifiedRecordV2<StudioProposalSlotV2> => {
    const held = ledger.slots.get(proposalId) ?? [];
    if (held.length !== 1 || held[0].quarantined) {
      throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal has no exact slot authority');
    }
    return held[0];
  };

  const cleanupOrphanProposalSlotV2 = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ProposalLedgerV2;
    slot: IdentifiedRecordV2<StudioProposalSlotV2>;
  }): Promise<void> => {
    const authorize = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertPathAbsentV2(path.join(input.ledger.directories.pending.path, `${input.slot.record.proposalId}.json`)),
        assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${input.slot.record.proposalId}.json`)),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
    });
  };

  const reapProposalLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ProposalLedgerV2;
  }): Promise<ProposalLedgerV2> => {
    if (input.ledger.attributions.length > 0) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution must resolve before reaping');
    }
    for (const [proposalId] of input.ledger.proposals) {
      if (!input.ledger.decisions.has(proposalId)) assertPendingProposalSlotV2(input.ledger, proposalId);
    }

    await assertProposalLedgerEntrySetCurrentV2(input.ledger);
    const currentTime = Date.parse(now());
    const cutoff = currentTime - STUDIO_PROPOSAL_PENDING_TTL_MS;
    const orphanSlotCutoff = currentTime - STUDIO_PROPOSAL_STALE_SLOT_MS;
    const decisions = new Map(input.ledger.decisions);
    const slots = new Map(input.ledger.slots);
    for (const [proposalId, proposal] of input.ledger.proposals) {
      let decision = decisions.get(proposalId);
      const slot = slots.get(proposalId)?.[0];
      if (decision === undefined && Date.parse(proposal.record.createdAt) <= cutoff) {
        const decidedAt = now();
        if (!isCanonicalIsoTimestamp(decidedAt)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
        }
        // The ledger was fully validated before the first terminal publication.
        // eslint-disable-next-line no-await-in-loop
        decision = await publishProposalDecisionV2({
          root: input.root,
          projectId: input.projectId,
          directories: input.ledger.directories,
          proposal,
          status: 'expired',
          decidedAt,
          authorizeBeforeLink: async (temporary) => {
            const effectiveLedger = { ...input.ledger, decisions, slots };
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
            await assertProposalLedgerEntrySetCurrentV2(effectiveLedger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.ledger.directories.pending,
                identified: proposal,
              }),
              ...(slot === undefined
                ? []
                : [
                    assertIdentifiedRecordCurrentV2({
                      root: input.root,
                      authority: input.ledger.directories.slots,
                      identified: slot,
                    }),
                  ]),
              assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${proposalId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          },
        });
        decisions.set(proposalId, decision);
      }
      if (decision !== undefined && slot !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotV2({
          root: input.root,
          ledger: { ...input.ledger, decisions, slots },
          proposal,
          decision,
          slot,
          projectSnapshot: input.snapshot,
        });
        slots.delete(proposalId);
      }
    }
    for (const [proposalId, held] of slots) {
      if (input.ledger.proposals.has(proposalId) || held.length !== 1) continue;
      const slot = held[0];
      if (Date.parse(slot.record.reservedAt) > orphanSlotCutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await cleanupOrphanProposalSlotV2({
        root: input.root,
        projectId: input.projectId,
        snapshot: input.snapshot,
        ledger: input.ledger,
        slot,
      });
      slots.delete(proposalId);
    }
    return { ...input.ledger, decisions, slots };
  };

  const listProposalsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<StudioProposalV2[]> => {
    const ledger = await readCleanProposalLedgerV2InsideQueue(input);
    if (ledger === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return [];
    }
    const reaped = await reapProposalLedgerV2InsideQueue({ ...input, ledger });
    const result = [...reaped.proposals.values()]
      .map((proposal) => effectiveProposalV2(proposal.record, reaped.decisions.get(proposal.record.id)?.record))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return result;
  };

  const listProposalsV2ThroughQueue = (projectId: string): Promise<StudioProposalV2[]> =>
    enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      return listProposalsV2InsideQueue({ root, projectId, snapshot, createIfWhollyAbsent: false });
    });

  const readCleanReferenceRequestLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<ReferenceRequestLedgerV2 | null> => {
    const directories = await resolveReferenceRequestDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      snapshot: input.snapshot,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return null;
    }
    let ledger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    const missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    if (missing.length > 0) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference authorization receipt was not repaired');
    }
    ledger = await cleanupReferenceJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    if (ledger.writerResidues.length > 0) {
      await cleanupReferenceWriterResiduesV2(input.root, input.projectId, ledger, input.snapshot);
      ledger = await readReferenceRequestLedgerV2({
        root: input.root,
        projectId: input.projectId,
        directories,
      });
      assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    }
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertReferenceRequestLedgerEntrySetCurrentV2(ledger),
    ]);
    return ledger;
  };

  const referenceRequestLedgerEntryV2 = (
    ledger: ReferenceRequestLedgerV2,
    request: IdentifiedRecordV2<StudioReferenceRequestV2>
  ): StudioReferenceRequestLedgerEntryV2 => {
    const decision = ledger.decisions.get(request.record.id)?.record ?? null;
    const receipt =
      decision?.outcome.kind === 'generation_gate'
        ? (ledger.receipts.get(decision.outcome.handoffId)?.record ?? null)
        : null;
    return { request: request.record, decision, receipt };
  };

  const assertReferenceRequestReferencesActiveV2 = (
    project: StudioProjectV2,
    request: StudioReferenceRequestV2
  ): void => {
    const positions = new Map(project.referenceOrder.map((referenceId, index) => [referenceId, index]));
    let previous = -1;
    for (const referenceId of request.referenceIds) {
      const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
      const position = positions.get(referenceId);
      if (reference?.id !== referenceId || position === undefined || position <= previous) {
        throw new CreativeStudioStoreError(
          'invalid_payload',
          'Studio reference request references are no longer active'
        );
      }
      previous = position;
    }
  };

  const sameReferenceDecisionIntentV2 = (
    decision: StudioReferenceRequestDecisionV2,
    intent: StudioReferenceDecisionIntentV2
  ): boolean => decision.outcome.kind === intent.kind;

  const cleanupOrphanReferenceRequestSlotV2 = async (input: {
    root: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ReferenceRequestLedgerV2;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  }): Promise<void> => {
    const authorize = async (): Promise<void> => {
      await assertReferenceRequestDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertPathAbsentV2(path.join(input.ledger.directories.pending.path, `${input.slot.record.requestId}.json`)),
        assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${input.slot.record.requestId}.json`)),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
  };

  const reapReferenceRequestLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ReferenceRequestLedgerV2;
  }): Promise<ReferenceRequestLedgerV2> => {
    await assertReferenceRequestLedgerEntrySetCurrentV2(input.ledger);
    const observedAt = now();
    if (!isCanonicalIsoTimestamp(observedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request reap clock is invalid');
    }
    const currentTime = Date.parse(observedAt);
    const cutoff = currentTime - STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS;
    const orphanSlotCutoff = currentTime - STUDIO_PROPOSAL_STALE_SLOT_MS;
    let ledger = input.ledger;
    for (const [requestId, request] of ledger.requests) {
      let decision = ledger.decisions.get(requestId);
      if (decision === undefined && Date.parse(request.record.createdAt) <= cutoff) {
        const expiringSlot = assertPendingReferenceRequestSlotV2(ledger, requestId);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
        // A bounded reference ledger has at most fifty live request records.
        // eslint-disable-next-line no-await-in-loop
        decision = await publishReferenceRequestDecisionV2({
          root: input.root,
          projectId: input.projectId,
          directories: ledger.directories,
          request,
          outcome: { kind: 'expired' },
          decidedAt: observedAt,
          authorizeBeforeLink: async (temporary) => {
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
            await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: ledger.directories.pending,
                identified: request,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: ledger.directories.slots,
                identified: expiringSlot,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
              assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          },
        });
        ledger = { ...ledger, decisions: new Map(ledger.decisions).set(requestId, decision) };
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      }
      const receipt =
        decision?.record.outcome.kind === 'generation_gate'
          ? ledger.receipts.get(decision.record.outcome.handoffId)
          : undefined;
      const terminal =
        decision !== undefined && (decision.record.outcome.kind !== 'generation_gate' || receipt !== undefined);
      const slot = ledger.slots.get(requestId)?.[0];
      if (terminal && decision !== undefined && slot !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision,
          receipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(requestId);
        ledger = { ...ledger, slots };
      }
    }
    for (const [requestId, held] of ledger.slots) {
      if (ledger.requests.has(requestId) || held.length !== 1) continue;
      const slot = held[0];
      if (Date.parse(slot.record.reservedAt) > orphanSlotCutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await cleanupOrphanReferenceRequestSlotV2({
        root: input.root,
        snapshot: input.snapshot,
        ledger,
        slot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(requestId);
      ledger = { ...ledger, slots };
    }
    return ledger;
  };

  const listReferenceRequestsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceRequestLedgerEntryV2[]> => {
    const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      ...input,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return [];
    }
    const reaped = await reapReferenceRequestLedgerV2InsideQueue({ ...input, ledger });
    const result = [...reaped.requests.values()]
      .map((request) => referenceRequestLedgerEntryV2(reaped, request))
      .toSorted(
        (left, right) =>
          left.request.createdAt.localeCompare(right.request.createdAt) ||
          left.request.id.localeCompare(right.request.id)
      );
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return result;
  };

  const assertNoOpenReferenceHandoffOverlapV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    referenceIds: readonly string[];
  }): Promise<void> => {
    if (input.referenceIds.length === 0) return;
    const requested = new Set(input.referenceIds);
    const entries = await listReferenceRequestsV2InsideQueue(input);
    const overlaps = entries.some(
      (entry) =>
        entry.decision?.outcome.kind === 'generation_gate' &&
        entry.receipt === null &&
        entry.request.referenceIds.some((referenceId) => requested.has(referenceId))
    );
    if (overlaps) {
      throw new CreativeStudioStoreError(
        'invalid_payload',
        'Studio paid recovery overlaps an open reference-generation handoff'
      );
    }
  };

  const listReferenceRequestsV2ThroughQueue = (projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]> =>
    enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      return listReferenceRequestsV2InsideQueue({ root, projectId, snapshot });
    });

  const decideReferenceRequestV2InsideQueue = async (input: {
    root: string;
    decisionInput: StudioDecideReferenceRequestInputV2;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceRequestLedgerEntryV2> => {
    const { projectId, requestId, expectedRevision, outcome: intent } = input.decisionInput;
    let ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference request not found');
    ledger = await reapReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      ledger,
    });
    const request = ledger.requests.get(requestId);
    if (request === undefined) throw new CreativeStudioStoreError('not_found', 'Studio reference request not found');
    const existingDecision = ledger.decisions.get(requestId);
    if (existingDecision !== undefined) {
      if (!sameReferenceDecisionIntentV2(existingDecision.record, intent)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference request already has another decision');
      }
      const receipt =
        existingDecision.record.outcome.kind === 'generation_gate'
          ? ledger.receipts.get(existingDecision.record.outcome.handoffId)
          : undefined;
      const slot = ledger.slots.get(requestId)?.[0];
      if ((existingDecision.record.outcome.kind !== 'generation_gate' || receipt !== undefined) && slot !== undefined) {
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision: existingDecision,
          receipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(requestId);
        ledger = { ...ledger, slots };
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return referenceRequestLedgerEntryV2(ledger, request);
    }
    if (input.snapshot.project.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    if (intent.kind !== 'rejected') {
      assertReferenceRequestReferencesActiveV2(input.snapshot.project, request.record);
    }
    const slot = assertPendingReferenceRequestSlotV2(ledger, requestId);
    const decidedAt = now();
    if (!isCanonicalIsoTimestamp(decidedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision clock is invalid');
    }
    if (Date.parse(decidedAt) < Date.parse(request.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision predates its request');
    }
    let outcome: StudioReferenceRequestDecisionV2['outcome'];
    if (intent.kind === 'rejected') {
      outcome = { kind: 'rejected' };
    } else {
      let handoffId: string;
      try {
        handoffId = createId();
      } catch (error) {
        throw storageError(error, 'Studio reference handoff identity could not be generated');
      }
      if (
        !isSafeIdV2(handoffId) ||
        ledger.generationDecisions.has(handoffId) ||
        ledger.receipts.has(handoffId) ||
        referenceAuthorizationByHandoffV2(input.snapshot.project).has(handoffId)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff identity collides');
      }
      outcome = { kind: 'generation_gate', handoffId, referenceIds: [...request.record.referenceIds] };
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.slots,
        identified: slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
    ]);
    const decision = await publishReferenceRequestDecisionV2({
      root: input.root,
      projectId,
      directories: ledger.directories,
      request,
      outcome,
      decidedAt,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { decision: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: request,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    const decisions = new Map(ledger.decisions).set(requestId, decision);
    const generationDecisions = new Map(ledger.generationDecisions);
    if (decision.record.outcome.kind === 'generation_gate') {
      generationDecisions.set(decision.record.outcome.handoffId, decision);
    }
    ledger = { ...ledger, decisions, generationDecisions };
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    if (decision.record.outcome.kind !== 'generation_gate') {
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request,
        decision,
        slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(requestId);
      ledger = { ...ledger, slots };
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return referenceRequestLedgerEntryV2(ledger, request);
  };

  const referenceGenerationHandoffV2 = (
    ledger: ReferenceRequestLedgerV2,
    handoffId: string
  ): StudioReferenceGenerationHandoffStoreV2 | null => {
    const decision = ledger.generationDecisions.get(handoffId)?.record;
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision)) return null;
    const request = ledger.requests.get(decision.requestId)?.record;
    if (request === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff request is missing');
    }
    return {
      request,
      decision,
      receipt: ledger.receipts.get(handoffId)?.record ?? null,
    };
  };

  type ReservedReferenceGenerationHandoffV2 = {
    ledger: ReferenceRequestLedgerV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    decision: IdentifiedRecordV2<StudioReferenceGenerationDecisionV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  };

  const reserveReferenceGenerationHandoffV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    handoffId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ReservedReferenceGenerationHandoffV2> => {
    const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId: input.projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    const decision = ledger.generationDecisions.get(input.handoffId);
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
      throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    }
    const generationDecision = decision as IdentifiedRecordV2<StudioReferenceGenerationDecisionV2>;
    const request = ledger.requests.get(generationDecision.record.requestId);
    if (
      request === undefined ||
      request.record.projectId !== input.projectId ||
      generationDecision.record.projectId !== input.projectId ||
      generationDecision.record.outcome.handoffId !== input.handoffId ||
      !sameJson(request.record.referenceIds, generationDecision.record.outcome.referenceIds)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff authority mismatch');
    }
    if (ledger.receipts.has(input.handoffId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio reference handoff is already complete');
    }
    if (referenceAuthorizationByHandoffV2(input.snapshot.project).has(input.handoffId)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff authorization is unrepaired');
    }
    assertReferenceRequestReferencesActiveV2(input.snapshot.project, request.record);
    const slot = assertPendingReferenceRequestSlotV2(ledger, request.record.id);
    return { ledger, request, decision: generationDecision, slot };
  };

  const assertReservedReferenceGenerationHandoffCurrentV2 = async (input: {
    root: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    reserved: ReservedReferenceGenerationHandoffV2;
    assertActive: () => unknown;
  }): Promise<void> => {
    await Promise.all([
      assertReferenceRequestLedgerEntrySetCurrentV2(input.reserved.ledger),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.reserved.ledger.directories.pending,
        identified: input.reserved.request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.reserved.ledger.directories.decisions,
        identified: input.reserved.decision,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.reserved.ledger.directories.slots,
        identified: input.reserved.slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(
        path.join(
          input.reserved.ledger.directories.receipts.path,
          `${input.reserved.decision.record.outcome.handoffId}.json`
        )
      ),
    ]);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    const activeAfterHandoffAuthority = input.assertActive();
    assertSynchronousConfirmationResult(
      activeAfterHandoffAuthority,
      'Studio reference confirmation active-session check'
    );
  };

  const recordReferenceGenerationHandoffReceiptV2InsideQueue = async (input: {
    root: string;
    receiptInput: StudioRecordReferenceGenerationHandoffReceiptInputV2;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceGenerationHandoffStoreV2> => {
    const { projectId, handoffId, expectedRevision, result } = input.receiptInput;
    let ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    const decision = ledger.generationDecisions.get(handoffId);
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
      throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    }
    const request = ledger.requests.get(decision.record.requestId);
    if (request === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff request is missing');
    }
    const existingReceipt = ledger.receipts.get(handoffId);
    if (existingReceipt !== undefined) {
      const sameResult =
        existingReceipt.record.result.kind === result.kind &&
        (result.kind !== 'confirmed' ||
          (existingReceipt.record.result.kind === 'confirmed' &&
            existingReceipt.record.result.authorizationId === result.authorizationId));
      if (!sameResult) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference handoff already has another receipt');
      }
      const slot = ledger.slots.get(request.record.id)?.[0];
      if (slot !== undefined) {
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision,
          receipt: existingReceipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(request.record.id);
        ledger = { ...ledger, slots };
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return referenceGenerationHandoffV2(ledger, handoffId)!;
    }
    if (input.snapshot.project.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const authorizations = referenceAuthorizationByHandoffV2(input.snapshot.project);
    const authorization = authorizations.get(handoffId);
    let completedAt: string;
    if (result.kind === 'dismissed') {
      if (authorization !== undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Authorized Studio reference handoff cannot be dismissed');
      }
      completedAt = now();
      if (!isCanonicalIsoTimestamp(completedAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt clock is invalid');
      }
      if (Date.parse(completedAt) < Date.parse(decision.record.decidedAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt predates its decision');
      }
    } else {
      if (authorization === undefined || authorization.id !== result.authorizationId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff has no exact authorization');
      }
      completedAt = authorization.confirmedAt;
    }
    const slot = assertPendingReferenceRequestSlotV2(ledger, request.record.id);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.decisions,
        identified: decision,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.slots,
        identified: slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(path.join(ledger.directories.receipts.path, `${handoffId}.json`)),
    ]);
    const receipt = await publishReferenceGenerationHandoffReceiptV2({
      root: input.root,
      directories: ledger.directories,
      receipt: {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        handoffId,
        requestId: request.record.id,
        completedAt,
        result: structuredClone(result),
      },
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { receipt: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: request,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.decisions,
            identified: decision,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertPathAbsentV2(path.join(ledger.directories.receipts.path, `${handoffId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    ledger = { ...ledger, receipts: new Map(ledger.receipts).set(handoffId, receipt) };
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await releaseReferenceRequestSlotV2({
      root: input.root,
      ledger,
      request,
      decision,
      receipt,
      slot,
      projectSnapshot: input.snapshot,
    });
    const slots = new Map(ledger.slots);
    slots.delete(request.record.id);
    ledger = { ...ledger, slots };
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return referenceGenerationHandoffV2(ledger, handoffId)!;
  };

  const publishProposalAttributionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
    attribution: StudioProposalCommitAttributionV2;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioProposalCommitAttributionV2>> => {
    const file = path.join(input.directories.commits.path, `${input.attribution.proposalId}.json`);
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.commits,
      file,
      bytes: serializeJsonExact(input.attribution),
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      parse: (value) => parseAttributionRecordV2(input.projectId, input.attribution.proposalId, value),
    });
    if (published.bytes !== serializeJsonExact(input.attribution)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal commit attribution changed at publication');
    }
    return published;
  };

  const acceptProposalV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    proposalId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioProposalAcceptanceResultV2> => {
    let ledger = await readCleanProposalLedgerV2InsideQueue({ ...input, createIfWhollyAbsent: false });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
    ledger = await reapProposalLedgerV2InsideQueue({ ...input, ledger });
    const proposal = ledger.proposals.get(input.proposalId);
    if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
    const existingDecision = ledger.decisions.get(input.proposalId);
    if (existingDecision !== undefined) {
      if (existingDecision.record.status !== 'accepted') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
      }
      await releaseProposalSlotV2({
        root: input.root,
        ledger,
        proposal,
        decision: existingDecision,
        slot: ledger.slots.get(input.proposalId)?.[0],
        projectSnapshot: input.snapshot,
      });
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return {
        proposal: effectiveProposalV2(proposal.record, existingDecision.record),
        project: input.snapshot.project,
        applied: false,
      };
    }
    const slot = assertPendingProposalSlotV2(ledger, input.proposalId);
    if (proposal.record.payload.kind === 'paid_recovery') {
      throw new CreativeStudioStoreError(
        'invalid_payload',
        'Paid Studio recovery requires the renderer confirmation boundary'
      );
    }
    if (input.snapshot.project.revision !== proposal.record.baseRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const decidedAt = now();
    if (!isCanonicalIsoTimestamp(decidedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
    }
    if (Date.parse(decidedAt) < Date.parse(proposal.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision predates its proposal');
    }
    let operations;
    try {
      operations = studioProposalOperationsV2(input.snapshot.project, proposal.record);
    } catch {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal operations are invalid');
    }
    const applied = applyStudioMutationBatchV2(
      input.snapshot.project,
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: input.projectId,
        expectedRevision: proposal.record.baseRevision,
        operations,
      },
      { mutationId: proposal.record.id, capturedAt: proposal.record.createdAt }
    );
    const candidate: StudioProjectV2 = {
      ...applied.project,
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: proposal.record.baseRevision + 1,
      updatedAt: decidedAt,
    };
    if (!validateStudioProjectV2(candidate)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio proposal result');
    }
    const candidateBytes = serializeProjectV2ForWrite(candidate, 'Schema-2 Studio proposal result');
    const attribution: StudioProposalCommitAttributionV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      kind: 'mutation',
      proposalId: proposal.record.id,
      projectId: input.projectId,
      baseRevision: proposal.record.baseRevision,
      appliedRevision: candidate.revision,
      beforeProjectSha256: sha256Utf8(input.snapshot.bytes),
      afterProjectSha256: sha256Utf8(candidateBytes),
      createdBeatIds: [...applied.createdBeatIds],
      createdShotIds: [...applied.createdShotIds],
      authorizationId: null,
      decidedAt,
    };
    if (!validateProposalCommitAttributionV2(input.projectId, proposal.record.id, attribution)) {
      throw new CreativeStudioStoreError('storage_error', 'Invalid Studio proposal commit attribution');
    }
    assertAttributionCreatedIdsV2({
      attribution,
      proposal: proposal.record,
      project: input.snapshot.project,
      state: 'before',
    });
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await Promise.all([
      assertProposalDirectoryAuthoritiesV2(ledger.directories),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    const identifiedAttribution = await publishProposalAttributionV2({
      root: input.root,
      projectId: input.projectId,
      directories: ledger.directories,
      attribution,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertProposalLedgerEntrySetCurrentV2(ledger, { attribution: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
          }),
          assertPathAbsentV2(path.join(ledger.directories.commits.path, `${proposal.record.id}.json`)),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    const durableAttribution = identifiedAttribution.record;
    const attributedLedger: ProposalLedgerV2 = { ...ledger, attributions: [identifiedAttribution] };
    await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    await writeProjectFilesV2({
      root: input.root,
      snapshot: input.snapshot,
      project: candidate,
      projectBytes: candidateBytes,
      authorizeBeforeReplace: async () => {
        await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
        await assertProposalDirectoryAuthoritiesV2(ledger.directories);
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.commits,
            identified: identifiedAttribution,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
      },
    });
    const committed = requireSupportedProjectInspectionV2(await inspectProjectFileV2(input.root, input.projectId));
    if (
      committed.bytes !== candidateBytes ||
      sha256Utf8(committed.bytes) !== durableAttribution.afterProjectSha256 ||
      !sameIdentityV2(committed.directory, input.snapshot.directory)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal project publication changed');
    }
    await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    const decision = await publishProposalDecisionV2({
      root: input.root,
      projectId: input.projectId,
      directories: ledger.directories,
      proposal,
      status: 'accepted',
      decidedAt: durableAttribution.decidedAt,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
        await assertProposalLedgerEntrySetCurrentV2(attributedLedger, { decision: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.commits,
            identified: identifiedAttribution,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
          }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
      },
    });
    const decidedLedger: ProposalLedgerV2 = {
      ...attributedLedger,
      decisions: new Map(attributedLedger.decisions).set(input.proposalId, decision),
    };
    await assertProposalLedgerEntrySetCurrentV2(decidedLedger);
    const authorizeAttributionCleanup = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.pending,
          identified: proposal,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.decisions,
          identified: decision,
        }),
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
    };
    await removeJournalPublicationCompanionV2({
      root: input.root,
      authority: ledger.directories.commits,
      named: identifiedAttribution,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize: authorizeAttributionCleanup,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: ledger.directories.commits,
      identified: identifiedAttribution,
      authorize: authorizeAttributionCleanup,
    });
    await releaseProposalSlotV2({
      root: input.root,
      ledger: { ...decidedLedger, attributions: [] },
      proposal,
      decision,
      slot,
      projectSnapshot: committed,
    });
    observeProjectCommit(
      Object.freeze({
        projectId: input.projectId,
        previousRevision: proposal.record.baseRevision,
        committedRevision: candidate.revision,
        committedAt: decidedAt,
        commitTag: `proposal:${proposal.record.id}`,
      })
    );
    return { proposal: effectiveProposalV2(proposal.record, decision.record), project: candidate, applied: true };
  };

  const scanProjectsV2 = async (root: string): Promise<ProjectListingSweepV2> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      throw storageError(error, 'Studio project inventory could not be inspected');
    }
    const unsafeProjectEntry = entries.find((entry) => isSafeIdV2(entry.name) && entry.isSymbolicLink());
    if (unsafeProjectEntry !== undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
    }
    const projectEntries = entries
      .filter((entry) => entry.isDirectory() && isSafeIdV2(entry.name))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    const supportedProjectIds: string[] = [];
    const projectRevisions: { projectId: string; revision: number }[] = [];
    const summaries: StudioProjectSummaryV2[] = [];
    const unsupportedProjectIds: string[] = [];
    const quarantinedProjectIds: string[] = [];
    for (const entry of projectEntries) {
      const projectId = entry.name;
      let inspected: ProjectFileInspectionV2;
      try {
        // A schema-2 record may be large, so inventory reads stay sequential and bounded.
        // eslint-disable-next-line no-await-in-loop
        inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      } catch (error) {
        quarantinedProjectIds.push(projectId);
        safeLogError(`[CreativeStudio] Quarantined corrupt schema-2 project manifest: ${projectId}`, error);
        continue;
      }
      if (inspected.status === 'supported') {
        supportedProjectIds.push(inspected.project.id);
        projectRevisions.push({ projectId: inspected.project.id, revision: inspected.project.revision });
        summaries.push(toStudioProjectSummaryV2(inspected.project));
      } else if (inspected.status === 'unsupported_prototype_schema') unsupportedProjectIds.push(projectId);
      else if (inspected.status === 'malformed_v2') {
        quarantinedProjectIds.push(projectId);
        safeLogError(`[CreativeStudio] Quarantined corrupt schema-2 project manifest: ${projectId}`, inspected.error);
      }
    }
    return { supportedProjectIds, projectRevisions, summaries, unsupportedProjectIds, quarantinedProjectIds };
  };

  const toProjectListResultV2 = (sweep: ProjectListingSweepV2): StudioProjectListResultV2 => ({
    projects: sweep.summaries.toSorted(compareSummariesV2),
    projectRevisions: sweep.projectRevisions.toSorted((left, right) => left.projectId.localeCompare(right.projectId)),
    unsupportedProjectIds: [...sweep.unsupportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
    quarantinedProjectIds: [...sweep.quarantinedProjectIds].toSorted((left, right) => left.localeCompare(right)),
  });

  const repairSummaryIndexV2 = (): Promise<StudioProjectListResultV2> => {
    const rebuild = async (): Promise<StudioProjectListResultV2> => {
      const root = await existingCanonicalRootV2();
      if (root === null)
        return { projects: [], projectRevisions: [], unsupportedProjectIds: [], quarantinedProjectIds: [] };
      const indexFile = await summariesFileV2(root);
      const sweep = await scanProjectsV2(root);
      const result = toProjectListResultV2(sweep);
      let existing: unknown = null;
      let indexExists = true;
      try {
        const record = await readBoundedStudioV2File(root, indexFile);
        indexExists = record !== null;
        if (record?.status === 'bytes') existing = JSON.parse(record.bytes) as unknown;
      } catch {
        // A malformed or oversized schema-2 summary index is rebuilt from project manifests below.
      }
      const ownsIndex = indexExists || sweep.supportedProjectIds.length > 0 || sweep.quarantinedProjectIds.length > 0;
      if (ownsIndex) {
        // Revisions correlate live read models only. Keep them out of the independently versioned summary sidecar.
        const next = { schemaVersion: 2, projects: result.projects };
        if (!sameJson(existing, next)) await writeJsonAtomic(root, indexFile, next);
      }
      return result;
    };
    const next = summaryV2Queue.catch((): undefined => undefined).then(() => rebuild());
    summaryV2Queue = next.catch((): undefined => undefined);
    return next;
  };

  const repairSummaryV2AfterCommit = async (): Promise<void> => {
    try {
      await repairSummaryIndexV2();
    } catch (error) {
      safeLogError('[CreativeStudio] Schema-2 project summary repair failed after commit', error);
      await repairSummaryIndexV2().catch((retryError: unknown): void => {
        safeLogError('[CreativeStudio] Schema-2 project summary repair retry failed', retryError);
      });
    }
  };

  const updateProjectV2InsideQueue = async (
    root: string,
    inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>,
    update: (project: StudioProjectV2) => StudioProjectV2,
    expectedRevision: number | undefined,
    commitTag: string | null,
    authorizeBeforeReplace?: () => void | Promise<void>
  ): Promise<StudioProjectV2> => {
    const current = inspected.project;
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    await summariesFileV2(root);
    const updated = update(structuredClone(current));
    if (!isRecord(updated) || updated.id !== current.id || updated.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    const next: StudioProjectV2 = {
      ...updated,
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    if (!validateStudioProjectV2(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const bytes = serializeProjectV2ForWrite(next, 'Schema-2 Studio project');
    await writeProjectFilesV2({
      root,
      snapshot: inspected,
      project: next,
      projectBytes: bytes,
      authorizeBeforeReplace,
    });
    observeProjectCommit(
      Object.freeze({
        projectId: current.id,
        previousRevision: current.revision,
        committedRevision: next.revision,
        committedAt: next.updatedAt,
        commitTag,
      })
    );
    return next;
  };

  const confirmProjectV2InsideQueue = async <TRevalidation, TDispatch>(
    root: string,
    inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>,
    input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>,
    authorizeBeforePersistence?: (candidate: StudioProjectV2) => Promise<void>
  ): Promise<StudioProjectConfirmationResultV2<TDispatch>> => {
    const current = inspected.project;
    if (current.revision !== input.expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }

    await summariesFileV2(root);

    const snapshot = cloneAndFreezeConfirmationValue(current, 'Studio confirmation project snapshot');
    const rawRevalidation = await input.revalidate(snapshot);
    const revalidation = cloneAndFreezeConfirmationValue(rawRevalidation, 'Studio confirmation revalidation');

    const activeAfterRevalidation = (input.assertActive as () => unknown)();
    assertSynchronousConfirmationResult(activeAfterRevalidation, 'Studio confirmation active-session check');

    const confirmedAt = now();
    if (!isCanonicalIsoTimestamp(confirmedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio confirmation clock is invalid');
    }
    if (Date.parse(confirmedAt) >= Date.parse(input.expiresAt)) {
      throw new StudioProjectConfirmationError('Studio confirmation has expired');
    }

    const mutableProject = cloneConfirmationValue(current, 'Studio confirmation commit project');
    const rawCommit = input.buildCommit(mutableProject, revalidation, confirmedAt) as unknown;
    assertSynchronousConfirmationResult(rawCommit, 'Studio confirmation commit builder');
    if (!isRecord(rawCommit)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation commit');
    }
    const projectDescriptor = Reflect.getOwnPropertyDescriptor(rawCommit, 'project');
    const dispatchDescriptor = Reflect.getOwnPropertyDescriptor(rawCommit, 'dispatch');
    if (
      projectDescriptor === undefined ||
      !Object.hasOwn(projectDescriptor, 'value') ||
      dispatchDescriptor === undefined ||
      !Object.hasOwn(dispatchDescriptor, 'value')
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation commit');
    }
    const builtProject = projectDescriptor.value as unknown;
    if (!isRecord(builtProject) || builtProject.id !== current.id || builtProject.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    const candidate: StudioProjectV2 = {
      ...(builtProject as StudioProjectV2),
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: current.revision + 1,
      updatedAt: confirmedAt,
    };
    if (!validateStudioProjectV2(candidate)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const next = cloneConfirmationValue(candidate, 'Studio confirmation committed project');
    if (!validateStudioProjectV2(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const dispatch = cloneAndFreezeConfirmationValue(
      dispatchDescriptor.value as TDispatch,
      'Studio confirmation dispatch'
    );

    const activeBeforePersistence = (input.assertActive as () => unknown)();
    assertSynchronousConfirmationResult(activeBeforePersistence, 'Studio confirmation active-session check');
    const authorizedProject = cloneAndFreezeConfirmationValue(next, 'Studio confirmation authorized project');
    if (authorizeBeforePersistence !== undefined) {
      await authorizeBeforePersistence(authorizedProject as StudioProjectV2);
    }
    const bytes = serializeProjectV2ForWrite(next, 'Schema-2 Studio confirmation project');
    await writeProjectFilesV2({
      root,
      snapshot: inspected,
      project: next,
      projectBytes: bytes,
      authorizeBeforeReplace:
        authorizeBeforePersistence === undefined
          ? undefined
          : () => authorizeBeforePersistence(authorizedProject as StudioProjectV2),
    });
    observeProjectCommit(
      Object.freeze({
        projectId: current.id,
        previousRevision: current.revision,
        committedRevision: next.revision,
        committedAt: next.updatedAt,
        commitTag: input.commitTag ?? null,
      })
    );
    return { project: next, dispatch };
  };

  return {
    async inspectProjectsV2(): Promise<StudioProjectInventoryV2> {
      const root = await existingCanonicalRootV2();
      if (root === null) {
        return { supportedProjectIds: [], unsupportedProjectIds: [], quarantinedProjectIds: [] };
      }
      const sweep = await scanProjectsV2(root);
      return {
        supportedProjectIds: [...sweep.supportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
        unsupportedProjectIds: [...sweep.unsupportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
        quarantinedProjectIds: [...sweep.quarantinedProjectIds].toSorted((left, right) => left.localeCompare(right)),
      };
    },

    async listProjectsV2(): Promise<StudioProjectListResultV2> {
      return repairSummaryIndexV2();
    },

    async createProjectV2(input: CreateStudioProjectInputV2): Promise<StudioProjectV2> {
      if (!isRecord(input) || Object.hasOwn(input, 'id')) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project ids are generated by the store');
      }
      const projectId = createId();
      if (!isSafeIdV2(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      let candidate: StudioProjectV2;
      try {
        candidate = createEmptyStudioProjectV2(input, projectId, now());
      } catch {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
      }
      const created = await enqueue(projectId, async () => {
        const root = await writableCanonicalRootV2();
        await summariesFileV2(root);
        if ((await projectDirectory(root, projectId, false)) !== null) {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
        }
        const directory = await createProjectDirectoryV2(root, projectId);
        const directoryAuthority = await captureDirectoryAuthorityV2(directory);
        const file = resolveRootChild(directory, 'project.json');
        const briefFile = resolveRootChild(directory, STUDIO_BRIEF_FILE_NAME);
        await assertRegularFileOrMissing(file);
        await assertRegularFileOrMissing(briefFile);
        if (Buffer.byteLength(candidate.brief, 'utf8') > STUDIO_BRIEF_FILE_MAX_BYTES) {
          throw new CreativeStudioStoreError('invalid_payload', 'Schema-5 Studio Brief is too large');
        }
        const projectBytes = serializeProjectV2ForWrite(candidate, 'Schema-5 Studio creation project');
        await writeBytesAtomic(root, briefFile, candidate.brief, async () => {
          await Promise.all([assertPathAbsentV2(briefFile), assertDirectoryAuthorityV2(directoryAuthority)]);
        });
        const publishedBrief = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: briefFile,
          maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
        });
        if (publishedBrief === null || publishedBrief.bytes !== candidate.brief) {
          throw new CreativeStudioStoreError('storage_error', 'Schema-5 Studio Brief was not published');
        }
        await writeBytesAtomic(root, file, projectBytes, async () => {
          await Promise.all([assertPathAbsentV2(file), assertDirectoryAuthorityV2(directoryAuthority)]);
          const currentBrief = await readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: root,
            file: briefFile,
            maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
          });
          if (
            currentBrief === null ||
            currentBrief.bytes !== publishedBrief.bytes ||
            !sameIdentityV2(currentBrief.identity, publishedBrief.identity)
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Schema-5 Studio Brief authority changed');
          }
        });
        return candidate;
      });
      await repairSummaryV2AfterCommit();
      return created;
    },

    async getProjectV2(projectId: string): Promise<StudioProjectStoreLoadResultV2> {
      if (!isSafeIdV2(projectId)) return { status: 'not_found', projectId };
      const root = await existingCanonicalRootV2();
      if (root === null) return { status: 'not_found', projectId };
      const inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      if (inspected.status === 'malformed_v2') throw inspected.error;
      return inspected.status === 'supported' ? { status: 'supported', project: inspected.project } : inspected;
    },

    async applyMutationBatchV2(
      batch: StudioMutationBatchV2,
      context: StudioMutationReducerContextV2,
      commitTag?: string
    ): Promise<StudioMutationApplyResultV2> {
      if (!isRecord(batch) || !isSafeIdV2(batch.projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      if (!isIntegerInRange(batch.expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      if (!isStudioMutationReducerContextV2(context)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio mutation reducer context');
      }
      const mutationBatch = cloneConfirmationValue(batch, 'Studio mutation batch');
      const reducerContext = Object.freeze({
        mutationId: context.mutationId,
        capturedAt: context.capturedAt,
      });
      const result = await enqueue(mutationBatch.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const inspected = await inspectProjectWithAttributionFenceV2InsideQueue(root, mutationBatch.projectId);
        if (inspected.status === 'not_found') {
          throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        }
        if (inspected.status === 'unsupported_prototype_schema') {
          throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
        }
        if (inspected.status === 'malformed_v2') throw inspected.error;
        const current = inspected.project;
        if (current.revision !== mutationBatch.expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        await summariesFileV2(root);
        const applied = applyStudioMutationBatchV2(current, mutationBatch, reducerContext);
        const committed: StudioProjectV2 = {
          ...applied.project,
          revision: current.revision + 1,
          updatedAt: now(),
        };
        if (!validateStudioProjectV2(committed)) {
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
        }
        const bytes = serializeProjectV2ForWrite(committed, 'Schema-2 Studio mutation project');
        await writeProjectFilesV2({
          root,
          snapshot: inspected,
          project: committed,
          projectBytes: bytes,
        });
        observeProjectCommit(
          Object.freeze({
            projectId: current.id,
            previousRevision: current.revision,
            committedRevision: committed.revision,
            committedAt: committed.updatedAt,
            commitTag: commitTag ?? null,
          })
        );
        return { ...applied, project: committed };
      });
      await repairSummaryV2AfterCommit();
      return result;
    },

    async confirmProjectV2<TRevalidation, TDispatch>(
      input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>
    ): Promise<StudioProjectConfirmationResultV2<TDispatch>> {
      if (
        !isRecord(input) ||
        !isSafeIdV2(input.projectId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isCanonicalIsoTimestamp(input.expiresAt) ||
        typeof input.revalidate !== 'function' ||
        typeof input.assertActive !== 'function' ||
        typeof input.buildCommit !== 'function' ||
        (input.commitTag !== undefined && typeof input.commitTag !== 'string')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation input');
      }
      const confirmationInput = Object.freeze({
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        expiresAt: input.expiresAt,
        revalidate: input.revalidate,
        assertActive: input.assertActive,
        buildCommit: input.buildCommit,
        commitTag: input.commitTag,
      });
      let result: StudioProjectConfirmationResultV2<TDispatch>;
      try {
        result = await enqueue(confirmationInput.projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, confirmationInput.projectId)
          );
          return confirmProjectV2InsideQueue(root, inspected, confirmationInput);
        });
      } catch (error) {
        // A commit queued immediately before this confirmation may be repairing the summary index.
        // Delay the stale rejection until that already-started maintenance settles so callers can
        // observe the preceding mutation before handling this queued result.
        await summaryV2Queue.catch((): undefined => undefined);
        throw error;
      }
      await repairSummaryV2AfterCommit();
      return result;
    },

    async confirmPaidRecoveryProposalV2<TRevalidation, TDispatch>(
      input: StudioPaidRecoveryProposalConfirmationInputV2<TRevalidation, TDispatch>
    ): Promise<StudioProjectConfirmationResultV2<TDispatch>> {
      if (
        !isRecord(input) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeProposalId(input.proposalId) ||
        !isSafeProposalId(input.authorizationId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isCanonicalIsoTimestamp(input.expiresAt) ||
        typeof input.revalidate !== 'function' ||
        typeof input.assertActive !== 'function' ||
        typeof input.buildCommit !== 'function' ||
        (input.commitTag !== undefined && typeof input.commitTag !== 'string')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio paid-recovery confirmation input');
      }
      const confirmationInput = Object.freeze({
        projectId: input.projectId,
        proposalId: input.proposalId,
        authorizationId: input.authorizationId,
        expectedRevision: input.expectedRevision,
        expiresAt: input.expiresAt,
        revalidate: input.revalidate,
        assertActive: input.assertActive,
        buildCommit: input.buildCommit,
        commitTag: input.commitTag,
      });
      let result: StudioProjectConfirmationResultV2<TDispatch>;
      try {
        result = await enqueue(confirmationInput.projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, confirmationInput.projectId)
          );
          let ledger = await readCleanProposalLedgerV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: inspected,
            createIfWhollyAbsent: false,
          });
          if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
          ledger = await reapProposalLedgerV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: inspected,
            ledger,
          });
          const proposal = ledger.proposals.get(confirmationInput.proposalId);
          if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
          if (
            proposal.record.payload.kind !== 'paid_recovery' ||
            proposal.record.baseRevision !== confirmationInput.expectedRevision ||
            ledger.decisions.has(confirmationInput.proposalId)
          ) {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio paid-recovery proposal is not pending');
          }
          const paidPrepare = proposal.record.payload.blocker.remedy.prepare;
          const paidReferenceIds = paidPrepare.kind === 'project_references' ? [...paidPrepare.referenceIds] : [];
          await assertNoOpenReferenceHandoffOverlapV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: inspected,
            referenceIds: paidReferenceIds,
          });
          const slot = assertPendingProposalSlotV2(ledger, confirmationInput.proposalId);
          let identifiedAttribution: IdentifiedRecordV2<StudioProposalCommitAttributionV2> | null = null;
          const committed = await confirmProjectV2InsideQueue(root, inspected, confirmationInput, async (candidate) => {
            await assertNoOpenReferenceHandoffOverlapV2InsideQueue({
              root,
              projectId: confirmationInput.projectId,
              snapshot: inspected,
              referenceIds: paidReferenceIds,
            });
            const exactAuthorizations = candidate.spendAuthorizations.filter(
              (authorization) => authorization.id === confirmationInput.authorizationId
            );
            if (
              candidate.spendAuthorizations.length !== inspected.project.spendAuthorizations.length + 1 ||
              exactAuthorizations.length !== 1 ||
              inspected.project.spendAuthorizations.some(
                (authorization) => authorization.id === confirmationInput.authorizationId
              )
            ) {
              throw new CreativeStudioStoreError(
                'invalid_payload',
                'Studio paid recovery did not create one exact authorization'
              );
            }
            const candidateBytes = serializeProjectV2ForWrite(
              candidate as StudioProjectV2,
              'Schema-2 Studio paid-recovery proposal result'
            );
            const authorization = exactAuthorizations[0]!;
            const attribution: StudioProposalCommitAttributionV2 = {
              schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
              kind: 'paid_recovery',
              proposalId: proposal.record.id,
              projectId: confirmationInput.projectId,
              baseRevision: proposal.record.baseRevision,
              appliedRevision: candidate.revision,
              beforeProjectSha256: sha256Utf8(inspected.bytes),
              afterProjectSha256: sha256Utf8(candidateBytes),
              createdBeatIds: [],
              createdShotIds: [],
              authorizationId: authorization.id,
              decidedAt: authorization.confirmedAt,
            };
            if (
              Date.parse(attribution.decidedAt) < Date.parse(proposal.record.createdAt) ||
              attribution.decidedAt !== candidate.updatedAt ||
              !validateProposalCommitAttributionV2(
                confirmationInput.projectId,
                confirmationInput.proposalId,
                attribution
              )
            ) {
              throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio paid-recovery attribution');
            }
            assertAttributionCreatedIdsV2({
              attribution,
              proposal: proposal.record,
              project: candidate as StudioProjectV2,
              state: 'after',
            });
            if (identifiedAttribution === null) {
              await assertProposalLedgerEntrySetCurrentV2(ledger);
              await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
              identifiedAttribution = await publishProposalAttributionV2({
                root,
                projectId: confirmationInput.projectId,
                directories: ledger.directories,
                attribution,
                authorizeBeforeLink: async (temporary) => {
                  await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
                  await assertProposalLedgerEntrySetCurrentV2(ledger, { attribution: temporary });
                  await assertProposalDirectoryAuthoritiesV2(ledger.directories);
                  await Promise.all([
                    assertIdentifiedRecordCurrentV2({
                      root,
                      authority: ledger!.directories.pending,
                      identified: proposal,
                    }),
                    assertIdentifiedRecordCurrentV2({
                      root,
                      authority: ledger!.directories.slots,
                      identified: slot,
                    }),
                    assertPathAbsentV2(
                      path.join(ledger!.directories.decisions.path, `${confirmationInput.proposalId}.json`)
                    ),
                  ]);
                  await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
                },
              });
            } else {
              if (!sameJson(identifiedAttribution.record, attribution)) {
                throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution changed');
              }
            }
            const exactAttribution = identifiedAttribution;
            if (exactAttribution === null) {
              throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution disappeared');
            }
            const attributedLedger: ProposalLedgerV2 = { ...ledger, attributions: [exactAttribution] };
            await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
            await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
            await assertProposalDirectoryAuthoritiesV2(ledger.directories);
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.commits,
                identified: exactAttribution,
              }),
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.pending,
                identified: proposal,
              }),
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.slots,
                identified: slot,
              }),
              assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${confirmationInput.proposalId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
          });
          if (identifiedAttribution === null) {
            throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution was not published');
          }
          const postCommit = requireSupportedProjectInspectionV2(
            await inspectProjectFileV2(root, confirmationInput.projectId)
          );
          if (!sameJson(postCommit.project, committed.project)) {
            throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery project changed');
          }
          await resolveProposalAttributionV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: postCommit,
          });
          return committed;
        });
      } catch (error) {
        await summaryV2Queue.catch((): undefined => undefined);
        throw error;
      }
      await repairSummaryV2AfterCommit();
      return result;
    },

    async confirmReferenceGenerationHandoffV2<TRevalidation, TDispatch>(
      input: StudioReferenceGenerationHandoffConfirmationInputV2<TRevalidation, TDispatch>
    ): Promise<StudioProjectConfirmationResultV2<TDispatch>> {
      if (
        !isRecord(input) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeIdV2(input.handoffId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isCanonicalIsoTimestamp(input.expiresAt) ||
        typeof input.revalidate !== 'function' ||
        typeof input.assertActive !== 'function' ||
        typeof input.buildCommit !== 'function' ||
        (input.commitTag !== undefined && typeof input.commitTag !== 'string')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference confirmation input');
      }
      const confirmationInput = Object.freeze({
        projectId: input.projectId,
        handoffId: input.handoffId,
        expectedRevision: input.expectedRevision,
        expiresAt: input.expiresAt,
        revalidate: input.revalidate,
        assertActive: input.assertActive,
        buildCommit: input.buildCommit,
        commitTag: input.commitTag,
      });
      let result: StudioProjectConfirmationResultV2<TDispatch>;
      let projectCommitted = false;
      try {
        result = await enqueue(confirmationInput.projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, confirmationInput.projectId)
          );
          const reserved = await reserveReferenceGenerationHandoffV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            handoffId: confirmationInput.handoffId,
            snapshot: inspected,
          });
          const committed = await confirmProjectV2InsideQueue(root, inspected, confirmationInput, async (candidate) => {
            const exactAuthorizations = candidate.spendAuthorizations.filter(
              (authorization) => authorization.originReferenceHandoffId === confirmationInput.handoffId
            );
            if (
              candidate.spendAuthorizations.length !== inspected.project.spendAuthorizations.length + 1 ||
              exactAuthorizations.length !== 1
            ) {
              throw new CreativeStudioStoreError(
                'invalid_payload',
                'Studio reference confirmation did not create one exact authorization'
              );
            }
            const missing = assertReferenceAuthorizationRelationsV2({ project: candidate, ledger: reserved.ledger });
            if (missing.length !== 1 || missing[0]?.handoffId !== confirmationInput.handoffId) {
              throw new CreativeStudioStoreError(
                'invalid_payload',
                'Studio reference confirmation did not create one exact authorization'
              );
            }
            await assertReservedReferenceGenerationHandoffCurrentV2({
              root,
              snapshot: inspected,
              reserved,
              assertActive: confirmationInput.assertActive,
            });
          });
          projectCommitted = true;
          const postCommit = requireSupportedProjectInspectionV2(
            await inspectProjectFileV2(root, confirmationInput.projectId)
          );
          if (!sameJson(postCommit.project, committed.project)) {
            throw new CreativeStudioStoreError('storage_error', 'Studio reference confirmation project changed');
          }
          await resolveReferenceAuthorizationReceiptsV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: postCommit,
          });
          const finalLedger = await readReferenceRequestLedgerV2({
            root,
            projectId: confirmationInput.projectId,
            directories: reserved.ledger.directories,
          });
          const handoff = referenceGenerationHandoffV2(finalLedger, confirmationInput.handoffId);
          const authorization = committed.project.spendAuthorizations.find(
            (candidate) => candidate.originReferenceHandoffId === confirmationInput.handoffId
          );
          if (
            authorization === undefined ||
            handoff?.receipt?.result.kind !== 'confirmed' ||
            handoff.receipt.result.authorizationId !== authorization.id ||
            handoff.receipt.completedAt !== authorization.confirmedAt
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Studio reference confirmation receipt is missing');
          }
          return committed;
        });
      } catch (error) {
        if (projectCommitted) await repairSummaryV2AfterCommit();
        throw error;
      }
      await repairSummaryV2AfterCommit();
      return result;
    },

    async updateProjectV2(
      projectId: string,
      update: (project: StudioProjectV2) => StudioProjectV2,
      expectedRevision?: number,
      commitTag?: string
    ): Promise<StudioProjectV2> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      const result = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const inspected = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        return updateProjectV2InsideQueue(root, inspected, update, expectedRevision, commitTag ?? null);
      });
      await repairSummaryV2AfterCommit();
      return result;
    },

    async withProjectAuthorityV2<T>(
      projectId: string,
      operation: (snapshot: StudioProjectAuthoritySnapshotV2) => Promise<T>
    ): Promise<T> {
      if (!isSafeIdV2(projectId) || typeof operation !== 'function') {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority request');
      }
      let projectCommitted = false;
      let projectDeleted = false;
      let result: T;
      try {
        result = await enqueue(projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
          );
          let scopeActive = true;
          let mutationUsed = false;
          let commitPromise: Promise<StudioProjectV2> | null = null;
          let deletePromise: Promise<boolean> | null = null;
          let operationFailed = false;
          let operationError: unknown;
          let operationResult: T;
          let settlementFailed = false;
          let settlementError: unknown;
          try {
            operationResult = await operation({
              project: structuredClone(inspected.project),
              projectDir: inspected.directory.path,
              assertCurrent: () => {
                if (!scopeActive) {
                  throw new CreativeStudioStoreError('storage_error', 'Studio project authority has expired');
                }
                return assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
              },
              commit: (update, expectedRevision, commitTag, authorizeBeforeReplace) => {
                if (!scopeActive || mutationUsed || typeof update !== 'function') {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority commit')
                  );
                }
                if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision')
                  );
                }
                if (commitTag !== undefined && typeof commitTag !== 'string') {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project commit tag')
                  );
                }
                if (authorizeBeforeReplace !== undefined && typeof authorizeBeforeReplace !== 'function') {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project commit authorizer')
                  );
                }
                mutationUsed = true;
                commitPromise = updateProjectV2InsideQueue(
                  root,
                  inspected,
                  update,
                  expectedRevision,
                  commitTag ?? null,
                  authorizeBeforeReplace
                ).then((committed) => {
                  projectCommitted = true;
                  return committed;
                });
                return commitPromise;
              },
              delete: (expectedRevision, authorizeBeforeDelete) => {
                if (
                  !scopeActive ||
                  mutationUsed ||
                  !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
                  (authorizeBeforeDelete !== undefined && typeof authorizeBeforeDelete !== 'function')
                ) {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority deletion')
                  );
                }
                mutationUsed = true;
                deletePromise = deleteSupportedProjectV2InsideQueue(
                  root,
                  inspected,
                  expectedRevision,
                  authorizeBeforeDelete
                ).then((deleted) => {
                  projectDeleted = deleted;
                  return deleted;
                });
                return deletePromise;
              },
            });
          } catch (error) {
            operationFailed = true;
            operationError = error;
          } finally {
            try {
              try {
                await commitPromise;
                await deletePromise;
              } catch (error) {
                if (!operationFailed) {
                  settlementFailed = true;
                  settlementError = error;
                }
              }
            } finally {
              scopeActive = false;
            }
          }
          if (operationFailed) throw operationError;
          if (settlementFailed) throw settlementError;
          return operationResult!;
        });
      } catch (error) {
        if (projectCommitted || projectDeleted) await repairSummaryV2AfterCommit();
        throw error;
      }
      if (projectCommitted || projectDeleted) await repairSummaryV2AfterCommit();
      return result;
    },

    async deleteProjectWithSidecarAuthorityV2(
      projectId: string,
      expectedRevision: number,
      operation: (snapshot: StudioProjectDeletionAuthoritySnapshotV2) => Promise<boolean>
    ): Promise<boolean> {
      if (
        !isSafeIdV2(projectId) ||
        !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        typeof operation !== 'function'
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project deletion authority request');
      }
      let projectDeleted = false;
      let result: boolean;
      try {
        result = await enqueue(projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) return false;
          const marker = await readProjectDeletionMarkerV2(root, projectId);
          if (marker !== null && marker.record.expectedRevision !== expectedRevision) {
            throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
          }
          let inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
          if (marker !== null) {
            const pending = await inspectProjectFileV2(root, projectId);
            if (pending.status !== 'supported') {
              await finishProjectDeletionV2(root, marker);
              projectDeleted = true;
              return true;
            }
            if (
              pending.project.revision !== expectedRevision ||
              marker.record.directoryDev !== pending.directory.dev ||
              marker.record.directoryIno !== pending.directory.ino ||
              marker.record.projectSha256 !== sha256Utf8(pending.bytes)
            ) {
              throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker changed');
            }
            inspected = pending;
          } else {
            const current = await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId);
            if (current.status === 'not_found') return false;
            if (current.status === 'unsupported_prototype_schema') {
              throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
            }
            if (current.status === 'malformed_v2') throw current.error;
            inspected = current;
          }

          let scopeActive = true;
          let deleteUsed = false;
          let deletePromise: Promise<boolean> | null = null;
          let operationFailed = false;
          let operationError: unknown;
          let operationResult = false;
          let settlementFailed = false;
          let settlementError: unknown;
          const assertCurrent = async (): Promise<void> => {
            if (!scopeActive) {
              throw new CreativeStudioStoreError('storage_error', 'Studio project deletion authority has expired');
            }
            await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
            const currentMarker = await readProjectDeletionMarkerV2(root, projectId);
            if (
              marker === null
                ? currentMarker !== null
                : currentMarker === null ||
                  currentMarker.bytes !== marker.bytes ||
                  !sameIdentityV2(currentMarker.identity, marker.identity)
            ) {
              throw new CreativeStudioStoreError('storage_error', 'Studio project deletion authority changed');
            }
          };
          try {
            operationResult = await operation({
              project: structuredClone(inspected.project),
              projectDir: inspected.directory.path,
              assertCurrent,
              delete: (revision, authorizeBeforeDelete) => {
                if (
                  !scopeActive ||
                  deleteUsed ||
                  revision !== expectedRevision ||
                  (authorizeBeforeDelete !== undefined && typeof authorizeBeforeDelete !== 'function')
                ) {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority deletion')
                  );
                }
                deleteUsed = true;
                deletePromise = (async () => {
                  if (marker === null) {
                    return deleteSupportedProjectV2InsideQueue(root, inspected, revision, authorizeBeforeDelete);
                  }
                  await authorizeBeforeDelete?.();
                  await assertCurrent();
                  await finishProjectDeletionV2(root, marker);
                  return true;
                })().then((deleted) => {
                  projectDeleted = deleted;
                  return deleted;
                });
                return deletePromise;
              },
            });
          } catch (error) {
            operationFailed = true;
            operationError = error;
          } finally {
            try {
              try {
                await deletePromise;
              } catch (error) {
                if (!operationFailed) {
                  settlementFailed = true;
                  settlementError = error;
                }
              }
            } finally {
              scopeActive = false;
            }
          }
          if (operationFailed) throw operationError;
          if (settlementFailed) throw settlementError;
          return operationResult;
        });
      } catch (error) {
        if (projectDeleted) await repairSummaryV2AfterCommit();
        throw error;
      }
      if (projectDeleted) await repairSummaryV2AfterCommit();
      return result;
    },

    async deleteProjectV2(projectId: string, expectedRevision: number): Promise<boolean> {
      if (!isSafeIdV2(projectId)) return false;
      if (!isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      const deleted = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) return false;
        const existingMarker = await readProjectDeletionMarkerV2(root, projectId);
        if (existingMarker !== null) {
          if (existingMarker.record.expectedRevision !== expectedRevision) {
            throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
          }
          await finishProjectDeletionV2(root, existingMarker);
          return true;
        }
        const inspected = await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId);
        if (inspected.status === 'not_found') return false;
        if (inspected.status === 'unsupported_prototype_schema') {
          throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
        }
        if (inspected.status === 'malformed_v2') throw inspected.error;
        return deleteSupportedProjectV2InsideQueue(root, inspected, expectedRevision);
      });
      if (deleted) await repairSummaryV2AfterCommit();
      return deleted;
    },

    async listProposalsV2(projectId: string): Promise<StudioProposalV2[]> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal project identity');
      }
      return listProposalsV2ThroughQueue(projectId);
    },

    async recordProposalV2(input: StudioRecordProposalInputV2): Promise<StudioProposalRecordV2> {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, new Set(['projectId', 'proposalId', 'baseRevision', 'payload'])) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeProposalId(input.proposalId) ||
        !isIntegerInRange(input.baseRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isRecord(input.payload)
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal record request');
      }
      return enqueue(input.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, input.projectId)
        );
        if (snapshot.project.revision !== input.baseRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        const directories = await resolveProposalDirectoriesV2({
          root,
          project: snapshot.directory,
          createIfWhollyAbsent: true,
          snapshot,
        });
        if (directories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal storage is unavailable');
        }
        const currentLedger = await readCleanProposalLedgerV2InsideQueue({
          root,
          projectId: input.projectId,
          snapshot,
          createIfWhollyAbsent: true,
        });
        const existing = currentLedger?.proposals.get(input.proposalId)?.record;
        if (existing !== undefined) {
          if (
            existing.baseRevision !== input.baseRevision ||
            !sameJson(existing.payload, input.payload) ||
            existing.status !== 'pending'
          ) {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal identity collision');
          }
          return structuredClone(existing);
        }
        let record: StudioProposalRecordV2;
        try {
          record = await writeProposalRecordV2({
            pendingDir: directories.pending.path,
            projectId: input.projectId,
            baseRevision: input.baseRevision,
            payload: structuredClone(input.payload),
            proposalId: input.proposalId,
            fs,
            now: () => new Date(now()),
            projectAuthority: {
              canonicalRoot: snapshot.directory.path,
              rootIdentity: { dev: snapshot.directory.dev, ino: snapshot.directory.ino },
            },
            authorityFence: async () => {
              try {
                await Promise.all([
                  assertProposalDirectoryAuthoritiesV2(directories),
                  assertProjectSnapshotCurrentV2({ root, snapshot }),
                ]);
                return 'valid';
              } catch {
                return 'invalid';
              }
            },
          });
        } catch (error) {
          if (error instanceof StudioProposalWriteError && error.code === 'capacity') {
            throw new CreativeStudioStoreError('busy', 'Studio proposal inbox is full');
          }
          if (error instanceof StudioProposalWriteError && error.code === 'too_large') {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal exceeds the size cap');
          }
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal could not be recorded');
        }
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        const finalLedger = await readCleanProposalLedgerV2InsideQueue({
          root,
          projectId: input.projectId,
          snapshot,
          createIfWhollyAbsent: false,
        });
        const durable = finalLedger?.proposals.get(input.proposalId)?.record;
        if (durable === undefined || !sameJson(durable, record)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication changed');
        }
        return structuredClone(durable);
      });
    },

    async acceptProposalV2(projectId: string, proposalId: string): Promise<StudioProposalAcceptanceResultV2> {
      if (!isSafeIdV2(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      const accepted = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        return acceptProposalV2InsideQueue({ root, projectId, proposalId, snapshot });
      });
      await repairSummaryV2AfterCommit();
      return accepted;
    },

    async rejectProposalV2(projectId: string, proposalId: string): Promise<StudioProposalV2> {
      if (!isSafeIdV2(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        let ledger = await readCleanProposalLedgerV2InsideQueue({
          root,
          projectId,
          snapshot,
          createIfWhollyAbsent: false,
        });
        if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        ledger = await reapProposalLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
        const proposal = ledger.proposals.get(proposalId);
        if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        let decision = ledger.decisions.get(proposalId);
        if (decision !== undefined) {
          if (decision.record.status !== 'rejected') {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
          }
          await releaseProposalSlotV2({
            root,
            ledger,
            proposal,
            decision,
            slot: ledger.slots.get(proposalId)?.[0],
            projectSnapshot: snapshot,
          });
          await assertProjectSnapshotCurrentV2({ root, snapshot });
          return effectiveProposalV2(proposal.record, decision.record);
        }
        const slot = assertPendingProposalSlotV2(ledger, proposalId);
        const decidedAt = now();
        if (!isCanonicalIsoTimestamp(decidedAt)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
        }
        decision = await publishProposalDecisionV2({
          root,
          projectId,
          directories: ledger.directories,
          proposal,
          status: 'rejected',
          decidedAt,
          authorizeBeforeLink: async (temporary) => {
            await assertProjectSnapshotCurrentV2({ root, snapshot });
            await assertProposalLedgerEntrySetCurrentV2(ledger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.pending,
                identified: proposal,
              }),
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.slots,
                identified: slot,
              }),
              assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposalId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root, snapshot });
          },
        });
        await releaseProposalSlotV2({
          root,
          ledger: { ...ledger, decisions: new Map(ledger.decisions).set(proposalId, decision) },
          proposal,
          decision,
          slot,
          projectSnapshot: snapshot,
        });
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        return effectiveProposalV2(proposal.record, decision.record);
      });
    },

    async reapAbandonedProposalsV2(): Promise<void> {
      const root = await existingCanonicalRootV2();
      if (root === null) return;
      const sweep = await scanProjectsV2(root);
      await Promise.all(
        sweep.supportedProjectIds.map((projectId) =>
          enqueue(projectId, async () => {
            const snapshot = requireSupportedProjectInspectionV2(
              await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
            );
            const ledger = await readCleanProposalLedgerV2InsideQueue({
              root,
              projectId,
              snapshot,
              createIfWhollyAbsent: false,
            });
            if (ledger !== null) {
              await reapProposalLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
            }
          })
        )
      );
    },

    async watchProposalsV2(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>> {
      const root = await writableCanonicalRootV2();
      let closed = false;
      const observedStatuses = new Map<string, StudioProposalV2['status']>();
      const validateAndNotify = async (relativeFile: string): Promise<void> => {
        const segments = path.normalize(relativeFile).split(path.sep);
        if (
          segments.length !== 4 ||
          !isSafeIdV2(segments[0]) ||
          segments[1] !== 'proposals' ||
          (segments[2] !== 'pending' && segments[2] !== 'decisions') ||
          !segments[3].endsWith('.json')
        ) {
          return;
        }
        const projectId = segments[0];
        const proposalId = segments[3].slice(0, -'.json'.length);
        if (!isSafeProposalId(proposalId)) return;
        try {
          const proposal = (await listProposalsV2ThroughQueue(projectId)).find(
            (candidate) => candidate.id === proposalId
          );
          if (closed || proposal === undefined) return;
          const key = `${projectId}:${proposalId}`;
          if (observedStatuses.get(key) === proposal.status) return;
          observedStatuses.set(key, proposal.status);
          listener(projectId, proposalId);
        } catch (error) {
          if (!closed) safeLogError('[CreativeStudio] Schema-2 proposal watcher ignored an invalid record', error);
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
            if (!closed) safeLogError('[CreativeStudio] Schema-2 proposal watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Schema-2 Studio proposal watcher could not start');
      }
      return async (): Promise<void> => {
        if (closed) return;
        closed = true;
        watcher.close();
      };
    },

    async watchBriefsV2(listener: (projectId: string) => void): Promise<() => Promise<void>> {
      const root = await writableCanonicalRootV2();
      let closed = false;
      const pending = new Map<string, Promise<void>>();
      const validateAndNotify = (relativeFile: string): void => {
        const segments = path.normalize(relativeFile).split(path.sep);
        if (segments.length !== 2 || !isSafeIdV2(segments[0]) || segments[1] !== STUDIO_BRIEF_FILE_NAME) return;
        const projectId = segments[0];
        const previous = pending.get(projectId) ?? Promise.resolve();
        const current = previous
          .catch((): undefined => undefined)
          .then(async () => {
            if (closed) return;
            const result = await inspectProjectThroughAttributionFenceV2(root, projectId);
            if (result.status === 'malformed_v2') throw result.error;
            if (!closed && result.status === 'supported') listener(projectId);
          })
          .catch((error: unknown) => {
            if (!closed) safeLogError('[CreativeStudio] Schema-2 Brief watcher ignored an invalid file', error);
          })
          .finally(() => {
            if (pending.get(projectId) === current) pending.delete(projectId);
          });
        pending.set(projectId, current);
      };
      let watcher: { close(): void };
      try {
        watcher = watchProposalTree({
          rootDir: root,
          onChange: (relativeFile) => {
            if (!closed) validateAndNotify(relativeFile);
          },
          onError: (error) => {
            if (!closed) safeLogError('[CreativeStudio] Schema-2 Brief watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Schema-2 Studio Brief watcher could not start');
      }
      return async (): Promise<void> => {
        if (closed) return;
        closed = true;
        watcher.close();
        await Promise.allSettled(pending.values());
      };
    },

    async resolveProposalPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal project identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        const directories = await resolveProposalDirectoriesV2({
          root,
          project: snapshot.directory,
          createIfWhollyAbsent: true,
          snapshot,
        });
        if (directories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal storage is unavailable');
        }
        return { projectDir: snapshot.directory.path, pendingDir: directories.pending.path };
      });
    },

    async listReferenceRequestsV2(projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request project identity');
      }
      return listReferenceRequestsV2ThroughQueue(projectId);
    },

    async decideReferenceRequestV2(
      input: StudioDecideReferenceRequestInputV2
    ): Promise<StudioReferenceRequestLedgerEntryV2> {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, REFERENCE_DECIDE_INPUT_KEYS) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeIdV2(input.requestId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isRecord(input.outcome) ||
        ((input.outcome.kind === 'rejected' || input.outcome.kind === 'generation_gate') &&
          !hasExactKeys(input.outcome, REFERENCE_REJECTED_INTENT_KEYS)) ||
        (input.outcome.kind !== 'rejected' && input.outcome.kind !== 'generation_gate')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request decision input');
      }
      const decisionInput = structuredClone(input);
      return enqueue(decisionInput.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, decisionInput.projectId)
        );
        return decideReferenceRequestV2InsideQueue({ root, decisionInput, snapshot });
      });
    },

    async readReferenceGenerationHandoffV2(
      projectId: string,
      handoffId: string
    ): Promise<StudioReferenceGenerationHandoffStoreV2 | null> {
      if (!isSafeIdV2(projectId) || !isSafeIdV2(handoffId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference handoff identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
          root,
          projectId,
          snapshot,
          createIfWhollyAbsent: false,
        });
        const result = ledger === null ? null : referenceGenerationHandoffV2(ledger, handoffId);
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        return result;
      });
    },

    async recordReferenceGenerationHandoffReceiptV2(
      input: StudioRecordReferenceGenerationHandoffReceiptInputV2
    ): Promise<StudioReferenceGenerationHandoffStoreV2> {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, REFERENCE_RECEIPT_INPUT_KEYS) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeIdV2(input.handoffId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isRecord(input.result) ||
        (input.result.kind === 'dismissed' && !hasExactKeys(input.result, REFERENCE_DISMISSED_RESULT_KEYS)) ||
        (input.result.kind === 'confirmed' &&
          (!hasExactKeys(input.result, REFERENCE_CONFIRMED_RESULT_KEYS) ||
            !isSafeIdV2(input.result.authorizationId))) ||
        (input.result.kind !== 'dismissed' && input.result.kind !== 'confirmed')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference handoff receipt input');
      }
      const receiptInput = structuredClone(input);
      return enqueue(receiptInput.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, receiptInput.projectId)
        );
        return recordReferenceGenerationHandoffReceiptV2InsideQueue({ root, receiptInput, snapshot });
      });
    },

    async reapAbandonedReferenceRequestsV2(): Promise<void> {
      const root = await existingCanonicalRootV2();
      if (root === null) return;
      const sweep = await scanProjectsV2(root);
      await Promise.all(
        sweep.supportedProjectIds.map((projectId) =>
          enqueue(projectId, async () => {
            const snapshot = requireSupportedProjectInspectionV2(
              await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
            );
            const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
              root,
              projectId,
              snapshot,
              createIfWhollyAbsent: false,
            });
            if (ledger !== null) {
              await reapReferenceRequestLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
            }
          })
        )
      );
    },

    async watchReferenceRequestsV2(
      listener: (projectId: string, requestId: string) => void
    ): Promise<() => Promise<void>> {
      const root = await writableCanonicalRootV2();
      let closed = false;
      const observedSignatures = new Map<string, string>();
      const validateAndNotify = async (relativeFile: string): Promise<void> => {
        const segments = path.normalize(relativeFile).split(path.sep);
        if (
          segments.length !== 4 ||
          !isSafeIdV2(segments[0]) ||
          segments[1] !== 'reference-requests' ||
          (segments[2] !== 'pending' && segments[2] !== 'decisions' && segments[2] !== 'receipts') ||
          !segments[3].endsWith('.json')
        ) {
          return;
        }
        const projectId = segments[0];
        const recordId = segments[3].slice(0, -'.json'.length);
        if (!isSafeIdV2(recordId)) return;
        try {
          const entries = await listReferenceRequestsV2ThroughQueue(projectId);
          const entry =
            segments[2] === 'receipts'
              ? entries.find(
                  (candidate) =>
                    candidate.decision?.outcome.kind === 'generation_gate' &&
                    candidate.decision.outcome.handoffId === recordId
                )
              : entries.find((candidate) => candidate.request.id === recordId);
          if (closed || entry === undefined) return;
          const key = `${projectId}:${entry.request.id}`;
          const signature = serializeJsonExact({
            request: entry.request,
            decision: entry.decision,
            receipt: entry.receipt,
          });
          if (observedSignatures.get(key) === signature) return;
          observedSignatures.set(key, signature);
          listener(projectId, entry.request.id);
        } catch (error) {
          if (!closed) safeLogError('[CreativeStudio] Schema-2 reference watcher ignored an invalid record', error);
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
            if (!closed) safeLogError('[CreativeStudio] Schema-2 reference watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Schema-2 Studio reference watcher could not start');
      }
      return async (): Promise<void> => {
        if (closed) return;
        closed = true;
        watcher.close();
      };
    },

    async resolveReferenceRequestPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request project identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        const directories = await resolveReferenceRequestDirectoriesV2({
          root,
          project: snapshot.directory,
          createIfWhollyAbsent: true,
          snapshot,
        });
        if (directories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio reference request storage unavailable');
        }
        return { projectDir: snapshot.directory.path, pendingDir: directories.pending.path };
      });
    },

    async getVerifiedProjectDirectoryV2(projectId: string): Promise<string | null> {
      if (!isSafeIdV2(projectId)) return null;
      const root = await existingCanonicalRootV2();
      if (root === null) return null;
      const inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      if (inspected.status === 'not_found') return null;
      if (inspected.status === 'unsupported_prototype_schema') {
        throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
      }
      if (inspected.status === 'malformed_v2') throw inspected.error;
      return inspected.directory.path;
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
