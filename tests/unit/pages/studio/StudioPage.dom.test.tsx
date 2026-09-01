import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioProjectLoadResultV3 } from '@/common/types/project/creativeStudioTypes';

const mocks = vi.hoisted(() => {
  const closeHandlers = {
    hasUnsavedWork: null as null | (() => { dirtyDraftCount: number }),
    flushUnsavedWork: null as null | (() => Promise<{ saved: boolean }> | { saved: boolean }),
  };
  const supportedProject: Extract<StudioProjectLoadResultV3, { status: 'supported' }> = {
    status: 'supported',
    summary: {
      id: 'project_1',
      name: 'Pilot light',
      pieceCount: 0,
      currentPieceCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    canvas: { projectId: 'project_1', revision: 1, authoringRevision: 1, pieces: [] },
    director: { brief: '', rules: [], briefConversationId: null },
    activity: { projectId: 'project_1', preparedPhotoQuotes: [], jobs: [] },
    spendPolicy: null,
    lastUndo: null,
  };
  return {
    closeHandlers,
    supportedProject,
    translate: (key: string) =>
      ({
        'conversation.creativeStudio.pilot.library.title': 'Projects',
        'conversation.creativeStudio.pilot.library.eyebrow': 'Creative Studio Pilot',
        'conversation.creativeStudio.pilot.library.subtitle': 'Still-image projects',
        'conversation.creativeStudio.pilot.library.newProject': 'New project',
        'conversation.creativeStudio.pilot.library.projectName': 'Project name',
        'conversation.creativeStudio.pilot.library.brief': 'Brief',
        'conversation.creativeStudio.pilot.library.createProject': 'Create project',
        'conversation.creativeStudio.pilot.library.loading': 'Loading projects…',
        'conversation.creativeStudio.pilot.library.emptyTitle': 'No projects yet',
        'conversation.creativeStudio.pilot.library.emptyBody': 'Create a project to begin.',
        'conversation.creativeStudio.pilot.canvas.startCreating': 'Start creating',
        'conversation.creativeStudio.pilot.canvas.actions.createPhoto': 'Create photo',
        'conversation.creativeStudio.pilot.canvas.actions.importPhoto': 'Import photo',
      })[key] ?? key,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    legacy: {
      hasUnsavedWork: {
        provider: vi.fn((handler: () => { dirtyDraftCount: number }) => {
          closeHandlers.hasUnsavedWork = handler;
          return vi.fn();
        }),
      },
      flushUnsavedWork: {
        provider: vi.fn((handler: () => Promise<{ saved: boolean }> | { saved: boolean }) => {
          closeHandlers.flushUnsavedWork = handler;
          return vi.fn();
        }),
      },
    },
    pilot: {
      listProjects: { invoke: vi.fn(async () => ({ ok: true as const, data: { entries: [] } })) },
      createProject: { invoke: vi.fn() },
      loadProject: { invoke: vi.fn(async () => ({ ok: true as const, data: supportedProject })) },
      preparePhoto: { invoke: vi.fn() },
      confirmPreparedPhoto: { invoke: vi.fn() },
      discardPreparedPhoto: { invoke: vi.fn() },
      importPhoto: { invoke: vi.fn() },
      applyMutationBatch: { invoke: vi.fn() },
      cancelJob: { invoke: vi.fn() },
      resumeJob: { invoke: vi.fn() },
      retryDownload: { invoke: vi.fn() },
      listPieceExports: { invoke: vi.fn() },
      exportPiece: { invoke: vi.fn() },
      revealPieceExport: { invoke: vi.fn() },
      deleteProject: { invoke: vi.fn() },
      projectUpdated: { on: vi.fn(() => vi.fn()) },
    },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: { creativeStudio: mocks.legacy, creativeStudioPilot: mocks.pilot },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.translate,
    i18n: mocks.i18n,
  }),
}));

vi.mock('@/renderer/pages/studio/components/Pilot/PilotDirectorRail', () => ({
  PilotDirectorRail: () => <aside aria-label='Director'>Director rail</aside>,
}));

import StudioPage from '@/renderer/pages/studio/StudioPage';

const renderRoute = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/studio/:id' element={<StudioPage />} />
        <Route path='/studio' element={<StudioPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('Creative Studio Pilot production page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeHandlers.hasUnsavedWork = null;
    mocks.closeHandlers.flushUnsavedWork = null;
    mocks.pilot.listProjects.invoke.mockResolvedValue({ ok: true, data: { entries: [] } });
    mocks.pilot.loadProject.invoke.mockResolvedValue({ ok: true, data: mocks.supportedProject });
  });

  it('loads the schema-6 library through the Pilot bridge', async () => {
    renderRoute('/studio');

    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    expect(mocks.pilot.listProjects.invoke).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'New project' })).toBeVisible();
  });

  it('opens the viewless canvas with exactly the empty Create and Import actions', async () => {
    renderRoute('/studio/project_1');

    expect(await screen.findByRole('heading', { level: 1, name: 'Pilot light' })).toBeVisible();
    expect(mocks.pilot.loadProject.invoke).toHaveBeenCalledWith({ projectId: 'project_1' });
    expect(screen.getByRole('button', { name: 'Create photo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import photo' })).toBeVisible();
    expect(screen.queryByText('References')).not.toBeInTheDocument();
    expect(screen.queryByText('Board')).not.toBeInTheDocument();
  });

  it('publishes a draft-free close contract without reading retired session storage', async () => {
    renderRoute('/studio');
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork).not.toBeNull());

    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 });
    await expect(Promise.resolve(mocks.closeHandlers.flushUnsavedWork?.())).resolves.toEqual({ saved: true });
  });
});
