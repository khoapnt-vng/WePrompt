/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import SidebarIcon from '@/renderer/components/base/SidebarIcon';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { buildContextHandoffExtraPatch } from '@/renderer/pages/conversation/contextHandoff/contextConversationUpdate';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
import AionrsChat from '@/renderer/pages/conversation/platforms/aionrs/AionrsChat';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import styles from './DirectorRail.module.css';

type DirectorConversation = Extract<TChatConversation, { type: 'aionrs' }>;

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
  | { kind: 'failed'; messageKey: string; reuseConversationId: boolean };

type StartInput = {
  projectId: string;
  projectName: string;
  model?: TProviderWithModel;
  candidate?: DirectorConversation;
  conversationId?: string;
  recoverBeforeCreate?: boolean;
  expectedPriorBinding: string | null;
  currentAuthority: () => { revision: number; briefConversationId: string | null };
};

type AttemptRecord = {
  promise: Promise<StartOutcome>;
  /** The exact authority this attempt was allowed to replace when it began. */
  expectedPriorBinding: string | null;
  settled: boolean;
  outcome?: StartOutcome;
  conversationId?: string;
};

const STORAGE_ERROR_KEY = 'conversation.creativeStudio.workspace.errors.storage';
const DIRECTOR_CONFLICT_KEY = 'conversation.creativeStudio.workspace.director.ownerConflict';
const expectedServerId = (projectId: string): string => `studio-brief-${projectId}`;

class DirectorConversationStartError extends Error {
  constructor(
    message: string,
    readonly reuseConversationId: boolean
  ) {
    super(message);
  }
}

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

const isSafeRouteConstraints = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  hasExactKeys(value, [
    'aspectRatios',
    'resolutions',
    'minDurationSeconds',
    'maxDurationSeconds',
    'supportsFirstFrame',
    'maxConditioningImages',
    'silentOutput',
  ]) &&
  isExactUniqueEnumArray(value.aspectRatios, ASPECT_RATIOS) &&
  isExactUniqueEnumArray(value.resolutions, RESOLUTIONS) &&
  Number.isInteger(value.minDurationSeconds) &&
  Number.isInteger(value.maxDurationSeconds) &&
  Number(value.minDurationSeconds) >= 1 &&
  Number(value.maxDurationSeconds) <= 60 &&
  Number(value.minDurationSeconds) <= Number(value.maxDurationSeconds) &&
  typeof value.supportsFirstFrame === 'boolean' &&
  Number.isInteger(value.maxConditioningImages) &&
  Number(value.maxConditioningImages) >= 0 &&
  Number(value.maxConditioningImages) <= 6 &&
  typeof value.silentOutput === 'boolean';

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
export const hasSafeDirectorTransport = (server: ISessionMcpServer, projectId: string): boolean => {
  const transport = server.transport;
  if (transport.type !== 'stdio' || !hasExactKeys(transport, ['type', 'command', 'args', 'env'])) return false;
  const scriptPath = normalizedAbsolutePath(transport.args?.[0]);
  if (
    transport.command !== 'node' ||
    transport.args?.length !== 1 ||
    scriptPath === null ||
    !scriptPath.endsWith('/out/main/builtin-mcp-studio.js')
  ) {
    return false;
  }
  const env = transport.env;
  if (env === undefined || !hasExactKeys(env, Object.values(STUDIO_ENV))) return false;
  if (env[STUDIO_ENV.projectId] !== projectId) return false;
  const projectDir = normalizedAbsolutePath(env[STUDIO_ENV.projectDir]);
  const pendingDir = normalizedAbsolutePath(env[STUDIO_ENV.pendingDir]);
  const referencePendingDir = normalizedAbsolutePath(env[STUDIO_ENV.referencePendingDir]);
  return (
    projectDir !== null &&
    projectDir.endsWith(`/${projectId}`) &&
    pendingDir === `${projectDir}/proposals/pending` &&
    referencePendingDir === `${projectDir}/reference-requests/pending` &&
    typeof env[STUDIO_ENV.routeCatalog] === 'string' &&
    env[STUDIO_ENV.routeCatalog].length <= 1_000_000 &&
    hasSafeRouteCatalog(env[STUDIO_ENV.routeCatalog])
  );
};

