/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, promises as nodeFs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  type CreateStudioProjectInputV2,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV2,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandProcessorV2,
  createStudioDirectorCommitTrackerV2,
  type StudioDirectorCommandProcessorV2,
  type StudioDirectorCommitTrackerV2,
} from '@process/services/creative-studio/service/directorCommandProcessor';
import {
  StudioDirectorCommandApplyErrorV2,
  type StudioDirectorCommandServiceV2,
} from '@process/services/creative-studio/service/directorCommandService';
import {
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandMailboxV2,
} from '@process/services/creative-studio/service/directorCommandMailbox';
import { createStudioDirectorCommandServiceV2 } from '@process/services/creative-studio/service/directorCommandService';
import { createCreativeStudioStore, CreativeStudioStoreError } from '@process/services/creative-studio/store';

const NOW_MS = Date.parse('2026-08-16T12:00:10.000Z');
const COMMITTED_AT = '2026-08-16T12:00:10.125Z';

const makeInput = (name: string): CreateStudioProjectInputV2 => ({
  name,
  brief: 'A real Director command boundary',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
});

const realCommandDirectories = (rootDir: string, projectId: string) => {
  const root = path.join(rootDir, projectId, 'commands');
  return {
    root,
    pending: path.join(root, 'pending'),
    slots: path.join(root, 'slots'),
    receipts: path.join(root, 'receipts'),
  };
};

