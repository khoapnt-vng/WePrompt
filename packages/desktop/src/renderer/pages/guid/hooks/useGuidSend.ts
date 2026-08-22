/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  isIdpBuiltinServer,
  isImageGenBuiltinServer,
  isVisionBuiltinServer,
  mergeCommodityMcpServerIds,
} from '@/common/config/builtinCapabilities';
import type { IMcpServer, ISessionMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import {
  isPresentationConversationId,
  normalizePresentationConversationId,
} from '@/common/types/office/presentationConversationId';
import type {
  BindPresentationDraftResult,
  GetPresentationSourceOwnerResult,
  PresentationGrantOwner,
  PresentationRunFailure,
  PresentationRunPublicDto,
  PresentationSourceRef,
  StartPresentationRunResult,
} from '@/common/types/office/presentationRun';
import type { PresentationCommandQueueItem } from '@/common/types/platform/presentationCommandQueue';
import { toSessionMcpServer } from '@/renderer/hooks/mcp/catalog';
import {
  createPresentationCommandQueueController,
  type PresentationCommandQueueController,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { emitter } from '@/renderer/utils/emitter';
import { updateWorkspaceTime } from '@/renderer/utils/workspace/workspaceHistory';
import { Message } from '@arco-design/web-react';
import { useCallback, useRef, useState } from 'react';
import { type TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';
import { mutate as swrMutate } from 'swr';
import { getConversationCreateErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import { findProjectById } from '@/renderer/pages/conversation/projects/projectStorage';
import type { AcpModelInfo } from '../types';
import { resolveInjectedContext } from './resolveInjectedContext';

const GUID_PRESENTATION_PENDING_STORAGE_KEY = 'guid_presentation_submission_v2';
const GUID_PRESENTATION_CLAIM_EXTRA_KEY = 'weprompt_presentation_handoff';
const GUID_PRESENTATION_CLAIM_VERSION = 1;
const GUID_PRESENTATION_CATALOGUE_LIMIT = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

type GuidManagedPresentationAttemptFields = {
  queueItemId: string;
  clientRequestId: string;
  draftClientRequestId: string;
  input: string;
  selectedTemplateId: string;
  sources: PresentationSourceRef[];
  runtime: 'aionrs' | 'acp';
  capturedAt: string;
};

type GuidMarkerManagedPresentationAttempt = GuidManagedPresentationAttemptFields & {
  version: 3;
  claimMode: 'marker_v1';
  createPhase: 'not_started' | 'uncertain' | 'resolved';
  conversationId: string | null;
};

type GuidExactGetManagedPresentationAttempt = GuidManagedPresentationAttemptFields & {
  version: 3;
  claimMode: 'exact_get';
  createPhase: 'resolved';
  conversationId: string;
};

type GuidManagedPresentationAttempt = GuidMarkerManagedPresentationAttempt | GuidExactGetManagedPresentationAttempt;

type LegacyGuidManagedPresentationAttempt = GuidManagedPresentationAttemptFields & {
  version: 2;
  conversationId: string;
};

type StoredGuidManagedPresentationAttempt = GuidManagedPresentationAttempt | LegacyGuidManagedPresentationAttempt;

type ResolvedGuidManagedPresentationAttempt =
  | GuidExactGetManagedPresentationAttempt
  | (GuidMarkerManagedPresentationAttempt & { createPhase: 'resolved'; conversationId: string });

type GuidManagedPresentationAttemptSnapshot = {
  attempt: StoredGuidManagedPresentationAttempt;
  raw: string;
  existing: boolean;
  store: 'durable' | 'legacy_session';
};

export type GuidManagedPresentationRecovery = Pick<
  GuidManagedPresentationAttempt,
  'draftClientRequestId' | 'input' | 'selectedTemplateId' | 'sources' | 'runtime'
> & { conversationId?: string };

export type GuidManagedPresentationDeps = {
  selectedTemplateId: string;
  draftClientRequestId: string;
  sourceRefs: readonly PresentationSourceRef[];
  conversationId?: string;
  prepareSourceOwner: (
    recoveryConversationId?: string
  ) => Promise<GetPresentationSourceOwnerResult | PresentationRunFailure>;
  bindDraft: (conversationId: string) => Promise<BindPresentationDraftResult | null>;
  onHandoffAccepted?: () => void;
};

const copySourceRefs = (sources: readonly PresentationSourceRef[]): PresentationSourceRef[] =>
  sources.map((source) => ({
    grantId: source.grantId,
    expectedByteLength: source.expectedByteLength,
    expectedSha256: source.expectedSha256,
  }));

const sameSourceRefs = (left: readonly PresentationSourceRef[], right: readonly PresentationSourceRef[]): boolean =>
  left.length === right.length &&
  left.every(
    (source, index) =>
      source.grantId === right[index]?.grantId &&
      source.expectedByteLength === right[index]?.expectedByteLength &&
      source.expectedSha256 === right[index]?.expectedSha256
  );

const sourceRefsFromOwner = (
  result: Extract<GetPresentationSourceOwnerResult, { ok: true }>
): PresentationSourceRef[] =>
  result.grants.map((grant) => ({
    grantId: grant.grantId,
    expectedByteLength: grant.byteLength,
    expectedSha256: grant.sha256,
  }));

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted();
  const expected = keys.toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const decodePendingSourceRef = (value: unknown): PresentationSourceRef | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, ['grantId', 'expectedByteLength', 'expectedSha256'])) return null;
  if (
    typeof candidate.grantId !== 'string' ||
    !UUID_RE.test(candidate.grantId) ||
    typeof candidate.expectedByteLength !== 'number' ||
    !Number.isSafeInteger(candidate.expectedByteLength) ||
    candidate.expectedByteLength < 0 ||
    typeof candidate.expectedSha256 !== 'string' ||
    !SHA256_RE.test(candidate.expectedSha256)
  ) {
    return null;
  }
  return {
    grantId: candidate.grantId,
    expectedByteLength: candidate.expectedByteLength,
    expectedSha256: candidate.expectedSha256,
  };
};

type DecodedGuidAttemptFields = GuidManagedPresentationAttemptFields;

const decodeGuidAttemptFields = (candidate: Record<string, unknown>): DecodedGuidAttemptFields | null => {
  if (
    typeof candidate.queueItemId !== 'string' ||
    !UUID_RE.test(candidate.queueItemId) ||
    typeof candidate.clientRequestId !== 'string' ||
    !UUID_RE.test(candidate.clientRequestId) ||
    typeof candidate.draftClientRequestId !== 'string' ||
    !UUID_RE.test(candidate.draftClientRequestId) ||
    typeof candidate.input !== 'string' ||
    typeof candidate.selectedTemplateId !== 'string' ||
    candidate.selectedTemplateId.length === 0 ||
    (candidate.runtime !== 'aionrs' && candidate.runtime !== 'acp') ||
    typeof candidate.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.capturedAt)) ||
    !Array.isArray(candidate.sources)
  ) {
    return null;
  }
  const sources = candidate.sources.map(decodePendingSourceRef);
  if (sources.some((source) => source === null)) return null;
  return {
    queueItemId: candidate.queueItemId,
    clientRequestId: candidate.clientRequestId,
    draftClientRequestId: candidate.draftClientRequestId,
    input: candidate.input,
    selectedTemplateId: candidate.selectedTemplateId,
    sources: sources as PresentationSourceRef[],
    runtime: candidate.runtime,
    capturedAt: candidate.capturedAt,
  };
};

