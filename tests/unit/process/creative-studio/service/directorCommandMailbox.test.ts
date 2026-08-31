/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, promises as nodeFs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateStudioProjectInputV2,
  StudioDirectorCommandReceiptV2,
  StudioDirectorCommandRecordV2,
  StudioDirectorCommandSlotLeaseV2,
  StudioDirectorCommandSlotV2,
  StudioProposalRecordV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandMailboxV2,
} from '@process/services/creative-studio/service/directorCommandMailbox';
import {
  createCreativeStudioStore,
  CreativeStudioStoreError,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';

const NOW = '2026-08-16T12:00:00.000Z';
const WAIT_MS = STUDIO_DIRECTOR_COMMAND_WAIT_MS;

const commandDirectories = (rootDir: string, projectId: string) => {
  const root = path.join(rootDir, projectId, 'commands');
  return {
    root,
    pending: path.join(root, 'pending'),
    slots: path.join(root, 'slots'),
    receipts: path.join(root, 'receipts'),
  };
};

const makeUnsupportedCommand = (projectId: string, commandId: string) => ({
  schemaVersion: 1 as const,
  commandId,
  projectId,
  expectedRevision: 1,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply' as const,
  operations: [{ kind: 'set_brief' as const, brief: 'Unsupported schema-1 edit.' }],
});

const makeUnsupportedSlot = (commandId: string) => ({
  schemaVersion: 1 as const,
  commandId,
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
});

const makeUnsupportedLease = (input: {
  leaseId: string;
  owner: 'writer' | 'main';
  slot: ReturnType<typeof makeUnsupportedSlot>;
}) => ({
  schemaVersion: 1 as const,
  leaseId: input.leaseId,
  owner: input.owner,
  commandId: input.slot.commandId,
  reservedAt: input.slot.reservedAt,
  deadlineAt: input.slot.deadlineAt,
  acquiredAt: NOW,
  expiresAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
});

const makeUnsupportedReceipt = (projectId: string, commandId: string) => ({
  schemaVersion: 1 as const,
  commandId,
  projectId,
  expectedRevision: 1,
  decidedAt: NOW,
  status: 'applied' as const,
  appliedRevision: 2,
  createdSceneIds: [],
});

const makeInputV2 = (name: string): CreateStudioProjectInputV2 => ({
  name,
  brief: 'A bounded schema-2 project',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
});

const makeCommandV2 = (
  projectId: string,
  commandId: string,
  overrides: Partial<StudioDirectorCommandRecordV2> = {}
): StudioDirectorCommandRecordV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId,
  projectId,
  expectedRevision: 1,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A schema-2 direct edit.' }],
  ...overrides,
});

const makeSlotV2 = (
  commandId: string,
  overrides: Partial<StudioDirectorCommandSlotV2> = {}
): StudioDirectorCommandSlotV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId,
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  ...overrides,
});

const makeLeaseV2 = (input: {
  leaseId: string;
  owner: 'writer' | 'main';
  slot: StudioDirectorCommandSlotV2;
  acquiredAt?: string;
}): StudioDirectorCommandSlotLeaseV2 => {
  const acquiredAt = input.acquiredAt ?? NOW;
  return {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    leaseId: input.leaseId,
    owner: input.owner,
    commandId: input.slot.commandId,
    reservedAt: input.slot.reservedAt,
    deadlineAt: input.slot.deadlineAt,
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
  };
};

const makeReceiptV2 = (
  projectId: string,
  commandId: string,
  overrides: Partial<StudioDirectorCommandReceiptV2> = {}
): StudioDirectorCommandReceiptV2 =>
  ({
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId,
    projectId,
    expectedRevision: 1,
    decidedAt: NOW,
    status: 'applied',
    appliedRevision: 2,
    createdBeatIds: [],
    createdShotIds: [],
    ...overrides,
  }) as StudioDirectorCommandReceiptV2;

const makeRejectedReceiptV2 = (input: {
  projectId: string;
  commandId: string;
  expectedRevision: number | null;
  reasonCode: 'malformed_record' | 'unsupported_version';
}): StudioDirectorCommandReceiptV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId: input.commandId,
  projectId: input.projectId,
  expectedRevision: input.expectedRevision,
  decidedAt: NOW,
  status: 'rejected',
  observedRevision: null,
  reasonCode: input.reasonCode,
});

const snapshotDirectoryBytes = async (root: string): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    const entries = await nodeFs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file);
      if (entry.isDirectory()) {
        result[`${relative}/`] = 'directory';
        // eslint-disable-next-line no-await-in-loop
        await visit(file);
      } else {
        // eslint-disable-next-line no-await-in-loop
        result[relative] = (await nodeFs.readFile(file)).toString('base64');
      }
    }
  };
  await visit(root);
  return result;
};

