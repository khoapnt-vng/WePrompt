/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { promises as nodeFs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
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
  type StudioDirectorCommandService,
} from '@process/services/creative-studio/service/directorCommandService';
import type { RecordIoFileSystem } from '@process/services/creative-studio/service/recordIo';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const scene: StudioScene = {
  id: 'scene_1',
  title: 'Opening',
  purpose: 'Advance the story',
  visualPrompt: 'A cinematic opening',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
};

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

const withSampleGuard = async <T>(operation: Promise<T>, description: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description} after 5000ms`)), 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const fileExists = async (file: string): Promise<boolean> => {
  try {
    await nodeFs.lstat(file);
    return true;
  } catch {
    return false;
  }
};

const percentile = (sorted: readonly number[], ratio: number): number =>
  sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;

type QueuedReadGate = {
  file: string;
  observed: boolean;
  reached(): void;
  blocked: Promise<void>;
};

const fsObservingCompletedPendingPublication = (pendingFile: string, onCompleted: () => void): RecordIoFileSystem => {
  let observed = false;
  return new Proxy(nodeFs, {
    get(target, property, receiver) {
      if (property !== 'rm') {
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (...args: Parameters<typeof nodeFs.rm>) => {
        const result = await nodeFs.rm(...args);
        const file = String(args[0]);
        if (!observed && file.startsWith(`${pendingFile}.`) && file.endsWith('.tmp')) {
          observed = true;
          onCompleted();
        }
        return result;
      };
    },
  }) as RecordIoFileSystem;
};

describe('Studio Director loaded end-to-end latency', () => {
  it('stays within the frozen dropped-watch budget under same-project queued-read contention', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-latency-'));
    roots.push(rootDir);
    const tracker = createStudioDirectorCommitTracker();
    let queuedReadGate: QueuedReadGate | null = null;
    const storeFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'lstat') {
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
          const gate = queuedReadGate;
          if (gate !== null && !gate.observed && path.resolve(String(file)) === gate.file) {
            gate.observed = true;
            gate.reached();
            await gate.blocked;
          }
          return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_latency',
      fs: storeFs,
      onProjectCommitted: tracker.observe,
    });
    const created = await store.createProject({
      name: 'Latency project',
      brief: 'Warmup',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    let project: StudioProject = await store.updateProject(created.id, (current) => ({
      ...current,
      sceneOrder: [scene.id],
      scenes: { [scene.id]: scene },
    }));
    const proposalPaths = await store.resolveProposalPaths(project.id);
    const mailbox = createStudioDirectorCommandMailbox({
      rootDir,
      store,
      watchCommandTree: () => ({ close: () => undefined }),
    });
    await mailbox.ensure(project.id);
    let completedEmptySweepCount = 0;
    const processorMailbox: StudioDirectorCommandMailbox = {
      ...mailbox,
      listPendingPage: async (cursor, limit) => {
        const page = await mailbox.listPendingPage(cursor, limit);
        if (page.items.length === 0) completedEmptySweepCount += 1;
        return page;
      },
    };
    const intervalHandles = new Set<ReturnType<typeof setInterval>>();
    let finishSample: ((completedAt: number) => void) | null = null;
    let releaseQueuedReadsAtApply: (() => void) | null = null;
    const directorService = createStudioDirectorCommandService({ store });
    const processorService: StudioDirectorCommandService = {
      apply: async (...args) => {
        const release = releaseQueuedReadsAtApply;
        if (release === null) throw new Error('same-project contention was not armed before apply');
        releaseQueuedReadsAtApply = null;
        release();
        return directorService.apply(...args);
      },
    };
    const processor = createStudioDirectorCommandProcessor({
      store,
      mailbox: processorMailbox,
      service: processorService,
      tracker,
      onProjectUpdated: (projectId) => {
        if (projectId !== project.id) throw new Error('wrong latency project notification');
        finishSample?.(performance.now());
      },
      setInterval: (callback, delayMs) => {
        const handle = setInterval(() => {
          callback();
        }, delayMs);
        intervalHandles.add(handle);
        return handle;
      },
      clearInterval: (handle) => {
        const timer = handle as ReturnType<typeof setInterval>;
        clearInterval(timer);
        intervalHandles.delete(timer);
      },
    });
    await processor.start();
    await waitForCondition(
      () => (completedEmptySweepCount > 0 ? completedEmptySweepCount : null),
      'first completed empty pending sweep'
    );

    const measured: number[] = [];
    const allSamples: number[] = [];
    for (let iteration = 0; iteration < 35; iteration += 1) {
      const previousSweep = completedEmptySweepCount;
      // Publishing only after the prior empty page fully resolved proves no in-flight sweep can
      // discover this deliberately dropped event before the next production 500ms interval.
      // eslint-disable-next-line no-await-in-loop
      await waitForCondition(
        () => (completedEmptySweepCount > previousSweep ? completedEmptySweepCount : null),
        `completed empty sweep before sample ${iteration + 1}`
      );

      let markHeadReached!: () => void;
      const headReached = new Promise<void>((resolve) => {
        markHeadReached = resolve;
      });
      let releaseHead!: () => void;
      const headBlocked = new Promise<void>((resolve) => {
        releaseHead = resolve;
      });
      queuedReadGate = {
        file: path.dirname(proposalPaths.pendingDir),
        observed: false,
        reached: markHeadReached,
        blocked: headBlocked,
      };
      const contention = [store.resolveProposalPaths(project.id)];
      // eslint-disable-next-line no-await-in-loop
      await withSampleGuard(headReached, `head queued read for sample ${iteration + 1}`);
      contention.push(...Array.from({ length: 49 }, () => store.resolveProposalPaths(project.id)));
      releaseQueuedReadsAtApply = () => {
        queuedReadGate = null;
        releaseHead();
      };
      const commandId = `command_latency_${iteration + 1}`;
      const leaseId = `lease_latency_${iteration + 1}`;
      const projectDir = (await store.getVerifiedProjectDirectory(project.id))!;
      const pendingFile = path.join(projectDir, 'commands', 'pending', `${commandId}.json`);
      let publicationCompletedAt: number | null = null;
      let releasePublication!: () => void;
      const publicationCompleted = new Promise<void>((resolve) => {
        releasePublication = resolve;
      });
      const notification = new Promise<number>((resolve) => {
        finishSample = resolve;
      });
      const writer = createStudioDirectorCommandWriter(
        { projectId: project.id, projectDir },
        {
          fs: fsObservingCompletedPendingPublication(pendingFile, () => {
            publicationCompletedAt = performance.now();
            releasePublication();
          }),
          createId: (() => {
            const ids = [commandId, leaseId];
            let index = 0;
            return () => ids[index++]!;
          })(),
        }
      );
      const applying = writer.apply({
        expectedRevision: project.revision,
        operations: [{ kind: 'set_brief', brief: `Latency revision ${iteration + 1}` }],
      });

      // eslint-disable-next-line no-await-in-loop
      await withSampleGuard(publicationCompleted, `pending publication for sample ${iteration + 1}`);
      // eslint-disable-next-line no-await-in-loop
      let notifiedAt: number;
      try {
        // eslint-disable-next-line no-await-in-loop
        notifiedAt = await withSampleGuard(notification, `project notification for sample ${iteration + 1}`);
      } catch (error) {
        releaseQueuedReadsAtApply = null;
        queuedReadGate = null;
        releaseHead();
        throw error;
      }
      finishSample = null;
      if (publicationCompletedAt === null) throw new Error('pending publication timestamp was not captured');
      const elapsedMs = notifiedAt - publicationCompletedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
      allSamples.push(elapsedMs);
      if (iteration >= 5) measured.push(elapsedMs);

      // The timed endpoint is deliberately the renderer notification, which follows receipt fsync
      // and cleanup rather than the later closure of the writer call.
      // A poll can race the short-lived immutable-receipt guard, so the durable status boundary
      // below is the authority after the writer call has closed.
      // eslint-disable-next-line no-await-in-loop
      await applying;
      // eslint-disable-next-line no-await-in-loop
      const durableStatus = await waitForCondition(
        async () => {
          const status = await writer.getStatus({ commandId });
          return status.status === 'applied' ? status : null;
        },
        `durable applied status for sample ${iteration + 1}`
      );
      expect(durableStatus).toMatchObject({ status: 'applied', appliedRevision: project.revision + 1 });
      // eslint-disable-next-line no-await-in-loop
      await expect(mailbox.readReceipt(project.id, commandId)).resolves.toMatchObject({
        status: 'applied',
        appliedRevision: project.revision + 1,
      });
      const commandsDir = path.join(projectDir, 'commands');
      // eslint-disable-next-line no-await-in-loop
      await expect(
        Promise.all([
          fileExists(path.join(commandsDir, 'pending', `${commandId}.json`)),
          fileExists(path.join(commandsDir, 'slots', '0.slot')),
          fileExists(path.join(commandsDir, 'slots', '0.slot.lease')),
        ])
      ).resolves.toEqual([false, false, false]);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(contention);
      // eslint-disable-next-line no-await-in-loop
      project = (await store.getProject(project.id))!;
    }

    const sorted = [...measured].sort((left, right) => left - right);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const max = sorted.at(-1)!;
    const thresholdMs = (STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS - STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS) / 2;
    if (process.env.STUDIO_LATENCY_METRICS === '1' || max > thresholdMs) {
      console.info(
        JSON.stringify({
          samples: sorted.map((value) => Number(value.toFixed(3))),
          p50: Number(p50.toFixed(3)),
          p95: Number(p95.toFixed(3)),
          max: Number(max.toFixed(3)),
          thresholdMs,
        })
      );
    }
    expect(allSamples).toHaveLength(35);
    expect(measured).toHaveLength(30);
    expect(max).toBeLessThanOrEqual(thresholdMs);
    expect(STUDIO_DIRECTOR_COMMAND_WAIT_MS).toBeGreaterThanOrEqual(STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS * 4);

    await processor.stop();
    for (const handle of intervalHandles) clearInterval(handle);
  }, 120_000);
});

describe('Studio Director schema-2 latency fixture', () => {
  it('uses the frozen pending-sweep cadence for a dropped V2 watcher event', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-latency-v2-'));
    roots.push(rootDir);
    const fixtureNowMs = Date.now();
    const tracker = createStudioDirectorCommitTrackerV2();
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'project_latency_v2',
      onProjectCommitted: tracker.observe,
    });
    const project: StudioProjectV2 = await store.createProjectV2({
      name: 'Latency project V2',
      brief: 'Warmup',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const mailbox = createStudioDirectorCommandMailboxV2({
      rootDir,
      store,
      now: () => new Date(fixtureNowMs).toISOString(),
      watchCommandTree: () => ({ close: () => undefined }),
    });
    await mailbox.ensure(project.id);
    const observedDelays: number[] = [];
    let pendingSweep: (() => void) | null = null;
    let notificationCount = 0;
    let notified!: (projectId: string) => void;
    const notification = new Promise<string>((resolve) => {
      notified = resolve;
    });
    const processor = createStudioDirectorCommandProcessorV2({
      store,
      mailbox: mailbox as StudioDirectorCommandMailboxV2,
      service: createStudioDirectorCommandServiceV2({ store, now: () => fixtureNowMs }),
      tracker,
      now: () => fixtureNowMs,
      onProjectUpdated: (projectId) => {
        notificationCount += 1;
        notified(projectId);
      },
      setInterval: (callback, delayMs) => {
        observedDelays.push(delayMs);
        if (delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS) pendingSweep = callback;
        return { callback, delayMs };
      },
      clearInterval: () => undefined,
    });
    await processor.start();
    const projectDir = await store.getVerifiedProjectDirectoryV2(project.id);
    if (projectDir === null) throw new Error('schema-2 latency project directory missing');
    const ids = ['command_latency_v2', 'lease_latency_v2'];
    let idIndex = 0;
    let writerPolling!: () => void;
    const writerPollStarted = new Promise<void>((resolve) => {
      writerPolling = resolve;
    });
    const writerPollDelays: number[] = [];
    const writer = createStudioDirectorCommandWriterV2(
      { projectId: project.id, projectDir },
      {
        now: () => fixtureNowMs,
        createId: () => ids[idIndex++]!,
        sleep: async (delayMs) => {
          writerPollDelays.push(delayMs);
          writerPolling();
          await notification;
        },
      }
    );
    const pendingFile = path.join(projectDir, 'commands', 'pending', 'command_latency_v2.json');
    const applying = writer.apply({
      expectedRevision: project.revision,
      operations: [
        {
          kind: 'add_beat',
          beatId: 'beat_latency_v2',
          beat: { title: 'Opening', action: '', look: 'Cinematic light', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'beat_latency_v2',
          shotId: 'shot_latency_v2',
          shot: {
            line: 'Product reveal',
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
          },
          beforeShotId: null,
        },
      ],
    });
    await waitForCondition(
      async () => ((await fileExists(pendingFile)) ? true : null),
      'schema-2 pending publication',
      STUDIO_DIRECTOR_COMMAND_WAIT_MS * 2
    );
    await writerPollStarted;
    if (pendingSweep === null) throw new Error('schema-2 pending sweep was not scheduled');
    (pendingSweep as () => void)();

    // This V2 fixture is a scheduler/functional oracle, not a duplicate wall-clock benchmark.
    // The loaded V1 fixture above owns p50/p95/max; gating writer polling on the durable
    // notification keeps parallel-suite contention from masquerading as a production regression.
    const notifiedProjectId = await notification;
    await expect(applying).resolves.toMatchObject({ status: 'applied', appliedRevision: project.revision + 1 });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1 },
    });
    expect(notifiedProjectId).toBe(project.id);
    expect(notificationCount).toBe(1);
    expect(writerPollDelays).toEqual([STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS]);
    expect(observedDelays.filter((delayMs) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS)).toEqual([
      STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
    ]);
    expect(STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(
      (STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS - STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS) / 2
    );
    await processor.stop();
  }, 60_000);
});
