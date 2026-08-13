/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import React from 'react';

import type { StudioProposal, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import type { UseStoryboardEditorResult } from '@/renderer/pages/studio/hooks/useStoryboardEditor';
import type { StudioBriefConversation } from '../PhaseShell/phases/brief/useBriefConversation';
import { useBriefConversationContext } from './BriefConversationContext';
import {
  DirectorProposalCard,
  type DirectorProposalAction,
  type DirectorProposalRejectAction,
} from './DirectorProposalCard';

/**
 * Sent verbatim to the Director when a proposal has gone stale. It names the tool to call because a
 * bare "try again" reliably produces a redraft from memory rather than from the current script.
 */
const REPROPOSE_INSTRUCTION =
  'The script changed since your last proposal (it is now at a newer revision). Call read_storyboard and redraft your proposal against the current script.';

export type StudioRuleBreachReport = {
  sceneTitle: string;
  ruleText: string;
  matchedTerm: string;
};

/**
 * Sent verbatim when a rule blocked a render. English, like REPROPOSE_INSTRUCTION and every other
 * model-facing literal in Studio: localising the model's instructions makes its behaviour depend on
 * the UI language.
 */
export const describeRuleBreachInstruction = (reports: readonly StudioRuleBreachReport[]): string =>
  [
    'A governing project rule blocked this render before any paid generation began. Nothing was generated.',
    ...reports.map(
      (report) =>
        `- Shot "${report.sceneTitle}" violated the rule "${report.ruleText}" because the term "${report.matchedTerm}" matched.`
    ),
    "Rewrite each affected shot's visual prompt to satisfy the quoted rule, then propose the change. Do not ask to remove the rule.",
  ].join('\n');

/**
 * One desktop send site for every Studio-initiated Director turn, so the latest pinned-context
 * payload is attached consistently. The current backend may ignore this field; the re-GET preserves
 * the intended payload for a backend that supports it.
 *
 * The conversation is re-read before its pins are accessed, matching AionrsSendBox. The in-memory
 * record from ConversationHistoryContext can lag a pin written through IPC. A failed re-GET falls
 * back to the handle already held rather than dropping the message.
 */
export const sendDirectorInstruction = async (input: {
  conversation: StudioBriefConversation;
  instruction: string;
}): Promise<void> => {
  const latest = (await getConversationOrNull(input.conversation.id)) ?? input.conversation;
  await ipcBridge.conversation.sendMessage.invoke({
    input: input.instruction,
    conversation_id: input.conversation.id,
    files: [],
    pinned_context: getConversationPinnedContext(latest),
  });
};

export type DirectorProposalsProps = {
  project: StudioRendererProject;
  proposals: readonly StudioProposal[];
  editor: Pick<UseStoryboardEditorResult, 'hasUnsavedSceneDrafts' | 'flushAllSceneDrafts'>;
  acceptProposal: DirectorProposalAction;
  rejectProposal: DirectorProposalRejectAction;
};

/** Returns the proposals still awaiting an answer. Exported so the page can decide whether to render the slot at all. */
export const pendingDirectorProposals = (proposals: readonly StudioProposal[]): StudioProposal[] =>
  proposals.filter((proposal) => proposal.status === 'pending');

/**
 * The pending proposals, rendered inside the Director pane.
 *
 * This lived in Brief until the work panel became phase-agnostic. A proposal is the Director's
 * output and outlives whichever phase is open, so tying its render site to Brief meant a user who
 * moved to Write lost the card without answering it.
 */
export const DirectorProposals: React.FC<DirectorProposalsProps> = ({
  project,
  proposals,
  editor,
  acceptProposal,
  rejectProposal,
}) => {
  const conversation = useBriefConversationContext();
  const pending = pendingDirectorProposals(proposals);

  const repropose = async (): Promise<void> => {
    if (conversation.state.kind !== 'ready') return;
    await sendDirectorInstruction({
      conversation: conversation.state.conversation,
      instruction: REPROPOSE_INSTRUCTION,
    });
  };

  if (pending.length === 0) return null;

  return (
    <>
      {pending.map((proposal) => (
        <DirectorProposalCard
          key={proposal.id}
          project={project}
          proposal={proposal}
          editor={editor}
          acceptProposal={acceptProposal}
          rejectProposal={rejectProposal}
          onRepropose={repropose}
        />
      ))}
    </>
  );
};