const snapshotDirectoryBytes = async (root: string): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    const entries = (await nodeFs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
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

const publishRealPendingV2 = async (input: {
  rootDir: string;
  projectId: string;
  commandId: string;
  pending: unknown;
}): Promise<void> => {
  const directories = realCommandDirectories(input.rootDir, input.projectId);
  await nodeFs.writeFile(
    path.join(directories.pending, `${input.commandId}.json`),
    typeof input.pending === 'string' ? input.pending : JSON.stringify(input.pending)
  );
  await nodeFs.writeFile(
    path.join(directories.slots, '0.slot'),
    JSON.stringify({
      schemaVersion: 2,
      commandId: input.commandId,
      reservedAt: '2026-08-16T12:00:00.000Z',
      deadlineAt: '2026-08-16T12:00:15.000Z',
    })
  );
};

const keyOf = (projectId: string, commandId: string): string => `${projectId}/${commandId}`;

const page = (items: Array<{ projectId: string; commandId: string }>, nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

type ManualInterval = { callback: () => void; delayMs: number; cleared: boolean };

const makeCommandV2 = (
  projectId = 'project_v2',
  commandId = 'command_v2',
  overrides: Partial<StudioDirectorCommandRecordV2> = {}
): StudioDirectorCommandRecordV2 => ({
  schemaVersion: 2,
  commandId,
  projectId,
  expectedRevision: 1,
  createdAt: '2026-08-16T12:00:00.000Z',
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A bounded schema-2 edit' }],
  ...overrides,
});

const makeProjectV2 = (projectId = 'project_v2', revision = 1): StudioProjectV2 =>
  ({
    id: projectId,
    revision,
    updatedAt: revision === 1 ? '2026-08-16T12:00:00.000Z' : COMMITTED_AT,
  }) as StudioProjectV2;

type HarnessV2 = {
  processor: StudioDirectorCommandProcessorV2;
  tracker: StudioDirectorCommitTrackerV2;
  mailbox: StudioDirectorCommandMailboxV2;
  pendings: Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readPending']>>>;
  receiptReads: Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readReceipt']>>>;
  receipts: Map<string, StudioDirectorCommandReceiptV2>;
  projects: Map<string, StudioProjectV2 | 'unsupported_prototype_schema'>;
  serviceApply: ReturnType<typeof vi.fn<StudioDirectorCommandServiceV2['apply']>>;
  writeReceipt: ReturnType<typeof vi.fn<(projectId: string, receipt: StudioDirectorCommandReceiptV2) => Promise<void>>>;
  finish: ReturnType<typeof vi.fn<(projectId: string, commandId: string) => Promise<void>>>;
  notify: ReturnType<typeof vi.fn<(projectId: string) => void>>;
  releaseOrphans: ReturnType<typeof vi.fn<StudioDirectorCommandMailboxV2['releaseOrphanedSlotsPage']>>;
  pruneReceipts: ReturnType<typeof vi.fn<StudioDirectorCommandMailboxV2['pruneReceiptsPage']>>;
  intervals: ManualInterval[];
  emitWatch(projectId: string, commandId?: string): void;
  failNextReceiptWrites(count?: number): void;
  failNextFinishes(count?: number): void;
};

const createHarnessV2 = (
  input: {
    nowMs?: number;
    startupRefs?: Array<{ projectId: string; commandId: string }>;
    serviceApply?: StudioDirectorCommandServiceV2['apply'];
  } = {}
): HarnessV2 => {
  const pendings = new Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readPending']>>>();
  const receiptReads = new Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readReceipt']>>>();
  const receipts = new Map<string, StudioDirectorCommandReceiptV2>();
  const projects = new Map<string, StudioProjectV2 | 'unsupported_prototype_schema'>();
  const tracker = createStudioDirectorCommitTrackerV2();
  const intervals: ManualInterval[] = [];
  let watcher: ((projectId: string, commandId?: string) => void) | null = null;
  let remainingReceiptFailures = 0;
  let remainingFinishFailures = 0;
  const writeReceipt = vi.fn(async (projectId: string, receipt: StudioDirectorCommandReceiptV2) => {
    if (remainingReceiptFailures > 0) {
      remainingReceiptFailures -= 1;
      throw new CreativeStudioStoreError('storage_error', 'receipt write failed');
    }
    receipts.set(keyOf(projectId, receipt.commandId), structuredClone(receipt));
    receiptReads.set(keyOf(projectId, receipt.commandId), { status: 'valid', record: structuredClone(receipt) });
  });
  const finish = vi.fn(async (projectId: string, commandId: string) => {
    if (remainingFinishFailures > 0) {
      remainingFinishFailures -= 1;
      throw new CreativeStudioStoreError('storage_error', 'cleanup failed');
    }
    pendings.delete(keyOf(projectId, commandId));
  });
  const releaseOrphans = vi.fn(async (_cursor: string | null, _now: string, _limit: number) => ({
    processed: 0,
    nextCursor: null,
  }));
  const pruneReceipts = vi.fn(async (_cursor: string | null, _before: string, _limit: number) => ({
    processed: 0,
    nextCursor: null,
  }));
  const mailbox: StudioDirectorCommandMailboxV2 = {
    ensure: vi.fn(async () => undefined),
    snapshotPendingPage: vi.fn(async (cursor) => (cursor === null ? page(input.startupRefs ?? []) : page([]))),
    readPending: vi.fn(async (projectId, commandId) => pendings.get(keyOf(projectId, commandId)) ?? null),
    readReceipt: vi.fn(async (projectId, commandId) => receiptReads.get(keyOf(projectId, commandId)) ?? null),
    writeReceipt,
    finish,
    listPendingPage: vi.fn(async () =>
      page(
        [...pendings.entries()].map(([key]) => {
          const [projectId, commandId] = key.split('/');
          return { projectId: projectId!, commandId: commandId! };
        })
      )
    ),
    releaseOrphanedSlotsPage: releaseOrphans,
    pruneReceiptsPage: pruneReceipts,
    watch: vi.fn(async (trigger) => {
      watcher = trigger;
      return vi.fn(() => {
        watcher = null;
      });
    }),
    dispose: vi.fn(async () => undefined),
  };
  const defaultApply: StudioDirectorCommandServiceV2['apply'] = async (command) => {
    const project = makeProjectV2(command.projectId, command.expectedRevision + 1);
    projects.set(command.projectId, project);
    return {
      project,
      appliedRevision: project.revision,
      createdBeatIds: command.operations
        .filter((operation) => operation.kind === 'add_beat')
        .map((operation) => operation.beatId),
      createdShotIds: command.operations.flatMap((operation) =>
        operation.kind === 'add_shot' ? [operation.shotId] : []
      ),
    };
  };
  const serviceApply = vi.fn(input.serviceApply ?? defaultApply);
  const notify = vi.fn<(projectId: string) => void>();
  const processor = createStudioDirectorCommandProcessorV2({
    store: {
      getProjectV2: async (projectId) => {
        const project = projects.get(projectId);
        if (project === undefined) return { status: 'not_found', projectId };
        if (project === 'unsupported_prototype_schema') return { status: 'unsupported_prototype_schema', projectId };
        return { status: 'supported', project };
      },
    },
    mailbox,
    service: { apply: serviceApply },
    tracker,
    onProjectUpdated: notify,
    now: () => input.nowMs ?? NOW_MS,
    setInterval: (callback, delayMs) => {
      const interval = { callback, delayMs, cleared: false };
      intervals.push(interval);
      return interval;
    },
    clearInterval: (interval) => {
      (interval as ManualInterval).cleared = true;
    },
    logError: vi.fn(),
  });
  return {
    processor,
    tracker,
    mailbox,
    pendings,
    receiptReads,
    receipts,
    projects,
    serviceApply,
    writeReceipt,
    finish,
    notify,
    releaseOrphans,
    pruneReceipts,
    intervals,
    emitWatch(projectId, commandId) {
      watcher?.(projectId, commandId);
    },
    failNextReceiptWrites(count = 1) {
      remainingReceiptFailures = count;
    },
    failNextFinishes(count = 1) {
      remainingFinishFailures = count;
    },
  };
};

const addLiveCommandV2 = (harness: HarnessV2, command: StudioDirectorCommandRecordV2): void => {
  harness.projects.set(command.projectId, makeProjectV2(command.projectId, command.expectedRevision));
  harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });
};

const waitForReceiptV2 = async (
  harness: HarnessV2,
  projectId = 'project_v2',
  commandId = 'command_v2'
): Promise<StudioDirectorCommandReceiptV2> => {
  await vi.waitFor(() => expect(harness.receipts.has(keyOf(projectId, commandId))).toBe(true));
  return harness.receipts.get(keyOf(projectId, commandId))!;
};

