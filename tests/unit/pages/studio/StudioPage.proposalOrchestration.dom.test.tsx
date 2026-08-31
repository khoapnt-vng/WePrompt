import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioPaidRecoveryQuoteSummaryV2,
  StudioRendererProjectV2,
  StudioRendererProposalV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  useStudioGeneratedReferenceReview,
  useStudioHandoffDismissal,
  useStudioProposalCardActions,
  useStudioReferenceRequestReview,
  useStudioReviewedActionAuthority,
} from '@/renderer/pages/studio/StudioPage/proposalOrchestration';

const mocks = vi.hoisted(() => ({
  bridge: {
    preparePaidRecoveryProposal: { invoke: vi.fn() },
    confirmPaidRecoveryProposal: { invoke: vi.fn() },
    decideReferenceRequest: { invoke: vi.fn() },
    dismissReferenceGenerationHandoff: { invoke: vi.fn() },
  },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: mocks.bridge } }));

const project = {
  id: 'project_1',
  revision: 7,
  references: {
    reference_1: {
      id: 'reference_1',
      approvedAssetId: 'asset_current',
      supersededAssetIds: ['asset_old'],
    },
  },
} as unknown as StudioRendererProjectV2;

const paidProposal = (expiresAt: string): StudioRendererProposalV2 =>
  ({
    id: 'proposal_paid',
    projectId: project.id,
    baseRevision: project.revision,
    status: 'pending',
    review: { status: 'ready' },
    payload: {
      kind: 'paid_recovery',
      quote: {
        quoteId: 'quote_1',
        projectRevision: project.revision,
        expiresAt,
      },
    },
  }) as unknown as StudioRendererProposalV2;

const quote = (expiresAt: string): StudioPaidRecoveryQuoteSummaryV2 =>
  ({ quoteId: 'quote_1', projectRevision: project.revision, expiresAt }) as StudioPaidRecoveryQuoteSummaryV2;

const handoff = (status: StudioRendererReferenceGenerationHandoffV2['status']) =>
  ({
    handoffId: 'handoff_1',
    requestId: 'request_1',
    referenceIds: ['reference_1', 'missing_reference'],
    decidedAt: '2026-01-01T00:00:00.000Z',
    status,
    counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
    resultAssetIds: ['asset_current', 'asset_old', 'asset_unowned'],
    failedReferenceIds: [],
    completedAt: '2026-01-01T00:00:01.000Z',
  }) as StudioRendererReferenceGenerationHandoffV2;

