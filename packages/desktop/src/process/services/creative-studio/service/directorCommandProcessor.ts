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
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  type StudioDirectorAutoApplyCommandRecordV2,
  type StudioDirectorMutationReceiptV2,
  type StudioDirectorQueryCommandRecordV2,
  type StudioDirectorQueryFailureCodeV2,
  type StudioDirectorQueryReceiptV2,
  type StudioDirectorCommandRejectionCodeV2,
  type StudioDirectorCommandExpiryCode,
  type StudioDirectorCommandIndeterminateCode,
} from '@/common/types/project/creativeStudioTypes';
import {
  CreativeStudioStoreError,
  type CreativeStudioStore,
  type StudioProjectCommitFacts,
} from '@process/services/creative-studio/store';
import { StudioDirectorCommandApplyErrorV2, type StudioDirectorCommandServiceV2 } from './directorCommandService';
import type { CreativeStudioServiceV2 } from './v2Service';
import { CreativeStudioServiceError } from './projectMutations';
import type { StudioDirectorCommandMailboxV2 } from './directorCommandMailbox';
import {
  isStudioDirectorQueryCommandV2,
  isStudioDirectorQueryReceiptV2,
  parseStudioDirectorCommandReceiptV2,
  snapshotStudioDirectorQueryResultV2,
  studioDirectorQueryForCommandV2,
} from './directorCommandContracts';

export type StudioDirectorCommandProcessorV2 = {
  start(): Promise<void>;
  trigger(projectId: string, commandId?: string): void;
  stop(): Promise<void>;
};

export type StudioDirectorCommitTrackerV2 = {
  expect(command: StudioDirectorAutoApplyCommandRecordV2): void;
  observe(facts: StudioProjectCommitFacts): void;
  materialize(receipt: StudioDirectorMutationReceiptV2): void;
  pendingReceipt(projectId: string, commandId: string): StudioDirectorMutationReceiptV2 | null;
  clear(projectId: string, commandId: string): void;
};

type IntervalHandle = unknown;

export type StudioDirectorCommandProcessorDepsV2 = {
  store: Pick<CreativeStudioStore, 'getProjectV2'>;
  mailbox: StudioDirectorCommandMailboxV2;
  service: StudioDirectorCommandServiceV2 & Pick<CreativeStudioServiceV2, 'getProjectStatus' | 'listRoutes'>;
  tracker: StudioDirectorCommitTrackerV2;
  queryAuthorityActive?: () => boolean;
  onProjectUpdated(projectId: string): void;
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => IntervalHandle;
  clearInterval?: (handle: IntervalHandle) => void;
  logError?: (message: string, error: unknown) => void;
};

type ExpectedCommitV2 = Readonly<{
  projectId: string;
  commandId: string;
  expectedRevision: number;
  createdBeatIds: readonly string[];
  createdShotIds: readonly string[];
}>;

const stateKey = (projectId: string, commandId: string): string => `${projectId}\0${commandId}`;

