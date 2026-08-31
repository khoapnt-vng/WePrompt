/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import {
  assertPresentationSourceDraftManifest,
  assertPresentationSourceDraftTombstone,
  assertPresentationSourceGrantManifest,
  assertPresentationSourceOwnerManifest,
  PresentationRunFiles,
  PresentationRunJournal,
  PresentationRunSimulatedProcessCrashError,
  PresentationRunStore,
  presentationSourceOwnerId,
  type PreparedPresentationSourceSnapshot,
  type PresentationPreparedSourceSnapshotGuard,
  type PresentationSourceStoreError,
} from '@/process/services/presentation-template/run/storage';

const PRINCIPAL_ID = 'principal-a';
const CONVERSATION_ID = '745b7d43-a0aa-4bb7-b0cc-283f2db4873d';
const LEGACY_UPPERCASE_CONVERSATION_ID = CONVERSATION_ID.toUpperCase();
const SHORT_CONVERSATION_ID = 'd0921953';
const DRAFT_ID = 'a6290e3f-fb6d-49c3-bdce-bc613c04c101';
const GRANT_ID = 'dc3ea0c5-f54d-447d-bd93-a3329b08c531';
const GRANT_B = '5bac9a15-bb41-4fe2-b782-d06922788c1c';
const RUN_ID = '49f40825-4bbd-4a76-af52-fb371bf63e5d';
const NOW = new Date('2026-08-04T00:00:00.000Z');

const testUuid = (index: number): string => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

class QuotaAccountingFiles extends PresentationRunFiles {
  override async withPreparedSourceSnapshotLeases<T>(
    _preparedSnapshots: readonly PreparedPresentationSourceSnapshot[],
    operation: (guard: PresentationPreparedSourceSnapshotGuard) => Promise<T>
  ): Promise<T> {
    return operation({ assertCurrent: async () => undefined });
  }

  override async recoverSourceSnapshotPromotion(_prepared: PreparedPresentationSourceSnapshot): Promise<void> {}
}

