/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAssetV2,
  StudioBeat,
  StudioJobV2,
  StudioProjectV2,
  StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_MAX_PROJECT_REFERENCES } from '@/common/types/project/creativeStudioTypes';
import { createStudioBoardGenerationRequestPlanForShot } from './boardRequest';
import { isStudioGenerationRequestCurrent } from './generationRequest';
import { resolveStudioReferenceBindingV2 } from './referenceBinding';

const ownValue = <T>(record: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

export type StudioCanonicalBoardAssetV2 = {
  asset: StudioAssetV2;
  producer: StudioJobV2;
};

/** Resolves one immutable Board output through its exact successful producer. */
export const resolveStudioCanonicalBoardAssetV2 = (
  project: StudioProjectV2,
  shot: StudioShot,
  assetId: string
): StudioCanonicalBoardAssetV2 | null => {
  const asset = ownValue(project.assets, assetId);
  if (
    asset?.id !== assetId ||
    asset.projectId !== project.id ||
    asset.shotId !== shot.id ||
    asset.mediaKind !== 'image' ||
    asset.managedAsset.collection !== 'boardStills' ||
    shot.assetIds.filter((candidate) => candidate === assetId).length !== 1
  ) {
    return null;
  }
  const producers = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.purpose === 'board_still' &&
      job.status === 'succeeded' &&
      job.outputAssetIdsByRole.primary === assetId &&
      job.outputAssetIds.filter((candidate) => candidate === assetId).length === 1
      ? [job]
      : [];
  });
  return producers.length === 1 ? { asset, producer: producers[0]! } : null;
};

export type StudioCurrentBoardPanelAuthorityV2 = StudioCanonicalBoardAssetV2 & {
  beat: StudioBeat;
  shot: StudioShot;
  shotIndex: number;
};

export type StudioFreshBoardAssetAuthorityV2 = StudioCanonicalBoardAssetV2 & {
  beat: StudioBeat;
  shot: StudioShot;
};

export const studioBoardPanelFreshnessV2 = (
  project: StudioProjectV2,
  beat: StudioBeat,
  shot: StudioShot,
  producer: StudioJobV2
): { requestCurrent: boolean; routeCurrent: boolean } => {
  const routeCurrent =
    producer.spendReceipt !== null &&
    project.imageRouteId !== null &&
    producer.spendReceipt.purpose === 'board_still' &&
    producer.spendReceipt.routeId === project.imageRouteId;
  if (producer.requestSnapshot === null) return { requestCurrent: false, routeCurrent };
  const binding = resolveStudioReferenceBindingV2({
    project,
    shotId: shot.id,
    maxConditioningImages: STUDIO_MAX_PROJECT_REFERENCES,
  });
  if (binding.ok === false) return { requestCurrent: false, routeCurrent };
  try {
    const currentRequest = createStudioBoardGenerationRequestPlanForShot({
      project,
      beat,
      shot,
      route: producer.provider,
      referenceInputs: binding.referenceInputs,
    });
    return {
      requestCurrent:
        currentRequest !== null && isStudioGenerationRequestCurrent(producer.requestSnapshot, currentRequest.snapshot),
      routeCurrent,
    };
  } catch {
    return { requestCurrent: false, routeCurrent };
  }
};

/** Resolves a fresh Board asset when the caller already owns its active Beat/Shot location. */
export const resolveStudioFreshBoardAssetV2 = (
  project: StudioProjectV2,
  beatId: string,
  shotId: string,
  boardAssetId: string
): StudioFreshBoardAssetAuthorityV2 | null => {
  const beat = ownValue(project.beats, beatId);
  const shot = ownValue(project.shots, shotId);
  if (
    beat?.id !== beatId ||
    shot?.id !== shotId ||
    beat.shotOrder.filter((candidate) => candidate === shotId).length !== 1
  ) {
    return null;
  }
  const canonical = resolveStudioCanonicalBoardAssetV2(project, shot, boardAssetId);
  if (canonical === null) return null;
  const freshness = studioBoardPanelFreshnessV2(project, beat, shot, canonical.producer);
  return freshness.requestCurrent && freshness.routeCurrent ? { ...canonical, beat, shot } : null;
};

const resolveStudioOrdinarySeedAssetV2 = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string
): StudioAssetV2 | null => {
  const shot = ownValue(project.shots, shotId);
  const asset = ownValue(project.assets, assetId);
  return shot !== undefined &&
    asset?.id === assetId &&
    asset.projectId === project.id &&
    asset.shotId === shotId &&
    asset.projectReferenceId === null &&
    asset.mediaKind === 'image' &&
    (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
    shot.assetIds.includes(assetId)
    ? asset
    : null;
};

const resolveStudioExplicitNewSpendSeedAssetV2 = (
  project: StudioProjectV2,
  beatId: string,
  shotId: string,
  assetId: string
): StudioAssetV2 | null => {
  const ordinary = resolveStudioOrdinarySeedAssetV2(project, shotId, assetId);
  if (ordinary !== null) return ordinary;
  return resolveStudioFreshBoardAssetV2(project, beatId, shotId, assetId)?.asset ?? null;
};

/**
 * Resolves the effective seed accepted by a newly prepared video request at this revision.
 * Historical/frozen video execution has separate, grandfathered recovery semantics.
 */
export const resolveStudioNewSpendSeedAssetV2 = (
  project: StudioProjectV2,
  beatId: string,
  shotId: string
): StudioAssetV2 | null => {
  const shot = ownValue(project.shots, shotId);
  if (shot === undefined) return null;
  if (shot.seedStillId !== null && !shot.dismissedSeedStillIds.includes(shot.seedStillId)) {
    return resolveStudioExplicitNewSpendSeedAssetV2(project, beatId, shot.id, shot.seedStillId);
  }
  const candidates = shot.assetIds.flatMap((assetId) => {
    if (shot.dismissedSeedStillIds.includes(assetId)) return [];
    const asset = resolveStudioOrdinarySeedAssetV2(project, shot.id, assetId);
    return asset === null ? [] : [asset];
  });
  candidates.sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id < right.id
        ? 1
        : left.id > right.id
          ? -1
          : 0
      : left.createdAt < right.createdAt
        ? 1
        : -1
  );
  return candidates[0] ?? null;
};

/**
 * Resolves the exact active current-and-fresh Board pointer accepted by promotion.
 * Historical/superseded Board outputs remain canonical, but cannot enter here.
 */
export const resolveStudioCurrentBoardPanelAuthorityV2 = (
  project: StudioProjectV2,
  shotId: string,
  boardAssetId: string
): StudioCurrentBoardPanelAuthorityV2 | null => {
  let location: { beat: StudioBeat; shot: StudioShot; shotIndex: number } | null = null;
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId) return null;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      if (beat.shotOrder[shotIndex] !== shotId) continue;
      const shot = ownValue(project.shots, shotId);
      if (shot?.id !== shotId || location !== null) return null;
      location = { beat, shot, shotIndex };
    }
  }
  if (location === null || location.shot.boardAssetId !== boardAssetId) return null;
  const fresh = resolveStudioFreshBoardAssetV2(project, location.beat.id, location.shot.id, boardAssetId);
  return fresh === null ? null : { ...fresh, shotIndex: location.shotIndex };
};
