/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type {
  BindPresentationDraftResult,
  CreatePresentationDraftResult,
  GetPresentationSourceOwnerResult,
  GrantPresentationExternalDropResult,
  GrantPresentationWorkspaceSourceResult,
  PickPresentationSourcesResult,
  PresentationGrantOwner,
  PresentationSourceDescriptor,
  PresentationSourceRef,
  RevokePresentationSourceResult,
} from '@/common/types/office/presentationRun';
import { useCallback, useMemo, useRef, useState } from 'react';

export type PresentationSourceDraftResult = {
  owner: PresentationGrantOwner | null;
  ownerRevision: number | null;
  descriptors: readonly PresentationSourceDescriptor[];
  sourceRefs: readonly PresentationSourceRef[];
  pending: boolean;
  hydrate: (owner: PresentationGrantOwner) => Promise<GetPresentationSourceOwnerResult>;
  createDraft: (clientRequestId: string) => Promise<CreatePresentationDraftResult>;
  pickSources: () => Promise<PickPresentationSourcesResult | null>;
  grantExternalDrop: (files: readonly File[]) => Promise<GrantPresentationExternalDropResult | null>;
  grantWorkspaceSource: (relativePath: string) => Promise<GrantPresentationWorkspaceSourceResult | null>;
  revoke: (grantId: string) => Promise<RevokePresentationSourceResult | null>;
  bindDraft: (conversationId: string) => Promise<BindPresentationDraftResult | null>;
  reset: () => void;
};

const normalizeOwner = (owner: PresentationGrantOwner): PresentationGrantOwner | null => {
  if (owner.owner_type === 'draft') return { owner_type: 'draft', draft_id: owner.draft_id };
  const conversationId = normalizePresentationConversationId(owner.conversation_id);
  if (conversationId === null) return null;
  return { owner_type: 'conversation', conversation_id: conversationId };
};

const copyOwner = (owner: PresentationGrantOwner): PresentationGrantOwner => {
  const normalized = normalizeOwner(owner);
  if (normalized === null) throw new Error('Invalid presentation source owner conversation id');
  return normalized;
};

const invalidSourceAuthority = (): Extract<GetPresentationSourceOwnerResult, { ok: false }> => ({
  ok: false,
  code: 'INVALID_REQUEST',
  messageKey: 'conversation.presentationRun.INVALID_REQUEST',
  retryable: false,
  state: 'preflight',
  details: null,
});

const copyDescriptor = (descriptor: PresentationSourceDescriptor): PresentationSourceDescriptor => ({
  grantId: descriptor.grantId,
  displayName: descriptor.displayName,
  format: descriptor.format,
  sourceKind: descriptor.sourceKind,
  byteLength: descriptor.byteLength,
  sha256: descriptor.sha256,
  expiresAt: descriptor.expiresAt,
});

const copyDescriptors = (descriptors: readonly PresentationSourceDescriptor[]): PresentationSourceDescriptor[] =>
  descriptors.map(copyDescriptor);

const isSameOwner = (left: PresentationGrantOwner | null, right: PresentationGrantOwner): boolean => {
  if (left === null || left.owner_type !== right.owner_type) return false;
  if (left.owner_type === 'draft' && right.owner_type === 'draft') {
    return left.draft_id === right.draft_id;
  }
  if (left.owner_type === 'conversation' && right.owner_type === 'conversation') {
    const leftConversationId = normalizePresentationConversationId(left.conversation_id);
    const rightConversationId = normalizePresentationConversationId(right.conversation_id);
    return leftConversationId !== null && leftConversationId === rightConversationId;
  }
  return false;
};

type CapturedOwnerState = {
  intent: number;
  owner: PresentationGrantOwner;
  ownerRevision: number;
  descriptors: PresentationSourceDescriptor[];
};

/**
 * Holds renderer-visible source descriptors while main owns every native path
 * and source snapshot. The hook never accepts renderer path strings as source
 * authority; external drops cross only the narrow preload method with `File`s.
 */
