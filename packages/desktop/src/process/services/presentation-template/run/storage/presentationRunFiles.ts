/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID as createRandomUUID } from 'node:crypto';
import {
  close as closeDescriptor,
  constants,
  fstat as fstatDescriptor,
  open as openDescriptor,
  type BigIntStats,
} from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, TextDecoder } from 'node:util';
import * as yauzl from 'yauzl';
import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import type { PresentationSourceDescriptor, PresentationSourceRef } from '@/common/types/office/presentationRun';
import {
  assertPresentationRunPreparationRecord,
  type PresentationRunPreparationFile,
  type PresentationRunPreparationPayload,
  type PresentationRunPreparationRecord,
  type PresentationRunRetainedCandidate,
} from './presentationRunStateMachine';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_NAME = 'candidate.pptx';
const GROUNDING_NAME = 'grounding.md';
const PLAN_NAME = 'plan.json';
const PREPARATION_NAME = 'preparation.json';
const STAGING_CANDIDATE_RELATIVE_PATH = `agent/${CANDIDATE_NAME}` as const;
const STAGING_GROUNDING_RELATIVE_PATH = `agent/${GROUNDING_NAME}` as const;
const PREPARATION_RELATIVE_PATH = PREPARATION_NAME;
const RETAINED_CANDIDATE_RELATIVE_PATH = `retained/${CANDIDATE_NAME}`;
const COPY_BUFFER_BYTES = 1024 * 1024;
const SOURCE_TEMP_RE = /^\.source-([0-9a-f-]+)\.tmp$/i;
const RUN_AGENT_TEMP_RE =
  /^\.(?:candidate|grounding)-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;
const RUN_PREPARATION_TEMP_RE =
  /^\.preparation-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;
const PDF_HEADER = Buffer.from('%PDF-', 'ascii');
const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OOXML_CONTENT_TYPES_ENTRY = '[Content_Types].xml';
const OOXML_MAIN_PARTS = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
} as const;
const PERMISSION_MODE_MASK = BigInt(0o7777);
const SOURCE_FORMATS = new Set<PresentationSourceSnapshotFormat>(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv']);
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

type OpenHandle = Awaited<ReturnType<typeof open>>;
type FileMetadata = BigIntStats;
type PresentationCandidateWrite = (
  target: OpenHandle,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number
) => Promise<number>;

export type PresentationRunEntityKind =
  | 'run'
  | 'grant'
  | 'draft'
  | 'owner'
  | 'run-tombstone'
  | 'grant-tombstone'
  | 'draft-tombstone';

type PresentationCandidateFileDurableBoundary =
  | 'before-candidate-source-open'
  | 'before-candidate-temp-create'
  | 'before-candidate-temp-write'
  | 'after-candidate-temp-write'
  | 'before-candidate-temp-fsync'
  | 'after-candidate-temp-fsync'
  | 'before-candidate-temp-directory-fsync'
  | 'after-candidate-temp-directory-fsync'
  | 'before-candidate-promotion-rename'
  | 'after-candidate-promotion-rename'
  | 'before-candidate-promotion-directory-fsync'
  | 'after-candidate-promotion-directory-fsync'
  | 'before-run-cleanup';

type PresentationSourceFileDurableBoundary =
  | 'before-grant-source-resolution'
  | 'before-grant-source-open'
  | 'before-grant-temp-create'
  | 'before-grant-temp-write'
  | 'after-grant-temp-write'
  | 'before-grant-temp-fsync'
  | 'after-grant-temp-fsync'
  | 'after-grant-ooxml-validation'
  | 'before-grant-temp-directory-fsync'
  | 'after-grant-temp-directory-fsync'
  | 'before-grant-promotion-rename'
  | 'after-grant-promotion-rename'
  | 'before-grant-promotion-directory-fsync'
  | 'after-grant-promotion-directory-fsync';

export type PresentationRunFileDurableBoundary =
  | PresentationCandidateFileDurableBoundary
  | PresentationSourceFileDurableBoundary;

export type PresentationRunFileFailurePoint =
  | { boundary: PresentationCandidateFileDurableBoundary; runId: string }
  | { boundary: PresentationSourceFileDurableBoundary; grantId: string };

/** Fault-injection sentinel that models process death before stack cleanup can run. */
export class PresentationRunSimulatedProcessCrashError extends Error {}

export type PreparedRetainedCandidate = {
  runId: string;
  temporaryRelativePath: string;
  finalRelativePath: 'retained/candidate.pptx';
  sha256: string;
  byteLength: number;
  dev: string;
  ino: string;
  /** Optional only for exact Task 1-7 journal intents recovered after upgrade. */
  stagingBeforeRetain?: string;
  retainedTemp?: string;
  stagingAfterRetain?: string;
};

export type DeferredPresentationInspectionWorkspace = {
  readonly directory: string;
  readonly dispose: () => Promise<void>;
  readonly cleanupAfterSettlement: () => Promise<void>;
};

export type PreparedPresentationRunAsset<
  FinalRelativePath extends 'agent/candidate.pptx' | 'agent/grounding.md' | 'preparation.json' =
    | 'agent/candidate.pptx'
    | 'agent/grounding.md'
    | 'preparation.json',
> = {
  temporaryRelativePath: string;
  finalRelativePath: FinalRelativePath;
  sha256: string;
  byteLength: number;
  dev: string;
  ino: string;
};

export type PreparedPresentationRunAssets = {
  runId: string;
  record: PresentationRunPreparationRecord;
  candidate: PreparedPresentationRunAsset<'agent/candidate.pptx'>;
  grounding: PreparedPresentationRunAsset<'agent/grounding.md'>;
  preparationFile: PreparedPresentationRunAsset<'preparation.json'>;
};

export type PreparePresentationRunAssetsInput = {
  runId: string;
  candidateBytes: Uint8Array;
  grounding: string;
  rawInput: string;
  directive: string;
  sourceRefs: readonly PresentationSourceRef[];
  injectSkills: readonly ['officecli'];
  template: {
    theme: PresentationRunPreparationFile;
    reference: PresentationRunPreparationFile;
  };
};

export type PresentationStagingRunPaths = {
  candidatePath: string;
  groundingPath: string;
  planPath: string;
};

export type PresentationSourceSnapshotFormat = PresentationSourceDescriptor['format'];

export type PreparePresentationSourceSnapshotInput = {
  grantId: string;
  sourcePath: string;
  format: PresentationSourceSnapshotFormat;
  authorization?: PresentationSourcePathAuthorization;
};

export type PresentationSourcePathAuthorization = {
  allowedRootPath: string;
  allowedRootDev: string;
  allowedRootIno: string;
  canonicalSourcePath: string;
  sourceDev: string;
  sourceIno: string;
};

export type PreparedPresentationSourceSnapshot = {
  grantId: string;
  format: PresentationSourceSnapshotFormat;
  temporaryRelativePath: string;
  finalRelativePath: `source.${PresentationSourceSnapshotFormat}`;
  sha256: string;
  byteLength: number;
  dev: string;
  ino: string;
};

export type PresentationSourceSnapshotReference = {
  grantId: string;
  format: PresentationSourceSnapshotFormat;
  relativePath: `source.${PresentationSourceSnapshotFormat}`;
  sha256: string;
  byteLength: number;
};

export type PresentationSourceSnapshotFailureCode =
  | 'SOURCE_LIMIT_EXCEEDED'
  | 'SOURCE_FORMAT_UNSUPPORTED'
  | 'SOURCE_TAMPERED';

/** A validation failure that the main-process source service can map without parsing messages. */
export class PresentationSourceSnapshotError extends Error {
  constructor(
    readonly code: PresentationSourceSnapshotFailureCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PresentationSourceSnapshotError';
  }
}

export type PresentationRetainedCandidateReader = {
  byteLength: number;
  readAt: (position: number, length: number) => Promise<Buffer>;
};

export type PresentationSourceSnapshotReader = {
  byteLength: number;
  readBytes: () => Promise<Buffer>;
};

export type PresentationOwnedDirectoryLease = {
  assertCurrent: () => Promise<void>;
  sync: (directory: string) => Promise<void>;
};

export type PresentationPreparedCandidateGuard = {
  assertCurrent: () => Promise<void>;
};

export type PresentationPreparedSourceSnapshotGuard = {
  assertCurrent: () => Promise<void>;
};

export type PresentationPreparedRunAssetGuard = {
  assertCurrent: () => Promise<void>;
};

type PreparedRunAssetEntry = {
  asset: PreparedPresentationRunAsset;
  filePath: string;
  finalPath: string;
  parentDirectory: string;
};

export type PresentationRunFileRoots = {
  runRoot: string;
  grantRoot: string;
  draftRoot: string;
  ownerRoot: string;
  runTombstoneRoot: string;
  grantTombstoneRoot: string;
  draftTombstoneRoot: string;
  journalRoot: string;
  indexRoot: string;
  quarantineRoot: string;
  stagingRoot: string;
  inspectionRoot: string;
};

type PresentationRunFilesOptions = {
  userDataDir: string;
  tempDir: string;
  randomUUID?: () => string;
  syncDirectory?: PresentationDirectorySync;
  failureInjector?: (point: PresentationRunFileFailurePoint) => void | Promise<void>;
  writeCandidateChunk?: PresentationCandidateWrite;
};

export type PresentationDirectorySync = (directory: string) => Promise<void>;

function hasCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === code) return true;
  return 'cause' in error && hasCode(error.cause, code);
}

function assertUuid(id: string, label: string): void {
  if (!UUID_RE.test(id)) throw new Error(`Invalid presentation ${label} id`);
}

function assertPreparedRetainedCandidate(prepared: PreparedRetainedCandidate): void {
  const proofValues = [prepared.stagingBeforeRetain, prepared.retainedTemp, prepared.stagingAfterRetain];
  const hasLegacyProof = proofValues.every((value) => value === undefined);
  const hasCurrentProof = proofValues.every(
    (value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) && value === prepared.sha256
  );
  if (
    !UUID_RE.test(prepared.runId) ||
    prepared.finalRelativePath !== RETAINED_CANDIDATE_RELATIVE_PATH ||
    !new RegExp(`^retained/\\.candidate-${UUID_RE.source.slice(1, -1)}\\.tmp$`, 'i').test(
      prepared.temporaryRelativePath
    ) ||
    !/^[0-9a-f]{64}$/i.test(prepared.sha256) ||
    !Number.isSafeInteger(prepared.byteLength) ||
    prepared.byteLength < 0 ||
    prepared.byteLength > PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES ||
    !/^(0|[1-9][0-9]*)$/.test(prepared.dev) ||
    !/^[1-9][0-9]*$/.test(prepared.ino) ||
    (!hasLegacyProof && !hasCurrentProof)
  ) {
    throw new Error('Invalid retained candidate promotion');
  }
}

function sourceSnapshotFailure(
  code: PresentationSourceSnapshotFailureCode,
  message: string,
  cause?: unknown
): PresentationSourceSnapshotError {
  return new PresentationSourceSnapshotError(code, message, cause === undefined ? undefined : { cause });
}

function assertSourceSnapshotInput(input: PreparePresentationSourceSnapshotInput): void {
  assertUuid(input.grantId, 'source grant');
  if (!SOURCE_FORMATS.has(input.format)) {
    throw sourceSnapshotFailure('SOURCE_FORMAT_UNSUPPORTED', 'Presentation source format is unsupported');
  }
  if (!path.isAbsolute(input.sourcePath) || path.resolve(input.sourcePath) !== input.sourcePath) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source path must be normalized and absolute');
  }
  const extension = path.extname(input.sourcePath).slice(1).toLowerCase();
  if (extension !== input.format) {
    throw sourceSnapshotFailure('SOURCE_FORMAT_UNSUPPORTED', 'Presentation source extension does not match its format');
  }
  if (input.authorization !== undefined) assertSourcePathAuthorization(input.authorization);
}

function assertSourcePathAuthorization(authorization: PresentationSourcePathAuthorization): void {
  if (
    !hasExactObjectKeys(authorization, [
      'allowedRootPath',
      'allowedRootDev',
      'allowedRootIno',
      'canonicalSourcePath',
      'sourceDev',
      'sourceIno',
    ]) ||
    !path.isAbsolute(authorization.allowedRootPath) ||
    path.resolve(authorization.allowedRootPath) !== authorization.allowedRootPath ||
    !path.isAbsolute(authorization.canonicalSourcePath) ||
    path.resolve(authorization.canonicalSourcePath) !== authorization.canonicalSourcePath ||
    !/^(0|[1-9][0-9]*)$/.test(authorization.allowedRootDev) ||
    !/^[1-9][0-9]*$/.test(authorization.allowedRootIno) ||
    !/^(0|[1-9][0-9]*)$/.test(authorization.sourceDev) ||
    !/^[1-9][0-9]*$/.test(authorization.sourceIno)
  ) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source authorization is invalid');
  }
}

function hasExactObjectKeys(value: object, keys: readonly string[]): boolean {
  const expected = [...keys].toSorted();
  const actual = Object.keys(value).toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertPreparedSourceSnapshot(prepared: PreparedPresentationSourceSnapshot): void {
  const temporaryName = path.basename(prepared.temporaryRelativePath);
  const match = SOURCE_TEMP_RE.exec(temporaryName);
  if (
    !UUID_RE.test(prepared.grantId) ||
    !SOURCE_FORMATS.has(prepared.format) ||
    path.dirname(prepared.temporaryRelativePath) !== '.' ||
    match === null ||
    !UUID_RE.test(match[1]) ||
    prepared.finalRelativePath !== `source.${prepared.format}` ||
    !/^[0-9a-f]{64}$/i.test(prepared.sha256) ||
    !Number.isSafeInteger(prepared.byteLength) ||
    prepared.byteLength < 1 ||
    prepared.byteLength > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
    !/^(0|[1-9][0-9]*)$/.test(prepared.dev) ||
    !/^[1-9][0-9]*$/.test(prepared.ino)
  ) {
    throw new Error('Invalid presentation source snapshot promotion');
  }
}

function assertPreparedRunAsset<
  FinalRelativePath extends 'agent/candidate.pptx' | 'agent/grounding.md' | 'preparation.json',
>(
  asset: PreparedPresentationRunAsset<FinalRelativePath>,
  finalRelativePath: FinalRelativePath,
  maximumByteLength: number
): void {
  const temporaryPattern =
    finalRelativePath === STAGING_CANDIDATE_RELATIVE_PATH
      ? new RegExp(`^agent/\\.candidate-${UUID_RE.source.slice(1, -1)}\\.tmp$`, 'i')
      : finalRelativePath === STAGING_GROUNDING_RELATIVE_PATH
        ? new RegExp(`^agent/\\.grounding-${UUID_RE.source.slice(1, -1)}\\.tmp$`, 'i')
        : new RegExp(`^\\.preparation-${UUID_RE.source.slice(1, -1)}\\.tmp$`, 'i');
  if (
    !hasExactObjectKeys(asset, ['temporaryRelativePath', 'finalRelativePath', 'sha256', 'byteLength', 'dev', 'ino']) ||
    asset.finalRelativePath !== finalRelativePath ||
    !temporaryPattern.test(asset.temporaryRelativePath) ||
    !/^[0-9a-f]{64}$/.test(asset.sha256) ||
    !Number.isSafeInteger(asset.byteLength) ||
    asset.byteLength < 1 ||
    asset.byteLength > maximumByteLength ||
    !/^(0|[1-9][0-9]*)$/.test(asset.dev) ||
    !/^[1-9][0-9]*$/.test(asset.ino)
  ) {
    throw new Error('Invalid prepared presentation run assets');
  }
}

export function assertPreparedPresentationRunAssets(prepared: PreparedPresentationRunAssets): void {
  if (
    !hasExactObjectKeys(prepared, ['runId', 'record', 'candidate', 'grounding', 'preparationFile']) ||
    !UUID_RE.test(prepared.runId)
  ) {
    throw new Error('Invalid prepared presentation run assets');
  }
  assertPresentationRunPreparationRecord(prepared.record);
  assertPreparedRunAsset(
    prepared.candidate,
    STAGING_CANDIDATE_RELATIVE_PATH,
    PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES
  );
  assertPreparedRunAsset(
    prepared.grounding,
    STAGING_GROUNDING_RELATIVE_PATH,
    PRESENTATION_RUN_LIMITS.MAX_NON_RENDER_COPY_WRITE_BYTES_PER_RUN
  );
  assertPreparedRunAsset(
    prepared.preparationFile,
    PREPARATION_RELATIVE_PATH,
    PRESENTATION_RUN_LIMITS.MAX_NON_RENDER_COPY_WRITE_BYTES_PER_RUN
  );
  if (
    prepared.record.payload.candidate.sha256 !== prepared.candidate.sha256 ||
    prepared.record.payload.candidate.byteLength !== prepared.candidate.byteLength ||
    prepared.record.payload.grounding.sha256 !== prepared.grounding.sha256 ||
    prepared.record.payload.grounding.byteLength !== prepared.grounding.byteLength ||
    prepared.record.sha256 !== prepared.preparationFile.sha256 ||
    prepared.record.byteLength !== prepared.preparationFile.byteLength ||
    prepared.record.payload.template.reference.sha256 !== prepared.candidate.sha256 ||
    prepared.record.payload.template.reference.byteLength !== prepared.candidate.byteLength
  ) {
    throw new Error('Invalid prepared presentation run assets');
  }
}

function assertSourceSnapshotReference(reference: PresentationSourceSnapshotReference): void {
  if (
    !UUID_RE.test(reference.grantId) ||
    !SOURCE_FORMATS.has(reference.format) ||
    reference.relativePath !== `source.${reference.format}` ||
    !/^[0-9a-f]{64}$/i.test(reference.sha256) ||
    !Number.isSafeInteger(reference.byteLength) ||
    reference.byteLength < 1 ||
    reference.byteLength > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES
  ) {
    throw new Error('Invalid presentation source snapshot reference');
  }
}

function assertStableSourceFile(metadata: FileMetadata, message: string): void {
  if (!metadata.isFile() || metadata.nlink !== BigInt(1)) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', message);
  }
}

