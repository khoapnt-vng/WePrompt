/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BindPresentationDraftResult,
  CreatePresentationDraftResult,
  GetPresentationSourceOwnerResult,
  GrantPresentationWorkspaceSourceResult,
  PickPresentationSourcesResult,
  PresentationGrantOwner,
  PresentationRunFailure,
  PresentationSourceDescriptor,
  RevokePresentationSourceResult,
} from '@/common/types/office/presentationRun';
import { usePresentationSourceDraft } from '@/renderer/hooks/file/selection/usePresentationSourceDraft';

const {
  bindDraftInvokeMock,
  createDraftInvokeMock,
  getSourceOwnerInvokeMock,
  grantWorkspaceSourceInvokeMock,
  pickSourcesInvokeMock,
  revokeInvokeMock,
} = vi.hoisted(() => ({
  bindDraftInvokeMock: vi.fn(),
  createDraftInvokeMock: vi.fn(),
  getSourceOwnerInvokeMock: vi.fn(),
  grantWorkspaceSourceInvokeMock: vi.fn(),
  pickSourcesInvokeMock: vi.fn(),
  revokeInvokeMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    presentationSources: {
      getSourceOwner: { invoke: getSourceOwnerInvokeMock },
      createDraft: { invoke: createDraftInvokeMock },
      bindDraft: { invoke: bindDraftInvokeMock },
      pickSources: { invoke: pickSourcesInvokeMock },
      grantWorkspaceSource: { invoke: grantWorkspaceSourceInvokeMock },
      revoke: { invoke: revokeInvokeMock },
    },
  },
}));

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CASEFUL_CONVERSATION_ID = '2be7b8fc-6af5-42b8-aed5-03644735c730';
const SHORT_CONVERSATION_ID = 'd0921953';
const SECOND_CONVERSATION_ID = '66666666-6666-4666-8666-666666666666';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_DRAFT_ID = '77777777-7777-4777-8777-777777777777';
const CLIENT_REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_GRANT_ID = '55555555-5555-4555-8555-555555555555';

const conversationOwner: PresentationGrantOwner = {
  owner_type: 'conversation',
  conversation_id: CONVERSATION_ID,
};

const secondConversationOwner: PresentationGrantOwner = {
  owner_type: 'conversation',
  conversation_id: SECOND_CONVERSATION_ID,
};

const draftOwner: PresentationGrantOwner = {
  owner_type: 'draft',
  draft_id: DRAFT_ID,
};

const descriptor: PresentationSourceDescriptor = {
  grantId: GRANT_ID,
  displayName: 'brief.pdf',
  format: 'pdf',
  sourceKind: 'native-picker',
  byteLength: 12,
  sha256: 'a'.repeat(64),
  expiresAt: '2026-08-04T12:15:00.000Z',
};

const secondDescriptor: PresentationSourceDescriptor = {
  grantId: SECOND_GRANT_ID,
  displayName: 'metrics.xlsx',
  format: 'xlsx',
  sourceKind: 'workspace-relative',
  byteLength: 34,
  sha256: 'b'.repeat(64),
  expiresAt: '2026-08-04T12:15:00.000Z',
};

const featureDisabledFailure: PresentationRunFailure = {
  ok: false,
  code: 'FEATURE_DISABLED',
  messageKey: 'conversation.presentationRun.FEATURE_DISABLED',
  retryable: false,
  state: 'preflight',
  details: null,
};

const installExternalDrop = (invoke: ReturnType<typeof vi.fn>) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      presentationSources: {
        grantExternalDrop: invoke,
      },
    },
  });
};

