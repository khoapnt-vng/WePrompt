/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioRendererExportCatalogV2 } from '@/common/types/project/creativeStudioTypes';
import type {
  WorkspaceCutProjection,
  WorkspaceProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';
import {
  buildCutFilmSummary,
  formatCutClock,
} from '@/renderer/pages/studio/components/Workspace/Views/Cut/filmSummary';

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  icon?: React.ReactNode;
  loading?: boolean;
  size?: string;
  status?: string;
  type?: string;
};

type SelectProps = {
  allowClear?: boolean;
  'aria-label'?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  onChange?: (value: string | undefined) => void;
  placeholder?: React.ReactNode;
  value?: string;
};

type OptionProps = { children?: React.ReactNode; value: string };

const optionText = (value: React.ReactNode): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(optionText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(value)) return optionText(value.props.children);
  return '';
};

type PopconfirmProps = {
  cancelText: React.ReactNode;
  children: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>;
  content: React.ReactNode;
  disabled?: boolean;
  okText: React.ReactNode;
  onOk?: () => void | Promise<unknown>;
  title: React.ReactNode;
};

vi.mock('@icon-park/react', () => ({ ArrowDown: () => null, ArrowUp: () => null, Drag: () => null }));

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  const Button = ReactModule.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ children, icon, loading: _loading, size: _size, status: _status, type: _type, ...props }, ref) => (
      <button ref={ref} type='button' {...props}>
        {icon}
        {children}
      </button>
    )
  );
  const Option = ({ children, value }: OptionProps) => <option value={value}>{optionText(children)}</option>;
  // eslint-disable-next-line unicorn/consistent-function-scoping -- Vitest requires this component to stay inside the hoisted mock factory.
  const Select = ({ children, onChange, placeholder, value, ...props }: SelectProps) => (
    <select
      aria-label={props['aria-label']}
      disabled={props.disabled}
      onChange={(event) => onChange?.(event.target.value || undefined)}
      value={value ?? ''}
    >
      <option value=''>{placeholder}</option>
      {children}
    </select>
  );
  Object.assign(Select, { Option });
  const Popconfirm = ({ children, content, disabled, okText, onOk, title }: PopconfirmProps) => {
    const [open, setOpen] = ReactModule.useState(false);
    return (
      <>
        {ReactModule.cloneElement(children, {
          onClick: () => {
            if (!disabled) setOpen(true);
          },
        })}
        {open ? (
          <section aria-label={String(title)}>
            <p>{content}</p>
            <button
              onClick={() => {
                void Promise.resolve(onOk?.()).then(() => setOpen(false));
              }}
              type='button'
            >
              {okText}
            </button>
          </section>
        ) : null}
      </>
    );
  };
  return {
    Alert: ({ content }: { content: React.ReactNode }) => <div role='alert'>{content}</div>,
    Button,
    Drawer: ({
      children,
      footer,
      title,
      visible,
    }: {
      children: React.ReactNode;
      footer?: React.ReactNode;
      title: React.ReactNode;
      visible?: boolean;
    }) =>
      visible ? (
        <section aria-label={String(title)} role='dialog'>
          {children}
          {footer}
        </section>
      ) : null,
    Popconfirm,
    Select,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
  }),
}));

import { CutView, type CutActions } from '@/renderer/pages/studio/components/Workspace/Views/Cut';

const cut = (overrides: Partial<WorkspaceCutProjection> = {}): WorkspaceCutProjection => ({
  orderReady: true,
  beats: [
    {
      id: 'beat_1',
      title: 'Opening',
      shotCount: 1,
      durationKind: 'actual',
      durationSeconds: 7,
      coverAssetId: 'cover_1',
    },
    {
      id: 'beat_2',
      title: 'Close',
      shotCount: 0,
      durationKind: 'target',
      durationSeconds: 4,
      coverAssetId: null,
    },
  ],
  filmDurationSeconds: 11,
  audioImports: [
    {
      assetId: 'audio_current',
      position: 1,
      durationSeconds: 14,
      byteSize: 1400,
      createdAt: '2026-08-19T02:00:00.000Z',
    },
    {
      assetId: 'audio_old',
      position: 2,
      durationSeconds: 12,
      byteSize: 1200,
      createdAt: '2026-08-19T01:00:00.000Z',
    },
  ],
  bed: {
    status: 'ready',
    assetId: 'audio_current',
    sourceDurationSeconds: 14,
    fadeOutStartSeconds: 9,
    fadeOutEndSeconds: 11,
  },
  matchCandidates: [
    { shotId: 'shot_1', beatId: 'beat_1', beatTitle: 'Opening', line: 'Wide opening', coverAssetId: 'cover_1' },
    { shotId: 'shot_2', beatId: 'beat_1', beatTitle: 'Opening', line: 'Detail', coverAssetId: null },
  ],
  selectedMatchShotId: 'shot_1',
  matchSelectionInvalid: false,
  ...overrides,
});

