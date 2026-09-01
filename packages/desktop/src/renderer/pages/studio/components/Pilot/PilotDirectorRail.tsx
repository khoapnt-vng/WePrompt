/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Spin } from '@arco-design/web-react';
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
import { SESSION_MCP_RESOLVER_PROFILE } from '@/common/config/storage';
import { BUILTIN_STUDIO_NAME } from '@/common/config/builtinCapabilities';
import {
  STUDIO_PILOT_ENV,
  type StudioPilotDirectorSessionAuthorityV3,
} from '@/common/types/project/creativeStudioPilotMcpEnv';
import type { StudioProjectLoadResultV3 } from '@/common/types/project/creativeStudioTypes';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import AionrsChat from '@/renderer/pages/conversation/platforms/aionrs/AionrsChat';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import type { StudioPilotClientV3 } from './PilotCanvas';
import styles from './PilotDirectorRail.module.css';

type DirectorConversation = Extract<TChatConversation, { type: 'aionrs' }>;
type SupportedProject = Extract<StudioProjectLoadResultV3, { status: 'supported' }>;

const PILOT_DIRECTOR_RULES = [
  'You are the Creative Director for this photo canvas.',
  'Use only studio_get_project_status, studio_prepare_photo, studio_rename_piece, and studio_get_command_status.',
  'A Piece is one photograph. Ask concise questions until the direction is clear.',
  'studio_prepare_photo creates a quote only. It never authorizes generation or spends money.',
  'Only the person may confirm a quote. Never claim that a prepared quote generated a photograph.',
  'Read fresh project status before using an authoring revision. Answer in the language the person uses.',
].join('\n');

const RULES_PROFILE = `studio-pilot-director-v1:${PILOT_DIRECTOR_RULES.length}`;
const FINGERPRINT = /^[a-f0-9]{64}$/u;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};
const hasSafeServer = (
  server: unknown,
  projectId: string,
  authority: StudioPilotDirectorSessionAuthorityV3
): server is ISessionMcpServer => {
  if (!isRecord(server) || !isRecord(server.transport)) return false;
  const transport = server.transport;
  const env = transport.env;
  return (
    server.id === authority.serverId &&
    server.name === BUILTIN_STUDIO_NAME &&
    transport.type === 'stdio' &&
    transport.command === 'node' &&
    Array.isArray(transport.args) &&
    transport.args.length === 1 &&
    transport.args[0] === authority.scriptPath &&
    isRecord(env) &&
    Reflect.ownKeys(env).length === 2 &&
    env[STUDIO_PILOT_ENV.projectId] === projectId &&
    env[STUDIO_PILOT_ENV.projectDir] === authority.projectDir
  );
};
const hasExactConversationAuthority = (
  value: TChatConversation,
  projectId: string,
  authority: StudioPilotDirectorSessionAuthorityV3,
  descriptor?: ISessionMcpServer,
  expectedFingerprint?: string
): value is DirectorConversation => {
  if (!isDirectorConversation(value, projectId)) return false;
  const servers = value.extra.session_mcp_servers;
  const snapshots = value.extra.session_mcp_trust;
  if (
    Object.hasOwn(value.extra, 'selected_session_mcp_trust_claims') ||
    !Array.isArray(servers) ||
    servers.length !== 1 ||
    !Array.isArray(snapshots) ||
    snapshots.length !== 1 ||
    !isRecord(snapshots[0]) ||
    !hasSafeServer(servers[0], projectId, authority)
  ) {
    return false;
  }
  const snapshot = snapshots[0];
  return (
    snapshot.server_id === authority.serverId &&
    typeof snapshot.server_fingerprint === 'string' &&
    FINGERPRINT.test(snapshot.server_fingerprint) &&
    (expectedFingerprint === undefined || snapshot.server_fingerprint === expectedFingerprint) &&
    snapshot.resolver_profile === SESSION_MCP_RESOLVER_PROFILE &&
    (descriptor === undefined || canonicalJson(servers[0].transport) === canonicalJson(descriptor.transport))
  );
};
const seedOpeningTurn = (conversationId: string, brief: string): void => {
  const input = brief.trim();
  if (input.length === 0) return;
  try {
    window.sessionStorage.setItem(`aionrs_initial_message_${conversationId}`, JSON.stringify({ input }));
  } catch {
    // Losing the convenience seed must not invalidate an otherwise attested conversation.
  }
};
const isDirectorConversation = (
  value: TChatConversation,
  projectId: string,
  conversationId?: string | null
): value is DirectorConversation =>
  value.type === 'aionrs' &&
  value.extra.studio_project_id === projectId &&
  (conversationId === undefined || conversationId === null || value.id === conversationId);

const ConversationSurface: React.FC<{ conversation: DirectorConversation }> = ({ conversation }) => {
  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string): Promise<boolean> =>
      Boolean(
        await ipcBridge.conversation.update.invoke({
          id: conversation.id,
          updates: { model: { ...provider, use_model: modelName } as TProviderWithModel },
        })
      ),
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

