/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type {
  ClaimInitialPresentationDispatchRequest,
  ClaimInitialPresentationDispatchResult,
  DiscardPresentationRunRequest,
  DiscardPresentationRunResult,
  DispatchInitialPresentationRunRequest,
  DispatchInitialPresentationRunResult,
  GetPresentationRunRequest,
  GetPresentationRunResult,
  ListRecoverablePresentationRunsRequest,
  ListRecoverablePresentationRunsResult,
  OpenPresentationRunRequest,
  OpenPresentationRunResult,
  PresentationRunFailure,
  PresentationRunFailureCode,
  PresentationRunPublicDto,
  PresentationSourceRef,
  RenewInitialPresentationDispatchRequest,
  RenewInitialPresentationDispatchResult,
  StartPresentationRunRequest,
  StartPresentationRunResult,
} from '@/common/types/office/presentationRun';
import {
  PresentationTemplateResolutionError,
  type PresentationTemplateService,
  type ResolvedPresentationTemplate,
} from '@/process/services/presentation-template/PresentationTemplateService';
import { TEMPLATE_ID_RE } from '@/process/services/presentation-template/templateManifest';
import {
  PresentationCanonicalCorruptionError,
  PresentationJournalRecoveryRequiredError,
  PresentationJournalTransactionError,
  PresentationRunSimulatedProcessCrashError,
  PresentationRunStoreError,
  PresentationSourceSnapshotError,
  PresentationSourceStoreError,
  type ClaimedPresentationSourceSnapshot,
  type PresentationRunFiles,
  type PresentationRunPreparationPayload,
  type PresentationRunStore,
  type PresentationSourceSnapshotReader,
  type StoredPresentationRunManifest,
  hasExactPassedPresentationReadiness,
  hasExactPresentationTerminalEvidence,
} from '../storage';
import { buildPresentationRunDirective } from './presentationRunDirective';
import {
  buildPresentationGrounding,
  extractPresentationSources,
  PresentationSourceExtractionError,
  type ExtractedPresentationSource,
  type PresentationSourceExtractionInput,
} from './presentationSourceExtractor';
import type { PresentationRunLifecycleCoordinator } from './PresentationRunLifecycleCoordinator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const LEASE_TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;

const isSamePresentationConversation = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizePresentationConversationId(left);
  return normalizedLeft !== null && normalizedLeft === normalizePresentationConversationId(right);
};

const canonicalPresentationConversationId = (value: string): string =>
  normalizePresentationConversationId(value) ?? value;

export type PresentationRunAuthorityResolution =
  | {
      ok: true;
      principalId: string;
      scope: 'individual' | 'team';
      runtime: string | null;
    }
  | { ok: false; code: 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'SCOPE_UNAVAILABLE' };

export type PresentationRunServiceOptions = {
  files: Pick<
    PresentationRunFiles,
    'getStagingRunPaths' | 'prepareRunAssets' | 'withAuthorizedSourceSnapshot' | 'readAuthorizedRunPreparation'
  >;
  store: Pick<
    PresentationRunStore,
    | 'allocateRun'
    | 'transitionRun'
    | 'getClaimedSourceSnapshots'
    | 'commitPreparedRun'
    | 'recordPostAllocationFailure'
    | 'getRun'
    | 'getByRequest'
    | 'listPublicRecoverable'
    | 'discardRun'
  >;
  templates: Pick<PresentationTemplateService, 'getById'>;
  lifecycle: Pick<PresentationRunLifecycleCoordinator, 'claimInitialDispatch' | 'renewInitialDispatch' | 'dispatch'>;
  isFeatureEnabled: () => boolean;
  isDesktopRuntime: () => boolean;
  resolveAuthority: (input: { conversationId: string }) => Promise<PresentationRunAuthorityResolution>;
  recoveryCursorSecret?: Uint8Array;
  extractSources?: typeof extractPresentationSources;
  now?: () => Date;
};

export type PreparedPresentationRunDispatch = {
  runId: string;
  rawInput: string;
  directive: string;
  sourceRefs: PresentationSourceRef[];
  injectSkills: ['officecli'];
  files: [string, string];
  planPath: string;
};

type NormalizedStartRequest = StartPresentationRunRequest;
type NormalizedLeaseRequest = RenewInitialPresentationDispatchRequest;

type AuthorizedPresentationConversation = Extract<PresentationRunAuthorityResolution, { ok: true }>;

type PresentationRecoveryCursor = {
  conversationId: string;
  updatedAt: string;
  runId: string;
};

class PresentationRunPreparationFailure extends Error {
  constructor(readonly failure: PresentationRunFailure) {
    super(failure.code);
    this.name = 'PresentationRunPreparationFailure';
  }
}

