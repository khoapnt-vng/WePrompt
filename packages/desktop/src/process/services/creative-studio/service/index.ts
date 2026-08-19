/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** The Task 7 public service surface is Beat/Shot-only. */
export { CreativeStudioServiceError } from './projectMutations';
export type { StudioDecideReferenceRequestInputV2 } from '../store';
export {
  createCreativeStudioServiceV2,
  derivePayableShotIds,
  projectStudioReferenceGenerationHandoffV2,
  type CreativeStudioServiceV2,
  type CreativeStudioServiceV2Deps,
  type StudioGenerationReadinessV2,
  type StudioRouteCatalogV2,
  type StudioShotGenerationReadinessV2,
  type StudioShotReadinessIssueV2,
} from './v2Service';
export {
  createStudioDirectorCommandServiceV2,
  StudioDirectorCommandApplyErrorV2,
  type StudioDirectorCommandApplyErrorCodeV2,
  type StudioDirectorCommandApplyResultV2,
  type StudioDirectorCommandServiceDepsV2,
  type StudioDirectorCommandServiceV2,
} from './directorCommandService';
export {
  createStudioDirectorCommandProcessorV2,
  createStudioDirectorCommitTrackerV2,
  type StudioDirectorCommandProcessorDepsV2,
  type StudioDirectorCommandProcessorV2,
  type StudioDirectorCommitTrackerV2,
} from './directorCommandProcessor';
