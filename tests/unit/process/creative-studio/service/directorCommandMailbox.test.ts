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
  CreateStudioProjectInputV2,
  StudioDirectorCommandReceiptV1,
  StudioDirectorCommandReceiptV2,
  StudioDirectorCommandRecordV1,
  StudioDirectorCommandRecordV2,
  StudioDirectorCommandSlotLeaseV2,
  StudioDirectorCommandSlotV1,
  StudioDirectorCommandSlotV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandMailbox,
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandMailbox,
  type StudioDirectorCommandMailboxV2,
} from '@process/services/creative-studio/service/directorCommandMailbox';
import { publishImmutableRecord } from '@process/services/creative-studio/service/recordIo';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';

const NOW = '2026-08-16T12:00:00.000Z';
const WAIT_MS = STUDIO_DIRECTOR_COMMAND_WAIT_MS;
const RECORDED_CALIBRATION_MAX_MS = 73.416;

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

const makeLease = (input: {
  leaseId: string;
  owner: 'writer' | 'main';
  slot?: StudioDirectorCommandSlotV1 | null;
  acquiredAt?: string;
}) => {
  const acquiredAt = input.acquiredAt ?? NOW;
  const slot = input.slot === undefined ? makeSlot('command_1') : input.slot;
  return {
    schemaVersion: 1,
    leaseId: input.leaseId,
    owner: input.owner,
    commandId: slot?.commandId ?? null,
    reservedAt: slot?.reservedAt ?? null,
    deadlineAt: slot?.deadlineAt ?? null,
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
  };
};

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

type TraversalOpen = {
  id: number;
  directory: string;
  bufferSize: number | undefined;
};

