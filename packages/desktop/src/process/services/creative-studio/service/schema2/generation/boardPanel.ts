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
  const canonical = resolveStudioCanonicalBoardAssetV2(project, location.shot, boardAssetId);
  if (canonical === null) return null;
  const freshness = studioBoardPanelFreshnessV2(project, location.beat, location.shot, canonical.producer);
  if (!freshness.requestCurrent || !freshness.routeCurrent) return null;
  return { ...canonical, ...location };
};