const parseGuidAttemptRecord = (raw: string): Record<string, unknown> | null => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const decodeGuidManagedAttempt = (raw: string): GuidManagedPresentationAttempt | null => {
  const candidate = parseGuidAttemptRecord(raw);
  if (candidate === null) return null;
  if (
    !hasExactKeys(candidate, [
      'version',
      'claimMode',
      'createPhase',
      'conversationId',
      'queueItemId',
      'clientRequestId',
      'draftClientRequestId',
      'input',
      'selectedTemplateId',
      'sources',
      'runtime',
      'capturedAt',
    ]) ||
    candidate.version !== 3 ||
    (candidate.claimMode !== 'marker_v1' && candidate.claimMode !== 'exact_get')
  ) {
    return null;
  }
  const fields = decodeGuidAttemptFields(candidate);
  if (fields === null) return null;
  if (candidate.claimMode === 'exact_get') {
    if (candidate.createPhase !== 'resolved' || !isPresentationConversationId(candidate.conversationId)) return null;
    return {
      version: 3,
      claimMode: 'exact_get',
      createPhase: 'resolved',
      conversationId: candidate.conversationId,
      ...fields,
    };
  }
  if (
    (candidate.createPhase !== 'not_started' &&
      candidate.createPhase !== 'uncertain' &&
      candidate.createPhase !== 'resolved') ||
    (candidate.createPhase === 'resolved'
      ? !isPresentationConversationId(candidate.conversationId)
      : candidate.conversationId !== null)
  ) {
    return null;
  }
  return {
    version: 3,
    claimMode: 'marker_v1',
    createPhase: candidate.createPhase,
    conversationId: candidate.conversationId as string | null,
    ...fields,
  } as GuidMarkerManagedPresentationAttempt;
};

const decodeLegacyGuidManagedAttempt = (
  raw: string
): { attempt: LegacyGuidManagedPresentationAttempt; canonicalRaw: string } | null => {
  const candidate = parseGuidAttemptRecord(raw);
  if (candidate === null) return null;
  if (
    !hasExactKeys(candidate, [
      'version',
      'conversationId',
      'queueItemId',
      'clientRequestId',
      'draftClientRequestId',
      'input',
      'selectedTemplateId',
      'sources',
      'runtime',
      'capturedAt',
    ]) ||
    candidate.version !== 2 ||
    typeof candidate.conversationId !== 'string' ||
    !UUID_RE.test(candidate.conversationId)
  ) {
    return null;
  }
  const conversationId = normalizePresentationConversationId(candidate.conversationId);
  if (conversationId === null) return null;
  const fields = decodeGuidAttemptFields(candidate);
  if (fields === null) return null;
  const attempt: LegacyGuidManagedPresentationAttempt = {
    version: 2,
    conversationId,
    ...fields,
  };
  return { attempt, canonicalRaw: JSON.stringify(attempt) };
};

const upgradeLegacyGuidManagedAttempt = (
  legacy: LegacyGuidManagedPresentationAttempt
): GuidExactGetManagedPresentationAttempt => ({
  version: 3,
  claimMode: 'exact_get',
  createPhase: 'resolved',
  conversationId: legacy.conversationId,
  queueItemId: legacy.queueItemId,
  clientRequestId: legacy.clientRequestId,
  draftClientRequestId: legacy.draftClientRequestId,
  input: legacy.input,
  selectedTemplateId: legacy.selectedTemplateId,
  sources: copySourceRefs(legacy.sources),
  runtime: legacy.runtime,
  capturedAt: legacy.capturedAt,
});

const readGuidPendingStores = (): { durableRaw: string | null; sessionRaw: string | null } => ({
  durableRaw: localStorage.getItem(GUID_PRESENTATION_PENDING_STORAGE_KEY),
  sessionRaw: sessionStorage.getItem(GUID_PRESENTATION_PENDING_STORAGE_KEY),
});

const removeExactGuidSessionSnapshot = (durableRaw: string, sessionRaw: string): void => {
  const before = readGuidPendingStores();
  if (before.durableRaw !== durableRaw || before.sessionRaw !== sessionRaw) {
    throw new Error('Managed Guid presentation pending migration changed concurrently');
  }
  sessionStorage.removeItem(GUID_PRESENTATION_PENDING_STORAGE_KEY);
  const after = readGuidPendingStores();
  if (after.durableRaw !== durableRaw || after.sessionRaw !== null) {
    throw new Error('Managed Guid presentation pending session snapshot could not be removed');
  }
};

const readGuidManagedAttempt = (): GuidManagedPresentationAttemptSnapshot | null => {
  const { durableRaw, sessionRaw } = readGuidPendingStores();
  if (durableRaw !== null) {
    const durable = decodeGuidManagedAttempt(durableRaw);
    if (durable === null) throw new Error('Managed Guid durable presentation pending snapshot is invalid');
    if (sessionRaw !== null) {
      const sessionCurrent = decodeGuidManagedAttempt(sessionRaw);
      if (sessionCurrent !== null) {
        if (sessionRaw !== durableRaw) {
          throw new Error('Managed Guid presentation pending stores conflict');
        }
      } else {
        const sessionLegacy = decodeLegacyGuidManagedAttempt(sessionRaw);
        if (
          sessionLegacy === null ||
          sessionLegacy.canonicalRaw !== sessionRaw ||
          JSON.stringify(upgradeLegacyGuidManagedAttempt(sessionLegacy.attempt)) !== durableRaw
        ) {
          throw new Error('Managed Guid presentation pending stores conflict');
        }
      }
      removeExactGuidSessionSnapshot(durableRaw, sessionRaw);
    }
    return { attempt: durable, raw: durableRaw, existing: true, store: 'durable' };
  }
  if (sessionRaw === null) return null;
  const sessionCurrent = decodeGuidManagedAttempt(sessionRaw);
  if (sessionCurrent !== null) {
    const before = readGuidPendingStores();
    if (before.durableRaw !== null || before.sessionRaw !== sessionRaw) {
      throw new Error('Managed Guid presentation pending migration changed concurrently');
    }
    localStorage.setItem(GUID_PRESENTATION_PENDING_STORAGE_KEY, sessionRaw);
    const written = readGuidPendingStores();
    if (written.durableRaw !== sessionRaw || written.sessionRaw !== sessionRaw) {
      throw new Error('Managed Guid presentation pending durable migration was not accepted');
    }
    removeExactGuidSessionSnapshot(sessionRaw, sessionRaw);
    return { attempt: sessionCurrent, raw: sessionRaw, existing: true, store: 'durable' };
  }
  const legacy = decodeLegacyGuidManagedAttempt(sessionRaw);
  if (legacy === null) throw new Error('Managed Guid presentation pending snapshot is invalid');
  if (legacy.canonicalRaw !== sessionRaw) {
    const before = readGuidPendingStores();
    if (before.durableRaw !== null || before.sessionRaw !== sessionRaw) {
      throw new Error('Managed Guid presentation pending snapshot changed during migration');
    }
    sessionStorage.setItem(GUID_PRESENTATION_PENDING_STORAGE_KEY, legacy.canonicalRaw);
    const after = readGuidPendingStores();
    if (after.durableRaw !== null || after.sessionRaw !== legacy.canonicalRaw) {
      throw new Error('Managed Guid presentation pending snapshot migration was not durably accepted');
    }
  }
  return { attempt: legacy.attempt, raw: legacy.canonicalRaw, existing: true, store: 'legacy_session' };
};

