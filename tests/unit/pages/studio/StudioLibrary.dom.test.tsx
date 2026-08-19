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

const ok = <T,>(data: T) => ({ ok: true as const, data });

const summary = (overrides: Partial<StudioProjectSummaryV2> = {}): StudioProjectSummaryV2 => ({
  id: 'project_1',
  name: 'Launch film',
  aspectRatio: '16:9',
  targetDurationSeconds: 18,
  resolution: '720p',
  beatCount: 2,
  shotCount: 5,
  selectedTakeCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const project = (): StudioRendererProjectV2 => ({
  schemaVersion: 2,
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
  matchToShotId: null,
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

describe('StudioLibrary schema-2 cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({ projects: [summary()], unsupportedProjectIds: [], quarantinedProjectIds: [] })
    );
    mocks.bridge.createProject.invoke.mockResolvedValue(ok(project()));
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: project() }));
    mocks.bridge.deleteProject.invoke.mockResolvedValue(ok(true));
  });

  it('renders Beat/Shot summaries from the schema-2 list wrapper', async () => {
    renderLibrary();

    expect(await screen.findByRole('button', { name: 'Launch film' })).toBeVisible();
    expect(screen.getByText(/workspace\.library\.beatCount/)).toBeVisible();
    expect(screen.getByText(/workspace\.library\.shotCount/)).toBeVisible();
    expect(screen.getByText(/workspace\.library\.selectedTakeCount/)).toBeVisible();
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

  it('loads the current revision before deletion and sends no job-derived authority', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByLabelText('conversation.creativeStudio.workspace.library.deleteProject'));
    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledWith({ projectId: 'project_1' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.library.deleteConfirm' })
    );

    await waitFor(() =>
      expect(mocks.bridge.deleteProject.invoke).toHaveBeenCalledWith({ projectId: 'project_1', expectedRevision: 7 })
    );
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

    expect(await screen.findByRole('img', { name: 'Launch film' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project_1/asset_1'
    );
  });
});
