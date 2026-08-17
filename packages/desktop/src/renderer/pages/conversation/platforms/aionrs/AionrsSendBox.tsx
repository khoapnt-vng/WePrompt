/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { parseContextCommand, type ContextCommandInvalidCode } from '@/common/chat/slash/contextCommands';
import { PRESENTATION_RUN_DIRECTIVE_PREFIX, PRESENTATION_RUN_V2_ENABLED } from '@/common/config/constants';
import type { IConversationMcpStatus } from '@/common/config/storage';
import type {
  DispatchInitialPresentationRunResult,
  PresentationGrantOwner,
  PresentationSourceDescriptor,
  PresentationSourceRef,
} from '@/common/types/office/presentationRun';
import type { PresentationCommandQueueItem } from '@/common/types/platform/presentationCommandQueue';
import type {
  ManagedPresentationSubmission,
  PresentationSubmissionProgress,
  PresentationSubmissionProgressObservation,
  PresentationSubmissionSnapshot,
} from '@/common/types/platform/presentationSubmission';
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
import { resolveManagedPresentationInitialSend } from '@/renderer/components/chat/TemplateGallery/usePresentationTemplates';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import FilePreview from '@/renderer/components/media/FilePreview';
import HorizontalFileList from '@/renderer/components/media/HorizontalFileList';
import { classifyConfigSetError, useAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/chat/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';
import { useOpenFileSelector, usePresentationSourceDraft } from '@/renderer/hooks/file/selection';
import { useLocalTokenUsage } from '@/renderer/hooks/useLocalTokenUsage';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import {
  clearActiveContextBudget,
  publishActiveContextBudget,
  resolveConversationContextBudgetSnapshot,
} from '@/renderer/pages/conversation/contextHandoff/contextBudget';
import {
  createPresentationCommandQueueController,
  shouldEnqueueConversationCommand,
  useConversationCommandQueue,
  type PresentationCommandQueueController,
  type ConversationCommandQueueItem,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { getConversationRuntimeWorkspaceErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import { getChatSurfaceWidthClass } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import { ensureConversationRuntime } from '@/renderer/pages/conversation/utils/ensureConversationRuntime';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import { allSupportedExts } from '@/renderer/services/FileService';
import { iconColors } from '@/renderer/styles/colors';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems } from '@/renderer/utils/file/fileSelection';
import { buildDisplayMessage, collectSelectedFiles } from '@/renderer/utils/file/messageFiles';
import { formatCompactModelName } from '@/renderer/utils/model/agentLogo';
import type { AgentModeOption } from '@/renderer/utils/model/agentTypes';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Button, Message, Tag } from '@arco-design/web-react';
import { Brain, MagicHat, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyConversationBusyError } from '../conversationBusyError';
import { useAionrsMessage } from './useAionrsMessage';
import type { AionrsModelSelection } from './useAionrsModelSelection';

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

const contextCommandErrorMessageKey = (code: ContextCommandInvalidCode): string => {
  if (code === 'missing_pin_text') return 'conversation.contextHandoff.command.missingPinText';
  if (code === 'unexpected_arguments') return 'conversation.contextHandoff.command.unexpectedArguments';
  return 'conversation.contextHandoff.command.unsupportedSubcommand';
};

const toModeLabel = (value: string): string =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const modeOptionsFromCapabilities = (modes: string[]): AgentModeOption[] =>
  modes.map((value) => ({ value, label: toModeLabel(value) }));

const useAionrsSendBoxDraft = getSendBoxDraftHook('aionrs', {
  _type: 'aionrs',
  atPath: [],
  content: '',
  uploadFile: [],
});

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];
const initialMessageInFlight = new Map<string, string>();

const toPresentationSourceRefs = (descriptors: readonly PresentationSourceDescriptor[]): PresentationSourceRef[] =>
  descriptors.map((descriptor) => ({
    grantId: descriptor.grantId,
    expectedByteLength: descriptor.byteLength,
    expectedSha256: descriptor.sha256,
  }));

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

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAionrsSendBoxDraft(conversation_id);

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