/** Tracks the schema-2 project-write-to-receipt crash window without filesystem authority. */
export const createStudioDirectorCommitTrackerV2 = (): StudioDirectorCommitTrackerV2 => {
  const expectations = new Map<string, ExpectedCommitV2>();
  const terminals = new Map<string, StudioDirectorMutationReceiptV2>();

  const materialize = (receipt: StudioDirectorMutationReceiptV2): void => {
    const key = stateKey(receipt.projectId, receipt.commandId);
    if (terminals.has(key)) return;
    terminals.set(key, Object.freeze(structuredClone(receipt)));
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
          createdBeatIds: Object.freeze([]),
          createdShotIds: Object.freeze([]),
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
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: expected.commandId,
        projectId: expected.projectId,
        expectedRevision: expected.expectedRevision,
        decidedAt: facts.committedAt,
        status: 'applied',
        appliedRevision: facts.committedRevision,
        createdBeatIds: [...expected.createdBeatIds],
        createdShotIds: [...expected.createdShotIds],
      });
    },

    materialize,

    pendingReceipt(projectId, commandId): StudioDirectorMutationReceiptV2 | null {
      const receipt = terminals.get(stateKey(projectId, commandId));
      return receipt === undefined ? null : structuredClone(receipt);
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

/** Coordinates the schema-2 command lifecycle. */
export const createStudioDirectorCommandProcessorV2 = (
  deps: StudioDirectorCommandProcessorDepsV2
): StudioDirectorCommandProcessorV2 => {
  const now = deps.now ?? Date.now;
  const scheduleInterval = deps.setInterval ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
  const cancelInterval =
    deps.clearInterval ??
    ((handle: IntervalHandle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
  const logError = deps.logError ?? (() => undefined);
  const queryAuthorityActive = deps.queryAuthorityActive ?? (() => true);
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

  const materialize = (receipt: StudioDirectorMutationReceiptV2): StudioDirectorMutationReceiptV2 => {
    deps.tracker.materialize(receipt);
    return deps.tracker.pendingReceipt(receipt.projectId, receipt.commandId) ?? receipt;
  };

  const completeTerminal = async (
    projectId: string,
    commandId: string,
    receipt: StudioDirectorMutationReceiptV2,
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

  const completeQueryTerminal = async (
    projectId: string,
    commandId: string,
    receipt: StudioDirectorQueryReceiptV2
  ): Promise<void> => {
    await deps.mailbox.writeReceipt(
      projectId,
      receipt,
      receipt.status === 'expired' ? undefined : queryAuthorityActive
    );
    await deps.mailbox.finish(projectId, commandId);
    preStart.delete(stateKey(projectId, commandId));
  };

  const observedRevisionAfter = async (projectId: string, fallback: number | null): Promise<number | null> => {
    try {
      const loaded = await deps.store.getProjectV2(projectId);
      return loaded.status === 'supported' ? loaded.project.revision : loaded.status === 'not_found' ? null : fallback;
    } catch {
      return fallback;
    }
  };

  const rejected = (
    command: StudioDirectorAutoApplyCommandRecordV2,
    observedRevision: number | null,
    reasonCode: StudioDirectorCommandRejectionCodeV2
  ): StudioDirectorMutationReceiptV2 => ({
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    decidedAt: decidedAt(),
    status: 'rejected',
    observedRevision,
    reasonCode,
  });

  const expired = (
    command: StudioDirectorAutoApplyCommandRecordV2,
    observedRevision: number | null,
    reasonCode: StudioDirectorCommandExpiryCode
  ): StudioDirectorMutationReceiptV2 => ({
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    decidedAt: decidedAt(),
    status: 'expired',
    observedRevision,
    reasonCode,
  });

  const indeterminate = (
    command: StudioDirectorAutoApplyCommandRecordV2,
    observedRevision: number | null,
    reasonCode: StudioDirectorCommandIndeterminateCode
  ): StudioDirectorMutationReceiptV2 => ({
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    decidedAt: decidedAt(),
    status: 'indeterminate',
    observedRevision,
    reasonCode,
  });

  const expiredQuery = (
    command: StudioDirectorQueryCommandRecordV2,
    reasonCode: StudioDirectorCommandExpiryCode
  ): StudioDirectorQueryReceiptV2 => ({
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId: command.commandId,
    projectId: command.projectId,
    decidedAt: decidedAt(),
    status: 'expired',
    query: studioDirectorQueryForCommandV2(command),
    reasonCode,
  });

  const failedQuery = (
    command: StudioDirectorQueryCommandRecordV2,
    reasonCode: StudioDirectorQueryFailureCodeV2
  ): StudioDirectorQueryReceiptV2 => ({
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId: command.commandId,
    projectId: command.projectId,
    decidedAt: decidedAt(),
    status: 'failed',
    query: studioDirectorQueryForCommandV2(command),
    reasonCode,
  });

  const queryFailureCode = (
    command: StudioDirectorQueryCommandRecordV2,
    error: unknown
  ): StudioDirectorQueryFailureCodeV2 | null => {
    if (error instanceof CreativeStudioStoreError) {
      if (error.code === 'not_found') return 'project_not_found';
      if (error.code === 'unsupported_prototype_schema') return 'unsupported_prototype_schema';
      if (error.code === 'storage_error') {
        return command.policy === 'list_routes' ? 'route_inventory_unavailable' : 'project_read_unavailable';
      }
      return 'project_read_unavailable';
    }
    if (error instanceof CreativeStudioServiceError) {
      if (error.code === 'provider_error') return 'route_inventory_unavailable';
      if (error.code === 'runtime_inactive') return null;
      if (error.code === 'project_quarantined') return 'project_read_unavailable';
    }
    return command.policy === 'list_routes' ? 'route_inventory_unavailable' : 'project_read_unavailable';
  };

  const answeredQuery = (
    command: StudioDirectorQueryCommandRecordV2,
    result: unknown
  ): StudioDirectorQueryReceiptV2 => {
    const snapshot = snapshotStudioDirectorQueryResultV2(result);
    if (snapshot === null) return failedQuery(command, 'result_mismatch');
    const candidate: StudioDirectorQueryReceiptV2 =
      command.policy === 'get_project_status'
        ? {
            schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
            commandId: command.commandId,
            projectId: command.projectId,
            decidedAt: decidedAt(),
            status: 'answered',
            query: studioDirectorQueryForCommandV2(command) as Extract<
              ReturnType<typeof studioDirectorQueryForCommandV2>,
              { kind: 'get_project_status' }
            >,
            result: snapshot as Awaited<ReturnType<CreativeStudioServiceV2['getProjectStatus']>>,
          }
        : {
            schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
            commandId: command.commandId,
            projectId: command.projectId,
            decidedAt: decidedAt(),
            status: 'answered',
            query: { kind: 'list_routes' },
            result: snapshot as Awaited<ReturnType<CreativeStudioServiceV2['listRoutes']>>,
          };
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    } catch {
      return failedQuery(command, 'result_mismatch');
    }
    if (bytes > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) return failedQuery(command, 'response_too_large');
    const parsed = parseStudioDirectorCommandReceiptV2({
      projectId: command.projectId,
      commandId: command.commandId,
      value: candidate,
    });
    if (parsed.status !== 'valid') return failedQuery(command, 'result_mismatch');
    return parsed.record as StudioDirectorQueryReceiptV2;
  };

  const processCommand = async (projectId: string, commandId: string): Promise<void> => {
    try {
      const durableReceipt = await deps.mailbox.readReceipt(projectId, commandId);
      if (durableReceipt !== null) {
        if (durableReceipt.status !== 'valid') {
          if (durableReceipt.status === 'invalid') {
            safeLog(
              '[CreativeStudio] Director command processing deferred by an invalid durable receipt',
              new Error('InvalidStudioDirectorCommandReceipt')
            );
          }
          return;
        }
        if (isStudioDirectorQueryReceiptV2(durableReceipt.record)) {
          await deps.mailbox.finish(projectId, commandId);
          preStart.delete(stateKey(projectId, commandId));
          return;
        }
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

      const pending = await deps.mailbox.readPending(projectId, commandId);
      if (pending === null) {
        const repairMarker = deps.tracker.pendingReceipt(projectId, commandId);
        if (repairMarker !== null) {
          await completeTerminal(projectId, commandId, repairMarker, true);
          return;
        }
        preStart.delete(stateKey(projectId, commandId));
        return;
      }
      if (pending.status === 'unsupported_prototype_schema') {
        preStart.delete(stateKey(projectId, commandId));
        return;
      }
      if (pending.status === 'invalid') {
        const receipt = materialize({
          schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
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
      if (isStudioDirectorQueryCommandV2(command)) {
        if (preStart.has(stateKey(projectId, commandId))) {
          await completeQueryTerminal(projectId, commandId, expiredQuery(command, 'expired_after_restart'));
          return;
        }
        if (now() >= Date.parse(command.deadlineAt)) {
          await completeQueryTerminal(projectId, commandId, expiredQuery(command, 'deadline_elapsed'));
          return;
        }
        if (!queryAuthorityActive()) return;
        try {
          const result =
            command.policy === 'get_project_status'
              ? await deps.service.getProjectStatus({ projectId: command.projectId, detail: command.detail })
              : await deps.service.listRoutes({ projectId: command.projectId });
          // The active graph may be revoked while provider or project I/O is
          // in flight. A superseded graph must not publish a fresh answer.
          if (!queryAuthorityActive()) return;
          await completeQueryTerminal(projectId, commandId, answeredQuery(command, result));
        } catch (error) {
          const reasonCode = queryFailureCode(command, error);
          if (reasonCode !== null) {
            await completeQueryTerminal(projectId, commandId, failedQuery(command, reasonCode));
          }
        }
        return;
      }

      const repairMarker = deps.tracker.pendingReceipt(projectId, commandId);
      if (repairMarker !== null) {
        await completeTerminal(projectId, commandId, repairMarker, true);
        return;
      }

      let loaded: Awaited<ReturnType<typeof deps.store.getProjectV2>>;
      try {
        loaded = await deps.store.getProjectV2(projectId);
      } catch (error) {
        if (isStoreError(error, 'not_found')) loaded = { status: 'not_found', projectId };
        else return;
      }
      if (loaded.status === 'unsupported_prototype_schema') {
        preStart.delete(stateKey(projectId, commandId));
        return;
      }
      if (loaded.status === 'not_found') {
        await completeTerminal(projectId, commandId, materialize(rejected(command, null, 'project_not_found')), true);
        return;
      }
      const project = loaded.project;

      const isPreStart = preStart.has(stateKey(projectId, commandId));
      if (isPreStart) {
        const receipt: StudioDirectorMutationReceiptV2 =
          project.revision === command.expectedRevision
            ? expired(command, project.revision, 'expired_after_restart')
            : project.revision < command.expectedRevision
              ? rejected(command, project.revision, 'future_revision')
              : indeterminate(command, project.revision, 'indeterminate_after_restart');
        await completeTerminal(projectId, commandId, materialize(receipt), true);
        return;
      }

      const latestApplyStartMs = Date.parse(command.deadlineAt) - STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS;
      let terminal: StudioDirectorMutationReceiptV2 | null = null;
      if (now() >= latestApplyStartMs) {
        terminal = expired(command, project.revision, 'deadline_elapsed');
      } else if (project.revision > command.expectedRevision) {
        terminal = rejected(command, project.revision, 'stale_revision');
      } else if (project.revision < command.expectedRevision) {
        terminal = rejected(command, project.revision, 'future_revision');
      }
      if (terminal !== null) {
        await completeTerminal(projectId, commandId, materialize(terminal), true);
        return;
      }

      deps.tracker.expect(command);
      try {
        const result = await deps.service.apply(command, latestApplyStartMs, { commitTag: command.commandId });
        terminal = {
          schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
          commandId,
          projectId,
          expectedRevision: command.expectedRevision,
          decidedAt: result.project.updatedAt,
          status: 'applied',
          appliedRevision: result.appliedRevision,
          createdBeatIds: [...result.createdBeatIds],
          createdShotIds: [...result.createdShotIds],
        };
      } catch (error) {
        const provenCommit = deps.tracker.pendingReceipt(projectId, commandId);
        if (provenCommit !== null) {
          terminal = provenCommit;
        } else if (error instanceof StudioDirectorCommandApplyErrorV2) {
          if (error.reasonCode === 'deadline_elapsed') {
            terminal = expired(command, project.revision, 'deadline_elapsed');
          } else {
            const reasonCode: StudioDirectorCommandRejectionCodeV2 =
              error.reasonCode === 'undo_conflict' ? 'invalid_operation' : error.reasonCode;
            terminal = rejected(command, project.revision, reasonCode);
          }
        } else if (isStoreError(error, 'stale_project')) {
          terminal = rejected(command, await observedRevisionAfter(projectId, project.revision), 'stale_revision');
        } else if (isStoreError(error, 'not_found')) {
          terminal = rejected(command, null, 'project_not_found');
        } else if (isStoreError(error, 'storage_error')) {
          terminal = indeterminate(
            command,
            await observedRevisionAfter(projectId, project.revision),
            'commit_attribution_unknown'
          );
        } else {
          if (deps.tracker.pendingReceipt(projectId, commandId) === null) {
            deps.tracker.clear(projectId, commandId);
          }
          return;
        }
      }

      await completeTerminal(projectId, commandId, materialize(terminal), true);
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
      slotCursor = null;
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
      receiptCursor = null;
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
      .catch((error: unknown) => {
        pendingCursor = null;
        safeLog('[CreativeStudio] Director command pending sweep deferred', error);
      })
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
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(globalOperations);
      }
      while (projectQueues.size > 0) {
        const pending = [...projectQueues.values()];
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(pending);
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
      await deps.mailbox.dispose();
    })();
    return stopPromise;
  };

  return { start, trigger, stop };
};