describe('Studio Director schema-2 commit tracker', () => {
  it('materializes ordered beat and shot identities only for the exact tagged commit', () => {
    const tracker = createStudioDirectorCommitTrackerV2();
    const command = makeCommandV2('project_v2', 'command_v2', {
      operations: [
        {
          kind: 'add_beat',
          beatId: 'section_1',
          beat: { title: '', action: '', look: '', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_1',
          shot: {
            line: '',
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
          },
          beforeShotId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_2',
          shot: {
            line: '',
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
          },
          beforeShotId: null,
        },
      ],
    });
    tracker.expect(command);
    tracker.observe({
      projectId: command.projectId,
      previousRevision: 1,
      committedRevision: 2,
      committedAt: COMMITTED_AT,
      commitTag: command.commandId,
    });

    expect(tracker.pendingReceipt(command.projectId, command.commandId)).toEqual({
      schemaVersion: 2,
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: 1,
      decidedAt: COMMITTED_AT,
      status: 'applied',
      appliedRevision: 2,
      createdBeatIds: ['section_1'],
      createdShotIds: ['clip_1', 'clip_2'],
    });
  });

  it('ignores untagged, mismatched, duplicate, and post-terminal observations', () => {
    const tracker = createStudioDirectorCommitTrackerV2();
    const command = makeCommandV2();
    tracker.expect(command);
    tracker.expect(command);
    tracker.observe({
      projectId: command.projectId,
      previousRevision: 1,
      committedRevision: 2,
      committedAt: COMMITTED_AT,
      commitTag: null,
    });
    tracker.observe({
      projectId: command.projectId,
      previousRevision: 0,
      committedRevision: 1,
      committedAt: COMMITTED_AT,
      commitTag: command.commandId,
    });
    expect(tracker.pendingReceipt(command.projectId, command.commandId)).toBeNull();

    const terminal: StudioDirectorCommandReceiptV2 = {
      schemaVersion: 2,
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: 1,
      decidedAt: COMMITTED_AT,
      status: 'rejected',
      observedRevision: 1,
      reasonCode: 'validation_failed',
    };
    tracker.materialize(terminal);
    tracker.materialize({ ...terminal, reasonCode: 'invalid_operation' });
    tracker.expect(command);

    expect(tracker.pendingReceipt(command.projectId, command.commandId)).toEqual(terminal);
  });
});

describe('Studio Director schema-2 command processor', () => {
  it('writes one exact applied receipt, cleans once, and notifies exactly once', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const command = makeCommandV2();
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({
      schemaVersion: 2,
      status: 'applied',
      appliedRevision: 2,
      createdBeatIds: [],
      createdShotIds: [],
    });
    expect(harness.serviceApply).toHaveBeenCalledOnce();
    expect(harness.finish).toHaveBeenCalledExactlyOnceWith(command.projectId, command.commandId);
    expect(harness.notify).toHaveBeenCalledExactlyOnceWith(command.projectId);
    await harness.processor.stop();
  });

  it('repairs an observer-proven commit after a failed receipt write without replaying CAS', async () => {
    let tracker!: StudioDirectorCommitTrackerV2;
    const harness = createHarnessV2({
      serviceApply: async (command) => {
        const committed = makeProjectV2(command.projectId, command.expectedRevision + 1);
        harness.projects.set(command.projectId, committed);
        tracker.observe({
          projectId: command.projectId,
          previousRevision: command.expectedRevision,
          committedRevision: committed.revision,
          committedAt: committed.updatedAt,
          commitTag: command.commandId,
        });
        throw new CreativeStudioStoreError('storage_error', 'post-commit summary repair failed');
      },
    });
    tracker = harness.tracker;
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());
    harness.failNextReceiptWrites();

    harness.processor.trigger('project_v2', 'command_v2');
    await vi.waitFor(() => expect(harness.writeReceipt).toHaveBeenCalledOnce());
    expect(harness.receipts.size).toBe(0);
    expect(harness.tracker.pendingReceipt('project_v2', 'command_v2')).toMatchObject({ status: 'applied' });

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status: 'applied', appliedRevision: 2, decidedAt: COMMITTED_AT });
    expect(harness.serviceApply).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenCalledOnce();
    await harness.processor.stop();
  });

  it('retains the applied marker until failed finish cleanup is repaired', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());
    harness.failNextFinishes();

    harness.processor.trigger('project_v2', 'command_v2');
    await waitForReceiptV2(harness);
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledOnce());
    expect(harness.tracker.pendingReceipt('project_v2', 'command_v2')).toMatchObject({ status: 'applied' });
    expect(harness.notify).not.toHaveBeenCalled();

    harness.processor.trigger('project_v2', 'command_v2');
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledTimes(2));

    expect(harness.serviceApply).toHaveBeenCalledOnce();
    expect(harness.tracker.pendingReceipt('project_v2', 'command_v2')).toBeNull();
    expect(harness.notify).toHaveBeenCalledOnce();
    await harness.processor.stop();
  });

  it('performs receipt-only restart cleanup without notification', async () => {
    const ref = { projectId: 'project_v2', commandId: 'command_v2' };
    const harness = createHarnessV2({ startupRefs: [ref] });
    const command = makeCommandV2();
    harness.pendings.set(keyOf(ref.projectId, ref.commandId), { status: 'valid', record: command });
    harness.receiptReads.set(keyOf(ref.projectId, ref.commandId), {
      status: 'valid',
      record: {
        schemaVersion: 2,
        commandId: ref.commandId,
        projectId: ref.projectId,
        expectedRevision: 1,
        decidedAt: COMMITTED_AT,
        status: 'applied',
        appliedRevision: 2,
        createdBeatIds: [],
        createdShotIds: [],
      },
    });

    await harness.processor.start();
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledWith(ref.projectId, ref.commandId));

    expect(harness.serviceApply).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('retains restart authority after an invalid durable receipt is removed', async () => {
    const ref = { projectId: 'project_v2', commandId: 'command_v2' };
    const harness = createHarnessV2({ startupRefs: [ref] });
    const command = makeCommandV2();
    harness.projects.set(ref.projectId, makeProjectV2(ref.projectId, command.expectedRevision));
    harness.pendings.set(keyOf(ref.projectId, ref.commandId), { status: 'valid', record: command });
    harness.receiptReads.set(keyOf(ref.projectId, ref.commandId), { status: 'invalid' });

    await harness.processor.start();
    await vi.waitFor(() => expect(harness.mailbox.readReceipt).toHaveBeenCalled());
    harness.receiptReads.delete(keyOf(ref.projectId, ref.commandId));
    harness.processor.trigger(ref.projectId, ref.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status: 'expired', reasonCode: 'expired_after_restart' });
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('notifies an applied command once while preserving a successor published during finish', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const commandA = makeCommandV2('project_v2', 'command_a');
    const commandB = makeCommandV2('project_v2', 'command_b', { expectedRevision: 2 });
    addLiveCommandV2(harness, commandA);
    harness.finish.mockImplementationOnce(async (projectId, commandId) => {
      harness.pendings.delete(keyOf(projectId, commandId));
      harness.pendings.set(keyOf(projectId, commandB.commandId), { status: 'valid', record: commandB });
    });

    harness.processor.trigger(commandA.projectId, commandA.commandId);
    await waitForReceiptV2(harness, commandA.projectId, commandA.commandId);
    await vi.waitFor(() => expect(harness.notify).toHaveBeenCalledOnce());

    expect(harness.pendings.get(keyOf(commandB.projectId, commandB.commandId))).toEqual({
      status: 'valid',
      record: commandB,
    });
    expect(harness.notify).toHaveBeenCalledExactlyOnceWith(commandA.projectId);
    await harness.processor.stop();
  });

  it('serializes watcher and sweep duplicates on its schema-2 project queue', async () => {
    let releaseApply!: () => void;
    const applyBlocked = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const harness = createHarnessV2({
      serviceApply: async (command) => {
        await applyBlocked;
        return {
          project: makeProjectV2(command.projectId, 2),
          appliedRevision: 2,
          createdBeatIds: [],
          createdShotIds: [],
        };
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.emitWatch('project_v2', 'command_v2');
    harness.intervals.find(({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS)?.callback();
    await vi.waitFor(() => expect(harness.serviceApply).toHaveBeenCalledOnce());
    releaseApply();
    await waitForReceiptV2(harness);
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledTimes(2));

    expect(harness.serviceApply).toHaveBeenCalledOnce();
    await harness.processor.stop();
  });

  it('runs independent schema-2 project queues concurrently', async () => {
    let active = 0;
    let maximumActive = 0;
    const releases = new Map<string, () => void>();
    const harness = createHarnessV2({
      serviceApply: async (command) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.set(command.projectId, resolve));
        active -= 1;
        return {
          project: makeProjectV2(command.projectId, 2),
          appliedRevision: 2,
          createdBeatIds: [],
          createdShotIds: [],
        };
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2('project_a', 'command_a'));
    addLiveCommandV2(harness, makeCommandV2('project_b', 'command_b'));

    harness.processor.trigger('project_a', 'command_a');
    harness.processor.trigger('project_b', 'command_b');
    await vi.waitFor(() => expect(releases.size).toBe(2));
    expect(maximumActive).toBe(2);
    releases.get('project_a')?.();
    releases.get('project_b')?.();
    await Promise.all([
      waitForReceiptV2(harness, 'project_a', 'command_a'),
      waitForReceiptV2(harness, 'project_b', 'command_b'),
    ]);
    await harness.processor.stop();
  });

  it('owns schema-2 sweep and maintenance cadences and disposes once', async () => {
    const harness = createHarnessV2();
    await Promise.all([harness.processor.start(), harness.processor.start()]);

    expect(harness.intervals.map(({ delayMs }) => delayMs).toSorted((a, b) => a - b)).toEqual([
      STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
      STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS,
    ]);
    const pendingTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS
    )!.callback;
    const maintenanceTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS
    )!.callback;
    pendingTick();
    pendingTick();
    maintenanceTick();
    maintenanceTick();
    harness.emitWatch('project_v2');
    harness.processor.trigger('project_v2');
    await vi.waitFor(() => expect(harness.releaseOrphans).toHaveBeenCalledOnce());
    expect(harness.pruneReceipts).toHaveBeenCalledOnce();

    await Promise.all([harness.processor.stop(), harness.processor.stop()]);

    expect(harness.intervals.every(({ cleared }) => cleared)).toBe(true);
    expect(harness.mailbox.dispose).toHaveBeenCalledOnce();
  });

  it('resets failed schema-2 cursor sessions before retrying maintenance and pending sweeps', async () => {
    const ref = { projectId: 'project_v2', commandId: 'command_v2' };
    const harness = createHarnessV2();
    const listPendingPage = vi.mocked(harness.mailbox.listPendingPage);
    listPendingPage
      .mockResolvedValueOnce(page([], 'pending-token'))
      .mockRejectedValueOnce(new CreativeStudioStoreError('storage_error', 'closed pending cursor'))
      .mockImplementationOnce(async (cursor) => (cursor === null ? page([ref]) : page([])));
    harness.releaseOrphans
      .mockResolvedValueOnce({ processed: 0, nextCursor: 'slot-token' })
      .mockRejectedValueOnce(new CreativeStudioStoreError('storage_error', 'closed slot cursor'))
      .mockResolvedValueOnce({ processed: 0, nextCursor: null });
    harness.pruneReceipts
      .mockResolvedValueOnce({ processed: 0, nextCursor: 'receipt-token' })
      .mockRejectedValueOnce(new CreativeStudioStoreError('storage_error', 'closed receipt cursor'))
      .mockResolvedValueOnce({ processed: 0, nextCursor: null });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());
    const pendingTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS
    )!.callback;
    const maintenanceTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS
    )!.callback;

    for (let callCount = 1; callCount <= 3; callCount += 1) {
      pendingTick();
      maintenanceTick();
      // eslint-disable-next-line no-await-in-loop
      await vi.waitFor(() => expect(harness.releaseOrphans).toHaveBeenCalledTimes(callCount));
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(listPendingPage.mock.calls.slice(0, 3).map(([cursor]) => cursor)).toEqual([null, 'pending-token', null]);
    expect(harness.releaseOrphans.mock.calls.map(([cursor]) => cursor)).toEqual([null, 'slot-token', null]);
    expect(harness.pruneReceipts.mock.calls.map(([cursor]) => cursor)).toEqual([null, 'receipt-token', null]);
    await expect(waitForReceiptV2(harness)).resolves.toMatchObject({ status: 'applied' });
    await harness.processor.stop();
  });

  it.each([
    ['durable receipt', 'receipt'],
    ['pending command', 'pending'],
    ['project manifest', 'project'],
  ] as const)('leaves an unsupported schema-1 %s byte authority untouched', async (_label, authority) => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const command = makeCommandV2();
    if (authority === 'receipt') {
      harness.receiptReads.set(keyOf(command.projectId, command.commandId), {
        status: 'unsupported_prototype_schema',
      });
      addLiveCommandV2(harness, command);
    } else if (authority === 'pending') {
      harness.projects.set(command.projectId, makeProjectV2());
      harness.pendings.set(keyOf(command.projectId, command.commandId), {
        status: 'unsupported_prototype_schema',
        commandId: command.commandId,
        expectedRevision: command.expectedRevision,
      });
    } else {
      harness.projects.set(command.projectId, 'unsupported_prototype_schema');
      harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });
    }

    harness.processor.trigger(command.projectId, command.commandId);
    await vi.waitFor(() => expect(harness.mailbox.readReceipt).toHaveBeenCalled());
    if (authority !== 'receipt') await vi.waitFor(() => expect(harness.mailbox.readPending).toHaveBeenCalled());

    expect(harness.writeReceipt).not.toHaveBeenCalled();
    expect(harness.finish).not.toHaveBeenCalled();
    expect(harness.serviceApply).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it.each([
    {
      label: 'deadline before revision',
      nowMs: Date.parse('2026-08-16T12:00:13.000Z'),
      projectRevision: 2,
      expected: { status: 'expired', reasonCode: 'deadline_elapsed', observedRevision: 2 },
    },
    {
      label: 'stale revision',
      nowMs: NOW_MS,
      projectRevision: 2,
      expected: { status: 'rejected', reasonCode: 'stale_revision', observedRevision: 2 },
    },
    {
      label: 'future revision',
      nowMs: NOW_MS,
      projectRevision: 1,
      expectedRevision: 2,
      expected: { status: 'rejected', reasonCode: 'future_revision', observedRevision: 1 },
    },
  ])('$label has fixed precommit precedence', async ({ nowMs, projectRevision, expectedRevision = 1, expected }) => {
    const harness = createHarnessV2({ nowMs });
    await harness.processor.start();
    const command = makeCommandV2('project_v2', 'command_v2', { expectedRevision });
    harness.projects.set(command.projectId, makeProjectV2(command.projectId, projectRevision));
    harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject(expected);
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it.each([
    ['beat_capacity_reached', 'rejected'],
    ['dependency_blocked', 'rejected'],
    ['operation_not_permitted', 'rejected'],
    ['validation_failed', 'rejected'],
    ['deadline_elapsed', 'expired'],
  ] as const)('maps reducer reason %s without leaking error prose', async (reasonCode, status) => {
    const harness = createHarnessV2({
      serviceApply: async () => {
        throw new StudioDirectorCommandApplyErrorV2(reasonCode);
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status, reasonCode });
    expect(JSON.stringify(receipt)).not.toContain('prose');
    await harness.processor.stop();
  });

  it.each([
    ['stale_project', { status: 'rejected', reasonCode: 'stale_revision', observedRevision: 1 }],
    ['not_found', { status: 'rejected', reasonCode: 'project_not_found', observedRevision: null }],
    ['storage_error', { status: 'indeterminate', reasonCode: 'commit_attribution_unknown', observedRevision: 1 }],
  ] as const)('maps the schema-2 store %s boundary', async (code, expected) => {
    const harness = createHarnessV2({
      serviceApply: async () => {
        throw new CreativeStudioStoreError(code, 'opaque store detail');
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject(expected);
    expect(JSON.stringify(receipt)).not.toContain('opaque');
    await harness.processor.stop();
  });

  it('rejects malformed schema-2 pending bytes without loading the project', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    harness.pendings.set(keyOf('project_v2', 'command_v2'), {
      status: 'invalid',
      commandId: 'command_v2',
      expectedRevision: 17,
      reasonCode: 'malformed_record',
    });

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'malformed_record',
      expectedRevision: 17,
      observedRevision: null,
    });
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('rejects a missing schema-2 project before dispatch', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const command = makeCommandV2();
    harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status: 'rejected', reasonCode: 'project_not_found', observedRevision: null });
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('defers a busy store result without receipt, cleanup, or notification', async () => {
    const harness = createHarnessV2({
      serviceApply: async () => {
        throw new CreativeStudioStoreError('busy', 'opaque busy detail');
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.processor.trigger('project_v2', 'command_v2');
    await vi.waitFor(() => expect(harness.serviceApply).toHaveBeenCalledOnce());

    expect(harness.writeReceipt).not.toHaveBeenCalled();
    expect(harness.finish).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(harness.pendings.has(keyOf('project_v2', 'command_v2'))).toBe(true);
    await harness.processor.stop();
  });

  it.each([
    [1, 1, 'expired', 'expired_after_restart'],
    [2, 1, 'rejected', 'future_revision'],
    [1, 2, 'indeterminate', 'indeterminate_after_restart'],
  ] as const)(
    'never replays a startup command at expected revision %i and canonical revision %i',
    async (expectedRevision, projectRevision, status, reasonCode) => {
      const ref = { projectId: 'project_v2', commandId: 'command_v2' };
      const harness = createHarnessV2({ startupRefs: [ref] });
      const command = makeCommandV2(ref.projectId, ref.commandId, { expectedRevision });
      harness.projects.set(ref.projectId, makeProjectV2(ref.projectId, projectRevision));
      harness.pendings.set(keyOf(ref.projectId, ref.commandId), { status: 'valid', record: command });

      await harness.processor.start();
      const receipt = await waitForReceiptV2(harness);

      expect(receipt).toMatchObject({ status, reasonCode, observedRevision: projectRevision });
      expect(harness.serviceApply).not.toHaveBeenCalled();
      await harness.processor.stop();
    }
  );
});

describe('Studio Director schema-2 real mailbox terminal cleanup', () => {
  it.each([
    {
      label: 'malformed record with a recovered revision',
      expectedRevision: 1,
      reasonCode: 'malformed_record' as const,
      pending: (projectId: string, commandId: string) => ({
        ...makeCommandV2(projectId, commandId),
        policy: 'manual_review',
      }),
    },
    {
      label: 'malformed record without a recoverable revision',
      expectedRevision: null,
      reasonCode: 'malformed_record' as const,
      pending: (projectId: string, commandId: string) => ({
        ...makeCommandV2(projectId, commandId),
        expectedRevision: 'invalid',
      }),
    },
    {
      label: 'future schema record',
      expectedRevision: 1,
      reasonCode: 'unsupported_version' as const,
      pending: (projectId: string, commandId: string) => ({
        ...makeCommandV2(projectId, commandId),
        schemaVersion: 3,
      }),
    },
  ])(
    'durably rejects and releases real mailbox authority for a $label',
    async ({ expectedRevision, reasonCode, pending }) => {
      const rootDir = mkdtempSync(path.join(tmpdir(), 'studio-director-v2-invalid-'));
      let processor: StudioDirectorCommandProcessorV2 | null = null;
      try {
        const tracker = createStudioDirectorCommitTrackerV2();
        const store = createCreativeStudioStore({
          rootDir,
          now: () => COMMITTED_AT,
          createId: () => 'project_v2_invalid',
          onProjectCommitted: tracker.observe,
        });
        const project = await store.createProjectV2(makeInput('Invalid V2 terminal cleanup'));
        const mailbox = createStudioDirectorCommandMailboxV2({
          rootDir,
          store,
          now: () => new Date(NOW_MS).toISOString(),
          watchCommandTree: () => ({ close: vi.fn() }),
        });
        await mailbox.ensure(project.id);
        const getProjectV2 = vi.fn(store.getProjectV2.bind(store));
        const service = createStudioDirectorCommandServiceV2({ store });
        const apply = vi.fn(service.apply);
        const notify = vi.fn();
        processor = createStudioDirectorCommandProcessorV2({
          store: { getProjectV2 },
          mailbox,
          service: { apply },
          tracker,
          onProjectUpdated: notify,
          now: () => NOW_MS,
          setInterval: () => ({ interval: true }),
          clearInterval: vi.fn(),
          logError: vi.fn(),
        });
        await processor.start();
        const commandId = `command_${reasonCode}_${expectedRevision === null ? 'null' : 'revision'}`;
        await publishRealPendingV2({
          rootDir,
          projectId: project.id,
          commandId,
          pending: pending(project.id, commandId),
        });

        processor.trigger(project.id, commandId);
        await vi.waitFor(async () =>
          expect(await mailbox.readReceipt(project.id, commandId)).toMatchObject({
            status: 'valid',
            record: {
              schemaVersion: 2,
              commandId,
              projectId: project.id,
              expectedRevision,
              status: 'rejected',
              observedRevision: null,
              reasonCode,
            },
          })
        );
        await vi.waitFor(
          async () => {
            await expect(mailbox.readPending(project.id, commandId)).resolves.toBeNull();
            await expect(
              nodeFs.lstat(path.join(realCommandDirectories(rootDir, project.id).slots, '0.slot'))
            ).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(
              nodeFs.lstat(path.join(realCommandDirectories(rootDir, project.id).slots, '0.slot.lease'))
            ).rejects.toMatchObject({ code: 'ENOENT' });
          },
          { timeout: 5_000 }
        );

        expect(getProjectV2).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        await expect(mailbox.readReceipt(project.id, commandId)).resolves.toMatchObject({
          status: 'valid',
          record: { status: 'rejected', expectedRevision, reasonCode },
        });
      } finally {
        await processor?.stop();
        rmSync(rootDir, { recursive: true, force: true });
      }
    }
  );

  it('repairs a durable malformed rejection through a fresh real mailbox after finish fails', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'studio-director-v2-invalid-restart-'));
    let firstProcessor: StudioDirectorCommandProcessorV2 | null = null;
    let restartedProcessor: StudioDirectorCommandProcessorV2 | null = null;
    try {
      const firstTracker = createStudioDirectorCommitTrackerV2();
      const store = createCreativeStudioStore({
        rootDir,
        now: () => COMMITTED_AT,
        createId: () => 'project_v2_invalid_restart',
        onProjectCommitted: firstTracker.observe,
      });
      const project = await store.createProjectV2(makeInput('Invalid V2 restart cleanup'));
      const firstMailbox = createStudioDirectorCommandMailboxV2({
        rootDir,
        store,
        now: () => new Date(NOW_MS).toISOString(),
        watchCommandTree: () => ({ close: vi.fn() }),
      });
      await firstMailbox.ensure(project.id);
      const firstFinish = vi.fn(async () => {
        throw new CreativeStudioStoreError('storage_error', 'injected finish failure');
      });
      const firstApply = vi.fn(createStudioDirectorCommandServiceV2({ store }).apply);
      const firstNotify = vi.fn();
      firstProcessor = createStudioDirectorCommandProcessorV2({
        store,
        mailbox: { ...firstMailbox, finish: firstFinish },
        service: { apply: firstApply },
        tracker: firstTracker,
        onProjectUpdated: firstNotify,
        now: () => NOW_MS,
        setInterval: () => ({ interval: true }),
        clearInterval: vi.fn(),
        logError: vi.fn(),
      });
      await firstProcessor.start();
      const commandId = 'command_invalid_restart';
      await publishRealPendingV2({
        rootDir,
        projectId: project.id,
        commandId,
        pending: { ...makeCommandV2(project.id, commandId), operations: [] },
      });

      firstProcessor.trigger(project.id, commandId);
      await vi.waitFor(() => expect(firstFinish).toHaveBeenCalledExactlyOnceWith(project.id, commandId));
      await vi.waitFor(async () =>
        expect(await firstMailbox.readReceipt(project.id, commandId)).toMatchObject({
          status: 'valid',
          record: { status: 'rejected', reasonCode: 'malformed_record', expectedRevision: project.revision },
        })
      );
      expect(firstApply).not.toHaveBeenCalled();
      expect(firstNotify).not.toHaveBeenCalled();
      const directories = realCommandDirectories(rootDir, project.id);
      const receiptFile = path.join(directories.receipts, `${commandId}.json`);
      const receiptBytes = await nodeFs.readFile(receiptFile, 'utf8');
      await expect(nodeFs.lstat(path.join(directories.pending, `${commandId}.json`))).resolves.toBeDefined();
      await expect(nodeFs.lstat(path.join(directories.slots, '0.slot'))).resolves.toBeDefined();
      await firstProcessor.stop();

      const restartedMailbox = createStudioDirectorCommandMailboxV2({
        rootDir,
        store,
        now: () => new Date(NOW_MS).toISOString(),
        watchCommandTree: () => ({ close: vi.fn() }),
      });
      const restartedTracker = createStudioDirectorCommitTrackerV2();
      const restartedGetProject = vi.fn(store.getProjectV2.bind(store));
      const restartedApply = vi.fn(createStudioDirectorCommandServiceV2({ store }).apply);
      const restartedNotify = vi.fn();
      restartedProcessor = createStudioDirectorCommandProcessorV2({
        store: { getProjectV2: restartedGetProject },
        mailbox: restartedMailbox,
        service: { apply: restartedApply },
        tracker: restartedTracker,
        onProjectUpdated: restartedNotify,
        now: () => NOW_MS,
        setInterval: () => ({ interval: true }),
        clearInterval: vi.fn(),
        logError: vi.fn(),
      });

      await restartedProcessor.start();
      await vi.waitFor(async () => {
        await expect(restartedMailbox.readPending(project.id, commandId)).resolves.toBeNull();
        await expect(nodeFs.lstat(path.join(directories.slots, '0.slot'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(nodeFs.lstat(path.join(directories.slots, '0.slot.lease'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      });

      await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
      expect(restartedGetProject).not.toHaveBeenCalled();
      expect(restartedApply).not.toHaveBeenCalled();
      expect(restartedNotify).not.toHaveBeenCalled();
    } finally {
      await restartedProcessor?.stop();
      await firstProcessor?.stop();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('leaves a complete schema-1 command tree byte-identical behind a V2 terminal receipt', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'studio-director-v2-v1-no-touch-'));
    let processor: StudioDirectorCommandProcessorV2 | null = null;
    try {
      const tracker = createStudioDirectorCommitTrackerV2();
      const store = createCreativeStudioStore({
        rootDir,
        now: () => COMMITTED_AT,
        createId: () => 'project_v2_v1_no_touch',
        onProjectCommitted: tracker.observe,
      });
      const project = await store.createProjectV2(makeInput('schema-1 command no-touch'));
      const mailbox = createStudioDirectorCommandMailboxV2({
        rootDir,
        store,
        now: () => new Date(NOW_MS).toISOString(),
        watchCommandTree: () => ({ close: vi.fn() }),
      });
      await mailbox.ensure(project.id);
      const commandId = 'command_v1_no_touch';
      const command = {
        schemaVersion: 1 as const,
        commandId,
        projectId: project.id,
        expectedRevision: project.revision,
        createdAt: '2026-08-16T12:00:00.000Z',
        deadlineAt: '2026-08-16T12:00:15.000Z',
        policy: 'auto_apply' as const,
        operations: [{ kind: 'set_brief' as const, brief: 'Schema-1 bytes stay untouched' }],
      };
      const slot = {
        schemaVersion: 1 as const,
        commandId,
        reservedAt: command.createdAt,
        deadlineAt: command.deadlineAt,
      };
      const acquiredAt = '2026-08-16T12:00:00.000Z';
      const directories = realCommandDirectories(rootDir, project.id);
      await nodeFs.writeFile(path.join(directories.pending, `${commandId}.json`), JSON.stringify(command));
      await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
      await nodeFs.writeFile(
        path.join(directories.slots, '0.slot.lease'),
        JSON.stringify({
          schemaVersion: 1,
          leaseId: 'lease_v1_no_touch',
          owner: 'writer',
          commandId,
          reservedAt: slot.reservedAt,
          deadlineAt: slot.deadlineAt,
          acquiredAt,
          expiresAt: new Date(Date.parse(acquiredAt) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
        })
      );
      await mailbox.writeReceipt(project.id, {
        schemaVersion: 2,
        commandId,
        projectId: project.id,
        expectedRevision: project.revision,
        decidedAt: COMMITTED_AT,
        status: 'rejected',
        observedRevision: null,
        reasonCode: 'malformed_record',
      });
      const before = await snapshotDirectoryBytes(directories.root);
      const finish = vi.fn(mailbox.finish.bind(mailbox));
      const getProjectV2 = vi.fn(store.getProjectV2.bind(store));
      const apply = vi.fn(createStudioDirectorCommandServiceV2({ store }).apply);
      const notify = vi.fn();
      processor = createStudioDirectorCommandProcessorV2({
        store: { getProjectV2 },
        mailbox: { ...mailbox, finish },
        service: { apply },
        tracker,
        onProjectUpdated: notify,
        now: () => NOW_MS,
        setInterval: () => ({ interval: true }),
        clearInterval: vi.fn(),
        logError: vi.fn(),
      });

      await processor.start();
      expect(finish).toHaveBeenCalledExactlyOnceWith(project.id, commandId);
      expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
      expect(getProjectV2).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      await processor.stop();
      expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
    } finally {
      await processor?.stop();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
