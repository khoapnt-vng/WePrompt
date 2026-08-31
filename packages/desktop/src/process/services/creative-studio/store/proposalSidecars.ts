/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES,
  STUDIO_PROPOSAL_V2_PENDING_TTL_MS,
  type StudioProjectV2,
  type StudioProposalCommitAttributionV2,
  type StudioProposalDecisionV2,
  type StudioProposalRecordV2,
  type StudioProposalSlotV2,
  type StudioProposalV2,
  type StudioRecordProposalInputV2,
} from '@/common/types/project/creativeStudioTypes';
import { StudioProposalWriteError, writeProposalRecordV2 } from '@process/resources/builtinMcp/studioProposalWriter';
import {
  parseStudioProposalDecisionV2,
  parseStudioProposalRecordV2,
  parseStudioProposalSlotV2,
} from '../service/directorCommandContracts';
import { studioProposalOperationsV2 } from '../service/schema2/mutations/proposalReview';
import { applyStudioMutationBatchV2, validateStudioProjectV2 } from '../service/schema2';
import {
  CreativeStudioStoreError,
  type StudioProjectCommitFacts,
  type StudioProposalAcceptanceResultV2,
} from './contracts';
import type { StudioDirectoryAuthorityV2, StudioProjectFileInspectionV2 } from './projectTransactions';
import type { StudioIdentifiedRecordV2 } from './sidecarJournal';
import type { createStudioSidecarJournalV2 } from './sidecarJournal';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const STUDIO_PROJECT_V2_MAX_ID_LENGTH = 256;
const PROPOSAL_COMMIT_ATTRIBUTION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'proposalId',
  'projectId',
  'baseRevision',
  'appliedRevision',
  'beforeProjectSha256',
  'afterProjectSha256',
  'createdBeatIds',
  'createdShotIds',
  'authorizationId',
  'decidedAt',
]);
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const PROPOSAL_V2_DIRECTORY_NAMES = ['pending', 'decisions', 'slots', 'commits'] as const;
const PROPOSAL_V2_COMMIT_FILE_SUFFIX = '.json';

export const STUDIO_PROPOSAL_MAX_RECORD_BYTES = STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES;
export const STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT = STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT;
export const STUDIO_PROPOSAL_PENDING_TTL_MS = STUDIO_PROPOSAL_V2_PENDING_TTL_MS;
const STUDIO_PROPOSAL_STALE_SLOT_MS = 60 * 1_000;

type SupportedProjectInspectionV2 = Extract<StudioProjectFileInspectionV2, { status: 'supported' }>;
type ProjectFileInspectionV2 = StudioProjectFileInspectionV2;
type DirectoryAuthorityV2 = StudioDirectoryAuthorityV2;
type IdentifiedRecordV2<RecordType> = StudioIdentifiedRecordV2<RecordType>;

export type StudioProposalDirectoriesV2 = {
  root: StudioDirectoryAuthorityV2;
  pending: StudioDirectoryAuthorityV2;
  decisions: StudioDirectoryAuthorityV2;
  slots: StudioDirectoryAuthorityV2;
  commits: StudioDirectoryAuthorityV2;
  project: StudioDirectoryAuthorityV2;
};

export type StudioProposalLedgerV2 = {
  directories: StudioProposalDirectoriesV2;
  proposals: Map<string, IdentifiedRecordV2<StudioProposalRecordV2>>;
  decisions: Map<string, IdentifiedRecordV2<StudioProposalDecisionV2>>;
  slots: Map<string, IdentifiedRecordV2<StudioProposalSlotV2>[]>;
  attributions: IdentifiedRecordV2<StudioProposalCommitAttributionV2>[];
  journalResidues: Array<
    | {
        family: 'decisions';
        identified: IdentifiedRecordV2<StudioProposalDecisionV2>;
        namedFile: string;
        effective: boolean;
      }
    | {
        family: 'commits';
        identified: IdentifiedRecordV2<StudioProposalCommitAttributionV2>;
        namedFile: string;
        effective: boolean;
      }
  >;
  writerResidues: Array<{
    family: 'pending' | 'slots';
    identified: IdentifiedRecordV2<null>;
    namedFile: string;
    phase: 'tmp' | 'ready' | 'cleanup';
    effective: boolean;
  }>;
};

type ProposalDirectoriesV2 = StudioProposalDirectoriesV2;
type ProposalLedgerV2 = StudioProposalLedgerV2;

type ProposalWatcherV2 = (input: {
  rootDir: string;
  onChange: (relativeFile: string) => void;
  onError: (error: Error) => void;
}) => { close(): void };

type ProposalSidecarDepsV2 = {
  fs: typeof nodeFs;
  now: () => string;
  watchProposalTree: ProposalWatcherV2;
  safeLogError: (message: string, error: unknown) => void;
  storageError: (error: unknown, fallback: string) => CreativeStudioStoreError;
  enqueue: <T>(projectId: string, work: () => Promise<T>) => Promise<T>;
  existingCanonicalRoot: () => Promise<string | null>;
  writableCanonicalRoot: () => Promise<string>;
  inspectProjectFile: (root: string, projectId: string) => Promise<StudioProjectFileInspectionV2>;
  inspectProjectWithSidecarFences: (root: string, projectId: string) => Promise<StudioProjectFileInspectionV2>;
  requireSupportedProjectInspection: (inspection: StudioProjectFileInspectionV2) => SupportedProjectInspectionV2;
  assertProjectSnapshotCurrent: (input: { root: string; snapshot: SupportedProjectInspectionV2 }) => Promise<void>;
  serializeProjectForWrite: (project: StudioProjectV2, label: string) => string;
  writeProjectFiles: (input: {
    root: string;
    snapshot: SupportedProjectInspectionV2;
    project: StudioProjectV2;
    projectBytes: string;
    authorizeBeforeReplace?: () => Promise<void>;
  }) => Promise<void>;
  observeProjectCommit: (facts: StudioProjectCommitFacts) => void;
  repairSummaryAfterCommit: () => Promise<void>;
  listSupportedProjectIds: (root: string) => Promise<string[]>;
  sidecarJournal: ReturnType<typeof createStudioSidecarJournalV2>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isSafeIdV2 = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= STUDIO_PROJECT_V2_MAX_ID_LENGTH && SAFE_ID.test(value);
const isSafeProposalId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);
const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
const isCanonicalIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};
const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.size &&
    ownKeys.every((key) =>
      typeof key === 'string'
        ? keys.has(key) && Object.hasOwn(Reflect.getOwnPropertyDescriptor(value, key) ?? {}, 'value')
        : false
    )
  );
};
const isUniqueSafeIdArrayV2 = (value: unknown, maximum: number): value is string[] =>
  Array.isArray(value) && value.length <= maximum && value.every(isSafeIdV2) && new Set(value).size === value.length;
