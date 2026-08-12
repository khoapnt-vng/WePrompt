/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import { createStudioBriefConversation } from '../studioBriefConversation';

export type StudioBriefConversation = Extract<TChatConversation, { type: 'aionrs' }>;

export type BriefConversationState =
  | { kind: 'absent' }
  | { kind: 'creating' }
  | { kind: 'ready'; conversation: StudioBriefConversation }
  | { kind: 'dangling'; conversationId: string };

export type UseBriefConversationResult = {
  state: BriefConversationState;
  errorMessageKey: string | null;
  recreate(): void;
};

const resolveBoundState = (
  conversationId: string | null,
  conversations: readonly TChatConversation[],
  ignoredConversationId: string | null
): BriefConversationState => {
  if (conversationId === null || conversationId === ignoredConversationId) return { kind: 'absent' };
  const conversation = conversations.find((candidate) => candidate.id === conversationId);
  return conversation?.type === 'aionrs' ? { kind: 'ready', conversation } : { kind: 'dangling', conversationId };
};

/** How a start attempt ended. It never rejects, so every subscriber sees the same answer. */
type StartOutcome =
  | { kind: 'ready'; conversation: StudioBriefConversation }
  | { kind: 'dangling'; conversationId: string; messageKey: string }
  | { kind: 'failed'; messageKey: string };

/**
 * One start attempt per project, for the lifetime of the renderer.
 *
 * The conversation is created when the project opens, so the guard has to survive everything that
 * can re-run that effect before the project record has been rebound: StrictMode's double-invoked
 * effects, a remount as the route settles, and a project object that is a new identity on every
 * revision. A ref or a render-scoped flag is reset by exactly those events, and the cost of getting
 * it wrong is a second conversation per project rather than a wasted render.
 *
 * Entries are kept after they settle, failures included — a start that failed stays failed until
 * the user asks for another one, which is what stops an unrelated project update from silently
 * retrying a create whose outcome we could not confirm.
 */
const startedProjects = new Map<string, Promise<StartOutcome>>();

/**
 * Forget a project's start attempt so the next render begins a new one. `recreate` calls this for
 * the project it is restarting; tests call it with no argument to get a clean guard.
 */
export const forgetDirectorConversationStart = (projectId?: string): void => {
  if (projectId === undefined) startedProjects.clear();
  else startedProjects.delete(projectId);
};

type StartInput = {
  projectId: string;
  projectName: string;
  model: TProviderWithModel;
  /**
   * Read at bind time rather than captured at start time. Binding is a compare-and-set against the
   * project revision, and the user can edit the brief while the conversation is still being
   * created — a revision read at open would then lose the race and report the fresh conversation as
   * dangling.
   */
  currentRevision: () => number;
};

const startDirectorConversation = async (input: StartInput): Promise<StartOutcome> => {
  const descriptorResult = await ipcBridge.creativeStudio.getBriefSessionServer.invoke({ projectId: input.projectId });
  if (descriptorResult.ok === false) return { kind: 'failed', messageKey: descriptorResult.error.messageKey };

  const descriptor = descriptorResult.data;
  const availableServer: IMcpServer = {
    ...descriptor,
    builtin: true,
    enabled: true,
    created_at: 0,
    updated_at: 0,
    original_json: JSON.stringify(descriptor),
  };

  let conversation: StudioBriefConversation;
  try {
    conversation = (await createStudioBriefConversation({
      type: 'aionrs',
      name: input.projectName,
      model: input.model,
      studioProjectId: input.projectId,
      mcpServerAllowlist: [descriptor.id],
      availableMcpServers: [availableServer],
      extra: { workspace: '', custom_workspace: false },
    })) as StudioBriefConversation;
  } catch {
    // Includes the curated-snapshot check refusing a tool set that drifted. There is no recovery
    // to attempt here: the conversation must not be used, and the pane offers to start over.
    return { kind: 'failed', messageKey: 'conversation.creativeStudio.errors.storage' };
  }

  const bindResult = await ipcBridge.creativeStudio.bindBriefConversation.invoke({
    projectId: input.projectId,
    expectedRevision: input.currentRevision(),
    conversationId: conversation.id,
  });
  if (bindResult.ok === false)
    return { kind: 'dangling', conversationId: conversation.id, messageKey: bindResult.error.messageKey };

  return { kind: 'ready', conversation };
};

export const useBriefConversation = (project: StudioRendererProject): UseBriefConversationResult => {
  const { allConversations } = useConversationHistoryContext();
  const { current_model, modelList } = useGuidModelSelection('aionrs');
  const { data: providers, error: providersError } = useProvidersQuery();
  const [ignoredConversationId, setIgnoredConversationId] = useState<string | null>(null);
  const boundState = useMemo(
    () => resolveBoundState(project.briefConversationId ?? null, allConversations, ignoredConversationId),
    [allConversations, ignoredConversationId, project.briefConversationId]
  );
  const [state, setState] = useState<BriefConversationState>(boundState);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const projectRef = useRef(project);
  projectRef.current = project;

  // The project record wins whenever it has something to say; otherwise what we know locally
  // stands. A binding that was refused leaves a conversation nothing points at — the record still
  // reads `absent`, and re-deriving from it would drop the only trace of the orphan on the floor.
  useEffect(() => {
    if (boundState.kind === 'absent') return;
    if (state.kind === 'creating' || state.kind === 'ready') return;
    setState(boundState);
  }, [boundState, state.kind]);

  // A model list that has resolved to nothing can never produce a selection, so waiting for one is
  // waiting forever. Before it resolves, an empty list means "not yet" and says nothing.
  const providersResolved = providers !== undefined || providersError !== undefined;
  const noModelConfigured = providersResolved && modelList.length === 0;

  useEffect(() => {
    if (boundState.kind !== 'absent') return;
    if (noModelConfigured) {
      setErrorMessageKey('conversation.noModelConfigured');
      return;
    }
    if (current_model === undefined) return;

    let subscribed = true;
    const started = startedProjects.get(project.id);
    const start =
      started ??
      startDirectorConversation({
        projectId: project.id,
        projectName: project.name,
        model: current_model,
        currentRevision: () => projectRef.current.revision,
      });
    if (started === undefined) {
      startedProjects.set(project.id, start);
      setErrorMessageKey(null);
    }
    setState((current) => (current.kind === 'absent' ? { kind: 'creating' } : current));

    void start.then((outcome) => {
      if (!subscribed) return;
      if (outcome.kind === 'ready') {
        setErrorMessageKey(null);
        setState({ kind: 'ready', conversation: outcome.conversation });
        return;
      }
      setErrorMessageKey(outcome.messageKey);
      setState(outcome.kind === 'dangling' ? { kind: 'dangling', conversationId: outcome.conversationId } : boundState);
    });

    return () => {
      subscribed = false;
    };
    // `state` is deliberately absent: setting `creating` from inside this effect would otherwise
    // tear down the subscription that has just been made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, boundState, current_model, noModelConfigured, project.id, project.name]);

  const recreate = useCallback((): void => {
    forgetDirectorConversationStart(project.id);
    setIgnoredConversationId(project.briefConversationId ?? null);
    setErrorMessageKey(null);
    setState({ kind: 'absent' });
    // Start fresh after a failure leaves every other input to the effect unchanged, so nothing but
    // this would tell it to try again.
    setAttempt((current) => current + 1);
  }, [project.briefConversationId, project.id]);

  return { state, errorMessageKey, recreate };
};
