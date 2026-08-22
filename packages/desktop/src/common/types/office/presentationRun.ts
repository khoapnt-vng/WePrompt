/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type PresentationSourceDescriptor = {
  grantId: string;
  displayName: string;
  format: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'txt' | 'md' | 'csv';
  sourceKind: 'native-picker' | 'external-drop' | 'workspace-relative';
  byteLength: number;
  sha256: string;
  expiresAt: string;
};

export type PresentationSourceRef = {
  grantId: string;
  expectedByteLength: number;
  expectedSha256: string;
};

export type StartPresentationRunRequest = {
  conversation_id: string;
  client_request_id: string;
  input: string;
  selected_template_id: string;
  sources: PresentationSourceRef[];
};

export type PresentationRunFailureCode =
  | 'FEATURE_DISABLED'
  | 'DESKTOP_REQUIRED'
  | 'INVALID_REQUEST'
  | 'REQUEST_COLLISION'
  | 'RUN_NOT_FOUND'
  | 'RUN_FORBIDDEN'
  | 'RUN_STATE_CONFLICT'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_EXPIRED'
  | 'DRAFT_FOREIGN'
  | 'DRAFT_ALREADY_BOUND'
  | 'DRAFT_LIMIT_EXCEEDED'
  | 'GRANT_LIMIT_EXCEEDED'
  | 'NATIVE_FILE_REQUIRED'
  | 'DIALOG_UNAVAILABLE'
  | 'LEASE_CONFLICT'
  | 'LEASE_EXPIRED'
  | 'LEASE_FOREIGN'
  | 'SCOPE_UNAVAILABLE'
  | 'TEAM_SCOPE_UNSUPPORTED'
  | 'RUNTIME_UNSUPPORTED'
  | 'SOURCE_GRANT_INVALID'
  | 'SOURCE_GRANT_EXPIRED'
  | 'SOURCE_GRANT_FOREIGN'
  | 'SOURCE_GRANT_REPLAYED'
  | 'SOURCE_TAMPERED'
  | 'SOURCE_LIMIT_EXCEEDED'
  | 'SOURCE_FORMAT_UNSUPPORTED'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_UNSUPPORTED'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'DISK_RESERVE_EXCEEDED'
  | 'PERSISTENCE_FAILED'
  | 'BACKEND_PREFLIGHT_BLOCKED'
  | 'DISPATCH_UNCERTAIN'
  | 'TRACKING_REQUIRED'
  | 'CANDIDATE_UNAVAILABLE'
  | 'HASH_MISMATCH'
  | 'UNSAFE_TO_OPEN'
  | 'UNSAFE_TO_DISCARD'
  | 'INTERNAL_ERROR';

export type PresentationFailure<
  Code extends PresentationRunFailureCode,
  Retryable extends boolean,
  State extends string,
  Details,
> = {
  ok: false;
  code: Code;
  messageKey: string;
  retryable: Retryable;
  state: State;
  details: Details;
};

