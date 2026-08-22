/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { link, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PresentationRunFailureCode } from '@/common/types/office/presentationRun';
import { PresentationSourceGrantService } from '@/process/services/presentation-template/run/service';
import {
  PresentationRunFiles,
  type PresentationRunFileFailurePoint,
  PresentationRunJournal,
  PresentationRunStore,
  PresentationSourceStoreError,
} from '@/process/services/presentation-template/run/storage';

const CONVERSATION_ID = '745b7d43-a0aa-4bb7-b0cc-283f2db4873d';
const SECOND_CONVERSATION_ID = '8a3bbfb3-141e-4cf3-8a45-a8b61585385c';
const SHORT_CONVERSATION_ID = 'd0921953';
const PRINCIPAL_ID = 'local-user';
const CLIENT_REQUEST_ID = '326ce889-fbba-462b-82f1-fe8b7bc594b0';
const QUEUE_ITEM_ID = '37f0a614-3e7f-41b5-87fd-49076fcf078d';
const fixtureRoots: string[] = [];

function createService(
  overrides: {
    featureEnabled?: boolean;
    desktopRuntime?: boolean;
    principalId?: string | null;
    ownerCode?: 'RUN_NOT_FOUND' | 'RUN_FORBIDDEN' | 'SCOPE_UNAVAILABLE' | 'TEAM_SCOPE_UNSUPPORTED';
    teamScope?: boolean;
    fileFailureInjector?: (point: PresentationRunFileFailurePoint) => void | Promise<void>;
    now?: () => Date;
    root?: string;
  } = {}
) {
  const root = overrides.root ?? mkdtempSync(path.join(tmpdir(), 'presentation-grant-service-'));
  const workspace = path.join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  if (!fixtureRoots.includes(root)) fixtureRoots.push(root);
  const files = new PresentationRunFiles({
    userDataDir: root,
    tempDir: root,
    failureInjector: overrides.fileFailureInjector,
  });
  const journal = new PresentationRunJournal({ files, now: overrides.now });
  const store = new PresentationRunStore({
    files,
    journal,
    getFreeDiskBytes: async () => 8 * 1_024 * 1_024 * 1_024,
    now: overrides.now,
  });
  const initialize = vi.spyOn(store, 'initialize');
  const configuredPrincipalId = Object.prototype.hasOwnProperty.call(overrides, 'principalId')
    ? overrides.principalId
    : PRINCIPAL_ID;
  const getPrincipalId = vi.fn(async () => configuredPrincipalId ?? null);
  const resolveConversationOwner = vi.fn(async ({ conversationId, principalId }) => {
    if (overrides.ownerCode !== undefined) return { ok: false as const, code: overrides.ownerCode };
    return {
      ok: true as const,
      conversationId,
      principalId,
      scope: overrides.teamScope ? ('team' as const) : ('individual' as const),
      workspace,
    };
  });
  const pickNativeSourcePaths = vi.fn(async () => null);
  const service = new PresentationSourceGrantService({
    files,
    store,
    isFeatureEnabled: () => overrides.featureEnabled ?? true,
    isDesktopRuntime: () => overrides.desktopRuntime ?? true,
    getPrincipalId,
    resolveConversationOwner,
    pickNativeSourcePaths,
  });
  return {
    files,
    getPrincipalId,
    initialize,
    pickNativeSourcePaths,
    resolveConversationOwner,
    root,
    service,
    store,
    workspace,
  };
}

