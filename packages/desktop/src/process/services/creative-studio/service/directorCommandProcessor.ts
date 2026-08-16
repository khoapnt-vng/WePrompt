/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS,
  STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_MAX_SCENES,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandRecordV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  CreativeStudioStoreError,
  type CreativeStudioStore,
  type StudioProjectCommitFacts,
} from '@process/services/creative-studio/store';
import { StudioDirectorCommandApplyError, type StudioDirectorCommandService } from './directorCommandService';
import type { StudioDirectorCommandMailbox } from './directorCommandMailbox';

export type StudioDirectorCommandProcessor = {
  start(): Promise<void>;
  trigger(projectId: string, commandId?: string): void;
  stop(): Promise<void>;
};

export type StudioDirectorCommitTracker = {
  expect(command: StudioDirectorCommandRecordV1): void;
  observe(facts: StudioProjectCommitFacts): void;
  materialize(receipt: StudioDirectorCommandReceiptV1): void;
  pendingReceipt(projectId: string, commandId: string): StudioDirectorCommandReceiptV1 | null;
  clear(projectId: string, commandId: string): void;
};

type IntervalHandle = unknown;

export type StudioDirectorCommandProcessorDeps = {
  store: Pick<CreativeStudioStore, 'getProject'>;
  mailbox: StudioDirectorCommandMailbox;
  service: StudioDirectorCommandService;
  tracker: StudioDirectorCommitTracker;
  onProjectUpdated(projectId: string): void;
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => IntervalHandle;
  clearInterval?: (handle: IntervalHandle) => void;
  logError?: (message: string, error: unknown) => void;
};

type ExpectedCommit = Readonly<{
  projectId: string;
  commandId: string;
  expectedRevision: number;
  createdSceneIds: readonly string[];
}>;

const stateKey = (projectId: string, commandId: string): string => `${projectId}\0${commandId}`;

const copyReceipt = (receipt: StudioDirectorCommandReceiptV1): StudioDirectorCommandReceiptV1 =>
  structuredClone(receipt);

/** Pure synchronous authority for the project write-to-return crash window. */
export const createStudioDirectorCommitTracker = (): StudioDirectorCommitTracker => {
  const expectations = new Map<string, ExpectedCommit>();
  const terminals = new Map<string, StudioDirectorCommandReceiptV1>();

  const materialize = (receipt: StudioDirectorCommandReceiptV1): void => {
    const key = stateKey(receipt.projectId, receipt.commandId);
    if (terminals.has(key)) return;
    terminals.set(key, Object.freeze(copyReceipt(receipt)));
  };

  return {
    expect(command): void {
      const key = stateKey(command.projectId, command.commandId);
      if (expectations.has(key) || terminals.has(key)) return;
      expectations.set(
        key,
        Object.freeze({
          projectId: command.projectId,
          commandId: command.commandId,
          expectedRevision: command.expectedRevision,
          createdSceneIds: Object.freeze(
            command.operations
              .filter((operation) => operation.kind === 'add_scene')
              .map((operation) => operation.sceneId)
          ),
        })
      );
    },

    observe(facts): void {
      if (facts.commitTag === null) return;
      const expected = expectations.get(stateKey(facts.projectId, facts.commitTag));
      if (
        expected === undefined ||
        facts.projectId !== expected.projectId ||
        facts.previousRevision !== expected.expectedRevision ||
        facts.committedRevision !== expected.expectedRevision + 1
      ) {
        return;
      }
      materialize({
        schemaVersion: 1,
        commandId: expected.commandId,
        projectId: expected.projectId,
        expectedRevision: expected.expectedRevision,
        decidedAt: facts.committedAt,
        status: 'applied',
        appliedRevision: facts.committedRevision,
        createdSceneIds: [...expected.createdSceneIds],
      });
    },

    materialize,

    pendingReceipt(projectId, commandId): StudioDirectorCommandReceiptV1 | null {
      const receipt = terminals.get(stateKey(projectId, commandId));
      return receipt === undefined ? null : copyReceipt(receipt);
    },

    clear(projectId, commandId): void {
      const key = stateKey(projectId, commandId);
      expectations.delete(key);
      terminals.delete(key);
    },
  };
};

