/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { types as nodeTypes } from 'node:util';
import { syncDurableDirectory } from '../../service/durableDirectory';
import { STUDIO_PROJECT_SCHEMA_VERSION_V4, type StudioProjectV4 } from '@/common/types/project/creativeStudioTypes';
import {
  canonicalizeRecordRoot,
  readBoundedRegularBinaryFileWithIdentity,
  resolveConfinedRecordPath,
  resolveSafeRecordDirectory,
  type RecordIoFileSystem,
} from '../../service/recordIo';
import { createEmptyStudioProjectV4 } from '../../service/schema2/factories';
// The deletion-claim token and project transaction remain their existing sidecar protocols.
// A project-schema cutover must not silently version either independently persisted contract.
import {
  createStudioDeletionClaimCacheV3 as createStudioDeletionClaimCacheV4,
  StudioDeletionClaimErrorV3 as StudioDeletionClaimErrorV4,
  type StudioDeletionClaimCacheOptionsV3 as StudioDeletionClaimCacheOptionsV4,
  type StudioDeletionClaimCacheV3 as StudioDeletionClaimCacheV4,
  type StudioIssuedDeletionClaimV3 as StudioIssuedDeletionClaimV4,
  type StudioProjectDeletionObservationV3 as StudioProjectDeletionObservationV4,
  type StudioProjectDirectoryIdentityV3 as StudioProjectDirectoryIdentityV4,
  type StudioUnreadableProjectDeletionObservationV3 as StudioUnreadableProjectDeletionObservationV4,
} from '../../service/schema2/mutations/deletionClaimsV3';
import { validateStudioProjectV4 } from '../../service/schema2/validation';

const PROJECT_MANIFEST = 'project.json';
const PROJECT_BRIEF = 'brief.md';
const PROJECT_TRANSACTION = '.project-write-v3.json';
const PROJECT_ENVELOPE_SCHEMA_VERSION = 1 as const;
const PROJECT_TRANSACTION_SCHEMA_VERSION = 1 as const;
const PROJECT_DELETION_SCHEMA_VERSION = 1 as const;
/** Fixed schema-7 project-manifest persistence envelope. */
export const STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4 = 1_048_576;
const MAX_BRIEF_BYTES = 65_536;
const MAX_CONTROL_RECORD_BYTES = 16_384;
const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SAFE_TEMPORARY_ID = /^[A-Za-z0-9_-]{8,128}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROJECT_MANIFEST_KEYS = new Set([
  'schemaVersion',
  'revision',
  'authoringRevision',
  'id',
  'name',
  'rules',
  'forgeProjectId',
  'briefConversationId',
  'pieceOrder',
  'pieces',
  'boardOrder',
  'boards',
  'assemblyOrder',
  'assemblies',
  'bin',
  'spendPolicy',
  'spendAuthorizations',
  'undoHistory',
  'assets',
  'jobs',
  'createdAt',
  'updatedAt',
  'briefFile',
]);
const BRIEF_FILE_KEYS = new Set(['schemaVersion', 'sha256']);
const CREATE_INPUT_KEYS = new Set(['name', 'brief']);
const TRANSACTION_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'transactionId',
  'manifestTemporaryFile',
  'briefTemporaryFile',
  'previousManifestSha256',
  'previousBriefSha256',
  'nextManifestSha256',
  'nextBriefSha256',
]);
const DELETION_MARKER_KEYS = new Set([
  'schemaVersion',
  'catalogueId',
  'classification',
  'directoryIdentity',
  'manifestFingerprint',
  'expectedRevision',
  'quarantineName',
]);
const DIRECTORY_IDENTITY_KEYS = new Set(['dev', 'ino']);

type PlainRecord = Record<string, unknown>;

export type StudioPilotProjectSummaryV4 = {
  id: string;
  name: string;
  revision: number;
  authoringRevision: number;
  pieceCount: number;
  updatedAt: string;
};

export type StudioPilotUnreadableProjectV4 = {
  catalogueId: string;
  classification: 'unsupported' | 'quarantined';
  deletionClaim: string;
  deletionClaimExpiresAt: string;
};

export type StudioPilotProjectListEntryV4 =
  | { classification: 'healthy'; summary: StudioPilotProjectSummaryV4 }
  | StudioPilotUnreadableProjectV4;

