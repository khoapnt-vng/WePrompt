/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';
import {
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V4,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V4,
  STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3,
  STUDIO_MAX_PIECES_V3,
  type StudioPieceConditioningInputSnapshotV4,
  type StudioPieceCurrentAssetSnapshotV4,
  type StudioPieceFirstFrameSnapshotV4,
  type StudioPieceGenerationAttemptV4,
  type StudioPieceJobRetryReasonV3,
  type StudioPiecePhotoSettingsV4,
  type StudioPieceSettingsV4,
  type StudioPieceMotionSettingsV4,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { deriveStudioPieceCreateIdentityV4, studioCanvasHandleNamespaceV4 } from '../../mutations/pieceHandles';
import { studioPersistentIdentitiesV4 } from '../../mutations/projectAuthorityV4';
import { validateStudioProjectV4 } from '../../validation';
import { normalizeStudioPieceWordsV3 } from '../composition';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/u;

/**
 * Fingerprint protocol 3 belongs to the authoring domain, independently of project schema 7.
 * Neither the schema-6 fingerprint implementation nor its domain accepts this payload.
 */
export const STUDIO_AUTHORING_FINGERPRINT_DOMAIN_V4 = 'weprompt:studio-authoring:v3' as const;
export { STUDIO_AUTHORING_FINGERPRINT_VERSION_V4 } from '@/common/types/project/creativeStudioTypes';
export { createStudioPieceQuotedGenerationIdV4 } from '../../validation';

type StudioPreparedCreateAuthorityV4 = {
  mode: 'create';
  reservedPieceId: string;
  proposedHandle: string;
  runStem: string | null;
  /** Frozen handles owned by other live creates; the current proposed handle is excluded. */
  otherActiveHandleReservations: string[];
  orderIndex: number;
};

type StudioPreparedReplaceAuthorityV4 = {
  mode: 'replace';
  existingPieceId: string;
  currentAsset: StudioPieceCurrentAssetSnapshotV4;
};

type StudioPreparedRetryAuthorityV4 = {
  mode: 'retry';
  existingPieceId: string;
  sourceJobId: string;
};

type StudioPreparedPhotoContentV4 = {
  words: string;
  settings: StudioPiecePhotoSettingsV4;
  conditioningInputs: StudioPieceConditioningInputSnapshotV4[];
};

type StudioPreparedMotionContentV4 = {
  words: string;
  settings: StudioPieceMotionSettingsV4;
  firstFrame: StudioPieceFirstFrameSnapshotV4 | null;
};

export type StudioPiecePreparedAuthoringArmV4 =
  | ((StudioPreparedCreateAuthorityV4 | StudioPreparedReplaceAuthorityV4 | StudioPreparedRetryAuthorityV4) &
      StudioPreparedPhotoContentV4)
  | ((StudioPreparedCreateAuthorityV4 | StudioPreparedReplaceAuthorityV4 | StudioPreparedRetryAuthorityV4) &
      StudioPreparedMotionContentV4);

export type StudioAuthoringFingerprintInputV4 = {
  project: StudioProjectV4;
  prepared: StudioPiecePreparedAuthoringArmV4;
};

const INPUT_KEYS = ['project', 'prepared'] as const;
const CREATE_ARM_BASE_KEYS = [
  'mode',
  'reservedPieceId',
  'proposedHandle',
  'runStem',
  'otherActiveHandleReservations',
  'orderIndex',
  'words',
  'settings',
] as const;
const REPLACE_ARM_BASE_KEYS = ['mode', 'existingPieceId', 'currentAsset', 'words', 'settings'] as const;
const RETRY_ARM_BASE_KEYS = ['mode', 'existingPieceId', 'sourceJobId', 'words', 'settings'] as const;
const PHOTO_CHANNEL_KEY = 'conditioningInputs';
const MOTION_CHANNEL_KEY = 'firstFrame';
const PHOTO_CURRENT_ASSET_KEYS = [
  'pieceId',
  'assetId',
  'mediaKind',
  'role',
  'mimeType',
  'byteSize',
  'sha256',
  'width',
  'height',
  'createdAt',
  'origin',
  'producerJobId',
  'compositionDigest',
] as const;
const MOTION_CURRENT_ASSET_KEYS = [...PHOTO_CURRENT_ASSET_KEYS, 'durationSeconds'] as const;

const exactDataRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    return (
      ownKeys.length === keys.length &&
      ownKeys.every((key) => typeof key === 'string' && keys.includes(key)) &&
      keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
      })
    );
  } catch {
    return false;
  }
};

