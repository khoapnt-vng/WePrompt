/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
  type StudioProjectStatusBlockerV2,
  type StudioProjectStatusStageIdV2,
  type StudioProjectStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import type { WorkspaceBeatProjection, WorkspaceProjection, WorkspaceShotProjection } from '../../workspaceProjection';
import { deriveWorkspaceShotStatus, type WorkspaceShotStatus } from '../shotStatus';

export const BOARD_SHOT_TILE_MAX_BLOCKERS = 12;

export type BoardShotTileChain = { kind: 'head' } | { kind: 'after'; beatPosition: number; shotPosition: number };

export type BoardShotTileMedia =
  | { kind: 'poster' | 'cover'; assetId: string }
  | { kind: 'video'; assetId: string }
  | null;

export type BoardShotTileBlocker = {
  stage: StudioProjectStatusStageIdV2;
  value: StudioProjectStatusBlockerV2;
  reviewReferenceBinding: boolean;
};

export type BoardShotTile = {
  beatId: string;
  shotId: string;
  beatPosition: number;
  shotPosition: number;
  shootingScript: string;
  durationSeconds: number;
  status: WorkspaceShotStatus;
  chain: BoardShotTileChain;
  media: BoardShotTileMedia;
  blockersAvailable: boolean;
  blockers: BoardShotTileBlocker[];
};

export type BoardShotTileBeat = {
  beat: Pick<WorkspaceBeatProjection, 'id' | 'title' | 'story' | 'targetSeconds' | 'actualSeconds'>;
  beatPosition: number;
  shotCount: number;
  renderedCount: number;
  staleCount: number;
  inFlightCount: number;
  shots: BoardShotTile[];
};

export type BoardShotTiles = {
  beats: BoardShotTileBeat[];
  blockerStatusAvailable: boolean;
  globalBlockers: BoardShotTileBlocker[];
};

type ShotPosition = {
  beatId: string;
  shotId: string;
  beatPosition: number;
  shotPosition: number;
};

const exactProjectionPositions = (projection: WorkspaceProjection): ShotPosition[] | null => {
  if (
    projection.activeBeatIds.length !== projection.activeBeats.length ||
    new Set(projection.activeBeatIds).size !== projection.activeBeatIds.length
  ) {
    return null;
  }
  const positions: ShotPosition[] = [];
  const shotIds = new Set<string>();
  for (let beatIndex = 0; beatIndex < projection.activeBeats.length; beatIndex += 1) {
    const beat = projection.activeBeats[beatIndex];
    if (beat === undefined || projection.activeBeatIds[beatIndex] !== beat.id) return null;
    for (let shotIndex = 0; shotIndex < beat.shots.length; shotIndex += 1) {
      const shot = beat.shots[shotIndex];
      if (shot === undefined || shotIds.has(shot.id)) return null;
      shotIds.add(shot.id);
      positions.push({
        beatId: beat.id,
        shotId: shot.id,
        beatPosition: beatIndex + 1,
        shotPosition: shotIndex + 1,
      });
    }
  }
  if (
    positions.length !== projection.activeShotIds.length ||
    new Set(projection.activeShotIds).size !== projection.activeShotIds.length ||
    positions.some((position, index) => projection.activeShotIds[index] !== position.shotId)
  ) {
    return null;
  }
  return positions;
};

const exactStatus = (
  projection: WorkspaceProjection,
  status: StudioProjectStatusV2 | null,
  positions: readonly ShotPosition[]
): StudioProjectStatusV2 | null => {
  if (
    status === null ||
    status.projectId !== projection.projectId ||
    status.projectRevision !== projection.projectRevision ||
    status.detail === null ||
    status.stages.length !== STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.length ||
    status.stages.some((stage, index) => stage.id !== STUDIO_PROJECT_STATUS_STAGE_ORDER_V2[index]) ||
    status.detail.shots.length !== positions.length
  ) {
    return null;
  }
  const expectedByShotId = new Map(positions.map((position) => [position.shotId, position]));
  const seen = new Set<string>();
  for (const detail of status.detail.shots) {
    const expected = expectedByShotId.get(detail.shotId);
    if (
      expected === undefined ||
      seen.has(detail.shotId) ||
      detail.beatId !== expected.beatId ||
      detail.beatPosition !== expected.beatPosition ||
      detail.shotPosition !== expected.shotPosition
    ) {
      return null;
    }
    seen.add(detail.shotId);
  }
  if (seen.size !== positions.length) return null;
  for (const stage of status.stages) {
    for (const blocker of stage.blockers) {
      if (blocker.where.kind !== 'shot') continue;
      const expected = expectedByShotId.get(blocker.where.shotId);
      if (
        expected === undefined ||
        blocker.where.beatId !== expected.beatId ||
        blocker.where.beatPosition !== expected.beatPosition ||
        blocker.where.shotPosition !== expected.shotPosition
      ) {
        return null;
      }
    }
  }
  return status;
};

