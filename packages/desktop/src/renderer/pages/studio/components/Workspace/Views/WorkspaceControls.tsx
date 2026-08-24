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
import { TableView } from './Table';
import type { WorkspaceControlsProps } from './viewTypes';
import styles from './WorkspaceControls.module.css';

export const WorkspaceControls: React.FC<WorkspaceControlsProps> = ({
  activeView,
  project,
  projection,
  exportCatalog,
  drafts,
  pending,
  gateLocked,
  errorMessageKey,
  exportErrorMessageKey,
  mutations,
  tableBoardActions,
  boardActions,
  cutActions,
  beatPanelActions,
  beatPanelReviewGraphs,
  beatPanelReviewBlockedMessageKey,
  referenceActions,
  referencePendingId = null,
  referenceErrorMessageKey = null,
  focusedReferenceIds = [],
  focusedReferenceAssetIds = [],
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
        `beat.${beat.id}.action`,
        `beat.${beat.id}.look`,
        `beat.${beat.id}.targetSeconds`,
        ...beat.shots.flatMap((shot) => [
          `shot.${shot.id}.line`,
          `shot.${shot.id}.narration`,
          `shot.${shot.id}.onScreenText`,
          `shot.${shot.id}.durationSeconds`,
        ]),
      ];
      return beatKeys.some((key) => dirtyKeys.has(key)) ? [beat.id] : [];
    });
  }, [drafts.dirtyKeys, projection.activeBeats]);
  const projectReferences = useMemo<ReferenceWorkspaceItem[]>(
    () =>
      project.referenceOrder.flatMap((referenceId) => {
        const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
        if (reference?.id !== referenceId) return [];
        const candidateJob =
          reference.candidateJobId !== null && Object.hasOwn(project.jobs, reference.candidateJobId)
            ? project.jobs[reference.candidateJobId]
            : undefined;
        const candidateJobValid =
          candidateJob?.id === reference.candidateJobId &&
          candidateJob.projectId === project.id &&
          candidateJob.projectReferenceId === reference.id &&
          candidateJob.purpose === 'seed_still' &&
          Object.hasOwn(project.shots, candidateJob.shotId) &&
          project.shots[candidateJob.shotId]?.id === candidateJob.shotId &&
          project.shots[candidateJob.shotId]?.jobIds.includes(candidateJob.id);
        const generationStatus: ReferenceWorkspaceItem['generationStatus'] =
          reference.candidateJobId === null
            ? reference.candidateAssetId === null
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
            description: reference.prompt,
            approvedAssetId: reference.approvedAssetId,
            candidateAssetId: reference.candidateAssetId,
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
  const referencesReady =
    projectReferences.length === project.referenceOrder.length &&
    projectReferences.every((reference) => reference.approvedAssetId !== null);

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
    requestReviewedRederive: (shotId: string): void => {
      setOpenPanel(null);
      beatPanelActions.requestReviewedRederive(shotId);
    },
    requestResplit: (beatId: string): void => {
      setOpenPanel(null);
      beatPanelActions.requestResplit(beatId);
    },
  };

  return (
    <div className={styles.root} data-studio-workspace-controls data-active-view={activeView}>
      {activeView === 'references' ? (
        <ReferencesView
          actions={
            referenceActions ?? {
              approve: async () => false,
              regenerate: () => undefined,
              retryJob: async () => false,
              retryDownload: async () => false,
              cancelJob: async () => false,
              continueToTable: () => undefined,
            }
          }
          errorMessageKey={referenceErrorMessageKey}
          focusedAssetIds={focusedReferenceAssetIds}
          focusedReferenceIds={focusedReferenceIds}
          gateLocked={gateLocked || referenceActions === undefined}
          pendingReferenceId={referencePendingId}
          projectId={project.id}
          readyForTable={referencesReady}
          references={projectReferences}
        />
      ) : null}
      {activeView === 'table' ? (
        <TableView
          actions={tableBoardActions}
          beats={projection.activeBeats}
          boardStyle={project.boardStyle}
          boardPanels={projection.boardPanels}
          gateLocked={gateLocked}
          onOpenBeat={selectAndOpenBeat}
          onSelectBeat={drafts.selectBeat}
          pending={pending}
          projectId={project.id}
          selectedBeatId={drafts.selection.selectedBeatId}
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
          exportCatalog={exportCatalog}
          exportErrorMessageKey={exportErrorMessageKey}
          pending={pending}
          projectId={project.id}
          projection={projection}
          onOpenBeat={selectAndOpenBeat}
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
