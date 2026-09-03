/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { StudioProposalDecisionResultV4 } from '@/common/types/project/creativeStudioTypes';
import { applyStudioCreateBoardV4 } from '../../service/schema2/mutations/boardV4';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isPlainInputRecordV4,
} from '../../service/schema2/mutations/exactInputV4';
import {
  STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4,
  STUDIO_PROPOSAL_MAX_FUTURE_SKEW_MS_V4,
  STUDIO_PROPOSAL_RETAINED_PAYLOAD_LIMIT_V4,
  STUDIO_PROPOSAL_RETAINED_PAYLOAD_MS_V4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
  admitStudioProposalRecordV4,
  parseStudioProposalCurrentV4,
  parseStudioProposalDecidedEnvelopeV4,
  parseStudioProposalHistoryV4,
  type StudioProposalCommitAttributionV4,
  type StudioProposalCurrentV4,
  type StudioProposalDecidedEnvelopeV4,
  type StudioProposalDecisionStatusV4,
  type StudioProposalHistoryV4,
  type StudioProposalRecordV4,
  type StudioProposalReplayResultV4,
  type StudioProposalTerminalTransactionV4,
  type StudioProposalTombstoneV4,
} from '../../service/schema2/proposals/proposalContractsV4';
import {
  deriveStudioBoardProposalEffectV4,
  snapshotStudioProposalDecisionRequestV4,
} from '../../service/schema2/proposals/proposalReviewV4';
import {
  CreativeStudioProposalLedgerErrorV4,
  createCreativeStudioProposalLedgerV4,
  type StudioProposalLedgerAuthorityV4,
  type StudioProposalLedgerRecordV4,
  type StudioProposalLedgerWriterAuthorityV4,
} from './proposalLedgerV4';
import { CreativeStudioPilotStoreErrorV4, type CreativeStudioPilotStoreV4 } from './v4';

const RECORD_INPUT_KEYS = new Set(['projectId', 'proposalId', 'proposal']);
/** Keeps one decide/recovery pass bounded even if an older build left excess retained payloads. */
const STUDIO_PROPOSAL_PRUNE_WORK_LIMIT_V4 = 64;

export type StudioPendingProposalSnapshotV4 = {
  record: StudioProposalRecordV4;
  proposalBytes: string;
  proposalSha256: string;
  baseRevision: number;
  baseAuthoringRevision: number;
};
export type StudioProposalSidecarStorageStepV4 =
  | 'current_durable'
  | 'terminal_transaction_durable'
  | 'project_committed'
  | 'history_durable'
  | 'pending_released'
  | 'payload_pruned'
  | 'complete';
export type StudioProposalSidecarCommitFactsV4 = Readonly<{
  projectId: string;
  proposalId: string;
  status: 'recorded' | 'accepted' | 'rejected' | 'expired';
  recordedAt: string;
}>;
export type CreativeStudioProposalSidecarsOptionsV4 = {
  projectStore: CreativeStudioPilotStoreV4;
  fs?: Parameters<typeof createCreativeStudioProposalLedgerV4>[0]['fs'];
  now?: () => string;
  historyMaxBytes?: number;
  onStorageStep?: (step: StudioProposalSidecarStorageStepV4, projectId: string) => void | Promise<void>;
};
export type StudioProposalStateV4 =
  | { status: 'pending'; proposal: StudioProposalRecordV4; admittedAt: string }
  | ({ status: 'accepted' | 'rejected' | 'expired' } & Omit<StudioProposalTombstoneV4, 'status'>)
  | { status: 'unknown' };
