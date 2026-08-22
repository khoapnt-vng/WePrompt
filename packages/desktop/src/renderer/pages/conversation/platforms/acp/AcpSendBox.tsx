import { ipcBridge } from '@/common';
import { PRESENTATION_RUN_V2_ENABLED } from '@/common/config/constants';
import type { IConversationMcpStatus } from '@/common/config/storage';
import type {
  DispatchInitialPresentationRunResult,
  PresentationGrantOwner,
} from '@/common/types/office/presentationRun';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type { PresentationCommandQueueItem } from '@/common/types/platform/presentationCommandQueue';
import type {
  ManagedPresentationSubmission,
  PresentationSubmissionProgress,
  PresentationSubmissionProgressObservation,
  PresentationSubmissionSnapshot,
} from '@/common/types/platform/presentationSubmission';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { isSideQuestionSupported } from '@/common/chat/sideQuestion';
import { parseError, uuid } from '@/common/utils';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';
import MobileActionSheet, {
  type MobileActionSheetEntry,
  type MobileActionSheetOption,
  useAttachEntry,
} from '@/renderer/components/chat/MobileActionSheet';
import SendBox from '@/renderer/components/chat/SendBox';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import {
  TemplateChipCard,
  TemplateGalleryButton,
  TemplateGalleryPanel,
  usePresentationTemplates,
} from '@/renderer/components/chat/TemplateGallery';
import { getPresentationRunEligibility } from '@/renderer/components/chat/TemplateGallery/usePresentationTemplates';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import FilePreview from '@/renderer/components/media/FilePreview';
import HorizontalFileList from '@/renderer/components/media/HorizontalFileList';
import { classifyConfigSetError, useAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { useAcpModelInfo } from '@/renderer/hooks/agent/useAcpModelInfo';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/chat/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useOpenFileSelector, usePresentationSourceDraft } from '@/renderer/hooks/file/selection';
import { useLocalTokenUsage } from '@/renderer/hooks/useLocalTokenUsage';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { useAddOrUpdateMessage, useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import { resolveConversationContextBudgetSnapshot } from '@/renderer/pages/conversation/contextHandoff/contextBudget';
import {
  createPresentationCommandQueueController,
  shouldEnqueueConversationCommand,
  useConversationCommandQueue,
  type PresentationCommandQueueController,
  type ConversationCommandQueueItem,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { getConversationRuntimeWorkspaceErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import { getChatSurfaceWidthClass } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import { allSupportedExts } from '@/renderer/services/FileService';
import { iconColors } from '@/renderer/styles/colors';
import { formatCompactModelName } from '@/renderer/utils/model/agentLogo';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems } from '@/renderer/utils/file/fileSelection';
import { buildDisplayMessage } from '@/renderer/utils/file/messageFiles';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Button, Message, Tag } from '@arco-design/web-react';
import { Brain, MagicHat, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyConversationBusyError } from '../conversationBusyError';
import { buildSendFailureError } from './buildSendFailureError';
import { useAcpInitialMessage } from './useAcpInitialMessage';
import type { UseAcpMessageReturn } from './useAcpMessage';

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

const useAcpSendBoxDraft = getSendBoxDraftHook('acp', {
  _type: 'acp',
  atPath: [],
  content: '',
  uploadFile: [],
});

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];

const toPresentationSubmissionProgress = (item: PresentationCommandQueueItem): PresentationSubmissionProgress => {
  const { execution } = item;
  if (execution.state === 'queued') return { state: 'queued' };
  if (execution.state === 'committed') {
    return { state: 'committed', runId: execution.runId, revision: execution.revision };
  }
  if (execution.state === 'dispatching') {
    return { state: 'dispatching', runId: execution.runId, revision: execution.revision };
  }
  if (execution.state === 'bound') return { state: 'bound', runId: execution.runId, revision: execution.revision };
  if (execution.state === 'preflight_failed') return { state: 'preflight_failed', code: execution.code };
  if (execution.state === 'dispatch_uncertain') {
    return { state: 'dispatch_uncertain', runId: execution.runId, revision: execution.revision };
  }
  return { state: 'persisting' };
};

const presentationOwnersEqual = (
  left: PresentationGrantOwner | null,
  right: PresentationGrantOwner | null
): boolean => {
  if (left === null || right === null) return left === right;
  if (left.owner_type !== right.owner_type) return false;
  if (left.owner_type === 'draft' && right.owner_type === 'draft') return left.draft_id === right.draft_id;
  if (left.owner_type !== 'conversation' || right.owner_type !== 'conversation') return false;
  const leftConversationId = normalizePresentationConversationId(left.conversation_id);
  return (
    leftConversationId !== null && leftConversationId === normalizePresentationConversationId(right.conversation_id)
  );
};

const isExactManagedPresentationItem = (
  item: PresentationCommandQueueItem,
  snapshot: PresentationSubmissionSnapshot,
  sourceOwner: PresentationGrantOwner | null,
  expectedOwnerRevision: number | null
): boolean =>
  item.queueItemId === snapshot.queueItemId &&
  item.clientRequestId === snapshot.clientRequestId &&
  item.input === snapshot.input &&
  item.selectedTemplateId === snapshot.selectedTemplateId &&
  presentationOwnersEqual(item.sourceOwner, sourceOwner) &&
  item.expectedOwnerRevision === expectedOwnerRevision &&
  item.sources.length === snapshot.sources.length &&
  item.sources.every((source, index) => {
    const expected = snapshot.sources[index];
    return (
      expected !== undefined &&
      source.grantId === expected.grantId &&
      source.expectedByteLength === expected.expectedByteLength &&
      source.expectedSha256 === expected.expectedSha256
    );
  });

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAcpSendBoxDraft(conversation_id);
  const atPath = data?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = data?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = data?.content ?? '';

  const setAtPath = useCallback(
    (nextAtPath: Array<string | FileOrFolderItem>) => {
      mutate((prev) => ({ ...prev, atPath: nextAtPath }));
    },
    [data, mutate]
  );

  const setUploadFile = createSetUploadFile(mutate, data);

  const setContent = useCallback(
    (nextContent: string) => {
      mutate((prev) => ({ ...prev, content: nextContent }));
    },
    [data, mutate]
  );

  return {
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
    content,
    setContent,
  };
};

