/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_RUN_ARTIFACT_PHASES,
  PRESENTATION_RUN_DIRECTIVE_PREFIX,
  PRESENTATION_RUN_DISPATCH_STATUSES,
  PRESENTATION_RUN_DISPOSITIONS,
  PRESENTATION_RUN_FAILURE_STATES,
  PRESENTATION_RUN_V2_ENABLED,
} from '@/common/config/constants';

const presentationRunTypeFile = resolve(process.cwd(), 'packages/desktop/src/common/types/office/presentationRun.ts');

const compileFixture = (source: (moduleSpecifier: string) => string): string => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'presentation-run-contract-'));
  const fixturePath = join(fixtureDirectory, 'fixture.ts');
  const relativeModulePath = relative(fixtureDirectory, presentationRunTypeFile).split(sep).join('/');
  const moduleSpecifier = relativeModulePath.startsWith('.') ? relativeModulePath : `./${relativeModulePath}`;

  try {
    writeFileSync(fixturePath, source(moduleSpecifier), 'utf8');
    const program = ts.createProgram([fixturePath], {
      allowImportingTsExtensions: true,
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2023,
      types: [],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    });
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
};

describe('managed presentation public contract', () => {
  it('accepts every public request and success discriminant', () => {
    const diagnostics = compileFixture(
      (moduleSpecifier) => `
        import type {
          BindPresentationDraftRequest,
          BindPresentationDraftResult,
          ClaimInitialPresentationDispatchRequest,
          ClaimInitialPresentationDispatchResult,
          CreatePresentationDraftRequest,
          CreatePresentationDraftResult,
          DiscardPresentationRunRequest,
          DiscardPresentationRunResult,
          DispatchInitialPresentationRunRequest,
          DispatchInitialPresentationRunResult,
          GetPresentationSourceOwnerRequest,
          GetPresentationSourceOwnerResult,
          GetPresentationRunRequest,
          GetPresentationRunResult,
          GrantPresentationExternalDropRequest,
          GrantPresentationExternalDropResult,
          GrantPresentationWorkspaceSourceRequest,
          GrantPresentationWorkspaceSourceResult,
          ListRecoverablePresentationRunsRequest,
          ListRecoverablePresentationRunsResult,
          OpenPresentationRunRequest,
          OpenPresentationRunResult,
          PickPresentationSourcesRequest,
          PickPresentationSourcesResult,
          PresentationRunPublicDto,
          PresentationSourceDescriptor,
          PresentationSourceRef,
          RenewInitialPresentationDispatchRequest,
          RenewInitialPresentationDispatchResult,
          RevokePresentationSourceRequest,
          RevokePresentationSourceResult,
          StartPresentationRunRequest,
          StartPresentationRunResult,
        } from '${moduleSpecifier}';

        const descriptor = {
          grantId: '229ca31e-1150-4ad1-ad62-1c3368330adc',
          displayName: 'source.pdf',
          format: 'pdf',
          sourceKind: 'native-picker',
          byteLength: 128,
          sha256: 'a'.repeat(64),
          expiresAt: '2026-08-04T00:15:00.000Z',
        } satisfies PresentationSourceDescriptor;
        const sourceRef = {
          grantId: descriptor.grantId,
          expectedByteLength: descriptor.byteLength,
          expectedSha256: descriptor.sha256,
        } satisfies PresentationSourceRef;
        const startRequest = {
          conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
          client_request_id: 'c9426c09-4352-4c7c-88ca-039bfcaaf0d8',
          input: 'Build the quarterly review.',
          selected_template_id: 'business-review',
          sources: [sourceRef],
        } satisfies StartPresentationRunRequest;
        const publicBase = {
          runId: '434393ce-dd45-44fe-a51c-262b2b181cc5',
          clientRequestId: startRequest.client_request_id,
          conversationId: startRequest.conversation_id,
          selectedTemplateId: startRequest.selected_template_id,
          revision: 1,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:01.000Z',
        } as const;
        const startResult = {
          ok: true,
          run: {
            ...publicBase,
            dispatchStatus: 'committed',
            artifactPhase: 'sources_snapshotted',
            disposition: null,
            retainedCandidate: null,
            actions: { openAllowed: false, discardAllowed: true },
          },
        } satisfies StartPresentationRunResult;
        const startExtracted = {
          ...startResult,
          run: { ...startResult.run, artifactPhase: 'sources_extracted' },
        } satisfies StartPresentationRunResult;
        const getByRun = {
          conversation_id: publicBase.conversationId,
          run_id: publicBase.runId,
        } satisfies GetPresentationRunRequest;
        const getByRequest = {
          conversation_id: publicBase.conversationId,
          client_request_id: publicBase.clientRequestId,
        } satisfies GetPresentationRunRequest;
        const retainedRun = {
          ...publicBase,
          dispatchStatus: 'retained',
          artifactPhase: 'rendered_exact_hash',
          disposition: 'REVIEW_REQUIRED',
          retainedCandidate: { sha256: 'b'.repeat(64), byteLength: 4096 },
          actions: { openAllowed: true, discardAllowed: true },
        } satisfies PresentationRunPublicDto;
        const getResult = { ok: true, run: retainedRun } satisfies GetPresentationRunResult;
        const listRequest = {
          conversation_id: publicBase.conversationId,
          cursor: 'opaque-cursor',
          limit: 20,
        } satisfies ListRecoverablePresentationRunsRequest;
        const listResult = {
          ok: true,
          items: [retainedRun],
          nextCursor: null,
        } satisfies ListRecoverablePresentationRunsResult;
        const listWithNextCursor = {
          ...listResult,
          nextCursor: 'opaque-next-cursor',
        } satisfies ListRecoverablePresentationRunsResult;
        const openRequest = {
          conversation_id: publicBase.conversationId,
          run_id: publicBase.runId,
          expected_sha256: retainedRun.retainedCandidate.sha256,
        } satisfies OpenPresentationRunRequest;
        const openResult = {
          ok: true,
          runId: publicBase.runId,
          sha256: retainedRun.retainedCandidate.sha256,
        } satisfies OpenPresentationRunResult;
        const discardRequest = {
          conversation_id: publicBase.conversationId,
          run_id: publicBase.runId,
          expected_revision: 1,
        } satisfies DiscardPresentationRunRequest;
        const discardResult = {
          ok: true,
          runId: publicBase.runId,
          discardedAt: '2026-08-04T00:05:00.000Z',
          alreadyDiscarded: false,
        } satisfies DiscardPresentationRunResult;
        const discardExisting = {
          ...discardResult,
          alreadyDiscarded: true,
        } satisfies DiscardPresentationRunResult;
        const createDraftRequest = {
          client_request_id: publicBase.clientRequestId,
        } satisfies CreatePresentationDraftRequest;
        const createDraftResult = {
          ok: true,
          status: 'created',
          draft: {
            draftId: 'd9b6195d-bab0-4662-b88c-1675772bb24d',
            revision: 0,
            expiresAt: descriptor.expiresAt,
            grantCount: 0,
          },
        } satisfies CreatePresentationDraftResult;
        const createDraftExisting = {
          ...createDraftResult,
          status: 'existing',
        } satisfies CreatePresentationDraftResult;
        const getSourceOwnerRequest = {
          owner: { owner_type: 'draft', draft_id: createDraftResult.draft.draftId },
        } satisfies GetPresentationSourceOwnerRequest;
        const getSourceOwnerResult = {
          ok: true,
          owner: getSourceOwnerRequest.owner,
          ownerRevision: 0,
          grants: [],
        } satisfies GetPresentationSourceOwnerResult;
        const bindDraftRequest = {
          draft_id: createDraftResult.draft.draftId,
          conversation_id: publicBase.conversationId,
          expected_revision: 0,
        } satisfies BindPresentationDraftRequest;
        const bindDraftResult = {
          ok: true,
          status: 'bound',
          draftId: createDraftResult.draft.draftId,
          conversationId: publicBase.conversationId,
          revision: 1,
          boundAt: publicBase.updatedAt,
        } satisfies BindPresentationDraftResult;
        const bindDraftExisting = {
          ...bindDraftResult,
          status: 'already_bound',
        } satisfies BindPresentationDraftResult;
        const pickRequest = {
          owner: { owner_type: 'conversation', conversation_id: publicBase.conversationId },
          expected_owner_revision: 1,
        } satisfies PickPresentationSourcesRequest;
        const pickCancelled = {
          ok: true,
          status: 'cancelled',
          grants: [],
          ownerRevision: 1,
        } satisfies PickPresentationSourcesResult;
        const pickSelected = {
          ok: true,
          status: 'selected',
          grants: [descriptor],
          ownerRevision: 2,
        } satisfies PickPresentationSourcesResult;
        const workspaceRequest = {
          conversation_id: publicBase.conversationId,
          relative_path: 'sources/source.pdf',
          expected_owner_revision: 2,
        } satisfies GrantPresentationWorkspaceSourceRequest;
        const workspaceResult = {
          ok: true,
          status: 'granted',
          grant: { ...descriptor, sourceKind: 'workspace-relative' },
          ownerRevision: 3,
        } satisfies GrantPresentationWorkspaceSourceResult;
        const revokeRequest = {
          owner: { owner_type: 'draft', draft_id: createDraftResult.draft.draftId },
          grant_id: descriptor.grantId,
          expected_owner_revision: 3,
        } satisfies RevokePresentationSourceRequest;
        const revokeResult = {
          ok: true,
          status: 'revoked',
          grantId: descriptor.grantId,
          ownerRevision: 4,
          revokedAt: publicBase.updatedAt,
          queueUnboundAtRevoke: true,
        } satisfies RevokePresentationSourceResult;
        const revokeExisting = {
          ...revokeResult,
          status: 'already_revoked',
        } satisfies RevokePresentationSourceResult;
        declare const nativeFile: File;
        const dropRequest = {
          owner: { owner_type: 'conversation', conversation_id: publicBase.conversationId },
          files: [nativeFile],
          expected_owner_revision: 4,
        } satisfies GrantPresentationExternalDropRequest;
        const dropResult = {
          ok: true,
          status: 'granted',
          grants: [{ ...descriptor, sourceKind: 'external-drop' }],
          ownerRevision: 5,
        } satisfies GrantPresentationExternalDropResult;
        const claimRequest = {
          conversation_id: publicBase.conversationId,
          run_id: publicBase.runId,
          holder_id: 'renderer-1',
          expected_revision: 1,
        } satisfies ClaimInitialPresentationDispatchRequest;
        const claimResult = {
          ok: true,
          status: 'claimed',
          runId: publicBase.runId,
          leaseToken: 'opaque-lease-token',
          revision: 2,
          expiresAt: descriptor.expiresAt,
          renewAfterMs: 10_000,
        } satisfies ClaimInitialPresentationDispatchResult;
        const claimExisting = {
          ...claimResult,
          status: 'already_claimed',
        } satisfies ClaimInitialPresentationDispatchResult;
        const renewRequest = {
          conversation_id: publicBase.conversationId,
          run_id: publicBase.runId,
          lease_token: claimResult.leaseToken,
          expected_revision: claimResult.revision,
        } satisfies RenewInitialPresentationDispatchRequest;
        const renewResult = {
          ok: true,
          status: 'renewed',
          runId: publicBase.runId,
          revision: 3,
          expiresAt: descriptor.expiresAt,
          renewAfterMs: 10_000,
        } satisfies RenewInitialPresentationDispatchResult;
        const dispatchRequest = {
          conversation_id: publicBase.conversationId,
          run_id: publicBase.runId,
          lease_token: claimResult.leaseToken,
          expected_revision: renewResult.revision,
        } satisfies DispatchInitialPresentationRunRequest;
        const dispatchResult = {
          ok: true,
          status: 'bound',
          runId: publicBase.runId,
          conversationId: publicBase.conversationId,
          revision: 4,
          dispatchStatus: 'bound',
        } satisfies DispatchInitialPresentationRunResult;
        const dispatchExisting = {
          ...dispatchResult,
          status: 'already_bound',
        } satisfies DispatchInitialPresentationRunResult;

        void [
          startResult, startExtracted, getByRun, getByRequest, getResult, listRequest,
          listResult, listWithNextCursor, openRequest, openResult, discardRequest,
          discardResult, discardExisting, createDraftRequest, createDraftResult,
          createDraftExisting, getSourceOwnerRequest, getSourceOwnerResult,
          bindDraftRequest, bindDraftResult, bindDraftExisting,
          pickRequest, pickCancelled, pickSelected, workspaceRequest, workspaceResult,
          revokeRequest, revokeResult, revokeExisting, dropRequest, dropResult,
          claimRequest, claimResult, claimExisting, renewRequest, renewResult,
          dispatchRequest, dispatchResult, dispatchExisting,
        ];
      `
    );

    expect(diagnostics).toBe('');
  });

  it('keeps every result failure-code set, success status, and public key set exact', () => {
    const diagnostics = compileFixture(
      (moduleSpecifier) => `
        import type {
          BindPresentationDraftRequest,
          BindPresentationDraftResult,
          ClaimInitialPresentationDispatchRequest,
          ClaimInitialPresentationDispatchResult,
          CreatePresentationDraftRequest,
          CreatePresentationDraftResult,
          DiscardPresentationRunRequest,
          DiscardPresentationRunResult,
          DispatchInitialPresentationRunRequest,
          DispatchInitialPresentationRunResult,
          GetPresentationSourceOwnerRequest,
          GetPresentationSourceOwnerResult,
          GetPresentationRunRequest,
          GetPresentationRunResult,
          GrantPresentationExternalDropRequest,
          GrantPresentationExternalDropResult,
          GrantPresentationWorkspaceSourceRequest,
          GrantPresentationWorkspaceSourceResult,
          ListRecoverablePresentationRunsRequest,
          ListRecoverablePresentationRunsResult,
          OpenPresentationRunRequest,
          OpenPresentationRunResult,
          PickPresentationSourcesRequest,
          PickPresentationSourcesResult,
          PresentationGrantOwner,
          PresentationRunFailure,
          PresentationRunFailureCode,
          PresentationRunPublicBase,
          PresentationRunPublicDto,
          PresentationSourceDescriptor,
          PresentationSourceRef,
          RenewInitialPresentationDispatchRequest,
          RenewInitialPresentationDispatchResult,
          RetainedCandidateDto,
          RevokePresentationSourceRequest,
          RevokePresentationSourceResult,
          StartPresentationRunRequest,
          StartPresentationRunResult,
        } from '${moduleSpecifier}';

        type Assert<T extends true> = T;
        type Equal<Left, Right> =
          [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
        type FailureCodes<Result> = Result extends {
          ok: false;
          code: infer Code extends PresentationRunFailureCode;
        }
          ? Code
          : never;
        type Success<Result> = Extract<Result, { ok: true }>;
        type Status<Result> = Success<Result> extends { status: infer Value } ? Value : never;
        type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never;

        type SourceDescriptorGuard = Assert<Equal<PresentationSourceDescriptor, {
          grantId: string;
          displayName: string;
          format: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'txt' | 'md' | 'csv';
          sourceKind: 'native-picker' | 'external-drop' | 'workspace-relative';
          byteLength: number;
          sha256: string;
          expiresAt: string;
        }>>;
        type SourceRefGuard = Assert<Equal<PresentationSourceRef, {
          grantId: string;
          expectedByteLength: number;
          expectedSha256: string;
        }>>;
        type CandidateGuard = Assert<Equal<RetainedCandidateDto, { sha256: string; byteLength: number }>>;
        type PublicBaseGuard = Assert<Equal<PresentationRunPublicBase, {
          runId: string;
          clientRequestId: string;
          conversationId: string;
          selectedTemplateId: string;
          revision: number;
          createdAt: string;
          updatedAt: string;
        }>>;
        type OwnerGuard = Assert<Equal<PresentationGrantOwner,
          | { owner_type: 'draft'; draft_id: string }
          | { owner_type: 'conversation'; conversation_id: string }
        >>;

        type StartRequestGuard = Assert<Equal<StartPresentationRunRequest, {
          conversation_id: string;
          client_request_id: string;
          input: string;
          selected_template_id: string;
          sources: PresentationSourceRef[];
        }>>;
        type GetRequestGuard = Assert<Equal<GetPresentationRunRequest,
          | { conversation_id: string; run_id: string; client_request_id?: never }
          | { conversation_id: string; client_request_id: string; run_id?: never }
        >>;
        type ListRequestGuard = Assert<Equal<ListRecoverablePresentationRunsRequest, {
          conversation_id: string;
          cursor?: string;
          limit?: number;
        }>>;
        type OpenRequestGuard = Assert<Equal<OpenPresentationRunRequest, {
          conversation_id: string;
          run_id: string;
          expected_sha256: string;
        }>>;
        type DiscardRequestGuard = Assert<Equal<DiscardPresentationRunRequest, {
          conversation_id: string;
          run_id: string;
          expected_revision: number;
        }>>;
        type CreateRequestGuard = Assert<Equal<CreatePresentationDraftRequest, { client_request_id: string }>>;
        type GetSourceOwnerRequestGuard = Assert<Equal<GetPresentationSourceOwnerRequest, {
          owner: PresentationGrantOwner;
        }>>;
        type BindRequestGuard = Assert<Equal<BindPresentationDraftRequest, {
          draft_id: string;
          conversation_id: string;
          expected_revision: number;
        }>>;
        type PickRequestGuard = Assert<Equal<PickPresentationSourcesRequest, {
          owner: PresentationGrantOwner;
          expected_owner_revision: number;
        }>>;
        type WorkspaceRequestGuard = Assert<Equal<GrantPresentationWorkspaceSourceRequest, {
          conversation_id: string;
          relative_path: string;
          expected_owner_revision: number;
        }>>;
        type RevokeRequestGuard = Assert<Equal<RevokePresentationSourceRequest, {
          owner: PresentationGrantOwner;
          grant_id: string;
          expected_owner_revision: number;
        }>>;
        type DropRequestGuard = Assert<Equal<GrantPresentationExternalDropRequest, {
          owner: PresentationGrantOwner;
          files: readonly File[];
          expected_owner_revision: number;
        }>>;
        type ClaimRequestGuard = Assert<Equal<ClaimInitialPresentationDispatchRequest, {
          conversation_id: string;
          run_id: string;
          holder_id: string;
          expected_revision: number;
        }>>;
        type RenewRequestGuard = Assert<Equal<RenewInitialPresentationDispatchRequest, {
          conversation_id: string;
          run_id: string;
          lease_token: string;
          expected_revision: number;
        }>>;
        type DispatchRequestGuard = Assert<Equal<DispatchInitialPresentationRunRequest, {
          conversation_id: string;
          run_id: string;
          lease_token: string;
          expected_revision: number;
        }>>;

        type SourceDescriptorKeys = Assert<Equal<keyof PresentationSourceDescriptor,
          'grantId' | 'displayName' | 'format' | 'sourceKind' | 'byteLength' | 'sha256' | 'expiresAt'
        >>;
        type SourceRefKeys = Assert<Equal<keyof PresentationSourceRef,
          'grantId' | 'expectedByteLength' | 'expectedSha256'
        >>;
        type CandidateKeys = Assert<Equal<keyof RetainedCandidateDto, 'sha256' | 'byteLength'>>;
        type PublicBaseKeys = Assert<Equal<keyof PresentationRunPublicBase,
          'runId' | 'clientRequestId' | 'conversationId' | 'selectedTemplateId' | 'revision' | 'createdAt' | 'updatedAt'
        >>;
        type OwnerKeys = Assert<Equal<KeysOfUnion<PresentationGrantOwner>,
          'owner_type' | 'draft_id' | 'conversation_id'
        >>;
        type StartRequestKeys = Assert<Equal<keyof StartPresentationRunRequest,
          'conversation_id' | 'client_request_id' | 'input' | 'selected_template_id' | 'sources'
        >>;
        type GetRequestKeys = Assert<Equal<KeysOfUnion<GetPresentationRunRequest>,
          'conversation_id' | 'run_id' | 'client_request_id'
        >>;
        type ListRequestKeys = Assert<Equal<keyof ListRecoverablePresentationRunsRequest,
          'conversation_id' | 'cursor' | 'limit'
        >>;
        type OpenRequestKeys = Assert<Equal<keyof OpenPresentationRunRequest,
          'conversation_id' | 'run_id' | 'expected_sha256'
        >>;
        type DiscardRequestKeys = Assert<Equal<keyof DiscardPresentationRunRequest,
          'conversation_id' | 'run_id' | 'expected_revision'
        >>;
        type CreateRequestKeys = Assert<Equal<keyof CreatePresentationDraftRequest, 'client_request_id'>>;
        type GetSourceOwnerRequestKeys = Assert<Equal<keyof GetPresentationSourceOwnerRequest, 'owner'>>;
        type BindRequestKeys = Assert<Equal<keyof BindPresentationDraftRequest,
          'draft_id' | 'conversation_id' | 'expected_revision'
        >>;
        type PickRequestKeys = Assert<Equal<keyof PickPresentationSourcesRequest,
          'owner' | 'expected_owner_revision'
        >>;
        type WorkspaceRequestKeys = Assert<Equal<keyof GrantPresentationWorkspaceSourceRequest,
          'conversation_id' | 'relative_path' | 'expected_owner_revision'
        >>;
        type RevokeRequestKeys = Assert<Equal<keyof RevokePresentationSourceRequest,
          'owner' | 'grant_id' | 'expected_owner_revision'
        >>;
        type DropRequestKeys = Assert<Equal<keyof GrantPresentationExternalDropRequest,
          'owner' | 'files' | 'expected_owner_revision'
        >>;
        type ClaimRequestKeys = Assert<Equal<keyof ClaimInitialPresentationDispatchRequest,
          'conversation_id' | 'run_id' | 'holder_id' | 'expected_revision'
        >>;
        type RenewRequestKeys = Assert<Equal<keyof RenewInitialPresentationDispatchRequest,
          'conversation_id' | 'run_id' | 'lease_token' | 'expected_revision'
        >>;
        type DispatchRequestKeys = Assert<Equal<keyof DispatchInitialPresentationRunRequest,
          'conversation_id' | 'run_id' | 'lease_token' | 'expected_revision'
        >>;

        type CreateFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'DRAFT_LIMIT_EXCEEDED'
          | 'RATE_LIMITED' | 'PERSISTENCE_FAILED' | 'INTERNAL_ERROR';
        type GetSourceOwnerFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'DRAFT_NOT_FOUND' | 'DRAFT_EXPIRED' | 'DRAFT_FOREIGN'
          | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'SCOPE_UNAVAILABLE'
          | 'TEAM_SCOPE_UNSUPPORTED' | 'PERSISTENCE_FAILED' | 'INTERNAL_ERROR';
        type BindFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'DRAFT_NOT_FOUND' | 'DRAFT_EXPIRED' | 'DRAFT_FOREIGN'
          | 'DRAFT_ALREADY_BOUND' | 'RUN_FORBIDDEN' | 'PERSISTENCE_FAILED'
          | 'INTERNAL_ERROR';
        type PickFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'DRAFT_NOT_FOUND' | 'DRAFT_EXPIRED' | 'DRAFT_FOREIGN'
          | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'SCOPE_UNAVAILABLE'
          | 'TEAM_SCOPE_UNSUPPORTED' | 'GRANT_LIMIT_EXCEEDED'
          | 'SOURCE_LIMIT_EXCEEDED' | 'SOURCE_FORMAT_UNSUPPORTED'
          | 'SOURCE_TAMPERED' | 'DIALOG_UNAVAILABLE' | 'RATE_LIMITED'
          | 'PERSISTENCE_FAILED' | 'INTERNAL_ERROR';
        type WorkspaceFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'SCOPE_UNAVAILABLE'
          | 'TEAM_SCOPE_UNSUPPORTED' | 'GRANT_LIMIT_EXCEEDED'
          | 'SOURCE_LIMIT_EXCEEDED' | 'SOURCE_FORMAT_UNSUPPORTED'
          | 'SOURCE_TAMPERED' | 'RATE_LIMITED' | 'PERSISTENCE_FAILED'
          | 'INTERNAL_ERROR';
        type RevokeFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'DRAFT_NOT_FOUND' | 'DRAFT_EXPIRED' | 'DRAFT_FOREIGN'
          | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'SOURCE_GRANT_INVALID'
          | 'SOURCE_GRANT_FOREIGN' | 'SOURCE_GRANT_REPLAYED'
          | 'PERSISTENCE_FAILED' | 'INTERNAL_ERROR';
        type DropFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'NATIVE_FILE_REQUIRED' | 'DRAFT_NOT_FOUND' | 'DRAFT_EXPIRED'
          | 'DRAFT_FOREIGN' | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN'
          | 'SCOPE_UNAVAILABLE' | 'TEAM_SCOPE_UNSUPPORTED'
          | 'GRANT_LIMIT_EXCEEDED' | 'SOURCE_LIMIT_EXCEEDED'
          | 'SOURCE_FORMAT_UNSUPPORTED' | 'SOURCE_TAMPERED' | 'RATE_LIMITED'
          | 'PERSISTENCE_FAILED' | 'INTERNAL_ERROR';
        type ClaimFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'RUN_STATE_CONFLICT'
          | 'LEASE_CONFLICT' | 'RATE_LIMITED' | 'PERSISTENCE_FAILED'
          | 'INTERNAL_ERROR';
        type RenewFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'RUN_STATE_CONFLICT'
          | 'LEASE_EXPIRED' | 'LEASE_FOREIGN' | 'PERSISTENCE_FAILED'
          | 'INTERNAL_ERROR';
        type DispatchFailures =
          | 'FEATURE_DISABLED' | 'DESKTOP_REQUIRED' | 'INVALID_REQUEST'
          | 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'RUN_STATE_CONFLICT'
          | 'LEASE_EXPIRED' | 'LEASE_FOREIGN' | 'RATE_LIMITED'
          | 'BACKEND_PREFLIGHT_BLOCKED' | 'PERSISTENCE_FAILED'
          | 'DISPATCH_UNCERTAIN' | 'INTERNAL_ERROR';

        type StartFailureGuard = Assert<Equal<FailureCodes<StartPresentationRunResult>, PresentationRunFailureCode>>;
        type GetFailureGuard = Assert<Equal<FailureCodes<GetPresentationRunResult>, PresentationRunFailureCode>>;
        type ListFailureGuard = Assert<Equal<FailureCodes<ListRecoverablePresentationRunsResult>, PresentationRunFailureCode>>;
        type OpenFailureGuard = Assert<Equal<FailureCodes<OpenPresentationRunResult>, PresentationRunFailureCode>>;
        type DiscardFailureGuard = Assert<Equal<FailureCodes<DiscardPresentationRunResult>, PresentationRunFailureCode>>;
        type CreateFailureGuard = Assert<Equal<FailureCodes<CreatePresentationDraftResult>, CreateFailures>>;
        type GetSourceOwnerFailureGuard = Assert<Equal<
          FailureCodes<GetPresentationSourceOwnerResult>,
          GetSourceOwnerFailures
        >>;
        type BindFailureGuard = Assert<Equal<FailureCodes<BindPresentationDraftResult>, BindFailures>>;
        type PickFailureGuard = Assert<Equal<FailureCodes<PickPresentationSourcesResult>, PickFailures>>;
        type WorkspaceFailureGuard = Assert<Equal<FailureCodes<GrantPresentationWorkspaceSourceResult>, WorkspaceFailures>>;
        type RevokeFailureGuard = Assert<Equal<FailureCodes<RevokePresentationSourceResult>, RevokeFailures>>;
        type DropFailureGuard = Assert<Equal<FailureCodes<GrantPresentationExternalDropResult>, DropFailures>>;
        type ClaimFailureGuard = Assert<Equal<FailureCodes<ClaimInitialPresentationDispatchResult>, ClaimFailures>>;
        type RenewFailureGuard = Assert<Equal<FailureCodes<RenewInitialPresentationDispatchResult>, RenewFailures>>;
        type DispatchFailureGuard = Assert<Equal<FailureCodes<DispatchInitialPresentationRunResult>, DispatchFailures>>;

        type StartSuccessGuard = Assert<Equal<Success<StartPresentationRunResult>, {
          ok: true;
          run: PresentationRunPublicBase & {
            dispatchStatus: 'committed';
            artifactPhase: 'sources_snapshotted' | 'sources_extracted';
            disposition: null;
            retainedCandidate: null;
            actions: { openAllowed: false; discardAllowed: true };
          };
        }>>;
        type GetSuccessGuard = Assert<Equal<Success<GetPresentationRunResult>, {
          ok: true;
          run: PresentationRunPublicDto;
        }>>;
        type ListSuccessGuard = Assert<Equal<Success<ListRecoverablePresentationRunsResult>, {
          ok: true;
          items: PresentationRunPublicDto[];
          nextCursor: string | null;
        }>>;
        type OpenSuccessGuard = Assert<Equal<Success<OpenPresentationRunResult>, {
          ok: true;
          runId: string;
          sha256: string;
        }>>;
        type DiscardSuccessGuard = Assert<Equal<Success<DiscardPresentationRunResult>, {
          ok: true;
          runId: string;
          discardedAt: string;
          alreadyDiscarded: boolean;
        }>>;
        type CreateSuccessGuard = Assert<Equal<Success<CreatePresentationDraftResult>, {
          ok: true;
          status: 'created' | 'existing';
          draft: { draftId: string; revision: number; expiresAt: string; grantCount: 0 };
        }>>;
        type GetSourceOwnerSuccessGuard = Assert<Equal<Success<GetPresentationSourceOwnerResult>, {
          ok: true;
          owner: PresentationGrantOwner;
          ownerRevision: number;
          grants: PresentationSourceDescriptor[];
        }>>;
        type BindSuccessGuard = Assert<Equal<Success<BindPresentationDraftResult>, {
          ok: true;
          status: 'bound' | 'already_bound';
          draftId: string;
          conversationId: string;
          revision: number;
          boundAt: string;
        }>>;
        type PickSuccessGuard = Assert<Equal<Success<PickPresentationSourcesResult>,
          | { ok: true; status: 'cancelled'; grants: []; ownerRevision: number }
          | { ok: true; status: 'selected'; grants: PresentationSourceDescriptor[]; ownerRevision: number }
        >>;
        type WorkspaceSuccessGuard = Assert<Equal<Success<GrantPresentationWorkspaceSourceResult>, {
          ok: true;
          status: 'granted';
          grant: PresentationSourceDescriptor;
          ownerRevision: number;
        }>>;
        type RevokeSuccessGuard = Assert<Equal<Success<RevokePresentationSourceResult>, {
          ok: true;
          status: 'revoked' | 'already_revoked';
          grantId: string;
          ownerRevision: number;
          revokedAt: string;
          queueUnboundAtRevoke: boolean;
        }>>;
        type DropSuccessGuard = Assert<Equal<Success<GrantPresentationExternalDropResult>, {
          ok: true;
          status: 'granted';
          grants: PresentationSourceDescriptor[];
          ownerRevision: number;
        }>>;
        type ClaimSuccessGuard = Assert<Equal<Success<ClaimInitialPresentationDispatchResult>, {
          ok: true;
          status: 'claimed' | 'already_claimed';
          runId: string;
          leaseToken: string;
          revision: number;
          expiresAt: string;
          renewAfterMs: 10_000;
        }>>;
        type RenewSuccessGuard = Assert<Equal<Success<RenewInitialPresentationDispatchResult>, {
          ok: true;
          status: 'renewed';
          runId: string;
          revision: number;
          expiresAt: string;
          renewAfterMs: 10_000;
        }>>;
        type DispatchSuccessGuard = Assert<Equal<Success<DispatchInitialPresentationRunResult>, {
          ok: true;
          status: 'bound' | 'already_bound';
          runId: string;
          conversationId: string;
          revision: number;
          dispatchStatus: 'bound';
        }>>;

        type CreateStatusGuard = Assert<Equal<Status<CreatePresentationDraftResult>, 'created' | 'existing'>>;
        type BindStatusGuard = Assert<Equal<Status<BindPresentationDraftResult>, 'bound' | 'already_bound'>>;
        type PickStatusGuard = Assert<Equal<Status<PickPresentationSourcesResult>, 'cancelled' | 'selected'>>;
        type WorkspaceStatusGuard = Assert<Equal<Status<GrantPresentationWorkspaceSourceResult>, 'granted'>>;
        type RevokeStatusGuard = Assert<Equal<Status<RevokePresentationSourceResult>, 'revoked' | 'already_revoked'>>;
        type DropStatusGuard = Assert<Equal<Status<GrantPresentationExternalDropResult>, 'granted'>>;
        type ClaimStatusGuard = Assert<Equal<Status<ClaimInitialPresentationDispatchResult>, 'claimed' | 'already_claimed'>>;
        type RenewStatusGuard = Assert<Equal<Status<RenewInitialPresentationDispatchResult>, 'renewed'>>;
        type DispatchStatusGuard = Assert<Equal<Status<DispatchInitialPresentationRunResult>, 'bound' | 'already_bound'>>;
        type NoOtherStatusGuard = Assert<Equal<
          Status<StartPresentationRunResult | GetPresentationRunResult | GetPresentationSourceOwnerResult | ListRecoverablePresentationRunsResult | OpenPresentationRunResult | DiscardPresentationRunResult>,
          never
        >>;

        type StartKeys = Assert<Equal<KeysOfUnion<Success<StartPresentationRunResult>>, 'ok' | 'run'>>;
        type GetKeys = Assert<Equal<KeysOfUnion<Success<GetPresentationRunResult>>, 'ok' | 'run'>>;
        type ListKeys = Assert<Equal<KeysOfUnion<Success<ListRecoverablePresentationRunsResult>>, 'ok' | 'items' | 'nextCursor'>>;
        type OpenKeys = Assert<Equal<KeysOfUnion<Success<OpenPresentationRunResult>>, 'ok' | 'runId' | 'sha256'>>;
        type DiscardKeys = Assert<Equal<KeysOfUnion<Success<DiscardPresentationRunResult>>, 'ok' | 'runId' | 'discardedAt' | 'alreadyDiscarded'>>;
        type CreateKeys = Assert<Equal<KeysOfUnion<Success<CreatePresentationDraftResult>>, 'ok' | 'status' | 'draft'>>;
        type GetSourceOwnerKeys = Assert<Equal<KeysOfUnion<Success<GetPresentationSourceOwnerResult>>,
          'ok' | 'owner' | 'ownerRevision' | 'grants'
        >>;
        type BindKeys = Assert<Equal<KeysOfUnion<Success<BindPresentationDraftResult>>, 'ok' | 'status' | 'draftId' | 'conversationId' | 'revision' | 'boundAt'>>;
        type PickKeys = Assert<Equal<KeysOfUnion<Success<PickPresentationSourcesResult>>, 'ok' | 'status' | 'grants' | 'ownerRevision'>>;
        type WorkspaceKeys = Assert<Equal<KeysOfUnion<Success<GrantPresentationWorkspaceSourceResult>>, 'ok' | 'status' | 'grant' | 'ownerRevision'>>;
        type RevokeKeys = Assert<Equal<KeysOfUnion<Success<RevokePresentationSourceResult>>, 'ok' | 'status' | 'grantId' | 'ownerRevision' | 'revokedAt' | 'queueUnboundAtRevoke'>>;
        type DropKeys = Assert<Equal<KeysOfUnion<Success<GrantPresentationExternalDropResult>>, 'ok' | 'status' | 'grants' | 'ownerRevision'>>;
        type ClaimKeys = Assert<Equal<KeysOfUnion<Success<ClaimInitialPresentationDispatchResult>>, 'ok' | 'status' | 'runId' | 'leaseToken' | 'revision' | 'expiresAt' | 'renewAfterMs'>>;
        type RenewKeys = Assert<Equal<KeysOfUnion<Success<RenewInitialPresentationDispatchResult>>, 'ok' | 'status' | 'runId' | 'revision' | 'expiresAt' | 'renewAfterMs'>>;
        type DispatchKeys = Assert<Equal<KeysOfUnion<Success<DispatchInitialPresentationRunResult>>, 'ok' | 'status' | 'runId' | 'conversationId' | 'revision' | 'dispatchStatus'>>;

        type StartRunKeys = Assert<Equal<KeysOfUnion<Success<StartPresentationRunResult>['run']>,
          | 'runId' | 'clientRequestId' | 'conversationId' | 'selectedTemplateId'
          | 'revision' | 'createdAt' | 'updatedAt' | 'dispatchStatus'
          | 'artifactPhase' | 'disposition' | 'retainedCandidate' | 'actions'
        >>;
        type DraftKeys = Assert<Equal<keyof Success<CreatePresentationDraftResult>['draft'],
          'draftId' | 'revision' | 'expiresAt' | 'grantCount'
        >>;
        type PublicActionKeys = Assert<Equal<KeysOfUnion<PresentationRunPublicDto['actions']>,
          'openAllowed' | 'discardAllowed'
        >>;
        type FailureEnvelopeKeys = Assert<Equal<KeysOfUnion<PresentationRunFailure>,
          'ok' | 'code' | 'messageKey' | 'retryable' | 'state' | 'details'
        >>;
        type FailureDetailKeys = Assert<Equal<KeysOfUnion<PresentationRunFailure['details']>,
          | 'existingRunId' | 'runId' | 'dispatchStatus' | 'draftId'
          | 'conversationId' | 'grantId' | 'leaseExpiresAt' | 'reclaimAllowed'
          | 'retryAfterMs' | 'postInvoked' | 'queryRequired' | 'queueUnboundAtRevoke'
        >>;

        type PublicRunKeys = Assert<Equal<KeysOfUnion<PresentationRunPublicDto>,
          | 'runId' | 'clientRequestId' | 'conversationId' | 'selectedTemplateId'
          | 'revision' | 'createdAt' | 'updatedAt' | 'dispatchStatus'
          | 'artifactPhase' | 'disposition' | 'retainedCandidate' | 'actions'
        >>;
        type SecretKeys =
          | 'sourcePath' | 'nativePath' | 'snapshotPath' | 'templatePath'
          | 'referencePath' | 'workspacePath' | 'candidatePath' | 'evidencePath'
          | 'inspectionPath' | 'directive' | 'backendBody' | 'turnPayload'
          | 'port' | 'token';
        type NoPublicSecrets = Assert<Equal<Extract<KeysOfUnion<PresentationRunPublicDto>, SecretKeys>, never>>;
      `
    );

    expect(diagnostics).toBe('');
  });

  it('rejects paths, nonexclusive selectors, and impossible public run combinations', () => {
    const diagnostics = compileFixture(
      (moduleSpecifier) => `
        import type {
          GetPresentationRunRequest,
          GrantPresentationExternalDropRequest,
          PresentationRunPublicDto,
          PresentationSourceDescriptor,
          PresentationSourceRef,
          StartPresentationRunRequest,
        } from '${moduleSpecifier}';

        // @ts-expect-error managed start requests never accept renderer paths
        const pathBearingStart: StartPresentationRunRequest = { conversation_id: 'c', client_request_id: 'r', input: 'x', selected_template_id: 't', sources: [], files: ['/tmp/source.pdf'] };
        // @ts-expect-error descriptors never expose source paths
        const pathBearingDescriptor: PresentationSourceDescriptor = { grantId: 'g', displayName: 's.pdf', format: 'pdf', sourceKind: 'native-picker', byteLength: 1, sha256: 'a', expiresAt: 'now', path: '/tmp/source.pdf' };
        // @ts-expect-error refs carry only an opaque grant and expected byte identity
        const pathBearingRef: PresentationSourceRef = { grantId: 'g', expectedByteLength: 1, expectedSha256: 'a', snapshotPath: '/tmp/snapshot.pdf' };
        // @ts-expect-error get selectors are mutually exclusive
        const bothSelectors: GetPresentationRunRequest = { conversation_id: 'c', run_id: 'run', client_request_id: 'request' };
        // @ts-expect-error get requires exactly one selector
        const noSelector: GetPresentationRunRequest = { conversation_id: 'c' };
        declare const file: File;
        // @ts-expect-error external-drop callers cannot supply native paths
        const dropWithPath: GrantPresentationExternalDropRequest = { owner: { owner_type: 'conversation', conversation_id: 'c' }, files: [file], expected_owner_revision: 0, nativePath: '/tmp/source.pdf' };
        // @ts-expect-error uncertain runs never expose a retained candidate or actions
        const openUncertain: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'dispatch_uncertain', artifactPhase: 'sources_extracted', disposition: 'TRACKING_REQUIRED', retainedCandidate: { sha256: 'a', byteLength: 1 }, actions: { openAllowed: true, discardAllowed: true } };
        // @ts-expect-error retained review results require a retained candidate
        const retainedWithoutCandidate: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'retained', artifactPhase: 'rendered_exact_hash', disposition: 'REVIEW_REQUIRED', retainedCandidate: null, actions: { openAllowed: true, discardAllowed: true } };
        // @ts-expect-error candidate retention alone is not safety evidence for Open
        const openBeforeSafetyEvidence: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'retained', artifactPhase: 'candidate_retained', disposition: 'REVIEW_REQUIRED', retainedCandidate: { sha256: 'a', byteLength: 1 }, actions: { openAllowed: true, discardAllowed: true } };
        // @ts-expect-error copying a candidate alone is not safety evidence for Open
        const openAfterCandidateCopy: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'retained', artifactPhase: 'candidate_copied', disposition: 'REVIEW_REQUIRED', retainedCandidate: { sha256: 'a', byteLength: 1 }, actions: { openAllowed: true, discardAllowed: true } };
        // @ts-expect-error structural validity alone is not safety evidence for Open
        const openAfterStructuralValidation: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'retained', artifactPhase: 'structurally_valid', disposition: 'REVIEW_REQUIRED', retainedCandidate: { sha256: 'a', byteLength: 1 }, actions: { openAllowed: true, discardAllowed: true } };
        // @ts-expect-error Open authorization never removes Discard authorization
        const openWithoutDiscard: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'retained', artifactPhase: 'ooxml_inspected', disposition: 'REVIEW_REQUIRED', retainedCandidate: { sha256: 'a', byteLength: 1 }, actions: { openAllowed: true, discardAllowed: false } };
        // @ts-expect-error terminal verification cannot claim rendered evidence
        const terminalRendered: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'terminal_verified', artifactPhase: 'rendered_exact_hash', disposition: null, retainedCandidate: null, actions: { openAllowed: false, discardAllowed: false } };
        // @ts-expect-error discarded DTOs clear artifact state
        const discardedWithPhase: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'discarded', artifactPhase: 'none', disposition: null, retainedCandidate: null, actions: { openAllowed: false, discardAllowed: false } };

        void [pathBearingStart, pathBearingDescriptor, pathBearingRef, bothSelectors, noSelector, dropWithPath, openUncertain, retainedWithoutCandidate, openBeforeSafetyEvidence, openAfterCandidateCopy, openAfterStructuralValidation, openWithoutDiscard, terminalRendered, discardedWithPhase];
      `
    );

    expect(diagnostics).toBe('');
  });

  it('accepts closed early candidates and either Open decision after safety evidence at compile time', () => {
    const diagnostics = compileFixture(
      (moduleSpecifier) => `
        import type { PresentationRunPublicDto } from '${moduleSpecifier}';

        const retainedClosed: PresentationRunPublicDto = { runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't', revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'retained', artifactPhase: 'candidate_retained', disposition: 'REVIEW_REQUIRED', retainedCandidate: { sha256: 'a', byteLength: 1 }, actions: { openAllowed: false, discardAllowed: true } };
        const copiedClosed: PresentationRunPublicDto = { ...retainedClosed, artifactPhase: 'candidate_copied' };
        const structurallyValidClosed: PresentationRunPublicDto = { ...retainedClosed, artifactPhase: 'structurally_valid' };
        const inspectedClosed: PresentationRunPublicDto = { ...retainedClosed, artifactPhase: 'ooxml_inspected' };
        const inspectedOpen: PresentationRunPublicDto = { ...inspectedClosed, actions: { openAllowed: true, discardAllowed: true } };
        const renderedClosed: PresentationRunPublicDto = { ...retainedClosed, artifactPhase: 'rendered_exact_hash' };
        const renderedOpen: PresentationRunPublicDto = { ...renderedClosed, actions: { openAllowed: true, discardAllowed: true } };

        void [retainedClosed, copiedClosed, structurallyValidClosed, inspectedClosed, inspectedOpen, renderedClosed, renderedOpen];
      `
    );

    expect(diagnostics).toBe('');
  });

  it('rejects excluded failure codes and wrong success statuses for every restricted result', () => {
    const diagnostics = compileFixture(
      (moduleSpecifier) => `
        import type {
          BindPresentationDraftResult,
          ClaimInitialPresentationDispatchResult,
          CreatePresentationDraftResult,
          DispatchInitialPresentationRunResult,
          GrantPresentationExternalDropResult,
          GrantPresentationWorkspaceSourceResult,
          PickPresentationSourcesResult,
          PresentationSourceDescriptor,
          PresentationRunFailure,
          RenewInitialPresentationDispatchResult,
          RevokePresentationSourceResult,
          StartPresentationRunResult,
        } from '${moduleSpecifier}';

        declare const runNotFound: PresentationRunFailure & { code: 'RUN_NOT_FOUND' };
        declare const rateLimited: PresentationRunFailure & { code: 'RATE_LIMITED' };
        declare const leaseConflict: PresentationRunFailure & { code: 'LEASE_CONFLICT' };
        declare const draftNotFound: PresentationRunFailure & { code: 'DRAFT_NOT_FOUND' };
        declare const leaseExpired: PresentationRunFailure & { code: 'LEASE_EXPIRED' };
        declare const sourceTampered: PresentationRunFailure & { code: 'SOURCE_TAMPERED' };
        declare const dialogUnavailable: PresentationRunFailure & { code: 'DIALOG_UNAVAILABLE' };

        // @ts-expect-error createDraft excludes lookup failures
        const badCreateFailure: CreatePresentationDraftResult = runNotFound;
        // @ts-expect-error bindDraft excludes transient rate failures
        const badBindFailure: BindPresentationDraftResult = rateLimited;
        // @ts-expect-error picker excludes lease failures
        const badPickFailure: PickPresentationSourcesResult = leaseConflict;
        // @ts-expect-error workspace grant excludes draft failures
        const badWorkspaceFailure: GrantPresentationWorkspaceSourceResult = draftNotFound;
        // @ts-expect-error revoke excludes rate failures
        const badRevokeFailure: RevokePresentationSourceResult = rateLimited;
        // @ts-expect-error external drop excludes lease failures
        const badDropFailure: GrantPresentationExternalDropResult = leaseExpired;
        // @ts-expect-error claim excludes source failures
        const badClaimFailure: ClaimInitialPresentationDispatchResult = sourceTampered;
        // @ts-expect-error renew excludes rate failures
        const badRenewFailure: RenewInitialPresentationDispatchResult = rateLimited;
        // @ts-expect-error dispatch excludes dialog failures
        const badDispatchFailure: DispatchInitialPresentationRunResult = dialogUnavailable;

        declare const createSuccess: Extract<CreatePresentationDraftResult, { ok: true }>;
        declare const bindSuccess: Extract<BindPresentationDraftResult, { ok: true }>;
        declare const pickSuccess: Extract<PickPresentationSourcesResult, { ok: true; status: 'selected' }>;
        declare const workspaceSuccess: Extract<GrantPresentationWorkspaceSourceResult, { ok: true }>;
        declare const revokeSuccess: Extract<RevokePresentationSourceResult, { ok: true }>;
        declare const dropSuccess: Extract<GrantPresentationExternalDropResult, { ok: true }>;
        declare const claimSuccess: Extract<ClaimInitialPresentationDispatchResult, { ok: true }>;
        declare const renewSuccess: Extract<RenewInitialPresentationDispatchResult, { ok: true }>;
        declare const dispatchSuccess: Extract<DispatchInitialPresentationRunResult, { ok: true }>;
        declare const startSuccess: Extract<StartPresentationRunResult, { ok: true }>;
        declare const descriptor: PresentationSourceDescriptor;

        // @ts-expect-error createDraft has only created/existing statuses
        const badCreateStatus: CreatePresentationDraftResult = { ...createSuccess, status: 'bound' };
        // @ts-expect-error bindDraft has only bound/already_bound statuses
        const badBindStatus: BindPresentationDraftResult = { ...bindSuccess, status: 'created' };
        // @ts-expect-error picker has only cancelled/selected statuses
        const badPickStatus: PickPresentationSourcesResult = { ...pickSuccess, status: 'granted' };
        // @ts-expect-error workspace grants have only granted status
        const badWorkspaceStatus: GrantPresentationWorkspaceSourceResult = { ...workspaceSuccess, status: 'selected' };
        // @ts-expect-error revoke has only revoked/already_revoked statuses
        const badRevokeStatus: RevokePresentationSourceResult = { ...revokeSuccess, status: 'granted' };
        // @ts-expect-error external drop has only granted status
        const badDropStatus: GrantPresentationExternalDropResult = { ...dropSuccess, status: 'selected' };
        // @ts-expect-error claim has only claimed/already_claimed statuses
        const badClaimStatus: ClaimInitialPresentationDispatchResult = { ...claimSuccess, status: 'renewed' };
        // @ts-expect-error renew has only renewed status
        const badRenewStatus: RenewInitialPresentationDispatchResult = { ...renewSuccess, status: 'claimed' };
        // @ts-expect-error dispatch has only bound/already_bound statuses
        const badDispatchStatus: DispatchInitialPresentationRunResult = { ...dispatchSuccess, status: 'renewed' };
        // @ts-expect-error managed start succeeds only after source snapshotting
        const badStartPhase: StartPresentationRunResult = { ...startSuccess, run: { ...startSuccess.run, artifactPhase: 'none' } };
        // @ts-expect-error cancelled source selection never carries grants
        const badCancelledGrants: PickPresentationSourcesResult = { ok: true, status: 'cancelled', grants: [descriptor], ownerRevision: 1 };
        // @ts-expect-error claim renewal cadence is the fixed 10-second literal
        const badClaimRenewal: ClaimInitialPresentationDispatchResult = { ...claimSuccess, renewAfterMs: 10_001 };
        // @ts-expect-error lease renewal cadence is the fixed 10-second literal
        const badRenewRenewal: RenewInitialPresentationDispatchResult = { ...renewSuccess, renewAfterMs: 10_001 };
        // @ts-expect-error a successful initial dispatch is already bound
        const badDispatchDiscriminant: DispatchInitialPresentationRunResult = { ...dispatchSuccess, dispatchStatus: 'committed' };

        void [
          badCreateFailure, badBindFailure, badPickFailure, badWorkspaceFailure,
          badRevokeFailure, badDropFailure, badClaimFailure, badRenewFailure,
          badDispatchFailure, badCreateStatus, badBindStatus, badPickStatus,
          badWorkspaceStatus, badRevokeStatus, badDropStatus, badClaimStatus,
          badRenewStatus, badDispatchStatus, badStartPhase, badCancelledGrants,
          badClaimRenewal, badRenewRenewal, badDispatchDiscriminant,
        ];
      `
    );

    expect(diagnostics).toBe('');
  });

  it('rejects a terminal candidate before candidate retention at compile time', () => {
    const diagnostics = compileFixture(
      (moduleSpecifier) => `
        import type { PresentationRunPublicDto } from '${moduleSpecifier}';

        // @ts-expect-error sources_extracted is before durable candidate retention
        const earlyCandidate: PresentationRunPublicDto = {
          runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't',
          revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'terminal_verified',
          artifactPhase: 'sources_extracted', disposition: null,
          retainedCandidate: { sha256: 'a', byteLength: 1 },
          actions: { openAllowed: false, discardAllowed: false },
        };

        void earlyCandidate;
      `
    );

    expect(diagnostics).toBe('');
  });

  it('rejects a null terminal candidate after candidate retention at compile time', () => {
    const diagnostics = compileFixture(
      (moduleSpecifier) => `
        import type { PresentationRunPublicDto } from '${moduleSpecifier}';

        // @ts-expect-error candidate_retained and later phases require candidate identity
        const missingCandidate: PresentationRunPublicDto = {
          runId: 'r', clientRequestId: 'q', conversationId: 'c', selectedTemplateId: 't',
          revision: 1, createdAt: 'now', updatedAt: 'now', dispatchStatus: 'terminal_verified',
          artifactPhase: 'candidate_retained', disposition: null, retainedCandidate: null,
          actions: { openAllowed: false, discardAllowed: false },
        };

        void missingCandidate;
      `
    );

    expect(diagnostics).toBe('');
  });
});

