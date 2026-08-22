/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceShotProjection } from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'conversation.creativeStudio.workspace.beatPanel.coverage.label': 'Coverage',
        'conversation.creativeStudio.workspace.beatPanel.coverage.empty': 'No shots to cover',
        'conversation.creativeStudio.workspace.beatPanel.coverage.unavailable': 'Coverage unavailable',
        'conversation.creativeStudio.workspace.beatPanel.coverage.playbackLane': 'Playback lane',
        'conversation.creativeStudio.workspace.beatPanel.coverage.planningLane': 'Planning lane',
        'conversation.creativeStudio.workspace.beatPanel.coverage.trimGuidance': 'Edge · Trim · Free',
        'conversation.creativeStudio.workspace.beatPanel.coverage.boundaryGuidance': 'Boundary · Costs a re-render',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.noTake': 'No Take',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.queued': 'Queued',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.nextUp': 'Next up',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.waitingOnFrame': 'Waiting on the frame',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.renderingStill':
          'Rendering · Showing the still',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.rendered': 'Rendered',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.renderedOneTake': 'Rendered · 1 Take',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.untouched': 'Untouched',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.needsRerender': 'Needs a re-render',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.staleStillPlays': 'Stale · Still plays',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.failedNotBilled': 'Failed · Not billed',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.neverDispatched': 'Never dispatched',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.statusPending': 'Status unavailable',
        'conversation.creativeStudio.workspace.beatPanel.coverage.segmentState.needsAttention': 'Needs attention',
        'conversation.creativeStudio.workspace.beatPanel.coverage.seekGuidance': 'Rail · Seek · Free',
        'conversation.creativeStudio.workspace.beatPanel.coverage.seekLane': 'Beat seek rail',
        'conversation.creativeStudio.workspace.beatPanel.coverage.tailTrimWarning':
          'Tail trim makes the next Shot stale',
      };
      if (key.endsWith('.shotLabel')) return `Shot ${String(values?.index)}`;
      if (key.endsWith('.sourceDuration')) return `${String(values?.seconds)}s source`;
      if (key.endsWith('.planningDuration')) return `${String(values?.seconds)}s plan`;
      if (key.endsWith('.trimInLabel')) return `Trim in Shot ${String(values?.index)}`;
      if (key.endsWith('.trimOutLabel')) return `Trim out Shot ${String(values?.index)}`;
      if (key.endsWith('.trimValue')) return `${String(values?.seconds)}s trimmed`;
      if (key.endsWith('.seekValue')) return `${String(values?.current)} of ${String(values?.total)}`;
      if (key.endsWith('.segmentState.waitingOnShot')) return `Waiting on ${String(values?.position)}`;
      if (key.endsWith('.segmentState.renderingProgress')) return `Rendering · ${String(values?.progress)}%`;
      if (key.endsWith('.segmentState.selectedTake')) {
        return `${String(values?.count)} Takes · T${String(values?.take)} in the Cut`;
      }
      if (key.endsWith('.segmentState.shotKept')) return `Shot ${String(values?.position)} · Kept`;
      if (key.endsWith('.boundaryFrame.empty')) {
        return `Boundary after Shot ${String(values?.position)} · Waiting for continuity frame`;
      }
      if (key.endsWith('.boundaryFrame.ready')) {
        return `Boundary after Shot ${String(values?.position)} · Continuity frame ready`;
      }
      if (key.endsWith('.boundaryFrame.gone')) {
        return `Boundary after Shot ${String(values?.position)} · Continuity frame missing`;
      }
      if (key.endsWith('.boundaryFrame.stale')) {
        return `Boundary after Shot ${String(values?.position)} · Continuity frame is out of date`;
      }
      if (key.endsWith('.boundaryLabel')) return `Boundary after Shot ${String(values?.index)}`;
      if (key.endsWith('.boundaryValue')) return `${String(values?.seconds)}s left`;
      if (key.endsWith('.boundaryAnnouncement')) {
        return `${String(values?.leftSeconds)}s left, ${String(values?.rightSeconds)}s right`;
      }
      if (key.endsWith('.trimAnnouncement')) {
        return `${String(values?.trimInSeconds)}s in, ${String(values?.trimOutSeconds)}s out`;
      }
      return copy[key] ?? key;
    },
  }),
}));

import {
  CoverageBar,
  buildCoverageGeometry,
  clampCoverageTrim,
  coverageDensityForWidth,
  coveragePlanningPairBounds,
  coveragePointerDeltaSeconds,
  coveragePointerPositionSeconds,
  coverageSeekLaneRatio,
  coverageSeekPositionSeconds,
  maximumCoverageTrim,
  resizeCoveragePlanningPair,
} from '@/renderer/pages/studio/components/Workspace/BeatPanel';

let resizeCallback: ResizeObserverCallback | null = null;
let resizeObserverDisconnect = vi.fn();

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  disconnect = resizeObserverDisconnect;
  observe = vi.fn();
  unobserve = vi.fn();
}

