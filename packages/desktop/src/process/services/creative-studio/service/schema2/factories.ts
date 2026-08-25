/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  type CreateStudioProjectInputV2,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV2 } from './validation';

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
