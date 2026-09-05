/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ipcBridge } from '@/common';
import type {
  IConversationMcpStatus,
  IProvider,
  ISessionMcpServer,
  TChatConversation,
  TProviderWithModel,
} from '@/common/config/storage';
import { BUILTIN_STUDIO_NAME } from '@/common/config/builtinCapabilities';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import {
  buildStudioBriefRulesPin,
  resolveEffectiveStudioRules,
  STUDIO_BRIEF_RULES_PIN_ID,
} from '@/common/types/project/creativeStudioRules';
import type {
  StudioDirectorSessionAuthorityV2,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { uuid } from '@/common/utils';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { buildContextHandoffExtraPatch } from '@/renderer/pages/conversation/contextHandoff/contextConversationUpdate';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
import AionrsChat from '@/renderer/pages/conversation/platforms/aionrs/AionrsChat';
import type { MessageListInlineItem } from '@/renderer/pages/conversation/Messages/MessageList';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import styles from './DirectorRail.module.css';
import { DIRECTOR_PRESET_RULES, DIRECTOR_PRESET_RULES_PROFILE, seedDirectorOpeningTurn } from './openingTurn';

type DirectorConversation = Extract<TChatConversation, { type: 'aionrs' }>;

export type DirectorProposalChatIntent = {
  decision: 'accept' | 'reject';
  proposalId: string | null;
};

const ACCEPT_PROPOSAL_CHAT_INTENTS = new Set([
  'approve',
  'approve it',
  'apply',
  'apply it',
  'accept',
  'accept it',
  '/approve',
]);
const REJECT_PROPOSAL_CHAT_INTENTS = new Set(['reject', 'reject it', 'decline', 'decline it', '/reject']);

/** Only exact, bounded human phrases can cross from the composer into proposal authority. */
export const parseDirectorProposalChatIntent = (message: string): DirectorProposalChatIntent | null => {
  const normalizedInput = message.normalize('NFKC').trim();
  const exact = /^\/(approve|reject) ([A-Za-z0-9_-]{1,256})$/u.exec(normalizedInput);
  if (exact !== null) {
    return { decision: exact[1] === 'approve' ? 'accept' : 'reject', proposalId: exact[2]! };
  }
  const normalized = normalizedInput
    .toLocaleLowerCase('en-US')
    .replace(/[.!?]+$/u, '')
    .trim()
    .replace(/\s+/gu, ' ');
  if (ACCEPT_PROPOSAL_CHAT_INTENTS.has(normalized)) return { decision: 'accept', proposalId: null };
  if (REJECT_PROPOSAL_CHAT_INTENTS.has(normalized)) return { decision: 'reject', proposalId: null };
  return null;
};

type DirectorState =
  | { kind: 'loading'; projectId: string }
  | { kind: 'starting'; projectId: string }
  | { kind: 'ready'; projectId: string; conversation: DirectorConversation }
  | {
      kind: 'interrupted';
      projectId: string;
      conversation: DirectorConversation;
      expectedPriorBinding: string | null;
      messageKey: string;
    }
  | { kind: 'dangling'; projectId: string; conversationId: string; messageKey?: string }
  | { kind: 'conflict'; projectId: string }
  | { kind: 'failed'; projectId: string; messageKey: string };

type StartOutcome =
  | { kind: 'ready'; conversation: DirectorConversation }
  | {
      kind: 'interrupted';
      conversation: DirectorConversation;
      expectedPriorBinding: string | null;
      messageKey: string;
    }
  | { kind: 'dangling'; conversationId: string; messageKey?: string }
  | { kind: 'conflict' }
  | { kind: 'failed'; messageKey: string; retryPolicy: DirectorRetryPolicy };

type DirectorClaimantPolicy = 'scan-before-create' | 'require-claimant' | 'bypass';
type DirectorRetryPolicy = Exclude<DirectorClaimantPolicy, 'bypass'>;
const retryPolicyForClaimantPolicy = (policy?: DirectorClaimantPolicy): DirectorRetryPolicy =>
  policy === 'require-claimant' ? 'require-claimant' : 'scan-before-create';

type StartInput = {
  projectId: string;
  projectName: string;
  /** The composer's sentence, sent as the conversation's opening turn on a fresh create. */
  brief: string;
  model?: TProviderWithModel;
  candidate?: DirectorConversation;
  conversationId?: string;
  claimantPolicy?: DirectorClaimantPolicy;
  expectedPriorBinding: string | null;
  currentAuthority: () => { revision: number; briefConversationId: string | null };
};

type AttemptRecord = {
  promise: Promise<StartOutcome>;
  /** The exact authority this attempt was allowed to replace when it began. */
  expectedPriorBinding: string | null;
  settled: boolean;
  outcome?: StartOutcome;
};

const DIRECTOR_CONFLICT_KEY = 'conversation.creativeStudio.workspace.director.ownerConflict';
const DIRECTOR_SESSION_VERIFICATION_KEY = 'conversation.creativeStudio.workspace.director.sessionVerificationFailed';
const DIRECTOR_ATTACH_INTERRUPTED_KEY = 'conversation.creativeStudio.workspace.director.attachInterrupted';
const DIRECTOR_STORAGE_KEY = 'conversation.creativeStudio.workspace.errors.storage';
const SAFE_DIRECTOR_REJECTION_MESSAGE_KEYS = new Set<string>([
  DIRECTOR_SESSION_VERIFICATION_KEY,
  DIRECTOR_ATTACH_INTERRUPTED_KEY,
  DIRECTOR_STORAGE_KEY,
]);
const expectedServerId = (projectId: string): string => `studio-brief-${projectId}`;

class DirectorConversationStartError extends Error {
  constructor(
    readonly messageKey: string,
    readonly retryPolicy: DirectorRetryPolicy
  ) {
    super(messageKey);
  }
}

class DirectorConversationConflictError extends Error {}

const normalizedAbsolutePath = (value: unknown): string | null => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.includes('\0') ||
    !(value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'))
  ) {
    return null;
  }
  return value.replaceAll('\\', '/').replace(/\/+$/, '');
};

const hasExactKeys = (value: object, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = expected.toSorted();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const isSafeDirectorConversationId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_STUDIO_ID.test(value);
const SAFE_CHOICE_ID = /^choice_[a-f0-9]{24}$/;
const CATALOG_VERSION = /^[a-f0-9]{16}$/;
const MAX_ROUTE_OPTIONS = 256;
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const RESOLUTIONS = ['720p', '1080p'] as const;
const INTEGRATION_LABELS = ['imageApi', 'bytePlusSeedance', 'selfHostedVideoGateway', 'openRouterVideo'] as const;

const isBoundedSafeText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  value === value.trim() &&
  !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    );
  });

const isExactUniqueEnumArray = (value: unknown, allowed: readonly string[]): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= allowed.length &&
  new Set(value).size === value.length &&
  value.every((item) => typeof item === 'string' && allowed.includes(item));

