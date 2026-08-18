/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { existsSync, promises as nodeFs } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorCommandSlotV1,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandWriter,
  createStudioDirectorCommandWriterV2,
  type StudioApplyEditsInput,
  type StudioApplyEditsInputV2,
  type StudioDirectorCommandWriterDeps,
} from '@process/resources/builtinMcp/studioDirectorCommandWriter';
import { writePendingRecordV2 } from '@process/resources/builtinMcp/studioPendingRecordWriter';
import { createEmptyStudioProjectV2 } from '@process/services/creative-studio/service/schema2';

const PROJECT_ID = 'project_1';
const START_MS = Date.parse('2026-08-17T01:02:03.000Z');

const setBriefInput = (brief = 'A more focused launch story'): StudioApplyEditsInput => ({
  expectedRevision: 7,
  operations: [{ kind: 'set_brief', brief }],
});

const addScene = (title: string) => ({
  kind: 'add_scene' as const,
  scene: {
    title,
    purpose: 'Advance the story',
    visualPrompt: 'A wide cinematic frame',
    narration: 'The next chapter begins.',
    onScreenText: '',
    mediaKind: 'image' as const,
    durationSeconds: 5,
  },
  beforeSceneId: null,
});

const shotInputV2 = (line: string) => ({
  line,
  narration: '',
  onScreenText: '',
  mediaKind: 'image' as const,
  durationSeconds: 5,
  referenceAssetId: null,
});

