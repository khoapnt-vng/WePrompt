/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, promises as nodeFs, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateStudioProjectInput,
  StudioDirectorCommandReceiptV1,
  StudioDirectorCommandRecordV1,
  StudioDirectorCommandSlotV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandMailbox,
  type StudioDirectorCommandMailbox,
} from '@process/services/creative-studio/service/directorCommandMailbox';
import { publishImmutableRecord } from '@process/services/creative-studio/service/recordIo';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';

const NOW = '2026-08-16T12:00:00.000Z';
const WAIT_MS = STUDIO_DIRECTOR_COMMAND_WAIT_MS;
const RECORDED_CALIBRATION_MAX_MS = 33.621;

const makeInput = (name: string): CreateStudioProjectInput => ({
  name,
  brief: 'A bounded calibration project',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
});

const makeCommand = (
  projectId: string,
  commandId: string,
  overrides: Partial<StudioDirectorCommandRecordV1> = {}
): StudioDirectorCommandRecordV1 => ({
  schemaVersion: 1,
  commandId,
  projectId,
  expectedRevision: 1,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A direct edit.' }],
  ...overrides,
});

const makeSlot = (
  commandId: string,
  overrides: Partial<StudioDirectorCommandSlotV1> = {}
): StudioDirectorCommandSlotV1 => ({
  schemaVersion: 1,
  commandId,
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  ...overrides,
});

const makeReceipt = (
  projectId: string,
  commandId: string,
  overrides: Partial<StudioDirectorCommandReceiptV1> = {}
): StudioDirectorCommandReceiptV1 =>
  ({
    schemaVersion: 1,
    commandId,
    projectId,
    expectedRevision: 1,
    decidedAt: NOW,
    status: 'applied',
    appliedRevision: 2,
    createdSceneIds: [],
    ...overrides,
  }) as StudioDirectorCommandReceiptV1;

const commandDirectories = (rootDir: string, projectId: string) => {
  const root = path.join(rootDir, projectId, 'commands');
  return {
    root,
    pending: path.join(root, 'pending'),
    slots: path.join(root, 'slots'),
    receipts: path.join(root, 'receipts'),
  };
};

const writeBundle = async (
  rootDir: string,
  projectId: string,
  commandId: string,
  input: { command?: unknown; slot?: unknown } = {}
): Promise<void> => {
  const directories = commandDirectories(rootDir, projectId);
  await nodeFs.writeFile(
    path.join(directories.pending, `${commandId}.json`),
    JSON.stringify(input.command ?? makeCommand(projectId, commandId))
  );
  await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(input.slot ?? makeSlot(commandId)));
};