function expectAllowedFailureCode(
  result: { ok: boolean; code?: PresentationRunFailureCode },
  allowed: readonly PresentationRunFailureCode[]
): void {
  expect(result.ok).toBe(false);
  expect(allowed).toContain(result.code);
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PresentationSourceGrantService preflight', () => {
  it('rejects a disabled feature before principal, owner, or storage work', async () => {
    const fixture = createService({ featureEnabled: false });

    await expect(
      fixture.service.getSourceOwner({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      })
    ).resolves.toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });

    expect(fixture.getPrincipalId).not.toHaveBeenCalled();
    expect(fixture.resolveConversationOwner).not.toHaveBeenCalled();
    expect(fixture.initialize).not.toHaveBeenCalled();
  });

  it('rejects a non-desktop runtime before principal, owner, or storage work', async () => {
    const fixture = createService({ desktopRuntime: false });

    await expect(
      fixture.service.getSourceOwner({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      })
    ).resolves.toMatchObject({ ok: false, code: 'DESKTOP_REQUIRED' });

    expect(fixture.getPrincipalId).not.toHaveBeenCalled();
    expect(fixture.resolveConversationOwner).not.toHaveBeenCalled();
    expect(fixture.initialize).not.toHaveBeenCalled();
  });

  it('returns the authoritative owner denial before storage initialization', async () => {
    const fixture = createService({ ownerCode: 'RUN_FORBIDDEN' });

    await expect(
      fixture.service.getSourceOwner({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      })
    ).resolves.toMatchObject({ ok: false, code: 'RUN_FORBIDDEN' });

    expect(fixture.resolveConversationOwner).toHaveBeenCalledOnce();
    expect(fixture.initialize).not.toHaveBeenCalled();
  });

  it('applies the disabled-feature gate before malformed mutation requests or side effects', async () => {
    const fixture = createService({ featureEnabled: false });
    const invalidOwner = { owner_type: 'conversation' as const, conversation_id: 'not-a-uuid' };
    const results = await Promise.all([
      fixture.service.createDraft({ client_request_id: 'not-a-uuid' }),
      fixture.service.bindDraft({
        draft_id: 'not-a-uuid',
        conversation_id: 'not-a-uuid',
        expected_revision: -1,
      }),
      fixture.service.pickSources({ owner: invalidOwner, expected_owner_revision: -1 }),
      fixture.service.grantExternalDropPaths({
        owner: invalidOwner,
        native_paths: [],
        expected_owner_revision: -1,
      }),
      fixture.service.grantWorkspaceSource({
        conversation_id: 'not-a-uuid',
        relative_path: '../outside.txt',
        expected_owner_revision: -1,
      }),
      fixture.service.revoke({
        owner: invalidOwner,
        grant_id: 'not-a-uuid',
        expected_owner_revision: -1,
      }),
    ]);

    for (const result of results) expect(result).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });
    expect(fixture.getPrincipalId).not.toHaveBeenCalled();
    expect(fixture.resolveConversationOwner).not.toHaveBeenCalled();
    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(fixture.pickNativeSourcePaths).not.toHaveBeenCalled();
  });
});

