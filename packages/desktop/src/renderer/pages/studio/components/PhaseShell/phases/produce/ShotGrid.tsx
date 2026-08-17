/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAsset,
  StudioRendererJob,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { Modal } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildSingleSceneReviewRequest,
  describeSceneRenderBlock,
  type GenerationSingleReviewRequest,
} from '../../../Generation/generationRequests';
import {
  createManagedStudioAssetUrl,
  isCanonicalStudioPosterAsset,
  isCanonicalStudioSelectedAsset,
  StagePreview,
} from '../../../Preview';
import { canOpenSingleSceneReview, type StudioSceneStatus } from '../../../../studioReadiness';
import { ShotCard } from './ShotCard';
import styles from './produce.module.css';

const ACTIVE_JOB_STATUSES = new Set<StudioRendererJob['status']>([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);

export type ShotGridProps = {
  project: StudioRendererProject;
  scenes: readonly StudioScene[];
  sceneStatuses: Readonly<Record<string, StudioSceneStatus>>;
  selectedSceneId: string | null;
  catalog: StudioRouteCatalog | null;
  catalogLoading: boolean;
  generationDisabled: boolean;
  mutationPending: boolean;
  jobs: readonly StudioRendererJob[];
  jobsMutationPending: boolean;
  onSelectScene: (sceneId: string) => void;
  onWriteVisual: (sceneId: string) => void;
  onFocusEngineRole: (role: 'image' | 'video') => void;
  onRemoveReference: (sceneId: string) => void;
  onShorten: (sceneId: string) => void;
  onOpenSingleReview: (request: GenerationSingleReviewRequest) => void;
  onCancelJob: (jobId: string) => void | Promise<unknown>;
};

const canonicalTakes = (project: StudioRendererProject, scene: StudioScene): StudioAsset[] => {
  const seen = new Set<string>();
  return scene.assetIds.flatMap((assetId) => {
    if (seen.has(assetId)) return [];
    seen.add(assetId);
    const candidate = project.assets[assetId];
    return candidate?.id === assetId &&
      candidate.projectId === project.id &&
      candidate.sceneId === scene.id &&
      candidate.mediaKind === scene.mediaKind &&
      candidate.managedAsset.collection === 'assets'
      ? [candidate]
      : [];
  });
};

const selectedTake = (
  project: StudioRendererProject,
  scene: StudioScene,
  takes: readonly StudioAsset[]
): StudioAsset | null => {
  if (scene.selectedAssetId === null) return null;
  const candidate = takes.find((asset) => asset.id === scene.selectedAssetId) ?? null;
  return candidate !== null && isCanonicalStudioSelectedAsset(candidate, project.id, scene, scene.selectedAssetId)
    ? candidate
    : null;
};

const selectedPoster = (
  project: StudioRendererProject,
  scene: StudioScene,
  selected: StudioAsset | null
): StudioAsset | null => {
  if (scene.mediaKind !== 'video' || selected === null) return null;
  const seenJobs = new Set<string>();
  const producers = scene.jobIds.flatMap((jobId) => {
    if (seenJobs.has(jobId)) return [];
    seenJobs.add(jobId);
    const candidate = project.jobs[jobId];
    return candidate?.id === jobId &&
      candidate.projectId === project.id &&
      candidate.sceneId === scene.id &&
      candidate.status === 'succeeded' &&
      candidate.outputAssetIds[0] === selected.id
      ? [candidate]
      : [];
  });
  if (producers.length !== 1) return null;

  const seenPosters = new Set<string>();
  const posters = producers[0]!.outputAssetIds.slice(1).flatMap((assetId) => {
    if (seenPosters.has(assetId)) return [];
    seenPosters.add(assetId);
    const candidate = project.assets[assetId];
    return candidate !== undefined && isCanonicalStudioPosterAsset(candidate, project.id, scene) ? [candidate] : [];
  });
  return posters.length === 1 ? posters[0]! : null;
};

const displayedSceneJob = (
  projectId: string,
  scene: StudioScene,
  jobs: readonly StudioRendererJob[]
): StudioRendererJob | null => {
  const sceneJobIds = new Set(scene.jobIds);
  const candidates = jobs
    .filter(
      (candidate) =>
        sceneJobIds.has(candidate.id) &&
        candidate.projectId === projectId &&
        candidate.sceneId === scene.id &&
        ACTIVE_JOB_STATUSES.has(candidate.status)
    )
    .toSorted((left, right) => {
      const newestFirst = right.updatedAt.localeCompare(left.updatedAt);
      return newestFirst === 0 ? left.id.localeCompare(right.id) : newestFirst;
    });
  return candidates[0] ?? null;
};

/** Responsive Produce grid; the large StagePreview is mounted only after a take is opened. */
export const ShotGrid: React.FC<ShotGridProps> = ({
  project,
  scenes,
  sceneStatuses,
  selectedSceneId,
  catalog,
  catalogLoading,
  generationDisabled,
  mutationPending,
  jobs,
  jobsMutationPending,
  onSelectScene,
  onWriteVisual,
  onFocusEngineRole,
  onRemoveReference,
  onShorten,
  onOpenSingleReview,
  onCancelJob,
}) => {
  const { t } = useTranslation();
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const previewScene = previewSceneId === null ? null : (project.scenes[previewSceneId] ?? null);
  const previewTakes = previewScene === null ? [] : canonicalTakes(project, previewScene);
  const previewAsset = previewScene === null ? null : selectedTake(project, previewScene, previewTakes);
  const previewPoster = previewScene === null ? null : selectedPoster(project, previewScene, previewAsset);

  return (
    <section aria-label={t('conversation.creativeStudio.storyboard.title')} className={styles.shotGridSection}>
      <ul className={styles.shotGrid}>
        {scenes.map((scene, index) => {
          const takes = canonicalTakes(project, scene);
          const selected = selectedTake(project, scene, takes);
          const poster = selectedPoster(project, scene, selected);
          const selectedSource = selected === null ? null : createManagedStudioAssetUrl(project.id, selected.id);
          const posterSource = poster === null ? null : createManagedStudioAssetUrl(project.id, poster.id);
          const selectedIndex = selected === null ? -1 : takes.findIndex((candidate) => candidate.id === selected.id);
          const status = sceneStatuses[scene.id] ?? 'needs_prompt';
          const renderBlock = describeSceneRenderBlock(project, catalog, scene);
          const nonRouteDisabled =
            generationDisabled || catalogLoading || !canOpenSingleSceneReview(status, scene.visualPrompt);
          const reviewRequest =
            nonRouteDisabled || renderBlock !== null
              ? null
              : buildSingleSceneReviewRequest({
                  project,
                  catalog,
                  scene,
                  durationSeconds: scene.durationSeconds,
                  hasReference: scene.referenceAssetId !== null,
                });

          return (
            <ShotCard
              key={scene.id}
              projectId={project.id}
              scene={scene}
              index={index}
              status={status}
              selected={scene.id === selectedSceneId}
              selectedTakeSource={selectedSource}
              selectedTakeId={selected?.id ?? null}
              posterSource={posterSource}
              takeCurrent={selectedIndex < 0 ? 0 : selectedIndex + 1}
              takeTotal={takes.length}
              displayedJob={displayedSceneJob(project.id, scene, jobs)}
              mutationPending={mutationPending}
              cancelPending={jobsMutationPending}
              renderBlock={renderBlock}
              renderDisabled={nonRouteDisabled}
              onSelect={() => onSelectScene(scene.id)}
              onOpenPreview={() => {
                onSelectScene(scene.id);
                setPreviewSceneId(scene.id);
              }}
              onWriteVisual={() => onWriteVisual(scene.id)}
              onFocusEngineRole={() => onFocusEngineRole(scene.mediaKind)}
              onRemoveReference={() => onRemoveReference(scene.id)}
              onShorten={() => onShorten(scene.id)}
              onOpenReview={() => {
                if (reviewRequest !== null) onOpenSingleReview(reviewRequest);
              }}
              onCancelJob={onCancelJob}
            />
          );
        })}
      </ul>

      <Modal
        visible={previewScene !== null && previewAsset !== null}
        wrapClassName={styles.modalSurface}
        title={previewScene?.title}
        footer={null}
        unmountOnExit
        className={styles.previewModal}
        onCancel={() => setPreviewSceneId(null)}
      >
        {previewScene !== null && previewAsset !== null && (
          <StagePreview
            projectId={project.id}
            selectedScene={previewScene}
            selectedAsset={previewAsset}
            posterAsset={previewPoster}
          />
        )}
      </Modal>
    </section>
  );
};
