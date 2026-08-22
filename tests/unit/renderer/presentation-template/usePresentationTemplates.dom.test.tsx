/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DiscardPresentationRunResult,
  ListRecoverablePresentationRunsResult,
  OpenPresentationRunResult,
  PresentationRunPublicDto,
} from '@/common/types/office/presentationRun';
import type {
  PresentationTemplateFormat,
  PresentationTemplateSummary,
} from '@/common/types/office/presentationTemplate';
import {
  getPresentationRunEligibility,
  resolveManagedPresentationInitialSend,
  type PresentationRunEligibilityInput,
  usePresentationTemplates,
} from '@/renderer/components/chat/TemplateGallery/usePresentationTemplates';
import { emitter } from '@/renderer/utils/emitter';
import enUSConversation from '@/renderer/services/i18n/locales/en-US/conversation.json';

const {
  allocateScratchInvokeMock,
  activeRecoveryNoticeIds,
  completeScratchInvokeMock,
  discardPresentationRunInvokeMock,
  discardScratchInvokeMock,
  listRecoverableInvokeMock,
  messageErrorMock,
  messageSuccessMock,
  messageWarningMock,
  openRecoveryInvokeMock,
  pendingRecoveryNoticeCloses,
  retainScratchInvokeMock,
} = vi.hoisted(() => ({
  allocateScratchInvokeMock: vi.fn(),
  activeRecoveryNoticeIds: new Set<string>(),
  completeScratchInvokeMock: vi.fn(),
  discardPresentationRunInvokeMock: vi.fn(),
  discardScratchInvokeMock: vi.fn(),
  listRecoverableInvokeMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageWarningMock: vi.fn(),
  openRecoveryInvokeMock: vi.fn(),
  pendingRecoveryNoticeCloses: [] as Array<() => void>,
  retainScratchInvokeMock: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    'aria-label'?: string;
  }) => createElement('button', { type: 'button', 'aria-label': ariaLabel, onClick }, children),
  Message: {
    error: messageErrorMock,
    success: messageSuccessMock,
    warning: messageWarningMock,
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    presentationTemplates: {
      list: { invoke: vi.fn().mockResolvedValue([]) },
      importSpec: { invoke: vi.fn() },
      remove: { invoke: vi.fn() },
      allocateScratch: { invoke: allocateScratchInvokeMock },
      completeScratch: { invoke: completeScratchInvokeMock },
      retainScratch: { invoke: retainScratchInvokeMock },
      discardScratch: { invoke: discardScratchInvokeMock },
    },
    presentationRuns: {
      listRecoverable: { invoke: listRecoverableInvokeMock },
      openRecovery: { invoke: openRecoveryInvokeMock },
      discard: { invoke: discardPresentationRunInvokeMock },
    },
    dialog: {
      showOpen: { invoke: vi.fn() },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { sha256?: string }) => (values?.sha256 ? `${key}:${values.sha256}` : key),
  }),
}));

const template: PresentationTemplateSummary = {
  manifest: {
    id: 'business-review',
    name: 'Business Review',
    description: 'Quarterly review',
    format: 'pptx',
    kind: 'deck',
    source: 'builtin',
    themeFile: 'THEME.md',
    referenceFile: 'reference.pptx',
    preview: 'preview.svg',
    version: 1,
    createdAt: 'now',
  },
  themePath: '/templates/business-review/THEME.md',
  referencePath: '/templates/business-review/reference.pptx',
  previewDataUrl: 'data:image/svg+xml;base64,x',
};

const allocation = {
  runId: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
  directory: '/tmp/aionui-artifact-runs/5a68fccc-7b90-49b4-88f9-d78bb88255ed',
  readyMarker: '/tmp/aionui-artifact-runs/5a68fccc-7b90-49b4-88f9-d78bb88255ed/.aionui-delivery-ready',
};

