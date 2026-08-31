/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';
import { hasRuleToken, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_PIECES_V3,
  STUDIO_MAX_PIECE_PRIOR_HANDLES_V3,
  type StudioGenerationTargetV2,
  type StudioPieceGenerationTargetV3,
  type StudioPieceJobV3,
  type StudioPieceJobRetryReasonV3,
  type StudioPiecePhotoSettingsV3,
  type StudioProjectV3,
  type StudioQuotedGeneration,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioPieceHandleV3 } from '../mutations/pieceHandles';
import { normalizeStudioPieceWordsV3, validateStudioPieceGenerationCompositionV3 } from './composition';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const QUOTED_GENERATION_ID_NAMESPACE = 'creative-studio/quoted-generation/v2';
const AUTOMATIC_REFERENCE_RETRY_JOB_ID_NAMESPACE = 'creative-studio/automatic-reference-retry-job/v2';
const PIECE_QUOTED_GENERATION_ID_NAMESPACE = 'creative-studio/piece-quoted-generation/v1';
const AUTHORING_FINGERPRINT_DOMAIN_V3 = 'weprompt:studio-authoring:v1';

export type StudioQuotedGenerationIdentityInput = {
  projectId: string;
  projectRevision: number;
  target: StudioGenerationTargetV2;
  purpose: StudioQuotedGeneration['purpose'];
};

// Schema 5 historically relied on RegExp.test coercion here. Keep that observable behavior frozen;
// schema-6 inputs use the strict guard below instead.
const assertSafeIdV2 = (value: string, field: string): void => {
  if (!SAFE_STUDIO_ID.test(value)) throw new TypeError(`${field} must be a safe Studio ID`);
};

const assertSafeIdV3: (value: unknown, field: string) => asserts value is string = (value, field) => {
  if (typeof value !== 'string' || !SAFE_STUDIO_ID.test(value)) {
    throw new TypeError(`${field} must be a safe Studio ID`);
  }
};

export const studioGenerationTargetKey = (target: StudioGenerationTargetV2): string => {
  const id = target.kind === 'shot' ? target.shotId : target.referenceId;
  assertSafeIdV2(id, target.kind === 'shot' ? 'shotId' : 'referenceId');
  return `${target.kind}:${id}`;
};

/** Returns the deterministic identity of one quoted target/purpose pair at one project revision. */
export const createStudioQuotedGenerationId = (input: StudioQuotedGenerationIdentityInput): string => {
  assertSafeIdV2(input.projectId, 'projectId');
  const targetKey = studioGenerationTargetKey(input.target);
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 1) {
    throw new RangeError('projectRevision must be a positive safe integer');
  }
  if (
    input.purpose !== 'seed_still' &&
    input.purpose !== 'board_still' &&
    input.purpose !== 'video_take' &&
    input.purpose !== 'reference_image'
  ) {
    throw new TypeError('purpose must be a Studio generation purpose');
  }
  const canonical = [
    QUOTED_GENERATION_ID_NAMESPACE,
    input.projectId,
    Number.prototype.toString.call(input.projectRevision),
    targetKey,
    input.purpose,
  ].join('\0');
  return `item_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

/**
 * Returns the one deterministic job identity for an authorization's reserved reference retry.
 * Re-derivation after a crash therefore finds the same durable attempt instead of minting another.
 */
export const createStudioAutomaticReferenceRetryJobId = (input: {
  authorizationId: string;
  itemId: string;
  idempotencyKey: string;
}): string => {
  assertSafeIdV2(input.authorizationId, 'authorizationId');
  assertSafeIdV2(input.itemId, 'itemId');
  assertSafeIdV2(input.idempotencyKey, 'idempotencyKey');
  const canonical = [
    AUTOMATIC_REFERENCE_RETRY_JOB_ID_NAMESPACE,
    input.authorizationId,
    input.itemId,
    input.idempotencyKey,
  ].join('\0');
  return `job_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