describe('StudioPage proposal orchestration authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('holds one synchronous reviewed-action token and ignores non-owner retarget and finish calls', () => {
    const { result } = renderHook(() => useStudioReviewedActionAuthority());

    act(() => {
      expect(result.current.beginReviewedAction({ kind: 'proposal', id: 'proposal_1' })).toBe(1);
    });
    expect(result.current.reviewedActionLocked).toBe(true);
    expect(result.current.pendingReviewedAction).toEqual({ kind: 'proposal', id: 'proposal_1' });

    act(() => {
      expect(result.current.beginReviewedAction(null)).toBeNull();
      expect(result.current.retargetReviewedAction(2, { kind: 'handoff', id: 'handoff_1' })).toBe(false);
      result.current.finishReviewedAction(2);
    });
    expect(result.current.reviewedActionLocked).toBe(true);

    act(() => {
      expect(result.current.retargetReviewedAction(1, { kind: 'handoff', id: 'handoff_1' })).toBe(true);
    });
    expect(result.current.pendingReviewedAction).toEqual({ kind: 'handoff', id: 'handoff_1' });

    act(() => result.current.finishReviewedAction(1));
    expect(result.current.reviewedActionLocked).toBe(false);
    expect(result.current.pendingReviewedAction).toBeNull();
  });

  it('refreshes an expired paid-recovery quote without confirming stale authority', async () => {
    const target = paidProposal('2000-01-01T00:00:00.000Z');
    const refreshedQuote = quote('2999-01-01T00:00:00.000Z');
    mocks.bridge.preparePaidRecoveryProposal.invoke.mockResolvedValue({ ok: true, data: refreshedQuote });
    const setActionErrorMessageKey = vi.fn();
    const setPaidRecoveryQuotes = vi.fn();
    const setPaidRecoveryStatusMessageKeys = vi.fn();
    const finishReviewedAction = vi.fn();
    const refreshProposalAuthority = vi.fn().mockResolvedValue({
      project,
      catalog: { projectId: project.id, projectRevision: project.revision, proposals: [target] },
    });
    const { result } = renderHook(() =>
      useStudioProposalCardActions({
        decideProposalFromCard: vi.fn(),
        paidRecoveryQuotes: {},
        paidRecoveryStatusMessageKeys: {},
        setPaidRecoveryQuotes,
        setPaidRecoveryStatusMessageKeys,
        beginReviewedAction: vi.fn(() => 11),
        finishReviewedAction,
        refreshProposalAuthority,
        setActionErrorMessageKey,
      })
    );

    expect(result.current.paidRecoveryQuote(target)).toEqual(target.payload.quote);
    expect(result.current.paidRecoveryQuote({ ...target, payload: { kind: 'pin_rule' } } as never)).toBeNull();
    expect(result.current.paidRecoveryStatusMessageKey(target)).toBeNull();
    await act(async () => result.current.actOnPaidRecoveryProposal(target.id));

    expect(mocks.bridge.preparePaidRecoveryProposal.invoke).toHaveBeenCalledWith({
      projectId: project.id,
      proposalId: target.id,
    });
    expect(mocks.bridge.confirmPaidRecoveryProposal.invoke).not.toHaveBeenCalled();
    expect(setPaidRecoveryQuotes).toHaveBeenCalledTimes(1);
    expect(setPaidRecoveryStatusMessageKeys).toHaveBeenCalledTimes(1);
    expect(finishReviewedAction).toHaveBeenCalledWith(11);
  });

  it('confirms one live paid-recovery quote and clears renderer-only quote state after success', async () => {
    const target = paidProposal('2999-01-01T00:00:00.000Z');
    mocks.bridge.confirmPaidRecoveryProposal.invoke.mockResolvedValue({
      ok: true,
      data: { projectId: project.id, projectRevision: project.revision + 1 },
    });
    const setPaidRecoveryQuotes = vi.fn();
    const setPaidRecoveryStatusMessageKeys = vi.fn();
    const refreshProposalAuthority = vi.fn().mockResolvedValue({
      project,
      catalog: { projectId: project.id, projectRevision: project.revision, proposals: [target] },
    });
    const { result } = renderHook(() =>
      useStudioProposalCardActions({
        decideProposalFromCard: vi.fn(),
        paidRecoveryQuotes: { [target.id]: quote('2999-01-01T00:00:00.000Z') },
        paidRecoveryStatusMessageKeys: { [target.id]: 'status' },
        setPaidRecoveryQuotes,
        setPaidRecoveryStatusMessageKeys,
        beginReviewedAction: vi.fn(() => 12),
        finishReviewedAction: vi.fn(),
        refreshProposalAuthority,
        setActionErrorMessageKey: vi.fn(),
      })
    );

    expect(result.current.paidRecoveryStatusMessageKey(target)).toBe('status');
    await act(async () => result.current.actOnPaidRecoveryProposal(target.id));

    expect(mocks.bridge.confirmPaidRecoveryProposal.invoke).toHaveBeenCalledWith({
      projectId: project.id,
      proposalId: target.id,
      quoteId: 'quote_1',
      expectedRevision: project.revision,
    });
    const clearQuotes = setPaidRecoveryQuotes.mock.calls[0]![0] as (
      current: Readonly<Record<string, StudioPaidRecoveryQuoteSummaryV2>>
    ) => Readonly<Record<string, StudioPaidRecoveryQuoteSummaryV2>>;
    const clearStatuses = setPaidRecoveryStatusMessageKeys.mock.calls[0]![0] as (
      current: Readonly<Record<string, string>>
    ) => Readonly<Record<string, string>>;
    expect(
      clearQuotes({ [target.id]: quote('2999-01-01T00:00:00.000Z'), retained: quote('2999-01-01T00:00:00.000Z') })
    ).toEqual({
      retained: quote('2999-01-01T00:00:00.000Z'),
    });
    expect(clearStatuses({ [target.id]: 'status', retained: 'retained' })).toEqual({ retained: 'retained' });
    expect(refreshProposalAuthority).toHaveBeenCalledTimes(2);
  });

  it('fails paid recovery closed for busy, unavailable, absent, and stale quote authority', async () => {
    const target = paidProposal('2999-01-01T00:00:00.000Z');
    const setActionErrorMessageKey = vi.fn();
    const input = {
      decideProposalFromCard: vi.fn(),
      paidRecoveryQuotes: {},
      paidRecoveryStatusMessageKeys: {},
      setPaidRecoveryQuotes: vi.fn(),
      setPaidRecoveryStatusMessageKeys: vi.fn(),
      beginReviewedAction: vi.fn<() => number | null>(() => null),
      finishReviewedAction: vi.fn(),
      refreshProposalAuthority: vi.fn().mockResolvedValue(null),
      setActionErrorMessageKey,
    };
    const { result, rerender } = renderHook((props: typeof input) => useStudioProposalCardActions(props), {
      initialProps: input,
    });

    await act(async () => result.current.actOnPaidRecoveryProposal(target.id));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.proposals.chatDecisionBusy'
    );

    input.beginReviewedAction.mockReturnValue(13);
    rerender(input);
    await act(async () => result.current.actOnPaidRecoveryProposal(target.id));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.proposals.authorityUnavailable'
    );

    input.refreshProposalAuthority.mockResolvedValue({
      project,
      catalog: { projectId: project.id, projectRevision: project.revision, proposals: [] },
    });
    rerender(input);
    await act(async () => result.current.actOnPaidRecoveryProposal(target.id));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.proposals.chatProposalNotFound'
    );

    const stale = { ...target, baseRevision: project.revision - 1 };
    input.refreshProposalAuthority.mockResolvedValue({
      project,
      catalog: { projectId: project.id, projectRevision: project.revision, proposals: [stale] },
    });
    rerender(input);
    await act(async () => result.current.actOnPaidRecoveryProposal(stale.id));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.proposals.chatProposalNotFound'
    );
    expect(mocks.bridge.confirmPaidRecoveryProposal.invoke).not.toHaveBeenCalled();
  });

  it('keeps reference decisions token-owned and passes an exact generation handoff to spend review', async () => {
    const finishReviewedAction = vi.fn();
    const reviewHandoff = vi.fn();
    const refetchReferences = vi.fn().mockResolvedValue(undefined);
    mocks.bridge.decideReferenceRequest.invoke.mockResolvedValue({
      ok: true,
      data: {
        requestId: 'request_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', referenceIds: ['reference_1'] },
      },
    });
    const { result } = renderHook(() =>
      useStudioReferenceRequestReview({
        project,
        projectId: project.id,
        beginReviewedAction: vi.fn(() => 21),
        finishReviewedAction,
        refetchReferences,
        reviewHandoff,
        setActionErrorMessageKey: vi.fn(),
      })
    );

    await act(async () => result.current('request_1', { kind: 'generation_gate' }));

    expect(mocks.bridge.decideReferenceRequest.invoke).toHaveBeenCalledWith({
      projectId: project.id,
      requestId: 'request_1',
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    expect(reviewHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffId: 'handoff_1',
        requestId: 'request_1',
        referenceIds: ['reference_1'],
        status: 'awaiting_spend',
      }),
      21
    );
    expect(refetchReferences).toHaveBeenCalledTimes(1);
    expect(finishReviewedAction).toHaveBeenCalledWith(21);
  });

  it('reviews only owned generated assets and keeps dismissal fail-closed', async () => {
    const openReferenceFocus = vi.fn();
    const setActionErrorMessageKey = vi.fn();
    const reviewedActionRef: { current: { token: number; target: null } | null } = {
      current: { token: 1, target: null },
    };
    const { result: generated, rerender } = renderHook(
      ({ currentProject }: { currentProject: StudioRendererProjectV2 | null }) =>
        useStudioGeneratedReferenceReview({
          reviewedActionRef,
          projectRef: { current: currentProject },
          openReferenceFocus,
          setActionErrorMessageKey,
        }),
      { initialProps: { currentProject: project as StudioRendererProjectV2 | null } }
    );

    act(() => generated.current(handoff('succeeded')));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.proposals.chatDecisionBusy'
    );
    reviewedActionRef.current = null;
    rerender({ currentProject: null });
    act(() => generated.current(handoff('succeeded')));
    rerender({ currentProject: project });
    act(() => generated.current(handoff('awaiting_spend')));
    act(() => generated.current(handoff('succeeded')));
    expect(openReferenceFocus).toHaveBeenCalledWith({
      referenceIds: ['reference_1'],
      assetIds: ['asset_current', 'asset_old'],
    });

    const finishReviewedAction = vi.fn();
    const refetchReferences = vi.fn().mockResolvedValue(undefined);
    mocks.bridge.dismissReferenceGenerationHandoff.invoke.mockResolvedValue({
      ok: false,
      error: { messageKey: 'failed' },
    });
    const { result: dismissal } = renderHook(() =>
      useStudioHandoffDismissal({
        projectRef: { current: project },
        beginReviewedAction: vi.fn(() => 31),
        finishReviewedAction,
        refetchReferences,
        setActionErrorMessageKey,
      })
    );
    await act(async () => dismissal.current(handoff('failed')));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith('failed');
    expect(refetchReferences).not.toHaveBeenCalled();
    expect(finishReviewedAction).toHaveBeenCalledWith(31);
  });
});
