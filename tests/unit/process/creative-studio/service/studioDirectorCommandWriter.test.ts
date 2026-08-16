/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { promises as nodeFs } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandSlotV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandWriter,
  type StudioApplyEditsInput,
  type StudioDirectorCommandWriterDeps,
} from '@process/resources/builtinMcp/studioDirectorCommandWriter';

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
    return createStudioDirectorCommandWriter(
      { projectId: PROJECT_ID, projectDir },
      {
        now: () => currentMs,
        createId: () => nextIds.shift() ?? 'unexpected_extra_id',
        sleep: async (milliseconds) => {
          currentMs += milliseconds;
        },
        ...overrides,
      }
    );
  };

  it('mints stable safe ids once, preserves operation order, and publishes one exact 15-second command', async () => {
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('command_1')
      .mockReturnValueOnce('scene_new_a')
      .mockReturnValueOnce('scene_new_b');
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
    expect(createId).toHaveBeenCalledTimes(3);
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
    const slotGuard = `${slotFile}.unconfirmed`;
    const newerSlot: StudioDirectorCommandSlotV1 = {
      schemaVersion: 1,
      commandId: 'command_newer_after_validation',
      reservedAt: '2026-08-17T01:02:04.000Z',
      deadlineAt: '2026-08-17T01:02:19.000Z',
    };
    let originalSlotReadComplete = false;
    let slotGuardOpenCount = 0;
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
      if (file === slotGuard) {
        slotGuardOpenCount += 1;
        if (originalSlotReadComplete && slotGuardOpenCount > 1) await replaceWithNewerSlot();
      }
      if (file !== slotFile || originalSlotReadComplete) return handle;
      return bindMethods(handle, {
        close: async () => {
          await handle.close();
          originalSlotReadComplete = true;
        },
      });
    };
    const lstat = async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
      if (!replaced && originalSlotReadComplete && slotGuardOpenCount === 1 && String(file) === canonicalSlotsDir) {
        await replaceWithNewerSlot();
      }
      return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
    };
    const fs = bindMethods(nodeFs, { lstat, open });
    const writer = writerWithIds(['command_collision'], { fs });

    await expect(writer.apply(setBriefInput())).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_collision',
    });

    expect(replaced).toBe(true);
    expect(slotGuardOpenCount).toBe(2);
    await expect(readFile(slotFile, 'utf8')).resolves.toBe(JSON.stringify(newerSlot));
    expect(await readdir(slotsDir)).toEqual(['0.slot']);
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
});
