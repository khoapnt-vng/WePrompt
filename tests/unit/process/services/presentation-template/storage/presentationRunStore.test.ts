/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import {
  PresentationRunFiles,
  PresentationRunSimulatedProcessCrashError,
  type PresentationRunFileDurableBoundary,
} from '@/process/services/presentation-template/run/storage/presentationRunFiles';
import {
  PresentationRunJournal,
  type PresentationRunDurableBoundary,
} from '@/process/services/presentation-template/run/storage/presentationRunJournal';
import {
  PresentationRunStore,
  PresentationRunStoreError,
  SortedKeyedLock,
} from '@/process/services/presentation-template/run/storage/presentationRunStore';
import type { PresentationRunFailure } from '@/common/types/office/presentationRun';
import type {
  StoredPresentationGrantManifest,
  StoredPresentationRunManifest,
} from '@/process/services/presentation-template/run/storage/presentationRunStore';
import type { StoredPresentationRunTombstone } from '@/process/services/presentation-template/run/storage/presentationRunStore';

const RUN_ID = '434393ce-dd45-44fe-a51c-262b2b181cc5';
const CONVERSATION_ID = '745b7d43-a0aa-4bb7-b0cc-283f2db4873d';
const REQUEST_ID = 'ab82a45e-f426-41d0-bdda-4e151a78a399';
const GRANT_A = 'd1d50dfe-3650-48f3-b98f-d7f5b2148996';
const GRANT_B = '3ab02325-40ce-4695-a67d-435a011737a0';
const RUN_B = '9b067172-2e33-40bb-a277-72b247e9d487';
const RUN_C = 'f441e52d-c9cb-47c0-aa71-926c56740fe8';
const RUN_D = '9a0ee75c-5df2-457b-8c96-3bb8272ecf7a';
const RUN_E = '31d48828-7f43-439a-9bea-5c137db9b263';
const RUN_F = 'e26e312d-447b-44ca-984d-6db7d3606f22';
const RUN_G = '00000000-0000-4000-8000-000000000007';
const RUN_H = '00000000-0000-4000-8000-000000000008';
const RUN_I = '00000000-0000-4000-8000-000000000009';
const RUN_J = '00000000-0000-4000-8000-000000000010';
const RUN_K = '00000000-0000-4000-8000-000000000011';
const RUN_L = '00000000-0000-4000-8000-000000000012';
const CONVERSATION_B = '00000000-0000-4000-8000-000000000101';
const CONVERSATION_C = '00000000-0000-4000-8000-000000000102';
const CREATED_AT = new Date('2026-08-04T00:00:00.000Z');

const storedRun = (
  runId: string,
  dispatchStatus: StoredPresentationRunManifest['dispatchStatus'],
  overrides: Partial<StoredPresentationRunManifest> = {}
): StoredPresentationRunManifest => ({
  version: 2,
  runId,
  clientRequestId: runId,
  conversationId: CONVERSATION_ID,
  selectedTemplateId: 'business-review',
  requestFingerprint: 'a'.repeat(64),
  postAllocationFailure: null,
  revision: 0,
  createdAt: CREATED_AT.toISOString(),
  updatedAt: CREATED_AT.toISOString(),
  statusEnteredAt: CREATED_AT.toISOString(),
  committedAt: dispatchStatus === 'allocating' ? null : CREATED_AT.toISOString(),
  retainedAt: dispatchStatus === 'retained' || dispatchStatus === 'failed_retained' ? CREATED_AT.toISOString() : null,
  dispatchStatus,
  artifactPhase: 'sources_extracted',
  disposition: null,
  retainedCandidate: null,
  sourceGrants: [],
  binding: null,
  postInvoked: false,
  retainedBytes: 0,
  ...overrides,
});

const storedGrant = (
  grantId: string,
  overrides: Partial<StoredPresentationGrantManifest> = {}
): StoredPresentationGrantManifest => ({
  version: 2,
  grantId,
  ownerKey: `conversation:${CONVERSATION_ID}`,
  revision: 0,
  createdAt: CREATED_AT.toISOString(),
  updatedAt: CREATED_AT.toISOString(),
  expiresAt: '2026-08-04T00:15:00.000Z',
  state: 'active',
  byteLength: 12,
  claimedRunId: null,
  ...overrides,
});

const exactTerminalLifecycle = (turnId = REQUEST_ID) => ({
  preparation: null,
  initialDispatchLease: null,
  terminalEvidence: {
    conversationId: CONVERSATION_ID,
    turnId,
    eventObservedAt: CREATED_AT.toISOString(),
    runtimeObservedAt: CREATED_AT.toISOString(),
    runtime: {
      state: 'idle' as const,
      can_send_message: true as const,
      has_task: false as const,
      task_status: 'finished' as const,
      is_processing: false as const,
      pending_confirmations: 0 as const,
      turn_id: null,
    },
  },
  runtimeReleaseObservations: [],
  retentionProof: null,
  readiness: null,
  binding: {
    conversationId: CONVERSATION_ID,
    turnId,
    runtime: 'aionrs' as const,
    boundAt: CREATED_AT.toISOString(),
  },
  postInvoked: true,
});