const isSafeDiscreteDurations = (value: unknown, minimum: unknown, maximum: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 12 &&
  value.every(
    (duration, index) =>
      Number.isInteger(duration) &&
      duration >= 4 &&
      duration <= 15 &&
      (index === 0 || Number(value[index - 1]) < duration)
  ) &&
  value[0] === minimum &&
  value.at(-1) === maximum;

const isSafeRouteConstraints = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const keys = [
    'aspectRatios',
    'resolutions',
    'minDurationSeconds',
    'maxDurationSeconds',
    'supportsFirstFrame',
    'maxConditioningImages',
    'silentOutput',
  ];
  const hasDiscreteDurations = Object.hasOwn(value, 'supportedDurationSeconds');
  return (
    hasExactKeys(value, hasDiscreteDurations ? [...keys, 'supportedDurationSeconds'] : keys) &&
    isExactUniqueEnumArray(value.aspectRatios, ASPECT_RATIOS) &&
    isExactUniqueEnumArray(value.resolutions, RESOLUTIONS) &&
    Number.isInteger(value.minDurationSeconds) &&
    Number.isInteger(value.maxDurationSeconds) &&
    Number(value.minDurationSeconds) >= 1 &&
    Number(value.maxDurationSeconds) <= 60 &&
    Number(value.minDurationSeconds) <= Number(value.maxDurationSeconds) &&
    (!hasDiscreteDurations ||
      isSafeDiscreteDurations(value.supportedDurationSeconds, value.minDurationSeconds, value.maxDurationSeconds)) &&
    typeof value.supportsFirstFrame === 'boolean' &&
    Number.isInteger(value.maxConditioningImages) &&
    Number(value.maxConditioningImages) >= 0 &&
    Number(value.maxConditioningImages) <= 6 &&
    typeof value.silentOutput === 'boolean'
  );
};

const isSafeRoute = (value: unknown, kind: 'image' | 'video'): value is Record<string, unknown> => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'choiceId',
      'providerId',
      'providerName',
      'model',
      'integrationLabelKey',
      'health',
      'kind',
      'constraints',
    ])
  ) {
    return false;
  }
  const label = value.integrationLabelKey;
  return (
    typeof value.choiceId === 'string' &&
    SAFE_CHOICE_ID.test(value.choiceId) &&
    typeof value.providerId === 'string' &&
    SAFE_STUDIO_ID.test(value.providerId) &&
    isBoundedSafeText(value.providerName) &&
    isBoundedSafeText(value.model) &&
    typeof label === 'string' &&
    INTEGRATION_LABELS.includes(label as (typeof INTEGRATION_LABELS)[number]) &&
    (kind === 'image' ? label === 'imageApi' : label !== 'imageApi') &&
    (value.health === 'available' || value.health === 'unknown') &&
    value.kind === kind &&
    isSafeRouteConstraints(value.constraints)
  );
};

const sameSafeRoute = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => {
  const leftConstraints = left.constraints as Record<string, unknown>;
  const rightConstraints = right.constraints as Record<string, unknown>;
  return (
    left.choiceId === right.choiceId &&
    left.providerId === right.providerId &&
    left.providerName === right.providerName &&
    left.model === right.model &&
    left.integrationLabelKey === right.integrationLabelKey &&
    left.health === right.health &&
    left.kind === right.kind &&
    JSON.stringify(leftConstraints.aspectRatios) === JSON.stringify(rightConstraints.aspectRatios) &&
    JSON.stringify(leftConstraints.resolutions) === JSON.stringify(rightConstraints.resolutions) &&
    leftConstraints.minDurationSeconds === rightConstraints.minDurationSeconds &&
    leftConstraints.maxDurationSeconds === rightConstraints.maxDurationSeconds &&
    JSON.stringify(leftConstraints.supportedDurationSeconds) ===
      JSON.stringify(rightConstraints.supportedDurationSeconds) &&
    leftConstraints.supportsFirstFrame === rightConstraints.supportsFirstFrame &&
    leftConstraints.maxConditioningImages === rightConstraints.maxConditioningImages &&
    leftConstraints.silentOutput === rightConstraints.silentOutput
  );
};

const isSafeSelectionIssue = (value: unknown): boolean => {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.code !== 'string') return false;
  if (value.code === 'retired' || value.code === 'health') return hasExactKeys(value, ['code']);
  if (value.code === 'needs_setup') {
    return hasExactKeys(value, ['code', 'providerName']) && isBoundedSafeText(value.providerName);
  }
  return (
    value.code === 'frame' &&
    hasExactKeys(value, ['code', 'aspectRatio', 'resolution']) &&
    typeof value.aspectRatio === 'string' &&
    ASPECT_RATIOS.includes(value.aspectRatio as (typeof ASPECT_RATIOS)[number]) &&
    typeof value.resolution === 'string' &&
    RESOLUTIONS.includes(value.resolution as (typeof RESOLUTIONS)[number])
  );
};

const isSafeMediaCatalog = (value: unknown, kind: 'image' | 'video'): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['status', 'selected', 'selectedRoute', 'selectionIssue', 'options']) ||
    !['ready', 'selection_required', 'setup_required', 'unavailable'].includes(String(value.status)) ||
    !Array.isArray(value.options) ||
    value.options.length > MAX_ROUTE_OPTIONS ||
    !value.options.every((option) => isSafeRoute(option, kind))
  ) {
    return false;
  }
  const options = value.options as Record<string, unknown>[];
  if (new Set(options.map((option) => option.choiceId)).size !== options.length) return false;
  if (!isSafeSelectionIssue(value.selectionIssue)) return false;
  if (value.selected === null || value.selectedRoute === null) {
    if (value.selected !== null || value.selectedRoute !== null) return false;
    if (value.status === 'ready') return false;
    if (value.status === 'unavailable') return value.selectionIssue !== null;
    return (
      value.selectionIssue === null && (value.status === 'setup_required' ? options.length === 0 : options.length > 0)
    );
  }
  if (
    value.status !== 'ready' ||
    value.selectionIssue !== null ||
    !isRecord(value.selected) ||
    !hasExactKeys(value.selected, ['choiceId', 'providerId', 'model']) ||
    !isSafeRoute(value.selectedRoute, kind)
  ) {
    return false;
  }
  const selectedRoute = value.selectedRoute;
  return (
    value.selected.choiceId === selectedRoute.choiceId &&
    value.selected.providerId === selectedRoute.providerId &&
    value.selected.model === selectedRoute.model &&
    options.some((option) => sameSafeRoute(option, selectedRoute))
  );
};

export const hasSafeRouteCatalog = (value: string): boolean => {
  try {
    const catalog: unknown = JSON.parse(value);
    if (!isRecord(catalog) || !hasExactKeys(catalog, ['image', 'video', 'catalogVersion'])) return false;
    return (
      typeof catalog.catalogVersion === 'string' &&
      CATALOG_VERSION.test(catalog.catalogVersion) &&
      isSafeMediaCatalog(catalog.image, 'image') &&
      isSafeMediaCatalog(catalog.video, 'video')
    );
  } catch {
    return false;
  }
};

