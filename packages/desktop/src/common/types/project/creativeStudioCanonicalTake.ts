/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isCanonicalStudioBedAudioAssetV2 } from './creativeStudioManagedAssetCollections';
import type { StudioAssetV2, StudioProjectV2, StudioRendererProjectV2, StudioShot } from './creativeStudioTypes';

/** Returns whether an asset is the generated take owned and indexed by a schema-2 shot. */
export const isCanonicalStudioGeneratedTakeV2 = (asset: StudioAssetV2, projectId: string, shot: StudioShot): boolean =>
  asset.projectId === projectId &&
  asset.shotId === shot.id &&
  (asset.mediaKind === 'image' || asset.mediaKind === 'video') &&
  asset.managedAsset.collection === 'assets' &&
  shot.assetIds.includes(asset.id);

export type StudioEditorFolderBlockReasonV2 = 'no_beats' | 'duration_pending' | 'invalid_media' | 'bed_too_short';

export type StudioEditorFolderPreviewV2 =
  | { status: 'blocked'; reason: StudioEditorFolderBlockReasonV2 }
  | {
      status: 'ready';
      durationSeconds: number;
      slateCount: number;
      slateShotOrdinals: number[];
      emptyBeatSlateCount: number;
    };

type StudioEditorFolderProjectV2 = Pick<
  StudioProjectV2 | StudioRendererProjectV2,
  'id' | 'beatOrder' | 'beats' | 'shots' | 'assets' | 'bedAssetId'
>;

const ownValue = <Value>(record: Readonly<Record<string, Value>>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

/**
 * Shared renderer/main eligibility for the editor-folder timeline. Main still revalidates the
 * complete project and re-proves every selected inode before publication.
 */
export const deriveStudioEditorFolderPreviewV2 = (
  project: StudioEditorFolderProjectV2
): StudioEditorFolderPreviewV2 => {
  if (project.beatOrder.length === 0) return { status: 'blocked', reason: 'no_beats' };

  let durationSeconds = 0;
  let shotOrdinal = 0;
  let emptyBeatSlateCount = 0;
  const slateShotOrdinals: number[] = [];
  const seenBeatIds = new Set<string>();
  const seenShotIds = new Set<string>();

  for (const beatId of project.beatOrder) {
    if (seenBeatIds.has(beatId)) return { status: 'blocked', reason: 'invalid_media' };
    seenBeatIds.add(beatId);
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId) return { status: 'blocked', reason: 'invalid_media' };
    if (beat.shotOrder.length === 0) {
      if (beat.targetSeconds === null) return { status: 'blocked', reason: 'duration_pending' };
      if (!Number.isFinite(beat.targetSeconds) || beat.targetSeconds <= 0) {
        return { status: 'blocked', reason: 'invalid_media' };
      }
      durationSeconds += beat.targetSeconds;
      emptyBeatSlateCount += 1;
      continue;
    }

    for (const shotId of beat.shotOrder) {
      shotOrdinal += 1;
      if (seenShotIds.has(shotId)) return { status: 'blocked', reason: 'invalid_media' };
      seenShotIds.add(shotId);
      const shot = ownValue(project.shots, shotId);
      if (shot?.id !== shotId || !Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) {
        return { status: 'blocked', reason: 'invalid_media' };
      }
      if (shot.videoAssetId === null) {
        durationSeconds += shot.durationSeconds;
        slateShotOrdinals.push(shotOrdinal);
        continue;
      }
      const take = ownValue(project.assets, shot.videoAssetId);
      if (
        take === undefined ||
        take.mediaKind !== 'video' ||
        !isCanonicalStudioGeneratedTakeV2(take, project.id, shot) ||
        take.durationSeconds === undefined ||
        !Number.isFinite(take.durationSeconds) ||
        take.durationSeconds <= 0
      ) {
        return { status: 'blocked', reason: 'invalid_media' };
      }
      const sourceInSeconds = shot.trimInSeconds ?? 0;
      const sourceOutSeconds = take.durationSeconds - (shot.trimOutSeconds ?? 0);
      const trimmedDurationSeconds = sourceOutSeconds - sourceInSeconds;
      if (
        !Number.isFinite(sourceInSeconds) ||
        !Number.isFinite(sourceOutSeconds) ||
        !Number.isFinite(trimmedDurationSeconds) ||
        sourceInSeconds < 0 ||
        sourceOutSeconds <= sourceInSeconds ||
        trimmedDurationSeconds <= 0
      ) {
        return { status: 'blocked', reason: 'invalid_media' };
      }
      durationSeconds += trimmedDurationSeconds;
    }
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > Number.MAX_SAFE_INTEGER) {
    return { status: 'blocked', reason: 'invalid_media' };
  }
  if (project.bedAssetId !== null) {
    const bed = ownValue(project.assets, project.bedAssetId);
    if (bed === undefined || bed.projectId !== project.id || !isCanonicalStudioBedAudioAssetV2(bed)) {
      return { status: 'blocked', reason: 'invalid_media' };
    }
    if (bed.durationSeconds < durationSeconds) return { status: 'blocked', reason: 'bed_too_short' };
  }

  return {
    status: 'ready',
    durationSeconds,
    slateCount: emptyBeatSlateCount + slateShotOrdinals.length,
    slateShotOrdinals,
    emptyBeatSlateCount,
  };
};