const AcpSendBox: React.FC<{
  conversation_id: string;
  backend: string;
  session_mode?: string;
  agent_name?: string;
  workspacePath?: string;
  messageState: UseAcpMessageReturn;
  modelSelector?: React.ReactNode;
  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;
  teamRuntime?: TeamSendBoxRuntime;
}> = ({
  conversation_id,
  backend,
  session_mode,
  agent_name,
  workspacePath,
  messageState,
  modelSelector,
  teamSendMessage,
  teamRuntime,
}) => {
  const {
    aiProcessing,
    setAiProcessing,
    resetState,
    tokenUsage,
    context_limit,
    hasThinkingMessage,
    slashCommands,
    fetchSlashCommands,
  } = messageState;
  const localUsage = useLocalTokenUsage();
  const { t } = useTranslation();
  const teamPermission = useTeamPermission();
  // In team mode, all agents show the permission mode selector (members don't propagate)
  const showModeSelector = true;
  const isLeaderInTeam = teamPermission && conversation_id === teamPermission.leaderConversationId;
  const { checkAndUpdateTitle } = useAutoTitle();
  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent } = useSendBoxDraft(conversation_id);
  const presentationConversationId = normalizePresentationConversationId(conversation_id);
  const presentationTemplates = usePresentationTemplates(presentationConversationId ?? undefined);
  const presentationSourceDraft = usePresentationSourceDraft();
  const managedPresentationEligible =
    presentationConversationId !== null &&
    getPresentationRunEligibility({
      featureEnabled: PRESENTATION_RUN_V2_ENABLED,
      isDesktop: isElectronDesktop(),
      scope: teamSendMessage ? 'team' : 'individual',
      runtime: 'acp',
      templateFormat: presentationTemplates.selectedTemplate?.manifest.format ?? null,
    });
  const managedPresentationPlatformEligible =
    presentationConversationId !== null &&
    getPresentationRunEligibility({
      featureEnabled: PRESENTATION_RUN_V2_ENABLED,
      isDesktop: isElectronDesktop(),
      scope: teamSendMessage ? 'team' : 'individual',
      runtime: 'acp',
      templateFormat: 'pptx',
    });
  const hasLegacyPresentationAttachments = uploadFile.length > 0 || atPath.length > 0;
  const [showPresentationSourceReselect, setShowPresentationSourceReselect] = useState(false);
  const [managedPresentationProgress, setManagedPresentationProgress] =
    useState<PresentationSubmissionProgressObservation | null>(null);
  const managedPresentationControllerRef = useRef<{
    conversationId: string;
    controller: PresentationCommandQueueController;
  } | null>(null);
  const managedPresentationDrainRef = useRef(false);
  const presentationConversationIdRef = useLatestRef(presentationConversationId);
  const managedPresentationEligibleRef = useLatestRef(managedPresentationEligible);

  const getManagedPresentationController = useCallback((conversationId: string): PresentationCommandQueueController => {
    if (
      normalizePresentationConversationId(conversationId) !== conversationId ||
      presentationConversationIdRef.current !== conversationId
    ) {
      throw new Error('Invalid managed presentation conversation id');
    }
    const current = managedPresentationControllerRef.current;
    if (current?.conversationId === conversationId) return current.controller;
    const controller = createPresentationCommandQueueController({ conversationId });
    managedPresentationControllerRef.current = { conversationId, controller };
    return controller;
  }, []);

  useEffect(() => {
    if (!managedPresentationEligible || presentationConversationId === null) return;
    void presentationSourceDraft.hydrate({
      owner_type: 'conversation',
      conversation_id: presentationConversationId,
    });
    return () => presentationSourceDraft.reset();
  }, [
    managedPresentationEligible,
    presentationConversationId,
    presentationSourceDraft.hydrate,
    presentationSourceDraft.reset,
  ]);

  useEffect(() => {
    setShowPresentationSourceReselect(false);
    setManagedPresentationProgress(null);
    managedPresentationControllerRef.current = null;
  }, [presentationConversationId]);

  useEffect(() => {
    if (!managedPresentationEligible || !hasLegacyPresentationAttachments) {
      setShowPresentationSourceReselect(false);
    }
  }, [hasLegacyPresentationAttachments, managedPresentationEligible]);
  const layout = useLayoutContext();
  const isMobile = Boolean(layout?.isMobile);
  const conversationContext = useConversationContextSafe();
  const loadedSkills = conversationContext?.loadedSkills ?? [];
  const loadedMcpStatuses =
    conversationContext?.loadedMcpStatuses ??
    (conversationContext?.loadedMcpServers ?? []).map<IConversationMcpStatus>((name) => ({
      id: name,
      name,
      status: 'loaded',
    }));
  const messages = useMessageList();
  const contextBudget = useMemo(
    () =>
      resolveConversationContextBudgetSnapshot({
        conversation: conversationContext?.conversation ?? null,
        messages,
        runtimeTokenUsage: tokenUsage,
        contextLimit: context_limit,
        skillNames: loadedSkills,
        toolNames: loadedMcpStatuses.map((status) => status.name),
      }),
    [context_limit, conversationContext?.conversation, loadedMcpStatuses, loadedSkills, messages, tokenUsage]
  );
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [currentMode, setCurrentMode] = useState<string | undefined>(session_mode);
  const prepareRuntimeConfig = useCallback(async () => {
    if (teamPermission) return;
  }, [teamPermission]);
  const runtimeConfig = useAcpConfigOptions({
    conversation_id,
    prepareRuntime: prepareRuntimeConfig,
    prepareSetRuntime: teamPermission?.warmupSession,
    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: true,
  });
  const runtimeMode = runtimeConfig.mode;
  const runtimeThoughtLevel = runtimeConfig.thoughtLevel;
  const handleThoughtLevelSetOption = useCallback(
    async (optionId: string, value: string) => runtimeConfig.setConfigOption(optionId, value),
    [runtimeConfig]
  );

  // Drive the mobile sheet's model entry off the same source AcpModelSelector uses
  const {
    model_info,
    canSwitch: canSwitchModel,
    selectModel,
  } = useAcpModelInfo({
    conversation_id,
    backend,
    prepareRuntime: prepareRuntimeConfig,
    prepareSetRuntime: teamPermission?.warmupSession,
    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: isMobile,
    onSelectModelSuccess: () => Message.success(t('agent.model.switchSuccess')),
    onSelectModelFailed: (_modelId, error) => Message.error(t(configErrorMessageKey(error))),
  });
  useEffect(() => {
    if (!runtimeMode?.currentValue) return;
    setCurrentMode(runtimeMode.currentValue);
  }, [runtimeMode?.currentValue]);

  const handleSheetModeChange = useCallback(
    async (mode: string) => {
      if (!runtimeMode || mode === runtimeMode.currentValue) return;
      try {
        await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        setCurrentMode(mode);
        if (isLeaderInTeam) teamPermission?.propagateMode?.(mode);
        Message.success(t('agentMode.switchSuccess'));
      } catch (error) {
        console.error('[AcpSendBox] Failed to switch mode via sheet:', error);
        Message.error(t(configErrorMessageKey(error)));
      }
    },
    [isLeaderInTeam, runtimeConfig, runtimeMode, t, teamPermission]
  );

  const handleContentChange = useCallback(
    (val: string) => {
      setContent(val);
    },
    [setContent]
  );
  const { setSendBoxHandler } = usePreviewContext();

  // Use useLatestRef to keep latest setters to avoid re-registering handler
  const setContentRef = useLatestRef(setContent);
  const contentRef = useLatestRef(content);
  const atPathRef = useLatestRef(atPath);

  const addOrUpdateMessage = useAddOrUpdateMessage(); // Move this here so it's available in useEffect
  const addOrUpdateMessageRef = useLatestRef(addOrUpdateMessage);
  const runtimeView = useConversationRuntimeView(conversation_id);
  const { markSendStarted, markSendAccepted, markSendFailed } = runtimeView;

  // Shared file handling logic
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });

  const pickPresentationSources = useCallback(async () => {
    const requestedConversationId = presentationConversationId;
    if (requestedConversationId === null) return null;
    const requestIsCurrent = () =>
      managedPresentationEligibleRef.current && presentationConversationIdRef.current === requestedConversationId;
    const hasCurrentOwner =
      presentationSourceDraft.owner?.owner_type === 'conversation' &&
      presentationSourceDraft.owner.conversation_id === requestedConversationId &&
      presentationSourceDraft.ownerRevision !== null;
    if (!hasCurrentOwner) {
      const hydration = await presentationSourceDraft.hydrate({
        owner_type: 'conversation',
        conversation_id: requestedConversationId,
      });
      if (!hydration.ok || !requestIsCurrent()) return null;
    }
    if (!requestIsCurrent()) return null;

    const result = await presentationSourceDraft.pickSources();
    if (result?.ok && result.status === 'selected' && requestIsCurrent()) {
      if (hasLegacyPresentationAttachments) {
        clearFiles();
        emitter.emit('acp.selected.file.clear');
      }
      setShowPresentationSourceReselect(false);
    }
    return result;
  }, [
    clearFiles,
    presentationConversationId,
    hasLegacyPresentationAttachments,
    presentationSourceDraft.hydrate,
    presentationSourceDraft.owner,
    presentationSourceDraft.ownerRevision,
    presentationSourceDraft.pickSources,
  ]);

  const grantDroppedPresentationSources = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const requestedConversationId = presentationConversationId;
      if (requestedConversationId === null) return;
      const requestIsCurrent = () =>
        managedPresentationEligibleRef.current && presentationConversationIdRef.current === requestedConversationId;
      const hasCurrentOwner =
        presentationSourceDraft.owner?.owner_type === 'conversation' &&
        presentationSourceDraft.owner.conversation_id === requestedConversationId &&
        presentationSourceDraft.ownerRevision !== null;
      if (!hasCurrentOwner) {
        const hydration = await presentationSourceDraft.hydrate({
          owner_type: 'conversation',
          conversation_id: requestedConversationId,
        });
        if (!hydration.ok || !requestIsCurrent()) return;
      }
      if (!requestIsCurrent()) return;

      const result = await presentationSourceDraft.grantExternalDrop(files);
      if (result?.ok && result.status === 'granted' && requestIsCurrent()) {
        if (hasLegacyPresentationAttachments) {
          clearFiles();
          emitter.emit('acp.selected.file.clear');
        }
        setShowPresentationSourceReselect(false);
      }
    },
    [
      clearFiles,
      presentationConversationId,
      hasLegacyPresentationAttachments,
      presentationSourceDraft.grantExternalDrop,
      presentationSourceDraft.hydrate,
      presentationSourceDraft.owner,
      presentationSourceDraft.ownerRevision,
    ]
  );

  const commandQueueRuntimeGate = teamRuntime?.runtimeGate ?? {
    hydrated: runtimeView.hydrated,
    canSendMessage: runtimeView.canSendMessage,
    isProcessing: runtimeView.isProcessing,
  };
  const isCancelling = runtimeView.state === 'cancelling';
  const isBusy = isCancelling || commandQueueRuntimeGate.isProcessing || !commandQueueRuntimeGate.canSendMessage;

  const publishManagedPresentationProgress = useCallback((item: PresentationCommandQueueItem): void => {
    setManagedPresentationProgress({
      queueItemId: item.queueItemId,
      progress: toPresentationSubmissionProgress(item),
    });
  }, []);

  const recoverClaimedManagedPresentation = useCallback(
    async (
      controller: PresentationCommandQueueController,
      item: PresentationCommandQueueItem
    ): Promise<PresentationCommandQueueItem> => {
      if (presentationConversationId === null) return item;
      const requestedConversationId = presentationConversationId;
      const requestIsCurrent = () => presentationConversationIdRef.current === requestedConversationId;
      if (!requestIsCurrent()) return item;
      let lookup;
      try {
        lookup = await ipcBridge.presentationRuns.get.invoke({
          conversation_id: requestedConversationId,
          client_request_id: item.clientRequestId,
        });
      } catch {
        if (requestIsCurrent()) publishManagedPresentationProgress(item);
        return item;
      }
      if (!requestIsCurrent()) return item;
      if ('code' in lookup) {
        if (lookup.code !== 'RUN_NOT_FOUND') {
          publishManagedPresentationProgress(item);
          return item;
        }
        try {
          const committed = await controller.allocateClaimed(item.queueItemId, (request) => {
            if (!requestIsCurrent()) throw new Error('Managed presentation route changed');
            return ipcBridge.presentationRuns.start.invoke(request);
          });
          if (!requestIsCurrent()) return item;
          publishManagedPresentationProgress(committed);
          return committed;
        } catch {
          const current = controller.read().items.find(({ queueItemId }) => queueItemId === item.queueItemId) ?? item;
          publishManagedPresentationProgress(current);
          return current;
        }
      }

      if (!requestIsCurrent()) return item;
      const { run } = lookup;
      let recovered = await controller.transition(item.queueItemId, {
        state: 'committed',
        runId: run.runId,
        revision: run.revision,
        postInvoked: false,
      });
      if (run.dispatchStatus === 'dispatching') {
        recovered = await controller.transition(item.queueItemId, {
          state: 'dispatching',
          runId: run.runId,
          revision: run.revision,
        });
      } else if (run.dispatchStatus === 'bound') {
        recovered = await controller.transition(item.queueItemId, {
          state: 'bound',
          runId: run.runId,
          revision: run.revision,
        });
      } else if (run.dispatchStatus === 'dispatch_uncertain') {
        recovered = await controller.transition(item.queueItemId, {
          state: 'dispatch_uncertain',
          runId: run.runId,
          revision: run.revision,
        });
      } else if (run.dispatchStatus !== 'committed' && run.dispatchStatus !== 'allocating') {
        recovered = await controller.transition(item.queueItemId, {
          state: 'bound',
          runId: run.runId,
          revision: run.revision,
        });
      }
      publishManagedPresentationProgress(recovered);
      return recovered;
    },
    [presentationConversationId, publishManagedPresentationProgress]
  );

  const observeManagedPresentation = useCallback(
    async (
      controller: PresentationCommandQueueController,
      item: PresentationCommandQueueItem
    ): Promise<PresentationCommandQueueItem> => {
      publishManagedPresentationProgress(item);
      if (item.execution.state !== 'dispatching' && item.execution.state !== 'dispatch_uncertain') return item;
      if (presentationConversationId === null) return item;
      const requestedConversationId = presentationConversationId;
      const requestIsCurrent = () => presentationConversationIdRef.current === requestedConversationId;
      if (!requestIsCurrent()) return item;
      let lookup;
      try {
        lookup = await ipcBridge.presentationRuns.get.invoke({
          conversation_id: requestedConversationId,
          run_id: item.execution.runId,
        });
      } catch {
        return item;
      }
      if (!requestIsCurrent()) return item;
      if (item.execution.state === 'dispatch_uncertain') return item;
      if ('code' in lookup) return item;
      if (lookup.run.dispatchStatus === 'dispatch_uncertain') {
        const uncertain = await controller.transition(item.queueItemId, {
          state: 'dispatch_uncertain',
          runId: lookup.run.runId,
          revision: lookup.run.revision,
        });
        publishManagedPresentationProgress(uncertain);
        return uncertain;
      }
      if (
        lookup.run.dispatchStatus === 'allocating' ||
        lookup.run.dispatchStatus === 'committed' ||
        lookup.run.dispatchStatus === 'dispatching'
      ) {
        return item;
      }
      const bound = await controller.transition(item.queueItemId, {
        state: 'bound',
        runId: lookup.run.runId,
        revision: lookup.run.revision,
      });
      publishManagedPresentationProgress(bound);
      await controller.removeBound(item.queueItemId);
      return bound;
    },
    [presentationConversationId, publishManagedPresentationProgress]
  );

  const markManagedPresentationUncertain = useCallback(
    async (
      controller: PresentationCommandQueueController,
      item: PresentationCommandQueueItem,
      runId: string,
      revision: number | null
    ): Promise<PresentationCommandQueueItem> => {
      const uncertain = await controller.transition(item.queueItemId, {
        state: 'dispatch_uncertain',
        runId,
        revision,
      });
      publishManagedPresentationProgress(uncertain);
      return uncertain;
    },
    [publishManagedPresentationProgress]
  );

  const settleManagedPresentationDispatch = useCallback(
    async (
      controller: PresentationCommandQueueController,
      item: PresentationCommandQueueItem,
      dispatched: DispatchInitialPresentationRunResult
    ): Promise<PresentationCommandQueueItem> => {
      if ('code' in dispatched) {
        if (dispatched.code !== 'DISPATCH_UNCERTAIN') return item;
        return markManagedPresentationUncertain(controller, item, dispatched.details.runId, null);
      }
      const bound = await controller.transition(item.queueItemId, {
        state: 'bound',
        runId: dispatched.runId,
        revision: dispatched.revision,
      });
      publishManagedPresentationProgress(bound);
      await controller.removeBound(item.queueItemId);
      return bound;
    },
    [markManagedPresentationUncertain, publishManagedPresentationProgress]
  );

  const dispatchManagedPresentation = useCallback(
    async (
      controller: PresentationCommandQueueController,
      item: PresentationCommandQueueItem,
      verifyMainAuthority: boolean
    ): Promise<PresentationCommandQueueItem> => {
      if (item.execution.state !== 'committed') return item;
      if (presentationConversationId === null) return item;
      const requestedConversationId = presentationConversationId;
      const requestIsCurrent = () => presentationConversationIdRef.current === requestedConversationId;
      if (!requestIsCurrent()) return item;
      let expectedRevision = item.execution.revision;
      if (verifyMainAuthority) {
        let lookup;
        try {
          lookup = await ipcBridge.presentationRuns.get.invoke({
            conversation_id: requestedConversationId,
            run_id: item.execution.runId,
          });
        } catch {
          return item;
        }
        if (!requestIsCurrent()) return item;
        if ('code' in lookup) return item;
        if (lookup.run.dispatchStatus === 'dispatch_uncertain') {
          return markManagedPresentationUncertain(controller, item, lookup.run.runId, lookup.run.revision);
        }
        if (
          lookup.run.dispatchStatus === 'bound' ||
          (lookup.run.dispatchStatus !== 'allocating' &&
            lookup.run.dispatchStatus !== 'committed' &&
            lookup.run.dispatchStatus !== 'dispatching')
        ) {
          const bound = await controller.transition(item.queueItemId, {
            state: 'bound',
            runId: lookup.run.runId,
            revision: lookup.run.revision,
          });
          publishManagedPresentationProgress(bound);
          await controller.removeBound(item.queueItemId);
          return bound;
        }
        if (lookup.run.dispatchStatus !== 'committed') return item;
        expectedRevision = lookup.run.revision;
      }

      let claimed;
      if (!requestIsCurrent()) return item;
      try {
        claimed = await ipcBridge.presentationRuns.claimInitialDispatch.invoke({
          conversation_id: requestedConversationId,
          run_id: item.execution.runId,
          holder_id: item.queueItemId,
          expected_revision: expectedRevision,
        });
      } catch {
        return item;
      }
      if (!requestIsCurrent()) return item;
      if ('code' in claimed) return item;

      try {
        const dispatched = await ipcBridge.presentationRuns.dispatch.invoke({
          conversation_id: requestedConversationId,
          run_id: claimed.runId,
          lease_token: claimed.leaseToken,
          expected_revision: claimed.revision,
        });
        if (!requestIsCurrent()) return item;
        return settleManagedPresentationDispatch(controller, item, dispatched);
      } catch {
        if (!requestIsCurrent()) return item;
        let lookup;
        try {
          lookup = await ipcBridge.presentationRuns.get.invoke({
            conversation_id: requestedConversationId,
            run_id: item.execution.runId,
          });
        } catch {
          return item;
        }
        if (!requestIsCurrent()) return item;
        if ('code' in lookup) return item;
        if (lookup.run.dispatchStatus === 'dispatch_uncertain') {
          return markManagedPresentationUncertain(controller, item, lookup.run.runId, lookup.run.revision);
        }
        if (
          lookup.run.dispatchStatus === 'allocating' ||
          lookup.run.dispatchStatus === 'committed' ||
          lookup.run.dispatchStatus === 'dispatching'
        ) {
          return item;
        }
        const bound = await controller.transition(item.queueItemId, {
          state: 'bound',
          runId: lookup.run.runId,
          revision: lookup.run.revision,
        });
        publishManagedPresentationProgress(bound);
        await controller.removeBound(item.queueItemId);
        return bound;
      }
    },
    [
      presentationConversationId,
      markManagedPresentationUncertain,
      publishManagedPresentationProgress,
      settleManagedPresentationDispatch,
    ]
  );

  const drainManagedPresentationQueue = useCallback(
    async (targetQueueItemId?: string): Promise<PresentationCommandQueueItem | null> => {
      const requestedConversationId = presentationConversationId;
      if (
        !managedPresentationPlatformEligible ||
        requestedConversationId === null ||
        presentationConversationIdRef.current !== requestedConversationId
      ) {
        return null;
      }
      const requestIsCurrent = () => presentationConversationIdRef.current === requestedConversationId;
      const controller = getManagedPresentationController(requestedConversationId);
      if (controller.read().items.length === 0 || managedPresentationDrainRef.current) return null;
      managedPresentationDrainRef.current = true;
      try {
        await controller.recoverPersisting();
        let targetResult: PresentationCommandQueueItem | null = null;
        let latestResult: PresentationCommandQueueItem | null = null;
        const drainNext = async (): Promise<PresentationCommandQueueItem | null> => {
          if (!requestIsCurrent()) return targetResult ?? latestResult;
          let item = controller.read().items[0];
          if (item === undefined) return targetResult ?? latestResult;
          let freshlyCommitted = false;
          if (item.execution.state === 'preflight_failed') {
            publishManagedPresentationProgress(item);
            return targetResult ?? item;
          }
          if (item.execution.state === 'queued') {
            publishManagedPresentationProgress(item);
            if (
              !commandQueueRuntimeGate.hydrated ||
              !commandQueueRuntimeGate.canSendMessage ||
              commandQueueRuntimeGate.isProcessing
            ) {
              return targetResult ?? item;
            }
            if (!requestIsCurrent()) return targetResult ?? item;
            item = await controller.claimHead(item.queueItemId);
            if (!requestIsCurrent()) return targetResult ?? item;
            publishManagedPresentationProgress(item);
            try {
              item = await controller.allocateClaimed(item.queueItemId, (request) => {
                if (!requestIsCurrent()) throw new Error('Managed presentation route changed');
                return ipcBridge.presentationRuns.start.invoke(request);
              });
              if (!requestIsCurrent()) return targetResult ?? item;
              freshlyCommitted = item.execution.state === 'committed';
              publishManagedPresentationProgress(item);
            } catch {
              item = await recoverClaimedManagedPresentation(controller, item);
              freshlyCommitted = item.execution.state === 'committed';
            }
          } else if (item.execution.state === 'claimed') {
            item = await recoverClaimedManagedPresentation(controller, item);
            freshlyCommitted = item.execution.state === 'committed';
          }
          if (item.execution.state === 'committed') {
            if (
              !commandQueueRuntimeGate.hydrated ||
              !commandQueueRuntimeGate.canSendMessage ||
              commandQueueRuntimeGate.isProcessing
            ) {
              return targetResult ?? item;
            }
            item = await dispatchManagedPresentation(controller, item, !freshlyCommitted);
          } else if (item.execution.state === 'bound') {
            publishManagedPresentationProgress(item);
            await controller.removeBound(item.queueItemId);
          } else if (item.execution.state === 'dispatching' || item.execution.state === 'dispatch_uncertain') {
            item = await observeManagedPresentation(controller, item);
          }
          latestResult = item;
          if (item.queueItemId === targetQueueItemId) targetResult = item;
          const itemStillQueued = controller.read().items.some(({ queueItemId }) => queueItemId === item.queueItemId);
          if (itemStillQueued) return targetResult ?? item;
          return drainNext();
        };
        return drainNext();
      } finally {
        managedPresentationDrainRef.current = false;
      }
    },
    [
      commandQueueRuntimeGate.canSendMessage,
      commandQueueRuntimeGate.hydrated,
      commandQueueRuntimeGate.isProcessing,
      dispatchManagedPresentation,
      getManagedPresentationController,
      managedPresentationPlatformEligible,
      observeManagedPresentation,
      presentationConversationId,
      publishManagedPresentationProgress,
      recoverClaimedManagedPresentation,
    ]
  );

  const enqueueManagedPresentation = useCallback(
    async (
      snapshot: PresentationSubmissionSnapshot,
      sourceOwner: PresentationGrantOwner | null,
      expectedOwnerRevision: number | null,
      consumeSelection = true
    ): Promise<PresentationSubmissionProgress> => {
      const requestedConversationId = presentationConversationId;
      if (requestedConversationId === null || presentationConversationIdRef.current !== requestedConversationId) {
        throw new Error('Invalid managed presentation conversation id');
      }
      const requestIsCurrent = () => presentationConversationIdRef.current === requestedConversationId;
      const controller = getManagedPresentationController(requestedConversationId);
      const existing = controller
        .read()
        .items.find(
          (item) => item.queueItemId === snapshot.queueItemId || item.clientRequestId === snapshot.clientRequestId
        );
      let queued: PresentationCommandQueueItem;
      if (existing !== undefined) {
        if (!isExactManagedPresentationItem(existing, snapshot, sourceOwner, expectedOwnerRevision)) {
          throw new Error('Managed presentation queue identity collision');
        }
        queued = existing;
      } else {
        queued = await controller.enqueue({
          queueItemId: snapshot.queueItemId,
          clientRequestId: snapshot.clientRequestId,
          input: snapshot.input,
          selectedTemplateId: snapshot.selectedTemplateId,
          sources: snapshot.sources.map((source) => ({ ...source })),
          sourceOwner,
          expectedOwnerRevision,
        });
      }
      if (!requestIsCurrent()) return toPresentationSubmissionProgress(queued);
      publishManagedPresentationProgress(queued);
      const current = (await drainManagedPresentationQueue(snapshot.queueItemId)) ?? queued;
      const progress = toPresentationSubmissionProgress(current);
      if (
        consumeSelection &&
        (progress.state === 'queued' || progress.state === 'bound' || progress.state === 'dispatch_uncertain')
      ) {
        presentationTemplates.clearSelection();
      }
      return progress;
    },
    [
      drainManagedPresentationQueue,
      getManagedPresentationController,
      presentationConversationId,
      presentationTemplates,
      publishManagedPresentationProgress,
    ]
  );

  useEffect(() => {
    if (!managedPresentationPlatformEligible) return;
    void drainManagedPresentationQueue();
  }, [drainManagedPresentationQueue, managedPresentationPlatformEligible]);

  const managedPresentationSubmission = useMemo<ManagedPresentationSubmission | undefined>(() => {
    const selectedTemplateId = presentationTemplates.selectedTemplate?.manifest.id;
    if (!managedPresentationEligible || hasLegacyPresentationAttachments || selectedTemplateId === undefined) {
      return undefined;
    }
    const sources = presentationSourceDraft.sourceRefs;
    const sourceOwner = presentationSourceDraft.owner;
    const expectedOwnerRevision = presentationSourceDraft.ownerRevision;
    if (
      presentationSourceDraft.pending ||
      sourceOwner?.owner_type !== 'conversation' ||
      sourceOwner.conversation_id !== presentationConversationId ||
      expectedOwnerRevision === null
    ) {
      return undefined;
    }
    return {
      selectedTemplateId,
      sources,
      onSubmit: (snapshot) =>
        enqueueManagedPresentation(
          snapshot,
          sources.length > 0 ? sourceOwner : null,
          sources.length > 0 ? expectedOwnerRevision : null
        ),
      onRestore: async (snapshot) => {
        if (
          presentationConversationId === null ||
          presentationConversationIdRef.current !== presentationConversationId
        ) {
          return;
        }
        await getManagedPresentationController(presentationConversationId).removePreflightFailed(snapshot.queueItemId);
        setManagedPresentationProgress(null);
      },
      progress: managedPresentationProgress,
    };
  }, [
    presentationConversationId,
    enqueueManagedPresentation,
    getManagedPresentationController,
    hasLegacyPresentationAttachments,
    managedPresentationEligible,
    managedPresentationProgress,
    presentationSourceDraft.owner,
    presentationSourceDraft.ownerRevision,
    presentationSourceDraft.pending,
    presentationSourceDraft.sourceRefs,
    presentationTemplates.selectedTemplate?.manifest.id,
  ]);

  // Register handler for adding text from preview panel to sendbox
  useEffect(() => {
    const handler = (text: string) => {
      // If there's existing content, add newline and new text; otherwise just set the text
      const new_content = content ? `${content}\n${text}` : text;
      setContentRef.current(new_content);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  // Listen for sendbox.fill event to append text to sendbox
  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      const prev = contentRef.current;
      setContentRef.current(prev ? `${prev}${text}` : text);
    },
    []
  );

  const hydrateInitialPresentationSources = useCallback(
    () =>
      presentationConversationId === null
        ? Promise.reject(new Error('Invalid managed presentation conversation id'))
        : presentationSourceDraft.hydrate({
            owner_type: 'conversation',
            conversation_id: presentationConversationId,
          }),
    [presentationConversationId, presentationSourceDraft.hydrate]
  );
  const enqueueInitialManagedPresentation = useCallback(
    (
      snapshot: PresentationSubmissionSnapshot,
      sourceOwner: PresentationGrantOwner | null,
      expectedOwnerRevision: number | null
    ) => enqueueManagedPresentation(snapshot, sourceOwner, expectedOwnerRevision, false),
    [enqueueManagedPresentation]
  );

  // Check for and send initial message from guid page
  useAcpInitialMessage({
    conversation_id: conversation_id,
    backend,
    workspacePath,
    setAiProcessing,
    resetState,
    markSendStarted,
    markSendAccepted,
    markSendFailed,
    checkAndUpdateTitle,
    addOrUpdateMessage: addOrUpdateMessageRef.current,
    managedPresentationEnabled: managedPresentationPlatformEligible,
    hydratePresentationSources: hydrateInitialPresentationSources,
    enqueueManagedPresentation: enqueueInitialManagedPresentation,
  });

  const executeCommand = useCallback(
    async ({
      input,
      files,
      artifactScratchRunId,
    }: Pick<ConversationCommandQueueItem, 'input' | 'files' | 'artifactScratchRunId'>) => {
      const displayMessage = buildDisplayMessage(input, files, workspacePath || '');

      try {
        if (teamPermission) await teamPermission.warmupSession();
        void checkAndUpdateTitle(conversation_id, input);
        if (teamSendMessage) {
          await teamSendMessage({ input: displayMessage, files });
          emitter.emit('chat.history.refresh');
          if (files.length > 0) {
            emitter.emit('acp.workspace.refresh');
          }
          return;
        }

        markSendStarted();
        setAiProcessing(true);
        const result = await ipcBridge.acpConversation.sendMessage.invoke({
          input: displayMessage,
          conversation_id,
          files,
        });
        markSendAccepted(result.turn_id, result.runtime, result.msg_id);
        presentationTemplates.registerScratchTurn(result.turn_id, artifactScratchRunId);
        emitter.emit('chat.history.refresh');
      } catch (error: unknown) {
        void presentationTemplates.retainScratchRun(artifactScratchRunId, 'failed').catch(() => {});
        const errorMsg =
          getConversationRuntimeWorkspaceErrorMessage(error, t) || parseError(error) || t('common.unknownError');
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          markSendFailed({
            kind: 'busy_conflict',
            reason: errorMsg,
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
          });
          throw error;
        }

        markSendFailed({ kind: 'ordinary', reason: errorMsg });

        // Archived conversation (e.g. legacy Gemini). Backend signals this
        // via HTTP 410 + code='CONVERSATION_ARCHIVED' — identified by code,
        // not by substring matching.
        if (isBackendHttpError(error) && error.code === 'CONVERSATION_ARCHIVED') {
          Message.error({
            content: error.backendMessage || errorMsg,
            duration: 6000,
          });
          setAiProcessing(false);
          throw error;
        }

        const isAuthError =
          errorMsg.includes('[ACP-AUTH-') ||
          errorMsg.includes('authentication failed') ||
          errorMsg.includes('认证失败');
        if (isAuthError) {
          const errorMessage = {
            id: uuid(),
            msg_id: uuid(),
            turn_id: '',
            conversation_id,
            type: 'error',
            data: t('acp.auth.failed', {
              backend,
              error: errorMsg,
              defaultValue: `${backend} authentication failed:

{{error}}

Please check your local CLI tool authentication status`,
            }),
          };

          ipcBridge.acpConversation.responseStream.emit(errorMessage);
        } else {
          addOrUpdateMessageRef.current(
            {
              id: uuid(),
              msg_id: uuid(),
              type: 'tips',
              position: 'center',
              conversation_id,
              created_at: Date.now(),
              content: {
                content: errorMsg,
                type: 'error',
                error: buildSendFailureError(error, errorMsg),
              },
            },
            true
          );
        }

        resetState();
        setAiProcessing(false);
        throw error;
      }

      if (files.length > 0) {
        emitter.emit('acp.workspace.refresh');
      }
    },
    [
      backend,
      checkAndUpdateTitle,
      conversation_id,
      markSendAccepted,
      markSendFailed,
      markSendStarted,
      resetState,
      setAiProcessing,
      t,
      teamPermission,
      teamSendMessage,
      presentationTemplates,
      workspacePath,
    ]
  );

  const {
    items: queuedCommands,
    mode: queueMode,
    isInteractionLocked: isQueueInteractionLocked,
    hasPendingCommands,
    enqueue,
    remove,
    prioritize,
    sendNow,
    clear,
    reorder,
    toggleMode,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  } = useConversationCommandQueue({
    conversation_id: conversation_id,
    enabled: true,
    isBusy,
    runtimeGate: commandQueueRuntimeGate,
    onExecute: executeCommand,
  });

  const onSendHandler = async (message: string) => {
    if (managedPresentationEligible && managedPresentationSubmission === undefined) {
      setContent(message);
      if (hasLegacyPresentationAttachments) setShowPresentationSourceReselect(true);
      return;
    }

    const atPathFiles = atPath.map((item) => (typeof item === 'string' ? item : item.path));
    const allFiles = [...uploadFile, ...atPathFiles];

    clearFiles();
    emitter.emit('acp.selected.file.clear');

    // This is the legacy ACP path, which ignores `injectSkills`. Managed
    // presentation dispatch never enters it; its directive requires OfficeCLI.
    const scratch =
      teamSendMessage || presentationConversationId === null
        ? undefined
        : await presentationTemplates.prepareScratch(presentationConversationId);
    const composed = presentationTemplates.composeSend(message, allFiles, scratch);

    if (
      shouldEnqueueConversationCommand({
        enabled: true,
        isBusy,
        hasPendingCommands,
      })
    ) {
      enqueue({
        input: composed.input,
        files: composed.files,
        artifactScratchRunId: composed.artifactScratchRunId,
      });
      presentationTemplates.clearSelection();
      return;
    }

    await executeCommand({
      input: composed.input,
      files: composed.files,
      artifactScratchRunId: composed.artifactScratchRunId,
    });
    presentationTemplates.clearSelection();
  };

  const handleEditQueuedCommand = useCallback(
    (item: ConversationCommandQueueItem) => {
      remove(item.id);
      if (item.artifactScratchRunId) {
        void presentationTemplates.discardScratch(item.artifactScratchRunId);
      }
      setContent(item.input);
      setUploadFile(Array.from(new Set(item.files)));
      setAtPath([]);
      emitter.emit('acp.selected.file.clear');
    },
    [presentationTemplates, remove, setAtPath, setContent, setUploadFile]
  );

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      setUploadFile((prev) => [...prev, ...files]);
    },
    [setUploadFile]
  );
  const { openFileSelector: openLegacyFileSelector, onSlashBuiltinCommand: onLegacySlashBuiltinCommand } =
    useOpenFileSelector({
      onFilesSelected: appendSelectedFiles,
    });
  const openFileSelector = useCallback(() => {
    if (managedPresentationEligible) {
      void pickPresentationSources();
      return;
    }
    openLegacyFileSelector();
  }, [managedPresentationEligible, openLegacyFileSelector, pickPresentationSources]);
  const onSlashBuiltinCommand = useCallback(
    (name: string) => {
      if (managedPresentationEligible && name === 'open') {
        void pickPresentationSources();
        return;
      }
      onLegacySlashBuiltinCommand(name);
    },
    [managedPresentationEligible, onLegacySlashBuiltinCommand, pickPresentationSources]
  );

  const { entries: attachEntries, hiddenFileInput: attachHiddenInput } = useAttachEntry({
    openFileSelector,
    onLocalFilesAdded: handleFilesAdded,
  });

  const sheetEntries = useMemo<MobileActionSheetEntry[]>(() => {
    if (!isMobile) return [];

    const availableModes =
      runtimeMode?.options.map((item) => ({
        value: item.value,
        label: item.label,
        description: item.description ?? undefined,
      })) ?? [];
    const modeOptions: MobileActionSheetOption[] = availableModes.map((mode) => ({
      key: mode.value,
      label: t(`agentMode.${mode.value}`, { defaultValue: mode.label }),
      description: mode.description,
      active: (runtimeMode?.currentValue ?? currentMode) === mode.value,
    }));

    const modelOptions: MobileActionSheetOption[] = canSwitchModel
      ? (model_info?.available_models ?? []).map((model) => ({
          key: model.id,
          label: formatCompactModelName(model.label || model.id),
          description: model.description,
          active: model_info?.current_model_id === model.id,
        }))
      : [];

    const currentModelLabel =
      model_info?.current_model_label || model_info?.current_model_id
        ? formatCompactModelName(model_info?.current_model_label || model_info?.current_model_id || '')
        : t('conversation.welcome.useCliModel');
    const currentModeLabel =
      modeOptions.find((opt) => opt.active)?.label ?? t('agentMode.default', { defaultValue: 'Default' });

    const entries: MobileActionSheetEntry[] = [];

    // Model entry: only when the agent exposes a switchable list. Otherwise
    // (Codex with no list, no info) skip — exposing a no-op row would be noise.
    if (modelOptions.length > 0) {
      entries.push({
        key: 'model',
        icon: <Brain theme='outline' size='16' />,
        label: t('common.model', { defaultValue: 'Model' }),
        meta: currentModelLabel,
        submenu: {
          title: t('common.model', { defaultValue: 'Model' }),
          options: modelOptions,
          onSelect: (id) => selectModel(id),
        },
      });
    }

    if (runtimeThoughtLevel) {
      entries.push({
        key: 'thought-level',
        icon: <Brain theme='outline' size='16' />,
        label: t('agent.thoughtLevel.label'),
        meta:
          runtimeThoughtLevel.options.find((item) => item.value === runtimeThoughtLevel.currentValue)?.label ||
          runtimeThoughtLevel.currentValue ||
          '',
        submenu: {
          title: t('agent.thoughtLevel.label'),
          options: runtimeThoughtLevel.options.map((item) => ({
            key: item.value,
            label: item.label,
            description: item.description ?? undefined,
            active: runtimeThoughtLevel.currentValue === item.value,
          })),
          onSelect: (value) => {
            void handleThoughtLevelSetOption(runtimeThoughtLevel.id, value)
              .then(() => Message.success(t('agent.thoughtLevel.switchSuccess')))
              .catch((error) => Message.error(t(configErrorMessageKey(error))));
          },
        },
      });
    }

    if (modeOptions.length > 0) {
      entries.push({
        key: 'permission',
        icon: <Shield theme='outline' size='16' />,
        label: t('agentMode.permission', { defaultValue: 'Permission' }),
        meta: currentModeLabel,
        submenu: {
          title: t('agentMode.permission', { defaultValue: 'Permission' }),
          options: modeOptions,
          onSelect: (key) => void handleSheetModeChange(key),
        },
      });
    }

    attachEntries.forEach((entry, idx) => {
      entries.push({
        ...entry,
        dividerBefore: idx === 0 ? entries.length > 0 : false,
      });
    });

    if (loadedSkills.length > 0) {
      const skillOptions: MobileActionSheetOption[] = loadedSkills.map((name) => ({
        key: name,
        label: `/${name}`,
      }));
      entries.push({
        key: 'skills',
        icon: <MagicHat theme='outline' size='16' />,
        label: t('common.selectedSkills', { defaultValue: 'Selected skills' }),
        variant: 'muted',
        submenu: {
          title: t('common.selectedSkills', { defaultValue: 'Selected skills' }),
          selectable: false,
          options: skillOptions,
          onSelect: (name) => {
            setContent(`/${name} `);
          },
        },
      });
    }

    if (loadedMcpStatuses.length > 0) {
      const mcpOptions: MobileActionSheetOption[] = loadedMcpStatuses.map((item) => ({
        key: item.id,
        label: item.name,
        description:
          item.status === 'loaded'
            ? undefined
            : item.reason
              ? `${t(`conversation.mcp.status.${item.status}` as const)} · ${item.reason}`
              : t(`conversation.mcp.status.${item.status}` as const),
      }));
      entries.push({
        key: 'mcp',
        icon: <Shield theme='outline' size='16' />,
        label: t('conversation.mcp.selected', { defaultValue: 'Selected MCP' }),
        variant: 'muted',
        submenu: {
          title: t('conversation.mcp.selected', { defaultValue: 'Selected MCP' }),
          selectable: false,
          options: mcpOptions,
          onSelect: () => undefined,
        },
      });
    }

    return entries;
  }, [
    attachEntries,
    canSwitchModel,
    currentMode,
    handleSheetModeChange,
    handleThoughtLevelSetOption,
    isMobile,
    loadedMcpStatuses,
    loadedSkills,
    model_info,
    runtimeMode,
    runtimeThoughtLevel,
    selectModel,
    setContent,
    t,
  ]);

  useAddEventListener('acp.selected.file', setAtPath);
  useAddEventListener('acp.selected.file.append', (selectedItems: Array<string | FileOrFolderItem>) => {
    const merged = mergeFileSelectionItems(atPathRef.current, selectedItems);
    if (merged !== atPathRef.current) {
      setAtPath(merged as Array<string | FileOrFolderItem>);
    }
  });

  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    // Cancelling is best-effort: swallow errors (e.g. backend WS not yet
    // connected → 409) so they don't bubble up as unhandled rejections.
    // UI state is still reset via finally.
    const turnId = runtimeView.activeTurnId;
    if (!turnId) {
      resetState();
      resetActiveExecution('stop');
      return;
    }
    void presentationTemplates.interruptScratchTurn(turnId).catch(() => {});
    runtimeView.markStopRequested(turnId);
    try {
      const result = await ipcBridge.conversation.stop.invoke({ conversation_id, turn_id: turnId });
      runtimeView.markStopAcknowledged(turnId, result.runtime);
    } catch (error) {
      console.warn('[AcpSendBox] stop request failed', error);
      runtimeView.resetLocalGate('stop_failed');
    } finally {
      resetState();
      resetActiveExecution('stop');
    }
  };
  const effectiveHandleStop = teamRuntime?.onStop ?? handleStop;
  const handleSendNowQueued = useCallback(
    async (item: ConversationCommandQueueItem) => {
      // Stop the current reply (best-effort), then promote the chosen command
      // to the front of the queue in auto mode.  The drain effect will fire it
      // once the execution gate shows canExecute — avoiding the 409 race that
      // occurs when sendNow() calls onExecute() directly before the backend
      // has finished processing the stop.
      await effectiveHandleStop();
      prioritize(item.id);
    },
    [effectiveHandleStop, prioritize]
  );
  const sendBoxWidthClass = getChatSurfaceWidthClass(Boolean(teamPermission));

  return (
    <div className={`${sendBoxWidthClass} flex flex-col mt-auto mb-16px`}>
      <CommandQueuePanel
        items={queuedCommands}
        mode={queueMode}
        isMobile={isMobile}
        interactionLocked={isQueueInteractionLocked}
        onInteractionLock={lockInteraction}
        onInteractionUnlock={unlockInteraction}
        onEdit={handleEditQueuedCommand}
        onSendNow={handleSendNowQueued}
        onToggleMode={toggleMode}
        onReorder={reorder}
        onRemove={(commandId) => {
          const item = queuedCommands.find((command) => command.id === commandId);
          remove(commandId);
          if (item?.artifactScratchRunId) void presentationTemplates.discardScratch(item.artifactScratchRunId);
        }}
        onClear={() => {
          for (const item of queuedCommands) {
            if (item.artifactScratchRunId) void presentationTemplates.discardScratch(item.artifactScratchRunId);
          }
          clear();
        }}
      />
      <ThoughtDisplay
        running={teamRuntime?.loading ?? (aiProcessing && !hasThinkingMessage)}
        statusText={teamRuntime?.statusText}
        externalElapsedSource={Boolean(teamRuntime)}
        startedAtMs={teamRuntime?.startedAtMs ?? null}
        onStop={effectiveHandleStop}
      />

      <SendBox
        onMobilePlusClick={isMobile ? () => setIsMobileSheetOpen(true) : undefined}
        value={content}
        onChange={handleContentChange}
        selectedWorkspaceItems={atPath}
        onSelectedWorkspaceItemsChange={(items) => {
          emitter.emit('acp.selected.file', items);
          setAtPath(items);
        }}
        loading={teamRuntime?.loading ?? isBusy}
        disabled={false}
        placeholder={t('acp.sendbox.placeholder', {
          backend: agent_name || backend,
          defaultValue: `Send message to {{backend}}...`,
        })}
        onStop={effectiveHandleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        onManagedDrop={managedPresentationEligible ? grantDroppedPresentationSources : undefined}
        hasPendingAttachments={
          uploadFile.length > 0 ||
          atPath.length > 0 ||
          (managedPresentationEligible && presentationSourceDraft.descriptors.length > 0)
        }
        enableBtw={isSideQuestionSupported({ type: 'acp', backend })}
        supportedExts={allSupportedExts}
        defaultMultiLine={!isMobile}
        lockMultiLine={!isMobile}
        tools={
          <>
            <FileAttachButton
              openFileSelector={openFileSelector}
              onLocalFilesAdded={handleFilesAdded}
              loadedMcpStatuses={loadedMcpStatuses}
            />
            <TemplateGalleryButton onClick={presentationTemplates.toggleGallery} />
          </>
        }
        rightTools={
          <div className='flex items-center gap-8px min-w-0'>
            {modelSelector}
            {showModeSelector && (
              <AgentModeSelector
                backend={backend}
                conversation_id={conversation_id}
                compact
                initialMode={session_mode}
                compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                modeLabelFormatter={(mode) =>
                  mode.value === 'auto_edit'
                    ? t('agentMode.auto')
                    : mode.value === 'yolo'
                      ? t('agentMode.full-access')
                      : t(`agentMode.${mode.value}`, { defaultValue: mode.label })
                }
                onModeChanged={isLeaderInTeam ? teamPermission?.propagateMode : undefined}
                beforeRuntimeSync={prepareRuntimeConfig}
                beforeRuntimeSet={teamPermission?.warmupSession}
                loadConfigOptions={teamPermission?.loadConfigOptions}
              />
            )}
            <ContextUsageIndicator budget={contextBudget} localUsage={localUsage} />
          </div>
        }
        prefix={
          <>
            {presentationTemplates.selectedTemplate && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                <TemplateChipCard
                  template={presentationTemplates.selectedTemplate}
                  onRemove={presentationTemplates.clearSelection}
                />
              </div>
            )}
            {showPresentationSourceReselect && managedPresentationEligible && hasLegacyPresentationAttachments && (
              <div
                className='mb-8px flex items-center justify-between gap-8px rounded-8px border border-warning-3 bg-warning-1 px-10px py-8px text-12px text-warning-7'
                role='alert'
              >
                <span>{t('conversation.presentationTemplates.sources.reselectRequired')}</span>
                <Button
                  type='text'
                  size='mini'
                  loading={presentationSourceDraft.pending}
                  onClick={() => void pickPresentationSources()}
                >
                  {t('conversation.presentationTemplates.sources.reselectAction')}
                </Button>
              </div>
            )}
            {managedPresentationEligible && presentationSourceDraft.descriptors.length > 0 && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                {presentationSourceDraft.descriptors.map((source, index) => (
                  <Tag
                    key={source.grantId}
                    data-testid={`acp-presentation-source-${index}`}
                    closable
                    onClose={() => void presentationSourceDraft.revoke(source.grantId)}
                  >
                    {source.displayName}
                  </Tag>
                ))}
              </div>
            )}
            {uploadFile.length > 0 && (
              <HorizontalFileList>
                {uploadFile.map((path) => (
                  <FilePreview
                    key={path}
                    path={path}
                    onRemove={() => setUploadFile(uploadFile.filter((v) => v !== path))}
                  />
                ))}
              </HorizontalFileList>
            )}
            {atPath.some((item) => (typeof item === 'string' ? false : !item.isFile)) && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                {atPath.map((item) => {
                  if (typeof item === 'string') return null;
                  if (!item.isFile) {
                    return (
                      <Tag
                        key={item.path}
                        color='blue'
                        closable
                        onClose={() => {
                          const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                          emitter.emit('acp.selected.file', newAtPath);
                          setAtPath(newAtPath);
                        }}
                      >
                        {item.name}
                      </Tag>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </>
        }
        onSend={onSendHandler}
        managedPresentationSubmission={managedPresentationSubmission}
        slash_commands={slashCommands}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        allowSendWhileLoading
        compactActions={false}
        onOpenTemplateGallery={presentationTemplates.openGallery}
        templateGalleryNode={
          presentationTemplates.galleryOpen ? (
            <TemplateGalleryPanel
              templates={presentationTemplates.templates}
              selectedId={presentationTemplates.selectedTemplate?.manifest.id ?? null}
              loading={presentationTemplates.templatesLoading}
              onSelect={presentationTemplates.selectTemplate}
              onImport={presentationTemplates.importFromDialog}
              onRemove={presentationTemplates.removeTemplate}
              onClose={presentationTemplates.closeGallery}
            />
          ) : null
        }
      ></SendBox>
      {isMobile && (
        <>
          <MobileActionSheet
            open={isMobileSheetOpen}
            onClose={() => setIsMobileSheetOpen(false)}
            title={t('common.more', { defaultValue: 'More' })}
            entries={sheetEntries}
          />
          {attachHiddenInput}
        </>
      )}
    </div>
  );
};

export default AcpSendBox;
