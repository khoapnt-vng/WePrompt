/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import {
  type StudioApplyMutationBatchResultV3,
  type StudioCancelPieceJobResultV3,
  type StudioConfirmPreparedPhotoResultV3,
  type StudioCreateProjectResultV3,
  type StudioDeleteProjectResultV3,
  type StudioExportPieceResultV3,
  type StudioImportPhotoResultV3,
  type StudioPieceJobV3,
  type StudioPreparePhotoResultV3,
  type StudioProjectListResultV3,
  type StudioProjectLoadResultV3,
  type StudioRendererPieceExportCatalogV3,
  type StudioResumePieceJobResultV3,
  type StudioRetryPieceDownloadResultV3,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import {
  CreativeStudioPilotStoreErrorV3,
  type CreativeStudioPilotStoreV3,
  type StudioPilotProjectCommitFactsV3,
} from '@process/services/creative-studio/store/pilotStore';
import { applyStudioMutationBatchV3, StudioMutationErrorV3 } from '../schema2/mutations/pieceCatalogV3';
import { normalizeStudioPieceHandleV3 } from '../schema2/mutations/pieceHandles';
import { StudioPreparedPhotoCacheV3 } from '../schema2/pricing';
import {
  parseStudioApplyMutationBatchRequestV3,
  parseStudioCreateProjectRequestV3,
  parseStudioDeleteProjectRequestV3,
} from './contracts';
import { createStudioPilotConfirmPhotoServiceV3 } from './confirmation';
import { CreativeStudioPilotServiceErrorV3, normalizeCreativeStudioPilotErrorV3 } from './errors';
import { createStudioPilotPreparePhotoServiceV3, type StudioPilotIdentityKindV3 } from './prepare';
import {
  toStudioProjectSummaryV3,
  toStudioRendererCanvasInventoryV3,
  toStudioRendererCapabilityActivityV3,
} from './projections';
import type { StudioPilotJobManagerV3 } from './runtime/jobs';

export type StudioPilotMediaServiceV3 = {
  importPhotoV3(input: unknown): Promise<StudioImportPhotoResultV3>;
  recoverAllMediaV3(projectIds?: readonly string[]): Promise<void>;
};

export type StudioPilotExportServiceV3 = {
  exportPieceV3(input: unknown): Promise<StudioExportPieceResultV3>;
  listPieceExportsV3(projectId: string): Promise<StudioRendererPieceExportCatalogV3>;
  recoverAllExportsV3(projectIds?: readonly string[]): Promise<void>;
};

export type StudioPilotUpdateV3 =
  | { source: 'durable'; facts: StudioPilotProjectCommitFactsV3 }
  | { source: 'prepared'; projectId: string };

export type CreativeStudioPilotEntryPointDepsV3 = {
  store: CreativeStudioPilotStoreV3;
  providerResolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>;
  jobs: StudioPilotJobManagerV3;
  media: StudioPilotMediaServiceV3;
  exports: StudioPilotExportServiceV3;
  now?: () => number;
  mintIdentity?: (kind: StudioPilotIdentityKindV3 | 'mutation') => string;
};

export type CreativeStudioPilotEntryPointV3 = {
  readonly preparedPhotos: StudioPreparedPhotoCacheV3;
  createProjectV3(input: unknown): Promise<StudioCreateProjectResultV3>;
  listProjectsV3(): Promise<StudioProjectListResultV3>;
  loadProjectV3(projectId: string): Promise<StudioProjectLoadResultV3>;
  preparePhotoV3(input: unknown): Promise<StudioPreparePhotoResultV3>;
  confirmPreparedPhotoV3(input: unknown): Promise<StudioConfirmPreparedPhotoResultV3>;
  importPhotoV3(input: unknown): Promise<StudioImportPhotoResultV3>;
  applyMutationBatchV3(input: unknown): Promise<StudioApplyMutationBatchResultV3>;
  cancelJobV3(input: unknown): Promise<StudioCancelPieceJobResultV3>;
  resumeJobV3(input: unknown): Promise<StudioResumePieceJobResultV3>;
  retryDownloadV3(input: unknown): Promise<StudioRetryPieceDownloadResultV3>;
  exportPieceV3(input: unknown): Promise<StudioExportPieceResultV3>;
  listPieceExportsV3(projectId: string): Promise<StudioRendererPieceExportCatalogV3>;
  deleteProjectV3(input: unknown): Promise<StudioDeleteProjectResultV3>;
  watchProjectUpdatesV3(listener: (update: StudioPilotUpdateV3) => void): () => void;
  startV3(): Promise<void>;
  dispose(): Promise<void>;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const TERMINAL_JOB_STATUSES = new Set<StudioPieceJobV3['status']>(['succeeded', 'failed', 'cancelled']);

const defaultMintIdentity = (kind: StudioPilotIdentityKindV3 | 'mutation'): string =>
  `${kind}_${randomBytes(16).toString('hex')}`;

const mutationFailure = (error: StudioMutationErrorV3): never => {
  if (error.reasonCode === 'authoring_revision_conflict') {
    throw new CreativeStudioPilotServiceErrorV3('stale_authoring');
  }
  if (error.reasonCode === 'piece_not_found') {
    throw new CreativeStudioPilotServiceErrorV3('not_found');
  }
  throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
};

/** Builds the inactive, typed schema-6 Main facade without registering a production IPC route. */
export const createCreativeStudioPilotEntryPointV3 = (
  deps: CreativeStudioPilotEntryPointDepsV3
): CreativeStudioPilotEntryPointV3 => {
  const now = deps.now ?? Date.now;
  const mintIdentity = deps.mintIdentity ?? defaultMintIdentity;
  const listeners = new Set<(update: StudioPilotUpdateV3) => void>();
  let disposed = false;
  let startPromise: Promise<void> | null = null;
  const emit = (update: StudioPilotUpdateV3): void => {
    for (const listener of listeners) {
      try {
        listener(update);
      } catch {
        // Observers cannot change project or prepared-quote authority.
      }
    }
  };
  const unwatchStore = deps.store.watchProjectsV3((facts) => emit({ source: 'durable', facts }));
  const preparedPhotos = new StudioPreparedPhotoCacheV3({
    now,
    onChange: (projectId) => emit({ source: 'prepared', projectId }),
  });
  const prepare = createStudioPilotPreparePhotoServiceV3({
    store: deps.store,
    preparedPhotos,
    providerResolver: deps.providerResolver,
    now,
    mintIdentity: (kind) => mintIdentity(kind),
  });
  const confirm = createStudioPilotConfirmPhotoServiceV3({
    store: deps.store,
    preparedPhotos,
    providerResolver: deps.providerResolver,
    now,
    dispatchCommittedJob: (projectId, jobId) => deps.jobs.dispatchCommittedJobV3(projectId, jobId),
  });

  const assertActive = (): void => {
    if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
  };

  const deleteHealthyProject = async (projectId: string, expectedRevision: number): Promise<boolean> => {
    try {
      return await deps.store.withProjectAuthorityV3(projectId, async (authority) => {
        if (Object.values(authority.project.jobs).some((job) => !TERMINAL_JOB_STATUSES.has(job.status))) {
          throw new CreativeStudioPilotServiceErrorV3('busy');
        }
        return authority.delete(expectedRevision);
      });
    } catch (error) {
      if (error instanceof CreativeStudioPilotStoreErrorV3 && error.code === 'not_found') return false;
      throw error;
    }
  };

  const unreadableLoad = async (
    projectId: string,
    status: 'unsupported' | 'quarantined'
  ): Promise<StudioProjectLoadResultV3> => {
    const issued = await deps.store.issueDeletionClaimV3(projectId);
    return {
      status,
      projectId,
      deletionClaim: issued.deletionClaim,
      deletionClaimExpiresAt: issued.expiresAt,
    };
  };

  return {
    preparedPhotos,

    async createProjectV3(input) {
      assertActive();
      try {
        const request = parseStudioCreateProjectRequestV3(input);
        const project = await deps.store.createProjectV3(request);
        return { status: 'created', summary: toStudioProjectSummaryV3(project) };
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    async listProjectsV3() {
      assertActive();
      try {
        const entries = await deps.store.listProjectsV3();
        const projected: StudioProjectListResultV3['entries'] = [];
        for (const entry of entries) {
          if (entry.classification === 'healthy') {
            try {
              // Reload supplies current-image count and createdAt, neither duplicated in store inventory.
              // eslint-disable-next-line no-await-in-loop
              const project = await deps.store.loadProjectV3(entry.summary.id);
              projected.push({ status: 'supported', summary: toStudioProjectSummaryV3(project) });
            } catch {
              // A raced project is represented by the next inventory refresh; one entry cannot poison the list.
            }
            continue;
          }
          projected.push({
            status: entry.classification,
            projectId: entry.catalogueId,
            deletionClaim: entry.deletionClaim,
            deletionClaimExpiresAt: entry.deletionClaimExpiresAt,
          });
        }
        return { entries: projected };
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    async loadProjectV3(projectId) {
      assertActive();
      try {
        if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
          throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
        }
        const loaded = await deps.store.getProjectV3(projectId);
        if (loaded.status === 'not_found') return { status: 'not_found', projectId };
        if (loaded.status === 'unsupported') return unreadableLoad(projectId, 'unsupported');
        if (loaded.status === 'quarantined') return unreadableLoad(projectId, 'quarantined');
        const quotes = preparedPhotos.list(projectId);
        return {
          status: 'supported',
          summary: toStudioProjectSummaryV3(loaded.project),
          canvas: toStudioRendererCanvasInventoryV3(loaded.project),
          activity: toStudioRendererCapabilityActivityV3(loaded.project, quotes),
        };
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    preparePhotoV3(input) {
      assertActive();
      return prepare.preparePhotoV3(input);
    },

    confirmPreparedPhotoV3(input) {
      assertActive();
      return confirm.confirmPreparedPhotoV3(input);
    },

    importPhotoV3(input) {
      assertActive();
      return deps.media.importPhotoV3(input);
    },

    async applyMutationBatchV3(input) {
      assertActive();
      try {
        const batch = parseStudioApplyMutationBatchRequestV3(input);
        const timestampMs = now();
        if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
          throw new CreativeStudioPilotServiceErrorV3('storage_error');
        }
        const capturedAt = new Date(timestampMs).toISOString();
        const mutationId = mintIdentity('mutation');
        if (typeof mutationId !== 'string' || !SAFE_ID.test(mutationId)) {
          throw new CreativeStudioPilotServiceErrorV3('storage_error');
        }
        return await deps.store.withProjectAuthorityV3(batch.projectId, async (authority) => {
          const rename = batch.operations[0]?.kind === 'rename_piece' ? batch.operations[0] : null;
          if (
            rename !== null &&
            preparedPhotos
              .reservedCreateHandles(authority.project.id, authority.project.authoringRevision)
              .includes(normalizeStudioPieceHandleV3(rename.handle, 'rename'))
          ) {
            throw new StudioMutationErrorV3('handle_collision', 0);
          }
          let applied: ReturnType<typeof applyStudioMutationBatchV3>;
          try {
            applied = applyStudioMutationBatchV3(authority.project, batch, { mutationId, capturedAt });
          } catch (error) {
            if (error instanceof StudioMutationErrorV3) return mutationFailure(error);
            throw error;
          }
          const committed = await authority.commit(() => applied.project, {
            kind: 'authoring',
            expectedRevision: authority.project.revision,
          });
          return {
            projectId: committed.id,
            revision: committed.revision,
            authoringRevision: committed.authoringRevision,
            undoEntryId: rename === null ? null : mutationId,
          };
        });
      } catch (error) {
        if (error instanceof StudioMutationErrorV3) return mutationFailure(error);
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    cancelJobV3(input) {
      assertActive();
      return deps.jobs.cancelJobV3(input);
    },

    resumeJobV3(input) {
      assertActive();
      return deps.jobs.resumeJobV3(input);
    },

    retryDownloadV3(input) {
      assertActive();
      return deps.jobs.retryDownloadV3(input);
    },

    exportPieceV3(input) {
      assertActive();
      return deps.exports.exportPieceV3(input);
    },

    listPieceExportsV3(projectId) {
      assertActive();
      return deps.exports.listPieceExportsV3(projectId);
    },

    async deleteProjectV3(input) {
      assertActive();
      try {
        const request = parseStudioDeleteProjectRequestV3(input);
        const deleted =
          request.mode === 'healthy'
            ? await deleteHealthyProject(request.projectId, request.expectedRevision)
            : await deps.store.deleteProjectV3(request.projectId, { deletionClaim: request.deletionClaim });
        return { status: deleted ? 'deleted' : 'not_found', projectId: request.projectId };
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    watchProjectUpdatesV3(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async startV3() {
      assertActive();
      if (startPromise === null) {
        startPromise = (async () => {
          try {
            const inventory = await deps.store.inspectProjectsV3();
            await deps.media.recoverAllMediaV3(inventory.healthyProjectIds);
            await deps.exports.recoverAllExportsV3(inventory.healthyProjectIds);
            await deps.jobs.resumePendingJobsV3(inventory.healthyProjectIds);
          } catch (error) {
            startPromise = null;
            throw error;
          }
        })();
      }
      return startPromise;
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      unwatchStore();
      listeners.clear();
      preparedPhotos.close();
      await deps.jobs.dispose();
      deps.store.close();
    },
  };
};
