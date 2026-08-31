/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ipcBridge } from '@/common';
import type {
  StudioPaidRecoveryQuoteSummaryV2,
  StudioRendererProjectV2,
  StudioRendererProposalCatalogV2,
  StudioRendererProposalV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import type { DirectorProposalChatIntent } from '../components/Workspace/DirectorRail';
import { createStudioDirectorToolOutcomeInterpreter } from '../components/Workspace/DirectorRail/turnRecap';
import type { WorkspaceShellHandle } from '../components/Workspace';
import type { StudioView } from '../studioPhaseRoute';

type MutableValueRef<Value> = { current: Value };
type ReadonlyValueRef<Value> = { readonly current: Value };

type StudioReferenceDecisionIntent = { kind: 'rejected' } | { kind: 'generation_gate' };

type StudioProposalAuthoritySnapshot = {
  project: StudioRendererProjectV2;
  catalog: StudioRendererProposalCatalogV2;
};

type StudioProposalAuthorityState = 'ready' | 'stale' | 'unavailable' | 'refreshing';

type StudioReviewedActionTarget = {
  kind: 'proposal' | 'reference_request' | 'handoff';
  id: string;
};

type StudioReviewedActionLatch = {
  token: number;
  target: StudioReviewedActionTarget | null;
};

export const useStudioReviewedActionAuthority = () => {
  const [reviewedAction, setReviewedAction] = useState<StudioReviewedActionLatch | null>(null);
  const reviewedActionRef = useRef<StudioReviewedActionLatch | null>(null);
  const reviewedActionSequenceRef = useRef(0);
  const beginReviewedAction = useCallback((target: StudioReviewedActionTarget | null): number | null => {
    if (reviewedActionRef.current !== null) return null;
    reviewedActionSequenceRef.current += 1;
    const latch = { token: reviewedActionSequenceRef.current, target };
    reviewedActionRef.current = latch;
    setReviewedAction(latch);
    return latch.token;
  }, []);
  const retargetReviewedAction = useCallback((token: number, target: StudioReviewedActionTarget): boolean => {
    const current = reviewedActionRef.current;
    if (current?.token !== token) return false;
    const next = { token, target };
    reviewedActionRef.current = next;
    setReviewedAction(next);
    return true;
  }, []);
  const finishReviewedAction = useCallback((token: number): void => {
    if (reviewedActionRef.current?.token !== token) return;
    reviewedActionRef.current = null;
    setReviewedAction(null);
  }, []);
  const reviewedActionLocked = reviewedAction !== null;
  const pendingReviewedAction = reviewedAction?.target ?? null;
  return {
    reviewedActionRef,
    beginReviewedAction,
    retargetReviewedAction,
    finishReviewedAction,
    reviewedActionLocked,
    pendingReviewedAction,
  };
};

export const useStudioPaidRecoveryProposalState = (projectId: string) => {
  const [paidRecoveryQuotes, setPaidRecoveryQuotes] = useState<
    Readonly<Record<string, StudioPaidRecoveryQuoteSummaryV2>>
  >({});
  const [paidRecoveryStatusMessageKeys, setPaidRecoveryStatusMessageKeys] = useState<Readonly<Record<string, string>>>(
    {}
  );
  useEffect(() => {
    setPaidRecoveryQuotes({});
    setPaidRecoveryStatusMessageKeys({});
  }, [projectId]);
  return {
    paidRecoveryQuotes,
    setPaidRecoveryQuotes,
    paidRecoveryStatusMessageKeys,
    setPaidRecoveryStatusMessageKeys,
  };
};

type StudioDirectorToolOutcomeInterpreterInput = {
  projectId: string;
  project: StudioRendererProjectV2 | null;
  proposalRefreshing: boolean;
  proposalErrorMessageKey: string | null;
  proposalCatalog: StudioRendererProposalCatalogV2 | null;
};

export const useStudioDirectorToolOutcomeInterpreter = ({
  projectId,
  project,
  proposalRefreshing,
  proposalErrorMessageKey,
  proposalCatalog,
}: StudioDirectorToolOutcomeInterpreterInput) =>
  useMemo(
    () =>
      createStudioDirectorToolOutcomeInterpreter(
        projectId,
        project?.revision ?? null,
        proposalRefreshing || proposalErrorMessageKey !== null ? null : proposalCatalog
      ),
    [project?.revision, projectId, proposalCatalog, proposalErrorMessageKey, proposalRefreshing]
  );

export const useStudioProposalDraftAuthority = (workspaceDirtyCount: number, activeRuleDirtyCount: number) => {
  const proposalDraftAuthorityRef = useRef({ workspaceDirtyCount: 0, activeRuleDirtyCount: 0 });
  proposalDraftAuthorityRef.current = { workspaceDirtyCount, activeRuleDirtyCount };
  return proposalDraftAuthorityRef;
};

type BeginReviewedAction = ReturnType<typeof useStudioReviewedActionAuthority>['beginReviewedAction'];
type RetargetReviewedAction = ReturnType<typeof useStudioReviewedActionAuthority>['retargetReviewedAction'];
type FinishReviewedAction = ReturnType<typeof useStudioReviewedActionAuthority>['finishReviewedAction'];

type StudioProposalReviewAuthorityInput = {
  proposalDraftAuthorityRef: ReadonlyValueRef<{ workspaceDirtyCount: number; activeRuleDirtyCount: number }>;
  proposalRefreshing: boolean;
  project: StudioRendererProjectV2 | null;
  proposalErrorMessageKey: string | null;
  proposalCatalog: StudioRendererProposalCatalogV2 | null;
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  refetchProjectWorkspace: () => Promise<StudioRendererProjectV2 | null>;
  refetchProposals: () => Promise<StudioRendererProposalCatalogV2 | null>;
  beginReviewedAction: BeginReviewedAction;
  retargetReviewedAction: RetargetReviewedAction;
  finishReviewedAction: FinishReviewedAction;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  projectId: string;
  proposals: readonly StudioRendererProposalV2[];
  directorDraftRequestSequenceRef: MutableValueRef<number>;
  setDirectorDraftRequest: Dispatch<SetStateAction<{ requestId: number; projectId: string; prompt: string } | null>>;
  workspaceShellRef: MutableValueRef<WorkspaceShellHandle | null>;
  activeView: StudioView | null;
  t: (key: string, values: { proposalId: string }) => string;
  saveAllDrafts: () => Promise<boolean>;
};

export const useStudioProposalReviewAuthority = ({
  proposalDraftAuthorityRef,
  proposalRefreshing,
  project,
  proposalErrorMessageKey,
  proposalCatalog,
  projectRef,
  refetchProjectWorkspace,
  refetchProposals,
  beginReviewedAction,
  retargetReviewedAction,
  finishReviewedAction,
  setActionErrorMessageKey,
  projectId,
  proposals,
  directorDraftRequestSequenceRef,
  setDirectorDraftRequest,
  workspaceShellRef,
  activeView,
  t,
  saveAllDrafts,
}: StudioProposalReviewAuthorityInput) => {
  const proposalDraftBlocker = useCallback((candidate: StudioRendererProposalV2): 'workspace' | 'rules' | null => {
    const current = proposalDraftAuthorityRef.current;
    if (candidate.payload.kind === 'mutation_batch') return current.workspaceDirtyCount > 0 ? 'workspace' : null;
    if (candidate.payload.kind === 'pin_rule') return current.activeRuleDirtyCount > 0 ? 'rules' : null;
    return null;
  }, []);

  const proposalAuthorityVerified = useCallback(
    (candidate: StudioRendererProposalV2): boolean =>
      !proposalRefreshing &&
      project !== null &&
      proposalErrorMessageKey === null &&
      proposalCatalog !== null &&
      proposalCatalog.projectId === project.id &&
      proposalCatalog.projectRevision === project.revision &&
      proposalCatalog.proposals.find((proposal) => proposal.id === candidate.id) === candidate,
    [project, proposalCatalog, proposalErrorMessageKey, proposalRefreshing]
  );

  const proposalAuthorityState = useCallback(
    (candidate: StudioRendererProposalV2): StudioProposalAuthorityState => {
      if (proposalRefreshing) return 'refreshing';
      if (!proposalAuthorityVerified(candidate)) {
        return 'unavailable';
      }
      return candidate.review.status;
    },
    [proposalAuthorityVerified, proposalRefreshing]
  );

  const refreshProposalAuthority = useCallback(async (): Promise<StudioProposalAuthoritySnapshot | null> => {
    const refreshedProject = await refetchProjectWorkspace();
    if (refreshedProject === null) return null;
    projectRef.current = refreshedProject;
    const catalog = await refetchProposals();
    if (
      catalog === null ||
      catalog.projectId !== refreshedProject.id ||
      catalog.projectRevision !== refreshedProject.revision
    ) {
      return null;
    }
    return { project: refreshedProject, catalog };
  }, [refetchProjectWorkspace, refetchProposals]);

  const performProposalDecision = useCallback(
    async (
      decision: 'accept' | 'reject',
      target: StudioRendererProposalV2,
      authority: StudioProposalAuthoritySnapshot,
      draftErrorMode: 'card' | 'chat' = 'card'
    ): Promise<boolean> => {
      if (decision === 'accept') {
        if (target.payload.kind === 'paid_recovery') {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.paidRecovery.cardOnly');
          return false;
        }
        if (target.review.status !== 'ready' || target.baseRevision !== authority.project.revision) {
          setActionErrorMessageKey(
            target.review.status === 'stale'
              ? 'conversation.creativeStudio.workspace.proposals.chatStale'
              : 'conversation.creativeStudio.workspace.proposals.reviewUnavailable'
          );
          return false;
        }
        // Refreshing authority is asynchronous. Read the live draft fence at the final synchronous
        // boundary immediately before invoking Main so a draft created during refresh cannot be
        // accepted over.
        const draftBlocker = proposalDraftBlocker(target);
        if (draftBlocker !== null) {
          setActionErrorMessageKey(
            draftErrorMode === 'chat'
              ? 'conversation.creativeStudio.workspace.proposals.chatDirty'
              : draftBlocker === 'workspace'
                ? 'conversation.creativeStudio.workspace.proposals.saveBeforeApply'
                : 'conversation.creativeStudio.workspace.proposals.reviewRuleDraftsFirst'
          );
          return false;
        }
        const result = await ipcBridge.creativeStudio.acceptProposal.invoke({
          projectId: authority.project.id,
          proposalId: target.id,
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          await refreshProposalAuthority();
          return false;
        }
      } else {
        const result = await ipcBridge.creativeStudio.rejectProposal.invoke({
          projectId: authority.project.id,
          proposalId: target.id,
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          await refreshProposalAuthority();
          return false;
        }
      }
      await refreshProposalAuthority();
      return true;
    },
    [proposalDraftBlocker, refreshProposalAuthority, setActionErrorMessageKey]
  );

  const decideProposalFromCard = useCallback(
    async (decision: 'accept' | 'reject', proposalId: string): Promise<boolean> => {
      const token = beginReviewedAction({ kind: 'proposal', id: proposalId });
      if (token === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return false;
      }
      setActionErrorMessageKey(null);
      try {
        const authority = await refreshProposalAuthority();
        if (authority === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.authorityUnavailable');
          return false;
        }
        const target = authority.catalog.proposals.find(
          (candidate) => candidate.id === proposalId && candidate.status === 'pending'
        );
        if (target === undefined) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatProposalNotFound');
          return false;
        }
        return await performProposalDecision(decision, target, authority);
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        await refreshProposalAuthority();
        return false;
      } finally {
        finishReviewedAction(token);
      }
    },
    [
      beginReviewedAction,
      finishReviewedAction,
      performProposalDecision,
      refreshProposalAuthority,
      setActionErrorMessageKey,
    ]
  );

  const decideProposalFromDirectorChat = useCallback(
    async (intent: DirectorProposalChatIntent): Promise<void> => {
      const token = beginReviewedAction(
        intent.proposalId === null ? null : { kind: 'proposal', id: intent.proposalId }
      );
      if (token === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      try {
        setActionErrorMessageKey(null);
        const authority = await refreshProposalAuthority();
        if (authority === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.authorityUnavailable');
          return;
        }
        const pending = authority.catalog.proposals.filter((candidate) => candidate.status === 'pending');
        const eligiblePending =
          intent.decision === 'accept'
            ? pending.filter((candidate) => candidate.payload.kind !== 'paid_recovery')
            : pending;
        const ready = eligiblePending.filter(
          (candidate) => candidate.review.status === 'ready' && candidate.baseRevision === authority.project.revision
        );
        const target =
          intent.proposalId === null
            ? ready.length === 1
              ? ready[0]
              : undefined
            : pending.find((candidate) => candidate.id === intent.proposalId);
        if (intent.proposalId === null && ready.length === 0) {
          setActionErrorMessageKey(
            pending.length === 0
              ? 'conversation.creativeStudio.workspace.proposals.chatNoPending'
              : intent.decision === 'accept' &&
                  pending.some(
                    (candidate) =>
                      candidate.payload.kind === 'paid_recovery' &&
                      candidate.review.status === 'ready' &&
                      candidate.baseRevision === authority.project.revision
                  )
                ? 'conversation.creativeStudio.workspace.proposals.paidRecovery.cardOnly'
                : pending.some((candidate) => candidate.review.status === 'stale')
                  ? 'conversation.creativeStudio.workspace.proposals.chatStale'
                  : 'conversation.creativeStudio.workspace.proposals.chatUnavailable'
          );
          return;
        }
        if (intent.proposalId === null && ready.length > 1) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatMultiplePending');
          return;
        }
        if (target === undefined) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatProposalNotFound');
          return;
        }
        if (intent.decision === 'accept' && target.payload.kind === 'paid_recovery') {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.paidRecovery.cardOnly');
          return;
        }
        if (!retargetReviewedAction(token, { kind: 'proposal', id: target.id })) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
          return;
        }
        if (
          intent.decision === 'accept' &&
          (target.review.status !== 'ready' || target.baseRevision !== authority.project.revision)
        ) {
          setActionErrorMessageKey(
            target.review.status === 'stale'
              ? 'conversation.creativeStudio.workspace.proposals.chatStale'
              : 'conversation.creativeStudio.workspace.proposals.chatUnavailable'
          );
          return;
        }
        const succeeded = await performProposalDecision(intent.decision, target, authority, 'chat');
        if (succeeded) {
          setActionErrorMessageKey(
            intent.decision === 'accept'
              ? 'conversation.creativeStudio.workspace.proposals.chatAccepted'
              : 'conversation.creativeStudio.workspace.proposals.chatRejected'
          );
        }
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        await refreshProposalAuthority();
      } finally {
        finishReviewedAction(token);
      }
    },
    [
      beginReviewedAction,
      finishReviewedAction,
      performProposalDecision,
      refreshProposalAuthority,
      retargetReviewedAction,
      setActionErrorMessageKey,
    ]
  );

  const queueUpdatedProposalDraft = useCallback(
    (proposalId: string): void => {
      directorDraftRequestSequenceRef.current += 1;
      setDirectorDraftRequest({
        requestId: directorDraftRequestSequenceRef.current,
        projectId,
        prompt: t('conversation.creativeStudio.workspace.proposals.reproposalPrompt', { proposalId }),
      });
      workspaceShellRef.current?.revealDirector({ projectId, view: activeView });
    },
    [activeView, projectId, t]
  );

  const requestUpdatedProposal = useCallback(
    async (proposalId: string, saveWorkspaceDrafts: boolean): Promise<void> => {
      const token = beginReviewedAction({ kind: 'proposal', id: proposalId });
      if (token === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      setActionErrorMessageKey(null);
      try {
        const visibleTarget = proposals.find(
          (candidate) =>
            candidate.id === proposalId && candidate.projectId === projectId && candidate.status === 'pending'
        );
        if (visibleTarget === undefined) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatProposalNotFound');
          return;
        }
        if (saveWorkspaceDrafts) {
          if (visibleTarget.payload.kind !== 'mutation_batch') return;
          if (!(await saveAllDrafts())) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.saveBeforeApply');
            return;
          }
        }
        const authority = await refreshProposalAuthority();
        if (authority === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.authorityUnavailable');
          return;
        }
        const exactPending = authority.catalog.proposals.some(
          (candidate) => candidate.id === proposalId && candidate.status === 'pending'
        );
        if (!exactPending) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatProposalNotFound');
          return;
        }
        queueUpdatedProposalDraft(proposalId);
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        finishReviewedAction(token);
      }
    },
    [
      beginReviewedAction,
      finishReviewedAction,
      projectId,
      proposals,
      queueUpdatedProposalDraft,
      refreshProposalAuthority,
      saveAllDrafts,
      setActionErrorMessageKey,
    ]
  );

  return {
    proposalDraftBlocker,
    proposalAuthorityVerified,
    proposalAuthorityState,
    refreshProposalAuthority,
    decideProposalFromCard,
    decideProposalFromDirectorChat,
    requestUpdatedProposal,
  };
};