/** A persisted restart candidate must retain the closed Studio stdio shape before authority comparison. */
export const hasSafeDirectorTransport = (server: unknown, projectId: string): server is ISessionMcpServer => {
  if (!isRecord(server) || !isRecord(server.transport)) return false;
  const transport = server.transport;
  if (
    transport.type !== 'stdio' ||
    !hasExactKeys(transport, ['type', 'command', 'args', 'env']) ||
    !Array.isArray(transport.args)
  ) {
    return false;
  }
  const scriptPath = normalizedAbsolutePath(transport.args[0]);
  if (
    transport.command !== 'node' ||
    transport.args.length !== 1 ||
    scriptPath === null ||
    !scriptPath.endsWith('/out/main/builtin-mcp-studio.js')
  ) {
    return false;
  }
  const env = transport.env;
  if (!isRecord(env) || !hasExactKeys(env, Object.values(STUDIO_ENV))) return false;
  if (env[STUDIO_ENV.projectId] !== projectId) return false;
  const projectDir = normalizedAbsolutePath(env[STUDIO_ENV.projectDir]);
  const pendingDir = normalizedAbsolutePath(env[STUDIO_ENV.pendingDir]);
  const referencePendingDir = normalizedAbsolutePath(env[STUDIO_ENV.referencePendingDir]);
  const routeCatalog = env[STUDIO_ENV.routeCatalog];
  return (
    projectDir !== null &&
    projectDir.endsWith(`/${projectId}`) &&
    pendingDir === `${projectDir}/proposals/pending` &&
    referencePendingDir === `${projectDir}/reference-requests/pending` &&
    typeof routeCatalog === 'string' &&
    routeCatalog.length <= 1_000_000 &&
    hasSafeRouteCatalog(routeCatalog)
  );
};

const hasExactUniqueMembers = (actual: unknown, expected: readonly string[]): boolean => {
  if (!Array.isArray(actual) || actual.length !== expected.length || new Set(actual).size !== actual.length) {
    return false;
  }
  return actual.every((value) => typeof value === 'string' && expected.includes(value));
};

/** The persisted conversation must contain the Studio server and no ambient MCP attachment. */
/**
 * Recursively orders own object keys. Array order is left alone: sequence is meaning, not formatting.
 * Nothing here currently proves that — `hasSafeDirectorTransport` runs first and admits exactly one
 * `args` entry — so a test cannot reach a two-element case through this predicate. The rule holds on
 * principle, for whenever that constraint loosens.
 */
const withOrderedKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(withOrderedKeys);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((key) => [key, withOrderedKeys(record[key])])
  );
};

/**
 * Serialisation that does not depend on key order. The conversation store returns object keys
 * alphabetically while a freshly built descriptor carries them in insertion order, so comparing the
 * two with JSON.stringify rejects a session whose every value matches — which stopped every newly
 * created project from binding its Director.
 */
const canonicalJson = (value: unknown): string => JSON.stringify(withOrderedKeys(value));

export const hasExactDirectorMcpSnapshot = (
  conversation: unknown,
  projectId: string,
  descriptor?: ISessionMcpServer
): conversation is DirectorConversation => {
  if (
    !isRecord(conversation) ||
    !isRecord(conversation.extra) ||
    !isSafeDirectorConversationId(conversation.id) ||
    conversation.type !== 'aionrs' ||
    conversation.extra.studio_project_id !== projectId
  ) {
    return false;
  }
  const extra = conversation.extra;
  const serverId = expectedServerId(projectId);
  if (descriptor !== undefined && (descriptor.id !== serverId || descriptor.name !== BUILTIN_STUDIO_NAME)) return false;

  const statuses = extra.mcp_statuses;
  const sessionServers = extra.session_mcp_servers;
  if (
    !Array.isArray(statuses) ||
    statuses.some((status) => !isRecord(status)) ||
    !Array.isArray(sessionServers) ||
    sessionServers.some((server) => !isRecord(server))
  ) {
    return false;
  }
  const statusRecords = statuses as Record<string, unknown>[];
  const sessionServerRecords = sessionServers as Record<string, unknown>[];
  const sessionServer = sessionServerRecords[0];
  const snapshotMatches =
    hasExactUniqueMembers(extra.mcp_server_ids, []) &&
    hasExactUniqueMembers(extra.mcp_servers, [BUILTIN_STUDIO_NAME]) &&
    hasExactUniqueMembers(
      statusRecords.map((status) => status.id),
      [serverId]
    ) &&
    statusRecords.every((status) => status.name === BUILTIN_STUDIO_NAME) &&
    hasExactUniqueMembers(
      sessionServerRecords.map((server) => server.id),
      [serverId]
    ) &&
    sessionServerRecords.every((server) => server.name === BUILTIN_STUDIO_NAME);
  if (!snapshotMatches || !hasSafeDirectorTransport(sessionServer, projectId)) return false;

  if (descriptor === undefined) return true;
  return canonicalJson(sessionServer.transport) === canonicalJson(descriptor.transport);
};

/** Compares every executable/path-bearing field with fresh, read-only main-process authority. */
export const hasExactDirectorAuthoritySnapshot = (
  conversation: TChatConversation,
  projectId: string,
  authority: StudioDirectorSessionAuthorityV2
): conversation is DirectorConversation => {
  if (!hasExactDirectorMcpSnapshot(conversation, projectId)) return false;
  const server = conversation.extra.session_mcp_servers?.[0];
  if (server === undefined || server.transport.type !== 'stdio') return false;
  const env = server.transport.env;
  return (
    server.id === authority.serverId &&
    server.name === authority.serverName &&
    server.transport.args?.[0] === authority.scriptPath &&
    env?.[STUDIO_ENV.projectId] === projectId &&
    env[STUDIO_ENV.projectDir] === authority.projectDir &&
    env[STUDIO_ENV.pendingDir] === authority.pendingDir &&
    env[STUDIO_ENV.referencePendingDir] === authority.referencePendingDir
  );
};

const messageKeyFromError = (error: unknown, fallback: string): string =>
  error instanceof Error && SAFE_DIRECTOR_REJECTION_MESSAGE_KEYS.has(error.message) ? error.message : fallback;

type DirectorAuthorityOutcome =
  | { kind: 'trusted' }
  | { kind: 'mismatch' }
  | { kind: 'unavailable'; messageKey: string };
type DirectorAuthorityCheck = { snapshot: string; promise: Promise<DirectorAuthorityOutcome> };
const directorAuthorityChecks = new Map<string, DirectorAuthorityCheck>();
const directorRulesRefreshes = new Map<string, Promise<boolean>>();

