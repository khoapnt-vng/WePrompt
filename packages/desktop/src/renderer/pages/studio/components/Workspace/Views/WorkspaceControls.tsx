/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { STUDIO_MIN_SHOT_SECONDS } from '@/common/types/project/creativeStudioTypes';
import { uuid } from '@/common/utils';

import { BeatPanel } from '../BeatPanel';
import { BoardView, binItemFocusKey } from './Board';
import { CutView } from './Cut';
import { ReferencesView, type ReferenceWorkspaceItem } from './References';
import { deriveReferenceRemovalBlockers } from './References/referenceRemovalBlockers';
import { TableView, type ReferenceBindingWorkspaceItem } from './Table';
import type { WorkspaceAuthoringOperationV2, WorkspaceControlsProps } from './viewTypes';
import styles from './WorkspaceControls.module.css';

type TableBeatReorderOperation = Extract<WorkspaceAuthoringOperationV2, { kind: 'reorder_beats' }>;

export const tableBeatReorderOperation = ({
  activeBeatIds,
  activeView,
  beatOrder,
  gateLocked,
  pending,
}: {
  activeBeatIds: readonly string[];
  activeView: WorkspaceControlsProps['activeView'];
  beatOrder: readonly string[];
  gateLocked: boolean;
  pending: boolean;
}): TableBeatReorderOperation | null => {
  if (
    pending ||
    gateLocked ||
    activeView !== 'table' ||
    beatOrder.length !== activeBeatIds.length ||
    new Set(beatOrder).size !== beatOrder.length ||
    beatOrder.some((beatId) => !activeBeatIds.includes(beatId))
  ) {
    return null;
  }
  return { kind: 'reorder_beats', beatOrder: [...beatOrder] };
};

