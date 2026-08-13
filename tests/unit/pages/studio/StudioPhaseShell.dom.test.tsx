/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioRendererJob, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import type { StudioView } from '@renderer/pages/studio/studioPhaseRoute';
import { StudioPhaseShell } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseShell';
import type { StudioPhaseAdvisory, StudioPhaseControllers } from '@renderer/pages/studio/components/PhaseShell/types';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioJobsResult } from '@renderer/pages/studio/hooks/useStudioJobs';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';
import type { UseStudioRenderResult } from '@renderer/pages/studio/hooks/useStudioRender';

vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => ({
    state: { kind: 'absent' },
    errorMessageKey: null,
    recreate: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
  }),
}));

const job = (overrides: Partial<StudioRendererJob> = {}): StudioRendererJob => ({
  id: 'job-1',
  projectId: 'project-1',
  sceneId: 'scene-1',
  status: 'running',
  provider: { choiceId: 'choice-image', providerId: 'provider-image', model: 'image-model' },
  outputAssetIds: [],
  error: null,
  canCancel: false,
  canRetryDownload: false,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  ...overrides,
});

const idleRender: UseStudioRenderResult = {
  status: 'idle',
  progress: 0,
  clipIndex: null,
  clipTotal: null,
  assetId: null,
  missingSceneIds: null,
  errorCode: null,
  errorMessageKey: null,
  busy: false,
  render: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
};

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

const controller = (
  advisory: StudioPhaseAdvisory | null,
  overrides: Partial<StudioPhaseControllers> = {}
): StudioPhaseControllers => ({
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
  render: idleRender,
  selectedAsset: null,
  posterAsset: null,
  selectedReferenceAsset: null,
  writeFocusIntent: null,
  advisory,
  mutationPending: false,
  requestTransition: vi.fn(),
  openRules: vi.fn(),
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
  ...overrides,
});

const renderShell = (advisory: StudioPhaseAdvisory | null) =>
  render(
    <StudioPhaseShell
      activeView='table'
      controller={controller(advisory)}
      navigationDisabled={false}
      onBack={vi.fn()}
    />
  );

describe('StudioPhaseShell advisory', () => {
  it('announces a shell-anchored Table timing advisory in the shell alert region', () => {
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

/**
 * The frame owns in-flight document work. The Board's feed and the Cut's render button are view
 * detail; the aggregate has to be legible from a view that renders neither, which is what these
 * cases assert by mounting Brief.
 */
describe('StudioPhaseShell document activity', () => {
  const renderView = (activeView: StudioView, overrides: Partial<StudioPhaseControllers>) =>
    render(
      <StudioPhaseShell
        activeView={activeView}
        controller={controller(null, overrides)}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

  const activity = (): HTMLElement =>
    screen.getByRole('status', { name: 'conversation.creativeStudio.phase.shared.activityLabel' });

  it('reports generation running elsewhere in the document while Brief is on screen', () => {
    renderView('brief', {
      jobs: { ...jobs, jobs: [job({ id: 'job-1' }), job({ id: 'job-2', status: 'queued_remote' })] },
    });

    // Guards the guard: the readout is header-owned, so it survives a view id the shell cannot
    // mount. Without this the whole suite would keep passing against an empty frame.
    expect(screen.getByRole('heading', { level: 2, name: 'conversation.creativeStudio.phase.brief.title' }));
    expect(activity()).toHaveTextContent(/activityGenerating:count=2(?![\d.])/);
  });

  /**
   * The percentage is a `progressbar` value beside the live region, not text inside it: ffmpeg
   * progress arrives many times a second, and a polite atomic region would speak every step.
   */
  it('reports a cut render running elsewhere in the document while Brief is on screen', () => {
    renderView('brief', { render: { ...idleRender, status: 'running', progress: 0.42 } });

    const progressbar = screen.getByRole('progressbar', {
      name: 'conversation.creativeStudio.phase.shared.activityRenderingLabel',
    });
    expect(progressbar).toHaveTextContent(/activityRendering:percent=42(?![\d.])/);
    expect(progressbar).toHaveAttribute('aria-valuenow', '42');
    expect(activity()).not.toContainElement(progressbar);
  });

  it('keeps the region mounted and silent when the document has no work in flight', () => {
    renderView('brief', {});

    expect(activity()).toBeEmptyDOMElement();
  });
});