const rectangle = (width: number): DOMRect =>
  ({
    bottom: 0,
    height: 20,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

const cssRuleBody = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? '';
};

const mockDirection = (direction: 'ltr' | 'rtl') => {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const computedStyle = originalGetComputedStyle(element, pseudoElement);
    return new Proxy(computedStyle, {
      get(target, property) {
        if (property === 'direction') return direction;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
};

const installPointerCapture = (element: HTMLElement, captured = true) => {
  const setPointerCapture = vi.fn();
  const hasPointerCapture = vi.fn(() => captured);
  const releasePointerCapture = vi.fn();
  Object.assign(element, { setPointerCapture, hasPointerCapture, releasePointerCapture });
  return { setPointerCapture, hasPointerCapture, releasePointerCapture };
};

const makeShot = (
  id: string,
  durationSeconds: number,
  startSeconds: number,
  overrides: Partial<WorkspaceShotProjection> = {}
): WorkspaceShotProjection => ({
  id,
  line: `Line ${id}`,
  narration: '',
  onScreenText: '',
  durationSeconds,
  chainBreak: startSeconds === 0 ? 'hard_cut' : 'none',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  derivationStale: false,
  trimInSeconds: null,
  trimOutSeconds: null,
  selectedTakeId: null,
  selectedTakeSourceDurationSeconds: null,
  playedDurationSeconds: durationSeconds,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  segmentHead: startSeconds === 0,
  planningBoundary: { shotId: id, startSeconds, endSeconds: startSeconds + durationSeconds },
  frameBoundary: null,
  segmentState:
    overrides.segmentState ??
    (overrides.selectedTakeId === undefined || overrides.selectedTakeId === null
      ? { kind: 'no_take' }
      : { kind: 'rendered', takeCount: 1, selectedTakeNumber: 1 }),
  dirtyCauses: [],
  downstreamShotIds: [],
  imageTakes: [],
  videoTakes: [],
  coverAssetId: null,
  takeCount: 0,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  hasEffectiveSeed: false,
  ...overrides,
});

const makeSelectedShot = (overrides: Partial<WorkspaceShotProjection> = {}): WorkspaceShotProjection =>
  makeShot('shot_1', 8, 0, {
    selectedTakeId: 'take_1',
    selectedTakeSourceDurationSeconds: 10,
    trimInSeconds: 1,
    trimOutSeconds: 1,
    playedDurationSeconds: 8,
    ...overrides,
  });

const renderCoverage = (
  shots: readonly WorkspaceShotProjection[],
  options: {
    disabled?: boolean;
    inspectedShotId?: string | null;
    onCommitPlanningDurations?: ReturnType<typeof vi.fn>;
    onCommitTrim?: ReturnType<typeof vi.fn>;
    onInspectShot?: ReturnType<typeof vi.fn>;
    playback?: React.ComponentProps<typeof CoverageBar>['playback'];
  } = {}
) => {
  const inspectedShotId = options.inspectedShotId === undefined ? (shots[0]?.id ?? null) : options.inspectedShotId;
  const onCommitPlanningDurations = options.onCommitPlanningDurations ?? vi.fn().mockResolvedValue(true);
  const onCommitTrim = options.onCommitTrim ?? vi.fn().mockResolvedValue(true);
  const onInspectShot = options.onInspectShot ?? vi.fn();
  const result = render(
    <CoverageBar
      disabled={options.disabled ?? false}
      inspectedShotId={inspectedShotId}
      onCommitPlanningDurations={onCommitPlanningDurations}
      onCommitTrim={onCommitTrim}
      onInspectShot={onInspectShot}
      playback={options.playback}
      projectId='project_1'
      shots={shots}
    />
  );
  return { ...result, inspectedShotId, onCommitPlanningDurations, onCommitTrim, onInspectShot };
};

describe('coverage geometry', () => {
  it('keeps selected 10-second playback distinct from its authoritative 8-second planning boundary', () => {
    const geometry = buildCoverageGeometry([
      makeShot('shot_1', 8, 0, {
        selectedTakeId: 'take_1',
        selectedTakeSourceDurationSeconds: 10,
        trimInSeconds: 1,
        trimOutSeconds: 1,
        playedDurationSeconds: 8,
      }),
      makeShot('shot_2', 4, 8),
    ]);

    expect(geometry).toEqual({
      planningTotalSeconds: 12,
      playbackTotalSeconds: 14,
      segments: [
        {
          shotId: 'shot_1',
          planningStartSeconds: 0,
          planningEndSeconds: 8,
          planningDurationSeconds: 8,
          playbackWidthSeconds: 10,
          playedStartSeconds: 1,
          playedEndSeconds: 9,
          playedDurationSeconds: 8,
          selectedTake: true,
        },
        {
          shotId: 'shot_2',
          planningStartSeconds: 8,
          planningEndSeconds: 12,
          planningDurationSeconds: 4,
          playbackWidthSeconds: 4,
          playedStartSeconds: 0,
          playedEndSeconds: 4,
          playedDurationSeconds: 4,
          selectedTake: false,
        },
      ],
    });
  });

  it('fails closed on missing, non-dense, unprobed, contradictory, and impossible geometry facts', () => {
    expect(buildCoverageGeometry([])).toEqual({ segments: [], planningTotalSeconds: 0, playbackTotalSeconds: 0 });
    expect(buildCoverageGeometry([makeShot('shot_1', 8, 0, { planningBoundary: null })])).toBeNull();
    expect(buildCoverageGeometry([makeShot('shot_1', 8, 1)])).toBeNull();
    expect(
      buildCoverageGeometry([
        makeShot('shot_1', 8, 0, { selectedTakeId: 'take_1', selectedTakeSourceDurationSeconds: null }),
      ])
    ).toBeNull();
    expect(buildCoverageGeometry([makeShot('shot_1', 8, 0, { trimInSeconds: 0.5 })])).toBeNull();
    expect(
      buildCoverageGeometry([
        makeShot('shot_1', 8, 0, {
          selectedTakeId: 'take_1',
          selectedTakeSourceDurationSeconds: 8,
          trimInSeconds: 4,
          trimOutSeconds: 4,
          playedDurationSeconds: 0,
        }),
      ])
    ).toBeNull();
    expect(buildCoverageGeometry([makeShot('shot_1', 8, 0, { playedDurationSeconds: 7 })])).toBeNull();
  });

  it('preserves an adjacent integer pair total while clamping both Shots to 4..15 seconds', () => {
    expect(coveragePlanningPairBounds(8, 8)).toEqual({ minimumLeftSeconds: 4, maximumLeftSeconds: 12 });
    expect(coveragePlanningPairBounds(4, 4)).toEqual({ minimumLeftSeconds: 4, maximumLeftSeconds: 4 });
    expect(
      resizeCoveragePlanningPair({
        leftShotId: 'left',
        leftDurationSeconds: 8,
        rightShotId: 'right',
        rightDurationSeconds: 8,
        deltaSeconds: 100,
      })
    ).toEqual([
      { shotId: 'left', durationSeconds: 12 },
      { shotId: 'right', durationSeconds: 4 },
    ]);
    expect(
      resizeCoveragePlanningPair({
        leftShotId: 'left',
        leftDurationSeconds: 8,
        rightShotId: 'right',
        rightDurationSeconds: 8,
        deltaSeconds: -100,
      })
    ).toEqual([
      { shotId: 'left', durationSeconds: 4 },
      { shotId: 'right', durationSeconds: 12 },
    ]);
    expect(
      resizeCoveragePlanningPair({
        leftShotId: 'same',
        leftDurationSeconds: 8,
        rightShotId: 'same',
        rightDurationSeconds: 8,
        deltaSeconds: 1,
      })
    ).toBeNull();
    expect(coveragePlanningPairBounds(3, 8)).toBeNull();
  });

  it('snaps trims to half-seconds, leaves one played second, and mirrors physical pointer deltas in RTL', () => {
    expect(maximumCoverageTrim(10, 1.5)).toBe(7.5);
    expect(clampCoverageTrim({ sourceDurationSeconds: 10, oppositeTrimSeconds: 1.5, requestedTrimSeconds: 2.26 })).toBe(
      2.5
    );
    expect(clampCoverageTrim({ sourceDurationSeconds: 10, oppositeTrimSeconds: 1.5, requestedTrimSeconds: 99 })).toBe(
      7.5
    );
    expect(clampCoverageTrim({ sourceDurationSeconds: 1, oppositeTrimSeconds: 1, requestedTrimSeconds: 0 })).toBeNull();
    expect(
      coveragePointerDeltaSeconds({
        clientX: 75,
        startClientX: 25,
        trackWidthPixels: 100,
        trackSeconds: 10,
        rtl: false,
      })
    ).toBe(5);
    expect(
      coveragePointerDeltaSeconds({
        clientX: 75,
        startClientX: 25,
        trackWidthPixels: 100,
        trackSeconds: 10,
        rtl: true,
      })
    ).toBe(-5);
    expect(
      coveragePointerDeltaSeconds({
        clientX: 75,
        startClientX: 25,
        trackWidthPixels: 0,
        trackSeconds: 10,
        rtl: false,
      })
    ).toBeNull();
    expect(
      coveragePointerPositionSeconds({
        clientX: 75,
        trackLeftPixels: 25,
        trackWidthPixels: 100,
        durationSeconds: 20,
        rtl: false,
      })
    ).toBe(10);
    expect(
      coveragePointerPositionSeconds({
        clientX: 75,
        trackLeftPixels: 25,
        trackWidthPixels: 100,
        durationSeconds: 20,
        rtl: true,
      })
    ).toBe(10);
    expect(
      coveragePointerPositionSeconds({
        clientX: 200,
        trackLeftPixels: 25,
        trackWidthPixels: 100,
        durationSeconds: 20,
        rtl: false,
      })
    ).toBe(20);
  });

  it('uses the narrowest measured segment for exact density thresholds without a presentation label', () => {
    expect(coverageDensityForWidth(87, [1])).toBe('narrow');
    expect(coverageDensityForWidth(88, [1])).toBe('medium');
    expect(coverageDensityForWidth(150, [1])).toBe('medium');
    expect(coverageDensityForWidth(151, [1])).toBe('wide');
    expect(coverageDensityForWidth(400, [3, 1])).toBe('medium');
    expect(coverageDensityForWidth(0, [1])).toBe('narrow');
  });

  it('maps Beat time piecewise through trims so the seek head and pointer align with source-width segments', () => {
    const geometry = buildCoverageGeometry([
      makeShot('shot_1', 8, 0, {
        selectedTakeId: 'take_1',
        selectedTakeSourceDurationSeconds: 10,
        trimInSeconds: 4,
        trimOutSeconds: 4,
        playedDurationSeconds: 2,
      }),
      makeShot('shot_2', 10, 8),
    ])!;

    expect(coverageSeekLaneRatio(geometry, 1)).toBe(0.25);
    expect(coverageSeekLaneRatio(geometry, 2)).toBe(0.5);
    expect(coverageSeekLaneRatio(geometry, 7)).toBe(0.75);
    expect(
      coverageSeekPositionSeconds({
        clientX: 25,
        trackLeftPixels: 0,
        trackWidthPixels: 100,
        geometry,
        rtl: false,
      })
    ).toBe(1);
    expect(
      coverageSeekPositionSeconds({
        clientX: 40,
        trackLeftPixels: 0,
        trackWidthPixels: 100,
        geometry,
        rtl: false,
      })
    ).toBe(2);
    expect(
      coverageSeekPositionSeconds({
        clientX: 25,
        trackLeftPixels: 0,
        trackWidthPixels: 100,
        geometry,
        rtl: true,
      })
    ).toBe(7);
  });
});

describe('CoverageBar', () => {
  beforeEach(() => {
    resizeCallback = null;
    resizeObserverDisconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });

  it('renders named empty and fail-closed states', () => {
    const empty = renderCoverage([]);
    expect(screen.getByRole('region', { name: 'Coverage' })).toHaveTextContent('No shots to cover');
    empty.rerender(
      <CoverageBar
        disabled={false}
        inspectedShotId={empty.inspectedShotId}
        onCommitPlanningDurations={empty.onCommitPlanningDurations}
        onCommitTrim={empty.onCommitTrim}
        onInspectShot={empty.onInspectShot}
        projectId='project_1'
        shots={[makeShot('shot_1', 8, 0, { planningBoundary: null })]}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Coverage unavailable');
  });

  it('keeps Shot inspection reachable when malformed coverage fails closed', () => {
    const onCommitPlanningDurations = vi.fn().mockResolvedValue(true);
    const onCommitTrim = vi.fn().mockResolvedValue(true);
    const onInspectShot = vi.fn();
    renderCoverage([makeShot('shot_1', 8, 0, { planningBoundary: null }), makeShot('shot_2', 8, 8)], {
      inspectedShotId: 'shot_1',
      onCommitPlanningDurations,
      onCommitTrim,
      onInspectShot,
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Coverage unavailable');
    const selectors = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('data-coverage-shot-selector'));
    expect(selectors).toHaveLength(2);
    expect(selectors[0]).toHaveAttribute('aria-pressed', 'true');
    expect(selectors[1]).toHaveAttribute('aria-pressed', 'false');
    const firstState = selectors[0]!.querySelector<HTMLElement>('[data-segment-state]');
    if (firstState === null) throw new Error('Malformed coverage selector did not retain its state row');
    expect(firstState.parentElement).not.toBe(selectors[0]);
    expect(firstState.parentElement?.className).toMatch(/segmentMeta/);
    fireEvent.click(selectors[1]!);
    expect(onInspectShot).toHaveBeenCalledWith('shot_2');
    expect(onCommitPlanningDurations).not.toHaveBeenCalled();
    expect(onCommitTrim).not.toHaveBeenCalled();
  });

  it('renders 10-second selected playback with a separate 8-second planning overlay and no density label', () => {
    renderCoverage([
      makeShot('shot_1', 8, 0, {
        selectedTakeId: 'take_1',
        selectedTakeSourceDurationSeconds: 10,
        playedDurationSeconds: 10,
      }),
      makeShot('shot_2', 8, 8),
    ]);
    expect(screen.getByRole('group', { name: 'Playback lane' })).toHaveTextContent('10s source');
    expect(screen.getByRole('group', { name: 'Planning lane' })).toHaveTextContent('8s plan');
    expect(screen.queryByText(/^(narrow|medium|wide)$/i)).not.toBeInTheDocument();

    act(() => {
      resizeCallback?.(
        [
          {
            contentRect: rectangle(302),
            target: screen.getByTestId('studio-coverage-playback'),
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      );
    });
    expect(screen.getByTestId('studio-coverage-playback')).toHaveAttribute('data-density', 'medium');
  });

  it('uses a pressed segment button to request the inspected Shot without nesting trim controls', () => {
    const onInspectShot = vi.fn();
    renderCoverage([makeSelectedShot(), makeShot('shot_2', 8, 8)], {
      inspectedShotId: 'shot_2',
      onInspectShot,
    });

    const [firstSelector, secondSelector] = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('data-coverage-shot-selector'));
    expect(firstSelector).toHaveAccessibleName(/Shot 1.*10s source/);
    expect(secondSelector).toHaveAccessibleName(/Shot 2.*8s plan/);
    expect(firstSelector).toHaveAttribute('aria-pressed', 'false');
    expect(secondSelector).toHaveAttribute('aria-pressed', 'true');
    expect(firstSelector).not.toContainElement(screen.getByRole('slider', { name: 'Trim in Shot 1' }));

    fireEvent.click(firstSelector);
    expect(onInspectShot).toHaveBeenCalledTimes(1);
    expect(onInspectShot).toHaveBeenCalledWith('shot_1');
  });

  it.each([
    [{ kind: 'status_pending' } as const, 'Status unavailable'],
    [{ kind: 'no_take' } as const, 'No Take'],
    [{ kind: 'queued' } as const, 'Queued'],
    [{ kind: 'waiting_on_shot', upstreamShotNumber: 1 } as const, 'Waiting on 01'],
    [{ kind: 'waiting_on_frame' } as const, 'Waiting on the frame'],
    [{ kind: 'rendering', progressPercent: null, showingStill: false } as const, 'Rendering'],
    [{ kind: 'rendering', progressPercent: null, showingStill: true } as const, 'Rendering · Showing the still'],
    [{ kind: 'rendering', progressPercent: 39.6, showingStill: true } as const, 'Rendering · 39.6%'],
    [{ kind: 'rendered', takeCount: 1, selectedTakeNumber: 1 } as const, 'Rendered · 1 Take'],
    [{ kind: 'rendered', takeCount: 2, selectedTakeNumber: 2 } as const, '2 Takes · T2 in the Cut'],
    [{ kind: 'rendered', takeCount: 2, selectedTakeNumber: null } as const, 'Rendered'],
    [{ kind: 'needs_rerender' } as const, 'Needs a re-render'],
    [{ kind: 'stale' } as const, 'Stale · Still plays'],
    [{ kind: 'failed_unbilled' } as const, 'Failed · Not billed'],
    [{ kind: 'never_dispatched' } as const, 'Never dispatched'],
    [{ kind: 'needs_attention' } as const, 'Needs attention'],
  ])('renders the exact truthful segment state %#', (segmentState, copy) => {
    renderCoverage([makeShot('shot_1', 8, 0, { segmentState })]);

    const state = screen.getByText(copy);
    expect(state).toHaveAttribute('data-segment-state', segmentState.kind);
    expect(screen.getByRole('button', { name: new RegExp(`Shot 1.*8s plan.*${copy}`) })).toContainElement(state);
  });

  it('keeps stale selected media playable while rendering exact empty, verified, and hard-cut boundary markers', () => {
    const first = makeSelectedShot({ segmentState: { kind: 'stale' } });
    const second = makeShot('shot_2', 8, 8, {
      frameBoundary: {
        upstreamShotId: 'shot_1',
        dependentShotId: 'shot_2',
        status: 'on_disk',
        frameAssetId: 'frame_1',
      },
      segmentState: { kind: 'waiting_on_frame' },
    });
    const third = makeShot('shot_3', 8, 16, {
      frameBoundary: {
        upstreamShotId: 'shot_2',
        dependentShotId: 'shot_3',
        status: 'empty',
        frameAssetId: null,
      },
      segmentState: { kind: 'queued' },
    });
    const fourth = makeShot('shot_4', 8, 24, {
      chainBreak: 'hard_cut',
      frameBoundary: null,
      segmentHead: true,
    });
    renderCoverage([first, second, third, fourth]);

    expect(screen.getByText('Stale · Still plays')).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Trim in Shot 1' })).toBeEnabled();

    const ready = screen.getByRole('img', { name: 'Boundary after Shot 01 · Continuity frame ready' });
    expect(ready).toHaveAttribute('data-boundary-frame', 'on_disk');
    expect(ready.querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project_1/frame_1');
    expect(ready.querySelector('img')).toHaveAttribute('alt', '');

    expect(screen.getByRole('img', { name: 'Boundary after Shot 02 · Waiting for continuity frame' })).toHaveAttribute(
      'data-boundary-frame',
      'empty'
    );
    const gone = screen.getByRole('img', { name: 'Boundary after Shot 03 · Continuity frame missing' });
    expect(gone).toHaveAttribute('data-boundary-frame', 'gone');
    expect(gone).not.toContainElement(screen.getByRole('slider', { name: 'Boundary after Shot 3' }));
  });

  it('fails malformed or unsafe boundary authority closed without inventing an on-disk frame', () => {
    const second = makeShot('shot_2', 8, 8, {
      frameBoundary: {
        upstreamShotId: 'wrong_upstream',
        dependentShotId: 'shot_2',
        status: 'on_disk',
        frameAssetId: 'frame_1',
      },
    });
    const invalidProject = renderCoverage([makeShot('shot_1', 8, 0), second]);
    expect(screen.queryByRole('img', { name: /Continuity frame ready/ })).toBeNull();

    invalidProject.unmount();
    render(
      <CoverageBar
        disabled={false}
        inspectedShotId='shot_1'
        onCommitPlanningDurations={vi.fn().mockResolvedValue(true)}
        onCommitTrim={vi.fn().mockResolvedValue(true)}
        onInspectShot={vi.fn()}
        projectId='unsafe/project'
        shots={[
          makeShot('shot_1', 8, 0),
          {
            ...second,
            frameBoundary: {
              upstreamShotId: 'shot_1',
              dependentShotId: 'shot_2',
              status: 'on_disk',
              frameAssetId: 'frame_1',
            },
          },
        ]}
      />
    );
    expect(screen.queryByRole('img', { name: /Continuity frame ready/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Boundary after Shot 01 · Continuity frame missing' })).toHaveAttribute(
      'data-boundary-frame',
      'gone'
    );
  });

  it('keeps a stale dependent Take playable but marks its incoming verified frame red', () => {
    const upstream = makeSelectedShot();
    const dependent = makeShot('shot_2', 8, 8, {
      selectedTakeId: 'take_2',
      selectedTakeSourceDurationSeconds: 10,
      trimInSeconds: 1,
      trimOutSeconds: 1,
      playedDurationSeconds: 8,
      dirtyCauses: ['continuity_stale'],
      segmentState: { kind: 'stale' },
      frameBoundary: {
        upstreamShotId: 'shot_1',
        dependentShotId: 'shot_2',
        status: 'on_disk',
        frameAssetId: 'frame_1',
      },
    });
    renderCoverage([upstream, dependent]);

    expect(screen.getByText('Stale · Still plays')).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Trim in Shot 2' })).toBeEnabled();
    const marker = screen.getByRole('img', {
      name: 'Boundary after Shot 01 · Continuity frame is out of date',
    });
    expect(marker).toHaveAttribute('data-boundary-frame', 'gone');
    expect(marker.querySelector('img')).toBeNull();
  });

  it('keeps source copy outside a dedicated trim lane without weakening the sliders', () => {
    renderCoverage([makeSelectedShot()]);

    const sourceDuration = screen.getByText('10s source');
    const trimIn = screen.getByRole('slider', { name: 'Trim in Shot 1' });
    const trimOut = screen.getByRole('slider', { name: 'Trim out Shot 1' });
    const trimLane = trimIn.parentElement;

    expect(trimLane).not.toBeNull();
    expect(trimOut.parentElement).toBe(trimLane);
    expect(trimLane).not.toContainElement(sourceDuration);
    expect(trimLane?.parentElement).toContainElement(sourceDuration);
    expect(trimIn).toHaveAttribute('aria-orientation', 'horizontal');
    expect(trimIn).toHaveAttribute('aria-valuemin', '0');
    expect(trimIn).toHaveAttribute('aria-valuemax', '8');
    expect(trimIn).toHaveAttribute('aria-valuenow', '1');
    expect(trimIn).toHaveAttribute('aria-valuetext', '1s trimmed');
    expect(trimIn).toHaveAttribute('tabindex', '0');
  });

  it('keeps trim and boundary consequences visible beside the coverage controls', () => {
    renderCoverage([makeSelectedShot(), makeShot('shot_2', 8, 8)]);

    const trimGuidance = screen.getByText('Edge · Trim · Free');
    const boundaryGuidance = screen.getByText('Boundary · Costs a re-render');

    expect(trimGuidance).toBeVisible();
    expect(boundaryGuidance).toBeVisible();
    expect(trimGuidance.parentElement).toBe(boundaryGuidance.parentElement);
  });

  it('fuses a controlled free seek rail to coverage even while mutations are locked', () => {
    const onSeek = vi.fn();
    renderCoverage([makeShot('shot_1', 8, 0)], {
      disabled: true,
      playback: { available: true, durationSeconds: 8, positionSeconds: 2, onSeek },
    });

    const guidance = screen.getByText('Rail · Seek · Free');
    const rail = screen.getByRole('slider', { name: 'Beat seek rail' });
    expect(rail).toBeEnabled();
    expect(rail).toHaveAttribute('aria-describedby', guidance.id);
    expect(rail).toHaveAttribute('aria-valuemin', '0');
    expect(rail).toHaveAttribute('aria-valuemax', '8');
    expect(rail).toHaveAttribute('aria-valuenow', '2');
    expect(rail).toHaveAttribute('aria-valuetext', '0:02 of 0:08');

    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue(rectangle(100));
    installPointerCapture(rail);
    fireEvent.pointerDown(rail, { clientX: 75, pointerId: 4 });
    fireEvent.pointerUp(rail, { clientX: 75, pointerId: 4 });
    expect(onSeek).toHaveBeenLastCalledWith(6);

    fireEvent.keyDown(rail, { key: 'ArrowLeft', shiftKey: true });
    expect(onSeek).toHaveBeenLastCalledWith(1.8);

    const direction = mockDirection('rtl');
    fireEvent.keyDown(rail, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenLastCalledWith(1);
    direction.mockRestore();
  });

  it('places and drives the fused rail through trimmed multi-Shot source geometry in LTR and RTL', () => {
    const onSeek = vi.fn();
    renderCoverage(
      [
        makeShot('shot_1', 8, 0, {
          selectedTakeId: 'take_1',
          selectedTakeSourceDurationSeconds: 10,
          trimInSeconds: 4,
          trimOutSeconds: 4,
          playedDurationSeconds: 2,
        }),
        makeShot('shot_2', 10, 8),
      ],
      { playback: { available: true, durationSeconds: 12, positionSeconds: 2, onSeek } }
    );
    const rail = screen.getByRole('slider', { name: 'Beat seek rail' });
    expect(rail).toHaveStyle({ '--seek-position': '50%' });
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue(rectangle(100));
    installPointerCapture(rail);

    fireEvent.pointerDown(rail, { clientX: 25, pointerId: 5 });
    fireEvent.pointerUp(rail, { clientX: 25, pointerId: 5 });
    expect(onSeek).toHaveBeenLastCalledWith(1);

    const direction = mockDirection('rtl');
    fireEvent.pointerDown(rail, { clientX: 25, pointerId: 6 });
    fireEvent.pointerUp(rail, { clientX: 25, pointerId: 6 });
    expect(onSeek).toHaveBeenLastCalledWith(7);
    direction.mockRestore();
  });

  it('describes each slider with the matching stable consequence across rerenders', () => {
    const first = makeSelectedShot();
    const second = makeShot('shot_2', 8, 8, {
      selectedTakeId: 'take_2',
      selectedTakeSourceDurationSeconds: 10,
      trimInSeconds: 1,
      trimOutSeconds: 1,
      playedDurationSeconds: 8,
    });
    const third = makeShot('shot_3', 8, 16);
    const result = renderCoverage([first, second, third]);
    const trimGuidance = screen.getByText('Edge · Trim · Free');
    const boundaryGuidance = screen.getByText('Boundary · Costs a re-render');
    const trimGuidanceId = trimGuidance.id;
    const boundaryGuidanceId = boundaryGuidance.id;

    expect(trimGuidanceId).not.toBe('');
    expect(boundaryGuidanceId).not.toBe(trimGuidanceId);
    for (const slider of screen.getAllByRole('slider', { name: /Trim (?:in|out) Shot/ })) {
      expect(slider.getAttribute('aria-describedby')?.split(' ')).toContain(trimGuidanceId);
    }
    for (const slider of screen.getAllByRole('slider', { name: /Boundary after Shot/ })) {
      expect(slider).toHaveAttribute('aria-describedby', boundaryGuidanceId);
    }

    result.rerender(
      <CoverageBar
        disabled={false}
        inspectedShotId={result.inspectedShotId}
        onCommitPlanningDurations={result.onCommitPlanningDurations}
        onCommitTrim={result.onCommitTrim}
        onInspectShot={result.onInspectShot}
        projectId='project_1'
        shots={[{ ...first, trimInSeconds: 2, playedDurationSeconds: 7 }, second, third]}
      />
    );
    expect(screen.getByText('Edge · Trim · Free')).toHaveAttribute('id', trimGuidanceId);
    expect(screen.getByText('Boundary · Costs a re-render')).toHaveAttribute('id', boundaryGuidanceId);
  });

  it('fits selection and trim chrome into the specified 88px playback track', () => {
    const css = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/BeatPanel.module.css'
      ),
      'utf8'
    );

    const playbackTrackRule = cssRuleBody(css, '.playbackTrack');
    expect(playbackTrackRule).toContain('box-sizing: border-box');
    expect(playbackTrackRule).toContain('block-size: 88px');
    expect(playbackTrackRule).toContain('border-radius: 11px');
    expect(css).toMatch(/\.playbackSegment\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) 28px/s);
    expect(cssRuleBody(css, '.segmentSelector')).toContain('block-size: 100% !important');
    expect(cssRuleBody(css, '.segmentSelector')).toContain('grid-template-rows: auto auto');
    expect(cssRuleBody(css, '.segmentMeta')).toContain('grid-row: 2');
    expect(cssRuleBody(css, '.segmentState')).toContain('line-height: 14px');
    expect(cssRuleBody(css, '.trimWarning')).toContain('position: absolute');
    expect(css).toMatch(/\.trimLane\s*\{[^}]*position:\s*relative[^}]*grid-row:\s*2/s);
    expect(css).toMatch(/\.trimHandle\s*\{[^}]*inset-block:\s*2px/s);
    expect(css).not.toMatch(/\.trimLane\s*\{[^}]*position:\s*absolute/s);
    expect(cssRuleBody(css, '.playbackSurface')).toContain('position: relative');
    expect(cssRuleBody(css, '.seekRail')).toContain('block-size: 18px !important');
    expect(cssRuleBody(css, '.seekRail')).toContain('position: absolute !important');
  });

  it('ignores missing or invalid measurements and disconnects an installed observer', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectangle(Number.NaN));
    const missing = renderCoverage([makeShot('shot_1', 8, 0)]);
    expect(screen.getByTestId('studio-coverage-playback')).toHaveAttribute('data-density', 'narrow');
    missing.unmount();
    rect.mockRestore();

    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const installed = renderCoverage([makeShot('shot_1', 8, 0)]);
    act(() => {
      const observer = {} as ResizeObserver;
      resizeCallback?.([], observer);
      resizeCallback?.([{ contentRect: rectangle(Number.NaN) } as ResizeObserverEntry], observer);
      resizeCallback?.([{ contentRect: rectangle(-1) } as ResizeObserverEntry], observer);
      resizeCallback?.([{ contentRect: rectangle(151) } as ResizeObserverEntry], observer);
    });
    expect(screen.getByTestId('studio-coverage-playback')).toHaveAttribute('data-density', 'wide');
    installed.unmount();
    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(1);
  });

  it('binds measurement when empty coverage becomes valid and cleans up its observer', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectangle(151));
    const result = renderCoverage([]);
    expect(resizeCallback).toBeNull();

    result.rerender(
      <CoverageBar
        disabled={false}
        inspectedShotId={result.inspectedShotId}
        onCommitPlanningDurations={result.onCommitPlanningDurations}
        onCommitTrim={result.onCommitTrim}
        onInspectShot={result.onInspectShot}
        projectId='project_1'
        shots={[makeShot('shot_1', 8, 0)]}
      />
    );
    expect(screen.getByTestId('studio-coverage-playback')).toHaveAttribute('data-density', 'wide');
    expect(resizeCallback).not.toBeNull();
    expect(resizeObserverDisconnect).not.toHaveBeenCalled();

    result.unmount();
    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(1);
    rect.mockRestore();
  });

  it('rebinds measurement after valid coverage becomes unavailable and valid again', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectangle(151));
    const shot = makeShot('shot_1', 8, 0);
    const result = renderCoverage([shot]);
    const firstResizeCallback = resizeCallback;
    expect(screen.getByTestId('studio-coverage-playback')).toHaveAttribute('data-density', 'wide');
    expect(firstResizeCallback).not.toBeNull();

    result.rerender(
      <CoverageBar
        disabled={false}
        inspectedShotId={result.inspectedShotId}
        onCommitPlanningDurations={result.onCommitPlanningDurations}
        onCommitTrim={result.onCommitTrim}
        onInspectShot={result.onInspectShot}
        projectId='project_1'
        shots={[makeShot('shot_1', 8, 0, { planningBoundary: null })]}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Coverage unavailable');
    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(1);

    rect.mockReturnValue(rectangle(87));
    result.rerender(
      <CoverageBar
        disabled={false}
        inspectedShotId={result.inspectedShotId}
        onCommitPlanningDurations={result.onCommitPlanningDurations}
        onCommitTrim={result.onCommitTrim}
        onInspectShot={result.onInspectShot}
        projectId='project_1'
        shots={[shot]}
      />
    );
    expect(screen.getByTestId('studio-coverage-playback')).toHaveAttribute('data-density', 'narrow');
    expect(resizeCallback).not.toBe(firstResizeCallback);
    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(1);

    result.unmount();
    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(2);
    rect.mockRestore();
  });

  it('exposes only reachable boundary values and commits one atomic keyboard-equivalent pair', async () => {
    const onCommitPlanningDurations = vi.fn().mockResolvedValue(true);
    renderCoverage([makeShot('shot_1', 8, 0), makeShot('shot_2', 8, 8)], { onCommitPlanningDurations });
    const slider = screen.getByRole('slider', { name: 'Boundary after Shot 1' });
    expect(slider).toHaveAttribute('aria-valuemin', '4');
    expect(slider).toHaveAttribute('aria-valuemax', '12');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(onCommitPlanningDurations).toHaveBeenCalledWith([
        { shotId: 'shot_1', durationSeconds: 9 },
        { shotId: 'shot_2', durationSeconds: 7 },
      ])
    );
    expect(onCommitPlanningDurations).toHaveBeenCalledTimes(1);
    expect(screen.getByText('9s left, 7s right')).toBeInTheDocument();
  });

  it('supports every clamped boundary key in LTR and mirrors only horizontal keys in RTL', async () => {
    const onCommitPlanningDurations = vi.fn().mockResolvedValue(true);
    renderCoverage([makeShot('shot_1', 8, 0), makeShot('shot_2', 8, 8)], { onCommitPlanningDurations });
    const slider = screen.getByRole('slider', { name: 'Boundary after Shot 1' });

    await act(async () => {
      fireEvent.keyDown(slider, { key: 'ArrowUp' });
      fireEvent.keyDown(slider, { key: 'ArrowLeft' });
      fireEvent.keyDown(slider, { key: 'ArrowDown' });
      fireEvent.keyDown(slider, { key: 'Home' });
      fireEvent.keyDown(slider, { key: 'End' });
      fireEvent.keyDown(slider, { key: 'PageDown' });
      await Promise.resolve();
    });

    expect(onCommitPlanningDurations.mock.calls).toEqual([
      [
        [
          { shotId: 'shot_1', durationSeconds: 9 },
          { shotId: 'shot_2', durationSeconds: 7 },
        ],
      ],
      [
        [
          { shotId: 'shot_1', durationSeconds: 7 },
          { shotId: 'shot_2', durationSeconds: 9 },
        ],
      ],
      [
        [
          { shotId: 'shot_1', durationSeconds: 7 },
          { shotId: 'shot_2', durationSeconds: 9 },
        ],
      ],
      [
        [
          { shotId: 'shot_1', durationSeconds: 4 },
          { shotId: 'shot_2', durationSeconds: 12 },
        ],
      ],
      [
        [
          { shotId: 'shot_1', durationSeconds: 12 },
          { shotId: 'shot_2', durationSeconds: 4 },
        ],
      ],
    ]);

    const direction = mockDirection('rtl');
    await act(async () => {
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      fireEvent.keyDown(slider, { key: 'ArrowLeft' });
      await Promise.resolve();
    });
    expect(onCommitPlanningDurations.mock.calls.slice(-2)).toEqual([
      [
        [
          { shotId: 'shot_1', durationSeconds: 7 },
          { shotId: 'shot_2', durationSeconds: 9 },
        ],
      ],
      [
        [
          { shotId: 'shot_1', durationSeconds: 9 },
          { shotId: 'shot_2', durationSeconds: 7 },
        ],
      ],
    ]);
    direction.mockRestore();
  });

  it('advertises a fixed 4-second boundary when the adjacent pair has no reachable movement', () => {
    renderCoverage([makeShot('shot_1', 4, 0), makeShot('shot_2', 4, 4)]);
    const slider = screen.getByRole('slider', { name: 'Boundary after Shot 1' });
    expect(slider).toHaveAttribute('aria-valuemin', '4');
    expect(slider).toHaveAttribute('aria-valuemax', '4');
    fireEvent.keyDown(slider, { key: 'End' });
  });

  it('commits half-second trim keys once and warns only when a tail trim has a continuity successor', async () => {
    const onCommitTrim = vi.fn().mockResolvedValue(true);
    const first = makeShot('shot_1', 8, 0, {
      selectedTakeId: 'take_1',
      selectedTakeSourceDurationSeconds: 10,
      trimInSeconds: 1,
      trimOutSeconds: 1,
      playedDurationSeconds: 8,
    });
    const result = renderCoverage([first, makeShot('shot_2', 8, 8, { segmentHead: false })], { onCommitTrim });
    const warning = screen.getByText('Tail trim makes the next Shot stale');
    const selector = screen.getByRole('button', { name: /Shot 1.*10s source.*Rendered · 1 Take/ });
    expect(warning).toBeVisible();
    expect(selector).not.toContainElement(warning);
    expect(selector).toHaveAccessibleDescription('Tail trim makes the next Shot stale');
    const trimIn = screen.getByRole('slider', { name: 'Trim in Shot 1' });
    const trimOut = screen.getByRole('slider', { name: 'Trim out Shot 1' });
    expect(trimOut).toHaveAccessibleDescription(/Edge · Trim · Free.*Tail trim makes/);
    fireEvent.keyDown(trimIn, { key: 'ArrowUp' });
    await waitFor(() => expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 1.5, 1));
    expect(onCommitTrim).toHaveBeenCalledTimes(1);

    result.rerender(
      <CoverageBar
        disabled={false}
        inspectedShotId={result.inspectedShotId}
        onCommitPlanningDurations={result.onCommitPlanningDurations}
        onCommitTrim={onCommitTrim}
        onInspectShot={result.onInspectShot}
        projectId='project_1'
        shots={[first, makeShot('shot_2', 8, 8, { chainBreak: 'hard_cut', segmentHead: true })]}
      />
    );
    expect(screen.queryByText('Tail trim makes the next Shot stale')).not.toBeInTheDocument();
  });

  it('supports both trim edges, endpoint keys, no-op keys, and RTL horizontal mirroring', async () => {
    const onCommitTrim = vi.fn().mockResolvedValue(true);
    renderCoverage([makeSelectedShot({ trimInSeconds: 1, trimOutSeconds: 2, playedDurationSeconds: 7 })], {
      onCommitTrim,
    });
    const trimIn = screen.getByRole('slider', { name: 'Trim in Shot 1' });
    const trimOut = screen.getByRole('slider', { name: 'Trim out Shot 1' });

    await act(async () => {
      fireEvent.keyDown(trimIn, { key: 'ArrowLeft' });
      fireEvent.keyDown(trimIn, { key: 'ArrowDown' });
      fireEvent.keyDown(trimIn, { key: 'Home' });
      fireEvent.keyDown(trimIn, { key: 'End' });
      fireEvent.keyDown(trimIn, { key: 'PageUp' });
      fireEvent.keyDown(trimOut, { key: 'ArrowRight' });
      fireEvent.keyDown(trimOut, { key: 'ArrowUp' });
      fireEvent.keyDown(trimOut, { key: 'ArrowLeft' });
      fireEvent.keyDown(trimOut, { key: 'ArrowDown' });
      fireEvent.keyDown(trimOut, { key: 'Home' });
      fireEvent.keyDown(trimOut, { key: 'End' });
      await Promise.resolve();
    });

    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 0.5, 2);
    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', null, 2);
    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 7, 2);
    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 1, 2.5);
    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 1, 1.5);
    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 1, null);
    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 1, 8);
    expect(onCommitTrim).toHaveBeenCalledTimes(10);

    const direction = mockDirection('rtl');
    await act(async () => {
      fireEvent.keyDown(trimIn, { key: 'ArrowRight' });
      fireEvent.keyDown(trimIn, { key: 'ArrowLeft' });
      fireEvent.keyDown(trimOut, { key: 'ArrowRight' });
      fireEvent.keyDown(trimOut, { key: 'ArrowLeft' });
      await Promise.resolve();
    });
    expect(onCommitTrim.mock.calls.slice(-4)).toEqual([
      ['shot_1', 0.5, 2],
      ['shot_1', 1.5, 2],
      ['shot_1', 1, 1.5],
      ['shot_1', 1, 2.5],
    ]);
    direction.mockRestore();
  });

  it('does not commit an unchanged or disabled trim keyboard gesture', () => {
    const onCommitTrim = vi.fn().mockResolvedValue(true);
    const shot = makeSelectedShot({
      trimInSeconds: null,
      trimOutSeconds: null,
      playedDurationSeconds: 10,
    });
    const result = renderCoverage([shot], { onCommitTrim });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Trim in Shot 1' }), { key: 'Home' });
    expect(onCommitTrim).not.toHaveBeenCalled();

    result.rerender(
      <CoverageBar
        disabled
        inspectedShotId={result.inspectedShotId}
        onCommitPlanningDurations={result.onCommitPlanningDurations}
        onCommitTrim={onCommitTrim}
        onInspectShot={result.onInspectShot}
        projectId='project_1'
        shots={[shot]}
      />
    );
    const disabledTrim = screen.getByRole('slider', { name: 'Trim out Shot 1' });
    fireEvent.keyDown(disabledTrim, { key: 'End' });
    expect(onCommitTrim).not.toHaveBeenCalled();
  });

  it('previews and commits each trim pointer edge once while cancellation and mismatched pointers are no-ops', async () => {
    const onCommitTrim = vi.fn().mockResolvedValue(true);
    renderCoverage([makeSelectedShot()], { onCommitTrim });
    const trimIn = screen.getByRole('slider', { name: 'Trim in Shot 1' });
    const trimOut = screen.getByRole('slider', { name: 'Trim out Shot 1' });
    const segment = trimIn.parentElement!;
    vi.spyOn(segment, 'getBoundingClientRect').mockReturnValue(rectangle(100));
    const inCapture = installPointerCapture(trimIn);
    const outCapture = installPointerCapture(trimOut);

    fireEvent.pointerDown(trimIn, { clientX: 20, pointerId: 7 });
    fireEvent.pointerMove(trimIn, { clientX: 40, pointerId: 7 });
    expect(trimIn).toHaveAttribute('aria-valuenow', '3');
    fireEvent.pointerUp(trimIn, { clientX: 40, pointerId: 7 });
    await waitFor(() => {
      expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 3, 1);
      expect(trimIn).toHaveAttribute('aria-valuenow', '1');
    });
    expect(inCapture.setPointerCapture).toHaveBeenCalledWith(7);
    expect(inCapture.releasePointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerDown(trimOut, { clientX: 80, pointerId: 8 });
    fireEvent.pointerMove(trimOut, { clientX: 60, pointerId: 8 });
    expect(trimOut).toHaveAttribute('aria-valuenow', '3');
    fireEvent.pointerUp(trimOut, { clientX: 60, pointerId: 8 });
    await waitFor(() => {
      expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 1, 3);
      expect(trimOut).toHaveAttribute('aria-valuenow', '1');
    });
    expect(outCapture.releasePointerCapture).toHaveBeenCalledWith(8);

    fireEvent.pointerDown(trimIn, { clientX: 20, pointerId: 9 });
    fireEvent.pointerMove(trimIn, { clientX: 40, pointerId: 10 });
    fireEvent.pointerUp(trimIn, { clientX: 40, pointerId: 10 });
    fireEvent.pointerCancel(trimIn, { pointerId: 9 });
    expect(onCommitTrim).toHaveBeenCalledTimes(2);

    fireEvent.pointerDown(trimOut, { clientX: 80, pointerId: 11 });
    fireEvent.pointerMove(trimOut, { clientX: 60, pointerId: 11 });
    fireEvent.pointerCancel(trimOut, { pointerId: 11 });
    expect(onCommitTrim).toHaveBeenCalledTimes(2);
  });

  it('discards an active trim preview on lost capture or changed Shot facts and tolerates capture failures', async () => {
    const onCommitTrim = vi.fn().mockResolvedValue(true);
    const shot = makeSelectedShot();
    const result = renderCoverage([shot], { onCommitTrim });
    const trimIn = screen.getByRole('slider', { name: 'Trim in Shot 1' });
    const segment = trimIn.parentElement!;
    const bounds = vi.spyOn(segment, 'getBoundingClientRect').mockReturnValue(rectangle(100));
    const capture = installPointerCapture(trimIn);

    fireEvent.pointerDown(trimIn, { clientX: 20, pointerId: 12 });
    fireEvent.pointerMove(trimIn, { clientX: 40, pointerId: 12 });
    fireEvent.lostPointerCapture(trimIn, { pointerId: 12 });
    expect(onCommitTrim).not.toHaveBeenCalled();

    fireEvent.pointerDown(trimIn, { clientX: 20, pointerId: 13 });
    fireEvent.pointerMove(trimIn, { clientX: 30, pointerId: 13 });
    result.rerender(
      <CoverageBar
        disabled={false}
        inspectedShotId={result.inspectedShotId}
        onCommitPlanningDurations={result.onCommitPlanningDurations}
        onCommitTrim={onCommitTrim}
        onInspectShot={result.onInspectShot}
        projectId='project_1'
        shots={[makeSelectedShot({ trimInSeconds: 2, trimOutSeconds: 1, playedDurationSeconds: 7 })]}
      />
    );
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(13);
    expect(onCommitTrim).not.toHaveBeenCalled();

    bounds.mockReturnValue(rectangle(0));
    fireEvent.pointerDown(trimIn, { clientX: 20, pointerId: 14 });
    fireEvent.pointerMove(trimIn, { clientX: 40, pointerId: 14 });
    fireEvent.pointerUp(trimIn, { clientX: 40, pointerId: 14 });
    expect(onCommitTrim).not.toHaveBeenCalled();

    bounds.mockReturnValue(rectangle(100));
    capture.setPointerCapture.mockImplementationOnce(() => {
      throw new Error('capture unavailable');
    });
    capture.releasePointerCapture.mockImplementationOnce(() => {
      throw new Error('capture lost');
    });
    await act(async () => {
      fireEvent.pointerDown(trimIn, { clientX: 20, pointerId: 15 });
      fireEvent.pointerMove(trimIn, { clientX: 30, pointerId: 15 });
      fireEvent.pointerUp(trimIn, { clientX: 30, pointerId: 15 });
      await Promise.resolve();
    });
    expect(onCommitTrim).toHaveBeenCalledWith('shot_1', 3, 1);
  });

  it('mirrors an RTL pointer boundary, commits on release once, and discards cancellation', async () => {
    const onCommitPlanningDurations = vi.fn().mockResolvedValue(true);
    renderCoverage([makeShot('shot_1', 8, 0), makeShot('shot_2', 8, 8)], { onCommitPlanningDurations });
    const track = screen.getByTestId('studio-coverage-planning');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(rectangle(160));
    const direction = mockDirection('rtl');
    const slider = screen.getByRole('slider', { name: 'Boundary after Shot 1' });
    const capture = installPointerCapture(slider);

    fireEvent.pointerDown(slider, { clientX: 80, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 40, pointerId: 1 });
    await waitFor(() =>
      expect(onCommitPlanningDurations).toHaveBeenCalledWith([
        { shotId: 'shot_1', durationSeconds: 12 },
        { shotId: 'shot_2', durationSeconds: 4 },
      ])
    );
    expect(onCommitPlanningDurations).toHaveBeenCalledTimes(1);
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerDown(slider, { clientX: 80, pointerId: 2 });
    fireEvent.pointerMove(slider, { clientX: 120, pointerId: 2 });
    fireEvent.pointerCancel(slider, { pointerId: 2 });
    expect(onCommitPlanningDurations).toHaveBeenCalledTimes(1);
    direction.mockRestore();
  });

  it('discards invalid, unchanged, mismatched, and lost-capture boundary drags', async () => {
    const onCommitPlanningDurations = vi.fn().mockResolvedValue(true);
    renderCoverage([makeShot('shot_1', 8, 0), makeShot('shot_2', 8, 8)], { onCommitPlanningDurations });
    const track = screen.getByTestId('studio-coverage-planning');
    const bounds = vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(rectangle(0));
    const slider = screen.getByRole('slider', { name: 'Boundary after Shot 1' });
    const capture = installPointerCapture(slider);

    fireEvent.pointerDown(slider, { clientX: 80, pointerId: 20 });
    fireEvent.pointerMove(slider, { clientX: 120, pointerId: 20 });
    fireEvent.pointerUp(slider, { clientX: 120, pointerId: 20 });
    expect(onCommitPlanningDurations).not.toHaveBeenCalled();

    bounds.mockReturnValue(rectangle(160));
    fireEvent.pointerDown(slider, { clientX: 80, pointerId: 21 });
    fireEvent.pointerUp(slider, { clientX: 80, pointerId: 21 });
    expect(onCommitPlanningDurations).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { clientX: 80, pointerId: 22 });
    fireEvent.pointerMove(slider, { clientX: 120, pointerId: 23 });
    fireEvent.pointerUp(slider, { clientX: 120, pointerId: 23 });
    fireEvent.lostPointerCapture(slider, { pointerId: 22 });
    expect(onCommitPlanningDurations).not.toHaveBeenCalled();

    capture.setPointerCapture.mockImplementationOnce(() => {
      throw new Error('capture unavailable');
    });
    capture.releasePointerCapture.mockImplementationOnce(() => {
      throw new Error('capture lost');
    });
    await act(async () => {
      fireEvent.pointerDown(slider, { clientX: 80, pointerId: 24 });
      fireEvent.pointerMove(slider, { clientX: 120, pointerId: 24 });
      fireEvent.pointerUp(slider, { clientX: 120, pointerId: 24 });
      await Promise.resolve();
    });
    expect(onCommitPlanningDurations).toHaveBeenCalledWith([
      { shotId: 'shot_1', durationSeconds: 12 },
      { shotId: 'shot_2', durationSeconds: 4 },
    ]);
  });

  it('removes disabled handles from the tab order and never commits them', () => {
    const onCommitPlanningDurations = vi.fn().mockResolvedValue(true);
    renderCoverage([makeShot('shot_1', 8, 0), makeShot('shot_2', 8, 8)], {
      disabled: true,
      onCommitPlanningDurations,
    });
    const slider = screen.getByRole('slider', { name: 'Boundary after Shot 1' });
    expect(slider).toBeDisabled();
    expect(slider).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onCommitPlanningDurations).not.toHaveBeenCalled();
  });
});
