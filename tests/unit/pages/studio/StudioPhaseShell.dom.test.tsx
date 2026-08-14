/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  StudioRendererJob,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioView } from '@renderer/pages/studio/studioPhaseRoute';
import { StudioPhaseShell } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseShell';
import styles from '@renderer/pages/studio/components/PhaseShell/StudioPhaseShell.module.css';
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
  selectionIssue: null,
  pendingRole: null,
  refresh: vi.fn(async () => undefined),
  updateSelection: vi.fn(async () => true),
};

const imageRoute: StudioRouteCatalogEntry = {
  choiceId: 'choice-image',
  providerId: 'provider-image',
  providerName: 'Image provider',
  model: 'image-model',
  integrationLabelKey: 'imageApi',
  health: 'available',
  kind: 'image',
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: true,
  },
};

/** A workspace with one adopted, ready image engine — the state in which spending is possible. */
const readyCatalog: StudioRouteCatalog = {
  storyboard: {
    status: 'ready',
    selected: { providerId: 'planner', model: 'planner-model' },
    options: [{ providerId: 'planner', providerName: 'Planner', model: 'planner-model', health: 'available' }],
  },
  image: {
    status: 'ready',
    selected: { choiceId: imageRoute.choiceId, providerId: imageRoute.providerId, model: imageRoute.model },
    selectedRoute: imageRoute,
    selectionIssue: null,
    options: [imageRoute],
  },
  video: { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  catalogVersion: 'catalog-v1',
};

const readyScene: StudioScene = {
  id: 'scene-1',
  title: 'Opening shot',
  purpose: '',
  visualPrompt: 'A wide sunrise over the city',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
};

const spendableProject: StudioRendererProject = {
  ...project,
  sceneOrder: [readyScene.id],
  scenes: { [readyScene.id]: readyScene },
  routing: {
    storyboard: { providerId: 'planner', model: 'planner-model' },
    image: { choiceId: imageRoute.choiceId, providerId: imageRoute.providerId, model: imageRoute.model },
    video: null,
  },
};

/** Controller overrides that put the frame in the one state where the paid control can be used. */
const spendable = (overrides: Partial<StudioPhaseControllers> = {}): Partial<StudioPhaseControllers> => ({
  project: spendableProject,
  models: { ...models, catalog: readyCatalog },
  readiness: {
    sceneStatuses: { [readyScene.id]: 'ready' },
    totalSceneCount: 1,
    readySceneIds: [readyScene.id],
    selectedAssetCount: 0,
    durationTotalSeconds: readyScene.durationSeconds,
    durationDeltaSeconds: readyScene.durationSeconds - project.targetDurationSeconds,
  },
  editor: { ...editor, project: spendableProject },
  ...overrides,
});

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
    durationTotalSeconds: 0,
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
  generationReviewOpen: false,
  requestTransition: vi.fn(),
  openBrief: vi.fn(),
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

const renderShell = (advisory: StudioPhaseAdvisory | null, overrides: Partial<StudioPhaseControllers> = {}) =>
  render(
    <StudioPhaseShell
      activeView='table'
      controller={controller(advisory, overrides)}
      navigationDisabled={false}
      onBack={vi.fn()}
    />
  );

describe('StudioPhaseShell view mounts', () => {
  it.each([
    ['table', true],
    ['board', true],
    ['cut', false],
  ] as const)('keeps one phase heading and the intended Engine Strip mount in %s', (activeView, hasStrip) => {
    const { container } = render(
      <StudioPhaseShell
        activeView={activeView}
        controller={controller(null)}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

    expect(container.querySelectorAll('[data-studio-phase-heading]')).toHaveLength(1);
    const strip = screen.queryByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });
    if (hasStrip) expect(strip).toBeVisible();
    else expect(strip).not.toBeInTheDocument();
  });
});

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

  /**
   * `anchor` is the whole point of the advisory type, and both anchors now render inside the same
   * frame: the shell's `role='alert'` speaks about the document and interrupts, the batch anchor
   * speaks about one button and waits its turn. Hoisting the batch advisory into the alert region
   * would be invisible on screen and wrong in the ear, so this asserts the text is present, is
   * announced politely, and is not what `role='alert'` resolves to.
   */
  it('does not hoist a batch-anchored advisory into the shell alert region', () => {
    renderShell({ messageKey: 'conversation.creativeStudio.review.durationMismatch', anchor: 'batch' }, spendable());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const advisory = screen.getByText('conversation.creativeStudio.review.durationMismatch');
    expect(advisory).toHaveAttribute('aria-live', 'polite');
    expect(advisory.closest('[data-studio-batch-control]')).not.toBeNull();
  });
});

