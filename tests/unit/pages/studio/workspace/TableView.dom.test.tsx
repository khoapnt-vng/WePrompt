import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceBeatProjection,
  WorkspaceBoardPanelProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

const tableCss = readFileSync(
  join(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Table/Table.module.css'),
  'utf8'
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'common.collapse': 'Collapse',
        'common.expand': 'Expand',
        'conversation.creativeStudio.workspace.table.label': 'Beat table',
        'conversation.creativeStudio.workspace.table.authoring.label': 'Story authoring and recovery',
        'conversation.creativeStudio.workspace.table.authoring.askDirector': 'Ask Director',
        'conversation.creativeStudio.workspace.table.authoring.addBeat': 'Add Beat',
        'conversation.creativeStudio.workspace.table.authoring.addShot': 'Add Shot',
        'conversation.creativeStudio.workspace.table.authoring.unassignedReferenceNote':
          'A hand-authored Shot starts with references unassigned and requires review before paid generation.',
        'conversation.creativeStudio.workspace.beatPanel.untitledBeat': `Untitled Beat ${String(values?.index)}`,
        'conversation.creativeStudio.workspace.table.columns.position': '#',
        'conversation.creativeStudio.workspace.table.columns.panel': 'Panel',
        'conversation.creativeStudio.workspace.table.columns.beat': 'Beat',
        'conversation.creativeStudio.workspace.table.columns.story': 'Story',
        'conversation.creativeStudio.workspace.table.columns.shots': 'Shots',
        'conversation.creativeStudio.workspace.table.columns.length': 'Sum',
        'conversation.creativeStudio.workspace.table.columns.state': 'State',
        'conversation.creativeStudio.workspace.table.targetPending': 'No target',
        'conversation.creativeStudio.workspace.table.plannedPending': 'No planned sum',
        'conversation.creativeStudio.workspace.table.empty': 'No beats yet',
        'conversation.creativeStudio.workspace.table.state.durationPending': 'Duration pending',
        'conversation.creativeStudio.workspace.table.state.noCoverage': 'No coverage',
        'conversation.creativeStudio.workspace.table.state.seedPending': 'First frame pending',
        'conversation.creativeStudio.workspace.table.state.partDone': 'Part done',
        'conversation.creativeStudio.workspace.table.state.needsAttention': 'Needs attention',
        'conversation.creativeStudio.workspace.table.state.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.table.state.stale': 'Stale',
        'conversation.creativeStudio.workspace.table.state.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.table.state.ready': 'Ready',
        'conversation.creativeStudio.workspace.table.state.draft': 'Draft',
        'conversation.creativeStudio.workspace.table.panel.openDetails': `Open Board panels for ${String(values?.title)}`,
        'conversation.creativeStudio.workspace.table.panel.closeDetails': `Close Board panels for ${String(values?.title)}`,
        'conversation.creativeStudio.workspace.table.panel.detailLabel': `Board panels for ${String(values?.title)}`,
        'conversation.creativeStudio.workspace.table.panel.shotDetails': `Shot ${String(values?.position)} details`,
        'conversation.creativeStudio.workspace.table.panel.head': 'Chain head',
        'conversation.creativeStudio.workspace.table.panel.status.missing': 'Not drawn',
        'conversation.creativeStudio.workspace.table.panel.status.current': 'Current',
        'conversation.creativeStudio.workspace.table.panel.status.stale': 'Stale',
        'conversation.creativeStudio.workspace.table.panel.status.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.table.panel.status.queued': 'Queued',
        'conversation.creativeStudio.workspace.table.panel.status.drawing': 'Drawing',
        'conversation.creativeStudio.workspace.table.panel.status.needsAttention': 'Needs attention',
        'conversation.creativeStudio.workspace.table.panel.status.failed': 'Failed',
        'conversation.creativeStudio.workspace.table.panel.status.cancelled': 'Cancelled',
        'conversation.creativeStudio.workspace.table.board.label': 'Director Board controls',
        'conversation.creativeStudio.workspace.table.board.progressLabel': 'Board completeness',
        'conversation.creativeStudio.workspace.table.board.style.label': 'Board style',
        'conversation.creativeStudio.workspace.table.board.style.greyTone': 'Grey tone',
        'conversation.creativeStudio.workspace.table.board.style.lineArt': 'Line art',
        'conversation.creativeStudio.workspace.table.board.style.colourKey': 'Colour key',
        'conversation.creativeStudio.workspace.table.board.drawNext': `Draw next batch (${String(values?.count)})`,
        'conversation.creativeStudio.workspace.table.board.stop': 'Stop drawing',
        'conversation.creativeStudio.workspace.table.board.stopNote':
          'Stop requests cancellation where possible. Completed panels and charges already incurred remain.',
        'conversation.creativeStudio.workspace.table.board.styleRequired': 'Choose a Board style before drawing.',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.characters': 'Characters',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.background': 'Background',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.shot': `Shot ${String(values?.position)}`,
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.none': 'None',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.save': 'Save references',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.unassigned':
          'Choose the exact references for this Shot.',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.invalid':
          'This Shot binding is no longer valid. Review and save it again.',
        'conversation.creativeStudio.workspace.table.panel.redrawBeat': 'Redraw Beat · paid',
        'conversation.creativeStudio.jobs.retry': 'Retry generation',
        'conversation.creativeStudio.jobs.retryDownload': 'Retry download',
        'conversation.creativeStudio.jobs.cancel': 'Cancel job',
        'conversation.creativeStudio.jobs.retryChargeTitle': 'Retry with possible duplicate charge?',
        'conversation.creativeStudio.jobs.retryChargeBody':
          'The previous submission outcome is unknown. A replacement may create another provider charge.',
        'conversation.creativeStudio.jobs.retryChargeConfirm': 'Acknowledge and review estimate',
        'conversation.creativeStudio.workspace.beatPanel.common.cancel': 'Cancel',
      };
      if (key === 'conversation.creativeStudio.workspace.table.panel.cardLabel') {
        return `Shot ${String(values?.position)}: ${String(values?.status)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.authoring.coverageGap') {
        return `${String(values?.count)} of ${String(values?.total)} Beats ${Number(values?.count) === 1 ? 'has' : 'have'} no Shots`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.authoring.unscriptedWarning') {
        const count = Number(values?.count ?? 0);
        return `${String(count)} ${count === 1 ? 'Shot has' : 'Shots have'} no shooting script`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.authoring.addShotForBeat') {
        return `Add Shot to ${String(values?.title)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.board.progress') {
        return `${String(values?.drawn)} of ${String(values?.total)} panels drawn`;
      }
      if (key === 'conversation.creativeStudio.workspace.referenceWorkflow.bindings.progress') {
        return `${String(values?.ready)} of ${String(values?.total)} Shots bound`;
      }
      if (key === 'conversation.creativeStudio.workspace.referenceWorkflow.bindings.capacity') {
        return `${String(values?.count)} references exceeds the ${String(values?.limit)}-image route limit.`;
      }
      if (key === 'conversation.creativeStudio.workspace.referenceWorkflow.bindings.capacityUsage') {
        return `${String(values?.count)} / ${String(values?.limit)} shared image-reference slots used (characters + background)`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.board.staleCount') {
        return `${String(values?.count)} stale`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.board.busyCount') {
        return `${String(values?.count)} in progress`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.panel.drawMissing') {
        return `Draw missing (${String(values?.count)})`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.panel.redrawShot') {
        return `Redraw Shot ${String(values?.position)} · paid`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.panel.useAsFirstFrame') {
        return `Use Shot ${String(values?.position)} panel as first frame`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.shotCount') {
        const count = Number(values?.count ?? 0);
        return `${count} ${count === 1 ? 'shot' : 'shots'}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.targetDuration') {
        return `~${String(values?.seconds)}s target`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.actualDuration') {
        return `${String(Math.round(Number(values?.seconds)))}s`;
      }
      return copy[key] ?? key;
    },
  }),
}));

import { useWorkspaceDrafts } from '@/renderer/pages/studio/components/Workspace';
import type { ReferenceWorkspaceItem } from '@/renderer/pages/studio/components/Workspace/Views/References';
import {
  TableView,
  type ReferenceBindingWorkspaceItem,
  type TableAuthoringActions,
  type TableBoardActions,
  type TableReferenceBindingActions,
} from '@/renderer/pages/studio/components/Workspace/Views/Table';

const makeShot = (id: string, overrides: Partial<WorkspaceShotProjection> = {}): WorkspaceShotProjection => ({
  id,
  shootingScript: id,
  durationSeconds: 4,
  chainBreak: 'none',
  trimInSeconds: null,
  trimOutSeconds: null,
  currentPicture: null,
  playedDurationSeconds: 4,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  segmentHead: true,
  planningBoundary: { shotId: id, startSeconds: 0, endSeconds: 4 },
  frameBoundary: null,
  segmentState: { kind: 'no_picture' },
  dirtyCauses: [],
  downstreamShotIds: [],
  seedStills: [],
  coverAssetId: null,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  videoGenerationBlocked: false,
  seedGenerationBlocked: false,
  attentionJobs: [],
  hasEffectiveSeed: false,
  ...overrides,
});

const makeBeat = (id: string, overrides: Partial<WorkspaceBeatProjection> = {}): WorkspaceBeatProjection => ({
  id,
  title: `Beat ${id}`,
  story: `Story ${id}`,
  targetSeconds: 8,
  actualSeconds: 8,
  displayState: 'ready',
  shots: [makeShot(`${id}_shot`)],
  ...overrides,
});

const makeBoardPanel = (
  shotId: string,
  overrides: Partial<WorkspaceBoardPanelProjection> = {}
): WorkspaceBoardPanelProjection => ({
  shotId,
  assetId: null,
  producerJobId: null,
  latestJobId: null,
  staleCauses: [],
  freshness: 'missing',
  activity: 'idle',
  recovery: null,
  ...overrides,
});

const makeBoardDownloadRecovery = (jobId: string): NonNullable<WorkspaceBoardPanelProjection['recovery']> => ({
  jobId,
  canRetry: false,
  canCancel: false,
  canRetryDownload: true,
  submissionUnknown: false,
});

const makeTableBoardActions = (): TableBoardActions => ({
  setStyle: vi.fn(),
  drawNext: vi.fn(),
  drawBeat: vi.fn(),
  redrawShot: vi.fn(),
  redrawBeat: vi.fn(),
  promotePanel: vi.fn(),
  stop: vi.fn(),
  retryJob: vi.fn(),
  retryDownload: vi.fn(),
  cancelJob: vi.fn(),
});

const makeBindingActions = (): TableReferenceBindingActions => ({
  saveBinding: vi.fn(async () => true),
});

const makeAuthoringActions = (): TableAuthoringActions => ({
  addBeat: vi.fn(async () => true),
  addShot: vi.fn(async () => true),
  askDirector: vi.fn(),
});

const makeReference = (overrides: Partial<ReferenceWorkspaceItem> = {}): ReferenceWorkspaceItem => ({
  id: 'reference_ming',
  kind: 'character',
  label: 'Ming',
  prompt: 'Red jacket and round glasses',
  lastRunPrompt: 'Red jacket and round glasses',
  approvedAssetId: 'asset_ming',
  generatedAssetIds: ['asset_ming'],
  assetCreatedAt: { asset_ming: '2026-08-20T10:00:00.000Z' },
  assetOrdinalById: { asset_ming: 0 },
  removalBlockers: [],
  generationStatus: 'succeeded',
  candidateJob: null,
  ...overrides,
});

const makeBinding = (overrides: Partial<ReferenceBindingWorkspaceItem> = {}): ReferenceBindingWorkspaceItem => ({
  shotId: 'opening_shot',
  status: 'unassigned',
  characterReferenceIds: [],
  backgroundReferenceId: null,
  ...overrides,
});

const tableBoardProps = (beats: readonly WorkspaceBeatProjection[], onOpenBeat = vi.fn()) => ({
  actions: makeTableBoardActions(),
  authoringActions: makeAuthoringActions(),
  projectId: 'project_1',
  coverageGapBeatIds: beats.filter((beat) => beat.shots.length === 0).map((beat) => beat.id),
  unscriptedShotIds: beats.flatMap((beat) =>
    beat.shots.filter((shot) => shot.shootingScript.trim() === '').map((shot) => shot.id)
  ),
  boardStyle: 'grey_tone' as const,
  boardPanels: beats.flatMap((beat) => beat.shots.map((shot) => makeBoardPanel(shot.id))),
  references: [] as readonly ReferenceWorkspaceItem[],
  referenceBindings: beats.flatMap((beat) => beat.shots.map((shot) => makeBinding({ shotId: shot.id }))),
  referenceMaxConditioningImages: 3,
  referencePendingId: null,
  bindingActions: makeBindingActions(),
  imageRouteReady: true,
  pending: false,
  gateLocked: false,
  onOpenBeat,
});

const rowForBeat = (beatId: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[role="row"][data-beat-id="${beatId}"]`);
  if (row === null) throw new Error(`Missing Beat row ${beatId}`);
  return row;
};

const rowForShot = (shotId: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[role="row"][data-shot-id="${shotId}"]`);
  if (row === null) throw new Error(`Missing Shot row ${shotId}`);
  return row;
};

const cellAt = (row: HTMLElement, column: number): HTMLElement => within(row).getAllByRole('gridcell')[column]!;

describe('TableView', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('renders the seven columns and one semantic data row per Beat in film order', () => {
    const beats = [
      makeBeat('opening', { title: 'Opening', story: '', shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('close', { title: 'Close' }),
    ];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const rows = within(grid).getAllByRole('row');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['#', 'Panel', 'Beat', 'Story', 'Shots', 'Sum', 'State']);
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.dataset.gridColumnName)
    ).toEqual(['position', 'panel', 'beat', 'story', 'shots', 'length', 'state']);
    expect(rows.slice(1).map((row) => cellAt(row, 2).textContent)).toEqual(['Opening', 'Close']);
    expect(rows.slice(1).every((row) => within(row).getAllByRole('gridcell').length === 7)).toBe(true);
    expect(rowForBeat('opening')).toHaveTextContent('2 shots');
    expect(cellAt(rowForBeat('opening'), 3)).toHaveTextContent('');
  });

  it('keeps an empty grid named and headed without inventing a data row', () => {
    render(<TableView {...tableBoardProps([])} beats={[]} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    expect(within(grid).getAllByRole('row')).toHaveLength(1);
    expect(within(grid).queryAllByRole('gridcell')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('No beats yet');
  });

  it('names authoring gaps exactly and fences every Beat Add Shot control from Beat opening', async () => {
    const user = userEvent.setup();
    const onOpenBeat = vi.fn();
    const authoringActions = makeAuthoringActions();
    const beats = [
      makeBeat('opaque_generated_identity', { title: '  ', story: '', shots: [] }),
      makeBeat('script_gap', { title: 'Market', shots: [makeShot('blank_shot', { shootingScript: ' \n ' })] }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
        authoringActions={authoringActions}
        beats={beats}
        coverageGapBeatIds={['opaque_generated_identity']}
        onOpenBeat={onOpenBeat}
        onSelectBeat={vi.fn()}
        selectedBeatId={null}
        unscriptedShotIds={['blank_shot']}
      />
    );

    const authoring = screen.getByRole('region', { name: 'Story authoring and recovery' });
    expect(within(authoring).getByText('1 of 2 Beats has no Shots')).toBeVisible();
    expect(within(authoring).getByText('1 Shot has no shooting script')).toBeVisible();
    expect(authoring).toHaveTextContent(
      'A hand-authored Shot starts with references unassigned and requires review before paid generation.'
    );
    expect(rowForBeat('opaque_generated_identity')).toHaveTextContent('Untitled Beat 1');
    expect(rowForBeat('opaque_generated_identity')).not.toHaveTextContent('opaque_generated_identity');

    const addToUntitled = screen.getByRole('button', { name: 'Add Shot to Untitled Beat 1' });
    const addToMarket = screen.getByRole('button', { name: 'Add Shot to Market' });
    await user.click(addToUntitled);
    await user.keyboard('{Enter}');
    await user.click(addToMarket);
    expect(authoringActions.addShot).toHaveBeenNthCalledWith(1, 'opaque_generated_identity');
    expect(authoringActions.addShot).toHaveBeenNthCalledWith(2, 'opaque_generated_identity');
    expect(authoringActions.addShot).toHaveBeenNthCalledWith(3, 'script_gap');
    expect(onOpenBeat).not.toHaveBeenCalled();

    await user.click(within(authoring).getByRole('button', { name: 'Ask Director' }));
    expect(authoringActions.askDirector).toHaveBeenCalledExactlyOnceWith('opaque_generated_identity');
    await user.click(within(authoring).getByRole('button', { name: 'Add Beat' }));
    expect(authoringActions.addBeat).toHaveBeenCalledTimes(1);
  });

  it('hides zero warnings and locks every authoring action while pending or gate locked', () => {
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const { rerender } = render(
      <TableView {...tableBoardProps(beats)} beats={beats} onSelectBeat={vi.fn()} pending selectedBeatId={null} />
    );

    const authoring = screen.getByRole('region', { name: 'Story authoring and recovery' });
    expect(authoring.querySelector('[data-coverage-gap-count]')).toBeNull();
    expect(authoring.querySelector('[data-unscripted-shot-count]')).toBeNull();
    expect(within(authoring).getByRole('button', { name: 'Add Beat' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Shot to Opening' })).toBeDisabled();

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        coverageGapBeatIds={['opening']}
        gateLocked
        onSelectBeat={vi.fn()}
        selectedBeatId={null}
      />
    );
    expect(within(authoring).getByRole('button', { name: 'Ask Director' })).toBeDisabled();
    expect(within(authoring).getByRole('button', { name: 'Add Beat' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Shot to Opening' })).toBeDisabled();
  });

  it('routes Ask Director to the Beat owning the first unscripted Shot when coverage is complete', async () => {
    const user = userEvent.setup();
    const authoringActions = makeAuthoringActions();
    const beats = [
      makeBeat('opening', { title: 'Opening' }),
      makeBeat('close', { title: 'Close', shots: [makeShot('blank_close', { shootingScript: '' })] }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        authoringActions={authoringActions}
        beats={beats}
        coverageGapBeatIds={[]}
        onSelectBeat={vi.fn()}
        selectedBeatId={null}
        unscriptedShotIds={['blank_close']}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Ask Director' }));
    expect(authoringActions.askDirector).toHaveBeenCalledExactlyOnceWith('close');
  });

  it('rerenders a new unscripted Shot as unassigned and reviewable without claiming generated work', async () => {
    const user = userEvent.setup();
    const emptyBeat = makeBeat('opening', { title: 'Opening', shots: [] });
    const props = tableBoardProps([emptyBeat]);
    const { rerender } = render(
      <TableView {...props} beats={[emptyBeat]} onSelectBeat={vi.fn()} selectedBeatId={null} />
    );

    const newShot = makeShot('shot_new', { shootingScript: '' });
    const refreshedBeat = makeBeat('opening', { title: 'Opening', shots: [newShot] });
    rerender(
      <TableView
        {...props}
        beats={[refreshedBeat]}
        boardPanels={[makeBoardPanel('shot_new')]}
        coverageGapBeatIds={[]}
        onSelectBeat={vi.fn()}
        referenceBindings={[makeBinding({ shotId: 'shot_new', status: 'unassigned' })]}
        selectedBeatId={null}
        unscriptedShotIds={['shot_new']}
      />
    );

    expect(screen.getByText('1 Shot has no shooting script')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    await user.click(screen.getByRole('button', { name: 'Expand: Shot 1 details' }));
    expect(rowForShot('shot_new')).toHaveAttribute('data-shot-binding-status', 'unassigned');
    expect(within(rowForShot('shot_new')).getByRole('alert')).toHaveTextContent(
      'Choose the exact references for this Shot.'
    );
    expect(rowForShot('shot_new').querySelector('[data-asset-id]')).toBeNull();
  });

  it('owns exact Shot reference binding inside the expanded Beat and reports bound progress', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const bindingActions = makeBindingActions();
    const references = [
      makeReference(),
      makeReference({
        id: 'reference_market',
        kind: 'background',
        label: 'Dai pai dong',
        approvedAssetId: 'asset_market',
        generatedAssetIds: ['asset_market'],
      }),
    ];
    const { container } = render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        references={references}
        referenceBindings={[makeBinding({ characterReferenceIds: ['reference_ming'] })]}
        bindingActions={bindingActions}
        referenceMaxConditioningImages={2}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByText('0 of 1 Shots bound')).toBeVisible();
    expect(container.querySelector('[data-shot-binding-status]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    await user.click(screen.getByRole('button', { name: 'Expand: Shot 1 details' }));

    const shot = container.querySelector<HTMLElement>('[data-shot-id="opening_shot"]');
    expect(shot).toHaveAttribute('data-shot-binding-status', 'unassigned');
    expect(within(shot!).getByRole('alert')).toHaveTextContent('Choose the exact references for this Shot.');

    const background = within(shot!).getByRole('combobox', { name: 'Background' });
    await user.click(background);
    await waitFor(() => expect(document.getElementById(background.getAttribute('aria-controls') ?? '')).not.toBeNull());
    const popup = document.getElementById(background.getAttribute('aria-controls') ?? '');
    if (popup === null) throw new Error('Missing background reference popup');
    fireEvent.click(within(popup).getByRole('option', { name: 'Dai pai dong' }));
    expect(
      within(shot!).getByText('2 / 2 shared image-reference slots used (characters + background)')
    ).toHaveAttribute('data-over-capacity', 'false');

    await user.click(within(shot!).getByRole('button', { name: 'Save references' }));
    await waitFor(() =>
      expect(bindingActions.saveBinding).toHaveBeenCalledExactlyOnceWith(
        'opening_shot',
        ['reference_ming'],
        'reference_market'
      )
    );
  });

  it('leaves invalid Shot bindings actionable but fails closed above the route capacity', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const references = ['ming', 'mei', 'chen'].map((name) =>
      makeReference({
        id: `reference_${name}`,
        label: name,
        approvedAssetId: `asset_${name}`,
        generatedAssetIds: [`asset_${name}`],
      })
    );
    const { container } = render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        references={references}
        referenceBindings={[
          makeBinding({
            status: 'invalid',
            characterReferenceIds: ['reference_ming', 'reference_mei', 'reference_chen'],
          }),
        ]}
        referenceMaxConditioningImages={2}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    await user.click(screen.getByRole('button', { name: 'Expand: Shot 1 details' }));
    const shot = container.querySelector<HTMLElement>('[data-shot-id="opening_shot"]');
    expect(within(shot!).getAllByRole('alert')[0]).toHaveTextContent(
      'This Shot binding is no longer valid. Review and save it again.'
    );
    expect(within(shot!).getAllByRole('alert')[1]).toHaveTextContent('3 references exceeds the 2-image route limit.');
    expect(
      within(shot!).getByText('3 / 2 shared image-reference slots used (characters + background)')
    ).toHaveAttribute('data-over-capacity', 'true');
    expect(within(shot!).getByRole('button', { name: 'Save references' })).toBeDisabled();
  });

  it('opens and highlights the exact Shot when review sends a binding focus intent', async () => {
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const consumed = vi.fn();
    const { container, rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        referenceFocusIntent={{
          id: 'focus_1',
          projectId: 'project_1',
          referenceIds: [],
          assetIds: [],
          shotIds: ['opening_shot'],
        }}
        onReferenceFocusIntentConsumed={consumed}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(container.querySelector('[data-shot-id="opening_shot"]')).toHaveAttribute(
        'data-shot-binding-highlighted',
        'true'
      )
    );
    expect(screen.getByRole('button', { name: 'Collapse: Shot 1 details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Shot 1 details' })).toHaveFocus();
    expect(consumed).toHaveBeenCalledExactlyOnceWith('focus_1');
    rerender(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        referenceFocusIntent={{
          id: 'focus_1',
          projectId: 'project_1',
          referenceIds: [],
          assetIds: [],
          shotIds: ['opening_shot'],
        }}
        onReferenceFocusIntentConsumed={consumed}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(consumed).toHaveBeenCalledTimes(1);

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        referenceFocusIntent={null}
        onReferenceFocusIntentConsumed={consumed}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    rerender(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        referenceFocusIntent={{
          id: 'focus_1',
          projectId: 'project_1',
          referenceIds: [],
          assetIds: [],
          shotIds: ['opening_shot'],
        }}
        onReferenceFocusIntentConsumed={consumed}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(2));
    expect(consumed).toHaveBeenNthCalledWith(2, 'focus_1');
  });

  it('ignores an old-project focus intent even when its Shot ID overlaps the current project', () => {
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const consumed = vi.fn();
    render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        referenceFocusIntent={{
          id: 'focus_shared',
          projectId: 'project_old',
          referenceIds: [],
          assetIds: [],
          shotIds: ['opening_shot'],
        }}
        onReferenceFocusIntentConsumed={consumed}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(document.querySelector('[data-shot-id="opening_shot"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Shot 1 details' })).toBeNull();
    expect(consumed).not.toHaveBeenCalled();
  });

  it('correlates consumed focus intent IDs with the project so the same ID can be used in a new project', async () => {
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const consumed = vi.fn();
    const focusIntent = (projectId: string) => ({
      id: 'focus_shared',
      projectId,
      referenceIds: [],
      assetIds: [],
      shotIds: ['opening_shot'],
    });
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        referenceFocusIntent={focusIntent('project_1')}
        onReferenceFocusIntentConsumed={consumed}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await waitFor(() => expect(consumed).toHaveBeenCalledExactlyOnceWith('focus_shared'));

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        projectId='project_2'
        referenceFocusIntent={focusIntent('project_2')}
        onReferenceFocusIntentConsumed={consumed}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(2));
    expect(consumed).toHaveBeenNthCalledWith(2, 'focus_shared');
  });

  it('shows a fixed lead Panel thumbnail and the remaining Shot count from exact film-order status', () => {
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_1'), makeShot('shot_2'), makeShot('shot_3')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2'),
      makeBoardPanel('shot_3'),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const panelColumn = screen
      .getByRole('grid', { name: 'Beat table' })
      .querySelector<HTMLTableColElement>('col[data-grid-column-name="panel"]');
    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    expect(panelColumn).toHaveAttribute('data-fixed-inline-size', '176');
    expect(disclosure.querySelector('[data-asset-id="board_1"]')).not.toBeNull();
    expect(disclosure).toHaveTextContent('+2');
  });

  it('opens six semantic Shot rows for one Beat without opening the BeatPanel and keeps ARIA geometry exact', async () => {
    const user = userEvent.setup();
    const openingShots = Array.from({ length: 6 }, (_, index) =>
      makeShot(`shot_${String(index + 1)}`, {
        segmentHead: index === 0,
        shootingScript: `Shooting script ${String(index + 1)}`,
      })
    );
    const beats = [
      makeBeat('opening', { title: 'Opening', shots: openingShots }),
      makeBeat('close', { title: 'Close', shots: [makeShot('shot_7')] }),
    ];
    const onOpenBeat = vi.fn();
    const onSelectBeat = vi.fn();
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
    );

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const openingDisclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    const openingStoryBeforeExpansion = cellAt(rowForBeat('opening'), 3).innerHTML;
    await user.click(openingDisclosure);

    const openingRows = openingShots.map((shot) => rowForShot(shot.id));
    expect(onSelectBeat).toHaveBeenLastCalledWith('opening');
    expect(onOpenBeat).not.toHaveBeenCalled();
    expect(openingDisclosure).toHaveAttribute('aria-expanded', 'true');
    expect(openingDisclosure.getAttribute('aria-controls')?.split(' ')).toEqual(openingRows.map((shot) => shot.id));
    expect(grid).toHaveAttribute('aria-rowcount', '9');
    expect(within(grid).getAllByRole('row')).toHaveLength(9);
    expect(grid.querySelectorAll('[data-board-detail-for="opening"]')).toHaveLength(6);
    expect(grid.querySelector('[colspan]')).toBeNull();
    expect(rowForBeat('opening')).toHaveAttribute('aria-rowindex', '2');
    expect(cellAt(rowForBeat('opening'), 3).innerHTML).toBe(openingStoryBeforeExpansion);
    expect(within(rowForBeat('opening')).queryByRole('toolbar')).toBeNull();
    expect(within(openingRows[0]!).getByRole('toolbar', { name: 'Board panels for Opening' })).toBeInTheDocument();
    expect(openingRows.slice(1).every((shot) => within(shot).queryByRole('toolbar') === null)).toBe(true);
    expect(openingRows.map((shot) => shot.getAttribute('aria-rowindex'))).toEqual(['3', '4', '5', '6', '7', '8']);
    expect(openingRows.every((shot) => within(shot).getAllByRole('gridcell').length === 7)).toBe(true);
    expect(rowForBeat('close')).toHaveAttribute('aria-rowindex', '9');
    await user.click(openingRows[0]!);
    expect(onOpenBeat).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open Board panels for Close' }));
    expect(document.querySelector('[data-shot-id="shot_1"]')).toBeNull();
    expect(rowForShot('shot_7')).toBeInTheDocument();
    expect(grid).toHaveAttribute('aria-rowcount', '4');
    expect(rowForBeat('close')).toHaveAttribute('aria-rowindex', '3');
    expect(rowForShot('shot_7')).toHaveAttribute('aria-rowindex', '4');

    await user.click(rowForBeat('opening'));
    expect(onOpenBeat).toHaveBeenLastCalledWith('opening');
  });

  it('keeps at most one Shot control surface open and clears it with the owning Beat expansion', async () => {
    const user = userEvent.setup();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_1'), makeShot('shot_2')],
      }),
    ];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    const beatDisclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    await user.click(beatDisclosure);
    const first = within(rowForShot('shot_1')).getByRole('button', { name: 'Expand: Shot 1 details' });
    const second = within(rowForShot('shot_2')).getByRole('button', { name: 'Expand: Shot 2 details' });
    await user.click(first);
    expect(screen.getByRole('region', { name: 'Shot 1 details' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Shot 2 details' })).toBeNull();

    await user.click(second);
    expect(screen.queryByRole('region', { name: 'Shot 1 details' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Shot 2 details' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /Shot \d+ details/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Close Board panels for Opening' }));
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    expect(screen.queryByRole('region', { name: /Shot \d+ details/ })).toBeNull();
    expect(within(rowForShot('shot_2')).getByRole('button', { name: 'Expand: Shot 2 details' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('fences disclosure activation from the Beat row and lets arrows leave a pointer-focused button', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' }), makeBeat('close', { title: 'Close' })];
    const onOpenBeat = vi.fn();
    const onSelectBeat = vi.fn();
    const actions = makeTableBoardActions();
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
        actions={actions}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
    );
    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });

    act(() => disclosure.focus());
    await user.keyboard('{Enter}');
    expect(onSelectBeat).toHaveBeenCalledTimes(1);
    expect(onOpenBeat).not.toHaveBeenCalled();
    expect(rowForShot('opening_shot')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Draw missing (1)' }));
    expect(actions.drawBeat).toHaveBeenCalledExactlyOnceWith('opening');
    expect(onOpenBeat).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Expand: Shot 1 details' }));
    expect(onOpenBeat).not.toHaveBeenCalled();
    act(() => disclosure.focus());

    await user.keyboard('{ArrowDown}');
    expect(cellAt(rowForBeat('close'), 1)).toHaveFocus();
    expect(onOpenBeat).not.toHaveBeenCalled();
    expect(
      screen.getByRole('grid', { name: 'Beat table' }).querySelectorAll('[role="gridcell"][tabindex="0"]')
    ).toHaveLength(1);
  });

  it('closes inline details with Escape from either detail content or its roving Panel cell and restores the button', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' })];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    await user.click(disclosure);
    await user.click(screen.getByRole('button', { name: 'Expand: Shot 1 details' }));
    const detail = screen.getByRole('region', { name: 'Shot 1 details' });
    act(() => detail.focus());
    await user.keyboard('{Escape}');
    expect(document.querySelector('[data-shot-id="opening_shot"]')).toBeNull();
    expect(disclosure).toHaveFocus();

    act(() => cellAt(rowForBeat('opening'), 1).focus());
    await user.keyboard('{Enter}');
    expect(rowForShot('opening_shot')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(document.querySelector('[data-shot-id="opening_shot"]')).toBeNull();
    expect(disclosure).toHaveFocus();
  });

  it('renders one seven-cell row per Shot with script, chain position, status, duration, and fullscreen access', async () => {
    const user = userEvent.setup();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [
          makeShot('shot_1', { segmentHead: true, shootingScript: 'Ming enters the market.' }),
          makeShot('shot_2', { segmentHead: false, shootingScript: 'Mei turns toward Ming.', durationSeconds: 6 }),
          makeShot('shot_3', { segmentHead: true, shootingScript: 'A new angle begins.' }),
        ],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2', { freshness: 'stale', staleCauses: ['request_out_of_date'] }),
      makeBoardPanel('shot_3', { activity: 'drawing', latestJobId: 'job_3' }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    const shotRows = ['shot_1', 'shot_2', 'shot_3'].map(rowForShot);
    expect(screen.queryByRole('toolbar', { name: 'Board panels for Opening' })).toBeNull();
    expect(shotRows).toHaveLength(3);
    expect(shotRows.every((shot) => within(shot).getAllByRole('gridcell').length === 7)).toBe(true);
    expect(screen.getAllByText('Chain head')).toHaveLength(2);
    expect(rowForShot('shot_1').querySelector('[data-chain-position="head"]')).toHaveTextContent('Chain head');
    expect(rowForShot('shot_1')).toHaveTextContent('Ming enters the market.');
    expect(rowForShot('shot_2')).toHaveTextContent('Mei turns toward Ming.');
    expect(rowForShot('shot_2').querySelector('[data-chain-position="predecessor:1"]')).toHaveTextContent('← Shot 1');
    expect(rowForShot('shot_2')).toHaveTextContent('6s');
    expect(screen.getByRole('row', { name: 'Shot 2: Stale' })).toHaveTextContent('Stale');
    expect(screen.getByRole('row', { name: 'Shot 3: Drawing' })).toHaveTextContent('Drawing');
    expect(tableCss).toMatch(/\.shotPanelFrame\s*{[^}]*inline-size:\s*144px[^}]*block-size:\s*81px/s);

    const currentPanel = screen.getByRole('row', { name: 'Shot 1: Current' });
    const expand = within(currentPanel).getByRole('button', { name: 'Expand' });
    const fullscreenFrame = expand.closest<HTMLElement>('[data-fullscreen-media-frame]');
    if (fullscreenFrame === null) throw new Error('Missing fullscreen frame for current Board panel');
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(fullscreenFrame, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    await user.click(expand);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByRole('row', { name: 'Shot 2: Stale' })).queryByRole('button', { name: 'Expand' })
    ).toBeNull();
  });

  it('offers first-frame promotion only for a stable current Board panel on an actual segment head', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [
          makeShot('shot_head', { segmentHead: true }),
          makeShot('shot_continuous', { segmentHead: false }),
          makeShot('shot_already_pinned', { segmentHead: true, explicitSeedAssetId: 'board_pinned' }),
          makeShot('shot_stale_head', { segmentHead: true }),
          makeShot('shot_busy_head', { segmentHead: true }),
          makeShot('shot_attention_head', { segmentHead: true }),
        ],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_head', { assetId: 'board_head', producerJobId: 'job_head', freshness: 'current' }),
      makeBoardPanel('shot_continuous', {
        assetId: 'board_continuous',
        producerJobId: 'job_continuous',
        freshness: 'current',
      }),
      makeBoardPanel('shot_already_pinned', {
        assetId: 'board_pinned',
        producerJobId: 'job_pinned',
        freshness: 'current',
      }),
      makeBoardPanel('shot_stale_head', {
        assetId: 'board_stale',
        producerJobId: 'job_stale',
        freshness: 'stale',
        staleCauses: ['request_out_of_date'],
      }),
      makeBoardPanel('shot_busy_head', {
        assetId: 'board_busy',
        producerJobId: 'job_busy',
        latestJobId: 'job_redraw',
        freshness: 'current',
        activity: 'drawing',
      }),
      makeBoardPanel('shot_attention_head', {
        assetId: 'board_attention',
        producerJobId: 'job_attention_producer',
        latestJobId: 'job_attention',
        freshness: 'current',
        activity: 'needs_attention',
      }),
    ];
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    await user.click(within(rowForShot('shot_head')).getByRole('button', { name: 'Expand: Shot 1 details' }));
    const promote = screen.getByRole('button', { name: 'Use Shot 1 panel as first frame' });
    await user.click(promote);
    expect(actions.promotePanel).toHaveBeenCalledExactlyOnceWith('shot_head', 'board_head');
    for (const [shotId, position] of [
      ['shot_continuous', 2],
      ['shot_already_pinned', 3],
      ['shot_stale_head', 4],
      ['shot_busy_head', 5],
      ['shot_attention_head', 6],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- each disclosure replaces the prior Shot detail
      await user.click(
        within(rowForShot(shotId)).getByRole('button', { name: `Expand: Shot ${String(position)} details` })
      );
      expect(screen.queryByRole('button', { name: /Use Shot \d+ panel as first frame/ })).toBeNull();
    }

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        gateLocked
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(within(rowForShot('shot_head')).getByRole('button', { name: 'Expand: Shot 1 details' }));
    expect(screen.getByRole('button', { name: 'Use Shot 1 panel as first frame' })).toBeDisabled();
  });

  it('fails closed instead of cross-associating reordered Board panel status', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening', shots: [makeShot('shot_1'), makeShot('shot_2')] })];
    const reordered = [
      makeBoardPanel('shot_2', { assetId: 'board_2', freshness: 'current' }),
      makeBoardPanel('shot_1', { assetId: 'board_1', freshness: 'current' }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        boardPanels={reordered}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    expect(disclosure.querySelector('[data-asset-id]')).toBeNull();
    expect(disclosure.querySelector('[data-freshness="status_pending"]')).not.toBeNull();
    await user.click(disclosure);
    expect(screen.getAllByText('Status pending')).toHaveLength(2);
  });

  it('names exact Board completeness separately from the capped next paid batch without exposing Board style', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const shots = Array.from({ length: 30 }, (_, index) => makeShot(`shot_${String(index + 1)}`));
    const beats = [makeBeat('opening', { title: 'Opening', shots })];
    const boardPanels = shots.map((shot, index) =>
      makeBoardPanel(
        shot.id,
        index === 0
          ? { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }
          : index === 1
            ? {
                assetId: 'board_2',
                producerJobId: 'job_2',
                freshness: 'stale',
                staleCauses: ['request_out_of_date'],
              }
            : {}
      )
    );
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const controls = screen.getByRole('region', { name: 'Director Board controls' });
    expect(within(controls).getByText('2 of 30 panels drawn')).toBeInTheDocument();
    expect(within(controls).getByText('1 stale')).toBeInTheDocument();
    expect(within(controls).getByText('0 in progress')).toBeInTheDocument();
    expect(within(controls).getByRole('progressbar', { name: 'Board completeness' })).toHaveAttribute('max', '30');
    expect(within(controls).getByRole('progressbar', { name: 'Board completeness' })).toHaveAttribute('value', '2');

    const drawNext = within(controls).getByRole('button', { name: 'Draw next batch (24)' });
    expect(drawNext).toBeEnabled();
    act(() => drawNext.focus());
    await user.keyboard('{Enter}');
    expect(actions.drawNext).toHaveBeenCalledTimes(1);

    expect(within(controls).queryByRole('radio')).toBeNull();
    expect(within(controls).queryByText('Board style')).toBeNull();
    expect(actions.setStyle).not.toHaveBeenCalled();
  });

  it('fails Board generation controls closed when the route or exact panel status is unavailable', () => {
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const actions = makeTableBoardActions();
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        imageRouteReady={false}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Draw next batch (1)' })).toBeDisabled();
    expect(screen.queryByRole('radio')).toBeNull();

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={[makeBoardPanel('opening_shot', { freshness: 'status_pending', activity: 'status_pending' })]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Draw next batch (0)' })).toBeDisabled();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(actions.drawNext).not.toHaveBeenCalled();
  });

  it('offers Stop only for active Board work and preserves the completed/charged warning', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const actions = makeTableBoardActions();
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={[
          makeBoardPanel('opening_shot', {
            assetId: 'retained_board',
            producerJobId: 'job_done',
            latestJobId: 'job_redraw',
            freshness: 'current',
            activity: 'drawing',
          }),
        ]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByText('1 of 1 panels drawn')).toBeInTheDocument();
    expect(screen.getByText('1 in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draw next batch/ })).toBeNull();
    expect(
      screen.getByText(
        'Stop requests cancellation where possible. Completed panels and charges already incurred remain.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop drawing' });
    act(() => stop.focus());
    await user.keyboard('{Enter}');
    expect(actions.stop).toHaveBeenCalledTimes(1);
  });

  it('separates Board attention from active progress and exposes only sanitized retry/cancel authority', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_unknown'), makeShot('shot_retryable')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_unknown', {
        activity: 'needs_attention',
        latestJobId: 'job_unknown',
        recovery: {
          jobId: 'job_unknown',
          canRetry: true,
          canCancel: false,
          canRetryDownload: false,
          submissionUnknown: true,
        },
      }),
      makeBoardPanel('shot_retryable', {
        activity: 'needs_attention',
        latestJobId: 'job_retryable',
        recovery: {
          jobId: 'job_retryable',
          canRetry: true,
          canCancel: true,
          canRetryDownload: false,
          submissionUnknown: false,
        },
      }),
    ];
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByText('0 in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop drawing' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    await user.click(within(rowForShot('shot_unknown')).getByRole('button', { name: 'Expand: Shot 1 details' }));

    const unknown = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_unknown"]');
    if (unknown === null) throw new Error('Missing unknown-outcome Board recovery controls');
    expect(within(unknown).queryByRole('button', { name: 'Cancel job' })).toBeNull();
    await user.click(within(unknown).getByRole('button', { name: 'Retry generation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge and review estimate' }));
    expect(actions.retryJob).toHaveBeenCalledWith('job_unknown', true);

    await user.click(within(rowForShot('shot_retryable')).getByRole('button', { name: 'Expand: Shot 2 details' }));
    const retryable = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_retryable"]');
    if (retryable === null) throw new Error('Missing retryable Board recovery controls');
    await user.click(within(retryable).getByRole('button', { name: 'Retry generation' }));
    expect(actions.retryJob).toHaveBeenCalledWith('job_retryable', false);
    await user.click(within(retryable).getByRole('button', { name: 'Cancel job' }));
    expect(actions.cancelJob).toHaveBeenCalledWith('job_retryable');

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        gateLocked
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[data-board-recovery-job-id] button')).every((button) =>
        button.hasAttribute('disabled')
      )
    ).toBe(true);
  });

  it('offers no-charge download recovery without offering a fresh paid Draw or Redraw', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_missing'), makeShot('shot_retained')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_missing', {
        activity: 'failed',
        latestJobId: 'job_missing_download',
        recovery: makeBoardDownloadRecovery('job_missing_download'),
      }),
      makeBoardPanel('shot_retained', {
        assetId: 'board_retained',
        producerJobId: 'job_retained_producer',
        latestJobId: 'job_retained_download',
        freshness: 'current',
        activity: 'failed',
        recovery: makeBoardDownloadRecovery('job_retained_download'),
      }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Draw next batch (0)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    expect(screen.queryByRole('button', { name: /Draw missing/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redraw Beat · paid' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Redraw Shot/ })).toBeNull();

    await user.click(within(rowForShot('shot_missing')).getByRole('button', { name: 'Expand: Shot 1 details' }));
    const missing = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_missing_download"]');
    if (missing === null) throw new Error('Missing Board download recovery controls for missing panel');
    await user.click(within(missing).getByRole('button', { name: 'Retry download' }));
    await user.click(within(rowForShot('shot_retained')).getByRole('button', { name: 'Expand: Shot 2 details' }));
    const retained = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_retained_download"]');
    if (retained === null) throw new Error('Missing Board download recovery controls for retained panel');
    await user.click(within(retained).getByRole('button', { name: 'Retry download' }));
    expect(actions.retryDownload).toHaveBeenNthCalledWith(1, 'job_missing_download');
    expect(actions.retryDownload).toHaveBeenNthCalledWith(2, 'job_retained_download');
    expect(actions.drawNext).not.toHaveBeenCalled();
    expect(actions.drawBeat).not.toHaveBeenCalled();
    expect(actions.redrawShot).not.toHaveBeenCalled();
    expect(actions.redrawBeat).not.toHaveBeenCalled();
  });

  it('draws only exact drawable missing panels in one Beat and offers paid redraw only for existing panels', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_1'), makeShot('shot_2'), makeShot('shot_3'), makeShot('shot_4')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2'),
      makeBoardPanel('shot_3', { activity: 'failed', latestJobId: 'job_3' }),
      makeBoardPanel('shot_4', { activity: 'queued', latestJobId: 'job_4' }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    expect(screen.queryByRole('button', { name: 'Redraw Beat · paid' })).toBeNull();
    const drawMissing = screen.getByRole('button', { name: 'Draw missing (2)' });
    act(() => drawMissing.focus());
    await user.keyboard('{Enter}');
    expect(actions.drawBeat).toHaveBeenCalledWith('opening');
    await user.click(within(rowForShot('shot_1')).getByRole('button', { name: 'Expand: Shot 1 details' }));
    const redrawShots = screen.getAllByRole('button', { name: /Redraw Shot/ });
    expect(redrawShots).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Redraw Shot 1 · paid' }));
    expect(actions.redrawShot).toHaveBeenCalledWith('shot_1');
  });

  it('offers paid Beat and per-panel redraw only when every panel exists and is exactly drawable', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_1'), makeShot('shot_2'), makeShot('shot_3')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2', {
        assetId: 'board_2',
        producerJobId: 'job_2',
        freshness: 'stale',
        activity: 'failed',
        staleCauses: ['route_out_of_date'],
      }),
      makeBoardPanel('shot_3', {
        assetId: 'board_3',
        producerJobId: 'job_3',
        freshness: 'current',
        activity: 'cancelled',
      }),
    ];
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    expect(screen.queryByRole('button', { name: /Draw missing/ })).toBeNull();
    const redrawBeat = screen.getByRole('button', { name: 'Redraw Beat · paid' });
    expect(redrawBeat).toBeEnabled();
    await user.click(redrawBeat);
    expect(actions.redrawBeat).toHaveBeenCalledWith('opening');
    for (const [shotId, position] of [
      ['shot_1', 1],
      ['shot_2', 2],
      ['shot_3', 3],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- one Shot detail is intentionally open at a time
      await user.click(
        within(rowForShot(shotId)).getByRole('button', { name: `Expand: Shot ${String(position)} details` })
      );
      const redrawShot = screen.getByRole('button', { name: `Redraw Shot ${String(position)} · paid` });
      expect(redrawShot).toBeEnabled();
      // eslint-disable-next-line no-await-in-loop -- each paid action predicate is exercised independently
      await user.click(redrawShot);
    }
    expect(actions.redrawShot).toHaveBeenNthCalledWith(1, 'shot_1');
    expect(actions.redrawShot).toHaveBeenNthCalledWith(2, 'shot_2');
    expect(actions.redrawShot).toHaveBeenNthCalledWith(3, 'shot_3');

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        gateLocked
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Redraw Beat · paid' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redraw Shot 3 · paid' })).toBeDisabled();
  });

  it('keeps roving ArrowDown navigation on Beat cells while an inline detail row is open', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' }), makeBeat('close', { title: 'Close' })];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    act(() => cellAt(rowForBeat('opening'), 0).focus());
    await user.keyboard('{ArrowDown}');
    expect(cellAt(rowForBeat('close'), 0)).toHaveFocus();
  });

  it('traverses all 24 Beat rows vertically with one clamped roving tab stop and no selection', async () => {
    const user = userEvent.setup();
    const onOpenBeat = vi.fn();
    const beats = Array.from({ length: 24 }, (_, index) => makeBeat(`beat_${index + 1}`));
    render(
      <TableView {...tableBoardProps(beats, onOpenBeat)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />
    );
    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const rows = within(grid).getAllByRole('row').slice(1);
    const first = cellAt(rows[0]!, 0);
    const last = cellAt(rows[23]!, 0);

    act(() => first.focus());
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
    for (let index = 0; index < 23; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- each key must move focus before the next key is dispatched
      await user.keyboard('{ArrowDown}');
    }
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowDown}');
    expect(last).toHaveFocus();
    expect(grid.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(onOpenBeat).not.toHaveBeenCalled();
  });

  it('moves across columns and supports clamped row and grid Home/End navigation', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('beat_1'), makeBeat('beat_2')];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const rows = screen.getAllByRole('row').slice(1);
    const first = cellAt(rows[0]!, 0);
    act(() => first.focus());

    await user.keyboard('{ArrowLeft}{ArrowRight}');
    expect(cellAt(rows[0]!, 1)).toHaveFocus();
    await user.keyboard('{End}');
    expect(cellAt(rows[0]!, 6)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cellAt(rows[0]!, 6)).toHaveFocus();
    fireEvent.keyDown(cellAt(rows[0]!, 6), { key: 'End', ctrlKey: true });
    expect(cellAt(rows[1]!, 6)).toHaveFocus();
    fireEvent.keyDown(cellAt(rows[1]!, 6), { key: 'Home', metaKey: true });
    expect(first).toHaveFocus();
  });

  it('selects the exact Beat by click, Enter, or Space while arrows only move focus', async () => {
    const user = userEvent.setup();
    const onOpenBeat = vi.fn();
    const onSelectBeat = vi.fn();
    const beats = [
      makeBeat('multi', { shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('empty', { shots: [] }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
    );
    const multi = rowForBeat('multi');
    const empty = rowForBeat('empty');
    fireEvent.click(multi);
    expect(onOpenBeat).toHaveBeenLastCalledWith('multi');

    act(() => cellAt(multi, 0).focus());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onOpenBeat).toHaveBeenLastCalledWith('empty');
    await user.keyboard('{Space}');
    expect(onOpenBeat).toHaveBeenLastCalledWith('empty');
    expect(onOpenBeat).toHaveBeenCalledTimes(3);
    expect(onSelectBeat).not.toHaveBeenCalled();
    expect(empty).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps multi-shot and zero-shot Beat selection in the shared owner without changing paid Shot selection', () => {
    const beats = [
      makeBeat('multi', { shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('empty', { shots: [], actualSeconds: null, displayState: 'no_coverage' }),
    ];
    window.sessionStorage.setItem(
      'aionui:creative-studio:v3:workspace-drafts:project_1',
      JSON.stringify({
        version: 3,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {},
        selection: { selectedBeatId: null, selectedShotIds: ['shot_2'], anchorShotId: 'shot_2' },
      })
    );

    const Harness = () => {
      const [showTable, setShowTable] = useState(true);
      const drafts = useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: {},
        activeBeatIds: ['multi', 'empty'],
        activeShotIds: ['shot_1', 'shot_2'],
      });
      return (
        <>
          <button type='button' onClick={() => setShowTable((current) => !current)}>
            Toggle presentation
          </button>
          <output data-testid='selection'>{JSON.stringify(drafts.selection)}</output>
          {showTable ? (
            <TableView
              {...tableBoardProps(beats, drafts.selectBeat)}
              beats={beats}
              selectedBeatId={drafts.selection.selectedBeatId}
              onSelectBeat={drafts.selectBeat}
            />
          ) : (
            <div data-testid='alternate-presentation'>{drafts.selection.selectedBeatId}</div>
          )}
        </>
      );
    };

    render(<Harness />);
    const shotSelectionBytes = (): string => {
      const selection = JSON.parse(screen.getByTestId('selection').textContent ?? '{}') as {
        selectedShotIds?: unknown;
        anchorShotId?: unknown;
      };
      return JSON.stringify({
        selectedShotIds: selection.selectedShotIds,
        anchorShotId: selection.anchorShotId,
      });
    };
    const preservedShotSelection = shotSelectionBytes();
    fireEvent.click(rowForBeat('multi'));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}')).toEqual({
      selectedBeatId: 'multi',
      selectedShotIds: ['shot_2'],
      anchorShotId: 'shot_2',
    });
    expect(shotSelectionBytes()).toBe(preservedShotSelection);
    fireEvent.click(rowForBeat('empty'));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}')).toEqual({
      selectedBeatId: 'empty',
      selectedShotIds: ['shot_2'],
      anchorShotId: 'shot_2',
    });
    expect(shotSelectionBytes()).toBe(preservedShotSelection);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle presentation' }));
    expect(screen.getByTestId('alternate-presentation')).toHaveTextContent('empty');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle presentation' }));
    expect(rowForBeat('empty')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders one authored planning sum for a covered Beat even when render duration and target disagree', () => {
    const beats = [
      makeBeat('authored', {
        targetSeconds: 9,
        actualSeconds: 9.52,
        shots: [
          makeShot('shot_1', {
            durationSeconds: 6,
            planningBoundary: { shotId: 'shot_1', startSeconds: 0, endSeconds: 6 },
          }),
          makeShot('shot_2', {
            durationSeconds: 6,
            planningBoundary: { shotId: 'shot_2', startSeconds: 6, endSeconds: 12 },
          }),
          makeShot('shot_3', {
            durationSeconds: 5,
            planningBoundary: { shotId: 'shot_3', startSeconds: 12, endSeconds: 17 },
          }),
        ],
      }),
    ];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const length = cellAt(rowForBeat('authored'), 5);
    const facts = length.querySelectorAll<HTMLElement>('[data-duration-kind]');
    expect(facts).toHaveLength(1);
    const planned = facts[0];
    if (planned === undefined) throw new Error('Missing planned duration fact');
    expect(planned).toHaveAttribute('data-duration-kind', 'planned');
    expect(planned).toHaveTextContent('17s');
    expect(length).not.toHaveTextContent('~9s target');
  });

  it('keeps the authored sum when current takes and trims shorten rendered playback', () => {
    const authoredShots = [
      makeShot('shot_1', {
        durationSeconds: 6,
        planningBoundary: { shotId: 'shot_1', startSeconds: 0, endSeconds: 6 },
      }),
      makeShot('shot_2', {
        durationSeconds: 6,
        planningBoundary: { shotId: 'shot_2', startSeconds: 6, endSeconds: 12 },
      }),
      makeShot('shot_3', {
        durationSeconds: 5,
        planningBoundary: { shotId: 'shot_3', startSeconds: 12, endSeconds: 17 },
      }),
    ];
    const before = [makeBeat('trimmed', { actualSeconds: 17, shots: authoredShots })];
    const result = render(
      <TableView {...tableBoardProps(before)} beats={before} selectedBeatId={null} onSelectBeat={vi.fn()} />
    );
    expect(cellAt(rowForBeat('trimmed'), 5)).toHaveTextContent('17s');

    const after = [
      makeBeat('trimmed', {
        actualSeconds: 8,
        shots: authoredShots.map((shot, index) =>
          makeShot(shot.id, {
            ...shot,
            currentPicture: {
              assetId: `video_${String(index + 1)}`,
              sourceDurationSeconds: 6,
              posterAssetId: null,
              createdAt: '2026-08-28T00:00:00.000Z',
              prompt: 'Recorded prompt',
              promptChanged: false,
              firstFrameChanged: false,
            },
            trimInSeconds: 1,
            trimOutSeconds: index === 2 ? 4 : 3,
            playedDurationSeconds: index === 2 ? 3 : 2,
          })
        ),
      }),
    ];
    result.rerender(
      <TableView {...tableBoardProps(after)} beats={after} selectedBeatId={null} onSelectBeat={vi.fn()} />
    );
    const sum = cellAt(rowForBeat('trimmed'), 5);
    expect(sum).toHaveTextContent('17s');
    expect(sum).not.toHaveTextContent('8s');
  });

  it('shows exactly one coverage-appropriate duration fact and never invents zero seconds', () => {
    const beats = [
      makeBeat('duration_pending', {
        targetSeconds: null,
        actualSeconds: null,
        displayState: 'duration_pending',
        shots: [],
      }),
      makeBeat('no_coverage', {
        targetSeconds: 7,
        actualSeconds: null,
        displayState: 'no_coverage',
        shots: [],
      }),
      makeBeat('covered_pending', {
        targetSeconds: 7,
        actualSeconds: 23,
        shots: [makeShot('missing_boundary', { planningBoundary: null })],
      }),
      makeBeat('covered', { targetSeconds: 7, actualSeconds: 99 }),
      makeBeat('max_target', {
        targetSeconds: 1440,
        actualSeconds: null,
        displayState: 'no_coverage',
        shots: [],
      }),
    ];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const pending = cellAt(rowForBeat('duration_pending'), 5);
    const uncovered = cellAt(rowForBeat('no_coverage'), 5);
    const coveredPending = cellAt(rowForBeat('covered_pending'), 5);
    const covered = cellAt(rowForBeat('covered'), 5);
    const maxTarget = cellAt(rowForBeat('max_target'), 5);

    expect(pending).toHaveTextContent('No target');
    expect(pending.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(pending.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'target');
    expect(uncovered).toHaveTextContent('~7s target');
    expect(uncovered.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(uncovered.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'target');
    expect(coveredPending).toHaveTextContent('No planned sum');
    expect(coveredPending).not.toHaveTextContent('23s');
    expect(coveredPending).not.toHaveTextContent('0s');
    expect(coveredPending.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(coveredPending.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'planned');
    expect(covered).toHaveTextContent('4s');
    expect(covered).not.toHaveTextContent('99s');
    expect(covered).not.toHaveTextContent('~7s target');
    expect(covered.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(covered.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'planned');
    expect(maxTarget).toHaveTextContent('~1440s target');
    expect(maxTarget.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(maxTarget.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'target');
    for (const length of [pending, uncovered, coveredPending, covered, maxTarget]) {
      expect(length.textContent).not.toMatch(/^~?0s(?:\s|$)/);
    }
  });

  it.each([
    [
      'a mismatched Shot identity',
      [makeShot('wrong_id', { planningBoundary: { shotId: 'other', startSeconds: 0, endSeconds: 4 } })],
    ],
    [
      'a non-contiguous boundary sequence',
      [
        makeShot('first'),
        makeShot('second', { planningBoundary: { shotId: 'second', startSeconds: 5, endSeconds: 9 } }),
      ],
    ],
    [
      'a boundary whose span differs from the authored duration',
      [makeShot('wrong_span', { planningBoundary: { shotId: 'wrong_span', startSeconds: 0, endSeconds: 3 } })],
    ],
    [
      'a non-finite authored duration',
      [
        makeShot('non_finite', {
          durationSeconds: Number.POSITIVE_INFINITY,
          planningBoundary: { shotId: 'non_finite', startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY },
        }),
      ],
    ],
    [
      'a zero-length Shot',
      [
        makeShot('zero_length', {
          durationSeconds: 0,
          planningBoundary: { shotId: 'zero_length', startSeconds: 0, endSeconds: 0 },
        }),
      ],
    ],
    [
      'a fractional authored duration and boundary',
      [
        makeShot('fractional', {
          durationSeconds: 4.5,
          planningBoundary: { shotId: 'fractional', startSeconds: 0, endSeconds: 4.5 },
        }),
      ],
    ],
    [
      'an unsafe authored duration and boundary',
      [
        makeShot('unsafe_integer', {
          durationSeconds: Number.MAX_SAFE_INTEGER + 1,
          planningBoundary: { shotId: 'unsafe_integer', startSeconds: 0, endSeconds: Number.MAX_SAFE_INTEGER + 1 },
        }),
      ],
    ],
    [
      'a negative boundary',
      [makeShot('negative', { planningBoundary: { shotId: 'negative', startSeconds: -1, endSeconds: 3 } })],
    ],
  ] satisfies ReadonlyArray<readonly [string, WorkspaceShotProjection[]]>)(
    'fails closed instead of borrowing rendered seconds for %s',
    (_case, shots) => {
      const beats = [makeBeat('invalid_plan', { actualSeconds: 41, shots })];
      render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
      const sum = cellAt(rowForBeat('invalid_plan'), 5);
      expect(sum).toHaveTextContent('No planned sum');
      expect(sum).not.toHaveTextContent('41s');
      expect(sum).not.toHaveTextContent('0s');
      expect(sum.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'planned');
    }
  );

  it('names every Beat state in text rather than relying on color', () => {
    const states: Array<[WorkspaceBeatProjection['displayState'], string]> = [
      ['duration_pending', 'Duration pending'],
      ['no_coverage', 'No coverage'],
      ['seed_pending', 'First frame pending'],
      ['part_done', 'Part done'],
      ['needs_attention', 'Needs attention'],
      ['rendering', 'Rendering'],
      ['stale', 'Stale'],
      ['status_pending', 'Status pending'],
      ['ready', 'Ready'],
      ['draft', 'Draft'],
    ];
    const beats = states.map(([state]) => makeBeat(state, { displayState: state }));
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    for (const [state, label] of states) {
      const stateCell = cellAt(rowForBeat(state), 6);
      expect(stateCell).toHaveTextContent(label);
      expect(stateCell.querySelector('[data-state]')).toHaveAttribute('data-state', state);
      expect(tableCss).toContain(`.state[data-state='${state}']`);
    }
    expect(tableCss).toMatch(
      /\.state\[data-state='needs_attention'\]\s*\{[^}]*color:\s*var\(--color-danger-7\)[^}]*font-weight:\s*var\(--fw-bold\)/s
    );
    expect(tableCss).toMatch(/\.state\[data-state='stale'\][^{]*\{[^}]*color:\s*var\(--color-danger-6\)/s);
  });
});

describe('the Table layout contract', () => {
  it('keeps one seven-column grid and addresses columns semantically', () => {
    // The pane must never blow out horizontally, and the shrinking element that guarantees that is
    // the scroll container, not the table. The table itself holds a floor so columns keep readable
    // widths and overflow becomes a scrollbar rather than squeezed cells.
    expect(tableCss).toMatch(/\.scroll\s*{[^}]*min-inline-size:\s*0/s);
    expect(tableCss).toMatch(/\.scroll\s*{[^}]*overflow-x:\s*auto/s);
    expect(tableCss).toMatch(/\.grid\s*{[^}]*min-inline-size:\s*\d+px/s);
    expect(tableCss).not.toContain('nth-child');
    const durationRule = tableCss.match(/\.durationFact\s*{([^}]*)}/s)?.[1] ?? '';
    expect(durationRule).not.toContain('overflow: hidden');
    expect(durationRule).not.toContain('text-overflow: ellipsis');
    expect(tableCss).toMatch(
      /\.shotScript\s*{[^}]*display:\s*-webkit-box[^}]*overflow:\s*hidden[^}]*-webkit-box-orient:\s*vertical[^}]*-webkit-line-clamp:\s*2/s
    );
    expect(tableCss).toMatch(
      /\.shotRow\[data-shot-detail-open='true'\] \.shotScript\s*{[^}]*display:\s*block[^}]*overflow:\s*visible[^}]*-webkit-line-clamp:\s*unset/s
    );
    expect(tableCss).not.toContain('.detailPanels');
  });
});
