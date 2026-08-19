/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Card, Checkbox, Input, InputNumber, Select } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION,
  type StudioBriefRuleDraft,
  type StudioPrepareGenerationChoiceV2,
} from '@/common/types/project/creativeStudioTypes';
import { majorUnitsToMinorUnits, selectionGateDraft } from '../spendGate';
import { hasGenerationAffectingWorkspaceDrafts, type WorkspaceDraftValue } from '../useWorkspaceDrafts';
import { TableView } from './Table';
import type { WorkspaceControlsProps } from './viewTypes';
import styles from './WorkspaceControls.module.css';

type GateChoicePreferences = Record<string, { generationCount: number; referenceAssetId: string | null }>;

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

const parseGatePreferences = (value: WorkspaceDraftValue | undefined): GateChoicePreferences => {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: GateChoicePreferences = Object.create(null) as GateChoicePreferences;
    for (const [key, candidate] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9_-]{1,256}:(seed_still|video_take)$/.test(key)) continue;
      if (typeof candidate !== 'object' || candidate === null) continue;
      const row = candidate as Record<string, unknown>;
      if (
        !Number.isSafeInteger(row.generationCount) ||
        (row.generationCount as number) < 1 ||
        (row.generationCount as number) > STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION ||
        (row.referenceAssetId !== null && typeof row.referenceAssetId !== 'string')
      ) {
        continue;
      }
      result[key] = {
        generationCount: row.generationCount as number,
        referenceAssetId: row.referenceAssetId as string | null,
      };
    }
    return result;
  } catch {
    return {};
  }
};

const choiceKey = (choice: Pick<StudioPrepareGenerationChoiceV2, 'shotId' | 'purpose'>): string =>
  `${choice.shotId}:${choice.purpose}`;