const projection = (cutProjection = cut()): WorkspaceProjection =>
  ({
    projectId: 'project_1',
    projectRevision: 7,
    activeBeats: [],
    activeBeatIds: cutProjection.beats.map((beat) => beat.id),
    activeShotIds: cutProjection.matchCandidates.map((shot) => shot.shotId),
    coverageGapBeatIds: ['beat_2'],
    workspaceStatusReady: true,
    chainStatusReady: true,
    requestShapeLocked: false,
    cut: cutProjection,
    bin: { items: [], beats: [], shots: [], takes: [] },
    undoTop: null,
    dirtyShots: [],
    cascadeProgress: [],
    parkEligibility: [],
    conditioningFailures: [],
  }) as WorkspaceProjection;

const catalog = (): StudioRendererExportCatalogV2 => ({
  revision: 4,
  artifacts: [
    {
      id: 'export_1',
      sourceRevision: 6,
      shape: 'editor_folder',
      byteSize: 4096,
      fileCount: 4,
      createdAt: '2026-08-19T03:00:00.000Z',
    },
  ],
});

const actions = (): CutActions => ({
  reorderBeats: vi.fn().mockResolvedValue(true),
  importBedAudio: vi.fn().mockResolvedValue('cancelled'),
  setBed: vi.fn().mockResolvedValue(true),
  detachBedAudio: vi.fn().mockResolvedValue(true),
  setMatchTo: vi.fn().mockResolvedValue(true),
  createExport: vi.fn().mockResolvedValue(true),
  refreshExports: vi.fn().mockResolvedValue(true),
  copyExport: vi.fn().mockResolvedValue('copied'),
  revealExport: vi.fn().mockResolvedValue(true),
});

const renderCut = (
  input: {
    actions?: CutActions;
    cutProjection?: WorkspaceCutProjection;
    exportCatalog?: StudioRendererExportCatalogV2 | null;
    exportErrorMessageKey?: string | null;
    pending?: boolean;
  } = {}
) => {
  const cutActions = input.actions ?? actions();
  render(
    <CutView
      actions={cutActions}
      exportCatalog={input.exportCatalog === undefined ? catalog() : input.exportCatalog}
      exportErrorMessageKey={input.exportErrorMessageKey ?? null}
      pending={input.pending ?? false}
      projectId='project_1'
      projection={projection(input.cutProjection)}
    />
  );
  return cutActions;
};