const checkPersistedDirectorAuthority = (
  conversation: TChatConversation,
  projectId: string
): Promise<DirectorAuthorityOutcome> => {
  if (!hasExactDirectorMcpSnapshot(conversation, projectId)) return Promise.resolve({ kind: 'mismatch' });
  const key = `${projectId}\0${conversation.id}`;
  const snapshot = JSON.stringify(conversation.extra.session_mcp_servers);
  const existing = directorAuthorityChecks.get(key);
  if (existing?.snapshot === snapshot) return existing.promise;
  const promise = ipcBridge.creativeStudio.getDirectorSessionAuthority
    .invoke({ projectId })
    .then((result): DirectorAuthorityOutcome => {
      if (result.ok === false) return { kind: 'unavailable', messageKey: result.error.messageKey };
      return hasExactDirectorAuthoritySnapshot(conversation, projectId, result.data)
        ? { kind: 'trusted' }
        : { kind: 'mismatch' };
    })
    .catch(
      (error): DirectorAuthorityOutcome => ({
        kind: 'unavailable',
        messageKey: messageKeyFromError(error, DIRECTOR_SESSION_VERIFICATION_KEY),
      })
    )
    .then((outcome) => {
      if (outcome.kind === 'unavailable' && directorAuthorityChecks.get(key)?.promise === promise) {
        directorAuthorityChecks.delete(key);
      }
      return outcome;
    });
  directorAuthorityChecks.set(key, { snapshot, promise });
  return promise;
};

type DirectorClaimantRecovery =
  | { kind: 'none' }
  | { kind: 'trusted'; conversation: DirectorConversation }
  | { kind: 'conflict' }
  | { kind: 'unavailable'; messageKey: string };

/**
 * A create response can be lost after the backend commits. The requested id is not
 * authoritative, so recovery re-reads the complete conversation catalogue and
 * accepts only one project claimant with both exact persisted and main-process
 * authority snapshots.
 */
const recoverDirectorClaimant = async (
  projectId: string,
  descriptor: ISessionMcpServer
): Promise<DirectorClaimantRecovery> => {
  let page: Awaited<ReturnType<typeof ipcBridge.database.getUserConversations.invoke>>;
  try {
    page = await ipcBridge.database.getUserConversations.invoke({ limit: 10_000 });
  } catch (error) {
    return {
      kind: 'unavailable',
      messageKey: messageKeyFromError(error, DIRECTOR_ATTACH_INTERRUPTED_KEY),
    };
  }
  const untrustedPage: unknown = page;
  if (
    !isRecord(untrustedPage) ||
    untrustedPage.has_more !== false ||
    !Array.isArray(untrustedPage.items) ||
    !Number.isSafeInteger(untrustedPage.total) ||
    Number(untrustedPage.total) < 0 ||
    untrustedPage.items.length !== untrustedPage.total ||
    untrustedPage.items.some((conversation) => !isRecord(conversation) || !isRecord(conversation.extra))
  ) {
    return { kind: 'unavailable', messageKey: DIRECTOR_ATTACH_INTERRUPTED_KEY };
  }

  const items = untrustedPage.items as TChatConversation[];
  const claimants = items.filter((conversation) => conversation.extra.studio_project_id === projectId);
  if (claimants.length === 0) return { kind: 'none' };
  if (claimants.length !== 1 || !hasExactDirectorMcpSnapshot(claimants[0], projectId, descriptor)) {
    return { kind: 'conflict' };
  }

  const conversation = claimants[0];
  const authority = await checkPersistedDirectorAuthority(conversation, projectId);
  if (authority.kind === 'trusted') return { kind: 'trusted', conversation };
  if (authority.kind === 'mismatch') return { kind: 'conflict' };
  return authority;
};

const directorRulesRefreshKey = (conversation: DirectorConversation): string | null => {
  const projectId = conversation.extra.studio_project_id;
  return typeof projectId === 'string' ? `${projectId}\0${conversation.id}\0${DIRECTOR_PRESET_RULES_PROFILE}` : null;
};

const hasCurrentDirectorPresetRules = (conversation: DirectorConversation): boolean =>
  conversation.extra.studio_director_rules_profile === DIRECTOR_PRESET_RULES_PROFILE;

const withCurrentDirectorPresetRulesProfile = (conversation: DirectorConversation): DirectorConversation => ({
  ...conversation,
  extra: {
    ...conversation.extra,
    studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
  },
});

/**
 * Re-provisions only the Director rules after executable session authority has been verified.
 * AionCore redacts the rules themselves, so success is an exact public-profile readback from the
 * persisted conversation. Each project/conversation/profile tuple is attempted at most once until
 * the person explicitly retries; history refreshes can never turn this into a write loop.
 */
const refreshDirectorPresetRules = (conversation: DirectorConversation): Promise<DirectorConversation | null> => {
  if (hasCurrentDirectorPresetRules(conversation)) return Promise.resolve(conversation);
  const key = directorRulesRefreshKey(conversation);
  const projectId = conversation.extra.studio_project_id;
  const descriptor = conversation.extra.session_mcp_servers?.[0];
  if (key === null || typeof projectId !== 'string' || descriptor === undefined) return Promise.resolve(null);
  let proof = directorRulesRefreshes.get(key);
  if (proof === undefined) {
    proof = (async (): Promise<boolean> => {
      try {
        /*
         * The update provider's declared boolean response is not authoritative. A successful
         * backend PATCH currently echoes the conversation record, while an empty successful body
         * resolves undefined; transport failures throw. Requiring a literal `true` therefore
         * strands a conversation after a write that may already have committed (BUG-163).
         *
         * Ignore only the echo. The exact GET below still proves the conversation id, MCP snapshot,
         * persisted Studio authority, and current rules profile before the rail can attach.
         */
        await ipcBridge.conversation.update.invoke({
          id: conversation.id,
          merge_extra: true,
          updates: {
            extra: {
              preset_rules: DIRECTOR_PRESET_RULES,
              studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
            } as TChatConversation['extra'],
          },
        });
      } catch {
        return false;
      }

      let persisted: unknown;
      try {
        persisted = await ipcBridge.conversation.get.invoke({ id: conversation.id });
      } catch {
        return false;
      }
      if (!isRecord(persisted) || !isRecord(persisted.extra)) return false;
      const typedPersisted = persisted as TChatConversation;
      if (
        typedPersisted.id !== conversation.id ||
        !hasExactDirectorMcpSnapshot(typedPersisted, projectId, descriptor)
      ) {
        return false;
      }
      const authority = await checkPersistedDirectorAuthority(typedPersisted, projectId);
      return authority.kind === 'trusted' && hasCurrentDirectorPresetRules(typedPersisted);
    })();
    directorRulesRefreshes.set(key, proof);
  }
  return proof.then((verified) => (verified ? withCurrentDirectorPresetRulesProfile(conversation) : null));
};

const allowDirectorPresetRulesRetry = (conversation: DirectorConversation): void => {
  const key = directorRulesRefreshKey(conversation);
  if (key !== null) directorRulesRefreshes.delete(key);
};

