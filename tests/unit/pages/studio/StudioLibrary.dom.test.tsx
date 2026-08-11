/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioProjectSummary,
  StudioRendererProject,
  StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import { StudioLibrary } from '@renderer/pages/studio/components';
import { readLastStudioPhase } from '@renderer/pages/studio/studioPhaseRoute';
import SiderStudioEntry from '@renderer/components/layout/Sider/SiderNav/SiderStudioEntry';

const bridge = vi.hoisted(() => ({
  listProjects: { invoke: vi.fn() },
  createProject: { invoke: vi.fn() },
  getProject: { invoke: vi.fn() },
  deleteProject: { invoke: vi.fn() },
  listRoutes: { invoke: vi.fn() },
  projectUpdated: { on: vi.fn() },
}));
const navigate = vi.hoisted(() => vi.fn());
const activeLanguage = vi.hoisted(() => ({ value: 'en-US' }));
const activePlatform = vi.hoisted(() => ({ isMacOS: true }));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
// Creative Studio ships behind a default-off release gate, so the sidebar entry this
// suite asserts on only renders with the flag open.
vi.mock('@/common/config/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/config/constants')>()),
  CREATIVE_STUDIO_ENABLED: true,
}));
vi.mock('@renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  isMacOS: () => activePlatform.isMacOS,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: activeLanguage.value, resolvedLanguage: activeLanguage.value },
    t: (key: string, params?: Record<string, string | number>) => {
      const copy: Record<string, string> = {
        'conversation.creativeStudio.library.composer.label': 'What are we making?',
        'conversation.creativeStudio.library.composer.submit': 'Read my brief →',
        'conversation.creativeStudio.library.composer.empty': 'One sentence is enough — say what we are making.',
        'conversation.creativeStudio.library.composer.attachBrief': 'Attach a brief doc',
        'conversation.creativeStudio.library.composer.attachBriefUnavailable':
          'Brief document attachments are not available yet.',
        'conversation.creativeStudio.library.sectionLabel': 'OR PICK UP WHERE YOU LEFT OFF',
        'conversation.creativeStudio.library.scriptOnly': 'SCRIPT ONLY',
      };
      if (key === 'conversation.creativeStudio.library.deleteConfirmBody') return `${key}:${params?.name}`;
      if (key === 'conversation.creativeStudio.library.shotCount') return `${params?.count} shots`;
      if (key === 'conversation.creativeStudio.library.projectCount') return `${params?.count} projects`;
      if (key === 'conversation.creativeStudio.library.posterBadge') {
        return `TAKE ${params?.take} · SHOT ${params?.scene}`;
      }
      if (key === 'conversation.creativeStudio.library.meta') {
        return `${params?.shots} · ${params?.seconds}s · ${params?.relative}`;
      }
      return copy[key] ?? key;
    },
  }),
}));

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const failure = <T,>(code: 'busy' | 'storage_error'): StudioCommandResult<T> => ({
  ok: false,
  error: { code, messageKey: `conversation.creativeStudio.errors.${code === 'storage_error' ? 'storage' : code}` },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const summary = (overrides: Partial<StudioProjectSummary> = {}): StudioProjectSummary => ({
  id: 'project-1',
  name: 'Launch film',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneCount: 0,
  selectedAssetCount: 0,
  poster: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 4,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const routes = (health: 'ready' | 'setup_required' | 'unavailable' = 'ready'): StudioRouteCatalog => ({
  storyboard: {
    status: health === 'ready' ? 'ready' : 'setup_required',
    selected: health === 'ready' ? { providerId: 'provider-1', model: 'operations-model' } : null,
    options:
      health === 'ready'
        ? [
            {
              providerId: 'provider-1',
              providerName: 'Provider',
              model: 'operations-model',
              health: 'available',
            },
          ]
        : [],
  },
  image: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
  video: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
  catalogVersion: 'catalog-1',
});

describe('StudioLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeLanguage.value = 'en-US';
    activePlatform.isMacOS = true;
    window.localStorage.clear();
    bridge.listProjects.invoke.mockResolvedValue(ok([]));
    bridge.createProject.invoke.mockResolvedValue(ok(project()));
    bridge.getProject.invoke.mockResolvedValue(ok(project()));
    bridge.deleteProject.invoke.mockResolvedValue(ok(true));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    bridge.projectUpdated.on.mockReturnValue(() => {});
  });

  it('shows a loading state before bridge projects resolve', () => {
    bridge.listProjects.invoke.mockReturnValue(new Promise(() => {}));

    render(<StudioLibrary />);

    expect(screen.getByText('conversation.creativeStudio.library.loading')).toBeInTheDocument();
  });

  it('shows an empty state after an empty canonical list', async () => {
    render(<StudioLibrary />);

    expect(await screen.findByText('conversation.creativeStudio.empty.title')).toBeInTheDocument();
    expect(screen.queryByText('OR PICK UP WHERE YOU LEFT OFF')).not.toBeInTheDocument();
  });

  it('shows the continuation header and project count only above a populated grid', async () => {
    bridge.listProjects.invoke.mockResolvedValue(
      ok(Array.from({ length: 6 }, (_, index) => summary({ id: `project-${index + 1}`, name: `Project ${index + 1}` })))
    );

    render(<StudioLibrary />);

    expect(await screen.findByText('OR PICK UP WHERE YOU LEFT OFF')).toBeInTheDocument();
    expect(screen.getByText('6 projects')).toBeInTheDocument();
  });

  it('keeps global Storyboard readiness hidden when the optional probe throws', async () => {
    bridge.listRoutes.invoke.mockRejectedValue(new Error('bridge unavailable'));

    render(<StudioLibrary />);

    await screen.findByText('conversation.creativeStudio.empty.title');
    await act(async () => {});
    expect(screen.queryByText('conversation.creativeStudio.library.readinessLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.library.readinessSetupRequired')).not.toBeInTheDocument();
  });

  it('renders the canonical project summaries returned by the bridge', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));

    render(<StudioLibrary />);

    expect(await screen.findByText('Launch film')).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('0 shots · 15s ·'))).toBeInTheDocument();
  });

  it('creates with the canonical returned id and the explicit 720p default', async () => {
    bridge.createProject.invoke.mockResolvedValue(ok(project({ id: 'canonical-project' })));
    render(<StudioLibrary />);

    fireEvent.change(screen.getByLabelText('What are we making?'), {
      target: { value: 'A brief for a launch video.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read my brief →' }));

    await waitFor(() =>
      expect(bridge.createProject.invoke).toHaveBeenCalledWith({
        name: 'A brief for a launch video.',
        brief: 'A brief for a launch video.',
        aspectRatio: '16:9',
        targetDurationSeconds: 18,
        resolution: '720p',
      })
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/studio/canonical-project/brief'));
    expect(readLastStudioPhase('canonical-project')).toBe('brief');
  });

  it('submits the composer with Command-Enter', async () => {
    bridge.createProject.invoke.mockResolvedValue(ok(project({ id: 'shortcut-project' })));
    render(<StudioLibrary />);

    const composer = screen.getByLabelText('What are we making?');
    fireEvent.change(composer, { target: { value: 'Show how the team ships faster.' } });
    fireEvent.keyDown(composer, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(bridge.createProject.invoke).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith('/studio/shortcut-project/brief');
  });

  it('shows the platform-correct shortcut hint for the supported submit chord', () => {
    const view = render(<StudioLibrary />);

    expect(screen.getByText('⌘↵')).toBeInTheDocument();

    view.unmount();
    activePlatform.isMacOS = false;
    render(<StudioLibrary />);

    expect(screen.getByText('Ctrl+↵')).toBeInTheDocument();
  });

  it('keeps brief-document attachment unavailable when the Library has no import path', () => {
    render(<StudioLibrary />);

    expect(screen.getByRole('button', { name: 'Attach a brief doc' })).toBeDisabled();
  });

  it('shows the one-sentence inline validation without creating', async () => {
    render(<StudioLibrary />);

    fireEvent.click(screen.getByRole('button', { name: 'Read my brief →' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('One sentence is enough — say what we are making.');
    expect(bridge.createProject.invoke).not.toHaveBeenCalled();
  });

  it('shows a canonical poster URL for a rendered project and SCRIPT ONLY otherwise', async () => {
    bridge.listProjects.invoke.mockResolvedValue(
      ok([
        summary({
          id: 'rendered-project',
          name: 'Rendered film',
          sceneCount: 3,
          selectedAssetCount: 1,
          poster: { assetId: 'poster-2', sceneNumber: 2, takeNumber: 3 },
        }),
        summary({ id: 'script-project', name: 'Script film', sceneCount: 4 }),
      ])
    );
    render(<StudioLibrary />);

    expect(await screen.findByRole('img', { name: 'Rendered film' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/rendered-project/poster-2'
    );
    expect(screen.getByText('SCRIPT ONLY')).toBeInTheDocument();
  });

  it('assigns stable gradients to script-only posters from their project ids', async () => {
    bridge.listProjects.invoke.mockResolvedValue(
      ok([summary({ id: 'project-alpha', name: 'Alpha script' }), summary({ id: 'project-beta', name: 'Beta script' })])
    );

    render(<StudioLibrary />);

    const scriptLabels = await screen.findAllByText('SCRIPT ONLY');
    expect(scriptLabels[0].closest('[data-gradient]')).toHaveAttribute('data-gradient', '2');
    expect(scriptLabels[1].closest('[data-gradient]')).toHaveAttribute('data-gradient', '4');
  });

  it('labels a rendered poster with the take first and a zero-padded shot number', async () => {
    bridge.listProjects.invoke.mockResolvedValue(
      ok([
        summary({
          sceneCount: 3,
          selectedAssetCount: 1,
          poster: { assetId: 'poster-2', sceneNumber: 2, takeNumber: 1 },
        }),
      ])
    );

    render(<StudioLibrary />);

    expect(await screen.findByText('TAKE 1 · SHOT 02')).toBeInTheDocument();
  });

  it('formats project recency with Intl.RelativeTimeFormat in the active non-English locale', async () => {
    activeLanguage.value = 'de-DE';
    const updatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString();
    bridge.listProjects.invoke.mockResolvedValue(ok([summary({ updatedAt })]));
    render(<StudioLibrary />);

    const relative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' }).format(-2, 'day');
    expect(await screen.findByText((content) => content.includes(relative))).toBeInTheDocument();
  });

  it('opens a zero-scene project card at Brief', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary({ sceneCount: 0 })]));
    render(<StudioLibrary />);

    fireEvent.click(await screen.findByRole('button', { name: 'Launch film' }));

    expect(navigate).toHaveBeenCalledWith('/studio/project-1/brief');
  });

  it('opens an existing project card at Write when no phase was saved', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary({ sceneCount: 2 })]));
    render(<StudioLibrary />);

    fireEvent.click(await screen.findByRole('button', { name: 'Launch film' }));

    expect(navigate).toHaveBeenCalledWith('/studio/project-1/write');
  });

  it('opens a project card at its saved phase', async () => {
    window.localStorage.setItem('aionui:creative-studio:last-phase:project-1', 'produce');
    bridge.listProjects.invoke.mockResolvedValue(ok([summary({ sceneCount: 2 })]));
    render(<StudioLibrary />);

    fireEvent.click(await screen.findByRole('button', { name: 'Launch film' }));

    expect(navigate).toHaveBeenCalledWith('/studio/project-1/produce');
  });

  it('gives both composer guesses explicit accessible names and defaults', () => {
    render(<StudioLibrary />);

    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.library.composer.aspectRatioLabel' })
    ).toHaveTextContent('16:9');
    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.library.composer.durationLabel' })
    ).toHaveTextContent('conversation.creativeStudio.library.composer.durationGuess');
  });

  it('shows a typed bridge failure without navigating after creation fails', async () => {
    bridge.createProject.invoke.mockResolvedValue(failure<StudioRendererProject>('storage_error'));
    render(<StudioLibrary />);
    fireEvent.change(screen.getByLabelText('What are we making?'), {
      target: { value: 'Failed project sentence.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read my brief →' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.storage');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('fetches the canonical revision before deleting a project', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteProject' }));
    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledWith({ projectId: 'project-1' }));
    expect(
      await screen.findByText('conversation.creativeStudio.library.deleteConfirmBody:Launch film')
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' }));

    expect(bridge.deleteProject.invoke).toHaveBeenCalledWith({ projectId: 'project-1', expectedRevision: 4 });
  });

  it('keeps the hover-revealed delete action keyboard-focusable and activatable', async () => {
    const user = userEvent.setup();
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));
    render(<StudioLibrary />);
    const deleteButton = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.library.deleteProject',
    });

    expect(deleteButton.className).toContain('deleteButton');
    expect(deleteButton.tabIndex).toBe(0);
    deleteButton.focus();
    expect(deleteButton).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(bridge.getProject.invoke).toHaveBeenCalledWith({ projectId: 'project-1' }));
  });

  it('refuses a local deletion when canonical work is active', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));
    bridge.getProject.invoke.mockResolvedValue(
      ok(project({ jobs: { job: { status: 'running' } } } as Partial<StudioRendererProject>))
    );
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteProject' }));

    expect(await screen.findByText('conversation.creativeStudio.library.deleteActiveWork')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' })
    ).not.toBeInTheDocument();
    expect(bridge.deleteProject.invoke).not.toHaveBeenCalled();
  });

  it('renders a busy result when work starts during deletion', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary()]));
    bridge.deleteProject.invoke.mockResolvedValue(failure<boolean>('busy'));
    render(<StudioLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteProject' }));
    await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' });
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.library.deleteConfirm' }));

    expect(
      await within(screen.getByRole('dialog')).findByText('conversation.creativeStudio.errors.busy')
    ).toBeInTheDocument();
  });

  it('keeps the latest project list when an older refresh resolves last', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    const older = deferred<StudioCommandResult<StudioProjectSummary[]>>();
    const newer = deferred<StudioCommandResult<StudioProjectSummary[]>>();
    bridge.listProjects.invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<StudioLibrary />);

    act(() => onUpdate?.({ projectId: 'project-2' }));
    newer.resolve(ok([summary({ id: 'project-2', name: 'Newest project' })]));
    expect(await screen.findByText('Newest project')).toBeInTheDocument();

    older.resolve(ok([summary({ name: 'Older project' })]));
    await waitFor(() => expect(screen.getByText('Newest project')).toBeInTheDocument());
    expect(screen.queryByText('Older project')).not.toBeInTheDocument();
  });

  it('keeps a composer command error when a background project refresh succeeds', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return () => {};
    });
    bridge.createProject.invoke.mockResolvedValue(failure<StudioRendererProject>('storage_error'));
    render(<StudioLibrary />);
    fireEvent.change(screen.getByLabelText('What are we making?'), {
      target: { value: 'Failed project sentence.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read my brief →' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.storage');

    await act(async () => onUpdate?.({ projectId: 'project-1' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.storage');
  });

  it('uses only the latest overlapping canonical delete lookup and disables incompatible triggers', async () => {
    bridge.listProjects.invoke.mockResolvedValue(ok([summary(), summary({ id: 'project-2', name: 'Second film' })]));
    const first = deferred<StudioCommandResult<StudioRendererProject | null>>();
    const second = deferred<StudioCommandResult<StudioRendererProject | null>>();
    bridge.getProject.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<StudioLibrary />);
    const deleteButtons = await screen.findAllByRole('button', {
      name: 'conversation.creativeStudio.library.deleteProject',
    });

    act(() => {
      deleteButtons[0].click();
      deleteButtons[1].click();
    });
    expect(screen.getByRole('button', { name: 'Read my brief →' })).toBeDisabled();
    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[1]).toBeDisabled();

    second.resolve(ok(project({ id: 'project-2', name: 'Second film' })));
    expect(
      await screen.findByText('conversation.creativeStudio.library.deleteConfirmBody:Second film')
    ).toBeInTheDocument();

    first.resolve(ok(project()));
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.library.deleteConfirmBody:Second film')).toBeInTheDocument()
    );
    expect(
      screen.queryByText('conversation.creativeStudio.library.deleteConfirmBody:Launch film')
    ).not.toBeInTheDocument();
  });

  it('refreshes the library for a project update and cleans up its subscription', async () => {
    let onUpdate: ((event: { projectId: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    bridge.projectUpdated.on.mockImplementation((listener: (event: { projectId: string }) => void) => {
      onUpdate = listener;
      return unsubscribe;
    });
    const view = render(<StudioLibrary />);
    await screen.findByText('conversation.creativeStudio.empty.title');

    await act(async () => onUpdate?.({ projectId: 'project-1' }));
    expect(bridge.listProjects.invoke).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('keeps only the Studio library navigation entry in the expanded sidebar', () => {
    bridge.listProjects.invoke.mockResolvedValue(
      ok([
        summary({ id: 'one', name: 'One' }),
        summary({ id: 'two', name: 'Two' }),
        summary({ id: 'three', name: 'Three' }),
        summary({ id: 'four', name: 'Four' }),
      ])
    );

    render(
      <SiderStudioEntry
        isMobile={false}
        isActive
        collapsed={false}
        siderTooltipProps={{ disabled: true }}
        onClick={() => navigate('/studio')}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.nav.title' }));

    expect(navigate).toHaveBeenCalledWith('/studio');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.queryByText(/ALL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NO MEDIA CREDITS HERE/)).not.toBeInTheDocument();
    expect(bridge.listProjects.invoke).not.toHaveBeenCalled();
    expect(bridge.projectUpdated.on).not.toHaveBeenCalled();
  });
});