function simulatedProcessCrash(
  error: unknown,
  seen = new Set<object>()
): PresentationRunSimulatedProcessCrashError | null {
  if (error instanceof PresentationRunSimulatedProcessCrashError) return error;
  if (typeof error !== 'object' || error === null || seen.has(error)) return null;
  seen.add(error);
  if ('cause' in error) {
    const nested = simulatedProcessCrash(error.cause, seen);
    if (nested !== null) return nested;
  }
  if ('operationError' in error) {
    const nested = simulatedProcessCrash(error.operationError, seen);
    if (nested !== null) return nested;
  }
  return 'cleanupError' in error ? simulatedProcessCrash(error.cleanupError, seen) : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function failureState(code: PresentationRunFailureCode): string {
  if (code === 'RUN_NOT_FOUND' || code === 'RUN_FORBIDDEN') return 'lookup';
  if (
    code === 'SOURCE_GRANT_INVALID' ||
    code === 'SOURCE_GRANT_EXPIRED' ||
    code === 'SOURCE_GRANT_FOREIGN' ||
    code === 'SOURCE_GRANT_REPLAYED' ||
    code === 'SOURCE_TAMPERED' ||
    code === 'SOURCE_LIMIT_EXCEEDED' ||
    code === 'SOURCE_FORMAT_UNSUPPORTED'
  ) {
    return code === 'SOURCE_GRANT_EXPIRED' ? 'grant_expired' : 'grant_validation';
  }
  return 'preflight';
}

function runFailure(
  code: PresentationRunFailureCode,
  details: Record<string, unknown> | null = null
): PresentationRunFailure {
  return {
    ok: false,
    code,
    messageKey: `conversation.presentationRun.${code}`,
    retryable: false,
    state: failureState(code),
    details: code === 'PERSISTENCE_FAILED' ? { postInvoked: false } : details,
  } as PresentationRunFailure;
}

function stateConflict(run: StoredPresentationRunManifest): PresentationRunFailure {
  return {
    ok: false,
    code: 'RUN_STATE_CONFLICT',
    messageKey: 'conversation.presentationRun.RUN_STATE_CONFLICT',
    retryable: false,
    state: 'lookup',
    details: { runId: run.runId, dispatchStatus: run.dispatchStatus },
  };
}

function normalizeRequest(value: unknown): NormalizedStartRequest | null {
  const conversationId = isPlainRecord(value) ? normalizePresentationConversationId(value.conversation_id) : null;
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['conversation_id', 'client_request_id', 'input', 'selected_template_id', 'sources']) ||
    conversationId === null ||
    typeof value.client_request_id !== 'string' ||
    !UUID_RE.test(value.client_request_id) ||
    typeof value.input !== 'string' ||
    value.input.trim().length === 0 ||
    value.input.length > PRESENTATION_RUN_LIMITS.MAX_EXTRACTED_CHARS_PER_SOURCE ||
    typeof value.selected_template_id !== 'string' ||
    !TEMPLATE_ID_RE.test(value.selected_template_id) ||
    !Array.isArray(value.sources) ||
    value.sources.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN
  ) {
    return null;
  }

  const sources: PresentationSourceRef[] = [];
  const grantIds = new Set<string>();
  let totalBytes = 0;
  for (const source of value.sources) {
    if (
      !isPlainRecord(source) ||
      !hasExactKeys(source, ['grantId', 'expectedByteLength', 'expectedSha256']) ||
      typeof source.grantId !== 'string' ||
      !UUID_RE.test(source.grantId) ||
      !Number.isSafeInteger(source.expectedByteLength) ||
      (source.expectedByteLength as number) < 1 ||
      (source.expectedByteLength as number) > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
      typeof source.expectedSha256 !== 'string' ||
      !SHA256_RE.test(source.expectedSha256)
    ) {
      return null;
    }
    const normalizedGrantId = source.grantId.toLowerCase();
    if (grantIds.has(normalizedGrantId)) return null;
    grantIds.add(normalizedGrantId);
    totalBytes += source.expectedByteLength as number;
    if (totalBytes > PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES) return null;
    sources.push({
      grantId: normalizedGrantId,
      expectedByteLength: source.expectedByteLength as number,
      expectedSha256: source.expectedSha256,
    });
  }

  return {
    conversation_id: conversationId,
    client_request_id: value.client_request_id.toLowerCase(),
    input: value.input,
    selected_template_id: value.selected_template_id,
    sources,
  };
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function normalizeGetRequest(value: unknown): GetPresentationRunRequest | null {
  const conversationId = isPlainRecord(value) ? normalizePresentationConversationId(value.conversation_id) : null;
  if (!isPlainRecord(value) || conversationId === null) return null;
  if (
    hasExactKeys(value, ['conversation_id', 'run_id']) &&
    typeof value.run_id === 'string' &&
    UUID_RE.test(value.run_id)
  ) {
    return { conversation_id: conversationId, run_id: value.run_id.toLowerCase() };
  }
  if (
    hasExactKeys(value, ['conversation_id', 'client_request_id']) &&
    typeof value.client_request_id === 'string' &&
    UUID_RE.test(value.client_request_id)
  ) {
    return {
      conversation_id: conversationId,
      client_request_id: value.client_request_id.toLowerCase(),
    };
  }
  return null;
}

function normalizeListRequest(value: unknown): ListRecoverablePresentationRunsRequest | null {
  const conversationId = isPlainRecord(value) ? normalizePresentationConversationId(value.conversation_id) : null;
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ['conversation_id', 'cursor', 'limit']) ||
    conversationId === null ||
    (value.cursor !== undefined &&
      (typeof value.cursor !== 'string' ||
        value.cursor.length < 3 ||
        value.cursor.length > 2048 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.cursor))) ||
    (value.limit !== undefined &&
      (!Number.isSafeInteger(value.limit) ||
        (value.limit as number) < PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_MIN_LIMIT ||
        (value.limit as number) > PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_MAX_LIMIT))
  ) {
    return null;
  }
  return {
    conversation_id: conversationId,
    ...(value.cursor === undefined ? {} : { cursor: value.cursor as string }),
    ...(value.limit === undefined ? {} : { limit: value.limit as number }),
  };
}

