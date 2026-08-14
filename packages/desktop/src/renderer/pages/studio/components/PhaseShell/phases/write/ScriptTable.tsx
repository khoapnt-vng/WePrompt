/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DndContext, PointerSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@arco-design/web-react';
import { Add } from '@icon-park/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioScene } from '@/common/types/project/creativeStudioTypes';

import styles from './write.module.css';

type ActionResult = void | Promise<unknown>;

export type ScriptTableProps = {
  orderedScenes: StudioScene[];
  children: React.ReactNode;
  canAddScene: boolean;
  mutationPending: boolean;
  errorMessageKey?: string | null;
  statusMessageKey?: string | null;
  conflict: boolean;
  onAddScene: () => ActionResult;
  onReorderScenes: (sceneOrder: string[]) => ActionResult;
  onRetryConflict: () => ActionResult;
  onDiscardConflict: () => ActionResult;
};

/** Six-zone script table. Scene editing remains owned by the by-ID editor controller. */
export const ScriptTable: React.FC<ScriptTableProps> = ({
  orderedScenes,
  children,
  canAddScene,
  mutationPending,
  errorMessageKey = null,
  statusMessageKey = null,
  conflict,
  onAddScene,
  onReorderScenes,
  onRetryConflict,
  onDiscardConflict,
}) => {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );
  const sceneOrder = orderedScenes.map((scene) => scene.id);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent): void => {
      if (mutationPending || !over || active.id === over.id) return;
      const oldIndex = sceneOrder.indexOf(String(active.id));
      const newIndex = sceneOrder.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      void onReorderScenes(arrayMove(sceneOrder, oldIndex, newIndex));
    },
    [mutationPending, onReorderScenes, sceneOrder]
  );

  return (
    <section className={styles.scriptTable} aria-labelledby='studio-write-script-table-heading'>
      <header className={styles.tableTitleRow}>
        <div>
          <h3 id='studio-write-script-table-heading' className={styles.tableTitle}>
            {t('conversation.creativeStudio.phase.write.scriptTableTitle')}
          </h3>
          <p className={styles.tableDescription}>{t('conversation.creativeStudio.phase.write.scriptTableHelp')}</p>
        </div>
        <Button
          type='primary'
          icon={<Add aria-hidden='true' />}
          disabled={!canAddScene || mutationPending}
          onClick={() => void onAddScene()}
        >
          {t('conversation.creativeStudio.phase.write.addShot')}
        </Button>
      </header>

      <div className={styles.tableScroll}>
        <div className={styles.tableHeader} aria-hidden='true'>
          <span data-script-column='timing'>{t('conversation.creativeStudio.phase.write.shotColumn')}</span>
          <span data-script-column='script'>{t('conversation.creativeStudio.phase.write.scriptColumn')}</span>
          <span data-script-column='visual'>{t('conversation.creativeStudio.phase.write.visualColumn')}</span>
          <span data-script-column='output'>{t('conversation.creativeStudio.phase.write.outputColumn')}</span>
          <span data-script-column='length'>{t('conversation.creativeStudio.phase.write.lengthColumn')}</span>
          <span data-script-column='state'>{t('conversation.creativeStudio.phase.write.stateColumn')}</span>
        </div>

        {orderedScenes.length === 0 ? (
          <p className={styles.empty}>{t('conversation.creativeStudio.phase.write.noScenes')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sceneOrder} strategy={verticalListSortingStrategy}>
              <ol className={styles.scriptRows}>{children}</ol>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {(errorMessageKey !== null || statusMessageKey !== null || conflict || !canAddScene) && (
        <footer className={styles.tableFeedback}>
          {errorMessageKey !== null && (
            <div role='alert' className={styles.errorMessage}>
              {t(errorMessageKey)}
            </div>
          )}
          {statusMessageKey !== null && (
            <div role='status' className={styles.statusMessage}>
              {t(statusMessageKey)}
            </div>
          )}
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
          {!canAddScene && (
            <p className={styles.sceneLimit}>{t('conversation.creativeStudio.storyboard.sceneLimit')}</p>
          )}
        </footer>
      )}
    </section>
  );
};
