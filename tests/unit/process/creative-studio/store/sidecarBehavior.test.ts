/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest';
import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  type StudioProposalCommitAttributionV2,
} from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError } from '@/process/services/creative-studio/store/contracts';
import { createStudioProposalSidecarsV2 } from '@/process/services/creative-studio/store/proposalSidecars';
import { createStudioReferenceSidecarsV2 } from '@/process/services/creative-studio/store/referenceSidecars';

const timestamp = '2026-08-31T00:00:00.000Z';
const referenceAuthority = (name: string) => ({ path: `/studio/project_1/reference-requests/${name}` });

type CapturedWatcher = {
  onChange(relativeFile: string): void;
  onError(error: Error): void;
};

const proposalAuthority = (name: string) => ({ path: `/studio/project_1/proposals/${name}` });

type FakeDirectoryEntry = {
  name: string;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

const createProposalHarness = (
  options: {
    throwOnWatch?: boolean;
    root?: string | null;
    projectIds?: string[];
    pendingEntries?: FakeDirectoryEntry[];
    pendingResidues?: unknown[];
  } = {}
) => {
  let watcher: CapturedWatcher | undefined;
  const close = vi.fn();
  const safeLogError = vi.fn();
  const supported = { status: 'supported', project: {}, directory: { path: '/studio/project_1' } };
  const service = createStudioProposalSidecarsV2({
    fs: {},
    now: () => timestamp,
    watchProposalTree: (input: CapturedWatcher) => {
      if (options.throwOnWatch === true) throw new Error('watch unavailable');
      watcher = input;
      return { close };
    },
    safeLogError,
    storageError: (_error: unknown, fallback: string) => new CreativeStudioStoreError('storage_error', fallback),
    enqueue: async (_projectId: string, work: () => Promise<unknown>) => work(),
    existingCanonicalRoot: async () => options.root ?? null,
    writableCanonicalRoot: async () => '/studio',
    inspectProjectFile: async () => supported,
    inspectProjectWithSidecarFences: async () => supported,
    requireSupportedProjectInspection: (inspection: unknown) => inspection,
    assertProjectSnapshotCurrent: vi.fn(),
    serializeProjectForWrite: vi.fn(),
    writeProjectFiles: vi.fn(),
    observeProjectCommit: vi.fn(),
    repairSummaryAfterCommit: vi.fn(),
    listSupportedProjectIds: async () => options.projectIds ?? [],
    sidecarJournal:
      options.pendingEntries === undefined
        ? { resolveCompleteSidecarDirectoryFamilyV2: async () => null }
        : {
            /*
             * Supplying a resolved family is what makes readProposalLedgerV2 reachable at all. With
             * the default null family the whole recovery path — including every malformed-directory
             * refusal below — is unreachable, which is why it had no coverage.
             */
            resolveCompleteSidecarDirectoryFamilyV2: async () => ({
              project: proposalAuthority(''),
              root: proposalAuthority('proposals'),
              children: {
                pending: proposalAuthority('pending'),
                decisions: proposalAuthority('decisions'),
                slots: proposalAuthority('slots'),
                commits: proposalAuthority('commits'),
              },
            }),
            reconcileOwnedPendingPublicationResiduesV2: async () => options.pendingResidues ?? [],
            reconcileOwnedSlotCleanupResiduesV2: async () => [],
            reconcileJournalPublicationResiduesV2: async () => [],
            readStableDirectoryEntriesV2: async (authority: { path: string }) =>
              authority.path.endsWith('/pending') ? options.pendingEntries : [],
            assertDirectoryAuthorityV2: vi.fn(),
          },
  } as never);
  return { service, watcher: () => watcher, close, safeLogError };
};

const createReferenceHarness = (
  options: { throwOnWatch?: boolean; root?: string | null; projectIds?: string[]; emptyDirectoryFamily?: boolean } = {}
) => {
  let watcher: CapturedWatcher | undefined;
  const close = vi.fn();
  const safeLogError = vi.fn();
  const assertProjectSnapshotCurrent = vi.fn();
  const project = { spendAuthorizations: [] };
  const supported = { status: 'supported', project, directory: { path: '/studio/project_1' } };
  const sidecarJournal = {
    resolveCompleteSidecarDirectoryFamilyV2: async () =>
      options.emptyDirectoryFamily === true
        ? {
            project: supported.directory,
            root: referenceAuthority(''),
            children: {
              pending: referenceAuthority('pending'),
              decisions: referenceAuthority('decisions'),
              slots: referenceAuthority('slots'),
              receipts: referenceAuthority('receipts'),
            },
          }
        : null,
    assertDirectoryAuthorityV2: vi.fn(),
    reconcileOwnedPendingPublicationResiduesV2: async () => [],
    reconcileOwnedSlotCleanupResiduesV2: async () => [],
    reconcileJournalPublicationResiduesV2: async () => [],
    readStableDirectoryEntriesV2: async () => [],
  };
  const service = createStudioReferenceSidecarsV2({
    now: () => timestamp,
    createId: () => 'handoff_1',
    watchReferenceTree: (input: CapturedWatcher) => {
      if (options.throwOnWatch === true) throw new Error('watch unavailable');
      watcher = input;
      return { close };
    },
    safeLogError,
    storageError: (_error: unknown, fallback: string) => new CreativeStudioStoreError('storage_error', fallback),
    enqueue: async (_projectId: string, work: () => Promise<unknown>) => work(),
    existingCanonicalRoot: async () => options.root ?? null,
    writableCanonicalRoot: async () => '/studio',
    inspectProjectFile: async () => supported,
    inspectProjectWithSidecarFences: async () => supported,
    requireSupportedProjectInspection: (inspection: unknown) => inspection,
    assertProjectSnapshotCurrent,
    assertSynchronousResult: vi.fn(),
    listSupportedProjectIds: async () => options.projectIds ?? [],
    repairSummaryAfterCommit: vi.fn(),
    confirmProjectInsideQueue: vi.fn(),
    sidecarJournal,
  } as never);
  return { service, watcher: () => watcher, close, safeLogError, assertProjectSnapshotCurrent };
};

describe('extracted proposal sidecar behavior', () => {
  it('validates both attribution arms and fails closed across every persisted authority field', () => {
    const { validateProposalCommitAttributionV2 } = createProposalHarness().service;
    const mutation: StudioProposalCommitAttributionV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      kind: 'mutation',
      proposalId: 'proposal_1',
      projectId: 'project_1',
      baseRevision: 1,
      appliedRevision: 2,
      beforeProjectSha256: 'a'.repeat(64),
      afterProjectSha256: 'b'.repeat(64),
      createdBeatIds: ['beat_1'],
      createdShotIds: ['shot_1'],
      authorizationId: null,
      decidedAt: timestamp,
    };
    const paid: StudioProposalCommitAttributionV2 = {
      ...mutation,
      kind: 'paid_recovery',
      createdBeatIds: [],
      createdShotIds: [],
      authorizationId: 'authorization_1',
    };

    expect(validateProposalCommitAttributionV2('project_1', 'proposal_1', mutation)).toBe(true);
    expect(validateProposalCommitAttributionV2('project_1', 'proposal_1', paid)).toBe(true);

    const symbolic = { ...mutation } as Record<PropertyKey, unknown>;
    delete symbolic.decidedAt;
    Object.defineProperty(symbolic, Symbol('decidedAt'), { enumerable: true, value: timestamp });
    const accessor = { ...mutation } as Record<string, unknown>;
    Object.defineProperty(accessor, 'decidedAt', { enumerable: true, get: () => timestamp });

    const malformed: unknown[] = [
      null,
      symbolic,
      accessor,
      { ...mutation, extra: true },
      { ...mutation, schemaVersion: 0 },
      { ...mutation, kind: 'unknown' },
      { ...mutation, proposalId: 'proposal_other' },
      { ...mutation, projectId: 'project_other' },
      { ...mutation, baseRevision: 0 },
      { ...mutation, appliedRevision: 3 },
      { ...mutation, beforeProjectSha256: 7 },
      { ...mutation, beforeProjectSha256: 'A'.repeat(64) },
      { ...mutation, afterProjectSha256: 7 },
      { ...mutation, afterProjectSha256: 'B'.repeat(64) },
      { ...mutation, createdBeatIds: {} },
      { ...mutation, createdBeatIds: Array.from({ length: STUDIO_MAX_BEATS + 1 }, (_, index) => `beat_${index}`) },
      { ...mutation, createdBeatIds: ['../beat'] },
      { ...mutation, createdBeatIds: ['beat_1', 'beat_1'] },
      { ...mutation, createdShotIds: {} },
      {
        ...mutation,
        createdShotIds: Array.from({ length: STUDIO_MAX_SHOTS_PER_PROJECT + 1 }, (_, index) => `shot_${index}`),
      },
      { ...mutation, createdShotIds: ['../shot'] },
      { ...mutation, createdShotIds: ['shot_1', 'shot_1'] },
      { ...mutation, authorizationId: 'authorization_1' },
      { ...paid, authorizationId: null },
      { ...paid, createdBeatIds: ['beat_1'] },
      { ...paid, createdShotIds: ['shot_1'] },
      { ...mutation, decidedAt: 'not-a-timestamp' },
      { ...mutation, decidedAt: '2026-08-31T00:00:00.000z' },
    ];
    for (const candidate of malformed) {
      expect(validateProposalCommitAttributionV2('project_1', 'proposal_1', candidate)).toBe(false);
    }
    const oversizedId = 'x'.repeat(257);
    expect(
      validateProposalCommitAttributionV2(oversizedId, oversizedId, {
        ...mutation,
        projectId: oversizedId,
        proposalId: oversizedId,
      })
    ).toBe(false);
  });

  it('enforces mutation and paid-recovery attribution scope on both sides of a commit', () => {
    const { assertAttributionCreatedIdsV2 } = createProposalHarness().service;
    const paidAttribution = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      kind: 'paid_recovery' as const,
      proposalId: 'proposal_1',
      projectId: 'project_1',
      baseRevision: 1,
      appliedRevision: 2,
      beforeProjectSha256: 'a'.repeat(64),
      afterProjectSha256: 'b'.repeat(64),
      createdBeatIds: [],
      createdShotIds: [],
      authorizationId: 'authorization_1',
      decidedAt: timestamp,
    };
    const paidProposal = { id: 'proposal_1', payload: { kind: 'paid_recovery' } };
    const mutationProposal = { id: 'proposal_1', payload: { kind: 'mutation_batch', operations: [] } };
    const emptyProject = { spendAuthorizations: [] };
    const committedProject = {
      spendAuthorizations: [{ id: 'authorization_1', confirmedAt: timestamp }],
    };

    expect(() =>
      assertAttributionCreatedIdsV2({
        attribution: paidAttribution,
        proposal: paidProposal,
        project: emptyProject,
        state: 'before',
      } as never)
    ).not.toThrow();
    expect(() =>
      assertAttributionCreatedIdsV2({
        attribution: paidAttribution,
        proposal: paidProposal,
        project: committedProject,
        state: 'after',
      } as never)
    ).not.toThrow();
    expect(() =>
      assertAttributionCreatedIdsV2({
        attribution: paidAttribution,
        proposal: mutationProposal,
        project: emptyProject,
        state: 'before',
      } as never)
    ).toThrow('scope mismatch');
    expect(() =>
      assertAttributionCreatedIdsV2({
        attribution: paidAttribution,
        proposal: paidProposal,
        project: committedProject,
        state: 'before',
      } as never)
    ).toThrow('predates commit');
    expect(() =>
      assertAttributionCreatedIdsV2({
        attribution: paidAttribution,
        proposal: paidProposal,
        project: emptyProject,
        state: 'after',
      } as never)
    ).toThrow('proof mismatch');
    expect(() =>
      assertAttributionCreatedIdsV2({
        attribution: { ...paidAttribution, kind: 'mutation', authorizationId: null },
        proposal: paidProposal,
        project: emptyProject,
        state: 'before',
      } as never)
    ).toThrow('scope mismatch');
  });

  it('rejects malformed public proposal requests before touching storage', async () => {
    const service = createProposalHarness().service;
    const validRecord = {
      projectId: 'project_1',
      proposalId: 'proposal_1',
      baseRevision: 1,
      payload: { kind: 'test_payload' },
    };
    const malformedRecords: unknown[] = [
      null,
      {},
      { ...validRecord, extra: true },
      { ...validRecord, projectId: '../project' },
      { ...validRecord, proposalId: '../proposal' },
      { ...validRecord, baseRevision: 0 },
      { ...validRecord, payload: [] },
    ];

    await Promise.all(
      malformedRecords.map((input) =>
        expect(service.recordProposalV2(input as never)).rejects.toMatchObject({ code: 'invalid_payload' })
      )
    );
    await expect(service.recordProposalV2(validRecord as never)).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.listProposalsV2('../project')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(service.acceptProposalV2('../project', 'proposal_1')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(service.acceptProposalV2('project_1', '../proposal')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(service.rejectProposalV2('../project', 'proposal_1')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(service.rejectProposalV2('project_1', '../proposal')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(service.resolveProposalPathsV2('../project')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(service.reapAbandonedProposalsV2()).resolves.toBeUndefined();
  });

  it('returns an empty ledger without sidecars and classifies unavailable sidecar creation', async () => {
    const harness = createProposalHarness({ root: '/studio', projectIds: ['project_1'] });
    await expect(harness.service.listProposalsV2('project_1')).resolves.toEqual([]);
    await expect(harness.service.reapAbandonedProposalsV2()).resolves.toBeUndefined();
    await expect(harness.service.resolveProposalPathsV2('project_1')).rejects.toMatchObject({
      code: 'storage_error',
    });
  });

  it('filters watcher paths, contains watcher failures, and closes idempotently', async () => {
    const harness = createProposalHarness();
    const listener = vi.fn();
    const stop = await harness.service.watchProposalsV2(listener);
    const watcher = harness.watcher();
    expect(watcher).toBeDefined();

    watcher!.onChange('project_1/proposals/slots/0.slot');
    watcher!.onChange('../project/proposals/pending/proposal_1.json');
    watcher!.onChange('project_1/proposals/pending/../proposal.json');
    watcher!.onChange('project_1/proposals/pending/bad!.json');
    watcher!.onChange('project_1/proposals/pending/proposal_1.json');
    await vi.waitFor(() => expect(harness.safeLogError).toHaveBeenCalledTimes(1));
    watcher!.onError(new Error('watch event failed'));
    expect(harness.safeLogError).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();

    await stop();
    await stop();
    watcher!.onChange('project_1/proposals/pending/proposal_1.json');
    watcher!.onError(new Error('ignored after close'));
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.safeLogError).toHaveBeenCalledTimes(2);
  });

  it('classifies synchronous watcher startup failure as storage failure', async () => {
    const harness = createProposalHarness({ throwOnWatch: true });
    await expect(harness.service.watchProposalsV2(vi.fn())).rejects.toMatchObject({ code: 'storage_error' });
  });

  /*
   * The proposal recovery ledger's refusals had no coverage because the harness returned a null
   * sidecar family, which short-circuits before readProposalLedgerV2 runs. Supplying a family reaches
   * them. These are the guards that stop a corrupted proposals directory from being read as authority.
   */
  const jsonEntry = (name: string): FakeDirectoryEntry => ({
    name,
    isFile: () => true,
    isSymbolicLink: () => false,
  });

  it('refuses a proposal directory holding anything but plain .json files', async () => {
    const notJson = createProposalHarness({ root: '/studio', pendingEntries: [jsonEntry('proposal_1.txt')] });
    await expect(notJson.service.listProposalsV2('project_1')).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Malformed schema-2 Studio proposal directory',
    });

    const symlink = createProposalHarness({
      root: '/studio',
      pendingEntries: [{ name: 'proposal_1.json', isFile: () => true, isSymbolicLink: () => true }],
    });
    await expect(symlink.service.listProposalsV2('project_1')).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Malformed schema-2 Studio proposal directory',
    });

    const notAFile = createProposalHarness({
      root: '/studio',
      pendingEntries: [{ name: 'proposal_1.json', isFile: () => false, isSymbolicLink: () => false }],
    });
    await expect(notAFile.service.listProposalsV2('project_1')).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Malformed schema-2 Studio proposal directory',
    });
  });

  it('refuses a proposal file whose name is not a safe identity', async () => {
    // A traversal segment in a filename would otherwise become a proposal id.
    const harness = createProposalHarness({ root: '/studio', pendingEntries: [jsonEntry('../escape.json')] });
    await expect(harness.service.listProposalsV2('project_1')).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Malformed schema-2 Studio proposal identity',
    });
  });

  it('refuses a pending publication residue that does not parse as a proposal record', async () => {
    /*
     * A residue is a half-published record recovered from the journal. If it survives JSON parsing but
     * is not a valid proposal, or if it collides with a record already read from the directory, the
     * ledger must refuse rather than treat it as authority — both arms throw the same refusal because
     * either way the recovered identity is ambiguous.
     */
    const harness = createProposalHarness({
      root: '/studio',
      pendingEntries: [],
      pendingResidues: [
        {
          effective: true,
          namedFile: '/studio/project_1/proposals/pending/proposal_1.json',
          identified: {
            file: '/studio/project_1/proposals/pending/proposal_1.json',
            bytes: JSON.stringify({ notAProposal: true }),
          },
        },
      ],
    });

    await expect(harness.service.listProposalsV2('project_1')).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Ambiguous schema-2 Studio proposal recovery record',
    });
  });
});