const matchesExactDataRecord = (value: unknown, keys: readonly string[]): boolean => exactDataRecord(value, keys);

const ownValue = <T>(record: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const isBinnedPiece = (project: StudioProjectV4, pieceId: string): boolean =>
  project.bin.some((entry) => entry.subject.kind === 'piece' && entry.subject.pieceId === pieceId);

const isDensePlainArray = (value: unknown, maximum: number): value is unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      nodeTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum
    ) {
      return false;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.some(
        (key) =>
          key !== 'length' &&
          (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)
      )
    ) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const assertSafeId: (value: unknown, field: string) => asserts value is string = (value, field) => {
  if (typeof value !== 'string' || !SAFE_STUDIO_ID.test(value)) {
    throw new TypeError(`${field} must be a safe Studio ID`);
  }
};

const snapshotPieceSettings = (settings: unknown): StudioPieceSettingsV4 => {
  if (
    !exactDataRecord(
      settings,
      settings !== null && typeof settings === 'object' && (settings as Record<string, unknown>).kind === 'motion'
        ? ['kind', 'aspectRatio', 'resolution', 'requestedDurationSeconds']
        : ['kind', 'aspectRatio', 'resolution']
    )
  ) {
    throw new TypeError('settings are invalid');
  }
  const common =
    (settings.aspectRatio === '16:9' ||
      settings.aspectRatio === '9:16' ||
      settings.aspectRatio === '1:1' ||
      settings.aspectRatio === '4:3' ||
      settings.aspectRatio === '3:4') &&
    (settings.resolution === '720p' || settings.resolution === '1080p');
  if (!common) {
    throw new TypeError('settings are invalid');
  }
  if (settings.kind === 'photograph') return { ...settings } as StudioPiecePhotoSettingsV4;
  if (
    settings.kind !== 'motion' ||
    typeof settings.requestedDurationSeconds !== 'number' ||
    !Number.isSafeInteger(settings.requestedDurationSeconds) ||
    settings.requestedDurationSeconds < 4 ||
    settings.requestedDurationSeconds > 15
  ) {
    throw new TypeError('settings are invalid');
  }
  return { ...settings } as StudioPieceMotionSettingsV4;
};

const snapshotConditioningInputs = (value: unknown): StudioPieceConditioningInputSnapshotV4[] => {
  if (!isDensePlainArray(value, STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3)) {
    throw new TypeError('conditioning inputs exceed the Piece bound');
  }
  const pieceIds = new Set<string>();
  const assetIds = new Set<string>();
  return value.map((input) => {
    if (
      !exactDataRecord(input, ['pieceId', 'assetId', 'sha256', 'mimeType', 'byteSize']) ||
      typeof input.pieceId !== 'string' ||
      !SAFE_STUDIO_ID.test(input.pieceId) ||
      typeof input.assetId !== 'string' ||
      !SAFE_STUDIO_ID.test(input.assetId) ||
      typeof input.sha256 !== 'string' ||
      !LOWERCASE_SHA256.test(input.sha256) ||
      (input.mimeType !== 'image/jpeg' && input.mimeType !== 'image/png' && input.mimeType !== 'image/webp') ||
      typeof input.byteSize !== 'number' ||
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > STUDIO_MAX_IMAGE_ASSET_BYTES_V4 ||
      pieceIds.has(input.pieceId) ||
      assetIds.has(input.assetId)
    ) {
      throw new TypeError('conditioning inputs are invalid');
    }
    pieceIds.add(input.pieceId);
    assetIds.add(input.assetId);
    return {
      pieceId: input.pieceId,
      assetId: input.assetId,
      sha256: input.sha256,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
    };
  });
};