const positiveSafeIntegerV3 = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${field} must be a positive safe integer`);
};

const exactDataRecordV3 = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    return (
      ownKeys.length === keys.length &&
      ownKeys.every((key) => typeof key === 'string' && keys.includes(key)) &&
      keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
      })
    );
  } catch {
    return false;
  }
};

const matchesExactDataRecordV3 = (value: unknown, keys: readonly string[]): boolean => exactDataRecordV3(value, keys);

const exactDeclaredDataRecordV3 = (
  value: unknown,
  requiredKeys: readonly string[],
  declaredKeys: readonly string[]
): value is Record<string, unknown> => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key !== 'string' || !declaredKeys.includes(key)) ||
      requiredKeys.some((key) => !ownKeys.includes(key))
    ) {
      return false;
    }
    return ownKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
};

const ownDataRecordKeysV3 = (value: unknown): string[] | null => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) return null;
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    }
    return ownKeys as string[];
  } catch {
    return null;
  }
};

const validPieceRetryReasonV3 = (value: unknown): value is StudioPieceJobRetryReasonV3 =>
  value === 'provider_failure' || value === 'submission_unknown' || value === 'variation_grid' || value === 'cancelled';

const validatePieceSettingsV3 = (settings: StudioPiecePhotoSettingsV3): void => {
  if (
    !exactDataRecordV3(settings, ['aspectRatio', 'resolution']) ||
    (settings.aspectRatio !== '16:9' &&
      settings.aspectRatio !== '9:16' &&
      settings.aspectRatio !== '1:1' &&
      settings.aspectRatio !== '4:3' &&
      settings.aspectRatio !== '3:4') ||
    (settings.resolution !== '720p' && settings.resolution !== '1080p')
  ) {
    throw new TypeError('settings are invalid');
  }
};

export const studioPieceGenerationTargetKeyV3 = (target: StudioPieceGenerationTargetV3): string => {
  if (!exactDataRecordV3(target, ['kind', 'pieceId']) || target.kind !== 'piece') {
    throw new TypeError('target must be an exact Piece target');
  }
  assertSafeIdV3(target.pieceId, 'pieceId');
  return `piece:${target.pieceId}`;
};

/**
 * Derives one durable item identity from fields frozen into the quote. Fresh retries cannot collide
 * merely because their authored project state and Piece target stayed unchanged: each attempt has
 * a distinct Main-issued reservation and quote identity.
 */
export const createStudioPieceQuotedGenerationIdV3 = (input: {
  projectId: string;
  reservationId: string;
  quoteId: string;
  quoteRevision: number;
  target: StudioPieceGenerationTargetV3;
  purpose: 'piece_image';
}): string => {
  if (!exactDataRecordV3(input, ['projectId', 'reservationId', 'quoteId', 'quoteRevision', 'target', 'purpose'])) {
    throw new TypeError('quoted generation identity input must be exact');
  }
  assertSafeIdV3(input.projectId, 'projectId');
  assertSafeIdV3(input.reservationId, 'reservationId');
  assertSafeIdV3(input.quoteId, 'quoteId');
  positiveSafeIntegerV3(input.quoteRevision, 'quoteRevision');
  if (input.purpose !== 'piece_image') throw new TypeError('purpose must be piece_image');
  const canonical = [
    PIECE_QUOTED_GENERATION_ID_NAMESPACE,
    input.projectId,
    input.reservationId,
    input.quoteId,
    String(input.quoteRevision),
    studioPieceGenerationTargetKeyV3(input.target),
    input.purpose,
  ].join('\0');
  return `item_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

export type StudioPiecePreparedAuthoringArmV3 =
  | {
      mode: 'create';
      reservedPieceId: string;
      proposedHandle: string;
      orderIndex: number;
      words: string;
      settings: StudioPiecePhotoSettingsV3;
    }
  | {
      mode: 'retry';
      existingPieceId: string;
      sourceJobId: string;
      words: string;
      settings: StudioPiecePhotoSettingsV3;
    };

type StudioAuthoringProjectFieldsV3 =
  | 'id'
  | 'authoringRevision'
  | 'name'
  | 'brief'
  | 'rules'
  | 'forgeProjectId'
  | 'briefConversationId'
  | 'spendPolicy'
  | 'pieceOrder'
  | 'pieces';

type StudioAuthoringJobTopologyV3 = Pick<
  StudioPieceJobV3,
  'id' | 'projectId' | 'target' | 'purpose' | 'retryOfJobId' | 'retryReason'
> &
  Partial<Omit<StudioPieceJobV3, 'id' | 'projectId' | 'target' | 'purpose' | 'retryOfJobId' | 'retryReason'>>;

type StudioAuthoringRetryJobV3 = StudioAuthoringJobTopologyV3 & Pick<StudioPieceJobV3, 'composition'>;

type StudioAuthoringProjectV3 = Pick<StudioProjectV3, StudioAuthoringProjectFieldsV3> &
  Partial<Omit<StudioProjectV3, StudioAuthoringProjectFieldsV3 | 'jobs'>> & {
    jobs?: Record<string, StudioAuthoringJobTopologyV3>;
  };

