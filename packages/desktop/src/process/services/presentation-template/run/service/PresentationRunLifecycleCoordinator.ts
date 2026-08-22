/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PresentationReadinessServiceRequest,
  PresentationReadinessServiceResult,
} from '@/process/services/office-artifact/service/PresentationReadinessService';
import type {
  ClaimInitialPresentationDispatchRequest,
  ClaimInitialPresentationDispatchResult,
  DispatchInitialPresentationRunRequest,
  DispatchInitialPresentationRunResult,
  PresentationRunFailure,
  RenewInitialPresentationDispatchRequest,
  RenewInitialPresentationDispatchResult,
} from '@/common/types/office/presentationRun';
import type { PresentationReadinessEvidence } from '@/common/types/office/artifactReadiness';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type { DeferredPresentationInspectionWorkspace, PresentationRunFiles } from '../storage/presentationRunFiles';
import {
  PresentationRunStoreError,
  type PresentationRunStore,
  type StoredPresentationRunManifest,
} from '../storage/presentationRunStore';
import {
  hasExactPresentationTerminalEvidence,
  type PresentationRuntimeReleaseObservation,
} from '../storage/presentationRunStateMachine';
import type {
  PresentationRuntimeEventClient,
  PresentationRuntimeObservation,
  PresentationRuntimeTerminalEvent,
  PresentationTerminalEventAuthority,
} from './PresentationRuntimeEventClient';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNTIME_RELEASE_RECHECK_MS = 30_000;

const isSamePresentationConversation = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizePresentationConversationId(left);
  return normalizedLeft !== null && normalizedLeft === normalizePresentationConversationId(right);
};

const canonicalPresentationConversationId = (value: string): string =>
  normalizePresentationConversationId(value) ?? value;

export type PresentationBackendCredentials = { port: number; token: string };

export type PresentationRunDispatchPreflightResult =
  | { ok: true }
  | { ok: false; kind: 'transient'; retryAfterMs: number }
  | { ok: false; kind: 'hard' };

type PreparedPresentationRun = {
  runId: string;
  rawInput: string;
  directive: string;
  sourceRefs: readonly { grantId: string }[];
  injectSkills: ['officecli'];
  files: [string, string];
  planPath: string;
};

type DispatchAcknowledgement = {
  msg_id: string;
  turn_id: string;
  runtime: PresentationRuntimeObservation;
};

type LifecycleEventClient = Pick<PresentationRuntimeEventClient, 'connect' | 'disconnect' | 'consumePending'>;

export type PresentationRunLifecycleCoordinatorOptions = {
  store: Pick<
    PresentationRunStore,
    | 'getRun'
    | 'getRunByTurn'
    | 'listDispatchReconciliation'
    | 'listTerminalReconciliation'
    | 'listSettledInspectionCleanup'
    | 'claimInitialDispatch'
    | 'renewInitialDispatch'
    | 'matchesInitialDispatchLease'
    | 'beginInitialDispatch'
    | 'settleDispatchUncertain'
    | 'settleCommittedPreflightFailure'
    | 'bindRunTurn'
    | 'recordTerminalProof'
    | 'recordRuntimeReleaseObservation'
    | 'retainCandidate'
    | 'settleTerminalFailure'
    | 'settleReadinessSuccess'
    | 'settleReadinessFailure'
  >;
  files: Pick<
    PresentationRunFiles,
    | 'readAuthorizedPlan'
    | 'createDeferredInspectionWorkspace'
    | 'cleanupSettledInspectionWorkspaces'
    | 'withAuthorizedRetainedCandidate'
  >;
  eventClient: LifecycleEventClient;
  getPreparedRun: (runId: string) => Promise<PreparedPresentationRun>;
  preflightDispatch: (
    credentials: PresentationBackendCredentials,
    conversationId: string,
    runtime: 'aionrs' | 'acp'
  ) => Promise<PresentationRunDispatchPreflightResult>;
  postInitialMessage: (
    credentials: PresentationBackendCredentials,
    request: {
      conversationId: string;
      content: string;
      files: [string, string];
      injectSkills: ['officecli'];
    }
  ) => Promise<unknown>;
  observeRuntime: (
    credentials: PresentationBackendCredentials,
    conversationId: string,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>;
  inspectReadiness: (
    request: PresentationReadinessServiceRequest,
    workspace: DeferredPresentationInspectionWorkspace
  ) => Promise<PresentationReadinessServiceResult>;
  isFeatureEnabled: () => boolean;
  now?: () => Date;
};

type LifecycleCoordinatorLike = {
  backendReady(credentials: PresentationBackendCredentials): Promise<void>;
  dispose(): Promise<void> | void;
};

export function createPresentationRuntimeLifecycleOwner(options: {
  createCoordinator: () => LifecycleCoordinatorLike;
}): {
  backendReady(credentials: PresentationBackendCredentials): Promise<void>;
  dispose(): Promise<void>;
} {
  let coordinator: LifecycleCoordinatorLike | null = null;
  let operationTail = Promise.resolve();

  const serialize = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };

  return {
    backendReady: (credentials) =>
      serialize(async () => {
        coordinator ??= options.createCoordinator();
        await coordinator.backendReady(credentials);
      }),
    dispose: () =>
      serialize(async () => {
        const current = coordinator;
        coordinator = null;
        if (current !== null) await current.dispose();
      }),
  };
}

