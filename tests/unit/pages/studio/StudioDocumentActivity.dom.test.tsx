/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioRendererJob } from '@/common/types/project/creativeStudioTypes';
import { StudioDocumentActivity } from '@renderer/pages/studio/components/PhaseShell/StudioDocumentActivity';
import type { UseStudioRenderResult } from '@renderer/pages/studio/hooks/useStudioRender';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
  }),
}));

const job = (overrides: Partial<StudioRendererJob> = {}): StudioRendererJob => ({
  id: 'job-1',
  projectId: 'project-1',
  sceneId: 'scene-1',
  status: 'running',
  provider: { choiceId: 'choice-image', providerId: 'provider-image', model: 'image-model' },
  outputAssetIds: [],
  error: null,
  canCancel: false,
  canRetryDownload: false,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  ...overrides,
});

const renderState = (overrides: Partial<UseStudioRenderResult> = {}): UseStudioRenderResult => ({
  status: 'idle',
  progress: 0,
  clipIndex: null,
  clipTotal: null,
  assetId: null,
  missingSceneIds: null,
  errorCode: null,
  errorMessageKey: null,
  busy: false,
  render: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  ...overrides,
});

const activity = (): HTMLElement =>
  screen.getByRole('status', { name: 'conversation.creativeStudio.phase.shared.activityLabel' });

const renderProgress = (): HTMLElement => screen.getByRole('progressbar');

describe('StudioDocumentActivity', () => {
  /**
   * A live region inserted into the DOM together with its first content is unreliably
   * announced, so the region is mounted for the document's whole life and only its text
   * changes. Idle therefore means "mounted and empty", not "absent".
   */
  it('keeps an empty live region mounted while nothing is in flight', () => {
    render(<StudioDocumentActivity jobs={[job({ status: 'succeeded' })]} render={renderState()} />);

    const region = activity();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  /**
   * Idle, the indicator is a zero-width box that would still take one `.headerMeta` row gap.
   * The stylesheet cancels that gap through this marker rather than through `display: none`,
   * which would delete the live region from the accessibility tree and put it back only when
   * the first message arrives.
   */
  it('marks the indicator idle for the stylesheet rather than unmounting or hiding the region', () => {
    const { rerender } = render(<StudioDocumentActivity jobs={[]} render={renderState()} />);
    const indicator = document.querySelector('[data-studio-document-activity]');

    expect(indicator).toHaveAttribute('data-idle', 'true');
    expect(indicator).toContainElement(activity());

    rerender(<StudioDocumentActivity jobs={[job({ status: 'running' })]} render={renderState()} />);

    expect(document.querySelector('[data-studio-document-activity]')).not.toHaveAttribute('data-idle');
  });

  /**
   * The four statuses below are the ones the rest of Studio already treats as active
   * (studioReadiness, ShotGrid, GenerationJobList's own running count). `needs_attention`
   * is a job waiting on a human, not work the provider is doing, so counting it here would
   * claim generation is happening when it has stopped.
   */
  it.each([['queued_local'], ['submitting'], ['queued_remote'], ['running']] as const)(
    'counts a %s job as in flight',
    (status) => {
      render(<StudioDocumentActivity jobs={[job({ status })]} render={renderState()} />);

      expect(activity()).toHaveTextContent(/activityGenerating:count=1(?![\d.])/);
    }
  );

  it.each([['needs_attention'], ['succeeded'], ['failed'], ['cancelled']] as const)(
    'does not count a %s job as in flight',
    (status) => {
      render(<StudioDocumentActivity jobs={[job({ status })]} render={renderState()} />);

      expect(activity()).toBeEmptyDOMElement();
    }
  );

  it('aggregates the in-flight jobs into one count rather than listing them', () => {
    render(
      <StudioDocumentActivity
        jobs={[
          job({ id: 'job-1', status: 'running' }),
          job({ id: 'job-2', status: 'queued_remote' }),
          job({ id: 'job-3', status: 'succeeded' }),
        ]}
        render={renderState()}
      />
    );

    expect(activity()).toHaveTextContent(/activityGenerating:count=2(?![\d.])/);
    expect(screen.queryByText(/job-1/)).not.toBeInTheDocument();
  });

  it('reports the running cut render as a whole-number percentage', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 0.424 })} />);

    expect(renderProgress()).toHaveTextContent(/activityRendering:percent=42(?![\d.])/);
  });

  /**
   * `busy` is a render this document started in another window. It is still the document's
   * render, so the frame reports it; suppressing it would hide in-flight work.
   */
  it('reports a render owned by another window', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 0.5, busy: true })} />);

    expect(renderProgress()).toHaveTextContent(/activityRendering:percent=50(?![\d.])/);
  });

  it.each([['idle'], ['succeeded'], ['failed'], ['cancelled']] as const)('says nothing about a %s render', (status) => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status, progress: 1 })} />);

    expect(activity()).toBeEmptyDOMElement();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows generation and rendering together when both are in flight', () => {
    render(
      <StudioDocumentActivity
        jobs={[job({ status: 'running' })]}
        render={renderState({ status: 'running', progress: 0.1 })}
      />
    );

    expect(activity()).toHaveTextContent(/activityGenerating:count=1(?![\d.])/);
    expect(renderProgress()).toHaveTextContent(/activityRendering:percent=10(?![\d.])/);
  });

  it('clamps a percentage that arrives outside 0-100', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 4 })} />);

    expect(renderProgress()).toHaveTextContent(/activityRendering:percent=100(?![\d.])/);
    expect(renderProgress()).toHaveAttribute('aria-valuenow', '100');
  });
});