export type StudioAuthoringFingerprintInputV3 =
  | {
      project: StudioAuthoringProjectV3;
      prepared: Extract<StudioPiecePreparedAuthoringArmV3, { mode: 'create' }>;
    }
  | {
      project: StudioAuthoringProjectV3 & { jobs: Record<string, StudioAuthoringRetryJobV3> };
      prepared: Extract<StudioPiecePreparedAuthoringArmV3, { mode: 'retry' }>;
    };

const AUTHORING_FINGERPRINT_INPUT_KEYS_V3 = ['project', 'prepared'] as const;
const AUTHORING_PROJECT_KEYS_V3 = [
  'id',
  'authoringRevision',
  'name',
  'brief',
  'rules',
  'forgeProjectId',
  'briefConversationId',
  'spendPolicy',
  'pieceOrder',
  'pieces',
] as const;
const DECLARED_PROJECT_KEYS_V3 = [
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
] as const;
const CREATE_AUTHORING_ARM_KEYS_V3 = [
  'mode',
  'reservedPieceId',
  'proposedHandle',
  'orderIndex',
  'words',
  'settings',
] as const;
const RETRY_AUTHORING_ARM_KEYS_V3 = ['mode', 'existingPieceId', 'sourceJobId', 'words', 'settings'] as const;
const PIECE_KEYS_V3 = [
  'id',
  'kind',
  'handle',
  'priorHandles',
  'currentAssetId',
  'jobIds',
  'createdAt',
  'updatedAt',
] as const;
const AUTHORING_JOB_TOPOLOGY_KEYS_V3 = ['id', 'projectId', 'target', 'purpose', 'retryOfJobId', 'retryReason'] as const;
const DECLARED_JOB_KEYS_V3 = [
  'id',
  'projectId',
  'target',
  'purpose',
  'status',
  'provider',
  'idempotencyKey',
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
] as const;

const isDensePlainArrayV3 = (value: unknown, maximum: number): value is unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      nodeTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum
    ) {
      return false;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      !(
        ownKeys.length === value.length + 1 &&
        ownKeys.every(
          (key) =>
            key === 'length' ||
            (typeof key === 'string' && /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length)
        )
      )
    ) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const canonicalTimestampV3 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const validateAuthoringRulesV3 = (value: unknown): boolean => {
  if (!isDensePlainArrayV3(value, STUDIO_RULE_LIMITS.maxRules)) return false;
  const ruleIds = new Set<string>();
  return value.every((rule) => {
    if (
      !exactDataRecordV3(rule, ['id', 'scope', 'text', 'predicate', 'createdAt']) ||
      typeof rule.id !== 'string' ||
      !SAFE_STUDIO_ID.test(rule.id) ||
      ruleIds.has(rule.id) ||
      rule.scope !== 'project' ||
      typeof rule.text !== 'string' ||
      rule.text.trim().length === 0 ||
      rule.text.length > STUDIO_RULE_LIMITS.text ||
      !canonicalTimestampV3(rule.createdAt)
    ) {
      return false;
    }
    ruleIds.add(rule.id);
    if (rule.predicate === null) return true;
    if (
      !exactDataRecordV3(rule.predicate, ['kind', 'terms']) ||
      rule.predicate.kind !== 'forbidden_terms' ||
      !isDensePlainArrayV3(rule.predicate.terms, STUDIO_RULE_LIMITS.maxTerms) ||
      rule.predicate.terms.length === 0
    ) {
      return false;
    }
    const terms = new Set<string>();
    return rule.predicate.terms.every((term) => {
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
      return true;
    });
  });
};

const canonicalJsonV3 = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV3).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonV3(record[key])}`)
    .join(',')}}`;
};

