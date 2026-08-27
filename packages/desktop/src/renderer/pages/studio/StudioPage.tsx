/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pickDefaultRoutes } from '@/common/types/project/creativeStudioDefaultRoutes';
import { planStudioConnections } from '@/common/types/project/creativeStudioConnectionPlan';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_DIRTY_DRAFTS_REPORTED,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_MUTATION_OPERATIONS,
  type StudioBinItem,
  type StudioBriefRuleDraft,
  type StudioCommandResult,
  type StudioGenerationBlockV2,
  type StudioGenerationCapabilityItemV2,
  type StudioRendererAuthoringOperationV2,
  type StudioRendererExportCatalogV2,
  type StudioRendererJobV2,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererProjectV2,
  type StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { StudioLibrary } from './components/Library';
import { DirectorProposals, type DirectorProposalsProps } from './components/Shell/DirectorProposals';
import type { DirectorProposalChatIntent } from './components/Workspace/DirectorRail';
import {
  SpendGateModal,
  boardGateDraft,
  boardPromotionGatePlan,
  boardSelectionGateDraft,
  continuityGateDraft,
  hasGenerationAffectingWorkspaceDrafts,
  handoffGateDraft,
  majorUnitsToMinorUnits,
  buildStudioBarStats,
  countStoredStudioRuleDrafts,
  countStoredWorkspaceDrafts,
  projectWorkspace,
  filmRenderBatchShotIds,
  seedRegenerationGateDraft,
  selectionGateDraft,
  spendGateDraftIdentity,
  spendGateRouteIssue,
  useSpendGate,
  useWorkspaceDrafts,
  WorkspaceControls,
  WorkspaceProjectMenu,
  WorkspaceShell,
  type BeatPanelActions,
  type BeatPanelImportResult,
  type BeatPanelReviewGraph,
  type BoardActions,
  type CutActions,
  type CutImportResult,
  type ReferencesViewActions,
  type StudioReferenceFocusIntent,
  type SpendGateDraft,
  type SpendGateBoardPromotion,
  type SpendGateRouteIssue,
  type TableBoardActions,
  type TableReferenceBindingActions,
  type WorkspaceDraftValue,
  type WorkspaceMutationCallbacks,
  type WorkspaceProjection,
  type WorkspaceReviewedOutput,
  type WorkspaceShellHandle,
} from './components/Workspace';
import {
  generationBlockForItem,
  generationBlockGroupsForItems,
  generationCapabilityIsCurrent,
} from './components/Workspace/Gate/generationBlockers';
import { useStudioProject } from './hooks/useStudioProject';
import {
  hasOpenedStudioReferences,
  markStudioReferencesOpened,
  parseStudioView,
  readLastStudioView,
  rememberStudioView,
  resolveStudioEntryView,
  studioViewPath,
  type StudioView,
} from './studioPhaseRoute';
import styles from './StudioPage.module.css';

type StudioReferenceDecisionIntent = { kind: 'rejected' } | { kind: 'generation_gate' };

const shotCapabilityItemsForDraft = (draft: SpendGateDraft): StudioGenerationCapabilityItemV2[] =>
  'baseChoices' in draft
    ? [...draft.baseChoices, ...draft.cascadeChoices].flatMap((choice) =>
        choice.target.kind === 'shot'
          ? [
              {
                target: { kind: 'shot' as const, shotId: choice.target.shotId },
                purpose: choice.purpose,
              },
            ]
          : []
      )
    : [];

const referenceCapabilityItems = (referenceIds: readonly string[]): StudioGenerationCapabilityItemV2[] =>
  referenceIds.map((referenceId) => ({
    target: { kind: 'reference', referenceId },
    purpose: 'reference_image',
  }));

