/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PresentationReadinessEvidence } from '@/common/types/office/artifactReadiness';
import type {
  ClaimInitialPresentationDispatchRequest,
  DispatchInitialPresentationRunRequest,
  RenewInitialPresentationDispatchRequest,
} from '@/common/types/office/presentationRun';
import {
  PresentationRunLifecycleCoordinator,
  type PresentationRunDispatchPreflightResult,
} from '@/process/services/presentation-template/run/service/PresentationRunLifecycleCoordinator';
import type {
  PresentationRuntimeTerminalEvent,
  PresentationTerminalEventAuthority,
} from '@/process/services/presentation-template/run/service/PresentationRuntimeEventClient';
import {
  PresentationRunFiles,
  PresentationRunJournal,
  PresentationRunStore,
  PresentationRunStoreError,
  type StoredPresentationRunManifest,
} from '@/process/services/presentation-template/run/storage';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_UPPER_CONVERSATION_ID = 'A2222222-B222-4222-8222-C22222222222';
const LEGACY_CONVERSATION_ID = LEGACY_UPPER_CONVERSATION_ID.toLowerCase();
const TURN_ID = '33333333-3333-4333-8333-333333333333';
const HOLDER_ID = '44444444-4444-4444-8444-444444444444';
const LEASE_TOKEN = 'opaque_lease_token_abcdefghijklmnopqrstuvwxyz123456';
const NOW = '2026-08-05T00:00:00.000Z';
const CANDIDATE_HASH = 'a'.repeat(64);

const releasedRuntime = {
  state: 'idle',
  can_send_message: true,
  has_task: false,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
} as const;

const terminalEvent = (
  overrides: Partial<PresentationRuntimeTerminalEvent> = {}
): PresentationRuntimeTerminalEvent => ({
  conversationId: CONVERSATION_ID,
  turnId: TURN_ID,
  status: 'finished',
  runtime: releasedRuntime,
  observedAt: NOW,
  ...overrides,
});

const terminalAuthority = (
  controller = new AbortController(),
  deadlineAt = Number.MAX_SAFE_INTEGER
): PresentationTerminalEventAuthority => ({
  signal: controller.signal,
  deadlineAt,
  isCurrent: () => !controller.signal.aborted,
});

const lifecycleFields = {
  initialDispatchLease: {
    holderId: HOLDER_ID,
    leaseToken: LEASE_TOKEN,
    claimedAt: NOW,
    expiresAt: '2026-08-05T00:00:30.000Z',
  },
  terminalEvidence: null,
  runtimeReleaseObservations: [],
  retentionProof: null,
  readiness: null,
};

function run(
  dispatchStatus: StoredPresentationRunManifest['dispatchStatus'],
  overrides: Partial<StoredPresentationRunManifest> = {}
): StoredPresentationRunManifest {
  return {
    version: 2,
    runId: RUN_ID,
    clientRequestId: RUN_ID,
    conversationId: CONVERSATION_ID,
    selectedTemplateId: 'business-review',
    requestFingerprint: 'b'.repeat(64),
    postAllocationFailure: null,
    revision: dispatchStatus === 'committed' ? 3 : dispatchStatus === 'dispatching' ? 4 : 5,
    createdAt: NOW,
    updatedAt: NOW,
    statusEnteredAt: NOW,
    committedAt: NOW,
    retainedAt: dispatchStatus === 'retained' || dispatchStatus === 'failed_retained' ? NOW : null,
    dispatchStatus,
    artifactPhase: 'sources_extracted',
    disposition: dispatchStatus === 'dispatch_uncertain' ? 'TRACKING_REQUIRED' : null,
    retainedCandidate: null,
    sourceGrants: [],
    binding:
      dispatchStatus === 'bound' || dispatchStatus === 'terminal_verified'
        ? { conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: 'aionrs', boundAt: NOW }
        : null,
    postInvoked: dispatchStatus !== 'committed',
    retainedBytes: 0,
    preparation: null,
    ...lifecycleFields,
    ...overrides,
  } as StoredPresentationRunManifest;
}

const claimRequest = (): ClaimInitialPresentationDispatchRequest => ({
  conversation_id: CONVERSATION_ID,
  run_id: RUN_ID,
  holder_id: HOLDER_ID,
  expected_revision: 2,
});

const renewRequest = (): RenewInitialPresentationDispatchRequest => ({
  conversation_id: CONVERSATION_ID,
  run_id: RUN_ID,
  lease_token: LEASE_TOKEN,
  expected_revision: 3,
});

const dispatchRequest = (): DispatchInitialPresentationRunRequest => ({
  conversation_id: CONVERSATION_ID,
  run_id: RUN_ID,
  lease_token: LEASE_TOKEN,
  expected_revision: 3,
});

const evidence = (): PresentationReadinessEvidence => ({
  version: 1,
  candidate: { sha256: CANDIDATE_HASH, byteLength: 4 },
  plan: { sha256: 'c'.repeat(64), byteLength: 2 },
  hashChain: {
    stagingBeforeRetain: CANDIDATE_HASH,
    retainedTemp: CANDIDATE_HASH,
    stagingAfterRetain: CANDIDATE_HASH,
    manifestRetained: CANDIDATE_HASH,
    inspectionCopy: CANDIDATE_HASH,
    retainedAfterStructuralValidation: CANDIDATE_HASH,
    retainedAfterOoxmlInspection: CANDIDATE_HASH,
    retainedAfterEachSlideRender: [CANDIDATE_HASH],
  },
  structure: { officeCliValidated: true },
  ooxml: {
    zipEntryCount: 1,
    expandedByteLength: 4,
    xmlByteLength: 1,
    slideCount: 1,
    totalTextChars: 4,
    slides: [
      {
        slideNumber: 1,
        shapeCount: 1,
        textCharCount: 4,
        textOnlyShapeCount: 0,
        notesTextCharCount: 1,
        visualAnchorKinds: ['chart'],
      },
    ],
  },
  policy: {
    version: 1,
    plan: { valid: true, slideCount: 1, sourceRefCount: 0 },
    slides: [
      {
        slideNumber: 1,
        role: 'content',
        sourceRefs: [],
        requiresNotes: true,
        requiresVisualAnchor: true,
      },
    ],
    blockers: [],
  },
  renders: [{ slideNumber: 1, candidateSha256: CANDIDATE_HASH, sha256: 'd'.repeat(64), byteLength: 8 }],
});