/**
 * `renderService` suppresses only byte-identical progress and ffmpeg emits progress lines many
 * times a second, so one cut render walks through on the order of a hundred distinct rounded
 * percents. Any of that text sitting inside a polite, atomic live region is a queued spoken
 * announcement per step, and a screen reader user cannot hear anything else until the queue
 * drains. The percentage is therefore a `progressbar` value — value changes are read on demand
 * or when the control is focused, never as a live-region update — while the live region keeps
 * only the job count, which changes on discrete status transitions.
 */
describe('StudioDocumentActivity announcement volume', () => {
  it('leaves the live region silent about a render that has no job count to report', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 0.42 })} />);

    expect(activity()).toBeEmptyDOMElement();
  });

  it('keeps the percentage out of the live region while jobs are also in flight', () => {
    render(
      <StudioDocumentActivity
        jobs={[job({ status: 'running' })]}
        render={renderState({ status: 'running', progress: 0.42 })}
      />
    );

    expect(activity()).not.toContainElement(renderProgress());
    expect(activity()).not.toHaveTextContent(/percent=/);
  });

  it('does not change the live region text as render progress advances', () => {
    const { rerender } = render(
      <StudioDocumentActivity
        jobs={[job({ status: 'running' })]}
        render={renderState({ status: 'running', progress: 0.01 })}
      />
    );
    const announced = activity().textContent;

    for (const progress of [0.02, 0.17, 0.63, 0.99]) {
      rerender(
        <StudioDocumentActivity
          jobs={[job({ status: 'running' })]}
          render={renderState({ status: 'running', progress })}
        />
      );
      expect(activity().textContent).toBe(announced);
    }

    // Guards the guard: identical text across every step would also be what a component that
    // reports nothing at all produces.
    expect(announced).toMatch(/activityGenerating:count=1(?![\d.])/);
    expect(renderProgress()).toHaveAttribute('aria-valuenow', '99');
  });

  /**
   * Job status changes are discrete — a job moves queued -> running -> succeeded a handful of
   * times over its life — so the count is the announcement worth keeping live. This pins that a
   * change in the count does reach the region, and that repeated frames carrying the same count
   * do not rewrite it.
   */
  it('announces the job count and rewrites it only when the count itself changes', () => {
    const running = job({ id: 'job-1', status: 'running' });
    const { rerender } = render(<StudioDocumentActivity jobs={[running]} render={renderState()} />);

    expect(activity()).toHaveTextContent(/activityGenerating:count=1(?![\d.])/);

    rerender(
      <StudioDocumentActivity jobs={[{ ...running, updatedAt: '2026-08-12T00:00:01.000Z' }]} render={renderState()} />
    );
    expect(activity()).toHaveTextContent(/activityGenerating:count=1(?![\d.])/);

    rerender(
      <StudioDocumentActivity jobs={[running, job({ id: 'job-2', status: 'queued_remote' })]} render={renderState()} />
    );
    expect(activity()).toHaveTextContent(/activityGenerating:count=2(?![\d.])/);
  });

  it('names the progressbar so its value is not announced bare', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 0.42 })} />);

    const progressbar = renderProgress();
    expect(progressbar).toHaveAccessibleName('conversation.creativeStudio.phase.shared.activityRenderingLabel');
    expect(progressbar).toHaveAttribute('aria-valuenow', '42');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
  });

  /**
   * The percentage still has to be readable on screen: moving it to a progressbar value is an
   * announcement change, not a change to what the toolbar shows.
   */
  it('still shows the percentage as visible text', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 0.42 })} />);

    expect(renderProgress()).toHaveTextContent(/activityRendering:percent=42(?![\d.])/);
  });
});

