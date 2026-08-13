/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAsset,
  StudioCommandResult,
  StudioProposal,
  StudioProposalAcceptance,
  StudioProposalRequest,
  StudioRendererProject,
  StudioSelectVariationRequest,
} from '@/common/types/project/creativeStudioTypes';
import type { UseStoryboardEditorResult } from '../../hooks/useStoryboardEditor';
import type { UseStudioJobsResult } from '../../hooks/useStudioJobs';
import type { UseStudioModelsResult } from '../../hooks/useStudioModels';
import type { UseStudioRenderResult } from '../../hooks/useStudioRender';
import type { StudioViewTransition, StudioWriteFocusIntent } from '../../studioPhaseRoute';
import type { StudioReadinessSummary } from '../../studioReadiness';
import type { GenerationBatchReviewRequest, GenerationSingleReviewRequest } from '../Generation/GenerationControls';

export type StudioPhaseAdvisory = {
  messageKey: string;
  anchor: 'shell' | 'batch';
};

export type StudioPhaseControllers = {
  project: StudioRendererProject;
  proposals: StudioProposal[];
  readiness: StudioReadinessSummary;
  editor: UseStoryboardEditorResult;
  models: UseStudioModelsResult;
  jobs: UseStudioJobsResult;
  /** The cut render, held at project scope so it stays observable from any view. */
  render: UseStudioRenderResult;
  selectedAsset: StudioAsset | null;
  posterAsset: StudioAsset | null;
  selectedReferenceAsset: StudioAsset | null;
  writeFocusIntent: StudioWriteFocusIntent | null;
  advisory: StudioPhaseAdvisory | null;
  mutationPending: boolean;
  requestTransition: (transition: StudioViewTransition) => void;
  /** Opens the project draft settings from the frame. */
  openBrief: () => void;
  /** Opens the document's rule list. The frame owns it, so every view can reach it. */
  openRules: () => void;
  acceptProposal: (request: StudioProposalRequest) => Promise<StudioCommandResult<StudioProposalAcceptance>>;
  rejectProposal: (request: StudioProposalRequest) => Promise<StudioCommandResult<StudioProposal>>;
  openDraftReview: () => void;
  openSingleGenerationReview: (request: GenerationSingleReviewRequest) => void;
  openBatchGenerationReview: (request: GenerationBatchReviewRequest) => void;
  openExport: () => void;
  refreshProject?: () => Promise<StudioRendererProject | null>;
  openModelSettings: () => void;
  importReference: (sceneId: string) => Promise<void>;
  selectVariation: (request: StudioSelectVariationRequest) => Promise<void>;
  clearWriteFocusIntent: () => void;
  openDuplicateChargeConfirmation: (jobId: string) => void;
};

export type WritePhaseController = Pick<
  StudioPhaseControllers,
  | 'project'
  | 'readiness'
  | 'editor'
  | 'models'
  | 'selectedReferenceAsset'
  | 'writeFocusIntent'
  | 'advisory'
  | 'mutationPending'
  | 'requestTransition'
  | 'openSingleGenerationReview'
  | 'importReference'
  | 'clearWriteFocusIntent'
>;

export type ProducePhaseController = Pick<
  StudioPhaseControllers,
  | 'project'
  | 'readiness'
  | 'editor'
  | 'models'
  | 'jobs'
  | 'selectedAsset'
  | 'posterAsset'
  | 'advisory'
  | 'mutationPending'
  | 'requestTransition'
  | 'openSingleGenerationReview'
  | 'openBatchGenerationReview'
  | 'openModelSettings'
  | 'selectVariation'
  | 'openDuplicateChargeConfirmation'
>;

export type ReviewPhaseController = Pick<
  StudioPhaseControllers,
  | 'project'
  | 'readiness'
  | 'editor'
  | 'render'
  | 'selectedAsset'
  | 'posterAsset'
  | 'advisory'
  | 'mutationPending'
  | 'requestTransition'
  | 'openExport'
  | 'refreshProject'
  | 'selectVariation'
>;