function failure<Result extends PresentationRunFailure>(
  code: PresentationRunFailure['code'],
  state: PresentationRunFailure['state'],
  details: PresentationRunFailure['details'] = null,
  retryable = false
): Result {
  return {
    ok: false,
    code,
    messageKey: `conversation.presentationRun.${code}`,
    retryable,
    state,
    details,
  } as Result;
}

async function leaseFailure<Result extends PresentationRunFailure>(
  error: unknown,
  runId: string,
  conversationId: string,
  store: Pick<PresentationRunStore, 'getRun'>
): Promise<Result> {
  if (error instanceof PresentationRunStoreError) {
    let current: StoredPresentationRunManifest | null;
    try {
      current = await store.getRun(runId);
    } catch {
      return failure('PERSISTENCE_FAILED', 'committed', { postInvoked: false }) as Result;
    }
    if (current === null || !isSamePresentationConversation(current.conversationId, conversationId)) {
      return failure('RUN_NOT_FOUND', 'lookup') as Result;
    }
    if (error.code === 'LEASE_CONFLICT') {
      const expiresAt = current.initialDispatchLease?.expiresAt;
      if (expiresAt === undefined) {
        return failure('PERSISTENCE_FAILED', 'committed', { postInvoked: false }) as Result;
      }
      return failure('LEASE_CONFLICT', 'committed', { runId, leaseExpiresAt: expiresAt }) as Result;
    }
    if (error.code === 'LEASE_EXPIRED') {
      return failure('LEASE_EXPIRED', 'committed', { runId, reclaimAllowed: true }) as Result;
    }
    if (error.code === 'LEASE_FOREIGN') return failure('LEASE_FOREIGN', 'committed', { runId }) as Result;
    if (error.code === 'RUN_STATE_CONFLICT') {
      return failure('RUN_STATE_CONFLICT', 'lookup', {
        runId,
        dispatchStatus: current.dispatchStatus,
      }) as Result;
    }
  }
  return failure<Result>('PERSISTENCE_FAILED', 'committed', { postInvoked: false });
}

function claimFailure(
  code: PresentationRunFailure['code'],
  state: PresentationRunFailure['state'],
  details: PresentationRunFailure['details'] = null,
  retryable = false
): ClaimInitialPresentationDispatchResult {
  return failure(code, state, details, retryable) as ClaimInitialPresentationDispatchResult;
}

function renewFailure(
  code: PresentationRunFailure['code'],
  state: PresentationRunFailure['state'],
  details: PresentationRunFailure['details'] = null,
  retryable = false
): RenewInitialPresentationDispatchResult {
  return failure(code, state, details, retryable) as RenewInitialPresentationDispatchResult;
}