function normalizeOpenRequest(value: unknown): OpenPresentationRunRequest | null {
  const conversationId = isPlainRecord(value) ? normalizePresentationConversationId(value.conversation_id) : null;
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['conversation_id', 'run_id', 'expected_sha256']) ||
    conversationId === null ||
    typeof value.run_id !== 'string' ||
    !UUID_RE.test(value.run_id) ||
    typeof value.expected_sha256 !== 'string' ||
    !SHA256_RE.test(value.expected_sha256)
  ) {
    return null;
  }
  return {
    conversation_id: conversationId,
    run_id: value.run_id.toLowerCase(),
    expected_sha256: value.expected_sha256,
  };
}

function normalizeDiscardRequest(value: unknown): DiscardPresentationRunRequest | null {
  const conversationId = isPlainRecord(value) ? normalizePresentationConversationId(value.conversation_id) : null;
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['conversation_id', 'run_id', 'expected_revision']) ||
    conversationId === null ||
    typeof value.run_id !== 'string' ||
    !UUID_RE.test(value.run_id) ||
    !Number.isSafeInteger(value.expected_revision) ||
    (value.expected_revision as number) < 0
  ) {
    return null;
  }
  return {
    conversation_id: conversationId,
    run_id: value.run_id.toLowerCase(),
    expected_revision: value.expected_revision as number,
  };
}

function normalizeClaimRequest(value: unknown): ClaimInitialPresentationDispatchRequest | null {
  const conversationId = isPlainRecord(value) ? normalizePresentationConversationId(value.conversation_id) : null;
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['conversation_id', 'run_id', 'holder_id', 'expected_revision']) ||
    conversationId === null ||
    typeof value.run_id !== 'string' ||
    !UUID_RE.test(value.run_id) ||
    typeof value.holder_id !== 'string' ||
    !UUID_RE.test(value.holder_id) ||
    !Number.isSafeInteger(value.expected_revision) ||
    (value.expected_revision as number) < 0
  ) {
    return null;
  }
  return {
    conversation_id: conversationId,
    run_id: value.run_id.toLowerCase(),
    holder_id: value.holder_id.toLowerCase(),
    expected_revision: value.expected_revision as number,
  };
}

function normalizeLeaseRequest(value: unknown): NormalizedLeaseRequest | null {
  const conversationId = isPlainRecord(value) ? normalizePresentationConversationId(value.conversation_id) : null;
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ['conversation_id', 'run_id', 'lease_token', 'expected_revision']) ||
    conversationId === null ||
    typeof value.run_id !== 'string' ||
    !UUID_RE.test(value.run_id) ||
    typeof value.lease_token !== 'string' ||
    !LEASE_TOKEN_RE.test(value.lease_token) ||
    !Number.isSafeInteger(value.expected_revision) ||
    (value.expected_revision as number) < 0
  ) {
    return null;
  }
  return {
    conversation_id: conversationId,
    run_id: value.run_id.toLowerCase(),
    lease_token: value.lease_token,
    expected_revision: value.expected_revision as number,
  };
}

function isDiscardQualified(run: StoredPresentationRunManifest): boolean {
  if ((run.dispatchStatus === 'allocating' || run.dispatchStatus === 'committed') && !run.postInvoked) return true;
  if (run.dispatchStatus === 'failed_retained') return true;
  return run.dispatchStatus === 'retained' && run.disposition === 'REVIEW_REQUIRED';
}

// Electron exposes external Office applications only through a mutable path.
// There is no exact-byte handle transfer available on every supported desktop.
const EXACT_BYTE_SYSTEM_OPEN_AVAILABLE = false;

function canOpenRecovery(run: StoredPresentationRunManifest): boolean {
  const hasExactEvidence = hasExactPassedPresentationReadiness(run);
  const hasExactTerminalProof = hasExactPresentationTerminalEvidence(run);
  return (
    EXACT_BYTE_SYSTEM_OPEN_AVAILABLE &&
    run.dispatchStatus === 'retained' &&
    run.artifactPhase === 'rendered_exact_hash' &&
    run.disposition === 'REVIEW_REQUIRED' &&
    hasExactTerminalProof &&
    hasExactEvidence
  );
}

