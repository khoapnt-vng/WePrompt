/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  type StudioProjectV2,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestSlotV2,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  parseStudioReferenceGenerationHandoffReceiptV2,
  parseStudioReferenceRequestDecisionV2,
  parseStudioReferenceRequestSlotV2,
  parseStudioReferenceRequestV2,
} from '../service/director/contracts';
import {
  CreativeStudioStoreError,
  type StudioDecideReferenceRequestInputV2,
  type StudioProjectConfirmationInputV2,
  type StudioProjectConfirmationResultV2,
  type StudioRecordReferenceGenerationHandoffReceiptInputV2,
  type StudioReferenceDecisionIntentV2,
  type StudioReferenceGenerationHandoffConfirmationInputV2,
  type StudioReferenceGenerationHandoffStoreV2,
  type StudioReferenceRequestLedgerEntryV2,
} from './contracts';
import type { StudioDirectoryAuthorityV2, StudioProjectFileInspectionV2 } from './projectTransactions';
import { type createStudioSidecarJournalV2, type StudioIdentifiedRecordV2 } from './sidecarJournal';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const STUDIO_PROJECT_V2_MAX_ID_LENGTH = 256;
const REFERENCE_REQUEST_V2_DIRECTORY_NAMES = ['pending', 'decisions', 'slots', 'receipts'] as const;
const REFERENCE_DECIDE_INPUT_KEYS = new Set(['projectId', 'requestId', 'expectedRevision', 'outcome']);
const REFERENCE_REJECTED_INTENT_KEYS = new Set(['kind']);
const REFERENCE_RECEIPT_INPUT_KEYS = new Set(['projectId', 'handoffId', 'expectedRevision', 'result']);
const REFERENCE_DISMISSED_RESULT_KEYS = new Set(['kind']);
const REFERENCE_CONFIRMED_RESULT_KEYS = new Set(['kind', 'authorizationId']);
const REFERENCE_REQUEST_STALE_SLOT_MS = 60 * 1_000;

type SupportedProjectInspectionV2 = Extract<StudioProjectFileInspectionV2, { status: 'supported' }>;
type ProjectFileInspectionV2 = StudioProjectFileInspectionV2;
type DirectoryAuthorityV2 = StudioDirectoryAuthorityV2;
type IdentifiedRecordV2<RecordType> = StudioIdentifiedRecordV2<RecordType>;

type StudioReferenceGenerationDecisionV2 = StudioReferenceRequestDecisionV2 & {
  outcome: Extract<StudioReferenceRequestDecisionV2['outcome'], { kind: 'generation_gate' }>;
};

type StudioReferenceRequestDirectoriesV2 = {
  root: DirectoryAuthorityV2;
  pending: DirectoryAuthorityV2;
  decisions: DirectoryAuthorityV2;
  slots: DirectoryAuthorityV2;
  receipts: DirectoryAuthorityV2;
  project: DirectoryAuthorityV2;
};

