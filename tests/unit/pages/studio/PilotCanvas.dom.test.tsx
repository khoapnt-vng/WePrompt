import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type StudioProjectLoadResultV3,
  type StudioRendererPieceActivityJobV3,
  type StudioRendererPieceV3,
  type StudioRendererPreparedPhotoQuoteV3,
} from '@/common/types/project/creativeStudioTypes';
import { PilotCanvas, type StudioPilotClientV3 } from '@/renderer/pages/studio/components/Pilot';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

const preparedQuote = (
  overrides: Partial<StudioRendererPreparedPhotoQuoteV3> = {}
): StudioRendererPreparedPhotoQuoteV3 => ({
  mode: 'create',
  reservationId: 'reservation_1',
  projectId: 'project_1',
  quoteId: 'quote_1',
  quoteRevision: 1,
  targetPieceId: 'piece_1',
  proposedHandle: 'morning_light',
  orderIndex: 0,
  words: 'Morning light across a quiet lake',
  settings: { aspectRatio: '16:9', resolution: '720p' },
  referencePieceIds: [],
  currency: 'USD',
  lowerMinorUnits: 125,
  upperMinorUnits: 125,
  spendPolicyClassification: 'within_cap',
  expiresAt: '2026-09-01T01:00:00.000Z',
  requiresExplicitHumanAction: false,
  duplicateChargeAcknowledgementRequired: false,
  ...overrides,
});

