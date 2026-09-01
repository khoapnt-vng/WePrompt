/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as nodeFs } from 'node:fs';
import { watch as watchFileSystem } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  type CreateStudioProjectInputV2,
  type StudioConnectionBinding,
  type StudioMutationBatchV2,
  type StudioMutationReducerContextV2,
  type StudioProjectListResultV2,
  type StudioProjectSummaryV2,
  type StudioProjectV2,
  type StudioProposalCommitAttributionV2,
  type StudioProposalRecordV2,
  type StudioRecordProposalInputV2,
  type StudioProposalV2,
} from '@/common/types/project/creativeStudioTypes';
import { toStudioProjectSummaryV2 } from '@/common/types/project/creativeStudioProjectSummary';
import {
  canonicalizeRecordRoot,
  readBoundedRegularFileWithIdentity,
  resolveConfinedRecordPath,
} from '../service/recordIo';
import {
  applyStudioMutationBatchV2,
  createEmptyStudioProjectV2,
  validateStudioProjectV2,
  type StudioMutationApplyResultV2,
} from '../service/schema2';
import { STUDIO_BRIEF_FILE_MAX_BYTES, STUDIO_BRIEF_FILE_NAME } from '../service/briefFile';
import {
  CreativeStudioStoreError,
  StudioProjectConfirmationError,
  type CreativeStudioStore,
  type CreativeStudioStoreDeps,
  type StudioDecideReferenceRequestInputV2,
  type StudioDeepReadonly,
  type StudioPaidRecoveryProposalConfirmationInputV2,
  type StudioProjectAuthoritySnapshotV2,
  type StudioProjectCommitFacts,
  type StudioProjectConfirmationInputV2,
  type StudioProjectConfirmationResultV2,
  type StudioProjectDeletionAuthoritySnapshotV2,
  type StudioProjectInventoryV2,
  type StudioProjectStoreLoadResultV2,
  type StudioProposalAcceptanceResultV2,
  type StudioRecordReferenceGenerationHandoffReceiptInputV2,
  type StudioReferenceGenerationHandoffConfirmationInputV2,
  type StudioReferenceGenerationHandoffStoreV2,
  type StudioReferenceRequestLedgerEntryV2,
} from './contracts';
import { createStudioProjectRecordsV2 } from './projectRecords';
import { createStudioDeletionAuthorityV2 } from './deletionAuthority';
import {
  createStudioProposalSidecarsV2,
  STUDIO_PROPOSAL_MAX_RECORD_BYTES,
  type StudioProposalLedgerV2 as ProposalLedgerV2,
} from './proposalSidecars';
import { createStudioReferenceSidecarsV2 } from './referenceSidecars';
import { createStudioSidecarJournalV2, type StudioIdentifiedRecordV2 as IdentifiedRecordV2 } from './sidecarJournal';
import {
  createStudioProjectTransactionsV2,
  type StudioProjectFileInspectionV2 as ProjectFileInspectionV2,
} from './projectTransactions';
import { createStudioConnectionManifestV1 } from './connectionManifest';

export * from './contracts';
export {
  STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
  STUDIO_PROPOSAL_MAX_RECORD_BYTES,
  STUDIO_PROPOSAL_PENDING_TTL_MS,
} from './proposalSidecars';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const STUDIO_PROJECT_V2_MAX_ID_LENGTH = 256;
export const STUDIO_PROJECT_V2_MAX_RECORD_BYTES = 64 * 1024 * 1024;