function assertStableSourceDirectory(metadata: FileMetadata): void {
  if (!metadata.isDirectory()) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source ancestor must be a real directory');
  }
}

function sameSourceVersion(left: FileMetadata, right: FileMetadata): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.mode === right.mode
  );
}

async function assertPathNamesSourceFile(filePath: string, metadata: FileMetadata, message: string): Promise<void> {
  let named: FileMetadata;
  try {
    named = await lstat(filePath, { bigint: true });
  } catch (error) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', message, error);
  }
  if (named.isSymbolicLink() || !named.isFile() || !sameFileIdentity(named, metadata)) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', message);
  }
}

async function openStableSourceFile(
  filePath: string,
  message: string
): Promise<{ handle: OpenHandle; metadata: FileMetadata }> {
  let handle: OpenHandle;
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollowFlag());
  } catch (error) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', message, error);
  }
  try {
    const metadata = await handle.stat({ bigint: true });
    assertStableSourceFile(metadata, message);
    await assertPathNamesSourceFile(filePath, metadata, message);
    return { handle, metadata };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

type SourceAncestorLeaseEntry = {
  directory: string;
  handle: OpenHandle;
  metadata: FileMetadata;
};

class SourceAncestorLease {
  private constructor(private readonly entries: SourceAncestorLeaseEntry[]) {}

  static async acquire(sourcePath: string): Promise<SourceAncestorLease> {
    const entries: SourceAncestorLeaseEntry[] = [];
    try {
      for (const directory of sourceAncestorDirectories(sourcePath)) {
        let handle: OpenHandle;
        try {
          handle = await open(directory, constants.O_RDONLY | noFollowFlag() | directoryOnlyFlag());
        } catch (error) {
          throw sourceSnapshotFailure(
            'SOURCE_TAMPERED',
            'Presentation source ancestor must be a real directory',
            error
          );
        }
        try {
          const metadata = await handle.stat({ bigint: true });
          assertStableSourceDirectory(metadata);
          const named = await lstat(directory, { bigint: true });
          if (named.isSymbolicLink() || !named.isDirectory() || !sameFileIdentity(named, metadata)) {
            throw sourceSnapshotFailure(
              'SOURCE_TAMPERED',
              'Presentation source ancestor must be a stable real directory'
            );
          }
          entries.push({ directory, handle, metadata });
        } catch (error) {
          await handle.close();
          throw error;
        }
      }
      const lease = new SourceAncestorLease(entries);
      await lease.assertCurrent();
      return lease;
    } catch (error) {
      await Promise.all(entries.map(({ handle }) => handle.close().catch((): undefined => undefined)));
      throw error;
    }
  }

  async assertCurrent(): Promise<void> {
    for (const entry of this.entries) {
      try {
        const current = await entry.handle.stat({ bigint: true });
        assertStableSourceDirectory(current);
        const named = await lstat(entry.directory, { bigint: true });
        if (
          named.isSymbolicLink() ||
          !named.isDirectory() ||
          !sameFileIdentity(entry.metadata, current) ||
          !sameFileIdentity(current, named)
        ) {
          throw new Error();
        }
      } catch (error) {
        if (error instanceof PresentationSourceSnapshotError) throw error;
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source ancestor changed while reading', error);
      }
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.entries.map(({ handle }) => handle.close()));
  }
}

class SourcePathAuthorizationLease {
  private constructor(
    private readonly authorization: PresentationSourcePathAuthorization,
    private readonly rootHandle: OpenHandle,
    private readonly rootMetadata: FileMetadata
  ) {}

  static async acquire(authorization: PresentationSourcePathAuthorization): Promise<SourcePathAuthorizationLease> {
    assertSourcePathAuthorization(authorization);
    let rootHandle: OpenHandle;
    try {
      rootHandle = await open(authorization.allowedRootPath, constants.O_RDONLY | noFollowFlag() | directoryOnlyFlag());
    } catch (error) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source authorization root changed', error);
    }
    try {
      const rootMetadata = await rootHandle.stat({ bigint: true });
      assertStableSourceDirectory(rootMetadata);
      if (
        !hasExpectedIdentity(rootMetadata, {
          dev: authorization.allowedRootDev,
          ino: authorization.allowedRootIno,
        })
      ) {
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source authorization root changed');
      }
      const lease = new SourcePathAuthorizationLease(authorization, rootHandle, rootMetadata);
      await lease.assertCurrent();
      return lease;
    } catch (error) {
      await rootHandle.close();
      throw error;
    }
  }

  assertCanonicalSource(canonicalSourcePath: string, metadata: FileMetadata): void {
    if (
      canonicalSourcePath !== this.authorization.canonicalSourcePath ||
      !isWithinRoot(this.authorization.allowedRootPath, canonicalSourcePath) ||
      !hasExpectedIdentity(metadata, { dev: this.authorization.sourceDev, ino: this.authorization.sourceIno })
    ) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source authorization no longer matches');
    }
  }

  async assertCurrent(): Promise<void> {
    try {
      const current = await this.rootHandle.stat({ bigint: true });
      assertStableSourceDirectory(current);
      const named = await lstat(this.authorization.allowedRootPath, { bigint: true });
      if (
        named.isSymbolicLink() ||
        !named.isDirectory() ||
        !sameFileIdentity(this.rootMetadata, current) ||
        !sameFileIdentity(current, named)
      ) {
        throw new Error();
      }
    } catch (error) {
      if (error instanceof PresentationSourceSnapshotError) throw error;
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source authorization root changed', error);
    }
  }

  async close(): Promise<void> {
    await this.rootHandle.close();
  }
}

function sourceAncestorDirectories(sourcePath: string): string[] {
  const parent = path.dirname(sourcePath);
  const root = path.parse(parent).root;
  const relative = path.relative(root, parent);
  const directories = [root];
  if (relative === '') return directories;
  for (const segment of relative.split(path.sep)) directories.push(path.join(directories.at(-1)!, segment));
  return directories;
}

type StableSourcePath = {
  canonicalPath: string;
  assertCurrent: () => Promise<void>;
};

async function resolveStableSourcePath(sourcePath: string): Promise<StableSourcePath> {
  const originalParent = path.dirname(sourcePath);
  let canonicalParent: string;
  try {
    canonicalParent = await realpath(originalParent);
  } catch (error) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source parent is unavailable', error);
  }
  const canonicalPath = path.join(canonicalParent, path.basename(sourcePath));
  return {
    canonicalPath,
    assertCurrent: async (): Promise<void> => {
      let currentParent: string;
      try {
        currentParent = await realpath(originalParent);
      } catch (error) {
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source parent changed while reading', error);
      }
      if (currentParent !== canonicalParent) {
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source parent changed while reading');
      }
    },
  };
}

type SourceStreamValidator = {
  update: (chunk: Buffer) => void;
  finish: () => void;
};

function createSourceStreamValidator(format: PresentationSourceSnapshotFormat): SourceStreamValidator {
  let prefix = Buffer.alloc(0);
  const prefixLength = format === 'pdf' ? PDF_HEADER.length : ZIP_LOCAL_FILE_HEADER.length;
  const decoder =
    format === 'txt' || format === 'md' || format === 'csv' ? new TextDecoder('utf-8', { fatal: true }) : null;
  return {
    update: (chunk): void => {
      if (prefix.length < prefixLength) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, prefixLength - prefix.length)]);
      }
      if (decoder !== null) {
        if (chunk.includes(0)) {
          throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation text source contains a NUL byte');
        }
        try {
          decoder.decode(chunk, { stream: true });
        } catch (error) {
          throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation text source is not strict UTF-8', error);
        }
      }
    },
    finish: (): void => {
      if (decoder !== null) {
        try {
          decoder.decode();
        } catch (error) {
          throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation text source is not strict UTF-8', error);
        }
        return;
      }
      const expected = format === 'pdf' ? PDF_HEADER : ZIP_LOCAL_FILE_HEADER;
      if (!prefix.equals(expected)) {
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source magic does not match its extension');
      }
    },
  };
}

function assertSafeZipEntry(entry: yauzl.Entry): void {
  const name = entry.fileName;
  const isDirectory = name.endsWith('/');
  const segments = name.split('/');
  if (isDirectory) segments.pop();
  if (
    name.length === 0 ||
    Buffer.byteLength(name, 'utf8') > 4_096 ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[a-z]:/i.test(name) ||
    segments.length === 0 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    entry.isEncrypted() ||
    (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
  ) {
    throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package contains an unsafe entry');
  }
  const platform = entry.versionMadeBy >>> 8;
  if (platform === 3) {
    const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
    const expectedType = isDirectory ? 0o040000 : 0o100000;
    if (fileType !== 0 && fileType !== expectedType) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package contains a non-file entry');
    }
  }
}

function openRawDescriptor(filePath: string, flags: number): Promise<number> {
  return new Promise((resolve, reject) => {
    openDescriptor(filePath, flags, (error, descriptor) => {
      if (error !== null) reject(error);
      else resolve(descriptor);
    });
  });
}

function statRawDescriptor(descriptor: number): Promise<FileMetadata> {
  return new Promise((resolve, reject) => {
    fstatDescriptor(descriptor, { bigint: true }, (error, metadata) => {
      if (error !== null) reject(error);
      else resolve(metadata);
    });
  });
}

function closeRawDescriptor(descriptor: number): Promise<void> {
  return new Promise((resolve, reject) => {
    closeDescriptor(descriptor, (error) => {
      if (error !== null) reject(error);
      else resolve();
    });
  });
}

async function openSnapshotZip(
  snapshotPath: string,
  expectedIdentity: FileMetadata
): Promise<{ zip: yauzl.ZipFile; closed: Promise<void> }> {
  const descriptor = await openRawDescriptor(snapshotPath, constants.O_RDONLY | noFollowFlag());
  let transferred = false;
  try {
    const metadata = await statRawDescriptor(descriptor);
    assertOwnedRegularFileMode(
      metadata,
      PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE,
      'Presentation OOXML snapshot is unsafe'
    );
    await assertPathNamesFile(snapshotPath, metadata, 'Presentation OOXML snapshot is unsafe');
    if (!sameFileIdentity(metadata, expectedIdentity)) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML snapshot changed before validation');
    }
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.fromFd(
        descriptor,
        {
          autoClose: true,
          lazyEntries: true,
          decodeStrings: true,
          validateEntrySizes: true,
          strictFileNames: true,
        },
        (error, openedZip) => {
          if (error !== null) {
            reject(sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package is invalid', error));
            return;
          }
          transferred = true;
          resolve(openedZip);
        }
      );
    });
    const closed = new Promise<void>((resolve) => zip.once('close', resolve));
    return { zip, closed };
  } finally {
    if (!transferred) await closeRawDescriptor(descriptor).catch((): undefined => undefined);
  }
}

function updateCrc32(crc: number, chunk: Buffer): number {
  let next = crc;
  for (const byte of chunk) next = CRC32_TABLE[(next ^ byte) & 0xff]! ^ (next >>> 8);
  return next >>> 0;
}

async function validateOoxmlSnapshot(
  snapshotPath: string,
  expectedIdentity: FileMetadata,
  format: Extract<PresentationSourceSnapshotFormat, 'docx' | 'xlsx' | 'pptx'>
): Promise<void> {
  const { zip, closed } = await openSnapshotZip(snapshotPath, expectedIdentity);
  try {
    if (zip.entryCount < 2 || zip.entryCount > PRESENTATION_RUN_LIMITS.MAX_ZIP_ENTRIES) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package has an invalid entry count');
    }
    await new Promise<void>((resolve, reject) => {
      const exactNames = new Set<string>();
      const foldedNames = new Set<string>();
      let expandedBytes = 0;
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        zip.removeListener('entry', onEntry);
        zip.removeListener('end', onEnd);
        zip.removeListener('error', onError);
        if (error === undefined) resolve();
        else if (error instanceof PresentationSourceSnapshotError) reject(error);
        else reject(sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package is invalid', error));
      };
      const onEntry = (entry: yauzl.Entry): void => {
        try {
          assertSafeZipEntry(entry);
          if (
            !Number.isSafeInteger(entry.compressedSize) ||
            !Number.isSafeInteger(entry.uncompressedSize) ||
            entry.compressedSize < 0 ||
            entry.uncompressedSize < 0 ||
            entry.compressedSize > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
            entry.uncompressedSize > PRESENTATION_RUN_LIMITS.MAX_ZIP_ENTRY_BYTES
          ) {
            throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package entry exceeds its limit');
          }
          expandedBytes += entry.uncompressedSize;
          if (!Number.isSafeInteger(expandedBytes) || expandedBytes > PRESENTATION_RUN_LIMITS.MAX_ZIP_EXPANDED_BYTES) {
            throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package expands beyond its limit');
          }
          const folded = entry.fileName.toLocaleLowerCase('en-US');
          if (exactNames.has(entry.fileName) || foldedNames.has(folded)) {
            throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package contains duplicate entries');
          }
          exactNames.add(entry.fileName);
          foldedNames.add(folded);
          if (entry.fileName.endsWith('/')) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (error, stream) => {
            if (error !== null) {
              finish(error);
              return;
            }
            let actualBytes = 0;
            let crc = 0xffffffff;
            stream.on('data', (chunk: Buffer) => {
              actualBytes += chunk.length;
              crc = updateCrc32(crc, chunk);
              if (
                !Number.isSafeInteger(actualBytes) ||
                actualBytes > entry.uncompressedSize ||
                actualBytes > PRESENTATION_RUN_LIMITS.MAX_ZIP_ENTRY_BYTES
              ) {
                stream.destroy(
                  sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package entry exceeds its limit')
                );
              }
            });
            stream.once('error', finish);
            stream.once('end', () => {
              try {
                if (actualBytes !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32) {
                  throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation OOXML package entry is corrupt');
                }
                zip.readEntry();
              } catch (streamError) {
                finish(streamError);
              }
            });
          });
        } catch (error) {
          finish(error);
        }
      };
      const onEnd = (): void => {
        try {
          const expectedMainPart = OOXML_MAIN_PARTS[format];
          const wrongMainParts = Object.values(OOXML_MAIN_PARTS).filter((part) => part !== expectedMainPart);
          if (
            !exactNames.has(OOXML_CONTENT_TYPES_ENTRY) ||
            !exactNames.has(expectedMainPart) ||
            wrongMainParts.some((part) => exactNames.has(part))
          ) {
            throw sourceSnapshotFailure(
              'SOURCE_TAMPERED',
              'Presentation OOXML package label does not match its extension'
            );
          }
          finish();
        } catch (error) {
          finish(error);
        }
      };
      const onError = (error: Error): void => finish(error);
      zip.on('entry', onEntry);
      zip.once('end', onEnd);
      zip.once('error', onError);
      zip.readEntry();
    });
  } finally {
    zip.close();
    await closed;
  }
}

function noFollowFlag(): number {
  return 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
}

