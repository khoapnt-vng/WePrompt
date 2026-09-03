/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import { STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3 } from '@/common/types/project/creativeStudioTypes';
import type { CreativeStudioProposalSidecarsV4 } from '../../../store/pilot/proposalsV4';
import type { CreativeStudioPilotEntryPointV3 } from '../entryPoint';
import { CreativeStudioPilotServiceErrorV3 } from '../errors';
import {
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  type StudioProposalRecordV4,
  type StudioProposalReplayResultV4,
} from '../../schema2/proposals/proposalContractsV4';
import {
  parseStudioPilotDirectorReceipt,
  STUDIO_PILOT_DIRECTOR_CLOCK_SKEW_MS,
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  studioPilotDirectorProposeBoardCommandSha256,
  studioPilotDirectorExpectedAuthoringRevision,
  studioPilotDirectorTimestampMs,
  type StudioPilotDirectorCommand,
  type StudioPilotDirectorProposeBoardCommand,
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
  /** Installed only with the schema-7 cutover; schema-6 runtimes keep Board proposals unavailable. */
  proposalAuthority?: Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>;
  mintProposalIdentity?: (kind: StudioPilotDirectorProposalIdentityKindV4) => string;
  processorId?: string;
  now?: () => number;
  logError?: (message: string, error: unknown) => void;
};

export type StudioPilotDirectorProposalIdentityKindV4 = 'board' | 'beat' | 'shot';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;

const defaultMintProposalIdentity = (kind: StudioPilotDirectorProposalIdentityKindV4): string =>
  `${kind}_${randomBytes(16).toString('hex')}`;

const rejectedReason = (error: unknown): StudioPilotDirectorRejectedReason => {
  if (error instanceof CreativeStudioPilotServiceErrorV3) return error.code;
  if (error instanceof StudioPilotDirectorMailboxError && error.code === 'busy') return 'busy';
  return 'storage_error';
};