const validateProposalCommitAttributionV2 = (
  projectId: string,
  proposalId: string,
  value: unknown
): value is StudioProposalCommitAttributionV2 =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_COMMIT_ATTRIBUTION_KEYS) &&
  value.schemaVersion === STUDIO_PROPOSAL_SCHEMA_VERSION_V2 &&
  (value.kind === 'mutation' || value.kind === 'paid_recovery') &&
  value.proposalId === proposalId &&
  value.projectId === projectId &&
  isSafeProposalId(value.proposalId) &&
  isSafeIdV2(value.projectId) &&
  isIntegerInRange(value.baseRevision, 1, Number.MAX_SAFE_INTEGER - 1) &&
  value.appliedRevision === value.baseRevision + 1 &&
  typeof value.beforeProjectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.beforeProjectSha256) &&
  typeof value.afterProjectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.afterProjectSha256) &&
  isUniqueSafeIdArrayV2(value.createdBeatIds, STUDIO_MAX_BEATS) &&
  isUniqueSafeIdArrayV2(value.createdShotIds, STUDIO_MAX_SHOTS_PER_PROJECT) &&
  (value.kind === 'mutation'
    ? value.authorizationId === null
    : isSafeProposalId(value.authorizationId) &&
      value.createdBeatIds.length === 0 &&
      value.createdShotIds.length === 0) &&
  isCanonicalIsoTimestamp(value.decidedAt);

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');
const serializeJsonExact = (value: unknown): string => JSON.stringify(value, null, 2);
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const createStudioProposalSidecarsV2 = (deps: ProposalSidecarDepsV2) => {
  const {
    fs,
    now,
    watchProposalTree,
    safeLogError,
    storageError,
    enqueue,
    existingCanonicalRoot: existingCanonicalRootV2,
    writableCanonicalRoot: writableCanonicalRootV2,
    inspectProjectFile: inspectProjectFileV2,
    inspectProjectWithSidecarFences: inspectProjectWithAttributionFenceV2InsideQueue,
    requireSupportedProjectInspection: requireSupportedProjectInspectionV2,
    assertProjectSnapshotCurrent: assertProjectSnapshotCurrentV2,
    serializeProjectForWrite: serializeProjectV2ForWrite,
    writeProjectFiles: writeProjectFilesV2,
    observeProjectCommit,
    repairSummaryAfterCommit: repairSummaryV2AfterCommit,
    listSupportedProjectIds,
    sidecarJournal,
  } = deps;
  const {
    assertDirectoryAuthorityV2,
    assertIdentifiedRecordCurrentV2,
    assertPathAbsentV2,
    cleanupCapturedWriterResiduesV2,
    cleanupJournalPublicationResidueV2,
    isCanonicalV2SlotFileName,
    parseIdentifiedJsonV2,
    parseIdentityBoundCleanupNameV2,
    publishImmutableJournalRecordV2,
    quarantineRemoveIdentifiedRecordV2,
    readStableDirectoryEntriesV2,
    reconcileJournalPublicationResiduesV2,
    reconcileOwnedPendingPublicationResiduesV2,
    reconcileOwnedSlotCleanupResiduesV2,
    removeJournalPublicationCompanionV2,
    removeReadyPublicationCompanionV2,
    resolveCompleteSidecarDirectoryFamilyV2,
    sameIdentityV2,
  } = sidecarJournal;

  const resolveProposalDirectoriesV2 = async (input: {
    root: string;
    project: DirectoryAuthorityV2;
    createIfWhollyAbsent: boolean;
    snapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ProposalDirectoriesV2 | null> => {
    const resolved = await resolveCompleteSidecarDirectoryFamilyV2({
      root: input.root,
      project: input.project,
      rootName: 'proposals',
      childNames: PROPOSAL_V2_DIRECTORY_NAMES,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      authorizeBeforePublish:
        input.snapshot === undefined
          ? undefined
          : () => assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot! }),
      unavailableMessage: 'Schema-2 Studio proposal directories are unavailable',
    });
    if (resolved === null) return null;
    return {
      project: resolved.project,
      root: resolved.root,
      pending: resolved.children.pending,
      decisions: resolved.children.decisions,
      slots: resolved.children.slots,
      commits: resolved.children.commits,
    };
  };

  const assertProposalDirectoryAuthoritiesV2 = async (directories: ProposalDirectoriesV2): Promise<void> => {
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.commits),
    ]);
  };

  const parseAttributionRecordV2 = (
    projectId: string,
    proposalId: string,
    value: unknown
  ):
    | { status: 'valid'; record: StudioProposalCommitAttributionV2 }
    | { status: 'unsupported_prototype_schema' }
    | { status: 'invalid' } => {
    if (
      isRecord(value) &&
      Number.isSafeInteger(value.schemaVersion) &&
      (value.schemaVersion as number) >= 1 &&
      (value.schemaVersion as number) < STUDIO_PROPOSAL_SCHEMA_VERSION_V2
    ) {
      return { status: 'unsupported_prototype_schema' };
    }
    return validateProposalCommitAttributionV2(projectId, proposalId, value)
      ? { status: 'valid', record: value }
      : { status: 'invalid' };
  };

  const readProposalLedgerV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
  }): Promise<ProposalLedgerV2> => {
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const pendingResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.pending,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
      validateRecord: (namedBase, value) => {
        const proposalId = namedBase.slice(0, -'.json'.length);
        return parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }).status === 'valid';
      },
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotPublicationResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.slots,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) => isCanonicalV2SlotFileName(namedBase, STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT),
      validateRecord: (_namedBase, value) => parseStudioProposalSlotV2(value).status === 'valid',
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotCleanupResidues = await reconcileOwnedSlotCleanupResiduesV2({
      root: input.root,
      pending: input.directories.pending,
      slots: input.directories.slots,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      capacity: STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
      recordId: (slot: StudioProposalSlotV2) => slot.proposalId,
      validatePending: (proposalId, value) =>
        parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }).status === 'valid',
      parse: parseStudioProposalSlotV2,
      deferCleanup: true,
    });
    const [decisionResidues, attributionResidues] = await Promise.all([
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.decisions,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const proposalId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioProposalDecisionV2({ proposalId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.commits,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith(PROPOSAL_V2_COMMIT_FILE_SUFFIX) &&
          isSafeProposalId(namedBase.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length)),
        parseRecord: (namedBase, value) => {
          const proposalId = namedBase.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length);
          const parsed = parseAttributionRecordV2(input.projectId, proposalId, value);
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
    ]);
    const [rawPendingEntries, rawDecisionEntries, rawSlotEntries, rawCommitEntries] = await Promise.all([
      readStableDirectoryEntriesV2(input.directories.pending),
      readStableDirectoryEntriesV2(input.directories.decisions),
      readStableDirectoryEntriesV2(input.directories.slots),
      readStableDirectoryEntriesV2(input.directories.commits),
    ]);
    const decisionResidueNames = new Set(decisionResidues.map((residue) => path.basename(residue.identified.file)));
    const attributionResidueNames = new Set(
      attributionResidues.map((residue) => path.basename(residue.identified.file))
    );
    const pendingResidueNames = new Set(pendingResidues.map((record) => path.basename(record.identified.file)));
    const slotResidueNames = new Set([
      ...slotPublicationResidues.map((record) => path.basename(record.identified.file)),
      ...slotCleanupResidues.map((record) => path.basename(record.identified.file)),
    ]);
    const pendingEntries = rawPendingEntries.filter((entry) => !pendingResidueNames.has(entry.name));
    const slotEntries = rawSlotEntries.filter((entry) => !slotResidueNames.has(entry.name));
    const decisionEntries = rawDecisionEntries.filter((entry) => !decisionResidueNames.has(entry.name));
    const commitEntries = rawCommitEntries.filter((entry) => !attributionResidueNames.has(entry.name));
    const proposals = new Map<string, IdentifiedRecordV2<StudioProposalRecordV2>>();
    const decisions = new Map<string, IdentifiedRecordV2<StudioProposalDecisionV2>>();
    const slots = new Map<string, IdentifiedRecordV2<StudioProposalSlotV2>[]>();
    const attributions: IdentifiedRecordV2<StudioProposalCommitAttributionV2>[] = [];

    for (const entry of pendingEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal directory');
      }
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId) || proposals.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal identity');
      }
      // The proposal ledger is bounded by its slot family.
      // eslint-disable-next-line no-await-in-loop
      const proposal = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.pending.path, entry.name),
        parse: (value) => parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }),
      });
      proposals.set(proposalId, proposal);
    }
    for (const residue of pendingResidues) {
      if (!residue.effective) continue;
      const proposalId = path.basename(residue.namedFile, '.json');
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal recovery record');
      }
      const parsed = parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value });
      if (parsed.status !== 'valid' || proposals.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous schema-2 Studio proposal recovery record');
      }
      proposals.set(proposalId, { ...residue.identified, record: parsed.record });
    }
    for (const entry of decisionEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal decision directory');
      }
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId) || decisions.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal decision identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const decision = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.decisions.path, entry.name),
        parse: (value) => parseStudioProposalDecisionV2({ proposalId, value }),
      });
      decisions.set(proposalId, decision);
    }

    for (const entry of slotEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedSlot = cleanup?.namedFileName ?? entry.name;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !isCanonicalV2SlotFileName(namedSlot, STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot directory');
      }
      // eslint-disable-next-line no-await-in-loop
      const slot = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.slots.path, entry.name),
        quarantined,
        parse: parseStudioProposalSlotV2,
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(slot.identity, cleanup.identity) || sha256Utf8(slot.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal cleanup authority mismatch');
      }
      const held = slots.get(slot.record.proposalId) ?? [];
      held.push(slot);
      slots.set(slot.record.proposalId, held);
    }
    for (const residue of slotCleanupResidues) {
      if (!residue.effective) continue;
      const effective = { ...residue.identified, quarantined: false };
      const held = slots.get(effective.record.proposalId) ?? [];
      held.push(effective);
      slots.set(effective.record.proposalId, held);
    }
    for (const residue of slotPublicationResidues) {
      if (!residue.effective) continue;
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot recovery');
      }
      const parsed = parseStudioProposalSlotV2(value);
      if (parsed.status !== 'valid') {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot recovery');
      }
      const held = slots.get(parsed.record.proposalId) ?? [];
      held.push({ ...residue.identified, record: parsed.record });
      slots.set(parsed.record.proposalId, held);
    }

    for (const entry of commitEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedCommit = cleanup?.namedFileName ?? entry.name;
      if (!entry.isFile() || entry.isSymbolicLink() || !namedCommit.endsWith(PROPOSAL_V2_COMMIT_FILE_SUFFIX)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio proposal attribution directory');
      }
      const proposalId = namedCommit.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length);
      if (!isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio proposal attribution identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const attribution = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.commits.path, entry.name),
        quarantined,
        parse: (value) => parseAttributionRecordV2(input.projectId, proposalId, value),
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(attribution.identity, cleanup.identity) || sha256Utf8(attribution.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal cleanup authority mismatch');
      }
      attributions.push(attribution);
    }
    for (const residue of decisionResidues) {
      if (!residue.effective) continue;
      const proposalId = path.basename(residue.namedFile, '.json');
      if (decisions.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal decision publication');
      }
      decisions.set(proposalId, residue.identified);
    }
    for (const residue of attributionResidues) {
      if (residue.effective) attributions.push(residue.identified);
    }

    await assertProposalDirectoryAuthoritiesV2(input.directories);
    if (attributions.length > 1) {
      throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal commit attribution');
    }
    for (const [proposalId, decision] of decisions) {
      const proposal = proposals.get(proposalId);
      if (
        proposal === undefined ||
        decision.record.proposalId !== proposalId ||
        Date.parse(decision.record.decidedAt) < Date.parse(proposal.record.createdAt) ||
        (decision.record.status === 'expired' &&
          Date.parse(decision.record.decidedAt) <
            Date.parse(proposal.record.createdAt) + STUDIO_PROPOSAL_PENDING_TTL_MS)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision has no immutable proposal');
      }
    }
    for (const [proposalId, held] of slots) {
      if (held.length > 1) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal slot authority');
      }
      const proposal = proposals.get(proposalId);
      if (proposal !== undefined && decisions.get(proposalId) === undefined && held[0].quarantined) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal slot is quarantined');
      }
    }
    for (const proposalId of proposals.keys()) {
      if (decisions.has(proposalId)) continue;
      const held = slots.get(proposalId) ?? [];
      if (held.length !== 1 || held[0].quarantined) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal has no exact slot authority');
      }
    }
    const unresolvedCount = [...proposals.keys()].filter((proposalId) => !decisions.has(proposalId)).length;
    // Terminal proposal sources and decisions are immutable audit history. They are
    // deliberately excluded from the live admission cap and never turn an otherwise
    // readable project into a permanent storage error solely because history grew.
    if (unresolvedCount > STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal ledger exceeds its capacity');
    }
    return {
      directories: input.directories,
      proposals,
      decisions,
      slots,
      attributions,
      journalResidues: [
        ...decisionResidues.map((residue) => Object.assign({ family: `decisions` as const }, residue)),
        ...attributionResidues.map((residue) => Object.assign({ family: `commits` as const }, residue)),
      ],
      writerResidues: [
        ...pendingResidues.map((residue) => Object.assign({ family: `pending` as const }, residue)),
        ...slotPublicationResidues.map((residue) => Object.assign({ family: `slots` as const }, residue)),
        ...slotCleanupResidues.map(({ identified, namedFile }) => ({
          family: 'slots' as const,
          identified: { ...identified, record: null } as IdentifiedRecordV2<null>,
          namedFile,
          phase: 'cleanup' as const,
          effective: true,
        })),
      ],
    };
  };

  const assertProposalLedgerEntrySetCurrentV2 = async (
    ledger: ProposalLedgerV2,
    publication?: {
      decision?: IdentifiedRecordV2<null>;
      attribution?: IdentifiedRecordV2<null>;
    }
  ): Promise<void> => {
    const root = path.dirname(ledger.directories.project.path);
    const assertEntries = async (
      authority: DirectoryAuthorityV2,
      records: readonly IdentifiedRecordV2<unknown>[]
    ): Promise<void> => {
      const expected = new Map(records.map((record) => [path.basename(record.file), record]));
      const entries = await readStableDirectoryEntriesV2(authority);
      const observed = new Set<string>();
      for (const entry of entries) {
        const identified = expected.get(entry.name);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
        }
        if (identified === undefined) {
          const named = entry.name.endsWith('.publish')
            ? expected.get(entry.name.slice(0, -'.publish'.length))
            : undefined;
          if (named === undefined) {
            throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
          }
          // A just-published immutable journal may have its durable recovery twin before the
          // caller refreshes the ledger. Admit only the exact same inode and bytes.
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: { ...named, file: path.join(authority.path, entry.name) },
          });
          continue;
        }
        observed.add(entry.name);
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({ root, authority, identified });
      }
      if ([...expected.keys()].some((name) => !observed.has(name))) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
      }
      await assertDirectoryAuthorityV2(authority);
    };
    await Promise.all([
      assertEntries(ledger.directories.pending, [
        ...ledger.proposals.values(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'pending').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.decisions, [
        ...ledger.decisions.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'decisions')
          .map((residue) => residue.identified),
        ...(publication?.decision === undefined ? [] : [publication.decision]),
      ]),
      assertEntries(ledger.directories.slots, [
        ...[...ledger.slots.values()].flat(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'slots').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.commits, [
        ...ledger.attributions,
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'commits')
          .map((residue) => residue.identified),
        ...(publication?.attribution === undefined ? [] : [publication.attribution]),
      ]),
    ]);
    await assertProposalDirectoryAuthoritiesV2(ledger.directories);
  };

  const cleanupProposalJournalPublicationResiduesV2 = async (
    root: string,
    ledger: ProposalLedgerV2,
    authorizeProject: () => Promise<void>
  ): Promise<ProposalLedgerV2> => {
    const current: ProposalLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions),
      attributions: [...ledger.attributions],
      journalResidues: [...ledger.journalResidues],
    };
    for (const residue of ledger.journalResidues) {
      const authority = current.directories[residue.family];
      // eslint-disable-next-line no-await-in-loop -- publication recovery is deliberately lexical.
      await assertProposalLedgerEntrySetCurrentV2(current);
      if (residue.family === 'decisions') {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) current.decisions.set(residue.identified.record.proposalId, named);
      } else {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) {
          current.attributions = current.attributions.map((attribution) =>
            attribution.file === residue.identified.file ? named : attribution
          );
        }
      }
      current.journalResidues = current.journalResidues.map((candidate) =>
        candidate.identified.file === residue.identified.file ? { ...candidate, effective: false } : candidate
      );
    }
    return current;
  };

  const cleanupProposalWriterResiduesV2 = async (
    root: string,
    projectId: string,
    ledger: ProposalLedgerV2,
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>
  ): Promise<void> => {
    if (ledger.writerResidues.length === 0) return;
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    await cleanupCapturedWriterResiduesV2({
      root,
      pending: ledger.directories.pending,
      slots: ledger.directories.slots,
      residues: ledger.writerResidues,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      capacity: STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
      parseSlot: parseStudioProposalSlotV2,
      recordId: (slot) => slot.proposalId,
      validatePending: (proposalId, value) =>
        parseStudioProposalRecordV2({ projectId, proposalId, value }).status === 'valid',
      authorizeProject: () => assertProjectSnapshotCurrentV2({ root, snapshot: projectSnapshot }),
      recoveryAction: async (residue) => {
        if (residue.phase !== 'ready' || !residue.effective) return 'retain';
        if (residue.family === 'pending') {
          const proposalId = path.basename(residue.namedFile, '.json');
          const decision = ledger.decisions.get(proposalId);
          const counterpart = decision ?? ledger.slots.get(proposalId)?.[0];
          if (counterpart === undefined) return 'retain';
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: decision === undefined ? ledger.directories.slots : ledger.directories.decisions,
            identified: counterpart,
            maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          });
          return 'promote';
        }
        let value: unknown;
        try {
          value = JSON.parse(residue.identified.bytes) as unknown;
        } catch {
          return 'retain';
        }
        const parsed = parseStudioProposalSlotV2(value);
        if (parsed.status !== 'valid') return 'retain';
        const proposal = ledger.proposals.get(parsed.record.proposalId);
        const decision = ledger.decisions.get(parsed.record.proposalId);
        if (proposal === undefined) {
          await assertPathAbsentV2(path.join(ledger.directories.pending.path, `${parsed.record.proposalId}.json`));
          return 'rollback';
        }
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: ledger.directories.pending,
          identified: proposal,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
        });
        if (decision !== undefined) {
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: ledger.directories.decisions,
            identified: decision,
            maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          });
          return 'rollback';
        }
        return 'promote';
      },
    });
  };

  // eslint-disable-next-line unicorn/consistent-function-scoping -- co-located with its proposal state machine.
  const effectiveProposalV2 = (
    proposal: StudioProposalRecordV2,
    decision: StudioProposalDecisionV2 | undefined
  ): StudioProposalV2 =>
    decision === undefined
      ? proposal
      : {
          ...proposal,
          status: decision.status,
          decidedAt: decision.decidedAt,
        };

  // eslint-disable-next-line unicorn/consistent-function-scoping -- co-located with attribution validation.
  const operationCreatedIdentityOrderV2 = (input: {
    proposal: StudioProposalRecordV2;
    existingBeatIds?: ReadonlySet<string>;
    existingShotIds?: ReadonlySet<string>;
    createdBeatEvidence?: ReadonlySet<string>;
    createdShotEvidence?: ReadonlySet<string>;
  }): { createdBeatIds: string[]; createdShotIds: string[] } => {
    if (input.proposal.payload.kind !== 'mutation_batch') return { createdBeatIds: [], createdShotIds: [] };
    const beats = new Set(input.existingBeatIds ?? []);
    const shots = new Set(input.existingShotIds ?? []);
    const createdBeatIds: string[] = [];
    const createdShotIds: string[] = [];
    const considerBeat = (beatId: string): void => {
      const isCreated = input.createdBeatEvidence?.has(beatId) ?? !beats.has(beatId);
      if (isCreated && !createdBeatIds.includes(beatId)) createdBeatIds.push(beatId);
      beats.add(beatId);
    };
    const considerShot = (shotId: string): void => {
      const isCreated = input.createdShotEvidence?.has(shotId) ?? !shots.has(shotId);
      if (isCreated && !createdShotIds.includes(shotId)) createdShotIds.push(shotId);
      shots.add(shotId);
    };
    for (const operation of input.proposal.payload.operations) {
      if (operation.kind === 'add_beat' || operation.kind === 'add_binned_beat') considerBeat(operation.beatId);
      else if (operation.kind === 'add_shot') considerShot(operation.shotId);
      else if (operation.kind === 'apply_coverage') {
        for (const shot of operation.shots) considerShot(shot.shotId);
      }
    }
    return { createdBeatIds, createdShotIds };
  };

  // eslint-disable-next-line unicorn/consistent-function-scoping -- co-located with attribution validation.
  const sameOrderedIdsV2 = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((id, index) => id === right[index]);

  const assertAttributionCreatedIdsV2 = (input: {
    attribution: StudioProposalCommitAttributionV2;
    proposal: StudioProposalRecordV2;
    project: StudioProjectV2;
    state: 'before' | 'after';
  }): void => {
    if (input.attribution.kind === 'paid_recovery') {
      if (
        input.proposal.payload.kind !== 'paid_recovery' ||
        input.attribution.authorizationId === null ||
        input.attribution.createdBeatIds.length !== 0 ||
        input.attribution.createdShotIds.length !== 0
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery attribution scope mismatch');
      }
      const matching = input.project.spendAuthorizations.filter(
        (authorization) => authorization.id === input.attribution.authorizationId
      );
      if (input.state === 'before') {
        if (matching.length !== 0) {
          throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery authorization predates commit');
        }
      } else if (matching.length !== 1 || matching[0]?.confirmedAt !== input.attribution.decidedAt) {
        throw new CreativeStudioStoreError('storage_error', 'Studio paid-recovery authorization proof mismatch');
      }
      return;
    }
    if (input.proposal.payload.kind === 'paid_recovery' || input.attribution.authorizationId !== null) {
      throw new CreativeStudioStoreError('storage_error', 'Studio mutation attribution scope mismatch');
    }
    let expected: { createdBeatIds: string[]; createdShotIds: string[] };
    if (input.state === 'before') {
      expected = operationCreatedIdentityOrderV2({
        proposal: input.proposal,
        existingBeatIds: new Set(Object.keys(input.project.beats)),
        existingShotIds: new Set(Object.keys(input.project.shots)),
      });
    } else {
      const undo = input.project.undoHistory.at(-1);
      if (
        undo === undefined ||
        undo.id !== input.proposal.id ||
        undo.sourceRevision !== input.attribution.appliedRevision
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Studio proposal attribution has no matching undo authority'
        );
      }
      const createdBeatEvidence = new Set(
        undo.patches
          .filter((patch) => patch.kind === 'beat_fields' && patch.before === null)
          .map((patch) => (patch.kind === 'beat_fields' ? patch.beatId : ''))
      );
      const createdShotEvidence = new Set(
        undo.patches
          .filter((patch) => patch.kind === 'shot_fields' && patch.before === null)
          .map((patch) => (patch.kind === 'shot_fields' ? patch.shotId : ''))
      );
      expected = operationCreatedIdentityOrderV2({
        proposal: input.proposal,
        createdBeatEvidence,
        createdShotEvidence,
      });
      if (
        expected.createdBeatIds.length !== createdBeatEvidence.size ||
        expected.createdShotIds.length !== createdShotEvidence.size
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution created identities mismatch');
      }
    }
    if (
      !sameOrderedIdsV2(input.attribution.createdBeatIds, expected.createdBeatIds) ||
      !sameOrderedIdsV2(input.attribution.createdShotIds, expected.createdShotIds)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution created identities mismatch');
    }
  };

  const publishProposalDecisionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
    proposal: IdentifiedRecordV2<StudioProposalRecordV2>;
    status: StudioProposalDecisionV2['status'];
    decidedAt: string;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioProposalDecisionV2>> => {
    if (Date.parse(input.decidedAt) < Date.parse(input.proposal.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision predates its proposal');
    }
    const decision: StudioProposalDecisionV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      proposalId: input.proposal.record.id,
      status: input.status,
      decidedAt: input.decidedAt,
    };
    const file = path.join(input.directories.decisions.path, `${input.proposal.record.id}.json`);
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.directories.pending,
      identified: input.proposal,
    });
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.decisions,
      file,
      bytes: serializeJsonExact(decision),
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      parse: (value) => parseStudioProposalDecisionV2({ proposalId: decision.proposalId, value }),
    });
    if (
      published.record.status !== decision.status ||
      published.record.decidedAt !== decision.decidedAt ||
      published.bytes !== serializeJsonExact(decision)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal decision changed at publication');
    }
    return published;
  };

  const releaseProposalSlotV2 = async (input: {
    root: string;
    ledger: ProposalLedgerV2;
    proposal: IdentifiedRecordV2<StudioProposalRecordV2>;
    decision: IdentifiedRecordV2<StudioProposalDecisionV2>;
    slot: IdentifiedRecordV2<StudioProposalSlotV2> | undefined;
    projectSnapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<void> => {
    if (input.slot === undefined) return;
    const authorize = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(input.ledger.directories);
      if (input.projectSnapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      }
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.pending,
          identified: input.proposal,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.decisions,
          identified: input.decision,
        }),
      ]);
      if (input.projectSnapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      }
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
    });
  };

  const resolveProposalAttributionV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<Extract<ProjectFileInspectionV2, { status: 'supported' }>> => {
    const directories = await resolveProposalDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: false,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return input.snapshot;
    }
    let ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    const effectiveAcceptedDecisions = ledger.journalResidues.filter(
      (residue) =>
        residue.family === 'decisions' && residue.effective && residue.identified.record.status === 'accepted'
    );
    if (
      effectiveAcceptedDecisions.some((residue) => {
        const attribution = ledger.attributions[0]?.record;
        return (
          attribution === undefined ||
          attribution.proposalId !== residue.identified.record.proposalId ||
          attribution.decidedAt !== residue.identified.record.decidedAt
        );
      })
    ) {
      throw new CreativeStudioStoreError(
        'storage_error',
        'Studio accepted proposal decision has no exact commit attribution'
      );
    }
    if (ledger.attributions.length === 0) {
      ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
      );
      await Promise.all([
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
        assertProposalLedgerEntrySetCurrentV2(ledger),
      ]);
      if (ledger.writerResidues.length > 0) {
        await cleanupProposalWriterResiduesV2(input.root, input.projectId, ledger, input.snapshot);
        ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
        await Promise.all([
          assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
          assertProposalLedgerEntrySetCurrentV2(ledger),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      }
      return input.snapshot;
    }

    const identifiedAttribution = ledger.attributions[0];
    const attribution = identifiedAttribution.record;
    const proposal = ledger.proposals.get(attribution.proposalId);
    const decision = ledger.decisions.get(attribution.proposalId);
    const heldSlots = ledger.slots.get(attribution.proposalId) ?? [];
    const slot = heldSlots[0];
    if (
      proposal === undefined ||
      proposal.record.baseRevision !== attribution.baseRevision ||
      Date.parse(attribution.decidedAt) < Date.parse(proposal.record.createdAt) ||
      heldSlots.length !== 1 ||
      slot === undefined ||
      slot.record.proposalId !== attribution.proposalId ||
      slot.quarantined
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution authority mismatch');
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
      ...(decision === undefined
        ? []
        : [
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.decisions,
              identified: decision,
            }),
          ]),
    ]);
    await assertProposalDirectoryAuthoritiesV2(directories);

    const projectDigest = sha256Utf8(input.snapshot.bytes);
    const isExactBefore =
      input.snapshot.project.revision === attribution.baseRevision && projectDigest === attribution.beforeProjectSha256;
    const isExactAfter =
      input.snapshot.project.revision === attribution.appliedRevision &&
      projectDigest === attribution.afterProjectSha256;
    if (isExactBefore === isExactAfter) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution project facts mismatch');
    }

    if (isExactBefore) {
      if (decision !== undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Uncommitted Studio proposal has a terminal decision');
      }
      assertAttributionCreatedIdsV2({
        attribution,
        proposal: proposal.record,
        project: input.snapshot.project,
        state: 'before',
      });
      ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
      );
      await Promise.all([
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
        assertProposalLedgerEntrySetCurrentV2(ledger),
      ]);
      const cleanedAttribution = ledger.attributions[0];
      if (cleanedAttribution === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution disappeared during repair');
      }
      const authorize = async (): Promise<void> => {
        await assertProposalDirectoryAuthoritiesV2(directories);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
          assertPathAbsentV2(path.join(directories.decisions.path, `${attribution.proposalId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      };
      await removeJournalPublicationCompanionV2({
        root: input.root,
        authority: directories.commits,
        named: cleanedAttribution,
        maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
        authorize,
      });
      await quarantineRemoveIdentifiedRecordV2({
        root: input.root,
        authority: directories.commits,
        identified: cleanedAttribution,
        authorize,
      });
      const fresh = await inspectProjectFileV2(input.root, input.projectId);
      if (fresh.status !== 'supported') {
        throw new CreativeStudioStoreError('storage_error', 'Studio project authority changed during proposal repair');
      }
      const postRepairLedger = await readProposalLedgerV2({
        root: input.root,
        projectId: input.projectId,
        directories,
      });
      await assertProposalLedgerEntrySetCurrentV2(postRepairLedger);
      await cleanupProposalWriterResiduesV2(input.root, input.projectId, postRepairLedger, fresh);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: fresh });
      return fresh;
    }

    const effectiveDecisionResidue = ledger.journalResidues.some(
      (residue) =>
        residue.family === 'decisions' &&
        residue.effective &&
        residue.identified.record.proposalId === attribution.proposalId
    );
    if (
      input.snapshot.project.updatedAt !== attribution.decidedAt ||
      (identifiedAttribution.quarantined && (decision === undefined || effectiveDecisionResidue))
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Committed Studio proposal attribution timestamp mismatch');
    }
    assertAttributionCreatedIdsV2({
      attribution,
      proposal: proposal.record,
      project: input.snapshot.project,
      state: 'after',
    });
    let acceptedDecision = decision;
    if (acceptedDecision !== undefined) {
      if (
        acceptedDecision.record.status !== 'accepted' ||
        acceptedDecision.record.decidedAt !== attribution.decidedAt
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution decision mismatch');
      }
    }
    ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertProposalLedgerEntrySetCurrentV2(ledger),
    ]);
    const cleanedAttribution = ledger.attributions[0];
    if (cleanedAttribution === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution disappeared during repair');
    }
    acceptedDecision = ledger.decisions.get(attribution.proposalId);
    if (acceptedDecision === undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await assertProposalDirectoryAuthoritiesV2(directories);
      acceptedDecision = await publishProposalDecisionV2({
        root: input.root,
        projectId: input.projectId,
        directories,
        proposal,
        status: 'accepted',
        decidedAt: attribution.decidedAt,
        authorizeBeforeLink: async (temporary) => {
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          await assertProposalLedgerEntrySetCurrentV2(ledger, { decision: temporary });
          await Promise.all([
            assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
            assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.commits,
              identified: cleanedAttribution,
            }),
            assertPathAbsentV2(path.join(directories.decisions.path, `${attribution.proposalId}.json`)),
          ]);
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        },
      });
    }
    const resolvedLedger: ProposalLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions).set(attribution.proposalId, acceptedDecision),
    };
    await assertProposalLedgerEntrySetCurrentV2(resolvedLedger);

    const authorizeAttributionCleanup = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.decisions,
          identified: acceptedDecision,
        }),
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeJournalPublicationCompanionV2({
      root: input.root,
      authority: directories.commits,
      named: cleanedAttribution,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize: authorizeAttributionCleanup,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: directories.commits,
      identified: cleanedAttribution,
      authorize: authorizeAttributionCleanup,
    });
    const repairedLedger: ProposalLedgerV2 = { ...resolvedLedger, attributions: [] };
    await releaseProposalSlotV2({
      root: input.root,
      ledger: repairedLedger,
      proposal,
      decision: acceptedDecision,
      slot,
      projectSnapshot: input.snapshot,
    });
    const fresh = await inspectProjectFileV2(input.root, input.projectId);
    if (fresh.status !== 'supported') {
      throw new CreativeStudioStoreError('storage_error', 'Studio project authority changed during proposal repair');
    }
    const postRepairLedger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    await assertProposalLedgerEntrySetCurrentV2(postRepairLedger);
    await cleanupProposalWriterResiduesV2(input.root, input.projectId, postRepairLedger, fresh);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: fresh });
    return fresh;
  };

  const readCleanProposalLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<ProposalLedgerV2 | null> => {
    let snapshot = input.snapshot;
    let directories = await resolveProposalDirectoriesV2({
      root: input.root,
      project: snapshot.directory,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      snapshot,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot });
      return null;
    }
    let ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    if (ledger.attributions.length > 0) {
      snapshot = await resolveProposalAttributionV2InsideQueue({
        root: input.root,
        projectId: input.projectId,
        snapshot,
      });
      directories = await resolveProposalDirectoriesV2({
        root: input.root,
        project: snapshot.directory,
        createIfWhollyAbsent: false,
      });
      if (directories === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution removed its directory family');
      }
      ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
      if (ledger.attributions.length > 0) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution did not resolve');
      }
    }
    return ledger;
  };

  const assertPendingProposalSlotV2 = (
    ledger: ProposalLedgerV2,
    proposalId: string
  ): IdentifiedRecordV2<StudioProposalSlotV2> => {
    const held = ledger.slots.get(proposalId) ?? [];
    if (held.length !== 1 || held[0].quarantined) {
      throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal has no exact slot authority');
    }
    return held[0];
  };

  const cleanupOrphanProposalSlotV2 = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ProposalLedgerV2;
    slot: IdentifiedRecordV2<StudioProposalSlotV2>;
  }): Promise<void> => {
    const authorize = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertPathAbsentV2(path.join(input.ledger.directories.pending.path, `${input.slot.record.proposalId}.json`)),
        assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${input.slot.record.proposalId}.json`)),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
    });
  };

  const reapProposalLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ProposalLedgerV2;
  }): Promise<ProposalLedgerV2> => {
    if (input.ledger.attributions.length > 0) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution must resolve before reaping');
    }
    for (const [proposalId] of input.ledger.proposals) {
      if (!input.ledger.decisions.has(proposalId)) assertPendingProposalSlotV2(input.ledger, proposalId);
    }

    await assertProposalLedgerEntrySetCurrentV2(input.ledger);
    const currentTime = Date.parse(now());
    const cutoff = currentTime - STUDIO_PROPOSAL_PENDING_TTL_MS;
    const orphanSlotCutoff = currentTime - STUDIO_PROPOSAL_STALE_SLOT_MS;
    const decisions = new Map(input.ledger.decisions);
    const slots = new Map(input.ledger.slots);
    for (const [proposalId, proposal] of input.ledger.proposals) {
      let decision = decisions.get(proposalId);
      const slot = slots.get(proposalId)?.[0];
      if (decision === undefined && Date.parse(proposal.record.createdAt) <= cutoff) {
        const decidedAt = now();
        if (!isCanonicalIsoTimestamp(decidedAt)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
        }
        // The ledger was fully validated before the first terminal publication.
        // eslint-disable-next-line no-await-in-loop
        decision = await publishProposalDecisionV2({
          root: input.root,
          projectId: input.projectId,
          directories: input.ledger.directories,
          proposal,
          status: 'expired',
          decidedAt,
          authorizeBeforeLink: async (temporary) => {
            const effectiveLedger = { ...input.ledger, decisions, slots };
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
            await assertProposalLedgerEntrySetCurrentV2(effectiveLedger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.ledger.directories.pending,
                identified: proposal,
              }),
              ...(slot === undefined
                ? []
                : [
                    assertIdentifiedRecordCurrentV2({
                      root: input.root,
                      authority: input.ledger.directories.slots,
                      identified: slot,
                    }),
                  ]),
              assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${proposalId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          },
        });
        decisions.set(proposalId, decision);
      }
      if (decision !== undefined && slot !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotV2({
          root: input.root,
          ledger: { ...input.ledger, decisions, slots },
          proposal,
          decision,
          slot,
          projectSnapshot: input.snapshot,
        });
        slots.delete(proposalId);
      }
    }
    for (const [proposalId, held] of slots) {
      if (input.ledger.proposals.has(proposalId) || held.length !== 1) continue;
      const slot = held[0];
      if (Date.parse(slot.record.reservedAt) > orphanSlotCutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await cleanupOrphanProposalSlotV2({
        root: input.root,
        projectId: input.projectId,
        snapshot: input.snapshot,
        ledger: input.ledger,
        slot,
      });
      slots.delete(proposalId);
    }
    return { ...input.ledger, decisions, slots };
  };

  const listProposalsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<StudioProposalV2[]> => {
    const ledger = await readCleanProposalLedgerV2InsideQueue(input);
    if (ledger === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return [];
    }
    const reaped = await reapProposalLedgerV2InsideQueue({ ...input, ledger });
    const result = [...reaped.proposals.values()]
      .map((proposal) => effectiveProposalV2(proposal.record, reaped.decisions.get(proposal.record.id)?.record))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return result;
  };

  const listProposalsV2ThroughQueue = (projectId: string): Promise<StudioProposalV2[]> =>
    enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      return listProposalsV2InsideQueue({ root, projectId, snapshot, createIfWhollyAbsent: false });
    });

  const publishProposalAttributionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
    attribution: StudioProposalCommitAttributionV2;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioProposalCommitAttributionV2>> => {
    const file = path.join(input.directories.commits.path, `${input.attribution.proposalId}.json`);
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.commits,
      file,
      bytes: serializeJsonExact(input.attribution),
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      parse: (value) => parseAttributionRecordV2(input.projectId, input.attribution.proposalId, value),
    });
    if (published.bytes !== serializeJsonExact(input.attribution)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal commit attribution changed at publication');
    }
    return published;
  };

  const acceptProposalV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    proposalId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioProposalAcceptanceResultV2> => {
    let ledger = await readCleanProposalLedgerV2InsideQueue({ ...input, createIfWhollyAbsent: false });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
    ledger = await reapProposalLedgerV2InsideQueue({ ...input, ledger });
    const proposal = ledger.proposals.get(input.proposalId);
    if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
    const existingDecision = ledger.decisions.get(input.proposalId);
    if (existingDecision !== undefined) {
      if (existingDecision.record.status !== 'accepted') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
      }
      await releaseProposalSlotV2({
        root: input.root,
        ledger,
        proposal,
        decision: existingDecision,
        slot: ledger.slots.get(input.proposalId)?.[0],
        projectSnapshot: input.snapshot,
      });
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return {
        proposal: effectiveProposalV2(proposal.record, existingDecision.record),
        project: input.snapshot.project,
        applied: false,
      };
    }
    const slot = assertPendingProposalSlotV2(ledger, input.proposalId);
    if (proposal.record.payload.kind === 'paid_recovery') {
      throw new CreativeStudioStoreError(
        'invalid_payload',
        'Paid Studio recovery requires the renderer confirmation boundary'
      );
    }
    if (input.snapshot.project.revision !== proposal.record.baseRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const decidedAt = now();
    if (!isCanonicalIsoTimestamp(decidedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
    }
    if (Date.parse(decidedAt) < Date.parse(proposal.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision predates its proposal');
    }
    let operations;
    try {
      operations = studioProposalOperationsV2(input.snapshot.project, proposal.record);
    } catch {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal operations are invalid');
    }
    const applied = applyStudioMutationBatchV2(
      input.snapshot.project,
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: input.projectId,
        expectedRevision: proposal.record.baseRevision,
        operations,
      },
      { mutationId: proposal.record.id, capturedAt: proposal.record.createdAt }
    );
    const candidate: StudioProjectV2 = {
      ...applied.project,
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: proposal.record.baseRevision + 1,
      updatedAt: decidedAt,
    };
    if (!validateStudioProjectV2(candidate)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio proposal result');
    }
    const candidateBytes = serializeProjectV2ForWrite(candidate, 'Schema-2 Studio proposal result');
    const attribution: StudioProposalCommitAttributionV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      kind: 'mutation',
      proposalId: proposal.record.id,
      projectId: input.projectId,
      baseRevision: proposal.record.baseRevision,
      appliedRevision: candidate.revision,
      beforeProjectSha256: sha256Utf8(input.snapshot.bytes),
      afterProjectSha256: sha256Utf8(candidateBytes),
      createdBeatIds: [...applied.createdBeatIds],
      createdShotIds: [...applied.createdShotIds],
      authorizationId: null,
      decidedAt,
    };
    if (!validateProposalCommitAttributionV2(input.projectId, proposal.record.id, attribution)) {
      throw new CreativeStudioStoreError('storage_error', 'Invalid Studio proposal commit attribution');
    }
    assertAttributionCreatedIdsV2({
      attribution,
      proposal: proposal.record,
      project: input.snapshot.project,
      state: 'before',
    });
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await Promise.all([
      assertProposalDirectoryAuthoritiesV2(ledger.directories),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    const identifiedAttribution = await publishProposalAttributionV2({
      root: input.root,
      projectId: input.projectId,
      directories: ledger.directories,
      attribution,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertProposalLedgerEntrySetCurrentV2(ledger, { attribution: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
          }),
          assertPathAbsentV2(path.join(ledger.directories.commits.path, `${proposal.record.id}.json`)),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    const durableAttribution = identifiedAttribution.record;
    const attributedLedger: ProposalLedgerV2 = { ...ledger, attributions: [identifiedAttribution] };
    await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    await writeProjectFilesV2({
      root: input.root,
      snapshot: input.snapshot,
      project: candidate,
      projectBytes: candidateBytes,
      authorizeBeforeReplace: async () => {
        await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
        await assertProposalDirectoryAuthoritiesV2(ledger.directories);
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.commits,
            identified: identifiedAttribution,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
      },
    });
    const committed = requireSupportedProjectInspectionV2(await inspectProjectFileV2(input.root, input.projectId));
    if (
      committed.bytes !== candidateBytes ||
      sha256Utf8(committed.bytes) !== durableAttribution.afterProjectSha256 ||
      !sameIdentityV2(committed.directory, input.snapshot.directory)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal project publication changed');
    }
    await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    const decision = await publishProposalDecisionV2({
      root: input.root,
      projectId: input.projectId,
      directories: ledger.directories,
      proposal,
      status: 'accepted',
      decidedAt: durableAttribution.decidedAt,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
        await assertProposalLedgerEntrySetCurrentV2(attributedLedger, { decision: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.commits,
            identified: identifiedAttribution,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
          }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
      },
    });
    const decidedLedger: ProposalLedgerV2 = {
      ...attributedLedger,
      decisions: new Map(attributedLedger.decisions).set(input.proposalId, decision),
    };
    await assertProposalLedgerEntrySetCurrentV2(decidedLedger);
    const authorizeAttributionCleanup = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.pending,
          identified: proposal,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.decisions,
          identified: decision,
        }),
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
    };
    await removeJournalPublicationCompanionV2({
      root: input.root,
      authority: ledger.directories.commits,
      named: identifiedAttribution,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize: authorizeAttributionCleanup,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: ledger.directories.commits,
      identified: identifiedAttribution,
      authorize: authorizeAttributionCleanup,
    });
    await releaseProposalSlotV2({
      root: input.root,
      ledger: { ...decidedLedger, attributions: [] },
      proposal,
      decision,
      slot,
      projectSnapshot: committed,
    });
    observeProjectCommit(
      Object.freeze({
        projectId: input.projectId,
        previousRevision: proposal.record.baseRevision,
        committedRevision: candidate.revision,
        committedAt: decidedAt,
        commitTag: `proposal:${proposal.record.id}`,
      })
    );
    return { proposal: effectiveProposalV2(proposal.record, decision.record), project: candidate, applied: true };
  };

  const listProposalsV2 = async (projectId: string): Promise<StudioProposalV2[]> => {
    if (!isSafeIdV2(projectId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal project identity');
    }
    return listProposalsV2ThroughQueue(projectId);
  };

  const recordProposalV2 = async (input: StudioRecordProposalInputV2): Promise<StudioProposalRecordV2> => {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, new Set(['projectId', 'proposalId', 'baseRevision', 'payload'])) ||
      !isSafeIdV2(input.projectId) ||
      !isSafeProposalId(input.proposalId) ||
      !isIntegerInRange(input.baseRevision, 1, Number.MAX_SAFE_INTEGER) ||
      !isRecord(input.payload)
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal record request');
    }
    return enqueue(input.projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, input.projectId)
      );
      if (snapshot.project.revision !== input.baseRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      const directories = await resolveProposalDirectoriesV2({
        root,
        project: snapshot.directory,
        createIfWhollyAbsent: true,
        snapshot,
      });
      if (directories === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal storage is unavailable');
      }
      const currentLedger = await readCleanProposalLedgerV2InsideQueue({
        root,
        projectId: input.projectId,
        snapshot,
        createIfWhollyAbsent: true,
      });
      const existing = currentLedger?.proposals.get(input.proposalId)?.record;
      if (existing !== undefined) {
        if (
          existing.baseRevision !== input.baseRevision ||
          !sameJson(existing.payload, input.payload) ||
          existing.status !== 'pending'
        ) {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal identity collision');
        }
        return structuredClone(existing);
      }
      let record: StudioProposalRecordV2;
      try {
        record = await writeProposalRecordV2({
          pendingDir: directories.pending.path,
          projectId: input.projectId,
          baseRevision: input.baseRevision,
          payload: structuredClone(input.payload),
          proposalId: input.proposalId,
          fs,
          now: () => new Date(now()),
          projectAuthority: {
            canonicalRoot: snapshot.directory.path,
            rootIdentity: { dev: snapshot.directory.dev, ino: snapshot.directory.ino },
          },
          authorityFence: async () => {
            try {
              await Promise.all([
                assertProposalDirectoryAuthoritiesV2(directories),
                assertProjectSnapshotCurrentV2({ root, snapshot }),
              ]);
              return 'valid';
            } catch {
              return 'invalid';
            }
          },
        });
      } catch (error) {
        if (error instanceof StudioProposalWriteError && error.code === 'capacity') {
          throw new CreativeStudioStoreError('busy', 'Studio proposal inbox is full');
        }
        if (error instanceof StudioProposalWriteError && error.code === 'too_large') {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal exceeds the size cap');
        }
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal could not be recorded');
      }
      await assertProjectSnapshotCurrentV2({ root, snapshot });
      const finalLedger = await readCleanProposalLedgerV2InsideQueue({
        root,
        projectId: input.projectId,
        snapshot,
        createIfWhollyAbsent: false,
      });
      const durable = finalLedger?.proposals.get(input.proposalId)?.record;
      if (durable === undefined || !sameJson(durable, record)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication changed');
      }
      return structuredClone(durable);
    });
  };

  const acceptProposalV2 = async (projectId: string, proposalId: string): Promise<StudioProposalAcceptanceResultV2> => {
    if (!isSafeIdV2(projectId) || !isSafeProposalId(proposalId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
    }
    const accepted = await enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      return acceptProposalV2InsideQueue({ root, projectId, proposalId, snapshot });
    });
    await repairSummaryV2AfterCommit();
    return accepted;
  };

  const rejectProposalV2 = async (projectId: string, proposalId: string): Promise<StudioProposalV2> => {
    if (!isSafeIdV2(projectId) || !isSafeProposalId(proposalId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
    }
    return enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      let ledger = await readCleanProposalLedgerV2InsideQueue({
        root,
        projectId,
        snapshot,
        createIfWhollyAbsent: false,
      });
      if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
      ledger = await reapProposalLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
      const proposal = ledger.proposals.get(proposalId);
      if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
      let decision = ledger.decisions.get(proposalId);
      if (decision !== undefined) {
        if (decision.record.status !== 'rejected') {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
        }
        await releaseProposalSlotV2({
          root,
          ledger,
          proposal,
          decision,
          slot: ledger.slots.get(proposalId)?.[0],
          projectSnapshot: snapshot,
        });
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        return effectiveProposalV2(proposal.record, decision.record);
      }
      const slot = assertPendingProposalSlotV2(ledger, proposalId);
      const decidedAt = now();
      if (!isCanonicalIsoTimestamp(decidedAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
      }
      decision = await publishProposalDecisionV2({
        root,
        projectId,
        directories: ledger.directories,
        proposal,
        status: 'rejected',
        decidedAt,
        authorizeBeforeLink: async (temporary) => {
          await assertProjectSnapshotCurrentV2({ root, snapshot });
          await assertProposalLedgerEntrySetCurrentV2(ledger, { decision: temporary });
          await Promise.all([
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
            assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposalId}.json`)),
          ]);
          await assertProjectSnapshotCurrentV2({ root, snapshot });
        },
      });
      await releaseProposalSlotV2({
        root,
        ledger: { ...ledger, decisions: new Map(ledger.decisions).set(proposalId, decision) },
        proposal,
        decision,
        slot,
        projectSnapshot: snapshot,
      });
      await assertProjectSnapshotCurrentV2({ root, snapshot });
      return effectiveProposalV2(proposal.record, decision.record);
    });
  };

  const reapAbandonedProposalsV2 = async (): Promise<void> => {
    const root = await existingCanonicalRootV2();
    if (root === null) return;
    const supportedProjectIds = await listSupportedProjectIds(root);
    await Promise.all(
      supportedProjectIds.map((projectId) =>
        enqueue(projectId, async () => {
          const snapshot = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
          );
          const ledger = await readCleanProposalLedgerV2InsideQueue({
            root,
            projectId,
            snapshot,
            createIfWhollyAbsent: false,
          });
          if (ledger !== null) {
            await reapProposalLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
          }
        })
      )
    );
  };

  const watchProposalsV2 = async (
    listener: (projectId: string, proposalId: string) => void
  ): Promise<() => Promise<void>> => {
    const root = await writableCanonicalRootV2();
    let closed = false;
    const observedStatuses = new Map<string, StudioProposalV2['status']>();
    const validateAndNotify = async (relativeFile: string): Promise<void> => {
      const segments = path.normalize(relativeFile).split(path.sep);
      if (
        segments.length !== 4 ||
        !isSafeIdV2(segments[0]) ||
        segments[1] !== 'proposals' ||
        (segments[2] !== 'pending' && segments[2] !== 'decisions') ||
        !segments[3].endsWith('.json')
      ) {
        return;
      }
      const projectId = segments[0];
      const proposalId = segments[3].slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId)) return;
      try {
        const proposal = (await listProposalsV2ThroughQueue(projectId)).find(
          (candidate) => candidate.id === proposalId
        );
        if (closed || proposal === undefined) return;
        const key = `${projectId}:${proposalId}`;
        if (observedStatuses.get(key) === proposal.status) return;
        observedStatuses.set(key, proposal.status);
        listener(projectId, proposalId);
      } catch (error) {
        if (!closed) safeLogError('[CreativeStudio] Schema-2 proposal watcher ignored an invalid record', error);
      }
    };
    let watcher: { close(): void };
    try {
      watcher = watchProposalTree({
        rootDir: root,
        onChange: (relativeFile) => {
          if (!closed) void validateAndNotify(relativeFile);
        },
        onError: (error) => {
          if (!closed) safeLogError('[CreativeStudio] Schema-2 proposal watcher failed', error);
        },
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal watcher could not start');
    }
    return async (): Promise<void> => {
      if (closed) return;
      closed = true;
      watcher.close();
    };
  };

  const resolveProposalPathsV2 = async (projectId: string): Promise<{ projectDir: string; pendingDir: string }> => {
    if (!isSafeIdV2(projectId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal project identity');
    }
    return enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      const directories = await resolveProposalDirectoriesV2({
        root,
        project: snapshot.directory,
        createIfWhollyAbsent: true,
        snapshot,
      });
      if (directories === null) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal storage is unavailable');
      }
      return { projectDir: snapshot.directory.path, pendingDir: directories.pending.path };
    });
  };

  return {
    acceptProposalV2,
    assertAttributionCreatedIdsV2,
    assertPendingProposalSlotV2,
    assertProposalDirectoryAuthoritiesV2,
    assertProposalLedgerEntrySetCurrentV2,
    listProposalsV2,
    publishProposalAttributionV2,
    readCleanProposalLedgerV2InsideQueue,
    reapAbandonedProposalsV2,
    reapProposalLedgerV2InsideQueue,
    recordProposalV2,
    rejectProposalV2,
    resolveProposalAttributionV2InsideQueue,
    resolveProposalPathsV2,
    validateProposalCommitAttributionV2,
    watchProposalsV2,
  };
};