function toPublicRun(run: StoredPresentationRunManifest): PresentationRunPublicDto {
  const base = {
    runId: run.runId,
    clientRequestId: run.clientRequestId,
    conversationId: canonicalPresentationConversationId(run.conversationId),
    selectedTemplateId: run.selectedTemplateId,
    revision: run.revision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
  if (run.dispatchStatus === 'discarded') {
    if (run.artifactPhase !== null || run.disposition !== null || run.retainedCandidate !== null) {
      throw new Error('Invalid discarded presentation run projection');
    }
    return {
      ...base,
      dispatchStatus: 'discarded',
      artifactPhase: null,
      disposition: null,
      retainedCandidate: null,
      actions: { openAllowed: false, discardAllowed: false },
    };
  }
  if (run.artifactPhase === null) throw new Error('Invalid presentation run projection');
  return {
    ...base,
    dispatchStatus: run.dispatchStatus,
    artifactPhase: run.artifactPhase,
    disposition: run.disposition,
    retainedCandidate:
      run.retainedCandidate === null
        ? null
        : { sha256: run.retainedCandidate.sha256, byteLength: run.retainedCandidate.byteLength },
    actions: {
      openAllowed: canOpenRecovery(run),
      discardAllowed: isDiscardQualified(run),
    },
  } as PresentationRunPublicDto;
}

function runStateFailure(run: StoredPresentationRunManifest): PresentationRunFailure {
  return {
    ok: false,
    code: 'RUN_STATE_CONFLICT',
    messageKey: 'conversation.presentationRun.RUN_STATE_CONFLICT',
    retryable: false,
    state: 'lookup',
    details: { runId: run.runId, dispatchStatus: run.dispatchStatus },
  };
}

type RecoveryDenialFailure = Extract<PresentationRunFailure, { code: 'UNSAFE_TO_OPEN' | 'UNSAFE_TO_DISCARD' }>;

const RECOVERY_DENIAL_STATE_BY_DISPATCH_STATUS = {
  allocating: 'committed',
  committed: 'committed',
  dispatching: 'dispatching',
  bound: 'bound',
  terminal_verified: 'bound',
  retained: 'retained',
  failed_retained: 'retained',
  dispatch_uncertain: 'dispatch_uncertain',
  discarded: 'retained',
} as const satisfies Record<StoredPresentationRunManifest['dispatchStatus'], RecoveryDenialFailure['state']>;

function recoveryDenialFailure(
  code: RecoveryDenialFailure['code'],
  runId: string,
  dispatchStatus: StoredPresentationRunManifest['dispatchStatus']
): RecoveryDenialFailure {
  return {
    ok: false,
    code,
    messageKey: `conversation.presentationRun.${code}`,
    retryable: false,
    state: RECOVERY_DENIAL_STATE_BY_DISPATCH_STATUS[dispatchStatus],
    details: { runId },
  };
}

function mintRecoveryCursor(cursor: PresentationRecoveryCursor, secret: Buffer): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      conversationId: cursor.conversationId,
      updatedAt: cursor.updatedAt,
      runId: cursor.runId,
    })
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function parseRecoveryCursor(value: string, conversationId: string, secret: Buffer): PresentationRecoveryCursor | null {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, encodedSignature] = parts;
  if (payload === undefined || encodedSignature === undefined) return null;
  let signature: Buffer;
  let decoded: unknown;
  try {
    signature = Buffer.from(encodedSignature, 'base64url');
    if (signature.toString('base64url') !== encodedSignature) return null;
    const payloadBytes = Buffer.from(payload, 'base64url');
    if (payloadBytes.toString('base64url') !== payload) return null;
    decoded = JSON.parse(payloadBytes.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  const expectedSignature = createHmac('sha256', secret).update(payload).digest();
  if (signature.length !== expectedSignature.length || !timingSafeEqual(signature, expectedSignature)) return null;
  if (
    !isPlainRecord(decoded) ||
    !hasExactKeys(decoded, ['version', 'conversationId', 'updatedAt', 'runId']) ||
    decoded.version !== 1 ||
    !isSamePresentationConversation(decoded.conversationId, conversationId) ||
    typeof decoded.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(decoded.updatedAt)) ||
    typeof decoded.runId !== 'string' ||
    !UUID_RE.test(decoded.runId)
  ) {
    return null;
  }
  return { conversationId, updatedAt: decoded.updatedAt, runId: decoded.runId.toLowerCase() };
}

/** Hashes the exact user request and ordered opaque source claims, excluding the retry request id. */
export function createPresentationRunRequestFingerprint(request: StartPresentationRunRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        conversationId: request.conversation_id.toLowerCase(),
        rawInput: request.input,
        selectedTemplateId: request.selected_template_id,
        sources: request.sources.map((source) => ({
          grantId: source.grantId.toLowerCase(),
          expectedByteLength: source.expectedByteLength,
          expectedSha256: source.expectedSha256.toLowerCase(),
        })),
      })
    )
    .digest('hex');
}

function startSuccess(run: StoredPresentationRunManifest): StartPresentationRunResult {
  if (run.dispatchStatus !== 'committed' || run.artifactPhase !== 'sources_extracted') {
    return stateConflict(run);
  }
  return {
    ok: true,
    run: {
      runId: run.runId,
      clientRequestId: run.clientRequestId,
      conversationId: canonicalPresentationConversationId(run.conversationId),
      selectedTemplateId: run.selectedTemplateId,
      revision: run.revision,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      dispatchStatus: 'committed',
      artifactPhase: 'sources_extracted',
      disposition: null,
      retainedCandidate: null,
      actions: { openAllowed: false, discardAllowed: true },
    },
  };
}

function preparationFailure(error: unknown): PresentationRunFailure {
  if (error instanceof PresentationRunPreparationFailure) return error.failure;
  if (error instanceof PresentationTemplateResolutionError) return runFailure(error.code);
  if (error instanceof PresentationSourceExtractionError) {
    return runFailure(error.code, error.code === 'RESOURCE_LIMIT_EXCEEDED' ? null : { grantId: error.grantId });
  }
  if (error instanceof PresentationSourceSnapshotError) return runFailure(error.code);
  if (error instanceof PresentationSourceStoreError) return runFailure(error.code, error.details);
  if (error instanceof PresentationRunStoreError) return runFailure(error.code);
  if (
    error instanceof PresentationCanonicalCorruptionError ||
    error instanceof PresentationJournalRecoveryRequiredError ||
    error instanceof PresentationJournalTransactionError
  ) {
    return runFailure('PERSISTENCE_FAILED');
  }
  return runFailure('INTERNAL_ERROR');
}

