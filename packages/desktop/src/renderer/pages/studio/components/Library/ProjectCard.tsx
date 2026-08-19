/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioProjectSummaryV2 } from '@/common/types/project/creativeStudioTypes';
import { Button, Card, Tag } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createManagedStudioAssetUrl } from '../../studioManagedAssetUrl';
import styles from './StudioLibrary.module.css';

const RELATIVE_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; milliseconds: number; limit: number }> = [
  { unit: 'second', milliseconds: 1_000, limit: 60 },
  { unit: 'minute', milliseconds: 60_000, limit: 60 },
  { unit: 'hour', milliseconds: 3_600_000, limit: 24 },
  { unit: 'day', milliseconds: 86_400_000, limit: 30 },
  { unit: 'month', milliseconds: 2_592_000_000, limit: 12 },
  { unit: 'year', milliseconds: 31_536_000_000, limit: Number.POSITIVE_INFINITY },
];

const POSTER_GRADIENT_COUNT = 6;

const getPosterGradientIndex = (projectId: string): number => {
  let hash = 0;
  for (const character of projectId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash % POSTER_GRADIENT_COUNT;
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
  project: StudioProjectSummaryV2;
  locale: string;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
};

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, locale, disabled, onOpen, onDelete }) => {
  const { t } = useTranslation();
  const posterSource = project.poster ? createManagedStudioAssetUrl(project.id, project.poster.assetId) : null;
  const [failedPosterSource, setFailedPosterSource] = useState<string | null>(null);
  const showPlaceholder = posterSource === null || failedPosterSource === posterSource;
  const complete = project.shotCount > 0 && project.selectedTakeCount >= project.shotCount;
  const partial = !complete && project.selectedTakeCount > 0;
  const statusKey = complete
    ? 'conversation.creativeStudio.workspace.library.status.complete'
    : partial
      ? 'conversation.creativeStudio.workspace.library.status.partial'
      : 'conversation.creativeStudio.workspace.library.status.spineOnly';
  const statusClass = complete ? 'bg-success-6' : partial ? 'bg-warning-6' : 'bg-fill-4';

  return (
    <Card
      className={styles.projectCard}
      cover={
        <div className={styles.poster}>
          {showPlaceholder ? (
            <div className={styles.scriptPoster} data-gradient={getPosterGradientIndex(project.id)}>
              <Tag className={styles.posterLabel}>{t('conversation.creativeStudio.workspace.library.noPoster')}</Tag>
            </div>
          ) : (
            <img
              className={styles.posterImage}
              src={posterSource}
              alt={project.name}
              onError={() => setFailedPosterSource(posterSource)}
            />
          )}
          {project.poster && !showPlaceholder ? (
            <Tag className={styles.posterBadge}>
              {t('conversation.creativeStudio.workspace.library.posterBadge', {
                beat: project.poster.beatPosition,
                shot: project.poster.shotPosition,
              })}
            </Tag>
          ) : null}
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
          aria-label={t('conversation.creativeStudio.workspace.library.deleteProject')}
          disabled={disabled}
          onClick={onDelete}
        />
      </div>
      <p data-status={complete ? 'complete' : partial ? 'partial' : 'spine'} className={styles.statusLine}>
        <span aria-hidden='true' className={`h-7px w-7px flex-none rounded-full ${statusClass}`} />
        {t(statusKey)}
      </p>
      <p className={styles.projectMeta}>
        <span>{t('conversation.creativeStudio.workspace.library.beatCount', { count: project.beatCount })}</span>
        {' · '}
        <span>{t('conversation.creativeStudio.workspace.library.shotCount', { count: project.shotCount })}</span>
        {' · '}
        <span>
          {t('conversation.creativeStudio.workspace.library.selectedTakeCount', {
            count: project.selectedTakeCount,
          })}
        </span>
      </p>
      <p className={styles.projectMeta}>
        {t('conversation.creativeStudio.workspace.library.updated', {
          relative: formatStudioRelativeTime(project.updatedAt, locale),
        })}
      </p>
    </Card>
  );
};