function dispatchFailure(
  code: PresentationRunFailure['code'],
  state: PresentationRunFailure['state'],
  details: PresentationRunFailure['details'] = null,
  retryable = false
): DispatchInitialPresentationRunResult {
  return failure(code, state, details, retryable) as DispatchInitialPresentationRunResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function runSequentially<T>(values: readonly T[], operation: (value: T) => Promise<void>): Promise<void> {
  return values.reduce<Promise<void>>((sequence, value) => sequence.then(() => operation(value)), Promise.resolve());
}

function parseRuntimeObservation(value: unknown): PresentationRuntimeObservation | null {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    'state',
    'can_send_message',
    'has_task',
    'is_processing',
    'pending_confirmations',
    'turn_id',
    ...('task_status' in value ? ['task_status'] : []),
  ].toSorted();
  const actualKeys = Object.keys(value).toSorted();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    typeof value.state !== 'string' ||
    typeof value.can_send_message !== 'boolean' ||
    typeof value.has_task !== 'boolean' ||
    typeof value.is_processing !== 'boolean' ||
    !Number.isSafeInteger(value.pending_confirmations) ||
    (value.turn_id !== null && (typeof value.turn_id !== 'string' || !UUID_RE.test(value.turn_id))) ||
    ('task_status' in value && typeof value.task_status !== 'string')
  ) {
    return null;
  }
  return {
    state: value.state,
    can_send_message: value.can_send_message,
    has_task: value.has_task,
    ...('task_status' in value ? { task_status: value.task_status as string } : {}),
    is_processing: value.is_processing,
    pending_confirmations: value.pending_confirmations as number,
    turn_id: value.turn_id as string | null,
  };
}

function parseAcknowledgement(value: unknown): DispatchAcknowledgement | null {
  if (!isRecord(value) || Object.keys(value).toSorted().join(',') !== 'msg_id,runtime,turn_id') return null;
  const runtime = parseRuntimeObservation(value.runtime);
  if (
    typeof value.msg_id !== 'string' ||
    !UUID_RE.test(value.msg_id) ||
    typeof value.turn_id !== 'string' ||
    !UUID_RE.test(value.turn_id) ||
    runtime === null ||
    runtime.turn_id !== value.turn_id
  ) {
    return null;
  }
  return { msg_id: value.msg_id, turn_id: value.turn_id, runtime };
}

function releasedRuntime(value: unknown): PresentationRuntimeReleaseObservation | null {
  const runtime = parseRuntimeObservation(value);
  if (
    runtime === null ||
    runtime.state !== 'idle' ||
    runtime.can_send_message !== true ||
    runtime.has_task !== false ||
    runtime.is_processing !== false ||
    runtime.pending_confirmations !== 0 ||
    runtime.turn_id !== null ||
    (runtime.task_status !== undefined && runtime.task_status !== 'finished')
  ) {
    return null;
  }
  return {
    state: 'idle',
    can_send_message: true,
    has_task: false,
    ...(runtime.task_status === 'finished' ? { task_status: 'finished' as const } : {}),
    is_processing: false,
    pending_confirmations: 0,
    turn_id: null,
  };
}

function boundResult(
  run: StoredPresentationRunManifest,
  status: 'bound' | 'already_bound'
): DispatchInitialPresentationRunResult {
  return {
    ok: true,
    status,
    runId: run.runId,
    conversationId: canonicalPresentationConversationId(run.conversationId),
    revision: run.revision,
    dispatchStatus: 'bound',
  };
}

const BINDING_PRESERVING_STATUSES = new Set<StoredPresentationRunManifest['dispatchStatus']>([
  'bound',
  'terminal_verified',
  'retained',
  'failed_retained',
]);

function hasExactPreservedBinding(
  run: StoredPresentationRunManifest | null,
  conversationId: string,
  runtime: 'aionrs' | 'acp',
  turnId?: string
): boolean {
  return (
    run !== null &&
    BINDING_PRESERVING_STATUSES.has(run.dispatchStatus) &&
    isSamePresentationConversation(run.binding?.conversationId, conversationId) &&
    run.binding.runtime === runtime &&
    (turnId === undefined || run.binding.turnId === turnId)
  );
}

