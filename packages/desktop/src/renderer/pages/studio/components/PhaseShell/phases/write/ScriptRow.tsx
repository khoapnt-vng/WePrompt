/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Input, Modal, Select } from '@arco-design/web-react';
import { Delete, Down, Drag, Magic, Picture, Up } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioAsset,
  StudioEditableScene,
  StudioMediaKind,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import type { SelectedSceneSaveState } from '../../../../hooks/useStoryboardEditor';
import type { StudioSceneDurationBounds } from '../../../../studioRouteConstraints';
import type { StudioSceneStatus } from '../../../../studioReadiness';
import { buildProductSheetPrompt } from '../../../Generation/referencePrompt';
import { createManagedStudioAssetUrl } from '../../../Preview/StagePreview';

import styles from './write.module.css';

type ActionResult = void | Promise<unknown>;
type SceneMoveDirection = 'up' | 'down';
const MAX_SCENE_TITLE_CHARS = 256;

export type ScriptRowProps = {
  projectId: string;
  scene: StudioScene;
  draft: StudioEditableScene;
  index: number;
  sceneCount: number;
  status: StudioSceneStatus;
  referenceAsset: StudioAsset | null;
  saveState: SelectedSceneSaveState;
  errorMessageKey?: string | null;
  conflict: boolean;
  selected: boolean;
  mutationPending: boolean;
  importingReference: boolean;
  canGenerateReference: boolean;
  removeDisabled: boolean;
  moveUpDisabled: boolean;
  moveDownDisabled: boolean;
  durationBoundsByMediaKind: Record<StudioMediaKind, StudioSceneDurationBounds>;
  onSelect: () => void;
  onUpdate: (patch: Partial<StudioEditableScene>) => void;
  onFlush: () => ActionResult;
  onRetryConflict: () => ActionResult;
  onDiscardConflict: () => ActionResult;
  onImportReference: () => ActionResult;
  onGenerateReference: (referencePrompt: string) => ActionResult;
  onSuggestVisual: () => void;
  onRemove: () => ActionResult;
  onMove: (direction: SceneMoveDirection) => ActionResult;
};

const SAVE_STATUS_KEYS = {
  saved: 'conversation.creativeStudio.inspector.saved',
  dirty: 'conversation.creativeStudio.inspector.unsavedChanges',
  saving: 'conversation.creativeStudio.inspector.saving',
  failed: 'conversation.creativeStudio.inspector.saveFailed',
} as const satisfies Record<SelectedSceneSaveState, string>;