type StudioReferenceRequestLedgerV2 = {
  directories: StudioReferenceRequestDirectoriesV2;
  requests: Map<string, IdentifiedRecordV2<StudioReferenceRequestV2>>;
  decisions: Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>;
  slots: Map<string, IdentifiedRecordV2<StudioReferenceRequestSlotV2>[]>;
  receipts: Map<string, IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>>;
  generationDecisions: Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>;
  journalResidues: Array<
    | {
        family: 'decisions';
        identified: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
        namedFile: string;
        effective: boolean;
      }
    | {
        family: 'receipts';
        identified: IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>;
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

type ReferenceRequestDirectoriesV2 = StudioReferenceRequestDirectoriesV2;
type ReferenceRequestLedgerV2 = StudioReferenceRequestLedgerV2;

type ReferenceWatcherV2 = (input: {
  rootDir: string;
  onChange: (relativeFile: string) => void;
  onError: (error: Error) => void;
}) => { close(): void };

type ReferenceSidecarDepsV2 = {
  now: () => string;
  createId: () => string;
  watchReferenceTree: ReferenceWatcherV2;
  safeLogError: (message: string, error: unknown) => void;
  storageError: (error: unknown, fallback: string) => CreativeStudioStoreError;
  enqueue: <T>(projectId: string, work: () => Promise<T>) => Promise<T>;
  existingCanonicalRoot: () => Promise<string | null>;
  writableCanonicalRoot: () => Promise<string>;
  inspectProjectFile: (root: string, projectId: string) => Promise<ProjectFileInspectionV2>;
  inspectProjectWithSidecarFences: (root: string, projectId: string) => Promise<ProjectFileInspectionV2>;
  requireSupportedProjectInspection: (inspection: ProjectFileInspectionV2) => SupportedProjectInspectionV2;
  assertProjectSnapshotCurrent: (input: { root: string; snapshot: SupportedProjectInspectionV2 }) => Promise<void>;
  assertSynchronousResult: (value: unknown, label: string) => void;
  listSupportedProjectIds: (root: string) => Promise<string[]>;
  repairSummaryAfterCommit: () => Promise<void>;
  confirmProjectInsideQueue: <TRevalidation, TDispatch>(
    root: string,
    inspection: SupportedProjectInspectionV2,
    input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>,
    authorizeBeforePersistence?: (candidate: StudioProjectV2) => Promise<void>
  ) => Promise<StudioProjectConfirmationResultV2<TDispatch>>;
  sidecarJournal: ReturnType<typeof createStudioSidecarJournalV2>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isSafeIdV2 = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= STUDIO_PROJECT_V2_MAX_ID_LENGTH && SAFE_ID.test(value);
const isSafeProposalId = isSafeIdV2;
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
const serializeJsonExact = (value: unknown): string => JSON.stringify(value, null, 2);
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');
export const createStudioReferenceSidecarsV2 = (deps: ReferenceSidecarDepsV2) => {
  const {
    now,
    createId,
    watchReferenceTree: watchProposalTree,
    safeLogError,
    storageError,
    enqueue,
    existingCanonicalRoot: existingCanonicalRootV2,
    writableCanonicalRoot: writableCanonicalRootV2,
    inspectProjectFile: inspectProjectFileV2,
    inspectProjectWithSidecarFences: inspectProjectWithAttributionFenceV2InsideQueue,
    requireSupportedProjectInspection: requireSupportedProjectInspectionV2,
    assertProjectSnapshotCurrent: assertProjectSnapshotCurrentV2,
    assertSynchronousResult: assertSynchronousConfirmationResult,
    listSupportedProjectIds,
    repairSummaryAfterCommit: repairSummaryV2AfterCommit,
    confirmProjectInsideQueue: confirmProjectV2InsideQueue,
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
    removeReadyPublicationCompanionV2,
    resolveCompleteSidecarDirectoryFamilyV2,
    sameIdentityV2,
  } = sidecarJournal;

  const resolveReferenceRequestDirectoriesV2 = async (input: {
    root: string;
    project: DirectoryAuthorityV2;
    createIfWhollyAbsent: boolean;
    snapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ReferenceRequestDirectoriesV2 | null> => {
    const resolved = await resolveCompleteSidecarDirectoryFamilyV2({
      root: input.root,
      project: input.project,
      rootName: 'reference-requests',
      childNames: REFERENCE_REQUEST_V2_DIRECTORY_NAMES,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      authorizeBeforePublish:
        input.snapshot === undefined
          ? undefined
          : () => assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot! }),
      unavailableMessage: 'Schema-2 Studio reference request directories are unavailable',
    });
    if (resolved === null) return null;
    return {
      project: resolved.project,
      root: resolved.root,
      pending: resolved.children.pending,
      decisions: resolved.children.decisions,
      slots: resolved.children.slots,
      receipts: resolved.children.receipts,
    };
  };

  const assertReferenceRequestDirectoryAuthoritiesV2 = async (
    directories: ReferenceRequestDirectoriesV2
  ): Promise<void> => {
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.receipts),
    ]);
  };

  const readReferenceRequestLedgerV2 = async (input: {
    root: string;
    projectId: string;
    directories: ReferenceRequestDirectoriesV2;
  }): Promise<ReferenceRequestLedgerV2> => {
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const pendingResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.pending,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
      validateRecord: (namedBase, value) => {
        const requestId = namedBase.slice(0, -'.json'.length);
        return parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }).status === 'valid';
      },
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotPublicationResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.slots,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        isCanonicalV2SlotFileName(namedBase, STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT),
      validateRecord: (_namedBase, value) => parseStudioReferenceRequestSlotV2(value).status === 'valid',
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotCleanupResidues = await reconcileOwnedSlotCleanupResiduesV2({
      root: input.root,
      pending: input.directories.pending,
      slots: input.directories.slots,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      capacity: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      recordId: (slot: StudioReferenceRequestSlotV2) => slot.requestId,
      validatePending: (requestId, value) =>
        parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }).status === 'valid',
      parse: parseStudioReferenceRequestSlotV2,
      deferCleanup: true,
    });
    const [decisionResidues, receiptResidues] = await Promise.all([
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.decisions,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const requestId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioReferenceRequestDecisionV2({ projectId: input.projectId, requestId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.receipts,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const handoffId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioReferenceGenerationHandoffReceiptV2({ handoffId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
    ]);
    const [rawPendingEntries, rawDecisionEntries, rawSlotEntries, rawReceiptEntries] = await Promise.all([
      readStableDirectoryEntriesV2(input.directories.pending),
      readStableDirectoryEntriesV2(input.directories.decisions),
      readStableDirectoryEntriesV2(input.directories.slots),
      readStableDirectoryEntriesV2(input.directories.receipts),
    ]);
    const decisionResidueNames = new Set(decisionResidues.map((residue) => path.basename(residue.identified.file)));
    const receiptResidueNames = new Set(receiptResidues.map((residue) => path.basename(residue.identified.file)));
    const pendingResidueNames = new Set(pendingResidues.map((record) => path.basename(record.identified.file)));
    const slotResidueNames = new Set([
      ...slotPublicationResidues.map((record) => path.basename(record.identified.file)),
      ...slotCleanupResidues.map((record) => path.basename(record.identified.file)),
    ]);
    const pendingEntries = rawPendingEntries.filter((entry) => !pendingResidueNames.has(entry.name));
    const slotEntries = rawSlotEntries.filter((entry) => !slotResidueNames.has(entry.name));
    const decisionEntries = rawDecisionEntries.filter((entry) => !decisionResidueNames.has(entry.name));
    const receiptEntries = rawReceiptEntries.filter((entry) => !receiptResidueNames.has(entry.name));
    const requests = new Map<string, IdentifiedRecordV2<StudioReferenceRequestV2>>();
    const decisions = new Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>();
    const slots = new Map<string, IdentifiedRecordV2<StudioReferenceRequestSlotV2>[]>();
    const receipts = new Map<string, IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>>();
    const generationDecisions = new Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>();

    for (const entry of pendingEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio reference request directory');
      }
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId) || requests.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio reference request identity');
      }
      // The reference request ledger is bounded by its slot family.
      // eslint-disable-next-line no-await-in-loop
      const request = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.pending.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }),
      });
      requests.set(requestId, request);
    }
    for (const residue of pendingResidues) {
      if (!residue.effective) continue;
      const requestId = path.basename(residue.namedFile, '.json');
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request recovery record');
      }
      const parsed = parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value });
      if (parsed.status !== 'valid' || requests.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference request recovery record');
      }
      requests.set(requestId, { ...residue.identified, record: parsed.record });
    }
    for (const entry of decisionEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request decision directory');
      }
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId) || decisions.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request decision identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const decision = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.decisions.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceRequestDecisionV2({ projectId: input.projectId, requestId, value }),
      });
      decisions.set(requestId, decision);
    }

    for (const entry of slotEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedSlot = cleanup?.namedFileName ?? entry.name;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !isCanonicalV2SlotFileName(namedSlot, STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request slot directory');
      }
      // eslint-disable-next-line no-await-in-loop
      const slot = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.slots.path, entry.name),
        quarantined,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: parseStudioReferenceRequestSlotV2,
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(slot.identity, cleanup.identity) || sha256Utf8(slot.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference cleanup authority mismatch');
      }
      const held = slots.get(slot.record.requestId) ?? [];
      held.push(slot);
      slots.set(slot.record.requestId, held);
    }
    for (const residue of slotCleanupResidues) {
      if (!residue.effective) continue;
      const effective = { ...residue.identified, quarantined: false };
      const held = slots.get(effective.record.requestId) ?? [];
      held.push(effective);
      slots.set(effective.record.requestId, held);
    }
    for (const residue of slotPublicationResidues) {
      if (!residue.effective) continue;
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference slot recovery record');
      }
      const parsed = parseStudioReferenceRequestSlotV2(value);
      if (parsed.status !== 'valid') {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference slot recovery record');
      }
      const held = slots.get(parsed.record.requestId) ?? [];
      held.push({ ...residue.identified, record: parsed.record });
      slots.set(parsed.record.requestId, held);
    }

    for (const entry of receiptEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference handoff receipt directory');
      }
      const handoffId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(handoffId) || receipts.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference handoff receipt identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const receipt = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.receipts.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceGenerationHandoffReceiptV2({ handoffId, value }),
      });
      receipts.set(handoffId, receipt);
    }
    for (const residue of decisionResidues) {
      if (!residue.effective) continue;
      const requestId = path.basename(residue.namedFile, '.json');
      if (decisions.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference decision publication');
      }
      decisions.set(requestId, residue.identified);
    }
    for (const residue of receiptResidues) {
      if (!residue.effective) continue;
      const handoffId = path.basename(residue.namedFile, '.json');
      if (receipts.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference receipt publication');
      }
      receipts.set(handoffId, residue.identified);
    }

    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    for (const [requestId, decision] of decisions) {
      const request = requests.get(requestId);
      if (request === undefined || decision.record.requestId !== requestId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision has no immutable request');
      }
      if (Date.parse(decision.record.decidedAt) < Date.parse(request.record.createdAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision predates its request');
      }
      if (
        decision.record.outcome.kind === 'expired' &&
        Date.parse(decision.record.decidedAt) <
          Date.parse(request.record.createdAt) + STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision expires its request early');
      }
      if (decision.record.outcome.kind === 'generation_gate') {
        const outcome = decision.record.outcome;
        if (
          outcome.referenceIds.length !== request.record.referenceIds.length ||
          !outcome.referenceIds.every((referenceId, index) => referenceId === request.record.referenceIds[index]) ||
          generationDecisions.has(outcome.handoffId)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference generation handoff');
        }
        generationDecisions.set(outcome.handoffId, decision);
      }
    }
    for (const [handoffId, receipt] of receipts) {
      const decision = generationDecisions.get(handoffId);
      if (
        decision === undefined ||
        decision.record.requestId !== receipt.record.requestId ||
        Date.parse(receipt.record.completedAt) < Date.parse(decision.record.decidedAt)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt has no exact decision');
      }
    }
    for (const [requestId, held] of slots) {
      if (held.length > 1) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference request slot authority');
      }
      const request = requests.get(requestId);
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      if (
        request !== undefined &&
        (decision === undefined || (decision.outcome.kind === 'generation_gate' && !receipt))
      ) {
        if (held[0].quarantined) {
          throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request slot is quarantined');
        }
      }
    }
    for (const requestId of requests.keys()) {
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      const live = decision === undefined || (decision.outcome.kind === 'generation_gate' && receipt === undefined);
      if (!live) continue;
      const held = slots.get(requestId) ?? [];
      if (held.length !== 1 || held[0].quarantined) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Pending Studio reference request has no exact slot authority'
        );
      }
    }
    for (const [requestId, request] of requests) {
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      const requiresSlot =
        decision === undefined || (decision.outcome.kind === 'generation_gate' && receipt === undefined);
      if (requiresSlot && slots.get(requestId)?.length !== 1) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request has no exact slot');
      }
      if (request.record.projectId !== input.projectId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference request project authority mismatch');
      }
    }
    const liveCount = [...requests.keys()].filter((requestId) => {
      const decision = decisions.get(requestId)?.record;
      return (
        decision === undefined ||
        (decision.outcome.kind === 'generation_gate' && !receipts.has(decision.outcome.handoffId))
      );
    }).length;
    // Immutable terminal relations are retained as audit history. Only requests
    // which still hold a slot participate in the live reference-request cap.
    if (liveCount > STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio reference request ledger exceeds capacity');
    }
    return {
      directories: input.directories,
      requests,
      decisions,
      slots,
      receipts,
      generationDecisions,
      journalResidues: [
        ...decisionResidues.map((residue) => Object.assign({ family: `decisions` as const }, residue)),
        ...receiptResidues.map((residue) => Object.assign({ family: `receipts` as const }, residue)),
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

  const assertReferenceRequestLedgerEntrySetCurrentV2 = async (
    ledger: ReferenceRequestLedgerV2,
    publication?: {
      decision?: IdentifiedRecordV2<null>;
      receipt?: IdentifiedRecordV2<null>;
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
          throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
        }
        if (identified === undefined) {
          const named = entry.name.endsWith('.publish')
            ? expected.get(entry.name.slice(0, -'.publish'.length))
            : undefined;
          if (named === undefined) {
            throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
          }
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: { ...named, file: path.join(authority.path, entry.name) },
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
          continue;
        }
        observed.add(entry.name);
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root,
          authority,
          identified,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
      }
      if ([...expected.keys()].some((name) => !observed.has(name))) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
      }
      await assertDirectoryAuthorityV2(authority);
    };
    await Promise.all([
      assertEntries(ledger.directories.pending, [
        ...ledger.requests.values(),
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
      assertEntries(ledger.directories.receipts, [
        ...ledger.receipts.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'receipts')
          .map((residue) => residue.identified),
        ...(publication?.receipt === undefined ? [] : [publication.receipt]),
      ]),
    ]);
    await assertReferenceRequestDirectoryAuthoritiesV2(ledger.directories);
  };

  const cleanupReferenceJournalPublicationResiduesV2 = async (
    root: string,
    ledger: ReferenceRequestLedgerV2,
    authorizeProject: () => Promise<void>
  ): Promise<ReferenceRequestLedgerV2> => {
    const current: ReferenceRequestLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions),
      receipts: new Map(ledger.receipts),
      generationDecisions: new Map(ledger.generationDecisions),
      journalResidues: [...ledger.journalResidues],
    };
    for (const residue of ledger.journalResidues) {
      const authority = current.directories[residue.family];
      // Recovery deliberately proves each journal residue against the authority established by the previous repair.
      // eslint-disable-next-line no-await-in-loop
      await assertReferenceRequestLedgerEntrySetCurrentV2(current);
      if (residue.family === 'decisions') {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) {
          current.decisions.set(residue.identified.record.requestId, named);
          if (residue.identified.record.outcome.kind === 'generation_gate') {
            current.generationDecisions.set(residue.identified.record.outcome.handoffId, named);
          }
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) current.receipts.set(residue.identified.record.handoffId, named);
      }
      current.journalResidues = current.journalResidues.map((candidate) =>
        candidate.identified.file === residue.identified.file ? { ...candidate, effective: false } : candidate
      );
    }
    return current;
  };

  const cleanupReferenceWriterResiduesV2 = async (
    root: string,
    projectId: string,
    ledger: ReferenceRequestLedgerV2,
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>
  ): Promise<void> => {
    if (ledger.writerResidues.length === 0) return;
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await cleanupCapturedWriterResiduesV2({
      root,
      pending: ledger.directories.pending,
      slots: ledger.directories.slots,
      residues: ledger.writerResidues,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      capacity: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      parseSlot: parseStudioReferenceRequestSlotV2,
      recordId: (slot) => slot.requestId,
      validatePending: (requestId, value) =>
        parseStudioReferenceRequestV2({ projectId, requestId, value }).status === 'valid',
      authorizeProject: () => assertProjectSnapshotCurrentV2({ root, snapshot: projectSnapshot }),
      recoveryAction: async (residue) => {
        if (residue.phase !== 'ready' || !residue.effective) return 'retain';
        if (residue.family === 'pending') {
          const requestId = path.basename(residue.namedFile, '.json');
          const decision = ledger.decisions.get(requestId);
          const receipt =
            decision?.record.outcome.kind === 'generation_gate'
              ? ledger.receipts.get(decision.record.outcome.handoffId)
              : undefined;
          const counterpart =
            decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined)
              ? ledger.slots.get(requestId)?.[0]
              : (receipt ?? decision);
          if (counterpart === undefined) return 'retain';
          const authority =
            decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined)
              ? ledger.directories.slots
              : receipt === undefined
                ? ledger.directories.decisions
                : ledger.directories.receipts;
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: counterpart,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
          return 'promote';
        }
        let value: unknown;
        try {
          value = JSON.parse(residue.identified.bytes) as unknown;
        } catch {
          return 'retain';
        }
        const parsed = parseStudioReferenceRequestSlotV2(value);
        if (parsed.status !== 'valid') return 'retain';
        const request = ledger.requests.get(parsed.record.requestId);
        const decision = ledger.decisions.get(parsed.record.requestId);
        const receipt =
          decision?.record.outcome.kind === 'generation_gate'
            ? ledger.receipts.get(decision.record.outcome.handoffId)
            : undefined;
        if (request === undefined) {
          await assertPathAbsentV2(path.join(ledger.directories.pending.path, `${parsed.record.requestId}.json`));
          return 'rollback';
        }
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: ledger.directories.pending,
          identified: request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
        const live =
          decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined);
        if (live) return 'promote';
        const terminal = receipt ?? decision;
        if (terminal !== undefined) {
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: receipt === undefined ? ledger.directories.decisions : ledger.directories.receipts,
            identified: terminal,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
        }
        return 'rollback';
      },
    });
  };

  // Kept beside the generation-decision workflow so its narrowing rule remains auditable with that authority.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const isReferenceGenerationDecisionV2 = (
    decision: StudioReferenceRequestDecisionV2
  ): decision is StudioReferenceGenerationDecisionV2 => decision.outcome.kind === 'generation_gate';

  const publishReferenceRequestDecisionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ReferenceRequestDirectoriesV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    outcome: StudioReferenceRequestDecisionV2['outcome'];
    decidedAt: string;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioReferenceRequestDecisionV2>> => {
    const decision: StudioReferenceRequestDecisionV2 = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      requestId: input.request.record.id,
      projectId: input.projectId,
      decidedAt: input.decidedAt,
      outcome: structuredClone(input.outcome),
    };
    const bytes = serializeJsonExact(decision);
    const file = path.join(input.directories.decisions.path, `${decision.requestId}.json`);
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.decisions,
      file,
      bytes,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      parse: (value) =>
        parseStudioReferenceRequestDecisionV2({
          projectId: input.projectId,
          requestId: decision.requestId,
          value,
        }),
    });
    if (published.bytes !== bytes) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision changed at publication');
    }
    return published;
  };

  const publishReferenceGenerationHandoffReceiptV2 = async (input: {
    root: string;
    directories: ReferenceRequestDirectoriesV2;
    receipt: StudioReferenceGenerationHandoffReceiptV2;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>> => {
    const bytes = serializeJsonExact(input.receipt);
    const file = path.join(input.directories.receipts.path, `${input.receipt.handoffId}.json`);
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.receipts,
      file,
      bytes,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      parse: (value) => parseStudioReferenceGenerationHandoffReceiptV2({ handoffId: input.receipt.handoffId, value }),
    });
    if (published.bytes !== bytes) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt changed at publication');
    }
    return published;
  };

  const assertPendingReferenceRequestSlotV2 = (
    ledger: ReferenceRequestLedgerV2,
    requestId: string
  ): IdentifiedRecordV2<StudioReferenceRequestSlotV2> => {
    const held = ledger.slots.get(requestId) ?? [];
    if (held.length !== 1 || held[0].quarantined) {
      throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request has no exact slot');
    }
    return held[0];
  };

  const releaseReferenceRequestSlotV2 = async (input: {
    root: string;
    ledger: ReferenceRequestLedgerV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
    receipt?: IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2> | undefined;
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<void> => {
    if (input.slot === undefined) return;
    const authorize = async (): Promise<void> => {
      await assertReferenceRequestDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.pending,
          identified: input.request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.decisions,
          identified: input.decision,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        ...(input.receipt === undefined
          ? []
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.ledger.directories.receipts,
                identified: input.receipt,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
            ]),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
  };

  const referenceAuthorizationByHandoffV2 = (
    project: StudioProjectV2
  ): Map<string, StudioProjectV2['spendAuthorizations'][number]> => {
    const authorizations = new Map<string, StudioProjectV2['spendAuthorizations'][number]>();
    for (const authorization of project.spendAuthorizations) {
      const handoffId = authorization.originReferenceHandoffId;
      if (handoffId === null) continue;
      if (authorizations.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference authorization origin');
      }
      authorizations.set(handoffId, authorization);
    }
    return authorizations;
  };

  const assertReferenceAuthorizationRelationsV2 = (input: {
    project: StudioProjectV2;
    ledger: ReferenceRequestLedgerV2;
  }): Array<{
    handoffId: string;
    authorization: StudioProjectV2['spendAuthorizations'][number];
    decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  }> => {
    const authorizations = referenceAuthorizationByHandoffV2(input.project);
    const missing: Array<{
      handoffId: string;
      authorization: StudioProjectV2['spendAuthorizations'][number];
      decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
      request: IdentifiedRecordV2<StudioReferenceRequestV2>;
      slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
    }> = [];
    for (const [handoffId, authorization] of authorizations) {
      const decision = input.ledger.generationDecisions.get(handoffId);
      if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization has no reference handoff decision');
      }
      const generationOutcome = decision.record.outcome;
      const request = input.ledger.requests.get(decision.record.requestId);
      if (request === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference request is missing');
      }
      if (
        authorization.cascadeItems.length !== 0 ||
        authorization.baseItems.length !== generationOutcome.referenceIds.length ||
        Date.parse(authorization.confirmedAt) < Date.parse(decision.record.decidedAt) ||
        !authorization.baseItems.every(
          (item, index) =>
            item.purpose === 'reference_image' &&
            item.target.kind === 'reference' &&
            item.target.referenceId === generationOutcome.referenceIds[index] &&
            (item.generationCount === 1 || item.generationCount === 2) &&
            item.requestPlan.kind === 'resolved' &&
            item.requestPlan.snapshot.referenceInputs.length === 0
        )
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference handoff scope mismatch');
      }
      const receipt = input.ledger.receipts.get(handoffId);
      if (receipt === undefined) {
        missing.push({
          handoffId,
          authorization,
          decision,
          request,
          slot: assertPendingReferenceRequestSlotV2(input.ledger, request.record.id),
        });
      } else if (
        receipt.record.result.kind !== 'confirmed' ||
        receipt.record.result.authorizationId !== authorization.id ||
        receipt.record.completedAt !== authorization.confirmedAt
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference receipt mismatch');
      }
    }
    for (const [handoffId, receipt] of input.ledger.receipts) {
      const authorization = authorizations.get(handoffId);
      if (receipt.record.result.kind === 'dismissed') {
        if (authorization !== undefined) {
          throw new CreativeStudioStoreError('storage_error', 'Dismissed Studio reference handoff has authorization');
        }
      } else if (
        authorization === undefined ||
        receipt.record.result.authorizationId !== authorization.id ||
        receipt.record.completedAt !== authorization.confirmedAt
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Confirmed Studio reference handoff has no exact authorization'
        );
      }
    }
    return missing;
  };

  const resolveReferenceAuthorizationReceiptsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<Extract<ProjectFileInspectionV2, { status: 'supported' }>> => {
    const directories = await resolveReferenceRequestDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: false,
    });
    if (directories === null) {
      if (input.snapshot.project.spendAuthorizations.some((authorization) => authorization.originReferenceHandoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference authorization ledger is missing');
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return input.snapshot;
    }
    let ledger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    let missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    const activeReferencePositions = new Map(
      input.snapshot.project.referenceOrder.map((referenceId, index) => [referenceId, index])
    );
    for (const residue of ledger.journalResidues) {
      if (residue.family !== 'decisions' || !residue.effective) continue;
      const decision = residue.identified.record;
      const request = ledger.requests.get(decision.requestId);
      if (request === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision has no immutable request');
      }
      if (decision.outcome.kind === 'generation_gate') {
        let previous = -1;
        for (const referenceId of request.record.referenceIds) {
          const reference = Object.hasOwn(input.snapshot.project.references, referenceId)
            ? input.snapshot.project.references[referenceId]
            : undefined;
          const position = activeReferencePositions.get(referenceId);
          if (reference?.id !== referenceId || position === undefined || position <= previous) {
            throw new CreativeStudioStoreError(
              'storage_error',
              'Studio reference generation publication is no longer active'
            );
          }
          previous = position;
        }
      }
    }
    ledger = await cleanupReferenceJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    for (const repair of missing) {
      // Authorization repairs are deliberately sequential: each publication extends the ledger fenced below.
      // eslint-disable-next-line no-await-in-loop
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      // eslint-disable-next-line no-await-in-loop
      await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.pending,
          identified: repair.request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.decisions,
          identified: repair.decision,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.slots,
          identified: repair.slot,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertPathAbsentV2(path.join(directories.receipts.path, `${repair.handoffId}.json`)),
      ]);
      const receiptRecord: StudioReferenceGenerationHandoffReceiptV2 = {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        handoffId: repair.handoffId,
        requestId: repair.request.record.id,
        completedAt: repair.authorization.confirmedAt,
        result: { kind: 'confirmed', authorizationId: repair.authorization.id },
      };
      // A project has a bounded authorization ledger and repairs remain sequentially attributable.
      // eslint-disable-next-line no-await-in-loop
      const receipt = await publishReferenceGenerationHandoffReceiptV2({
        root: input.root,
        directories,
        receipt: receiptRecord,
        authorizeBeforeLink: async (temporary) => {
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { receipt: temporary });
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.pending,
              identified: repair.request,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.decisions,
              identified: repair.decision,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.slots,
              identified: repair.slot,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertPathAbsentV2(path.join(directories.receipts.path, `${repair.handoffId}.json`)),
          ]);
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        },
      });
      ledger = { ...ledger, receipts: new Map(ledger.receipts).set(repair.handoffId, receipt) };
      // The next repair must observe the receipt just published by this iteration.
      // eslint-disable-next-line no-await-in-loop
      await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      // eslint-disable-next-line no-await-in-loop
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request: repair.request,
        decision: repair.decision,
        receipt,
        slot: repair.slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(repair.request.record.id);
      ledger = { ...ledger, slots };
    }
    for (const [handoffId, receipt] of ledger.receipts) {
      const decision = ledger.generationDecisions.get(handoffId);
      if (decision === undefined) continue;
      const request = ledger.requests.get(decision.record.requestId);
      const slot = ledger.slots.get(decision.record.requestId)?.[0];
      if (request === undefined || slot === undefined) continue;
      // eslint-disable-next-line no-await-in-loop
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request,
        decision,
        receipt,
        slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(request.record.id);
      ledger = { ...ledger, slots };
    }
    const postRepairLedger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger: postRepairLedger });
    await cleanupReferenceWriterResiduesV2(input.root, input.projectId, postRepairLedger, input.snapshot);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return input.snapshot;
  };

  const readCleanReferenceRequestLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<ReferenceRequestLedgerV2 | null> => {
    const directories = await resolveReferenceRequestDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      snapshot: input.snapshot,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return null;
    }
    let ledger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    const missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    if (missing.length > 0) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference authorization receipt was not repaired');
    }
    ledger = await cleanupReferenceJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    if (ledger.writerResidues.length > 0) {
      await cleanupReferenceWriterResiduesV2(input.root, input.projectId, ledger, input.snapshot);
      ledger = await readReferenceRequestLedgerV2({
        root: input.root,
        projectId: input.projectId,
        directories,
      });
      assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    }
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertReferenceRequestLedgerEntrySetCurrentV2(ledger),
    ]);
    return ledger;
  };

  // Kept beside the clean-ledger reader so projection of a request remains local to that workflow.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const referenceRequestLedgerEntryV2 = (
    ledger: ReferenceRequestLedgerV2,
    request: IdentifiedRecordV2<StudioReferenceRequestV2>
  ): StudioReferenceRequestLedgerEntryV2 => {
    const decision = ledger.decisions.get(request.record.id)?.record ?? null;
    const receipt =
      decision?.outcome.kind === 'generation_gate'
        ? (ledger.receipts.get(decision.outcome.handoffId)?.record ?? null)
        : null;
    return { request: request.record, decision, receipt };
  };

  const assertReferenceRequestReferencesActiveV2 = (
    project: StudioProjectV2,
    request: StudioReferenceRequestV2
  ): void => {
    const positions = new Map(project.referenceOrder.map((referenceId, index) => [referenceId, index]));
    let previous = -1;
    for (const referenceId of request.referenceIds) {
      const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
      const position = positions.get(referenceId);
      if (reference?.id !== referenceId || position === undefined || position <= previous) {
        throw new CreativeStudioStoreError(
          'invalid_payload',
          'Studio reference request references are no longer active'
        );
      }
      previous = position;
    }
  };

  // Kept beside decision replay so idempotency intent remains local to that authority.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const sameReferenceDecisionIntentV2 = (
    decision: StudioReferenceRequestDecisionV2,
    intent: StudioReferenceDecisionIntentV2
  ): boolean => decision.outcome.kind === intent.kind;

  const cleanupOrphanReferenceRequestSlotV2 = async (input: {
    root: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ReferenceRequestLedgerV2;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  }): Promise<void> => {
    const authorize = async (): Promise<void> => {
      await assertReferenceRequestDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertPathAbsentV2(path.join(input.ledger.directories.pending.path, `${input.slot.record.requestId}.json`)),
        assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${input.slot.record.requestId}.json`)),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
  };

  const reapReferenceRequestLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ReferenceRequestLedgerV2;
  }): Promise<ReferenceRequestLedgerV2> => {
    await assertReferenceRequestLedgerEntrySetCurrentV2(input.ledger);
    const observedAt = now();
    if (!isCanonicalIsoTimestamp(observedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request reap clock is invalid');
    }
    const currentTime = Date.parse(observedAt);
    const cutoff = currentTime - STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS;
    const orphanSlotCutoff = currentTime - REFERENCE_REQUEST_STALE_SLOT_MS;
    let ledger = input.ledger;
    for (const [requestId, request] of ledger.requests) {
      let decision = ledger.decisions.get(requestId);
      if (decision === undefined && Date.parse(request.record.createdAt) <= cutoff) {
        const expiringSlot = assertPendingReferenceRequestSlotV2(ledger, requestId);
        // Reaping is deliberately sequential so each expiration is checked against the prior iteration's ledger.
        // eslint-disable-next-line no-await-in-loop
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        // eslint-disable-next-line no-await-in-loop
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
        // A bounded reference ledger has at most fifty live request records.
        // eslint-disable-next-line no-await-in-loop
        decision = await publishReferenceRequestDecisionV2({
          root: input.root,
          projectId: input.projectId,
          directories: ledger.directories,
          request,
          outcome: { kind: 'expired' },
          decidedAt: observedAt,
          authorizeBeforeLink: async (temporary) => {
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
            await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: ledger.directories.pending,
                identified: request,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: ledger.directories.slots,
                identified: expiringSlot,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
              assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          },
        });
        ledger = Object.assign({}, ledger, {
          decisions: new Map(ledger.decisions).set(requestId, decision),
        });
        // eslint-disable-next-line no-await-in-loop
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      }
      const receipt =
        decision?.record.outcome.kind === 'generation_gate'
          ? ledger.receipts.get(decision.record.outcome.handoffId)
          : undefined;
      const terminal =
        decision !== undefined && (decision.record.outcome.kind !== 'generation_gate' || receipt !== undefined);
      const slot = ledger.slots.get(requestId)?.[0];
      if (terminal && decision !== undefined && slot !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision,
          receipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(requestId);
        ledger = { ...ledger, slots };
      }
    }
    for (const [requestId, held] of ledger.slots) {
      if (ledger.requests.has(requestId) || held.length !== 1) continue;
      const slot = held[0];
      if (Date.parse(slot.record.reservedAt) > orphanSlotCutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await cleanupOrphanReferenceRequestSlotV2({
        root: input.root,
        snapshot: input.snapshot,
        ledger,
        slot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(requestId);
      ledger = { ...ledger, slots };
    }
    return ledger;
  };

  const listReferenceRequestsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceRequestLedgerEntryV2[]> => {
    const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      ...input,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return [];
    }
    const reaped = await reapReferenceRequestLedgerV2InsideQueue({ ...input, ledger });
    const result = [...reaped.requests.values()]
      .map((request) => referenceRequestLedgerEntryV2(reaped, request))
      .toSorted(
        (left, right) =>
          left.request.createdAt.localeCompare(right.request.createdAt) ||
          left.request.id.localeCompare(right.request.id)
      );
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return result;
  };

  const hasOpenReferenceGenerationHandoffOverlapV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    referenceIds: readonly string[];
  }): Promise<boolean> => {
    if (input.referenceIds.length === 0) return false;
    const requested = new Set(input.referenceIds);
    const entries = await listReferenceRequestsV2InsideQueue(input);
    return entries.some(
      (entry) =>
        entry.decision?.outcome.kind === 'generation_gate' &&
        entry.receipt === null &&
        entry.request.referenceIds.some((referenceId) => requested.has(referenceId))
    );
  };

  const listReferenceRequestsV2ThroughQueue = (projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]> =>
    enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      return listReferenceRequestsV2InsideQueue({ root, projectId, snapshot });
    });

  const decideReferenceRequestV2InsideQueue = async (input: {
    root: string;
    decisionInput: StudioDecideReferenceRequestInputV2;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceRequestLedgerEntryV2> => {
    const { projectId, requestId, expectedRevision, outcome: intent } = input.decisionInput;
    let ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference request not found');
    ledger = await reapReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      ledger,
    });
    const request = ledger.requests.get(requestId);
    if (request === undefined) throw new CreativeStudioStoreError('not_found', 'Studio reference request not found');
    const existingDecision = ledger.decisions.get(requestId);
    if (existingDecision !== undefined) {
      if (!sameReferenceDecisionIntentV2(existingDecision.record, intent)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference request already has another decision');
      }
      const receipt =
        existingDecision.record.outcome.kind === 'generation_gate'
          ? ledger.receipts.get(existingDecision.record.outcome.handoffId)
          : undefined;
      const slot = ledger.slots.get(requestId)?.[0];
      if ((existingDecision.record.outcome.kind !== 'generation_gate' || receipt !== undefined) && slot !== undefined) {
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision: existingDecision,
          receipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(requestId);
        ledger = { ...ledger, slots };
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return referenceRequestLedgerEntryV2(ledger, request);
    }
    if (input.snapshot.project.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    if (intent.kind !== 'rejected') {
      assertReferenceRequestReferencesActiveV2(input.snapshot.project, request.record);
    }
    const slot = assertPendingReferenceRequestSlotV2(ledger, requestId);
    const decidedAt = now();
    if (!isCanonicalIsoTimestamp(decidedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision clock is invalid');
    }
    if (Date.parse(decidedAt) < Date.parse(request.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision predates its request');
    }
    let outcome: StudioReferenceRequestDecisionV2['outcome'];
    if (intent.kind === 'rejected') {
      outcome = { kind: 'rejected' };
    } else {
      let handoffId: string;
      try {
        handoffId = createId();
      } catch (error) {
        throw storageError(error, 'Studio reference handoff identity could not be generated');
      }
      if (
        !isSafeIdV2(handoffId) ||
        ledger.generationDecisions.has(handoffId) ||
        ledger.receipts.has(handoffId) ||
        referenceAuthorizationByHandoffV2(input.snapshot.project).has(handoffId)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff identity collides');
      }
      outcome = { kind: 'generation_gate', handoffId, referenceIds: [...request.record.referenceIds] };
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.slots,
        identified: slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
    ]);
    const decision = await publishReferenceRequestDecisionV2({
      root: input.root,
      projectId,
      directories: ledger.directories,
      request,
      outcome,
      decidedAt,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { decision: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: request,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    const decisions = new Map(ledger.decisions).set(requestId, decision);
    const generationDecisions = new Map(ledger.generationDecisions);
    if (decision.record.outcome.kind === 'generation_gate') {
      generationDecisions.set(decision.record.outcome.handoffId, decision);
    }
    ledger = { ...ledger, decisions, generationDecisions };
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    if (decision.record.outcome.kind !== 'generation_gate') {
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request,
        decision,
        slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(requestId);
      ledger = { ...ledger, slots };
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return referenceRequestLedgerEntryV2(ledger, request);
  };

  const referenceGenerationHandoffV2 = (
    ledger: ReferenceRequestLedgerV2,
    handoffId: string
  ): StudioReferenceGenerationHandoffStoreV2 | null => {
    const decision = ledger.generationDecisions.get(handoffId)?.record;
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision)) return null;
    const request = ledger.requests.get(decision.requestId)?.record;
    if (request === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff request is missing');
    }
    return {
      request,
      decision,
      receipt: ledger.receipts.get(handoffId)?.record ?? null,
    };
  };

  type ReservedReferenceGenerationHandoffV2 = {
    ledger: ReferenceRequestLedgerV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    decision: IdentifiedRecordV2<StudioReferenceGenerationDecisionV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  };

  const reserveReferenceGenerationHandoffV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    handoffId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ReservedReferenceGenerationHandoffV2> => {
    const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId: input.projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    const decision = ledger.generationDecisions.get(input.handoffId);
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
      throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    }
    const generationDecision = decision as IdentifiedRecordV2<StudioReferenceGenerationDecisionV2>;
    const request = ledger.requests.get(generationDecision.record.requestId);
    if (
      request === undefined ||
      request.record.projectId !== input.projectId ||
      generationDecision.record.projectId !== input.projectId ||
      generationDecision.record.outcome.handoffId !== input.handoffId ||
      !sameJson(request.record.referenceIds, generationDecision.record.outcome.referenceIds)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff authority mismatch');
    }
    if (ledger.receipts.has(input.handoffId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio reference handoff is already complete');
    }
    if (referenceAuthorizationByHandoffV2(input.snapshot.project).has(input.handoffId)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff authorization is unrepaired');
    }
    assertReferenceRequestReferencesActiveV2(input.snapshot.project, request.record);
    const slot = assertPendingReferenceRequestSlotV2(ledger, request.record.id);
    return { ledger, request, decision: generationDecision, slot };
  };

  const assertReservedReferenceGenerationHandoffCurrentV2 = async (input: {
    root: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    reserved: ReservedReferenceGenerationHandoffV2;
    assertActive: () => unknown;
  }): Promise<void> => {
    await Promise.all([
      assertReferenceRequestLedgerEntrySetCurrentV2(input.reserved.ledger),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.reserved.ledger.directories.pending,
        identified: input.reserved.request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.reserved.ledger.directories.decisions,
        identified: input.reserved.decision,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.reserved.ledger.directories.slots,
        identified: input.reserved.slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(
        path.join(
          input.reserved.ledger.directories.receipts.path,
          `${input.reserved.decision.record.outcome.handoffId}.json`
        )
      ),
    ]);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    const activeAfterHandoffAuthority = input.assertActive();
    assertSynchronousConfirmationResult(
      activeAfterHandoffAuthority,
      'Studio reference confirmation active-session check'
    );
  };

  const recordReferenceGenerationHandoffReceiptV2InsideQueue = async (input: {
    root: string;
    receiptInput: StudioRecordReferenceGenerationHandoffReceiptInputV2;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceGenerationHandoffStoreV2> => {
    const { projectId, handoffId, expectedRevision, result } = input.receiptInput;
    let ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    const decision = ledger.generationDecisions.get(handoffId);
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
      throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    }
    const request = ledger.requests.get(decision.record.requestId);
    if (request === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff request is missing');
    }
    const existingReceipt = ledger.receipts.get(handoffId);
    if (existingReceipt !== undefined) {
      const sameResult =
        existingReceipt.record.result.kind === result.kind &&
        (result.kind !== 'confirmed' ||
          (existingReceipt.record.result.kind === 'confirmed' &&
            existingReceipt.record.result.authorizationId === result.authorizationId));
      if (!sameResult) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference handoff already has another receipt');
      }
      const slot = ledger.slots.get(request.record.id)?.[0];
      if (slot !== undefined) {
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision,
          receipt: existingReceipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(request.record.id);
        ledger = { ...ledger, slots };
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return referenceGenerationHandoffV2(ledger, handoffId)!;
    }
    if (input.snapshot.project.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const authorizations = referenceAuthorizationByHandoffV2(input.snapshot.project);
    const authorization = authorizations.get(handoffId);
    let completedAt: string;
    if (result.kind === 'dismissed') {
      if (authorization !== undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Authorized Studio reference handoff cannot be dismissed');
      }
      completedAt = now();
      if (!isCanonicalIsoTimestamp(completedAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt clock is invalid');
      }
      if (Date.parse(completedAt) < Date.parse(decision.record.decidedAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt predates its decision');
      }
    } else {
      if (authorization === undefined || authorization.id !== result.authorizationId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff has no exact authorization');
      }
      completedAt = authorization.confirmedAt;
    }
    const slot = assertPendingReferenceRequestSlotV2(ledger, request.record.id);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.decisions,
        identified: decision,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.slots,
        identified: slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(path.join(ledger.directories.receipts.path, `${handoffId}.json`)),
    ]);
    const receipt = await publishReferenceGenerationHandoffReceiptV2({
      root: input.root,
      directories: ledger.directories,
      receipt: {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        handoffId,
        requestId: request.record.id,
        completedAt,
        result: structuredClone(result),
      },
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { receipt: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: request,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.decisions,
            identified: decision,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertPathAbsentV2(path.join(ledger.directories.receipts.path, `${handoffId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    ledger = { ...ledger, receipts: new Map(ledger.receipts).set(handoffId, receipt) };
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await releaseReferenceRequestSlotV2({
      root: input.root,
      ledger,
      request,
      decision,
      receipt,
      slot,
      projectSnapshot: input.snapshot,
    });
    const slots = new Map(ledger.slots);
    slots.delete(request.record.id);
    ledger = { ...ledger, slots };
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return referenceGenerationHandoffV2(ledger, handoffId)!;
  };

  const confirmReferenceGenerationHandoffV2 = async <TRevalidation, TDispatch>(
    input: StudioReferenceGenerationHandoffConfirmationInputV2<TRevalidation, TDispatch>
  ): Promise<StudioProjectConfirmationResultV2<TDispatch>> => {
    if (
      !isRecord(input) ||
      !isSafeIdV2(input.projectId) ||
      !isSafeIdV2(input.handoffId) ||
      !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
      !isCanonicalIsoTimestamp(input.expiresAt) ||
      typeof input.revalidate !== 'function' ||
      typeof input.assertActive !== 'function' ||
      typeof input.buildCommit !== 'function' ||
      (input.commitTag !== undefined && typeof input.commitTag !== 'string')
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference confirmation input');
    }
    const confirmationInput = Object.freeze({
      projectId: input.projectId,
      handoffId: input.handoffId,
      expectedRevision: input.expectedRevision,
      expiresAt: input.expiresAt,
      revalidate: input.revalidate,
      assertActive: input.assertActive,
      buildCommit: input.buildCommit,
      commitTag: input.commitTag,
    });
    let result: StudioProjectConfirmationResultV2<TDispatch>;
    let projectCommitted = false;
    try {
      result = await enqueue(confirmationInput.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const inspected = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, confirmationInput.projectId)
        );
        const reserved = await reserveReferenceGenerationHandoffV2InsideQueue({
          root,
          projectId: confirmationInput.projectId,
          handoffId: confirmationInput.handoffId,
          snapshot: inspected,
        });
        const committed = await confirmProjectV2InsideQueue(root, inspected, confirmationInput, async (candidate) => {
          const exactAuthorizations = candidate.spendAuthorizations.filter(
            (authorization) => authorization.originReferenceHandoffId === confirmationInput.handoffId
          );
          if (
            candidate.spendAuthorizations.length !== inspected.project.spendAuthorizations.length + 1 ||
            exactAuthorizations.length !== 1
          ) {
            throw new CreativeStudioStoreError(
              'invalid_payload',
              'Studio reference confirmation did not create one exact authorization'
            );
          }
          const missing = assertReferenceAuthorizationRelationsV2({ project: candidate, ledger: reserved.ledger });
          if (missing.length !== 1 || missing[0]?.handoffId !== confirmationInput.handoffId) {
            throw new CreativeStudioStoreError(
              'invalid_payload',
              'Studio reference confirmation did not create one exact authorization'
            );
          }
          await assertReservedReferenceGenerationHandoffCurrentV2({
            root,
            snapshot: inspected,
            reserved,
            assertActive: confirmationInput.assertActive,
          });
        });
        projectCommitted = true;
        const postCommit = requireSupportedProjectInspectionV2(
          await inspectProjectFileV2(root, confirmationInput.projectId)
        );
        if (!sameJson(postCommit.project, committed.project)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio reference confirmation project changed');
        }
        await resolveReferenceAuthorizationReceiptsV2InsideQueue({
          root,
          projectId: confirmationInput.projectId,
          snapshot: postCommit,
        });
        const finalLedger = await readReferenceRequestLedgerV2({
          root,
          projectId: confirmationInput.projectId,
          directories: reserved.ledger.directories,
        });
        const handoff = referenceGenerationHandoffV2(finalLedger, confirmationInput.handoffId);
        const authorization = committed.project.spendAuthorizations.find(
          (candidate) => candidate.originReferenceHandoffId === confirmationInput.handoffId
        );
        if (
          authorization === undefined ||
          handoff?.receipt?.result.kind !== 'confirmed' ||
          handoff.receipt.result.authorizationId !== authorization.id ||
          handoff.receipt.completedAt !== authorization.confirmedAt
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio reference confirmation receipt is missing');
        }
        return committed;
      });
    } catch (error) {
      if (projectCommitted) await repairSummaryV2AfterCommit();
      throw error;
    }
    await repairSummaryV2AfterCommit();
    return result;
  };

  const listReferenceRequestsV2 = async (projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]> => {
    if (!isSafeIdV2(projectId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request project identity');
    }
    return listReferenceRequestsV2ThroughQueue(projectId);
  };

  const decideReferenceRequestV2 = async (
    input: StudioDecideReferenceRequestInputV2
  ): Promise<StudioReferenceRequestLedgerEntryV2> => {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, REFERENCE_DECIDE_INPUT_KEYS) ||
      !isSafeIdV2(input.projectId) ||
      !isSafeIdV2(input.requestId) ||
      !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
      !isRecord(input.outcome) ||
      ((input.outcome.kind === 'rejected' || input.outcome.kind === 'generation_gate') &&
        !hasExactKeys(input.outcome, REFERENCE_REJECTED_INTENT_KEYS)) ||
      (input.outcome.kind !== 'rejected' && input.outcome.kind !== 'generation_gate')
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request decision input');
    }
    const decisionInput = structuredClone(input);
    return enqueue(decisionInput.projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, decisionInput.projectId)
      );
      return decideReferenceRequestV2InsideQueue({ root, decisionInput, snapshot });
    });
  };

  const readReferenceGenerationHandoffV2 = async (
    projectId: string,
    handoffId: string
  ): Promise<StudioReferenceGenerationHandoffStoreV2 | null> => {
    if (!isSafeIdV2(projectId) || !isSafeIdV2(handoffId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference handoff identity');
    }
    return enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
        root,
        projectId,
        snapshot,
        createIfWhollyAbsent: false,
      });
      const result = ledger === null ? null : referenceGenerationHandoffV2(ledger, handoffId);
      await assertProjectSnapshotCurrentV2({ root, snapshot });
      return result;
    });
  };

  const recordReferenceGenerationHandoffReceiptV2 = async (
    input: StudioRecordReferenceGenerationHandoffReceiptInputV2
  ): Promise<StudioReferenceGenerationHandoffStoreV2> => {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, REFERENCE_RECEIPT_INPUT_KEYS) ||
      !isSafeIdV2(input.projectId) ||
      !isSafeIdV2(input.handoffId) ||
      !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
      !isRecord(input.result) ||
      (input.result.kind === 'dismissed' && !hasExactKeys(input.result, REFERENCE_DISMISSED_RESULT_KEYS)) ||
      (input.result.kind === 'confirmed' &&
        (!hasExactKeys(input.result, REFERENCE_CONFIRMED_RESULT_KEYS) || !isSafeIdV2(input.result.authorizationId))) ||
      (input.result.kind !== 'dismissed' && input.result.kind !== 'confirmed')
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference handoff receipt input');
    }
    const receiptInput = structuredClone(input);
    return enqueue(receiptInput.projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, receiptInput.projectId)
      );
      return recordReferenceGenerationHandoffReceiptV2InsideQueue({ root, receiptInput, snapshot });
    });
  };

  const reapAbandonedReferenceRequestsV2 = async (): Promise<void> => {
    const root = await existingCanonicalRootV2();
    if (root === null) return;
    const supportedProjectIds = await listSupportedProjectIds(root);
    await Promise.all(
      supportedProjectIds.map((projectId) =>
        enqueue(projectId, async () => {
          const snapshot = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
          );
          const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
            root,
            projectId,
            snapshot,
            createIfWhollyAbsent: false,
          });
          if (ledger !== null) {
            await reapReferenceRequestLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
          }
        })
      )
    );
  };

  const watchReferenceRequestsV2 = async (
    listener: (projectId: string, requestId: string) => void
  ): Promise<() => Promise<void>> => {
    const root = await writableCanonicalRootV2();
    let closed = false;
    const observedSignatures = new Map<string, string>();
    const validateAndNotify = async (relativeFile: string): Promise<void> => {
      const segments = path.normalize(relativeFile).split(path.sep);
      if (
        segments.length !== 4 ||
        !isSafeIdV2(segments[0]) ||
        segments[1] !== 'reference-requests' ||
        (segments[2] !== 'pending' && segments[2] !== 'decisions' && segments[2] !== 'receipts') ||
        !segments[3].endsWith('.json')
      ) {
        return;
      }
      const projectId = segments[0];
      const recordId = segments[3].slice(0, -'.json'.length);
      if (!isSafeIdV2(recordId)) return;
      try {
        const entries = await listReferenceRequestsV2ThroughQueue(projectId);
        const entry =
          segments[2] === 'receipts'
            ? entries.find(
                (candidate) =>
                  candidate.decision?.outcome.kind === 'generation_gate' &&
                  candidate.decision.outcome.handoffId === recordId
              )
            : entries.find((candidate) => candidate.request.id === recordId);
        if (closed || entry === undefined) return;
        const key = `${projectId}:${entry.request.id}`;
        const signature = serializeJsonExact({
          request: entry.request,
          decision: entry.decision,
          receipt: entry.receipt,
        });
        if (observedSignatures.get(key) === signature) return;
        observedSignatures.set(key, signature);
        listener(projectId, entry.request.id);
      } catch (error) {
        if (!closed) safeLogError('[CreativeStudio] Schema-2 reference watcher ignored an invalid record', error);
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
          if (!closed) safeLogError('[CreativeStudio] Schema-2 reference watcher failed', error);
        },
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio reference watcher could not start');
    }
    return async (): Promise<void> => {
      if (closed) return;
      closed = true;
      watcher.close();
    };
  };

  const resolveReferenceRequestPathsV2 = async (
    projectId: string
  ): Promise<{ projectDir: string; pendingDir: string }> => {
    if (!isSafeIdV2(projectId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request project identity');
    }
    return enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      const directories = await resolveReferenceRequestDirectoriesV2({
        root,
        project: snapshot.directory,
        createIfWhollyAbsent: true,
        snapshot,
      });
      if (directories === null) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio reference request storage unavailable');
      }
      return { projectDir: snapshot.directory.path, pendingDir: directories.pending.path };
    });
  };

  return {
    confirmReferenceGenerationHandoffV2,
    decideReferenceRequestV2,
    hasOpenReferenceGenerationHandoffOverlapV2InsideQueue,
    listReferenceRequestsV2,
    readReferenceGenerationHandoffV2,
    reapAbandonedReferenceRequestsV2,
    recordReferenceGenerationHandoffReceiptV2,
    resolveReferenceAuthorizationReceiptsV2InsideQueue,
    resolveReferenceRequestPathsV2,
    watchReferenceRequestsV2,
  };
};
