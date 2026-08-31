/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo } from 'react';
import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  type StudioBinItem,
  type StudioCommandResult,
  type StudioGenerationBlockV2,
  type StudioGenerationCapabilityV2,
  type StudioRendererJobV2,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererProjectV2,
  type StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  boardGateDraft,
  boardPromotionGatePlan,
  boardSelectionGateDraft,
  seedRegenerationGateDraft,
  selectionGateDraft,
  type BeatPanelActions,
  type BeatPanelImportResult,
  type BoardActions,
  type CutActions,
  type CutImportResult,
  type SpendGateDraft,
  type UseSpendGateResult,
  type WorkspaceMutationCallbacks,
  type WorkspaceProjection,
} from '../components/Workspace';
import { generationBlockGroupsForItems } from '../components/Workspace/Gate/generationBlockers';
import { shotCapabilityItemsForDraft } from './spendOrchestration';

type MutableValueRef<Value> = { current: Value };

type StudioRunWorkspaceCommit = (
  invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>,
  onCommitted?: () => void
) => Promise<boolean>;

type StudioRunJobRecovery = (
  jobId: string,
  isAuthorized: (job: StudioRendererJobV2, project: StudioRendererProjectV2) => boolean,
  invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererJobV2>>,
  options?: { refreshBeforeInvoke?: boolean }
) => Promise<boolean>;

type StudioRunWorkspaceExclusive = <Result>(action: () => Promise<Result>) => Promise<Result | null>;

type StudioMediaViewAdaptersInput = {
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  projectionRef: MutableValueRef<WorkspaceProjection | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  setWorkspacePending: (pending: boolean) => void;
  setActionErrorMessageKey: (messageKey: string | null) => void;
  refetchProjectWorkspace: () => Promise<StudioRendererProjectV2 | null>;
  refetchRoutes: () => Promise<boolean>;
  runWorkspaceCommit: StudioRunWorkspaceCommit;
  runJobRecovery: StudioRunJobRecovery;
  runWorkspaceExclusive: StudioRunWorkspaceExclusive;
  mutations: WorkspaceMutationCallbacks;
  beatPanelReviewBlockedMessageKey: string | null;
  spendGateLocked: boolean;
  spendGateOpen: UseSpendGateResult['open'];
  currentGenerationCapability: StudioGenerationCapabilityV2 | null;
  routeCatalog: StudioRouteCatalogV2 | null;
  projection: WorkspaceProjection | null;
  generationDraftsBlockReview: boolean;
  openContinuityReview: BeatPanelActions['reviewContinuity'];
  openReferenceFocus: (focus: { shotIds?: readonly string[] }) => void;
  focusDirectorForReviewedRequest: BeatPanelActions['requestResplit'];
  cancelAndQueueRejoinReview: BeatPanelActions['cancelAndReviewRejoin'];
  navigate: (path: string) => void;
  setBriefRouteFocusRole: (role: 'image' | 'video' | null) => void;
  setBriefDialogRequest: (update: (request: number) => number) => void;
  openBoardSpendGate: (
    buildDraft: (current: StudioRendererProjectV2, exactProjection: WorkspaceProjection) => SpendGateDraft | null
  ) => void;
};

const cloneBinItem = (item: StudioBinItem): StudioBinItem => {
  if (item.kind === 'beat') return { kind: 'beat', beatId: item.beatId, reason: item.reason };
  return { kind: 'shot', beatId: item.beatId, shotId: item.shotId, reason: 'lifted' };
};

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

export const useStudioMediaViewAdapters = ({
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
  spendGateOpen,
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
}: StudioMediaViewAdaptersInput) => {
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
        spendGateOpen(
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
        spendGateOpen(
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
      spendGateOpen,
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
          // Board stops advance one revision at a time; parallel cancellation would invalidate authority.
          // eslint-disable-next-line no-await-in-loop
          result = await ipcBridge.creativeStudio.cancelJob.invoke({
            projectId: authority.id,
            jobId: job.id,
            expectedRevision: authority.revision,
          });
        } catch {
          failureMessageKey ??= 'conversation.creativeStudio.workspace.errors.storage';
        }

        // The next candidate must use the exact authority published by this cancellation attempt.
        // eslint-disable-next-line no-await-in-loop
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

  const boardProductionActions = useMemo<Omit<BoardActions, 'restoreBeat' | 'restoreShot' | 'reorderBin'>>(
    () => ({
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
        spendGateOpen(
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
      openBoardSpendGate,
      projection,
      routeCatalog,
      runJobRecovery,
      setActionErrorMessageKey,
      spendGateOpen,
      spendGateLocked,
      stopBoardJobs,
    ]
  );

  const boardActions = useMemo<BoardActions>(
    () => ({
      ...boardProductionActions,
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
    [boardProductionActions, runWorkspaceCommit]
  );

  const cutActions = useMemo<CutActions>(
    () => ({
      reorderBeats: async (beatOrder) =>
        runWorkspaceCommit((current) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: current.id,
            expectedRevision: current.revision,
            operations: [{ kind: 'reorder_beats', beatOrder: [...beatOrder] }],
          })
        ),
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
    [refetchProjectWorkspace, runWorkspaceCommit, runWorkspaceExclusive, setActionErrorMessageKey]
  );
  return { beatPanelActions, boardActions, cutActions };
};
