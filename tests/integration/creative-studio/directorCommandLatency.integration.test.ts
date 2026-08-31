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
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioDirectorCommandWriterV2 } from '@process/resources/builtinMcp/studioDirectorCommandWriter';
import {
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandMailboxV2,
} from '@process/services/creative-studio/service/director/mailbox';
import {
  createStudioDirectorCommandProcessorV2,
  createStudioDirectorCommitTrackerV2,
} from '@process/services/creative-studio/service/director/processor';
import { createStudioDirectorCommandServiceV2 } from '@process/services/creative-studio/service/director/service';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
    await nodeFs.lstat(file);
    return true;
  } catch {
    return false;
  }
};

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
    const created: StudioProjectV2 = await store.createProjectV2({
      name: 'Latency project V2',
      brief: 'Warmup',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const { project } = await store.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: created.id,
        expectedRevision: created.revision,
        operations: [
          {
            kind: 'add_beat',
            beatId: 'beat_latency_v2',
            beat: { title: 'Opening', story: 'A product appears in cinematic light.', targetSeconds: null },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId: 'beat_latency_v2',
            shotId: 'shot_latency_v2',
            shot: { shootingScript: 'Product reveal', durationSeconds: 5 },
            beforeShotId: null,
          },
        ],
      },
      { mutationId: 'seed_latency_v2', capturedAt: new Date(fixtureNowMs).toISOString() }
    );
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
      operations: [{ kind: 'set_brief', brief: 'Latency project updated by the Director.' }],
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