const transitionGuidManagedAttempt = (
  snapshot: GuidManagedPresentationAttemptSnapshot,
  nextAttempt: GuidManagedPresentationAttempt
): GuidManagedPresentationAttemptSnapshot => {
  const serialized = JSON.stringify(nextAttempt);
  if (decodeGuidManagedAttempt(serialized) === null) {
    throw new Error('Managed Guid presentation pending transition is invalid');
  }
  const before = readGuidPendingStores();
  if (snapshot.store === 'durable') {
    if (before.durableRaw !== snapshot.raw || before.sessionRaw !== null) {
      throw new Error('Managed Guid presentation pending snapshot changed concurrently');
    }
    localStorage.setItem(GUID_PRESENTATION_PENDING_STORAGE_KEY, serialized);
    const after = readGuidPendingStores();
    if (after.durableRaw !== serialized || after.sessionRaw !== null) {
      throw new Error('Managed Guid presentation pending transition was not durably accepted');
    }
  } else {
    if (
      snapshot.attempt.version !== 2 ||
      serialized !== JSON.stringify(upgradeLegacyGuidManagedAttempt(snapshot.attempt))
    ) {
      throw new Error('Managed Guid legacy presentation pending transition is not an exact upgrade');
    }
    if (before.durableRaw !== null || before.sessionRaw !== snapshot.raw) {
      throw new Error('Managed Guid legacy presentation pending snapshot changed concurrently');
    }
    localStorage.setItem(GUID_PRESENTATION_PENDING_STORAGE_KEY, serialized);
    const written = readGuidPendingStores();
    if (written.durableRaw !== serialized || written.sessionRaw !== snapshot.raw) {
      throw new Error('Managed Guid legacy presentation pending transition was not durably accepted');
    }
    removeExactGuidSessionSnapshot(serialized, snapshot.raw);
  }
  return { attempt: nextAttempt, raw: serialized, existing: true, store: 'durable' };
};

export const readGuidManagedPresentationRecovery = (): GuidManagedPresentationRecovery | null => {
  try {
    const snapshot = readGuidManagedAttempt();
    if (snapshot === null) return null;
    const { attempt } = snapshot;
    return {
      ...(attempt.conversationId === null ? {} : { conversationId: attempt.conversationId }),
      draftClientRequestId: attempt.draftClientRequestId,
      input: attempt.input,
      selectedTemplateId: attempt.selectedTemplateId,
      sources: copySourceRefs(attempt.sources),
      runtime: attempt.runtime,
    };
  } catch {
    return null;
  }
};

const hasSamePendingAttemptIdentity = (
  attempt: StoredGuidManagedPresentationAttempt,
  input: string,
  runtime: 'aionrs' | 'acp',
  managed: GuidManagedPresentationDeps
): boolean => {
  const managedConversationId =
    managed.conversationId === undefined ? undefined : normalizePresentationConversationId(managed.conversationId);
  if (managedConversationId === null) return false;
  return (
    attempt.input === input &&
    attempt.runtime === runtime &&
    attempt.selectedTemplateId === managed.selectedTemplateId &&
    (managedConversationId === undefined || attempt.conversationId === managedConversationId)
  );
};

const isExactPendingAttempt = (
  attempt: StoredGuidManagedPresentationAttempt,
  input: string,
  runtime: 'aionrs' | 'acp',
  managed: GuidManagedPresentationDeps
): boolean =>
  hasSamePendingAttemptIdentity(attempt, input, runtime, managed) &&
  attempt.draftClientRequestId === managed.draftClientRequestId &&
  sameSourceRefs(attempt.sources, managed.sourceRefs);

const getOrCreateGuidManagedAttempt = (
  input: string,
  runtime: 'aionrs' | 'acp',
  managed: GuidManagedPresentationDeps
): GuidManagedPresentationAttemptSnapshot => {
  const existing = readGuidManagedAttempt();
  if (existing !== null) return existing;
  const conversationId =
    managed.conversationId === undefined ? null : normalizePresentationConversationId(managed.conversationId);
  if (managed.conversationId !== undefined && conversationId === null) {
    throw new Error('Managed Guid presentation conversation id is invalid');
  }
  const fields: DecodedGuidAttemptFields = {
    queueItemId: crypto.randomUUID(),
    clientRequestId: crypto.randomUUID(),
    draftClientRequestId: managed.draftClientRequestId,
    input,
    selectedTemplateId: managed.selectedTemplateId,
    sources: copySourceRefs(managed.sourceRefs),
    runtime,
    capturedAt: new Date().toISOString(),
  };
  const attempt: GuidManagedPresentationAttempt =
    conversationId === null
      ? { version: 3, claimMode: 'marker_v1', createPhase: 'not_started', conversationId: null, ...fields }
      : { version: 3, claimMode: 'exact_get', createPhase: 'resolved', conversationId, ...fields };
  const serialized = JSON.stringify(attempt);
  const before = readGuidPendingStores();
  if (before.durableRaw !== null || before.sessionRaw !== null) {
    throw new Error('Managed Guid presentation pending snapshot appeared concurrently');
  }
  localStorage.setItem(GUID_PRESENTATION_PENDING_STORAGE_KEY, serialized);
  const after = readGuidPendingStores();
  if (after.durableRaw !== serialized || after.sessionRaw !== null) {
    throw new Error('Managed Guid presentation pending snapshot was not durably accepted');
  }
  return { attempt, raw: serialized, existing: false, store: 'durable' };
};

const clearGuidManagedAttempt = (snapshot: GuidManagedPresentationAttemptSnapshot): void => {
  if (snapshot.store !== 'durable') {
    throw new Error('Managed Guid legacy presentation pending snapshot cannot be cleared directly');
  }
  const before = readGuidPendingStores();
  if (before.durableRaw !== snapshot.raw || before.sessionRaw !== null) {
    throw new Error('Managed Guid presentation pending snapshot changed before clear');
  }
  localStorage.removeItem(GUID_PRESENTATION_PENDING_STORAGE_KEY);
  const after = readGuidPendingStores();
  if (after.durableRaw !== null || after.sessionRaw !== null) {
    throw new Error('Managed Guid presentation pending snapshot could not be cleared');
  }
};

const isExactQueueItem = (
  item: PresentationCommandQueueItem,
  attempt: ResolvedGuidManagedPresentationAttempt
): boolean =>
  item.queueItemId === attempt.queueItemId &&
  item.clientRequestId === attempt.clientRequestId &&
  item.input === attempt.input &&
  item.selectedTemplateId === attempt.selectedTemplateId &&
  sameSourceRefs(item.sources, attempt.sources);