const snapshotFirstFrame = (value: unknown): StudioPieceFirstFrameSnapshotV4 | null => {
  if (value === null) return null;
  if (!exactDataRecord(value, ['kind', 'pieceId', 'assetId', 'sha256', 'mimeType', 'byteSize'])) {
    if (
      !exactDataRecord(value, [
        'kind',
        'assemblyId',
        'boardId',
        'dependentShotId',
        'predecessorShotId',
        'sourcePieceId',
        'sourceVideoAssetId',
        'sourceVideoSha256',
        'endpointSeconds',
        'frameExtractionId',
        'frameAssetId',
        'frameSha256',
        'frameMimeType',
        'frameByteSize',
      ]) ||
      value.kind !== 'predecessor_frame'
    ) {
      throw new TypeError('first frame is invalid');
    }
    for (const field of [
      'assemblyId',
      'boardId',
      'dependentShotId',
      'predecessorShotId',
      'sourcePieceId',
      'sourceVideoAssetId',
      'frameExtractionId',
      'frameAssetId',
    ] as const)
      assertSafeId(value[field], field);
    if (
      value.dependentShotId === value.predecessorShotId ||
      typeof value.sourceVideoSha256 !== 'string' ||
      !LOWERCASE_SHA256.test(value.sourceVideoSha256) ||
      typeof value.frameSha256 !== 'string' ||
      !LOWERCASE_SHA256.test(value.frameSha256) ||
      typeof value.endpointSeconds !== 'number' ||
      !Number.isFinite(value.endpointSeconds) ||
      value.endpointSeconds <= 0 ||
      (value.frameMimeType !== 'image/jpeg' &&
        value.frameMimeType !== 'image/png' &&
        value.frameMimeType !== 'image/webp') ||
      typeof value.frameByteSize !== 'number' ||
      !Number.isSafeInteger(value.frameByteSize) ||
      value.frameByteSize < 1 ||
      value.frameByteSize > STUDIO_MAX_IMAGE_ASSET_BYTES_V4
    )
      throw new TypeError('first frame is invalid');
    return structuredClone(value) as StudioPieceFirstFrameSnapshotV4;
  }
  if (value.kind !== 'piece_image') throw new TypeError('first frame is invalid');
  const [{ pieceId, assetId, sha256, mimeType, byteSize }] = snapshotConditioningInputs([
    {
      pieceId: value.pieceId,
      assetId: value.assetId,
      sha256: value.sha256,
      mimeType: value.mimeType,
      byteSize: value.byteSize,
    },
  ]);
  return { kind: 'piece_image', pieceId, assetId, sha256, mimeType, byteSize };
};

const snapshotCurrentAsset = (
  project: StudioProjectV4,
  pieceId: string,
  value: unknown
): StudioPieceCurrentAssetSnapshotV4 => {
  const piece = ownValue(project.pieces, pieceId);
  const asset =
    piece?.currentAssetId === null || piece === undefined ? undefined : ownValue(project.assets, piece.currentAssetId);
  if (
    asset === undefined ||
    asset.role !== 'primary' ||
    !exactDataRecord(value, asset.mediaKind === 'video' ? MOTION_CURRENT_ASSET_KEYS : PHOTO_CURRENT_ASSET_KEYS)
  ) {
    throw new TypeError('replacement requires an exact current Piece asset');
  }
  const base = {
    pieceId,
    assetId: asset.id,
    mediaKind: asset.mediaKind,
    role: 'primary' as const,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt,
    ...(asset.mediaKind === 'video' ? { durationSeconds: asset.durationSeconds } : {}),
  };
  const expected = (
    asset.origin === 'imported'
      ? { ...base, origin: 'imported', producerJobId: null, compositionDigest: null }
      : {
          ...base,
          origin: 'generated',
          producerJobId: asset.producerJobId,
          compositionDigest: asset.compositionDigest,
        }
  ) as StudioPieceCurrentAssetSnapshotV4;
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new TypeError('replacement current asset no longer matches project authority');
  }
  return expected;
};

