/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import {
  ReferencesView,
  type ReferenceWorkspaceItem,
} from '@/renderer/pages/studio/components/Workspace/Views/References';

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

afterEach(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.useRealTimers();
});

const workflowReference = (overrides: Partial<ReferenceWorkspaceItem> = {}): ReferenceWorkspaceItem => ({
  id: 'reference_ming',
  kind: 'character',
  label: 'Ming',
  description: 'Red jacket and round glasses',
  approvedAssetId: null,
  candidateAssetId: 'asset_ming_candidate',
  generationStatus: 'succeeded',
  candidateJob: null,
  ...overrides,
});

const renderWorkflow = (props: Partial<React.ComponentProps<typeof ReferencesView>> = {}) => {
  const actions = props.actions ?? {
    approve: vi.fn(async () => true),
    regenerate: vi.fn(),
    retryJob: vi.fn(async () => true),
    retryDownload: vi.fn(async () => true),
    cancelJob: vi.fn(async () => true),
    continueToTable: vi.fn(),
  };
  return {
    actions,
    ...render(
      <ReferencesView
        projectId='project_1'
        references={props.references ?? []}
        readyForTable={props.readyForTable ?? false}
        pendingReferenceId={props.pendingReferenceId ?? null}
        gateLocked={props.gateLocked ?? false}
        errorMessageKey={props.errorMessageKey ?? null}
        actions={actions}
        {...props}
      />
    ),
  };
};

const WORKFLOW_KEY = 'conversation.creativeStudio.workspace.referenceWorkflow';

