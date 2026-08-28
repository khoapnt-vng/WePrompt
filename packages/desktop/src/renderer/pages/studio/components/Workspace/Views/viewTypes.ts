/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioBriefRule,
  StudioBriefRuleDraft,
  StudioAspectRatio,
  StudioEditableProjectSettingsChanges,
  StudioGenerationCapabilityV2,
  StudioFilmExportCapabilityV2,
  StudioFilmExportStatusV2,
  StudioFilmExportTransitionV2,
  StudioRendererAuthoringOperationV2,
  StudioRendererExportCatalogV2,
  StudioRendererProjectV2,
  StudioProjectStatusV2,
  StudioResolution,
  StudioRouteCatalogV2,
  StudioView,
} from '@/common/types/project/creativeStudioTypes';
import type { UseWorkspaceDraftsResult } from '../useWorkspaceDrafts';
import type { WorkspaceProjection } from '../workspaceProjection';
import type { BeatPanelActions, BeatPanelReviewGraph, StudioShotEditFocusIntent } from '../BeatPanel';
import type { BoardActions } from './Board';
import type { CutActions } from './Cut';
import type { TableReferenceBindingActions } from './Table';
import type { ReferencesViewActions, StudioReferenceFocusIntent } from './References';

export type WorkspaceAuthoringOperationV2 = Exclude<StudioRendererAuthoringOperationV2, { kind: 'set_hard_cut' }>;

export type WorkspaceFilmSetupProjectChanges =
  | { aspectRatio: StudioAspectRatio; resolution?: StudioResolution }
  | { aspectRatio?: StudioAspectRatio; resolution: StudioResolution };

export type WorkspaceFilmSetupAuthoringOperation = Extract<
  WorkspaceAuthoringOperationV2,
  { kind: 'set_brief' | 'set_routes' | 'set_spend_policy' }
>;

export type WorkspaceFilmSetupSaveInput = {
  projectId: string;
  expectedRevision: number;
  projectChanges: WorkspaceFilmSetupProjectChanges | null;
  authoringOperations: WorkspaceFilmSetupAuthoringOperation[];
};

export type WorkspaceFilmSetupSaveResult = {
  projectSettingsSaved: boolean;
  authoringSaved: boolean;
};

export type WorkspaceProjectEditAuthority = {
  projectId: string;
  expectedRevision: number;
};

export type WorkspaceMutationCallbacks = {
  editProject: (
    changes: StudioEditableProjectSettingsChanges,
    authority?: WorkspaceProjectEditAuthority
  ) => Promise<boolean>;
  applyAuthoring: (operations: WorkspaceAuthoringOperationV2[]) => Promise<boolean>;
  saveFilmSetup: (input: WorkspaceFilmSetupSaveInput) => Promise<WorkspaceFilmSetupSaveResult>;
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
  projectStatus: StudioProjectStatusV2 | null;
  projection: WorkspaceProjection;
  drafts: UseWorkspaceDraftsResult;
  pending: boolean;
  gateLocked: boolean;
  imageRouteReady: boolean;
  errorMessageKey: string | null;
  mutations: WorkspaceMutationCallbacks;
  boardActions: BoardActions;
  cutActions: CutActions;
  beatPanelActions: BeatPanelActions;
  beatPanelReviewGraphs: readonly BeatPanelReviewGraph[];
  beatPanelReviewBlockedMessageKey: string | null;
  referenceActions?: ReferencesViewActions & TableReferenceBindingActions;
  referenceMaxConditioningImages?: number | null;
  referencePendingId?: string | null;
  referenceErrorMessageKey?: string | null;
  referenceFocusIntent?: StudioReferenceFocusIntent | null;
  onReferenceFocusIntentConsumed?: (intentId: string) => void;
  shotEditFocusIntent?: StudioShotEditFocusIntent | null;
  onShotEditFocusIntentConsumed?: (intentId: string) => void;
  onReviewShotReferenceBinding: (shotId: string) => void;
};

export type WorkspaceProjectMenuProps = Pick<
  WorkspaceControlsProps,
  'project' | 'projection' | 'drafts' | 'pending' | 'errorMessageKey' | 'mutations'
> & {
  exportCatalog: StudioRendererExportCatalogV2 | null;
  filmExportCapability: StudioFilmExportCapabilityV2 | null;
  createEditorFolder: () => Promise<
    { ok: true; catalog: StudioRendererExportCatalogV2 } | { ok: false; messageKey: string }
  >;
  revealEditorFolder: (artifactId: string) => Promise<{ ok: true } | { ok: false; messageKey: string }>;
  createFilm: (input: {
    renderId: string;
    transition: StudioFilmExportTransitionV2;
    trimTails: boolean;
  }) => Promise<{ ok: true; catalog: StudioRendererExportCatalogV2 } | { ok: false; messageKey: string }>;
  /** Null means the status transport is temporarily unknown; callers must retain their last known state. */
  getFilmExportStatus: () => Promise<StudioFilmExportStatusV2 | null>;
  refreshExports: () => Promise<boolean>;
  cancelFilmExport: (renderId: string) => Promise<boolean>;
  acknowledgeFilmExport: (renderId: string) => Promise<'acknowledged' | 'not_found' | null>;
  revealFilm: (artifactId: string) => Promise<{ ok: true } | { ok: false; messageKey: string }>;
  /** Imported audio is project housekeeping, so its drawer opens from the project menu. */
  detachBedAudio: (assetId: string) => Promise<boolean>;
  routeCatalog: StudioRouteCatalogV2 | null;
  generationCapability?: StudioGenerationCapabilityV2 | null;
  briefDialogRequest?: number;
  briefRouteFocusRole?: 'image' | 'video' | null;
  onRuleDraftDirtyCountChange?: (count: number) => void;
  onActiveRuleDraftDirtyCountChange?: (count: number) => void;
  /** Injected so the locked layer remains directly testable while this release ships it empty. */
  organisationRules?: readonly StudioBriefRule[];
};
