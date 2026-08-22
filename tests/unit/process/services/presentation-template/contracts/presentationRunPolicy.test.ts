/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_RUN_ARTIFACT_PHASES,
  PRESENTATION_RUN_DISPATCH_STATUSES,
  PRESENTATION_RUN_LIMITS as LEGACY_PRESENTATION_RUN_LIMITS,
} from '@/common/config/constants';
import {
  PRESENTATION_CONVERSATION_ID_PATTERN,
  normalizePresentationConversationId,
} from '@/common/types/office/presentationConversationId';
import { PRESENTATION_RUN_LIMITS } from '@/common/types/office/presentationRunPolicy';
import type { PresentationRunFailure, PresentationRunFailureCode } from '@/common/types/office/presentationRun';

const RUN_ID = '434393ce-dd45-44fe-a51c-262b2b181cc5';
const MESSAGE_KEY = 'conversation.presentation.failure';
const RECOVERY_CURSOR_TEST_SECRET = 'main-owned-recovery-cursor-test-secret';
const presentationRunTypeFile = resolve(process.cwd(), 'packages/desktop/src/common/types/office/presentationRun.ts');
const presentationRunLimitsFile = resolve(
  process.cwd(),
  'packages/desktop/src/common/types/office/presentationRunPolicy.ts'
);
const presentationRunPolicyFile = resolve(
  process.cwd(),
  'tests/unit/process/services/presentation-template/contracts/presentationRunPolicy.test.ts'
);

const presentationConversationIdSchema = z
  .string()
  .regex(PRESENTATION_CONVERSATION_ID_PATTERN)
  .transform((value): string => normalizePresentationConversationId(value)!);

const compilePolicyFixture = (source: (moduleSpecifiers: { policy: string; types: string }) => string): string => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'presentation-run-policy-'));
  const fixturePath = join(fixtureDirectory, 'fixture.ts');
  const moduleSpecifierFor = (filePath: string): string => {
    const relativePath = relative(fixtureDirectory, filePath).split(sep).join('/');
    return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
  };

  try {
    writeFileSync(
      fixturePath,
      source({
        policy: moduleSpecifierFor(presentationRunPolicyFile),
        types: moduleSpecifierFor(presentationRunTypeFile),
      }),
      'utf8'
    );
    const program = ts.createProgram([fixturePath], {
      allowImportingTsExtensions: true,
      baseUrl: process.cwd(),
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      paths: {
        '@/*': ['packages/desktop/src/*'],
        zod: ['node_modules/zod/index.d.cts'],
      },
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2023,
      types: ['node'],
    });
    return ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    });
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
};

const failure = <Code extends PresentationRunFailureCode, Retryable extends boolean, State extends string, Details>(
  code: Code,
  retryable: Retryable,
  state: State,
  details: Details
) => ({
  ok: false as const,
  code,
  messageKey: MESSAGE_KEY,
  retryable,
  state,
  details,
});

export const PRESENTATION_RUN_FAILURE_POLICY = {
  FEATURE_DISABLED: failure('FEATURE_DISABLED', false, 'preflight', null),
  DESKTOP_REQUIRED: failure('DESKTOP_REQUIRED', false, 'preflight', null),
  INVALID_REQUEST: failure('INVALID_REQUEST', false, 'preflight', null),
  REQUEST_COLLISION: failure('REQUEST_COLLISION', false, 'lookup', { existingRunId: RUN_ID }),
  RUN_NOT_FOUND: failure('RUN_NOT_FOUND', false, 'lookup', null),
  RUN_FORBIDDEN: failure('RUN_FORBIDDEN', false, 'lookup', null),
  RUN_STATE_CONFLICT: failure('RUN_STATE_CONFLICT', false, 'lookup', {
    runId: RUN_ID,
    dispatchStatus: 'committed' as const,
  }),
  DRAFT_NOT_FOUND: failure('DRAFT_NOT_FOUND', false, 'lookup', null),
  DRAFT_EXPIRED: failure('DRAFT_EXPIRED', false, 'draft_expired', { draftId: RUN_ID }),
  DRAFT_FOREIGN: failure('DRAFT_FOREIGN', false, 'lookup', null),
  DRAFT_ALREADY_BOUND: failure('DRAFT_ALREADY_BOUND', false, 'draft_active', {
    draftId: RUN_ID,
    conversationId: RUN_ID,
  }),
  DRAFT_LIMIT_EXCEEDED: failure('DRAFT_LIMIT_EXCEEDED', false, 'preflight', null),
  GRANT_LIMIT_EXCEEDED: failure('GRANT_LIMIT_EXCEEDED', false, 'preflight', null),
  NATIVE_FILE_REQUIRED: failure('NATIVE_FILE_REQUIRED', false, 'preflight', null),
  DIALOG_UNAVAILABLE: failure('DIALOG_UNAVAILABLE', false, 'preflight', null),
  LEASE_CONFLICT: failure('LEASE_CONFLICT', false, 'committed', {
    runId: RUN_ID,
    leaseExpiresAt: '2026-08-04T00:00:30.000Z',
  }),
  LEASE_EXPIRED: failure('LEASE_EXPIRED', false, 'committed', { runId: RUN_ID, reclaimAllowed: true as const }),
  LEASE_FOREIGN: failure('LEASE_FOREIGN', false, 'committed', { runId: RUN_ID }),
  SCOPE_UNAVAILABLE: failure('SCOPE_UNAVAILABLE', false, 'preflight', null),
  TEAM_SCOPE_UNSUPPORTED: failure('TEAM_SCOPE_UNSUPPORTED', false, 'preflight', null),
  RUNTIME_UNSUPPORTED: failure('RUNTIME_UNSUPPORTED', false, 'preflight', null),
  SOURCE_GRANT_INVALID: failure('SOURCE_GRANT_INVALID', false, 'grant_validation', { grantId: RUN_ID }),
  SOURCE_GRANT_EXPIRED: failure('SOURCE_GRANT_EXPIRED', false, 'grant_expired', { grantId: RUN_ID }),
  SOURCE_GRANT_FOREIGN: failure('SOURCE_GRANT_FOREIGN', false, 'grant_validation', { grantId: RUN_ID }),
  SOURCE_GRANT_REPLAYED: failure('SOURCE_GRANT_REPLAYED', false, 'grant_validation', { grantId: RUN_ID }),
  SOURCE_TAMPERED: failure('SOURCE_TAMPERED', false, 'grant_validation', { grantId: RUN_ID }),
  SOURCE_LIMIT_EXCEEDED: failure('SOURCE_LIMIT_EXCEEDED', false, 'grant_validation', { grantId: RUN_ID }),
  SOURCE_FORMAT_UNSUPPORTED: failure('SOURCE_FORMAT_UNSUPPORTED', false, 'grant_validation', { grantId: RUN_ID }),
  TEMPLATE_NOT_FOUND: failure('TEMPLATE_NOT_FOUND', false, 'preflight', null),
  TEMPLATE_UNSUPPORTED: failure('TEMPLATE_UNSUPPORTED', false, 'preflight', null),
  RESOURCE_LIMIT_EXCEEDED: failure('RESOURCE_LIMIT_EXCEEDED', false, 'preflight', null),
  RATE_LIMITED: failure('RATE_LIMITED', true, 'preflight', { retryAfterMs: 1_000, postInvoked: false as const }),
  DISK_RESERVE_EXCEEDED: failure('DISK_RESERVE_EXCEEDED', false, 'preflight', null),
  PERSISTENCE_FAILED: failure('PERSISTENCE_FAILED', false, 'committed', { postInvoked: false as const }),
  BACKEND_PREFLIGHT_BLOCKED: failure('BACKEND_PREFLIGHT_BLOCKED', true, 'committed', {
    runId: RUN_ID,
    retryAfterMs: 1_000,
    postInvoked: false as const,
  }),
  DISPATCH_UNCERTAIN: failure('DISPATCH_UNCERTAIN', false, 'dispatch_uncertain', {
    runId: RUN_ID,
    postInvoked: true as const,
    queryRequired: true as const,
  }),
  TRACKING_REQUIRED: failure('TRACKING_REQUIRED', false, 'bound', { runId: RUN_ID }),
  CANDIDATE_UNAVAILABLE: failure('CANDIDATE_UNAVAILABLE', false, 'retained', { runId: RUN_ID }),
  HASH_MISMATCH: failure('HASH_MISMATCH', false, 'retained', { runId: RUN_ID }),
  UNSAFE_TO_OPEN: failure('UNSAFE_TO_OPEN', false, 'retained', { runId: RUN_ID }),
  UNSAFE_TO_DISCARD: failure('UNSAFE_TO_DISCARD', false, 'committed', { runId: RUN_ID }),
  INTERNAL_ERROR: failure('INTERNAL_ERROR', false, 'preflight', null),
} as const satisfies Record<PresentationRunFailureCode, PresentationRunFailure>;

