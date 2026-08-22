/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Button, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  ArtifactScratchAllocation,
  PresentationTemplateFormat,
  PresentationTemplateSummary,
} from '@/common/types/office/presentationTemplate';
import type { PresentationRunPublicDto } from '@/common/types/office/presentationRun';
import { composeAssistantSend } from './directive';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { parseTemplatedSend } from '@/renderer/utils/chat/templatedSendParser';
import { PRESENTATION_RUN_DIRECTIVE_PREFIX } from '@/common/config/constants';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';

export type PresentationRunEligibilityInput = {
  featureEnabled: boolean;
  isDesktop: boolean;
  scope: 'individual' | 'team' | 'unknown';
  runtime: string | null;
  templateFormat: PresentationTemplateFormat | null;
};

export type ManagedPresentationInitialSend = {
  input: string;
  selectedTemplateId: string;
  injectSkills?: ['officecli'];
};

/**
 * Recovers the raw prompt from the legacy Guid handoff without returning any
 * template or user paths. A raw user attachment makes the handoff ineligible
 * for managed dispatch. AionRS keeps the legacy `injectSkills` handoff
 * metadata; ACP relies on the directive's explicit OfficeCLI loading rule and
 * does not consume that metadata.
 */
export function resolveManagedPresentationInitialSend(
  input: string,
  files: string[],
  runtime: 'aionrs' | 'acp' = 'aionrs'
): ManagedPresentationInitialSend | null {
  if (!input.startsWith(PRESENTATION_RUN_DIRECTIVE_PREFIX)) return null;
  const parsed = parseTemplatedSend(input, files);
  if (parsed === null || parsed.userFiles.length > 0) return null;
  const resolved: ManagedPresentationInitialSend = {
    input: parsed.userText,
    selectedTemplateId: parsed.templateId,
  };
  if (runtime === 'aionrs') resolved.injectSkills = ['officecli'];
  return resolved;
}

/**
 * Renderer-only UX hint for the managed presentation path.
 *
 * Main remains authoritative for feature enablement, runtime, ownership, and
 * source grants. Keep this helper path-free so its result cannot be mistaken
 * for authority to start a run.
 */
export function getPresentationRunEligibility(input: PresentationRunEligibilityInput): boolean {
  return (
    input.featureEnabled &&
    input.isDesktop &&
    input.scope === 'individual' &&
    (input.runtime === 'aionrs' || input.runtime === 'acp') &&
    input.templateFormat === 'pptx'
  );
}

/**
 * Display name + description for a template.
 *
 * Built-in packs carry English strings in their manifest (the canonical source
 * lives in process/resources/presentation-templates), so the catalog under
 * `conversation.presentationTemplates.catalog.<id>` supplies the localized
 * copy. User-imported templates are the user's own content and cannot be
 * pre-translated, so they always fall back to the manifest — as does any
 * built-in whose id is missing from the catalog.
 *
 * Lives here rather than in its own module because this directory already sits
 * at the 10-child limit from the architecture guide.
 */
export function useTemplateLabels() {
  const { t } = useTranslation();
  return useCallback(
    (template: PresentationTemplateSummary) => {
      const { id, name, description, source } = template.manifest;
      if (source !== 'builtin') return { name, description };
      const key = `conversation.presentationTemplates.catalog.${id}`;
      return {
        name: t(`${key}.name`, { defaultValue: name }),
        description: t(`${key}.description`, { defaultValue: description }),
      };
    },
    [t]
  );
}

/**
 * Owns all state for the presentation template gallery: the fetched template
 * list (via SWR), gallery open/close, the currently selected template, and
 * the import/remove actions. Consumed by the SendBox area to render the
 * toolbar button + gallery panel and to compose outgoing messages.
 */