async function extractClaimedSources(
  claimed: readonly ClaimedPresentationSourceSnapshot[],
  files: PresentationRunServiceOptions['files'],
  extractSources: typeof extractPresentationSources
): Promise<ExtractedPresentationSource[]> {
  const inputs: PresentationSourceExtractionInput[] = [];
  const enterLease = async (index: number): Promise<ExtractedPresentationSource[]> => {
    const source = claimed[index];
    if (source === undefined) return extractSources([...inputs]);
    try {
      return await files.withAuthorizedSourceSnapshot(
        {
          grantId: source.grantId,
          format: source.format,
          relativePath: source.snapshotRelativePath,
          sha256: source.sha256,
          byteLength: source.byteLength,
        },
        async (snapshot: PresentationSourceSnapshotReader) => {
          inputs.push({
            grantId: source.grantId,
            displayName: source.displayName,
            format: source.format,
            byteLength: source.byteLength,
            sha256: source.sha256,
            snapshot: {
              byteLength: snapshot.byteLength,
              readBytes: snapshot.readBytes,
            },
          });
          try {
            return await enterLease(index + 1);
          } finally {
            inputs.pop();
          }
        }
      );
    } catch (error) {
      if (error instanceof PresentationSourceSnapshotError) {
        throw new PresentationRunPreparationFailure(runFailure(error.code, { grantId: source.grantId }));
      }
      throw error;
    }
  };
  return enterLease(0);
}

/** Main-process preparation authority for a managed presentation start. */
export class PresentationRunService {
  private readonly options: PresentationRunServiceOptions;
  private readonly extractSources: typeof extractPresentationSources;
  private readonly now: () => Date;
  private readonly recoveryCursorSecret: Buffer;
  private readonly starts = new Map<string, Promise<StartPresentationRunResult>>();

  constructor(options: PresentationRunServiceOptions) {
    this.options = options;
    this.extractSources = options.extractSources ?? extractPresentationSources;
    this.now = options.now ?? (() => new Date());
    this.recoveryCursorSecret = Buffer.from(options.recoveryCursorSecret ?? randomBytes(32));
    if (this.recoveryCursorSecret.length < 32) throw new Error('Presentation recovery cursor secret is too short');
  }

  async start(unsafeRequest: StartPresentationRunRequest): Promise<StartPresentationRunResult> {
    if (!this.options.isFeatureEnabled()) return runFailure('FEATURE_DISABLED');
    if (!this.options.isDesktopRuntime()) return runFailure('DESKTOP_REQUIRED');
    const request = normalizeRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST');

    let authority: PresentationRunAuthorityResolution;
    try {
      authority = await this.options.resolveAuthority({ conversationId: request.conversation_id });
    } catch {
      return runFailure('SCOPE_UNAVAILABLE');
    }
    if (authority.ok === false) return runFailure(authority.code);
    if (authority.scope !== 'individual') return runFailure('TEAM_SCOPE_UNSUPPORTED');
    if (authority.runtime !== 'aionrs' && authority.runtime !== 'acp') return runFailure('RUNTIME_UNSUPPORTED');
    if (
      authority.principalId.length < 1 ||
      authority.principalId.length > 256 ||
      authority.principalId.includes('\u0000')
    ) {
      return runFailure('SCOPE_UNAVAILABLE');
    }

    const fingerprint = createPresentationRunRequestFingerprint(request);
    const inFlightKey = `${authority.principalId}\u0000${request.conversation_id}\u0000${request.client_request_id}\u0000${fingerprint}`;
    const existing = this.starts.get(inFlightKey);
    if (existing !== undefined) return existing;
    const pending = this.startPrepared(request, fingerprint, authority.principalId).finally(() =>
      this.starts.delete(inFlightKey)
    );
    this.starts.set(inFlightKey, pending);
    return pending;
  }

  async claimInitialDispatch(
    unsafeRequest: ClaimInitialPresentationDispatchRequest
  ): Promise<ClaimInitialPresentationDispatchResult> {
    if (!this.options.isFeatureEnabled())
      return runFailure('FEATURE_DISABLED') as ClaimInitialPresentationDispatchResult;
    if (!this.options.isDesktopRuntime())
      return runFailure('DESKTOP_REQUIRED') as ClaimInitialPresentationDispatchResult;
    const request = normalizeClaimRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST') as ClaimInitialPresentationDispatchResult;
    const authorization = await this.authorizeConversation(request.conversation_id);
    if ('failure' in authorization) return authorization.failure as ClaimInitialPresentationDispatchResult;
    return this.options.lifecycle.claimInitialDispatch(request);
  }

  async renewInitialDispatch(
    unsafeRequest: RenewInitialPresentationDispatchRequest
  ): Promise<RenewInitialPresentationDispatchResult> {
    if (!this.options.isFeatureEnabled())
      return runFailure('FEATURE_DISABLED') as RenewInitialPresentationDispatchResult;
    if (!this.options.isDesktopRuntime())
      return runFailure('DESKTOP_REQUIRED') as RenewInitialPresentationDispatchResult;
    const request = normalizeLeaseRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST') as RenewInitialPresentationDispatchResult;
    const authorization = await this.authorizeConversation(request.conversation_id);
    if ('failure' in authorization) return authorization.failure as RenewInitialPresentationDispatchResult;
    return this.options.lifecycle.renewInitialDispatch(request);
  }