/**
 * Where the document stands, in three numbers, beside the view switch. It replaces the phase rail's
 * completion markers, which could only report which of four steps you had walked past.
 */
describe('StudioPhaseShell state readout', () => {
  const readout = (): HTMLElement => {
    const element = document.querySelector<HTMLElement>('[data-studio-state-readout]');
    expect(element, 'the frame must carry a state readout').not.toBeNull();
    return element!;
  };

  const summary = (overrides: Partial<StudioPhaseControllers['readiness']>) =>
    renderShell(null, {
      readiness: {
        sceneStatuses: {},
        totalSceneCount: 0,
        readySceneIds: [],
        selectedAssetCount: 0,
        durationTotalSeconds: 0,
        durationDeltaSeconds: 0,
        ...overrides,
      },
    });

  it('reports the shot count, the runtime and the finished shots', () => {
    summary({ totalSceneCount: 9, durationTotalSeconds: 178, selectedAssetCount: 2 });

    expect(readout()).toHaveTextContent(
      'conversation.creativeStudio.phase.shared.readoutShots:count=9 · conversation.creativeStudio.phase.shared.readoutDuration:duration=2:58 · conversation.creativeStudio.phase.shared.readoutRendered:count=2'
    );
    // Whitespace, unnormalised: the middle dots are aria-hidden, so real text nodes are the only
    // thing keeping the three numbers from being spoken as a single word.
    expect(readout().textContent).toMatch(/readoutShots:count=9\s+·\s+/);
    expect(readout().textContent).toMatch(/\s+·\s+conversation\.creativeStudio\.phase\.shared\.readoutRendered/);
  });

  /**
   * The trap this readout exists to avoid.
   *
   * `readySceneIds` means ready *to generate*, so it drains as shots are made — a project with nine
   * finished shots and nothing left to do has an empty one. Sourcing the third term from it would
   * produce a progress reading that counts down to zero at the exact moment the film is finished.
   * The counts here are chosen so the two fields move in opposite directions and cannot be confused.
   */
  it('counts the shots that are finished, not the shots still waiting to be generated', () => {
    summary({ totalSceneCount: 9, readySceneIds: ['scene-8', 'scene-9'], selectedAssetCount: 7 });

    const text = readout().textContent ?? '';
    expect(text).toContain('readoutRendered:count=7');
    expect(text).not.toContain('readoutRendered:count=2');
  });

  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [60, '1:00'],
    [178, '2:58'],
    [3661, '1:01:01'],
  ])('writes %i seconds of storyboard as the runtime %s', (durationTotalSeconds, expected) => {
    summary({ durationTotalSeconds });

    expect(readout()).toHaveTextContent(`readoutDuration:duration=${expected}`);
  });

  /**
   * The frame already holds one polite live region and one progressbar, each addressed by an
   * accessible name. A readout that reused either name would silently turn those single-element
   * queries into two-element ones, and the failure would surface as an unrelated test breaking.
   */
  it('leaves the document activity region and the render progressbar uniquely addressable', () => {
    renderShell(null, {
      jobs: { ...jobs, jobs: [job({ id: 'job-1' })] },
      render: { ...idleRender, status: 'running', progress: 0.42 },
      readiness: {
        sceneStatuses: {},
        totalSceneCount: 4,
        readySceneIds: [],
        selectedAssetCount: 1,
        durationTotalSeconds: 20,
        durationDeltaSeconds: 5,
      },
    });

    expect(
      screen.getAllByRole('status', { name: 'conversation.creativeStudio.phase.shared.activityLabel' })
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('progressbar', { name: 'conversation.creativeStudio.phase.shared.activityRenderingLabel' })
    ).toHaveLength(1);
    expect(readout()).not.toHaveAttribute('aria-live');
  });
});

/**
 * The document's one spend, `studioJobs.submitScenes`, reached from the frame rather than from the
 * Board view that used to hold it. Every assertion here is about money: that the entry point exists
 * exactly once, that it opens review instead of charging, and that the states which make a
 * submission unsafe hold it shut.
 */