const isStoreError = (error: unknown, code: CreativeStudioStoreError['code']): boolean =>
  error instanceof CreativeStudioStoreError && error.code === code;

/** Coordinates the strict startup epoch, fast-path watcher, and bounded repair sweeps. */
export const createStudioDirectorCommandProcessor = (
  deps: StudioDirectorCommandProcessorDeps
): StudioDirectorCommandProcessor => {
  const now = deps.now ?? Date.now;
  const scheduleInterval = deps.setInterval ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
  const cancelInterval =
    deps.clearInterval ??
    ((handle: IntervalHandle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
  const logError = deps.logError ?? (() => undefined);
  const preStart = new Set<string>();
  const projectQueues = new Map<string, Promise<void>>();
  const globalOperations = new Set<Promise<void>>();
  let pendingCursor: string | null = null;
  let slotCursor: string | null = null;
  let receiptCursor: string | null = null;
  let pendingOperation: Promise<void> | null = null;
  let maintenanceOperation: Promise<void> | null = null;
  let closeWatcher: (() => void) | null = null;
  let pendingInterval: IntervalHandle | null = null;
  let maintenanceInterval: IntervalHandle | null = null;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopping = false;

  const safeLog = (message: string, error: unknown): void => {
    try {
      logError(message, error);
    } catch {
      // Diagnostics cannot change durable command authority.
    }
  };

  const decidedAt = (): string => new Date(now()).toISOString();

  const materialize = (receipt: StudioDirectorCommandReceiptV1): StudioDirectorCommandReceiptV1 => {
    deps.tracker.materialize(receipt);
    return deps.tracker.pendingReceipt(receipt.projectId, receipt.commandId) ?? receipt;
  };

  const completeTerminal = async (
    projectId: string,
    commandId: string,
    receipt: StudioDirectorCommandReceiptV1,
    ownedByCurrentProcess: boolean
  ): Promise<void> => {
    await deps.mailbox.writeReceipt(projectId, receipt);
    await deps.mailbox.finish(projectId, commandId);
    deps.tracker.clear(projectId, commandId);
    preStart.delete(stateKey(projectId, commandId));
    if (!ownedByCurrentProcess || receipt.status !== 'applied') return;
    try {
      deps.onProjectUpdated(projectId);
    } catch (error) {
      safeLog('[CreativeStudio] Director command project notification failed', error);
    }
  };

  const observedRevisionAfter = async (projectId: string, fallback: number | null): Promise<number | null> => {
    try {
      return (await deps.store.getProject(projectId))?.revision ?? null;
    } catch {
      return fallback;
    }
  };

  const processCommand = async (projectId: string, commandId: string): Promise<void> => {
    try {
      const durableReceipt = await deps.mailbox.readReceipt(projectId, commandId);
      if (durableReceipt !== null) {
        const marker = deps.tracker.pendingReceipt(projectId, commandId);
        await deps.mailbox.finish(projectId, commandId);
        deps.tracker.clear(projectId, commandId);
        preStart.delete(stateKey(projectId, commandId));
        if (marker?.status === 'applied') {
          try {
            deps.onProjectUpdated(projectId);
          } catch (error) {
            safeLog('[CreativeStudio] Director command project notification failed', error);
          }
        }
        return;
      }

      const repairMarker = deps.tracker.pendingReceipt(projectId, commandId);
      if (repairMarker !== null) {
        await completeTerminal(projectId, commandId, repairMarker, true);
        return;
      }

      const pending = await deps.mailbox.readPending(projectId, commandId);
      if (pending === null) {
        preStart.delete(stateKey(projectId, commandId));
        return;
      }
      if (pending.status === 'invalid') {
        const receipt = materialize({
          schemaVersion: 1,
          commandId: pending.commandId,
          projectId,
          expectedRevision: pending.expectedRevision,
          decidedAt: decidedAt(),
          status: 'rejected',
          observedRevision: null,
          reasonCode: pending.reasonCode,
        });
        await completeTerminal(projectId, commandId, receipt, true);
        return;
      }

      const command = pending.record;
      let project: Awaited<ReturnType<typeof deps.store.getProject>>;
      try {
        project = await deps.store.getProject(projectId);
      } catch (error) {
        if (isStoreError(error, 'not_found')) project = null;
        else return;
      }
      if (project === null) {
        const receipt = materialize({
          schemaVersion: 1,
          commandId,
          projectId,
          expectedRevision: command.expectedRevision,
          decidedAt: decidedAt(),
          status: 'rejected',
          observedRevision: null,
          reasonCode: 'project_not_found',
        });
        await completeTerminal(projectId, commandId, receipt, true);
        return;
      }

      const isPreStart = preStart.has(stateKey(projectId, commandId));
      if (isPreStart) {
        const receipt: StudioDirectorCommandReceiptV1 =
          project.revision === command.expectedRevision
            ? {
                schemaVersion: 1,
                commandId,
                projectId,
                expectedRevision: command.expectedRevision,
                decidedAt: decidedAt(),
                status: 'expired',
                observedRevision: project.revision,
                reasonCode: 'expired_after_restart',
              }
            : project.revision < command.expectedRevision
              ? {
                  schemaVersion: 1,
                  commandId,
                  projectId,
                  expectedRevision: command.expectedRevision,
                  decidedAt: decidedAt(),
                  status: 'rejected',
                  observedRevision: project.revision,
                  reasonCode: 'future_revision',
                }
              : {
                  schemaVersion: 1,
                  commandId,
                  projectId,
                  expectedRevision: command.expectedRevision,
                  decidedAt: decidedAt(),
                  status: 'indeterminate',
                  observedRevision: project.revision,
                  reasonCode: 'indeterminate_after_restart',
                };
        await completeTerminal(projectId, commandId, materialize(receipt), true);
        return;
      }

      const latestApplyStartMs = Date.parse(command.deadlineAt) - STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS;
      let terminal: StudioDirectorCommandReceiptV1 | null = null;
      if (now() >= latestApplyStartMs) {
        terminal = {
          schemaVersion: 1,
          commandId,
          projectId,
          expectedRevision: command.expectedRevision,
          decidedAt: decidedAt(),
          status: 'expired',
          observedRevision: project.revision,
          reasonCode: 'deadline_elapsed',
        };
      } else if (project.revision > command.expectedRevision) {
        terminal = {
          schemaVersion: 1,
          commandId,
          projectId,
          expectedRevision: command.expectedRevision,
          decidedAt: decidedAt(),
          status: 'rejected',
          observedRevision: project.revision,
          reasonCode: 'stale_revision',
        };
      } else if (project.revision < command.expectedRevision) {
        terminal = {
          schemaVersion: 1,
          commandId,
          projectId,
          expectedRevision: command.expectedRevision,
          decidedAt: decidedAt(),
          status: 'rejected',
          observedRevision: project.revision,
          reasonCode: 'future_revision',
        };
      } else if (project.sceneOrder.length > STUDIO_MAX_SCENES) {
        terminal = {
          schemaVersion: 1,
          commandId,
          projectId,
          expectedRevision: command.expectedRevision,
          decidedAt: decidedAt(),
          status: 'rejected',
          observedRevision: project.revision,
          reasonCode: 'project_over_capacity',
        };
      }
      if (terminal !== null) {
        await completeTerminal(projectId, commandId, materialize(terminal), true);
        return;
      }

      deps.tracker.expect(command);
      try {
        const result = await deps.service.apply(command, latestApplyStartMs, { commitTag: command.commandId });
        terminal = {
          schemaVersion: 1,
          commandId,
          projectId,
          expectedRevision: command.expectedRevision,
          decidedAt: result.project.updatedAt,
          status: 'applied',
          appliedRevision: result.appliedRevision,
          createdSceneIds: [...result.createdSceneIds],
        };
      } catch (error) {
        const provenCommit = deps.tracker.pendingReceipt(projectId, commandId);
        if (provenCommit !== null) {
          terminal = provenCommit;
        } else if (error instanceof StudioDirectorCommandApplyError) {
          terminal =
            error.reasonCode === 'deadline_elapsed'
              ? {
                  schemaVersion: 1,
                  commandId,
                  projectId,
                  expectedRevision: command.expectedRevision,
                  decidedAt: decidedAt(),
                  status: 'expired',
                  observedRevision: project.revision,
                  reasonCode: 'deadline_elapsed',
                }
              : {
                  schemaVersion: 1,
                  commandId,
                  projectId,
                  expectedRevision: command.expectedRevision,
                  decidedAt: decidedAt(),
                  status: 'rejected',
                  observedRevision: project.revision,
                  reasonCode: error.reasonCode,
                };
        } else if (isStoreError(error, 'stale_project')) {
          terminal = {
            schemaVersion: 1,
            commandId,
            projectId,
            expectedRevision: command.expectedRevision,
            decidedAt: decidedAt(),
            status: 'rejected',
            observedRevision: await observedRevisionAfter(projectId, project.revision),
            reasonCode: 'stale_revision',
          };
        } else if (isStoreError(error, 'not_found')) {
          terminal = {
            schemaVersion: 1,
            commandId,
            projectId,
            expectedRevision: command.expectedRevision,
            decidedAt: decidedAt(),
            status: 'rejected',
            observedRevision: null,
            reasonCode: 'project_not_found',
          };
        } else if (isStoreError(error, 'storage_error')) {
          terminal = {
            schemaVersion: 1,
            commandId,
            projectId,
            expectedRevision: command.expectedRevision,
            decidedAt: decidedAt(),
            status: 'indeterminate',
            observedRevision: await observedRevisionAfter(projectId, project.revision),
            reasonCode: 'commit_attribution_unknown',
          };
        } else {
          if (deps.tracker.pendingReceipt(projectId, commandId) === null) {
            deps.tracker.clear(projectId, commandId);
          }
          return;
        }
      }

      const frozen = materialize(terminal);
      await completeTerminal(projectId, commandId, frozen, true);
    } catch (error) {
      safeLog('[CreativeStudio] Director command processing deferred', error);
    }
  };

  const enqueueProject = (projectId: string, commandId: string): Promise<void> => {
    const previous = projectQueues.get(projectId) ?? Promise.resolve();
    const next = previous.catch((): undefined => undefined).then(() => processCommand(projectId, commandId));
    projectQueues.set(projectId, next);
    void next
      .finally(() => {
        if (projectQueues.get(projectId) === next) projectQueues.delete(projectId);
      })
      .catch((): undefined => undefined);
    return next;
  };

  const runPendingSweep = async (): Promise<void> => {
    const page = await deps.mailbox.listPendingPage(pendingCursor, STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS);
    pendingCursor = page.nextCursor;
    await Promise.all(page.items.map(({ projectId, commandId }) => enqueueProject(projectId, commandId)));
  };

  const runMaintenance = async (): Promise<void> => {
    const current = new Date(now()).toISOString();
    try {
      const page = await deps.mailbox.releaseOrphanedSlotsPage(
        slotCursor,
        current,
        STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS
      );
      slotCursor = page.nextCursor;
    } catch (error) {
      safeLog('[CreativeStudio] Director command slot maintenance deferred', error);
    }
    try {
      const cutoff = new Date(Date.parse(current) - STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS).toISOString();
      const page = await deps.mailbox.pruneReceiptsPage(
        receiptCursor,
        cutoff,
        STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS
      );
      receiptCursor = page.nextCursor;
    } catch (error) {
      safeLog('[CreativeStudio] Director command receipt maintenance deferred', error);
    }
  };

  const trackGlobal = (operation: Promise<void>): Promise<void> => {
    globalOperations.add(operation);
    void operation.finally(() => globalOperations.delete(operation)).catch((): undefined => undefined);
    return operation;
  };

  const schedulePendingSweep = (): Promise<void> => {
    if (pendingOperation !== null) return pendingOperation;
    const operation = runPendingSweep()
      .catch((error: unknown) => safeLog('[CreativeStudio] Director command pending sweep deferred', error))
      .finally(() => {
        if (pendingOperation === operation) pendingOperation = null;
      });
    pendingOperation = operation;
    return trackGlobal(operation);
  };

  const scheduleMaintenance = (): Promise<void> => {
    if (maintenanceOperation !== null) return maintenanceOperation;
    const operation = runMaintenance().finally(() => {
      if (maintenanceOperation === operation) maintenanceOperation = null;
    });
    maintenanceOperation = operation;
    return trackGlobal(operation);
  };

  const clearTimers = (): void => {
    if (pendingInterval !== null) {
      cancelInterval(pendingInterval);
      pendingInterval = null;
    }
    if (maintenanceInterval !== null) {
      cancelInterval(maintenanceInterval);
      maintenanceInterval = null;
    }
  };

  const closeInstalledWatcher = async (): Promise<void> => {
    const close = closeWatcher;
    closeWatcher = null;
    if (close !== null) await close();
  };

  const start = (): Promise<void> => {
    startPromise ??= (async () => {
      let snapshotCursor: string | null = null;
      do {
        // Startup is intentionally strict and exhausts a fresh process-local cursor.
        // eslint-disable-next-line no-await-in-loop
        const page = await deps.mailbox.snapshotPendingPage(snapshotCursor, STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS);
        for (const { projectId, commandId } of page.items) preStart.add(stateKey(projectId, commandId));
        snapshotCursor = page.nextCursor;
      } while (snapshotCursor !== null);
      if (stopping) return;
      try {
        closeWatcher = await deps.mailbox.watch((projectId, commandId) => {
          if (stopping) return;
          if (commandId === undefined) void schedulePendingSweep();
          else void enqueueProject(projectId, commandId);
        });
        if (stopping) {
          await closeInstalledWatcher();
          return;
        }
        await schedulePendingSweep();
        if (stopping) return;
        pendingInterval = scheduleInterval(() => {
          if (!stopping) void schedulePendingSweep();
        }, STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS);
        maintenanceInterval = scheduleInterval(() => {
          if (!stopping) void scheduleMaintenance();
        }, STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS);
      } catch (error) {
        clearTimers();
        await closeInstalledWatcher();
        throw error;
      }
    })();
    return startPromise;
  };

  const trigger = (projectId: string, commandId?: string): void => {
    if (stopping) return;
    if (commandId === undefined) void schedulePendingSweep();
    else void enqueueProject(projectId, commandId);
  };

  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      stopping = true;
      clearTimers();
      await closeInstalledWatcher();
      if (startPromise !== null) {
        try {
          await startPromise;
        } catch {
          // Startup error remains owned by start(); cleanup still completes.
        }
      }
      clearTimers();
      await closeInstalledWatcher();
      while (globalOperations.size > 0) {
        // Operations can enqueue project chains, so drain the global layer first.
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(globalOperations);
      }
      while (projectQueues.size > 0) {
        const pending = [...projectQueues.values()];
        // A finishing chain can expose its successor; repeat until stable.
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(pending);
        await Promise.resolve();
      }
      await deps.mailbox.dispose();
    })();
    return stopPromise;
  };

  return { start, trigger, stop };
};