  async dispatch(unsafeRequest: DispatchInitialPresentationRunRequest): Promise<DispatchInitialPresentationRunResult> {
    if (!this.options.isFeatureEnabled()) return runFailure('FEATURE_DISABLED') as DispatchInitialPresentationRunResult;
    if (!this.options.isDesktopRuntime()) return runFailure('DESKTOP_REQUIRED') as DispatchInitialPresentationRunResult;
    const request = normalizeLeaseRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST') as DispatchInitialPresentationRunResult;
    const authorization = await this.authorizeConversation(request.conversation_id);
    if ('failure' in authorization) return authorization.failure as DispatchInitialPresentationRunResult;
    return this.options.lifecycle.dispatch(request, authorization.value.runtime as 'aionrs' | 'acp');
  }

  /** Returns an authorized, path-free projection for an existing durable run. */
  async get(unsafeRequest: GetPresentationRunRequest): Promise<GetPresentationRunResult> {
    const request = normalizeGetRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST');
    const authorization = await this.authorizeConversation(request.conversation_id);
    if ('failure' in authorization) return authorization.failure;
    let run: StoredPresentationRunManifest | null;
    try {
      run =
        'run_id' in request
          ? await this.options.store.getRun(request.run_id)
          : await this.options.store.getByRequest(request.conversation_id, request.client_request_id);
    } catch {
      return runFailure('PERSISTENCE_FAILED');
    }
    if (run === null || !isSamePresentationConversation(run.conversationId, request.conversation_id)) {
      return runFailure('RUN_NOT_FOUND');
    }
    try {
      return { ok: true, run: toPublicRun(run) };
    } catch {
      return runFailure('PERSISTENCE_FAILED');
    }
  }

  /** Lists only authorized public recovery states using a main-authenticated cursor. */
  async listRecoverable(
    unsafeRequest: ListRecoverablePresentationRunsRequest
  ): Promise<ListRecoverablePresentationRunsResult> {
    const request = normalizeListRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST');
    const authorization = await this.authorizeConversation(request.conversation_id);
    if ('failure' in authorization) return authorization.failure;
    const cursor =
      request.cursor === undefined
        ? null
        : parseRecoveryCursor(request.cursor, request.conversation_id, this.recoveryCursorSecret);
    if (request.cursor !== undefined && cursor === null) return runFailure('INVALID_REQUEST');

    let runs: StoredPresentationRunManifest[];
    try {
      runs = await this.options.store.listPublicRecoverable(request.conversation_id);
    } catch {
      return runFailure('PERSISTENCE_FAILED');
    }
    if (runs.some((run) => !isSamePresentationConversation(run.conversationId, request.conversation_id))) {
      return runFailure('PERSISTENCE_FAILED');
    }

    let offset = 0;
    if (cursor !== null) {
      const index = runs.findIndex((run) => run.runId === cursor.runId && run.updatedAt === cursor.updatedAt);
      if (index < 0) return runFailure('INVALID_REQUEST');
      offset = index + 1;
    }
    const limit = request.limit ?? PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_DEFAULT_LIMIT;
    const selected = runs.slice(offset, offset + limit);
    try {
      const items = selected.map(toPublicRun);
      const last = selected.at(-1);
      const nextCursor =
        last !== undefined && offset + selected.length < runs.length
          ? mintRecoveryCursor(
              { conversationId: request.conversation_id, updatedAt: last.updatedAt, runId: last.runId },
              this.recoveryCursorSecret
            )
          : null;
      return { ok: true, items, nextCursor };
    } catch {
      return runFailure('PERSISTENCE_FAILED');
    }
  }

  /** Keeps Open fail-closed until the desktop can transfer exact bytes instead of a mutable path. */
  async openRecovery(unsafeRequest: OpenPresentationRunRequest): Promise<OpenPresentationRunResult> {
    const request = normalizeOpenRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST');
    const authorization = await this.authorizeConversation(request.conversation_id);
    if ('failure' in authorization) return authorization.failure;
    let run: StoredPresentationRunManifest | null;
    try {
      run = await this.options.store.getRun(request.run_id);
    } catch {
      return runFailure('PERSISTENCE_FAILED');
    }
    if (run === null || !isSamePresentationConversation(run.conversationId, request.conversation_id)) {
      return runFailure('RUN_NOT_FOUND');
    }
    const candidate = run.retainedCandidate;
    if (candidate === null || candidate.sha256 !== request.expected_sha256 || !canOpenRecovery(run)) {
      return recoveryDenialFailure('UNSAFE_TO_OPEN', run.runId, run.dispatchStatus);
    }
    return recoveryDenialFailure('UNSAFE_TO_OPEN', run.runId, run.dispatchStatus);
  }

