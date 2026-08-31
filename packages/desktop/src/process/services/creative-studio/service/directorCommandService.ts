/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  type StudioDirectorAutoApplyCommandRecordV2,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError, type CreativeStudioStore } from '@process/services/creative-studio/store';
import {
  applyStudioMutationBatchV2,
  deriveStudioDirtyShotsV2,
  StudioMutationErrorV2,
  type StudioMutationReasonV2,
} from './schema2';

export type StudioDirectorCommitAttribution = Readonly<{
  commitTag: string;
}>;

export type StudioDirectorCommandApplyResultV2 = {
  project: StudioProjectV2;
  appliedRevision: number;
  createdBeatIds: string[];
  createdShotIds: string[];
};

export type StudioDirectorCommandApplyErrorCodeV2 =
  | 'deadline_elapsed'
  | 'operation_not_permitted'
  | StudioMutationReasonV2;

/** Bounded precommit outcome consumed by the main-process command processor. */
export class StudioDirectorCommandApplyErrorV2 extends Error {
  readonly reasonCode: StudioDirectorCommandApplyErrorCodeV2;

  constructor(reasonCode: StudioDirectorCommandApplyErrorCodeV2) {
    super(reasonCode);
    this.name = 'StudioDirectorCommandApplyErrorV2';
    this.reasonCode = reasonCode;
  }
}

export type StudioDirectorCommandServiceV2 = {
  apply(
    command: StudioDirectorAutoApplyCommandRecordV2,
    latestApplyStartMs: number,
    attribution: StudioDirectorCommitAttribution
  ): Promise<StudioDirectorCommandApplyResultV2>;
};

export type StudioDirectorCommandServiceDepsV2 = {
  store: Pick<CreativeStudioStore, 'updateProjectV2'>;
  now?: () => number;
  deriveDirtyShots?: typeof deriveStudioDirtyShotsV2;
};

const applyErrorV2 = (reasonCode: StudioDirectorCommandApplyErrorCodeV2): StudioDirectorCommandApplyErrorV2 =>
  new StudioDirectorCommandApplyErrorV2(reasonCode);

const introducesStudioGenerationStalenessV2 = (
  before: StudioProjectV2,
  after: StudioProjectV2,
  deriveDirtyShots: typeof deriveStudioDirtyShotsV2
): boolean => {
  const beforeCauses = new Map(deriveDirtyShots(before).map((row) => [row.shotId, new Set(row.causes)] as const));
  return deriveDirtyShots(after).some((row) => {
    const prior = beforeCauses.get(row.shotId);
    return row.causes.some((cause) => prior?.has(cause) !== true);
  });
};

const isProjectStoreErrorV2 = (error: unknown): error is CreativeStudioStoreError =>
  error instanceof CreativeStudioStoreError &&
  (error.code === 'stale_project' ||
    error.code === 'not_found' ||
    error.code === 'busy' ||
    error.code === 'storage_error' ||
    error.code === 'unsupported_prototype_schema');

/** Creates the schema-2 atomic command service without performing renderer notification. */
export const createStudioDirectorCommandServiceV2 = (
  deps: StudioDirectorCommandServiceDepsV2
): StudioDirectorCommandServiceV2 => {
  const now = deps.now ?? Date.now;
  const deriveDirtyShots = deps.deriveDirtyShots ?? deriveStudioDirtyShotsV2;
  return {
    async apply(command, latestApplyStartMs, attribution) {
      let createdBeatIds: string[] = [];
      let createdShotIds: string[] = [];
      try {
        const project = await deps.store.updateProjectV2(
          command.projectId,
          (openingProject) => {
            try {
              if (now() >= latestApplyStartMs) throw applyErrorV2('deadline_elapsed');
              const applied = applyStudioMutationBatchV2(
                openingProject,
                {
                  schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
                  projectId: command.projectId,
                  expectedRevision: command.expectedRevision,
                  operations: command.operations,
                },
                {
                  mutationId: command.commandId,
                  capturedAt: command.createdAt,
                }
              );
              if (introducesStudioGenerationStalenessV2(openingProject, applied.project, deriveDirtyShots)) {
                throw applyErrorV2('operation_not_permitted');
              }
              createdBeatIds = [...applied.createdBeatIds];
              createdShotIds = [...applied.createdShotIds];
              return applied.project;
            } catch (error) {
              if (error instanceof StudioDirectorCommandApplyErrorV2) throw error;
              if (error instanceof StudioMutationErrorV2) throw applyErrorV2(error.reasonCode);
              throw applyErrorV2('validation_failed');
            }
          },
          command.expectedRevision,
          attribution.commitTag
        );
        return {
          project,
          appliedRevision: project.revision,
          createdBeatIds: [...createdBeatIds],
          createdShotIds: [...createdShotIds],
        };
      } catch (error) {
        if (error instanceof StudioDirectorCommandApplyErrorV2 || isProjectStoreErrorV2(error)) throw error;
        throw applyErrorV2('validation_failed');
      }
    },
  };
};
