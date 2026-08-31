/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pickDefaultRoutes } from '@/common/types/project/creativeStudioDefaultRoutes';
import { planStudioConnections } from '@/common/types/project/creativeStudioConnectionPlan';
import { exactStudioProjectStatusV2 } from '@/common/types/project/creativeStudioProjectSummary';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_DIRTY_DRAFTS_REPORTED,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  type StudioBriefRuleDraft,
  type StudioPaidRecoveryQuoteSummaryV2,
  type StudioRendererAuthoringOperationV2,
  type StudioRendererExportCatalogV2,
  type StudioRendererProjectV2,
  type StudioRendererProposalCatalogV2,
  type StudioRendererProposalV2,
  type StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { StudioLibrary } from '../components/Library';
import { DirectorProposals, type DirectorProposalsProps } from '../components/Shell/DirectorProposals';
import type { DirectorProposalChatIntent } from '../components/Workspace/DirectorRail';
import { createStudioDirectorToolOutcomeInterpreter } from '../components/Workspace/DirectorRail/turnRecap';
import {
  SpendGateModal,
  hasGenerationAffectingWorkspaceDrafts,
  buildStudioBarStats,
  countStoredStudioRuleDrafts,
  countStoredWorkspaceDrafts,
  projectWorkspace,
  useWorkspaceDrafts,
  WorkspaceControls,
  WorkspaceProjectMenu,
  WorkspaceShell,
  type StudioReferenceFocusIntent,
  type StudioShotEditFocusIntent,
  type WorkspaceMutationCallbacks,
  type WorkspaceProjection,
  type WorkspaceReviewedOutput,
  type WorkspaceDirectorDraftRequest,
  type WorkspaceShellHandle,
} from '../components/Workspace';
import { generationCapabilityIsCurrent } from '../components/Workspace/Gate/generationBlockers';
import { useStudioProject } from '../hooks/useStudioProject';
import { StudioPlaybackAudioProvider } from '../hooks/useStudioPlaybackAudio';
import { StudioShotAudioAnalysisProvider } from '../hooks/useStudioShotAudioAnalysis';
import {
  parseStudioView,
  rememberStudioView,
  resolveStudioEntryView,
  studioProjectPath,
  studioViewReadiness,
  studioViewPath,
  type StudioViewReadiness,
  type StudioView,
} from '../studioPhaseRoute';
import styles from '../StudioPage.module.css';
import { projectDraftValues, useStudioDraftCommandCoordinator } from './draftCommands';
import { useStudioMediaViewAdapters } from './mediaViewAdapters';
import { useStudioProjectCommandRunners, useStudioWorkspaceExclusiveCommand } from './projectCommands';
import { useStudioReferenceJobRecovery, useStudioReferenceViewAdapter } from './referenceViewAdapter';
import {
  useStudioContinuitySpendReview,
  useStudioFailedReferenceSpendReview,
  useStudioHandoffSpendReview,
  useStudioSpendOrchestration,
} from './spendOrchestration';

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

type StudioCloseContract = {
  dirtyDraftCount: number;
  saveAll: () => Promise<boolean>;
};

const StudioCloseResponse: React.FC<{ resolve: () => StudioCloseContract }> = ({ resolve }) => {
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => {
    const disposeHasUnsavedWork = ipcBridge.creativeStudio.hasUnsavedWork.provider(() => ({
      dirtyDraftCount: Math.min(resolveRef.current().dirtyDraftCount, STUDIO_MAX_DIRTY_DRAFTS_REPORTED),
    }));
    const disposeFlushUnsavedWork = ipcBridge.creativeStudio.flushUnsavedWork.provider(async () => ({
      saved: await resolveRef.current().saveAll(),
    }));
    return () => {
      disposeHasUnsavedWork();
      disposeFlushUnsavedWork();
    };
  }, []);
  return null;
};

const hasAdoptedRuleDrafts = (project: StudioRendererProjectV2, drafts: readonly StudioBriefRuleDraft[]): boolean =>
  project.rules.length === drafts.length &&
  project.rules.every((rule, index) => {
    const draft = drafts[index];
    if (draft === undefined || rule.id !== draft.id || rule.text !== draft.text) return false;
    if (rule.predicate === null || draft.predicate === null) return rule.predicate === draft.predicate;
    return (
      rule.predicate.kind === draft.predicate.kind &&
      rule.predicate.terms.length === draft.predicate.terms.length &&
      rule.predicate.terms.every((term, termIndex) => term === draft.predicate?.terms[termIndex])
    );
  });

const containsUnavailableHardCutOperation = (operations: readonly StudioRendererAuthoringOperationV2[]): boolean =>
  operations.some((operation) => operation.kind === 'set_hard_cut');

const boundedUniqueIds = (values: readonly string[], maximum: number): string[] =>
  [...new Set(values)].slice(0, maximum);