export type CreativeStudioProposalSidecarsV4 = {
  replayProposalV4(input: unknown): Promise<StudioProposalReplayResultV4>;
  getProposalStateV4(projectId: string, proposalId: string): Promise<StudioProposalStateV4>;
  getPendingProposalV4(projectId: string): Promise<StudioPendingProposalSnapshotV4 | null>;
  recoverPendingProposalV4(projectId: string): Promise<void>;
  recoverProposalTerminalV4(projectId: string, proposalId: string): Promise<StudioProposalDecisionResultV4 | null>;
  acceptProposalV4(input: unknown): Promise<StudioProposalDecisionResultV4>;
  rejectProposalV4(input: unknown): Promise<StudioProposalDecisionResultV4>;
  watchProposalsV4(listener: (facts: StudioProposalSidecarCommitFactsV4) => void): () => void;
};
export type CreativeStudioProposalSidecarErrorCodeV4 = 'unsupported_prototype_schema' | 'storage_error';
export class CreativeStudioProposalSidecarErrorV4 extends Error {
  readonly code: CreativeStudioProposalSidecarErrorCodeV4;
  constructor(code: CreativeStudioProposalSidecarErrorCodeV4) {
    super(code);
    this.name = 'CreativeStudioProposalSidecarErrorV4';
    this.code = code;
  }
}

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const json = (bytes: string): unknown => {
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
};
const fail = (error: unknown): never => {
  if (error instanceof CreativeStudioProposalSidecarErrorV4 || error instanceof CreativeStudioPilotStoreErrorV4)
    throw error;
  throw new CreativeStudioProposalSidecarErrorV4('storage_error');
};
const inputSnapshot = (value: unknown): { projectId: string; proposalId: string; proposal: unknown } | null => {
  try {
    if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, RECORD_INPUT_KEYS)) return null;
    return { projectId: value.projectId as string, proposalId: value.proposalId as string, proposal: value.proposal };
  } catch {
    return null;
  }
};