function matchesAcknowledgedBinding(
  run: StoredPresentationRunManifest | null,
  conversationId: string,
  acknowledgement: DispatchAcknowledgement | null,
  runtime: 'aionrs' | 'acp'
): boolean {
  return acknowledgement !== null && hasExactPreservedBinding(run, conversationId, runtime, acknowledgement.turn_id);
}

function hasExactEventTerminalProof(
  run: StoredPresentationRunManifest,
  event: PresentationRuntimeTerminalEvent
): boolean {
  return (
    hasExactPresentationTerminalEvidence(run) &&
    isSamePresentationConversation(run.terminalEvidence?.conversationId, event.conversationId) &&
    run.terminalEvidence.turnId === event.turnId
  );
}

export class PresentationRunLifecycleCoordinator {
  private readonly options: PresentationRunLifecycleCoordinatorOptions;
  private credentials: PresentationBackendCredentials | null = null;
  private disposed = false;
  private readonly releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: PresentationRunLifecycleCoordinatorOptions) {
    this.options = options;
  }

  async claimInitialDispatch(
    request: ClaimInitialPresentationDispatchRequest
  ): Promise<ClaimInitialPresentationDispatchResult> {
    if (!this.options.isFeatureEnabled()) return claimFailure('FEATURE_DISABLED', 'preflight');
    try {
      const result = await this.options.store.claimInitialDispatch({
        runId: request.run_id,
        conversationId: request.conversation_id,
        holderId: request.holder_id,
        expectedRevision: request.expected_revision,
      });
      const lease = result.manifest.initialDispatchLease;
      if (lease === undefined || lease === null) {
        return claimFailure('PERSISTENCE_FAILED', 'committed', { postInvoked: false });
      }
      return {
        ok: true,
        status: result.status,
        runId: result.manifest.runId,
        leaseToken: result.leaseToken,
        revision: result.manifest.revision,
        expiresAt: lease.expiresAt,
        renewAfterMs: 10_000,
      };
    } catch (error) {
      return (await leaseFailure(
        error,
        request.run_id,
        request.conversation_id,
        this.options.store
      )) as ClaimInitialPresentationDispatchResult;
    }
  }

  async renewInitialDispatch(
    request: RenewInitialPresentationDispatchRequest
  ): Promise<RenewInitialPresentationDispatchResult> {
    if (!this.options.isFeatureEnabled()) return renewFailure('FEATURE_DISABLED', 'preflight');
    try {
      const result = await this.options.store.renewInitialDispatch({
        runId: request.run_id,
        conversationId: request.conversation_id,
        leaseToken: request.lease_token,
        expectedRevision: request.expected_revision,
      });
      const lease = result.manifest.initialDispatchLease;
      if (lease === undefined || lease === null) {
        return renewFailure('PERSISTENCE_FAILED', 'committed', { postInvoked: false });
      }
      return {
        ok: true,
        status: 'renewed',
        runId: result.manifest.runId,
        revision: result.manifest.revision,
        expiresAt: lease.expiresAt,
        renewAfterMs: 10_000,
      };
    } catch (error) {
      return (await leaseFailure(
        error,
        request.run_id,
        request.conversation_id,
        this.options.store
      )) as RenewInitialPresentationDispatchResult;
    }
  }

  async dispatch(
    request: DispatchInitialPresentationRunRequest,
    runtime: 'aionrs' | 'acp'
  ): Promise<DispatchInitialPresentationRunResult> {
    if (!this.options.isFeatureEnabled()) return dispatchFailure('FEATURE_DISABLED', 'preflight');
    let current: StoredPresentationRunManifest | null;
    try {
      current = await this.options.store.getRun(request.run_id);
    } catch {
      return dispatchFailure('PERSISTENCE_FAILED', 'committed', { postInvoked: false });
    }
    if (current === null || !isSamePresentationConversation(current.conversationId, request.conversation_id)) {
      return dispatchFailure('RUN_NOT_FOUND', 'lookup');
    }
    const leaseInput = {
      runId: request.run_id,
      conversationId: request.conversation_id,
      leaseToken: request.lease_token,
      expectedRevision: request.expected_revision,
    };
    let matchesLease: boolean;
    try {
      matchesLease = await this.options.store.matchesInitialDispatchLease(leaseInput);
    } catch (error) {
      return (await leaseFailure(
        error,
        request.run_id,
        request.conversation_id,
        this.options.store
      )) as DispatchInitialPresentationRunResult;
    }
    if (!matchesLease) return dispatchFailure('LEASE_FOREIGN', 'committed', { runId: request.run_id });
    if (current.binding !== null && BINDING_PRESERVING_STATUSES.has(current.dispatchStatus)) {
      if (hasExactPreservedBinding(current, request.conversation_id, runtime)) {
        return boundResult(current, 'already_bound');
      }
      return dispatchFailure('RUN_STATE_CONFLICT', 'lookup', {
        runId: request.run_id,
        dispatchStatus: current.dispatchStatus,
      });
    }
    if (current.dispatchStatus !== 'committed' || current.revision !== request.expected_revision) {
      return dispatchFailure('RUN_STATE_CONFLICT', 'lookup', {
        runId: request.run_id,
        dispatchStatus: current.dispatchStatus,
      });
    }
    const credentials = this.credentials;
    if (credentials === null) {
      return dispatchFailure(
        'BACKEND_PREFLIGHT_BLOCKED',
        'committed',
        { runId: request.run_id, retryAfterMs: 1_000, postInvoked: false },
        true
      );
    }

    let preflight: PresentationRunDispatchPreflightResult;
    try {
      preflight = await this.options.preflightDispatch(credentials, request.conversation_id, runtime);
    } catch {
      preflight = { ok: false, kind: 'transient', retryAfterMs: 1_000 };
    }
    if (preflight.ok === false) {
      if (preflight.kind === 'transient') {
        return dispatchFailure(
          'BACKEND_PREFLIGHT_BLOCKED',
          'committed',
          { runId: request.run_id, retryAfterMs: preflight.retryAfterMs, postInvoked: false },
          true
        );
      }
      try {
        await this.options.store.settleCommittedPreflightFailure(current.runId, current.revision);
      } catch {
        return dispatchFailure('PERSISTENCE_FAILED', 'committed', { postInvoked: false });
      }
      return dispatchFailure('INTERNAL_ERROR', 'preflight');
    }

    let prepared: PreparedPresentationRun;
    try {
      prepared = await this.options.getPreparedRun(request.run_id);
    } catch {
      try {
        await this.options.store.settleCommittedPreflightFailure(current.runId, current.revision);
      } catch {
        return dispatchFailure('PERSISTENCE_FAILED', 'committed', { postInvoked: false });
      }
      return dispatchFailure('INTERNAL_ERROR', 'preflight');
    }

    let dispatching: StoredPresentationRunManifest;
    try {
      dispatching = await this.options.store.beginInitialDispatch(leaseInput);
    } catch (error) {
      return (await leaseFailure(
        error,
        request.run_id,
        request.conversation_id,
        this.options.store
      )) as DispatchInitialPresentationRunResult;
    }

    let acknowledgement: DispatchAcknowledgement | null = null;
    try {
      acknowledgement = parseAcknowledgement(
        await this.options.postInitialMessage(credentials, {
          conversationId: request.conversation_id,
          content: `${prepared.directive}\n\n${prepared.rawInput}`,
          files: prepared.files,
          injectSkills: prepared.injectSkills,
        })
      );
      if (acknowledgement === null) throw new Error('Invalid acknowledgement');
      let binding;
      try {
        binding = await this.options.store.bindRunTurn(request.run_id, {
          expectedRevision: dispatching.revision,
          conversationId: request.conversation_id,
          turnId: acknowledgement.turn_id,
          runtime,
          now: this.now().toISOString(),
        });
      } catch {
        const reconciled = await this.options.store.getRun(request.run_id).catch((): null => null);
        if (
          reconciled !== null &&
          matchesAcknowledgedBinding(reconciled, request.conversation_id, acknowledgement, runtime)
        ) {
          return boundResult(reconciled, 'bound');
        }
        throw new Error('Binding persistence ambiguity');
      }
      await this.options.eventClient.consumePending(request.conversation_id, acknowledgement.turn_id);
      return boundResult(binding.manifest, binding.status);
    } catch {
      const observed = await this.options.store.getRun(request.run_id).catch((): null => null);
      if (
        observed !== null &&
        matchesAcknowledgedBinding(observed, request.conversation_id, acknowledgement, runtime)
      ) {
        return boundResult(observed, 'bound');
      }
      const revision = observed?.dispatchStatus === 'dispatching' ? observed.revision : dispatching.revision;
      await this.options.store.settleDispatchUncertain(request.run_id, revision).catch((): undefined => undefined);
      return dispatchFailure('DISPATCH_UNCERTAIN', 'dispatch_uncertain', {
        runId: request.run_id,
        postInvoked: true,
        queryRequired: true,
      });
    }
  }

  async backendReady(credentials: PresentationBackendCredentials): Promise<void> {
    if (this.disposed) this.disposed = false;
    const featureEnabledAtRotation = this.options.isFeatureEnabled();
    if (featureEnabledAtRotation) {
      this.options.eventClient.connect(credentials);
    } else {
      this.options.eventClient.disconnect();
    }
    this.credentials = { ...credentials };
    let dispatchRuns: StoredPresentationRunManifest[];
    let terminalRuns: StoredPresentationRunManifest[];
    let settledInspectionRunIds: string[];
    try {
      [dispatchRuns, terminalRuns, settledInspectionRunIds] = await Promise.all([
        this.options.store.listDispatchReconciliation(),
        this.options.store.listTerminalReconciliation(),
        this.options.store.listSettledInspectionCleanup(),
      ]);
    } catch (error) {
      if (!featureEnabledAtRotation) this.options.eventClient.connect(credentials);
      throw error;
    }
    const socketRequired = this.options.isFeatureEnabled() || dispatchRuns.length > 0;
    if (!featureEnabledAtRotation && socketRequired) this.options.eventClient.connect(credentials);
    await runSequentially(dispatchRuns, async (run): Promise<void> => {
      if (run.dispatchStatus === 'dispatching') {
        await this.options.store.settleDispatchUncertain(run.runId, run.revision).catch((): undefined => undefined);
      } else if (run.dispatchStatus === 'bound' || run.dispatchStatus === 'dispatch_uncertain') {
        await this.observeRestartedBoundRun(run);
      }
    });
    await runSequentially(terminalRuns, async (run): Promise<void> => {
      await this.completeVerifiedRun(run).catch((): undefined => undefined);
    });
    await runSequentially(settledInspectionRunIds, async (runId): Promise<void> => {
      await this.options.files.cleanupSettledInspectionWorkspaces(runId).catch((): undefined => undefined);
    });
    if (!this.options.isFeatureEnabled() && socketRequired) {
      const remainingDispatchRuns = await this.options.store
        .listDispatchReconciliation()
        .catch((): StoredPresentationRunManifest[] => dispatchRuns);
      if (remainingDispatchRuns.length === 0) this.options.eventClient.disconnect();
    }
  }

  async handleTerminalEvent(
    event: PresentationRuntimeTerminalEvent,
    authority: PresentationTerminalEventAuthority
  ): Promise<'handled' | 'pending' | 'forged'> {
    if (!authority.isCurrent()) return 'pending';
    let run: StoredPresentationRunManifest | null;
    try {
      run = await this.options.store.getRunByTurn(event.conversationId, event.turnId);
    } catch {
      return 'pending';
    }
    if (!authority.isCurrent()) return 'pending';
    if (run === null) {
      let dispatching: StoredPresentationRunManifest[];
      try {
        dispatching = await this.options.store.listDispatchReconciliation();
      } catch {
        return 'pending';
      }
      if (!authority.isCurrent()) return 'pending';
      run =
        dispatching.find(
          (candidate) =>
            candidate.dispatchStatus === 'bound' &&
            isSamePresentationConversation(candidate.binding?.conversationId, event.conversationId) &&
            candidate.binding.turnId === event.turnId
        ) ?? null;
      if (run === null) {
        return dispatching.some(
          (candidate) =>
            isSamePresentationConversation(candidate.conversationId, event.conversationId) &&
            candidate.dispatchStatus === 'dispatching'
        )
          ? 'pending'
          : 'forged';
      }
    }
    if (hasExactEventTerminalProof(run, event)) {
      if (!authority.isCurrent()) return 'pending';
      await this.completeVerifiedRun(run).catch((): undefined => undefined);
      await this.disconnectFalseFlagSocketIfDrained();
      return 'handled';
    }
    if (
      run.dispatchStatus !== 'bound' ||
      !isSamePresentationConversation(run.binding?.conversationId, event.conversationId) ||
      run.binding.turnId !== event.turnId
    ) {
      return 'forged';
    }
    if (!authority.isCurrent()) return 'pending';
    const credentials = this.credentials;
    if (credentials === null) return 'pending';
    const runtime = releasedRuntime(
      await this.options
        .observeRuntime(credentials, event.conversationId, { signal: authority.signal })
        .catch((): null => null)
    );
    if (runtime === null || !authority.isCurrent()) return 'pending';
    const runtimeObservedAt = this.now().toISOString();
    if (!authority.isCurrent()) return 'pending';
    try {
      run = await this.options.store.recordTerminalProof(run.runId, run.revision, {
        conversationId: event.conversationId,
        turnId: event.turnId,
        eventObservedAt: event.observedAt,
        runtimeObservedAt,
        runtime,
      });
    } catch {
      if (!authority.isCurrent()) return 'pending';
      const persisted = await this.options.store.getRun(run.runId).catch((): null => null);
      if (!authority.isCurrent() || persisted === null || !hasExactEventTerminalProof(persisted, event)) {
        return 'pending';
      }
      run = persisted;
    }
    if (!authority.isCurrent()) return 'pending';
    await this.completeVerifiedRun(run).catch((): undefined => undefined);
    await this.disconnectFalseFlagSocketIfDrained();
    return 'handled';
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.credentials = null;
    for (const timer of this.releaseTimers.values()) clearTimeout(timer);
    this.releaseTimers.clear();
    this.options.eventClient.disconnect();
  }

  private async observeRestartedBoundRun(run: StoredPresentationRunManifest): Promise<void> {
    const credentials = this.credentials;
    if (credentials === null) return;
    const runtime = releasedRuntime(
      await this.options
        .observeRuntime(credentials, canonicalPresentationConversationId(run.conversationId))
        .catch((): null => null)
    );
    if (runtime === null) return;
    const first = await this.options.store
      .recordRuntimeReleaseObservation(run.runId, run.revision, this.now().toISOString())
      .catch((): null => null);
    if (first === null || first.status === 'tracking_required') return;
    const existing = this.releaseTimers.get(run.runId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.releaseTimers.delete(run.runId);
      void this.confirmRestartedBoundRun(first.manifest);
    }, RUNTIME_RELEASE_RECHECK_MS);
    this.releaseTimers.set(run.runId, timer);
  }

  private async confirmRestartedBoundRun(run: StoredPresentationRunManifest): Promise<void> {
    const credentials = this.credentials;
    if (credentials === null) return;
    const runtime = releasedRuntime(
      await this.options
        .observeRuntime(credentials, canonicalPresentationConversationId(run.conversationId))
        .catch((): null => null)
    );
    if (runtime === null) return;
    const result = await this.options.store
      .recordRuntimeReleaseObservation(run.runId, run.revision, this.now().toISOString())
      .catch((): null => null);
    if (result?.status === 'tracking_required') await this.disconnectFalseFlagSocketIfDrained();
  }

  private async completeVerifiedRun(run: StoredPresentationRunManifest): Promise<void> {
    let retained = run;
    if (!hasExactPresentationTerminalEvidence(retained)) {
      await this.options.store.settleTerminalFailure(retained.runId, retained.revision, 'TERMINAL_PROOF_MISSING');
      return;
    }
    if (retained.artifactPhase === 'sources_extracted') {
      try {
        retained = await this.options.store.retainCandidate(retained.runId, retained.revision);
      } catch {
        const canonical = await this.options.store.getRun(retained.runId).catch((): null => null);
        if (
          canonical?.dispatchStatus === 'terminal_verified' &&
          canonical.artifactPhase === 'candidate_retained' &&
          canonical.retainedCandidate !== null
        ) {
          retained = canonical;
        } else if (canonical?.dispatchStatus === 'retained' || canonical?.dispatchStatus === 'failed_retained') {
          return;
        } else {
          const unsettled = canonical?.dispatchStatus === 'terminal_verified' ? canonical : retained;
          await this.options.store.settleTerminalFailure(unsettled.runId, unsettled.revision, 'RETENTION_FAILED');
          return;
        }
      }
    }
    if (
      retained.dispatchStatus !== 'terminal_verified' ||
      retained.artifactPhase !== 'candidate_retained' ||
      retained.retainedCandidate === null ||
      retained.retentionProof === undefined ||
      retained.retentionProof === null
    ) {
      return;
    }
    if (!this.options.isFeatureEnabled()) return;
    let planBytes: Buffer;
    try {
      planBytes = await this.options.files.readAuthorizedPlan(retained.runId);
    } catch {
      await this.settleInspectionFailure(retained);
      await this.options.files.cleanupSettledInspectionWorkspaces(retained.runId).catch((): undefined => undefined);
      return;
    }
    let workspace: DeferredPresentationInspectionWorkspace;
    try {
      workspace = await this.options.files.createDeferredInspectionWorkspace(retained.runId);
    } catch {
      await this.settleInspectionFailure(retained);
      await this.options.files.cleanupSettledInspectionWorkspaces(retained.runId).catch((): undefined => undefined);
      return;
    }
    let result: PresentationReadinessServiceResult;
    let inspectionStarted = false;
    try {
      const inspected = await this.options.files.withAuthorizedRetainedCandidate(
        retained.runId,
        retained.retainedCandidate,
        (candidate) => {
          inspectionStarted = true;
          return this.options.inspectReadiness(
            {
              runId: retained.runId,
              candidate,
              expectedCandidate: {
                sha256: retained.retainedCandidate!.sha256,
                byteLength: retained.retainedCandidate!.byteLength,
              },
              retentionProof: retained.retentionProof!,
              planBytes,
              knownSourceRefs: [...retained.sourceGrants],
            },
            workspace
          );
        }
      );
      if (inspected === null) throw new Error('Retained candidate unavailable');
      result = inspected;
    } catch {
      await this.settleInspectionFailure(retained);
      if (!inspectionStarted) await workspace.dispose();
      await this.cleanupInspectionWorkspace(retained.runId, workspace);
      return;
    }
    if (result.ok === true) {
      await this.persistReadinessSuccess(retained, result.evidence);
    } else {
      await this.options.store.settleReadinessFailure(retained.runId, retained.revision, {
        status: 'blocked',
        recordedAt: this.now().toISOString(),
        blockers: result.blockers,
      });
    }
    await this.cleanupInspectionWorkspace(retained.runId, workspace);
  }

  private async persistReadinessSuccess(
    retained: StoredPresentationRunManifest,
    evidence: PresentationReadinessEvidence
  ): Promise<void> {
    await this.options.store.settleReadinessSuccess(retained.runId, retained.revision, evidence);
  }

  private async settleInspectionFailure(retained: StoredPresentationRunManifest): Promise<void> {
    await this.options.store.settleReadinessFailure(retained.runId, retained.revision, {
      status: 'error',
      recordedAt: this.now().toISOString(),
      code: 'INSPECTION_FAILED',
    });
  }

  private async cleanupInspectionWorkspace(
    runId: string,
    workspace: DeferredPresentationInspectionWorkspace
  ): Promise<void> {
    await workspace.cleanupAfterSettlement();
    await this.options.files.cleanupSettledInspectionWorkspaces(runId);
  }

  private async disconnectFalseFlagSocketIfDrained(): Promise<void> {
    if (this.options.isFeatureEnabled()) return;
    let dispatchRuns: StoredPresentationRunManifest[];
    try {
      dispatchRuns = await this.options.store.listDispatchReconciliation();
    } catch {
      return;
    }
    if (dispatchRuns.length === 0) this.options.eventClient.disconnect();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