describe('StudioPhaseShell batch generation control', () => {
  const batchButton = (): HTMLElement =>
    screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes:count=1' });

  it('opens review from the top bar instead of submitting, on a view that is not Board', () => {
    const openBatchGenerationReview = vi.fn();
    const submitScenes = vi.fn(async () => true);
    renderShell(null, {
      ...spendable(),
      jobs: { ...jobs, submitScenes },
      openBatchGenerationReview,
    });

    const control = batchButton();
    expect(control.closest('[data-studio-phase-actions]')).not.toBeNull();
    fireEvent.click(control);

    // Table is on screen: the spend is reachable from a view that never hosted it.
    expect(screen.getByRole('heading', { level: 2, name: 'conversation.creativeStudio.phase.write.title' }));
    expect(openBatchGenerationReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        catalogVersion: 'catalog-v1',
        routes: expect.objectContaining({
          image: { route: expect.objectContaining({ choiceId: 'choice-image' }), routeStatus: 'valid' },
        }),
      })
    );
    expect(submitScenes).not.toHaveBeenCalled();
  });

  /**
   * The e2e no-engine door asserts zero buttons named /^(Render|Generate)/ inside the work panel,
   * and the top bar is inside that panel. Hiding rather than disabling is also the honest reading:
   * with no adopted engine there is nothing to spend against.
   */
  it('withholds the paid control entirely when the workspace has no ready engine', () => {
    renderShell(null, { ...spendable(), models });

    expect(
      screen.queryByRole('button', { name: /conversation\.creativeStudio\.review\.generateReadyScenes/ })
    ).not.toBeInTheDocument();
    // Guards the guard: the free document actions prove the header rendered at all.
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.open' })).toBeInTheDocument();
  });

  it.each([
    ['an unsaved project draft', { editor: { ...editor, project: spendableProject, hasUnsavedProjectDraft: true } }],
    ['an unsaved scene draft', { editor: { ...editor, project: spendableProject, hasUnsavedSceneDrafts: true } }],
    [
      'an unresolved update conflict',
      {
        editor: {
          ...editor,
          project: spendableProject,
          conflict: {
            operation: 'update_project' as const,
            messageKey: 'conversation.creativeStudio.errors.staleProject',
          },
        },
      },
    ],
    ['a storyboard draft in flight', { editor: { ...editor, project: spendableProject, drafting: true } }],
    ['a pending mutation', { mutationPending: true }],
    ['a catalog still loading', { models: { ...models, catalog: readyCatalog, loading: true } }],
  ])('holds the paid control shut while the document has %s', (_state, overrides) => {
    renderShell(null, { ...spendable(), ...overrides });

    expect(batchButton()).toBeDisabled();
  });

  it('holds the paid control shut with no ready shot to generate', () => {
    renderShell(null, {
      ...spendable(),
      readiness: {
        sceneStatuses: { [readyScene.id]: 'needs_prompt' },
        totalSceneCount: 1,
        readySceneIds: [],
        selectedAssetCount: 0,
        durationTotalSeconds: readyScene.durationSeconds,
        durationDeltaSeconds: readyScene.durationSeconds - project.targetDurationSeconds,
      },
    });

    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes:count=0' })
    ).toBeDisabled();
  });

  it('labels and opens only the exact eligible target while grouping frozen route exclusions', () => {
    const blockedScene: StudioScene = {
      ...readyScene,
      id: 'scene-blocked',
      title: 'Reference shot',
      referenceAssetId: 'reference-1',
    };
    const noFirstFrameRoute: StudioRouteCatalogEntry = {
      ...imageRoute,
      constraints: { ...imageRoute.constraints, supportsFirstFrame: false },
    };
    const currentProject: StudioRendererProject = {
      ...spendableProject,
      sceneOrder: [readyScene.id, blockedScene.id],
      scenes: { [readyScene.id]: readyScene, [blockedScene.id]: blockedScene },
    };
    const currentCatalog: StudioRouteCatalog = {
      ...readyCatalog,
      image: { ...readyCatalog.image, selectedRoute: noFirstFrameRoute, options: [noFirstFrameRoute] },
    };
    const openBatchGenerationReview = vi.fn();
    renderShell(null, {
      ...spendable(),
      project: currentProject,
      editor: { ...editor, project: currentProject },
      models: { ...models, catalog: currentCatalog },
      readiness: {
        sceneStatuses: { [readyScene.id]: 'ready', [blockedScene.id]: 'ready' },
        totalSceneCount: 2,
        readySceneIds: [readyScene.id, blockedScene.id],
        selectedAssetCount: 0,
        durationTotalSeconds: 10,
        durationDeltaSeconds: -5,
      },
      openBatchGenerationReview,
    });

    const button = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.generateReadyScenes:count=1',
    });
    expect(button).toBeEnabled();
    expect(
      screen.getByText(
        'conversation.creativeStudio.phase.produce.batchExcluded:count=1,reason=conversation.creativeStudio.models.blocked.firstFrame'
      )
    ).toBeVisible();

    fireEvent.click(button);
    expect(openBatchGenerationReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        sceneIds: ['scene-1'],
        exclusions: [
          {
            block: { code: 'first_frame', role: 'image' },
            sceneIds: ['scene-blocked'],
          },
        ],
      })
    );
  });

  it('adds the exact-target-empty guard without relying on the global ready count', () => {
    const blockedScene: StudioScene = { ...readyScene, referenceAssetId: 'reference-1' };
    const noFirstFrameRoute: StudioRouteCatalogEntry = {
      ...imageRoute,
      constraints: { ...imageRoute.constraints, supportsFirstFrame: false },
    };
    const currentProject: StudioRendererProject = {
      ...spendableProject,
      scenes: { [blockedScene.id]: blockedScene },
    };
    const currentCatalog: StudioRouteCatalog = {
      ...readyCatalog,
      image: { ...readyCatalog.image, selectedRoute: noFirstFrameRoute, options: [noFirstFrameRoute] },
    };
    renderShell(null, {
      ...spendable(),
      project: currentProject,
      editor: { ...editor, project: currentProject },
      models: { ...models, catalog: currentCatalog },
      readiness: {
        ...spendable().readiness!,
        readySceneIds: [blockedScene.id],
      },
    });

    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes:count=0' })
    ).toBeDisabled();
  });
});

