/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { StudioPhaseShell } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseShell';
import type { StudioPhaseAdvisory, StudioPhaseControllers } from '@renderer/pages/studio/components/PhaseShell/types';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioJobsResult } from '@renderer/pages/studio/hooks/useStudioJobs';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';

vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => ({
    state: { kind: 'absent' },
    errorMessageKey: null,
    recreate: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const project: StudioRendererProject = {
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '1080p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const editor: UseStoryboardEditorResult = {
  project,
  orderedScenes: [],
  selectedSceneId: null,
  selectedScene: null,
  sceneDraft: null,
  sceneDrafts: {},
  sceneSaveStates: {},
  projectDraft: null,
  projectSaveState: 'saved',
  hasUnsavedProjectDraft: false,
  hasUnsavedSceneDrafts: false,
  hasUnsavedSelectedSceneDraft: false,
  selectedSceneSaveState: 'saved',
  saveIssues: [],
  selectScene: vi.fn(),
  updateSceneDraft: vi.fn(),
  updateSceneDraftById: vi.fn(),
  updateProjectDraft: vi.fn(),
  flushProjectDraft: vi.fn(async () => true),
  discardProjectDraft: vi.fn(),
  flushSceneDraft: vi.fn(async () => true),
  flushSceneDraftById: vi.fn(async () => true),
  flushAllSceneDrafts: vi.fn(async () => ({ failed: [], dirtied: [] })),
  discardSceneDraft: vi.fn(),
  discardSceneDraftById: vi.fn(),
  addScene: vi.fn(async () => true),
  removeScene: vi.fn(async () => true),
  reorderScenes: vi.fn(async () => true),
  moveScene: vi.fn(async () => true),
  canAddScene: true,
  durationTotalSeconds: 0,
  durationMatchesTarget: false,
  remainingDurationSeconds: project.targetDurationSeconds,
  suggestedExpandedTargetSeconds: null,
  increaseTargetDuration: vi.fn(async () => true),
  fitToTarget: vi.fn(async () => null),
  latestFitOutcome: null,
  latestFitCatalogVersion: null,
  clearLatestFitOutcome: vi.fn(),
  mutationPending: false,
  error: null,
  clearError: vi.fn(),
  conflict: null,
  retryConflict: vi.fn(async () => true),
  discardConflict: vi.fn(),
  drafting: false,
  proposeStoryboard: vi.fn(async () => true),
};

const models: UseStudioModelsResult = {
  catalog: null,
  loading: false,
  errorMessageKey: null,
  pendingRole: null,
  refresh: vi.fn(async () => undefined),
  updateSelection: vi.fn(async () => true),
};

const jobs: UseStudioJobsResult = {
  project,
  jobs: [],
  mutationPending: false,
  issue: null,
  staleIntent: null,
  clearIssue: vi.fn(),
  clearStaleIntent: vi.fn(),
  submitScenes: vi.fn(async () => true),
  cancelJob: vi.fn(async () => true),
  retryJob: vi.fn(async () => true),
  retryDownload: vi.fn(async () => true),
};

const controller = (advisory: StudioPhaseAdvisory | null): StudioPhaseControllers => ({
  project,
  proposals: [],
  readiness: {
    sceneStatuses: {},
    totalSceneCount: 0,
    readySceneIds: [],
    selectedAssetCount: 0,
    durationDeltaSeconds: -project.targetDurationSeconds,
  },
  editor,
  models,
  jobs,
  selectedAsset: null,
  posterAsset: null,
  selectedReferenceAsset: null,
  writeFocusIntent: null,
  advisory,
  mutationPending: false,
  requestTransition: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  openDraftReview: vi.fn(),
  openSingleGenerationReview: vi.fn(),
  openBatchGenerationReview: vi.fn(),
  openExport: vi.fn(),
  openModelSettings: vi.fn(),
  importReference: vi.fn(async () => undefined),
  selectVariation: vi.fn(async () => undefined),
  clearWriteFocusIntent: vi.fn(),
  openDuplicateChargeConfirmation: vi.fn(),
});

const renderShell = (advisory: StudioPhaseAdvisory | null) =>
  render(
    <StudioPhaseShell
      activePhase='write'
      controller={controller(advisory)}
      navigationDisabled={false}
      onBack={vi.fn()}
    />
  );

describe('StudioPhaseShell advisory', () => {
  it('announces a shell-anchored Write timing advisory in the shell alert region', () => {
    renderShell({
      messageKey: 'conversation.creativeStudio.review.durationMismatch',
      anchor: 'shell',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.review.durationMismatch');
  });

  it('leaves the shell without an alert region when no advisory is raised', () => {
    renderShell(null);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not hoist a batch-anchored advisory into the shell alert region', () => {
    renderShell({
      messageKey: 'conversation.creativeStudio.review.durationMismatch',
      anchor: 'batch',
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.durationMismatch')).not.toBeInTheDocument();
  });
});