const createDirectorConversation = async (input: {
  projectId: string;
  projectName: string;
  brief: string;
  model: TProviderWithModel;
  conversationId: string;
  claimantPolicy: DirectorClaimantPolicy;
}): Promise<DirectorConversation> => {
  const retryPolicy = retryPolicyForClaimantPolicy(input.claimantPolicy);
  const descriptorResult = await ipcBridge.creativeStudio.getBriefSessionServer.invoke({ projectId: input.projectId });
  if (descriptorResult.ok === false) {
    throw new DirectorConversationStartError(descriptorResult.error.messageKey, retryPolicy);
  }
  const descriptor = descriptorResult.data;
  if (
    descriptor.id !== expectedServerId(input.projectId) ||
    descriptor.name !== BUILTIN_STUDIO_NAME ||
    !hasSafeDirectorTransport(descriptor, input.projectId)
  ) {
    throw new DirectorConversationStartError(DIRECTOR_SESSION_VERIFICATION_KEY, retryPolicy);
  }

  const request: Parameters<typeof ipcBridge.conversation.create.invoke>[0] = {
    type: 'aionrs',
    id: input.conversationId,
    name: input.projectName,
    model: input.model,
    extra: {
      studio_project_id: input.projectId,
      preset_rules: DIRECTOR_PRESET_RULES,
      studio_director_rules_profile: DIRECTOR_PRESET_RULES_PROFILE,
      workspace: '',
      custom_workspace: false,
      selected_mcp_server_ids: [],
      selected_session_mcp_servers: [descriptor],
    },
  };
  let conversation: unknown = null;
  let created = false;
  if (input.claimantPolicy !== 'bypass') {
    const recovery = await recoverDirectorClaimant(input.projectId, descriptor);
    if (recovery.kind === 'trusted') conversation = recovery.conversation;
    if (recovery.kind === 'conflict') {
      throw new DirectorConversationConflictError();
    }
    if (recovery.kind === 'unavailable') {
      throw new DirectorConversationStartError(recovery.messageKey, retryPolicy);
    }
    if (recovery.kind === 'none' && input.claimantPolicy === 'require-claimant') {
      throw new DirectorConversationConflictError();
    }
  }
  if (conversation === null) {
    try {
      conversation = await ipcBridge.conversation.create.invoke(request);
      created = true;
    } catch (error) {
      const recovery = await recoverDirectorClaimant(input.projectId, descriptor);
      if (recovery.kind === 'trusted') conversation = recovery.conversation;
      else if (recovery.kind === 'conflict') {
        throw new DirectorConversationConflictError();
      } else if (recovery.kind === 'unavailable') {
        throw new DirectorConversationStartError(messageKeyFromError(error, recovery.messageKey), 'scan-before-create');
      } else {
        throw new DirectorConversationStartError(
          messageKeyFromError(error, DIRECTOR_ATTACH_INTERRUPTED_KEY),
          'scan-before-create'
        );
      }
    }
  }
  if (
    !isRecord(conversation) ||
    !isSafeDirectorConversationId(conversation.id) ||
    conversation.type !== 'aionrs' ||
    !isRecord(conversation.extra) ||
    conversation.extra.studio_project_id !== input.projectId
  ) {
    throw new DirectorConversationConflictError();
  }
  const typedConversation = conversation as TChatConversation;
  if (!hasExactDirectorMcpSnapshot(typedConversation, input.projectId, descriptor)) {
    throw new DirectorConversationStartError(DIRECTOR_SESSION_VERIFICATION_KEY, 'require-claimant');
  }
  // After validation, so a conversation about to be rejected is never briefed.
  if (created) seedDirectorOpeningTurn(typedConversation.id, input.brief);
  return typedConversation;
};

const reconcileBinding = async (
  projectId: string,
  conversation: DirectorConversation,
  expectedPriorBinding: string | null,
  messageKey: string
): Promise<StartOutcome> => {
  try {
    const result = await ipcBridge.creativeStudio.getProject.invoke({ projectId });
    if (result.ok && result.data.status === 'supported') {
      const authoritativeId = result.data.project.briefConversationId ?? null;
      if (authoritativeId === conversation.id) return { kind: 'ready', conversation };
      if (authoritativeId === expectedPriorBinding) {
        return { kind: 'interrupted', conversation, expectedPriorBinding, messageKey };
      }
      if (authoritativeId !== null) return { kind: 'dangling', conversationId: authoritativeId, messageKey };
      return { kind: 'interrupted', conversation, expectedPriorBinding: null, messageKey };
    }
  } catch {
    // The candidate remains reusable, but only after an explicit retry.
  }
  return { kind: 'interrupted', conversation, expectedPriorBinding, messageKey };
};

const startDirectorConversation = async (input: StartInput): Promise<StartOutcome> => {
  const fallbackRetryPolicy = retryPolicyForClaimantPolicy(input.claimantPolicy);
  let conversation = input.candidate;
  try {
    if (conversation !== undefined) {
      const authority = await checkPersistedDirectorAuthority(conversation, input.projectId);
      if (authority.kind === 'unavailable') {
        return {
          kind: 'interrupted',
          conversation,
          expectedPriorBinding: input.expectedPriorBinding,
          messageKey: authority.messageKey,
        };
      }
      if (authority.kind === 'mismatch') {
        return { kind: 'conflict' };
      }
    } else {
      if (input.model === undefined) {
        return {
          kind: 'failed',
          messageKey: 'conversation.creativeStudio.workspace.director.noModelConfigured',
          retryPolicy: fallbackRetryPolicy,
        };
      }
      conversation = await createDirectorConversation({
        projectId: input.projectId,
        projectName: input.projectName,
        brief: input.brief,
        model: input.model,
        conversationId: input.conversationId ?? uuid(36),
        claimantPolicy: input.claimantPolicy ?? 'scan-before-create',
      });
    }
    const refreshed = await refreshDirectorPresetRules(conversation);
    if (refreshed === null) {
      return {
        kind: 'interrupted',
        conversation,
        expectedPriorBinding: input.expectedPriorBinding,
        messageKey: DIRECTOR_ATTACH_INTERRUPTED_KEY,
      };
    }
    conversation = refreshed;
  } catch (error) {
    if (error instanceof DirectorConversationConflictError) return { kind: 'conflict' };
    if (error instanceof DirectorConversationStartError) {
      return {
        kind: 'failed',
        messageKey: error.messageKey,
        retryPolicy: error.retryPolicy,
      };
    }
    return {
      kind: 'failed',
      messageKey: messageKeyFromError(error, DIRECTOR_ATTACH_INTERRUPTED_KEY),
      retryPolicy: fallbackRetryPolicy,
    };
  }

  const authority = input.currentAuthority();
  if (authority.briefConversationId === conversation.id) return { kind: 'ready', conversation };
  if (authority.briefConversationId !== input.expectedPriorBinding) {
    return authority.briefConversationId === null
      ? {
          kind: 'interrupted',
          conversation,
          expectedPriorBinding: null,
          messageKey: 'conversation.creativeStudio.workspace.errors.staleProject',
        }
      : {
          kind: 'dangling',
          conversationId: authority.briefConversationId,
          messageKey: 'conversation.creativeStudio.workspace.errors.staleProject',
        };
  }

  try {
    const bindResult = await ipcBridge.creativeStudio.bindDirectorConversation.invoke({
      projectId: input.projectId,
      expectedRevision: authority.revision,
      conversationId: conversation.id,
    });
    if (bindResult.ok === true) return { kind: 'ready', conversation };
    return reconcileBinding(input.projectId, conversation, input.expectedPriorBinding, bindResult.error.messageKey);
  } catch (error) {
    return reconcileBinding(
      input.projectId,
      conversation,
      input.expectedPriorBinding,
      messageKeyFromError(error, DIRECTOR_ATTACH_INTERRUPTED_KEY)
    );
  }
};

