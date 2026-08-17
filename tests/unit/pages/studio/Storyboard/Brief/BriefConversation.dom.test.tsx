/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider, ISessionMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { isBuiltinImageGenTransport } from '@process/resources/builtinMcp/constants';

const provider: IProvider = {
  id: 'provider_1',
  name: 'Provider',
  platform: 'openai',
  baseUrl: 'https://example.invalid',
  apiKey: 'key',
  models: ['model_1'],
} as IProvider;

const harness = vi.hoisted(() => ({
  conversations: [] as TChatConversation[],
  order: [] as string[],
  currentModel: undefined as TProviderWithModel | undefined,
  modelList: [] as unknown[],
  providersResolved: true,
  descriptorInvoke: vi.fn(),
  createInvoke: vi.fn(),
  bindInvoke: vi.fn(),
  sendInvoke: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      getBriefSessionServer: { invoke: harness.descriptorInvoke },
      bindBriefConversation: { invoke: harness.bindInvoke },
    },
    conversation: {
      create: { invoke: harness.createInvoke },
      sendMessage: { invoke: harness.sendInvoke },
    },
  },
}));

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({ allConversations: harness.conversations, conversations: [] }),
}));

vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({ current_model: harness.currentModel, modelList: harness.modelList }),
}));

// The eager start has to tell "no model yet" from "no model ever", and the provider query is the
// only thing that knows which it is. Nothing else in this hook reads it.
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => (harness.providersResolved ? { data: harness.modelList } : {}),
}));

import {
  forgetDirectorConversationStart,
  useBriefConversation,
} from '@/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation';

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 2,
  id: 'project_1',
  name: 'Coffee teaser',
  brief: 'A mountain coffee story',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '1080p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  ...overrides,
});

const descriptor: ISessionMcpServer = {
  id: 'studio-brief-project_1',
  name: 'aionui-creative-studio',
  transport: { type: 'stdio', command: 'node', args: ['/tmp/builtin-mcp-studio.js'] },
};

const conversation = (extra: TChatConversation['extra'], id = 'conversation_brief'): TChatConversation =>
  ({
    id,
    name: 'Coffee teaser',
    type: 'aionrs',
    model: { id: 'provider_1', name: 'Provider', use_model: 'model_1' },
    created_at: 1,
    modified_at: 1,
    extra,
  }) as TChatConversation;

const exactSnapshotConversation = (): TChatConversation =>
  conversation({
    backend: 'aionrs',
    workspace: '',
    studio_project_id: 'project_1',
    mcp_server_ids: [],
    mcp_servers: [descriptor.name],
    mcp_statuses: [{ id: descriptor.id, name: descriptor.name, status: 'loaded' }],
    session_mcp_servers: [descriptor],
  });

const AUTO_ATTACH_IDS = [
  'builtin-image-gen',
  'builtin-idp',
  'builtin-vision',
  'builtin-chrome-devtools',
  'builtin-memory',
  'builtin-tavily',
] as const;

const storageFailure = {
  ok: false,
  error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
} as const;