const strictDetails = {
  runId: z.object({ runId: z.string() }).strict(),
  grantId: z.object({ grantId: z.string().optional() }).strict(),
};

const failureEnvelope = <
  Code extends z.ZodTypeAny,
  Retryable extends boolean,
  State extends z.ZodTypeAny,
  Details extends z.ZodTypeAny,
>(
  code: Code,
  retryable: Retryable,
  state: State,
  details: Details
) =>
  z
    .object({
      ok: z.literal(false),
      code,
      messageKey: z.string().min(1),
      retryable: z.literal(retryable),
      state,
      details,
    })
    .strict();

export const presentationRunFailureSchema = z.union([
  failureEnvelope(
    z.enum([
      'FEATURE_DISABLED',
      'DESKTOP_REQUIRED',
      'INVALID_REQUEST',
      'SCOPE_UNAVAILABLE',
      'TEAM_SCOPE_UNSUPPORTED',
      'RUNTIME_UNSUPPORTED',
      'DRAFT_LIMIT_EXCEEDED',
      'GRANT_LIMIT_EXCEEDED',
      'NATIVE_FILE_REQUIRED',
      'DIALOG_UNAVAILABLE',
      'TEMPLATE_NOT_FOUND',
      'TEMPLATE_UNSUPPORTED',
      'RESOURCE_LIMIT_EXCEEDED',
      'DISK_RESERVE_EXCEEDED',
      'INTERNAL_ERROR',
    ]),
    false,
    z.literal('preflight'),
    z.null()
  ),
  failureEnvelope(
    z.literal('REQUEST_COLLISION'),
    false,
    z.literal('lookup'),
    z.object({ existingRunId: z.string() }).strict()
  ),
  failureEnvelope(
    z.enum(['RUN_NOT_FOUND', 'RUN_FORBIDDEN', 'DRAFT_NOT_FOUND', 'DRAFT_FOREIGN']),
    false,
    z.literal('lookup'),
    z.null()
  ),
  failureEnvelope(
    z.literal('RUN_STATE_CONFLICT'),
    false,
    z.literal('lookup'),
    z.object({ runId: z.string(), dispatchStatus: z.enum(PRESENTATION_RUN_DISPATCH_STATUSES) }).strict()
  ),
  failureEnvelope(
    z.literal('DRAFT_EXPIRED'),
    false,
    z.literal('draft_expired'),
    z.object({ draftId: z.string() }).strict()
  ),
  failureEnvelope(
    z.literal('DRAFT_ALREADY_BOUND'),
    false,
    z.literal('draft_active'),
    z.object({ draftId: z.string(), conversationId: z.string() }).strict()
  ),
  failureEnvelope(
    z.enum([
      'SOURCE_GRANT_INVALID',
      'SOURCE_GRANT_FOREIGN',
      'SOURCE_TAMPERED',
      'SOURCE_LIMIT_EXCEEDED',
      'SOURCE_FORMAT_UNSUPPORTED',
    ]),
    false,
    z.literal('grant_validation'),
    strictDetails.grantId
  ),
  // A replayed grant carries one detail the rest of grant_validation does not: whether the queue
  // was already unbound when the revoke landed. Mirrors PresentationRunFailure, which split this
  // code out of the group for exactly that reason.
  failureEnvelope(
    z.literal('SOURCE_GRANT_REPLAYED'),
    false,
    z.literal('grant_validation'),
    z.object({ grantId: z.string().optional(), queueUnboundAtRevoke: z.literal(true).optional() }).strict()
  ),
  failureEnvelope(
    z.literal('SOURCE_GRANT_EXPIRED'),
    false,
    z.literal('grant_expired'),
    z.object({ grantId: z.string() }).strict()
  ),
  failureEnvelope(
    z.literal('LEASE_CONFLICT'),
    false,
    z.literal('committed'),
    z.object({ runId: z.string(), leaseExpiresAt: z.string() }).strict()
  ),
  failureEnvelope(
    z.literal('LEASE_EXPIRED'),
    false,
    z.literal('committed'),
    z.object({ runId: z.string(), reclaimAllowed: z.literal(true) }).strict()
  ),
  failureEnvelope(z.literal('LEASE_FOREIGN'), false, z.literal('committed'), strictDetails.runId),
  failureEnvelope(
    z.literal('RATE_LIMITED'),
    true,
    z.literal('preflight'),
    z.object({ retryAfterMs: z.number(), postInvoked: z.literal(false) }).strict()
  ),
  failureEnvelope(
    z.literal('BACKEND_PREFLIGHT_BLOCKED'),
    true,
    z.literal('committed'),
    z.object({ runId: z.string(), retryAfterMs: z.number(), postInvoked: z.literal(false) }).strict()
  ),
  failureEnvelope(
    z.literal('PERSISTENCE_FAILED'),
    false,
    z.enum(['preflight', 'committed']),
    z.object({ postInvoked: z.literal(false) }).strict()
  ),
  failureEnvelope(
    z.literal('DISPATCH_UNCERTAIN'),
    false,
    z.literal('dispatch_uncertain'),
    z.object({ runId: z.string(), postInvoked: z.literal(true), queryRequired: z.literal(true) }).strict()
  ),
  failureEnvelope(z.literal('TRACKING_REQUIRED'), false, z.enum(['bound', 'retained']), strictDetails.runId),
  failureEnvelope(
    z.enum(['CANDIDATE_UNAVAILABLE', 'HASH_MISMATCH']),
    false,
    z.literal('retained'),
    strictDetails.runId
  ),
  failureEnvelope(
    z.enum(['UNSAFE_TO_OPEN', 'UNSAFE_TO_DISCARD']),
    false,
    z.enum(['committed', 'dispatching', 'bound', 'dispatch_uncertain', 'retained']),
    strictDetails.runId
  ),
]);

