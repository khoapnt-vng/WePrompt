/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

import { isCanonicalStudioGeneratedTakeV2 } from './creativeStudioCanonicalTake';
import {
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
} from './creativeStudioTypes';
import type {
  StudioAssetV2,
  StudioBeat,
  StudioShot,
  StudioProjectSummaryV2,
  StudioProjectStatusV2,
  StudioProjectV2,
  StudioPlanningShotBoundaryV2,
} from './creativeStudioTypes';

const projectStatusStageStatesV2 = new Set(['not_started', 'in_progress', 'complete', 'blocked']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Accepts Main's read model only when its identity, stage order, shape, and aggregates are self-consistent. */
export const exactStudioProjectStatusV2 = (
  status: unknown,
  projectId: string,
  projectRevision: number
): StudioProjectStatusV2 | null => {
  if (
    !isRecord(status) ||
    status.projectId !== projectId ||
    status.projectRevision !== projectRevision ||
    !isNonnegativeSafeInteger(status.blockerCount) ||
    (status.catalogVersion !== null && typeof status.catalogVersion !== 'string') ||
    !Array.isArray(status.stages) ||
    status.stages.length !== STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.length ||
    !Array.isArray(status.advisories) ||
    !isRecord(status.boards) ||
    !isNonnegativeSafeInteger(status.boards.currentPictureCount) ||
    !isNonnegativeSafeInteger(status.boards.shotCount) ||
    (status.detail !== null &&
      (!isRecord(status.detail) || !Array.isArray(status.detail.shots) || !Array.isArray(status.detail.references)))
  ) {
    return null;
  }

  let blockerCount = 0;
  for (const [index, stage] of status.stages.entries()) {
    const expectedStage = STUDIO_PROJECT_STATUS_STAGE_ORDER_V2[index];
    if (
      !isRecord(stage) ||
      stage.id !== expectedStage ||
      typeof stage.state !== 'string' ||
      !projectStatusStageStatesV2.has(stage.state) ||
      !isRecord(stage.summary) ||
      stage.summary.stage !== expectedStage ||
      !Array.isArray(stage.blockers)
    ) {
      return null;
    }
    blockerCount += stage.blockers.length;
  }
  return blockerCount === status.blockerCount ? (status as StudioProjectStatusV2) : null;
};

const safeStudioIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const hostileStudioPropertyIds = new Set(['__proto__', 'constructor', 'toString']);

/** Runtime boundary schema for the renderer-facing schema-2 library listing. */
export const studioProjectSummaryV2Schema = z
  .object({
    id: safeStudioIdSchema,
    name: z.string().min(1).max(256),
    forgeProjectId: safeStudioIdSchema.optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
    targetDurationSeconds: z.number().finite().int().min(5).max(1440),
    resolution: z.enum(['720p', '1080p']),
    beatCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    shotCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    pictureCount: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    poster: z
      .object({
        beatId: safeStudioIdSchema,
        shotId: safeStudioIdSchema,
        assetId: safeStudioIdSchema,
        beatPosition: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
        shotPosition: z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const canonicalVideoPosterV2 = (
  project: StudioProjectV2,
  shot: StudioShot,
  videoAssetId: string
): StudioAssetV2 | null => {
  const producingJobs = shot.jobIds.flatMap((jobId) => {
    const job = project.jobs[jobId];
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.status === 'succeeded' &&
      job.purpose === 'video_take' &&
      job.outputAssetIdsByRole.primary === videoAssetId &&
      job.outputAssetIds.filter((assetId) => assetId === videoAssetId).length === 1
      ? [job]
      : [];
  });
  if (producingJobs.length !== 1) return null;
  const posterAssetId = producingJobs[0]!.outputAssetIdsByRole.poster;
  if (
    posterAssetId === null ||
    producingJobs[0]!.outputAssetIds.filter((assetId) => assetId === posterAssetId).length !== 1
  ) {
    return null;
  }
  const poster = project.assets[posterAssetId];
  return poster?.id === posterAssetId &&
    poster.projectId === project.id &&
    poster.shotId === shot.id &&
    poster.mediaKind === 'image' &&
    poster.managedAsset.collection === 'thumbnails' &&
    shot.assetIds.includes(poster.id)
    ? poster
    : null;
};

/** Returns active planning boundaries without consulting selected media, trims, or provider state. */
export const studioPlanningShotBoundariesV2 = (
  beat: StudioBeat,
  shots: Readonly<Record<string, StudioShot>>
): StudioPlanningShotBoundaryV2[] | null => {
  if (!Array.isArray(beat.shotOrder) || typeof shots !== 'object' || shots === null) return null;
  const boundaries: StudioPlanningShotBoundaryV2[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  for (const shotId of beat.shotOrder) {
    if (
      !safeStudioIdSchema.safeParse(shotId).success ||
      hostileStudioPropertyIds.has(shotId) ||
      seen.has(shotId) ||
      !Object.hasOwn(shots, shotId)
    ) {
      return null;
    }
    const shot = shots[shotId];
    if (
      shot?.id !== shotId ||
      !Number.isSafeInteger(shot.durationSeconds) ||
      shot.durationSeconds < STUDIO_MIN_SHOT_SECONDS ||
      shot.durationSeconds > STUDIO_MAX_SHOT_SECONDS
    ) {
      return null;
    }
    const endSeconds = cursor + shot.durationSeconds;
    if (!Number.isSafeInteger(endSeconds)) return null;
    boundaries.push({ shotId, startSeconds: cursor, endSeconds });
    cursor = endSeconds;
    seen.add(shotId);
  }
  return boundaries;
};

/** Returns one active Shot's played duration, using its rendered picture when it exists. */
export const studioShotPlayedDurationV2 = (
  project: Pick<StudioProjectV2, 'id' | 'assets'>,
  shot: StudioShot
): number | null => {
  if (shot.videoAssetId === null) {
    return shot.trimInSeconds === null &&
      shot.trimOutSeconds === null &&
      Number.isSafeInteger(shot.durationSeconds) &&
      shot.durationSeconds >= STUDIO_MIN_SHOT_SECONDS &&
      shot.durationSeconds <= STUDIO_MAX_SHOT_SECONDS
      ? shot.durationSeconds
      : null;
  }
  if (!Object.hasOwn(project.assets, shot.videoAssetId)) return null;
  const selected = project.assets[shot.videoAssetId];
  if (
    selected?.id !== shot.videoAssetId ||
    selected.mediaKind !== 'video' ||
    selected.durationSeconds === undefined ||
    !Number.isFinite(selected.durationSeconds) ||
    selected.durationSeconds <= 0 ||
    selected.durationSeconds > Number.MAX_SAFE_INTEGER ||
    !isCanonicalStudioGeneratedTakeV2(selected, project.id, shot)
  ) {
    return null;
  }
  const trimInSeconds = shot.trimInSeconds ?? 0;
  const trimOutSeconds = shot.trimOutSeconds ?? 0;
  if (
    !Number.isFinite(trimInSeconds) ||
    !Number.isFinite(trimOutSeconds) ||
    trimInSeconds < 0 ||
    trimOutSeconds < 0 ||
    Object.is(trimInSeconds, -0) ||
    Object.is(trimOutSeconds, -0) ||
    trimInSeconds >= selected.durationSeconds ||
    trimOutSeconds >= selected.durationSeconds ||
    trimInSeconds + trimOutSeconds >= selected.durationSeconds
  ) {
    return null;
  }
  return selected.durationSeconds - trimInSeconds - trimOutSeconds;
};

export type StudioFilmDurationProjectionV2 = {
  knownSeconds: number;
  unresolvedBeatIds: string[];
};

const addStudioDuration = (left: number, right: number): number | null => {
  const result = left + right;
  return Number.isFinite(result) && result >= 0 && result <= Number.MAX_SAFE_INTEGER ? result : null;
};

/** Projects active film duration while preserving null-target spine Beats as unresolved. */
export const toStudioFilmDurationV2 = (project: StudioProjectV2): StudioFilmDurationProjectionV2 => {
  let knownSeconds = 0;
  const unresolvedBeatIds: string[] = [];
  for (const beatId of project.beatOrder) {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    if (beat?.id !== beatId) {
      unresolvedBeatIds.push(beatId);
      continue;
    }
    if (beat.shotOrder.length === 0) {
      if (beat.targetSeconds === null) unresolvedBeatIds.push(beatId);
      else {
        const nextKnownSeconds = addStudioDuration(knownSeconds, beat.targetSeconds);
        if (nextKnownSeconds === null) unresolvedBeatIds.push(beatId);
        else knownSeconds = nextKnownSeconds;
      }
      continue;
    }
    let beatSeconds = 0;
    let resolved = true;
    for (const shotId of beat.shotOrder) {
      const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
      const duration = shot?.id === shotId ? studioShotPlayedDurationV2(project, shot) : null;
      if (duration === null) {
        resolved = false;
        break;
      }
      const nextBeatSeconds = addStudioDuration(beatSeconds, duration);
      if (nextBeatSeconds === null) {
        resolved = false;
        break;
      }
      beatSeconds = nextBeatSeconds;
    }
    const nextKnownSeconds = resolved ? addStudioDuration(knownSeconds, beatSeconds) : null;
    if (nextKnownSeconds === null) unresolvedBeatIds.push(beatId);
    else knownSeconds = nextKnownSeconds;
  }
  return { knownSeconds, unresolvedBeatIds };
};

/** Projects a schema-2 project into its strict active-content library summary. */
export const toStudioProjectSummaryV2 = (project: StudioProjectV2): StudioProjectSummaryV2 => {
  let shotCount = 0;
  let pictureCount = 0;
  let poster: StudioProjectSummaryV2['poster'];
  project.beatOrder.forEach((beatId, beatIndex) => {
    const beat = project.beats[beatId];
    if (beat?.id !== beatId) return;
    shotCount += beat.shotOrder.length;
    beat.shotOrder.forEach((shotId, shotIndex) => {
      const shot = project.shots[shotId];
      if (shot?.id !== shotId || shot.videoAssetId === null) return;
      const selected = project.assets[shot.videoAssetId];
      if (
        selected === undefined ||
        selected.mediaKind !== 'video' ||
        !isCanonicalStudioGeneratedTakeV2(selected, project.id, shot)
      ) {
        return;
      }
      pictureCount += 1;
      if (poster !== undefined) return;
      const posterAsset = canonicalVideoPosterV2(project, shot, selected.id);
      if (posterAsset === null) return;
      poster = {
        beatId,
        shotId,
        assetId: posterAsset.id,
        beatPosition: beatIndex + 1,
        shotPosition: shotIndex + 1,
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
    beatCount: project.beatOrder.length,
    shotCount,
    pictureCount,
    ...(poster === undefined ? {} : { poster }),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  studioProjectSummaryV2Schema.parse(summary);
  return summary;
};