const recoveryBase = {
  clientRequestId: '52f128ab-8845-4100-bca2-bc0a85433214',
  conversationId: 'd0921953',
  selectedTemplateId: 'business-review',
  revision: 7,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

function makeReviewRun(overrides: Partial<PresentationRunPublicDto> = {}): PresentationRunPublicDto {
  return {
    ...recoveryBase,
    runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
    dispatchStatus: 'retained',
    artifactPhase: 'rendered_exact_hash',
    disposition: 'REVIEW_REQUIRED',
    retainedCandidate: {
      sha256: 'a'.repeat(64),
      byteLength: 4096,
    },
    actions: { openAllowed: true, discardAllowed: true },
    ...overrides,
  } as PresentationRunPublicDto;
}

function makeTrackingRun(overrides: Partial<PresentationRunPublicDto> = {}): PresentationRunPublicDto {
  return {
    ...recoveryBase,
    runId: 'cdf7551c-0630-4e17-ae42-c4dceae76739',
    dispatchStatus: 'retained',
    artifactPhase: 'sources_extracted',
    disposition: 'TRACKING_REQUIRED',
    retainedCandidate: null,
    actions: { openAllowed: false, discardAllowed: false },
    ...overrides,
  } as PresentationRunPublicDto;
}

function successfulRecoveryList(items: PresentationRunPublicDto[], nextCursor: string | null = null) {
  return { ok: true as const, items, nextCursor };
}

function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value: T) {
      resolvePromise?.(value);
    },
    reject(reason?: unknown) {
      rejectPromise?.(reason);
    },
  };
}

function renderRecoveryMessage(index = 0) {
  const config = messageWarningMock.mock.calls[index]?.[0] as { content: ReactNode } | undefined;
  if (!config) throw new Error(`Missing recovery message at index ${index}`);
  return render(createElement('div', null, config.content));
}

async function flushPendingRecoveryNoticeCloses(): Promise<void> {
  await act(async () => {
    for (const close of pendingRecoveryNoticeCloses.splice(0)) close();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  activeRecoveryNoticeIds.clear();
  pendingRecoveryNoticeCloses.splice(0);
  messageWarningMock.mockImplementation((config?: { id?: string }) => {
    if (!config?.id) return undefined;
    const id = config.id;
    activeRecoveryNoticeIds.add(id);
    return () => {
      pendingRecoveryNoticeCloses.push(() => activeRecoveryNoticeIds.delete(id));
    };
  });
  listRecoverableInvokeMock.mockResolvedValue(successfulRecoveryList([]));
  openRecoveryInvokeMock.mockResolvedValue({
    ok: true,
    runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
    sha256: 'a'.repeat(64),
  });
  discardPresentationRunInvokeMock.mockResolvedValue({
    ok: true,
    runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
    discardedAt: '2026-08-03T00:00:00.000Z',
    alreadyDiscarded: false,
  });
});

describe('getPresentationRunEligibility', () => {
  const eligibleInput: PresentationRunEligibilityInput = {
    featureEnabled: true,
    isDesktop: true,
    scope: 'individual',
    runtime: 'aionrs',
    templateFormat: 'pptx',
  };

  it.each(['aionrs', 'acp'])('accepts a selected PPTX for the supported %s desktop runtime', (runtime) => {
    expect(getPresentationRunEligibility({ ...eligibleInput, runtime })).toBe(true);
  });

  it.each([
    { name: 'feature flag is false', override: { featureEnabled: false } },
    { name: 'environment is browser', override: { isDesktop: false } },
    { name: 'scope is team', override: { scope: 'team' as const } },
    { name: 'scope is unknown', override: { scope: 'unknown' as const } },
    { name: 'template is unselected', override: { templateFormat: null } },
    { name: 'template format is DOCX', override: { templateFormat: 'docx' as PresentationTemplateFormat } },
    { name: 'template format is HTML', override: { templateFormat: 'html' as PresentationTemplateFormat } },
    { name: 'runtime is unsupported', override: { runtime: 'claude' } },
    { name: 'runtime is unknown', override: { runtime: null } },
  ])('rejects managed UX when $name', ({ override }) => {
    expect(getPresentationRunEligibility({ ...eligibleInput, ...override })).toBe(false);
  });
});

describe('resolveManagedPresentationInitialSend', () => {
  it('recovers raw user input and the selected template without forwarding template paths', () => {
    expect(
      resolveManagedPresentationInitialSend(
        'Create a presentation from the request below. Managed rules.\n\nQuarterly review',
        [
          '/private/presentation-templates/business-review/THEME.md',
          '/private/presentation-templates/business-review/reference.pptx',
        ]
      )
    ).toEqual({
      input: 'Quarterly review',
      selectedTemplateId: 'business-review',
      injectSkills: ['officecli'],
    });
  });

  it('rejects an initial managed send that still contains a raw user attachment', () => {
    expect(
      resolveManagedPresentationInitialSend(
        'Create a presentation from the request below. Managed rules.\n\nQuarterly review',
        [
          '/private/presentation-templates/business-review/THEME.md',
          '/private/presentation-templates/business-review/reference.pptx',
          '/private/user/revenue.xlsx',
        ]
      )
    ).toBeNull();
  });

  it('keeps ACP on directive-driven OfficeCLI loading without injectSkills metadata', () => {
    expect(
      resolveManagedPresentationInitialSend(
        'Create a presentation from the request below. Managed rules.\n\nACP quarterly review',
        [
          '/private/presentation-templates/business-review/THEME.md',
          '/private/presentation-templates/business-review/reference.pptx',
        ],
        'acp'
      )
    ).toEqual({
      input: 'ACP quarterly review',
      selectedTemplateId: 'business-review',
    });
  });
});

describe('usePresentationTemplates send composition', () => {
  it('adds the creation contract when no gallery template is selected', async () => {
    const { result, unmount } = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalled());

    expect(result.current.composeSend('Save this look as a reusable template', []).input).toContain(
      'AIONUI_TEMPLATE_REVIEW_V1'
    );
    unmount();
  });

  it('does not add the creation contract to an ordinary send', async () => {
    const { result, unmount } = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalled());

    expect(result.current.composeSend('Summarize this report', ['/workspace/report.csv'])).toEqual({
      input: 'Summarize this report',
      files: ['/workspace/report.csv'],
      injectSkills: [],
    });
    unmount();
  });

  it('adds the creation contract for Vietnamese template-creation intent', async () => {
    const { result, unmount } = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalled());

    expect(result.current.composeSend('Lưu giao diện này thành template', []).input).toContain(
      'AIONUI_TEMPLATE_REVIEW_V1'
    );
    unmount();
  });
});