/** Controlled, sortable script row. Draft ownership stays in useStoryboardEditor. */
export const ScriptRow: React.FC<ScriptRowProps> = ({
  projectId,
  scene,
  draft,
  index,
  sceneCount,
  status,
  referenceAsset,
  saveState,
  errorMessageKey = null,
  conflict,
  selected,
  mutationPending,
  importingReference,
  canGenerateReference,
  removeDisabled,
  moveUpDisabled,
  moveDownDisabled,
  durationBoundsByMediaKind,
  onSelect,
  onUpdate,
  onFlush,
  onRetryConflict,
  onDiscardConflict,
  onImportReference,
  onGenerateReference,
  onSuggestVisual,
  onRemove,
  onMove,
}) => {
  const { t } = useTranslation();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const [referenceDialogVisible, setReferenceDialogVisible] = useState(false);
  const [referencePrompt, setReferencePrompt] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const fieldId = (field: string): string => `studio-scene-${field}-${scene.id}`;
  const durationBounds = durationBoundsByMediaKind[draft.mediaKind];
  const durationOptions = Array.from(
    { length: durationBounds.maxDurationSeconds - durationBounds.minDurationSeconds + 1 },
    (_, offset) => durationBounds.minDurationSeconds + offset
  );
  const formatDuration = (seconds: number): string => `${seconds}${t('common.unit.second_short')}`;
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
    disabled: mutationPending,
  });

  useEffect(() => {
    if (!canGenerateReference) setReferenceDialogVisible(false);
  }, [canGenerateReference]);

  const durationInvalid =
    !Number.isInteger(draft.durationSeconds) ||
    draft.durationSeconds < durationBounds.minDurationSeconds ||
    draft.durationSeconds > durationBounds.maxDurationSeconds;
  const titleInvalid = draft.title.trim().length === 0 || draft.title.length > MAX_SCENE_TITLE_CHARS;
  const titleBlocksFlush = titleInvalid && (titleTouched || !Object.is(draft.title, scene.title));
  const titlePlaceholderKey =
    index === 0
      ? 'conversation.creativeStudio.phase.write.placeholder.opening'
      : index === sceneCount - 1
        ? 'conversation.creativeStudio.phase.write.placeholder.closing'
        : 'conversation.creativeStudio.phase.write.placeholder.middle';
  const displayTitle = draft.title.trim().length > 0 ? draft.title : t(titlePlaceholderKey);
  const referenceSource =
    scene.referenceAssetId !== null &&
    referenceAsset?.id === scene.referenceAssetId &&
    referenceAsset.projectId === projectId &&
    referenceAsset.sceneId === scene.id &&
    referenceAsset.mediaKind === 'image' &&
    (referenceAsset.managedAsset.collection === 'imports' || referenceAsset.managedAsset.collection === 'references') &&
    scene.assetIds.includes(referenceAsset.id)
      ? createManagedStudioAssetUrl(projectId, referenceAsset.id)
      : null;

  const updateDuration = (value: number): void => {
    if (
      !Number.isInteger(value) ||
      value < durationBounds.minDurationSeconds ||
      value > durationBounds.maxDurationSeconds
    )
      return;
    onUpdate({ durationSeconds: value });
  };

  const updateMediaKind = (mediaKind: StudioMediaKind): void => {
    const nextBounds = durationBoundsByMediaKind[mediaKind];
    const integerDuration = Number.isFinite(draft.durationSeconds)
      ? Math.round(draft.durationSeconds)
      : nextBounds.minDurationSeconds;
    const durationSeconds = Math.min(
      nextBounds.maxDurationSeconds,
      Math.max(nextBounds.minDurationSeconds, integerDuration)
    );
    onUpdate({ mediaKind, durationSeconds });
  };

  const flushIfTitleValid = (): void => {
    if (titleBlocksFlush) return;
    void onFlush();
  };

  const actionValues = { number: index + 1, title: displayTitle };
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const statusKey = `conversation.creativeStudio.scene.status.${status}` as const;

  return (
    <li ref={setNodeRef} className={styles.scriptRowItem} style={sortableStyle} data-dragging={isDragging}>
      <section
        aria-labelledby={`studio-write-scene-${scene.id}`}
        data-selected={selected ? 'true' : 'false'}
        className={styles.scriptRow}
        onFocusCapture={onSelect}
      >
        <h3 id={`studio-write-scene-${scene.id}`} className={styles.srOnly}>
          {displayTitle}
        </h3>

        <div data-script-zone='timing' className={`${styles.zone} ${styles.timingZone}`}>
          <h4 className={styles.compactZoneHeading}>{t('conversation.creativeStudio.phase.write.shotColumn')}</h4>
          <div className={styles.shotIdentity}>
            <Button
              ref={setActivatorNodeRef}
              type='text'
              size='small'
              disabled={mutationPending}
              aria-label={t('conversation.creativeStudio.storyboard.dragSceneAccessible', actionValues)}
              title={t('conversation.creativeStudio.storyboard.dragSceneAccessible', actionValues)}
              {...attributes}
              {...listeners}
            >
              <Drag aria-hidden='true' />
            </Button>
            <span className={styles.shotNumber}>{String(index + 1).padStart(2, '0')}</span>
          </div>
          <label htmlFor={fieldId('duration')} className={styles.srOnly}>
            {t('conversation.creativeStudio.inspector.durationLabel')}
          </label>
          <Select
            id={fieldId('duration')}
            className={styles.durationChip}
            aria-label={t('conversation.creativeStudio.inspector.durationLabel')}
            aria-invalid={durationInvalid}
            size='mini'
            status={durationInvalid ? 'error' : undefined}
            value={draft.durationSeconds}
            renderFormat={() => formatDuration(draft.durationSeconds)}
            onChange={(value) => {
              if (typeof value === 'number') updateDuration(value);
            }}
            onBlur={flushIfTitleValid}
          >
            {durationOptions.map((seconds) => (
              <Select.Option key={seconds} value={seconds}>
                {formatDuration(seconds)}
              </Select.Option>
            ))}
          </Select>
          {durationInvalid && (
            <span role='alert' className={styles.fieldError}>
              {t('conversation.creativeStudio.inspector.invalidDuration')}
            </span>
          )}
          <div className={styles.rowActions}>
            <Button
              type='text'
              size='mini'
              disabled={mutationPending || moveUpDisabled}
              aria-label={t('conversation.creativeStudio.storyboard.moveSceneUpAccessible', actionValues)}
              title={t('conversation.creativeStudio.storyboard.moveSceneUpAccessible', actionValues)}
              onClick={() => void onMove('up')}
            >
              <Up aria-hidden='true' />
            </Button>
            <Button
              type='text'
              size='mini'
              disabled={mutationPending || moveDownDisabled}
              aria-label={t('conversation.creativeStudio.storyboard.moveSceneDownAccessible', actionValues)}
              title={t('conversation.creativeStudio.storyboard.moveSceneDownAccessible', actionValues)}
              onClick={() => void onMove('down')}
            >
              <Down aria-hidden='true' />
            </Button>
            <Button
              type='text'
              size='mini'
              status='danger'
              disabled={mutationPending || removeDisabled}
              aria-label={t('conversation.creativeStudio.storyboard.removeSceneAccessible', actionValues)}
              title={t('conversation.creativeStudio.storyboard.removeSceneAccessible', actionValues)}
              onClick={() => setRemoveConfirmVisible(true)}
            >
              <Delete aria-hidden='true' />
            </Button>
          </div>
        </div>

        <div data-script-zone='script' className={styles.zone}>
          <h4 className={styles.compactZoneHeading}>{t('conversation.creativeStudio.phase.write.scriptColumn')}</h4>
          <div className={styles.field}>
            <label htmlFor={fieldId('title')} className={styles.srOnly}>
              {t('conversation.creativeStudio.inspector.titleLabel')}
            </label>
            <Input
              id={fieldId('title')}
              className={styles.editorControl}
              value={draft.title}
              placeholder={t(titlePlaceholderKey)}
              maxLength={MAX_SCENE_TITLE_CHARS}
              error={titleBlocksFlush}
              aria-invalid={titleBlocksFlush}
              onChange={(title) => {
                setTitleTouched(true);
                onUpdate({ title });
              }}
              onBlur={flushIfTitleValid}
            />
            {titleBlocksFlush && (
              <span role='alert' className={styles.fieldError}>
                {t('conversation.creativeStudio.phase.write.invalidTitle')}
              </span>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor={fieldId('narration')} className={styles.srOnly}>
              {t('conversation.creativeStudio.inspector.narrationLabel')}
            </label>
            <Input.TextArea
              id={fieldId('narration')}
              className={styles.editorControl}
              value={draft.narration}
              placeholder={t('conversation.creativeStudio.inspector.narrationLabel')}
              rows={2}
              onChange={(narration) => onUpdate({ narration })}
              onBlur={flushIfTitleValid}
            />
          </div>
          <Button
            type='text'
            size='mini'
            className={styles.detailsToggle}
            aria-expanded={detailsExpanded}
            aria-controls={fieldId('details')}
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
          >
            {t('conversation.creativeStudio.phase.write.moreDetails')}
            <Down aria-hidden='true' className={styles.detailsIcon} />
          </Button>
          {detailsExpanded && (
            <div id={fieldId('details')} className={styles.secondaryFields}>
              <div className={styles.field}>
                <label htmlFor={fieldId('purpose')} className={styles.srOnly}>
                  {t('conversation.creativeStudio.inspector.purposeLabel')}
                </label>
                <Input.TextArea
                  id={fieldId('purpose')}
                  className={styles.editorControl}
                  value={draft.purpose}
                  placeholder={t('conversation.creativeStudio.inspector.purposePlaceholder')}
                  rows={2}
                  onChange={(purpose) => onUpdate({ purpose })}
                  onBlur={flushIfTitleValid}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor={fieldId('on-screen-text')} className={styles.srOnly}>
                  {t('conversation.creativeStudio.inspector.onScreenTextLabel')}
                </label>
                <Input.TextArea
                  id={fieldId('on-screen-text')}
                  className={styles.editorControl}
                  value={draft.onScreenText}
                  placeholder={t('conversation.creativeStudio.inspector.onScreenTextLabel')}
                  rows={2}
                  onChange={(onScreenText) => onUpdate({ onScreenText })}
                  onBlur={flushIfTitleValid}
                />
              </div>
            </div>
          )}
        </div>

        <div data-script-zone='visual' className={styles.zone}>
          <h4 className={styles.compactZoneHeading}>{t('conversation.creativeStudio.phase.write.visualColumn')}</h4>
          <div className={styles.field}>
            <label htmlFor={fieldId('prompt')} className={styles.srOnly}>
              {t('conversation.creativeStudio.inspector.visualPromptLabel')}
            </label>
            <Input.TextArea
              id={fieldId('prompt')}
              className={styles.editorControl}
              value={draft.visualPrompt}
              placeholder={t('conversation.creativeStudio.phase.write.visualPlaceholder')}
              rows={3}
              onChange={(visualPrompt) => onUpdate({ visualPrompt })}
              onBlur={flushIfTitleValid}
            />
          </div>
          {draft.visualPrompt.trim().length === 0 && (
            <Button
              type='text'
              size='small'
              className={styles.bodyTextAction}
              icon={<Magic aria-hidden='true' />}
              onClick={onSuggestVisual}
            >
              {t('conversation.creativeStudio.phase.write.suggestVisual')}
            </Button>
          )}
          <div className={styles.referenceSlot}>
            {referenceSource !== null && (
              <figure className={styles.referencePreview}>
                <img
                  alt={t('conversation.creativeStudio.preview.importReference')}
                  src={referenceSource}
                  className={styles.referenceImage}
                />
                <figcaption>{t('conversation.creativeStudio.preview.importReference')}</figcaption>
              </figure>
            )}
            <Button
              size='small'
              disabled={importingReference || mutationPending}
              icon={<Picture aria-hidden='true' />}
              onClick={() => void onImportReference()}
            >
              {t(
                importingReference
                  ? 'conversation.creativeStudio.preview.importing'
                  : 'conversation.creativeStudio.phase.write.addReference'
              )}
            </Button>
            {canGenerateReference && (
              <Button
                size='small'
                disabled={importingReference || mutationPending}
                icon={<Magic aria-hidden='true' />}
                onClick={() => {
                  setReferencePrompt(buildProductSheetPrompt(scene.visualPrompt));
                  setReferenceDialogVisible(true);
                }}
              >
                {t('conversation.creativeStudio.reference.generate')}
              </Button>
            )}
          </div>
        </div>

        <div data-script-zone='output' className={`${styles.zone} ${styles.outputZone}`}>
          <h4 className={styles.compactZoneHeading}>{t('conversation.creativeStudio.phase.write.outputColumn')}</h4>
          <div className={styles.field}>
            <label htmlFor={fieldId('media')} className={styles.srOnly}>
              {t('conversation.creativeStudio.inspector.mediaKindLabel')}
            </label>
            <Select
              id={fieldId('media')}
              className={styles.outputSelect}
              aria-label={t('conversation.creativeStudio.inspector.mediaKindLabel')}
              value={draft.mediaKind}
              onChange={(mediaKind) => updateMediaKind(mediaKind as StudioMediaKind)}
              onBlur={flushIfTitleValid}
            >
              <Select.Option value='image'>{t('conversation.creativeStudio.scene.image')}</Select.Option>
              <Select.Option value='video'>{t('conversation.creativeStudio.scene.video')}</Select.Option>
            </Select>
          </div>
          <span role='status' data-readiness={status} className={styles.readiness}>
            <span aria-hidden='true' className={styles.readinessDot} />
            {draft.title.trim().length === 0 ? t('conversation.creativeStudio.phase.write.needsTitle') : t(statusKey)}
          </span>
          <span
            role='status'
            aria-live='polite'
            aria-atomic='true'
            data-state={saveState}
            className={styles.saveStatus}
          >
            {t(SAVE_STATUS_KEYS[saveState])}
          </span>
          {errorMessageKey !== null && (
            <div role='alert' className={styles.errorMessage}>
              {t(errorMessageKey)}
            </div>
          )}
          {conflict && (
            <div className={styles.conflictActions}>
              <Button type='primary' size='small' loading={mutationPending} onClick={() => void onRetryConflict()}>
                {t('conversation.creativeStudio.storyboard.retry')}
              </Button>
              <Button size='small' disabled={mutationPending} onClick={() => void onDiscardConflict()}>
                {t('conversation.creativeStudio.storyboard.discard')}
              </Button>
            </div>
          )}
        </div>
      </section>

      <Modal
        title={t('conversation.creativeStudio.reference.dialogTitle')}
        wrapClassName={styles.modalSurface}
        visible={canGenerateReference && referenceDialogVisible}
        footer={
          <>
            <Button disabled={mutationPending} onClick={() => setReferenceDialogVisible(false)}>
              {t('conversation.creativeStudio.review.cancel')}
            </Button>
            <Button
              type='primary'
              disabled={!canGenerateReference || mutationPending || referencePrompt.trim().length === 0}
              onClick={() => {
                if (!canGenerateReference) return;
                setReferenceDialogVisible(false);
                void onGenerateReference(referencePrompt);
              }}
            >
              {t('conversation.creativeStudio.reference.generate')}
            </Button>
          </>
        }
        onCancel={() => !mutationPending && setReferenceDialogVisible(false)}
      >
        <label htmlFor={fieldId('reference-prompt')} className={styles.srOnly}>
          {t('conversation.creativeStudio.reference.promptLabel')}
        </label>
        <Input.TextArea
          id={fieldId('reference-prompt')}
          value={referencePrompt}
          aria-label={t('conversation.creativeStudio.reference.promptLabel')}
          rows={10}
          onChange={setReferencePrompt}
        />
      </Modal>

      <Modal
        title={t('conversation.creativeStudio.storyboard.removeConfirmTitle')}
        wrapClassName={styles.modalSurface}
        visible={removeConfirmVisible}
        footer={
          <>
            <Button disabled={mutationPending} onClick={() => setRemoveConfirmVisible(false)}>
              {t('conversation.creativeStudio.create.cancel')}
            </Button>
            <Button
              type='primary'
              status='danger'
              loading={mutationPending}
              onClick={() => {
                setRemoveConfirmVisible(false);
                void onRemove();
              }}
            >
              {t('conversation.creativeStudio.storyboard.removeScene')}
            </Button>
          </>
        }
        onCancel={() => !mutationPending && setRemoveConfirmVisible(false)}
      >
        <p>{t('conversation.creativeStudio.storyboard.removeConfirmBody')}</p>
      </Modal>
    </li>
  );
};