describe('PresentationRunStore source grants', () => {
  let fixtureRoot: string;
  let userDataDir: string;
  let tempDir: string;
  let files: PresentationRunFiles;
  let journal: PresentationRunJournal;
  let store: PresentationRunStore;
  let clock: Date;

  const createStore = (randomUUID: () => string = () => DRAFT_ID): PresentationRunStore => {
    files = new PresentationRunFiles({ userDataDir, tempDir });
    journal = new PresentationRunJournal({ files, now: () => clock });
    return new PresentationRunStore({
      files,
      journal,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      now: () => clock,
      randomUUID,
    });
  };

  const createGrant = async (
    input: {
      grantId?: string;
      owner?: { owner_type: 'conversation'; conversation_id: string };
      expectedOwnerRevision?: number;
      content?: string;
    } = {}
  ) => {
    const grantId = input.grantId ?? GRANT_ID;
    const owner = input.owner ?? { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    const sourcePath = path.join(fixtureRoot, `${grantId}.txt`);
    await writeFile(sourcePath, input.content ?? 'Quarterly revenue\n', { mode: 0o600 });
    const [prepared] = await files.prepareSourceSnapshots([{ grantId, sourcePath, format: 'txt' }]);
    const result = await store.createPresentationSourceGrants({
      owner,
      principalId: PRINCIPAL_ID,
      expectedOwnerRevision: input.expectedOwnerRevision ?? 0,
      grants: [
        {
          grantId,
          displayName: 'brief.txt',
          format: 'txt',
          sourceKind: 'native-picker',
          snapshotRelativePath: prepared.finalRelativePath,
          sha256: prepared.sha256,
          byteLength: prepared.byteLength,
          preparedSnapshot: prepared,
        },
      ],
    });
    return { prepared, result };
  };

  const createGrantBatch = async (input: {
    owner: { owner_type: 'conversation'; conversation_id: string };
    expectedOwnerRevision: number;
    grantIds: readonly string[];
  }) => {
    const sourcePath = path.join(fixtureRoot, `batch-${input.grantIds[0]}.txt`);
    await writeFile(sourcePath, 'x', { mode: 0o600 });
    const prepared = await files.prepareSourceSnapshots(
      input.grantIds.map((grantId) => ({ grantId, sourcePath, format: 'txt' as const }))
    );
    return store.createPresentationSourceGrants({
      owner: input.owner,
      principalId: PRINCIPAL_ID,
      expectedOwnerRevision: input.expectedOwnerRevision,
      grants: prepared.map((snapshot, index) => ({
        grantId: snapshot.grantId,
        displayName: `${index}.txt`,
        format: 'txt' as const,
        sourceKind: 'native-picker' as const,
        snapshotRelativePath: snapshot.finalRelativePath,
        sha256: snapshot.sha256,
        byteLength: snapshot.byteLength,
        preparedSnapshot: snapshot,
      })),
    });
  };

  const seedLegacyConversationGrant = async () => {
    const owner = {
      owner_type: 'conversation' as const,
      conversation_id: LEGACY_UPPERCASE_CONVERSATION_ID,
    };
    const ownerId = presentationSourceOwnerId(owner);
    const sourcePath = path.join(fixtureRoot, 'legacy-uppercase.txt');
    await writeFile(sourcePath, 'Legacy uppercase owner\n', { mode: 0o600 });
    const [prepared] = await files.prepareSourceSnapshots([{ grantId: GRANT_ID, sourcePath, format: 'txt' }]);
    const now = clock.toISOString();
    const expiresAt = new Date(clock.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS).toISOString();
    const ownerManifest = {
      version: 2 as const,
      recordType: 'presentation-source-owner' as const,
      ownerId,
      owner,
      principalId: PRINCIPAL_ID,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      grantIds: [GRANT_ID],
      unboundBytes: prepared.byteLength,
      draftClientRequestId: null,
      draftLifecycle: null,
    };
    const grantManifest = {
      version: 2 as const,
      recordType: 'presentation-source-grant' as const,
      grantId: GRANT_ID,
      owner,
      revision: 0,
      displayName: 'legacy-uppercase.txt',
      format: 'txt' as const,
      sourceKind: 'native-picker' as const,
      snapshotRelativePath: prepared.finalRelativePath,
      sha256: prepared.sha256,
      byteLength: prepared.byteLength,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      stateEnteredAt: now,
      state: 'active' as const,
      queueExtendedAt: null,
      queueItemId: null,
      claimedRunId: null,
    };
    assertPresentationSourceOwnerManifest(ownerManifest);
    assertPresentationSourceGrantManifest(grantManifest);
    await journal.transaction({
      sourceSnapshotPromotions: [prepared],
      mutations: [
        { entityKind: 'owner', entityId: ownerId, expectedRevision: null, nextManifest: ownerManifest },
        { entityKind: 'grant', entityId: GRANT_ID, expectedRevision: null, nextManifest: grantManifest },
      ],
    });
    return { owner, ownerId, ownerManifest, grantManifest };
  };

  const createAccountedGrantBatch = async (input: {
    owner: { owner_type: 'conversation'; conversation_id: string };
    expectedOwnerRevision: number;
    grantIds: readonly string[];
    declaredByteLength: number;
  }) => {
    const prepared = input.grantIds.map<PreparedPresentationSourceSnapshot>((grantId, index) => ({
      grantId,
      format: 'txt',
      temporaryRelativePath: `.source-${grantId}.tmp`,
      finalRelativePath: 'source.txt',
      sha256: 'a'.repeat(64),
      byteLength: input.declaredByteLength,
      dev: '0',
      ino: String(index + 1),
    }));
    return store.createPresentationSourceGrants({
      owner: input.owner,
      principalId: PRINCIPAL_ID,
      expectedOwnerRevision: input.expectedOwnerRevision,
      grants: prepared.map((snapshot, index) => ({
        grantId: snapshot.grantId,
        displayName: `${index}.txt`,
        format: 'txt' as const,
        sourceKind: 'native-picker' as const,
        snapshotRelativePath: snapshot.finalRelativePath,
        sha256: snapshot.sha256,
        byteLength: input.declaredByteLength,
        preparedSnapshot: snapshot,
      })),
    });
  };

  beforeEach(async () => {
    clock = new Date(NOW);
    fixtureRoot = await mkdtemp(path.join(tmpdir(), 'presentation-source-store-'));
    userDataDir = path.join(fixtureRoot, 'user-data');
    tempDir = path.join(fixtureRoot, 'temp');
    await Promise.all([mkdir(userDataDir), mkdir(tempDir)]);
    store = createStore();
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('persists a draft and replays the same principal request after restart', async () => {
    const created = await store.createPresentationSourceDraft(PRINCIPAL_ID, 'draft-request-1');

    expect(created).toMatchObject({
      status: 'created',
      draft: { draftId: DRAFT_ID, revision: 0, state: 'active' },
    });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'draft', draft_id: DRAFT_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 0, grants: [] });

    const restarted = createStore();
    await expect(restarted.createPresentationSourceDraft(PRINCIPAL_ID, 'draft-request-1')).resolves.toMatchObject({
      status: 'existing',
      draft: { draftId: DRAFT_ID, revision: 0 },
    });
  });

  it('keeps distinct draft request tuples separate when identifiers contain the old delimiter', async () => {
    const draftIds = [testUuid(1), testUuid(2)];
    store = createStore(() => draftIds.shift() ?? testUuid(3));

    await expect(store.createPresentationSourceDraft('a', 'b\u0000c')).resolves.toMatchObject({
      status: 'created',
      draft: { draftId: testUuid(1) },
    });
    await expect(store.createPresentationSourceDraft('a\u0000b', 'c')).resolves.toMatchObject({
      status: 'created',
      draft: { draftId: testUuid(2) },
    });

    const restarted = createStore(() => testUuid(3));
    await expect(restarted.createPresentationSourceDraft('a', 'b\u0000c')).resolves.toMatchObject({
      status: 'existing',
      draft: { draftId: testUuid(1) },
    });
    await expect(restarted.createPresentationSourceDraft('a\u0000b', 'c')).resolves.toMatchObject({
      status: 'existing',
      draft: { draftId: testUuid(2) },
    });
  });

  it('atomically promotes one prepared source and restores its owner after restart', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const sourcePath = path.join(fixtureRoot, 'brief.txt');
    await writeFile(sourcePath, 'Quarterly revenue\n', { mode: 0o600 });
    const [prepared] = await files.prepareSourceSnapshots([{ grantId: GRANT_ID, sourcePath, format: 'txt' }]);

    const result = await store.createPresentationSourceGrants({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      expectedOwnerRevision: 0,
      grants: [
        {
          grantId: GRANT_ID,
          displayName: 'brief.txt',
          format: 'txt',
          sourceKind: 'native-picker',
          snapshotRelativePath: prepared.finalRelativePath,
          sha256: prepared.sha256,
          byteLength: prepared.byteLength,
          preparedSnapshot: prepared,
        },
      ],
    });

    expect(result).toMatchObject({ ownerRevision: 1, grants: [{ grantId: GRANT_ID, state: 'active' }] });
    await expect(readFile(path.join(files.roots.grantRoot, GRANT_ID, 'source.txt'), 'utf8')).resolves.toBe(
      'Quarterly revenue\n'
    );

    const restarted = createStore();
    await expect(
      restarted.getPresentationSourceOwner(
        { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        PRINCIPAL_ID
      )
    ).resolves.toMatchObject({ ownerRevision: 1, grants: [{ grantId: GRANT_ID, sha256: prepared.sha256 }] });
  });

  it('recovers the prepared source and complete grant batch after an intent-persisted crash', async () => {
    let crashed = false;
    const crashingJournal = new PresentationRunJournal({
      files,
      now: () => NOW,
      failureInjector: ({ boundary }) => {
        if (!crashed && boundary === 'before-manifest-write') {
          crashed = true;
          throw new PresentationRunSimulatedProcessCrashError('simulated crash');
        }
      },
    });
    const crashingStore = new PresentationRunStore({
      files,
      journal: crashingJournal,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      now: () => NOW,
    });
    await crashingStore.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const sourcePath = path.join(fixtureRoot, 'recover.txt');
    await writeFile(sourcePath, 'Recover me\n', { mode: 0o600 });
    const [prepared] = await files.prepareSourceSnapshots([{ grantId: GRANT_ID, sourcePath, format: 'txt' }]);

    await expect(
      crashingStore.createPresentationSourceGrants({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        principalId: PRINCIPAL_ID,
        expectedOwnerRevision: 0,
        grants: [
          {
            grantId: GRANT_ID,
            displayName: 'recover.txt',
            format: 'txt',
            sourceKind: 'native-picker',
            snapshotRelativePath: prepared.finalRelativePath,
            sha256: prepared.sha256,
            byteLength: prepared.byteLength,
            preparedSnapshot: prepared,
          },
        ],
      })
    ).rejects.toThrow('simulated crash');

    const restarted = createStore();
    await expect(
      restarted.getPresentationSourceOwner(
        { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        PRINCIPAL_ID
      )
    ).resolves.toMatchObject({ ownerRevision: 1, grants: [{ grantId: GRANT_ID }] });
    await expect(readFile(path.join(files.roots.grantRoot, GRANT_ID, 'source.txt'), 'utf8')).resolves.toBe(
      'Recover me\n'
    );
  });

  it('removes a manifestless pre-intent source snapshot on restart instead of quarantining private bytes', async () => {
    let crashed = false;
    const crashingFiles = new PresentationRunFiles({
      userDataDir,
      tempDir,
      failureInjector: ({ boundary, grantId }) => {
        if (!crashed && boundary === 'after-grant-temp-fsync' && grantId === GRANT_ID) {
          crashed = true;
          throw new PresentationRunSimulatedProcessCrashError('simulated pre-intent crash');
        }
      },
    });
    const sourcePath = path.join(fixtureRoot, 'pre-intent.txt');
    await writeFile(sourcePath, 'Uncommitted private bytes\n', { mode: 0o600 });

    await expect(crashingFiles.prepareSourceSnapshot({ grantId: GRANT_ID, sourcePath, format: 'txt' })).rejects.toThrow(
      'simulated pre-intent crash'
    );
    await expect(readdir(path.join(crashingFiles.roots.grantRoot, GRANT_ID))).resolves.toEqual([
      expect.stringMatching(/^\.source-.*\.tmp$/),
    ]);

    const restarted = createStore();
    await expect(
      restarted.getPresentationSourceOwner(
        { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        PRINCIPAL_ID
      )
    ).resolves.toMatchObject({ ownerRevision: 0, grants: [] });
    await expect(readdir(files.roots.grantRoot)).resolves.toEqual([]);
    await expect(readdir(files.roots.quarantineRoot)).resolves.toEqual([]);
  });

  it('binds a draft batch once and replays only the same destination tuple', async () => {
    const sourcePath = path.join(fixtureRoot, 'notes.md');
    await writeFile(sourcePath, '# Notes\n', { mode: 0o600 });
    const created = await store.createPresentationSourceDraft(PRINCIPAL_ID, 'draft-request-2');
    const [prepared] = await files.prepareSourceSnapshots([{ grantId: GRANT_ID, sourcePath, format: 'md' }]);
    await store.createPresentationSourceGrants({
      owner: { owner_type: 'draft', draft_id: created.draft.draftId },
      principalId: PRINCIPAL_ID,
      expectedOwnerRevision: 0,
      grants: [
        {
          grantId: GRANT_ID,
          displayName: 'notes.md',
          format: 'md',
          sourceKind: 'external-drop',
          snapshotRelativePath: prepared.finalRelativePath,
          sha256: prepared.sha256,
          byteLength: prepared.byteLength,
          preparedSnapshot: prepared,
        },
      ],
    });

    await expect(
      store.bindPresentationSourceDraft({
        draftId: created.draft.draftId,
        conversationId: CONVERSATION_ID,
        principalId: PRINCIPAL_ID,
        expectedRevision: 1,
      })
    ).resolves.toMatchObject({ status: 'bound', revision: 2 });
    await expect(
      store.bindPresentationSourceDraft({
        draftId: created.draft.draftId,
        conversationId: CONVERSATION_ID,
        principalId: PRINCIPAL_ID,
        expectedRevision: 1,
      })
    ).resolves.toMatchObject({ status: 'already_bound', conversationId: CONVERSATION_ID });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 1, grants: [{ grantId: GRANT_ID }] });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'draft', draft_id: created.draft.draftId }, PRINCIPAL_ID)
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' satisfies PresentationSourceStoreError['code'] });
  });

  it('restores a short conversation owner and bound draft tombstone after restart', async () => {
    const created = await store.createPresentationSourceDraft(PRINCIPAL_ID, 'short-conversation-bind');

    await expect(
      store.bindPresentationSourceDraft({
        draftId: created.draft.draftId,
        conversationId: SHORT_CONVERSATION_ID,
        principalId: PRINCIPAL_ID,
        expectedRevision: 0,
      })
    ).resolves.toMatchObject({
      status: 'bound',
      conversationId: SHORT_CONVERSATION_ID,
    });

    const restarted = createStore();
    await expect(
      restarted.getPresentationSourceOwner(
        { owner_type: 'conversation', conversation_id: SHORT_CONVERSATION_ID },
        PRINCIPAL_ID
      )
    ).resolves.toMatchObject({
      owner: { owner_type: 'conversation', conversation_id: SHORT_CONVERSATION_ID },
      grants: [],
    });
    await expect(journal.readCanonical('draft-tombstone', created.draft.draftId)).resolves.toMatchObject({
      terminalState: 'bound',
      boundConversationId: SHORT_CONVERSATION_ID,
    });
  });

  it('aliases an uppercase legacy owner without changing its physical id or filename', async () => {
    const legacyOwner = {
      owner_type: 'conversation' as const,
      conversation_id: LEGACY_UPPERCASE_CONVERSATION_ID,
    };
    const canonicalOwner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    const legacyOwnerId = presentationSourceOwnerId(legacyOwner);
    const canonicalOwnerId = presentationSourceOwnerId(canonicalOwner);

    expect(legacyOwnerId).not.toBe(canonicalOwnerId);
    await seedLegacyConversationGrant();
    await expect(journal.readCanonical('owner', legacyOwnerId)).resolves.toMatchObject({
      ownerId: legacyOwnerId,
      owner: legacyOwner,
      grantIds: [GRANT_ID],
    });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toMatchObject({ owner: legacyOwner });
    await expect(journal.readCanonical('owner', canonicalOwnerId)).resolves.toBeNull();

    const restarted = createStore();
    await expect(restarted.getPresentationSourceOwner(canonicalOwner, PRINCIPAL_ID)).resolves.toMatchObject({
      owner: canonicalOwner,
      ownerRevision: 1,
      grants: [{ grantId: GRANT_ID, owner: legacyOwner }],
    });
    await expect(
      restarted.revokePresentationSourceGrant({
        owner: canonicalOwner,
        principalId: PRINCIPAL_ID,
        grantId: GRANT_ID,
        expectedOwnerRevision: 1,
      })
    ).resolves.toMatchObject({ status: 'revoked', ownerRevision: 2 });

    await expect(journal.readCanonical('owner', legacyOwnerId)).resolves.toMatchObject({
      ownerId: legacyOwnerId,
      owner: legacyOwner,
      revision: 2,
      grantIds: [],
    });
    await expect(journal.readCanonical('grant-tombstone', GRANT_ID)).resolves.toMatchObject({ owner: legacyOwner });
    await expect(journal.readCanonical('owner', canonicalOwnerId)).resolves.toBeNull();
    await expect(readdir(files.roots.ownerRoot)).resolves.toContain(legacyOwnerId);
  });

  it('replays an uppercase legacy draft binding through the lowercase conversation alias', async () => {
    const legacyOwner = {
      owner_type: 'conversation' as const,
      conversation_id: LEGACY_UPPERCASE_CONVERSATION_ID,
    };
    const canonicalOwner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    const legacyOwnerId = presentationSourceOwnerId(legacyOwner);
    const canonicalOwnerId = presentationSourceOwnerId(canonicalOwner);
    const created = await store.createPresentationSourceDraft(PRINCIPAL_ID, 'legacy-uppercase-bind');
    const draftOwner = { owner_type: 'draft' as const, draft_id: created.draft.draftId };
    const draftOwnerId = presentationSourceOwnerId(draftOwner);
    const storedDraftOwner = await journal.readCanonical<Record<string, unknown>>('owner', draftOwnerId);
    if (storedDraftOwner === null) throw new Error('draft owner fixture was not persisted');
    const boundAt = clock.toISOString();
    const boundDraft = {
      ...created.draft,
      revision: 1,
      state: 'bound' as const,
      updatedAt: boundAt,
      boundConversationId: LEGACY_UPPERCASE_CONVERSATION_ID,
      boundAt,
    };
    const draftTombstone = {
      version: 2 as const,
      recordType: 'presentation-source-draft-tombstone' as const,
      revision: 0,
      draftId: created.draft.draftId,
      clientRequestId: created.draft.clientRequestId,
      principalId: PRINCIPAL_ID,
      terminalState: 'bound' as const,
      terminalAt: boundAt,
      tombstonedAt: boundAt,
      deleteAfter: new Date(clock.getTime() + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS).toISOString(),
      lastRevision: 1,
      boundConversationId: LEGACY_UPPERCASE_CONVERSATION_ID,
    };
    const nextDraftOwner = {
      ...storedDraftOwner,
      revision: 1,
      updatedAt: boundAt,
      draftLifecycle: 'bound',
    };
    const legacyDestination = {
      version: 2 as const,
      recordType: 'presentation-source-owner' as const,
      ownerId: legacyOwnerId,
      owner: legacyOwner,
      principalId: PRINCIPAL_ID,
      revision: 1,
      createdAt: boundAt,
      updatedAt: boundAt,
      grantIds: [],
      unboundBytes: 0,
      draftClientRequestId: null,
      draftLifecycle: null,
    };
    assertPresentationSourceDraftManifest(boundDraft);
    assertPresentationSourceDraftTombstone(draftTombstone);
    assertPresentationSourceOwnerManifest(legacyDestination);
    await journal.transaction({
      mutations: [
        {
          entityKind: 'draft',
          entityId: created.draft.draftId,
          expectedRevision: 0,
          nextManifest: boundDraft,
        },
        {
          entityKind: 'draft-tombstone',
          entityId: created.draft.draftId,
          expectedRevision: null,
          nextManifest: draftTombstone,
        },
        { entityKind: 'owner', entityId: draftOwnerId, expectedRevision: 0, nextManifest: nextDraftOwner },
        { entityKind: 'owner', entityId: legacyOwnerId, expectedRevision: null, nextManifest: legacyDestination },
      ],
    });
    await expect(journal.readCanonical('draft-tombstone', created.draft.draftId)).resolves.toMatchObject({
      terminalState: 'bound',
      boundConversationId: LEGACY_UPPERCASE_CONVERSATION_ID,
    });

    const restarted = createStore();
    await expect(
      restarted.bindPresentationSourceDraft({
        draftId: created.draft.draftId,
        conversationId: CONVERSATION_ID,
        principalId: PRINCIPAL_ID,
        expectedRevision: 0,
      })
    ).resolves.toMatchObject({ status: 'already_bound', conversationId: CONVERSATION_ID });
    await expect(restarted.getPresentationSourceOwner(canonicalOwner, PRINCIPAL_ID)).resolves.toMatchObject({
      owner: canonicalOwner,
      ownerRevision: 1,
    });
    await expect(journal.readCanonical('owner', legacyOwnerId)).resolves.toMatchObject({
      ownerId: legacyOwnerId,
      owner: legacyOwner,
    });
    await expect(journal.readCanonical('owner', canonicalOwnerId)).resolves.toBeNull();
  });

  it('fails closed when uppercase and lowercase owner files collide on one logical conversation', async () => {
    const legacyOwner = {
      owner_type: 'conversation' as const,
      conversation_id: LEGACY_UPPERCASE_CONVERSATION_ID,
    };
    const canonicalOwner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    const legacyOwnerId = presentationSourceOwnerId(legacyOwner);
    const canonicalOwnerId = presentationSourceOwnerId(canonicalOwner);

    await seedLegacyConversationGrant();
    const legacyManifest = await journal.readCanonical<Record<string, unknown>>('owner', legacyOwnerId);
    if (legacyManifest === null) throw new Error('legacy owner fixture was not persisted');
    await journal.transaction({
      mutations: [
        {
          entityKind: 'owner',
          entityId: canonicalOwnerId,
          expectedRevision: null,
          nextManifest: { ...legacyManifest, ownerId: canonicalOwnerId, owner: canonicalOwner },
        },
      ],
    });

    const restarted = createStore();
    await expect(restarted.initialize()).rejects.toThrow('Duplicate presentation source owner');
    await expect(journal.readCanonical('owner', legacyOwnerId)).resolves.toMatchObject({ owner: legacyOwner });
    await expect(journal.readCanonical('owner', canonicalOwnerId)).resolves.toMatchObject({ owner: canonicalOwner });
  });

  it('claims a Task 3 grant atomically with its owner accounting and restores the claim after restart', async () => {
    store = createStore(() => RUN_ID);
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared } = await createGrant();

    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: 'allocate-task-3-grant',
      selectedTemplateId: 'business-review',
      requestFingerprint: 'a'.repeat(64),
      grantClaims: [{ grantId: GRANT_ID, expectedRevision: 0 }],
    });

    expect(allocated).toMatchObject({
      ok: true,
      status: 'created',
      run: { runId: RUN_ID, sourceGrants: [GRANT_ID], retainedBytes: prepared.byteLength },
    });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toMatchObject({
      recordType: 'presentation-source-grant',
      revision: 1,
      state: 'claimed',
      claimedRunId: RUN_ID,
    });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 2, grants: [] });
    await expect(
      journal.readCanonical(
        'owner',
        presentationSourceOwnerId({ owner_type: 'conversation', conversation_id: CONVERSATION_ID })
      )
    ).resolves.toMatchObject({ revision: 2, grantIds: [], unboundBytes: 0 });

    const restarted = createStore(() => RUN_ID);
    await expect(restarted.getRun(RUN_ID)).resolves.toMatchObject({ sourceGrants: [GRANT_ID] });
    await expect(
      restarted.getPresentationSourceOwner(
        { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        PRINCIPAL_ID
      )
    ).resolves.toMatchObject({ ownerRevision: 2, grants: [] });
  });

  it('consumes claimed Task 3 grants in the durable turn-binding transaction and restores them after restart', async () => {
    store = createStore(() => RUN_ID);
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared: sourceSnapshot } = await createGrant();
    const allocated = await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: 'bind-task-3-grant',
      selectedTemplateId: 'business-review',
      requestFingerprint: 'b'.repeat(64),
      grantClaims: [{ grantId: GRANT_ID, expectedRevision: 0 }],
    });
    if (!allocated.ok) throw new Error('allocation unexpectedly failed');
    await store.transitionRun(RUN_ID, {
      expectedRevision: 0,
      dispatchStatus: 'allocating',
      artifactPhase: 'sources_snapshotted',
      now: '2026-08-04T00:00:01.000Z',
    });
    clock = new Date('2026-08-04T00:00:02.000Z');
    const candidateBytes = Buffer.from('stable presentation candidate');
    const themeBytes = Buffer.from('{"name":"test theme"}\n');
    const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
    const preparedRun = await files.prepareRunAssets({
      runId: RUN_ID,
      candidateBytes,
      grounding: '# Grounding\n\nVerified source evidence.\n',
      rawInput: 'Prepare the quarterly business review.',
      directive: 'Edit candidate.pptx and write plan.json.',
      sourceRefs: [
        {
          grantId: GRANT_ID,
          expectedByteLength: sourceSnapshot.byteLength,
          expectedSha256: sourceSnapshot.sha256,
        },
      ],
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
    const committed = await store.commitPreparedRun(RUN_ID, 1, preparedRun);
    clock = new Date('2026-08-04T00:00:03.000Z');
    const claimed = await store.claimInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      holderId: DRAFT_ID,
      expectedRevision: committed.revision,
    });
    const dispatching = await store.beginInitialDispatch({
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      leaseToken: claimed.leaseToken,
      expectedRevision: claimed.manifest.revision,
    });

    clock = new Date('2026-08-04T00:00:04.000Z');
    await expect(
      store.bindRunTurn(RUN_ID, {
        expectedRevision: dispatching.revision,
        conversationId: CONVERSATION_ID,
        turnId: 'turn-task-3',
        runtime: 'aionrs',
        now: '2026-08-04T00:00:04.000Z',
      })
    ).resolves.toMatchObject({ status: 'bound', manifest: { revision: 5 } });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toMatchObject({
      revision: 2,
      state: 'consumed',
      stateEnteredAt: '2026-08-04T00:00:04.000Z',
      claimedRunId: RUN_ID,
    });

    const restarted = createStore(() => RUN_ID);
    await expect(restarted.getRun(RUN_ID)).resolves.toMatchObject({
      dispatchStatus: 'bound',
      sourceGrants: [GRANT_ID],
    });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toMatchObject({ state: 'consumed' });
  });

  it('recovers durable queue-unbound revoke proof after the first reply is lost and the app restarts', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared } = await createGrant();
    const request = {
      owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      grantId: GRANT_ID,
      expectedOwnerRevision: 1,
    };

    const first = await store.revokePresentationSourceGrant(request);
    await expect(journal.readCanonical('grant-tombstone', GRANT_ID)).resolves.toMatchObject({
      version: 3,
      terminalState: 'revoked',
      queueUnboundAtRevoke: true,
    });
    const restarted = createStore();
    await expect(
      restarted.extendPresentationSourceGrantsForQueue({
        owner: request.owner,
        principalId: PRINCIPAL_ID,
        sources: [
          {
            grantId: GRANT_ID,
            expectedByteLength: prepared.byteLength,
            expectedSha256: prepared.sha256,
          },
        ],
        queueItemId: '00000000-0000-4000-8000-000000000108',
        expectedOwnerRevision: 1,
      })
    ).rejects.toMatchObject({
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId: GRANT_ID, queueUnboundAtRevoke: true },
    });
    const replay = await restarted.revokePresentationSourceGrant(request);

    expect(first).toMatchObject({ status: 'revoked', ownerRevision: 2, queueUnboundAtRevoke: true });
    expect(replay).toEqual({
      status: 'already_revoked',
      grantId: GRANT_ID,
      ownerRevision: 2,
      revokedAt: first.revokedAt,
      queueUnboundAtRevoke: true,
    });
  });

  it('keeps an exact legacy v2 revoked tombstone unproven after restart', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared } = await createGrant();
    const request = {
      owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      grantId: GRANT_ID,
      expectedOwnerRevision: 1,
    };
    await store.revokePresentationSourceGrant(request);
    const persisted = await journal.readCanonical<Record<string, unknown>>('grant-tombstone', GRANT_ID);
    if (persisted === null) throw new Error('Expected the durable revoke tombstone');
    const legacy = structuredClone(persisted);
    legacy.version = 2;
    delete legacy.queueUnboundAtRevoke;
    await writeFile(files.getEntityManifestPath('grant-tombstone', GRANT_ID), `${JSON.stringify(legacy)}\n`, {
      mode: 0o600,
    });

    const restarted = createStore();
    const legacyConfirmationFailure = await restarted
      .extendPresentationSourceGrantsForQueue({
        owner: request.owner,
        principalId: PRINCIPAL_ID,
        sources: [
          {
            grantId: GRANT_ID,
            expectedByteLength: prepared.byteLength,
            expectedSha256: prepared.sha256,
          },
        ],
        queueItemId: '00000000-0000-4000-8000-000000000109',
        expectedOwnerRevision: 1,
      })
      .then(
        () => null,
        (error: PresentationSourceStoreError) => error
      );
    expect(legacyConfirmationFailure).toMatchObject({
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId: GRANT_ID },
    });
    expect(legacyConfirmationFailure?.details).toEqual({ grantId: GRANT_ID });
    await expect(restarted.revokePresentationSourceGrant(request)).resolves.toMatchObject({
      status: 'already_revoked',
      grantId: GRANT_ID,
      queueUnboundAtRevoke: false,
    });
  });

  it('prefers a later durable queue-unbound proof over an earlier legacy tombstone', async () => {
    const owner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    await store.getPresentationSourceOwner(owner, PRINCIPAL_ID);
    const created = await createGrantBatch({
      owner,
      expectedOwnerRevision: 0,
      grantIds: [GRANT_ID, GRANT_B],
    });
    await store.revokePresentationSourceGrant({
      owner,
      principalId: PRINCIPAL_ID,
      grantId: GRANT_B,
      expectedOwnerRevision: created.ownerRevision,
    });
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);
    await expect(store.sweepExpiredPresentationSources()).resolves.toMatchObject({ expiredGrants: [GRANT_ID] });
    await expect(journal.readCanonical('grant-tombstone', GRANT_ID)).resolves.toMatchObject({
      version: 2,
      terminalState: 'expired',
    });
    await expect(journal.readCanonical('grant-tombstone', GRANT_B)).resolves.toMatchObject({
      version: 3,
      terminalState: 'revoked',
      queueUnboundAtRevoke: true,
    });

    const restarted = createStore();
    await expect(
      restarted.extendPresentationSourceGrantsForQueue({
        owner,
        principalId: PRINCIPAL_ID,
        sources: created.grants.map((grant) => ({
          grantId: grant.grantId,
          expectedByteLength: grant.byteLength,
          expectedSha256: grant.sha256,
        })),
        queueItemId: '00000000-0000-4000-8000-000000000110',
        expectedOwnerRevision: created.ownerRevision,
      })
    ).rejects.toMatchObject({
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId: GRANT_B, queueUnboundAtRevoke: true },
    });
  });

  it('returns DRAFT_NOT_FOUND at the exact draft tombstone delete boundary without a prior sweep', async () => {
    await store.createPresentationSourceDraft(PRINCIPAL_ID, 'expired-draft-request');
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'draft', draft_id: DRAFT_ID }, PRINCIPAL_ID)
    ).rejects.toMatchObject({ code: 'DRAFT_EXPIRED' });
    clock = new Date(clock.getTime() + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS - 1);
    await expect(
      store.bindPresentationSourceDraft({
        draftId: DRAFT_ID,
        conversationId: CONVERSATION_ID,
        principalId: PRINCIPAL_ID,
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'DRAFT_EXPIRED' });
    clock = new Date(clock.getTime() + 1);

    await expect(
      store.bindPresentationSourceDraft({
        draftId: DRAFT_ID,
        conversationId: CONVERSATION_ID,
        principalId: PRINCIPAL_ID,
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' });
    await expect(store.createPresentationSourceDraft(PRINCIPAL_ID, 'expired-draft-request')).rejects.toMatchObject({
      code: 'DRAFT_NOT_FOUND',
    });
  });

  it('records draft expiry as a revisioned mutation in the tombstone', async () => {
    await store.createPresentationSourceDraft(PRINCIPAL_ID, 'revisioned-expiry');
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);

    await store.sweepExpiredPresentationSources();

    await expect(journal.readCanonical('draft-tombstone', DRAFT_ID)).resolves.toMatchObject({
      terminalState: 'expired',
      lastRevision: 1,
    });
  });

  it('does not attach a prepared grant to a draft at the exact draft expiry boundary', async () => {
    await store.createPresentationSourceDraft(PRINCIPAL_ID, 'expired-draft-grant');
    const sourcePath = path.join(fixtureRoot, 'expired-draft.txt');
    await writeFile(sourcePath, 'too late\n', { mode: 0o600 });
    const [prepared] = await files.prepareSourceSnapshots([{ grantId: GRANT_ID, sourcePath, format: 'txt' }]);
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);

    await expect(
      store.createPresentationSourceGrants({
        owner: { owner_type: 'draft', draft_id: DRAFT_ID },
        principalId: PRINCIPAL_ID,
        expectedOwnerRevision: 0,
        grants: [
          {
            grantId: GRANT_ID,
            displayName: 'expired-draft.txt',
            format: 'txt',
            sourceKind: 'native-picker',
            snapshotRelativePath: prepared.finalRelativePath,
            sha256: prepared.sha256,
            byteLength: prepared.byteLength,
            preparedSnapshot: prepared,
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'DRAFT_EXPIRED', details: { draftId: DRAFT_ID } });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toBeNull();
  });

  it('rejects active draft manifests with a partial binding tuple', () => {
    const activeDraft = {
      version: 2 as const,
      recordType: 'presentation-source-draft' as const,
      draftId: DRAFT_ID,
      clientRequestId: 'partial-bind',
      principalId: PRINCIPAL_ID,
      revision: 0,
      state: 'active' as const,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS).toISOString(),
      boundConversationId: CONVERSATION_ID,
      boundAt: null,
    };

    expect(() => assertPresentationSourceDraftManifest(activeDraft)).toThrow(
      'Invalid presentation source draft manifest'
    );
  });

  it('rejects active grant manifests whose state or expiry timestamps precede updatedAt', () => {
    const activeGrant = {
      version: 2 as const,
      recordType: 'presentation-source-grant' as const,
      grantId: GRANT_ID,
      owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
      revision: 0,
      displayName: 'brief.txt',
      format: 'txt' as const,
      sourceKind: 'native-picker' as const,
      snapshotRelativePath: 'source.txt' as const,
      sha256: 'a'.repeat(64),
      byteLength: 1,
      createdAt: NOW.toISOString(),
      updatedAt: '2026-08-04T00:10:00.000Z',
      expiresAt: '2026-08-04T00:05:00.000Z',
      stateEnteredAt: '2026-08-04T00:11:00.000Z',
      state: 'active' as const,
      queueExtendedAt: null,
      queueItemId: null,
      claimedRunId: null,
    };

    expect(() => assertPresentationSourceGrantManifest(activeGrant)).toThrow(
      'Invalid presentation source lifecycle timestamps'
    );
  });

  it('extends an unexpired grant once from the exact 15-minute window to the exact 24-hour queue boundary', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared } = await createGrant();
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS - 1);

    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        principalId: PRINCIPAL_ID,
        sources: [
          {
            grantId: GRANT_ID,
            expectedByteLength: prepared.byteLength,
            expectedSha256: prepared.sha256,
          },
        ],
        queueItemId: '00000000-0000-4000-8000-000000000100',
        expectedOwnerRevision: 1,
      })
    ).resolves.toMatchObject({ ownerRevision: 2, grants: [{ grantId: GRANT_ID }] });
    const queueExpiresAt = new Date(clock.getTime() + PRESENTATION_RUN_LIMITS.QUEUED_GRANT_TTL_MS);
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toMatchObject({
      revision: 1,
      queueExtendedAt: clock.toISOString(),
      queueItemId: '00000000-0000-4000-8000-000000000100',
      expiresAt: queueExpiresAt.toISOString(),
    });

    clock = new Date(queueExpiresAt.getTime() - 1);
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 2, grants: [{ grantId: GRANT_ID }] });
    clock = queueExpiresAt;
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 3, grants: [] });
  });

  it('keeps an ordinary grant at 14:59.999 and expires it in the manual sweep at exactly 15:00.000', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS - 1);

    await expect(store.sweepExpiredPresentationSources()).resolves.toMatchObject({ expiredGrants: [] });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 1, grants: [{ grantId: GRANT_ID }] });
    clock = new Date(clock.getTime() + 1);
    await expect(store.sweepExpiredPresentationSources()).resolves.toMatchObject({ expiredGrants: [GRANT_ID] });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 2, grants: [] });
    await expect(journal.readCanonical('grant-tombstone', GRANT_ID)).resolves.toMatchObject({
      terminalAt: clock.toISOString(),
      deleteAfter: new Date(clock.getTime() + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS).toISOString(),
    });
  });

  it('preserves an expired grant failure when allocating after the expiry sweep', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);
    await store.sweepExpiredPresentationSources();

    await expect(
      store.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: 'expired-tombstone-allocation',
        selectedTemplateId: 'business-review',
        requestFingerprint: '1'.repeat(64),
        grantClaims: [{ grantId: GRANT_ID, expectedRevision: 1 }],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_EXPIRED',
      state: 'grant_expired',
      details: { grantId: GRANT_ID },
    });
  });

  it('preserves replay and owner failures for a revoked grant tombstone after restart', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();
    await store.revokePresentationSourceGrant({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      grantId: GRANT_ID,
      expectedOwnerRevision: 1,
    });

    const restarted = createStore(() => RUN_ID);
    await expect(
      restarted.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: 'revoked-tombstone-replay',
        selectedTemplateId: 'business-review',
        requestFingerprint: '2'.repeat(64),
        grantClaims: [{ grantId: GRANT_ID, expectedRevision: 1 }],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_REPLAYED',
      state: 'grant_validation',
      details: { grantId: GRANT_ID },
    });
    await expect(
      restarted.allocateRun({
        conversationId: testUuid(4_501),
        clientRequestId: 'revoked-tombstone-foreign',
        selectedTemplateId: 'business-review',
        requestFingerprint: '3'.repeat(64),
        grantClaims: [{ grantId: GRANT_ID, expectedRevision: 1 }],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_FOREIGN',
      state: 'grant_validation',
      details: { grantId: GRANT_ID },
    });
  });

  it('runs the same exact grant expiry transition during startup recovery', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);

    const restarted = createStore();
    await restarted.initialize();

    await expect(
      restarted.getPresentationSourceOwner(
        { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        PRINCIPAL_ID
      )
    ).resolves.toMatchObject({ ownerRevision: 2, grants: [] });
    await expect(journal.readCanonical('grant-tombstone', GRANT_ID)).resolves.toMatchObject({
      terminalState: 'expired',
      terminalAt: clock.toISOString(),
    });
  });

  it('rejects queue extension at the exact original 15-minute expiry boundary', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared } = await createGrant();
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);

    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        principalId: PRINCIPAL_ID,
        sources: [
          {
            grantId: GRANT_ID,
            expectedByteLength: prepared.byteLength,
            expectedSha256: prepared.sha256,
          },
        ],
        queueItemId: '00000000-0000-4000-8000-000000000104',
        expectedOwnerRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_GRANT_EXPIRED', details: { grantId: GRANT_ID } });
  });

  it('replays the exact queue and complete ref set with the pre-mutation revision without extending TTL twice', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared } = await createGrant();
    clock = new Date(NOW.getTime() + 1_000);
    await store.extendPresentationSourceGrantsForQueue({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      sources: [
        {
          grantId: GRANT_ID,
          expectedByteLength: prepared.byteLength,
          expectedSha256: prepared.sha256,
        },
      ],
      queueItemId: '00000000-0000-4000-8000-000000000105',
      expectedOwnerRevision: 1,
    });
    const first = await journal.readCanonical('grant', GRANT_ID);

    const replay = await store.extendPresentationSourceGrantsForQueue({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      sources: [
        {
          grantId: GRANT_ID,
          expectedByteLength: prepared.byteLength,
          expectedSha256: prepared.sha256,
        },
      ],
      queueItemId: '00000000-0000-4000-8000-000000000105',
      expectedOwnerRevision: 1,
    });

    expect(replay).toMatchObject({ status: 'already_confirmed', ownerRevision: 2 });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toEqual(first);
    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        principalId: PRINCIPAL_ID,
        sources: [
          {
            grantId: GRANT_ID,
            expectedByteLength: prepared.byteLength,
            expectedSha256: prepared.sha256,
          },
        ],
        queueItemId: '00000000-0000-4000-8000-000000000105',
        expectedOwnerRevision: 2,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_GRANT_REPLAYED', details: { grantId: GRANT_ID } });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toEqual(first);
  });

  it('keeps every grant in a confirmed multi-source queue immutable when one grant is revoked', async () => {
    const owner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    await store.getPresentationSourceOwner(owner, PRINCIPAL_ID);
    const created = await createGrantBatch({
      owner,
      expectedOwnerRevision: 0,
      grantIds: [GRANT_ID, GRANT_B],
    });
    const sources = created.grants.map((grant) => ({
      grantId: grant.grantId,
      expectedByteLength: grant.byteLength,
      expectedSha256: grant.sha256,
    }));
    const queueItemId = '00000000-0000-4000-8000-000000000107';
    const confirmed = await store.extendPresentationSourceGrantsForQueue({
      owner,
      principalId: PRINCIPAL_ID,
      sources,
      queueItemId,
      expectedOwnerRevision: created.ownerRevision,
    });
    const ownerBeforeRevoke = await store.getPresentationSourceOwner(owner, PRINCIPAL_ID);
    const grantsBeforeRevoke = await Promise.all([
      journal.readCanonical('grant', GRANT_ID),
      journal.readCanonical('grant', GRANT_B),
    ]);

    await expect(
      store.revokePresentationSourceGrant({
        owner,
        principalId: PRINCIPAL_ID,
        grantId: GRANT_ID,
        expectedOwnerRevision: confirmed.ownerRevision,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_GRANT_REPLAYED', details: { grantId: GRANT_ID } });

    await expect(store.getPresentationSourceOwner(owner, PRINCIPAL_ID)).resolves.toEqual(ownerBeforeRevoke);
    await expect(journal.readCanonical('grant-tombstone', GRANT_ID)).resolves.toBeNull();
    await expect(
      Promise.all([journal.readCanonical('grant', GRANT_ID), journal.readCanonical('grant', GRANT_B)])
    ).resolves.toEqual(grantsBeforeRevoke);
    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner,
        principalId: PRINCIPAL_ID,
        sources,
        queueItemId,
        expectedOwnerRevision: created.ownerRevision,
      })
    ).resolves.toMatchObject({ status: 'already_confirmed', ownerRevision: confirmed.ownerRevision });
  });

  it('replays an exact queued ref after an unrelated owner mutation and restart', async () => {
    const owner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    await store.getPresentationSourceOwner(owner, PRINCIPAL_ID);
    const created = await createGrantBatch({
      owner,
      expectedOwnerRevision: 0,
      grantIds: [GRANT_ID, GRANT_B],
    });
    const queuedGrant = created.grants.find(({ grantId }) => grantId === GRANT_ID);
    if (queuedGrant === undefined) throw new Error('Expected the queued source grant');
    const sources = [
      {
        grantId: queuedGrant.grantId,
        expectedByteLength: queuedGrant.byteLength,
        expectedSha256: queuedGrant.sha256,
      },
    ];
    const queueItemId = '00000000-0000-4000-8000-000000000106';
    clock = new Date(NOW.getTime() + 1_000);
    const confirmed = await store.extendPresentationSourceGrantsForQueue({
      owner,
      principalId: PRINCIPAL_ID,
      sources,
      queueItemId,
      expectedOwnerRevision: 1,
    });
    const confirmedGrant = await journal.readCanonical('grant', GRANT_ID);

    clock = new Date(NOW.getTime() + 2_000);
    await store.revokePresentationSourceGrant({
      owner,
      principalId: PRINCIPAL_ID,
      grantId: GRANT_B,
      expectedOwnerRevision: confirmed.ownerRevision,
    });
    const restarted = createStore();
    const replay = await restarted.extendPresentationSourceGrantsForQueue({
      owner,
      principalId: PRINCIPAL_ID,
      sources,
      queueItemId,
      expectedOwnerRevision: 1,
    });

    expect(replay).toMatchObject({
      status: 'already_confirmed',
      ownerRevision: 3,
      expiresAt: confirmed.expiresAt,
    });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toEqual(confirmedGrant);
  });

  it('rejects a different queue binding without changing the first durable expiry', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const { prepared } = await createGrant();
    clock = new Date(NOW.getTime() + 1_000);
    await store.extendPresentationSourceGrantsForQueue({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      sources: [
        {
          grantId: GRANT_ID,
          expectedByteLength: prepared.byteLength,
          expectedSha256: prepared.sha256,
        },
      ],
      queueItemId: '00000000-0000-4000-8000-000000000101',
      expectedOwnerRevision: 1,
    });
    const first = await journal.readCanonical('grant', GRANT_ID);

    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        principalId: PRINCIPAL_ID,
        sources: [
          {
            grantId: GRANT_ID,
            expectedByteLength: prepared.byteLength,
            expectedSha256: prepared.sha256,
          },
        ],
        queueItemId: '00000000-0000-4000-8000-000000000102',
        expectedOwnerRevision: 2,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_GRANT_REPLAYED', details: { grantId: GRANT_ID } });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toEqual(first);
  });

  it('rejects partial, superset, hash-drift, and length-drift replays of a queued grant set', async () => {
    const owner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    await store.getPresentationSourceOwner(owner, PRINCIPAL_ID);
    const created = await createGrantBatch({
      owner,
      expectedOwnerRevision: 0,
      grantIds: [GRANT_ID, GRANT_B],
    });
    const refs = created.grants.map(({ grantId, byteLength, sha256 }) => ({
      grantId,
      expectedByteLength: byteLength,
      expectedSha256: sha256,
    }));
    const queueItemId = '00000000-0000-4000-8000-000000000103';
    await store.extendPresentationSourceGrantsForQueue({
      owner,
      principalId: PRINCIPAL_ID,
      sources: refs,
      queueItemId,
      expectedOwnerRevision: 1,
    });

    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner,
        principalId: PRINCIPAL_ID,
        sources: refs.slice(0, 1),
        queueItemId,
        expectedOwnerRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_GRANT_REPLAYED' });
    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner,
        principalId: PRINCIPAL_ID,
        sources: [...refs, { ...refs[0]!, grantId: RUN_ID }],
        queueItemId,
        expectedOwnerRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_GRANT_INVALID' });
    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner,
        principalId: PRINCIPAL_ID,
        sources: [{ ...refs[0]!, expectedSha256: 'f'.repeat(64) }, refs[1]!],
        queueItemId,
        expectedOwnerRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_TAMPERED' });
    await expect(
      store.extendPresentationSourceGrantsForQueue({
        owner,
        principalId: PRINCIPAL_ID,
        sources: [{ ...refs[0]!, expectedByteLength: refs[0]!.expectedByteLength + 1 }, refs[1]!],
        queueItemId,
        expectedOwnerRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_TAMPERED' });
  });

  it('retains an idempotent revoke for seven days and treats the grant as invalid at deleteAfter', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();
    const request = {
      owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
      principalId: PRINCIPAL_ID,
      grantId: GRANT_ID,
      expectedOwnerRevision: 1,
    };
    await store.revokePresentationSourceGrant(request);
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS - 1);

    await expect(store.revokePresentationSourceGrant(request)).resolves.toMatchObject({ status: 'already_revoked' });
    clock = new Date(clock.getTime() + 1);
    await expect(store.revokePresentationSourceGrant({ ...request, expectedOwnerRevision: 2 })).rejects.toMatchObject({
      code: 'SOURCE_GRANT_INVALID',
      details: { grantId: GRANT_ID },
    });
  });

  it('expires an active grant instead of revoking it at the exact 15-minute boundary', async () => {
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);

    await expect(
      store.revokePresentationSourceGrant({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        principalId: PRINCIPAL_ID,
        grantId: GRANT_ID,
        expectedOwnerRevision: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_GRANT_EXPIRED', details: { grantId: GRANT_ID } });
  });

  it('leaves every Task 3 grant and owner byte unchanged when one snapshot is tampered before allocation', async () => {
    store = createStore(() => RUN_ID);
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    const first = await createGrant({ grantId: GRANT_ID, content: 'first source\n' });
    const second = await createGrant({
      grantId: GRANT_B,
      expectedOwnerRevision: 1,
      content: 'second source\n',
    });
    await writeFile(path.join(files.roots.grantRoot, GRANT_B, 'source.txt'), 'tampered source\n');

    await expect(
      store.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: 'tampered-task-3-batch',
        selectedTemplateId: 'business-review',
        requestFingerprint: 'c'.repeat(64),
        grantClaims: [
          { grantId: GRANT_ID, expectedRevision: 0 },
          { grantId: GRANT_B, expectedRevision: 0 },
        ],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_TAMPERED',
      details: { grantId: GRANT_B },
    });
    await expect(journal.readCanonical('grant', GRANT_ID)).resolves.toMatchObject({ revision: 0, state: 'active' });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({
      ownerRevision: 2,
      grants: [{ grantId: GRANT_B }, { grantId: GRANT_ID }],
    });
    expect(first.prepared.byteLength + second.prepared.byteLength).toBeGreaterThan(0);
  });

  it('rejects a Task 3 grant owned by another conversation without mutating its owner', async () => {
    const foreignConversation = testUuid(4_500);
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();

    await expect(
      store.allocateRun({
        conversationId: foreignConversation,
        clientRequestId: 'foreign-task-3-grant',
        selectedTemplateId: 'business-review',
        requestFingerprint: 'd'.repeat(64),
        grantClaims: [{ grantId: GRANT_ID, expectedRevision: 0 }],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_FOREIGN',
      details: { grantId: GRANT_ID },
    });
    await expect(
      store.getPresentationSourceOwner({ owner_type: 'conversation', conversation_id: CONVERSATION_ID }, PRINCIPAL_ID)
    ).resolves.toMatchObject({ ownerRevision: 1, grants: [{ grantId: GRANT_ID }] });
  });

  it('rejects a Task 3 grant replay after its first run claim', async () => {
    store = createStore(() => RUN_ID);
    await store.getPresentationSourceOwner(
      { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      PRINCIPAL_ID
    );
    await createGrant();
    await store.allocateRun({
      conversationId: CONVERSATION_ID,
      clientRequestId: 'first-task-3-claim',
      selectedTemplateId: 'business-review',
      requestFingerprint: 'e'.repeat(64),
      grantClaims: [{ grantId: GRANT_ID, expectedRevision: 0 }],
    });

    await expect(
      store.allocateRun({
        conversationId: CONVERSATION_ID,
        clientRequestId: 'replayed-task-3-claim',
        selectedTemplateId: 'business-review',
        requestFingerprint: 'f'.repeat(64),
        grantClaims: [{ grantId: GRANT_ID, expectedRevision: 1 }],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId: GRANT_ID },
    });
  });

  it('enforces 16 grants per owner and 64 grants per app before promoting a 17th or 65th grant', async () => {
    const owners = Array.from({ length: 5 }, (_, index) => ({
      owner_type: 'conversation' as const,
      conversation_id: testUuid(100 + index),
    }));
    const firstOwnerGrantIds = Array.from({ length: 16 }, (_, index) => testUuid(1_000 + index));
    await store.getPresentationSourceOwner(owners[0]!, PRINCIPAL_ID);
    await expect(
      createGrantBatch({ owner: owners[0]!, expectedOwnerRevision: 0, grantIds: firstOwnerGrantIds })
    ).resolves.toMatchObject({ ownerRevision: 1 });
    const seventeenth = testUuid(2_000);
    await expect(
      createGrantBatch({ owner: owners[0]!, expectedOwnerRevision: 1, grantIds: [seventeenth] })
    ).rejects.toMatchObject({ code: 'GRANT_LIMIT_EXCEEDED' });
    await Promise.all(
      owners.slice(1, 4).map(async (owner, ownerIndex) => {
        await store.getPresentationSourceOwner(owner, PRINCIPAL_ID);
        const grantIds = Array.from({ length: 16 }, (_, index) => testUuid(1_016 + ownerIndex * 16 + index));
        await expect(createGrantBatch({ owner, expectedOwnerRevision: 0, grantIds })).resolves.toMatchObject({
          ownerRevision: 1,
        });
      })
    );
    await store.getPresentationSourceOwner(owners[4]!, PRINCIPAL_ID);
    const sixtyFifth = testUuid(2_001);

    await expect(
      createGrantBatch({ owner: owners[4]!, expectedOwnerRevision: 0, grantIds: [sixtyFifth] })
    ).rejects.toMatchObject({ code: 'GRANT_LIMIT_EXCEEDED' });
    // Explicit budget: this writes 65 real grants through the journal and the file store, and
    // measured 2,219ms alone against the 10s default. That looks like ample headroom and is not:
    // in a full-suite run on a loaded machine the same test took 10,463ms and timed out. Vitest
    // durations here inflate several-fold under concurrent work, so a test doing real I/O needs a
    // budget set from its loaded cost, not its idle one. Lower this only with a measurement.
  }, 30_000);

  it('accepts exactly 256 MiB per owner and 512 MiB per app, then rejects the next accounted byte', async () => {
    files = new QuotaAccountingFiles({ userDataDir, tempDir });
    journal = new PresentationRunJournal({ files, now: () => clock });
    store = new PresentationRunStore({
      files,
      journal,
      getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
      now: () => clock,
    });
    const ownerA = { owner_type: 'conversation' as const, conversation_id: testUuid(5_000) };
    const ownerB = { owner_type: 'conversation' as const, conversation_id: testUuid(5_001) };
    const ownerC = { owner_type: 'conversation' as const, conversation_id: testUuid(5_002) };
    const fourGrantIds = (offset: number): string[] =>
      Array.from({ length: 4 }, (_, index) => testUuid(offset + index));
    await store.getPresentationSourceOwner(ownerA, PRINCIPAL_ID);

    const ownerBoundary = await createAccountedGrantBatch({
      owner: ownerA,
      expectedOwnerRevision: 0,
      grantIds: fourGrantIds(6_000),
      declaredByteLength: PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES,
    });
    expect(ownerBoundary.grants.reduce((total, grant) => total + grant.byteLength, 0)).toBe(
      PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANT_BYTES_PER_OWNER
    );
    await expect(
      createAccountedGrantBatch({
        owner: ownerA,
        expectedOwnerRevision: 1,
        grantIds: [testUuid(6_004)],
        declaredByteLength: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_LIMIT_EXCEEDED' });

    await store.getPresentationSourceOwner(ownerB, PRINCIPAL_ID);
    const appBoundary = await createAccountedGrantBatch({
      owner: ownerB,
      expectedOwnerRevision: 0,
      grantIds: fourGrantIds(7_000),
      declaredByteLength: PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES,
    });
    expect(
      ownerBoundary.grants.reduce((total, grant) => total + grant.byteLength, 0) +
        appBoundary.grants.reduce((total, grant) => total + grant.byteLength, 0)
    ).toBe(PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANT_BYTES_PER_APP);
    await store.getPresentationSourceOwner(ownerC, PRINCIPAL_ID);
    await expect(
      createAccountedGrantBatch({
        owner: ownerC,
        expectedOwnerRevision: 0,
        grantIds: [testUuid(8_000)],
        declaredByteLength: 1,
      })
    ).rejects.toMatchObject({ code: 'SOURCE_LIMIT_EXCEEDED' });
  });

  it('holds the 17th draft slot until exact-boundary expiry is swept, then reclaims it', async () => {
    const draftIds = Array.from({ length: 17 }, (_, index) => testUuid(3_000 + index));
    let nextDraftId = 0;
    store = createStore(() => draftIds[nextDraftId++]!);
    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        expect(store.createPresentationSourceDraft(PRINCIPAL_ID, `draft-cap-${index}`)).resolves.toMatchObject({
          status: 'created',
        })
      )
    );
    clock = new Date(NOW.getTime() + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS);
    await expect(store.createPresentationSourceDraft(PRINCIPAL_ID, 'draft-cap-16')).rejects.toMatchObject({
      code: 'DRAFT_LIMIT_EXCEEDED',
    });

    await expect(store.sweepExpiredPresentationSources()).resolves.toMatchObject({
      expiredDrafts: expect.arrayContaining(draftIds.slice(0, 16)),
    });
    await expect(store.createPresentationSourceDraft(PRINCIPAL_ID, 'draft-cap-16')).resolves.toMatchObject({
      status: 'created',
      draft: { draftId: draftIds[16] },
    });
  });

  it('rejects a foreign draft principal and a conflicting destination after the authorized bind', async () => {
    await store.createPresentationSourceDraft(PRINCIPAL_ID, 'draft-owner-check');

    await expect(
      store.bindPresentationSourceDraft({
        draftId: DRAFT_ID,
        conversationId: CONVERSATION_ID,
        principalId: 'principal-b',
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'DRAFT_FOREIGN' });
    await store.bindPresentationSourceDraft({
      draftId: DRAFT_ID,
      conversationId: CONVERSATION_ID,
      principalId: PRINCIPAL_ID,
      expectedRevision: 0,
    });
    const conflictingConversation = testUuid(4_000);

    await expect(
      store.bindPresentationSourceDraft({
        draftId: DRAFT_ID,
        conversationId: conflictingConversation,
        principalId: PRINCIPAL_ID,
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({
      code: 'DRAFT_ALREADY_BOUND',
      details: { draftId: DRAFT_ID, conversationId: CONVERSATION_ID },
    });
  });
});