export function usePresentationTemplates(conversationId?: string) {
  const { t } = useTranslation();
  const presentationConversationId = normalizePresentationConversationId(conversationId);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PresentationTemplateSummary | null>(null);
  const [recoverableRuns, setRecoverableRuns] = useState<PresentationRunPublicDto[]>([]);
  const scratchRunByTurnRef = useRef(new Map<string, string>());
  const recoveryMessageCloseByIdRef = useRef(new Map<string, () => void>());
  const recoveryRequestRef = useRef(0);
  const recoveryLifecycleEpochRef = useRef(0);
  const currentConversationIdRef = useRef(presentationConversationId);
  const recoveryConversationIdRef = useRef(presentationConversationId);
  const recoveryTranslationRef = useRef(t);
  currentConversationIdRef.current = presentationConversationId;
  recoveryTranslationRef.current = t;

  const {
    data: templates,
    isLoading,
    mutate,
  } = useSWR('presentation-templates', () => ipcBridge.presentationTemplates.list.invoke());

  const openGallery = useCallback(() => setGalleryOpen(true), []);
  const closeGallery = useCallback(() => setGalleryOpen(false), []);
  const toggleGallery = useCallback(() => setGalleryOpen((open) => !open), []);

  const selectTemplate = useCallback((template: PresentationTemplateSummary) => {
    setSelectedTemplate(template);
    setGalleryOpen(false);
  }, []);

  const clearSelection = useCallback(() => setSelectedTemplate(null), []);

  const importFromDialog = useCallback(async () => {
    try {
      const paths = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile'],
        filters: [{ name: 'Theme spec', extensions: ['md'] }],
      });
      const filePath = paths?.[0];
      if (!filePath) return;
      const result = await ipcBridge.presentationTemplates.importSpec.invoke({ file_path: filePath });
      if (result.ok) {
        Message.success(t('conversation.presentationTemplates.importSuccess'));
        await mutate();
      } else if ('error' in result) {
        // `else if` (rather than plain `else`) so the discriminated union narrows
        // correctly under this project's tsconfig, which does not set
        // strictNullChecks — negating a boolean-literal discriminant alone does
        // not narrow the other branch without it.
        Message.error(t('conversation.presentationTemplates.importError', { error: result.error }));
      }
    } catch (error) {
      Message.error(t('conversation.presentationTemplates.importError', { error: String(error) }));
    }
  }, [mutate, t]);

  const removeTemplate = useCallback(
    async (id: string) => {
      try {
        await ipcBridge.presentationTemplates.remove.invoke({ id });
        setSelectedTemplate((current) => (current?.manifest.id === id ? null : current));
        await mutate();
      } catch (error) {
        Message.error(t('conversation.presentationTemplates.removeError', { error: String(error) }));
      }
    },
    [mutate, t]
  );

  const prepareScratch = useCallback(
    async (targetConversationId: string): Promise<ArtifactScratchAllocation | undefined> => {
      const canonicalTargetConversationId = normalizePresentationConversationId(targetConversationId);
      if (!selectedTemplate?.referencePath || !['pptx', 'docx'].includes(selectedTemplate.manifest.format)) {
        return undefined;
      }
      if (
        canonicalTargetConversationId === null ||
        presentationConversationId === null ||
        canonicalTargetConversationId !== presentationConversationId
      ) {
        return undefined;
      }
      try {
        return await ipcBridge.presentationTemplates.allocateScratch.invoke({
          conversation_id: canonicalTargetConversationId,
          template_id: selectedTemplate.manifest.id,
        });
      } catch (error) {
        Message.error(t('conversation.presentationTemplates.scratch.prepareError', { error: String(error) }));
        throw error;
      }
    },
    [presentationConversationId, selectedTemplate, t]
  );

  const composeSend = useCallback(
    (message: string, files: string[], scratch?: ArtifactScratchAllocation) =>
      composeAssistantSend(selectedTemplate, message, files, scratch),
    [selectedTemplate]
  );

  const discardScratch = useCallback(
    async (runId: string): Promise<void> => {
      try {
        await ipcBridge.presentationTemplates.discardScratch.invoke({ run_id: runId });
        Message.success(t('conversation.presentationTemplates.scratch.cleanupSuccess'));
      } catch (error) {
        Message.error(t('conversation.presentationTemplates.scratch.cleanupError', { error: String(error) }));
      }
    },
    [t]
  );

  const isRecoveryActionCurrent = useCallback(
    (action: { conversationId: string; lifecycleEpoch: number }): boolean =>
      currentConversationIdRef.current === action.conversationId &&
      recoveryLifecycleEpochRef.current === action.lifecycleEpoch,
    []
  );

  const refreshRecoverableRuns = useCallback(
    async (showFailure = true, action?: { conversationId: string; lifecycleEpoch: number }): Promise<boolean> => {
      if (action && !isRecoveryActionCurrent(action)) return false;
      const requestId = ++recoveryRequestRef.current;
      if (presentationConversationId === null) {
        setRecoverableRuns([]);
        return true;
      }

      try {
        const result = await ipcBridge.presentationRuns.listRecoverable.invoke({
          conversation_id: presentationConversationId,
          limit: 20,
        });
        if (action && !isRecoveryActionCurrent(action)) return false;
        if (requestId !== recoveryRequestRef.current) return false;
        if (result.ok === false) {
          if (result.code === 'DESKTOP_REQUIRED' || result.code === 'TEAM_SCOPE_UNSUPPORTED') {
            setRecoverableRuns([]);
            return true;
          }
          if (showFailure) {
            Message.error(recoveryTranslationRef.current('conversation.presentationTemplates.recovery.loadError'));
          }
          return false;
        }

        const canonicalItems: PresentationRunPublicDto[] = [];
        for (const run of result.items) {
          const runConversationId = normalizePresentationConversationId(run.conversationId);
          if (
            runConversationId !== presentationConversationId ||
            !['retained', 'failed_retained', 'dispatch_uncertain'].includes(run.dispatchStatus)
          ) {
            setRecoverableRuns([]);
            Message.error(
              recoveryTranslationRef.current('conversation.presentationTemplates.recovery.invalidResponse')
            );
            return false;
          }
          canonicalItems.push({ ...run, conversationId: runConversationId });
        }
        setRecoverableRuns(canonicalItems.slice(0, 20));
        return true;
      } catch {
        if (requestId === recoveryRequestRef.current && (!action || isRecoveryActionCurrent(action)) && showFailure) {
          Message.error(recoveryTranslationRef.current('conversation.presentationTemplates.recovery.loadError'));
        }
        return false;
      }
    },
    [isRecoveryActionCurrent, presentationConversationId]
  );

  const openRecovery = useCallback(
    async (run: PresentationRunPublicDto): Promise<void> => {
      const sha256 = run.retainedCandidate?.sha256;
      if (
        presentationConversationId === null ||
        currentConversationIdRef.current !== presentationConversationId ||
        normalizePresentationConversationId(run.conversationId) !== presentationConversationId ||
        run.dispatchStatus === 'dispatch_uncertain' ||
        !run.actions.openAllowed ||
        !sha256
      ) {
        return;
      }
      const action = {
        conversationId: presentationConversationId,
        lifecycleEpoch: recoveryLifecycleEpochRef.current,
      };

      try {
        const result = await ipcBridge.presentationRuns.openRecovery.invoke({
          conversation_id: presentationConversationId,
          run_id: run.runId,
          expected_sha256: sha256,
        });
        if (!isRecoveryActionCurrent(action)) return;
        if (result.ok && result.runId === run.runId && result.sha256 === sha256) return;
      } catch {
        // Reconcile from main below. A lost reply cannot prove that Open succeeded.
      }

      if (!isRecoveryActionCurrent(action)) return;
      Message.error(recoveryTranslationRef.current('conversation.presentationTemplates.recovery.openError'));
      await refreshRecoverableRuns(false, action);
    },
    [isRecoveryActionCurrent, presentationConversationId, refreshRecoverableRuns]
  );

  const discardRecovery = useCallback(
    async (run: PresentationRunPublicDto): Promise<void> => {
      if (
        presentationConversationId === null ||
        currentConversationIdRef.current !== presentationConversationId ||
        normalizePresentationConversationId(run.conversationId) !== presentationConversationId ||
        run.dispatchStatus === 'dispatch_uncertain' ||
        !run.actions.discardAllowed
      ) {
        return;
      }
      const action = {
        conversationId: presentationConversationId,
        lifecycleEpoch: recoveryLifecycleEpochRef.current,
      };

      try {
        const result = await ipcBridge.presentationRuns.discard.invoke({
          conversation_id: presentationConversationId,
          run_id: run.runId,
          expected_revision: run.revision,
        });
        if (!isRecoveryActionCurrent(action)) return;
        if (result.ok && result.runId === run.runId) {
          await refreshRecoverableRuns(true, action);
          return;
        }
      } catch {
        // Reconcile from main below. A lost reply cannot authorize local removal.
      }

      if (!isRecoveryActionCurrent(action)) return;
      Message.error(recoveryTranslationRef.current('conversation.presentationTemplates.recovery.discardError'));
      await refreshRecoverableRuns(false, action);
    },
    [isRecoveryActionCurrent, presentationConversationId, refreshRecoverableRuns]
  );

  useLayoutEffect(() => {
    recoveryLifecycleEpochRef.current += 1;
    if (recoveryConversationIdRef.current !== presentationConversationId) {
      recoveryConversationIdRef.current = presentationConversationId;
      setRecoverableRuns([]);
    }
    return () => {
      recoveryLifecycleEpochRef.current += 1;
    };
  }, [presentationConversationId]);

  useEffect(() => {
    const closeById = recoveryMessageCloseByIdRef.current;
    return () => {
      for (const closeMessage of closeById.values()) closeMessage();
      closeById.clear();
    };
  }, [presentationConversationId]);

  useEffect(() => {
    void refreshRecoverableRuns();
    return () => {
      recoveryRequestRef.current += 1;
    };
  }, [refreshRecoverableRuns]);

  useEffect(() => {
    const translate = recoveryTranslationRef.current;
    const closeById = recoveryMessageCloseByIdRef.current;
    const nextMessageIds = new Set<string>();
    for (const run of recoverableRuns.filter((candidate) => candidate.conversationId === presentationConversationId)) {
      const messageId = `presentation-recovery-${presentationConversationId}-${run.runId}`;
      nextMessageIds.add(messageId);
      const isUncertain = run.dispatchStatus === 'dispatch_uncertain';
      const statusKey = isUncertain
        ? 'conversation.presentationTemplates.recovery.status.dispatchUncertain'
        : run.disposition === 'REVIEW_REQUIRED'
          ? run.dispatchStatus === 'failed_retained'
            ? 'conversation.presentationTemplates.recovery.status.reviewRequiredAfterFailure'
            : 'conversation.presentationTemplates.recovery.status.reviewRequired'
          : 'conversation.presentationTemplates.recovery.status.trackingRequired';
      const status = translate(statusKey);
      const sha256 = run.retainedCandidate?.sha256;
      const canOpen = !isUncertain && run.actions.openAllowed && Boolean(sha256);
      const canDiscard = !isUncertain && run.actions.discardAllowed;

      const closeMessage = Message.warning({
        id: messageId,
        duration: 0,
        closable: true,
        content: createElement(
          'span',
          { role: 'status', 'aria-label': status },
          createElement('span', null, status),
          sha256
            ? createElement(
                'span',
                { className: 'ml-8px' },
                translate('conversation.presentationTemplates.recovery.hash', { sha256 })
              )
            : null,
          canOpen
            ? createElement(
                Button,
                {
                  size: 'mini',
                  type: 'text',
                  className: 'ml-8px',
                  'aria-label': translate('conversation.presentationTemplates.recovery.actions.open'),
                  onClick: () => void openRecovery(run),
                },
                translate('conversation.presentationTemplates.recovery.actions.open')
              )
            : null,
          canDiscard
            ? createElement(
                Button,
                {
                  size: 'mini',
                  type: 'text',
                  className: 'ml-8px',
                  'aria-label': translate('conversation.presentationTemplates.recovery.actions.discard'),
                  onClick: () => void discardRecovery(run),
                },
                translate('conversation.presentationTemplates.recovery.actions.discard')
              )
            : null
        ),
      });
      if (closeMessage) closeById.set(messageId, closeMessage);
    }

    for (const [messageId, closeMessage] of closeById) {
      if (nextMessageIds.has(messageId)) continue;
      closeMessage();
      closeById.delete(messageId);
    }
  }, [discardRecovery, openRecovery, presentationConversationId, recoverableRuns]);

  const showRetainedScratch = useCallback(
    (runId: string, directory: string): void => {
      Message.warning({
        duration: 0,
        closable: true,
        content: createElement(
          'span',
          null,
          t('conversation.presentationTemplates.scratch.retained', { path: directory }),
          createElement(
            Button,
            {
              size: 'mini',
              type: 'text',
              className: 'ml-8px',
              onClick: () => void discardScratch(runId),
            },
            t('conversation.presentationTemplates.scratch.cleanup')
          )
        ),
      });
    },
    [discardScratch, t]
  );

  const registerScratchTurn = useCallback((turnId: string | undefined, runId: string | undefined): void => {
    if (!turnId || !runId) return;
    scratchRunByTurnRef.current.set(turnId, runId);
  }, []);

  const retainScratchRun = useCallback(
    async (runId: string | undefined, reason: 'failed' | 'interrupted'): Promise<void> => {
      if (!runId) return;
      const result = await ipcBridge.presentationTemplates.retainScratch.invoke({ run_id: runId, reason });
      if (result.status === 'retained') showRetainedScratch(runId, result.directory);
    },
    [showRetainedScratch]
  );

  const handleScratchTerminal = useCallback(
    async (event: { turnId?: string; outcome: 'completed' | 'failed' }): Promise<void> => {
      if (!event.turnId) return;
      const runId = scratchRunByTurnRef.current.get(event.turnId);
      if (!runId) return;
      scratchRunByTurnRef.current.delete(event.turnId);

      if (event.outcome === 'failed') {
        await retainScratchRun(runId, 'failed');
        return;
      }

      const result = await ipcBridge.presentationTemplates.completeScratch.invoke({ run_id: runId });
      if (result.status === 'retained') showRetainedScratch(runId, result.directory);
    },
    [retainScratchRun, showRetainedScratch]
  );

  const interruptScratchTurn = useCallback(
    async (turnId: string | null): Promise<void> => {
      if (!turnId) return;
      const runId = scratchRunByTurnRef.current.get(turnId);
      if (!runId) return;
      scratchRunByTurnRef.current.delete(turnId);
      await retainScratchRun(runId, 'interrupted');
    },
    [retainScratchRun]
  );

  useAddEventListener(
    'artifact.scratch.terminal',
    (event) => {
      if (
        presentationConversationId === null ||
        normalizePresentationConversationId(event.conversationId) !== presentationConversationId
      ) {
        return;
      }
      void handleScratchTerminal(event);
    },
    [handleScratchTerminal, presentationConversationId]
  );

  return {
    templates: templates ?? [],
    templatesLoading: isLoading,
    galleryOpen,
    openGallery,
    closeGallery,
    toggleGallery,
    selectedTemplate,
    selectTemplate,
    clearSelection,
    importFromDialog,
    removeTemplate,
    prepareScratch,
    composeSend,
    registerScratchTurn,
    retainScratchRun,
    handleScratchTerminal,
    interruptScratchTurn,
    discardScratch,
    recoverableRuns: recoverableRuns.filter((run) => run.conversationId === presentationConversationId),
    refreshRecoverableRuns,
  };
}
