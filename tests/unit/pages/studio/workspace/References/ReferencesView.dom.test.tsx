/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  referencePhotoHandle,
  type ReferenceRemovalBlocker,
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
  lastRunPrompt: 'Red jacket and round glasses',
  approvedAssetId: 'asset_ming_current',
  generatedAssetIds: ['asset_ming_current'],
  assetCreatedAt: { asset_ming_current: '2026-08-20T10:00:00.000Z' },
  assetOrdinalById: { asset_ming_current: 0 },
  removalBlockers: [],
  generationStatus: 'succeeded',
  candidateJob: null,
  ...overrides,
});

const createActions = (): ReferencesViewActions => ({
  addBackground: vi.fn(async () => true),
  updateDetails: vi.fn(async () => true),
  selectImage: vi.fn(async () => true),
  removeImage: vi.fn(async () => true),
  importPhoto: vi.fn(async () => true),
  regenerate: vi.fn(async () => true),
  retryJob: vi.fn(async () => true),
  retryDownload: vi.fn(async () => true),
  retryBlockingDownload: vi.fn(async () => true),
  reviewRetainedShot: vi.fn(async () => true),
  cancelJob: vi.fn(async () => true),
  openBindings: vi.fn(),
});

const renderWorkflow = (props: Partial<React.ComponentProps<typeof ReferencesView>> = {}) => {
  const actions = props.actions ?? createActions();
  return {
    actions,
    ...render(
      <ReferencesView
        actions={actions}
        aspectRatio='16:9'
        errorMessageKey={null}
        gateLocked={false}
        pendingReferenceId={null}
        projectId='project_1'
        references={[]}
        {...props}
      />
    ),
  };
};

const WORKFLOW_KEY = 'conversation.creativeStudio.workspace.referenceWorkflow';
const PANEL_KEY = `${WORKFLOW_KEY}.panel`;