describe('CutView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one film-level rail, honest bed and Match To copy, and exactly three export shapes', () => {
    renderCut();

    expect(screen.getByRole('region', { name: 'conversation.creativeStudio.workspace.cut.ariaLabel' })).toBeVisible();
    expect(screen.getByRole('list', { name: 'conversation.creativeStudio.workspace.cut.railLabel' })).toBeVisible();
    expect(document.querySelectorAll('[data-export-shape]')).toHaveLength(3);
    expect(document.querySelector('[data-export-shape="editor_folder"]')).not.toBeNull();
    expect(document.querySelector('[data-export-shape="still"]')).not.toBeNull();
    expect(document.querySelector('[data-export-shape="script"]')).not.toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('stitched');
    expect(document.body.textContent?.toLowerCase()).not.toContain('auto-duck');
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeVisible();
    expect(screen.queryByLabelText(/workspace\.cut\.openBeat/)).toBeNull();
  });

  it('reorders by keyboard and drag with exact canonical arrays, serialization, focus, and announcements', async () => {
    let finish!: (value: boolean) => void;
    const cutActions = actions();
    vi.mocked(cutActions.reorderBeats).mockReturnValueOnce(
      new Promise<boolean>((resolvePromise) => {
        finish = resolvePromise;
      })
    );
    renderCut({ actions: cutActions });
    const first = document.querySelector<HTMLElement>('[data-beat-id="beat_1"]')!;
    const handle = within(first).getByLabelText(/workspace\.cut\.dragHandle/);

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(cutActions.reorderBeats).toHaveBeenCalledTimes(1);
    expect(cutActions.reorderBeats).toHaveBeenCalledWith(['beat_2', 'beat_1']);
    finish(true);
    await waitFor(() => expect(handle).toHaveFocus());
    expect(screen.getByText(/workspace\.cut\.reorderAnnouncement/)).toBeInTheDocument();

    const dataTransfer = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(document.querySelector('[data-beat-id="beat_2"]')!, { dataTransfer });
    fireEvent.drop(document.querySelector('[data-beat-id="beat_2"]')!, { dataTransfer });
    await waitFor(() => expect(cutActions.reorderBeats).toHaveBeenCalledTimes(2));
  });

  it('routes bed and Match To selection through exact values and keeps import cancellation inert', async () => {
    const cutActions = renderCut();
    const bed = screen.getByLabelText('conversation.creativeStudio.workspace.cut.bed.label');
    const match = screen.getByLabelText('conversation.creativeStudio.workspace.cut.match.label');

    fireEvent.change(bed, { target: { value: 'audio_old' } });
    await waitFor(() => expect(cutActions.setBed).toHaveBeenCalledWith('audio_old'));
    fireEvent.change(bed, { target: { value: '' } });
    await waitFor(() => expect(cutActions.setBed).toHaveBeenCalledWith(null));
    fireEvent.change(match, { target: { value: 'shot_2' } });
    await waitFor(() => expect(cutActions.setMatchTo).toHaveBeenCalledWith('shot_2'));
    fireEvent.change(match, { target: { value: '' } });
    await waitFor(() => expect(cutActions.setMatchTo).toHaveBeenCalledWith(null));

    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.cut.bed.import'));
    await waitFor(() => expect(cutActions.importBedAudio).toHaveBeenCalledTimes(1));
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.bed.importCancelled')).toBeInTheDocument();
  });

  it('announces success, refusal, cancellation, and provider failure across film-level actions', async () => {
    const cutActions = actions();
    vi.mocked(cutActions.importBedAudio).mockResolvedValueOnce('imported').mockRejectedValueOnce(new Error('closed'));
    vi.mocked(cutActions.setBed).mockResolvedValueOnce(false);
    vi.mocked(cutActions.setMatchTo).mockResolvedValueOnce(false);
    vi.mocked(cutActions.refreshExports).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.mocked(cutActions.createExport).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(cutActions.copyExport).mockResolvedValueOnce('cancelled').mockRejectedValueOnce(new Error('closed'));
    vi.mocked(cutActions.revealExport).mockResolvedValueOnce(false);
    vi.mocked(cutActions.detachBedAudio).mockResolvedValueOnce(false);
    renderCut({ actions: cutActions });

    const importButton = screen.getByText('conversation.creativeStudio.workspace.cut.bed.import');
    fireEvent.click(importButton);
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.bed.imported')).toBeVisible()
    );
    fireEvent.click(importButton);
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.bed.importFailed')).toBeVisible()
    );

    const bed = screen.getByLabelText('conversation.creativeStudio.workspace.cut.bed.label');
    fireEvent.change(bed, { target: { value: 'audio_old' } });
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.bed.setFailed')).toBeVisible()
    );
    fireEvent.change(bed, { target: { value: 'audio_current' } });
    expect(cutActions.setBed).toHaveBeenCalledTimes(1);

    const match = screen.getByLabelText('conversation.creativeStudio.workspace.cut.match.label');
    fireEvent.change(match, { target: { value: 'shot_2' } });
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.match.setFailed')).toBeVisible()
    );
    fireEvent.change(match, { target: { value: 'shot_1' } });
    expect(cutActions.setMatchTo).toHaveBeenCalledTimes(1);

    const refresh = screen.getByText('conversation.creativeStudio.workspace.cut.exports.refresh');
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.exports.refreshFailed')).toBeVisible()
    );
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.exports.refreshed')).toBeVisible()
    );

    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.cut.exports.createEditorFolder'));
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.exports.created')).toBeVisible()
    );
    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.cut.exports.createScript'));
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.cut.exports.createFailed')).toBeVisible()
    );
    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.cut.exports.createStill'));
    await waitFor(() => expect(cutActions.createExport).toHaveBeenLastCalledWith({ shape: 'still', shotId: 'shot_1' }));

    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.assets.show'));
    const drawer = screen.getByRole('dialog', { name: 'conversation.creativeStudio.workspace.assets.title' });
    fireEvent.click(within(drawer).getByText('conversation.creativeStudio.workspace.assets.copy'));
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.assets.copyCancelled')).toBeVisible()
    );
    fireEvent.click(within(drawer).getByText('conversation.creativeStudio.workspace.assets.copy'));
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.assets.copyFailed')).toBeVisible()
    );
    fireEvent.click(within(drawer).getByText('conversation.creativeStudio.workspace.assets.reveal'));
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.assets.revealFailed')).toBeVisible()
    );

    const oldAudio = drawer.querySelector('[data-audio-position="2"]')!;
    fireEvent.click(within(oldAudio).getByText('conversation.creativeStudio.workspace.assets.detach'));
    const confirmation = screen.getByLabelText('conversation.creativeStudio.workspace.assets.detachTitle');
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'conversation.creativeStudio.workspace.assets.detach' })
    );
    await waitFor(() =>
      expect(screen.getByText('conversation.creativeStudio.workspace.assets.detachFailed')).toBeVisible()
    );
  });

  it.each([
    [
      { status: 'duration_pending', assetId: 'audio_current', sourceDurationSeconds: 14 },
      'conversation.creativeStudio.workspace.cut.bed.durationPending',
    ],
    [
      { status: 'too_short', assetId: 'audio_current', sourceDurationSeconds: 8, requiredDurationSeconds: 11 },
      'conversation.creativeStudio.workspace.cut.bed.tooShort',
    ],
    [{ status: 'none', assetId: null }, 'conversation.creativeStudio.workspace.cut.bed.empty'],
  ] as const)('renders each honest bed state %#', (bed, messageKey) => {
    renderCut({ cutProjection: cut({ bed: bed as WorkspaceCutProjection['bed'] }) });
    expect(screen.getByText(new RegExp(messageKey))).toBeVisible();
  });

  it('renders pending and empty authority without inventing Beat, audio, still, or export facts', () => {
    renderCut({
      cutProjection: cut({
        beats: [],
        filmDurationSeconds: null,
        audioImports: [],
        bed: { status: 'none', assetId: null },
        matchCandidates: [],
        selectedMatchShotId: null,
      }),
      exportErrorMessageKey: 'conversation.creativeStudio.workspace.errors.storage',
    });

    expect(screen.getByText('conversation.creativeStudio.workspace.cut.empty')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.durationPending')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.errors.storage')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.exports.createStill')).toBeDisabled();
    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.assets.show'));
    const drawer = screen.getByRole('dialog', { name: 'conversation.creativeStudio.workspace.assets.title' });
    expect(within(drawer).getByText('conversation.creativeStudio.workspace.assets.audioEmpty')).toBeVisible();
    fireEvent.click(within(drawer).getByText('conversation.creativeStudio.workspace.assets.close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the selected bed attached and exposes only sanitized export actions in Assets', async () => {
    const cutActions = renderCut();
    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.assets.show'));
    const drawer = screen.getByRole('dialog', { name: 'conversation.creativeStudio.workspace.assets.title' });
    expect(within(drawer).getByText(/workspace\.assets\.audioItem.*"position":1/)).toBeVisible();
    expect(drawer.textContent).not.toContain('audio_current');
    expect(drawer.textContent).not.toContain('audio_old');
    expect(within(drawer).getByText(/4096/)).toBeVisible();
    expect(drawer.textContent).not.toContain('manifestSha256');
    expect(drawer.textContent).not.toContain('/exports/');

    const current = drawer.querySelector('[data-audio-position="1"]')!;
    expect(within(current).getByText('conversation.creativeStudio.workspace.assets.detach')).toBeDisabled();
    const old = drawer.querySelector('[data-audio-position="2"]')!;
    fireEvent.click(within(old).getByText('conversation.creativeStudio.workspace.assets.detach'));
    const confirmation = screen.getByLabelText('conversation.creativeStudio.workspace.assets.detachTitle');
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'conversation.creativeStudio.workspace.assets.detach' })
    );
    await waitFor(() => expect(cutActions.detachBedAudio).toHaveBeenCalledWith('audio_old'));

    fireEvent.click(within(drawer).getByText('conversation.creativeStudio.workspace.assets.copy'));
    await waitFor(() => expect(cutActions.copyExport).toHaveBeenCalledWith('export_1'));
    fireEvent.click(within(drawer).getByText('conversation.creativeStudio.workspace.assets.reveal'));
    await waitFor(() => expect(cutActions.revealExport).toHaveBeenCalledWith('export_1'));
  });

  it('fails closed for malformed order, missing catalog authority, and invalid current selections', () => {
    renderCut({
      cutProjection: cut({
        orderReady: false,
        filmDurationSeconds: null,
        bed: { status: 'invalid', assetId: 'missing_audio' },
        selectedMatchShotId: null,
        matchSelectionInvalid: true,
      }),
      exportCatalog: null,
    });

    expect(screen.getByText('conversation.creativeStudio.workspace.cut.orderUnavailable')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.bed.invalid')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.match.invalid')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.exports.catalogUnavailable')).toBeVisible();
    document.querySelectorAll('[data-export-shape] button').forEach((button) => expect(button).toBeDisabled());
  });

  it('keeps the implementation semantic, Arco-owned, logical, container-responsive, and RTL-neutral', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/index.tsx'),
      'utf8'
    );
    const css = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/Cut.module.css'
      ),
      'utf8'
    );

    expect(source).not.toMatch(/<(?:button|select|input|audio)\b/);
    expect(source).not.toMatch(/\bcontrols\s*=/);
    expect(source).not.toContain('onOpenBeat');
    expect(source).not.toContain('.openBeat');
    expect(source).toContain("dir='auto'");
    expect(source).toContain('<bdi>');
    expect(css).toContain('@container');
    expect(css).toContain('min-inline-size');
    expect(css).not.toMatch(/(?:margin|padding|border|inset)-(?:left|right)\b/);
    expect(css).not.toMatch(/text-align:\s*(?:left|right)/);
  });
});