/** One attempt per project survives StrictMode effects, route remounts, and project revision updates. */
const directorAttempts = new Map<string, AttemptRecord>();

export const forgetDirectorConversationStart = (projectId?: string): void => {
  if (projectId === undefined) {
    directorAttempts.clear();
    directorAuthorityChecks.clear();
    directorRulesRefreshes.clear();
    return;
  }
  directorAttempts.delete(projectId);
  for (const key of directorAuthorityChecks.keys()) {
    if (key.startsWith(`${projectId}\0`)) directorAuthorityChecks.delete(key);
  }
  for (const key of directorRulesRefreshes.keys()) {
    if (key.startsWith(`${projectId}\0`)) directorRulesRefreshes.delete(key);
  }
};

const installAttempt = (input: StartInput, replaceSettled: boolean): AttemptRecord => {
  const existing = directorAttempts.get(input.projectId);
  if (existing !== undefined && (!existing.settled || !replaceSettled)) return existing;

  const claimantPolicy =
    input.claimantPolicy ??
    (existing?.outcome?.kind === 'failed' ? existing.outcome.retryPolicy : 'scan-before-create');
  const conversationId = input.candidate === undefined ? (input.conversationId ?? uuid(36)) : undefined;
  const effectiveInput = {
    ...input,
    claimantPolicy,
    ...(conversationId === undefined ? {} : { conversationId }),
  };

  const record: AttemptRecord = {
    promise: Promise.resolve({
      kind: 'failed',
      messageKey: DIRECTOR_ATTACH_INTERRUPTED_KEY,
      retryPolicy: 'scan-before-create',
    }),
    expectedPriorBinding: input.expectedPriorBinding,
    settled: false,
  };
  record.promise = startDirectorConversation(effectiveInput)
    .then((outcome) => {
      record.outcome = outcome;
      return outcome;
    })
    .finally(() => {
      record.settled = true;
    });
  directorAttempts.set(input.projectId, record);
  return record;
};

const resolveBoundConversation = async (
  project: StudioRendererProjectV2,
  conversations: readonly TChatConversation[]
): Promise<DirectorState> => {
  const conversationId = project.briefConversationId;
  if (!conversationId) return { kind: 'loading', projectId: project.id };
  const conversation = conversations.find((candidate) => candidate.id === conversationId);
  if (conversation === undefined || !hasExactDirectorMcpSnapshot(conversation, project.id)) {
    return { kind: 'dangling', projectId: project.id, conversationId };
  }
  const authority = await checkPersistedDirectorAuthority(conversation, project.id);
  if (authority.kind === 'trusted') {
    const refreshed = await refreshDirectorPresetRules(conversation);
    return refreshed === null
      ? {
          kind: 'interrupted',
          projectId: project.id,
          conversation,
          expectedPriorBinding: conversationId,
          messageKey: DIRECTOR_ATTACH_INTERRUPTED_KEY,
        }
      : { kind: 'ready', projectId: project.id, conversation: refreshed };
  }
  if (authority.kind === 'mismatch') return { kind: 'conflict', projectId: project.id };
  return {
    kind: 'interrupted',
    projectId: project.id,
    conversation,
    expectedPriorBinding: conversationId,
    messageKey: authority.messageKey,
  };
};

const DirectorConversationSurface: React.FC<{
  conversation: DirectorConversation;
  inlineItems?: readonly MessageListInlineItem[];
  beforeComposer?: React.ReactNode;
  onProposalIntent?: (intent: DirectorProposalChatIntent) => Promise<void>;
}> = ({ conversation, inlineItems, beforeComposer, onProposalIntent }) => {
  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string): Promise<boolean> => {
      const model = { ...provider, use_model: modelName } as TProviderWithModel;
      return Boolean(await ipcBridge.conversation.update.invoke({ id: conversation.id, updates: { model } }));
    },
    [conversation.id]
  );
  const modelSelection = useAionrsModelSelection({ initialModel: conversation.model, onSelectModel });

  return (
    <AionrsChat
      conversation_id={conversation.id}
      conversation={conversation}
      inlineItems={inlineItems}
      beforeComposer={beforeComposer}
      workspace={conversation.extra.workspace ?? ''}
      modelSelection={modelSelection}
      session_mode={conversation.extra.session_mode}
      loadedSkills={conversation.extra.skills}
      loadedMcpServers={conversation.extra.mcp_servers}
      loadedMcpStatuses={conversation.extra.mcp_statuses as IConversationMcpStatus[] | undefined}
      project_id={conversation.extra.project_id}
      session_mcp_servers={conversation.extra.session_mcp_servers}
      beforeSend={
        onProposalIntent === undefined
          ? undefined
          : async ({ message, hasAttachments }) => {
              if (hasAttachments) return false;
              const intent = parseDirectorProposalChatIntent(message);
              if (intent === null) return false;
              await onProposalIntent(intent);
              return true;
            }
      }
    />
  );
};

export type DirectorRailProps = {
  project: StudioRendererProjectV2;
  reviewedOutputs?: readonly MessageListInlineItem[];
  pendingProposalCount?: number;
  pendingProposalTargetId?: string;
  onProposalIntent?: (intent: DirectorProposalChatIntent) => Promise<void>;
  draftRequest?: { requestId: number; projectId: string; prompt: string } | null;
  onDraftRequestConsumed?: (requestId: number) => void;
  /** Owned by the shell: the collapse control lives in the app bar, not in this pane. */
  collapsed: boolean;
  contentId: string;
  /** Owned by the shell: the drag handle that sets it is the separator beside this pane. */
  widthPixels?: number;
};

