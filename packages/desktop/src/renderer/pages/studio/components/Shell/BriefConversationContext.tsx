/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';

import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';

import { useBriefConversation, type UseBriefConversationResult } from '../PhaseShell/phases/brief/useBriefConversation';

const BriefConversationContext = createContext<UseBriefConversationResult | null>(null);

/**
 * Provides the Director conversation to the whole Studio subtree.
 *
 * Before this, Brief and Write each called `useBriefConversation` themselves — two hook instances
 * resolving the same conversation, each with its own local state for the dangling/creating cases.
 * They agreed because they read the same context, not because anything kept them in step.
 *
 * One provider means one instance and one mount, which is what lets the shell hold a streaming
 * reply across a phase change instead of relying on two subtrees happening to stay consistent.
 */
export const BriefConversationProvider: React.FC<{ project: StudioRendererProject; children: React.ReactNode }> = ({
  project,
  children,
}) => {
  const conversation = useBriefConversation(project);
  return <BriefConversationContext.Provider value={conversation}>{children}</BriefConversationContext.Provider>;
};

/**
 * Falls back to "no conversation yet" outside a provider rather than throwing.
 *
 * That is not a fudge for tests: `absent` is a real state the UI already renders — a project whose
 * Director conversation is still being created has nothing to hand the chat surface, and no
 * provider is indistinguishable from that. Throwing would make every isolated phase render a hard
 * error for a situation the components handle correctly.
 *
 * It does mean a forgotten provider degrades quietly, so it warns in development. `recreate` is
 * inert here by design: with no conversation to replace, silently doing nothing is safer than
 * reaching for one that does not exist.
 */
const ABSENT: UseBriefConversationResult = {
  state: { kind: 'absent' },
  errorMessageKey: null,
  recreate: () => {},
};

export const useBriefConversationContext = (): UseBriefConversationResult => {
  const value = useContext(BriefConversationContext);
  if (value === null) {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn('Studio: no BriefConversationProvider above this component; treating it as absent.');
    }
    return ABSENT;
  }
  return value;
};