const supportedProject = ({
  pieces = [],
  jobs = [],
  quotes = [],
}: {
  pieces?: StudioRendererPieceV3[];
  jobs?: StudioRendererPieceActivityJobV3[];
  quotes?: StudioRendererPreparedPhotoQuoteV3[];
} = {}): Extract<StudioProjectLoadResultV3, { status: 'supported' }> => ({
  status: 'supported',
  summary: {
    id: 'project_1',
    name: 'Light studies',
    pieceCount: pieces.length,
    currentPieceCount: pieces.filter((piece) => piece.currentAsset !== null).length,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  canvas: {
    projectId: 'project_1',
    revision: 4,
    authoringRevision: 2,
    pieces,
  },
  activity: {
    projectId: 'project_1',
    preparedPhotoQuotes: quotes,
    jobs,
  },
  spendPolicy: null,
  lastUndo: null,
});

const activityJob = (
  progress: number | null,
  overrides: Partial<StudioRendererPieceActivityJobV3> = {}
): StudioRendererPieceActivityJobV3 => ({
  jobId: 'job_1',
  pieceId: 'piece_1',
  status: 'running',
  createdAt: '2026-09-01T00:05:00.000Z',
  updatedAt: '2026-09-01T00:06:00.000Z',
  progress,
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  authorization: { confirmedAt: '2026-09-01T00:04:00.000Z' },
  canCancel: true,
  canRetry: false,
  canRetryDownload: false,
  canResume: false,
  recordedSpend: null,
  ...overrides,
});

const pendingPiece = (id: string, handle: string): StudioRendererPieceV3 => ({
  id,
  kind: 'photograph',
  handle,
  priorHandles: [],
  currentAsset: null,
  state: 'failed',
});

const importedPiece = (id: string, handle: string): StudioRendererPieceV3 => ({
  id,
  kind: 'photograph',
  handle,
  priorHandles: [],
  currentAsset: {
    id: `asset_${id}`,
    mediaKind: 'image',
    mimeType: 'image/png',
    width: 1600,
    height: 900,
    byteSize: 1234,
    provenance: { origin: 'imported', createdAt: '2026-09-01T00:10:00.000Z' },
  },
  state: 'current',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const makeClient = (load: StudioProjectLoadResultV3 = supportedProject()) =>
  ({
    loadProjectV3: vi.fn(async () => load),
    preparePhotoV3: vi.fn(async () => ({ status: 'prepared' as const, quote: preparedQuote() })),
    confirmPreparedPhotoV3: vi.fn(async () => ({
      status: 'queued' as const,
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      revision: 5,
      authoringRevision: 3,
    })),
    discardPreparedPhotoV3: vi.fn(async () => ({ status: 'discarded' as const, projectId: 'project_1' })),
    importPhotoV3: vi.fn(async () => ({ status: 'cancelled' as const })),
    applyMutationBatchV3: vi.fn(async () => ({
      projectId: 'project_1',
      revision: 5,
      authoringRevision: 3,
      undoEntryId: null,
    })),
    cancelJobV3: vi.fn(async () => ({
      status: 'cancelled' as const,
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      revision: 5,
    })),
    resumeJobV3: vi.fn(async () => ({
      status: 'recovering' as const,
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      revision: 5,
    })),
    retryDownloadV3: vi.fn(async () => ({
      status: 'recovering' as const,
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      revision: 5,
    })),
    listPieceExportsV3: vi.fn(async () => ({ revision: 1, artifacts: [] })),
    exportPieceV3: vi.fn(async () => {
      const artifact = {
        id: 'export_1',
        pieceId: 'piece_1',
        sourceRevision: 4,
        handleAtExport: 'morning_light',
        byteSize: 123,
        payloadFileCount: 2 as const,
        createdAt: '2026-09-01T00:12:00.000Z',
        folderName: 'piece-export_1',
      };
      return { status: 'copied' as const, artifact, catalog: { revision: 2, artifacts: [artifact] } };
    }),
    revealPieceExportV3: vi.fn(async () => ({ status: 'revealed' as const })),
    watchProjectUpdatesV3: vi.fn(() => vi.fn()),
  }) satisfies StudioPilotClientV3;

describe('inactive Creative Studio 4 Pilot canvas', () => {
  let i18n: i18n;
  let nextFrameId = 0;
  let frames: Map<number, FrameRequestCallback>;

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

  const flushAnimationFrame = async (): Promise<void> => {
    const pending = [...frames.entries()];
    frames.clear();
    await act(async () => {
      for (const [, callback] of pending) callback(performance.now());
    });
  };

  beforeEach(() => {
    frames = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves focus into Create and restores the initiating action when Create is cancelled', async () => {
    const client = makeClient();
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const create = await screen.findByRole('button', { name: 'Create photo' });
    create.focus();
    fireEvent.click(create);

    const description = screen.getByRole('textbox', { name: 'Photo description' });
    await waitFor(() => expect(description).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create photo' })).toHaveFocus());
  });

  it('focuses Piece rename and restores its action after Escape, cancel, and save', async () => {
    const project = supportedProject({ pieces: [pendingPiece('piece_1', 'morning_light')] });
    const refresh = deferred<StudioProjectLoadResultV3>();
    const client = makeClient(project);
    client.loadProjectV3.mockResolvedValueOnce(project).mockReturnValueOnce(refresh.promise);
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const openRename = async (): Promise<HTMLElement> => {
      const trigger = await screen.findByRole('button', { name: 'Rename Piece' });
      trigger.focus();
      fireEvent.click(trigger);
      const input = screen.getByRole('textbox', { name: 'Rename #morning_light' });
      await waitFor(() => expect(input).toHaveFocus());
      return input;
    };

    fireEvent.keyDown(await openRename(), { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Piece' })).toHaveFocus());

    await openRename();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rename' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Piece' })).toHaveFocus());

    const rename = await openRename();
    fireEvent.change(rename, { target: { value: 'morning_reflection' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Piece' })).toBeDisabled());
    await act(async () => {
      refresh.resolve(project);
      await refresh.promise;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename Piece' })).toHaveFocus());
    expect(client.applyMutationBatchV3).toHaveBeenCalledOnce();
  });

  it('renders the quote before a within-cap confirmation gets a paint opportunity', async () => {
    const client = makeClient();
    const initialLoad = deferred<StudioProjectLoadResultV3>();
    const preparation = deferred<{ status: 'prepared'; quote: StudioRendererPreparedPhotoQuoteV3 }>();
    client.loadProjectV3.mockReturnValue(initialLoad.promise);
    client.preparePhotoV3.mockReturnValue(preparation.promise);
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    await act(async () => {
      initialLoad.resolve(supportedProject());
      await initialLoad.promise;
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Light studies' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Project menu',
      'Create photo',
      'Import photo',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Create photo' }));
    fireEvent.change(screen.getByLabelText('Photo description'), {
      target: { value: 'Morning light across a quiet lake' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review cost' }));

    expect(client.preparePhotoV3).toHaveBeenCalledOnce();
    await act(async () => {
      preparation.resolve({ status: 'prepared', quote: preparedQuote() });
      await preparation.promise;
    });
    const quote = screen.getByRole('article', { name: 'Prepared photo quote' });
    expect(within(quote).getByText(/USD/)).toBeInTheDocument();
    expect(within(quote).getByText('One photo · 16:9 · 720p')).toBeInTheDocument();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();

    await flushAnimationFrame();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
    await flushAnimationFrame();

    expect(client.confirmPreparedPhotoV3).toHaveBeenCalledWith({
      reservationId: 'reservation_1',
      quoteId: 'quote_1',
      quoteRevision: 1,
      explicitHumanConfirmation: false,
      duplicateChargeAcknowledged: false,
    });
  });

  it('sends the request-scoped aspect ratio and resolution in the exact prepare intent', async () => {
    const client = makeClient();
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create photo' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Photo description' }), {
      target: { value: '  Tall reeds reflected at blue hour  ' },
    });
    fireEvent.click(screen.getByRole('combobox', { name: 'Aspect ratio' }));
    fireEvent.click(await screen.findByRole('option', { name: '9:16' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Resolution' }));
    fireEvent.click(await screen.findByRole('option', { name: '1080p' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review cost' }));

    await waitFor(() =>
      expect(client.preparePhotoV3).toHaveBeenCalledWith({
        mode: 'create',
        projectId: 'project_1',
        expectedAuthoringRevision: 2,
        words: 'Tall reeds reflected at blue hour',
        settings: { aspectRatio: '9:16', resolution: '1080p' },
        suggestedHandle: null,
        referencePieceIds: [],
      })
    );
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
  });

  it('uses the same bounded ordered reference operation as the Director path', async () => {
    const pieces = [
      importedPiece('piece_coat', 'red_coat'),
      importedPiece('piece_street', 'rainy_street'),
      importedPiece('piece_lantern', 'paper_lantern'),
    ];
    const quote = preparedQuote({
      targetPieceId: 'piece_target',
      referencePieceIds: ['piece_coat', 'piece_street'],
      spendPolicyClassification: 'no_policy',
      requiresExplicitHumanAction: true,
    });
    const client = makeClient(supportedProject({ pieces }));
    client.preparePhotoV3.mockResolvedValueOnce({ status: 'prepared', quote });
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create photo' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '#red_coat' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '#rainy_street' }));
    expect(screen.getByRole('checkbox', { name: '#paper_lantern' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Photo description' }), {
      target: { value: 'The red coat crossing the rainy street.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review cost' }));

    await waitFor(() =>
      expect(client.preparePhotoV3).toHaveBeenCalledWith({
        mode: 'create',
        projectId: 'project_1',
        expectedAuthoringRevision: 2,
        words: 'The red coat crossing the rainy street.',
        settings: { aspectRatio: '16:9', resolution: '720p' },
        suggestedHandle: null,
        referencePieceIds: ['piece_coat', 'piece_street'],
      })
    );
    const quoteCard = await screen.findByRole('article', { name: 'Prepared photo quote' });
    expect(within(quoteCard).getByText('#red_coat')).toBeInTheDocument();
    expect(within(quoteCard).getByText('#rainy_street')).toBeInTheDocument();
  });

  it('requires an explicit bounded action when the quote is not within an active cap', async () => {
    const quote = preparedQuote({
      spendPolicyClassification: 'no_policy',
      requiresExplicitHumanAction: true,
    });
    const client = makeClient(supportedProject({ quotes: [quote] }));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const confirmation = await screen.findByRole('button', { name: 'Confirm and create photo' });
    await flushAnimationFrame();
    await flushAnimationFrame();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();

    fireEvent.click(confirmation);
    await waitFor(() =>
      expect(client.confirmPreparedPhotoV3).toHaveBeenCalledWith(
        expect.objectContaining({ explicitHumanConfirmation: true })
      )
    );
  });

  it('removes a confirmed persisted quote when the paid action commits but refresh is unavailable', async () => {
    const quote = preparedQuote({
      spendPolicyClassification: 'no_policy',
      requiresExplicitHumanAction: true,
    });
    const initial = supportedProject({ quotes: [quote] });
    const client = makeClient(initial);
    client.loadProjectV3.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('refresh unavailable'));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and create photo' }));

    await waitFor(() => expect(client.confirmPreparedPhotoV3).toHaveBeenCalledOnce());
    await waitFor(() => expect(client.loadProjectV3).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'The action was saved, but the latest project state could not be loaded. Refresh before taking another action.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a committed import truthfully when its authoritative refresh is unavailable', async () => {
    const initial = supportedProject();
    const client = makeClient(initial);
    client.loadProjectV3.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('refresh unavailable'));
    client.importPhotoV3.mockResolvedValueOnce({
      status: 'imported',
      projectId: 'project_1',
      pieceId: 'piece_imported',
      assetId: 'asset_imported',
      revision: 5,
      authoringRevision: 3,
    });
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Import photo' }));

    await waitFor(() => expect(client.importPhotoV3).toHaveBeenCalledOnce());
    await waitFor(() => expect(client.loadProjectV3).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText(
        'The action was saved, but the latest project state could not be loaded. Refresh before taking another action.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
  });

  it('focuses and announces the refreshed imported Piece without creating a quote, Job, or spend', async () => {
    const initial = supportedProject();
    const piece = importedPiece('piece_imported', 'window_light');
    const refreshed = supportedProject({ pieces: [piece] });
    const client = makeClient(initial);
    client.loadProjectV3.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    client.importPhotoV3.mockResolvedValueOnce({
      status: 'imported',
      projectId: 'project_1',
      pieceId: piece.id,
      assetId: piece.currentAsset!.id,
      revision: 5,
      authoringRevision: 3,
    });
    const { container } = renderEnglish(
      <PilotCanvas projectId='project_1' client={client} assetUrlFor={() => 'studio-asset://asset_imported'} />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Import photo' }));

    const imported = await waitFor(() => {
      const candidate = container.querySelector<HTMLElement>(
        '[data-pilot-focus-kind="piece"][data-pilot-focus-id="piece_imported"]'
      );
      expect(candidate).not.toBeNull();
      expect(candidate).toHaveFocus();
      return candidate!;
    });
    expect(imported).toHaveTextContent('#window_light');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Photo imported.');
    expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Attempt history for #window_light' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Recorded spend/)).not.toBeInTheDocument();
    expect(client.importPhotoV3).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
    });
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
    expect(client.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('renders exact two-decimal minor units even for a zero-decimal display currency', async () => {
    const quote = preparedQuote({
      currency: 'JPY',
      lowerMinorUnits: 125,
      upperMinorUnits: 125,
      spendPolicyClassification: 'no_policy',
      requiresExplicitHumanAction: true,
    });
    const client = makeClient(supportedProject({ quotes: [quote] }));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const card = await screen.findByRole('article', { name: 'Prepared photo quote' });
    expect(within(card).getAllByText(/¥1\.25/)).toHaveLength(2);
  });

  it('requires the human duplicate-charge acknowledgement before retry confirmation', async () => {
    const quote: StudioRendererPreparedPhotoQuoteV3 = {
      ...preparedQuote({
        reservationId: 'reservation_retry',
        quoteId: 'quote_retry',
        spendPolicyClassification: 'within_cap',
        requiresExplicitHumanAction: true,
        duplicateChargeAcknowledgementRequired: true,
      }),
      mode: 'retry',
      proposedHandle: null,
      orderIndex: null,
    };
    const client = makeClient(
      supportedProject({ pieces: [pendingPiece('piece_1', 'morning_light')], quotes: [quote] })
    );
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const confirmation = await screen.findByRole('button', { name: 'Confirm and retry' });
    expect(confirmation).toBeDisabled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I understand the earlier provider submission may already have been charged.',
      })
    );
    expect(confirmation).toBeEnabled();
    fireEvent.click(confirmation);

    await waitFor(() =>
      expect(client.confirmPreparedPhotoV3).toHaveBeenCalledWith({
        reservationId: 'reservation_retry',
        quoteId: 'quote_retry',
        quoteRevision: 1,
        explicitHumanConfirmation: true,
        duplicateChargeAcknowledged: true,
      })
    );
  });

  it('discards prepared intent without creating a Piece', async () => {
    const quote = preparedQuote({
      spendPolicyClassification: 'over_cap',
      requiresExplicitHumanAction: true,
    });
    const client = makeClient(supportedProject({ quotes: [quote] }));
    client.loadProjectV3
      .mockResolvedValueOnce(supportedProject({ quotes: [quote] }))
      .mockResolvedValue(supportedProject());
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Discard quote' }));
    await waitFor(() =>
      expect(client.discardPreparedPhotoV3).toHaveBeenCalledWith({
        reservationId: 'reservation_1',
        quoteId: 'quote_1',
        quoteRevision: 1,
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Create photo' })).toBeInTheDocument();
  });

  it('never presents a pending Piece as a current image', async () => {
    const pendingPieceValue: StudioRendererPieceV3 = {
      id: 'piece_1',
      kind: 'photograph',
      handle: 'دریاچه',
      priorHandles: [],
      currentAsset: null,
      state: 'running',
    };
    const runningJob: StudioRendererPieceActivityJobV3 = {
      jobId: 'job_1',
      pieceId: 'piece_1',
      status: 'running',
      createdAt: '2026-09-01T00:05:00.000Z',
      updatedAt: '2026-09-01T00:06:00.000Z',
      progress: 25,
      error: null,
      retryOfJobId: 'job_0',
      retryReason: 'provider_failure',
      duplicateChargeAcknowledged: true,
      authorization: { confirmedAt: '2026-09-01T00:04:00.000Z' },
      canCancel: true,
      canRetry: false,
      canRetryDownload: false,
      canResume: false,
      recordedSpend: null,
    };
    const client = makeClient(supportedProject({ pieces: [pendingPieceValue], jobs: [runningJob] }));
    const { container } = renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    expect(await screen.findByText('Photo generation is in progress.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Current image')).not.toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('Retry reason: provider failure')).toBeInTheDocument();
    expect(screen.getByText('job_0')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
    expect(container.querySelector('bdi[dir="auto"]')).toHaveTextContent('#دریاچه');
  });

  it('places create intent at its future slot and retry intent inside its existing Piece', async () => {
    const createQuote = preparedQuote({
      targetPieceId: 'piece_future',
      orderIndex: 1,
      spendPolicyClassification: 'over_cap',
      requiresExplicitHumanAction: true,
    });
    const retryQuote: StudioRendererPreparedPhotoQuoteV3 = {
      ...preparedQuote({
        reservationId: 'reservation_retry',
        quoteId: 'quote_retry',
        targetPieceId: 'piece_a',
        spendPolicyClassification: 'over_cap',
        requiresExplicitHumanAction: true,
      }),
      mode: 'retry',
      proposedHandle: null,
      orderIndex: null,
    };
    const client = makeClient(
      supportedProject({
        pieces: [pendingPiece('piece_a', 'first'), pendingPiece('piece_b', 'second')],
        quotes: [createQuote, retryQuote],
      })
    );
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const board = await screen.findByRole('region', { name: 'Photo Pieces' });
    expect(board.children).toHaveLength(3);
    expect(board.children[0]).toHaveTextContent('#first');
    expect(within(board.children[0] as HTMLElement).getByText('Retry photo')).toBeInTheDocument();
    expect(board.children[1]).toHaveTextContent('#morning_light');
    expect(board.children[2]).toHaveTextContent('#second');
  });

  it.each([1, 2, 3])('selects the generous density band for %s visible blocks', async (blockCount) => {
    const pieces = Array.from({ length: blockCount }, (_, index) => pendingPiece(`piece_${index}`, `piece_${index}`));
    const client = makeClient(supportedProject({ pieces }));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const board = await screen.findByRole('region', { name: 'Photo Pieces' });
    expect(board).toHaveAttribute('data-pilot-density', '1-3');
    expect(board.children).toHaveLength(blockCount);
  });

  it('keeps the status chip and footer action visible in the generous band', async () => {
    const client = makeClient(supportedProject({ pieces: [pendingPiece('piece_1', 'one_photo')] }));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const board = await screen.findByRole('region', { name: 'Photo Pieces' });
    expect(within(board).getByText('Failed')).toBeVisible();
    expect(within(board).getByRole('button', { name: 'Rename Piece' })).toBeVisible();
  });

  it('ends the generous band at four blocks without quietening a spend decision', async () => {
    const quote = preparedQuote({
      targetPieceId: 'piece_future',
      orderIndex: 3,
      spendPolicyClassification: 'over_cap',
      requiresExplicitHumanAction: true,
    });
    const pieces = Array.from({ length: 3 }, (_, index) => pendingPiece(`piece_${index}`, `piece_${index}`));
    const client = makeClient(supportedProject({ pieces, quotes: [quote] }));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const board = await screen.findByRole('region', { name: 'Photo Pieces' });
    expect(board).not.toHaveAttribute('data-pilot-density');
    expect(board.children).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Confirm and create photo' })).toBeVisible();
  });

  it.each([
    {
      code: 'route_catalog_unavailable',
      copy: 'Photo routes are not loaded. Refresh availability and try again.',
      retry: true,
    },
    {
      code: 'route_incompatible',
      copy: 'No photo route supports these settings. Change the aspect ratio or resolution and try again.',
      retry: false,
    },
    {
      code: 'project_piece_capacity_reached',
      copy: 'This Pilot project has reached 96 Pieces. Start another project to create or import more photos.',
      retry: false,
    },
    {
      code: 'stale_authoring',
      copy: 'The project changed. Review the latest state and try again.',
      retry: false,
    },
    {
      code: 'variation_grid',
      copy: 'A variation grid was returned instead of one photo. Review the result before starting another paid attempt.',
      retry: false,
    },
  ] as const)('distinguishes $code preparation failures', async ({ code, copy, retry }) => {
    const client = makeClient();
    client.preparePhotoV3.mockRejectedValueOnce({ code, messageKey: 'generic.route.failure' });
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create photo' }));
    fireEvent.change(screen.getByLabelText('Photo description'), { target: { value: 'Rain on glass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review cost' }));

    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.queryByText('generic.route.failure')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry route check' }) !== null).toBe(retry);
    expect(screen.getByLabelText('Photo description')).toBeInTheDocument();

    if (retry) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry route check' }));
      expect(await screen.findByRole('article', { name: 'Prepared photo quote' })).toBeInTheDocument();
      expect(client.preparePhotoV3).toHaveBeenCalledTimes(2);
    }
  });

  it('removes a policy-stale automatic quote and restores its words for a fresh cost review', async () => {
    const quote = preparedQuote();
    const client = makeClient(supportedProject({ quotes: [quote] }));
    client.loadProjectV3
      .mockResolvedValueOnce(supportedProject({ quotes: [quote] }))
      .mockResolvedValue(supportedProject());
    client.confirmPreparedPhotoV3.mockRejectedValueOnce({
      code: 'confirmation_required',
      messageKey: 'internal.policy.changed',
    });
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    expect(await screen.findByRole('article', { name: 'Prepared photo quote' })).toBeInTheDocument();
    await flushAnimationFrame();
    await flushAnimationFrame();

    expect(
      await screen.findByText('This quote is no longer current. Review a fresh cost before starting paid work.')
    ).toBeInTheDocument();
    expect(screen.queryByText('internal.policy.changed')).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Photo description')).toHaveValue('Morning light across a quiet lake');
    expect(screen.getByRole('button', { name: 'Review cost' })).toBeInTheDocument();
    expect(client.discardPreparedPhotoV3).toHaveBeenCalledWith({
      reservationId: quote.reservationId,
      quoteId: quote.quoteId,
      quoteRevision: quote.quoteRevision,
    });
    await flushAnimationFrame();
    await flushAnimationFrame();
    expect(client.confirmPreparedPhotoV3).toHaveBeenCalledOnce();
  });

  it.each([
    { canRetry: true, recovery: 'One reviewed paid retry is available for this Piece.' },
    {
      canRetry: false,
      recovery: 'No more paid retries are available for this Piece. Import a photo or create a sibling Piece instead.',
    },
  ])(
    'keeps multi-Piece actions and bounded variation-grid recovery visible ($canRetry)',
    async ({ canRetry, recovery }) => {
      const piece = pendingPiece('piece_1', 'grid_result');
      const gridJob = activityJob(100, {
        status: 'failed',
        error: { code: 'variation_grid', messageKey: 'internal.variation_grid' },
        canCancel: false,
        canRetry,
        recordedSpend: { currency: 'USD', totalMinorUnits: 125 },
      });
      const client = makeClient(supportedProject({ pieces: [piece], jobs: [gridJob] }));
      renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

      expect(await screen.findByRole('button', { name: 'Create photo' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Import photo' }).length).toBeGreaterThanOrEqual(2);
      const recoveryNote = screen.getByRole('note');
      expect(recoveryNote).toHaveTextContent(
        'The provider returned and charged for an output, but Creative Studio refused it because it is a variation grid.'
      );
      expect(recoveryNote).toHaveTextContent(recovery);
      expect(recoveryNote).toHaveTextContent('Import photo adds a separate Piece without another generation charge.');
      expect(screen.getByText('Recorded spend: $1.25 (USD)')).toBeInTheDocument();
      expect(screen.queryByText('internal.variation_grid')).not.toBeInTheDocument();

      fireEvent.click(within(recoveryNote).getByRole('button', { name: 'Import photo' }));
      await waitFor(() => expect(client.importPhotoV3).toHaveBeenCalledOnce());
      expect(client.preparePhotoV3).not.toHaveBeenCalled();
      expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Retry generation' }) !== null).toBe(canRetry);
    }
  );

  it('runs each bounded Job recovery action through its typed client operation', async () => {
    const pieces = [
      pendingPiece('piece_cancel', 'cancel_me'),
      pendingPiece('piece_retry', 'retry_me'),
      pendingPiece('piece_download', 'download_me'),
      pendingPiece('piece_resume', 'resume_me'),
    ];
    const jobs = [
      activityJob(20, { jobId: 'job_cancel', pieceId: 'piece_cancel' }),
      activityJob(null, {
        jobId: 'job_retry',
        pieceId: 'piece_retry',
        status: 'failed',
        canCancel: false,
        canRetry: true,
      }),
      activityJob(100, {
        jobId: 'job_download',
        pieceId: 'piece_download',
        status: 'needs_attention',
        canCancel: false,
        canRetryDownload: true,
      }),
      activityJob(null, {
        jobId: 'job_resume',
        pieceId: 'piece_resume',
        status: 'needs_attention',
        canCancel: false,
        canResume: true,
      }),
    ];
    const project = supportedProject({ pieces, jobs });
    const retryQuote: StudioRendererPreparedPhotoQuoteV3 = {
      ...preparedQuote({
        reservationId: 'reservation_retry',
        quoteId: 'quote_retry',
        targetPieceId: 'piece_retry',
        spendPolicyClassification: 'over_cap',
        requiresExplicitHumanAction: true,
      }),
      mode: 'retry',
      proposedHandle: null,
      orderIndex: null,
    };
    const client = makeClient(project);
    client.preparePhotoV3.mockResolvedValue({ status: 'prepared', quote: retryQuote });
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel generation' }));
    await waitFor(() =>
      expect(client.cancelJobV3).toHaveBeenCalledWith({
        projectId: 'project_1',
        pieceId: 'piece_cancel',
        jobId: 'job_cancel',
      })
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry generation' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Retry generation' }));
    await waitFor(() =>
      expect(client.preparePhotoV3).toHaveBeenCalledWith({
        mode: 'retry',
        projectId: 'project_1',
        expectedAuthoringRevision: 2,
        pieceId: 'piece_retry',
        sourceJobId: 'job_retry',
      })
    );
    expect(await screen.findByText('Retry photo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry download' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
    await waitFor(() =>
      expect(client.retryDownloadV3).toHaveBeenCalledWith({
        projectId: 'project_1',
        pieceId: 'piece_download',
        jobId: 'job_download',
        expectedRevision: 4,
      })
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check provider again' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Check provider again' }));
    await waitFor(() =>
      expect(client.resumeJobV3).toHaveBeenCalledWith({
        projectId: 'project_1',
        pieceId: 'piece_resume',
        jobId: 'job_resume',
        expectedRevision: 4,
      })
    );
  });

  it('keeps rename failures actionable and applies the persisted one-step undo', async () => {
    const initial = {
      ...supportedProject({ pieces: [pendingPiece('piece_1', 'morning_light')] }),
      lastUndo: { entryId: 'undo_rename_1', label: 'Rename #morning_light' },
    } satisfies Extract<StudioProjectLoadResultV3, { status: 'supported' }>;
    const client = makeClient(initial);
    client.applyMutationBatchV3
      .mockRejectedValueOnce({ code: 'handle_collision', messageKey: 'internal.handle.collision' })
      .mockResolvedValueOnce({
        projectId: 'project_1',
        revision: 5,
        authoringRevision: 3,
        undoEntryId: null,
      });
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Piece' }));
    const rename = screen.getByRole('textbox', { name: 'Rename #morning_light' });
    fireEvent.change(rename, { target: { value: 'existing_name' } });
    fireEvent.keyDown(rename, { key: 'Enter' });

    expect(await screen.findByText('Another Piece already uses that name or alias.')).toBeInTheDocument();
    expect(screen.queryByText('internal.handle.collision')).not.toBeInTheDocument();
    expect(client.applyMutationBatchV3).toHaveBeenNthCalledWith(1, {
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
      operations: [{ kind: 'rename_piece', pieceId: 'piece_1', handle: 'existing_name' }],
    });

    fireEvent.keyDown(rename, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo last rename' }));
    await waitFor(() =>
      expect(client.applyMutationBatchV3).toHaveBeenNthCalledWith(2, {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId: 'project_1',
        expectedAuthoringRevision: 2,
        operations: [{ kind: 'undo_last', entryId: 'undo_rename_1' }],
      })
    );
    expect(await screen.findByText('Last Piece rename undone.')).toBeInTheDocument();
  });

  it('uses one main project heading and a non-cropping, aspect-aware current-image frame', async () => {
    const currentPiece: StudioRendererPieceV3 = {
      id: 'piece_1',
      kind: 'photograph',
      handle: 'نور_صبح',
      priorHandles: ['morning_light'],
      currentAsset: {
        id: 'asset_1',
        mediaKind: 'image',
        mimeType: 'image/png',
        width: 1600,
        height: 900,
        byteSize: 1234,
        provenance: { origin: 'imported', createdAt: '2026-09-01T00:10:00.000Z' },
      },
      state: 'current',
    };
    const client = makeClient(supportedProject({ pieces: [currentPiece] }));
    const artifact = {
      id: 'export_8',
      pieceId: 'piece_1',
      sourceRevision: 4,
      handleAtExport: 'نور_صبح',
      byteSize: 321,
      payloadFileCount: 2 as const,
      createdAt: '2026-09-01T00:12:00.000Z',
      folderName: 'piece-export_8',
    };
    const exportResult = {
      status: 'copied' as const,
      artifact,
      catalog: { revision: 8, artifacts: [artifact] },
    };
    client.exportPieceV3.mockResolvedValue(exportResult);
    const onExported = vi.fn();
    const { container } = renderEnglish(
      <PilotCanvas
        projectId='project_1'
        client={client}
        assetUrlFor={() => 'studio-asset://asset_1'}
        onExported={onExported}
      />
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Light studies' })).toBeInTheDocument();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('bdi[dir="auto"]')).toHaveTextContent('#نور_صبح');
    const image = screen.getByRole('img', { name: '#نور_صبح current image' });
    expect(image.parentElement).toHaveStyle({ aspectRatio: '1600 / 900' });
    expect(screen.getByRole('region', { name: 'Provenance for #نور_صبح' })).toHaveTextContent('Imported');
    expect(screen.getByRole('button', { name: 'Create photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import photo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export #نور_صبح' }));
    await waitFor(() =>
      expect(client.exportPieceV3).toHaveBeenCalledWith({
        projectId: 'project_1',
        pieceId: 'piece_1',
        expectedRevision: 4,
      })
    );
    expect(onExported).toHaveBeenCalledWith('piece_1', exportResult);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Exported #نور_صبح.');
    expect(screen.getByRole('region', { name: 'Export for #نور_صبح' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in folder' }));
    await waitFor(() =>
      expect(client.revealPieceExportV3).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedCatalogRevision: 8,
        artifactId: 'export_8',
      })
    );
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Export revealed in its folder.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Export for #نور_صبح' })).not.toBeInTheDocument();
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
    expect(client.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('shows exact generated provenance without offering regeneration for a current Piece', async () => {
    const piece: StudioRendererPieceV3 = {
      id: 'piece_generated',
      kind: 'photograph',
      handle: 'harbour_mist',
      priorHandles: [],
      currentAsset: {
        id: 'asset_generated',
        mediaKind: 'image',
        mimeType: 'image/webp',
        width: 2048,
        height: 2048,
        byteSize: 4096,
        provenance: {
          origin: 'generated',
          createdAt: '2026-09-01T00:10:00.000Z',
          producerJobId: 'job_generated',
          model: 'gemini-3-pro-image-preview',
          instructionProfile: 'studio-piece-photo-v1',
          conditioningPieceIds: [],
          recordedSpend: { currency: 'USD', totalMinorUnits: 321 },
        },
      },
      state: 'current',
    };
    const client = makeClient(supportedProject({ pieces: [piece] }));
    renderEnglish(
      <PilotCanvas projectId='project_1' client={client} assetUrlFor={() => 'studio-asset://asset_generated'} />
    );

    const provenance = await screen.findByRole('region', { name: 'Provenance for #harbour_mist' });
    expect(provenance).toHaveTextContent('Generated');
    expect(provenance).toHaveTextContent('Model');
    expect(provenance).toHaveTextContent('gemini-3-pro-image-preview');
    expect(provenance).toHaveTextContent('Instruction profile');
    expect(provenance).toHaveTextContent('studio-piece-photo-v1');
    expect(provenance).toHaveTextContent('Recorded spend');
    expect(provenance).toHaveTextContent('$3.21 (USD)');
    expect(screen.queryByRole('button', { name: 'Retry generation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create photo' })).toBeInTheDocument();
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
  });

  it('does not offer export for a Piece without a current asset', async () => {
    const client = makeClient(supportedProject({ pieces: [pendingPiece('piece_pending', 'pending_light')] }));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Project menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Spending limit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Export/ })).not.toBeInTheDocument();
    expect(client.listPieceExportsV3).not.toHaveBeenCalled();
    expect(client.exportPieceV3).not.toHaveBeenCalled();
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
    expect(client.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('keeps a failed export non-generative and does not report it as exported', async () => {
    const piece = importedPiece('piece_export', 'rain_window');
    const client = makeClient(supportedProject({ pieces: [piece] }));
    client.exportPieceV3.mockRejectedValueOnce({ code: 'stale_revision', messageKey: 'internal.stale.export' });
    const onExported = vi.fn();
    renderEnglish(<PilotCanvas projectId='project_1' client={client} onExported={onExported} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Project menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export #rain_window' }));

    expect(await screen.findByText('Creative Studio could not complete that action.')).toBeInTheDocument();
    expect(client.exportPieceV3).toHaveBeenCalledWith({
      projectId: 'project_1',
      pieceId: 'piece_export',
      expectedRevision: 4,
    });
    expect(onExported).not.toHaveBeenCalled();
    expect(screen.queryByText('Exported #rain_window.')).not.toBeInTheDocument();
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
    expect(client.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('announces native export cancellation without creating a success or reveal surface', async () => {
    const piece = importedPiece('piece_export', 'rain_window');
    const client = makeClient(supportedProject({ pieces: [piece] }));
    client.exportPieceV3.mockResolvedValueOnce({ status: 'cancelled' });
    const onExported = vi.fn();
    renderEnglish(<PilotCanvas projectId='project_1' client={client} onExported={onExported} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Project menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export #rain_window' }));

    expect(await screen.findByText('Export cancelled. No export was created.')).toBeInTheDocument();
    expect(onExported).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Reveal in folder' })).not.toBeInTheDocument();
    expect(client.listPieceExportsV3).not.toHaveBeenCalled();
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
  });

  it('opens the typed spending-limit editor from every project menu and refreshes after saving', async () => {
    const quote = preparedQuote({ spendPolicyClassification: 'no_policy', requiresExplicitHumanAction: true });
    const client = makeClient(supportedProject({ quotes: [quote] }));
    client.loadProjectV3
      .mockResolvedValueOnce(supportedProject({ quotes: [quote] }))
      .mockResolvedValue(supportedProject());
    const onEditSpendPolicy = vi.fn();
    renderEnglish(<PilotCanvas projectId='project_1' client={client} onEditSpendPolicy={onEditSpendPolicy} />);

    await screen.findByRole('heading', { level: 1, name: 'Light studies' });
    expect(screen.getByRole('article', { name: 'Prepared photo quote' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Spending limit' }));

    fireEvent.change(screen.getByLabelText('Currency code'), { target: { value: 'usd' } });
    fireEvent.change(screen.getByLabelText('Maximum per batch (minor units)'), { target: { value: '275' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));

    await waitFor(() =>
      expect(client.applyMutationBatchV3).toHaveBeenCalledWith({
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId: 'project_1',
        expectedAuthoringRevision: 2,
        operations: [
          {
            kind: 'set_spend_policy',
            policy: { currency: 'USD', maxPerBatchMinorUnits: 275 },
          },
        ],
      })
    );
    await waitFor(() => expect(client.loadProjectV3).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument()
    );
    expect(onEditSpendPolicy).toHaveBeenCalledOnce();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Spending limit saved.');
  });

  it('clears the projected spending limit and reloads invalidated quotes without generation', async () => {
    const quote = preparedQuote({ spendPolicyClassification: 'within_cap' });
    const initial = {
      ...supportedProject({ quotes: [quote] }),
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 500 },
    } satisfies Extract<StudioProjectLoadResultV3, { status: 'supported' }>;
    const client = makeClient(initial);
    client.loadProjectV3.mockResolvedValueOnce(initial).mockResolvedValue(supportedProject());
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    await screen.findByRole('article', { name: 'Prepared photo quote' });
    fireEvent.click(screen.getByRole('button', { name: 'Project menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Spending limit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear limit' }));

    await waitFor(() =>
      expect(client.applyMutationBatchV3).toHaveBeenCalledWith(
        expect.objectContaining({ operations: [{ kind: 'set_spend_policy', policy: null }] })
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument()
    );
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
  });

  it('drops a local prepare response when the authoritative projection no longer contains its quote', async () => {
    const client = makeClient();
    let listener: Parameters<StudioPilotClientV3['watchProjectUpdatesV3']>[0] | null = null;
    client.watchProjectUpdatesV3.mockImplementation((candidate) => {
      listener = candidate;
      return vi.fn();
    });
    client.loadProjectV3.mockResolvedValue(supportedProject());
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create photo' }));
    fireEvent.change(screen.getByLabelText('Photo description'), { target: { value: 'Rain over a harbour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review cost' }));
    expect(await screen.findByRole('article', { name: 'Prepared photo quote' })).toBeInTheDocument();

    await act(async () => {
      listener?.({ source: 'prepared', projectId: 'project_1' });
      await Promise.resolve();
    });
    await waitFor(() => expect(client.loadProjectV3).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument()
    );
  });

  it('moves focus from a confirmed quote to the durable Piece replacing it in the same board slot', async () => {
    const quote = preparedQuote({ spendPolicyClassification: 'no_policy', requiresExplicitHumanAction: true });
    const piece = { ...pendingPiece('piece_1', 'morning_light'), state: 'queued' as const };
    const client = makeClient(supportedProject({ quotes: [quote] }));
    client.loadProjectV3
      .mockResolvedValueOnce(supportedProject({ quotes: [quote] }))
      .mockResolvedValue(supportedProject({ pieces: [piece], jobs: [activityJob(null, { status: 'queued_local' })] }));
    const { container } = renderEnglish(<PilotCanvas projectId='project_1' client={client} />);

    const confirm = await screen.findByRole('button', { name: 'Confirm and create photo' });
    confirm.focus();
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);

    const replacement = await waitFor(() => {
      const candidate = container.querySelector<HTMLElement>(
        '[data-pilot-focus-kind="piece"][data-pilot-focus-id="piece_1"]'
      );
      expect(candidate).not.toBeNull();
      expect(candidate).toHaveFocus();
      return candidate!;
    });
    expect(replacement).toHaveTextContent('#morning_light');
    expect(screen.queryByRole('article', { name: 'Prepared photo quote' })).not.toBeInTheDocument();
  });

  it('announces only durable Job status transitions, not repeated progress ticks', async () => {
    const piece = { ...pendingPiece('piece_1', 'rain'), state: 'running' as const };
    const client = makeClient();
    let listener: Parameters<StudioPilotClientV3['watchProjectUpdatesV3']>[0] | null = null;
    client.watchProjectUpdatesV3.mockImplementation((candidate) => {
      listener = candidate;
      return vi.fn();
    });
    const failedJob = activityJob(70, {
      status: 'failed',
      error: { code: 'provider_unavailable', messageKey: 'internal.provider' },
      canCancel: false,
      canRetry: true,
    });
    client.loadProjectV3
      .mockResolvedValueOnce(supportedProject({ pieces: [piece], jobs: [activityJob(10)] }))
      .mockResolvedValue(supportedProject({ pieces: [{ ...piece, state: 'failed' }], jobs: [failedJob] }));
    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);
    await screen.findByText('10%');

    await act(async () => {
      listener?.({ source: 'durable', facts: { projectId: 'project_1' } });
      await Promise.resolve();
    });
    expect(await screen.findByText('#rain is now Failed.')).toBeInTheDocument();

    await act(async () => {
      listener?.({ source: 'durable', facts: { projectId: 'project_1' } });
      await Promise.resolve();
    });
    expect(screen.getAllByText('#rain is now Failed.')).toHaveLength(1);
    expect(screen.queryByText('internal.provider')).not.toBeInTheDocument();
  });

  it('subscribes before loading and refreshes persisted progress after a coalesced project update', async () => {
    const piece: StudioRendererPieceV3 = {
      id: 'piece_1',
      kind: 'photograph',
      handle: 'rain',
      priorHandles: [],
      currentAsset: null,
      state: 'running',
    };
    const client = makeClient();
    let listener: Parameters<StudioPilotClientV3['watchProjectUpdatesV3']>[0] | null = null;
    client.watchProjectUpdatesV3.mockImplementation((candidate) => {
      listener = candidate;
      return vi.fn();
    });
    const refreshed = deferred<StudioProjectLoadResultV3>();
    client.loadProjectV3
      .mockResolvedValueOnce(supportedProject({ pieces: [piece], jobs: [activityJob(10)] }))
      .mockReturnValueOnce(refreshed.promise);

    renderEnglish(<PilotCanvas projectId='project_1' client={client} />);
    expect(await screen.findByText('10%')).toBeInTheDocument();
    expect(client.watchProjectUpdatesV3.mock.invocationCallOrder[0]).toBeLessThan(
      client.loadProjectV3.mock.invocationCallOrder[0]!
    );

    await act(async () => {
      listener?.({ source: 'durable', facts: { projectId: 'project_1' } });
      listener?.({ source: 'durable', facts: { projectId: 'project_1' } });
      await Promise.resolve();
    });

    expect(screen.getByText('Refreshing project…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Light studies' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      refreshed.resolve(supportedProject({ pieces: [piece], jobs: [activityJob(70)] }));
      await refreshed.promise;
    });
    expect(await screen.findByText('70%')).toBeInTheDocument();
    expect(client.loadProjectV3).toHaveBeenCalledTimes(2);

    client.loadProjectV3.mockRejectedValueOnce(new Error('Connection interrupted'));
    await act(async () => {
      listener?.({ source: 'durable', facts: { projectId: 'project_1' } });
      await Promise.resolve();
    });
    expect(
      (await screen.findByText('Creative Studio could not complete that action.')).closest('[role="status"]')
    ).not.toBeNull();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.queryByText('This Creative Studio project is unavailable.')).not.toBeInTheDocument();
  });
});