const observeTraversalFileSystem = (input: { failFirstReadIn?: string } = {}) => {
  const opens: TraversalOpen[] = [];
  const reads: number[] = [];
  const closes: number[] = [];
  const fullDirectoryReads: string[] = [];
  let nextId = 0;
  let failed = false;
  const fs = new Proxy(nodeFs, {
    get(realFs, property, receiver) {
      if (property === 'readdir') {
        return async (...args: Parameters<typeof nodeFs.readdir>) => {
          fullDirectoryReads.push(String(args[0]));
          return nodeFs.readdir(...args);
        };
      }
      if (property !== 'opendir') return Reflect.get(realFs, property, receiver);
      return async (...args: Parameters<typeof nodeFs.opendir>) => {
        const directory = String(args[0]);
        const directoryHandle = await nodeFs.opendir(...args);
        const id = ++nextId;
        const options = args[1] as { bufferSize?: number } | undefined;
        opens.push({ id, directory, bufferSize: options?.bufferSize });
        return new Proxy(directoryHandle, {
          get(realHandle, handleProperty) {
            if (handleProperty === 'read') {
              return async () => {
                reads.push(id);
                if (!failed && input.failFirstReadIn !== undefined && directory.endsWith(input.failFirstReadIn)) {
                  failed = true;
                  throw new Error('bounded traversal read failed');
                }
                return realHandle.read();
              };
            }
            if (handleProperty === 'close') {
              return async () => {
                closes.push(id);
                return realHandle.close();
              };
            }
            const value = Reflect.get(realHandle, handleProperty, realHandle) as unknown;
            return typeof value === 'function' ? value.bind(realHandle) : value;
          },
        });
      };
    },
  }) as typeof nodeFs;
  return { fs, opens, reads, closes, fullDirectoryReads };
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

  afterEach(async () => {
    await (mailbox as StudioDirectorCommandMailbox & { dispose?: () => Promise<void> }).dispose?.();
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

    await expect(mailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });
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

  it('fails cleanup closed when a valid slot belongs to another command', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    const directories = commandDirectories(rootDir, projectId);
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(makeSlot('command_other')));

    await expect(mailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(path.join(directories.slots, '0.slot'), 'utf8'))).toMatchObject({
      commandId: 'command_other',
    });
  });

  it('keeps receipt, pending, and slot untouched while another active lease exists', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    const directories = commandDirectories(rootDir, projectId);
    const lease = makeLease({ leaseId: 'lease_writer', owner: 'writer', slot: makeSlot('command_1') });
    await nodeFs.writeFile(path.join(directories.slots, '0.slot.lease'), JSON.stringify(lease));

    await expect(mailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(JSON.parse(await nodeFs.readFile(path.join(directories.slots, '0.slot.lease'), 'utf8'))).toEqual(lease);
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);
  });

  it('stops destructive finish work once its newly acquired lease expires', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    let currentTime = NOW;
    let leaseLinked = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'link') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.link>) => {
          await nodeFs.link(...args);
          if (String(args[1]) === leaseFile) {
            leaseLinked = true;
            currentTime = new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString();
          }
        };
      },
    }) as typeof nodeFs;
    const expiringMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs,
      now: () => currentTime,
      waitMs: WAIT_MS,
      createId: () => 'lease_expiring',
    } as never);

    await expect(expiringMailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(leaseLinked).toBe(true);
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);
    expect(existsSync(leaseFile)).toBe(true);
    await expiringMailbox.dispose();
  });

  it('retains pending residue when its lease expires after final slot validation', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    let currentTime = NOW;
    let leaseLinked = false;
    let slotLstatCount = 0;
    let expiredAfterValidation = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === leaseFile) leaseLinked = true;
          };
        }
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (leaseLinked && String(args[0]) === slotFile) {
              slotLstatCount += 1;
              if (slotLstatCount === 2) {
                expiredAfterValidation = true;
                currentTime = new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString();
              }
            }
            return stats;
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;
    const expiringMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs,
      now: () => currentTime,
      waitMs: WAIT_MS,
      createId: () => 'lease_pending_boundary',
    });

    await expect(expiringMailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(expiredAfterValidation).toBe(true);
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(existsSync(slotFile)).toBe(true);
    expect(existsSync(leaseFile)).toBe(true);
    await expiringMailbox.dispose();
  });

  it('retains a replacement lease and slot when finish expires after final slot identity lstat', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const replacementTime = new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString();
    const replacementSlot = makeSlot('command_replacement_boundary', {
      reservedAt: replacementTime,
      deadlineAt: new Date(Date.parse(replacementTime) + WAIT_MS).toISOString(),
    });
    const replacementLease = makeLease({
      leaseId: 'lease_replacement_boundary',
      owner: 'writer',
      slot: replacementSlot,
      acquiredAt: replacementTime,
    });
    let currentTime = NOW;
    let leaseLinked = false;
    let slotLstatCount = 0;
    let replaced = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === leaseFile) leaseLinked = true;
          };
        }
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (leaseLinked && !replaced && String(args[0]) === slotFile) {
              slotLstatCount += 1;
              if (slotLstatCount === 3) {
                replaced = true;
                currentTime = replacementTime;
                await nodeFs.rm(leaseFile);
                await nodeFs.writeFile(leaseFile, JSON.stringify(replacementLease));
                await nodeFs.rm(slotFile);
                await nodeFs.writeFile(slotFile, JSON.stringify(replacementSlot));
              }
            }
            return stats;
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs,
      now: () => currentTime,
      waitMs: WAIT_MS,
      createId: () => 'lease_finish_boundary',
    });

    await expect(racingMailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(replaced).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(leaseFile, 'utf8'))).toEqual(replacementLease);
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(replacementSlot);
    await racingMailbox.dispose();
  });

  it('retains a replacement lease and slot when finish expires after final lease identity lstat', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const replacementTime = new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString();
    const replacementSlot = makeSlot('command_replacement_lease_boundary', {
      reservedAt: replacementTime,
      deadlineAt: new Date(Date.parse(replacementTime) + WAIT_MS).toISOString(),
    });
    const replacementLease = makeLease({
      leaseId: 'lease_replacement_lease_boundary',
      owner: 'writer',
      slot: replacementSlot,
      acquiredAt: replacementTime,
    });
    let currentTime = NOW;
    let leaseLinked = false;
    let leaseLstatCount = 0;
    let replaced = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === leaseFile) leaseLinked = true;
          };
        }
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (leaseLinked && !replaced && String(args[0]) === leaseFile) {
              leaseLstatCount += 1;
              if (leaseLstatCount === 5) {
                replaced = true;
                currentTime = replacementTime;
                await nodeFs.rm(leaseFile);
                await nodeFs.writeFile(leaseFile, JSON.stringify(replacementLease));
                await nodeFs.writeFile(slotFile, JSON.stringify(replacementSlot));
              }
            }
            return stats;
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs,
      now: () => currentTime,
      waitMs: WAIT_MS,
      createId: () => 'lease_finish_release_boundary',
    });

    await expect(racingMailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(replaced).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(leaseFile, 'utf8'))).toEqual(replacementLease);
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(replacementSlot);
    await racingMailbox.dispose();
  });

  it('revalidates the full slot under its main lease before finish deletes anything', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const replacementSlot = makeSlot('command_replacement');
    let replaced = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === leaseFile && !replaced) {
              replaced = true;
              await nodeFs.rm(slotFile);
              await nodeFs.writeFile(slotFile, JSON.stringify(replacementSlot));
            }
          };
        }
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            if (String(args[0]).endsWith(`${path.sep}pending${path.sep}command_1.json`) && !replaced) {
              replaced = true;
              await nodeFs.rm(slotFile);
              await nodeFs.writeFile(slotFile, JSON.stringify(replacementSlot));
            }
            await nodeFs.rm(...args);
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs,
      now: () => NOW,
      waitMs: WAIT_MS,
      createId: () => 'lease_finish',
    } as never);

    await expect(racingMailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(replaced).toBe(true);
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(replacementSlot);
    expect(existsSync(leaseFile)).toBe(false);
    await racingMailbox.dispose();
  });

  it('reclaims an expired crash lease, then a fresh main lease completes receipt cleanup', async () => {
    let currentTime = NOW;
    await mailbox.dispose();
    mailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      now: () => currentTime,
      waitMs: WAIT_MS,
      createId: (() => {
        const ids = ['lease_recovery', 'lease_finish'];
        return () => ids.shift() ?? 'lease_fallback';
      })(),
    } as never);
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    const directories = commandDirectories(rootDir, projectId);
    const crashedLease = makeLease({ leaseId: 'lease_crashed', owner: 'main', slot: makeSlot('command_1') });
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    await nodeFs.writeFile(leaseFile, JSON.stringify(crashedLease));

    await mailbox.releaseOrphanedSlotsPage(null, currentTime, 64);
    expect(JSON.parse(await nodeFs.readFile(leaseFile, 'utf8'))).toEqual(crashedLease);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);

    currentTime = new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS + 1).toISOString();
    await mailbox.releaseOrphanedSlotsPage(null, currentTime, 64);
    expect(existsSync(leaseFile)).toBe(false);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);

    await mailbox.finish(projectId, 'command_1');
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(false);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(false);
    expect(existsSync(leaseFile)).toBe(false);
  });

  it('recovers an expired lease left after slot removal and permits the next maintenance acquisition', async () => {
    let currentTime = NOW;
    await mailbox.dispose();
    mailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      now: () => currentTime,
      waitMs: WAIT_MS,
      createId: () => 'lease_after_crash',
    } as never);
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    const crashedLease = makeLease({ leaseId: 'lease_slot_removed', owner: 'main', slot: makeSlot('command_1') });
    await nodeFs.writeFile(leaseFile, JSON.stringify(crashedLease));

    await mailbox.releaseOrphanedSlotsPage(null, currentTime, 64);
    expect(existsSync(leaseFile)).toBe(true);

    currentTime = new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS + 1).toISOString();
    await mailbox.releaseOrphanedSlotsPage(null, currentTime, 64);
    expect(existsSync(leaseFile)).toBe(false);
    expect(await nodeFs.readdir(directories.slots)).toEqual([]);
  });

  it('fails closed for a malformed lease instead of releasing an orphan slot', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    await nodeFs.writeFile(
      slotFile,
      JSON.stringify(
        makeSlot('command_expired', {
          reservedAt: '2026-08-16T11:59:40.000Z',
          deadlineAt: '2026-08-16T11:59:55.000Z',
        })
      )
    );
    await nodeFs.writeFile(leaseFile, '{"schemaVersion":1,"owner":"main"}');

    await mailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(existsSync(slotFile)).toBe(true);
    expect(await nodeFs.readFile(leaseFile, 'utf8')).toBe('{"schemaVersion":1,"owner":"main"}');
  });

  it('retains a replacement lease and its slot when expiry recovery loses inode identity', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const slot = makeSlot('command_expired', {
      reservedAt: '2026-08-16T11:59:40.000Z',
      deadlineAt: '2026-08-16T11:59:55.000Z',
    });
    const expiredLease = makeLease({
      leaseId: 'lease_expired',
      owner: 'main',
      slot,
      acquiredAt: '2026-08-16T11:59:57.999Z',
    });
    const replacementLease = makeLease({ leaseId: 'lease_replacement', owner: 'writer', slot });
    await nodeFs.writeFile(slotFile, JSON.stringify(slot));
    await nodeFs.writeFile(leaseFile, JSON.stringify(expiredLease));
    let replaced = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== leaseFile || replaced) return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty, handleReceiver) {
              if (handleProperty === 'close') {
                return async () => {
                  await handle.close();
                  replaced = true;
                  await nodeFs.rm(leaseFile);
                  await nodeFs.writeFile(leaseFile, JSON.stringify(replacementLease));
                };
              }
              return Reflect.get(realHandle, handleProperty, handleReceiver);
            },
          });
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailbox({ rootDir, store, fs, now: () => NOW, waitMs: WAIT_MS });

    await racingMailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(replaced).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(leaseFile, 'utf8'))).toEqual(replacementLease);
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(slot);
    await racingMailbox.dispose();
  });

  it('retains a replacement lease and slot when orphan cleanup expires after final slot identity lstat', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    await nodeFs.writeFile(
      slotFile,
      JSON.stringify(
        makeSlot('command_expired_boundary', {
          reservedAt: '2026-08-16T11:59:40.000Z',
          deadlineAt: '2026-08-16T11:59:55.000Z',
        })
      )
    );
    const replacementTime = new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString();
    const replacementSlot = makeSlot('command_orphan_replacement', {
      reservedAt: replacementTime,
      deadlineAt: new Date(Date.parse(replacementTime) + WAIT_MS).toISOString(),
    });
    const replacementLease = makeLease({
      leaseId: 'lease_orphan_replacement',
      owner: 'writer',
      slot: replacementSlot,
      acquiredAt: replacementTime,
    });
    let currentTime = NOW;
    let leaseLinked = false;
    let slotLstatCount = 0;
    let replaced = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === leaseFile) leaseLinked = true;
          };
        }
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (leaseLinked && !replaced && String(args[0]) === slotFile) {
              slotLstatCount += 1;
              if (slotLstatCount === 3) {
                replaced = true;
                currentTime = replacementTime;
                await nodeFs.rm(leaseFile);
                await nodeFs.writeFile(leaseFile, JSON.stringify(replacementLease));
                await nodeFs.rm(slotFile);
                await nodeFs.writeFile(slotFile, JSON.stringify(replacementSlot));
              }
            }
            return stats;
          };
        }
        return Reflect.get(realFs, property, receiver);
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs,
      now: () => currentTime,
      waitMs: WAIT_MS,
      createId: () => 'lease_orphan_cleanup_boundary',
    });

    await racingMailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(replaced).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(leaseFile, 'utf8'))).toEqual(replacementLease);
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(replacementSlot);
    await racingMailbox.dispose();
  });

  it('does not touch a slot when a writer wins the fresh-lease race after expired recovery', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const slot = makeSlot('command_expired', {
      reservedAt: '2026-08-16T11:59:40.000Z',
      deadlineAt: '2026-08-16T11:59:55.000Z',
    });
    const expiredLease = makeLease({
      leaseId: 'lease_expired',
      owner: 'main',
      slot,
      acquiredAt: '2026-08-16T11:59:57.999Z',
    });
    const writerLease = makeLease({ leaseId: 'lease_writer_won', owner: 'writer', slot });
    await nodeFs.writeFile(slotFile, JSON.stringify(slot));
    await nodeFs.writeFile(leaseFile, JSON.stringify(expiredLease));
    let writerWon = false;
    const fs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rm>) => {
          await nodeFs.rm(...args);
          if (String(args[0]) === leaseFile && !writerWon) {
            writerWon = true;
            await nodeFs.writeFile(leaseFile, JSON.stringify(writerLease));
          }
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailbox({ rootDir, store, fs, now: () => NOW, waitMs: WAIT_MS });

    await racingMailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(writerWon).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(leaseFile, 'utf8'))).toEqual(writerLease);
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(slot);
    await racingMailbox.dispose();
  });

  it('serializes finish with orphan maintenance so cleanup A cannot unlink newly reserved slot B', async () => {
    // Kills either mutation that bypasses the shared per-project slot-cleanup queue.
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_a');
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_a'));
    const directories = commandDirectories(await nodeFs.realpath(rootDir), projectId);
    const pendingA = path.join(directories.pending, 'command_a.json');
    const pendingB = path.join(directories.pending, 'command_b.json');
    const slotFile = path.join(directories.slots, '0.slot');
    let releasePendingRemoval!: () => void;
    const pendingRemovalReleased = new Promise<void>((resolve) => {
      releasePendingRemoval = resolve;
    });
    let signalPendingRemoved!: () => void;
    const pendingRemoved = new Promise<void>((resolve) => {
      signalPendingRemoved = resolve;
    });
    let signalReplacementReserved!: () => void;
    const replacementReserved = new Promise<void>((resolve) => {
      signalReplacementReserved = resolve;
    });
    let blockedPendingRemoval = false;
    let slotRemovalCount = 0;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'rm') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rm>) => {
          const target = String(args[0]);
          if (target === pendingA && !blockedPendingRemoval) {
            blockedPendingRemoval = true;
            await nodeFs.rm(...args);
            signalPendingRemoved();
            await pendingRemovalReleased;
            return;
          }
          await nodeFs.rm(...args);
          if (target !== slotFile) return;
          slotRemovalCount += 1;
          if (slotRemovalCount !== 1) return;
          await nodeFs.writeFile(slotFile, JSON.stringify(makeSlot('command_b')));
          await nodeFs.writeFile(pendingB, JSON.stringify(makeCommand(projectId, 'command_b')));
          signalReplacementReserved();
        };
      },
    }) as typeof nodeFs;
    const racingMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: racingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    const finishingA = racingMailbox.finish(projectId, 'command_a');
    await pendingRemoved;
    const maintainingA = racingMailbox.releaseOrphanedSlotsPage(null, NOW, 64);
    await Promise.race([replacementReserved, new Promise<void>((resolve) => setTimeout(resolve, 100))]);
    releasePendingRemoval();
    const [finishResult, maintenanceResult] = await Promise.allSettled([finishingA, maintainingA]);

    expect(finishResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'storage_error' }),
    });
    expect(maintenanceResult).toMatchObject({ status: 'fulfilled' });
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toEqual(makeSlot('command_b'));
    expect(JSON.parse(await nodeFs.readFile(pendingB, 'utf8'))).toEqual(makeCommand(projectId, 'command_b'));
    expect(slotRemovalCount).toBe(1);
    await racingMailbox.dispose();
  });

  it('removes attributable invalid slot residue only when its safe command identity matches', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    const directories = commandDirectories(rootDir, projectId);
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    await nodeFs.writeFile(
      path.join(directories.slots, '0.slot'),
      JSON.stringify({ commandId: 'command_1', deadlineAt: 'not-a-timestamp' })
    );

    await expect(mailbox.finish(projectId, 'command_1')).resolves.toBeUndefined();

    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(false);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(false);
  });

  it.each([
    ['no safe identity', { commandId: '../unsafe', deadlineAt: 'not-a-timestamp' }],
    ['a different safe identity', { commandId: 'command_other', deadlineAt: 'not-a-timestamp' }],
  ])('retains pending and invalid slot residue with %s', async (_label, invalidSlot) => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    const directories = commandDirectories(rootDir, projectId);
    await mailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(invalidSlot));

    await expect(mailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });

    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);
  });

  it('never finishes from a final receipt whose post-link publication sync did not commit', async () => {
    await mailbox.ensure(projectId);
    await writeBundle(rootDir, projectId, 'command_1');
    const directories = commandDirectories(rootDir, projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const ioDirectories = commandDirectories(canonicalRoot, projectId);
    const receiptFile = path.join(ioDirectories.receipts, 'command_1.json');
    let receiptLinked = false;
    let failedPostLinkSync = false;
    const failingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property === 'link') {
          return async (...args: Parameters<typeof nodeFs.link>) => {
            await nodeFs.link(...args);
            if (String(args[1]) === receiptFile) receiptLinked = true;
          };
        }
        if (property === 'rm') {
          return async (...args: Parameters<typeof nodeFs.rm>) => {
            if (receiptLinked && String(args[0]) === receiptFile) throw new Error('receipt rollback failed');
            return nodeFs.rm(...args);
          };
        }
        if (property !== 'open') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== ioDirectories.receipts || !receiptLinked || failedPostLinkSync) return handle;
          return new Proxy(handle, {
            get(realHandle, handleProperty, handleReceiver) {
              if (handleProperty === 'sync') {
                return async () => {
                  failedPostLinkSync = true;
                  throw new Error('post-link directory sync failed');
                };
              }
              return Reflect.get(realHandle, handleProperty, handleReceiver);
            },
          });
        };
      },
    }) as typeof nodeFs;
    const failingMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: failingFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    await expect(failingMailbox.writeReceipt(projectId, makeReceipt(projectId, 'command_1'))).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(failingMailbox.finish(projectId, 'command_1')).rejects.toMatchObject({ code: 'storage_error' });
    expect(existsSync(path.join(directories.pending, 'command_1.json'))).toBe(true);
    expect(existsSync(path.join(directories.slots, '0.slot'))).toBe(true);
  });

  it('reports a safe existing 0.slot command as busy authority without exposing unsafe slot bytes', async () => {
    await mailbox.ensure(projectId);
    const slotFile = path.join(commandDirectories(rootDir, projectId).slots, '0.slot');
    await nodeFs.writeFile(slotFile, JSON.stringify(makeSlot('command_existing')));

    await expect(mailbox.ensure(projectId)).resolves.toBeUndefined();
    await expect(mailbox.readPending(projectId, 'command_other')).resolves.toBeNull();
    expect(JSON.parse(await nodeFs.readFile(slotFile, 'utf8'))).toMatchObject({ commandId: 'command_existing' });
  });

  it('pages more than 64 pending references without duplicates or omission', async () => {
    await mailbox.ensure(projectId);
    const pending = commandDirectories(rootDir, projectId).pending;
    const expected = Array.from({ length: 131 }, (_, index) => `command_${String(index + 1).padStart(3, '0')}`);
    await Promise.all(
      expected.toReversed().map((commandId) => nodeFs.writeFile(path.join(pending, `${commandId}.json`), '{}'))
    );

    const observed: string[] = [];
    let cursor: string | null = null;
    do {
      // Cursor ownership is the behavior under test; native order is intentionally not lexical.
      // eslint-disable-next-line no-await-in-loop
      const page = await mailbox.listPendingPage(cursor, 64);
      observed.push(...page.items.map((item) => item.commandId));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(new Set(observed)).toEqual(new Set(expected));
    expect(new Set(observed).size).toBe(expected.length);
    const snapshot: string[] = [];
    cursor = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await mailbox.snapshotPendingPage(cursor, 64);
      snapshot.push(...page.items.map((item) => item.commandId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(new Set(snapshot)).toEqual(new Set(expected));
    expect(snapshot).toHaveLength(expected.length);
  });

  it('uses bounded opendir reads for one huge ledger without whole-directory materialization', async () => {
    await mailbox.ensure(projectId);
    const pending = commandDirectories(rootDir, projectId).pending;
    const expected = Array.from({ length: 257 }, (_, index) => `command_${String(index).padStart(3, '0')}`);
    await Promise.all(expected.map((commandId) => nodeFs.writeFile(path.join(pending, `${commandId}.json`), '{}')));
    const observed = observeTraversalFileSystem();
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observed.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    let cursor: string | null = null;
    let itemCount = 0;
    for (let pageIndex = 0; pageIndex < 16 && itemCount === 0; pageIndex += 1) {
      const priorReads = observed.reads.length;
      // eslint-disable-next-line no-await-in-loop
      const page = await pagedMailbox.listPendingPage(cursor, 1);
      expect(observed.reads.length - priorReads).toBeLessThanOrEqual(1);
      itemCount += page.items.length;
      cursor = page.nextCursor;
      if (cursor === null && itemCount === 0) throw new Error('Traversal ended before reaching the huge ledger');
    }

    expect(itemCount).toBe(1);
    expect(
      observed.fullDirectoryReads.filter((directory) => directory.endsWith(`${path.sep}commands${path.sep}pending`))
    ).toEqual([]);
    expect(
      observed.opens.some(
        (opened) => opened.directory.endsWith(`${path.sep}commands${path.sep}pending`) && opened.bufferSize === 1
      )
    ).toBe(true);
    await pagedMailbox.dispose();
  });

  it('bounds project discovery without store.listProjects or a whole-root readdir', async () => {
    await Promise.all(
      Array.from({ length: 129 }, (_, index) =>
        nodeFs.mkdir(path.join(rootDir, `discovery_${String(index).padStart(3, '0')}`))
      )
    );
    const observed = observeTraversalFileSystem();
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observed.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    await pagedMailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const listProjects = vi.spyOn(store, 'listProjects').mockRejectedValue(new Error('must not list every project'));

    const page = await pagedMailbox.releaseOrphanedSlotsPage(null, NOW, 1);

    expect(page.nextCursor).not.toBeNull();
    expect(observed.reads).toHaveLength(1);
    expect(listProjects).not.toHaveBeenCalled();
    expect(observed.fullDirectoryReads.filter((directory) => directory === canonicalRoot)).toEqual([]);
    expect(observed.opens).toContainEqual(expect.objectContaining({ directory: canonicalRoot, bufferSize: 1 }));
    await pagedMailbox.dispose();
  });

  it('keeps an unchanged live traversal complete and duplicate-free beyond 64 records', async () => {
    await mailbox.ensure(projectId);
    const pending = commandDirectories(rootDir, projectId).pending;
    const expected = Array.from({ length: 131 }, (_, index) => `command_${String(index).padStart(3, '0')}`);
    await Promise.all(expected.map((commandId) => nodeFs.writeFile(path.join(pending, `${commandId}.json`), '{}')));
    const observed = observeTraversalFileSystem();
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observed.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    const found: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const priorReads = observed.reads.length;
      // eslint-disable-next-line no-await-in-loop
      const page = await pagedMailbox.listPendingPage(cursor, 7);
      expect(observed.reads.length - priorReads).toBeLessThanOrEqual(7);
      found.push(...page.items.map((item) => item.commandId));
      cursor = page.nextCursor;
      pages += 1;
      if (pages > 200) throw new Error('Traversal did not reach EOF');
    } while (cursor !== null);

    expect(new Set(found)).toEqual(new Set(expected));
    expect(found).toHaveLength(expected.length);
    expect(
      observed.fullDirectoryReads.filter((directory) => directory.endsWith(`${path.sep}commands${path.sep}pending`))
    ).toEqual([]);
    for (const opened of observed.opens) {
      expect(observed.closes.filter((id) => id === opened.id)).toHaveLength(1);
    }
  });

  it('advances through junk and unsafe entries with bounded work', async () => {
    await mailbox.ensure(projectId);
    const pending = commandDirectories(rootDir, projectId).pending;
    await Promise.all(
      Array.from({ length: 130 }, (_, index) =>
        nodeFs.writeFile(path.join(pending, `junk_${String(index).padStart(3, '0')}.tmp`), 'noise')
      )
    );
    await nodeFs.writeFile(path.join(pending, 'command_target.json'), '{}');
    await nodeFs.writeFile(path.join(rootDir, 'unsafe-root-file'), 'noise');
    const observed = observeTraversalFileSystem();
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observed.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    const found: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const priorReads = observed.reads.length;
      // eslint-disable-next-line no-await-in-loop
      const page = await pagedMailbox.listPendingPage(cursor, 5);
      expect(observed.reads.length - priorReads).toBeLessThanOrEqual(5);
      found.push(...page.items.map((item) => item.commandId));
      cursor = page.nextCursor;
      pages += 1;
      if (pages > 100) throw new Error('Traversal did not advance past junk');
    } while (cursor !== null);

    expect(found).toContain('command_target');
    expect(
      observed.fullDirectoryReads.filter((directory) => directory.endsWith(`${path.sep}commands${path.sep}pending`))
    ).toEqual([]);
  });

  it('scopes opaque cursors by method, replacement, mailbox epoch, and disposal', async () => {
    await mailbox.ensure(projectId);
    await nodeFs.writeFile(path.join(commandDirectories(rootDir, projectId).pending, 'command_1.json'), '{}');
    const first = await mailbox.listPendingPage(null, 1);
    if (first.nextCursor === null) throw new Error('Expected a live list traversal');
    const token = first.nextCursor;

    await expect(mailbox.snapshotPendingPage(token, 1)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(mailbox.listPendingPage(`${token}forged`, 1)).rejects.toMatchObject({ code: 'invalid_payload' });
    await mailbox.listPendingPage(null, 1);
    await expect(mailbox.listPendingPage(token, 1)).rejects.toMatchObject({ code: 'invalid_payload' });

    const otherMailbox = createStudioDirectorCommandMailbox({ rootDir, store, now: () => NOW, waitMs: WAIT_MS });
    await expect(otherMailbox.listPendingPage(token, 1)).rejects.toMatchObject({ code: 'invalid_payload' });
    const otherPage = await otherMailbox.listPendingPage(null, 1);
    if (otherPage.nextCursor === null) throw new Error('Expected a live epoch traversal');
    await otherMailbox.dispose();
    await expect(otherMailbox.listPendingPage(otherPage.nextCursor, 1)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
  });

  it('observes a concurrent addition on the next fresh null-started sweep', async () => {
    await mailbox.ensure(projectId);
    const pending = commandDirectories(rootDir, projectId).pending;
    await nodeFs.writeFile(path.join(pending, 'command_initial.json'), '{}');
    const observed = observeTraversalFileSystem();
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observed.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    let cursor: string | null = null;
    let opened = false;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await pagedMailbox.listPendingPage(cursor, 1);
      opened ||= page.items.some((item) => item.commandId === 'command_initial');
      cursor = page.nextCursor;
    } while (!opened && cursor !== null);
    await nodeFs.writeFile(path.join(pending, 'command_concurrent.json'), '{}');
    while (cursor !== null) {
      // The open traversal may or may not observe a concurrent directory addition.
      // eslint-disable-next-line no-await-in-loop
      cursor = (await pagedMailbox.listPendingPage(cursor, 1)).nextCursor;
    }

    const fresh: string[] = [];
    cursor = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await pagedMailbox.listPendingPage(cursor, 1);
      fresh.push(...page.items.map((item) => item.commandId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(fresh).toContain('command_concurrent');
    expect(observed.opens.some((entry) => entry.bufferSize === 1)).toBe(true);
    expect(
      observed.fullDirectoryReads.filter((directory) => directory.endsWith(`${path.sep}commands${path.sep}pending`))
    ).toEqual([]);
    await pagedMailbox.dispose();
  });

  it('lazily ensures complete mailboxes while snapshotting project roots', async () => {
    const uninitializedProject = (await store.createProject(makeInput('Snapshot lazy ensure'))).id;
    let cursor: string | null = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      cursor = (await mailbox.snapshotPendingPage(cursor, 4)).nextCursor;
    } while (cursor !== null);

    await expect(nodeFs.readdir(commandDirectories(rootDir, uninitializedProject).root)).resolves.toEqual([
      'pending',
      'receipts',
      'slots',
    ]);
  });

  it('closes traversal handles exactly once on replacement, error, EOF, and dispose', async () => {
    await mailbox.ensure(projectId);
    await nodeFs.writeFile(path.join(commandDirectories(rootDir, projectId).pending, 'command_1.json'), '{}');
    const observed = observeTraversalFileSystem();
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observed.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    const first = await pagedMailbox.listPendingPage(null, 1);
    expect(first.nextCursor).not.toBeNull();
    await pagedMailbox.snapshotPendingPage(null, 1);
    await pagedMailbox.releaseOrphanedSlotsPage(null, NOW, 1);
    await pagedMailbox.pruneReceiptsPage(null, '2026-08-09T00:00:00.000Z', 1);
    await pagedMailbox.listPendingPage(null, 1);
    expect(observed.closes).toContain(observed.opens[0].id);
    await pagedMailbox.dispose();
    for (const opened of observed.opens) {
      expect(observed.closes.filter((id) => id === opened.id)).toHaveLength(1);
    }

    const failing = observeTraversalFileSystem({ failFirstReadIn: `${path.sep}commands${path.sep}pending` });
    const failingMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: failing.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    await expect(failingMailbox.listPendingPage(null, 64)).resolves.toEqual(
      expect.objectContaining({ items: expect.any(Array) })
    );
    const strictFailure = observeTraversalFileSystem({ failFirstReadIn: `${path.sep}commands${path.sep}pending` });
    const strictMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: strictFailure.fs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    await expect(strictMailbox.snapshotPendingPage(null, 64)).rejects.toMatchObject({ code: 'storage_error' });
    for (const opened of failing.opens) {
      expect(failing.closes.filter((id) => id === opened.id)).toHaveLength(1);
    }
    for (const opened of strictFailure.opens) {
      expect(strictFailure.closes.filter((id) => id === opened.id)).toHaveLength(1);
    }
    await strictMailbox.dispose();
  });

  it('advances a live cursor past a persistently failing early project and reaches later work', async () => {
    const laterProjectId = (await store.createProject(makeInput('Later live project'))).id;
    await mailbox.ensure(projectId);
    await mailbox.ensure(laterProjectId);
    await nodeFs.writeFile(path.join(commandDirectories(rootDir, laterProjectId).pending, 'command_later.json'), '{}');
    const failingDirectory = path.join(await nodeFs.realpath(rootDir), projectId, 'commands', 'pending');
    const persistentFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'opendir') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.opendir>) => {
          if (String(args[0]) === failingDirectory) throw new Error('persistent early project failure');
          return nodeFs.opendir(...args);
        };
      },
    }) as typeof nodeFs;
    const fairMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: persistentFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });
    const observed: string[] = [];
    let cursor: string | null = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await fairMailbox.listPendingPage(cursor, 1);
      observed.push(...page.items.map((item) => `${item.projectId}:${item.commandId}`));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(observed).toContain(`${laterProjectId}:command_later`);
    await fairMailbox.dispose();
  });

  it('bounds pending directory enumeration on first and later composite-cursor pages', async () => {
    const projectIds = [projectId];
    for (let index = 1; index < 8; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      projectIds.push((await store.createProject(makeInput(`Pending page ${index}`))).id);
    }
    for (const [index, id] of projectIds.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await mailbox.ensure(id);
      // eslint-disable-next-line no-await-in-loop
      await nodeFs.writeFile(
        path.join(commandDirectories(rootDir, id).pending, `command_${String(index).padStart(2, '0')}.json`),
        '{}'
      );
    }
    const enumeratedPending: string[] = [];
    const observedFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'readdir') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.readdir>) => {
          if (String(args[0]).endsWith(`${path.sep}commands${path.sep}pending`)) {
            enumeratedPending.push(String(args[0]));
          }
          return nodeFs.readdir(...args);
        };
      },
    }) as typeof nodeFs;
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observedFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    const nextItem = async (initialCursor: string | null) => {
      let cursor = initialCursor;
      for (let pageIndex = 0; pageIndex < 32; pageIndex += 1) {
        const priorEnumerations = enumeratedPending.length;
        // eslint-disable-next-line no-await-in-loop
        const page = await pagedMailbox.listPendingPage(cursor, 1);
        expect(enumeratedPending.length - priorEnumerations).toBe(0);
        if (page.items.length > 0) return { item: page.items[0], cursor: page.nextCursor };
        if (page.nextCursor === null) throw new Error('Pending traversal ended before returning an item');
        cursor = page.nextCursor;
      }
      throw new Error('Pending traversal did not make bounded progress');
    };
    const first = await nextItem(null);
    if (first.cursor === null) throw new Error('Expected a later pending page');
    const second = await nextItem(first.cursor);

    expect(second.item).not.toEqual(first.item);
    expect(enumeratedPending).toEqual([]);
    await pagedMailbox.dispose();
  });

  it('rejects a forged legacy cursor even when its decoded comparison data was legal', async () => {
    await mailbox.ensure(projectId);
    await nodeFs.writeFile(path.join(commandDirectories(rootDir, projectId).pending, 'z_command.json'), '{}');
    const cursor = `v1.${Buffer.from(JSON.stringify([projectId, 'early\\residue.tmp']), 'utf8').toString('base64url')}`;

    await expect(mailbox.listPendingPage(cursor, 64)).rejects.toMatchObject({ code: 'invalid_payload' });
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

  it.each([
    ['a reservation lasting years', makeSlot('command_invalid', { deadlineAt: '2030-08-16T12:00:00.000Z' })],
    [
      'a reservation beyond future clock skew',
      makeSlot('command_invalid', {
        reservedAt: '2026-08-16T12:00:02.001Z',
        deadlineAt: '2026-08-16T12:00:12.001Z',
      }),
    ],
  ])('does not leave %s live and busy without pending authority', async (_label, slot) => {
    await mailbox.ensure(projectId);
    const slotFile = path.join(commandDirectories(rootDir, projectId).slots, '0.slot');
    await nodeFs.writeFile(slotFile, JSON.stringify(slot));

    await mailbox.releaseOrphanedSlotsPage(null, NOW, 64);

    expect(existsSync(slotFile)).toBe(false);
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
    expect(first.nextCursor).not.toBeNull();
    let processed = first.processed;
    let cursor = first.nextCursor;
    while (cursor !== null) {
      // eslint-disable-next-line no-await-in-loop
      const page = await mailbox.releaseOrphanedSlotsPage(cursor, NOW, 64);
      processed += page.processed;
      cursor = page.nextCursor;
    }
    expect(processed).toBe(projectIds.length);
    expect(existsSync(path.join(commandDirectories(rootDir, finalId).slots, '0.slot'))).toBe(false);

    const wrapped = await mailbox.releaseOrphanedSlotsPage(null, NOW, 64);
    expect(wrapped.processed).toBeGreaterThan(0);
    expect(wrapped.nextCursor).not.toBeNull();
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

    let cursor: string | null = null;
    let processed = 0;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await mailbox.pruneReceiptsPage(cursor, '2026-08-09T00:00:00.000Z', 64);
      processed += page.processed;
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(processed).toBe(ids.length);
    expect(existsSync(path.join(directories.receipts, `${ids[0]}.json`))).toBe(true);
    expect(existsSync(path.join(directories.receipts, `${ids[1]}.json`))).toBe(true);
    expect(existsSync(path.join(directories.receipts, `${ids[2]}.json`))).toBe(true);
    expect((await nodeFs.lstat(path.join(directories.receipts, `${ids[3]}.json`))).isSymbolicLink()).toBe(true);
    expect(existsSync(path.join(directories.receipts, `${ids[69]}.json`))).toBe(false);

    const wrapped = await mailbox.pruneReceiptsPage(null, '2026-08-09T00:00:00.000Z', 64);
    expect(wrapped).toEqual({ processed: 4, nextCursor: null });
  });

  it('bounds receipt directory enumeration on first and later composite-cursor pages', async () => {
    const projectIds = [projectId];
    for (let index = 1; index < 8; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      projectIds.push((await store.createProject(makeInput(`Receipt page ${index}`))).id);
    }
    for (const [index, id] of projectIds.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await mailbox.ensure(id);
      // eslint-disable-next-line no-await-in-loop
      await nodeFs.writeFile(
        path.join(commandDirectories(rootDir, id).receipts, `command_${String(index).padStart(2, '0')}.json`),
        JSON.stringify(
          makeReceipt(id, `command_${String(index).padStart(2, '0')}`, { decidedAt: '2026-08-01T00:00:00.000Z' })
        )
      );
    }
    const enumeratedReceipts: string[] = [];
    const observedFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'readdir') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.readdir>) => {
          if (String(args[0]).endsWith(`${path.sep}commands${path.sep}receipts`)) {
            enumeratedReceipts.push(String(args[0]));
          }
          return nodeFs.readdir(...args);
        };
      },
    }) as typeof nodeFs;
    const pagedMailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      fs: observedFs,
      now: () => NOW,
      waitMs: WAIT_MS,
    });

    const nextProcessed = async (initialCursor: string | null) => {
      let cursor = initialCursor;
      for (let pageIndex = 0; pageIndex < 32; pageIndex += 1) {
        const priorEnumerations = enumeratedReceipts.length;
        // eslint-disable-next-line no-await-in-loop
        const page = await pagedMailbox.pruneReceiptsPage(cursor, '2026-08-09T00:00:00.000Z', 1);
        expect(enumeratedReceipts.length - priorEnumerations).toBe(0);
        if (page.processed > 0) return page;
        if (page.nextCursor === null) throw new Error('Receipt traversal ended before processing an item');
        cursor = page.nextCursor;
      }
      throw new Error('Receipt traversal did not make bounded progress');
    };
    const first = await nextProcessed(null);
    if (first.nextCursor === null) throw new Error('Expected a later receipt page');
    const second = await nextProcessed(first.nextCursor);

    expect(first.processed).toBe(1);
    expect(second.processed).toBe(1);
    expect(enumeratedReceipts).toEqual([]);
    await pagedMailbox.dispose();
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
  schemaVersion: 2,
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
  schemaVersion: 2,
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
    schemaVersion: 2,
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
    schemaVersion: 2,
    commandId,
    projectId,
    expectedRevision: 1,
    decidedAt: NOW,
    status: 'applied',
    appliedRevision: 2,
    createdSectionIds: [],
    createdClipIds: [],
    ...overrides,
  }) as StudioDirectorCommandReceiptV2;

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
    const ids = ['legacy_v1', 'project_v2'];
    let idIndex = 0;
    store = createCreativeStudioStore({
      rootDir,
      now: () => NOW,
      createId: () => ids[idIndex++]!,
    });
    legacyProjectId = (await store.createProject(makeInput('Legacy V1'))).id;
    projectId = (await store.createProjectV2(makeInputV2('Primary V2'))).id;
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
      createdSectionIds: ['section_1'],
      createdClipIds: ['clip_1'],
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
              schemaVersion: 2,
              commandId: command.commandId,
              projectId,
              expectedRevision: 2,
              decidedAt: NOW,
              status,
              appliedRevision: 3,
              createdSectionIds: [],
              createdClipIds: [],
            }
          : {
              schemaVersion: 2,
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
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: projectId });
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

  it('refuses to link a V2 receipt after the project manifest becomes V1 during temp sync', async () => {
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

  it('exact-cleans its linked V2 main lease when the project manifest becomes V1 after link', async () => {
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

  it('reports V1 sidecars as unsupported and leaves their complete byte tree untouched', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const command = makeCommand(projectId, 'command_v1');
    const slot = makeSlot('command_v1');
    const receipt = makeReceipt(projectId, 'command_v1');
    await nodeFs.writeFile(path.join(directories.pending, 'command_v1.json'), JSON.stringify(command));
    await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    await nodeFs.writeFile(path.join(directories.receipts, 'command_v1.json'), JSON.stringify(receipt));
    await nodeFs.writeFile(
      path.join(directories.slots, '0.slot.lease'),
      JSON.stringify(makeLease({ leaseId: 'lease_v1', owner: 'writer', slot }))
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

  it('refuses receipt-first cleanup when the same-ID pending authority is V1', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    await nodeFs.writeFile(
      path.join(directories.pending, 'command_mixed.json'),
      JSON.stringify(makeCommand(projectId, 'command_mixed'))
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

  it('classifies a V1 pending before reclaiming its expired V2 lease', async () => {
    await mailbox.ensure(projectId);
    const directories = commandDirectories(rootDir, projectId);
    const slot = makeSlotV2('command_mixed');
    await nodeFs.writeFile(
      path.join(directories.pending, 'command_mixed.json'),
      JSON.stringify(makeCommand(projectId, 'command_mixed'))
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

  it('restores a same-inode V1 pending replacement raced into V2 finish cleanup', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const pendingFile = path.join(directories.pending, 'command_pending_race.json');
    const slotFile = path.join(directories.slots, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const legacyBytes = JSON.stringify(makeCommand(projectId, 'command_pending_race'));
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

  it('restores exact V2 cleanup records when the project manifest becomes V1 during quarantine', async () => {
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

  it('restores a V1 receipt replacement raced into V2 retention cleanup', async () => {
    await mailbox.ensure(projectId);
    const canonicalRoot = await nodeFs.realpath(rootDir);
    const directories = commandDirectories(canonicalRoot, projectId);
    const commandId = 'command_receipt_prune_race';
    const receiptFile = path.join(directories.receipts, `${commandId}.json`);
    const legacyBytes = JSON.stringify(makeReceipt(projectId, commandId));
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

  it('skips V1 projects during bounded sweeps without creating a mailbox', async () => {
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

  it('returns explicit unsupported reads for a V1 project without touching its directory', async () => {
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
