/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAsset,
  StudioCommandResult,
  StudioFitStoryboardOutcome,
  StudioProposal,
  StudioReferenceRequest,
  StudioRendererJob,
  StudioRendererProject,
  StudioRenderProgressEvent,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import StudioPage from '@renderer/pages/studio/StudioPage';
import { buildFirstFramePrompt } from '@/common/types/project/creativeStudioReferencePrompt';
import { useStudioProject } from '@renderer/pages/studio/hooks';
import {
  defaultStudioView,
  parseStudioView,
  readLastStudioView,
  rememberStudioView,
  resolveStudioEntryView,
  STUDIO_VIEWS,
  type StudioView,
  studioViewPath,
} from '@renderer/pages/studio/studioPhaseRoute';

const bridge = vi.hoisted(() => ({
  hasUnsavedWork: { provider: vi.fn() },
  flushUnsavedWork: { provider: vi.fn() },
  getProject: { invoke: vi.fn() },
  listProposals: { invoke: vi.fn() },
  listPendingReferenceRequests: { invoke: vi.fn() },
  dismissReferenceRequests: { invoke: vi.fn() },
  listRoutes: { invoke: vi.fn() },
  updateModelSelection: { invoke: vi.fn() },
  updateProject: { invoke: vi.fn() },
  undoBriefRules: { invoke: vi.fn() },
  updateScene: { invoke: vi.fn() },
  reorderScenes: { invoke: vi.fn() },
  proposeStoryboard: { invoke: vi.fn() },
  chooseAndImportReference: { invoke: vi.fn() },
  renderCut: { invoke: vi.fn() },
  cancelRender: { invoke: vi.fn() },
  fitStoryboard: { invoke: vi.fn() },
  submitScenes: { invoke: vi.fn() },
  cancelJob: { invoke: vi.fn() },
  retryJob: { invoke: vi.fn() },
  retryDownload: { invoke: vi.fn() },
  selectAsset: { invoke: vi.fn() },
  listConnectionCandidates: { invoke: vi.fn() },
  listConnections: { invoke: vi.fn() },
  validateConnection: { invoke: vi.fn() },
  saveConnection: { invoke: vi.fn() },
  removeConnection: { invoke: vi.fn() },
  projectUpdated: { on: vi.fn() },
  proposalUpdated: { on: vi.fn() },
  renderProgress: { on: vi.fn() },
  turnCompleted: { on: vi.fn() },
}));

const briefConversationHarness = vi.hoisted(() => ({
  state: { kind: 'absent' } as const,
  errorMessageKey: null as string | null,
  recreate: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: bridge,
    conversation: { turnCompleted: bridge.turnCompleted },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => briefConversationHarness,
}));

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const failure = <T,>(): StudioCommandResult<T> => ({
  ok: false,
  error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
});
const stale = <T,>(): StudioCommandResult<T> => ({
  ok: false,
  error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
});
/** What main answers a submit it refuses outright — `invalid_request` reaches the renderer as this. */
const invalidPayload = <T,>(): StudioCommandResult<T> => ({
  ok: false,
  error: { code: 'invalid_payload', messageKey: 'conversation.creativeStudio.errors.invalidPayload' },
});

const project = (id = 'project-1', overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 2,
  id,
  name: id === 'project-1' ? 'Launch film' : 'Second film',
  brief: 'A short launch video',
  rules: [],
  ruleListUndo: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: {
    storyboard: null,
    image: {
      choiceId: 'choice_image',
      providerId: 'provider-image',
      model: 'image-model',
    },
    video: null,
  },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-1',
  title: 'Opening',
  purpose: 'Introduce the story',
  visualPrompt: 'A bright studio',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
  ...overrides,
});