export type PresentationRunFailure =
  | PresentationFailure<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'SCOPE_UNAVAILABLE'
      | 'TEAM_SCOPE_UNSUPPORTED'
      | 'RUNTIME_UNSUPPORTED'
      | 'DRAFT_LIMIT_EXCEEDED'
      | 'GRANT_LIMIT_EXCEEDED'
      | 'NATIVE_FILE_REQUIRED'
      | 'DIALOG_UNAVAILABLE'
      | 'TEMPLATE_NOT_FOUND'
      | 'TEMPLATE_UNSUPPORTED'
      | 'RESOURCE_LIMIT_EXCEEDED'
      | 'DISK_RESERVE_EXCEEDED'
      | 'INTERNAL_ERROR',
      false,
      'preflight',
      null
    >
  | PresentationFailure<'REQUEST_COLLISION', false, 'lookup', { existingRunId: string }>
  | PresentationFailure<'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'DRAFT_NOT_FOUND' | 'DRAFT_FOREIGN', false, 'lookup', null>
  | PresentationFailure<
      'RUN_STATE_CONFLICT',
      false,
      'lookup',
      { runId: string; dispatchStatus: PresentationRunPublicDto['dispatchStatus'] }
    >
  | PresentationFailure<'DRAFT_EXPIRED', false, 'draft_expired', { draftId: string }>
  | PresentationFailure<'DRAFT_ALREADY_BOUND', false, 'draft_active', { draftId: string; conversationId: string }>
  | PresentationFailure<
      | 'SOURCE_GRANT_INVALID'
      | 'SOURCE_GRANT_FOREIGN'
      | 'SOURCE_TAMPERED'
      | 'SOURCE_LIMIT_EXCEEDED'
      | 'SOURCE_FORMAT_UNSUPPORTED',
      false,
      'grant_validation',
      { grantId?: string }
    >
  | PresentationFailure<
      'SOURCE_GRANT_REPLAYED',
      false,
      'grant_validation',
      { grantId?: string; queueUnboundAtRevoke?: true }
    >
  | PresentationFailure<'SOURCE_GRANT_EXPIRED', false, 'grant_expired', { grantId: string }>
  | PresentationFailure<'LEASE_CONFLICT', false, 'committed', { runId: string; leaseExpiresAt: string }>
  | PresentationFailure<'LEASE_EXPIRED', false, 'committed', { runId: string; reclaimAllowed: true }>
  | PresentationFailure<'LEASE_FOREIGN', false, 'committed', { runId: string }>
  | PresentationFailure<'RATE_LIMITED', true, 'preflight', { retryAfterMs: number; postInvoked: false }>
  | PresentationFailure<
      'BACKEND_PREFLIGHT_BLOCKED',
      true,
      'committed',
      { runId: string; retryAfterMs: number; postInvoked: false }
    >
  | PresentationFailure<'PERSISTENCE_FAILED', false, 'preflight' | 'committed', { postInvoked: false }>
  | PresentationFailure<
      'DISPATCH_UNCERTAIN',
      false,
      'dispatch_uncertain',
      { runId: string; postInvoked: true; queryRequired: true }
    >
  | PresentationFailure<'TRACKING_REQUIRED', false, 'bound' | 'retained', { runId: string }>
  | PresentationFailure<'CANDIDATE_UNAVAILABLE' | 'HASH_MISMATCH', false, 'retained', { runId: string }>
  | PresentationFailure<
      'UNSAFE_TO_OPEN' | 'UNSAFE_TO_DISCARD',
      false,
      'committed' | 'dispatching' | 'bound' | 'dispatch_uncertain' | 'retained',
      { runId: string }
    >;

export type RetainedCandidateDto = {
  sha256: string;
  byteLength: number;
};

