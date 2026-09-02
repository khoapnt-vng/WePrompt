/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  publishImmutableRecord,
  readBoundedRegularFileWithIdentity,
  RecordIoError,
  removeRegularRecordIfIdentity,
  resolveCompleteDirectorySet,
  resolveConfinedRecordPath,
  type BoundedRegularFileRead,
  type RecordIoFileSystem,
} from '../../recordIo';
import {
  parseStudioPilotDirectorClaim,
  parseStudioPilotDirectorCommand,
  parseStudioPilotDirectorReceipt,
  STUDIO_PILOT_DIRECTOR_CLOCK_SKEW_MS,
  STUDIO_PILOT_DIRECTOR_COMMAND_PHYSICAL_MAX_BYTES,
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  STUDIO_PILOT_DIRECTOR_MAX_RECEIPTS,
  STUDIO_PILOT_DIRECTOR_RECEIPT_MAX_BYTES,
  STUDIO_PILOT_DIRECTOR_RECEIPT_RETENTION_MS,
  serializeStudioPilotDirectorRecord,
  studioPilotDirectorCommandMaxBytes,
  studioPilotDirectorTimestampMs,
  type StudioPilotDirectorClaim,
  type StudioPilotDirectorCommand,
  type StudioPilotDirectorReceipt,
  type StudioPilotDirectorReceiptParseResult,
} from './contracts';

export type StudioPilotDirectorMailboxErrorCode =
  | 'invalid_payload'
  | 'project_not_found'
  | 'busy'
  | 'receipt_capacity'
  | 'storage_error';

export class StudioPilotDirectorMailboxError extends Error {
  readonly code: StudioPilotDirectorMailboxErrorCode;

  constructor(code: StudioPilotDirectorMailboxErrorCode) {
    super(code);
    this.name = 'StudioPilotDirectorMailboxError';
    this.code = code;
  }
}

export type StudioPilotDirectorCommandStatus =
  | { status: 'missing' }
  | { status: 'pending'; command: StudioPilotDirectorCommand }
  | { status: 'terminal'; receipt: StudioPilotDirectorReceipt };

export type StudioPilotDirectorPendingRead =
  | { status: 'valid'; command: StudioPilotDirectorCommand; identity: { dev: number; ino: number } }
  | {
      status: 'unsupported_version' | 'invalid';
      commandId: string | null;
      projectId: string | null;
      identity: { dev: number; ino: number };
    };

export type StudioPilotDirectorClaimRead =
  | { status: 'absent' }
  | { status: 'valid'; claim: StudioPilotDirectorClaim; identity: { dev: number; ino: number } }
  | { status: 'invalid'; identity: { dev: number; ino: number } };

export type StudioPilotDirectorBeginResult = {
  command: StudioPilotDirectorCommand;
  claim: StudioPilotDirectorClaim;
  resumed: boolean;
};

export type StudioPilotDirectorMailbox = {
  submit(value: unknown): Promise<StudioPilotDirectorCommand>;
  readPending(projectId: string): Promise<StudioPilotDirectorPendingRead | null>;
  readReceipt(projectId: string, commandId: string): Promise<StudioPilotDirectorReceiptParseResult | null>;
  readStatus(projectId: string, commandId: string): Promise<StudioPilotDirectorCommandStatus>;
  begin(projectId: string, processorId: string): Promise<StudioPilotDirectorBeginResult | null>;
  writeReceipt(command: StudioPilotDirectorCommand, receipt: StudioPilotDirectorReceipt): Promise<void>;
  finish(command: StudioPilotDirectorCommand): Promise<void>;
  pruneReceipts(projectId: string): Promise<number>;
};

export type StudioPilotDirectorMailboxDeps = {
  resolveVerifiedProjectDirectory(projectId: string): Promise<string | null>;
  fs?: RecordIoFileSystem;
  now?: () => number;
  createTemporaryId?: () => string;
};

type DirectoryAuthority = {
  projectId: string;
  path: string;
  dev: number;
  ino: number;
};

