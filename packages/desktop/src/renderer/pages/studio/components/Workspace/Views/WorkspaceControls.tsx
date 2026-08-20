/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Card, Input, InputNumber, Select } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioBriefRuleDraft } from '@/common/types/project/creativeStudioTypes';
import { majorUnitsToMinorUnits } from '../spendGate';
import type { WorkspaceDraftValue } from '../useWorkspaceDrafts';
import { BeatPanel } from '../BeatPanel';
import { BoardView, binItemFocusKey } from './Board';
import { CutView } from './Cut';
import { TableView } from './Table';
import type { WorkspaceControlsProps } from './viewTypes';
import styles from './WorkspaceControls.module.css';

const asString = (value: WorkspaceDraftValue | undefined): string => (typeof value === 'string' ? value : '');
const asNumber = (value: WorkspaceDraftValue | undefined): number => (typeof value === 'number' ? value : 0);

const parseRules = (value: string): StudioBriefRuleDraft[] | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const result: StudioBriefRuleDraft[] = [];
    for (const candidate of parsed) {
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        !Object.hasOwn(candidate, 'id') ||
        !Object.hasOwn(candidate, 'text') ||
        !Object.hasOwn(candidate, 'predicate')
      ) {
        return null;
      }
      const row = candidate as Record<string, unknown>;
      if (typeof row.id !== 'string' || typeof row.text !== 'string') return null;
      if (row.predicate === null) {
        result.push({ id: row.id, text: row.text, predicate: null });
        continue;
      }
      const predicate = row.predicate as Record<string, unknown>;
      if (
        typeof predicate !== 'object' ||
        predicate === null ||
        predicate.kind !== 'forbidden_terms' ||
        !Array.isArray(predicate.terms) ||
        !predicate.terms.every((term) => typeof term === 'string')
      ) {
        return null;
      }
      result.push({ id: row.id, text: row.text, predicate: { kind: 'forbidden_terms', terms: predicate.terms } });
    }
    return result;
  } catch {
    return null;
  }
};