export const PilotDirectorRail: React.FC<{ projectId: string; client: StudioPilotClientV3 }> = ({
  projectId,
  client,
}) => {
  const { t } = useTranslation();
  const { allConversations, hasLoadedConversations } = useConversationHistoryContext();
  const { current_model, modelList } = useGuidModelSelection('aionrs');
  const { data: providers, error: providersError } = useProvidersQuery();
  const [project, setProject] = useState<SupportedProject | null>(null);
  const [conversation, setConversation] = useState<DirectorConversation | null>(null);
  const [error, setError] = useState(false);
  const starting = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const next = await client.loadProjectV3(projectId);
        if (active && next.status === 'supported') setProject(next);
      } catch {
        if (active) setError(true);
      }
    };
    void load();
    const unwatch = client.watchProjectUpdatesV3((update) => {
      const updatedProjectId = update.source === 'prepared' ? update.projectId : update.facts.projectId;
      if (updatedProjectId === projectId) void load();
    });
    return () => {
      active = false;
      unwatch();
    };
  }, [client, projectId]);

  const bound = project?.director.briefConversationId ?? null;
  useEffect(() => {
    if (!hasLoadedConversations || project === null) return;
    if (bound !== null) {
      const existing = allConversations.find((candidate) => isDirectorConversation(candidate, projectId, bound));
      if (existing === undefined) {
        setConversation(null);
        setError(true);
        return;
      }
      void Promise.all([
        ipcBridge.creativeStudioPilot.getDirectorSessionServer.invoke({ projectId }),
        ipcBridge.creativeStudioPilot.getDirectorSessionAuthority.invoke({ projectId }),
      ]).then(([descriptorResult, authorityResult]) => {
        if (
          descriptorResult.ok &&
          authorityResult.ok &&
          hasExactConversationAuthority(
            existing,
            projectId,
            authorityResult.data,
            descriptorResult.data.server,
            descriptorResult.data.serverFingerprint
          )
        ) {
          setConversation(existing);
        } else {
          setError(true);
        }
      });
      return;
    }
    const claimant = allConversations.find((candidate) => isDirectorConversation(candidate, projectId));
    if (claimant !== undefined) {
      if (starting.current) return;
      starting.current = true;
      void Promise.all([
        ipcBridge.creativeStudioPilot.getDirectorSessionServer.invoke({ projectId }),
        ipcBridge.creativeStudioPilot.getDirectorSessionAuthority.invoke({ projectId }),
      ])
        .then(async ([descriptorResult, authorityResult]) => {
          if (
            !descriptorResult.ok ||
            !authorityResult.ok ||
            !hasExactConversationAuthority(
              claimant,
              projectId,
              authorityResult.data,
              descriptorResult.data.server,
              descriptorResult.data.serverFingerprint
            )
          ) {
            throw new Error('director_claimant_authority_failed');
          }
          const binding = await ipcBridge.creativeStudioPilot.bindDirectorConversation.invoke({
            projectId,
            expectedAuthoringRevision: project.canvas.authoringRevision,
            conversationId: claimant.id,
          });
          if (!binding.ok) throw new Error('director_binding_failed');
          setConversation(claimant);
        })
        .catch(() => setError(true))
        .finally(() => {
          starting.current = false;
        });
      return;
    }
    if (current_model === undefined || modelList.length === 0 || providers === undefined || starting.current) return;
    starting.current = true;
    void ipcBridge.creativeStudioPilot.getDirectorSessionServer
      .invoke({ projectId })
      .then(async (descriptorResult) => {
        if (!descriptorResult.ok) throw new Error('director_descriptor_failed');
        const authorityResult = await ipcBridge.creativeStudioPilot.getDirectorSessionAuthority.invoke({ projectId });
        if (
          !authorityResult.ok ||
          !hasSafeServer(descriptorResult.data.server, projectId, authorityResult.data) ||
          !FINGERPRINT.test(descriptorResult.data.serverFingerprint)
        ) {
          throw new Error('director_authority_failed');
        }
        // AionCore owns conversation identity. The create endpoint ignores a
        // client-supplied id, so every subsequent write must use its response.
        const created = await ipcBridge.conversation.create.invoke({
          type: 'aionrs',
          name: project.summary.name,
          model: current_model,
          extra: {
            studio_project_id: projectId,
            preset_rules: PILOT_DIRECTOR_RULES,
            studio_director_rules_profile: RULES_PROFILE,
            workspace: '',
            custom_workspace: false,
            selected_mcp_server_ids: [],
            selected_session_mcp_servers: [descriptorResult.data.server],
            selected_session_mcp_trust_claims: [descriptorResult.data.trustClaim],
          },
        });
        if (
          !isDirectorConversation(created, projectId) ||
          !hasExactConversationAuthority(
            created,
            projectId,
            authorityResult.data,
            descriptorResult.data.server,
            descriptorResult.data.serverFingerprint
          )
        ) {
          throw new Error('director_create_failed');
        }
        const binding = await ipcBridge.creativeStudioPilot.bindDirectorConversation.invoke({
          projectId,
          expectedAuthoringRevision: project.canvas.authoringRevision,
          conversationId: created.id,
        });
        if (!binding.ok) throw new Error('director_binding_failed');
        seedOpeningTurn(created.id, project.director.brief);
        setConversation(created);
      })
      .catch(() => setError(true))
      .finally(() => {
        starting.current = false;
      });
  }, [allConversations, bound, current_model, hasLoadedConversations, modelList.length, project, projectId, providers]);

  const providerStateResolved = providers !== undefined || providersError !== undefined;
  const content = useMemo(() => {
    if (conversation !== null) return <ConversationSurface conversation={conversation} />;
    if (error) return <Alert type='error' content={t('conversation.creativeStudio.pilot.director.failed')} />;
    if (providerStateResolved && modelList.length === 0) {
      return <Alert type='warning' content={t('conversation.creativeStudio.pilot.director.noModel')} />;
    }
    return <Spin dot aria-label={t('conversation.creativeStudio.pilot.director.loading')} />;
  }, [conversation, error, modelList.length, providerStateResolved, t]);

  return (
    <aside className={styles.rail} aria-label={t('conversation.creativeStudio.pilot.director.title')}>
      <header className={styles.header}>{t('conversation.creativeStudio.pilot.director.title')}</header>
      <div className={styles.content}>{content}</div>
    </aside>
  );
};
