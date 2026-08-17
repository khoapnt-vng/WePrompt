/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAsset,
  StudioRendererJob,
  StudioRendererProject,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';

export type StudioSceneStatus =
  | 'needs_title'
  | 'needs_prompt'
  | 'ready'
  | 'generating'
  | 'needs_selection'
  | 'generated'
  | 'needs_attention';

export type StudioReadinessSummary = {
  sceneStatuses: Record<string, StudioSceneStatus>;
  totalSceneCount: number;
  readySceneIds: string[];
  selectedAssetCount: number;
  /** Summed over the canonical shot order, so a duplicated scene id counts once. */
  durationTotalSeconds: number;
  durationDeltaSeconds: number;
};

export const canOpenSingleSceneReview = (status: StudioSceneStatus | undefined, visualPrompt: string): boolean =>
  visualPrompt.trim().length > 0 && (status === 'ready' || status === 'needs_selection' || status === 'generated');

const ACTIVE_JOB_STATUSES = new Set<StudioRendererJob['status']>([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);

const canonicalScenes = (project: StudioRendererProject): StudioScene[] => {
  const seen = new Set<string>();
  return project.sceneOrder.flatMap((sceneId) => {
    if (seen.has(sceneId)) return [];
    seen.add(sceneId);
    const scene = project.scenes[sceneId];
    return scene?.id === sceneId ? [scene] : [];
  });
};

const canonicalSceneJobs = (project: StudioRendererProject, scene: StudioScene): StudioRendererJob[] =>
  scene.jobIds.flatMap((jobId) => {
    const job = project.jobs[jobId];
    return job?.id === jobId && job.projectId === project.id && job.sceneId === scene.id ? [job] : [];
  });

const canonicalSceneAsset = (
  project: StudioRendererProject,
  scene: StudioScene,
  assetId: string
): StudioAsset | null => {
  const asset = project.assets[assetId];
  return asset?.id === assetId &&
    asset.projectId === project.id &&
    asset.sceneId === scene.id &&
    asset.mediaKind === scene.mediaKind &&
    asset.managedAsset.collection === 'assets' &&
    scene.assetIds.includes(assetId)
    ? asset
    : null;
};

const generatedAssetIds = (project: StudioRendererProject, scene: StudioScene): Set<string> => {
  const generated = new Set<string>();
  for (const assetId of scene.assetIds) {
    if (canonicalSceneAsset(project, scene, assetId) !== null) generated.add(assetId);
  }
  return generated;
};

/** Derives renderer-safe, ordered project readiness from canonical scene, job, and asset identities. */
export const deriveStudioReadiness = (project: StudioRendererProject): StudioReadinessSummary => {
  const scenes = canonicalScenes(project);
  const sceneStatuses: Record<string, StudioSceneStatus> = {};
  const readySceneIds: string[] = [];
  let selectedAssetCount = 0;

  for (const scene of scenes) {
    const jobs = canonicalSceneJobs(project, scene);
    const generated = generatedAssetIds(project, scene);
    const selectedGenerated = scene.selectedAssetId !== null && generated.has(scene.selectedAssetId);
    if (selectedGenerated) selectedAssetCount += 1;

    let status: StudioSceneStatus;
    if (scene.title.trim().length === 0) {
      // A missing title blocks generation exactly as a missing prompt does
      // (see batchSceneIsReady), but it is a different gap and must say so —
      // reporting `needs_prompt` sends the user to a field that is already filled.
      status = 'needs_title';
    } else if (jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) {
      status = 'generating';
    } else if (selectedGenerated) {
      status = 'generated';
    } else if (generated.size > 0) {
      status = 'needs_selection';
    } else {
      const latestJob = jobs.at(-1);
      if (latestJob?.status === 'failed' || latestJob?.status === 'needs_attention') {
        status = 'needs_attention';
      } else if (scene.visualPrompt.trim().length === 0) {
        status = 'needs_prompt';
      } else {
        status = 'ready';
        readySceneIds.push(scene.id);
      }
    }
    sceneStatuses[scene.id] = status;
  }

  const durationTotalSeconds = scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
  return {
    sceneStatuses,
    totalSceneCount: scenes.length,
    readySceneIds,
    selectedAssetCount,
    durationTotalSeconds,
    durationDeltaSeconds: durationTotalSeconds - project.targetDurationSeconds,
  };
};