function directoryOnlyFlag(): number {
  return 'O_DIRECTORY' in constants ? constants.O_DIRECTORY : 0;
}

function sameFileIdentity(left: FileMetadata, right: FileMetadata): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function hasExpectedIdentity(metadata: FileMetadata, expected: { dev: string; ino: string }): boolean {
  return metadata.dev.toString() === expected.dev && metadata.ino.toString() === expected.ino;
}

function fileIdentity(metadata: FileMetadata): { dev: string; ino: string } {
  return { dev: metadata.dev.toString(), ino: metadata.ino.toString() };
}

function isOwnedByCurrentUser(metadata: FileMetadata): boolean {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return currentUid === undefined || metadata.uid === BigInt(currentUid);
}

function assertOwnedRegularFile(metadata: FileMetadata, message: string): void {
  if (!metadata.isFile() || metadata.nlink !== BigInt(1) || !isOwnedByCurrentUser(metadata)) {
    throw new Error(message);
  }
}

function assertOwnedRegularFileMode(metadata: FileMetadata, expectedMode: number, message: string): void {
  assertOwnedRegularFile(metadata, message);
  if ((metadata.mode & PERMISSION_MODE_MASK) !== BigInt(expectedMode)) throw new Error(message);
}

function assertOwnedDirectory(metadata: FileMetadata): void {
  if (!metadata.isDirectory() || !isOwnedByCurrentUser(metadata)) {
    throw new Error('Presentation storage directory must be real and owned by the current user');
  }
}

async function assertPathNamesFile(filePath: string, metadata: FileMetadata, message: string): Promise<void> {
  let named: FileMetadata;
  try {
    named = await lstat(filePath, { bigint: true });
  } catch (error) {
    throw new Error(message, { cause: error });
  }
  if (
    named.isSymbolicLink() ||
    !named.isFile() ||
    named.nlink !== BigInt(1) ||
    !isOwnedByCurrentUser(named) ||
    !sameFileIdentity(named, metadata)
  ) {
    throw new Error(message);
  }
}

async function assertPathNamesDirectory(directory: string, metadata: FileMetadata): Promise<void> {
  let named: FileMetadata;
  try {
    named = await lstat(directory, { bigint: true });
  } catch (error) {
    throw new Error('Presentation storage directory must be real and owned by the current user', { cause: error });
  }
  if (
    named.isSymbolicLink() ||
    !named.isDirectory() ||
    !isOwnedByCurrentUser(named) ||
    !sameFileIdentity(named, metadata)
  ) {
    throw new Error('Presentation storage directory must be real and owned by the current user');
  }
}

async function assertPathAbsent(targetPath: string, message: string): Promise<void> {
  try {
    await lstat(targetPath, { bigint: true });
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return;
    throw new Error(message, { cause: error });
  }
  throw new Error(message);
}