/** A single docked owner: collapsing or changing workspace views never unmounts its chat surface. */
export const DirectorRail: React.FC<DirectorRailProps> = ({
  project,
  reviewedOutputs = [],
  pendingProposalCount = 0,
  pendingProposalTargetId,
  onProposalIntent,
  draftRequest,
  onDraftRequestConsumed,
  collapsed,
  contentId,
  widthPixels,
}) => {
  const { t } = useTranslation();
  const { allConversations, hasLoadedConversations } = useConversationHistoryContext();
  const { current_model, modelList } = useGuidModelSelection('aionrs');
  const { data: providers, error: providersError } = useProvidersQuery();
  const [state, setState] = useState<DirectorState>({ kind: 'loading', projectId: project.id });
  const stateRef = useRef(state);
  const projectRef = useRef(project);
  const conversationsRef = useRef(allConversations);
  const mountedRef = useRef(true);
  const boundResolutionVersion = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const inlineItems = useMemo<readonly MessageListInlineItem[]>(
    () =>
      reviewedOutputs.map((output) => ({
        ...output,
        id: `studio-reviewed-output-${project.id}-${output.id}`,
      })),
    [project.id, reviewedOutputs]
  );
  const reviewPendingProposal = useCallback((): void => {
    if (pendingProposalTargetId === undefined) return;
    const owner = contentRef.current;
    const target = document.getElementById(pendingProposalTargetId);
    if (owner === null || !(target instanceof HTMLElement) || !owner.contains(target)) return;
    target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: true });
  }, [pendingProposalTargetId]);
  stateRef.current = state;
  projectRef.current = project;
  conversationsRef.current = allConversations;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      boundResolutionVersion.current += 1;
    };
  }, []);

  const applyBoundConversation = useCallback(
    (projectSnapshot: StudioRendererProjectV2, conversationSnapshot: readonly TChatConversation[]): void => {
      const version = ++boundResolutionVersion.current;
      const expectedBinding = projectSnapshot.briefConversationId ?? null;
      const currentState = stateRef.current;
      if (
        currentState.kind !== 'ready' ||
        currentState.projectId !== projectSnapshot.id ||
        currentState.conversation.id !== expectedBinding
      ) {
        setState({ kind: 'loading', projectId: projectSnapshot.id });
      }
      void resolveBoundConversation(projectSnapshot, conversationSnapshot).then((nextState) => {
        const current = projectRef.current;
        if (
          mountedRef.current &&
          version === boundResolutionVersion.current &&
          current.id === projectSnapshot.id &&
          (current.briefConversationId ?? null) === expectedBinding
        ) {
          const activeState = stateRef.current;
          const preservesTrustedOwnerOnUnavailable =
            nextState.kind === 'interrupted' &&
            activeState.kind === 'ready' &&
            activeState.projectId === projectSnapshot.id &&
            activeState.conversation.id === expectedBinding;
          if (!preservesTrustedOwnerOnUnavailable) setState(nextState);
        }
      });
    },
    []
  );

  const applyOutcome = useCallback(
    (projectId: string, outcome: StartOutcome): void => {
      if (projectRef.current.id !== projectId) return;
      if (outcome.kind === 'dangling' && projectRef.current.briefConversationId === outcome.conversationId) {
        applyBoundConversation(projectRef.current, conversationsRef.current);
        return;
      }
      boundResolutionVersion.current += 1;
      if (outcome.kind === 'ready') setState({ kind: 'ready', projectId, conversation: outcome.conversation });
      else if (outcome.kind === 'interrupted') setState({ kind: 'interrupted', projectId, ...outcome });
      else if (outcome.kind === 'dangling') setState({ kind: 'dangling', projectId, ...outcome });
      else if (outcome.kind === 'conflict') setState({ kind: 'conflict', projectId });
      else setState({ kind: 'failed', projectId, messageKey: outcome.messageKey });
    },
    [applyBoundConversation]
  );

  const providersResolved = providers !== undefined || providersError !== undefined;
  const noModelConfigured = providersResolved && modelList.length === 0;

  useEffect(() => {
    if (!hasLoadedConversations) {
      setState({ kind: 'loading', projectId: project.id });
      return;
    }

    const existingAttempt = directorAttempts.get(project.id);
    const currentBinding = project.briefConversationId ?? null;
    const attemptReadyConversationId =
      existingAttempt?.outcome?.kind === 'ready' ? existingAttempt.outcome.conversation.id : null;
    const freshReciprocalOwner =
      currentBinding === null
        ? undefined
        : allConversations.find(
            (conversation) =>
              conversation.id === currentBinding && hasExactDirectorMcpSnapshot(conversation, project.id)
          );
    const settledReadyHasFreshHistory =
      existingAttempt?.settled === true &&
      existingAttempt.outcome?.kind === 'ready' &&
      currentBinding === attemptReadyConversationId &&
      freshReciprocalOwner !== undefined;
    if (
      existingAttempt !== undefined &&
      (currentBinding === existingAttempt.expectedPriorBinding || currentBinding === attemptReadyConversationId) &&
      (!existingAttempt.settled || existingAttempt.outcome?.kind !== 'failed') &&
      !settledReadyHasFreshHistory
    ) {
      const visibleAttemptOwner = stateRef.current;
      if (
        existingAttempt.settled &&
        existingAttempt.outcome?.kind === 'ready' &&
        visibleAttemptOwner.kind === 'ready' &&
        visibleAttemptOwner.projectId === project.id &&
        visibleAttemptOwner.conversation.id === existingAttempt.outcome.conversation.id
      ) {
        return;
      }
      let subscribed = true;
      setState({ kind: 'starting', projectId: project.id });
      void existingAttempt.promise.then((outcome) => subscribed && applyOutcome(project.id, outcome));
      return () => {
        subscribed = false;
      };
    }

    if (project.briefConversationId) {
      applyBoundConversation(project, allConversations);
      return;
    }

    const claimants = allConversations.filter((conversation) => conversation.extra.studio_project_id === project.id);
    const reusable = claimants.filter((conversation): conversation is DirectorConversation =>
      hasExactDirectorMcpSnapshot(conversation, project.id)
    );
    if (claimants.length === 1 && reusable.length === 1) {
      let subscribed = true;
      setState({ kind: 'loading', projectId: project.id });
      void checkPersistedDirectorAuthority(reusable[0], project.id).then((authority) => {
        if (!subscribed) return;
        setState(
          authority.kind === 'trusted'
            ? {
                kind: 'interrupted',
                projectId: project.id,
                conversation: reusable[0],
                expectedPriorBinding: null,
                messageKey: DIRECTOR_ATTACH_INTERRUPTED_KEY,
              }
            : authority.kind === 'mismatch'
              ? { kind: 'conflict', projectId: project.id }
              : {
                  kind: 'interrupted',
                  projectId: project.id,
                  conversation: reusable[0],
                  expectedPriorBinding: null,
                  messageKey: authority.messageKey,
                }
        );
      });
      return () => {
        subscribed = false;
      };
    }
    if (claimants.length > 0) {
      setState({ kind: 'conflict', projectId: project.id });
      return;
    }
    if (existingAttempt?.outcome?.kind === 'failed') {
      applyOutcome(project.id, existingAttempt.outcome);
      return;
    }
    if (noModelConfigured) {
      setState({
        kind: 'failed',
        projectId: project.id,
        messageKey: 'conversation.creativeStudio.workspace.director.noModelConfigured',
      });
      return;
    }
    if (current_model === undefined) {
      setState({ kind: 'loading', projectId: project.id });
      return;
    }

    const attempt = installAttempt(
      {
        projectId: project.id,
        projectName: project.name,
        brief: project.brief,
        model: current_model,
        expectedPriorBinding: null,
        currentAuthority: () => {
          const current = projectRef.current;
          return {
            revision: current.revision,
            briefConversationId: current.briefConversationId ?? null,
          };
        },
      },
      false
    );
    let subscribed = true;
    setState({ kind: 'starting', projectId: project.id });
    void attempt.promise.then((outcome) => subscribed && applyOutcome(project.id, outcome));
    return () => {
      subscribed = false;
    };
  }, [
    allConversations,
    applyBoundConversation,
    applyOutcome,
    current_model,
    hasLoadedConversations,
    noModelConfigured,
    project.briefConversationId,
    project.id,
    project.name,
  ]);

  const visibleState: DirectorState =
    state.projectId === project.id ? state : { kind: 'loading', projectId: project.id };
  const consumedDraftRequestRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      draftRequest === null ||
      draftRequest === undefined ||
      draftRequest.projectId !== project.id ||
      visibleState.kind !== 'ready' ||
      consumedDraftRequestRef.current === draftRequest.requestId
    ) {
      return;
    }
    requestConversationSendBoxPrefill(visibleState.conversation.id, draftRequest.prompt);
    consumedDraftRequestRef.current = draftRequest.requestId;
    onDraftRequestConsumed?.(draftRequest.requestId);
  }, [draftRequest, onDraftRequestConsumed, project.id, visibleState]);

  const runExplicitAttempt = useCallback(
    (
      candidate: DirectorConversation | undefined,
      expectedPriorBinding: string | null,
      claimantPolicy?: DirectorClaimantPolicy
    ): void => {
      const attempt = installAttempt(
        {
          projectId: project.id,
          projectName: project.name,
          brief: project.brief,
          model: current_model,
          candidate,
          claimantPolicy,
          expectedPriorBinding,
          currentAuthority: () => {
            const current = projectRef.current;
            return {
              revision: current.revision,
              briefConversationId: current.briefConversationId ?? null,
            };
          },
        },
        true
      );
      setState({ kind: 'starting', projectId: project.id });
      void attempt.promise.then((outcome) => applyOutcome(project.id, outcome));
    },
    [applyOutcome, current_model, project.id, project.name]
  );

  const handleRecovery = useCallback((): void => {
    if (visibleState.kind === 'interrupted') {
      allowDirectorPresetRulesRetry(visibleState.conversation);
      runExplicitAttempt(visibleState.conversation, visibleState.expectedPriorBinding);
      return;
    }
    runExplicitAttempt(
      undefined,
      visibleState.kind === 'dangling' ? visibleState.conversationId : (project.briefConversationId ?? null),
      visibleState.kind === 'conflict' ? 'bypass' : undefined
    );
  }, [project.briefConversationId, runExplicitAttempt, visibleState]);

  const effectiveRules = useMemo(() => resolveEffectiveStudioRules(project.rules), [project.rules]);
  const lastPinSignature = useRef<string | null>(null);
  useEffect(() => {
    if (visibleState.kind !== 'ready') return;
    const conversation = visibleState.conversation;
    const pin = buildStudioBriefRulesPin({ rules: effectiveRules, now: Date.now() });
    const signature = `${conversation.id}:${pin?.content ?? ''}`;
    if (lastPinSignature.current === signature) return;
    const currentPins = getConversationPinnedContext(conversation);
    const preserved = currentPins.filter((item) => item.id !== STUDIO_BRIEF_RULES_PIN_ID);
    if (pin === null && preserved.length === currentPins.length) return;
    lastPinSignature.current = signature;
    const patch = buildContextHandoffExtraPatch(conversation, {
      pinned_context: pin === null ? preserved : [...preserved, pin],
    });
    void ipcBridge.conversation.update
      .invoke({
        id: conversation.id,
        merge_extra: true,
        updates: { extra: patch as TChatConversation['extra'] },
      })
      .then((ok) => {
        if (!ok) lastPinSignature.current = null;
      })
      .catch(() => {
        lastPinSignature.current = null;
      });
  }, [effectiveRules, visibleState]);

  const title = t('conversation.creativeStudio.workspace.director.title');
  const recoverLabel =
    visibleState.kind === 'dangling' || visibleState.kind === 'conflict'
      ? t('conversation.creativeStudio.workspace.director.startFresh')
      : t('conversation.creativeStudio.workspace.director.retry');
  const errorMessage =
    visibleState.kind === 'conflict'
      ? t(DIRECTOR_CONFLICT_KEY)
      : 'messageKey' in visibleState && visibleState.messageKey
        ? t(visibleState.messageKey)
        : null;

  return (
    <aside
      aria-label={title}
      className={`${styles.rail} ${collapsed ? styles.collapsed : ''}`}
      style={
        collapsed || widthPixels === undefined
          ? undefined
          : { inlineSize: `${widthPixels}px`, minInlineSize: `${widthPixels}px` }
      }
      data-studio-director-rail
    >
      <div ref={contentRef} id={contentId} className={styles.content} aria-hidden={collapsed} inert={collapsed}>
        <div className={styles.owner} data-studio-director-conversation-owner>
          {visibleState.kind === 'ready' ? (
            <DirectorConversationSurface
              key={visibleState.conversation.id}
              conversation={visibleState.conversation}
              inlineItems={inlineItems}
              beforeComposer={
                pendingProposalCount > 0 ? (
                  <section
                    aria-label={t('conversation.creativeStudio.workspace.proposals.waitingCount', {
                      count: pendingProposalCount,
                    })}
                    className={styles.pendingProposalStrip}
                    data-studio-director-pending-proposals
                  >
                    <span className={styles.pendingProposalLabel}>
                      {t('conversation.creativeStudio.workspace.proposals.waitingCount', {
                        count: pendingProposalCount,
                      })}
                    </span>
                    <Button
                      aria-controls={pendingProposalTargetId}
                      disabled={pendingProposalTargetId === undefined}
                      onClick={reviewPendingProposal}
                      size='mini'
                      type='text'
                    >
                      {t('conversation.creativeStudio.workspace.proposals.reviewDetails')}
                    </Button>
                  </section>
                ) : null
              }
              onProposalIntent={onProposalIntent}
            />
          ) : (
            <div className={styles.notice} aria-live='polite'>
              {visibleState.kind === 'loading' || visibleState.kind === 'starting' ? (
                <span className={styles.starting}>
                  <Spin size={14} />
                  {t('conversation.creativeStudio.workspace.director.starting')}
                </span>
              ) : (
                <>
                  {visibleState.kind === 'dangling' ? (
                    <p>{t('conversation.creativeStudio.workspace.director.danglingNotice')}</p>
                  ) : null}
                  {visibleState.kind === 'interrupted' ? (
                    <p>{t('conversation.creativeStudio.workspace.director.interruptedNotice')}</p>
                  ) : null}
                  {errorMessage === null ? null : <p role='alert'>{errorMessage}</p>}
                  <Button type='primary' onClick={handleRecovery}>
                    {recoverLabel}
                  </Button>
                </>
              )}
              {inlineItems.length === 0 ? null : (
                <div className={styles.pendingOutputs} data-studio-director-pending-output-fallback>
                  {inlineItems.map((item) => (
                    <div
                      key={item.id}
                      className={styles.pendingOutput}
                      data-message-inline-item={item.id}
                      data-studio-director-reviewed-output
                    >
                      {item.content}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
