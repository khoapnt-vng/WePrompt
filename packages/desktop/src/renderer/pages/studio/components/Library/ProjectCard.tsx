/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioProjectStatusStageIdV2,
  StudioProjectStatusStageStateV2,
  StudioProjectStatusV2,
  StudioProjectSummaryV2,
} from '@/common/types/project/creativeStudioTypes';
import { exactStudioProjectStatusV2 } from '@/common/types/project/creativeStudioProjectSummary';
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
  projectRevision: number | null;
  projectStatus: StudioProjectStatusV2 | null;
  locale: string;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
};

const STATUS_STAGE_KEYS = {
  brief: 'conversation.creativeStudio.workspace.library.projectStatus.stage.brief',
  engines: 'conversation.creativeStudio.workspace.library.projectStatus.stage.engines',
  references: 'conversation.creativeStudio.workspace.library.projectStatus.stage.references',
  storyboard: 'conversation.creativeStudio.workspace.library.projectStatus.stage.storyboard',
  bindings: 'conversation.creativeStudio.workspace.library.projectStatus.stage.bindings',
  production: 'conversation.creativeStudio.workspace.library.projectStatus.stage.production',
  cut: 'conversation.creativeStudio.workspace.library.projectStatus.stage.cut',
} as const satisfies Record<StudioProjectStatusStageIdV2, string>;

const STATUS_DOT_CLASSES = {
  not_started: 'bg-fill-4',
  in_progress: 'bg-warning-6',
  complete: 'bg-success-6',
  blocked: 'bg-danger-6',
} as const satisfies Record<StudioProjectStatusStageStateV2, string>;

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  projectRevision,
  projectStatus,
  locale,
  disabled,
  onOpen,
  onDelete,
}) => {
  const { t } = useTranslation();
  const posterSource = project.poster ? createManagedStudioAssetUrl(project.id, project.poster.assetId) : null;
  const [failedPosterSource, setFailedPosterSource] = useState<string | null>(null);
  const showPlaceholder = posterSource === null || failedPosterSource === posterSource;
  const status =
    projectRevision === null ? null : exactStudioProjectStatusV2(projectStatus, project.id, projectRevision);
  const currentStage = status?.stages.find((stage) => stage.state !== 'complete') ?? status?.stages.at(-1) ?? null;
  const statusProgress = (() => {
    if (currentStage === null) return null;
    switch (currentStage.id) {
      case 'brief':
      case 'engines':
        // The first non-complete stage cannot be ready; an all-complete project resolves to Cut.
        return t('conversation.creativeStudio.workspace.library.projectStatus.progress.needsWork');
      case 'references':
        return t('conversation.creativeStudio.workspace.library.projectStatus.progress.references', {
          current: currentStage.summary.approvedCount,
          total: currentStage.summary.plannedCount,
        });
      case 'storyboard':
        return t('conversation.creativeStudio.workspace.library.projectStatus.progress.shots', {
          current: currentStage.summary.authoredShotCount,
          total: currentStage.summary.shotCount,
        });
      case 'bindings':
        return t('conversation.creativeStudio.workspace.library.projectStatus.progress.shots', {
          current: currentStage.summary.readyShotCount,
          total: currentStage.summary.shotCount,
        });
      case 'production':
      case 'cut':
        return t('conversation.creativeStudio.workspace.library.projectStatus.progress.shots', {
          current: currentStage.summary.currentTakeCount,
          total: currentStage.summary.shotCount,
        });
    }
  })();

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
      <p data-status={currentStage?.state ?? 'unavailable'} className={styles.statusLine}>
        <span
          aria-hidden='true'
          className={`h-7px w-7px flex-none rounded-full ${
            currentStage === null ? 'bg-fill-4' : STATUS_DOT_CLASSES[currentStage.state]
          }`}
        />
        {currentStage === null || statusProgress === null || status === null
          ? t('conversation.creativeStudio.workspace.library.projectStatus.unavailable')
          : t('conversation.creativeStudio.workspace.library.projectStatus.summary', {
              stage: t(STATUS_STAGE_KEYS[currentStage.id]),
              progress: statusProgress,
              blockers: t('conversation.creativeStudio.workspace.project.blockers', {
                count: status.blockerCount,
              }),
            })}
      </p>
      <p className={styles.projectMeta}>
        <span>{t('conversation.creativeStudio.workspace.library.beatCount', { count: project.beatCount })}</span>
        {' · '}
        <span>{t('conversation.creativeStudio.workspace.library.shotCount', { count: project.shotCount })}</span>
        {' · '}
        <span>
          {t('conversation.creativeStudio.workspace.library.pictureCount', {
            count: project.pictureCount,
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