function createHarness(
  options: {
    preflight?: PresentationRunDispatchPreflightResult;
    post?: () => Promise<unknown>;
    observeRuntime?: (signal?: AbortSignal) => Promise<unknown>;
    inspect?: () => Promise<unknown>;
  } = {}
) {
  let current = run('committed');
  const order: string[] = [];
  const store = {
    getRun: vi.fn(async () => current),
    getRunByTurn: vi.fn(async () => (current.binding?.turnId === TURN_ID ? current : null)),
    listDispatchReconciliation: vi.fn(async () => []),
    listTerminalReconciliation: vi.fn(async () => []),
    listSettledInspectionCleanup: vi.fn(async () => []),
    claimInitialDispatch: vi.fn(async () => {
      current = run('committed', { revision: 3 });
      return { status: 'claimed' as const, manifest: current, leaseToken: LEASE_TOKEN };
    }),
    renewInitialDispatch: vi.fn(async () => {
      current = run('committed', { revision: 4 });
      return { status: 'renewed' as const, manifest: current };
    }),
    matchesInitialDispatchLease: vi.fn(async () => true),
    beginInitialDispatch: vi.fn(async () => {
      order.push('dispatching-durable');
      current = run('dispatching');
      return current;
    }),
    settleDispatchUncertain: vi.fn(async () => {
      order.push('uncertain-durable');
      current = run('dispatch_uncertain', { revision: current.revision + 1 });
      return current;
    }),
    settleCommittedPreflightFailure: vi.fn(async () => {
      current = run('failed_retained', {
        revision: current.revision + 1,
        disposition: 'TRACKING_REQUIRED',
        retainedAt: NOW,
      });
      return current;
    }),
    bindRunTurn: vi.fn(async () => {
      order.push('binding-durable');
      current = run('bound');
      return { status: 'bound' as const, manifest: current };
    }),
    recordTerminalProof: vi.fn(
      async (
        _runId: string,
        _revision: number,
        terminalEvidence: NonNullable<StoredPresentationRunManifest['terminalEvidence']>
      ) => {
        order.push('terminal-durable');
        current = run('terminal_verified', {
          revision: current.revision + 1,
          conversationId: current.conversationId,
          sourceGrants: current.sourceGrants,
          binding: current.binding,
          terminalEvidence,
        } as Partial<StoredPresentationRunManifest>);
        return current;
      }
    ),
    recordRuntimeReleaseObservation: vi.fn(async () => ({ status: 'observed' as const, manifest: current })),
    retainCandidate: vi.fn(async () => {
      order.push('retention-durable');
      current = run('terminal_verified', {
        revision: current.revision + 1,
        sourceGrants: current.sourceGrants,
        artifactPhase: 'candidate_retained',
        retainedCandidate: { relativePath: 'retained/candidate.pptx', sha256: CANDIDATE_HASH, byteLength: 4 },
        retentionProof: {
          stagingBeforeRetain: CANDIDATE_HASH,
          retainedTemp: CANDIDATE_HASH,
          stagingAfterRetain: CANDIDATE_HASH,
        },
        terminalEvidence: current.terminalEvidence,
      } as Partial<StoredPresentationRunManifest>);
      return current;
    }),
    settleReadinessSuccess: vi.fn(async () => {
      order.push('evidence-durable');
      current = run('retained', {
        artifactPhase: 'rendered_exact_hash',
        disposition: 'REVIEW_REQUIRED',
        retainedAt: NOW,
      });
      return current;
    }),
    settleReadinessFailure: vi.fn(async () => {
      order.push('failure-durable');
      current = run('failed_retained', {
        artifactPhase: current.retainedCandidate === null ? 'sources_extracted' : 'candidate_retained',
        disposition: current.retainedCandidate === null ? 'TRACKING_REQUIRED' : 'REVIEW_REQUIRED',
        retainedAt: NOW,
      });
      return current;
    }),
    settleTerminalFailure: vi.fn(async (_runId, _revision, code: string) => {
      order.push(`terminal-failure-durable:${code}`);
      current = run('failed_retained', {
        revision: current.revision + 1,
        artifactPhase: current.retainedCandidate === null ? 'sources_extracted' : 'candidate_retained',
        disposition: current.retainedCandidate === null ? 'TRACKING_REQUIRED' : 'REVIEW_REQUIRED',
        retainedAt: NOW,
        readiness: { status: 'error', recordedAt: NOW, code },
      });
      return current;
    }),
  };
  const deferredWorkspace = {
    directory: '/private/tmp/inspection/run/inspection',
    dispose: vi.fn(async () => order.push('dispose-deferred')),
    cleanupAfterSettlement: vi.fn(async () => order.push('cleanup-physical')),
  };
  const files = {
    readAuthorizedPlan: vi.fn(async () => Buffer.from('[]')),
    createDeferredInspectionWorkspace: vi.fn(async () => deferredWorkspace),
    cleanupSettledInspectionWorkspaces: vi.fn(async () => undefined),
    withAuthorizedRetainedCandidate: vi.fn(async (_runId, candidate, operation) => {
      if (candidate === null) return null;
      return operation({ byteLength: candidate.byteLength, readAt: async () => Buffer.from('pptx') });
    }),
  };
  const eventClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    consumePending: vi.fn(async () => 'missing' as const),
  };
  const preflightDispatch = vi.fn(async () => options.preflight ?? ({ ok: true } as const));
  const postInitialMessage = vi.fn(async () => {
    order.push('post-invoked');
    return options.post
      ? options.post()
      : {
          msg_id: RUN_ID,
          turn_id: TURN_ID,
          runtime: { ...releasedRuntime, state: 'running', has_task: true, turn_id: TURN_ID },
        };
  });
  const observeRuntime = vi.fn(async (_credentials, _conversationId, observation?: { signal?: AbortSignal }) =>
    options.observeRuntime === undefined ? releasedRuntime : options.observeRuntime(observation?.signal)
  );
  const inspectReadiness = vi.fn(async () => {
    order.push('inspection');
    if (options.inspect) return options.inspect();
    await deferredWorkspace.dispose();
    return { ok: true as const, evidence: evidence() };
  });
  const getPreparedRun = vi.fn(async () => ({
    runId: RUN_ID,
    rawInput: 'Build a board deck',
    directive: 'Create a presentation from the request below. Managed rules.',
    sourceRefs: [],
    injectSkills: ['officecli'] as ['officecli'],
    files: ['/private/grounding.md', '/private/candidate.pptx'] as [string, string],
    planPath: '/private/plan.json',
  }));
  let featureEnabled = true;
  const coordinator = new PresentationRunLifecycleCoordinator({
    store,
    files,
    eventClient,
    getPreparedRun,
    preflightDispatch,
    postInitialMessage,
    observeRuntime,
    inspectReadiness,
    isFeatureEnabled: () => featureEnabled,
    now: () => new Date(NOW),
  });
  return {
    coordinator,
    deferredWorkspace,
    eventClient,
    files,
    getPreparedRun,
    get current() {
      return current;
    },
    inspectReadiness,
    observeRuntime,
    order,
    postInitialMessage,
    preflightDispatch,
    setCurrent(value: StoredPresentationRunManifest) {
      current = value;
    },
    setFeatureEnabled(value: boolean) {
      featureEnabled = value;
    },
    store,
  };
}