const StudioProjectPage: React.FC<{
  projectId: string;
  routeView: StudioView | null;
  onCloseContractChange: (contract: StudioCloseContract | null) => void;
}> = ({ projectId, routeView, onCloseContractChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    project,
    proposals,
    proposalCatalog,
    proposalRefreshing,
    referenceRequests,
    referenceGenerationHandoffs,
    workspaceStatus,
    chainStatus,
    projectStatus,
    projectStatusPending,
    routeCatalog,
    generationCapability,
    filmExportCapability,
    exportCatalog,
    loadState,
    errorMessageKey,
    proposalErrorMessageKey,
    referenceErrorMessageKey,
    workspaceErrorMessageKey,
    routeErrorMessageKey,
    refetchProjectWorkspace,
    refetchProposals,
    refetchReferences,
    refetchRoutes,
    refetchExports,
    installExportCatalog,
  } = useStudioProject(projectId);
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
  const [pendingReferenceId, setPendingReferenceId] = useState<string | null>(null);
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
  const [actionErrorMessageKey, setActionErrorMessageKeyState] = useState<string | null>(null);
  const actionErrorGenerationRef = useRef(0);
  const ruleAdoptionErrorGenerationsRef = useRef(new Map<string, number>());
  const setActionErrorMessageKey = useCallback((messageKey: string | null): void => {
    actionErrorGenerationRef.current += 1;
    setActionErrorMessageKeyState(messageKey);
  }, []);
  const reportRuleAdoptionUnconfirmed = useCallback(
    (adoptionKey: string): void => {
      setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      ruleAdoptionErrorGenerationsRef.current.set(adoptionKey, actionErrorGenerationRef.current);
    },
    [setActionErrorMessageKey]
  );
  const acknowledgeRuleAdoption = useCallback(
    (adoptionKey: string): void => {
      const generation = ruleAdoptionErrorGenerationsRef.current.get(adoptionKey);
      ruleAdoptionErrorGenerationsRef.current.delete(adoptionKey);
      if (generation !== undefined && generation === actionErrorGenerationRef.current) setActionErrorMessageKey(null);
    },
    [setActionErrorMessageKey]
  );
  const [workspacePending, setWorkspacePending] = useState(false);
  const [ruleDraftDirtyCount, setRuleDraftDirtyCount] = useState(0);
  const [activeRuleDraftDirtyCount, setActiveRuleDraftDirtyCount] = useState(0);
  const [briefDialogRequest, setBriefDialogRequest] = useState(0);
  const [directorDraftRequest, setDirectorDraftRequest] = useState<WorkspaceDirectorDraftRequest | null>(null);
  const directorDraftRequestSequenceRef = useRef(0);
  const [briefRouteFocusRole, setBriefRouteFocusRole] = useState<'image' | 'video' | null>(null);
  const [referenceFocusIntent, setReferenceFocusIntent] = useState<StudioReferenceFocusIntent | null>(null);
  const [shotEditFocusIntent, setShotEditFocusIntent] = useState<StudioShotEditFocusIntent | null>(null);
  const [pendingRejoinReview, setPendingRejoinReview] = useState<{
    projectId: string;
    projectRevision: number;
    shotId: string;
  } | null>(null);
  const referenceFocusSequenceRef = useRef(0);
  const shotEditFocusSequenceRef = useRef(0);
  const inactiveWorkspaceDraftDirtyCount = countStoredWorkspaceDrafts(projectId);
  const workspaceShellRef = useRef<WorkspaceShellHandle | null>(null);
  const directorToolOutcomeInterpreter = useMemo(
    () =>
      createStudioDirectorToolOutcomeInterpreter(
        projectId,
        project?.revision ?? null,
        proposalRefreshing || proposalErrorMessageKey !== null ? null : proposalCatalog
      ),
    [project?.revision, projectId, proposalCatalog, proposalErrorMessageKey, proposalRefreshing]
  );
  const workspacePendingRef = useRef(false);
  const projectRef = useRef<StudioRendererProjectV2 | null>(project);
  projectRef.current = project;
  const exportCatalogRef = useRef<StudioRendererExportCatalogV2 | null>(exportCatalog);
  exportCatalogRef.current = exportCatalog;
  const activeView = routeView;
  const exactProjectStatus = useMemo(
    () => (project === null ? null : exactStudioProjectStatusV2(projectStatus, project.id, project.revision)),
    [project, projectStatus]
  );
  const currentViewReadiness = useMemo(
    () => (exactProjectStatus === null ? null : studioViewReadiness(exactProjectStatus)),
    [exactProjectStatus]
  );
  const lastTrustedViewReadinessRef = useRef<StudioViewReadiness | null>(null);
  useEffect(() => {
    if (currentViewReadiness !== null) lastTrustedViewReadinessRef.current = currentViewReadiness;
  }, [currentViewReadiness]);
  const viewReadiness = currentViewReadiness ?? (projectStatusPending ? lastTrustedViewReadinessRef.current : null);
  const explicitViewChoiceRef = useRef(routeView !== null);
  const autoNavigationRef = useRef<{ view: StudioView | null } | null>(null);

  const chooseStudioView = useCallback(
    (view: StudioView): void => {
      explicitViewChoiceRef.current = true;
      autoNavigationRef.current = null;
      rememberStudioView(projectId, view);
      navigate(studioViewPath(projectId, view));
    },
    [navigate, projectId]
  );

  const projection = useMemo(
    () => (project === null ? null : projectWorkspace(project, workspaceStatus, chainStatus)),
    [chainStatus, project, workspaceStatus]
  );
  const projectionRef = useRef<WorkspaceProjection | null>(projection);
  projectionRef.current = projection;
  const currentGenerationCapability =
    project !== null && generationCapabilityIsCurrent(project, generationCapability) ? generationCapability : null;
  const canonicalDraftValues = useMemo(() => (project === null ? {} : projectDraftValues(project)), [project]);
  const drafts = useWorkspaceDrafts({
    projectId,
    projectRevision: project?.revision ?? 1,
    canonicalValues: canonicalDraftValues,
    activeBeatIds: projection?.activeBeatIds ?? [],
    activeShotIds: projection?.activeShotIds ?? [],
    enabled: project !== null,
  });
  const proposalDraftAuthorityRef = useRef({ workspaceDirtyCount: 0, activeRuleDirtyCount: 0 });
  proposalDraftAuthorityRef.current = {
    workspaceDirtyCount: drafts.dirtyCount,
    activeRuleDirtyCount: activeRuleDraftDirtyCount,
  };
  const generationDraftsBlockReview =
    drafts.staleRevision || activeRuleDraftDirtyCount > 0 || hasGenerationAffectingWorkspaceDrafts(drafts.dirtyKeys);

  useEffect(() => {
    if (routeView === null) return;
    if (autoNavigationRef.current?.view === routeView) {
      autoNavigationRef.current = null;
      return;
    }
    autoNavigationRef.current = null;
    explicitViewChoiceRef.current = true;
    rememberStudioView(projectId, routeView);
  }, [projectId, routeView]);

  useEffect(() => {
    if (project === null || currentViewReadiness === null || explicitViewChoiceRef.current) return;
    const nextView = resolveStudioEntryView(projectId, currentViewReadiness);
    if (nextView === routeView) return;
    autoNavigationRef.current = { view: nextView };
    navigate(nextView === null ? studioProjectPath(projectId) : studioViewPath(projectId, nextView), {
      replace: true,
    });
  }, [currentViewReadiness, navigate, project, projectId, routeView]);

  useEffect(() => {
    setReferenceFocusIntent(null);
    setPendingRejoinReview(null);
    setDirectorDraftRequest(null);
  }, [projectId]);

  useEffect(() => {
    setShotEditFocusIntent(null);
  }, [activeView, projectId]);

  const openReferenceFocus = useCallback(
    (focus: { referenceIds?: readonly string[]; assetIds?: readonly string[]; shotIds?: readonly string[] }): void => {
      const current = projectRef.current;
      if (current === null) return;
      const referenceIds = boundedUniqueIds(focus.referenceIds ?? [], STUDIO_MAX_PROJECT_REFERENCES);
      const assetIds = boundedUniqueIds(focus.assetIds ?? [], STUDIO_MAX_PROJECT_REFERENCES);
      const shotIds = boundedUniqueIds(focus.shotIds ?? [], STUDIO_MAX_SHOTS_PER_PROJECT);
      if (referenceIds.length === 0 && assetIds.length === 0 && shotIds.length === 0) return;
      referenceFocusSequenceRef.current += 1;
      setReferenceFocusIntent({
        id: `${current.id}:${referenceFocusSequenceRef.current}`,
        projectId: current.id,
        referenceIds,
        assetIds,
        shotIds,
      });
      chooseStudioView(
        shotIds.length > 0 && referenceIds.length === 0 && assetIds.length === 0 ? 'table' : 'references'
      );
    },
    [chooseStudioView]
  );
  const consumeReferenceFocusIntent = useCallback((intentId: string): void => {
    setReferenceFocusIntent((current) => (current?.id === intentId ? null : current));
  }, []);

  const openProposalShotEditor = useCallback(
    (beatId: string, requestedShotIds: readonly string[]): void => {
      const current = projectRef.current;
      const currentProjection = projectionRef.current;
      if (
        current === null ||
        currentProjection === null ||
        currentProjection.projectId !== current.id ||
        requestedShotIds.length === 0 ||
        new Set(requestedShotIds).size !== requestedShotIds.length
      ) {
        return;
      }
      const shotIds = boundedUniqueIds(requestedShotIds, STUDIO_MAX_SHOTS_PER_PROJECT);
      const beat = currentProjection.activeBeats.find((candidate) => candidate.id === beatId);
      if (
        beat === undefined ||
        shotIds.length !== requestedShotIds.length ||
        !shotIds.every((shotId) => beat.shots.some((shot) => shot.id === shotId))
      ) {
        return;
      }
      const targetView = activeView ?? 'table';
      shotEditFocusSequenceRef.current += 1;
      setShotEditFocusIntent({
        id: `${current.id}:shot-edit:${shotEditFocusSequenceRef.current}`,
        projectId: current.id,
        view: targetView,
        beatId,
        shotIds,
      });
      if (activeView === null) chooseStudioView(targetView);
    },
    [activeView, chooseStudioView]
  );
  const consumeShotEditFocusIntent = useCallback((intentId: string): void => {
    setShotEditFocusIntent((current) => (current?.id === intentId ? null : current));
  }, []);

  const {
    spendGate,
    spendGateLocked,
    editSpendGateRoutes,
    renderFilm,
    statusBlocksReview,
    beatPanelReviewBlockedMessageKey,
    handoffReviewBlockedMessageKey,
    beatPanelReviewGraphs,
    openBoardSpendGate,
  } = useStudioSpendOrchestration({
    project,
    projection,
    routeCatalog,
    currentGenerationCapability,
    generationDraftsBlockReview,
    projectRef,
    workspacePendingRef,
    setWorkspacePending,
    setActionErrorMessageKey,
    setBriefRouteFocusRole,
    setBriefDialogRequest,
    refetchProjectWorkspace,
    refetchReferences,
    refetchRoutes,
  });
  const { runJobRecovery, runWorkspaceCommit, runWorkspaceCommitAtRevision } = useStudioProjectCommandRunners({
    projectRef,
    workspacePendingRef,
    setWorkspacePending,
    setActionErrorMessageKey,
    refetchProjectWorkspace,
  });

  const runReferenceJobRecovery = useStudioReferenceJobRecovery({
    projectRef,
    workspacePendingRef,
    pendingReferenceId,
    setPendingReferenceId,
    spendGateLocked,
    runJobRecovery,
    refetchReferences,
  });

  /**
   * A project is created with both route ids null, so a finished script would otherwise meet a
   * Render button that does nothing until someone finds the Brief form. Bind one route of each kind
   * the first time this project has both a record and a catalogue.
   *
   * Once per project per session: if the commit fails we do not retry, because a loop that rewrites
   * on every render is worse than a project the user binds by hand.
   */
  /**
   * A Studio route needs a connection binding, not just a configured provider, and until one exists
   * the catalogue is empty — so the effect below has nothing to bind and a finished script has
   * nothing to render with. The only way through was a visit to Settings, which the product should
   * not require of someone who has already configured a provider.
   *
   * Each attempt is a live validation probe, so the plan is budgeted and we stop as soon as a kind
   * is satisfied. Runs once per session, and never reconsiders a binding someone chose.
   */
  const provisionedConnectionsRef = useRef(false);
  useEffect(() => {
    if (routeCatalog === null || provisionedConnectionsRef.current) return;
    // Same reason: the pass ends in a set_routes, so it must not race the attach either.
    if (project === null || project.briefConversationId == null) return;
    if (routeCatalog.image.options.length > 0 || routeCatalog.video.options.length > 0) return;
    provisionedConnectionsRef.current = true;
    void (async () => {
      try {
        await provisionStudioConnections();
      } catch {
        // Provisioning is a convenience over a catalogue that may not exist yet. A failure leaves
        // the user exactly where they were — binding a model in Settings — and must never take the
        // workspace down with it. Swallowed deliberately, but not silently inside the loop below:
        // everything that can fail is inside this one boundary.
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
      }
    })();

    async function provisionStudioConnections(): Promise<void> {
      const [candidates, inventory] = await Promise.all([
        ipcBridge.creativeStudio.listConnectionCandidates.invoke(),
        ipcBridge.creativeStudio.listConnections.invoke(),
      ]);
      if (candidates.ok === false || inventory.ok === false) return;
      const plan = planStudioConnections({
        candidates: candidates.data,
        integrations: inventory.data.integrations,
        existing: inventory.data.connections,
      });
      const satisfied = new Set<string>();
      for (const attempt of plan) {
        if (satisfied.has(attempt.kind)) continue;
        const request = {
          providerId: attempt.providerId,
          integrationId: attempt.integrationId,
          model: attempt.model,
        };
        const validation = await ipcBridge.creativeStudio.validateConnection.invoke(request);
        if (validation.ok === false) continue;
        const saved = await ipcBridge.creativeStudio.saveConnection.invoke(request);
        if (saved.ok) satisfied.add(attempt.kind);
      }
      // Refresh the shared catalogue, not just our own read. Without this the workspace keeps its
      // pre-provisioning snapshot, a bound route resolves to nothing, and the Brief reports a
      // working route as "Unavailable" until the user finds Refresh routes for themselves.
      await refetchRoutes();
      if (!satisfied.has('video')) {
        // Partial success is the dangerous case: seed stills render, the film never can, and
        // without this the user only finds out at the gate as "the estimate could not be
        // prepared" — with nothing naming the route.
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.videoRouteBlocked');
      }
      if (satisfied.size === 0) return;
      // Bind from a freshly read catalogue rather than waiting for the shared one to refresh, so a
      // project is generable on the same pass that made it possible.
      const current = projectRef.current;
      if (current === null) return;
      const refreshed = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: current.id });
      if (refreshed.ok === false) return;
      const picked = pickDefaultRoutes([...refreshed.data.image.options, ...refreshed.data.video.options]);
      if (picked.imageRouteId === null && picked.videoRouteId === null) return;
      await runWorkspaceCommit((project) =>
        ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
          projectId: project.id,
          expectedRevision: project.revision,
          operations: [{ kind: 'set_routes', imageRouteId: picked.imageRouteId, videoRouteId: picked.videoRouteId }],
        })
      );
    }
  }, [project, refetchRoutes, routeCatalog, runWorkspaceCommit, setActionErrorMessageKey]);

  const autoBoundProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (project === null || routeCatalog === null) return;
    // Never write while the Director is binding: its bind carries an expected revision, and a
    // set_routes landing in between fails it as "the project changed elsewhere".
    if (project.briefConversationId == null) return;
    if (project.imageRouteId !== null || project.videoRouteId !== null) return;
    if (autoBoundProjectRef.current === project.id) return;
    autoBoundProjectRef.current = project.id;
    void (async () => {
      // Read the catalogue fresh rather than trusting the workspace's snapshot. The snapshot can
      // predate a connection saved moments earlier, and binding from it silently drops a whole kind
      // — which is how a project ended up with an image route and no video one.
      const current = projectRef.current;
      if (current === null) return;
      const refreshed = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: current.id });
      if (refreshed.ok === false) return;
      const picked = pickDefaultRoutes([...refreshed.data.image.options, ...refreshed.data.video.options]);
      if (picked.imageRouteId === null && picked.videoRouteId === null) return;
      await runWorkspaceCommit((project) =>
        ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
          projectId: project.id,
          expectedRevision: project.revision,
          operations: [{ kind: 'set_routes', imageRouteId: picked.imageRouteId, videoRouteId: picked.videoRouteId }],
        })
      );
      // And refresh the shared catalogue, or the Brief reports the route it just bound as
      // "Unavailable" until the user finds Refresh routes for themselves.
      await refetchRoutes();
    })();
  }, [project, refetchRoutes, routeCatalog, runWorkspaceCommit]);

  const runWorkspaceExclusive = useStudioWorkspaceExclusiveCommand({
    workspacePendingRef,
    setWorkspacePending,
    setActionErrorMessageKey,
  });

  const mutations = useMemo<WorkspaceMutationCallbacks>(
    () => ({
      editProject: async (changes, authority) => {
        if (authority === undefined) {
          return runWorkspaceCommit((current) =>
            ipcBridge.creativeStudio.editProject.invoke({
              projectId: current.id,
              expectedRevision: current.revision,
              changes,
            })
          );
        }
        const current = projectRef.current;
        if (current === null || current.id !== authority.projectId || current.revision !== authority.expectedRevision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.draftConflict');
          return false;
        }
        return (
          (await runWorkspaceCommitAtRevision(authority.expectedRevision, (expected) =>
            ipcBridge.creativeStudio.editProject.invoke({
              projectId: expected.id,
              expectedRevision: expected.revision,
              changes,
            })
          )) !== null
        );
      },
      applyAuthoring: async (operations) => {
        if (containsUnavailableHardCutOperation(operations)) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.beatPanel.chain.hardCutUnavailable');
          return false;
        }
        return runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations,
          })
        );
      },
      saveFilmSetup: async ({ projectId, expectedRevision, projectChanges, authoringOperations }) => {
        const failed = { projectSettingsSaved: false, authoringSaved: false };
        const startingProject = projectRef.current;
        if (
          startingProject === null ||
          startingProject.id !== projectId ||
          startingProject.revision !== expectedRevision ||
          workspacePendingRef.current
        ) {
          return failed;
        }

        workspacePendingRef.current = true;
        setWorkspacePending(true);
        setActionErrorMessageKey(null);
        let authority = startingProject;
        let projectSettingsSaved = projectChanges === null;
        try {
          if (projectChanges !== null) {
            const result = await ipcBridge.creativeStudio.editProject.invoke({
              projectId,
              expectedRevision,
              changes: projectChanges,
            });
            if (result.ok === false) {
              setActionErrorMessageKey(result.error.messageKey);
              return failed;
            }
            const refreshed = await refetchProjectWorkspace();
            if (
              refreshed === null ||
              refreshed.id !== projectId ||
              refreshed.revision !== result.data.projectRevision ||
              refreshed.revision <= expectedRevision ||
              (projectChanges.aspectRatio !== undefined && refreshed.aspectRatio !== projectChanges.aspectRatio) ||
              (projectChanges.resolution !== undefined && refreshed.resolution !== projectChanges.resolution)
            ) {
              setActionErrorMessageKey(
                refreshed?.id === projectId && refreshed.revision > result.data.projectRevision
                  ? 'conversation.creativeStudio.workspace.controls.draftConflict'
                  : 'conversation.creativeStudio.workspace.errors.storage'
              );
              return failed;
            }
            projectRef.current = refreshed;
            authority = refreshed;
            projectSettingsSaved = true;
          }

          if (authoringOperations.length === 0) {
            return { projectSettingsSaved, authoringSaved: true };
          }
          const current = projectRef.current;
          if (current === null || current.id !== authority.id || current.revision !== authority.revision) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.draftConflict');
            return { projectSettingsSaved, authoringSaved: false };
          }
          const result = await ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: authoringOperations,
          });
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return { projectSettingsSaved, authoringSaved: false };
          }
          const refreshed = await refetchProjectWorkspace();
          if (
            refreshed === null ||
            refreshed.id !== current.id ||
            refreshed.revision !== result.data.projectRevision ||
            refreshed.revision <= current.revision ||
            authoringOperations.some((operation) => {
              switch (operation.kind) {
                case 'set_brief':
                  return refreshed.brief !== operation.brief;
                case 'set_routes':
                  return (
                    refreshed.imageRouteId !== operation.imageRouteId ||
                    refreshed.videoRouteId !== operation.videoRouteId
                  );
                case 'set_spend_policy':
                  return JSON.stringify(refreshed.spendPolicy) !== JSON.stringify(operation.policy);
              }
            })
          ) {
            setActionErrorMessageKey(
              refreshed?.id === current.id && refreshed.revision > result.data.projectRevision
                ? 'conversation.creativeStudio.workspace.controls.draftConflict'
                : 'conversation.creativeStudio.workspace.errors.storage'
            );
            return { projectSettingsSaved, authoringSaved: false };
          }
          projectRef.current = refreshed;
          return { projectSettingsSaved, authoringSaved: true };
        } catch {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return { projectSettingsSaved, authoringSaved: false };
        } finally {
          workspacePendingRef.current = false;
          setWorkspacePending(false);
        }
      },
      setRules: async (update, adoptionKey) =>
        (await runWorkspaceExclusive(async () => {
          ruleAdoptionErrorGenerationsRef.current.delete(adoptionKey);
          const current = projectRef.current;
          if (current === null) return false;
          const rules = update(current.rules);
          if (rules === null) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.draftConflict');
            return false;
          }
          if (hasAdoptedRuleDrafts(current, rules)) return true;
          let result: Awaited<ReturnType<typeof ipcBridge.creativeStudio.setRules.invoke>>;
          try {
            result = await ipcBridge.creativeStudio.setRules.invoke({
              projectId: current.id,
              expectedRevision: current.revision,
              rules,
            });
          } catch {
            reportRuleAdoptionUnconfirmed(adoptionKey);
            return false;
          }
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return false;
          }
          let refreshed: StudioRendererProjectV2 | null;
          try {
            refreshed = await refetchProjectWorkspace();
          } catch {
            reportRuleAdoptionUnconfirmed(adoptionKey);
            return false;
          }
          if (
            refreshed === null ||
            refreshed.id !== current.id ||
            refreshed.revision !== result.data.projectRevision ||
            !hasAdoptedRuleDrafts(refreshed, rules)
          ) {
            reportRuleAdoptionUnconfirmed(adoptionKey);
            return false;
          }
          projectRef.current = refreshed;
          if (projectRef.current?.id !== current.id || projectRef.current.revision !== result.data.projectRevision) {
            reportRuleAdoptionUnconfirmed(adoptionKey);
            return false;
          }
          return true;
        })) ?? false,
      acknowledgeRuleAdoption,
      refreshRoutes: refetchRoutes,
      undo: async (entryId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.undoLast.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            entryId,
          })
        ),
      retryConditioning: async (dependentShotId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.retryConditioningFrame.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            dependentShotId,
          })
        ),
      cancelWaiting: async (dependentShotId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.cancelWaitingCascade.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            dependentShotId,
          })
        ),
    }),
    [
      acknowledgeRuleAdoption,
      refetchProjectWorkspace,
      refetchRoutes,
      reportRuleAdoptionUnconfirmed,
      runWorkspaceCommit,
      runWorkspaceCommitAtRevision,
      runWorkspaceExclusive,
      setActionErrorMessageKey,
    ]
  );

  const focusDirectorForReviewedRequest = useCallback(
    (_beatId: string): void => {
      const revealed = workspaceShellRef.current?.revealDirector({ projectId, view: activeView }) ?? false;
      if (!revealed) return;
      directorDraftRequestSequenceRef.current += 1;
      setDirectorDraftRequest({
        requestId: directorDraftRequestSequenceRef.current,
        projectId,
        prompt: t('conversation.creativeStudio.workspace.beatPanel.directorRequestHint'),
      });
      setActionErrorMessageKey(null);
    },
    [activeView, projectId, setActionErrorMessageKey, t]
  );

  const openContinuityReview = useStudioContinuitySpendReview({
    projectRef,
    projectionRef,
    workspacePendingRef,
    beatPanelReviewBlockedMessageKey,
    spendGateLocked,
    currentGenerationCapability,
    routeCatalog,
    setActionErrorMessageKey,
    spendGateOpen: spendGate.open,
  });
  const cancelAndQueueRejoinReview = useCallback(
    async (shotId: string): Promise<boolean> => {
      const current = projectRef.current;
      const currentProjection = projectionRef.current;
      if (
        current === null ||
        currentProjection === null ||
        current.id !== currentProjection.projectId ||
        current.revision !== currentProjection.projectRevision ||
        beatPanelReviewBlockedMessageKey !== null ||
        spendGateLocked ||
        workspacePendingRef.current
      ) {
        if (beatPanelReviewBlockedMessageKey !== null) setActionErrorMessageKey(beatPanelReviewBlockedMessageKey);
        return false;
      }
      const matches = currentProjection.activeBeats.flatMap((beat) =>
        beat.shots.flatMap((shot, shotIndex) => (shot.id === shotId ? [{ shot, shotIndex }] : []))
      );
      const cascadeRows = currentProjection.cascadeProgress.filter((row) => row.dependentShotId === shotId);
      const match = matches.length === 1 ? matches[0]! : null;
      const cascade = cascadeRows.length === 1 ? cascadeRows[0]! : null;
      if (
        match === null ||
        match.shotIndex === 0 ||
        match.shot.chainBreak !== 'hard_cut' ||
        match.shot.seedAuthorizationLock?.waitingReason !== 'choose_seed' ||
        match.shot.seedAuthorizationLock.canCancelWaiting !== true ||
        cascade?.upstreamShotId !== shotId ||
        cascade.waitingReason !== 'choose_seed' ||
        cascade.canCancelWaiting !== true
      ) {
        return false;
      }

      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      let cancellationCommitted = false;
      try {
        const result = await ipcBridge.creativeStudio.cancelWaitingCascade.invoke({
          projectId: current.id,
          expectedRevision: current.revision,
          dependentShotId: shotId,
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return false;
        }
        cancellationCommitted = true;
        const refreshed = await refetchProjectWorkspace();
        if (
          refreshed === null ||
          refreshed.id !== current.id ||
          refreshed.revision !== result.data.projectRevision ||
          refreshed.revision <= current.revision
        ) {
          setActionErrorMessageKey(
            'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinUnconfirmed'
          );
          return false;
        }
        projectRef.current = refreshed;
        if (!(await refetchRoutes())) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
          return false;
        }
        setPendingRejoinReview({
          projectId: refreshed.id,
          projectRevision: refreshed.revision,
          shotId,
        });
        return true;
      } catch {
        setActionErrorMessageKey(
          cancellationCommitted
            ? 'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinUnconfirmed'
            : 'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinOutcomeUnknown'
        );
        return false;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [
      beatPanelReviewBlockedMessageKey,
      refetchProjectWorkspace,
      refetchRoutes,
      setActionErrorMessageKey,
      spendGateLocked,
    ]
  );

  useEffect(() => {
    if (pendingRejoinReview === null || workspacePending) return;
    if (
      project === null ||
      projection === null ||
      project.id !== pendingRejoinReview.projectId ||
      projection.projectId !== pendingRejoinReview.projectId
    ) {
      setPendingRejoinReview(null);
      return;
    }
    if (
      project.revision < pendingRejoinReview.projectRevision ||
      projection.projectRevision < pendingRejoinReview.projectRevision ||
      !projection.workspaceStatusReady ||
      !projection.chainStatusReady ||
      currentGenerationCapability === null ||
      !generationCapabilityIsCurrent(project, currentGenerationCapability)
    ) {
      return;
    }
    const terminalRows = projection.cascadeProgress.filter(
      (row) =>
        row.dependentShotId === pendingRejoinReview.shotId &&
        row.upstreamShotId === pendingRejoinReview.shotId &&
        row.waitingReason === 'cancelled'
    );
    const shotMatches = projection.activeBeats.flatMap((beat) =>
      beat.shots.filter((shot) => shot.id === pendingRejoinReview.shotId && shot.chainBreak === 'hard_cut')
    );
    setPendingRejoinReview(null);
    if (
      project.revision !== pendingRejoinReview.projectRevision ||
      projection.projectRevision !== pendingRejoinReview.projectRevision ||
      terminalRows.length !== 1 ||
      shotMatches.length !== 1
    ) {
      setActionErrorMessageKey(
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinUnconfirmed'
      );
      return;
    }
    openContinuityReview(pendingRejoinReview.shotId, false);
  }, [
    currentGenerationCapability,
    openContinuityReview,
    pendingRejoinReview,
    project,
    projection,
    setActionErrorMessageKey,
    workspacePending,
  ]);

  const { beatPanelActions, boardActions, cutActions } = useStudioMediaViewAdapters({
    projectRef,
    projectionRef,
    workspacePendingRef,
    setWorkspacePending,
    setActionErrorMessageKey,
    refetchProjectWorkspace,
    refetchRoutes,
    runWorkspaceCommit,
    runJobRecovery,
    runWorkspaceExclusive,
    mutations,
    beatPanelReviewBlockedMessageKey,
    spendGateLocked,
    spendGateOpen: spendGate.open,
    currentGenerationCapability,
    routeCatalog,
    projection,
    generationDraftsBlockReview,
    openContinuityReview,
    openReferenceFocus,
    focusDirectorForReviewedRequest,
    cancelAndQueueRejoinReview,
    navigate,
    setBriefRouteFocusRole,
    setBriefDialogRequest,
    openBoardSpendGate,
  });

  const createEditorFolder = useCallback(async (): Promise<
    { ok: true; catalog: StudioRendererExportCatalogV2 } | { ok: false; messageKey: string }
  > => {
    const completed = await runWorkspaceExclusive(async () => {
      const current = projectRef.current;
      const catalog = exportCatalogRef.current;
      if (current === null || catalog === null) {
        return {
          ok: false as const,
          messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.catalogUnavailable',
        };
      }
      const result = await ipcBridge.creativeStudio.createExport.invoke({
        projectId: current.id,
        expectedRevision: current.revision,
        expectedCatalogRevision: catalog.revision,
        shape: 'editor_folder',
      });
      if (result.ok === false) {
        const messageKey =
          result.error.code === 'stale_project'
            ? 'conversation.creativeStudio.workspace.editorFolderExport.errors.staleAuthority'
            : result.error.code === 'stale_export_catalog'
              ? 'conversation.creativeStudio.workspace.editorFolderExport.errors.staleCatalog'
              : result.error.code === 'invalid_payload'
                ? 'conversation.creativeStudio.workspace.editorFolderExport.errors.invalidMedia'
                : result.error.code === 'storage_error'
                  ? 'conversation.creativeStudio.workspace.editorFolderExport.errors.mediaUnavailable'
                  : result.error.code === 'busy'
                    ? 'conversation.creativeStudio.workspace.editorFolderExport.errors.busy'
                    : result.error.messageKey;
        return { ok: false as const, messageKey };
      }
      installExportCatalog(result.data);
      return { ok: true as const, catalog: result.data };
    });
    return (
      completed ?? {
        ok: false,
        messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.busy',
      }
    );
  }, [installExportCatalog, runWorkspaceExclusive]);

  const revealEditorFolder = useCallback(
    async (artifactId: string): Promise<{ ok: true } | { ok: false; messageKey: string }> => {
      const completed = await runWorkspaceExclusive(async () => {
        const current = projectRef.current;
        const catalog = exportCatalogRef.current;
        if (
          current === null ||
          catalog === null ||
          catalog.artifacts.filter((artifact) => artifact.id === artifactId && artifact.shape === 'editor_folder')
            .length !== 1
        ) {
          return {
            ok: false as const,
            messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.artifactUnavailable',
          };
        }
        const result = await ipcBridge.creativeStudio.revealExport.invoke({
          projectId: current.id,
          expectedCatalogRevision: catalog.revision,
          artifactId,
        });
        if (result.ok === false) return { ok: false as const, messageKey: result.error.messageKey };
        return { ok: true as const };
      });
      return (
        completed ?? {
          ok: false,
          messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.busy',
        }
      );
    },
    [runWorkspaceExclusive]
  );

  const createFilm = useCallback(
    async (input: {
      renderId: string;
      transition: { kind: 'cut' } | { kind: 'dissolve'; seconds: number };
      trimTails: boolean;
    }): Promise<{ ok: true; catalog: StudioRendererExportCatalogV2 } | { ok: false; messageKey: string }> => {
      const completed = await runWorkspaceExclusive(async () => {
        const current = projectRef.current;
        const catalog = exportCatalogRef.current;
        if (current === null || catalog === null) {
          return {
            ok: false as const,
            messageKey: 'conversation.creativeStudio.workspace.filmExport.errors.catalogUnavailable',
          };
        }
        const result = await ipcBridge.creativeStudio.createExport.invoke({
          projectId: current.id,
          expectedRevision: current.revision,
          expectedCatalogRevision: catalog.revision,
          shape: 'film',
          ...input,
        });
        if (result.ok === false) {
          const messageKey =
            result.error.code === 'stale_project'
              ? 'conversation.creativeStudio.workspace.filmExport.errors.staleAuthority'
              : result.error.code === 'stale_export_catalog'
                ? 'conversation.creativeStudio.workspace.filmExport.errors.staleCatalog'
                : result.error.code === 'ffmpeg_unavailable' || result.error.code === 'unsupported_capabilities'
                  ? 'conversation.creativeStudio.workspace.filmExport.errors.unavailable'
                  : result.error.code === 'render_failed' || result.error.code === 'storage_error'
                    ? 'conversation.creativeStudio.workspace.filmExport.errors.renderFailed'
                    : result.error.code === 'cancelled'
                      ? 'conversation.creativeStudio.workspace.filmExport.errors.cancelled'
                      : result.error.code === 'invalid_payload'
                        ? 'conversation.creativeStudio.workspace.filmExport.errors.invalidMedia'
                        : result.error.code === 'busy'
                          ? 'conversation.creativeStudio.workspace.filmExport.errors.busy'
                          : result.error.messageKey;
          return { ok: false as const, messageKey };
        }
        installExportCatalog(result.data);
        return { ok: true as const, catalog: result.data };
      });
      return (
        completed ?? {
          ok: false,
          messageKey: 'conversation.creativeStudio.workspace.filmExport.errors.busy',
        }
      );
    },
    [installExportCatalog, runWorkspaceExclusive]
  );

  const getFilmExportStatus = useCallback(async () => {
    try {
      const result = await ipcBridge.creativeStudio.getFilmExportStatus.invoke({ projectId });
      if (!result.ok) return null;
      if (result.data.status === 'terminal' && result.data.result.projectId !== projectId) return null;
      return result.data;
    } catch {
      return null;
    }
  }, [projectId]);

  const cancelFilmExport = useCallback(
    async (renderId: string): Promise<boolean> => {
      try {
        const result = await ipcBridge.creativeStudio.cancelFilmExport.invoke({ projectId, renderId });
        return result.ok && result.data.status === 'cancelled';
      } catch {
        return false;
      }
    },
    [projectId]
  );

  const acknowledgeFilmExport = useCallback(
    async (renderId: string): Promise<'acknowledged' | 'not_found' | null> => {
      try {
        const result = await ipcBridge.creativeStudio.acknowledgeFilmExport.invoke({ projectId, renderId });
        return result.ok ? result.data.status : null;
      } catch {
        return null;
      }
    },
    [projectId]
  );

  const revealFilm = useCallback(
    async (artifactId: string): Promise<{ ok: true } | { ok: false; messageKey: string }> => {
      const completed = await runWorkspaceExclusive(async () => {
        const current = projectRef.current;
        const catalog = exportCatalogRef.current;
        if (
          current === null ||
          catalog === null ||
          catalog.artifacts.filter((artifact) => artifact.id === artifactId && artifact.shape === 'film').length !== 1
        ) {
          return {
            ok: false as const,
            messageKey: 'conversation.creativeStudio.workspace.filmExport.errors.artifactUnavailable',
          };
        }
        const result = await ipcBridge.creativeStudio.revealExport.invoke({
          projectId: current.id,
          expectedCatalogRevision: catalog.revision,
          artifactId,
        });
        if (result.ok === false) return { ok: false as const, messageKey: result.error.messageKey };
        return { ok: true as const };
      });
      return (
        completed ?? {
          ok: false,
          messageKey: 'conversation.creativeStudio.workspace.filmExport.errors.busy',
        }
      );
    },
    [runWorkspaceExclusive]
  );

  const referenceActions = useStudioReferenceViewAdapter({
    projectId,
    projectRef,
    workspacePendingRef,
    pendingReferenceId,
    setPendingReferenceId,
    setWorkspacePending,
    setActionErrorMessageKey,
    runWorkspaceCommit,
    runJobRecovery,
    runReferenceJobRecovery,
    refetchProjectWorkspace,
    chooseStudioView,
    currentGenerationCapability,
    routeCatalog,
    generationDraftsBlockReview,
    referenceRequests,
    referenceGenerationHandoffs,
    spendGateOpen: spendGate.open,
    spendGateLocked,
  });

  const { saveAllDrafts, flushAllWorkspaceDrafts, closeDirtyDraftCount } = useStudioDraftCommandCoordinator({
    drafts,
    requestShapeLocked: projection?.requestShapeLocked,
    projectRef,
    workspacePendingRef,
    runWorkspaceCommitAtRevision,
    ruleDraftDirtyCount,
    inactiveWorkspaceDraftDirtyCount,
  });

  useLayoutEffect(() => {
    if (project === null) {
      onCloseContractChange(null);
      return;
    }
    onCloseContractChange({ dirtyDraftCount: closeDirtyDraftCount, saveAll: flushAllWorkspaceDrafts });
    return () => onCloseContractChange(null);
  }, [closeDirtyDraftCount, flushAllWorkspaceDrafts, onCloseContractChange, project]);

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

  const reviewRuleDrafts = useCallback((): void => {
    setBriefDialogRequest((request) => request + 1);
  }, []);

  const consumeDirectorDraftRequest = useCallback((requestId: number): void => {
    setDirectorDraftRequest((current) => (current?.requestId === requestId ? null : current));
  }, []);

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

  const reviewHandoff = useStudioHandoffSpendReview({
    reviewedActionRef,
    projectRef,
    generationDraftsBlockReview,
    statusBlocksReview,
    projection,
    routeCatalog,
    currentGenerationCapability,
    setActionErrorMessageKey,
    spendGateOpen: spendGate.open,
  });
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

  const reviewShotBinding = useCallback(
    (shotId: string): void => {
      const current = projectRef.current;
      const currentProjection = projectionRef.current;
      if (
        current === null ||
        currentProjection === null ||
        currentProjection.projectId !== current.id ||
        currentProjection.projectRevision !== current.revision ||
        !currentProjection.activeShotIds.includes(shotId) ||
        !Object.hasOwn(current.shots, shotId) ||
        current.shots[shotId]?.id !== shotId
      ) {
        return;
      }
      openReferenceFocus({ shotIds: [shotId] });
    },
    [openReferenceFocus]
  );

  const retryFailedReferences = useStudioFailedReferenceSpendReview({
    projectRef,
    reviewedActionRef,
    workspacePendingRef,
    generationDraftsBlockReview,
    spendGateLocked,
    routeCatalog,
    currentGenerationCapability,
    setActionErrorMessageKey,
    spendGateOpen: spendGate.open,
  });
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

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className={styles.centered}>
        <Spin tip={t('conversation.creativeStudio.workspace.project.loading')} />
      </div>
    );
  }

  if (loadState === 'unsupported') {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.workspace.project.unsupportedPrototype')}</p>
        <Link to='/studio'>{t('conversation.creativeStudio.workspace.project.backToLibrary')}</Link>
      </div>
    );
  }

  if (loadState === 'not_found') {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.workspace.project.notFound')}</p>
        <Link to='/studio'>{t('conversation.creativeStudio.workspace.project.backToLibrary')}</Link>
      </div>
    );
  }

  if (project === null) {
    return (
      <div className={styles.centered}>
        <p role='alert'>{t(errorMessageKey ?? 'conversation.creativeStudio.workspace.errors.storage')}</p>
        <Link to='/studio'>{t('conversation.creativeStudio.workspace.project.backToLibrary')}</Link>
      </div>
    );
  }

  const directorReviewCard = (
    cardProposals: DirectorProposalsProps['proposals'],
    cardReferenceRequests: DirectorProposalsProps['referenceRequests'],
    cardHandoffs: DirectorProposalsProps['referenceGenerationHandoffs'],
    cardProposalErrorMessageKey: string | null = null,
    cardReferenceErrorMessageKey: string | null = null
  ): React.ReactNode => (
    <DirectorProposals
      project={project}
      proposals={cardProposals}
      referenceRequests={cardReferenceRequests}
      referenceGenerationHandoffs={cardHandoffs}
      pendingAction={pendingReviewedAction}
      actionsLocked={reviewedActionLocked}
      proposalAuthorityState={proposalAuthorityState}
      proposalAuthorityVerified={proposalAuthorityVerified}
      proposalDraftBlocker={proposalDraftBlocker}
      proposalErrorMessageKey={cardProposalErrorMessageKey}
      referenceErrorMessageKey={cardReferenceErrorMessageKey}
      onAcceptProposal={acceptProposalFromCard}
      onRejectProposal={rejectProposalFromCard}
      paidRecoveryQuote={paidRecoveryQuote}
      paidRecoveryStatusMessageKey={paidRecoveryStatusMessageKey}
      onPaidRecoveryAction={actOnPaidRecoveryProposal}
      onRequestUpdatedProposal={requestUpdatedProposal}
      onReviewRuleDrafts={reviewRuleDrafts}
      onEditProposalShots={openProposalShotEditor}
      onGenerateReferences={(requestId) => decideReferences(requestId, { kind: 'generation_gate' })}
      onRejectReferences={(requestId) => decideReferences(requestId, { kind: 'rejected' })}
      onReviewHandoff={reviewHandoff}
      onReviewReferences={reviewGeneratedReferences}
      onRetryFailedReferences={retryFailedReferences}
      onDismissHandoff={dismissHandoff}
      gateLocked={spendGateLocked}
      reviewBlockedMessageKey={handoffReviewBlockedMessageKey}
    />
  );
  const proposalInbox = directorReviewCard(proposals, [], [], proposalErrorMessageKey);
  const reviewedDirectorOutputs: WorkspaceReviewedOutput[] = [
    ...referenceRequests.map((request) => ({
      id: `reference-request-${request.id}`,
      createdAt: Date.parse(request.createdAt),
      content: directorReviewCard([], [request], []),
    })),
    ...referenceGenerationHandoffs.map((handoff) => ({
      id: `reference-handoff-${handoff.handoffId}`,
      createdAt: Date.parse(handoff.decidedAt),
      content: directorReviewCard([], [], [handoff]),
    })),
    ...(referenceErrorMessageKey === null
      ? []
      : [
          {
            id: 'reference-error',
            createdAt: Date.parse(project.updatedAt),
            content: directorReviewCard([], [], [], null, referenceErrorMessageKey),
          },
        ]),
  ];

  return (
    <>
      <WorkspaceShell
        ref={workspaceShellRef}
        project={project}
        directorToolOutcomeInterpreter={directorToolOutcomeInterpreter}
        onDirectorProposalIntent={decideProposalFromDirectorChat}
        directorDraftRequest={directorDraftRequest}
        onDirectorDraftRequestConsumed={consumeDirectorDraftRequest}
        proposalInbox={proposalInbox}
        activeView={activeView}
        viewReadiness={viewReadiness}
        projectStatusPending={projectStatusPending}
        onChooseView={chooseStudioView}
        stats={projection === null || projectStatusPending ? undefined : buildStudioBarStats(projection, projectStatus)}
        renderAction={
          <Button type='primary' disabled={workspacePending || spendGateLocked} onClick={renderFilm}>
            {t('conversation.creativeStudio.workspace.controls.renderFilm')}
          </Button>
        }
        renamePending={workspacePending}
        onRenameProject={(name, authority) => mutations.editProject({ name }, authority)}
        projectMenu={
          projection === null ? undefined : (
            <WorkspaceProjectMenu
              project={project}
              projection={projection}
              routeCatalog={routeCatalog}
              generationCapability={currentGenerationCapability}
              exportCatalog={exportCatalog}
              filmExportCapability={filmExportCapability}
              createEditorFolder={createEditorFolder}
              revealEditorFolder={revealEditorFolder}
              createFilm={createFilm}
              getFilmExportStatus={getFilmExportStatus}
              refreshExports={refetchExports}
              cancelFilmExport={cancelFilmExport}
              acknowledgeFilmExport={acknowledgeFilmExport}
              revealFilm={revealFilm}
              detachBedAudio={cutActions.detachBedAudio}
              drafts={drafts}
              pending={workspacePending}
              errorMessageKey={actionErrorMessageKey ?? workspaceErrorMessageKey ?? routeErrorMessageKey}
              mutations={mutations}
              briefDialogRequest={briefDialogRequest}
              briefRouteFocusRole={briefRouteFocusRole}
              onRuleDraftDirtyCountChange={setRuleDraftDirtyCount}
              onActiveRuleDraftDirtyCountChange={setActiveRuleDraftDirtyCount}
            />
          )
        }
        notice={
          activeView === 'references' ||
          (actionErrorMessageKey === null && workspaceErrorMessageKey === null && routeErrorMessageKey === null)
            ? undefined
            : t(actionErrorMessageKey ?? workspaceErrorMessageKey ?? routeErrorMessageKey!)
        }
        reviewedOutputs={reviewedDirectorOutputs}
      >
        {projection === null || activeView === null ? null : (
          <StudioPlaybackAudioProvider projectId={project.id}>
            <StudioShotAudioAnalysisProvider
              projectId={project.id}
              projectRevision={project.revision}
              shots={projection.activeBeats.flatMap((beat) =>
                beat.shots.flatMap((shot) =>
                  shot.currentPicture === null ? [] : [{ shotId: shot.id, assetId: shot.currentPicture.assetId }]
                )
              )}
            >
              <WorkspaceControls
                activeView={activeView}
                boardActions={boardActions}
                cutActions={cutActions}
                project={project}
                projectStatus={projectStatus}
                projectStatusPending={projectStatusPending}
                projection={projection}
                drafts={drafts}
                pending={workspacePending}
                gateLocked={spendGateLocked}
                imageRouteReady={
                  currentGenerationCapability !== null ||
                  (project.imageRouteId !== null && routeCatalog?.image.status === 'ready')
                }
                errorMessageKey={actionErrorMessageKey ?? workspaceErrorMessageKey ?? routeErrorMessageKey}
                mutations={mutations}
                beatPanelActions={beatPanelActions}
                beatPanelReviewGraphs={beatPanelReviewGraphs}
                beatPanelReviewBlockedMessageKey={beatPanelReviewBlockedMessageKey}
                referenceActions={referenceActions}
                referenceMaxConditioningImages={
                  routeCatalog?.image.selectedRoute?.constraints.maxConditioningImages ?? null
                }
                referencePendingId={pendingReferenceId}
                referenceErrorMessageKey={
                  activeView === 'references'
                    ? (actionErrorMessageKey ?? workspaceErrorMessageKey ?? routeErrorMessageKey)
                    : null
                }
                referenceFocusIntent={referenceFocusIntent}
                onReferenceFocusIntentConsumed={consumeReferenceFocusIntent}
                shotEditFocusIntent={shotEditFocusIntent}
                onShotEditFocusIntentConsumed={consumeShotEditFocusIntent}
                onReviewShotReferenceBinding={reviewShotBinding}
              />
            </StudioShotAudioAnalysisProvider>
          </StudioPlaybackAudioProvider>
        )}
      </WorkspaceShell>
      <SpendGateModal
        state={spendGate.state}
        close={spendGate.close}
        promoteOnly={spendGate.promoteOnly}
        prepare={spendGate.prepare}
        selectOption={spendGate.selectOption}
        confirm={spendGate.confirm}
        onEditRoutes={editSpendGateRoutes}
        onReviewShotBinding={reviewShotBinding}
        projectReferences={project.referenceOrder.flatMap((referenceId) => {
          const reference = Object.hasOwn(project.references, referenceId)
            ? project.references[referenceId]
            : undefined;
          return reference?.id === referenceId
            ? [{ id: reference.id, kind: reference.kind, label: reference.label }]
            : [];
        })}
      />
    </>
  );
};