const hasExactUniqueMembers = (actual: readonly string[] | undefined, expected: readonly string[]): boolean => {
  if (!Array.isArray(actual) || actual.length !== expected.length || new Set(actual).size !== actual.length) {
    return false;
  }
  return actual.every((value) => expected.includes(value));
};

/** The persisted conversation must contain the Studio server and no ambient MCP attachment. */
export const hasExactDirectorMcpSnapshot = (
  conversation: TChatConversation,
  projectId: string,
  descriptor?: ISessionMcpServer
): conversation is DirectorConversation => {
  if (conversation.type !== 'aionrs' || conversation.extra.studio_project_id !== projectId) return false;
  const serverId = expectedServerId(projectId);
  if (descriptor !== undefined && (descriptor.id !== serverId || descriptor.name !== BUILTIN_STUDIO_NAME)) return false;

  const statuses = conversation.extra.mcp_statuses;
  const sessionServers = conversation.extra.session_mcp_servers;
  const snapshotMatches =
    hasExactUniqueMembers(conversation.extra.mcp_server_ids, []) &&
    hasExactUniqueMembers(conversation.extra.mcp_servers, [BUILTIN_STUDIO_NAME]) &&
    hasExactUniqueMembers(
      statuses?.map((status) => status.id),
      [serverId]
    ) &&
    statuses?.every((status) => status.name === BUILTIN_STUDIO_NAME) === true &&
    hasExactUniqueMembers(
      sessionServers?.map((server) => server.id),
      [serverId]
    ) &&
    sessionServers?.every((server) => server.name === BUILTIN_STUDIO_NAME) === true;
  if (!snapshotMatches || !hasSafeDirectorTransport(sessionServers[0], projectId)) return false;

  if (descriptor === undefined) return true;
  const persistedDescriptor = sessionServers?.[0];
  return JSON.stringify(persistedDescriptor?.transport) === JSON.stringify(descriptor.transport);
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

type DirectorAuthorityOutcome =
  | { kind: 'trusted' }
  | { kind: 'mismatch' }
  | { kind: 'unavailable'; messageKey: string };
type DirectorAuthorityCheck = { snapshot: string; promise: Promise<DirectorAuthorityOutcome> };
const directorAuthorityChecks = new Map<string, DirectorAuthorityCheck>();

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
    .catch((): DirectorAuthorityOutcome => ({ kind: 'unavailable', messageKey: STORAGE_ERROR_KEY }))
    .then((outcome) => {
      if (outcome.kind === 'unavailable' && directorAuthorityChecks.get(key)?.promise === promise) {
        directorAuthorityChecks.delete(key);
      }
      return outcome;
    });
  directorAuthorityChecks.set(key, { snapshot, promise });
  return promise;
};

