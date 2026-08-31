/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { buildGuidSlashCommands } from '@/common/chat/slash/guidSlashCommands';
import type { SlashCommandItem } from '@/common/chat/slash/types';
import type { IMcpServer, TProviderWithModel } from '@/common/config/storage';
import { PRESENTATION_RUN_V2_ENABLED } from '@/common/config/constants';
import { resolveLocaleKey } from '@/common/utils';
import type { AssistantDetail } from '@/common/types/agent/assistantTypes';
import type { PresentationRunFailure } from '@/common/types/office/presentationRun';

import { useInputFocusRing } from '@/renderer/hooks/chat/useInputFocusRing';
import { appendPromptToDraft } from '@/renderer/hooks/chat/useSendBoxDraft';
import { getFuzzyMatchIndices, useSlashCommandController } from '@/renderer/hooks/chat/useSlashCommandController';
import SlashCommandMenu, { type SlashCommandMenuItem } from '@/renderer/components/chat/SlashCommandMenu';
import AssistantSelectionArea from './components/AssistantSelectionArea';
import GuidActionRow from './components/GuidActionRow';
import GuidInputCard from './components/GuidInputCard';
import GuidModelSelector from './components/GuidModelSelector';
import { useGuidAssistantSelection } from './hooks/useGuidAssistantSelection';
import { useGuidInput } from './hooks/useGuidInput';
import { useGuidModelSelection } from './hooks/useGuidModelSelection';
import { useGuidSend, type GuidManagedPresentationSourceChange } from './hooks/useGuidSend';
import { useTypewriterPlaceholder } from './hooks/useTypewriterPlaceholder';
import { getWorkspaceBasename, readProjects } from '@/renderer/pages/conversation/projects/projectStorage';
import { ensureBackendMcpCatalog } from '@/renderer/hooks/mcp/catalog';
import { resolveGuidAssistantDefaults } from './utils/assistantDefaults';
import SpeechInputButton from '@/renderer/components/chat/SpeechInputButton';
import {
  TemplateChipCard,
  TemplateGalleryButton,
  TemplateGalleryExpanded,
  usePresentationTemplates,
} from '@/renderer/components/chat/TemplateGallery';
import { getPresentationRunEligibility } from '@/renderer/components/chat/TemplateGallery/usePresentationTemplates';
import { useOpenFileSelector, usePresentationSourceDraft } from '@/renderer/hooks/file/selection';
import { appendSpeechTranscript } from '@/renderer/hooks/system/useSpeechInput';
import { useLiveTranscriptInsertion } from '@/renderer/hooks/system/useLiveTranscriptInsertion';
import { Button, ConfigProvider } from '@arco-design/web-react';
import { FolderOpen, Layers, Lightning, Paperclip, Star } from '@icon-park/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import styles from './index.module.css';

type GuidNavigationState = {
  resetAssistant?: boolean;
  selectedAssistantId?: string;
  prefillPrompt?: string;
  prefillFiles?: string[];
  preservePrefillDraft?: boolean;
  focusPrefill?: boolean;
  workspace?: string;
  [key: string]: unknown;
};

const GUID_PRESENTATION_DRAFT_REQUEST_STORAGE_KEY = 'guid_presentation_draft_request_v2';
const GUID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readGuidPresentationDraftClientRequestId = (): string => {
  try {
    const stored = sessionStorage.getItem(GUID_PRESENTATION_DRAFT_REQUEST_STORAGE_KEY);
    if (stored && GUID_UUID_RE.test(stored)) return stored;
  } catch {
    // The managed send will fail closed when it cannot confirm persistence.
  }
  return crypto.randomUUID();
};

function trackGuidPresentationDraftExpiry<Result extends { ok: boolean }>(
  result: Result,
  expiredRef: { current: boolean }
): Result {
  if (result.ok) expiredRef.current = false;
  else if ('code' in result && result.code === 'DRAFT_EXPIRED') expiredRef.current = true;
  return result;
}

const GuidPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const guidContainerRef = useRef<HTMLDivElement>(null);
  const { activeBorderColor, inactiveBorderColor, activeShadow } = useInputFocusRing();

  const localeKey = resolveLocaleKey(i18n.language);
  // --- Skills state ---
  // Skill metadata comes from the database-backed catalog. Built-in auto-inject
  // skills default checked; the rest are opt-in per conversation or pre-checked
  // by assistant defaults.
  const [allSkills, setAllSkills] = useState<Array<{ name: string; description: string; isAuto: boolean }>>([]);
  const [guidDisabledBuiltinSkills, setGuidDisabledBuiltinSkills] = useState<string[] | undefined>(undefined);
  const [guidEnabledSkills, setGuidEnabledSkills] = useState<string[] | undefined>(undefined);
  const [availableMcpServers, setAvailableMcpServers] = useState<IMcpServer[]>([]);
  const [guidSelectedMcpServerIds, setGuidSelectedMcpServerIds] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    ipcBridge.fs.listAvailableSkills
      .invoke()
      .then((availableSkills) => {
        setAllSkills(
          availableSkills.map((s) => ({
            name: s.name,
            description: s.description,
            isAuto: s.source === 'builtin' && s.is_auto_inject,
          }))
        );
      })
      .catch(() => setAllSkills([]));
  }, []);

  useEffect(() => {
    void ensureBackendMcpCatalog()
      .then(({ allServers }) => {
        setAvailableMcpServers(allServers);
      })
      .catch((error) => {
        console.error('[GuidPage] Failed to load MCP catalog:', error);
        setAvailableMcpServers([]);
      });
  }, []);

  const handleToggleSkill = useCallback((skillName: string, isAuto: boolean) => {
    if (isAuto) {
      setGuidDisabledBuiltinSkills((prev) => {
        const list = prev ?? [];
        return list.includes(skillName) ? list.filter((s) => s !== skillName) : [...list, skillName];
      });
    } else {
      setGuidEnabledSkills((prev) => {
        const list = prev ?? [];
        return list.includes(skillName) ? list.filter((s) => s !== skillName) : [...list, skillName];
      });
    }
  }, []);

  const handleToggleMcpServer = useCallback((serverId: string) => {
    setGuidSelectedMcpServerIds((prev) => {
      const current = prev ?? [];
      return current.includes(serverId) ? current.filter((id) => id !== serverId) : [...current, serverId];
    });
  }, []);

  // --- Hooks ---
  // Only aionrs uses this provider-based model picker now (Gemini runs as a
  // regular ACP backend with its own model selector).
  const modelSelection = useGuidModelSelection('aionrs');

  const navState = location.state as GuidNavigationState | null;
  const resetAssistantRequested = navState?.resetAssistant === true;
  const preselectAssistantId = navState?.selectedAssistantId;
  const agentSelection = useGuidAssistantSelection({
    resetAssistant: resetAssistantRequested,
    preselectAssistantId,
    locationKey: location.key,
  });

  const guidInput = useGuidInput({
    locationState: location.state as { workspace?: string; projectId?: string } | null,
  });
  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      guidInput.setFiles((prevFiles) => [...prevFiles, ...files]);
    },
    [guidInput.setFiles]
  );
  const { onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
  });
  const presentationTemplates = usePresentationTemplates();
  const presentationSources = usePresentationSourceDraft();
  const presentationDraftClientRequestIdRef = useRef<string | null>(null);
  const presentationDraftExpiredRef = useRef(false);
  const presentationRecoveryStartedRef = useRef(false);
  const retireManagedPresentationAttemptRef = useRef<
    (change: GuidManagedPresentationSourceChange | null) => Promise<void>
  >(async () => {});
  if (presentationDraftClientRequestIdRef.current === null) {
    presentationDraftClientRequestIdRef.current = readGuidPresentationDraftClientRequestId();
  }
  const [showPresentationSourceReselect, setShowPresentationSourceReselect] = useState(false);
  const presentationRunEligible = getPresentationRunEligibility({
    featureEnabled: PRESENTATION_RUN_V2_ENABLED,
    isDesktop: typeof window !== 'undefined' && Boolean(window.electronAPI),
    scope: guidInput.projectId ? 'unknown' : 'individual',
    runtime: agentSelection.selectedAssistant?.agent?.type ?? null,
    templateFormat: presentationTemplates.selectedTemplate?.manifest.format ?? null,
  });
  const presentationRunEligibleRef = useRef(presentationRunEligible);
  presentationRunEligibleRef.current = presentationRunEligible;
  const requiresPresentationSourceReselect = presentationRunEligible && guidInput.files.length > 0;

  const persistPresentationDraftClientRequestId = useCallback((clientRequestId: string): boolean => {
    try {
      sessionStorage.setItem(GUID_PRESENTATION_DRAFT_REQUEST_STORAGE_KEY, clientRequestId);
      return sessionStorage.getItem(GUID_PRESENTATION_DRAFT_REQUEST_STORAGE_KEY) === clientRequestId;
    } catch {
      return false;
    }
  }, []);

  const ensurePresentationSourceDraft = useCallback(
    async (allowExpiredReselect = false): Promise<boolean> => {
      const replaceExpiredDraft = allowExpiredReselect && presentationDraftExpiredRef.current;
      if (presentationSources.owner !== null && !replaceExpiredDraft) return true;
      let clientRequestId = replaceExpiredDraft ? crypto.randomUUID() : presentationDraftClientRequestIdRef.current;
      if (clientRequestId === null) {
        clientRequestId = crypto.randomUUID();
      }
      presentationDraftClientRequestIdRef.current = clientRequestId;
      if (!persistPresentationDraftClientRequestId(clientRequestId)) return false;
      let result = trackGuidPresentationDraftExpiry(
        await presentationSources.createDraft(clientRequestId),
        presentationDraftExpiredRef
      );
      const failureCode = 'code' in result ? (result.code as PresentationRunFailure['code']) : null;
      if (failureCode === 'DRAFT_EXPIRED' && allowExpiredReselect) {
        clientRequestId = crypto.randomUUID();
        presentationDraftClientRequestIdRef.current = clientRequestId;
        if (!persistPresentationDraftClientRequestId(clientRequestId)) return false;
        result = trackGuidPresentationDraftExpiry(
          await presentationSources.createDraft(clientRequestId),
          presentationDraftExpiredRef
        );
      }
      return result.ok;
    },
    [persistPresentationDraftClientRequestId, presentationSources]
  );

  const preparePresentationSourceOwner = useCallback(
    async (recoveryConversationId?: string) => {
      if (recoveryConversationId) {
        const recovered = trackGuidPresentationDraftExpiry(
          await presentationSources.hydrate({
            owner_type: 'conversation',
            conversation_id: recoveryConversationId,
          }),
          presentationDraftExpiredRef
        );
        if (recovered.ok && recovered.ownerRevision > 0) return recovered;
        if ('code' in recovered && recovered.code !== 'RUN_NOT_FOUND') return recovered;
      }

      const currentOwner = presentationSources.owner;
      const currentOwnerIsSyntheticConversation =
        currentOwner?.owner_type === 'conversation' && presentationSources.ownerRevision === 0;
      if (currentOwner !== null && !currentOwnerIsSyntheticConversation) {
        return trackGuidPresentationDraftExpiry(
          await presentationSources.hydrate(currentOwner),
          presentationDraftExpiredRef
        );
      }

      const clientRequestId = presentationDraftClientRequestIdRef.current ?? crypto.randomUUID();
      presentationDraftClientRequestIdRef.current = clientRequestId;
      if (!persistPresentationDraftClientRequestId(clientRequestId)) {
        const failure: PresentationRunFailure = {
          ok: false,
          code: 'PERSISTENCE_FAILED',
          messageKey: 'conversation.presentationRun.errors.PERSISTENCE_FAILED',
          retryable: false,
          state: 'preflight',
          details: { postInvoked: false },
        };
        return failure;
      }
      const created = trackGuidPresentationDraftExpiry(
        await presentationSources.createDraft(clientRequestId),
        presentationDraftExpiredRef
      );
      if ('code' in created) return created;
      return trackGuidPresentationDraftExpiry(
        await presentationSources.hydrate({ owner_type: 'draft', draft_id: created.draft.draftId }),
        presentationDraftExpiredRef
      );
    },
    [persistPresentationDraftClientRequestId, presentationSources]
  );

  const handlePresentationSourcePicker = useCallback(async (): Promise<void> => {
    if (!(await ensurePresentationSourceDraft(true))) return;
    if (!presentationRunEligibleRef.current) return;
    const result = await presentationSources.pickSources();
    if (presentationRunEligibleRef.current && result?.ok && result.status === 'selected') {
      presentationDraftExpiredRef.current = false;
      await retireManagedPresentationAttemptRef.current({ kind: 'added' });
      guidInput.setFiles([]);
      setShowPresentationSourceReselect(false);
    }
  }, [ensurePresentationSourceDraft, guidInput.setFiles, presentationSources.pickSources]);

  const handlePresentationSourceDrop = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (!(await ensurePresentationSourceDraft(true))) return;
      if (!presentationRunEligibleRef.current) return;
      const result = await presentationSources.grantExternalDrop(files);
      if (presentationRunEligibleRef.current && result?.ok && result.status === 'granted') {
        presentationDraftExpiredRef.current = false;
        await retireManagedPresentationAttemptRef.current({ kind: 'added' });
        guidInput.setFiles([]);
        setShowPresentationSourceReselect(false);
      }
    },
    [ensurePresentationSourceDraft, guidInput.setFiles, presentationSources.grantExternalDrop]
  );

  const handlePresentationSourceRevoke = useCallback(
    (grantId: string): void => {
      void presentationSources.revoke(grantId).then(async (result) => {
        if (
          result?.ok &&
          (result.status === 'revoked' || result.status === 'already_revoked') &&
          result.grantId === grantId &&
          result.queueUnboundAtRevoke === true
        ) {
          presentationDraftExpiredRef.current = false;
          await retireManagedPresentationAttemptRef.current({
            kind: 'revoked',
            grantId,
            queueUnboundAtRevoke: true,
          });
        }
      });
    },
    [presentationSources.revoke]
  );

  useEffect(() => {
    if (!requiresPresentationSourceReselect) {
      setShowPresentationSourceReselect(false);
    }
  }, [requiresPresentationSourceReselect]);

  const resetMentionOpen = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(() => {}, []);
  const resetMentionQuery = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(() => {}, []);
  const resetMentionActiveIndex = useCallback<React.Dispatch<React.SetStateAction<number>>>(() => {}, []);

  const selectedAssistantId = agentSelection.selectedAssistantId;
  const hasSelectedAssistant = selectedAssistantId !== null;
  const { data: selectedAssistantDetail } = useSWR(
    selectedAssistantId ? `guid.assistant.detail.${selectedAssistantId}.${localeKey}` : null,
    async (): Promise<AssistantDetail | null> =>
      ipcBridge.assistants.get
        .invoke({ id: selectedAssistantId!, locale: localeKey })
        .catch((_error: unknown): AssistantDetail | null => null)
  );
  const resolvedAssistantDefaults = useMemo(
    () => resolveGuidAssistantDefaults(selectedAssistantDetail),
    [selectedAssistantDetail]
  );
  const selectedSkillNames = useMemo(() => {
    const disabledBuiltinSkillSet = new Set(
      guidDisabledBuiltinSkills ?? resolvedAssistantDefaults.disabledBuiltinSkillIds
    );
    const enabledSkillSet = new Set(guidEnabledSkills ?? resolvedAssistantDefaults.skillIds);

    return allSkills
      .filter((skill) => (skill.isAuto ? !disabledBuiltinSkillSet.has(skill.name) : enabledSkillSet.has(skill.name)))
      .map((skill) => skill.name);
  }, [
    allSkills,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    resolvedAssistantDefaults.disabledBuiltinSkillIds,
    resolvedAssistantDefaults.skillIds,
  ]);
  const skillDescriptionByName = useMemo(
    () => new Map(allSkills.map((skill) => [skill.name, skill.description])),
    [allSkills]
  );
  const guidBuiltinSlashCommands = useMemo<SlashCommandItem[]>(
    () => [
      {
        name: 'open',
        description: t('conversation.workspace.addFile', { defaultValue: 'Add File' }),
        kind: 'builtin',
        source: 'builtin',
      },
      {
        name: 'presentation',
        description: t('conversation.presentationTemplates.slashDescription', {
          defaultValue: 'Choose a presentation template',
        }),
        kind: 'builtin',
        source: 'builtin',
      },
    ],
    [t]
  );
  const guidSlashCommands = useMemo(
    () =>
      buildGuidSlashCommands({
        builtinCommands: guidBuiltinSlashCommands,
        agentCommands: agentSelection.currentAgentAvailableCommands,
        selectedSkills: selectedSkillNames,
        descriptionByName: skillDescriptionByName,
        skillFallbackDescription: t('conversation.skills.slashHint', { defaultValue: 'Skill' }),
      }),
    [
      agentSelection.currentAgentAvailableCommands,
      guidBuiltinSlashCommands,
      selectedSkillNames,
      skillDescriptionByName,
      t,
    ]
  );
  const slashController = useSlashCommandController({
    input: guidInput.input,
    commands: guidSlashCommands,
    onExecuteBuiltin: (name) => {
      if (name === 'presentation') {
        presentationTemplates.openGallery();
        guidInput.setInput('');
        return;
      }
      if (name === 'open' && presentationRunEligible) {
        void handlePresentationSourcePicker();
        guidInput.setInput('');
        return;
      }
      onSlashBuiltinCommand(name);
      guidInput.setInput('');
    },
    onSelectTemplate: (name) => {
      guidInput.setInput(`/${name} `);
    },
  });
  const slashMenuItems = useMemo<SlashCommandMenuItem[]>(
    () =>
      slashController.filteredCommands.map((command) => ({
        key: command.name,
        label: `/${command.name}`,
        description: command.description,
        badge: command.hint,
        highlightIndices: slashController.query
          ? getFuzzyMatchIndices(command.name, slashController.query)?.map((index) => index + 1)
          : undefined,
      })),
    [slashController.filteredCommands, slashController.query]
  );

  const handleManagedPresentationHandoffAccepted = useCallback((): void => {
    presentationDraftExpiredRef.current = false;
    presentationSources.reset();
    setShowPresentationSourceReselect(false);
    try {
      sessionStorage.removeItem(GUID_PRESENTATION_DRAFT_REQUEST_STORAGE_KEY);
    } catch {
      // The durable queue already owns the handoff; stale path-free IDs are harmless.
    }
  }, [presentationSources.reset]);

  const managedGuidPresentation = useMemo(
    () =>
      presentationRunEligible && presentationTemplates.selectedTemplate && presentationDraftClientRequestIdRef.current
        ? {
            selectedTemplateId: presentationTemplates.selectedTemplate.manifest.id,
            draftClientRequestId: presentationDraftClientRequestIdRef.current,
            sourceRefs: presentationSources.sourceRefs,
            conversationId:
              presentationSources.owner?.owner_type === 'conversation'
                ? presentationSources.owner.conversation_id
                : undefined,
            prepareSourceOwner: preparePresentationSourceOwner,
            bindDraft: presentationSources.bindDraft,
            onHandoffAccepted: handleManagedPresentationHandoffAccepted,
          }
        : undefined,
    [
      handleManagedPresentationHandoffAccepted,
      preparePresentationSourceOwner,
      presentationRunEligible,
      presentationSources.bindDraft,
      presentationSources.owner,
      presentationSources.sourceRefs,
      presentationTemplates.selectedTemplate,
    ]
  );

  const send = useGuidSend({
    // Input state
    input: guidInput.input,
    setInput: guidInput.setInput,
    files: guidInput.files,
    setFiles: guidInput.setFiles,
    dir: guidInput.dir,
    setDir: guidInput.setDir,
    projectId: guidInput.projectId,
    setProjectId: guidInput.setProjectId,
    setLoading: guidInput.setLoading,
    loading: guidInput.loading,

    // Agent state
    selectedAssistantId: agentSelection.selectedAssistantId,
    selectedAssistantBackend: agentSelection.selectedAssistantBackend,
    selectedMode: agentSelection.selectedMode,
    selectedAcpModel: agentSelection.selectedAcpModel,
    selectedThoughtLevelValue: agentSelection.selectedThoughtLevelValue,
    currentAcpCachedModelInfo: agentSelection.currentAcpCachedModelInfo,
    current_model: modelSelection.current_model,

    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    assistantDefaultSkillIds: resolvedAssistantDefaults.skillIds,
    assistantDefaultDisabledBuiltinSkillIds: resolvedAssistantDefaults.disabledBuiltinSkillIds,
    availableMcpServers,
    selectedMcpServerIds: guidSelectedMcpServerIds,
    assistantDefaultMcpIds: resolvedAssistantDefaults.mcpIds,
    isGoogleAuth: modelSelection.isGoogleAuth,

    composePresentationSend: presentationTemplates.composeSend,
    onPresentationTemplateConsumed: presentationTemplates.clearSelection,
    requiresPresentationSourceReselect,
    onPresentationSourceReselectRequired: () => setShowPresentationSourceReselect(true),
    managedPresentation: managedGuidPresentation,

    // Mention state reset
    setMentionOpen: resetMentionOpen,
    setMentionQuery: resetMentionQuery,
    setMentionSelectorOpen: resetMentionOpen,
    setMentionActiveIndex: resetMentionActiveIndex,

    // Navigation
    navigate,
    t,
    localeKey,
  });
  const pendingPresentationRecovery = PRESENTATION_RUN_V2_ENABLED ? (send.managedPresentationRecovery ?? null) : null;
  useEffect(() => {
    if (
      pendingPresentationRecovery === null ||
      guidInput.projectId !== undefined ||
      typeof window === 'undefined' ||
      !window.electronAPI
    ) {
      return;
    }
    const currentRuntime = agentSelection.selectedAssistantBackend === 'aionrs' ? 'aionrs' : 'acp';
    if (pendingPresentationRecovery.runtime !== currentRuntime) return;
    const recoveredTemplate = presentationTemplates.templates.find(
      (template) =>
        template.manifest.id === pendingPresentationRecovery.selectedTemplateId && template.manifest.format === 'pptx'
    );
    if (recoveredTemplate === undefined) return;
    if (presentationTemplates.selectedTemplate?.manifest.id !== recoveredTemplate.manifest.id) {
      presentationTemplates.selectTemplate(recoveredTemplate);
    }
    if (presentationRecoveryStartedRef.current) return;
    presentationRecoveryStartedRef.current = true;
    presentationDraftClientRequestIdRef.current = pendingPresentationRecovery.draftClientRequestId;
    if (!persistPresentationDraftClientRequestId(pendingPresentationRecovery.draftClientRequestId)) return;
    void preparePresentationSourceOwner(pendingPresentationRecovery.conversationId).catch(() => {
      // The durable pending snapshot stays intact so a later retry or remount can recover again.
    });
  }, [
    agentSelection.selectedAssistantBackend,
    guidInput.projectId,
    pendingPresentationRecovery,
    persistPresentationDraftClientRequestId,
    preparePresentationSourceOwner,
    presentationTemplates,
  ]);
  retireManagedPresentationAttemptRef.current =
    send.retireManagedPresentationAttemptAfterSourceChange ?? (async (): Promise<void> => {});

  // --- Coordinated handlers (depend on multiple hooks) ---
  const handleInputChange = useCallback(
    (value: string) => {
      guidInput.setInput(value);
    },
    [guidInput.setInput]
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (slashController.onKeyDown(event)) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!guidInput.input.trim()) return;
        send.sendMessageHandler();
      }
    },
    [guidInput.input, send.sendMessageHandler, slashController]
  );

  const handleSelectAssistant = useCallback(
    (assistantId: string) => {
      agentSelection.setSelectedAssistantId(assistantId);
    },
    [agentSelection.setSelectedAssistantId]
  );

  // Typewriter placeholder
  const typewriterPlaceholder = useTypewriterPlaceholder(t('conversation.welcome.placeholder'));
  const selectedAssistantRecord = useMemo(() => {
    if (!selectedAssistantId) return undefined;
    const selectedId = agentSelection.selectedAssistantId;
    const strippedId = selectedId.replace(/^builtin-/, '');
    const candidates = new Set([selectedId, `builtin-${strippedId}`, strippedId]);
    return agentSelection.assistants.find((item) => candidates.has(item.id));
  }, [agentSelection.assistants, selectedAssistantId, agentSelection.selectedAssistantId]);
  const projectWelcomeName = useMemo(() => {
    if (!guidInput.dir) {
      return null;
    }

    if (guidInput.projectId) {
      const project = readProjects().find((item) => item.id === guidInput.projectId);
      if (project) {
        return project.name;
      }
    }

    return getWorkspaceBasename(guidInput.dir);
  }, [guidInput.dir, guidInput.projectId]);
  const welcomeTitle = projectWelcomeName
    ? t('conversation.welcome.projectTitle', { name: projectWelcomeName })
    : t('conversation.welcome.title');
  const isProjectWelcome = Boolean(projectWelcomeName);
  const selectedAssistantPrompts = useMemo(() => {
    if (!selectedAssistantId) return [];
    const resolvedPrompts =
      selectedAssistantDetail?.prompts.recommended_i18n?.[localeKey] ||
      selectedAssistantDetail?.prompts.recommended_i18n?.['en-US'] ||
      selectedAssistantDetail?.prompts.recommended ||
      selectedAssistantRecord?.prompts_i18n?.[localeKey] ||
      selectedAssistantRecord?.prompts_i18n?.['en-US'] ||
      selectedAssistantRecord?.prompts ||
      [];

    const fallbackPrompts = isProjectWelcome
      ? [
          t('guid.defaultProjectPrompts.reviewFiles'),
          t('guid.defaultProjectPrompts.summarizeFolder'),
          t('guid.defaultProjectPrompts.createPlan'),
          t('guid.defaultProjectPrompts.findNextSteps'),
        ]
      : [
          t('guid.defaultPrompts.understand'),
          t('guid.defaultPrompts.cleanup'),
          t('guid.defaultPrompts.create'),
          t('guid.defaultPrompts.reviewFolder'),
        ];

    return Array.from(new Set([...resolvedPrompts, ...fallbackPrompts])).slice(0, 4);
  }, [isProjectWelcome, localeKey, selectedAssistantDetail, selectedAssistantRecord, selectedAssistantId, t]);

  // Sync disabledBuiltinSkills + enabledSkills from assistant detail defaults.
  useEffect(() => {
    if (!selectedAssistantId || !selectedAssistantDetail) {
      setGuidDisabledBuiltinSkills(undefined);
      setGuidEnabledSkills(undefined);
      return;
    }

    const resolvedDefaults = resolveGuidAssistantDefaults(selectedAssistantDetail);
    setGuidDisabledBuiltinSkills(resolvedDefaults.disabledBuiltinSkillIds);
    setGuidEnabledSkills(resolvedDefaults.skillIds);
  }, [selectedAssistantDetail, selectedAssistantId]);

  const appliedAssistantDefaultsKeyRef = useRef<string | null>(null);
  const manualModelSelectionAssistantRef = useRef<string | null>(null);
  const manualThoughtLevelSelectionAssistantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedAssistantId || !selectedAssistantDetail) {
      appliedAssistantDefaultsKeyRef.current = null;
      manualModelSelectionAssistantRef.current = null;
      manualThoughtLevelSelectionAssistantRef.current = null;
      return;
    }

    const signature = JSON.stringify({
      assistantId: selectedAssistantId,
      backend: agentSelection.selectedAssistantBackend,
      defaults: selectedAssistantDetail.defaults,
      preferences: {
        last_model_id: selectedAssistantDetail.preferences.last_model_id,
        last_permission_value: selectedAssistantDetail.preferences.last_permission_value,
        last_thought_level_value: selectedAssistantDetail.preferences.last_thought_level_value,
        last_mcp_ids: selectedAssistantDetail.preferences.last_mcp_ids,
      },
      availableModels: {
        acp: agentSelection.currentAcpCachedModelInfo?.available_models.map((model) => model.id) ?? [],
        aionrs: modelSelection.modelList.map((provider) => ({
          id: provider.id,
          models: provider.models,
        })),
      },
      availableModes: agentSelection.currentAgentModeOptions.map((mode) => mode.value),
      availableThoughtLevels: agentSelection.currentThoughtLevelOption?.options.map((option) => option.value) ?? [],
    });
    if (appliedAssistantDefaultsKeyRef.current === signature) {
      return;
    }
    appliedAssistantDefaultsKeyRef.current = signature;

    const applyAssistantDefaults = async () => {
      const resolvedDefaults = resolveGuidAssistantDefaults(selectedAssistantDetail);
      const effectiveBackend = agentSelection.selectedAssistantBackend;
      const shouldApplyDefaultModel = manualModelSelectionAssistantRef.current !== selectedAssistantId;
      const shouldApplyDefaultThoughtLevel = manualThoughtLevelSelectionAssistantRef.current !== selectedAssistantId;

      if (shouldApplyDefaultModel && effectiveBackend === 'aionrs') {
        if (resolvedDefaults.modelId) {
          const matchedProvider = modelSelection.modelList.find((provider) =>
            provider.models.includes(resolvedDefaults.modelId!)
          );
          if (matchedProvider) {
            await modelSelection.setCurrentModel(
              {
                ...matchedProvider,
                use_model: resolvedDefaults.modelId,
              },
              { persistPreference: false }
            );
          }
        } else {
          await modelSelection.resetCurrentModel({ persistPreference: false });
        }
      } else if (shouldApplyDefaultModel && resolvedDefaults.modelId) {
        const availableModelIds = new Set(agentSelection.currentAcpCachedModelInfo?.available_models.map((m) => m.id));
        agentSelection.setSelectedAcpModel(
          availableModelIds.size === 0 || availableModelIds.has(resolvedDefaults.modelId)
            ? resolvedDefaults.modelId
            : null,
          { persistPreference: false }
        );
      } else if (shouldApplyDefaultModel) {
        agentSelection.setSelectedAcpModel(null, { persistPreference: false });
      }

      if (resolvedDefaults.permissionMode) {
        const availableModeIds = new Set(agentSelection.currentAgentModeOptions.map((mode) => mode.value));
        if (availableModeIds.size === 0 || availableModeIds.has(resolvedDefaults.permissionMode)) {
          agentSelection.setSelectedMode(resolvedDefaults.permissionMode, { persistPreference: false });
        } else {
          const fallbackMode = agentSelection.currentAgentModeOptions[0]?.value;
          if (fallbackMode) {
            agentSelection.setSelectedMode(fallbackMode, { persistPreference: false });
          }
        }
      }
      if (shouldApplyDefaultThoughtLevel && agentSelection.currentThoughtLevelOption) {
        const availableThoughtLevelValues = new Set(
          agentSelection.currentThoughtLevelOption.options.map((option) => option.value)
        );
        if (resolvedDefaults.thoughtLevel && availableThoughtLevelValues.has(resolvedDefaults.thoughtLevel)) {
          agentSelection.setSelectedThoughtLevelValue(resolvedDefaults.thoughtLevel, { persistPreference: false });
        } else {
          const fallbackThoughtLevel =
            agentSelection.currentThoughtLevelOption.currentValue ||
            agentSelection.currentThoughtLevelOption.options[0]?.value ||
            '';
          agentSelection.setSelectedThoughtLevelValue(fallbackThoughtLevel, { persistPreference: false });
        }
      }
      setGuidSelectedMcpServerIds(resolvedDefaults.mcpIds);
    };

    void applyAssistantDefaults().catch((error) => {
      console.error('[GuidPage] Failed to apply assistant defaults:', error);
    });
  }, [
    agentSelection.currentAcpCachedModelInfo?.available_models,
    agentSelection.currentAgentModeOptions,
    agentSelection.currentThoughtLevelOption,
    agentSelection.selectedAssistantBackend,
    agentSelection.setSelectedAcpModel,
    agentSelection.setSelectedMode,
    agentSelection.setSelectedThoughtLevelValue,
    modelSelection.modelList,
    modelSelection.resetCurrentModel,
    modelSelection.setCurrentModel,
    selectedAssistantId,
    selectedAssistantDetail,
  ]);

  const setGuidSelectedMode = useCallback(
    (mode: React.SetStateAction<string>) => {
      agentSelection.setSelectedMode(mode, { persistPreference: !hasSelectedAssistant });
    },
    [agentSelection, hasSelectedAssistant]
  );
  const setGuidSelectedAcpModel = useCallback(
    (model: React.SetStateAction<string | null>) => {
      manualModelSelectionAssistantRef.current = selectedAssistantId;
      agentSelection.setSelectedAcpModel(model, { persistPreference: !hasSelectedAssistant });
    },
    [agentSelection, hasSelectedAssistant, selectedAssistantId]
  );
  const setGuidSelectedThoughtLevel = useCallback(
    (value: string) => {
      manualThoughtLevelSelectionAssistantRef.current = selectedAssistantId;
      agentSelection.setSelectedThoughtLevelValue(value, { persistPreference: !hasSelectedAssistant });
    },
    [agentSelection, hasSelectedAssistant, selectedAssistantId]
  );
  const setGuidCurrentModel = useCallback(
    (model: TProviderWithModel) => {
      manualModelSelectionAssistantRef.current = selectedAssistantId;
      return modelSelection.setCurrentModel(model, { persistPreference: !hasSelectedAssistant });
    },
    [hasSelectedAssistant, modelSelection, selectedAssistantId]
  );

  // Reset guid-local UI state before paint so same-route navigations do not
  // briefly show the previous draft or preset assistant layout. When a caller
  // navigates here with a `prefillPrompt` (e.g. "Create via chat" from the
  // scheduled tasks page), seed the input with it instead of clearing.
  //
  // The prefill is consumed once per navigation: a ref keyed on location.key
  // guards against re-seeding if the user later clears the input and returns to
  // this history entry (e.g. via back navigation), which would otherwise revive
  // the prompt from the still-present location.state.
  const consumedPrefillKeyRef = useRef<string | null>(null);
  // When a "via chat" navigation also pins an assistant (selectedAssistantId),
  // the assistant-selection cleanup effect below fires a state-clearing
  // replace() that churns location.key. That second pass has no prefillPrompt
  // and would otherwise wipe the freshly seeded input. This flag lets exactly
  // one such follow-up pass skip the clear, preserving the seeded prompt.
  const skipNextClearRef = useRef(false);
  useLayoutEffect(() => {
    const prefillState = location.state as GuidNavigationState | null;
    const prefillPrompt = prefillState?.prefillPrompt;
    const prefillFiles = prefillState?.prefillFiles;
    const preserveCurrentDraft = Boolean(prefillState?.preservePrefillDraft || skipNextClearRef.current);
    if (pendingPresentationRecovery !== null) {
      guidInput.setInput(pendingPresentationRecovery.input);
      guidInput.setFiles([]);
    } else if (prefillPrompt && consumedPrefillKeyRef.current !== location.key) {
      // Consume prompt + optional attachments (e.g. bug-report screenshots) once.
      consumedPrefillKeyRef.current = location.key;
      skipNextClearRef.current = true;
      if (prefillState.preservePrefillDraft) {
        guidInput.setInput((draft) => appendPromptToDraft(draft, prefillPrompt));
      } else {
        guidInput.setInput(prefillPrompt);
        guidInput.setFiles(prefillFiles && prefillFiles.length > 0 ? prefillFiles : []);
      }
    } else if (skipNextClearRef.current) {
      // This pass is the state-clearing replace() right after a prefill — keep
      // the seeded input instead of clearing it.
      skipNextClearRef.current = false;
    } else {
      guidInput.setInput('');
      guidInput.setFiles([]);
    }
    guidInput.setLoading(false);
    if (!preserveCurrentDraft && !(location.state as { workspace?: string } | null)?.workspace) {
      guidInput.setDir('');
    }
  }, [
    guidInput.setDir,
    guidInput.setFiles,
    guidInput.setInput,
    guidInput.setLoading,
    location.key,
    location.state,
    pendingPresentationRecovery,
  ]);

  // A draft-preserving prefill is an action, not durable navigation state.
  // Strip it after consumption so browser history or a remount cannot replay it.
  useEffect(() => {
    const prefillState = location.state as GuidNavigationState | null;
    if (!prefillState?.preservePrefillDraft || !prefillState.prefillPrompt) return;

    const {
      prefillPrompt: _prefillPrompt,
      prefillFiles: _prefillFiles,
      preservePrefillDraft: _preservePrefillDraft,
      focusPrefill: _focusPrefill,
      ...remainingState
    } = prefillState;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(remainingState).length > 0 ? remainingState : null,
    });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  // Clear resetAssistant from location.state after the hook has consumed it,
  // so that re-renders don't re-trigger the reset logic.
  //
  // Must go through React Router's navigate — raw window.history.replaceState
  // with `location.pathname` would write the HashRouter virtual path (e.g.
  // '/guid') into the browser's real URL and strip the leading '#'. On the
  // next hard reload, the browser would then request '/guid' directly from
  // the dev server (which has no SPA fallback) and 404.
  useEffect(() => {
    if (!resetAssistantRequested && !preselectAssistantId) return;
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [resetAssistantRequested, preselectAssistantId, location.pathname, location.search, location.hash, navigate]);

  // Agents that use configured model providers instead of ACP probe-based models.
  // Only aionrs now — Gemini runs as a regular ACP backend with ACP-cached models.
  const PROVIDER_BASED_AGENTS = new Set(['aionrs']);
  const isGeminiMode = PROVIDER_BASED_AGENTS.has(agentSelection.selectedAssistantBackend);

  // Build the mention dropdown node
  // Build the model selector node
  const modelSelectorNode = (
    <GuidModelSelector
      isGeminiMode={isGeminiMode}
      modelList={modelSelection.modelList}
      current_model={modelSelection.current_model}
      setCurrentModel={setGuidCurrentModel}
      currentAcpCachedModelInfo={agentSelection.currentAcpCachedModelInfo}
      selectedAcpModel={agentSelection.selectedAcpModel}
      setSelectedAcpModel={setGuidSelectedAcpModel}
      thoughtLevelOption={isGeminiMode ? null : agentSelection.currentThoughtLevelOption}
      onThoughtLevelSelect={setGuidSelectedThoughtLevel}
    />
  );

  const handleSpeechTranscript = useCallback(
    (transcript: string) => {
      guidInput.setInput((prev) => appendSpeechTranscript(prev, transcript));
    },
    [guidInput.setInput]
  );
  const { handleLiveTranscript } = useLiveTranscriptInsertion(guidInput.setInput);
  const presentationSourceNoticeNode =
    showPresentationSourceReselect && requiresPresentationSourceReselect ? (
      <div
        className='mt-8px flex items-center justify-between gap-8px rounded-8px border border-warning-3 bg-warning-1 px-10px py-8px text-12px text-warning-7'
        role='alert'
      >
        <span>{t('conversation.presentationTemplates.sources.reselectRequired')}</span>
        <Button
          type='text'
          size='mini'
          loading={presentationSources.pending}
          onClick={() => void handlePresentationSourcePicker()}
        >
          {t('conversation.presentationTemplates.sources.reselectAction')}
        </Button>
      </div>
    ) : null;

  // Build the action row
  const actionRowNode = (
    <GuidActionRow
      files={guidInput.files}
      onFilesUploaded={guidInput.handleFilesUploaded}
      onManagedFilePicker={presentationRunEligible ? handlePresentationSourcePicker : undefined}
      modelSelectorNode={modelSelectorNode}
      isGeminiMode={isGeminiMode}
      modelList={modelSelection.modelList}
      current_model={modelSelection.current_model}
      setCurrentModel={setGuidCurrentModel}
      currentAcpCachedModelInfo={agentSelection.currentAcpCachedModelInfo}
      selectedAcpModel={agentSelection.selectedAcpModel}
      setSelectedAcpModel={setGuidSelectedAcpModel}
      thoughtLevelOption={isGeminiMode ? null : agentSelection.currentThoughtLevelOption}
      onThoughtLevelSelect={setGuidSelectedThoughtLevel}
      extraTools={<TemplateGalleryButton onClick={presentationTemplates.toggleGallery} />}
      modeBackend={agentSelection.selectedAssistantBackend}
      selectedMode={agentSelection.selectedMode}
      dynamicModes={agentSelection.currentAgentModeOptions}
      onModeSelect={setGuidSelectedMode}
      allSkills={allSkills}
      disabledBuiltinSkills={guidDisabledBuiltinSkills ?? []}
      enabledSkills={guidEnabledSkills ?? []}
      onToggleSkill={handleToggleSkill}
      mcpServers={availableMcpServers}
      selectedMcpServerIds={guidSelectedMcpServerIds ?? []}
      onToggleMcpServer={handleToggleMcpServer}
      speechInputNode={
        <SpeechInputButton
          disabled={guidInput.loading}
          onLiveTranscript={handleLiveTranscript}
          onTranscript={handleSpeechTranscript}
        />
      }
      loading={guidInput.loading}
      isButtonDisabled={send.isButtonDisabled}
      managedPresentationPending={send.managedPresentationPending}
      onSend={send.sendMessageHandler}
    />
  );
  const slashCommandMenuNode = slashController.isOpen ? (
    <SlashCommandMenu
      title={t('messages.slash.title', { defaultValue: 'Commands' })}
      hint={t('messages.slash.hint', { defaultValue: 'Type / to open command menu' })}
      items={slashMenuItems}
      activeIndex={slashController.activeIndex}
      loading={false}
      onHoverItem={slashController.setActiveIndex}
      onSelectItem={(item) => {
        const targetIndex = slashController.filteredCommands.findIndex((command) => command.name === item.key);
        if (targetIndex >= 0) {
          slashController.onSelectByIndex(targetIndex);
        }
      }}
      emptyText={t('messages.slash.empty', { defaultValue: 'No commands found' })}
    />
  ) : null;

  return (
    <ConfigProvider getPopupContainer={() => guidContainerRef.current || document.body}>
      <div ref={guidContainerRef} className={styles.guidContainer}>
        <div className={styles.guidLayout}>
          {isProjectWelcome ? (
            <div className={styles.projectPill}>
              <Layers theme='outline' size='16' strokeWidth={3} aria-hidden='true' />
              <span>{t('conversation.welcome.projectPill', { name: projectWelcomeName })}</span>
            </div>
          ) : null}

          <div className={styles.heroHeader}>
            <p className='text-2xl font-semibold mb-0 text-0 text-center'>{welcomeTitle}</p>
            {isProjectWelcome ? <p className={styles.projectPath}>{guidInput.dir}</p> : null}
          </div>

          <AssistantSelectionArea
            selectedAssistantId={agentSelection.selectedAssistantId}
            assistants={agentSelection.assistants}
            localeKey={localeKey}
            onSelectAssistant={handleSelectAssistant}
          />

          <GuidInputCard
            focusRequestKey={navState?.focusPrefill && navState.prefillPrompt ? location.key : undefined}
            input={guidInput.input}
            onInputChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onPaste={guidInput.onPaste}
            onFocus={guidInput.handleTextareaFocus}
            onBlur={guidInput.handleTextareaBlur}
            placeholder={typewriterPlaceholder || t('conversation.welcome.placeholder')}
            isInputActive={guidInput.isInputFocused}
            isFileDragging={guidInput.isFileDragging}
            activeBorderColor={activeBorderColor}
            inactiveBorderColor={inactiveBorderColor}
            activeShadow={activeShadow}
            dragHandlers={guidInput.dragHandlers}
            files={guidInput.files}
            onRemoveFile={guidInput.handleRemoveFile}
            presentationSourceDescriptors={presentationRunEligible ? presentationSources.descriptors : []}
            onRevokePresentationSource={presentationRunEligible ? handlePresentationSourceRevoke : undefined}
            onManagedDrop={presentationRunEligible ? handlePresentationSourceDrop : undefined}
            managedPresentationPending={send.managedPresentationPending}
            actionRow={actionRowNode}
            slashCommandMenu={slashCommandMenuNode}
            templateChip={
              presentationTemplates.selectedTemplate ? (
                <div className='flex flex-wrap items-center gap-8px mb-8px'>
                  <TemplateChipCard
                    template={presentationTemplates.selectedTemplate}
                    onRemove={presentationTemplates.clearSelection}
                  />
                </div>
              ) : null
            }
            presentationSourceNotice={presentationSourceNoticeNode}
            workspaceDir={guidInput.dir}
            onSelectWorkspace={(dir) => guidInput.setDir(dir)}
            onClearWorkspace={() => guidInput.setDir('')}
          />

          {presentationTemplates.galleryOpen ? (
            <TemplateGalleryExpanded
              templates={presentationTemplates.templates}
              loading={presentationTemplates.templatesLoading}
              selectedId={presentationTemplates.selectedTemplate?.manifest.id ?? null}
              onSelect={presentationTemplates.selectTemplate}
              onImport={presentationTemplates.importFromDialog}
              onRemove={presentationTemplates.removeTemplate}
              onClose={presentationTemplates.closeGallery}
            />
          ) : selectedAssistantPrompts.length > 0 ? (
            <section className='mt-18px w-full animate-fade-in' aria-label={t('guid.promptExamplesHint')}>
              <div className={`${styles.assistantPromptHint} mb-10px text-left`}>
                {t('guid.promptExamplesHint', { defaultValue: 'Try these example prompts:' })}
              </div>
              <div className='grid grid-cols-2 gap-9px'>
                {selectedAssistantPrompts.map((prompt, index) => (
                  <Button
                    key={`${index}-${prompt}`}
                    type='text'
                    className='!h-auto !min-h-56px !w-full !rounded-8px !border !border-[var(--color-border-2)] !bg-base !px-12px !py-10px !text-left !text-12.5px !text-t-secondary !whitespace-normal !break-words transition-colors hover:!border-aou-6 hover:!text-t-primary'
                    onClick={() => {
                      guidInput.setInput(prompt);
                      guidInput.handleTextareaFocus();
                    }}
                  >
                    <span className='flex items-center gap-9px'>
                      <span className='flex size-28px shrink-0 items-center justify-center rounded-6px bg-fill-2 text-t-secondary'>
                        {[<Lightning />, <Star />, <Paperclip />, <FolderOpen />][index]}
                      </span>
                      <span>{prompt}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </ConfigProvider>
  );
};

export default GuidPage;
