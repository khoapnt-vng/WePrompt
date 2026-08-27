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

/**
 * Defaults one absent Shot field. Applied to every location a Shot-shaped record can occupy, not
 * only the live `shots` map: `SHOT_BEFORE_KEYS` derives from `SHOT_KEYS`, so a required Shot field
 * also tightens undo-patch validation, and a project that has ever been edited carries Shot
 * snapshots inside `undoHistory[].patches[].before`.
 */
const withDefaultedShotFieldsV2 = (shot: unknown): { value: unknown; changed: boolean } => {
  if (!isRecord(shot) || Object.hasOwn(shot, 'dismissedSeedStillIds')) return { value: shot, changed: false };
  return { value: { ...shot, dismissedSeedStillIds: [] }, changed: true };
};

const normalizeLegacyShotMapV2 = (
  shots: Record<string, unknown>
): { value: Record<string, unknown>; changed: boolean } => {
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(shots).map(([shotId, shot]) => {
      const normalized = withDefaultedShotFieldsV2(shot);
      if (normalized.changed) changed = true;
      return [shotId, normalized.value];
    })
  );
  return { value: changed ? next : shots, changed };
};

/** Shot snapshots stored in undo patches share the Shot shape and so share its required fields. */
const normalizeLegacyUndoHistoryV2 = (undoHistory: unknown): { value: unknown; changed: boolean } => {
  if (!Array.isArray(undoHistory)) return { value: undoHistory, changed: false };
  let changed = false;
  const entries = undoHistory.map((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.patches)) return entry;
    let entryChanged = false;
    const patches = entry.patches.map((patch) => {
      if (!isRecord(patch) || patch.kind !== 'shot_fields') return patch;
      const normalized = withDefaultedShotFieldsV2(patch.before);
      if (!normalized.changed) return patch;
      entryChanged = true;
      return { ...patch, before: normalized.value };
    });
    if (!entryChanged) return entry;
    changed = true;
    return { ...entry, patches };
  });
  return { value: changed ? entries : undoHistory, changed };
};

const normalizeLegacyShotFieldsV2 = (project: Record<string, unknown>): Record<string, unknown> => {
  const shots = isRecord(project.shots)
    ? normalizeLegacyShotMapV2(project.shots)
    : { value: project.shots, changed: false };
  const undoHistory = normalizeLegacyUndoHistoryV2(project.undoHistory);
  if (!shots.changed && !undoHistory.changed) return project;
  return {
    ...project,
    ...(shots.changed ? { shots: shots.value } : {}),
    ...(undoHistory.changed ? { undoHistory: undoHistory.value } : {}),
  };
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
