/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { ICreateConversationParams } from '@/common/adapter/ipcBridge';
import { executeImageGeneration } from '@/common/chat/imageGenCore';
import { mergeCommodityMcpServerIds } from '@/common/config/builtinCapabilities';
import type { IMcpServer, TChatConversation } from '@/common/config/storage';

const boundaryMocks = vi.hoisted(() => ({
  defaultMcpAssembly: vi.fn(() => {
    throw new Error('curated creation reached default MCP assembly');
  }),
  executeImageGeneration: vi.fn(),
}));

vi.mock('@/common/config/builtinCapabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/config/builtinCapabilities')>()),
  mergeCommodityMcpServerIds: boundaryMocks.defaultMcpAssembly,
}));

vi.mock('@/common/chat/imageGenCore', () => ({
  executeImageGeneration: boundaryMocks.executeImageGeneration,
}));

type CreateStudioBriefConversation =
  (typeof import('@/renderer/pages/studio/components/PhaseShell/phases/studioBriefConversation'))['createStudioBriefConversation'];

const createStudioBriefConversation = (
  ...args: Parameters<CreateStudioBriefConversation>
): ReturnType<CreateStudioBriefConversation> =>
  import('@/renderer/pages/studio/components/PhaseShell/phases/studioBriefConversation').then(
    ({ createStudioBriefConversation }) => createStudioBriefConversation(...args)
  );

const server = (id: string, name: string, builtin: boolean): IMcpServer => ({
  id,
  name,
  builtin,
  enabled: true,
  transport: { type: 'stdio', command: 'node', args: [`${id}.js`] },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
});

const AUTO_ATTACH_SERVERS = [
  server('builtin-image-gen', 'aionui-image-generation', true),
  server('builtin-idp', 'greennode-idp', true),
  server('builtin-vision', 'aionui-image-analysis', true),
  server('builtin-chrome-devtools', 'chrome-devtools', true),
  server('builtin-memory', 'aionui-memory', true),
  server('builtin-tavily', 'aionui-web-search', true),
] as const;

const createInput = (mcpServerAllowlist: readonly string[], availableMcpServers: readonly IMcpServer[]) => ({
  name: 'Studio Brief',
  assistant: { id: 'bare:claude', locale: 'en-US' },
  studioProjectId: 'studio-project-1',
  mcpServerAllowlist,
  availableMcpServers,
  extra: { workspace: '/workspace/studio-project-1', custom_workspace: true },
});

