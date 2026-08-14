/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';

import { useBriefConversationContext } from '../Shell/BriefConversationContext';
import type { UseStudioModelsResult } from '../../hooks/useStudioModels';
import { EngineSlot } from './EngineSlot';
import {
  getEnginePairVerdictKey,
  getProjectDurationBounds,
  getProjectEngineSlots,
  type ProjectEngineDurationBounds,
} from './engineState';
import styles from './EngineStrip.module.css';

export type EngineStripProps = {
  project: StudioRendererProject;
  models: UseStudioModelsResult;
  variant: 'full' | 'compact';
  locked?: boolean;
  openModelSettings: (path: '/settings/model') => void;
};

const engineKey = (leaf: string): string => `conversation.creativeStudio.models.engine.${leaf}`;

export const EngineStrip: React.FC<EngineStripProps> = ({
  project,
  models,
  variant,
  locked = false,
  openModelSettings,
}) => {
  const { t } = useTranslation();
  const brief = useBriefConversationContext();
  const slots = useMemo(() => getProjectEngineSlots(models.catalog, project), [models.catalog, project]);
  const verdictKey = getEnginePairVerdictKey(slots);
  const bounds = useMemo(() => getProjectDurationBounds(models.catalog, project), [models.catalog, project]);
  const fallbackStaleModel =
    slots.find((slot) => slot.selectedModel !== null)?.selectedModel ??
    slots.find((slot) => slot.prearmedRoute !== null)?.prearmedRoute?.model ??
    '';

  return (
    <section className={styles.strip} role='region' aria-label={t(engineKey('label'))} data-variant={variant}>
      <div className={styles.header}>
        <h2>{t(engineKey('label'))}</h2>
        {variant === 'full' ? <p>{t(engineKey('scope'))}</p> : null}
      </div>
      {variant === 'full' && verdictKey !== null ? <p className={styles.verdict}>{t(verdictKey)}</p> : null}
      <div className={styles.slots}>
        {slots.map((slot) => (
          <EngineSlot
            key={slot.role}
            slot={slot}
            project={project}
            models={models}
            locked={locked}
            openModelSettings={openModelSettings}
            onCommitted={brief.markRouteSnapshotStale}
          />
        ))}
      </div>
      {variant === 'compact' && bounds.source !== 'engine' ? <DurationBounds bounds={bounds} /> : null}
      {models.selectionIssue !== null ? (
        <p role='alert' className={styles.error}>
          {t(
            engineKey(
              models.selectionIssue === 'save_blocked'
                ? 'saveBlocked'
                : models.selectionIssue === 'save_stale'
                  ? 'saveStale'
                  : 'saveFailed'
            )
          )}
        </p>
      ) : null}
      {brief.routeSnapshotStale ? (
        <div className={styles.directorNotice}>
          <p>
            {t(engineKey('directorStale'), {
              model: brief.routeSnapshotStaleModel ?? fallbackStaleModel,
            })}
          </p>
          <Button type='text' onClick={brief.recreate}>
            {t(engineKey('directorStaleAction'))}
          </Button>
        </div>
      ) : null}
    </section>
  );
};

const DurationBounds: React.FC<{ bounds: ProjectEngineDurationBounds }> = ({ bounds }) => {
  const { t } = useTranslation();
  if (bounds.source === 'unbounded') return <p className={styles.bounds}>{t(engineKey('boundsUnbounded'))}</p>;
  return (
    <p className={styles.bounds}>
      {t(engineKey(bounds.source === 'engine' ? 'boundsFromEngine' : 'boundsFromOptions'), {
        min: bounds.min,
        max: bounds.max,
        model: bounds.source === 'engine' ? bounds.model : '',
      })}
    </p>
  );
};