export const createCreativeStudioProposalSidecarsV4 = (
  options: CreativeStudioProposalSidecarsOptionsV4
): CreativeStudioProposalSidecarsV4 => {
  const ledger = createCreativeStudioProposalLedgerV4({ projectStore: options.projectStore, fs: options.fs });
  const now = () => {
    const value = (options.now ?? (() => new Date().toISOString()))();
    if (!isCanonicalInputTimestampV4(value)) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    return value;
  };
  const historyMax = options.historyMaxBytes ?? STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4;
  const listeners = new Set<(f: StudioProposalSidecarCommitFactsV4) => void>();
  const emit = (f: StudioProposalSidecarCommitFactsV4) => {
    const frozen = Object.freeze({ ...f });
    for (const listener of listeners) {
      try {
        listener(frozen);
      } catch {}
    }
  };
  const step = (s: StudioProposalSidecarStorageStepV4, p: string) => options.onStorageStep?.(s, p);
  const withRead = async <T>(p: string, fn: (a: StudioProposalLedgerAuthorityV4) => Promise<T>): Promise<T> => {
    try {
      return await ledger.withProposalLedgerAuthorityV4(p, fn);
    } catch (e) {
      return fail(e);
    }
  };
  const withTerminal = async <T>(
    p: string,
    id: string,
    fn: (a: StudioProposalLedgerWriterAuthorityV4) => Promise<T>,
    recover = false
  ): Promise<T> => {
    try {
      return await (recover
        ? ledger.recoverProposalTerminalAuthorityV4(p, id, fn)
        : ledger.withProposalTerminalAuthorityV4(p, id, fn));
    } catch (e) {
      return fail(e);
    }
  };

  const current = async (
    a: StudioProposalLedgerAuthorityV4
  ): Promise<{ value: StudioProposalCurrentV4; raw: StudioProposalLedgerRecordV4 } | null> => {
    const raw = await a.readCurrentV4();
    if (raw === null) return null;
    const parsed = parseStudioProposalCurrentV4({ projectId: a.snapshot.project.id, value: json(raw.bytes) });
    if (parsed.status !== 'valid' || JSON.stringify(parsed.record) !== raw.bytes)
      throw new CreativeStudioProposalSidecarErrorV4(
        parsed.status === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'storage_error'
      );
    return { value: parsed.record, raw };
  };
  const history = async (
    a: StudioProposalLedgerAuthorityV4
  ): Promise<{ value: StudioProposalHistoryV4; raw: Awaited<ReturnType<typeof a.readHistoryV4>> }> => {
    const raw = await a.readHistoryV4();
    if (raw.record === null) return { value: { schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4, entries: [] }, raw };
    const parsed = parseStudioProposalHistoryV4(json(raw.record.bytes));
    if (parsed.status !== 'valid' || JSON.stringify(parsed.record) !== raw.record.bytes)
      throw new CreativeStudioProposalSidecarErrorV4(
        parsed.status === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'storage_error'
      );
    return { value: parsed.record, raw };
  };
  const decided = async (
    a: StudioProposalLedgerAuthorityV4,
    id: string
  ): Promise<{ value: StudioProposalDecidedEnvelopeV4; raw: StudioProposalLedgerRecordV4 } | null> => {
    const raw = await a.readDecidedV4(id);
    if (raw === null) return null;
    const parsed = parseStudioProposalDecidedEnvelopeV4({
      projectId: a.snapshot.project.id,
      proposalId: id,
      value: json(raw.bytes),
    });
    if (parsed.status !== 'valid' || JSON.stringify(parsed.record) !== raw.bytes)
      throw new CreativeStudioProposalSidecarErrorV4(
        parsed.status === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'storage_error'
      );
    return { value: parsed.record, raw };
  };
  const tombstone = (h: StudioProposalHistoryV4, id: string) => h.entries.find((e) => e.proposalId === id) ?? null;
  const assertDecisionClock = (h: StudioProposalHistoryV4, observedAt: string): void => {
    const previous = h.entries.at(-1);
    if (previous !== undefined && observedAt < previous.decidedAt) {
      throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    }
  };
  const pruneCandidateIds = (h: StudioProposalHistoryV4, observedAt: string): Set<string> => {
    const keep = new Set(
      h.entries
        .slice(-STUDIO_PROPOSAL_RETAINED_PAYLOAD_LIMIT_V4)
        .filter(
          (entry) => Date.parse(observedAt) - Date.parse(entry.decidedAt) <= STUDIO_PROPOSAL_RETAINED_PAYLOAD_MS_V4
        )
        .map((entry) => entry.proposalId)
    );
    return new Set(
      h.entries
        .filter((entry) => entry.payloadRetained && !keep.has(entry.proposalId))
        .slice(0, STUDIO_PROPOSAL_PRUNE_WORK_LIMIT_V4)
        .map((entry) => entry.proposalId)
    );
  };
  const historyAfterMaximumPruneFlags = (h: StudioProposalHistoryV4): StudioProposalHistoryV4 => {
    // Passive expiry or terminal recovery may be observed arbitrarily after the recorded decision.
    // Reserve the eventual maximum, not merely one pass: repeated bounded recovery passes may
    // ultimately flip every retained `true` to the one-byte-larger `false`.
    return h.entries.every((entry) => !entry.payloadRetained)
      ? h
      : {
          schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
          entries: h.entries.map((entry) => (entry.payloadRetained ? { ...entry, payloadRetained: false } : entry)),
        };
  };
  const pendingSnapshot = (c: { value: StudioProposalCurrentV4 }): StudioPendingProposalSnapshotV4 => ({
    record: structuredClone(c.value.proposal),
    proposalBytes: JSON.stringify(c.value.proposal),
    proposalSha256: c.value.payloadSha256,
    baseRevision: c.value.proposal.baseAuthoringRevision,
    baseAuthoringRevision: c.value.proposal.baseAuthoringRevision,
  });
  const duplicateResult = (t: StudioProposalTombstoneV4): StudioProposalDecisionResultV4 =>
    t.status === 'accepted'
      ? { status: 'already_accepted', decidedAt: t.decidedAt, appliedRevision: t.appliedRevision! }
      : t.status === 'rejected'
        ? { status: 'rejected' }
        : { status: 'expired' };
  const publishCurrent = async (
    a: StudioProposalLedgerAuthorityV4,
    proposal: StudioProposalRecordV4,
    proposalBytes: string
  ) => {
    const value: StudioProposalCurrentV4 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
      proposalId: proposal.id,
      payloadSha256: sha256(proposalBytes),
      admittedAt: proposal.createdAt,
      proposal,
    };
    const bytes = JSON.stringify(value);
    try {
      await a.publishCurrentV4(bytes);
    } catch (e) {
      if (!(e instanceof CreativeStudioProposalLedgerErrorV4) || e.code !== 'already_exists') throw e;
      const found = await current(a);
      if (found === null || found.raw.bytes !== bytes) throw e;
    }
    await step('current_durable', proposal.projectId);
  };
  const appendHistory = async (a: StudioProposalLedgerWriterAuthorityV4, t: StudioProposalTombstoneV4) => {
    const h = await history(a);
    const existing = tombstone(h.value, t.proposalId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(t))
        throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      return;
    }
    const previous = h.value.entries.at(-1);
    if (previous !== undefined && t.decidedAt < previous.decidedAt)
      throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    const entries = [...h.value.entries, t];
    const value = { schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4, entries } satisfies StudioProposalHistoryV4;
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > historyMax) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    await a.replaceHistoryV4(h.raw, bytes);
    await step('history_durable', a.snapshot.project.id);
  };
  const prune = async (a: StudioProposalLedgerWriterAuthorityV4, h: StudioProposalHistoryV4, observedAt: string) => {
    const candidates = pruneCandidateIds(h, observedAt);
    const pruned = new Set<string>();
    for (const proposalId of candidates) {
      const payload = await a.readDecidedV4(proposalId);
      // A crash may happen after unlink and before the tombstone flag is replaced. Absence is
      // therefore an idempotent prune result, not corruption; history remains decision authority.
      if (payload) await a.removeDecidedV4(proposalId, payload);
      pruned.add(proposalId);
      await step('payload_pruned', a.snapshot.project.id);
    }
    if (pruned.size > 0) {
      const latest = await history(a);
      const updated: StudioProposalHistoryV4 = {
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
        entries: latest.value.entries.map((entry) =>
          pruned.has(entry.proposalId) && entry.payloadRetained ? { ...entry, payloadRetained: false } : entry
        ),
      };
      const bytes = JSON.stringify(updated);
      if (Buffer.byteLength(bytes) > historyMax) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      await a.replaceHistoryV4(latest.raw, bytes);
    }
  };
  const terminalEnvelope = (
    proposal: StudioProposalRecordV4,
    proposalBytes: string,
    status: StudioProposalDecisionStatusV4,
    decidedAt: string,
    commit?: StudioProposalCommitAttributionV4
  ): StudioProposalDecidedEnvelopeV4 => {
    const decision = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
      proposalId: proposal.id,
      projectId: proposal.projectId,
      status,
      decidedAt,
    } as const;
    const decisionBytes = JSON.stringify(decision);
    const terminal: StudioProposalTerminalTransactionV4 =
      status === 'accepted'
        ? {
            schemaVersion: STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
            kind: 'accept_board',
            proposalId: proposal.id,
            projectId: proposal.projectId,
            proposalSha256: sha256(proposalBytes),
            commitBytes: JSON.stringify(commit),
            decisionBytes,
          }
        : {
            schemaVersion: STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
            kind: status === 'rejected' ? 'reject_board' : 'expire_board',
            proposalId: proposal.id,
            projectId: proposal.projectId,
            proposalSha256: sha256(proposalBytes),
            decisionBytes,
          };
    const value = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
      proposal,
      payloadSha256: sha256(proposalBytes),
      terminalTransaction: terminal,
    };
    const parsed = parseStudioProposalDecidedEnvelopeV4({
      projectId: proposal.projectId,
      proposalId: proposal.id,
      value,
    });
    if (parsed.status !== 'valid') throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    return parsed.record;
  };
  const settle = async (
    a: StudioProposalLedgerWriterAuthorityV4,
    c: { value: StudioProposalCurrentV4; raw: StudioProposalLedgerRecordV4 },
    status: StudioProposalDecisionStatusV4,
    decidedAt: string
  ): Promise<StudioProposalDecisionResultV4> => {
    const proposal = c.value.proposal,
      proposalBytes = JSON.stringify(proposal);
    if (decidedAt < proposal.createdAt) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    assertDecisionClock((await history(a)).value, decidedAt);
    let envelope: StudioProposalDecidedEnvelopeV4;
    let effect: ReturnType<typeof deriveStudioBoardProposalEffectV4> | null = null;
    if (status === 'accepted') {
      const applied = applyStudioCreateBoardV4(
        a.snapshot.project,
        {
          projectId: proposal.projectId,
          expectedAuthoringRevision: proposal.baseAuthoringRevision,
          handle: proposal.payload.handle,
          beats: proposal.payload.beats,
        },
        {
          boardId: proposal.target.boardId,
          beatIds: proposal.issuedMemberIds.beatIds,
          shotIds: proposal.issuedMemberIds.shotIds,
          capturedAt: decidedAt,
        }
      );
      if (applied.status !== 'applied') return { status: 'stale_authoring' };
      let built: StudioProposalDecidedEnvelopeV4 | null = null;
      a.snapshot.retainWriterForRecovery();
      await a.snapshot.commit(() => applied.project, {
        expectedRevision: a.snapshot.project.revision,
        kind: 'authoring',
        committedAt: decidedAt,
        authorizeBeforeReplace: async (evidence) => {
          const commit: StudioProposalCommitAttributionV4 = {
            schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
            kind: 'create_board',
            proposalId: proposal.id,
            projectId: proposal.projectId,
            beforeRevision: evidence.beforeRevision,
            afterRevision: evidence.afterRevision,
            beforeAuthoringRevision: evidence.beforeAuthoringRevision,
            afterAuthoringRevision: evidence.afterAuthoringRevision,
            target: { ...proposal.target },
            createdBeatIds: [...proposal.issuedMemberIds.beatIds],
            createdShotIds: [...proposal.issuedMemberIds.shotIds],
            proposalSha256: sha256(proposalBytes),
            beforeManifestSha256: evidence.beforeManifestSha256,
            afterManifestSha256: evidence.afterManifestSha256,
            committedAt: decidedAt,
          };
          built = terminalEnvelope(proposal, proposalBytes, status, decidedAt, commit);
          try {
            await a.publishDecidedV4(proposal.id, JSON.stringify(built));
          } catch (e) {
            const d = await decided(a, proposal.id);
            if (d === null || d.raw.bytes !== JSON.stringify(built)) throw e;
          }
          await step('terminal_transaction_durable', proposal.projectId);
        },
      });
      await step('project_committed', proposal.projectId);
      if (built === null) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      envelope = built;
      effect = deriveStudioBoardProposalEffectV4(proposal);
    } else {
      envelope = terminalEnvelope(proposal, proposalBytes, status, decidedAt);
      a.snapshot.retainWriterForRecovery();
      try {
        await a.publishDecidedV4(proposal.id, JSON.stringify(envelope));
      } catch (e) {
        const d = await decided(a, proposal.id);
        if (d === null || d.raw.bytes !== JSON.stringify(envelope)) throw e;
      }
      await step('terminal_transaction_durable', proposal.projectId);
    }
    const tx = envelope.terminalTransaction;
    const decision = json(tx.decisionBytes) as { decidedAt: string };
    const commit = tx.kind === 'accept_board' ? (json(tx.commitBytes) as StudioProposalCommitAttributionV4) : null;
    const t: StudioProposalTombstoneV4 = {
      proposalId: proposal.id,
      status,
      decidedAt: decision.decidedAt,
      payloadSha256: envelope.payloadSha256,
      commandSha256: proposal.source.commandSha256,
      appliedRevision: commit?.afterRevision ?? null,
      payloadRetained: true,
    };
    await appendHistory(a, t);
    await a.removeCurrentV4(c.raw);
    await step('pending_released', proposal.projectId);
    const h = await history(a);
    await prune(a, h.value, decidedAt);
    emit({ projectId: proposal.projectId, proposalId: proposal.id, status, recordedAt: decidedAt });
    return status === 'accepted'
      ? { status: 'accepted', effect: effect! }
      : status === 'rejected'
        ? { status: 'rejected' }
        : { status: 'expired' };
  };
  const recoverInside = async (
    a: StudioProposalLedgerWriterAuthorityV4,
    id: string
  ): Promise<StudioProposalDecisionResultV4 | null> => {
    const c = await current(a);
    const h = await history(a);
    const t = tombstone(h.value, id);
    if (t) {
      if (c?.value.proposalId === id) {
        if (c.value.payloadSha256 !== t.payloadSha256) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
        await a.removeCurrentV4(c.raw);
        await step('pending_released', a.snapshot.project.id);
      }
      await prune(a, h.value, now());
      return duplicateResult(t);
    }
    const d = await decided(a, id);
    if (d === null) return null;
    if (c === null || c.value.proposalId !== id || c.value.payloadSha256 !== d.value.payloadSha256)
      throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    const tx = d.value.terminalTransaction;
    const decision = json(tx.decisionBytes) as { status: StudioProposalDecisionStatusV4; decidedAt: string };
    if (tx.kind === 'accept_board') {
      const commit = json(tx.commitBytes) as StudioProposalCommitAttributionV4;
      let state = await a.snapshot.readCommitState();
      if (
        state.revision === commit.beforeRevision &&
        state.authoringRevision === commit.beforeAuthoringRevision &&
        state.manifestSha256 === commit.beforeManifestSha256
      ) {
        const applied = applyStudioCreateBoardV4(
          a.snapshot.project,
          {
            projectId: c.value.proposal.projectId,
            expectedAuthoringRevision: c.value.proposal.baseAuthoringRevision,
            handle: c.value.proposal.payload.handle,
            beats: c.value.proposal.payload.beats,
          },
          {
            boardId: c.value.proposal.target.boardId,
            beatIds: c.value.proposal.issuedMemberIds.beatIds,
            shotIds: c.value.proposal.issuedMemberIds.shotIds,
            capturedAt: decision.decidedAt,
          }
        );
        if (applied.status !== 'applied') throw new CreativeStudioProposalSidecarErrorV4('storage_error');
        await a.snapshot.commit(() => applied.project, {
          expectedRevision: commit.beforeRevision,
          kind: 'authoring',
          committedAt: decision.decidedAt,
          authorizeBeforeReplace: (evidence) => {
            if (
              evidence.afterRevision !== commit.afterRevision ||
              evidence.afterAuthoringRevision !== commit.afterAuthoringRevision ||
              evidence.afterManifestSha256 !== commit.afterManifestSha256
            ) {
              throw new CreativeStudioProposalSidecarErrorV4('storage_error');
            }
          },
        });
        state = await a.snapshot.readCommitState();
      }
      if (
        state.revision !== commit.afterRevision ||
        state.authoringRevision !== commit.afterAuthoringRevision ||
        state.manifestSha256 !== commit.afterManifestSha256
      ) {
        throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      }
      const tomb: StudioProposalTombstoneV4 = {
        proposalId: id,
        status: 'accepted',
        decidedAt: decision.decidedAt,
        payloadSha256: d.value.payloadSha256,
        commandSha256: d.value.proposal.source.commandSha256,
        appliedRevision: commit.afterRevision,
        payloadRetained: true,
      };
      await appendHistory(a, tomb);
      await a.removeCurrentV4(c.raw);
      await step('pending_released', a.snapshot.project.id);
      await prune(a, (await history(a)).value, now());
      return { status: 'already_accepted', decidedAt: decision.decidedAt, appliedRevision: commit.afterRevision };
    }
    const tomb: StudioProposalTombstoneV4 = {
      proposalId: id,
      status: decision.status,
      decidedAt: decision.decidedAt,
      payloadSha256: d.value.payloadSha256,
      commandSha256: d.value.proposal.source.commandSha256,
      appliedRevision: null,
      payloadRetained: true,
    };
    await appendHistory(a, tomb);
    await a.removeCurrentV4(c.raw);
    await step('pending_released', a.snapshot.project.id);
    await prune(a, (await history(a)).value, now());
    return decision.status === 'rejected' ? { status: 'rejected' } : { status: 'expired' };
  };

  const expireCurrentOnce = async (projectId: string): Promise<void> => {
    const captured = await withRead(projectId, current);
    if (captured === null) return;
    const observedAt = now();
    if (observedAt < captured.value.proposal.expiresAt) return;
    await withTerminal(projectId, captured.value.proposalId, async (a) => {
      const recovered = await recoverInside(a, captured.value.proposalId);
      if (recovered !== null) return;
      const locked = await current(a);
      if (locked?.value.proposalId !== captured.value.proposalId) return;
      const decisionAt = now();
      if (decisionAt < locked.value.proposal.expiresAt) return;
      await settle(a, locked, 'expired', decisionAt);
    });
  };

  const replay = async (
    inputValue: unknown,
    retryAfterRetiredWriter = true,
    waitForLocalWriter = true
  ): Promise<StudioProposalReplayResultV4> => {
    const input = inputSnapshot(inputValue);
    if (input === null) return { outcome: 'refused', reason: 'invalid_payload' };
    let admission: ReturnType<typeof admitStudioProposalRecordV4>;
    try {
      admission = admitStudioProposalRecordV4({
        projectId: input.projectId,
        proposalId: input.proposalId,
        value: input.proposal,
      });
    } catch {
      return { outcome: 'refused', reason: 'invalid_payload' };
    }
    if (admission.status !== 'valid' && admission.status !== 'proposal_too_large')
      return { outcome: 'refused', reason: 'invalid_payload' };
    try {
      await expireCurrentOnce(input.projectId);
      return await withTerminal(input.projectId, input.proposalId, async (a) => {
        const bytes = admission.proposalBytes,
          digest = sha256(bytes);
        // Replay is the recovery mechanism for a proposal whose receipt was not published. A
        // terminal envelope may already be durable while current.json still presents the proposal
        // as pending, so settle that exact residue before classifying the replayed payload.
        await recoverInside(a, input.proposalId);
        const c = await current(a);
        const h = await history(a);
        const terminal = tombstone(h.value, input.proposalId);
        if (terminal)
          return terminal.payloadSha256 === digest
            ? {
                outcome: 'already_decided',
                proposalId: input.proposalId,
                status: terminal.status,
                decidedAt: terminal.decidedAt,
                appliedRevision: terminal.appliedRevision,
              }
            : { outcome: 'identity_collision', proposalId: input.proposalId, expectedSha256: terminal.payloadSha256 };
        if (c) {
          if (c.value.proposalId === input.proposalId)
            return c.value.payloadSha256 === digest
              ? {
                  outcome: 'already_pending',
                  proposalId: input.proposalId,
                  proposal: structuredClone(c.value.proposal),
                  admittedAt: c.value.admittedAt,
                }
              : { outcome: 'identity_collision', proposalId: input.proposalId, expectedSha256: c.value.payloadSha256 };
          return { outcome: 'busy', holdingProposalId: c.value.proposalId };
        }
        const d = await decided(a, input.proposalId);
        if (d)
          return d.value.payloadSha256 === digest
            ? { outcome: 'unavailable', reason: 'corrupt_storage' }
            : { outcome: 'identity_collision', proposalId: input.proposalId, expectedSha256: d.value.payloadSha256 };
        if (admission.status === 'proposal_too_large') return { outcome: 'refused', reason: 'proposal_too_large' };
        const observed = now();
        assertDecisionClock(h.value, observed);
        if (
          Date.parse(admission.record.createdAt) - Date.parse(observed) > STUDIO_PROPOSAL_MAX_FUTURE_SKEW_MS_V4 ||
          observed >= admission.record.expiresAt ||
          admission.record.baseAuthoringRevision !== a.snapshot.project.authoringRevision
        )
          return { outcome: 'refused', reason: 'stale_authoring' };
        const feasibility = applyStudioCreateBoardV4(
          a.snapshot.project,
          {
            projectId: input.projectId,
            expectedAuthoringRevision: admission.record.baseAuthoringRevision,
            handle: admission.record.payload.handle,
            beats: admission.record.payload.beats,
          },
          {
            boardId: admission.record.target.boardId,
            beatIds: admission.record.issuedMemberIds.beatIds,
            shotIds: admission.record.issuedMemberIds.shotIds,
            capturedAt: observed,
          }
        );
        if (feasibility.status === 'refused') {
          switch (feasibility.reason) {
            case 'capacity_reached':
              return { outcome: 'refused', reason: 'board_capacity_reached' };
            case 'handle_taken':
              return { outcome: 'refused', reason: 'handle_collision' };
            case 'identity_collision':
              return { outcome: 'refused', reason: 'identity_collision' };
            case 'stale_project':
              return { outcome: 'refused', reason: 'stale_authoring' };
            case 'invalid_project':
            case 'invalid_request':
            case 'validation_failed':
              return { outcome: 'unavailable', reason: 'corrupt_storage' };
            default: {
              const exhaustive: never = feasibility.reason;
              return exhaustive;
            }
          }
        }
        const reserve: StudioProposalTombstoneV4 = {
          proposalId: admission.record.id,
          status: 'accepted',
          decidedAt: admission.record.expiresAt,
          payloadSha256: digest,
          commandSha256: admission.record.source.commandSha256,
          appliedRevision: Number.MAX_SAFE_INTEGER,
          payloadRetained: true,
        };
        const reservedHistory = historyAfterMaximumPruneFlags({
          schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
          entries: [...h.value.entries, reserve],
        });
        if (Buffer.byteLength(JSON.stringify(reservedHistory)) > historyMax)
          return { outcome: 'refused', reason: 'history_capacity' };
        await publishCurrent(a, admission.record, bytes);
        emit({
          projectId: input.projectId,
          proposalId: input.proposalId,
          status: 'recorded',
          recordedAt: admission.record.createdAt,
        });
        return { outcome: 'admitted', proposalId: input.proposalId, proposal: structuredClone(admission.record) };
      });
    } catch (error) {
      if (error instanceof CreativeStudioPilotStoreErrorV4 && error.code === 'busy') {
        try {
          if (waitForLocalWriter && (await options.projectStore.waitForLocalProjectWriterV4(input.projectId))) {
            return replay(inputValue, retryAfterRetiredWriter, false);
          }
          const intent = await options.projectStore.readProjectWriterIntentV4(input.projectId);
          if (intent?.purpose === 'proposal_terminal') {
            if (intent.proposalId !== input.proposalId) {
              return { outcome: 'busy', holdingProposalId: intent.proposalId };
            }
            if (retryAfterRetiredWriter) {
              await withTerminal(input.projectId, input.proposalId, (a) => recoverInside(a, input.proposalId), true);
              return replay(inputValue, false, false);
            }
          }
          // The competing writer may have retired between the failed acquire and this exact read.
          // Reclassify once from durable proposal state; never spin or infer success from elapsed time.
          if (intent === null && retryAfterRetiredWriter) return replay(inputValue, false, false);
        } catch {
          // An incomplete or unsafe writer record cannot support a user-visible proposal claim.
        }
      }
      return { outcome: 'unavailable', reason: 'corrupt_storage' };
    }
  };
  const sidecars: CreativeStudioProposalSidecarsV4 = {
    replayProposalV4: replay,
    async getProposalStateV4(projectId, id) {
      await expireCurrentOnce(projectId);
      return withRead(projectId, async (a) => {
        const c = await current(a);
        const h = await history(a);
        const t = tombstone(h.value, id);
        if (t) return { status: t.status, ...structuredClone(t) } as StudioProposalStateV4;
        return c?.value.proposalId === id
          ? { status: 'pending', proposal: structuredClone(c.value.proposal), admittedAt: c.value.admittedAt }
          : { status: 'unknown' };
      });
    },
    async getPendingProposalV4(projectId) {
      await expireCurrentOnce(projectId);
      return withRead(projectId, async (a) => {
        const c = await current(a);
        return c ? pendingSnapshot(c) : null;
      });
    },
    async recoverPendingProposalV4(projectId) {
      for (let pass = 0; pass < 2; pass += 1) {
        try {
          await expireCurrentOnce(projectId);
          return;
        } catch (e) {
          if (!(e instanceof CreativeStudioPilotStoreErrorV4) || e.code !== 'busy' || pass > 0) throw e;
          const intent = await options.projectStore.readProjectWriterIntentV4(projectId);
          if (intent?.purpose !== 'proposal_terminal' || intent.proposalId === undefined) return;
          const proposalId = intent.proposalId;
          await withTerminal(projectId, proposalId, (a) => recoverInside(a, proposalId), true);
        }
      }
    },
    recoverProposalTerminalV4: (p, id) => withTerminal(p, id, (a) => recoverInside(a, id), true),
    async acceptProposalV4(v) {
      const input = snapshotStudioProposalDecisionRequestV4(v);
      if (!input) return { status: 'unknown' };
      return withTerminal(input.projectId, input.proposalId, async (a) => {
        const recovered = await recoverInside(a, input.proposalId);
        if (recovered) return recovered;
        const h = await history(a),
          t = tombstone(h.value, input.proposalId);
        if (t) return duplicateResult(t);
        const c = await current(a);
        if (!c || c.value.proposalId !== input.proposalId) return { status: 'unknown' };
        const observed = now();
        if (observed >= c.value.proposal.expiresAt) return settle(a, c, 'expired', observed);
        if (c.value.proposal.baseAuthoringRevision !== a.snapshot.project.authoringRevision)
          return { status: 'stale_authoring' };
        return settle(a, c, 'accepted', observed);
      });
    },
    async rejectProposalV4(v) {
      const input = snapshotStudioProposalDecisionRequestV4(v);
      if (!input) return { status: 'unknown' };
      return withTerminal(input.projectId, input.proposalId, async (a) => {
        const recovered = await recoverInside(a, input.proposalId);
        if (recovered) return recovered;
        const h = await history(a),
          t = tombstone(h.value, input.proposalId);
        if (t) return duplicateResult(t);
        const c = await current(a);
        if (!c || c.value.proposalId !== input.proposalId) return { status: 'unknown' };
        const observed = now();
        return settle(a, c, observed >= c.value.proposal.expiresAt ? 'expired' : 'rejected', observed);
      });
    },
    watchProposalsV4(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return sidecars;
};
