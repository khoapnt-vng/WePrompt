/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID as createRandomUUID } from 'node:crypto';
import path from 'node:path';
import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type {
  BindPresentationDraftRequest,
  BindPresentationDraftResult,
  ConfirmQueuedPresentationSourcesRequest,
  ConfirmQueuedPresentationSourcesResult,
  CreatePresentationDraftRequest,
  CreatePresentationDraftResult,
  GetPresentationSourceOwnerRequest,
  GetPresentationSourceOwnerResult,
  GrantPresentationExternalDropResult,
  GrantPresentationWorkspaceSourceRequest,
  GrantPresentationWorkspaceSourceResult,
  PickPresentationSourcesRequest,
  PickPresentationSourcesResult,
  PresentationGrantOwner,
  PresentationRunFailure,
  PresentationRunFailureCode,
  PresentationSourceDescriptor,
  PresentationSourceRef,
  RevokePresentationSourceRequest,
  RevokePresentationSourceResult,
} from '@/common/types/office/presentationRun';
import {
  PresentationCanonicalCorruptionError,
  PresentationJournalRecoveryRequiredError,
  PresentationJournalTransactionError,
  PresentationRunFiles,
  PresentationRunJournal,
  PresentationRunStore,
  PresentationSourceSnapshotError,
  PresentationSourceStoreError,
  type PresentationSourceGrantCreateInput,
  type PresentationSourceOwnerSnapshot,
  type PresentationSourcePathAuthorization,
  type PresentationSourceSnapshotFormat,
  type PresentationSourceSweepResult,
} from '../storage';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_FORMATS = new Set<PresentationSourceSnapshotFormat>(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv']);

type FailureCodeOf<Result> = Extract<Result, { ok: false; code: PresentationRunFailureCode }>['code'];

type PresentationSourceOperationFailureCode = {
  getSourceOwner: FailureCodeOf<GetPresentationSourceOwnerResult>;
  createDraft: FailureCodeOf<CreatePresentationDraftResult>;
  bindDraft: FailureCodeOf<BindPresentationDraftResult>;
  pickSources: FailureCodeOf<PickPresentationSourcesResult>;
  grantExternalDropPaths: FailureCodeOf<GrantPresentationExternalDropResult>;
  grantWorkspaceSource: FailureCodeOf<GrantPresentationWorkspaceSourceResult>;
  revoke: FailureCodeOf<RevokePresentationSourceResult>;
  confirmQueued: FailureCodeOf<ConfirmQueuedPresentationSourcesResult>;
};

type PresentationSourceOperation = keyof PresentationSourceOperationFailureCode;

const OPERATION_FAILURE_CODES: {
  [Operation in PresentationSourceOperation]: ReadonlySet<PresentationSourceOperationFailureCode[Operation]>;
} = {
  getSourceOwner: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'INVALID_REQUEST',
    'DRAFT_NOT_FOUND',
    'DRAFT_EXPIRED',
    'DRAFT_FOREIGN',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'SCOPE_UNAVAILABLE',
    'TEAM_SCOPE_UNSUPPORTED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
  createDraft: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'DRAFT_LIMIT_EXCEEDED',
    'RATE_LIMITED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
  bindDraft: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'INVALID_REQUEST',
    'DRAFT_NOT_FOUND',
    'DRAFT_EXPIRED',
    'DRAFT_FOREIGN',
    'DRAFT_ALREADY_BOUND',
    'RUN_FORBIDDEN',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
  pickSources: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'INVALID_REQUEST',
    'DRAFT_NOT_FOUND',
    'DRAFT_EXPIRED',
    'DRAFT_FOREIGN',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'SCOPE_UNAVAILABLE',
    'TEAM_SCOPE_UNSUPPORTED',
    'GRANT_LIMIT_EXCEEDED',
    'SOURCE_LIMIT_EXCEEDED',
    'SOURCE_FORMAT_UNSUPPORTED',
    'SOURCE_TAMPERED',
    'DIALOG_UNAVAILABLE',
    'RATE_LIMITED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
  grantExternalDropPaths: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'INVALID_REQUEST',
    'NATIVE_FILE_REQUIRED',
    'DRAFT_NOT_FOUND',
    'DRAFT_EXPIRED',
    'DRAFT_FOREIGN',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'SCOPE_UNAVAILABLE',
    'TEAM_SCOPE_UNSUPPORTED',
    'GRANT_LIMIT_EXCEEDED',
    'SOURCE_LIMIT_EXCEEDED',
    'SOURCE_FORMAT_UNSUPPORTED',
    'SOURCE_TAMPERED',
    'RATE_LIMITED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
  grantWorkspaceSource: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'INVALID_REQUEST',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'SCOPE_UNAVAILABLE',
    'TEAM_SCOPE_UNSUPPORTED',
    'GRANT_LIMIT_EXCEEDED',
    'SOURCE_LIMIT_EXCEEDED',
    'SOURCE_FORMAT_UNSUPPORTED',
    'SOURCE_TAMPERED',
    'RATE_LIMITED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
  revoke: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'INVALID_REQUEST',
    'DRAFT_NOT_FOUND',
    'DRAFT_EXPIRED',
    'DRAFT_FOREIGN',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'SOURCE_GRANT_INVALID',
    'SOURCE_GRANT_FOREIGN',
    'SOURCE_GRANT_REPLAYED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
  confirmQueued: new Set([
    'FEATURE_DISABLED',
    'DESKTOP_REQUIRED',
    'INVALID_REQUEST',
    'DRAFT_NOT_FOUND',
    'DRAFT_EXPIRED',
    'DRAFT_FOREIGN',
    'RUN_NOT_FOUND',
    'RUN_FORBIDDEN',
    'SCOPE_UNAVAILABLE',
    'TEAM_SCOPE_UNSUPPORTED',
    'SOURCE_GRANT_INVALID',
    'SOURCE_GRANT_EXPIRED',
    'SOURCE_GRANT_FOREIGN',
    'SOURCE_GRANT_REPLAYED',
    'SOURCE_TAMPERED',
    'SOURCE_LIMIT_EXCEEDED',
    'PERSISTENCE_FAILED',
    'INTERNAL_ERROR',
  ]),
};

type ConversationOwnerFailureCode = 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'SCOPE_UNAVAILABLE' | 'TEAM_SCOPE_UNSUPPORTED';

export type PresentationConversationOwnerResolution =
  | {
      ok: true;
      conversationId: string;
      principalId: string;
      scope: 'individual' | 'team';
      workspace: string;
    }
  | { ok: false; code: ConversationOwnerFailureCode };

export type PresentationSourceGrantServiceOptions = {
  files: PresentationRunFiles;
  store: PresentationRunStore;
  isFeatureEnabled: () => boolean;
  isDesktopRuntime: () => boolean;
  getPrincipalId: () => Promise<string | null>;
  resolveConversationOwner: (input: {
    conversationId: string;
    principalId: string;
  }) => Promise<PresentationConversationOwnerResolution>;
  pickNativeSourcePaths: () => Promise<readonly string[] | null>;
  randomUUID?: () => string;
  setSweepInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearSweepInterval?: (timer: unknown) => void;
};

export type CreatePresentationSourceGrantServiceOptions = Omit<
  PresentationSourceGrantServiceOptions,
  'files' | 'store'
> & {
  userDataDir: string;
  tempDir: string;
  getFreeDiskBytes: () => Promise<number>;
  now?: () => Date;
};

export type GrantPresentationExternalDropPathRequest = {
  owner: PresentationGrantOwner;
  native_paths: readonly string[];
  expected_owner_revision: number;
};

type AuthorizedOwner = {
  owner: PresentationGrantOwner;
  principalId: string;
  workspace: string | null;
};

type SourceFailure = PresentationRunFailure;

function failureState(code: PresentationRunFailureCode): string {
  if (code === 'DRAFT_EXPIRED') return 'draft_expired';
  if (code === 'DRAFT_ALREADY_BOUND') return 'draft_active';
  if (code === 'SOURCE_GRANT_EXPIRED') return 'grant_expired';
  if (
    code === 'SOURCE_GRANT_INVALID' ||
    code === 'SOURCE_GRANT_FOREIGN' ||
    code === 'SOURCE_GRANT_REPLAYED' ||
    code === 'SOURCE_TAMPERED' ||
    code === 'SOURCE_LIMIT_EXCEEDED' ||
    code === 'SOURCE_FORMAT_UNSUPPORTED'
  ) {
    return 'grant_validation';
  }
  if (code === 'RUN_NOT_FOUND' || code === 'RUN_FORBIDDEN' || code === 'DRAFT_NOT_FOUND' || code === 'DRAFT_FOREIGN') {
    return 'lookup';
  }
  return 'preflight';
}

function sourceFailure(
  code: PresentationRunFailureCode,
  details: Record<string, unknown> | null = null
): SourceFailure {
  return {
    ok: false,
    code,
    messageKey: `conversation.presentationRun.${code}`,
    retryable: false,
    state: failureState(code),
    details: code === 'PERSISTENCE_FAILED' ? { postInvoked: false } : details,
  } as SourceFailure;
}

function constrainSourceFailure(operation: PresentationSourceOperation, failure: SourceFailure): SourceFailure {
  let code = failure.code;
  if (
    (operation === 'bindDraft' || operation === 'revoke') &&
    (code === 'SCOPE_UNAVAILABLE' || code === 'TEAM_SCOPE_UNSUPPORTED')
  ) {
    code = 'RUN_FORBIDDEN';
  }
  if (operation === 'bindDraft' && code === 'RUN_NOT_FOUND') code = 'RUN_FORBIDDEN';
  if (operation === 'bindDraft' && (code === 'GRANT_LIMIT_EXCEEDED' || code === 'SOURCE_LIMIT_EXCEEDED')) {
    code = 'INVALID_REQUEST';
  }
  if (operation === 'revoke' && code === 'SOURCE_GRANT_EXPIRED') code = 'SOURCE_GRANT_REPLAYED';
  const allowedCodes = OPERATION_FAILURE_CODES[operation] as ReadonlySet<PresentationRunFailureCode>;
  if (!allowedCodes.has(code)) code = 'INTERNAL_ERROR';
  if (code === failure.code) return failure;
  const details = code === 'SOURCE_GRANT_REPLAYED' ? (failure.details as Record<string, unknown>) : null;
  return sourceFailure(code, details);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isOwner(value: unknown): value is PresentationGrantOwner {
  return normalizeOwner(value) !== null;
}

function normalizeOwner(value: unknown): PresentationGrantOwner | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.owner_type === 'draft') {
    return Object.keys(record).length === 2 && isUuid(record.draft_id)
      ? { owner_type: 'draft', draft_id: record.draft_id }
      : null;
  }
  const conversationId = normalizePresentationConversationId(record.conversation_id);
  return record.owner_type === 'conversation' && Object.keys(record).length === 2 && conversationId !== null
    ? { owner_type: 'conversation', conversation_id: conversationId }
    : null;
}

