export { SpendGateModal, useSpendGate } from './Gate';
export type { SpendGateModalProps, UseSpendGateInput, UseSpendGateResult } from './Gate';
export { BeatPanel } from './BeatPanel';
export type { WorkspaceShotSegmentState } from './BeatPanel/segmentState';
export type {
  BeatPanelActions,
  BeatPanelBriefReferenceOption,
  BeatPanelGenerationCount,
  BeatPanelImportResult,
  BeatPanelProps,
  BeatPanelReviewChoice,
  BeatPanelReviewChoiceIdentity,
  BeatPanelReviewGraph,
  BeatPanelReviewPreference,
  BeatPanelShotSave,
} from './BeatPanel';
export {
  continuityGateDraft,
  formatMinorUnits,
  handoffGateDraft,
  initialSpendGateState,
  majorUnitsToMinorUnits,
  selectedSpendGateQuote,
  filmRenderBatchShotIds,
  selectionGateDraft,
  spendGateReducer,
  spendGateRouteIssue,
  spendGateContinuityChange,
  summarizeQuote,
} from './spendGate';
export type {
  SpendGateContinuityChange,
  SpendGateDraft,
  SpendGatePhase,
  SpendGateQuoteSummary,
  SpendGateRouteIssue,
  SpendGateSelectedOption,
  SpendGateState,
} from './spendGate';
export {
  countStoredWorkspaceDrafts,
  hasGenerationAffectingWorkspaceDrafts,
  updateWorkspaceSelection,
  useWorkspaceDrafts,
} from './useWorkspaceDrafts';
export type {
  UseWorkspaceDraftsInput,
  UseWorkspaceDraftsResult,
  WorkspaceDraftEntry,
  WorkspaceDraftValue,
  WorkspaceSelection,
} from './useWorkspaceDrafts';
export { buildStudioBarStats, projectWorkspace } from './workspaceProjection';
export type {
  WorkspaceBinnedBeatProjection,
  WorkspaceBinnedShotProjection,
  WorkspaceBinnedTakeProjection,
  WorkspaceBinItemProjection,
  WorkspaceBeatDisplayState,
  WorkspaceBeatProjection,
  WorkspaceCutAudioImportProjection,
  WorkspaceCutBeatDurationKind,
  WorkspaceCutBeatProjection,
  WorkspaceCutBedProjection,
  WorkspaceCutCoverCandidateProjection,
  WorkspaceCutProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
  WorkspaceTakeProjection,
  StudioBarStats,
} from './workspaceProjection';
export { WorkspaceShell } from './WorkspaceShell';
export type { WorkspaceShellHandle, WorkspaceShellProps } from './WorkspaceShell';
export {
  BoardView,
  CutView,
  TableView,
  WorkspaceControls,
  WorkspaceProjectMenu,
  countStoredStudioRuleDrafts,
} from './Views';
export type {
  BoardActions,
  BoardViewProps,
  CutActions,
  CutCopyResult,
  CutCreateExportInput,
  CutImportResult,
  CutViewProps,
  TableViewProps,
  WorkspaceControlsProps,
  WorkspaceMutationCallbacks,
  WorkspaceProjectMenuProps,
} from './Views';
