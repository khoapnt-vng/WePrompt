/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import { STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3 } from '@/common/types/project/creativeStudioTypes';
import type { CreativeStudioPilotEntryPointV3 } from '../entryPoint';
import { CreativeStudioPilotServiceErrorV3 } from '../errors';
import {
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  studioPilotDirectorExpectedAuthoringRevision,
  studioPilotDirectorTimestampMs,
  type StudioPilotDirectorCommand,
  type StudioPilotDirectorReceipt,
  type StudioPilotDirectorRejectedReason,
  type StudioPilotDirectorSucceededReceipt,
} from './contracts';
import {
  StudioPilotDirectorMailboxError,
  type StudioPilotDirectorCommandStatus,
  type StudioPilotDirectorMailbox,
} from './mailbox';

export type StudioPilotDirectorProcessor = {
  processProject(projectId: string, commandId?: string): Promise<StudioPilotDirectorReceipt | null>;
  readCommandStatus(projectId: string, commandId: string): Promise<StudioPilotDirectorCommandStatus>;
};

export type StudioPilotDirectorProcessorDeps = {
  /** One shared facade owns load, prepare, and mutation identity/authority. */
  entryPoint: Pick<CreativeStudioPilotEntryPointV3, 'loadProjectV3' | 'preparePhotoV3' | 'applyMutationBatchV3'>;
  mailbox: StudioPilotDirectorMailbox;
  processorId?: string;
  now?: () => number;
  logError?: (message: string, error: unknown) => void;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;

const rejectedReason = (error: unknown): StudioPilotDirectorRejectedReason => {
  if (error instanceof CreativeStudioPilotServiceErrorV3) return error.code;
  if (error instanceof StudioPilotDirectorMailboxError && error.code === 'busy') return 'busy';
  return 'storage_error';
};

/** Executes schema-11 records through exactly one injected schema-6 Pilot facade. */
export const createStudioPilotDirectorProcessor = (
  deps: StudioPilotDirectorProcessorDeps
): StudioPilotDirectorProcessor => {
  const now = deps.now ?? Date.now;
  const processorId = deps.processorId ?? `director_${randomBytes(16).toString('hex')}`;
  if (!SAFE_ID.test(processorId)) throw new StudioPilotDirectorMailboxError('invalid_payload');
  const logError = deps.logError ?? (() => undefined);
  const projectQueues = new Map<string, Promise<StudioPilotDirectorReceipt | null>>();

  const readNow = (): number => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new StudioPilotDirectorMailboxError('storage_error');
    return value;
  };

  const decidedAt = (): string => new Date(readNow()).toISOString();

  const base = (command: StudioPilotDirectorCommand) => ({
    schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
    commandId: command.commandId,
    projectId: command.projectId,
    policy: command.policy,
    expectedAuthoringRevision: studioPilotDirectorExpectedAuthoringRevision(command),
    decidedAt: decidedAt(),
  });

  const execute = async (command: StudioPilotDirectorCommand): Promise<StudioPilotDirectorReceipt> => {
    try {
      if (command.policy === 'get_project_status') {
        const result = await deps.entryPoint.loadProjectV3(command.projectId);
        if (result.status !== 'supported') {
          throw new CreativeStudioPilotServiceErrorV3(
            result.status === 'not_found'
              ? 'not_found'
              : result.status === 'unsupported'
                ? 'unsupported_project'
                : 'project_quarantined'
          );
        }
        const receipt: StudioPilotDirectorSucceededReceipt = {
          ...base(command),
          policy: command.policy,
          expectedAuthoringRevision: null,
          status: 'succeeded',
          result,
        };
        return receipt;
      }
      if (command.policy === 'prepare_photo') {
        const result = await deps.entryPoint.preparePhotoV3({
          mode: 'create',
          projectId: command.projectId,
          expectedAuthoringRevision: command.expectedAuthoringRevision,
          words: command.words,
          settings: { ...command.settings },
          suggestedHandle: command.suggestedHandle,
          referencePieceIds: [...command.referencePieceIds],
        });
        return {
          ...base(command),
          policy: command.policy,
          expectedAuthoringRevision: command.expectedAuthoringRevision,
          status: 'succeeded',
          result,
        };
      }
      const result = await deps.entryPoint.applyMutationBatchV3({
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId: command.projectId,
        expectedAuthoringRevision: command.expectedAuthoringRevision,
        operations: [{ kind: 'rename_piece', pieceId: command.pieceId, handle: command.handle }],
      });
      return {
        ...base(command),
        policy: command.policy,
        expectedAuthoringRevision: command.expectedAuthoringRevision,
        status: 'succeeded',
        result,
      };
    } catch (error) {
      try {
        logError('[CreativeStudio] Pilot Director command refused', error);
      } catch {
        // Diagnostics cannot change durable command authority.
      }
      return { ...base(command), status: 'rejected', reasonCode: rejectedReason(error) };
    }
  };

  const processOne = async (
    projectId: string,
    requestedCommandId?: string
  ): Promise<StudioPilotDirectorReceipt | null> => {
    const pending = await deps.mailbox.readPending(projectId);
    if (pending === null) return null;
    if (pending.status !== 'valid') throw new StudioPilotDirectorMailboxError('storage_error');
    const command = pending.command;
    if (requestedCommandId !== undefined && requestedCommandId !== command.commandId) return null;

    const existing = await deps.mailbox.readReceipt(projectId, command.commandId);
    if (existing !== null) {
      if (existing.status !== 'valid') throw new StudioPilotDirectorMailboxError('storage_error');
      await deps.mailbox.finish(command);
      return existing.receipt;
    }

    const begun = await deps.mailbox.begin(projectId, processorId);
    if (begun === null || begun.command.commandId !== command.commandId) {
      throw new StudioPilotDirectorMailboxError('storage_error');
    }

    let receipt: StudioPilotDirectorReceipt;
    if (begun.resumed && command.policy !== 'get_project_status') {
      receipt = { ...base(command), status: 'indeterminate', reasonCode: 'indeterminate_after_restart' };
    } else {
      const deadline = studioPilotDirectorTimestampMs(command.deadlineAt);
      if (deadline === null) throw new StudioPilotDirectorMailboxError('storage_error');
      receipt =
        deadline <= readNow()
          ? { ...base(command), status: 'expired', reasonCode: 'deadline_elapsed' }
          : await execute(command);
    }
    await deps.mailbox.writeReceipt(command, receipt);
    await deps.mailbox.finish(command);
    return receipt;
  };

  return {
    processProject(projectId, commandId) {
      if (!SAFE_ID.test(projectId) || (commandId !== undefined && !SAFE_ID.test(commandId))) {
        return Promise.reject(new StudioPilotDirectorMailboxError('invalid_payload'));
      }
      const previous = projectQueues.get(projectId) ?? Promise.resolve(null);
      const operation = previous.catch((): null => null).then(() => processOne(projectId, commandId));
      projectQueues.set(projectId, operation);
      const clearQueue = (): void => {
        if (projectQueues.get(projectId) === operation) projectQueues.delete(projectId);
      };
      void operation.then(clearQueue, clearQueue);
      return operation;
    },

    readCommandStatus(projectId, commandId) {
      return deps.mailbox.readStatus(projectId, commandId);
    },
  };
};
