/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioRendererExportCatalogV2 } from '@/common/types/project/creativeStudioTypes';
import type {
  WorkspaceBeatProjection,
  WorkspaceCutProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
  WorkspaceTakeProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';
import {
  buildCutFilmSummary,
  buildCutSlateWarnings,
  formatCutClock,
} from '@/renderer/pages/studio/components/Workspace/Views/Cut/filmSummary';
import { buildCutFilmstrip } from '@/renderer/pages/studio/components/Workspace/Views/Cut/filmstrip';
import {
  buildCutPlaybackSequence,
  cutPlaybackShotsAwaitingTake,
  formatCutPlaybackClock,
  type CutPlaybackSequence,
} from '@/renderer/pages/studio/components/Workspace/Views/Cut/playbackSequence';

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

type SliderProps = {
  'data-cut-seek'?: boolean;
  disabled?: boolean;
  max?: number;
  min?: number;
  onChange?: (value: number) => void;
  step?: number;
  value?: number;
};

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
  // eslint-disable-next-line unicorn/consistent-function-scoping -- Vitest requires this component to stay inside the hoisted mock factory.
  const Slider = ReactModule.forwardRef<HTMLDivElement, SliderProps>(({ onChange, ...props }, ref) => (
    <div ref={ref} data-cut-seek={props['data-cut-seek']}>
      <input
        disabled={props.disabled}
        max={props.max}
        min={props.min}
        onChange={(event) => onChange?.(Number(event.target.value))}
        role='slider'
        step={props.step}
        type='range'
        value={props.value}
      />
    </div>
  ));
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
    Slider,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key.endsWith('.film.beatCount_one')) return `${values?.count} Beat`;
      if (key.endsWith('.film.beatCount_other')) return `${values?.count} Beats`;
      if (key.endsWith('.shotCount_one')) return `${values?.count} Shot`;
      if (key.endsWith('.shotCount_other')) return `${values?.count} Shots`;
      if (key.endsWith('.film.slateCount_one')) return `${values?.count} Slate`;
      if (key.endsWith('.film.slateCount_other')) return `${values?.count} Slates`;
      if (key.endsWith('.film.counts')) return `${values?.beats} · ${values?.shots} · ${values?.slates}`;
      if (key.endsWith('.film.title')) return 'The film';
      if (key.endsWith('.film.under')) return `${String(values?.clock)} under`;
      if (key.endsWith('.film.over')) return `${String(values?.clock)} over`;
      if (key.endsWith('.filmstripDuration')) return `${values?.seconds}s`;
      if (key.endsWith('.preview.play')) return 'Play film';
      if (key.endsWith('.preview.pause')) return 'Pause film';
      if (key.endsWith('.preview.controlsLabel')) return 'Film transport';
      if (key.endsWith('.preview.position')) return `${String(values?.current)} / ${String(values?.total)}`;
      if (key.endsWith('.preview.pictureOnly')) return 'Picture only — the bed is muted here';
      if (key.endsWith('.preview.noMedia')) return 'No film preview is available.';
      if (key.endsWith('.preview.awaitingTakeOne')) {
        return `Beat ${String(values?.beatPosition)} · Shot ${String(values?.shotPosition)} needs a Take chosen before the film can play.`;
      }
      if (key.endsWith('.preview.awaitingTakeMany')) {
        return `${String(values?.count)} Shots need a Take chosen before the film can play.`;
      }
      if (key.endsWith('.preview.mediaError')) return 'This preview could not be loaded.';
      if (key.endsWith('.preview.label')) return 'Film preview';
      if (key.endsWith('.preview.beatBadge')) {
        return `Beat ${String(values?.position)} · ${String(values?.title)}`;
      }
      if (key.endsWith('.preview.videoLabel')) {
        return `Beat ${String(values?.beatPosition)} · ${String(values?.beatTitle)} · Shot ${String(
          values?.shotPosition
        )} · ${String(values?.shotTitle)}`;
      }
      if (key.endsWith('.preview.slateLabel')) {
        return `Beat ${String(values?.beatPosition)} · ${String(values?.beatTitle)} · Slate · No coverage`;
      }
      if (key.endsWith('.preview.slate')) return 'Slate · No coverage';
      if (key.endsWith('.preview.slateHold')) return `Holds ${String(values?.clock)} in the Cut`;
      if (key.endsWith('.preview.seekLabel')) return 'Film seek rail';
      if (key.endsWith('.preview.previousJoin')) return 'Previous join';
      if (key.endsWith('.preview.nextJoin')) return 'Next join';
      if (key.endsWith('.preview.loopJoin')) return 'Loop join';
      if (key.endsWith('.preview.buffering')) return 'Loading preview frame';
      if (key.endsWith('.bed.extent')) return `From 0:00 · ${String(values?.seconds)}s extent`;
      return values === undefined ? key : `${key}:${JSON.stringify(values)}`;
    },
  }),
}));

import { CutView, type CutActions } from '@/renderer/pages/studio/components/Workspace/Views/Cut';
import { CutPlayer } from '@/renderer/pages/studio/components/Workspace/Views/Cut/CutPlayer';

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
  coverCandidates: [
    { shotId: 'shot_1', beatId: 'beat_1', beatTitle: 'Opening', line: 'Wide opening', coverAssetId: 'cover_1' },
    { shotId: 'shot_2', beatId: 'beat_1', beatTitle: 'Opening', line: 'Detail', coverAssetId: null },
  ],
  ...overrides,
});

