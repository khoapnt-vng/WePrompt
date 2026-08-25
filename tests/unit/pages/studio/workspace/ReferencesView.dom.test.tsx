/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  type ReferenceBindingWorkspaceItem,
  type ReferenceWorkspaceItem,
  type ReferencesViewActions,
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

const binding = (overrides: Partial<ReferenceBindingWorkspaceItem> = {}): ReferenceBindingWorkspaceItem => ({
  shotId: 'shot_ming',
  beatId: 'beat_reunion',
  beatTitle: 'Reunion',
  shotPosition: 1,
  shootingScript: 'Ming steps beneath the red awning.',
  status: 'unassigned',
  characterReferenceIds: [],
  backgroundReferenceId: null,
  ...overrides,
});

const createActions = (): ReferencesViewActions => ({
  addBackground: vi.fn(async () => true),
  approve: vi.fn(async () => true),
  regenerate: vi.fn(),
  retryJob: vi.fn(async () => true),
  retryDownload: vi.fn(async () => true),
  cancelJob: vi.fn(async () => true),
  saveBinding: vi.fn(async () => true),
  continueToTable: vi.fn(),
});

const renderWorkflow = (props: Partial<React.ComponentProps<typeof ReferencesView>> = {}) => {
  const actions = props.actions ?? createActions();
  return {
    actions,
    ...render(
      <ReferencesView
        projectId='project_1'
        references={props.references ?? []}
        bindings={props.bindings ?? []}
        maxConditioningImages={props.maxConditioningImages ?? 3}
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

describe('the schema-5 References workspace', () => {
  it('renders Characters before Backgrounds and disables background generation until all characters are approved', () => {
    const { container } = renderWorkflow({
      references: [
        workflowReference(),
        workflowReference({
          id: 'reference_dai_pai_dong',
          kind: 'background',
          label: 'Dai pai dong',
          candidateAssetId: null,
          generationStatus: 'idle',
        }),
      ],
    });

    const charactersTitle = screen.getByText(`${WORKFLOW_KEY}.characters.title`);
    const backgroundsTitle = screen.getByText(`${WORKFLOW_KEY}.backgrounds.title`);
    expect(charactersTitle.compareDocumentPosition(backgroundsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(`${WORKFLOW_KEY}.backgrounds.charactersRequired`)).toBeVisible();
    const backgroundCard = screen.getByText('Dai pai dong').closest('[data-reference-id]');
    expect(backgroundCard).not.toBeNull();
    expect(within(backgroundCard!).getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` })).toBeDisabled();
    expect(container.querySelectorAll('[data-reference-id]')).toHaveLength(2);
  });

  it('starts with actionable backgrounds when the plan has no named characters', () => {
    renderWorkflow({
      references: [
        workflowReference({
          id: 'reference_dai_pai_dong',
          kind: 'background',
          label: 'Dai pai dong',
          candidateAssetId: null,
          generationStatus: 'idle',
        }),
      ],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.characters.empty`)).toBeVisible();
    const card = screen.getByText('Dai pai dong').closest('[data-reference-id]');
    expect(within(card!).getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` })).toBeEnabled();
  });

  it('adds the first background through the explicit typed action and closes only after success', async () => {
    const actions = createActions();
    vi.mocked(actions.addBackground).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderWorkflow({
      actions,
      references: [workflowReference({ approvedAssetId: 'asset_ming_approved', candidateAssetId: null })],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.backgrounds.empty`)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.backgrounds.add` }));
    const confirm = screen.getByRole('button', { name: `${WORKFLOW_KEY}.backgrounds.confirm` });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`${WORKFLOW_KEY}.backgrounds.nameLabel`), {
      target: { value: '  Dai pai dong  ' },
    });
    fireEvent.change(screen.getByLabelText(`${WORKFLOW_KEY}.backgrounds.promptLabel`), {
      target: { value: '  A compact food stall beneath a red awning.  ' },
    });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(actions.addBackground).toHaveBeenCalledExactlyOnceWith({
        label: 'Dai pai dong',
        prompt: 'A compact food stall beneath a red awning.',
      })
    );
    expect(screen.getByRole('dialog', { name: `${WORKFLOW_KEY}.backgrounds.addTitle` })).toBeVisible();

    fireEvent.click(confirm);
    await waitFor(() => expect(actions.addBackground).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: `${WORKFLOW_KEY}.backgrounds.addTitle` })).toBeNull()
    );
  });

  it('blocks duplicate background names before invoking the typed action', () => {
    const { actions } = renderWorkflow({
      references: [
        workflowReference({ approvedAssetId: 'asset_ming_approved', candidateAssetId: null }),
        workflowReference({
          id: 'reference_market',
          kind: 'background',
          label: 'Market',
          approvedAssetId: null,
          candidateAssetId: null,
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.backgrounds.add` }));
    fireEvent.change(screen.getByLabelText(`${WORKFLOW_KEY}.backgrounds.nameLabel`), {
      target: { value: 'Market' },
    });
    fireEvent.change(screen.getByLabelText(`${WORKFLOW_KEY}.backgrounds.promptLabel`), {
      target: { value: 'A duplicate market.' },
    });
    expect(screen.getByText(`${WORKFLOW_KEY}.backgrounds.duplicate`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.backgrounds.confirm` })).toBeDisabled();
    expect(actions.addBackground).not.toHaveBeenCalled();
  });

  it('approves the exact visible candidate while keeping regeneration separately explicit', async () => {
    const { actions } = renderWorkflow({ references: [workflowReference()] });

    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.approve` }));
    await waitFor(() => expect(actions.approve).toHaveBeenCalledWith('reference_ming', 'asset_ming_candidate'));
    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` }));
    expect(actions.regenerate).toHaveBeenCalledWith('reference_ming');
  });

  it('distinguishes a replacement candidate from the retained approved canonical image', () => {
    const { container } = renderWorkflow({
      references: [workflowReference({ approvedAssetId: 'asset_ming_approved' })],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.status.candidate`)).toBeVisible();
    expect(screen.getByText(`${WORKFLOW_KEY}.status.approved`)).toBeVisible();
    const approved = container.querySelector<HTMLElement>('[data-reference-preview="approved"]');
    const candidate = container.querySelector<HTMLElement>('[data-reference-preview="candidate"]');
    expect(within(approved!).getByRole('img')).toHaveAttribute('src', expect.stringContaining('asset_ming_approved'));
    expect(within(candidate!).getByRole('img')).toHaveAttribute('src', expect.stringContaining('asset_ming_candidate'));
  });

  it('shows approval progress and enables Continue to Table only from durable approval readiness', () => {
    const references = [workflowReference()];
    const { actions, rerender } = renderWorkflow({ references });

    expect(screen.getByText(`${WORKFLOW_KEY}.approvalProgress:{"approved":0,"total":1}`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.continueToTable` })).toBeDisabled();
    rerender(
      <ReferencesView
        projectId='project_1'
        references={[workflowReference({ approvedAssetId: 'asset_ming_candidate', candidateAssetId: null })]}
        bindings={[]}
        maxConditioningImages={3}
        readyForTable
        pendingReferenceId={null}
        gateLocked={false}
        errorMessageKey={null}
        actions={actions}
      />
    );
    expect(screen.getByText(`${WORKFLOW_KEY}.approvalProgress:{"approved":1,"total":1}`)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.continueToTable` }));
    expect(actions.continueToTable).toHaveBeenCalledTimes(1);
  });

  it('lists every active Shot binding and leaves unassigned/invalid rows visibly actionable', async () => {
    const references = [
      workflowReference({ approvedAssetId: 'asset_ming_approved', candidateAssetId: null }),
      workflowReference({
        id: 'reference_dai_pai_dong',
        kind: 'background',
        label: 'Dai pai dong',
        approvedAssetId: 'asset_background_approved',
        candidateAssetId: null,
      }),
    ];
    const bindings = [
      binding(),
      binding({
        shotId: 'shot_mei',
        shotPosition: 2,
        shootingScript: 'Mei looks up from the counter.',
        status: 'invalid',
        characterReferenceIds: ['reference_ming'],
        backgroundReferenceId: 'reference_dai_pai_dong',
      }),
    ];
    const { actions, container } = renderWorkflow({ references, bindings });

    expect(container.querySelectorAll('[data-shot-id]')).toHaveLength(2);
    expect(container.querySelector('[data-shot-id="shot_ming"]')).toHaveAttribute(
      'data-shot-binding-status',
      'unassigned'
    );
    const invalid = container.querySelector<HTMLElement>('[data-shot-id="shot_mei"]');
    expect(invalid).toHaveAttribute('data-shot-binding-status', 'invalid');
    expect(within(invalid!).getByRole('alert')).toHaveTextContent(`${WORKFLOW_KEY}.bindings.invalid`);
    fireEvent.click(within(invalid!).getByRole('button', { name: `${WORKFLOW_KEY}.bindings.save` }));
    await waitFor(() =>
      expect(actions.saveBinding).toHaveBeenCalledWith('shot_mei', ['reference_ming'], 'reference_dai_pai_dong')
    );
  });

  it('blocks an over-capacity exact Shot binding before save', () => {
    const references = ['ming', 'mei', 'chen'].map((name) =>
      workflowReference({
        id: `reference_${name}`,
        label: name,
        approvedAssetId: `asset_${name}`,
        candidateAssetId: null,
      })
    );
    renderWorkflow({
      references,
      bindings: [
        binding({
          status: 'ready',
          characterReferenceIds: ['reference_ming', 'reference_mei', 'reference_chen'],
        }),
      ],
      maxConditioningImages: 2,
    });

    expect(screen.getByRole('alert')).toHaveTextContent(`${WORKFLOW_KEY}.bindings.capacity:{"count":3,"limit":2}`);
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.bindings.save` })).toBeDisabled();
  });

  it('blocks duplicate regeneration while the durable candidate job is active', () => {
    renderWorkflow({
      references: [workflowReference({ candidateAssetId: null, generationStatus: 'running' })],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.status.running`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` })).toBeDisabled();
  });

  it('exposes exact retry/cancel recovery while keeping paid regeneration blocked', async () => {
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

  it('requires duplicate-charge acknowledgement for an unknown submission', async () => {
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

  it('scrolls to and briefly highlights the exact reference or Shot binding once per focus intent', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const references = [workflowReference(), workflowReference({ id: 'reference_mei', label: 'Mei' })];
    const bindings = [binding(), binding({ shotId: 'shot_mei', shotPosition: 2 })];
    const onFocusIntentConsumed = vi.fn();
    const { actions, rerender, container } = renderWorkflow({
      references,
      bindings,
      focusIntent: {
        id: 'focus-1',
        projectId: 'project_1',
        referenceIds: ['reference_mei'],
        assetIds: [],
        shotIds: [],
      },
      onFocusIntentConsumed,
    });

    expect(screen.getByText('Mei').closest('[data-reference-id]')).toHaveAttribute(
      'data-reference-highlighted',
      'true'
    );
    expect(screen.getByText(`${WORKFLOW_KEY}.characters.title`)).toHaveFocus();
    expect(onFocusIntentConsumed).toHaveBeenCalledExactlyOnceWith('focus-1');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rerender(
      <ReferencesView
        actions={actions}
        bindings={bindings}
        errorMessageKey={null}
        focusIntent={{
          id: 'focus-2',
          projectId: 'project_1',
          referenceIds: [],
          assetIds: [],
          shotIds: ['shot_mei'],
        }}
        gateLocked={false}
        maxConditioningImages={3}
        onFocusIntentConsumed={onFocusIntentConsumed}
        pendingReferenceId={null}
        projectId='project_1'
        readyForTable={false}
        references={references}
      />
    );
    expect(container.querySelector('[data-shot-id="shot_mei"]')).toHaveAttribute(
      'data-shot-binding-highlighted',
      'true'
    );
    expect(screen.getByText(`${WORKFLOW_KEY}.bindings.title`)).toHaveFocus();
    expect(onFocusIntentConsumed).toHaveBeenLastCalledWith('focus-2');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1_600));
    expect(container.querySelector('[data-shot-id="shot_mei"]')).not.toHaveAttribute('data-shot-binding-highlighted');
  });
});