const StudioPage: React.FC = () => {
  const { id, view } = useParams<{ id?: string; view?: string }>();
  const routeView = parseStudioView(view);
  const projectCloseContractRef = useRef<StudioCloseContract | null>(null);
  const updateProjectCloseContract = useCallback((contract: StudioCloseContract | null): void => {
    projectCloseContractRef.current = contract;
  }, []);
  const resolveCloseContract = useCallback(
    (): StudioCloseContract =>
      projectCloseContractRef.current ?? {
        dirtyDraftCount: countStoredStudioRuleDrafts() + countStoredWorkspaceDrafts(),
        saveAll: async () => countStoredStudioRuleDrafts() + countStoredWorkspaceDrafts() === 0,
      },
    []
  );
  return (
    <>
      <StudioCloseResponse resolve={resolveCloseContract} />
      <div className={`${styles.page} ${id ? styles.pageProject : ''}`} data-studio-workspace>
        {id && view !== undefined && routeView === null ? (
          <Navigate replace to={studioProjectPath(id)} />
        ) : id ? (
          <StudioProjectPage
            key={id}
            projectId={id}
            routeView={routeView}
            onCloseContractChange={updateProjectCloseContract}
          />
        ) : (
          <StudioLibrary />
        )}
      </div>
    </>
  );
};

export default StudioPage;