/** Mirrors Main's prospective continuity scope only to disclose capability blockers before review. */
const continuityCapabilityItemsForDraft = (
  project: StudioRendererProjectV2,
  draft: SpendGateDraft
): StudioGenerationCapabilityItemV2[] | null => {
  if (!('baseChoices' in draft) || draft.continuityChange === undefined) return null;
  const change = draft.continuityChange;
  const locations = project.beatOrder.flatMap((beatId) => {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    const shotIndex = beat?.id === beatId ? beat.shotOrder.indexOf(change.shotId) : -1;
    return beat?.id === beatId && shotIndex >= 0 ? [{ beat, shotIndex }] : [];
  });
  if (locations.length !== 1) return null;
  const { beat, shotIndex } = locations[0]!;
  const affectedShotIds: string[] = [];
  for (let index = shotIndex; index < beat.shotOrder.length; index += 1) {
    const affectedShotId = beat.shotOrder[index]!;
    const affectedShot = Object.hasOwn(project.shots, affectedShotId) ? project.shots[affectedShotId] : undefined;
    if (affectedShot?.id !== affectedShotId) return null;
    if (index > shotIndex && affectedShot.chainBreak === 'hard_cut') break;
    affectedShotIds.push(affectedShotId);
  }
  if (affectedShotIds.length === 0) return null;
  return [
    ...(change.requiresSeedGeneration
      ? [
          {
            target: { kind: 'shot' as const, shotId: change.shotId },
            purpose: 'seed_still' as const,
          },
        ]
      : []),
    ...affectedShotIds.map((shotId) => ({
      target: { kind: 'shot' as const, shotId },
      purpose: 'video_take' as const,
    })),
  ];
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

const minorUnitsDraft = (minorUnits: number): string => {
  const whole = Math.trunc(minorUnits / 100);
  return `${whole}.${String(minorUnits % 100).padStart(2, '0')}`;
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

const beatDraftKey = (beatId: string, field: 'story' | 'targetSeconds'): string => `beat.${beatId}.${field}`;

const shotDraftKey = (shotId: string, field: 'shootingScript' | 'durationSeconds'): string => `shot.${shotId}.${field}`;

const containsUnavailableHardCutOperation = (operations: readonly StudioRendererAuthoringOperationV2[]): boolean =>
  operations.some((operation) => operation.kind === 'set_hard_cut');

const cloneBinItem = (item: StudioBinItem): StudioBinItem => {
  if (item.kind === 'beat') return { kind: 'beat', beatId: item.beatId, reason: item.reason };
  return { kind: 'shot', beatId: item.beatId, shotId: item.shotId, reason: 'lifted' };
};

const boundedUniqueIds = (values: readonly string[], maximum: number): string[] =>
  [...new Set(values)].slice(0, maximum);

const BOARD_STOP_JOB_STATUSES: ReadonlySet<StudioRendererJobV2['status']> = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);
const BOARD_DRAW_PANEL_ACTIVITIES = new Set(['idle', 'failed', 'cancelled']);

type BoardStopCandidate = { shotId: string; jobId: string };

const hasExactActiveShotOwnership = (project: StudioRendererProjectV2, shotId: string): boolean => {
  let activeOwnerships = 0;
  for (const beatId of project.beatOrder) {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    if (beat?.id === beatId) activeOwnerships += beat.shotOrder.filter((candidateId) => candidateId === shotId).length;
  }
  return activeOwnerships === 1;
};

const exactLatestCancellableBoardJob = (
  project: StudioRendererProjectV2,
  candidate: BoardStopCandidate
): StudioRendererJobV2 | null => {
  const shot = Object.hasOwn(project.shots, candidate.shotId) ? project.shots[candidate.shotId] : undefined;
  if (shot?.id !== candidate.shotId) return null;
  if (
    !hasExactActiveShotOwnership(project, shot.id) ||
    shot.jobIds.filter((jobId) => jobId === candidate.jobId).length !== 1
  ) {
    return null;
  }
  const boardJobs = shot.jobIds.flatMap((jobId) => {
    const job = Object.hasOwn(project.jobs, jobId) ? project.jobs[jobId] : undefined;
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.purpose === 'board_still'
      ? [job]
      : [];
  });
  const job = boardJobs.at(-1);
  return job?.id === candidate.jobId && job.canCancel && BOARD_STOP_JOB_STATUSES.has(job.status) ? job : null;
};

const projectDraftValues = (project: StudioRendererProjectV2): Record<string, WorkspaceDraftValue> => {
  const values: Record<string, WorkspaceDraftValue> = {
    'settings.name': project.name,
    'settings.targetDurationSeconds': project.targetDurationSeconds,
    'settings.aspectRatio': project.aspectRatio,
    'settings.resolution': project.resolution,
    'brief.text': project.brief,
    'brief.imageRouteId': project.imageRouteId ?? '',
    'brief.videoRouteId': project.videoRouteId ?? '',
    'brief.spendCurrency': project.spendPolicy?.currency ?? '',
    'brief.spendMajorUnits':
      project.spendPolicy === null ? '' : minorUnitsDraft(project.spendPolicy.maxPerBatchMinorUnits),
    'gate.choices': '{}',
  };
  for (const beatId of project.beatOrder) {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    if (beat?.id !== beatId) continue;
    values[beatDraftKey(beatId, 'story')] = beat.story;
    values[beatDraftKey(beatId, 'targetSeconds')] = beat.targetSeconds;
    for (const shotId of beat.shotOrder) {
      const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
      if (shot?.id !== shotId) continue;
      values[shotDraftKey(shotId, 'shootingScript')] = shot.shootingScript;
      values[shotDraftKey(shotId, 'durationSeconds')] = shot.durationSeconds;
    }
  }
  return values;
};

const StudioProjectPage: React.FC<{
  projectId: string;
  routeView: StudioView | null;
  routeViewWasSpecified: boolean;
  onCloseContractChange: (contract: StudioCloseContract | null) => void;
}> = ({ projectId, routeView, routeViewWasSpecified, onCloseContractChange }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    project,
    proposals,
    referenceRequests,
    referenceGenerationHandoffs,
    workspaceStatus,
    chainStatus,
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
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const pendingActionIdRef = useRef<string | null>(null);
  const beginPendingAction = useCallback((actionId: string): boolean => {
    if (pendingActionIdRef.current !== null) return false;
    pendingActionIdRef.current = actionId;
    setPendingActionId(actionId);
    return true;
  }, []);
  const finishPendingAction = useCallback((actionId: string): void => {
    if (pendingActionIdRef.current !== actionId) return;
    pendingActionIdRef.current = null;
    setPendingActionId(null);
  }, []);
  const [pendingReferenceId, setPendingReferenceId] = useState<string | null>(null);
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
  const [briefRouteFocusRole, setBriefRouteFocusRole] = useState<'image' | 'video' | null>(null);
  const [referenceFocusIntent, setReferenceFocusIntent] = useState<StudioReferenceFocusIntent | null>(null);
  const [pendingRejoinReview, setPendingRejoinReview] = useState<{
    projectId: string;
    projectRevision: number;
    shotId: string;
  } | null>(null);
  const referenceFocusSequenceRef = useRef(0);
  const referencesAutoOpenedRef = useRef<string | null>(null);
  const inactiveWorkspaceDraftDirtyCount = countStoredWorkspaceDrafts(projectId);
  const workspaceShellRef = useRef<WorkspaceShellHandle | null>(null);
  const workspacePendingRef = useRef(false);
  const projectRef = useRef<StudioRendererProjectV2 | null>(project);
  projectRef.current = project;
  const exportCatalogRef = useRef<StudioRendererExportCatalogV2 | null>(exportCatalog);
  exportCatalogRef.current = exportCatalog;
  const activeView =
    routeView ?? resolveStudioEntryView(projectId, undefined, (project?.referenceOrder.length ?? 0) > 0);

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
  const generationDraftsBlockReview =
    drafts.staleRevision || activeRuleDraftDirtyCount > 0 || hasGenerationAffectingWorkspaceDrafts(drafts.dirtyKeys);

  useEffect(() => {
    if (
      project !== null &&
      project.referenceOrder.length > 0 &&
      referencesAutoOpenedRef.current !== projectId &&
      !hasOpenedStudioReferences(projectId)
    ) {
      referencesAutoOpenedRef.current = projectId;
      markStudioReferencesOpened(projectId);
      if (routeView !== 'references') {
        navigate(studioViewPath(projectId, 'references'), { replace: true });
        return;
      }
    }
    if (routeView !== null) {
      rememberStudioView(projectId, routeView);
      return;
    }
    if (
      project !== null &&
      (routeViewWasSpecified || project.referenceOrder.length > 0 || readLastStudioView(projectId) !== null)
    ) {
      navigate(studioViewPath(projectId, activeView), { replace: true });
    }
  }, [activeView, navigate, project, projectId, routeView, routeViewWasSpecified]);

  useEffect(() => {
    setReferenceFocusIntent(null);
    setPendingRejoinReview(null);
  }, [projectId]);

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
      navigate(
        studioViewPath(
          current.id,
          shotIds.length > 0 && referenceIds.length === 0 && assetIds.length === 0 ? 'table' : 'references'
        )
      );
    },
    [navigate]
  );
  const consumeReferenceFocusIntent = useCallback((intentId: string): void => {
    setReferenceFocusIntent((current) => (current?.id === intentId ? null : current));
  }, []);

  const afterPaidConfirm = useCallback(async (): Promise<void> => {
    const [refreshed] = await Promise.all([refetchProjectWorkspace(), refetchReferences()]);
    if (refreshed !== null) projectRef.current = refreshed;
  }, [refetchProjectWorkspace, refetchReferences]);
  const promoteBoardPanelOnly = useCallback(
    async (input: {
      projectId: string;
      expectedRevision: number;
      promotion: SpendGateBoardPromotion;
    }): Promise<boolean> => {
      const current = projectRef.current;
      if (
        current === null ||
        projection === null ||
        workspacePendingRef.current ||
        generationDraftsBlockReview ||
        current.id !== input.projectId ||
        current.revision !== input.expectedRevision ||
        projection.projectId !== current.id ||
        projection.projectRevision !== current.revision
      ) {
        return false;
      }
      const plan = boardPromotionGatePlan({
        project: current,
        projection,
        shotId: input.promotion.shotId,
        boardAssetId: input.promotion.boardAssetId,
      });
      const originalShot = Object.hasOwn(current.shots, input.promotion.shotId)
        ? current.shots[input.promotion.shotId]
        : undefined;
      if (
        plan === null ||
        originalShot?.id !== input.promotion.shotId ||
        plan.draft.projectId !== input.projectId ||
        plan.draft.expectedRevision !== input.expectedRevision ||
        plan.draft.boardPromotion?.shotId !== input.promotion.shotId ||
        plan.draft.boardPromotion.boardAssetId !== input.promotion.boardAssetId
      ) {
        return false;
      }
      const originalChainBreaks = new Map(
        Object.entries(current.shots).flatMap(([shotId, candidate]) =>
          candidate?.id === shotId ? [[shotId, candidate.chainBreak] as const] : []
        )
      );
      const originalCurrentTakes = new Map(
        plan.impact.currentTakeShotIds.flatMap((shotId) => {
          const candidate = Object.hasOwn(current.shots, shotId) ? current.shots[shotId] : undefined;
          return candidate?.id === shotId && candidate.videoAssetId !== null
            ? [[shotId, candidate.videoAssetId] as const]
            : [];
        })
      );
      if (originalCurrentTakes.size !== plan.impact.currentTakeShotIds.length) return false;

      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
          projectId: current.id,
          expectedRevision: current.revision,
          operations: [
            {
              kind: 'promote_board_panel',
              shotId: input.promotion.shotId,
              boardAssetId: input.promotion.boardAssetId,
            },
          ],
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return false;
        }
        const refreshed = await refetchProjectWorkspace();
        const promotedShot =
          refreshed !== null && Object.hasOwn(refreshed.shots, input.promotion.shotId)
            ? refreshed.shots[input.promotion.shotId]
            : undefined;
        if (
          refreshed === null ||
          refreshed.id !== current.id ||
          refreshed.revision <= current.revision ||
          refreshed.revision !== result.data.projectRevision ||
          promotedShot?.id !== originalShot.id ||
          promotedShot.boardAssetId !== input.promotion.boardAssetId ||
          promotedShot.seedStillId !== input.promotion.boardAssetId ||
          promotedShot.chainBreak !== originalShot.chainBreak ||
          [...originalChainBreaks].some(([shotId, chainBreak]) => {
            const candidate = Object.hasOwn(refreshed.shots, shotId) ? refreshed.shots[shotId] : undefined;
            return candidate?.id !== shotId || candidate.chainBreak !== chainBreak;
          }) ||
          [...originalCurrentTakes].some(([shotId, assetId]) => {
            const candidate = Object.hasOwn(refreshed.shots, shotId) ? refreshed.shots[shotId] : undefined;
            return candidate?.id !== shotId || candidate.videoAssetId !== assetId;
          })
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        projectRef.current = refreshed;
        return true;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return false;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [generationDraftsBlockReview, projection, refetchProjectWorkspace, setActionErrorMessageKey]
  );
  const spendGate = useSpendGate({
    onConfirmed: afterPaidConfirm,
    onPromoteOnly: promoteBoardPanelOnly,
  });
  const spendGateDisclosureRef = useRef(spendGate.state.generationDisclosure);
  spendGateDisclosureRef.current = spendGate.state.generationDisclosure;
  const spendGateIdentity = spendGate.state.draft === null ? null : spendGateDraftIdentity(spendGate.state.draft);
  useEffect(() => {
    if (spendGate.state.phase !== 'choices' || spendGateIdentity === null) return;
    void refetchRoutes();
  }, [refetchRoutes, spendGate.state.phase, spendGateIdentity]);
  useEffect(() => {
    if (spendGate.state.phase !== 'choices' || spendGateIdentity === null) return;
    const disclosure = spendGateDisclosureRef.current;
    if (disclosure === null) return;
    const items = disclosure.groups.flatMap((group) => group.items);
    const groups = generationBlockGroupsForItems(currentGenerationCapability, items);
    spendGate.updateGenerationDisclosure(
      groups.length === 0 ? undefined : { groups, blocksPrepare: disclosure.blocksPrepare }
    );
  }, [currentGenerationCapability, spendGate.state.phase, spendGate.updateGenerationDisclosure, spendGateIdentity]);
  const spendGateLocked =
    spendGate.state.phase === 'promoting' ||
    spendGate.state.phase === 'confirming' ||
    spendGate.state.phase === 'quote_in_use';
  const editSpendGateRoutes = useCallback(
    (issue: SpendGateRouteIssue): void => {
      setBriefRouteFocusRole(issue === 'image_and_video' ? null : issue);
      setBriefDialogRequest((request) => request + 1);
      void refetchRoutes();
    },
    [refetchRoutes]
  );
  /**
   * The bar's Render action. Submits the largest bounded film-order batch the chain permits. Each
   * selected frontier authorizes its exact downstream cascade, which advances unattended once the
   * segment seed is fixed; a later click is needed only for work outside the request cap or recovery.
   */
  const renderFilm = useCallback((): void => {
    const current = projectRef.current;
    if (current === null || projection === null || spendGateLocked) return;
    if (generationDraftsBlockReview) {
      setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
      return;
    }
    const candidateShotIds = filmRenderBatchShotIds({ project: current, projection });
    const blockedItems: StudioGenerationCapabilityItemV2[] = [];
    const shotIds = candidateShotIds.filter((shotId) => {
      const candidate = selectionGateDraft({ project: current, projection, orderedShotIds: [shotId] });
      if (candidate === null) return false;
      const groups = generationBlockGroupsForItems(currentGenerationCapability, shotCapabilityItemsForDraft(candidate));
      if (groups.length === 0) return true;
      blockedItems.push(...groups.flatMap((group) => group.items));
      return false;
    });
    const disclosureGroups = generationBlockGroupsForItems(currentGenerationCapability, blockedItems);
    if (shotIds.length === 0) {
      const blockedDraft = selectionGateDraft({
        project: current,
        projection,
        orderedShotIds: candidateShotIds,
      });
      if (blockedDraft !== null && disclosureGroups.length > 0) {
        setActionErrorMessageKey(null);
        spendGate.open(blockedDraft, undefined, { groups: disclosureGroups, blocksPrepare: true });
        return;
      }
      setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.renderFilmEmpty');
      return;
    }
    const draft = selectionGateDraft({ project: current, projection, orderedShotIds: shotIds });
    if (draft === null) {
      setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
      return;
    }
    setActionErrorMessageKey(null);
    spendGate.open(
      draft,
      undefined,
      disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: false }
    );
  }, [
    currentGenerationCapability,
    generationDraftsBlockReview,
    projection,
    setActionErrorMessageKey,
    spendGate.open,
    spendGateLocked,
  ]);
  const statusBlocksReview = projection === null || !projection.workspaceStatusReady || !projection.chainStatusReady;
  const beatPanelReviewBlockedMessageKey = generationDraftsBlockReview
    ? 'conversation.creativeStudio.workspace.controls.saveBeforeReview'
    : statusBlocksReview
      ? 'conversation.creativeStudio.workspace.controls.statusRequired'
      : routeCatalog === null
        ? 'conversation.creativeStudio.workspace.controls.routeCatalogRequired'
        : null;
  const handoffReviewBlockedMessageKey = generationDraftsBlockReview
    ? 'conversation.creativeStudio.workspace.controls.saveBeforeReview'
    : statusBlocksReview
      ? 'conversation.creativeStudio.workspace.controls.statusRequired'
      : routeCatalog === null
        ? 'conversation.creativeStudio.workspace.controls.routeCatalogRequired'
        : currentGenerationCapability === null && routeCatalog.image.status !== 'ready'
          ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
          : null;
  const beatPanelReviewGraphs = useMemo<BeatPanelReviewGraph[]>(() => {
    if (project === null || projection === null) return [];
    return projection.activeShotIds.flatMap((triggerShotId) => {
      const draft = selectionGateDraft({ project, projection, orderedShotIds: [triggerShotId] });
      if (draft === null) return [];
      const choices = [...draft.baseChoices, ...draft.cascadeChoices].flatMap(({ target, purpose }) =>
        target.kind === 'shot' && (purpose === 'seed_still' || purpose === 'video_take')
          ? [{ shotId: target.shotId, purpose }]
          : []
      );
      const [firstChoice, ...remainingChoices] = choices;
      if (firstChoice === undefined) return [];
      const block =
        choices.flatMap((item) => {
          const reason = generationBlockForItem(currentGenerationCapability, {
            target: { kind: 'shot', shotId: item.shotId },
            purpose: item.purpose,
          });
          return reason === null ? [] : [{ item, reason }];
        })[0] ?? null;
      return [
        {
          triggerShotId,
          choices: [firstChoice, ...remainingChoices],
          block,
        },
      ];
    });
  }, [currentGenerationCapability, project, projection]);

  const openBoardSpendGate = useCallback(
    (
      buildDraft: (current: StudioRendererProjectV2, exactProjection: WorkspaceProjection) => SpendGateDraft | null
    ): void => {
      const current = projectRef.current;
      if (
        current === null ||
        projection === null ||
        spendGateLocked ||
        workspacePendingRef.current ||
        current.id !== projection.projectId ||
        current.revision !== projection.projectRevision
      ) {
        return;
      }
      if (generationDraftsBlockReview) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
        return;
      }
      if (
        projection.boardPanels.length !== projection.activeShotIds.length ||
        projection.boardPanels.some(
          (panel) => panel.freshness === 'status_pending' || panel.activity === 'status_pending'
        )
      ) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.statusRequired');
        return;
      }
      if (routeCatalog === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
        return;
      }
      if (
        currentGenerationCapability === null &&
        (current.imageRouteId === null || routeCatalog.image.status !== 'ready')
      ) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
        return;
      }
      const draft = buildDraft(current, projection);
      if (draft === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const routeIssue = currentGenerationCapability === null ? spendGateRouteIssue(routeCatalog, draft) : null;
      if (routeIssue !== null) {
        setActionErrorMessageKey(
          routeIssue === 'image'
            ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
            : 'conversation.creativeStudio.workspace.gate.errors.routesUnavailable'
        );
        return;
      }
      const payableDraft =
        'baseChoices' in draft && draft.baseChoices.every((choice) => choice.purpose === 'board_still')
          ? {
              ...draft,
              baseChoices: draft.baseChoices.filter(
                (choice) =>
                  choice.target.kind === 'shot' &&
                  generationBlockForItem(currentGenerationCapability, {
                    target: { kind: 'shot', shotId: choice.target.shotId },
                    purpose: 'board_still',
                  }) === null
              ),
            }
          : draft;
      const disclosureGroups =
        'baseChoices' in draft && draft.baseChoices.every((choice) => choice.purpose === 'board_still')
          ? generationBlockGroupsForItems(currentGenerationCapability, shotCapabilityItemsForDraft(draft))
          : [];
      if (
        'baseChoices' in draft &&
        'baseChoices' in payableDraft &&
        draft.baseChoices.length > 0 &&
        payableDraft.baseChoices.length === 0
      ) {
        setActionErrorMessageKey(null);
        spendGate.open(draft, undefined, { groups: disclosureGroups, blocksPrepare: true });
        return;
      }
      setActionErrorMessageKey(null);
      spendGate.open(
        payableDraft,
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: false }
      );
    },
    [
      currentGenerationCapability,
      generationDraftsBlockReview,
      projection,
      routeCatalog,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
    ]
  );

  const runWorkspaceCommitAtRevision = useCallback(
    async (
      expectedRevision: number,
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>,
      onCommitted?: () => void
    ): Promise<number | null> => {
      const current = projectRef.current;
      if (current === null || current.revision !== expectedRevision || workspacePendingRef.current) return null;
      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        const result = await invoke(current);
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return null;
        }
        onCommitted?.();
        const refreshed = await refetchProjectWorkspace();
        if (refreshed === null || refreshed.revision !== result.data.projectRevision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return null;
        }
        projectRef.current = refreshed;
        if (projectRef.current?.revision !== result.data.projectRevision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return null;
        }
        return result.data.projectRevision;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return null;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [refetchProjectWorkspace, setActionErrorMessageKey]
  );

  const runWorkspaceCommit = useCallback(
    async (
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>,
      onCommitted?: () => void
    ): Promise<boolean> => {
      const expectedRevision = projectRef.current?.revision;
      return (
        expectedRevision !== undefined &&
        (await runWorkspaceCommitAtRevision(expectedRevision, invoke, onCommitted)) !== null
      );
    },
    [runWorkspaceCommitAtRevision]
  );

  const runJobRecovery = useCallback(
    async (
      jobId: string,
      isAuthorized: (job: StudioRendererJobV2, project: StudioRendererProjectV2) => boolean,
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererJobV2>>
    ): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || workspacePendingRef.current || !Object.hasOwn(current.jobs, jobId)) return false;
      const job = current.jobs[jobId];
      const ownerHasJob =
        job?.target.kind === 'shot'
          ? Object.hasOwn(current.shots, job.target.shotId) && current.shots[job.target.shotId]?.jobIds.includes(job.id)
          : job?.target.kind === 'reference'
            ? Object.hasOwn(current.references, job.target.referenceId) &&
              current.references[job.target.referenceId]?.jobIds.includes(job.id)
            : false;
      if (
        job === undefined ||
        job.id !== jobId ||
        job.projectId !== current.id ||
        !ownerHasJob ||
        !isAuthorized(job, current)
      ) {
        return false;
      }
      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        const result = await invoke(current);
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return false;
        }
        if (
          result.data.id !== job.id ||
          result.data.projectId !== current.id ||
          JSON.stringify(result.data.target) !== JSON.stringify(job.target)
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        const refreshed = await refetchProjectWorkspace();
        if (refreshed === null || refreshed.id !== current.id || refreshed.revision <= current.revision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        const refreshedJob = Object.hasOwn(refreshed.jobs, job.id) ? refreshed.jobs[job.id] : undefined;
        if (
          refreshedJob === undefined ||
          refreshedJob.id !== result.data.id ||
          refreshedJob.projectId !== current.id ||
          JSON.stringify(refreshedJob.target) !== JSON.stringify(job.target)
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        projectRef.current = refreshed;
        if (projectRef.current?.id !== refreshed.id || projectRef.current.revision !== refreshed.revision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        return true;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return false;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [refetchProjectWorkspace, setActionErrorMessageKey]
  );

  const runReferenceJobRecovery = useCallback(
    async (
      referenceId: string,
      jobId: string,
      isAuthorized: (job: StudioRendererJobV2) => boolean,
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererJobV2>>
    ): Promise<boolean> => {
      const current = projectRef.current;
      const reference =
        current !== null && Object.hasOwn(current.references, referenceId)
          ? current.references[referenceId]
          : undefined;
      if (
        current === null ||
        reference?.id !== referenceId ||
        !reference.jobIds.includes(jobId) ||
        current.referenceOrder.filter((candidateId) => candidateId === referenceId).length !== 1 ||
        pendingReferenceId !== null ||
        workspacePendingRef.current ||
        spendGateLocked
      ) {
        return false;
      }
      setPendingReferenceId(referenceId);
      try {
        const recovered = await runJobRecovery(
          jobId,
          (job, authority) => {
            const exactReference = Object.hasOwn(authority.references, referenceId)
              ? authority.references[referenceId]
              : undefined;
            return (
              exactReference?.id === referenceId &&
              exactReference.jobIds.includes(job.id) &&
              authority.referenceOrder.filter((candidateId) => candidateId === referenceId).length === 1 &&
              job.target.kind === 'reference' &&
              job.target.referenceId === referenceId &&
              job.purpose === 'reference_image' &&
              isAuthorized(job)
            );
          },
          invoke
        );
        if (recovered) await refetchReferences();
        return recovered;
      } finally {
        setPendingReferenceId((pendingId) => (pendingId === referenceId ? null : pendingId));
      }
    },
    [pendingReferenceId, refetchReferences, runJobRecovery, spendGateLocked]
  );

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

  const runWorkspaceExclusive = useCallback(
    async <Result,>(action: () => Promise<Result>): Promise<Result | null> => {
      if (workspacePendingRef.current) return null;
      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        return await action();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return null;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [setActionErrorMessageKey]
  );

  const mutations = useMemo<WorkspaceMutationCallbacks>(
    () => ({
      editProject: async (changes) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.editProject.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            changes,
          })
        ),
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
      runWorkspaceExclusive,
      setActionErrorMessageKey,
    ]
  );

  const focusDirectorForReviewedRequest = useCallback((): void => {
    const revealed = workspaceShellRef.current?.revealDirector({ projectId, view: activeView }) ?? false;
    if (!revealed) return;
    setActionErrorMessageKey('conversation.creativeStudio.workspace.beatPanel.directorRequestHint');
  }, [activeView, projectId, setActionErrorMessageKey]);

  const openContinuityReview = useCallback(
    (shotId: string, hardCut: boolean): void => {
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
        return;
      }
      const shotMatches = currentProjection.activeBeats.flatMap((beat) =>
        beat.shots.filter((shot) => shot.id === shotId)
      );
      if (shotMatches.length !== 1 || shotMatches[0]!.seedAuthorizationLock !== null) {
        setActionErrorMessageKey(
          shotMatches.length === 1
            ? 'conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked'
            : 'conversation.creativeStudio.workspace.controls.selectionNotPayable'
        );
        return;
      }
      const draft = continuityGateDraft({ project: current, projection: currentProjection, shotId, hardCut });
      if (draft === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const routeIssue =
        currentGenerationCapability !== null || routeCatalog === null ? null : spendGateRouteIssue(routeCatalog, draft);
      if (routeIssue !== null) {
        setActionErrorMessageKey(
          routeIssue === 'image'
            ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
            : routeIssue === 'video'
              ? 'conversation.creativeStudio.workspace.controls.videoRouteBlocked'
              : 'conversation.creativeStudio.workspace.gate.errors.routesUnavailable'
        );
        return;
      }
      const capabilityItems = continuityCapabilityItemsForDraft(current, draft);
      if (capabilityItems === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const disclosureGroups = generationBlockGroupsForItems(currentGenerationCapability, capabilityItems);
      setActionErrorMessageKey(null);
      spendGate.open(
        draft,
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
      );
    },
    [
      beatPanelReviewBlockedMessageKey,
      currentGenerationCapability,
      routeCatalog,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
    ]
  );

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

  const beatPanelActions = useMemo<BeatPanelActions>(
    () => ({
      saveBeat: async (beatId, changes) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'edit_beat', beatId, changes }],
          })
        ),
      saveShot: async (updates) => {
        const shotIds = new Set(updates.map(({ shotId }) => shotId));
        if (updates.length > STUDIO_MAX_MUTATION_OPERATIONS || shotIds.size !== updates.length) return false;
        return runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: updates.map(({ shotId, changes }) => ({ kind: 'edit_shot', shotId, changes })),
          })
        );
      },
      setSeedStill: async (shotId, assetId) => {
        const current = projectRef.current;
        const currentProjection = projectionRef.current;
        if (
          current === null ||
          currentProjection === null ||
          current.id !== currentProjection.projectId ||
          current.revision !== currentProjection.projectRevision ||
          !currentProjection.workspaceStatusReady
        ) {
          return false;
        }
        const matches = currentProjection.activeBeats.flatMap((beat) =>
          beat.shots.filter((shot) => shot.id === shotId)
        );
        if (matches.length !== 1) return false;
        const projectedShot = matches[0]!;
        if (!projectedShot.seedAuthorityStatusReady) return false;
        if (
          projectedShot.seedAuthorizationLock !== null &&
          (assetId === null || !projectedShot.seedAuthorizationLock.compatibleAssetIds.includes(assetId))
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked');
          return false;
        }
        return runWorkspaceCommit((authority) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: authority.id,
            expectedRevision: authority.revision,
            operations: [{ kind: 'set_seed_still', shotId, assetId }],
          })
        );
      },
      dismissSeedStill: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'dismiss_seed_still', shotId, assetId }],
          })
        ),
      selectVideoTake: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'select_video_take', shotId, assetId }],
          })
        ),
      removeVideoTake: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'remove_video_take', shotId, assetId }],
          })
        ),
      trimShot: async (shotId, trimInSeconds, trimOutSeconds) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'trim_shot', shotId, trimInSeconds, trimOutSeconds }],
          })
        ),
      reorderShots: async (beatId, shotOrder) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'reorder_shots', beatId, shotOrder: [...shotOrder] }],
          })
        ),
      importSeedStill: async (shotId): Promise<BeatPanelImportResult> => {
        const current = projectRef.current;
        if (current === null || workspacePendingRef.current) return 'failed';
        workspacePendingRef.current = true;
        setWorkspacePending(true);
        setActionErrorMessageKey(null);
        try {
          const result = await ipcBridge.creativeStudio.importSeedStill.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId,
          });
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return 'failed';
          }
          if (result.data.status === 'cancelled') return 'cancelled';
          const refreshed = await refetchProjectWorkspace();
          if (refreshed === null || refreshed.revision < result.data.projectRevision) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
            return 'failed';
          }
          projectRef.current = refreshed;
          return 'imported';
        } catch {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return 'failed';
        } finally {
          workspacePendingRef.current = false;
          setWorkspacePending(false);
        }
      },
      persistCapturedPoster: async (input) => {
        const current = projectRef.current;
        const currentProjection = projectionRef.current;
        if (
          current === null ||
          currentProjection === null ||
          current.id !== currentProjection.projectId ||
          current.revision !== currentProjection.projectRevision
        ) {
          return false;
        }
        const matches = currentProjection.activeBeats.flatMap((beat) =>
          beat.shots.filter(
            (shot) =>
              shot.id === input.shotId &&
              shot.currentPicture?.assetId === input.videoAssetId &&
              shot.currentPicture.posterAssetId === null
          )
        );
        if (matches.length !== 1) return false;
        try {
          const result = await ipcBridge.creativeStudio.persistCapturedPoster.invoke({
            projectId: current.id,
            ...input,
          });
          if (result.ok === false) return false;
          const refreshed = await refetchProjectWorkspace();
          return refreshed?.id === current.id && refreshed.revision >= current.revision;
        } catch {
          return false;
        }
      },
      parkShot: async (shotId, onCommitted) =>
        runWorkspaceCommit(
          (current) =>
            ipcBridge.creativeStudio.parkShot.invoke({
              projectId: current.id,
              expectedRevision: current.revision,
              shotId,
            }),
          onCommitted
        ),
      parkBeat: async (beatId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.parkBeat.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            beatId,
          })
        ),
      reviewShot: (shotId, choices) => {
        const current = projectRef.current;
        const currentProjection = projectionRef.current;
        if (
          current === null ||
          currentProjection === null ||
          current.id !== currentProjection.projectId ||
          current.revision !== currentProjection.projectRevision ||
          beatPanelReviewBlockedMessageKey !== null ||
          spendGateLocked
        ) {
          if (beatPanelReviewBlockedMessageKey !== null) setActionErrorMessageKey(beatPanelReviewBlockedMessageKey);
          return;
        }
        const shotMatches = currentProjection.activeBeats.flatMap((beat) =>
          beat.shots.filter((shot) => shot.id === shotId)
        );
        if (shotMatches.length !== 1 || shotMatches[0]!.seedAuthorizationLock !== null) {
          setActionErrorMessageKey(
            shotMatches.length === 1
              ? 'conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked'
              : 'conversation.creativeStudio.workspace.controls.selectionNotPayable'
          );
          return;
        }
        const defaultDraft = selectionGateDraft({
          project: current,
          projection: currentProjection,
          orderedShotIds: [shotId],
        });
        if (defaultDraft === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
          return;
        }
        const expectedChoices = [...defaultDraft.baseChoices, ...defaultDraft.cascadeChoices];
        const lockedShotIds = new Set(
          currentProjection.activeBeats.flatMap((beat) =>
            beat.shots.flatMap((shot) => (shot.seedAuthorizationLock === null ? [] : [shot.id]))
          )
        );
        if (
          expectedChoices.some((choice) => choice.target.kind === 'shot' && lockedShotIds.has(choice.target.shotId))
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked');
          return;
        }
        if (
          choices.length !== expectedChoices.length ||
          choices.some((choice, index) => {
            const expected = expectedChoices[index];
            return (
              expected === undefined ||
              Reflect.ownKeys(choice).length !== 2 ||
              !Object.hasOwn(choice, 'shotId') ||
              !Object.hasOwn(choice, 'purpose') ||
              expected.target.kind !== 'shot' ||
              choice.shotId !== expected.target.shotId ||
              choice.purpose !== expected.purpose
            );
          })
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
          return;
        }
        const draft = defaultDraft;
        if (
          currentGenerationCapability === null &&
          draft.baseChoices.some((choice) => choice.purpose === 'seed_still') &&
          routeCatalog?.image.status !== 'ready'
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
          return;
        }
        if (
          currentGenerationCapability === null &&
          draft.baseChoices.some((choice) => choice.purpose === 'video_take') &&
          routeCatalog?.video.status !== 'ready'
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.videoRouteBlocked');
          return;
        }
        const disclosureGroups = generationBlockGroupsForItems(
          currentGenerationCapability,
          shotCapabilityItemsForDraft(draft)
        );
        setActionErrorMessageKey(null);
        spendGate.open(
          draft,
          undefined,
          disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
        );
      },
      reviewSeedStill: (shotId) => {
        const current = projectRef.current;
        const currentProjection = projectionRef.current;
        if (
          current === null ||
          currentProjection === null ||
          current.id !== currentProjection.projectId ||
          current.revision !== currentProjection.projectRevision ||
          beatPanelReviewBlockedMessageKey !== null ||
          spendGateLocked
        ) {
          if (beatPanelReviewBlockedMessageKey !== null) setActionErrorMessageKey(beatPanelReviewBlockedMessageKey);
          return;
        }
        const projectedShot = currentProjection.activeBeats
          .flatMap((beat) => beat.shots)
          .find((shot) => shot.id === shotId);
        if (projectedShot?.seedAuthorizationLock) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked');
          return;
        }
        const draft = seedRegenerationGateDraft({ project: current, projection: currentProjection, shotId });
        if (draft === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
          return;
        }
        if (
          currentGenerationCapability === null &&
          (routeCatalog?.image.status !== 'ready' || routeCatalog.video.status !== 'ready')
        ) {
          setActionErrorMessageKey(
            routeCatalog?.image.status !== 'ready'
              ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
              : 'conversation.creativeStudio.workspace.controls.videoRouteBlocked'
          );
          return;
        }
        const disclosureGroups = generationBlockGroupsForItems(
          currentGenerationCapability,
          shotCapabilityItemsForDraft(draft)
        );
        setActionErrorMessageKey(null);
        spendGate.open(
          draft,
          undefined,
          disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
        );
      },
      reviewContinuity: openContinuityReview,
      reviewReferences: (shotId) => openReferenceFocus({ shotIds: [shotId] }),
      resolveGenerationBlock: (shotId, block: StudioGenerationBlockV2) => {
        if (block.code === 'reference_binding') {
          openReferenceFocus({ shotIds: [shotId] });
          return;
        }
        if (block.code === 'catalog_unloaded' || block.code === 'health') return;
        if (block.code === 'needs_setup') {
          navigate('/settings/model');
          return;
        }
        setBriefRouteFocusRole(block.role);
        setBriefDialogRequest((request) => request + 1);
        void refetchRoutes();
      },
      retryGenerationJob: async (jobId, acknowledgePossibleDuplicateCharge) =>
        runJobRecovery(
          jobId,
          (job) =>
            (job.purpose === 'seed_still' || job.purpose === 'video_take') &&
            job.status === 'needs_attention' &&
            job.canRetry &&
            acknowledgePossibleDuplicateCharge === (job.error?.code === 'submission_unknown'),
          (current) =>
            ipcBridge.creativeStudio.retryJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
              acknowledgePossibleDuplicateCharge,
            })
        ),
      cancelGenerationJob: async (jobId) =>
        runJobRecovery(
          jobId,
          (job) =>
            (job.purpose === 'seed_still' || job.purpose === 'video_take') &&
            (job.status === 'waiting_for_conditioning' ||
              job.status === 'queued_local' ||
              job.status === 'submitting' ||
              job.status === 'queued_remote' ||
              job.status === 'running' ||
              job.status === 'needs_attention') &&
            job.canCancel,
          (current) =>
            ipcBridge.creativeStudio.cancelJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
            })
        ),
      retryConditioning: mutations.retryConditioning,
      cancelWaiting: mutations.cancelWaiting,
      cancelAndReviewRejoin: cancelAndQueueRejoinReview,
      requestResplit: focusDirectorForReviewedRequest,
    }),
    [
      beatPanelReviewBlockedMessageKey,
      cancelAndQueueRejoinReview,
      currentGenerationCapability,
      focusDirectorForReviewedRequest,
      mutations,
      navigate,
      openContinuityReview,
      openReferenceFocus,
      projection,
      refetchProjectWorkspace,
      routeCatalog,
      runJobRecovery,
      runWorkspaceCommit,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
    ]
  );

  const stopBoardJobs = useCallback((): void => {
    const current = projectRef.current;
    if (
      current === null ||
      projection === null ||
      spendGateLocked ||
      workspacePendingRef.current ||
      projection.projectId !== current.id ||
      projection.projectRevision !== current.revision
    ) {
      return;
    }
    const seenJobs = new Set<string>();
    const candidates = projection.boardPanels
      .flatMap((panel): BoardStopCandidate[] => {
        if (
          panel.latestJobId === null ||
          (panel.activity !== 'queued' && panel.activity !== 'drawing') ||
          seenJobs.has(panel.latestJobId)
        ) {
          return [];
        }
        seenJobs.add(panel.latestJobId);
        return [{ shotId: panel.shotId, jobId: panel.latestJobId }];
      })
      .slice(0, STUDIO_MAX_SHOTS_PER_PROJECT);
    if (candidates.length === 0) return;

    void runWorkspaceExclusive(async () => {
      let failureMessageKey: string | null = null;
      for (const candidate of candidates) {
        const authority = projectRef.current;
        if (authority === null) break;
        const job = exactLatestCancellableBoardJob(authority, candidate);
        if (job === null) continue;

        let result: Awaited<ReturnType<typeof ipcBridge.creativeStudio.cancelJob.invoke>> | null = null;
        try {
          result = await ipcBridge.creativeStudio.cancelJob.invoke({
            projectId: authority.id,
            jobId: job.id,
            expectedRevision: authority.revision,
          });
        } catch {
          failureMessageKey ??= 'conversation.creativeStudio.workspace.errors.storage';
        }

        const refreshed = await refetchProjectWorkspace();
        if (refreshed === null || refreshed.id !== authority.id || refreshed.revision < authority.revision) {
          failureMessageKey ??= 'conversation.creativeStudio.workspace.errors.storage';
          break;
        }
        projectRef.current = refreshed;
        if (result === null) continue;
        if (result.ok === false) {
          failureMessageKey ??= result.error.messageKey;
          continue;
        }
        const returnedJob = result.data;
        const refreshedJob = Object.hasOwn(refreshed.jobs, job.id) ? refreshed.jobs[job.id] : undefined;
        const validSubmittingOutcome =
          job.status === 'submitting' &&
          returnedJob.status === 'needs_attention' &&
          returnedJob.error?.code === 'submission_unknown';
        if (
          refreshed.revision <= authority.revision ||
          returnedJob.id !== job.id ||
          returnedJob.projectId !== authority.id ||
          JSON.stringify(returnedJob.target) !== JSON.stringify(job.target) ||
          returnedJob.purpose !== 'board_still' ||
          (returnedJob.status !== 'cancelled' && !validSubmittingOutcome) ||
          refreshedJob?.id !== returnedJob.id ||
          refreshedJob.projectId !== returnedJob.projectId ||
          JSON.stringify(refreshedJob.target) !== JSON.stringify(returnedJob.target) ||
          refreshedJob.purpose !== 'board_still' ||
          refreshedJob.status !== returnedJob.status
        ) {
          failureMessageKey ??= 'conversation.creativeStudio.workspace.errors.storage';
        }
      }
      if (failureMessageKey !== null) setActionErrorMessageKey(failureMessageKey);
    });
  }, [projection, refetchProjectWorkspace, runWorkspaceExclusive, setActionErrorMessageKey, spendGateLocked]);

  const tableBoardActions = useMemo<TableBoardActions>(
    () => ({
      setStyle: (style) => {
        const current = projectRef.current;
        if (current === null || current.boardStyle === style || workspacePendingRef.current || spendGateLocked) {
          return;
        }
        if (generationDraftsBlockReview) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
          return;
        }
        void mutations.editProject({ boardStyle: style });
      },
      drawNext: () =>
        openBoardSpendGate((current, exactProjection) =>
          boardGateDraft({
            project: current,
            projection: exactProjection,
          })
        ),
      drawBeat: (beatId) =>
        openBoardSpendGate((current, exactProjection) => {
          const beat = Object.hasOwn(current.beats, beatId) ? current.beats[beatId] : undefined;
          if (beat?.id !== beatId || current.beatOrder.filter((activeBeatId) => activeBeatId === beatId).length !== 1) {
            return null;
          }
          const panelsByShotId = new Map(exactProjection.boardPanels.map((panel) => [panel.shotId, panel]));
          const missingShotIds = beat.shotOrder.filter((shotId) => {
            const panel = panelsByShotId.get(shotId);
            return (
              panel?.freshness === 'missing' &&
              BOARD_DRAW_PANEL_ACTIVITIES.has(panel.activity) &&
              panel.recovery?.canRetryDownload !== true
            );
          });
          return boardSelectionGateDraft({
            project: current,
            projection: exactProjection,
            orderedShotIds: missingShotIds,
          });
        }),
      redrawShot: (shotId) =>
        openBoardSpendGate((current, exactProjection) => {
          const panel = exactProjection.boardPanels.find((candidate) => candidate.shotId === shotId);
          return panel === undefined || panel.assetId === null
            ? null
            : boardSelectionGateDraft({
                project: current,
                projection: exactProjection,
                orderedShotIds: [shotId],
              });
        }),
      redrawBeat: (beatId) =>
        openBoardSpendGate((current, exactProjection) => {
          const beat = Object.hasOwn(current.beats, beatId) ? current.beats[beatId] : undefined;
          if (beat?.id !== beatId || current.beatOrder.filter((activeBeatId) => activeBeatId === beatId).length !== 1) {
            return null;
          }
          const panelsByShotId = new Map(exactProjection.boardPanels.map((panel) => [panel.shotId, panel]));
          if (beat.shotOrder.some((shotId) => panelsByShotId.get(shotId)?.assetId == null)) return null;
          return boardSelectionGateDraft({
            project: current,
            projection: exactProjection,
            orderedShotIds: beat.shotOrder,
          });
        }),
      promotePanel: (shotId, boardAssetId) => {
        const current = projectRef.current;
        if (
          current === null ||
          projection === null ||
          spendGateLocked ||
          workspacePendingRef.current ||
          current.id !== projection.projectId ||
          current.revision !== projection.projectRevision
        ) {
          return;
        }
        if (generationDraftsBlockReview) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
          return;
        }
        if (!projection.workspaceStatusReady || !projection.chainStatusReady) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.statusRequired');
          return;
        }
        const plan = boardPromotionGatePlan({ project: current, projection, shotId, boardAssetId });
        if (plan === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
          return;
        }
        const disclosureGroups = generationBlockGroupsForItems(
          currentGenerationCapability,
          plan.impact.currentTakeShotIds.map((currentTakeShotId) => ({
            target: { kind: 'shot' as const, shotId: currentTakeShotId },
            purpose: 'video_take' as const,
          }))
        );
        setActionErrorMessageKey(null);
        spendGate.open(
          plan.draft,
          {
            ...plan.impact,
            paidRouteReady:
              disclosureGroups.length === 0 &&
              (currentGenerationCapability !== null ||
                (current.videoRouteId !== null && routeCatalog !== null && routeCatalog.video.status === 'ready')),
          },
          disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
        );
      },
      retryJob: (jobId, acknowledgePossibleDuplicateCharge) => {
        if (spendGateLocked) return;
        void runJobRecovery(
          jobId,
          (job) =>
            job.purpose === 'board_still' &&
            job.status === 'needs_attention' &&
            job.canRetry &&
            acknowledgePossibleDuplicateCharge === (job.error?.code === 'submission_unknown'),
          (current) =>
            ipcBridge.creativeStudio.retryJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
              acknowledgePossibleDuplicateCharge,
            })
        );
      },
      retryDownload: (jobId) => {
        if (spendGateLocked) return;
        void runJobRecovery(
          jobId,
          (job) =>
            job.purpose === 'board_still' &&
            job.status === 'failed' &&
            job.error?.code === 'download_failed' &&
            job.canRetryDownload,
          (current) =>
            ipcBridge.creativeStudio.retryDownload.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
            })
        );
      },
      cancelJob: (jobId) => {
        if (spendGateLocked) return;
        void runJobRecovery(
          jobId,
          (job) => job.purpose === 'board_still' && job.status === 'needs_attention' && job.canCancel,
          (current) =>
            ipcBridge.creativeStudio.cancelJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
            })
        );
      },
      stop: stopBoardJobs,
    }),
    [
      generationDraftsBlockReview,
      currentGenerationCapability,
      mutations,
      openBoardSpendGate,
      projection,
      routeCatalog,
      runJobRecovery,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
      stopBoardJobs,
    ]
  );

  const boardActions = useMemo<BoardActions>(
    () => ({
      reorderBeats: async (beatOrder) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'reorder_beats', beatOrder: [...beatOrder] }],
          })
        ),
      parkBeat: beatPanelActions.parkBeat,
      restoreBeat: async (beatId, beforeBeatId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.restoreBeat.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            beatId,
            beforeBeatId,
          })
        ),
      restoreShot: async (shotId, beforeShotId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.restoreShot.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId,
            beforeShotId,
          })
        ),
      reorderBin: async (bin) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.reorderBin.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            bin: bin.map(cloneBinItem),
          })
        ),
    }),
    [beatPanelActions, runWorkspaceCommit]
  );

  const cutActions = useMemo<CutActions>(
    () => ({
      reorderBeats: boardActions.reorderBeats,
      importBedAudio: async (): Promise<CutImportResult> =>
        (await runWorkspaceExclusive(async () => {
          const current = projectRef.current;
          if (current === null) return 'failed';
          const result = await ipcBridge.creativeStudio.importBedAudio.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
          });
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return 'failed';
          }
          if (result.data.status === 'cancelled') return 'cancelled';
          const refreshed = await refetchProjectWorkspace();
          if (refreshed === null || refreshed.revision !== result.data.projectRevision) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
            return 'failed';
          }
          projectRef.current = refreshed;
          return 'imported';
        })) ?? 'failed',
      setBed: async (assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.setBed.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            assetId,
          })
        ),
      detachBedAudio: async (assetId) =>
        (await runWorkspaceExclusive(async () => {
          const current = projectRef.current;
          if (current === null || current.bedAssetId === assetId) return false;
          const result = await ipcBridge.creativeStudio.detachBedAudio.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            assetId,
          });
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return false;
          }
          const refreshed = await refetchProjectWorkspace();
          if (refreshed === null || refreshed.revision !== result.data.projectRevision) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
            return false;
          }
          projectRef.current = refreshed;
          return true;
        })) ?? false,
    }),
    [
      boardActions.reorderBeats,
      refetchProjectWorkspace,
      runWorkspaceCommit,
      runWorkspaceExclusive,
      setActionErrorMessageKey,
    ]
  );

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

  const referenceActions = useMemo<ReferencesViewActions & TableReferenceBindingActions>(
    () => ({
      addBackground: async ({ label, prompt }): Promise<boolean> => {
        const current = projectRef.current;
        const trimmedLabel = label.trim();
        const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        if (
          current === null ||
          current.referencePlanStatus !== 'planned' ||
          current.referenceOrder.length >= STUDIO_MAX_PROJECT_REFERENCES ||
          trimmedLabel.length === 0 ||
          trimmedLabel.length > STUDIO_MAX_REFERENCE_LABEL_LENGTH ||
          trimmedPrompt.length === 0 ||
          trimmedPrompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH ||
          current.referenceOrder.some((referenceId) => {
            const reference = Object.hasOwn(current.references, referenceId)
              ? current.references[referenceId]
              : undefined;
            return reference?.kind === 'background' && reference.label === trimmedLabel;
          }) ||
          workspacePendingRef.current ||
          spendGateLocked
        ) {
          return false;
        }
        const previousReferenceOrder = [...current.referenceOrder];
        const committed = await runWorkspaceCommit((latest) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: latest.id,
            expectedRevision: latest.revision,
            operations: [
              {
                kind: 'amend_reference_plan',
                additions: [{ kind: 'background', label: trimmedLabel, prompt: trimmedPrompt }],
              },
            ],
          })
        );
        if (!committed) return false;
        const refreshed = projectRef.current;
        const appendedReferenceId = refreshed?.referenceOrder[previousReferenceOrder.length];
        const appendedReference =
          refreshed !== null &&
          appendedReferenceId !== undefined &&
          Object.hasOwn(refreshed.references, appendedReferenceId)
            ? refreshed.references[appendedReferenceId]
            : undefined;
        if (
          refreshed === null ||
          refreshed.referenceOrder.length !== previousReferenceOrder.length + 1 ||
          previousReferenceOrder.some((referenceId, index) => refreshed.referenceOrder[index] !== referenceId) ||
          appendedReference?.kind !== 'background' ||
          appendedReference.label !== trimmedLabel ||
          appendedReference.prompt !== trimmedPrompt ||
          appendedReference.approvedAssetId !== null
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        return true;
      },
      updateDetails: async (referenceId, { label, prompt }): Promise<boolean> => {
        const current = projectRef.current;
        const reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        const trimmedLabel = typeof label === 'string' ? label.trim() : '';
        const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        if (
          current === null ||
          current.referencePlanStatus !== 'planned' ||
          reference?.id !== referenceId ||
          trimmedLabel.length === 0 ||
          trimmedLabel.length > STUDIO_MAX_REFERENCE_LABEL_LENGTH ||
          trimmedPrompt.length === 0 ||
          trimmedPrompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH ||
          current.referenceOrder.some((candidateId) => {
            const candidate = Object.hasOwn(current.references, candidateId)
              ? current.references[candidateId]
              : undefined;
            return (
              candidate?.id !== referenceId && candidate?.kind === reference.kind && candidate.label === trimmedLabel
            );
          }) ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          spendGateLocked
        ) {
          return false;
        }
        const operations: StudioRendererAuthoringOperationV2[] = [];
        if (trimmedLabel !== reference.label) {
          operations.push({ kind: 'set_reference_label', referenceId, label: trimmedLabel });
        }
        if (trimmedPrompt !== reference.prompt) {
          operations.push({ kind: 'set_reference_prompt', referenceId, prompt: trimmedPrompt });
        }
        if (operations.length === 0) return true;
        setPendingReferenceId(referenceId);
        try {
          const committed = await runWorkspaceCommit((latest) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: latest.id,
              expectedRevision: latest.revision,
              operations,
            })
          );
          if (!committed) return false;
          const refreshed = projectRef.current;
          const updated =
            refreshed !== null && Object.hasOwn(refreshed.references, referenceId)
              ? refreshed.references[referenceId]
              : undefined;
          return updated?.label === trimmedLabel && updated.prompt === trimmedPrompt;
        } finally {
          setPendingReferenceId(null);
        }
      },
      selectImage: async (referenceId, assetId): Promise<boolean> => {
        const current = projectRef.current;
        const reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        if (
          current === null ||
          reference?.id !== referenceId ||
          reference.approvedAssetId === assetId ||
          !reference.supersededAssetIds.includes(assetId) ||
          workspacePendingRef.current ||
          pendingReferenceId !== null
        ) {
          return false;
        }
        setPendingReferenceId(referenceId);
        try {
          const committed = await runWorkspaceCommit((latest) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: latest.id,
              expectedRevision: latest.revision,
              operations: [{ kind: 'select_reference_image', referenceId, assetId }],
            })
          );
          if (!committed) return false;
          const refreshed = projectRef.current;
          return (
            refreshed !== null &&
            Object.hasOwn(refreshed.references, referenceId) &&
            refreshed.references[referenceId]?.approvedAssetId === assetId
          );
        } finally {
          setPendingReferenceId(null);
        }
      },
      regenerate: async (referenceId, prompt): Promise<boolean> => {
        const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        let current = projectRef.current;
        let reference =
          current !== null && Object.hasOwn(current.references, referenceId)
            ? current.references[referenceId]
            : undefined;
        if (
          current === null ||
          reference?.id !== referenceId ||
          trimmedPrompt.length === 0 ||
          trimmedPrompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          spendGateLocked
        ) {
          return false;
        }
        if (reference.prompt !== trimmedPrompt) {
          setPendingReferenceId(referenceId);
          try {
            if (
              !(await runWorkspaceCommit((latest) =>
                ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
                  projectId: latest.id,
                  expectedRevision: latest.revision,
                  operations: [{ kind: 'set_reference_prompt', referenceId, prompt: trimmedPrompt }],
                })
              ))
            ) {
              return false;
            }
          } finally {
            setPendingReferenceId(null);
          }
          current = projectRef.current;
          reference =
            current !== null && Object.hasOwn(current.references, referenceId)
              ? current.references[referenceId]
              : undefined;
          if (current === null || reference?.prompt !== trimmedPrompt) return false;
        }
        const candidateJob =
          current === null || reference?.id !== referenceId
            ? undefined
            : [...reference.jobIds]
                .toReversed()
                .map((jobId) => (Object.hasOwn(current.jobs, jobId) ? current.jobs[jobId] : undefined))
                .find(
                  (job) =>
                    job?.target.kind === 'reference' &&
                    job.target.referenceId === referenceId &&
                    job.purpose === 'reference_image'
                );
        const generationAlreadyRequested =
          referenceRequests.some((request) => request.referenceIds.includes(referenceId)) ||
          referenceGenerationHandoffs.some(
            (handoff) => handoff.status === 'awaiting_spend' && handoff.referenceIds.includes(referenceId)
          );
        if (
          current === null ||
          reference?.id !== referenceId ||
          !current.referenceOrder.includes(referenceId) ||
          workspacePendingRef.current ||
          pendingReferenceId !== null ||
          candidateJob?.status === 'queued_local' ||
          candidateJob?.status === 'submitting' ||
          candidateJob?.status === 'queued_remote' ||
          candidateJob?.status === 'running' ||
          candidateJob?.status === 'needs_attention' ||
          candidateJob?.canRetryDownload === true
        ) {
          return false;
        }
        if (generationAlreadyRequested) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.gate.errors.pricing.inFlight');
          return false;
        }
        if (generationDraftsBlockReview) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
          return false;
        }
        if (routeCatalog === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
          return false;
        }
        if (
          currentGenerationCapability === null &&
          (current.imageRouteId === null || routeCatalog.image.status !== 'ready')
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
          return false;
        }
        if (
          reference.kind === 'background' &&
          current.referenceOrder.some((candidateId) => {
            const candidate = Object.hasOwn(current.references, candidateId)
              ? current.references[candidateId]
              : undefined;
            return candidate?.kind === 'character' && candidate.approvedAssetId === null;
          })
        ) {
          setActionErrorMessageKey(
            'conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.charactersRequired'
          );
          return false;
        }
        const disclosureGroups = generationBlockGroupsForItems(
          currentGenerationCapability,
          referenceCapabilityItems([reference.id])
        );
        setActionErrorMessageKey(null);
        spendGate.open(
          { projectId: current.id, expectedRevision: current.revision, referenceIds: [reference.id] },
          undefined,
          disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
        );
        return true;
      },
      retryJob: async (referenceId, jobId, acknowledgePossibleDuplicateCharge): Promise<boolean> =>
        runReferenceJobRecovery(
          referenceId,
          jobId,
          (job) =>
            job.status === 'needs_attention' &&
            job.canRetry &&
            acknowledgePossibleDuplicateCharge === (job.error?.code === 'submission_unknown'),
          (current) =>
            ipcBridge.creativeStudio.retryJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
              acknowledgePossibleDuplicateCharge,
            })
        ),
      retryDownload: async (referenceId, jobId): Promise<boolean> =>
        runReferenceJobRecovery(
          referenceId,
          jobId,
          (job) => job.status === 'failed' && job.error?.code === 'download_failed' && job.canRetryDownload,
          (current) =>
            ipcBridge.creativeStudio.retryDownload.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
            })
        ),
      cancelJob: async (referenceId, jobId): Promise<boolean> =>
        runReferenceJobRecovery(
          referenceId,
          jobId,
          (job) => job.canCancel,
          (current) =>
            ipcBridge.creativeStudio.cancelJob.invoke({
              projectId: current.id,
              jobId,
              expectedRevision: current.revision,
            })
        ),
      openBindings: (): void => {
        navigate(studioViewPath(projectId, 'table'));
      },
      saveBinding: async (shotId, characterReferenceIds, backgroundReferenceId): Promise<boolean> => {
        const current = projectRef.current;
        const shot = current !== null && Object.hasOwn(current.shots, shotId) ? current.shots[shotId] : undefined;
        if (
          current === null ||
          shot?.id !== shotId ||
          pendingReferenceId !== null ||
          spendGateLocked ||
          new Set(characterReferenceIds).size !== characterReferenceIds.length
        ) {
          return false;
        }
        setPendingReferenceId(shotId);
        try {
          return await runWorkspaceCommit((latest) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: latest.id,
              expectedRevision: latest.revision,
              operations: [
                {
                  kind: 'set_shot_reference_binding',
                  shotId,
                  characterReferenceIds: [...characterReferenceIds],
                  backgroundReferenceId,
                },
              ],
            })
          );
        } finally {
          setPendingReferenceId(null);
        }
      },
    }),
    [
      currentGenerationCapability,
      generationDraftsBlockReview,
      navigate,
      pendingReferenceId,
      projectId,
      referenceGenerationHandoffs,
      referenceRequests,
      refetchProjectWorkspace,
      routeCatalog,
      runReferenceJobRecovery,
      runWorkspaceCommit,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
    ]
  );

  const saveAllDrafts = useCallback(async (): Promise<boolean> => {
    if (drafts.staleRevision) return false;
    const startingProject = projectRef.current;
    if (startingProject === null || workspacePendingRef.current) return false;
    let expectedRevision = startingProject.revision;
    const currentForChain = (): StudioRendererProjectV2 | null => {
      const current = projectRef.current;
      return current?.revision === expectedRevision ? current : null;
    };
    const runChainedCommit = async (
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>
    ): Promise<boolean> => {
      const committedRevision = await runWorkspaceCommitAtRevision(expectedRevision, invoke);
      if (committedRevision === null) return false;
      expectedRevision = committedRevision;
      return true;
    };
    const dirty = new Set(drafts.dirtyKeys);
    const hasBlockedShapeDraft =
      projection?.requestShapeLocked === true &&
      (dirty.has('settings.aspectRatio') || dirty.has('settings.resolution'));
    const settingsKeys = [
      'settings.name',
      'settings.targetDurationSeconds',
      'settings.aspectRatio',
      'settings.resolution',
    ];
    if (settingsKeys.some((key) => dirty.has(key))) {
      const current = currentForChain();
      if (current === null) return false;
      const submittedSettings = Object.fromEntries(settingsKeys.map((key) => [key, drafts.value(key)]));
      const candidate = {
        name: String(drafts.value('settings.name') ?? '').trim(),
        targetDurationSeconds: Number(drafts.value('settings.targetDurationSeconds')),
      };
      const requestShape = projection?.requestShapeLocked
        ? {}
        : {
            aspectRatio: drafts.value('settings.aspectRatio') as StudioRendererProjectV2['aspectRatio'],
            resolution: drafts.value('settings.resolution') as StudioRendererProjectV2['resolution'],
          };
      const settingsCandidate = { ...candidate, ...requestShape };
      const changes = Object.fromEntries(
        Object.entries(settingsCandidate).filter(
          ([key, value]) => current[key as keyof StudioRendererProjectV2] !== value
        )
      );
      if (
        Object.keys(changes).length > 0 &&
        !(await runChainedCommit((authority) =>
          ipcBridge.creativeStudio.editProject.invoke({
            projectId: authority.id,
            expectedRevision: authority.revision,
            changes: changes as Parameters<WorkspaceMutationCallbacks['editProject']>[0],
          })
        ))
      ) {
        return false;
      }
      ['settings.name', 'settings.targetDurationSeconds'].forEach((key) =>
        drafts.resetIfValue(key, submittedSettings[key] as WorkspaceDraftValue)
      );
      if (projection?.requestShapeLocked !== true) {
        ['settings.aspectRatio', 'settings.resolution'].forEach((key) =>
          drafts.resetIfValue(key, submittedSettings[key] as WorkspaceDraftValue)
        );
      }
    }

    const authoringKeys = [
      'brief.text',
      'brief.imageRouteId',
      'brief.videoRouteId',
      'brief.spendCurrency',
      'brief.spendMajorUnits',
    ];
    if (authoringKeys.some((key) => dirty.has(key))) {
      const current = currentForChain();
      if (current === null) return false;
      const submittedAuthoring = Object.fromEntries(authoringKeys.map((key) => [key, drafts.value(key)]));
      const operations: StudioRendererAuthoringOperationV2[] = [];
      const brief = String(drafts.value('brief.text') ?? '');
      const imageRouteId = String(drafts.value('brief.imageRouteId') ?? '') || null;
      const videoRouteId = String(drafts.value('brief.videoRouteId') ?? '') || null;
      if (brief !== current.brief) operations.push({ kind: 'set_brief', brief });
      if (imageRouteId !== current.imageRouteId || videoRouteId !== current.videoRouteId) {
        operations.push({ kind: 'set_routes', imageRouteId, videoRouteId });
      }
      const currency = String(drafts.value('brief.spendCurrency') ?? '')
        .trim()
        .toUpperCase();
      const major = String(drafts.value('brief.spendMajorUnits') ?? '').trim();
      const minorUnits = major.length === 0 ? null : majorUnitsToMinorUnits(major);
      if (minorUnits === null && major.length > 0) return false;
      const policy = major.length === 0 ? null : { currency, maxPerBatchMinorUnits: minorUnits as number };
      if (policy !== null && !/^[A-Z]{3}$/.test(policy.currency)) return false;
      if (JSON.stringify(policy) !== JSON.stringify(current.spendPolicy)) {
        operations.push({ kind: 'set_spend_policy', policy });
      }
      if (
        operations.length > 0 &&
        !(await runChainedCommit((authority) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: authority.id,
            expectedRevision: authority.revision,
            operations,
          })
        ))
      ) {
        return false;
      }
      authoringKeys.forEach((key) => drafts.resetIfValue(key, submittedAuthoring[key] as WorkspaceDraftValue));
    }

    type SubmittedOperation = {
      operation: StudioRendererAuthoringOperationV2;
      values: [key: string, value: WorkspaceDraftValue][];
    };
    const submittedOperations: SubmittedOperation[] = [];
    const current = currentForChain();
    if (current === null) return false;
    for (const beatId of current.beatOrder) {
      const beat = Object.hasOwn(current.beats, beatId) ? current.beats[beatId] : undefined;
      if (beat?.id !== beatId) continue;
      const values: SubmittedOperation['values'] = [];
      const changes: Partial<Pick<typeof beat, 'story' | 'targetSeconds'>> = {};
      for (const field of ['story', 'targetSeconds'] as const) {
        const key = beatDraftKey(beatId, field);
        if (!dirty.has(key)) continue;
        const value = drafts.value(key);
        if (
          (field === 'targetSeconds' && value !== null && !Number.isSafeInteger(value)) ||
          (field !== 'targetSeconds' && typeof value !== 'string')
        ) {
          return false;
        }
        values.push([key, value as WorkspaceDraftValue]);
        if (value !== beat[field]) {
          Object.assign(changes, { [field]: value });
        }
      }
      if (values.length > 0) {
        if (Object.keys(changes).length === 0) {
          values.forEach(([key, value]) => drafts.resetIfValue(key, value));
        } else {
          submittedOperations.push({
            operation: { kind: 'edit_beat', beatId, changes } as StudioRendererAuthoringOperationV2,
            values,
          });
        }
      }
      for (const shotId of beat.shotOrder) {
        const shot = Object.hasOwn(current.shots, shotId) ? current.shots[shotId] : undefined;
        if (shot?.id !== shotId) continue;
        const shotValues: SubmittedOperation['values'] = [];
        const shotChanges: Partial<Pick<typeof shot, 'shootingScript' | 'durationSeconds'>> = {};
        for (const field of ['shootingScript', 'durationSeconds'] as const) {
          const key = shotDraftKey(shotId, field);
          if (!dirty.has(key)) continue;
          const value = drafts.value(key);
          if (
            (field === 'durationSeconds' && !Number.isSafeInteger(value)) ||
            (field !== 'durationSeconds' && typeof value !== 'string')
          ) {
            return false;
          }
          shotValues.push([key, value as WorkspaceDraftValue]);
          if (value !== shot[field]) Object.assign(shotChanges, { [field]: value });
        }
        if (shotValues.length === 0) continue;
        if (Object.keys(shotChanges).length === 0) {
          shotValues.forEach(([key, value]) => drafts.resetIfValue(key, value));
          continue;
        }
        submittedOperations.push({
          operation: { kind: 'edit_shot', shotId, changes: shotChanges } as StudioRendererAuthoringOperationV2,
          values: shotValues,
        });
      }
    }
    for (let offset = 0; offset < submittedOperations.length; offset += STUDIO_MAX_MUTATION_OPERATIONS) {
      const batch = submittedOperations.slice(offset, offset + STUDIO_MAX_MUTATION_OPERATIONS);
      if (
        !(await runChainedCommit((authority) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: authority.id,
            expectedRevision: authority.revision,
            operations: batch.map(({ operation }) => operation),
          })
        ))
      ) {
        return false;
      }
      for (const { values } of batch) {
        values.forEach(([key, value]) => drafts.resetIfValue(key, value));
      }
    }
    return !hasBlockedShapeDraft;
  }, [drafts, projection?.requestShapeLocked, runWorkspaceCommitAtRevision]);

  const flushAllWorkspaceDrafts = useCallback(
    async (): Promise<boolean> =>
      ruleDraftDirtyCount === 0 && inactiveWorkspaceDraftDirtyCount === 0 && saveAllDrafts(),
    [inactiveWorkspaceDraftDirtyCount, ruleDraftDirtyCount, saveAllDrafts]
  );
  const closeDirtyDraftCount = drafts.dirtyCount + ruleDraftDirtyCount + inactiveWorkspaceDraftDirtyCount;

  useLayoutEffect(() => {
    if (project === null) {
      onCloseContractChange(null);
      return;
    }
    onCloseContractChange({ dirtyDraftCount: closeDirtyDraftCount, saveAll: flushAllWorkspaceDrafts });
    return () => onCloseContractChange(null);
  }, [closeDirtyDraftCount, flushAllWorkspaceDrafts, onCloseContractChange, project]);

  const refreshProposalAuthority = useCallback(async (): Promise<void> => {
    const [projectOutcome] = await Promise.allSettled([refetchProjectWorkspace(), refetchProposals()]);
    if (projectOutcome.status === 'fulfilled' && projectOutcome.value !== null) {
      projectRef.current = projectOutcome.value;
    }
  }, [refetchProjectWorkspace, refetchProposals]);

  const acceptProposal = useCallback(
    async (proposalId: string): Promise<boolean> => {
      if (pendingActionIdRef.current !== null) return false;
      const target = proposals.find((proposal) => proposal.id === proposalId && proposal.status === 'pending');
      if (closeDirtyDraftCount > 0 && target?.payload.kind === 'mutation_batch') {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.saveBeforeApply');
        return false;
      }
      if (!beginPendingAction(proposalId)) return false;
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.acceptProposal.invoke({ projectId, proposalId });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          await refreshProposalAuthority();
          return false;
        }
        await refreshProposalAuthority();
        return true;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        await refreshProposalAuthority();
        return false;
      } finally {
        finishPendingAction(proposalId);
      }
    },
    [
      beginPendingAction,
      closeDirtyDraftCount,
      finishPendingAction,
      projectId,
      proposals,
      refreshProposalAuthority,
      setActionErrorMessageKey,
    ]
  );

  const rejectProposal = useCallback(
    async (proposalId: string): Promise<boolean> => {
      if (!beginPendingAction(proposalId)) return false;
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.rejectProposal.invoke({ projectId, proposalId });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return false;
        }
        await refetchProposals();
        return true;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return false;
      } finally {
        finishPendingAction(proposalId);
      }
    },
    [beginPendingAction, finishPendingAction, projectId, refetchProposals, setActionErrorMessageKey]
  );

  const decideProposalFromDirectorChat = useCallback(
    async (intent: DirectorProposalChatIntent): Promise<void> => {
      if (pendingActionIdRef.current !== null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDecisionBusy');
        return;
      }
      const pending = proposals.filter((proposal) => proposal.status === 'pending');
      if (pending.length === 0) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatNoPending');
        return;
      }
      if (pending.length !== 1) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatMultiplePending');
        return;
      }
      const current = projectRef.current;
      const target = pending[0]!;
      if (current === null || target.projectId !== current.id || target.baseRevision !== current.revision) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatStale');
        return;
      }
      if (closeDirtyDraftCount > 0) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.chatDirty');
        return;
      }
      const succeeded = intent === 'accept' ? await acceptProposal(target.id) : await rejectProposal(target.id);
      if (succeeded) {
        setActionErrorMessageKey(
          intent === 'accept'
            ? 'conversation.creativeStudio.workspace.proposals.chatAccepted'
            : 'conversation.creativeStudio.workspace.proposals.chatRejected'
        );
      }
    },
    [acceptProposal, closeDirtyDraftCount, proposals, rejectProposal, setActionErrorMessageKey]
  );

  const acceptProposalFromCard = useCallback(
    async (proposalId: string): Promise<void> => {
      await acceptProposal(proposalId);
    },
    [acceptProposal]
  );
  const rejectProposalFromCard = useCallback(
    async (proposalId: string): Promise<void> => {
      await rejectProposal(proposalId);
    },
    [rejectProposal]
  );

  const reviewHandoff = useCallback(
    (handoff: StudioRendererReferenceGenerationHandoffV2): void => {
      const current = projectRef.current;
      if (current === null) return;
      if (generationDraftsBlockReview) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
        return;
      }
      if (statusBlocksReview || projection === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.statusRequired');
        return;
      }
      if (routeCatalog === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
        return;
      }
      if (currentGenerationCapability === null && routeCatalog.image.status !== 'ready') {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
        return;
      }
      const draft = handoffGateDraft(current, projection, handoff);
      if (draft === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const disclosureGroups = generationBlockGroupsForItems(
        currentGenerationCapability,
        referenceCapabilityItems(draft.referenceIds)
      );
      spendGate.open(
        draft,
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
      );
    },
    [
      currentGenerationCapability,
      generationDraftsBlockReview,
      projection,
      routeCatalog,
      setActionErrorMessageKey,
      spendGate.open,
      statusBlocksReview,
    ]
  );

  const decideReferences = useCallback(
    async (requestId: string, outcome: StudioReferenceDecisionIntent): Promise<void> => {
      if (project === null || !beginPendingAction(requestId)) return;
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
          reviewHandoff({
            handoffId: result.data.outcome.handoffId,
            requestId: result.data.requestId,
            referenceIds: [...result.data.outcome.referenceIds],
            decidedAt: result.data.decidedAt,
            status: 'awaiting_spend',
            counts: { queued: 0, running: 0, succeeded: 0, failed: 0 },
            resultAssetIds: [],
            failedReferenceIds: [],
            completedAt: null,
          });
        }
        await refetchReferences();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        finishPendingAction(requestId);
      }
    },
    [
      beginPendingAction,
      finishPendingAction,
      project,
      projectId,
      refetchReferences,
      reviewHandoff,
      setActionErrorMessageKey,
    ]
  );

  const reviewGeneratedReferences = useCallback(
    (handoff: StudioRendererReferenceGenerationHandoffV2): void => {
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
    [openReferenceFocus]
  );

  const reviewShotBinding = useCallback(
    (shotId: string): void => {
      const current = projectRef.current;
      if (current === null || !Object.hasOwn(current.shots, shotId) || current.shots[shotId]?.id !== shotId) return;
      openReferenceFocus({ shotIds: [shotId] });
    },
    [openReferenceFocus]
  );

  const retryFailedReferences = useCallback(
    (handoff: StudioRendererReferenceGenerationHandoffV2): void => {
      const current = projectRef.current;
      if (
        current === null ||
        (handoff.status !== 'partially_failed' && handoff.status !== 'failed') ||
        handoff.failedReferenceIds.length === 0 ||
        generationDraftsBlockReview ||
        workspacePendingRef.current ||
        spendGateLocked
      ) {
        if (generationDraftsBlockReview) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.saveBeforeReview');
        }
        return;
      }
      if (routeCatalog === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.routeCatalogRequired');
        return;
      }
      if (
        currentGenerationCapability === null &&
        (current.imageRouteId === null || routeCatalog.image.status !== 'ready')
      ) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
        return;
      }
      const retryIds = handoff.failedReferenceIds.filter((referenceId) => {
        const reference = Object.hasOwn(current.references, referenceId) ? current.references[referenceId] : undefined;
        const job =
          reference?.id !== referenceId
            ? undefined
            : [...reference.jobIds]
                .toReversed()
                .map((jobId) => (Object.hasOwn(current.jobs, jobId) ? current.jobs[jobId] : undefined))
                .find(
                  (candidate) =>
                    candidate?.target.kind === 'reference' &&
                    candidate.target.referenceId === referenceId &&
                    candidate.purpose === 'reference_image'
                );
        const paidRetryableStatus =
          job?.status === 'cancelled' ||
          (job?.status === 'failed' &&
            job.error !== null &&
            job.error.code !== 'download_failed' &&
            job.error.code !== 'dependency_failed');
        const hasExactRetryAuthority =
          reference?.id === referenceId &&
          job !== undefined &&
          reference.jobIds.includes(job.id) &&
          current.referenceOrder.filter((candidateId) => candidateId === referenceId).length === 1 &&
          job.projectId === current.id &&
          job.target.kind === 'reference' &&
          job.target.referenceId === referenceId &&
          job.purpose === 'reference_image' &&
          paidRetryableStatus;
        return hasExactRetryAuthority;
      });
      if (retryIds.length !== handoff.failedReferenceIds.length) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      const disclosureGroups = generationBlockGroupsForItems(
        currentGenerationCapability,
        referenceCapabilityItems(retryIds)
      );
      setActionErrorMessageKey(null);
      spendGate.open(
        { projectId: current.id, expectedRevision: current.revision, referenceIds: retryIds },
        undefined,
        disclosureGroups.length === 0 ? undefined : { groups: disclosureGroups, blocksPrepare: true }
      );
    },
    [
      currentGenerationCapability,
      generationDraftsBlockReview,
      routeCatalog,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
    ]
  );

  const dismissHandoff = useCallback(
    async (handoff: StudioRendererReferenceGenerationHandoffV2): Promise<void> => {
      const current = projectRef.current;
      if (current === null || !beginPendingAction(handoff.handoffId)) return;
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
        finishPendingAction(handoff.handoffId);
      }
    },
    [beginPendingAction, finishPendingAction, refetchReferences, setActionErrorMessageKey]
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

  const actionableProposals = proposals.filter(
    (proposal) => proposal.status === 'pending' && proposal.baseRevision === project.revision
  );
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
      pendingActionId={pendingActionId}
      blockMutationProposalAcceptance={closeDirtyDraftCount > 0}
      proposalErrorMessageKey={cardProposalErrorMessageKey}
      referenceErrorMessageKey={cardReferenceErrorMessageKey}
      onAcceptProposal={acceptProposalFromCard}
      onRejectProposal={rejectProposalFromCard}
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
  const reviewedDirectorOutputs: WorkspaceReviewedOutput[] = [
    ...actionableProposals.map((proposal) => ({
      id: `proposal-${proposal.id}`,
      createdAt: Date.parse(proposal.createdAt),
      content: directorReviewCard([proposal], [], []),
    })),
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
    ...(proposalErrorMessageKey === null
      ? []
      : [
          {
            id: 'proposal-error',
            createdAt: Date.parse(project.updatedAt),
            content: directorReviewCard([], [], [], proposalErrorMessageKey),
          },
        ]),
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
        onDirectorProposalIntent={decideProposalFromDirectorChat}
        activeView={activeView}
        stats={projection === null ? undefined : buildStudioBarStats(projection)}
        renderAction={
          <Button type='primary' disabled={workspacePending || spendGateLocked} onClick={renderFilm}>
            {t('conversation.creativeStudio.workspace.controls.renderFilm')}
          </Button>
        }
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
        {projection === null ? null : (
          <WorkspaceControls
            activeView={activeView}
            boardActions={boardActions}
            tableBoardActions={tableBoardActions}
            cutActions={cutActions}
            project={project}
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
          />
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
        {id ? (
          <StudioProjectPage
            key={id}
            projectId={id}
            routeView={routeView}
            routeViewWasSpecified={view !== undefined}
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
