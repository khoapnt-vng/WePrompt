/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import React from 'react';

import type { StudioProposal, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import type { UseStoryboardEditorResult } from '@/renderer/pages/studio/hooks/useStoryboardEditor';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
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
    await ipcBridge.conversation.sendMessage.invoke({
      input: REPROPOSE_INSTRUCTION,
      conversation_id: conversation.state.conversation.id,
      files: [],
      pinned_context: getConversationPinnedContext(conversation.state.conversation),
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