export function usePresentationSourceDraft(): PresentationSourceDraftResult {
  const [owner, setOwner] = useState<PresentationGrantOwner | null>(null);
  const [ownerRevision, setOwnerRevision] = useState<number | null>(null);
  const [descriptors, setDescriptors] = useState<PresentationSourceDescriptor[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const ownerRef = useRef<PresentationGrantOwner | null>(null);
  const ownerRevisionRef = useRef<number | null>(null);
  const descriptorsRef = useRef<PresentationSourceDescriptor[]>([]);
  const ownerIntentRef = useRef(0);

  const detach = useCallback((): void => {
    ownerRef.current = null;
    ownerRevisionRef.current = null;
    descriptorsRef.current = [];
    setOwner(null);
    setOwnerRevision(null);
    setDescriptors([]);
  }, []);

  const beginOwnerIntent = useCallback((): number => {
    ownerIntentRef.current += 1;
    return ownerIntentRef.current;
  }, []);

  const captureOwnerState = useCallback((): CapturedOwnerState | null => {
    const currentOwner = ownerRef.current;
    const currentRevision = ownerRevisionRef.current;
    if (currentOwner === null || currentRevision === null) return null;
    return {
      intent: ownerIntentRef.current,
      owner: copyOwner(currentOwner),
      ownerRevision: currentRevision,
      descriptors: copyDescriptors(descriptorsRef.current),
    };
  }, []);

  const isCurrentOwnerState = useCallback((captured: CapturedOwnerState): boolean => {
    return (
      ownerIntentRef.current === captured.intent &&
      isSameOwner(ownerRef.current, captured.owner) &&
      ownerRevisionRef.current === captured.ownerRevision
    );
  }, []);

  const commit = useCallback(
    (
      nextOwner: PresentationGrantOwner,
      nextOwnerRevision: number,
      nextDescriptors: readonly PresentationSourceDescriptor[]
    ): void => {
      const safeOwner = copyOwner(nextOwner);
      const safeDescriptors = copyDescriptors(nextDescriptors);
      ownerRef.current = safeOwner;
      ownerRevisionRef.current = nextOwnerRevision;
      descriptorsRef.current = safeDescriptors;
      setOwner(safeOwner);
      setOwnerRevision(nextOwnerRevision);
      setDescriptors(safeDescriptors);
    },
    []
  );

  const runPending = useCallback(async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    setPendingCount((count) => count + 1);
    try {
      return await operation();
    } finally {
      setPendingCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const hydrate = useCallback(
    async (nextOwner: PresentationGrantOwner): Promise<GetPresentationSourceOwnerResult> => {
      const requestOwner = copyOwner(nextOwner);
      const currentOwner = ownerRef.current;
      const currentRevision = ownerRevisionRef.current;
      const isSameOwnerRefresh = currentOwner !== null && isSameOwner(currentOwner, requestOwner);
      const intent = beginOwnerIntent();
      if (currentOwner !== null && !isSameOwnerRefresh) {
        detach();
      }
      return runPending(async () => {
        const result = await ipcBridge.presentationSources.getSourceOwner.invoke({ owner: requestOwner });
        if (!result.ok) return result;
        const resultOwner = normalizeOwner(result.owner);
        const ownerStateIsCurrent = isSameOwnerRefresh
          ? isSameOwner(ownerRef.current, requestOwner) && ownerRevisionRef.current === currentRevision
          : ownerRef.current === null && ownerRevisionRef.current === null;
        if (
          resultOwner === null ||
          intent !== ownerIntentRef.current ||
          !ownerStateIsCurrent ||
          !isSameOwner(resultOwner, requestOwner)
        ) {
          return invalidSourceAuthority();
        }
        commit(resultOwner, result.ownerRevision, result.grants);
        return { ...result, owner: resultOwner };
      });
    },
    [beginOwnerIntent, commit, detach, runPending]
  );

  const createDraft = useCallback(
    async (clientRequestId: string): Promise<CreatePresentationDraftResult> => {
      const intent = beginOwnerIntent();
      return runPending(async () => {
        const result = await ipcBridge.presentationSources.createDraft.invoke({ client_request_id: clientRequestId });
        if (!result.ok || intent !== ownerIntentRef.current) return result;

        const draftOwner: PresentationGrantOwner = {
          owner_type: 'draft',
          draft_id: result.draft.draftId,
        };
        if (result.status === 'created') {
          commit(draftOwner, result.draft.revision, []);
          return result;
        }

        const currentOwner = ownerRef.current;
        const currentRevision = ownerRevisionRef.current;
        const detachedState =
          currentOwner !== null && currentRevision !== null && !isSameOwner(currentOwner, draftOwner)
            ? {
                owner: copyOwner(currentOwner),
                ownerRevision: currentRevision,
                descriptors: copyDescriptors(descriptorsRef.current),
              }
            : null;
        if (currentOwner !== null && !isSameOwner(currentOwner, draftOwner)) {
          detach();
        }
        const expectedOwner = ownerRef.current === null ? null : copyOwner(ownerRef.current);
        const expectedOwnerRevision = ownerRevisionRef.current;
        const canonical = await ipcBridge.presentationSources.getSourceOwner.invoke({ owner: draftOwner });
        const localOwnerIsUnchanged =
          expectedOwner === null ? ownerRef.current === null : isSameOwner(ownerRef.current, expectedOwner);
        const localStateIsUnchanged = localOwnerIsUnchanged && ownerRevisionRef.current === expectedOwnerRevision;
        const canonicalRevisionIsNonRegressing =
          canonical.ok &&
          canonical.ownerRevision >= result.draft.revision &&
          (expectedOwnerRevision === null || canonical.ownerRevision >= expectedOwnerRevision);
        if (
          canonical.ok &&
          intent === ownerIntentRef.current &&
          localStateIsUnchanged &&
          isSameOwner(canonical.owner, draftOwner) &&
          canonicalRevisionIsNonRegressing
        ) {
          commit(canonical.owner, canonical.ownerRevision, canonical.grants);
        } else if (detachedState !== null && intent === ownerIntentRef.current && localStateIsUnchanged) {
          commit(detachedState.owner, detachedState.ownerRevision, detachedState.descriptors);
        }
        return result;
      });
    },
    [beginOwnerIntent, commit, detach, runPending]
  );

  const pickSources = useCallback(async (): Promise<PickPresentationSourcesResult | null> => {
    const captured = captureOwnerState();
    if (captured === null) return null;
    return runPending(async () => {
      const result = await ipcBridge.presentationSources.pickSources.invoke({
        owner: captured.owner,
        expected_owner_revision: captured.ownerRevision,
      });
      if (result.ok && result.status === 'selected' && isCurrentOwnerState(captured)) {
        commit(captured.owner, result.ownerRevision, result.grants);
      }
      return result;
    });
  }, [captureOwnerState, commit, isCurrentOwnerState, runPending]);

  const grantExternalDrop = useCallback(
    async (files: readonly File[]): Promise<GrantPresentationExternalDropResult | null> => {
      const captured = captureOwnerState();
      const grant =
        typeof window === 'undefined' ? undefined : window.electronAPI?.presentationSources?.grantExternalDrop;
      if (captured === null || files.length === 0 || grant === undefined) return null;
      return runPending(async () => {
        const result = await grant({
          owner: captured.owner,
          files: Array.from(files),
          expected_owner_revision: captured.ownerRevision,
        });
        if (result.ok && isCurrentOwnerState(captured)) {
          commit(captured.owner, result.ownerRevision, result.grants);
        }
        return result;
      });
    },
    [captureOwnerState, commit, isCurrentOwnerState, runPending]
  );

  const grantWorkspaceSource = useCallback(
    async (relativePath: string): Promise<GrantPresentationWorkspaceSourceResult | null> => {
      const captured = captureOwnerState();
      if (captured === null) return null;
      const capturedOwner = captured.owner;
      if (capturedOwner.owner_type !== 'conversation') return null;
      return runPending(async () => {
        const result = await ipcBridge.presentationSources.grantWorkspaceSource.invoke({
          conversation_id: capturedOwner.conversation_id,
          relative_path: relativePath,
          expected_owner_revision: captured.ownerRevision,
        });
        if (result.ok && isCurrentOwnerState(captured)) {
          const nextGrant = copyDescriptor(result.grant);
          const nextDescriptors = [
            ...captured.descriptors.filter((item) => item.grantId !== nextGrant.grantId),
            nextGrant,
          ];
          commit(captured.owner, result.ownerRevision, nextDescriptors);
        }
        return result;
      });
    },
    [captureOwnerState, commit, isCurrentOwnerState, runPending]
  );

  const revoke = useCallback(
    async (grantId: string): Promise<RevokePresentationSourceResult | null> => {
      const captured = captureOwnerState();
      if (captured === null) return null;
      return runPending(async () => {
        const result = await ipcBridge.presentationSources.revoke.invoke({
          owner: captured.owner,
          grant_id: grantId,
          expected_owner_revision: captured.ownerRevision,
        });
        if (result.ok && isCurrentOwnerState(captured)) {
          commit(
            captured.owner,
            result.ownerRevision,
            captured.descriptors.filter((item) => item.grantId !== result.grantId)
          );
        }
        return result;
      });
    },
    [captureOwnerState, commit, isCurrentOwnerState, runPending]
  );

  const bindDraft = useCallback(
    async (conversationId: string): Promise<BindPresentationDraftResult | null> => {
      const canonicalConversationId = normalizePresentationConversationId(conversationId);
      if (canonicalConversationId === null) return null;
      const captured = captureOwnerState();
      if (captured === null) return null;
      const capturedOwner = captured.owner;
      if (capturedOwner.owner_type !== 'draft') return null;
      return runPending(async () => {
        const result = await ipcBridge.presentationSources.bindDraft.invoke({
          draft_id: capturedOwner.draft_id,
          conversation_id: canonicalConversationId,
          expected_revision: captured.ownerRevision,
        });
        if (!result.ok) return result;
        const resultConversationId = normalizePresentationConversationId(result.conversationId);
        if (
          result.draftId !== capturedOwner.draft_id ||
          resultConversationId !== canonicalConversationId ||
          !isCurrentOwnerState(captured)
        ) {
          return null;
        }
        commit(
          { owner_type: 'conversation', conversation_id: canonicalConversationId },
          result.revision,
          captured.descriptors
        );
        return { ...result, conversationId: canonicalConversationId };
      });
    },
    [captureOwnerState, commit, isCurrentOwnerState, runPending]
  );

  const reset = useCallback((): void => {
    beginOwnerIntent();
    detach();
  }, [beginOwnerIntent, detach]);

  const sourceRefs = useMemo<PresentationSourceRef[]>(
    () =>
      descriptors.map((descriptor) => ({
        grantId: descriptor.grantId,
        expectedByteLength: descriptor.byteLength,
        expectedSha256: descriptor.sha256,
      })),
    [descriptors]
  );

  return {
    owner,
    ownerRevision,
    descriptors,
    sourceRefs,
    pending: pendingCount > 0,
    hydrate,
    createDraft,
    pickSources,
    grantExternalDrop,
    grantWorkspaceSource,
    revoke,
    bindDraft,
    reset,
  };
}