describe('usePresentationTemplates managed run recovery', () => {
  it('discovers the canonical short conversation again after a remount', async () => {
    const first = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2));
    second.unmount();

    expect(listRecoverableInvokeMock).toHaveBeenNthCalledWith(1, {
      conversation_id: 'd0921953',
      limit: 20,
    });
    expect(listRecoverableInvokeMock).toHaveBeenNthCalledWith(2, {
      conversation_id: 'd0921953',
      limit: 20,
    });
  });

  it('canonicalizes uppercase ingress and an uppercase backend recovery DTO', async () => {
    listRecoverableInvokeMock.mockResolvedValue(
      successfulRecoveryList([makeReviewRun({ conversationId: 'D0921953' })])
    );

    const { result } = renderHook(() => usePresentationTemplates('D0921953'));

    await waitFor(() => expect(result.current.recoverableRuns).toHaveLength(1));
    expect(listRecoverableInvokeMock).toHaveBeenCalledWith({ conversation_id: 'd0921953', limit: 20 });
    expect(result.current.recoverableRuns[0]?.conversationId).toBe('d0921953');
    expect(messageWarningMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringContaining('presentation-recovery-d0921953-') })
    );
  });

  it('disables recovery safely for an invalid presentation conversation identity', async () => {
    const { result } = renderHook(() => usePresentationTemplates('../private'));

    await act(async () => {
      expect(await result.current.refreshRecoverableRuns()).toBe(true);
    });
    expect(result.current.recoverableRuns).toEqual([]);
    expect(listRecoverableInvokeMock).not.toHaveBeenCalled();
    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it('renders only the first bounded page in main order without following its cursor', async () => {
    const runs = Array.from({ length: 21 }, (_, index) =>
      makeReviewRun({ runId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` })
    );
    listRecoverableInvokeMock.mockResolvedValue(successfulRecoveryList(runs, 'opaque-next-cursor'));

    renderHook(() => usePresentationTemplates('d0921953'));

    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(20));
    expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(1);
    expect(messageWarningMock.mock.calls.map(([config]) => (config as { id: string }).id)).toEqual(
      runs.slice(0, 20).map((run) => `presentation-recovery-d0921953-${run.runId}`)
    );
  });

  it('fails closed when any returned record belongs to another conversation', async () => {
    listRecoverableInvokeMock.mockResolvedValue(
      successfulRecoveryList([
        makeReviewRun(),
        makeReviewRun({
          runId: 'ee260e85-00c2-41f8-9c4b-a03f47e469cb',
          conversationId: 'd0921954',
        }),
      ])
    );

    const { result } = renderHook(() => usePresentationTemplates('d0921953'));

    await waitFor(() => expect(messageErrorMock).toHaveBeenCalled());
    expect(messageWarningMock).not.toHaveBeenCalled();
    expect(result.current.recoverableRuns).toEqual([]);
  });

  it('clears stale recovery state and blocks queued actions when the conversation changes', async () => {
    listRecoverableInvokeMock.mockImplementation(({ conversation_id }: { conversation_id: string }) =>
      conversation_id === 'd0921953'
        ? Promise.resolve(successfulRecoveryList([makeReviewRun()]))
        : new Promise(() => undefined)
    );
    const { result, rerender, unmount } = renderHook(({ conversationId }) => usePresentationTemplates(conversationId), {
      initialProps: { conversationId: 'd0921953' },
    });
    await waitFor(() => expect(result.current.recoverableRuns).toHaveLength(1));
    const staleMessage = renderRecoveryMessage();

    rerender({ conversationId: 'd0921954' });

    expect(result.current.recoverableRuns).toEqual([]);
    staleMessage.getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.open' }).click();
    staleMessage.getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.discard' }).click();
    expect(openRecoveryInvokeMock).not.toHaveBeenCalled();
    expect(discardPresentationRunInvokeMock).not.toHaveBeenCalled();
    unmount();
  });

  it.each([
    {
      name: 'failure',
      reply: {
        ok: false,
        code: 'HASH_MISMATCH',
        messageKey: 'presentationRun.hashMismatch',
        retryable: false,
        state: 'retained',
        details: { runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0' },
      } as OpenPresentationRunResult,
    },
    {
      name: 'mismatched success',
      reply: {
        ok: true,
        runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
        sha256: 'b'.repeat(64),
      } as OpenPresentationRunResult,
    },
  ])('ignores an in-flight Open $name after switching conversations', async ({ reply }) => {
    const openReply = createDeferred<OpenPresentationRunResult>();
    const conversationBDiscovery = createDeferred<ListRecoverablePresentationRunsResult>();
    listRecoverableInvokeMock.mockImplementation(({ conversation_id }: { conversation_id: string }) =>
      conversation_id === 'd0921953'
        ? Promise.resolve(successfulRecoveryList([makeReviewRun()]))
        : conversationBDiscovery.promise
    );
    openRecoveryInvokeMock.mockReturnValue(openReply.promise);
    const hook = renderHook(({ conversationId }) => usePresentationTemplates(conversationId), {
      initialProps: { conversationId: 'd0921953' },
    });
    await waitFor(() => expect(hook.result.current.recoverableRuns).toHaveLength(1));
    renderRecoveryMessage()
      .getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.open' })
      .click();
    await waitFor(() => expect(openRecoveryInvokeMock).toHaveBeenCalledOnce());

    hook.rerender({ conversationId: 'd0921954' });
    await waitFor(() =>
      expect(listRecoverableInvokeMock).toHaveBeenCalledWith({ conversation_id: 'd0921954', limit: 20 })
    );
    await act(async () => {
      openReply.resolve(reply);
      await openReply.promise;
    });

    expect(messageErrorMock).not.toHaveBeenCalled();
    expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2);

    const conversationBRun = makeReviewRun({
      conversationId: 'd0921954',
      runId: 'a0adaf59-782b-48cf-8cd8-ddceaa926102',
    });
    await act(async () => {
      conversationBDiscovery.resolve(successfulRecoveryList([conversationBRun]));
      await conversationBDiscovery.promise;
    });
    await waitFor(() => expect(hook.result.current.recoverableRuns).toEqual([conversationBRun]));
  });

  it.each([
    {
      name: 'success',
      settle: (reply: ReturnType<typeof createDeferred<DiscardPresentationRunResult>>) =>
        reply.resolve({
          ok: true,
          runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
          discardedAt: '2026-08-03T00:00:00.000Z',
          alreadyDiscarded: false,
        }),
    },
    {
      name: 'failure',
      settle: (reply: ReturnType<typeof createDeferred<DiscardPresentationRunResult>>) =>
        reply.resolve({
          ok: false,
          code: 'UNSAFE_TO_DISCARD',
          messageKey: 'presentationRun.unsafeToDiscard',
          retryable: false,
          state: 'retained',
          details: { runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0' },
        }),
    },
    {
      name: 'lost reply',
      settle: (reply: ReturnType<typeof createDeferred<DiscardPresentationRunResult>>) =>
        reply.reject(new Error('reply lost')),
    },
  ])('ignores an in-flight Discard $name after switching conversations', async ({ settle }) => {
    const discardReply = createDeferred<DiscardPresentationRunResult>();
    const conversationBDiscovery = createDeferred<ListRecoverablePresentationRunsResult>();
    listRecoverableInvokeMock.mockImplementation(({ conversation_id }: { conversation_id: string }) =>
      conversation_id === 'd0921953'
        ? Promise.resolve(successfulRecoveryList([makeReviewRun()]))
        : conversationBDiscovery.promise
    );
    discardPresentationRunInvokeMock.mockReturnValue(discardReply.promise);
    const hook = renderHook(({ conversationId }) => usePresentationTemplates(conversationId), {
      initialProps: { conversationId: 'd0921953' },
    });
    await waitFor(() => expect(hook.result.current.recoverableRuns).toHaveLength(1));
    renderRecoveryMessage()
      .getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.discard' })
      .click();
    await waitFor(() => expect(discardPresentationRunInvokeMock).toHaveBeenCalledOnce());

    hook.rerender({ conversationId: 'd0921954' });
    await waitFor(() =>
      expect(listRecoverableInvokeMock).toHaveBeenCalledWith({ conversation_id: 'd0921954', limit: 20 })
    );
    await act(async () => {
      settle(discardReply);
      await discardReply.promise.catch(() => undefined);
    });

    expect(messageErrorMock).not.toHaveBeenCalled();
    expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2);

    const conversationBRun = makeReviewRun({
      conversationId: 'd0921954',
      runId: '71e930d6-6a19-4e6a-8b05-8e5aa20bef24',
    });
    await act(async () => {
      conversationBDiscovery.resolve(successfulRecoveryList([conversationBRun]));
      await conversationBDiscovery.promise;
    });
    await waitFor(() => expect(hook.result.current.recoverableRuns).toEqual([conversationBRun]));
  });

  it('drops an in-flight action continuation after unmount', async () => {
    const openReply = createDeferred<OpenPresentationRunResult>();
    listRecoverableInvokeMock.mockResolvedValue(successfulRecoveryList([makeReviewRun()]));
    openRecoveryInvokeMock.mockReturnValue(openReply.promise);
    const hook = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(hook.result.current.recoverableRuns).toHaveLength(1));
    renderRecoveryMessage()
      .getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.open' })
      .click();
    await waitFor(() => expect(openRecoveryInvokeMock).toHaveBeenCalledOnce());

    hook.unmount();
    await act(async () => {
      openReply.reject(new Error('reply lost'));
      await openReply.promise.catch(() => undefined);
    });

    expect(messageErrorMock).not.toHaveBeenCalled();
    expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(1);
  });

  it.each(['DESKTOP_REQUIRED', 'TEAM_SCOPE_UNSUPPORTED'] as const)(
    'silently projects %s recovery as unsupported',
    async (code) => {
      const listReply = createDeferred<ListRecoverablePresentationRunsResult>();
      listRecoverableInvokeMock.mockReturnValue(listReply.promise);
      const { result } = renderHook(() => usePresentationTemplates('d0921953'));

      await act(async () => {
        listReply.resolve({
          ok: false,
          code,
          messageKey: `presentationRun.${code}`,
          retryable: false,
          state: 'preflight',
          details: null,
        });
        await listReply.promise;
      });

      expect(result.current.recoverableRuns).toEqual([]);
      expect(messageErrorMock).not.toHaveBeenCalled();
    }
  );

  it('keeps a supported-context recovery failure visible', async () => {
    const listReply = createDeferred<ListRecoverablePresentationRunsResult>();
    listRecoverableInvokeMock.mockReturnValue(listReply.promise);
    renderHook(() => usePresentationTemplates('d0921953'));

    await act(async () => {
      listReply.resolve({
        ok: false,
        code: 'PERSISTENCE_FAILED',
        messageKey: 'presentationRun.persistenceFailed',
        retryable: false,
        state: 'preflight',
        details: { postInvoked: false },
      });
      await listReply.promise;
    });

    expect(messageErrorMock).toHaveBeenCalledWith('conversation.presentationTemplates.recovery.loadError');
  });

  it('shows the review-required status, exact hash, and only main-authorized actions', async () => {
    listRecoverableInvokeMock.mockResolvedValue(successfulRecoveryList([makeReviewRun()]));
    renderHook(() => usePresentationTemplates('d0921953'));

    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));
    const view = renderRecoveryMessage();

    expect(view.getByRole('status')).toHaveTextContent(
      'conversation.presentationTemplates.recovery.status.reviewRequired'
    );
    expect(view.getByRole('status')).toHaveTextContent(`conversation.presentationTemplates.recovery.hash`);
    expect(view.getByRole('status')).toHaveTextContent('a'.repeat(64));
    expect(
      view.getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.open' })
    ).toBeInTheDocument();
    expect(
      view.getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.discard' })
    ).toBeInTheDocument();
  });

  it.each([
    {
      name: 'failed retained candidate',
      run: makeReviewRun({ dispatchStatus: 'failed_retained' }),
      statusKey: 'conversation.presentationTemplates.recovery.status.reviewRequiredAfterFailure',
      open: true,
      discard: true,
    },
    {
      name: 'failed retained tracking record',
      run: makeTrackingRun({
        dispatchStatus: 'failed_retained',
        actions: { openAllowed: false, discardAllowed: true },
      }),
      statusKey: 'conversation.presentationTemplates.recovery.status.trackingRequired',
      open: false,
      discard: true,
    },
    {
      name: 'safe retained tracking record',
      run: makeTrackingRun(),
      statusKey: 'conversation.presentationTemplates.recovery.status.trackingRequired',
      open: false,
      discard: false,
    },
  ])('renders exact main status and action authority for a $name', async ({ run, statusKey, open, discard }) => {
    listRecoverableInvokeMock.mockResolvedValue(successfulRecoveryList([run]));
    renderHook(() => usePresentationTemplates('d0921953'));

    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));
    const view = renderRecoveryMessage();
    expect(view.getByRole('status')).toHaveTextContent(statusKey);
    expect(
      Boolean(view.queryByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.open' }))
    ).toBe(open);
    expect(
      Boolean(view.queryByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.discard' }))
    ).toBe(discard);
  });

  it.each(['2026-08-05T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'])(
    'keeps an uncertain run actionless regardless of age or idle observations (%s)',
    async (updatedAt) => {
      listRecoverableInvokeMock.mockResolvedValue(
        successfulRecoveryList([
          makeTrackingRun({
            dispatchStatus: 'dispatch_uncertain',
            createdAt: updatedAt,
            updatedAt,
            actions: { openAllowed: true, discardAllowed: true },
          }),
        ])
      );
      renderHook(() => usePresentationTemplates('d0921953'));

      await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));
      const view = renderRecoveryMessage();
      expect(view.getByRole('status')).toHaveTextContent(
        'conversation.presentationTemplates.recovery.status.dispatchUncertain'
      );
      expect(view.queryByRole('button')).not.toBeInTheDocument();
      expect(openRecoveryInvokeMock).not.toHaveBeenCalled();
      expect(discardPresentationRunInvokeMock).not.toHaveBeenCalled();
    }
  );

  it('opens only the exact displayed durable hash for the current conversation', async () => {
    listRecoverableInvokeMock.mockResolvedValue(successfulRecoveryList([makeReviewRun()]));
    renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));

    const view = renderRecoveryMessage();
    const open = view.getByRole('button', {
      name: 'conversation.presentationTemplates.recovery.actions.open',
    });
    open.focus();
    expect(open).toHaveFocus();
    open.click();

    await waitFor(() =>
      expect(openRecoveryInvokeMock).toHaveBeenCalledWith({
        conversation_id: 'd0921953',
        run_id: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
        expected_sha256: 'a'.repeat(64),
      })
    );
  });

  it('shows no false success and refreshes from main after a stale-hash refusal', async () => {
    listRecoverableInvokeMock
      .mockResolvedValueOnce(successfulRecoveryList([makeReviewRun()]))
      .mockResolvedValueOnce(successfulRecoveryList([makeReviewRun({ revision: 8 })]));
    openRecoveryInvokeMock.mockResolvedValue({
      ok: false,
      code: 'HASH_MISMATCH',
      messageKey: 'presentationRun.hashMismatch',
      retryable: false,
      state: 'retained',
      details: { runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0' },
    });
    renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));

    renderRecoveryMessage()
      .getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.open' })
      .click();

    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2));
    expect(messageSuccessMock).not.toHaveBeenCalled();
    expect(messageErrorMock).toHaveBeenCalledWith('conversation.presentationTemplates.recovery.openError');
    expect(enUSConversation.presentationTemplates.recovery.openError).not.toMatch(/refresh|updated|reconciled/i);
  });

  it.each(['stale hash', 'lost discard reply', 'manual refresh'] as const)(
    'keeps an unchanged authoritative recovery notice visible after %s',
    async (refreshReason) => {
      const run = makeReviewRun();
      const noticeId = `presentation-recovery-d0921953-${run.runId}`;
      listRecoverableInvokeMock
        .mockResolvedValueOnce(successfulRecoveryList([run]))
        .mockResolvedValueOnce(successfulRecoveryList([run]));
      if (refreshReason === 'stale hash') {
        openRecoveryInvokeMock.mockResolvedValue({
          ok: false,
          code: 'HASH_MISMATCH',
          messageKey: 'presentationRun.hashMismatch',
          retryable: false,
          state: 'retained',
          details: { runId: run.runId },
        });
      } else if (refreshReason === 'lost discard reply') {
        discardPresentationRunInvokeMock.mockRejectedValue(new Error('reply lost'));
      }

      const hook = renderHook(() => usePresentationTemplates('d0921953'));
      await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));
      expect(activeRecoveryNoticeIds).toContain(noticeId);

      if (refreshReason === 'manual refresh') {
        await act(async () => {
          await hook.result.current.refreshRecoverableRuns();
        });
      } else {
        renderRecoveryMessage()
          .getByRole('button', {
            name:
              refreshReason === 'stale hash'
                ? 'conversation.presentationTemplates.recovery.actions.open'
                : 'conversation.presentationTemplates.recovery.actions.discard',
          })
          .click();
      }

      await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(2));
      expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2);
      expect(pendingRecoveryNoticeCloses).toHaveLength(0);
      await flushPendingRecoveryNoticeCloses();
      expect(activeRecoveryNoticeIds).toContain(noticeId);
    }
  );

  it('uses uncertainty copy when the Open reply is lost', async () => {
    listRecoverableInvokeMock
      .mockResolvedValueOnce(successfulRecoveryList([makeReviewRun()]))
      .mockResolvedValueOnce(successfulRecoveryList([makeReviewRun()]));
    openRecoveryInvokeMock.mockRejectedValue(new Error('reply lost'));
    renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));

    renderRecoveryMessage()
      .getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.open' })
      .click();

    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2));
    expect(messageErrorMock).toHaveBeenCalledWith('conversation.presentationTemplates.recovery.openError');
    expect(enUSConversation.presentationTemplates.recovery.openError).toMatch(/confirm whether.+opened/i);
  });

  it('refreshes after an idempotent discard success using the exact current revision', async () => {
    listRecoverableInvokeMock
      .mockResolvedValueOnce(successfulRecoveryList([makeReviewRun()]))
      .mockResolvedValueOnce(successfulRecoveryList([]));
    discardPresentationRunInvokeMock.mockResolvedValue({
      ok: true,
      runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
      discardedAt: '2026-08-03T00:00:00.000Z',
      alreadyDiscarded: true,
    });
    const { result } = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));

    renderRecoveryMessage()
      .getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.discard' })
      .click();

    await waitFor(() => expect(result.current.recoverableRuns).toEqual([]));
    expect(discardPresentationRunInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'd0921953',
      run_id: '4a9b4520-84b6-4a1e-8530-8af7641116d0',
      expected_revision: 7,
    });
    expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'explicit main failure',
      reply: {
        ok: false,
        code: 'UNSAFE_TO_DISCARD',
        messageKey: 'presentationRun.unsafeToDiscard',
        retryable: false,
        state: 'retained',
        details: { runId: '4a9b4520-84b6-4a1e-8530-8af7641116d0' },
      },
    },
    { name: 'lost reply', reply: new Error('reply lost') },
  ])('preserves the record after $name until main confirms its state', async ({ reply }) => {
    listRecoverableInvokeMock
      .mockResolvedValueOnce(successfulRecoveryList([makeReviewRun()]))
      .mockRejectedValueOnce(new Error('refresh unavailable'));
    if (reply instanceof Error) {
      discardPresentationRunInvokeMock.mockRejectedValue(reply);
    } else {
      discardPresentationRunInvokeMock.mockResolvedValue(reply);
    }
    const { result } = renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(result.current.recoverableRuns).toHaveLength(1));

    renderRecoveryMessage()
      .getByRole('button', { name: 'conversation.presentationTemplates.recovery.actions.discard' })
      .click();

    await waitFor(() => expect(listRecoverableInvokeMock).toHaveBeenCalledTimes(2));
    expect(result.current.recoverableRuns).toHaveLength(1);
    expect(messageErrorMock).toHaveBeenCalledWith('conversation.presentationTemplates.recovery.discardError');
    expect(enUSConversation.presentationTemplates.recovery.discardError).not.toMatch(/refresh|updated|reconciled/i);
  });

  it('does not render paths or unsupported delivery actions in recovery copy', async () => {
    listRecoverableInvokeMock.mockResolvedValue(
      successfulRecoveryList([makeReviewRun({ selectedTemplateId: '/private/candidate/location.pptx' })])
    );
    renderHook(() => usePresentationTemplates('d0921953'));
    await waitFor(() => expect(messageWarningMock).toHaveBeenCalledTimes(1));

    const view = renderRecoveryMessage();
    expect(view.container).not.toHaveTextContent('/private/candidate/location.pptx');
    expect(view.container.textContent).not.toMatch(/preview|download|publish|ready|deliver|resend/i);
  });
});

describe('usePresentationTemplates artifact scratch lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allocateScratchInvokeMock.mockResolvedValue(allocation);
    completeScratchInvokeMock.mockResolvedValue({ status: 'cleaned' });
    retainScratchInvokeMock.mockResolvedValue({
      status: 'retained',
      directory: allocation.directory,
      reason: 'failed',
    });
    discardScratchInvokeMock.mockResolvedValue({ status: 'cleaned' });
  });

  it('ignores an invalid terminal identity while the presentation route identity is invalid', async () => {
    const { result } = renderHook(() => usePresentationTemplates('../route'));
    act(() => result.current.registerScratchTurn('turn-1', allocation.runId));

    act(() => {
      emitter.emit('artifact.scratch.terminal', {
        conversationId: '../event',
        turnId: 'turn-1',
        outcome: 'completed',
      });
    });

    await act(async () => Promise.resolve());
    expect(completeScratchInvokeMock).not.toHaveBeenCalled();
    expect(retainScratchInvokeMock).not.toHaveBeenCalled();
  });

  it('allocates an owned path and cleans the matching run only after a completed terminal', async () => {
    const { result } = renderHook(() => usePresentationTemplates('d0921953'));
    act(() => result.current.selectTemplate(template));

    const scratch = await result.current.prepareScratch('D0921953');
    expect(allocateScratchInvokeMock).toHaveBeenCalledWith({
      conversation_id: 'd0921953',
      template_id: 'business-review',
    });
    const composed = result.current.composeSend('Build the review', [], scratch);
    expect(composed.artifactScratchRunId).toBe(allocation.runId);

    act(() => result.current.registerScratchTurn('turn-1', allocation.runId));
    act(() => {
      emitter.emit('artifact.scratch.terminal', {
        conversationId: 'd0921953',
        turnId: 'turn-1',
        outcome: 'completed',
      });
    });

    await waitFor(() => {
      expect(completeScratchInvokeMock).toHaveBeenCalledWith({ run_id: allocation.runId });
    });
    expect(retainScratchInvokeMock).not.toHaveBeenCalled();
  });

  it('retains the matching run on failure and ignores terminals from other conversations', async () => {
    const { result } = renderHook(() => usePresentationTemplates('d0921953'));
    act(() => result.current.registerScratchTurn('turn-1', allocation.runId));

    act(() => {
      emitter.emit('artifact.scratch.terminal', {
        conversationId: 'd0921954',
        turnId: 'turn-1',
        outcome: 'failed',
      });
    });
    expect(retainScratchInvokeMock).not.toHaveBeenCalled();

    act(() => {
      emitter.emit('artifact.scratch.terminal', {
        conversationId: 'd0921953',
        turnId: 'turn-1',
        outcome: 'failed',
      });
    });
    await waitFor(() => {
      expect(retainScratchInvokeMock).toHaveBeenCalledWith({ run_id: allocation.runId, reason: 'failed' });
    });
    expect(messageWarningMock).toHaveBeenCalledWith(expect.objectContaining({ duration: 0, closable: true }));
    expect(completeScratchInvokeMock).not.toHaveBeenCalled();
  });
});
