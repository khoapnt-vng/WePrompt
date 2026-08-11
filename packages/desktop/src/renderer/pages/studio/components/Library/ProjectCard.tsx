/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioProjectSummary } from '@/common/types/project/creativeStudioTypes';
import { Button, Card, Tag } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createManagedStudioAssetUrl } from '../Preview';
import styles from './StudioLibrary.module.css';

const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; milliseconds: number; limit: number }> = [
  { unit: 'second', milliseconds: 1_000, limit: 60 },
  { unit: 'minute', milliseconds: 60_000, limit: 60 },
  { unit: 'hour', milliseconds: 3_600_000, limit: 24 },
  { unit: 'day', milliseconds: 86_400_000, limit: 30 },
  { unit: 'month', milliseconds: 2_592_000_000, limit: 12 },
  { unit: 'year', milliseconds: 31_536_000_000, limit: Number.POSITIVE_INFINITY },
];

const SCRIPT_POSTER_GRADIENT_COUNT = 6;

const getScriptPosterGradientIndex = (projectId: string): number => {
  let hash = 0;
  for (const character of projectId) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  return hash % SCRIPT_POSTER_GRADIENT_COUNT;
};

export const formatStudioRelativeTime = (timestamp: string, locale: string, now = Date.now()): string => {
  const delta = Date.parse(timestamp) - now;
  const absolute = Math.abs(delta);
  const choice = RELATIVE_UNITS.find(({ milliseconds, limit }) => absolute < milliseconds * limit)!;
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(delta / choice.milliseconds),
    choice.unit
  );
};

export type ProjectCardProps = {
  project: StudioProjectSummary;
  locale: string;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
};

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, locale, disabled, onOpen, onDelete }) => {
  const { t } = useTranslation();
  const posterSource = project.poster === null ? null : createManagedStudioAssetUrl(project.id, project.poster.assetId);
  const [failedPosterSource, setFailedPosterSource] = useState<string | null>(null);
  const showScriptPoster = posterSource === null || failedPosterSource === posterSource;
  const complete = project.sceneCount > 0 && project.selectedAssetCount >= project.sceneCount;
  const partial = !complete && project.selectedAssetCount > 0;
  const statusKey = complete
    ? 'conversation.creativeStudio.library.status.handedOff'
    : partial
      ? 'conversation.creativeStudio.library.status.partiallyRendered'
      : 'conversation.creativeStudio.library.status.scriptOnly';
  const statusClass = complete ? 'bg-success-6' : partial ? 'bg-warning-6' : 'bg-fill-4';

  return (
    <Card
      className={styles.projectCard}
      cover={
        <div className={styles.poster}>
          {showScriptPoster ? (
            <div className={styles.scriptPoster} data-gradient={getScriptPosterGradientIndex(project.id)}>
              <Tag className={styles.posterLabel}>{t('conversation.creativeStudio.library.scriptOnly')}</Tag>
            </div>
          ) : (
            <img
              className={styles.posterImage}
              src={posterSource}
              alt={project.name}
              onError={() => setFailedPosterSource(posterSource)}
            />
          )}
          {project.poster !== null && !showScriptPoster && (
            <Tag className={styles.posterBadge}>
              {t('conversation.creativeStudio.library.posterBadge', {
                scene: String(project.poster.sceneNumber).padStart(2, '0'),
                take: project.poster.takeNumber,
              })}
            </Tag>
          )}
        </div>
      }
    >
      <div className={styles.cardHeader}>
        <Button type='text' className={styles.projectName} disabled={disabled} onClick={onOpen}>
          {project.name}
        </Button>
        <Button
          type='text'
          status='danger'
          className={styles.deleteButton}
          icon={<Delete />}
          aria-label={t('conversation.creativeStudio.library.deleteProject')}
          disabled={disabled}
          onClick={onDelete}
        />
      </div>
      <p data-status={complete ? 'complete' : partial ? 'partial' : 'script'} className={styles.statusLine}>
        <span aria-hidden='true' className={`h-7px w-7px flex-none rounded-full ${statusClass}`} />
        {t(statusKey, {
          count: project.sceneCount,
          rendered: project.selectedAssetCount,
          total: project.sceneCount,
          seconds: project.targetDurationSeconds,
        })}
      </p>
      <p className={styles.projectMeta}>
        {t('conversation.creativeStudio.library.meta', {
          shots: t('conversation.creativeStudio.library.shotCount', { count: project.sceneCount }),
          seconds: project.targetDurationSeconds,
          relative: formatStudioRelativeTime(project.updatedAt, locale),
        })}
      </p>
    </Card>
  );
};