const snapshotOtherActiveHandleReservations = (value: unknown): string[] => {
  if (!isDensePlainArray(value, STUDIO_MAX_PIECES_V3 - 1)) {
    throw new TypeError('other active handle reservations exceed the Piece bound');
  }
  const reservations = new Set<string>();
  for (const reservation of value) {
    if (typeof reservation !== 'string' || reservations.has(reservation)) {
      throw new TypeError('other active handle reservations are invalid');
    }
    reservations.add(reservation);
  }
  return [...reservations].toSorted();
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const validateInputSnapshotsAgainstProject = (
  project: StudioProjectV4,
  inputs: readonly StudioPieceConditioningInputSnapshotV4[],
  excludedPieceId: string | null
): void => {
  for (const input of inputs) {
    const piece = ownValue(project.pieces, input.pieceId);
    const asset = ownValue(project.assets, input.assetId);
    if (
      piece === undefined ||
      isBinnedPiece(project, input.pieceId) ||
      piece.id === excludedPieceId ||
      piece.currentAssetId !== input.assetId ||
      asset === undefined ||
      asset.projectId !== project.id ||
      asset.pieceId !== piece.id ||
      asset.mediaKind !== 'image' ||
      asset.role !== 'primary' ||
      asset.sha256 !== input.sha256 ||
      asset.mimeType !== input.mimeType ||
      asset.byteSize !== input.byteSize
    ) {
      throw new TypeError('conditioning inputs must match current project assets');
    }
  }
};

const validatePredecessorFirstFrameAgainstProject = (
  project: StudioProjectV4,
  frame: Extract<StudioPieceFirstFrameSnapshotV4, { kind: 'predecessor_frame' }>,
  targetPieceId: string
): void => {
  const extraction = ownValue(project.frameExtractions, frame.frameExtractionId);
  const asset = ownValue(project.derivedFrames, frame.frameAssetId);
  if (
    extraction === undefined ||
    extraction.status !== 'ready' ||
    extraction.targetPieceId !== targetPieceId ||
    extraction.frameAssetId !== frame.frameAssetId ||
    asset === undefined ||
    asset.targetPieceId !== targetPieceId ||
    asset.extractionId !== extraction.id
  )
    throw new TypeError('predecessor first frame must match a ready project extraction');
  const expected = {
    kind: 'predecessor_frame',
    assemblyId: extraction.assemblyId,
    boardId: extraction.boardId,
    dependentShotId: extraction.dependentShotId,
    predecessorShotId: extraction.predecessorShotId,
    sourcePieceId: extraction.sourcePieceId,
    sourceVideoAssetId: extraction.sourceVideoAssetId,
    sourceVideoSha256: extraction.sourceVideoSha256,
    endpointSeconds: extraction.endpointSeconds,
    frameExtractionId: extraction.id,
    frameAssetId: asset.id,
    frameSha256: asset.sha256,
    frameMimeType: asset.mimeType,
    frameByteSize: asset.byteSize,
  };
  if (canonicalJson(frame) !== canonicalJson(expected)) {
    throw new TypeError('predecessor first frame facts no longer match project authority');
  }
};

const validateDeferredRetryTopologyAgainstProject = (
  project: StudioProjectV4,
  sourceJob: StudioProjectV4['jobs'][string],
  frame: Extract<StudioPieceFirstFrameSnapshotV4, { kind: 'predecessor_frame' }>,
  targetPieceId: string
): void => {
  if (sourceJob.purpose !== 'piece_motion' || sourceJob.requestPlan.kind !== 'after_upstream_completion') return;
  const dependency = sourceJob.requestPlan.dependency;
  const assembly = ownValue(project.assemblies, dependency.assemblyId);
  const board = ownValue(project.boards, dependency.boardId);
  const beat =
    board === undefined
      ? undefined
      : Object.values(board.beats).find((candidate) => candidate.shotOrder.includes(dependency.dependentShotId));
  const dependentIndex = beat?.shotOrder.indexOf(dependency.dependentShotId) ?? -1;
  const dependentBinding = assembly?.pictureBindings[dependency.dependentShotId];
  const predecessorBinding = assembly?.pictureBindings[dependency.predecessorShotId];
  const selectedAssetId = predecessorBinding?.source?.assetId ?? null;
  const selectedAsset = selectedAssetId === null ? undefined : ownValue(project.assets, selectedAssetId);
  const upstreamJobs = Object.values(project.jobs).filter(
    (candidate) => candidate.authorizationItemId === dependency.upstreamItemId
  );
  const upstreamJob = upstreamJobs.length === 1 ? upstreamJobs[0] : undefined;
  const selectedEndpoint =
    selectedAsset?.mediaKind === 'video'
      ? (predecessorBinding?.sourceOutSeconds ?? selectedAsset.durationSeconds)
      : null;
  if (
    assembly?.boardId !== board?.id ||
    dependentIndex <= 0 ||
    beat!.shotOrder[dependentIndex - 1] !== dependency.predecessorShotId ||
    dependentBinding?.source?.pieceId !== targetPieceId ||
    dependentBinding.join !== 'match_previous' ||
    predecessorBinding?.source?.pieceId !== dependency.sourcePieceId ||
    selectedAssetId !== frame.sourceVideoAssetId ||
    selectedEndpoint !== frame.endpointSeconds ||
    upstreamJob?.status !== 'succeeded' ||
    upstreamJob.outputAssetIdsByRole.primary !== selectedAssetId ||
    selectedAsset?.origin !== 'generated' ||
    selectedAsset.mediaKind !== 'video' ||
    selectedAsset.role !== 'primary' ||
    selectedAsset.pieceId !== dependency.sourcePieceId ||
    selectedAsset.producerJobId !== upstreamJob.id
  ) {
    throw new TypeError('deferred retry predecessor topology no longer matches project authority');
  }
};

const projectRulesProjection = (project: StudioProjectV4): Record<string, unknown>[] =>
  project.rules.map((rule) => ({
    id: rule.id,
    scope: rule.scope,
    text: rule.text,
    predicate: rule.predicate === null ? null : { kind: rule.predicate.kind, terms: [...rule.predicate.terms] },
  }));

const chainStalenessProjection = (
  staleness: StudioProjectV4['assemblies'][string]['pictureBindings'][string]['staleness']
): Record<string, unknown> | null =>
  staleness === null
    ? null
    : {
        cause: staleness.cause,
        upstreamShotId: staleness.upstreamShotId,
        sourceAuthoringRevision: staleness.sourceAuthoringRevision,
        kept: staleness.keptAt !== null,
      };

const wordsStalenessProjection = (
  staleness: StudioProjectV4['assemblies'][string]['soundBindings'][string]['staleness']
): Record<string, unknown> | null =>
  staleness === null
    ? null
    : {
        cause: staleness.cause,
        sourceAuthoringRevision: staleness.sourceAuthoringRevision,
        kept: staleness.keptAt !== null,
      };

const projectAuthoringProjection = (project: StudioProjectV4): Record<string, unknown> => {
  const pieces = project.pieceOrder.map((pieceId) => {
    const piece = project.pieces[pieceId]!;
    return {
      id: piece.id,
      kind: piece.kind,
      handle: piece.handle,
      runStem: piece.runStem,
      priorHandles: [...piece.priorHandles],
    };
  });
  const boards = project.boardOrder.map((boardId) => {
    const board = project.boards[boardId]!;
    return {
      id: board.id,
      handle: board.handle,
      priorHandles: [...board.priorHandles],
      beats: board.beatOrder.map((beatId) => {
        const beat = board.beats[beatId]!;
        return {
          id: beat.id,
          title: beat.title,
          story: beat.story,
          targetSeconds: beat.targetSeconds,
          shots: beat.shotOrder.map((shotId) => {
            const shot = board.shots[shotId]!;
            return {
              id: shot.id,
              shootingScript: shot.shootingScript,
              durationSeconds: shot.durationSeconds,
            };
          }),
        };
      }),
    };
  });
  const assemblies = project.assemblyOrder.map((assemblyId) => {
    const assembly = project.assemblies[assemblyId]!;
    const board = project.boards[assembly.boardId]!;
    const shotIds = board.beatOrder.flatMap((beatId) => board.beats[beatId]!.shotOrder);
    return {
      id: assembly.id,
      handle: assembly.handle,
      priorHandles: [...assembly.priorHandles],
      boardId: assembly.boardId,
      pictureBindings: shotIds.map((shotId) => {
        const binding = assembly.pictureBindings[shotId]!;
        return {
          shotId: binding.shotId,
          source: binding.source === null ? null : { ...binding.source },
          sourceInSeconds: binding.sourceInSeconds,
          sourceOutSeconds: binding.sourceOutSeconds,
          join: binding.join,
          staleness: chainStalenessProjection(binding.staleness),
        };
      }),
      soundBindings: assembly.soundBindingOrder.map((bindingId) => {
        const binding = assembly.soundBindings[bindingId]!;
        return {
          id: binding.id,
          source: binding.source === null ? null : { ...binding.source },
          anchorBeatId: binding.anchorBeatId,
          levelDb: binding.levelDb,
          sourceInSeconds: binding.sourceInSeconds,
          sourceOutSeconds: binding.sourceOutSeconds,
          staleness: wordsStalenessProjection(binding.staleness),
        };
      }),
    };
  });
  return {
    id: project.id,
    authoringRevision: project.authoringRevision,
    name: project.name,
    brief: project.brief,
    rules: projectRulesProjection(project),
    directorBinding: {
      forgeProjectId: project.forgeProjectId,
      briefConversationId: project.briefConversationId,
    },
    spendPolicy: project.spendPolicy,
    pieces,
    boards,
    assemblies,
  };
};

/** Compares only schema-7 authored meaning; runtime progress and Bin presentation are deliberately excluded. */
export const studioProjectAuthoringEqualsV4 = (leftValue: unknown, rightValue: unknown): boolean => {
  if (!validateStudioProjectV4(leftValue) || !validateStudioProjectV4(rightValue)) return false;
  return canonicalJson(projectAuthoringProjection(leftValue)) === canonicalJson(projectAuthoringProjection(rightValue));
};

const validRetryReason = (value: StudioPieceJobRetryReasonV3): boolean =>
  value === 'provider_failure' || value === 'submission_unknown' || value === 'variation_grid' || value === 'cancelled';

/** Hashes exact schema-7 authored meaning plus the exact create, replace, or retry authority. */
export const createStudioAuthoringFingerprintV4 = (input: StudioAuthoringFingerprintInputV4): string => {
  if (!exactDataRecord(input, INPUT_KEYS)) throw new TypeError('authoring fingerprint input must be exact');
  const { project, prepared } = input;
  if (!validateStudioProjectV4(project)) throw new TypeError('authoring project must be an exact schema-7 project');

  const candidateKeySets = [
    [...CREATE_ARM_BASE_KEYS, PHOTO_CHANNEL_KEY],
    [...CREATE_ARM_BASE_KEYS, MOTION_CHANNEL_KEY],
    [...REPLACE_ARM_BASE_KEYS, PHOTO_CHANNEL_KEY],
    [...REPLACE_ARM_BASE_KEYS, MOTION_CHANNEL_KEY],
    [...RETRY_ARM_BASE_KEYS, PHOTO_CHANNEL_KEY],
    [...RETRY_ARM_BASE_KEYS, MOTION_CHANNEL_KEY],
  ];
  if (!candidateKeySets.some((keys) => matchesExactDataRecord(prepared, keys))) {
    throw new TypeError('prepared authoring arm must be exact');
  }
  const settings = snapshotPieceSettings(prepared.settings);
  if (
    (prepared.mode !== 'create' && prepared.mode !== 'replace' && prepared.mode !== 'retry') ||
    (settings.kind === 'photograph' && !Object.hasOwn(prepared, PHOTO_CHANNEL_KEY)) ||
    (settings.kind === 'motion' && !Object.hasOwn(prepared, MOTION_CHANNEL_KEY))
  ) {
    throw new TypeError('prepared authoring arm must be exact');
  }
  const words = normalizeStudioPieceWordsV3(prepared.words);
  if (words !== prepared.words) throw new TypeError('prepared words must already be normalized');
  const frozenInputs =
    settings.kind === 'photograph'
      ? snapshotConditioningInputs((prepared as StudioPreparedPhotoContentV4).conditioningInputs)
      : [];
  const firstFrame =
    settings.kind === 'motion' ? snapshotFirstFrame((prepared as StudioPreparedMotionContentV4).firstFrame) : null;
  const frozenChannel = settings.kind === 'photograph' ? { conditioningInputs: frozenInputs } : { firstFrame };

  let preparedPayload: Record<string, unknown>;
  if (prepared.mode === 'create') {
    assertSafeId(prepared.reservedPieceId, 'reservedPieceId');
    if (prepared.runStem !== null && typeof prepared.runStem !== 'string') {
      throw new TypeError('create runStem must be a string or null');
    }
    const otherActiveHandleReservations = snapshotOtherActiveHandleReservations(prepared.otherActiveHandleReservations);
    if (
      project.pieceOrder.length + otherActiveHandleReservations.length + 1 > STUDIO_MAX_PIECES_V3 ||
      otherActiveHandleReservations.includes(prepared.proposedHandle)
    ) {
      throw new TypeError('create handle reservation snapshot is invalid');
    }
    const expectedIdentity = deriveStudioPieceCreateIdentityV4(
      prepared.runStem,
      words,
      studioCanvasHandleNamespaceV4(project, otherActiveHandleReservations)
    );
    if (
      studioPersistentIdentitiesV4(project).has(prepared.reservedPieceId) ||
      expectedIdentity.proposedHandle !== prepared.proposedHandle ||
      expectedIdentity.runStem !== prepared.runStem ||
      !Number.isSafeInteger(prepared.orderIndex) ||
      prepared.orderIndex < 0 ||
      prepared.orderIndex > project.pieceOrder.length
    ) {
      throw new TypeError('create authoring arm is invalid');
    }
    preparedPayload = {
      mode: 'create',
      reservedPieceId: prepared.reservedPieceId,
      proposedHandle: prepared.proposedHandle,
      runStem: prepared.runStem,
      otherActiveHandleReservations,
      orderIndex: prepared.orderIndex,
      words,
      settings,
      ...frozenChannel,
    };
  } else if (prepared.mode === 'replace') {
    assertSafeId(prepared.existingPieceId, 'existingPieceId');
    const targetPiece = ownValue(project.pieces, prepared.existingPieceId);
    if (
      targetPiece === undefined ||
      targetPiece.kind !== settings.kind ||
      isBinnedPiece(project, prepared.existingPieceId)
    ) {
      throw new TypeError('replacement settings must match the Piece kind');
    }
    const currentAsset = snapshotCurrentAsset(project, prepared.existingPieceId, prepared.currentAsset);
    preparedPayload = {
      mode: 'replace',
      existingPieceId: prepared.existingPieceId,
      currentAsset,
      words,
      settings,
      ...frozenChannel,
    };
  } else {
    assertSafeId(prepared.existingPieceId, 'existingPieceId');
    assertSafeId(prepared.sourceJobId, 'sourceJobId');
    const targetPiece = ownValue(project.pieces, prepared.existingPieceId);
    if (
      targetPiece === undefined ||
      targetPiece.jobIds.length === 0 ||
      isBinnedPiece(project, prepared.existingPieceId)
    ) {
      throw new TypeError('retry requires persisted Piece jobs');
    }
    const jobIds = new Set<string>();
    const parentIds = new Set<string>();
    const lineage = targetPiece.jobIds.map((jobId) => {
      const job = ownValue(project.jobs, jobId);
      if (
        job === undefined ||
        job.id !== jobId ||
        job.projectId !== project.id ||
        job.target.kind !== 'piece' ||
        job.target.pieceId !== prepared.existingPieceId
      ) {
        throw new TypeError('Piece job order must resolve persisted jobs for the retry target');
      }
      const attempt: StudioPieceGenerationAttemptV4 = job.attempt;
      if (jobIds.has(jobId)) {
        throw new TypeError('retry lineage topology is invalid');
      }
      if (attempt.kind === 'retry') {
        if (
          !validRetryReason(attempt.reason) ||
          !jobIds.has(attempt.sourceJobId) ||
          parentIds.has(attempt.sourceJobId)
        ) {
          throw new TypeError('retry lineage topology is invalid');
        }
        parentIds.add(attempt.sourceJobId);
      }
      jobIds.add(jobId);
      return { jobId, attempt: structuredClone(attempt), publication: structuredClone(job.publication) };
    });
    if (lineage.at(-1)?.jobId !== prepared.sourceJobId) {
      throw new TypeError('sourceJobId must be the latest persisted Piece job');
    }
    const sourceJob = ownValue(project.jobs, prepared.sourceJobId)!;
    const sourceMotionFirstFrame =
      sourceJob.purpose === 'piece_motion'
        ? (sourceJob.requestSnapshot?.firstFrame ?? sourceJob.composition.inputs.firstFrame)
        : null;
    if (
      sourceJob.composition.inputs.source.pieceId !== prepared.existingPieceId ||
      sourceJob.composition.inputs.purpose !== (settings.kind === 'photograph' ? 'piece_image' : 'piece_motion') ||
      sourceJob.composition.inputs.source.words !== words ||
      canonicalJson(sourceJob.composition.inputs.source.settings) !== canonicalJson(settings) ||
      (settings.kind === 'photograph'
        ? sourceJob.purpose !== 'piece_image' ||
          canonicalJson(sourceJob.composition.inputs.conditioningInputs) !== canonicalJson(frozenInputs)
        : sourceJob.purpose !== 'piece_motion' || canonicalJson(sourceMotionFirstFrame) !== canonicalJson(firstFrame))
    ) {
      throw new TypeError('retry words and settings must exactly match the latest persisted Piece job');
    }
    if (firstFrame?.kind === 'predecessor_frame') {
      validateDeferredRetryTopologyAgainstProject(project, sourceJob, firstFrame, prepared.existingPieceId);
    }
    preparedPayload = {
      mode: 'retry',
      existingPieceId: prepared.existingPieceId,
      sourceJobId: prepared.sourceJobId,
      lineage,
      words,
      settings,
      ...frozenChannel,
    };
  }

  if (settings.kind === 'photograph') {
    validateInputSnapshotsAgainstProject(
      project,
      frozenInputs,
      prepared.mode === 'create' ? null : prepared.existingPieceId
    );
  } else if (firstFrame?.kind === 'piece_image') {
    const { kind: _kind, ...snapshotInput } = firstFrame;
    validateInputSnapshotsAgainstProject(
      project,
      [snapshotInput],
      prepared.mode === 'create' ? null : prepared.existingPieceId
    );
  } else if (firstFrame?.kind === 'predecessor_frame') {
    validatePredecessorFirstFrameAgainstProject(
      project,
      firstFrame,
      prepared.mode === 'create' ? prepared.reservedPieceId : prepared.existingPieceId
    );
  }

  const payload = {
    version: STUDIO_AUTHORING_FINGERPRINT_VERSION_V4,
    project: projectAuthoringProjection(project),
    prepared: preparedPayload,
  };
  return createHash('sha256')
    .update(`${STUDIO_AUTHORING_FINGERPRINT_DOMAIN_V4}\0${canonicalJson(payload)}`, 'utf8')
    .digest('hex');
};