export const WorkspaceControls: React.FC<WorkspaceControlsProps> = ({
  activeView,
  project,
  projection,
  routeCatalog,
  drafts,
  pending,
  gateLocked,
  errorMessageKey,
  mutations,
  openSpendGate,
}) => {
  const { t } = useTranslation();
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const rulesValue = asString(drafts.value('brief.rules'));
  const hasGenerationAffectingDrafts = hasGenerationAffectingWorkspaceDrafts(drafts.dirtyKeys);
  const statusReady = projection.workspaceStatusReady && projection.chainStatusReady;
  const gatePreferences = useMemo(() => parseGatePreferences(drafts.value('gate.choices')), [drafts.entries]);
  const defaultGateDraft = useMemo(
    () =>
      selectionGateDraft({
        project,
        projection,
        orderedShotIds: drafts.selection.selectedShotIds,
      }),
    [drafts.selection.selectedShotIds, project, projection]
  );
  const briefReferences = Object.values(project.assets).filter(
    (asset) =>
      asset?.projectId === project.id &&
      asset.shotId === null &&
      asset.mediaKind === 'image' &&
      asset.managedAsset.collection === 'imports' &&
      (asset.briefReferenceRole === 'cast' || asset.briefReferenceRole === 'look')
  );

  const updateGatePreference = (
    choice: StudioPrepareGenerationChoiceV2,
    changes: Partial<GateChoicePreferences[string]>
  ): void => {
    if (gateLocked) return;
    const key = choiceKey(choice);
    const current = gatePreferences[key] ?? { generationCount: 1, referenceAssetId: null };
    drafts.setValue('gate.choices', JSON.stringify({ ...gatePreferences, [key]: { ...current, ...changes } }));
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
    if (await mutations.setRules(parsed)) {
      drafts.reset('brief.rules');
      setLocalErrorKey(null);
    }
  };

  const reviewSelection = (): void => {
    if (gateLocked || hasGenerationAffectingDrafts || !statusReady || routeCatalog === null) return;
    if (defaultGateDraft === null) {
      setLocalErrorKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
      return;
    }
    if (
      defaultGateDraft.baseChoices.some((choice) => choice.purpose === 'seed_still') &&
      routeCatalog?.image.status !== 'ready'
    ) {
      setLocalErrorKey('conversation.creativeStudio.workspace.controls.imageRouteBlocked');
      return;
    }
    if (routeCatalog?.video.status !== 'ready') {
      if (defaultGateDraft.baseChoices.some((choice) => choice.purpose === 'video_take')) {
        setLocalErrorKey('conversation.creativeStudio.workspace.controls.videoRouteBlocked');
        return;
      }
    }
    const applyPreference = (choice: StudioPrepareGenerationChoiceV2): StudioPrepareGenerationChoiceV2 => {
      const preference = gatePreferences[choiceKey(choice)];
      return preference === undefined
        ? choice
        : {
            ...choice,
            generationCount: preference.generationCount,
            referenceAssetId: choice.purpose === 'seed_still' ? preference.referenceAssetId : null,
          };
    };
    const reviewed = selectionGateDraft({
      project,
      projection,
      orderedShotIds: drafts.selection.selectedShotIds,
      baseChoices: defaultGateDraft.baseChoices.map(applyPreference),
      cascadeChoices: defaultGateDraft.cascadeChoices.map(applyPreference),
    });
    if (reviewed === null) {
      setLocalErrorKey('conversation.creativeStudio.workspace.controls.selectionNotPayable');
      return;
    }
    setLocalErrorKey(null);
    openSpendGate(reviewed);
  };

  return (
    <div className={styles.root} data-studio-workspace-controls data-active-view={activeView}>
      {activeView === 'table' ? (
        <TableView
          beats={projection.activeBeats}
          selectedBeatId={drafts.selection.selectedBeatId}
          onSelectBeat={drafts.selectBeat}
        />
      ) : null}
      {errorMessageKey !== null || localErrorKey !== null ? (
        <Alert type='warning' content={t(localErrorKey ?? errorMessageKey!)} />
      ) : null}
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

      <section aria-label={t('conversation.creativeStudio.workspace.controls.shotsTitle')}>
        <div className={styles.sectionHeading}>
          <h3>{t('conversation.creativeStudio.workspace.controls.shotsTitle')}</h3>
          <Button
            type='primary'
            disabled={
              pending ||
              gateLocked ||
              hasGenerationAffectingDrafts ||
              !statusReady ||
              routeCatalog === null ||
              drafts.selection.selectedShotIds.length === 0
            }
            onClick={reviewSelection}
          >
            {t('conversation.creativeStudio.workspace.controls.reviewRender')}
          </Button>
        </div>
        {hasGenerationAffectingDrafts ? (
          <p>{t('conversation.creativeStudio.workspace.controls.saveBeforeReview')}</p>
        ) : !statusReady ? (
          <p>{t('conversation.creativeStudio.workspace.controls.statusRequired')}</p>
        ) : routeCatalog === null ? (
          <p>{t('conversation.creativeStudio.workspace.controls.routeCatalogRequired')}</p>
        ) : null}
        {projection.activeBeats.map((beat) => (
          <Card key={beat.id} title={beat.title || beat.id}>
            {beat.shots.length === 0 ? (
              <div>
                <p>{t('conversation.creativeStudio.workspace.controls.noCoverage')}</p>
                <Button onClick={drafts.clearSelection}>
                  {t('conversation.creativeStudio.workspace.controls.keepUncoveredFree')}
                </Button>
              </div>
            ) : (
              <ul className={styles.shotList}>
                {beat.shots.map((shot) => (
                  <li key={shot.id}>
                    <Checkbox
                      checked={drafts.selection.selectedShotIds.includes(shot.id)}
                      onChange={(_checked, event) => {
                        const nativeEvent =
                          (event as unknown as { nativeEvent?: Event }).nativeEvent ?? (event as unknown as Event);
                        const shiftKey = 'shiftKey' in nativeEvent && nativeEvent.shiftKey === true;
                        drafts.selectShot(shot.id, shiftKey ? 'range' : 'toggle');
                      }}
                    >
                      <span>{shot.line || shot.id}</span>
                    </Checkbox>
                    <small>
                      {t(`conversation.creativeStudio.workspace.controls.shotState.${shot.displayState}`)} ·{' '}
                      {t('conversation.creativeStudio.workspace.controls.takeCount', { count: shot.takeCount })}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </section>

      {defaultGateDraft !== null && drafts.selection.selectedShotIds.length > 0 ? (
        <Card
          data-testid='studio-generation-choices'
          title={t('conversation.creativeStudio.workspace.controls.generationChoices')}
        >
          {[...defaultGateDraft.baseChoices, ...defaultGateDraft.cascadeChoices].map((choice) => {
            const preference = gatePreferences[choiceKey(choice)] ?? {
              generationCount: 1,
              referenceAssetId: null,
            };
            return (
              <div key={choiceKey(choice)} className={styles.choiceRow}>
                <span>
                  {choice.shotId} · {t(`conversation.creativeStudio.workspace.gate.purpose.${choice.purpose}`)}
                </span>
                <Select
                  disabled={pending || gateLocked}
                  value={preference.generationCount}
                  onChange={(value) => updateGatePreference(choice, { generationCount: Number(value) })}
                >
                  {Array.from({ length: STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION }, (_, index) => index + 1).map(
                    (count) => (
                      <Select.Option key={count} value={count}>
                        {count}
                      </Select.Option>
                    )
                  )}
                </Select>
                {choice.purpose === 'seed_still' ? (
                  <Select
                    allowClear
                    disabled={pending || gateLocked}
                    value={preference.referenceAssetId ?? undefined}
                    onChange={(value) => updateGatePreference(choice, { referenceAssetId: value ?? null })}
                  >
                    {briefReferences.map((asset) => (
                      <Select.Option key={asset.id} value={asset.id}>
                        {asset.briefReferenceLabel ?? asset.id}
                      </Select.Option>
                    ))}
                  </Select>
                ) : null}
              </div>
            );
          })}
        </Card>
      ) : null}

      {projection.undoTop !== null ? (
        <Button disabled={pending} onClick={() => void mutations.undo(projection.undoTop!.entryId)}>
          {t('conversation.creativeStudio.workspace.controls.undo', {
            label: t(`conversation.creativeStudio.workspace.controls.undoLabel.${projection.undoTop.label}`, {
              defaultValue: t('conversation.creativeStudio.workspace.controls.undoLabel.unknown'),
            }),
          })}
        </Button>
      ) : null}
      {projection.dirtyShots.map((shot) => (
        <Alert
          key={shot.shotId}
          type='warning'
          content={t('conversation.creativeStudio.workspace.controls.dirtyShot', {
            shotId: shot.shotId,
            causes: shot.causes
              .map((cause) => t(`conversation.creativeStudio.workspace.controls.dirtyCause.${cause}`))
              .join(', '),
          })}
        />
      ))}
      {projection.cascadeProgress.map((row) => (
        <Card key={row.dependentShotId} title={t('conversation.creativeStudio.workspace.controls.cascadeTitle')}>
          <p>{t(`conversation.creativeStudio.workspace.controls.cascadeReason.${row.waitingReason}`)}</p>
          <div className={styles.actions}>
            {row.eligiblePrimaryAssetIds.map((assetId) => (
              <Button key={assetId} onClick={() => void mutations.chooseCascadeAsset(row, assetId)}>
                {t('conversation.creativeStudio.workspace.controls.chooseAsset', { assetId })}
              </Button>
            ))}
            {row.canRetryConditioningFrame ? (
              <Button onClick={() => void mutations.retryConditioning(row.dependentShotId)}>
                {t('conversation.creativeStudio.workspace.controls.retryConditioning')}
              </Button>
            ) : null}
            {row.canCancelWaiting ? (
              <Button status='danger' onClick={() => void mutations.cancelWaiting(row.dependentShotId)}>
                {t('conversation.creativeStudio.workspace.controls.cancelWaiting')}
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
      {projection.conditioningFailures.map((row) => (
        <Button key={row.dependentShotId} onClick={() => void mutations.retryConditioning(row.dependentShotId)}>
          {t('conversation.creativeStudio.workspace.controls.retryConditioningFor', {
            shotId: row.dependentShotId,
          })}
        </Button>
      ))}
    </div>
  );
};