function exactLegacyNullableRun(dispatchStatus: 'bound' | 'terminal_verified'): StoredPresentationRunManifest {
  const current = run(dispatchStatus, {
    revision: 0,
    binding: { conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: null, boundAt: NOW },
  });
  const {
    preparation: _preparation,
    initialDispatchLease: _initialDispatchLease,
    terminalEvidence: _terminalEvidence,
    runtimeReleaseObservations: _runtimeReleaseObservations,
    retentionProof: _retentionProof,
    readiness: _readiness,
    ...legacy
  } = current;
  return legacy;
}

function createRealStoreCoordinator(store: PresentationRunStore, files: PresentationRunFiles, now: () => Date) {
  const eventClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    consumePending: vi.fn(async () => 'missing' as const),
  };
  const observeRuntime = vi.fn(async () => releasedRuntime);
  const inspectReadiness = vi.fn(async () => ({ ok: true as const, evidence: evidence() }));
  const coordinator = new PresentationRunLifecycleCoordinator({
    store,
    files,
    eventClient,
    getPreparedRun: async () => ({
      runId: RUN_ID,
      rawInput: 'Build a board deck',
      directive: 'Create a presentation from the request below. Managed rules.',
      sourceRefs: [],
      injectSkills: ['officecli'],
      files: ['/private/grounding.md', '/private/candidate.pptx'],
      planPath: '/private/plan.json',
    }),
    preflightDispatch: async () => ({ ok: true }),
    postInitialMessage: async () => ({}),
    observeRuntime,
    inspectReadiness,
    isFeatureEnabled: () => false,
    now,
  });
  return { coordinator, eventClient, inspectReadiness, observeRuntime };
}