const findExactQueueItem = (
  controller: PresentationCommandQueueController,
  attempt: ResolvedGuidManagedPresentationAttempt
): PresentationCommandQueueItem | null => {
  const candidate = controller
    .read()
    .items.find((item) => item.queueItemId === attempt.queueItemId || item.clientRequestId === attempt.clientRequestId);
  if (candidate === undefined) return null;
  if (!isExactQueueItem(candidate, attempt)) {
    throw new Error('Managed Guid presentation queue identity collision');
  }
  return candidate;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validateConversationRuntimeAndId = (
  conversation: TChatConversation,
  runtime: GuidManagedPresentationAttempt['runtime']
): string => {
  const conversationId = normalizePresentationConversationId(conversation.id);
  if (conversationId === null || conversation.type !== runtime) {
    throw new Error('Managed Guid conversation identity or runtime is invalid');
  }
  return conversationId;
};

const hasExactGuidClaim = (conversation: TChatConversation, queueItemId: string): boolean => {
  const extra = isRecord(conversation.extra) ? conversation.extra : null;
  const rawClaim = extra?.[GUID_PRESENTATION_CLAIM_EXTRA_KEY];
  if (!isRecord(rawClaim) || rawClaim.queue_item_id !== queueItemId) return false;
  if (
    !hasExactKeys(rawClaim, ['version', 'queue_item_id']) ||
    rawClaim.version !== GUID_PRESENTATION_CLAIM_VERSION ||
    typeof rawClaim.queue_item_id !== 'string' ||
    !UUID_RE.test(rawClaim.queue_item_id)
  ) {
    throw new Error('Managed Guid conversation claimant is malformed');
  }
  return true;
};

const findGuidClaimedConversation = async (
  attempt: GuidMarkerManagedPresentationAttempt
): Promise<TChatConversation | null> => {
  const catalogue = await ipcBridge.database.getUserConversations.invoke({
    limit: GUID_PRESENTATION_CATALOGUE_LIMIT,
  });
  if (
    catalogue === null ||
    !Array.isArray(catalogue.items) ||
    !Number.isSafeInteger(catalogue.total) ||
    catalogue.total < 0 ||
    catalogue.total > GUID_PRESENTATION_CATALOGUE_LIMIT ||
    catalogue.items.length > GUID_PRESENTATION_CATALOGUE_LIMIT ||
    catalogue.has_more !== false ||
    catalogue.total !== catalogue.items.length
  ) {
    throw new Error('Managed Guid conversation catalogue is incomplete');
  }
  const matches: TChatConversation[] = [];
  for (const conversation of catalogue.items) {
    if (!hasExactGuidClaim(conversation, attempt.queueItemId)) continue;
    const conversationId = validateConversationRuntimeAndId(conversation, attempt.runtime);
    matches.push({ ...conversation, id: conversationId });
  }
  if (matches.length > 1) throw new Error('Managed Guid conversation claimant is ambiguous');
  return matches[0] ?? null;
};

const resolveLegacyGuidConversation = async (
  snapshot: GuidManagedPresentationAttemptSnapshot
): Promise<{
  snapshot: GuidManagedPresentationAttemptSnapshot;
  attempt: ResolvedGuidManagedPresentationAttempt;
  conversation: TChatConversation;
}> => {
  const legacy = snapshot.attempt;
  if (legacy.version !== 2) throw new Error('Managed Guid legacy conversation recovery is invalid');
  const conversation = await ipcBridge.conversation.get.invoke({ id: legacy.conversationId });
  const canonicalConversationId =
    conversation == null ? null : validateConversationRuntimeAndId(conversation, legacy.runtime);
  if (
    conversation == null ||
    canonicalConversationId !== legacy.conversationId ||
    (isRecord(conversation.extra) && Object.hasOwn(conversation.extra, GUID_PRESENTATION_CLAIM_EXTRA_KEY))
  ) {
    throw new Error('Managed Guid legacy conversation is not authoritative');
  }
  const nextAttempt = upgradeLegacyGuidManagedAttempt(legacy);
  const migratedSnapshot = transitionGuidManagedAttempt(snapshot, nextAttempt);
  return {
    snapshot: migratedSnapshot,
    attempt: nextAttempt,
    conversation: { ...conversation, id: canonicalConversationId },
  };
};

const resolveGuidConversation = async (
  snapshot: GuidManagedPresentationAttemptSnapshot,
  request?: Parameters<typeof ipcBridge.conversation.create.invoke>[0]
): Promise<{
  snapshot: GuidManagedPresentationAttemptSnapshot;
  attempt: ResolvedGuidManagedPresentationAttempt;
  conversation: TChatConversation;
}> => {
  const current = snapshot.attempt;
  if (current.version !== 3) return resolveLegacyGuidConversation(snapshot);
  if (current.claimMode === 'exact_get') {
    const conversation = await ipcBridge.conversation.get.invoke({ id: current.conversationId });
    if (
      conversation == null ||
      validateConversationRuntimeAndId(conversation, current.runtime) !== current.conversationId ||
      (isRecord(conversation.extra) && Object.hasOwn(conversation.extra, GUID_PRESENTATION_CLAIM_EXTRA_KEY))
    ) {
      throw new Error('Managed Guid exact-get conversation is not authoritative');
    }
    return {
      snapshot,
      attempt: current,
      conversation: { ...conversation, id: current.conversationId },
    };
  }
  if (current.createPhase === 'resolved') {
    const conversation = await ipcBridge.conversation.get.invoke({ id: current.conversationId });
    if (
      conversation == null ||
      validateConversationRuntimeAndId(conversation, current.runtime) !== current.conversationId ||
      !hasExactGuidClaim(conversation, current.queueItemId)
    ) {
      throw new Error('Managed Guid resolved conversation is not authoritative');
    }
    return {
      snapshot,
      attempt: current as ResolvedGuidManagedPresentationAttempt,
      conversation: { ...conversation, id: current.conversationId },
    };
  }

  const claimed = await findGuidClaimedConversation(current);
  if (claimed !== null) {
    const conversationId = validateConversationRuntimeAndId(claimed, current.runtime);
    const resolved: ResolvedGuidManagedPresentationAttempt = {
      ...current,
      createPhase: 'resolved',
      conversationId,
    };
    return { snapshot: transitionGuidManagedAttempt(snapshot, resolved), attempt: resolved, conversation: claimed };
  }
  if (current.createPhase === 'uncertain') {
    throw new Error('Managed Guid conversation creation remains uncertain');
  }
  if (request === undefined) throw new Error('Managed Guid conversation create request is unavailable');

  const uncertain: GuidManagedPresentationAttempt = {
    ...current,
    createPhase: 'uncertain',
    conversationId: null,
  };
  const uncertainSnapshot = transitionGuidManagedAttempt(snapshot, uncertain);
  const { id: _unsupportedClientId, ...requestWithoutId } = request;
  const createRequest = {
    ...requestWithoutId,
    extra: {
      ...request.extra,
      [GUID_PRESENTATION_CLAIM_EXTRA_KEY]: {
        version: GUID_PRESENTATION_CLAIM_VERSION as 1,
        queue_item_id: current.queueItemId,
      },
    },
  };

  let conversation: TChatConversation;
  try {
    conversation = await ipcBridge.conversation.create.invoke(createRequest);
  } catch (error) {
    const recovered = await findGuidClaimedConversation(uncertain);
    if (recovered === null) throw error;
    conversation = recovered;
  }
  const conversationId = validateConversationRuntimeAndId(conversation, current.runtime);
  if (!hasExactGuidClaim(conversation, current.queueItemId)) {
    throw new Error('Managed Guid conversation create reply has no authoritative claimant');
  }
  const resolved: ResolvedGuidManagedPresentationAttempt = {
    ...uncertain,
    createPhase: 'resolved',
    conversationId,
  };
  return {
    snapshot: transitionGuidManagedAttempt(uncertainSnapshot, resolved),
    attempt: resolved,
    conversation: { ...conversation, id: conversationId },
  };
};

type SafeGuidHandoffExecution = Extract<
  PresentationCommandQueueItem['execution'],
  { state: 'committed' | 'dispatching' | 'bound' | 'dispatch_uncertain' }
>;

type SafeGuidHandoffItem = PresentationCommandQueueItem & { execution: SafeGuidHandoffExecution };

const isSafeGuidHandoff = (item: PresentationCommandQueueItem): item is SafeGuidHandoffItem =>
  item.execution.state === 'committed' ||
  item.execution.state === 'dispatching' ||
  item.execution.state === 'bound' ||
  item.execution.state === 'dispatch_uncertain';

const AUTHORITATIVE_GUID_SUCCESSORS = {
  committed: [
    'committed',
    'dispatching',
    'bound',
    'terminal_verified',
    'retained',
    'failed_retained',
    'dispatch_uncertain',
    'discarded',
  ],
  dispatching: [
    'dispatching',
    'bound',
    'terminal_verified',
    'retained',
    'failed_retained',
    'dispatch_uncertain',
    'discarded',
  ],
  bound: ['bound', 'terminal_verified', 'retained', 'failed_retained', 'dispatch_uncertain', 'discarded'],
  dispatch_uncertain: ['dispatch_uncertain'],
} as const satisfies Record<SafeGuidHandoffExecution['state'], readonly PresentationRunPublicDto['dispatchStatus'][]>;

const isAuthoritativeGuidSuccessor = (execution: SafeGuidHandoffExecution, run: PresentationRunPublicDto): boolean => {
  const successors = AUTHORITATIVE_GUID_SUCCESSORS[
    execution.state
  ] as readonly PresentationRunPublicDto['dispatchStatus'][];
  if (!successors.includes(run.dispatchStatus)) return false;
  const localRevision = execution.revision;
  if (localRevision === null) return run.dispatchStatus === execution.state;
  return run.dispatchStatus === execution.state ? run.revision >= localRevision : run.revision > localRevision;
};

const proveAuthoritativeGuidHandoff = async (
  item: SafeGuidHandoffItem,
  attempt: ResolvedGuidManagedPresentationAttempt
): Promise<boolean> => {
  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: attempt.conversationId });
    if (normalizePresentationConversationId(conversation?.id) !== attempt.conversationId) return false;
    const lookup = await ipcBridge.presentationRuns.get.invoke({
      conversation_id: attempt.conversationId,
      client_request_id: attempt.clientRequestId,
    });
    if (!lookup.ok) return false;
    return (
      lookup.run.runId === item.execution.runId &&
      lookup.run.clientRequestId === attempt.clientRequestId &&
      normalizePresentationConversationId(lookup.run.conversationId) === attempt.conversationId &&
      lookup.run.selectedTemplateId === attempt.selectedTemplateId &&
      isAuthoritativeGuidSuccessor(item.execution, lookup.run)
    );
  } catch {
    return false;
  }
};

