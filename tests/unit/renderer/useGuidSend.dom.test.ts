/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESENTATION_RUN_V2_ENABLED } from '@/common/config/constants';
import type { IMcpServer } from '@/common/config/storage';
import type {
  BindPresentationDraftResult,
  GetPresentationSourceOwnerResult,
  PresentationSourceRef,
} from '@/common/types/office/presentationRun';
import {
  readGuidManagedPresentationRecovery,
  useGuidSend,
  type GuidSendDeps,
} from '@/renderer/pages/guid/hooks/useGuidSend';

const createConversationInvokeMock = vi.fn();
const getConversationInvokeMock = vi.fn();
const listConversationsInvokeMock = vi.fn();
const removeConversationInvokeMock = vi.fn();
const confirmQueuedSourcesInvokeMock = vi.fn();
const startPresentationRunInvokeMock = vi.fn();
const getPresentationRunInvokeMock = vi.fn();
const claimInitialDispatchInvokeMock = vi.fn();
const renewInitialDispatchInvokeMock = vi.fn();
const dispatchPresentationRunInvokeMock = vi.fn();
const swrMutateMock = vi.fn();
const kbGetSessionMcpServerMock = vi.fn();
const kbSyncFolderMock = vi.fn();
const listAvailableSkillsInvokeMock = vi.fn();
const getAssistantInvokeMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: {
        invoke: (...args: unknown[]) => createConversationInvokeMock(...args),
      },
      get: {
        invoke: (...args: unknown[]) => getConversationInvokeMock(...args),
      },
      remove: {
        invoke: (...args: unknown[]) => removeConversationInvokeMock(...args),
      },
    },
    database: {
      getUserConversations: {
        invoke: (...args: unknown[]) => listConversationsInvokeMock(...args),
      },
    },
    presentationSources: {
      confirmQueued: {
        invoke: (...args: unknown[]) => confirmQueuedSourcesInvokeMock(...args),
      },
    },
    fs: {
      listAvailableSkills: {
        invoke: (...args: unknown[]) => listAvailableSkillsInvokeMock(...args),
      },
    },
    assistants: {
      get: {
        invoke: (...args: unknown[]) => getAssistantInvokeMock(...args),
      },
    },
    presentationRuns: {
      start: {
        invoke: (...args: unknown[]) => startPresentationRunInvokeMock(...args),
      },
      get: {
        invoke: (...args: unknown[]) => getPresentationRunInvokeMock(...args),
      },
      claimInitialDispatch: {
        invoke: (...args: unknown[]) => claimInitialDispatchInvokeMock(...args),
      },
      renewInitialDispatch: {
        invoke: (...args: unknown[]) => renewInitialDispatchInvokeMock(...args),
      },
      dispatch: {
        invoke: (...args: unknown[]) => dispatchPresentationRunInvokeMock(...args),
      },
    },
    projectKnowledge: {
      getSessionMcpServer: {
        invoke: (...args: unknown[]) => kbGetSessionMcpServerMock(...args),
      },
      syncFolder: {
        invoke: (...args: unknown[]) => kbSyncFolderMock(...args),
      },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/projects/projectStorage', () => ({
  findProjectById: (id: string) => (id === 'p1' ? { id: 'p1', workspace: '/ws/p1' } : null),
  getWorkspaceBasename: (workspace: string) => workspace.split('/').at(-1) ?? workspace,
  readProjects: () => [],
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  default: () => ({ data: null }),
  mutate: (...args: unknown[]) => swrMutateMock(...args),
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props, children),
  ConfigProvider: ({ children }: { children?: React.ReactNode }) => children,
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const createDeps = (): GuidSendDeps => ({
  input: 'hello',
  setInput: vi.fn(),
  files: [],
  setFiles: vi.fn(),
  dir: '',
  setDir: vi.fn(),
  projectId: undefined,
  setProjectId: vi.fn(),
  setLoading: vi.fn(),
  loading: false,
  selectedAssistantId: 'assistant-1',
  selectedAssistantBackend: 'claude',
  selectedMode: 'bypassPermissions',
  selectedAcpModel: 'claude-opus',
  currentAcpCachedModelInfo: null,
  current_model: undefined,
  guidDisabledBuiltinSkills: undefined,
  guidEnabledSkills: undefined,
  assistantDefaultSkillIds: undefined,
  assistantDefaultDisabledBuiltinSkillIds: undefined,
  availableMcpServers: [{ id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer],
  selectedMcpServerIds: ['mcp-user'],
  assistantDefaultMcpIds: undefined,
  isGoogleAuth: false,
  setMentionOpen: vi.fn(),
  setMentionQuery: vi.fn(),
  setMentionSelectorOpen: vi.fn(),
  setMentionActiveIndex: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()) as never,
  t: vi.fn((key: string, options?: { defaultValue?: string }) => options?.defaultValue || key) as never,
  localeKey: 'zh-CN',
});

const SOURCE_REF: PresentationSourceRef = {
  grantId: '11111111-1111-4111-8111-111111111111',
  expectedByteLength: 2048,
  expectedSha256: 'a'.repeat(64),
};

const SOURCE_OWNER_RESULT: GetPresentationSourceOwnerResult = {
  ok: true,
  owner: { owner_type: 'draft', draft_id: '22222222-2222-4222-8222-222222222222' },
  ownerRevision: 3,
  grants: [
    {
      grantId: SOURCE_REF.grantId,
      displayName: 'Quarterly Revenue.xlsx',
      format: 'xlsx',
      sourceKind: 'native-picker',
      byteLength: SOURCE_REF.expectedByteLength,
      sha256: SOURCE_REF.expectedSha256,
      expiresAt: '2026-08-05T10:15:00.000Z',
    },
  ],
};

const BOUND_DRAFT_RESULT: BindPresentationDraftResult = {
  ok: true,
  status: 'bound',
  draftId: '22222222-2222-4222-8222-222222222222',
  conversationId: '33333333-3333-4333-8333-333333333333',
  revision: 4,
  boundAt: '2026-08-05T10:01:00.000Z',
};

const CASEFUL_MANAGED_CONVERSATION_ID = '2be7b8fc-6af5-42b8-aed5-03644735c730';
const SERVER_ASSIGNED_CONVERSATION_ID = 'd0921953';
const GUID_HANDOFF_CLAIM_KEY = 'weprompt_presentation_handoff';
const GUID_PENDING_STORAGE_KEY = 'guid_presentation_submission_v2';

const readGuidPendingRaw = (): string | null =>
  localStorage.getItem(GUID_PENDING_STORAGE_KEY) ?? sessionStorage.getItem(GUID_PENDING_STORAGE_KEY);

const claimedConversation = (queueItemId: string, overrides: Record<string, unknown> = {}) => ({
  id: SERVER_ASSIGNED_CONVERSATION_ID,
  type: 'acp',
  extra: {
    [GUID_HANDOFF_CLAIM_KEY]: { version: 1, queue_item_id: queueItemId },
  },
  ...overrides,
});

const claimedConversationFromRequest = (
  request: { extra?: Record<string, unknown> },
  overrides: Record<string, unknown> = {}
) => {
  const claim = request.extra?.[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id?: unknown } | undefined;
  if (typeof claim?.queue_item_id !== 'string') throw new Error('missing Guid handoff claim');
  return claimedConversation(claim.queue_item_id, overrides);
};

const claimedConversationForPending = (conversationId: string, overrides: Record<string, unknown> = {}) => {
  const raw = readGuidPendingRaw();
  if (raw === null) throw new Error('missing Guid handoff snapshot');
  const attempt = JSON.parse(raw) as { queueItemId?: unknown };
  if (typeof attempt.queueItemId !== 'string') throw new Error('missing Guid queue item id');
  return claimedConversation(attempt.queueItemId, { id: conversationId, ...overrides });
};

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
};

const attachManagedPresentation = (
  deps: GuidSendDeps,
  overrides: Partial<NonNullable<GuidSendDeps['managedPresentation']>> = {}
) => {
  const prepareSourceOwner = vi.fn<(recoveryConversationId?: string) => Promise<GetPresentationSourceOwnerResult>>();
  prepareSourceOwner.mockResolvedValue(SOURCE_OWNER_RESULT);
  const bindDraft = vi.fn<(conversationId: string) => Promise<BindPresentationDraftResult | null>>();
  bindDraft.mockImplementation(async (conversationId) => ({
    ...BOUND_DRAFT_RESULT,
    conversationId,
  }));
  const onHandoffAccepted = vi.fn();
  deps.managedPresentation = {
    selectedTemplateId: 'finance-review',
    draftClientRequestId: '44444444-4444-4444-8444-444444444444',
    sourceRefs: [SOURCE_REF],
    prepareSourceOwner,
    bindDraft,
    onHandoffAccepted,
    ...overrides,
  };
  return { bindDraft, onHandoffAccepted, prepareSourceOwner };
};