const runBaseSchema = z
  .object({
    runId: z.string(),
    clientRequestId: z.string(),
    conversationId: z.string(),
    selectedTemplateId: z.string(),
    revision: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
const noActionsSchema = z.object({ openAllowed: z.literal(false), discardAllowed: z.literal(false) }).strict();
const discardOnlyActionsSchema = z.object({ openAllowed: z.literal(false), discardAllowed: z.literal(true) }).strict();
const retainedActionsSchema = z.object({ openAllowed: z.literal(true), discardAllowed: z.literal(true) }).strict();
const safetyQualifiedActionsSchema = z.union([discardOnlyActionsSchema, retainedActionsSchema]);
const retainedCandidateSchema = z.object({ sha256: z.string(), byteLength: z.number() }).strict();

export const presentationRunPublicSchema = z.union([
  runBaseSchema.extend({
    dispatchStatus: z.enum(['allocating', 'committed']),
    artifactPhase: z.enum(['none', 'sources_snapshotted', 'sources_extracted']),
    disposition: z.null(),
    retainedCandidate: z.null(),
    actions: discardOnlyActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.enum(['dispatching', 'bound']),
    artifactPhase: z.enum(['none', 'sources_snapshotted', 'sources_extracted']),
    disposition: z.null(),
    retainedCandidate: z.null(),
    actions: noActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.literal('terminal_verified'),
    artifactPhase: z.literal('sources_extracted'),
    disposition: z.null(),
    retainedCandidate: z.null(),
    actions: noActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.literal('terminal_verified'),
    artifactPhase: z.enum(['candidate_retained', 'candidate_copied', 'structurally_valid', 'ooxml_inspected']),
    disposition: z.null(),
    retainedCandidate: retainedCandidateSchema,
    actions: noActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.enum(['retained', 'failed_retained']),
    artifactPhase: z.enum(['candidate_retained', 'candidate_copied', 'structurally_valid']),
    disposition: z.literal('REVIEW_REQUIRED'),
    retainedCandidate: retainedCandidateSchema,
    actions: discardOnlyActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.enum(['retained', 'failed_retained']),
    artifactPhase: z.enum(['ooxml_inspected', 'rendered_exact_hash']),
    disposition: z.literal('REVIEW_REQUIRED'),
    retainedCandidate: retainedCandidateSchema,
    actions: safetyQualifiedActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.literal('failed_retained'),
    artifactPhase: z.enum(['none', 'sources_snapshotted', 'sources_extracted']),
    disposition: z.literal('TRACKING_REQUIRED'),
    retainedCandidate: z.null(),
    actions: discardOnlyActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.enum(['retained', 'dispatch_uncertain']),
    artifactPhase: z.enum(['none', 'sources_snapshotted', 'sources_extracted']),
    disposition: z.literal('TRACKING_REQUIRED'),
    retainedCandidate: z.null(),
    actions: noActionsSchema,
  }),
  runBaseSchema.extend({
    dispatchStatus: z.literal('discarded'),
    artifactPhase: z.null(),
    disposition: z.null(),
    retainedCandidate: z.null(),
    actions: noActionsSchema,
  }),
]);

export const recoverablePresentationRunsRequestSchema = z
  .object({
    conversation_id: presentationConversationIdSchema,
    cursor: z.string().min(1).optional(),
    limit: z
      .number()
      .int()
      .min(PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_MIN_LIMIT)
      .max(PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_MAX_LIMIT)
      .default(PRESENTATION_RUN_LIMITS.RECOVERABLE_LIST_DEFAULT_LIMIT),
  })
  .strict();

describe('managed presentation schema type coupling', () => {
  it('keeps failure, public-run, and recovery schemas bidirectionally equivalent to production types', () => {
    const diagnostics = compilePolicyFixture(
      ({ policy, types }) => `
        import {
          presentationRunFailureSchema,
          presentationRunPublicSchema,
          recoverablePresentationRunsRequestSchema,
        } from '${policy}';
        import type {
          ListRecoverablePresentationRunsRequest,
          PresentationRunFailure,
          PresentationRunFailureCode,
          PresentationRunPublicDto,
        } from '${types}';
        import type { z } from 'zod';

        type Assert<T extends true> = T;
        type Equal<Left, Right> =
          [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
        type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never;
        type SameDistributedKeys<Actual, Production> = Equal<
          KeysOfUnion<Actual>,
          KeysOfUnion<Production>
        >;
        type EveryTrue<Value> = Exclude<Value, true> extends never ? true : false;
        type FailureForCode<Failure, Code extends PresentationRunFailureCode> =
          Failure extends { code: infer Codes extends PresentationRunFailureCode }
            ? Code extends Codes
              ? Failure
              : never
            : never;
        type DetailsForCode<Failure, Code extends PresentationRunFailureCode> =
          FailureForCode<Failure, Code> extends infer Matched
            ? Matched extends { details: infer Details }
              ? Details
              : never
            : never;
        type DetailKeyParity<SchemaFailure> = {
          [Code in PresentationRunFailureCode]: SameDistributedKeys<
            DetailsForCode<SchemaFailure, Code>,
            DetailsForCode<PresentationRunFailure, Code>
          >;
        }[PresentationRunFailureCode];

        type SchemaFailureInput = z.input<typeof presentationRunFailureSchema>;
        type SchemaFailureOutput = z.output<typeof presentationRunFailureSchema>;
        type SchemaPublicInput = z.input<typeof presentationRunPublicSchema>;
        type SchemaPublicOutput = z.output<typeof presentationRunPublicSchema>;
        type SchemaRecoveryInput = z.input<typeof recoverablePresentationRunsRequestSchema>;
        type SchemaRecoveryOutput = z.output<typeof recoverablePresentationRunsRequestSchema>;

        type FailureInputToProduction = Assert<SchemaFailureInput extends PresentationRunFailure ? true : false>;
        type FailureProductionToInput = Assert<PresentationRunFailure extends SchemaFailureInput ? true : false>;
        type FailureOutputToProduction = Assert<SchemaFailureOutput extends PresentationRunFailure ? true : false>;
        type FailureProductionToOutput = Assert<PresentationRunFailure extends SchemaFailureOutput ? true : false>;
        type PublicInputToProduction = Assert<SchemaPublicInput extends PresentationRunPublicDto ? true : false>;
        type PublicProductionToInput = Assert<PresentationRunPublicDto extends SchemaPublicInput ? true : false>;
        type PublicOutputToProduction = Assert<SchemaPublicOutput extends PresentationRunPublicDto ? true : false>;
        type PublicProductionToOutput = Assert<PresentationRunPublicDto extends SchemaPublicOutput ? true : false>;
        type RecoveryInputToProduction = Assert<SchemaRecoveryInput extends ListRecoverablePresentationRunsRequest ? true : false>;
        type RecoveryProductionToInput = Assert<ListRecoverablePresentationRunsRequest extends SchemaRecoveryInput ? true : false>;

        type FailureInputTopLevelKeys = Assert<SameDistributedKeys<SchemaFailureInput, PresentationRunFailure>>;
        type FailureOutputTopLevelKeys = Assert<SameDistributedKeys<SchemaFailureOutput, PresentationRunFailure>>;
        type FailureInputDetailKeys = Assert<EveryTrue<DetailKeyParity<SchemaFailureInput>>>;
        type FailureOutputDetailKeys = Assert<EveryTrue<DetailKeyParity<SchemaFailureOutput>>>;
        type PublicInputTopLevelKeys = Assert<SameDistributedKeys<SchemaPublicInput, PresentationRunPublicDto>>;
        type PublicOutputTopLevelKeys = Assert<SameDistributedKeys<SchemaPublicOutput, PresentationRunPublicDto>>;
        type PublicInputActionKeys = Assert<SameDistributedKeys<
          SchemaPublicInput['actions'],
          PresentationRunPublicDto['actions']
        >>;
        type PublicOutputActionKeys = Assert<SameDistributedKeys<
          SchemaPublicOutput['actions'],
          PresentationRunPublicDto['actions']
        >>;
        type PublicInputCandidateKeys = Assert<SameDistributedKeys<
          Exclude<SchemaPublicInput['retainedCandidate'], null>,
          Exclude<PresentationRunPublicDto['retainedCandidate'], null>
        >>;
        type PublicOutputCandidateKeys = Assert<SameDistributedKeys<
          Exclude<SchemaPublicOutput['retainedCandidate'], null>,
          Exclude<PresentationRunPublicDto['retainedCandidate'], null>
        >>;
        type RecoveryInputKeys = Assert<SameDistributedKeys<
          SchemaRecoveryInput,
          ListRecoverablePresentationRunsRequest
        >>;
        type RecoveryOutputKeys = Assert<SameDistributedKeys<
          SchemaRecoveryOutput,
          ListRecoverablePresentationRunsRequest
        >>;

        type OptionalSchemaOnlyKeyMutation = Assert<Equal<
          SameDistributedKeys<{ id: string; secret?: string }, { id: string }>,
          false
        >>;
      `
    );

    expect(diagnostics).toBe('');
  });
});

describe('managed presentation failure policy', () => {
  it('accepts the exhaustive code-specific retryability, state, and details map', () => {
    const rejectedCodes = Object.values(PRESENTATION_RUN_FAILURE_POLICY)
      .filter((entry) => !presentationRunFailureSchema.safeParse(entry).success)
      .map((entry) => entry.code);

    expect(rejectedCodes).toEqual([]);
  });

  it('rejects drift in retryability, state, details, or envelope fields for every code', () => {
    const acceptedMutations = Object.values(PRESENTATION_RUN_FAILURE_POLICY).flatMap((entry) => {
      const mutations: unknown[] = [
        { ...entry, retryable: !entry.retryable },
        { ...entry, state: 'wrong_state' },
        { ...entry, details: { unexpected: true } },
        { ...entry, rawError: 'private backend error' },
      ];
      return mutations.filter((mutation) => presentationRunFailureSchema.safeParse(mutation).success);
    });

    expect(acceptedMutations).toEqual([]);
  });
});

describe('managed presentation public-state policy', () => {
  const base = {
    runId: RUN_ID,
    clientRequestId: RUN_ID,
    conversationId: RUN_ID,
    selectedTemplateId: 'business-review',
    revision: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:01.000Z',
  };
  const candidate = { sha256: 'a'.repeat(64), byteLength: 4_096 };
  const noActions = { openAllowed: false, discardAllowed: false } as const;
  const discardOnlyActions = { openAllowed: false, discardAllowed: true } as const;
  const retainedActions = { openAllowed: true, discardAllowed: true } as const;
  const openOnlyActions = { openAllowed: true, discardAllowed: false } as const;
  const dispatchStatuses = [
    'allocating',
    'committed',
    'dispatching',
    'bound',
    'terminal_verified',
    'retained',
    'failed_retained',
    'dispatch_uncertain',
    'discarded',
  ] as const;
  const artifactPhases = [
    null,
    'none',
    'sources_snapshotted',
    'sources_extracted',
    'candidate_retained',
    'candidate_copied',
    'structurally_valid',
    'ooxml_inspected',
    'rendered_exact_hash',
  ] as const;
  const dispositions = [null, 'TRACKING_REQUIRED', 'REVIEW_REQUIRED'] as const;
  const candidates = [null, candidate] as const;
  const actionVariants = [noActions, discardOnlyActions, retainedActions, openOnlyActions] as const;

  type PublicState = {
    dispatchStatus: (typeof dispatchStatuses)[number];
    artifactPhase: (typeof artifactPhases)[number];
    disposition: (typeof dispositions)[number];
    retainedCandidate: (typeof candidates)[number];
    actions: (typeof actionVariants)[number];
  };

  const buildFamily = (
    familyDispatches: readonly PublicState['dispatchStatus'][],
    familyPhases: readonly PublicState['artifactPhase'][],
    disposition: PublicState['disposition'],
    retainedCandidate: PublicState['retainedCandidate'],
    actions: PublicState['actions']
  ): PublicState[] =>
    familyDispatches.flatMap((dispatchStatus) =>
      familyPhases.map((artifactPhase) => ({
        dispatchStatus,
        artifactPhase,
        disposition,
        retainedCandidate,
        actions,
      }))
    );

  const allowedStates: PublicState[] = [
    ...buildFamily(
      ['allocating', 'committed'],
      ['none', 'sources_snapshotted', 'sources_extracted'],
      null,
      null,
      discardOnlyActions
    ),
    ...buildFamily(
      ['dispatching', 'bound'],
      ['none', 'sources_snapshotted', 'sources_extracted'],
      null,
      null,
      noActions
    ),
    ...buildFamily(['terminal_verified'], ['sources_extracted'], null, null, noActions),
    ...buildFamily(
      ['terminal_verified'],
      ['candidate_retained', 'candidate_copied', 'structurally_valid', 'ooxml_inspected'],
      null,
      candidate,
      noActions
    ),
    ...buildFamily(
      ['retained', 'failed_retained'],
      ['candidate_retained', 'candidate_copied', 'structurally_valid'],
      'REVIEW_REQUIRED',
      candidate,
      discardOnlyActions
    ),
    ...buildFamily(
      ['retained', 'failed_retained'],
      ['ooxml_inspected', 'rendered_exact_hash'],
      'REVIEW_REQUIRED',
      candidate,
      discardOnlyActions
    ),
    ...buildFamily(
      ['retained', 'failed_retained'],
      ['ooxml_inspected', 'rendered_exact_hash'],
      'REVIEW_REQUIRED',
      candidate,
      retainedActions
    ),
    ...buildFamily(
      ['failed_retained'],
      ['none', 'sources_snapshotted', 'sources_extracted'],
      'TRACKING_REQUIRED',
      null,
      discardOnlyActions
    ),
    ...buildFamily(
      ['retained', 'dispatch_uncertain'],
      ['none', 'sources_snapshotted', 'sources_extracted'],
      'TRACKING_REQUIRED',
      null,
      noActions
    ),
    ...buildFamily(['discarded'], [null], null, null, noActions),
  ];

  const stateKey = (state: PublicState): string =>
    JSON.stringify([
      state.dispatchStatus,
      state.artifactPhase,
      state.disposition,
      state.retainedCandidate === null ? null : 'candidate',
      state.actions.openAllowed,
      state.actions.discardAllowed,
    ]);

  const runForState = (state: PublicState): Record<string, unknown> => ({ ...base, ...state });

  it('accepts exactly the complete allowed public-state matrix and rejects every other combination', () => {
    const allStates = dispatchStatuses.flatMap((dispatchStatus) =>
      artifactPhases.flatMap((artifactPhase) =>
        dispositions.flatMap((disposition) =>
          candidates.flatMap((retainedCandidate) =>
            actionVariants.map((actions) => ({
              dispatchStatus,
              artifactPhase,
              disposition,
              retainedCandidate,
              actions,
            }))
          )
        )
      )
    );
    const expectedAllowed = new Set(allowedStates.map(stateKey));
    const actualAllowed = new Set(
      allStates.filter((state) => presentationRunPublicSchema.safeParse(runForState(state)).success).map(stateKey)
    );

    expect(allStates).toHaveLength(1_944);
    expect(expectedAllowed.size).toBe(41);
    expect(actualAllowed).toEqual(expectedAllowed);
  });

  it.each(['candidate_retained', 'candidate_copied', 'structurally_valid'] as const)(
    'permits Discard but rejects Open before safety evidence at %s',
    (artifactPhase) => {
      const discardOnlyState = buildFamily(
        ['retained'],
        [artifactPhase],
        'REVIEW_REQUIRED',
        candidate,
        discardOnlyActions
      )[0];
      const openState = { ...discardOnlyState, actions: retainedActions };

      expect(presentationRunPublicSchema.safeParse(runForState(discardOnlyState)).success).toBe(true);
      expect(presentationRunPublicSchema.safeParse(runForState(openState)).success).toBe(false);
    }
  );

  it.each(['ooxml_inspected', 'rendered_exact_hash'] as const)(
    'allows Open to remain denied or become authorized after %s safety evidence',
    (artifactPhase) => {
      const openDenied = buildFamily(
        ['retained'],
        [artifactPhase],
        'REVIEW_REQUIRED',
        candidate,
        discardOnlyActions
      )[0];
      const openAuthorized = { ...openDenied, actions: retainedActions };

      expect(presentationRunPublicSchema.safeParse(runForState(openDenied)).success).toBe(true);
      expect(presentationRunPublicSchema.safeParse(runForState(openAuthorized)).success).toBe(true);
    }
  );

  it.each(['ooxml_inspected', 'rendered_exact_hash'] as const)(
    'requires a retained candidate and Discard permission after %s safety evidence',
    (artifactPhase) => {
      const validState = buildFamily(['retained'], [artifactPhase], 'REVIEW_REQUIRED', candidate, retainedActions)[0];
      const missingCandidate = { ...validState, retainedCandidate: null };
      const discardDenied = { ...validState, actions: openOnlyActions };

      expect(presentationRunPublicSchema.safeParse(runForState(missingCandidate)).success).toBe(false);
      expect(presentationRunPublicSchema.safeParse(runForState(discardDenied)).success).toBe(false);
    }
  );

  it('rejects unknown and private fields at every nested public DTO layer', () => {
    const state = buildFamily(['retained'], ['rendered_exact_hash'], 'REVIEW_REQUIRED', candidate, retainedActions)[0];
    const validRun = runForState(state);

    expect(presentationRunPublicSchema.safeParse({ ...validRun, workspacePath: '/tmp/private' }).success).toBe(false);
    expect(
      presentationRunPublicSchema.safeParse({
        ...validRun,
        actions: { ...retainedActions, backendBody: 'private' },
      }).success
    ).toBe(false);
    expect(
      presentationRunPublicSchema.safeParse({
        ...validRun,
        retainedCandidate: { ...candidate, candidatePath: '/tmp/private' },
      }).success
    ).toBe(false);
  });

  it('accepts terminal verification before a candidate is retained', () => {
    const state = buildFamily(['terminal_verified'], ['sources_extracted'], null, null, noActions)[0];

    expect(presentationRunPublicSchema.safeParse(runForState(state)).success).toBe(true);
  });

  it('rejects an early terminal candidate without changing another dimension', () => {
    const state = buildFamily(['terminal_verified'], ['sources_extracted'], null, candidate, noActions)[0];

    expect(presentationRunPublicSchema.safeParse(runForState(state)).success).toBe(false);
  });

  it('accepts terminal verification after a candidate is retained', () => {
    const state = buildFamily(['terminal_verified'], ['candidate_retained'], null, candidate, noActions)[0];

    expect(presentationRunPublicSchema.safeParse(runForState(state)).success).toBe(true);
  });

  it('rejects a null candidate after retention without changing another dimension', () => {
    const state = buildFamily(['terminal_verified'], ['candidate_retained'], null, null, noActions)[0];

    expect(presentationRunPublicSchema.safeParse(runForState(state)).success).toBe(false);
  });

  it.each([
    ['dispatch status', { dispatchStatus: 'bound' }],
    ['artifact phase', { artifactPhase: 'rendered_exact_hash' }],
    ['disposition', { disposition: 'TRACKING_REQUIRED' }],
    ['actions', { actions: discardOnlyActions }],
  ] as const)('rejects an independently invalid %s', (_dimension, mutation) => {
    const validState = buildFamily(['terminal_verified'], ['candidate_retained'], null, candidate, noActions)[0];
    const mutatedState = { ...validState, ...mutation } as PublicState;

    expect(presentationRunPublicSchema.safeParse(runForState(mutatedState)).success).toBe(false);
  });
});

describe('managed presentation recovery contract', () => {
  const CONVERSATION_ID = '2be7b8fc-6af5-42b8-aed5-03644735c730';
  const OTHER_CONVERSATION_ID = 'd9b6195d-bab0-4662-b88c-1675772bb24d';
  const cursorPayloadSchema = z
    .object({
      version: z.literal(1),
      conversationId: presentationConversationIdSchema,
      updatedAt: z.string().datetime(),
      runId: z.string().uuid(),
    })
    .strict();
  const cursorTokenSegmentsSchema = z.tuple([
    z.string().regex(/^[A-Za-z0-9_-]+$/),
    z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  ]);
  const items = [
    {
      conversationId: CONVERSATION_ID,
      runId: '00000000-0000-4000-8000-000000000001',
      updatedAt: '2026-08-04T00:00:02.000Z',
    },
    {
      conversationId: CONVERSATION_ID,
      runId: '00000000-0000-4000-8000-000000000002',
      updatedAt: '2026-08-04T00:00:02.000Z',
    },
    {
      conversationId: CONVERSATION_ID,
      runId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      updatedAt: '2026-08-04T00:00:01.000Z',
    },
  ];

  const sortRecoverable = (values: typeof items): typeof items =>
    values.toSorted(
      (left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.runId.localeCompare(left.runId)
    );

  const signCursorPayload = (payload: string): string =>
    createHmac('sha256', RECOVERY_CURSOR_TEST_SECRET).update(payload, 'utf8').digest('base64url');

  const mintCursor = (item: (typeof items)[number], extra: Record<string, unknown> = {}): string => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        conversationId: item.conversationId,
        updatedAt: item.updatedAt,
        runId: item.runId,
        ...extra,
      })
    ).toString('base64url');
    return `${payload}.${signCursorPayload(payload)}`;
  };

  const resolveCursor = (
    cursor: string,
    conversationId: string,
    knownItems: typeof items
  ): { ok: true; tuple: { updatedAt: string; runId: string } } | { ok: false; code: 'INVALID_REQUEST' } => {
    try {
      const segments = cursorTokenSegmentsSchema.safeParse(cursor.split('.'));
      if (!segments.success) return { ok: false, code: 'INVALID_REQUEST' };
      const [payload, signature] = segments.data;
      const payloadBytes = Buffer.from(payload, 'base64url');
      const signatureBytes = Buffer.from(signature, 'base64url');
      const expectedSignatureBytes = Buffer.from(signCursorPayload(payload), 'base64url');
      if (
        payloadBytes.toString('base64url') !== payload ||
        signatureBytes.toString('base64url') !== signature ||
        signatureBytes.length !== expectedSignatureBytes.length ||
        !timingSafeEqual(signatureBytes, expectedSignatureBytes)
      ) {
        return { ok: false, code: 'INVALID_REQUEST' };
      }
      const parsed = cursorPayloadSchema.safeParse(JSON.parse(payloadBytes.toString('utf8')));
      if (!parsed.success || parsed.data.conversationId !== conversationId) {
        return { ok: false, code: 'INVALID_REQUEST' };
      }
      const resolvable = knownItems.some(
        (item) =>
          item.conversationId === conversationId &&
          item.updatedAt === parsed.data.updatedAt &&
          item.runId === parsed.data.runId
      );
      return resolvable
        ? { ok: true, tuple: { updatedAt: parsed.data.updatedAt, runId: parsed.data.runId } }
        : { ok: false, code: 'INVALID_REQUEST' };
    } catch {
      return { ok: false, code: 'INVALID_REQUEST' };
    }
  };

  it('orders recovery by updatedAt DESC and then runId DESC', () => {
    const orderedRunIds = sortRecoverable(items).map((item) => item.runId);

    expect(orderedRunIds).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ]);
    expect(orderedRunIds).not.toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ]);
  });

  it('defaults the limit to 20 and accepts the exact 1 and 20 boundaries', () => {
    expect(recoverablePresentationRunsRequestSchema.parse({ conversation_id: 'D0921953' })).toMatchObject({
      conversation_id: 'd0921953',
    });
    expect(recoverablePresentationRunsRequestSchema.parse({ conversation_id: CONVERSATION_ID }).limit).toBe(20);
    expect(
      recoverablePresentationRunsRequestSchema.safeParse({ conversation_id: CONVERSATION_ID, limit: 1 }).success
    ).toBe(true);
    expect(
      recoverablePresentationRunsRequestSchema.safeParse({ conversation_id: CONVERSATION_ID, limit: 20 }).success
    ).toBe(true);
  });

  it('rejects limit 0, limit 21, non-integers, and unknown request fields independently', () => {
    expect(
      recoverablePresentationRunsRequestSchema.safeParse({ conversation_id: CONVERSATION_ID, limit: 0 }).success
    ).toBe(false);
    expect(
      recoverablePresentationRunsRequestSchema.safeParse({ conversation_id: CONVERSATION_ID, limit: 21 }).success
    ).toBe(false);
    expect(
      recoverablePresentationRunsRequestSchema.safeParse({ conversation_id: CONVERSATION_ID, limit: 1.5 }).success
    ).toBe(false);
    expect(
      recoverablePresentationRunsRequestSchema.safeParse({
        conversation_id: CONVERSATION_ID,
        limit: 1,
        workspacePath: '/tmp',
      }).success
    ).toBe(false);
  });

  it('treats a valid cursor as opaque input and resolves only its exact final sort tuple', () => {
    const cursor = mintCursor(items[1]);
    const request = recoverablePresentationRunsRequestSchema.parse({ conversation_id: CONVERSATION_ID, cursor });

    expect(request.cursor).toBe(cursor);
    expect(cursor.split('.')).toHaveLength(2);
    expect(cursor).not.toContain(CONVERSATION_ID);
    expect(resolveCursor(cursor, CONVERSATION_ID, items)).toEqual({
      ok: true,
      tuple: { updatedAt: items[1].updatedAt, runId: items[1].runId },
    });
  });

  it('rejects a cursor whose tuple belongs to a different conversation', () => {
    const foreignItem = {
      conversationId: OTHER_CONVERSATION_ID,
      runId: '00000000-0000-4000-8000-000000000003',
      updatedAt: '2026-08-04T00:00:02.000Z',
    };
    const cursor = mintCursor(foreignItem, { conversationId: CONVERSATION_ID });

    expect(resolveCursor(cursor, CONVERSATION_ID, [...items, foreignItem])).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  it('rejects a structurally valid client-created cursor without a main signature', () => {
    const unsignedCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        conversationId: CONVERSATION_ID,
        updatedAt: items[0].updatedAt,
        runId: items[0].runId,
      })
    ).toString('base64url');

    expect(resolveCursor(unsignedCursor, CONVERSATION_ID, items)).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  it('rejects a well-shaped client-created cursor with a forged main signature', () => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        conversationId: CONVERSATION_ID,
        updatedAt: items[0].updatedAt,
        runId: items[0].runId,
      })
    ).toString('base64url');
    const forgedCursor = `${payload}.${'A'.repeat(43)}`;

    expect(resolveCursor(forgedCursor, CONVERSATION_ID, items)).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  });

  it('rejects malformed recovery token shapes and signatures', () => {
    const [payload, signature] = mintCursor(items[0]).split('.');
    const invalid = { ok: false, code: 'INVALID_REQUEST' };

    expect(
      [`${payload}.${signature}.extra`, `${payload}.short`, `${payload}.${'*'.repeat(43)}`, `.${signature}`].map(
        (cursor) => resolveCursor(cursor, CONVERSATION_ID, items)
      )
    ).toEqual([invalid, invalid, invalid, invalid]);
  });

  it('rejects authenticated cursor payload and signature tampering', () => {
    const [payload, signature] = mintCursor(items[0]).split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        version: 1,
        conversationId: CONVERSATION_ID,
        updatedAt: items[1].updatedAt,
        runId: items[1].runId,
      })
    ).toString('base64url');
    const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    const invalid = { ok: false, code: 'INVALID_REQUEST' };

    expect([
      resolveCursor(`${tamperedPayload}.${signature}`, CONVERSATION_ID, items),
      resolveCursor(`${payload}.${tamperedSignature}`, CONVERSATION_ID, items),
    ]).toEqual([invalid, invalid]);
  });

  it('maps malformed, cross-conversation, stale, and unknown-field cursors to INVALID_REQUEST', () => {
    const staleItem = {
      conversationId: CONVERSATION_ID,
      runId: '00000000-0000-4000-8000-000000000099',
      updatedAt: '2026-08-04T00:00:03.000Z',
    };
    const invalid = { ok: false, code: 'INVALID_REQUEST' };

    expect(resolveCursor('not-base64-json', CONVERSATION_ID, items)).toEqual(invalid);
    expect(resolveCursor(mintCursor(items[0]), OTHER_CONVERSATION_ID, items)).toEqual(invalid);
    expect(resolveCursor(mintCursor(staleItem), CONVERSATION_ID, items)).toEqual(invalid);
    expect(resolveCursor(mintCursor(items[0], { workspacePath: '/tmp' }), CONVERSATION_ID, items)).toEqual(invalid);
  });
});

