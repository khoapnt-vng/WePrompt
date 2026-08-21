/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_DIRTY_DRAFTS_REPORTED,
  STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION,
  STUDIO_MAX_MUTATION_OPERATIONS,
  type StudioBinItem,
  type StudioBriefRuleDraft,
  type StudioCommandResult,
  type StudioRendererAuthoringOperationV2,
  type StudioRendererExportCatalogV2,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererProjectV2,
  type StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { StudioLibrary } from './components/Library';
import { DirectorProposals } from './components/Shell/DirectorProposals';
import {
  SpendGateModal,
  hasGenerationAffectingWorkspaceDrafts,
  handoffGateDraft,
  majorUnitsToMinorUnits,
  buildStudioBarStats,
  countStoredStudioRuleDrafts,
  countStoredWorkspaceDrafts,
  projectWorkspace,
  selectionGateDraft,
  useSpendGate,
  useWorkspaceDrafts,
  WorkspaceControls,
  WorkspaceProjectMenu,
  WorkspaceShell,
  type BeatPanelActions,
  type BeatPanelBriefReferenceOption,
  type BeatPanelImportResult,
  type BeatPanelReviewChoice,
  type BeatPanelReviewGraph,
  type BoardActions,
  type CutActions,
  type CutCopyResult,
  type CutImportResult,
  type WorkspaceDraftValue,
  type WorkspaceMutationCallbacks,
  type WorkspaceShellHandle,
} from './components/Workspace';
import { useStudioProject } from './hooks/useStudioProject';
import {
  parseStudioView,
  rememberStudioView,
  resolveStudioEntryView,
  studioViewPath,
  type StudioView,
} from './studioPhaseRoute';
import styles from './StudioPage.module.css';

type StudioReferenceDecisionIntent =
  | { kind: 'rejected' }
  | { kind: 'generation_gate' }
  | { kind: 'imported_reference'; assetId: string };

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

const beatDraftKey = (beatId: string, field: 'action' | 'look' | 'targetSeconds'): string => `beat.${beatId}.${field}`;

const shotDraftKey = (shotId: string, field: 'line' | 'narration' | 'onScreenText' | 'durationSeconds'): string =>
  `shot.${shotId}.${field}`;

