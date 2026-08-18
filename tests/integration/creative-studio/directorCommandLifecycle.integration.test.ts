/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { access, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandSlotV1,
  type StudioProject,
  type StudioProjectV2,
  type StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandWriter,
  createStudioDirectorCommandWriterV2,
} from '@process/resources/builtinMcp/studioDirectorCommandWriter';
import {
  createStudioDirectorCommandMailbox,
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandMailbox,
  type StudioDirectorCommandMailboxV2,
} from '@process/services/creative-studio/service/directorCommandMailbox';
import {
  createStudioDirectorCommandProcessor,
  createStudioDirectorCommandProcessorV2,
  createStudioDirectorCommitTracker,
  createStudioDirectorCommitTrackerV2,
} from '@process/services/creative-studio/service/directorCommandProcessor';
import {
  createStudioDirectorCommandService,
  createStudioDirectorCommandServiceV2,
} from '@process/services/creative-studio/service/directorCommandService';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const scene = (id = 'scene_1'): StudioScene => ({
  id,
  title: `Scene ${id}`,
  purpose: 'Advance the story',
  visualPrompt: `Prompt ${id}`,
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
});

const waitForCondition = async <T>(
  read: () => T | null | Promise<T | null>,
  description: string,
  timeoutMs = 5_000
): Promise<T> => {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value !== null) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
};

const fileExists = async (file: string): Promise<boolean> => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const idSequence = (ids: string[]): (() => string) => {
  let index = 0;
  return () => ids[index++] ?? `generated_${index}`;
};

type RealGraph = {
  rootDir: string;
  project: StudioProject;
  store: ReturnType<typeof createCreativeStudioStore>;
  mailbox: StudioDirectorCommandMailbox;
  processor: ReturnType<typeof createStudioDirectorCommandProcessor>;
  onProjectUpdated: ReturnType<typeof vi.fn>;
  emitWatch(relativeFile: string): void;
};

