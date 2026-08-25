/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioBriefRule,
  StudioBriefRuleDraft,
  StudioEditableProjectSettingsChanges,
  StudioGenerationCapabilityV2,
  StudioRendererAuthoringOperationV2,
  StudioRendererExportCatalogV2,
  StudioRendererProjectV2,
  StudioRouteCatalogV2,
  StudioView,
} from '@/common/types/project/creativeStudioTypes';
import type { UseWorkspaceDraftsResult } from '../useWorkspaceDrafts';
import type { WorkspaceProjection } from '../workspaceProjection';
import type { BeatPanelActions, BeatPanelReviewGraph } from '../BeatPanel';
import type { BoardActions } from './Board';
import type { CutActions } from './Cut';
import type { TableBoardActions } from './Table';
import type { ReferencesViewActions, StudioReferenceFocusIntent } from './References';

export type WorkspaceAuthoringOperationV2 = Exclude<StudioRendererAuthoringOperationV2, { kind: 'set_hard_cut' }>;

export type WorkspaceMutationCallbacks = {
  editProject: (changes: StudioEditableProjectSettingsChanges) => Promise<boolean>;
  applyAuthoring: (operations: WorkspaceAuthoringOperationV2[]) => Promise<boolean>;
  setRules: (
    update: (latestRules: readonly StudioBriefRule[]) => StudioBriefRuleDraft[] | null,
    adoptionKey: string
  ) => Promise<boolean>;
  acknowledgeRuleAdoption: (adoptionKey: string) => void;
  refreshRoutes: () => Promise<boolean>;
  undo: (entryId: string) => Promise<boolean>;
  retryConditioning: (dependentShotId: string) => Promise<boolean>;
  cancelWaiting: (dependentShotId: string) => Promise<boolean>;
};

export type WorkspaceControlsProps = {
  activeView: StudioView;
  project: StudioRendererProjectV2;
  projection: WorkspaceProjection;
  exportCatalog: StudioRendererExportCatalogV2 | null;
  drafts: UseWorkspaceDraftsResult;
  pending: boolean;
  gateLocked: boolean;
  imageRouteReady: boolean;
  errorMessageKey: string | null;
  exportErrorMessageKey: string | null;
  mutations: WorkspaceMutationCallbacks;
  tableBoardActions: TableBoardActions;
  boardActions: BoardActions;
  cutActions: CutActions;
  beatPanelActions: BeatPanelActions;
  beatPanelReviewGraphs: readonly BeatPanelReviewGraph[];
  beatPanelReviewBlockedMessageKey: string | null;
  referenceActions?: ReferencesViewActions;
  referenceMaxConditioningImages?: number | null;
  referencePendingId?: string | null;
  referenceErrorMessageKey?: string | null;
  referenceFocusIntent?: StudioReferenceFocusIntent | null;
  onReferenceFocusIntentConsumed?: (intentId: string) => void;
};

export type WorkspaceProjectMenuProps = Pick<
  WorkspaceControlsProps,
  'project' | 'projection' | 'drafts' | 'pending' | 'errorMessageKey' | 'mutations'
> & {
  routeCatalog: StudioRouteCatalogV2 | null;
  generationCapability?: StudioGenerationCapabilityV2 | null;
  briefDialogRequest?: number;
  briefRouteFocusRole?: 'image' | 'video' | null;
  onRuleDraftDirtyCountChange?: (count: number) => void;
  onActiveRuleDraftDirtyCountChange?: (count: number) => void;
  /** Injected so the locked layer remains directly testable while this release ships it empty. */
  organisationRules?: readonly StudioBriefRule[];
};
