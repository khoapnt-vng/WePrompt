/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import type {
  StudioBriefRuleDraft,
  StudioCommandResult,
  StudioRendererAuthoringOperationV2,
  StudioRendererProjectCommitResultV2,
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { StudioLibrary } from './components/Library';
import { DirectorProposals } from './components/Shell/DirectorProposals';
import {
  SpendGateModal,
  hasGenerationAffectingWorkspaceDrafts,
  handoffGateDraft,
  majorUnitsToMinorUnits,
  projectWorkspace,
  useSpendGate,
  useWorkspaceDrafts,
  WorkspaceControls,
  WorkspaceShell,
  type WorkspaceMutationCallbacks,
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

const StudioCloseResponse: React.FC<{ dirtyDraftCount: number; saveAll: () => Promise<boolean> }> = ({
  dirtyDraftCount,
  saveAll,
}) => {
  const dirtyCountRef = useRef(dirtyDraftCount);
  const saveAllRef = useRef(saveAll);
  dirtyCountRef.current = dirtyDraftCount;
  saveAllRef.current = saveAll;
  useEffect(() => {
    const disposeHasUnsavedWork = ipcBridge.creativeStudio.hasUnsavedWork.provider(() => ({
      dirtyDraftCount: dirtyCountRef.current,
    }));
    const disposeFlushUnsavedWork = ipcBridge.creativeStudio.flushUnsavedWork.provider(async () => ({
      saved: await saveAllRef.current(),
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

const projectRuleDrafts = (project: StudioRendererProjectV2): StudioBriefRuleDraft[] =>
  project.rules.map(({ id, text, predicate }) => ({
    id,
    text,
    predicate: predicate === null ? null : { kind: 'forbidden_terms', terms: [...predicate.terms] },
  }));

const parseRuleDrafts = (value: unknown): StudioBriefRuleDraft[] | null => {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const result: StudioBriefRuleDraft[] = [];
    for (const candidate of parsed) {
      if (typeof candidate !== 'object' || candidate === null) return null;
      const row = candidate as Record<string, unknown>;
      if (typeof row.id !== 'string' || typeof row.text !== 'string') return null;
      if (row.predicate === null) {
        result.push({ id: row.id, text: row.text, predicate: null });
        continue;
      }
      if (typeof row.predicate !== 'object' || row.predicate === null) return null;
      const predicate = row.predicate as Record<string, unknown>;
      if (
        predicate.kind !== 'forbidden_terms' ||
        !Array.isArray(predicate.terms) ||
        !predicate.terms.every((term) => typeof term === 'string')
      ) {
        return null;
      }
      result.push({
        id: row.id,
        text: row.text,
        predicate: { kind: 'forbidden_terms', terms: [...predicate.terms] as string[] },
      });
    }
    return result;
  } catch {
    return null;
  }
};

const StudioProjectPage: React.FC<{ projectId: string; routeView: StudioView | null }> = ({ projectId, routeView }) => {
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
    loadState,
    errorMessageKey,
    proposalErrorMessageKey,
    referenceErrorMessageKey,
    workspaceErrorMessageKey,
    routeErrorMessageKey,
    refetchProject,
    refetchProposals,
    refetchReferences,
    refetchWorkspace,
    refetchRoutes,
  } = useStudioProject(projectId);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionErrorMessageKey, setActionErrorMessageKey] = useState<string | null>(null);
  const [workspacePending, setWorkspacePending] = useState(false);
  const workspacePendingRef = useRef(false);
  const projectRef = useRef<StudioRendererProjectV2 | null>(project);
  projectRef.current = project;
  const activeView = routeView ?? resolveStudioEntryView(projectId);

  const projection = useMemo(
    () => (project === null ? null : projectWorkspace(project, workspaceStatus, chainStatus)),
    [chainStatus, project, workspaceStatus]
  );
  const canonicalDraftValues = useMemo(
    () =>
      project === null
        ? {}
        : {
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
            'brief.rules': JSON.stringify(projectRuleDrafts(project), null, 2),
            'gate.choices': '{}',
          },
    [project]
  );
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
  const generationDraftsBlockReview = hasGenerationAffectingWorkspaceDrafts(drafts.dirtyKeys);
  const statusBlocksReview = projection === null || !projection.workspaceStatusReady || !projection.chainStatusReady;
  const handoffReviewBlockedMessageKey = generationDraftsBlockReview
    ? 'conversation.creativeStudio.workspace.controls.saveBeforeReview'
    : statusBlocksReview
      ? 'conversation.creativeStudio.workspace.controls.statusRequired'
      : routeCatalog === null
        ? 'conversation.creativeStudio.workspace.controls.routeCatalogRequired'
        : routeCatalog.image.status !== 'ready'
          ? 'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
          : null;

  const runWorkspaceCommit = useCallback(
    async (
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>
    ): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || workspacePendingRef.current) return false;
      workspacePendingRef.current = true;
      setWorkspacePending(true);
      setActionErrorMessageKey(null);
      try {
        const result = await invoke(current);
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return false;
        }
        const refreshed = await refetchProject();
        if (refreshed === null || refreshed.revision < result.data.projectRevision) {
          setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
          return false;
        }
        projectRef.current = refreshed;
        await refetchWorkspace();
        return true;
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
        return false;
      } finally {
        workspacePendingRef.current = false;
        setWorkspacePending(false);
      }
    },
    [refetchProject, refetchWorkspace]
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
      setRules: async (rules) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.setRules.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            rules,
          })
        ),
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
        if (row.waitingReason !== 'choose_take') return false;
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
    [refetchRoutes, runWorkspaceCommit]
  );

  const saveAllDrafts = useCallback(async (): Promise<boolean> => {
    if (drafts.staleRevision) return false;
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
      const current = projectRef.current;
      if (current === null) return false;
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
        !(await mutations.editProject(changes as Parameters<typeof mutations.editProject>[0]))
      ) {
        return false;
      }
      ['settings.name', 'settings.targetDurationSeconds'].forEach(drafts.reset);
      if (projection?.requestShapeLocked !== true) {
        ['settings.aspectRatio', 'settings.resolution'].forEach(drafts.reset);
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
      const current = projectRef.current;
      if (current === null) return false;
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
      if (operations.length > 0 && !(await mutations.applyAuthoring(operations))) return false;
      authoringKeys.forEach(drafts.reset);
    }

    if (dirty.has('brief.rules')) {
      const rules = parseRuleDrafts(drafts.value('brief.rules'));
      if (rules === null || !(await mutations.setRules(rules))) return false;
      drafts.reset('brief.rules');
    }
    return !hasBlockedShapeDraft;
  }, [drafts, mutations, projection?.requestShapeLocked]);

  const acceptProposal = useCallback(
    async (proposalId: string): Promise<void> => {
      if (pendingActionId !== null) return;
      setPendingActionId(proposalId);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.acceptProposal.invoke({ projectId, proposalId });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return;
        }
        await Promise.all([refetchProject(), refetchProposals()]);
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        setPendingActionId(null);
      }
    },
    [pendingActionId, projectId, refetchProject, refetchProposals]
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
    [pendingActionId, projectId, refetchProposals]
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
    [pendingActionId, project, projectId, refetchReferences]
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
    [generationDraftsBlockReview, projection, routeCatalog, spendGate.open, statusBlocksReview]
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
    [pendingActionId, refetchReferences]
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

  const hasReviewedDirectorOutput =
    proposals.some((proposal) => proposal.status === 'pending') ||
    referenceRequests.length > 0 ||
    referenceGenerationHandoffs.length > 0 ||
    proposalErrorMessageKey !== null ||
    referenceErrorMessageKey !== null;

  return (
    <>
      <StudioCloseResponse dirtyDraftCount={drafts.dirtyCount} saveAll={saveAllDrafts} />
      <WorkspaceShell
        project={project}
        activeView={activeView}
        notice={actionErrorMessageKey === null ? undefined : t(actionErrorMessageKey)}
        reviewedOutput={
          hasReviewedDirectorOutput ? (
            <DirectorProposals
              proposals={proposals}
              referenceRequests={referenceRequests}
              referenceGenerationHandoffs={referenceGenerationHandoffs}
              pendingActionId={pendingActionId}
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
            project={project}
            projection={projection}
            routeCatalog={routeCatalog}
            drafts={drafts}
            pending={workspacePending}
            gateLocked={spendGateLocked}
            errorMessageKey={workspaceErrorMessageKey ?? routeErrorMessageKey}
            mutations={mutations}
            openSpendGate={spendGate.open}
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
  return (
    <div className={`${styles.page} ${id ? styles.pageProject : ''}`} data-studio-workspace>
      {id ? <StudioProjectPage projectId={id} routeView={routeView} /> : <StudioLibrary />}
    </div>
  );
};

export default StudioPage;