describe('PresentationRunStore', () => {
  let fixtureRoot: string;
  let userDataDir: string;
  let systemTempDir: string;
  let files: PresentationRunFiles;
  let journal: PresentationRunJournal;
  let store: PresentationRunStore;

  const createTask3GrantBatch = async (
    principalId: string,
    grants: readonly { grantId: string; displayName: string; content: string }[]
  ) => {
    const owner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    await store.getPresentationSourceOwner(owner, principalId);
    const sourcePaths = grants.map(({ grantId }) => path.join(fixtureRoot, `${grantId}.txt`));
    await Promise.all(grants.map(({ content }, index) => writeFile(sourcePaths[index]!, content, { mode: 0o600 })));
    const prepared = await files.prepareSourceSnapshots(
      grants.map(({ grantId }, index) => ({ grantId, sourcePath: sourcePaths[index]!, format: 'txt' as const }))
    );
    const ownerSnapshot = await store.createPresentationSourceGrants({
      owner,
      principalId,
      expectedOwnerRevision: 0,
      grants: prepared.map((snapshot, index) => ({
        grantId: snapshot.grantId,
        displayName: grants[index]!.displayName,
        format: 'txt' as const,
        sourceKind: 'native-picker' as const,
        snapshotRelativePath: snapshot.finalRelativePath,
        sha256: snapshot.sha256,
        byteLength: snapshot.byteLength,
        preparedSnapshot: snapshot,
      })),
    });
    return { owner, ownerSnapshot, prepared };
  };

  const allocateSnapshottedRun = async (): Promise<void> => {
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    await store.transitionRun(RUN_ID, {
      expectedRevision: 0,
      dispatchStatus: 'allocating',
      artifactPhase: 'sources_snapshotted',
      now: CREATED_AT.toISOString(),
    });
  };

  const prepareTask5RunAssets = async () => {
    const candidateBytes = Buffer.from('stable reference presentation bytes');
    const themeBytes = Buffer.from('{"name":"test theme"}\n');
    const grounding = '# Grounding\n\nVerified source evidence.\n';
    const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
    const prepared = await files.prepareRunAssets({
      runId: RUN_ID,
      candidateBytes,
      grounding,
      rawInput: 'Prepare the quarterly business review.',
      directive: 'Edit candidate.pptx and write plan.json.',
      sourceRefs: [],
      injectSkills: ['officecli'],
      template: {
        theme: { fileName: 'theme.json', sha256: sha256(themeBytes), byteLength: themeBytes.byteLength },
        reference: {
          fileName: 'reference.pptx',
          sha256: sha256(candidateBytes),
          byteLength: candidateBytes.byteLength,
        },
      },
    });
    return { candidateBytes, grounding, prepared };
  };

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'presentation-run-store-'));
    userDataDir = path.join(fixtureRoot, 'user-data');
    systemTempDir = path.join(fixtureRoot, 'system-temp');
    await Promise.all([mkdir(userDataDir), mkdir(systemTempDir)]);
    files = new PresentationRunFiles({ userDataDir, tempDir: systemTempDir });
    journal = new PresentationRunJournal({ files, now: () => CREATED_AT });
    store = new PresentationRunStore({
      files,
      journal,
      now: () => CREATED_AT,
      randomUUID: () => RUN_ID,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('replays one normalized request exactly and rejects the same client ID with a different fingerprint', async () => {
    const input = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'A'.repeat(64),
      grantClaims: [],
    };

    const [first, replay] = await Promise.all([
      store.allocateRun(input),
      store.allocateRun({ ...input, requestFingerprint: 'a'.repeat(64) }),
    ]);
    expect([first, replay].map((result) => (result.ok ? result.status : result.code)).toSorted()).toEqual([
      'created',
      'existing',
    ]);
    if (!first.ok || !replay.ok) throw new Error('allocation unexpectedly failed');
    expect(first.run.runId).toBe(replay.run.runId);
    expect(first.run.requestFingerprint).toBe('a'.repeat(64));
    expect(replay.run.requestFingerprint).toBe('a'.repeat(64));

    await expect(store.allocateRun({ ...input, requestFingerprint: 'b'.repeat(64) })).resolves.toMatchObject({
      ok: false,
      code: 'REQUEST_COLLISION',
      retryable: false,
      state: 'lookup',
      details: { existingRunId: RUN_ID },
    });
  });

  it.each(['toString', 'constructor', '__proto__'])(
    'rejects the unsafe prototype-named conversation ID %s before persistence',
    async (conversationId) => {
      const input = {
        conversationId,
        clientRequestId: `request-${conversationId}`,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'a'.repeat(64),
        grantClaims: [],
      };

      await expect(store.allocateRun(input)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(journal.readCanonical('run', RUN_ID)).resolves.toBeNull();
    }
  );

  it('keeps valid conversation request tuples separate when client identifiers contain the old delimiter', async () => {
    const runIds = [RUN_ID, RUN_B];
    const collisionStore = new PresentationRunStore({
      files,
      journal,
      now: () => CREATED_AT,
      randomUUID: () => runIds.shift() ?? RUN_C,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const firstInput = {
      conversationId: CONVERSATION_ID,
      clientRequestId: 'b\u0000c',
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    };
    const secondInput = {
      conversationId: CONVERSATION_B,
      clientRequestId: 'c',
      selectedTemplateId: 'business-review',
      requestFingerprint: 'b'.repeat(64),
      grantClaims: [],
    };

    await expect(collisionStore.allocateRun(firstInput)).resolves.toMatchObject({
      ok: true,
      status: 'created',
      run: { runId: RUN_ID },
    });
    await expect(collisionStore.allocateRun(secondInput)).resolves.toMatchObject({
      ok: true,
      status: 'created',
      run: { runId: RUN_B },
    });

    const restarted = new PresentationRunStore({
      files,
      journal,
      now: () => CREATED_AT,
      randomUUID: () => RUN_C,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await expect(restarted.allocateRun(firstInput)).resolves.toMatchObject({
      ok: true,
      status: 'existing',
      run: { runId: RUN_ID },
    });
    await expect(restarted.allocateRun(secondInput)).resolves.toMatchObject({
      ok: true,
      status: 'existing',
      run: { runId: RUN_B },
    });
  });

  it('serializes reverse-ordered overlapping key sets without deadlock', async () => {
    const lock = new SortedKeyedLock();
    const order: string[] = [];
    let releaseFirst: () => void = (): void => undefined;
    const firstEntered = new Promise<void>((resolve) => {
      void lock.runExclusive(['run:z', 'grant:a'], async () => {
        order.push('first-entered');
        resolve();
        await new Promise<void>((release) => {
          releaseFirst = release;
        });
        order.push('first-left');
      });
    });
    await firstEntered;
    const second = lock.runExclusive(['grant:a', 'run:z'], async () => {
      order.push('second-entered');
    });

    await Promise.resolve();
    expect(order).toEqual(['first-entered']);
    releaseFirst();
    await second;
    expect(order).toEqual(['first-entered', 'first-left', 'second-entered']);
  });

  it('deduplicates and lexically orders keys before lock acquisition', async () => {
    const acquisitions: string[][] = [];
    const lock = new SortedKeyedLock((keys) => acquisitions.push([...keys]));

    await lock.runExclusive(['run:z', 'grant:a', 'run:z', 'conversation:m'], async () => undefined);

    expect(acquisitions).toEqual([['conversation:m', 'grant:a', 'run:z']]);
  });

  it('claims every source grant in the same canonical transaction as allocation', async () => {
    await journal.transaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: {
            version: 2,
            grantId: GRANT_A,
            ownerKey: `conversation:${CONVERSATION_ID}`,
            revision: 0,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: CREATED_AT.toISOString(),
            expiresAt: '2026-08-04T00:15:00.000Z',
            state: 'active',
            byteLength: 12,
            claimedRunId: null,
          },
        },
        {
          entityKind: 'grant',
          entityId: GRANT_B,
          expectedRevision: null,
          nextManifest: {
            version: 2,
            grantId: GRANT_B,
            ownerKey: `conversation:${CONVERSATION_ID}`,
            revision: 0,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: CREATED_AT.toISOString(),
            expiresAt: '2026-08-04T00:15:00.000Z',
            state: 'active',
            byteLength: 24,
            claimedRunId: null,
          },
        },
      ],
    });

    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [
        { grantId: GRANT_A, expectedRevision: 0 },
        { grantId: GRANT_B, expectedRevision: 0 },
      ],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');

    expect(await journal.readCanonical('grant', GRANT_A)).toMatchObject({
      revision: 1,
      state: 'claimed',
      claimedRunId: allocated.run.runId,
    });
    expect(await journal.readCanonical('grant', GRANT_B)).toMatchObject({
      revision: 1,
      state: 'claimed',
      claimedRunId: allocated.run.runId,
    });
    expect(allocated.run).toMatchObject({ sourceGrants: [GRANT_A, GRANT_B], retainedBytes: 36 });
  });

  it('rejects a same-conversation integrity claim from another principal without mutating canonical state', async () => {
    const principalA = 'principal-a';
    const { owner, ownerSnapshot, prepared } = await createTask3GrantBatch(principalA, [
      { grantId: GRANT_A, displayName: 'brief.txt', content: 'Principal A evidence\n' },
    ]);

    const result = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      principalId: 'principal-b',
      grantClaims: [
        {
          grantId: GRANT_A,
          expectedByteLength: prepared[0]!.byteLength,
          expectedSha256: prepared[0]!.sha256,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_FOREIGN',
      details: { grantId: GRANT_A },
    });
    await expect(store.getPresentationSourceOwner(owner, principalA)).resolves.toEqual(ownerSnapshot);
    await expect(files.listEntityIds('run')).resolves.toEqual([]);
  });

  it('returns claimed source snapshots in the renderer-selected order', async () => {
    const principalId = 'principal-a';
    const { prepared } = await createTask3GrantBatch(principalId, [
      { grantId: GRANT_A, displayName: 'first.txt', content: 'First source\n' },
      { grantId: GRANT_B, displayName: 'second.txt', content: 'Second source\n' },
    ]);
    const byGrantId = new Map(prepared.map((snapshot) => [snapshot.grantId, snapshot]));
    const claims = [GRANT_B, GRANT_A].map((grantId) => {
      const snapshot = byGrantId.get(grantId);
      if (snapshot === undefined) throw new Error('prepared source snapshot is missing');
      return {
        grantId,
        expectedByteLength: snapshot.byteLength,
        expectedSha256: snapshot.sha256,
      };
    });
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      principalId,
      grantClaims: claims,
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');

    await expect(store.getClaimedSourceSnapshots(RUN_ID)).resolves.toEqual([
      {
        grantId: GRANT_B,
        displayName: 'second.txt',
        format: 'txt',
        sourceKind: 'native-picker',
        byteLength: byGrantId.get(GRANT_B)!.byteLength,
        sha256: byGrantId.get(GRANT_B)!.sha256,
        snapshotRelativePath: 'source.txt',
      },
      {
        grantId: GRANT_A,
        displayName: 'first.txt',
        format: 'txt',
        sourceKind: 'native-picker',
        byteLength: byGrantId.get(GRANT_A)!.byteLength,
        sha256: byGrantId.get(GRANT_A)!.sha256,
        snapshotRelativePath: 'source.txt',
      },
    ]);
  });

  it('retains the exact committed preparation across a fresh store and files instance', async () => {
    await allocateSnapshottedRun();
    const { prepared } = await prepareTask5RunAssets();
    const committed = await store.commitPreparedRun(RUN_ID, 1, prepared);
    if (committed.preparation === undefined || committed.preparation === null) {
      throw new Error('committed preparation is missing');
    }

    const restartedFiles = new PresentationRunFiles({ userDataDir, tempDir: systemTempDir });
    const restarted = new PresentationRunStore({
      files: restartedFiles,
      journal: new PresentationRunJournal({ files: restartedFiles, now: () => CREATED_AT }),
      now: () => CREATED_AT,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await restarted.initialize();
    const recovered = await restarted.getRun(RUN_ID);
    if (recovered?.preparation === undefined || recovered.preparation === null) {
      throw new Error('recovered preparation is missing');
    }

    expect(recovered.preparation).toEqual(prepared.record);
    await expect(restartedFiles.readAuthorizedRunPreparation(RUN_ID, recovered.preparation)).resolves.toEqual(
      prepared.record.payload
    );
  });

  it('counts grounding, preparation JSON, and pretty canonical manifest bytes but not the staging candidate', async () => {
    await allocateSnapshottedRun();
    const { grounding, prepared } = await prepareTask5RunAssets();

    const committed = await store.commitPreparedRun(RUN_ID, 1, prepared);
    const canonicalManifest = await readFile(files.getEntityManifestPath('run', RUN_ID));
    const expectedRetainedBytes =
      Buffer.byteLength(grounding, 'utf8') + prepared.record.byteLength + canonicalManifest.byteLength;

    expect(canonicalManifest.toString('utf8')).toBe(`${JSON.stringify(committed, null, 2)}\n`);
    expect(committed.retainedBytes).toBe(expectedRetainedBytes);
    expect(committed.retainedBytes).not.toBe(expectedRetainedBytes + prepared.candidate.byteLength);
  });

  it('garbage-collects a prepared run at the retention boundary', async () => {
    await allocateSnapshottedRun();
    const { prepared } = await prepareTask5RunAssets();
    const committed = await store.commitPreparedRun(RUN_ID, 1, prepared);
    const retained = await store.settleCommittedPreflightFailure(RUN_ID, committed.revision);
    expect(retained.preparation).toEqual(prepared.record);

    const retentionBoundary = new Date(CREATED_AT.getTime() + PRESENTATION_RUN_LIMITS.FAILED_OR_REVIEW_RETENTION_MS);
    const sweepingFiles = new PresentationRunFiles({ userDataDir, tempDir: systemTempDir });
    const sweepingStore = new PresentationRunStore({
      files: sweepingFiles,
      journal: new PresentationRunJournal({ files: sweepingFiles, now: () => retentionBoundary }),
      now: () => retentionBoundary,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });

    await expect(sweepingStore.initialize()).resolves.toBeUndefined();
    await expect(sweepingStore.getRun(RUN_ID)).resolves.toMatchObject({
      dispatchStatus: 'discarded',
      preparation: null,
    });
  });

  it('rejects preparation growth beyond the retained-byte cap with the typed store error', async () => {
    await journal.transaction({
      mutations: [
        {
          entityKind: 'run',
          entityId: RUN_ID,
          expectedRevision: null,
          nextManifest: storedRun(RUN_ID, 'allocating', {
            artifactPhase: 'sources_snapshotted',
            retainedBytes: PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_CONVERSATION - 1,
          }),
        },
      ],
    });
    const { prepared } = await prepareTask5RunAssets();

    const rejection = store.commitPreparedRun(RUN_ID, 0, prepared);

    await expect(rejection).rejects.toBeInstanceOf(PresentationRunStoreError);
    await expect(rejection).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' });
  });

  it('rejects a duplicated grant ID before mutating the canonical grant', async () => {
    await journal.transaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: {
            version: 2,
            grantId: GRANT_A,
            ownerKey: `conversation:${CONVERSATION_ID}`,
            revision: 0,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: CREATED_AT.toISOString(),
            expiresAt: '2026-08-04T00:15:00.000Z',
            state: 'active',
            byteLength: 12,
            claimedRunId: null,
          },
        },
      ],
    });

    await expect(
      store.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: REQUEST_ID,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'a'.repeat(64),
        grantClaims: [
          { grantId: GRANT_A, expectedRevision: 0 },
          { grantId: GRANT_A, expectedRevision: 0 },
        ],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_INVALID',
      details: { grantId: GRANT_A },
    });
    await expect(journal.readCanonical('grant', GRANT_A)).resolves.toMatchObject({ revision: 0, state: 'active' });
  });

  it.each([
    [{ version: 1 }, 'SOURCE_GRANT_INVALID'],
    [{ createdAt: 'not-a-date' }, 'SOURCE_GRANT_INVALID'],
    [{ updatedAt: 'not-a-date' }, 'SOURCE_GRANT_INVALID'],
    [{ expiresAt: 'not-a-date' }, 'SOURCE_GRANT_INVALID'],
    [{ updatedAt: '2026-08-03T23:59:59.999Z' }, 'SOURCE_GRANT_INVALID'],
    [{ expiresAt: '2026-08-03T23:59:59.999Z' }, 'SOURCE_GRANT_INVALID'],
    [{ claimedRunId: RUN_B }, 'SOURCE_GRANT_INVALID'],
    [{ ownerKey: `conversation:${CONVERSATION_B}` }, 'SOURCE_GRANT_FOREIGN'],
    [{ state: 'claimed', claimedRunId: RUN_B }, 'SOURCE_GRANT_REPLAYED'],
    [{ state: 'consumed', claimedRunId: RUN_B }, 'SOURCE_GRANT_REPLAYED'],
    [{ state: 'expired' }, 'SOURCE_GRANT_EXPIRED'],
    [{ expiresAt: CREATED_AT.toISOString() }, 'SOURCE_GRANT_EXPIRED'],
    [{ byteLength: -1 }, 'SOURCE_GRANT_INVALID'],
    [{ byteLength: Number.MAX_SAFE_INTEGER + 1 }, 'SOURCE_GRANT_INVALID'],
    [{ byteLength: 64 * 1_024 * 1_024 + 1 }, 'SOURCE_LIMIT_EXCEEDED'],
  ] as const)('rejects malformed, expired, or oversized grant metadata %j', async (override, expectedCode) => {
    await journal.transaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: {
            version: 2,
            grantId: GRANT_A,
            ownerKey: `conversation:${CONVERSATION_ID}`,
            revision: 0,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: CREATED_AT.toISOString(),
            expiresAt: '2026-08-04T00:15:00.000Z',
            state: 'active',
            byteLength: 12,
            claimedRunId: null,
            ...override,
          },
        },
      ],
    });

    await expect(
      store.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: REQUEST_ID,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'a'.repeat(64),
        grantClaims: [{ grantId: GRANT_A, expectedRevision: 0 }],
      })
    ).resolves.toMatchObject({ ok: false, code: expectedCode, details: { grantId: GRANT_A } });
  });

  it('leaves every participant unchanged when one grant in a multi-grant claim is replayed', async () => {
    const active = storedGrant(GRANT_A);
    const replayed = storedGrant(GRANT_B, { state: 'claimed', claimedRunId: RUN_C });
    await journal.transaction({
      mutations: [
        { entityKind: 'grant', entityId: GRANT_A, expectedRevision: null, nextManifest: active },
        { entityKind: 'grant', entityId: GRANT_B, expectedRevision: null, nextManifest: replayed },
      ],
    });

    await expect(
      store.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: REQUEST_ID,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'a'.repeat(64),
        grantClaims: [
          { grantId: GRANT_A, expectedRevision: 0 },
          { grantId: GRANT_B, expectedRevision: 0 },
        ],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId: GRANT_B },
    });
    await expect(journal.readCanonical('grant', GRANT_A)).resolves.toEqual(active);
    await expect(journal.readCanonical('grant', GRANT_B)).resolves.toEqual(replayed);
    await expect(files.listEntityIds('run')).resolves.toEqual([]);
  });

  it('lets exactly one different request win a concurrent claim for the same grant', async () => {
    await journal.transaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: storedGrant(GRANT_A),
        },
      ],
    });
    const ids = [RUN_ID, RUN_B];
    const racingStore = new PresentationRunStore({
      files,
      journal,
      now: () => CREATED_AT,
      randomUUID: () => ids.shift() ?? RUN_C,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const allocate = (clientRequestId: string, requestFingerprint: string) =>
      racingStore.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId,
        selectedTemplateId: 'business-review',
        requestFingerprint,
        grantClaims: [{ grantId: GRANT_A, expectedRevision: 0 }],
      });

    const results = await Promise.all([allocate(REQUEST_ID, 'a'.repeat(64)), allocate(RUN_J, 'b'.repeat(64))]);
    const winner = results.find((result) => result.ok);
    const loser = results.find((result) => !result.ok);
    expect(winner).toMatchObject({ ok: true, status: 'created' });
    expect(loser).toMatchObject({ ok: false, code: 'SOURCE_GRANT_REPLAYED', details: { grantId: GRANT_A } });
    if (winner === undefined || !winner.ok) throw new Error('concurrent grant claim had no winner');
    await expect(journal.readCanonical('grant', GRANT_A)).resolves.toMatchObject({
      revision: 1,
      state: 'claimed',
      claimedRunId: winner.run.runId,
    });
    await expect(files.listEntityIds('run')).resolves.toEqual([winner.run.runId]);
  });

  it('rechecks grant expiry at the allocation linearization point after async disk preflight', async () => {
    let clock = CREATED_AT;
    await journal.transaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: storedGrant(GRANT_A, {
            expiresAt: new Date(CREATED_AT.getTime() + 1).toISOString(),
          }),
        },
      ],
    });
    let releaseDisk: () => void = (): void => undefined;
    let markDiskEntered: () => void = (): void => undefined;
    const diskEntered = new Promise<void>((resolve) => {
      markDiskEntered = resolve;
    });
    const diskGate = new Promise<void>((resolve) => {
      releaseDisk = resolve;
    });
    const randomUUID = vi.fn(() => RUN_ID);
    const expiryStore = new PresentationRunStore({
      files,
      journal,
      now: () => clock,
      randomUUID,
      getFreeDiskBytes: async () => {
        markDiskEntered();
        await diskGate;
        return 8 * 1_024 * 1_024 * 1_024;
      },
    });
    const pending = expiryStore.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [{ grantId: GRANT_A, expectedRevision: 0 }],
    });
    await diskEntered;
    clock = new Date(CREATED_AT.getTime() + 1);
    releaseDisk();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_EXPIRED',
      details: { grantId: GRANT_A },
    });
    expect(randomUUID).not.toHaveBeenCalled();
    await expect(journal.readCanonical('grant', GRANT_A)).resolves.toMatchObject({ state: 'active', revision: 0 });
    await expect(files.listEntityIds('run')).resolves.toEqual([]);
  });

  it('enforces revision CAS and replays the exact post-allocation failure envelope', async () => {
    const input = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    };
    const allocated = await store.allocateRun(input);
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    const failure: PresentationRunFailure = {
      ok: false,
      code: 'TEMPLATE_NOT_FOUND',
      messageKey: 'conversation.presentationRun.TEMPLATE_NOT_FOUND',
      retryable: false,
      state: 'preflight',
      details: null,
    };

    await expect(store.recordPostAllocationFailure(RUN_ID, 1, failure)).rejects.toThrow(
      'Presentation run revision conflict'
    );
    const persisted = await store.recordPostAllocationFailure(RUN_ID, 0, failure);
    await expect(store.recordPostAllocationFailure(RUN_ID, 0, structuredClone(failure))).resolves.toEqual(persisted);
    await expect(store.recordPostAllocationFailure(RUN_ID, persisted.revision, failure)).resolves.toEqual(persisted);
    const differentFailure: PresentationRunFailure = {
      ok: false,
      code: 'TEMPLATE_UNSUPPORTED',
      messageKey: 'conversation.presentationRun.TEMPLATE_UNSUPPORTED',
      retryable: false,
      state: 'preflight',
      details: null,
    };
    await expect(store.recordPostAllocationFailure(RUN_ID, persisted.revision, differentFailure)).rejects.toThrow(
      'Presentation post-allocation failure is immutable'
    );
    await expect(journal.readCanonical('run', RUN_ID)).resolves.toEqual(persisted);
    await expect(store.allocateRun(input)).resolves.toEqual(failure);
  });

  it('rejects invalid allocation and post-allocation failure ingress before canonical mutation', async () => {
    const invalidInput = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'not-a-fingerprint',
      grantClaims: [],
    };
    await expect(store.allocateRun(invalidInput)).rejects.toThrow('Presentation canonical run manifest is corrupt');
    await expect(files.listEntityIds('run')).resolves.toEqual([]);

    const allocated = await store.allocateRun({ ...invalidInput, requestFingerprint: 'a'.repeat(64) });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    const malformedExpiredFailure = {
      ok: false,
      code: 'SOURCE_GRANT_EXPIRED',
      messageKey: 'conversation.presentationRun.SOURCE_GRANT_EXPIRED',
      retryable: false,
      state: 'grant_expired',
      details: {},
    } as unknown as PresentationRunFailure;
    await expect(store.recordPostAllocationFailure(RUN_ID, 0, malformedExpiredFailure)).rejects.toThrow(
      'Invalid presentation run failure envelope'
    );
    const malformedConflictFailure = {
      ok: false,
      code: 'RUN_STATE_CONFLICT',
      messageKey: 'conversation.presentationRun.RUN_STATE_CONFLICT',
      retryable: false,
      state: 'lookup',
      details: { runId: RUN_ID, dispatchStatus: 'invented' },
    } as unknown as PresentationRunFailure;
    await expect(store.recordPostAllocationFailure(RUN_ID, 0, malformedConflictFailure)).rejects.toThrow(
      'Invalid presentation run failure envelope'
    );
    await expect(journal.readCanonical('run', RUN_ID)).resolves.toMatchObject({
      revision: 0,
      postAllocationFailure: null,
    });
  });

  it('quarantines canonical expired-grant failures without the required grant ID', async () => {
    const corrupt = storedRun(RUN_ID, 'allocating', {
      postAllocationFailure: {
        ok: false,
        code: 'SOURCE_GRANT_EXPIRED',
        messageKey: 'conversation.presentationRun.SOURCE_GRANT_EXPIRED',
        retryable: false,
        state: 'grant_expired',
        details: {},
      } as unknown as PresentationRunFailure,
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: corrupt }],
    });
    const restarted = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => CREATED_AT }),
      now: () => CREATED_AT,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });

    await restarted.initialize();
    await expect(restarted.getRun(RUN_ID)).resolves.toBeNull();
    await expect(readdir(files.roots.quarantineRoot)).resolves.toEqual([
      expect.stringMatching(new RegExp(`^run-${RUN_ID}-`)),
    ]);
  });

  it('quarantines a canonical run with a non-lowercase request fingerprint', async () => {
    await journal.transaction({
      mutations: [
        {
          entityKind: 'run',
          entityId: RUN_ID,
          expectedRevision: null,
          nextManifest: storedRun(RUN_ID, 'allocating', { requestFingerprint: 'A'.repeat(64) }),
        },
      ],
    });
    const restarted = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => CREATED_AT }),
      now: () => CREATED_AT,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });

    await restarted.initialize();
    await expect(restarted.getRun(RUN_ID)).resolves.toBeNull();
    await expect(readdir(files.roots.quarantineRoot)).resolves.toEqual([
      expect.stringMatching(new RegExp(`^run-${RUN_ID}-`)),
    ]);
  });

  it('recovers an intent-backed staging-to-retained candidate transition after restart', async () => {
    const terminal: StoredPresentationRunManifest = {
      version: 2,
      runId: RUN_ID,
      clientRequestId: REQUEST_ID,
      conversationId: CONVERSATION_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      postAllocationFailure: null,
      revision: 0,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
      statusEnteredAt: CREATED_AT.toISOString(),
      committedAt: CREATED_AT.toISOString(),
      retainedAt: null,
      dispatchStatus: 'terminal_verified',
      artifactPhase: 'sources_extracted',
      disposition: null,
      retainedCandidate: null,
      sourceGrants: [],
      ...exactTerminalLifecycle(),
      retainedBytes: 0,
    };
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: terminal }],
    });
    const layout = await files.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'stable candidate');
    let crashEnabled = false;
    let injected = false;
    const crashingJournal = new PresentationRunJournal({
      files,
      now: () => CREATED_AT,
      failureInjector: (point) => {
        if (crashEnabled && !injected && point.boundary === 'after-intent-fsync') {
          injected = true;
          throw new Error('retain crash');
        }
      },
    });
    const crashingStore = new PresentationRunStore({
      files,
      journal: crashingJournal,
      now: () => CREATED_AT,
      randomUUID: () => RUN_ID,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await crashingStore.initialize();
    crashEnabled = true;

    await expect(crashingStore.retainCandidate(RUN_ID, 0)).rejects.toThrow('retain crash');

    const restarted = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => CREATED_AT }),
      now: () => CREATED_AT,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await restarted.initialize();
    await expect(restarted.getRun(RUN_ID)).resolves.toMatchObject({
      revision: 1,
      artifactPhase: 'candidate_retained',
      retainedCandidate: {
        relativePath: 'retained/candidate.pptx',
        sha256: 'ac080a4e1897afc20d8a16d6567a4c6c56a341443228b8ca72c63565dc7b0050',
        byteLength: 16,
      },
    });
  });

  const candidateRetentionDurabilityCases: {
    boundary: PresentationRunFileDurableBoundary;
    phase: 'preparation' | 'promotion';
  }[] = [
    { boundary: 'before-candidate-temp-write', phase: 'preparation' },
    { boundary: 'after-candidate-temp-write', phase: 'preparation' },
    { boundary: 'before-candidate-temp-fsync', phase: 'preparation' },
    { boundary: 'after-candidate-temp-fsync', phase: 'preparation' },
    { boundary: 'before-candidate-temp-directory-fsync', phase: 'preparation' },
    { boundary: 'after-candidate-temp-directory-fsync', phase: 'preparation' },
    { boundary: 'before-candidate-promotion-rename', phase: 'promotion' },
    { boundary: 'after-candidate-promotion-rename', phase: 'promotion' },
    { boundary: 'before-candidate-promotion-directory-fsync', phase: 'promotion' },
    { boundary: 'after-candidate-promotion-directory-fsync', phase: 'promotion' },
  ];

  it.each(candidateRetentionDurabilityCases)(
    'cleans or recovers candidate retention after the $boundary durability boundary',
    async ({ boundary, phase }) => {
      const terminal = storedRun(RUN_ID, 'terminal_verified', {
        ...exactTerminalLifecycle(),
        clientRequestId: REQUEST_ID,
        requestFingerprint: 'a'.repeat(64),
        artifactPhase: 'sources_extracted',
      });

      const boundaryRoot = path.join(fixtureRoot, `candidate-${boundary}`);
      const boundaryUserData = path.join(boundaryRoot, 'user-data');
      const boundaryTemp = path.join(boundaryRoot, 'system-temp');
      await Promise.all([mkdir(boundaryUserData, { recursive: true }), mkdir(boundaryTemp, { recursive: true })]);
      let enabled = false;
      const boundaryFiles = new PresentationRunFiles({
        userDataDir: boundaryUserData,
        tempDir: boundaryTemp,
        failureInjector: ({ boundary: observed }) => {
          if (enabled && observed === boundary) throw new PresentationRunSimulatedProcessCrashError(boundary);
        },
      });
      const boundaryJournal = new PresentationRunJournal({ files: boundaryFiles, now: () => CREATED_AT });
      await boundaryJournal.transaction({
        mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: terminal }],
      });
      const layout = await boundaryFiles.createRunLayout(RUN_ID);
      await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'stable candidate');
      if (phase === 'preparation') {
        enabled = true;
        await expect(boundaryFiles.prepareRetainedCandidate(RUN_ID)).rejects.toThrow(boundary);
        const orphaned = await readdir(layout.retainedDirectory);
        expect(orphaned).toHaveLength(1);
        expect(orphaned[0]).toMatch(/^\.candidate-.+\.tmp$/);
      } else {
        const prepared = await boundaryFiles.prepareRetainedCandidate(RUN_ID);
        const next: StoredPresentationRunManifest = {
          ...terminal,
          revision: 1,
          artifactPhase: 'candidate_retained',
          retainedCandidate: {
            relativePath: prepared.finalRelativePath,
            sha256: prepared.sha256,
            byteLength: prepared.byteLength,
          },
          retentionProof: {
            stagingBeforeRetain: prepared.stagingBeforeRetain ?? prepared.sha256,
            retainedTemp: prepared.retainedTemp ?? prepared.sha256,
            stagingAfterRetain: prepared.stagingAfterRetain ?? prepared.sha256,
          },
          retainedBytes: prepared.byteLength,
        };
        enabled = true;
        await expect(
          boundaryJournal.transaction({
            retainedCandidatePromotions: [prepared],
            mutations: [
              { entityKind: 'run', entityId: RUN_ID, expectedRevision: terminal.revision, nextManifest: next },
            ],
          })
        ).rejects.toThrow(boundary);
      }

      const restartedFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
      const restarted = new PresentationRunStore({
        files: restartedFiles,
        journal: new PresentationRunJournal({ files: restartedFiles, now: () => CREATED_AT }),
        now: () => CREATED_AT,
        getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      });
      await restarted.initialize();
      const recovered = await restarted.getRun(RUN_ID);
      if (phase === 'preparation') {
        expect(recovered).toMatchObject({
          revision: 0,
          artifactPhase: 'sources_extracted',
          retainedCandidate: null,
          retainedBytes: 0,
        });
        await expect(readdir(layout.retainedDirectory)).resolves.toEqual([]);
      } else {
        expect(recovered).toMatchObject({
          revision: 1,
          artifactPhase: 'candidate_retained',
          retainedBytes: 16,
          retainedCandidate: { relativePath: 'retained/candidate.pptx', byteLength: 16 },
        });
        await expect(readdir(layout.retainedDirectory)).resolves.toEqual(['candidate.pptx']);
      }
    }
  );

  it('rebuilds a missing derived index and quarantines a corrupt canonical run', async () => {
    const input = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    };
    const allocated = await store.allocateRun(input);
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    await rm(files.getIndexPath(), { force: true });

    const rebuilt = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files }),
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await rebuilt.initialize();
    await expect(rebuilt.getByRequest(CONVERSATION_ID, REQUEST_ID)).resolves.toMatchObject({ runId: RUN_ID });

    await writeFile(files.getEntityManifestPath('run', RUN_ID), '{broken\n');
    const quarantining = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files }),
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await quarantining.initialize();
    await expect(quarantining.getRun(RUN_ID)).resolves.toBeNull();
    expect(await readdir(files.roots.quarantineRoot)).toEqual([expect.stringMatching(new RegExp(`^run-${RUN_ID}-`))]);
  });

  it('keeps generic transitions pre-dispatch and requires dedicated dispatch and terminal methods', async () => {
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');

    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: allocated.run.revision,
        dispatchStatus: 'failed_retained',
        disposition: 'TRACKING_REQUIRED',
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');

    const snapshotted = await store.transitionRun(RUN_ID, {
      expectedRevision: allocated.run.revision,
      dispatchStatus: 'allocating',
      artifactPhase: 'sources_snapshotted',
      now: CREATED_AT.toISOString(),
    });

    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: snapshotted.revision,
        dispatchStatus: 'committed',
        artifactPhase: 'sources_extracted',
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');

    const { prepared } = await prepareTask5RunAssets();
    const committed = await store.commitPreparedRun(RUN_ID, snapshotted.revision, prepared);
    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: committed.revision,
        dispatchStatus: 'dispatching',
        postInvoked: true,
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');

    const claimed = await store.claimInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      holderId: RUN_B,
      expectedRevision: committed.revision,
    });
    const dispatching = await store.beginInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      leaseToken: claimed.leaseToken,
      expectedRevision: claimed.manifest.revision,
    });
    await expect(
      store.bindRunTurn(RUN_ID, {
        expectedRevision: dispatching.revision,
        conversationId: CONVERSATION_ID,
        turnId: RUN_C,
        runtime: null as never,
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Invalid presentation binding runtime');
    const first = await store.bindRunTurn(RUN_ID, {
      expectedRevision: dispatching.revision,
      conversationId: CONVERSATION_ID,
      turnId: RUN_C,
      runtime: 'aionrs',
      now: CREATED_AT.toISOString(),
    });
    const replay = await store.bindRunTurn(RUN_ID, {
      expectedRevision: dispatching.revision,
      conversationId: CONVERSATION_ID,
      turnId: RUN_C,
      runtime: 'aionrs',
      now: CREATED_AT.toISOString(),
    });

    expect(first).toMatchObject({ status: 'bound', manifest: { dispatchStatus: 'bound' } });
    expect(replay).toEqual({ status: 'already_bound', manifest: first.manifest });

    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: first.manifest.revision,
        dispatchStatus: 'terminal_verified',
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');
    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: first.manifest.revision,
        dispatchStatus: 'retained',
        disposition: 'TRACKING_REQUIRED',
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');

    const terminal = await store.recordTerminalProof(RUN_ID, first.manifest.revision, {
      conversationId: CONVERSATION_ID,
      turnId: RUN_C,
      eventObservedAt: CREATED_AT.toISOString(),
      runtimeObservedAt: CREATED_AT.toISOString(),
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: false,
        task_status: 'finished',
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
    });
    const advancedReplay = await store.bindRunTurn(RUN_ID, {
      expectedRevision: dispatching.revision,
      conversationId: CONVERSATION_ID,
      turnId: RUN_C,
      runtime: 'aionrs',
      now: CREATED_AT.toISOString(),
    });
    expect(advancedReplay).toEqual({ status: 'already_bound', manifest: terminal });
    await expect(
      store.bindRunTurn(RUN_ID, {
        expectedRevision: terminal.revision,
        conversationId: CONVERSATION_ID,
        turnId: RUN_D,
        runtime: 'aionrs',
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation run is already bound to another turn');
  });

  it('accepts a buffered terminal event observed before binding only after exact binding and released-runtime proof', async () => {
    let clock = CREATED_AT;
    const timedStore = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      randomUUID: () => RUN_ID,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const allocated = await timedStore.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    const snapshotted = await timedStore.transitionRun(RUN_ID, {
      expectedRevision: allocated.run.revision,
      dispatchStatus: 'allocating',
      artifactPhase: 'sources_snapshotted',
      now: clock.toISOString(),
    });
    const { prepared } = await prepareTask5RunAssets();
    const committed = await timedStore.commitPreparedRun(RUN_ID, snapshotted.revision, prepared);
    const claimed = await timedStore.claimInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      holderId: RUN_B,
      expectedRevision: committed.revision,
    });
    const dispatching = await timedStore.beginInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      leaseToken: claimed.leaseToken,
      expectedRevision: claimed.manifest.revision,
    });
    const eventObservedAt = new Date(CREATED_AT.getTime() + 1_000).toISOString();
    const releasedEvidence = {
      conversationId: CONVERSATION_ID,
      turnId: RUN_C,
      eventObservedAt,
      runtimeObservedAt: new Date(CREATED_AT.getTime() + 4_000).toISOString(),
      runtime: {
        state: 'idle' as const,
        can_send_message: true as const,
        has_task: false as const,
        task_status: 'finished' as const,
        is_processing: false as const,
        pending_confirmations: 0 as const,
        turn_id: null,
      },
    };

    await expect(timedStore.recordTerminalProof(RUN_ID, dispatching.revision, releasedEvidence)).rejects.toThrow(
      'RUN_STATE_CONFLICT'
    );

    clock = new Date(CREATED_AT.getTime() + 3_000);
    const bound = await timedStore.bindRunTurn(RUN_ID, {
      expectedRevision: dispatching.revision,
      conversationId: CONVERSATION_ID,
      turnId: RUN_C,
      runtime: 'aionrs',
      now: clock.toISOString(),
    });
    await expect(
      timedStore.recordTerminalProof(RUN_ID, bound.manifest.revision, {
        ...releasedEvidence,
        turnId: RUN_D,
      })
    ).rejects.toThrow();
    await expect(
      timedStore.recordTerminalProof(RUN_ID, bound.manifest.revision, {
        ...releasedEvidence,
        runtime: { ...releasedEvidence.runtime, state: 'active' },
      })
    ).rejects.toThrow();

    clock = new Date(CREATED_AT.getTime() + 4_000);
    const terminal = await timedStore.recordTerminalProof(RUN_ID, bound.manifest.revision, releasedEvidence);

    expect(Date.parse(terminal.terminalEvidence!.eventObservedAt)).toBeLessThan(Date.parse(terminal.binding!.boundAt));
    expect(terminal).toMatchObject({
      dispatchStatus: 'terminal_verified',
      binding: { conversationId: CONVERSATION_ID, turnId: RUN_C },
      terminalEvidence: {
        conversationId: CONVERSATION_ID,
        turnId: RUN_C,
        runtime: { state: 'idle', task_status: 'finished' },
      },
    });
  });

  it('rebuilds an uppercase legacy turn binding for a lowercase runtime-event lookup after restart', async () => {
    const legacyConversationId = CONVERSATION_ID.toUpperCase();
    const legacyRun = storedRun(RUN_ID, 'bound', {
      conversationId: legacyConversationId,
      revision: 0,
      postInvoked: true,
      binding: {
        conversationId: legacyConversationId,
        turnId: RUN_C,
        runtime: 'aionrs',
        boundAt: CREATED_AT.toISOString(),
      },
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: legacyRun }],
    });

    const restarted = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => CREATED_AT }),
      now: () => CREATED_AT,
      randomUUID: () => RUN_B,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });

    await expect(restarted.getRunByTurn(CONVERSATION_ID, RUN_C)).resolves.toMatchObject({
      runId: RUN_ID,
      conversationId: legacyConversationId,
      binding: { conversationId: legacyConversationId, turnId: RUN_C, runtime: 'aionrs' },
    });
  });

  it('rejects null binding runtime as current terminal authority while preserving the readable legacy fallback', async () => {
    const current = storedRun(RUN_ID, 'terminal_verified', {
      ...exactTerminalLifecycle(),
      binding: {
        conversationId: CONVERSATION_ID,
        turnId: REQUEST_ID,
        runtime: null,
        boundAt: CREATED_AT.toISOString(),
      },
    });
    const legacy = storedRun(RUN_B, 'terminal_verified', {
      postInvoked: true,
      binding: {
        conversationId: CONVERSATION_ID,
        turnId: RUN_D,
        runtime: null,
        boundAt: CREATED_AT.toISOString(),
      },
    });
    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: current },
        { entityKind: 'run', entityId: RUN_B, expectedRevision: null, nextManifest: legacy },
      ],
    });

    await store.initialize();

    await expect(store.getRun(RUN_ID)).resolves.toBeNull();
    await expect(store.getRun(RUN_B)).resolves.toMatchObject({
      dispatchStatus: 'terminal_verified',
      binding: { turnId: RUN_D, runtime: null },
    });
    const reconciliation = await store.listTerminalReconciliation();
    expect(reconciliation).toEqual([expect.objectContaining({ runId: RUN_B })]);
    expect(Object.hasOwn(reconciliation[0]!, 'terminalEvidence')).toBe(false);
  });

  it('quarantines current retained candidates without one exact three-hash proof and reconciles the exact record', async () => {
    const candidateHash = 'c'.repeat(64);
    const retainedCandidate = {
      relativePath: 'retained/candidate.pptx' as const,
      sha256: candidateHash,
      byteLength: 4,
    };
    const candidateRun = (runId: string): StoredPresentationRunManifest =>
      storedRun(runId, 'terminal_verified', {
        ...exactTerminalLifecycle(runId),
        artifactPhase: 'candidate_retained',
        retainedCandidate,
        retainedBytes: 4,
      });
    const missingProofBase = candidateRun(RUN_G);
    const { retentionProof: _missingProof, ...missingProof } = missingProofBase;
    const nullProof = candidateRun(RUN_H);
    const mismatchedProof = {
      ...candidateRun(RUN_I),
      retentionProof: {
        stagingBeforeRetain: candidateHash,
        retainedTemp: candidateHash,
        stagingAfterRetain: 'd'.repeat(64),
      },
    };
    const exactProof = {
      ...candidateRun(RUN_J),
      retentionProof: {
        stagingBeforeRetain: candidateHash,
        retainedTemp: candidateHash,
        stagingAfterRetain: candidateHash,
      },
    };
    await files.initialize();
    await Promise.all([RUN_G, RUN_H, RUN_I, RUN_J].map((runId) => files.createRunLayout(runId)));
    await Promise.all(
      [missingProof, nullProof, mismatchedProof, exactProof].map((manifest) =>
        writeFile(files.getEntityManifestPath('run', manifest.runId), `${JSON.stringify(manifest)}\n`, 'utf8')
      )
    );

    await store.initialize();

    await expect(store.getRun(RUN_G)).resolves.toBeNull();
    await expect(store.getRun(RUN_H)).resolves.toBeNull();
    await expect(store.getRun(RUN_I)).resolves.toBeNull();
    await expect(store.getRun(RUN_J)).resolves.toMatchObject({
      artifactPhase: 'candidate_retained',
      retentionProof: {
        stagingBeforeRetain: candidateHash,
        retainedTemp: candidateHash,
        stagingAfterRetain: candidateHash,
      },
    });
    await expect(store.listTerminalReconciliation()).resolves.toEqual([expect.objectContaining({ runId: RUN_J })]);
  });

  it('keeps a terminal candidate recoverable when it becomes failed review-required', async () => {
    const terminal = storedRun(RUN_ID, 'terminal_verified', {
      ...exactTerminalLifecycle(),
      clientRequestId: REQUEST_ID,
      requestFingerprint: 'a'.repeat(64),
      artifactPhase: 'sources_extracted',
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: terminal }],
    });
    const layout = await files.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'x'.repeat(42));
    const retained = await store.retainCandidate(RUN_ID, 0);

    const failed = await store.settleReadinessFailure(RUN_ID, retained.revision, {
      status: 'error',
      recordedAt: '2026-08-04T00:00:01.000Z',
      code: 'INSPECTION_FAILED',
    });

    expect(failed).toMatchObject({
      revision: 2,
      dispatchStatus: 'failed_retained',
      artifactPhase: 'candidate_retained',
      disposition: 'REVIEW_REQUIRED',
      retainedCandidate: retained.retainedCandidate,
    });
    await expect(store.listPublicRecoverable(CONVERSATION_ID)).resolves.toEqual([failed]);
  });

  it('separates the exact public recovery set from internal dispatch and terminal reconciliation scans', async () => {
    const binding = {
      conversationId: CONVERSATION_ID,
      turnId: 'turn-1',
      runtime: 'aionrs' as const,
      boundAt: CREATED_AT.toISOString(),
    };
    const manifests = [
      storedRun(RUN_ID, 'retained', {
        disposition: 'TRACKING_REQUIRED',
        postInvoked: true,
        binding,
      }),
      storedRun(RUN_B, 'failed_retained', { disposition: 'TRACKING_REQUIRED' }),
      storedRun(RUN_C, 'dispatch_uncertain', {
        disposition: 'TRACKING_REQUIRED',
        postInvoked: true,
      }),
      storedRun(RUN_D, 'dispatching', { postInvoked: true }),
      storedRun(RUN_E, 'bound', { postInvoked: true, binding: { ...binding, turnId: 'turn-2' } }),
      storedRun(RUN_F, 'terminal_verified', { postInvoked: true, binding: { ...binding, turnId: 'turn-3' } }),
    ];
    await journal.transaction({
      mutations: manifests.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });

    await store.initialize();
    expect((await store.listPublicRecoverable(CONVERSATION_ID)).map(({ runId }) => runId).toSorted()).toEqual(
      [RUN_ID, RUN_B, RUN_C].toSorted()
    );
    expect((await store.listDispatchReconciliation()).map(({ runId }) => runId).toSorted()).toEqual(
      [RUN_D, RUN_E].toSorted()
    );
    expect((await store.listTerminalReconciliation()).map(({ runId }) => runId)).toEqual([RUN_F]);
    expect((await store.listCommittedForInitialDispatch()).map(({ runId }) => runId)).toEqual([]);
  });

  it('returns frozen defensive snapshots instead of exposing mutable cache entries', async () => {
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');

    expect(Object.isFrozen(allocated.run)).toBe(true);
    expect(Object.isFrozen(allocated.run.sourceGrants)).toBe(true);
    expect(() => {
      allocated.run.selectedTemplateId = 'mutated';
    }).toThrow();
    const fetched = await store.getRun(RUN_ID);
    expect(fetched).not.toBe(allocated.run);
    expect(fetched).toMatchObject({ selectedTemplateId: 'business-review' });
    expect(Object.isFrozen(fetched)).toBe(true);
  });

  it('rejects stale candidate retention before copying and cleans a pre-intent temp durably', async () => {
    const terminal = storedRun(RUN_ID, 'terminal_verified', {
      ...exactTerminalLifecycle(),
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: terminal }],
    });
    const layout = await files.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'stable candidate');
    await store.initialize();

    await expect(store.retainCandidate(RUN_ID, 99)).rejects.toThrow('Presentation run revision conflict');
    expect(await readdir(layout.retainedDirectory)).toEqual([]);

    let failIntent = true;
    const crashingJournal = new PresentationRunJournal({
      files,
      now: () => CREATED_AT,
      failureInjector: ({ boundary }) => {
        if (failIntent && boundary === 'before-intent-append') throw new Error('intent unavailable');
      },
    });
    const crashingStore = new PresentationRunStore({
      files,
      journal: crashingJournal,
      now: () => CREATED_AT,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const sync = vi.spyOn(files, 'syncOwnedDirectory');
    await crashingStore.initialize();

    await expect(crashingStore.retainCandidate(RUN_ID, 0)).rejects.toThrow('intent unavailable');
    expect(await readdir(layout.retainedDirectory)).toEqual([]);
    expect(sync).toHaveBeenCalledWith(layout.retainedDirectory);
    failIntent = false;
  });

  it('recovers journal and cache health even when pre-intent temp cleanup throws', async () => {
    const terminal = storedRun(RUN_ID, 'terminal_verified', {
      ...exactTerminalLifecycle(),
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: terminal }],
    });
    const layout = await files.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), 'stable candidate');
    let failIntent = true;
    const crashingJournal = new PresentationRunJournal({
      files,
      now: () => CREATED_AT,
      failureInjector: ({ boundary }) => {
        if (failIntent && boundary === 'before-intent-append') {
          failIntent = false;
          throw new Error('intent unavailable');
        }
      },
    });
    const recoveringStore = new PresentationRunStore({
      files,
      journal: crashingJournal,
      now: () => CREATED_AT,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await recoveringStore.initialize();
    vi.spyOn(files, 'removePreparedRetainedCandidate').mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(recoveringStore.retainCandidate(RUN_ID, 0)).rejects.toThrow('cleanup failed');
    await expect(recoveringStore.settleTerminalFailure(RUN_ID, 0, 'RETENTION_FAILED')).resolves.toMatchObject({
      dispatchStatus: 'failed_retained',
      revision: 1,
    });
  });

  it('rechecks prepared candidate bytes against quotas and removes the temp on a staging replacement race', async () => {
    const terminal = storedRun(RUN_ID, 'terminal_verified', {
      ...exactTerminalLifecycle(),
      retainedBytes: 640 * 1_024 * 1_024 - 5,
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: terminal }],
    });
    const layout = await files.createRunLayout(RUN_ID);
    const stagingCandidate = path.join(layout.stagingDirectory, 'candidate.pptx');
    await writeFile(stagingCandidate, 'x');
    const originalPrepare = files.prepareRetainedCandidate.bind(files);
    vi.spyOn(files, 'prepareRetainedCandidate').mockImplementationOnce(async (runId) => {
      await writeFile(stagingCandidate, '0123456789');
      return originalPrepare(runId);
    });
    await store.initialize();

    await expect(store.retainCandidate(RUN_ID, 0)).rejects.toThrow('Presentation retained resource limit exceeded');
    expect(await readdir(layout.retainedDirectory)).toEqual([]);
    await expect(store.getRun(RUN_ID)).resolves.toMatchObject({
      revision: 0,
      artifactPhase: 'sources_extracted',
      retainedCandidate: null,
    });
  });

  it('propagates storage I/O and temp-cleanup failures instead of quarantining valid canonical state', async () => {
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');

    const ioJournal = new PresentationRunJournal({ files });
    vi.spyOn(ioJournal, 'readCanonical').mockRejectedValueOnce(
      Object.assign(new Error('read I/O failed'), { code: 'EIO' })
    );
    const ioStore = new PresentationRunStore({
      files,
      journal: ioJournal,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await expect(ioStore.initialize()).rejects.toThrow('read I/O failed');
    expect(await readdir(files.roots.quarantineRoot)).toEqual([]);

    const cleanupFiles = new PresentationRunFiles({ userDataDir, tempDir: systemTempDir });
    vi.spyOn(cleanupFiles, 'removeUnreferencedCandidateTemps').mockRejectedValueOnce(
      Object.assign(new Error('cleanup I/O failed'), { code: 'EIO' })
    );
    const cleanupStore = new PresentationRunStore({
      files: cleanupFiles,
      journal: new PresentationRunJournal({ files: cleanupFiles }),
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await expect(cleanupStore.initialize()).rejects.toThrow('cleanup I/O failed');
    expect(await readdir(files.roots.quarantineRoot)).toEqual([]);
  });

  it('enforces one canonical owner for each conversation turn', async () => {
    const dispatching = [RUN_ID, RUN_B].map((runId) => storedRun(runId, 'dispatching', { postInvoked: true }));
    await journal.transaction({
      mutations: dispatching.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    await store.initialize();
    const binding = {
      expectedRevision: 0,
      conversationId: CONVERSATION_ID,
      turnId: 'turn-shared',
      runtime: 'aionrs' as const,
      now: '2026-08-04T00:00:01.000Z',
    };

    const results = await Promise.allSettled([store.bindRunTurn(RUN_ID, binding), store.bindRunTurn(RUN_B, binding)]);

    expect(results.map(({ status }) => status).toSorted()).toEqual(['fulfilled', 'rejected']);
    const fulfilled = results.find((result) => result.status === 'fulfilled');
    if (fulfilled?.status !== 'fulfilled') throw new Error('binding unexpectedly failed');
    expect(fulfilled.value.manifest).toEqual(
      expect.objectContaining({
        preparation: null,
        initialDispatchLease: null,
        terminalEvidence: null,
        runtimeReleaseObservations: [],
        retentionProof: null,
        readiness: null,
      })
    );
  });

  it('keeps valid conversation turn tuples separate when turn identifiers contain the old delimiter', async () => {
    const dispatching = [
      storedRun(RUN_ID, 'dispatching', { conversationId: CONVERSATION_ID, postInvoked: true }),
      storedRun(RUN_B, 'dispatching', { conversationId: CONVERSATION_B, postInvoked: true }),
    ];
    await journal.transaction({
      mutations: dispatching.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    await store.initialize();

    await expect(
      store.bindRunTurn(RUN_ID, {
        expectedRevision: 0,
        conversationId: CONVERSATION_ID,
        turnId: 'b\u0000c',
        runtime: 'aionrs',
        now: '2026-08-04T00:00:01.000Z',
      })
    ).resolves.toMatchObject({ status: 'bound' });
    await expect(
      store.bindRunTurn(RUN_B, {
        expectedRevision: 0,
        conversationId: CONVERSATION_B,
        turnId: 'c',
        runtime: 'aionrs',
        now: '2026-08-04T00:00:01.000Z',
      })
    ).resolves.toMatchObject({ status: 'bound' });

    const restarted = new PresentationRunStore({
      files,
      journal,
      now: () => CREATED_AT,
      randomUUID: () => RUN_C,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await expect(restarted.initialize()).resolves.toBeUndefined();
  });

  it('does not let generic lifecycle transitions bypass turn ownership', async () => {
    const dispatching = storedRun(RUN_ID, 'dispatching', { postInvoked: true });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: dispatching }],
    });
    await store.initialize();

    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: 0,
        dispatchStatus: 'bound',
        binding: {
          conversationId: CONVERSATION_ID,
          turnId: 'turn-bypass',
          runtime: 'aionrs',
          boundAt: CREATED_AT.toISOString(),
        },
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');
  });

  it('does not let generic lifecycle transitions authorize fabricated retained bytes', async () => {
    const terminal = storedRun(RUN_ID, 'terminal_verified', {
      binding: {
        conversationId: CONVERSATION_ID,
        turnId: 'turn-1',
        runtime: 'aionrs',
        boundAt: CREATED_AT.toISOString(),
      },
      postInvoked: true,
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: terminal }],
    });
    await store.initialize();

    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: 0,
        dispatchStatus: 'terminal_verified',
        artifactPhase: 'candidate_retained',
        retainedCandidate: {
          relativePath: 'retained/candidate.pptx',
          sha256: 'a'.repeat(64),
          byteLength: 12,
        },
        now: CREATED_AT.toISOString(),
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');
  });

  it('does not let generic lifecycle transitions bypass canonical tombstone discard', async () => {
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');

    await expect(
      store.transitionRun(RUN_ID, {
        expectedRevision: 0,
        dispatchStatus: 'discarded',
        now: '2026-08-04T00:00:01.000Z',
      })
    ).rejects.toThrow('Presentation lifecycle mutation requires a dedicated store method');
    await expect(journal.readCanonical('run-tombstone', RUN_ID)).resolves.toBeNull();
  });

  it('quarantines strict schema corruption including unknown failure envelopes', async () => {
    const invalid = storedRun(RUN_ID, 'allocating', {
      postAllocationFailure: {
        ok: false,
        code: 'INVENTED',
        messageKey: 'wrong',
        retryable: true,
        state: 'wrong',
        details: {},
      } as unknown as PresentationRunFailure,
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: invalid }],
    });

    await store.initialize();

    await expect(store.getRun(RUN_ID)).resolves.toBeNull();
    expect(await readdir(files.roots.quarantineRoot)).toEqual([expect.stringMatching(new RegExp(`^run-${RUN_ID}-`))]);
  });

  it('quarantines a tombstone with malformed nested canonical state', async () => {
    await files.initialize();
    await writeFile(
      files.getEntityManifestPath('run-tombstone', RUN_ID),
      `${JSON.stringify({
        version: 2,
        tombstoneType: 'presentation-run',
        revision: 0,
        runId: RUN_ID,
        tombstonedAt: CREATED_AT.toISOString(),
        discardedRun: null,
      })}\n`,
      'utf8'
    );

    await store.initialize();

    await expect(store.getRun(RUN_ID)).resolves.toBeNull();
    expect(await readdir(files.roots.quarantineRoot)).toEqual([
      expect.stringMatching(new RegExp(`^run-tombstone-${RUN_ID}-`)),
    ]);
  });

  it('recovers and fully rescans canonical state before serving after a partial multi-entity intent', async () => {
    const grants = [GRANT_A, GRANT_B].map((grantId) => ({
      version: 2 as const,
      grantId,
      ownerKey: `conversation:${CONVERSATION_ID}`,
      revision: 0,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
      expiresAt: '2026-08-04T00:15:00.000Z',
      state: 'active' as const,
      byteLength: 12,
      claimedRunId: null,
    }));
    await journal.transaction({
      mutations: grants.map((grant) => ({
        entityKind: 'grant' as const,
        entityId: grant.grantId,
        expectedRevision: null,
        nextManifest: grant,
      })),
    });
    let injected = false;
    const crashingJournal = new PresentationRunJournal({
      files,
      now: () => CREATED_AT,
      failureInjector: ({ boundary, mutationIndex }) => {
        if (!injected && boundary === 'after-manifest-rename' && mutationIndex === 1) {
          injected = true;
          throw new Error('partial store intent');
        }
      },
    });
    const recoveringStore = new PresentationRunStore({
      files,
      journal: crashingJournal,
      now: () => CREATED_AT,
      randomUUID: () => RUN_ID,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const input = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: grants.map(({ grantId }) => ({ grantId, expectedRevision: 0 })),
    };

    await expect(recoveringStore.allocateRun(input)).rejects.toThrow('partial store intent');
    await expect(recoveringStore.getRun(RUN_ID)).resolves.toMatchObject({ runId: RUN_ID, revision: 0 });
    await expect(recoveringStore.listPublicRecoverable(CONVERSATION_ID)).resolves.toEqual([]);
    await expect(recoveringStore.allocateRun(input)).resolves.toMatchObject({
      ok: true,
      status: 'existing',
      run: { runId: RUN_ID },
    });
    await expect(crashingJournal.readCanonical('grant', GRANT_A)).resolves.toMatchObject({
      state: 'claimed',
      claimedRunId: RUN_ID,
    });
    await expect(crashingJournal.readCanonical('grant', GRANT_B)).resolves.toMatchObject({
      state: 'claimed',
      claimedRunId: RUN_ID,
    });
  });

  it('returns the committed allocation and rebuilds after every derived-index failure boundary', async () => {
    const boundaries: PresentationRunDurableBoundary[] = [
      'before-index-write',
      'after-index-write',
      'before-index-fsync',
      'after-index-fsync',
      'before-index-rename',
      'after-index-rename',
      'before-index-directory-fsync',
      'after-index-directory-fsync',
    ];
    const input = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    };

    for (const boundary of boundaries) {
      const boundaryRoot = path.join(fixtureRoot, boundary);
      const boundaryUserData = path.join(boundaryRoot, 'user-data');
      const boundaryTemp = path.join(boundaryRoot, 'system-temp');
      await Promise.all([mkdir(boundaryUserData, { recursive: true }), mkdir(boundaryTemp, { recursive: true })]);
      const boundaryFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
      let enabled = false;
      let injected = false;
      const boundaryJournal = new PresentationRunJournal({
        files: boundaryFiles,
        now: () => CREATED_AT,
        failureInjector: ({ boundary: observed }) => {
          if (enabled && !injected && observed === boundary) {
            injected = true;
            throw new Error(`index crash:${boundary}`);
          }
        },
      });
      const boundaryStore = new PresentationRunStore({
        files: boundaryFiles,
        journal: boundaryJournal,
        now: () => CREATED_AT,
        randomUUID: () => RUN_ID,
        getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      });
      await boundaryStore.initialize();
      enabled = true;

      await expect(boundaryStore.allocateRun(input)).resolves.toMatchObject({
        ok: true,
        status: 'created',
        run: { runId: RUN_ID },
      });

      const restarted = new PresentationRunStore({
        files: boundaryFiles,
        journal: new PresentationRunJournal({ files: boundaryFiles, now: () => CREATED_AT }),
        now: () => CREATED_AT,
        getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      });
      await expect(restarted.allocateRun(input)).resolves.toMatchObject({
        ok: true,
        status: 'existing',
        run: { runId: RUN_ID },
      });
      expect(await boundaryFiles.listEntityIds('run')).toEqual([RUN_ID]);
    }
  });

  it('snapshots mutable allocation and lifecycle inputs before the first await', async () => {
    await store.initialize();
    const input = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [] as { grantId: string; expectedRevision: number }[],
    };
    const allocation = store.allocateRun(input);
    input.requestFingerprint = 'b'.repeat(64);
    input.grantClaims.push({ grantId: GRANT_A, expectedRevision: 0 });
    const allocated = await allocation;
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    expect(allocated.run).toMatchObject({ requestFingerprint: 'a'.repeat(64), sourceGrants: [] });

    const transition = {
      expectedRevision: 0,
      dispatchStatus: 'allocating' as const,
      artifactPhase: 'sources_snapshotted' as const,
      now: '2026-08-04T00:00:01.000Z',
    };
    const transitioning = store.transitionRun(RUN_ID, transition);
    Object.assign(transition, {
      dispatchStatus: 'bound',
      artifactPhase: 'candidate_retained',
    });
    await expect(transitioning).resolves.toMatchObject({
      dispatchStatus: 'allocating',
      artifactPhase: 'sources_snapshotted',
    });
  });

  it('snapshots mutable binding and failure inputs before the first await', async () => {
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    const snapshotted = await store.transitionRun(RUN_ID, {
      expectedRevision: 0,
      dispatchStatus: 'allocating',
      artifactPhase: 'sources_snapshotted',
      now: CREATED_AT.toISOString(),
    });
    const { prepared } = await prepareTask5RunAssets();
    const committed = await store.commitPreparedRun(RUN_ID, snapshotted.revision, prepared);
    const claimed = await store.claimInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      holderId: RUN_B,
      expectedRevision: committed.revision,
    });
    const dispatching = await store.beginInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      leaseToken: claimed.leaseToken,
      expectedRevision: claimed.manifest.revision,
    });
    const binding = {
      expectedRevision: dispatching.revision,
      conversationId: CONVERSATION_ID,
      turnId: 'turn-original',
      runtime: 'aionrs' as const,
      now: CREATED_AT.toISOString(),
    };
    const bindingPromise = store.bindRunTurn(RUN_ID, binding);
    binding.turnId = 'turn-mutated';
    const bound = await bindingPromise;
    expect(bound).toMatchObject({
      manifest: { binding: { turnId: 'turn-original' } },
    });

    const failure: PresentationRunFailure = {
      ok: false,
      code: 'TRACKING_REQUIRED',
      messageKey: 'conversation.presentationRun.TRACKING_REQUIRED',
      retryable: false,
      state: 'bound',
      details: { runId: RUN_ID },
    };
    const failurePromise = store.recordPostAllocationFailure(RUN_ID, bound.manifest.revision, failure);
    (failure.details as { runId: string }).runId = RUN_B;
    await expect(failurePromise).resolves.toMatchObject({
      postAllocationFailure: { details: { runId: RUN_ID } },
    });
  });

  it('sweeps exact lifecycle TTL boundaries and never deletes uncertain dispatches', async () => {
    const boundaryClock = new Date('2026-09-10T00:00:00.000Z');
    let clock = new Date(boundaryClock.getTime() - 1);
    const nowMs = boundaryClock.getTime();
    const at = (milliseconds: number): string => new Date(nowMs - milliseconds).toISOString();
    const candidate = {
      relativePath: 'retained/candidate.pptx',
      sha256: 'a'.repeat(64),
      byteLength: 12,
    };
    const binding = (runId: string) => ({
      conversationId: CONVERSATION_ID,
      turnId: `turn-${runId}`,
      runtime: 'aionrs' as const,
      boundAt: at(8 * 24 * 60 * 60_000),
    });
    const manifests: StoredPresentationRunManifest[] = [
      storedRun(RUN_ID, 'allocating', {
        createdAt: at(10 * 60_000 - 1),
        statusEnteredAt: at(10 * 60_000 - 1),
        updatedAt: clock.toISOString(),
        artifactPhase: 'none',
        committedAt: null,
      }),
      storedRun(RUN_B, 'allocating', {
        createdAt: at(10 * 60_000),
        statusEnteredAt: at(10 * 60_000),
        updatedAt: clock.toISOString(),
        artifactPhase: 'none',
        committedAt: null,
      }),
      storedRun(RUN_C, 'committed', {
        createdAt: at(25 * 60 * 60_000),
        committedAt: at(24 * 60 * 60_000 - 1),
        statusEnteredAt: at(24 * 60 * 60_000 - 1),
        updatedAt: clock.toISOString(),
      }),
      storedRun(RUN_D, 'committed', {
        createdAt: at(25 * 60 * 60_000),
        committedAt: at(24 * 60 * 60_000),
        statusEnteredAt: at(24 * 60 * 60_000),
        updatedAt: clock.toISOString(),
      }),
      storedRun(RUN_E, 'retained', {
        createdAt: at(8 * 24 * 60 * 60_000),
        committedAt: at(8 * 24 * 60 * 60_000),
        retainedAt: at(7 * 24 * 60 * 60_000 - 1),
        statusEnteredAt: at(7 * 24 * 60 * 60_000 - 1),
        updatedAt: clock.toISOString(),
        artifactPhase: 'ooxml_inspected',
        disposition: 'REVIEW_REQUIRED',
        retainedCandidate: candidate,
        binding: binding(RUN_E),
        postInvoked: true,
        retainedBytes: 12,
      }),
      storedRun(RUN_F, 'retained', {
        createdAt: at(8 * 24 * 60 * 60_000),
        committedAt: at(8 * 24 * 60 * 60_000),
        retainedAt: at(7 * 24 * 60 * 60_000),
        statusEnteredAt: at(7 * 24 * 60 * 60_000),
        updatedAt: clock.toISOString(),
        artifactPhase: 'ooxml_inspected',
        disposition: 'REVIEW_REQUIRED',
        retainedCandidate: candidate,
        binding: binding(RUN_F),
        postInvoked: true,
        retainedBytes: 12,
      }),
      storedRun(RUN_G, 'failed_retained', {
        createdAt: at(8 * 24 * 60 * 60_000),
        committedAt: null,
        retainedAt: at(7 * 24 * 60 * 60_000),
        statusEnteredAt: at(7 * 24 * 60 * 60_000),
        updatedAt: clock.toISOString(),
        artifactPhase: 'sources_extracted',
        disposition: 'TRACKING_REQUIRED',
      }),
      storedRun(RUN_H, 'retained', {
        createdAt: at(8 * 24 * 60 * 60_000),
        committedAt: at(8 * 24 * 60 * 60_000),
        retainedAt: at(7 * 24 * 60 * 60_000),
        statusEnteredAt: at(7 * 24 * 60 * 60_000),
        updatedAt: clock.toISOString(),
        artifactPhase: 'sources_extracted',
        disposition: 'TRACKING_REQUIRED',
        binding: binding(RUN_H),
        postInvoked: true,
      }),
      storedRun(RUN_I, 'dispatch_uncertain', {
        createdAt: at(32 * 24 * 60 * 60_000),
        committedAt: at(32 * 24 * 60 * 60_000),
        statusEnteredAt: at(31 * 24 * 60 * 60_000),
        updatedAt: clock.toISOString(),
        disposition: 'TRACKING_REQUIRED',
        postInvoked: true,
      }),
      storedRun(RUN_J, 'failed_retained', {
        createdAt: at(8 * 24 * 60 * 60_000),
        committedAt: at(8 * 24 * 60 * 60_000),
        retainedAt: at(7 * 24 * 60 * 60_000),
        statusEnteredAt: at(7 * 24 * 60 * 60_000),
        updatedAt: clock.toISOString(),
        artifactPhase: 'ooxml_inspected',
        disposition: 'REVIEW_REQUIRED',
        retainedCandidate: candidate,
        binding: binding(RUN_J),
        postInvoked: true,
        retainedBytes: 12,
      }),
    ];
    await journal.transaction({
      mutations: manifests.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    const sweepingStore = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });

    await sweepingStore.initialize();
    clock = boundaryClock;
    const swept = await sweepingStore.sweepExpiredRuns();

    expect(swept.failedRetained.toSorted()).toEqual([RUN_B, RUN_D].toSorted());
    expect(swept.tombstoned.toSorted()).toEqual([RUN_F, RUN_G, RUN_H, RUN_J].toSorted());
    expect(swept.operatorAlerts).toEqual([RUN_I]);
    await expect(sweepingStore.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'allocating' });
    await expect(sweepingStore.getRun(RUN_C)).resolves.toMatchObject({ dispatchStatus: 'committed' });
    await expect(sweepingStore.getRun(RUN_E)).resolves.toMatchObject({ dispatchStatus: 'retained' });
    await expect(sweepingStore.getRun(RUN_I)).resolves.toMatchObject({ dispatchStatus: 'dispatch_uncertain' });
    await expect(sweepingStore.getRun(RUN_F)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
  });

  it('commits tombstone before deletion, completes cleanup on restart, blocks replay, and purges at exactly seven days', async () => {
    let clock = new Date('2026-09-10T00:00:00.000Z');
    const ids = [RUN_ID, RUN_B, RUN_C];
    const tombstoneStore = new PresentationRunStore({
      files,
      journal,
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_L,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const input = {
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    };
    const allocated = await tombstoneStore.allocateRun(input);
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    const originalRemoveRun = files.removeRun.bind(files);
    vi.spyOn(files, 'removeRun').mockImplementationOnce(async (runId) => {
      await expect(journal.readCanonical('run-tombstone', runId)).resolves.toMatchObject({
        discardedRun: { dispatchStatus: 'discarded' },
      });
      throw new Error('simulated delete crash');
    });

    await expect(tombstoneStore.discardRun(RUN_ID, 0)).rejects.toThrow('simulated delete crash');
    await expect(journal.readCanonical('run-tombstone', RUN_ID)).resolves.toMatchObject({
      runId: RUN_ID,
      discardedRun: { dispatchStatus: 'discarded' },
    });
    expect(await files.listEntityIds('run')).toContain(RUN_ID);
    await expect(tombstoneStore.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
    await expect(tombstoneStore.discardRun(RUN_ID, 0)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
    expect(await files.listEntityIds('run')).not.toContain(RUN_ID);
    await expect(tombstoneStore.allocateRun({ ...input, requestFingerprint: 'b'.repeat(64) })).resolves.toMatchObject({
      ok: false,
      code: 'REQUEST_COLLISION',
      details: { existingRunId: RUN_ID },
    });
    vi.mocked(files.removeRun).mockImplementation(originalRemoveRun);

    const restarted = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_L,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    await restarted.initialize();
    expect(await files.listEntityIds('run')).not.toContain(RUN_ID);
    await expect(restarted.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
    await expect(restarted.allocateRun(input)).resolves.toMatchObject({
      ok: true,
      status: 'existing',
      run: { runId: RUN_ID, dispatchStatus: 'discarded' },
    });

    clock = new Date(clock.getTime() + 7 * 24 * 60 * 60_000 - 1);
    await expect(restarted.sweepExpiredRuns()).resolves.toMatchObject({ purgedTombstones: [] });
    await expect(restarted.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
    clock = new Date(clock.getTime() + 1);
    await expect(restarted.sweepExpiredRuns()).resolves.toMatchObject({ purgedTombstones: [RUN_ID] });
    await expect(restarted.getRun(RUN_ID)).resolves.toBeNull();
    await expect(restarted.allocateRun(input)).resolves.toMatchObject({
      ok: true,
      status: 'created',
      run: { runId: RUN_B },
    });
  });

  it('does not purge a tombstone until same-process owned cleanup succeeds', async () => {
    let clock = new Date('2026-09-10T00:00:00.000Z');
    const cleanupStore = new PresentationRunStore({
      files,
      journal,
      now: () => clock,
      randomUUID: () => RUN_ID,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const allocated = await cleanupStore.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    const originalRemoveRun = files.removeRun.bind(files);
    vi.spyOn(files, 'removeRun').mockRejectedValue(new Error('cleanup unavailable'));

    await expect(cleanupStore.discardRun(RUN_ID, 0)).rejects.toThrow('cleanup unavailable');
    clock = new Date(clock.getTime() + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS);
    await expect(cleanupStore.sweepExpiredRuns()).rejects.toThrow('cleanup unavailable');
    await expect(cleanupStore.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
    await expect(journal.readCanonical('run-tombstone', RUN_ID)).resolves.toMatchObject({ runId: RUN_ID });

    vi.mocked(files.removeRun).mockImplementation(originalRemoveRun);
    await expect(cleanupStore.sweepExpiredRuns()).resolves.toMatchObject({ purgedTombstones: [RUN_ID] });
    await expect(cleanupStore.getRun(RUN_ID)).resolves.toBeNull();
    await expect(files.listEntityIds('run')).resolves.toEqual([]);
  });

  it('retries immutable claimed-grant cleanup without deleting unrelated grant directories', async () => {
    await journal.transaction({
      mutations: [
        { entityKind: 'grant', entityId: GRANT_A, expectedRevision: null, nextManifest: storedGrant(GRANT_A) },
        { entityKind: 'grant', entityId: GRANT_B, expectedRevision: null, nextManifest: storedGrant(GRANT_B) },
      ],
    });
    const grantStore = new PresentationRunStore({
      files,
      journal,
      now: () => CREATED_AT,
      randomUUID: () => RUN_ID,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    });
    const allocated = await grantStore.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [{ grantId: GRANT_A, expectedRevision: 0 }],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    const originalRemoveGrant = files.removeGrant.bind(files);
    vi.spyOn(files, 'removeGrant').mockRejectedValueOnce(new Error('grant cleanup unavailable'));

    await expect(grantStore.discardRun(RUN_ID, 0)).rejects.toThrow('grant cleanup unavailable');
    await expect(grantStore.getRun(RUN_ID)).resolves.toMatchObject({
      dispatchStatus: 'discarded',
      sourceGrants: [GRANT_A],
    });
    expect((await files.listEntityIds('grant')).toSorted()).toEqual([GRANT_A, GRANT_B].toSorted());

    vi.mocked(files.removeGrant).mockImplementation(originalRemoveGrant);
    await expect(grantStore.discardRun(RUN_ID, 0)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
    expect(await files.listEntityIds('grant')).toEqual([GRANT_B]);
    await expect(files.listEntityIds('run')).resolves.toEqual([]);
  });

  const tombstoneDurabilityCases: {
    boundary: PresentationRunDurableBoundary;
    expectedOutcome: 'old' | 'new' | 'either';
    mutationIndex?: number;
    suffix: string;
  }[] = [
    { boundary: 'before-intent-append', expectedOutcome: 'old', suffix: 'before-intent-append-journal' },
    { boundary: 'after-intent-append', expectedOutcome: 'either', suffix: 'after-intent-append-journal' },
    { boundary: 'before-intent-fsync', expectedOutcome: 'either', suffix: 'before-intent-fsync-journal' },
    { boundary: 'after-intent-fsync', expectedOutcome: 'new', suffix: 'after-intent-fsync-journal' },
    { boundary: 'before-commit-append', expectedOutcome: 'new', suffix: 'before-commit-append-journal' },
    { boundary: 'after-commit-append', expectedOutcome: 'new', suffix: 'after-commit-append-journal' },
    { boundary: 'before-commit-fsync', expectedOutcome: 'new', suffix: 'before-commit-fsync-journal' },
    { boundary: 'after-commit-fsync', expectedOutcome: 'new', suffix: 'after-commit-fsync-journal' },
    ...(
      [
        'before-manifest-write',
        'after-manifest-write',
        'before-manifest-fsync',
        'after-manifest-fsync',
        'before-manifest-rename',
        'after-manifest-rename',
        'before-manifest-directory-fsync',
        'after-manifest-directory-fsync',
      ] satisfies PresentationRunDurableBoundary[]
    ).flatMap((boundary) =>
      [0, 1].map((mutationIndex) => ({
        boundary,
        mutationIndex,
        expectedOutcome: 'new' as const,
        suffix: `${boundary}-${mutationIndex}`,
      }))
    ),
  ];

  it.each(tombstoneDurabilityCases)(
    'recovers an atomic run tombstone after the $suffix durability boundary',
    async (boundaryCase) => {
      const { suffix } = boundaryCase;
      const boundaryRoot = path.join(fixtureRoot, `tombstone-${suffix}`);
      const boundaryUserData = path.join(boundaryRoot, 'user-data');
      const boundaryTemp = path.join(boundaryRoot, 'system-temp');
      await Promise.all([mkdir(boundaryUserData, { recursive: true }), mkdir(boundaryTemp, { recursive: true })]);
      const boundaryFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
      let enabled = false;
      const boundaryJournal = new PresentationRunJournal({
        files: boundaryFiles,
        now: () => CREATED_AT,
        failureInjector: ({ boundary, mutationIndex }) => {
          const mutationMatches =
            boundaryCase.mutationIndex === undefined || boundaryCase.mutationIndex === mutationIndex;
          if (enabled && boundary === boundaryCase.boundary && mutationMatches) {
            throw new PresentationRunSimulatedProcessCrashError(`tombstone crash:${suffix}`);
          }
        },
      });
      const boundaryStore = new PresentationRunStore({
        files: boundaryFiles,
        journal: boundaryJournal,
        now: () => CREATED_AT,
        randomUUID: () => RUN_ID,
        getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      });
      await expect(
        boundaryStore.allocateRun({
          conversationId: CONVERSATION_ID,
          clientRequestId: REQUEST_ID,
          selectedTemplateId: 'business-review',
          requestFingerprint: 'a'.repeat(64),
          grantClaims: [],
        })
      ).resolves.toMatchObject({ ok: true, status: 'created' });
      const removeRun = vi.spyOn(boundaryFiles, 'removeRun');
      const removeGrant = vi.spyOn(boundaryFiles, 'removeGrant');
      enabled = true;

      await expect(boundaryStore.discardRun(RUN_ID, 0)).rejects.toThrow(`tombstone crash:${suffix}`);
      expect(removeRun).not.toHaveBeenCalled();
      expect(removeGrant).not.toHaveBeenCalled();

      const restartedFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
      const restartedJournal = new PresentationRunJournal({ files: restartedFiles, now: () => CREATED_AT });
      const restarted = new PresentationRunStore({
        files: restartedFiles,
        journal: restartedJournal,
        now: () => CREATED_AT,
        getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      });
      await restarted.initialize();
      const recovered = await restarted.getRun(RUN_ID);
      const recoveredTombstone = await restartedJournal.readCanonical('run-tombstone', RUN_ID);
      const recoveredRunIds = await restartedFiles.listEntityIds('run');
      const observedOutcome = recovered?.dispatchStatus === 'discarded' ? 'new' : 'old';
      if (boundaryCase.expectedOutcome !== 'either') expect(observedOutcome).toBe(boundaryCase.expectedOutcome);
      if (observedOutcome === 'new') {
        await expect(restarted.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
        expect(recoveredTombstone).toMatchObject({
          discardedRun: { dispatchStatus: 'discarded' },
        });
        expect(recoveredRunIds).toEqual([]);
      } else {
        expect(recovered).toMatchObject({ dispatchStatus: 'allocating' });
        expect(recoveredTombstone).toBeNull();
        expect(recoveredRunIds).toEqual([RUN_ID]);
      }
    }
  );

  it('never allows direct discard or TTL pressure deletion of dispatch-uncertain state', async () => {
    let clock = new Date('2026-10-10T00:00:00.000Z');
    const uncertain = storedRun(RUN_ID, 'dispatch_uncertain', {
      createdAt: new Date(clock.getTime() - 31 * 24 * 60 * 60_000).toISOString(),
      committedAt: new Date(clock.getTime() - 31 * 24 * 60 * 60_000).toISOString(),
      statusEnteredAt: new Date(clock.getTime() - (30 * 24 * 60 * 60_000 - 1)).toISOString(),
      updatedAt: clock.toISOString(),
      disposition: 'TRACKING_REQUIRED',
      postInvoked: true,
    });
    await journal.transaction({
      mutations: [{ entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: uncertain }],
    });
    const uncertainStore = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });

    await expect(uncertainStore.discardRun(RUN_ID, 0)).rejects.toThrow('Illegal presentation run dispatch transition');
    await expect(uncertainStore.sweepExpiredRuns()).resolves.toMatchObject({
      tombstoned: [],
      operatorAlerts: [],
    });
    clock = new Date(clock.getTime() + 1);
    await expect(uncertainStore.sweepExpiredRuns()).resolves.toMatchObject({
      tombstoned: [],
      operatorAlerts: [RUN_ID],
    });
    await expect(uncertainStore.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'dispatch_uncertain' });
  });

  it('keeps aged uncertain runs in conversation and app live-generation capacity indefinitely', async () => {
    const clock = new Date('2026-10-10T00:00:00.000Z');
    const uncertain = (runId: string, conversationId: string, fingerprint: string) =>
      storedRun(runId, 'dispatch_uncertain', {
        conversationId,
        clientRequestId: runId,
        requestFingerprint: fingerprint.repeat(64),
        createdAt: new Date(clock.getTime() - 31 * 24 * 60 * 60_000).toISOString(),
        committedAt: new Date(clock.getTime() - 31 * 24 * 60 * 60_000).toISOString(),
        statusEnteredAt: new Date(clock.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
        updatedAt: clock.toISOString(),
        disposition: 'TRACKING_REQUIRED',
        postInvoked: true,
      });
    const currentCommitted = (
      runId: string,
      conversationId: string,
      fingerprint: string
    ): StoredPresentationRunManifest =>
      storedRun(runId, 'committed', {
        conversationId,
        clientRequestId: runId,
        requestFingerprint: fingerprint.repeat(64),
        createdAt: clock.toISOString(),
        updatedAt: clock.toISOString(),
        statusEnteredAt: clock.toISOString(),
        committedAt: clock.toISOString(),
      });
    const manifests = [
      uncertain(RUN_ID, CONVERSATION_ID, 'a'),
      currentCommitted(RUN_B, CONVERSATION_B, 'b'),
      currentCommitted(RUN_C, CONVERSATION_ID, 'c'),
      currentCommitted(RUN_D, CONVERSATION_C, 'd'),
    ];
    await journal.transaction({
      mutations: manifests.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    const uncertainStore = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    const dispatch = async (runId: string) => {
      const run = await uncertainStore.getRun(runId);
      if (run === null) throw new Error('run missing');
      const claimed = await uncertainStore.claimInitialDispatch({
        runId,
        conversationId: run.conversationId,
        holderId: RUN_L,
        expectedRevision: run.revision,
      });
      return uncertainStore.beginInitialDispatch({
        runId,
        conversationId: run.conversationId,
        leaseToken: claimed.leaseToken,
        expectedRevision: claimed.manifest.revision,
      });
    };

    await expect(dispatch(RUN_C)).rejects.toThrow('Presentation live run resource limit exceeded');
    await expect(dispatch(RUN_B)).resolves.toMatchObject({ dispatchStatus: 'dispatching', revision: 2 });
    await expect(dispatch(RUN_D)).rejects.toThrow('Presentation live run resource limit exceeded');
    await expect(uncertainStore.getRun(RUN_C)).resolves.toMatchObject({ dispatchStatus: 'committed', revision: 1 });
    await expect(uncertainStore.getRun(RUN_D)).resolves.toMatchObject({ dispatchStatus: 'committed', revision: 1 });
  });

  it('applies stale-run GC and expired-tombstone purge during startup', async () => {
    const clock = new Date('2026-10-10T00:00:00.000Z');
    const at = (ageMs: number): string => new Date(clock.getTime() - ageMs).toISOString();
    const staleAllocating = storedRun(RUN_ID, 'allocating', {
      createdAt: at(10 * 60_000),
      updatedAt: clock.toISOString(),
      statusEnteredAt: at(10 * 60_000),
      committedAt: null,
      artifactPhase: 'none',
    });
    const staleCommitted = storedRun(RUN_B, 'committed', {
      createdAt: at(25 * 60 * 60_000),
      updatedAt: clock.toISOString(),
      statusEnteredAt: at(24 * 60 * 60_000),
      committedAt: at(24 * 60 * 60_000),
    });
    const staleRetained = storedRun(RUN_C, 'retained', {
      createdAt: at(8 * 24 * 60 * 60_000),
      updatedAt: clock.toISOString(),
      statusEnteredAt: at(7 * 24 * 60 * 60_000),
      committedAt: at(8 * 24 * 60 * 60_000),
      retainedAt: at(7 * 24 * 60 * 60_000),
      disposition: 'TRACKING_REQUIRED',
      postInvoked: true,
      binding: {
        conversationId: CONVERSATION_ID,
        turnId: 'turn-startup-retained',
        runtime: 'aionrs',
        boundAt: at(8 * 24 * 60 * 60_000),
      },
    });
    const discardedRun = storedRun(RUN_D, 'discarded', {
      revision: 1,
      createdAt: at(8 * 24 * 60 * 60_000),
      updatedAt: at(7 * 24 * 60 * 60_000),
      statusEnteredAt: at(7 * 24 * 60 * 60_000),
      committedAt: null,
      artifactPhase: null,
      retainedAt: null,
    });
    const expiredTombstone: StoredPresentationRunTombstone = {
      version: 2,
      tombstoneType: 'presentation-run',
      revision: 0,
      runId: RUN_D,
      tombstonedAt: at(7 * 24 * 60 * 60_000),
      discardedRun,
    };
    await journal.transaction({
      mutations: [staleAllocating, staleCommitted, staleRetained].map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    await journal.transaction({
      mutations: [
        {
          entityKind: 'run-tombstone',
          entityId: RUN_D,
          expectedRevision: null,
          nextManifest: expiredTombstone,
        },
      ],
    });

    const restarted = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    await restarted.initialize();

    await expect(restarted.getRun(RUN_ID)).resolves.toMatchObject({ dispatchStatus: 'failed_retained' });
    await expect(restarted.getRun(RUN_B)).resolves.toMatchObject({ dispatchStatus: 'failed_retained' });
    await expect(restarted.getRun(RUN_C)).resolves.toMatchObject({ dispatchStatus: 'discarded' });
    await expect(restarted.getRun(RUN_D)).resolves.toBeNull();
  });

  it('allows eight predispatch intents and rejects the ninth before allocation', async () => {
    let clock = CREATED_AT;
    const runIds = Array.from(
      { length: 9 },
      (_, index) => `00000000-0000-4000-8000-${(index + 201).toString().padStart(12, '0')}`
    );
    const conversationIds = Array.from(
      { length: 9 },
      (_, index) => `00000000-0000-4000-8000-${(index + 301).toString().padStart(12, '0')}`
    );
    const ids = [...runIds];
    const policyStore = new PresentationRunStore({
      files,
      journal,
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_L,
      getFreeDiskBytes: async () => 64 * 1_024 * 1_024 * 1_024,
    });
    const allocate = (index: number) =>
      policyStore.allocateRun({
        conversationId: conversationIds[index],
        clientRequestId: runIds[index],
        selectedTemplateId: 'business-review',
        requestFingerprint: runIds[index].replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
        grantClaims: [],
      });

    for (let index = 0; index < 8; index += 1) {
      if (index >= 2) clock = new Date(clock.getTime() + 10_000);
      await expect(allocate(index)).resolves.toMatchObject({ ok: true, status: 'created' });
    }
    await expect(allocate(8)).resolves.toMatchObject({
      ok: false,
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
    await expect(files.listEntityIds('run')).resolves.toHaveLength(8);
  });

  it('counts both predispatch and indefinitely uncertain runs in disk reservations', async () => {
    const clock = new Date(CREATED_AT.getTime() + 60_000);
    const committed = storedRun(RUN_ID, 'committed');
    const uncertain = storedRun(RUN_B, 'dispatch_uncertain', {
      conversationId: CONVERSATION_B,
      clientRequestId: RUN_B,
      requestFingerprint: 'b'.repeat(64),
      disposition: 'TRACKING_REQUIRED',
      postInvoked: true,
    });
    await journal.transaction({
      mutations: [committed, uncertain].map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    const exactFreeBytes =
      3 * PRESENTATION_RUN_LIMITS.TRANSIENT_DISK_RESERVATION_BYTES_PER_RUN +
      PRESENTATION_RUN_LIMITS.MIN_UNRESERVED_BYTES_AFTER_RESERVATIONS;
    let freeBytes = exactFreeBytes - 1;
    const reservationStore = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      randomUUID: () => RUN_C,
      getFreeDiskBytes: async () => freeBytes,
    });
    const input = {
      conversationId: CONVERSATION_C,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'c'.repeat(64),
      grantClaims: [],
    };

    await expect(reservationStore.allocateRun(input)).resolves.toMatchObject({
      ok: false,
      code: 'DISK_RESERVE_EXCEEDED',
    });
    freeBytes = exactFreeBytes;
    await expect(reservationStore.allocateRun(input)).resolves.toMatchObject({ ok: true, status: 'created' });
  });

  it('atomically caps live generation at one per conversation and two per app', async () => {
    const clock = new Date(CREATED_AT.getTime() + 1);
    const committedRuns = [
      storedRun(RUN_ID, 'committed'),
      storedRun(RUN_B, 'committed', { clientRequestId: RUN_B, requestFingerprint: 'b'.repeat(64) }),
      storedRun(RUN_C, 'committed', {
        conversationId: CONVERSATION_B,
        clientRequestId: RUN_C,
        requestFingerprint: 'c'.repeat(64),
      }),
      storedRun(RUN_D, 'committed', {
        conversationId: CONVERSATION_C,
        clientRequestId: RUN_D,
        requestFingerprint: 'd'.repeat(64),
      }),
    ];
    await journal.transaction({
      mutations: committedRuns.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    const liveStore = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    const dispatch = async (runId: string) => {
      const run = await liveStore.getRun(runId);
      if (run === null) throw new Error('run missing');
      const claimed = await liveStore.claimInitialDispatch({
        runId,
        conversationId: run.conversationId,
        holderId: RUN_L,
        expectedRevision: run.revision,
      });
      return liveStore.beginInitialDispatch({
        runId,
        conversationId: run.conversationId,
        leaseToken: claimed.leaseToken,
        expectedRevision: claimed.manifest.revision,
      });
    };

    const sameConversation = await Promise.allSettled([dispatch(RUN_ID), dispatch(RUN_B)]);
    expect(sameConversation.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(sameConversation.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(sameConversation.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: 'Presentation live run resource limit exceeded' }),
    });
    await expect(dispatch(RUN_C)).resolves.toMatchObject({ dispatchStatus: 'dispatching' });
    await expect(dispatch(RUN_D)).rejects.toThrow('Presentation live run resource limit exceeded');
    await expect(liveStore.getRun(RUN_D)).resolves.toMatchObject({ revision: 1, dispatchStatus: 'committed' });
  });

  it.each([
    { scope: 'conversation', retainedCount: 9 },
    { scope: 'app', retainedCount: 99 },
  ] as const)('reserves the final retained $scope slot and rejects the next allocation', async (testCase) => {
    const boundaryRoot = path.join(fixtureRoot, `retained-${testCase.scope}-${testCase.retainedCount}`);
    const boundaryUserData = path.join(boundaryRoot, 'user-data');
    const boundaryTemp = path.join(boundaryRoot, 'system-temp');
    await Promise.all([mkdir(boundaryUserData, { recursive: true }), mkdir(boundaryTemp, { recursive: true })]);
    const boundaryFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
    const idFor = (prefix: string, index: number): string =>
      `${prefix}0000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
    const retained = Array.from({ length: testCase.retainedCount }, (_, index) => {
      const runId = idFor('2', index + 1);
      const conversationId = testCase.scope === 'conversation' ? CONVERSATION_ID : idFor('3', index + 1);
      return storedRun(runId, 'retained', {
        conversationId,
        clientRequestId: runId,
        disposition: 'TRACKING_REQUIRED',
        postInvoked: true,
        binding: {
          conversationId,
          turnId: `turn-${runId}`,
          runtime: 'aionrs',
          boundAt: CREATED_AT.toISOString(),
        },
      });
    });
    await boundaryFiles.initialize();
    await Promise.all(
      retained.map(async (run) => {
        const manifestPath = boundaryFiles.getEntityManifestPath('run', run.runId);
        await mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
        await writeFile(manifestPath, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
      })
    );
    const clock = new Date(CREATED_AT.getTime() + 60_000);
    const ids = [RUN_K, RUN_L];
    const boundaryStore = new PresentationRunStore({
      files: boundaryFiles,
      journal: new PresentationRunJournal({ files: boundaryFiles, now: () => clock }),
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_J,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    const result = await boundaryStore.allocateRun({
      conversationId: testCase.scope === 'conversation' ? CONVERSATION_ID : CONVERSATION_B,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });

    expect(result).toMatchObject({ ok: true, status: 'created' });
    await expect(
      boundaryStore.allocateRun({
        conversationId: testCase.scope === 'conversation' ? CONVERSATION_ID : CONVERSATION_C,
        clientRequestId: RUN_L,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'b'.repeat(64),
        grantClaims: [],
      })
    ).resolves.toMatchObject({ ok: false, code: 'RESOURCE_LIMIT_EXCEEDED' });
  });

  it.each([
    { scope: 'conversation', delta: -1, allowed: true },
    { scope: 'conversation', delta: 0, allowed: false },
    { scope: 'app', delta: -1, allowed: true },
    { scope: 'app', delta: 0, allowed: false },
  ] as const)('enforces retained-byte $scope quota at max $delta', async (testCase) => {
    const boundaryRoot = path.join(fixtureRoot, `bytes-${testCase.scope}-${testCase.delta}`);
    const boundaryUserData = path.join(boundaryRoot, 'user-data');
    const boundaryTemp = path.join(boundaryRoot, 'system-temp');
    await Promise.all([mkdir(boundaryUserData, { recursive: true }), mkdir(boundaryTemp, { recursive: true })]);
    const boundaryFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
    const boundaryJournal = new PresentationRunJournal({ files: boundaryFiles, now: () => CREATED_AT });
    const maximum = testCase.scope === 'conversation' ? 640 * 1_024 * 1_024 : 3 * 1_024 * 1_024 * 1_024;
    let remaining = maximum + testCase.delta;
    const retained: StoredPresentationRunManifest[] = [];
    let index = 1;
    while (remaining > 0) {
      const byteLength = Math.min(remaining, 640 * 1_024 * 1_024);
      const runId = `40000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
      const conversationId =
        testCase.scope === 'conversation'
          ? CONVERSATION_ID
          : `50000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
      retained.push(
        storedRun(runId, 'retained', {
          conversationId,
          clientRequestId: runId,
          disposition: 'TRACKING_REQUIRED',
          postInvoked: true,
          retainedBytes: byteLength,
          binding: {
            conversationId,
            turnId: `turn-${runId}`,
            runtime: 'aionrs',
            boundAt: CREATED_AT.toISOString(),
          },
        })
      );
      remaining -= byteLength;
      index += 1;
    }
    await boundaryJournal.transaction({
      mutations: retained.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    const clock = new Date(CREATED_AT.getTime() + 60_000);
    const boundaryStore = new PresentationRunStore({
      files: boundaryFiles,
      journal: new PresentationRunJournal({ files: boundaryFiles, now: () => clock }),
      now: () => clock,
      randomUUID: () => RUN_K,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });

    const result = await boundaryStore.allocateRun({
      conversationId: testCase.scope === 'conversation' ? CONVERSATION_ID : CONVERSATION_B,
      clientRequestId: REQUEST_ID,
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [],
    });

    expect(result.ok).toBe(testCase.allowed);
    if (!testCase.allowed) expect(result).toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' });
  });

  it('counts prospective claimed-source bytes and reclaims quota only after tombstoning', async () => {
    let clock = CREATED_AT;
    const retained = storedRun(RUN_ID, 'retained', {
      disposition: 'TRACKING_REQUIRED',
      postInvoked: true,
      retainedBytes: 640 * 1_024 * 1_024 - 5,
      binding: {
        conversationId: CONVERSATION_ID,
        turnId: 'turn-retained-quota',
        runtime: 'aionrs',
        boundAt: CREATED_AT.toISOString(),
      },
    });
    await journal.transaction({
      mutations: [
        { entityKind: 'run', entityId: RUN_ID, expectedRevision: null, nextManifest: retained },
        {
          entityKind: 'grant',
          entityId: GRANT_A,
          expectedRevision: null,
          nextManifest: {
            version: 2,
            grantId: GRANT_A,
            ownerKey: `conversation:${CONVERSATION_ID}`,
            revision: 0,
            createdAt: CREATED_AT.toISOString(),
            updatedAt: CREATED_AT.toISOString(),
            expiresAt: new Date(CREATED_AT.getTime() + 15 * 60_000).toISOString(),
            state: 'active',
            byteLength: 10,
            claimedRunId: null,
          },
        },
      ],
    });
    const quotaStore = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      randomUUID: () => RUN_B,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    await expect(
      quotaStore.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: REQUEST_ID,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'a'.repeat(64),
        grantClaims: [{ grantId: GRANT_A, expectedRevision: 0 }],
      })
    ).resolves.toMatchObject({ ok: false, code: 'RESOURCE_LIMIT_EXCEEDED' });
    await expect(journal.readCanonical('grant', GRANT_A)).resolves.toMatchObject({ state: 'active', revision: 0 });

    clock = new Date(clock.getTime() + 7 * 24 * 60 * 60_000);
    await quotaStore.sweepExpiredRuns();
    await expect(
      quotaStore.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: REQUEST_ID,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'a'.repeat(64),
        grantClaims: [],
      })
    ).resolves.toMatchObject({ ok: true, status: 'created' });
  });

  it.each([
    { scope: 'conversation', overBy: 0, allowed: true },
    { scope: 'conversation', overBy: 1, allowed: false },
    { scope: 'app', overBy: 0, allowed: true },
    { scope: 'app', overBy: 1, allowed: false },
  ] as const)(
    'applies prospective claimed-source bytes at the exact $scope quota boundary +$overBy',
    async (testCase) => {
      const boundaryRoot = path.join(fixtureRoot, `source-prospective-${testCase.scope}-${testCase.overBy}`);
      const boundaryUserData = path.join(boundaryRoot, 'user-data');
      const boundaryTemp = path.join(boundaryRoot, 'system-temp');
      await Promise.all([mkdir(boundaryUserData, { recursive: true }), mkdir(boundaryTemp, { recursive: true })]);
      const boundaryFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
      const boundaryJournal = new PresentationRunJournal({ files: boundaryFiles, now: () => CREATED_AT });
      const maximum =
        testCase.scope === 'conversation'
          ? PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_CONVERSATION
          : PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_APP;
      const sourceBytes = 10;
      let remaining = maximum - sourceBytes + testCase.overBy;
      const retained: StoredPresentationRunManifest[] = [];
      let index = 1;
      while (remaining > 0) {
        const byteLength = Math.min(remaining, PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_CONVERSATION);
        const runId = `60000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
        const conversationId =
          testCase.scope === 'conversation'
            ? CONVERSATION_ID
            : `61000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
        retained.push(
          storedRun(runId, 'retained', {
            conversationId,
            clientRequestId: runId,
            requestFingerprint: index.toString(16).padStart(64, '0'),
            disposition: 'TRACKING_REQUIRED',
            postInvoked: true,
            retainedBytes: byteLength,
            binding: {
              conversationId,
              turnId: `turn-${runId}`,
              runtime: 'aionrs',
              boundAt: CREATED_AT.toISOString(),
            },
          })
        );
        remaining -= byteLength;
        index += 1;
      }
      await boundaryJournal.transaction({
        mutations: [
          ...retained.map((run) => ({
            entityKind: 'run' as const,
            entityId: run.runId,
            expectedRevision: null,
            nextManifest: run,
          })),
          {
            entityKind: 'grant',
            entityId: GRANT_A,
            expectedRevision: null,
            nextManifest: storedGrant(GRANT_A, { byteLength: sourceBytes }),
          },
        ],
      });
      const clock = new Date(CREATED_AT.getTime() + 60_000);
      const boundaryStore = new PresentationRunStore({
        files: boundaryFiles,
        journal: new PresentationRunJournal({ files: boundaryFiles, now: () => clock }),
        now: () => clock,
        randomUUID: () => RUN_K,
        getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
      });
      const result = await boundaryStore.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: REQUEST_ID,
        selectedTemplateId: 'business-review',
        requestFingerprint: 'f'.repeat(64),
        grantClaims: [{ grantId: GRANT_A, expectedRevision: 0 }],
      });

      expect(result.ok).toBe(testCase.allowed);
      if (testCase.allowed) {
        expect(result).toMatchObject({ status: 'created', run: { retainedBytes: sourceBytes } });
        await expect(boundaryJournal.readCanonical('grant', GRANT_A)).resolves.toMatchObject({
          state: 'claimed',
          claimedRunId: RUN_K,
        });
      } else {
        expect(result).toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' });
        await expect(boundaryJournal.readCanonical('grant', GRANT_A)).resolves.toMatchObject({
          state: 'active',
          revision: 0,
        });
      }
    }
  );

  it.each([
    { scope: 'conversation', overBy: 0, allowed: true },
    { scope: 'conversation', overBy: 1, allowed: false },
    { scope: 'app', overBy: 0, allowed: true },
    { scope: 'app', overBy: 1, allowed: false },
  ] as const)('applies candidate bytes at the exact $scope quota boundary +$overBy', async (testCase) => {
    const boundaryRoot = path.join(fixtureRoot, `candidate-prospective-${testCase.scope}-${testCase.overBy}`);
    const boundaryUserData = path.join(boundaryRoot, 'user-data');
    const boundaryTemp = path.join(boundaryRoot, 'system-temp');
    await Promise.all([mkdir(boundaryUserData, { recursive: true }), mkdir(boundaryTemp, { recursive: true })]);
    const boundaryFiles = new PresentationRunFiles({ userDataDir: boundaryUserData, tempDir: boundaryTemp });
    const boundaryJournal = new PresentationRunJournal({ files: boundaryFiles, now: () => CREATED_AT });
    const maximum =
      testCase.scope === 'conversation'
        ? PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_CONVERSATION
        : PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_APP;
    const candidateBytes = 10;
    const baseBytes = maximum - candidateBytes + testCase.overBy;
    const terminal = storedRun(RUN_ID, 'terminal_verified', {
      ...exactTerminalLifecycle(),
      clientRequestId: REQUEST_ID,
      requestFingerprint: 'a'.repeat(64),
      artifactPhase: 'sources_extracted',
      retainedBytes: testCase.scope === 'conversation' ? baseBytes : 0,
    });
    const retained: StoredPresentationRunManifest[] = [];
    let remaining = testCase.scope === 'app' ? baseBytes : 0;
    let index = 1;
    while (remaining > 0) {
      const byteLength = Math.min(remaining, PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_CONVERSATION);
      const runId = `62000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
      const conversationId = `63000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
      retained.push(
        storedRun(runId, 'retained', {
          conversationId,
          clientRequestId: runId,
          requestFingerprint: index.toString(16).padStart(64, '0'),
          disposition: 'TRACKING_REQUIRED',
          postInvoked: true,
          retainedBytes: byteLength,
          binding: {
            conversationId,
            turnId: `turn-${runId}`,
            runtime: 'aionrs',
            boundAt: CREATED_AT.toISOString(),
          },
        })
      );
      remaining -= byteLength;
      index += 1;
    }
    await boundaryJournal.transaction({
      mutations: [terminal, ...retained].map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    const layout = await boundaryFiles.createRunLayout(RUN_ID);
    await writeFile(path.join(layout.stagingDirectory, 'candidate.pptx'), '0123456789');
    const boundaryStore = new PresentationRunStore({
      files: boundaryFiles,
      journal: new PresentationRunJournal({ files: boundaryFiles, now: () => CREATED_AT }),
      now: () => CREATED_AT,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });

    if (testCase.allowed) {
      const retainedRun = await boundaryStore.retainCandidate(RUN_ID, 0);
      expect(retainedRun).toMatchObject({
        revision: 1,
        artifactPhase: 'candidate_retained',
        retainedBytes: terminal.retainedBytes + candidateBytes,
      });
    } else {
      await expect(boundaryStore.retainCandidate(RUN_ID, 0)).rejects.toThrow(
        'Presentation retained resource limit exceeded'
      );
      await expect(boundaryStore.getRun(RUN_ID)).resolves.toMatchObject({
        revision: 0,
        artifactPhase: 'sources_extracted',
        retainedBytes: terminal.retainedBytes,
      });
      await expect(readdir(layout.retainedDirectory)).resolves.toEqual([]);
    }
  });

  it('uses exact conversation and app token-bucket boundaries without charging replay', async () => {
    let clock = new Date('2026-09-10T00:00:00.000Z');
    const ids = [RUN_ID, RUN_B, RUN_C, RUN_D, RUN_E, RUN_F, RUN_G];
    const rateStore = new PresentationRunStore({
      files,
      journal,
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_L,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    const input = (conversationId: string, requestId: string) => ({
      conversationId,
      clientRequestId: requestId,
      selectedTemplateId: 'business-review',
      requestFingerprint: requestId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      grantClaims: [],
    });
    const first = input(CONVERSATION_ID, REQUEST_ID);
    await expect(rateStore.allocateRun(first)).resolves.toMatchObject({ ok: true, status: 'created' });
    await expect(rateStore.allocateRun(first)).resolves.toMatchObject({ ok: true, status: 'existing' });
    await rateStore.discardRun(RUN_ID, 0);
    await expect(rateStore.allocateRun(input(CONVERSATION_B, RUN_K))).resolves.toMatchObject({
      ok: true,
      status: 'created',
    });
    await rateStore.discardRun(RUN_B, 0);
    clock = new Date(clock.getTime() + 29_999);
    await expect(rateStore.allocateRun(input(CONVERSATION_ID, RUN_J))).resolves.toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      details: { retryAfterMs: 1, postInvoked: false },
    });
    clock = new Date(clock.getTime() + 1);
    await expect(rateStore.allocateRun(input(CONVERSATION_ID, RUN_J))).resolves.toMatchObject({
      ok: true,
      status: 'created',
    });
    await rateStore.discardRun(RUN_C, 0);

    await expect(rateStore.allocateRun(input(CONVERSATION_B, RUN_L))).resolves.toMatchObject({
      ok: true,
      status: 'created',
    });
    await rateStore.discardRun(RUN_D, 0);
    clock = new Date(clock.getTime() + 9_999);
    await expect(rateStore.allocateRun(input(CONVERSATION_C, RUN_E))).resolves.toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      details: { retryAfterMs: 1, postInvoked: false },
    });
    clock = new Date(clock.getTime() + 1);
    await expect(rateStore.allocateRun(input(CONVERSATION_C, RUN_E))).resolves.toMatchObject({
      ok: true,
      status: 'created',
    });
  });

  it('reconstructs conversation and app token buckets from live runs and tombstones after restart', async () => {
    let clock = new Date('2026-09-10T00:00:00.000Z');
    const ids = [RUN_ID, RUN_B, RUN_C, RUN_D];
    const firstStore = new PresentationRunStore({
      files,
      journal,
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_L,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    const request = (conversationId: string, requestId: string) => ({
      conversationId,
      clientRequestId: requestId,
      selectedTemplateId: 'business-review',
      requestFingerprint: requestId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      grantClaims: [],
    });
    await expect(firstStore.allocateRun(request(CONVERSATION_ID, REQUEST_ID))).resolves.toMatchObject({ ok: true });
    await firstStore.discardRun(RUN_ID, 0);
    await expect(firstStore.allocateRun(request(CONVERSATION_B, RUN_J))).resolves.toMatchObject({ ok: true });
    await firstStore.discardRun(RUN_B, 0);

    const restarted = new PresentationRunStore({
      files,
      journal: new PresentationRunJournal({ files, now: () => clock }),
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_L,
      getFreeDiskBytes: async () => 32 * 1_024 * 1_024 * 1_024,
    });
    clock = new Date('2026-09-10T00:00:09.999Z');
    await expect(restarted.allocateRun(request(CONVERSATION_C, RUN_L))).resolves.toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      details: { retryAfterMs: 1 },
    });
    clock = new Date('2026-09-10T00:00:29.999Z');
    await expect(restarted.allocateRun(request(CONVERSATION_ID, RUN_K))).resolves.toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      details: { retryAfterMs: 1 },
    });
    clock = new Date('2026-09-10T00:00:30.000Z');
    await expect(restarted.allocateRun(request(CONVERSATION_ID, RUN_K))).resolves.toMatchObject({
      ok: true,
      status: 'created',
    });
  });

  it('does not charge failed disk or capacity checks against token buckets', async () => {
    const seedIds = Array.from(
      { length: 7 },
      (_, index) => `00000000-0000-4000-8000-${(index + 401).toString().padStart(12, '0')}`
    );
    const predispatch = seedIds.map((runId, index) =>
      storedRun(runId, 'allocating', {
        conversationId: `00000000-0000-4000-8000-${(index + 501).toString().padStart(12, '0')}`,
        clientRequestId: runId,
        requestFingerprint: (index + 1).toString(16).repeat(64),
        committedAt: null,
      })
    );
    await journal.transaction({
      mutations: predispatch.map((run) => ({
        entityKind: 'run' as const,
        entityId: run.runId,
        expectedRevision: null,
        nextManifest: run,
      })),
    });
    const clock = new Date(CREATED_AT.getTime() + 60_000);
    let freeBytes = PRESENTATION_RUN_LIMITS.MIN_FREE_BYTES_BEFORE_START - 1;
    const ids = [RUN_ID, RUN_B, RUN_C];
    const policyStore = new PresentationRunStore({
      files,
      journal,
      now: () => clock,
      randomUUID: () => ids.shift() ?? RUN_L,
      getFreeDiskBytes: async () => freeBytes,
    });
    const request = (requestId: string, conversationId = CONVERSATION_ID) => ({
      conversationId,
      clientRequestId: requestId,
      selectedTemplateId: 'business-review',
      requestFingerprint: requestId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      grantClaims: [],
    });
    await expect(policyStore.allocateRun(request(REQUEST_ID))).resolves.toMatchObject({
      ok: false,
      code: 'DISK_RESERVE_EXCEEDED',
    });
    freeBytes = 32 * 1_024 * 1_024 * 1_024;
    await expect(policyStore.allocateRun(request(REQUEST_ID))).resolves.toMatchObject({ ok: true, status: 'created' });
    await expect(policyStore.allocateRun(request(RUN_J))).resolves.toMatchObject({
      ok: false,
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
    await policyStore.discardRun(RUN_ID, 0);
    await expect(policyStore.allocateRun(request(RUN_K, CONVERSATION_B))).resolves.toMatchObject({
      ok: true,
      status: 'created',
    });
  });
});