describe('the film summary', () => {
  const beat = (shotCount: number, durationSeconds: number | null): WorkspaceCutProjection['beats'][number] => ({
    id: `beat_${shotCount}_${String(durationSeconds)}`,
    title: 'Beat',
    shotCount,
    durationKind: shotCount > 0 ? 'actual' : durationSeconds === null ? 'pending' : 'target',
    durationSeconds,
    coverAssetId: null,
  });

  it('counts the film against its target and treats an uncovered Beat as a slate', () => {
    const summary = buildCutFilmSummary({
      beats: [beat(2, 14), beat(3, 22), beat(0, 24)],
      filmDurationSeconds: 60,
      targetDurationSeconds: 62,
    });

    expect(summary).toEqual({
      filmSeconds: 60,
      targetSeconds: 62,
      delta: { kind: 'under', seconds: 2 },
      beatCount: 3,
      shotCount: 5,
      slateCount: 1,
    });
  });

  it('reports a film that runs past its target', () => {
    const summary = buildCutFilmSummary({ beats: [beat(1, 20)], filmDurationSeconds: 25, targetDurationSeconds: 18 });
    expect(summary.delta).toEqual({ kind: 'over', seconds: 7 });
  });

  it('reports a film that lands exactly on its target', () => {
    const summary = buildCutFilmSummary({ beats: [beat(1, 18)], filmDurationSeconds: 18, targetDurationSeconds: 18 });
    expect(summary.delta).toEqual({ kind: 'on_target', seconds: 0 });
  });

  it('fails the delta closed when either side of the comparison is unknown', () => {
    // The delta is the render gate's headline. An unknown film length must read as "no answer",
    // never as "on target", which is what a 0 default would show.
    expect(buildCutFilmSummary({ beats: [], filmDurationSeconds: null, targetDurationSeconds: 62 }).delta).toBeNull();
    expect(buildCutFilmSummary({ beats: [], filmDurationSeconds: 60, targetDurationSeconds: null }).delta).toBeNull();
  });

  it('does not count a Beat with no coverage and no duration as a slate', () => {
    // A pending Beat has no length to export, so it is not yet a slate.
    expect(
      buildCutFilmSummary({ beats: [beat(0, null)], filmDurationSeconds: null, targetDurationSeconds: 62 }).slateCount
    ).toBe(0);
  });

  it('formats the clock as minutes and padded seconds', () => {
    expect(formatCutClock(178)).toBe('2:58');
    expect(formatCutClock(180)).toBe('3:00');
    expect(formatCutClock(0)).toBe('0:00');
    expect(formatCutClock(9)).toBe('0:09');
    expect(formatCutClock(null)).toBeNull();
  });
});