const createDirectorConversation = async (input: {
  projectId: string;
  projectName: string;
  model: TProviderWithModel;
  conversationId: string;
  recoverBeforeCreate?: boolean;
}): Promise<DirectorConversation> => {
  const descriptorResult = await ipcBridge.creativeStudio.getBriefSessionServer.invoke({ projectId: input.projectId });
  if (descriptorResult.ok === false) throw new Error(descriptorResult.error.messageKey);
  const descriptor = descriptorResult.data;
  if (
    descriptor.id !== expectedServerId(input.projectId) ||
    descriptor.name !== BUILTIN_STUDIO_NAME ||
    !hasSafeDirectorTransport(descriptor, input.projectId)
  ) {
    throw new Error(STORAGE_ERROR_KEY);
  }

  const request: Parameters<typeof ipcBridge.conversation.create.invoke>[0] = {
    type: 'aionrs',
    id: input.conversationId,
    name: input.projectName,
    model: input.model,
    extra: {
      studio_project_id: input.projectId,
      workspace: '',
      custom_workspace: false,
      selected_mcp_server_ids: [],
      selected_session_mcp_servers: [descriptor],
    },
  };
  let conversation: TChatConversation | null = null;
  if (input.recoverBeforeCreate) {
    try {
      const recovered = await ipcBridge.conversation.get.invoke({ id: input.conversationId });
      if (recovered?.id === input.conversationId) conversation = recovered;
    } catch {
      // The next create is idempotent by deterministic id and performs the same recovery on failure.
    }
  }
  if (conversation === null) {
    try {
      conversation = await ipcBridge.conversation.create.invoke(request);
    } catch (error) {
      try {
        const recovered = await ipcBridge.conversation.get.invoke({ id: input.conversationId });
        if (recovered?.id !== input.conversationId) throw error;
        conversation = recovered;
      } catch {
        throw new DirectorConversationStartError(error instanceof Error ? error.message : STORAGE_ERROR_KEY, true);
      }
    }
  }
  if (conversation.id !== input.conversationId) {
    throw new DirectorConversationStartError(STORAGE_ERROR_KEY, false);
  }
  if (!hasExactDirectorMcpSnapshot(conversation, input.projectId, descriptor)) {
    throw new DirectorConversationStartError(STORAGE_ERROR_KEY, false);
  }
  return conversation;
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
        return { kind: 'failed', messageKey: DIRECTOR_CONFLICT_KEY, reuseConversationId: false };
      }
    } else {
      if (input.model === undefined) {
        return {
          kind: 'failed',
          messageKey: 'conversation.creativeStudio.workspace.director.noModelConfigured',
          reuseConversationId: false,
        };
      }
      conversation = await createDirectorConversation({
        projectId: input.projectId,
        projectName: input.projectName,
        model: input.model,
        conversationId: input.conversationId ?? uuid(36),
        recoverBeforeCreate: input.recoverBeforeCreate,
      });
    }
  } catch (error) {
    return {
      kind: 'failed',
      messageKey:
        error instanceof Error && error.message.startsWith('conversation.') ? error.message : STORAGE_ERROR_KEY,
      reuseConversationId: error instanceof DirectorConversationStartError && error.reuseConversationId,
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
  } catch {
    return reconcileBinding(input.projectId, conversation, input.expectedPriorBinding, STORAGE_ERROR_KEY);
  }
};

/** One attempt per project survives StrictMode effects, route remounts, and project revision updates. */
const directorAttempts = new Map<string, AttemptRecord>();

export const forgetDirectorConversationStart = (projectId?: string): void => {
  if (projectId === undefined) {
    directorAttempts.clear();
    directorAuthorityChecks.clear();
    return;
  }
  directorAttempts.delete(projectId);
  for (const key of directorAuthorityChecks.keys()) {
    if (key.startsWith(`${projectId}\0`)) directorAuthorityChecks.delete(key);
  }
};

const installAttempt = (input: StartInput, replaceSettled: boolean): AttemptRecord => {
  const existing = directorAttempts.get(input.projectId);
  if (existing !== undefined && (!existing.settled || !replaceSettled)) return existing;

  const reusableConversationId =
    existing?.outcome?.kind === 'failed' && existing.outcome.reuseConversationId ? existing.conversationId : undefined;
  const conversationId =
    input.candidate === undefined ? (reusableConversationId ?? input.conversationId ?? uuid(36)) : undefined;
  const effectiveInput = {
    ...input,
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(reusableConversationId === undefined ? {} : { recoverBeforeCreate: true }),
  };

  const record: AttemptRecord = {
    promise: Promise.resolve({ kind: 'failed', messageKey: STORAGE_ERROR_KEY, reuseConversationId: false }),
    expectedPriorBinding: input.expectedPriorBinding,
    settled: false,
    conversationId,
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
  if (authority.kind === 'trusted') return { kind: 'ready', projectId: project.id, conversation };
  if (authority.kind === 'mismatch') return { kind: 'conflict', projectId: project.id };
  return {
    kind: 'interrupted',
    projectId: project.id,
    conversation,
    expectedPriorBinding: conversationId,
    messageKey: authority.messageKey,
  };
};

const DirectorConversationSurface: React.FC<{ conversation: DirectorConversation }> = ({ conversation }) => {
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
      workspace={conversation.extra.workspace ?? ''}
      modelSelection={modelSelection}
      session_mode={conversation.extra.session_mode}
      loadedSkills={conversation.extra.skills}
      loadedMcpServers={conversation.extra.mcp_servers}
      loadedMcpStatuses={conversation.extra.mcp_statuses as IConversationMcpStatus[] | undefined}
      project_id={conversation.extra.project_id}
      session_mcp_servers={conversation.extra.session_mcp_servers}
    />
  );
};