  /** Discards only pre-dispatch or safely retained records; uncertain runs remain immutable. */
  async discard(unsafeRequest: DiscardPresentationRunRequest): Promise<DiscardPresentationRunResult> {
    const request = normalizeDiscardRequest(unsafeRequest);
    if (request === null) return runFailure('INVALID_REQUEST');
    const authorization = await this.authorizeConversation(request.conversation_id);
    if ('failure' in authorization) return authorization.failure;
    let run: StoredPresentationRunManifest | null;
    try {
      run = await this.options.store.getRun(request.run_id);
    } catch {
      return runFailure('PERSISTENCE_FAILED');
    }
    if (run === null || !isSamePresentationConversation(run.conversationId, request.conversation_id)) {
      return runFailure('RUN_NOT_FOUND');
    }
    if (run.dispatchStatus === 'discarded') {
      let completedTombstone: StoredPresentationRunManifest;
      try {
        completedTombstone = await this.options.store.discardRun(run.runId, request.expected_revision);
      } catch {
        return runFailure('PERSISTENCE_FAILED');
      }
      if (
        !isSamePresentationConversation(completedTombstone.conversationId, request.conversation_id) ||
        completedTombstone.dispatchStatus !== 'discarded'
      ) {
        return runFailure('PERSISTENCE_FAILED');
      }
      return {
        ok: true,
        runId: completedTombstone.runId,
        discardedAt: completedTombstone.updatedAt,
        alreadyDiscarded: true,
      };
    }
    if (run.revision !== request.expected_revision) return runStateFailure(run);
    if (!isDiscardQualified(run)) {
      return recoveryDenialFailure('UNSAFE_TO_DISCARD', run.runId, run.dispatchStatus);
    }

    let discarded: StoredPresentationRunManifest;
    try {
      discarded = await this.options.store.discardRun(run.runId, request.expected_revision);
    } catch {
      let current: StoredPresentationRunManifest | null;
      try {
        current = await this.options.store.getRun(run.runId);
      } catch {
        return runFailure('PERSISTENCE_FAILED');
      }
      if (!isSamePresentationConversation(current?.conversationId, request.conversation_id)) {
        return runFailure('PERSISTENCE_FAILED');
      }
      if (current.dispatchStatus === 'discarded') {
        try {
          discarded = await this.options.store.discardRun(current.runId, request.expected_revision);
        } catch {
          return runFailure('PERSISTENCE_FAILED');
        }
        if (
          !isSamePresentationConversation(discarded.conversationId, request.conversation_id) ||
          discarded.dispatchStatus !== 'discarded'
        ) {
          return runFailure('PERSISTENCE_FAILED');
        }
        return { ok: true, runId: discarded.runId, discardedAt: discarded.updatedAt, alreadyDiscarded: false };
      }
      if (current.revision !== request.expected_revision) return runStateFailure(current);
      return runFailure('PERSISTENCE_FAILED');
    }
    if (
      !isSamePresentationConversation(discarded.conversationId, request.conversation_id) ||
      discarded.dispatchStatus !== 'discarded'
    ) {
      return runFailure('PERSISTENCE_FAILED');
    }
    return { ok: true, runId: discarded.runId, discardedAt: discarded.updatedAt, alreadyDiscarded: false };
  }

  private async authorizeConversation(
    conversationId: string
  ): Promise<{ ok: true; value: AuthorizedPresentationConversation } | { ok: false; failure: PresentationRunFailure }> {
    if (!this.options.isDesktopRuntime()) return { ok: false, failure: runFailure('DESKTOP_REQUIRED') };
    let authority: PresentationRunAuthorityResolution;
    try {
      authority = await this.options.resolveAuthority({ conversationId });
    } catch {
      return { ok: false, failure: runFailure('SCOPE_UNAVAILABLE') };
    }
    if (authority.ok === false) return { ok: false, failure: runFailure(authority.code) };
    if (authority.scope !== 'individual') {
      return { ok: false, failure: runFailure('TEAM_SCOPE_UNSUPPORTED') };
    }
    if (authority.runtime !== 'aionrs' && authority.runtime !== 'acp') {
      return { ok: false, failure: runFailure('RUNTIME_UNSUPPORTED') };
    }
    if (
      authority.principalId.length < 1 ||
      authority.principalId.length > 256 ||
      authority.principalId.includes('\u0000')
    ) {
      return { ok: false, failure: runFailure('SCOPE_UNAVAILABLE') };
    }
    return { ok: true, value: authority };
  }