const recoveredCommittedStart = (
  run: PresentationRunPublicDto,
  attempt: ResolvedGuidManagedPresentationAttempt
): StartPresentationRunResult | null => {
  if (
    run.dispatchStatus !== 'committed' ||
    run.artifactPhase === 'none' ||
    normalizePresentationConversationId(run.conversationId) !== attempt.conversationId ||
    run.clientRequestId !== attempt.clientRequestId ||
    run.selectedTemplateId !== attempt.selectedTemplateId
  ) {
    return null;
  }
  return {
    ok: true,
    run: {
      ...run,
      conversationId: attempt.conversationId,
      dispatchStatus: 'committed',
      artifactPhase: run.artifactPhase,
    },
  };
};

const allocateClaimedGuidHandoff = (
  controller: PresentationCommandQueueController,
  attempt: ResolvedGuidManagedPresentationAttempt
): Promise<PresentationCommandQueueItem> =>
  controller.allocateClaimed(attempt.queueItemId, async (request) => {
    try {
      return await ipcBridge.presentationRuns.start.invoke(request);
    } catch (error) {
      const lookup = await ipcBridge.presentationRuns.get.invoke({
        conversation_id: attempt.conversationId,
        client_request_id: attempt.clientRequestId,
      });
      if (lookup.ok) {
        const recovered = recoveredCommittedStart(lookup.run, attempt);
        if (recovered !== null) return recovered;
      }
      throw error;
    }
  });

export type GuidManagedPresentationSourceChange =
  | { kind: 'added' }
  | { kind: 'revoked'; grantId: string; queueUnboundAtRevoke: true };

export type GuidSendDeps = {
  // Input state
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  files: string[];
  setFiles: React.Dispatch<React.SetStateAction<string[]>>;
  dir: string;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  projectId?: string;
  setProjectId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;

  // Assistant state
  selectedAssistantId: string | null;
  selectedAssistantBackend: string;
  selectedMode: string;
  selectedAcpModel: string | null;
  selectedThoughtLevelValue?: string;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  current_model: TProviderWithModel | undefined;

  guidDisabledBuiltinSkills: string[] | undefined;
  guidEnabledSkills: string[] | undefined;
  assistantDefaultSkillIds?: string[];
  assistantDefaultDisabledBuiltinSkillIds?: string[];
  availableMcpServers: IMcpServer[];
  selectedMcpServerIds: string[] | undefined;
  assistantDefaultMcpIds?: string[];
  isGoogleAuth: boolean;

  // Mention state reset
  setMentionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionQuery: React.Dispatch<React.SetStateAction<string | null>>;
  setMentionSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionActiveIndex: React.Dispatch<React.SetStateAction<number>>;

  // Presentation template (optional — landing-page gallery wiring)
  composePresentationSend?: (
    message: string,
    files: string[]
  ) => { input: string; files: string[]; injectSkills: string[] };
  onPresentationTemplateConsumed?: () => void;
  requiresPresentationSourceReselect?: boolean;
  onPresentationSourceReselectRequired?: () => void;
  managedPresentation?: GuidManagedPresentationDeps;

  // Navigation
  navigate: NavigateFunction;
  t: TFunction;
  localeKey: string;
};

export type GuidSendResult = {
  handleSend: () => Promise<void>;
  sendMessageHandler: () => void;
  isButtonDisabled: boolean;
  managedPresentationRecovery: GuidManagedPresentationRecovery | null;
  managedPresentationPending: boolean;
  retireManagedPresentationAttemptAfterSourceChange: (
    change: GuidManagedPresentationSourceChange | null
  ) => Promise<void>;
};

/**
 * Hook that manages the send logic for ACP and Aion CLI conversations.
 */
