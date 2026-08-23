import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioProjectSummaryV2, StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';

const mocks = vi.hoisted(() => ({
  bridge: {
    listProjects: { invoke: vi.fn() },
    createProject: { invoke: vi.fn() },
    getProject: { invoke: vi.fn() },
    deleteProject: { invoke: vi.fn() },
    projectUpdated: { on: vi.fn(() => vi.fn()) },
  },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: mocks.bridge } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import { StudioLibrary } from '@/renderer/pages/studio/components/Library/StudioLibrary';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

const ok = <T,>(data: T) => ({ ok: true as const, data });

const summary = (overrides: Partial<StudioProjectSummaryV2> = {}): StudioProjectSummaryV2 => ({
  id: 'project_1',
  name: 'Launch film',
  aspectRatio: '16:9',
  targetDurationSeconds: 18,
  resolution: '720p',
  beatCount: 2,
  shotCount: 5,
  pictureCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const project = (): StudioRendererProjectV2 => ({
  schemaVersion: 3,
  revision: 7,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A launch film.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 18,
  resolution: '720p',
  beatOrder: [],
  beats: {},
  shots: {},
  bin: [],
  bedAssetId: null,
  spendPolicy: null,
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid='location'>{location.pathname}</output>;
};

const renderLibrary = () =>
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route
          path='*'
          element={
            <>
              <StudioLibrary />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe('StudioLibrary schema-3 projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({ projects: [summary()], unsupportedProjectIds: [], quarantinedProjectIds: [] })
    );
    mocks.bridge.createProject.invoke.mockResolvedValue(ok(project()));
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: project() }));
    mocks.bridge.deleteProject.invoke.mockResolvedValue(ok(true));
  });

  it('rejects unsafe managed-asset URL identities at the renderer boundary', () => {
    expect(createManagedStudioAssetUrl('../project', 'asset_1')).toBeNull();
    expect(createManagedStudioAssetUrl('project_1', 'asset/1')).toBeNull();
  });

  it('renders Beat/Shot/picture summaries from the project list wrapper', async () => {
    renderLibrary();

    expect(await screen.findByRole('button', { name: 'Launch film' })).toBeVisible();
    expect(screen.getByText(/workspace\.library\.beatCount/)).toBeVisible();
    expect(screen.getByText(/workspace\.library\.shotCount/)).toBeVisible();
    expect(screen.getByText(/workspace\.library\.pictureCount/)).toBeVisible();
  });

  it('surfaces unsupported and quarantined project identities instead of hiding them', async () => {
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({ projects: [], unsupportedProjectIds: ['legacy_1'], quarantinedProjectIds: ['broken_1'] })
    );

    renderLibrary();

    expect(await screen.findByText('legacy_1')).toBeVisible();
    expect(screen.getByText('broken_1')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.library.unsupportedTitle')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.library.quarantinedTitle')).toBeVisible();
  });

  it('creates a schema-2 project and opens Table', async () => {
    renderLibrary();
    fireEvent.change(await screen.findByLabelText('conversation.creativeStudio.workspace.library.composer.label'), {
      target: { value: 'A launch film.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.library.composer.submit' })
    );

    await waitFor(() =>
      expect(mocks.bridge.createProject.invoke).toHaveBeenCalledWith({
        name: 'A launch film.',
        brief: 'A launch film.',
        aspectRatio: '16:9',
        targetDurationSeconds: 18,
        resolution: '720p',
      })
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
  });

  it('keeps a whitespace-only Brief local and supports the explicit keyboard submit gesture', async () => {
    renderLibrary();
    const composer = await screen.findByLabelText('conversation.creativeStudio.workspace.library.composer.label');
    fireEvent.change(composer, { target: { value: '   ' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.library.composer.submit' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'conversation.creativeStudio.workspace.library.composer.empty'
    );
    expect(composer).toHaveAttribute('aria-describedby', 'studio-composer-error');
    expect(mocks.bridge.createProject.invoke).not.toHaveBeenCalled();

    fireEvent.change(composer, { target: { value: 'Keyboard launch' } });
    expect(screen.queryByText('conversation.creativeStudio.workspace.library.composer.empty')).toBeNull();
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(mocks.bridge.createProject.invoke).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });

    await waitFor(() =>
      expect(mocks.bridge.createProject.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Keyboard launch', brief: 'Keyboard launch' })
      )
    );
  });

  it('surfaces list and create failures without navigating or retrying', async () => {
    mocks.bridge.listProjects.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.listFailed' },
    });
    const first = renderLibrary();

    expect(await screen.findByRole('alert')).toHaveTextContent('native.listFailed');
    expect(mocks.bridge.listProjects.invoke).toHaveBeenCalledTimes(1);
    first.unmount();

    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({ projects: [], unsupportedProjectIds: [], quarantinedProjectIds: [] })
    );
    mocks.bridge.createProject.invoke.mockRejectedValue(new Error('offline'));
    renderLibrary();
    const composer = await screen.findByLabelText('conversation.creativeStudio.workspace.library.composer.label');
    fireEvent.change(composer, { target: { value: 'Offline launch' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.library.composer.submit' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.workspace.errors.storage');
    expect(screen.getByTestId('location')).toHaveTextContent('/studio');
    expect(mocks.bridge.createProject.invoke).toHaveBeenCalledTimes(1);
  });

  it('preserves the library on explicit create and delete-preparation command failures', async () => {
    mocks.bridge.createProject.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.createFailed' },
    });
    const first = renderLibrary();
    const composer = await screen.findByLabelText('conversation.creativeStudio.workspace.library.composer.label');
    fireEvent.change(composer, { target: { value: 'Rejected launch' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.library.composer.submit' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('native.createFailed');
    expect(screen.getByTestId('location')).toHaveTextContent('/studio');
    first.unmount();

    mocks.bridge.getProject.invoke.mockRejectedValue(new Error('offline'));
    renderLibrary();
    fireEvent.click(await screen.findByLabelText('conversation.creativeStudio.workspace.library.deleteProject'));
    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.workspace.errors.storage');
    expect(mocks.bridge.deleteProject.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 'conversation.creativeStudio.workspace.project.notFound'],
    ['unsupported_prototype_schema', 'conversation.creativeStudio.workspace.project.unsupportedPrototype'],
  ] as const)('refuses deletion when the fresh project snapshot is %s', async (status, messageKey) => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status, projectId: 'project_1' }));
    renderLibrary();

    fireEvent.click(await screen.findByLabelText('conversation.creativeStudio.workspace.library.deleteProject'));

    expect(await screen.findByRole('alert')).toHaveTextContent(messageKey);
    expect(mocks.bridge.deleteProject.invoke).not.toHaveBeenCalled();
  });

  it('keeps the delete dialog open when the revision-bound deletion fails', async () => {
    mocks.bridge.deleteProject.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'stale_revision', messageKey: 'native.staleRevision' },
    });
    renderLibrary();
    fireEvent.click(await screen.findByLabelText('conversation.creativeStudio.workspace.library.deleteProject'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.workspace.library.deleteConfirm' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('native.staleRevision');
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.library.deleteConfirm' })
    ).toBeVisible();
  });

  it('loads the current revision before deletion and sends no job-derived authority', async () => {
    window.sessionStorage.setItem('aionui:creative-studio:v2:workspace-drafts:project_1', '{"stale":true}');
    window.sessionStorage.setItem('aionui:creative-studio:v2:rule-drafts:project_1', '{"stale":true}');
    renderLibrary();
    fireEvent.click(await screen.findByLabelText('conversation.creativeStudio.workspace.library.deleteProject'));
    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledWith({ projectId: 'project_1' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.library.deleteConfirm' })
    );

    await waitFor(() =>
      expect(mocks.bridge.deleteProject.invoke).toHaveBeenCalledWith({ projectId: 'project_1', expectedRevision: 7 })
    );
    await waitFor(() => {
      expect(window.sessionStorage.getItem('aionui:creative-studio:v2:workspace-drafts:project_1')).toBeNull();
      expect(window.sessionStorage.getItem('aionui:creative-studio:v2:rule-drafts:project_1')).toBeNull();
    });
  });

  it('uses the neutral managed-asset URL for a schema-2 poster', async () => {
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({
        projects: [
          summary({
            poster: { beatId: 'beat_1', shotId: 'shot_1', assetId: 'asset_1', beatPosition: 1, shotPosition: 2 },
          }),
        ],
        unsupportedProjectIds: [],
        quarantinedProjectIds: [],
      })
    );

    renderLibrary();

    const poster = await screen.findByRole('img', { name: 'Launch film' });
    expect(poster).toHaveAttribute('src', 'weprompt-studio://asset/project_1/asset_1');
    fireEvent.error(poster);
    expect(screen.getByText('conversation.creativeStudio.workspace.library.noPoster')).toBeVisible();
  });

  it('distinguishes complete and untouched projects and opens the remembered workspace entry', async () => {
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({
        projects: [
          summary({ id: 'project_complete', name: 'Complete film', shotCount: 2, pictureCount: 2 }),
          summary({ id: 'project_spine', name: 'Spine only', pictureCount: 0 }),
        ],
        unsupportedProjectIds: [],
        quarantinedProjectIds: [],
      })
    );
    renderLibrary();

    const complete = await screen.findByText('conversation.creativeStudio.workspace.library.status.complete');
    const spine = screen.getByText('conversation.creativeStudio.workspace.library.status.spineOnly');
    expect(complete.closest('[data-status]')).toHaveAttribute('data-status', 'complete');
    expect(spine.closest('[data-status]')).toHaveAttribute('data-status', 'spine');

    fireEvent.click(screen.getByRole('button', { name: 'Complete film' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_complete/table'));
  });
});