export const WorkspaceControls: React.FC<WorkspaceControlsProps> = ({
  activeView,
  project,
  projection,
  routeCatalog,
  exportCatalog,
  drafts,
  pending,
  gateLocked,
  errorMessageKey,
  exportErrorMessageKey,
  mutations,
  boardActions,
  cutActions,
  beatPanelActions,
  beatPanelBriefReferenceOptions,
  beatPanelReviewGraphs,
  beatPanelReviewBlockedMessageKey,
}) => {
  const { t } = useTranslation();
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<{ projectId: string; beatId: string } | null>(null);
  const [binFocusIntent, setBinFocusIntent] = useState<{ projectId: string; itemKey: string } | null>(null);
  const [shotLiftAnnouncement, setShotLiftAnnouncement] = useState('');
  const currentProjectId = useRef(project.id);
  currentProjectId.current = project.id;
  const openBeatId = activeView !== 'cut' && openPanel?.projectId === project.id ? openPanel.beatId : null;
  const rulesValue = asString(drafts.value('brief.rules'));
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

  useEffect(() => {
    if (
      openPanel !== null &&
      (activeView === 'cut' ||
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
    setOpenPanel({ projectId: project.id, beatId });
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

  const saveSettings = async (): Promise<void> => {
    const changes: Record<string, unknown> = {
      name: asString(drafts.value('settings.name')).trim(),
      targetDurationSeconds: asNumber(drafts.value('settings.targetDurationSeconds')),
    };
    if (!projection.requestShapeLocked) {
      changes.aspectRatio = asString(drafts.value('settings.aspectRatio')) as typeof project.aspectRatio;
      changes.resolution = asString(drafts.value('settings.resolution')) as typeof project.resolution;
    }
    const changed = Object.fromEntries(
      Object.entries(changes).filter(([key, value]) => project[key as keyof typeof project] !== value)
    );
    const savedKeys = ['settings.name', 'settings.targetDurationSeconds'];
    if (!projection.requestShapeLocked) savedKeys.push('settings.aspectRatio', 'settings.resolution');
    if (Object.keys(changed).length === 0) {
      savedKeys.forEach(drafts.reset);
      return;
    }
    if (await mutations.editProject(changed as Parameters<typeof mutations.editProject>[0])) {
      savedKeys.forEach(drafts.reset);
    }
  };

  const saveBrief = async (): Promise<void> => {
    const brief = asString(drafts.value('brief.text'));
    const imageRouteId = asString(drafts.value('brief.imageRouteId')) || null;
    const videoRouteId = asString(drafts.value('brief.videoRouteId')) || null;
    const operations: Parameters<typeof mutations.applyAuthoring>[0] = [];
    if (brief !== project.brief) operations.push({ kind: 'set_brief', brief });
    if (imageRouteId !== project.imageRouteId || videoRouteId !== project.videoRouteId) {
      operations.push({ kind: 'set_routes', imageRouteId, videoRouteId });
    }
    const currency = asString(drafts.value('brief.spendCurrency')).trim().toUpperCase();
    const major = asString(drafts.value('brief.spendMajorUnits')).trim();
    const minor = major.length === 0 ? null : majorUnitsToMinorUnits(major);
    const nextPolicy =
      major.length === 0 ? null : minor === null ? undefined : { currency, maxPerBatchMinorUnits: minor };
    if (nextPolicy === undefined || (nextPolicy !== null && !/^[A-Z]{3}$/.test(currency))) {
      setLocalErrorKey('conversation.creativeStudio.workspace.controls.invalidSpendPolicy');
      return;
    }
    if (JSON.stringify(nextPolicy) !== JSON.stringify(project.spendPolicy)) {
      operations.push({ kind: 'set_spend_policy', policy: nextPolicy });
    }
    const savedKeys = [
      'brief.text',
      'brief.imageRouteId',
      'brief.videoRouteId',
      'brief.spendCurrency',
      'brief.spendMajorUnits',
    ];
    if (operations.length === 0) {
      savedKeys.forEach(drafts.reset);
      setLocalErrorKey(null);
      return;
    }
    if (await mutations.applyAuthoring(operations)) {
      savedKeys.forEach(drafts.reset);
      setLocalErrorKey(null);
    }
  };

  const saveRules = async (): Promise<void> => {
    const parsed = parseRules(rulesValue);
    if (parsed === null) {
      setLocalErrorKey('conversation.creativeStudio.workspace.controls.invalidRules');
      return;
    }
    const canonical = project.rules.map(({ id, text, predicate }) => ({
      id,
      text,
      predicate: predicate === null ? null : { kind: 'forbidden_terms' as const, terms: [...predicate.terms] },
    }));
    if (JSON.stringify(parsed) === JSON.stringify(canonical)) {
      drafts.resetIfValue('brief.rules', rulesValue);
      setLocalErrorKey(null);
      return;
    }
    if (await mutations.setRules(parsed)) {
      drafts.resetIfValue('brief.rules', rulesValue);
      setLocalErrorKey(null);
    }
  };

  return (
    <div className={styles.root} data-studio-workspace-controls data-active-view={activeView}>
      {activeView === 'table' ? (
        <TableView
          beats={projection.activeBeats}
          selectedBeatId={drafts.selection.selectedBeatId}
          onSelectBeat={selectAndOpenBeat}
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
        />
      ) : null}
      {openBeat === null ? null : (
        <BeatPanel
          actions={panelActions}
          beat={openBeat}
          beatIds={projection.activeBeatIds}
          beatIndex={openBeatIndex}
          briefReferenceOptions={beatPanelBriefReferenceOptions}
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
      {localErrorKey === null ? null : <Alert type='warning' content={t(localErrorKey)} />}
      {drafts.staleRevision ? (
        <Alert type='error' content={t('conversation.creativeStudio.workspace.controls.draftConflict')} />
      ) : null}

      <Card title={t('conversation.creativeStudio.workspace.controls.settingsTitle')}>
        <div className={styles.formGrid}>
          <label>
            {t('conversation.creativeStudio.workspace.controls.name')}
            <Input
              disabled={pending}
              value={asString(drafts.value('settings.name'))}
              onChange={(value) => drafts.setValue('settings.name', value)}
            />
          </label>
          <label>
            {t('conversation.creativeStudio.workspace.controls.targetDuration')}
            <InputNumber
              disabled={pending}
              min={1}
              precision={0}
              value={asNumber(drafts.value('settings.targetDurationSeconds'))}
              onChange={(value) => drafts.setValue('settings.targetDurationSeconds', value ?? 0)}
            />
          </label>
          <label>
            {t('conversation.creativeStudio.workspace.controls.aspectRatio')}
            <Select
              disabled={pending || projection.requestShapeLocked}
              value={asString(drafts.value('settings.aspectRatio'))}
              onChange={(value) => drafts.setValue('settings.aspectRatio', value)}
            >
              {['16:9', '9:16', '1:1', '4:3', '3:4'].map((value) => (
                <Select.Option key={value} value={value}>
                  {value}
                </Select.Option>
              ))}
            </Select>
          </label>
          <label>
            {t('conversation.creativeStudio.workspace.controls.resolution')}
            <Select
              disabled={pending || projection.requestShapeLocked}
              value={asString(drafts.value('settings.resolution'))}
              onChange={(value) => drafts.setValue('settings.resolution', value)}
            >
              <Select.Option value='720p'>720p</Select.Option>
              <Select.Option value='1080p'>1080p</Select.Option>
            </Select>
          </label>
        </div>
        {projection.requestShapeLocked ? (
          <p>{t('conversation.creativeStudio.workspace.controls.requestShapeLocked')}</p>
        ) : (
          <p>{t('conversation.creativeStudio.workspace.controls.settingsEffect')}</p>
        )}
        <div className={styles.actions}>
          <Button
            disabled={pending}
            onClick={() =>
              [
                'settings.name',
                'settings.targetDurationSeconds',
                'settings.aspectRatio',
                'settings.resolution',
              ].forEach(drafts.reset)
            }
          >
            {t('conversation.creativeStudio.workspace.controls.reset')}
          </Button>
          <Button type='primary' disabled={pending || drafts.staleRevision} onClick={() => void saveSettings()}>
            {t('conversation.creativeStudio.workspace.controls.saveSettings')}
          </Button>
        </div>
      </Card>

      <Card title={t('conversation.creativeStudio.workspace.controls.briefTitle')}>
        <label>
          {t('conversation.creativeStudio.workspace.controls.brief')}
          <Input.TextArea
            disabled={pending}
            autoSize={{ minRows: 3, maxRows: 8 }}
            value={asString(drafts.value('brief.text'))}
            onChange={(value) => drafts.setValue('brief.text', value)}
          />
        </label>
        <div className={styles.formGrid}>
          <label>
            {t('conversation.creativeStudio.workspace.controls.imageRoute')}
            <Select
              allowClear
              disabled={pending}
              value={asString(drafts.value('brief.imageRouteId')) || undefined}
              onChange={(value) => drafts.setValue('brief.imageRouteId', value ?? '')}
            >
              {routeCatalog?.image.options.map((route) => (
                <Select.Option key={route.choiceId} value={route.choiceId}>
                  {route.providerName} · {route.model}
                </Select.Option>
              ))}
            </Select>
            <small>
              {t(
                `conversation.creativeStudio.workspace.controls.routeStatus.${routeCatalog?.image.status ?? 'unavailable'}`
              )}
            </small>
          </label>
          <label>
            {t('conversation.creativeStudio.workspace.controls.videoRoute')}
            <Select
              allowClear
              disabled={pending}
              value={asString(drafts.value('brief.videoRouteId')) || undefined}
              onChange={(value) => drafts.setValue('brief.videoRouteId', value ?? '')}
            >
              {routeCatalog?.video.options.map((route) => (
                <Select.Option key={route.choiceId} value={route.choiceId}>
                  {route.providerName} · {route.model}
                </Select.Option>
              ))}
            </Select>
            <small>
              {t(
                `conversation.creativeStudio.workspace.controls.routeStatus.${routeCatalog?.video.status ?? 'unavailable'}`
              )}
            </small>
          </label>
          <label>
            {t('conversation.creativeStudio.workspace.controls.spendCurrency')}
            <Input
              disabled={pending}
              maxLength={3}
              value={asString(drafts.value('brief.spendCurrency'))}
              onChange={(value) => drafts.setValue('brief.spendCurrency', value.toUpperCase())}
            />
          </label>
          <label>
            {t('conversation.creativeStudio.workspace.controls.spendCap')}
            <Input
              disabled={pending}
              value={asString(drafts.value('brief.spendMajorUnits'))}
              onChange={(value) => drafts.setValue('brief.spendMajorUnits', value)}
            />
          </label>
        </div>
        <div className={styles.actions}>
          <Button disabled={pending} onClick={() => void mutations.refreshRoutes()}>
            {t('conversation.creativeStudio.workspace.controls.refreshRoutes')}
          </Button>
          <Button type='primary' disabled={pending || drafts.staleRevision} onClick={() => void saveBrief()}>
            {t('conversation.creativeStudio.workspace.controls.saveBrief')}
          </Button>
        </div>
        <label>
          {t('conversation.creativeStudio.workspace.controls.rules')}
          <Input.TextArea
            disabled={pending}
            autoSize={{ minRows: 3, maxRows: 10 }}
            value={rulesValue}
            onChange={(value) => drafts.setValue('brief.rules', value)}
          />
        </label>
        <div className={styles.actions}>
          <Button disabled={pending || drafts.staleRevision} onClick={() => void saveRules()}>
            {t('conversation.creativeStudio.workspace.controls.saveRules')}
          </Button>
        </div>
      </Card>

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