/** Executes wired command-schema-14 records through exactly one injected schema-6 Pilot facade. */
export const createStudioPilotDirectorProcessor = (
  deps: StudioPilotDirectorProcessorDeps
): StudioPilotDirectorProcessor => {
  const now = deps.now ?? Date.now;
  const processorId = deps.processorId ?? `director_${randomBytes(16).toString('hex')}`;
  if (!SAFE_ID.test(processorId)) throw new StudioPilotDirectorMailboxError('invalid_payload');
  const logError = deps.logError ?? (() => undefined);
  const mintProposalIdentity = deps.mintProposalIdentity ?? defaultMintProposalIdentity;
  const projectQueues = new Map<string, Promise<StudioPilotDirectorReceipt | null>>();

  const readNow = (): number => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new StudioPilotDirectorMailboxError('storage_error');
    return value;
  };

  const timestampFromMs = (milliseconds: number): string => {
    try {
      const value = new Date(milliseconds).toISOString();
      if (studioPilotDirectorTimestampMs(value) === null) throw new Error('Invalid timestamp');
      return value;
    } catch {
      throw new StudioPilotDirectorMailboxError('storage_error');
    }
  };

  const commandAlignedTimestamp = (command: StudioPilotDirectorCommand): string => {
    const commandCreatedAt = studioPilotDirectorTimestampMs(command.createdAt);
    if (commandCreatedAt === null) throw new StudioPilotDirectorMailboxError('storage_error');
    return timestampFromMs(Math.max(readNow(), commandCreatedAt));
  };

  const base = (command: StudioPilotDirectorCommand, timestamp = commandAlignedTimestamp(command)) => ({
    schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
    commandId: command.commandId,
    projectId: command.projectId,
    policy: command.policy,
    expectedAuthoringRevision: studioPilotDirectorExpectedAuthoringRevision(command),
    decidedAt: timestamp,
  });

  const reportFailure = (error: unknown): void => {
    try {
      logError('[CreativeStudio] Pilot Director command refused', error);
    } catch {
      // Diagnostics cannot change durable command authority.
    }
  };

  const assertExactProposalResult = (
    expected: StudioProposalRecordV4,
    actual: StudioProposalRecordV4
  ): StudioProposalRecordV4 => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new StudioPilotDirectorMailboxError('storage_error');
    }
    return actual;
  };

  const recordedProposalReceipt = (
    command: StudioPilotDirectorProposeBoardCommand,
    proposal: StudioProposalRecordV4
  ): StudioPilotDirectorSucceededReceipt => {
    const candidate: StudioPilotDirectorSucceededReceipt = {
      ...base(command, proposal.createdAt),
      policy: 'propose_board',
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      status: 'succeeded',
      result: { status: 'recorded', proposal },
    };
    const parsed = parseStudioPilotDirectorReceipt(candidate, command);
    if (
      parsed.status !== 'valid' ||
      parsed.receipt.status !== 'succeeded' ||
      parsed.receipt.policy !== 'propose_board'
    ) {
      throw new StudioPilotDirectorMailboxError('storage_error');
    }
    return parsed.receipt;
  };

  const terminalProposalReceipt = (
    command: StudioPilotDirectorProposeBoardCommand,
    result: Extract<StudioProposalReplayResultV4, { outcome: 'already_decided' }>
  ): StudioPilotDirectorSucceededReceipt => {
    const candidate: StudioPilotDirectorSucceededReceipt = {
      ...base(command, result.decidedAt),
      policy: 'propose_board',
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      status: 'succeeded',
      result: {
        status: result.status,
        proposalId: result.proposalId,
        decidedAt: result.decidedAt,
        appliedRevision: result.appliedRevision,
      },
    };
    const parsed = parseStudioPilotDirectorReceipt(candidate, command);
    if (
      parsed.status !== 'valid' ||
      parsed.receipt.status !== 'succeeded' ||
      parsed.receipt.policy !== 'propose_board'
    ) {
      throw new StudioPilotDirectorMailboxError('storage_error');
    }
    return parsed.receipt;
  };

  const mintBoardProposal = (
    command: StudioPilotDirectorProposeBoardCommand,
    createdAt: string
  ): StudioProposalRecordV4 => {
    const proposalId = deriveStudioProposalIdV4(command.projectId, command.commandId);
    const boardId = mintProposalIdentity('board');
    const beatIds = command.beats.map(() => mintProposalIdentity('beat'));
    const shotIds = command.beats.flatMap((beat) => beat.shots.map(() => mintProposalIdentity('shot')));
    const issuedIds = [proposalId, command.projectId, boardId, ...beatIds, ...shotIds];
    if (issuedIds.some((value) => typeof value !== 'string' || !SAFE_ID.test(value))) {
      throw new StudioPilotDirectorMailboxError('storage_error');
    }
    if (new Set(issuedIds).size !== issuedIds.length) {
      throw new StudioPilotDirectorMailboxError('storage_error');
    }
    return {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
      id: proposalId,
      projectId: command.projectId,
      status: 'pending',
      baseAuthoringRevision: command.expectedAuthoringRevision,
      source: {
        kind: 'director_command',
        commandId: command.commandId,
        commandSha256: studioPilotDirectorProposeBoardCommandSha256(command),
      },
      target: { kind: 'board', boardId },
      issuedMemberIds: { beatIds, shotIds },
      payload: {
        kind: 'create_board',
        handle: command.handle,
        beats: command.beats.map((beat) => ({
          title: beat.title,
          story: beat.story,
          targetSeconds: beat.targetSeconds,
          shots: beat.shots.map((shot) => ({ ...shot })),
        })),
      },
      createdAt,
      expiresAt: deriveStudioProposalExpiresAtV4(createdAt),
      decidedAt: null,
    };
  };

  const executeBoardProposal = async (
    command: StudioPilotDirectorProposeBoardCommand,
    createdAt: string
  ): Promise<StudioPilotDirectorReceipt> => {
    if (deps.proposalAuthority === undefined) {
      return { ...base(command, createdAt), status: 'rejected', reasonCode: 'operation_not_available' };
    }
    const proposal = mintBoardProposal(command, createdAt);
    const result = await deps.proposalAuthority.replayProposalV4({
      projectId: command.projectId,
      proposalId: proposal.id,
      proposal,
    });
    if (result.outcome === 'admitted' || result.outcome === 'already_pending') {
      return recordedProposalReceipt(command, assertExactProposalResult(proposal, result.proposal));
    }
    if (result.outcome === 'already_decided') return terminalProposalReceipt(command, result);
    // Storage ambiguity is not a human rejection. Leave the mailbox command pending so a resumed
    // processor can classify the exact durable proposal state instead of publishing a false receipt.
    if (result.outcome === 'unavailable') throw new StudioPilotDirectorMailboxError('storage_error');
    const reasonCode: StudioPilotDirectorRejectedReason =
      result.outcome === 'busy'
        ? 'proposal_pending'
        : result.outcome === 'identity_collision'
          ? 'identity_collision'
          : result.reason;
    return { ...base(command, createdAt), status: 'rejected', reasonCode };
  };

  const replayBoardProposal = async (
    command: StudioPilotDirectorProposeBoardCommand
  ): Promise<StudioPilotDirectorReceipt | null> => {
    if (deps.proposalAuthority === undefined) return null;
    const proposalId = deriveStudioProposalIdV4(command.projectId, command.commandId);
    const state = await deps.proposalAuthority.getProposalStateV4(command.projectId, proposalId);
    if (state.status === 'accepted' || state.status === 'rejected' || state.status === 'expired') {
      if (state.commandSha256 !== studioPilotDirectorProposeBoardCommandSha256(command)) {
        return { ...base(command), status: 'rejected', reasonCode: 'identity_collision' };
      }
      return terminalProposalReceipt(command, {
        outcome: 'already_decided',
        proposalId: state.proposalId,
        status: state.status,
        decidedAt: state.decidedAt,
        appliedRevision: state.appliedRevision,
      });
    }
    if (state.status !== 'pending') return null;
    const proposal = state.proposal;
    // Validate the immutable proposal against the command before asking replay authority to
    // classify it. A resumed command never remints identities or admits a missing record.
    recordedProposalReceipt(command, proposal);
    const result = await deps.proposalAuthority.replayProposalV4({
      projectId: command.projectId,
      proposalId,
      proposal,
    });
    if (result.outcome === 'already_pending') {
      return recordedProposalReceipt(command, assertExactProposalResult(proposal, result.proposal));
    }
    if (result.outcome === 'already_decided') return terminalProposalReceipt(command, result);
    throw new StudioPilotDirectorMailboxError('storage_error');
  };

  const execute = async (
    command: StudioPilotDirectorCommand,
    proposalCreatedAt?: string
  ): Promise<StudioPilotDirectorReceipt> => {
    if (command.policy === 'propose_board') {
      if (proposalCreatedAt === undefined) throw new StudioPilotDirectorMailboxError('storage_error');
      return executeBoardProposal(command, proposalCreatedAt);
    }
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
      reportFailure(error);
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
      const replayed = command.policy === 'propose_board' ? await replayBoardProposal(command) : null;
      receipt = replayed ?? { ...base(command), status: 'indeterminate', reasonCode: 'indeterminate_after_restart' };
    } else {
      const deadline = studioPilotDirectorTimestampMs(command.deadlineAt);
      const commandCreatedAt = studioPilotDirectorTimestampMs(command.createdAt);
      if (deadline === null || commandCreatedAt === null) throw new StudioPilotDirectorMailboxError('storage_error');
      const observedAtMs = readNow();
      receipt =
        deadline <= observedAtMs
          ? { ...base(command), status: 'expired', reasonCode: 'deadline_elapsed' }
          : command.policy === 'propose_board' && commandCreatedAt - observedAtMs > STUDIO_PILOT_DIRECTOR_CLOCK_SKEW_MS
            ? { ...base(command), status: 'rejected', reasonCode: 'invalid_payload' }
            : await execute(command, command.policy === 'propose_board' ? timestampFromMs(observedAtMs) : undefined);
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
