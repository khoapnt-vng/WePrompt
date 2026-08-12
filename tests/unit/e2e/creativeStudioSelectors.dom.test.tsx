/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolves the Creative Studio e2e spec's locators against the real shell composition.
 *
 * Those locators are the one part of the spec nothing else can validate: a CSS path that matches
 * no element is not a type error, `tsc --noEmit` does not typecheck tests at all, and
 * `playwright test --list` only proves the file compiles. The e2e run itself needs a display.
 * Worse, a stale selector does not always fail — the spec asserts `toHaveCount(0)` on the shell
 * advisory, which a selector that can never match satisfies for the wrong reason.
 *
 * So the CSS selectors are read out of the spec source and resolved here, against StudioShell
 * wrapping the real StudioPhaseShell, with the real en-US copy the spec asserts on. The three-pane
 * redesign moved `data-studio-layout-root` from the phase shell onto StudioShell and pushed the
 * header and the advisory two levels down behind the work panel; this test is what turns that kind
 * of move red.
 */

import fs from 'node:fs';
import path from 'node:path';

import { render, within } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { StudioPhaseShell } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseShell';
import type { StudioPhaseAdvisory, StudioPhaseControllers } from '@renderer/pages/studio/components/PhaseShell/types';
import { StudioShell } from '@renderer/pages/studio/components/Shell/StudioShell';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioJobsResult } from '@renderer/pages/studio/hooks/useStudioJobs';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

// jsdom measures every element at 0 width, so the shell would pick `compact` and park the Director
// in the overlay. The e2e runs at desktop width, where the pane is inline — drive that mode.
vi.mock('@renderer/pages/studio/components/PhaseShell/useStudioLayoutMode', () => ({
  useStudioLayoutMode: () => ({ containerRef: { current: null }, layoutMode: 'inline' }),
}));

vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => ({
    state: { kind: 'absent' },
    errorMessageKey: null,
    recreate: vi.fn(),
  }),
}));

const SPEC_FILE = path.resolve(__dirname, '../../e2e/features/workspaces/creative-studio.e2e.ts');

/** Every `page.locator('…')` in the spec that addresses Studio through one of its layout hooks. */
const studioSpecSelectors = (): string[] => {
  const source = fs.readFileSync(SPEC_FILE, 'utf-8');
  const found = [...source.matchAll(/page\.locator\('([^']*\[data-studio-[^']*)'\)/g)].map((match) => match[1]);
  return [...new Set(found)];
};

const SAVE_STATE_ROLE = 'status';
const ADVISORY_ROLE = 'alert';

// The copy the spec asserts on, in the spec's own words.
const SAVED_TEXT = 'Saved';
const ADVISORY_TEXT = 'Storyboard timing does not match the project target.';
const BACK_TO_LIBRARY_NAME = 'Back to project library';
const CRUMB_NAME = 'Creative Studio';

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

/**
 * Stands in for DirectorPane, which renders `role="alert"` spans of its own (an over-length
 * composer, a conversation that could not be created) and hosts a chat surface that raises more.
 * It sits ahead of the work panel in document order, so a selector that reaches it instead of the
 * phase shell is exactly the drift under test.
 */
const DirectorDecoy: React.FC = () => (
  <div data-testid='director-decoy'>
    <header>
      <span role={SAVE_STATE_ROLE}>director status</span>
    </header>
    <span role={ADVISORY_ROLE}>director alert</span>
  </div>
);

const englishI18n = async (): Promise<i18n> => {
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'en-US',
    fallbackLng: false,
    resources: { 'en-US': { translation: { conversation } } },
    interpolation: { escapeValue: false },
  });
  return instance;
};

const renderStudio = async (advisory: StudioPhaseAdvisory | null) =>
  render(
    <I18nextProvider i18n={await englishI18n()}>
      <StudioShell projectId={project.id} director={<DirectorDecoy />}>
        <StudioPhaseShell
          activePhase='write'
          controller={controller(advisory)}
          navigationDisabled={false}
          onBack={vi.fn()}
        />
      </StudioShell>
    </I18nextProvider>
  );

const shellAdvisory: StudioPhaseAdvisory = {
  messageKey: 'conversation.creativeStudio.review.durationMismatch',
  anchor: 'shell',
};

const specSelectorFor = (role: string): string => {
  const selector = studioSpecSelectors().find((candidate) => candidate.includes(`role="${role}"`));
  if (selector === undefined) throw new Error(`the e2e spec no longer addresses a [role="${role}"] element`);
  return selector;
};

describe('creative-studio e2e selectors', () => {
  it('reads the layout selectors the spec actually uses', () => {
    // Guards the extraction itself: if the regex stops finding the spec's locators, every
    // assertion below would pass over an empty list.
    expect(studioSpecSelectors().length).toBeGreaterThanOrEqual(3);
  });

  it('resolves every layout selector in the spec to exactly one element', async () => {
    await renderStudio(shellAdvisory);

    const unresolved = studioSpecSelectors().filter((selector) => document.querySelectorAll(selector).length !== 1);

    expect(unresolved).toEqual([]);
  });

  it('lands the save-state selector on the project save state and not on the Director pane', async () => {
    const { getByTestId } = await renderStudio(shellAdvisory);

    const saveState = document.querySelector(specSelectorFor(SAVE_STATE_ROLE));

    expect(saveState).toHaveTextContent(SAVED_TEXT);
    expect(getByTestId('director-decoy')).not.toContainElement(saveState as HTMLElement);
  });

  it('lands the advisory selector on the shell advisory and not on the Director pane', async () => {
    const { getByTestId } = await renderStudio(shellAdvisory);

    const alert = document.querySelector(specSelectorFor(ADVISORY_ROLE));

    expect(alert).toHaveTextContent(ADVISORY_TEXT);
    expect(getByTestId('director-decoy')).not.toContainElement(alert as HTMLElement);
  });

  /**
   * The spec's `toHaveCount(0)` guard — "a seeded 3x5s shape hits the target exactly, so no shell
   * advisory is raised" — only means anything if the selector can match when an advisory IS raised
   * and stays empty when it is not. The Director pane keeps an alert on screen throughout, so a
   * selector that merely reached "some alert" would fail here.
   */
  it('matches nothing when no shell advisory is raised, even while the Director shows one', async () => {
    await renderStudio(null);

    expect(document.querySelectorAll(specSelectorFor(ADVISORY_ROLE))).toHaveLength(0);
    expect(document.querySelectorAll(`[role="${ADVISORY_ROLE}"]`).length).toBeGreaterThan(0);
  });

  /**
   * The spec leaves a project through the breadcrumb. The crumb is named by its visible text now,
   * so the destination lives on the landmark — addressing the button by "Back to project library"
   * matches nothing, and the e2e would sit in a click timeout with no route out of the project.
   */
  it('reaches the back affordance through the breadcrumb landmark', async () => {
    const { getByRole, queryAllByRole } = await renderStudio(null);

    const crumb = within(getByRole('navigation', { name: BACK_TO_LIBRARY_NAME })).getByRole('button');

    expect(crumb).toHaveAccessibleName(CRUMB_NAME);
    expect(queryAllByRole('button', { name: BACK_TO_LIBRARY_NAME })).toEqual([]);
  });
});