describe('useGuidSend', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    createConversationInvokeMock.mockReset();
    createConversationInvokeMock.mockImplementation(async (request: { extra?: Record<string, unknown> }) =>
      request.extra?.[GUID_HANDOFF_CLAIM_KEY] ? claimedConversationFromRequest(request) : { id: 'conv-1' }
    );
    getConversationInvokeMock.mockReset().mockResolvedValue(null);
    listConversationsInvokeMock.mockReset().mockResolvedValue({ items: [], total: 0, has_more: false });
    removeConversationInvokeMock.mockReset();
    confirmQueuedSourcesInvokeMock.mockReset().mockResolvedValue({
      ok: true,
      status: 'confirmed',
      ownerRevision: 5,
      expiresAt: '2026-08-06T10:00:00.000Z',
    });
    startPresentationRunInvokeMock.mockReset().mockImplementation(async (request: { conversation_id: string }) => ({
      ok: true,
      run: {
        runId: '55555555-5555-4555-8555-555555555555',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        conversationId: request.conversation_id,
        selectedTemplateId: 'finance-review',
        revision: 8,
        createdAt: '2026-08-05T10:02:00.000Z',
        updatedAt: '2026-08-05T10:02:00.000Z',
        dispatchStatus: 'committed',
        artifactPhase: 'sources_snapshotted',
        disposition: null,
        retainedCandidate: null,
        actions: { openAllowed: false, discardAllowed: true },
      },
    }));
    getPresentationRunInvokeMock.mockReset();
    claimInitialDispatchInvokeMock.mockReset();
    renewInitialDispatchInvokeMock.mockReset();
    dispatchPresentationRunInvokeMock.mockReset();
    swrMutateMock.mockReset();
    swrMutateMock.mockResolvedValue(undefined);
    kbGetSessionMcpServerMock.mockReset();
    kbSyncFolderMock.mockReset().mockResolvedValue(undefined);
    kbGetSessionMcpServerMock.mockResolvedValue(null);
    listAvailableSkillsInvokeMock.mockReset().mockResolvedValue([]);
    getAssistantInvokeMock.mockReset().mockResolvedValue(null);
  });

  it('passes selected mode into assistant conversation overrides when creating a preset ACP conversation', async () => {
    const deps = createDeps();
    deps.selectedThoughtLevelValue = 'high';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBeUndefined();
    expect('model' in payload).toBe(false);
    expect(payload.assistant?.conversation_overrides?.permission).toBe('bypassPermissions');
    expect(payload.assistant?.conversation_overrides?.model).toBe('claude-opus');
    expect(payload.assistant?.conversation_overrides?.thought_level).toBe('high');
    expect(payload.extra.backend).toBeUndefined();
    expect(payload.extra.agent_name).toBeUndefined();
    expect(payload.extra.agent_id).toBeUndefined();
    expect(payload.extra.custom_agent_id).toBeUndefined();
    expect(payload.extra.preset_rules).toBeUndefined();
    expect(payload.extra.preset_context).toBeUndefined();
    expect(payload.extra.session_mode).toBeUndefined();
    expect(payload.extra.current_model_id).toBeUndefined();
    expect(payload.extra.preset_assistant_id).toBeUndefined();
    expect(swrMutateMock).toHaveBeenCalledWith('guid.assistant.detail.assistant-1.zh-CN');
    expect(swrMutateMock).toHaveBeenCalledWith('assistants.list');
  });

  it('falls back to assistant default skill and MCP ids for preset conversations before local Guid overrides exist', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = undefined;
    deps.guidDisabledBuiltinSkills = undefined;
    deps.assistantDefaultSkillIds = ['assistant-skill'];
    deps.assistantDefaultDisabledBuiltinSkillIds = ['builtin-skill'];
    deps.selectedMcpServerIds = undefined;
    deps.assistantDefaultMcpIds = ['mcp-user'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['assistant-skill']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['builtin-skill']);
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
  });

  it('preserves builtin MCP ids in assistant overrides while only sending user MCP ids to runtime selection', async () => {
    const deps = createDeps();
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-mcp', name: 'Builtin MCP', enabled: true, builtin: true } as IMcpServer,
    ];
    deps.selectedMcpServerIds = ['mcp-user', 'builtin-mcp'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-mcp']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_session_mcp_servers).toEqual([expect.objectContaining({ id: 'builtin-mcp' })]);
  });

  it('does not write legacy preset_assistant_id for preset assistant sends', async () => {
    const deps = createDeps();

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.extra.preset_assistant_id).toBeUndefined();
  });

  it('forwards local skill overrides through assistant conversation overrides for ACP assistants', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = ['pdf-reader'];
    deps.guidDisabledBuiltinSkills = ['todo-tracker'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['pdf-reader']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['todo-tracker']);
  });

  it('forwards local skill overrides for generated Aion CLI assistants through assistant conversation overrides', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gemini-2.5-pro', use_model: 'gemini-2.5-pro' } as never;
    deps.guidEnabledSkills = ['pdf-reader'];
    deps.guidDisabledBuiltinSkills = ['todo-tracker'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBeUndefined();
    expect(payload.model).toBe(deps.current_model);
    expect(payload.assistant?.id).toBe('bare:aionrs');
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['pdf-reader']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['todo-tracker']);
    expect(payload.extra.session_mode).toBeUndefined();
  });

  it('does not write legacy preset_assistant_id for generated Aion CLI assistant conversations', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gemini-2.5-pro', use_model: 'gemini-2.5-pro' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('bare:aionrs');
    expect(payload.extra.preset_assistant_id).toBeUndefined();
  });

  it('does not write legacy preset_assistant_id for generated ACP assistant conversations', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:claude';
    deps.selectedAssistantBackend = 'claude';
    deps.current_model = { provider_id: 'anthropic', model: 'claude-sonnet', use_model: 'claude-sonnet' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('bare:claude');
    expect(payload.type).toBeUndefined();
    expect('model' in payload).toBe(false);
    expect(payload.extra.preset_assistant_id).toBeUndefined();
    expect(payload.extra.backend).toBeUndefined();
  });

  it('keeps all six enabled auto-attach servers on ordinary conversations', async () => {
    const deps = createDeps();
    deps.selectedMcpServerIds = undefined;
    deps.assistantDefaultMcpIds = [];
    deps.availableMcpServers = [
      { id: 'builtin-image-gen', name: 'aionui-image-generation', enabled: true, builtin: true } as IMcpServer,
      { id: 'builtin-idp', name: 'greennode-idp', enabled: true, builtin: true } as IMcpServer,
      { id: 'builtin-vision', name: 'aionui-image-analysis', enabled: true, builtin: true } as IMcpServer,
      { id: 'builtin-chrome-devtools', name: 'chrome-devtools', enabled: true, builtin: true } as IMcpServer,
      { id: 'builtin-memory', name: 'aionui-memory', enabled: true, builtin: true } as IMcpServer,
      { id: 'builtin-tavily', name: 'aionui-web-search', enabled: true, builtin: true } as IMcpServer,
    ];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    const expectedIds = [
      'builtin-image-gen',
      'builtin-idp',
      'builtin-vision',
      'builtin-chrome-devtools',
      'builtin-memory',
      'builtin-tavily',
    ];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(expectedIds);
    expect(payload.extra.selected_session_mcp_servers?.map((server: IMcpServer) => server.id)).toEqual(expectedIds);
  });

  it('force-attaches an enabled image-gen builtin server on the explicit MCP selection path', async () => {
    const deps = createDeps();
    deps.selectedMcpServerIds = ['mcp-user'];
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-image-gen', name: 'aionui-image-generation', enabled: true, builtin: true } as IMcpServer,
    ];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-image-gen']);
  });

  it('force-attaches an enabled IDP builtin server on the explicit MCP selection path', async () => {
    const deps = createDeps();
    deps.selectedMcpServerIds = ['mcp-user'];
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-idp', name: 'greennode-idp', enabled: true, builtin: true } as IMcpServer,
    ];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-idp']);
  });

  it('force-attaches an enabled IDP builtin server into the session MCP server list for Aion CLI conversations on the explicit selection path', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gpt-5', use_model: 'gpt-5' } as never;
    deps.selectedMcpServerIds = ['mcp-user'];
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-idp', name: 'greennode-idp', enabled: true, builtin: true } as IMcpServer,
    ];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-idp']);
    expect(payload.extra.selected_session_mcp_servers).toEqual([
      expect.objectContaining({ id: 'mcp-user' }),
      expect.objectContaining({ id: 'builtin-idp' }),
    ]);
  });

  it('does not force-attach a disabled IDP builtin server on the explicit MCP selection path', async () => {
    const deps = createDeps();
    deps.selectedMcpServerIds = ['mcp-user'];
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-idp', name: 'greennode-idp', enabled: false, builtin: true } as IMcpServer,
    ];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_session_mcp_servers).toEqual([]);
  });

  it('force-attaches both enabled image-gen and IDP builtin servers together on the explicit selection path', async () => {
    const deps = createDeps();
    deps.selectedMcpServerIds = ['mcp-user'];
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-image-gen', name: 'aionui-image-generation', enabled: true, builtin: true } as IMcpServer,
      { id: 'builtin-idp', name: 'greennode-idp', enabled: true, builtin: true } as IMcpServer,
    ];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual([
      'mcp-user',
      'builtin-image-gen',
      'builtin-idp',
    ]);
  });

  it('passes Project id and workspace into ACP conversation creation', async () => {
    const deps = createDeps();
    deps.projectId = 'project-1';
    deps.dir = '/Users/me/Finance Close';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.extra.project_id).toBe('project-1');
    expect(payload.extra.workspace).toBe('/Users/me/Finance Close');
    expect(payload.extra.custom_workspace).toBe(true);
  });

  it('passes Project id and workspace into Aion CLI conversation creation', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gpt-5', use_model: 'gpt-5' } as never;
    deps.projectId = 'project-1';
    deps.dir = '/Users/me/Finance Close';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.extra.project_id).toBe('project-1');
    expect(payload.extra.workspace).toBe('/Users/me/Finance Close');
    expect(payload.extra.custom_workspace).toBe(true);
  });

  it('does not create a conversation without assistant identity', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = null;
    deps.selectedAssistantBackend = 'claude';

    const { result } = renderHook(() => useGuidSend(deps));

    expect(result.current.isButtonDisabled).toBe(true);

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).not.toHaveBeenCalled();
  });

  it('requests managed source re-selection before entering the loading state', () => {
    const deps = createDeps();
    const onPresentationSourceReselectRequired = vi.fn();
    deps.files = ['/legacy/revenue.xlsx'];
    deps.requiresPresentationSourceReselect = true;
    deps.onPresentationSourceReselectRequired = onPresentationSourceReselectRequired;

    const { result } = renderHook(() => useGuidSend(deps));
    act(() => result.current.sendMessageHandler());

    expect(onPresentationSourceReselectRequired).toHaveBeenCalledTimes(1);
    expect(deps.setLoading).not.toHaveBeenCalled();
    expect(createConversationInvokeMock).not.toHaveBeenCalled();
  });

  it('preserves the prompt, files, and selected template when managed source re-selection is required', async () => {
    const deps = createDeps();
    const onPresentationSourceReselectRequired = vi.fn();
    deps.files = ['/legacy/revenue.xlsx'];
    deps.requiresPresentationSourceReselect = true;
    deps.onPresentationSourceReselectRequired = onPresentationSourceReselectRequired;
    deps.onPresentationTemplateConsumed = vi.fn();

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      result.current.sendMessageHandler();
      await Promise.resolve();
    });

    expect(onPresentationSourceReselectRequired).toHaveBeenCalledTimes(1);
    expect(
      [deps.setInput, deps.setFiles, deps.onPresentationTemplateConsumed].map((spy) => spy.mock.calls.length)
    ).toEqual([0, 0, 0]);
  });

  it('keeps the exact legacy template send path while the v2 feature flag is false', async () => {
    const deps = createDeps();
    const composed = {
      input: '<presentation-template>legacy</presentation-template>\nhello',
      files: ['/legacy/template/THEME.md', '/legacy/template/reference.pptx', '/legacy/revenue.xlsx'],
      injectSkills: ['slides'],
    };
    deps.files = ['/legacy/revenue.xlsx'];
    deps.composePresentationSend = vi.fn(() => composed);
    deps.onPresentationTemplateConsumed = vi.fn();

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => result.current.sendMessageHandler());
    await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));

    expect(PRESENTATION_RUN_V2_ENABLED).toBe(false);
    expect(deps.composePresentationSend).toHaveBeenCalledWith('hello', ['/legacy/revenue.xlsx']);
    expect(createConversationInvokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ extra: expect.objectContaining({ default_files: composed.files }) })
    );
    expect(JSON.parse(sessionStorage.getItem('acp_initial_message_conv-1')!)).toEqual({
      input: composed.input,
      files: composed.files,
    });
    expect(readGuidPendingRaw()).toBeNull();
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))).not.toContainEqual(
      expect.stringMatching(/^presentation-command-queue\/v2\//)
    );
    expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
    expect(deps.onPresentationTemplateConsumed).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith('/conversation/conv-1');
  });

  describe('managed Guid presentation handoff', () => {
    const readManagedQueue = (): Record<string, unknown> => {
      const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((candidate) =>
        candidate?.startsWith('presentation-command-queue/v2/')
      );
      expect(key).toBeDefined();
      return JSON.parse(localStorage.getItem(key!)!) as Record<string, unknown>;
    };

    it('resolves a server-assigned short id from an exact durable claim before binding or queueing', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      createConversationInvokeMock.mockImplementation(
        async (request: { id?: string; extra: Record<string, unknown> }) => {
          expect(request).not.toHaveProperty('id');
          const claim = request.extra[GUID_HANDOFF_CLAIM_KEY] as { version: number; queue_item_id: string };
          expect(claim).toEqual({ version: 1, queue_item_id: expect.any(String) });
          const pending = JSON.parse(readGuidPendingRaw()!) as Record<string, unknown>;
          expect(pending).toMatchObject({
            version: 3,
            claimMode: 'marker_v1',
            createPhase: 'uncertain',
            conversationId: null,
            queueItemId: claim.queue_item_id,
          });
          return claimedConversation(claim.queue_item_id, { id: SERVER_ASSIGNED_CONVERSATION_ID.toUpperCase() });
        }
      );
      managed.bindDraft.mockImplementation(async (conversationId) => {
        expect(JSON.parse(readGuidPendingRaw()!)).toMatchObject({
          version: 3,
          claimMode: 'marker_v1',
          createPhase: 'resolved',
          conversationId: SERVER_ASSIGNED_CONVERSATION_ID,
        });
        return { ...BOUND_DRAFT_RESULT, conversationId };
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(managed.bindDraft).toHaveBeenCalledWith(SERVER_ASSIGNED_CONVERSATION_ID);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: SERVER_ASSIGNED_CONVERSATION_ID })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${SERVER_ASSIGNED_CONVERSATION_ID}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('recovers a lost create reply by one exact catalogue claimant without posting twice', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      let queueItemId = '';
      listConversationsInvokeMock
        .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
        .mockImplementationOnce(async () => ({
          items: [claimedConversation(queueItemId)],
          total: 1,
          has_more: false,
        }));
      createConversationInvokeMock.mockImplementation(async (request: { extra: Record<string, unknown> }) => {
        queueItemId = (request.extra[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id: string }).queue_item_id;
        throw new Error('create reply lost');
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(listConversationsInvokeMock).toHaveBeenCalledTimes(2);
      expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
      expect(managed.bindDraft).toHaveBeenCalledWith(SERVER_ASSIGNED_CONVERSATION_ID);
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${SERVER_ASSIGNED_CONVERSATION_ID}`);
    });

    it('recovers an uncertain claimant across a real hook unmount without a second POST', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      const createReply = deferred<ReturnType<typeof claimedConversation>>();
      let queueItemId = '';
      listConversationsInvokeMock.mockImplementation(async () =>
        queueItemId === ''
          ? { items: [], total: 0, has_more: false }
          : { items: [claimedConversation(queueItemId)], total: 1, has_more: false }
      );
      createConversationInvokeMock.mockImplementation((request: { extra: Record<string, unknown> }) => {
        queueItemId = (request.extra[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id: string }).queue_item_id;
        return createReply.promise;
      });
      const first = renderHook(() => useGuidSend(deps));
      let firstSend!: Promise<void>;
      act(() => {
        firstSend = first.result.current.handleSend().catch(() => undefined);
      });
      await waitFor(() => expect(createConversationInvokeMock).toHaveBeenCalledOnce());
      expect(readGuidPendingRaw()).toContain('"createPhase":"uncertain"');
      first.unmount();

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${SERVER_ASSIGNED_CONVERSATION_ID}`);

      createReply.resolve(claimedConversation(queueItemId));
      await act(async () => firstSend);
    });

    it('recovers an uncertain claimant after session state is lost but durable app state remains', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      const firstCreateReply = deferred<ReturnType<typeof claimedConversation>>();
      let firstQueueItemId = '';
      listConversationsInvokeMock.mockImplementation(async () =>
        firstQueueItemId === ''
          ? { items: [], total: 0, has_more: false }
          : { items: [claimedConversation(firstQueueItemId)], total: 1, has_more: false }
      );
      createConversationInvokeMock.mockImplementation((request: { extra: Record<string, unknown> }) => {
        const queueItemId = (request.extra[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id: string }).queue_item_id;
        if (firstQueueItemId === '') {
          firstQueueItemId = queueItemId;
          return firstCreateReply.promise;
        }
        return Promise.resolve(claimedConversation(queueItemId));
      });
      const first = renderHook(() => useGuidSend(deps));
      let firstSend!: Promise<void>;
      act(() => {
        firstSend = first.result.current.handleSend().catch(() => undefined);
      });
      await waitFor(() => expect(createConversationInvokeMock).toHaveBeenCalledOnce());
      const durableBeforeRestart = localStorage.getItem(GUID_PENDING_STORAGE_KEY);
      sessionStorage.clear();
      first.unmount();

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());
      firstCreateReply.resolve(claimedConversation(firstQueueItemId));
      await act(async () => firstSend);

      expect(durableBeforeRestart).toContain('"createPhase":"uncertain"');
      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${SERVER_ASSIGNED_CONVERSATION_ID}`);
    });

    it('fails closed when durable and legacy pending stores contain different attempts', async () => {
      const durable = {
        version: 3,
        claimMode: 'marker_v1',
        createPhase: 'uncertain',
        conversationId: null,
        queueItemId: '77777777-7777-4777-8777-777777777777',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        draftClientRequestId: '44444444-4444-4444-8444-444444444444',
        input: 'hello',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      };
      localStorage.setItem(GUID_PENDING_STORAGE_KEY, JSON.stringify(durable));
      sessionStorage.setItem(
        GUID_PENDING_STORAGE_KEY,
        JSON.stringify({
          version: 2,
          conversationId: '33333333-3333-4333-8333-333333333333',
          queueItemId: '88888888-8888-4888-8888-888888888888',
          clientRequestId: durable.clientRequestId,
          draftClientRequestId: durable.draftClientRequestId,
          input: durable.input,
          selectedTemplateId: durable.selectedTemplateId,
          sources: durable.sources,
          runtime: durable.runtime,
          capturedAt: durable.capturedAt,
        })
      );
      const deps = createDeps();
      attachManagedPresentation(deps);

      expect(readGuidManagedPresentationRecovery()).toBeNull();
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(JSON.stringify(durable));
      expect(sessionStorage.getItem(GUID_PENDING_STORAGE_KEY)).not.toBeNull();
    });

    it('byte-migrates an exact session-v3 snapshot into durable storage', () => {
      const raw = JSON.stringify({
        version: 3,
        claimMode: 'marker_v1',
        createPhase: 'uncertain',
        conversationId: null,
        queueItemId: '77777777-7777-4777-8777-777777777777',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        draftClientRequestId: '44444444-4444-4444-8444-444444444444',
        input: 'hello',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      });
      sessionStorage.setItem(GUID_PENDING_STORAGE_KEY, raw);

      expect(readGuidManagedPresentationRecovery()).toMatchObject({ input: 'hello', runtime: 'acp' });
      expect(localStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(raw);
      expect(sessionStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBeNull();
    });

    it('cleans an equal-byte dual-v3 crash residue without changing durable authority', () => {
      const raw = JSON.stringify({
        version: 3,
        claimMode: 'marker_v1',
        createPhase: 'uncertain',
        conversationId: null,
        queueItemId: '77777777-7777-4777-8777-777777777777',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        draftClientRequestId: '44444444-4444-4444-8444-444444444444',
        input: 'hello',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      });
      localStorage.setItem(GUID_PENDING_STORAGE_KEY, raw);
      sessionStorage.setItem(GUID_PENDING_STORAGE_KEY, raw);

      expect(readGuidManagedPresentationRecovery()).toMatchObject({ input: 'hello', runtime: 'acp' });
      expect(localStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(raw);
      expect(sessionStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBeNull();
    });

    it('blocks POST when session-v3 cleanup is not read back and remains recoverable', async () => {
      const raw = JSON.stringify({
        version: 3,
        claimMode: 'marker_v1',
        createPhase: 'uncertain',
        conversationId: null,
        queueItemId: '77777777-7777-4777-8777-777777777777',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        draftClientRequestId: '44444444-4444-4444-8444-444444444444',
        input: 'hello',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      });
      sessionStorage.setItem(GUID_PENDING_STORAGE_KEY, raw);
      const originalRemoveItem = Storage.prototype.removeItem;
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
        if (this === sessionStorage && key === GUID_PENDING_STORAGE_KEY) return;
        return originalRemoveItem.call(this, key);
      });
      const deps = createDeps();
      attachManagedPresentation(deps);
      try {
        expect(readGuidManagedPresentationRecovery()).toBeNull();
        const { result } = renderHook(() => useGuidSend(deps));
        await act(async () => {
          await result.current.handleSend().catch(() => undefined);
        });
        expect(createConversationInvokeMock).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(raw);
        expect(sessionStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(raw);
      } finally {
        removeItem.mockRestore();
      }

      expect(readGuidManagedPresentationRecovery()).toMatchObject({ input: 'hello' });
      expect(sessionStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBeNull();
    });

    it('cleans only the deterministic legacy-v2 to exact-get-v3 crash residue before exact authority proof', async () => {
      const legacy = {
        version: 2,
        conversationId: '33333333-3333-4333-8333-333333333333',
        queueItemId: '77777777-7777-4777-8777-777777777777',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        draftClientRequestId: '44444444-4444-4444-8444-444444444444',
        input: 'hello',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      };
      const upgraded = {
        version: 3,
        claimMode: 'exact_get',
        createPhase: 'resolved',
        conversationId: legacy.conversationId,
        queueItemId: legacy.queueItemId,
        clientRequestId: legacy.clientRequestId,
        draftClientRequestId: legacy.draftClientRequestId,
        input: legacy.input,
        selectedTemplateId: legacy.selectedTemplateId,
        sources: legacy.sources,
        runtime: legacy.runtime,
        capturedAt: legacy.capturedAt,
      };
      const durableRaw = JSON.stringify(upgraded);
      localStorage.setItem(GUID_PENDING_STORAGE_KEY, durableRaw);
      sessionStorage.setItem(GUID_PENDING_STORAGE_KEY, JSON.stringify(legacy));

      expect(readGuidManagedPresentationRecovery()).toMatchObject({ conversationId: legacy.conversationId });
      expect(localStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(durableRaw);
      expect(sessionStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBeNull();
      getConversationInvokeMock.mockResolvedValue({ id: legacy.conversationId, type: 'acp', extra: {} });
      const deps = createDeps();
      attachManagedPresentation(deps, { conversationId: legacy.conversationId });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(getConversationInvokeMock).toHaveBeenCalledWith({ id: legacy.conversationId });
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
    });

    it('rejects a noncanonical legacy-v2 dual-store residue without changing either store', async () => {
      const legacyRaw = JSON.stringify({
        version: 2,
        conversationId: 'A3333333-B333-4333-8333-C33333333333',
        queueItemId: '77777777-7777-4777-8777-777777777777',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        draftClientRequestId: '44444444-4444-4444-8444-444444444444',
        input: 'hello',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      });
      const durableRaw = JSON.stringify({
        version: 3,
        claimMode: 'exact_get',
        createPhase: 'resolved',
        conversationId: 'a3333333-b333-4333-8333-c33333333333',
        queueItemId: '77777777-7777-4777-8777-777777777777',
        clientRequestId: '66666666-6666-4666-8666-666666666666',
        draftClientRequestId: '44444444-4444-4444-8444-444444444444',
        input: 'hello',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      });
      localStorage.setItem(GUID_PENDING_STORAGE_KEY, durableRaw);
      sessionStorage.setItem(GUID_PENDING_STORAGE_KEY, legacyRaw);
      const deps = createDeps();
      attachManagedPresentation(deps, {
        conversationId: 'a3333333-b333-4333-8333-c33333333333',
      });

      expect(readGuidManagedPresentationRecovery()).toBeNull();
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(durableRaw);
      expect(sessionStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBe(legacyRaw);
    });

    it('fails closed when durable pending storage is corrupt or unavailable', async () => {
      localStorage.setItem(GUID_PENDING_STORAGE_KEY, '{corrupt');
      const deps = createDeps();
      attachManagedPresentation(deps);
      expect(readGuidManagedPresentationRecovery()).toBeNull();
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      expect(createConversationInvokeMock).not.toHaveBeenCalled();

      localStorage.removeItem(GUID_PENDING_STORAGE_KEY);
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
        if (this === localStorage && key === GUID_PENDING_STORAGE_KEY)
          throw new DOMException('blocked', 'SecurityError');
        return null;
      });
      try {
        expect(readGuidManagedPresentationRecovery()).toBeNull();
        const second = renderHook(() => useGuidSend(deps));
        await act(async () => {
          await second.result.current.handleSend().catch(() => undefined);
        });
        expect(createConversationInvokeMock).not.toHaveBeenCalled();
      } finally {
        getItem.mockRestore();
      }
    });

    it('fails before POST when a fresh durable snapshot cannot be read back', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      const originalSetItem = Storage.prototype.setItem;
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (this === localStorage && key === GUID_PENDING_STORAGE_KEY) return;
        return originalSetItem.call(this, key, value);
      });
      try {
        const { result } = renderHook(() => useGuidSend(deps));
        await act(async () => {
          await result.current.handleSend().catch(() => undefined);
        });

        expect(createConversationInvokeMock).not.toHaveBeenCalled();
        expect(localStorage.getItem(GUID_PENDING_STORAGE_KEY)).toBeNull();
      } finally {
        setItem.mockRestore();
      }
    });

    it('allows only one concurrent sender to win the not_started to uncertain CAS and POST', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      const catalogue = deferred<{ items: []; total: 0; has_more: false }>();
      listConversationsInvokeMock.mockReturnValue(catalogue.promise);
      createConversationInvokeMock.mockImplementation(async (request: { extra: Record<string, unknown> }) => {
        const queueItemId = (request.extra[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id: string }).queue_item_id;
        return claimedConversation(queueItemId);
      });
      const first = renderHook(() => useGuidSend(deps));
      const second = renderHook(() => useGuidSend(deps));
      let firstSend!: Promise<void>;
      let secondSend!: Promise<void>;
      act(() => {
        firstSend = first.result.current.handleSend();
        secondSend = second.result.current.handleSend();
      });
      await waitFor(() => expect(listConversationsInvokeMock).toHaveBeenCalledTimes(2));

      catalogue.resolve({ items: [], total: 0, has_more: false });
      let outcomes!: PromiseSettledResult<void>[];
      await act(async () => {
        outcomes = await Promise.allSettled([firstSend, secondSend]);
      });

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(deps.navigate).toHaveBeenCalledOnce();
    });

    it('fails before POST when the uncertain phase write cannot be read back', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      const originalSetItem = Storage.prototype.setItem;
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === 'guid_presentation_submission_v2' && value.includes('"createPhase":"uncertain"')) return;
        return originalSetItem.call(this, key, value);
      });

      try {
        const { result } = renderHook(() => useGuidSend(deps));
        await act(async () => {
          await result.current.handleSend().catch(() => undefined);
        });

        expect(listConversationsInvokeMock).toHaveBeenCalledOnce();
        expect(createConversationInvokeMock).not.toHaveBeenCalled();
        expect(readGuidPendingRaw()).toContain('"createPhase":"not_started"');
      } finally {
        setItem.mockRestore();
      }
    });

    it('never posts again when an uncertain create has no complete-catalogue claimant', async () => {
      const queueItemId = '77777777-7777-4777-8777-777777777777';
      sessionStorage.setItem(
        'guid_presentation_submission_v2',
        JSON.stringify({
          version: 3,
          claimMode: 'marker_v1',
          createPhase: 'uncertain',
          conversationId: null,
          queueItemId,
          clientRequestId: '66666666-6666-4666-8666-666666666666',
          draftClientRequestId: '44444444-4444-4444-8444-444444444444',
          input: 'hello',
          selectedTemplateId: 'finance-review',
          sources: [SOURCE_REF],
          runtime: 'acp',
          capturedAt: '2026-08-05T10:00:00.000Z',
        })
      );
      const deps = createDeps();
      attachManagedPresentation(deps);

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(listConversationsInvokeMock).toHaveBeenCalledOnce();
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(readGuidPendingRaw()).toContain('"createPhase":"uncertain"');
    });

    it.each([
      {
        label: 'an incomplete catalogue',
        catalogue: { items: [], total: 1, has_more: true },
      },
      {
        label: 'an oversized catalogue response',
        catalogue: { items: [], total: 10_001, has_more: false },
      },
      {
        label: 'duplicate claimants',
        catalogue: {
          items: [
            claimedConversation('77777777-7777-4777-8777-777777777777'),
            claimedConversation('77777777-7777-4777-8777-777777777777', { id: 'd0921954' }),
          ],
          total: 2,
          has_more: false,
        },
      },
    ])('fails closed for $label while resolving an uncertain create', async ({ catalogue }) => {
      sessionStorage.setItem(
        'guid_presentation_submission_v2',
        JSON.stringify({
          version: 3,
          claimMode: 'marker_v1',
          createPhase: 'uncertain',
          conversationId: null,
          queueItemId: '77777777-7777-4777-8777-777777777777',
          clientRequestId: '66666666-6666-4666-8666-666666666666',
          draftClientRequestId: '44444444-4444-4444-8444-444444444444',
          input: 'hello',
          selectedTemplateId: 'finance-review',
          sources: [SOURCE_REF],
          runtime: 'acp',
          capturedAt: '2026-08-05T10:00:00.000Z',
        })
      );
      listConversationsInvokeMock.mockResolvedValue(catalogue);
      const deps = createDeps();
      attachManagedPresentation(deps);

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(listConversationsInvokeMock).toHaveBeenCalledOnce();
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
    });

    it.each(['unsafe-id', 'wrong-runtime', 'wrong-claim'] as const)(
      'rejects a create DTO with %s before resolving or binding',
      async (fault) => {
        const deps = createDeps();
        const managed = attachManagedPresentation(deps);
        createConversationInvokeMock.mockImplementation(async (request: { extra: Record<string, unknown> }) => {
          const queueItemId = (request.extra[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id: string }).queue_item_id;
          if (fault === 'unsafe-id') return claimedConversation(queueItemId, { id: '../unsafe' });
          if (fault === 'wrong-runtime') return claimedConversation(queueItemId, { type: 'aionrs' });
          return claimedConversation(queueItemId, {
            extra: {
              [GUID_HANDOFF_CLAIM_KEY]: {
                version: 1,
                queue_item_id: '88888888-8888-4888-8888-888888888888',
              },
            },
          });
        });

        const { result } = renderHook(() => useGuidSend(deps));
        await act(async () => {
          await result.current.handleSend().catch(() => undefined);
        });

        expect(createConversationInvokeMock).toHaveBeenCalledOnce();
        expect(managed.bindDraft).not.toHaveBeenCalled();
        expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
        expect(deps.navigate).not.toHaveBeenCalled();
        expect(readGuidPendingRaw()).toContain('"createPhase":"uncertain"');
      }
    );

    it('does not guess or create for a markerless legacy attempt whose exact conversation id is missing', async () => {
      const conversationId = '33333333-3333-4333-8333-333333333333';
      sessionStorage.setItem(
        'guid_presentation_submission_v2',
        JSON.stringify({
          version: 2,
          conversationId,
          queueItemId: '77777777-7777-4777-8777-777777777777',
          clientRequestId: '66666666-6666-4666-8666-666666666666',
          draftClientRequestId: '44444444-4444-4444-8444-444444444444',
          input: 'hello',
          selectedTemplateId: 'finance-review',
          sources: [SOURCE_REF],
          runtime: 'acp',
          capturedAt: '2026-08-05T10:00:00.000Z',
        })
      );
      const deps = createDeps();
      attachManagedPresentation(deps, { conversationId });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(getConversationInvokeMock).toHaveBeenCalledWith({ id: conversationId });
      expect(listConversationsInvokeMock).not.toHaveBeenCalled();
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
    });

    it('rejects a legacy v2 exact-id conversation that already carries any claimant field', async () => {
      const conversationId = '33333333-3333-4333-8333-333333333333';
      const queueItemId = '77777777-7777-4777-8777-777777777777';
      sessionStorage.setItem(
        'guid_presentation_submission_v2',
        JSON.stringify({
          version: 2,
          conversationId,
          queueItemId,
          clientRequestId: '66666666-6666-4666-8666-666666666666',
          draftClientRequestId: '44444444-4444-4444-8444-444444444444',
          input: 'hello',
          selectedTemplateId: 'finance-review',
          sources: [SOURCE_REF],
          runtime: 'acp',
          capturedAt: '2026-08-05T10:00:00.000Z',
        })
      );
      getConversationInvokeMock.mockResolvedValue(claimedConversation(queueItemId, { id: conversationId }));
      const deps = createDeps();
      attachManagedPresentation(deps, { conversationId });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(JSON.parse(readGuidPendingRaw()!)).toMatchObject({ version: 2 });
    });

    it('rejects an exact-get v3 conversation that carries any claimant field', async () => {
      const conversationId = SERVER_ASSIGNED_CONVERSATION_ID;
      const deps = createDeps();
      attachManagedPresentation(deps, { conversationId });
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation('77777777-7777-4777-8777-777777777777', { id: conversationId })
      );

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(JSON.parse(readGuidPendingRaw()!)).toMatchObject({
        version: 3,
        claimMode: 'exact_get',
        createPhase: 'resolved',
        conversationId,
      });
    });

    it('rejects a resolved v3 restart whose persisted conversation claimant no longer matches', async () => {
      const conversationId = SERVER_ASSIGNED_CONVERSATION_ID;
      sessionStorage.setItem(
        'guid_presentation_submission_v2',
        JSON.stringify({
          version: 3,
          claimMode: 'marker_v1',
          createPhase: 'resolved',
          conversationId,
          queueItemId: '77777777-7777-4777-8777-777777777777',
          clientRequestId: '66666666-6666-4666-8666-666666666666',
          draftClientRequestId: '44444444-4444-4444-8444-444444444444',
          input: 'hello',
          selectedTemplateId: 'finance-review',
          sources: [SOURCE_REF],
          runtime: 'acp',
          capturedAt: '2026-08-05T10:00:00.000Z',
        })
      );
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation('88888888-8888-4888-8888-888888888888', { id: conversationId })
      );
      const deps = createDeps();
      attachManagedPresentation(deps, { conversationId });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
    });

    it('verifies a marker-v1 conversation before accepting a preexisting committed queue item', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      const navigate = vi.fn().mockRejectedValueOnce(new Error('navigation reply lost')).mockResolvedValue(undefined);
      deps.navigate = navigate as never;
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => first.result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      const pending = JSON.parse(readGuidPendingRaw()!) as {
        conversationId: string;
        queueItemId: string;
      };
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [{ queueItemId: pending.queueItemId, execution: { state: 'committed' } }],
      });
      first.unmount();
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation('88888888-8888-4888-8888-888888888888', { id: pending.conversationId })
      );

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await second.result.current.handleSend().catch(() => undefined);
      });

      expect(getConversationInvokeMock).toHaveBeenCalledWith({ id: pending.conversationId });
      expect(getPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(navigate).toHaveBeenCalledOnce();
      expect(readGuidPendingRaw()).toContain(pending.queueItemId);
    });

    it('migrates an uppercase legacy pending conversation id and matches canonical recovery identity', async () => {
      const conversationId = '33333333-3333-4333-8333-333333333333';
      const legacyConversationId = conversationId.toUpperCase();
      const queueItemId = '77777777-7777-4777-8777-777777777777';
      const clientRequestId = '66666666-6666-4666-8666-666666666666';
      sessionStorage.setItem(
        'guid_presentation_submission_v2',
        JSON.stringify({
          version: 2,
          conversationId: legacyConversationId,
          queueItemId,
          clientRequestId,
          draftClientRequestId: '44444444-4444-4444-8444-444444444444',
          input: 'hello',
          selectedTemplateId: 'finance-review',
          sources: [SOURCE_REF],
          runtime: 'acp',
          capturedAt: '2026-08-05T10:00:00.000Z',
        })
      );
      const deps = createDeps();
      const managed = attachManagedPresentation(deps, { conversationId: legacyConversationId });
      getConversationInvokeMock.mockResolvedValue({ id: conversationId, type: 'acp' });

      expect(readGuidManagedPresentationRecovery()).toMatchObject({ conversationId });
      expect(JSON.parse(readGuidPendingRaw()!)).toMatchObject({
        conversationId,
        queueItemId,
        clientRequestId,
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(managed.prepareSourceOwner).toHaveBeenCalledWith(conversationId);
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: conversationId, client_request_id: clientRequestId })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${conversationId}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('keeps exact-get provenance across a legacy-v2 navigation crash and remount', async () => {
      const conversationId = '33333333-3333-4333-8333-333333333333';
      const legacyConversationId = conversationId.toUpperCase();
      const queueItemId = '77777777-7777-4777-8777-777777777777';
      const clientRequestId = '66666666-6666-4666-8666-666666666666';
      sessionStorage.setItem(
        'guid_presentation_submission_v2',
        JSON.stringify({
          version: 2,
          conversationId: legacyConversationId,
          queueItemId,
          clientRequestId,
          draftClientRequestId: '44444444-4444-4444-8444-444444444444',
          input: 'hello',
          selectedTemplateId: 'finance-review',
          sources: [SOURCE_REF],
          runtime: 'acp',
          capturedAt: '2026-08-05T10:00:00.000Z',
        })
      );
      const deps = createDeps();
      attachManagedPresentation(deps, { conversationId: legacyConversationId });
      getConversationInvokeMock.mockResolvedValue({ id: legacyConversationId, type: 'acp', extra: {} });
      const navigate = vi.fn().mockRejectedValueOnce(new Error('navigation reply lost')).mockResolvedValue(undefined);
      deps.navigate = navigate as never;
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      const committed = (
        readManagedQueue() as {
          items: Array<{
            clientRequestId: string;
            selectedTemplateId: string;
            execution: { state: 'committed'; runId: string; revision: number };
          }>;
        }
      ).items[0];
      expect(JSON.parse(readGuidPendingRaw()!)).toMatchObject({
        version: 3,
        claimMode: 'exact_get',
        createPhase: 'resolved',
        conversationId,
        queueItemId,
      });
      first.unmount();
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: true,
        run: {
          runId: committed.execution.runId,
          clientRequestId: committed.clientRequestId,
          conversationId: legacyConversationId,
          selectedTemplateId: committed.selectedTemplateId,
          revision: committed.execution.revision,
          createdAt: '2026-08-05T10:02:00.000Z',
          updatedAt: '2026-08-05T10:02:00.000Z',
          dispatchStatus: 'committed',
          artifactPhase: 'sources_snapshotted',
          disposition: null,
          retainedCandidate: null,
          actions: { openAllowed: false, discardAllowed: true },
        },
      });

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(getConversationInvokeMock).toHaveBeenCalledTimes(3);
      expect(getPresentationRunInvokeMock).toHaveBeenCalledWith({
        conversation_id: conversationId,
        client_request_id: clientRequestId,
      });
      expect(navigate).toHaveBeenCalledTimes(2);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('preserves and recovers the exact durable claimant when post-navigation clear is not read back', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      const originalRemoveItem = Storage.prototype.removeItem;
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
        if (this === localStorage && key === GUID_PENDING_STORAGE_KEY) return;
        return originalRemoveItem.call(this, key);
      });
      const first = renderHook(() => useGuidSend(deps));
      try {
        await act(async () => {
          await first.result.current.handleSend().catch(() => undefined);
        });
      } finally {
        removeItem.mockRestore();
      }
      const pendingRaw = readGuidPendingRaw();
      const pending = JSON.parse(pendingRaw!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      const committed = (
        readManagedQueue() as {
          items: Array<{
            clientRequestId: string;
            selectedTemplateId: string;
            execution: { state: 'committed'; runId: string; revision: number };
          }>;
        }
      ).items[0];
      expect(deps.navigate).toHaveBeenCalledOnce();
      expect(readGuidPendingRaw()).toBe(pendingRaw);
      first.unmount();
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: true,
        run: {
          runId: committed.execution.runId,
          clientRequestId: committed.clientRequestId,
          conversationId: pending.conversationId,
          selectedTemplateId: committed.selectedTemplateId,
          revision: committed.execution.revision,
          createdAt: '2026-08-05T10:02:00.000Z',
          updatedAt: '2026-08-05T10:02:00.000Z',
          dispatchStatus: 'committed',
          artifactPhase: 'sources_snapshotted',
          disposition: null,
          retainedCandidate: null,
          actions: { openAllowed: false, discardAllowed: true },
        },
      });

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(getPresentationRunInvokeMock).toHaveBeenCalledWith({
        conversation_id: pending.conversationId,
        client_request_id: pending.clientRequestId,
      });
      expect(deps.navigate).toHaveBeenCalledTimes(2);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('canonicalizes uppercase conversation and bind DTO identities before managed handoff', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps, { conversationId: CASEFUL_MANAGED_CONVERSATION_ID });
      const canonicalConversationId = CASEFUL_MANAGED_CONVERSATION_ID;
      getConversationInvokeMock.mockResolvedValue({
        id: canonicalConversationId.toUpperCase(),
        type: 'acp',
        extra: {},
      });
      managed.bindDraft.mockImplementation(async (conversationId) => ({
        ...BOUND_DRAFT_RESULT,
        conversationId: conversationId.toUpperCase(),
      }));

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(managed.bindDraft).toHaveBeenCalledWith(canonicalConversationId);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: canonicalConversationId })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${canonicalConversationId}`);
      expect(managed.onHandoffAccepted).toHaveBeenCalledOnce();
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
    });

    it('rejects an unsafe managed conversation DTO identity without navigating', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      createConversationInvokeMock.mockImplementation(async (request: { extra?: Record<string, unknown> }) =>
        claimedConversationFromRequest(request, { id: '../unsafe' })
      );

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(readGuidPendingRaw()).toContain('hello');
    });

    it('orders draft grants, durable conversation, one bind, start, committed handoff, and navigation', async () => {
      const events: string[] = [];
      const deps = createDeps();
      deps.onPresentationTemplateConsumed = vi.fn();
      const managed = attachManagedPresentation(deps);
      managed.prepareSourceOwner.mockImplementation(async () => {
        events.push('draft-and-grants');
        return SOURCE_OWNER_RESULT;
      });
      createConversationInvokeMock.mockImplementation(async (request: { extra: { default_files: string[] } }) => {
        events.push('conversation');
        expect(request.extra.default_files).toEqual([]);
        return claimedConversationFromRequest(request);
      });
      managed.bindDraft.mockImplementation(async (conversationId) => {
        events.push('bind');
        return { ...BOUND_DRAFT_RESULT, conversationId };
      });
      confirmQueuedSourcesInvokeMock.mockImplementation(async () => {
        events.push('grant-confirm');
        return {
          ok: true,
          status: 'confirmed',
          ownerRevision: 5,
          expiresAt: '2026-08-06T10:00:00.000Z',
        };
      });
      startPresentationRunInvokeMock.mockImplementation(
        async (request: {
          conversation_id: string;
          client_request_id: string;
          selected_template_id: string;
          sources: PresentationSourceRef[];
        }) => {
          events.push('start');
          expect(request).toMatchObject({
            input: 'hello',
            selected_template_id: 'finance-review',
            sources: [SOURCE_REF],
          });
          return {
            ok: true,
            run: {
              runId: '55555555-5555-4555-8555-555555555555',
              clientRequestId: request.client_request_id,
              conversationId: request.conversation_id,
              selectedTemplateId: request.selected_template_id,
              revision: 8,
              createdAt: '2026-08-05T10:02:00.000Z',
              updatedAt: '2026-08-05T10:02:00.000Z',
              dispatchStatus: 'committed',
              artifactPhase: 'sources_snapshotted',
              disposition: null,
              retainedCandidate: null,
              actions: { openAllowed: false, discardAllowed: true },
            },
          };
        }
      );
      deps.navigate = vi.fn(async () => {
        const queue = readManagedQueue() as { items: Array<{ execution: { state: string } }> };
        expect(queue.items[0].execution.state).toBe('committed');
        events.push('navigate');
      }) as never;

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(events).toEqual(['draft-and-grants', 'conversation', 'bind', 'grant-confirm', 'start', 'navigate']);
      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(claimInitialDispatchInvokeMock).not.toHaveBeenCalled();
      expect(renewInitialDispatchInvokeMock).not.toHaveBeenCalled();
      expect(dispatchPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(JSON.stringify(readManagedQueue())).not.toContain('/');
      expect(sessionStorage.getItem('acp_initial_message_33333333-3333-4333-8333-333333333333')).toBeNull();
      expect(sessionStorage.getItem('aionrs_initial_message_33333333-3333-4333-8333-333333333333')).toBeNull();
      expect(managed.onHandoffAccepted).toHaveBeenCalledTimes(1);
    });

    it('creates and binds a valid main draft for prompt-only sends without confirming grants', async () => {
      const deps = createDeps();
      const promptOnlyOwner: GetPresentationSourceOwnerResult = {
        ok: true,
        owner: { owner_type: 'draft', draft_id: '22222222-2222-4222-8222-222222222222' },
        ownerRevision: 0,
        grants: [],
      };
      const managed = attachManagedPresentation(deps, { sourceRefs: [] });
      managed.prepareSourceOwner.mockResolvedValue(promptOnlyOwner);

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(managed.prepareSourceOwner).toHaveBeenCalledTimes(1);
      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(confirmQueuedSourcesInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({ input: 'hello', sources: [] })
      );
    });

    it('fails closed when prompt-only draft binding returns no authoritative result', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps, { sourceRefs: [] });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'draft', draft_id: '22222222-2222-4222-8222-222222222222' },
        ownerRevision: 0,
        grants: [],
      });
      managed.bindDraft.mockResolvedValue(null);

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(readGuidPendingRaw()).toContain('hello');
    });

    it('does not treat an empty revision-zero conversation owner as proof of prompt-only draft binding', async () => {
      const deps = createDeps();
      const conversationId = '33333333-3333-4333-8333-333333333333';
      const managed = attachManagedPresentation(deps, {
        conversationId,
        sourceRefs: [],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: conversationId },
        ownerRevision: 0,
        grants: [],
      });
      getConversationInvokeMock.mockResolvedValue({ id: conversationId, type: 'acp', extra: {} });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend().catch(() => undefined);
      });

      expect(managed.bindDraft).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(readGuidPendingRaw()).toContain(conversationId);
    });

    it('blocks an expired draft before conversation creation and keeps one stable pending snapshot', async () => {
      const deps = createDeps();
      deps.onPresentationTemplateConsumed = vi.fn();
      const managed = attachManagedPresentation(deps);
      managed.prepareSourceOwner.mockResolvedValue({
        ok: false,
        code: 'DRAFT_EXPIRED',
        messageKey: 'conversation.presentationRun.errors.DRAFT_EXPIRED',
        retryable: false,
        state: 'draft_expired',
        details: { draftId: '22222222-2222-4222-8222-222222222222' },
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      const stableSnapshot = readGuidPendingRaw();

      expect(stableSnapshot).toContain('hello');
      await act(async () => result.current.retireManagedPresentationAttemptAfterSourceChange(null));
      expect(readGuidPendingRaw()).toBe(stableSnapshot);
      await act(async () => result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' }));
      expect(readGuidPendingRaw()).toBeNull();
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(
        [deps.setInput, deps.setFiles, deps.onPresentationTemplateConsumed].map((spy) => spy.mock.calls.length)
      ).toEqual([0, 0, 0]);
    });

    it('reuses the claimed conversation after a bind conflict and safe source rebase', async () => {
      const deps = createDeps();
      deps.onPresentationTemplateConsumed = vi.fn();
      const managed = attachManagedPresentation(deps);
      managed.bindDraft.mockResolvedValue({
        ok: false,
        code: 'DRAFT_ALREADY_BOUND',
        messageKey: 'conversation.presentationRun.errors.DRAFT_ALREADY_BOUND',
        retryable: false,
        state: 'draft_active',
        details: {
          draftId: '22222222-2222-4222-8222-222222222222',
          conversationId: '77777777-7777-4777-8777-777777777777',
        },
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));

      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(removeConversationInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(deps.onPresentationTemplateConsumed).not.toHaveBeenCalled();

      const pending = JSON.parse(readGuidPendingRaw()!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      expect(
        Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((candidate) =>
          candidate?.startsWith('presentation-command-queue/v2/')
        )
      ).toBeUndefined();
      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 4096,
        expectedSha256: 'b'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'draft', draft_id: '99999999-9999-4999-8999-999999999998' },
        ownerRevision: 1,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      managed.bindDraft.mockImplementation(async (conversationId) => ({
        ...BOUND_DRAFT_RESULT,
        draftId: '99999999-9999-4999-8999-999999999998',
        conversationId,
      }));
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      await act(async () => result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(managed.bindDraft).toHaveBeenCalledTimes(2);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [replacementSource],
        })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${pending.conversationId}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('retires a definitively rejected persisting item and reuses its claimed conversation', async () => {
      const deps = createDeps();
      deps.onPresentationTemplateConsumed = vi.fn();
      const managed = attachManagedPresentation(deps);
      confirmQueuedSourcesInvokeMock.mockResolvedValue({
        ok: false,
        code: 'SOURCE_TAMPERED',
        messageKey: 'conversation.presentationRun.errors.SOURCE_TAMPERED',
        retryable: false,
        state: 'grant_validation',
        details: { grantId: SOURCE_REF.grantId },
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));

      expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(confirmQueuedSourcesInvokeMock).toHaveBeenCalledTimes(1);
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(removeConversationInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(
        [deps.setInput, deps.setFiles, deps.onPresentationTemplateConsumed].map((spy) => spy.mock.calls.length)
      ).toEqual([0, 0, 0]);
      expect(readGuidPendingRaw()).toContain('hello');
      expect(JSON.stringify(readManagedQueue())).toContain(SOURCE_REF.grantId);

      const pending = JSON.parse(readGuidPendingRaw()!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      const pendingRaw = readGuidPendingRaw();
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      await act(async () => result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' }));
      expect(readGuidPendingRaw()).toBe(pendingRaw);
      expect(
        Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((candidate) =>
          candidate?.startsWith('presentation-command-queue/v2/')
        )
      ).toBeUndefined();

      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 4096,
        expectedSha256: 'c'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: pending.conversationId },
        ownerRevision: 6,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      confirmQueuedSourcesInvokeMock.mockResolvedValue({
        ok: true,
        status: 'confirmed',
        ownerRevision: 7,
        expiresAt: '2026-08-06T12:00:00.000Z',
      });
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      await act(async () => result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [replacementSource],
        })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${pending.conversationId}`);
    });

    it('uses successful frozen-grant revoke proof to remove a never-confirmed item before claimant rebase', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      confirmQueuedSourcesInvokeMock.mockRejectedValueOnce(new Error('confirmation reply lost'));
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      const pendingRaw = readGuidPendingRaw();
      const pending = JSON.parse(pendingRaw!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );

      await act(async () =>
        first.result.current.retireManagedPresentationAttemptAfterSourceChange({
          kind: 'revoked',
          grantId: SOURCE_REF.grantId,
          queueUnboundAtRevoke: true,
        })
      );
      expect(readGuidPendingRaw()).toBe(pendingRaw);
      expect(
        Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((candidate) =>
          candidate?.startsWith('presentation-command-queue/v2/')
        )
      ).toBeUndefined();
      expect(confirmQueuedSourcesInvokeMock).toHaveBeenCalledOnce();
      first.unmount();

      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 8192,
        expectedSha256: 'f'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: pending.conversationId },
        ownerRevision: 6,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(confirmQueuedSourcesInvokeMock).toHaveBeenCalledTimes(2);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [replacementSource],
        })
      );
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [
          {
            queueItemId: pending.queueItemId,
            sources: [replacementSource],
            execution: { state: 'committed' },
          },
        ],
      });
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('uses durable queued-confirmation revoke proof on Send after remount to remove and rebase', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      confirmQueuedSourcesInvokeMock.mockRejectedValueOnce(new Error('confirmation reply lost')).mockResolvedValueOnce({
        ok: false,
        code: 'SOURCE_GRANT_REPLAYED',
        messageKey: 'conversation.presentationRun.errors.SOURCE_GRANT_REPLAYED',
        retryable: false,
        state: 'grant_validation',
        details: { grantId: SOURCE_REF.grantId, queueUnboundAtRevoke: true },
      });
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      const pendingRaw = readGuidPendingRaw();
      const pending = JSON.parse(pendingRaw!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      first.unmount();

      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 10_240,
        expectedSha256: '7'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: pending.conversationId },
        ownerRevision: 7,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement after revoke replay.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });
      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(confirmQueuedSourcesInvokeMock).toHaveBeenCalledTimes(3);
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [replacementSource],
        })
      );
      expect(readGuidPendingRaw()).not.toBe(pendingRaw);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('retires a mismatched persisting item after picker commit survives a renderer crash without its callback', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      confirmQueuedSourcesInvokeMock.mockRejectedValueOnce(new Error('confirmation reply lost')).mockResolvedValueOnce({
        ok: false,
        code: 'INVALID_REQUEST',
        messageKey: 'conversation.presentationRun.errors.INVALID_REQUEST',
        retryable: false,
        state: 'preflight',
        details: null,
      });
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      const pending = JSON.parse(readGuidPendingRaw()!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      first.unmount();

      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 12_288,
        expectedSha256: '9'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: pending.conversationId },
        ownerRevision: 7,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement after crash.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(confirmQueuedSourcesInvokeMock).toHaveBeenCalledTimes(3);
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [replacementSource],
        })
      );
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [
          {
            queueItemId: pending.queueItemId,
            sources: [replacementSource],
            execution: { state: 'committed' },
          },
        ],
      });
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${pending.conversationId}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('retires a mismatched preflight item after picker commit survives a renderer crash without its callback', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      startPresentationRunInvokeMock.mockResolvedValueOnce({
        ok: false,
        code: 'RATE_LIMITED',
        messageKey: 'conversation.presentationRun.errors.RATE_LIMITED',
        retryable: true,
        state: 'preflight',
        details: { retryAfterMs: 5000, postInvoked: false },
      });
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      const pending = JSON.parse(readGuidPendingRaw()!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [{ queueItemId: pending.queueItemId, execution: { state: 'preflight_failed' } }],
      });
      first.unmount();

      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 16_384,
        expectedSha256: '8'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: pending.conversationId },
        ownerRevision: 7,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement after preflight crash.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(confirmQueuedSourcesInvokeMock).toHaveBeenCalledTimes(2);
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(2);
      expect(startPresentationRunInvokeMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [replacementSource],
        })
      );
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [
          {
            queueItemId: pending.queueItemId,
            sources: [replacementSource],
            execution: { state: 'committed' },
          },
        ],
      });
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${pending.conversationId}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it.each([
      ['confirmation success', 'success', 'queued'],
      ['transport uncertainty', 'transport', 'persisting'],
      ['persistence uncertainty', 'PERSISTENCE_FAILED', 'persisting'],
      ['internal uncertainty', 'INTERNAL_ERROR', 'persisting'],
    ] as const)('preserves the exact durable marker on persisting retirement %s', async (_label, outcome, state) => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      confirmQueuedSourcesInvokeMock.mockRejectedValueOnce(new Error('initial confirmation reply lost'));
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      const pendingRaw = readGuidPendingRaw();
      const pending = JSON.parse(pendingRaw!) as { conversationId: string; queueItemId: string };
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      if (outcome === 'success') {
        confirmQueuedSourcesInvokeMock.mockResolvedValueOnce({
          ok: true,
          status: 'already_confirmed',
          ownerRevision: 6,
          expiresAt: '2026-08-06T12:00:00.000Z',
        });
      } else if (outcome === 'transport') {
        confirmQueuedSourcesInvokeMock.mockRejectedValueOnce(new Error('transport unavailable'));
      } else {
        confirmQueuedSourcesInvokeMock.mockResolvedValueOnce({
          ok: false,
          code: outcome,
          messageKey: `conversation.presentationRun.errors.${outcome}`,
          retryable: false,
          state: 'persistence',
          details: null,
        });
      }

      await act(async () => result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' }));

      expect(readGuidPendingRaw()).toBe(pendingRaw);
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [{ queueItemId: pending.queueItemId, execution: { state } }],
      });
      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
    });

    it('resumes the frozen queued item after a lost confirmation reply and source change', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      confirmQueuedSourcesInvokeMock.mockRejectedValueOnce(new Error('confirmation reply lost'));
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      const pendingRaw = readGuidPendingRaw();
      const pending = JSON.parse(pendingRaw!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      confirmQueuedSourcesInvokeMock.mockResolvedValueOnce({
        ok: true,
        status: 'already_confirmed',
        ownerRevision: 6,
        expiresAt: '2026-08-06T12:00:00.000Z',
      });

      await act(async () => first.result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' }));
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [{ queueItemId: pending.queueItemId, execution: { state: 'queued' } }],
      });
      first.unmount();

      const addedSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 4096,
        expectedSha256: 'd'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [SOURCE_REF, addedSource],
      });
      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(confirmQueuedSourcesInvokeMock).toHaveBeenCalledTimes(2);
      expect(managed.prepareSourceOwner).toHaveBeenCalledOnce();
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [SOURCE_REF],
        })
      );
      expect(readManagedQueue()).toMatchObject({
        conversationId: pending.conversationId,
        items: [
          {
            queueItemId: pending.queueItemId,
            clientRequestId: pending.clientRequestId,
            sources: [SOURCE_REF],
            execution: { state: 'committed' },
          },
        ],
      });
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${pending.conversationId}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it.each([
      [
        'input',
        (deps: GuidSendDeps): void => {
          deps.input = 'a different presentation request';
        },
      ],
      [
        'template',
        (deps: GuidSendDeps): void => {
          Object.assign(deps.managedPresentation!, { selectedTemplateId: 'another-template' });
        },
      ],
      [
        'runtime',
        (deps: GuidSendDeps): void => {
          deps.selectedAssistantBackend = 'aionrs';
        },
      ],
    ] as const)(
      'does not resume a frozen queued item after its %s identity changes',
      async (_label, changeIdentity) => {
        const deps = createDeps();
        attachManagedPresentation(deps);
        confirmQueuedSourcesInvokeMock.mockRejectedValueOnce(new Error('confirmation reply lost'));
        const first = renderHook(() => useGuidSend(deps));
        await act(async () => {
          await first.result.current.handleSend().catch(() => undefined);
        });
        const pendingRaw = readGuidPendingRaw();
        const pending = JSON.parse(pendingRaw!) as { conversationId: string; queueItemId: string };
        getConversationInvokeMock.mockResolvedValue(
          claimedConversation(pending.queueItemId, { id: pending.conversationId })
        );
        confirmQueuedSourcesInvokeMock.mockResolvedValueOnce({
          ok: true,
          status: 'already_confirmed',
          ownerRevision: 6,
          expiresAt: '2026-08-06T12:00:00.000Z',
        });
        await act(async () =>
          first.result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' })
        );
        first.unmount();
        changeIdentity(deps);

        const second = renderHook(() => useGuidSend(deps));
        await expect(act(async () => second.result.current.handleSend())).rejects.toThrow(/another submission/i);

        expect(createConversationInvokeMock).toHaveBeenCalledOnce();
        expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
        expect(deps.navigate).not.toHaveBeenCalled();
        expect(readGuidPendingRaw()).toBe(pendingRaw);
        expect(readManagedQueue()).toMatchObject({
          conversationId: pending.conversationId,
          items: [{ queueItemId: pending.queueItemId, execution: { state: 'queued' } }],
        });
      }
    );

    it('rescans an uncertain claimant before rebasing sources after restart', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      let queueItemId = '';
      listConversationsInvokeMock
        .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
        .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
        .mockImplementation(async () => ({
          items: [claimedConversation(queueItemId)],
          total: 1,
          has_more: false,
        }));
      createConversationInvokeMock.mockImplementationOnce(async (request: { extra: Record<string, unknown> }) => {
        queueItemId = (request.extra[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id: string }).queue_item_id;
        throw new Error('create reply lost before catalogue visibility');
      });
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await first.result.current.handleSend().catch(() => undefined);
      });
      const uncertainRaw = readGuidPendingRaw();
      const uncertain = JSON.parse(uncertainRaw!) as {
        clientRequestId: string;
        createPhase: string;
        queueItemId: string;
      };
      expect(uncertain).toMatchObject({ createPhase: 'uncertain', queueItemId });
      first.unmount();

      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 8192,
        expectedSha256: 'e'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'draft', draft_id: '99999999-9999-4999-8999-999999999998' },
        ownerRevision: 1,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      managed.bindDraft.mockImplementation(async (conversationId) => ({
        ...BOUND_DRAFT_RESULT,
        draftId: '99999999-9999-4999-8999-999999999998',
        conversationId,
      }));
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(listConversationsInvokeMock).toHaveBeenCalledTimes(3);
      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: uncertain.clientRequestId,
          conversation_id: SERVER_ASSIGNED_CONVERSATION_ID,
          sources: [replacementSource],
        })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${SERVER_ASSIGNED_CONVERSATION_ID}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('retains the raw submission when main start returns a definitive preflight block', async () => {
      const deps = createDeps();
      deps.onPresentationTemplateConsumed = vi.fn();
      const managed = attachManagedPresentation(deps);
      startPresentationRunInvokeMock.mockResolvedValueOnce({
        ok: false,
        code: 'RATE_LIMITED',
        messageKey: 'conversation.presentationRun.errors.RATE_LIMITED',
        retryable: true,
        state: 'preflight',
        details: { retryAfterMs: 5000, postInvoked: false },
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));

      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
      expect(removeConversationInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(
        [deps.setInput, deps.setFiles, deps.onPresentationTemplateConsumed].map((spy) => spy.mock.calls.length)
      ).toEqual([0, 0, 0]);
      expect(readGuidPendingRaw()).toContain('hello');
      expect(readManagedQueue()).toMatchObject({
        items: [{ input: 'hello', selectedTemplateId: 'finance-review', execution: { state: 'preflight_failed' } }],
      });

      const firstConversationId = startPresentationRunInvokeMock.mock.calls[0][0].conversation_id as string;
      const pending = JSON.parse(readGuidPendingRaw()!) as {
        clientRequestId: string;
        queueItemId: string;
      };
      const pendingRaw = readGuidPendingRaw();
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: firstConversationId })
      );
      await act(async () => result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' }));
      expect(readGuidPendingRaw()).toBe(pendingRaw);
      expect(
        Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((candidate) =>
          candidate?.startsWith('presentation-command-queue/v2/')
        )
      ).toBeUndefined();

      const replacementSource: PresentationSourceRef = {
        grantId: '77777777-7777-4777-8777-777777777777',
        expectedByteLength: 4096,
        expectedSha256: 'b'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        conversationId: firstConversationId,
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: firstConversationId },
        ownerRevision: 6,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Updated Revenue.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      await act(async () => result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(2);
      expect(startPresentationRunInvokeMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          conversation_id: firstConversationId,
          client_request_id: pending.clientRequestId,
          sources: [replacementSource],
        })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${firstConversationId}`);
      expect(readGuidPendingRaw()).toBeNull();
    });

    it('retires a legacy-v2 markerless attempt only after exact-get proof and preflight removal', async () => {
      const conversationId = '33333333-3333-4333-8333-333333333333';
      const deps = createDeps();
      attachManagedPresentation(deps, { conversationId });
      getConversationInvokeMock.mockResolvedValue({ id: conversationId, type: 'acp', extra: {} });
      startPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RATE_LIMITED',
        messageKey: 'conversation.presentationRun.errors.RATE_LIMITED',
        retryable: true,
        state: 'preflight',
        details: { retryAfterMs: 5000, postInvoked: false },
      });
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      const current = JSON.parse(readGuidPendingRaw()!) as Record<string, unknown>;
      const { claimMode: _claimMode, createPhase: _createPhase, ...legacyFields } = current;
      localStorage.removeItem(GUID_PENDING_STORAGE_KEY);
      sessionStorage.setItem('guid_presentation_submission_v2', JSON.stringify({ ...legacyFields, version: 2 }));

      await act(async () => result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' }));

      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(getConversationInvokeMock).toHaveBeenCalledTimes(2);
      expect(readGuidPendingRaw()).toBeNull();
      expect(
        Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((candidate) =>
          candidate?.startsWith('presentation-command-queue/v2/')
        )
      ).toBeUndefined();
    });

    it('reconciles lost create, bind, and start replies by stable IDs without repeating their mutations', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps);
      const conversationId = SERVER_ASSIGNED_CONVERSATION_ID;
      let queueItemId = '';
      listConversationsInvokeMock
        .mockResolvedValueOnce({ items: [], total: 0, has_more: false })
        .mockImplementationOnce(async () => ({
          items: [claimedConversation(queueItemId, { id: conversationId })],
          total: 1,
          has_more: false,
        }));
      createConversationInvokeMock.mockImplementation(async (request: { extra: Record<string, unknown> }) => {
        queueItemId = (request.extra[GUID_HANDOFF_CLAIM_KEY] as { queue_item_id: string }).queue_item_id;
        throw new Error('create reply lost');
      });
      managed.bindDraft.mockRejectedValue(new Error('bind reply lost'));
      managed.prepareSourceOwner
        .mockResolvedValueOnce(SOURCE_OWNER_RESULT)
        .mockImplementation(async (recoveryConversationId) => ({
          ...SOURCE_OWNER_RESULT,
          owner: { owner_type: 'conversation', conversation_id: recoveryConversationId ?? conversationId },
          ownerRevision: 4,
        }));
      startPresentationRunInvokeMock.mockRejectedValue(new Error('start reply lost'));
      getPresentationRunInvokeMock.mockImplementation(
        async (request: { conversation_id: string; client_request_id: string }) => ({
          ok: true,
          run: {
            runId: '55555555-5555-4555-8555-555555555555',
            clientRequestId: request.client_request_id,
            conversationId: request.conversation_id,
            selectedTemplateId: 'finance-review',
            revision: 8,
            createdAt: '2026-08-05T10:02:00.000Z',
            updatedAt: '2026-08-05T10:02:00.000Z',
            dispatchStatus: 'committed',
            artifactPhase: 'sources_snapshotted',
            disposition: null,
            retainedCandidate: null,
            actions: { openAllowed: false, discardAllowed: true },
          },
        })
      );

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
      expect(listConversationsInvokeMock).toHaveBeenCalledTimes(2);
      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(managed.prepareSourceOwner).toHaveBeenLastCalledWith(conversationId);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
      expect(getPresentationRunInvokeMock).toHaveBeenCalledWith({
        conversation_id: conversationId,
        client_request_id: expect.any(String),
      });
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${conversationId}`);
    });

    it('deduplicates duplicate clicks while the managed draft is pending', async () => {
      const deps = createDeps();
      let releaseDraft!: (value: GetPresentationSourceOwnerResult) => void;
      const draft = new Promise<GetPresentationSourceOwnerResult>((resolve) => {
        releaseDraft = resolve;
      });
      const managed = attachManagedPresentation(deps);
      managed.prepareSourceOwner.mockReturnValue(draft);
      const { result } = renderHook(() => useGuidSend(deps));

      act(() => {
        result.current.sendMessageHandler();
        result.current.sendMessageHandler();
      });
      expect(result.current.managedPresentationPending).toBe(true);
      await act(async () => releaseDraft(SOURCE_OWNER_RESULT));
      await waitFor(() => expect(deps.navigate).toHaveBeenCalledTimes(1));

      expect(managed.prepareSourceOwner).toHaveBeenCalledTimes(1);
      expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the same queue and request identity across remount when backend DTO ids are uppercase', async () => {
      const deps = createDeps();
      const managed = attachManagedPresentation(deps, { conversationId: CASEFUL_MANAGED_CONVERSATION_ID });
      getConversationInvokeMock.mockResolvedValue({
        id: CASEFUL_MANAGED_CONVERSATION_ID.toUpperCase(),
        type: 'acp',
        extra: {},
      });
      const navigate = vi.fn().mockRejectedValueOnce(new Error('navigation reply lost')).mockResolvedValue(undefined);
      deps.navigate = navigate as never;
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => first.result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      const firstStartRequest = startPresentationRunInvokeMock.mock.calls[0][0];
      expect(JSON.parse(readGuidPendingRaw()!)).toMatchObject({
        version: 3,
        claimMode: 'exact_get',
        createPhase: 'resolved',
        conversationId: CASEFUL_MANAGED_CONVERSATION_ID,
      });
      const queueBeforeRemount = readManagedQueue() as {
        items: Array<{
          clientRequestId: string;
          selectedTemplateId: string;
          execution: { state: 'committed'; runId: string; revision: number };
        }>;
      };
      const committed = queueBeforeRemount.items[0];
      await act(async () => first.result.current.retireManagedPresentationAttemptAfterSourceChange({ kind: 'added' }));
      deps.managedPresentation!.sourceRefs = [
        {
          grantId: '77777777-7777-4777-8777-777777777777',
          expectedByteLength: 4096,
          expectedSha256: 'b'.repeat(64),
        },
      ];
      expect(readGuidPendingRaw()).toContain(SOURCE_REF.grantId);
      getConversationInvokeMock.mockResolvedValue({
        id: firstStartRequest.conversation_id.toUpperCase(),
        type: 'acp',
        extra: {},
      });
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: true,
        run: {
          runId: committed.execution.runId,
          clientRequestId: committed.clientRequestId,
          conversationId: firstStartRequest.conversation_id.toUpperCase(),
          selectedTemplateId: committed.selectedTemplateId,
          revision: committed.execution.revision,
          createdAt: '2026-08-05T10:02:00.000Z',
          updatedAt: '2026-08-05T10:02:00.000Z',
          dispatchStatus: 'committed',
          artifactPhase: 'sources_snapshotted',
          disposition: null,
          retainedCandidate: null,
          actions: { openAllowed: false, discardAllowed: true },
        },
      });
      first.unmount();

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
      expect(managed.bindDraft).toHaveBeenCalledTimes(1);
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(getConversationInvokeMock).toHaveBeenCalledWith({ id: firstStartRequest.conversation_id });
      expect(getPresentationRunInvokeMock).toHaveBeenCalledWith({
        conversation_id: firstStartRequest.conversation_id,
        client_request_id: committed.clientRequestId,
      });
      expect(navigate).toHaveBeenCalledTimes(2);
      const queue = readManagedQueue() as {
        items: Array<{ queueItemId: string; clientRequestId: string; execution: { state: string } }>;
      };
      expect(queue.items[0]).toMatchObject({
        clientRequestId: firstStartRequest.client_request_id,
        execution: { state: 'committed' },
      });
    });

    it('fails closed on a forged committed queue item when main cannot prove the conversation and run', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      const navigate = vi.fn().mockRejectedValueOnce(new Error('navigation reply lost')).mockResolvedValue(undefined);
      deps.navigate = navigate as never;
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => first.result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      first.unmount();
      getConversationInvokeMock.mockResolvedValue(null);
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await second.result.current.handleSend().catch(() => undefined);
      });

      expect(getConversationInvokeMock).toHaveBeenCalledTimes(1);
      expect(getPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
      expect(readGuidPendingRaw()).toContain('finance-review');
    });

    it.each(['dispatching', 'bound', 'dispatch_uncertain'] as const)(
      'observes authoritative main advancement from local committed to %s without reclaiming or resending',
      async (dispatchStatus) => {
        const deps = createDeps();
        attachManagedPresentation(deps);
        const navigate = vi.fn().mockRejectedValueOnce(new Error('navigation reply lost')).mockResolvedValue(undefined);
        deps.navigate = navigate as never;
        const first = renderHook(() => useGuidSend(deps));
        await act(async () => first.result.current.sendMessageHandler());
        await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
        const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find(
          (candidate) => candidate?.startsWith('presentation-command-queue/v2/')
        )!;
        const queue = JSON.parse(localStorage.getItem(key)!) as {
          conversationId: string;
          items: Array<{
            clientRequestId: string;
            selectedTemplateId: string;
            execution: { state: string; runId: string; revision: number };
          }>;
        };
        const item = queue.items[0];
        expect(item.execution.state).toBe('committed');
        getConversationInvokeMock.mockImplementation(async () => claimedConversationForPending(queue.conversationId));
        getPresentationRunInvokeMock.mockResolvedValue({
          ok: true,
          run: {
            runId: item.execution.runId,
            clientRequestId: item.clientRequestId,
            conversationId: queue.conversationId,
            selectedTemplateId: item.selectedTemplateId,
            revision: item.execution.revision + 1,
            createdAt: '2026-08-05T10:02:00.000Z',
            updatedAt: '2026-08-05T10:03:00.000Z',
            dispatchStatus,
            artifactPhase: 'sources_snapshotted',
            disposition: dispatchStatus === 'dispatch_uncertain' ? 'TRACKING_REQUIRED' : null,
            retainedCandidate: null,
            actions: { openAllowed: false, discardAllowed: false },
          },
        });
        first.unmount();

        const second = renderHook(() => useGuidSend(deps));
        await act(async () => second.result.current.handleSend());

        expect(getConversationInvokeMock).toHaveBeenCalledWith({ id: queue.conversationId });
        expect(getPresentationRunInvokeMock).toHaveBeenCalledWith({
          conversation_id: queue.conversationId,
          client_request_id: item.clientRequestId,
        });
        expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
        expect(claimInitialDispatchInvokeMock).not.toHaveBeenCalled();
        expect(renewInitialDispatchInvokeMock).not.toHaveBeenCalled();
        expect(dispatchPresentationRunInvokeMock).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledTimes(2);
      }
    );

    it.each([
      ['committed', 'allocating'],
      ['dispatching', 'committed'],
      ['bound', 'committed'],
      ['bound', 'dispatching'],
      ['dispatch_uncertain', 'committed'],
      ['dispatch_uncertain', 'bound'],
    ] as const)(
      'rejects incompatible authoritative state %s -> %s even when identity and revision match',
      async (localState, dispatchStatus) => {
        const deps = createDeps();
        attachManagedPresentation(deps);
        const navigate = vi.fn().mockRejectedValueOnce(new Error('navigation reply lost')).mockResolvedValue(undefined);
        deps.navigate = navigate as never;
        const first = renderHook(() => useGuidSend(deps));
        await act(async () => first.result.current.sendMessageHandler());
        await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
        const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find(
          (candidate) => candidate?.startsWith('presentation-command-queue/v2/')
        )!;
        const queue = JSON.parse(localStorage.getItem(key)!) as {
          conversationId: string;
          items: Array<{
            clientRequestId: string;
            selectedTemplateId: string;
            execution: { state: string; runId: string; revision: number; postInvoked?: false };
          }>;
        };
        const item = queue.items[0];
        if (localState !== 'committed') {
          item.execution = {
            state: localState,
            runId: item.execution.runId,
            revision: item.execution.revision + 1,
          };
          localStorage.setItem(key, JSON.stringify(queue));
        }
        getConversationInvokeMock.mockImplementation(async () => claimedConversationForPending(queue.conversationId));
        getPresentationRunInvokeMock.mockResolvedValue({
          ok: true,
          run: {
            runId: item.execution.runId,
            clientRequestId: item.clientRequestId,
            conversationId: queue.conversationId,
            selectedTemplateId: item.selectedTemplateId,
            revision: item.execution.revision + 1,
            createdAt: '2026-08-05T10:02:00.000Z',
            updatedAt: '2026-08-05T10:03:00.000Z',
            dispatchStatus,
            artifactPhase: dispatchStatus === 'allocating' ? 'none' : 'sources_snapshotted',
            disposition: null,
            retainedCandidate: null,
            actions: { openAllowed: false, discardAllowed: false },
          },
        });
        first.unmount();

        const second = renderHook(() => useGuidSend(deps));
        await act(async () => {
          await second.result.current.handleSend().catch(() => undefined);
        });

        expect(getPresentationRunInvokeMock).toHaveBeenCalledWith({
          conversation_id: queue.conversationId,
          client_request_id: item.clientRequestId,
        });
        expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
        expect(claimInitialDispatchInvokeMock).not.toHaveBeenCalled();
        expect(renewInitialDispatchInvokeMock).not.toHaveBeenCalled();
        expect(dispatchPresentationRunInvokeMock).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(readGuidPendingRaw()).toContain(item.clientRequestId);
      }
    );

    it('observes an authoritative terminal run that advanced beyond a locally bound handoff', async () => {
      const deps = createDeps();
      attachManagedPresentation(deps);
      const navigate = vi.fn().mockRejectedValueOnce(new Error('navigation reply lost')).mockResolvedValue(undefined);
      deps.navigate = navigate as never;
      const first = renderHook(() => useGuidSend(deps));
      await act(async () => first.result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).find((candidate) =>
        candidate?.startsWith('presentation-command-queue/v2/')
      )!;
      const queue = JSON.parse(localStorage.getItem(key)!) as {
        conversationId: string;
        items: Array<{
          clientRequestId: string;
          selectedTemplateId: string;
          execution: { state: string; runId: string; revision: number };
        }>;
      };
      const item = queue.items[0];
      item.execution = {
        state: 'bound',
        runId: item.execution.runId,
        revision: item.execution.revision + 1,
      };
      localStorage.setItem(key, JSON.stringify(queue));
      getConversationInvokeMock.mockImplementation(async () => claimedConversationForPending(queue.conversationId));
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: true,
        run: {
          runId: item.execution.runId,
          clientRequestId: item.clientRequestId,
          conversationId: queue.conversationId,
          selectedTemplateId: item.selectedTemplateId,
          revision: item.execution.revision + 1,
          createdAt: '2026-08-05T10:02:00.000Z',
          updatedAt: '2026-08-05T10:04:00.000Z',
          dispatchStatus: 'retained',
          artifactPhase: 'candidate_retained',
          disposition: 'REVIEW_REQUIRED',
          retainedCandidate: { sha256: 'b'.repeat(64), byteLength: 4096 },
          actions: { openAllowed: false, discardAllowed: true },
        },
      });
      first.unmount();

      const second = renderHook(() => useGuidSend(deps));
      await act(async () => second.result.current.handleSend());

      expect(getPresentationRunInvokeMock).toHaveBeenCalledWith({
        conversation_id: queue.conversationId,
        client_request_id: item.clientRequestId,
      });
      expect(startPresentationRunInvokeMock).toHaveBeenCalledTimes(1);
      expect(claimInitialDispatchInvokeMock).not.toHaveBeenCalled();
      expect(renewInitialDispatchInvokeMock).not.toHaveBeenCalled();
      expect(dispatchPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledTimes(2);
    });

    it('reuses the claimed conversation after queue persistence failure and safe source rebase', async () => {
      const deps = createDeps();
      deps.onPresentationTemplateConsumed = vi.fn();
      const managed = attachManagedPresentation(deps);
      const originalSetItem = Storage.prototype.setItem;
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key.startsWith('presentation-command-queue/v2/')) throw new DOMException('quota', 'QuotaExceededError');
        return originalSetItem.call(this, key, value);
      });

      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));

      expect(startPresentationRunInvokeMock).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      expect(removeConversationInvokeMock).not.toHaveBeenCalled();
      expect(
        [deps.setInput, deps.setFiles, deps.onPresentationTemplateConsumed].map((spy) => spy.mock.calls.length)
      ).toEqual([0, 0, 0]);
      setItem.mockRestore();

      const pending = JSON.parse(readGuidPendingRaw()!) as {
        clientRequestId: string;
        conversationId: string;
        queueItemId: string;
      };
      const replacementSource: PresentationSourceRef = {
        grantId: '99999999-9999-4999-8999-999999999999',
        expectedByteLength: 8192,
        expectedSha256: 'c'.repeat(64),
      };
      Object.assign(deps.managedPresentation!, {
        draftClientRequestId: '88888888-8888-4888-8888-888888888888',
        sourceRefs: [replacementSource],
      });
      managed.prepareSourceOwner.mockResolvedValue({
        ok: true,
        owner: { owner_type: 'conversation', conversation_id: pending.conversationId },
        ownerRevision: 6,
        grants: [
          {
            grantId: replacementSource.grantId,
            displayName: 'Replacement.xlsx',
            format: 'xlsx',
            sourceKind: 'native-picker',
            byteLength: replacementSource.expectedByteLength,
            sha256: replacementSource.expectedSha256,
            expiresAt: '2026-08-06T11:00:00.000Z',
          },
        ],
      });
      getConversationInvokeMock.mockResolvedValue(
        claimedConversation(pending.queueItemId, { id: pending.conversationId })
      );
      getPresentationRunInvokeMock.mockResolvedValue({
        ok: false,
        code: 'RUN_NOT_FOUND',
        messageKey: 'conversation.presentationRun.errors.RUN_NOT_FOUND',
        retryable: false,
        state: 'lookup',
        details: null,
      });

      await act(async () => result.current.handleSend());

      expect(createConversationInvokeMock).toHaveBeenCalledOnce();
      expect(managed.bindDraft).toHaveBeenCalledOnce();
      expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          client_request_id: pending.clientRequestId,
          conversation_id: pending.conversationId,
          sources: [replacementSource],
        })
      );
      expect(deps.navigate).toHaveBeenCalledWith(`/conversation/${pending.conversationId}`);
      expect(readGuidPendingRaw()).toBeNull();
    });
  });

  // Nested (not a sibling describe) so these tests run under the outer
  // beforeEach above — it resets createConversationInvokeMock and
  // kbGetSessionMcpServerMock before every test, keeping `.mock.calls[0][0]`
  // and call-count assertions scoped to a single test each.
  describe('project knowledge attach', () => {
    const KB_SERVER = {
      id: 'project-kb-p1',
      name: 'aionui-project-knowledge',
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['/out/main/builtin-mcp-knowledge.js'],
        env: { AIONUI_KB_PROJECT_ID: 'p1', AIONUI_KB_STORE_DIR: '/store/p1' },
      },
    };

    it('does not query the KB descriptor for non-project chats', async () => {
      const deps = createDeps();
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend();
      });
      expect(kbGetSessionMcpServerMock).not.toHaveBeenCalled();
      expect(kbSyncFolderMock).not.toHaveBeenCalled();
    });

    // Creating a chat is a sync point: files dropped into the folder since the
    // last sync get indexed for the NEXT chat. It must not be awaited — this
    // chat still uses whatever was ready at creation.
    it('kicks off a folder sync for a project chat without blocking creation', async () => {
      kbGetSessionMcpServerMock.mockResolvedValue(null);
      let releaseSync: (() => void) | null = null;
      kbSyncFolderMock.mockReturnValue(
        new Promise<void>((resolve) => {
          releaseSync = resolve;
        })
      );
      const deps = createDeps();
      deps.projectId = 'p1';
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(kbSyncFolderMock).toHaveBeenCalledWith({ projectId: 'p1', workspace: '/ws/p1' });
      expect(createConversationInvokeMock).toHaveBeenCalled(); // creation did not wait on the sync
      releaseSync?.();
    });

    it('still creates the conversation when the folder sync rejects', async () => {
      kbGetSessionMcpServerMock.mockResolvedValue(null);
      kbSyncFolderMock.mockRejectedValue(new Error('sync exploded'));
      const deps = createDeps();
      deps.projectId = 'p1';
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(createConversationInvokeMock).toHaveBeenCalled();
    });

    it('appends the KB session server for a project chat (acp path)', async () => {
      kbGetSessionMcpServerMock.mockResolvedValue(KB_SERVER);
      const deps = createDeps();
      deps.projectId = 'p1';
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend();
      });
      expect(kbGetSessionMcpServerMock).toHaveBeenCalledWith({ projectId: 'p1' });
      const payload = createConversationInvokeMock.mock.calls[0][0];
      expect(payload.extra.selected_session_mcp_servers).toEqual(expect.arrayContaining([KB_SERVER]));
      // Pure session server: never referenced by repo-row id lists.
      expect(payload.extra.selected_mcp_server_ids ?? []).not.toContain(KB_SERVER.id);
      expect(payload.assistant?.conversation_overrides?.mcp_ids ?? []).not.toContain(KB_SERVER.id);
    });

    it('appends the KB session server for a project chat (aionrs path)', async () => {
      kbGetSessionMcpServerMock.mockResolvedValue(KB_SERVER);
      const deps = createDeps();
      deps.projectId = 'p1';
      deps.selectedAssistantBackend = 'aionrs';
      deps.current_model = {
        id: 'prov',
        platform: 'openai',
        name: 'P',
        base_url: 'https://x',
        api_key: 'k',
        use_model: 'gpt-4o',
      } as never;
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend();
      });
      const payload = createConversationInvokeMock.mock.calls[0][0];
      expect(payload.extra.selected_session_mcp_servers).toEqual(expect.arrayContaining([KB_SERVER]));
    });

    it('creates the conversation without the KB server when the descriptor rejects', async () => {
      kbGetSessionMcpServerMock.mockRejectedValue(new Error('ipc down'));
      const deps = createDeps();
      deps.projectId = 'p1';
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => {
        await result.current.handleSend();
      });
      expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
      const payload = createConversationInvokeMock.mock.calls[0][0];
      const servers = (payload.extra.selected_session_mcp_servers ?? []) as Array<{ name: string }>;
      expect(servers.some((s) => s.name === 'aionui-project-knowledge')).toBe(false);
    });
  });

  it('restores a path-free pending submission across real GuidPage remounts and retries with stable IDs', async () => {
    vi.resetModules();
    const originalElectronAPI = window.electronAPI;
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
    const navigate = vi.fn().mockResolvedValue(undefined);
    const conversationId = 'd0921953';
    const queueItemId = '77777777-7777-4777-8777-777777777777';
    const clientRequestId = '66666666-6666-4666-8666-666666666666';
    const draftClientRequestId = '44444444-4444-4444-8444-444444444444';
    const durableDraftId = '22222222-2222-4222-8222-222222222222';
    const durableSource = {
      grantId: SOURCE_REF.grantId,
      displayName: 'Quarterly Revenue.xlsx',
      format: 'xlsx' as const,
      sourceKind: 'native-picker' as const,
      byteLength: SOURCE_REF.expectedByteLength,
      sha256: SOURCE_REF.expectedSha256,
      expiresAt: '2026-08-06T10:00:00.000Z',
    };
    const durableState = { bound: false };
    const createDraft = vi.fn();
    const hydrate = vi.fn();
    const bindDraft = vi.fn();

    localStorage.setItem(
      GUID_PENDING_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        claimMode: 'exact_get',
        createPhase: 'resolved',
        conversationId,
        queueItemId,
        clientRequestId,
        draftClientRequestId,
        input: 'Restore the quarterly board review',
        selectedTemplateId: 'finance-review',
        sources: [SOURCE_REF],
        runtime: 'acp',
        capturedAt: '2026-08-05T10:00:00.000Z',
      })
    );
    sessionStorage.removeItem(GUID_PENDING_STORAGE_KEY);
    sessionStorage.removeItem('guid_presentation_draft_request_v2');
    getConversationInvokeMock.mockResolvedValue({ id: conversationId, type: 'acp', extra: {} });
    startPresentationRunInvokeMock.mockImplementation(
      async (request: { client_request_id: string; conversation_id: string; selected_template_id: string }) => ({
        ok: true,
        run: {
          runId: '55555555-5555-4555-8555-555555555555',
          clientRequestId: request.client_request_id,
          conversationId: request.conversation_id,
          selectedTemplateId: request.selected_template_id,
          revision: 8,
          createdAt: '2026-08-05T10:02:00.000Z',
          updatedAt: '2026-08-05T10:02:00.000Z',
          dispatchStatus: 'committed',
          artifactPhase: 'sources_snapshotted',
          disposition: null,
          retainedCandidate: null,
          actions: { openAllowed: false, discardAllowed: true },
        },
      })
    );

    vi.doMock('@/common/config/constants', async () => ({
      ...(await vi.importActual<typeof import('@/common/config/constants')>('@/common/config/constants')),
      PRESENTATION_RUN_V2_ENABLED: true,
    }));
    vi.doMock('react-i18next', () => ({
      useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
        i18n: { language: 'en-US' },
      }),
    }));
    vi.doMock('react-router-dom', () => ({
      useLocation: () => ({ state: null, key: 'guid-recovery', pathname: '/guid', search: '', hash: '' }),
      useNavigate: () => navigate,
    }));
    vi.doMock('@/renderer/hooks/mcp/catalog', () => ({
      ensureBackendMcpCatalog: vi.fn().mockResolvedValue({ allServers: [] }),
      toSessionMcpServer: (server: unknown) => server,
    }));
    vi.doMock('@/renderer/hooks/chat/useInputFocusRing', () => ({
      useInputFocusRing: () => ({ activeBorderColor: '#000', inactiveBorderColor: '#ccc', activeShadow: 'none' }),
    }));
    vi.doMock('@/renderer/hooks/chat/useSlashCommandController', () => ({
      getFuzzyMatchIndices: vi.fn(),
      useSlashCommandController: () => ({
        activeIndex: 0,
        filteredCommands: [],
        isOpen: false,
        query: '',
        onKeyDown: () => false,
        onSelectByIndex: vi.fn(),
        setActiveIndex: vi.fn(),
      }),
    }));
    vi.doMock('@/renderer/hooks/file/selection', () => ({
      useOpenFileSelector: () => ({ onSlashBuiltinCommand: vi.fn() }),
      usePresentationSourceDraft: () => {
        const [owner, setOwner] = React.useState<
          { owner_type: 'draft'; draft_id: string } | { owner_type: 'conversation'; conversation_id: string } | null
        >(null);
        const [ownerRevision, setOwnerRevision] = React.useState<number | null>(null);
        const [descriptors, setDescriptors] = React.useState<(typeof durableSource)[]>([]);
        const hydrateOwner = React.useCallback(
          async (
            requestedOwner:
              | { owner_type: 'draft'; draft_id: string }
              | { owner_type: 'conversation'; conversation_id: string }
          ) => {
            hydrate(requestedOwner);
            if (requestedOwner.owner_type === 'conversation' && !durableState.bound) {
              setOwner(requestedOwner);
              setOwnerRevision(0);
              setDescriptors([]);
              return { ok: true as const, owner: requestedOwner, ownerRevision: 0, grants: [] };
            }
            const nextOwner =
              requestedOwner.owner_type === 'conversation'
                ? requestedOwner
                : { owner_type: 'draft' as const, draft_id: durableDraftId };
            const nextRevision = requestedOwner.owner_type === 'conversation' ? 4 : 3;
            setOwner(nextOwner);
            setOwnerRevision(nextRevision);
            setDescriptors([durableSource]);
            return { ok: true as const, owner: nextOwner, ownerRevision: nextRevision, grants: [durableSource] };
          },
          []
        );
        const createSourceDraft = React.useCallback(async (requestId: string) => {
          createDraft(requestId);
          setOwner({ owner_type: 'draft', draft_id: durableDraftId });
          setOwnerRevision(3);
          setDescriptors([durableSource]);
          return {
            ok: true as const,
            status: 'existing' as const,
            draft: {
              draftId: durableDraftId,
              revision: 3,
              expiresAt: '2026-08-06T10:00:00.000Z',
              grantCount: 1,
            },
          };
        }, []);
        const bindSourceDraft = React.useCallback(
          async (targetConversationId: string) => {
            bindDraft(targetConversationId);
            if (owner?.owner_type !== 'draft') return null;
            durableState.bound = true;
            setOwner({ owner_type: 'conversation', conversation_id: targetConversationId });
            setOwnerRevision(4);
            return {
              ok: true as const,
              status: 'bound' as const,
              draftId: owner.draft_id,
              conversationId: targetConversationId,
              revision: 4,
              boundAt: '2026-08-05T10:01:00.000Z',
            };
          },
          [owner]
        );
        return {
          owner,
          ownerRevision,
          descriptors,
          sourceRefs: descriptors.map((descriptor) => ({
            grantId: descriptor.grantId,
            expectedByteLength: descriptor.byteLength,
            expectedSha256: descriptor.sha256,
          })),
          pending: false,
          hydrate: hydrateOwner,
          createDraft: createSourceDraft,
          pickSources: vi.fn(),
          grantExternalDrop: vi.fn(),
          grantWorkspaceSource: vi.fn(),
          revoke: vi.fn(),
          bindDraft: bindSourceDraft,
          reset: vi.fn(),
        };
      },
    }));
    vi.doMock('@/renderer/components/chat/TemplateGallery', () => ({
      TemplateChipCard: () => null,
      TemplateGalleryButton: () => null,
      TemplateGalleryExpanded: () => null,
      usePresentationTemplates: () => {
        const template = {
          manifest: {
            id: 'finance-review',
            name: 'Finance Review',
            description: 'Finance review deck',
            source: 'builtin' as const,
            format: 'pptx' as const,
          },
        };
        const [selectedTemplate, setSelectedTemplate] = React.useState<typeof template | null>(null);
        return {
          selectedTemplate,
          templates: [template],
          templatesLoading: false,
          galleryOpen: false,
          openGallery: vi.fn(),
          closeGallery: vi.fn(),
          toggleGallery: vi.fn(),
          selectTemplate: setSelectedTemplate,
          clearSelection: () => setSelectedTemplate(null),
          importFromDialog: vi.fn(),
          removeTemplate: vi.fn(),
          composeSend: vi.fn(),
        };
      },
    }));
    vi.doMock('@/renderer/pages/guid/hooks/useGuidInput', () => ({
      useGuidInput: () => {
        const [input, setInput] = React.useState('');
        const [files, setFiles] = React.useState<string[]>([]);
        const [dir, setDir] = React.useState('');
        const [projectId, setProjectId] = React.useState<string | undefined>(undefined);
        const [loading, setLoading] = React.useState(false);
        return {
          input,
          setInput,
          files,
          setFiles,
          dir,
          setDir,
          projectId,
          setProjectId,
          loading,
          setLoading,
          isInputFocused: false,
          isFileDragging: false,
          dragHandlers: {},
          onPaste: vi.fn(),
          handleTextareaFocus: vi.fn(),
          handleTextareaBlur: vi.fn(),
          handleFilesUploaded: vi.fn(),
          handleRemoveFile: vi.fn(),
        };
      },
    }));
    vi.doMock('@/renderer/pages/guid/hooks/useGuidAssistantSelection', () => ({
      useGuidAssistantSelection: () => ({
        selectedAssistantId: 'assistant-acp',
        selectedAssistant: { id: 'assistant-acp', agent: { type: 'acp', source: 'builtin' } },
        selectedAssistantBackend: 'claude',
        selectedMode: 'default',
        setSelectedMode: vi.fn(),
        selectedAcpModel: 'claude-opus',
        setSelectedAcpModel: vi.fn(),
        selectedThoughtLevelValue: '',
        setSelectedThoughtLevelValue: vi.fn(),
        currentAcpCachedModelInfo: null,
        currentAgentAvailableCommands: [],
        currentAgentModeOptions: [],
        currentThoughtLevelOption: null,
        setSelectedAssistantId: vi.fn(),
        assistants: [],
      }),
    }));
    vi.doMock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
      useGuidModelSelection: () => ({
        modelList: [],
        isGoogleAuth: false,
        current_model: undefined,
        setCurrentModel: vi.fn(),
        resetCurrentModel: vi.fn(),
      }),
    }));
    vi.doMock('@/renderer/pages/guid/hooks/useTypewriterPlaceholder', () => ({
      useTypewriterPlaceholder: () => '',
    }));
    vi.doMock('@/renderer/pages/guid/utils/assistantDefaults', () => ({
      resolveGuidAssistantDefaults: () => ({ disabledBuiltinSkillIds: [], skillIds: [], mcpIds: [] }),
    }));
    vi.doMock('@/renderer/components/chat/SlashCommandMenu', () => ({ default: () => null }));
    vi.doMock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
    vi.doMock('@/renderer/hooks/system/useLiveTranscriptInsertion', () => ({
      useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
    }));
    vi.doMock('@/renderer/hooks/system/useSpeechInput', () => ({
      appendSpeechTranscript: (previous: string, transcript: string) => `${previous}${transcript}`,
    }));
    vi.doMock('@/renderer/pages/guid/components/AssistantSelectionArea', () => ({ default: () => null }));
    vi.doMock('@/renderer/pages/guid/components/GuidModelSelector', () => ({ default: () => null }));
    vi.doMock('@/renderer/pages/guid/components/GuidActionRow', () => ({
      default: (props: { isButtonDisabled: boolean; onSend: () => void }) =>
        React.createElement(
          'button',
          { 'data-testid': 'guid-recovery-send', disabled: props.isButtonDisabled, onClick: props.onSend },
          'Send'
        ),
    }));
    vi.doMock('@/renderer/pages/guid/components/GuidInputCard', () => ({
      default: (props: {
        actionRow: React.ReactNode;
        input: string;
        presentationSourceDescriptors?: Array<{ displayName: string }>;
      }) =>
        React.createElement(
          'div',
          null,
          React.createElement('span', { 'data-testid': 'guid-recovery-input' }, props.input),
          ...(props.presentationSourceDescriptors ?? []).map((descriptor) =>
            React.createElement('span', { key: descriptor.displayName }, descriptor.displayName)
          ),
          props.actionRow
        ),
    }));
    vi.doMock('@icon-park/react', () => ({
      FolderOpen: () => null,
      Layers: () => null,
      Lightning: () => null,
      Paperclip: () => null,
      Star: () => null,
    }));

    const { default: GuidPage } = await import('@/renderer/pages/guid/GuidPage');
    const first = render(React.createElement(GuidPage));
    await waitFor(() => {
      expect(screen.getByTestId('guid-recovery-input')).toHaveTextContent('Restore the quarterly board review');
      expect(screen.getByText('Quarterly Revenue.xlsx')).toBeInTheDocument();
    });
    first.unmount();

    render(React.createElement(GuidPage));
    await waitFor(() => {
      expect(screen.getByTestId('guid-recovery-input')).toHaveTextContent('Restore the quarterly board review');
      expect(screen.getByText('Quarterly Revenue.xlsx')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('guid-recovery-send'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/conversation/${conversationId}`));

    expect(createDraft).toHaveBeenCalledWith(draftClientRequestId);
    expect(bindDraft).toHaveBeenCalledWith(conversationId);
    expect(startPresentationRunInvokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_request_id: clientRequestId,
        conversation_id: conversationId,
        selected_template_id: 'finance-review',
        sources: [SOURCE_REF],
      })
    );
    expect(JSON.stringify(startPresentationRunInvokeMock.mock.calls)).not.toContain('/');
    expect(readGuidPendingRaw()).toBeNull();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: originalElectronAPI });
  });
});
