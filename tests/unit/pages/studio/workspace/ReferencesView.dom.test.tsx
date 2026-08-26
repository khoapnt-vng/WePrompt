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
  prompt: 'Red jacket and round glasses',
  approvedAssetId: 'asset_ming_current',
  generatedAssetIds: ['asset_ming_current'],
  generationStatus: 'succeeded',
  candidateJob: null,
  ...overrides,
});

const createActions = (): ReferencesViewActions => ({
  addBackground: vi.fn(async () => true),
  selectImage: vi.fn(async () => true),
  regenerate: vi.fn(async () => true),
  retryJob: vi.fn(async () => true),
  retryDownload: vi.fn(async () => true),
  cancelJob: vi.fn(async () => true),
});

const renderWorkflow = (props: Partial<React.ComponentProps<typeof ReferencesView>> = {}) => {
  const actions = props.actions ?? createActions();
  return {
    actions,
    ...render(
      <ReferencesView
        projectId='project_1'
        references={props.references ?? []}
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
  it('renders Characters before Backgrounds and disables background generation until all characters are generated', () => {
    const { container } = renderWorkflow({
      references: [
        workflowReference({ approvedAssetId: null, generatedAssetIds: [] }),
        workflowReference({
          id: 'reference_dai_pai_dong',
          kind: 'background',
          label: 'Dai pai dong',
          approvedAssetId: null,
          generatedAssetIds: [],
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
          approvedAssetId: null,
          generatedAssetIds: [],
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
      references: [
        workflowReference({ approvedAssetId: 'asset_ming_current', generatedAssetIds: ['asset_ming_current'] }),
      ],
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
        workflowReference({ approvedAssetId: 'asset_ming_current', generatedAssetIds: ['asset_ming_current'] }),
        workflowReference({
          id: 'reference_market',
          kind: 'background',
          label: 'Market',
          approvedAssetId: null,
          generatedAssetIds: [],
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

  it('keeps the prompt off the card and submits an edited prompt from the regenerate review', async () => {
    const { actions } = renderWorkflow({ references: [workflowReference()] });

    expect(screen.queryByDisplayValue('Red jacket and round glasses')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` }));
    const prompt = screen.getByLabelText(`${WORKFLOW_KEY}.regeneratePromptLabel`);
    expect(prompt).toHaveValue('Red jacket and round glasses');
    fireEvent.change(prompt, { target: { value: '  Red jacket, round glasses, neutral turnaround  ' } });
    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.reviewGeneration` }));
    await waitFor(() =>
      expect(actions.regenerate).toHaveBeenCalledWith('reference_ming', 'Red jacket, round glasses, neutral turnaround')
    );
  });

  it('shows one large current image and can repoint it to a generated historical image', async () => {
    const actions = createActions();
    const { container } = renderWorkflow({
      actions,
      references: [
        workflowReference({
          approvedAssetId: 'asset_ming_current',
          generatedAssetIds: ['asset_ming_current', 'asset_ming_previous'],
        }),
      ],
    });

    expect(container.querySelectorAll('[data-reference-preview="current"]')).toHaveLength(1);
    expect(container.querySelector('[data-reference-preview="current"] img')).toHaveAttribute(
      'src',
      expect.stringContaining('asset_ming_current')
    );
    expect(container.querySelector('[data-fullscreen-media-frame]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${WORKFLOW_KEY}.chooseGenerated` }));
    const history = screen.getByRole('region', { name: `${WORKFLOW_KEY}.generatedHistory` });
    const choose = within(history).getByRole('button', { name: new RegExp(`${WORKFLOW_KEY}.historyChoose`) });
    fireEvent.click(choose);
    await waitFor(() => expect(actions.selectImage).toHaveBeenCalledWith('reference_ming', 'asset_ming_previous'));
  });

  it('shows current-image progress without owning the Shot-binding handoff', () => {
    const references = [workflowReference({ approvedAssetId: null, generatedAssetIds: [] })];
    const { actions, rerender } = renderWorkflow({ references });

    expect(screen.getByText(`${WORKFLOW_KEY}.currentProgress:{"current":0,"total":1}`)).toBeVisible();
    rerender(
      <ReferencesView
        projectId='project_1'
        references={[workflowReference()]}
        pendingReferenceId={null}
        gateLocked={false}
        errorMessageKey={null}
        actions={actions}
      />
    );
    expect(screen.getByText(`${WORKFLOW_KEY}.currentProgress:{"current":1,"total":1}`)).toBeVisible();
    expect(screen.queryByText(new RegExp(`${WORKFLOW_KEY}\\.bindings`))).toBeNull();
  });

  it('blocks duplicate regeneration while the durable candidate job is active', () => {
    renderWorkflow({
      references: [workflowReference({ approvedAssetId: null, generatedAssetIds: [], generationStatus: 'running' })],
    });

    expect(screen.getByText(`${WORKFLOW_KEY}.status.running`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${WORKFLOW_KEY}.regenerate` })).toBeDisabled();
  });

  it('exposes exact retry/cancel recovery while keeping paid regeneration blocked', async () => {
    const { actions } = renderWorkflow({
      references: [
        workflowReference({
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

  it('scrolls to and briefly highlights the exact reference once per focus intent', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const references = [workflowReference(), workflowReference({ id: 'reference_mei', label: 'Mei' })];
    const onFocusIntentConsumed = vi.fn();
    const { actions, rerender, container } = renderWorkflow({
      references,
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
        errorMessageKey={null}
        focusIntent={{
          id: 'focus-2',
          projectId: 'project_1',
          referenceIds: ['reference_ming'],
          assetIds: [],
          shotIds: [],
        }}
        gateLocked={false}
        onFocusIntentConsumed={onFocusIntentConsumed}
        pendingReferenceId={null}
        projectId='project_1'
        references={references}
      />
    );
    expect(container.querySelector('[data-reference-id="reference_ming"]')).toHaveAttribute(
      'data-reference-highlighted',
      'true'
    );
    expect(screen.getByText(`${WORKFLOW_KEY}.characters.title`)).toHaveFocus();
    expect(onFocusIntentConsumed).toHaveBeenLastCalledWith('focus-2');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1_600));
    expect(container.querySelector('[data-reference-id="reference_ming"]')).not.toHaveAttribute(
      'data-reference-highlighted'
    );
  });
});