async function openOwnedDirectory(directory: string): Promise<{ handle: OpenHandle; metadata: FileMetadata }> {
  let handle: OpenHandle;
  try {
    handle = await open(directory, constants.O_RDONLY | noFollowFlag() | directoryOnlyFlag());
  } catch (error) {
    throw new Error('Presentation storage directory must be real and owned by the current user', { cause: error });
  }
  try {
    const metadata = await handle.stat({ bigint: true });
    assertOwnedDirectory(metadata);
    await assertPathNamesDirectory(directory, metadata);
    return { handle, metadata };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function openOwnedRegularFile(
  filePath: string,
  message: string
): Promise<{ handle: OpenHandle; metadata: FileMetadata }> {
  let handle: OpenHandle;
  try {
    handle = await open(filePath, constants.O_RDONLY | noFollowFlag());
  } catch (error) {
    throw new Error(message, { cause: error });
  }
  try {
    const metadata = await handle.stat({ bigint: true });
    assertOwnedRegularFile(metadata, message);
    await assertPathNamesFile(filePath, metadata, message);
    return { handle, metadata };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function hashOpenFile(file: OpenHandle, byteLength: number): Promise<string> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(byteLength, 1)));
  let position = 0;
  while (position < byteLength) {
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, byteLength - position), position);
    if (bytesRead === 0) throw new Error('Presentation candidate changed while reading');
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

async function readOpenFileExactly(file: OpenHandle, byteLength: number, message: string): Promise<Buffer> {
  const bytes = Buffer.alloc(byteLength);
  let position = 0;
  while (position < byteLength) {
    const { bytesRead } = await file.read(bytes, position, byteLength - position, position);
    if (bytesRead === 0) throw new Error(message);
    position += bytesRead;
  }
  return bytes;
}

async function verifyCandidatePath(
  filePath: string,
  expected: { sha256: string; byteLength: number },
  messages: { unsafe: string; changed: string },
  expectedIdentity?: { dev: string; ino: string },
  expectedMode?: number
): Promise<FileMetadata> {
  const { handle, metadata: before } = await openOwnedRegularFile(filePath, messages.unsafe);
  try {
    if (expectedMode !== undefined) assertOwnedRegularFileMode(before, expectedMode, messages.unsafe);
    if (
      before.size !== BigInt(expected.byteLength) ||
      (expectedIdentity && !hasExpectedIdentity(before, expectedIdentity))
    ) {
      throw new Error(messages.changed);
    }
    const sha256 = await hashOpenFile(handle, expected.byteLength);
    const after = await handle.stat({ bigint: true });
    if (expectedMode === undefined) assertOwnedRegularFile(after, messages.unsafe);
    else assertOwnedRegularFileMode(after, expectedMode, messages.unsafe);
    if (
      !sameFileIdentity(before, after) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(messages.changed);
    }
    await assertPathNamesFile(filePath, after, messages.unsafe);
    if (sha256 !== expected.sha256 || (expectedIdentity && !hasExpectedIdentity(after, expectedIdentity))) {
      throw new Error(messages.changed);
    }
    return after;
  } finally {
    await handle.close();
  }
}

type VerifiedCandidateLease = {
  path: string;
  handle: OpenHandle;
  metadata: FileMetadata;
  expected: { sha256: string; byteLength: number };
  expectedIdentity?: { dev: string; ino: string };
  expectedMode?: number;
  messages: { unsafe: string; changed: string };
};

async function assertVerifiedCandidateLease(lease: VerifiedCandidateLease): Promise<FileMetadata> {
  const before = await lease.handle.stat({ bigint: true });
  if (lease.expectedMode === undefined) assertOwnedRegularFile(before, lease.messages.unsafe);
  else assertOwnedRegularFileMode(before, lease.expectedMode, lease.messages.unsafe);
  if (
    !sameFileIdentity(lease.metadata, before) ||
    before.size !== BigInt(lease.expected.byteLength) ||
    (lease.expectedIdentity && !hasExpectedIdentity(before, lease.expectedIdentity))
  ) {
    throw new Error(lease.messages.changed);
  }
  const sha256 = await hashOpenFile(lease.handle, lease.expected.byteLength);
  const after = await lease.handle.stat({ bigint: true });
  if (lease.expectedMode === undefined) assertOwnedRegularFile(after, lease.messages.unsafe);
  else assertOwnedRegularFileMode(after, lease.expectedMode, lease.messages.unsafe);
  if (
    !sameFileIdentity(before, after) ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    sha256 !== lease.expected.sha256 ||
    (lease.expectedIdentity && !hasExpectedIdentity(after, lease.expectedIdentity))
  ) {
    throw new Error(lease.messages.changed);
  }
  await assertPathNamesFile(lease.path, after, lease.messages.unsafe);
  return after;
}

async function openVerifiedCandidateLease(
  filePath: string,
  expected: { sha256: string; byteLength: number },
  messages: { unsafe: string; changed: string },
  expectedIdentity?: { dev: string; ino: string },
  expectedMode?: number
): Promise<VerifiedCandidateLease> {
  const { handle, metadata } = await openOwnedRegularFile(filePath, messages.unsafe);
  const lease = { path: filePath, handle, metadata, expected, expectedIdentity, expectedMode, messages };
  try {
    lease.metadata = await assertVerifiedCandidateLease(lease);
    return lease;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

type OwnedDirectoryLeaseEntry = {
  directory: string;
  handle: OpenHandle;
  metadata: FileMetadata;
};

class OwnedDirectoryLease implements PresentationOwnedDirectoryLease {
  private constructor(
    private readonly entries: OwnedDirectoryLeaseEntry[],
    private readonly syncDirectory: PresentationDirectorySync
  ) {}

  static async acquire(
    directories: readonly string[],
    syncDirectory: PresentationDirectorySync
  ): Promise<OwnedDirectoryLease> {
    const entries: OwnedDirectoryLeaseEntry[] = [];
    try {
      for (const directory of new Set(directories.map((entry) => path.resolve(entry)))) {
        const { handle, metadata } = await openOwnedDirectory(directory);
        entries.push({ directory, handle, metadata });
      }
      const lease = new OwnedDirectoryLease(entries, syncDirectory);
      await lease.assertCurrent();
      return lease;
    } catch (error) {
      await Promise.all(entries.map(({ handle }) => handle.close().catch((): undefined => undefined)));
      throw error;
    }
  }

  async assertCurrent(): Promise<void> {
    for (const entry of this.entries) await this.assertEntry(entry);
  }

  async assertParentsCurrent(removedDirectory: string): Promise<void> {
    const removed = path.resolve(removedDirectory);
    for (const entry of this.entries) {
      if (entry.directory !== removed) await this.assertEntry(entry);
    }
  }

  async assertMode(directory: string, expectedMode: number, message: string): Promise<void> {
    const resolved = path.resolve(directory);
    const entry = this.entries.find((candidate) => candidate.directory === resolved);
    if (entry === undefined) throw new Error('Presentation directory mode check escaped its active lease');
    await this.assertEntry(entry);
    const before = await entry.handle.stat({ bigint: true });
    if ((before.mode & PERMISSION_MODE_MASK) !== BigInt(expectedMode)) throw new Error(message);
    await this.assertEntry(entry);
    const after = await entry.handle.stat({ bigint: true });
    if ((after.mode & PERMISSION_MODE_MASK) !== BigInt(expectedMode)) throw new Error(message);
  }

  async sync(directory: string): Promise<void> {
    const resolved = path.resolve(directory);
    const entry = this.entries.find((candidate) => candidate.directory === resolved);
    if (!entry) throw new Error('Presentation directory sync escaped its active lease');
    await this.assertEntry(entry);
    await this.syncDirectory(resolved);
    await this.assertEntry(entry);
  }

  async close(): Promise<void> {
    await Promise.all(this.entries.map(({ handle }) => handle.close()));
  }

  private async assertEntry(entry: OwnedDirectoryLeaseEntry): Promise<void> {
    try {
      const current = await entry.handle.stat({ bigint: true });
      assertOwnedDirectory(current);
      if (!sameFileIdentity(entry.metadata, current)) throw new Error();
      const named = await lstat(entry.directory, { bigint: true });
      if (
        named.isSymbolicLink() ||
        !named.isDirectory() ||
        !isOwnedByCurrentUser(named) ||
        !sameFileIdentity(current, named)
      ) {
        throw new Error();
      }
    } catch (error) {
      throw new Error('Presentation storage directory changed while leased', { cause: error });
    }
  }
}

/** POSIX directory durability adapter. Errors are persistence failures. */
export const syncPosixDirectory: PresentationDirectorySync = async (directory) => {
  const { handle, metadata: before } = await openOwnedDirectory(directory);
  try {
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    assertOwnedDirectory(after);
    if (!sameFileIdentity(before, after)) {
      throw new Error('Presentation storage directory changed while syncing');
    }
    await assertPathNamesDirectory(directory, after);
  } finally {
    await handle.close();
  }
};

/** Resolves and owns all private presentation-run filesystem areas. */
export class PresentationRunFiles {
  readonly roots: PresentationRunFileRoots;
  private readonly userDataDir: string;
  private readonly tempDir: string;
  private readonly randomUUID: () => string;
  private readonly syncDirectory: PresentationDirectorySync;
  private readonly failureInjector?: PresentationRunFilesOptions['failureInjector'];
  private readonly writeCandidateChunk: PresentationCandidateWrite;

  constructor(options: PresentationRunFilesOptions) {
    const userDataDir = path.resolve(options.userDataDir);
    const tempDir = path.resolve(options.tempDir);
    this.userDataDir = userDataDir;
    this.tempDir = tempDir;
    this.randomUUID = options.randomUUID ?? createRandomUUID;
    this.syncDirectory = options.syncDirectory ?? syncPosixDirectory;
    this.failureInjector = options.failureInjector;
    this.writeCandidateChunk =
      options.writeCandidateChunk ??
      (async (target, buffer, offset, length, position): Promise<number> => {
        const { bytesWritten } = await target.write(buffer, offset, length, position);
        return bytesWritten;
      });
    this.roots = {
      runRoot: path.join(userDataDir, 'presentation-runs'),
      grantRoot: path.join(userDataDir, 'presentation-source-grants'),
      draftRoot: path.join(userDataDir, 'presentation-source-drafts'),
      ownerRoot: path.join(userDataDir, 'presentation-source-owners'),
      runTombstoneRoot: path.join(userDataDir, 'presentation-run-tombstones'),
      grantTombstoneRoot: path.join(userDataDir, 'presentation-source-grant-tombstones'),
      draftTombstoneRoot: path.join(userDataDir, 'presentation-source-draft-tombstones'),
      journalRoot: path.join(userDataDir, 'presentation-run-journal'),
      indexRoot: path.join(userDataDir, 'presentation-run-indexes'),
      quarantineRoot: path.join(userDataDir, 'presentation-run-quarantine'),
      stagingRoot: path.join(tempDir, 'aionui-presentation-runs'),
      inspectionRoot: path.join(tempDir, 'aionui-presentation-inspection'),
    };
  }

  async initialize(): Promise<void> {
    await Promise.all(Object.values(this.roots).map((directory) => this.ensureOwnedDirectory(directory)));
  }

  async createRunLayout(runId: string): Promise<{
    runDirectory: string;
    retainedDirectory: string;
    stagingDirectory: string;
  }> {
    assertUuid(runId, 'run');
    await this.initialize();
    const runDirectory = this.ownedChild(this.roots.runRoot, runId);
    const retainedDirectory = path.join(runDirectory, 'retained');
    const stagingRunDirectory = this.ownedChild(this.roots.stagingRoot, runId);
    const stagingDirectory = path.join(stagingRunDirectory, 'agent');
    await this.ensureOwnedDirectory(runDirectory);
    await this.ensureOwnedDirectory(retainedDirectory);
    await this.ensureOwnedDirectory(stagingRunDirectory);
    await this.ensureOwnedDirectory(stagingDirectory);
    return { runDirectory, retainedDirectory, stagingDirectory };
  }

  /** Writes all pre-dispatch bytes to private, fsynced temporary files without making them authoritative. */
  async prepareRunAssets(unsafeInput: PreparePresentationRunAssetsInput): Promise<PreparedPresentationRunAssets> {
    const input = structuredClone(unsafeInput);
    assertUuid(input.runId, 'run');
    const candidateBytes = Buffer.from(input.candidateBytes);
    const groundingBytes = Buffer.from(input.grounding, 'utf8');
    if (
      candidateBytes.byteLength < 1 ||
      candidateBytes.byteLength > PRESENTATION_RUN_LIMITS.MAX_REFERENCE_BYTES ||
      groundingBytes.byteLength < 1
    ) {
      throw new Error('Invalid presentation run preparation');
    }
    const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
    const groundingSha256 = createHash('sha256').update(groundingBytes).digest('hex');
    const payload: PresentationRunPreparationPayload = {
      version: 1,
      rawInput: input.rawInput,
      directive: input.directive,
      sourceRefs: input.sourceRefs.map((sourceRef) => ({ ...sourceRef })),
      injectSkills: ['officecli'],
      template: {
        theme: { ...input.template.theme },
        reference: { ...input.template.reference },
      },
      grounding: {
        relativePath: STAGING_GROUNDING_RELATIVE_PATH,
        sha256: groundingSha256,
        byteLength: groundingBytes.byteLength,
      },
      candidate: {
        relativePath: STAGING_CANDIDATE_RELATIVE_PATH,
        sha256: candidateSha256,
        byteLength: candidateBytes.byteLength,
      },
    };
    const preparationBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    const record: PresentationRunPreparationRecord = {
      payload,
      relativePath: PREPARATION_RELATIVE_PATH,
      sha256: createHash('sha256').update(preparationBytes).digest('hex'),
      byteLength: preparationBytes.byteLength,
    };
    assertPresentationRunPreparationRecord(record);
    if (
      input.injectSkills.length !== 1 ||
      input.injectSkills[0] !== 'officecli' ||
      payload.template.reference.sha256 !== candidateSha256 ||
      payload.template.reference.byteLength !== candidateBytes.byteLength
    ) {
      throw new Error('Invalid presentation run preparation');
    }
    const totalBytes = candidateBytes.byteLength + groundingBytes.byteLength + preparationBytes.byteLength;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > PRESENTATION_RUN_LIMITS.MAX_NON_RENDER_COPY_WRITE_BYTES_PER_RUN
    ) {
      throw new Error('Presentation run preparation exceeds its write limit');
    }

    const layout = await this.createRunLayout(input.runId);
    const candidateTemporaryRelativePath = `agent/.candidate-${this.randomUUID()}.tmp`;
    const groundingTemporaryRelativePath = `agent/.grounding-${this.randomUUID()}.tmp`;
    const preparationTemporaryRelativePath = `.preparation-${this.randomUUID()}.tmp`;
    const stagingRunDirectory = this.ownedChild(this.roots.stagingRoot, input.runId);
    const candidateTemporaryPath = path.join(stagingRunDirectory, candidateTemporaryRelativePath);
    const groundingTemporaryPath = path.join(stagingRunDirectory, groundingTemporaryRelativePath);
    const preparationTemporaryPath = path.join(layout.runDirectory, preparationTemporaryRelativePath);
    const candidateFinalPath = path.join(stagingRunDirectory, STAGING_CANDIDATE_RELATIVE_PATH);
    const groundingFinalPath = path.join(stagingRunDirectory, STAGING_GROUNDING_RELATIVE_PATH);
    const preparationFinalPath = path.join(layout.runDirectory, PREPARATION_RELATIVE_PATH);
    const cleanupEntries: { filePath: string; parentDirectory: string; metadata: FileMetadata }[] = [];
    const directoryChain = [
      ...this.stagingCandidateDirectoryChain(input.runId),
      ...this.durableRunDirectoryChain(input.runId),
    ];
    return this.withDirectoryLease(directoryChain, async (directoryLease) => {
      try {
        await directoryLease.assertMode(
          layout.stagingDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation staging directory must be private'
        );
        await directoryLease.assertMode(
          layout.runDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation run directory must be private'
        );
        await this.removeAbandonedRunPreparationTemps(layout, directoryLease);
        await Promise.all([
          assertPathAbsent(candidateFinalPath, 'Presentation staging candidate already exists'),
          assertPathAbsent(groundingFinalPath, 'Presentation staging grounding already exists'),
          assertPathAbsent(preparationFinalPath, 'Presentation run preparation already exists'),
        ]);
        const candidateMetadata = await this.writePreparedRunBytes(
          candidateTemporaryPath,
          candidateBytes,
          directoryLease,
          cleanupEntries,
          layout.stagingDirectory
        );
        const groundingMetadata = await this.writePreparedRunBytes(
          groundingTemporaryPath,
          groundingBytes,
          directoryLease,
          cleanupEntries,
          layout.stagingDirectory
        );
        const preparationMetadata = await this.writePreparedRunBytes(
          preparationTemporaryPath,
          preparationBytes,
          directoryLease,
          cleanupEntries,
          layout.runDirectory
        );
        await directoryLease.sync(layout.stagingDirectory);
        await directoryLease.sync(layout.runDirectory);
        const prepared: PreparedPresentationRunAssets = {
          runId: input.runId,
          record,
          candidate: {
            temporaryRelativePath: candidateTemporaryRelativePath,
            finalRelativePath: STAGING_CANDIDATE_RELATIVE_PATH,
            sha256: candidateSha256,
            byteLength: candidateBytes.byteLength,
            ...fileIdentity(candidateMetadata),
          },
          grounding: {
            temporaryRelativePath: groundingTemporaryRelativePath,
            finalRelativePath: STAGING_GROUNDING_RELATIVE_PATH,
            sha256: groundingSha256,
            byteLength: groundingBytes.byteLength,
            ...fileIdentity(groundingMetadata),
          },
          preparationFile: {
            temporaryRelativePath: preparationTemporaryRelativePath,
            finalRelativePath: PREPARATION_RELATIVE_PATH,
            sha256: record.sha256,
            byteLength: record.byteLength,
            ...fileIdentity(preparationMetadata),
          },
        };
        assertPreparedPresentationRunAssets(prepared);
        return prepared;
      } catch (error) {
        if (error instanceof PresentationRunSimulatedProcessCrashError) throw error;
        for (const entry of cleanupEntries.toReversed()) {
          await this.removeLeafWithExpectedIdentity(
            entry.filePath,
            entry.metadata,
            entry.parentDirectory,
            directoryLease
          ).catch((): undefined => undefined);
        }
        throw error;
      }
    });
  }

  private async removeAbandonedRunPreparationTemps(
    layout: { runDirectory: string; stagingDirectory: string },
    directoryLease: OwnedDirectoryLease
  ): Promise<void> {
    const locations = [
      { directory: layout.stagingDirectory, pattern: RUN_AGENT_TEMP_RE },
      { directory: layout.runDirectory, pattern: RUN_PREPARATION_TEMP_RE },
    ];
    for (const { directory, pattern } of locations) {
      await directoryLease.assertCurrent();
      const entries = await readdir(directory, { withFileTypes: true });
      await directoryLease.assertCurrent();
      for (const entry of entries) {
        if (!pattern.test(entry.name)) continue;
        const temporaryPath = path.join(directory, entry.name);
        const opened = await openOwnedRegularFile(
          temporaryPath,
          'Abandoned presentation preparation temporary file is unsafe'
        );
        await opened.handle.close();
        await this.removeLeafWithExpectedIdentity(temporaryPath, opened.metadata, directory, directoryLease);
      }
    }
  }

  async createGrantLayout(grantId: string): Promise<string> {
    assertUuid(grantId, 'source grant');
    await this.initialize();
    const directory = this.ownedChild(this.roots.grantRoot, grantId);
    await this.ensureOwnedDirectory(directory);
    return directory;
  }

  async createDraftLayout(draftId: string): Promise<string> {
    assertUuid(draftId, 'source draft');
    await this.initialize();
    const directory = this.ownedChild(this.roots.draftRoot, draftId);
    await this.ensureOwnedDirectory(directory);
    return directory;
  }

  async createOwnerLayout(ownerId: string): Promise<string> {
    assertUuid(ownerId, 'source owner');
    await this.initialize();
    const directory = this.ownedChild(this.roots.ownerRoot, ownerId);
    await this.ensureOwnedDirectory(directory);
    return directory;
  }

  async createInspectionLayout(runId: string): Promise<string> {
    assertUuid(runId, 'run');
    await this.initialize();
    const runDirectory = this.ownedChild(this.roots.inspectionRoot, runId);
    await this.ensureOwnedDirectory(runDirectory);
    const inspectionId = this.randomUUID();
    assertUuid(inspectionId, 'inspection');
    const inspectionDirectory = this.ownedChild(runDirectory, inspectionId);
    await this.ensureOwnedDirectory(inspectionDirectory);
    return inspectionDirectory;
  }

  async readAuthorizedPlan(runId: string): Promise<Buffer> {
    assertUuid(runId, 'run');
    const planPath = this.getStagingRunPaths(runId).planPath;
    const message = 'Presentation plan must be one bounded regular file';
    return this.withDirectoryLease(this.stagingCandidateDirectoryChain(runId), async (directoryLease) => {
      const { handle, metadata } = await openOwnedRegularFile(planPath, message);
      try {
        if (metadata.size < BigInt(1) || metadata.size > BigInt(PRESENTATION_RUN_LIMITS.MAX_PLAN_JSON_BYTES)) {
          throw new Error(message);
        }
        await assertPathNamesFile(planPath, metadata, message);
        await directoryLease.assertCurrent();
        const bytes = Buffer.alloc(Number(metadata.size));
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (bytesRead === 0) throw new Error('Presentation plan changed while reading');
          offset += bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        if (!sameFileIdentity(metadata, after) || metadata.size !== after.size) {
          throw new Error('Presentation plan changed while reading');
        }
        await directoryLease.assertCurrent();
        return bytes;
      } finally {
        await handle.close();
      }
    });
  }

  async createDeferredInspectionWorkspace(runId: string): Promise<DeferredPresentationInspectionWorkspace> {
    const directory = await this.createInspectionLayout(runId);
    const runDirectory = this.ownedChild(this.roots.inspectionRoot, runId);
    let disposeRequested = false;
    let cleaned = false;
    return Object.freeze({
      directory,
      dispose: async (): Promise<void> => {
        disposeRequested = true;
      },
      cleanupAfterSettlement: async (): Promise<void> => {
        if (cleaned) return;
        if (!disposeRequested) throw new Error('Inspection cleanup requires service disposal first');
        await this.removeOwnedDirectoryTree(
          [this.tempDir, this.roots.inspectionRoot, runDirectory, directory],
          directory
        );
        cleaned = true;
      },
    });
  }

  async cleanupSettledInspectionWorkspaces(runId: string): Promise<void> {
    assertUuid(runId, 'run');
    const runDirectory = this.ownedChild(this.roots.inspectionRoot, runId);
    await this.removeOwnedDirectoryTree([this.tempDir, this.roots.inspectionRoot, runDirectory], runDirectory);
  }

  getEntityManifestPath(kind: PresentationRunEntityKind, entityId: string): string {
    const root = this.entityRoot(kind);
    if (kind.endsWith('-tombstone')) {
      assertUuid(entityId, kind.replace('-tombstone', ''));
      return path.join(root, `${entityId}.json`);
    }
    assertUuid(
      entityId,
      kind === 'grant' ? 'source grant' : kind === 'draft' ? 'source draft' : kind === 'owner' ? 'source owner' : 'run'
    );
    return path.join(this.ownedChild(root, entityId), 'manifest.json');
  }

  getJournalPath(): string {
    return path.join(this.roots.journalRoot, 'journal.jsonl');
  }

  getIndexPath(): string {
    return path.join(this.roots.indexRoot, 'index.json');
  }

  async withJournalDirectoryLease<T>(operation: (lease: PresentationOwnedDirectoryLease) => Promise<T>): Promise<T> {
    return this.withDirectoryLease([this.userDataDir, this.roots.journalRoot], operation);
  }

  async withIndexDirectoryLease<T>(operation: (lease: PresentationOwnedDirectoryLease) => Promise<T>): Promise<T> {
    return this.withDirectoryLease([this.userDataDir, this.roots.indexRoot], operation);
  }

  async withEntityParentDirectoryLease<T>(
    kind: PresentationRunEntityKind,
    entityId: string,
    operation: (lease: PresentationOwnedDirectoryLease) => Promise<T>
  ): Promise<T> {
    this.getEntityManifestPath(kind, entityId);
    const root = this.entityRoot(kind);
    const directories = kind.endsWith('-tombstone')
      ? [this.userDataDir, root]
      : [this.userDataDir, root, this.ownedChild(root, entityId)];
    return this.withDirectoryLease(directories, operation);
  }

  async withExistingEntityParentDirectoryLease<T>(
    kind: PresentationRunEntityKind,
    entityId: string,
    operation: (lease: PresentationOwnedDirectoryLease) => Promise<T>
  ): Promise<T | null> {
    this.getEntityManifestPath(kind, entityId);
    const root = this.entityRoot(kind);
    const rootLease = await OwnedDirectoryLease.acquire([this.userDataDir, root], this.syncOwnedDirectory.bind(this));
    let childLease: OwnedDirectoryLease | null = null;
    try {
      if (!kind.endsWith('-tombstone')) {
        const child = this.ownedChild(root, entityId);
        try {
          childLease = await OwnedDirectoryLease.acquire([child], this.syncOwnedDirectory.bind(this));
        } catch (error) {
          await rootLease.assertCurrent();
          if (hasCode(error, 'ENOENT')) return null;
          throw error;
        }
      }
      const combinedLease: PresentationOwnedDirectoryLease = {
        assertCurrent: async (): Promise<void> => {
          await rootLease.assertCurrent();
          await childLease?.assertCurrent();
          await rootLease.assertCurrent();
        },
        sync: async (directory: string): Promise<void> => {
          const resolved = path.resolve(directory);
          if (childLease !== null && resolved === this.ownedChild(root, entityId)) {
            await childLease.sync(resolved);
            return;
          }
          await rootLease.sync(resolved);
        },
      };
      await combinedLease.assertCurrent();
      const result = await operation(combinedLease);
      await combinedLease.assertCurrent();
      return result;
    } finally {
      await childLease?.close();
      await rootLease.close();
    }
  }

  async withPreparedRetainedCandidateLeases<T>(
    preparedCandidates: readonly PreparedRetainedCandidate[],
    operation: (guard: PresentationPreparedCandidateGuard) => Promise<T>
  ): Promise<T> {
    for (const prepared of preparedCandidates) assertPreparedRetainedCandidate(prepared);
    const directories = preparedCandidates.flatMap((prepared) => this.durableRunDirectoryChain(prepared.runId));
    return this.withDirectoryLease(directories, async (directoryLease) => {
      const candidates: VerifiedCandidateLease[] = [];
      try {
        for (const prepared of preparedCandidates) {
          const temporaryPath = path.join(
            this.ownedChild(this.roots.runRoot, prepared.runId),
            prepared.temporaryRelativePath
          );
          candidates.push(
            await openVerifiedCandidateLease(
              temporaryPath,
              prepared,
              {
                unsafe: 'Retained candidate temporary file is unsafe',
                changed: 'Retained candidate temporary file changed',
              },
              prepared
            )
          );
        }
        const guard: PresentationPreparedCandidateGuard = {
          assertCurrent: async (): Promise<void> => {
            await directoryLease.assertCurrent();
            for (const candidate of candidates) await assertVerifiedCandidateLease(candidate);
            await directoryLease.assertCurrent();
          },
        };
        await guard.assertCurrent();
        const result = await operation(guard);
        await guard.assertCurrent();
        return result;
      } finally {
        await Promise.all(candidates.map(({ handle }) => handle.close()));
      }
    });
  }

  async authorizeWorkspaceSourcePath(
    workspaceRoot: string,
    relativePath: string
  ): Promise<PresentationSourcePathAuthorization> {
    if (
      !path.isAbsolute(workspaceRoot) ||
      path.resolve(workspaceRoot) !== workspaceRoot ||
      relativePath.length < 1 ||
      relativePath.includes('\0') ||
      relativePath.includes('\\') ||
      path.isAbsolute(relativePath) ||
      relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation workspace source authorization is invalid');
    }
    let allowedRootPath: string;
    try {
      allowedRootPath = await realpath(workspaceRoot);
    } catch (error) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation workspace root is unavailable', error);
    }
    const sourcePath = path.resolve(allowedRootPath, relativePath);
    if (!isWithinRoot(allowedRootPath, sourcePath)) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation workspace source escapes its root');
    }
    const stableSourcePath = await resolveStableSourcePath(sourcePath);
    if (!isWithinRoot(allowedRootPath, stableSourcePath.canonicalPath)) {
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation workspace source escapes its root');
    }
    const rootHandle = await open(allowedRootPath, constants.O_RDONLY | noFollowFlag() | directoryOnlyFlag());
    try {
      const allowedRootMetadata = await rootHandle.stat({ bigint: true });
      assertStableSourceDirectory(allowedRootMetadata);
      const namedRoot = await lstat(allowedRootPath, { bigint: true });
      if (namedRoot.isSymbolicLink() || !namedRoot.isDirectory() || !sameFileIdentity(allowedRootMetadata, namedRoot)) {
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation workspace root changed');
      }
      const sourceMetadata = await lstat(stableSourcePath.canonicalPath, { bigint: true });
      if (sourceMetadata.isSymbolicLink()) {
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation workspace source must be a real file');
      }
      assertStableSourceFile(sourceMetadata, 'Presentation workspace source must be a real file');
      await stableSourcePath.assertCurrent();
      const authorization: PresentationSourcePathAuthorization = {
        allowedRootPath,
        allowedRootDev: allowedRootMetadata.dev.toString(),
        allowedRootIno: allowedRootMetadata.ino.toString(),
        canonicalSourcePath: stableSourcePath.canonicalPath,
        sourceDev: sourceMetadata.dev.toString(),
        sourceIno: sourceMetadata.ino.toString(),
      };
      assertSourcePathAuthorization(authorization);
      return authorization;
    } catch (error) {
      if (error instanceof PresentationSourceSnapshotError) throw error;
      throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation workspace source authorization failed', error);
    } finally {
      await rootHandle.close();
    }
  }

  async prepareSourceSnapshots(
    inputs: readonly PreparePresentationSourceSnapshotInput[]
  ): Promise<PreparedPresentationSourceSnapshot[]> {
    if (inputs.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN) {
      throw sourceSnapshotFailure('SOURCE_LIMIT_EXCEEDED', 'Too many presentation sources were selected');
    }
    const grantIds = new Set<string>();
    for (const input of inputs) {
      assertSourceSnapshotInput(input);
      if (grantIds.has(input.grantId)) {
        throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source grant ids must be unique');
      }
      grantIds.add(input.grantId);
    }
    const prepared: PreparedPresentationSourceSnapshot[] = [];
    let totalBytes = 0;
    try {
      for (const input of inputs) {
        const snapshot = await this.prepareSourceSnapshot(input);
        prepared.push(snapshot);
        totalBytes += snapshot.byteLength;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES) {
          throw sourceSnapshotFailure('SOURCE_LIMIT_EXCEEDED', 'Presentation sources exceed their total limit');
        }
      }
      return prepared;
    } catch (error) {
      if (error instanceof PresentationRunSimulatedProcessCrashError) throw error;
      let cleanupError: unknown;
      for (const snapshot of prepared) {
        try {
          await this.removePreparedSourceSnapshot(snapshot);
        } catch (candidate) {
          cleanupError ??= candidate;
        }
      }
      if (cleanupError !== undefined) throw cleanupError;
      throw error;
    }
  }

  async prepareSourceSnapshot(
    input: PreparePresentationSourceSnapshotInput
  ): Promise<PreparedPresentationSourceSnapshot> {
    assertSourceSnapshotInput(input);
    const grantDirectory = await this.createGrantLayout(input.grantId);
    const temporaryRelativePath = `.source-${this.randomUUID()}.tmp`;
    const temporaryPath = path.join(grantDirectory, temporaryRelativePath);
    const finalRelativePath = `source.${input.format}` as const;
    const finalPath = path.join(grantDirectory, finalRelativePath);
    const sourceMessage = 'Presentation source must remain one stable regular file';
    try {
      let authorizationLease: SourcePathAuthorizationLease | null = null;
      let sourceLease: SourceAncestorLease | null = null;
      try {
        await this.inject({ boundary: 'before-grant-source-resolution', grantId: input.grantId });
        authorizationLease =
          input.authorization === undefined ? null : await SourcePathAuthorizationLease.acquire(input.authorization);
        const stableSourcePath = await resolveStableSourcePath(input.sourcePath);
        sourceLease = await SourceAncestorLease.acquire(stableSourcePath.canonicalPath);
        return await this.withDirectoryLease(this.durableGrantDirectoryChain(input.grantId), async (directoryLease) => {
          let source: OpenHandle | null = null;
          let target: OpenHandle | null = null;
          let targetIdentity: FileMetadata | null = null;
          try {
            await directoryLease.assertMode(
              grantDirectory,
              PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
              'Presentation storage directory must be private'
            );
            await this.inject({ boundary: 'before-grant-source-open', grantId: input.grantId });
            await authorizationLease?.assertCurrent();
            await stableSourcePath.assertCurrent();
            await sourceLease.assertCurrent();
            await directoryLease.assertCurrent();
            await assertPathAbsent(finalPath, 'Presentation source snapshot already exists');
            const openedSource = await openStableSourceFile(stableSourcePath.canonicalPath, sourceMessage);
            source = openedSource.handle;
            const sourceBefore = openedSource.metadata;
            authorizationLease?.assertCanonicalSource(stableSourcePath.canonicalPath, sourceBefore);
            if (
              sourceBefore.size < BigInt(1) ||
              sourceBefore.size > BigInt(PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES) ||
              sourceBefore.size > BigInt(Number.MAX_SAFE_INTEGER)
            ) {
              throw sourceSnapshotFailure(
                'SOURCE_LIMIT_EXCEEDED',
                'Presentation source must be between 1 byte and 64 MiB'
              );
            }
            const byteLength = Number(sourceBefore.size);
            await this.inject({ boundary: 'before-grant-temp-create', grantId: input.grantId });
            await authorizationLease?.assertCurrent();
            await stableSourcePath.assertCurrent();
            await authorizationLease?.assertCurrent();
            await sourceLease.assertCurrent();
            await directoryLease.assertCurrent();
            target = await open(
              temporaryPath,
              constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollowFlag(),
              PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
            );
            targetIdentity = await target.stat({ bigint: true });
            assertOwnedRegularFile(targetIdentity, 'Presentation source temporary snapshot is unsafe');
            if ((targetIdentity.mode & PERMISSION_MODE_MASK) !== BigInt(PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE)) {
              await target.chmod(PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE);
              const afterChmod = await target.stat({ bigint: true });
              if (!sameFileIdentity(targetIdentity, afterChmod)) {
                throw new Error('Presentation source temporary snapshot changed');
              }
              targetIdentity = afterChmod;
            }
            assertOwnedRegularFileMode(
              targetIdentity,
              PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE,
              'Presentation source temporary snapshot is unsafe'
            );
            await assertPathNamesFile(
              temporaryPath,
              targetIdentity,
              'Presentation source temporary snapshot is unsafe'
            );
            const hash = createHash('sha256');
            const validator = createSourceStreamValidator(input.format);
            const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, byteLength));
            let position = 0;
            await this.inject({ boundary: 'before-grant-temp-write', grantId: input.grantId });
            await stableSourcePath.assertCurrent();
            await authorizationLease?.assertCurrent();
            await sourceLease.assertCurrent();
            await directoryLease.assertCurrent();
            while (position < byteLength) {
              let bytesRead: number;
              try {
                ({ bytesRead } = await source.read(
                  buffer,
                  0,
                  Math.min(buffer.length, byteLength - position),
                  position
                ));
              } catch (error) {
                throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source changed while reading', error);
              }
              if (bytesRead === 0) {
                throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source changed while reading');
              }
              validator.update(buffer.subarray(0, bytesRead));
              let chunkOffset = 0;
              while (chunkOffset < bytesRead) {
                const remaining = bytesRead - chunkOffset;
                const bytesWritten = await this.writeCandidateChunk(
                  target,
                  buffer,
                  chunkOffset,
                  remaining,
                  position + chunkOffset
                );
                if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) {
                  throw new Error('Presentation source snapshot write was incomplete');
                }
                chunkOffset += bytesWritten;
              }
              hash.update(buffer.subarray(0, bytesRead));
              position += bytesRead;
            }
            validator.finish();
            await this.inject({ boundary: 'after-grant-temp-write', grantId: input.grantId });
            const sourceAfter = await source.stat({ bigint: true });
            assertStableSourceFile(sourceAfter, sourceMessage);
            if (!sameSourceVersion(sourceBefore, sourceAfter)) {
              throw sourceSnapshotFailure('SOURCE_TAMPERED', 'Presentation source changed while reading');
            }
            await assertPathNamesSourceFile(stableSourcePath.canonicalPath, sourceAfter, sourceMessage);
            await stableSourcePath.assertCurrent();
            await sourceLease.assertCurrent();
            await directoryLease.assertCurrent();
            const targetAfterWrite = await target.stat({ bigint: true });
            assertOwnedRegularFileMode(
              targetAfterWrite,
              PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE,
              'Presentation source temporary snapshot is unsafe'
            );
            if (
              !sameFileIdentity(targetIdentity, targetAfterWrite) ||
              targetAfterWrite.size !== BigInt(byteLength) ||
              (targetAfterWrite.mode & PERMISSION_MODE_MASK) !== BigInt(PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE)
            ) {
              throw new Error('Presentation source temporary snapshot changed');
            }
            await assertPathNamesFile(
              temporaryPath,
              targetAfterWrite,
              'Presentation source temporary snapshot changed'
            );
            await this.inject({ boundary: 'before-grant-temp-fsync', grantId: input.grantId });
            await directoryLease.assertCurrent();
            await target.sync();
            await this.inject({ boundary: 'after-grant-temp-fsync', grantId: input.grantId });
            await directoryLease.assertCurrent();
            if (input.format === 'docx' || input.format === 'xlsx' || input.format === 'pptx') {
              await validateOoxmlSnapshot(temporaryPath, targetAfterWrite, input.format);
              await this.inject({ boundary: 'after-grant-ooxml-validation', grantId: input.grantId });
            }
            await this.inject({ boundary: 'before-grant-temp-directory-fsync', grantId: input.grantId });
            await directoryLease.assertMode(
              grantDirectory,
              PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
              'Presentation storage directory must be private'
            );
            await directoryLease.sync(grantDirectory);
            await this.inject({ boundary: 'after-grant-temp-directory-fsync', grantId: input.grantId });
            await directoryLease.assertMode(
              grantDirectory,
              PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
              'Presentation storage directory must be private'
            );
            await target.close();
            target = null;
            const sha256 = hash.digest('hex');
            const identity = fileIdentity(targetIdentity);
            const verifiedTemporary = await verifyCandidatePath(
              temporaryPath,
              { sha256, byteLength },
              {
                unsafe: 'Presentation source temporary snapshot is unsafe',
                changed: 'Presentation source temporary snapshot changed',
              },
              identity,
              PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
            );
            if (!sameFileIdentity(targetIdentity, verifiedTemporary)) {
              throw new Error('Presentation source temporary snapshot changed');
            }
            return {
              grantId: input.grantId,
              format: input.format,
              temporaryRelativePath,
              finalRelativePath,
              sha256,
              byteLength,
              ...identity,
            };
          } catch (error) {
            if (error instanceof PresentationRunSimulatedProcessCrashError) {
              if (target !== null) await target.close().catch((): undefined => undefined);
              throw error;
            }
            if (target !== null) {
              await target.close();
              target = null;
            }
            if (targetIdentity !== null) {
              await this.removeLeafWithExpectedIdentity(temporaryPath, targetIdentity, grantDirectory, directoryLease);
            }
            throw error;
          } finally {
            if (source !== null) await source.close();
          }
        });
      } finally {
        await sourceLease?.close();
        await authorizationLease?.close();
      }
    } catch (error) {
      if (error instanceof PresentationRunSimulatedProcessCrashError) throw error;
      const removed = await this.removeEmptyGrantDirectory(input.grantId);
      if (!removed) throw new Error('Presentation source cleanup left unexpected grant files', { cause: error });
      throw error;
    }
  }

  async withPreparedSourceSnapshotLeases<T>(
    preparedSnapshots: readonly PreparedPresentationSourceSnapshot[],
    operation: (guard: PresentationPreparedSourceSnapshotGuard) => Promise<T>
  ): Promise<T> {
    for (const prepared of preparedSnapshots) assertPreparedSourceSnapshot(prepared);
    const directories = preparedSnapshots.flatMap((prepared) => this.durableGrantDirectoryChain(prepared.grantId));
    const grantDirectories = [
      ...new Set(preparedSnapshots.map((prepared) => this.ownedChild(this.roots.grantRoot, prepared.grantId))),
    ];
    return this.withDirectoryLease(directories, async (directoryLease) => {
      const snapshots: VerifiedCandidateLease[] = [];
      try {
        for (const grantDirectory of grantDirectories) {
          await directoryLease.assertMode(
            grantDirectory,
            PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
            'Presentation storage directory must be private'
          );
        }
        for (const prepared of preparedSnapshots) {
          const temporaryPath = path.join(
            this.ownedChild(this.roots.grantRoot, prepared.grantId),
            prepared.temporaryRelativePath
          );
          snapshots.push(
            await openVerifiedCandidateLease(
              temporaryPath,
              prepared,
              {
                unsafe: 'Presentation source temporary snapshot is unsafe',
                changed: 'Presentation source temporary snapshot changed',
              },
              prepared,
              PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
            )
          );
        }
        const guard: PresentationPreparedSourceSnapshotGuard = {
          assertCurrent: async (): Promise<void> => {
            await directoryLease.assertCurrent();
            for (const grantDirectory of grantDirectories) {
              await directoryLease.assertMode(
                grantDirectory,
                PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
                'Presentation storage directory must be private'
              );
            }
            for (const snapshot of snapshots) await assertVerifiedCandidateLease(snapshot);
            await directoryLease.assertCurrent();
          },
        };
        await guard.assertCurrent();
        const result = await operation(guard);
        await guard.assertCurrent();
        return result;
      } finally {
        await Promise.all(snapshots.map(({ handle }) => handle.close()));
      }
    });
  }

  async promoteSourceSnapshot(prepared: PreparedPresentationSourceSnapshot): Promise<void> {
    assertPreparedSourceSnapshot(prepared);
    const grantDirectory = this.ownedChild(this.roots.grantRoot, prepared.grantId);
    const temporaryPath = path.join(grantDirectory, prepared.temporaryRelativePath);
    const finalPath = path.join(grantDirectory, prepared.finalRelativePath);
    await this.withDirectoryLease(this.durableGrantDirectoryChain(prepared.grantId), async (directoryLease) => {
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
      const snapshot = await openVerifiedCandidateLease(
        temporaryPath,
        prepared,
        {
          unsafe: 'Presentation source temporary snapshot is unsafe',
          changed: 'Presentation source temporary snapshot changed',
        },
        prepared,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
      try {
        await assertPathAbsent(finalPath, 'Presentation source snapshot already exists');
        await directoryLease.assertMode(
          grantDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation storage directory must be private'
        );
        await this.inject({ boundary: 'before-grant-promotion-rename', grantId: prepared.grantId });
        await directoryLease.assertMode(
          grantDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation storage directory must be private'
        );
        await assertVerifiedCandidateLease(snapshot);
        await rename(temporaryPath, finalPath);
        snapshot.path = finalPath;
        snapshot.messages = {
          unsafe: 'Presentation source promotion found an unsafe final snapshot',
          changed: 'Presentation source promotion found mismatched bytes',
        };
        await this.inject({ boundary: 'after-grant-promotion-rename', grantId: prepared.grantId });
        await directoryLease.assertMode(
          grantDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation storage directory must be private'
        );
        await assertVerifiedCandidateLease(snapshot);
        await this.inject({ boundary: 'before-grant-promotion-directory-fsync', grantId: prepared.grantId });
        await directoryLease.assertMode(
          grantDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation storage directory must be private'
        );
        await directoryLease.sync(grantDirectory);
        await this.inject({ boundary: 'after-grant-promotion-directory-fsync', grantId: prepared.grantId });
        await directoryLease.assertMode(
          grantDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation storage directory must be private'
        );
        await assertVerifiedCandidateLease(snapshot);
      } finally {
        await snapshot.handle.close();
      }
    });
  }

  async verifyPreparedSourceSnapshot(prepared: PreparedPresentationSourceSnapshot): Promise<void> {
    assertPreparedSourceSnapshot(prepared);
    const grantDirectory = this.ownedChild(this.roots.grantRoot, prepared.grantId);
    const temporaryPath = path.join(grantDirectory, prepared.temporaryRelativePath);
    await this.withDirectoryLease(this.durableGrantDirectoryChain(prepared.grantId), async (directoryLease) => {
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
      await verifyCandidatePath(
        temporaryPath,
        prepared,
        {
          unsafe: 'Presentation source temporary snapshot is unsafe',
          changed: 'Presentation source temporary snapshot changed',
        },
        prepared,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
    });
  }

  async verifySourceSnapshot(reference: PresentationSourceSnapshotReference): Promise<void> {
    assertSourceSnapshotReference(reference);
    const grantDirectory = this.ownedChild(this.roots.grantRoot, reference.grantId);
    const snapshotPath = path.join(grantDirectory, reference.relativePath);
    await this.withDirectoryLease(this.durableGrantDirectoryChain(reference.grantId), async (directoryLease) => {
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
      await verifyCandidatePath(
        snapshotPath,
        reference,
        {
          unsafe: 'Presentation source snapshot is unsafe',
          changed: 'Presentation source snapshot does not match its manifest',
        },
        undefined,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
    });
  }

  /** Holds the verified Task-3 snapshot open while extraction uses its main-only path capability. */
  async withAuthorizedSourceSnapshot<T>(
    reference: PresentationSourceSnapshotReference,
    operation: (reader: PresentationSourceSnapshotReader) => Promise<T>
  ): Promise<T> {
    assertSourceSnapshotReference(reference);
    const grantDirectory = this.ownedChild(this.roots.grantRoot, reference.grantId);
    const sourcePath = path.join(grantDirectory, reference.relativePath);
    return this.withDirectoryLease(this.durableGrantDirectoryChain(reference.grantId), async (directoryLease) => {
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
      const snapshot = await openVerifiedCandidateLease(
        sourcePath,
        reference,
        {
          unsafe: 'Authorized presentation source snapshot is unavailable',
          changed: 'Authorized presentation source snapshot changed',
        },
        undefined,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
      try {
        const reader: PresentationSourceSnapshotReader = Object.freeze({
          byteLength: reference.byteLength,
          readBytes: async (): Promise<Buffer> => {
            await directoryLease.assertCurrent();
            await assertVerifiedCandidateLease(snapshot);
            const bytes = await readOpenFileExactly(
              snapshot.handle,
              reference.byteLength,
              'Authorized presentation source snapshot changed'
            );
            await assertVerifiedCandidateLease(snapshot);
            await directoryLease.assertCurrent();
            return bytes;
          },
        });
        const result = await operation(reader);
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(snapshot);
        await directoryLease.assertCurrent();
        return result;
      } finally {
        await snapshot.handle.close();
      }
    });
  }

  async recoverSourceSnapshotPromotion(prepared: PreparedPresentationSourceSnapshot): Promise<void> {
    assertPreparedSourceSnapshot(prepared);
    const grantDirectory = this.ownedChild(this.roots.grantRoot, prepared.grantId);
    const temporaryPath = path.join(grantDirectory, prepared.temporaryRelativePath);
    const finalPath = path.join(grantDirectory, prepared.finalRelativePath);
    const finalExists = await this.withDirectoryLease(
      this.durableGrantDirectoryChain(prepared.grantId),
      async (directoryLease) => {
        await directoryLease.assertMode(
          grantDirectory,
          PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
          'Presentation storage directory must be private'
        );
        let snapshot: VerifiedCandidateLease;
        try {
          snapshot = await openVerifiedCandidateLease(
            finalPath,
            prepared,
            {
              unsafe: 'Presentation source recovery found mismatched bytes',
              changed: 'Presentation source recovery found mismatched bytes',
            },
            prepared,
            PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
          );
        } catch (error) {
          if (hasCode(error, 'ENOENT')) return false;
          throw error;
        }
        try {
          await assertPathAbsent(temporaryPath, 'Presentation source recovery found an unexpected temporary snapshot');
          await directoryLease.assertMode(
            grantDirectory,
            PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
            'Presentation storage directory must be private'
          );
          await assertVerifiedCandidateLease(snapshot);
          await directoryLease.sync(grantDirectory);
          await directoryLease.assertMode(
            grantDirectory,
            PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
            'Presentation storage directory must be private'
          );
          await assertVerifiedCandidateLease(snapshot);
          return true;
        } finally {
          await snapshot.handle.close();
        }
      }
    );
    if (!finalExists) await this.promoteSourceSnapshot(prepared);
  }

  async removePreparedSourceSnapshot(prepared: PreparedPresentationSourceSnapshot): Promise<void> {
    assertPreparedSourceSnapshot(prepared);
    const grantDirectory = this.ownedChild(this.roots.grantRoot, prepared.grantId);
    const temporaryPath = path.join(grantDirectory, prepared.temporaryRelativePath);
    await this.withDirectoryLease(this.durableGrantDirectoryChain(prepared.grantId), async (directoryLease) => {
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
      let snapshot: VerifiedCandidateLease;
      try {
        snapshot = await openVerifiedCandidateLease(
          temporaryPath,
          prepared,
          {
            unsafe: 'Presentation source temporary snapshot is unsafe',
            changed: 'Presentation source temporary snapshot changed',
          },
          prepared,
          PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
        );
      } catch (error) {
        if (hasCode(error, 'ENOENT')) {
          await directoryLease.assertCurrent();
          await assertPathAbsent(temporaryPath, 'Presentation cleanup target reappeared');
          await directoryLease.assertCurrent();
          return;
        }
        throw error;
      }
      try {
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(snapshot);
        await rm(temporaryPath);
        const after = await snapshot.handle.stat({ bigint: true });
        if (!sameFileIdentity(snapshot.metadata, after)) {
          throw new Error('Presentation source temporary snapshot changed');
        }
        await directoryLease.assertCurrent();
        await assertPathAbsent(temporaryPath, 'Presentation cleanup target reappeared');
        await directoryLease.assertCurrent();
        await directoryLease.sync(grantDirectory);
        await directoryLease.assertCurrent();
        await assertPathAbsent(temporaryPath, 'Presentation cleanup target reappeared');
        await directoryLease.assertCurrent();
      } finally {
        await snapshot.handle.close();
      }
    });
    await this.removeEmptyGrantDirectory(prepared.grantId);
  }

  async removeUnreferencedSourceTemps(grantId: string, keepRelativePath?: string): Promise<void> {
    assertUuid(grantId, 'source grant');
    const grantDirectory = this.ownedChild(this.roots.grantRoot, grantId);
    try {
      const opened = await openOwnedDirectory(grantDirectory);
      await opened.handle.close();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    await this.withDirectoryLease(this.durableGrantDirectoryChain(grantId), async (directoryLease) => {
      const entries = await readdir(grantDirectory);
      const removable = entries.filter((entry) => SOURCE_TEMP_RE.test(entry) && entry !== keepRelativePath);
      for (const entry of removable) {
        const temporaryPath = path.join(grantDirectory, entry);
        const opened = await openOwnedRegularFile(temporaryPath, 'Presentation source temporary snapshot is unsafe');
        await opened.handle.close();
        await this.removeLeafWithExpectedIdentity(temporaryPath, opened.metadata, grantDirectory, directoryLease);
      }
    });
  }

  async removeAbandonedPreparedSourceGrant(grantId: string): Promise<boolean> {
    assertUuid(grantId, 'source grant');
    const grantDirectory = this.ownedChild(this.roots.grantRoot, grantId);
    let removable = false;
    await this.withDirectoryLease(this.durableGrantDirectoryChain(grantId), async (directoryLease) => {
      await directoryLease.assertMode(
        grantDirectory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation storage directory must be private'
      );
      const entries = await readdir(grantDirectory, { withFileTypes: true });
      await directoryLease.assertCurrent();
      if (
        !entries.every((entry) => {
          const match = entry.isFile() ? SOURCE_TEMP_RE.exec(entry.name) : null;
          return match !== null && UUID_RE.test(match[1]);
        })
      ) {
        return;
      }
      for (const entry of entries) {
        const temporaryPath = path.join(grantDirectory, entry.name);
        const opened = await openOwnedRegularFile(temporaryPath, 'Presentation source temporary snapshot is unsafe');
        await opened.handle.close();
        await this.removeLeafWithExpectedIdentity(temporaryPath, opened.metadata, grantDirectory, directoryLease);
      }
      removable = true;
    });
    if (!removable) return false;
    const removed = await this.removeEmptyGrantDirectory(grantId);
    if (!removed) throw new Error('Presentation source cleanup left unexpected grant files');
    return true;
  }

  async withPreparedRunAssetLeases<T>(
    preparedRuns: readonly PreparedPresentationRunAssets[],
    operation: (guard: PresentationPreparedRunAssetGuard) => Promise<T>
  ): Promise<T> {
    for (const prepared of preparedRuns) assertPreparedPresentationRunAssets(prepared);
    const directories = preparedRuns.flatMap((prepared) => this.preparedRunAssetDirectoryChain(prepared.runId));
    return this.withDirectoryLease(directories, async (directoryLease) => {
      const assets: VerifiedCandidateLease[] = [];
      try {
        for (const prepared of preparedRuns) {
          await this.assertPreparedRunDirectoryModes(prepared.runId, directoryLease);
          for (const entry of this.preparedRunAssetEntries(prepared, false)) {
            assets.push(
              await openVerifiedCandidateLease(
                entry.filePath,
                entry.asset,
                {
                  unsafe: 'Prepared presentation run asset is unsafe',
                  changed: 'Prepared presentation run asset changed',
                },
                entry.asset,
                PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
              )
            );
          }
        }
        const guard: PresentationPreparedRunAssetGuard = {
          assertCurrent: async (): Promise<void> => {
            await directoryLease.assertCurrent();
            for (const prepared of preparedRuns) {
              await this.assertPreparedRunDirectoryModes(prepared.runId, directoryLease);
            }
            for (const asset of assets) await assertVerifiedCandidateLease(asset);
            await directoryLease.assertCurrent();
          },
        };
        await guard.assertCurrent();
        const result = await operation(guard);
        await guard.assertCurrent();
        return result;
      } finally {
        await Promise.all(assets.map(({ handle }) => handle.close()));
      }
    });
  }

  /** Completes or replays the three intent-owned promotions after journal intent persistence. */
  async recoverRunAssetPromotion(prepared: PreparedPresentationRunAssets): Promise<void> {
    assertPreparedPresentationRunAssets(prepared);
    await this.withDirectoryLease(this.preparedRunAssetDirectoryChain(prepared.runId), async (directoryLease) => {
      await this.assertPreparedRunDirectoryModes(prepared.runId, directoryLease);
      for (const entry of this.preparedRunAssetEntries(prepared, false)) {
        await this.recoverPreparedRunAsset(entry, directoryLease);
      }
      await this.assertPreparedRunDirectoryModes(prepared.runId, directoryLease);
    });
  }

  /** Removes only pre-intent temporary bytes; final assets are never cleanup targets here. */
  async removePreparedRunAssets(prepared: PreparedPresentationRunAssets): Promise<void> {
    assertPreparedPresentationRunAssets(prepared);
    await this.withDirectoryLease(this.preparedRunAssetDirectoryChain(prepared.runId), async (directoryLease) => {
      await this.assertPreparedRunDirectoryModes(prepared.runId, directoryLease);
      for (const entry of this.preparedRunAssetEntries(prepared, false)) {
        let opened: VerifiedCandidateLease;
        try {
          opened = await openVerifiedCandidateLease(
            entry.filePath,
            entry.asset,
            {
              unsafe: 'Prepared presentation run cleanup target is unsafe',
              changed: 'Prepared presentation run cleanup target changed',
            },
            entry.asset,
            PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
          );
        } catch (error) {
          if (hasCode(error, 'ENOENT')) {
            await assertPathAbsent(entry.filePath, 'Prepared presentation run cleanup target reappeared');
            continue;
          }
          throw error;
        }
        try {
          await directoryLease.assertCurrent();
          await assertVerifiedCandidateLease(opened);
          await rm(entry.filePath);
          await assertPathAbsent(entry.filePath, 'Prepared presentation run cleanup target reappeared');
          await directoryLease.sync(entry.parentDirectory);
          await assertPathAbsent(entry.filePath, 'Prepared presentation run cleanup target reappeared');
        } finally {
          await opened.handle.close();
        }
      }
    });
  }

  /** Revalidates all committed pre-dispatch bytes and returns only the strict authoritative payload. */
  async readAuthorizedRunPreparation(
    runId: string,
    record: PresentationRunPreparationRecord
  ): Promise<PresentationRunPreparationPayload> {
    assertUuid(runId, 'run');
    assertPresentationRunPreparationRecord(record);
    const paths = this.getStagingRunPaths(runId);
    const preparationPath = path.join(this.ownedChild(this.roots.runRoot, runId), record.relativePath);
    return this.withDirectoryLease(this.preparedRunAssetDirectoryChain(runId), async (directoryLease) => {
      await this.assertPreparedRunDirectoryModes(runId, directoryLease);
      const preparation = await openVerifiedCandidateLease(
        preparationPath,
        record,
        {
          unsafe: 'Authorized presentation preparation is unavailable',
          changed: 'Authorized presentation preparation changed',
        },
        undefined,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
      let grounding: VerifiedCandidateLease | null = null;
      let candidate: VerifiedCandidateLease | null = null;
      try {
        grounding = await openVerifiedCandidateLease(
          paths.groundingPath,
          record.payload.grounding,
          {
            unsafe: 'Authorized presentation grounding is unavailable',
            changed: 'Authorized presentation grounding changed',
          },
          undefined,
          PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
        );
        candidate = await openVerifiedCandidateLease(
          paths.candidatePath,
          record.payload.candidate,
          {
            unsafe: 'Authorized presentation candidate is unavailable',
            changed: 'Authorized presentation candidate changed before dispatch',
          },
          undefined,
          PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
        );
        const bytes = await readOpenFileExactly(
          preparation.handle,
          record.byteLength,
          'Authorized presentation preparation changed'
        );
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
        } catch (error) {
          throw new Error('Authorized presentation preparation is invalid', { cause: error });
        }
        const parsedRecord = { ...record, payload };
        assertPresentationRunPreparationRecord(parsedRecord);
        if (!isDeepStrictEqual(payload, record.payload)) {
          throw new Error('Authorized presentation preparation does not match its manifest');
        }
        await assertVerifiedCandidateLease(preparation);
        await assertVerifiedCandidateLease(grounding);
        await assertVerifiedCandidateLease(candidate);
        await directoryLease.assertCurrent();
        return structuredClone(record.payload);
      } finally {
        await Promise.all([preparation.handle.close(), grounding?.handle.close(), candidate?.handle.close()]);
      }
    });
  }

  getStagingCandidatePath(runId: string): string {
    return this.getStagingRunPaths(runId).candidatePath;
  }

  getStagingRunPaths(runId: string): PresentationStagingRunPaths {
    assertUuid(runId, 'run');
    const agentDirectory = path.join(this.ownedChild(this.roots.stagingRoot, runId), 'agent');
    return {
      candidatePath: path.join(agentDirectory, CANDIDATE_NAME),
      groundingPath: path.join(agentDirectory, GROUNDING_NAME),
      planPath: path.join(agentDirectory, PLAN_NAME),
    };
  }

  async getStagingCandidateByteLength(runId: string): Promise<number> {
    const sourcePath = this.getStagingCandidatePath(runId);
    const message = 'Presentation staging candidate must be one bounded regular file';
    return this.withDirectoryLease(this.stagingCandidateDirectoryChain(runId), async (directoryLease) => {
      const { handle: source, metadata } = await openOwnedRegularFile(sourcePath, message);
      try {
        if (metadata.size > BigInt(PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES)) {
          throw new Error(message);
        }
        await assertPathNamesFile(sourcePath, metadata, message);
        await directoryLease.assertCurrent();
        return Number(metadata.size);
      } finally {
        await source.close();
      }
    });
  }

  async prepareRetainedCandidate(runId: string): Promise<PreparedRetainedCandidate> {
    const layout = await this.createRunLayout(runId);
    const sourcePath = this.getStagingCandidatePath(runId);
    const temporaryRelativePath = `retained/.candidate-${this.randomUUID()}.tmp`;
    const temporaryPath = path.join(layout.runDirectory, temporaryRelativePath);
    const sourceMessage = 'Presentation staging candidate must be one bounded regular file';
    const directoryChain = [...this.stagingCandidateDirectoryChain(runId), ...this.durableRunDirectoryChain(runId)];
    return this.withDirectoryLease(directoryChain, async (directoryLease) => {
      let source: OpenHandle | null = null;
      let target: OpenHandle | null = null;
      let targetIdentity: FileMetadata | null = null;
      try {
        await this.inject({ boundary: 'before-candidate-source-open', runId });
        await directoryLease.assertCurrent();
        const openedSource = await openOwnedRegularFile(sourcePath, sourceMessage);
        source = openedSource.handle;
        const before = openedSource.metadata;
        if (before.size > BigInt(PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES)) {
          throw new Error(sourceMessage);
        }
        const byteLength = Number(before.size);
        const beforeHash = await hashOpenFile(source, byteLength);
        await this.inject({ boundary: 'before-candidate-temp-create', runId });
        await directoryLease.assertCurrent();
        target = await open(
          temporaryPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
          PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
        );
        targetIdentity = await target.stat({ bigint: true });
        assertOwnedRegularFile(targetIdentity, 'Retained candidate temporary file is unsafe');
        await assertPathNamesFile(temporaryPath, targetIdentity, 'Retained candidate temporary file is unsafe');
        const copiedHash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(byteLength, 1)));
        let position = 0;
        await this.inject({ boundary: 'before-candidate-temp-write', runId });
        await directoryLease.assertCurrent();
        while (position < byteLength) {
          const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, byteLength - position), position);
          if (bytesRead === 0) throw new Error('Presentation candidate changed while copying');
          let chunkOffset = 0;
          while (chunkOffset < bytesRead) {
            const remaining = bytesRead - chunkOffset;
            const bytesWritten = await this.writeCandidateChunk(
              target,
              buffer,
              chunkOffset,
              remaining,
              position + chunkOffset
            );
            if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) {
              throw new Error('Presentation retained candidate write was incomplete');
            }
            copiedHash.update(buffer.subarray(chunkOffset, chunkOffset + bytesWritten));
            chunkOffset += bytesWritten;
          }
          position += bytesRead;
        }
        await this.inject({ boundary: 'after-candidate-temp-write', runId });
        await directoryLease.assertCurrent();
        await assertPathNamesFile(temporaryPath, targetIdentity, 'Retained candidate temporary file changed');
        await this.inject({ boundary: 'before-candidate-temp-fsync', runId });
        await directoryLease.assertCurrent();
        await target.sync();
        await this.inject({ boundary: 'after-candidate-temp-fsync', runId });
        await directoryLease.assertCurrent();
        await target.close();
        target = null;
        const afterCopy = await source.stat({ bigint: true });
        const afterHash = await hashOpenFile(source, Number(afterCopy.size));
        const after = await source.stat({ bigint: true });
        const retainedHash = copiedHash.digest('hex');
        if (
          !sameFileIdentity(before, after) ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs ||
          !sameFileIdentity(afterCopy, after) ||
          afterCopy.size !== after.size ||
          beforeHash !== retainedHash ||
          beforeHash !== afterHash
        ) {
          throw new Error('Presentation staging candidate changed while retaining');
        }
        await assertPathNamesFile(sourcePath, after, 'Presentation staging candidate changed while retaining');
        await directoryLease.assertCurrent();
        await this.inject({ boundary: 'before-candidate-temp-directory-fsync', runId });
        await directoryLease.assertCurrent();
        await directoryLease.sync(layout.retainedDirectory);
        await this.inject({ boundary: 'after-candidate-temp-directory-fsync', runId });
        await directoryLease.assertCurrent();
        const identity = fileIdentity(targetIdentity);
        const verifiedTemporary = await verifyCandidatePath(
          temporaryPath,
          { sha256: beforeHash, byteLength },
          {
            unsafe: 'Retained candidate temporary file is unsafe',
            changed: 'Retained candidate temporary file changed',
          },
          identity
        );
        if (!sameFileIdentity(targetIdentity, verifiedTemporary)) {
          throw new Error('Retained candidate temporary file changed');
        }
        return {
          runId,
          temporaryRelativePath,
          finalRelativePath: RETAINED_CANDIDATE_RELATIVE_PATH,
          sha256: beforeHash,
          stagingBeforeRetain: beforeHash,
          retainedTemp: retainedHash,
          stagingAfterRetain: afterHash,
          byteLength,
          ...identity,
        };
      } catch (error) {
        if (target !== null) await target.close().catch((): undefined => undefined);
        if (error instanceof PresentationRunSimulatedProcessCrashError) throw error;
        if (targetIdentity !== null) {
          await this.removeLeafWithExpectedIdentity(
            temporaryPath,
            targetIdentity,
            layout.retainedDirectory,
            directoryLease
          ).catch((): undefined => undefined);
        }
        throw error;
      } finally {
        if (source !== null) await source.close();
      }
    });
  }

  async promoteRetainedCandidate(prepared: PreparedRetainedCandidate): Promise<void> {
    assertPreparedRetainedCandidate(prepared);
    const runDirectory = this.ownedChild(this.roots.runRoot, prepared.runId);
    const temporaryPath = path.join(runDirectory, prepared.temporaryRelativePath);
    const finalPath = path.join(runDirectory, prepared.finalRelativePath);
    await this.withDirectoryLease(this.durableRunDirectoryChain(prepared.runId), async (directoryLease) => {
      const candidate = await openVerifiedCandidateLease(
        temporaryPath,
        prepared,
        {
          unsafe: 'Retained candidate temporary file is unsafe',
          changed: 'Retained candidate temporary file changed',
        },
        prepared
      );
      try {
        try {
          await lstat(finalPath, { bigint: true });
          throw new Error('Retained candidate already exists');
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        }
        await directoryLease.assertCurrent();
        await this.inject({ boundary: 'before-candidate-promotion-rename', runId: prepared.runId });
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(candidate);
        await rename(temporaryPath, finalPath);
        candidate.path = finalPath;
        candidate.messages = {
          unsafe: 'Retained candidate promotion found an unsafe final file',
          changed: 'Retained candidate promotion found mismatched bytes',
        };
        await this.inject({ boundary: 'after-candidate-promotion-rename', runId: prepared.runId });
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(candidate);
        await this.inject({ boundary: 'before-candidate-promotion-directory-fsync', runId: prepared.runId });
        await directoryLease.assertCurrent();
        await directoryLease.sync(path.dirname(finalPath));
        await this.inject({ boundary: 'after-candidate-promotion-directory-fsync', runId: prepared.runId });
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(candidate);
      } finally {
        await candidate.handle.close();
      }
    });
  }

  async verifyPreparedRetainedCandidate(prepared: PreparedRetainedCandidate): Promise<void> {
    await this.inspectPreparedRetainedCandidate(prepared);
  }

  private async inspectPreparedRetainedCandidate(prepared: PreparedRetainedCandidate): Promise<FileMetadata> {
    assertPreparedRetainedCandidate(prepared);
    const runDirectory = this.ownedChild(this.roots.runRoot, prepared.runId);
    const temporaryPath = path.join(runDirectory, prepared.temporaryRelativePath);
    return this.withDirectoryLease(this.durableRunDirectoryChain(prepared.runId), async () => {
      return verifyCandidatePath(
        temporaryPath,
        prepared,
        {
          unsafe: 'Retained candidate temporary file is unsafe',
          changed: 'Retained candidate temporary file changed',
        },
        prepared
      );
    });
  }

  async recoverRetainedCandidatePromotion(prepared: PreparedRetainedCandidate): Promise<void> {
    assertPreparedRetainedCandidate(prepared);
    const runDirectory = this.ownedChild(this.roots.runRoot, prepared.runId);
    const temporaryPath = path.join(runDirectory, prepared.temporaryRelativePath);
    const finalPath = path.join(runDirectory, prepared.finalRelativePath);
    const finalExists = await this.withDirectoryLease(
      this.durableRunDirectoryChain(prepared.runId),
      async (directoryLease) => {
        let candidate: VerifiedCandidateLease;
        try {
          candidate = await openVerifiedCandidateLease(
            finalPath,
            prepared,
            {
              unsafe: 'Retained candidate recovery found mismatched bytes',
              changed: 'Retained candidate recovery found mismatched bytes',
            },
            prepared
          );
        } catch (error) {
          if (hasCode(error, 'ENOENT')) return false;
          throw error;
        }
        try {
          try {
            await lstat(temporaryPath, { bigint: true });
            throw new Error('Retained candidate recovery found an unexpected temporary file');
          } catch (error) {
            if (!hasCode(error, 'ENOENT')) throw error;
          }
          await directoryLease.assertCurrent();
          await assertVerifiedCandidateLease(candidate);
          return true;
        } finally {
          await candidate.handle.close();
        }
      }
    );
    if (!finalExists) await this.promoteRetainedCandidate(prepared);
  }

  async removePreparedRetainedCandidate(prepared: PreparedRetainedCandidate): Promise<void> {
    assertPreparedRetainedCandidate(prepared);
    const runDirectory = this.ownedChild(this.roots.runRoot, prepared.runId);
    const temporaryPath = path.join(runDirectory, prepared.temporaryRelativePath);
    await this.withDirectoryLease(this.durableRunDirectoryChain(prepared.runId), async (directoryLease) => {
      let candidate: VerifiedCandidateLease;
      try {
        candidate = await openVerifiedCandidateLease(
          temporaryPath,
          prepared,
          {
            unsafe: 'Retained candidate temporary file is unsafe',
            changed: 'Retained candidate temporary file changed',
          },
          prepared
        );
      } catch (error) {
        if (hasCode(error, 'ENOENT')) {
          await directoryLease.assertCurrent();
          await assertPathAbsent(temporaryPath, 'Presentation cleanup target reappeared');
          await directoryLease.assertCurrent();
          return;
        }
        throw error;
      }
      try {
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(candidate);
        await rm(temporaryPath);
        const after = await candidate.handle.stat({ bigint: true });
        if (!sameFileIdentity(candidate.metadata, after)) throw new Error('Retained candidate temporary file changed');
        await directoryLease.assertCurrent();
        await assertPathAbsent(temporaryPath, 'Presentation cleanup target reappeared');
        await directoryLease.assertCurrent();
        await directoryLease.sync(path.dirname(temporaryPath));
        await directoryLease.assertCurrent();
        await assertPathAbsent(temporaryPath, 'Presentation cleanup target reappeared');
        await directoryLease.assertCurrent();
      } finally {
        await candidate.handle.close();
      }
    });
  }

  async withAuthorizedRetainedCandidate<T>(
    runId: string,
    candidate: PresentationRunRetainedCandidate | null,
    operation: (reader: PresentationRetainedCandidateReader) => Promise<T>
  ): Promise<T | null> {
    assertUuid(runId, 'run');
    if (candidate === null) return null;
    if (candidate.relativePath !== RETAINED_CANDIDATE_RELATIVE_PATH) {
      throw new Error('Authorized retained candidate is unavailable');
    }
    const candidatePath = path.join(this.ownedChild(this.roots.runRoot, runId), candidate.relativePath);
    return this.withDirectoryLease(this.durableRunDirectoryChain(runId), async (directoryLease) => {
      const file = await openVerifiedCandidateLease(candidatePath, candidate, {
        unsafe: 'Authorized retained candidate is unavailable',
        changed: 'Authorized retained candidate does not match its manifest',
      });
      try {
        const reader: PresentationRetainedCandidateReader = Object.freeze({
          byteLength: candidate.byteLength,
          readAt: async (position: number, length: number): Promise<Buffer> => {
            if (
              !Number.isSafeInteger(position) ||
              position < 0 ||
              !Number.isSafeInteger(length) ||
              length < 0 ||
              position > candidate.byteLength ||
              length > candidate.byteLength - position
            ) {
              throw new Error('Authorized retained candidate read is out of bounds');
            }
            const bytes = Buffer.alloc(length);
            let offset = 0;
            while (offset < length) {
              const { bytesRead } = await file.handle.read(bytes, offset, length - offset, position + offset);
              if (bytesRead === 0) throw new Error('Authorized retained candidate changed while reading');
              offset += bytesRead;
            }
            return bytes;
          },
        });
        const result = await operation(reader);
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(file);
        await directoryLease.assertCurrent();
        return result;
      } finally {
        await file.handle.close();
      }
    });
  }

  async removeRun(runId: string): Promise<void> {
    assertUuid(runId, 'run');
    await this.removeOwnedDirectoryTree(
      [this.userDataDir, this.roots.runRoot, this.ownedChild(this.roots.runRoot, runId)],
      this.ownedChild(this.roots.runRoot, runId),
      { boundary: 'before-run-cleanup', runId }
    );
    await this.removeOwnedDirectoryTree(
      [this.tempDir, this.roots.stagingRoot, this.ownedChild(this.roots.stagingRoot, runId)],
      this.ownedChild(this.roots.stagingRoot, runId)
    );
    await this.removeOwnedDirectoryTree(
      [this.tempDir, this.roots.inspectionRoot, this.ownedChild(this.roots.inspectionRoot, runId)],
      this.ownedChild(this.roots.inspectionRoot, runId)
    );
  }

  async removeGrant(grantId: string): Promise<void> {
    assertUuid(grantId, 'source grant');
    const directory = this.ownedChild(this.roots.grantRoot, grantId);
    await this.removeOwnedDirectoryTree([this.userDataDir, this.roots.grantRoot, directory], directory);
  }

  async removeDraft(draftId: string): Promise<void> {
    assertUuid(draftId, 'source draft');
    const directory = this.ownedChild(this.roots.draftRoot, draftId);
    await this.removeOwnedDirectoryTree([this.userDataDir, this.roots.draftRoot, directory], directory);
  }

  async removeOwner(ownerId: string): Promise<void> {
    assertUuid(ownerId, 'source owner');
    const directory = this.ownedChild(this.roots.ownerRoot, ownerId);
    await this.removeOwnedDirectoryTree([this.userDataDir, this.roots.ownerRoot, directory], directory);
  }

  async listEntityIds(kind: 'run' | 'grant' | 'draft' | 'owner'): Promise<string[]> {
    await this.initialize();
    const root = this.entityRoot(kind);
    return this.withDirectoryLease([this.userDataDir, root], async () => {
      const entries = await readdir(root, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory() && UUID_RE.test(entry.name)).map((entry) => entry.name);
    });
  }

  async listTombstoneIds(kind: 'run' | 'grant' | 'draft'): Promise<string[]> {
    await this.initialize();
    const root = this.entityRoot(`${kind}-tombstone`);
    return this.withDirectoryLease([this.userDataDir, root], async () => {
      const entries = await readdir(root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && UUID_RE.test(entry.name.slice(0, -5)))
        .map((entry) => entry.name.slice(0, -5));
    });
  }

  async removeTombstone(kind: 'run' | 'grant' | 'draft', entityId: string): Promise<void> {
    const entityKind = `${kind}-tombstone` as PresentationRunEntityKind;
    const tombstonePath = this.getEntityManifestPath(entityKind, entityId);
    const root = this.entityRoot(entityKind);
    await this.withDirectoryLease([this.userDataDir, root], async (directoryLease) => {
      let opened: { handle: OpenHandle; metadata: FileMetadata };
      try {
        opened = await openOwnedRegularFile(tombstonePath, 'Presentation tombstone file is unsafe');
      } catch (error) {
        if (hasCode(error, 'ENOENT')) {
          await directoryLease.assertCurrent();
          await assertPathAbsent(tombstonePath, 'Presentation cleanup target reappeared');
          await directoryLease.assertCurrent();
          return;
        }
        throw error;
      }
      await opened.handle.close();
      await this.removeLeafWithExpectedIdentity(tombstonePath, opened.metadata, root, directoryLease);
    });
  }

  async removeUnreferencedCandidateTemps(runId: string, keepRelativePath?: string): Promise<void> {
    assertUuid(runId, 'run');
    const retainedDirectory = path.join(this.ownedChild(this.roots.runRoot, runId), 'retained');
    try {
      const opened = await openOwnedDirectory(retainedDirectory);
      await opened.handle.close();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    await this.withDirectoryLease(this.durableRunDirectoryChain(runId), async (directoryLease) => {
      const entries = await readdir(retainedDirectory);
      const removable = entries.filter(
        (entry) => /^\.candidate-[0-9a-f-]+\.tmp$/i.test(entry) && `retained/${entry}` !== keepRelativePath
      );
      for (const entry of removable) {
        const temporaryPath = path.join(retainedDirectory, entry);
        const opened = await openOwnedRegularFile(temporaryPath, 'Retained candidate temporary file is unsafe');
        await opened.handle.close();
        await this.removeLeafWithExpectedIdentity(temporaryPath, opened.metadata, retainedDirectory, directoryLease);
      }
    });
  }

  async quarantineEntity(kind: PresentationRunEntityKind, entityId: string): Promise<string> {
    const baseKind = kind.replace('-tombstone', '') as 'run' | 'grant' | 'draft' | 'owner';
    assertUuid(
      entityId,
      baseKind === 'grant'
        ? 'source grant'
        : baseKind === 'draft'
          ? 'source draft'
          : baseKind === 'owner'
            ? 'source owner'
            : 'run'
    );
    await this.initialize();
    const source = kind.endsWith('-tombstone')
      ? this.getEntityManifestPath(kind, entityId)
      : this.ownedChild(this.entityRoot(kind), entityId);
    const destination = path.join(this.roots.quarantineRoot, `${kind}-${entityId}-${this.randomUUID()}`);
    const sourceRoot = this.entityRoot(kind);
    const sourceIsDirectory = !kind.endsWith('-tombstone');
    const directoryChain = [this.userDataDir, sourceRoot, this.roots.quarantineRoot];
    if (sourceIsDirectory) directoryChain.push(source);
    const directoryLease = await OwnedDirectoryLease.acquire(directoryChain, this.syncOwnedDirectory.bind(this));
    let sourceHandle: OpenHandle | null = null;
    try {
      const opened = sourceIsDirectory
        ? await openOwnedDirectory(source)
        : await openOwnedRegularFile(source, 'Presentation quarantine source is unsafe');
      sourceHandle = opened.handle;
      const assertDestination = async (): Promise<void> => {
        const current = await opened.handle.stat({ bigint: true });
        if (!sameFileIdentity(opened.metadata, current)) {
          throw new Error('Presentation quarantine destination changed');
        }
        try {
          if (sourceIsDirectory) {
            await assertPathNamesDirectory(destination, current);
          } else {
            await assertPathNamesFile(destination, current, 'Presentation quarantine destination changed');
          }
        } catch (error) {
          throw new Error('Presentation quarantine destination changed', { cause: error });
        }
      };
      await directoryLease.assertCurrent();
      await rename(source, destination);
      if (sourceIsDirectory) {
        await directoryLease.assertParentsCurrent(source);
      } else {
        await directoryLease.assertCurrent();
      }
      await assertDestination();
      await directoryLease.sync(sourceRoot);
      await directoryLease.sync(this.roots.quarantineRoot);
      if (sourceIsDirectory) {
        await directoryLease.assertParentsCurrent(source);
      } else {
        await directoryLease.assertCurrent();
      }
      await assertDestination();
      if (sourceIsDirectory) {
        await directoryLease.assertParentsCurrent(source);
      } else {
        await directoryLease.assertCurrent();
      }
    } finally {
      if (sourceHandle !== null) await sourceHandle.close();
      await directoryLease.close();
    }
    return destination;
  }

  async syncOwnedDirectory(directory: string): Promise<void> {
    const { handle, metadata: before } = await openOwnedDirectory(directory);
    try {
      await this.syncDirectory(directory);
      const after = await handle.stat({ bigint: true });
      assertOwnedDirectory(after);
      if (!sameFileIdentity(before, after)) {
        throw new Error('Presentation storage directory changed while syncing');
      }
      await assertPathNamesDirectory(directory, after);
    } finally {
      await handle.close();
    }
  }

  private preparedRunAssetDirectoryChain(runId: string): string[] {
    return [...this.stagingCandidateDirectoryChain(runId), ...this.durableRunDirectoryChain(runId)];
  }

  private preparedRunAssetEntries(
    prepared: PreparedPresentationRunAssets,
    useFinalPath: boolean
  ): PreparedRunAssetEntry[] {
    const stagingRunDirectory = this.ownedChild(this.roots.stagingRoot, prepared.runId);
    const runDirectory = this.ownedChild(this.roots.runRoot, prepared.runId);
    const entry = (
      asset: PreparedPresentationRunAsset,
      baseDirectory: string,
      parentDirectory: string
    ): PreparedRunAssetEntry => ({
      asset,
      filePath: path.join(baseDirectory, useFinalPath ? asset.finalRelativePath : asset.temporaryRelativePath),
      finalPath: path.join(baseDirectory, asset.finalRelativePath),
      parentDirectory,
    });
    return [
      entry(prepared.candidate, stagingRunDirectory, path.join(stagingRunDirectory, 'agent')),
      entry(prepared.grounding, stagingRunDirectory, path.join(stagingRunDirectory, 'agent')),
      entry(prepared.preparationFile, runDirectory, runDirectory),
    ];
  }

  private async assertPreparedRunDirectoryModes(runId: string, directoryLease: OwnedDirectoryLease): Promise<void> {
    const stagingRunDirectory = this.ownedChild(this.roots.stagingRoot, runId);
    const runDirectory = this.ownedChild(this.roots.runRoot, runId);
    for (const directory of [stagingRunDirectory, path.join(stagingRunDirectory, 'agent'), runDirectory]) {
      await directoryLease.assertMode(
        directory,
        PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE,
        'Presentation run directory must be private'
      );
    }
  }

  private async recoverPreparedRunAsset(
    entry: PreparedRunAssetEntry,
    directoryLease: OwnedDirectoryLease
  ): Promise<void> {
    let finalAsset: VerifiedCandidateLease | null = null;
    try {
      finalAsset = await openVerifiedCandidateLease(
        entry.finalPath,
        entry.asset,
        {
          unsafe: 'Prepared presentation run recovery found an unsafe final asset',
          changed: 'Prepared presentation run recovery found mismatched final bytes',
        },
        entry.asset,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    if (finalAsset !== null) {
      try {
        await assertPathAbsent(
          entry.filePath,
          'Prepared presentation run recovery found an unexpected temporary asset'
        );
        await directoryLease.assertCurrent();
        await assertVerifiedCandidateLease(finalAsset);
        await directoryLease.sync(entry.parentDirectory);
        await assertVerifiedCandidateLease(finalAsset);
        return;
      } finally {
        await finalAsset.handle.close();
      }
    }

    const temporary = await openVerifiedCandidateLease(
      entry.filePath,
      entry.asset,
      {
        unsafe: 'Prepared presentation run temporary asset is unsafe',
        changed: 'Prepared presentation run temporary asset changed',
      },
      entry.asset,
      PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
    );
    try {
      await assertPathAbsent(entry.finalPath, 'Prepared presentation run final asset already exists');
      await directoryLease.assertCurrent();
      await assertVerifiedCandidateLease(temporary);
      await rename(entry.filePath, entry.finalPath);
      temporary.path = entry.finalPath;
      temporary.messages = {
        unsafe: 'Prepared presentation run promotion found an unsafe final asset',
        changed: 'Prepared presentation run promotion found mismatched final bytes',
      };
      await directoryLease.assertCurrent();
      await assertVerifiedCandidateLease(temporary);
      await directoryLease.sync(entry.parentDirectory);
      await assertVerifiedCandidateLease(temporary);
    } finally {
      await temporary.handle.close();
    }
  }

  private async writePreparedRunBytes(
    filePath: string,
    bytes: Buffer,
    directoryLease: OwnedDirectoryLease,
    cleanupEntries: { filePath: string; parentDirectory: string; metadata: FileMetadata }[],
    parentDirectory: string
  ): Promise<FileMetadata> {
    let target: OpenHandle | null = null;
    try {
      await directoryLease.assertCurrent();
      target = await open(
        filePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
      let metadata = await target.stat({ bigint: true });
      assertOwnedRegularFile(metadata, 'Presentation run temporary asset is unsafe');
      if ((metadata.mode & PERMISSION_MODE_MASK) !== BigInt(PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE)) {
        await target.chmod(PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE);
        const afterChmod = await target.stat({ bigint: true });
        if (!sameFileIdentity(metadata, afterChmod)) throw new Error('Presentation run temporary asset changed');
        metadata = afterChmod;
      }
      assertOwnedRegularFileMode(
        metadata,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE,
        'Presentation run temporary asset is unsafe'
      );
      await assertPathNamesFile(filePath, metadata, 'Presentation run temporary asset is unsafe');
      cleanupEntries.push({ filePath, parentDirectory, metadata });
      await target.writeFile(bytes);
      await target.sync();
      const afterWrite = await target.stat({ bigint: true });
      assertOwnedRegularFileMode(
        afterWrite,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE,
        'Presentation run temporary asset is unsafe'
      );
      if (!sameFileIdentity(metadata, afterWrite) || afterWrite.size !== BigInt(bytes.byteLength)) {
        throw new Error('Presentation run temporary asset changed');
      }
      await assertPathNamesFile(filePath, afterWrite, 'Presentation run temporary asset changed');
      await directoryLease.assertCurrent();
      await target.close();
      target = null;
      return verifyCandidatePath(
        filePath,
        { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength },
        {
          unsafe: 'Presentation run temporary asset is unsafe',
          changed: 'Presentation run temporary asset changed',
        },
        fileIdentity(afterWrite),
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
    } finally {
      await target?.close().catch((): undefined => undefined);
    }
  }

  private entityRoot(kind: PresentationRunEntityKind): string {
    if (kind === 'run') return this.roots.runRoot;
    if (kind === 'grant') return this.roots.grantRoot;
    if (kind === 'draft') return this.roots.draftRoot;
    if (kind === 'owner') return this.roots.ownerRoot;
    if (kind === 'run-tombstone') return this.roots.runTombstoneRoot;
    if (kind === 'grant-tombstone') return this.roots.grantTombstoneRoot;
    return this.roots.draftTombstoneRoot;
  }

  private ownedChild(root: string, id: string): string {
    const child = path.join(root, id);
    if (path.dirname(child) !== root) throw new Error('Presentation path escaped its owned root');
    return child;
  }

  private durableRunDirectoryChain(runId: string): string[] {
    const runDirectory = this.ownedChild(this.roots.runRoot, runId);
    return [this.userDataDir, this.roots.runRoot, runDirectory, path.join(runDirectory, 'retained')];
  }

  private durableGrantDirectoryChain(grantId: string): string[] {
    const grantDirectory = this.ownedChild(this.roots.grantRoot, grantId);
    return [this.userDataDir, this.roots.grantRoot, grantDirectory];
  }

  private stagingCandidateDirectoryChain(runId: string): string[] {
    const runDirectory = this.ownedChild(this.roots.stagingRoot, runId);
    return [this.tempDir, this.roots.stagingRoot, runDirectory, path.join(runDirectory, 'agent')];
  }

  private parentDirectoryChain(directory: string): string[] {
    const resolved = path.resolve(directory);
    const base = [this.userDataDir, this.tempDir].find((candidate) => {
      const relative = path.relative(candidate, resolved);
      return (
        relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
      );
    });
    if (!base) throw new Error('Presentation directory escaped its configured storage roots');
    const parent = path.dirname(resolved);
    const relativeParent = path.relative(base, parent);
    const segments = relativeParent === '' ? [] : relativeParent.split(path.sep);
    const chain = [base];
    for (const segment of segments) chain.push(path.join(chain.at(-1)!, segment));
    return chain;
  }

  private async withDirectoryLease<T>(
    directories: readonly string[],
    operation: (lease: OwnedDirectoryLease) => Promise<T>
  ): Promise<T> {
    if (directories.length === 0) {
      const lease = await OwnedDirectoryLease.acquire([], this.syncOwnedDirectory.bind(this));
      try {
        return await operation(lease);
      } finally {
        await lease.close();
      }
    }
    const lease = await OwnedDirectoryLease.acquire(directories, this.syncOwnedDirectory.bind(this));
    try {
      const result = await operation(lease);
      await lease.assertCurrent();
      return result;
    } finally {
      await lease.close();
    }
  }

  private async removeLeafWithExpectedIdentity(
    filePath: string,
    expected: FileMetadata,
    parentDirectory: string,
    directoryLease: OwnedDirectoryLease
  ): Promise<void> {
    await directoryLease.assertCurrent();
    let opened: { handle: OpenHandle; metadata: FileMetadata };
    try {
      opened = await openOwnedRegularFile(filePath, 'Presentation storage file changed before cleanup');
    } catch (error) {
      if (hasCode(error, 'ENOENT')) {
        await directoryLease.assertCurrent();
        await assertPathAbsent(filePath, 'Presentation cleanup target reappeared');
        await directoryLease.assertCurrent();
        return;
      }
      throw error;
    }
    try {
      if (!sameFileIdentity(expected, opened.metadata)) {
        throw new Error('Presentation storage file changed before cleanup');
      }
      await directoryLease.assertCurrent();
      await assertPathNamesFile(filePath, opened.metadata, 'Presentation storage file changed before cleanup');
      await rm(filePath);
      const after = await opened.handle.stat({ bigint: true });
      if (!sameFileIdentity(opened.metadata, after)) {
        throw new Error('Presentation storage file changed before cleanup');
      }
      await directoryLease.assertCurrent();
      await assertPathAbsent(filePath, 'Presentation cleanup target reappeared');
      await directoryLease.assertCurrent();
      await directoryLease.sync(parentDirectory);
      await directoryLease.assertCurrent();
      await assertPathAbsent(filePath, 'Presentation cleanup target reappeared');
      await directoryLease.assertCurrent();
    } finally {
      await opened.handle.close();
    }
  }

  private async removeEmptyGrantDirectory(grantId: string): Promise<boolean> {
    const grantDirectory = this.ownedChild(this.roots.grantRoot, grantId);
    const parentLease = await OwnedDirectoryLease.acquire(
      [this.userDataDir, this.roots.grantRoot],
      this.syncOwnedDirectory.bind(this)
    );
    let grantLease: OwnedDirectoryLease | null = null;
    try {
      try {
        grantLease = await OwnedDirectoryLease.acquire([grantDirectory], this.syncOwnedDirectory.bind(this));
      } catch (error) {
        await parentLease.assertCurrent();
        if (!hasCode(error, 'ENOENT')) throw error;
        await assertPathAbsent(grantDirectory, 'Presentation cleanup target reappeared');
        await parentLease.assertCurrent();
        return true;
      }
      await parentLease.assertCurrent();
      await grantLease.assertCurrent();
      const entries = await readdir(grantDirectory);
      await grantLease.assertCurrent();
      if (entries.length > 0) return false;
      await parentLease.assertCurrent();
      await grantLease.assertCurrent();
      await rmdir(grantDirectory);
      await parentLease.assertCurrent();
      await assertPathAbsent(grantDirectory, 'Presentation cleanup target reappeared');
      await parentLease.assertCurrent();
      await parentLease.sync(this.roots.grantRoot);
      await parentLease.assertCurrent();
      await assertPathAbsent(grantDirectory, 'Presentation cleanup target reappeared');
      await parentLease.assertCurrent();
      return true;
    } finally {
      await grantLease?.close();
      await parentLease.close();
    }
  }

  private async removeOwnedDirectoryTree(
    directoryChain: readonly string[],
    targetDirectory: string,
    failurePoint?: PresentationRunFileFailurePoint
  ): Promise<void> {
    const parentLease = await OwnedDirectoryLease.acquire(
      directoryChain.slice(0, -1),
      this.syncOwnedDirectory.bind(this)
    );
    let targetLease: OwnedDirectoryLease | null = null;
    try {
      try {
        targetLease = await OwnedDirectoryLease.acquire([targetDirectory], this.syncOwnedDirectory.bind(this));
      } catch (error) {
        await parentLease.assertCurrent();
        if (!hasCode(error, 'ENOENT')) throw error;
        await assertPathAbsent(targetDirectory, 'Presentation cleanup target reappeared');
        await parentLease.assertCurrent();
        return;
      }
      if (failurePoint) await this.inject(failurePoint);
      await parentLease.assertCurrent();
      await targetLease.assertCurrent();
      await parentLease.assertCurrent();
      // Node has no openat/unlinkat API. Held no-follow directory handles and immediate
      // pre/post checks fail closed on persistent drift; OS sandboxing is still the boundary
      // for a hostile same-UID actor swapping and restoring names inside this single syscall.
      await rm(targetDirectory, { recursive: true });
      await parentLease.assertCurrent();
      await assertPathAbsent(targetDirectory, 'Presentation cleanup target reappeared');
      await parentLease.assertCurrent();
      await parentLease.sync(path.dirname(targetDirectory));
      await parentLease.assertCurrent();
      await assertPathAbsent(targetDirectory, 'Presentation cleanup target reappeared');
      await parentLease.assertCurrent();
    } finally {
      await targetLease?.close();
      await parentLease.close();
    }
  }

  private async ensureOwnedDirectory(directory: string): Promise<void> {
    const parentDirectory = path.dirname(directory);
    const parentLease = await OwnedDirectoryLease.acquire(
      this.parentDirectoryChain(directory),
      this.syncOwnedDirectory.bind(this)
    );
    let created = false;
    try {
      await parentLease.assertCurrent();
      try {
        await mkdir(directory, { mode: PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE });
        created = true;
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      await parentLease.assertCurrent();
      const { handle, metadata: before } = await openOwnedDirectory(directory);
      try {
        if ((before.mode & BigInt(0o777)) !== BigInt(PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE)) {
          await handle.chmod(PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE);
          await handle.sync();
        }
        const after = await handle.stat({ bigint: true });
        assertOwnedDirectory(after);
        if (
          !sameFileIdentity(before, after) ||
          (after.mode & BigInt(0o777)) !== BigInt(PRESENTATION_RUN_LIMITS.OWNED_DIRECTORY_MODE)
        ) {
          throw new Error('Presentation storage directory must be real and owned by the current user');
        }
        await assertPathNamesDirectory(directory, after);
        await parentLease.assertCurrent();
      } finally {
        await handle.close();
      }
      if (created) await parentLease.sync(parentDirectory);
    } finally {
      await parentLease.close();
    }
  }

  private async inject(point: PresentationRunFileFailurePoint): Promise<void> {
    await this.failureInjector?.(point);
  }
}