const createRealGraph = async (options: { failFirstReceiptWrite?: boolean } = {}): Promise<RealGraph> => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-lifecycle-'));
  roots.push(rootDir);
  const tracker = createStudioDirectorCommitTracker();
  const store = createCreativeStudioStore({
    rootDir,
    createId: () => 'project_live',
    onProjectCommitted: tracker.observe,
  });
  const created = await store.createProject({
    name: 'Director lifecycle',
    brief: 'Original brief',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  const project = await store.updateProject(created.id, (current) => ({
    ...current,
    sceneOrder: ['scene_1'],
    scenes: { scene_1: scene() },
  }));
  let watchChange: ((relativeFile: string) => void) | null = null;
  const mailbox = createStudioDirectorCommandMailbox({
    rootDir,
    store,
    watchCommandTree: ({ onChange }) => {
      watchChange = onChange;
      return { close: () => undefined };
    },
  });
  await mailbox.ensure(project.id);
  let failReceipt = options.failFirstReceiptWrite === true;
  const processorMailbox: StudioDirectorCommandMailbox = {
    ...mailbox,
    writeReceipt: async (projectId, receipt) => {
      if (failReceipt) {
        failReceipt = false;
        throw new Error('injected first receipt publication failure');
      }
      await mailbox.writeReceipt(projectId, receipt);
    },
  };
  const onProjectUpdated = vi.fn();
  const processor = createStudioDirectorCommandProcessor({
    store,
    mailbox: processorMailbox,
    service: createStudioDirectorCommandService({ store }),
    tracker,
    onProjectUpdated,
  });
  await processor.start();
  return {
    rootDir,
    project,
    store,
    mailbox,
    processor,
    onProjectUpdated,
    emitWatch: (relativeFile) => {
      if (watchChange === null) throw new Error('watcher was not installed');
      watchChange(relativeFile);
    },
  };
};

const applyWithWriter = async (input: {
  graph: RealGraph;
  commandId: string;
  leaseId: string;
  brief: string;
  emitWatch: boolean;
}) => {
  const projectDir = await input.graph.store.getVerifiedProjectDirectory(input.graph.project.id);
  if (projectDir === null) throw new Error('project directory missing');
  const writer = createStudioDirectorCommandWriter(
    { projectId: input.graph.project.id, projectDir },
    {
      createId: idSequence([input.commandId, input.leaseId]),
    }
  );
  const pendingFile = path.join(projectDir, 'commands', 'pending', `${input.commandId}.json`);
  const applying = writer.apply({
    expectedRevision: input.graph.project.revision,
    operations: [{ kind: 'set_brief', brief: input.brief }],
  });
  await waitForCondition(async () => {
    const entries = await readdir(path.dirname(pendingFile));
    const temporaryPrefix = `${path.basename(pendingFile)}.`;
    return entries.includes(path.basename(pendingFile)) && !entries.some((entry) => entry.startsWith(temporaryPrefix))
      ? true
      : null;
  }, 'completed durable pending publication');
  if (input.emitWatch) {
    input.graph.emitWatch(path.join(input.graph.project.id, 'commands', 'pending', `${input.commandId}.json`));
  }
  await applying;
  await waitForCondition(
    () => (input.graph.onProjectUpdated.mock.calls.length === 1 ? true : null),
    `renderer notification for ${input.commandId}`
  );
  return waitForCondition(async () => {
    const status = await writer.getStatus({ commandId: input.commandId });
    return status.status === 'applied' ? status : null;
  }, `durable writer status for ${input.commandId}`);
};

describe('Studio Director real-boundary lifecycle', () => {
  it('publishes through the stdio writer and commits one revision before receipt, cleanup, and one notification', async () => {
    const graph = await createRealGraph();

    await expect(
      applyWithWriter({
        graph,
        commandId: 'command_watch',
        leaseId: 'lease_watch',
        brief: 'Applied through watcher',
        emitWatch: true,
      })
    ).resolves.toMatchObject({ status: 'applied', appliedRevision: graph.project.revision + 1 });

    const projectDir = (await graph.store.getVerifiedProjectDirectory(graph.project.id))!;
    await expect(graph.store.getProject(graph.project.id)).resolves.toMatchObject({
      revision: graph.project.revision + 1,
      brief: 'Applied through watcher',
    });
    await expect(graph.mailbox.readReceipt(graph.project.id, 'command_watch')).resolves.toMatchObject({
      status: 'applied',
      appliedRevision: graph.project.revision + 1,
    });
    expect(await fileExists(path.join(projectDir, 'commands', 'pending', 'command_watch.json'))).toBe(false);
    expect(await fileExists(path.join(projectDir, 'commands', 'slots', '0.slot'))).toBe(false);
    expect(graph.onProjectUpdated).toHaveBeenCalledExactlyOnceWith(graph.project.id);
    await graph.processor.stop();
  });

  it('recovers a dropped watcher event on the production 500ms sweep', async () => {
    const graph = await createRealGraph();

    await expect(
      applyWithWriter({
        graph,
        commandId: 'command_sweep',
        leaseId: 'lease_sweep',
        brief: 'Applied through sweep',
        emitWatch: false,
      })
    ).resolves.toMatchObject({ status: 'applied', appliedRevision: graph.project.revision + 1 });

    expect(graph.onProjectUpdated).toHaveBeenCalledExactlyOnceWith(graph.project.id);
    await graph.processor.stop();
  });

  it('repairs a failed applied-receipt write on a later sweep without replaying the project edit', async () => {
    const graph = await createRealGraph({ failFirstReceiptWrite: true });

    await expect(
      applyWithWriter({
        graph,
        commandId: 'command_repair',
        leaseId: 'lease_repair',
        brief: 'Applied once and repaired',
        emitWatch: true,
      })
    ).resolves.toMatchObject({ status: 'applied', appliedRevision: graph.project.revision + 1 });

    await expect(graph.store.getProject(graph.project.id)).resolves.toMatchObject({
      revision: graph.project.revision + 1,
      brief: 'Applied once and repaired',
    });
    expect(graph.onProjectUpdated).toHaveBeenCalledExactlyOnceWith(graph.project.id);
    await graph.processor.stop();
  });
});

describe('Studio Director schema-2 real-boundary lifecycle', () => {
  it('commits one reducer revision before receipt-first cleanup and one notification', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-lifecycle-v2-'));
    roots.push(rootDir);
    const tracker = createStudioDirectorCommitTrackerV2();
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_v2_live',
      onProjectCommitted: tracker.observe,
    });
    const project: StudioProjectV2 = await store.createProjectV2({
      name: 'Director V2 lifecycle',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const mailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      watchCommandTree: () => ({ close: () => undefined }),
    });
    await mailbox.ensure(project.id);
    const onProjectUpdated = vi.fn();
    const processor = createStudioDirectorCommandProcessorV2({
      store,
      mailbox,
      service: createStudioDirectorCommandServiceV2({ store }),
      tracker,
      onProjectUpdated,
    });
    await processor.start();
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('schema-2 project directory missing');
    const commandId = 'command_v2_live';
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: project.id, projectDir },
      { createId: idSequence([commandId, 'section_v2', 'clip_v2', 'lease_v2']) }
    );
    const pendingFile = path.join(projectDir, 'commands', 'pending', `${commandId}.json`);
    const applying = writer.apply({
      expectedRevision: project.revision,
      operations: [
        {
          kind: 'add_beat',
          beat: { title: 'Opening', action: 'Reveal the product', look: 'Cinematic studio light' },
          firstShot: {
            line: 'Slow product reveal',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
          },
          beforeBeatId: null,
        },
      ],
    });
    await waitForCondition(async () => ((await fileExists(pendingFile)) ? true : null), 'schema-2 pending publication');
    processor.trigger(project.id, commandId);

    await expect(applying).resolves.toMatchObject({
      schemaVersion: 2,
      status: 'applied',
      appliedRevision: project.revision + 1,
      createdBeatIds: ['section_v2'],
      createdShotIds: ['clip_v2'],
    });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        revision: project.revision + 1,
        beatOrder: ['section_v2'],
        beats: { section_v2: { shotOrder: ['clip_v2'] } },
        shots: { clip_v2: { line: 'Slow product reveal' } },
      },
    });
    await expect(mailbox.readReceipt(project.id, commandId)).resolves.toMatchObject({
      status: 'valid',
      record: { status: 'applied', createdBeatIds: ['section_v2'], createdShotIds: ['clip_v2'] },
    });
    await waitForCondition(
      async () =>
        !(await fileExists(pendingFile)) && !(await fileExists(path.join(projectDir, 'commands', 'slots', '0.slot')))
          ? true
          : null,
      'schema-2 receipt-first cleanup'
    );
    await waitForCondition(
      () => (onProjectUpdated.mock.calls.length === 1 ? true : null),
      'schema-2 renderer notification'
    );
    expect(await fileExists(pendingFile)).toBe(false);
    expect(await fileExists(path.join(projectDir, 'commands', 'slots', '0.slot'))).toBe(false);
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
    await processor.stop();
  });

  it('repairs the real CAS crash window after receipt publication fails without replaying the reducer', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-lifecycle-v2-repair-'));
    roots.push(rootDir);
    const tracker = createStudioDirectorCommitTrackerV2();
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_v2_repair',
      onProjectCommitted: tracker.observe,
    });
    const project = await store.createProjectV2({
      name: 'Director V2 repair',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const mailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      watchCommandTree: () => ({ close: () => undefined }),
    });
    await mailbox.ensure(project.id);
    let failReceipt = true;
    const processorMailbox: StudioDirectorCommandMailboxV2 = {
      ...mailbox,
      writeReceipt: async (projectId, receipt) => {
        if (failReceipt) {
          failReceipt = false;
          throw new Error('injected schema-2 receipt publication failure');
        }
        await mailbox.writeReceipt(projectId, receipt);
      },
    };
    const service = createStudioDirectorCommandServiceV2({ store });
    const apply = vi.fn(service.apply);
    const onProjectUpdated = vi.fn();
    const processor = createStudioDirectorCommandProcessorV2({
      store,
      mailbox: processorMailbox,
      service: { apply },
      tracker,
      onProjectUpdated,
    });
    await processor.start();
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('schema-2 project directory missing');
    const commandId = 'command_v2_repair';
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: project.id, projectDir },
      { createId: idSequence([commandId, 'lease_v2_repair']) }
    );
    const pendingFile = path.join(projectDir, 'commands', 'pending', `${commandId}.json`);
    const applying = writer.apply({
      expectedRevision: project.revision,
      operations: [{ kind: 'set_brief', brief: 'Committed once, receipt repaired' }],
    });
    await waitForCondition(async () => ((await fileExists(pendingFile)) ? true : null), 'schema-2 repair pending');
    processor.trigger(project.id, commandId);

    await expect(applying).resolves.toMatchObject({ status: 'applied', appliedRevision: project.revision + 1 });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: {
        revision: project.revision + 1,
        brief: 'Committed once, receipt repaired',
      },
    });
    expect(apply).toHaveBeenCalledOnce();
    await waitForCondition(
      () => (onProjectUpdated.mock.calls.length === 1 ? true : null),
      'schema-2 repaired notification'
    );
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
    await processor.stop();
  });
});

