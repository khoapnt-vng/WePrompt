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

    expect(activity()).toHaveTextContent(/activityRendering:percent=42(?![\d.])/);
  });

  /**
   * `busy` is a render this document started in another window. It is still the document's
   * render, so the frame reports it; suppressing it would hide in-flight work.
   */
  it('reports a render owned by another window', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 0.5, busy: true })} />);

    expect(activity()).toHaveTextContent(/activityRendering:percent=50(?![\d.])/);
  });

  it.each([['idle'], ['succeeded'], ['failed'], ['cancelled']] as const)('says nothing about a %s render', (status) => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status, progress: 1 })} />);

    expect(activity()).toBeEmptyDOMElement();
  });

  it('shows generation and rendering together when both are in flight', () => {
    render(
      <StudioDocumentActivity
        jobs={[job({ status: 'running' })]}
        render={renderState({ status: 'running', progress: 0.1 })}
      />
    );

    const region = activity();
    expect(region).toHaveTextContent(/activityGenerating:count=1(?![\d.])/);
    expect(region).toHaveTextContent(/activityRendering:percent=10(?![\d.])/);
  });

  it('clamps a percentage that arrives outside 0-100', () => {
    render(<StudioDocumentActivity jobs={[]} render={renderState({ status: 'running', progress: 4 })} />);

    expect(activity()).toHaveTextContent(/activityRendering:percent=100(?![\d.])/);
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
});