describe('the approved reference workspace', () => {
  it('holds backgrounds until every named character is approved', () => {
    renderWorkflow({
      references: [
        workflowReference(),
        workflowReference({ id: 'reference_home', kind: 'background', label: 'Ming home' }),
      ],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.backgrounds.charactersRequired`)).toBeVisible();
    expect(screen.queryByText('Ming home')).toBeNull();
  });

  it('starts with backgrounds when the story has no named characters', () => {
    renderWorkflow({
      references: [workflowReference({ id: 'reference_park', kind: 'background', label: 'City park' })],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.characters.empty`)).toBeVisible();
    expect(screen.getByText('City park')).toBeVisible();
  });

  it('approves the exact visible candidate and keeps regeneration separately explicit', async () => {
    const { actions } = renderWorkflow({ references: [workflowReference()] });

    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.approve` }));
    await waitFor(() => expect(actions.approve).toHaveBeenCalledWith('reference_ming', 'asset_ming_candidate'));

    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` }));
    expect(actions.regenerate).toHaveBeenCalledWith('reference_ming');
  });

  it('keeps Continue to Table blocked until the durable workflow says it is ready', () => {
    const { rerender } = renderWorkflow({ references: [workflowReference()] });

    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.continueToTable` })).toBeDisabled();
    rerender(
      <ReferencesView
        projectId='project_1'
        references={[workflowReference({ approvedAssetId: 'asset_ming_candidate' })]}
        readyForTable
        pendingReferenceId={null}
        gateLocked={false}
        errorMessageKey={null}
        actions={{
          approve: vi.fn(async () => true),
          regenerate: vi.fn(),
          retryJob: vi.fn(async () => true),
          retryDownload: vi.fn(async () => true),
          cancelJob: vi.fn(async () => true),
          continueToTable: vi.fn(),
        }}
      />
    );
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.continueToTable` })).toBeEnabled();
  });

  it('surfaces a parent command failure and leaves the candidate actionable', () => {
    renderWorkflow({
      references: [workflowReference()],
      errorMessageKey: 'conversation.creativeStudio.workspace.errors.storage',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.workspace.errors.storage');
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.approve` })).toBeEnabled();
  });

  it('labels a replacement candidate separately from the retained approved authority', () => {
    renderWorkflow({
      references: [workflowReference({ approvedAssetId: 'asset_ming_approved' })],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.status.candidate`)).toBeVisible();
    expect(screen.queryByText(`${WORKFLOW_KEY}.status.approved`)).toBeNull();
  });

  it('blocks duplicate regeneration while the durable candidate job is active', () => {
    renderWorkflow({
      references: [workflowReference({ candidateAssetId: null, generationStatus: 'running' })],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.status.running`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` })).toBeDisabled();
  });

  it('scrolls to and briefly highlights the exact handoff card only once per focus intent', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const references = [workflowReference(), workflowReference({ id: 'reference_mei', label: 'Mei' })];
    const { actions, rerender } = renderWorkflow({ references, focusedReferenceIds: ['reference_mei'] });

    expect(screen.getByText('Mei').closest('[data-reference-id]')).toHaveAttribute(
      'data-reference-highlighted',
      'true'
    );
    expect(screen.getByText('Ming').closest('[data-reference-id]')).not.toHaveAttribute('data-reference-highlighted');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(
      <ReferencesView
        actions={actions}
        errorMessageKey={null}
        focusedReferenceIds={['reference_mei']}
        gateLocked={false}
        pendingReferenceId={null}
        projectId='project_1'
        readyForTable={false}
        references={references.map((reference) => structuredClone(reference))}
      />
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1_600));
    expect(screen.getByText('Mei').closest('[data-reference-id]')).not.toHaveAttribute('data-reference-highlighted');
  });

  it('keeps Regenerate blocked while a retryable candidate needs attention and exposes exact recovery actions', async () => {
    const { actions } = renderWorkflow({
      references: [
        workflowReference({
          candidateAssetId: null,
          generationStatus: 'failed',
          candidateJob: {
            id: 'job_reference_ming',
            status: 'needs_attention',
            error: {
              code: 'provider_unavailable',
              messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
            },
            canRetry: true,
            canRetryDownload: false,
            canCancel: true,
          },
        }),
      ],
    });

    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.jobs.retry' }));
    await waitFor(() => expect(actions.retryJob).toHaveBeenCalledWith('reference_ming', 'job_reference_ming', false));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.jobs.cancel' }));
    await waitFor(() => expect(actions.cancelJob).toHaveBeenCalledWith('reference_ming', 'job_reference_ming'));
  });

  it('requires the duplicate-charge acknowledgement before retrying an unknown submission', async () => {
    const { actions } = renderWorkflow({
      references: [
        workflowReference({
          candidateAssetId: null,
          generationStatus: 'failed',
          candidateJob: {
            id: 'job_reference_ming',
            status: 'needs_attention',
            error: {
              code: 'submission_unknown',
              messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
            },
            canRetry: true,
            canRetryDownload: false,
            canCancel: false,
          },
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.jobs.retry' }));
    expect(actions.retryJob).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.jobs.retryChargeConfirm' }));
    await waitFor(() => expect(actions.retryJob).toHaveBeenCalledWith('reference_ming', 'job_reference_ming', true));
  });

  it('keeps Regenerate blocked while an exact failed download remains recoverable', async () => {
    const { actions } = renderWorkflow({
      references: [
        workflowReference({
          candidateAssetId: null,
          generationStatus: 'failed',
          candidateJob: {
            id: 'job_reference_ming',
            status: 'failed',
            error: {
              code: 'download_failed',
              messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
            },
            canRetry: false,
            canRetryDownload: true,
            canCancel: false,
          },
        }),
      ],
    });

    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.jobs.retryDownload' }));
    await waitFor(() => expect(actions.retryDownload).toHaveBeenCalledWith('reference_ming', 'job_reference_ming'));
  });

  it('offers cancellation for an active candidate only when renderer authority permits it', async () => {
    const { actions } = renderWorkflow({
      references: [
        workflowReference({
          candidateAssetId: null,
          generationStatus: 'running',
          candidateJob: {
            id: 'job_reference_ming',
            status: 'running',
            error: null,
            canRetry: false,
            canRetryDownload: false,
            canCancel: true,
          },
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.jobs.cancel' }));
    await waitFor(() => expect(actions.cancelJob).toHaveBeenCalledWith('reference_ming', 'job_reference_ming'));
  });
});
