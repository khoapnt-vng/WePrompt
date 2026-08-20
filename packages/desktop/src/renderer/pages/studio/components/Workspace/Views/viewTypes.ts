/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioBriefRuleDraft,
  StudioCascadeProgressV2,
  StudioEditableProjectSettingsChanges,
  StudioRendererAuthoringOperationV2,
  StudioRendererProjectV2,
  StudioRouteCatalogV2,
  StudioView,
} from '@/common/types/project/creativeStudioTypes';
import type { UseWorkspaceDraftsResult } from '../useWorkspaceDrafts';
import type { WorkspaceProjection } from '../workspaceProjection';
import type { BeatPanelActions, BeatPanelBriefReferenceOption, BeatPanelReviewGraph } from '../BeatPanel';
import type { BoardActions } from './Board';

export type WorkspaceMutationCallbacks = {
  editProject: (changes: StudioEditableProjectSettingsChanges) => Promise<boolean>;
  applyAuthoring: (operations: StudioRendererAuthoringOperationV2[]) => Promise<boolean>;
  setRules: (rules: StudioBriefRuleDraft[]) => Promise<boolean>;
  refreshRoutes: () => Promise<boolean>;
  undo: (entryId: string) => Promise<boolean>;
  retryConditioning: (dependentShotId: string) => Promise<boolean>;
  cancelWaiting: (dependentShotId: string) => Promise<boolean>;
  chooseCascadeAsset: (row: StudioCascadeProgressV2, assetId: string) => Promise<boolean>;
};

export type WorkspaceControlsProps = {
  activeView: StudioView;
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  routeCatalog: StudioRouteCatalogV2 | null;
  drafts: UseWorkspaceDraftsResult;
  pending: boolean;
  gateLocked: boolean;
  errorMessageKey: string | null;
  mutations: WorkspaceMutationCallbacks;
  boardActions: BoardActions;
  beatPanelActions: BeatPanelActions;
  beatPanelBriefReferenceOptions: readonly BeatPanelBriefReferenceOption[];
  beatPanelReviewGraphs: readonly BeatPanelReviewGraph[];
  beatPanelReviewBlockedMessageKey: string | null;
};
