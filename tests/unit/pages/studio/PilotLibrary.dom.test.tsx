import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  StudioProjectLibraryEntryV3,
  StudioProjectLoadResultV3,
  StudioProjectSummaryV3,
} from '@/common/types/project/creativeStudioTypes';
import { PilotLibrary, type StudioPilotLibraryClientV3 } from '@/renderer/pages/studio/components/Pilot';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

const summary = (overrides: Partial<StudioProjectSummaryV3> = {}): StudioProjectSummaryV3 => ({
  id: 'project_1',
  name: 'Light studies',
  pieceCount: 3,
  currentPieceCount: 2,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T01:00:00.000Z',
  ...overrides,
});

const supportedEntry = (
  overrides: Partial<StudioProjectSummaryV3> = {}
): Extract<StudioProjectLibraryEntryV3, { status: 'supported' }> => ({
  status: 'supported',
  summary: summary(overrides),
});

const unreadableEntry = (
  status: 'unsupported' | 'quarantined',
  projectId: string
): Extract<StudioProjectLibraryEntryV3, { status: 'unsupported' | 'quarantined' }> => ({
  status,
  projectId,
  deletionClaim: `studio-delete-v3_${'x'.repeat(32)}`,
  deletionClaimExpiresAt: '2026-09-01T02:00:00.000Z',
});

const supportedProject = (
  projectSummary: StudioProjectSummaryV3 = summary(),
  revision = 7
): Extract<StudioProjectLoadResultV3, { status: 'supported' }> => ({
  status: 'supported',
  summary: projectSummary,
  canvas: {
    projectId: projectSummary.id,
    revision,
    authoringRevision: 3,
    pieces: [],
  },
  activity: {
    projectId: projectSummary.id,
    preparedPhotoQuotes: [],
    jobs: [],
  },
  spendPolicy: null,
  lastUndo: null,
});