type ProjectListingSweepV2 = {
  supportedProjectIds: string[];
  projectRevisions: { projectId: string; revision: number }[];
  summaries: StudioProjectSummaryV2[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isSafeIdV2 = (value: unknown): value is string =>
  isSafeId(value) && value.length <= STUDIO_PROJECT_V2_MAX_ID_LENGTH;
const isSafeProposalId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isCanonicalIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isStudioMutationReducerContextV2 = (value: unknown): value is StudioMutationReducerContextV2 => {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === 2 &&
    keys.every((key) => key === 'mutationId' || key === 'capturedAt') &&
    isSafeIdV2(value.mutationId) &&
    isCanonicalIsoTimestamp(value.capturedAt)
  );
};

const cloneConfirmationValue = <T>(value: T, label: string): T => {
  try {
    return structuredClone(value);
  } catch {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must be structured-cloneable`);
  }
};

const deepFreezeConfirmationValue = <T>(value: T, label: string): StudioDeepReadonly<T> => {
  const pending: object[] = [];
  const seen = new WeakSet<object>();
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') pending.push(value as object);

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const isArray = Array.isArray(current);
    const prototype = Reflect.getPrototypeOf(current);
    if (
      (!isArray && prototype !== Object.prototype && prototype !== null) ||
      (isArray && prototype !== Array.prototype)
    ) {
      throw new CreativeStudioStoreError('invalid_payload', `${label} must contain only plain data`);
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw new CreativeStudioStoreError('invalid_payload', `${label} must contain only data properties`);
      }
      const child = descriptor.value as unknown;
      if ((typeof child === 'object' && child !== null) || typeof child === 'function') pending.push(child as object);
    }
    Object.freeze(current);
  }

  return value as StudioDeepReadonly<T>;
};

const cloneAndFreezeConfirmationValue = <T>(value: T, label: string): StudioDeepReadonly<T> =>
  deepFreezeConfirmationValue(cloneConfirmationValue(value, label), label);

const assertSynchronousConfirmationResult = (value: unknown, label: string): void => {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
  let then: unknown;
  try {
    then = Reflect.get(value, 'then');
  } catch {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must return synchronously`);
  }
  if (typeof then === 'function') {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must return synchronously`);
  }
};

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const compareSummariesV2 = (left: StudioProjectSummaryV2, right: StudioProjectSummaryV2): number => {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Creates an atomic, manifest-backed store for Creative Studio projects. */
export const createCreativeStudioStore = (deps: CreativeStudioStoreDeps): CreativeStudioStore => {
  const rootDir = path.resolve(deps.rootDir);
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? (() => crypto.randomUUID().replaceAll('-', '_'));
  const fs = deps.fs ?? nodeFs;
  const connectionManifest = createStudioConnectionManifestV1({ rootDir, fs });
  const onProjectCommitted = deps.onProjectCommitted;
  const logError = deps.logError ?? ((message: string, error: unknown): void => console.error(message, error));
  const watchProposalTree =
    deps.watchProposalTree ??
    ((input: {
      rootDir: string;
      onChange: (relativeFile: string) => void;
      onError: (error: Error) => void;
    }): { close(): void } => {
      const watcher = watchFileSystem(input.rootDir, { recursive: true, encoding: 'utf8' }, (_eventType, fileName) => {
        if (fileName !== null) input.onChange(fileName);
      });
      watcher.on('error', input.onError);
      return { close: () => watcher.close() };
    });
  const queues = new Map<string, Promise<unknown>>();
  let summaryV2Queue: Promise<unknown> = Promise.resolve();

  const safeLogError = (message: string, error: unknown): void => {
    try {
      logError(message, error);
    } catch {
      // Logging is diagnostic and cannot veto an already-authoritative project commit.
    }
  };

  const observeProjectCommit = (facts: StudioProjectCommitFacts): void => {
    if (onProjectCommitted === undefined) return;
    let observerResult: unknown;
    try {
      observerResult = (onProjectCommitted as (observed: StudioProjectCommitFacts) => unknown)(facts);
    } catch (error) {
      safeLogError('[CreativeStudio] Project commit observer failed', error);
      return;
    }
    if ((typeof observerResult !== 'object' || observerResult === null) && typeof observerResult !== 'function') {
      return;
    }
    try {
      if (typeof Reflect.get(observerResult, 'then') !== 'function') return;
      void Promise.resolve(observerResult).catch((error: unknown): void => {
        safeLogError('[CreativeStudio] Project commit observer rejected', error);
      });
    } catch (error) {
      safeLogError('[CreativeStudio] Project commit observer rejected', error);
    }
  };

  const requireSafeId = (projectId: string): void => {
    if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
  };

  const isInsideRoot = (canonicalRoot: string, target: string): boolean =>
    target === canonicalRoot || target.startsWith(canonicalRoot + path.sep);

  const storageError = (error: unknown, fallback: string): CreativeStudioStoreError =>
    new CreativeStudioStoreError('storage_error', error instanceof Error ? error.message : fallback);

  const canonicalRoot = async (): Promise<string> => {
    try {
      return await canonicalizeRecordRoot({ fs, rootDir });
    } catch (error) {
      throw storageError(error, 'Creative Studio root is unavailable');
    }
  };

  const existingCanonicalRootV2 = async (): Promise<string | null> => {
    try {
      const stats = await fs.lstat(rootDir);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio root is unsafe');
      }
      return await fs.realpath(rootDir);
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw storageError(error, 'Creative Studio root is unavailable');
    }
  };

  const writableCanonicalRootV2 = async (): Promise<string> => (await existingCanonicalRootV2()) ?? canonicalRoot();

  const resolveRootChild = (root: string, child: string): string => {
    try {
      return resolveConfinedRecordPath(root, root, child);
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage target escaped its root');
    }
  };

  const assertRegularFileOrMissing = async (file: string): Promise<void> => {
    try {
      const stats = await fs.lstat(file);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage file is not a regular file');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return;
      throw storageError(error, 'Creative Studio storage file is unavailable');
    }
  };

  const projectDirectory = async (
    root: string,
    projectId: string,
    createIfMissing: boolean
  ): Promise<string | null> => {
    requireSafeId(projectId);
    const directory = resolveRootChild(root, projectId);
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT')
        throw storageError(error, 'Creative Studio project directory is unavailable');
      if (!createIfMissing) return null;
      try {
        await fs.mkdir(directory);
      } catch (mkdirError) {
        throw storageError(mkdirError, 'Creative Studio project directory could not be created');
      }
      const createdStats = await fs.lstat(directory);
      if (!createdStats.isDirectory() || createdStats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
    }

    try {
      const canonicalDirectory = await fs.realpath(directory);
      if (!isInsideRoot(root, canonicalDirectory) || canonicalDirectory === root) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory escaped its root');
      }
      return canonicalDirectory;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio project directory is unavailable');
    }
  };

  const createProjectDirectoryV2 = async (root: string, projectId: string): Promise<string> => {
    if (!isSafeIdV2(projectId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
    }
    const directory = resolveRootChild(root, projectId);
    try {
      await fs.mkdir(directory);
    } catch (error) {
      if (isRecord(error) && error.code === 'EEXIST') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
      }
      throw storageError(error, 'Creative Studio project directory could not be created');
    }
    try {
      const stats = await fs.lstat(directory);
      const canonicalDirectory = await fs.realpath(directory);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        !isInsideRoot(root, canonicalDirectory) ||
        canonicalDirectory === root
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
      return canonicalDirectory;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio project directory is unavailable');
    }
  };

  const summariesFileV2 = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'projects-v2.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const sidecarJournal = createStudioSidecarJournalV2({
    fs,
    defaultMaxRecordBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
    storageError,
  });
  const {
    assertDirectoryAuthorityV2,
    assertIdentifiedRecordCurrentV2,
    assertPathAbsentV2,
    captureDirectoryAuthorityV2,
    publishImmutableJournalRecordV2,
    sameIdentityV2,
    syncDirectoryAuthorityV2,
  } = sidecarJournal;

  const {
    assertProjectSnapshotCurrentV2,
    recoverBriefTransactionV2,
    serializeProjectV2ForWrite,
    synchronizeBriefFileV2InsideQueue,
    writeBytesAtomic,
    writeJsonAtomic,
    writeProjectFilesV2,
  } = createStudioProjectTransactionsV2({
    fs,
    now,
    maxProjectBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
    resolveRootChild,
    assertRegularFileOrMissing,
    assertDirectoryAuthority: assertDirectoryAuthorityV2,
    syncDirectoryAuthority: syncDirectoryAuthorityV2,
    assertPathAbsent: (file) => assertPathAbsentV2(file),
    inspectProjectFile: (root, projectId) => inspectProjectFileV2(root, projectId),
    requireSupportedProjectInspection: (inspected) => requireSupportedProjectInspectionV2(inspected),
    observeProjectCommit,
    storageError,
  });

  const { inspectProjectFileV2, readBoundedStudioV2File, requireSupportedProjectInspectionV2 } =
    createStudioProjectRecordsV2({
      fs,
      maxProjectBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
      projectDirectory,
      resolveRootChild,
      isInsideRoot,
      assertRegularFileOrMissing,
      captureDirectoryAuthority: captureDirectoryAuthorityV2,
      assertDirectoryAuthority: assertDirectoryAuthorityV2,
      recoverBriefTransaction: recoverBriefTransactionV2,
      storageError,
    });

  const enqueue = <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(projectId) ?? Promise.resolve();
    const next = previous.catch((): undefined => undefined).then(() => work());
    queues.set(projectId, next);
    void next
      .finally(() => {
        if (queues.get(projectId) === next) queues.delete(projectId);
      })
      .catch((): undefined => undefined);
    return next;
  };

  const {
    acceptProposalV2: acceptProposalSidecarV2,
    assertAttributionCreatedIdsV2,
    assertPendingProposalSlotV2,
    assertProposalDirectoryAuthoritiesV2,
    assertProposalLedgerEntrySetCurrentV2,
    listProposalsV2: listProposalSidecarsV2,
    publishProposalAttributionV2,
    readCleanProposalLedgerV2InsideQueue,
    reapAbandonedProposalsV2: reapAbandonedProposalSidecarsV2,
    reapProposalLedgerV2InsideQueue,
    recordProposalV2: recordProposalSidecarV2,
    rejectProposalV2: rejectProposalSidecarV2,
    resolveProposalAttributionV2InsideQueue,
    resolveProposalPathsV2: resolveProposalSidecarPathsV2,
    validateProposalCommitAttributionV2,
    watchProposalsV2: watchProposalSidecarsV2,
  } = createStudioProposalSidecarsV2({
    fs,
    now,
    watchProposalTree,
    safeLogError,
    storageError,
    enqueue,
    existingCanonicalRoot: existingCanonicalRootV2,
    writableCanonicalRoot: writableCanonicalRootV2,
    inspectProjectFile: inspectProjectFileV2,
    inspectProjectWithSidecarFences: (root, projectId) =>
      inspectProjectWithAttributionFenceV2InsideQueue(root, projectId),
    requireSupportedProjectInspection: (inspection) => requireSupportedProjectInspectionV2(inspection),
    assertProjectSnapshotCurrent: (input) => assertProjectSnapshotCurrentV2(input),
    serializeProjectForWrite: (project, label) => serializeProjectV2ForWrite(project, label),
    writeProjectFiles: (input) => writeProjectFilesV2(input),
    observeProjectCommit,
    repairSummaryAfterCommit: () => repairSummaryV2AfterCommit(),
    listSupportedProjectIds: async (root) => (await scanProjectsV2(root)).supportedProjectIds,
    sidecarJournal,
  });

  const {
    deleteSupportedProjectV2InsideQueue,
    finishProjectDeletionV2,
    projectDeletionPathsV2,
    readProjectDeletionMarkerV2,
  } = createStudioDeletionAuthorityV2({
    fs,
    maxProjectBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
    resolveRootChild,
    captureDirectoryAuthority: captureDirectoryAuthorityV2,
    assertDirectoryAuthority: assertDirectoryAuthorityV2,
    syncDirectoryAuthority: syncDirectoryAuthorityV2,
    sameIdentity: sameIdentityV2,
    assertPathAbsent: assertPathAbsentV2,
    assertProjectSnapshotCurrent: assertProjectSnapshotCurrentV2,
    assertIdentifiedRecordCurrent: (input) => assertIdentifiedRecordCurrentV2(input),
    publishImmutableJournalRecord: (input) => publishImmutableJournalRecordV2(input),
    inspectProjectFile: (root, projectId) => inspectProjectFileV2(root, projectId),
    requireSupportedProjectInspection: (inspected) => requireSupportedProjectInspectionV2(inspected),
    summariesFile: summariesFileV2,
    storageError,
  });

  const {
    confirmReferenceGenerationHandoffV2: confirmReferenceGenerationHandoffSidecarV2,
    decideReferenceRequestV2: decideReferenceRequestSidecarV2,
    hasOpenReferenceGenerationHandoffOverlapV2InsideQueue,
    listReferenceRequestsV2: listReferenceRequestSidecarsV2,
    readReferenceGenerationHandoffV2: readReferenceGenerationHandoffSidecarV2,
    reapAbandonedReferenceRequestsV2: reapAbandonedReferenceRequestSidecarsV2,
    recordReferenceGenerationHandoffReceiptV2: recordReferenceGenerationHandoffReceiptSidecarV2,
    resolveReferenceAuthorizationReceiptsV2InsideQueue,
    resolveReferenceRequestPathsV2: resolveReferenceRequestSidecarPathsV2,
    watchReferenceRequestsV2: watchReferenceRequestSidecarsV2,
  } = createStudioReferenceSidecarsV2({
    now,
    createId,
    watchReferenceTree: watchProposalTree,
    safeLogError,
    storageError,
    enqueue,
    existingCanonicalRoot: existingCanonicalRootV2,
    writableCanonicalRoot: writableCanonicalRootV2,
    inspectProjectFile: inspectProjectFileV2,
    inspectProjectWithSidecarFences: (root, projectId) =>
      inspectProjectWithAttributionFenceV2InsideQueue(root, projectId),
    requireSupportedProjectInspection: (inspection) => requireSupportedProjectInspectionV2(inspection),
    assertProjectSnapshotCurrent: (input) => assertProjectSnapshotCurrentV2(input),
    assertSynchronousResult: (value, label) => assertSynchronousConfirmationResult(value, label),
    listSupportedProjectIds: async (root) => (await scanProjectsV2(root)).supportedProjectIds,
    repairSummaryAfterCommit: () => repairSummaryV2AfterCommit(),
    confirmProjectInsideQueue: (root, inspection, input, authorizeBeforePersistence) =>
      confirmProjectV2InsideQueue(root, inspection, input, authorizeBeforePersistence),
    sidecarJournal,
  });

  const assertNoOpenReferenceHandoffOverlapV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    referenceIds: readonly string[];
  }): Promise<void> => {
    if (!(await hasOpenReferenceGenerationHandoffOverlapV2InsideQueue(input))) return;
    throw new CreativeStudioStoreError(
      'invalid_payload',
      'Studio paid recovery overlaps an open reference-generation handoff'
    );
  };

  const inspectProjectWithAttributionFenceV2InsideQueue = async (
    root: string,
    projectId: string
  ): Promise<ProjectFileInspectionV2> => {
    const deletion = await readProjectDeletionMarkerV2(root, projectId);
    if (deletion !== null) {
      const paths = projectDeletionPathsV2(root, projectId);
      let liveTarget = false;
      let quarantine = false;
      try {
        await fs.lstat(paths.projectDirectory);
        liveTarget = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio pending deletion target could not be inspected');
        }
      }
      try {
        await fs.lstat(paths.quarantineDirectory);
        quarantine = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio pending deletion quarantine could not be inspected');
        }
      }
      if (liveTarget && !quarantine) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion requires an explicit retry');
      }
      await finishProjectDeletionV2(root, deletion);
      return { status: 'not_found', projectId };
    }
    const inspected = await inspectProjectFileV2(root, projectId);
    if (inspected.status !== 'supported') return inspected;
    const proposalResolved = await resolveProposalAttributionV2InsideQueue({ root, projectId, snapshot: inspected });
    const referenceResolved = await resolveReferenceAuthorizationReceiptsV2InsideQueue({
      root,
      projectId,
      snapshot: proposalResolved,
    });
    return synchronizeBriefFileV2InsideQueue(root, referenceResolved);
  };

  const inspectProjectThroughAttributionFenceV2 = (root: string, projectId: string): Promise<ProjectFileInspectionV2> =>
    enqueue(projectId, () => inspectProjectWithAttributionFenceV2InsideQueue(root, projectId));

  const scanProjectsV2 = async (root: string): Promise<ProjectListingSweepV2> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      throw storageError(error, 'Studio project inventory could not be inspected');
    }
    const unsafeProjectEntry = entries.find((entry) => isSafeIdV2(entry.name) && entry.isSymbolicLink());
    if (unsafeProjectEntry !== undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
    }
    const projectEntries = entries
      .filter((entry) => entry.isDirectory() && isSafeIdV2(entry.name))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    const supportedProjectIds: string[] = [];
    const projectRevisions: { projectId: string; revision: number }[] = [];
    const summaries: StudioProjectSummaryV2[] = [];
    const unsupportedProjectIds: string[] = [];
    const quarantinedProjectIds: string[] = [];
    for (const entry of projectEntries) {
      const projectId = entry.name;
      let inspected: ProjectFileInspectionV2;
      try {
        // A schema-2 record may be large, so inventory reads stay sequential and bounded.
        // eslint-disable-next-line no-await-in-loop
        inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      } catch (error) {
        quarantinedProjectIds.push(projectId);
        safeLogError(`[CreativeStudio] Quarantined corrupt schema-2 project manifest: ${projectId}`, error);
        continue;
      }
      if (inspected.status === 'supported') {
        supportedProjectIds.push(inspected.project.id);
        projectRevisions.push({ projectId: inspected.project.id, revision: inspected.project.revision });
        summaries.push(toStudioProjectSummaryV2(inspected.project));
      } else if (inspected.status === 'unsupported_prototype_schema') unsupportedProjectIds.push(projectId);
      else if (inspected.status === 'malformed_v2') {
        quarantinedProjectIds.push(projectId);
        safeLogError(`[CreativeStudio] Quarantined corrupt schema-2 project manifest: ${projectId}`, inspected.error);
      }
    }
    return { supportedProjectIds, projectRevisions, summaries, unsupportedProjectIds, quarantinedProjectIds };
  };

  const toProjectListResultV2 = (sweep: ProjectListingSweepV2): StudioProjectListResultV2 => ({
    projects: sweep.summaries.toSorted(compareSummariesV2),
    projectRevisions: sweep.projectRevisions.toSorted((left, right) => left.projectId.localeCompare(right.projectId)),
    unsupportedProjectIds: [...sweep.unsupportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
    quarantinedProjectIds: [...sweep.quarantinedProjectIds].toSorted((left, right) => left.localeCompare(right)),
  });

  const repairSummaryIndexV2 = (): Promise<StudioProjectListResultV2> => {
    const rebuild = async (): Promise<StudioProjectListResultV2> => {
      const root = await existingCanonicalRootV2();
      if (root === null)
        return { projects: [], projectRevisions: [], unsupportedProjectIds: [], quarantinedProjectIds: [] };
      const indexFile = await summariesFileV2(root);
      const sweep = await scanProjectsV2(root);
      const result = toProjectListResultV2(sweep);
      let existing: unknown = null;
      let indexExists = true;
      try {
        const record = await readBoundedStudioV2File(root, indexFile);
        indexExists = record !== null;
        if (record?.status === 'bytes') existing = JSON.parse(record.bytes) as unknown;
      } catch {
        // A malformed or oversized schema-2 summary index is rebuilt from project manifests below.
      }
      const ownsIndex = indexExists || sweep.supportedProjectIds.length > 0 || sweep.quarantinedProjectIds.length > 0;
      if (ownsIndex) {
        // Revisions correlate live read models only. Keep them out of the independently versioned summary sidecar.
        const next = { schemaVersion: 2, projects: result.projects };
        if (!sameJson(existing, next)) await writeJsonAtomic(root, indexFile, next);
      }
      return result;
    };
    const next = summaryV2Queue.catch((): undefined => undefined).then(() => rebuild());
    summaryV2Queue = next.catch((): undefined => undefined);
    return next;
  };

  const repairSummaryV2AfterCommit = async (): Promise<void> => {
    try {
      await repairSummaryIndexV2();
    } catch (error) {
      safeLogError('[CreativeStudio] Schema-2 project summary repair failed after commit', error);
      await repairSummaryIndexV2().catch((retryError: unknown): void => {
        safeLogError('[CreativeStudio] Schema-2 project summary repair retry failed', retryError);
      });
    }
  };

  const updateProjectV2InsideQueue = async (
    root: string,
    inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>,
    update: (project: StudioProjectV2) => StudioProjectV2,
    expectedRevision: number | undefined,
    commitTag: string | null,
    authorizeBeforeReplace?: () => void | Promise<void>
  ): Promise<StudioProjectV2> => {
    const current = inspected.project;
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    await summariesFileV2(root);
    const updated = update(structuredClone(current));
    if (!isRecord(updated) || updated.id !== current.id || updated.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    const next: StudioProjectV2 = {
      ...updated,
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    if (!validateStudioProjectV2(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const bytes = serializeProjectV2ForWrite(next, 'Schema-2 Studio project');
    await writeProjectFilesV2({
      root,
      snapshot: inspected,
      project: next,
      projectBytes: bytes,
      authorizeBeforeReplace,
    });
    observeProjectCommit(
      Object.freeze({
        projectId: current.id,
        previousRevision: current.revision,
        committedRevision: next.revision,
        committedAt: next.updatedAt,
        commitTag,
      })
    );
    return next;
  };

  const confirmProjectV2InsideQueue = async <TRevalidation, TDispatch>(
    root: string,
    inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>,
    input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>,
    authorizeBeforePersistence?: (candidate: StudioProjectV2) => Promise<void>
  ): Promise<StudioProjectConfirmationResultV2<TDispatch>> => {
    const current = inspected.project;
    if (current.revision !== input.expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }

    await summariesFileV2(root);

    const snapshot = cloneAndFreezeConfirmationValue(current, 'Studio confirmation project snapshot');
    const rawRevalidation = await input.revalidate(snapshot);
    const revalidation = cloneAndFreezeConfirmationValue(rawRevalidation, 'Studio confirmation revalidation');

    const activeAfterRevalidation = (input.assertActive as () => unknown)();
    assertSynchronousConfirmationResult(activeAfterRevalidation, 'Studio confirmation active-session check');

    const confirmedAt = now();
    if (!isCanonicalIsoTimestamp(confirmedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio confirmation clock is invalid');
    }
    if (Date.parse(confirmedAt) >= Date.parse(input.expiresAt)) {
      throw new StudioProjectConfirmationError('Studio confirmation has expired');
    }

    const mutableProject = cloneConfirmationValue(current, 'Studio confirmation commit project');
    const rawCommit = input.buildCommit(mutableProject, revalidation, confirmedAt) as unknown;
    assertSynchronousConfirmationResult(rawCommit, 'Studio confirmation commit builder');
    if (!isRecord(rawCommit)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation commit');
    }
    const projectDescriptor = Reflect.getOwnPropertyDescriptor(rawCommit, 'project');
    const dispatchDescriptor = Reflect.getOwnPropertyDescriptor(rawCommit, 'dispatch');
    if (
      projectDescriptor === undefined ||
      !Object.hasOwn(projectDescriptor, 'value') ||
      dispatchDescriptor === undefined ||
      !Object.hasOwn(dispatchDescriptor, 'value')
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation commit');
    }
    const builtProject = projectDescriptor.value as unknown;
    if (!isRecord(builtProject) || builtProject.id !== current.id || builtProject.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    const candidate: StudioProjectV2 = {
      ...(builtProject as StudioProjectV2),
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: current.revision + 1,
      updatedAt: confirmedAt,
    };
    if (!validateStudioProjectV2(candidate)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const next = cloneConfirmationValue(candidate, 'Studio confirmation committed project');
    if (!validateStudioProjectV2(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const dispatch = cloneAndFreezeConfirmationValue(
      dispatchDescriptor.value as TDispatch,
      'Studio confirmation dispatch'
    );

    const activeBeforePersistence = (input.assertActive as () => unknown)();
    assertSynchronousConfirmationResult(activeBeforePersistence, 'Studio confirmation active-session check');
    const authorizedProject = cloneAndFreezeConfirmationValue(next, 'Studio confirmation authorized project');
    if (authorizeBeforePersistence !== undefined) {
      await authorizeBeforePersistence(authorizedProject as StudioProjectV2);
    }
    const bytes = serializeProjectV2ForWrite(next, 'Schema-2 Studio confirmation project');
    await writeProjectFilesV2({
      root,
      snapshot: inspected,
      project: next,
      projectBytes: bytes,
      authorizeBeforeReplace:
        authorizeBeforePersistence === undefined
          ? undefined
          : () => authorizeBeforePersistence(authorizedProject as StudioProjectV2),
    });
    observeProjectCommit(
      Object.freeze({
        projectId: current.id,
        previousRevision: current.revision,
        committedRevision: next.revision,
        committedAt: next.updatedAt,
        commitTag: input.commitTag ?? null,
      })
    );
    return { project: next, dispatch };
  };

  return {
    async inspectProjectsV2(): Promise<StudioProjectInventoryV2> {
      const root = await existingCanonicalRootV2();
      if (root === null) {
        return { supportedProjectIds: [], unsupportedProjectIds: [], quarantinedProjectIds: [] };
      }
      const sweep = await scanProjectsV2(root);
      return {
        supportedProjectIds: [...sweep.supportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
        unsupportedProjectIds: [...sweep.unsupportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
        quarantinedProjectIds: [...sweep.quarantinedProjectIds].toSorted((left, right) => left.localeCompare(right)),
      };
    },

    async listProjectsV2(): Promise<StudioProjectListResultV2> {
      return repairSummaryIndexV2();
    },

    async createProjectV2(input: CreateStudioProjectInputV2): Promise<StudioProjectV2> {
      if (!isRecord(input) || Object.hasOwn(input, 'id')) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project ids are generated by the store');
      }
      const projectId = createId();
      if (!isSafeIdV2(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      let candidate: StudioProjectV2;
      try {
        candidate = createEmptyStudioProjectV2(input, projectId, now());
      } catch {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
      }
      const created = await enqueue(projectId, async () => {
        const root = await writableCanonicalRootV2();
        await summariesFileV2(root);
        if ((await projectDirectory(root, projectId, false)) !== null) {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
        }
        const directory = await createProjectDirectoryV2(root, projectId);
        const directoryAuthority = await captureDirectoryAuthorityV2(directory);
        const file = resolveRootChild(directory, 'project.json');
        const briefFile = resolveRootChild(directory, STUDIO_BRIEF_FILE_NAME);
        await assertRegularFileOrMissing(file);
        await assertRegularFileOrMissing(briefFile);
        if (Buffer.byteLength(candidate.brief, 'utf8') > STUDIO_BRIEF_FILE_MAX_BYTES) {
          throw new CreativeStudioStoreError('invalid_payload', 'Schema-5 Studio Brief is too large');
        }
        const projectBytes = serializeProjectV2ForWrite(candidate, 'Schema-5 Studio creation project');
        await writeBytesAtomic(root, briefFile, candidate.brief, async () => {
          await Promise.all([assertPathAbsentV2(briefFile), assertDirectoryAuthorityV2(directoryAuthority)]);
        });
        const publishedBrief = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: briefFile,
          maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
        });
        if (publishedBrief === null || publishedBrief.bytes !== candidate.brief) {
          throw new CreativeStudioStoreError('storage_error', 'Schema-5 Studio Brief was not published');
        }
        await writeBytesAtomic(root, file, projectBytes, async () => {
          await Promise.all([assertPathAbsentV2(file), assertDirectoryAuthorityV2(directoryAuthority)]);
          const currentBrief = await readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: root,
            file: briefFile,
            maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
          });
          if (
            currentBrief === null ||
            currentBrief.bytes !== publishedBrief.bytes ||
            !sameIdentityV2(currentBrief.identity, publishedBrief.identity)
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Schema-5 Studio Brief authority changed');
          }
        });
        return candidate;
      });
      await repairSummaryV2AfterCommit();
      return created;
    },

    async getProjectV2(projectId: string): Promise<StudioProjectStoreLoadResultV2> {
      if (!isSafeIdV2(projectId)) return { status: 'not_found', projectId };
      const root = await existingCanonicalRootV2();
      if (root === null) return { status: 'not_found', projectId };
      const inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      if (inspected.status === 'malformed_v2') throw inspected.error;
      return inspected.status === 'supported' ? { status: 'supported', project: inspected.project } : inspected;
    },

    async applyMutationBatchV2(
      batch: StudioMutationBatchV2,
      context: StudioMutationReducerContextV2,
      commitTag?: string
    ): Promise<StudioMutationApplyResultV2> {
      if (!isRecord(batch) || !isSafeIdV2(batch.projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      if (!isIntegerInRange(batch.expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      if (!isStudioMutationReducerContextV2(context)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio mutation reducer context');
      }
      const mutationBatch = cloneConfirmationValue(batch, 'Studio mutation batch');
      const reducerContext = Object.freeze({
        mutationId: context.mutationId,
        capturedAt: context.capturedAt,
      });
      const result = await enqueue(mutationBatch.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const inspected = await inspectProjectWithAttributionFenceV2InsideQueue(root, mutationBatch.projectId);
        if (inspected.status === 'not_found') {
          throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        }
        if (inspected.status === 'unsupported_prototype_schema') {
          throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
        }
        if (inspected.status === 'malformed_v2') throw inspected.error;
        const current = inspected.project;
        if (current.revision !== mutationBatch.expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        await summariesFileV2(root);
        const applied = applyStudioMutationBatchV2(current, mutationBatch, reducerContext);
        const committed: StudioProjectV2 = {
          ...applied.project,
          revision: current.revision + 1,
          updatedAt: now(),
        };
        if (!validateStudioProjectV2(committed)) {
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
        }
        const bytes = serializeProjectV2ForWrite(committed, 'Schema-2 Studio mutation project');
        await writeProjectFilesV2({
          root,
          snapshot: inspected,
          project: committed,
          projectBytes: bytes,
        });
        observeProjectCommit(
          Object.freeze({
            projectId: current.id,
            previousRevision: current.revision,
            committedRevision: committed.revision,
            committedAt: committed.updatedAt,
            commitTag: commitTag ?? null,
          })
        );
        return { ...applied, project: committed };
      });
      await repairSummaryV2AfterCommit();
      return result;
    },

    async confirmProjectV2<TRevalidation, TDispatch>(
      input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>
    ): Promise<StudioProjectConfirmationResultV2<TDispatch>> {
      if (
        !isRecord(input) ||
        !isSafeIdV2(input.projectId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isCanonicalIsoTimestamp(input.expiresAt) ||
        typeof input.revalidate !== 'function' ||
        typeof input.assertActive !== 'function' ||
        typeof input.buildCommit !== 'function' ||
        (input.commitTag !== undefined && typeof input.commitTag !== 'string')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation input');
      }
      const confirmationInput = Object.freeze({
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        expiresAt: input.expiresAt,
        revalidate: input.revalidate,
        assertActive: input.assertActive,
        buildCommit: input.buildCommit,
        commitTag: input.commitTag,
      });
      let result: StudioProjectConfirmationResultV2<TDispatch>;
      try {
        result = await enqueue(confirmationInput.projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, confirmationInput.projectId)
          );
          return confirmProjectV2InsideQueue(root, inspected, confirmationInput);
        });
      } catch (error) {
        // A commit queued immediately before this confirmation may be repairing the summary index.
        // Delay the stale rejection until that already-started maintenance settles so callers can
        // observe the preceding mutation before handling this queued result.
        await summaryV2Queue.catch((): undefined => undefined);
        throw error;
      }
      await repairSummaryV2AfterCommit();
      return result;
    },

    async confirmPaidRecoveryProposalV2<TRevalidation, TDispatch>(
      input: StudioPaidRecoveryProposalConfirmationInputV2<TRevalidation, TDispatch>
    ): Promise<StudioProjectConfirmationResultV2<TDispatch>> {
      if (
        !isRecord(input) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeProposalId(input.proposalId) ||
        !isSafeProposalId(input.authorizationId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isCanonicalIsoTimestamp(input.expiresAt) ||
        typeof input.revalidate !== 'function' ||
        typeof input.assertActive !== 'function' ||
        typeof input.buildCommit !== 'function' ||
        (input.commitTag !== undefined && typeof input.commitTag !== 'string')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio paid-recovery confirmation input');
      }
      const confirmationInput = Object.freeze({
        projectId: input.projectId,
        proposalId: input.proposalId,
        authorizationId: input.authorizationId,
        expectedRevision: input.expectedRevision,
        expiresAt: input.expiresAt,
        revalidate: input.revalidate,
        assertActive: input.assertActive,
        buildCommit: input.buildCommit,
        commitTag: input.commitTag,
      });
      let result: StudioProjectConfirmationResultV2<TDispatch>;
      try {
        result = await enqueue(confirmationInput.projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, confirmationInput.projectId)
          );
          let ledger = await readCleanProposalLedgerV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: inspected,
            createIfWhollyAbsent: false,
          });
          if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
          ledger = await reapProposalLedgerV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: inspected,
            ledger,
          });
          const proposal = ledger.proposals.get(confirmationInput.proposalId);
          if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
          if (
            proposal.record.payload.kind !== 'paid_recovery' ||
            proposal.record.baseRevision !== confirmationInput.expectedRevision ||
            ledger.decisions.has(confirmationInput.proposalId)
          ) {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio paid-recovery proposal is not pending');
          }
          const paidPrepare = proposal.record.payload.blocker.remedy.prepare;
          const paidReferenceIds = paidPrepare.kind === 'project_references' ? [...paidPrepare.referenceIds] : [];
          await assertNoOpenReferenceHandoffOverlapV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: inspected,
            referenceIds: paidReferenceIds,
          });
          const slot = assertPendingProposalSlotV2(ledger, confirmationInput.proposalId);
          let identifiedAttribution: IdentifiedRecordV2<StudioProposalCommitAttributionV2> | null = null;
          const committed = await confirmProjectV2InsideQueue(root, inspected, confirmationInput, async (candidate) => {
            await assertNoOpenReferenceHandoffOverlapV2InsideQueue({
              root,
              projectId: confirmationInput.projectId,
              snapshot: inspected,
              referenceIds: paidReferenceIds,
            });
            const exactAuthorizations = candidate.spendAuthorizations.filter(
              (authorization) => authorization.id === confirmationInput.authorizationId
            );
            if (
              candidate.spendAuthorizations.length !== inspected.project.spendAuthorizations.length + 1 ||
              exactAuthorizations.length !== 1 ||
              inspected.project.spendAuthorizations.some(
                (authorization) => authorization.id === confirmationInput.authorizationId
              )
            ) {
              throw new CreativeStudioStoreError(
                'invalid_payload',
                'Studio paid recovery did not create one exact authorization'
              );
            }
            const candidateBytes = serializeProjectV2ForWrite(
              candidate as StudioProjectV2,
              'Schema-2 Studio paid-recovery proposal result'
            );
            const authorization = exactAuthorizations[0]!;
            const attribution: StudioProposalCommitAttributionV2 = {
              schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
              kind: 'paid_recovery',
              proposalId: proposal.record.id,
              projectId: confirmationInput.projectId,
              baseRevision: proposal.record.baseRevision,
              appliedRevision: candidate.revision,
              beforeProjectSha256: sha256Utf8(inspected.bytes),
              afterProjectSha256: sha256Utf8(candidateBytes),
              createdBeatIds: [],
              createdShotIds: [],
              authorizationId: authorization.id,
              decidedAt: authorization.confirmedAt,
            };
            if (
              Date.parse(attribution.decidedAt) < Date.parse(proposal.record.createdAt) ||
              attribution.decidedAt !== candidate.updatedAt ||
              !validateProposalCommitAttributionV2(
                confirmationInput.projectId,
                confirmationInput.proposalId,
                attribution
              )
            ) {
              throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio paid-recovery attribution');
            }
            assertAttributionCreatedIdsV2({
              attribution,
              proposal: proposal.record,
              project: candidate as StudioProjectV2,
              state: 'after',
            });
            if (identifiedAttribution === null) {
              await assertProposalLedgerEntrySetCurrentV2(ledger);
              await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
              identifiedAttribution = await publishProposalAttributionV2({
                root,
                projectId: confirmationInput.projectId,
                directories: ledger.directories,
                attribution,
                authorizeBeforeLink: async (temporary) => {
                  await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
                  await assertProposalLedgerEntrySetCurrentV2(ledger, { attribution: temporary });
                  await assertProposalDirectoryAuthoritiesV2(ledger.directories);
                  await Promise.all([
                    assertIdentifiedRecordCurrentV2({
                      root,
                      authority: ledger!.directories.pending,
                      identified: proposal,
                    }),
                    assertIdentifiedRecordCurrentV2({
                      root,
                      authority: ledger!.directories.slots,
                      identified: slot,
                    }),
                    assertPathAbsentV2(
                      path.join(ledger!.directories.decisions.path, `${confirmationInput.proposalId}.json`)
                    ),
                  ]);
                  await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
                },
              });
            } else {
              if (!sameJson(identifiedAttribution.record, attribution)) {
                throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution changed');
              }
            }
            const exactAttribution = identifiedAttribution;
            if (exactAttribution === null) {
              throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution disappeared');
            }
            const attributedLedger: ProposalLedgerV2 = { ...ledger, attributions: [exactAttribution] };
            await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
            await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
            await assertProposalDirectoryAuthoritiesV2(ledger.directories);
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.commits,
                identified: exactAttribution,
              }),
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.pending,
                identified: proposal,
              }),
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.slots,
                identified: slot,
              }),
              assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${confirmationInput.proposalId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
          });
          if (identifiedAttribution === null) {
            throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution was not published');
          }
          const postCommit = requireSupportedProjectInspectionV2(
            await inspectProjectFileV2(root, confirmationInput.projectId)
          );
          if (!sameJson(postCommit.project, committed.project)) {
            throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery project changed');
          }
          await resolveProposalAttributionV2InsideQueue({
            root,
            projectId: confirmationInput.projectId,
            snapshot: postCommit,
          });
          return committed;
        });
      } catch (error) {
        await summaryV2Queue.catch((): undefined => undefined);
        throw error;
      }
      await repairSummaryV2AfterCommit();
      return result;
    },

    async confirmReferenceGenerationHandoffV2<TRevalidation, TDispatch>(
      input: StudioReferenceGenerationHandoffConfirmationInputV2<TRevalidation, TDispatch>
    ): Promise<StudioProjectConfirmationResultV2<TDispatch>> {
      return confirmReferenceGenerationHandoffSidecarV2(input);
    },

    async updateProjectV2(
      projectId: string,
      update: (project: StudioProjectV2) => StudioProjectV2,
      expectedRevision?: number,
      commitTag?: string
    ): Promise<StudioProjectV2> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      const result = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const inspected = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        return updateProjectV2InsideQueue(root, inspected, update, expectedRevision, commitTag ?? null);
      });
      await repairSummaryV2AfterCommit();
      return result;
    },

    async withProjectAuthorityV2<T>(
      projectId: string,
      operation: (snapshot: StudioProjectAuthoritySnapshotV2) => Promise<T>
    ): Promise<T> {
      if (!isSafeIdV2(projectId) || typeof operation !== 'function') {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority request');
      }
      let projectCommitted = false;
      let projectDeleted = false;
      let result: T;
      try {
        result = await enqueue(projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
          );
          let scopeActive = true;
          let mutationUsed = false;
          let commitPromise: Promise<StudioProjectV2> | null = null;
          let deletePromise: Promise<boolean> | null = null;
          let operationFailed = false;
          let operationError: unknown;
          let operationResult: T;
          let settlementFailed = false;
          let settlementError: unknown;
          try {
            operationResult = await operation({
              project: structuredClone(inspected.project),
              projectDir: inspected.directory.path,
              assertCurrent: () => {
                if (!scopeActive) {
                  throw new CreativeStudioStoreError('storage_error', 'Studio project authority has expired');
                }
                return assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
              },
              commit: (update, expectedRevision, commitTag, authorizeBeforeReplace) => {
                if (!scopeActive || mutationUsed || typeof update !== 'function') {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority commit')
                  );
                }
                if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision')
                  );
                }
                if (commitTag !== undefined && typeof commitTag !== 'string') {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project commit tag')
                  );
                }
                if (authorizeBeforeReplace !== undefined && typeof authorizeBeforeReplace !== 'function') {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project commit authorizer')
                  );
                }
                mutationUsed = true;
                commitPromise = updateProjectV2InsideQueue(
                  root,
                  inspected,
                  update,
                  expectedRevision,
                  commitTag ?? null,
                  authorizeBeforeReplace
                ).then((committed) => {
                  projectCommitted = true;
                  return committed;
                });
                return commitPromise;
              },
              delete: (expectedRevision, authorizeBeforeDelete) => {
                if (
                  !scopeActive ||
                  mutationUsed ||
                  !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
                  (authorizeBeforeDelete !== undefined && typeof authorizeBeforeDelete !== 'function')
                ) {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority deletion')
                  );
                }
                mutationUsed = true;
                deletePromise = deleteSupportedProjectV2InsideQueue(
                  root,
                  inspected,
                  expectedRevision,
                  authorizeBeforeDelete
                ).then((deleted) => {
                  projectDeleted = deleted;
                  return deleted;
                });
                return deletePromise;
              },
            });
          } catch (error) {
            operationFailed = true;
            operationError = error;
          } finally {
            try {
              try {
                await commitPromise;
                await deletePromise;
              } catch (error) {
                if (!operationFailed) {
                  settlementFailed = true;
                  settlementError = error;
                }
              }
            } finally {
              scopeActive = false;
            }
          }
          if (operationFailed) throw operationError;
          if (settlementFailed) throw settlementError;
          return operationResult!;
        });
      } catch (error) {
        if (projectCommitted || projectDeleted) await repairSummaryV2AfterCommit();
        throw error;
      }
      if (projectCommitted || projectDeleted) await repairSummaryV2AfterCommit();
      return result;
    },

    async deleteProjectWithSidecarAuthorityV2(
      projectId: string,
      expectedRevision: number,
      operation: (snapshot: StudioProjectDeletionAuthoritySnapshotV2) => Promise<boolean>
    ): Promise<boolean> {
      if (
        !isSafeIdV2(projectId) ||
        !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        typeof operation !== 'function'
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project deletion authority request');
      }
      let projectDeleted = false;
      let result: boolean;
      try {
        result = await enqueue(projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) return false;
          const marker = await readProjectDeletionMarkerV2(root, projectId);
          if (marker !== null && marker.record.expectedRevision !== expectedRevision) {
            throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
          }
          let inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
          if (marker !== null) {
            const pending = await inspectProjectFileV2(root, projectId);
            if (pending.status !== 'supported') {
              await finishProjectDeletionV2(root, marker);
              projectDeleted = true;
              return true;
            }
            if (
              pending.project.revision !== expectedRevision ||
              marker.record.directoryDev !== pending.directory.dev ||
              marker.record.directoryIno !== pending.directory.ino ||
              marker.record.projectSha256 !== sha256Utf8(pending.bytes)
            ) {
              throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker changed');
            }
            inspected = pending;
          } else {
            const current = await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId);
            if (current.status === 'not_found') return false;
            if (current.status === 'unsupported_prototype_schema') {
              throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
            }
            if (current.status === 'malformed_v2') throw current.error;
            inspected = current;
          }

          let scopeActive = true;
          let deleteUsed = false;
          let deletePromise: Promise<boolean> | null = null;
          let operationFailed = false;
          let operationError: unknown;
          let operationResult = false;
          let settlementFailed = false;
          let settlementError: unknown;
          const assertCurrent = async (): Promise<void> => {
            if (!scopeActive) {
              throw new CreativeStudioStoreError('storage_error', 'Studio project deletion authority has expired');
            }
            await assertProjectSnapshotCurrentV2({ root, snapshot: inspected });
            const currentMarker = await readProjectDeletionMarkerV2(root, projectId);
            if (
              marker === null
                ? currentMarker !== null
                : currentMarker === null ||
                  currentMarker.bytes !== marker.bytes ||
                  !sameIdentityV2(currentMarker.identity, marker.identity)
            ) {
              throw new CreativeStudioStoreError('storage_error', 'Studio project deletion authority changed');
            }
          };
          try {
            operationResult = await operation({
              project: structuredClone(inspected.project),
              projectDir: inspected.directory.path,
              assertCurrent,
              delete: (revision, authorizeBeforeDelete) => {
                if (
                  !scopeActive ||
                  deleteUsed ||
                  revision !== expectedRevision ||
                  (authorizeBeforeDelete !== undefined && typeof authorizeBeforeDelete !== 'function')
                ) {
                  return Promise.reject(
                    new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project authority deletion')
                  );
                }
                deleteUsed = true;
                deletePromise = (async () => {
                  if (marker === null) {
                    return deleteSupportedProjectV2InsideQueue(root, inspected, revision, authorizeBeforeDelete);
                  }
                  await authorizeBeforeDelete?.();
                  await assertCurrent();
                  await finishProjectDeletionV2(root, marker);
                  return true;
                })().then((deleted) => {
                  projectDeleted = deleted;
                  return deleted;
                });
                return deletePromise;
              },
            });
          } catch (error) {
            operationFailed = true;
            operationError = error;
          } finally {
            try {
              try {
                await deletePromise;
              } catch (error) {
                if (!operationFailed) {
                  settlementFailed = true;
                  settlementError = error;
                }
              }
            } finally {
              scopeActive = false;
            }
          }
          if (operationFailed) throw operationError;
          if (settlementFailed) throw settlementError;
          return operationResult;
        });
      } catch (error) {
        if (projectDeleted) await repairSummaryV2AfterCommit();
        throw error;
      }
      if (projectDeleted) await repairSummaryV2AfterCommit();
      return result;
    },

    async deleteProjectV2(projectId: string, expectedRevision: number): Promise<boolean> {
      if (!isSafeIdV2(projectId)) return false;
      if (!isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      const deleted = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) return false;
        const existingMarker = await readProjectDeletionMarkerV2(root, projectId);
        if (existingMarker !== null) {
          if (existingMarker.record.expectedRevision !== expectedRevision) {
            throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
          }
          await finishProjectDeletionV2(root, existingMarker);
          return true;
        }
        const inspected = await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId);
        if (inspected.status === 'not_found') return false;
        if (inspected.status === 'unsupported_prototype_schema') {
          throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
        }
        if (inspected.status === 'malformed_v2') throw inspected.error;
        return deleteSupportedProjectV2InsideQueue(root, inspected, expectedRevision);
      });
      if (deleted) await repairSummaryV2AfterCommit();
      return deleted;
    },

    async listProposalsV2(projectId: string): Promise<StudioProposalV2[]> {
      return listProposalSidecarsV2(projectId);
    },

    async recordProposalV2(input: StudioRecordProposalInputV2): Promise<StudioProposalRecordV2> {
      return recordProposalSidecarV2(input);
    },

    async acceptProposalV2(projectId: string, proposalId: string): Promise<StudioProposalAcceptanceResultV2> {
      return acceptProposalSidecarV2(projectId, proposalId);
    },

    async rejectProposalV2(projectId: string, proposalId: string): Promise<StudioProposalV2> {
      return rejectProposalSidecarV2(projectId, proposalId);
    },

    async reapAbandonedProposalsV2(): Promise<void> {
      return reapAbandonedProposalSidecarsV2();
    },

    async watchProposalsV2(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>> {
      return watchProposalSidecarsV2(listener);
    },

    async watchBriefsV2(listener: (projectId: string) => void): Promise<() => Promise<void>> {
      const root = await writableCanonicalRootV2();
      let closed = false;
      const pending = new Map<string, Promise<void>>();
      const validateAndNotify = (relativeFile: string): void => {
        const segments = path.normalize(relativeFile).split(path.sep);
        if (segments.length !== 2 || !isSafeIdV2(segments[0]) || segments[1] !== STUDIO_BRIEF_FILE_NAME) return;
        const projectId = segments[0];
        const previous = pending.get(projectId) ?? Promise.resolve();
        const current = previous
          .catch((): undefined => undefined)
          .then(async () => {
            if (closed) return;
            const result = await inspectProjectThroughAttributionFenceV2(root, projectId);
            if (result.status === 'malformed_v2') throw result.error;
            if (!closed && result.status === 'supported') listener(projectId);
          })
          .catch((error: unknown) => {
            if (!closed) safeLogError('[CreativeStudio] Schema-2 Brief watcher ignored an invalid file', error);
          })
          .finally(() => {
            if (pending.get(projectId) === current) pending.delete(projectId);
          });
        pending.set(projectId, current);
      };
      let watcher: { close(): void };
      try {
        watcher = watchProposalTree({
          rootDir: root,
          onChange: (relativeFile) => {
            if (!closed) validateAndNotify(relativeFile);
          },
          onError: (error) => {
            if (!closed) safeLogError('[CreativeStudio] Schema-2 Brief watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Schema-2 Studio Brief watcher could not start');
      }
      return async (): Promise<void> => {
        if (closed) return;
        closed = true;
        watcher.close();
        await Promise.allSettled(pending.values());
      };
    },

    async resolveProposalPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }> {
      return resolveProposalSidecarPathsV2(projectId);
    },

    async listReferenceRequestsV2(projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]> {
      return listReferenceRequestSidecarsV2(projectId);
    },

    async decideReferenceRequestV2(
      input: StudioDecideReferenceRequestInputV2
    ): Promise<StudioReferenceRequestLedgerEntryV2> {
      return decideReferenceRequestSidecarV2(input);
    },

    async readReferenceGenerationHandoffV2(
      projectId: string,
      handoffId: string
    ): Promise<StudioReferenceGenerationHandoffStoreV2 | null> {
      return readReferenceGenerationHandoffSidecarV2(projectId, handoffId);
    },

    async recordReferenceGenerationHandoffReceiptV2(
      input: StudioRecordReferenceGenerationHandoffReceiptInputV2
    ): Promise<StudioReferenceGenerationHandoffStoreV2> {
      return recordReferenceGenerationHandoffReceiptSidecarV2(input);
    },

    async reapAbandonedReferenceRequestsV2(): Promise<void> {
      return reapAbandonedReferenceRequestSidecarsV2();
    },

    async watchReferenceRequestsV2(
      listener: (projectId: string, requestId: string) => void
    ): Promise<() => Promise<void>> {
      return watchReferenceRequestSidecarsV2(listener);
    },

    async resolveReferenceRequestPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }> {
      return resolveReferenceRequestSidecarPathsV2(projectId);
    },

    async getVerifiedProjectDirectoryV2(projectId: string): Promise<string | null> {
      if (!isSafeIdV2(projectId)) return null;
      const root = await existingCanonicalRootV2();
      if (root === null) return null;
      const inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      if (inspected.status === 'not_found') return null;
      if (inspected.status === 'unsupported_prototype_schema') {
        throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
      }
      if (inspected.status === 'malformed_v2') throw inspected.error;
      return inspected.directory.path;
    },

    async listConnections(): Promise<StudioConnectionBinding[]> {
      return connectionManifest.listConnections();
    },

    async saveConnection(binding: StudioConnectionBinding): Promise<StudioConnectionBinding> {
      return connectionManifest.saveConnection(binding);
    },

    async removeConnection(connectionId: string): Promise<boolean> {
      return connectionManifest.removeConnection(connectionId);
    },
  };
};