type StudioProposalCardActionsInput = {
  decideProposalFromCard: (decision: 'accept' | 'reject', proposalId: string) => Promise<boolean>;
  paidRecoveryQuotes: Readonly<Record<string, StudioPaidRecoveryQuoteSummaryV2>>;
  paidRecoveryStatusMessageKeys: Readonly<Record<string, string>>;
  setPaidRecoveryQuotes: Dispatch<SetStateAction<Readonly<Record<string, StudioPaidRecoveryQuoteSummaryV2>>>>;
  setPaidRecoveryStatusMessageKeys: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  beginReviewedAction: BeginReviewedAction;
  finishReviewedAction: FinishReviewedAction;
  refreshProposalAuthority: () => Promise<StudioProposalAuthoritySnapshot | null>;
  setActionErrorMessageKey: (messageKey: string | null) => void;
};

export const useStudioProposalCardActions = ({
  decideProposalFromCard,
  paidRecoveryQuotes,
  paidRecoveryStatusMessageKeys,
  setPaidRecoveryQuotes,
  setPaidRecoveryStatusMessageKeys,
  beginReviewedAction,
  finishReviewedAction,
  refreshProposalAuthority,
  setActionErrorMessageKey,
}: StudioProposalCardActionsInput) => {
  const acceptProposalFromCard = useCallback(
    async (proposalId: string): Promise<void> => {
      await decideProposalFromCard('accept', proposalId);
    },
    [decideProposalFromCard]
  );
  const rejectProposalFromCard = useCallback(
    async (proposalId: string): Promise<void> => {
      await decideProposalFromCard('reject', proposalId);
    },
    [decideProposalFromCard]
  );

  const paidRecoveryQuote = useCallback(
    (candidate: StudioRendererProposalV2): StudioPaidRecoveryQuoteSummaryV2 | null =>
      candidate.payload.kind === 'paid_recovery' ? (paidRecoveryQuotes[candidate.id] ?? candidate.payload.quote) : null,
    [paidRecoveryQuotes]
  );

  const paidRecoveryStatusMessageKey = useCallback(
    (candidate: StudioRendererProposalV2): string | null => paidRecoveryStatusMessageKeys[candidate.id] ?? null,
    [paidRecoveryStatusMessageKeys]
  );

  const actOnPaidRecoveryProposal = useCallback(
    async (proposalId: string): Promise<void> => {
      const token = beginReviewedAction({ kind: 'proposal', id: proposalId });
      if (token === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      setActionErrorMessageKey(null);
      try {
        const authority = await refreshProposalAuthority();
        if (authority === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.authorityUnavailable');
          return;
        }
        const target = authority.catalog.proposals.find(
          (candidate) =>
            candidate.id === proposalId && candidate.status === 'pending' && candidate.payload.kind === 'paid_recovery'
        );
        if (
          target === undefined ||
          target.payload.kind !== 'paid_recovery' ||
          target.review.status !== 'ready' ||
          target.baseRevision !== authority.project.revision
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatProposalNotFound');
          return;
        }
        const currentQuote = paidRecoveryQuotes[target.id] ?? target.payload.quote;
        const refreshQuote = async (): Promise<void> => {
          const refreshed = await ipcBridge.creativeStudio.preparePaidRecoveryProposal.invoke({
            projectId: authority.project.id,
            proposalId: target.id,
          });
          if (refreshed.ok === false) {
            setActionErrorMessageKey(refreshed.error.messageKey);
            await refreshProposalAuthority();
            return;
          }
          if (refreshed.data.projectRevision !== target.baseRevision) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.authorityUnavailable');
            await refreshProposalAuthority();
            return;
          }
          setPaidRecoveryQuotes((current) => ({ ...current, [target.id]: refreshed.data }));
          setPaidRecoveryStatusMessageKeys((current) => ({
            ...current,
            [target.id]: 'conversation.creativeStudio.workspace.proposals.paidRecovery.refreshed',
          }));
        };
        if (Date.parse(currentQuote.expiresAt) <= Date.now()) {
          await refreshQuote();
          return;
        }
        const result = await ipcBridge.creativeStudio.confirmPaidRecoveryProposal.invoke({
          projectId: authority.project.id,
          proposalId: target.id,
          quoteId: currentQuote.quoteId,
          expectedRevision: target.baseRevision,
        });
        if (result.ok === false) {
          if (result.error.code === 'quote_not_found') {
            await refreshQuote();
            return;
          }
          setActionErrorMessageKey(result.error.messageKey);
          await refreshProposalAuthority();
          return;
        }
        setPaidRecoveryQuotes((current) => {
          const next = { ...current };
          delete next[target.id];
          return next;
        });
        setPaidRecoveryStatusMessageKeys((current) => {
          const next = { ...current };
          delete next[target.id];
          return next;
        });
        await refreshProposalAuthority();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        await refreshProposalAuthority();
      } finally {
        finishReviewedAction(token);
      }
    },
    [beginReviewedAction, finishReviewedAction, paidRecoveryQuotes, refreshProposalAuthority, setActionErrorMessageKey]
  );

  return {
    acceptProposalFromCard,
    rejectProposalFromCard,
    paidRecoveryQuote,
    paidRecoveryStatusMessageKey,
    actOnPaidRecoveryProposal,
  };
};

