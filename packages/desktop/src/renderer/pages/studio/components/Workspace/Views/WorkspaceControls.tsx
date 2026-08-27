/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BeatPanel } from '../BeatPanel';
import { BoardView, binItemFocusKey } from './Board';
import { CutView } from './Cut';
import { ReferencesView, type ReferenceWorkspaceItem } from './References';
import { TableView, type ReferenceBindingWorkspaceItem } from './Table';
import type { WorkspaceControlsProps } from './viewTypes';
import styles from './WorkspaceControls.module.css';

export const WorkspaceControls: React.FC<WorkspaceControlsProps> = ({
  activeView,
  project,
  projection,
  drafts,
  pending,
  gateLocked,
  imageRouteReady,
  errorMessageKey,
  mutations,
  tableBoardActions,
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
}) => {
  const { t } = useTranslation();
  const [openPanel, setOpenPanel] = useState<{
    projectId: string;
    beatId: string;
    view: WorkspaceControlsProps['activeView'];
  } | null>(null);
  const [binFocusIntent, setBinFocusIntent] = useState<{ projectId: string; itemKey: string } | null>(null);
  const [shotLiftAnnouncement, setShotLiftAnnouncement] = useState('');
  const currentProjectId = useRef(project.id);
  currentProjectId.current = project.id;
  const openBeatId = openPanel?.projectId === project.id && openPanel.view === activeView ? openPanel.beatId : null;
  const openBeatIndex = openBeatId === null ? -1 : projection.activeBeats.findIndex((beat) => beat.id === openBeatId);
  const openBeat = openBeatIndex < 0 ? null : (projection.activeBeats[openBeatIndex] ?? null);
  const dirtyBeatIds = useMemo(() => {
    const dirtyKeys = new Set(drafts.dirtyKeys);
    return projection.activeBeats.flatMap((beat) => {
      const beatKeys = [
        `beat.${beat.id}.story`,
        `beat.${beat.id}.targetSeconds`,
        ...beat.shots.flatMap((shot) => [`shot.${shot.id}.shootingScript`, `shot.${shot.id}.durationSeconds`]),
      ];
      return beatKeys.some((key) => dirtyKeys.has(key)) ? [beat.id] : [];
    });
  }, [drafts.dirtyKeys, projection.activeBeats]);
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
        const latestReferenceJobId =
          currentAsset?.projectReferenceId === reference.id && currentAsset.producerJobId !== null
            ? currentAsset.producerJobId
            : ([...reference.jobIds]
                .toReversed()
                .find(
                  (jobId) => Object.hasOwn(project.jobs, jobId) && project.jobs[jobId]?.target.kind === 'reference'
                ) ?? null);
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
    <div className={styles.root} data-studio-workspace-controls data-active-view={activeView}>
      {activeView === 'references' ? (
        <ReferencesView
          actions={
            referenceActions ?? {
              addBackground: async () => false,
              updateDetails: async () => false,
              selectImage: async () => false,
              regenerate: async () => false,
              retryJob: async () => false,
              retryDownload: async () => false,
              cancelJob: async () => false,
              openBindings: () => {},
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
          actions={tableBoardActions}
          beats={projection.activeBeats}
          bindingActions={referenceActions ?? { saveBinding: async () => false }}
          boardStyle={project.boardStyle}
          boardPanels={projection.boardPanels}
          gateLocked={gateLocked}
          imageRouteReady={imageRouteReady}
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
          onReferenceFocusIntentConsumed={onReferenceFocusIntentConsumed}
        />
      ) : null}
      {activeView === 'board' ? (
        <BoardView
          actions={boardActions}
          binFocusAnnouncement={shotLiftAnnouncement}
          binFocusItemKey={binFocusIntent?.projectId === project.id ? binFocusIntent.itemKey : null}
          dirtyBeatIds={dirtyBeatIds}
          onBinFocusItemSettled={() => setBinFocusIntent(null)}
          onOpenBeat={selectAndOpenBeat}
          pending={pending}
          projectId={project.id}
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