export type StudioPilotProjectInventoryV4 = {
  healthyProjectIds: string[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

export type StudioPilotProjectLoadResultV4 =
  | { status: 'healthy'; project: StudioProjectV4 }
  | { status: 'unsupported'; catalogueId: string }
  | { status: 'quarantined'; catalogueId: string }
  | { status: 'not_found'; catalogueId: string };

export type StudioPilotProjectCommitKindV4 = 'authoring' | 'runtime';

export type StudioPilotProjectCommitFactsV4 = Readonly<{
  projectId: string;
  operation: 'created' | 'updated' | 'deleted';
  previousRevision: number | null;
  committedRevision: number | null;
  committedAt: string;
}>;

export type StudioPilotProjectUpdateOptionsV4 = {
  expectedRevision?: number;
  kind: StudioPilotProjectCommitKindV4;
  authorizeBeforeReplace?: () => void | Promise<void>;
};

export type StudioPilotProjectAuthoritySnapshotV4 = {
  project: StudioProjectV4;
  projectDir: string;
  assertCurrent(): Promise<void>;
  commit(
    update: (project: StudioProjectV4) => StudioProjectV4,
    options: StudioPilotProjectUpdateOptionsV4
  ): Promise<StudioProjectV4>;
  delete(expectedRevision: number): Promise<boolean>;
};

export type StudioPilotStorageStepV4 =
  | 'create:brief_durable'
  | 'create:manifest_durable'
  | 'create:stage_durable'
  | 'create:published'
  | 'create:root_durable'
  | 'update:candidates_durable'
  | 'update:journal_durable'
  | 'update:brief_published'
  | 'update:manifest_published'
  | 'update:directory_durable'
  | 'update:complete'
  | 'delete:marker_durable'
  | 'delete:quarantined'
  | 'delete:root_durable'
  | 'delete:tree_removed'
  | 'delete:complete';

export type CreativeStudioPilotStoreOptionsV4 = {
  rootDir: string;
  fs?: RecordIoFileSystem;
  /** Test-only narrowing of the fixed production cap; values above the cap are refused. */
  maxManifestBytes?: number;
  now?: () => string;
  createProjectId?: () => string;
  createTemporaryId?: () => string;
  deletionClaims?: StudioDeletionClaimCacheV4;
  deletionClaimOptions?: StudioDeletionClaimCacheOptionsV4;
  onStorageStep?: (step: StudioPilotStorageStepV4, projectId: string) => void | Promise<void>;
};

export type CreativeStudioPilotStoreV4 = {
  inspectProjectsV4(): Promise<StudioPilotProjectInventoryV4>;
  listProjectsV4(): Promise<StudioPilotProjectListEntryV4[]>;
  createProjectV4(input: { name: string; brief: string }): Promise<StudioProjectV4>;
  getProjectV4(projectId: string): Promise<StudioPilotProjectLoadResultV4>;
  loadProjectV4(projectId: string): Promise<StudioProjectV4>;
  getVerifiedProjectDirectoryV4(projectId: string): Promise<string | null>;
  summarizeProjectV4(projectId: string): Promise<StudioPilotProjectSummaryV4>;
  updateProjectV4(
    projectId: string,
    update: (project: StudioProjectV4) => StudioProjectV4,
    options: StudioPilotProjectUpdateOptionsV4
  ): Promise<StudioProjectV4>;
  withProjectAuthorityV4<T>(
    projectId: string,
    operation: (snapshot: StudioPilotProjectAuthoritySnapshotV4) => Promise<T>
  ): Promise<T>;
  issueDeletionClaimV4(projectId: string): Promise<StudioIssuedDeletionClaimV4>;
  deleteProjectV4(
    projectId: string,
    authority: { expectedRevision: number } | { deletionClaim: string }
  ): Promise<boolean>;
  watchProjectsV4(listener: (facts: StudioPilotProjectCommitFactsV4) => void): () => void;
  close(): void;
};

export type CreativeStudioPilotStoreErrorCodeV4 =
  | 'invalid_payload'
  | 'not_found'
  | 'stale_project'
  | 'unsupported'
  | 'quarantined'
  | 'already_exists'
  | 'storage_error';

export class CreativeStudioPilotStoreErrorV4 extends Error {
  readonly code: CreativeStudioPilotStoreErrorCodeV4;

  constructor(code: CreativeStudioPilotStoreErrorCodeV4) {
    super(code);
    this.name = 'CreativeStudioPilotStoreErrorV4';
    this.code = code;
  }
}

type ProjectEnvelopeV4 = Omit<StudioProjectV4, 'brief'> & {
  briefFile: { schemaVersion: typeof PROJECT_ENVELOPE_SCHEMA_VERSION; sha256: string };
};

type ProjectWriteTransactionV4 = {
  schemaVersion: typeof PROJECT_TRANSACTION_SCHEMA_VERSION;
  projectId: string;
  transactionId: string;
  manifestTemporaryFile: string;
  briefTemporaryFile: string;
  previousManifestSha256: string;
  previousBriefSha256: string;
  nextManifestSha256: string;
  nextBriefSha256: string;
};

type ProjectDeletionMarkerV4 = {
  schemaVersion: typeof PROJECT_DELETION_SCHEMA_VERSION;
  catalogueId: string;
  classification: 'healthy' | 'unsupported' | 'quarantined';
  directoryIdentity: StudioProjectDirectoryIdentityV4;
  manifestFingerprint: string;
  expectedRevision: number | null;
  quarantineName: string;
};

type RootState = {
  canonicalRoot: string;
  projectsRoot: string;
};

type HealthyInspection = {
  status: 'healthy';
  catalogueId: string;
  project: StudioProjectV4;
  projectDir: string;
  directoryIdentity: StudioProjectDirectoryIdentityV4;
  manifestFingerprint: string;
  manifestSha256: string;
  briefSha256: string;
};

type UnreadableInspection = {
  status: 'unsupported' | 'quarantined';
  observedSchemaVersion: number | null;
  catalogueId: string;
  projectDir: string;
  directoryIdentity: StudioProjectDirectoryIdentityV4;
  manifestFingerprint: string;
};

type ProjectInspection = HealthyInspection | UnreadableInspection | { status: 'not_found'; catalogueId: string };

type NodeError = { code?: unknown };

const isNodeError = (error: unknown): error is NodeError => typeof error === 'object' && error !== null;
const hasErrorCode = (error: unknown, code: string): boolean => isNodeError(error) && error.code === code;
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sameIdentity = (left: StudioProjectDirectoryIdentityV4, right: StudioProjectDirectoryIdentityV4): boolean =>
  left.dev === right.dev && left.ino === right.ino;
const isSafePositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;
const isPlainRecord = (value: unknown): value is PlainRecord =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !nodeTypes.isProxy(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasExactDataKeys = (value: PlainRecord, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size) return false;
  return ownKeys.every((key) => {
    if (typeof key !== 'string' || !keys.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
};

const clone = <T>(value: T): T => structuredClone(value);

const canonicalJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const toSummary = (project: StudioProjectV4): StudioPilotProjectSummaryV4 => ({
  id: project.id,
  name: project.name,
  revision: project.revision,
  authoringRevision: project.authoringRevision,
  pieceCount: project.pieceOrder.length,
  updatedAt: project.updatedAt,
});

const parseCanonicalTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  CANONICAL_TIMESTAMP.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

const snapshotCreateInput = (input: unknown): { name: string; brief: string } | null => {
  if (!isPlainRecord(input) || !hasExactDataKeys(input, CREATE_INPUT_KEYS)) return null;
  return typeof input.name === 'string' && typeof input.brief === 'string'
    ? { name: input.name, brief: input.brief }
    : null;
};

const envelopeFor = (project: StudioProjectV4): ProjectEnvelopeV4 => {
  const { brief, ...withoutBrief } = project;
  return {
    ...withoutBrief,
    briefFile: { schemaVersion: PROJECT_ENVELOPE_SCHEMA_VERSION, sha256: sha256(brief) },
  };
};

const serializeProject = (project: StudioProjectV4): { manifestBytes: string; briefBytes: string } => ({
  manifestBytes: canonicalJson(envelopeFor(project)),
  briefBytes: project.brief,
});

const parseProjectEnvelopeCandidate = (manifestBytes: string, briefBytes: string): PlainRecord | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed) || !hasExactDataKeys(parsed, PROJECT_MANIFEST_KEYS)) return null;
  const briefFile = parsed.briefFile;
  if (
    !isPlainRecord(briefFile) ||
    !hasExactDataKeys(briefFile, BRIEF_FILE_KEYS) ||
    briefFile.schemaVersion !== PROJECT_ENVELOPE_SCHEMA_VERSION ||
    typeof briefFile.sha256 !== 'string' ||
    !LOWERCASE_SHA256.test(briefFile.sha256) ||
    briefFile.sha256 !== sha256(briefBytes)
  ) {
    return null;
  }
  const { briefFile: ignoredBriefFile, ...withoutBrief } = parsed;
  void ignoredBriefFile;
  return { ...withoutBrief, brief: briefBytes };
};

const parseProjectEnvelope = (manifestBytes: string, briefBytes: string): StudioProjectV4 | null => {
  const project = parseProjectEnvelopeCandidate(manifestBytes, briefBytes);
  return validateStudioProjectV4(project) ? project : null;
};

const parseObservedSchemaVersion = (manifestBytes: string): number | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed) || !Object.hasOwn(parsed, 'schemaVersion')) return null;
  return Number.isSafeInteger(parsed.schemaVersion) ? (parsed.schemaVersion as number) : null;
};