const AionrsSendBox: React.FC<{
  conversation_id: string;
  modelSelection: AionrsModelSelection;
  modelSelector?: React.ReactNode;
  session_mode?: string;
  agent_name?: string;
  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>;
  teamRuntime?: TeamSendBoxRuntime;
}> = ({ conversation_id, modelSelection, modelSelector, session_mode, agent_name, teamSendMessage, teamRuntime }) => {
  const [workspacePath, setWorkspacePath] = useState('');
  const [dynamicModes, setDynamicModes] = useState<AgentModeOption[]>([]);
  const [currentMode, setCurrentMode] = useState<string | undefined>(session_mode);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
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
  const { t } = useTranslation();
  const { checkAndUpdateTitle } = useAutoTitle();
  const { current_model } = modelSelection;
  const teamPermission = useTeamPermission();
  const propagateMode = teamPermission?.propagateMode;

  const { thought, running, setActiveMsgId, setWaitingResponse, resetState, tokenUsage } = useAionrsMessage(
    conversation_id,
    {
      onConfigChanged: (capabilities) => {
        const modes = (capabilities as { modes?: string[] })?.modes;
        if (modes && modes.length > 0) {
          setDynamicModes(modeOptionsFromCapabilities(modes));
        }
      },
    }
  );
  const localUsage = useLocalTokenUsage();
  const messages = useMessageList();
  const contextBudget = useMemo(
    () =>
      resolveConversationContextBudgetSnapshot({
        conversation: conversationContext?.conversation ?? null,
        messages,
        runtimeTokenUsage: tokenUsage,
        skillNames: loadedSkills,
        toolNames: loadedMcpStatuses.map((status) => status.name),
        model: current_model as { use_model?: string | null; model?: string | null; context_limit?: number } | null,
      }),
    [conversationContext?.conversation, current_model, loadedMcpStatuses, loadedSkills, messages, tokenUsage]
  );
  useLayoutEffect(() => {
    publishActiveContextBudget(conversation_id, contextBudget);
    return () => clearActiveContextBudget(conversation_id, contextBudget);
  }, [contextBudget, conversation_id]);
  const runtimeView = useConversationRuntimeView(conversation_id);
  const { markSendStarted, markSendAccepted, markSendFailed } = runtimeView;

  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent } = useSendBoxDraft(conversation_id);
  const presentationTemplates = usePresentationTemplates(conversation_id);
  const presentationSourceDraft = usePresentationSourceDraft();
  const managedPresentationEligible = getPresentationRunEligibility({
    featureEnabled: PRESENTATION_RUN_V2_ENABLED,
    isDesktop: isElectronDesktop(),
    scope: teamSendMessage ? 'team' : 'individual',
    runtime: 'aionrs',
    templateFormat: presentationTemplates.selectedTemplate?.manifest.format ?? null,
  });
  const managedPresentationPlatformEligible = getPresentationRunEligibility({
    featureEnabled: PRESENTATION_RUN_V2_ENABLED,
    isDesktop: isElectronDesktop(),
    scope: teamSendMessage ? 'team' : 'individual',
    runtime: 'aionrs',
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
  const managedInitialSubmissionRef = useRef<string | null>(null);
  const presentationConversationIdRef = useLatestRef(conversation_id);
  const managedPresentationEligibleRef = useLatestRef(managedPresentationEligible);

  const getManagedPresentationController = useCallback((): PresentationCommandQueueController => {
    const current = managedPresentationControllerRef.current;
    if (current?.conversationId === conversation_id) return current.controller;
    const controller = createPresentationCommandQueueController({ conversationId: conversation_id });
    managedPresentationControllerRef.current = { conversationId: conversation_id, controller };
    return controller;
  }, [conversation_id]);

  useEffect(() => {
    if (!managedPresentationEligible) return;
    void presentationSourceDraft.hydrate({ owner_type: 'conversation', conversation_id });
    return () => presentationSourceDraft.reset();
  }, [conversation_id, managedPresentationEligible, presentationSourceDraft.hydrate, presentationSourceDraft.reset]);

  useEffect(() => {
    setShowPresentationSourceReselect(false);
    setManagedPresentationProgress(null);
    managedPresentationControllerRef.current = null;
  }, [conversation_id]);

  useEffect(() => {
    if (!managedPresentationEligible || !hasLegacyPresentationAttachments) {
      setShowPresentationSourceReselect(false);
    }
  }, [hasLegacyPresentationAttachments, managedPresentationEligible]);

  const handleContentChange = useCallback(
    (val: string) => {
      setContent(val);
    },
    [setContent]
  );

  const [agentWarmed, setAgentWarmed] = useState(false);
  const prepareRuntimeConfig = useCallback(async () => {
    if (teamPermission) return;
  }, [teamPermission]);
  const prepareRuntimeSync = useCallback(async () => {
    if (teamPermission) {
      await teamPermission.warmupSession();
      return;
    }
    await ensureConversationRuntime(conversation_id);
  }, [conversation_id, teamPermission]);
  const runtimeConfig = useAcpConfigOptions({
    conversation_id,
    prepareRuntime: prepareRuntimeConfig,
    prepareSetRuntime: teamPermission?.warmupSession,
    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: Boolean(conversation_id),
  });
  const runtimeMode = runtimeConfig.mode;
  const runtimeThoughtLevel = runtimeConfig.thoughtLevel;

  useEffect(() => {
    if (!runtimeMode?.currentValue) return;
    setCurrentMode(runtimeMode.currentValue);
  }, [runtimeMode?.currentValue]);

  useEffect(() => {
    void getConversationOrNull(conversation_id).then((res) => {
      if (!res?.extra?.workspace) return;
      setWorkspacePath(res.extra.workspace);
    });
  }, [conversation_id]);

  useEffect(() => {
    if (!conversation_id) return;
    setAgentWarmed(false);
    void prepareRuntimeSync()
      .then(() => {
        setAgentWarmed(true);
      })
      .catch((error) => {
        Message.error(getConversationRuntimeWorkspaceErrorMessage(error, t));
      });
  }, [conversation_id, prepareRuntimeSync, t]);

  const slash_commands = useSlashCommands(conversation_id, {
    conversation_type: 'aionrs',
    agentStatus: agentWarmed ? 'active' : null,
    prepareRuntime: teamPermission ? prepareRuntimeSync : undefined,
  });

  const { setSendBoxHandler } = usePreviewContext();
  const commandQueueRuntimeGate = teamRuntime?.runtimeGate ?? {
    hydrated: runtimeView.hydrated,
    canSendMessage: runtimeView.canSendMessage,
    isProcessing: runtimeView.isProcessing,
  };
  const isCancelling = runtimeView.state === 'cancelling';
  const isBusy = isCancelling || commandQueueRuntimeGate.isProcessing || !commandQueueRuntimeGate.canSendMessage;

  const setContentRef = useLatestRef(setContent);
  const contentRef = useLatestRef(content);
  const atPathRef = useLatestRef(atPath);

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
      let lookup;
      try {
        lookup = await ipcBridge.presentationRuns.get.invoke({
          conversation_id,
          client_request_id: item.clientRequestId,
        });
      } catch {
        publishManagedPresentationProgress(item);
        return item;
      }
      if ('code' in lookup) {
        if (lookup.code !== 'RUN_NOT_FOUND') {
          publishManagedPresentationProgress(item);
          return item;
        }
        try {
          const committed = await controller.allocateClaimed(item.queueItemId, (request) =>
            ipcBridge.presentationRuns.start.invoke(request)
          );
          publishManagedPresentationProgress(committed);
          return committed;
        } catch {
          const current = controller.read().items.find(({ queueItemId }) => queueItemId === item.queueItemId) ?? item;
          publishManagedPresentationProgress(current);
          return current;
        }
      }

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
    [conversation_id, publishManagedPresentationProgress]
  );

  const observeManagedPresentation = useCallback(
    async (
      controller: PresentationCommandQueueController,
      item: PresentationCommandQueueItem
    ): Promise<PresentationCommandQueueItem> => {
      publishManagedPresentationProgress(item);
      if (item.execution.state !== 'dispatching' && item.execution.state !== 'dispatch_uncertain') return item;
      let lookup;
      try {
        lookup = await ipcBridge.presentationRuns.get.invoke({
          conversation_id,
          run_id: item.execution.runId,
        });
      } catch {
        return item;
      }
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
    [conversation_id, publishManagedPresentationProgress]
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
      let expectedRevision = item.execution.revision;
      if (verifyMainAuthority) {
        let lookup;
        try {
          lookup = await ipcBridge.presentationRuns.get.invoke({
            conversation_id,
            run_id: item.execution.runId,
          });
        } catch {
          return item;
        }
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
      try {
        claimed = await ipcBridge.presentationRuns.claimInitialDispatch.invoke({
          conversation_id,
          run_id: item.execution.runId,
          holder_id: item.queueItemId,
          expected_revision: expectedRevision,
        });
      } catch {
        return item;
      }
      if ('code' in claimed) return item;

      try {
        const dispatched = await ipcBridge.presentationRuns.dispatch.invoke({
          conversation_id,
          run_id: claimed.runId,
          lease_token: claimed.leaseToken,
          expected_revision: claimed.revision,
        });
        return settleManagedPresentationDispatch(controller, item, dispatched);
      } catch {
        let lookup;
        try {
          lookup = await ipcBridge.presentationRuns.get.invoke({
            conversation_id,
            run_id: item.execution.runId,
          });
        } catch {
          return item;
        }
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
      conversation_id,
      markManagedPresentationUncertain,
      publishManagedPresentationProgress,
      settleManagedPresentationDispatch,
    ]
  );

  const drainManagedPresentationQueue = useCallback(
    async (targetQueueItemId?: string): Promise<PresentationCommandQueueItem | null> => {
      if (!managedPresentationPlatformEligible) return null;
      const controller = getManagedPresentationController();
      if (controller.read().items.length === 0 || managedPresentationDrainRef.current) return null;
      managedPresentationDrainRef.current = true;
      try {
        await controller.recoverPersisting();
        let targetResult: PresentationCommandQueueItem | null = null;
        let latestResult: PresentationCommandQueueItem | null = null;
        const drainNext = async (): Promise<PresentationCommandQueueItem | null> => {
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
            item = await controller.claimHead(item.queueItemId);
            publishManagedPresentationProgress(item);
            try {
              item = await controller.allocateClaimed(item.queueItemId, (request) =>
                ipcBridge.presentationRuns.start.invoke(request)
              );
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
      const controller = getManagedPresentationController();
      const queued = await controller.enqueue({
        queueItemId: snapshot.queueItemId,
        clientRequestId: snapshot.clientRequestId,
        input: snapshot.input,
        selectedTemplateId: snapshot.selectedTemplateId,
        sources: snapshot.sources.map((source) => ({ ...source })),
        sourceOwner,
        expectedOwnerRevision,
      });
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
      sourceOwner.conversation_id !== conversation_id ||
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
        await getManagedPresentationController().removePreflightFailed(snapshot.queueItemId);
        setManagedPresentationProgress(null);
      },
      progress: managedPresentationProgress,
    };
  }, [
    conversation_id,
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

  // Shared file handling logic
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });

  const pickPresentationSources = useCallback(async () => {
    const requestedConversationId = conversation_id;
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
        emitter.emit('aionrs.selected.file.clear');
      }
      setShowPresentationSourceReselect(false);
    }
    return result;
  }, [
    clearFiles,
    conversation_id,
    hasLegacyPresentationAttachments,
    presentationSourceDraft.hydrate,
    presentationSourceDraft.owner,
    presentationSourceDraft.ownerRevision,
    presentationSourceDraft.pickSources,
  ]);

  const grantDroppedPresentationSources = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const requestedConversationId = conversation_id;
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
          emitter.emit('aionrs.selected.file.clear');
        }
        setShowPresentationSourceReselect(false);
      }
    },
    [
      clearFiles,
      conversation_id,
      hasLegacyPresentationAttachments,
      presentationSourceDraft.grantExternalDrop,
      presentationSourceDraft.hydrate,
      presentationSourceDraft.owner,
      presentationSourceDraft.ownerRevision,
    ]
  );

  const executeCommand = useCallback(
    async ({
      input,
      files,
      injectSkills,
      artifactScratchRunId,
    }: Pick<ConversationCommandQueueItem, 'input' | 'files' | 'artifactScratchRunId'> & {
      injectSkills?: string[];
    }) => {
      if (teamPermission) await teamPermission.warmupSession();
      if (!current_model?.use_model) {
        Message.warning(t('conversation.chat.noModelSelected'));
        throw new Error('No model selected');
      }

      const displayMessage = buildDisplayMessage(input, files, workspacePath);
      try {
        void checkAndUpdateTitle(conversation_id, input);
        if (teamSendMessage) {
          await teamSendMessage({ input: displayMessage, files });
          emitter.emit('chat.history.refresh');
          if (files.length > 0) {
            emitter.emit('aionrs.workspace.refresh');
          }
          return;
        }

        markSendStarted();
        setWaitingResponse(true);
        const latestConversation = await getConversationOrNull(conversation_id);
        const res = await ipcBridge.conversation.sendMessage.invoke({
          input: displayMessage,
          conversation_id,
          files,
          pinned_context: getConversationPinnedContext(latestConversation),
          inject_skills: injectSkills && injectSkills.length > 0 ? injectSkills : undefined,
        });
        setActiveMsgId(res.msg_id);
        markSendAccepted(res.turn_id, res.runtime, res.msg_id);
        presentationTemplates.registerScratchTurn(res.turn_id, artifactScratchRunId);
        emitter.emit('chat.history.refresh');
        if (files.length > 0) {
          emitter.emit('aionrs.workspace.refresh');
        }
      } catch (error) {
        void presentationTemplates.retainScratchRun(artifactScratchRunId, 'failed').catch(() => {});
        const errorMessage =
          getConversationRuntimeWorkspaceErrorMessage(error, t) ||
          (error instanceof Error ? error.message : String(error));
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          markSendFailed({
            kind: 'busy_conflict',
            reason: errorMessage,
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
          });
          throw error;
        }

        markSendFailed({ kind: 'ordinary', reason: errorMessage });
        Message.error(errorMessage);
        throw error;
      }
    },
    [
      checkAndUpdateTitle,
      conversation_id,
      current_model?.use_model,
      markSendAccepted,
      markSendFailed,
      markSendStarted,
      setActiveMsgId,
      setWaitingResponse,
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

  // Handle the initial message from the Guid page. Managed presentation handoffs
  // remain eligible for durable queueing before the runtime can execute a turn.
  useEffect(() => {
    if (!conversation_id || !current_model?.use_model) return;

    const storageKey = `aionrs_initial_message_${conversation_id}`;
    const processedKey = `aionrs_initial_processed_${conversation_id}`;

    const processInitialMessage = async () => {
      if (sessionStorage.getItem(processedKey)) return;
      const storedMessage = sessionStorage.getItem(storageKey);
      if (!storedMessage) return;

      if (managedPresentationPlatformEligible) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(storedMessage) as unknown;
        } catch {
          return;
        }
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const candidate = parsed as Record<string, unknown>;
          const input = candidate.input;
          const files = candidate.files;
          if (typeof input === 'string' && input.startsWith(PRESENTATION_RUN_DIRECTIVE_PREFIX)) {
            if (!(files === undefined || (Array.isArray(files) && files.every((file) => typeof file === 'string')))) {
              return;
            }
            if (managedInitialSubmissionRef.current === storageKey) return;
            const managed = resolveManagedPresentationInitialSend(input, (files as string[] | undefined) ?? []);
            if (managed === null) return;
            managedInitialSubmissionRef.current = storageKey;
            const queueItemId = typeof candidate.queueItemId === 'string' ? candidate.queueItemId : crypto.randomUUID();
            const clientRequestId =
              typeof candidate.clientRequestId === 'string' ? candidate.clientRequestId : crypto.randomUUID();
            sessionStorage.setItem(storageKey, JSON.stringify({ ...candidate, queueItemId, clientRequestId }));
            try {
              const sourceState = await presentationSourceDraft.hydrate({
                owner_type: 'conversation',
                conversation_id,
              });
              if (!sourceState.ok) return;
              const sources = toPresentationSourceRefs(sourceState.grants);
              const snapshot: PresentationSubmissionSnapshot = Object.freeze({
                queueItemId,
                clientRequestId,
                input: managed.input,
                selectedTemplateId: managed.selectedTemplateId,
                sources: Object.freeze(sources.map((source) => Object.freeze(source))),
                capturedAt: new Date().toISOString(),
              });
              await enqueueManagedPresentation(
                snapshot,
                sources.length > 0 ? sourceState.owner : null,
                sources.length > 0 ? sourceState.ownerRevision : null,
                false
              );
              sessionStorage.setItem(processedKey, '1');
              sessionStorage.removeItem(storageKey);
              return;
            } finally {
              managedInitialSubmissionRef.current = null;
            }
          }
        }
      }

      if (
        !agentWarmed ||
        !commandQueueRuntimeGate.hydrated ||
        !commandQueueRuntimeGate.canSendMessage ||
        commandQueueRuntimeGate.isProcessing ||
        initialMessageInFlight.has(storageKey)
      ) {
        return;
      }

      initialMessageInFlight.set(storageKey, storedMessage);

      try {
        const { input, files: initialFiles, injectSkills } = JSON.parse(storedMessage);
        await executeCommand({ input, files: initialFiles || [], injectSkills });
        if (sessionStorage.getItem(storageKey) === storedMessage) {
          sessionStorage.setItem(processedKey, '1');
          sessionStorage.removeItem(storageKey);
        }
      } catch (error) {
        console.error('[AionrsSendBox] Failed to send initial message:', error);
      } finally {
        if (initialMessageInFlight.get(storageKey) === storedMessage) {
          initialMessageInFlight.delete(storageKey);
        }
      }
    };

    void processInitialMessage();
  }, [
    agentWarmed,
    commandQueueRuntimeGate.canSendMessage,
    commandQueueRuntimeGate.hydrated,
    commandQueueRuntimeGate.isProcessing,
    conversation_id,
    current_model?.use_model,
    enqueueManagedPresentation,
    executeCommand,
    managedPresentationPlatformEligible,
    presentationSourceDraft.hydrate,
  ]);

  const onSendHandler = async (message: string) => {
    if (managedPresentationEligible && managedPresentationSubmission === undefined) {
      setContent(message);
      if (hasLegacyPresentationAttachments) setShowPresentationSourceReselect(true);
      return;
    }

    const contextCommand = parseContextCommand(message);
    if (contextCommand.kind === 'invalid') {
      Message.error(t(contextCommandErrorMessageKey(contextCommand.code)));
      return;
    }
    if (contextCommand.kind === 'valid') {
      emitter.emit('aionrs.context-command', {
        conversationId: conversation_id,
        command: contextCommand.command,
      });
      return;
    }

    const filesToSend = collectSelectedFiles(uploadFile, atPath);
    clearFiles();
    emitter.emit('aionrs.selected.file.clear');

    const scratch = teamSendMessage ? undefined : await presentationTemplates.prepareScratch(conversation_id);
    const composed = presentationTemplates.composeSend(message, filesToSend, scratch);

    if (
      shouldEnqueueConversationCommand({
        enabled: true,
        isBusy,
        hasPendingCommands,
      })
    ) {
      // Queued sends drop injectSkills — the directive still names the skill,
      // so the agent can pick it up when the queued command is executed.
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
      injectSkills: composed.injectSkills,
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
      emitter.emit('aionrs.selected.file.clear');
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
    dividerBefore: true,
  });

  const handleSheetModeChange = useCallback(
    async (mode: string) => {
      if (!runtimeMode || mode === runtimeMode.currentValue) return;
      try {
        await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        setCurrentMode(mode);
        propagateMode?.(mode);
        Message.success(t('agentMode.switchSuccess'));
      } catch (error) {
        console.error('[AionrsSendBox] Failed to switch mode via sheet:', error);
        Message.error(t(configErrorMessageKey(error)));
      }
    },
    [propagateMode, runtimeConfig, runtimeMode, t]
  );

  const handleSheetModelSelect = useCallback(
    (value: string) => {
      // value format: `${providerId}::${modelName}`
      const [providerId, modelName] = value.split('::');
      const provider = modelSelection.providers.find((p) => p.id === providerId);
      if (!provider || !modelName) return;
      void modelSelection.handleSelectModel(provider, modelName);
    },
    [modelSelection]
  );

  const sheetEntries = useMemo<MobileActionSheetEntry[]>(() => {
    if (!isMobile) return [];

    const availableModes: AgentModeOption[] =
      runtimeMode?.options.map((item) => ({
        value: item.value,
        label: item.label,
        description: item.description ?? undefined,
      })) ??
      (dynamicModes.length > 0
        ? dynamicModes
        : [
            { value: 'default', label: 'Default' },
            { value: 'auto_edit', label: 'Auto-Accept Edits' },
            { value: 'yolo', label: 'YOLO' },
          ]);
    const modeOptions: MobileActionSheetOption[] = availableModes.map((mode) => ({
      key: mode.value,
      label: t(`agentMode.${mode.value}`, { defaultValue: mode.label }),
      description: mode.description,
      active: (runtimeMode?.currentValue ?? currentMode) === mode.value,
    }));

    const modelOptions: MobileActionSheetOption[] = modelSelection.providers.flatMap((provider) =>
      modelSelection.getAvailableModels(provider).map((modelName) => ({
        key: `${provider.id}::${modelName}`,
        label: formatCompactModelName(modelName),
        description: provider.name,
        active:
          modelSelection.current_model?.id === provider.id && modelSelection.current_model?.use_model === modelName,
      }))
    );

    const currentModeLabel =
      modeOptions.find((opt) => opt.active)?.label ?? t('agentMode.default', { defaultValue: 'Default' });
    const currentModelLabel = modelSelection.current_model?.use_model
      ? formatCompactModelName(modelSelection.current_model.use_model)
      : t('conversation.welcome.selectModel');

    const entries: MobileActionSheetEntry[] = [
      {
        key: 'model',
        icon: <Brain theme='outline' size='16' />,
        label: t('common.model', { defaultValue: 'Model' }),
        meta: currentModelLabel,
        submenu: {
          title: t('common.model', { defaultValue: 'Model' }),
          options: modelOptions,
          onSelect: handleSheetModelSelect,
          emptyText: t('conversation.welcome.selectModel'),
        },
      },
      {
        key: 'permission',
        icon: <Shield theme='outline' size='16' />,
        label: t('agentMode.permission', { defaultValue: 'Permission' }),
        meta: currentModeLabel,
        submenu: {
          title: t('agentMode.permission', { defaultValue: 'Permission' }),
          options: modeOptions,
          onSelect: (key) => void handleSheetModeChange(key),
        },
      },
      ...attachEntries,
    ];

    if (runtimeThoughtLevel) {
      entries.splice(1, 0, {
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
            void runtimeConfig
              .setConfigOption(runtimeThoughtLevel.id, value)
              .then(() => Message.success(t('agent.thoughtLevel.switchSuccess')))
              .catch((error) => Message.error(t(configErrorMessageKey(error))));
          },
        },
      });
    }

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
    currentMode,
    dynamicModes,
    handleSheetModeChange,
    handleSheetModelSelect,
    isMobile,
    loadedMcpStatuses,
    loadedSkills,
    modelSelection,
    runtimeConfig,
    runtimeMode,
    runtimeThoughtLevel,
    setContent,
    t,
  ]);

  useAddEventListener('aionrs.selected.file', setAtPath);
  useAddEventListener('aionrs.selected.file.append', (selectedItems: Array<string | FileOrFolderItem>) => {
    const merged = mergeFileSelectionItems(atPathRef.current, selectedItems);
    if (merged !== atPathRef.current) {
      setAtPath(merged as Array<string | FileOrFolderItem>);
    }
  });

  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    // Best-effort cancel: swallow rejections so they don't bubble up as
    // unhandled rejections. UI state is still reset via finally.
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
      console.warn('[AionrsSendBox] stop request failed', error);
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
  const thoughtDisplayRunning = teamRuntime?.loading ?? (runtimeView.hydrated ? runtimeView.isProcessing : running);
  const thoughtDisplayThought = thoughtDisplayRunning ? thought : undefined;
  // Mirrors isConversationAwaitingApproval: a pending confirmation means the run is blocked
  // on the user, not on the model, so the indicator must say so instead of counting time.
  const thoughtDisplayAwaitingApproval =
    runtimeView.hydrated && (runtimeView.state === 'waiting_confirmation' || runtimeView.pendingConfirmations > 0);

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
        thought={thoughtDisplayThought}
        running={thoughtDisplayRunning}
        statusText={teamRuntime?.statusText}
        externalElapsedSource={Boolean(teamRuntime)}
        startedAtMs={teamRuntime?.startedAtMs ?? null}
        awaitingApproval={thoughtDisplayAwaitingApproval}
        onStop={effectiveHandleStop}
      />

      <SendBox
        data-testid='aionrs-sendbox'
        onMobilePlusClick={isMobile ? () => setIsMobileSheetOpen(true) : undefined}
        value={content}
        onChange={handleContentChange}
        selectedWorkspaceItems={atPath}
        onSelectedWorkspaceItemsChange={(items) => {
          emitter.emit('aionrs.selected.file', items);
          setAtPath(items);
        }}
        loading={teamRuntime?.loading ?? isBusy}
        disabled={!current_model?.use_model}
        placeholder={
          current_model?.use_model
            ? t('acp.sendbox.placeholder', {
                backend: agent_name || 'AionCLI',
                defaultValue: `Send message to {{backend}}...`,
              })
            : t('conversation.chat.noModelSelected')
        }
        onStop={effectiveHandleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        onManagedDrop={managedPresentationEligible ? grantDroppedPresentationSources : undefined}
        hasPendingAttachments={
          uploadFile.length > 0 ||
          atPath.length > 0 ||
          (managedPresentationEligible && presentationSourceDraft.descriptors.length > 0)
        }
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
            <AgentModeSelector
              backend='aionrs'
              conversation_id={conversation_id}
              compact
              initialMode={session_mode}
              dynamicModes={dynamicModes}
              compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
              modeLabelFormatter={(mode) =>
                mode.value === 'auto_edit'
                  ? t('agentMode.auto')
                  : mode.value === 'yolo'
                    ? t('agentMode.full-access')
                    : t(`agentMode.${mode.value}`, { defaultValue: mode.label })
              }
              onModeChanged={propagateMode}
              beforeRuntimeSync={prepareRuntimeConfig}
              beforeRuntimeSet={teamPermission?.warmupSession}
              loadConfigOptions={teamPermission?.loadConfigOptions}
            />
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
                    data-testid={`aionrs-presentation-source-${index}`}
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
                    data-testid={`aionrs-file-tag-${uploadFile.indexOf(path)}`}
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
                    const folderIndex = atPath.filter((v) => typeof v !== 'string' && !v.isFile).indexOf(item);
                    return (
                      <Tag
                        key={item.path}
                        data-testid={`aionrs-folder-tag-${folderIndex}`}
                        color='blue'
                        closable
                        onClose={() => {
                          const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                          emitter.emit('aionrs.selected.file', newAtPath);
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
        slash_commands={slash_commands}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        enableContextCommand
        allowSendWhileLoading
        managedPresentationSubmission={managedPresentationSubmission}
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
      />
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

export default AionrsSendBox;