const cloneProject = async (input: {
  rootDir: string;
  sourceDirectory: string;
  sourceProject: StudioProject;
  projectId: string;
}): Promise<void> => {
  const destination = path.join(input.rootDir, input.projectId);
  await cp(input.sourceDirectory, destination, { recursive: true });
  await writeFile(
    path.join(destination, 'project.json'),
    JSON.stringify({ ...input.sourceProject, id: input.projectId, name: input.projectId }),
    'utf8'
  );
};

const publishUnconfirmed = async (input: {
  rootDir: string;
  project: StudioProject;
  commandId: string;
  leaseId: string;
  nowMs: number;
  brief: string;
}): Promise<void> => {
  let writerNow = input.nowMs;
  const writer = createStudioDirectorCommandWriter(
    { projectId: input.project.id, projectDir: path.join(input.rootDir, input.project.id) },
    {
      now: () => writerNow,
      createId: idSequence([input.commandId, input.leaseId]),
      sleep: async (milliseconds) => {
        writerNow += milliseconds;
      },
    }
  );
  await expect(
    writer.apply({
      expectedRevision: input.project.revision,
      operations: [{ kind: 'set_brief', brief: input.brief }],
    })
  ).resolves.toEqual({ status: 'unconfirmed', commandId: input.commandId });
};