const parseTransaction = (bytes: string): ProjectWriteTransactionV4 | null => {
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || !hasExactDataKeys(value, TRANSACTION_KEYS)) return null;
  if (
    value.schemaVersion !== PROJECT_TRANSACTION_SCHEMA_VERSION ||
    typeof value.projectId !== 'string' ||
    !SAFE_ID.test(value.projectId) ||
    typeof value.transactionId !== 'string' ||
    !SAFE_TEMPORARY_ID.test(value.transactionId) ||
    value.manifestTemporaryFile !== `.project-${value.transactionId}.tmp` ||
    value.briefTemporaryFile !== `.brief-${value.transactionId}.tmp`
  ) {
    return null;
  }
  for (const key of [
    'previousManifestSha256',
    'previousBriefSha256',
    'nextManifestSha256',
    'nextBriefSha256',
  ] as const) {
    if (typeof value[key] !== 'string' || !LOWERCASE_SHA256.test(value[key])) return null;
  }
  return value as ProjectWriteTransactionV4;
};

const parseDirectoryIdentity = (value: unknown): StudioProjectDirectoryIdentityV4 | null => {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, DIRECTORY_IDENTITY_KEYS)) return null;
  if (
    typeof value.dev !== 'string' ||
    !/^(?:0|[1-9][0-9]*)$/.test(value.dev) ||
    typeof value.ino !== 'string' ||
    !/^(?:0|[1-9][0-9]*)$/.test(value.ino)
  ) {
    return null;
  }
  return { dev: value.dev, ino: value.ino };
};

const parseDeletionMarker = (bytes: string): ProjectDeletionMarkerV4 | null => {
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || !hasExactDataKeys(value, DELETION_MARKER_KEYS)) return null;
  const directoryIdentity = parseDirectoryIdentity(value.directoryIdentity);
  if (
    value.schemaVersion !== PROJECT_DELETION_SCHEMA_VERSION ||
    typeof value.catalogueId !== 'string' ||
    !SAFE_ID.test(value.catalogueId) ||
    (value.classification !== 'healthy' &&
      value.classification !== 'unsupported' &&
      value.classification !== 'quarantined') ||
    directoryIdentity === null ||
    typeof value.manifestFingerprint !== 'string' ||
    !LOWERCASE_SHA256.test(value.manifestFingerprint) ||
    (value.expectedRevision !== null && !isSafePositiveInteger(value.expectedRevision)) ||
    typeof value.quarantineName !== 'string' ||
    !/^\.deleting-[A-Za-z0-9_-]{8,128}$/.test(value.quarantineName) ||
    (value.classification === 'healthy') !== (value.expectedRevision !== null)
  ) {
    return null;
  }
  return { ...(value as Omit<ProjectDeletionMarkerV4, 'directoryIdentity'>), directoryIdentity };
};

const syncDirectory = async (fs: RecordIoFileSystem, directory: string): Promise<void> => {
  await syncDurableDirectory(fs, directory);
};

const writeExclusiveDurable = async (fs: RecordIoFileSystem, file: string, bytes: string): Promise<void> => {
  const handle = await fs.open(file, 'wx');
  try {
    await handle.writeFile(bytes, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const publishExclusiveControlRecord = async (
  fs: RecordIoFileSystem,
  directory: string,
  file: string,
  temporaryFile: string,
  bytes: string
): Promise<void> => {
  await writeExclusiveDurable(fs, temporaryFile, bytes);
  try {
    await fs.link(temporaryFile, file);
    await syncDirectory(fs, directory);
  } finally {
    await removeRegularIfPresent(fs, temporaryFile).catch((): undefined => undefined);
  }
};

const lstatDirectoryIdentity = async (
  fs: RecordIoFileSystem,
  directory: string
): Promise<StudioProjectDirectoryIdentityV4> => {
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
    throw new CreativeStudioPilotStoreErrorV4('storage_error');
  }
  return { dev: String(stats.dev), ino: String(stats.ino) };
};

const pathExists = async (fs: RecordIoFileSystem, target: string): Promise<boolean> => {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
};

const removeRegularIfPresent = async (fs: RecordIoFileSystem, file: string): Promise<void> => {
  try {
    const stats = await fs.lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new CreativeStudioPilotStoreErrorV4('storage_error');
    await fs.rm(file);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
};

const readBoundedBytes = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  file: string,
  maximumBytes: number
): Promise<Uint8Array | null> =>
  (
    await readBoundedRegularBinaryFileWithIdentity({
      fs,
      canonicalRoot,
      file,
      maxBytes: maximumBytes,
    })
  )?.bytes ?? null;

const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

const readDigest = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  file: string,
  maximumBytes: number
): Promise<string | null> => {
  const bytes = await readBoundedBytes(fs, canonicalRoot, file, maximumBytes);
  return bytes === null ? null : sha256(bytes);
};

const manifestFingerprint = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  manifestFile: string
): Promise<string> => {
  try {
    const bytes = await readBoundedBytes(fs, canonicalRoot, manifestFile, STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4);
    return bytes === null ? sha256('missing-project-manifest-v3') : sha256(bytes);
  } catch {
    try {
      const stats = await fs.lstat(manifestFile);
      return sha256(
        canonicalJson({
          kind: 'unreadable-project-manifest-v3',
          dev: String(stats.dev),
          ino: String(stats.ino),
          size: String(stats.size),
          mtimeMs: String(stats.mtimeMs),
          ctimeMs: String(stats.ctimeMs),
        })
      );
    } catch {
      return sha256('missing-project-manifest-v3');
    }
  }
};

const normalizeError = (error: unknown): never => {
  if (error instanceof CreativeStudioPilotStoreErrorV4 || error instanceof StudioDeletionClaimErrorV4) throw error;
  throw new CreativeStudioPilotStoreErrorV4('storage_error');
};

const observationFor = (
  inspection: Exclude<ProjectInspection, { status: 'not_found' }>
): StudioProjectDeletionObservationV4 => ({
  catalogueId: inspection.catalogueId,
  classification: inspection.status,
  directoryIdentity: inspection.directoryIdentity,
  manifestFingerprint: inspection.manifestFingerprint,
});

const sameObservation = (
  marker: ProjectDeletionMarkerV4,
  inspection: Exclude<ProjectInspection, { status: 'not_found' }>
): boolean => {
  if (
    marker.catalogueId !== inspection.catalogueId ||
    !sameIdentity(marker.directoryIdentity, inspection.directoryIdentity) ||
    marker.manifestFingerprint !== inspection.manifestFingerprint
  ) {
    return false;
  }
  if (marker.classification === inspection.status) {
    return inspection.status !== 'healthy' || marker.expectedRevision === inspection.project.revision;
  }
  // The schema-1 marker authorized exact bytes before the clean project-schema cutover. Schema 7
  // must finish that durable deletion when the same schema-6 directory is merely reclassified,
  // while the inode and manifest digest above still prevent applying it to replacement content.
  return (
    inspection.status === 'unsupported' &&
    inspection.observedSchemaVersion === 6 &&
    (marker.classification === 'healthy' || marker.classification === 'quarantined')
  );
};