export const useGuidSend = (deps: GuidSendDeps): GuidSendResult => {
  const {
    input,
    setInput,
    files,
    setFiles,
    dir,
    setDir,
    projectId,
    setProjectId,
    setLoading,
    loading,
    selectedAssistantId,
    selectedAssistantBackend,
    selectedMode,
    selectedAcpModel,
    selectedThoughtLevelValue,
    currentAcpCachedModelInfo,
    current_model,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    assistantDefaultSkillIds,
    assistantDefaultDisabledBuiltinSkillIds,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultMcpIds,
    composePresentationSend,
    onPresentationTemplateConsumed,
    requiresPresentationSourceReselect,
    onPresentationSourceReselectRequired,
    managedPresentation,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    navigate,
    t,
    localeKey,
  } = deps;
  const sendingRef = useRef(false);
  const [managedPresentationRecovery] = useState(readGuidManagedPresentationRecovery);
  const [managedPresentationPending, setManagedPresentationPending] = useState(false);

  const handleSend = useCallback(async () => {
    if (!selectedAssistantId) {
      return;
    }

    const managedRuntime: 'aionrs' | 'acp' = selectedAssistantBackend === 'aionrs' ? 'aionrs' : 'acp';
    let managedAttemptState = managedPresentation
      ? getOrCreateGuidManagedAttempt(input, managedRuntime, managedPresentation)
      : null;
    let managedResolvedConversation: TChatConversation | null = null;
    let managedResolvedAttempt: ResolvedGuidManagedPresentationAttempt | null = null;
    if (
      managedAttemptState?.attempt.version === 2 ||
      (managedAttemptState?.attempt.version === 3 &&
        (managedAttemptState.attempt.createPhase === 'resolved' ||
          managedAttemptState.attempt.createPhase === 'uncertain'))
    ) {
      const resolved =
        managedAttemptState.attempt.version === 2
          ? await resolveLegacyGuidConversation(managedAttemptState)
          : await resolveGuidConversation(managedAttemptState);
      managedAttemptState = resolved.snapshot;
      managedResolvedAttempt = resolved.attempt;
      managedResolvedConversation = resolved.conversation;
    }
    let managedQueueController: PresentationCommandQueueController | null =
      managedResolvedAttempt === null
        ? null
        : createPresentationCommandQueueController({ conversationId: managedResolvedAttempt.conversationId });
    if (managedAttemptState?.existing && managedQueueController && managedResolvedAttempt) {
      const existingHandoff = findExactQueueItem(managedQueueController, managedResolvedAttempt);
      if (existingHandoff !== null && isSafeGuidHandoff(existingHandoff)) {
        if (!(await proveAuthoritativeGuidHandoff(existingHandoff, managedResolvedAttempt))) {
          throw new Error('Managed Guid presentation handoff is not confirmed by main');
        }
        await navigate(`/conversation/${managedResolvedAttempt.conversationId}`);
        clearGuidManagedAttempt(managedAttemptState);
        managedPresentation?.onHandoffAccepted?.();
        return;
      }
      if (
        existingHandoff !== null &&
        (existingHandoff.execution.state === 'persisting' ||
          existingHandoff.execution.state === 'queued' ||
          existingHandoff.execution.state === 'claimed')
      ) {
        if (
          managedPresentation === undefined ||
          !hasSamePendingAttemptIdentity(managedResolvedAttempt, input, managedRuntime, managedPresentation)
        ) {
          throw new Error('Managed Guid presentation attempt belongs to another submission');
        }
        let resumed: PresentationCommandQueueItem | null = existingHandoff;
        if (resumed.execution.state === 'persisting') {
          if (isExactPendingAttempt(managedResolvedAttempt, input, managedRuntime, managedPresentation)) {
            await managedQueueController.recoverPersisting();
          } else {
            const retirement = await managedQueueController.retirePersisting(resumed.queueItemId);
            if (retirement === 'removed') resumed = null;
          }
          if (resumed !== null) {
            const recovered = findExactQueueItem(managedQueueController, managedResolvedAttempt);
            if (recovered === null) {
              throw new Error('Managed Guid presentation queue recovery lost its frozen item');
            }
            resumed = recovered;
          }
        }
        if (resumed !== null) {
          if (resumed.execution.state === 'queued') {
            resumed = await managedQueueController.claimHead(managedResolvedAttempt.queueItemId);
          }
          if (resumed.execution.state === 'claimed') {
            resumed = await allocateClaimedGuidHandoff(managedQueueController, managedResolvedAttempt);
          }
          if (!isSafeGuidHandoff(resumed)) {
            throw new Error(`Managed Guid presentation frozen handoff stopped in ${resumed.execution.state}`);
          }
          await navigate(`/conversation/${managedResolvedAttempt.conversationId}`);
          clearGuidManagedAttempt(managedAttemptState);
          managedPresentation?.onHandoffAccepted?.();
          return;
        }
      }
      if (
        existingHandoff?.execution.state === 'preflight_failed' &&
        managedPresentation !== undefined &&
        hasSamePendingAttemptIdentity(managedResolvedAttempt, input, managedRuntime, managedPresentation) &&
        !isExactPendingAttempt(managedResolvedAttempt, input, managedRuntime, managedPresentation)
      ) {
        await managedQueueController.removePreflightFailed(existingHandoff.queueItemId);
      }
    }
    if (managedAttemptState?.existing && managedPresentation) {
      if (!isExactPendingAttempt(managedAttemptState.attempt, input, managedRuntime, managedPresentation)) {
        if (
          managedResolvedAttempt === null ||
          managedQueueController === null ||
          !hasSamePendingAttemptIdentity(managedAttemptState.attempt, input, managedRuntime, managedPresentation) ||
          findExactQueueItem(managedQueueController, managedResolvedAttempt) !== null
        ) {
          throw new Error('Managed Guid presentation attempt belongs to another submission');
        }
        const lookup = await ipcBridge.presentationRuns.get.invoke({
          conversation_id: managedResolvedAttempt.conversationId,
          client_request_id: managedResolvedAttempt.clientRequestId,
        });
        if (lookup.ok || !('code' in lookup) || lookup.code !== 'RUN_NOT_FOUND') {
          throw new Error('Managed Guid presentation attempt cannot be safely rebased');
        }
        const rebasedAttempt: ResolvedGuidManagedPresentationAttempt = {
          ...managedResolvedAttempt,
          draftClientRequestId: managedPresentation.draftClientRequestId,
          sources: copySourceRefs(managedPresentation.sourceRefs),
        };
        managedAttemptState = transitionGuidManagedAttempt(managedAttemptState, rebasedAttempt);
        managedResolvedAttempt = rebasedAttempt;
      }
    }

    const preparedManagedSources = managedPresentation
      ? await managedPresentation.prepareSourceOwner(managedAttemptState?.attempt.conversationId ?? undefined)
      : null;
    if (preparedManagedSources && 'code' in preparedManagedSources) {
      throw new Error(preparedManagedSources.code);
    }
    if (preparedManagedSources?.ok && managedAttemptState) {
      const canonicalSources = sourceRefsFromOwner(preparedManagedSources);
      if (!sameSourceRefs(canonicalSources, managedAttemptState.attempt.sources)) {
        throw new Error('Managed Guid presentation source snapshot changed; reselect sources');
      }
      if (
        preparedManagedSources.owner.owner_type === 'conversation' &&
        (managedAttemptState.attempt.conversationId === null ||
          normalizePresentationConversationId(preparedManagedSources.owner.conversation_id) !==
            managedAttemptState.attempt.conversationId)
      ) {
        throw new Error('Managed Guid presentation source owner does not match the pending conversation');
      }
    }

    const isCustomWorkspace = !!dir;
    const finalWorkspace = dir || '';

    // Fold a selected presentation template into the first message: directive
    // text wraps the user's prompt, and the template's THEME.md (+ reference
    // deck) rides along as attached files. The conversation title keeps the
    // raw user input.
    const composed =
      !managedPresentation && composePresentationSend
        ? composePresentationSend(input, files)
        : { input, files: managedPresentation ? [] : files, injectSkills: [] as string[] };

    const assistantConversationId = selectedAssistantId;
    const assistantBackend = selectedAssistantBackend;
    const enabled_skills_to_send = guidEnabledSkills ?? assistantDefaultSkillIds;
    const excludeBuiltinSkills = guidDisabledBuiltinSkills ?? assistantDefaultDisabledBuiltinSkillIds;
    const selectedAllMcpServerIds = selectedMcpServerIds ?? [];
    const selectedMcpServerIdSet = new Set(selectedAllMcpServerIds);
    const selectedUserMcpServerIds = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin !== true)
      .map((server) => server.id);
    const selectedAllSessionMcpServers = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id))
      .map((server) => toSessionMcpServer(server));
    const selectedSessionMcpServers = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin === true)
      .map((server) => toSessionMcpServer(server));
    const defaultSelectedMcpServerIds = mergeCommodityMcpServerIds(assistantDefaultMcpIds ?? [], availableMcpServers);
    const defaultSelectedUserMcpServerIds = availableMcpServers
      .filter((server) => (defaultSelectedMcpServerIds ?? []).includes(server.id) && server.builtin !== true)
      .map((server) => server.id);
    // Image generation, the IDP (GreenNode) server, and the vision (image-analysis)
    // server are globally-enabled capabilities (toggled in Settings > Tools), not
    // per-chat picks — and their built-in servers are hidden from the MCP picker.
    // Always attach the enabled hidden servers so the agent can invoke them without
    // the user selecting them per conversation.
    const imageGenServer = availableMcpServers.find(
      (server) => server.enabled === true && isImageGenBuiltinServer(server)
    );
    const idpServer = availableMcpServers.find((server) => server.enabled === true && isIdpBuiltinServer(server));
    const visionServer = availableMcpServers.find((server) => server.enabled === true && isVisionBuiltinServer(server));
    const hiddenAutoAttachServers = [imageGenServer, idpServer, visionServer].filter(
      (server): server is IMcpServer => !!server
    );

    const assistantOverrideMcpIdsBase =
      selectedMcpServerIds !== undefined ? selectedAllMcpServerIds : defaultSelectedMcpServerIds;
    const missingAutoAttachMcpIds = hiddenAutoAttachServers
      .filter((server) => !assistantOverrideMcpIdsBase.includes(server.id))
      .map((server) => server.id);
    const assistantOverrideMcpIds = [...assistantOverrideMcpIdsBase, ...missingAutoAttachMcpIds];
    const selectedUserMcpServerIdsToSend =
      selectedMcpServerIds !== undefined ? selectedUserMcpServerIds : defaultSelectedUserMcpServerIds;
    const selectedSessionMcpServersBase =
      selectedMcpServerIds !== undefined
        ? selectedAllSessionMcpServers
        : availableMcpServers
            .filter((server) => (defaultSelectedMcpServerIds ?? []).includes(server.id))
            .map((server) => toSessionMcpServer(server));
    const missingAutoAttachSessionServers = hiddenAutoAttachServers.filter(
      (server) => !selectedSessionMcpServersBase.some((existing) => existing.id === server.id)
    );
    const selectedSessionMcpServersToSend = [
      ...selectedSessionMcpServersBase,
      ...missingAutoAttachSessionServers.map((server) => toSessionMcpServer(server)),
    ];

    const assistantOverrideModel =
      selectedAcpModel || currentAcpCachedModelInfo?.current_model_id || current_model?.use_model || undefined;
    const assistantOverrides = {
      model: assistantOverrideModel,
      permission: selectedMode || undefined,
      thought_level: selectedThoughtLevelValue || undefined,
      skill_ids: enabled_skills_to_send,
      disabled_builtin_skill_ids: excludeBuiltinSkills,
      mcp_ids: assistantOverrideMcpIds,
    };

    // Global ("Chat") + project instructions, appended into the first-turn
    // preset context. Used by the backend only when the chat's assistant has
    // no rules of its own (general/default + project chats); a specialized
    // assistant's rules take precedence (out of scope — see design spec).
    const injectedContext = resolveInjectedContext(projectId);

    // Pick up anything dropped into the project's Knowledge Base folder since
    // the last sync. Deliberately NOT awaited: ingestion can take
    // seconds-to-minutes and blocking send on it is unacceptable. This chat
    // therefore uses whatever is already `ready` (the same frozen-at-creation
    // boundary as the MCP descriptor below); the sync benefits the next one.
    if (projectId) {
      const projectWorkspace = findProjectById(projectId)?.workspace;
      if (projectWorkspace) {
        void ipcBridge.projectKnowledge.syncFolder
          .invoke({ projectId, workspace: projectWorkspace })
          .catch((syncError: unknown) => console.error('Failed to sync knowledge folder on chat creation:', syncError));
      }
    }

    // Project knowledge base: attach the per-project search server as a pure
    // session MCP (full stdio transport, never a repo-registered row) so the
    // agent can retrieve from the project's curated documents. Only attaches
    // for project chats whose knowledge index has at least one ready source —
    // getSessionMcpServer returns null otherwise. A failure here must never
    // block sending, so it degrades to "no knowledge tool".
    const kbSessionServer = projectId
      ? await ipcBridge.projectKnowledge.getSessionMcpServer.invoke({ projectId }).catch((): null => null)
      : null;
    const withKbServer = (servers: ISessionMcpServer[]): ISessionMcpServer[] =>
      kbSessionServer && !servers.some((server) => server.name === kbSessionServer.name)
        ? [...servers, kbSessionServer]
        : servers;

    type ConversationCreateRequest = Parameters<typeof ipcBridge.conversation.create.invoke>[0];
    const createOrRecoverConversation = async (request: ConversationCreateRequest) => {
      if (!managedAttemptState) return ipcBridge.conversation.create.invoke(request);
      if (managedResolvedConversation !== null) {
        if (
          managedResolvedAttempt === null ||
          validateConversationRuntimeAndId(managedResolvedConversation, managedResolvedAttempt.runtime) !==
            managedResolvedAttempt.conversationId
        ) {
          throw new Error('Managed Guid recovered conversation is not authoritative');
        }
        return managedResolvedConversation;
      }
      const resolved = await resolveGuidConversation(managedAttemptState, request);
      managedAttemptState = resolved.snapshot;
      managedResolvedAttempt = resolved.attempt;
      managedResolvedConversation = resolved.conversation;
      managedQueueController = createPresentationCommandQueueController({
        conversationId: managedResolvedAttempt.conversationId,
      });
      return resolved.conversation;
    };

    const runManagedHandoff = async (conversationId: string): Promise<void> => {
      if (!managedPresentation || !managedAttemptState || !managedQueueController || !preparedManagedSources?.ok) {
        return;
      }
      const attempt = managedResolvedAttempt;
      if (attempt === null) {
        throw new Error('Managed Guid handoff conversation is unresolved');
      }
      const canonicalConversationId = normalizePresentationConversationId(conversationId);
      if (canonicalConversationId !== attempt.conversationId) {
        throw new Error('Managed Guid handoff received a conflicting conversation identity');
      }
      let conversationOwnerRevision: number | null = null;
      if (preparedManagedSources.owner.owner_type === 'draft') {
        let bound: BindPresentationDraftResult | null;
        try {
          bound = await managedPresentation.bindDraft(canonicalConversationId);
        } catch (error) {
          const reconciled = await managedPresentation.prepareSourceOwner(canonicalConversationId);
          if (
            !reconciled.ok ||
            reconciled.owner.owner_type !== 'conversation' ||
            normalizePresentationConversationId(reconciled.owner.conversation_id) !== canonicalConversationId ||
            reconciled.ownerRevision <= 0 ||
            !sameSourceRefs(sourceRefsFromOwner(reconciled), attempt.sources)
          ) {
            throw error;
          }
          conversationOwnerRevision = reconciled.ownerRevision;
          bound = null;
        }
        if (bound === null && conversationOwnerRevision === null) {
          throw new Error('Managed Guid draft binding returned no authoritative result');
        }
        if (bound !== null) {
          if ('code' in bound) throw new Error(bound.code);
          if (
            normalizePresentationConversationId(bound.conversationId) !== canonicalConversationId ||
            bound.draftId !== preparedManagedSources.owner.draft_id
          ) {
            throw new Error('Managed Guid draft binding returned a conflicting identity');
          }
          conversationOwnerRevision = bound.revision;
        }
      } else {
        if (
          normalizePresentationConversationId(preparedManagedSources.owner.conversation_id) !== canonicalConversationId
        ) {
          throw new Error('Managed Guid draft is bound to a different conversation');
        }
        if (preparedManagedSources.ownerRevision <= 0) {
          throw new Error('Managed Guid draft binding is not confirmed by main');
        }
        conversationOwnerRevision = preparedManagedSources.ownerRevision;
      }
      if (conversationOwnerRevision === null) {
        throw new Error('Managed Guid draft binding is not confirmed by main');
      }

      let item = findExactQueueItem(managedQueueController, attempt);
      if (item === null) {
        const sourceOwner: PresentationGrantOwner | null =
          attempt.sources.length > 0 ? { owner_type: 'conversation', conversation_id: canonicalConversationId } : null;
        item = await managedQueueController.enqueue({
          queueItemId: attempt.queueItemId,
          clientRequestId: attempt.clientRequestId,
          input: attempt.input,
          selectedTemplateId: attempt.selectedTemplateId,
          sources: copySourceRefs(attempt.sources),
          sourceOwner,
          expectedOwnerRevision: attempt.sources.length > 0 ? conversationOwnerRevision : null,
        });
      }
      if (item.execution.state === 'persisting') {
        await managedQueueController.recoverPersisting();
        item = findExactQueueItem(managedQueueController, attempt);
        if (item === null) throw new Error('Managed Guid presentation queue recovery lost its pending item');
      }
      if (item.execution.state === 'queued') {
        item = await managedQueueController.claimHead(attempt.queueItemId);
      }
      if (item.execution.state === 'claimed') {
        item = await allocateClaimedGuidHandoff(managedQueueController, attempt);
      }
      if (!isSafeGuidHandoff(item)) {
        throw new Error(`Managed Guid presentation handoff stopped in ${item.execution.state}`);
      }
    };

    if (assistantBackend === 'aionrs') {
      if (!current_model) {
        Message.warning(t('conversation.noModelConfigured'));
        if (managedPresentation) throw new Error('Managed Guid presentation requires a configured model');
        return;
      }
      try {
        const conversation = await createOrRecoverConversation({
          name: input,
          model: current_model,
          assistant: {
            id: assistantConversationId,
            locale: localeKey,
            conversation_overrides: assistantOverrides,
          },
          extra: {
            project_id: projectId,
            ...(injectedContext ? { preset_rules: injectedContext } : {}),
            default_files: composed.files,
            workspace: finalWorkspace,
            custom_workspace: isCustomWorkspace,
            selected_mcp_server_ids: selectedUserMcpServerIdsToSend,
            selected_session_mcp_servers: withKbServer(selectedSessionMcpServersToSend),
          },
        });

        if (!conversation || !conversation.id) {
          Message.error(t('conversation.createFailed'));
          if (managedPresentation) throw new Error('Managed Guid conversation creation was not durable');
          return;
        }

        await runManagedHandoff(conversation.id);

        if (isCustomWorkspace) {
          updateWorkspaceTime(finalWorkspace);
        }

        if (assistantConversationId) {
          await Promise.all([
            swrMutate(`guid.assistant.detail.${assistantConversationId}.${localeKey}`),
            swrMutate('assistants.list'),
          ]);
        }

        emitter.emit('chat.history.refresh');

        if (managedAttemptState) {
          await navigate(`/conversation/${conversation.id}`);
          clearGuidManagedAttempt(managedAttemptState);
          managedPresentation?.onHandoffAccepted?.();
          return;
        }

        const initialMessage = {
          input: composed.input,
          files: composed.files.length > 0 ? composed.files : undefined,
          injectSkills: composed.injectSkills.length > 0 ? composed.injectSkills : undefined,
        };
        sessionStorage.setItem(`aionrs_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

        await navigate(`/conversation/${conversation.id}`);
      } catch (error: unknown) {
        console.error('Failed to create Aion CLI conversation:', error);
        throw error;
      }
      return;
    }

    try {
      const conversation = await createOrRecoverConversation({
        name: input,
        assistant: {
          id: assistantConversationId,
          locale: localeKey,
          conversation_overrides: assistantOverrides,
        },
        extra: {
          project_id: projectId,
          ...(injectedContext ? { preset_context: injectedContext } : {}),
          workspace: finalWorkspace,
          custom_workspace: isCustomWorkspace,
          default_files: composed.files,
          selected_mcp_server_ids: selectedUserMcpServerIdsToSend,
          selected_session_mcp_servers: withKbServer(
            selectedMcpServerIds !== undefined ? selectedSessionMcpServers : selectedSessionMcpServersToSend
          ),
        },
      });
      if (!conversation || !conversation.id) {
        console.error('Failed to create ACP conversation - conversation object is null or missing id');
        if (managedPresentation) throw new Error('Managed Guid conversation creation was not durable');
        return;
      }

      await runManagedHandoff(conversation.id);

      if (isCustomWorkspace) {
        updateWorkspaceTime(finalWorkspace);
      }

      if (assistantConversationId) {
        await Promise.all([
          swrMutate(`guid.assistant.detail.${assistantConversationId}.${localeKey}`),
          swrMutate('assistants.list'),
        ]);
      }

      emitter.emit('chat.history.refresh');

      if (managedAttemptState) {
        await navigate(`/conversation/${conversation.id}`);
        clearGuidManagedAttempt(managedAttemptState);
        managedPresentation?.onHandoffAccepted?.();
        return;
      }

      const initialMessage = {
        input: composed.input,
        files: composed.files.length > 0 ? composed.files : undefined,
      };
      sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

      await navigate(`/conversation/${conversation.id}`);
    } catch (error: unknown) {
      console.error('Failed to create ACP conversation:', error);
      throw error;
    }
  }, [
    input,
    files,
    dir,
    projectId,
    selectedAssistantId,
    selectedAssistantBackend,
    selectedMode,
    selectedAcpModel,
    selectedThoughtLevelValue,
    currentAcpCachedModelInfo,
    current_model,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    assistantDefaultSkillIds,
    assistantDefaultDisabledBuiltinSkillIds,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultMcpIds,
    composePresentationSend,
    managedPresentation,
    navigate,
    t,
    localeKey,
  ]);

  const sendMessageHandler = useCallback(() => {
    if (loading || sendingRef.current) return;
    if (requiresPresentationSourceReselect) {
      onPresentationSourceReselectRequired?.();
      return;
    }
    sendingRef.current = true;
    if (managedPresentation) setManagedPresentationPending(true);
    setLoading(true);
    handleSend()
      .then(() => {
        setInput('');
        setMentionOpen(false);
        setMentionQuery(null);
        setMentionSelectorOpen(false);
        setMentionActiveIndex(0);
        setFiles([]);
        setDir('');
        setProjectId(undefined);
        onPresentationTemplateConsumed?.();
      })
      .catch((error) => {
        console.error('Failed to send message:', error);
        Message.error(getConversationCreateErrorMessage(error, t));
      })
      .finally(() => {
        sendingRef.current = false;
        if (managedPresentation) setManagedPresentationPending(false);
        setLoading(false);
      });
  }, [
    loading,
    requiresPresentationSourceReselect,
    onPresentationSourceReselectRequired,
    managedPresentation,
    handleSend,
    setLoading,
    setInput,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    setFiles,
    setDir,
    setProjectId,
    onPresentationTemplateConsumed,
    t,
  ]);

  // Calculate button disabled state
  const isButtonDisabled = loading || managedPresentationPending || !input.trim() || !selectedAssistantId;

  const retireManagedPresentationAttemptAfterSourceChange = useCallback(
    async (change: GuidManagedPresentationSourceChange | null): Promise<void> => {
      if (change === null) return;
      try {
        const snapshot = readGuidManagedAttempt();
        if (snapshot === null) return;
        const { attempt } = snapshot;
        if (attempt.version === 3 && attempt.claimMode === 'marker_v1' && attempt.createPhase === 'not_started') {
          clearGuidManagedAttempt(snapshot);
          return;
        }
        if (attempt.version === 3 && attempt.claimMode === 'marker_v1' && attempt.createPhase === 'uncertain') return;
        const resolved = await resolveGuidConversation(snapshot);
        const controller = createPresentationCommandQueueController({
          conversationId: resolved.attempt.conversationId,
        });
        const item = findExactQueueItem(controller, resolved.attempt);
        if (item === null) return;
        if (item.execution.state === 'persisting') {
          if (
            change.kind === 'revoked' &&
            change.queueUnboundAtRevoke === true &&
            item.sources.some((source) => source.grantId === change.grantId)
          ) {
            await controller.removePersistingAfterConfirmedGrantRevocation(item.queueItemId, change.grantId);
            return;
          }
          await controller.retirePersisting(item.queueItemId);
          return;
        }
        if (item.execution.state !== 'preflight_failed') return;
        await controller.removePreflightFailed(item.queueItemId);
        if (resolved.attempt.claimMode === 'exact_get') clearGuidManagedAttempt(resolved.snapshot);
      } catch {
        // Preserve the frozen pending attempt unless every safe retirement step succeeds.
      }
    },
    []
  );

  return {
    handleSend,
    sendMessageHandler,
    isButtonDisabled,
    managedPresentationRecovery,
    managedPresentationPending,
    retireManagedPresentationAttemptAfterSourceChange,
  };
};