/**
 * The frame owns in-flight document work. The Board's feed and the Cut's render button are view
 * detail; the aggregate has to be legible from a view that renders neither.
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

  it('reports generation running elsewhere in the document while Table is on screen', () => {
    renderView('table', {
      jobs: { ...jobs, jobs: [job({ id: 'job-1' }), job({ id: 'job-2', status: 'queued_remote' })] },
    });

    // Guards the guard: the readout is header-owned, so it survives a view id the shell cannot
    // mount. Without this the whole suite would keep passing against an empty frame.
    expect(screen.getByRole('heading', { level: 2, name: 'conversation.creativeStudio.phase.write.title' }));
    expect(activity()).toHaveTextContent(/activityGenerating:count=2(?![\d.])/);
  });

  /**
   * The percentage is a `progressbar` value beside the live region, not text inside it: ffmpeg
   * progress arrives many times a second, and a polite atomic region would speak every step.
   */
  it('reports a cut render running elsewhere in the document while Table is on screen', () => {
    renderView('table', { render: { ...idleRender, status: 'running', progress: 0.42 } });

    const progressbar = screen.getByRole('progressbar', {
      name: 'conversation.creativeStudio.phase.shared.activityRenderingLabel',
    });
    expect(progressbar).toHaveTextContent(/activityRendering:percent=42(?![\d.])/);
    expect(progressbar).toHaveAttribute('aria-valuenow', '42');
    expect(activity()).not.toContainElement(progressbar);
  });

  it('keeps the region mounted and silent when the document has no work in flight', () => {
    renderView('table', {});

    expect(activity()).toBeEmptyDOMElement();
  });
});

/**
 * The switch is disabled while a generation review, a duplicate-charge prompt or the export modal
 * is open — precisely when a reader is most likely to have lost track of which view is behind the
 * dialog. So the active marker has to survive `disabled`, and the marker is CSS: it needs the
 * active class to still be on the element the stylesheet targets.
 *
 * jsdom does no layout and no cascade, so this asserts the structural precondition only; the
 * companion assertion on the compiled declarations lives in `studioStylesheetComposes.test.ts`.
 */
describe('StudioViewSwitch active marker while blocked', () => {
  const renderSwitch = (navigationDisabled: boolean) =>
    render(
      <StudioPhaseShell
        activeView='cut'
        controller={controller(null)}
        navigationDisabled={navigationDisabled}
        onBack={vi.fn()}
      />
    );

  const viewButton = (label: string): HTMLElement =>
    screen.getByRole('button', { name: `conversation.creativeStudio.phase.nav.${label}` });

  it.each([false, true])('keeps the active class on the button element itself (disabled: %s)', (disabled) => {
    renderSwitch(disabled);
    const active = viewButton('cut');

    // Arco puts the author className on the <button> rather than a wrapper, disabled or not. If a
    // future version wraps it, the module's `.viewButtonActive` rules would target the wrapper and
    // the marker would vanish — which is what this pins.
    expect(active.tagName).toBe('BUTTON');
    expect(active).toHaveClass(styles.viewButton!, styles.viewButtonActive!);
    expect(active).toHaveAttribute('aria-current', 'page');
    expect((active as HTMLButtonElement).disabled).toBe(disabled);
  });

  it('marks exactly one view active and leaves the others unmarked while blocked', () => {
    renderSwitch(true);

    for (const label of ['table', 'board']) {
      const inactive = viewButton(label);
      expect(inactive).not.toHaveClass(styles.viewButtonActive!);
      expect(inactive).not.toHaveAttribute('aria-current');
    }
  });
});