describe('useBriefConversation', () => {
  beforeEach(() => {
    forgetDirectorConversationStart();
    harness.conversations = [];
    harness.order = [];
    harness.currentModel = { id: 'provider_1', name: 'Provider', use_model: 'model_1' } as TProviderWithModel;
    harness.modelList = [provider];
    harness.providersResolved = true;
    harness.descriptorInvoke.mockReset().mockImplementation(async () => {
      harness.order.push('descriptor');
      return { ok: true, data: descriptor };
    });
    harness.createInvoke.mockReset().mockImplementation(async () => {
      harness.order.push('create');
      return exactSnapshotConversation();
    });
    harness.bindInvoke.mockReset().mockImplementation(async () => {
      harness.order.push('bind');
      return { ok: true, data: project({ briefConversationId: 'conversation_brief' }) };
    });
    harness.sendInvoke.mockReset().mockImplementation(async () => {
      harness.order.push('send');
      return { msg_id: 'message_1', turn_id: 'turn_1' };
    });
  });

  /**
   * D5: the conversation exists from the moment the project opens, so the pane can mount the real
   * chat instead of a stand-in composer. Nothing is sent — the user's first message is the first
   * message, and it goes through the same composer as every other conversation in the app.
   */
  it('creates and binds the curated conversation when the project opens, sending nothing', async () => {
    const rendered = renderHook(() => useBriefConversation(project()));

    await waitFor(() => expect(rendered.result.current.state.kind).toBe('ready'));

    expect(harness.order).toEqual(['descriptor', 'create', 'bind']);
    expect(harness.sendInvoke).not.toHaveBeenCalled();
    const createRequest = harness.createInvoke.mock.calls[0][0];
    expect(createRequest.extra).toMatchObject({
      studio_project_id: 'project_1',
      selected_session_mcp_servers: [descriptor],
    });
    expect(harness.bindInvoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 2,
      conversationId: 'conversation_brief',
    });
    expect(rendered.result.current.state).toMatchObject({ kind: 'ready', conversation: { id: 'conversation_brief' } });
  });

  /**
   * The guard has to outlive the component. A ref or a render-scoped flag is reset by the remount
   * this test performs, and the project record has not been rebound yet at that point, so a second
   * mount would happily create a second conversation for the same project.
   */
  it('creates one conversation per project across a remount that races the first attempt', async () => {
    const first = renderHook(() => useBriefConversation(project()));
    first.unmount();
    const second = renderHook(() => useBriefConversation(project()));

    await waitFor(() => expect(second.result.current.state.kind).toBe('ready'));

    expect(harness.createInvoke).toHaveBeenCalledOnce();
    expect(harness.bindInvoke).toHaveBeenCalledOnce();
  });

  it('creates one conversation per project for two simultaneous mounts', async () => {
    const first = renderHook(() => useBriefConversation(project()));
    const second = renderHook(() => useBriefConversation(project()));

    await waitFor(() => expect(first.result.current.state.kind).toBe('ready'));
    await waitFor(() => expect(second.result.current.state.kind).toBe('ready'));

    expect(harness.createInvoke).toHaveBeenCalledOnce();
  });

  it('binds against the revision the project is on when creation finishes, not when it started', async () => {
    let releaseCreate = (): void => {};
    harness.createInvoke.mockImplementationOnce(async () => {
      harness.order.push('create');
      await new Promise<void>((resolve) => {
        releaseCreate = resolve;
      });
      return exactSnapshotConversation();
    });
    const rendered = renderHook((props: StudioRendererProject) => useBriefConversation(props), {
      initialProps: project(),
    });

    await waitFor(() => expect(harness.createInvoke).toHaveBeenCalledOnce());
    rendered.rerender(project({ revision: 7 }));
    await act(async () => {
      releaseCreate();
    });

    await waitFor(() => expect(rendered.result.current.state.kind).toBe('ready'));
    expect(harness.bindInvoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 7,
      conversationId: 'conversation_brief',
    });
  });

  it('reports a failed start through errorMessageKey and starts over on recreate', async () => {
    harness.descriptorInvoke.mockImplementationOnce(async () => {
      harness.order.push('descriptor');
      return storageFailure;
    });
    const rendered = renderHook(() => useBriefConversation(project()));

    await waitFor(() =>
      expect(rendered.result.current.errorMessageKey).toBe('conversation.creativeStudio.errors.storage')
    );
    expect(rendered.result.current.state).toEqual({ kind: 'absent' });
    expect(harness.createInvoke).not.toHaveBeenCalled();

    act(() => rendered.result.current.recreate());

    await waitFor(() => expect(rendered.result.current.state.kind).toBe('ready'));
    expect(rendered.result.current.errorMessageKey).toBeNull();
  });

  it('does not retry a failed start by itself when the project changes underneath it', async () => {
    harness.descriptorInvoke.mockImplementation(async () => {
      harness.order.push('descriptor');
      return storageFailure;
    });
    const rendered = renderHook((props: StudioRendererProject) => useBriefConversation(props), {
      initialProps: project(),
    });

    await waitFor(() =>
      expect(rendered.result.current.errorMessageKey).toBe('conversation.creativeStudio.errors.storage')
    );
    rendered.rerender(project({ revision: 3 }));
    rendered.rerender(project({ revision: 4, name: 'Renamed' }));

    await waitFor(() => expect(rendered.result.current.errorMessageKey).not.toBeNull());
    expect(harness.descriptorInvoke).toHaveBeenCalledOnce();
  });

  it('surfaces a refused binding as a dangling conversation with its reason', async () => {
    harness.bindInvoke.mockImplementationOnce(async () => {
      harness.order.push('bind');
      return storageFailure;
    });
    const rendered = renderHook(() => useBriefConversation(project()));

    await waitFor(() => expect(rendered.result.current.state.kind).toBe('dangling'));

    expect(rendered.result.current.state).toEqual({ kind: 'dangling', conversationId: 'conversation_brief' });
    expect(rendered.result.current.errorMessageKey).toBe('conversation.creativeStudio.errors.storage');
  });

  it('rejects snapshot drift and fences every auto-attach server and image client transport', async () => {
    const injectedServers = AUTO_ATTACH_IDS.map((id) => ({
      id,
      name: id,
      transport: { type: 'stdio' as const, command: 'node', args: [`/tmp/${id}.js`] },
    }));
    harness.createInvoke.mockImplementationOnce(async () => {
      harness.order.push('create');
      return conversation({
        backend: 'aionrs',
        workspace: '',
        studio_project_id: 'project_1',
        mcp_server_ids: [],
        mcp_servers: [descriptor.name, ...injectedServers.map((server) => server.name)],
        mcp_statuses: [descriptor, ...injectedServers].map((server) => ({
          id: server.id,
          name: server.name,
          status: 'loaded',
        })),
        session_mcp_servers: [descriptor, ...injectedServers],
      });
    });
    const rendered = renderHook(() => useBriefConversation(project()));

    await waitFor(() => expect(rendered.result.current.errorMessageKey).not.toBeNull());

    const persistedSelection = harness.createInvoke.mock.calls[0][0].extra.selected_session_mcp_servers;
    for (const id of AUTO_ATTACH_IDS)
      expect(persistedSelection.map((server: ISessionMcpServer) => server.id)).not.toContain(id);
    expect(persistedSelection).toHaveLength(1);
    expect(persistedSelection[0].transport.args).toEqual(['/tmp/builtin-mcp-studio.js']);
    expect(isBuiltinImageGenTransport(persistedSelection[0].transport)).toBe(false);
    expect(persistedSelection[0].transport.args).not.toContain('/tmp/builtin-mcp-idp.js');
    expect(persistedSelection[0].transport.args).not.toContain('/tmp/builtin-mcp-vision.js');
    expect(harness.bindInvoke).not.toHaveBeenCalled();
    expect(harness.sendInvoke).not.toHaveBeenCalled();
    expect(rendered.result.current.state).toEqual({ kind: 'absent' });
  });

  it('exposes a dangling binding and creates a replacement after Start fresh', async () => {
    const rendered = renderHook(() => useBriefConversation(project({ briefConversationId: 'conversation_deleted' })));

    expect(rendered.result.current.state).toEqual({
      kind: 'dangling',
      conversationId: 'conversation_deleted',
    });
    expect(harness.createInvoke).not.toHaveBeenCalled();

    act(() => rendered.result.current.recreate());

    await waitFor(() => expect(rendered.result.current.state.kind).toBe('ready'));
    expect(harness.bindInvoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 2,
      conversationId: 'conversation_brief',
    });
    expect(harness.sendInvoke).not.toHaveBeenCalled();
  });

  it('waits for the model list to resolve before creating anything', async () => {
    harness.providersResolved = false;
    harness.currentModel = undefined;
    harness.modelList = [];
    const rendered = renderHook(() => useBriefConversation(project()));

    expect(rendered.result.current.state).toEqual({ kind: 'absent' });
    expect(rendered.result.current.errorMessageKey).toBeNull();
    expect(harness.descriptorInvoke).not.toHaveBeenCalled();

    harness.providersResolved = true;
    harness.currentModel = { id: 'provider_1', name: 'Provider', use_model: 'model_1' } as TProviderWithModel;
    harness.modelList = [provider];
    rendered.rerender();

    await waitFor(() => expect(rendered.result.current.state.kind).toBe('ready'));
  });

  it('says a model is needed rather than spinning forever when none is configured', async () => {
    harness.currentModel = undefined;
    harness.modelList = [];
    const rendered = renderHook(() => useBriefConversation(project()));

    await waitFor(() => expect(rendered.result.current.errorMessageKey).toBe('conversation.noModelConfigured'));
    expect(harness.descriptorInvoke).not.toHaveBeenCalled();
    expect(harness.createInvoke).not.toHaveBeenCalled();
  });
});