const makeClient = (entries: StudioProjectLibraryEntryV3[] = [supportedEntry()]) =>
  ({
    listProjectsV3: vi.fn(async () => ({ entries })),
    createProjectV3: vi.fn(async ({ name }: { name: string; brief: string }) => ({
      status: 'created' as const,
      summary: summary({ id: 'project_created', name, pieceCount: 0, currentPieceCount: 0 }),
    })),
    loadProjectV3: vi.fn(async () => supportedProject()),
    deleteProjectV3: vi.fn(async (request) => ({
      status: 'deleted' as const,
      projectId: request.projectId,
    })),
  }) satisfies StudioPilotLibraryClientV3;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('inactive Creative Studio 4 Pilot library', () => {
  let i18n: i18n;

  beforeAll(async () => {
    i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en-US',
      fallbackLng: false,
      resources: { 'en-US': { translation: { conversation } } },
      interpolation: { escapeValue: false },
    });
  });

  const renderEnglish = (node: React.ReactNode) => render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

  it('lists supported summaries and keeps unsupported and quarantined projects visibly distinct', async () => {
    const client = makeClient([
      supportedEntry(),
      unreadableEntry('unsupported', 'schema_5_project'),
      unreadableEntry('quarantined', 'broken_project'),
    ]);

    renderEnglish(<PilotLibrary client={client} onOpenProject={vi.fn()} />);

    expect(await screen.findByRole('heading', { level: 3, name: 'Light studies' })).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();

    const unsupported = screen.getByRole('region', { name: 'Created by another Studio version' });
    expect(within(unsupported).getByText('schema_5_project')).toBeVisible();
    expect(within(unsupported).getByText('Unsupported')).toBeVisible();

    const quarantined = screen.getByRole('region', { name: 'Projects that need recovery' });
    expect(within(quarantined).getByText('broken_project')).toBeVisible();
    expect(within(quarantined).getByText('Quarantined')).toBeVisible();
  });

  it('creates only a name and Brief, with no film-era settings', async () => {
    const client = makeClient([]);
    const onOpenProject = vi.fn();
    renderEnglish(<PilotLibrary client={client} onOpenProject={onOpenProject} />);

    await screen.findByRole('heading', { name: 'No projects yet' });
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '  Photo notebook  ' } });
    fireEvent.change(screen.getByLabelText('Brief'), { target: { value: 'Observe hard afternoon light.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() =>
      expect(client.createProjectV3).toHaveBeenCalledWith({
        name: 'Photo notebook',
        brief: 'Observe hard afternoon light.',
      })
    );
    expect(client.createProjectV3).toHaveBeenCalledTimes(1);
    expect(onOpenProject).toHaveBeenCalledWith('project_created');
    expect(screen.queryByLabelText(/duration|resolution|aspect/i)).toBeNull();
  });

  it('refuses a blank name locally and contains a later create failure without changing the library', async () => {
    const client = makeClient([]);
    client.createProjectV3.mockRejectedValueOnce(new Error('create refused'));
    const onOpenProject = vi.fn();
    renderEnglish(<PilotLibrary client={client} onOpenProject={onOpenProject} />);

    await screen.findByRole('heading', { name: 'No projects yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a project name.');
    expect(client.createProjectV3).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Photo notebook' } });
    expect(screen.queryByText('Enter a project name.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Creative Studio could not complete that action.');
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('loads exact healthy revision authority and waits for explicit human deletion confirmation', async () => {
    const client = makeClient();
    client.loadProjectV3.mockResolvedValue(supportedProject(summary(), 19));
    renderEnglish(<PilotLibrary client={client} onOpenProject={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Light studies' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(client.loadProjectV3).toHaveBeenCalledWith('project_1');
    expect(client.deleteProjectV3).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    await waitFor(() =>
      expect(client.deleteProjectV3).toHaveBeenCalledWith({
        mode: 'healthy',
        projectId: 'project_1',
        expectedRevision: 19,
      })
    );
    expect(screen.queryByRole('heading', { level: 3, name: 'Light studies' })).toBeNull();
  });

  it('uses only the opaque claim for explicitly confirmed unreadable deletion', async () => {
    const unreadable = unreadableEntry('quarantined', 'broken_project');
    const client = makeClient([unreadable]);
    renderEnglish(<PilotLibrary client={client} onOpenProject={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete unreadable project broken_project' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('protected one-time claim');
    expect(client.loadProjectV3).not.toHaveBeenCalled();
    expect(client.deleteProjectV3).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    await waitFor(() =>
      expect(client.deleteProjectV3).toHaveBeenCalledWith({
        mode: 'unreadable',
        projectId: 'broken_project',
        deletionClaim: unreadable.deletionClaim,
      })
    );
  });

  it('drops a project that vanishes during delete preparation while preserving and opening its neighbour', async () => {
    const client = makeClient([
      supportedEntry(),
      supportedEntry({ id: 'project_2', name: 'Portrait notes' }),
      unreadableEntry('unsupported', 'schema_5_project'),
    ]);
    client.loadProjectV3.mockResolvedValueOnce({ status: 'not_found', projectId: 'project_1' });
    const onOpenProject = vi.fn();
    renderEnglish(<PilotLibrary client={client} onOpenProject={onOpenProject} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Light studies' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 3, name: 'Light studies' })).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('schema_5_project')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Portrait notes' }));
    expect(onOpenProject).toHaveBeenCalledWith('project_2');
    expect(client.deleteProjectV3).not.toHaveBeenCalled();
  });

  it('keeps a failed delete available for review and lets the person close the confirmation safely', async () => {
    const client = makeClient();
    client.deleteProjectV3.mockRejectedValueOnce(new Error('delete refused'));
    renderEnglish(<PilotLibrary client={client} onOpenProject={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Light studies' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Creative Studio could not complete that action.'
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Light studies' })).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep project' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.deleteProjectV3).toHaveBeenCalledTimes(1);
  });

  it('contains one entry preparation failure without hiding its healthy neighbour', async () => {
    const client = makeClient([supportedEntry(), supportedEntry({ id: 'project_2', name: 'Portrait notes' })]);
    client.loadProjectV3.mockRejectedValueOnce({ messageKey: 'pilot.loadRefused' });
    renderEnglish(<PilotLibrary client={client} onOpenProject={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Light studies' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Creative Studio could not complete that action.');
    expect(screen.getByRole('heading', { level: 3, name: 'Light studies' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: 'Portrait notes' })).toBeVisible();
    expect(client.deleteProjectV3).not.toHaveBeenCalled();
  });

  it('shows neutral initial loading and retains the last-known list when refresh is unavailable', async () => {
    const first = deferred<{ entries: StudioProjectLibraryEntryV3[] }>();
    const client = makeClient();
    client.listProjectsV3.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('refresh refused'));
    renderEnglish(<PilotLibrary client={client} onOpenProject={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading projects…');
    await act(async () => {
      first.resolve({ entries: [supportedEntry()] });
      await first.promise;
    });
    expect(await screen.findByRole('heading', { level: 3, name: 'Light studies' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Refresh unavailable. Showing the last available project list.'
      )
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Light studies' })).toBeVisible();
  });
});