const deferred = <Result,>() => {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('usePresentationSourceDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: undefined,
    });
  });

  it('hydrates only path-free descriptors and derives source refs from integrity metadata', async () => {
    const descriptorWithHiddenPath = {
      ...descriptor,
      nativePath: '/private/source/brief.pdf',
    } as unknown as PresentationSourceDescriptor;
    const response = {
      ok: true as const,
      owner: conversationOwner,
      ownerRevision: 3,
      grants: [descriptorWithHiddenPath],
    };
    getSourceOwnerInvokeMock.mockResolvedValue(response);
    const { result } = renderHook(() => usePresentationSourceDraft());

    let received: unknown;
    await act(async () => {
      received = await result.current.hydrate(conversationOwner);
    });

    expect(received).toEqual(response);
    expect(getSourceOwnerInvokeMock).toHaveBeenCalledWith({ owner: conversationOwner });
    expect(result.current.owner).toEqual(conversationOwner);
    expect(result.current.ownerRevision).toBe(3);
    expect(result.current.descriptors).toEqual([descriptor]);
    expect(result.current.descriptors[0]).not.toHaveProperty('nativePath');
    expect(result.current.sourceRefs).toEqual([
      {
        grantId: GRANT_ID,
        expectedByteLength: 12,
        expectedSha256: 'a'.repeat(64),
      },
    ]);
  });

  it('canonicalizes an uppercase backend short owner before hydrate and accepts the canonical response', async () => {
    const uppercaseOwner: PresentationGrantOwner = {
      owner_type: 'conversation',
      conversation_id: SHORT_CONVERSATION_ID.toUpperCase(),
    };
    const canonicalOwner: PresentationGrantOwner = {
      owner_type: 'conversation',
      conversation_id: SHORT_CONVERSATION_ID,
    };
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: canonicalOwner,
      ownerRevision: 3,
      grants: [descriptor],
    });
    const { result } = renderHook(() => usePresentationSourceDraft());

    await act(async () => {
      await result.current.hydrate(uppercaseOwner);
    });

    expect(getSourceOwnerInvokeMock).toHaveBeenCalledWith({ owner: canonicalOwner });
    expect(result.current.owner).toEqual(canonicalOwner);
    expect(result.current.ownerRevision).toBe(3);
    expect(result.current.descriptors).toEqual([descriptor]);
  });

  it('fails closed when hydrate returns a successful DTO with a malformed conversation owner', async () => {
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: { owner_type: 'conversation', conversation_id: '../unsafe' },
      ownerRevision: 3,
      grants: [descriptor],
    } as GetPresentationSourceOwnerResult);
    const { result } = renderHook(() => usePresentationSourceDraft());

    let received!: GetPresentationSourceOwnerResult;
    await act(async () => {
      received = await result.current.hydrate(conversationOwner);
    });

    expect(received).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      messageKey: 'conversation.presentationRun.INVALID_REQUEST',
    });
    expect(result.current.owner).toBeNull();
    expect(result.current.ownerRevision).toBeNull();
    expect(result.current.descriptors).toEqual([]);
  });

  it('keeps the latest hydrate owner when an older hydrate resolves last', async () => {
    const first = deferred<GetPresentationSourceOwnerResult>();
    const second = deferred<GetPresentationSourceOwnerResult>();
    getSourceOwnerInvokeMock.mockImplementation(({ owner }: { owner: PresentationGrantOwner }) =>
      owner.owner_type === 'conversation' && owner.conversation_id === CONVERSATION_ID ? first.promise : second.promise
    );
    const { result } = renderHook(() => usePresentationSourceDraft());
    let firstRequest!: Promise<GetPresentationSourceOwnerResult>;
    let secondRequest!: Promise<GetPresentationSourceOwnerResult>;

    act(() => {
      firstRequest = result.current.hydrate(conversationOwner);
      secondRequest = result.current.hydrate(secondConversationOwner);
    });
    await act(async () => {
      second.resolve({
        ok: true,
        owner: secondConversationOwner,
        ownerRevision: 9,
        grants: [secondDescriptor],
      });
      await secondRequest;
    });
    await act(async () => {
      first.resolve({ ok: true, owner: conversationOwner, ownerRevision: 3, grants: [descriptor] });
      await firstRequest;
    });

    expect(result.current.owner).toEqual(secondConversationOwner);
    expect(result.current.ownerRevision).toBe(9);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('detaches a different current owner immediately while the new owner hydrates', async () => {
    const second = deferred<GetPresentationSourceOwnerResult>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: conversationOwner, ownerRevision: 3, grants: [descriptor] })
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
    });
    let secondRequest!: Promise<GetPresentationSourceOwnerResult>;

    act(() => {
      secondRequest = result.current.hydrate(secondConversationOwner);
    });
    expect(result.current.owner).toBeNull();
    expect(result.current.ownerRevision).toBeNull();
    expect(result.current.descriptors).toEqual([]);
    expect(result.current.sourceRefs).toEqual([]);

    await act(async () => {
      second.resolve(featureDisabledFailure);
      await secondRequest;
    });
    expect(result.current.owner).toBeNull();
    expect(result.current.descriptors).toEqual([]);
  });

  it('preserves canonical state when refreshing the same owner fails', async () => {
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: conversationOwner, ownerRevision: 3, grants: [descriptor] })
      .mockResolvedValueOnce(featureDisabledFailure);
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
      await result.current.hydrate(conversationOwner);
    });

    expect(result.current.owner).toEqual(conversationOwner);
    expect(result.current.ownerRevision).toBe(3);
    expect(result.current.descriptors).toEqual([descriptor]);
  });

  it('does not let a delayed same-owner hydrate overwrite a newer mutation revision', async () => {
    const refresh = deferred<GetPresentationSourceOwnerResult>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: conversationOwner, ownerRevision: 1, grants: [descriptor] })
      .mockReturnValueOnce(refresh.promise);
    pickSourcesInvokeMock.mockResolvedValue({
      ok: true,
      status: 'selected',
      ownerRevision: 2,
      grants: [descriptor, secondDescriptor],
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
    });
    let refreshRequest!: Promise<GetPresentationSourceOwnerResult>;
    act(() => {
      refreshRequest = result.current.hydrate(conversationOwner);
    });
    await act(async () => {
      await result.current.pickSources();
    });
    await act(async () => {
      refresh.resolve({ ok: true, owner: conversationOwner, ownerRevision: 1, grants: [descriptor] });
      await refreshRequest;
    });

    expect(result.current.ownerRevision).toBe(2);
    expect(result.current.descriptors).toEqual([descriptor, secondDescriptor]);
  });

  it('keeps a newer hydrate owner when an older createDraft resolves last', async () => {
    const create = deferred<CreatePresentationDraftResult>();
    createDraftInvokeMock.mockReturnValue(create.promise);
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: secondConversationOwner,
      ownerRevision: 9,
      grants: [secondDescriptor],
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    let createRequest!: Promise<CreatePresentationDraftResult>;

    act(() => {
      createRequest = result.current.createDraft(CLIENT_REQUEST_ID);
    });
    await act(async () => {
      await result.current.hydrate(secondConversationOwner);
    });
    await act(async () => {
      create.resolve({
        ok: true,
        status: 'created',
        draft: {
          draftId: DRAFT_ID,
          revision: 0,
          expiresAt: '2026-08-04T12:15:00.000Z',
          grantCount: 0,
        },
      });
      await createRequest;
    });

    expect(result.current.owner).toEqual(secondConversationOwner);
    expect(result.current.ownerRevision).toBe(9);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('replaces descriptors after picker confirmation and leaves state untouched on cancel or failure', async () => {
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: conversationOwner,
      ownerRevision: 3,
      grants: [descriptor],
    });
    pickSourcesInvokeMock
      .mockResolvedValueOnce({
        ok: true,
        status: 'selected',
        grants: [descriptor, secondDescriptor],
        ownerRevision: 4,
      })
      .mockResolvedValueOnce({ ok: true, status: 'cancelled', grants: [], ownerRevision: 4 })
      .mockResolvedValueOnce(featureDisabledFailure);
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
      await result.current.pickSources();
    });

    expect(pickSourcesInvokeMock).toHaveBeenNthCalledWith(1, {
      owner: conversationOwner,
      expected_owner_revision: 3,
    });
    expect(result.current.ownerRevision).toBe(4);
    expect(result.current.descriptors).toEqual([descriptor, secondDescriptor]);

    const confirmedState = {
      owner: result.current.owner,
      ownerRevision: result.current.ownerRevision,
      descriptors: result.current.descriptors,
    };
    await act(async () => {
      await result.current.pickSources();
      await result.current.pickSources();
    });

    expect(pickSourcesInvokeMock).toHaveBeenNthCalledWith(2, {
      owner: conversationOwner,
      expected_owner_revision: 4,
    });
    expect(pickSourcesInvokeMock).toHaveBeenNthCalledWith(3, {
      owner: conversationOwner,
      expected_owner_revision: 4,
    });
    expect({
      owner: result.current.owner,
      ownerRevision: result.current.ownerRevision,
      descriptors: result.current.descriptors,
    }).toEqual(confirmedState);
  });

  it('ignores a delayed picker confirmation after a newer owner hydrate', async () => {
    const picker = deferred<PickPresentationSourcesResult>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: conversationOwner, ownerRevision: 1, grants: [descriptor] })
      .mockResolvedValueOnce({
        ok: true,
        owner: secondConversationOwner,
        ownerRevision: 4,
        grants: [secondDescriptor],
      });
    pickSourcesInvokeMock.mockReturnValue(picker.promise);
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
    });
    let pickerRequest!: Promise<PickPresentationSourcesResult | null>;
    act(() => {
      pickerRequest = result.current.pickSources();
    });

    await act(async () => {
      await result.current.hydrate(secondConversationOwner);
    });
    await act(async () => {
      picker.resolve({ ok: true, status: 'selected', ownerRevision: 2, grants: [descriptor] });
      await pickerRequest;
    });

    expect(result.current.owner).toEqual(secondConversationOwner);
    expect(result.current.ownerRevision).toBe(4);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('keeps external drop unavailable in WebUI and preserves state when preload rejects a synthetic File', async () => {
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: conversationOwner,
      ownerRevision: 1,
      grants: [descriptor],
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
    });

    const syntheticFile = new File(['not native'], 'synthetic.pdf', { type: 'application/pdf' });
    let unavailable: unknown;
    await act(async () => {
      unavailable = await result.current.grantExternalDrop([syntheticFile]);
    });
    expect(unavailable).toBeNull();

    const dropInvoke = vi.fn().mockResolvedValue({
      ok: false,
      code: 'NATIVE_FILE_REQUIRED',
      messageKey: 'conversation.presentationRun.NATIVE_FILE_REQUIRED',
      retryable: false,
      state: 'preflight',
      details: null,
    });
    installExternalDrop(dropInvoke);
    await act(async () => {
      await result.current.grantExternalDrop([syntheticFile]);
    });

    expect(dropInvoke).toHaveBeenCalledWith({
      owner: conversationOwner,
      files: [syntheticFile],
      expected_owner_revision: 1,
    });
    expect(result.current.ownerRevision).toBe(1);
    expect(result.current.descriptors).toEqual([descriptor]);
  });

  it('accepts confirmed Electron drops without exposing native paths', async () => {
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: conversationOwner,
      ownerRevision: 1,
      grants: [],
    });
    const dropInvoke = vi.fn().mockResolvedValue({
      ok: true,
      status: 'granted',
      grants: [{ ...descriptor, nativePath: '/private/source/brief.pdf' }],
      ownerRevision: 2,
    });
    installExternalDrop(dropInvoke);
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
    });

    const file = new File(['native proxy'], 'brief.pdf', { type: 'application/pdf' });
    await act(async () => {
      await result.current.grantExternalDrop([file]);
    });

    expect(result.current.ownerRevision).toBe(2);
    expect(result.current.descriptors).toEqual([descriptor]);
    expect(result.current.descriptors[0]).not.toHaveProperty('nativePath');
  });

  it('grants conversation-relative workspace sources and revokes by opaque grant id', async () => {
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: conversationOwner,
      ownerRevision: 7,
      grants: [descriptor],
    });
    grantWorkspaceSourceInvokeMock.mockResolvedValue({
      ok: true,
      status: 'granted',
      grant: secondDescriptor,
      ownerRevision: 8,
    });
    revokeInvokeMock.mockResolvedValue({
      ok: true,
      status: 'revoked',
      grantId: GRANT_ID,
      ownerRevision: 9,
      revokedAt: '2026-08-04T12:01:00.000Z',
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
      await result.current.grantWorkspaceSource('reports/metrics.xlsx');
      await result.current.revoke(GRANT_ID);
    });

    expect(grantWorkspaceSourceInvokeMock).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      relative_path: 'reports/metrics.xlsx',
      expected_owner_revision: 7,
    });
    expect(revokeInvokeMock).toHaveBeenCalledWith({
      owner: conversationOwner,
      grant_id: GRANT_ID,
      expected_owner_revision: 8,
    });
    expect(result.current.ownerRevision).toBe(9);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('ignores delayed workspace and revoke results after owner intent changes', async () => {
    const workspace = deferred<GrantPresentationWorkspaceSourceResult>();
    const revoke = deferred<RevokePresentationSourceResult>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: conversationOwner, ownerRevision: 2, grants: [descriptor] })
      .mockResolvedValue({
        ok: true,
        owner: secondConversationOwner,
        ownerRevision: 8,
        grants: [secondDescriptor],
      });
    grantWorkspaceSourceInvokeMock.mockReturnValue(workspace.promise);
    revokeInvokeMock.mockReturnValue(revoke.promise);
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
    });
    let workspaceRequest!: Promise<GrantPresentationWorkspaceSourceResult | null>;
    let revokeRequest!: Promise<RevokePresentationSourceResult | null>;
    act(() => {
      workspaceRequest = result.current.grantWorkspaceSource('reports/metrics.xlsx');
      revokeRequest = result.current.revoke(GRANT_ID);
    });

    await act(async () => {
      await result.current.hydrate(secondConversationOwner);
    });
    await act(async () => {
      workspace.resolve({ ok: true, status: 'granted', grant: descriptor, ownerRevision: 3 });
      revoke.resolve({
        ok: true,
        status: 'revoked',
        grantId: GRANT_ID,
        ownerRevision: 3,
        revokedAt: '2026-08-04T12:03:00.000Z',
      });
      await Promise.all([workspaceRequest, revokeRequest]);
    });

    expect(result.current.owner).toEqual(secondConversationOwner);
    expect(result.current.ownerRevision).toBe(8);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('ignores a delayed bind after a newer owner hydrate', async () => {
    const bind = deferred<BindPresentationDraftResult>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: draftOwner, ownerRevision: 4, grants: [descriptor] })
      .mockResolvedValueOnce({
        ok: true,
        owner: secondConversationOwner,
        ownerRevision: 8,
        grants: [secondDescriptor],
      });
    bindDraftInvokeMock.mockReturnValue(bind.promise);
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(draftOwner);
    });
    let bindRequest!: Promise<BindPresentationDraftResult | null>;
    act(() => {
      bindRequest = result.current.bindDraft(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.hydrate(secondConversationOwner);
    });
    await act(async () => {
      bind.resolve({
        ok: true,
        status: 'bound',
        draftId: DRAFT_ID,
        conversationId: CONVERSATION_ID,
        revision: 5,
        boundAt: '2026-08-04T12:04:00.000Z',
      });
      await bindRequest;
    });

    expect(result.current.owner).toEqual(secondConversationOwner);
    expect(result.current.ownerRevision).toBe(8);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('creates and binds a Guid draft, while reset only detaches local state', async () => {
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'created',
      draft: {
        draftId: DRAFT_ID,
        revision: 0,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    bindDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'bound',
      draftId: DRAFT_ID,
      conversationId: CONVERSATION_ID,
      revision: 1,
      boundAt: '2026-08-04T12:02:00.000Z',
    });
    const { result } = renderHook(() => usePresentationSourceDraft());

    await act(async () => {
      await result.current.createDraft(CLIENT_REQUEST_ID);
    });
    expect(createDraftInvokeMock).toHaveBeenCalledWith({ client_request_id: CLIENT_REQUEST_ID });
    expect(result.current.owner).toEqual({ owner_type: 'draft', draft_id: DRAFT_ID });
    expect(result.current.ownerRevision).toBe(0);

    await act(async () => {
      await result.current.bindDraft(CONVERSATION_ID);
    });
    expect(bindDraftInvokeMock).toHaveBeenCalledWith({
      draft_id: DRAFT_ID,
      conversation_id: CONVERSATION_ID,
      expected_revision: 0,
    });
    expect(result.current.owner).toEqual(conversationOwner);
    expect(result.current.ownerRevision).toBe(1);

    act(() => result.current.reset());
    expect(result.current.owner).toBeNull();
    expect(result.current.ownerRevision).toBeNull();
    expect(result.current.descriptors).toEqual([]);
    expect(result.current.sourceRefs).toEqual([]);
  });

  it('canonicalizes an uppercase legacy UUID at bind ingress before comparing the main response', async () => {
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'created',
      draft: {
        draftId: DRAFT_ID,
        revision: 0,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    bindDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'bound',
      draftId: DRAFT_ID,
      conversationId: CASEFUL_CONVERSATION_ID,
      revision: 1,
      boundAt: '2026-08-04T12:02:00.000Z',
    });
    const { result } = renderHook(() => usePresentationSourceDraft());

    await act(async () => {
      await result.current.createDraft(CLIENT_REQUEST_ID);
      await result.current.bindDraft(CASEFUL_CONVERSATION_ID.toUpperCase());
    });

    expect(bindDraftInvokeMock).toHaveBeenCalledWith({
      draft_id: DRAFT_ID,
      conversation_id: CASEFUL_CONVERSATION_ID,
      expected_revision: 0,
    });
    expect(result.current.owner).toEqual({
      owner_type: 'conversation',
      conversation_id: CASEFUL_CONVERSATION_ID,
    });
    expect(result.current.ownerRevision).toBe(1);
  });

  it('returns no binding authority when main reports success with a malformed conversation id', async () => {
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'created',
      draft: {
        draftId: DRAFT_ID,
        revision: 0,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    bindDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'bound',
      draftId: DRAFT_ID,
      conversationId: '../unsafe',
      revision: 1,
      boundAt: '2026-08-04T12:02:00.000Z',
    });
    const { result } = renderHook(() => usePresentationSourceDraft());

    let binding: BindPresentationDraftResult | null = null;
    await act(async () => {
      await result.current.createDraft(CLIENT_REQUEST_ID);
      binding = await result.current.bindDraft(CONVERSATION_ID);
    });

    expect(binding).toBeNull();
    expect(result.current.owner).toEqual(draftOwner);
    expect(result.current.ownerRevision).toBe(0);
  });

  it('rehydrates nonempty canonical grants when an existing Guid draft remounts', async () => {
    createDraftInvokeMock
      .mockResolvedValueOnce({
        ok: true,
        status: 'created',
        draft: {
          draftId: DRAFT_ID,
          revision: 0,
          expiresAt: '2026-08-04T12:15:00.000Z',
          grantCount: 0,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'existing',
        draft: {
          draftId: DRAFT_ID,
          revision: 1,
          expiresAt: '2026-08-04T12:15:00.000Z',
          grantCount: 0,
        },
      });
    pickSourcesInvokeMock.mockResolvedValue({
      ok: true,
      status: 'selected',
      grants: [descriptor],
      ownerRevision: 1,
    });
    getSourceOwnerInvokeMock.mockResolvedValue({
      ok: true,
      owner: draftOwner,
      ownerRevision: 1,
      grants: [descriptor],
    });
    const firstMount = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await firstMount.result.current.createDraft(CLIENT_REQUEST_ID);
      await firstMount.result.current.pickSources();
    });
    expect(firstMount.result.current.descriptors).toEqual([descriptor]);
    firstMount.unmount();

    const remount = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await remount.result.current.createDraft(CLIENT_REQUEST_ID);
    });

    expect(getSourceOwnerInvokeMock).toHaveBeenCalledWith({ owner: draftOwner });
    expect(remount.result.current.owner).toEqual(draftOwner);
    expect(remount.result.current.ownerRevision).toBe(1);
    expect(remount.result.current.descriptors).toEqual([descriptor]);
  });

  it('keeps a same-draft picker mutation when an existing draft canonical lookup resolves late', async () => {
    const canonical = deferred<GetPresentationSourceOwnerResult>();
    const canonicalStarted = deferred<void>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: draftOwner, ownerRevision: 1, grants: [descriptor] })
      .mockImplementationOnce(() => {
        canonicalStarted.resolve();
        return canonical.promise;
      });
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'existing',
      draft: {
        draftId: DRAFT_ID,
        revision: 1,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    pickSourcesInvokeMock.mockResolvedValue({
      ok: true,
      status: 'selected',
      ownerRevision: 2,
      grants: [descriptor, secondDescriptor],
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    let createRequest!: Promise<CreatePresentationDraftResult>;
    await act(async () => {
      await result.current.hydrate(draftOwner);
      createRequest = result.current.createDraft(CLIENT_REQUEST_ID);
      await canonicalStarted.promise;
    });

    await act(async () => {
      await result.current.pickSources();
    });
    await act(async () => {
      canonical.resolve({ ok: true, owner: draftOwner, ownerRevision: 1, grants: [descriptor] });
      await createRequest;
    });

    expect(result.current.owner).toEqual(draftOwner);
    expect(result.current.ownerRevision).toBe(2);
    expect(result.current.descriptors).toEqual([descriptor, secondDescriptor]);
  });

  it('keeps a same-draft revoke mutation when an existing draft canonical lookup resolves late', async () => {
    const canonical = deferred<GetPresentationSourceOwnerResult>();
    const canonicalStarted = deferred<void>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({
        ok: true,
        owner: draftOwner,
        ownerRevision: 2,
        grants: [descriptor, secondDescriptor],
      })
      .mockImplementationOnce(() => {
        canonicalStarted.resolve();
        return canonical.promise;
      });
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'existing',
      draft: {
        draftId: DRAFT_ID,
        revision: 2,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    revokeInvokeMock.mockResolvedValue({
      ok: true,
      status: 'revoked',
      grantId: GRANT_ID,
      ownerRevision: 3,
      revokedAt: '2026-08-04T12:04:00.000Z',
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    let createRequest!: Promise<CreatePresentationDraftResult>;
    await act(async () => {
      await result.current.hydrate(draftOwner);
      createRequest = result.current.createDraft(CLIENT_REQUEST_ID);
      await canonicalStarted.promise;
    });

    await act(async () => {
      await result.current.revoke(GRANT_ID);
    });
    await act(async () => {
      canonical.resolve({
        ok: true,
        owner: draftOwner,
        ownerRevision: 2,
        grants: [descriptor, secondDescriptor],
      });
      await createRequest;
    });

    expect(result.current.owner).toEqual(draftOwner);
    expect(result.current.ownerRevision).toBe(3);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('ignores an existing draft canonical snapshot older than the returned draft revision', async () => {
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: draftOwner, ownerRevision: 5, grants: [secondDescriptor] })
      .mockResolvedValueOnce({ ok: true, owner: draftOwner, ownerRevision: 4, grants: [descriptor] });
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'existing',
      draft: {
        draftId: DRAFT_ID,
        revision: 5,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(draftOwner);
      await result.current.createDraft(CLIENT_REQUEST_ID);
    });

    expect(result.current.owner).toEqual(draftOwner);
    expect(result.current.ownerRevision).toBe(5);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('replays an existing draft from canonical owner state instead of pairing it with prior descriptors', async () => {
    const canonical = deferred<GetPresentationSourceOwnerResult>();
    const canonicalStarted = deferred<void>();
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: conversationOwner, ownerRevision: 2, grants: [descriptor] })
      .mockImplementationOnce(() => {
        canonicalStarted.resolve();
        return canonical.promise;
      });
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'existing',
      draft: {
        draftId: SECOND_DRAFT_ID,
        revision: 5,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    let createRequest!: Promise<CreatePresentationDraftResult>;
    await act(async () => {
      await result.current.hydrate(conversationOwner);
      createRequest = result.current.createDraft(CLIENT_REQUEST_ID);
      await canonicalStarted.promise;
    });

    expect(result.current.owner).toBeNull();
    expect(result.current.ownerRevision).toBeNull();
    expect(result.current.descriptors).toEqual([]);

    await act(async () => {
      canonical.resolve({
        ok: true,
        owner: { owner_type: 'draft', draft_id: SECOND_DRAFT_ID },
        ownerRevision: 6,
        grants: [secondDescriptor],
      });
      await createRequest;
    });

    expect(result.current.owner).toEqual({ owner_type: 'draft', draft_id: SECOND_DRAFT_ID });
    expect(result.current.ownerRevision).toBe(6);
    expect(result.current.descriptors).toEqual([secondDescriptor]);
  });

  it('preserves prior local state when rehydrating an existing draft fails', async () => {
    getSourceOwnerInvokeMock
      .mockResolvedValueOnce({ ok: true, owner: conversationOwner, ownerRevision: 2, grants: [descriptor] })
      .mockResolvedValueOnce(featureDisabledFailure);
    createDraftInvokeMock.mockResolvedValue({
      ok: true,
      status: 'existing',
      draft: {
        draftId: SECOND_DRAFT_ID,
        revision: 5,
        expiresAt: '2026-08-04T12:15:00.000Z',
        grantCount: 0,
      },
    });
    const { result } = renderHook(() => usePresentationSourceDraft());
    await act(async () => {
      await result.current.hydrate(conversationOwner);
      await result.current.createDraft(CLIENT_REQUEST_ID);
    });

    expect(result.current.owner).toEqual(conversationOwner);
    expect(result.current.ownerRevision).toBe(2);
    expect(result.current.descriptors).toEqual([descriptor]);
  });

  it('returns null without sufficient owner state and never converts renderer paths into authority', async () => {
    const { result } = renderHook(() => usePresentationSourceDraft());
    let pickerResult: unknown;
    let workspaceResult: unknown;
    let revokeResult: unknown;
    let bindResult: unknown;

    await act(async () => {
      pickerResult = await result.current.pickSources();
      workspaceResult = await result.current.grantWorkspaceSource('/absolute/source.pdf');
      revokeResult = await result.current.revoke('/private/source.pdf');
      bindResult = await result.current.bindDraft(CONVERSATION_ID);
    });

    expect(pickerResult).toBeNull();
    expect(workspaceResult).toBeNull();
    expect(revokeResult).toBeNull();
    expect(bindResult).toBeNull();
    expect(pickSourcesInvokeMock).not.toHaveBeenCalled();
    expect(grantWorkspaceSourceInvokeMock).not.toHaveBeenCalled();
    expect(revokeInvokeMock).not.toHaveBeenCalled();
    expect(bindDraftInvokeMock).not.toHaveBeenCalled();
  });
});