describe('extracted reference sidecar behavior', () => {
  it('rejects malformed decision and receipt shapes before touching storage', async () => {
    const service = createReferenceHarness().service;
    const decision = {
      projectId: 'project_1',
      requestId: 'request_1',
      expectedRevision: 1,
      outcome: { kind: 'rejected' },
    };
    const malformedDecisions: unknown[] = [
      null,
      {},
      { ...decision, extra: true },
      { ...decision, projectId: '../project' },
      { ...decision, requestId: '../request' },
      { ...decision, expectedRevision: 0 },
      { ...decision, outcome: [] },
      { ...decision, outcome: { kind: 'rejected', extra: true } },
      { ...decision, outcome: { kind: 'unknown' } },
    ];
    const symbolicDecision = { ...decision } as Record<PropertyKey, unknown>;
    delete symbolicDecision.outcome;
    Object.defineProperty(symbolicDecision, Symbol('outcome'), { enumerable: true, value: decision.outcome });
    const accessorDecision = { ...decision } as Record<string, unknown>;
    Object.defineProperty(accessorDecision, 'outcome', { enumerable: true, get: () => decision.outcome });
    malformedDecisions.push(symbolicDecision, accessorDecision);
    await Promise.all(
      malformedDecisions.map((input) =>
        expect(service.decideReferenceRequestV2(input as never)).rejects.toMatchObject({ code: 'invalid_payload' })
      )
    );
    await expect(service.decideReferenceRequestV2(decision as never)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      service.decideReferenceRequestV2({ ...decision, outcome: { kind: 'generation_gate' } } as never)
    ).rejects.toMatchObject({ code: 'not_found' });

    const dismissed = {
      projectId: 'project_1',
      handoffId: 'handoff_1',
      expectedRevision: 1,
      result: { kind: 'dismissed' },
    };
    const malformedReceipts: unknown[] = [
      null,
      {},
      { ...dismissed, extra: true },
      { ...dismissed, projectId: '../project' },
      { ...dismissed, handoffId: '../handoff' },
      { ...dismissed, expectedRevision: 0 },
      { ...dismissed, result: [] },
      { ...dismissed, result: { kind: 'dismissed', extra: true } },
      { ...dismissed, result: { kind: 'confirmed' } },
      { ...dismissed, result: { kind: 'confirmed', authorizationId: '../authorization' } },
      { ...dismissed, result: { kind: 'unknown' } },
    ];
    await Promise.all(
      malformedReceipts.map((input) =>
        expect(service.recordReferenceGenerationHandoffReceiptV2(input as never)).rejects.toMatchObject({
          code: 'invalid_payload',
        })
      )
    );
    await expect(service.recordReferenceGenerationHandoffReceiptV2(dismissed as never)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      service.recordReferenceGenerationHandoffReceiptV2({
        ...dismissed,
        result: { kind: 'confirmed', authorizationId: 'authorization_1' },
      } as never)
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects malformed confirmation and identity inputs and handles absent storage', async () => {
    const service = createReferenceHarness().service;
    const confirmation = {
      projectId: 'project_1',
      handoffId: 'handoff_1',
      expectedRevision: 1,
      expiresAt: '2026-08-31T01:00:00.000Z',
      revalidate: vi.fn(),
      assertActive: vi.fn(),
      buildCommit: vi.fn(),
    };
    const malformedConfirmations: unknown[] = [
      null,
      { ...confirmation, projectId: '../project' },
      { ...confirmation, handoffId: '../handoff' },
      { ...confirmation, expectedRevision: 0 },
      { ...confirmation, expiresAt: 'not-a-timestamp' },
      { ...confirmation, revalidate: null },
      { ...confirmation, assertActive: null },
      { ...confirmation, buildCommit: null },
      { ...confirmation, commitTag: 7 },
    ];
    await Promise.all(
      malformedConfirmations.map((input) =>
        expect(service.confirmReferenceGenerationHandoffV2(input as never)).rejects.toMatchObject({
          code: 'invalid_payload',
        })
      )
    );
    await expect(service.confirmReferenceGenerationHandoffV2(confirmation)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      service.confirmReferenceGenerationHandoffV2({ ...confirmation, commitTag: 'reference_confirm' })
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.listReferenceRequestsV2('../project')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(service.readReferenceGenerationHandoffV2('../project', 'handoff_1')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(service.readReferenceGenerationHandoffV2('project_1', '../handoff')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(service.resolveReferenceRequestPathsV2('../project')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(service.reapAbandonedReferenceRequestsV2()).resolves.toBeUndefined();
    await expect(
      service.hasOpenReferenceGenerationHandoffOverlapV2InsideQueue({ referenceIds: [] } as never)
    ).resolves.toBe(false);
  });

  it('returns an empty reference ledger without sidecars and classifies unavailable sidecar creation', async () => {
    const harness = createReferenceHarness({ root: '/studio', projectIds: ['project_1'] });
    await expect(harness.service.listReferenceRequestsV2('project_1')).resolves.toEqual([]);
    await expect(harness.service.reapAbandonedReferenceRequestsV2()).resolves.toBeUndefined();
    await expect(harness.service.resolveReferenceRequestPathsV2('project_1')).rejects.toMatchObject({
      code: 'storage_error',
    });
  });

  it('filters reference watcher paths, contains failures, and closes idempotently', async () => {
    const harness = createReferenceHarness();
    const listener = vi.fn();
    const stop = await harness.service.watchReferenceRequestsV2(listener);
    const watcher = harness.watcher();
    expect(watcher).toBeDefined();

    watcher!.onChange('project_1/reference-requests/slots/0.slot');
    watcher!.onChange('../project/reference-requests/pending/request_1.json');
    watcher!.onChange('project_1/reference-requests/pending/../request.json');
    watcher!.onChange('project_1/reference-requests/pending/bad!.json');
    watcher!.onChange('project_1/reference-requests/receipts/handoff_1.json');
    await vi.waitFor(() => expect(harness.safeLogError).toHaveBeenCalledTimes(1));
    watcher!.onError(new Error('watch event failed'));
    expect(harness.safeLogError).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();

    await stop();
    await stop();
    watcher!.onChange('project_1/reference-requests/pending/request_1.json');
    watcher!.onError(new Error('ignored after close'));
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.safeLogError).toHaveBeenCalledTimes(2);
  });

  it('ignores a valid watcher event whose current empty ledger has no matching request', async () => {
    const harness = createReferenceHarness({ root: '/studio', emptyDirectoryFamily: true });
    const listener = vi.fn();
    const stop = await harness.service.watchReferenceRequestsV2(listener);
    harness.watcher()!.onChange('project_1/reference-requests/pending/request_1.json');

    await vi.waitFor(() => expect(harness.assertProjectSnapshotCurrent).toHaveBeenCalled());
    expect(listener).not.toHaveBeenCalled();
    expect(harness.safeLogError).not.toHaveBeenCalled();
    await stop();
  });

  it('classifies synchronous reference watcher startup failure as storage failure', async () => {
    const harness = createReferenceHarness({ throwOnWatch: true });
    await expect(harness.service.watchReferenceRequestsV2(vi.fn())).rejects.toMatchObject({ code: 'storage_error' });
  });
});