describe('Studio Director schema-2 command mailbox', () => {
  let rootDir: string;
  let store: CreativeStudioStore;
  let mailbox: StudioDirectorCommandMailboxV2;
  let projectId: string;
  let legacyProjectId: string;

  beforeEach(async () => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'studio-command-mailbox-v2-'));
    store = createCreativeStudioStore({
      rootDir,
      now: () => NOW,
      createId: () => 'project_v2',
    });
    legacyProjectId = 'legacy_schema_1';
    const legacyDirectory = path.join(rootDir, legacyProjectId);
    await nodeFs.mkdir(legacyDirectory);
    await nodeFs.writeFile(
      path.join(legacyDirectory, 'project.json'),
      JSON.stringify({ schemaVersion: 1, id: legacyProjectId })
    );
    projectId = (await store.createProjectV2(makeInputV2('Primary schema-2'))).id;
    mailbox = createStudioDirectorCommandMailboxV2({ rootDir, store, now: () => NOW, waitMs: WAIT_MS });
  });

  afterEach(async () => {
    await mailbox.dispose();
    vi.restoreAllMocks();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('reads, receipts, and finishes exact schema-2 command records', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const command = makeCommandV2(projectId, 'command_v2');
    await nodeFs.writeFile(path.join(directories.pending, 'command_v2.json'), JSON.stringify(command));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlotV2('command_v2')));

    await expect(mailbox.readPending(projectId, 'command_v2')).resolves.toEqual({ status: 'valid', record: command });
    const receipt = makeReceiptV2(projectId, 'command_v2', {
      createdBeatIds: ['section_1'],
      createdShotIds: ['clip_1'],
    });
    await mailbox.writeReceipt(projectId, receipt);
    await expect(mailbox.readReceipt(projectId, 'command_v2')).resolves.toEqual({
      status: 'valid',
      record: receipt,
    });

    await mailbox.finish(projectId, 'command_v2');

    await expect(nodeFs.readdir(directories.pending)).resolves.toEqual([]);
    await expect(nodeFs.readdir(directories.slots)).resolves.toEqual([]);
    await expect(nodeFs.readdir(directories.receipts)).resolves.toEqual(['command_v2.json']);
  });

  it('persists a maximum-size proposal lookup receipt beyond the smaller command-record bound', async () => {
    await mailbox.ensure(projectId);
    const operations = Array.from({ length: 11 }, (_, index) => ({
      kind: 'edit_shot' as const,
      shotId: `shot_${index}`,
      changes: { shootingScript: index < 10 ? 'x'.repeat(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) : '' },
    }));
    const proposal: StudioProposalRecordV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      id: 'proposal_maximum',
      projectId,
      status: 'pending',
      baseRevision: 1,
      payload: { kind: 'mutation_batch', operations },
      createdAt: NOW,
      decidedAt: null,
    };
    const currentProposalBytes = Buffer.byteLength(JSON.stringify(proposal), 'utf8');
    const finalScriptLength = STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES - 32 - currentProposalBytes;
    expect(finalScriptLength).toBeGreaterThan(0);
    expect(finalScriptLength).toBeLessThanOrEqual(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH);
    operations.at(-1)!.changes.shootingScript = 'y'.repeat(finalScriptLength);

    const receipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'proposal_query_maximum',
      projectId,
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_proposal', proposalId: proposal.id },
      result: { status: 'pending', proposal },
    };
    const receiptBytes = Buffer.byteLength(JSON.stringify(receipt), 'utf8');
    expect(Buffer.byteLength(JSON.stringify(proposal), 'utf8')).toBeLessThanOrEqual(
      STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES
    );
    expect(receiptBytes).toBeGreaterThan(STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES);
    expect(receiptBytes).toBeLessThanOrEqual(STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES);

    await mailbox.writeReceipt(projectId, receipt);
    await expect(mailbox.readReceipt(projectId, receipt.commandId)).resolves.toEqual({
      status: 'valid',
      record: receipt,
    });
  });

  it('skips a project whose pending ledger cannot be read rather than failing the sweep for every project', async () => {
    /*
     * The blast radius is the point. snapshotPendingPage is the Director processor's pre-start
     * sweep, and start() runs it outside its own try block, so a rejection here reached activate()
     * and degraded the whole runtime graph -- one unreadable project stopped Creative Studio for
     * every project in the profile. Asserting only that the call resolves would not catch a
     * regression that skipped everything.
     */
    const healthyStore = createCreativeStudioStore({
      rootDir,
      now: () => NOW,
      createId: () => 'project_v2_healthy',
    });
    const healthyId = (await healthyStore.createProjectV2(makeInputV2('Healthy schema-2'))).id;
    await mailbox.ensure(healthyId);
    await nodeFs.writeFile(
      path.join(commandDirectories(rootDir, healthyId).pending, 'command_visible.json'),
      JSON.stringify(makeCommandV2(healthyId, 'command_visible'))
    );

    // Make the first project's pending ledger unreadable, exactly as corrupt storage would.
    await mailbox.ensure(projectId);
    const brokenPending = commandDirectories(rootDir, projectId).pending;
    await nodeFs.rm(brokenPending, { recursive: true, force: true });
    await nodeFs.writeFile(brokenPending, 'not a directory', 'utf8');

    const page = await mailbox.snapshotPendingPage(null, STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS);

    expect(page.items).toContainEqual({ projectId: healthyId, commandId: 'command_visible' });
    expect(page.items.every((item) => item.projectId !== projectId)).toBe(true);
  });

  it('rejects malformed identities, traversal bounds, cursors, and maintenance timestamps', async () => {
    const invalidPayload = { code: 'invalid_payload' };
    await expect(mailbox.ensure('../project')).rejects.toMatchObject(invalidPayload);
    await expect(mailbox.readPending(projectId, '../command')).rejects.toMatchObject(invalidPayload);
    await expect(mailbox.readReceipt('../project', 'command')).rejects.toMatchObject(invalidPayload);
    await expect(mailbox.finish(projectId, 'bad/command')).rejects.toMatchObject(invalidPayload);

    await expect(mailbox.snapshotPendingPage(null, 0)).rejects.toMatchObject(invalidPayload);
    await expect(mailbox.listPendingPage(null, 1.5)).rejects.toMatchObject(invalidPayload);
    await expect(
      mailbox.releaseOrphanedSlotsPage(null, NOW, STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS + 1)
    ).rejects.toMatchObject(invalidPayload);
    await expect(mailbox.pruneReceiptsPage(null, NOW, -1)).rejects.toMatchObject(invalidPayload);
    await expect(mailbox.releaseOrphanedSlotsPage(null, 'not-a-timestamp', 1)).rejects.toMatchObject(invalidPayload);
    await expect(mailbox.releaseOrphanedSlotsPage(null, '2026-13-16T12:00:00.000Z', 1)).rejects.toMatchObject(
      invalidPayload
    );
    await expect(mailbox.releaseOrphanedSlotsPage(null, '2026-08-16t12:00:00.000z', 1)).rejects.toMatchObject(
      invalidPayload
    );
    await expect(mailbox.pruneReceiptsPage(null, '2026-08-16T12:00:00Z', 1)).rejects.toMatchObject(invalidPayload);

    const firstPage = await mailbox.snapshotPendingPage(null, 1);
    expect(firstPage.nextCursor).not.toBeNull();
    await expect(mailbox.snapshotPendingPage('v2.not-the-live-cursor', 1)).rejects.toMatchObject(invalidPayload);

    const restartedPage = await mailbox.snapshotPendingPage(null, 1);
    expect(restartedPage.nextCursor).not.toBeNull();
    await expect(mailbox.snapshotPendingPage('x'.repeat(257), 1)).rejects.toMatchObject(invalidPayload);

    const nonStringPage = await mailbox.snapshotPendingPage(null, 1);
    expect(nonStringPage.nextCursor).not.toBeNull();
    await expect(mailbox.snapshotPendingPage(7 as never, 1)).rejects.toMatchObject(invalidPayload);
  });

  it('pages live pending entries while filtering unrelated and unsafe directory records', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    await nodeFs.writeFile(
      path.join(directories.pending, 'command_visible.json'),
      JSON.stringify(makeCommandV2(projectId, 'command_visible'))
    );
    await nodeFs.writeFile(path.join(directories.pending, 'notes.txt'), 'not a command');
    await nodeFs.writeFile(path.join(directories.pending, 'unsafe!.json'), '{}');
    await nodeFs.writeFile(path.join(rootDir, 'top-level-file'), 'not a project');
    await nodeFs.mkdir(path.join(rootDir, 'unsafe!'));

    const collect = async (
      page: (
        cursor: string | null
      ) => Promise<{ items: Array<{ projectId: string; commandId: string }>; nextCursor: string | null }>
    ) => {
      const items: Array<{ projectId: string; commandId: string }> = [];
      let cursor: string | null = null;
      do {
        // Limit one deliberately proves that traversal resumes its owned directory handles.
        // eslint-disable-next-line no-await-in-loop
        const result = await page(cursor);
        items.push(...result.items);
        cursor = result.nextCursor;
      } while (cursor !== null);
      return items;
    };

    await expect(collect((cursor) => mailbox.snapshotPendingPage(cursor, 1))).resolves.toEqual([
      { projectId, commandId: 'command_visible' },
    ]);
    await expect(collect((cursor) => mailbox.listPendingPage(cursor, 1))).resolves.toEqual([
      { projectId, commandId: 'command_visible' },
    ]);

    let maintenanceCursor: string | null = null;
    let processedProjects = 0;
    do {
      // The one-entry budget proves that project maintenance resumes the same bounded traversal.
      // eslint-disable-next-line no-await-in-loop
      const page = await mailbox.releaseOrphanedSlotsPage(maintenanceCursor, NOW, 1);
      processedProjects += page.processed;
      maintenanceCursor = page.nextCursor;
    } while (maintenanceCursor !== null);
    expect(processedProjects).toBe(2);
  });

  it('keeps absent sidecars as no-ops and fences traversal after idempotent disposal', async () => {
    await expect(mailbox.readPending(projectId, 'missing_command')).resolves.toBeNull();
    await expect(mailbox.readReceipt(projectId, 'missing_command')).resolves.toBeNull();
    await expect(mailbox.finish(projectId, 'missing_command')).resolves.toBeUndefined();

    await mailbox.ensure(projectId);
    await expect(mailbox.readPending(projectId, 'still_missing')).resolves.toBeNull();
    await expect(mailbox.readReceipt(projectId, 'still_missing')).resolves.toBeNull();

    await mailbox.dispose();
    await mailbox.dispose();
    await expect(mailbox.snapshotPendingPage(null, 1)).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('rejects a receipt whose embedded project authority differs from its call boundary', async () => {
    await expect(mailbox.readPending(projectId, 'missing_receipt_command')).resolves.toBeNull();
    await expect(
      mailbox.writeReceipt(projectId, makeReceiptV2('different_project', 'mismatched_receipt'))
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(existsSync(path.join(rootDir, projectId, 'commands'))).toBe(false);
  });

  it('classifies malformed receipt bytes without treating them as absent or authoritative', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    await nodeFs.writeFile(path.join(directories.receipts, 'malformed_receipt.json'), '{not-json');

    await expect(mailbox.readReceipt(projectId, 'malformed_receipt')).resolves.toEqual({ status: 'invalid' });
    await expect(nodeFs.readFile(path.join(directories.receipts, 'malformed_receipt.json'), 'utf8')).resolves.toBe(
      '{not-json'
    );
  });

  it('checks transient query authority synchronously at the final immutable receipt link', async () => {
    await mailbox.ensure(projectId);
    let active = true;
    let activeAtLink: boolean | null = null;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'link') {
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (...args: Parameters<typeof nodeFs.link>) => {
          activeAtLink = active;
          return nodeFs.link(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    const receipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'query_fence',
      projectId,
      decidedAt: NOW,
      status: 'failed',
      query: { kind: 'list_routes' },
      reasonCode: 'route_inventory_unavailable',
    };

    await racingMailbox.writeReceipt(projectId, receipt, () => {
      queueMicrotask(() => {
        active = false;
      });
      return active;
    });

    expect(activeAtLink).toBe(true);
    expect(active).toBe(false);
    await expect(racingMailbox.readReceipt(projectId, receipt.commandId)).resolves.toEqual({
      status: 'valid',
      record: receipt,
    });

    const denied: StudioDirectorCommandReceiptV2 = { ...receipt, commandId: 'query_fence_denied' };
    await expect(racingMailbox.writeReceipt(projectId, denied, () => false)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(existsSync(path.join(commandDirectories(rootDir, projectId).receipts, `${denied.commandId}.json`))).toBe(
      false
    );
    await racingMailbox.dispose();
  });

  it('keeps a published receipt immutable across an exact duplicate write', async () => {
    const receipt = makeReceiptV2(projectId, 'immutable_receipt');
    await mailbox.writeReceipt(projectId, receipt);
    const receiptFile = path.join(commandDirectories(rootDir, projectId).receipts, 'immutable_receipt.json');
    const before = await nodeFs.readFile(receiptFile, 'utf8');

    await expect(mailbox.writeReceipt(projectId, receipt)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(before);
  });

  it('rejects unsafe and unsupported receipt identities before publishing a mailbox family', async () => {
    await expect(mailbox.readPending(projectId, 'missing_receipt_command')).resolves.toBeNull();
    await expect(mailbox.writeReceipt(projectId, makeReceiptV2(projectId, '../unsafe'))).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(
      mailbox.writeReceipt(projectId, { ...makeReceiptV2(projectId, 'legacy_receipt'), schemaVersion: 3 } as never)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(existsSync(path.join(rootDir, projectId, 'commands'))).toBe(false);
  });

  it('forwards only supported pending-tree changes and closes its watcher idempotently', async () => {
    let callbacks:
      | {
          onChange(relativeFile: string): void;
          onError(error: Error): void;
        }
      | undefined;
    const close = vi.fn();
    const logError = vi.fn();
    const watchingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store: {
        getVerifiedProjectDirectoryV2: async (candidateProjectId) => {
          if (candidateProjectId === projectId) return path.join(rootDir, projectId);
          if (candidateProjectId === 'unsupported_project') {
            throw new CreativeStudioStoreError('unsupported_prototype_schema', 'unsupported');
          }
          if (candidateProjectId === 'unsafe_storage') throw new Error('unsafe storage');
          return null;
        },
      },
      logError,
      watchCommandTree: (input) => {
        callbacks = input;
        return { close };
      },
    });
    const trigger = vi.fn();

    try {
      const stop = await watchingMailbox.watch(trigger);
      if (callbacks === undefined) throw new Error('watch callbacks were not installed');

      callbacks.onChange(path.join(projectId, 'commands', 'pending'));
      callbacks.onChange(path.join(projectId, 'commands', 'pending', 'command_watch.json'));
      callbacks.onChange(path.join(projectId, 'commands', 'pending', 'unsafe!.json'));
      callbacks.onChange(path.join(projectId, 'commands', 'receipts', 'ignored.json'));
      callbacks.onChange(path.join('unsafe!', 'commands', 'pending', 'ignored.json'));
      callbacks.onChange(path.join('missing_project', 'commands', 'pending', 'missing.json'));
      callbacks.onChange(path.join('unsupported_project', 'commands', 'pending', 'legacy.json'));
      callbacks.onChange(path.join('unsafe_storage', 'commands', 'pending', 'unsafe.json'));
      callbacks.onError(new Error('watcher failure'));
      await Promise.resolve();
      await Promise.resolve();

      expect(trigger).toHaveBeenCalledTimes(2);
      expect(trigger).toHaveBeenNthCalledWith(1, projectId, undefined);
      expect(trigger).toHaveBeenNthCalledWith(2, projectId, 'command_watch');
      expect(logError).toHaveBeenCalledTimes(2);

      stop();
      stop();
      callbacks.onChange(path.join(projectId, 'commands', 'pending', 'after_close.json'));
      callbacks.onError(new Error('ignored after close'));
      await Promise.resolve();

      expect(close).toHaveBeenCalledOnce();
      expect(trigger).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledTimes(2);
    } finally {
      await watchingMailbox.dispose();
    }
  });

  it.each([
    {
      label: 'expired orphan',
      sweepAt: '2026-08-16T12:00:20.000Z',
      receipt: false,
      retained: false,
    },
    {
      label: 'unexpired orphan without a terminal receipt',
      sweepAt: NOW,
      receipt: false,
      retained: true,
    },
    {
      label: 'unexpired terminal orphan with an exact receipt',
      sweepAt: NOW,
      receipt: true,
      retained: false,
    },
  ])('$label follows the bounded orphan-slot retention policy', async ({ label, sweepAt, receipt, retained }) => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = `command_${label.replaceAll(/[^a-z]+/g, '_')}`;
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2(commandId)));
    if (receipt) await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, commandId));

    await expect(mailbox.releaseOrphanedSlotsPage(null, sweepAt, 64)).resolves.toMatchObject({ nextCursor: null });

    expect(existsSync(slotFile)).toBe(retained);
    expect(existsSync(leaseFile)).toBe(false);
    if (receipt) {
      await expect(nodeFs.readFile(path.join(directories.receipts, `${commandId}.json`), 'utf8')).resolves.toBe(
        JSON.stringify(makeReceiptV2(projectId, commandId))
      );
    }
  });

  it('keeps maintenance non-allocating for a supported project without a command family', async () => {
    const commands = path.join(rootDir, projectId, 'commands');

    await expect(mailbox.releaseOrphanedSlotsPage(null, NOW, 64)).resolves.toMatchObject({ nextCursor: null });

    expect(existsSync(commands)).toBe(false);
  });

  it.each([
    {
      label: 'live pending command',
      kind: 'valid' as const,
      pending: true,
      lease: 'none' as const,
      sweepAt: NOW,
      retained: true,
      leaseRetained: false,
    },
    {
      label: 'active writer lease',
      kind: 'valid' as const,
      pending: false,
      lease: 'active' as const,
      sweepAt: NOW,
      retained: true,
      leaseRetained: true,
    },
    {
      label: 'expired writer lease',
      kind: 'valid' as const,
      pending: false,
      lease: 'expired' as const,
      sweepAt: '2026-08-16T12:00:20.000Z',
      retained: false,
      leaseRetained: false,
    },
    {
      label: 'recoverable malformed orphan',
      kind: 'invalid' as const,
      pending: false,
      lease: 'none' as const,
      sweepAt: NOW,
      retained: false,
      leaseRetained: false,
    },
    {
      label: 'recoverable malformed occupied slot',
      kind: 'invalid' as const,
      pending: true,
      lease: 'none' as const,
      sweepAt: NOW,
      retained: true,
      leaseRetained: false,
    },
  ])('retains or releases a $label from exact durable evidence', async (scenario) => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = `command_${scenario.label.replaceAll(/[^a-z]+/g, '_')}`;
    const slot = makeSlotV2(commandId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    await nodeFs.writeFile(
      slotFile,
      scenario.kind === 'valid' ? JSON.stringify(slot) : JSON.stringify({ ...slot, deadlineAt: 'not-a-timestamp' })
    );
    if (scenario.pending) {
      await nodeFs.writeFile(
        path.join(directories.pending, `${commandId}.json`),
        JSON.stringify(makeCommandV2(projectId, commandId))
      );
    }
    if (scenario.lease !== 'none') {
      await nodeFs.writeFile(
        leaseFile,
        JSON.stringify(
          makeLeaseV2({
            leaseId: `lease_${scenario.lease}`,
            owner: 'writer',
            slot,
            ...(scenario.lease === 'expired' ? { acquiredAt: '2026-08-16T11:59:30.000Z' } : {}),
          })
        )
      );
    }

    await expect(mailbox.releaseOrphanedSlotsPage(null, scenario.sweepAt, 64)).resolves.toMatchObject({
      nextCursor: null,
    });

    expect(existsSync(slotFile)).toBe(scenario.retained);
    expect(existsSync(leaseFile)).toBe(scenario.leaseRetained);
    expect(existsSync(path.join(directories.pending, `${commandId}.json`))).toBe(scenario.pending);
  });

  it.each([
    {
      label: 'malformed record with a recovered revision',
      expectedRevision: 1,
      reasonCode: 'malformed_record' as const,
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        policy: 'manual_review',
      }),
    },
    {
      label: 'malformed record without a recovered revision',
      expectedRevision: null,
      reasonCode: 'malformed_record' as const,
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        expectedRevision: 'invalid',
      }),
    },
    {
      label: 'future Director command schema record',
      expectedRevision: 1,
      reasonCode: 'unsupported_version' as const,
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 + 1,
      }),
    },
  ])('finishes an exactly rejected $label while retaining its receipt', async (testCase) => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = `command_terminal_${testCase.reasonCode}_${testCase.expectedRevision ?? 'null'}`;
    const pendingFile = path.join(directories.pending, `${commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const receipt = makeRejectedReceiptV2({
      projectId,
      commandId,
      expectedRevision: testCase.expectedRevision,
      reasonCode: testCase.reasonCode,
    });
    const receiptBytes = JSON.stringify(receipt);
    await nodeFs.writeFile(pendingFile, JSON.stringify(testCase.pending(projectId, commandId)));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2(commandId)));
    await mailbox.writeReceipt(projectId, receipt);

    await expect(mailbox.finish(projectId, commandId)).resolves.toBeUndefined();

    await expect(nodeFs.lstat(pendingFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeFs.lstat(slotFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeFs.lstat(leaseFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
  });

  it.each(['malformed_record', 'unsupported_version'] as const)(
    'preserves a valid pending behind a same-revision %s rejection',
    async (reasonCode) => {
      await mailbox.ensure(projectId);
      const directories = commandDirectories(rootDir, projectId);
      const commandId = `command_valid_pending_invalid_reason_${reasonCode}`;
      await nodeFs.writeFile(
        path.join(directories.pending, `${commandId}.json`),
        JSON.stringify(makeCommandV2(projectId, commandId))
      );
      await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlotV2(commandId)));
      await mailbox.writeReceipt(
        projectId,
        makeRejectedReceiptV2({ projectId, commandId, expectedRevision: 1, reasonCode })
      );
      const before = await snapshotDirectoryBytes(directories.root);

      await expect(mailbox.finish(projectId, commandId)).rejects.toMatchObject({ code: 'storage_error' });

      expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
    }
  );

  it.each([
    {
      label: 'receipt reason',
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        policy: 'manual_review',
      }),
      receipt: (commandId: string): StudioDirectorCommandReceiptV2 =>
        makeRejectedReceiptV2({
          projectId,
          commandId,
          expectedRevision: 1,
          reasonCode: 'unsupported_version',
        }),
      slot: (commandId: string): unknown => makeSlotV2(commandId),
    },
    {
      label: 'nullable expected revision',
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        expectedRevision: 'invalid',
      }),
      receipt: (commandId: string): StudioDirectorCommandReceiptV2 =>
        makeRejectedReceiptV2({
          projectId,
          commandId,
          expectedRevision: 1,
          reasonCode: 'malformed_record',
        }),
      slot: (commandId: string): unknown => makeSlotV2(commandId),
    },
    {
      label: 'non-rejected receipt status',
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        policy: 'manual_review',
      }),
      receipt: (commandId: string): StudioDirectorCommandReceiptV2 => makeReceiptV2(projectId, commandId),
      slot: (commandId: string): unknown => makeSlotV2(commandId),
    },
    {
      label: 'different-command slot',
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        policy: 'manual_review',
      }),
      receipt: (commandId: string): StudioDirectorCommandReceiptV2 =>
        makeRejectedReceiptV2({
          projectId,
          commandId,
          expectedRevision: 1,
          reasonCode: 'malformed_record',
        }),
      slot: (): unknown => makeSlotV2('different_command'),
    },
    {
      label: 'same-command slot deadline',
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        policy: 'manual_review',
      }),
      receipt: (commandId: string): StudioDirectorCommandReceiptV2 =>
        makeRejectedReceiptV2({
          projectId,
          commandId,
          expectedRevision: 1,
          reasonCode: 'malformed_record',
        }),
      slot: (commandId: string): unknown => makeSlotV2(commandId, { deadlineAt: '2026-08-16T12:00:14.000Z' }),
    },
    {
      label: 'malformed same-command slot',
      pending: (boundProjectId: string, commandId: string): unknown => ({
        ...makeCommandV2(boundProjectId, commandId),
        policy: 'manual_review',
      }),
      receipt: (commandId: string): StudioDirectorCommandReceiptV2 =>
        makeRejectedReceiptV2({
          projectId,
          commandId,
          expectedRevision: 1,
          reasonCode: 'malformed_record',
        }),
      slot: (commandId: string): unknown => ({ ...makeSlotV2(commandId), unexpected: true }),
    },
  ])('preserves terminal sidecars when the invalid cleanup $label mismatches', async (testCase) => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = `command_invalid_mismatch_${testCase.label.replaceAll(/[^a-z]+/g, '_')}`;
    await nodeFs.writeFile(
      path.join(directories.pending, `${commandId}.json`),
      JSON.stringify(testCase.pending(projectId, commandId))
    );
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(testCase.slot(commandId)));
    await mailbox.writeReceipt(projectId, testCase.receipt(commandId));
    const before = await snapshotDirectoryBytes(directories.root);

    await expect(mailbox.finish(projectId, commandId)).rejects.toMatchObject({ code: 'storage_error' });

    expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
  });

  it('restores an invalid pending when its exact slot is replaced during pending quarantine', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_invalid_pending_slot_race';
    const pendingFile = path.join(directories.pending, `${commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const pendingBytes = JSON.stringify({ ...makeCommandV2(projectId, commandId), policy: 'manual_review' });
    const originalSlot = makeSlotV2(commandId);
    const successorSlotBytes = JSON.stringify(makeSlotV2('successor_command'));
    const receipt = makeRejectedReceiptV2({
      projectId,
      commandId,
      expectedRevision: 1,
      reasonCode: 'malformed_record',
    });
    const receiptBytes = JSON.stringify(receipt);
    const heldLeaseBytes = JSON.stringify(
      makeLeaseV2({ leaseId: 'lease_invalid_pending_slot_race', owner: 'main', slot: originalSlot })
    );
    await nodeFs.writeFile(pendingFile, pendingBytes);
    await nodeFs.writeFile(slotFile, JSON.stringify(originalSlot));
    await mailbox.writeReceipt(projectId, receipt);
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rename') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          await nodeFs.rename(...args);
          if (!replaced && String(args[0]) === pendingFile) {
            replaced = true;
            await nodeFs.rm(slotFile);
            await nodeFs.writeFile(slotFile, successorSlotBytes);
          }
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      createId: () => 'lease_invalid_pending_slot_race',
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, commandId)).rejects.toMatchObject({ code: 'storage_error' });

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(pendingBytes);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(successorSlotBytes);
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toBe(heldLeaseBytes);
    await racingMailbox.dispose();
  });

  it('fails closed when an observed invalid pending disappears before quarantine', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_invalid_pending_missing_race';
    const pendingFile = path.join(directories.pending, `${commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const slot = makeSlotV2(commandId);
    const slotBytes = JSON.stringify(slot);
    const receipt = makeRejectedReceiptV2({
      projectId,
      commandId,
      expectedRevision: 1,
      reasonCode: 'malformed_record',
    });
    const receiptBytes = JSON.stringify(receipt);
    const heldLeaseBytes = JSON.stringify(
      makeLeaseV2({ leaseId: 'lease_invalid_pending_missing_race', owner: 'main', slot })
    );
    await nodeFs.writeFile(
      pendingFile,
      JSON.stringify({ ...makeCommandV2(projectId, commandId), policy: 'manual_review' })
    );
    await nodeFs.writeFile(slotFile, slotBytes);
    await mailbox.writeReceipt(projectId, receipt);
    let leasePublished = false;
    let pendingChecksAfterLease = 0;
    let removed = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === leaseFile) leasePublished = true;
          };
        }
        if (property !== 'lstat') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          if (leasePublished && String(args[0]) === pendingFile) {
            pendingChecksAfterLease += 1;
            if (pendingChecksAfterLease === 2) {
              removed = true;
              await nodeFs.rm(pendingFile);
            }
          }
          return nodeFs.lstat(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      createId: () => 'lease_invalid_pending_missing_race',
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, commandId)).rejects.toMatchObject({ code: 'storage_error' });

    expect(removed).toBe(true);
    await expect(nodeFs.lstat(pendingFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toBe(heldLeaseBytes);
    await racingMailbox.dispose();
  });

  it.each(['applied', 'rejected'] as const)(
    'rejects a valid %s receipt for another expected revision without changing command authority',
    async (status) => {
      await mailbox.ensure(projectId);
      const directories = commandDirectories(rootDir, projectId);
      const command = makeCommandV2(projectId, `command_revision_${status}`);
      const slot = makeSlotV2(command.commandId);
      const receipt: StudioDirectorCommandReceiptV2 =
        status === 'applied'
          ? {
              schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
              commandId: command.commandId,
              projectId,
              expectedRevision: 2,
              decidedAt: NOW,
              status,
              appliedRevision: 3,
              createdBeatIds: [],
              createdShotIds: [],
            }
          : {
              schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
              commandId: command.commandId,
              projectId,
              expectedRevision: 2,
              decidedAt: NOW,
              status,
              observedRevision: 2,
              reasonCode: 'stale_revision',
            };
      await nodeFs.writeFile(path.join(directories.pending, `${command.commandId}.json`), JSON.stringify(command));
      await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
      await mailbox.writeReceipt(projectId, receipt);
      const before = await snapshotDirectoryBytes(directories.root);

      await expect(mailbox.finish(projectId, command.commandId)).rejects.toMatchObject({ code: 'storage_error' });

      expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);

      await nodeFs.writeFile(
        path.join(directories.slots, '0.slot.lease'),
        JSON.stringify(makeLeaseV2({ leaseId: `lease_revision_${status}`, owner: 'writer', slot }))
      );
      const withLease = await snapshotDirectoryBytes(directories.root);

      await expect(mailbox.finish(projectId, command.commandId)).rejects.toMatchObject({ code: 'storage_error' });

      expect(await snapshotDirectoryBytes(directories.root)).toEqual(withLease);
    }
  );

  it('keeps a valid receipt authoritative when crash recovery finds no pending record', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = 'command_receipt_first_v2';
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlotV2(commandId)));
    const receipt = makeReceiptV2(projectId, commandId, {
      expectedRevision: 9,
      appliedRevision: 10,
    });
    await mailbox.writeReceipt(projectId, receipt);

    await expect(mailbox.finish(projectId, commandId)).resolves.toBeUndefined();

    await expect(nodeFs.readdir(directories.pending)).resolves.toEqual([]);
    await expect(nodeFs.readdir(directories.slots)).resolves.toEqual([]);
    await expect(nodeFs.readFile(path.join(directories.receipts, `${commandId}.json`), 'utf8')).resolves.toBe(
      JSON.stringify(receipt)
    );
  });

  it('restores a receipt-first slot when a mismatched pending record appears during quarantine', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_receipt_first_pending_race';
    const pendingFile = path.join(directories.pending, `${commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const slotBytes = JSON.stringify(makeSlotV2(commandId));
    const receipt = makeReceiptV2(projectId, commandId);
    const receiptBytes = JSON.stringify(receipt);
    const mismatchedPendingBytes = JSON.stringify(makeCommandV2(projectId, commandId, { expectedRevision: 2 }));
    await nodeFs.writeFile(slotFile, slotBytes);
    await mailbox.writeReceipt(projectId, receipt);
    let inserted = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rename') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          await nodeFs.rename(...args);
          if (!inserted && String(args[0]) === slotFile) {
            inserted = true;
            await nodeFs.writeFile(pendingFile, mismatchedPendingBytes);
          }
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      createId: () => 'lease_receipt_first_pending_race',
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, commandId)).rejects.toMatchObject({ code: 'storage_error' });

    expect(inserted).toBe(true);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(mismatchedPendingBytes);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
    await racingMailbox.dispose();
  });

  it('restores its main lease when the correlated pending inode changes during lease quarantine', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_pending_lease_race';
    const pendingFile = path.join(directories.pending, `${commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const pendingBytes = JSON.stringify(makeCommandV2(projectId, commandId));
    const slotBytes = JSON.stringify(makeSlotV2(commandId));
    const receipt = makeReceiptV2(projectId, commandId);
    const receiptBytes = JSON.stringify(receipt);
    await nodeFs.writeFile(pendingFile, pendingBytes);
    await nodeFs.writeFile(slotFile, slotBytes);
    await mailbox.writeReceipt(projectId, receipt);
    const originalPending = await nodeFs.lstat(pendingFile);
    let leasePublished = false;
    let freshSlotFailed = false;
    let pendingReplaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === leaseFile) leasePublished = true;
          };
        }
        if (property === 'open') {
          return async (...args: Parameters<typeof nodeFs.open>) => {
            if (leasePublished && !freshSlotFailed && String(args[0]) === slotFile) {
              freshSlotFailed = true;
              throw Object.assign(new Error('fresh slot read failed'), { code: 'EIO' });
            }
            return nodeFs.open(...args);
          };
        }
        if (property !== 'rename') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          await nodeFs.rename(...args);
          if (freshSlotFailed && !pendingReplaced && String(args[0]) === leaseFile) {
            const replacement = `${pendingFile}.replacement`;
            await nodeFs.writeFile(replacement, pendingBytes);
            await nodeFs.rename(replacement, pendingFile);
            pendingReplaced = true;
          }
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      createId: () => 'lease_pending_inode_race',
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, commandId)).rejects.toMatchObject({ code: 'storage_error' });

    expect(freshSlotFailed).toBe(true);
    expect(pendingReplaced).toBe(true);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(pendingBytes);
    expect((await nodeFs.lstat(pendingFile)).ino).not.toBe(originalPending.ino);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toContain('"leaseId":"lease_pending_inode_race"');
    await racingMailbox.dispose();
  });

  it('rechecks V2 project classification after reading pending and slot records', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const command = makeCommandV2(projectId, 'command_pending_project_race');
    const pendingFile = path.join(directories.pending, `${command.commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const manifestFile = path.join(canonicalRoot, projectId, 'project.json');
    const replacementManifest = `${manifestFile}.legacy`;
    const legacyManifest = JSON.stringify({ schemaVersion: 4, id: projectId });
    const pendingBytes = JSON.stringify(command);
    const slotBytes = JSON.stringify(makeSlotV2(command.commandId));
    await nodeFs.writeFile(pendingFile, pendingBytes);
    await nodeFs.writeFile(slotFile, slotBytes);
    let swapped = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          if (!swapped && String(args[0]) === slotFile) {
            swapped = true;
            await nodeFs.writeFile(replacementManifest, legacyManifest);
            await nodeFs.rename(replacementManifest, manifestFile);
          }
          return nodeFs.open(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.readPending(projectId, command.commandId)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });

    expect(swapped).toBe(true);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(pendingBytes);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
    await racingMailbox.dispose();
  });

  it('rechecks V2 project classification after an absent receipt read', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_absent_receipt_project_race';
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const manifestFile = path.join(canonicalRoot, projectId, 'project.json');
    const replacementManifest = `${manifestFile}.legacy`;
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: projectId });
    let swapped = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'lstat') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          if (!swapped && String(args[0]) === receiptFile) {
            swapped = true;
            await nodeFs.writeFile(replacementManifest, legacyManifest);
            await nodeFs.rename(replacementManifest, manifestFile);
          }
          return nodeFs.lstat(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.readReceipt(projectId, commandId)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });

    expect(swapped).toBe(true);
    expect(existsSync(receiptFile)).toBe(false);
    await racingMailbox.dispose();
  });

  it('durably removes the V2 receipt guard before pending and slot cleanup', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const receiptFile = path.join(directories.receipts, 'command_ordered.json');
    const pendingFile = path.join(directories.pending, 'command_ordered.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const events: string[] = [];
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_ordered')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_ordered')));
    const observedFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === receiptFile) events.push('receipt-link');
          };
        }
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            const target = String(args[0]);
            if (target === `${receiptFile}.unconfirmed`) events.push('receipt-guard-rm');
            else if (target === pendingFile) events.push('pending-rm');
            else if (target === slotFile) events.push('slot-rm');
            return nodeFs.rm(...args);
          };
        }
        if (property === 'rename') {
          return async (...args: Parameters<typeof nodeFs.rename>) => {
            const source = String(args[0]);
            await nodeFs.rename(...args);
            if (source === pendingFile) events.push('pending-quarantine');
            else if (source === slotFile) events.push('slot-quarantine');
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== directories.receipts) return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty) {
              if (handleProperty === 'sync') {
                return async () => {
                  events.push('receipts-sync');
                  return realHandle.sync();
                };
              }
              const value = Reflect.get(realHandle, handleProperty, realHandle) as unknown;
              return typeof value === 'function' ? value.bind(realHandle) : value;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const observedMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: observedFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await observedMailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_ordered'));
    await observedMailbox.finish(projectId, 'command_ordered');

    expect(events).toEqual([
      'receipts-sync',
      'receipt-link',
      'receipts-sync',
      'receipt-guard-rm',
      'receipts-sync',
      'receipts-sync',
      'pending-quarantine',
      'slot-quarantine',
    ]);
    await expect(observedMailbox.readReceipt(projectId, 'command_ordered')).resolves.toMatchObject({
      status: 'valid',
    });
    await observedMailbox.dispose();
  });

  it('retains cleanup authority when the final V2 receipt sync is indeterminate across restart states', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const receipt = makeReceiptV2(projectId, 'command_indeterminate');
    const receiptFile = path.join(directories.receipts, 'command_indeterminate.json');
    const pendingFile = path.join(directories.pending, 'command_indeterminate.json');
    const slotFile = path.join(directories.slots, '0.slot');
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_indeterminate')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_indeterminate')));
    let receiptDirectorySyncs = 0;
    const failingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== directories.receipts) return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty) {
              if (handleProperty === 'sync') {
                return async () => {
                  receiptDirectorySyncs += 1;
                  if (receiptDirectorySyncs === 3) throw new Error('final receipt directory sync failed');
                  return realHandle.sync();
                };
              }
              const value = Reflect.get(realHandle, handleProperty, realHandle) as unknown;
              return typeof value === 'function' ? value.bind(realHandle) : value;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const failingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: failingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(failingMailbox.writeReceipt(projectId, receipt)).rejects.toMatchObject({ code: 'storage_error' });
    expect(receiptDirectorySyncs).toBe(3);
    await expect(failingMailbox.readReceipt(projectId, receipt.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(failingMailbox.finish(projectId, receipt.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(existsSync(pendingFile)).toBe(true);
    expect(existsSync(slotFile)).toBe(true);
    await failingMailbox.dispose();

    await nodeFs.writeFile(`${receiptFile}.unconfirmed`, '1');
    const guardedRestart = createStudioDirectorCommandMailboxV2({ rootDir, store, now: () => NOW, waitMs: WAIT_MS });
    await expect(guardedRestart.readReceipt(projectId, receipt.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(guardedRestart.finish(projectId, receipt.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(existsSync(pendingFile)).toBe(true);
    expect(existsSync(slotFile)).toBe(true);
    await guardedRestart.dispose();

    await nodeFs.rm(`${receiptFile}.unconfirmed`);
    const cleanRestart = createStudioDirectorCommandMailboxV2({ rootDir, store, now: () => NOW, waitMs: WAIT_MS });
    await expect(cleanRestart.readReceipt(projectId, receipt.commandId)).resolves.toEqual({
      status: 'valid',
      record: receipt,
    });
    await expect(cleanRestart.finish(projectId, receipt.commandId)).resolves.toBeUndefined();
    expect(existsSync(pendingFile)).toBe(false);
    expect(existsSync(slotFile)).toBe(false);
    await cleanRestart.dispose();
  });

  it('refuses to link a V2 receipt into a replacement receipts-directory generation', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const receiptFile = path.join(directories.receipts, 'command_receipt_generation.json');
    const pendingFile = path.join(directories.pending, 'command_receipt_generation.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const retiredReceipts = `${directories.receipts}.retired`;
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_receipt_generation')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_receipt_generation')));
    let swapped = false;
    let finalLinks = 0;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            if (String(args[1]) === receiptFile) finalLinks += 1;
            return nodeFs.link(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = String(args[0]);
          if (!swapped && file.startsWith(`${receiptFile}.`) && file.endsWith('.tmp')) {
            swapped = true;
            await nodeFs.rename(directories.receipts, retiredReceipts);
            await nodeFs.mkdir(directories.receipts);
          }
          return nodeFs.open(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(
      racingMailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_receipt_generation'))
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(swapped).toBe(true);
    expect(finalLinks).toBe(0);
    await expect(nodeFs.readdir(directories.receipts)).resolves.toEqual([]);
    await expect(nodeFs.readdir(retiredReceipts)).resolves.toEqual([]);
    expect(existsSync(pendingFile)).toBe(true);
    expect(existsSync(slotFile)).toBe(true);
    await racingMailbox.dispose();
  });

  it('refuses to link a V2 receipt after the project manifest becomes schema-1 during temp sync', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_receipt_project_race';
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const manifestFile = path.join(canonicalRoot, projectId, 'project.json');
    const replacementManifest = `${manifestFile}.legacy`;
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: projectId });
    let swapped = false;
    let finalLinks = 0;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            if (String(args[1]) === receiptFile) finalLinks += 1;
            return nodeFs.link(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = String(args[0]);
          if (!swapped && file.startsWith(`${receiptFile}.`) && file.endsWith('.tmp')) {
            swapped = true;
            await nodeFs.writeFile(replacementManifest, legacyManifest);
            await nodeFs.rename(replacementManifest, manifestFile);
          }
          return nodeFs.open(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.writeReceipt(projectId, makeReceiptV2(projectId, commandId))).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(swapped).toBe(true);
    expect(finalLinks).toBe(0);
    await expect(nodeFs.readFile(manifestFile, 'utf8')).resolves.toBe(legacyManifest);
    await expect(nodeFs.readdir(directories.receipts)).resolves.toEqual([]);
    await racingMailbox.dispose();
  });

  it('fences an after-effect receipt-link failure until restart durably revalidates it', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const command = makeCommandV2(projectId, 'command_receipt_link_ambiguity');
    const receipt = makeReceiptV2(projectId, command.commandId);
    const receiptFile = path.join(directories.receipts, `${command.commandId}.json`);
    const pendingFile = path.join(directories.pending, `${command.commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    await nodeFs.writeFile(pendingFile, JSON.stringify(command));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2(command.commandId)));
    const failingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'link') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.link>) => {
          await nodeFs.link(...args);
          if (String(args[1]) === receiptFile) throw new Error('receipt link result lost');
        };
      },
    }) as typeof nodeFs;
    const failingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: failingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(failingMailbox.writeReceipt(projectId, receipt)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(failingMailbox.readReceipt(projectId, command.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(failingMailbox.finish(projectId, command.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(existsSync(pendingFile)).toBe(true);
    expect(existsSync(slotFile)).toBe(true);
    expect(existsSync(receiptFile)).toBe(true);
    await failingMailbox.dispose();

    const events: string[] = [];
    const restartFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'rename') {
          return async (...args: Parameters<typeof nodeFs.rename>) => {
            const source = String(args[0]);
            await nodeFs.rename(...args);
            if (source === pendingFile) events.push('pending-quarantine');
            else if (source === slotFile) events.push('slot-quarantine');
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== directories.receipts) return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty) {
              if (handleProperty === 'sync') {
                return async () => {
                  events.push('receipts-sync');
                  return realHandle.sync();
                };
              }
              const value = Reflect.get(realHandle, handleProperty, realHandle) as unknown;
              return typeof value === 'function' ? value.bind(realHandle) : value;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const restartedMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: restartFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(restartedMailbox.readReceipt(projectId, command.commandId)).resolves.toEqual({
      status: 'valid',
      record: receipt,
    });
    expect(events).toEqual(['receipts-sync']);
    events.length = 0;
    await restartedMailbox.finish(projectId, command.commandId);
    expect(events).toEqual(['receipts-sync', 'pending-quarantine', 'slot-quarantine']);
    await restartedMailbox.dispose();
  });

  it('refuses to link a V2 main lease into a replacement slots-directory generation', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const pendingFile = path.join(directories.pending, 'command_lease_generation.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const retiredSlots = `${directories.slots}.retired`;
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_lease_generation')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_lease_generation')));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_lease_generation'));
    let swapped = false;
    let finalLinks = 0;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            if (String(args[1]) === leaseFile) finalLinks += 1;
            return nodeFs.link(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = String(args[0]);
          if (!swapped && file.startsWith(`${leaseFile}.`) && file.endsWith('.tmp')) {
            swapped = true;
            await nodeFs.rename(directories.slots, retiredSlots);
            await nodeFs.mkdir(directories.slots);
          }
          return nodeFs.open(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, 'command_lease_generation')).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(swapped).toBe(true);
    expect(finalLinks).toBe(0);
    expect(existsSync(pendingFile)).toBe(true);
    await expect(nodeFs.readdir(directories.slots)).resolves.toEqual([]);
    await expect(nodeFs.readFile(path.join(retiredSlots, '0.slot'), 'utf8')).resolves.toBe(
      JSON.stringify(makeSlotV2('command_lease_generation'))
    );
    await racingMailbox.dispose();
  });

  it('exact-cleans its linked V2 main lease when the project manifest becomes schema-1 after link', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const command = makeCommandV2(projectId, 'command_lease_project_race');
    const receipt = makeReceiptV2(projectId, command.commandId);
    const slot = makeSlotV2(command.commandId);
    const pendingFile = path.join(directories.pending, `${command.commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const receiptFile = path.join(directories.receipts, `${command.commandId}.json`);
    const manifestFile = path.join(canonicalRoot, projectId, 'project.json');
    const replacementManifest = `${manifestFile}.legacy`;
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: projectId });
    const pendingBytes = JSON.stringify(command);
    const slotBytes = JSON.stringify(slot);
    const receiptBytes = JSON.stringify(receipt);
    await nodeFs.writeFile(pendingFile, pendingBytes);
    await nodeFs.writeFile(slotFile, slotBytes);
    await mailbox.writeReceipt(projectId, receipt);
    let swapped = false;
    let linkedLeaseBytes: string | undefined;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'link') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.link>) => {
          await nodeFs.link(...args);
          if (!swapped && String(args[1]) === leaseFile) {
            swapped = true;
            linkedLeaseBytes = await nodeFs.readFile(leaseFile, 'utf8');
            await nodeFs.writeFile(replacementManifest, legacyManifest);
            await nodeFs.rename(replacementManifest, manifestFile);
          }
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      createId: () => 'lease_project_race',
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, command.commandId)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });

    expect(swapped).toBe(true);
    expect(linkedLeaseBytes).toContain('lease_project_race');
    await expect(nodeFs.readFile(manifestFile, 'utf8')).resolves.toBe(legacyManifest);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(pendingBytes);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
    expect(existsSync(leaseFile)).toBe(false);
    expect((await nodeFs.readdir(directories.slots)).some((entry) => entry.endsWith('.cleanup'))).toBe(false);
    await racingMailbox.dispose();
  });

  it('refuses to link a stale V2 main lease after its slot changes during temp sync', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const pendingFile = path.join(directories.pending, 'command_lease_slot_race.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const successorBytes = JSON.stringify(makeSlotV2('command_slot_successor'));
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_lease_slot_race')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_lease_slot_race')));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_lease_slot_race'));
    let replaced = false;
    let finalLinks = 0;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            if (String(args[1]) === leaseFile) finalLinks += 1;
            return nodeFs.link(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = String(args[0]);
          if (!replaced && file.startsWith(`${leaseFile}.`) && file.endsWith('.tmp')) {
            replaced = true;
            await nodeFs.rm(slotFile);
            await nodeFs.writeFile(slotFile, successorBytes);
          }
          return nodeFs.open(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, 'command_lease_slot_race')).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(replaced).toBe(true);
    expect(finalLinks).toBe(0);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(successorBytes);
    expect(existsSync(pendingFile)).toBe(true);
    await racingMailbox.dispose();
  });

  it('reports schema-1 sidecars as unsupported and leaves their complete byte tree untouched', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const command = makeUnsupportedCommand(projectId, 'command_v1');
    const slot = makeUnsupportedSlot('command_v1');
    const receipt = makeUnsupportedReceipt(projectId, 'command_v1');
    await nodeFs.writeFile(path.join(directories.pending, 'command_v1.json'), JSON.stringify(command));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    await nodeFs.writeFile(path.join(directories.receipts, 'command_v1.json'), JSON.stringify(receipt));
    await nodeFs.writeFile(
      path.join(directories.slots, '0.slot.lease'),
      JSON.stringify(makeUnsupportedLease({ leaseId: 'lease_v1', owner: 'writer', slot }))
    );
    const before = await snapshotDirectoryBytes(directories.root);

    await expect(mailbox.readPending(projectId, 'command_v1')).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'command_v1',
      expectedRevision: 1,
    });
    await expect(mailbox.readReceipt(projectId, 'command_v1')).resolves.toEqual({
      status: 'unsupported_prototype_schema',
    });
    await expect(mailbox.finish(projectId, 'command_v1')).rejects.toMatchObject({ code: 'storage_error' });
    await mailbox.releaseOrphanedSlotsPage(null, '2026-08-16T12:00:20.000Z', 64);
    await mailbox.pruneReceiptsPage(null, '2026-08-17T12:00:00.000Z', 64);

    expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
  });

  it('reports immediate-prior schema-7 proposal-query sidecars as unsupported and leaves every byte untouched', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = 'command_v7';
    const command = {
      schemaVersion: 7,
      commandId,
      projectId,
      createdAt: NOW,
      deadlineAt: '2026-08-16T12:00:15.000Z',
      policy: 'get_proposal',
      proposalId: 'proposal_exact',
    };
    const slot = { ...makeSlotV2(commandId), schemaVersion: 7 };
    const lease = {
      ...makeLeaseV2({ leaseId: 'lease_v7', owner: 'writer', slot: makeSlotV2(commandId) }),
      schemaVersion: 7,
    };
    const receipt = {
      schemaVersion: 7,
      commandId,
      projectId,
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_proposal', proposalId: 'proposal_exact' },
      result: { status: 'not_found' },
    };
    await nodeFs.writeFile(path.join(directories.pending, `${commandId}.json`), JSON.stringify(command));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot.lease'), JSON.stringify(lease));
    await nodeFs.writeFile(path.join(directories.receipts, `${commandId}.json`), JSON.stringify(receipt));
    const before = await snapshotDirectoryBytes(directories.root);

    await expect(mailbox.readPending(projectId, commandId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId,
      expectedRevision: null,
    });
    await expect(mailbox.readReceipt(projectId, commandId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
    });
    await expect(mailbox.finish(projectId, commandId)).rejects.toMatchObject({ code: 'storage_error' });
    await mailbox.releaseOrphanedSlotsPage(null, '2026-08-16T12:00:20.000Z', 64);
    await mailbox.pruneReceiptsPage(null, '2026-08-17T12:00:00.000Z', 64);

    expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
  });

  it('refuses receipt-first cleanup when the same-ID pending authority is schema-1', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    await nodeFs.writeFile(
      path.join(directories.pending, 'command_mixed.json'),
      JSON.stringify(makeUnsupportedCommand(projectId, 'command_mixed'))
    );
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlotV2('command_mixed')));
    await nodeFs.writeFile(
      path.join(directories.receipts, 'command_mixed.json'),
      JSON.stringify(makeReceiptV2(projectId, 'command_mixed'))
    );
    const before = await snapshotDirectoryBytes(directories.root);

    await expect(mailbox.finish(projectId, 'command_mixed')).rejects.toMatchObject({ code: 'storage_error' });

    expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
  });

  it('classifies a schema-1 pending before reclaiming its expired V2 lease', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const slot = makeSlotV2('command_mixed');
    await nodeFs.writeFile(
      path.join(directories.pending, 'command_mixed.json'),
      JSON.stringify(makeUnsupportedCommand(projectId, 'command_mixed'))
    );
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    await nodeFs.writeFile(
      path.join(directories.slots, '0.slot.lease'),
      JSON.stringify(
        makeLeaseV2({
          leaseId: 'lease_mixed',
          owner: 'main',
          slot,
          acquiredAt: '2026-08-16T11:59:30.000Z',
        })
      )
    );
    const before = await snapshotDirectoryBytes(directories.root);

    await mailbox.releaseOrphanedSlotsPage(null, '2026-08-16T12:00:20.000Z', 64);

    expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
  });

  it('accepts an unrelated valid successor published after old cleanup releases its lease', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const pendingA = path.join(directories.pending, 'command_a.json');
    const pendingB = path.join(directories.pending, 'command_b.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const successorCommand = makeCommandV2(projectId, 'command_b');
    const successorSlot = makeSlotV2('command_b');
    await nodeFs.writeFile(pendingA, JSON.stringify(makeCommandV2(projectId, 'command_a')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_a')));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_a'));
    let successorPublished = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rm>) => {
          const target = String(args[0]);
          await nodeFs.rm(...args);
          if (!target.startsWith(`${leaseFile}.`) || !target.endsWith('.cleanup') || successorPublished) return;
          successorPublished = true;
          await nodeFs.writeFile(slotFile, JSON.stringify(successorSlot));
          await nodeFs.writeFile(pendingB, JSON.stringify(successorCommand));
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, 'command_a')).resolves.toBeUndefined();

    expect(successorPublished).toBe(true);
    expect(existsSync(pendingA)).toBe(false);
    expect(JSON.parse(await nodeFs.readFile(pendingB, 'utf8'))).toEqual(successorCommand);
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(successorSlot);
    expect(existsSync(leaseFile)).toBe(false);
    await racingMailbox.dispose();
  });

  it('restores a same-inode schema-1 pending replacement raced into V2 finish cleanup', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const pendingFile = path.join(directories.pending, 'command_pending_race.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const legacyBytes = JSON.stringify(makeUnsupportedCommand(projectId, 'command_pending_race'));
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_pending_race')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_pending_race')));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_pending_race'));
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm' && property !== 'rename') return Reflect.get(realFs, property, receiver);
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            if (!replaced && String(args[0]) === pendingFile) {
              replaced = true;
              await nodeFs.writeFile(pendingFile, legacyBytes);
            }
            return nodeFs.rm(...args);
          };
        }
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          if (!replaced && String(args[0]) === pendingFile) {
            replaced = true;
            await nodeFs.writeFile(pendingFile, legacyBytes);
          }
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, 'command_pending_race')).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(legacyBytes);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(JSON.stringify(makeSlotV2('command_pending_race')));
    expect(existsSync(leaseFile)).toBe(true);
    await racingMailbox.dispose();
  });

  it('restores exact V2 cleanup records when the project manifest becomes schema-1 during quarantine', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const command = makeCommandV2(projectId, 'command_project_cleanup_race');
    const slot = makeSlotV2(command.commandId);
    const pendingFile = path.join(directories.pending, `${command.commandId}.json`);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const manifestFile = path.join(canonicalRoot, projectId, 'project.json');
    const replacementManifest = `${manifestFile}.legacy`;
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: projectId });
    const pendingBytes = JSON.stringify(command);
    const slotBytes = JSON.stringify(slot);
    await nodeFs.writeFile(pendingFile, pendingBytes);
    await nodeFs.writeFile(slotFile, slotBytes);
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, command.commandId));
    let leaseBytesBeforeSwap: string | undefined;
    let swapped = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rename') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          if (!swapped && String(args[0]) === pendingFile) {
            swapped = true;
            leaseBytesBeforeSwap = await nodeFs.readFile(leaseFile, 'utf8');
            await nodeFs.writeFile(replacementManifest, legacyManifest);
            await nodeFs.rename(replacementManifest, manifestFile);
          }
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      createId: () => 'lease_project_cleanup_race',
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, command.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(swapped).toBe(true);
    expect(leaseBytesBeforeSwap).toBeDefined();
    await expect(nodeFs.readFile(manifestFile, 'utf8')).resolves.toBe(legacyManifest);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(pendingBytes);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toBe(leaseBytesBeforeSwap);
    await expect(nodeFs.readdir(directories.pending)).resolves.toEqual([`${command.commandId}.json`]);
    await racingMailbox.dispose();
  });

  it('restores V2 pending when held lease authority changes during its quarantine rename', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const command = makeCommandV2(projectId, 'command_pending_lease_race');
    const pendingFile = path.join(directories.pending, command.commandId + '.json');
    const slot = makeSlotV2(command.commandId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const replacementBytes = JSON.stringify(
      makeLeaseV2({ leaseId: 'lease_pending_replacement', owner: 'writer', slot })
    );
    await nodeFs.writeFile(pendingFile, JSON.stringify(command));
    await nodeFs.writeFile(slotFile, JSON.stringify(slot));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, command.commandId));
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rename') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          if (!replaced && String(args[0]) === pendingFile) {
            replaced = true;
            await nodeFs.rm(leaseFile);
            await nodeFs.writeFile(leaseFile, replacementBytes);
          }
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, command.commandId)).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(pendingFile, 'utf8')).resolves.toBe(JSON.stringify(command));
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(JSON.stringify(slot));
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toBe(replacementBytes);
    await racingMailbox.dispose();
  });

  it('restores a successor slot raced into V2 finish cleanup', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const pendingFile = path.join(directories.pending, 'command_slot_race.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const successorBytes = JSON.stringify(makeSlotV2('command_successor'));
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_slot_race')));
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlotV2('command_slot_race')));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_slot_race'));
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm' && property !== 'rename') return Reflect.get(realFs, property, receiver);
        const replace = async (source: string): Promise<void> => {
          if (replaced || source !== slotFile) return;
          replaced = true;
          await nodeFs.rm(slotFile);
          await nodeFs.writeFile(slotFile, successorBytes);
        };
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            await replace(String(args[0]));
            return nodeFs.rm(...args);
          };
        }
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          await replace(String(args[0]));
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, 'command_slot_race')).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(successorBytes);
    expect(existsSync(leaseFile)).toBe(true);
    await racingMailbox.dispose();
  });

  it('restores a replacement lease raced into V2 finish release', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const pendingFile = path.join(directories.pending, 'command_lease_race.json');
    const slot = makeSlotV2('command_lease_race');
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const replacementLease = makeLeaseV2({ leaseId: 'lease_replacement', owner: 'writer', slot });
    const replacementBytes = JSON.stringify(replacementLease);
    await nodeFs.writeFile(pendingFile, JSON.stringify(makeCommandV2(projectId, 'command_lease_race')));
    await nodeFs.writeFile(slotFile, JSON.stringify(slot));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, 'command_lease_race'));
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm' && property !== 'rename') return Reflect.get(realFs, property, receiver);
        const replace = async (source: string): Promise<void> => {
          if (replaced || source !== leaseFile) return;
          replaced = true;
          await nodeFs.rm(leaseFile);
          await nodeFs.writeFile(leaseFile, replacementBytes);
        };
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            await replace(String(args[0]));
            return nodeFs.rm(...args);
          };
        }
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          await replace(String(args[0]));
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(racingMailbox.finish(projectId, 'command_lease_race')).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toBe(replacementBytes);
    await racingMailbox.dispose();
  });

  it('restores an active lease raced into V2 expired-lease reclaim', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slot = makeSlotV2('command_reclaim_race', {
      reservedAt: '2026-08-16T11:59:40.000Z',
      deadlineAt: '2026-08-16T11:59:55.000Z',
    });
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const expiredLease = makeLeaseV2({
      leaseId: 'lease_expired',
      owner: 'main',
      slot,
      acquiredAt: '2026-08-16T11:59:57.999Z',
    });
    const replacementLease = makeLeaseV2({ leaseId: 'lease_active', owner: 'writer', slot });
    const replacementBytes = JSON.stringify(replacementLease);
    await nodeFs.writeFile(slotFile, JSON.stringify(slot));
    await nodeFs.writeFile(leaseFile, JSON.stringify(expiredLease));
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm' && property !== 'rename') return Reflect.get(realFs, property, receiver);
        const replace = async (source: string): Promise<void> => {
          if (replaced || source !== leaseFile) return;
          replaced = true;
          await nodeFs.rm(leaseFile);
          await nodeFs.writeFile(leaseFile, replacementBytes);
        };
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            await replace(String(args[0]));
            return nodeFs.rm(...args);
          };
        }
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          await replace(String(args[0]));
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await racingMailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(JSON.stringify(slot));
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toBe(replacementBytes);
    await racingMailbox.dispose();
  });

  it('restores an orphan slot when held lease authority changes during its quarantine rename', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slot = makeSlotV2('command_orphan_lease_race', {
      reservedAt: '2026-08-16T11:59:40.000Z',
      deadlineAt: '2026-08-16T11:59:55.000Z',
    });
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const replacementBytes = JSON.stringify(
      makeLeaseV2({ leaseId: 'lease_orphan_replacement', owner: 'writer', slot })
    );
    await nodeFs.writeFile(slotFile, JSON.stringify(slot));
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rename') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          if (!replaced && String(args[0]) === slotFile) {
            replaced = true;
            await nodeFs.rm(leaseFile);
            await nodeFs.writeFile(leaseFile, replacementBytes);
          }
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await racingMailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(slotFile, 'utf8')).resolves.toBe(JSON.stringify(slot));
    await expect(nodeFs.readFile(leaseFile, 'utf8')).resolves.toBe(replacementBytes);
    await racingMailbox.dispose();
  });

  it('restores a schema-1 receipt replacement raced into V2 retention cleanup', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_receipt_prune_race';
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const legacyBytes = JSON.stringify(makeUnsupportedReceipt(projectId, commandId));
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, commandId));
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm' && property !== 'rename') return Reflect.get(realFs, property, receiver);
        const replace = async (source: string): Promise<void> => {
          if (replaced || source !== receiptFile) return;
          replaced = true;
          await nodeFs.rm(receiptFile);
          await nodeFs.writeFile(receiptFile, legacyBytes);
        };
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            await replace(String(args[0]));
            return nodeFs.rm(...args);
          };
        }
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          await replace(String(args[0]));
          return nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await racingMailbox.pruneReceiptsPage(null, '2026-08-17T12:00:00.000Z', 64);

    expect(replaced).toBe(true);
    await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(legacyBytes);
    await racingMailbox.dispose();
  });

  it('exactly prunes an eligible V2 receipt without cleanup residue', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = 'command_receipt_prune';
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, commandId));

    await mailbox.pruneReceiptsPage(null, '2026-08-17T12:00:00.000Z', 64);

    await expect(nodeFs.readdir(directories.receipts)).resolves.toEqual([]);
  });

  it('retains a V2 receipt while matching pending authority remains', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = 'command_receipt_pending';
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, commandId));
    await nodeFs.writeFile(
      path.join(directories.pending, `${commandId}.json`),
      JSON.stringify(makeCommandV2(projectId, commandId))
    );

    await mailbox.pruneReceiptsPage(null, '2026-08-17T12:00:00.000Z', 64);

    await expect(nodeFs.readdir(directories.receipts)).resolves.toEqual([`${commandId}.json`]);
  });

  it('retains a V2 receipt while its matching slot authority remains', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const commandId = 'command_receipt_slot';
    await mailbox.writeReceipt(projectId, makeReceiptV2(projectId, commandId));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlotV2(commandId)));

    await mailbox.pruneReceiptsPage(null, '2026-08-17T12:00:00.000Z', 64);

    await expect(nodeFs.readdir(directories.receipts)).resolves.toEqual([`${commandId}.json`]);
  });

  it('gates recursive watcher events on schema-2 project classification', async () => {
    let onChange: ((relativeFile: string) => void) | undefined;
    const close = vi.fn();
    const trigger = vi.fn();
    const watchingMailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      now: () => NOW,
      waitMs: WAIT_MS,
      watchCommandTree: ({ onChange: notify }) => {
        onChange = notify;
        return { close };
      },
    });
    const stop = await watchingMailbox.watch(trigger);

    onChange?.(`${legacyProjectId}/commands/pending/legacy_command.json`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(trigger).not.toHaveBeenCalled();

    onChange?.(`${projectId}/commands/pending/command_v2.json`);
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledExactlyOnceWith(projectId, 'command_v2'));

    await stop();
    await stop();
    expect(close).toHaveBeenCalledOnce();
    await watchingMailbox.dispose();
  });

  it('skips schema-1 projects during bounded sweeps without creating a mailbox', async () => {
    await mailbox.ensure(projectId);
    const command = makeCommandV2(projectId, 'command_v2');
    const directories = commandDirectories(rootDir, projectId);
    await nodeFs.writeFile(path.join(directories.pending, 'command_v2.json'), JSON.stringify(command));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlotV2('command_v2')));
    const legacyProjectFile = path.join(rootDir, legacyProjectId, 'project.json');
    const legacyBytes = await nodeFs.readFile(legacyProjectFile);

    const discovered: Array<{ projectId: string; commandId: string }> = [];
    let cursor: string | null = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await mailbox.snapshotPendingPage(cursor, 64);
      discovered.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(discovered).toEqual([{ projectId, commandId: 'command_v2' }]);
    expect(await nodeFs.readFile(legacyProjectFile)).toEqual(legacyBytes);
    await expect(nodeFs.access(path.join(rootDir, legacyProjectId, 'commands'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('returns explicit unsupported reads for a schema-1 project without touching its directory', async () => {
    const before = await snapshotDirectoryBytes(path.join(rootDir, legacyProjectId));

    await expect(mailbox.readPending(legacyProjectId, 'command_missing')).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'command_missing',
      expectedRevision: null,
    });
    await expect(mailbox.readReceipt(legacyProjectId, 'command_missing')).resolves.toEqual({
      status: 'unsupported_prototype_schema',
    });
    expect(await snapshotDirectoryBytes(path.join(rootDir, legacyProjectId))).toEqual(before);
  });
});
