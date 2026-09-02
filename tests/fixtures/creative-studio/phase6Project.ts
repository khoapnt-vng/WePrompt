/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAssetV3, StudioProjectV4 } from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/factories';

export const PHASE_6_CREATED_AT = '2026-09-02T00:00:00.000Z';
export const PHASE_6_AUTHORED_AT = '2026-09-02T00:00:01.000Z';
export const PHASE_6_CURRENT_AT = '2026-09-02T00:00:02.000Z';

export const makePhase6Project = (): StudioProjectV4 => {
  const project = createEmptyStudioProjectV4(
    { name: 'Phase Six', brief: 'Two shots beside the harbour' },
    'project_7',
    PHASE_6_CREATED_AT
  );
  const asset: StudioAssetV3 = {
    id: 'asset_photo_1',
    projectId: project.id,
    pieceId: 'piece_photo_1',
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'imports', fileName: 'asset_photo_1.png' },
    byteSize: 8,
    sha256: 'a'.repeat(64),
    width: 1_376,
    height: 768,
    createdAt: PHASE_6_CURRENT_AT,
    origin: 'imported',
    producerJobId: null,
    compositionDigest: null,
  };
  project.revision = 2;
  project.authoringRevision = 2;
  project.pieceOrder = ['piece_photo_1'];
  project.pieces.piece_photo_1 = {
    id: 'piece_photo_1',
    kind: 'photograph',
    handle: 'harbour_morning',
    priorHandles: [],
    currentAssetId: asset.id,
    jobIds: [],
    createdAt: PHASE_6_AUTHORED_AT,
    updatedAt: PHASE_6_CURRENT_AT,
  };
  project.assets[asset.id] = asset;
  project.boardOrder = ['board_1'];
  project.boards.board_1 = {
    id: 'board_1',
    handle: 'storyboard',
    priorHandles: [],
    beatOrder: ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Cold open',
        story: 'The harbour wakes before dawn.',
        targetSeconds: 10,
        shotOrder: ['shot_1', 'shot_2'],
      },
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        shootingScript: 'Wide harbour before dawn.',
        durationSeconds: 5,
        createdAt: PHASE_6_AUTHORED_AT,
        updatedAt: PHASE_6_CURRENT_AT,
      },
      shot_2: {
        id: 'shot_2',
        shootingScript: 'Hands pull a rope into frame.',
        durationSeconds: 5,
        createdAt: PHASE_6_AUTHORED_AT,
        updatedAt: PHASE_6_CURRENT_AT,
      },
    },
    createdAt: PHASE_6_AUTHORED_AT,
    updatedAt: PHASE_6_CURRENT_AT,
  };
  project.assemblyOrder = ['assembly_1'];
  project.assemblies.assembly_1 = {
    id: 'assembly_1',
    handle: 'the_cut',
    priorHandles: [],
    boardId: 'board_1',
    pictureBindings: {
      shot_1: {
        shotId: 'shot_1',
        source: { pieceId: 'piece_photo_1', assetId: 'asset_photo_1' },
        trimInSeconds: 0,
        trimOutSeconds: null,
        join: 'hard_cut',
        staleness: null,
      },
      shot_2: {
        shotId: 'shot_2',
        source: null,
        trimInSeconds: 0,
        trimOutSeconds: null,
        join: 'match_previous',
        staleness: null,
      },
    },
    soundBindingOrder: [],
    soundBindings: {},
    createdAt: PHASE_6_AUTHORED_AT,
    updatedAt: PHASE_6_CURRENT_AT,
  };
  project.updatedAt = PHASE_6_CURRENT_AT;
  return project;
};
