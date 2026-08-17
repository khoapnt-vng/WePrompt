/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import {
  buildStudioBriefRulesPin,
  resolveEffectiveStudioRules,
  STUDIO_BRIEF_RULES_PIN_ID,
} from '@/common/types/project/creativeStudioRules';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { buildContextHandoffExtraPatch } from '@/renderer/pages/conversation/contextHandoff/contextConversationUpdate';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
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
  /**
   * Keeps one Studio-owned entry in the Director conversation's `pinned_context`.
   *
   * `pinned_context` is the only field on the send wire that is recomputed from a fresh server read
   * on every message (AionrsSendBox re-GETs the conversation, then forwards the pins), so a write
   * here rides every subsequent turn once the backend reads this field. Today AionCore silently
   * drops it. `preset_context`/`preset_rules` cannot provide a per-turn substitute: they are captured
   * once at conversation create and the send body has no slot for them.
   *
   * Five details are load-bearing:
   * - `merge_extra` merges at the `extra` level, NOT inside `context_handoff`. So the patch must be
   *   built with `buildContextHandoffExtraPatch`, which spreads the conversation's current
   *   `context_handoff` first (contextConversationUpdate.ts:35-40). Writing a bare
   *   `{ context_handoff: { pinned_context } }` replaces the whole sub-object and drops `snapshot`,
   *   `revision`, `context_file_path`/`_name`, `last_budget_status`, `last_exported_at`,
   *   `last_compacted_turn_id` and `turns_since_compaction` on every rules change. Every existing
   *   writer goes through this helper for exactly that reason (ContextHandoffPanel.tsx:169,
   *   useContextCompaction.ts:336-340).
   * - Non-Studio pins are preserved and the Studio pin is replaced in place by its fixed id, so a
   *   user pin can never be clobbered and the Studio pin can never be duplicated.
   * - The pin ITEM is still built literally rather than through addPinnedContext/updatePinnedContext,
   *   whose `cleanText` collapses ALL whitespace including newlines and would flatten the rule list
   *   (pinnedContext.ts:25). `buildContextHandoffExtraPatch` does not run `cleanText`, so it is safe
   *   for the patch while the item stays hand-built.
   * - The dedupe signature carries the conversation ID, not only the pin text. `recreate()` mints a
   *   NEW conversation with unchanged rules (`:197-205`, installed at `:182`); a content-only signature
   *   would match, return early, and leave that conversation with no Studio pin for the rest of the
   *   renderer's life.
   * - Zero rules and no stale Studio pin means NO write at all, not an empty one — see the guard below.
   *
   * Re-asserted on every rules change, whenever the conversation becomes ready, and whenever the
   * conversation's identity changes — which covers the realistic ways the pin could be lost: this
   * store is not CAS-guarded and Studio does not own it.
   *
   * `state.conversation` is `StudioBriefConversation = Extract<TChatConversation, { type: 'aionrs' }>`,
   * which is exactly the parameter type `buildContextHandoffExtraPatch` takes, so no cast is needed on
   * the way in — only on the way out, where `updates.extra` is typed against the whole union.
   */
  const lastSyncedPinRef = useRef<string | null>(null);
  const conversationId = state.kind === 'ready' ? state.conversation.id : null;
  const effectiveRules = useMemo(() => resolveEffectiveStudioRules(project.rules), [project.rules]);

  useEffect(() => {
    if (conversationId === null || state.kind !== 'ready') return;
    const pin = buildStudioBriefRulesPin({ rules: effectiveRules, now: Date.now() });
    const signature = `${conversationId} ${pin === null ? '' : pin.content}`;
    if (lastSyncedPinRef.current === signature) return;
    lastSyncedPinRef.current = signature;
    const current = getConversationPinnedContext(state.conversation);
    const existing = current.filter((item) => item.id !== STUDIO_BRIEF_RULES_PIN_ID);
    // Nothing to write: no rules to push, and no stale Studio pin to clear. Without this the effect
    // issues a `conversation.update` on every open of every project that has no rules — which is every
    // project until the user pins one — for a patch identical to what is already stored. It also keeps
    // `conversation.update` off the wire entirely for those projects, which is what lets
    // `BriefConversation.dom.test.tsx` keep its existing `@/common` mock shape.
    if (pin === null && existing.length === current.length) return;
    const patch = buildContextHandoffExtraPatch(state.conversation, {
      pinned_context: pin === null ? existing : [...existing, pin],
    });
    void ipcBridge.conversation.update
      .invoke({
        id: conversationId,
        merge_extra: true,
        updates: { extra: patch as TChatConversation['extra'] },
      })
      // A failed pin write loses only this best-effort channel: the main-process money gate remains
      // authoritative, and read_storyboard still carries the rules. Retrying on the next change.
      .catch(() => {
        lastSyncedPinRef.current = null;
      });
  }, [conversationId, effectiveRules, state]);
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