const bindMethods = <T extends object>(target: T, overrides: Partial<Record<keyof T, unknown>> = {}): T =>
  new Proxy(target, {
    get(current, property, receiver) {
      if (Object.hasOwn(overrides, property)) return overrides[property as keyof T];
      const value = Reflect.get(current, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });

describe('Studio Director subprocess command writer', () => {
  let projectDir = '';
  let pendingDir = '';
  let slotsDir = '';
  let receiptsDir = '';

  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), 'studio-command-writer-'));
    pendingDir = path.join(projectDir, 'commands', 'pending');
    slotsDir = path.join(projectDir, 'commands', 'slots');
    receiptsDir = path.join(projectDir, 'commands', 'receipts');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(slotsDir);
    await mkdir(receiptsDir);
    await writeFile(
      path.join(projectDir, 'project.json'),
      JSON.stringify(
        createEmptyStudioProjectV2(
          {
            name: 'Writer fixture',
            brief: '',
            aspectRatio: '16:9',
            targetDurationSeconds: 30,
            resolution: '1080p',
          },
          PROJECT_ID,
          new Date(START_MS).toISOString()
        )
      )
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  const writerWithIds = (
    ids: string[],
    overrides: Partial<StudioDirectorCommandWriterDeps> = {}
  ): ReturnType<typeof createStudioDirectorCommandWriter> => {
    let currentMs = START_MS;
    const nextIds = [...ids];
    let fallbackId = 0;
    return createStudioDirectorCommandWriter(
      { projectId: PROJECT_ID, projectDir },
      {
        now: () => currentMs,
        createId: () => nextIds.shift() ?? `lease_fallback_${++fallbackId}`,
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
        ...overrides,
      }
    );
  };

  const writerWithIdsV2 = (
    ids: string[],
    overrides: Partial<StudioDirectorCommandWriterDeps> = {}
  ): ReturnType<typeof createStudioDirectorCommandWriterV2> => {
    let currentMs = START_MS;
    const nextIds = [...ids];
    let fallbackId = 0;
    return createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        now: () => currentMs,
        createId: () => nextIds.shift() ?? `lease_v2_fallback_${++fallbackId}`,
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
        ...overrides,
      }
    );
  };

  type InvalidPendingKindV2 = 'malformed_recovered_revision' | 'malformed_null_revision' | 'future_schema';

  const invalidPendingCasesV2 = [
    {
      label: 'malformed record with a recovered revision',
      kind: 'malformed_recovered_revision',
      expectedRevision: 7,
      reasonCode: 'malformed_record',
    },
    {
      label: 'malformed record without a recoverable revision',
      kind: 'malformed_null_revision',
      expectedRevision: null,
      reasonCode: 'malformed_record',
    },
    {
      label: 'future-schema record',
      kind: 'future_schema',
      expectedRevision: 7,
      reasonCode: 'unsupported_version',
    },
  ] as const satisfies ReadonlyArray<{
    label: string;
    kind: InvalidPendingKindV2;
    expectedRevision: number | null;
    reasonCode: 'malformed_record' | 'unsupported_version';
  }>;

  const invalidPendingRecordV2 = (commandId: string, kind: InvalidPendingKindV2): Record<string, unknown> => {
    const base = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId,
      projectId: PROJECT_ID,
      expectedRevision: 7,
      createdAt: new Date(START_MS).toISOString(),
      deadlineAt: new Date(START_MS + STUDIO_DIRECTOR_COMMAND_WAIT_MS).toISOString(),
      policy: 'auto_apply',
      operations: [{ kind: 'set_brief', brief: 'Invalid durable command' }],
    };
    if (kind === 'malformed_recovered_revision') return { ...base, policy: 'manual_review' };
    if (kind === 'malformed_null_revision') return { ...base, expectedRevision: 'invalid' };
    return { ...base, schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION + 1 };
  };

  const validPendingRecordV2 = (commandId: string): Record<string, unknown> => ({
    ...invalidPendingRecordV2(commandId, 'malformed_recovered_revision'),
    policy: 'auto_apply',
  });

  const writeInvalidTerminalAuthorityV2 = async (input: {
    commandId: string;
    kind: InvalidPendingKindV2;
    receiptExpectedRevision: number | null;
    receiptReasonCode: 'malformed_record' | 'unsupported_version';
    slotCommandId?: string;
    slotDeadlineAt?: string;
    leaseCommandId?: string;
  }): Promise<StudioDirectorCommandReceiptV2> => {
    const reservedAt = new Date(START_MS).toISOString();
    const deadlineAt = new Date(START_MS + STUDIO_DIRECTOR_COMMAND_WAIT_MS).toISOString();
    const slot: StudioDirectorCommandSlotV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: input.slotCommandId ?? input.commandId,
      reservedAt,
      deadlineAt: input.slotDeadlineAt ?? deadlineAt,
    };
    const receipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: input.commandId,
      projectId: PROJECT_ID,
      expectedRevision: input.receiptExpectedRevision,
      decidedAt: '2026-08-17T01:02:10.000Z',
      status: 'rejected',
      observedRevision: null,
      reasonCode: input.receiptReasonCode,
    };
    await writeFile(
      path.join(pendingDir, `${input.commandId}.json`),
      JSON.stringify(invalidPendingRecordV2(input.commandId, input.kind))
    );
    await writeFile(path.join(slotsDir, '0.slot'), JSON.stringify(slot));
    await writeFile(path.join(receiptsDir, `${input.commandId}.json`), JSON.stringify(receipt));
    if (input.leaseCommandId !== undefined) {
      const lease: StudioDirectorCommandSlotLeaseV2 = {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        leaseId: `main_lease_${input.commandId}`,
        owner: 'main',
        commandId: input.leaseCommandId,
        reservedAt,
        deadlineAt,
        acquiredAt: reservedAt,
        expiresAt: new Date(START_MS + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
      };
      await writeFile(path.join(slotsDir, '0.slot.lease'), JSON.stringify(lease));
    }
    return receipt;
  };

  const snapshotCommandMailboxBytes = async (): Promise<Record<string, string>> => {
    const families = [
      ['pending', pendingDir],
      ['slots', slotsDir],
      ['receipts', receiptsDir],
    ] as const;
    const entries = await Promise.all(
      families.map(async ([family, directory]) => {
        const names = (await readdir(directory)).toSorted();
        return Promise.all(
          names.map(async (name) => [`${family}/${name}`, await readFile(path.join(directory, name), 'utf8')] as const)
        );
      })
    );
    return Object.fromEntries(entries.flat());
  };

  it('mints stable safe ids once, preserves operation order, and publishes one exact 15-second command', async () => {
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('command_1')
      .mockReturnValueOnce('scene_new_a')
      .mockReturnValueOnce('scene_new_b')
      .mockReturnValueOnce('lease_1');
    let currentMs = START_MS;
    const writer = createStudioDirectorCommandWriter(
      { projectId: PROJECT_ID, projectDir },
      {
        now: () => currentMs,
        createId,
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
      }
    );

    await expect(
      writer.apply({
        expectedRevision: 7,
        operations: [
          addScene('Opening'),
          { kind: 'edit_scene', sceneId: 'scene_existing', changes: { title: 'Middle' } },
          addScene('Closing'),
        ],
      })
    ).resolves.toEqual({ status: 'unconfirmed', commandId: 'command_1' });

    const command = JSON.parse(
      await readFile(path.join(pendingDir, 'command_1.json'), 'utf8')
    ) as StudioDirectorCommandRecordV1;
    const slot = JSON.parse(await readFile(path.join(slotsDir, '0.slot'), 'utf8')) as StudioDirectorCommandSlotV1;
    expect(command).toEqual({
      schemaVersion: 1,
      commandId: 'command_1',
      projectId: PROJECT_ID,
      expectedRevision: 7,
      createdAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
      policy: 'auto_apply',
      operations: [
        { ...addScene('Opening'), sceneId: 'scene_new_a' },
        { kind: 'edit_scene', sceneId: 'scene_existing', changes: { title: 'Middle' } },
        { ...addScene('Closing'), sceneId: 'scene_new_b' },
      ],
    });
    expect(Date.parse(command.deadlineAt) - Date.parse(command.createdAt)).toBe(STUDIO_DIRECTOR_COMMAND_WAIT_MS);
    expect(slot).toEqual({
      schemaVersion: 1,
      commandId: 'command_1',
      reservedAt: command.createdAt,
      deadlineAt: command.deadlineAt,
    });
    expect(createId).toHaveBeenCalledTimes(4);
    expect(await readdir(slotsDir)).toEqual(['0.slot']);
  });

  it('fsyncs immutable slot and pending publications without creating mailbox directories', async () => {
    const canonicalProjectDir = await nodeFs.realpath(projectDir);
    const canonicalSlotsDir = path.join(canonicalProjectDir, 'commands', 'slots');
    const canonicalPendingDir = path.join(canonicalProjectDir, 'commands', 'pending');
    const syncedPaths: string[] = [];
    const linkedDestinations: string[] = [];
    const open = async (...args: Parameters<typeof nodeFs.open>) => {
      const file = String(args[0]);
      const handle = await nodeFs.open(...args);
      return bindMethods(handle, {
        sync: async () => {
          syncedPaths.push(file);
          await handle.sync();
        },
      });
    };
    const fs = bindMethods(nodeFs, {
      mkdir: vi.fn(async () => {
        throw new Error('the subprocess must not create mailbox directories');
      }),
      open,
      link: async (source: Parameters<typeof nodeFs.link>[0], destination: Parameters<typeof nodeFs.link>[1]) => {
        linkedDestinations.push(String(destination));
        await nodeFs.link(source, destination);
      },
    });
    const writer = writerWithIds(['command_durable'], { fs });

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'unconfirmed',
      commandId: 'command_durable',
    });

    expect(linkedDestinations).toEqual([
      path.join(canonicalSlotsDir, '0.slot.lease'),
      path.join(canonicalSlotsDir, '0.slot'),
      path.join(canonicalPendingDir, 'command_durable.json'),
    ]);
    expect(syncedPaths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('0.slot'),
        expect.stringContaining('command_durable.json'),
        canonicalSlotsDir,
        canonicalPendingDir,
      ])
    );
    expect((await readdir(slotsDir)).filter((name) => name.endsWith('.tmp') || name.endsWith('.unconfirmed'))).toEqual(
      []
    );
    expect(
      (await readdir(pendingDir)).filter((name) => name.endsWith('.tmp') || name.endsWith('.unconfirmed'))
    ).toEqual([]);
  });

  it('returns busy with the existing safe command id and never reserves another slot', async () => {
    const first = writerWithIds(['command_first']);
    await first.apply(setBriefInput());
    const second = writerWithIds(['command_second']);

    await expect(second.apply(setBriefInput('Second edit'))).resolves.toEqual({
      status: 'busy',
      commandId: 'command_first',
    });

    expect(await readdir(slotsDir)).toEqual(['0.slot']);
    expect(await readdir(pendingDir)).toEqual(['command_first.json']);
  });

  it('never reclaims an expired lease from the subprocess writer', async () => {
    const leaseFile = path.join(slotsDir, '0.slot.lease');
    const expiredLease = {
      schemaVersion: 1,
      leaseId: 'lease_expired',
      owner: 'writer',
      commandId: 'command_crashed',
      reservedAt: new Date(START_MS - 17_000).toISOString(),
      deadlineAt: new Date(START_MS - 2_000).toISOString(),
      acquiredAt: new Date(START_MS - STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
      expiresAt: new Date(START_MS).toISOString(),
    };
    await writeFile(leaseFile, JSON.stringify(expiredLease));
    const writer = writerWithIds(['command_after_crash', 'lease_after_crash']);

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_after_crash',
    });

    expect(await readFile(leaseFile, 'utf8')).toBe(JSON.stringify(expiredLease));
    expect(await readdir(slotsDir)).toEqual(['0.slot.lease']);
  });

  it('leaves a complete lease for main recovery when reservation crashes after lease fsync', async () => {
    const canonicalSlotsDir = await nodeFs.realpath(slotsDir);
    const leaseFile = path.join(canonicalSlotsDir, '0.slot.lease');
    const slotFile = path.join(canonicalSlotsDir, '0.slot');
    const fs = bindMethods(nodeFs, {
      link: async (source: Parameters<typeof nodeFs.link>[0], destination: Parameters<typeof nodeFs.link>[1]) => {
        if (String(destination) === slotFile) throw new Error('simulated crash after lease durability');
        await nodeFs.link(source, destination);
      },
      rm: async (file: Parameters<typeof nodeFs.rm>[0], ...args: unknown[]) => {
        if (String(file) === leaseFile) throw new Error('process crashed before lease release');
        await Reflect.apply(nodeFs.rm, nodeFs, [file, ...args]);
      },
    });
    const writer = writerWithIds(['command_crash', 'lease_crash'], { fs });

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_crash',
    });

    expect(JSON.parse(await readFile(leaseFile, 'utf8'))).toEqual({
      schemaVersion: 1,
      leaseId: 'lease_crash',
      owner: 'writer',
      commandId: 'command_crash',
      reservedAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
      acquiredAt: '2026-08-17T01:02:03.000Z',
      expiresAt: new Date(START_MS + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
    });
    expect(await readdir(slotsDir)).not.toContain('0.slot.lease.unconfirmed');
    expect(await readdir(slotsDir)).not.toContain('0.slot');
  });

  it('retains its reservation lease and slot when expiry arrives after final lease identity lstat', async () => {
    const canonicalSlotsDir = await nodeFs.realpath(slotsDir);
    const leaseFile = path.join(canonicalSlotsDir, '0.slot.lease');
    const slotFile = path.join(canonicalSlotsDir, '0.slot');
    let currentMs = START_MS;
    let leaseLinked = false;
    let leaseLstatCount = 0;
    let expiredAtBoundary = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: Parameters<typeof nodeFs.link>[0], destination: Parameters<typeof nodeFs.link>[1]) => {
        await nodeFs.link(source, destination);
        if (String(destination) === leaseFile) leaseLinked = true;
      },
      lstat: async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
        const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
        if (leaseLinked && String(file) === leaseFile) {
          leaseLstatCount += 1;
          if (leaseLstatCount === 5) {
            expiredAtBoundary = true;
            currentMs = START_MS + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS;
          }
        }
        return stats;
      },
    });
    const writer = createStudioDirectorCommandWriter(
      { projectId: PROJECT_ID, projectDir },
      {
        fs,
        now: () => currentMs,
        createId: (() => {
          const ids = ['command_boundary', 'lease_boundary'];
          return () => ids.shift() ?? 'lease_fallback';
        })(),
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
      }
    );

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_boundary',
    });

    expect(expiredAtBoundary).toBe(true);
    expect(existsSync(leaseFile)).toBe(true);
    expect(existsSync(slotFile)).toBe(true);
    expect(existsSync(path.join(pendingDir, 'command_boundary.json'))).toBe(false);
  });

  it('cleans its own slot after an immutable pending collision without replacing the existing command', async () => {
    const existing = '{"existing":true}';
    await writeFile(path.join(pendingDir, 'command_collision.json'), existing);
    const writer = writerWithIds(['command_collision']);

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_collision',
    });

    expect(await readFile(path.join(pendingDir, 'command_collision.json'), 'utf8')).toBe(existing);
    expect(await readdir(slotsDir)).toEqual([]);
  });

  it('never unlinks a mismatched newer slot while cleaning a failed publication', async () => {
    await writeFile(path.join(pendingDir, 'command_collision.json'), '{"existing":true}');
    const newerSlot: StudioDirectorCommandSlotV1 = {
      schemaVersion: 1,
      commandId: 'command_newer',
      reservedAt: '2026-08-17T01:02:04.000Z',
      deadlineAt: '2026-08-17T01:02:19.000Z',
    };
    let replaced = false;
    const lstat = async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
      const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
      if (
        !replaced &&
        String(file).endsWith(`${path.sep}commands${path.sep}pending${path.sep}command_collision.json`)
      ) {
        replaced = true;
        await rm(path.join(slotsDir, '0.slot'));
        await writeFile(path.join(slotsDir, '0.slot'), JSON.stringify(newerSlot));
      }
      return stats;
    };
    const fs = bindMethods(nodeFs, { lstat });
    const writer = writerWithIds(['command_collision'], { fs });

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_collision',
    });

    await expect(readFile(path.join(slotsDir, '0.slot'), 'utf8')).resolves.toBe(JSON.stringify(newerSlot));
  });

  it('preserves a valid replacement installed after cleanup validates its original slot', async () => {
    await writeFile(path.join(pendingDir, 'command_collision.json'), '{"existing":true}');
    const canonicalSlotsDir = await nodeFs.realpath(slotsDir);
    const slotFile = path.join(canonicalSlotsDir, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    const newerSlot: StudioDirectorCommandSlotV1 = {
      schemaVersion: 1,
      commandId: 'command_newer_after_validation',
      reservedAt: '2026-08-17T01:02:04.000Z',
      deadlineAt: '2026-08-17T01:02:19.000Z',
    };
    let originalSlotReadComplete = false;
    let leaseLinkCount = 0;
    let replaced = false;
    const replaceWithNewerSlot = async () => {
      if (replaced) return;
      replaced = true;
      await rm(slotFile);
      await writeFile(slotFile, JSON.stringify(newerSlot));
    };
    const open = async (...args: Parameters<typeof nodeFs.open>) => {
      const file = String(args[0]);
      const handle = await nodeFs.open(...args);
      if (file !== slotFile || originalSlotReadComplete) return handle;
      return bindMethods(handle, {
        close: async () => {
          await handle.close();
          originalSlotReadComplete = true;
        },
      });
    };
    const lstat = async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
      if (!replaced && originalSlotReadComplete && leaseLinkCount === 0 && String(file) === canonicalSlotsDir) {
        await replaceWithNewerSlot();
      }
      return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
    };
    const link = async (source: Parameters<typeof nodeFs.link>[0], destination: Parameters<typeof nodeFs.link>[1]) => {
      await nodeFs.link(source, destination);
      if (String(destination) !== leaseFile) return;
      leaseLinkCount += 1;
      if (originalSlotReadComplete && leaseLinkCount > 1) await replaceWithNewerSlot();
    };
    const fs = bindMethods(nodeFs, { lstat, link, open });
    const writer = writerWithIds(['command_collision', 'lease_reserve', 'lease_cleanup'], { fs });

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_collision',
    });

    expect(replaced).toBe(true);
    expect(leaseLinkCount).toBe(2);
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(JSON.stringify(newerSlot));
    expect(await readdir(slotsDir)).toEqual(['0.slot']);
  });

  it('retains its owned slot when cleanup expires after final slot identity lstat', async () => {
    await writeFile(path.join(pendingDir, 'command_boundary_cleanup.json'), '{"existing":true}');
    const canonicalSlotsDir = await nodeFs.realpath(slotsDir);
    const slotFile = path.join(canonicalSlotsDir, '0.slot');
    const leaseFile = `${slotFile}.lease`;
    let currentMs = START_MS;
    let leaseLinkCount = 0;
    let cleanupSlotLstatCount = 0;
    let expiredAtBoundary = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: Parameters<typeof nodeFs.link>[0], destination: Parameters<typeof nodeFs.link>[1]) => {
        await nodeFs.link(source, destination);
        if (String(destination) === leaseFile) leaseLinkCount += 1;
      },
      lstat: async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
        const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
        if (leaseLinkCount > 1 && String(file) === slotFile) {
          cleanupSlotLstatCount += 1;
          if (cleanupSlotLstatCount === 3) {
            expiredAtBoundary = true;
            currentMs = START_MS + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS;
          }
        }
        return stats;
      },
    });
    const writer = createStudioDirectorCommandWriter(
      { projectId: PROJECT_ID, projectDir },
      {
        fs,
        now: () => currentMs,
        createId: (() => {
          const ids = ['command_boundary_cleanup', 'lease_reserve_boundary', 'lease_cleanup_boundary'];
          return () => ids.shift() ?? 'lease_fallback';
        })(),
        sleep: async () => undefined,
      }
    );

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_boundary_cleanup',
    });

    expect(expiredAtBoundary).toBe(true);
    expect(JSON.parse(await readFile(slotFile, 'utf8'))).toMatchObject({ commandId: 'command_boundary_cleanup' });
    expect(existsSync(leaseFile)).toBe(true);
  });

  it.each([
    {
      name: 'unsafe command id',
      ids: ['unsafe/id'],
      input: setBriefInput(),
    },
    {
      name: 'duplicate command/add id',
      ids: ['duplicate_id', 'duplicate_id'],
      input: { expectedRevision: 7, operations: [addScene('Opening')] },
    },
    {
      name: 'duplicate add ids',
      ids: ['command_1', 'duplicate_scene', 'duplicate_scene'],
      input: { expectedRevision: 7, operations: [addScene('Opening'), addScene('Closing')] },
    },
  ])('rejects $name before touching the filesystem', async ({ ids, input }) => {
    let filesystemCalls = 0;
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          filesystemCalls += 1;
          return Reflect.apply(value, target, args);
        };
      },
    });
    const writer = writerWithIds(ids, { fs });

    const result = await writer.apply(input as StudioApplyEditsInput);

    expect(result.status).toBe('storage_error');
    expect(filesystemCalls).toBe(0);
  });

  it.each([
    {
      name: 'empty operation list',
      input: { expectedRevision: 7, operations: [] },
    },
    {
      name: 'malformed edit patch',
      input: { expectedRevision: 7, operations: [{ kind: 'edit_scene', sceneId: 'scene_1', changes: {} }] },
    },
    {
      name: 'fully converted oversize command',
      input: {
        expectedRevision: 7,
        operations: Array.from({ length: 32 }, (_, index) => ({
          ...addScene(`Scene ${index + 1}`),
          scene: {
            ...addScene(`Scene ${index + 1}`).scene,
            visualPrompt: 'v'.repeat(8 * 1024),
            narration: 'n'.repeat(4 * 1024),
          },
        })),
      },
    },
  ])('rejects $name before any filesystem mutation or lookup', async ({ input }) => {
    let filesystemCalls = 0;
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          filesystemCalls += 1;
          return Reflect.apply(value, target, args);
        };
      },
    });
    const ids = ['command_invalid', ...Array.from({ length: 32 }, (_, index) => `scene_${index + 1}`)];
    const writer = writerWithIds(ids, { fs });

    const result = await writer.apply(input as StudioApplyEditsInput);

    expect(result).toEqual({ status: 'storage_error', commandId: 'command_invalid' });
    expect(filesystemCalls).toBe(0);
  });

  it('returns unconfirmed after a final named deadline read without republishing the pending command', async () => {
    let currentMs = START_MS;
    let pendingLinkAttempts = 0;
    let namedReceiptReads = 0;
    const fs = bindMethods(nodeFs, {
      link: async (source: Parameters<typeof nodeFs.link>[0], destination: Parameters<typeof nodeFs.link>[1]) => {
        if (String(destination).endsWith(`${path.sep}commands${path.sep}pending${path.sep}command_once.json`)) {
          pendingLinkAttempts += 1;
        }
        await nodeFs.link(source, destination);
      },
      lstat: async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
        if (String(file).endsWith(`${path.sep}commands${path.sep}receipts${path.sep}command_once.json`)) {
          namedReceiptReads += 1;
        }
        return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
      },
    });
    const writer = createStudioDirectorCommandWriter(
      { projectId: PROJECT_ID, projectDir },
      {
        fs,
        now: () => currentMs,
        createId: () => 'command_once',
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
      }
    );

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'unconfirmed',
      commandId: 'command_once',
    });

    expect(pendingLinkAttempts).toBe(1);
    expect(namedReceiptReads).toBeGreaterThanOrEqual(2);
    expect(await readdir(pendingDir)).toEqual(['command_once.json']);
  });

  it.each(['applied', 'rejected', 'expired', 'indeterminate'] as const)(
    'returns the durable %s Task 7 receipt byte-for-object unchanged',
    async (status) => {
      const writer = writerWithIds(['command_receipt']);
      await writer.apply(setBriefInput());
      const command = JSON.parse(
        await readFile(path.join(pendingDir, 'command_receipt.json'), 'utf8')
      ) as StudioDirectorCommandRecordV1;
      const base = {
        schemaVersion: 1 as const,
        commandId: command.commandId,
        projectId: PROJECT_ID,
        expectedRevision: command.expectedRevision,
        decidedAt: '2026-08-17T01:02:10.000Z',
      };
      const receipt: StudioDirectorCommandReceiptV1 =
        status === 'applied'
          ? { ...base, status, appliedRevision: 8, createdSceneIds: [] }
          : status === 'rejected'
            ? { ...base, status, observedRevision: 8, reasonCode: 'stale_revision' }
            : status === 'expired'
              ? { ...base, status, observedRevision: 7, reasonCode: 'deadline_elapsed' }
              : { ...base, status, observedRevision: 8, reasonCode: 'commit_attribution_unknown' };
      await writeFile(path.join(receiptsDir, 'command_receipt.json'), JSON.stringify(receipt));

      await expect(writer.getStatus({ commandId: 'command_receipt' })).resolves.toEqual(receipt);
    }
  );

  it('reports exact pending and not-found states, then resolves a later durable receipt', async () => {
    const writer = writerWithIds(['command_later']);
    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'unconfirmed',
      commandId: 'command_later',
    });
    await expect(writer.getStatus({ commandId: 'command_later' })).resolves.toEqual({
      status: 'pending',
      commandId: 'command_later',
    });
    await expect(writer.getStatus({ commandId: 'missing_command' })).resolves.toEqual({
      status: 'not_found',
      commandId: 'missing_command',
    });
    const receipt: StudioDirectorCommandReceiptV1 = {
      schemaVersion: 1,
      commandId: 'command_later',
      projectId: PROJECT_ID,
      expectedRevision: 7,
      decidedAt: '2026-08-17T01:02:20.000Z',
      status: 'applied',
      appliedRevision: 8,
      createdSceneIds: [],
    };
    await writeFile(path.join(receiptsDir, 'command_later.json'), JSON.stringify(receipt));

    await expect(writer.getStatus({ commandId: 'command_later' })).resolves.toEqual(receipt);
  });

  it.each(['partial', 'unsafe'] as const)('reports %s mailbox storage as storage_error', async (kind) => {
    await rm(receiptsDir, { recursive: true });
    if (kind === 'unsafe') await symlink(projectDir, receiptsDir, 'dir');
    const writer = writerWithIds(['unused']);

    await expect(writer.getStatus({ commandId: 'command_1' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_1',
    });
  });

  it('status reads only the named receipt followed by the named pending record and never scans any ledger', async () => {
    const canonicalProjectDir = await nodeFs.realpath(projectDir);
    await writeFile(
      path.join(pendingDir, 'command_named.json'),
      JSON.stringify({
        schemaVersion: 1,
        commandId: 'command_named',
        projectId: PROJECT_ID,
        expectedRevision: 7,
        createdAt: '2026-08-17T01:02:03.000Z',
        deadlineAt: '2026-08-17T01:02:18.000Z',
        policy: 'auto_apply',
        operations: [{ kind: 'set_brief', brief: 'Named command' }],
      })
    );
    const touchedRecords: string[] = [];
    const readdirSpy = vi.fn(async () => {
      throw new Error('ledger scans are forbidden');
    });
    const fs = bindMethods(nodeFs, {
      readdir: readdirSpy,
      lstat: async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
        const value = String(file);
        if (value.endsWith('.json') && value.includes(`${path.sep}commands${path.sep}`)) touchedRecords.push(value);
        return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
      },
    });
    const writer = writerWithIds(['unused'], { fs });

    await expect(writer.getStatus({ commandId: 'command_named' })).resolves.toEqual({
      status: 'pending',
      commandId: 'command_named',
    });

    expect(readdirSpy).not.toHaveBeenCalled();
    expect(new Set(touchedRecords)).toEqual(
      new Set([
        path.join(canonicalProjectDir, 'commands', 'receipts', 'command_named.json'),
        path.join(canonicalProjectDir, 'commands', 'pending', 'command_named.json'),
      ])
    );
    expect(touchedRecords.some((file) => file.includes(`${path.sep}proposals${path.sep}`))).toBe(false);
  });

  it('rejects a command whose fully converted bytes exceed the shared record cap', async () => {
    const input: StudioApplyEditsInput = {
      expectedRevision: 7,
      operations: Array.from({ length: 32 }, (_, index) => ({
        ...addScene(`Scene ${index + 1}`),
        scene: {
          ...addScene(`Scene ${index + 1}`).scene,
          visualPrompt: 'v'.repeat(8 * 1024),
          narration: 'n'.repeat(4 * 1024),
        },
      })),
    };
    const convertedPreview = JSON.stringify({
      schemaVersion: 1,
      commandId: 'command_oversize',
      projectId: PROJECT_ID,
      expectedRevision: 7,
      createdAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
      policy: 'auto_apply',
      operations: input.operations.map((operation, index) => ({ ...operation, sceneId: `scene_${index + 1}` })),
    });
    expect(Buffer.byteLength(convertedPreview, 'utf8')).toBeGreaterThan(STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES);

    const writer = writerWithIds([
      'command_oversize',
      ...Array.from({ length: 32 }, (_, index) => `scene_${index + 1}`),
    ]);
    await expect(writer.apply(input)).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_oversize',
    });
    expect(await readdir(slotsDir)).toEqual([]);
    expect(await readdir(pendingDir)).toEqual([]);
  });

  it('mints schema-2 beat and shot identities in canonical operation order', async () => {
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('command_v2')
      .mockReturnValueOnce('section_new')
      .mockReturnValueOnce('clip_first')
      .mockReturnValueOnce('clip_added')
      .mockReturnValueOnce('lease_v2');
    let currentMs = START_MS;
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        createId,
        now: () => currentMs,
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
      }
    );

    await expect(
      writer.apply({
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_beat',
            beat: { title: 'Opening', action: '', look: 'A warm visual language' },
            firstShot: shotInputV2('A wide opening shot'),
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'section_existing',
            shot: shotInputV2('A close detail'),
            beforeShotId: null,
          },
        ],
      })
    ).resolves.toEqual({ status: 'unconfirmed', commandId: 'command_v2' });

    const command = JSON.parse(
      await readFile(path.join(pendingDir, 'command_v2.json'), 'utf8')
    ) as StudioDirectorCommandRecordV2;
    expect(command).toMatchObject({
      schemaVersion: 2,
      commandId: 'command_v2',
      projectId: PROJECT_ID,
      expectedRevision: 7,
      operations: [
        { kind: 'add_beat', beatId: 'section_new', firstShotId: 'clip_first' },
        { kind: 'add_shot', beatId: 'section_existing', shotId: 'clip_added' },
      ],
    });
    expect(createId.mock.calls).toHaveLength(5);
  });

  it('durably removes each V2 publication guard before reporting command publication', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const slotGuard = path.join(canonicalSlots, '0.slot.unconfirmed');
    const pendingGuard = path.join(canonicalPending, 'command_v2_guard_order.json.unconfirmed');
    const events: string[] = [];
    const fs = bindMethods(nodeFs, {
      rm: async (file: Parameters<typeof nodeFs.rm>[0], ...args: unknown[]) => {
        const result = await Reflect.apply(nodeFs.rm, nodeFs, [file, ...args]);
        if (String(file) === slotGuard) events.push('slot-guard-removed');
        if (String(file) === pendingGuard) events.push('pending-guard-removed');
        return result;
      },
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if ((file !== canonicalSlots && file !== canonicalPending) || args[1] !== 'r') return handle;
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            events.push(file === canonicalSlots ? 'slots-synced' : 'pending-synced');
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_v2_guard_order', 'lease_v2_guard_order'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Durable guards' }] })
    ).resolves.toEqual({ status: 'unconfirmed', commandId: 'command_v2_guard_order' });
    const slotGuardRemoved = events.indexOf('slot-guard-removed');
    const pendingGuardRemoved = events.indexOf('pending-guard-removed');
    expect(slotGuardRemoved).toBeGreaterThanOrEqual(0);
    expect(pendingGuardRemoved).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('slots-synced', slotGuardRemoved + 1)).toBeGreaterThan(slotGuardRemoved);
    expect(events.indexOf('pending-synced', pendingGuardRemoved + 1)).toBeGreaterThan(pendingGuardRemoved);
  });

  it('retains V2 lease authority when the post-guard slot sync is uncertain', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const slotFile = path.join(canonicalSlots, '0.slot');
    let guardRemoved = false;
    let failedFinalSync = false;
    const fs = bindMethods(nodeFs, {
      rm: async (file: Parameters<typeof nodeFs.rm>[0], ...args: unknown[]) => {
        const result = await Reflect.apply(nodeFs.rm, nodeFs, [file, ...args]);
        if (String(file) === `${slotFile}.unconfirmed`) guardRemoved = true;
        return result;
      },
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (file !== canonicalSlots || args[1] !== 'r') return handle;
        return bindMethods(handle, {
          sync: async () => {
            if (guardRemoved && !failedFinalSync) {
              failedFinalSync = true;
              throw Object.assign(new Error('post-guard slot sync failed'), { code: 'EIO' });
            }
            await handle.sync();
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_slot_guard_sync', 'lease_slot_guard_sync'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Slot guard sync' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_slot_guard_sync' });
    expect(failedFinalSync).toBe(true);
    await expect(readFile(slotFile, 'utf8')).resolves.toContain('command_slot_guard_sync');
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it('retains the V2 pending pair when the post-guard pending sync is uncertain', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const pendingFile = path.join(canonicalPending, 'command_pending_guard_sync.json');
    let guardRemoved = false;
    let failedFinalSync = false;
    const fs = bindMethods(nodeFs, {
      rm: async (file: Parameters<typeof nodeFs.rm>[0], ...args: unknown[]) => {
        const result = await Reflect.apply(nodeFs.rm, nodeFs, [file, ...args]);
        if (String(file) === `${pendingFile}.unconfirmed`) guardRemoved = true;
        return result;
      },
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (file !== canonicalPending || args[1] !== 'r') return handle;
        return bindMethods(handle, {
          sync: async () => {
            if (guardRemoved && !failedFinalSync) {
              failedFinalSync = true;
              throw Object.assign(new Error('post-guard pending sync failed'), { code: 'EIO' });
            }
            await handle.sync();
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_pending_guard_sync', 'lease_pending_guard_sync'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Pending guard sync' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_pending_guard_sync' });
    expect(failedFinalSync).toBe(true);
    await expect(readFile(pendingFile, 'utf8')).resolves.toContain('command_pending_guard_sync');
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('preserves every non-minting schema-2 operation without paid side effects', async () => {
    const writer = writerWithIdsV2(['command_v2_ops', 'lease_v2_ops']);
    const input: StudioApplyEditsInputV2 = {
      expectedRevision: 9,
      operations: [
        { kind: 'set_brief', brief: 'Free edits only' },
        { kind: 'edit_beat', beatId: 'section_1', changes: { title: 'Opening' } },
        { kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] },
        { kind: 'park_beat', beatId: 'section_2' },
        { kind: 'restore_beat', beatId: 'section_2', beforeBeatId: 'section_1' },
        { kind: 'edit_shot', shotId: 'clip_1', changes: { line: 'Closer' } },
        { kind: 'delete_shot', shotId: 'clip_old' },
        { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_2', 'clip_1'] },
        { kind: 'park_take', shotId: 'clip_1', assetId: 'take_1' },
        { kind: 'restore_take', shotId: 'clip_1', assetId: 'take_2' },
        { kind: 'remove_bin_item', assetId: 'take_3' },
        { kind: 'reorder_bin', bin: [{ kind: 'take', assetId: 'take_3' }] },
        { kind: 'select_take', shotId: 'clip_1', assetId: 'take_1' },
      ],
    };

    await expect(writer.apply(input)).resolves.toEqual({ status: 'unconfirmed', commandId: 'command_v2_ops' });
    const command = JSON.parse(
      await readFile(path.join(pendingDir, 'command_v2_ops.json'), 'utf8')
    ) as StudioDirectorCommandRecordV2;
    expect(command.operations).toEqual(input.operations);
  });

  it('returns exact schema-2 receipts with ordered created identity arrays', async () => {
    const writer = writerWithIdsV2(['command_v2_receipt', 'lease_v2_receipt']);
    await writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Schema two' }] });
    const receipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: 2,
      commandId: 'command_v2_receipt',
      projectId: PROJECT_ID,
      expectedRevision: 7,
      decidedAt: '2026-08-17T01:02:10.000Z',
      status: 'applied',
      appliedRevision: 8,
      createdBeatIds: ['section_new'],
      createdShotIds: ['clip_first', 'clip_added'],
    };
    await writeFile(path.join(receiptsDir, 'command_v2_receipt.json'), JSON.stringify(receipt));

    await expect(writer.getStatus({ commandId: receipt.commandId })).resolves.toEqual(receipt);
  });

  it.each(['applied', 'rejected'] as const)(
    'rejects a valid %s receipt for another pending revision during status and apply preflight',
    async (status) => {
      const commandId = `command_v2_revision_${status}`;
      const publisher = writerWithIdsV2([commandId, `lease_v2_revision_${status}`]);
      await expect(
        publisher.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Revision bound' }] })
      ).resolves.toEqual({ status: 'unconfirmed', commandId });
      const pendingFile = path.join(pendingDir, `${commandId}.json`);
      const slotFile = path.join(slotsDir, '0.slot');
      const receiptFile = path.join(receiptsDir, `${commandId}.json`);
      const receipt: StudioDirectorCommandReceiptV2 =
        status === 'applied'
          ? {
              schemaVersion: 2,
              commandId,
              projectId: PROJECT_ID,
              expectedRevision: 8,
              decidedAt: '2026-08-17T01:02:10.000Z',
              status,
              appliedRevision: 9,
              createdBeatIds: [],
              createdShotIds: [],
            }
          : {
              schemaVersion: 2,
              commandId,
              projectId: PROJECT_ID,
              expectedRevision: 8,
              decidedAt: '2026-08-17T01:02:10.000Z',
              status,
              observedRevision: 8,
              reasonCode: 'stale_revision',
            };
      await writeFile(receiptFile, JSON.stringify(receipt));
      const before = {
        pending: await readFile(pendingFile, 'utf8'),
        slot: await readFile(slotFile, 'utf8'),
        receipt: await readFile(receiptFile, 'utf8'),
      };
      const reader = writerWithIdsV2(['unused']);

      await expect(reader.getStatus({ commandId })).resolves.toEqual({ status: 'storage_error', commandId });
      await expect(
        writerWithIdsV2([commandId, `lease_v2_collision_${status}`]).apply({
          expectedRevision: 7,
          operations: [{ kind: 'set_brief', brief: 'Must not replace authority' }],
        })
      ).resolves.toEqual({ status: 'storage_error', commandId });

      await expect(readFile(pendingFile, 'utf8')).resolves.toBe(before.pending);
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(before.slot);
      await expect(readFile(receiptFile, 'utf8')).resolves.toBe(before.receipt);
    }
  );

  it('keeps an absent-pending valid receipt as receipt-first terminal authority', async () => {
    const commandId = 'command_v2_receipt_first';
    const receipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: 2,
      commandId,
      projectId: PROJECT_ID,
      expectedRevision: 11,
      decidedAt: '2026-08-17T01:02:10.000Z',
      status: 'applied',
      appliedRevision: 12,
      createdBeatIds: [],
      createdShotIds: [],
    };
    await writeFile(path.join(receiptsDir, `${commandId}.json`), JSON.stringify(receipt));

    await expect(writerWithIdsV2(['unused']).getStatus({ commandId })).resolves.toEqual(receipt);
  });

  it('rejects a mismatched receipt that appears while apply is polling its exact pending command', async () => {
    const commandId = 'command_v2_poll_revision_mismatch';
    const receiptFile = path.join(receiptsDir, `${commandId}.json`);
    let receiptPublished = false;
    const writer = writerWithIdsV2([commandId, 'lease_v2_poll_revision_mismatch'], {
      sleep: async () => {
        if (receiptPublished) return;
        receiptPublished = true;
        await writeFile(
          receiptFile,
          JSON.stringify({
            schemaVersion: 2,
            commandId,
            projectId: PROJECT_ID,
            expectedRevision: 8,
            decidedAt: '2026-08-17T01:02:10.000Z',
            status: 'applied',
            appliedRevision: 9,
            createdBeatIds: [],
            createdShotIds: [],
          } satisfies StudioDirectorCommandReceiptV2)
        );
      },
    });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Poll exact revision' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId });
    expect(receiptPublished).toBe(true);
    await expect(readFile(path.join(pendingDir, `${commandId}.json`), 'utf8')).resolves.toContain(
      '"expectedRevision":7'
    );
    await expect(readFile(receiptFile, 'utf8')).resolves.toContain('"expectedRevision":8');
  });

  it.each(
    invalidPendingCasesV2.flatMap((testCase) => [
      { ...testCase, lease: 'missing' as const, leaseLabel: 'without a residual lease' },
      { ...testCase, lease: 'matching' as const, leaseLabel: 'with its matching residual lease' },
    ])
  )(
    'returns the exact durable rejection for a $label $leaseLabel while same-id apply stays fail-closed',
    async ({ kind, expectedRevision, reasonCode, lease }) => {
      const commandId = `terminal_${kind}_${lease}`;
      const receipt = await writeInvalidTerminalAuthorityV2({
        commandId,
        kind,
        receiptExpectedRevision: expectedRevision,
        receiptReasonCode: reasonCode,
        ...(lease === 'matching' ? { leaseCommandId: commandId } : {}),
      });
      const before = await snapshotCommandMailboxBytes();

      await expect(writerWithIdsV2(['unused']).getStatus({ commandId })).resolves.toEqual(receipt);
      await expect(
        writerWithIdsV2([commandId, `replacement_lease_${kind}_${lease}`]).apply({
          expectedRevision: 7,
          operations: [{ kind: 'set_brief', brief: 'Never overwrite terminal authority' }],
        })
      ).resolves.toEqual({ status: 'storage_error', commandId });
      await expect(snapshotCommandMailboxBytes()).resolves.toEqual(before);
    }
  );

  it.each([
    {
      label: 'receipt reason',
      suffix: 'reason',
      receiptExpectedRevision: 7,
      receiptReasonCode: 'unsupported_version',
    },
    {
      label: 'receipt revision',
      suffix: 'revision',
      receiptExpectedRevision: 8,
      receiptReasonCode: 'malformed_record',
    },
    {
      label: 'slot command',
      suffix: 'slot',
      receiptExpectedRevision: 7,
      receiptReasonCode: 'malformed_record',
      slotCommandId: 'other_slot_command',
    },
    {
      label: 'slot deadline',
      suffix: 'slot_deadline',
      receiptExpectedRevision: 7,
      receiptReasonCode: 'malformed_record',
      slotDeadlineAt: new Date(START_MS + STUDIO_DIRECTOR_COMMAND_WAIT_MS - 1_000).toISOString(),
    },
    {
      label: 'lease command',
      suffix: 'lease',
      receiptExpectedRevision: 7,
      receiptReasonCode: 'malformed_record',
      leaseCommandId: 'other_lease_command',
    },
  ] as const)(
    'keeps a mismatched $label fail-closed and byte-identical for status and same-id apply',
    async ({ suffix, receiptExpectedRevision, receiptReasonCode, ...authorityOverrides }) => {
      const commandId = `terminal_mismatch_${suffix}`;
      await writeInvalidTerminalAuthorityV2({
        commandId,
        kind: 'malformed_recovered_revision',
        receiptExpectedRevision,
        receiptReasonCode,
        ...authorityOverrides,
      });
      const before = await snapshotCommandMailboxBytes();

      await expect(writerWithIdsV2(['unused']).getStatus({ commandId })).resolves.toEqual({
        status: 'storage_error',
        commandId,
      });
      await expect(
        writerWithIdsV2([commandId, `replacement_lease_${suffix}`]).apply({
          expectedRevision: 7,
          operations: [{ kind: 'set_brief', brief: 'Mismatched authority must survive' }],
        })
      ).resolves.toEqual({ status: 'storage_error', commandId });
      await expect(snapshotCommandMailboxBytes()).resolves.toEqual(before);
    }
  );

  it.each([
    { label: 'command', suffix: 'command', slotCommandId: 'other_slot_command' },
    {
      label: 'deadline',
      suffix: 'deadline',
      slotDeadlineAt: new Date(START_MS + STUDIO_DIRECTOR_COMMAND_WAIT_MS - 1_000).toISOString(),
    },
  ] as const)(
    'rejects a structurally valid pending whose actual slot $label is its sole malformed condition',
    async ({ suffix, ...slotOverrides }) => {
      const commandId = `valid_pending_slot_mismatch_${suffix}`;
      await writeInvalidTerminalAuthorityV2({
        commandId,
        kind: 'malformed_recovered_revision',
        receiptExpectedRevision: 7,
        receiptReasonCode: 'malformed_record',
        ...slotOverrides,
      });
      await writeFile(path.join(pendingDir, `${commandId}.json`), JSON.stringify(validPendingRecordV2(commandId)));
      const before = await snapshotCommandMailboxBytes();

      await expect(writerWithIdsV2(['unused']).getStatus({ commandId })).resolves.toEqual({
        status: 'storage_error',
        commandId,
      });
      await expect(
        writerWithIdsV2([commandId, `replacement_lease_slot_mismatch_${suffix}`]).apply({
          expectedRevision: 7,
          operations: [{ kind: 'set_brief', brief: 'Actual slot mismatch stays fail-closed' }],
        })
      ).resolves.toEqual({ status: 'storage_error', commandId });
      await expect(snapshotCommandMailboxBytes()).resolves.toEqual(before);
    }
  );

  it.each(['malformed_record', 'unsupported_version'] as const)(
    'does not attribute a same-revision %s rejection to a valid pending',
    async (reasonCode) => {
      const commandId = `valid_pending_invalid_reason_${reasonCode}`;
      await writeInvalidTerminalAuthorityV2({
        commandId,
        kind: 'malformed_recovered_revision',
        receiptExpectedRevision: 7,
        receiptReasonCode: reasonCode,
      });
      await writeFile(path.join(pendingDir, `${commandId}.json`), JSON.stringify(validPendingRecordV2(commandId)));
      const before = await snapshotCommandMailboxBytes();

      await expect(writerWithIdsV2(['unused']).getStatus({ commandId })).resolves.toEqual({
        status: 'storage_error',
        commandId,
      });
      await expect(
        writerWithIdsV2([commandId, `replacement_lease_invalid_reason_${reasonCode}`]).apply({
          expectedRevision: 7,
          operations: [{ kind: 'set_brief', brief: 'Invalid-only reasons need invalid pending authority' }],
        })
      ).resolves.toEqual({ status: 'storage_error', commandId });
      await expect(snapshotCommandMailboxBytes()).resolves.toEqual(before);
    }
  );

  it('gives a complete V1 lease precedence over an otherwise attributable invalid V2 rejection', async () => {
    const commandId = 'terminal_v1_lease_precedence';
    await writeInvalidTerminalAuthorityV2({
      commandId,
      kind: 'malformed_recovered_revision',
      receiptExpectedRevision: 7,
      receiptReasonCode: 'malformed_record',
    });
    const legacyLease = JSON.stringify({
      schemaVersion: 1,
      leaseId: 'legacy_terminal_lease',
      owner: 'main',
      commandId,
      reservedAt: new Date(START_MS).toISOString(),
      deadlineAt: new Date(START_MS + STUDIO_DIRECTOR_COMMAND_WAIT_MS).toISOString(),
      acquiredAt: new Date(START_MS).toISOString(),
      expiresAt: new Date(START_MS + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
    });
    await writeFile(path.join(slotsDir, '0.slot.lease'), legacyLease);
    const before = await snapshotCommandMailboxBytes();

    await expect(writerWithIdsV2(['unused']).getStatus({ commandId })).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId,
    });
    await expect(
      writerWithIdsV2([commandId, 'replacement_lease_v1_precedence']).apply({
        expectedRevision: 7,
        operations: [{ kind: 'set_brief', brief: 'Do not cross the V1 boundary' }],
      })
    ).resolves.toEqual({ status: 'unsupported_prototype_schema', commandId });
    await expect(snapshotCommandMailboxBytes()).resolves.toEqual(before);
  });

  it('reports V1 receipts and pending records as unsupported without changing their bytes', async () => {
    const receiptFile = path.join(receiptsDir, 'legacy_receipt.json');
    const pendingFile = path.join(pendingDir, 'legacy_pending.json');
    const legacyReceipt = JSON.stringify({
      schemaVersion: 1,
      commandId: 'legacy_receipt',
      projectId: PROJECT_ID,
      expectedRevision: 7,
      decidedAt: '2026-08-17T01:02:10.000Z',
      status: 'applied',
      appliedRevision: 8,
      createdSceneIds: [],
    });
    const legacyPending = JSON.stringify({
      schemaVersion: 1,
      commandId: 'legacy_pending',
      projectId: PROJECT_ID,
      expectedRevision: 7,
      createdAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
      policy: 'auto_apply',
      operations: [{ kind: 'set_brief', brief: 'Legacy' }],
    });
    await writeFile(receiptFile, legacyReceipt);
    await writeFile(pendingFile, legacyPending);
    const writer = writerWithIdsV2(['unused']);

    await expect(writer.getStatus({ commandId: 'legacy_receipt' })).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'legacy_receipt',
    });
    await expect(writer.getStatus({ commandId: 'legacy_pending' })).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'legacy_pending',
    });
    await expect(readFile(receiptFile, 'utf8')).resolves.toBe(legacyReceipt);
    await expect(readFile(pendingFile, 'utf8')).resolves.toBe(legacyPending);
  });

  it('classifies a V1 project manifest before reading or mutating schema-2 command sidecars', async () => {
    const manifestFile = path.join(projectDir, 'project.json');
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: PROJECT_ID });
    await writeFile(manifestFile, legacyManifest);
    const ids = ['command_v1_manifest', 'lease_v1_manifest'];
    const createId = vi.fn(() => ids.shift() ?? 'unused');
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      { createId, now: () => START_MS }
    );

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'No V2 residue' }] })
    ).resolves.toEqual({ status: 'unsupported_prototype_schema', commandId: 'command_v1_manifest' });
    await expect(writer.getStatus({ commandId: 'legacy_status' })).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'legacy_status',
    });
    await expect(readFile(manifestFile, 'utf8')).resolves.toBe(legacyManifest);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
    await expect(readdir(receiptsDir)).resolves.toEqual([]);
  });

  it.each(['pending', 'receipt', 'lease'] as const)(
    'preflights an exact V1 %s before publishing a schema-2 lease or slot',
    async (kind) => {
      const commandId = `command_v1_${kind}`;
      const file =
        kind === 'pending'
          ? path.join(pendingDir, `${commandId}.json`)
          : kind === 'receipt'
            ? path.join(receiptsDir, `${commandId}.json`)
            : path.join(slotsDir, '0.slot.lease');
      const legacy = JSON.stringify(
        kind === 'pending'
          ? {
              schemaVersion: 1,
              commandId,
              projectId: PROJECT_ID,
              expectedRevision: 7,
              createdAt: '2026-08-17T01:02:03.000Z',
              deadlineAt: '2026-08-17T01:02:18.000Z',
              policy: 'auto_apply',
              operations: [{ kind: 'set_brief', brief: 'Legacy' }],
            }
          : kind === 'receipt'
            ? {
                schemaVersion: 1,
                commandId,
                projectId: PROJECT_ID,
                expectedRevision: 7,
                decidedAt: '2026-08-17T01:02:04.000Z',
                status: 'rejected',
                reason: 'Legacy',
              }
            : {
                schemaVersion: 1,
                leaseId: 'legacy_lease',
                owner: 'writer',
                commandId,
                reservedAt: '2026-08-17T01:02:03.000Z',
                deadlineAt: '2026-08-17T01:02:18.000Z',
                acquiredAt: '2026-08-17T01:02:03.000Z',
                expiresAt: '2026-08-17T01:02:08.000Z',
              }
      );
      await writeFile(file, legacy);
      const writer = writerWithIdsV2([commandId, `lease_${kind}`]);

      await expect(
        writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Blocked' }] })
      ).resolves.toEqual({ status: 'unsupported_prototype_schema', commandId });
      await expect(writer.getStatus({ commandId })).resolves.toEqual({
        status: 'unsupported_prototype_schema',
        commandId,
      });
      await expect(readFile(file, 'utf8')).resolves.toBe(legacy);
      const slotNames = await readdir(slotsDir);
      expect(slotNames).toEqual(kind === 'lease' ? ['0.slot.lease'] : []);
    }
  );

  it('does not replace or clean a V1 slot when the schema-2 writer encounters it', async () => {
    const slotFile = path.join(slotsDir, '0.slot');
    const legacySlot = JSON.stringify({
      schemaVersion: 1,
      commandId: 'legacy_command',
      reservedAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
    });
    await writeFile(slotFile, legacySlot);
    const writer = writerWithIdsV2(['command_blocked', 'lease_blocked']);

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Must not publish' }] })
    ).resolves.toEqual({ status: 'unsupported_prototype_schema', commandId: 'command_blocked' });
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(legacySlot);
    await expect(writer.getStatus({ commandId: 'legacy_command' })).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'legacy_command',
    });
    expect(await readdir(pendingDir)).toEqual([]);
    expect(await readdir(receiptsDir)).toEqual([]);
    expect(await readdir(slotsDir)).toEqual(['0.slot']);
  });

  it('releases its exact schema-2 lease when the manifest becomes V1 after lease publication', async () => {
    const manifestFile = path.join(projectDir, 'project.json');
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: PROJECT_ID });
    let swapped = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!swapped && destination.endsWith('/0.slot.lease')) {
          swapped = true;
          await writeFile(manifestFile, legacyManifest);
        }
      },
    });
    const writer = writerWithIdsV2(['command_manifest_swap', 'lease_manifest_swap'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Fence the swap' }] })
    ).resolves.toEqual({ status: 'unsupported_prototype_schema', commandId: 'command_manifest_swap' });
    expect(swapped).toBe(true);
    await expect(readFile(manifestFile, 'utf8')).resolves.toBe(legacyManifest);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it('removes its exact schema-2 slot when the manifest becomes V1 after slot publication', async () => {
    const manifestFile = path.join(projectDir, 'project.json');
    const legacyManifest = JSON.stringify({ schemaVersion: 1, id: PROJECT_ID });
    let swapped = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!swapped && destination.endsWith('/0.slot')) {
          swapped = true;
          await writeFile(manifestFile, legacyManifest);
        }
      },
    });
    const writer = writerWithIdsV2(['command_post_slot_swap', 'lease_post_slot_swap', 'lease_post_slot_cleanup'], {
      fs,
    });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Fence after slot' }] })
    ).resolves.toEqual({ status: 'unsupported_prototype_schema', commandId: 'command_post_slot_swap' });
    expect(swapped).toBe(true);
    await expect(readFile(manifestFile, 'utf8')).resolves.toBe(legacyManifest);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it('retains its V2 lease through pending temp sync and exact-cleans an active not-linked reservation', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const pendingFile = path.join(canonicalPending, 'command_pending_sync_failure.json');
    const leaseFile = path.join(canonicalSlots, '0.slot.lease');
    let observedHeldLease = false;
    let failedPendingSync = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (!file.startsWith(`${pendingFile}.`) || !file.endsWith('.tmp')) return handle;
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            observedHeldLease = existsSync(leaseFile);
            failedPendingSync = true;
            throw Object.assign(new Error('pending temp sync failed'), { code: 'EIO' });
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_pending_sync_failure', 'lease_pending_sync_failure'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Do not link' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_pending_sync_failure' });
    expect(failedPendingSync).toBe(true);
    expect(observedHeldLease).toBe(true);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
  });

  it('restores a replacement V2 slot raced into not-linked quarantine cleanup', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const pendingFile = path.join(canonicalPending, 'command_cleanup_slot_race.json');
    const slotFile = path.join(canonicalSlots, '0.slot');
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'replacement_cleanup_command',
      reservedAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
    });
    let pendingSyncFailed = false;
    let replaced = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (!file.startsWith(`${pendingFile}.`) || !file.endsWith('.tmp')) return handle;
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            pendingSyncFailed = true;
            throw Object.assign(new Error('force not-linked cleanup'), { code: 'EIO' });
          },
        });
      },
      rename: async (source: Parameters<typeof nodeFs.rename>[0], destination: Parameters<typeof nodeFs.rename>[1]) => {
        if (pendingSyncFailed && !replaced && String(source) === slotFile) {
          await nodeFs.rm(slotFile);
          await writeFile(slotFile, replacement);
          replaced = true;
        }
        await nodeFs.rename(source, destination);
      },
    });
    const writer = writerWithIdsV2(['command_cleanup_slot_race', 'lease_cleanup_slot_race'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Cleanup slot race' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_cleanup_slot_race' });
    expect(replaced).toBe(true);
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('retains the V2 reservation when cleanup authority expires during exact lease reproof', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const pendingFile = path.join(canonicalPending, 'command_cleanup_expiry.json');
    const leaseFile = path.join(canonicalSlots, '0.slot.lease');
    let currentMs = START_MS;
    let pendingSyncFailed = false;
    let cleanupLeaseLstats = 0;
    let expiredDuringCleanup = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (!file.startsWith(`${pendingFile}.`) || !file.endsWith('.tmp')) return handle;
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            pendingSyncFailed = true;
            throw Object.assign(new Error('force not-linked cleanup'), { code: 'EIO' });
          },
        });
      },
      lstat: async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
        const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
        if (pendingSyncFailed && String(file) === leaseFile) {
          cleanupLeaseLstats += 1;
          if (cleanupLeaseLstats === 4) {
            currentMs = START_MS + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS;
            expiredDuringCleanup = true;
          }
        }
        return stats;
      },
    });
    const ids = ['command_cleanup_expiry', 'lease_cleanup_expiry'];
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        fs,
        now: () => currentMs,
        createId: () => ids.shift() ?? 'unused',
        sleep: async () => undefined,
      }
    );

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Cleanup expiry' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_cleanup_expiry' });
    expect(expiredDuringCleanup).toBe(true);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('retains its V2 slot and lease after an ambiguous linked pending publication', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    let pendingDirectorySyncs = 0;
    let failedPostLinkSync = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (file !== canonicalPending || args[1] !== 'r') return handle;
        return bindMethods(handle, {
          sync: async () => {
            pendingDirectorySyncs += 1;
            if (pendingDirectorySyncs === 2) {
              failedPostLinkSync = true;
              throw Object.assign(new Error('post-link sync failed'), { code: 'EIO' });
            }
            await handle.sync();
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_pending_ambiguous', 'lease_pending_ambiguous'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Ambiguous link' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_pending_ambiguous' });
    expect(failedPostLinkSync).toBe(true);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('retains the V2 pair when the pending link reports failure after creating the final name', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const pendingFile = path.join(canonicalPending, 'command_pending_link_effect.json');
    let failedAfterLinkEffect = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: Parameters<typeof nodeFs.link>[0], destination: Parameters<typeof nodeFs.link>[1]) => {
        await nodeFs.link(source, destination);
        if (String(destination) === pendingFile) {
          failedAfterLinkEffect = true;
          throw Object.assign(new Error('link result was ambiguous'), { code: 'EIO' });
        }
      },
    });
    const writer = writerWithIdsV2(['command_pending_link_effect', 'lease_pending_link_effect'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Ambiguous syscall' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_pending_link_effect' });
    expect(failedAfterLinkEffect).toBe(true);
    await expect(readFile(pendingFile, 'utf8')).resolves.toContain('command_pending_link_effect');
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('rejects the final V2 pending link after lease expiry and leaves recovery authority intact', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const pendingFile = path.join(canonicalPending, 'command_pending_expired.json');
    let currentMs = START_MS;
    let advancedAtPendingSync = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (!file.startsWith(`${pendingFile}.`) || !file.endsWith('.tmp')) return handle;
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            currentMs = START_MS + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS;
            advancedAtPendingSync = true;
          },
        });
      },
    });
    const ids = ['command_pending_expired', 'lease_pending_expired'];
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        fs,
        now: () => currentMs,
        createId: () => ids.shift() ?? 'unused',
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
      }
    );

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Expired fence' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_pending_expired' });
    expect(advancedAtPendingSync).toBe(true);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('rejects the final V2 pending link when its slot is replaced during temp sync', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const pendingFile = path.join(canonicalPending, 'command_pending_slot_race.json');
    const slotFile = path.join(canonicalSlots, '0.slot');
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'replacement_command',
      reservedAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
    });
    let replaced = false;
    let observedHeldLease = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (!file.startsWith(`${pendingFile}.`) || !file.endsWith('.tmp')) return handle;
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            observedHeldLease = existsSync(path.join(canonicalSlots, '0.slot.lease'));
            await nodeFs.rm(slotFile);
            await writeFile(slotFile, replacement);
            replaced = true;
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_pending_slot_race', 'lease_pending_slot_race'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Fence the slot' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_pending_slot_race' });
    expect(replaced).toBe(true);
    expect(observedHeldLease).toBe(true);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot']);
  });

  it('retains the durable V2 pending and slot pair when the outer post-commit assertion fails', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const pendingFile = path.join(canonicalPending, 'command_post_commit_assertion.json');
    let guardRemoved = false;
    let postGuardSynced = false;
    let postGuardPendingLstats = 0;
    let failedOuterAssertion = false;
    const fs = bindMethods(nodeFs, {
      rm: async (file: Parameters<typeof nodeFs.rm>[0], ...args: unknown[]) => {
        const result = await Reflect.apply(nodeFs.rm, nodeFs, [file, ...args]);
        if (String(file) === `${pendingFile}.unconfirmed`) guardRemoved = true;
        return result;
      },
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (file !== canonicalPending || args[1] !== 'r') return handle;
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            if (guardRemoved) postGuardSynced = true;
          },
        });
      },
      lstat: async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
        if (postGuardSynced && String(file) === canonicalPending) {
          postGuardPendingLstats += 1;
          if (postGuardPendingLstats === 2) {
            failedOuterAssertion = true;
            throw Object.assign(new Error('post-commit directory assertion failed'), { code: 'EIO' });
          }
        }
        return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
      },
    });
    const writer = writerWithIdsV2(['command_post_commit_assertion', 'lease_post_commit_assertion'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Committed pair' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_post_commit_assertion' });
    expect(guardRemoved).toBe(true);
    expect(failedOuterAssertion).toBe(true);
    await expect(readFile(pendingFile, 'utf8')).resolves.toContain('command_post_commit_assertion');
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('cleans its exact schema-2 slot when a V1 pending record wins the final-name race', async () => {
    const commandId = 'command_v1_pending_race';
    const pendingFile = path.join(await nodeFs.realpath(pendingDir), `${commandId}.json`);
    const legacyPending = JSON.stringify({ schemaVersion: 1, commandId });
    let installed = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!installed && destination.endsWith('/0.slot')) {
          installed = true;
          await writeFile(pendingFile, legacyPending);
        }
      },
    });
    const writer = writerWithIdsV2([commandId, 'lease_pending_race', 'lease_pending_cleanup'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Collision' }] })
    ).resolves.toEqual({ status: 'unsupported_prototype_schema', commandId });
    expect(installed).toBe(true);
    await expect(readFile(pendingFile, 'utf8')).resolves.toBe(legacyPending);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
  });

  it('treats an exact schema-2 lease as pending for status and busy for apply', async () => {
    const leaseFile = path.join(slotsDir, '0.slot.lease');
    const lease = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      leaseId: 'existing_lease',
      owner: 'writer',
      commandId: 'existing_command',
      reservedAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
      acquiredAt: '2026-08-17T01:02:03.000Z',
      expiresAt: '2026-08-17T01:02:05.000Z',
    };
    await writeFile(leaseFile, JSON.stringify(lease));
    const writer = writerWithIdsV2(['new_command', 'new_lease']);

    await expect(writer.getStatus({ commandId: 'existing_command' })).resolves.toEqual({
      status: 'pending',
      commandId: 'existing_command',
    });
    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Busy' }] })
    ).resolves.toEqual({ status: 'busy', commandId: 'existing_command' });
    await expect(readFile(leaseFile, 'utf8')).resolves.toBe(JSON.stringify(lease));
  });

  it('fails closed without mutating a main V2 maintenance lease that owns no command', async () => {
    const leaseFile = path.join(slotsDir, '0.slot.lease');
    const manifestFile = path.join(projectDir, 'project.json');
    const leaseBytes = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      leaseId: 'main_maintenance_lease',
      owner: 'main',
      commandId: null,
      reservedAt: null,
      deadlineAt: null,
      acquiredAt: '2026-08-17T01:02:03.000Z',
      expiresAt: '2026-08-17T01:02:05.000Z',
    });
    await writeFile(leaseFile, leaseBytes);
    const manifestBytes = await readFile(manifestFile, 'utf8');
    const writer = writerWithIdsV2(['new_command_during_maintenance', 'new_writer_lease']);

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Wait for maintenance' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'new_command_during_maintenance' });
    await expect(readFile(leaseFile, 'utf8')).resolves.toBe(leaseBytes);
    await expect(readFile(manifestFile, 'utf8')).resolves.toBe(manifestBytes);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot.lease']);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(receiptsDir)).resolves.toEqual([]);
  });

  it.each([
    {
      label: 'V1',
      bytes: JSON.stringify({
        schemaVersion: 1,
        commandId: 'late_slot',
        reservedAt: '2026-08-17T01:02:03.000Z',
        deadlineAt: '2026-08-17T01:02:18.000Z',
      }),
      status: 'unsupported_prototype_schema',
    },
    { label: 'invalid V2', bytes: '{"schemaVersion":2}', status: 'storage_error' },
  ])('classifies a late $label slot installed after lease acquisition', async ({ bytes, status }) => {
    const slotFile = path.join(await nodeFs.realpath(slotsDir), '0.slot');
    let installed = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!installed && destination.endsWith('/0.slot.lease')) {
          installed = true;
          await writeFile(slotFile, bytes);
        }
      },
    });
    const writer = writerWithIdsV2(['command_late_slot', 'lease_late_slot'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Late slot' }] })
    ).resolves.toEqual({ status, commandId: 'command_late_slot' });
    expect(installed).toBe(true);
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(bytes);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot']);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it.each([
    {
      label: 'valid V2',
      bytes: JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        commandId: 'temp_race_v2_command',
        reservedAt: '2026-08-17T01:02:03.000Z',
        deadlineAt: '2026-08-17T01:02:18.000Z',
      }),
      expected: { status: 'busy', commandId: 'temp_race_v2_command' },
    },
    {
      label: 'V1',
      bytes: JSON.stringify({
        schemaVersion: 1,
        commandId: 'temp_race_v1_command',
        reservedAt: '2026-08-17T01:02:03.000Z',
        deadlineAt: '2026-08-17T01:02:18.000Z',
      }),
      expected: { status: 'unsupported_prototype_schema', commandId: 'command_temp_slot_race' },
    },
    {
      label: 'invalid V2',
      bytes: '{"schemaVersion":2}',
      expected: { status: 'storage_error', commandId: 'command_temp_slot_race' },
    },
  ])('classifies a $label slot raced in during V2 slot temp sync', async ({ bytes, expected }) => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const slotFile = path.join(canonicalSlots, '0.slot');
    let installed = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (
          installed ||
          !file.startsWith(`${slotFile}.`) ||
          file.startsWith(`${slotFile}.lease.`) ||
          !file.endsWith('.tmp')
        ) {
          return handle;
        }
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            await writeFile(slotFile, bytes);
            installed = true;
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_temp_slot_race', 'lease_temp_slot_race'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Late slot race' }] })
    ).resolves.toEqual(expected);
    expect(installed).toBe(true);
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(bytes);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot']);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it('rejects a non-file slot raced in during V2 slot temp sync', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const slotFile = path.join(canonicalSlots, '0.slot');
    let installed = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        const handle = await nodeFs.open(...args);
        if (
          installed ||
          !file.startsWith(`${slotFile}.`) ||
          file.startsWith(`${slotFile}.lease.`) ||
          !file.endsWith('.tmp')
        ) {
          return handle;
        }
        return bindMethods(handle, {
          sync: async () => {
            await handle.sync();
            await mkdir(slotFile);
            installed = true;
          },
        });
      },
    });
    const writer = writerWithIdsV2(['command_non_file_slot', 'lease_non_file_slot'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Unsafe slot' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_non_file_slot' });
    expect(installed).toBe(true);
    expect((await nodeFs.lstat(slotFile)).isDirectory()).toBe(true);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it.each([
    {
      label: 'valid V2',
      bytes: JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        leaseId: 'late_v2_lease',
        owner: 'writer',
        commandId: 'late_v2_command',
        reservedAt: '2026-08-17T01:02:03.000Z',
        deadlineAt: '2026-08-17T01:02:18.000Z',
        acquiredAt: '2026-08-17T01:02:03.000Z',
        expiresAt: '2026-08-17T01:02:05.000Z',
      }),
      status: 'busy',
      commandId: 'late_v2_command',
    },
    {
      label: 'V1',
      bytes: JSON.stringify({
        schemaVersion: 1,
        leaseId: 'late_legacy_lease',
        owner: 'writer',
        commandId: 'late_legacy_command',
        reservedAt: '2026-08-17T01:02:03.000Z',
        deadlineAt: '2026-08-17T01:02:18.000Z',
        acquiredAt: '2026-08-17T01:02:03.000Z',
        expiresAt: '2026-08-17T01:02:05.000Z',
      }),
      status: 'unsupported_prototype_schema',
      commandId: 'command_late_lease',
    },
    {
      label: 'main V2 without command authority',
      bytes: JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        leaseId: 'late_main_lease',
        owner: 'main',
        commandId: null,
        reservedAt: null,
        deadlineAt: null,
        acquiredAt: '2026-08-17T01:02:03.000Z',
        expiresAt: '2026-08-17T01:02:05.000Z',
      }),
      status: 'storage_error',
      commandId: 'command_late_lease',
    },
    {
      label: 'invalid V2',
      bytes: '{"schemaVersion":2}',
      status: 'storage_error',
      commandId: 'command_late_lease',
    },
  ])('classifies a late $label lease collision before slot publication', async ({ bytes, status, commandId }) => {
    const leaseFile = path.join(await nodeFs.realpath(slotsDir), '0.slot.lease');
    let installed = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        if (!installed && destination === leaseFile) {
          installed = true;
          await writeFile(leaseFile, bytes);
        }
        await nodeFs.link(source, destination);
      },
    });
    const writer = writerWithIdsV2(['command_late_lease', 'lease_late_lease'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Late lease' }] })
    ).resolves.toEqual({ status, commandId });
    expect(installed).toBe(true);
    await expect(readFile(leaseFile, 'utf8')).resolves.toBe(bytes);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot.lease']);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it('does not gate a committed pending record on slot state after releasing its lease', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const leaseFile = path.join(canonicalSlots, '0.slot.lease');
    const slotFile = path.join(canonicalSlots, '0.slot');
    const replacement = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'other_command',
      reservedAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
    };
    let replaced = false;
    const fs = bindMethods(nodeFs, {
      rm: async (file: string, ...args: unknown[]) => {
        const result = await Reflect.apply(nodeFs.rm, nodeFs, [file, ...args]);
        if (!replaced && file.startsWith(`${leaseFile}.`) && file.endsWith('.cleanup')) {
          replaced = true;
          await nodeFs.rm(slotFile);
          await writeFile(slotFile, JSON.stringify(replacement));
        }
        return result;
      },
    });
    const writer = writerWithIdsV2(['command_replaced_slot', 'lease_replaced_slot'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Must not publish' }] })
    ).resolves.toEqual({ status: 'unconfirmed', commandId: 'command_replaced_slot' });
    expect(replaced).toBe(true);
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(JSON.stringify(replacement));
    await expect(readFile(path.join(pendingDir, 'command_replaced_slot.json'), 'utf8')).resolves.toContain(
      'command_replaced_slot'
    );
  });

  it('restores a replacement V2 lease raced into exact lease release', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const leaseFile = path.join(canonicalSlots, '0.slot.lease');
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      leaseId: 'replacement_release_lease',
      owner: 'writer',
      commandId: 'replacement_release_command',
      reservedAt: '2026-08-17T01:02:03.000Z',
      deadlineAt: '2026-08-17T01:02:18.000Z',
      acquiredAt: '2026-08-17T01:02:03.000Z',
      expiresAt: '2026-08-17T01:02:05.000Z',
    });
    let replaced = false;
    const fs = bindMethods(nodeFs, {
      rename: async (source: Parameters<typeof nodeFs.rename>[0], destination: Parameters<typeof nodeFs.rename>[1]) => {
        if (!replaced && String(source) === leaseFile) {
          await nodeFs.rm(leaseFile);
          await writeFile(leaseFile, replacement);
          replaced = true;
        }
        await nodeFs.rename(source, destination);
      },
    });
    const writer = writerWithIdsV2(['command_release_lease_race', 'lease_release_lease_race'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Release lease race' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_release_lease_race' });
    expect(replaced).toBe(true);
    await expect(readFile(leaseFile, 'utf8')).resolves.toBe(replacement);
    await expect(readFile(path.join(pendingDir, 'command_release_lease_race.json'), 'utf8')).resolves.toContain(
      'command_release_lease_race'
    );
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot', '0.slot.lease']);
  });

  it('cleans its exact slot when an invalid V2 pending record wins the final-name race', async () => {
    const commandId = 'command_invalid_pending_race';
    const pendingFile = path.join(await nodeFs.realpath(pendingDir), `${commandId}.json`);
    const invalidPending = '{"schemaVersion":2}';
    let installed = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!installed && destination.endsWith('/0.slot')) {
          installed = true;
          await writeFile(pendingFile, invalidPending);
        }
      },
    });
    const writer = writerWithIdsV2([commandId, 'lease_invalid_pending', 'lease_invalid_cleanup'], { fs });

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Invalid collision' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId });
    await expect(readFile(pendingFile, 'utf8')).resolves.toBe(invalidPending);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
  });

  it('fails closed when the schema-2 manifest is missing', async () => {
    await rm(path.join(projectDir, 'project.json'));
    const writer = writerWithIdsV2(['missing_manifest_command', 'missing_manifest_lease']);

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Missing' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'missing_manifest_command' });
    await expect(writer.getStatus({ commandId: 'missing_manifest_status' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'missing_manifest_status',
    });
    await expect(readdir(slotsDir)).resolves.toEqual([]);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it.each([
    { label: 'malformed V2', manifest: '{"schemaVersion":2}' },
    { label: 'invalid JSON', manifest: '{' },
    {
      label: 'wrong-id V2',
      manifest: JSON.stringify(
        createEmptyStudioProjectV2(
          {
            name: 'Wrong identity',
            brief: '',
            aspectRatio: '16:9',
            targetDurationSeconds: 30,
            resolution: '1080p',
          },
          'other_project',
          new Date(START_MS).toISOString()
        )
      ),
    },
  ])('fails closed on a $label manifest before schema-2 sidecar IO', async ({ manifest }) => {
    await writeFile(path.join(projectDir, 'project.json'), manifest);
    const writer = writerWithIdsV2(['invalid_manifest_command', 'invalid_manifest_lease']);

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Invalid manifest' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'invalid_manifest_command' });
    await expect(writer.getStatus({ commandId: 'invalid_manifest_status' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'invalid_manifest_status',
    });
    await expect(readdir(slotsDir)).resolves.toEqual([]);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it('rejects unavailable config and structurally hostile schema-2 tool input before filesystem IO', async () => {
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('command_no_config')
      .mockReturnValueOnce('lease_no_config');
    const unavailable = createStudioDirectorCommandWriterV2(null, { createId, now: () => START_MS });
    await expect(
      unavailable.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'No config' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_no_config' });

    const hostileCreateId = vi.fn(() => 'must_not_mint');
    const hostile = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      { createId: hostileCreateId, now: () => START_MS }
    );
    await expect(hostile.apply({ expectedRevision: 7, operations: null } as never)).resolves.toEqual({
      status: 'storage_error',
      commandId: 'unavailable',
    });
    expect(hostileCreateId).not.toHaveBeenCalled();
  });

  it('rejects a same-root valid V2 revision regression after lease publication', async () => {
    const manifestFile = path.join(projectDir, 'project.json');
    const revisionOne = JSON.parse(await readFile(manifestFile, 'utf8')) as ReturnType<
      typeof createEmptyStudioProjectV2
    >;
    const revisionTwo = {
      ...revisionOne,
      revision: 2,
      updatedAt: new Date(START_MS + 1_000).toISOString(),
    };
    await writeFile(manifestFile, JSON.stringify(revisionTwo));
    let replaced = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!replaced && destination.endsWith('/0.slot.lease')) {
          replaced = true;
          const replacement = `${manifestFile}.revision-one`;
          await writeFile(replacement, JSON.stringify(revisionOne));
          await nodeFs.rename(replacement, manifestFile);
        }
      },
    });
    const writer = writerWithIdsV2(['command_revision_regression', 'lease_revision_regression'], { fs });

    await expect(
      writer.apply({ expectedRevision: 2, operations: [{ kind: 'set_brief', brief: 'Regressed' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_revision_regression' });
    expect(replaced).toBe(true);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it.each(['lease', 'slot'] as const)(
    'accepts a valid atomic V2 manifest replacement after %s publication and leaves stale CAS to main',
    async (phase) => {
      const manifestFile = path.join(projectDir, 'project.json');
      const initial = JSON.parse(await readFile(manifestFile, 'utf8')) as ReturnType<typeof createEmptyStudioProjectV2>;
      const committed = {
        ...initial,
        revision: initial.revision + 1,
        updatedAt: new Date(START_MS + 1_000).toISOString(),
      };
      let swapped = false;
      const fs = bindMethods(nodeFs, {
        link: async (source: string, destination: string) => {
          await nodeFs.link(source, destination);
          const expectedSuffix = phase === 'lease' ? '/0.slot.lease' : '/0.slot';
          if (!swapped && destination.endsWith(expectedSuffix)) {
            swapped = true;
            const replacement = `${manifestFile}.replacement`;
            await writeFile(replacement, JSON.stringify(committed));
            await nodeFs.rename(replacement, manifestFile);
          }
        },
      });
      const writer = writerWithIdsV2([`command_refresh_${phase}`, `lease_refresh_${phase}`], { fs });

      await expect(
        writer.apply({ expectedRevision: initial.revision, operations: [{ kind: 'set_brief', brief: 'Old CAS' }] })
      ).resolves.toEqual({ status: 'unconfirmed', commandId: `command_refresh_${phase}` });
      expect(swapped).toBe(true);
      const pending = JSON.parse(
        await readFile(path.join(pendingDir, `command_refresh_${phase}.json`), 'utf8')
      ) as StudioDirectorCommandRecordV2;
      expect(pending.expectedRevision).toBe(initial.revision);
      expect(JSON.parse(await readFile(manifestFile, 'utf8'))).toMatchObject({ revision: committed.revision });
    }
  );

  it('rejects a whole-project generation replacement while preserving both mailbox trees', async () => {
    const originalMoved = `${projectDir}.original`;
    const replacementDir = await mkdtemp(path.join(path.dirname(projectDir), 'studio-command-replacement-'));
    const replacementPending = path.join(replacementDir, 'commands', 'pending');
    const replacementSlots = path.join(replacementDir, 'commands', 'slots');
    const replacementReceipts = path.join(replacementDir, 'commands', 'receipts');
    await mkdir(replacementPending, { recursive: true });
    await mkdir(replacementSlots);
    await mkdir(replacementReceipts);
    const replacementProject = createEmptyStudioProjectV2(
      {
        name: 'Replacement generation',
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 30,
        resolution: '1080p',
      },
      PROJECT_ID,
      new Date(START_MS).toISOString()
    );
    await writeFile(path.join(replacementDir, 'project.json'), JSON.stringify(replacementProject));
    await writeFile(path.join(pendingDir, 'original.keep'), 'original');
    await writeFile(path.join(replacementPending, 'replacement.keep'), 'replacement');
    let swapped = false;
    const fs = bindMethods(nodeFs, {
      lstat: async (file: string, ...args: unknown[]) => {
        if (!swapped && file.endsWith('/0.slot.lease')) {
          swapped = true;
          await nodeFs.rename(projectDir, originalMoved);
          await nodeFs.rename(replacementDir, projectDir);
        }
        return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
      },
    });
    const writer = writerWithIdsV2(['command_root_swap', 'lease_root_swap'], { fs });

    try {
      await expect(
        writer.apply({ expectedRevision: 1, operations: [{ kind: 'set_brief', brief: 'Wrong generation' }] })
      ).resolves.toEqual({ status: 'storage_error', commandId: 'command_root_swap' });
      expect(swapped).toBe(true);
      await expect(readFile(path.join(originalMoved, 'commands', 'pending', 'original.keep'), 'utf8')).resolves.toBe(
        'original'
      );
      await expect(readFile(path.join(projectDir, 'commands', 'pending', 'replacement.keep'), 'utf8')).resolves.toBe(
        'replacement'
      );
      await expect(readdir(path.join(originalMoved, 'commands', 'slots'))).resolves.toEqual([]);
      await expect(readdir(path.join(projectDir, 'commands', 'slots'))).resolves.toEqual([]);
    } finally {
      await rm(originalMoved, { recursive: true, force: true });
    }
  });

  it('does not publish a V2 lease into a project generation swapped during lease temp creation', async () => {
    const originalMoved = `${projectDir}.lease-temp-original`;
    const replacementDir = await mkdtemp(path.join(path.dirname(projectDir), 'studio-command-lease-replacement-'));
    const replacementPending = path.join(replacementDir, 'commands', 'pending');
    const replacementSlots = path.join(replacementDir, 'commands', 'slots');
    const replacementReceipts = path.join(replacementDir, 'commands', 'receipts');
    await mkdir(replacementPending, { recursive: true });
    await mkdir(replacementSlots);
    await mkdir(replacementReceipts);
    await writeFile(
      path.join(replacementDir, 'project.json'),
      JSON.stringify(
        createEmptyStudioProjectV2(
          {
            name: 'Lease replacement generation',
            brief: '',
            aspectRatio: '16:9',
            targetDurationSeconds: 30,
            resolution: '1080p',
          },
          PROJECT_ID,
          new Date(START_MS).toISOString()
        )
      )
    );
    const leaseFile = path.join(await nodeFs.realpath(slotsDir), '0.slot.lease');
    let swapped = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        if (!swapped && file.startsWith(`${leaseFile}.`) && file.endsWith('.tmp')) {
          swapped = true;
          await nodeFs.rename(projectDir, originalMoved);
          await nodeFs.rename(replacementDir, projectDir);
        }
        return nodeFs.open(...args);
      },
    });
    const writer = writerWithIdsV2(['command_lease_temp_root_swap', 'lease_temp_root_swap'], { fs });

    try {
      await expect(
        writer.apply({ expectedRevision: 1, operations: [{ kind: 'set_brief', brief: 'Wrong lease generation' }] })
      ).resolves.toEqual({ status: 'storage_error', commandId: 'command_lease_temp_root_swap' });
      expect(swapped).toBe(true);
      await expect(readdir(path.join(originalMoved, 'commands', 'slots'))).resolves.toEqual([]);
      await expect(readdir(path.join(projectDir, 'commands', 'slots'))).resolves.toEqual([]);
      await expect(readdir(path.join(originalMoved, 'commands', 'pending'))).resolves.toEqual([]);
      await expect(readdir(path.join(projectDir, 'commands', 'pending'))).resolves.toEqual([]);
    } finally {
      await rm(originalMoved, { recursive: true, force: true });
      await rm(replacementDir, { recursive: true, force: true });
    }
  });

  it('rejects a conservatively oversized schema-2 command before minting any identity', async () => {
    const createId = vi.fn(() => 'must_not_be_minted');
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      { createId, now: () => START_MS }
    );

    await expect(
      writer.apply({
        expectedRevision: 7,
        operations: Array.from({ length: 32 }, (_, index) => ({
          kind: 'set_brief' as const,
          brief: `${index}`.padEnd(16 * 1024, 'x'),
        })),
      })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'unavailable' });
    expect(createId).not.toHaveBeenCalled();
    await expect(readdir(slotsDir)).resolves.toEqual([]);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it.each([
    { label: 'malformed V2', bytes: '{"schemaVersion":2}', expected: 'storage' },
    {
      label: 'V1',
      bytes: JSON.stringify({
        schemaVersion: 1,
        proposalId: 'legacy_proposal',
        reservedAt: '2026-08-17T01:02:03.000Z',
      }),
      expected: 'unsupported_prototype_schema',
    },
  ])('classifies an exact $label proposal slot before reserving another family slot', async ({ bytes, expected }) => {
    const slotFile = path.join(slotsDir, '1.slot');
    await writeFile(slotFile, bytes);

    await expect(
      writePendingRecordV2({
        pendingDir,
        recordId: 'proposal_new',
        record: { schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: 'proposal_new' },
        slotRecordKey: 'proposalId',
        capacityMessage: 'full',
        tooLargeMessage: 'too large',
      })
    ).rejects.toMatchObject({ code: expected });
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(bytes);
    await expect(readdir(slotsDir)).resolves.toEqual(['1.slot']);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
  });

  it('rescans the full pending family after reservation and rejects a late V1 slot without publishing', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const ownSlot = path.join(canonicalSlots, '0.slot');
    const legacySlot = path.join(canonicalSlots, '1.slot');
    const legacyBytes = JSON.stringify({
      schemaVersion: 1,
      proposalId: 'legacy_late',
      reservedAt: '2026-08-17T01:02:03.000Z',
    });
    let installed = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!installed && destination === ownSlot) {
          installed = true;
          await writeFile(legacySlot, legacyBytes);
        }
      },
    });

    await expect(
      writePendingRecordV2({
        pendingDir,
        recordId: 'proposal_raced',
        record: { schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: 'proposal_raced' },
        slotRecordKey: 'proposalId',
        capacityMessage: 'full',
        tooLargeMessage: 'too large',
        fs,
      })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    expect(installed).toBe(true);
    await expect(readFile(legacySlot, 'utf8')).resolves.toBe(legacyBytes);
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(slotsDir)).resolves.toEqual(['1.slot']);
  });

  it('quarantines and removes its exact slot when an identical pending record wins after reservation', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const ownSlot = path.join(canonicalSlots, '0.slot');
    const finalFile = path.join(canonicalPending, 'proposal_winner.json');
    const record = { schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: 'proposal_winner' };
    const serialized = JSON.stringify(record);
    let installed = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!installed && destination === ownSlot) {
          installed = true;
          await writeFile(finalFile, serialized);
        }
      },
    });

    await expect(
      writePendingRecordV2({
        pendingDir,
        recordId: record.id,
        record,
        slotRecordKey: 'proposalId',
        capacityMessage: 'full',
        tooLargeMessage: 'too large',
        fs,
      })
    ).rejects.toMatchObject({ code: 'storage' });
    expect(installed).toBe(true);
    await expect(readFile(finalFile, 'utf8')).resolves.toBe(serialized);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
  });

  it('restores a replacement slot raced into the quarantine cleanup window', async () => {
    const canonicalSlots = await nodeFs.realpath(slotsDir);
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const ownSlot = path.join(canonicalSlots, '0.slot');
    const finalFile = path.join(canonicalPending, 'proposal_cleanup_race.json');
    const record = { schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: 'proposal_cleanup_race' };
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      proposalId: 'replacement_proposal',
      reservedAt: '2026-08-17T01:02:03.000Z',
    });
    let installedPending = false;
    let installedReplacement = false;
    const fs = bindMethods(nodeFs, {
      link: async (source: string, destination: string) => {
        await nodeFs.link(source, destination);
        if (!installedPending && destination === ownSlot) {
          installedPending = true;
          await writeFile(finalFile, JSON.stringify(record));
        }
      },
      rename: async (source: string, destination: string) => {
        if (!installedReplacement && source === ownSlot && destination.endsWith('.cleanup')) {
          installedReplacement = true;
          await rm(ownSlot);
          await writeFile(ownSlot, replacement);
        }
        await nodeFs.rename(source, destination);
      },
    });

    await expect(
      writePendingRecordV2({
        pendingDir,
        recordId: record.id,
        record,
        slotRecordKey: 'proposalId',
        capacityMessage: 'full',
        tooLargeMessage: 'too large',
        fs,
      })
    ).rejects.toMatchObject({ code: 'storage' });
    expect(installedPending).toBe(true);
    expect(installedReplacement).toBe(true);
    await expect(readFile(ownSlot, 'utf8')).resolves.toBe(replacement);
    expect((await readdir(slotsDir)).filter((name) => name.endsWith('.cleanup'))).toEqual([]);
  });

  it('treats a cleanup failure after durable final publication as committed success', async () => {
    const finalFile = path.join(await nodeFs.realpath(pendingDir), 'proposal_committed.json');
    const fs = bindMethods(nodeFs, {
      rm: async (file: string, ...args: unknown[]) => {
        if (file.startsWith(`${finalFile}.`) && file.endsWith('.tmp')) {
          throw Object.assign(new Error('post-commit temp cleanup failed'), { code: 'EIO' });
        }
        return Reflect.apply(nodeFs.rm, nodeFs, [file, ...args]);
      },
    });

    await expect(
      writePendingRecordV2({
        pendingDir,
        recordId: 'proposal_committed',
        record: { schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: 'proposal_committed' },
        slotRecordKey: 'proposalId',
        capacityMessage: 'full',
        tooLargeMessage: 'too large',
        fs,
      })
    ).resolves.toMatchObject({ id: 'proposal_committed' });
    await expect(readFile(finalFile, 'utf8')).resolves.toContain('proposal_committed');
  });

  it('does not report success when the final inode is replaced during its parent-directory sync', async () => {
    const canonicalPending = await nodeFs.realpath(pendingDir);
    const finalFile = path.join(canonicalPending, 'proposal_replaced.json');
    const replacement = '{"schemaVersion":1,"replacement":true}';
    let replaced = false;
    const fs = bindMethods(nodeFs, {
      open: async (file: string, flags: string, ...args: unknown[]) => {
        const handle = await Reflect.apply(nodeFs.open, nodeFs, [file, flags, ...args]);
        if (file !== canonicalPending || flags !== 'r') return handle;
        return bindMethods(handle, {
          sync: async () => {
            if (!replaced) {
              replaced = true;
              await rm(finalFile);
              await writeFile(finalFile, replacement);
            }
            return handle.sync();
          },
        });
      },
    });

    await expect(
      writePendingRecordV2({
        pendingDir,
        recordId: 'proposal_replaced',
        record: { schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: 'proposal_replaced' },
        slotRecordKey: 'proposalId',
        capacityMessage: 'full',
        tooLargeMessage: 'too large',
        fs,
      })
    ).rejects.toMatchObject({ code: 'storage' });
    expect(replaced).toBe(true);
    await expect(readFile(finalFile, 'utf8')).resolves.toBe(replacement);
    await expect(readdir(slotsDir)).resolves.toEqual(['0.slot']);
  });

  it('rejects duplicate or unsafe minted schema-2 ids before touching the mailbox', async () => {
    const writer = writerWithIdsV2(['command_v2_bad', 'command_v2_bad']);
    await expect(
      writer.apply({
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_beat',
            beat: { title: 'Opening', action: '', look: '' },
            firstShot: shotInputV2('Opening'),
            beforeBeatId: null,
          },
        ],
      })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_v2_bad' });
    expect(await readdir(slotsDir)).toEqual([]);
    expect(await readdir(pendingDir)).toEqual([]);
  });

  it.each([
    { label: 'unsafe lease id', ids: ['command_v2_lease', 'unsafe/lease'], now: START_MS },
    { label: 'duplicate lease id', ids: ['command_v2_duplicate_lease', 'command_v2_duplicate_lease'], now: START_MS },
    { label: 'non-finite creation time', ids: ['command_v2_bad_time', 'lease_v2_bad_time'], now: Number.NaN },
  ])('rejects a $label before filesystem lookup', async ({ ids, now }) => {
    let filesystemCalls = 0;
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          filesystemCalls += 1;
          return Reflect.apply(value, target, args);
        };
      },
    });
    const values = [...ids];
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      { fs, now: () => now, createId: () => values.shift() ?? 'unused' }
    );

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Must not publish' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: ids[0] });
    expect(filesystemCalls).toBe(0);
  });

  it('returns exact V2 pending, missing, invalid, unsafe, and unavailable status outcomes', async () => {
    const publishing = writerWithIdsV2(['command_v2_pending', 'lease_v2_pending']);
    await publishing.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Pending' }] });
    const reader = writerWithIdsV2(['unused']);

    await expect(reader.getStatus({ commandId: 'command_v2_pending' })).resolves.toEqual({
      status: 'pending',
      commandId: 'command_v2_pending',
    });
    await expect(reader.getStatus({ commandId: 'missing_v2' })).resolves.toEqual({
      status: 'not_found',
      commandId: 'missing_v2',
    });
    await writeFile(path.join(receiptsDir, 'invalid_receipt.json'), '{"schemaVersion":2}');
    await expect(reader.getStatus({ commandId: 'invalid_receipt' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'invalid_receipt',
    });
    await writeFile(path.join(pendingDir, 'invalid_pending.json'), '{"schemaVersion":2}');
    await expect(reader.getStatus({ commandId: 'invalid_pending' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'invalid_pending',
    });
    await expect(reader.getStatus({ commandId: 'unsafe/id' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'unsafe/id',
    });
    await expect(createStudioDirectorCommandWriterV2(null).getStatus({ commandId: 'command_v2' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_v2',
    });

    await rm(receiptsDir, { recursive: true });
    await expect(reader.getStatus({ commandId: 'unavailable_receipts' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'unavailable_receipts',
    });
  });

  it('returns busy for an exact V2 slot and typed storage failure for an invalid slot', async () => {
    const first = writerWithIdsV2(['command_v2_first', 'lease_v2_first']);
    await first.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'First' }] });
    const second = writerWithIdsV2(['command_v2_second']);
    await expect(
      second.apply({ expectedRevision: 8, operations: [{ kind: 'set_brief', brief: 'Second' }] })
    ).resolves.toEqual({ status: 'busy', commandId: 'command_v2_first' });

    await rm(path.join(slotsDir, '0.slot'));
    await writeFile(path.join(slotsDir, '0.slot'), '{"schemaVersion":2}');
    const invalid = writerWithIdsV2(['command_v2_invalid_slot']);
    await expect(
      invalid.apply({ expectedRevision: 8, operations: [{ kind: 'set_brief', brief: 'Invalid slot' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_v2_invalid_slot' });
  });

  it('cleans only its exact V2 slot after an immutable pending collision', async () => {
    const existing = '{"existing":true}';
    await writeFile(path.join(pendingDir, 'command_v2_collision.json'), existing);
    const writer = writerWithIdsV2(['command_v2_collision', 'lease_v2_reservation', 'lease_v2_cleanup']);

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Collision' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId: 'command_v2_collision' });
    await expect(readFile(path.join(pendingDir, 'command_v2_collision.json'), 'utf8')).resolves.toBe(existing);
    await expect(readdir(slotsDir)).resolves.toEqual([]);
  });

  it('waits through an exact schema-2 receipt publication guard and returns the durable receipt', async () => {
    const commandId = 'command_v2_receipt_guard';
    const receiptFile = path.join(receiptsDir, `${commandId}.json`);
    const guardFile = `${receiptFile}.unconfirmed`;
    const receipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId,
      projectId: PROJECT_ID,
      expectedRevision: 7,
      decidedAt: '2026-08-17T01:02:04.000Z',
      status: 'applied',
      appliedRevision: 8,
      createdBeatIds: [],
      createdShotIds: [],
    };
    let currentMs = START_MS;
    let pollCount = 0;
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        now: () => currentMs,
        createId: (() => {
          const ids = [commandId, 'lease_v2_receipt_guard'];
          return () => ids.shift() ?? 'lease_v2_receipt_guard_fallback';
        })(),
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
          pollCount += 1;
          if (pollCount === 1) {
            await writeFile(guardFile, '1');
          } else if (pollCount === 2) {
            await writeFile(receiptFile, JSON.stringify(receipt));
            await rm(guardFile);
          }
        },
      }
    );

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Wait for receipt' }] })
    ).resolves.toEqual(receipt);
    expect(pollCount).toBe(2);
  });

  it('retries one atomic project-manifest replacement while reclassifying receipt publication', async () => {
    const canonicalProjectDir = await nodeFs.realpath(projectDir);
    const manifestFile = path.join(canonicalProjectDir, 'project.json');
    const canonicalReceipts = await nodeFs.realpath(receiptsDir);
    const commandId = 'command_v2_manifest_replace_poll';
    const receiptFile = path.join(canonicalReceipts, `${commandId}.json`);
    const guardFile = `${receiptFile}.unconfirmed`;
    const initialProject = JSON.parse(await readFile(manifestFile, 'utf8')) as ReturnType<
      typeof createEmptyStudioProjectV2
    >;
    const committedProject = {
      ...initialProject,
      revision: initialProject.revision + 1,
      updatedAt: new Date(START_MS + 1_000).toISOString(),
    };
    const receipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId,
      projectId: PROJECT_ID,
      expectedRevision: initialProject.revision,
      decidedAt: '2026-08-17T01:02:04.000Z',
      status: 'applied',
      appliedRevision: committedProject.revision,
      createdBeatIds: [],
      createdShotIds: [],
    };
    let racedManifestRead = false;
    const fs = bindMethods(nodeFs, {
      open: async (...args: Parameters<typeof nodeFs.open>) => {
        const file = String(args[0]);
        if (file === manifestFile && existsSync(guardFile) && !racedManifestRead) {
          racedManifestRead = true;
          const replacement = `${manifestFile}.replacement`;
          await writeFile(replacement, JSON.stringify(committedProject));
          await nodeFs.rename(replacement, manifestFile);
        }
        return nodeFs.open(...args);
      },
    });
    let currentMs = START_MS;
    let pollCount = 0;
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        fs,
        now: () => currentMs,
        createId: (() => {
          const ids = [commandId, 'lease_v2_manifest_replace_poll'];
          return () => ids.shift() ?? 'lease_v2_manifest_replace_poll_fallback';
        })(),
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
          pollCount += 1;
          if (pollCount === 1) {
            await writeFile(guardFile, '1');
          } else if (pollCount === 2) {
            await writeFile(receiptFile, JSON.stringify(receipt));
            await rm(guardFile);
          }
        },
      }
    );

    await expect(
      writer.apply({
        expectedRevision: initialProject.revision,
        operations: [{ kind: 'set_brief', brief: 'Survive adjacent manifest commit' }],
      })
    ).resolves.toEqual(receipt);
    expect(racedManifestRead).toBe(true);
    expect(pollCount).toBe(2);
  });

  it.each([
    {
      label: 'schema-1',
      manifest: '{"schemaVersion":1}',
      expectedStatus: 'unsupported_prototype_schema',
    },
    { label: 'malformed schema-2', manifest: '{"schemaVersion":2}', expectedStatus: 'storage_error' },
    { label: 'missing', manifest: null, expectedStatus: 'storage_error' },
  ] as const)(
    'keeps a stable $label manifest fail-closed during receipt publication',
    async ({ manifest, expectedStatus }) => {
      const commandId = `command_v2_stable_manifest_${expectedStatus}_${manifest === null ? 'missing' : manifest.length}`;
      const manifestFile = path.join(projectDir, 'project.json');
      const guardFile = path.join(receiptsDir, `${commandId}.json.unconfirmed`);
      const originalProject = JSON.parse(await readFile(manifestFile, 'utf8')) as ReturnType<
        typeof createEmptyStudioProjectV2
      >;
      let currentMs = START_MS;
      let changedManifest = false;
      const writer = createStudioDirectorCommandWriterV2(
        { projectId: PROJECT_ID, projectDir },
        {
          now: () => currentMs,
          createId: (() => {
            const ids = [commandId, `lease_${commandId}`];
            return () => ids.shift() ?? `lease_${commandId}_fallback`;
          })(),
          sleep: async (milliseconds) => {
            currentMs += milliseconds;
            if (changedManifest) return;
            changedManifest = true;
            await writeFile(guardFile, '1');
            if (manifest === null) await rm(manifestFile);
            else await writeFile(manifestFile, manifest);
          },
        }
      );

      await expect(
        writer.apply({
          expectedRevision: originalProject.revision,
          operations: [{ kind: 'set_brief', brief: 'Stable invalid authority' }],
        })
      ).resolves.toEqual({ status: expectedStatus, commandId });
      expect(changedManifest).toBe(true);
    }
  );

  it.each(['guard', 'receipt'] as const)('rejects a symlinked receipt publication %s during polling', async (kind) => {
    const commandId = `command_v2_unsafe_${kind}`;
    const receiptFile = path.join(receiptsDir, `${commandId}.json`);
    const guardFile = `${receiptFile}.unconfirmed`;
    let currentMs = START_MS;
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        now: () => currentMs,
        createId: (() => {
          const ids = [commandId, `lease_v2_unsafe_${kind}`];
          return () => ids.shift() ?? `lease_v2_unsafe_${kind}_fallback`;
        })(),
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
          if (kind === 'guard') {
            await symlink(path.join(projectDir, 'project.json'), guardFile);
          } else {
            await writeFile(guardFile, '1');
            await symlink(path.join(projectDir, 'project.json'), receiptFile);
          }
        },
      }
    );

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Unsafe receipt' }] })
    ).resolves.toEqual({ status: 'storage_error', commandId });
  });

  it.each([
    {
      label: 'valid',
      receipt: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        commandId: 'command_v2_polled_valid',
        projectId: PROJECT_ID,
        expectedRevision: 7,
        decidedAt: '2026-08-17T01:02:04.000Z',
        status: 'applied',
        appliedRevision: 8,
        createdBeatIds: [],
        createdShotIds: [],
      },
      expected: { status: 'applied', appliedRevision: 8 },
    },
    {
      label: 'legacy',
      receipt: {
        schemaVersion: 1,
        commandId: 'command_v2_polled_legacy',
        projectId: PROJECT_ID,
        expectedRevision: 7,
        decidedAt: '2026-08-17T01:02:04.000Z',
        status: 'applied',
        appliedRevision: 8,
        createdSceneIds: [],
      },
      expected: { status: 'unsupported_prototype_schema' },
    },
    {
      label: 'invalid',
      receipt: { schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION },
      expected: { status: 'storage_error' },
    },
  ])('stops polling on a $label exact-name receipt', async ({ label, receipt, expected }) => {
    const commandId = `command_v2_polled_${label}`;
    let currentMs = START_MS;
    let wroteReceipt = false;
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: PROJECT_ID, projectDir },
      {
        now: () => currentMs,
        createId: (() => {
          const ids = [commandId, `lease_v2_polled_${label}`];
          return () => ids.shift() ?? 'lease_v2_fallback';
        })(),
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
          if (!wroteReceipt) {
            wroteReceipt = true;
            await writeFile(path.join(receiptsDir, `${commandId}.json`), JSON.stringify(receipt));
          }
        },
      }
    );

    await expect(
      writer.apply({ expectedRevision: 7, operations: [{ kind: 'set_brief', brief: `Poll ${label}` }] })
    ).resolves.toMatchObject({ commandId, ...expected });
    expect(wroteReceipt).toBe(true);
  });
});