const cloneBinItem = (item: StudioBinItem): StudioBinItem => {
  if (item.kind === 'beat') return { kind: 'beat', beatId: item.beatId, reason: item.reason };
  if (item.kind === 'shot') {
    return { kind: 'shot', beatId: item.beatId, shotId: item.shotId, reason: 'lifted' };
  }
  return { kind: 'take', assetId: item.assetId, reason: item.reason };
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
    values[beatDraftKey(beatId, 'action')] = beat.action;
    values[beatDraftKey(beatId, 'look')] = beat.look;
    values[beatDraftKey(beatId, 'targetSeconds')] = beat.targetSeconds;
    for (const shotId of beat.shotOrder) {
      const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
      if (shot?.id !== shotId) continue;
      values[shotDraftKey(shotId, 'line')] = shot.line;
      values[shotDraftKey(shotId, 'narration')] = shot.narration;
      values[shotDraftKey(shotId, 'onScreenText')] = shot.onScreenText;
      values[shotDraftKey(shotId, 'durationSeconds')] = shot.durationSeconds;
    }
  }
  return values;
};

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
    referenceRequests,
    referenceGenerationHandoffs,
    workspaceStatus,
    chainStatus,
    routeCatalog,
    exportCatalog,
    loadState,
    errorMessageKey,
    proposalErrorMessageKey,
    referenceErrorMessageKey,
    workspaceErrorMessageKey,
    routeErrorMessageKey,
    exportErrorMessageKey,
    refetchProject,
    refetchProposals,
    refetchReferences,
    refetchWorkspace,
    refetchRoutes,
    refetchExports,
    installExportCatalog,
  } = useStudioProject(projectId);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
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
  const inactiveWorkspaceDraftDirtyCount = countStoredWorkspaceDrafts(projectId);
  const workspaceShellRef = useRef<WorkspaceShellHandle | null>(null);
  const workspacePendingRef = useRef(false);
  const projectRef = useRef<StudioRendererProjectV2 | null>(project);
  projectRef.current = project;
  const exportCatalogRef = useRef<StudioRendererExportCatalogV2 | null>(exportCatalog);
  exportCatalogRef.current = exportCatalog;
  const activeView = routeView ?? resolveStudioEntryView(projectId);

  const projection = useMemo(
    () => (project === null ? null : projectWorkspace(project, workspaceStatus, chainStatus)),
    [chainStatus, project, workspaceStatus]
  );
  const canonicalDraftValues = useMemo(() => (project === null ? {} : projectDraftValues(project)), [project]);
  const drafts = useWorkspaceDrafts({
    projectId,
    projectRevision: project?.revision ?? 1,
    canonicalValues: canonicalDraftValues,
    activeBeatIds: projection?.activeBeatIds ?? [],
    activeShotIds: projection?.activeShotIds ?? [],
    enabled: project !== null,
  });

  useEffect(() => {
    if (routeView !== null) {
      rememberStudioView(projectId, routeView);
      return;
    }
    navigate(studioViewPath(projectId, activeView), { replace: true });
  }, [activeView, navigate, projectId, routeView]);

  const afterPaidConfirm = useCallback(async (): Promise<void> => {
    const [refreshed] = await Promise.all([refetchProject(), refetchWorkspace(), refetchReferences()]);
    if (refreshed !== null) projectRef.current = refreshed;
  }, [refetchProject, refetchReferences, refetchWorkspace]);
  const spendGate = useSpendGate({ onConfirmed: afterPaidConfirm });
  const spendGateLocked = spendGate.state.phase === 'confirming' || spendGate.state.phase === 'quote_in_use';
  const generationDraftsBlockReview =
    activeRuleDraftDirtyCount > 0 || hasGenerationAffectingWorkspaceDrafts(drafts.dirtyKeys);
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
        : routeCatalog.image.status !== 'ready'
          ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
          : null;
  const beatPanelBriefReferenceOptions = useMemo<BeatPanelBriefReferenceOption[]>(() => {
    if (project === null) return [];
    return Object.values(project.assets)
      .flatMap((asset) =>
        asset?.projectId === project.id &&
        asset.shotId === null &&
        asset.mediaKind === 'image' &&
        asset.managedAsset.collection === 'imports' &&
        (asset.briefReferenceRole === 'cast' || asset.briefReferenceRole === 'look') &&
        typeof asset.briefReferenceLabel === 'string'
          ? [{ assetId: asset.id, label: asset.briefReferenceLabel }]
          : []
      )
      .toSorted((left, right) => {
        if (left.label !== right.label) return left.label < right.label ? -1 : 1;
        if (left.assetId === right.assetId) return 0;
        return left.assetId < right.assetId ? -1 : 1;
      });
  }, [project]);
  const beatPanelReviewGraphs = useMemo<BeatPanelReviewGraph[]>(() => {
    if (project === null || projection === null) return [];
    return projection.activeShotIds.flatMap((triggerShotId) => {
      const draft = selectionGateDraft({ project, projection, orderedShotIds: [triggerShotId] });
      if (draft === null) return [];
      const choices = [...draft.baseChoices, ...draft.cascadeChoices].map(({ shotId, purpose }) => ({
        shotId,
        purpose,
      }));
      const [firstChoice, ...remainingChoices] = choices;
      if (firstChoice === undefined) return [];
      return [{ triggerShotId, choices: [firstChoice, ...remainingChoices] }];
    });
  }, [project, projection]);

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
        const refreshed = await refetchProject();
        if (refreshed === null || refreshed.revision !== result.data.projectRevision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return null;
        }
        projectRef.current = refreshed;
        await refetchWorkspace();
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
    [refetchProject, refetchWorkspace, setActionErrorMessageKey]
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
      applyAuthoring: async (operations) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations,
          })
        ),
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
            refreshed = await refetchProject();
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
          try {
            await refetchWorkspace();
          } catch {
            reportRuleAdoptionUnconfirmed(adoptionKey);
            return false;
          }
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
      chooseCascadeAsset: async (row, assetId) => {
        if (row.waitingReason === 'choose_seed') {
          return runWorkspaceCommit((current) =>
            ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
              projectId: current.id,
              expectedRevision: current.revision,
              operations: [{ kind: 'set_seed_still', shotId: row.upstreamShotId, assetId }],
            })
          );
        }
        if (row.waitingReason !== 'choose_take' && row.waitingReason !== 'conditioning_failed') return false;
        return runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.selectTake.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId: row.upstreamShotId,
            assetId,
          })
        );
      },
    }),
    [
      acknowledgeRuleAdoption,
      refetchProject,
      refetchRoutes,
      refetchWorkspace,
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
      setHardCut: async (shotId, hardCut) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'set_hard_cut', shotId, hardCut }],
          })
        ),
      setSeedStill: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'set_seed_still', shotId, assetId }],
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
      redetachLine: async (shotId, line) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'redetach_line', shotId, line }],
          })
        ),
      restoreLine: async (shotId, historyEntryId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'restore_line', shotId, historyEntryId }],
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
          const [refreshed] = await Promise.all([refetchProject(), refetchWorkspace()]);
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
      selectTake: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.selectTake.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId,
            assetId,
          })
        ),
      parkTake: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.parkTake.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId,
            assetId,
          })
        ),
      addAlternateTake: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.addAlternateTake.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId,
            assetId,
          })
        ),
      restoreTake: async (shotId, assetId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.restoreTake.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId,
            assetId,
          })
        ),
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
        if (current === null || projection === null || beatPanelReviewBlockedMessageKey !== null || spendGateLocked) {
          if (beatPanelReviewBlockedMessageKey !== null) setActionErrorMessageKey(beatPanelReviewBlockedMessageKey);
          return;
        }
        const defaultDraft = selectionGateDraft({ project: current, projection, orderedShotIds: [shotId] });
        if (defaultDraft === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
          return;
        }
        const expectedChoices = [...defaultDraft.baseChoices, ...defaultDraft.cascadeChoices];
        const referenceIds = new Set(beatPanelBriefReferenceOptions.map(({ assetId }) => assetId));
        if (
          choices.length !== expectedChoices.length ||
          choices.some((choice, index) => {
            const expected = expectedChoices[index];
            return (
              expected === undefined ||
              choice.shotId !== expected.shotId ||
              choice.purpose !== expected.purpose ||
              !Number.isSafeInteger(choice.generationCount) ||
              choice.generationCount < 1 ||
              choice.generationCount > STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION ||
              (choice.purpose === 'video_take' && choice.referenceAssetId !== null) ||
              (choice.referenceAssetId !== null && !referenceIds.has(choice.referenceAssetId))
            );
          })
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
          return;
        }
        const reviewedChoice = (index: number): BeatPanelReviewChoice => choices[index]!;
        const baseChoices = defaultDraft.baseChoices.map((choice, index) => ({
          ...choice,
          generationCount: reviewedChoice(index).generationCount,
          referenceAssetId: reviewedChoice(index).referenceAssetId,
        }));
        const cascadeChoices = defaultDraft.cascadeChoices.map((choice, index) => ({
          ...choice,
          generationCount: reviewedChoice(defaultDraft.baseChoices.length + index).generationCount,
          referenceAssetId: reviewedChoice(defaultDraft.baseChoices.length + index).referenceAssetId,
        }));
        const draft = selectionGateDraft({
          project: current,
          projection,
          orderedShotIds: [shotId],
          baseChoices,
          cascadeChoices,
        });
        if (draft === null) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
          return;
        }
        if (
          draft.baseChoices.some((choice) => choice.purpose === 'seed_still') &&
          routeCatalog?.image.status !== 'ready'
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
          return;
        }
        if (
          draft.baseChoices.some((choice) => choice.purpose === 'video_take') &&
          routeCatalog?.video.status !== 'ready'
        ) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.videoRouteBlocked');
          return;
        }
        setActionErrorMessageKey(null);
        spendGate.open(draft);
      },
      chooseCascadeAsset: mutations.chooseCascadeAsset,
      retryConditioning: mutations.retryConditioning,
      cancelWaiting: mutations.cancelWaiting,
      requestReviewedRederive: focusDirectorForReviewedRequest,
      requestResplit: focusDirectorForReviewedRequest,
    }),
    [
      beatPanelReviewBlockedMessageKey,
      beatPanelBriefReferenceOptions,
      focusDirectorForReviewedRequest,
      mutations,
      projection,
      refetchProject,
      refetchWorkspace,
      routeCatalog,
      runWorkspaceCommit,
      setActionErrorMessageKey,
      spendGate.open,
      spendGateLocked,
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
      restoreTake: beatPanelActions.restoreTake,
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
          const [refreshed] = await Promise.all([refetchProject(), refetchWorkspace()]);
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
          const [refreshed] = await Promise.all([refetchProject(), refetchWorkspace()]);
          if (refreshed === null || refreshed.revision !== result.data.projectRevision) {
            setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
            return false;
          }
          projectRef.current = refreshed;
          return true;
        })) ?? false,
      setMatchTo: async (shotId) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.setMatchTo.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            shotId,
          })
        ),
      createExport: async (input) =>
        (await runWorkspaceExclusive(async () => {
          const current = projectRef.current;
          const catalog = exportCatalogRef.current;
          if (current === null || catalog === null) return false;
          const request =
            input.shape === 'still'
              ? {
                  projectId: current.id,
                  expectedRevision: current.revision,
                  expectedCatalogRevision: catalog.revision,
                  shape: input.shape,
                  shotId: input.shotId,
                }
              : {
                  projectId: current.id,
                  expectedRevision: current.revision,
                  expectedCatalogRevision: catalog.revision,
                  shape: input.shape,
                };
          const result = await ipcBridge.creativeStudio.createExport.invoke(request);
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return false;
          }
          if (installExportCatalog(result.data)) return true;
          return refetchExports();
        })) ?? false,
      refreshExports: async () => (await runWorkspaceExclusive(refetchExports)) ?? false,
      copyExport: async (artifactId): Promise<CutCopyResult> =>
        (await runWorkspaceExclusive(async () => {
          const current = projectRef.current;
          const catalog = exportCatalogRef.current;
          if (
            current === null ||
            catalog === null ||
            catalog.artifacts.filter((artifact) => artifact.id === artifactId).length !== 1
          ) {
            return 'failed';
          }
          const result = await ipcBridge.creativeStudio.copyExport.invoke({
            projectId: current.id,
            expectedCatalogRevision: catalog.revision,
            artifactId,
          });
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return 'failed';
          }
          return result.data.status;
        })) ?? 'failed',
      revealExport: async (artifactId) =>
        (await runWorkspaceExclusive(async () => {
          const current = projectRef.current;
          const catalog = exportCatalogRef.current;
          if (
            current === null ||
            catalog === null ||
            catalog.artifacts.filter((artifact) => artifact.id === artifactId).length !== 1
          ) {
            return false;
          }
          const result = await ipcBridge.creativeStudio.revealExport.invoke({
            projectId: current.id,
            expectedCatalogRevision: catalog.revision,
            artifactId,
          });
          if (result.ok === false) {
            setActionErrorMessageKey(result.error.messageKey);
            return false;
          }
          return result.data.status === 'revealed';
        })) ?? false,
    }),
    [
      boardActions.reorderBeats,
      installExportCatalog,
      refetchExports,
      refetchProject,
      refetchWorkspace,
      runWorkspaceCommit,
      runWorkspaceExclusive,
      setActionErrorMessageKey,
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
      const changes: Partial<Pick<typeof beat, 'action' | 'look' | 'targetSeconds'>> = {};
      for (const field of ['action', 'look', 'targetSeconds'] as const) {
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
        const shotChanges: Partial<Pick<typeof shot, 'line' | 'narration' | 'onScreenText' | 'durationSeconds'>> = {};
        for (const field of ['line', 'narration', 'onScreenText', 'durationSeconds'] as const) {
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
    const [projectOutcome] = await Promise.allSettled([refetchProject(), refetchProposals(), refetchWorkspace()]);
    if (projectOutcome.status === 'fulfilled' && projectOutcome.value !== null) {
      projectRef.current = projectOutcome.value;
    }
  }, [refetchProject, refetchProposals, refetchWorkspace]);

  const acceptProposal = useCallback(
    async (proposalId: string): Promise<void> => {
      if (pendingActionId !== null) return;
      const target = proposals.find((proposal) => proposal.id === proposalId && proposal.status === 'pending');
      if (drafts.dirtyCount > 0 && target?.payload.kind === 'mutation_batch') {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.proposals.saveBeforeApply');
        return;
      }
      setPendingActionId(proposalId);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.acceptProposal.invoke({ projectId, proposalId });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          await refreshProposalAuthority();
          return;
        }
        await refreshProposalAuthority();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        await refreshProposalAuthority();
      } finally {
        setPendingActionId(null);
      }
    },
    [drafts.dirtyCount, pendingActionId, projectId, proposals, refreshProposalAuthority, setActionErrorMessageKey]
  );

  const rejectProposal = useCallback(
    async (proposalId: string): Promise<void> => {
      if (pendingActionId !== null) return;
      setPendingActionId(proposalId);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.rejectProposal.invoke({ projectId, proposalId });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return;
        }
        await refetchProposals();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        setPendingActionId(null);
      }
    },
    [pendingActionId, projectId, refetchProposals, setActionErrorMessageKey]
  );

  const decideReferences = useCallback(
    async (requestId: string, outcome: StudioReferenceDecisionIntent): Promise<void> => {
      if (pendingActionId !== null || project === null) return;
      setPendingActionId(requestId);
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
        await refetchReferences();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        setPendingActionId(null);
      }
    },
    [pendingActionId, project, projectId, refetchReferences, setActionErrorMessageKey]
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
      if (routeCatalog?.image.status !== 'ready') {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
        return;
      }
      const draft = handoffGateDraft(current, projection, handoff);
      if (draft === null) {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
        return;
      }
      spendGate.open(draft);
    },
    [
      generationDraftsBlockReview,
      projection,
      routeCatalog,
      setActionErrorMessageKey,
      spendGate.open,
      statusBlocksReview,
    ]
  );

  const dismissHandoff = useCallback(
    async (handoff: StudioRendererReferenceGenerationHandoffV2): Promise<void> => {
      const current = projectRef.current;
      if (current === null || pendingActionId !== null) return;
      setPendingActionId(handoff.handoffId);
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
        setPendingActionId(null);
      }
    },
    [pendingActionId, refetchReferences, setActionErrorMessageKey]
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
  const hasReviewedDirectorOutput =
    actionableProposals.length > 0 ||
    referenceRequests.length > 0 ||
    referenceGenerationHandoffs.length > 0 ||
    proposalErrorMessageKey !== null ||
    referenceErrorMessageKey !== null;

  return (
    <>
      <WorkspaceShell
        ref={workspaceShellRef}
        project={project}
        activeView={activeView}
        stats={projection === null ? undefined : buildStudioBarStats(projection)}
        projectMenu={
          projection === null ? undefined : (
            <WorkspaceProjectMenu
              project={project}
              projection={projection}
              routeCatalog={routeCatalog}
              drafts={drafts}
              pending={workspacePending}
              errorMessageKey={actionErrorMessageKey ?? workspaceErrorMessageKey ?? routeErrorMessageKey}
              mutations={mutations}
              onRuleDraftDirtyCountChange={setRuleDraftDirtyCount}
              onActiveRuleDraftDirtyCountChange={setActiveRuleDraftDirtyCount}
            />
          )
        }
        notice={
          actionErrorMessageKey === null && workspaceErrorMessageKey === null && routeErrorMessageKey === null
            ? undefined
            : t(actionErrorMessageKey ?? workspaceErrorMessageKey ?? routeErrorMessageKey!)
        }
        reviewedOutput={
          hasReviewedDirectorOutput ? (
            <DirectorProposals
              proposals={actionableProposals}
              referenceRequests={referenceRequests}
              referenceGenerationHandoffs={referenceGenerationHandoffs}
              pendingActionId={pendingActionId}
              blockMutationProposalAcceptance={drafts.dirtyCount > 0}
              proposalErrorMessageKey={proposalErrorMessageKey}
              referenceErrorMessageKey={referenceErrorMessageKey}
              onAcceptProposal={acceptProposal}
              onRejectProposal={rejectProposal}
              onGenerateReferences={(requestId) => decideReferences(requestId, { kind: 'generation_gate' })}
              onRejectReferences={(requestId) => decideReferences(requestId, { kind: 'rejected' })}
              onReviewHandoff={reviewHandoff}
              onDismissHandoff={dismissHandoff}
              gateLocked={spendGateLocked}
              reviewBlockedMessageKey={handoffReviewBlockedMessageKey}
            />
          ) : undefined
        }
      >
        {projection === null ? null : (
          <WorkspaceControls
            activeView={activeView}
            boardActions={boardActions}
            cutActions={cutActions}
            project={project}
            projection={projection}
            exportCatalog={exportCatalog}
            drafts={drafts}
            pending={workspacePending}
            gateLocked={spendGateLocked}
            errorMessageKey={actionErrorMessageKey ?? workspaceErrorMessageKey ?? routeErrorMessageKey}
            exportErrorMessageKey={exportErrorMessageKey}
            mutations={mutations}
            beatPanelActions={beatPanelActions}
            beatPanelBriefReferenceOptions={beatPanelBriefReferenceOptions}
            beatPanelReviewGraphs={beatPanelReviewGraphs}
            beatPanelReviewBlockedMessageKey={beatPanelReviewBlockedMessageKey}
          />
        )}
      </WorkspaceShell>
      <SpendGateModal
        state={spendGate.state}
        close={spendGate.close}
        prepare={spendGate.prepare}
        selectOption={spendGate.selectOption}
        confirm={spendGate.confirm}
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
