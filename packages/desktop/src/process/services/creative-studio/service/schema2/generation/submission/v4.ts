/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';
import {
  STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
  STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3,
  STUDIO_MAX_PIECES_V3,
  type StudioPieceConditioningInputSnapshotV3,
  type StudioPieceJobRetryReasonV3,
  type StudioPiecePhotoSettingsV3,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { deriveStudioPieceCreateIdentityV4, studioCanvasHandleNamespaceV4 } from '../../mutations/pieceHandles';
import { studioPersistentIdentitiesV4 } from '../../mutations/projectAuthorityV4';
import { validateStudioProjectV4 } from '../../validation';
import { normalizeStudioPieceWordsV3, validateStudioPieceGenerationCompositionV3 } from '../composition';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/u;

/**
 * Fingerprint protocol 3 belongs to the authoring domain, independently of project schema 7.
 * Neither the schema-6 fingerprint implementation nor its domain accepts this payload.
 */
export const STUDIO_AUTHORING_FINGERPRINT_VERSION_V4 = 3 as const;
export const STUDIO_AUTHORING_FINGERPRINT_DOMAIN_V4 = 'weprompt:studio-authoring:v3' as const;

export type StudioPiecePreparedAuthoringArmV4 =
  | {
      mode: 'create';
      reservedPieceId: string;
      proposedHandle: string;
      runStem: string | null;
      /** Frozen handles owned by other live creates; the current proposed handle is excluded. */
      otherActiveHandleReservations: string[];
      orderIndex: number;
      words: string;
      settings: StudioPiecePhotoSettingsV3;
      conditioningInputs: StudioPieceConditioningInputSnapshotV3[];
    }
  | {
      mode: 'retry';
      existingPieceId: string;
      sourceJobId: string;
      words: string;
      settings: StudioPiecePhotoSettingsV3;
      conditioningInputs: StudioPieceConditioningInputSnapshotV3[];
    };

export type StudioAuthoringFingerprintInputV4 = {
  project: StudioProjectV4;
  prepared: StudioPiecePreparedAuthoringArmV4;
};

const INPUT_KEYS = ['project', 'prepared'] as const;
const CREATE_ARM_KEYS = [
  'mode',
  'reservedPieceId',
  'proposedHandle',
  'runStem',
  'otherActiveHandleReservations',
  'orderIndex',
  'words',
  'settings',
  'conditioningInputs',
] as const;
const RETRY_ARM_KEYS = ['mode', 'existingPieceId', 'sourceJobId', 'words', 'settings', 'conditioningInputs'] as const;

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

const validatePieceSettings: (settings: unknown) => asserts settings is StudioPiecePhotoSettingsV3 = (settings) => {
  if (
    !exactDataRecord(settings, ['aspectRatio', 'resolution']) ||
    (settings.aspectRatio !== '16:9' &&
      settings.aspectRatio !== '9:16' &&
      settings.aspectRatio !== '1:1' &&
      settings.aspectRatio !== '4:3' &&
      settings.aspectRatio !== '3:4') ||
    (settings.resolution !== '720p' && settings.resolution !== '1080p')
  ) {
    throw new TypeError('settings are invalid');
  }
};

const snapshotConditioningInputs = (value: unknown): StudioPieceConditioningInputSnapshotV3[] => {
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
      input.byteSize > STUDIO_MAX_IMAGE_ASSET_BYTES_V3 ||
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

const validateConditioningInputsAgainstProject = (
  project: StudioProjectV4,
  conditioningInputs: readonly StudioPieceConditioningInputSnapshotV3[],
  excludedPieceId: string | null
): void => {
  for (const input of conditioningInputs) {
    const piece = ownValue(project.pieces, input.pieceId);
    const asset = ownValue(project.assets, input.assetId);
    if (
      piece === undefined ||
      piece.id === excludedPieceId ||
      piece.currentAssetId !== input.assetId ||
      asset === undefined ||
      asset.projectId !== project.id ||
      asset.pieceId !== piece.id ||
      asset.mediaKind !== 'image' ||
      asset.sha256 !== input.sha256 ||
      asset.mimeType !== input.mimeType ||
      asset.byteSize !== input.byteSize
    ) {
      throw new TypeError('conditioning inputs must match current project assets');
    }
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

const validRetryReason = (value: StudioPieceJobRetryReasonV3 | null): boolean =>
  value === null ||
  value === 'provider_failure' ||
  value === 'submission_unknown' ||
  value === 'variation_grid' ||
  value === 'cancelled';

/** Hashes exact schema-7 authored meaning plus the exact create arm or persisted retry lineage. */
export const createStudioAuthoringFingerprintV4 = (input: StudioAuthoringFingerprintInputV4): string => {
  if (!exactDataRecord(input, INPUT_KEYS)) throw new TypeError('authoring fingerprint input must be exact');
  const { project, prepared } = input;
  if (!validateStudioProjectV4(project)) throw new TypeError('authoring project must be an exact schema-7 project');

  const exactCreateArm = matchesExactDataRecord(prepared, CREATE_ARM_KEYS);
  const exactRetryArm = matchesExactDataRecord(prepared, RETRY_ARM_KEYS);
  if (
    (!exactCreateArm && !exactRetryArm) ||
    (exactCreateArm && prepared.mode !== 'create') ||
    (exactRetryArm && prepared.mode !== 'retry')
  ) {
    throw new TypeError('prepared authoring arm must be exact');
  }
  validatePieceSettings(prepared.settings);
  const words = normalizeStudioPieceWordsV3(prepared.words);
  const conditioningInputs = snapshotConditioningInputs(prepared.conditioningInputs);
  if (words !== prepared.words) throw new TypeError('prepared words must already be normalized');

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
      settings: { ...prepared.settings },
      conditioningInputs,
    };
  } else {
    assertSafeId(prepared.existingPieceId, 'existingPieceId');
    assertSafeId(prepared.sourceJobId, 'sourceJobId');
    const targetPiece = ownValue(project.pieces, prepared.existingPieceId);
    if (targetPiece === undefined || targetPiece.jobIds.length === 0) {
      throw new TypeError('retry requires persisted Piece jobs');
    }
    const jobIds = new Set<string>();
    const parentIds = new Set<string>();
    const lineage = targetPiece.jobIds.map((jobId, index) => {
      const job = ownValue(project.jobs, jobId);
      if (
        job === undefined ||
        job.id !== jobId ||
        job.projectId !== project.id ||
        job.target.kind !== 'piece' ||
        job.target.pieceId !== prepared.existingPieceId ||
        job.purpose !== 'piece_image' ||
        !validRetryReason(job.retryReason)
      ) {
        throw new TypeError('Piece job order must resolve persisted jobs for the retry target');
      }
      if (
        jobIds.has(jobId) ||
        (index === 0) !== (job.retryOfJobId === null) ||
        (job.retryOfJobId === null) !== (job.retryReason === null) ||
        (job.retryOfJobId !== null && !jobIds.has(job.retryOfJobId)) ||
        (job.retryOfJobId !== null && parentIds.has(job.retryOfJobId))
      ) {
        throw new TypeError('retry lineage topology is invalid');
      }
      jobIds.add(jobId);
      if (job.retryOfJobId !== null) parentIds.add(job.retryOfJobId);
      return { jobId, retryOfJobId: job.retryOfJobId, retryReason: job.retryReason };
    });
    if (lineage.at(-1)?.jobId !== prepared.sourceJobId) {
      throw new TypeError('sourceJobId must be the latest persisted Piece job');
    }
    const sourceJob = ownValue(project.jobs, prepared.sourceJobId)!;
    if (
      !validateStudioPieceGenerationCompositionV3(sourceJob.composition) ||
      sourceJob.composition.inputs.source.pieceId !== prepared.existingPieceId ||
      sourceJob.composition.inputs.purpose !== 'piece_image' ||
      sourceJob.composition.inputs.source.words !== words ||
      sourceJob.composition.inputs.source.settings.aspectRatio !== prepared.settings.aspectRatio ||
      sourceJob.composition.inputs.source.settings.resolution !== prepared.settings.resolution ||
      canonicalJson(sourceJob.composition.inputs.conditioningInputs) !== canonicalJson(conditioningInputs)
    ) {
      throw new TypeError('retry words and settings must exactly match the latest persisted Piece job');
    }
    preparedPayload = {
      mode: 'retry',
      existingPieceId: prepared.existingPieceId,
      sourceJobId: prepared.sourceJobId,
      lineage,
      words,
      settings: { ...prepared.settings },
      conditioningInputs,
    };
  }

  validateConditioningInputsAgainstProject(
    project,
    conditioningInputs,
    prepared.mode === 'retry' ? prepared.existingPieceId : null
  );

  const payload = {
    version: STUDIO_AUTHORING_FINGERPRINT_VERSION_V4,
    project: projectAuthoringProjection(project),
    prepared: preparedPayload,
  };
  return createHash('sha256')
    .update(`${STUDIO_AUTHORING_FINGERPRINT_DOMAIN_V4}\0${canonicalJson(payload)}`, 'utf8')
    .digest('hex');
};