describe('managed presentation stable constants', () => {
  it('keeps the managed path disabled and shares the existing PPTX directive prefix', () => {
    expect({ enabled: PRESENTATION_RUN_V2_ENABLED, prefix: PRESENTATION_RUN_DIRECTIVE_PREFIX }).toEqual({
      enabled: false,
      prefix: 'Create a presentation from the request below.',
    });
  });

  it('publishes the complete dispatch, artifact, disposition, and failure-state names', () => {
    expect({
      dispatch: PRESENTATION_RUN_DISPATCH_STATUSES,
      artifact: PRESENTATION_RUN_ARTIFACT_PHASES,
      disposition: PRESENTATION_RUN_DISPOSITIONS,
      failure: PRESENTATION_RUN_FAILURE_STATES,
    }).toEqual({
      dispatch: [
        'allocating',
        'committed',
        'dispatching',
        'bound',
        'terminal_verified',
        'retained',
        'failed_retained',
        'dispatch_uncertain',
        'discarded',
      ],
      artifact: [
        'none',
        'sources_snapshotted',
        'sources_extracted',
        'candidate_retained',
        'candidate_copied',
        'structurally_valid',
        'ooxml_inspected',
        'rendered_exact_hash',
      ],
      disposition: ['TRACKING_REQUIRED', 'REVIEW_REQUIRED'],
      failure: [
        'preflight',
        'lookup',
        'draft_expired',
        'draft_active',
        'grant_validation',
        'grant_expired',
        'committed',
        'dispatch_uncertain',
        'bound',
        'retained',
      ],
    });
  });
});