const job = (id: string, overrides: Partial<StudioRendererJob> = {}): StudioRendererJob => ({
  id,
  projectId: 'project-1',
  sceneId: 'scene-1',
  status: 'succeeded',
  provider: {
    choiceId: 'choice_image',
    providerId: 'provider-image',
    model: 'image-model',
  },
  outputAssetIds: [],
  error: null,
  canRetryDownload: false,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const asset = (id: string): StudioAsset => ({
  id,
  projectId: 'project-1',
  sceneId: 'scene-1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 128,
  sha256: id.padEnd(64, 'a').slice(0, 64),
  createdAt: '2026-07-30T00:00:00.000Z',
});

const routes = (): StudioRouteCatalog => ({
  storyboard: {
    status: 'ready',
    selected: { providerId: 'provider-1', model: 'operations-model' },
    options: [
      {
        providerId: 'provider-1',
        providerName: 'Provider',
        model: 'operations-model',
        health: 'available',
      },
    ],
  },
  image: { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  video: { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  catalogVersion: 'catalog-1',
});

const proposal = (): StudioProposal => ({
  schemaVersion: 1,
  id: 'proposal_1',
  projectId: 'project-1',
  status: 'pending',
  baseRevision: 2,
  payload: {
    kind: 'replace_storyboard',
    sceneOrder: ['scene-proposed'],
    scenes: {
      'scene-proposed': {
        title: 'Observed proposal',
        purpose: 'Prove renderer observation',
        visualPrompt: 'A durable proposal appears',
        narration: '',
        onScreenText: '',
        mediaKind: 'image',
        durationSeconds: 5,
        referenceAssetId: null,
      },
    },
  },
  createdAt: '2026-08-06T00:00:00.000Z',
  decidedAt: null,
});

const referenceRequest = (sceneId: string, index: number): StudioReferenceRequest => ({
  schemaVersion: 1,
  id: `reference_request_${index}`,
  projectId: 'project-1',
  sceneId,
  status: 'pending',
  createdAt: `2026-08-11T00:00:0${index}.000Z`,
});

const imageRoute = (overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: 'choice_image',
  providerId: 'provider-image',
  providerName: 'Image provider',
  model: 'image-model',
  integrationLabelKey: 'imageApi',
  health: 'available',
  kind: 'image',
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: true,
  },
  ...overrides,
});

const routesWithImage = (route = imageRoute()): StudioRouteCatalog => ({
  ...routes(),
  image: {
    status: 'ready',
    selected: {
      choiceId: route.choiceId,
      providerId: route.providerId,
      model: route.model,
    },
    selectedRoute: route,
    selectionIssue: null,
    options: [route],
  },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

/**
 * The queued reference requests as main keeps them: on disk, read back by
 * `listPendingReferenceRequests` and removed by `dismissReferenceRequests`.
 *
 * A fixed `mockResolvedValue` cannot express that, and the difference is exactly what decides
 * whether a remount pays for the same plate a second time — the renderer's de-dup sets are refs
 * inside a shell React remounts per project, so this queue is the only record that outlives it.
 */
const installReferenceRequestQueue = (
  initial: readonly StudioReferenceRequest[]
): {
  queue: (request: StudioReferenceRequest) => void;
  remove: (requestId: string) => void;
  replace: (request: StudioReferenceRequest) => void;
  pendingIds: () => string[];
} => {
  let pending: StudioReferenceRequest[] = [...initial];
  bridge.listPendingReferenceRequests.invoke.mockImplementation(async () => ok([...pending]));
  bridge.dismissReferenceRequests.invoke.mockImplementation(async ({ requestIds }: { requestIds: string[] }) => {
    pending = pending.filter((request) => !requestIds.includes(request.id));
    return ok(true);
  });
  return {
    queue: (request) => {
      pending = [...pending, request];
    },
    remove: (requestId) => {
      pending = pending.filter((request) => request.id !== requestId);
    },
    replace: (replacement) => {
      pending = pending.map((request) => (request.id === replacement.id ? replacement : request));
    },
    pendingIds: () => pending.map(({ id }) => id),
  };
};

const renderRoute = (path: string | { pathname: string; state?: unknown } = '/studio/project-1/table') => {
  const router = createMemoryRouter([{ path: '/studio/:id/:view?', element: <StudioPage /> }], {
    initialEntries: [path],
  });
  return { router, view: render(<RouterProvider router={router} />) };
};

type StudioTestRouter = ReturnType<typeof createMemoryRouter>;

const selectStudioView = async (router: StudioTestRouter, view: StudioView): Promise<void> => {
  const expectedPath = studioViewPath('project-1', view);
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
      'button',
      { name: `conversation.creativeStudio.phase.nav.${view}` }
    )
  );

  await waitFor(() => expect(router.state.location.pathname).toBe(expectedPath));
  await act(async () => {});

  expect(
    within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
      'button',
      { current: 'page' }
    )
  ).toHaveTextContent(`conversation.creativeStudio.phase.nav.${view}`);
};

type ResizeObservation = {
  callback: ResizeObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
  observer: ResizeObserver;
  target: Element | null;
};

const installResizeObserverMock = (): {
  observations: ResizeObservation[];
  resize: (width: number) => void;
} => {
  const observations: ResizeObservation[] = [];

  class ResizeObserverMock implements ResizeObserver {
    readonly observation: ResizeObservation;

    constructor(callback: ResizeObserverCallback) {
      this.observation = {
        callback,
        disconnect: vi.fn(),
        observer: this,
        target: null,
      };
      observations.push(this.observation);
    }

    disconnect(): void {
      this.observation.disconnect();
    }

    observe(target: Element): void {
      this.observation.target = target;
    }

    takeRecords(): ResizeObserverEntry[] {
      return [];
    }

    unobserve(): void {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  return {
    observations,
    resize: (width) => {
      const observation = observations[0];
      if (observation?.target === null || observation === undefined) {
        throw new Error('Studio layout container was not observed');
      }
      observation.callback(
        [{ target: observation.target, contentRect: { width } } as ResizeObserverEntry],
        observation.observer
      );
    },
  };
};

/**
 * The document's single paid entry point, and the box that holds it with its advisory.
 *
 * Two facts, deliberately expressed as `expect` rather than `throw`: a helper that throws reports a
 * moved control as an opaque error at whichever test called it first, so the diff a reader needs —
 * where the button actually is — never reaches the output. The uniqueness check matters most:
 * `submitScenes` is the only spend in Studio, and a second visible entry point is the bug this
 * whole placement exists to prevent.
 */
const findBatchAction = async (): Promise<{ batchAction: HTMLElement; batchControl: HTMLElement }> => {
  await waitFor(() =>
    expect(
      document.querySelector('[data-studio-batch-control]'),
      'Studio must expose one batch-generation action'
    ).not.toBeNull()
  );
  const batchControls = document.querySelectorAll<HTMLElement>('[data-studio-batch-control]');
  expect(batchControls, 'Studio must expose exactly one batch-generation action').toHaveLength(1);
  const batchControl = batchControls[0]!;
  const batchButtons = within(batchControl).getAllByRole('button');
  expect(batchButtons, 'The batch control must expose exactly one paid action').toHaveLength(1);
  const batchAction = batchButtons[0]!;
  expect(
    batchControl.closest('[data-studio-phase-actions]'),
    'Batch generation must stay in the top bar rather than inside a view'
  ).not.toBeNull();
  return { batchAction, batchControl };
};

const ProjectHookHarness: React.FC = () => {
  const { project: currentProject, proposals, refetch } = useStudioProject('project-1');

  return (
    <>
      <span>{currentProject?.name}</span>
      <span>{proposals.map((candidate) => candidate.payload.scenes[candidate.payload.sceneOrder[0]!]?.title)}</span>
      <button type='button' onClick={() => void refetch()}>
        Refetch project
      </button>
    </>
  );
};

describe('StudioPage and useStudioProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
    bridge.getProject.invoke.mockResolvedValue(ok(project()));
    bridge.listProposals.invoke.mockResolvedValue(ok([]));
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok([]));
    bridge.dismissReferenceRequests.invoke.mockResolvedValue(ok(true));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    bridge.updateModelSelection.invoke.mockResolvedValue(ok(project()));
    bridge.updateProject.invoke.mockImplementation(async () => ok(project()));
    bridge.undoBriefRules.invoke.mockImplementation(async () => ok(project()));
    bridge.updateScene.invoke.mockImplementation(async () => ok(project()));
    bridge.reorderScenes.invoke.mockImplementation(async () => ok(project()));
    bridge.proposeStoryboard.invoke.mockImplementation(async () => ok(project()));
    bridge.chooseAndImportReference.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    bridge.renderCut.invoke.mockResolvedValue(ok({ assetId: 'render-1', missingSceneIds: [] }));
    bridge.cancelRender.invoke.mockResolvedValue(ok({ cancelled: true }));
    bridge.fitStoryboard.invoke.mockResolvedValue(
      ok<StudioFitStoryboardOutcome>({
        status: 'already_matches',
        project: project(),
        changedSceneIds: [],
        lockedSceneIds: [],
      })
    );
    bridge.submitScenes.invoke.mockResolvedValue(ok([]));
    bridge.cancelJob.invoke.mockResolvedValue(failure());
    bridge.retryJob.invoke.mockResolvedValue(failure());
    bridge.retryDownload.invoke.mockResolvedValue(failure());
    bridge.selectAsset.invoke.mockResolvedValue(failure());
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([]));
    bridge.listConnections.invoke.mockResolvedValue(ok([]));
    bridge.validateConnection.invoke.mockResolvedValue(failure());
    bridge.saveConnection.invoke.mockResolvedValue(failure());
    bridge.removeConnection.invoke.mockResolvedValue(failure());
    bridge.projectUpdated.on.mockReturnValue(() => {});
    bridge.proposalUpdated.on.mockReturnValue(() => {});
    bridge.renderProgress.on.mockReturnValue(() => {});
    bridge.turnCompleted.on.mockReturnValue(() => {});
    bridge.hasUnsavedWork.provider.mockReturnValue(() => {});
    bridge.flushUnsavedWork.provider.mockReturnValue(() => {});
    briefConversationHarness.errorMessageKey = null;
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Studio view routes', () => {
    it.each([...STUDIO_VIEWS])('accepts %s as a canonical Studio view', (view) => {
      expect(parseStudioView(view)).toBe(view);
    });

    // The retired phase vocabulary is rejected, not remapped: it is what real localStorage values
    // and real bookmarks still carry, and the graceful path for them is the entry redirect below.
    it.each([undefined, '', 'bogus', 'TABLE', 'brief', 'write', 'produce', 'review'])(
      'rejects %s as a Studio view',
      (view) => {
        expect(parseStudioView(view)).toBeNull();
      }
    );

    it('encodes project ids in canonical view paths', () => {
      expect(studioViewPath('project / 1', 'cut')).toBe('/studio/project%20%2F%201/cut');
    });

    it('treats unavailable storage as no saved Studio view', () => {
      const inaccessibleStorage = {
        getItem: () => {
          throw new Error('storage unavailable');
        },
      } as Storage;

      expect(readLastStudioView('project-1', inaccessibleStorage)).toBeNull();
    });

    it('does not throw when remembering a Studio view fails', () => {
      const inaccessibleStorage = {
        setItem: () => {
          throw new Error('quota exceeded');
        },
      } as Storage;

      expect(() => rememberStudioView('project-1', 'table', inaccessibleStorage)).not.toThrow();
    });

    it('opens a project on Table', () => {
      expect(defaultStudioView()).toBe('table');
    });

    it('prefers the saved Studio view over the default', () => {
      window.localStorage.setItem('aionui:creative-studio:last-view:project-1', 'cut');

      expect(resolveStudioEntryView('project-1')).toBe('cut');
    });

    it('falls back to the default when the saved value is a retired phase name', () => {
      window.localStorage.setItem('aionui:creative-studio:last-view:project-1', 'produce');

      expect(resolveStudioEntryView('project-1')).toBe('table');
    });

    it('falls back to Table when the saved view is the retired Brief route', () => {
      window.localStorage.setItem('aionui:creative-studio:last-view:project-1', 'brief');

      expect(resolveStudioEntryView('project-1')).toBe('table');
    });

    it('opens the Brief drawer over Table only when creation supplies the renderer intent', async () => {
      const { router } = renderRoute({ pathname: '/studio/project-1/table', state: { openBrief: true } });

      const dialog = await screen.findByRole('dialog', {
        name: 'conversation.creativeStudio.phase.brief.title',
      });
      expect(router.state.location.pathname).toBe('/studio/project-1/table');
      expect(
        within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
          'button',
          { current: 'page' }
        )
      ).toHaveTextContent('conversation.creativeStudio.phase.nav.table');
    });

    it('flushes a just-typed brief before closing the drawer', async () => {
      renderRoute({ pathname: '/studio/project-1/table', state: { openBrief: true } });
      const dialog = await screen.findByRole('dialog', {
        name: 'conversation.creativeStudio.phase.brief.title',
      });
      const brief = within(dialog).getByLabelText('conversation.creativeStudio.project.brief');

      fireEvent.change(brief, { target: { value: 'A last-second drawer edit' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'common.close' }));

      await waitFor(() =>
        expect(bridge.updateProject.invoke).toHaveBeenCalledWith(
          expect.objectContaining({ brief: 'A last-second drawer edit' })
        )
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it.each([...STUDIO_VIEWS])('renders the Studio page at the %s view route', async (view) => {
      renderRoute(`/studio/project-1/${view}`);

      expect(await screen.findByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
    });

    it('remembers a directly routed Cut view for the next project entry', async () => {
      const firstVisit = renderRoute('/studio/project-1/cut');
      await screen.findByRole('heading', {
        level: 2,
        name: 'conversation.creativeStudio.phase.review.title',
      });
      await waitFor(() => expect(readLastStudioView('project-1')).toBe('cut'));
      firstVisit.view.unmount();

      const { router } = renderRoute('/studio/project-1');

      await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/cut'));
    });

    it.each([
      ['table', 'conversation.creativeStudio.phase.write.title', null],
      ['board', 'conversation.creativeStudio.phase.produce.connectEngine', null],
      [
        'cut',
        'conversation.creativeStudio.phase.review.title',
        'conversation.creativeStudio.phase.review.handoffDescription',
      ],
    ])('renders the localized %s view heading and guidance', async (view, heading, guidance) => {
      renderRoute(`/studio/project-1/${view}`);

      expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
      if (guidance !== null) expect(screen.getByText(guidance)).toBeInTheDocument();
    });

    it('skips missing scene ids instead of crashing the Studio shell', async () => {
      const opening = scene();
      bridge.getProject.invoke.mockResolvedValue(
        ok(
          project('project-1', {
            sceneOrder: [opening.id, 'missing-scene'],
            scenes: { [opening.id]: opening },
          })
        )
      );

      renderRoute('/studio/project-1/cut');

      expect(
        await screen.findByRole('heading', { level: 2, name: 'conversation.creativeStudio.phase.review.title' })
      ).toBeInTheDocument();
    });

    it('renders a missing-asset Review slate without claiming slates are handed off', async () => {
      const missingScene = scene({ title: 'Missing close', durationSeconds: 7 });
      bridge.getProject.invoke.mockResolvedValue(
        ok(
          project('project-1', {
            targetDurationSeconds: missingScene.durationSeconds,
            sceneOrder: [missingScene.id],
            scenes: { [missingScene.id]: missingScene },
            cuts: {
              'cut-1': {
                id: 'cut-1',
                name: 'Launch film',
                orderMode: 'storyboard',
                clipOrder: [],
                clips: {},
              },
            },
            activeCutId: 'cut-1',
          })
        )
      );
      renderRoute('/studio/project-1/cut');

      const preview = await screen.findByRole('region', { name: 'conversation.creativeStudio.preview.title' });
      expect(within(preview).getByText('Missing close')).toBeVisible();
      expect(within(preview).getByText('conversation.creativeStudio.scene.durationSeconds')).toBeVisible();
      expect(within(preview).getByText('conversation.creativeStudio.phase.review.slateDescription')).toBeVisible();
      expect(within(preview).getByText('conversation.creativeStudio.phase.review.excludedFromHandoff')).toBeVisible();
      expect(screen.getByText('conversation.creativeStudio.phase.review.handoffDescription')).toBeVisible();
      expect(screen.queryByText('conversation.creativeStudio.export.body')).toBeNull();
    });

    it('renders one localized view switch with the routed view current', async () => {
      renderRoute('/studio/project-1/table');

      const viewSwitch = await screen.findByRole('navigation', {
        name: 'conversation.creativeStudio.phase.nav.viewsLabel',
      });
      const actions = within(viewSwitch).getAllByRole('button');

      expect(actions).toHaveLength(STUDIO_VIEWS.length);
      for (const view of STUDIO_VIEWS) {
        expect(
          within(viewSwitch).getByRole('button', {
            name: `conversation.creativeStudio.phase.nav.${view}`,
          })
        ).toBeVisible();
      }
      expect(within(viewSwitch).getByRole('button', { current: 'page' })).toHaveTextContent(
        'conversation.creativeStudio.phase.nav.table'
      );
      // A switch has no sequence to be part of, so no segment claims a position in one.
      expect(within(viewSwitch).queryByRole('button', { current: 'step' })).not.toBeInTheDocument();
    });

    it('shares one measured Studio layout across every view without observing the viewport', async () => {
      const { observations, resize } = installResizeObserverMock();
      const { router, view } = renderRoute('/studio/project-1/table');

      await screen.findByRole('navigation', {
        name: 'conversation.creativeStudio.phase.nav.viewsLabel',
      });
      expect(observations).toHaveLength(1);
      const layoutRoot = observations[0]!.target;
      expect(layoutRoot).toHaveAttribute('data-studio-layout-root');
      expect(layoutRoot).not.toBe(document.documentElement);
      expect(layoutRoot).not.toBe(document.body);

      act(() => resize(1121));
      expect(layoutRoot).toHaveAttribute('data-layout', 'inline');

      const headingKeys: Record<StudioView, string> = {
        table: 'conversation.creativeStudio.phase.write.title',
        board: 'conversation.creativeStudio.phase.produce.connectEngine',
        cut: 'conversation.creativeStudio.phase.review.title',
      };
      const expectSharedViewLayout = async (target: StudioView): Promise<void> => {
        if (router.state.location.pathname !== `/studio/project-1/${target}`) {
          await selectStudioView(router, target);
          await waitFor(() => expect(router.state.location.pathname).toBe(`/studio/project-1/${target}`));
        }
        const heading = await screen.findByRole('heading', {
          level: 2,
          name: headingKeys[target],
        });
        expect(heading.closest('[data-layout]')).toHaveAttribute('data-layout', 'inline');
        expect(observations).toHaveLength(1);
      };
      await expectSharedViewLayout('table');
      await expectSharedViewLayout('board');
      await expectSharedViewLayout('cut');

      act(() => resize(1120));
      expect(layoutRoot).toHaveAttribute('data-layout', 'drawer');
      act(() => resize(821));
      expect(layoutRoot).toHaveAttribute('data-layout', 'drawer');
      act(() => resize(820));
      expect(layoutRoot).toHaveAttribute('data-layout', 'compact');

      view.unmount();
      expect(observations[0]!.disconnect).toHaveBeenCalledOnce();
    });

    /**
     * D10 removed Write's own writing assistant, so the Director's overlay is the only Drawer the
     * page may put up. This used to cover the assistant's own focus recovery across the same two
     * thresholds; what is worth guarding now is that no second assistant surface comes back at any
     * of the three measured widths, since the whole point of removing it was that the Director is
     * always beside the work panel already.
     */
    it('puts up no assistant surface of its own at any measured width', async () => {
      const opening = scene();
      bridge.getProject.invoke.mockResolvedValue(
        ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
      );
      const { resize } = installResizeObserverMock();
      renderRoute('/studio/project-1/table');

      await screen.findByRole('heading', {
        level: 2,
        name: 'conversation.creativeStudio.phase.write.title',
      });

      for (const width of [820, 1121, 1120]) {
        act(() => resize(width));
        // Guards the guard: the phase really is mounted at this width.
        expect(
          screen.getByRole('region', { name: 'conversation.creativeStudio.phase.write.scriptTableTitle' }),
          `${width}px`
        ).toBeInTheDocument();
        // Scoped to non-Director drawers: the Director pane renders in an Arco Drawer below inline
        // width, and that one stays mounted on purpose so a streaming reply survives being hidden.
        // Counting every .arco-drawer would assert the opposite of what the shell guarantees.
        const assistantDrawers = [...document.querySelectorAll('.arco-drawer')].filter(
          (drawer) => drawer.querySelector('[data-studio-director]') === null
        );
        expect(assistantDrawers, `${width}px`).toHaveLength(0);
        expect(
          screen.queryByRole('complementary', { name: 'conversation.creativeStudio.phase.write.assistantTitle' }),
          `${width}px`
        ).not.toBeInTheDocument();
      }
    });

    it('renders only the active view and keeps project owners mounted across clean view changes', async () => {
      const opening = scene();
      bridge.getProject.invoke.mockResolvedValue(
        ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
      );
      const { router } = renderRoute('/studio/project-1/table');

      const tableHeading = await screen.findByRole('heading', {
        level: 2,
        name: 'conversation.creativeStudio.phase.write.title',
      });
      expect(
        screen.queryByRole('heading', { level: 2, name: 'conversation.creativeStudio.phase.review.title' })
      ).toBeNull();
      const loadCount = bridge.getProject.invoke.mock.calls.length;

      await selectStudioView(router, 'cut');

      await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/cut'));
      const cutHeading = (
        await screen.findAllByRole('heading', {
          level: 2,
          name: 'conversation.creativeStudio.phase.review.title',
        })
      )[0]!;
      await waitFor(() => expect(document.activeElement).toBe(cutHeading));
      expect(tableHeading).not.toBeInTheDocument();
      expect(bridge.getProject.invoke).toHaveBeenCalledTimes(loadCount);
    });

    it('flushes multiple dirty scenes in serialized order before changing phase', async () => {
      const opening = scene({ id: 'scene-1', title: 'Opening' });
      const closing = scene({ id: 'scene-2', title: 'Closing' });
      const initial = project('project-1', {
        sceneOrder: [opening.id, closing.id],
        scenes: { [opening.id]: opening, [closing.id]: closing },
      });
      const afterFirst = project('project-1', {
        revision: 3,
        sceneOrder: [opening.id, closing.id],
        scenes: { [opening.id]: { ...opening, title: 'Opening v2' }, [closing.id]: closing },
      });
      const afterSecond = project('project-1', {
        revision: 4,
        sceneOrder: [opening.id, closing.id],
        scenes: {
          [opening.id]: { ...opening, title: 'Opening v2' },
          [closing.id]: { ...closing, title: 'Closing v2' },
        },
      });
      const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
      bridge.getProject.invoke.mockResolvedValue(ok(initial));
      bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(ok(afterSecond));
      const { router } = renderRoute('/studio/project-1/table');

      const titleInputs = await screen.findAllByLabelText('conversation.creativeStudio.inspector.titleLabel');
      fireEvent.change(titleInputs[0]!, {
        target: { value: 'Opening v2' },
      });
      fireEvent.change(titleInputs[1]!, {
        target: { value: 'Closing v2' },
      });
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
          'button',
          {
            name: 'conversation.creativeStudio.phase.nav.board',
          }
        )
      );

      await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
      expect(router.state.location.pathname).toBe('/studio/project-1/table');
      expect(bridge.updateScene.invoke.mock.calls[0]?.[0]).toMatchObject({
        sceneId: 'scene-1',
        expectedRevision: 2,
      });

      await act(async () => firstSave.resolve(ok(afterFirst)));
      await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2));
      expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
        sceneId: 'scene-2',
        expectedRevision: 3,
      });
      await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/board'));
    });

    it('re-flushes a scene edited during transition saving before changing phase', async () => {
      const opening = scene({ title: 'Opening' });
      const initial = project('project-1', {
        sceneOrder: [opening.id],
        scenes: { [opening.id]: opening },
      });
      const afterFirst = project('project-1', {
        revision: 3,
        sceneOrder: [opening.id],
        scenes: { [opening.id]: { ...opening, title: 'First edit' } },
      });
      const afterSecond = project('project-1', {
        revision: 4,
        sceneOrder: [opening.id],
        scenes: { [opening.id]: { ...opening, title: 'Newer edit' } },
      });
      const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
      bridge.getProject.invoke.mockResolvedValue(ok(initial));
      bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(ok(afterSecond));
      const { router } = renderRoute('/studio/project-1/table');
      const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');

      fireEvent.change(titleInput, { target: { value: 'First edit' } });
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
          'button',
          { name: 'conversation.creativeStudio.phase.nav.board' }
        )
      );
      await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

      fireEvent.change(titleInput, { target: { value: 'Newer edit' } });
      await act(async () => firstSave.resolve(ok(afterFirst)));

      await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2));
      expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
        sceneId: opening.id,
        expectedRevision: 3,
        scene: expect.objectContaining({ title: 'Newer edit' }),
      });
      await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/board'));
    });

    it('shows a retryable message after three transition rounds keep getting dirtied', async () => {
      const opening = scene({ title: 'Opening' });
      const initial = project('project-1', {
        sceneOrder: [opening.id],
        scenes: { [opening.id]: opening },
      });
      const savedVersions = ['First edit', 'Second edit', 'Third edit'].map((title, index) =>
        project('project-1', {
          revision: index + 3,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: { ...opening, title } },
        })
      );
      const saves = [
        deferred<StudioCommandResult<StudioRendererProject>>(),
        deferred<StudioCommandResult<StudioRendererProject>>(),
        deferred<StudioCommandResult<StudioRendererProject>>(),
      ];
      bridge.getProject.invoke.mockResolvedValue(ok(initial));
      for (const save of saves) bridge.updateScene.invoke.mockReturnValueOnce(save.promise);
      const { router } = renderRoute('/studio/project-1/table');

      fireEvent.change(await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel'), {
        target: { value: 'First edit' },
      });
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
          'button',
          { name: 'conversation.creativeStudio.phase.nav.board' }
        )
      );

      for (const [index, nextTitle] of ['Second edit', 'Third edit', 'Fourth edit'].entries()) {
        await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(index + 1));
        fireEvent.change(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel'), {
          target: { value: nextTitle },
        });
        await act(async () => saves[index]!.resolve(ok(savedVersions[index]!)));
      }

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('conversation.creativeStudio.transition.savingBlocked');
      expect(router.state.location.pathname).toBe('/studio/project-1/table');
      expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(3);
      expect(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveValue('Fourth edit');
      expect(
        within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
          'button',
          { name: 'conversation.creativeStudio.phase.nav.board' }
        )
      ).toBeEnabled();
    });

    it('keeps a failed phase-transition draft recoverable and focuses its alert', async () => {
      const opening = scene();
      bridge.getProject.invoke.mockResolvedValue(
        ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
      );
      bridge.updateScene.invoke.mockResolvedValueOnce(stale());
      const { router } = renderRoute('/studio/project-1/table');
      const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');

      fireEvent.change(titleInput, { target: { value: 'Recoverable local title' } });
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
          'button',
          {
            name: 'conversation.creativeStudio.phase.nav.board',
          }
        )
      );

      const recoverableRow = await screen.findByRole('region', { name: 'Recoverable local title' });
      expect(
        within(recoverableRow).getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' })
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/studio/project-1/table');
      expect(within(recoverableRow).getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveValue(
        'Recoverable local title'
      );
      await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'alert'));
    });

    it('recovers focus onto the work panel, never onto an alert in the Director pane', async () => {
      const opening = scene();
      // Paced to the target so the shell advisory stays silent and the only alert in the work
      // panel is the one that explains the refused transition.
      bridge.getProject.invoke.mockResolvedValue(
        ok(
          project('project-1', {
            targetDurationSeconds: opening.durationSeconds,
            sceneOrder: [opening.id],
            scenes: { [opening.id]: opening },
          })
        )
      );
      bridge.updateScene.invoke.mockResolvedValueOnce(stale());
      briefConversationHarness.errorMessageKey = 'conversation.creativeStudio.errors.storage';
      const { resize } = installResizeObserverMock();
      const { router } = renderRoute('/studio/project-1/table');
      const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
      act(() => resize(1121));

      const directorPane = document.querySelector('[data-studio-director]');
      const workPanel = document.querySelector('[data-studio-work-panel]');
      if (directorPane === null || workPanel === null) throw new Error('Studio must render both panes inline');
      // The defect is positional: the Director pane is rendered before the work panel, so the
      // first `[role="alert"]` in the document is whatever the Director happens to be saying.
      const directorAlert = within(directorPane as HTMLElement).getByRole('alert');
      expect(directorPane.compareDocumentPosition(workPanel) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

      fireEvent.change(titleInput, { target: { value: 'Recoverable local title' } });
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
          'button',
          { name: 'conversation.creativeStudio.phase.nav.board' }
        )
      );

      await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'alert'));
      expect(document.activeElement).not.toBe(directorAlert);
      expect(workPanel.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toHaveTextContent('conversation.creativeStudio.errors.staleProject');
      expect(router.state.location.pathname).toBe('/studio/project-1/table');
    });

    it('moves a Brief save failure from the drawer to one shell alert when the drawer closes', async () => {
      bridge.updateProject.invoke.mockResolvedValueOnce(failure());
      const { router } = renderRoute('/studio/project-1/table');
      fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.phase.brief.title' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'conversation.creativeStudio.phase.brief.title',
      });
      const durationInput = within(dialog).getByLabelText('conversation.creativeStudio.phase.brief.durationLabel');

      fireEvent.change(durationInput, { target: { value: '24' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'common.close' }));

      await waitFor(() => expect(bridge.updateProject.invoke).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() =>
        expect(document.querySelector('[data-studio-phase-shell] > [role="alert"]')).toHaveTextContent(
          'conversation.creativeStudio.errors.storage'
        )
      );
      expect(router.state.location.pathname).toBe('/studio/project-1/table');
    });

    it('renders a project-update conflict in the drawer while open and in the shell after close', async () => {
      bridge.updateProject.invoke.mockResolvedValueOnce(stale());
      renderRoute('/studio/project-1/table');
      fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.phase.brief.title' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'conversation.creativeStudio.phase.brief.title',
      });
      const durationInput = within(dialog).getByLabelText('conversation.creativeStudio.phase.brief.durationLabel');

      fireEvent.change(durationInput, { target: { value: '24' } });
      fireEvent.blur(durationInput);

      await waitFor(() =>
        expect(within(dialog).getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.staleProject')
      );
      expect(document.querySelector('[data-studio-phase-shell] > [role="alert"]')).not.toHaveTextContent(
        'conversation.creativeStudio.errors.staleProject'
      );

      fireEvent.click(within(dialog).getByRole('button', { name: 'common.close' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(document.querySelector('[data-studio-phase-shell] > [role="alert"]')).toHaveTextContent(
        'conversation.creativeStudio.errors.staleProject'
      );
    });

    it('focuses and clears only a valid typed Write focus intent', async () => {
      const opening = scene();
      bridge.getProject.invoke.mockResolvedValue(
        ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
      );
      const { router } = renderRoute({
        pathname: '/studio/project-1/table',
        state: { writeFocus: { sceneId: opening.id, field: 'visualPrompt' } },
      });

      const prompt = await screen.findByLabelText('conversation.creativeStudio.inspector.visualPromptLabel');
      await waitFor(() => expect(document.activeElement).toBe(prompt));
      expect(router.state.location.pathname).toBe('/studio/project-1/table');
      expect(router.state.location.state).toBeNull();
    });

    it('retains a valid Write focus intent until the requested field is available and focused', async () => {
      const opening = scene();
      const catalogLoad = deferred<StudioCommandResult<StudioRouteCatalog>>();
      bridge.getProject.invoke.mockResolvedValue(
        ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
      );
      bridge.listRoutes.invoke.mockReturnValueOnce(catalogLoad.promise);
      const realGetElementById = document.getElementById.bind(document);
      let promptAvailable = false;
      vi.spyOn(document, 'getElementById').mockImplementation((elementId) =>
        elementId === `studio-scene-prompt-${opening.id}` && !promptAvailable ? null : realGetElementById(elementId)
      );
      const writeFocus = { sceneId: opening.id, field: 'visualPrompt' as const };
      const { router } = renderRoute({
        pathname: '/studio/project-1/table',
        state: { writeFocus },
      });

      const prompt = await screen.findByLabelText('conversation.creativeStudio.inspector.visualPromptLabel');
      expect(router.state.location.state).toEqual({ writeFocus });
      expect(document.activeElement).not.toBe(prompt);

      promptAvailable = true;
      await act(async () => catalogLoad.resolve(ok(routes())));

      await waitFor(() => expect(document.activeElement).toBe(prompt));
      expect(router.state.location.state).toBeNull();
    });

    it('clears a Write focus intent immediately when its scene is not in the project', async () => {
      const opening = scene();
      bridge.getProject.invoke.mockResolvedValue(
        ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
      );
      const { router } = renderRoute({
        pathname: '/studio/project-1/table',
        state: { writeFocus: { sceneId: 'missing-scene', field: 'visualPrompt' } },
      });

      await screen.findByLabelText('conversation.creativeStudio.inspector.visualPromptLabel');
      await waitFor(() => expect(router.state.location.state).toBeNull());
    });

    it('replaces a legacy project route with its canonical default view', async () => {
      const { router } = renderRoute('/studio/project-1');

      await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/table'));
    });

    // A bookmark or a stale in-flight URL from before the switch lands here. It must resolve to a
    // real view, not fall through the Studio route to the chat workspace.
    it.each(['bogus', 'brief', 'write', 'produce', 'review'])(
      'replaces the invalid segment %s without falling through to Guid',
      async (segment) => {
        const { router } = renderRoute(`/studio/project-1/${segment}`);

        await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/table'));
        expect(router.state.location.pathname).not.toBe('/guid');
      }
    );
  });

  it('adopts the project returned after undo so the rules drawer and pin input receive the restored list', async () => {
    const addedRule = {
      id: 'rule_1',
      scope: 'project' as const,
      text: 'Keep the kits generic.',
      predicate: null,
      createdAt: '2026-08-13T00:00:00.000Z',
    };
    const ruled = project('project-1', {
      rules: [addedRule],
      ruleListUndo: { capturedRevision: 1, previousRules: [] },
    });
    const restored = project('project-1', { revision: 3, rules: [], ruleListUndo: null });
    bridge.getProject.invoke.mockResolvedValue(ok(ruled));
    bridge.undoBriefRules.invoke.mockImplementation(async () => {
      bridge.getProject.invoke.mockResolvedValue(ok(restored));
      return ok(restored);
    });
    renderRoute('/studio/project-1/table');

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.rules.open' }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.rules.undo' }));

    await waitFor(() =>
      expect(bridge.undoBriefRules.invoke).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-1' })
    );
    await waitFor(() => expect(bridge.getProject.invoke.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole('button', { name: 'conversation.creativeStudio.rules.undo' })).not.toBeInTheDocument();
  });

  describe('Cut render progress at project scope', () => {
    let emitRenderProgress: ((event: StudioRenderProgressEvent) => void) | undefined;

    beforeEach(() => {
      emitRenderProgress = undefined;
      bridge.renderProgress.on.mockImplementation((listener: (event: StudioRenderProgressEvent) => void) => {
        emitRenderProgress = listener;
        return () => {
          if (emitRenderProgress === listener) emitRenderProgress = undefined;
        };
      });
    });

    it('keeps an in-flight cut render observable while the user works in another phase', async () => {
      // The render never settles, so the only thing that can move its progress is the event
      // stream - which a view-scoped subscription would have torn down on leaving Review.
      bridge.renderCut.invoke.mockReturnValue(new Promise(() => {}));
      const { router } = renderRoute('/studio/project-1/cut');

      fireEvent.click(
        await screen.findByRole('button', { name: 'conversation.creativeStudio.phase.review.render.action' })
      );
      expect(
        screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.progress' })
      ).toBeDisabled();

      await selectStudioView(router, 'board');
      act(() =>
        emitRenderProgress?.({
          projectId: 'project-1',
          status: 'running',
          progress: 0.42,
          clipIndex: 2,
          clipTotal: 3,
        })
      );
      await selectStudioView(router, 'cut');

      const action = await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.render.progressWithClip',
      });
      expect(action).toBeDisabled();
      expect(action.closest('[data-render-state-slot]')).toHaveAttribute('data-render-state', 'running');
    });

    it('subscribes to render progress once for the project rather than once per Review visit', async () => {
      const { router } = renderRoute('/studio/project-1/cut');
      await screen.findByRole('heading', { level: 2, name: 'conversation.creativeStudio.phase.review.title' });

      await selectStudioView(router, 'board');
      await selectStudioView(router, 'cut');

      expect(bridge.renderProgress.on).toHaveBeenCalledOnce();
    });

    it('releases the render progress subscription when the project shell unmounts', async () => {
      const { view } = renderRoute('/studio/project-1/cut');
      await screen.findByRole('heading', { level: 2, name: 'conversation.creativeStudio.phase.review.title' });
      expect(emitRenderProgress).toBeDefined();

      view.unmount();

      expect(emitRenderProgress).toBeUndefined();
    });
  });

  it('shows a loading shell while the canonical project is being fetched', () => {
    bridge.getProject.invoke.mockReturnValue(new Promise(() => {}));
    renderRoute();

    expect(screen.getByText('conversation.creativeStudio.project.loading')).toBeInTheDocument();
  });

  it('renders the durable project shell after a canonical result', async () => {
    renderRoute();

    expect(await screen.findByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })
    ).toBeInTheDocument();
  });

  it('composes the script-table workspace from the canonical project', async () => {
    const opening = scene();
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );

    const { router } = renderRoute();

    expect(
      await screen.findByRole('region', { name: 'conversation.creativeStudio.phase.write.scriptTableTitle' })
    ).toBeInTheDocument();
    const openingRow = screen.getByRole('region', { name: 'Opening' });
    expect(within(openingRow).getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveValue(
      'Opening'
    );
    expect(screen.queryByText('conversation.creativeStudio.preview.noAssetTitle')).toBeNull();

    await selectStudioView(router, 'board');
    expect(
      await screen.findByRole('heading', {
        name: 'conversation.creativeStudio.phase.produce.connectEngine',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.preview.noAssetTitle')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Opening' })).toBeNull();
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledWith({ projectId: 'project-1' }));
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.routing.connectProvider' })
    ).not.toBeInTheDocument();
    expect(bridge.listConnectionCandidates.invoke).not.toHaveBeenCalled();
    expect(bridge.listConnections.invoke).not.toHaveBeenCalled();
    expect(bridge.saveConnection.invoke).not.toHaveBeenCalled();
    expect(bridge.removeConnection.invoke).not.toHaveBeenCalled();
  });

  it('keeps manual storyboard editing available when Storyboard setup is required', async () => {
    bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        ...routes(),
        storyboard: { status: 'setup_required', selected: null, options: [] },
      })
    );

    renderRoute();

    expect(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.phase.write.addShot' })
    ).toBeEnabled();
    // A storyboard route awaiting setup must not lock the way out of Table either.
    expect(
      within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
        'button',
        { name: 'conversation.creativeStudio.phase.nav.board' }
      )
    ).toBeEnabled();
  });

  it('shows exactly one whole-screen Settings action when no selected media route is ready', async () => {
    bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        storyboard: { status: 'setup_required' as const, selected: null, options: [] },
        image: {
          status: 'setup_required' as const,
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [],
        },
        video: {
          status: 'setup_required' as const,
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [],
        },
        catalogVersion: 'catalog-full-setup',
      })
    );
    renderRoute('/studio/project-1/board');

    await screen.findByRole('heading', { name: 'conversation.creativeStudio.phase.produce.connectEngine' });
    expect(screen.getAllByRole('button', { name: 'conversation.creativeStudio.models.openSettings' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.askTeammate' })).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('uses the live Engine Strip when one selected media engine is ready', async () => {
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });
    expect(screen.getByRole('button', { name: 'image-model' })).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.models.engine.noFitVideo')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'conversation.creativeStudio.models.openSettings' })).toBeNull();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('imports a first frame through the native managed-asset command and refetches canonical state', async () => {
    const opening = scene();
    const initial = project('project-1', {
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const refreshed = project('project-1', {
      revision: 3,
      sceneOrder: [opening.id],
      scenes: {
        [opening.id]: {
          ...opening,
          referenceAssetId: 'asset-reference',
          assetIds: ['asset-reference'],
        },
      },
      assets: {
        'asset-reference': {
          id: 'asset-reference',
          projectId: 'project-1',
          sceneId: 'scene-1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'asset-reference.png' },
          byteSize: 128,
          sha256: 'a'.repeat(64),
          createdAt: '2026-07-30T00:00:00.000Z',
        },
      },
    });
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValue(ok(refreshed));
    bridge.chooseAndImportReference.invoke.mockResolvedValueOnce(
      ok({ status: 'imported', asset: refreshed.assets['asset-reference'] })
    );
    renderRoute();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.write.addReference',
      })
    );

    await waitFor(() =>
      expect(bridge.chooseAndImportReference.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        sceneId: 'scene-1',
        expectedRevision: 2,
      })
    );
    expect(JSON.stringify(bridge.chooseAndImportReference.invoke.mock.calls[0]?.[0])).not.toMatch(
      /path|data:|base64|https?:/i
    );
    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledTimes(4));
    expect(
      screen.getByRole('img', {
        name: 'conversation.creativeStudio.preview.importReference',
      })
    ).toHaveAttribute('src', 'weprompt-studio://asset/project-1/asset-reference');
  });

  it('prefills a generated reference prompt without changing the scene draft when edited', async () => {
    const opening = scene({ visualPrompt: '  A brushed-steel travel mug  ' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          aspectRatio: '9:16',
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.reference.generate' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });
    const referencePrompt = within(dialog).getByLabelText('conversation.creativeStudio.reference.promptLabel');
    expect(referencePrompt).toHaveValue(
      'A single cinematic frame, 9:16, no text, no labels, no collage, no split panels. A brushed-steel travel mug'
    );

    fireEvent.change(referencePrompt, { target: { value: 'Edited reference-only prompt' } });

    expect(referencePrompt).toHaveValue('Edited reference-only prompt');
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveValue(
      '  A brushed-steel travel mug  '
    );
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
  });

  it('routes a video-scene reference through the existing paid review with its cost disclosure intact', async () => {
    const opening = scene({ mediaKind: 'video', durationSeconds: 12 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.reference.generate' }));
    const promptDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });
    fireEvent.click(
      within(promptDialog).getByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    );

    const reviewDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.review.title',
    });
    expect(within(reviewDialog).getByText('conversation.creativeStudio.reference.reviewTag')).toBeVisible();
    expect(within(reviewDialog).getByText('conversation.creativeStudio.review.chargeNotice')).toBeVisible();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('shows an authored reference-prompt breach and blocks Confirm before the paid request', async () => {
    const opening = scene({ mediaKind: 'video', durationSeconds: 12, visualPrompt: 'An ACME billboard at dusk' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          rules: [
            {
              id: 'rule_1',
              scope: 'project',
              text: 'No competitor logos.',
              predicate: { kind: 'forbidden_terms', terms: ['acme'] },
              createdAt: '2026-08-13T00:00:00.000Z',
            },
          ],
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.reference.generate' }));
    const promptDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });
    fireEvent.click(
      within(promptDialog).getByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    );

    const reviewDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.review.title',
    });
    expect(within(reviewDialog).getByText('conversation.creativeStudio.rules.breachScene')).toBeInTheDocument();
    expect(
      within(reviewDialog).getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })
    ).toBeDisabled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('does not breach a reference rule on a term that exists only in the app-authored prefix', async () => {
    const opening = scene({ mediaKind: 'video', durationSeconds: 12, visualPrompt: 'A paper airplane at sunrise' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          rules: [
            {
              id: 'rule_1',
              scope: 'project',
              text: 'Do not include typography.',
              predicate: { kind: 'forbidden_terms', terms: ['text'] },
              createdAt: '2026-08-13T00:00:00.000Z',
            },
          ],
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.reference.generate' }));
    const promptDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });
    fireEvent.click(
      within(promptDialog).getByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    );

    const reviewDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.review.title',
    });
    expect(within(reviewDialog).queryByText('conversation.creativeStudio.rules.breachScene')).not.toBeInTheDocument();
    expect(
      within(reviewDialog).getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })
    ).toBeEnabled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('surfaces a queued request whose scene cannot describe a reference image instead of spending on it', async () => {
    // `ready` only asks for a non-empty visual prompt, and a visual prompt may be twice as long as
    // a reference prompt. Main refuses such a submission, so submitting would dismiss the request
    // and then lose it with nothing on screen.
    const unusable = scene({ id: 'scene-1', visualPrompt: 'A '.repeat(3 * 1024) });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [unusable.id], scenes: { [unusable.id]: unusable } }))
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok([referenceRequest(unusable.id, 1)]));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    const notice = await screen.findByTestId('reference-exclusion-notice');
    expect(within(notice).getByText(unusable.title)).toBeVisible();
    expect(within(notice).getByText(/conversation\.creativeStudio\.reference\.excludedPromptUnusable/)).toBeVisible();
    // Nothing was paid for, and the request is still on disk for the discard action to consume.
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    expect(bridge.dismissReferenceRequests.invoke).not.toHaveBeenCalled();

    fireEvent.click(
      within(notice).getByRole('button', { name: 'conversation.creativeStudio.reference.discardExcludedRequests' })
    );
    await waitFor(() =>
      expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        requestIds: ['reference_request_1'],
      })
    );
  });

  it('describes each auto-submitted reference scene with its own visual prompt', async () => {
    // A reference plate is the scene's *first frame*, so one prompt shared across the batch would
    // paint every scene with the same picture. The batch carries one prompt per scene or it is
    // not a batch of references at all.
    const first = scene({ id: 'scene-1', mediaKind: 'video', visualPrompt: 'A bright studio' });
    const second = scene({
      id: 'scene-2',
      title: 'Closing',
      mediaKind: 'video',
      visualPrompt: 'A rain-slicked alley at dusk',
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [first.id, second.id],
          scenes: { [first.id]: first, [second.id]: second },
        })
      )
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(
      ok([referenceRequest(first.id, 1), referenceRequest(second.id, 2)])
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          outputRole: 'reference',
          referencePrompts: [
            { sceneId: first.id, prompt: buildFirstFramePrompt('A bright studio', '16:9') },
            { sceneId: second.id, prompt: buildFirstFramePrompt('A rain-slicked alley at dusk', '16:9') },
          ],
        })
      )
    );
  });

  it('auto-submits queued assistant requests as one batch with no confirmation step', async () => {
    const first = scene({ id: 'scene-1', mediaKind: 'video' });
    const second = scene({ id: 'scene-2', title: 'Closing', mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [first.id, second.id],
          scenes: { [first.id]: first, [second.id]: second },
        })
      )
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(
      ok([referenceRequest(first.id, 1), referenceRequest(second.id, 2)])
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'batch',
        sceneIds: [first.id, second.id],
        expectedRevision: 2,
        routes: [
          { sceneId: first.id, choiceId: 'choice_image', kind: 'image' },
          { sceneId: second.id, choiceId: 'choice_image', kind: 'image' },
        ],
        catalogVersion: 'catalog-1',
        outputRole: 'reference',
        referencePrompts: [
          { sceneId: first.id, prompt: buildFirstFramePrompt(first.visualPrompt, '16:9') },
          { sceneId: second.id, prompt: buildFirstFramePrompt(second.visualPrompt, '16:9') },
        ],
      })
    );
    expect(screen.queryByRole('dialog', { name: 'conversation.creativeStudio.review.title' })).not.toBeInTheDocument();
  });

  it('consumes the reviewed requests after auto-submitting a queued reference batch', async () => {
    const first = scene({ id: 'scene-1', mediaKind: 'video' });
    const second = scene({ id: 'scene-2', title: 'Closing', mediaKind: 'video' });
    const requests = [referenceRequest(first.id, 1), referenceRequest(second.id, 2)];
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [first.id, second.id],
          scenes: { [first.id]: first, [second.id]: second },
        })
      )
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok(requests));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'batch',
        sceneIds: [first.id, second.id],
        expectedRevision: 2,
        routes: [
          { sceneId: first.id, choiceId: 'choice_image', kind: 'image' },
          { sceneId: second.id, choiceId: 'choice_image', kind: 'image' },
        ],
        catalogVersion: 'catalog-1',
        outputRole: 'reference',
        referencePrompts: [
          { sceneId: first.id, prompt: buildFirstFramePrompt(first.visualPrompt, '16:9') },
          { sceneId: second.id, prompt: buildFirstFramePrompt(second.visualPrompt, '16:9') },
        ],
      })
    );
    await waitFor(() =>
      expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        requestIds: requests.map(({ id }) => id),
      })
    );
    // Consumed before it is paid for, never after: the queued request on disk is the only record
    // that survives leaving the project, so a submit that lands first leaves a window where the
    // plate is charged and the request is still queued for the next mount to charge again.
    expect(bridge.dismissReferenceRequests.invoke.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.submitScenes.invoke.mock.invocationCallOrder[0]!
    );
  });

  it('consumes a queued reference request before spending, so re-entering cannot pay twice', async () => {
    const opening = scene({ mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    const queue = installReferenceRequestQueue([referenceRequest(opening.id, 1)]);
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    // The paid call never resolves: the user goes back to the library, or quits, while it is in
    // flight. Everything the renderer knows about this request dies with the mount, so the request
    // must already be gone from the queue by the time the money is committed.
    const inFlightSubmit = deferred<StudioCommandResult<StudioRendererJob[]>>();
    bridge.submitScenes.invoke.mockReturnValueOnce(inFlightSubmit.promise);

    const { view } = renderRoute();

    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce());
    expect(queue.pendingIds()).toEqual([]);

    view.unmount();
    renderRoute();

    await waitFor(() => expect(bridge.listPendingReferenceRequests.invoke.mock.calls.length).toBeGreaterThan(1));
    await act(async () => {});
    expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce();
  });

  it('shows a rejected auto-submit in a review the user can discard', async () => {
    const opening = scene({ mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    installReferenceRequestQueue([referenceRequest(opening.id, 1)]);
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    bridge.submitScenes.invoke.mockResolvedValue(invalidPayload());

    renderRoute();

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    expect(within(review).getByText('conversation.creativeStudio.errors.invalidPayload')).toBeVisible();
    expect(within(review).getByLabelText(opening.title)).toBeVisible();

    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'conversation.creativeStudio.review.title' })).not.toBeInTheDocument()
    );
    expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce();
  });

  /**
   * One request the renderer could not act on must not close the feature for the rest of the mount.
   *
   * The batch is rebuilt from every pending request on each run, so a request that has been through
   * the paid path but is still queued (its dismissal failed) reappears inside every later batch. A
   * re-entry guard that asks "does this batch contain anything already attempted?" therefore skips
   * brand-new requests for unrelated scenes, silently and for good.
   */
  it('lets the next queued reference request through after one that could not be consumed', async () => {
    const first = scene({ id: 'scene-1', mediaKind: 'video' });
    const second = scene({ id: 'scene-2', title: 'Closing', mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [first.id, second.id],
          scenes: { [first.id]: first, [second.id]: second },
        })
      )
    );
    let onProposalUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.proposalUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onProposalUpdate = listener;
      return () => {};
    });
    const stuck = referenceRequest(first.id, 1);
    const queue = installReferenceRequestQueue([stuck]);
    const consume = bridge.dismissReferenceRequests.invoke.getMockImplementation()!;
    bridge.dismissReferenceRequests.invoke.mockImplementation(async (input: { requestIds: string[] }) =>
      input.requestIds.includes(stuck.id) ? failure() : consume(input)
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    await waitFor(() => expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledOnce());
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    expect(queue.pendingIds()).toEqual([stuck.id]);

    queue.queue(referenceRequest(second.id, 2));
    await act(async () => onProposalUpdate?.({ projectId: 'project-1' }));

    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce());
    expect(bridge.submitScenes.invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'batch',
        sceneIds: [second.id],
        routes: [{ sceneId: second.id, choiceId: 'choice_image', kind: 'image' }],
        outputRole: 'reference',
      })
    );
  });

  it('auto-submits only guard-ready queued scenes and lets the user discard the excluded request', async () => {
    const plated = scene({
      id: 'scene-1',
      assetIds: ['asset-1'],
      reviewState: 'needs_selection',
    });
    const ready = scene({ id: 'scene-2', title: 'Closing', mediaKind: 'video' });
    const requests = [referenceRequest(plated.id, 1), referenceRequest(ready.id, 2)];
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [plated.id, ready.id],
          scenes: { [plated.id]: plated, [ready.id]: ready },
          assets: { 'asset-1': asset('asset-1') },
        })
      )
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok(requests));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'batch',
        sceneIds: [ready.id],
        expectedRevision: 2,
        routes: [{ sceneId: ready.id, choiceId: 'choice_image', kind: 'image' }],
        catalogVersion: 'catalog-1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: ready.id, prompt: buildFirstFramePrompt(ready.visualPrompt, '16:9') }],
      })
    );
    await waitFor(() =>
      expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        requestIds: [requests[1]!.id],
      })
    );

    const notice = await screen.findByTestId('reference-exclusion-notice');
    expect(within(notice).getByText(plated.title)).toBeVisible();
    fireEvent.click(
      within(notice).getByRole('button', {
        name: 'conversation.creativeStudio.reference.discardExcludedRequests',
      })
    );

    await waitFor(() =>
      expect(bridge.dismissReferenceRequests.invoke).toHaveBeenNthCalledWith(2, {
        projectId: 'project-1',
        requestIds: [requests[0]!.id],
      })
    );
    await waitFor(() => expect(screen.queryByTestId('reference-exclusion-notice')).not.toBeInTheDocument());
  });

  it('names every queued reference scene when none are ready for approval', async () => {
    const plated = scene({
      id: 'scene-1',
      title: 'Already plated',
      assetIds: ['asset-1'],
      reviewState: 'needs_selection',
    });
    const failedJob = job('job-failed', {
      sceneId: 'scene-2',
      status: 'failed',
      error: {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
    });
    const needsAttention = scene({
      id: 'scene-2',
      title: 'Failed closing',
      jobIds: [failedJob.id],
      reviewState: 'needs_attention',
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [plated.id, needsAttention.id],
          scenes: { [plated.id]: plated, [needsAttention.id]: needsAttention },
          assets: { 'asset-1': asset('asset-1') },
          jobs: { [failedJob.id]: failedJob },
        })
      )
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(
      ok([referenceRequest(plated.id, 1), referenceRequest(plated.id, 2), referenceRequest(needsAttention.id, 3)])
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    const notice = await screen.findByTestId('reference-exclusion-notice');
    expect(within(notice).getByText('conversation.creativeStudio.reference.excludedNoneReady')).toBeVisible();
    expect(within(notice).getAllByText(plated.title)).toHaveLength(1);
    expect(within(notice).getByText(/conversation\.creativeStudio\.scene\.status\.needs_selection/)).toBeVisible();
    expect(within(notice).getByText(needsAttention.title)).toBeVisible();
    expect(within(notice).getByText(/conversation\.creativeStudio\.scene\.status\.needs_attention/)).toBeVisible();
    const phaseHeading = document.querySelector('[data-studio-phase-heading]');
    expect(phaseHeading).not.toBeNull();
    expect(notice.compareDocumentPosition(phaseHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.queryByRole('dialog', { name: 'conversation.creativeStudio.review.title' })).not.toBeInTheDocument();
    expect(bridge.dismissReferenceRequests.invoke).not.toHaveBeenCalled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  /**
   * A queued request that cannot be consumed must not be paid for.
   *
   * Dismissal is what stops the next mount finding the same request still pending and charging for
   * the plate again, so a failed dismissal is a failed spend fence, not a cosmetic problem. Nothing
   * is lost by waiting: the request stays queued for the next mount to pick up.
   */
  it('does not spend when a queued reference request cannot be consumed first', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.proposalUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok([referenceRequest(opening.id, 1)]));
    bridge.dismissReferenceRequests.invoke.mockResolvedValue(failure());
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    await waitFor(() => expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledOnce());
    expect(await screen.findByText('conversation.creativeStudio.reference.dismissFailed')).toBeVisible();
    await act(async () => {});
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();

    // The request is still queued and every re-read offers it again. Retrying it for the rest of
    // the mount is what `autoSubmittedReferenceRequestIdsRef` exists to stop: nothing here has
    // been suppressed, because suppression means "already dealt with", which this is not.
    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await act(async () => {});
    expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledOnce();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  /**
   * A queued request must be submitted once, not once per job poll.
   *
   * The auto-submit effect re-runs whenever `studioJobs` changes, which includes every poll, and
   * this is a paid path with no spend ceiling behind it. Main keeps offering the request here —
   * a stale read, a dismissal that has not landed on disk yet — and each re-read must be ignored.
   *
   * Deleting either half of the re-entry filter (the suppressed set or the auto-submitted set) is
   * enough to make this red, which is what the earlier version of this test could not claim.
   */
  it('auto-submits a queued reference request once across repeated pending re-reads', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    // `proposalUpdated`, not `projectUpdated`: only this one re-reads the pending queue, which is
    // what puts the already-submitted request back in front of the effect.
    bridge.proposalUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok([referenceRequest(opening.id, 1)]));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();

    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce());
    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await act(async () => {});

    expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce();
  });

  it('keeps queued reference approval unavailable while scene drafts are unsaved', async () => {
    const pending = deferred<StudioCommandResult<StudioReferenceRequest[]>>();
    const opening = scene({ mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listPendingReferenceRequests.invoke.mockReturnValue(pending.promise);
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));

    renderRoute();
    const prompt = await screen.findByLabelText('conversation.creativeStudio.inspector.visualPromptLabel');
    fireEvent.change(prompt, { target: { value: 'Unsaved queued-reference edit' } });
    await act(async () => pending.resolve(ok([referenceRequest(opening.id, 1)])));

    await waitFor(() => expect(bridge.listPendingReferenceRequests.invoke).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'conversation.creativeStudio.review.title' })).not.toBeInTheDocument();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('submits an edited reference prompt with the reference role on the image route', async () => {
    const opening = scene({ mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.reference.generate' }));
    const promptDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });
    fireEvent.change(within(promptDialog).getByLabelText('conversation.creativeStudio.reference.promptLabel'), {
      target: { value: 'Edited reference-only prompt' },
    });
    fireEvent.click(
      within(promptDialog).getByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    );
    const reviewDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.review.title',
    });
    fireEvent.click(within(reviewDialog).getByRole('button', { name: 'conversation.creativeStudio.review.confirm' }));

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'single',
        sceneIds: ['scene-1'],
        expectedRevision: 2,
        routes: [{ sceneId: 'scene-1', choiceId: 'choice_image', kind: 'image' }],
        catalogVersion: 'catalog-1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene-1', prompt: 'Edited reference-only prompt' }],
      })
    );
  });

  it('does not offer generated references when the image catalog role is not ready', async () => {
    const videoRoute = imageRoute({
      choiceId: 'choice_video',
      providerId: 'provider-video',
      providerName: 'Video provider',
      model: 'video-model',
      kind: 'video',
    });
    const opening = scene({ mediaKind: 'video' });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
          routing: {
            storyboard: null,
            image: project().routing.image,
            video: {
              choiceId: videoRoute.choiceId,
              providerId: videoRoute.providerId,
              model: videoRoute.model,
            },
          },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        ...routes(),
        video: {
          status: 'ready',
          selected: {
            choiceId: videoRoute.choiceId,
            providerId: videoRoute.providerId,
            model: videoRoute.model,
          },
          selectedRoute: videoRoute,
          selectionIssue: null,
          options: [videoRoute],
        },
      })
    );
    renderRoute();

    await screen.findByRole('region', { name: 'Opening' });
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    ).not.toBeInTheDocument();
  });

  it('opens the canonical selected variation from its shot card without selecting another asset', async () => {
    const first = asset('asset-1');
    const second = asset('asset-2');
    const opening = scene({
      selectedAssetId: first.id,
      assetIds: [first.id, second.id],
      reviewState: 'complete',
    });
    const initial = project('project-1', {
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
      assets: { [first.id]: first, [second.id]: second },
    });
    bridge.getProject.invoke.mockResolvedValue(ok(initial));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.produce.openPreview',
      })
    );
    const preview = await screen.findByRole('figure', { name: 'conversation.creativeStudio.preview.title' });
    expect(within(preview).getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/asset-1'
    );
    expect(screen.getByText('conversation.creativeStudio.phase.produce.takeRatio')).toBeVisible();
    expect(bridge.selectAsset.invoke).not.toHaveBeenCalled();
  });

  it('does not infer a video poster when more than one succeeded job claims the selected primary asset', async () => {
    const videoAsset: StudioAsset = {
      ...asset('video-1'),
      mediaKind: 'video',
      mimeType: 'video/mp4',
    };
    const firstPoster: StudioAsset = {
      ...asset('poster-1'),
      managedAsset: { collection: 'thumbnails', fileName: 'poster-1.png' },
    };
    const secondPoster: StudioAsset = {
      ...asset('poster-2'),
      managedAsset: { collection: 'thumbnails', fileName: 'poster-2.png' },
    };
    const firstJob = job('job-1', {
      provider: {
        choiceId: 'choice_video',
        providerId: 'provider-video',
        model: 'video-model',
      },
      outputAssetIds: [videoAsset.id, firstPoster.id],
    });
    const secondJob = job('job-2', {
      provider: firstJob.provider,
      outputAssetIds: [videoAsset.id, secondPoster.id],
    });
    const opening = scene({
      mediaKind: 'video',
      selectedAssetId: videoAsset.id,
      assetIds: [videoAsset.id, firstPoster.id, secondPoster.id],
      jobIds: [firstJob.id, secondJob.id],
      reviewState: 'complete',
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
          assets: {
            [videoAsset.id]: videoAsset,
            [firstPoster.id]: firstPoster,
            [secondPoster.id]: secondPoster,
          },
          jobs: {
            [firstJob.id]: firstJob,
            [secondJob.id]: secondJob,
          },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.produce.openPreview',
      })
    );
    const preview = await screen.findByRole('figure', { name: 'conversation.creativeStudio.preview.title' });
    const video = within(preview).getByLabelText('conversation.creativeStudio.preview.videoLabel');
    expect(video).not.toHaveAttribute('poster');
    expect(screen.getAllByText('conversation.creativeStudio.preview.videoReady')).toHaveLength(2);
  });

  it('submits one scene only after explicit review without applying the batch duration gate', async () => {
    const opening = scene({ durationSeconds: 5 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 15,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    const generateScene = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.phase.produce.render',
    });
    await waitFor(() => expect(generateScene).toBeEnabled());
    fireEvent.click(generateScene);

    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toHaveTextContent('conversation.creativeStudio.review.title');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    );

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'single',
        sceneIds: ['scene-1'],
        expectedRevision: 2,
        routes: [
          {
            sceneId: 'scene-1',
            choiceId: 'choice_image',
            kind: 'image',
          },
        ],
        catalogVersion: 'catalog-1',
      })
    );
  });

  it.each([
    {
      state: 'generated',
      selectedAssetId: 'asset-output',
    },
    {
      state: 'needs selection',
      selectedAssetId: null,
    },
  ])('blocks a blank-prompt $state scene from single-scene review', async ({ selectedAssetId }) => {
    const output = asset('asset-output');
    const opening = scene({
      visualPrompt: '   ',
      selectedAssetId,
      assetIds: [output.id],
      durationSeconds: 5,
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 5,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
          assets: { [output.id]: output },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.produce.renderAnother',
      })
    ).toBeDisabled();
    if (selectedAssetId === null) {
      expect(
        screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.writeVisual' })
      ).toBeEnabled();
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('allows explicit regeneration with a nonblank prompt independently of the batch duration total', async () => {
    const output = asset('asset-output');
    const opening = scene({ selectedAssetId: output.id, assetIds: [output.id], durationSeconds: 5 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 15,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
          assets: { [output.id]: output },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    const regenerate = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.phase.produce.renderAnother',
    });
    await waitFor(() => expect(regenerate).toBeEnabled());
    fireEvent.click(regenerate);
    expect(await screen.findByRole('dialog')).toHaveTextContent('conversation.creativeStudio.review.title');
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('opens the existing paid review from the shot-card action without submitting before confirmation', async () => {
    const opening = scene({ durationSeconds: 5 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 15,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.produce.render',
      })
    );

    expect(await screen.findByRole('dialog')).toHaveTextContent('conversation.creativeStudio.review.title');
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' }));
    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1));
  });

  it('opens and submits the single batch entry point with an 18-second storyboard against a 15-second target', async () => {
    const opening = scene({ id: 'scene-1', durationSeconds: 6 });
    const reveal = scene({ id: 'scene-2', title: 'Reveal', durationSeconds: 6 });
    const closing = scene({ id: 'scene-3', title: 'Closing', durationSeconds: 6 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 15,
          sceneOrder: [opening.id, reveal.id, closing.id],
          scenes: { [opening.id]: opening, [reveal.id]: reveal, [closing.id]: closing },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    const { batchAction, batchControl } = await findBatchAction();
    expect(batchAction).toBeEnabled();
    // An off-target storyboard advises; it must not lock the way to the Cut view either.
    expect(
      within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' })).getByRole(
        'button',
        { name: 'conversation.creativeStudio.phase.nav.cut' }
      )
    ).toBeEnabled();
    expect(within(batchControl).getByText('conversation.creativeStudio.review.durationMismatch')).toBeVisible();

    fireEvent.click(batchAction);
    expect(await screen.findByRole('dialog')).toHaveTextContent('conversation.creativeStudio.review.title');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' }));
    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1));
  });

  it('advises on an off-target storyboard without gating batch generation', async () => {
    const opening = scene({ durationSeconds: 18 });
    const initial = project('project-1', {
      targetDurationSeconds: 15,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    bridge.getProject.invoke.mockResolvedValue(ok(initial));
    bridge.listRoutes.invoke.mockResolvedValue(ok({ ...routesWithImage(), catalogVersion: '0123456789abcdef' }));
    const { router } = renderRoute();

    // Write no longer carries a pacing bar, so the mismatch rides the shell advisory slot.
    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.review.durationMismatch');

    await selectStudioView(router, 'board');
    const { batchAction, batchControl } = await findBatchAction();
    expect(batchAction).toBeEnabled();
    expect(within(batchControl).getByText('conversation.creativeStudio.review.durationMismatch')).toBeVisible();
  });

  it('keeps write actions disabled for the entire reference import mutation', async () => {
    const opening = scene({ durationSeconds: 10 });
    const initial = project('project-1', {
      targetDurationSeconds: 15,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    let resolveImport!: (result: StudioCommandResult<{ status: 'cancelled' }>) => void;
    bridge.getProject.invoke.mockResolvedValue(ok(initial));
    bridge.listRoutes.invoke.mockResolvedValue(ok({ ...routesWithImage(), catalogVersion: '0123456789abcdef' }));
    bridge.chooseAndImportReference.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveImport = resolve;
      })
    );
    renderRoute();
    const addReference = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.phase.write.addReference',
    });

    fireEvent.click(addReference);
    await waitFor(() => expect(bridge.chooseAndImportReference.invoke).toHaveBeenCalledOnce());
    // Held across the whole in-flight window, not just re-queried after it settles.
    expect(addReference).toBeDisabled();

    resolveImport(ok({ status: 'cancelled' }));
    await waitFor(() => expect(addReference).toBeEnabled());
  });

  it('selects a project engine directly from the live strip', async () => {
    const opening = scene({ durationSeconds: 10 });
    const initial = project('project-1', {
      targetDurationSeconds: 15,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const alternate = imageRoute({
      choiceId: 'choice_image_alternate',
      providerId: 'provider-image-alternate',
      providerName: 'Alternate image provider',
      model: 'alternate-image-model',
    });
    const catalog = routesWithImage();
    catalog.catalogVersion = '0123456789abcdef';
    catalog.image.options.push(alternate);
    bridge.getProject.invoke.mockResolvedValue(ok(initial));
    bridge.listRoutes.invoke.mockResolvedValue(ok(catalog));
    renderRoute('/studio/project-1/board');

    const imageEngine = await screen.findByRole('button', { name: 'image-model' });
    expect(screen.queryByText(/alternate-image-model/)).not.toBeInTheDocument();
    fireEvent.click(imageEngine);
    fireEvent.click(
      within(await screen.findByRole('menu')).getAllByText('conversation.creativeStudio.models.engine.optionLabel')[1]
    );

    await waitFor(() =>
      expect(bridge.updateModelSelection.invoke).toHaveBeenCalledWith({
        projectId: 'project-1',
        expectedRevision: initial.revision,
        role: 'image',
        selection: { choiceId: 'choice_image_alternate' },
      })
    );
  });

  it('pre-arms the only compatible engine without writing until the user chooses it', async () => {
    const unrouted = project('project-1', { routing: { storyboard: null, image: null, video: null } });
    bridge.getProject.invoke.mockResolvedValueOnce(ok(unrouted)).mockResolvedValue(ok(project()));
    bridge.listRoutes.invoke
      .mockResolvedValueOnce(
        ok({
          ...routes(),
          image: {
            status: 'selection_required' as const,
            selected: null,
            selectedRoute: null,
            selectionIssue: null,
            options: [imageRoute()],
          },
        })
      )
      .mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    const imageEngine = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.models.engine.notSetImage',
    });
    expect(imageEngine).toHaveTextContent('image-model');
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();

    fireEvent.click(imageEngine);
    fireEvent.click(
      within(await screen.findByRole('menu')).getByText('conversation.creativeStudio.models.engine.optionLabel')
    );
    await waitFor(() =>
      expect(bridge.updateModelSelection.invoke).toHaveBeenCalledWith({
        projectId: 'project-1',
        expectedRevision: unrouted.revision,
        role: 'image',
        selection: { choiceId: 'choice_image' },
      })
    );
    await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });
  });

  it('exposes ambiguous engine choices in place without guessing or showing the connection door', async () => {
    const unrouted = project('project-1', { routing: { storyboard: null, image: null, video: null } });
    bridge.getProject.invoke.mockResolvedValue(ok(unrouted));
    bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        ...routes(),
        image: {
          status: 'selection_required' as const,
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [imageRoute(), imageRoute({ choiceId: 'choice_image_alternate', model: 'alternate-image-model' })],
        },
      })
    );
    renderRoute('/studio/project-1/board');

    expect(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.models.engine.notSetImage' })
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'conversation.creativeStudio.phase.produce.connectEngine' })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledWith({ projectId: 'project-1' }));
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
  });

  it('opens a canonical batch review from the batch control and submits every exact scene route only after confirmation', async () => {
    const opening = scene({ id: 'scene-1', durationSeconds: 5 });
    const closing = scene({ id: 'scene-2', title: 'Closing', durationSeconds: 10 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 15,
          sceneOrder: [opening.id, closing.id],
          scenes: { [opening.id]: opening, [closing.id]: closing },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    const { batchAction } = await findBatchAction();
    await waitFor(() => expect(batchAction).toBeEnabled());
    fireEvent.click(batchAction);

    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toHaveTextContent('conversation.creativeStudio.review.sceneCount');
    expect(screen.getByRole('button', { name: 'image-model' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'image-model' })).toHaveAccessibleDescription(
      'conversation.creativeStudio.models.engine.lockedDuringReview'
    );
    within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' }))
      .getAllByRole('button')
      .forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    );

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'batch',
        sceneIds: ['scene-1', 'scene-2'],
        expectedRevision: 2,
        routes: [
          {
            sceneId: 'scene-1',
            choiceId: 'choice_image',
            kind: 'image',
          },
          {
            sceneId: 'scene-2',
            choiceId: 'choice_image',
            kind: 'image',
          },
        ],
        catalogVersion: 'catalog-1',
      })
    );
  });

  it('shows the canonical integration for duplicate provider and model routes before paid confirmation', async () => {
    const selectedVideo = imageRoute({
      choiceId: 'choice_video_byteplus',
      providerId: 'provider-video',
      providerName: 'Shared video provider',
      model: 'duplicate-video-model',
      integrationLabelKey: 'bytePlusSeedance',
      kind: 'video',
    });
    const otherVideo = imageRoute({
      ...selectedVideo,
      choiceId: 'choice_video_gateway',
      integrationLabelKey: 'selfHostedVideoGateway',
    });
    const opening = scene({ mediaKind: 'video', durationSeconds: 5 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 5,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
          routing: {
            storyboard: null,
            image: null,
            video: {
              choiceId: selectedVideo.choiceId,
              providerId: selectedVideo.providerId,
              model: selectedVideo.model,
            },
          },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        ...routes(),
        video: {
          status: 'ready',
          selected: {
            choiceId: selectedVideo.choiceId,
            providerId: selectedVideo.providerId,
            model: selectedVideo.model,
          },
          selectedRoute: selectedVideo,
          selectionIssue: null,
          options: [otherVideo, selectedVideo],
        },
      })
    );
    renderRoute('/studio/project-1/board');

    const { batchAction } = await findBatchAction();
    await waitFor(() => expect(batchAction).toBeEnabled());
    fireEvent.click(batchAction);

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    expect(within(review).getByText('settings.mediaModels.integrationLabel')).toBeVisible();
    expect(within(review).getByText('settings.mediaModels.integration.bytePlusSeedance')).toBeVisible();
    expect(
      within(review).queryByText('settings.mediaModels.integration.selfHostedVideoGateway')
    ).not.toBeInTheDocument();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('keeps the batch modal and submit on the same frozen eligible scene enumeration', async () => {
    const opening = scene({ id: 'scene-eligible', title: 'Eligible opening', durationSeconds: 5 });
    const reference = scene({
      id: 'scene-reference',
      title: 'Reference blocked',
      durationSeconds: 5,
      referenceAssetId: 'reference-1',
    });
    const video = scene({ id: 'scene-video', title: 'Video without engine', mediaKind: 'video', durationSeconds: 5 });
    const noFirstFrame = imageRoute({
      constraints: { ...imageRoute().constraints, supportsFirstFrame: false },
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 15,
          sceneOrder: [opening.id, reference.id, video.id],
          scenes: { [opening.id]: opening, [reference.id]: reference, [video.id]: video },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage(noFirstFrame)));
    renderRoute('/studio/project-1/board');

    const { batchAction, batchControl } = await findBatchAction();
    await waitFor(() => expect(batchAction).toBeEnabled());
    expect(within(batchControl).getAllByText('conversation.creativeStudio.phase.produce.batchExcluded')).toHaveLength(
      2
    );
    fireEvent.click(batchAction);

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    const reviewedShots = within(review).getAllByRole('article');
    expect(reviewedShots).toHaveLength(1);
    expect(reviewedShots[0]).toHaveAccessibleName('Eligible opening');
    expect(within(review).getByText('Image provider')).toBeVisible();
    expect(within(review).getByText('conversation.creativeStudio.review.excludedFirstFrame')).toBeVisible();

    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.confirm' }));
    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'batch',
        sceneIds: ['scene-eligible'],
        expectedRevision: 2,
        routes: [{ sceneId: 'scene-eligible', choiceId: 'choice_image', kind: 'image' }],
        catalogVersion: 'catalog-1',
      })
    );
  });

  it('closes a route-blocked review and focuses its existing engine role without selecting or spending', async () => {
    const opening = scene({ id: 'scene-1', title: 'Queued opening', durationSeconds: 5 });
    installReferenceRequestQueue([referenceRequest(opening.id, 1)]);
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    expect(within(review).getByText('conversation.creativeStudio.review.invalidRoute')).toBeVisible();
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'conversation.creativeStudio.review.title' })).not.toBeInTheDocument()
    );
    await waitFor(() => expect(document.activeElement?.closest('[data-engine-role="image"]')).not.toBeNull());
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('opens Brief from Cut and focuses the blocked role without selecting or spending', async () => {
    const opening = scene({ id: 'scene-1', title: 'Cut recovery', durationSeconds: 5 });
    installReferenceRequestQueue([referenceRequest(opening.id, 1)]);
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    renderRoute('/studio/project-1/cut');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));

    const brief = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.phase.brief.title' });
    const briefImageSlot = within(brief).getByRole('group', {
      name: 'conversation.creativeStudio.models.engine.roleImage',
    });
    const briefScope = briefImageSlot.closest('[data-studio-engine-scope="brief"]');
    expect(briefScope).not.toBeNull();
    await waitFor(() => expect(document.activeElement?.closest('[data-studio-engine-scope="brief"]')).toBe(briefScope));
    expect(document.activeElement?.closest('[data-engine-role="image"]')).not.toBeNull();
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('focuses the already-open Brief engine instead of the obscured phase engine', async () => {
    const opening = scene({ id: 'scene-1', title: 'Brief recovery', durationSeconds: 5 });
    installReferenceRequestQueue([referenceRequest(opening.id, 1)]);
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    renderRoute({ pathname: '/studio/project-1/table', state: { openBrief: true } });

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));

    const brief = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.phase.brief.title' });
    const briefImageSlot = within(brief).getByRole('group', {
      name: 'conversation.creativeStudio.models.engine.roleImage',
    });
    await waitFor(() => expect(document.activeElement?.closest('[data-engine-role="image"]')).toBe(briefImageSlot));
    expect(document.activeElement?.closest('[data-studio-engine-scope="brief"]')).not.toBeNull();
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('focuses an actionless unhealthy engine slot after closing its blocked review', async () => {
    const opening = scene({ id: 'scene-1', title: 'Health recovery', durationSeconds: 5 });
    const unavailableImage = imageRoute({ health: 'unavailable' });
    installReferenceRequestQueue([referenceRequest(opening.id, 1)]);
    bridge.getProject.invoke.mockResolvedValue(
      ok(project('project-1', { sceneOrder: [opening.id], scenes: { [opening.id]: opening } }))
    );
    bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        ...routes(),
        image: {
          status: 'unavailable',
          selected: {
            choiceId: unavailableImage.choiceId,
            providerId: unavailableImage.providerId,
            model: unavailableImage.model,
          },
          selectedRoute: null,
          selectionIssue: { code: 'health' },
          options: [unavailableImage],
        },
      })
    );
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));

    const healthSlot = await screen.findByRole('group', {
      name: 'conversation.creativeStudio.models.engine.roleImage',
    });
    await waitFor(() => expect(document.activeElement).toBe(healthSlot));
    expect(within(healthSlot).queryByRole('button')).not.toBeInTheDocument();
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('resumes one deferred Director request after a same-project engine selection without duplicate spend', async () => {
    let onProposalUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.proposalUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onProposalUpdate = listener;
      return () => {};
    });
    const opening = scene({ id: 'scene-1', title: 'Deferred opening', durationSeconds: 5 });
    const pendingRequest = referenceRequest(opening.id, 1);
    const excluded = scene({
      id: 'scene-excluded',
      title: 'Already plated',
      assetIds: ['asset-1'],
      reviewState: 'needs_selection',
    });
    const excludedRequest = referenceRequest(excluded.id, 2);
    const excludedAsset = { ...asset('asset-1'), sceneId: excluded.id };
    const unrouted = project('project-1', {
      sceneOrder: [opening.id, excluded.id],
      scenes: { [opening.id]: opening, [excluded.id]: excluded },
      assets: { [excludedAsset.id]: excludedAsset },
      routing: { storyboard: null, image: null, video: null },
    });
    const routed = project('project-1', {
      revision: 3,
      sceneOrder: [opening.id, excluded.id],
      scenes: { [opening.id]: opening, [excluded.id]: excluded },
      assets: { [excludedAsset.id]: excludedAsset },
    });
    const selectableCatalog: StudioRouteCatalog = {
      ...routes(),
      image: {
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [imageRoute()],
      },
    };
    let canonicalProject = unrouted;
    bridge.getProject.invoke.mockImplementation(async () => ok(canonicalProject));
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok([pendingRequest, excludedRequest]));
    bridge.updateModelSelection.invoke.mockImplementation(async () => {
      canonicalProject = routed;
      return ok(routed);
    });
    bridge.listRoutes.invoke.mockImplementation(async () =>
      ok(canonicalProject === unrouted ? selectableCatalog : routesWithImage())
    );
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();

    const imageEngine = screen.getByRole('button', {
      name: 'conversation.creativeStudio.models.engine.notSetImage',
    });
    fireEvent.click(imageEngine);
    fireEvent.click(
      within(await screen.findByRole('menu')).getByText('conversation.creativeStudio.models.engine.optionLabel')
    );

    await waitFor(() =>
      expect(bridge.updateModelSelection.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        expectedRevision: unrouted.revision,
        role: 'image',
        selection: { choiceId: 'choice_image' },
      })
    );
    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'batch',
        sceneIds: [opening.id],
        expectedRevision: routed.revision,
        routes: [{ sceneId: opening.id, choiceId: 'choice_image', kind: 'image' }],
        catalogVersion: 'catalog-1',
        outputRole: 'reference',
        referencePrompts: [
          { sceneId: opening.id, prompt: buildFirstFramePrompt(opening.visualPrompt, routed.aspectRatio) },
        ],
      })
    );
    expect(bridge.dismissReferenceRequests.invoke.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.submitScenes.invoke.mock.invocationCallOrder[0]!
    );
    expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      requestIds: [pendingRequest.id],
    });

    await act(async () => onProposalUpdate?.({ projectId: 'project-1' }));
    await act(async () => onProposalUpdate?.({ projectId: 'project-1' }));
    await act(async () => {});
    expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('reference-exclusion-notice')).toHaveTextContent(excluded.title);
  });

  it('narrows a deferred Director batch when one frozen request disappears and submits the survivors in order', async () => {
    let onProposalUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.proposalUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onProposalUpdate = listener;
      return () => {};
    });
    const first = scene({ id: 'scene-1', title: 'First survivor' });
    const removed = scene({ id: 'scene-2', title: 'Removed middle' });
    const third = scene({ id: 'scene-3', title: 'Third survivor' });
    const requests = [referenceRequest(first.id, 1), referenceRequest(removed.id, 2), referenceRequest(third.id, 3)];
    const unrouted = project('project-1', {
      sceneOrder: [first.id, removed.id, third.id],
      scenes: { [first.id]: first, [removed.id]: removed, [third.id]: third },
      routing: { storyboard: null, image: null, video: null },
    });
    const routed = project('project-1', {
      revision: 3,
      sceneOrder: [first.id, removed.id, third.id],
      scenes: { [first.id]: first, [removed.id]: removed, [third.id]: third },
    });
    const selectableCatalog: StudioRouteCatalog = {
      ...routes(),
      image: {
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [imageRoute()],
      },
    };
    let canonicalProject = unrouted;
    bridge.getProject.invoke.mockImplementation(async () => ok(canonicalProject));
    const queue = installReferenceRequestQueue(requests);
    bridge.updateModelSelection.invoke.mockImplementation(async () => {
      canonicalProject = routed;
      return ok(routed);
    });
    bridge.listRoutes.invoke.mockImplementation(async () =>
      ok(canonicalProject === unrouted ? selectableCatalog : routesWithImage())
    );
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    queue.remove(requests[1]!.id);
    await act(async () => onProposalUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.listPendingReferenceRequests.invoke.mock.calls.length).toBeGreaterThan(1));

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.models.engine.notSetImage' }));
    fireEvent.click(
      within(await screen.findByRole('menu')).getByText('conversation.creativeStudio.models.engine.optionLabel')
    );

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sceneIds: [first.id, third.id],
          routes: [
            { sceneId: first.id, choiceId: 'choice_image', kind: 'image' },
            { sceneId: third.id, choiceId: 'choice_image', kind: 'image' },
          ],
          outputRole: 'reference',
        })
      )
    );
    expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      requestIds: [requests[0]!.id, requests[2]!.id],
    });
  });

  it('releases exact deferred Director mappings after a canonical scene reorder', async () => {
    const first = scene({ id: 'scene-1', title: 'Now second' });
    const second = scene({ id: 'scene-2', title: 'Now first' });
    const requests = [referenceRequest(first.id, 1), referenceRequest(second.id, 2)];
    const unrouted = project('project-1', {
      sceneOrder: [first.id, second.id],
      scenes: { [first.id]: first, [second.id]: second },
      routing: { storyboard: null, image: null, video: null },
    });
    const routed = project('project-1', {
      revision: 3,
      sceneOrder: [second.id, first.id],
      scenes: { [first.id]: first, [second.id]: second },
    });
    const selectableCatalog: StudioRouteCatalog = {
      ...routes(),
      image: {
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [imageRoute()],
      },
    };
    let canonicalProject = unrouted;
    bridge.getProject.invoke.mockImplementation(async () => ok(canonicalProject));
    installReferenceRequestQueue(requests);
    bridge.updateModelSelection.invoke.mockImplementation(async () => {
      canonicalProject = routed;
      return ok(routed);
    });
    bridge.listRoutes.invoke.mockImplementation(async () =>
      ok(canonicalProject === unrouted ? selectableCatalog : routesWithImage())
    );
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.models.engine.notSetImage' }));
    fireEvent.click(
      within(await screen.findByRole('menu')).getByText('conversation.creativeStudio.models.engine.optionLabel')
    );

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sceneIds: [second.id, first.id],
          routes: [
            { sceneId: second.id, choiceId: 'choice_image', kind: 'image' },
            { sceneId: first.id, choiceId: 'choice_image', kind: 'image' },
          ],
          outputRole: 'reference',
        })
      )
    );
  });

  it('submits an eligible deferred Director sibling while surfacing one that became excluded', async () => {
    const ready = scene({ id: 'scene-1', title: 'Still eligible' });
    const newlyExcluded = scene({ id: 'scene-2', title: 'Became plated' });
    const excludedAsset = { ...asset('asset-2'), sceneId: newlyExcluded.id };
    const requests = [referenceRequest(ready.id, 1), referenceRequest(newlyExcluded.id, 2)];
    const unrouted = project('project-1', {
      sceneOrder: [ready.id, newlyExcluded.id],
      scenes: { [ready.id]: ready, [newlyExcluded.id]: newlyExcluded },
      routing: { storyboard: null, image: null, video: null },
    });
    const routed = project('project-1', {
      revision: 3,
      sceneOrder: [ready.id, newlyExcluded.id],
      scenes: {
        [ready.id]: ready,
        [newlyExcluded.id]: {
          ...newlyExcluded,
          assetIds: [excludedAsset.id],
          reviewState: 'needs_selection',
        },
      },
      assets: { [excludedAsset.id]: excludedAsset },
    });
    const selectableCatalog: StudioRouteCatalog = {
      ...routes(),
      image: {
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [imageRoute()],
      },
    };
    let canonicalProject = unrouted;
    bridge.getProject.invoke.mockImplementation(async () => ok(canonicalProject));
    const queue = installReferenceRequestQueue(requests);
    bridge.updateModelSelection.invoke.mockImplementation(async () => {
      canonicalProject = routed;
      return ok(routed);
    });
    bridge.listRoutes.invoke.mockImplementation(async () =>
      ok(canonicalProject === unrouted ? selectableCatalog : routesWithImage())
    );
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.models.engine.notSetImage' }));
    fireEvent.click(
      within(await screen.findByRole('menu')).getByText('conversation.creativeStudio.models.engine.optionLabel')
    );

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sceneIds: [ready.id],
          routes: [{ sceneId: ready.id, choiceId: 'choice_image', kind: 'image' }],
          outputRole: 'reference',
        })
      )
    );
    expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      requestIds: [requests[0]!.id],
    });
    expect(queue.pendingIds()).toEqual([requests[1]!.id]);
    expect(await screen.findByTestId('reference-exclusion-notice')).toHaveTextContent(newlyExcluded.title);
  });

  it('keeps a remapped deferred Director ID fail-closed without stranding its exact sibling', async () => {
    let onProposalUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.proposalUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onProposalUpdate = listener;
      return () => {};
    });
    const exact = scene({ id: 'scene-1', title: 'Exact survivor' });
    const original = scene({ id: 'scene-2', title: 'Original target' });
    const remapped = scene({ id: 'scene-3', title: 'Remapped target' });
    const requests = [referenceRequest(exact.id, 1), referenceRequest(original.id, 2)];
    const unrouted = project('project-1', {
      sceneOrder: [exact.id, original.id, remapped.id],
      scenes: { [exact.id]: exact, [original.id]: original, [remapped.id]: remapped },
      routing: { storyboard: null, image: null, video: null },
    });
    const routed = project('project-1', {
      revision: 3,
      sceneOrder: [exact.id, original.id, remapped.id],
      scenes: { [exact.id]: exact, [original.id]: original, [remapped.id]: remapped },
    });
    const selectableCatalog: StudioRouteCatalog = {
      ...routes(),
      image: {
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [imageRoute()],
      },
    };
    let canonicalProject = unrouted;
    bridge.getProject.invoke.mockImplementation(async () => ok(canonicalProject));
    const queue = installReferenceRequestQueue(requests);
    bridge.updateModelSelection.invoke.mockImplementation(async () => {
      canonicalProject = routed;
      return ok(routed);
    });
    bridge.listRoutes.invoke.mockImplementation(async () =>
      ok(canonicalProject === unrouted ? selectableCatalog : routesWithImage())
    );
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    queue.replace({ ...requests[1]!, sceneId: remapped.id });
    await act(async () => onProposalUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.listPendingReferenceRequests.invoke.mock.calls.length).toBeGreaterThan(1));

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.models.engine.notSetImage' }));
    fireEvent.click(
      within(await screen.findByRole('menu')).getByText('conversation.creativeStudio.models.engine.optionLabel')
    );

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sceneIds: [exact.id],
          routes: [{ sceneId: exact.id, choiceId: 'choice_image', kind: 'image' }],
          outputRole: 'reference',
        })
      )
    );
    expect(bridge.dismissReferenceRequests.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      requestIds: [requests[0]!.id],
    });
    expect(queue.pendingIds()).toEqual([requests[1]!.id]);

    await act(async () => onProposalUpdate?.({ projectId: 'project-1' }));
    await act(async () => onProposalUpdate?.({ projectId: 'project-1' }));
    await act(async () => {});
    expect(bridge.submitScenes.invoke).toHaveBeenCalledOnce();
  });

  it('releases a deferred Director request when the canonical engine became valid before Close', async () => {
    let onProjectUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onProjectUpdate = listener;
      return () => {};
    });
    const opening = scene({ id: 'scene-1', title: 'Already recovered opening', durationSeconds: 5 });
    const pendingRequest = referenceRequest(opening.id, 1);
    const unrouted = project('project-1', {
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
      routing: { storyboard: null, image: null, video: null },
    });
    const routed = project('project-1', {
      revision: 3,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const selectableCatalog: StudioRouteCatalog = {
      ...routes(),
      image: {
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [imageRoute()],
      },
    };
    let canonicalProject = unrouted;
    bridge.getProject.invoke.mockImplementation(async () => ok(canonicalProject));
    bridge.listPendingReferenceRequests.invoke.mockResolvedValue(ok([pendingRequest]));
    bridge.listRoutes.invoke.mockImplementation(async () =>
      ok(canonicalProject === unrouted ? selectableCatalog : routesWithImage())
    );
    renderRoute('/studio/project-1/board');

    const review = await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    canonicalProject = routed;
    await act(async () => onProjectUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(2));
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();

    fireEvent.click(within(review).getByRole('button', { name: 'conversation.creativeStudio.review.setEngines' }));

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sceneIds: [opening.id],
          expectedRevision: routed.revision,
          routes: [{ sceneId: opening.id, choiceId: 'choice_image', kind: 'image' }],
          outputRole: 'reference',
        })
      )
    );
  });

  it('opens batch review after a canonical routing update recovers the catalog', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ durationSeconds: 5 });
    const initial = project('project-1', {
      targetDurationSeconds: 5,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const revisedRoute = imageRoute({
      choiceId: 'choice_image_new',
      providerId: 'provider-image-new',
      providerName: 'New image provider',
      model: 'image-model-new',
    });
    const revised = project('project-1', {
      ...initial,
      revision: 3,
      routing: {
        storyboard: null,
        image: {
          choiceId: revisedRoute.choiceId,
          providerId: revisedRoute.providerId,
          model: revisedRoute.model,
        },
        video: null,
      },
    });
    let canonicalProject = initial;
    bridge.getProject.invoke.mockImplementation(async () => ok(canonicalProject));
    bridge.listRoutes.invoke.mockResolvedValueOnce(failure()).mockResolvedValue(ok(routesWithImage(revisedRoute)));
    renderRoute('/studio/project-1/board');

    expect(
      await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' })
    ).toHaveTextContent('conversation.creativeStudio.models.engine.catalogUnloaded');
    canonicalProject = revised;
    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(2));
    const { batchAction } = await findBatchAction();
    fireEvent.click(batchAction);

    expect(await screen.findByRole('dialog')).toHaveTextContent('conversation.creativeStudio.review.title');
    expect(screen.queryByText('conversation.creativeStudio.models.loading')).not.toBeInTheDocument();
  });

  it('withholds stale shot review actions until the route catalog is ready', async () => {
    const opening = scene({ durationSeconds: 5 });
    const refresh = deferred<StudioCommandResult<StudioRouteCatalog>>();
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 5,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockReturnValueOnce(refresh.promise);
    renderRoute('/studio/project-1/board');

    expect(
      await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' })
    ).toHaveTextContent('conversation.creativeStudio.models.engine.catalogUnloaded');
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.render' })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.models.blocked.catalogUnloaded')).toBeVisible();

    await act(async () => refresh.resolve(ok(routesWithImage())));
    expect(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.phase.produce.render' })
    ).toBeEnabled();
  });

  it('does not build a paid review when route constraints reject a single scene', async () => {
    const opening = scene({ durationSeconds: 61 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 61,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.render' })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.models.blocked.duration')).toBeVisible();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('moves the free duration remedy to the exact Table duration control without routing or spending', async () => {
    const opening = scene({ durationSeconds: 16 });
    const boundedRoute = imageRoute({
      constraints: { ...imageRoute().constraints, minDurationSeconds: 4, maxDurationSeconds: 15 },
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 16,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage(boundedRoute)));
    const { router } = renderRoute('/studio/project-1/board');

    fireEvent.click(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.models.blocked.actionShorten' })
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/table'));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'studio-scene-duration-scene-1'));
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('requires the duplicate-charge acknowledgement path before generating an unresolved scene again', async () => {
    const unknownJob = job('job-unknown', {
      status: 'needs_attention',
      error: {
        code: 'submission_unknown',
        messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
      },
    });
    const opening = scene({
      durationSeconds: 5,
      jobIds: [unknownJob.id],
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 5,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
          jobs: { [unknownJob.id]: unknownJob },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.render' })).toBeDisabled();
    const { batchAction } = await findBatchAction();
    expect(batchAction).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.jobs.retry',
      })
    ).toBeEnabled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.jobs.retry' }));
    const duplicateChargeDialog = await screen.findByRole('dialog');
    expect(duplicateChargeDialog).toHaveTextContent('conversation.creativeStudio.jobs.retryChargeBody');
    expect(duplicateChargeDialog).not.toHaveTextContent('conversation.creativeStudio.jobs.retryConfirmationBody');
    within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.viewsLabel' }))
      .getAllByRole('button')
      .forEach((button) => expect(button).toBeDisabled());
    expect(bridge.retryJob.invoke).not.toHaveBeenCalled();
  });

  it('keeps every needs-attention scene out of single and batch paid generation', async () => {
    const attentionJob = job('job-attention', {
      status: 'needs_attention',
      error: {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
    });
    const opening = scene({
      durationSeconds: 5,
      jobIds: [attentionJob.id],
      reviewState: 'ready',
    });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 5,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
          jobs: { [attentionJob.id]: attentionJob },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    await screen.findByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.render' })).toBeDisabled();
    const { batchAction } = await findBatchAction();
    expect(batchAction).toBeDisabled();
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
  });

  it('refreshes the single project catalog owner once when canonical routing changes', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ durationSeconds: 5 });
    const initial = project('project-1', {
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
      routing: { storyboard: null, image: null, video: null },
    });
    const sameRouting = project('project-1', {
      revision: 3,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
      routing: { storyboard: null, image: null, video: null },
    });
    const routed = project('project-1', {
      revision: 4,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
      routing: {
        storyboard: null,
        image: {
          choiceId: 'choice_image',
          providerId: 'provider-image',
          model: 'image-model',
        },
        video: null,
      },
    });
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(sameRouting))
      .mockResolvedValue(ok(routed));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(1));
    const initialRouteRequestCount = bridge.listRoutes.invoke.mock.calls.length;

    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledTimes(3));
    expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(initialRouteRequestCount);

    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(initialRouteRequestCount + 1));
    await act(async () => {});
    expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(initialRouteRequestCount + 1);
  });

  it('refreshes a paid review after an external revision and requires a second confirmation', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ durationSeconds: 5 });
    const revisedOpening = scene({ title: 'Revised opening', durationSeconds: 6 });
    const initial = project('project-1', {
      targetDurationSeconds: 5,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const revised = project('project-1', {
      revision: 3,
      targetDurationSeconds: 6,
      sceneOrder: [revisedOpening.id],
      scenes: { [revisedOpening.id]: revisedOpening },
      routing: {
        storyboard: null,
        image: {
          choiceId: 'choice_image_new',
          providerId: 'provider-image-new',
          model: 'image-model-new',
        },
        video: null,
      },
    });
    const revisedRoute = imageRoute({
      choiceId: 'choice_image_new',
      providerId: 'provider-image-new',
      providerName: 'New image provider',
      model: 'image-model-new',
    });
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValue(ok(revised));
    bridge.listRoutes.invoke.mockResolvedValueOnce(ok(routesWithImage())).mockResolvedValue(
      ok({
        ...routesWithImage(revisedRoute),
        catalogVersion: 'catalog-2',
      })
    );
    renderRoute('/studio/project-1/board');

    const generateScene = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.phase.produce.render',
    });
    await waitFor(() => expect(generateScene).toBeEnabled());
    fireEvent.click(generateScene);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Opening');

    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    const routeRequestsBeforeConfirmation = bridge.listRoutes.invoke.mock.calls.length;

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    );

    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(routeRequestsBeforeConfirmation + 1));
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Revised opening'));
    expect(screen.getByRole('dialog')).toHaveTextContent('New image provider');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('weprompt-media-gateway-v1');
    expect(screen.getByRole('dialog')).toHaveTextContent('conversation.creativeStudio.errors.staleProject');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    );

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          projectId: 'project-1',
          expectedRevision: 3,
          catalogVersion: 'catalog-2',
          routes: [
            {
              sceneId: 'scene-1',
              choiceId: 'choice_image_new',
              kind: 'image',
            },
          ],
        })
      )
    );
  });

  it('does not widen a frozen batch when stale-project refresh finds another ready scene', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ id: 'scene-1', title: 'Originally reviewed', durationSeconds: 5 });
    const later = scene({ id: 'scene-2', title: 'Ready after review', durationSeconds: 5 });
    const initial = project('project-1', {
      targetDurationSeconds: 5,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const revised = project('project-1', {
      revision: 3,
      targetDurationSeconds: 10,
      sceneOrder: [opening.id, later.id],
      scenes: { [opening.id]: opening, [later.id]: later },
    });
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValue(ok(revised));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    fireEvent.click((await findBatchAction()).batchAction);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Originally reviewed');
    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent('conversation.creativeStudio.errors.staleProject')
    );
    const refreshedReview = screen.getByRole('dialog');
    expect(within(refreshedReview).getAllByRole('article')).toHaveLength(1);
    expect(within(refreshedReview).getByRole('article')).toHaveAccessibleName('Originally reviewed');
    expect(within(refreshedReview).queryByText('Ready after review')).not.toBeInTheDocument();

    fireEvent.click(
      within(refreshedReview).getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })
    );
    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sceneIds: ['scene-1'],
          routes: [{ sceneId: 'scene-1', choiceId: 'choice_image', kind: 'image' }],
        })
      )
    );
  });

  it('preserves a reference prompt and image route when refreshing a stale paid review', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ mediaKind: 'video', durationSeconds: 12 });
    const revisedOpening = scene({
      title: 'Revised opening',
      visualPrompt: '   ',
      mediaKind: 'video',
      durationSeconds: 12,
    });
    const initial = project('project-1', {
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const revisedRoute = imageRoute({
      choiceId: 'choice_image_new',
      providerId: 'provider-image-new',
      providerName: 'New image provider',
      model: 'image-model-new',
    });
    const revised = project('project-1', {
      revision: 3,
      sceneOrder: [revisedOpening.id],
      scenes: { [revisedOpening.id]: revisedOpening },
      routing: {
        storyboard: null,
        image: {
          choiceId: revisedRoute.choiceId,
          providerId: revisedRoute.providerId,
          model: revisedRoute.model,
        },
        video: null,
      },
    });
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValue(ok(revised));
    bridge.listRoutes.invoke.mockResolvedValueOnce(ok(routesWithImage())).mockResolvedValue(
      ok({
        ...routesWithImage(revisedRoute),
        catalogVersion: 'catalog-2',
      })
    );
    renderRoute('/studio/project-1/table');

    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.reference.generate' }));
    const promptDialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });
    fireEvent.change(within(promptDialog).getByLabelText('conversation.creativeStudio.reference.promptLabel'), {
      target: { value: 'Preserved edited reference prompt' },
    });
    fireEvent.click(
      within(promptDialog).getByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    );
    await screen.findByRole('dialog', { name: 'conversation.creativeStudio.review.title' });

    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledTimes(3));
    const routeRequestsBeforeConfirmation = bridge.listRoutes.invoke.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' }));

    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(routeRequestsBeforeConfirmation + 1));
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    const refreshedReview = screen.getByRole('dialog', { name: 'conversation.creativeStudio.review.title' });
    expect(within(refreshedReview).getByText('conversation.creativeStudio.reference.reviewTag')).toBeVisible();
    expect(within(refreshedReview).getByText('New image provider')).toBeVisible();
    const confirm = within(refreshedReview).getByRole('button', {
      name: 'conversation.creativeStudio.review.confirm',
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(bridge.submitScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        mode: 'single',
        sceneIds: ['scene-1'],
        expectedRevision: 3,
        routes: [{ sceneId: 'scene-1', choiceId: 'choice_image_new', kind: 'image' }],
        catalogVersion: 'catalog-2',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene-1', prompt: 'Preserved edited reference prompt' }],
      })
    );
  });

  it('cannot reauthorize a scene that began generating while its paid review was open', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const opening = scene({ durationSeconds: 5 });
    const runningJob = job('job-running', { status: 'running' });
    const generatingOpening = scene({
      durationSeconds: 5,
      reviewState: 'generating',
      jobIds: [runningJob.id],
    });
    const initial = project('project-1', {
      targetDurationSeconds: 5,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const generating = project('project-1', {
      revision: 3,
      targetDurationSeconds: 5,
      sceneOrder: [generatingOpening.id],
      scenes: { [generatingOpening.id]: generatingOpening },
      jobs: { [runningJob.id]: runningJob },
    });
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValue(ok(generating));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    renderRoute('/studio/project-1/board');

    const generateScene = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.phase.produce.render',
    });
    await waitFor(() => expect(generateScene).toBeEnabled());
    fireEvent.click(generateScene);
    await screen.findByRole('dialog');

    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    await screen.findByText('conversation.creativeStudio.jobs.status.running');
    const routeRequestsBeforeConfirmation = bridge.listRoutes.invoke.mock.calls.length;
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    );

    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(routeRequestsBeforeConfirmation + 1));
    expect(bridge.submitScenes.invoke).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    ).toBeDisabled();
  });

  it('blocks repeated confirmation after the backend rejects a reviewed route', async () => {
    const opening = scene({ durationSeconds: 5 });
    bridge.getProject.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          targetDurationSeconds: 5,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.listRoutes.invoke.mockResolvedValue(ok(routesWithImage()));
    bridge.submitScenes.invoke.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid_route',
        messageKey: 'conversation.creativeStudio.errors.invalidRoute',
      },
    });
    renderRoute('/studio/project-1/board');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.produce.render',
      })
    );
    const confirm = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.confirm',
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('dialog')).toHaveTextContent('conversation.creativeStudio.errors.invalidRoute');
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps paid generation in review after a stale result and never resubmits without another confirmation', async () => {
    const opening = scene();
    const initial = project('project-1', {
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
    });
    const refreshed = project('project-1', {
      revision: 3,
      sceneOrder: [opening.id],
      scenes: { [opening.id]: opening },
      routing: {
        storyboard: null,
        image: {
          choiceId: 'choice_image_new',
          providerId: 'provider-image-new',
          model: 'image-model-new',
        },
        video: null,
      },
    });
    const refreshedRoute = imageRoute({
      choiceId: 'choice_image_new',
      providerId: 'provider-image-new',
      providerName: 'New image provider',
      model: 'image-model-new',
    });
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValue(ok(refreshed));
    bridge.listRoutes.invoke
      .mockResolvedValueOnce(ok(routesWithImage()))
      .mockResolvedValue(ok({ ...routesWithImage(refreshedRoute), catalogVersion: 'catalog-2' }));
    bridge.submitScenes.invoke.mockResolvedValueOnce(stale()).mockResolvedValueOnce(ok([]));
    renderRoute('/studio/project-1/board');

    const generateScene = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.phase.produce.render',
    });
    await waitFor(() => expect(generateScene).toBeEnabled());
    fireEvent.click(generateScene);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    );

    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent('conversation.creativeStudio.errors.staleProject')
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('New image provider'));
    expect(screen.getByRole('dialog')).not.toHaveTextContent('weprompt-media-gateway-v1');
    expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(1);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.review.confirm',
      })
    );

    await waitFor(() => expect(bridge.submitScenes.invoke).toHaveBeenCalledTimes(2));
    expect(bridge.submitScenes.invoke.mock.calls[1]?.[0]).toMatchObject({
      projectId: 'project-1',
      expectedRevision: 3,
      catalogVersion: 'catalog-2',
      routes: [
        {
          sceneId: 'scene-1',
          choiceId: 'choice_image_new',
          kind: 'image',
        },
      ],
    });
  });

  it('routes an empty-project add conflict to always-visible recovery controls', async () => {
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(project()))
      .mockResolvedValueOnce(ok(project('project-1', { revision: 3 })));
    bridge.updateScene.invoke.mockResolvedValueOnce(stale());
    renderRoute();

    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.write.addShot' }));

    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    const scriptTable = screen.getByRole('region', {
      name: 'conversation.creativeStudio.phase.write.scriptTableTitle',
    });
    expect(
      await within(scriptTable).findByRole(
        'button',
        {
          name: 'conversation.creativeStudio.storyboard.retry',
        },
        { timeout: 5_000 }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.storyboard.discard',
      })
    ).toBeInTheDocument();
  });

  it('keeps stale scene-save recovery reachable when the canonical refetch removes every scene', async () => {
    const opening = scene();
    bridge.getProject.invoke
      .mockResolvedValueOnce(
        ok(
          project('project-1', {
            sceneOrder: [opening.id],
            scenes: { [opening.id]: opening },
          })
        )
      )
      .mockResolvedValueOnce(
        ok(
          project('project-1', {
            sceneOrder: [opening.id],
            scenes: { [opening.id]: opening },
          })
        )
      )
      .mockResolvedValueOnce(ok(project('project-1', { revision: 3 })));
    bridge.updateScene.invoke.mockResolvedValueOnce(stale());
    renderRoute();

    const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Updated opening' } });
    fireEvent.blur(titleInput);

    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(
      await screen.findByRole(
        'button',
        {
          name: 'conversation.creativeStudio.storyboard.retry',
        },
        { timeout: 5_000 }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.storyboard.discard',
      })
    ).toBeInTheDocument();
  });

  it('allows project navigation while a stale scene recovery choice is visible', async () => {
    const opening = scene();
    let projectOneFetches = 0;
    bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) => {
      if (projectId === 'project-2') return ok(project('project-2'));
      projectOneFetches += 1;
      return ok(
        project('project-1', {
          revision: projectOneFetches === 1 ? 2 : 3,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      );
    });
    bridge.updateScene.invoke.mockResolvedValueOnce(stale());
    const { router } = renderRoute();

    const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Keep this local title' } });
    fireEvent.blur(titleInput);
    const recoveryRow = await screen.findByRole('region', { name: 'Keep this local title' });
    await within(recoveryRow).findByRole(
      'button',
      { name: 'conversation.creativeStudio.storyboard.retry' },
      { timeout: 5_000 }
    );

    await act(async () => router.navigate('/studio/project-2'));

    expect(router.state.location.pathname).toBe('/studio/project-2/table');
    expect(await screen.findByRole('heading', { level: 1, name: 'Second film' })).toBeInTheDocument();
    expect(bridge.getProject.invoke).toHaveBeenCalledWith({ projectId: 'project-2' });
  });

  it('persists a typed scene-save failure and allows leaving the project', async () => {
    const opening = scene();
    bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(
        project(projectId, {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.updateScene.invoke.mockResolvedValueOnce(failure());
    const { router } = renderRoute();

    const titleInput = await screen.findByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Unsaved typed failure' } });
    fireEvent.blur(titleInput);

    const recoveryRow = await screen.findByRole('region', { name: 'Unsaved typed failure' });
    expect(
      within(recoveryRow).getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' })
    ).toBeInTheDocument();
    expect(
      within(recoveryRow).getByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' })
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem('weprompt.studio.drafts.project-1')).toContain('Unsaved typed failure');

    await act(async () => router.navigate('/studio/project-2'));
    expect(router.state.location.pathname).toBe('/studio/project-2/table');
    expect(await screen.findByRole('heading', { level: 1, name: 'Second film' })).toBeInTheDocument();
  });

  it('prioritizes a stale non-save conflict before a queued scene-save issue', async () => {
    const opening = scene();
    const reveal = scene({ id: 'scene-2', title: 'Reveal' });
    const initial = project('project-1', {
      sceneOrder: [opening.id, reveal.id],
      scenes: { [opening.id]: opening, [reveal.id]: reveal },
    });
    const refreshed = project('project-1', {
      revision: 8,
      sceneOrder: [opening.id, reveal.id],
      scenes: { [opening.id]: opening, [reveal.id]: reveal },
    });
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.getProject.invoke
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(initial))
      .mockResolvedValueOnce(ok(refreshed));
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    bridge.reorderScenes.invoke.mockResolvedValueOnce(stale()).mockResolvedValueOnce(
      ok(
        project('project-1', {
          revision: 9,
          sceneOrder: [reveal.id, opening.id],
          scenes: { [opening.id]: opening, [reveal.id]: reveal },
        })
      )
    );
    renderRoute();

    const openingRow = await screen.findByRole('region', { name: 'Opening' });
    const titleInput = within(openingRow).getByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(titleInput, { target: { value: 'Unresolved opening edit' } });
    fireEvent.blur(titleInput);
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    // Selection moves off the edited row. The pacing bar's shot blocks used to be the handle
    // for this; ScriptRow selects on focus capture, so focusing the next row is the equivalent.
    const revealRow = screen.getByRole('region', { name: 'Reveal' });
    within(revealRow).getByLabelText('conversation.creativeStudio.inspector.titleLabel').focus();
    await act(async () => firstSave.resolve(failure()));
    const unresolvedOpeningRow = await screen.findByRole('region', { name: 'Unresolved opening edit' });
    expect(within(unresolvedOpeningRow).getByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'conversation.creativeStudio.storyboard.moveSceneUpAccessible',
      })[1]
    );
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('conversation.creativeStudio.errors.staleProject')).toBeInTheDocument();
    const scriptTable = screen.getByRole('region', {
      name: 'conversation.creativeStudio.phase.write.scriptTableTitle',
    });
    const tableFeedback = scriptTable.querySelector('footer');
    expect(tableFeedback).not.toBeNull();
    fireEvent.click(
      within(tableFeedback!).getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' })
    );
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(2));

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
  });

  it('shows not found when the bridge succeeds with no canonical project', async () => {
    bridge.getProject.invoke.mockResolvedValue(ok(null));
    renderRoute();

    expect(await screen.findByText('conversation.creativeStudio.project.notFound')).toBeInTheDocument();
  });

  it('shows the typed command error separately from not found', async () => {
    bridge.getProject.invoke.mockResolvedValue(failure());
    renderRoute();

    expect(await screen.findByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.project.notFound')).not.toBeInTheDocument();
  });

  it('resets and fetches again when the route project id changes', async () => {
    const { router } = renderRoute('/studio/project-1');
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    bridge.getProject.invoke.mockResolvedValue(ok(project('project-2')));

    await act(async () => router.navigate('/studio/project-2'));

    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenLastCalledWith({ projectId: 'project-2' }));
  });

  it('queries durable proposals on mount and observes a matching proposal event without manual refresh', async () => {
    let onProposal: ((event: { projectId: string; proposalId: string }) => void) | undefined;
    bridge.proposalUpdated.on.mockImplementation(
      (listener: (event: { projectId: string; proposalId: string }) => void) => {
        onProposal = listener;
        return () => {};
      }
    );
    bridge.listProposals.invoke.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([proposal()]));
    render(<ProjectHookHarness />);

    await waitFor(() =>
      expect(bridge.listProposals.invoke).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-1' })
    );
    await act(async () => onProposal?.({ projectId: 'other-project', proposalId: 'proposal_1' }));
    expect(bridge.listProposals.invoke).toHaveBeenCalledTimes(1);

    await act(async () => onProposal?.({ projectId: 'project-1', proposalId: 'proposal_1' }));

    expect(await screen.findByText('Observed proposal')).toBeInTheDocument();
    expect(bridge.listProposals.invoke).toHaveBeenCalledTimes(2);
  });

  it('uses matching turn completion only as an additional durable-ledger refetch signal', async () => {
    let onTurnCompleted: ((event: { session_id: string }) => void) | undefined;
    bridge.getProject.invoke.mockResolvedValue(ok(project('project-1', { briefConversationId: 'conversation_brief' })));
    bridge.turnCompleted.on.mockImplementation((listener: (event: { session_id: string }) => void) => {
      onTurnCompleted = listener;
      return () => {};
    });
    bridge.listProposals.invoke.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([proposal()]));
    render(<ProjectHookHarness />);
    await screen.findByText('Launch film');

    await act(async () => onTurnCompleted?.({ session_id: 'conversation_other' }));
    expect(bridge.listProposals.invoke).toHaveBeenCalledTimes(1);
    await act(async () => onTurnCompleted?.({ session_id: 'conversation_brief' }));

    expect(await screen.findByText('Observed proposal')).toBeInTheDocument();
    expect(bridge.listProposals.invoke).toHaveBeenCalledTimes(2);
  });

  it('flushes a dirty scene draft before switching to another project route', async () => {
    const opening = scene();
    bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(
        project(projectId, {
          sceneOrder: [opening.id],
          scenes: { [opening.id]: opening },
        })
      )
    );
    bridge.updateScene.invoke.mockResolvedValue(
      ok(
        project('project-1', {
          revision: 3,
          sceneOrder: [opening.id],
          scenes: { [opening.id]: { ...opening, title: 'Unsaved project A title' } },
        })
      )
    );
    const { router } = renderRoute('/studio/project-1');
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel'), {
      target: { value: 'Unsaved project A title' },
    });
    await act(async () => router.navigate('/studio/project-2'));

    await waitFor(() =>
      expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
        projectId: 'project-1',
        sceneId: 'scene-1',
        expectedRevision: 2,
        scene: expect.objectContaining({ title: 'Unsaved project A title' }),
      })
    );
  });

  it('refetches only for matching project update events and cleans up', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return unsubscribe;
    });
    const { view } = renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    await act(async () => onUpdate?.({ projectId: 'other-project' }));
    expect(bridge.getProject.invoke).toHaveBeenCalledTimes(2);
    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    expect(bridge.getProject.invoke).toHaveBeenCalledTimes(3);

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the current project visible while a matching event refetches in the background', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const pending = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(pending.promise);
    act(() => onUpdate?.({ projectId: 'project-1' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.project.loading')).not.toBeInTheDocument();

    pending.resolve(ok(project('project-1', { name: 'Updated film', revision: 3 })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Updated film' })).toBeInTheDocument();
  });

  it('keeps the current project visible when a background refetch returns a typed error', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    bridge.getProject.invoke.mockResolvedValueOnce(failure());

    act(() => onUpdate?.({ projectId: 'project-1' }));

    expect(await screen.findByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Launch film' })).toBeInTheDocument();
  });

  it('ignores an older matching-event response that resolves after a newer canonical fetch', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const older = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const newer = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    act(() => {
      onUpdate?.({ projectId: 'project-1' });
      onUpdate?.({ projectId: 'project-1' });
    });
    newer.resolve(ok(project('project-1', { name: 'Newest film', revision: 4 })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Newest film' })).toBeInTheDocument();

    older.resolve(ok(project('project-1', { name: 'Older film', revision: 3 })));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Newest film' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { level: 1, name: 'Older film' })).not.toBeInTheDocument();
  });

  it('adopts a higher revision from an earlier overlapping request even while a later request is pending', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const earlier = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const later = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    act(() => {
      onUpdate?.({ projectId: 'project-1' });
      onUpdate?.({ projectId: 'project-1' });
    });

    earlier.resolve(ok(project('project-1', { name: 'Revision five', revision: 5 })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Revision five' })).toBeInTheDocument();

    later.resolve(ok(project('project-1', { name: 'Revision four', revision: 4 })));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Revision five' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { level: 1, name: 'Revision four' })).not.toBeInTheDocument();
  });

  it('clears a later failed refresh when an earlier overlapping response advances the canonical revision', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const earlier = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const later = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    act(() => {
      onUpdate?.({ projectId: 'project-1' });
      onUpdate?.({ projectId: 'project-1' });
    });

    later.resolve(failure());
    expect(await screen.findByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();

    earlier.resolve(ok(project('project-1', { name: 'Recovered revision five', revision: 5 })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Recovered revision five' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('conversation.creativeStudio.errors.storage')).not.toBeInTheDocument()
    );
  });

  it('adopts an earlier authoritative absence after a later overlapping refresh fails', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const earlier = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const later = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    act(() => {
      onUpdate?.({ projectId: 'project-1' });
      onUpdate?.({ projectId: 'project-1' });
    });

    later.resolve(failure());
    expect(await screen.findByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();

    earlier.resolve(ok(null));
    expect(await screen.findByText('conversation.creativeStudio.project.notFound')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Launch film' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('conversation.creativeStudio.errors.storage')).not.toBeInTheDocument()
    );
  });

  it('does not let an older authoritative absence replace a newer canonical project', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const earlier = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const later = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    act(() => {
      onUpdate?.({ projectId: 'project-1' });
      onUpdate?.({ projectId: 'project-1' });
    });

    later.resolve(ok(project('project-1', { name: 'Newest film', revision: 4 })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Newest film' })).toBeInTheDocument();

    earlier.resolve(ok(null));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Newest film' })).toBeInTheDocument());
    expect(screen.queryByText('conversation.creativeStudio.project.notFound')).not.toBeInTheDocument();
  });

  it('does not let older project data cross a newer authoritative absence', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    renderRoute();
    await screen.findByRole('heading', { level: 1, name: 'Launch film' });

    const earlier = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const later = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    act(() => {
      onUpdate?.({ projectId: 'project-1' });
      onUpdate?.({ projectId: 'project-1' });
    });

    later.resolve(ok(null));
    expect(await screen.findByText('conversation.creativeStudio.project.notFound')).toBeInTheDocument();

    earlier.resolve(ok(project('project-1', { name: 'Resurrected stale film', revision: 5 })));
    await waitFor(() => expect(screen.getByText('conversation.creativeStudio.project.notFound')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { level: 1, name: 'Resurrected stale film' })).not.toBeInTheDocument();
  });

  it('exposes an explicit background refetch for the storyboard editor', async () => {
    render(<ProjectHookHarness />);
    await screen.findByText('Launch film');
    bridge.getProject.invoke.mockResolvedValueOnce(ok(project('project-1', { name: 'Refetched film', revision: 3 })));

    fireEvent.click(screen.getByRole('button', { name: 'Refetch project' }));

    expect(await screen.findByText('Refetched film')).toBeInTheDocument();
    expect(bridge.getProject.invoke).toHaveBeenCalledTimes(2);
  });
});