type MailboxDirectories = {
  root: string;
  pending: string;
  processing: string;
  receipts: string;
};

type MailboxFamily = {
  authority: DirectoryAuthority;
  directories: MailboxDirectories;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const FAMILY_ROOT = '.director-v11';
const FAMILY_CHILDREN = ['pending', 'processing', 'receipts'] as const;
const PENDING_FILE = 'command.json';
const CLAIM_FILE = 'claim.json';
const CLAIM_MAX_BYTES = 16 * 1024;

const safeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const neutralize = (error: unknown): StudioPilotDirectorMailboxError =>
  error instanceof StudioPilotDirectorMailboxError
    ? error
    : new StudioPilotDirectorMailboxError(
        error instanceof RecordIoError && error.code === 'already_exists' ? 'busy' : 'storage_error'
      );

const parseJson = (bytes: string): unknown => {
  try {
    return JSON.parse(bytes);
  } catch {
    return null;
  }
};

const serializeBounded = (value: unknown, maximum: number): string => {
  const bytes = serializeStudioPilotDirectorRecord(value);
  if (bytes === null || Buffer.byteLength(bytes, 'utf8') > maximum) {
    throw new StudioPilotDirectorMailboxError('invalid_payload');
  }
  return bytes;
};

/** Creates the schema-13 one-slot mailbox while retaining the established durable family path. */
export const createStudioPilotDirectorMailbox = (deps: StudioPilotDirectorMailboxDeps): StudioPilotDirectorMailbox => {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? Date.now;
  const createTemporaryId = deps.createTemporaryId ?? (() => randomBytes(12).toString('hex'));

  const readNow = (): number => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new StudioPilotDirectorMailboxError('storage_error');
    return value;
  };

  const captureAuthority = async (projectId: string): Promise<DirectoryAuthority> => {
    if (!safeId(projectId)) throw new StudioPilotDirectorMailboxError('invalid_payload');
    const resolved = await deps.resolveVerifiedProjectDirectory(projectId);
    if (resolved === null) throw new StudioPilotDirectorMailboxError('project_not_found');
    const directory = path.resolve(resolved);
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
        throw new RecordIoError('unsafe_path');
      }
      return { projectId, path: directory, dev: stats.dev, ino: stats.ino };
    } catch (error) {
      throw neutralize(error);
    }
  };

  const assertAuthority = async (authority: DirectoryAuthority): Promise<void> => {
    try {
      const reverified = await deps.resolveVerifiedProjectDirectory(authority.projectId);
      if (reverified === null || path.resolve(reverified) !== authority.path) throw new RecordIoError('unsafe_path');
      const stats = await fs.lstat(authority.path);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.dev !== authority.dev ||
        stats.ino !== authority.ino ||
        (await fs.realpath(authority.path)) !== authority.path
      ) {
        throw new RecordIoError('unsafe_path');
      }
    } catch (error) {
      throw neutralize(error);
    }
  };

  const family = async (projectId: string, create: boolean): Promise<MailboxFamily | null> => {
    const authority = await captureAuthority(projectId);
    try {
      const directories = await resolveCompleteDirectorySet({
        fs,
        canonicalRoot: authority.path,
        parent: authority.path,
        rootName: FAMILY_ROOT,
        childNames: FAMILY_CHILDREN,
        createIfWhollyAbsent: create,
        authorizeBeforePublish: () => assertAuthority(authority),
      });
      await assertAuthority(authority);
      return directories === null ? null : { authority, directories };
    } catch (error) {
      throw neutralize(error);
    }
  };

  const pendingPath = (directories: MailboxDirectories): string =>
    resolveConfinedRecordPath(directories.root, directories.pending, PENDING_FILE);
  const claimPath = (directories: MailboxDirectories): string =>
    resolveConfinedRecordPath(directories.root, directories.processing, CLAIM_FILE);
  const receiptPath = (directories: MailboxDirectories, commandId: string): string => {
    if (!safeId(commandId)) throw new StudioPilotDirectorMailboxError('invalid_payload');
    return resolveConfinedRecordPath(directories.root, directories.receipts, `${commandId}.json`);
  };

  const readPendingFrom = async (current: MailboxFamily): Promise<StudioPilotDirectorPendingRead | null> => {
    let file: BoundedRegularFileRead | null;
    try {
      file = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: current.directories.root,
        file: pendingPath(current.directories),
        maxBytes: STUDIO_PILOT_DIRECTOR_COMMAND_PHYSICAL_MAX_BYTES,
      });
      await assertAuthority(current.authority);
    } catch (error) {
      throw neutralize(error);
    }
    if (file === null) return null;
    const parsed = parseStudioPilotDirectorCommand(parseJson(file.bytes));
    if (parsed.status === 'valid') {
      return parsed.command.projectId === current.authority.projectId
        ? { status: 'valid', command: parsed.command, identity: file.identity }
        : {
            status: 'invalid',
            commandId: parsed.command.commandId,
            projectId: parsed.command.projectId,
            identity: file.identity,
          };
    }
    return { ...parsed, identity: file.identity };
  };

  const readClaimFrom = async (current: MailboxFamily): Promise<StudioPilotDirectorClaimRead> => {
    let file: BoundedRegularFileRead | null;
    try {
      file = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: current.directories.root,
        file: claimPath(current.directories),
        maxBytes: CLAIM_MAX_BYTES,
      });
      await assertAuthority(current.authority);
    } catch (error) {
      throw neutralize(error);
    }
    if (file === null) return { status: 'absent' };
    const claim = parseStudioPilotDirectorClaim(parseJson(file.bytes));
    return claim === null
      ? { status: 'invalid', identity: file.identity }
      : { status: 'valid', claim, identity: file.identity };
  };

  const readReceiptFrom = async (
    current: MailboxFamily,
    commandId: string,
    command?: StudioPilotDirectorCommand
  ): Promise<{ parsed: StudioPilotDirectorReceiptParseResult; file: BoundedRegularFileRead } | null> => {
    let file: BoundedRegularFileRead | null;
    try {
      file = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: current.directories.root,
        file: receiptPath(current.directories, commandId),
        maxBytes: STUDIO_PILOT_DIRECTOR_RECEIPT_MAX_BYTES,
      });
      await assertAuthority(current.authority);
    } catch (error) {
      throw neutralize(error);
    }
    if (file === null) return null;
    const parsed = parseStudioPilotDirectorReceipt(parseJson(file.bytes), command);
    return {
      parsed:
        parsed.status === 'valid' &&
        (parsed.receipt.commandId !== commandId || parsed.receipt.projectId !== current.authority.projectId)
          ? { status: 'invalid' }
          : parsed,
      file,
    };
  };

  const removeByIdentity = async (
    current: MailboxFamily,
    file: string,
    identity: { dev: number; ino: number }
  ): Promise<void> => {
    try {
      await removeRegularRecordIfIdentity({
        fs,
        canonicalRoot: current.directories.root,
        file,
        identity,
        isStillAuthorized: async () => {
          await assertAuthority(current.authority);
          return true;
        },
      });
      await assertAuthority(current.authority);
    } catch (error) {
      throw neutralize(error);
    }
  };

  const receiptEntries = async (current: MailboxFamily): Promise<string[]> => {
    try {
      const entries = await fs.readdir(current.directories.receipts, { withFileTypes: true });
      if (
        entries.some(
          (entry) =>
            !entry.isFile() ||
            entry.isSymbolicLink() ||
            !entry.name.endsWith('.json') ||
            !safeId(entry.name.slice(0, -'.json'.length))
        )
      ) {
        throw new RecordIoError('unsafe_file');
      }
      await assertAuthority(current.authority);
      return entries.map((entry) => entry.name.slice(0, -'.json'.length)).toSorted();
    } catch (error) {
      throw neutralize(error);
    }
  };

  const pruneFrom = async (current: MailboxFamily): Promise<number> => {
    const cutoff = readNow() - STUDIO_PILOT_DIRECTOR_RECEIPT_RETENTION_MS;
    let removed = 0;
    for (const commandId of await receiptEntries(current)) {
      // eslint-disable-next-line no-await-in-loop
      const read = await readReceiptFrom(current, commandId);
      if (read === null || read.parsed.status !== 'valid') throw new StudioPilotDirectorMailboxError('storage_error');
      const decidedAt = studioPilotDirectorTimestampMs(read.parsed.receipt.decidedAt);
      if (decidedAt === null || decidedAt > cutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await removeByIdentity(current, receiptPath(current.directories, commandId), read.file.identity);
      removed += 1;
    }
    return removed;
  };

  return {
    async submit(value) {
      const parsed = parseStudioPilotDirectorCommand(value);
      if (parsed.status !== 'valid') throw new StudioPilotDirectorMailboxError('invalid_payload');
      const command = parsed.command;
      const currentTime = readNow();
      const createdAt = studioPilotDirectorTimestampMs(command.createdAt);
      if (createdAt === null || createdAt > currentTime + STUDIO_PILOT_DIRECTOR_CLOCK_SKEW_MS) {
        throw new StudioPilotDirectorMailboxError('invalid_payload');
      }
      const current = await family(command.projectId, true);
      if (current === null) throw new StudioPilotDirectorMailboxError('storage_error');
      await pruneFrom(current);
      const existingPending = await readPendingFrom(current);
      if (existingPending !== null) throw new StudioPilotDirectorMailboxError('busy');
      const existingClaim = await readClaimFrom(current);
      if (existingClaim.status !== 'absent') {
        if (existingClaim.status !== 'valid') throw new StudioPilotDirectorMailboxError('storage_error');
        const terminal = await readReceiptFrom(current, existingClaim.claim.commandId);
        if (terminal === null || terminal.parsed.status !== 'valid') throw new StudioPilotDirectorMailboxError('busy');
        await removeByIdentity(current, claimPath(current.directories), existingClaim.identity);
      }
      if ((await readReceiptFrom(current, command.commandId)) !== null) {
        throw new StudioPilotDirectorMailboxError('busy');
      }
      if ((await receiptEntries(current)).length >= STUDIO_PILOT_DIRECTOR_MAX_RECEIPTS) {
        throw new StudioPilotDirectorMailboxError('receipt_capacity');
      }
      try {
        await assertAuthority(current.authority);
        await publishImmutableRecord({
          fs,
          canonicalRoot: current.directories.root,
          file: pendingPath(current.directories),
          bytes: serializeBounded(command, studioPilotDirectorCommandMaxBytes(command.policy)),
          temporaryId: createTemporaryId(),
        });
        await assertAuthority(current.authority);
        return structuredClone(command);
      } catch (error) {
        throw neutralize(error);
      }
    },

    async readPending(projectId) {
      const current = await family(projectId, false);
      return current === null ? null : readPendingFrom(current);
    },

    async readReceipt(projectId, commandId) {
      const current = await family(projectId, false);
      if (current === null) return null;
      const read = await readReceiptFrom(current, commandId);
      return read?.parsed ?? null;
    },

    async readStatus(projectId, commandId) {
      if (!safeId(projectId) || !safeId(commandId)) throw new StudioPilotDirectorMailboxError('invalid_payload');
      const current = await family(projectId, false);
      if (current === null) return { status: 'missing' };
      const receipt = await readReceiptFrom(current, commandId);
      if (receipt !== null) {
        if (receipt.parsed.status !== 'valid') throw new StudioPilotDirectorMailboxError('storage_error');
        return { status: 'terminal', receipt: receipt.parsed.receipt };
      }
      const pending = await readPendingFrom(current);
      if (pending === null) return { status: 'missing' };
      if (pending.status !== 'valid') throw new StudioPilotDirectorMailboxError('storage_error');
      if (pending.command.commandId !== commandId) return { status: 'missing' };
      return { status: 'pending', command: pending.command };
    },

    async begin(projectId, processorId) {
      if (!safeId(processorId)) throw new StudioPilotDirectorMailboxError('invalid_payload');
      const current = await family(projectId, false);
      if (current === null) return null;
      const pending = await readPendingFrom(current);
      if (pending === null) return null;
      if (pending.status !== 'valid' || pending.command.projectId !== projectId) {
        throw new StudioPilotDirectorMailboxError('storage_error');
      }
      const existing = await readClaimFrom(current);
      if (existing.status === 'invalid') throw new StudioPilotDirectorMailboxError('storage_error');
      if (existing.status === 'valid') {
        if (existing.claim.commandId !== pending.command.commandId || existing.claim.projectId !== projectId) {
          throw new StudioPilotDirectorMailboxError('storage_error');
        }
        return { command: pending.command, claim: existing.claim, resumed: true };
      }
      const claim: StudioPilotDirectorClaim = {
        schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
        commandId: pending.command.commandId,
        projectId,
        processorId,
        claimedAt: new Date(readNow()).toISOString(),
      };
      try {
        await assertAuthority(current.authority);
        await publishImmutableRecord({
          fs,
          canonicalRoot: current.directories.root,
          file: claimPath(current.directories),
          bytes: serializeBounded(claim, CLAIM_MAX_BYTES),
          temporaryId: createTemporaryId(),
        });
        await assertAuthority(current.authority);
        return { command: pending.command, claim, resumed: false };
      } catch (error) {
        if (!(error instanceof RecordIoError) || error.code !== 'already_exists') throw neutralize(error);
        const raced = await readClaimFrom(current);
        if (
          raced.status !== 'valid' ||
          raced.claim.commandId !== pending.command.commandId ||
          raced.claim.projectId !== projectId
        ) {
          throw new StudioPilotDirectorMailboxError('storage_error');
        }
        return { command: pending.command, claim: raced.claim, resumed: true };
      }
    },

    async writeReceipt(command, receipt) {
      const parsed = parseStudioPilotDirectorReceipt(receipt, command);
      if (parsed.status !== 'valid') throw new StudioPilotDirectorMailboxError('invalid_payload');
      const current = await family(command.projectId, true);
      if (current === null) throw new StudioPilotDirectorMailboxError('storage_error');
      const existing = await readReceiptFrom(current, command.commandId, command);
      if (existing !== null) {
        if (existing.parsed.status !== 'valid' || !isDeepStrictEqual(existing.parsed.receipt, parsed.receipt)) {
          throw new StudioPilotDirectorMailboxError('storage_error');
        }
        return;
      }
      try {
        await assertAuthority(current.authority);
        await publishImmutableRecord({
          fs,
          canonicalRoot: current.directories.root,
          file: receiptPath(current.directories, command.commandId),
          bytes: serializeBounded(parsed.receipt, STUDIO_PILOT_DIRECTOR_RECEIPT_MAX_BYTES),
          temporaryId: createTemporaryId(),
        });
        await assertAuthority(current.authority);
      } catch (error) {
        throw neutralize(error);
      }
    },

    async finish(command) {
      const current = await family(command.projectId, false);
      if (current === null) return;
      const receipt = await readReceiptFrom(current, command.commandId, command);
      if (receipt === null || receipt.parsed.status !== 'valid') {
        throw new StudioPilotDirectorMailboxError('storage_error');
      }
      const pending = await readPendingFrom(current);
      if (pending !== null) {
        if (pending.status !== 'valid' || pending.command.commandId !== command.commandId) {
          throw new StudioPilotDirectorMailboxError('storage_error');
        }
      }
      const claim = await readClaimFrom(current);
      if (claim.status === 'invalid') throw new StudioPilotDirectorMailboxError('storage_error');
      if (claim.status === 'valid') {
        if (claim.claim.commandId !== command.commandId) throw new StudioPilotDirectorMailboxError('storage_error');
        await removeByIdentity(current, claimPath(current.directories), claim.identity);
      }
      if (pending !== null) {
        await removeByIdentity(current, pendingPath(current.directories), pending.identity);
      }
    },

    async pruneReceipts(projectId) {
      const current = await family(projectId, false);
      return current === null ? 0 : pruneFrom(current);
    },
  };
};