export type DirectorRailProps = {
  project: StudioRendererProjectV2;
  reviewedOutput?: React.ReactNode;
};

/** A single docked owner: collapsing or changing workspace views never unmounts its chat surface. */
export const DirectorRail: React.FC<DirectorRailProps> = ({ project, reviewedOutput }) => {
  const { t } = useTranslation();
  const { allConversations, hasLoadedConversations } = useConversationHistoryContext();
  const { current_model, modelList } = useGuidModelSelection('aionrs');
  const { data: providers, error: providersError } = useProvidersQuery();
  const [state, setState] = useState<DirectorState>({ kind: 'loading', projectId: project.id });
  const [collapsed, setCollapsed] = useState(false);
  const stateRef = useRef(state);
  const projectRef = useRef(project);
  const conversationsRef = useRef(allConversations);
  const mountedRef = useRef(true);
  const boundResolutionVersion = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const contentId = useId();
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
                messageKey: STORAGE_ERROR_KEY,
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

  const runExplicitAttempt = useCallback(
    (candidate: DirectorConversation | undefined, expectedPriorBinding: string | null): void => {
      const attempt = installAttempt(
        {
          projectId: project.id,
          projectName: project.name,
          model: current_model,
          candidate,
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
      runExplicitAttempt(visibleState.conversation, visibleState.expectedPriorBinding);
      return;
    }
    runExplicitAttempt(
      undefined,
      visibleState.kind === 'dangling' ? visibleState.conversationId : (project.briefConversationId ?? null)
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

  const handleCollapse = useCallback((): void => {
    if (!collapsed && contentRef.current?.contains(document.activeElement)) {
      headerRef.current?.querySelector<HTMLElement>('[data-studio-director-toggle]')?.focus();
    }
    setCollapsed((current) => !current);
  }, [collapsed]);

  const title = t('conversation.creativeStudio.workspace.director.title');
  const toggleLabel = t(
    collapsed
      ? 'conversation.creativeStudio.workspace.director.show'
      : 'conversation.creativeStudio.workspace.director.hide'
  );
  const recoverLabel =
    visibleState.kind === 'dangling' || visibleState.kind === 'conflict'
      ? t('conversation.creativeStudio.workspace.director.startFresh')
      : t('conversation.creativeStudio.workspace.director.retry');
  const errorMessage =
    visibleState.kind === 'conflict'
      ? t('conversation.creativeStudio.workspace.director.ownerConflict')
      : 'messageKey' in visibleState && visibleState.messageKey
        ? t(visibleState.messageKey)
        : null;

  return (
    <aside
      aria-label={title}
      className={`${styles.rail} ${collapsed ? styles.collapsed : ''}`}
      data-studio-director-rail
    >
      <header ref={headerRef} className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <Button
          type='text'
          shape='circle'
          icon={<SidebarIcon />}
          className={styles.toggle}
          data-studio-director-toggle
          aria-controls={contentId}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={handleCollapse}
        />
      </header>
      <div ref={contentRef} id={contentId} className={styles.content} aria-hidden={collapsed} inert={collapsed}>
        <div className={styles.owner} data-studio-director-conversation-owner>
          {visibleState.kind === 'ready' ? (
            <DirectorConversationSurface key={visibleState.conversation.id} conversation={visibleState.conversation} />
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
            </div>
          )}
        </div>
        {reviewedOutput === undefined ? null : (
          <div className={styles.reviewedOutput} data-studio-director-reviewed-output>
            {reviewedOutput}
          </div>
        )}
      </div>
    </aside>
  );
};
