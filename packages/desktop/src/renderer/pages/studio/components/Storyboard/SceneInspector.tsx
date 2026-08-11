/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, InputNumber, Select, Tabs } from '@arco-design/web-react';
import { Picture } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioAsset,
  StudioEditableScene,
  StudioMediaKind,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import type { SelectedSceneSaveState } from '../../hooks/useStoryboardEditor';
import type { StudioSceneDurationBounds } from '../../studioRouteConstraints';

import { createManagedStudioAssetUrl } from '../Preview/StagePreview';
import styles from './Storyboard.module.css';

type ActionResult = void | Promise<unknown>;

export type SceneInspectorProps = {
  projectId: string;
  selectedScene: StudioScene | null;
  referenceAsset: StudioAsset | null;
  sceneDraft: StudioEditableScene | null;
  mutationPending: boolean;
  errorMessageKey?: string | null;
  saveState: SelectedSceneSaveState;
  conflict: boolean;
  durationBounds: StudioSceneDurationBounds;
  onUpdateSceneDraft: (patch: Partial<StudioEditableScene>) => void;
  onFlushSceneDraft: () => ActionResult;
  onRetryConflict: () => ActionResult;
  onDiscardConflict: () => ActionResult;
  importingReference: boolean;
  onImportReference: () => ActionResult;
};