function isSourceRef(value: unknown): value is PresentationSourceRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    hasExactKeys(record, ['grantId', 'expectedByteLength', 'expectedSha256']) &&
    isUuid(record.grantId) &&
    Number.isSafeInteger(record.expectedByteLength) &&
    (record.expectedByteLength as number) >= 1 &&
    (record.expectedByteLength as number) <= PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES &&
    typeof record.expectedSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(record.expectedSha256)
  );
}

function isConfirmQueuedRequest(value: unknown): value is ConfirmQueuedPresentationSourcesRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, ['owner', 'queue_item_id', 'sources', 'expected_owner_revision']) ||
    !isOwner(record.owner) ||
    !isUuid(record.queue_item_id) ||
    !isRevision(record.expected_owner_revision) ||
    !Array.isArray(record.sources) ||
    record.sources.length < 1 ||
    record.sources.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN ||
    !record.sources.every(isSourceRef)
  ) {
    return false;
  }
  const sources = record.sources;
  return (
    new Set(sources.map(({ grantId }) => grantId.toLowerCase())).size === sources.length &&
    sources.reduce((total, source) => total + source.expectedByteLength, 0) <=
      PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES
  );
}

function isStrictRelativePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 4096 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.endsWith('/')
  ) {
    return false;
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function sourceFormat(filePath: string): PresentationSourceSnapshotFormat | null {
  const extension = path.extname(filePath).slice(1).toLowerCase() as PresentationSourceSnapshotFormat;
  return SOURCE_FORMATS.has(extension) ? extension : null;
}

function descriptor(grant: PresentationSourceOwnerSnapshot['grants'][number]): PresentationSourceDescriptor {
  return {
    grantId: grant.grantId,
    displayName: grant.displayName,
    format: grant.format,
    sourceKind: grant.sourceKind,
    byteLength: grant.byteLength,
    sha256: grant.sha256,
    expiresAt: grant.expiresAt,
  };
}

/** Main-process authority for source grants; renderer requests never receive native paths. */
export class PresentationSourceGrantService {
  private readonly files: PresentationRunFiles;
  private readonly store: PresentationRunStore;
  private readonly options: PresentationSourceGrantServiceOptions;
  private readonly randomUUID: () => string;
  private initialization: Promise<void> | null = null;
  private sweepTimer: unknown | null = null;

  constructor(options: PresentationSourceGrantServiceOptions) {
    this.files = options.files;
    this.store = options.store;
    this.options = options;
    this.randomUUID = options.randomUUID ?? createRandomUUID;
  }

  async initialize(): Promise<void> {
    return this.ensureStorage();
  }

  dispose(): void {
    if (this.sweepTimer === null) return;
    if (this.options.clearSweepInterval !== undefined) {
      this.options.clearSweepInterval(this.sweepTimer);
    } else {
      clearInterval(this.sweepTimer as ReturnType<typeof setInterval>);
    }
    this.sweepTimer = null;
  }

  async sweep(): Promise<PresentationSourceSweepResult> {
    await this.ensureStorage();
    return this.store.sweepExpiredPresentationSources();
  }

  async getSourceOwner(request: GetPresentationSourceOwnerRequest): Promise<GetPresentationSourceOwnerResult> {
    const authorization = await this.authorizeOwner(request?.owner);
    if ('failure' in authorization) {
      return constrainSourceFailure('getSourceOwner', authorization.failure) as GetPresentationSourceOwnerResult;
    }
    try {
      await this.ensureStorage();
      const owner = await this.store.getPresentationSourceOwner(
        authorization.value.owner,
        authorization.value.principalId
      );
      return {
        ok: true,
        owner: owner.owner,
        ownerRevision: owner.ownerRevision,
        grants: owner.grants.map(descriptor),
      };
    } catch (error) {
      return constrainSourceFailure('getSourceOwner', this.mapError(error)) as GetPresentationSourceOwnerResult;
    }
  }

  async createDraft(request: CreatePresentationDraftRequest): Promise<CreatePresentationDraftResult> {
    const gate = this.baseGate();
    if (gate !== null) return constrainSourceFailure('createDraft', gate) as CreatePresentationDraftResult;
    if (!isUuid(request?.client_request_id)) {
      return constrainSourceFailure('createDraft', sourceFailure('INVALID_REQUEST')) as CreatePresentationDraftResult;
    }
    const principal = await this.resolvePrincipal();
    if ('failure' in principal) {
      return constrainSourceFailure('createDraft', principal.failure) as CreatePresentationDraftResult;
    }
    try {
      await this.ensureStorage();
      const result = await this.store.createPresentationSourceDraft(principal.value, request.client_request_id);
      return {
        ok: true,
        status: result.status,
        draft: {
          draftId: result.draft.draftId,
          revision: result.draft.revision,
          expiresAt: result.draft.expiresAt,
          grantCount: 0,
        },
      };
    } catch (error) {
      return constrainSourceFailure('createDraft', this.mapError(error)) as CreatePresentationDraftResult;
    }
  }

  async bindDraft(request: BindPresentationDraftRequest): Promise<BindPresentationDraftResult> {
    const gate = this.baseGate();
    if (gate !== null) return constrainSourceFailure('bindDraft', gate) as BindPresentationDraftResult;
    const conversationId = normalizePresentationConversationId(request?.conversation_id);
    if (!isUuid(request?.draft_id) || conversationId === null || !isRevision(request?.expected_revision)) {
      return constrainSourceFailure('bindDraft', sourceFailure('INVALID_REQUEST')) as BindPresentationDraftResult;
    }
    const authorization = await this.authorizeOwner({
      owner_type: 'conversation',
      conversation_id: conversationId,
    });
    if ('failure' in authorization) {
      return constrainSourceFailure('bindDraft', authorization.failure) as BindPresentationDraftResult;
    }
    try {
      await this.ensureStorage();
      const result = await this.store.bindPresentationSourceDraft({
        draftId: request.draft_id,
        conversationId,
        principalId: authorization.value.principalId,
        expectedRevision: request.expected_revision,
      });
      return { ok: true, ...result };
    } catch (error) {
      return constrainSourceFailure('bindDraft', this.mapError(error)) as BindPresentationDraftResult;
    }
  }

  async pickSources(request: PickPresentationSourcesRequest): Promise<PickPresentationSourcesResult> {
    const authorization = await this.authorizeGrantMutation(request?.owner, request?.expected_owner_revision);
    if ('failure' in authorization) {
      return constrainSourceFailure('pickSources', authorization.failure) as PickPresentationSourcesResult;
    }
    try {
      const paths = await this.options.pickNativeSourcePaths();
      if (paths === null) {
        return { ok: true, status: 'cancelled', grants: [], ownerRevision: authorization.owner.ownerRevision };
      }
      const created = await this.createGrantsFromPaths({
        owner: authorization.value.owner,
        expectedOwnerRevision: request.expected_owner_revision,
        principalId: authorization.value.principalId,
        paths,
        sourceKind: 'native-picker',
        current: authorization.owner,
      });
      if ('failure' in created) {
        return constrainSourceFailure('pickSources', created.failure) as PickPresentationSourcesResult;
      }
      return {
        ok: true,
        status: 'selected',
        grants: created.owner.grants.map(descriptor),
        ownerRevision: created.owner.ownerRevision,
      };
    } catch (error) {
      return constrainSourceFailure(
        'pickSources',
        this.mapError(error, 'DIALOG_UNAVAILABLE')
      ) as PickPresentationSourcesResult;
    }
  }

  async grantExternalDropPaths(
    request: GrantPresentationExternalDropPathRequest
  ): Promise<GrantPresentationExternalDropResult> {
    const authorization = await this.authorizeGrantMutation(request?.owner, request?.expected_owner_revision);
    if ('failure' in authorization) {
      return constrainSourceFailure(
        'grantExternalDropPaths',
        authorization.failure
      ) as GrantPresentationExternalDropResult;
    }
    const created = await this.createGrantsFromPaths({
      owner: authorization.value.owner,
      expectedOwnerRevision: request.expected_owner_revision,
      principalId: authorization.value.principalId,
      paths: request.native_paths,
      sourceKind: 'external-drop',
      current: authorization.owner,
    });
    if ('failure' in created) {
      return constrainSourceFailure('grantExternalDropPaths', created.failure) as GrantPresentationExternalDropResult;
    }
    return {
      ok: true,
      status: 'granted',
      grants: created.owner.grants.map(descriptor),
      ownerRevision: created.owner.ownerRevision,
    };
  }

  async grantWorkspaceSource(
    request: GrantPresentationWorkspaceSourceRequest
  ): Promise<GrantPresentationWorkspaceSourceResult> {
    const gate = this.baseGate();
    if (gate !== null) {
      return constrainSourceFailure('grantWorkspaceSource', gate) as GrantPresentationWorkspaceSourceResult;
    }
    const conversationId = normalizePresentationConversationId(request?.conversation_id);
    if (
      conversationId === null ||
      !isStrictRelativePath(request?.relative_path) ||
      !isRevision(request?.expected_owner_revision)
    ) {
      return constrainSourceFailure(
        'grantWorkspaceSource',
        sourceFailure('INVALID_REQUEST')
      ) as GrantPresentationWorkspaceSourceResult;
    }
    const owner: PresentationGrantOwner = {
      owner_type: 'conversation',
      conversation_id: conversationId,
    };
    const authorization = await this.authorizeGrantMutation(owner, request.expected_owner_revision);
    if ('failure' in authorization) {
      return constrainSourceFailure(
        'grantWorkspaceSource',
        authorization.failure
      ) as GrantPresentationWorkspaceSourceResult;
    }
    if (authorization.value.workspace === null) {
      return constrainSourceFailure(
        'grantWorkspaceSource',
        sourceFailure('SCOPE_UNAVAILABLE')
      ) as GrantPresentationWorkspaceSourceResult;
    }
    let sourcePath: string;
    let sourceAuthorization: PresentationSourcePathAuthorization;
    try {
      sourceAuthorization = await this.files.authorizeWorkspaceSourcePath(
        path.resolve(authorization.value.workspace),
        request.relative_path
      );
      sourcePath = sourceAuthorization.canonicalSourcePath;
    } catch {
      return constrainSourceFailure(
        'grantWorkspaceSource',
        sourceFailure('SOURCE_TAMPERED', {})
      ) as GrantPresentationWorkspaceSourceResult;
    }
    const created = await this.createGrantsFromPaths({
      owner,
      expectedOwnerRevision: request.expected_owner_revision,
      principalId: authorization.value.principalId,
      paths: [sourcePath],
      sourceKind: 'workspace-relative',
      current: authorization.owner,
      authorizations: [sourceAuthorization],
    });
    if ('failure' in created) {
      return constrainSourceFailure('grantWorkspaceSource', created.failure) as GrantPresentationWorkspaceSourceResult;
    }
    const [grant] = created.owner.grants;
    if (grant === undefined) {
      return constrainSourceFailure(
        'grantWorkspaceSource',
        sourceFailure('INTERNAL_ERROR')
      ) as GrantPresentationWorkspaceSourceResult;
    }
    return { ok: true, status: 'granted', grant: descriptor(grant), ownerRevision: created.owner.ownerRevision };
  }

  async revoke(request: RevokePresentationSourceRequest): Promise<RevokePresentationSourceResult> {
    const authorization = await this.authorizeOwner(request?.owner);
    if ('failure' in authorization) {
      return constrainSourceFailure('revoke', authorization.failure) as RevokePresentationSourceResult;
    }
    if (!isUuid(request?.grant_id) || !isRevision(request?.expected_owner_revision)) {
      return constrainSourceFailure('revoke', sourceFailure('INVALID_REQUEST')) as RevokePresentationSourceResult;
    }
    try {
      await this.ensureStorage();
      const result = await this.store.revokePresentationSourceGrant({
        owner: authorization.value.owner,
        principalId: authorization.value.principalId,
        grantId: request.grant_id,
        expectedOwnerRevision: request.expected_owner_revision,
      });
      return { ok: true, ...result };
    } catch (error) {
      return constrainSourceFailure('revoke', this.mapError(error)) as RevokePresentationSourceResult;
    }
  }

  async confirmQueued(
    request: ConfirmQueuedPresentationSourcesRequest
  ): Promise<ConfirmQueuedPresentationSourcesResult> {
    const gate = this.baseGate();
    if (gate !== null) {
      return constrainSourceFailure('confirmQueued', gate) as ConfirmQueuedPresentationSourcesResult;
    }
    if (!isConfirmQueuedRequest(request)) {
      return constrainSourceFailure(
        'confirmQueued',
        sourceFailure('INVALID_REQUEST')
      ) as ConfirmQueuedPresentationSourcesResult;
    }
    const authorization = await this.authorizeOwner(request.owner);
    if ('failure' in authorization) {
      return constrainSourceFailure('confirmQueued', authorization.failure) as ConfirmQueuedPresentationSourcesResult;
    }
    try {
      await this.ensureStorage();
      const result = await this.store.extendPresentationSourceGrantsForQueue({
        owner: authorization.value.owner,
        principalId: authorization.value.principalId,
        sources: request.sources,
        queueItemId: request.queue_item_id,
        expectedOwnerRevision: request.expected_owner_revision,
      });
      return {
        ok: true,
        status: result.status,
        ownerRevision: result.ownerRevision,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      return constrainSourceFailure('confirmQueued', this.mapError(error)) as ConfirmQueuedPresentationSourcesResult;
    }
  }

  private baseGate(): SourceFailure | null {
    if (!this.options.isFeatureEnabled()) return sourceFailure('FEATURE_DISABLED');
    if (!this.options.isDesktopRuntime()) return sourceFailure('DESKTOP_REQUIRED');
    return null;
  }

  private async resolvePrincipal(): Promise<{ ok: true; value: string } | { ok: false; failure: SourceFailure }> {
    try {
      const principalId = await this.options.getPrincipalId();
      if (typeof principalId !== 'string' || principalId.length < 1 || principalId.length > 256) {
        return { ok: false, failure: sourceFailure('SCOPE_UNAVAILABLE') };
      }
      return { ok: true, value: principalId };
    } catch {
      return { ok: false, failure: sourceFailure('SCOPE_UNAVAILABLE') };
    }
  }

  private async authorizeOwner(
    owner: unknown
  ): Promise<{ ok: true; value: AuthorizedOwner } | { ok: false; failure: SourceFailure }> {
    const gate = this.baseGate();
    if (gate !== null) return { ok: false, failure: gate };
    const normalizedOwner = normalizeOwner(owner);
    if (normalizedOwner === null) return { ok: false, failure: sourceFailure('INVALID_REQUEST') };
    const principal = await this.resolvePrincipal();
    if ('failure' in principal) return principal;
    if (normalizedOwner.owner_type === 'draft') {
      return { ok: true, value: { owner: normalizedOwner, principalId: principal.value, workspace: null } };
    }
    let resolution: PresentationConversationOwnerResolution;
    try {
      resolution = await this.options.resolveConversationOwner({
        conversationId: normalizedOwner.conversation_id,
        principalId: principal.value,
      });
    } catch {
      return { ok: false, failure: sourceFailure('SCOPE_UNAVAILABLE') };
    }
    if ('code' in resolution) return { ok: false, failure: sourceFailure(resolution.code) };
    if (resolution.scope === 'team') {
      return { ok: false, failure: sourceFailure('TEAM_SCOPE_UNSUPPORTED') };
    }
    if (
      normalizePresentationConversationId(resolution.conversationId) !== normalizedOwner.conversation_id ||
      resolution.principalId !== principal.value ||
      !path.isAbsolute(resolution.workspace) ||
      resolution.workspace.includes('\0')
    ) {
      return { ok: false, failure: sourceFailure('SCOPE_UNAVAILABLE') };
    }
    return {
      ok: true,
      value: { owner: normalizedOwner, principalId: principal.value, workspace: resolution.workspace },
    };
  }

  private async authorizeGrantMutation(
    owner: unknown,
    expectedRevision: unknown
  ): Promise<
    { ok: true; value: AuthorizedOwner; owner: PresentationSourceOwnerSnapshot } | { ok: false; failure: SourceFailure }
  > {
    const gate = this.baseGate();
    if (gate !== null) return { ok: false, failure: gate };
    if (!isRevision(expectedRevision)) return { ok: false, failure: sourceFailure('INVALID_REQUEST') };
    const authorization = await this.authorizeOwner(owner);
    if ('failure' in authorization) return authorization;
    try {
      await this.ensureStorage();
      const snapshot = await this.store.getPresentationSourceOwner(
        authorization.value.owner,
        authorization.value.principalId
      );
      if (snapshot.ownerRevision !== expectedRevision) {
        return { ok: false, failure: sourceFailure('INVALID_REQUEST') };
      }
      return { ok: true, value: authorization.value, owner: snapshot };
    } catch (error) {
      return { ok: false, failure: this.mapError(error) };
    }
  }

  private async createGrantsFromPaths(input: {
    owner: PresentationGrantOwner;
    expectedOwnerRevision: number;
    principalId: string;
    paths: readonly string[];
    sourceKind: PresentationSourceDescriptor['sourceKind'];
    current: PresentationSourceOwnerSnapshot;
    authorizations?: readonly (PresentationSourcePathAuthorization | undefined)[];
  }): Promise<{ ok: true; owner: PresentationSourceOwnerSnapshot } | { ok: false; failure: SourceFailure }> {
    if (
      !Array.isArray(input.paths) ||
      input.paths.length < 1 ||
      input.paths.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN ||
      input.current.grants.length + input.paths.length > PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANTS_PER_OWNER ||
      new Set(input.paths).size !== input.paths.length
    ) {
      return {
        ok: false,
        failure:
          input.current.grants.length + input.paths.length > PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANTS_PER_OWNER
            ? sourceFailure('GRANT_LIMIT_EXCEEDED')
            : sourceFailure('INVALID_REQUEST'),
      };
    }
    const candidates: Array<{
      grantId: string;
      sourcePath: string;
      displayName: string;
      format: PresentationSourceSnapshotFormat;
      authorization?: PresentationSourcePathAuthorization;
    }> = [];
    for (const [index, sourcePath] of input.paths.entries()) {
      if (
        typeof sourcePath !== 'string' ||
        sourcePath.length < 1 ||
        sourcePath.length > 4096 ||
        sourcePath.includes('\0') ||
        !path.isAbsolute(sourcePath) ||
        path.resolve(sourcePath) !== sourcePath
      ) {
        return { ok: false, failure: sourceFailure('INVALID_REQUEST') };
      }
      const format = sourceFormat(sourcePath);
      if (format === null) return { ok: false, failure: sourceFailure('SOURCE_FORMAT_UNSUPPORTED', {}) };
      candidates.push({
        grantId: this.randomUUID(),
        sourcePath,
        displayName: path.basename(sourcePath),
        format,
        authorization: input.authorizations?.[index],
      });
    }
    let prepared: Awaited<ReturnType<PresentationRunFiles['prepareSourceSnapshots']>> = [];
    try {
      prepared = await this.files.prepareSourceSnapshots(
        candidates.map(({ grantId, sourcePath, format, authorization }) => ({
          grantId,
          sourcePath,
          format,
          ...(authorization === undefined ? {} : { authorization }),
        }))
      );
      const grants: PresentationSourceGrantCreateInput[] = candidates.map((candidate, index) => {
        const snapshot = prepared[index];
        if (snapshot === undefined) throw new Error('Presentation source preparation returned an incomplete batch');
        return {
          grantId: candidate.grantId,
          displayName: candidate.displayName,
          format: candidate.format,
          sourceKind: input.sourceKind,
          snapshotRelativePath: snapshot.finalRelativePath,
          sha256: snapshot.sha256,
          byteLength: snapshot.byteLength,
          preparedSnapshot: snapshot,
        };
      });
      const owner = await this.store.createPresentationSourceGrants({
        owner: input.owner,
        principalId: input.principalId,
        expectedOwnerRevision: input.expectedOwnerRevision,
        grants,
      });
      return { ok: true, owner };
    } catch (error) {
      const intentMayExist = error instanceof PresentationJournalTransactionError && error.intentMayExist;
      if (!intentMayExist) {
        let cleanupFailed = false;
        for (const snapshot of prepared) {
          try {
            await this.files.removePreparedSourceSnapshot(snapshot);
          } catch {
            cleanupFailed = true;
          }
        }
        if (cleanupFailed) return { ok: false, failure: sourceFailure('PERSISTENCE_FAILED') };
      }
      return { ok: false, failure: this.mapError(error) };
    }
  }

  private mapError(error: unknown, fallback?: PresentationRunFailureCode): SourceFailure {
    if (error instanceof PresentationSourceSnapshotError) return sourceFailure(error.code, {});
    if (error instanceof PresentationSourceStoreError) {
      const details =
        error.code === 'DRAFT_EXPIRED'
          ? { draftId: error.details.draftId ?? '' }
          : error.code === 'DRAFT_ALREADY_BOUND'
            ? { draftId: error.details.draftId ?? '', conversationId: error.details.conversationId ?? '' }
            : error.code.startsWith('SOURCE_')
              ? {
                  ...(error.details.grantId === undefined ? {} : { grantId: error.details.grantId }),
                  ...(error.code === 'SOURCE_GRANT_REPLAYED' && error.details.queueUnboundAtRevoke === true
                    ? { queueUnboundAtRevoke: true as const }
                    : {}),
                }
              : null;
      return sourceFailure(error.code, details);
    }
    if (
      error instanceof PresentationJournalTransactionError ||
      error instanceof PresentationJournalRecoveryRequiredError ||
      error instanceof PresentationCanonicalCorruptionError
    ) {
      return sourceFailure('PERSISTENCE_FAILED');
    }
    return sourceFailure(fallback ?? 'INTERNAL_ERROR');
  }

  private async ensureStorage(): Promise<void> {
    this.initialization ??= this.store.initialize().then(() => {
      if (this.sweepTimer !== null) return;
      const setTimer =
        this.options.setSweepInterval ??
        ((callback: () => void, intervalMs: number): unknown => setInterval(callback, intervalMs));
      this.sweepTimer = setTimer(() => {
        void this.store.sweepExpiredPresentationSources().catch((): void => undefined);
      }, PRESENTATION_RUN_LIMITS.GRANT_SWEEP_INTERVAL_MS);
      if (
        typeof this.sweepTimer === 'object' &&
        this.sweepTimer !== null &&
        'unref' in this.sweepTimer &&
        typeof this.sweepTimer.unref === 'function'
      ) {
        this.sweepTimer.unref();
      }
    });
    try {
      await this.initialization;
    } catch (error) {
      this.initialization = null;
      throw error;
    }
  }
}

export function createPresentationSourceGrantService(
  options: CreatePresentationSourceGrantServiceOptions
): PresentationSourceGrantService {
  const files = new PresentationRunFiles({
    userDataDir: options.userDataDir,
    tempDir: options.tempDir,
    randomUUID: options.randomUUID,
  });
  const journal = new PresentationRunJournal({ files, now: options.now, randomUUID: options.randomUUID });
  const store = new PresentationRunStore({
    files,
    journal,
    getFreeDiskBytes: options.getFreeDiskBytes,
    now: options.now,
    randomUUID: options.randomUUID,
  });
  return new PresentationSourceGrantService({ ...options, files, store });
}