const projection = (cutProjection = cut(), activeBeats: WorkspaceProjection['activeBeats'] = []): WorkspaceProjection =>
  ({
    projectId: 'project_1',
    projectRevision: 7,
    activeBeats,
    activeBeatIds: cutProjection.beats.map((beat) => beat.id),
    activeShotIds: activeBeats.flatMap((beat) => beat.shots.map((shot) => shot.id)),
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

const playbackTake = (
  assetId: string,
  sourceDurationSeconds: number,
  overrides: Partial<WorkspaceTakeProjection> = {}
): WorkspaceTakeProjection => ({
  assetId,
  mediaKind: 'video',
  createdAt: '2026-08-19T00:00:00.000Z',
  selected: true,
  explicitSeed: false,
  effectiveSeed: false,
  binReason: null,
  sourceDurationSeconds,
  posterAssetId: `${assetId}_poster`,
  ...overrides,
});

const playbackShot = (
  id: string,
  assetId: string,
  sourceDurationSeconds: number,
  trimInSeconds: number | null,
  trimOutSeconds: number | null,
  overrides: Partial<WorkspaceShotProjection> = {}
): WorkspaceShotProjection => {
  const playedDurationSeconds = sourceDurationSeconds - (trimInSeconds ?? 0) - (trimOutSeconds ?? 0);
  return {
    id,
    line: `Line ${id}`,
    narration: '',
    onScreenText: '',
    durationSeconds: Math.max(1, Math.round(playedDurationSeconds)),
    chainBreak: 'none',
    derivation: 'derived',
    derivedFromActionRevision: 1,
    derivationStale: false,
    trimInSeconds,
    trimOutSeconds,
    selectedTakeId: assetId,
    selectedTakeSourceDurationSeconds: sourceDurationSeconds,
    playedDurationSeconds,
    explicitSeedAssetId: null,
    effectiveSeedAssetId: null,
    segmentHead: false,
    planningBoundary: null,
    frameBoundary: null,
    segmentState: { kind: 'rendered', takeCount: 1, selectedTakeNumber: 1 },
    dirtyCauses: [],
    downstreamShotIds: [],
    imageTakes: [],
    videoTakes: [playbackTake(assetId, sourceDurationSeconds)],
    coverAssetId: `${assetId}_poster`,
    takeCount: 1,
    displayState: 'selected_take',
    retainedWork: true,
    videoGenerationInFlight: false,
    seedGenerationInFlight: false,
    hasEffectiveSeed: false,
    ...overrides,
  };
};

const playbackBeat = (
  id: string,
  title: string,
  shots: WorkspaceShotProjection[],
  targetSeconds: number | null = null,
  overrides: Partial<WorkspaceBeatProjection> = {}
): WorkspaceBeatProjection => ({
  id,
  title,
  action: `Action ${id}`,
  look: `Look ${id}`,
  actionRevision: 1,
  lineHistory: [],
  targetSeconds,
  actualSeconds:
    shots.length === 0
      ? null
      : shots.reduce<number | null>(
          (total, shot) =>
            total === null || shot.playedDurationSeconds === null ? null : total + shot.playedDurationSeconds,
          0
        ),
  displayState: shots.length === 0 ? 'no_coverage' : 'ready',
  shots,
  coverAssetId: shots[0]?.coverAssetId ?? null,
  retainedWork: shots.length > 0,
  ...overrides,
});

const playableProjection = (): WorkspaceProjection => {
  const beatOne = playbackBeat('beat_1', 'Opening', [
    playbackShot('shot_1', 'take_1', 10, 1, 2),
    playbackShot('shot_2', 'take_2', 4, null, null),
  ]);
  const beatTwo = playbackBeat('beat_2', 'Missing middle', [], 5);
  const beatThree = playbackBeat('beat_3', 'Close', [playbackShot('shot_3', 'take_3', 8, 0.5, 0.5)]);
  const activeBeats = [beatOne, beatTwo, beatThree];
  const cutProjection = cut({
    beats: [
      {
        id: beatOne.id,
        title: beatOne.title,
        shotCount: 2,
        durationKind: 'actual',
        durationSeconds: 11,
        coverAssetId: beatOne.coverAssetId,
      },
      {
        id: beatTwo.id,
        title: beatTwo.title,
        shotCount: 0,
        durationKind: 'target',
        durationSeconds: 5,
        coverAssetId: null,
      },
      {
        id: beatThree.id,
        title: beatThree.title,
        shotCount: 1,
        durationKind: 'actual',
        durationSeconds: 7,
        coverAssetId: beatThree.coverAssetId,
      },
    ],
    filmDurationSeconds: 23,
    targetDurationSeconds: 24,
    coverCandidates: [],
  });
  return {
    ...projection(cutProjection, activeBeats),
    activeBeatIds: activeBeats.map((beat) => beat.id),
    activeShotIds: activeBeats.flatMap((beat) => beat.shots.map((shot) => shot.id)),
  };
};

describe('the truthful Cut playback sequence', () => {
  it('projects selected video Takes and a zero-Shot slate in exact film order with source and film intervals', () => {
    const expected: CutPlaybackSequence = {
      projectId: 'project_1',
      projectRevision: 7,
      durationSeconds: 23,
      segments: [
        {
          kind: 'video',
          beatId: 'beat_1',
          beatPosition: 1,
          beatTitle: 'Opening',
          shotId: 'shot_1',
          shotPosition: 1,
          shotTitle: 'Line shot_1',
          assetId: 'take_1',
          posterAssetId: 'take_1_poster',
          sourceDurationSeconds: 10,
          sourceInSeconds: 1,
          sourceOutSeconds: 8,
          durationSeconds: 7,
          filmStartSeconds: 0,
          filmEndSeconds: 7,
        },
        {
          kind: 'video',
          beatId: 'beat_1',
          beatPosition: 1,
          beatTitle: 'Opening',
          shotId: 'shot_2',
          shotPosition: 2,
          shotTitle: 'Line shot_2',
          assetId: 'take_2',
          posterAssetId: 'take_2_poster',
          sourceDurationSeconds: 4,
          sourceInSeconds: 0,
          sourceOutSeconds: 4,
          durationSeconds: 4,
          filmStartSeconds: 7,
          filmEndSeconds: 11,
        },
        {
          kind: 'slate',
          beatId: 'beat_2',
          beatPosition: 2,
          beatTitle: 'Missing middle',
          durationSeconds: 5,
          filmStartSeconds: 11,
          filmEndSeconds: 16,
        },
        {
          kind: 'video',
          beatId: 'beat_3',
          beatPosition: 3,
          beatTitle: 'Close',
          shotId: 'shot_3',
          shotPosition: 1,
          shotTitle: 'Line shot_3',
          assetId: 'take_3',
          posterAssetId: 'take_3_poster',
          sourceDurationSeconds: 8,
          sourceInSeconds: 0.5,
          sourceOutSeconds: 7.5,
          durationSeconds: 7,
          filmStartSeconds: 16,
          filmEndSeconds: 23,
        },
      ],
    };

    expect(buildCutPlaybackSequence(playableProjection())).toEqual(expected);
  });

  it('matches projection grouped duration arithmetic for fractional Shots across Beats', () => {
    const firstBeat = playbackBeat('beat_fraction_1', 'One', [
      playbackShot('shot_fraction_1', 'take_fraction_1', 0.001, null, null),
      playbackShot('shot_fraction_2', 'take_fraction_2', 0.001, null, null),
    ]);
    const secondBeat = playbackBeat('beat_fraction_2', 'Two', [
      playbackShot('shot_fraction_3', 'take_fraction_3', 0.001, null, null),
      playbackShot('shot_fraction_4', 'take_fraction_4', 2.035, null, null),
    ]);
    const cutProjection = cut({
      beats: [
        {
          id: firstBeat.id,
          title: firstBeat.title,
          shotCount: 2,
          durationKind: 'actual',
          durationSeconds: 0.002,
          coverAssetId: firstBeat.coverAssetId,
        },
        {
          id: secondBeat.id,
          title: secondBeat.title,
          shotCount: 2,
          durationKind: 'actual',
          durationSeconds: 2.036,
          coverAssetId: secondBeat.coverAssetId,
        },
      ],
      filmDurationSeconds: 2.038,
      coverCandidates: [],
    });
    const current = {
      ...projection(cutProjection, [firstBeat, secondBeat]),
      activeBeatIds: [firstBeat.id, secondBeat.id],
      activeShotIds: [...firstBeat.shots, ...secondBeat.shots].map((shot) => shot.id),
    };

    expect(buildCutPlaybackSequence(current)).toMatchObject({
      durationSeconds: 2.038,
      segments: [
        { filmStartSeconds: 0, filmEndSeconds: 0.001 },
        { filmStartSeconds: 0.001, filmEndSeconds: 0.002 },
        { filmStartSeconds: 0.002, filmEndSeconds: 0.003 },
        { filmStartSeconds: 0.003, filmEndSeconds: 2.038 },
      ],
    });
  });

  it('matches the authoritative source-minus-trim-in-minus-trim-out decimal operation order', () => {
    const shot = playbackShot('shot_decimal', 'take_decimal', 0.2, 0.01, 0.1);
    const beat = playbackBeat('beat_decimal', 'Decimal trim', [shot]);
    const cutProjection = cut({
      beats: [
        {
          id: beat.id,
          title: beat.title,
          shotCount: 1,
          durationKind: 'actual',
          durationSeconds: 0.09,
          coverAssetId: beat.coverAssetId,
        },
      ],
      filmDurationSeconds: 0.09,
      coverCandidates: [],
    });
    const current = {
      ...projection(cutProjection, [beat]),
      activeBeatIds: [beat.id],
      activeShotIds: [shot.id],
    };

    expect(buildCutPlaybackSequence(current)).toMatchObject({
      durationSeconds: 0.09,
      segments: [{ sourceOutSeconds: 0.1, durationSeconds: 0.09, filmEndSeconds: 0.09 }],
    });
  });

  it.each([
    ['a rounded-away positive segment', Number.MAX_SAFE_INTEGER - 1, 0.5, Number.MAX_SAFE_INTEGER - 1],
    ['a film total beyond the safe range', Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects %s instead of emitting a zero-width or unsafe segment', (_label, first, second, total) => {
    const firstBeat = playbackBeat('beat_large_1', 'Large one', [], first);
    const secondBeat = playbackBeat('beat_large_2', 'Large two', [], second);
    const cutProjection = cut({
      beats: [
        {
          id: firstBeat.id,
          title: firstBeat.title,
          shotCount: 0,
          durationKind: 'target',
          durationSeconds: first,
          coverAssetId: null,
        },
        {
          id: secondBeat.id,
          title: secondBeat.title,
          shotCount: 0,
          durationKind: 'target',
          durationSeconds: second,
          coverAssetId: null,
        },
      ],
      filmDurationSeconds: total,
      coverCandidates: [],
    });
    const current = {
      ...projection(cutProjection, [firstBeat, secondBeat]),
      activeBeatIds: [firstBeat.id, secondBeat.id],
      activeShotIds: [],
    };

    expect(buildCutPlaybackSequence(current)).toBeNull();
  });

  it('rejects a later Shot whose absolute bounds round to the same safe integer', () => {
    const firstBeat = playbackBeat('beat_large_lead', 'Large lead', [], Number.MAX_SAFE_INTEGER - 1);
    const secondBeat = playbackBeat('beat_fraction_tail', 'Fraction tail', [
      playbackShot('shot_fraction_tail_1', 'take_fraction_tail_1', 0.6, null, null),
      playbackShot('shot_fraction_tail_2', 'take_fraction_tail_2', 0.1, null, null),
    ]);
    const cutProjection = cut({
      beats: [
        {
          id: firstBeat.id,
          title: firstBeat.title,
          shotCount: 0,
          durationKind: 'target',
          durationSeconds: Number.MAX_SAFE_INTEGER - 1,
          coverAssetId: null,
        },
        {
          id: secondBeat.id,
          title: secondBeat.title,
          shotCount: 2,
          durationKind: 'actual',
          durationSeconds: 0.7,
          coverAssetId: secondBeat.coverAssetId,
        },
      ],
      filmDurationSeconds: Number.MAX_SAFE_INTEGER,
      coverCandidates: [],
    });
    const current = {
      ...projection(cutProjection, [firstBeat, secondBeat]),
      activeBeatIds: [firstBeat.id, secondBeat.id],
      activeShotIds: secondBeat.shots.map((shot) => shot.id),
    };

    expect(buildCutPlaybackSequence(current)).toBeNull();
  });

  it('uses only selected-media and timing authority, not freshness or generation display state', () => {
    const current = playableProjection();
    current.workspaceStatusReady = false;
    current.chainStatusReady = false;
    current.activeBeats[0]!.displayState = 'stale';
    current.activeBeats[0]!.shots[0]!.displayState = 'selected_take';
    current.activeBeats[0]!.shots[0]!.dirtyCauses = ['generation_out_of_date'];
    current.activeBeats[0]!.shots[0]!.videoGenerationInFlight = true;

    expect(buildCutPlaybackSequence(current)).toEqual(buildCutPlaybackSequence(playableProjection()));
  });

  const malformedCases: ReadonlyArray<[string, (value: WorkspaceProjection) => void]> = [
    ['an unsafe project id', (value) => void (value.projectId = '../private')],
    ['an unsafe project revision', (value) => void (value.projectRevision = Number.MAX_SAFE_INTEGER + 1)],
    ['an unavailable canonical order', (value) => void (value.cut.orderReady = false)],
    [
      'a reordered active Beat index',
      (value) =>
        void ([value.activeBeatIds[0], value.activeBeatIds[1]] = [value.activeBeatIds[1]!, value.activeBeatIds[0]!]),
    ],
    ['a duplicate active Beat', (value) => void (value.activeBeats[1]!.id = value.activeBeats[0]!.id)],
    [
      'a reordered global Shot index',
      (value) =>
        void ([value.activeShotIds[0], value.activeShotIds[1]] = [value.activeShotIds[1]!, value.activeShotIds[0]!]),
    ],
    ['a duplicate Shot id', (value) => void (value.activeBeats[2]!.shots[0]!.id = 'shot_1')],
    ['a Cut Beat identity mismatch', (value) => void (value.cut.beats[1]!.id = 'beat_elsewhere')],
    ['a Cut Shot count mismatch', (value) => void (value.cut.beats[0]!.shotCount = 1)],
    ['a covered Beat classified as a target slate', (value) => void (value.cut.beats[0]!.durationKind = 'target')],
    ['a covered Beat aggregate mismatch', (value) => void (value.cut.beats[0]!.durationSeconds = 12)],
    ['an active Beat aggregate mismatch', (value) => void (value.activeBeats[0]!.actualSeconds = 12)],
    ['a film aggregate mismatch', (value) => void (value.cut.filmDurationSeconds = 24)],
    ['a non-finite film total', (value) => void (value.cut.filmDurationSeconds = Number.POSITIVE_INFINITY)],
    ['a covered Shot without a selected Take', (value) => void (value.activeBeats[0]!.shots[0]!.selectedTakeId = null)],
    ['a selected Take absent from its video rows', (value) => void (value.activeBeats[0]!.shots[0]!.videoTakes = [])],
    [
      'a selected row not marked selected',
      (value) => void (value.activeBeats[0]!.shots[0]!.videoTakes[0]!.selected = false),
    ],
    [
      'a selected row parked in the Bin',
      (value) => void (value.activeBeats[0]!.shots[0]!.videoTakes[0]!.binReason = 'lifted'),
    ],
    [
      'a selected row with the wrong media kind',
      (value) => void (value.activeBeats[0]!.shots[0]!.videoTakes[0]!.mediaKind = 'image'),
    ],
    ['an unsafe selected asset id', (value) => void (value.activeBeats[0]!.shots[0]!.selectedTakeId = '../take_1')],
    [
      'an unsafe selected poster id',
      (value) => void (value.activeBeats[0]!.shots[0]!.videoTakes[0]!.posterAssetId = '../poster'),
    ],
    [
      'duplicate selected video authority',
      (value) =>
        void value.activeBeats[0]!.shots[0]!.videoTakes.push({
          ...value.activeBeats[0]!.shots[0]!.videoTakes[0]!,
        }),
    ],
    [
      'a concurrently selected image row',
      (value) =>
        void value.activeBeats[0]!.shots[0]!.imageTakes.push(
          playbackTake('image_selected_too', 10, { mediaKind: 'image', selected: true })
        ),
    ],
    [
      'a truthy non-boolean selected flag',
      (value) =>
        void Object.assign(value.activeBeats[0]!.shots[0]!.videoTakes[0]! as unknown as { selected: unknown }, {
          selected: 'yes',
        }),
    ],
    [
      'a selected source-duration mismatch',
      (value) => void (value.activeBeats[0]!.shots[0]!.videoTakes[0]!.sourceDurationSeconds = 9),
    ],
    [
      'a non-finite selected source duration',
      (value) => void (value.activeBeats[0]!.shots[0]!.selectedTakeSourceDurationSeconds = Number.NaN),
    ],
    ['a negative-zero trim', (value) => void (value.activeBeats[0]!.shots[0]!.trimInSeconds = -0)],
    ['trims that consume the source', (value) => void (value.activeBeats[0]!.shots[0]!.trimOutSeconds = 9)],
    ['a played-duration mismatch', (value) => void (value.activeBeats[0]!.shots[0]!.playedDurationSeconds = 6)],
    ['a zero-Shot Beat without a target', (value) => void (value.activeBeats[1]!.targetSeconds = null)],
    ['a zero-Shot Beat with a zero target', (value) => void (value.activeBeats[1]!.targetSeconds = 0)],
    ['a zero-Shot Beat target mismatch', (value) => void (value.activeBeats[1]!.targetSeconds = 6)],
    ['a zero-Shot Beat classified as actual', (value) => void (value.cut.beats[1]!.durationKind = 'actual')],
  ];

  it.each(malformedCases)('fails the whole sequence closed for %s', (_label, mutate) => {
    const current = structuredClone(playableProjection());
    mutate(current);
    expect(buildCutPlaybackSequence(current)).toBeNull();
  });

  it('names nothing while every covered Shot already has its Take', () => {
    expect(cutPlaybackShotsAwaitingTake(playableProjection())).toEqual([]);
  });

  it('names the Shot whose Take was never chosen, which is the one refusal a director can act on', () => {
    const current = playableProjection();
    current.activeBeats[0]!.shots[0]!.selectedTakeId = null;

    expect(cutPlaybackShotsAwaitingTake(current)).toEqual([
      { beatPosition: 1, shotPosition: 1, shotId: current.activeBeats[0]!.shots[0]!.id },
    ]);
  });

  it.each([
    [
      'a selected Take absent from its video rows',
      (v: WorkspaceProjection) => void (v.activeBeats[0]!.shots[0]!.videoTakes = []),
    ],
    [
      'an unsafe selected asset id',
      (v: WorkspaceProjection) => void (v.activeBeats[0]!.shots[0]!.selectedTakeId = '../take_1'),
    ],
    [
      'a played-duration mismatch',
      (v: WorkspaceProjection) => void (v.activeBeats[0]!.shots[0]!.playedDurationSeconds = 6),
    ],
  ])('stays silent for %s, which is a projection fault and not a missing choice', (_label, mutate) => {
    const current = playableProjection();
    mutate(current);

    expect(buildCutPlaybackSequence(current)).toBeNull();
    expect(cutPlaybackShotsAwaitingTake(current)).toEqual([]);
  });

  it('floors and clamps the live playback clock independently of rounded summary copy', () => {
    expect(formatCutPlaybackClock(7.999, 23)).toBe('0:07');
    expect(formatCutPlaybackClock(-2, 23)).toBe('0:00');
    expect(formatCutPlaybackClock(24, 23)).toBe('0:23');
    expect(formatCutPlaybackClock(61.9, 120)).toBe('1:01');
    expect(formatCutPlaybackClock(Number.NaN, 23)).toBeNull();
    expect(formatCutPlaybackClock(2, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

const renderCutPlayer = (
  current: WorkspaceProjection = playableProjection(),
  input: { pending?: boolean; projectId?: string } = {}
) =>
  render(
    <CutPlayer pending={input.pending ?? false} projectId={input.projectId ?? current.projectId} projection={current} />
  );

const mediaElement = (): HTMLVideoElement => {
  const media = document.querySelector<HTMLVideoElement>('[data-cut-preview-media][data-media-kind="video"]');
  if (media === null) throw new Error('Expected the selected video Take in the Cut preview');
  return media;
};

const setMediaNumber = (media: HTMLMediaElement, key: 'currentTime' | 'duration', value: number): void => {
  Object.defineProperty(media, key, { configurable: true, value, writable: true });
};

const slateFirstProjection = (): WorkspaceProjection => {
  const current = playableProjection();
  current.activeBeats = [current.activeBeats[1]!, current.activeBeats[0]!, current.activeBeats[2]!];
  current.activeBeatIds = current.activeBeats.map((beat) => beat.id);
  current.activeShotIds = current.activeBeats.flatMap((beat) => beat.shots.map((shot) => shot.id));
  current.cut.beats = [current.cut.beats[1]!, current.cut.beats[0]!, current.cut.beats[2]!];
  return current;
};

describe('the truthful Cut player and transport', () => {
  it('says which Shot still needs a Take instead of refusing without a reason', () => {
    const current = playableProjection();
    current.activeBeats[0]!.shots[0]!.selectedTakeId = null;

    renderCutPlayer(current);

    expect(screen.getByText('Beat 1 · Shot 1 needs a Take chosen before the film can play.')).toBeVisible();
    expect(screen.queryByText('No film preview is available.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play film' })).toBeDisabled();
  });

  it('counts the Shots when more than one is still waiting to be chosen', () => {
    const current = playableProjection();
    current.activeBeats[0]!.shots[0]!.selectedTakeId = null;
    current.activeBeats[2]!.shots[0]!.selectedTakeId = null;

    renderCutPlayer(current);

    expect(screen.getByText('2 Shots need a Take chosen before the film can play.')).toBeVisible();
  });

  it('keeps the reasonless refusal for a fault that choosing a Take would not fix', () => {
    const current = playableProjection();
    current.activeBeats[0]!.shots[0]!.playedDurationSeconds = 6;

    renderCutPlayer(current);

    expect(screen.getByText('No film preview is available.')).toBeVisible();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mockMedia = () => ({
    pause: vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined),
    play: vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined),
  });

  it('renders the first selected Take through the managed protocol with a custom muted transport', () => {
    renderCutPlayer();

    const preview = document.querySelector<HTMLElement>('[data-cut-preview]');
    const video = mediaElement();
    const transport = screen.getByRole('group', { name: 'Film transport' });
    expect(preview).toHaveAccessibleName('Film preview');
    expect(preview).toHaveAttribute('data-playback-kind', 'video');
    expect(document.querySelector('[data-cut-preview-badge]')).toHaveTextContent('Beat 01 · Opening');
    expect(video).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_1');
    expect(video).toHaveAttribute('poster', 'weprompt-studio://asset/project_1/take_1_poster');
    expect(video).toHaveAccessibleName('Beat 01 · Opening · Shot 01 · Line shot_1');
    expect(video).toHaveAttribute('playsinline');
    expect(video.muted).toBe(true);
    expect(video.controls).toBe(false);
    expect(video).toHaveAttribute('preload', 'metadata');
    const play = within(transport).getByRole('button', { name: 'Play film' });
    expect(play).toHaveAttribute('data-cut-play');
    expect(play).toHaveAttribute('aria-pressed', 'false');
    const time = transport.querySelector('output[data-cut-time]');
    expect(time).toHaveTextContent('0:00 / 0:23');
    expect(time).toHaveAttribute('aria-live', 'off');
    expect(time).toHaveAttribute('role', 'timer');
    expect(time?.querySelector('bdi')).toHaveAttribute('dir', 'auto');
    expect(within(transport).getByText('Picture only — the bed is muted here')).toBeVisible();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('waits for an exact asynchronous trim-in seek before playing a pre-metadata Play request', async () => {
    const media = mockMedia();
    renderCutPlayer();
    const video = mediaElement();
    let currentTime = 0;
    let seeking = false;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        seeking = true;
      },
    });
    Object.defineProperty(video, 'seeking', { configurable: true, get: () => seeking });

    fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
    setMediaNumber(video, 'duration', 10);
    fireEvent.loadedMetadata(video);
    expect(currentTime).toBe(1);
    expect(media.play).not.toHaveBeenCalled();

    seeking = false;
    fireEvent.seeked(video);
    await act(async () => Promise.resolve());
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pause film' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('advances [source-in, source-out) videos and the authored slate timer without moving transport focus', async () => {
    vi.useFakeTimers();
    const media = mockMedia();
    renderCutPlayer();
    const play = screen.getByRole('button', { name: 'Play film' });
    play.focus();

    const first = mediaElement();
    setMediaNumber(first, 'duration', 10);
    fireEvent.loadedMetadata(first);
    expect(first.currentTime).toBe(1);
    await act(async () => {
      fireEvent.click(play);
      await Promise.resolve();
    });
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(play).toHaveAccessibleName('Pause film');
    expect(play).toHaveAttribute('aria-pressed', 'true');
    expect(play).toHaveFocus();

    setMediaNumber(first, 'currentTime', 7.999);
    fireEvent.timeUpdate(first);
    expect(mediaElement()).toBe(first);
    expect(screen.getByText('0:06 / 0:23')).toBeVisible();
    setMediaNumber(first, 'currentTime', 8);
    fireEvent.timeUpdate(first);

    const second = mediaElement();
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_2');
    setMediaNumber(second, 'duration', 4);
    fireEvent.loadedMetadata(second);
    await act(async () => Promise.resolve());
    expect(media.play).toHaveBeenCalledTimes(2);
    setMediaNumber(second, 'currentTime', 4);
    fireEvent.timeUpdate(second);

    const slate = document.querySelector<HTMLElement>('[data-cut-preview-media][data-media-kind="slate"]');
    expect(slate).not.toBeNull();
    expect(slate).toHaveAccessibleName('Beat 02 · Missing middle · Slate · No coverage');
    expect(slate).toHaveTextContent('Slate · No coverage');
    expect(slate).toHaveTextContent('Holds 0:05 in the Cut');
    expect(screen.getByRole('status')).toHaveTextContent('Beat 02 · Missing middle · Slate · No coverage');
    expect(play).toHaveFocus();
    act(() => vi.advanceTimersByTime(5_000));

    const finalVideo = mediaElement();
    expect(finalVideo).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_3');
    setMediaNumber(finalVideo, 'duration', 8);
    fireEvent.loadedMetadata(finalVideo);
    await act(async () => Promise.resolve());
    setMediaNumber(finalVideo, 'currentTime', 7.5);
    fireEvent.timeUpdate(finalVideo);
    expect(play).toHaveAccessibleName('Play film');
    expect(play).toHaveAttribute('aria-pressed', 'false');
    expect(play).toHaveFocus();
    expect(screen.getByText('0:23 / 0:23')).toBeVisible();

    fireEvent.click(play);
    const restartedVideo = mediaElement();
    expect(restartedVideo).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_1');
    setMediaNumber(restartedVideo, 'duration', 10);
    fireEvent.loadedMetadata(restartedVideo);
    await act(async () => Promise.resolve());
    expect(restartedVideo.currentTime).toBe(1);
    expect(play).toHaveAccessibleName('Pause film');
    expect(play).toHaveFocus();
  });

  it('ignores a rejected stale play request after pause and a newer resume attempt', async () => {
    const media = mockMedia();
    let rejectFirst!: (reason?: unknown) => void;
    let resolveSecond!: () => void;
    const firstRequest = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const secondRequest = new Promise<void>((complete) => {
      resolveSecond = complete;
    });
    media.play.mockReset().mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
    renderCutPlayer();
    const video = mediaElement();
    setMediaNumber(video, 'duration', 10);
    fireEvent.loadedMetadata(video);
    const play = screen.getByRole('button', { name: 'Play film' });
    fireEvent.click(play);
    fireEvent.click(play);
    fireEvent.click(play);

    await act(async () => {
      rejectFirst(new Error('stale AbortError'));
      await Promise.resolve();
    });
    expect(play).toHaveAccessibleName('Pause film');
    expect(play).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).not.toHaveTextContent('This preview could not be loaded.');

    await act(async () => {
      resolveSecond();
      await Promise.resolve();
    });
  });

  it('ignores a queued ended event after the user has paused the current Take', async () => {
    mockMedia();
    renderCutPlayer();
    const video = mediaElement();
    setMediaNumber(video, 'duration', 10);
    fireEvent.loadedMetadata(video);
    const play = screen.getByRole('button', { name: 'Play film' });
    fireEvent.click(play);
    await act(async () => Promise.resolve());
    fireEvent.click(play);
    setMediaNumber(video, 'currentTime', 5);
    fireEvent.ended(video);

    expect(mediaElement()).toBe(video);
    expect(play).toHaveAccessibleName('Play film');
    expect(screen.getByRole('status')).not.toHaveTextContent('This preview could not be loaded.');
  });

  it('remounts a single-video media epoch on replay and ignores prior-cycle native events', async () => {
    mockMedia();
    const current = playableProjection();
    const shot = current.activeBeats[0]!.shots[0]!;
    const beat = {
      ...current.activeBeats[0]!,
      actualSeconds: 7,
      shots: [shot],
    };
    current.activeBeats = [beat];
    current.activeBeatIds = [beat.id];
    current.activeShotIds = [shot.id];
    current.cut.beats = [
      {
        ...current.cut.beats[0]!,
        shotCount: 1,
        durationSeconds: 7,
      },
    ];
    current.cut.filmDurationSeconds = 7;
    renderCutPlayer(current);

    const priorCycle = mediaElement();
    setMediaNumber(priorCycle, 'duration', 10);
    fireEvent.loadedMetadata(priorCycle);
    const play = screen.getByRole('button', { name: 'Play film' });
    fireEvent.click(play);
    await act(async () => Promise.resolve());
    setMediaNumber(priorCycle, 'currentTime', 8);
    fireEvent.timeUpdate(priorCycle);
    expect(screen.getByText('0:07 / 0:07')).toBeVisible();

    fireEvent.click(play);
    const nextCycle = mediaElement();
    expect(nextCycle).not.toBe(priorCycle);
    fireEvent.error(priorCycle);
    fireEvent.ended(priorCycle);
    expect(play).toHaveAccessibleName('Pause film');
    expect(screen.getByRole('status')).not.toHaveTextContent('This preview could not be loaded.');

    setMediaNumber(nextCycle, 'duration', 10);
    fireEvent.loadedMetadata(nextCycle);
    await act(async () => Promise.resolve());
    expect(nextCycle.currentTime).toBe(1);
  });

  it('pauses and resumes only the remaining authored slate duration', async () => {
    vi.useFakeTimers();
    mockMedia();
    renderCutPlayer(slateFirstProjection());
    const play = screen.getByRole('button', { name: 'Play film' });
    fireEvent.click(play);
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('0:02 / 0:23')).toBeVisible();
    fireEvent.click(play);
    expect(play).toHaveAccessibleName('Play film');
    act(() => vi.advanceTimersByTime(10_000));
    expect(document.querySelector('[data-media-kind="slate"]')).not.toBeNull();
    expect(screen.getByText('0:02 / 0:23')).toBeVisible();

    fireEvent.click(play);
    act(() => vi.advanceTimersByTime(2_999));
    expect(document.querySelector('[data-media-kind="slate"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(mediaElement()).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_1');
  });

  it('ignores a slate timer callback that was already queued when Pause froze the clock', () => {
    vi.useFakeTimers();
    mockMedia();
    const queuedTicks: Array<() => void> = [];
    vi.spyOn(window, 'setInterval').mockImplementation((handler: TimerHandler) => {
      if (typeof handler !== 'function') throw new TypeError('Expected a slate timer callback');
      queuedTicks.push(handler);
      return queuedTicks.length;
    });
    renderCutPlayer(slateFirstProjection());
    const play = screen.getByRole('button', { name: 'Play film' });

    fireEvent.click(play);
    expect(queuedTicks).toHaveLength(1);
    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.click(play);
    expect(screen.getByText('0:02 / 0:23')).toBeVisible();

    act(() => vi.advanceTimersByTime(1_000));
    act(() => queuedTicks[0]!());
    expect(screen.getByText('0:02 / 0:23')).toBeVisible();
    expect(document.querySelector('[data-media-kind="slate"]')).not.toBeNull();
  });

  it('takes live video progress from currentTime, freezes it while waiting, and floors the visible clock', async () => {
    mockMedia();
    renderCutPlayer();
    const video = mediaElement();
    setMediaNumber(video, 'duration', 10);
    fireEvent.loadedMetadata(video);
    fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
    await act(async () => Promise.resolve());

    setMediaNumber(video, 'currentTime', 2.999);
    fireEvent.timeUpdate(video);
    expect(screen.getByText('0:01 / 0:23')).toBeVisible();
    fireEvent.waiting(video);
    setMediaNumber(video, 'currentTime', 5.9);
    fireEvent.timeUpdate(video);
    expect(screen.getByText('0:01 / 0:23')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pause film' }));
    expect(screen.getByText('0:01 / 0:23')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
    await act(async () => Promise.resolve());
    fireEvent.playing(video);
    fireEvent.timeUpdate(video);
    expect(screen.getByText('0:04 / 0:23')).toBeVisible();
  });

  it('does not let a canceled old frame callback stop the current boundary watcher', async () => {
    const callbacks = new Map<number, Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0]>();
    let nextCallbackId = 0;
    const prototype = HTMLVideoElement.prototype;
    const requestDescriptor = Object.getOwnPropertyDescriptor(prototype, 'requestVideoFrameCallback');
    const cancelDescriptor = Object.getOwnPropertyDescriptor(prototype, 'cancelVideoFrameCallback');
    Object.defineProperty(prototype, 'requestVideoFrameCallback', {
      configurable: true,
      value: vi.fn((callback: Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0]) => {
        nextCallbackId += 1;
        callbacks.set(nextCallbackId, callback);
        return nextCallbackId;
      }),
    });
    Object.defineProperty(prototype, 'cancelVideoFrameCallback', {
      configurable: true,
      value: vi.fn((callbackId: number) => {
        callbacks.delete(callbackId);
      }),
    });

    try {
      mockMedia();
      renderCutPlayer();
      const first = mediaElement();
      setMediaNumber(first, 'duration', 10);
      fireEvent.loadedMetadata(first);
      fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
      await act(async () => Promise.resolve());
      fireEvent.playing(first);
      const staleCallback = callbacks.values().next().value;
      if (staleCallback === undefined) throw new Error('Expected the first video-frame boundary callback');

      fireEvent.rateChange(first);
      expect(callbacks).toHaveLength(1);
      act(() => staleCallback(performance.now(), { mediaTime: 2 } as VideoFrameCallbackMetadata));

      const [currentCallbackId, currentCallback] = callbacks.entries().next().value ?? [];
      if (currentCallbackId === undefined || currentCallback === undefined) {
        throw new Error('Expected the replacement video-frame boundary callback');
      }
      callbacks.delete(currentCallbackId);
      act(() => currentCallback(performance.now(), { mediaTime: 8 } as VideoFrameCallbackMetadata));
      expect(mediaElement()).not.toBe(first);
      expect(mediaElement()).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_2');
    } finally {
      if (requestDescriptor === undefined) delete prototype.requestVideoFrameCallback;
      else Object.defineProperty(prototype, 'requestVideoFrameCallback', requestDescriptor);
      if (cancelDescriptor === undefined) delete prototype.cancelVideoFrameCallback;
      else Object.defineProperty(prototype, 'cancelVideoFrameCallback', cancelDescriptor);
    }
  });

  it('stops at the exclusive trim boundary from the current video-frame callback without waiting for timeupdate', async () => {
    const callbacks = new Map<number, Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0]>();
    let nextCallbackId = 0;
    const prototype = HTMLVideoElement.prototype;
    const requestDescriptor = Object.getOwnPropertyDescriptor(prototype, 'requestVideoFrameCallback');
    const cancelDescriptor = Object.getOwnPropertyDescriptor(prototype, 'cancelVideoFrameCallback');
    Object.defineProperty(prototype, 'requestVideoFrameCallback', {
      configurable: true,
      value: vi.fn((callback: Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0]) => {
        nextCallbackId += 1;
        callbacks.set(nextCallbackId, callback);
        return nextCallbackId;
      }),
    });
    Object.defineProperty(prototype, 'cancelVideoFrameCallback', {
      configurable: true,
      value: vi.fn((callbackId: number) => {
        callbacks.delete(callbackId);
      }),
    });

    try {
      const media = mockMedia();
      renderCutPlayer();
      const first = mediaElement();
      setMediaNumber(first, 'duration', 10);
      fireEvent.loadedMetadata(first);
      fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
      await act(async () => Promise.resolve());
      fireEvent.playing(first);
      const [callbackId, callback] = callbacks.entries().next().value ?? [];
      if (callbackId === undefined || callback === undefined)
        throw new Error('Expected a video-frame boundary callback');
      callbacks.delete(callbackId);

      act(() => {
        callback(performance.now(), { mediaTime: 8 } as VideoFrameCallbackMetadata);
      });
      expect(media.pause).toHaveBeenCalled();
      expect(mediaElement()).not.toBe(first);
      expect(mediaElement()).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_2');
    } finally {
      if (requestDescriptor === undefined) delete prototype.requestVideoFrameCallback;
      else Object.defineProperty(prototype, 'requestVideoFrameCallback', requestDescriptor);
      if (cancelDescriptor === undefined) delete prototype.cancelVideoFrameCallback;
      else Object.defineProperty(prototype, 'cancelVideoFrameCallback', cancelDescriptor);
    }
  });

  it('uses a cancellable timer boundary fallback when video-frame callbacks are unavailable', async () => {
    vi.useFakeTimers();
    const prototype = HTMLVideoElement.prototype;
    const requestDescriptor = Object.getOwnPropertyDescriptor(prototype, 'requestVideoFrameCallback');
    Object.defineProperty(prototype, 'requestVideoFrameCallback', { configurable: true, value: undefined });

    try {
      mockMedia();
      renderCutPlayer();
      const first = mediaElement();
      setMediaNumber(first, 'duration', 10);
      fireEvent.loadedMetadata(first);
      fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
      await act(async () => Promise.resolve());
      fireEvent.playing(first);
      setMediaNumber(first, 'currentTime', 8);

      act(() => vi.advanceTimersByTime(16));
      expect(mediaElement()).not.toBe(first);
      expect(mediaElement()).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_2');
    } finally {
      if (requestDescriptor === undefined) delete prototype.requestVideoFrameCallback;
      else Object.defineProperty(prototype, 'requestVideoFrameCallback', requestDescriptor);
    }
  });

  it.each(['rejected play', 'short metadata', 'early ended', 'seek failure', 'native media error'] as const)(
    'stops without skipping on %s and leaves a guarded focusable retry',
    async (failure) => {
      const media = mockMedia();
      if (failure === 'rejected play') media.play.mockRejectedValueOnce(new Error('closed'));
      renderCutPlayer();
      const play = screen.getByRole('button', { name: 'Play film' });
      play.focus();
      const first = mediaElement();
      if (failure === 'seek failure') {
        Object.defineProperty(first, 'currentTime', {
          configurable: true,
          get: () => 0,
          set: () => {
            throw new Error('seek failed');
          },
        });
        setMediaNumber(first, 'duration', 10);
        fireEvent.loadedMetadata(first);
      } else if (failure === 'short metadata') {
        setMediaNumber(first, 'duration', 7.5);
        fireEvent.loadedMetadata(first);
      } else {
        setMediaNumber(first, 'duration', 10);
        fireEvent.loadedMetadata(first);
        if (failure === 'early ended') {
          fireEvent.click(play);
          await act(async () => Promise.resolve());
          setMediaNumber(first, 'currentTime', 5);
          fireEvent.ended(first);
        } else if (failure === 'native media error') {
          fireEvent.error(first);
        } else {
          fireEvent.click(play);
          await act(async () => Promise.resolve());
        }
      }

      expect(await screen.findByRole('status')).toHaveTextContent('This preview could not be loaded.');
      expect(mediaElement()).toBe(first);
      if (failure === 'native media error') {
        setMediaNumber(first, 'currentTime', 8);
        fireEvent.ended(first);
        fireEvent.timeUpdate(first);
        expect(mediaElement()).toBe(first);
        expect(screen.getByRole('status')).toHaveTextContent('This preview could not be loaded.');
      }
      expect(play).not.toBeDisabled();
      expect(play).toHaveAttribute('aria-disabled', 'true');
      expect(play).toHaveFocus();
      fireEvent.click(play);
      expect(media.play).toHaveBeenCalledTimes(failure === 'rejected play' || failure === 'early ended' ? 1 : 0);
    }
  );

  it('resets and pauses for pending work, project mismatch, revision change, or order change and ignores stale events', async () => {
    const media = mockMedia();
    const current = playableProjection();
    const view = renderCutPlayer(current);
    const play = screen.getByRole('button', { name: 'Play film' });
    const staleVideo = mediaElement();
    setMediaNumber(staleVideo, 'duration', 10);
    fireEvent.loadedMetadata(staleVideo);
    fireEvent.click(play);
    await act(async () => Promise.resolve());
    setMediaNumber(staleVideo, 'currentTime', 4);
    fireEvent.timeUpdate(staleVideo);
    expect(screen.getByText('0:03 / 0:23')).toBeVisible();

    view.rerender(<CutPlayer pending projectId='project_1' projection={current} />);
    expect(media.pause).toHaveBeenCalled();
    expect(screen.getByText('0:00 / 0:23')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Play film' })).toBeDisabled();
    fireEvent.timeUpdate(staleVideo);
    fireEvent.ended(staleVideo);
    expect(screen.getByText('0:00 / 0:23')).toBeVisible();

    view.rerender(<CutPlayer pending={false} projectId='different_project' projection={current} />);
    const unavailable = screen.getByText('No film preview is available.');
    expect(unavailable).toBeVisible();
    const disabledPlay = screen.getByRole('button', { name: 'Play film' });
    expect(disabledPlay).toBeDisabled();
    fireEvent.click(disabledPlay);
    expect(media.play).toHaveBeenCalledTimes(1);

    const revised = structuredClone(current);
    revised.projectRevision += 1;
    view.rerender(<CutPlayer pending={false} projectId='project_1' projection={revised} />);
    expect(screen.getByText('0:00 / 0:23')).toBeVisible();
    const reordered = slateFirstProjection();
    reordered.projectRevision = revised.projectRevision;
    view.rerender(<CutPlayer pending={false} projectId='project_1' projection={reordered} />);
    expect(screen.getByText('0:00 / 0:23')).toBeVisible();
    expect(document.querySelector('[data-media-kind="slate"]')).not.toBeNull();
  });

  it('integrates a 2:1 preview-first hero whose transport and summary remain semantic siblings', () => {
    const current = playableProjection();
    renderCut({ cutProjection: current.cut, activeBeats: current.activeBeats });
    const hero = document.querySelector<HTMLElement>('[data-cut-hero]');
    const preview = document.querySelector<HTMLElement>('[data-cut-preview]');
    const transport = document.querySelector<HTMLElement>('[data-cut-transport]');
    const summary = document.querySelector<HTMLElement>('[data-cut-summary]');
    expect(hero).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(transport).not.toBeNull();
    expect(summary?.tagName).toBe('ASIDE');
    expect(summary).toHaveAccessibleName('The film');
    expect(summary).toContainElement(document.querySelector('[data-cut-film]'));
    expect(preview?.parentElement).toBe(transport?.parentElement);
    expect(preview?.parentElement?.parentElement).toBe(hero);
    expect(summary?.parentElement).toBe(hero);
    expect(Array.from(hero?.children ?? [])).toEqual([preview?.parentElement, summary]);
  });

  it('pins the preview geometry, media containment, and wide-to-compact hero switch to the drawn contract', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/CutPlayer.tsx'),
      'utf8'
    );
    const css = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/Cut.module.css'
      ),
      'utf8'
    );

    expect(source).toContain('data-cut-preview');
    expect(source).toContain('data-cut-preview-media');
    expect(source).toContain('data-cut-preview-badge');
    expect(source).toContain('data-cut-transport');
    expect(source).toContain('data-cut-play');
    expect(source).toContain('data-cut-time');
    expect(source).toMatch(/<video[\s\S]*\bmuted\b[\s\S]*\bplaysInline\b/);
    expect(source).not.toMatch(/<video[\s\S]*\bcontrols\s*=/);
    expect(source).not.toMatch(/<audio\b/);
    expect(css).toMatch(/\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s+minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.hero\s*\{[^}]*gap:\s*13px/s);
    expect(css).toMatch(/\.preview\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
    expect(css).toMatch(/\.previewMedia\s*\{[^}]*object-fit:\s*contain/s);
    expect(css).toMatch(
      /@container\s*\(max-width:\s*859px\)[\s\S]*?\.hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
  });
});

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
    activeBeats?: WorkspaceProjection['activeBeats'];
    onOpenBeat?: (beatId: string) => void;
  } = {}
) => {
  const cutActions = input.actions ?? actions();
  const onOpenBeat = input.onOpenBeat ?? vi.fn();
  render(
    <CutView
      actions={cutActions}
      exportCatalog={input.exportCatalog === undefined ? catalog() : input.exportCatalog}
      exportErrorMessageKey={input.exportErrorMessageKey ?? null}
      pending={input.pending ?? false}
      projectId='project_1'
      projection={projection(input.cutProjection, input.activeBeats)}
      onOpenBeat={onOpenBeat}
    />
  );
  return Object.assign(cutActions, { onOpenBeat });
};

describe('CutView', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders one film-level rail, an honest bed, and exactly three export shapes', () => {
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
    expect(screen.getAllByText('Opening')).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: /workspace\.cut\.(?:openBeat|slate\.openBeat)/ }).length
    ).toBeGreaterThan(0);
  });

  it('renders a compact selectable filmstrip and keeps reorder controls out of its segments', () => {
    renderCut({
      activeBeats: [
        { id: 'beat_1', displayState: 'ready', shots: [] },
        { id: 'beat_2', displayState: 'no_coverage', shots: [] },
      ] as WorkspaceProjection['activeBeats'],
    });

    const rail = screen.getByRole('list', { name: 'conversation.creativeStudio.workspace.cut.railLabel' });
    expect(rail).toHaveAttribute('data-cut-filmstrip');
    const segments = within(rail).getAllByRole('button');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveTextContent('01');
    expect(segments[0]).toHaveTextContent('Opening');
    expect(segments[0]).toHaveTextContent('7s');
    expect(segments[0]).toHaveAccessibleName(
      /Opening.*7s.*workspace\.cut\.beatPosition.*workspace\.table\.state\.ready/
    );
    expect(segments[0]?.parentElement).toHaveAttribute('data-state', 'ready');
    expect(segments[1]?.parentElement).toHaveAttribute('data-state', 'no_coverage');
    expect(within(rail).queryByLabelText(/workspace\.cut\.(dragHandle|moveEarlier|moveLater)/)).toBeNull();
    expect(rail).not.toHaveTextContent('1 Shot');

    const selection = document.querySelector<HTMLElement>('[data-cut-filmstrip-selection]');
    expect(selection).not.toBeNull();
    expect(selection).toHaveTextContent('Opening');
    expect(selection).toHaveTextContent('1 Shot');
    expect(within(selection!).getAllByRole('button')).toHaveLength(3);
  });

  it('keeps a populated nine-Beat film in one proportional strip', () => {
    const beats = Array.from({ length: 9 }, (_, index) => ({
      id: `beat_${index + 1}`,
      title: `Beat ${index + 1}`,
      shotCount: 1,
      durationKind: 'actual' as const,
      durationSeconds: index + 1,
      coverAssetId: null,
    }));
    renderCut({ cutProjection: cut({ beats, filmDurationSeconds: 45 }) });

    const rail = screen.getByRole('list', { name: 'conversation.creativeStudio.workspace.cut.railLabel' });
    const segments = Array.from(rail.querySelectorAll<HTMLElement>(':scope > [data-beat-id]'));
    expect(segments).toHaveLength(9);
    expect(segments.map((segment) => segment.style.flexGrow)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(within(rail).getAllByRole('button')).toHaveLength(9);
  });

  it('fuses the compact 64px structure strip to an 18px authoritative seek rail', () => {
    renderCut();
    const css = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/Cut.module.css'
      ),
      'utf8'
    );

    expect(css).toMatch(/\.rail\s*\{[^}]*box-sizing:\s*border-box[^}]*block-size:\s*64px/s);
    expect(css).toMatch(/\.seekRail\s*\{[^}]*block-size:\s*18px/s);
    expect(document.querySelector('[data-cut-filmstrip]')).not.toBeNull();
    expect(document.querySelector('[data-cut-seek-rail]')).not.toBeNull();
    const sliderRoot = document.querySelector('[data-cut-seek]');
    const sliderHandle = screen.getByRole('slider', { name: 'Film seek rail' });
    expect(sliderRoot).not.toHaveAttribute('aria-label');
    expect(sliderRoot).toContainElement(sliderHandle);
    expect(css).toMatch(/\.rail\s*\{[^}]*gap:\s*0/s);
    expect(css).toMatch(/\.beatTitle\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).not.toMatch(/\.beatTitle\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('seeks video and slate time from the fused rail while Beat-body selection never seeks', () => {
    const current = playableProjection();
    renderCut({ cutProjection: current.cut, activeBeats: current.activeBeats });
    const seek = screen.getByRole('slider', { name: 'Film seek rail' });
    const firstVideo = mediaElement();

    fireEvent.click(within(document.querySelector('[data-beat-id="beat_3"]')!).getByRole('button'));
    expect(seek).toHaveValue('0');
    expect(mediaElement()).toBe(firstVideo);

    fireEvent.change(seek, { target: { value: '12' } });
    expect(document.querySelector('[data-media-kind="slate"]')).not.toBeNull();
    expect(screen.getByText('0:12 / 0:23')).toBeVisible();

    fireEvent.change(seek, { target: { value: '18' } });
    const soughtVideo = mediaElement();
    expect(soughtVideo).not.toBe(firstVideo);
    expect(soughtVideo).toHaveAttribute('src', 'weprompt-studio://asset/project_1/take_3');
    expect(screen.getByText('Loading preview frame')).toBeVisible();
    setMediaNumber(soughtVideo, 'duration', 8);
    fireEvent.loadedMetadata(soughtVideo);
    expect(soughtVideo.currentTime).toBe(2.5);
    fireEvent.seeked(soughtVideo);
    expect(screen.queryByText('Loading preview frame')).toBeNull();
  });

  it('preserves play through slate and video seeks and ignores native events from the displaced media epoch', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const current = playableProjection();
    renderCut({ cutProjection: current.cut, activeBeats: current.activeBeats });
    const seek = screen.getByRole('slider', { name: 'Film seek rail' });
    const firstVideo = mediaElement();
    setMediaNumber(firstVideo, 'duration', 10);
    fireEvent.loadedMetadata(firstVideo);
    fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
    await act(async () => Promise.resolve());

    fireEvent.change(seek, { target: { value: '12' } });
    expect(screen.getByRole('button', { name: 'Pause film' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-media-kind="slate"]')).not.toBeNull();
    fireEvent.error(firstVideo);
    expect(document.querySelector('[data-media-kind="slate"]')).not.toBeNull();
    expect(screen.getByRole('status')).not.toHaveTextContent('This preview could not be loaded.');

    fireEvent.change(seek, { target: { value: '18' } });
    const soughtVideo = mediaElement();
    let currentTime = 0;
    let seeking = false;
    Object.defineProperty(soughtVideo, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        seeking = true;
      },
    });
    Object.defineProperty(soughtVideo, 'seeking', { configurable: true, get: () => seeking });
    setMediaNumber(soughtVideo, 'duration', 8);
    fireEvent.loadedMetadata(soughtVideo);
    expect(currentTime).toBe(2.5);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Loading preview frame')).toBeVisible();

    seeking = false;
    fireEvent.seeked(soughtVideo);
    await act(async () => Promise.resolve());
    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalled();
    expect(screen.queryByText('Loading preview frame')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause film' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lands join navigation 1.5 seconds before Beat boundaries, loops plus or minus two seconds, and scopes shortcuts', () => {
    const current = playableProjection();
    renderCut({ cutProjection: current.cut, activeBeats: current.activeBeats });
    const root = screen.getByRole('region', { name: 'conversation.creativeStudio.workspace.cut.ariaLabel' });
    const seek = screen.getByRole('slider', { name: 'Film seek rail' });

    fireEvent.keyDown(root, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Pause film' })).toBeVisible();
    fireEvent.keyDown(root, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Play film' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next join' }));
    expect(seek).toHaveValue('9.5');
    fireEvent.click(screen.getByRole('button', { name: 'Loop join' }));
    expect(seek).toHaveValue('9');
    expect(screen.getByRole('button', { name: 'Loop join' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(seek).toHaveValue('10');
    fireEvent.keyDown(root, { key: 'ArrowRight', shiftKey: true });
    expect(seek).toHaveValue('10.2');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next join' }), { key: 'ArrowRight' });
    expect(seek).toHaveValue('10.2');
  });

  it('disables and no-ops join navigation at the first and final landing', () => {
    const current = playableProjection();
    renderCut({ cutProjection: current.cut, activeBeats: current.activeBeats });
    const seek = screen.getByRole('slider', { name: 'Film seek rail' });
    const previous = screen.getByRole('button', { name: 'Previous join' });
    const next = screen.getByRole('button', { name: 'Next join' });

    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(previous);
    expect(seek).toHaveValue('0');

    fireEvent.click(next);
    expect(seek).toHaveValue('9.5');
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(seek).toHaveValue('14.5');
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(seek).toHaveValue('14.5');

    fireEvent.click(previous);
    expect(seek).toHaveValue('9.5');
    expect(previous).toBeDisabled();
  });

  it('wraps a playing slate-only Cut at the plus-two side of the selected Beat join', () => {
    vi.useFakeTimers();
    const activeBeats = [
      playbackBeat('beat_a', 'A', [], 5),
      playbackBeat('beat_b', 'B', [], 5),
      playbackBeat('beat_c', 'C', [], 5),
    ];
    const cutProjection = cut({
      beats: activeBeats.map((beat) => ({
        id: beat.id,
        title: beat.title,
        shotCount: 0,
        durationKind: 'target' as const,
        durationSeconds: 5,
        coverAssetId: null,
      })),
      filmDurationSeconds: 15,
      coverCandidates: [],
    });
    renderCut({ activeBeats, cutProjection });
    const seek = screen.getByRole('slider', { name: 'Film seek rail' });

    fireEvent.click(screen.getByRole('button', { name: 'Loop join' }));
    expect(seek).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
    act(() => vi.advanceTimersByTime(2_000));
    act(() => vi.advanceTimersByTime(2_100));
    expect(Number((seek as HTMLInputElement).value)).toBeLessThanOrEqual(3.2);
    expect(screen.getByRole('button', { name: 'Loop join' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restarts a playing slate clock after a same-slate seek', () => {
    vi.useFakeTimers();
    const activeBeats = [playbackBeat('beat_a', 'A', [], 10)];
    const cutProjection = cut({
      beats: [
        {
          id: 'beat_a',
          title: 'A',
          shotCount: 0,
          durationKind: 'target',
          durationSeconds: 10,
          coverAssetId: null,
        },
      ],
      filmDurationSeconds: 10,
      coverCandidates: [],
    });
    renderCut({ activeBeats, cutProjection });
    const root = screen.getByRole('region', { name: 'conversation.creativeStudio.workspace.cut.ariaLabel' });
    const seek = screen.getByRole('slider', { name: 'Film seek rail' });

    fireEvent.click(screen.getByRole('button', { name: 'Play film' }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(seek).toHaveValue('1');
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(seek).toHaveValue('2');
    act(() => vi.advanceTimersByTime(1_000));
    expect(seek).toHaveValue('3');
  });

  it('opens both the selected and the uncovered Beat', () => {
    const onOpenBeat = vi.fn();
    renderCut({ onOpenBeat });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.cut.openBeat' }));
    expect(onOpenBeat).toHaveBeenCalledWith('beat_1');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.cut.slate.openBeat' }));
    expect(onOpenBeat).toHaveBeenCalledWith('beat_2');
  });

  it('draws the selected bed as a silent extent against the authoritative film duration', () => {
    renderCut();
    const extent = document.querySelector('[data-cut-bed-extent]');
    expect(extent).toHaveAttribute('data-source-seconds', '14');
    expect(extent).toHaveAttribute('data-film-seconds', '11');
    expect(extent).toHaveTextContent('From 0:00 · 14s extent');
    expect(extent).toHaveTextContent('conversation.creativeStudio.workspace.cut.bed.silentPreview');
    expect(extent?.querySelector('[data-bed-film-extent]')).not.toBeNull();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('reorders by keyboard, contextual controls, and drag with exact serialization and repeat focus', async () => {
    let finish!: (value: boolean) => void;
    const cutActions = actions();
    vi.mocked(cutActions.reorderBeats).mockReturnValueOnce(
      new Promise<boolean>((resolvePromise) => {
        finish = resolvePromise;
      })
    );
    renderCut({ actions: cutActions });
    const first = document.querySelector<HTMLElement>('[data-beat-id="beat_1"]')!;
    const segment = within(first).getByRole('button');
    const selection = document.querySelector<HTMLElement>('[data-cut-filmstrip-selection]')!;
    const moveLater = within(selection).getByLabelText(/workspace\.cut\.moveLater/);

    fireEvent.keyDown(segment, { key: 'ArrowDown' });
    fireEvent.keyDown(segment, { key: 'ArrowDown' });
    expect(cutActions.reorderBeats).toHaveBeenCalledTimes(1);
    expect(cutActions.reorderBeats).toHaveBeenCalledWith(['beat_2', 'beat_1']);
    finish(true);
    await waitFor(() => expect(segment).toHaveFocus());
    expect(screen.getByText(/workspace\.cut\.reorderAnnouncement/)).toBeInTheDocument();

    fireEvent.click(moveLater);
    await waitFor(() => expect(cutActions.reorderBeats).toHaveBeenCalledTimes(2));
    expect(cutActions.reorderBeats).toHaveBeenNthCalledWith(2, ['beat_2', 'beat_1']);
    await waitFor(() => expect(segment).toHaveFocus());

    const dataTransfer = { effectAllowed: '', setData: vi.fn() };
    fireEvent.dragStart(segment, { dataTransfer });
    fireEvent.dragOver(document.querySelector('[data-beat-id="beat_2"]')!, { dataTransfer });
    fireEvent.drop(document.querySelector('[data-beat-id="beat_2"]')!, { dataTransfer });
    await waitFor(() => expect(cutActions.reorderBeats).toHaveBeenCalledTimes(3));
  });

  it('routes bed selection through exact values and keeps import cancellation inert', async () => {
    const cutActions = renderCut();
    const bed = screen.getByLabelText('conversation.creativeStudio.workspace.cut.bed.label');
    fireEvent.change(bed, { target: { value: 'audio_old' } });
    await waitFor(() => expect(cutActions.setBed).toHaveBeenCalledWith('audio_old'));
    fireEvent.change(bed, { target: { value: '' } });
    await waitFor(() => expect(cutActions.setBed).toHaveBeenCalledWith(null));

    fireEvent.click(screen.getByText('conversation.creativeStudio.workspace.cut.bed.import'));
    await waitFor(() => expect(cutActions.importBedAudio).toHaveBeenCalledTimes(1));
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.bed.importCancelled')).toBeInTheDocument();
  });

  it('announces success, refusal, cancellation, and provider failure across film-level actions', async () => {
    const cutActions = actions();
    vi.mocked(cutActions.importBedAudio).mockResolvedValueOnce('imported').mockRejectedValueOnce(new Error('closed'));
    vi.mocked(cutActions.setBed).mockResolvedValueOnce(false);
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
        coverCandidates: [],
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
      }),
      exportCatalog: null,
    });

    expect(screen.getByText('conversation.creativeStudio.workspace.cut.orderUnavailable')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.cut.bed.invalid')).toBeVisible();
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
    expect(source).toContain('onOpenBeat');
    expect(source).toContain('.openBeat');
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

  it('keeps provider precision in the film model until the display boundary', () => {
    const summary = buildCutFilmSummary({
      beats: [beat(1, 15.069002)],
      filmDurationSeconds: 178.069002,
      targetDurationSeconds: 18,
    });

    expect(summary.filmSeconds).toBe(178.069002);
    expect(summary.delta).toEqual({ kind: 'over', seconds: 160.069002 });
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

describe('the filmstrip', () => {
  const stripBeat = (
    id: string,
    title: string,
    durationSeconds: number | null
  ): WorkspaceCutProjection['beats'][number] => ({
    id,
    title,
    shotCount: durationSeconds === null ? 0 : 2,
    durationKind: durationSeconds === null ? 'pending' : 'actual',
    durationSeconds,
    coverAssetId: null,
  });

  it('lays every Beat out in play order at a width proportional to its length', () => {
    // The design gives each segment `flex: <seconds> 1 0%`, so the grow factor is the duration
    // itself and the strip needs no pixel arithmetic to stay proportional.
    const strip = buildCutFilmstrip({
      beats: [
        stripBeat('beat_1', 'Cold open', 14),
        stripBeat('beat_2', 'Squad building', 22),
        stripBeat('beat_3', 'Sign-off', 9),
      ],
    });

    expect(strip).toEqual([
      {
        beatId: 'beat_1',
        position: 1,
        label: '01',
        title: 'Cold open',
        durationSeconds: 14,
        growFactor: 14,
      },
      {
        beatId: 'beat_2',
        position: 2,
        label: '02',
        title: 'Squad building',
        durationSeconds: 22,
        growFactor: 22,
      },
      { beatId: 'beat_3', position: 3, label: '03', title: 'Sign-off', durationSeconds: 9, growFactor: 9 },
    ]);
  });

  it('pads the position past nine without truncating it past ninety-nine', () => {
    const beats = Array.from({ length: 100 }, (_, index) => stripBeat(`beat_${index}`, 'Beat', 1));
    const strip = buildCutFilmstrip({ beats });
    expect(strip?.[8]?.label).toBe('09');
    expect(strip?.[9]?.label).toBe('10');
    expect(strip?.[99]?.label).toBe('100');
  });

  it('refuses to lay out a strip when any Beat has no length to occupy', () => {
    // A proportional strip cannot place a Beat of unknown length. Rendering the rest would show a
    // film shorter than it is, which is the one thing the Cut must not do.
    expect(
      buildCutFilmstrip({ beats: [stripBeat('beat_1', 'Cold open', 14), stripBeat('beat_2', 'Pending', null)] })
    ).toBeNull();
  });

  it('refuses a Beat whose length is not a usable number', () => {
    expect(buildCutFilmstrip({ beats: [stripBeat('beat_1', 'Cold open', Number.NaN)] })).toBeNull();
    expect(buildCutFilmstrip({ beats: [stripBeat('beat_1', 'Cold open', -4)] })).toBeNull();
  });
});

describe('slate warnings', () => {
  const wBeat = (
    id: string,
    shotCount: number,
    durationSeconds: number | null
  ): WorkspaceCutProjection['beats'][number] => ({
    id,
    title: 'Beat',
    shotCount,
    durationKind: shotCount > 0 ? 'actual' : durationSeconds === null ? 'pending' : 'target',
    durationSeconds,
    coverAssetId: null,
  });

  it('names each uncovered Beat by its play position and the length it will export as', () => {
    const warnings = buildCutSlateWarnings({
      beats: [wBeat('beat_1', 2, 14), wBeat('beat_2', 0, 24), wBeat('beat_3', 1, 9), wBeat('beat_4', 0, 6)],
    });

    expect(warnings).toEqual([
      { beatId: 'beat_2', position: 2, label: '02', durationSeconds: 24 },
      { beatId: 'beat_4', position: 4, label: '04', durationSeconds: 6 },
    ]);
  });

  it('keeps positions counted against the whole film, not against the warnings', () => {
    // The badge reads BEAT 05 because it is the fifth Beat in the film, not the first warning.
    const beats = [wBeat('a', 1, 5), wBeat('b', 1, 5), wBeat('c', 1, 5), wBeat('d', 1, 5), wBeat('e', 0, 24)];
    expect(buildCutSlateWarnings({ beats })).toEqual([{ beatId: 'e', position: 5, label: '05', durationSeconds: 24 }]);
  });

  it('omits a Beat that has no length to export yet', () => {
    expect(buildCutSlateWarnings({ beats: [wBeat('beat_1', 0, null)] })).toEqual([]);
  });

  it('omits a covered Beat even when its length is unusable', () => {
    expect(buildCutSlateWarnings({ beats: [wBeat('beat_1', 3, Number.NaN)] })).toEqual([]);
  });
});

describe('the Cut renders the film it is judging', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the film clock, the target it is judged against, and the gap between them', () => {
    renderCut({ cutProjection: cut({ filmDurationSeconds: 178, targetDurationSeconds: 180 }) });

    const panel = document.querySelector('[data-cut-film]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('2:58');
    expect(panel?.textContent).toContain('3:00');
    expect(panel?.textContent).toContain('0:02 under');
    expect(panel?.getAttribute('data-film-delta')).toBe('under');
  });

  it('pluralizes the film Beat, Shot, and slate counts independently', () => {
    renderCut();

    expect(document.querySelector('[data-cut-film]')).toHaveTextContent('2 Beats · 1 Shot · 1 Slate');
  });

  it('marks a film that runs past its target', () => {
    renderCut({ cutProjection: cut({ filmDurationSeconds: 200, targetDurationSeconds: 180 }) });
    const panel = document.querySelector('[data-cut-film]');
    expect(panel).toHaveTextContent('0:20 over');
    expect(panel?.getAttribute('data-film-delta')).toBe('over');
  });

  it('states no gap rather than an on-target one when the target is unknown', () => {
    renderCut({ cutProjection: cut({ filmDurationSeconds: 178, targetDurationSeconds: null }) });
    expect(document.querySelector('[data-cut-film]')?.getAttribute('data-film-delta')).toBe('unknown');
  });

  it('sizes each Beat in the rail in proportion to its length', () => {
    renderCut({ cutProjection: cut({ filmDurationSeconds: 11, targetDurationSeconds: 12 }) });

    const first = document.querySelector<HTMLElement>('[data-beat-id="beat_1"]');
    const second = document.querySelector<HTMLElement>('[data-beat-id="beat_2"]');
    // beat_1 runs 7s and beat_2 runs 4s, so the grow factors are the durations themselves.
    expect(first?.style.flexGrow).toBe('7');
    expect(second?.style.flexGrow).toBe('4');

    // jsdom does not lay out, so the grow factor alone proves nothing: it is inert in a grid
    // container, which is what the rail used to be. Assert the container it lands in is a flex one.
    const css = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/Cut.module.css'
      ),
      'utf8'
    );
    expect(css).toMatch(/\.rail\s*\{[^}]*display:\s*flex/);
    expect(css).not.toMatch(/\.rail\s*\{[^}]*display:\s*grid/);
  });

  it('does not size the rail when any Beat has no length to occupy', () => {
    const beats = cut().beats.map((beat, index) => (index === 1 ? { ...beat, durationSeconds: null } : beat));
    renderCut({ cutProjection: cut({ beats, filmDurationSeconds: null }) });
    expect(document.querySelector<HTMLElement>('[data-beat-id="beat_1"]')?.style.flexGrow).toBe('');
    expect(document.querySelector<HTMLElement>('[data-beat-id="beat_2"]')?.style.flexGrow).toBe('');
    expect(screen.getByRole('list', { name: 'conversation.creativeStudio.workspace.cut.railLabel' })).toHaveTextContent(
      'conversation.creativeStudio.workspace.cut.beatDurationPending'
    );
  });

  it('badges every uncovered Beat with its film position and the slate it will export', () => {
    renderCut({ cutProjection: cut({ filmDurationSeconds: 11, targetDurationSeconds: 12 }) });

    const slates = document.querySelectorAll('[data-cut-slate]');
    // Only beat_2 is uncovered, and it is the second Beat in the film.
    expect(slates).toHaveLength(1);
    expect(slates[0]?.getAttribute('data-slate-beat-id')).toBe('beat_2');
    expect(slates[0]?.textContent).toContain('02');
  });
});