describe('the schema-5 References workspace', () => {
  it('renders Characters before Places and enforces character-first generation', () => {
    const { container } = renderWorkflow({
      references: [
        workflowReference({ approvedAssetId: null, generatedAssetIds: [], assetCreatedAt: {}, lastRunPrompt: null }),
        workflowReference({
          id: 'reference_dai_pai_dong',
          kind: 'background',
          label: 'Dai pai dong',
          approvedAssetId: null,
          generatedAssetIds: [],
          assetCreatedAt: {},
          lastRunPrompt: null,
          generationStatus: 'idle',
        }),
      ],
    });

    const charactersTitle = screen.getByText(`${WORKFLOW_KEY}.characters.title`);
    const placesTitle = screen.getByText(`${PANEL_KEY}.places`);
    expect(charactersTitle.compareDocumentPosition(placesTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(`${WORKFLOW_KEY}.backgrounds.charactersRequired`)).toBeVisible();
    const cards = container.querySelectorAll<HTMLElement>('[data-reference-id]');
    expect(cards).toHaveLength(2);
    expect(within(cards[1]!).getByRole('button', { name: `${PANEL_KEY}.action.generate` })).toBeDisabled();
  });

  it('keeps Add character unavailable and appends the first Place through the typed action', async () => {
    const actions = createActions();
    vi.mocked(actions.addBackground).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderWorkflow({ actions, references: [workflowReference()] });

    expect(screen.getByRole('button', { name: `${PANEL_KEY}.addCharacter` })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: `${PANEL_KEY}.addPlace` }));
    const confirm = screen.getByRole('button', { name: `${WORKFLOW_KEY}.backgrounds.confirm` });
    fireEvent.change(screen.getByLabelText(`${WORKFLOW_KEY}.backgrounds.nameLabel`), {
      target: { value: '  Dai pai dong  ' },
    });
    fireEvent.change(screen.getByLabelText(`${WORKFLOW_KEY}.backgrounds.promptLabel`), {
      target: { value: '  A compact food stall beneath a red awning.  ' },
    });

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
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('blocks duplicate Place names before invoking the typed append action', () => {
    const { actions } = renderWorkflow({
      references: [
        workflowReference(),
        workflowReference({ id: 'reference_market', kind: 'background', label: 'Market' }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: `${PANEL_KEY}.addPlace` }));
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

  it('shows only NO PHOTO, CURRENT SET, and GENERATING in the identity rows', () => {
    const { container } = renderWorkflow({
      references: [
        workflowReference({
          id: 'reference_empty',
          label: 'Empty',
          approvedAssetId: null,
          generatedAssetIds: [],
          assetCreatedAt: {},
          lastRunPrompt: null,
        }),
        workflowReference(),
        workflowReference({ id: 'reference_running', label: 'Running', generationStatus: 'running' }),
      ],
    });

    const statuses = [...container.querySelectorAll('[data-reference-status]')];
    expect(statuses.map((status) => status.getAttribute('data-reference-status'))).toEqual([
      'noPhoto',
      'current',
      'generating',
    ]);
    expect(screen.getByText(`${PANEL_KEY}.status.noPhoto`)).toBeVisible();
    expect(screen.getByText(`${PANEL_KEY}.status.current`)).toBeVisible();
    expect(screen.getByText(`${PANEL_KEY}.status.generating`)).toBeVisible();
  });

  it('derives stable display handles from immutable creation order and does not store them', async () => {
    const actions = createActions();
    const { rerender } = renderWorkflow({
      actions,
      references: [
        workflowReference({
          approvedAssetId: 'asset_new',
          generatedAssetIds: ['asset_new', 'asset_old'],
          assetCreatedAt: {
            asset_new: '2026-08-21T10:00:00.000Z',
            asset_old: '2026-08-20T10:00:00.000Z',
          },
          assetOrdinalById: { asset_old: 0, asset_new: 1 },
        }),
      ],
    });

    expect(referencePhotoHandle('Míng Wong', 'character', 0)).toBe('@ming-wong-01');
    fireEvent.click(screen.getByRole('button', { name: `${PANEL_KEY}.choosePhoto:{"handle":"@ming-01"}` }));
    await waitFor(() => expect(actions.selectImage).toHaveBeenCalledWith('reference_ming', 'asset_old'));

    rerender(
      <ReferencesView
        actions={actions}
        aspectRatio='16:9'
        errorMessageKey={null}
        gateLocked={false}
        pendingReferenceId={null}
        projectId='project_1'
        references={[
          workflowReference({
            approvedAssetId: 'asset_old',
            generatedAssetIds: ['asset_old', 'asset_new'],
            assetCreatedAt: {
              asset_new: '2026-08-21T10:00:00.000Z',
              asset_old: '2026-08-20T10:00:00.000Z',
            },
            assetOrdinalById: { asset_old: 0, asset_new: 1 },
          }),
        ]}
      />
    );
    expect(screen.getByRole('button', { name: `${PANEL_KEY}.choosePhoto:{"handle":"@ming-01"}` })).toHaveAttribute(
      'aria-current',
      'true'
    );

    rerender(
      <ReferencesView
        actions={actions}
        aspectRatio='16:9'
        errorMessageKey={null}
        gateLocked={false}
        pendingReferenceId={null}
        projectId='project_1'
        references={[
          workflowReference({
            approvedAssetId: 'asset_new',
            generatedAssetIds: ['asset_new'],
            assetCreatedAt: { asset_new: '2026-08-21T10:00:00.000Z' },
            assetOrdinalById: { asset_new: 1 },
          }),
        ]}
      />
    );
    expect(screen.getByRole('button', { name: `${PANEL_KEY}.choosePhoto:{"handle":"@ming-02"}` })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(screen.getByRole('button', { name: `${PANEL_KEY}.removePhoto:{"handle":"@ming-02"}` })).toBeEnabled();
  });

  it('saves inline identity edits and generates from the exact edited prompt', async () => {
    const { actions } = renderWorkflow({ references: [workflowReference()] });
    const name = screen.getByLabelText(new RegExp(`${PANEL_KEY}\\.nameLabel`));
    const prompt = screen.getByLabelText(new RegExp(`${PANEL_KEY}\\.promptLabel`));

    fireEvent.change(name, { target: { value: '  Ming Wong  ' } });
    fireEvent.change(prompt, { target: { value: '  Red jacket, round glasses, neutral turnaround  ' } });
    fireEvent.blur(prompt);
    await waitFor(() =>
      expect(actions.updateDetails).toHaveBeenCalledWith('reference_ming', {
        label: 'Ming Wong',
        prompt: 'Red jacket, round glasses, neutral turnaround',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: `${PANEL_KEY}.action.generateAgain` }));
    await waitFor(() =>
      expect(actions.regenerate).toHaveBeenCalledWith('reference_ming', 'Red jacket, round glasses, neutral turnaround')
    );
  });

  it('removes only the exact current photo and disables removal while an exact blocker remains', async () => {
    const actions = createActions();
    const { rerender } = renderWorkflow({ actions, references: [workflowReference()] });
    const remove = screen.getByRole('button', {
      name: `${PANEL_KEY}.removePhoto:{"handle":"@ming-01"}`,
    });
    expect(remove).toHaveClass('arco-btn-status-danger');
    fireEvent.click(remove);
    await waitFor(() =>
      expect(actions.removeImage).toHaveBeenCalledExactlyOnceWith('reference_ming', 'asset_ming_current')
    );

    rerender(
      <ReferencesView
        actions={actions}
        aspectRatio='16:9'
        errorMessageKey={null}
        gateLocked={false}
        pendingReferenceId={null}
        projectId='project_1'
        references={[
          workflowReference({
            removalBlockers: [
              {
                kind: 'active_asset_consumer',
                referenceId: 'reference_ming',
                assetId: 'asset_ming_current',
                jobId: 'job_video_active',
                createdAt: '2026-08-27T10:00:00.000Z',
                purpose: 'video_take',
                status: 'running',
                shotId: 'shot_1',
                beatId: 'beat_1',
                beatPosition: 1,
                shotPosition: 2,
              },
            ],
          }),
        ]}
      />
    );
    const blockedRemove = screen.getByRole('button', {
      name: `${PANEL_KEY}.removePhoto:{"handle":"@ming-01"}`,
    });
    expect(blockedRemove).toBeDisabled();
    expect(blockedRemove).toHaveClass('arco-btn-status-danger');
  });

  it('allows exact removal when a failed replacement-reference job does not freeze or use the current photo', () => {
    renderWorkflow({
      references: [
        workflowReference({
          removalBlockers: [],
          generationStatus: 'failed',
          candidateJob: {
            id: 'job_replacement_download_failed',
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

    expect(
      screen.getByRole('button', {
        name: `${PANEL_KEY}.removePhoto:{"handle":"@ming-01"}`,
      })
    ).toBeEnabled();
  });

  it('renders every exact blocker with truthful copy and retries only the frozen failed download', async () => {
    const actions = createActions();
    const blockers: ReferenceRemovalBlocker[] = [
      {
        kind: 'active_reference_job',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_reference_active',
        createdAt: '2026-08-27T10:00:01.000Z',
        purpose: 'reference_image',
        status: 'needs_attention',
        shotId: null,
        beatId: null,
        beatPosition: null,
        shotPosition: null,
      },
      {
        kind: 'active_asset_consumer',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_video_active',
        createdAt: '2026-08-27T10:00:02.000Z',
        purpose: 'video_take',
        status: 'running',
        shotId: 'shot_1',
        beatId: 'beat_1',
        beatPosition: 1,
        shotPosition: 2,
      },
      {
        kind: 'download_recovery',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_seed_download',
        createdAt: '2026-08-27T10:00:03.000Z',
        purpose: 'seed_still',
        status: 'failed',
        recoveryAction: 'restore_shot',
        retainedOwner: {
          kind: 'shot',
          beatId: 'beat_retained_owner',
          shotId: 'shot_retained',
          reason: 'lifted',
        },
        shotId: 'shot_retained',
        beatId: null,
        beatPosition: null,
        shotPosition: null,
      },
      {
        kind: 'download_recovery',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_seed_download_in_beat',
        createdAt: '2026-08-27T10:00:03.500Z',
        purpose: 'seed_still',
        status: 'failed',
        recoveryAction: 'restore_shot',
        retainedOwner: { kind: 'beat', beatId: 'beat_retained', reason: 'alternate' },
        shotId: 'shot_in_retained_beat',
        beatId: null,
        beatPosition: null,
        shotPosition: null,
      },
      {
        kind: 'active_asset_consumer',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_retained_active',
        createdAt: '2026-08-27T10:00:04.000Z',
        purpose: 'board_still',
        status: 'queued_remote',
        shotId: 'shot_retained',
        beatId: null,
        beatPosition: null,
        shotPosition: null,
      },
      {
        kind: 'active_asset_consumer',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_other_active',
        createdAt: '2026-08-27T10:00:05.000Z',
        purpose: 'seed_still',
        status: 'queued_local',
        shotId: null,
        beatId: null,
        beatPosition: null,
        shotPosition: null,
      },
      {
        kind: 'download_recovery',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_video_download',
        createdAt: '2026-08-27T10:00:06.000Z',
        purpose: 'video_take',
        status: 'failed',
        recoveryAction: 'retry_download',
        shotId: 'shot_2',
        beatId: 'beat_2',
        beatPosition: 2,
        shotPosition: 1,
      },
      {
        kind: 'download_recovery',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_other_download',
        createdAt: '2026-08-27T10:00:07.000Z',
        purpose: 'board_still',
        status: 'failed',
        recoveryAction: 'retry_download',
        shotId: null,
        beatId: null,
        beatPosition: null,
        shotPosition: null,
      },
    ];
    const { container } = renderWorkflow({
      actions,
      references: [workflowReference({ removalBlockers: blockers })],
    });

    expect(container.querySelectorAll('[data-reference-removal-blocker]')).toHaveLength(8);
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.activeReferenceJob:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.reference_image","jobId":"job_reference_active"}`
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.activeAssetConsumer:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.video_take","beatPosition":1,"shotPosition":2}`
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.downloadRecoveryRetainedShot:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.seed_still","shotId":"shot_retained"}`
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.downloadRecoveryRetainedBeat:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.seed_still","shotId":"shot_in_retained_beat","beatId":"beat_retained"}`
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.activeAssetConsumerRetained:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.board_still","shotId":"shot_retained"}`
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.activeAssetConsumerOther:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.seed_still","jobId":"job_other_active"}`
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.downloadRecovery:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.video_take","beatPosition":2,"shotPosition":1}`
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        `${PANEL_KEY}.removalBlocker.downloadRecoveryOther:{"purpose":"conversation.creativeStudio.workspace.gate.purpose.board_still","jobId":"job_other_download"}`
      )
    ).toBeVisible();
    expect(container.querySelectorAll('[data-blocker-kind="download_recovery"] button')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: `${PANEL_KEY}.removalBlocker.reviewInBoard` })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'conversation.creativeStudio.jobs.retryDownload' })).toHaveLength(2);
    expect(container.querySelectorAll('[data-blocker-kind="active_reference_job"] button')).toHaveLength(0);
    expect(container.querySelectorAll('[data-blocker-kind="active_asset_consumer"] button')).toHaveLength(0);

    const retainedRecovery = container.querySelector<HTMLElement>(
      '[data-reference-removal-blocker="job_seed_download"]'
    );
    expect(retainedRecovery).not.toBeNull();
    fireEvent.click(
      within(retainedRecovery!).getByRole('button', { name: `${PANEL_KEY}.removalBlocker.reviewInBoard` })
    );
    await waitFor(() =>
      expect(actions.reviewRetainedShot).toHaveBeenCalledExactlyOnceWith({
        kind: 'download_recovery',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_seed_download',
        createdAt: '2026-08-27T10:00:03.000Z',
        purpose: 'seed_still',
        status: 'failed',
        recoveryAction: 'restore_shot',
        retainedOwner: {
          kind: 'shot',
          beatId: 'beat_retained_owner',
          shotId: 'shot_retained',
          reason: 'lifted',
        },
        shotId: 'shot_retained',
        beatId: null,
        beatPosition: null,
        shotPosition: null,
      })
    );
    expect(actions.openBindings).not.toHaveBeenCalled();
    expect(actions.retryBlockingDownload).not.toHaveBeenCalled();

    const activeRecovery = container.querySelector<HTMLElement>(
      '[data-reference-removal-blocker="job_video_download"]'
    );
    expect(activeRecovery).not.toBeNull();
    fireEvent.click(
      within(activeRecovery!).getByRole('button', { name: 'conversation.creativeStudio.jobs.retryDownload' })
    );
    await waitFor(() =>
      expect(actions.retryBlockingDownload).toHaveBeenCalledExactlyOnceWith({
        kind: 'download_recovery',
        recoveryAction: 'retry_download',
        referenceId: 'reference_ming',
        assetId: 'asset_ming_current',
        jobId: 'job_video_download',
        createdAt: '2026-08-27T10:00:06.000Z',
        purpose: 'video_take',
        status: 'failed',
        shotId: 'shot_2',
        beatId: 'beat_2',
        beatPosition: 2,
        shotPosition: 1,
      })
    );
    expect(actions.retryDownload).not.toHaveBeenCalled();
  });

  it('renders malformed current-reference authority as a non-actionable removal blocker', () => {
    const { container } = renderWorkflow({
      references: [
        workflowReference({
          removalBlockers: [
            {
              kind: 'invalid_authority',
              referenceId: 'reference_ming',
              assetId: 'asset_ming_current',
            },
          ],
        }),
      ],
    });

    expect(screen.getByText(`${PANEL_KEY}.removalBlocker.invalidAuthority`)).toBeVisible();
    expect(container.querySelector('[data-blocker-kind="invalid_authority"] button')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: `${PANEL_KEY}.removePhoto:{"handle":"@ming-01"}`,
      })
    ).toBeDisabled();
  });

  it('keeps Import photo available after a repeated variation-grid refusal', async () => {
    const actions = createActions();
    renderWorkflow({
      actions,
      references: [
        workflowReference({
          approvedAssetId: null,
          generatedAssetIds: [],
          assetCreatedAt: {},
          assetOrdinalById: {},
          generationStatus: 'failed',
          candidateJob: {
            id: 'job_grid_retry',
            status: 'failed',
            error: {
              code: 'seed_still_variation_grid',
              messageKey: 'conversation.creativeStudio.jobs.errors.referenceVariationGridRepeated',
            },
            canRetry: false,
            canRetryDownload: false,
            canCancel: false,
          },
        }),
      ],
    });

    expect(screen.getByText('conversation.creativeStudio.jobs.errors.referenceVariationGridRepeated')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `${PANEL_KEY}.importPhoto` }));
    await waitFor(() => expect(actions.importPhoto).toHaveBeenCalledExactlyOnceWith('reference_ming'));
  });

  it('opens per-Shot binding only after every planned reference has a current image', () => {
    const actions = createActions();
    const { rerender } = renderWorkflow({
      actions,
      references: [
        workflowReference({
          approvedAssetId: null,
          generatedAssetIds: [],
          assetCreatedAt: {},
          lastRunPrompt: null,
        }),
      ],
    });
    expect(screen.getByRole('button', { name: `${PANEL_KEY}.bindShots` })).toBeDisabled();

    rerender(
      <ReferencesView
        actions={actions}
        aspectRatio='16:9'
        errorMessageKey={null}
        gateLocked={false}
        pendingReferenceId={null}
        projectId='project_1'
        references={[workflowReference()]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: `${PANEL_KEY}.bindShots` }));
    expect(actions.openBindings).toHaveBeenCalledOnce();
  });

  it('sizes the canonical picture and its takes from the project ratio, cropping neither', () => {
    const css = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/References.module.css'
      ),
      'utf8'
    );

    expect(css).toMatch(/\.root\s*\{[^}]*inline-size:\s*min\(100%, 1000px\)/s);
    expect(css).toMatch(
      /\.pictureBand\s*\{[^}]*aspect-ratio:\s*var\(--studio-reference-aspect-ratio, 16 \/ 9\)[^}]*background:\s*var\(--studio-reference-matte\)/s
    );
    expect(css).toMatch(/--studio-reference-matte:\s*rgb\(239 231 216\)/s);
    expect(css).not.toMatch(/\.pictureBand\s*\{[^}]*block-size:\s*156px/s);
    expect(css).toMatch(/\.pictureBand\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.pictureBand\s*\{[^}]*place-items:\s*stretch/s);
    expect(css).toMatch(/\.pictureBand img\s*\{[^}]*object-fit:\s*contain/s);
    expect(css).toMatch(/\.take img\s*\{[^}]*object-fit:\s*contain/s);
    expect(css).toMatch(/\.take img\s*\{[^}]*aspect-ratio:\s*var\(--studio-reference-aspect-ratio, 16 \/ 9\)/s);
    for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4']) {
      const [width, height] = ratio.split(':');
      expect(css).toMatch(
        new RegExp(
          `\\.root\\[data-aspect-ratio='${ratio}'\\]\\s*\\{[^}]*--studio-reference-aspect-ratio:\\s*${width} / ${height}`,
          's'
        )
      );
    }
    expect(css).toMatch(/\.removalBlocker span\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('exposes exact retry and cancellation recovery while regeneration stays blocked', async () => {
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

    expect(screen.getByRole('button', { name: `${PANEL_KEY}.action.generateAnother` })).toBeDisabled();
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
    const onFocusIntentConsumed = vi.fn();
    const { container } = renderWorkflow({
      references: [workflowReference(), workflowReference({ id: 'reference_mei', label: 'Mei' })],
      focusIntent: {
        id: 'focus-1',
        projectId: 'project_1',
        referenceIds: ['reference_mei'],
        assetIds: [],
        shotIds: [],
      },
      onFocusIntentConsumed,
    });

    expect(container.querySelector('[data-reference-id="reference_mei"]')).toHaveAttribute(
      'data-reference-highlighted',
      'true'
    );
    expect(onFocusIntentConsumed).toHaveBeenCalledExactlyOnceWith('focus-1');
    expect(scrollIntoView).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1_600));
    expect(container.querySelector('[data-reference-id="reference_mei"]')).not.toHaveAttribute(
      'data-reference-highlighted'
    );
  });
});