export const WorkspaceControls: React.FC<WorkspaceControlsProps> = ({
  activeView,
  project,
  projectStatus,
  projectStatusPending,
  projection,
  drafts,
  pending,
  gateLocked,
  imageRouteReady,
  errorMessageKey,
  mutations,
  boardActions,
  cutActions,
  beatPanelActions,
  beatPanelReviewGraphs,
  beatPanelReviewBlockedMessageKey,
  referenceActions,
  referenceMaxConditioningImages = null,
  referencePendingId = null,
  referenceErrorMessageKey = null,
  referenceFocusIntent = null,
  onReferenceFocusIntentConsumed,
  shotEditFocusIntent = null,
  onShotEditFocusIntentConsumed,
  onReviewShotReferenceBinding,
}) => {
  const { t } = useTranslation();
  const [openPanel, setOpenPanel] = useState<{
    projectId: string;
    beatId: string;
    view: WorkspaceControlsProps['activeView'];
  } | null>(null);
  const [binFocusIntent, setBinFocusIntent] = useState<{ projectId: string; itemKey: string } | null>(null);
  const [shotLiftAnnouncement, setShotLiftAnnouncement] = useState('');
  const [pendingAuthoringOpen, setPendingAuthoringOpen] = useState<{
    projectId: string;
    view: WorkspaceControlsProps['activeView'];
    sourceRevision: number;
    beatId: string;
    shotId: string | null;
  } | null>(null);
  const currentProjectId = useRef(project.id);
  currentProjectId.current = project.id;
  const currentView = useRef(activeView);
  currentView.current = activeView;
  const openedShotEditFocusIntentRef = useRef<{ projectId: string; intentId: string } | null>(null);
  const clearedShotEditFocusIntentRef = useRef<{ projectId: string; intentId: string } | null>(null);
  const openBeatId = openPanel?.projectId === project.id && openPanel.view === activeView ? openPanel.beatId : null;
  const openBeatIndex = openBeatId === null ? -1 : projection.activeBeats.findIndex((beat) => beat.id === openBeatId);
  const openBeat = openBeatIndex < 0 ? null : (projection.activeBeats[openBeatIndex] ?? null);
  const panelShotEditFocusIntent =
    shotEditFocusIntent !== null &&
    shotEditFocusIntent.projectId === project.id &&
    shotEditFocusIntent.view === activeView &&
    openBeat?.id === shotEditFocusIntent.beatId &&
    shotEditFocusIntent.shotIds.length > 0 &&
    shotEditFocusIntent.shotIds.every((shotId) => openBeat.shots.some((shot) => shot.id === shotId))
      ? shotEditFocusIntent
      : null;
  const projectReferences = useMemo<ReferenceWorkspaceItem[]>(
    () =>
      project.referenceOrder.flatMap((referenceId) => {
        const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
        if (reference?.id !== referenceId) return [];
        const currentAsset =
          reference.approvedAssetId !== null && Object.hasOwn(project.assets, reference.approvedAssetId)
            ? project.assets[reference.approvedAssetId]
            : undefined;
        const generatedAssetIds = [
          ...(reference.approvedAssetId === null ? [] : [reference.approvedAssetId]),
          ...reference.supersededAssetIds,
        ].filter((assetId, index, assetIds) => assetIds.indexOf(assetId) === index);
        const historicalAssetIds = Object.values(project.assets)
          .filter(
            (asset) =>
              asset.projectId === project.id &&
              asset.shotId === null &&
              asset.mediaKind === 'image' &&
              asset.projectReferenceId === reference.id
          )
          .map((asset) => asset.id)
          .toSorted((left, right) => {
            const leftAsset = Object.hasOwn(project.assets, left) ? project.assets[left] : undefined;
            const rightAsset = Object.hasOwn(project.assets, right) ? project.assets[right] : undefined;
            const byCreatedAt = (leftAsset?.createdAt ?? '').localeCompare(rightAsset?.createdAt ?? '');
            return byCreatedAt === 0 ? left.localeCompare(right) : byCreatedAt;
          });
        const assetOrdinalById = Object.fromEntries(historicalAssetIds.map((assetId, index) => [assetId, index]));
        const assetCreatedAt = Object.fromEntries(
          generatedAssetIds.flatMap((assetId) => {
            const asset = Object.hasOwn(project.assets, assetId) ? project.assets[assetId] : undefined;
            return asset?.id === assetId && asset.projectReferenceId === reference.id
              ? ([[assetId, asset.createdAt]] as const)
              : [];
          })
        );
        const approvedProducerJob =
          currentAsset?.projectReferenceId === reference.id &&
          currentAsset.producerJobId !== null &&
          Object.hasOwn(project.jobs, currentAsset.producerJobId)
            ? project.jobs[currentAsset.producerJobId]
            : undefined;
        const approvedSource = approvedProducerJob?.composition.inputs.source;
        const lastRunPrompt =
          approvedProducerJob?.target.kind === 'reference' &&
          approvedProducerJob.target.referenceId === reference.id &&
          approvedSource?.kind === 'project_reference' &&
          approvedSource.referenceId === reference.id
            ? approvedSource.prompt
            : null;
        const currentIsImported =
          currentAsset?.projectReferenceId === reference.id && currentAsset.managedAsset.collection === 'imports';
        const latestReferenceJobId =
          currentAsset?.projectReferenceId === reference.id && currentAsset.producerJobId !== null
            ? currentAsset.producerJobId
            : ([...reference.jobIds].toReversed().find((jobId) => {
                const job = Object.hasOwn(project.jobs, jobId) ? project.jobs[jobId] : undefined;
                if (job?.target.kind !== 'reference') return false;
                const nonterminal =
                  job.status === 'waiting_for_conditioning' ||
                  job.status === 'queued_local' ||
                  job.status === 'submitting' ||
                  job.status === 'queued_remote' ||
                  job.status === 'running' ||
                  job.status === 'needs_attention';
                return !currentIsImported || nonterminal || job.updatedAt > currentAsset.createdAt;
              }) ?? null);
        const candidateJob =
          latestReferenceJobId !== null && Object.hasOwn(project.jobs, latestReferenceJobId)
            ? project.jobs[latestReferenceJobId]
            : undefined;
        const candidateJobValid =
          candidateJob?.id === latestReferenceJobId &&
          candidateJob.projectId === project.id &&
          candidateJob.target.kind === 'reference' &&
          candidateJob.target.referenceId === reference.id &&
          candidateJob.purpose === 'reference_image' &&
          reference.jobIds.includes(candidateJob.id);
        const generationStatus: ReferenceWorkspaceItem['generationStatus'] =
          latestReferenceJobId === null
            ? reference.approvedAssetId === null
              ? 'idle'
              : 'succeeded'
            : !candidateJobValid
              ? 'failed'
              : candidateJob.status === 'queued_local' ||
                  candidateJob.status === 'submitting' ||
                  candidateJob.status === 'queued_remote'
                ? 'queued'
                : candidateJob.status === 'running'
                  ? 'running'
                  : candidateJob.status === 'succeeded'
                    ? 'succeeded'
                    : 'failed';
        return [
          {
            id: reference.id,
            kind: reference.kind,
            label: reference.label,
            prompt: reference.prompt,
            lastRunPrompt,
            approvedAssetId: reference.approvedAssetId,
            generatedAssetIds,
            assetCreatedAt,
            assetOrdinalById,
            removalBlockers: deriveReferenceRemovalBlockers(project, reference.id),
            generationStatus,
            candidateJob: candidateJobValid
              ? {
                  id: candidateJob.id,
                  status: candidateJob.status,
                  error: candidateJob.error,
                  canCancel: candidateJob.canCancel,
                  canRetry: candidateJob.canRetry,
                  canRetryDownload: candidateJob.canRetryDownload,
                }
              : null,
          },
        ];
      }),
    [project]
  );
  const referenceBindings = useMemo<ReferenceBindingWorkspaceItem[]>(
    () =>
      projection.activeBeats.flatMap((beat) =>
        beat.shots.flatMap((shot) => {
          const authority = Object.hasOwn(project.shots, shot.id) ? project.shots[shot.id] : undefined;
          if (authority?.id !== shot.id) return [];
          const binding = authority.referenceBinding;
          const referencedCharacters = binding.characterReferenceIds.map((referenceId) =>
            Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined
          );
          const background =
            binding.backgroundReferenceId === null
              ? null
              : Object.hasOwn(project.references, binding.backgroundReferenceId)
                ? project.references[binding.backgroundReferenceId]
                : undefined;
          const bindingValid =
            binding.status === 'ready' &&
            new Set(binding.characterReferenceIds).size === binding.characterReferenceIds.length &&
            referencedCharacters.every(
              (reference, index) =>
                reference?.id === binding.characterReferenceIds[index] &&
                reference.kind === 'character' &&
                reference.approvedAssetId !== null
            ) &&
            (binding.backgroundReferenceId === null ||
              (background?.id === binding.backgroundReferenceId &&
                background.kind === 'background' &&
                background.approvedAssetId !== null));
          return [
            {
              shotId: shot.id,
              status: binding.status === 'unassigned' ? 'unassigned' : bindingValid ? 'ready' : 'invalid',
              characterReferenceIds: [...binding.characterReferenceIds],
              backgroundReferenceId: binding.backgroundReferenceId,
            },
          ];
        })
      ),
    [project.references, project.shots, projection.activeBeats]
  );

  useEffect(() => {
    if (
      openPanel !== null &&
      (openPanel.view !== activeView ||
        openPanel.projectId !== project.id ||
        !projection.activeBeatIds.includes(openPanel.beatId))
    ) {
      setOpenPanel(null);
    }
  }, [activeView, openPanel, project.id, projection.activeBeatIds]);

  useEffect(() => {
    setBinFocusIntent(null);
    setShotLiftAnnouncement('');
  }, [project.id]);

  useEffect(() => {
    setPendingAuthoringOpen(null);
  }, [activeView, project.id]);

  useEffect(() => {
    if (
      shotEditFocusIntent === null ||
      (clearedShotEditFocusIntentRef.current !== null && clearedShotEditFocusIntentRef.current.projectId !== project.id)
    ) {
      openedShotEditFocusIntentRef.current = null;
      clearedShotEditFocusIntentRef.current = null;
    }
  }, [project.id, shotEditFocusIntent]);

  useEffect(() => {
    if (
      shotEditFocusIntent === null ||
      shotEditFocusIntent.projectId !== project.id ||
      shotEditFocusIntent.view !== activeView
    ) {
      return;
    }
    const beat = projection.activeBeats.find((candidate) => candidate.id === shotEditFocusIntent.beatId);
    if (
      shotEditFocusIntent.shotIds.length === 0 ||
      beat === undefined ||
      !shotEditFocusIntent.shotIds.every((shotId) => beat.shots.some((shot) => shot.id === shotId))
    ) {
      if (
        clearedShotEditFocusIntentRef.current?.projectId !== project.id ||
        clearedShotEditFocusIntentRef.current.intentId !== shotEditFocusIntent.id
      ) {
        clearedShotEditFocusIntentRef.current = { projectId: project.id, intentId: shotEditFocusIntent.id };
        onShotEditFocusIntentConsumed?.(shotEditFocusIntent.id);
      }
      return;
    }
    if (
      openedShotEditFocusIntentRef.current?.projectId === project.id &&
      openedShotEditFocusIntentRef.current.intentId === shotEditFocusIntent.id
    ) {
      return;
    }
    openedShotEditFocusIntentRef.current = { projectId: project.id, intentId: shotEditFocusIntent.id };
    drafts.selectBeat(beat.id);
    setOpenPanel({ projectId: project.id, beatId: beat.id, view: activeView });
  }, [activeView, drafts, onShotEditFocusIntentConsumed, project.id, projection.activeBeats, shotEditFocusIntent]);

  useEffect(() => {
    if (pendingAuthoringOpen === null) return;
    if (
      pendingAuthoringOpen.projectId !== project.id ||
      pendingAuthoringOpen.view !== activeView ||
      activeView !== 'table'
    ) {
      setPendingAuthoringOpen(null);
      return;
    }
    const beat = projection.activeBeats.find((candidate) => candidate.id === pendingAuthoringOpen.beatId);
    const identityReady =
      beat !== undefined &&
      (pendingAuthoringOpen.shotId === null ||
        beat.shots.some((candidate) => candidate.id === pendingAuthoringOpen.shotId));
    if (identityReady) {
      drafts.selectBeat(pendingAuthoringOpen.beatId);
      setShotLiftAnnouncement('');
      setOpenPanel({ projectId: project.id, beatId: pendingAuthoringOpen.beatId, view: activeView });
      setPendingAuthoringOpen(null);
      return;
    }
    if (projection.projectRevision > pendingAuthoringOpen.sourceRevision) setPendingAuthoringOpen(null);
  }, [activeView, drafts, pendingAuthoringOpen, project.id, projection.activeBeats, projection.projectRevision]);

  const addBeat = async (): Promise<boolean> => {
    if (pending || gateLocked || activeView !== 'table') return false;
    const expectedProjectId = project.id;
    const expectedView = activeView;
    const sourceRevision = project.revision;
    const beatId = `beat_${uuid(32)}`;
    let committed = false;
    try {
      committed = await mutations.applyAuthoring([
        {
          kind: 'add_beat',
          beatId,
          beat: { title: '', story: '', targetSeconds: null },
          beforeBeatId: null,
        },
      ]);
    } catch {
      return false;
    }
    if (!committed || currentProjectId.current !== expectedProjectId || currentView.current !== expectedView) {
      return false;
    }
    setPendingAuthoringOpen({
      projectId: expectedProjectId,
      view: expectedView,
      sourceRevision,
      beatId,
      shotId: null,
    });
    return true;
  };

  const addShot = async (beatId: string): Promise<boolean> => {
    if (pending || gateLocked || activeView !== 'table' || !projection.activeBeats.some((beat) => beat.id === beatId)) {
      return false;
    }
    const expectedProjectId = project.id;
    const expectedView = activeView;
    const sourceRevision = project.revision;
    const shotId = `shot_${uuid(32)}`;
    let committed = false;
    try {
      committed = await mutations.applyAuthoring([
        {
          kind: 'add_shot',
          beatId,
          shotId,
          shot: { shootingScript: '', durationSeconds: STUDIO_MIN_SHOT_SECONDS },
          beforeShotId: null,
        },
      ]);
    } catch {
      return false;
    }
    if (!committed || currentProjectId.current !== expectedProjectId || currentView.current !== expectedView) {
      return false;
    }
    setPendingAuthoringOpen({
      projectId: expectedProjectId,
      view: expectedView,
      sourceRevision,
      beatId,
      shotId,
    });
    return true;
  };

  const askDirector = (beatId: string): void => {
    if (pending || gateLocked || activeView !== 'table' || !projection.activeBeats.some((beat) => beat.id === beatId)) {
      return;
    }
    drafts.selectBeat(beatId);
    setOpenPanel(null);
    beatPanelActions.requestResplit(beatId);
  };

  const reorderBeats = async (beatOrder: readonly string[]): Promise<boolean> => {
    const operation = tableBeatReorderOperation({
      activeBeatIds: projection.activeBeatIds,
      activeView,
      beatOrder,
      gateLocked,
      pending,
    });
    if (operation === null) return false;
    try {
      return await mutations.applyAuthoring([operation]);
    } catch {
      return false;
    }
  };

  const selectAndOpenBeat = (beatId: string): void => {
    drafts.selectBeat(beatId);
    setShotLiftAnnouncement('');
    setOpenPanel({ projectId: project.id, beatId, view: activeView });
  };
  const completeShotPark = (shotId: string, beatId: string, expectedProjectId: string): void => {
    if (currentProjectId.current !== expectedProjectId) return;
    setShotLiftAnnouncement(t('conversation.creativeStudio.workspace.beatPanel.lift.shotSucceeded'));
    setOpenPanel(null);
    setBinFocusIntent({
      projectId: expectedProjectId,
      itemKey: binItemFocusKey({ kind: 'shot', beatId, shotId, reason: 'lifted' }),
    });
  };
  const panelActions = {
    ...beatPanelActions,
    parkShot: async (shotId: string): Promise<boolean> => {
      const expectedProjectId = project.id;
      const beatId = openBeat?.id ?? null;
      if (beatId === null) return false;
      return beatPanelActions.parkShot(shotId, () => completeShotPark(shotId, beatId, expectedProjectId));
    },
    requestResplit: (beatId: string): void => {
      setOpenPanel(null);
      beatPanelActions.requestResplit(beatId);
    },
    reviewReferences: (shotId: string): void => {
      setOpenPanel(null);
      beatPanelActions.reviewReferences(shotId);
    },
  };

  return (
    <div
      className={styles.root}
      data-active-view={activeView}
      data-aspect-ratio={project.aspectRatio}
      data-studio-workspace-controls
    >
      {activeView === 'references' ? (
        <ReferencesView
          actions={
            referenceActions === undefined
              ? {
                  addBackground: async () => false,
                  updateDetails: async () => false,
                  selectImage: async () => false,
                  removeImage: async () => false,
                  importPhoto: async () => false,
                  regenerate: async () => false,
                  retryJob: async () => false,
                  retryDownload: async () => false,
                  retryBlockingDownload: async () => false,
                  reviewRetainedShot: async () => false,
                  cancelJob: async () => false,
                  openBindings: () => {},
                }
              : {
                  ...referenceActions,
                  reviewRetainedShot: async (claim) => {
                    const expectedProjectId = project.id;
                    const reviewed = await referenceActions.reviewRetainedShot(claim);
                    if (!reviewed || currentProjectId.current !== expectedProjectId) return reviewed;
                    setBinFocusIntent({
                      projectId: expectedProjectId,
                      itemKey: binItemFocusKey(claim.retainedOwner),
                    });
                    setShotLiftAnnouncement(
                      t('conversation.creativeStudio.workspace.referenceWorkflow.panel.removalBlocker.reviewInBoard')
                    );
                    return true;
                  },
                }
          }
          errorMessageKey={referenceErrorMessageKey}
          focusIntent={referenceFocusIntent}
          gateLocked={gateLocked || pending || referenceActions === undefined}
          pendingReferenceId={referencePendingId}
          aspectRatio={project.aspectRatio}
          projectId={project.id}
          references={projectReferences}
          onFocusIntentConsumed={onReferenceFocusIntentConsumed}
        />
      ) : null}
      {activeView === 'table' ? (
        <TableView
          authoringActions={{ addBeat, addShot, askDirector, reorderBeats }}
          beats={projection.activeBeats}
          coverageGapBeatIds={projection.coverageGapBeatIds}
          bindingActions={referenceActions ?? { saveBinding: async () => false }}
          boardPanels={projection.boardPanels}
          gateLocked={gateLocked}
          onOpenBeat={selectAndOpenBeat}
          onSelectBeat={drafts.selectBeat}
          pending={pending}
          projectId={project.id}
          referenceBindings={referenceBindings}
          referenceFocusIntent={referenceFocusIntent}
          referenceMaxConditioningImages={referenceMaxConditioningImages}
          referencePendingId={referencePendingId}
          references={projectReferences}
          selectedBeatId={drafts.selection.selectedBeatId}
          unscriptedShotIds={projection.unscriptedShotIds}
          onReferenceFocusIntentConsumed={onReferenceFocusIntentConsumed}
        />
      ) : null}
      {activeView === 'board' ? (
        <BoardView
          actions={boardActions}
          binFocusAnnouncement={shotLiftAnnouncement}
          binFocusItemKey={binFocusIntent?.projectId === project.id ? binFocusIntent.itemKey : null}
          gateLocked={gateLocked}
          imageRouteReady={imageRouteReady}
          onBinFocusItemSettled={() => setBinFocusIntent(null)}
          onOpenBeat={selectAndOpenBeat}
          onReviewReferenceBinding={onReviewShotReferenceBinding}
          pending={pending}
          previewSuspended={openBeat !== null}
          projectId={project.id}
          projectStatus={projectStatus}
          projectStatusPending={projectStatusPending}
          projection={projection}
          selectedBeatId={drafts.selection.selectedBeatId}
        />
      ) : null}
      {activeView === 'cut' ? (
        <CutView
          actions={cutActions}
          pending={pending}
          projectId={project.id}
          projection={projection}
          onOpenBeat={selectAndOpenBeat}
          onSetTargetDuration={(targetDurationSeconds, authority) =>
            mutations.editProject({ targetDurationSeconds }, authority)
          }
        />
      ) : null}
      {openBeat === null ? null : (
        <BeatPanel
          actions={panelActions}
          aspectRatio={project.aspectRatio}
          beat={openBeat}
          beatIds={projection.activeBeatIds}
          beatIndex={openBeatIndex}
          drafts={drafts}
          errorMessageKey={errorMessageKey}
          gateLocked={gateLocked}
          onClose={() => setOpenPanel(null)}
          onParkShotSuccess={(shotId) => {
            completeShotPark(shotId, openBeat.id, project.id);
          }}
          onSelectBeat={selectAndOpenBeat}
          pending={pending}
          projectId={project.id}
          projection={projection}
          reviewGraphs={beatPanelReviewGraphs}
          reviewBlockedMessageKey={beatPanelReviewBlockedMessageKey}
          referenceBindings={referenceBindings}
          referenceMaxConditioningImages={referenceMaxConditioningImages}
          shotEditFocusIntent={panelShotEditFocusIntent}
          onShotEditFocusIntentConsumed={onShotEditFocusIntentConsumed}
        />
      )}
      {activeView === 'board' ? null : (
        <span aria-atomic='true' aria-live='polite' className={styles.srOnly} data-studio-shot-lift-announcement>
          {shotLiftAnnouncement}
        </span>
      )}
      {drafts.staleRevision ? (
        <Alert type='error' content={t('conversation.creativeStudio.workspace.controls.draftConflict')} />
      ) : null}

      {projection.undoTop !== null ? (
        <div>
          <Button
            disabled={pending || drafts.dirtyCount > 0}
            onClick={() => void mutations.undo(projection.undoTop!.entryId)}
          >
            {t('conversation.creativeStudio.workspace.controls.undo', {
              label: t(`conversation.creativeStudio.workspace.controls.undoLabel.${projection.undoTop.label}`, {
                defaultValue: t('conversation.creativeStudio.workspace.controls.undoLabel.unknown'),
              }),
            })}
          </Button>
          {drafts.dirtyCount > 0 ? (
            <p>{t('conversation.creativeStudio.workspace.beatPanel.blocker.unsavedDrafts')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
