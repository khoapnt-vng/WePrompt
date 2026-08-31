import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
  StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import type { SpendGateDraft, WorkspaceProjection } from '@/renderer/pages/studio/components/Workspace';
import {
  shotCapabilityItemsForDraft,
  useStudioContinuitySpendReview,
  useStudioFailedReferenceSpendReview,
  useStudioHandoffSpendReview,
} from '@/renderer/pages/studio/StudioPage/spendOrchestration';

const project = {
  id: 'project_1',
  revision: 1,
  imageRouteId: null,
  references: {},
  referenceOrder: [],
  jobs: {},
} as unknown as StudioRendererProjectV2;

const projection = {
  projectId: project.id,
  projectRevision: project.revision,
  activeBeats: [],
} as unknown as WorkspaceProjection;

const handoff = {
  id: 'handoff_1',
  status: 'failed',
  failedReferenceIds: ['reference_1'],
} as unknown as StudioRendererReferenceGenerationHandoffV2;

describe('StudioPage spend orchestration fail-closed seams', () => {
  it('filters reference drafts and malformed non-Shot choices from Shot capability disclosure', () => {
    expect(
      shotCapabilityItemsForDraft({
        projectId: project.id,
        expectedRevision: project.revision,
        referenceIds: ['reference_1'],
      })
    ).toEqual([]);
    expect(
      shotCapabilityItemsForDraft({
        projectId: project.id,
        expectedRevision: project.revision,
        baseChoices: [{ target: { kind: 'reference', referenceId: 'reference_1' }, purpose: 'reference_image' }],
        cascadeChoices: [],
      } as unknown as SpendGateDraft)
    ).toEqual([]);
  });

  it('keeps continuity review closed for unavailable authority, absent Shots, and locked seeds', () => {
    const setActionErrorMessageKey = vi.fn();
    const spendGateOpen = vi.fn();
    const projectRef = { current: null as StudioRendererProjectV2 | null };
    const projectionRef = { current: null as WorkspaceProjection | null };
    const { result, rerender } = renderHook(
      ({ blockedMessageKey }: { blockedMessageKey: string | null }) =>
        useStudioContinuitySpendReview({
          projectRef,
          projectionRef,
          workspacePendingRef: { current: false },
          beatPanelReviewBlockedMessageKey: blockedMessageKey,
          spendGateLocked: false,
          currentGenerationCapability: null,
          routeCatalog: null,
          setActionErrorMessageKey,
          spendGateOpen,
        }),
      { initialProps: { blockedMessageKey: 'blocked' as string | null } }
    );

    act(() => result.current('shot_1', false));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith('blocked');

    rerender({ blockedMessageKey: null });
    act(() => result.current('shot_1', false));
    expect(spendGateOpen).not.toHaveBeenCalled();

    projectRef.current = project;
    projectionRef.current = projection;
    act(() => result.current('shot_1', false));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.selectionNotPayable'
    );

    projectionRef.current = {
      ...projection,
      activeBeats: [{ shots: [{ id: 'shot_1', seedAuthorizationLock: { jobId: 'job_1' } }] }],
    } as unknown as WorkspaceProjection;
    act(() => result.current('shot_1', false));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked'
    );
    expect(spendGateOpen).not.toHaveBeenCalled();
  });

  it('keeps reference handoff review closed across owner, project, status, route, and capability guards', () => {
    const setActionErrorMessageKey = vi.fn();
    const spendGateOpen = vi.fn();
    const reviewedActionRef = { current: { token: 1 } as { token: number } | null };
    const projectRef = { current: project as StudioRendererProjectV2 | null };
    const input = {
      reviewedActionRef,
      projectRef,
      generationDraftsBlockReview: false,
      statusBlocksReview: false,
      projection,
      routeCatalog: null as StudioRouteCatalogV2 | null,
      currentGenerationCapability: null,
      setActionErrorMessageKey,
      spendGateOpen,
    };
    const { result, rerender } = renderHook((props: typeof input) => useStudioHandoffSpendReview(props), {
      initialProps: input,
    });

    act(() => result.current(handoff, 2));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.proposals.chatDecisionBusy'
    );

    reviewedActionRef.current = null;
    projectRef.current = null;
    act(() => result.current(handoff));
    expect(spendGateOpen).not.toHaveBeenCalled();

    projectRef.current = project;
    rerender({ ...input, generationDraftsBlockReview: true });
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.saveBeforeReview'
    );

    rerender({ ...input, statusBlocksReview: true });
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.statusRequired'
    );

    rerender({ ...input, projection: null });
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.statusRequired'
    );

    rerender(input);
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.routeCatalogRequired'
    );

    rerender({
      ...input,
      routeCatalog: { image: { status: 'unavailable' } } as unknown as StudioRouteCatalogV2,
    });
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
    );
    expect(spendGateOpen).not.toHaveBeenCalled();
  });

  it('keeps failed-reference retry closed while review is blocked or route authority is absent', () => {
    const setActionErrorMessageKey = vi.fn();
    const spendGateOpen = vi.fn();
    const reviewedActionRef = { current: null as { token: number } | null };
    const input = {
      projectRef: { current: project as StudioRendererProjectV2 | null },
      reviewedActionRef,
      workspacePendingRef: { current: false },
      generationDraftsBlockReview: true,
      spendGateLocked: false,
      routeCatalog: null as StudioRouteCatalogV2 | null,
      currentGenerationCapability: null,
      setActionErrorMessageKey,
      spendGateOpen,
    };
    const { result, rerender } = renderHook((props: typeof input) => useStudioFailedReferenceSpendReview(props), {
      initialProps: input,
    });

    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.saveBeforeReview'
    );

    reviewedActionRef.current = { token: 1 };
    rerender({ ...input, generationDraftsBlockReview: false });
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.proposals.chatDecisionBusy'
    );

    reviewedActionRef.current = null;
    rerender({ ...input, generationDraftsBlockReview: false });
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.routeCatalogRequired'
    );

    rerender({
      ...input,
      generationDraftsBlockReview: false,
      routeCatalog: { image: { status: 'unavailable' } } as unknown as StudioRouteCatalogV2,
    });
    act(() => result.current(handoff));
    expect(setActionErrorMessageKey).toHaveBeenLastCalledWith(
      'conversation.creativeStudio.workspace.controls.imageRouteBlocked'
    );
    expect(spendGateOpen).not.toHaveBeenCalled();
  });
});