type StudioReferenceRequestReviewInput = {
  project: StudioRendererProjectV2 | null;
  projectId: string;
  beginReviewedAction: BeginReviewedAction;
  finishReviewedAction: FinishReviewedAction;
  refetchReferences: () => Promise<void>;
  reviewHandoff: (handoff: StudioRendererReferenceGenerationHandoffV2, ownedActionToken?: number) => void;
  setActionErrorMessageKey: (messageKey: string | null) => void;
};

export const useStudioReferenceRequestReview = ({
  project,
  projectId,
  beginReviewedAction,
  finishReviewedAction,
  refetchReferences,
  reviewHandoff,
  setActionErrorMessageKey,
}: StudioReferenceRequestReviewInput) => {
  const decideReferences = useCallback(
    async (requestId: string, outcome: StudioReferenceDecisionIntent): Promise<void> => {
      if (project === null) return;
      const token = beginReviewedAction({ kind: 'reference_request', id: requestId });
      if (token === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.decideReferenceRequest.invoke({
          projectId,
          requestId,
          expectedRevision: project.revision,
          outcome,
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return;
        }
        if (result.data.outcome.kind === 'generation_gate') {
          reviewHandoff(
            {
              handoffId: result.data.outcome.handoffId,
              requestId: result.data.requestId,
              referenceIds: [...result.data.outcome.referenceIds],
              decidedAt: result.data.decidedAt,
              status: 'awaiting_spend',
              counts: { queued: 0, running: 0, succeeded: 0, failed: 0 },
              resultAssetIds: [],
              failedReferenceIds: [],
              completedAt: null,
            },
            token
          );
        }
        await refetchReferences();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        finishReviewedAction(token);
      }
    },
    [
      beginReviewedAction,
      finishReviewedAction,
      project,
      projectId,
      refetchReferences,
      reviewHandoff,
      setActionErrorMessageKey,
    ]
  );

  return decideReferences;
};

type StudioGeneratedReferenceReviewInput = {
  reviewedActionRef: ReadonlyValueRef<StudioReviewedActionLatch | null>;
  projectRef: ReadonlyValueRef<StudioRendererProjectV2 | null>;
  openReferenceFocus: (focus: { referenceIds?: readonly string[]; assetIds?: readonly string[] }) => void;
  setActionErrorMessageKey: (messageKey: string | null) => void;
};

export const useStudioGeneratedReferenceReview = ({
  reviewedActionRef,
  projectRef,
  openReferenceFocus,
  setActionErrorMessageKey,
}: StudioGeneratedReferenceReviewInput) => {
  const reviewGeneratedReferences = useCallback(
    (handoff: StudioRendererReferenceGenerationHandoffV2): void => {
      if (reviewedActionRef.current !== null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      const current = projectRef.current;
      if (
        current === null ||
        (handoff.status !== 'succeeded' && handoff.status !== 'partially_failed' && handoff.status !== 'failed')
      ) {
        return;
      }
      const referenceIds = handoff.referenceIds.filter((referenceId) => {
        const reference = Object.hasOwn(current.references, referenceId) ? current.references[referenceId] : undefined;
        return reference?.id === referenceId;
      });
      const generatedAssetIds = handoff.resultAssetIds.filter((assetId) =>
        referenceIds.some((referenceId) => {
          const reference = current.references[referenceId];
          return reference?.approvedAssetId === assetId || reference?.supersededAssetIds.includes(assetId);
        })
      );
      openReferenceFocus({ referenceIds, assetIds: generatedAssetIds });
    },
    [openReferenceFocus, setActionErrorMessageKey]
  );

  return reviewGeneratedReferences;
};

type StudioHandoffDismissalInput = {
  projectRef: ReadonlyValueRef<StudioRendererProjectV2 | null>;
  beginReviewedAction: BeginReviewedAction;
  finishReviewedAction: FinishReviewedAction;
  refetchReferences: () => Promise<void>;
  setActionErrorMessageKey: (messageKey: string | null) => void;
};

export const useStudioHandoffDismissal = ({
  projectRef,
  beginReviewedAction,
  finishReviewedAction,
  refetchReferences,
  setActionErrorMessageKey,
}: StudioHandoffDismissalInput) => {
  const dismissHandoff = useCallback(
    async (handoff: StudioRendererReferenceGenerationHandoffV2): Promise<void> => {
      const current = projectRef.current;
      if (current === null) return;
      const token = beginReviewedAction({ kind: 'handoff', id: handoff.handoffId });
      if (token === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.dismissReferenceGenerationHandoff.invoke({
          projectId: current.id,
          expectedRevision: current.revision,
          handoffId: handoff.handoffId,
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return;
        }
        await refetchReferences();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        finishReviewedAction(token);
      }
    },
    [beginReviewedAction, finishReviewedAction, refetchReferences, setActionErrorMessageKey]
  );

  return dismissHandoff;
};