  private async startPrepared(
    request: NormalizedStartRequest,
    requestFingerprint: string,
    principalId: string
  ): Promise<StartPresentationRunResult> {
    let allocation: Awaited<ReturnType<PresentationRunServiceOptions['store']['allocateRun']>>;
    try {
      allocation = await this.options.store.allocateRun({
        conversationId: request.conversation_id,
        clientRequestId: request.client_request_id,
        selectedTemplateId: request.selected_template_id,
        requestFingerprint,
        principalId,
        grantClaims: request.sources,
      });
    } catch (error) {
      const crash = simulatedProcessCrash(error);
      if (crash !== null) throw crash;
      let canonical: StoredPresentationRunManifest | null;
      try {
        canonical = await this.options.store.getByRequest(request.conversation_id, request.client_request_id);
      } catch (reconcileError) {
        const reconcileCrash = simulatedProcessCrash(reconcileError);
        if (reconcileCrash !== null) throw reconcileCrash;
        return runFailure('PERSISTENCE_FAILED');
      }
      if (canonical === null) return runFailure('PERSISTENCE_FAILED');
      if (canonical.requestFingerprint !== requestFingerprint) {
        return {
          ok: false,
          code: 'REQUEST_COLLISION',
          messageKey: 'conversation.presentationRun.REQUEST_COLLISION',
          retryable: false,
          state: 'lookup',
          details: { existingRunId: canonical.runId },
        };
      }
      if (canonical.postAllocationFailure !== null) return canonical.postAllocationFailure;
      allocation = { ok: true, status: 'existing', run: canonical };
    }
    if (allocation.ok === false) return allocation;

    let run = allocation.run;
    if (allocation.status === 'existing' && run.dispatchStatus === 'committed' && run.preparation != null) {
      return startSuccess(run);
    }
    if (
      run.dispatchStatus !== 'allocating' ||
      (run.artifactPhase !== 'none' && run.artifactPhase !== 'sources_snapshotted')
    ) {
      return stateConflict(run);
    }

    try {
      if (run.artifactPhase === 'none') {
        run = await this.options.store.transitionRun(run.runId, {
          expectedRevision: run.revision,
          dispatchStatus: 'allocating',
          artifactPhase: 'sources_snapshotted',
          now: this.now().toISOString(),
        });
      }

      const template = await this.resolveTemplate(request.selected_template_id);
      const claimed = await this.options.store.getClaimedSourceSnapshots(run.runId);
      const extracted = await extractClaimedSources(claimed, this.options.files, this.extractSources);
      const grounding = buildPresentationGrounding(request.input, extracted, {
        fileName: template.theme.fileName,
        sha256: template.theme.sha256,
        text: template.theme.bytes.toString('utf8'),
      });
      const paths = this.options.files.getStagingRunPaths(run.runId);
      const directive = buildPresentationRunDirective({
        themeFileName: template.theme.fileName,
        referenceFileName: template.reference.fileName,
        groundingFileName: 'grounding.md',
        candidatePath: paths.candidatePath,
        planPath: paths.planPath,
      });
      const prepared = await this.options.files.prepareRunAssets({
        runId: run.runId,
        candidateBytes: template.reference.bytes,
        grounding,
        rawInput: request.input,
        directive,
        sourceRefs: request.sources,
        injectSkills: ['officecli'],
        template: {
          theme: {
            fileName: template.theme.fileName,
            sha256: template.theme.sha256,
            byteLength: template.theme.byteLength,
          },
          reference: {
            fileName: template.reference.fileName,
            sha256: template.reference.sha256,
            byteLength: template.reference.byteLength,
          },
        },
      });
      run = await this.options.store.commitPreparedRun(run.runId, run.revision, prepared);
      return startSuccess(run);
    } catch (error) {
      const crash = simulatedProcessCrash(error);
      if (crash !== null) throw crash;
      const failure = preparationFailure(error);
      let canonical: StoredPresentationRunManifest | null;
      try {
        canonical = await this.options.store.getRun(run.runId);
      } catch (reconcileError) {
        const reconcileCrash = simulatedProcessCrash(reconcileError);
        if (reconcileCrash !== null) throw reconcileCrash;
        return runFailure('PERSISTENCE_FAILED');
      }
      if (canonical === null) return runFailure('PERSISTENCE_FAILED');
      if (canonical.postAllocationFailure !== null) return canonical.postAllocationFailure;
      if (canonical.dispatchStatus === 'committed' && canonical.preparation != null) return startSuccess(canonical);
      if (
        canonical.dispatchStatus !== 'allocating' ||
        (canonical.artifactPhase !== 'none' && canonical.artifactPhase !== 'sources_snapshotted')
      ) {
        return stateConflict(canonical);
      }
      run = canonical;
      try {
        await this.options.store.recordPostAllocationFailure(run.runId, run.revision, failure);
      } catch (recordError) {
        const recordCrash = simulatedProcessCrash(recordError);
        if (recordCrash !== null) throw recordCrash;
        try {
          canonical = await this.options.store.getRun(run.runId);
        } catch (reconcileError) {
          const reconcileCrash = simulatedProcessCrash(reconcileError);
          if (reconcileCrash !== null) throw reconcileCrash;
          return runFailure('PERSISTENCE_FAILED');
        }
        if (canonical?.postAllocationFailure !== null && canonical?.postAllocationFailure !== undefined) {
          return canonical.postAllocationFailure;
        }
        if (canonical?.dispatchStatus === 'committed' && canonical.preparation != null) return startSuccess(canonical);
        return runFailure('PERSISTENCE_FAILED');
      }
      return failure;
    }
  }

  private async resolveTemplate(
    id: string
  ): Promise<ResolvedPresentationTemplate & { reference: NonNullable<ResolvedPresentationTemplate['reference']> }> {
    const template = await this.options.templates.getById(id);
    if (template === null) throw new PresentationRunPreparationFailure(runFailure('TEMPLATE_NOT_FOUND'));
    if (template.manifest.format !== 'pptx' || template.reference === null) {
      throw new PresentationRunPreparationFailure(runFailure('TEMPLATE_UNSUPPORTED'));
    }
    return template as ResolvedPresentationTemplate & {
      reference: NonNullable<ResolvedPresentationTemplate['reference']>;
    };
  }

  async getPreparedRun(runId: string): Promise<PreparedPresentationRunDispatch | null> {
    if (!UUID_RE.test(runId)) return null;
    const run = await this.options.store.getRun(runId.toLowerCase());
    if (
      run === null ||
      run.dispatchStatus !== 'committed' ||
      run.artifactPhase !== 'sources_extracted' ||
      run.preparation == null
    ) {
      return null;
    }
    const payload: PresentationRunPreparationPayload = await this.options.files.readAuthorizedRunPreparation(
      run.runId,
      run.preparation
    );
    const paths = this.options.files.getStagingRunPaths(run.runId);
    return {
      runId: run.runId,
      rawInput: payload.rawInput,
      directive: payload.directive,
      sourceRefs: structuredClone(payload.sourceRefs),
      injectSkills: ['officecli'],
      files: [paths.groundingPath, paths.candidatePath],
      planPath: paths.planPath,
    };
  }
}