export type PresentationRunPublicBase = {
  runId: string;
  clientRequestId: string;
  conversationId: string;
  selectedTemplateId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type PresentationRunPublicDto =
  | (PresentationRunPublicBase & {
      dispatchStatus: 'allocating' | 'committed';
      artifactPhase: 'none' | 'sources_snapshotted' | 'sources_extracted';
      disposition: null;
      retainedCandidate: null;
      actions: { openAllowed: false; discardAllowed: true };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'dispatching' | 'bound';
      artifactPhase: 'none' | 'sources_snapshotted' | 'sources_extracted';
      disposition: null;
      retainedCandidate: null;
      actions: { openAllowed: false; discardAllowed: false };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'terminal_verified';
      artifactPhase: 'sources_extracted';
      disposition: null;
      retainedCandidate: null;
      actions: { openAllowed: false; discardAllowed: false };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'terminal_verified';
      artifactPhase: 'candidate_retained' | 'candidate_copied' | 'structurally_valid' | 'ooxml_inspected';
      disposition: null;
      retainedCandidate: RetainedCandidateDto;
      actions: { openAllowed: false; discardAllowed: false };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'retained' | 'failed_retained';
      artifactPhase: 'candidate_retained' | 'candidate_copied' | 'structurally_valid';
      disposition: 'REVIEW_REQUIRED';
      retainedCandidate: RetainedCandidateDto;
      actions: { openAllowed: false; discardAllowed: true };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'retained' | 'failed_retained';
      artifactPhase: 'ooxml_inspected' | 'rendered_exact_hash';
      disposition: 'REVIEW_REQUIRED';
      retainedCandidate: RetainedCandidateDto;
      actions: { openAllowed: false; discardAllowed: true } | { openAllowed: true; discardAllowed: true };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'failed_retained';
      artifactPhase: 'none' | 'sources_snapshotted' | 'sources_extracted';
      disposition: 'TRACKING_REQUIRED';
      retainedCandidate: null;
      actions: { openAllowed: false; discardAllowed: true };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'retained' | 'dispatch_uncertain';
      artifactPhase: 'none' | 'sources_snapshotted' | 'sources_extracted';
      disposition: 'TRACKING_REQUIRED';
      retainedCandidate: null;
      actions: { openAllowed: false; discardAllowed: false };
    })
  | (PresentationRunPublicBase & {
      dispatchStatus: 'discarded';
      artifactPhase: null;
      disposition: null;
      retainedCandidate: null;
      actions: { openAllowed: false; discardAllowed: false };
    });

export type StartPresentationRunResult =
  | {
      ok: true;
      run: PresentationRunPublicBase & {
        dispatchStatus: 'committed';
        artifactPhase: 'sources_snapshotted' | 'sources_extracted';
        disposition: null;
        retainedCandidate: null;
        actions: { openAllowed: false; discardAllowed: true };
      };
    }
  | PresentationRunFailure;

export type GetPresentationRunRequest =
  | { conversation_id: string; run_id: string; client_request_id?: never }
  | { conversation_id: string; client_request_id: string; run_id?: never };

export type GetPresentationRunResult = { ok: true; run: PresentationRunPublicDto } | PresentationRunFailure;

export type ListRecoverablePresentationRunsRequest = {
  conversation_id: string;
  cursor?: string;
  limit?: number;
};

export type ListRecoverablePresentationRunsResult =
  | { ok: true; items: PresentationRunPublicDto[]; nextCursor: string | null }
  | PresentationRunFailure;

export type OpenPresentationRunRequest = {
  conversation_id: string;
  run_id: string;
  expected_sha256: string;
};

export type OpenPresentationRunResult = { ok: true; runId: string; sha256: string } | PresentationRunFailure;

export type DiscardPresentationRunRequest = {
  conversation_id: string;
  run_id: string;
  expected_revision: number;
};

export type DiscardPresentationRunResult =
  | { ok: true; runId: string; discardedAt: string; alreadyDiscarded: boolean }
  | PresentationRunFailure;

export type PresentationGrantOwner =
  | { owner_type: 'draft'; draft_id: string }
  | { owner_type: 'conversation'; conversation_id: string };

export type FailureFor<Code extends PresentationRunFailureCode> = PresentationRunFailure & {
  code: Code;
};

export type GetPresentationSourceOwnerRequest = {
  owner: PresentationGrantOwner;
};

export type GetPresentationSourceOwnerResult =
  | {
      ok: true;
      owner: PresentationGrantOwner;
      ownerRevision: number;
      grants: PresentationSourceDescriptor[];
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'DRAFT_NOT_FOUND'
      | 'DRAFT_EXPIRED'
      | 'DRAFT_FOREIGN'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'SCOPE_UNAVAILABLE'
      | 'TEAM_SCOPE_UNSUPPORTED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type CreatePresentationDraftRequest = {
  client_request_id: string;
};

export type CreatePresentationDraftResult =
  | {
      ok: true;
      status: 'created' | 'existing';
      draft: {
        draftId: string;
        revision: number;
        expiresAt: string;
        grantCount: 0;
      };
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'DRAFT_LIMIT_EXCEEDED'
      | 'RATE_LIMITED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type BindPresentationDraftRequest = {
  draft_id: string;
  conversation_id: string;
  expected_revision: number;
};

export type BindPresentationDraftResult =
  | {
      ok: true;
      status: 'bound' | 'already_bound';
      draftId: string;
      conversationId: string;
      revision: number;
      boundAt: string;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'DRAFT_NOT_FOUND'
      | 'DRAFT_EXPIRED'
      | 'DRAFT_FOREIGN'
      | 'DRAFT_ALREADY_BOUND'
      | 'RUN_FORBIDDEN'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type PickPresentationSourcesRequest = {
  owner: PresentationGrantOwner;
  expected_owner_revision: number;
};

export type PickPresentationSourcesResult =
  | { ok: true; status: 'cancelled'; grants: []; ownerRevision: number }
  | {
      ok: true;
      status: 'selected';
      grants: PresentationSourceDescriptor[];
      ownerRevision: number;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'DRAFT_NOT_FOUND'
      | 'DRAFT_EXPIRED'
      | 'DRAFT_FOREIGN'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'SCOPE_UNAVAILABLE'
      | 'TEAM_SCOPE_UNSUPPORTED'
      | 'GRANT_LIMIT_EXCEEDED'
      | 'SOURCE_LIMIT_EXCEEDED'
      | 'SOURCE_FORMAT_UNSUPPORTED'
      | 'SOURCE_TAMPERED'
      | 'DIALOG_UNAVAILABLE'
      | 'RATE_LIMITED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type GrantPresentationWorkspaceSourceRequest = {
  conversation_id: string;
  relative_path: string;
  expected_owner_revision: number;
};

export type GrantPresentationWorkspaceSourceResult =
  | {
      ok: true;
      status: 'granted';
      grant: PresentationSourceDescriptor;
      ownerRevision: number;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'SCOPE_UNAVAILABLE'
      | 'TEAM_SCOPE_UNSUPPORTED'
      | 'GRANT_LIMIT_EXCEEDED'
      | 'SOURCE_LIMIT_EXCEEDED'
      | 'SOURCE_FORMAT_UNSUPPORTED'
      | 'SOURCE_TAMPERED'
      | 'RATE_LIMITED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type RevokePresentationSourceRequest = {
  owner: PresentationGrantOwner;
  grant_id: string;
  expected_owner_revision: number;
};

export type RevokePresentationSourceResult =
  | {
      ok: true;
      status: 'revoked' | 'already_revoked';
      grantId: string;
      ownerRevision: number;
      revokedAt: string;
      queueUnboundAtRevoke: boolean;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'DRAFT_NOT_FOUND'
      | 'DRAFT_EXPIRED'
      | 'DRAFT_FOREIGN'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'SOURCE_GRANT_INVALID'
      | 'SOURCE_GRANT_FOREIGN'
      | 'SOURCE_GRANT_REPLAYED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type ConfirmQueuedPresentationSourcesRequest = {
  owner: PresentationGrantOwner;
  queue_item_id: string;
  sources: PresentationSourceRef[];
  expected_owner_revision: number;
};

export type ConfirmQueuedPresentationSourcesResult =
  | {
      ok: true;
      status: 'confirmed' | 'already_confirmed';
      ownerRevision: number;
      expiresAt: string;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'DRAFT_NOT_FOUND'
      | 'DRAFT_EXPIRED'
      | 'DRAFT_FOREIGN'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'SCOPE_UNAVAILABLE'
      | 'TEAM_SCOPE_UNSUPPORTED'
      | 'SOURCE_GRANT_INVALID'
      | 'SOURCE_GRANT_EXPIRED'
      | 'SOURCE_GRANT_FOREIGN'
      | 'SOURCE_GRANT_REPLAYED'
      | 'SOURCE_TAMPERED'
      | 'SOURCE_LIMIT_EXCEEDED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type GrantPresentationExternalDropRequest = {
  owner: PresentationGrantOwner;
  files: readonly File[];
  expected_owner_revision: number;
};

export type GrantPresentationExternalDropResult =
  | {
      ok: true;
      status: 'granted';
      grants: PresentationSourceDescriptor[];
      ownerRevision: number;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'NATIVE_FILE_REQUIRED'
      | 'DRAFT_NOT_FOUND'
      | 'DRAFT_EXPIRED'
      | 'DRAFT_FOREIGN'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'SCOPE_UNAVAILABLE'
      | 'TEAM_SCOPE_UNSUPPORTED'
      | 'GRANT_LIMIT_EXCEEDED'
      | 'SOURCE_LIMIT_EXCEEDED'
      | 'SOURCE_FORMAT_UNSUPPORTED'
      | 'SOURCE_TAMPERED'
      | 'RATE_LIMITED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type ClaimInitialPresentationDispatchRequest = {
  conversation_id: string;
  run_id: string;
  holder_id: string;
  expected_revision: number;
};

export type ClaimInitialPresentationDispatchResult =
  | {
      ok: true;
      status: 'claimed' | 'already_claimed';
      runId: string;
      leaseToken: string;
      revision: number;
      expiresAt: string;
      renewAfterMs: 10_000;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'RUN_STATE_CONFLICT'
      | 'LEASE_CONFLICT'
      | 'RATE_LIMITED'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type RenewInitialPresentationDispatchRequest = {
  conversation_id: string;
  run_id: string;
  lease_token: string;
  expected_revision: number;
};

export type RenewInitialPresentationDispatchResult =
  | {
      ok: true;
      status: 'renewed';
      runId: string;
      revision: number;
      expiresAt: string;
      renewAfterMs: 10_000;
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'RUN_STATE_CONFLICT'
      | 'LEASE_EXPIRED'
      | 'LEASE_FOREIGN'
      | 'PERSISTENCE_FAILED'
      | 'INTERNAL_ERROR'
    >;

export type DispatchInitialPresentationRunRequest = {
  conversation_id: string;
  run_id: string;
  lease_token: string;
  expected_revision: number;
};

export type DispatchInitialPresentationRunResult =
  | {
      ok: true;
      status: 'bound' | 'already_bound';
      runId: string;
      conversationId: string;
      revision: number;
      dispatchStatus: 'bound';
    }
  | FailureFor<
      | 'FEATURE_DISABLED'
      | 'DESKTOP_REQUIRED'
      | 'INVALID_REQUEST'
      | 'RUN_NOT_FOUND'
      | 'RUN_FORBIDDEN'
      | 'RUN_STATE_CONFLICT'
      | 'LEASE_EXPIRED'
      | 'LEASE_FOREIGN'
      | 'RATE_LIMITED'
      | 'BACKEND_PREFLIGHT_BLOCKED'
      | 'PERSISTENCE_FAILED'
      | 'DISPATCH_UNCERTAIN'
      | 'INTERNAL_ERROR'
    >;