describe('createStudioBriefConversation', () => {
  it('persists an empty MCP snapshot without consulting either default assembly path or the image client', async () => {
    const persistedConversation = {
      id: 'conversation-empty',
      name: 'Studio Brief',
      type: 'acp',
      extra: {
        studio_project_id: 'studio-project-1',
        mcp_server_ids: [],
        mcp_servers: [],
        mcp_statuses: [],
        session_mcp_servers: [],
      },
    } as TChatConversation;
    const createConversation = vi.fn(async (_request: ICreateConversationParams) => persistedConversation);

    const result = await createStudioBriefConversation(createInput([], AUTO_ATTACH_SERVERS), { createConversation });

    const request = createConversation.mock.calls[0][0];
    expect(request.assistant?.conversation_overrides?.mcp_ids).toEqual([]);
    expect(request.extra.selected_mcp_server_ids).toEqual([]);
    expect(request.extra.selected_session_mcp_servers).toEqual([]);
    expect(request.extra.studio_project_id).toBe('studio-project-1');

    expect(result.extra.mcp_server_ids).toEqual([]);
    expect(result.extra.mcp_servers).toEqual([]);
    expect(result.extra.mcp_statuses).toEqual([]);
    expect(result.extra.session_mcp_servers).toEqual([]);

    const persistedMcpIds = [
      ...(result.extra.mcp_server_ids ?? []),
      ...(result.extra.mcp_statuses ?? []).map((status) => status.id),
      ...(result.extra.session_mcp_servers ?? []).map((item) => item.id),
    ];
    expect(persistedMcpIds).not.toContain('builtin-image-gen');
    expect(persistedMcpIds).not.toContain('builtin-idp');
    expect(persistedMcpIds).not.toContain('builtin-vision');
    expect(persistedMcpIds).not.toContain('builtin-chrome-devtools');
    expect(persistedMcpIds).not.toContain('builtin-memory');
    expect(persistedMcpIds).not.toContain('builtin-tavily');
    expect(vi.mocked(mergeCommodityMcpServerIds)).not.toHaveBeenCalled();
    expect(vi.mocked(executeImageGeneration)).not.toHaveBeenCalled();
  });

  it('persists a non-empty allow-list across all four frozen MCP fields', async () => {
    const registeredStudioServer = server('studio-proposal', 'studio-proposal', false);
    const builtinStudioServer = server('builtin-mcp-studio', 'aionui-creative-studio', true);
    const availableMcpServers = [...AUTO_ATTACH_SERVERS, registeredStudioServer, builtinStudioServer];
    const persistedConversation = {
      id: 'conversation-curated',
      name: 'Studio Brief',
      type: 'acp',
      extra: {
        studio_project_id: 'studio-project-1',
        mcp_server_ids: ['studio-proposal'],
        mcp_servers: ['studio-proposal', 'aionui-creative-studio'],
        mcp_statuses: [
          { id: 'studio-proposal', name: 'studio-proposal', status: 'loaded' },
          { id: 'builtin-mcp-studio', name: 'aionui-creative-studio', status: 'loaded' },
        ],
        session_mcp_servers: [
          {
            id: 'builtin-mcp-studio',
            name: 'aionui-creative-studio',
            transport: { type: 'stdio', command: 'node', args: ['builtin-mcp-studio.js'] },
          },
        ],
      },
    } as TChatConversation;
    const createConversation = vi.fn(async (_request: ICreateConversationParams) => persistedConversation);

    const result = await createStudioBriefConversation(
      createInput(['studio-proposal', 'builtin-mcp-studio'], availableMcpServers),
      { createConversation }
    );

    const request = createConversation.mock.calls[0][0];
    expect(request.assistant?.conversation_overrides?.mcp_ids).toEqual(['studio-proposal', 'builtin-mcp-studio']);
    expect(request.extra.selected_mcp_server_ids).toEqual(['studio-proposal']);
    expect(request.extra.selected_session_mcp_servers).toEqual([
      {
        id: 'builtin-mcp-studio',
        name: 'aionui-creative-studio',
        transport: { type: 'stdio', command: 'node', args: ['builtin-mcp-studio.js'] },
      },
    ]);
    expect(result.extra.mcp_server_ids).toEqual(['studio-proposal']);
    expect(result.extra.mcp_servers).toEqual(['studio-proposal', 'aionui-creative-studio']);
    expect(result.extra.mcp_statuses?.map((status) => status.id)).toEqual(['studio-proposal', 'builtin-mcp-studio']);
    expect(result.extra.session_mcp_servers?.map((item) => item.id)).toEqual(['builtin-mcp-studio']);
  });

  it('fails closed before creation when the allow-list names an unavailable server', async () => {
    const createConversation = vi.fn(async (_request: ICreateConversationParams) => {
      throw new Error('must not create');
    });

    await expect(
      createStudioBriefConversation(createInput(['builtin-mcp-studio'], AUTO_ATTACH_SERVERS), { createConversation })
    ).rejects.toThrow('Curated MCP server is unavailable: builtin-mcp-studio');
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('fails loudly when persistence returns a default-assembled snapshot for a curated conversation', async () => {
    const persistedConversation = {
      id: 'conversation-drifted',
      name: 'Studio Brief',
      type: 'acp',
      extra: {
        studio_project_id: 'studio-project-1',
        mcp_server_ids: [],
        mcp_servers: ['aionui-image-generation'],
        mcp_statuses: [{ id: 'builtin-image-gen', name: 'aionui-image-generation', status: 'loaded' }],
        session_mcp_servers: [
          {
            id: 'builtin-image-gen',
            name: 'aionui-image-generation',
            transport: { type: 'stdio', command: 'node', args: ['builtin-image-gen.js'] },
          },
        ],
      },
    } as TChatConversation;
    const createConversation = vi.fn(async (_request: ICreateConversationParams) => persistedConversation);

    await expect(
      createStudioBriefConversation(createInput([], AUTO_ATTACH_SERVERS), { createConversation })
    ).rejects.toThrow('Curated MCP snapshot drifted after creation');
    expect(createConversation).toHaveBeenCalledOnce();
  });
});
