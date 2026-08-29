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
        'conversation.creativeStudio.workspace.table.reorder.failed': 'Beat order was not changed.',
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
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.characters': 'Characters',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.background': 'Background',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.shot': `Shot ${String(values?.position)}`,
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.none': 'None',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.save': 'Save references',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.unassigned':
          'Choose the exact references for this Shot.',
        'conversation.creativeStudio.workspace.referenceWorkflow.bindings.invalid':
          'This Shot binding is no longer valid. Review and save it again.',
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
      if (key === 'conversation.creativeStudio.workspace.table.reorder.label') {
        return `Reorder ${String(values?.title)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.reorder.dragHandle') {
        return `Reorder ${String(values?.title)} at position ${String(values?.position)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.reorder.moveEarlier') {
        return `Move ${String(values?.title)} earlier`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.reorder.moveLater') {
        return `Move ${String(values?.title)} later`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.reorder.announcement') {
        return `Moved ${String(values?.title)} from ${String(values?.from)} to ${String(values?.to)} of ${String(values?.total)}.`;
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
      if (key === 'conversation.creativeStudio.workspace.table.shotCount') {
        const count = Number(values?.count ?? 0);
        return `${count} ${count === 1 ? 'shot' : 'shots'}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.shotPosition') {
        return `${String(values?.beat)}.${String(values?.shot)}`;
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
  latestVideoAttemptFailed: false,
  hasEffectiveSeed: false,
  ...overrides,
});

const makeBeat = (id: string, overrides: Partial<WorkspaceBeatProjection> = {}): WorkspaceBeatProjection => {
  const shots = overrides.shots ?? [makeShot(`${id}_shot`)];
  return {
    id,
    title: `Beat ${id}`,
    story: `Story ${id}`,
    targetSeconds: 8,
    sumSeconds: shots.length === 0 ? null : shots.reduce((total, shot) => total + shot.durationSeconds, 0),
    actualSeconds: 8,
    displayState: 'ready',
    shots,
    ...overrides,
  };
};

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

const makeBindingActions = (): TableReferenceBindingActions => ({
  saveBinding: vi.fn(async () => true),
});

const makeAuthoringActions = (): TableAuthoringActions => ({
  addBeat: vi.fn(async () => true),
  addShot: vi.fn(async () => true),
  askDirector: vi.fn(),
  reorderBeats: vi.fn(async () => true),
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
  authoringActions: makeAuthoringActions(),
  projectId: 'project_1',
  coverageGapBeatIds: beats.filter((beat) => beat.shots.length === 0).map((beat) => beat.id),
  unscriptedShotIds: beats.flatMap((beat) =>
    beat.shots.filter((shot) => shot.shootingScript.trim() === '').map((shot) => shot.id)
  ),
  boardPanels: beats.flatMap((beat) => beat.shots.map((shot) => makeBoardPanel(shot.id))),
  references: [] as readonly ReferenceWorkspaceItem[],
  referenceBindings: beats.flatMap((beat) => beat.shots.map((shot) => makeBinding({ shotId: shot.id }))),
  referenceMaxConditioningImages: 3,
  referencePendingId: null,
  bindingActions: makeBindingActions(),
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

  it('renders the six planning columns and one semantic data row per Beat in film order', () => {
    const beats = [
      makeBeat('opening', { title: 'Opening', story: '', shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('close', { title: 'Close' }),
    ];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const rows = within(grid).getAllByRole('row');
    expect(grid).toHaveAttribute('aria-colcount', '6');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['#', 'Panel', 'Beat', 'Story', 'Shots', 'Sum']);
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.dataset.gridColumnName)
    ).toEqual(['position', 'panel', 'beat', 'story', 'shots', 'length']);
    expect(rows.slice(1).map((row) => cellAt(row, 2).textContent)).toEqual(['Opening', 'Close']);
    expect(rows.slice(1).every((row) => within(row).getAllByRole('gridcell').length === 6)).toBe(true);
    expect(grid.querySelector('[data-grid-column-name="state"]')).toBeNull();
    expect(grid.querySelector('[data-state]')).toBeNull();
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
    expect(openingRows.every((shot) => within(shot).queryByRole('toolbar') === null)).toBe(true);
    expect(openingRows.map((shot) => shot.getAttribute('aria-rowindex'))).toEqual(['3', '4', '5', '6', '7', '8']);
    expect(openingRows.every((shot) => within(shot).getAllByRole('gridcell').length === 6)).toBe(true);
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
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
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

  it('renders one six-cell row per Shot with script, chain position, duration, and fullscreen access', async () => {
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
    expect(shotRows.every((shot) => within(shot).getAllByRole('gridcell').length === 6)).toBe(true);
    expect(screen.getAllByText('Chain head')).toHaveLength(2);
    expect(rowForShot('shot_1').querySelector('[data-chain-position="head"]')).toHaveTextContent('Chain head');
    expect(rowForShot('shot_1')).toHaveTextContent('Ming enters the market.');
    expect(rowForShot('shot_2')).toHaveTextContent('Mei turns toward Ming.');
    expect(rowForShot('shot_2').querySelector('[data-chain-position="predecessor:1"]')).toHaveTextContent('← Shot 1');
    expect(rowForShot('shot_2')).toHaveTextContent('6s');
    expect(screen.getByRole('row', { name: 'Shot 2: Stale' }).querySelector('[data-activity="idle"]')).toHaveAttribute(
      'data-freshness',
      'stale'
    );
    expect(
      screen.getByRole('row', { name: 'Shot 3: Drawing' }).querySelector('[data-activity="drawing"]')
    ).not.toBeNull();
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

  it('keeps exact Board-panel monitoring but exposes no Board spend or recovery controls', async () => {
    const user = userEvent.setup();
    const beat = makeBeat('opening', { title: 'Opening' });
    const panel = makeBoardPanel('opening_shot', {
      activity: 'needs_attention',
      latestJobId: 'job_attention',
      recovery: {
        jobId: 'job_attention',
        canRetry: true,
        canCancel: true,
        canRetryDownload: false,
        submissionUnknown: false,
      },
    });
    const result = render(
      <TableView
        {...tableBoardProps([beat])}
        beats={[beat]}
        boardPanels={[panel]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    const shotRow = rowForShot('opening_shot');
    expect(shotRow).toHaveAccessibleName('Shot 1: Needs attention');
    expect(shotRow.querySelector('[data-activity="needs_attention"]')).not.toBeNull();
    expect(result.container.querySelector('[data-reference-binding-progress]')).toHaveTextContent('0 of 1 Shots bound');
    expect(result.container.querySelector('[data-board-recovery-job-id]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Director Board controls' })).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Board completeness' })).toBeNull();
    expect(screen.queryByRole('button', { name: /draw|redraw|retry|cancel job|stop drawing|first frame/i })).toBeNull();

    await user.click(within(shotRow).getByRole('button', { name: /Expand/ }));
    expect(within(shotRow).getByRole('button', { name: 'Save references' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /draw|redraw|retry|cancel job|stop drawing|first frame/i })).toBeNull();
  });

  it('fails closed instead of cross-associating reordered Board panel status', async () => {
    const user = userEvent.setup();
    const beat = makeBeat('opening', {
      title: 'Opening',
      shots: [makeShot('shot_1'), makeShot('shot_2')],
    });
    const result = render(
      <TableView
        {...tableBoardProps([beat])}
        beats={[beat]}
        boardPanels={[
          makeBoardPanel('shot_2', { assetId: 'panel_2', freshness: 'current' }),
          makeBoardPanel('shot_1', {
            activity: 'needs_attention',
            latestJobId: 'job_wrong',
            recovery: {
              jobId: 'job_wrong',
              canRetry: true,
              canCancel: true,
              canRetryDownload: false,
              submissionUnknown: false,
            },
          }),
        ]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    expect(
      result.container.querySelectorAll('[role="row"][data-shot-id] [data-activity="status_pending"]')
    ).toHaveLength(2);
    expect(screen.getByRole('row', { name: 'Shot 1: Status pending' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Shot 2: Status pending' })).toBeInTheDocument();
    expect(result.container.querySelector('[data-asset-id]')).toBeNull();
    expect(result.container.querySelector('[data-board-recovery-job-id]')).toBeNull();
  });

  it('owns exact whole-order Beat reordering from the position cell, with focus and announcements', async () => {
    const authoringActions = makeAuthoringActions();
    const beats = [makeBeat('a'), makeBeat('b'), makeBeat('c')];
    const result = render(
      <TableView
        {...tableBoardProps(beats)}
        authoringActions={authoringActions}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const firstPositionCell = cellAt(rowForBeat('a'), 0);
    act(() => firstPositionCell.focus());
    fireEvent.keyDown(firstPositionCell, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(authoringActions.reorderBeats).toHaveBeenLastCalledWith(['b', 'a', 'c']));
    expect(result.container.querySelector('[aria-live="polite"]')).toHaveTextContent('Moved Beat a from 1 to 2 of 3.');

    // Focus must NOT jump to the destination index while the old order is still rendered.
    expect(cellAt(rowForBeat('b'), 0)).not.toHaveFocus();

    const lastPositionCell = cellAt(rowForBeat('c'), 0);
    act(() => lastPositionCell.focus());
    fireEvent.keyDown(lastPositionCell, { key: 'Home', altKey: true });
    await waitFor(() => expect(authoringActions.reorderBeats).toHaveBeenLastCalledWith(['c', 'a', 'b']));

    fireEvent.keyDown(firstPositionCell, { key: 'End', altKey: true });
    await waitFor(() => expect(authoringActions.reorderBeats).toHaveBeenLastCalledWith(['b', 'c', 'a']));

    // Reordering is whole-order and applied by the owner, so the rendered order is unchanged here.
    expect(
      Array.from(screen.getByRole('grid').querySelectorAll('[data-beat-id]')).map((row) =>
        row.getAttribute('data-beat-id')
      )
    ).toEqual(['a', 'b', 'c']);
  });

  it('distinguishes a Shot row from a Beat row by indent and by number', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('multi', { title: 'Opening', shots: [makeShot('shot_1'), makeShot('shot_2')] })];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    // Shot sub-rows exist only while the Beat is expanded; that is where the two levels collide.
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    // BUG-173: Beats number 01, 02 and Shots restarted at 01, 02 at the same left edge, so an
    // expanded table showed two different 01s with nothing but the text to tell them apart.
    expect(screen.getByText('01')).toBeVisible();
    expect(screen.getByText('1.1')).toBeVisible();
    expect(screen.getByText('1.2')).toBeVisible();

    expect(tableCss).toMatch(/\.shotRow \.shotCell\[data-grid-column='0'\]\s*\{[^}]*padding-inline-start:\s*32px/s);
  });

  it('moves focus with the Beat once the new order arrives, not to the destination index', async () => {
    /*
     * The owner applies the whole order, so the rendered order changes on a later render. Focusing
     * cellRefs[destination] inside the reorder's `finally` ran before that flush and landed on
     * whichever Beat still occupied the row, then travelled with it to the wrong place.
     */
    const authoringActions = makeAuthoringActions();
    const beats = [makeBeat('a'), makeBeat('b'), makeBeat('c')];
    const props = { authoringActions, selectedBeatId: null, onSelectBeat: vi.fn() };
    const result = render(<TableView {...tableBoardProps(beats)} {...props} beats={beats} />);

    const cell = cellAt(rowForBeat('a'), 0);
    act(() => cell.focus());
    fireEvent.keyDown(cell, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(authoringActions.reorderBeats).toHaveBeenLastCalledWith(['b', 'a', 'c']));
    expect(cellAt(rowForBeat('b'), 0)).not.toHaveFocus();

    const reordered = [beats[1]!, beats[0]!, beats[2]!];
    result.rerender(<TableView {...tableBoardProps(reordered)} {...props} beats={reordered} />);
    await waitFor(() => expect(cellAt(rowForBeat('a'), 0)).toHaveFocus());
  });

  it('carries no per-row move controls, so the position column is the position', () => {
    const beats = [makeBeat('first', { title: 'Repeat' }), makeBeat('second', { title: 'Repeat' })];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    // BUG-174: 28 move buttons on a six-Beat project occupied the Table's scarcest column.
    expect(screen.queryAllByRole('button', { name: /(?:move|reorder) /i })).toEqual([]);
    expect(screen.queryAllByRole('group', { name: /reorder/i })).toEqual([]);
  });

  it('announces the localized untitled Beat fallback after a reorder', async () => {
    const authoringActions = makeAuthoringActions();
    const beats = [makeBeat('blank', { title: '   ' }), makeBeat('named')];
    const result = render(
      <TableView
        {...tableBoardProps(beats)}
        authoringActions={authoringActions}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const blankPositionCell = cellAt(rowForBeat('blank'), 0);
    act(() => blankPositionCell.focus());
    fireEvent.keyDown(blankPositionCell, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(authoringActions.reorderBeats).toHaveBeenCalledWith(['named', 'blank']));
    expect(result.container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moved Untitled Beat 1 from 1 to 2 of 2.'
    );
  });

  it('keeps Table reordering single-flight, fails closed, and locks with workspace authority', async () => {
    let finish!: (value: boolean) => void;
    const authoringActions = makeAuthoringActions();
    vi.mocked(authoringActions.reorderBeats).mockReturnValueOnce(
      new Promise<boolean>((resolvePromise) => {
        finish = resolvePromise;
      })
    );
    const beats = [makeBeat('a'), makeBeat('b')];
    const result = render(
      <TableView
        {...tableBoardProps(beats)}
        authoringActions={authoringActions}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const positionCell = cellAt(rowForBeat('a'), 0);
    act(() => positionCell.focus());
    fireEvent.keyDown(positionCell, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(positionCell, { key: 'ArrowDown', altKey: true });
    // Single-flight: the second press while one is in flight must not reach the owner.
    expect(authoringActions.reorderBeats).toHaveBeenCalledTimes(1);

    finish(false);
    await waitFor(() =>
      expect(result.container.querySelector('[aria-live="polite"]')).toHaveTextContent('Beat order was not changed.')
    );
    const firstFailureAnnouncement = result.container.querySelector('[aria-live="polite"]')?.firstElementChild;

    vi.mocked(authoringActions.reorderBeats).mockResolvedValueOnce(false);
    act(() => cellAt(rowForBeat('a'), 0).focus());
    fireEvent.keyDown(cellAt(rowForBeat('a'), 0), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(authoringActions.reorderBeats).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.container.querySelector('[aria-live="polite"]')?.firstElementChild).not.toBe(
        firstFailureAnnouncement
      )
    );
    expect(result.container.querySelector('[aria-live="polite"]')).toHaveTextContent('Beat order was not changed.');

    result.rerender(
      <TableView
        {...tableBoardProps(beats)}
        authoringActions={authoringActions}
        beats={beats}
        gateLocked
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    // Workspace authority locks reordering: the surviving route must fail closed too.
    const callsBeforeLock = vi.mocked(authoringActions.reorderBeats).mock.calls.length;
    act(() => cellAt(rowForBeat('a'), 0).focus());
    fireEvent.keyDown(cellAt(rowForBeat('a'), 0), { key: 'ArrowDown', altKey: true });
    expect(authoringActions.reorderBeats).toHaveBeenCalledTimes(callsBeforeLock);
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
    expect(cellAt(rows[0]!, 5)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cellAt(rows[0]!, 5)).toHaveFocus();
    fireEvent.keyDown(cellAt(rows[0]!, 5), { key: 'End', ctrlKey: true });
    expect(cellAt(rows[1]!, 5)).toHaveFocus();
    fireEvent.keyDown(cellAt(rows[1]!, 5), { key: 'Home', metaKey: true });
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
    fireEvent.click(within(multi).getByText('01'));
    expect(onOpenBeat).toHaveBeenLastCalledWith('multi');
    expect(onOpenBeat).toHaveBeenCalledTimes(1);

    act(() => cellAt(multi, 3).focus());
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

  it('renders Main-supplied Beat sum authority without recomputing Shot facts in Table', () => {
    const beats = [
      makeBeat('sum_authority', {
        sumSeconds: 11,
        shots: [
          makeShot('authority_shot', {
            durationSeconds: 4,
            planningBoundary: { shotId: 'authority_shot', startSeconds: 0, endSeconds: 4 },
          }),
        ],
      }),
    ];

    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const sum = cellAt(rowForBeat('sum_authority'), 5);
    expect(sum).toHaveTextContent('11s');
    expect(sum).not.toHaveTextContent('4s');
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
        sumSeconds: 99,
        actualSeconds: null,
        displayState: 'no_coverage',
        shots: [],
      }),
      makeBeat('covered_pending', {
        targetSeconds: 7,
        sumSeconds: null,
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

    expect(pending).toHaveTextContent('No planned sum');
    expect(pending.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(pending.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'planned');
    expect(uncovered).toHaveTextContent('No planned sum');
    expect(uncovered).not.toHaveTextContent('99s');
    expect(uncovered.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(uncovered.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'planned');
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
    expect(maxTarget).toHaveTextContent('No planned sum');
    expect(maxTarget.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(maxTarget.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'planned');
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
      const beats = [makeBeat('invalid_plan', { sumSeconds: null, actualSeconds: 41, shots })];
      render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
      const sum = cellAt(rowForBeat('invalid_plan'), 5);
      expect(sum).toHaveTextContent('No planned sum');
      expect(sum).not.toHaveTextContent('41s');
      expect(sum).not.toHaveTextContent('0s');
      expect(sum.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'planned');
    }
  );
});

describe('the Table layout contract', () => {
  it('keeps one six-column grid and addresses columns semantically', () => {
    // The pane must never blow out horizontally, and the shrinking element that guarantees that is
    // the scroll container, not the table. The table itself holds a floor so columns keep readable
    // widths and overflow becomes a scrollbar rather than squeezed cells.
    expect(tableCss).toMatch(/\.scroll\s*{[^}]*min-inline-size:\s*0/s);
    expect(tableCss).toMatch(/\.scroll\s*{[^}]*overflow-x:\s*auto/s);
    expect(tableCss).toMatch(/\.grid\s*{[^}]*min-inline-size:\s*944px/s);
    expect(tableCss).not.toContain('.state');
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
