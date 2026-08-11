/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ISessionMcpServer, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { isBuiltinImageGenTransport } from '@process/resources/builtinMcp/constants';

const harness = vi.hoisted(() => ({
  conversations: [] as TChatConversation[],
  order: [] as string[],
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
  useGuidModelSelection: () => ({
    current_model: { id: 'provider_1', name: 'Provider', use_model: 'model_1' } as TProviderWithModel,
  }),
}));

import { useBriefConversation } from '@/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation';

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 2,
  id: 'project_1',
  name: 'Coffee teaser',
  brief: 'A mountain coffee story',
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

describe('useBriefConversation', () => {
  beforeEach(() => {
    harness.conversations = [];
    harness.order = [];
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

  it('creates the curated conversation on first send, binds it, and sends the first message', async () => {
    const rendered = renderHook(() => useBriefConversation(project()));

    await act(() => rendered.result.current.sendFirstMessage('Make me a coffee teaser'));

    expect(harness.order).toEqual(['descriptor', 'create', 'bind', 'send']);
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
    expect(harness.sendInvoke).toHaveBeenCalledWith({
      input: 'Make me a coffee teaser',
      conversation_id: 'conversation_brief',
      files: [],
      pinned_context: [],
    });
    expect(rendered.result.current.state).toMatchObject({ kind: 'ready', conversation: { id: 'conversation_brief' } });
  });

  it('rejects snapshot drift and fences every auto-attach server and image client transport', async () => {
    const injectedServers = AUTO_ATTACH_IDS.map((id) => ({
      id,
      name: id,
      transport: { type: 'stdio' as const, command: 'node', args: [`/tmp/${id}.js`] },
    }));
    harness.createInvoke.mockImplementationOnce(async () =>
      conversation({
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
      })
    );
    const rendered = renderHook(() => useBriefConversation(project()));

    await expect(act(() => rendered.result.current.sendFirstMessage('Draft it'))).rejects.toThrow(
      'Curated MCP snapshot drifted after creation'
    );

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
  });

  it('creates nothing when Brief opens without a send', () => {
    const rendered = renderHook(() => useBriefConversation(project()));

    expect(rendered.result.current.state).toEqual({ kind: 'absent' });
    expect(harness.descriptorInvoke).not.toHaveBeenCalled();
    expect(harness.createInvoke).not.toHaveBeenCalled();
  });

  it('exposes a dangling binding and recreates it on the next send after Start fresh', async () => {
    const rendered = renderHook(() => useBriefConversation(project({ briefConversationId: 'conversation_deleted' })));

    expect(rendered.result.current.state).toEqual({
      kind: 'dangling',
      conversationId: 'conversation_deleted',
    });
    act(() => rendered.result.current.recreate());
    expect(rendered.result.current.state).toEqual({ kind: 'absent' });

    await act(() => rendered.result.current.sendFirstMessage('Start again'));
    await waitFor(() => expect(rendered.result.current.state.kind).toBe('ready'));
    expect(harness.bindInvoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 2,
      conversationId: 'conversation_brief',
    });
  });
});