/** Controlled scene fields. Draft ownership and persistence stay in useStoryboardEditor. */
export const SceneInspector: React.FC<SceneInspectorProps> = ({
  projectId,
  selectedScene,
  referenceAsset,
  sceneDraft,
  mutationPending,
  errorMessageKey = null,
  saveState,
  conflict,
  durationBounds,
  onUpdateSceneDraft,
  onFlushSceneDraft,
  onRetryConflict,
  onDiscardConflict,
  importingReference,
  onImportReference,
}) => {
  const { t } = useTranslation();
  const [durationChangeInvalid, setDurationChangeInvalid] = useState(false);
  const durationInputInvalidRef = useRef(false);

  useEffect(() => {
    durationInputInvalidRef.current = false;
    setDurationChangeInvalid(false);
  }, [
    sceneDraft?.durationSeconds,
    selectedScene?.id,
    durationBounds.maxDurationSeconds,
    durationBounds.minDurationSeconds,
  ]);

  const durationInvalid =
    durationChangeInvalid ||
    (sceneDraft !== null &&
      (!Number.isInteger(sceneDraft.durationSeconds) ||
        sceneDraft.durationSeconds < durationBounds.minDurationSeconds ||
        sceneDraft.durationSeconds > durationBounds.maxDurationSeconds));

  const flushDraft = () => {
    void onFlushSceneDraft();
  };

  const updateDuration = (value: number, reason?: string) => {
    const stepperRecovery = reason === 'increase' || reason === 'decrease';
    if (
      (durationInputInvalidRef.current && !stepperRecovery) ||
      reason === 'outOfRange' ||
      !Number.isInteger(value) ||
      value < durationBounds.minDurationSeconds ||
      value > durationBounds.maxDurationSeconds
    ) {
      setDurationChangeInvalid(true);
      return;
    }
    durationInputInvalidRef.current = false;
    setDurationChangeInvalid(false);
    onUpdateSceneDraft({ durationSeconds: value });
  };

  const inspectDurationInput = (event: React.FormEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    durationInputInvalidRef.current =
      !Number.isInteger(value) ||
      value < durationBounds.minDurationSeconds ||
      value > durationBounds.maxDurationSeconds;
    if (durationInputInvalidRef.current) setDurationChangeInvalid(true);
  };

  const titleId = selectedScene ? `studio-scene-title-${selectedScene.id}` : undefined;
  const purposeId = selectedScene ? `studio-scene-purpose-${selectedScene.id}` : undefined;
  const promptId = selectedScene ? `studio-scene-prompt-${selectedScene.id}` : undefined;
  const mediaId = selectedScene ? `studio-scene-media-${selectedScene.id}` : undefined;
  const durationId = selectedScene ? `studio-scene-duration-${selectedScene.id}` : undefined;
  const narrationId = selectedScene ? `studio-scene-narration-${selectedScene.id}` : undefined;
  const onScreenTextId = selectedScene ? `studio-scene-on-screen-text-${selectedScene.id}` : undefined;
  const referenceSource =
    selectedScene !== null &&
    selectedScene.referenceAssetId !== null &&
    referenceAsset?.id === selectedScene.referenceAssetId &&
    referenceAsset.projectId === projectId &&
    referenceAsset.sceneId === selectedScene.id &&
    referenceAsset.mediaKind === 'image' &&
    (referenceAsset.managedAsset.collection === 'imports' || referenceAsset.managedAsset.collection === 'references') &&
    selectedScene.assetIds.includes(referenceAsset.id)
      ? createManagedStudioAssetUrl(projectId, referenceAsset.id)
      : null;
  const saveStatusMessageKey = {
    saved: 'conversation.creativeStudio.inspector.saved',
    dirty: 'conversation.creativeStudio.inspector.unsavedChanges',
    saving: 'conversation.creativeStudio.inspector.saving',
    failed: 'conversation.creativeStudio.inspector.saveFailed',
  } as const satisfies Record<SelectedSceneSaveState, string>;

  return (
    <section aria-label={t('conversation.creativeStudio.inspector.title')} className={styles.inspector}>
      <header className={styles.inspectorHeader}>
        <h2>{t('conversation.creativeStudio.inspector.title')}</h2>
        <span role='status' aria-live='polite' aria-atomic='true' className={styles.saveStatus} data-state={saveState}>
          {t(saveStatusMessageKey[saveState])}
        </span>
      </header>

      <div className={styles.inspectorBody}>
        {errorMessageKey && (
          <div role='alert' className={`${styles.feedback} ${styles.error}`}>
            {t(errorMessageKey)}
          </div>
        )}
        {!selectedScene || !sceneDraft ? (
          <p className={styles.emptyInspector}>{t('conversation.creativeStudio.storyboard.noScenes')}</p>
        ) : (
          <>
            <section role='region' aria-label={t('conversation.creativeStudio.inspector.sectionsLabel')}>
              <Tabs defaultActiveTab='direction' destroyOnHide>
                <Tabs.TabPane key='direction' title={t('conversation.creativeStudio.inspector.directionTab')}>
                  <div className={styles.form}>
                    <div className={styles.field}>
                      <label htmlFor={titleId}>{t('conversation.creativeStudio.inspector.titleLabel')}</label>
                      <Input
                        id={titleId}
                        value={sceneDraft.title}
                        onChange={(title) => onUpdateSceneDraft({ title })}
                        onBlur={flushDraft}
                      />
                    </div>

                    <div className={styles.field}>
                      <label htmlFor={purposeId}>{t('conversation.creativeStudio.inspector.purposeLabel')}</label>
                      <Input.TextArea
                        id={purposeId}
                        value={sceneDraft.purpose}
                        placeholder={t('conversation.creativeStudio.inspector.purposePlaceholder')}
                        onChange={(purpose) => onUpdateSceneDraft({ purpose })}
                        onBlur={flushDraft}
                        rows={2}
                      />
                    </div>

                    <div className={styles.field}>
                      <label htmlFor={promptId}>{t('conversation.creativeStudio.inspector.visualPromptLabel')}</label>
                      <Input.TextArea
                        id={promptId}
                        value={sceneDraft.visualPrompt}
                        placeholder={t('conversation.creativeStudio.inspector.visualPromptPlaceholder')}
                        onChange={(visualPrompt) => onUpdateSceneDraft({ visualPrompt })}
                        onBlur={flushDraft}
                        rows={4}
                      />
                    </div>

                    <div className={styles.field}>
                      <label htmlFor={mediaId}>{t('conversation.creativeStudio.inspector.mediaKindLabel')}</label>
                      <Select
                        id={mediaId}
                        aria-label={t('conversation.creativeStudio.inspector.mediaKindLabel')}
                        value={sceneDraft.mediaKind}
                        onChange={(mediaKind) =>
                          onUpdateSceneDraft({
                            mediaKind: mediaKind as StudioMediaKind,
                          })
                        }
                        onBlur={flushDraft}
                      >
                        <Select.Option value='image'>{t('conversation.creativeStudio.scene.image')}</Select.Option>
                        <Select.Option value='video'>{t('conversation.creativeStudio.scene.video')}</Select.Option>
                      </Select>
                    </div>

                    <div className={styles.field}>
                      <label htmlFor={durationId}>{t('conversation.creativeStudio.inspector.durationLabel')}</label>
                      <InputNumber
                        id={durationId}
                        aria-label={t('conversation.creativeStudio.inspector.durationLabel')}
                        aria-valuemin={durationBounds.minDurationSeconds}
                        aria-valuemax={durationBounds.maxDurationSeconds}
                        mode='button'
                        min={durationBounds.minDurationSeconds}
                        max={durationBounds.maxDurationSeconds}
                        step={1}
                        precision={0}
                        value={sceneDraft.durationSeconds}
                        error={durationInvalid}
                        onInput={inspectDurationInput}
                        onChange={updateDuration}
                        onBlur={flushDraft}
                      />
                      {durationInvalid && (
                        <div role='alert' className={`${styles.feedback} ${styles.error}`}>
                          {t('conversation.creativeStudio.inspector.invalidDuration')}
                        </div>
                      )}
                    </div>

                    <div className={styles.field}>
                      {referenceSource !== null && (
                        <figure
                          aria-label={t('conversation.creativeStudio.preview.importReference')}
                          className='m-0 flex items-center gap-10px rounded-8px border border-border-2 bg-fill-1 p-8px'
                        >
                          <img
                            alt={t('conversation.creativeStudio.preview.importReference')}
                            className='h-48px w-72px rounded-6px object-cover'
                            src={referenceSource}
                          />
                          <figcaption className='text-12px text-t-secondary'>
                            {t('conversation.creativeStudio.preview.importReference')}
                          </figcaption>
                        </figure>
                      )}
                      <Button
                        long
                        disabled={importingReference || mutationPending}
                        icon={
                          <span aria-hidden='true'>
                            <Picture />
                          </span>
                        }
                        onClick={() => void onImportReference()}
                      >
                        {t(
                          importingReference
                            ? 'conversation.creativeStudio.preview.importing'
                            : 'conversation.creativeStudio.preview.importReference'
                        )}
                      </Button>
                    </div>
                  </div>
                </Tabs.TabPane>

                <Tabs.TabPane key='script' title={t('conversation.creativeStudio.inspector.scriptTab')}>
                  <div className={styles.form}>
                    <div className={styles.field}>
                      <label htmlFor={narrationId}>{t('conversation.creativeStudio.inspector.narrationLabel')}</label>
                      <Input.TextArea
                        id={narrationId}
                        value={sceneDraft.narration}
                        onChange={(narration) => onUpdateSceneDraft({ narration })}
                        onBlur={flushDraft}
                        rows={4}
                      />
                    </div>

                    <div className={styles.field}>
                      <label htmlFor={onScreenTextId}>
                        {t('conversation.creativeStudio.inspector.onScreenTextLabel')}
                      </label>
                      <Input.TextArea
                        id={onScreenTextId}
                        value={sceneDraft.onScreenText}
                        onChange={(onScreenText) => onUpdateSceneDraft({ onScreenText })}
                        onBlur={flushDraft}
                        rows={3}
                      />
                    </div>
                  </div>
                </Tabs.TabPane>
              </Tabs>
            </section>

            {conflict && (
              <div className={styles.conflictActions}>
                <Button type='primary' loading={mutationPending} onClick={() => void onRetryConflict()}>
                  {t('conversation.creativeStudio.storyboard.retry')}
                </Button>
                <Button disabled={mutationPending} onClick={() => void onDiscardConflict()}>
                  {t('conversation.creativeStudio.storyboard.discard')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