/** Hashes authored project meaning plus the exact create arm or persisted retry lineage. */
export const createStudioAuthoringFingerprintV3 = (input: StudioAuthoringFingerprintInputV3): string => {
  if (!exactDataRecordV3(input, AUTHORING_FINGERPRINT_INPUT_KEYS_V3)) {
    throw new TypeError('authoring fingerprint input must be exact');
  }
  const { project, prepared } = input;
  if (!exactDeclaredDataRecordV3(project, AUTHORING_PROJECT_KEYS_V3, DECLARED_PROJECT_KEYS_V3)) {
    throw new TypeError('authoring project payload must be exact');
  }
  const pieceMapKeys = ownDataRecordKeysV3(project.pieces);
  if (
    pieceMapKeys === null ||
    typeof project.name !== 'string' ||
    project.name.trim().length === 0 ||
    project.name !== project.name.trim() ||
    project.name.length > 256 ||
    typeof project.brief !== 'string' ||
    project.brief.length > 16 * 1024 ||
    !validateAuthoringRulesV3(project.rules) ||
    (project.forgeProjectId !== null &&
      (typeof project.forgeProjectId !== 'string' || !SAFE_STUDIO_ID.test(project.forgeProjectId))) ||
    (project.briefConversationId !== null &&
      (typeof project.briefConversationId !== 'string' || !SAFE_STUDIO_ID.test(project.briefConversationId))) ||
    (project.spendPolicy !== null &&
      (!exactDataRecordV3(project.spendPolicy, ['currency', 'maxPerBatchMinorUnits']) ||
        typeof project.spendPolicy.currency !== 'string' ||
        !/^[A-Z]{3}$/u.test(project.spendPolicy.currency) ||
        !Number.isSafeInteger(project.spendPolicy.maxPerBatchMinorUnits) ||
        project.spendPolicy.maxPerBatchMinorUnits < 0))
  ) {
    throw new TypeError('authoring project payload is invalid');
  }
  assertSafeIdV3(project.id, 'projectId');
  positiveSafeIntegerV3(project.authoringRevision, 'authoringRevision');
  if (!isDensePlainArrayV3(project.pieceOrder, STUDIO_MAX_PIECES_V3)) {
    throw new TypeError('pieceOrder is invalid');
  }
  const handleNamespace = new Set<string>();
  const seenPieces = new Set<string>();
  const pieces = project.pieceOrder.map((pieceId) => {
    assertSafeIdV3(pieceId, 'pieceOrder[]');
    if (seenPieces.has(pieceId)) throw new TypeError('pieceOrder must be unique');
    seenPieces.add(pieceId);
    const piece = Object.hasOwn(project.pieces, pieceId) ? project.pieces[pieceId] : undefined;
    if (
      !exactDataRecordV3(piece, PIECE_KEYS_V3) ||
      piece?.id !== pieceId ||
      piece.kind !== 'photograph' ||
      !isCanonicalStudioPieceHandleV3(piece.handle) ||
      !isDensePlainArrayV3(piece.priorHandles, STUDIO_MAX_PIECE_PRIOR_HANDLES_V3) ||
      piece.priorHandles.some((handle) => !isCanonicalStudioPieceHandleV3(handle)) ||
      new Set(piece.priorHandles).size !== piece.priorHandles.length ||
      piece.priorHandles.includes(piece.handle)
    ) {
      throw new TypeError('pieceOrder must resolve exact Pieces');
    }
    for (const handle of [piece.handle, ...piece.priorHandles]) {
      if (handleNamespace.has(handle)) throw new TypeError('Piece handle namespace must be unique');
      handleNamespace.add(handle);
    }
    return { id: piece.id, kind: piece.kind, handle: piece.handle, priorHandles: [...piece.priorHandles] };
  });
  if (pieceMapKeys.length !== pieces.length) throw new TypeError('pieces must match pieceOrder');
  const exactCreateArm = matchesExactDataRecordV3(prepared, CREATE_AUTHORING_ARM_KEYS_V3);
  const exactRetryArm = matchesExactDataRecordV3(prepared, RETRY_AUTHORING_ARM_KEYS_V3);
  if (
    (!exactCreateArm && !exactRetryArm) ||
    (exactCreateArm && prepared.mode !== 'create') ||
    (exactRetryArm && prepared.mode !== 'retry')
  ) {
    throw new TypeError('prepared authoring arm must be exact');
  }
  validatePieceSettingsV3(prepared.settings);
  const words = normalizeStudioPieceWordsV3(prepared.words);
  if (words !== prepared.words) throw new TypeError('prepared words must already be normalized');

  let preparedPayload: Record<string, unknown>;
  if (prepared.mode === 'create') {
    assertSafeIdV3(prepared.reservedPieceId, 'reservedPieceId');
    if (
      !isCanonicalStudioPieceHandleV3(prepared.proposedHandle) ||
      handleNamespace.has(prepared.proposedHandle) ||
      !Number.isSafeInteger(prepared.orderIndex) ||
      prepared.orderIndex < 0 ||
      prepared.orderIndex > pieces.length ||
      Object.hasOwn(project.pieces, prepared.reservedPieceId)
    ) {
      throw new TypeError('create authoring arm is invalid');
    }
    preparedPayload = {
      mode: 'create',
      reservedPieceId: prepared.reservedPieceId,
      proposedHandle: prepared.proposedHandle,
      orderIndex: prepared.orderIndex,
      words,
      settings: { ...prepared.settings },
    };
  } else {
    assertSafeIdV3(prepared.existingPieceId, 'existingPieceId');
    assertSafeIdV3(prepared.sourceJobId, 'sourceJobId');
    if (!Object.hasOwn(project.pieces, prepared.existingPieceId)) {
      throw new TypeError('retry authoring arm is invalid');
    }
    const targetPiece = project.pieces[prepared.existingPieceId]!;
    const persistedJobs = project.jobs;
    if (
      ownDataRecordKeysV3(persistedJobs) === null ||
      !isDensePlainArrayV3(targetPiece.jobIds, STUDIO_MAX_JOBS_PER_PIECE_V3) ||
      targetPiece.jobIds.length === 0
    ) {
      throw new TypeError('retry requires persisted Piece jobs');
    }
    const persistedJobMap = persistedJobs as Record<string, unknown>;
    const jobIds = new Set<string>();
    const parents = new Set<string>();
    const lineage = targetPiece.jobIds.map((jobId, index) => {
      assertSafeIdV3(jobId, 'Piece.jobIds[]');
      if (jobIds.has(jobId)) throw new TypeError('retry lineage must be unique');
      const job = Object.hasOwn(persistedJobMap, jobId) ? persistedJobMap[jobId] : undefined;
      if (
        !exactDeclaredDataRecordV3(job, AUTHORING_JOB_TOPOLOGY_KEYS_V3, DECLARED_JOB_KEYS_V3) ||
        job.id !== jobId ||
        job.projectId !== project.id ||
        !exactDataRecordV3(job.target, ['kind', 'pieceId']) ||
        job.target.kind !== 'piece' ||
        job.target.pieceId !== prepared.existingPieceId ||
        job.purpose !== 'piece_image'
      ) {
        throw new TypeError('Piece job order must resolve persisted jobs for the retry target');
      }
      const retryOfJobIdValue = job.retryOfJobId;
      const retryReasonValue = job.retryReason;
      if (retryOfJobIdValue !== null) assertSafeIdV3(retryOfJobIdValue, 'jobs[].retryOfJobId');
      if (retryReasonValue !== null && !validPieceRetryReasonV3(retryReasonValue)) {
        throw new TypeError('retry lineage topology is invalid');
      }
      const retryOfJobId = retryOfJobIdValue as string | null;
      const retryReason = retryReasonValue as StudioPieceJobRetryReasonV3 | null;
      if (
        (index === 0) !== (retryOfJobId === null) ||
        (retryOfJobId === null) !== (retryReason === null) ||
        (retryOfJobId !== null && !jobIds.has(retryOfJobId)) ||
        (retryOfJobId !== null && parents.has(retryOfJobId))
      ) {
        throw new TypeError('retry lineage topology is invalid');
      }
      if (retryOfJobId !== null) parents.add(retryOfJobId);
      jobIds.add(jobId);
      return { jobId, retryOfJobId, retryReason };
    });
    if (lineage.at(-1)?.jobId !== prepared.sourceJobId) {
      throw new TypeError('sourceJobId must be the latest persisted Piece job');
    }
    const sourceJob = persistedJobs[prepared.sourceJobId];
    if (
      sourceJob === undefined ||
      !validateStudioPieceGenerationCompositionV3(sourceJob.composition) ||
      sourceJob.composition.inputs.source.pieceId !== prepared.existingPieceId ||
      sourceJob.composition.inputs.purpose !== 'piece_image' ||
      sourceJob.composition.inputs.source.words !== words ||
      sourceJob.composition.inputs.source.settings.aspectRatio !== prepared.settings.aspectRatio ||
      sourceJob.composition.inputs.source.settings.resolution !== prepared.settings.resolution
    ) {
      throw new TypeError('retry words and settings must exactly match the latest persisted Piece job');
    }
    preparedPayload = {
      mode: 'retry',
      existingPieceId: prepared.existingPieceId,
      sourceJobId: prepared.sourceJobId,
      lineage,
      words,
      settings: { ...prepared.settings },
    };
  }

  const payload = {
    version: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    project: {
      id: project.id,
      authoringRevision: project.authoringRevision,
      name: project.name,
      brief: project.brief,
      rules: project.rules,
      directorBinding: {
        forgeProjectId: project.forgeProjectId,
        briefConversationId: project.briefConversationId,
      },
      spendPolicy: project.spendPolicy,
      pieces,
    },
    prepared: preparedPayload,
  };
  return createHash('sha256')
    .update(`${AUTHORING_FINGERPRINT_DOMAIN_V3}\0${canonicalJsonV3(payload)}`, 'utf8')
    .digest('hex');
};
