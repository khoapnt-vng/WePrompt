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

export type StudioProjectManifestDecodeResultV2 =
  | { kind: 'legacy'; project: StudioProjectV2; synchronized: boolean }
  | { kind: 'brief_file'; project: StudioProjectV2; synchronized: boolean };

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

/**
 * Hydrates either a legacy inline-Brief manifest or the digest-backed manifest. A present file is
 * always the prose authority; `synchronized` reports whether the persisted metadata/cache agrees.
 */
export const decodeStudioProjectManifestV2 = (
  value: unknown,
  briefFileText: string | null
): StudioProjectManifestDecodeResultV2 | null => {
  if (validateStudioProjectV2(value)) {
    if (briefFileText === null) return { kind: 'legacy', project: structuredClone(value), synchronized: false };
    const project = { ...structuredClone(value), brief: briefFileText };
    return validateStudioProjectV2(project)
      ? { kind: 'legacy', project, synchronized: value.brief === briefFileText }
      : null;
  }
  if (!isRecord(value) || Object.hasOwn(value, 'brief') || !isBriefMetadata(value.briefFile)) return null;
  if (briefFileText === null) return null;
  const { briefFile, ...persistedProject } = value;
  const project = { ...persistedProject, brief: briefFileText };
  if (!validateStudioProjectV2(project)) return null;
  return {
    kind: 'brief_file',
    project,
    synchronized: briefFile.sha256 === studioBriefSha256(briefFileText),
  };
};