export const createCreativeStudioPilotStoreV4 = (
  options: CreativeStudioPilotStoreOptionsV4
): CreativeStudioPilotStoreV4 => {
  if (
    options.maxManifestBytes !== undefined &&
    (!Number.isSafeInteger(options.maxManifestBytes) ||
      options.maxManifestBytes < 1 ||
      options.maxManifestBytes > STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4)
  ) {
    throw new TypeError('Invalid Creative Studio manifest byte limit');
  }
  const fs = options.fs ?? nodeFs;
  const manifestByteLimit = options.maxManifestBytes ?? STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4;
  const readNow = options.now ?? (() => new Date().toISOString());
  const mintProjectId = options.createProjectId ?? (() => `project_${randomBytes(18).toString('base64url')}`);
  const mintTemporaryId = options.createTemporaryId ?? (() => randomBytes(12).toString('base64url'));
  const deletionClaims = options.deletionClaims ?? createStudioDeletionClaimCacheV4(options.deletionClaimOptions ?? {});
  const listeners = new Set<(facts: StudioPilotProjectCommitFactsV4) => void>();
  const queues = new Map<string, Promise<void>>();
  let closed = false;
  let initialization: Promise<RootState> | null = null;

  const now = (): string => {
    const value = readNow();
    if (!parseCanonicalTimestamp(value)) throw new CreativeStudioPilotStoreErrorV4('storage_error');
    return value;
  };

  const temporaryId = (): string => {
    const value = mintTemporaryId();
    if (typeof value !== 'string' || !SAFE_TEMPORARY_ID.test(value)) {
      throw new CreativeStudioPilotStoreErrorV4('storage_error');
    }
    return value;
  };

  const storageStep = async (step: StudioPilotStorageStepV4, projectId: string): Promise<void> => {
    await options.onStorageStep?.(step, projectId);
  };

  const emit = (facts: StudioPilotProjectCommitFactsV4): void => {
    const frozen = Object.freeze({ ...facts });
    for (const listener of listeners) {
      try {
        listener(frozen);
      } catch {
        // A renderer observer cannot roll back or poison an already durable Main commit.
      }
    }
  };

  const enqueue = async <T>(
    projectId: string,
    operation: () => Promise<T>,
    preserveOperationError = false
  ): Promise<T> => {
    const previous = queues.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch((): undefined => undefined).then(() => current);
    queues.set(projectId, tail);
    await previous.catch((): undefined => undefined);
    try {
      try {
        return await operation();
      } catch (error) {
        if (preserveOperationError) throw error;
        return normalizeError(error);
      }
    } finally {
      release();
      if (queues.get(projectId) === tail) queues.delete(projectId);
    }
  };

  const projectDirectory = (root: RootState, projectId: string): string =>
    resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, projectId);

  const resolveExistingProjectDirectory = async (root: RootState, projectId: string): Promise<string | null> =>
    resolveSafeRecordDirectory({
      fs,
      canonicalRoot: root.canonicalRoot,
      parent: root.projectsRoot,
      name: projectId,
      createIfMissing: false,
    });

  const readProjectPair = async (
    root: RootState,
    projectDir: string
  ): Promise<{ manifestBytes: string; briefBytes: string; manifestSha256: string; briefSha256: string } | null> => {
    const manifest = await readBoundedBytes(
      fs,
      root.canonicalRoot,
      path.join(projectDir, PROJECT_MANIFEST),
      manifestByteLimit
    );
    const brief = await readBoundedBytes(fs, root.canonicalRoot, path.join(projectDir, PROJECT_BRIEF), MAX_BRIEF_BYTES);
    if (manifest === null || brief === null) return null;
    return {
      manifestBytes: decodeUtf8(manifest),
      briefBytes: decodeUtf8(brief),
      manifestSha256: sha256(manifest),
      briefSha256: sha256(brief),
    };
  };

  const publishTransactionFile = async (
    root: RootState,
    projectDir: string,
    temporaryFile: string,
    liveFile: string,
    previousDigest: string,
    nextDigest: string,
    maximumBytes: number
  ): Promise<void> => {
    const temporaryPath = resolveConfinedRecordPath(root.canonicalRoot, projectDir, temporaryFile);
    const livePath = resolveConfinedRecordPath(root.canonicalRoot, projectDir, liveFile);
    const liveDigest = await readDigest(fs, root.canonicalRoot, livePath, maximumBytes);
    if (liveDigest === nextDigest) {
      await removeRegularIfPresent(fs, temporaryPath);
      return;
    }
    if (liveDigest !== previousDigest) throw new CreativeStudioPilotStoreErrorV4('quarantined');
    const temporaryDigest = await readDigest(fs, root.canonicalRoot, temporaryPath, maximumBytes);
    if (temporaryDigest !== nextDigest) throw new CreativeStudioPilotStoreErrorV4('quarantined');
    await fs.rename(temporaryPath, livePath);
  };

  const assertTransactionFilePublishable = async (
    root: RootState,
    projectDir: string,
    temporaryFile: string,
    liveFile: string,
    previousDigest: string,
    nextDigest: string,
    maximumBytes: number
  ): Promise<void> => {
    const temporaryPath = resolveConfinedRecordPath(root.canonicalRoot, projectDir, temporaryFile);
    const livePath = resolveConfinedRecordPath(root.canonicalRoot, projectDir, liveFile);
    const liveDigest = await readDigest(fs, root.canonicalRoot, livePath, maximumBytes);
    if (liveDigest === nextDigest) return;
    if (liveDigest !== previousDigest) throw new CreativeStudioPilotStoreErrorV4('quarantined');
    const temporaryDigest = await readDigest(fs, root.canonicalRoot, temporaryPath, maximumBytes);
    if (temporaryDigest !== nextDigest) throw new CreativeStudioPilotStoreErrorV4('quarantined');
  };

  const replayProjectTransaction = async (root: RootState, projectId: string, projectDir: string): Promise<void> => {
    const transactionFile = path.join(projectDir, PROJECT_TRANSACTION);
    const transactionBytes = await readBoundedBytes(fs, root.canonicalRoot, transactionFile, MAX_CONTROL_RECORD_BYTES);
    if (transactionBytes === null) return;
    const transaction = parseTransaction(decodeUtf8(transactionBytes));
    if (transaction === null || transaction.projectId !== projectId) {
      throw new CreativeStudioPilotStoreErrorV4('quarantined');
    }
    await assertTransactionFilePublishable(
      root,
      projectDir,
      transaction.manifestTemporaryFile,
      PROJECT_MANIFEST,
      transaction.previousManifestSha256,
      transaction.nextManifestSha256,
      manifestByteLimit
    );
    await assertTransactionFilePublishable(
      root,
      projectDir,
      transaction.briefTemporaryFile,
      PROJECT_BRIEF,
      transaction.previousBriefSha256,
      transaction.nextBriefSha256,
      MAX_BRIEF_BYTES
    );
    await publishTransactionFile(
      root,
      projectDir,
      transaction.briefTemporaryFile,
      PROJECT_BRIEF,
      transaction.previousBriefSha256,
      transaction.nextBriefSha256,
      MAX_BRIEF_BYTES
    );
    await publishTransactionFile(
      root,
      projectDir,
      transaction.manifestTemporaryFile,
      PROJECT_MANIFEST,
      transaction.previousManifestSha256,
      transaction.nextManifestSha256,
      manifestByteLimit
    );
    await syncDirectory(fs, projectDir);
    const liveManifest = await readDigest(
      fs,
      root.canonicalRoot,
      path.join(projectDir, PROJECT_MANIFEST),
      manifestByteLimit
    );
    const liveBrief = await readDigest(fs, root.canonicalRoot, path.join(projectDir, PROJECT_BRIEF), MAX_BRIEF_BYTES);
    if (liveManifest !== transaction.nextManifestSha256 || liveBrief !== transaction.nextBriefSha256) {
      throw new CreativeStudioPilotStoreErrorV4('quarantined');
    }
    await removeRegularIfPresent(fs, transactionFile);
    await syncDirectory(fs, projectDir);
  };

  const inspectProject = async (root: RootState, projectId: string): Promise<ProjectInspection> => {
    const projectDir = await resolveExistingProjectDirectory(root, projectId);
    if (projectDir === null) return { status: 'not_found', catalogueId: projectId };
    const directoryIdentity = await lstatDirectoryIdentity(fs, projectDir);
    try {
      await replayProjectTransaction(root, projectId, projectDir);
    } catch {
      return {
        status: 'quarantined',
        observedSchemaVersion: null,
        catalogueId: projectId,
        projectDir,
        directoryIdentity,
        manifestFingerprint: await manifestFingerprint(fs, root.canonicalRoot, path.join(projectDir, PROJECT_MANIFEST)),
      };
    }
    let manifest: Uint8Array | null;
    try {
      manifest = await readBoundedBytes(
        fs,
        root.canonicalRoot,
        path.join(projectDir, PROJECT_MANIFEST),
        manifestByteLimit
      );
    } catch {
      manifest = null;
    }
    const fingerprint =
      (manifest === null ? null : sha256(manifest)) ??
      (await manifestFingerprint(fs, root.canonicalRoot, path.join(projectDir, PROJECT_MANIFEST)));
    if (manifest === null) {
      return {
        status: 'quarantined',
        observedSchemaVersion: null,
        catalogueId: projectId,
        projectDir,
        directoryIdentity,
        manifestFingerprint: fingerprint,
      };
    }
    let manifestBytes: string;
    try {
      manifestBytes = decodeUtf8(manifest);
    } catch {
      return {
        status: 'quarantined',
        observedSchemaVersion: null,
        catalogueId: projectId,
        projectDir,
        directoryIdentity,
        manifestFingerprint: fingerprint,
      };
    }
    const observedVersion = parseObservedSchemaVersion(manifestBytes);
    if (observedVersion !== null && observedVersion !== STUDIO_PROJECT_SCHEMA_VERSION_V4) {
      return {
        status: 'unsupported',
        observedSchemaVersion: observedVersion,
        catalogueId: projectId,
        projectDir,
        directoryIdentity,
        manifestFingerprint: fingerprint,
      };
    }
    let brief: Uint8Array | null;
    try {
      brief = await readBoundedBytes(fs, root.canonicalRoot, path.join(projectDir, PROJECT_BRIEF), MAX_BRIEF_BYTES);
    } catch {
      brief = null;
    }
    let briefBytes: string | null = null;
    if (brief !== null) {
      try {
        briefBytes = decodeUtf8(brief);
      } catch {
        briefBytes = null;
      }
    }
    const candidate = briefBytes === null ? null : parseProjectEnvelopeCandidate(manifestBytes, briefBytes);
    const project = validateStudioProjectV4(candidate) ? candidate : null;
    if (observedVersion !== STUDIO_PROJECT_SCHEMA_VERSION_V4 || project === null || project.id !== projectId) {
      return {
        status: 'quarantined',
        observedSchemaVersion: observedVersion,
        catalogueId: projectId,
        projectDir,
        directoryIdentity,
        manifestFingerprint: fingerprint,
      };
    }
    return {
      status: 'healthy',
      catalogueId: projectId,
      project,
      projectDir,
      directoryIdentity,
      manifestFingerprint: fingerprint,
      manifestSha256: sha256(manifest),
      briefSha256: sha256(brief!),
    };
  };

  const assertInspectionCurrent = async (root: RootState, captured: HealthyInspection): Promise<void> => {
    const current = await inspectProject(root, captured.catalogueId);
    if (
      current.status !== 'healthy' ||
      current.project.revision !== captured.project.revision ||
      current.manifestFingerprint !== captured.manifestFingerprint ||
      !sameIdentity(current.directoryIdentity, captured.directoryIdentity)
    ) {
      throw new CreativeStudioPilotStoreErrorV4('stale_project');
    }
  };

  const writeProjectUpdate = async (
    root: RootState,
    captured: HealthyInspection,
    next: StudioProjectV4,
    authorizeBeforeReplace?: () => void | Promise<void>
  ): Promise<void> => {
    const serialized = serializeProject(next);
    if (
      Buffer.byteLength(serialized.manifestBytes, 'utf8') > manifestByteLimit ||
      Buffer.byteLength(serialized.briefBytes, 'utf8') > MAX_BRIEF_BYTES
    ) {
      throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
    }
    const transactionId = temporaryId();
    const transaction: ProjectWriteTransactionV4 = {
      schemaVersion: PROJECT_TRANSACTION_SCHEMA_VERSION,
      projectId: next.id,
      transactionId,
      manifestTemporaryFile: `.project-${transactionId}.tmp`,
      briefTemporaryFile: `.brief-${transactionId}.tmp`,
      previousManifestSha256: captured.manifestSha256,
      previousBriefSha256: captured.briefSha256,
      nextManifestSha256: sha256(serialized.manifestBytes),
      nextBriefSha256: sha256(serialized.briefBytes),
    };
    const manifestTemporaryPath = path.join(captured.projectDir, transaction.manifestTemporaryFile);
    const briefTemporaryPath = path.join(captured.projectDir, transaction.briefTemporaryFile);
    const transactionPath = path.join(captured.projectDir, PROJECT_TRANSACTION);
    const transactionPublicationTemporaryPath = path.join(captured.projectDir, `.transaction-${transactionId}.tmp`);
    let journalPublished = false;
    try {
      await writeExclusiveDurable(fs, manifestTemporaryPath, serialized.manifestBytes);
      await writeExclusiveDurable(fs, briefTemporaryPath, serialized.briefBytes);
      await syncDirectory(fs, captured.projectDir);
      await storageStep('update:candidates_durable', next.id);
      await assertInspectionCurrent(root, captured);
      await authorizeBeforeReplace?.();
      await writeExclusiveDurable(fs, transactionPublicationTemporaryPath, canonicalJson(transaction));
      await fs.link(transactionPublicationTemporaryPath, transactionPath);
      journalPublished = true;
      await syncDirectory(fs, captured.projectDir);
      await removeRegularIfPresent(fs, transactionPublicationTemporaryPath);
      await storageStep('update:journal_durable', next.id);
      await publishTransactionFile(
        root,
        captured.projectDir,
        transaction.briefTemporaryFile,
        PROJECT_BRIEF,
        transaction.previousBriefSha256,
        transaction.nextBriefSha256,
        MAX_BRIEF_BYTES
      );
      await storageStep('update:brief_published', next.id);
      await publishTransactionFile(
        root,
        captured.projectDir,
        transaction.manifestTemporaryFile,
        PROJECT_MANIFEST,
        transaction.previousManifestSha256,
        transaction.nextManifestSha256,
        manifestByteLimit
      );
      await storageStep('update:manifest_published', next.id);
      await syncDirectory(fs, captured.projectDir);
      await storageStep('update:directory_durable', next.id);
      await removeRegularIfPresent(fs, transactionPath);
      await syncDirectory(fs, captured.projectDir);
      await storageStep('update:complete', next.id);
    } catch (error) {
      if (!journalPublished) {
        await removeRegularIfPresent(fs, manifestTemporaryPath).catch((): undefined => undefined);
        await removeRegularIfPresent(fs, briefTemporaryPath).catch((): undefined => undefined);
        await removeRegularIfPresent(fs, transactionPublicationTemporaryPath).catch((): undefined => undefined);
      }
      throw error;
    }
  };

  const updateInsideQueue = async (
    root: RootState,
    captured: HealthyInspection,
    update: (project: StudioProjectV4) => StudioProjectV4,
    optionsInput: StudioPilotProjectUpdateOptionsV4
  ): Promise<StudioProjectV4> => {
    if (
      typeof update !== 'function' ||
      !isPlainRecord(optionsInput) ||
      (optionsInput.kind !== 'authoring' && optionsInput.kind !== 'runtime') ||
      (optionsInput.expectedRevision !== undefined && !isSafePositiveInteger(optionsInput.expectedRevision)) ||
      (optionsInput.authorizeBeforeReplace !== undefined && typeof optionsInput.authorizeBeforeReplace !== 'function')
    ) {
      throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
    }
    if (optionsInput.expectedRevision !== undefined && optionsInput.expectedRevision !== captured.project.revision) {
      throw new CreativeStudioPilotStoreErrorV4('stale_project');
    }
    if (
      captured.project.revision >= Number.MAX_SAFE_INTEGER ||
      captured.project.authoringRevision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
    }
    const candidate = update(clone(captured.project));
    if (
      !isPlainRecord(candidate) ||
      candidate.id !== captured.project.id ||
      candidate.createdAt !== captured.project.createdAt
    ) {
      throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
    }
    const committedAt = now();
    const next: StudioProjectV4 = {
      ...(candidate as StudioProjectV4),
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION_V4,
      revision: captured.project.revision + 1,
      authoringRevision: captured.project.authoringRevision + (optionsInput.kind === 'authoring' ? 1 : 0),
      id: captured.project.id,
      createdAt: captured.project.createdAt,
      updatedAt: committedAt,
    };
    if (!validateStudioProjectV4(next)) throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
    await writeProjectUpdate(root, captured, next, optionsInput.authorizeBeforeReplace);
    emit({
      projectId: next.id,
      operation: 'updated',
      previousRevision: captured.project.revision,
      committedRevision: next.revision,
      committedAt,
    });
    return clone(next);
  };

  const quarantineOwnedTree = async (root: RootState, directory: string, quarantineName: string): Promise<void> => {
    const quarantine = resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, quarantineName);
    if (await pathExists(fs, quarantine)) throw new CreativeStudioPilotStoreErrorV4('storage_error');
    await fs.rename(directory, quarantine);
    await syncDirectory(fs, root.projectsRoot);
  };

  const recoverCreateStage = async (root: RootState, entryName: string): Promise<void> => {
    const stage = resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, entryName);
    await lstatDirectoryIdentity(fs, stage);
    let pair: Awaited<ReturnType<typeof readProjectPair>>;
    try {
      pair = await readProjectPair(root, stage);
    } catch {
      pair = null;
    }
    const project = pair === null ? null : parseProjectEnvelope(pair.manifestBytes, pair.briefBytes);
    if (project === null || !SAFE_ID.test(project.id)) {
      await quarantineOwnedTree(root, stage, `.abandoned-${temporaryId()}`);
      return;
    }
    const target = projectDirectory(root, project.id);
    if (!(await pathExists(fs, target))) {
      await fs.rename(stage, target);
      await syncDirectory(fs, root.projectsRoot);
      return;
    }
    const existing = await inspectProject(root, project.id);
    if (
      existing.status === 'healthy' &&
      pair !== null &&
      existing.manifestSha256 === pair.manifestSha256 &&
      existing.briefSha256 === pair.briefSha256
    ) {
      await fs.rm(stage, { recursive: true });
      await syncDirectory(fs, root.projectsRoot);
      return;
    }
    await quarantineOwnedTree(root, stage, `.abandoned-${temporaryId()}`);
  };

  const removeDeletionTree = async (
    root: RootState,
    quarantinePath: string,
    expectedIdentity: StudioProjectDirectoryIdentityV4
  ): Promise<void> => {
    const actualIdentity = await lstatDirectoryIdentity(fs, quarantinePath);
    if (!sameIdentity(actualIdentity, expectedIdentity)) throw new CreativeStudioPilotStoreErrorV4('storage_error');
    await fs.rm(quarantinePath, { recursive: true });
    await syncDirectory(fs, root.projectsRoot);
  };

  const replayDeletionMarker = async (root: RootState, markerName: string): Promise<void> => {
    const markerPath = resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, markerName);
    const bytes = await readBoundedBytes(fs, root.canonicalRoot, markerPath, MAX_CONTROL_RECORD_BYTES);
    if (bytes === null) return;
    const marker = parseDeletionMarker(decodeUtf8(bytes));
    if (marker === null) {
      await fs.rename(
        markerPath,
        resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, `.invalid-${temporaryId()}`)
      );
      await syncDirectory(fs, root.projectsRoot);
      return;
    }
    const quarantinePath = resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, marker.quarantineName);
    if (await pathExists(fs, quarantinePath)) {
      await removeDeletionTree(root, quarantinePath, marker.directoryIdentity);
      await removeRegularIfPresent(fs, markerPath);
      await syncDirectory(fs, root.projectsRoot);
      return;
    }
    const current = await inspectProject(root, marker.catalogueId);
    if (current.status === 'not_found') {
      await removeRegularIfPresent(fs, markerPath);
      await syncDirectory(fs, root.projectsRoot);
      return;
    }
    if (!sameObservation(marker, current)) {
      await removeRegularIfPresent(fs, markerPath);
      await syncDirectory(fs, root.projectsRoot);
      return;
    }
    await fs.rename(current.projectDir, quarantinePath);
    await syncDirectory(fs, root.projectsRoot);
    await removeDeletionTree(root, quarantinePath, marker.directoryIdentity);
    await removeRegularIfPresent(fs, markerPath);
    await syncDirectory(fs, root.projectsRoot);
  };

  const initializeRoot = async (): Promise<RootState> => {
    if (closed) throw new CreativeStudioPilotStoreErrorV4('storage_error');
    const canonicalRoot = await canonicalizeRecordRoot({ fs, rootDir: options.rootDir });
    // Schema 7 owns the same per-project catalog root as schema 6. The decoder—not a parallel
    // namespace—makes schema-6 records unsupported at the clean cutover and keeps them deletable.
    const projectsRoot = canonicalRoot;
    const root = { canonicalRoot, projectsRoot };
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.name.startsWith('.delete-'))) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      try {
        // Replay root mutations serially so two recovery records cannot authorize the same path concurrently.
        // eslint-disable-next-line no-await-in-loop
        await replayDeletionMarker(root, entry.name);
      } catch {
        // One unsafe or incomplete deletion record must not disable unrelated projects.
      }
    }
    const afterDeletion = await fs.readdir(projectsRoot, { withFileTypes: true });
    for (const entry of afterDeletion.filter((candidate) => candidate.name.startsWith('.create-'))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        // Creation stages can claim the same minted id and therefore recover in lexical sequence.
        // eslint-disable-next-line no-await-in-loop
        await recoverCreateStage(root, entry.name);
      } catch {
        // The stage remains isolated from inventory for a later diagnostic/recovery pass.
      }
    }
    const projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true });
    for (const entry of projectEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_ID.test(entry.name)) continue;
      const directory = projectDirectory(root, entry.name);
      try {
        // Per-project journals are replayed serially during the one-time root bootstrap.
        // eslint-disable-next-line no-await-in-loop
        await replayProjectTransaction(root, entry.name, directory);
      } catch {
        // Inspection classifies only this project as quarantined.
      }
    }
    return root;
  };

  const rootState = (): Promise<RootState> => {
    if (closed) return Promise.reject(new CreativeStudioPilotStoreErrorV4('storage_error'));
    initialization ??= initializeRoot().catch((error: unknown) => {
      initialization = null;
      return normalizeError(error);
    });
    return initialization;
  };

  const scan = async (root: RootState): Promise<ProjectInspection[]> => {
    const entries = await fs.readdir(root.projectsRoot, { withFileTypes: true });
    const projectIds = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && SAFE_ID.test(entry.name))
      .map((entry) => entry.name)
      .toSorted();
    const inspections: ProjectInspection[] = [];
    for (const projectId of projectIds) {
      try {
        // Keep bounded inventory traversal deterministic and avoid burst-opening every project manifest.
        // eslint-disable-next-line no-await-in-loop
        inspections.push(await inspectProject(root, projectId));
      } catch {
        // A raced or unsafe entry is omitted; it cannot poison the remaining inventory.
      }
    }
    return inspections;
  };

  const deleteInsideQueue = async (
    root: RootState,
    inspection: Exclude<ProjectInspection, { status: 'not_found' }>,
    expectedRevision: number | null
  ): Promise<boolean> => {
    const committedAt = now();
    const id = temporaryId();
    const markerName = `.delete-${id}.json`;
    const quarantineName = `.deleting-${id}`;
    const markerPath = resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, markerName);
    const markerTemporaryPath = resolveConfinedRecordPath(
      root.canonicalRoot,
      root.projectsRoot,
      `.deletion-marker-${id}.tmp`
    );
    const marker: ProjectDeletionMarkerV4 = {
      schemaVersion: PROJECT_DELETION_SCHEMA_VERSION,
      catalogueId: inspection.catalogueId,
      classification: inspection.status,
      directoryIdentity: inspection.directoryIdentity,
      manifestFingerprint: inspection.manifestFingerprint,
      expectedRevision,
      quarantineName,
    };
    await publishExclusiveControlRecord(fs, root.projectsRoot, markerPath, markerTemporaryPath, canonicalJson(marker));
    await storageStep('delete:marker_durable', inspection.catalogueId);
    const current = await inspectProject(root, inspection.catalogueId);
    if (current.status === 'not_found' || !sameObservation(marker, current)) {
      await removeRegularIfPresent(fs, markerPath);
      await syncDirectory(fs, root.projectsRoot);
      throw new CreativeStudioPilotStoreErrorV4('stale_project');
    }
    const quarantinePath = resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, quarantineName);
    await fs.rename(current.projectDir, quarantinePath);
    await storageStep('delete:quarantined', inspection.catalogueId);
    await syncDirectory(fs, root.projectsRoot);
    await storageStep('delete:root_durable', inspection.catalogueId);
    await removeDeletionTree(root, quarantinePath, marker.directoryIdentity);
    await storageStep('delete:tree_removed', inspection.catalogueId);
    await removeRegularIfPresent(fs, markerPath);
    await syncDirectory(fs, root.projectsRoot);
    await storageStep('delete:complete', inspection.catalogueId);
    emit({
      projectId: inspection.catalogueId,
      operation: 'deleted',
      previousRevision: inspection.status === 'healthy' ? inspection.project.revision : null,
      committedRevision: null,
      committedAt,
    });
    return true;
  };

  const publicStore: CreativeStudioPilotStoreV4 = {
    async inspectProjectsV4() {
      const root = await rootState();
      const inspections = await scan(root);
      return {
        healthyProjectIds: inspections
          .filter((entry): entry is HealthyInspection => entry.status === 'healthy')
          .map((entry) => entry.catalogueId),
        unsupportedProjectIds: inspections
          .filter((entry): entry is UnreadableInspection => entry.status === 'unsupported')
          .map((entry) => entry.catalogueId),
        quarantinedProjectIds: inspections
          .filter((entry): entry is UnreadableInspection => entry.status === 'quarantined')
          .map((entry) => entry.catalogueId),
      };
    },

    async listProjectsV4() {
      const root = await rootState();
      const inspections = await scan(root);
      return inspections.map((inspection): StudioPilotProjectListEntryV4 => {
        if (inspection.status === 'healthy')
          return { classification: 'healthy', summary: toSummary(inspection.project) };
        if (inspection.status === 'not_found') throw new CreativeStudioPilotStoreErrorV4('storage_error');
        const issued = deletionClaims.issue(observationFor(inspection) as StudioUnreadableProjectDeletionObservationV4);
        return {
          catalogueId: inspection.catalogueId,
          classification: inspection.status,
          deletionClaim: issued.deletionClaim,
          deletionClaimExpiresAt: issued.expiresAt,
        };
      });
    },

    async createProjectV4(input) {
      const exactInput = snapshotCreateInput(input);
      if (exactInput === null) throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      const projectId = mintProjectId();
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
        throw new CreativeStudioPilotStoreErrorV4('storage_error');
      }
      return enqueue(projectId, async () => {
        const root = await rootState();
        if ((await inspectProject(root, projectId)).status !== 'not_found') {
          throw new CreativeStudioPilotStoreErrorV4('already_exists');
        }
        const createdAt = now();
        let project: StudioProjectV4;
        try {
          project = createEmptyStudioProjectV4(exactInput, projectId, createdAt);
        } catch {
          throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
        }
        const serialized = serializeProject(project);
        if (
          Buffer.byteLength(serialized.manifestBytes, 'utf8') > manifestByteLimit ||
          Buffer.byteLength(serialized.briefBytes, 'utf8') > MAX_BRIEF_BYTES
        ) {
          throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
        }
        const stageName = `.create-${temporaryId()}`;
        const stage = resolveConfinedRecordPath(root.canonicalRoot, root.projectsRoot, stageName);
        let published = false;
        try {
          await fs.mkdir(stage);
          await writeExclusiveDurable(fs, path.join(stage, PROJECT_BRIEF), serialized.briefBytes);
          await storageStep('create:brief_durable', projectId);
          await writeExclusiveDurable(fs, path.join(stage, PROJECT_MANIFEST), serialized.manifestBytes);
          await storageStep('create:manifest_durable', projectId);
          await syncDirectory(fs, stage);
          await storageStep('create:stage_durable', projectId);
          const target = projectDirectory(root, projectId);
          if (await pathExists(fs, target)) throw new CreativeStudioPilotStoreErrorV4('already_exists');
          await fs.rename(stage, target);
          published = true;
          await storageStep('create:published', projectId);
          await syncDirectory(fs, root.projectsRoot);
          await storageStep('create:root_durable', projectId);
        } catch (error) {
          if (!published) {
            // Keep a partial stage when a fault models process death; startup will isolate or finish it.
            const stageExists = await pathExists(fs, stage).catch(() => false);
            if (stageExists && options.onStorageStep === undefined) {
              await fs.rm(stage, { recursive: true }).catch((): undefined => undefined);
              await syncDirectory(fs, root.projectsRoot).catch((): undefined => undefined);
            }
          }
          return normalizeError(error);
        }
        emit({
          projectId,
          operation: 'created',
          previousRevision: null,
          committedRevision: project.revision,
          committedAt: createdAt,
        });
        return clone(project);
      });
    },

    async getProjectV4(projectId) {
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
        throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      }
      return enqueue(projectId, async () => {
        const inspection = await inspectProject(await rootState(), projectId);
        if (inspection.status === 'healthy') return { status: 'healthy', project: clone(inspection.project) };
        return { status: inspection.status, catalogueId: projectId } as StudioPilotProjectLoadResultV4;
      });
    },

    async loadProjectV4(projectId) {
      const result = await publicStore.getProjectV4(projectId);
      if (result.status === 'healthy') return result.project;
      if (result.status === 'not_found') throw new CreativeStudioPilotStoreErrorV4('not_found');
      throw new CreativeStudioPilotStoreErrorV4(result.status);
    },

    async getVerifiedProjectDirectoryV4(projectId) {
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
        throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      }
      return enqueue(projectId, async () => {
        const inspection = await inspectProject(await rootState(), projectId);
        if (inspection.status === 'not_found') return null;
        if (inspection.status !== 'healthy') throw new CreativeStudioPilotStoreErrorV4(inspection.status);
        await assertInspectionCurrent(await rootState(), inspection);
        return inspection.projectDir;
      });
    },

    async summarizeProjectV4(projectId) {
      return toSummary(await publicStore.loadProjectV4(projectId));
    },

    async updateProjectV4(projectId, update, updateOptions) {
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
        throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      }
      return enqueue(projectId, async () => {
        const root = await rootState();
        const inspection = await inspectProject(root, projectId);
        if (inspection.status === 'not_found') throw new CreativeStudioPilotStoreErrorV4('not_found');
        if (inspection.status !== 'healthy') throw new CreativeStudioPilotStoreErrorV4(inspection.status);
        return updateInsideQueue(root, inspection, update, updateOptions);
      });
    },

    async withProjectAuthorityV4(projectId, operation) {
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId) || typeof operation !== 'function') {
        throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      }
      return enqueue(
        projectId,
        async () => {
          const root = await rootState();
          const inspection = await inspectProject(root, projectId);
          if (inspection.status === 'not_found') throw new CreativeStudioPilotStoreErrorV4('not_found');
          if (inspection.status !== 'healthy') throw new CreativeStudioPilotStoreErrorV4(inspection.status);
          let active = true;
          let mutationUsed = false;
          let pending: Promise<unknown> | null = null;
          try {
            return await operation({
              project: clone(inspection.project),
              projectDir: inspection.projectDir,
              assertCurrent: () => {
                if (!active) return Promise.reject(new CreativeStudioPilotStoreErrorV4('invalid_payload'));
                return assertInspectionCurrent(root, inspection);
              },
              commit: (update, updateOptions) => {
                if (!active || mutationUsed)
                  return Promise.reject(new CreativeStudioPilotStoreErrorV4('invalid_payload'));
                mutationUsed = true;
                pending = updateInsideQueue(root, inspection, update, updateOptions);
                return pending as Promise<StudioProjectV4>;
              },
              delete: (expectedRevision) => {
                if (!active || mutationUsed || !isSafePositiveInteger(expectedRevision)) {
                  return Promise.reject(new CreativeStudioPilotStoreErrorV4('invalid_payload'));
                }
                if (expectedRevision !== inspection.project.revision) {
                  return Promise.reject(new CreativeStudioPilotStoreErrorV4('stale_project'));
                }
                mutationUsed = true;
                pending = deleteInsideQueue(root, inspection, expectedRevision);
                return pending as Promise<boolean>;
              },
            });
          } finally {
            try {
              await pending;
            } finally {
              active = false;
            }
          }
        },
        true
      );
    },

    async issueDeletionClaimV4(projectId) {
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
        throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      }
      return enqueue(projectId, async () => {
        const inspection = await inspectProject(await rootState(), projectId);
        if (inspection.status === 'not_found') throw new CreativeStudioPilotStoreErrorV4('not_found');
        if (inspection.status === 'healthy') throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
        return deletionClaims.issue(observationFor(inspection) as StudioUnreadableProjectDeletionObservationV4);
      });
    },

    async deleteProjectV4(projectId, authority) {
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId) || !isPlainRecord(authority)) {
        throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      }
      return enqueue(projectId, async () => {
        const root = await rootState();
        const inspection = await inspectProject(root, projectId);
        if (inspection.status === 'not_found') return false;
        const authorityRecord = authority as unknown as PlainRecord;
        if (
          hasExactDataKeys(authorityRecord, new Set(['deletionClaim'])) &&
          typeof authorityRecord.deletionClaim === 'string'
        ) {
          deletionClaims.consume(authorityRecord.deletionClaim, observationFor(inspection));
          if (inspection.status === 'healthy') {
            throw new CreativeStudioPilotStoreErrorV4('stale_project');
          }
          return deleteInsideQueue(root, inspection, null);
        }
        if (inspection.status === 'healthy') {
          if (
            !hasExactDataKeys(authorityRecord, new Set(['expectedRevision'])) ||
            !isSafePositiveInteger(authorityRecord.expectedRevision)
          ) {
            throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
          }
          if (authorityRecord.expectedRevision !== inspection.project.revision) {
            throw new CreativeStudioPilotStoreErrorV4('stale_project');
          }
          return deleteInsideQueue(root, inspection, authorityRecord.expectedRevision);
        }
        throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      });
    },

    watchProjectsV4(listener) {
      if (typeof listener !== 'function' || closed) throw new CreativeStudioPilotStoreErrorV4('invalid_payload');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      deletionClaims.clear();
    },
  };

  return publicStore;
};