/**
 * jsdom never loads the stylesheet, so every `styles.x` lookup is fabricated and a reference
 * with no rule behind it ships as `className={undefined}`. This walks the real files.
 */
describe('StudioDocumentActivity stylesheet references', () => {
  const PHASE_SHELL_DIR = path.resolve(
    __dirname,
    '../../../../packages/desktop/src/renderer/pages/studio/components/PhaseShell'
  );
  const source = readFileSync(path.join(PHASE_SHELL_DIR, 'StudioDocumentActivity.tsx'), 'utf8');
  const stylesheet = readFileSync(path.join(PHASE_SHELL_DIR, 'StudioPhaseShell.module.css'), 'utf8');

  const referenced = [...source.matchAll(/\bstyles\.([A-Za-z_][\w$]*)/g)].map((match) => match[1]!);
  const defined = new Set([...stylesheet.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]!));

  it('finds the class references to check', () => {
    // Guards the guard: a bad path or a broken pattern would make the assertion below vacuous.
    expect(new Set(referenced).size).toBeGreaterThan(1);
    expect(defined.size).toBeGreaterThan(5);
  });

  it('backs every styles.* lookup with a rule in StudioPhaseShell.module.css', () => {
    expect([...new Set(referenced)].filter((className) => !defined.has(className))).toEqual([]);
  });

  /**
   * The live region is mounted for the document's whole life so that it is registered before it
   * ever carries a message: a region that enters the accessibility tree already holding content
   * is unreliably announced. `display: none` deletes an element from that tree and
   * `visibility: hidden` hides its subtree, so either one on the region — or on the wrapper it
   * sits in — puts the region back into the tree together with its first message and defeats the
   * mounting. jsdom applies no CSS module, so the DOM cases above pass with or without such a
   * rule; only the stylesheet itself can say this.
   */
  const RULE = /([^{}]+)\{([^{}]*)\}/g;
  const HIDES_FROM_ASSISTIVE_TECH =
    /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)/;
  // Comments go first: the stylesheet explains in prose why `display: none` is forbidden here,
  // and prose about a declaration is not a declaration.
  const rules = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

  // The live region's own class, the wrapper the component styles around it, and `.activityItem`,
  // which `.activityLive` composes: `composes` puts the composed class on the same element at build
  // time, so a rule written on `.activityItem` reaches the region just as surely as one written on
  // `.activityLive` — and reaches it under a name that does not mention the region at all.
  //
  // The chain does continue — `.activityItem` composes `meta` from StudioTypography.module.css —
  // and this guard stops at this file. That is deliberate: `meta` is shared typography used
  // throughout Studio, so hiding it would blank visible text everywhere and be caught on sight,
  // whereas the failure guarded here is silent by construction.
  const LIVE_REGION_CLASSES = ['activity', 'activityLive', 'activityItem'] as const;

  const rulesTargeting = (className: string): string[] =>
    [...rules.matchAll(RULE)]
      .filter((rule) => new RegExp(`\\.${className}(?![\\w-])`).test(rule[1]!))
      .map((rule) => `${rule[1]!.trim()} {${rule[2]!.trim()}}`);

  it.each(LIVE_REGION_CLASSES)('finds the .%s rules to check', (className) => {
    // Guards the guard: a renamed class would make the assertion below vacuous.
    expect(rulesTargeting(className).length).toBeGreaterThan(0);
  });

  it.each(LIVE_REGION_CLASSES)('keeps .%s out of no rule that removes it from the accessibility tree', (className) => {
    expect(rulesTargeting(className).filter((rule) => HIDES_FROM_ASSISTIVE_TECH.test(rule))).toEqual([]);
  });

  it('backs the idle marker the component emits with a rule that collapses the row gap', () => {
    const idleRules = rulesTargeting('activity').filter((rule) => rule.includes("[data-idle='true']"));

    expect(idleRules).not.toEqual([]);
    expect(idleRules.every((rule) => /margin-inline-start\s*:/.test(rule))).toBe(true);
  });
});
