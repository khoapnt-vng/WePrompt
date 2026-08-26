/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import type { StudioProjectV2 } from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV2 } from './schema2';

export const STUDIO_BRIEF_FILE_NAME = 'brief.md';
export const STUDIO_BRIEF_FILE_MAX_BYTES = 64 * 1024;
export const STUDIO_BRIEF_METADATA_SCHEMA_VERSION = 1 as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type StudioBriefFileMetadataV2 = {
  schemaVersion: typeof STUDIO_BRIEF_METADATA_SCHEMA_VERSION;
  sha256: string;
};

export type StudioProjectManifestV2 = Omit<StudioProjectV2, 'brief'> & {
  briefFile: StudioBriefFileMetadataV2;
};

export type StudioProjectManifestDecodeResultV2 = { project: StudioProjectV2; synchronized: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBriefMetadata = (value: unknown): value is StudioBriefFileMetadataV2 =>
  isRecord(value) &&
  Reflect.ownKeys(value).length === 2 &&
  Object.hasOwn(value, 'schemaVersion') &&
  Object.hasOwn(value, 'sha256') &&
  value.schemaVersion === STUDIO_BRIEF_METADATA_SCHEMA_VERSION &&
  typeof value.sha256 === 'string' &&
  SHA256_HEX.test(value.sha256);

const normalizeLegacyShotFieldsV2 = (project: Record<string, unknown>): Record<string, unknown> => {
  if (!isRecord(project.shots)) return project;
  let changed = false;
  const shots = Object.fromEntries(
    Object.entries(project.shots).map(([shotId, shot]) => {
      if (!isRecord(shot) || Object.hasOwn(shot, 'dismissedSeedStillIds')) return [shotId, shot];
      changed = true;
      return [shotId, { ...shot, dismissedSeedStillIds: [] }];
    })
  );
  return changed ? { ...project, shots } : project;
};

const normalizeLegacyFrameExtractionFieldsV2 = (project: Record<string, unknown>): Record<string, unknown> => {
  if (!isRecord(project.frameExtractions)) return project;
  let changed = false;
  const frameExtractions = Object.fromEntries(
    Object.entries(project.frameExtractions).map(([extractionId, extraction]) => {
      if (!isRecord(extraction) || Object.hasOwn(extraction, 'attemptCount')) return [extractionId, extraction];
      changed = true;
      return [extractionId, { ...extraction, attemptCount: extraction.status === 'pending' ? 0 : 1 }];
    })
  );
  return changed ? { ...project, frameExtractions } : project;
};

export const studioBriefSha256 = (brief: string): string =>
  crypto.createHash('sha256').update(brief, 'utf8').digest('hex');

/** Produces the only new on-disk project shape. Runtime prose is deliberately omitted. */
export const createStudioProjectManifestV2 = (project: StudioProjectV2): StudioProjectManifestV2 => {
  if (!validateStudioProjectV2(project)) throw new TypeError('Invalid Studio project');
  const { brief, ...manifest } = structuredClone(project);
  return {
    ...manifest,
    briefFile: {
      schemaVersion: STUDIO_BRIEF_METADATA_SCHEMA_VERSION,
      sha256: studioBriefSha256(brief),
    },
  };
};

/** Hydrates the schema-5 manifest. The sidecar is the sole persisted Brief authority. */
export const decodeStudioProjectManifestV2 = (
  value: unknown,
  briefFileText: string | null
): StudioProjectManifestDecodeResultV2 | null => {
  if (!isRecord(value) || Object.hasOwn(value, 'brief') || !isBriefMetadata(value.briefFile)) return null;
  if (briefFileText === null) return null;
  const { briefFile, ...persistedProject } = value;
  const project = {
    ...normalizeLegacyFrameExtractionFieldsV2(normalizeLegacyShotFieldsV2(persistedProject)),
    brief: briefFileText,
  };
  if (!validateStudioProjectV2(project)) return null;
  return {
    project,
    synchronized: briefFile.sha256 === studioBriefSha256(briefFileText),
  };
};