describe('Studio Director command mailbox', () => {
  let rootDir: string;
  let store: CreativeStudioStore;
  let mailbox: StudioDirectorCommandMailbox;
  let projectId: string;
  let idCounter: number;

  beforeEach(async () => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'studio-command-mailbox-'));
    idCounter = 0;
    store = createCreativeStudioStore({
      rootDir,
      now: () => NOW,
      createId: () => `project_${String(++idCounter).padStart(3, '0')}`,
    });
    projectId = (await store.createProject(makeInput('Primary'))).id;
    mailbox = createStudioDirectorCommandMailbox({ rootDir, store, now: () => NOW, waitMs: WAIT_MS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('lazily creates only a wholly absent complete command directory set', async () => {
    await mailbox.ensure(projectId);

    const directories = commandDirectories(rootDir, projectId);
    expect(await nodeFs.readdir(directories.root)).toEqual(['pending', 'receipts', 'slots']);
    await expect(mailbox.ensure(projectId)).resolves.toBeUndefined();
  });

  it.each(['missing-receipts', 'symlinked-slots', 'file-pending'])(
    'rejects partial or unsafe storage: %s',
    async (kind) => {
      const directories = commandDirectories(rootDir, projectId);
      await nodeFs.mkdir(directories.root);
      if (kind === 'missing-receipts') {
        await nodeFs.mkdir(directories.pending);
        await nodeFs.mkdir(directories.slots);
      } else if (kind === 'symlinked-slots') {
        await nodeFs.mkdir(directories.pending);
        await nodeFs.mkdir(directories.receipts);
        await nodeFs.symlink(directories.pending, directories.slots);
      } else {
        await nodeFs.writeFile(directories.pending, 'not a directory');
        await nodeFs.mkdir(directories.slots);
        await nodeFs.mkdir(directories.receipts);
      }

      await expect(mailbox.ensure(projectId)).rejects.toMatchObject({ code: 'storage_error' });
      if (kind === 'missing-receipts') expect(existsSync(directories.receipts)).toBe(false);
    }
  );

  it('returns bounded invalid state for a malformed safe filename instead of dropping it', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1', {
      command: {
        schemaVersion: 1,
        commandId: 'command_1',
        projectId,
        expectedRevision: 17,
        prompt: 'credential at /Users/customer/project.json',
      },
    });

    const result = await mailbox.readPending(projectId, 'command_1');

    expect(result).toEqual({
      status: 'invalid',
      commandId: 'command_1',
      expectedRevision: 17,
      reasonCode: 'malformed_record',
    });
    expect(JSON.stringify(result)).not.toContain('credential');
    expect(JSON.stringify(result)).not.toContain('/Users/customer');
  });

  it('returns unsupported_version for a safe unsupported record and validates the exact slot relation', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1', {
      command: { ...makeCommand(projectId, 'command_1'), schemaVersion: 2 },
    });
    await expect(mailbox.readPending(projectId, 'command_1')).resolves.toMatchObject({
      status: 'invalid',
      reasonCode: 'unsupported_version',
    });

    await nodeFs.writeFile(
      path.join(commandDirectories(rootDir, projectId).pending, 'command_1.json'),
      JSON.stringify(makeCommand(projectId, 'command_1'))
    );
    await nodeFs.writeFile(
      path.join(commandDirectories(rootDir, projectId).slots, '0.slot'),
      JSON.stringify(makeSlot('other_safe_command'))
    );
    await expect(mailbox.readPending(projectId, 'command_1')).resolves.toMatchObject({
      status: 'invalid',
      reasonCode: 'malformed_record',
    });
  });

  it.each(['symlink', 'directory', 'oversize'])('fails safely for a %s named pending record', async (kind) => {
    await mailbox.ensure(projectId);
    const file = path.join(commandDirectories(rootDir, projectId).pending, 'command_1.json');
    if (kind === 'symlink') {
      await nodeFs.writeFile(path.join(rootDir, 'outside.json'), '{}');
      await nodeFs.symlink(path.join(rootDir, 'outside.json'), file);
    } else if (kind === 'directory') await nodeFs.mkdir(file);
    else await nodeFs.writeFile(file, 'x'.repeat(256 * 1024 + 1));

    await expect(mailbox.readPending(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('reads exact command files without touching proposal listing or reaping state', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    const listProposals = vi.spyOn(store, 'listProposals');
    const reapProposals = vi.spyOn(store, 'reapAbandonedProposals');

    await expect(mailbox.readPending(projectId, 'command_1')).resolves.toMatchObject({ status: 'valid' });
    await expect(mailbox.readReceipt(projectId, 'command_1')).resolves.toBeNull();
    expect(listProposals).not.toHaveBeenCalled();
    expect(reapProposals).not.toHaveBeenCalled();
  });

  it('publishes a receipt immutably before finish can remove pending and slot authority', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    const receipt = makeReceipt(projectId, 'command_1');
    const directories = commandDirectories(rootDir, projectId);

    await mailbox.finish(projectId, 'command_1');
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);

    await mailbox.writeReceipt(projectId, receipt);
    expect(await mailbox.readReceipt(projectId, 'command_1')).toEqual(receipt);
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);

    await expect(
      mailbox.writeReceipt(projectId, { ...receipt, createdSceneIds: ['scene_other'] })
    ).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    expect(await mailbox.readReceipt(projectId, 'command_1')).toEqual(receipt);

    await mailbox.finish(projectId, 'command_1');
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(false);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(false);
    expect(await mailbox.readReceipt(projectId, 'command_1')).toEqual(receipt);
  });

  it('reports a safe existing 0.slot command as busy authority without exposing unsafe slot bytes', async () => {
    await mailbox.ensure(projectId);
    const slotFile = path.join(commandDirectories(rootDir, projectId).slots, '0.slot');
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlot('command_existing')));

    await expect(mailbox.ensure(projectId)).resolves.toBeUndefined();
    await expect(mailbox.readPending(projectId, 'command_other')).resolves.toBeNull();
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toMatchObject({ commandId: 'command_existing' });
  });

  it('pages more than 64 pending references deterministically without duplicates or omission', async () => {
    await mailbox.ensure(projectId);
    const pending = commandDirectories(rootDir, projectId).pending;
    const expected = Array.from({ length: 131 }, (_, index) => `command_${String(index + 1).padStart(3, '0')}`);
    await Promise.all(
      expected.toReversed().map((commandId) => nodeFs.writeFile(path.join(pending, `${commandId}.json`), '{}'))
    );

    const observed: string[] = [];
    let cursor: string | null = null;
    do {
      // Cursor ownership is the behavior under test; every page is fetched from the real directory again.
      // eslint-disable-next-line no-await-in-loop
      const page = await mailbox.listPendingPage(cursor, 64);
      observed.push(...page.items.map((item) => item.commandId));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(observed).toEqual(expected);
    expect(new Set(observed).size).toBe(expected.length);
    await expect(mailbox.snapshotPendingPage(null, 64)).resolves.toMatchObject({
      items: expected.slice(0, 64).map((commandId) => ({ projectId, commandId })),
    });
  });

  it('releases only receipt-backed or deadline-expired orphan slots', async () => {
    const live = projectId;
    const expired = (await store.createProject(makeInput('Expired'))).id;
    const receiptBacked = (await store.createProject(makeInput('Receipt backed'))).id;
    for (const id of [live, expired, receiptBacked]) {
      // eslint-disable-next-line no-await-in-loop
      await mailbox.ensure(id);
    }
    await nodeFs.writeFile(
      path.join(commandDirectories(rootDir, live).slots, '0.slot'),
      JSON.stringify(makeSlot('command_live', { deadlineAt: '2026-08-16T12:00:15.000Z' }))
    );
    await nodeFs.writeFile(
      path.join(commandDirectories(rootDir, expired).slots, '0.slot'),
      JSON.stringify(
        makeSlot('command_expired', {
          reservedAt: '2026-08-16T11:59:40.000Z',
          deadlineAt: '2026-08-16T11:59:59.999Z',
        })
      )
    );
    await nodeFs.writeFile(
      path.join(commandDirectories(rootDir, receiptBacked).slots, '0.slot'),
      JSON.stringify(makeSlot('command_receipt'))
    );
    await mailbox.writeReceipt(receiptBacked, makeReceipt(receiptBacked, 'command_receipt'));

    await expect(mailbox.releaseOrphanedSlotsPage(null, NOW, 64)).resolves.toMatchObject({ processed: 3 });

    expect(existsSync(path.join(commandDirectories(rootDir, live).slots, '0.slot'))).toBe(true);
    expect(existsSync(path.join(commandDirectories(rootDir, expired).slots, '0.slot'))).toBe(false);
    expect(existsSync(path.join(commandDirectories(rootDir, receiptBacked).slots, '0.slot'))).toBe(false);
  });

  it('never releases a slot while its exact pending record remains, even after the slot deadline', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_pending', {
      command: makeCommand(projectId, 'command_pending', {
        createdAt: '2026-08-16T11:59:40.000Z',
        deadlineAt: '2026-08-16T11:59:55.000Z',
      }),
      slot: makeSlot('command_pending', {
        reservedAt: '2026-08-16T11:59:40.000Z',
        deadlineAt: '2026-08-16T11:59:55.000Z',
      }),
    });

    await mailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(existsSync(path.join(commandDirectories(rootDir, projectId).slots, '0.slot'))).toBe(true);
  });

  it('releases an expired pending-free slot even when unrelated receipt bytes are malformed', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    await nodeFs.writeFile(
      path.join(directories.slots, '0.slot'),
      JSON.stringify(
        makeSlot('command_expired', {
          reservedAt: '2026-08-16T11:59:40.000Z',
          deadlineAt: '2026-08-16T11:59:55.000Z',
        })
      )
    );
    await nodeFs.writeFile(path.join(directories.receipts, 'command_expired.json'), '{malformed');

    await mailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(false);
  });

  it('advances orphan maintenance fairly past 64 early ineligible or failing projects and wraps', async () => {
    const projectIds = [projectId];
    for (let index = 1; index < 70; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      projectIds.push((await store.createProject(makeInput(`Project ${index}`))).id);
    }
    for (const id of projectIds) {
      // eslint-disable-next-line no-await-in-loop
      await mailbox.ensure(id);
    }
    await nodeFs.rm(commandDirectories(rootDir, projectIds[0]).receipts, { recursive: true });
    const finalId = projectIds.at(-1)!;
    await nodeFs.writeFile(
      path.join(commandDirectories(rootDir, finalId).slots, '0.slot'),
      JSON.stringify(
        makeSlot('command_final', {
          reservedAt: '2026-08-16T11:59:40.000Z',
          deadlineAt: '2026-08-16T11:59:59.999Z',
        })
      )
    );

    const first = await mailbox.releaseOrphanedSlotsPage(null, NOW, 64);
    expect(first).toMatchObject({ processed: 64 });
    expect(first.nextCursor).not.toBeNull();
    expect(existsSync(path.join(commandDirectories(rootDir, finalId).slots, '0.slot'))).toBe(true);

    const second = await mailbox.releaseOrphanedSlotsPage(first.nextCursor, NOW, 64);
    expect(second).toEqual({ processed: 6, nextCursor: null });
    expect(existsSync(path.join(commandDirectories(rootDir, finalId).slots, '0.slot'))).toBe(false);

    const wrapped = await mailbox.releaseOrphanedSlotsPage(null, NOW, 64);
    expect(wrapped.processed).toBe(64);
  });

  it('prunes only old receipts with no matching pending or slot cleanup residue across pages', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const ids = Array.from({ length: 70 }, (_, index) => `command_${String(index + 1).padStart(3, '0')}`);
    for (const commandId of ids) {
      // Arrange immutable terminal files directly so this test isolates maintenance authority.
      // eslint-disable-next-line no-await-in-loop
      await nodeFs.writeFile(
        path.join(directories.receipts, `${commandId}.json`),
        JSON.stringify(makeReceipt(projectId, commandId, { decidedAt: '2026-08-01T00:00:00.000Z' }))
      );
    }
    await nodeFs.writeFile(
      path.join(directories.receipts, `${ids[0]}.json`),
      JSON.stringify(makeReceipt(projectId, ids[0], { decidedAt: '2026-08-15T00:00:00.000Z' }))
    );
    await nodeFs.writeFile(path.join(directories.pending, `${ids[1]}.json`), '{}');
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlot(ids[2])));
    await nodeFs.rm(path.join(directories.receipts, `${ids[3]}.json`));
    await nodeFs.symlink(
      path.join(directories.receipts, `${ids[4]}.json`),
      path.join(directories.receipts, `${ids[3]}.json`)
    );

    const first = await mailbox.pruneReceiptsPage(null, '2026-08-09T00:00:00.000Z', 64);
    const second = await mailbox.pruneReceiptsPage(first.nextCursor, '2026-08-09T00:00:00.000Z', 64);

    expect(first.processed).toBe(64);
    expect(first.nextCursor).not.toBeNull();
    expect(second).toEqual({ processed: 6, nextCursor: null });
    expect(existsSync(path.join(directories.receipts, `${ids[0]}.json`))).toBe(true);
    expect(existsSync(path.join(directories.receipts, `${ids[1]}.json`))).toBe(true);
    expect(existsSync(path.join(directories.receipts, `${ids[2]}.json`))).toBe(true);
    expect((await nodeFs.lstat(path.join(directories.receipts, `${ids[3]}.json`))).isSymbolicLink()).toBe(true);
    expect(existsSync(path.join(directories.receipts, `${ids[69]}.json`))).toBe(false);

    const wrapped = await mailbox.pruneReceiptsPage(null, '2026-08-09T00:00:00.000Z', 64);
    expect(wrapped).toEqual({ processed: 4, nextCursor: null });
  });

  it('filters watcher noise and closes exactly once', async () => {
    let onChange: ((relativeFile: string) => void) | undefined;
    const close = vi.fn();
    const trigger = vi.fn();
    const watchingMailbox = createStudioDirectorCommandMailbox({
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
    onChange?.(`${projectId}/commands/pending/command_1.json.proof.tmp`);
    onChange?.(`${projectId}/proposals/pending/command_1.json`);
    onChange?.(`${projectId}/commands/pending/command_1.json`);
    onChange?.(`${projectId}/commands/pending`);
    await stop();
    await stop();

    expect(trigger).toHaveBeenCalledWith(projectId, 'command_1');
    expect(trigger).toHaveBeenCalledWith(projectId, undefined);
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('Studio Director command mailbox loaded-latency calibration', () => {
  it('measures loaded command mailbox latency', async () => {
    const rootDir = await nodeFs.mkdtemp(path.join(tmpdir(), 'studio-command-calibration-'));
    const samples: number[] = [];
    let failure: unknown;
    try {
      const ceilToMultiple = (value: number, multiple: number): number => Math.ceil(value / multiple) * multiple;
      const derivedAckGraceMs = ceilToMultiple(
        Math.max(2_000, RECORDED_CALIBRATION_MAX_MS * 2 + STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS),
        500
      );
      const derivedWaitMs = ceilToMultiple(Math.max(15_000, derivedAckGraceMs * 4), 1_000);
      expect({ ackGraceMs: STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS, waitMs: STUDIO_DIRECTOR_COMMAND_WAIT_MS }).toEqual({
        ackGraceMs: derivedAckGraceMs,
        waitMs: derivedWaitMs,
      });
      const store = createCreativeStudioStore({ rootDir, createId: () => 'project_calibration' });
      const project = await store.createProject(makeInput('Calibration'));
      const mailbox = createStudioDirectorCommandMailbox({ rootDir, store, waitMs: WAIT_MS });
      await mailbox.ensure(project.id);
      const canonicalRoot = await nodeFs.realpath(rootDir);
      const canonicalProjectDirectory = await store.getVerifiedProjectDirectory(project.id);
      if (canonicalProjectDirectory === null) throw new Error('Calibration project directory is unavailable');
      const directories = commandDirectories(canonicalRoot, project.id);
      expect(canonicalProjectDirectory).toBe(path.join(canonicalRoot, project.id));

      for (let sampleIndex = 0; sampleIndex < 35; sampleIndex += 1) {
        const load = Array.from({ length: 50 }, (_, index) =>
          index % 2 === 0
            ? store.getProject(project.id)
            : store.updateProject(project.id, (current) => ({ ...current, name: current.name }))
        );
        await Promise.resolve();
        const commandId = `calibration_${String(sampleIndex).padStart(2, '0')}`;
        const startedAt = performance.now();
        let elapsed: number;
        try {
          await publishImmutableRecord({
            fs: nodeFs,
            canonicalRoot,
            file: path.join(directories.pending, `${commandId}.json`),
            bytes: JSON.stringify(makeCommand(project.id, commandId)),
            temporaryId: `pending_${sampleIndex}`,
          });
          await mailbox.writeReceipt(project.id, makeReceipt(project.id, commandId));
          elapsed = performance.now() - startedAt;
        } finally {
          await Promise.all(load);
        }
        await mailbox.finish(project.id, commandId);
        if (sampleIndex >= 5) samples.push(elapsed);
      }

      const sorted = samples.toSorted((left, right) => left - right);
      const percentile = (fraction: number): number => sorted[Math.ceil(sorted.length * fraction) - 1];
      const result = {
        samples: sorted.map((sample) => Number(sample.toFixed(3))),
        p50: Number(percentile(0.5).toFixed(3)),
        p95: Number(percentile(0.95).toFixed(3)),
        max: Number(sorted.at(-1)!.toFixed(3)),
      };
      if (process.env.UPDATE_SNAPSHOTS === '1') console.info('STUDIO_COMMAND_CALIBRATION', JSON.stringify(result));
      expect(samples).toHaveLength(30);
      expect(result.max).toBeLessThanOrEqual(5_000);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (failure !== undefined && samples.length > 0) {
        const sorted = samples.toSorted((left, right) => left - right);
        console.info(
          'STUDIO_COMMAND_CALIBRATION_FAILURE',
          JSON.stringify({
            samples: sorted.map((sample) => Number(sample.toFixed(3))),
            p50: Number(sorted[Math.ceil(sorted.length * 0.5) - 1].toFixed(3)),
            p95: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
            max: Number(sorted.at(-1)!.toFixed(3)),
          })
        );
      }
      await nodeFs.rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 180_000);
});
