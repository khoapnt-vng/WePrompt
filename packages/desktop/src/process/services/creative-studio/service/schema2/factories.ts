/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION_V3,
  type CreateStudioProjectInputV2,
  type CreateStudioProjectInputV3,
  type StudioProjectV2,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV2, validateStudioProjectV3 } from './validation';

const INPUT_KEYS = new Set(['name', 'brief', 'forgeProjectId', 'aspectRatio', 'targetDurationSeconds', 'resolution']);
const REQUIRED_INPUT_KEYS = ['name', 'brief', 'aspectRatio', 'targetDurationSeconds', 'resolution'] as const;

const hasExactInputKeys = (input: CreateStudioProjectInputV2): boolean => {
  const value = input as unknown as Record<string, unknown>;
  return (
    typeof input === 'object' &&
    input !== null &&
    REQUIRED_INPUT_KEYS.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => INPUT_KEYS.has(key))
  );
};

const INPUT_KEYS_V3 = new Set(['name', 'brief', 'forgeProjectId']);
const REQUIRED_INPUT_KEYS_V3 = ['name', 'brief'] as const;

const snapshotExactInputV3 = (input: unknown): CreateStudioProjectInputV3 | null => {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    nodeTypes.isProxy(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    return null;
  }
  const snapshot: Record<string, unknown> = {};
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !INPUT_KEYS_V3.has(key)) ||
    !REQUIRED_INPUT_KEYS_V3.every((key) => ownKeys.includes(key))
  ) {
    return null;
  }
  for (const key of ownKeys) {
    if (typeof key !== 'string') return null;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot as CreateStudioProjectInputV3;
};

/** Creates a validated empty schema-2 project without seeding presentation copy. */
export const createEmptyStudioProjectV2 = (
  input: CreateStudioProjectInputV2,
  id: string,
  timestamp: string
): StudioProjectV2 => {
  if (!hasExactInputKeys(input)) throw new TypeError('Invalid schema-2 project input');
  const project: StudioProjectV2 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    revision: 1,
    id,
    name: input.name.trim(),
    brief: input.brief,
    rules: [],
    ...(input.forgeProjectId === undefined ? {} : { forgeProjectId: input.forgeProjectId }),
    briefConversationId: null,
    aspectRatio: input.aspectRatio,
    targetDurationSeconds: input.targetDurationSeconds,
    resolution: input.resolution,
    boardStyle: 'grey_tone',
    beatOrder: [],
    beats: {},
    shots: {},
    referencePlanStatus: 'unplanned',
    referenceOrder: [],
    references: {},
    bin: [],
    bedAssetId: null,
    spendPolicy: null,
    spendAuthorizations: [],
    frameExtractions: {},
    undoHistory: [],
    assets: {},
    jobs: {},
    imageRouteId: null,
    videoRouteId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!validateStudioProjectV2(project)) throw new TypeError('Invalid schema-2 project input');
  return project;
};

/** Creates a validated, inactive schema-6 Pilot project without any film scaffold. */
export const createEmptyStudioProjectV3 = (
  input: CreateStudioProjectInputV3,
  id: string,
  timestamp: string
): StudioProjectV3 => {
  const exactInput = snapshotExactInputV3(input);
  if (exactInput === null) throw new TypeError('Invalid schema-6 project input');
  if (exactInput.forgeProjectId !== undefined && typeof exactInput.forgeProjectId !== 'string') {
    throw new TypeError('Invalid schema-6 project input');
  }
  const project: StudioProjectV3 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION_V3,
    revision: 1,
    authoringRevision: 1,
    id,
    name: typeof exactInput.name === 'string' ? exactInput.name.trim() : '',
    brief: exactInput.brief,
    rules: [],
    forgeProjectId: exactInput.forgeProjectId ?? null,
    briefConversationId: null,
    pieceOrder: [],
    pieces: {},
    spendPolicy: null,
    spendAuthorizations: [],
    undoHistory: [],
    assets: {},
    jobs: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!validateStudioProjectV3(project)) throw new TypeError('Invalid schema-6 project input');
  return project;
};