describe('PresentationRunLifecycleCoordinator', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('persists claim and renewal leases through revision/CAS store methods', async () => {
    const harness = createHarness();

    await expect(harness.coordinator.claimInitialDispatch(claimRequest())).resolves.toMatchObject({
      ok: true,
      status: 'claimed',
      leaseToken: LEASE_TOKEN,
      revision: 3,
      renewAfterMs: 10_000,
    });
    await expect(harness.coordinator.renewInitialDispatch(renewRequest())).resolves.toMatchObject({
      ok: true,
      status: 'renewed',
      revision: 4,
      renewAfterMs: 10_000,
    });
    expect(harness.store.claimInitialDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 2, holderId: HOLDER_ID })
    );
    expect(harness.store.renewInitialDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 3, leaseToken: LEASE_TOKEN })
    );
  });

  it('persists 30-second opaque leases, supports same-holder remount, and reclaims only after expiry', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'presentation-lifecycle-lease-'));
    try {
      const files = new PresentationRunFiles({
        userDataDir: path.join(fixtureRoot, 'user-data'),
        tempDir: path.join(fixtureRoot, 'temp'),
      });
      await Promise.all([mkdir(path.join(fixtureRoot, 'user-data')), mkdir(path.join(fixtureRoot, 'temp'))]);
      const journal = new PresentationRunJournal({ files });
      let clock = new Date(NOW);
      const leaseTokens = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
      const store = new PresentationRunStore({
        files,
        journal,
        now: () => clock,
        randomUUID: () => leaseTokens.shift() ?? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        getFreeDiskBytes: async () => 8 * 1024 * 1024 * 1024,
      });
      await journal.transaction({
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: run('committed', { revision: 0, initialDispatchLease: null }),
          },
        ],
      });

      const claimed = await store.claimInitialDispatch({
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        holderId: HOLDER_ID,
        expectedRevision: 0,
      });
      expect(claimed).toMatchObject({
        status: 'claimed',
        leaseToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        manifest: { revision: 1, initialDispatchLease: { expiresAt: '2026-08-05T00:00:30.000Z' } },
      });
      await expect(
        store.claimInitialDispatch({
          runId: RUN_ID,
          conversationId: CONVERSATION_ID,
          holderId: HOLDER_ID,
          expectedRevision: 0,
        })
      ).resolves.toMatchObject({ status: 'already_claimed', manifest: { revision: 1 } });
      await expect(
        store.claimInitialDispatch({
          runId: RUN_ID,
          conversationId: CONVERSATION_ID,
          holderId: '55555555-5555-4555-8555-555555555555',
          expectedRevision: 1,
        })
      ).rejects.toMatchObject({ code: 'LEASE_CONFLICT' });

      clock = new Date('2026-08-05T00:00:10.000Z');
      await expect(
        store.renewInitialDispatch({
          runId: RUN_ID,
          conversationId: CONVERSATION_ID,
          leaseToken: claimed.leaseToken,
          expectedRevision: 1,
        })
      ).resolves.toMatchObject({
        status: 'renewed',
        manifest: { revision: 2, initialDispatchLease: { expiresAt: '2026-08-05T00:00:40.000Z' } },
      });

      clock = new Date('2026-08-05T00:00:40.000Z');
      await expect(
        store.renewInitialDispatch({
          runId: RUN_ID,
          conversationId: CONVERSATION_ID,
          leaseToken: claimed.leaseToken,
          expectedRevision: 2,
        })
      ).rejects.toMatchObject({ code: 'LEASE_EXPIRED' });
      await expect(
        store.claimInitialDispatch({
          runId: RUN_ID,
          conversationId: CONVERSATION_ID,
          holderId: '55555555-5555-4555-8555-555555555555',
          expectedRevision: 2,
        })
      ).resolves.toMatchObject({
        status: 'claimed',
        leaseToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        manifest: { revision: 3 },
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('returns exact lease and feature failure envelopes', async () => {
    const harness = createHarness();
    harness.store.claimInitialDispatch.mockRejectedValueOnce(new PresentationRunStoreError('LEASE_CONFLICT'));
    await expect(harness.coordinator.claimInitialDispatch(claimRequest())).resolves.toEqual({
      ok: false,
      code: 'LEASE_CONFLICT',
      messageKey: 'conversation.presentationRun.LEASE_CONFLICT',
      retryable: false,
      state: 'committed',
      details: { runId: RUN_ID, leaseExpiresAt: '2026-08-05T00:00:30.000Z' },
    });

    harness.setFeatureEnabled(false);
    await expect(harness.coordinator.renewInitialDispatch(renewRequest())).resolves.toEqual({
      ok: false,
      code: 'FEATURE_DISABLED',
      messageKey: 'conversation.presentationRun.FEATURE_DISABLED',
      retryable: false,
      state: 'preflight',
      details: null,
    });
  });

  it('persists dispatching before exactly one POST and bound only after exact durable binding', async () => {
    const harness = createHarness();
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: true,
      status: 'bound',
      dispatchStatus: 'bound',
    });

    expect(harness.postInitialMessage).toHaveBeenCalledTimes(1);
    expect(harness.order).toEqual(['dispatching-durable', 'post-invoked', 'binding-durable']);
    expect(harness.store.bindRunTurn).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: 'aionrs' })
    );
  });

  it('keeps transient preflight retryable without POST and durably fails hard preflight', async () => {
    const transient = createHarness({ preflight: { ok: false, kind: 'transient', retryAfterMs: 750 } });
    await transient.coordinator.backendReady({ port: 43123, token: 'secret' });
    await expect(transient.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: false,
      code: 'BACKEND_PREFLIGHT_BLOCKED',
      retryable: true,
      details: { runId: RUN_ID, retryAfterMs: 750, postInvoked: false },
    });
    expect(transient.store.beginInitialDispatch).not.toHaveBeenCalled();
    expect(transient.postInitialMessage).not.toHaveBeenCalled();

    const hard = createHarness({ preflight: { ok: false, kind: 'hard' } });
    await hard.coordinator.backendReady({ port: 43123, token: 'secret' });
    await expect(hard.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: false,
      code: 'INTERNAL_ERROR',
    });
    expect(hard.store.settleCommittedPreflightFailure).toHaveBeenCalledTimes(1);
    expect(hard.postInitialMessage).not.toHaveBeenCalled();
  });

  it('settles a failed local preparation preflight before dispatching and never invokes POST', async () => {
    const harness = createHarness();
    harness.getPreparedRun.mockRejectedValueOnce(new Error('prepared bytes changed'));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
      messageKey: 'conversation.presentationRun.INTERNAL_ERROR',
      retryable: false,
      state: 'preflight',
      details: null,
    });
    expect(harness.store.settleCommittedPreflightFailure).toHaveBeenCalledTimes(1);
    expect(harness.store.beginInitialDispatch).not.toHaveBeenCalled();
    expect(harness.postInitialMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['network', () => Promise.reject(new TypeError('network down'))],
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['abort', () => Promise.reject(new DOMException('aborted', 'AbortError'))],
    ['http 409 busy text', () => Promise.reject(Object.assign(new Error('busy, retry later'), { status: 409 }))],
    ['http 500', () => Promise.reject(Object.assign(new Error('server'), { status: 500 }))],
    ['malformed acknowledgement', () => Promise.resolve({ turn_id: TURN_ID })],
    [
      'conflicting acknowledgement runtime',
      () =>
        Promise.resolve({
          msg_id: RUN_ID,
          turn_id: TURN_ID,
          runtime: {
            ...releasedRuntime,
            state: 'running',
            has_task: true,
            turn_id: '99999999-9999-4999-8999-999999999999',
          },
        }),
    ],
  ])('settles every post-invocation %s error as uncertain without retry', async (_label, post) => {
    const harness = createHarness({ post });
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toEqual({
      ok: false,
      code: 'DISPATCH_UNCERTAIN',
      messageKey: 'conversation.presentationRun.DISPATCH_UNCERTAIN',
      retryable: false,
      state: 'dispatch_uncertain',
      details: { runId: RUN_ID, postInvoked: true, queryRequired: true },
    });
    expect(harness.postInitialMessage).toHaveBeenCalledTimes(1);
    expect(harness.store.settleDispatchUncertain).toHaveBeenCalledTimes(1);
  });

  it('reconciles an acknowledgement whose binding commit reply was lost without another POST', async () => {
    const harness = createHarness();
    harness.store.bindRunTurn.mockImplementationOnce(async () => {
      harness.setCurrent(run('bound'));
      throw new Error('commit reply lost');
    });
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: true,
      status: 'bound',
    });
    expect(harness.postInitialMessage).toHaveBeenCalledTimes(1);
    expect(harness.store.settleDispatchUncertain).not.toHaveBeenCalled();
  });

  it('settles uncertain when bind persistence exposes a conflicting durable tuple without reposting', async () => {
    const harness = createHarness();
    harness.store.bindRunTurn.mockImplementationOnce(async () => {
      harness.setCurrent(
        run('bound', {
          binding: {
            conversationId: CONVERSATION_ID,
            turnId: '99999999-9999-4999-8999-999999999999',
            runtime: 'aionrs',
            boundAt: NOW,
          },
        })
      );
      throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
    });
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: false,
      code: 'DISPATCH_UNCERTAIN',
      state: 'dispatch_uncertain',
    });
    expect(harness.postInitialMessage).toHaveBeenCalledTimes(1);
    expect(harness.store.settleDispatchUncertain).toHaveBeenCalledTimes(1);
  });

  it('returns already-bound after a lost IPC reply and rejects a conflicting internal tuple without reposting', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: true,
      status: 'already_bound',
    });
    expect(harness.postInitialMessage).not.toHaveBeenCalled();

    harness.store.matchesInitialDispatchLease.mockResolvedValueOnce(false);
    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: false,
      code: 'LEASE_FOREIGN',
    });
    expect(harness.postInitialMessage).not.toHaveBeenCalled();
  });

  it('accepts a canonical replay and terminal event for a legacy uppercase durable binding', async () => {
    const harness = createHarness();
    harness.setCurrent(
      run('bound', {
        conversationId: LEGACY_UPPER_CONVERSATION_ID,
        binding: {
          conversationId: LEGACY_UPPER_CONVERSATION_ID,
          turnId: TURN_ID,
          runtime: 'aionrs',
          boundAt: NOW,
        },
      })
    );
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(
      harness.coordinator.dispatch({ ...dispatchRequest(), conversation_id: LEGACY_CONVERSATION_ID }, 'aionrs')
    ).resolves.toMatchObject({
      ok: true,
      status: 'already_bound',
      conversationId: LEGACY_CONVERSATION_ID,
    });
    await expect(
      harness.coordinator.handleTerminalEvent(
        terminalEvent({ conversationId: LEGACY_CONVERSATION_ID }),
        terminalAuthority()
      )
    ).resolves.toBe('handled');

    expect(harness.observeRuntime).toHaveBeenCalledWith(expect.any(Object), LEGACY_CONVERSATION_ID, expect.any(Object));
    expect(harness.store.recordTerminalProof).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Number),
      expect.objectContaining({ conversationId: LEGACY_CONVERSATION_ID, turnId: TURN_ID })
    );
  });

  it('rejects an already-bound replay when current runtime authority conflicts', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'acp')).resolves.toMatchObject({
      ok: false,
      code: 'RUN_STATE_CONFLICT',
    });

    expect(harness.postInitialMessage).not.toHaveBeenCalled();
    expect(harness.store.settleDispatchUncertain).not.toHaveBeenCalled();
  });

  it('does not treat an exact-looking dispatch-uncertain binding as replay authority', async () => {
    const harness = createHarness();
    harness.setCurrent(
      run('dispatch_uncertain', {
        binding: { conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: 'aionrs', boundAt: NOW },
      })
    );
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
      ok: false,
      code: 'RUN_STATE_CONFLICT',
    });

    expect(harness.postInitialMessage).not.toHaveBeenCalled();
  });

  it.each(['terminal_verified', 'retained', 'failed_retained'] as const)(
    'accepts an exact lost-reply replay after the binding advances to %s',
    async (dispatchStatus) => {
      const harness = createHarness();
      harness.setCurrent(
        run(dispatchStatus, {
          binding: { conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: 'aionrs', boundAt: NOW },
          retainedAt: dispatchStatus === 'retained' || dispatchStatus === 'failed_retained' ? NOW : null,
          disposition:
            dispatchStatus === 'retained' || dispatchStatus === 'failed_retained' ? 'TRACKING_REQUIRED' : null,
        })
      );
      await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

      await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
        ok: true,
        status: 'already_bound',
      });

      expect(harness.postInitialMessage).not.toHaveBeenCalled();
    }
  );

  it.each(['terminal_verified', 'retained', 'failed_retained'] as const)(
    'accepts a lost bind reply when the exact binding concurrently advances to %s',
    async (dispatchStatus) => {
      const harness = createHarness();
      harness.store.bindRunTurn.mockImplementationOnce(async () => {
        harness.setCurrent(
          run(dispatchStatus, {
            binding: { conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: 'aionrs', boundAt: NOW },
            retainedAt: dispatchStatus === 'retained' || dispatchStatus === 'failed_retained' ? NOW : null,
            disposition:
              dispatchStatus === 'retained' || dispatchStatus === 'failed_retained' ? 'TRACKING_REQUIRED' : null,
          })
        );
        throw new Error('commit reply lost after main-owned advancement');
      });
      await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

      await expect(harness.coordinator.dispatch(dispatchRequest(), 'aionrs')).resolves.toMatchObject({
        ok: true,
        status: 'bound',
      });

      expect(harness.postInitialMessage).toHaveBeenCalledTimes(1);
      expect(harness.store.settleDispatchUncertain).not.toHaveBeenCalled();
    }
  );

  it('continues main-owned reconciliation if the flag flips after POST or binding', async () => {
    let releasePost!: (value: unknown) => void;
    const harness = createHarness({
      post: () => new Promise((resolve) => (releasePost = resolve)),
    });
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });
    const dispatch = harness.coordinator.dispatch(dispatchRequest(), 'aionrs');
    await vi.waitFor(() => expect(harness.postInitialMessage).toHaveBeenCalledTimes(1));
    harness.setFeatureEnabled(false);
    releasePost({
      msg_id: RUN_ID,
      turn_id: TURN_ID,
      runtime: { ...releasedRuntime, state: 'running', turn_id: TURN_ID },
    });

    await expect(dispatch).resolves.toMatchObject({ ok: true, status: 'bound' });
    await expect(harness.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority())).resolves.toBe(
      'handled'
    );
    expect(harness.store.recordTerminalProof).toHaveBeenCalledTimes(1);
    expect(harness.store.retainCandidate).toHaveBeenCalledTimes(1);
    expect(harness.files.readAuthorizedPlan).not.toHaveBeenCalled();
    expect(harness.files.createDeferredInspectionWorkspace).not.toHaveBeenCalled();
    expect(harness.inspectReadiness).not.toHaveBeenCalled();
  });

  it('requires both the exact durable tuple and an authoritative released runtime before terminal verification', async () => {
    const missingRuntime = createHarness({ observeRuntime: async () => null });
    missingRuntime.setCurrent(run('bound'));
    await missingRuntime.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(missingRuntime.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority())).resolves.toBe(
      'pending'
    );
    expect(missingRuntime.store.recordTerminalProof).not.toHaveBeenCalled();
    expect(missingRuntime.store.retainCandidate).not.toHaveBeenCalled();

    const transientRuntime = createHarness({ observeRuntime: async () => Promise.reject(new Error('temporary')) });
    transientRuntime.setCurrent(run('bound'));
    await transientRuntime.coordinator.backendReady({ port: 43123, token: 'secret' });
    await expect(transientRuntime.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority())).resolves.toBe(
      'pending'
    );
    expect(transientRuntime.store.recordTerminalProof).not.toHaveBeenCalled();

    const forged = createHarness();
    forged.setCurrent(run('bound'));
    forged.store.getRunByTurn.mockResolvedValueOnce(null);
    await forged.coordinator.backendReady({ port: 43123, token: 'secret' });
    await expect(
      forged.coordinator.handleTerminalEvent(
        terminalEvent({ turnId: '99999999-9999-4999-8999-999999999999' }),
        terminalAuthority()
      )
    ).resolves.toBe('forged');
    expect(forged.store.recordTerminalProof).not.toHaveBeenCalled();
  });

  it('keeps a terminal trigger pending when exact turn lookup is uncertain', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });
    harness.store.getRunByTurn.mockRejectedValueOnce(new Error('temporary turn-index read failure'));

    await expect(harness.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority())).resolves.toBe(
      'pending'
    );

    expect(harness.store.listDispatchReconciliation).toHaveBeenCalledTimes(1);
    expect(harness.store.recordTerminalProof).not.toHaveBeenCalled();
  });

  it('keeps a terminal trigger pending when reconciliation lookup is uncertain', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });
    harness.store.getRunByTurn.mockResolvedValueOnce(null);
    harness.store.listDispatchReconciliation.mockRejectedValueOnce(new Error('temporary reconciliation read failure'));

    await expect(harness.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority())).resolves.toBe(
      'pending'
    );

    expect(harness.store.recordTerminalProof).not.toHaveBeenCalled();
  });

  it('keeps a false-flag socket connected when the drain scan is uncertain', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });
    harness.setFeatureEnabled(false);
    harness.store.listDispatchReconciliation.mockRejectedValueOnce(new Error('temporary drain scan failure'));

    await expect(harness.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority())).resolves.toBe(
      'handled'
    );

    expect(harness.eventClient.disconnect).not.toHaveBeenCalled();
  });

  it('keeps an exact terminal trigger pending until terminal proof is durable', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    harness.store.recordTerminalProof.mockRejectedValueOnce(new PresentationRunStoreError('RUN_STATE_CONFLICT'));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(
      harness.coordinator.handleTerminalEvent(terminalEvent({ runtime: null }), terminalAuthority())
    ).resolves.toBe('pending');
    expect(harness.store.retainCandidate).not.toHaveBeenCalled();
    expect(harness.inspectReadiness).not.toHaveBeenCalled();
  });

  it('does not persist an observation that resolves after terminal authority is revoked', async () => {
    let releaseObservation!: (value: unknown) => void;
    let observedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const harness = createHarness({
      observeRuntime: async (signal) => {
        observedSignal = signal;
        return new Promise((resolve) => (releaseObservation = resolve));
      },
    });
    harness.setCurrent(run('bound'));
    await harness.coordinator.backendReady({ port: 43123, token: 'old-secret' });

    const handling = harness.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority(controller));
    await vi.waitFor(() => expect(harness.observeRuntime).toHaveBeenCalledTimes(1));
    controller.abort();
    releaseObservation(releasedRuntime);

    await expect(handling).resolves.toBe('pending');
    expect(observedSignal).toBe(controller.signal);
    expect(harness.store.recordTerminalProof).not.toHaveBeenCalled();
    expect(harness.store.retainCandidate).not.toHaveBeenCalled();
  });

  it('persists terminal proof, three-hash retention, exact readiness evidence, then cleans inspection bytes', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound', { sourceGrants: [HOLDER_ID] }));
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await expect(harness.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority())).resolves.toBe(
      'handled'
    );

    expect(harness.store.recordTerminalProof).toHaveBeenCalledTimes(1);
    expect(harness.store.retainCandidate).toHaveBeenCalledTimes(1);
    expect(harness.store.settleReadinessSuccess).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Number),
      expect.objectContaining({ candidate: { sha256: CANDIDATE_HASH, byteLength: 4 } })
    );
    expect(harness.inspectReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ knownSourceRefs: [HOLDER_ID] }),
      harness.deferredWorkspace
    );
    expect(harness.getPreparedRun).not.toHaveBeenCalled();
    expect(harness.order).toEqual([
      'terminal-durable',
      'retention-durable',
      'inspection',
      'dispose-deferred',
      'evidence-durable',
      'cleanup-physical',
    ]);
  });

  it('durably persists blockers and thrown inspection failure before physical cleanup', async () => {
    const blocked = createHarness({
      inspect: async () => {
        await blocked.deferredWorkspace.dispose();
        return { ok: false as const, blockers: [{ code: 'PLAN_INVALID' as const, slideNumber: null }] };
      },
    });
    blocked.setCurrent(run('bound'));
    await blocked.coordinator.backendReady({ port: 43123, token: 'secret' });
    await blocked.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority());
    expect(blocked.store.settleReadinessFailure).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Number),
      expect.objectContaining({ status: 'blocked' })
    );
    expect(blocked.order.indexOf('failure-durable')).toBeLessThan(blocked.order.indexOf('cleanup-physical'));

    const thrown = createHarness({
      inspect: async () => {
        await thrown.deferredWorkspace.dispose();
        throw new Error('officecli unavailable');
      },
    });
    thrown.setCurrent(run('bound'));
    await thrown.coordinator.backendReady({ port: 43123, token: 'secret' });
    await thrown.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority());
    expect(thrown.store.settleReadinessFailure).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Number),
      expect.objectContaining({ status: 'error' })
    );
    expect(thrown.order.indexOf('failure-durable')).toBeLessThan(thrown.order.indexOf('cleanup-physical'));
  });

  it('replays a terminal-before-bind tuple only after the exact acknowledgement is durable', async () => {
    const harness = createHarness();
    harness.eventClient.consumePending.mockResolvedValueOnce('handled');
    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    await harness.coordinator.dispatch(dispatchRequest(), 'aionrs');

    expect(harness.eventClient.consumePending).toHaveBeenCalledWith(CONVERSATION_ID, TURN_ID);
    expect(harness.order.indexOf('binding-durable')).toBeLessThan(
      harness.eventClient.consumePending.mock.invocationCallOrder[0]!
    );
  });

  it('marks a restarted bound run TRACKING_REQUIRED after two idle observations 30 seconds apart without inspection', async () => {
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    harness.store.listDispatchReconciliation.mockResolvedValue([harness.current]);
    harness.store.recordRuntimeReleaseObservation
      .mockResolvedValueOnce({ status: 'observed', manifest: harness.current })
      .mockResolvedValueOnce({
        status: 'tracking_required',
        manifest: run('retained', {
          disposition: 'TRACKING_REQUIRED',
          retainedAt: '2026-08-05T00:00:30.000Z',
        }),
      });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });
    expect(harness.store.recordRuntimeReleaseObservation).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    await vi.runAllTimersAsync();

    expect(harness.store.recordRuntimeReleaseObservation).toHaveBeenCalledTimes(2);
    expect(harness.inspectReadiness).not.toHaveBeenCalled();
    expect(harness.store.recordTerminalProof).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('observes a restarted legacy uppercase run through its canonical conversation id', async () => {
    const harness = createHarness();
    harness.setCurrent(
      run('bound', {
        conversationId: LEGACY_UPPER_CONVERSATION_ID,
        binding: {
          conversationId: LEGACY_UPPER_CONVERSATION_ID,
          turnId: TURN_ID,
          runtime: 'aionrs',
          boundAt: NOW,
        },
      })
    );
    harness.store.listDispatchReconciliation.mockResolvedValue([harness.current]);

    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    expect(harness.observeRuntime).toHaveBeenCalledWith(expect.any(Object), LEGACY_CONVERSATION_ID);
    await harness.coordinator.dispose();
  });

  it('durably settles a restarted exact legacy null-runtime binding after two real-store observations', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'presentation-lifecycle-legacy-bound-'));
    const coordinators: PresentationRunLifecycleCoordinator[] = [];
    try {
      const files = new PresentationRunFiles({
        userDataDir: path.join(fixtureRoot, 'user-data'),
        tempDir: path.join(fixtureRoot, 'temp'),
      });
      await Promise.all([mkdir(path.join(fixtureRoot, 'user-data')), mkdir(path.join(fixtureRoot, 'temp'))]);
      const journal = new PresentationRunJournal({ files });
      let clock = new Date(NOW);
      const store = new PresentationRunStore({
        files,
        journal,
        now: () => clock,
        getFreeDiskBytes: async () => 8 * 1024 * 1024 * 1024,
      });
      await journal.transaction({
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: exactLegacyNullableRun('bound'),
          },
          {
            entityKind: 'run',
            entityId: HOLDER_ID,
            expectedRevision: null,
            nextManifest: run('dispatch_uncertain', {
              runId: HOLDER_ID,
              clientRequestId: HOLDER_ID,
              revision: 0,
              initialDispatchLease: null,
            }),
          },
        ],
      });

      const first = createRealStoreCoordinator(store, files, () => clock);
      coordinators.push(first.coordinator);
      await first.coordinator.backendReady({ port: 43123, token: 'secret' });

      await expect(store.getRun(RUN_ID)).resolves.toMatchObject({
        dispatchStatus: 'dispatch_uncertain',
        disposition: 'TRACKING_REQUIRED',
        binding: null,
        runtimeReleaseObservations: [NOW],
      });
      await expect(store.listDispatchReconciliation()).resolves.toEqual([
        expect.objectContaining({ runId: RUN_ID, dispatchStatus: 'dispatch_uncertain' }),
      ]);
      await expect(store.getRun(HOLDER_ID)).resolves.toMatchObject({
        revision: 0,
        dispatchStatus: 'dispatch_uncertain',
        runtimeReleaseObservations: [],
      });
      expect(first.observeRuntime).toHaveBeenCalledTimes(1);
      expect(first.inspectReadiness).not.toHaveBeenCalled();
      await first.coordinator.dispose();

      clock = new Date('2026-08-05T00:00:31.000Z');
      const restartedStore = new PresentationRunStore({
        files,
        journal: new PresentationRunJournal({ files }),
        now: () => clock,
        getFreeDiskBytes: async () => 8 * 1024 * 1024 * 1024,
      });
      const restarted = createRealStoreCoordinator(restartedStore, files, () => clock);
      coordinators.push(restarted.coordinator);
      await restarted.coordinator.backendReady({ port: 43124, token: 'rotated-secret' });

      await expect(restartedStore.getRun(RUN_ID)).resolves.toMatchObject({
        dispatchStatus: 'retained',
        disposition: 'TRACKING_REQUIRED',
        binding: null,
        retainedAt: '2026-08-05T00:00:31.000Z',
        runtimeReleaseObservations: [NOW, '2026-08-05T00:00:31.000Z'],
      });
      await expect(restartedStore.listDispatchReconciliation()).resolves.toEqual([]);
      await expect(restartedStore.getRun(HOLDER_ID)).resolves.toMatchObject({
        revision: 0,
        dispatchStatus: 'dispatch_uncertain',
        runtimeReleaseObservations: [],
      });
      expect(restarted.observeRuntime).toHaveBeenCalledTimes(1);
      expect(restarted.inspectReadiness).not.toHaveBeenCalled();
    } finally {
      await Promise.all(coordinators.map((coordinator) => coordinator.dispose()));
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('settles persisted dispatching as uncertain on restart and never posts it again', async () => {
    const harness = createHarness();
    harness.setCurrent(run('dispatching'));
    harness.store.listDispatchReconciliation.mockResolvedValue([harness.current]);

    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    expect(harness.store.settleDispatchUncertain).toHaveBeenCalledTimes(1);
    expect(harness.postInitialMessage).not.toHaveBeenCalled();
  });

  it('connects the enabled event generation before scans so dispatch cannot race ahead of tracking', async () => {
    let releaseDispatchScan!: (runs: StoredPresentationRunManifest[]) => void;
    const harness = createHarness();
    harness.store.listDispatchReconciliation.mockImplementationOnce(
      () => new Promise((resolve) => (releaseDispatchScan = resolve))
    );

    const readiness = harness.coordinator.backendReady({ port: 43123, token: 'new-secret' });
    await Promise.resolve();
    const connectedBeforeScanResolved = harness.eventClient.connect.mock.calls.length;
    const dispatch = harness.coordinator.dispatch(dispatchRequest(), 'aionrs');
    releaseDispatchScan([]);

    await readiness;
    await expect(dispatch).resolves.toMatchObject({ ok: true, status: 'bound' });
    expect(connectedBeforeScanResolved).toBe(1);
    expect(harness.preflightDispatch).toHaveBeenCalledWith(
      { port: 43123, token: 'new-secret' },
      CONVERSATION_ID,
      'aionrs'
    );
  });

  it.each(['listDispatchReconciliation', 'listTerminalReconciliation', 'listSettledInspectionCleanup'] as const)(
    'keeps false-flag tracking connected when initial %s is uncertain',
    async (scan) => {
      const harness = createHarness();
      harness.setFeatureEnabled(false);
      harness.store[scan].mockRejectedValueOnce(new Error('temporary startup scan failure'));

      await expect(harness.coordinator.backendReady({ port: 43123, token: 'recovery-secret' })).rejects.toThrow(
        'temporary startup scan failure'
      );

      expect(harness.eventClient.disconnect).toHaveBeenCalledTimes(1);
      expect(harness.eventClient.connect).toHaveBeenCalledWith({ port: 43123, token: 'recovery-secret' });
      expect(harness.eventClient.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
        harness.store[scan].mock.invocationCallOrder[0]!
      );
    }
  );

  it('revokes an old terminal generation before publishing restart credentials', async () => {
    let releaseTurnLookup!: (run: StoredPresentationRunManifest) => void;
    const controller = new AbortController();
    const harness = createHarness();
    harness.setCurrent(run('bound'));
    await harness.coordinator.backendReady({ port: 43123, token: 'old-secret' });
    harness.store.getRunByTurn.mockImplementationOnce(() => new Promise((resolve) => (releaseTurnLookup = resolve)));
    harness.eventClient.connect.mockImplementationOnce(() => controller.abort());

    const handling = harness.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority(controller));
    await vi.waitFor(() => expect(harness.store.getRunByTurn).toHaveBeenCalledTimes(1));
    await harness.coordinator.backendReady({ port: 43124, token: 'new-secret' });
    releaseTurnLookup(harness.current);

    await expect(handling).resolves.toBe('pending');
    expect(harness.observeRuntime).not.toHaveBeenCalled();
    expect(harness.store.recordTerminalProof).not.toHaveBeenCalled();
  });

  it('disconnects a false-flag socket after persisted dispatch reconciliation drains', async () => {
    const harness = createHarness();
    harness.setFeatureEnabled(false);
    harness.setCurrent(run('dispatching'));
    harness.store.listDispatchReconciliation.mockResolvedValueOnce([harness.current]).mockResolvedValueOnce([]);

    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    expect(harness.eventClient.connect).toHaveBeenCalledTimes(1);
    expect(harness.store.settleDispatchUncertain).toHaveBeenCalledTimes(1);
    expect(harness.eventClient.disconnect).toHaveBeenCalledTimes(2);
  });

  it('does not open a false-flag socket or inspect terminal-only restart work', async () => {
    const harness = createHarness();
    harness.setFeatureEnabled(false);
    const terminal = run('terminal_verified', {
      terminalEvidence: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventObservedAt: NOW,
        runtimeObservedAt: NOW,
        runtime: releasedRuntime,
      },
    });
    harness.setCurrent(terminal);
    harness.store.listTerminalReconciliation.mockResolvedValue([terminal]);

    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    expect(harness.eventClient.connect).not.toHaveBeenCalled();
    expect(harness.eventClient.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.store.retainCandidate).toHaveBeenCalledTimes(1);
    expect(harness.files.readAuthorizedPlan).not.toHaveBeenCalled();
    expect(harness.files.createDeferredInspectionWorkspace).not.toHaveBeenCalled();
    expect(harness.inspectReadiness).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing', terminalEvidence: undefined, bindingRuntime: 'aionrs' as const },
    { label: 'null', terminalEvidence: null, bindingRuntime: 'aionrs' as const },
    { label: 'legacy missing proof and null binding runtime', terminalEvidence: undefined, bindingRuntime: null },
  ])(
    'routes a terminal_verified record with $label to tracking without retention',
    async ({ terminalEvidence, bindingRuntime }) => {
      const harness = createHarness();
      const terminal = run('terminal_verified', {
        terminalEvidence,
        binding: { conversationId: CONVERSATION_ID, turnId: TURN_ID, runtime: bindingRuntime, boundAt: NOW },
      });
      harness.setCurrent(terminal);
      harness.store.listTerminalReconciliation.mockResolvedValue([terminal]);

      await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

      expect(harness.store.settleTerminalFailure).toHaveBeenCalledWith(
        RUN_ID,
        terminal.revision,
        'TERMINAL_PROOF_MISSING'
      );
      expect(harness.store.retainCandidate).not.toHaveBeenCalled();
      expect(harness.files.readAuthorizedPlan).not.toHaveBeenCalled();
      expect(harness.inspectReadiness).not.toHaveBeenCalled();
    }
  );

  it('durably settles an exact legacy terminal null-runtime binding through the real coordinator/store seam', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'presentation-lifecycle-legacy-terminal-'));
    const coordinators: PresentationRunLifecycleCoordinator[] = [];
    try {
      const files = new PresentationRunFiles({
        userDataDir: path.join(fixtureRoot, 'user-data'),
        tempDir: path.join(fixtureRoot, 'temp'),
      });
      await Promise.all([mkdir(path.join(fixtureRoot, 'user-data')), mkdir(path.join(fixtureRoot, 'temp'))]);
      const journal = new PresentationRunJournal({ files });
      const clock = new Date(NOW);
      const store = new PresentationRunStore({
        files,
        journal,
        now: () => clock,
        getFreeDiskBytes: async () => 8 * 1024 * 1024 * 1024,
      });
      await journal.transaction({
        mutations: [
          {
            entityKind: 'run',
            entityId: RUN_ID,
            expectedRevision: null,
            nextManifest: exactLegacyNullableRun('terminal_verified'),
          },
        ],
      });

      const first = createRealStoreCoordinator(store, files, () => clock);
      coordinators.push(first.coordinator);
      await first.coordinator.backendReady({ port: 43123, token: 'secret' });

      await expect(store.getRun(RUN_ID)).resolves.toMatchObject({
        dispatchStatus: 'failed_retained',
        artifactPhase: 'sources_extracted',
        disposition: 'TRACKING_REQUIRED',
        binding: null,
        terminalEvidence: null,
      });
      await expect(store.listTerminalReconciliation()).resolves.toEqual([]);
      expect(first.observeRuntime).not.toHaveBeenCalled();
      expect(first.inspectReadiness).not.toHaveBeenCalled();
      await first.coordinator.dispose();

      const restartedStore = new PresentationRunStore({
        files,
        journal: new PresentationRunJournal({ files }),
        now: () => clock,
        getFreeDiskBytes: async () => 8 * 1024 * 1024 * 1024,
      });
      await expect(restartedStore.getRun(RUN_ID)).resolves.toMatchObject({
        dispatchStatus: 'failed_retained',
        disposition: 'TRACKING_REQUIRED',
        binding: null,
      });
      await expect(restartedStore.listTerminalReconciliation()).resolves.toEqual([]);
    } finally {
      await Promise.all(coordinators.map((coordinator) => coordinator.dispose()));
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('durably settles retention, plan-read, and workspace-creation failures before any cleanup', async () => {
    const retention = createHarness();
    const terminal = run('terminal_verified', {
      terminalEvidence: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        eventObservedAt: NOW,
        runtimeObservedAt: NOW,
        runtime: releasedRuntime,
      },
    });
    retention.setCurrent(terminal);
    retention.store.listTerminalReconciliation.mockResolvedValue([terminal]);
    retention.store.retainCandidate.mockRejectedValueOnce(new Error('retention failed'));
    await retention.coordinator.backendReady({ port: 43123, token: 'secret' });
    expect(retention.store.settleTerminalFailure).toHaveBeenCalledWith(RUN_ID, expect.any(Number), 'RETENTION_FAILED');
    expect(retention.files.readAuthorizedPlan).not.toHaveBeenCalled();

    const plan = createHarness();
    plan.setCurrent(run('bound'));
    plan.files.readAuthorizedPlan.mockRejectedValueOnce(new Error('plan changed'));
    await plan.coordinator.backendReady({ port: 43123, token: 'secret' });
    await plan.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority());
    expect(plan.store.settleReadinessFailure).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Number),
      expect.objectContaining({ status: 'error', code: 'INSPECTION_FAILED' })
    );
    expect(plan.files.createDeferredInspectionWorkspace).not.toHaveBeenCalled();
    expect(plan.inspectReadiness).not.toHaveBeenCalled();

    const workspace = createHarness();
    workspace.setCurrent(run('bound'));
    workspace.files.createDeferredInspectionWorkspace.mockRejectedValueOnce(new Error('workspace unavailable'));
    await workspace.coordinator.backendReady({ port: 43123, token: 'secret' });
    await workspace.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority());
    expect(workspace.store.settleReadinessFailure).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(Number),
      expect.objectContaining({ status: 'error', code: 'INSPECTION_FAILED' })
    );
    expect(workspace.inspectReadiness).not.toHaveBeenCalled();
  });

  it('leaves inspection bytes for restart cleanup when durable settlement or cleanup is interrupted', async () => {
    const settlement = createHarness();
    settlement.setCurrent(run('bound'));
    settlement.store.settleReadinessSuccess.mockRejectedValueOnce(new Error('settlement interrupted'));
    await settlement.coordinator.backendReady({ port: 43123, token: 'secret' });
    await settlement.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority());
    expect(settlement.deferredWorkspace.cleanupAfterSettlement).not.toHaveBeenCalled();

    settlement.store.listTerminalReconciliation.mockResolvedValueOnce([settlement.current]);
    await settlement.coordinator.backendReady({ port: 43123, token: 'secret' });
    expect(settlement.store.settleReadinessSuccess).toHaveBeenCalledTimes(2);

    const cleanup = createHarness();
    cleanup.setCurrent(run('bound'));
    cleanup.deferredWorkspace.cleanupAfterSettlement.mockRejectedValueOnce(new Error('cleanup interrupted'));
    await cleanup.coordinator.backendReady({ port: 43123, token: 'secret' });
    await cleanup.coordinator.handleTerminalEvent(terminalEvent(), terminalAuthority());
    cleanup.store.listSettledInspectionCleanup.mockResolvedValueOnce([RUN_ID]);
    await cleanup.coordinator.backendReady({ port: 43123, token: 'secret' });
    expect(cleanup.files.cleanupSettledInspectionWorkspaces).toHaveBeenCalledWith(RUN_ID);
  });

  it('cleans abandoned inspection copies on restart only for durably settled runs', async () => {
    const harness = createHarness();
    harness.store.listSettledInspectionCleanup.mockResolvedValue([RUN_ID]);

    await harness.coordinator.backendReady({ port: 43123, token: 'secret' });

    expect(harness.files.cleanupSettledInspectionWorkspaces).toHaveBeenCalledWith(RUN_ID);
    expect(harness.inspectReadiness).not.toHaveBeenCalled();
  });
});