const shotMedia = (shot: WorkspaceShotProjection): BoardShotTileMedia => {
  if (shot.currentPicture?.posterAssetId !== null && shot.currentPicture?.posterAssetId !== undefined) {
    return { kind: 'poster', assetId: shot.currentPicture.posterAssetId };
  }
  if (shot.currentPicture !== null) return { kind: 'video', assetId: shot.currentPicture.assetId };
  return shot.coverAssetId === null ? null : { kind: 'cover', assetId: shot.coverAssetId };
};

const blockerKey = (stage: StudioProjectStatusStageIdV2, blocker: StudioProjectStatusBlockerV2): string =>
  `${stage}:${blocker.cause}:${JSON.stringify(blocker.where)}:${JSON.stringify(blocker.remedy)}`;

const tileBlockers = (status: StudioProjectStatusV2, position: ShotPosition): BoardShotTileBlocker[] => {
  const seen = new Set<string>();
  const result: BoardShotTileBlocker[] = [];
  for (const stage of status.stages) {
    for (const blocker of stage.blockers) {
      const applicable = blocker.where.kind === 'shot' && blocker.where.shotId === position.shotId;
      if (!applicable) continue;
      const key = blockerKey(stage.id, blocker);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        stage: stage.id,
        value: blocker,
        reviewReferenceBinding:
          blocker.where.kind === 'shot' &&
          blocker.where.shotId === position.shotId &&
          blocker.cause.startsWith('reference_binding_'),
      });
      if (result.length === BOARD_SHOT_TILE_MAX_BLOCKERS) return result;
    }
  }
  return result;
};

const globalBlockers = (status: StudioProjectStatusV2): BoardShotTileBlocker[] => {
  const seen = new Set<string>();
  const result: BoardShotTileBlocker[] = [];
  for (const stage of status.stages) {
    for (const blocker of stage.blockers) {
      if (blocker.where.kind !== 'project' && blocker.where.kind !== 'route') continue;
      const key = blockerKey(stage.id, blocker);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ stage: stage.id, value: blocker, reviewReferenceBinding: false });
      if (result.length === BOARD_SHOT_TILE_MAX_BLOCKERS) return result;
    }
  }
  return result;
};

/** Joins renderer-live Shot facts to exact, revision-correlated Main blocker authority. */
export const deriveBoardShotTiles = (
  projection: WorkspaceProjection,
  projectStatus: StudioProjectStatusV2 | null
): BoardShotTiles | null => {
  const positions = exactProjectionPositions(projection);
  if (positions === null) return null;
  const status = exactStatus(projection, projectStatus, positions);
  const positionByShotId = new Map(positions.map((position) => [position.shotId, position]));
  const conditioningFailureIds = new Set(projection.conditioningFailures.map((failure) => failure.dependentShotId));
  const beats: BoardShotTileBeat[] = [];
  for (let beatIndex = 0; beatIndex < projection.activeBeats.length; beatIndex += 1) {
    const beat = projection.activeBeats[beatIndex]!;
    const shots: BoardShotTile[] = [];
    let renderedCount = 0;
    let staleCount = 0;
    let inFlightCount = 0;
    for (let shotIndex = 0; shotIndex < beat.shots.length; shotIndex += 1) {
      const shot = beat.shots[shotIndex]!;
      const position = positionByShotId.get(shot.id)!;
      const statusWord = deriveWorkspaceShotStatus(shot, conditioningFailureIds.has(shot.id));
      if (shot.currentPicture !== null) renderedCount += 1;
      if (statusWord.stale) staleCount += 1;
      if (shot.videoGenerationInFlight || shot.seedGenerationInFlight) inFlightCount += 1;
      if (!shot.segmentHead && shotIndex === 0) return null;
      shots.push({
        ...position,
        shootingScript: shot.shootingScript,
        durationSeconds: shot.durationSeconds,
        status: statusWord,
        chain: shot.segmentHead
          ? { kind: 'head' }
          : { kind: 'after', beatPosition: beatIndex + 1, shotPosition: shotIndex },
        media: shotMedia(shot),
        blockersAvailable: status !== null,
        blockers: status === null ? [] : tileBlockers(status, position),
      });
    }
    beats.push({
      beat: {
        id: beat.id,
        title: beat.title,
        story: beat.story,
        targetSeconds: beat.targetSeconds,
        actualSeconds: beat.actualSeconds,
      },
      beatPosition: beatIndex + 1,
      shotCount: shots.length,
      renderedCount,
      staleCount,
      inFlightCount,
      shots,
    });
  }
  return {
    beats,
    blockerStatusAvailable: status !== null,
    globalBlockers: status === null ? [] : globalBlockers(status),
  };
};
