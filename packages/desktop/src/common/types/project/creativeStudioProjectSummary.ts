/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

import { isCanonicalStudioGeneratedTakeV2 } from './creativeStudioCanonicalTake';
import type {
  StudioAsset,
  StudioAssetV2,
  StudioClip,
  StudioProject,
  StudioProjectSummary,
  StudioProjectSummaryV2,
  StudioProjectV2,
  StudioScene,
} from './creativeStudioTypes';

const safeStudioIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Runtime boundary schema for the renderer-facing Creative Studio library listing. */
export const studioProjectSummarySchema = z
  .object({
    id: safeStudioIdSchema,
    name: z.string().min(1).max(256),
    forgeProjectId: safeStudioIdSchema.optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
    targetDurationSeconds: z.number().finite().int().min(5).max(60),
    resolution: z.enum(['720p', '1080p']),
    sceneCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    selectedAssetCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    poster: z
      .object({
        assetId: safeStudioIdSchema,
        sceneNumber: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
        takeNumber: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

/** Runtime boundary schema for the renderer-facing schema-2 library listing. */
export const studioProjectSummaryV2Schema = z
  .object({
    id: safeStudioIdSchema,
    name: z.string().min(1).max(256),
    forgeProjectId: safeStudioIdSchema.optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
    targetDurationSeconds: z.number().finite().int().min(5).max(60),
    resolution: z.enum(['720p', '1080p']),
    sectionCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    clipCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    selectedAssetCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    poster: z
      .object({
        sectionId: safeStudioIdSchema,
        clipId: safeStudioIdSchema,
        assetId: safeStudioIdSchema,
        sectionPosition: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
        clipPosition: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const canonicalSelectedAsset = (project: StudioProject, scene: StudioScene): StudioAsset | null => {
  if (scene.selectedAssetId === null) return null;
  const asset = project.assets[scene.selectedAssetId];
  return asset?.id === scene.selectedAssetId &&
    asset.projectId === project.id &&
    asset.sceneId === scene.id &&
    asset.mediaKind === scene.mediaKind &&
    asset.managedAsset.collection === 'assets' &&
    scene.assetIds.includes(asset.id)
    ? asset
    : null;
};

const canonicalGeneratedAssets = (project: StudioProject, scene: StudioScene): StudioAsset[] =>
  scene.assetIds.flatMap((assetId) => {
    const asset = project.assets[assetId];
    return asset?.id === assetId &&
      asset.projectId === project.id &&
      asset.sceneId === scene.id &&
      asset.mediaKind === scene.mediaKind &&
      asset.managedAsset.collection === 'assets'
      ? [asset]
      : [];
  });

const canonicalVideoPoster = (
  project: StudioProject,
  scene: StudioScene,
  selectedAssetId: string
): StudioAsset | null => {
  const producingJobs = scene.jobIds.flatMap((jobId) => {
    const job = project.jobs[jobId];
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.sceneId === scene.id &&
      job.status === 'succeeded' &&
      job.outputAssetIds[0] === selectedAssetId
      ? [job]
      : [];
  });
  if (producingJobs.length !== 1) return null;
  const posters = producingJobs[0]!.outputAssetIds.slice(1).flatMap((assetId) => {
    const asset = project.assets[assetId];
    return asset?.id === assetId &&
      asset.projectId === project.id &&
      asset.sceneId === scene.id &&
      asset.mediaKind === 'image' &&
      asset.managedAsset.collection === 'thumbnails' &&
      scene.assetIds.includes(asset.id)
      ? [asset]
      : [];
  });
  return posters.length === 1 ? posters[0]! : null;
};

/** Projects a durable project into the strict renderer-safe library-card contract. */
export const toStudioProjectSummary = (project: StudioProject): StudioProjectSummary => {
  let selectedAssetCount = 0;
  let poster: StudioProjectSummary['poster'] = null;
  let posterSceneFound = false;
  project.sceneOrder.forEach((sceneId, sceneIndex) => {
    const scene = project.scenes[sceneId];
    if (scene?.id !== sceneId) return;
    const selected = canonicalSelectedAsset(project, scene);
    if (selected === null) return;
    selectedAssetCount += 1;
    if (posterSceneFound) return;
    posterSceneFound = true;
    const takes = canonicalGeneratedAssets(project, scene);
    const takeIndex = takes.findIndex((asset) => asset.id === selected.id);
    if (takeIndex < 0) return;
    const posterAsset = selected.mediaKind === 'image' ? selected : canonicalVideoPoster(project, scene, selected.id);
    if (posterAsset === null) return;
    poster = {
      assetId: posterAsset.id,
      sceneNumber: sceneIndex + 1,
      takeNumber: takeIndex + 1,
    };
  });
  const summary: StudioProjectSummary = {
    id: project.id,
    name: project.name,
    forgeProjectId: project.forgeProjectId,
    aspectRatio: project.aspectRatio,
    targetDurationSeconds: project.targetDurationSeconds,
    resolution: project.resolution,
    sceneCount: project.sceneOrder.length,
    selectedAssetCount,
    poster,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  studioProjectSummarySchema.parse(summary);
  return summary;
};

const canonicalVideoPosterV2 = (
  project: StudioProjectV2,
  clip: StudioClip,
  selectedAssetId: string
): StudioAssetV2 | null => {
  const producingJobs = clip.jobIds.flatMap((jobId) => {
    const job = project.jobs[jobId];
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.clipId === clip.id &&
      job.status === 'succeeded' &&
      job.outputRole !== 'reference' &&
      job.outputAssetIds[0] === selectedAssetId
      ? [job]
      : [];
  });
  if (producingJobs.length !== 1) return null;
  const outputAssetIds = producingJobs[0]!.outputAssetIds;
  if (outputAssetIds.length !== 2) return null;
  const posterAssetId = outputAssetIds[1]!;
  const poster = project.assets[posterAssetId];
  return poster?.id === posterAssetId &&
    poster.projectId === project.id &&
    poster.clipId === clip.id &&
    poster.mediaKind === 'image' &&
    poster.managedAsset.collection === 'thumbnails' &&
    clip.assetIds.includes(poster.id)
    ? poster
    : null;
};

/** Projects a schema-2 project into its strict active-content library summary. */
export const toStudioProjectSummaryV2 = (project: StudioProjectV2): StudioProjectSummaryV2 => {
  let clipCount = 0;
  let selectedAssetCount = 0;
  let poster: StudioProjectSummaryV2['poster'];
  project.sectionOrder.forEach((sectionId, sectionIndex) => {
    const section = project.sections[sectionId];
    if (section?.id !== sectionId) return;
    clipCount += section.clipOrder.length;
    section.clipOrder.forEach((clipId, clipIndex) => {
      const clip = project.clips[clipId];
      if (clip?.id !== clipId || clip.selectedAssetId === null) return;
      const selected = project.assets[clip.selectedAssetId];
      if (selected === undefined || !isCanonicalStudioGeneratedTakeV2(selected, project.id, clip)) return;
      selectedAssetCount += 1;
      if (poster !== undefined) return;
      const posterAsset =
        selected.mediaKind === 'image' ? selected : canonicalVideoPosterV2(project, clip, selected.id);
      if (posterAsset === null) return;
      poster = {
        sectionId,
        clipId,
        assetId: posterAsset.id,
        sectionPosition: sectionIndex + 1,
        clipPosition: clipIndex + 1,
      };
    });
  });
  const summary: StudioProjectSummaryV2 = {
    id: project.id,
    name: project.name,
    ...(project.forgeProjectId === undefined ? {} : { forgeProjectId: project.forgeProjectId }),
    aspectRatio: project.aspectRatio,
    targetDurationSeconds: project.targetDurationSeconds,
    resolution: project.resolution,
    sectionCount: project.sectionOrder.length,
    clipCount,
    selectedAssetCount,
    ...(poster === undefined ? {} : { poster }),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  studioProjectSummaryV2Schema.parse(summary);
  return summary;
};