const driveSlotMaintenanceToWrap = async (mailbox: StudioDirectorCommandMailbox, now: string): Promise<void> => {
  let cursor: string | null = null;
  do {
    // The opaque cursor, not directory ordering, is the traversal authority.
    // eslint-disable-next-line no-await-in-loop
    const page = await mailbox.releaseOrphanedSlotsPage(cursor, now, 64);
    cursor = page.nextCursor;
  } while (cursor !== null);
};

const driveReceiptMaintenanceToWrap = async (
  mailbox: StudioDirectorCommandMailbox,
  decidedBefore: string
): Promise<void> => {
  let cursor: string | null = null;
  do {
    // The opaque cursor, not directory ordering, is the traversal authority.
    // eslint-disable-next-line no-await-in-loop
    const page = await mailbox.pruneReceiptsPage(cursor, decidedBefore, 64);
    cursor = page.nextCursor;
  } while (cursor !== null);
};

describe('Studio Director restart and maintenance recovery', () => {
  it('never applies more than one startup page, advances past unsafe live storage, and fairly maintains more than 64 entries', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-restart-'));
    roots.push(rootDir);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const tracker = createStudioDirectorCommitTracker();
    const store = createCreativeStudioStore({
      rootDir,
      now: () => nowIso,
      createId: () => 'project_seed',
      onProjectCommitted: tracker.observe,
    });
    const created = await store.createProject({
      name: 'Seed',
      brief: 'Original',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const seed = await store.updateProject(created.id, (current) => ({
      ...current,
      sceneOrder: ['scene_1'],
      scenes: { scene_1: scene() },
    }));
    const mailbox = createStudioDirectorCommandMailbox({ rootDir, store, now: () => nowIso });
    await mailbox.ensure(seed.id);
    const sourceDirectory = (await store.getVerifiedProjectDirectory(seed.id))!;
    const cloneIds = Array.from({ length: 65 }, (_, index) => `project_clone_${index + 1}`);
    await Promise.all(
      cloneIds.map((projectId) => cloneProject({ rootDir, sourceDirectory, sourceProject: seed, projectId }))
    );
    const projects = [seed.id, ...cloneIds].map((projectId) => ({ ...seed, id: projectId, name: projectId }));
    await Promise.all(
      projects.map((project, index) =>
        publishUnconfirmed({
          rootDir,
          project,
          commandId: `command_restart_${index + 1}`,
          leaseId: `lease_restart_${index + 1}`,
          nowMs,
          brief: `must never apply ${index + 1}`,
        })
      )
    );

    const onProjectUpdated = vi.fn();
    const processor = createStudioDirectorCommandProcessor({
      store,
      mailbox,
      service: createStudioDirectorCommandService({ store, now: () => nowMs }),
      tracker,
      onProjectUpdated,
      now: () => nowMs,
    });
    await processor.start();
    const restartReceipts = await waitForCondition(
      async () => {
        const values = await Promise.all(
          projects.map(async (project, index) => {
            try {
              return await mailbox.readReceipt(project.id, `command_restart_${index + 1}`);
            } catch {
              // Immutable receipt publication is intentionally unreadable while its
              // short-lived unconfirmed guard exists; retry until it is durable.
              return null;
            }
          })
        );
        return values.every((receipt) => receipt !== null) ? values : null;
      },
      'all pre-start receipts across the cursor wrap',
      15_000
    );
    expect(restartReceipts).toHaveLength(66);
    restartReceipts.forEach((receipt) =>
      expect(receipt).toMatchObject({ status: 'expired', reasonCode: 'expired_after_restart' })
    );
    await waitForCondition(
      async () => {
        const cleanupState = await Promise.all(
          projects.flatMap((project, index) => {
            const commandId = `command_restart_${index + 1}`;
            const commandsDir = path.join(rootDir, project.id, 'commands');
            return [
              fileExists(path.join(commandsDir, 'pending', `${commandId}.json`)),
              fileExists(path.join(commandsDir, 'slots', '0.slot')),
              fileExists(path.join(commandsDir, 'slots', '0.slot.lease')),
            ];
          })
        );
        return cleanupState.every((exists) => !exists) ? true : null;
      },
      'all pre-start pending records, slots, and leases to finish across the cursor wrap',
      15_000
    );
    const canonicalAfterRestart = await Promise.all(projects.map(({ id }) => store.getProject(id)));
    canonicalAfterRestart.forEach((project) => expect(project?.revision).toBe(seed.revision));
    expect(onProjectUpdated).not.toHaveBeenCalled();

    const unsafeProject = projects[0]!;
    const laterProject = projects.at(-1)!;
    await rm(path.join(rootDir, unsafeProject.id, 'commands', 'receipts'), { recursive: true, force: true });
    const unsafeWriter = createStudioDirectorCommandWriter({
      projectId: unsafeProject.id,
      projectDir: path.join(rootDir, unsafeProject.id),
    });
    await expect(unsafeWriter.getStatus({ commandId: 'command_unknown' })).resolves.toEqual({
      status: 'storage_error',
      commandId: 'command_unknown',
    });
    await publishUnconfirmed({
      rootDir,
      project: laterProject,
      commandId: 'command_after_unsafe',
      leaseId: 'lease_after_unsafe',
      nowMs,
      brief: 'live work reached after unsafe storage',
    });
    await waitForCondition(
      async () => {
        try {
          return await mailbox.readReceipt(laterProject.id, 'command_after_unsafe');
        } catch {
          return null;
        }
      },
      'live receipt after an unsafe project and cursor wrap',
      15_000
    );
    await expect(store.getProject(laterProject.id)).resolves.toMatchObject({
      revision: seed.revision + 1,
      brief: 'live work reached after unsafe storage',
    });
    await mkdir(path.join(rootDir, unsafeProject.id, 'commands', 'receipts'));
    await processor.stop();

    // Maintenance is driven independently after live processing stops so a
    // production sweep cannot consume the reservation under inspection.
    const maintenanceMailbox = createStudioDirectorCommandMailbox({ rootDir, store, now: () => nowIso });

    const expiredProject = projects[1]!;
    const postCrashProject = projects[2]!;
    const receiptLedgerProject = projects[3]!;
    const residueProject = projects[4]!;
    const slotFor = (commandId: string, reservedAtMs: number, deadlineAtMs: number): StudioDirectorCommandSlotV1 => ({
      schemaVersion: 1,
      commandId,
      reservedAt: new Date(reservedAtMs).toISOString(),
      deadlineAt: new Date(deadlineAtMs).toISOString(),
    });
    await writeFile(
      path.join(rootDir, expiredProject.id, 'commands', 'slots', '0.slot'),
      JSON.stringify(slotFor('command_expired_orphan', nowMs - 15_000, nowMs - 1_000))
    );
    await writeFile(
      path.join(rootDir, postCrashProject.id, 'commands', 'slots', '0.slot'),
      JSON.stringify(slotFor('command_post_crash', nowMs, nowMs + STUDIO_DIRECTOR_COMMAND_WAIT_MS))
    );
    const terminalReceipt = (
      projectId: string,
      commandId: string,
      decidedAt: string
    ): StudioDirectorCommandReceiptV1 => ({
      schemaVersion: 1,
      commandId,
      projectId,
      expectedRevision: seed.revision,
      decidedAt,
      status: 'rejected',
      observedRevision: seed.revision,
      reasonCode: 'validation_failed',
    });
    await writeFile(
      path.join(rootDir, postCrashProject.id, 'commands', 'receipts', 'command_post_crash.json'),
      JSON.stringify(terminalReceipt(postCrashProject.id, 'command_post_crash', nowIso))
    );

    const recentReceiptIds = Array.from({ length: 66 }, (_, index) => `command_recent_${index + 1}`);
    await Promise.all(
      recentReceiptIds.map((commandId) =>
        writeFile(
          path.join(rootDir, receiptLedgerProject.id, 'commands', 'receipts', `${commandId}.json`),
          JSON.stringify(terminalReceipt(receiptLedgerProject.id, commandId, nowIso))
        )
      )
    );
    const oldDecidedAt = new Date(nowMs - STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS - 1_000).toISOString();
    await writeFile(
      path.join(rootDir, receiptLedgerProject.id, 'commands', 'receipts', 'command_old_clean.json'),
      JSON.stringify(terminalReceipt(receiptLedgerProject.id, 'command_old_clean', oldDecidedAt))
    );
    const residueCommand: StudioDirectorCommandRecordV1 = {
      schemaVersion: 1,
      commandId: 'command_old_residue',
      projectId: residueProject.id,
      expectedRevision: seed.revision,
      createdAt: nowIso,
      deadlineAt: new Date(nowMs + STUDIO_DIRECTOR_COMMAND_WAIT_MS).toISOString(),
      policy: 'auto_apply',
      operations: [{ kind: 'set_brief', brief: 'unresolved' }],
    };
    await writeFile(
      path.join(rootDir, residueProject.id, 'commands', 'pending', 'command_old_residue.json'),
      JSON.stringify(residueCommand)
    );
    await writeFile(
      path.join(rootDir, residueProject.id, 'commands', 'slots', '0.slot'),
      JSON.stringify(slotFor('command_old_residue', nowMs, nowMs + STUDIO_DIRECTOR_COMMAND_WAIT_MS))
    );
    await writeFile(
      path.join(rootDir, residueProject.id, 'commands', 'receipts', 'command_old_residue.json'),
      JSON.stringify(terminalReceipt(residueProject.id, 'command_old_residue', oldDecidedAt))
    );

    await driveSlotMaintenanceToWrap(maintenanceMailbox, nowIso);
    expect(await fileExists(path.join(rootDir, expiredProject.id, 'commands', 'slots', '0.slot'))).toBe(false);
    expect(await fileExists(path.join(rootDir, postCrashProject.id, 'commands', 'slots', '0.slot'))).toBe(false);
    await publishUnconfirmed({
      rootDir,
      project: postCrashProject,
      commandId: 'command_after_crash_cleanup',
      leaseId: 'lease_after_crash_cleanup',
      nowMs,
      brief: 'new reservation succeeds',
    });
    expect(await fileExists(path.join(rootDir, postCrashProject.id, 'commands', 'slots', '0.slot'))).toBe(true);

    const decidedBefore = new Date(nowMs - STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS).toISOString();
    await driveReceiptMaintenanceToWrap(maintenanceMailbox, decidedBefore);
    expect(
      await fileExists(path.join(rootDir, receiptLedgerProject.id, 'commands', 'receipts', 'command_old_clean.json'))
    ).toBe(false);
    expect(
      await fileExists(
        path.join(rootDir, receiptLedgerProject.id, 'commands', 'receipts', `${recentReceiptIds[0]}.json`)
      )
    ).toBe(true);
    expect(
      await fileExists(path.join(rootDir, residueProject.id, 'commands', 'receipts', 'command_old_residue.json'))
    ).toBe(true);
    expect(
      await fileExists(path.join(rootDir, residueProject.id, 'commands', 'pending', 'command_old_residue.json'))
    ).toBe(true);
    expect(await fileExists(path.join(rootDir, residueProject.id, 'commands', 'slots', '0.slot'))).toBe(true);

    expect(await readdir(path.join(rootDir, residueProject.id, 'commands', 'pending'))).toContain(
      'command_old_residue.json'
    );
  }, 120_000);
});