describe('PresentationSourceGrantService grants', () => {
  it('canonicalizes a backend conversation owner before authority and durable draft binding', async () => {
    const fixture = createService();
    const owner = { owner_type: 'conversation' as const, conversation_id: SHORT_CONVERSATION_ID.toUpperCase() };

    await expect(fixture.service.getSourceOwner({ owner })).resolves.toMatchObject({
      ok: true,
      owner: { owner_type: 'conversation', conversation_id: SHORT_CONVERSATION_ID },
    });
    expect(fixture.resolveConversationOwner).toHaveBeenCalledWith({
      conversationId: SHORT_CONVERSATION_ID,
      principalId: PRINCIPAL_ID,
    });

    const created = await fixture.service.createDraft({ client_request_id: CLIENT_REQUEST_ID });
    if (!created.ok) throw new Error('Expected a presentation source draft');
    await expect(
      fixture.service.bindDraft({
        draft_id: created.draft.draftId,
        conversation_id: SHORT_CONVERSATION_ID.toUpperCase(),
        expected_revision: 0,
      })
    ).resolves.toMatchObject({ ok: true, status: 'bound', conversationId: SHORT_CONVERSATION_ID });
  });

  it('creates and idempotently replays a draft request', async () => {
    const fixture = createService();

    const created = await fixture.service.createDraft({ client_request_id: CLIENT_REQUEST_ID });
    const replayed = await fixture.service.createDraft({ client_request_id: CLIENT_REQUEST_ID });

    expect(created).toMatchObject({ ok: true, status: 'created', draft: { revision: 0, grantCount: 0 } });
    expect(replayed).toEqual({ ...(created as Extract<typeof created, { ok: true }>), status: 'existing' });
  });

  it('picks, snapshots, and returns one source without exposing its native path', async () => {
    const fixture = createService();
    const sourcePath = path.join(fixture.root, 'brief.txt');
    await writeFile(sourcePath, 'Quarterly revenue\n', { mode: 0o600 });
    fixture.pickNativeSourcePaths.mockResolvedValue([sourcePath]);

    const selected = await fixture.service.pickSources({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      expected_owner_revision: 0,
    });

    expect(selected).toMatchObject({
      ok: true,
      status: 'selected',
      ownerRevision: 1,
      grants: [
        {
          displayName: 'brief.txt',
          format: 'txt',
          sourceKind: 'native-picker',
          byteLength: 18,
        },
      ],
    });
    expect(JSON.stringify(selected)).not.toContain(sourcePath);
    await expect(
      fixture.service.getSourceOwner({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      })
    ).resolves.toMatchObject({ ok: true, ownerRevision: 1, grants: [{ displayName: 'brief.txt' }] });
  });

  it('rejects a native source that has another hard link', async () => {
    const fixture = createService();
    const sourcePath = path.join(fixture.root, 'native-source.txt');
    const aliasPath = path.join(fixture.root, 'native-source-alias.txt');
    await writeFile(sourcePath, 'Native source bytes\n', { mode: 0o600 });
    await link(sourcePath, aliasPath);
    fixture.pickNativeSourcePaths.mockResolvedValue([sourcePath]);

    await expect(
      fixture.service.pickSources({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_TAMPERED' });
  });

  it('confirms queued refs and idempotently replays a lost reply with the pre-mutation owner revision', async () => {
    const fixture = createService();
    const sourcePath = path.join(fixture.root, 'queued-brief.txt');
    await writeFile(sourcePath, 'Quarterly revenue\n', { mode: 0o600 });
    fixture.pickNativeSourcePaths.mockResolvedValue([sourcePath]);
    const selected = await fixture.service.pickSources({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      expected_owner_revision: 0,
    });
    if (!selected.ok || selected.status !== 'selected') throw new Error('Expected one selected source');
    const grant = selected.grants[0];
    if (!grant) throw new Error('Expected one selected grant');
    const request = {
      owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
      queue_item_id: QUEUE_ITEM_ID,
      sources: [
        {
          grantId: grant.grantId,
          expectedByteLength: grant.byteLength,
          expectedSha256: grant.sha256,
        },
      ],
      expected_owner_revision: selected.ownerRevision,
    };

    const confirmed = await fixture.service.confirmQueued(request);
    const replayed = await fixture.service.confirmQueued(request);

    expect(confirmed).toMatchObject({ ok: true, status: 'confirmed', ownerRevision: 2 });
    expect(replayed).toEqual({
      ...(confirmed as Extract<typeof confirmed, { ok: true }>),
      status: 'already_confirmed',
    });
  });

  it('rejects revoking one source from a confirmed multi-source queue without breaking exact replay', async () => {
    const fixture = createService();
    const firstPath = path.join(fixture.root, 'queued-first.txt');
    const secondPath = path.join(fixture.root, 'queued-second.txt');
    await Promise.all([
      writeFile(firstPath, 'First queued source\n', { mode: 0o600 }),
      writeFile(secondPath, 'Second queued source\n', { mode: 0o600 }),
    ]);
    fixture.pickNativeSourcePaths.mockResolvedValue([firstPath, secondPath]);
    const owner = { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID };
    const selected = await fixture.service.pickSources({ owner, expected_owner_revision: 0 });
    if (!selected.ok || selected.status !== 'selected' || selected.grants.length !== 2) {
      throw new Error('Expected two selected sources');
    }
    const request = {
      owner,
      queue_item_id: QUEUE_ITEM_ID,
      sources: selected.grants.map((grant) => ({
        grantId: grant.grantId,
        expectedByteLength: grant.byteLength,
        expectedSha256: grant.sha256,
      })),
      expected_owner_revision: selected.ownerRevision,
    };
    const confirmed = await fixture.service.confirmQueued(request);
    if (!confirmed.ok) throw new Error('Expected queued sources to be confirmed');
    const ownerBeforeRevoke = await fixture.service.getSourceOwner({ owner });

    await expect(
      fixture.service.revoke({
        owner,
        grant_id: selected.grants[0]!.grantId,
        expected_owner_revision: confirmed.ownerRevision,
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId: selected.grants[0]!.grantId },
    });
    await expect(fixture.service.getSourceOwner({ owner })).resolves.toEqual(ownerBeforeRevoke);
    await expect(fixture.service.confirmQueued(request)).resolves.toMatchObject({
      ok: true,
      status: 'already_confirmed',
      ownerRevision: confirmed.ownerRevision,
    });
  });

  it('fails the direct confirmation gate before parsing or storage side effects', async () => {
    const fixture = createService({ featureEnabled: false });
    const extend = vi.spyOn(fixture.store, 'extendPresentationSourceGrantsForQueue');

    await expect(
      fixture.service.confirmQueued({
        owner: { owner_type: 'conversation', conversation_id: '/private/conversation' },
        queue_item_id: '/private/queue-item',
        sources: [{ native_path: '/private/source.pdf' }],
        expected_owner_revision: -1,
      } as never)
    ).resolves.toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });

    expect(fixture.getPrincipalId).not.toHaveBeenCalled();
    expect(fixture.resolveConversationOwner).not.toHaveBeenCalled();
    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(extend).not.toHaveBeenCalled();
  });

  it('applies DESKTOP_REQUIRED directly to confirmQueued with zero principal, owner, or storage side effects', async () => {
    const fixture = createService({ desktopRuntime: false });
    const extend = vi.spyOn(fixture.store, 'extendPresentationSourceGrantsForQueue');

    await expect(
      fixture.service.confirmQueued({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        queue_item_id: QUEUE_ITEM_ID,
        sources: [{ grantId: CLIENT_REQUEST_ID, expectedByteLength: 1, expectedSha256: 'a'.repeat(64) }],
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'DESKTOP_REQUIRED' });

    expect(fixture.getPrincipalId).not.toHaveBeenCalled();
    expect(fixture.resolveConversationOwner).not.toHaveBeenCalled();
    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(extend).not.toHaveBeenCalled();
  });

  it('applies the authoritative team-scope denial directly to confirmQueued before storage side effects', async () => {
    const fixture = createService({ teamScope: true });
    const extend = vi.spyOn(fixture.store, 'extendPresentationSourceGrantsForQueue');

    await expect(
      fixture.service.confirmQueued({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        queue_item_id: QUEUE_ITEM_ID,
        sources: [{ grantId: CLIENT_REQUEST_ID, expectedByteLength: 1, expectedSha256: 'a'.repeat(64) }],
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'TEAM_SCOPE_UNSUPPORTED' });

    expect(fixture.getPrincipalId).toHaveBeenCalledOnce();
    expect(fixture.resolveConversationOwner).toHaveBeenCalledOnce();
    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(extend).not.toHaveBeenCalled();
  });

  it('applies the authoritative owner denial directly to confirmQueued before storage side effects', async () => {
    const fixture = createService({ ownerCode: 'RUN_FORBIDDEN' });
    const extend = vi.spyOn(fixture.store, 'extendPresentationSourceGrantsForQueue');

    await expect(
      fixture.service.confirmQueued({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        queue_item_id: QUEUE_ITEM_ID,
        sources: [{ grantId: CLIENT_REQUEST_ID, expectedByteLength: 1, expectedSha256: 'a'.repeat(64) }],
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'RUN_FORBIDDEN' });

    expect(fixture.getPrincipalId).toHaveBeenCalledOnce();
    expect(fixture.resolveConversationOwner).toHaveBeenCalledOnce();
    expect(fixture.initialize).not.toHaveBeenCalled();
    expect(extend).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and path-shaped nested confirmation input before storage mutation', async () => {
    const fixture = createService();
    const extend = vi.spyOn(fixture.store, 'extendPresentationSourceGrantsForQueue');

    await expect(
      fixture.service.confirmQueued({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        queue_item_id: QUEUE_ITEM_ID,
        sources: [
          {
            grantId: CLIENT_REQUEST_ID,
            expectedByteLength: 1,
            expectedSha256: 'a'.repeat(64),
            native_path: '/private/source.pdf',
          },
        ],
        expected_owner_revision: 0,
        descriptor: { displayName: 'source.pdf' },
      } as never)
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    expect(extend).not.toHaveBeenCalled();
  });

  it('rejects stale first-call CAS plus hash and length drift without extending a grant', async () => {
    const fixture = createService();
    const sourcePath = path.join(fixture.root, 'drift-brief.txt');
    await writeFile(sourcePath, 'Quarterly revenue\n', { mode: 0o600 });
    fixture.pickNativeSourcePaths.mockResolvedValue([sourcePath]);
    const selected = await fixture.service.pickSources({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      expected_owner_revision: 0,
    });
    if (!selected.ok || selected.status !== 'selected') throw new Error('Expected one selected source');
    const grant = selected.grants[0];
    if (!grant) throw new Error('Expected one selected grant');
    const base = {
      owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
      queue_item_id: QUEUE_ITEM_ID,
      sources: [
        {
          grantId: grant.grantId,
          expectedByteLength: grant.byteLength,
          expectedSha256: grant.sha256,
        },
      ],
      expected_owner_revision: selected.ownerRevision,
    };

    await expect(
      fixture.service.confirmQueued({ ...base, expected_owner_revision: selected.ownerRevision - 1 })
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    await expect(
      fixture.service.confirmQueued({
        ...base,
        sources: [{ ...base.sources[0]!, expectedSha256: 'f'.repeat(64) }],
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_TAMPERED' });
    await expect(
      fixture.service.confirmQueued({
        ...base,
        sources: [{ ...base.sources[0]!, expectedByteLength: grant.byteLength + 1 }],
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_TAMPERED' });
    await expect(fixture.service.getSourceOwner({ owner: base.owner })).resolves.toMatchObject({
      ok: true,
      ownerRevision: selected.ownerRevision,
      grants: [{ expiresAt: grant.expiresAt }],
    });
  });

  it('returns an explicit cancellation without changing the owner', async () => {
    const fixture = createService();

    await expect(
      fixture.service.pickSources({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        expected_owner_revision: 0,
      })
    ).resolves.toEqual({ ok: true, status: 'cancelled', grants: [], ownerRevision: 0 });
  });

  it('maps a native picker failure to DIALOG_UNAVAILABLE', async () => {
    const fixture = createService();
    fixture.pickNativeSourcePaths.mockRejectedValueOnce(new Error('dialog failed'));

    await expect(
      fixture.service.pickSources({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'DIALOG_UNAVAILABLE' });
  });

  it('rejects a mixed-validity picker batch without creating visible grants', async () => {
    const fixture = createService();
    const validPath = path.join(fixture.root, 'valid.txt');
    const invalidPath = path.join(fixture.root, 'invalid.txt');
    await Promise.all([
      writeFile(validPath, 'Valid text\n', { mode: 0o600 }),
      writeFile(invalidPath, Buffer.from([0x62, 0x61, 0x64, 0x00]), { mode: 0o600 }),
    ]);
    fixture.pickNativeSourcePaths.mockResolvedValue([validPath, invalidPath]);

    await expect(
      fixture.service.pickSources({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_TAMPERED' });
    await expect(
      fixture.service.getSourceOwner({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      })
    ).resolves.toMatchObject({ ok: true, ownerRevision: 0, grants: [] });
  });

  it('surfaces a prepared-grant cleanup failure after a store rejection', async () => {
    const fixture = createService();
    const sourcePath = path.join(fixture.root, 'cleanup.txt');
    await writeFile(sourcePath, 'cleanup bytes\n', { mode: 0o600 });
    fixture.pickNativeSourcePaths.mockResolvedValue([sourcePath]);
    vi.spyOn(fixture.store, 'createPresentationSourceGrants').mockRejectedValueOnce(
      new PresentationSourceStoreError('GRANT_LIMIT_EXCEEDED')
    );
    const cleanup = vi
      .spyOn(fixture.files, 'removePreparedSourceSnapshot')
      .mockRejectedValueOnce(new Error('prepared grant cleanup failed'));

    await expect(
      fixture.service.pickSources({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'PERSISTENCE_FAILED' });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('migrates a draft grant to an authorized conversation and replays the bind', async () => {
    const fixture = createService();
    const draftResult = await fixture.service.createDraft({ client_request_id: CLIENT_REQUEST_ID });
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) throw new Error('Expected a draft');
    const sourcePath = path.join(fixture.root, 'notes.md');
    await writeFile(sourcePath, '# Notes\n', { mode: 0o600 });
    await expect(
      fixture.service.grantExternalDropPaths({
        owner: { owner_type: 'draft', draft_id: draftResult.draft.draftId },
        native_paths: [sourcePath],
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: true, ownerRevision: 1, grants: [{ sourceKind: 'external-drop' }] });

    const request = {
      draft_id: draftResult.draft.draftId,
      conversation_id: CONVERSATION_ID,
      expected_revision: 1,
    };
    await expect(fixture.service.bindDraft(request)).resolves.toMatchObject({ ok: true, status: 'bound', revision: 2 });
    await expect(fixture.service.bindDraft(request)).resolves.toMatchObject({ ok: true, status: 'already_bound' });
    await expect(
      fixture.service.getSourceOwner({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      })
    ).resolves.toMatchObject({ ok: true, ownerRevision: 1, grants: [{ displayName: 'notes.md' }] });
  });

  it('rejects a foreign draft principal and a conflicting destination bind', async () => {
    const foreignFixture = createService();
    const foreignDraft = await foreignFixture.service.createDraft({ client_request_id: CLIENT_REQUEST_ID });
    if (!foreignDraft.ok) throw new Error('Expected a draft');
    foreignFixture.getPrincipalId.mockResolvedValue('another-principal');

    await expect(
      foreignFixture.service.bindDraft({
        draft_id: foreignDraft.draft.draftId,
        conversation_id: CONVERSATION_ID,
        expected_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'DRAFT_FOREIGN' });

    const conflictFixture = createService();
    const conflictDraft = await conflictFixture.service.createDraft({ client_request_id: CLIENT_REQUEST_ID });
    if (!conflictDraft.ok) throw new Error('Expected a draft');
    await expect(
      conflictFixture.service.bindDraft({
        draft_id: conflictDraft.draft.draftId,
        conversation_id: CONVERSATION_ID,
        expected_revision: 0,
      })
    ).resolves.toMatchObject({ ok: true, status: 'bound' });
    await expect(
      conflictFixture.service.bindDraft({
        draft_id: conflictDraft.draft.draftId,
        conversation_id: SECOND_CONVERSATION_ID,
        expected_revision: 0,
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'DRAFT_ALREADY_BOUND',
      details: { conversationId: CONVERSATION_ID },
    });
  });

  it('conceals bind destination denials and maps destination quota conflicts into its result contract', async () => {
    for (const ownerCode of ['RUN_NOT_FOUND', 'SCOPE_UNAVAILABLE', 'TEAM_SCOPE_UNSUPPORTED'] as const) {
      const denied = createService({ ownerCode });
      await expect(
        denied.service.bindDraft({
          draft_id: CLIENT_REQUEST_ID,
          conversation_id: CONVERSATION_ID,
          expected_revision: 0,
        })
      ).resolves.toMatchObject({ ok: false, code: 'RUN_FORBIDDEN' });
    }

    const quotaFixture = createService();
    vi.spyOn(quotaFixture.store, 'bindPresentationSourceDraft').mockRejectedValueOnce(
      new PresentationSourceStoreError('GRANT_LIMIT_EXCEEDED')
    );
    await expect(
      quotaFixture.service.bindDraft({
        draft_id: CLIENT_REQUEST_ID,
        conversation_id: CONVERSATION_ID,
        expected_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('grants a normalized workspace-relative source without exposing its path', async () => {
    const fixture = createService();
    const reports = path.join(fixture.workspace, 'reports');
    const sourcePath = path.join(reports, 'brief.md');
    await mkdir(reports);
    await writeFile(sourcePath, '# Brief\n', { mode: 0o600 });

    const granted = await fixture.service.grantWorkspaceSource({
      conversation_id: CONVERSATION_ID,
      relative_path: 'reports/brief.md',
      expected_owner_revision: 0,
    });

    expect(granted).toMatchObject({
      ok: true,
      status: 'granted',
      ownerRevision: 1,
      grant: { displayName: 'brief.md', format: 'md', sourceKind: 'workspace-relative' },
    });
    expect(JSON.stringify(granted)).not.toContain(sourcePath);
  });

  it.each(['/absolute.txt', '../outside.txt', 'reports/../brief.txt'])(
    'rejects non-strict workspace path %s',
    async (relativePath) => {
      const fixture = createService();

      await expect(
        fixture.service.grantWorkspaceSource({
          conversation_id: CONVERSATION_ID,
          relative_path: relativePath,
          expected_owner_revision: 0,
        })
      ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    }
  );

  it('rejects a workspace source symlink that resolves outside the authorized root', async () => {
    const fixture = createService();
    const outside = path.join(fixture.root, 'outside.txt');
    await writeFile(outside, 'outside secret\n', { mode: 0o600 });
    await symlink(outside, path.join(fixture.workspace, 'linked.txt'));

    await expect(
      fixture.service.grantWorkspaceSource({
        conversation_id: CONVERSATION_ID,
        relative_path: 'linked.txt',
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_TAMPERED' });
  });

  it('rejects a workspace source hard-linked to a file outside the authorized root', async () => {
    const fixture = createService();
    const outside = path.join(fixture.root, 'outside-hardlink.txt');
    await writeFile(outside, 'outside hard-linked secret\n', { mode: 0o600 });
    await link(outside, path.join(fixture.workspace, 'linked.txt'));

    await expect(
      fixture.service.grantWorkspaceSource({
        conversation_id: CONVERSATION_ID,
        relative_path: 'linked.txt',
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_TAMPERED' });
  });

  it('recovers durable queue-unbound revoke proof after a lost reply and service restart', async () => {
    const fixture = createService();
    const sourcePath = path.join(fixture.root, 'revoke.txt');
    await writeFile(sourcePath, 'revoke me\n', { mode: 0o600 });
    fixture.pickNativeSourcePaths.mockResolvedValue([sourcePath]);
    const selected = await fixture.service.pickSources({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      expected_owner_revision: 0,
    });
    if (!selected.ok || selected.status !== 'selected' || selected.grants[0] === undefined) {
      throw new Error('Expected a selected grant');
    }
    const grantId = selected.grants[0].grantId;
    const revokeRequest = {
      owner: { owner_type: 'conversation' as const, conversation_id: CONVERSATION_ID },
      grant_id: grantId,
      expected_owner_revision: 1,
    };

    const first = await fixture.service.revoke(revokeRequest);
    expect(first).toMatchObject({
      ok: true,
      status: 'revoked',
      ownerRevision: 2,
      queueUnboundAtRevoke: true,
    });
    const restarted = createService({ root: fixture.root });
    await expect(
      restarted.service.confirmQueued({
        owner: revokeRequest.owner,
        queue_item_id: QUEUE_ITEM_ID,
        sources: [
          {
            grantId,
            expectedByteLength: selected.grants[0]!.byteLength,
            expectedSha256: selected.grants[0]!.sha256,
          },
        ],
        expected_owner_revision: revokeRequest.expected_owner_revision,
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId, queueUnboundAtRevoke: true },
    });
    await expect(restarted.service.revoke(revokeRequest)).resolves.toMatchObject({
      ok: true,
      status: 'already_revoked',
      ownerRevision: 2,
      queueUnboundAtRevoke: true,
    });
    await expect(
      restarted.service.revoke({
        owner: { owner_type: 'conversation', conversation_id: SECOND_CONVERSATION_ID },
        grant_id: grantId,
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_GRANT_FOREIGN' });
  });

  it('maps an expired revoke tombstone to SOURCE_GRANT_REPLAYED', async () => {
    const fixture = createService();
    vi.spyOn(fixture.store, 'revokePresentationSourceGrant').mockRejectedValueOnce(
      new PresentationSourceStoreError('SOURCE_GRANT_EXPIRED', { grantId: CLIENT_REQUEST_ID })
    );

    await expect(
      fixture.service.revoke({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
        grant_id: CLIENT_REQUEST_ID,
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'SOURCE_GRANT_REPLAYED',
      details: { grantId: CLIENT_REQUEST_ID },
    });
  });

  it('keeps runtime failures inside each public method result-code whitelist', async () => {
    const unavailable = createService({ principalId: null });
    const malformedDraft = await unavailable.service.createDraft({ client_request_id: 'not-a-uuid' });
    const getOwner = await unavailable.service.getSourceOwner({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
    });
    const bind = await unavailable.service.bindDraft({
      draft_id: CLIENT_REQUEST_ID,
      conversation_id: CONVERSATION_ID,
      expected_revision: 0,
    });
    const pick = await unavailable.service.pickSources({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      expected_owner_revision: 0,
    });
    const externalDrop = await unavailable.service.grantExternalDropPaths({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      native_paths: ['/tmp/source.txt'],
      expected_owner_revision: 0,
    });
    const workspace = await unavailable.service.grantWorkspaceSource({
      conversation_id: CONVERSATION_ID,
      relative_path: 'source.txt',
      expected_owner_revision: 0,
    });
    const revoke = await unavailable.service.revoke({
      owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      grant_id: CLIENT_REQUEST_ID,
      expected_owner_revision: 0,
    });

    expectAllowedFailureCode(malformedDraft, [
      'FEATURE_DISABLED',
      'DESKTOP_REQUIRED',
      'DRAFT_LIMIT_EXCEEDED',
      'RATE_LIMITED',
      'PERSISTENCE_FAILED',
      'INTERNAL_ERROR',
    ]);
    expectAllowedFailureCode(getOwner, [
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
    ]);
    expectAllowedFailureCode(bind, [
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
    ]);
    expectAllowedFailureCode(pick, [
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
    ]);
    expectAllowedFailureCode(externalDrop, [
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
    ]);
    expectAllowedFailureCode(workspace, [
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
    ]);
    expectAllowedFailureCode(revoke, [
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
    ]);
  });

  it('rejects a workspace parent swapped outside after authorization but before the source open', async () => {
    let documents = '';
    let displacedDocuments = '';
    let outside = '';
    const fixture = createService({
      fileFailureInjector: async ({ boundary }) => {
        if ((boundary as string) !== 'before-grant-source-resolution') return;
        await rename(documents, displacedDocuments);
        await symlink(outside, documents);
      },
    });
    documents = path.join(fixture.workspace, 'docs');
    displacedDocuments = path.join(fixture.workspace, 'docs-authorized');
    outside = path.join(fixture.root, 'outside');
    await Promise.all([mkdir(documents), mkdir(outside)]);
    await Promise.all([
      writeFile(path.join(documents, 'brief.txt'), 'authorized bytes\n'),
      writeFile(path.join(outside, 'brief.txt'), 'outside secret\n'),
    ]);

    await expect(
      fixture.service.grantWorkspaceSource({
        conversation_id: CONVERSATION_ID,
        relative_path: 'docs/brief.txt',
        expected_owner_revision: 0,
      })
    ).resolves.toMatchObject({ ok: false, code: 'SOURCE_TAMPERED' });
    await expect(
      fixture.service.getSourceOwner({
        owner: { owner_type: 'conversation', conversation_id: CONVERSATION_ID },
      })
    ).resolves.toMatchObject({ ok: true, ownerRevision: 0, grants: [] });
  });
});
