import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioProjectStatusStageIdV2,
  type StudioProjectStatusStageV2,
  type StudioProjectStatusV2,
  type StudioProjectSummaryV2,
  type StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';

const mocks = vi.hoisted(() => ({
  projectUpdatedListener: null as null | ((payload: { projectId: string }) => void),
  bridge: {
    listProjects: { invoke: vi.fn() },
    createProject: { invoke: vi.fn() },
    getProject: { invoke: vi.fn() },
    deleteProject: { invoke: vi.fn() },
    getProjectStatus: { invoke: vi.fn() },
    projectUpdated: { on: vi.fn() },
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

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
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 7,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A launch film.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 18,
  resolution: '720p',
  boardStyle: null,
  beatOrder: [],
  beats: {},
  shots: {},
  referenceOrder: [],
  references: {},
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

const projectStatus = (
  overrides: Partial<StudioProjectStatusV2> & { projectId?: string; projectRevision?: number } = {}
): StudioProjectStatusV2 => {
  const productionBlocker = {
    cause: 'generation_timeout' as const,
    where: {
      kind: 'shot' as const,
      beatId: 'beat_1',
      shotId: 'shot_4',
      beatPosition: 2,
      shotPosition: 4,
      jobId: 'job_4',
    },
    remedy: { kind: 'owner_only' as const, reason: 'review_job_recovery' as const },
  };
  const stages: StudioProjectStatusStageV2[] = [
    { id: 'brief', state: 'complete', summary: { stage: 'brief', hasBrief: true }, blockers: [] },
    {
      id: 'engines',
      state: 'complete',
      summary: { stage: 'engines', image: 'ready', video: 'ready' },
      blockers: [],
    },
    {
      id: 'references',
      state: 'complete',
      summary: { stage: 'references', plannedCount: 2, approvedCount: 2 },
      blockers: [],
    },
    {
      id: 'storyboard',
      state: 'complete',
      summary: {
        stage: 'storyboard',
        beatCount: 2,
        shotCount: 5,
        authoredShotCount: 5,
        plannedSeconds: 18,
        targetSeconds: 18,
      },
      blockers: [],
    },
    {
      id: 'bindings',
      state: 'complete',
      summary: { stage: 'bindings', readyShotCount: 5, shotCount: 5, maxConditioningImages: 3 },
      blockers: [],
    },
    {
      id: 'production',
      state: 'blocked',
      summary: { stage: 'production', currentTakeCount: 3, shotCount: 5, activeJobCount: 0 },
      blockers: [productionBlocker],
    },
    {
      id: 'cut',
      state: 'not_started',
      summary: {
        stage: 'cut',
        currentTakeCount: 3,
        shotCount: 5,
        durationSeconds: null,
        targetSeconds: 18,
        structurallyPlayable: false,
      },
      blockers: [],
    },
  ];
  return {
    projectId: 'project_1',
    projectRevision: 7,
    catalogVersion: 'catalog_1',
    stages,
    blockerCount: 1,
    advisories: [],
    boards: { currentPictureCount: 0, shotCount: 5 },
    detail: null,
    ...overrides,
  };
};

const projectStatusAtStage = (stageId: StudioProjectStatusStageIdV2): StudioProjectStatusV2 => {
  const status = projectStatus();
  const position = status.stages.findIndex((stage) => stage.id === stageId);
  status.stages = status.stages.map(
    (stage, index): StudioProjectStatusStageV2 => ({
      ...stage,
      state: index < position ? 'complete' : index === position ? 'in_progress' : 'not_started',
      blockers: [],
    })
  );
  status.blockerCount = 0;
  return status;
};

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

describe('StudioLibrary current-schema projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({
        projects: [summary()],
        projectRevisions: [{ projectId: 'project_1', revision: 7 }],
        unsupportedProjectIds: [],
        quarantinedProjectIds: [],
      })
    );
    mocks.bridge.getProjectStatus.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(projectStatus({ projectId }))
    );
    mocks.projectUpdatedListener = null;
    mocks.bridge.projectUpdated.on.mockImplementation((listener) => {
      mocks.projectUpdatedListener = listener;
      return vi.fn(() => {
        if (mocks.projectUpdatedListener === listener) mocks.projectUpdatedListener = null;
      });
    });
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
      ok({
        projects: [],
        projectRevisions: [],
        unsupportedProjectIds: ['legacy_1'],
        quarantinedProjectIds: ['broken_1'],
      })
    );

    renderLibrary();

    expect(await screen.findByText('legacy_1')).toBeVisible();
    expect(screen.getByText('broken_1')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.library.unsupportedTitle')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.library.quarantinedTitle')).toBeVisible();
  });

  it('creates a project through the view-less entry so first reference work can take precedence', async () => {
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
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('/studio/project_1/table');
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
      ok({ projects: [], projectRevisions: [], unsupportedProjectIds: [], quarantinedProjectIds: [] })
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
        projectRevisions: [{ projectId: 'project_1', revision: 7 }],
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

  it('uses Main project status instead of inferring card state from picture counts', async () => {
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({
        projects: [summary({ id: 'project_complete', name: 'Complete film', shotCount: 5, pictureCount: 5 })],
        projectRevisions: [{ projectId: 'project_complete', revision: 7 }],
        unsupportedProjectIds: [],
        quarantinedProjectIds: [],
      })
    );
    mocks.bridge.getProjectStatus.invoke.mockResolvedValue(
      ok(projectStatus({ projectId: 'project_complete', projectRevision: 7 }))
    );
    renderLibrary();

    const statusLine = await screen.findByText(
      /conversation\.creativeStudio\.workspace\.library\.projectStatus\.summary/
    );
    expect(statusLine.closest('[data-status]')).toHaveAttribute('data-status', 'blocked');
    expect(statusLine).toHaveTextContent('conversation.creativeStudio.workspace.project.blockers');

    fireEvent.click(screen.getByRole('button', { name: 'Complete film' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_complete'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('/studio/project_complete/table');
  });

  it.each([
    ['brief', 'progress.needsWork'],
    ['engines', 'progress.needsWork'],
    ['references', 'progress.references'],
    ['storyboard', 'progress.shots'],
    ['bindings', 'progress.shots'],
    ['cut', 'progress.shots'],
  ] as const)('renders Main-owned %s progress without a renderer heuristic', async (stageId, progressKey) => {
    mocks.bridge.getProjectStatus.invoke.mockResolvedValue(ok(projectStatusAtStage(stageId)));

    renderLibrary();

    const statusLine = await screen.findByText(
      /conversation\.creativeStudio\.workspace\.library\.projectStatus\.summary/
    );
    expect(statusLine).toHaveTextContent(
      `conversation.creativeStudio.workspace.library.projectStatus.stage.${stageId}`
    );
    expect(statusLine).toHaveTextContent(`conversation.creativeStudio.workspace.library.projectStatus.${progressKey}`);
    expect(statusLine.closest('[data-status]')).toHaveAttribute('data-status', 'in_progress');
  });

  it('fails closed when a card status does not match the listed project revision', async () => {
    mocks.bridge.listProjects.invoke.mockResolvedValue(
      ok({
        projects: [summary({ shotCount: 5, pictureCount: 5 })],
        projectRevisions: [{ projectId: 'project_1', revision: 8 }],
        unsupportedProjectIds: [],
        quarantinedProjectIds: [],
      })
    );
    mocks.bridge.getProjectStatus.invoke.mockResolvedValue(ok(projectStatus({ projectRevision: 7 })));

    renderLibrary();

    const unavailable = await screen.findByText(
      'conversation.creativeStudio.workspace.library.projectStatus.unavailable'
    );
    expect(unavailable.closest('[data-status]')).toHaveAttribute('data-status', 'unavailable');
    expect(screen.queryByText(/workspace\.library\.status\.(complete|partial|spineOnly)/)).toBeNull();
  });

  it('refreshes live provider-backed status on focus without requiring a project mutation', async () => {
    const recovered = projectStatus();
    recovered.stages = recovered.stages.map((stage) =>
      stage.id === 'production' || stage.id === 'cut'
        ? ({ ...stage, state: 'complete', blockers: [] } as StudioProjectStatusStageV2)
        : stage
    );
    recovered.blockerCount = 0;
    mocks.bridge.getProjectStatus.invoke.mockResolvedValueOnce(ok(projectStatus())).mockResolvedValue(ok(recovered));

    renderLibrary();

    const initial = await screen.findByText(/conversation\.creativeStudio\.workspace\.library\.projectStatus\.summary/);
    expect(initial.closest('[data-status]')).toHaveAttribute('data-status', 'blocked');
    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(mocks.bridge.getProjectStatus.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const refreshed = screen.getByText(/conversation\.creativeStudio\.workspace\.library\.projectStatus\.summary/);
      expect(refreshed.closest('[data-status]')).toHaveAttribute('data-status', 'complete');
      expect(refreshed).toHaveTextContent('conversation.creativeStudio.workspace.library.projectStatus.stage.cut');
    });
    expect(mocks.projectUpdatedListener).not.toBeNull();
  });

  it('coalesces project update bursts into one trailing status refresh', async () => {
    const firstList = deferred<{
      ok: true;
      data: {
        projects: StudioProjectSummaryV2[];
        projectRevisions: { projectId: string; revision: number }[];
        unsupportedProjectIds: string[];
        quarantinedProjectIds: string[];
      };
    }>();
    const listing = ok({
      projects: [summary()],
      projectRevisions: [{ projectId: 'project_1', revision: 7 }],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    mocks.bridge.listProjects.invoke.mockReturnValueOnce(firstList.promise).mockResolvedValue(listing);

    renderLibrary();
    await waitFor(() => expect(mocks.bridge.listProjects.invoke).toHaveBeenCalledTimes(1));
    act(() => {
      mocks.projectUpdatedListener?.({ projectId: 'project_1' });
      mocks.projectUpdatedListener?.({ projectId: 'project_1' });
    });
    expect(mocks.bridge.listProjects.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstList.resolve(listing);
      await firstList.promise;
    });
    await waitFor(() => expect(mocks.bridge.listProjects.invoke).toHaveBeenCalledTimes(2));
    await screen.findByText(/conversation\.creativeStudio\.workspace\.library\.projectStatus\.summary/);
    expect(mocks.bridge.listProjects.invoke).toHaveBeenCalledTimes(2);
  });
});