describe('managed presentation fixed resource policy', () => {
  const MiB = 1_024 * 1_024;
  const GiB = 1_024 * MiB;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it('keeps the legacy and side-effect-free policy exports identical', () => {
    expect(PRESENTATION_RUN_LIMITS).toBe(LEGACY_PRESENTATION_RUN_LIMITS);
  });

  it('evaluates the pure policy module without reading environment-backed configuration', () => {
    const script = `
      const [{ readFile }, { stripTypeScriptTypes }, { SourceTextModule, createContext }] = await Promise.all([
        import('node:fs/promises'),
        import('node:module'),
        import('node:vm'),
      ]);
      const source = await readFile(${JSON.stringify(presentationRunLimitsFile)}, 'utf8');
      const guardedProcess = {};
      Object.defineProperty(guardedProcess, 'env', {
        get() { throw new Error('pure policy evaluated process.env'); },
      });
      const module = new SourceTextModule(stripTypeScriptTypes(source, { mode: 'strip' }), {
        context: createContext({ process: guardedProcess }),
        identifier: 'presentationRunPolicy.ts',
      });
      await module.link((specifier) => {
        throw new Error('pure policy imported dependency: ' + specifier);
      });
      await module.evaluate();
      if (!Object.hasOwn(module.namespace, 'PRESENTATION_RUN_LIMITS')) {
        throw new Error('pure policy export is missing');
      }
    `;
    const result = spawnSync(
      process.execPath,
      ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '--eval', script],
      { encoding: 'utf8' }
    );

    expect({ signal: result.signal, status: result.status, stderr: result.stderr }).toEqual({
      signal: null,
      status: 0,
      stderr: '',
    });
  });

  it('keeps source, grant, extraction, and template limits fixed', () => {
    expect(PRESENTATION_RUN_LIMITS).toMatchObject({
      MAX_SOURCES_PER_RUN: 16,
      MAX_SOURCE_BYTES: 64 * MiB,
      MAX_TOTAL_SOURCE_BYTES: 256 * MiB,
      GRANT_TTL_MS: 15 * minute,
      QUEUED_GRANT_TTL_MS: 24 * hour,
      GRANT_SWEEP_INTERVAL_MS: 5 * minute,
      MAX_UNBOUND_GRANTS_PER_OWNER: 16,
      MAX_UNBOUND_GRANTS_PER_APP: 64,
      MAX_LIVE_GUID_DRAFTS_PER_APP: 16,
      MAX_UNBOUND_GRANT_BYTES_PER_OWNER: 256 * MiB,
      MAX_UNBOUND_GRANT_BYTES_PER_APP: 512 * MiB,
      MAX_EXTRACTED_CHARS_PER_SOURCE: 200_000,
      MAX_EXTRACTED_CHARS_TOTAL: 1_000_000,
      MAX_PDF_PAGES: 50,
      MAX_EXTRACTION_ATTEMPTS: 2,
      EXTRACTION_ATTEMPT_TIMEOUT_MS: 30_000,
      MAX_OFFICECLI_STDOUT_BYTES: 8 * MiB,
      MAX_THEME_BYTES: 1 * MiB,
      MAX_REFERENCE_BYTES: 64 * MiB,
      MAX_TEMPLATE_REFERENCE_BYTES: 128 * MiB,
    });
  });

  it('keeps candidate, OOXML, plan, and render limits fixed', () => {
    expect(PRESENTATION_RUN_LIMITS).toMatchObject({
      MAX_CANDIDATE_COMPRESSED_BYTES: 256 * MiB,
      MAX_NON_RENDER_COPY_WRITE_BYTES_PER_RUN: 1 * GiB,
      MAX_PLAN_JSON_BYTES: 1 * MiB,
      MAX_SOURCE_REFS_PER_SLIDE: 16,
      MAX_ZIP_ENTRIES: 4_096,
      MAX_ZIP_ENTRY_BYTES: 32 * MiB,
      MAX_ZIP_EXPANDED_BYTES: 512 * MiB,
      MAX_XML_BYTES: 16 * MiB,
      MAX_XML_NESTING_DEPTH: 64,
      MAX_SLIDES: 100,
      MAX_SHAPES_PER_SLIDE: 512,
      MAX_TEXT_CHARS_PER_SLIDE: 100_000,
      MAX_TEXT_CHARS_TOTAL: 2_000_000,
      MAX_RENDER_BYTES_PER_SLIDE: 25 * MiB,
      MAX_RENDER_BYTES_TOTAL: 500 * MiB,
      RENDER_TIMEOUT_MS: 90_000,
    });
  });

  it('keeps run, queue, recovery, retention, and disk limits fixed', () => {
    expect(PRESENTATION_RUN_LIMITS).toMatchObject({
      ACTIVE_GENERATION_TTL_MS: 30 * minute,
      MAX_LIVE_RUNS_PER_CONVERSATION: 1,
      MAX_LIVE_RUNS_PER_APP: 2,
      MAX_PREDISPATCH_INTENTS_PER_APP: 8,
      MAX_EXTRACTION_CONCURRENCY: 2,
      MAX_RENDER_CONCURRENCY: 1,
      RECOVERABLE_LIST_MIN_LIMIT: 1,
      RECOVERABLE_LIST_DEFAULT_LIMIT: 20,
      RECOVERABLE_LIST_MAX_LIMIT: 20,
      MAX_RETAINED_RUNS_PER_CONVERSATION: 10,
      MAX_RETAINED_RUNS_PER_APP: 100,
      MAX_RETAINED_BYTES_PER_CONVERSATION: 640 * MiB,
      MAX_RETAINED_BYTES_PER_APP: 3 * GiB,
      TRANSIENT_DISK_RESERVATION_BYTES_PER_RUN: 2 * GiB,
      MIN_FREE_BYTES_BEFORE_START: 3 * GiB,
      MIN_UNRESERVED_BYTES_AFTER_RESERVATIONS: 1 * GiB,
      ALLOCATING_TTL_MS: 10 * minute,
      COMMITTED_TTL_MS: 24 * hour,
      FAILED_OR_REVIEW_RETENTION_MS: 7 * day,
      UNCERTAIN_OPERATOR_ALERT_MS: 30 * day,
      TOMBSTONE_RETENTION_MS: 7 * day,
      OWNED_DIRECTORY_MODE: 0o700,
      OWNED_FILE_MODE: 0o600,
    });
  });

  it('keeps rate, lease, and terminal-event limits fixed', () => {
    expect(PRESENTATION_RUN_LIMITS).toMatchObject({
      START_RATE_WINDOW_MS: minute,
      MAX_STARTS_PER_CONVERSATION_PER_WINDOW: 2,
      STARTS_PER_CONVERSATION_BURST: 1,
      MAX_STARTS_PER_APP_PER_WINDOW: 6,
      STARTS_PER_APP_BURST: 2,
      INITIAL_CLAIM_LEASE_MS: 30_000,
      INITIAL_CLAIM_RENEWAL_MS: 10_000,
      MAX_WEBSOCKET_INBOUND_FRAME_BYTES: 256 * 1_024,
      WEBSOCKET_EVENT_RATE_WINDOW_MS: minute,
      MAX_WEBSOCKET_EVENTS_PER_WINDOW: 120,
      WEBSOCKET_EVENT_BURST: 20,
      MAX_TERMINAL_BEFORE_BIND_PENDING: 32,
      TERMINAL_BEFORE_BIND_TTL_MS: 120_000,
      MAX_RECONNECT_MESSAGE_BUFFER: 0,
      WEBSOCKET_DIAGNOSTIC_INTERVAL_MS: minute,
    });
  });

  it('enumerates only artifact phases declared by the foundation contract', () => {
    expect(PRESENTATION_RUN_ARTIFACT_PHASES).toHaveLength(8);
  });
});
