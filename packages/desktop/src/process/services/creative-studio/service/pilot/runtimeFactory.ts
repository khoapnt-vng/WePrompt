/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import type { GenerationProviderAdapterRegistry } from '@process/services/creative-studio/adapters';
import type { StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import {
  createCreativeStudioPilotStoreV3,
  type CreativeStudioPilotStoreV3,
} from '@process/services/creative-studio/store/pilotStore';
import {
  createStudioPieceExportRuntimeV3,
  createStudioPilotJobManagerV3,
  createStudioPilotMediaStoreV3,
  type StudioPieceExportRuntimeV3,
  type StudioPilotJobManagerV3,
  type StudioPilotMediaStorageStepV3,
  type StudioPilotMediaStoreV3,
  type StudioPilotNativePhotoSelectionV3,
} from './runtime';
import {
  createCreativeStudioPilotEntryPointV3,
  type CreativeStudioPilotEntryPointV3,
  type StudioPilotExportServiceV3,
} from './entryPoint';

export type CreativeStudioPilotRuntimeDepsV3 = {
  rootDir: string;
  providerResolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>;
  adapters: GenerationProviderAdapterRegistry;
  listProviders(): Promise<IProvider[]>;
  pickPhoto(): Promise<StudioPilotNativePhotoSelectionV3 | null>;
  resolveGeneratedUrl(url: string, signal: AbortSignal | undefined): Promise<{ path: string }>;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onProjectUpdated?: (projectId: string) => void;
  /** Main-only storage boundary observer used by deterministic crash/restart verification. */
  onMediaStorageStep?: (step: StudioPilotMediaStorageStepV3, projectId: string) => void | Promise<void>;
};

export type CreativeStudioPilotRuntimeV3 = {
  readonly entryPoint: CreativeStudioPilotEntryPointV3;
  readonly store: CreativeStudioPilotStoreV3;
  readonly media: StudioPilotMediaStoreV3;
  readonly jobs: StudioPilotJobManagerV3;
  readonly pieceExports: StudioPieceExportRuntimeV3;
  startV3(): Promise<void>;
  dispose(): Promise<void>;
};

const timestampReader =
  (now: () => number): (() => string) =>
  () => {
    const value = now();
    return Number.isSafeInteger(value) && value >= 0 ? new Date(value).toISOString() : '';
  };

/**
 * Composes the complete inactive schema-6 Main runtime. Nothing here registers production IPC,
 * selects the production Studio service, or grants a schema-5 renderer access to schema-6 data.
 */
export const createCreativeStudioPilotRuntimeV3 = (
  deps: CreativeStudioPilotRuntimeDepsV3
): CreativeStudioPilotRuntimeV3 => {
  const now = deps.now ?? Date.now;
  const nowIso = timestampReader(now);
  const store = createCreativeStudioPilotStoreV3({ rootDir: deps.rootDir, now: nowIso });
  let entryPoint: CreativeStudioPilotEntryPointV3 | null = null;
  const media = createStudioPilotMediaStoreV3({
    store,
    pickPhoto: deps.pickPhoto,
    resolveGeneratedUrl: deps.resolveGeneratedUrl,
    now: nowIso,
    onStorageStep: deps.onMediaStorageStep,
    reservedCreateHandles: (projectId, authoringRevision) =>
      entryPoint?.preparedPhotos.reservedCreateHandles(projectId, authoringRevision) ?? [],
  });
  const jobs = createStudioPilotJobManagerV3({
    store,
    providerResolver: deps.providerResolver,
    adapters: deps.adapters,
    listProviders: deps.listProviders,
    media,
    now,
    nowEpochMs: now,
    sleep: deps.sleep,
    onProjectUpdated: deps.onProjectUpdated,
  });
  const pieceExports = createStudioPieceExportRuntimeV3({ store, media, now: nowIso });
  const exportService: StudioPilotExportServiceV3 = {
    exportPieceV3: (input) => pieceExports.create(input),
    listPieceExportsV3: (projectId) => pieceExports.list(projectId),
    async recoverAllExportsV3(projectIds) {
      const ids = projectIds ?? (await store.inspectProjectsV3()).healthyProjectIds;
      for (const projectId of [...ids].toSorted()) {
        try {
          // Recovery is intentionally isolated per project so one bad catalog cannot disable Pilot.
          // eslint-disable-next-line no-await-in-loop
          await pieceExports.recover(projectId);
        } catch {
          // The project remains loadable and a later explicit list/export can retry containment.
        }
      }
    },
  };
  entryPoint = createCreativeStudioPilotEntryPointV3({
    store,
    providerResolver: deps.providerResolver,
    jobs,
    media,
    exports: exportService,
    now,
  });

  return {
    entryPoint,
    store,
    media,
    jobs,
    pieceExports,
    startV3: () => entryPoint.startV3(),
    dispose: () => entryPoint.dispose(),
  };
};
