/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IConversationTurnCompletedEvent,
  ICreateConversationParams,
  ISendMessageParams,
} from '@/common/adapter/ipcBridge';
import {
  getConversationRuntimeViewSnapshot,
  resetConversationRuntimeViewStoreForTest,
  turnCompleted,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';

type HttpCall = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
};

const httpBridgeMocks = vi.hoisted(() => {
  const calls: HttpCall[] = [];
  const responses = new Map<string, unknown>();
  const provider =
    (method: HttpCall['method']) =>
    <Data, Params = undefined>(path: string | ((params: Params) => string), mapBody?: (params: Params) => unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async (params?: Params) => {
        const resolvedPath = typeof path === 'function' ? path(params as Params) : path;
        calls.push({
          method,
          path: resolvedPath,
          body: typeof mapBody === 'function' && params !== undefined ? mapBody(params as Params) : undefined,
        });
        return (responses.has(resolvedPath) ? responses.get(resolvedPath) : true) as Data;
      }),
    });
  const emitter = () => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() });
  const mappedEmitter = <Params>(_eventName: string, transform: (raw: unknown) => Params) => {
    let listener: ((value: Params) => void) | undefined;
    return {
      on: vi.fn((next: (value: Params) => void) => {
        listener = next;
        return () => {
          if (listener === next) listener = undefined;
        };
      }),
      emit: vi.fn((raw: unknown) => listener?.(transform(raw))),
    };
  };

  return {
    calls,
    responses,
    httpGet: provider('GET'),
    httpPost: provider('POST'),
    httpPut: provider('PUT'),
    httpPatch: provider('PATCH'),
    httpDelete: provider('DELETE'),
    httpRequest: vi.fn(),
    stubProvider: vi.fn((name: string, defaultValue: unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async () => defaultValue),
    })),
    withResponseMap: vi.fn(
      (
        inner: { provider: unknown; invoke: (params?: unknown) => Promise<unknown> },
        map: (raw: unknown) => unknown
      ) => ({
        provider: inner.provider,
        invoke: vi.fn(async (params?: unknown) => map(await inner.invoke(params))),
      })
    ),
    wsEmitter: vi.fn(emitter),
    wsMappedEmitter: vi.fn(mappedEmitter),
    stubEmitter: vi.fn(emitter),
  };
});

vi.mock('@/common/adapter/httpBridge', () => httpBridgeMocks);

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildRendererQuery: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      on: vi.fn(() => vi.fn()),
      emit: vi.fn(),
    })),
  },
}));

describe('ipcBridge conversation adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.calls.length = 0;
    httpBridgeMocks.responses.clear();
    httpBridgeMocks.httpRequest.mockReset();
    resetConversationRuntimeViewStoreForTest();
  });

  it('normalizes authoritative usage from ACP metadata and AionRS finish envelopes', async () => {
    const { normalizeResponseMessage } = await import('@/common/adapter/ipcBridge');

    expect(
      normalizeResponseMessage({
        type: 'acp_context_usage',
        data: { used: 12_000, size: 32_000, _meta: { input_tokens: 10, output_tokens: 5 } },
        msg_id: 'message-1',
        turn_id: 'turn-1',
        conversation_id: 'conv-acp',
      }).provider_usage
    ).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(
      normalizeResponseMessage({
        type: 'finish',
        data: { usage: { inputTokens: 20, outputTokens: 7 } },
        msg_id: 'message-2',
        turn_id: 'turn-2',
        conversation_id: 'conv-aionrs',
      }).provider_usage
    ).toEqual({ input_tokens: 20, output_tokens: 7 });
  });

  it('keeps provider usage absent when either authoritative counter is missing', async () => {
    const { normalizeResponseMessage } = await import('@/common/adapter/ipcBridge');

    const normalized = normalizeResponseMessage({
      type: 'acp_context_usage',
      data: { used: 12_000, size: 32_000, _meta: { input_tokens: 10 } },
      msg_id: 'message-1',
      turn_id: 'turn-1',
      conversation_id: 'conv-acp',
    });

    expect(normalized).not.toHaveProperty('provider_usage');
  });

  it('deletes conversations through the standard conversation endpoint', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');

    await conversation.remove.invoke({ id: 'conv-1' });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'DELETE',
      path: '/api/conversations/conv-1',
      body: undefined,
    });
  });

  it('passes context handoff metadata through create conversation requests', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    const input: ICreateConversationParams = {
      type: 'aionrs',
      name: 'Handoff continuation',
      extra: {
        workspace: '/tmp/workspace',
        context: '# Conversation Context\n\n## Goal\nContinue safely.',
        context_file_name: 'Context.md',
        context_handoff: {
          pinned_context: [
            {
              id: 'ctx-1',
              title: 'Decision',
              content: 'Use VND millions.',
              source: 'context_md',
              created_at: 1,
              updated_at: 1,
            },
          ],
          context_file_path: '/tmp/workspace/Context.md',
          context_file_name: 'Context.md',
          last_budget_status: 'healthy',
          last_exported_at: 2,
        },
      },
    };

    await conversation.create.invoke(input);

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/conversations',
      body: {
        type: 'aionrs',
        id: undefined,
        name: 'Handoff continuation',
        assistant: undefined,
        extra: input.extra,
      },
    });
  });

  it('passes project metadata through create conversation requests', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    const input: ICreateConversationParams = {
      type: 'aionrs',
      name: 'Review June close',
      extra: {
        project_id: 'project-finance-close',
        workspace: '/Users/me/Finance Close',
        custom_workspace: true,
      },
    };

    await conversation.create.invoke(input);

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/conversations',
      body: {
        type: 'aionrs',
        id: undefined,
        name: 'Review June close',
        assistant: undefined,
        extra: input.extra,
      },
    });
  });

  it('passes pinned context through send message requests', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    const input: ISendMessageParams = {
      conversation_id: 'conv-1',
      input: 'Continue',
      files: [],
      pinned_context: [
        {
          id: 'ctx-1',
          title: 'Decision',
          content: 'Use VND millions.',
          source: 'manual',
          created_at: 1,
          updated_at: 1,
        },
      ],
    };

    await conversation.sendMessage.invoke(input);

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/conversations/conv-1/messages',
      body: {
        content: input.input,
        files: input.files,
        loading_id: undefined,
        inject_skills: undefined,
        pinned_context: input.pinned_context,
      },
    });
  });

  it('requests invisible context compaction through the dedicated conversation endpoint', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    const input = {
      conversation_id: 'conv-1',
      trigger: 'manual' as const,
      previous_snapshot: {
        goal: 'Finish the context manager',
        current_state: ['The deterministic fallback exists.'],
        decisions: [],
        artifacts: ['Context.md'],
        user_preferences: [],
        open_questions: [],
        next_steps: ['Add LLM compaction.'],
        do_not_forget: [],
      },
      previous_markdown: '# Conversation Context',
      pinned_context: [],
      last_compacted_turn_id: 'turn-3',
    };

    await conversation.compactContext.invoke(input);

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/conversations/conv-1/context/compact',
      body: {
        trigger: input.trigger,
        previous_snapshot: input.previous_snapshot,
        previous_markdown: input.previous_markdown,
        pinned_context: input.pinned_context,
        last_compacted_turn_id: input.last_compacted_turn_id,
      },
    });
  });

  it('preserves unknown outcome fields on the pinned sparse completion payload', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    let received: IConversationTurnCompletedEvent | undefined;
    const unsubscribe = conversation.turnCompleted.on((event) => {
      received = event;
    });

    (
      conversation.turnCompleted.emit as unknown as (raw: {
        user_id: string;
        conversation_id: string;
        session_id: string;
        turn_id: string;
        status: string;
        canSendMessage: boolean;
        runtime: {
          state: string;
          can_send_message: boolean;
          has_task: boolean;
          is_processing: boolean;
          pending_confirmations: number;
          turn_id: null;
        };
      }) => void
    )({
      user_id: 'user-1',
      conversation_id: 'conv-1',
      session_id: 'conv-1',
      turn_id: 'turn-failed',
      status: 'finished',
      canSendMessage: true,
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: false,
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
    });

    expect(received).toMatchObject({
      session_id: 'conv-1',
      turn_id: 'turn-failed',
      status: 'finished',
    });
    expect(received).not.toHaveProperty('state');
    expect(received).not.toHaveProperty('last_message');
    unsubscribe();
  });

  it.each([
    ['missing', {}],
    ['null', { runtime: null }],
  ])('preserves a %s completion runtime as null', async (_label, runtimePayload) => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    let received: IConversationTurnCompletedEvent | undefined;
    const unsubscribe = conversation.turnCompleted.on((event) => {
      received = event;
    });

    (conversation.turnCompleted.emit as unknown as (raw: unknown) => void)({
      session_id: 'conv-1',
      turn_id: 'turn-1',
      status: 'finished',
      ...runtimePayload,
    });

    expect(received?.runtime).toBeNull();
    unsubscribe();
  });

  it('applies a valid runtime emitted after a null completion for the same turn', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    const unsubscribe = conversation.turnCompleted.on((event) => {
      turnCompleted(event.session_id, event.turn_id, event.runtime);
    });
    const emit = conversation.turnCompleted.emit as unknown as (raw: unknown) => void;

    emit({
      session_id: 'conv-recovery',
      turn_id: 'turn-recovery',
      status: 'finished',
      runtime: null,
    });
    emit({
      session_id: 'conv-recovery',
      turn_id: 'turn-recovery',
      status: 'finished',
      runtime: {
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 0,
        turn_id: 'turn-recovery',
      },
    });

    expect(getConversationRuntimeViewSnapshot('conv-recovery')).toMatchObject({
      hydrated: true,
      state: 'running',
      canSendMessage: false,
      isProcessing: true,
      activeTurnId: 'turn-recovery',
    });
    unsubscribe();
  });

  it('projects shell and assistant identifiers into their exact backend routes and bodies', async () => {
    const { assistants, shell } = await import('@/common/adapter/ipcBridge');

    await shell.openFile.invoke('/tmp/report one.txt');
    await shell.showItemInFolder.invoke('/tmp/report one.txt');
    await shell.openExternal.invoke('https://example.test/path');
    await assistants.get.invoke({ id: 'assistant/one', locale: 'en-US' });
    await assistants.get.invoke({ id: 'assistant/two' });
    await assistants.update.invoke({ id: 'assistant-one', name: 'Updated' } as never);
    await assistants.delete.invoke({ id: 'assistant-two' });
    await assistants.setState.invoke({ id: 'assistant-three', enabled: false });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'POST', path: '/api/shell/open-file', body: { file_path: '/tmp/report one.txt' } },
      { method: 'POST', path: '/api/shell/show-item-in-folder', body: { file_path: '/tmp/report one.txt' } },
      { method: 'POST', path: '/api/shell/open-external', body: { url: 'https://example.test/path' } },
      { method: 'GET', path: '/api/assistants/assistant%2Fone?locale=en-US', body: undefined },
      { method: 'GET', path: '/api/assistants/assistant%2Ftwo', body: undefined },
      { method: 'PUT', path: '/api/assistants/assistant-one', body: undefined },
      { method: 'DELETE', path: '/api/assistants/assistant-two', body: undefined },
      { method: 'PATCH', path: '/api/assistants/assistant-three/state', body: { enabled: false } },
    ]);
  });

  it('keeps clone, update, and conversation resource payloads on their canonical HTTP contract', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    const model = {
      id: 'provider-one',
      platform: 'openai',
      name: 'Provider',
      base_url: 'https://provider.example.test',
      api_key: 'secret',
      use_model: 'model-one',
    };
    httpBridgeMocks.responses.set('/api/conversations/clone', { id: 'clone-1', type: 'aionrs' });
    httpBridgeMocks.responses.set('/api/conversations/conv-1/associated', []);
    httpBridgeMocks.responses.set('/api/cron/jobs/cron-1/conversations', []);

    await conversation.createWithConversation.invoke({
      conversation: { id: 'source-1', type: 'aionrs', model, name: 'Source' } as never,
    });
    await conversation.createWithConversation.invoke({
      conversation: { id: 'source-2', type: 'acp', model, name: 'ACP source' } as never,
    });
    await conversation.createWithConversation.invoke({
      conversation: { id: 'source-3', type: 'aionrs', name: 'Unconfigured source' } as never,
    });
    await conversation.get.invoke({ id: 'conv-1' });
    await conversation.getAssociateConversation.invoke({ conversation_id: 'conv-1' });
    await conversation.listByCronJob.invoke({ cron_job_id: 'cron-1' });
    await conversation.update.invoke({ id: 'conv-1', updates: { name: 'Renamed', model }, merge_extra: true });
    await conversation.update.invoke({ id: 'conv-2', updates: { name: 'No model' } });
    await conversation.reset.invoke({ id: 'conv-1' });
    await conversation.ensureRuntime.invoke({ conversation_id: 'conv-1' });
    await conversation.activeLease.invoke({ conversation_id: 'conv-1' });
    await conversation.stop.invoke({ conversation_id: 'conv-1', turn_id: 'turn-1' });
    await conversation.getSlashCommands.invoke({ conversation_id: 'conv-1' });
    await conversation.askSideQuestion.invoke({ conversation_id: 'conv-1', question: 'Why?' });
    await conversation.confirmMessage.invoke({
      conversation_id: 'conv-1',
      msg_id: 'message-1',
      call_id: 'call/one',
      confirm_key: 'allow',
    });
    await conversation.listArtifacts.invoke({ conversation_id: 'conv-1' });
    await conversation.updateArtifact.invoke({
      conversation_id: 'conv-1',
      artifact_id: 'artifact-1',
      status: 'saved',
    });

    expect(httpBridgeMocks.calls).toEqual([
      {
        method: 'POST',
        path: '/api/conversations/clone',
        body: {
          conversation: {
            id: 'source-1',
            type: 'aionrs',
            name: 'Source',
            model: { provider_id: 'provider-one', model: 'model-one' },
          },
        },
      },
      {
        method: 'POST',
        path: '/api/conversations/clone',
        body: { conversation: { id: 'source-2', type: 'acp', name: 'ACP source' } },
      },
      {
        method: 'POST',
        path: '/api/conversations/clone',
        body: { conversation: { id: 'source-3', type: 'aionrs', name: 'Unconfigured source' } },
      },
      { method: 'GET', path: '/api/conversations/conv-1', body: undefined },
      { method: 'GET', path: '/api/conversations/conv-1/associated', body: undefined },
      { method: 'GET', path: '/api/cron/jobs/cron-1/conversations', body: undefined },
      {
        method: 'PATCH',
        path: '/api/conversations/conv-1',
        body: {
          name: 'Renamed',
          model: { provider_id: 'provider-one', model: 'model-one' },
          merge_extra: true,
        },
      },
      {
        method: 'PATCH',
        path: '/api/conversations/conv-2',
        body: { name: 'No model', merge_extra: undefined },
      },
      { method: 'POST', path: '/api/conversations/conv-1/reset', body: undefined },
      { method: 'POST', path: '/api/conversations/conv-1/runtime/ensure', body: undefined },
      { method: 'POST', path: '/api/conversations/conv-1/active-lease', body: undefined },
      { method: 'POST', path: '/api/conversations/conv-1/cancel', body: { turn_id: 'turn-1' } },
      { method: 'GET', path: '/api/conversations/conv-1/slash-commands', body: undefined },
      { method: 'POST', path: '/api/conversations/conv-1/side-question', body: { question: 'Why?' } },
      {
        method: 'POST',
        path: '/api/conversations/conv-1/confirmations/call%2Fone/confirm',
        body: { msg_id: 'message-1', data: 'allow' },
      },
      { method: 'GET', path: '/api/conversations/conv-1/artifacts', body: undefined },
      {
        method: 'PATCH',
        path: '/api/conversations/conv-1/artifacts/artifact-1',
        body: { status: 'saved' },
      },
    ]);
  });

  it('projects workspace, confirmation, and approval options without leaking absolute paths into queries', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    httpBridgeMocks.httpRequest.mockResolvedValue([{ name: 'shot.txt', type: 'file' }]);

    const workspace = await conversation.getWorkspace.invoke({
      conversation_id: 'conv-1',
      workspace: '/studio/project-one',
      path: '/studio/project-one/assets',
      search: 'hero frame',
    });
    await conversation.getWorkspace.invoke({
      conversation_id: 'conv-1',
      workspace: '/studio/project-one',
      path: '/studio/project-one',
    });
    await conversation.confirmation.confirm.invoke({
      conversation_id: 'conv-1',
      msg_id: 'message-1',
      call_id: 'call/one',
      data: { choice: 'yes' },
    });
    await conversation.confirmation.confirm.invoke({
      conversation_id: 'conv-1',
      msg_id: 'message-2',
      call_id: 'call-two',
      data: null,
      always_allow: true,
    });
    await conversation.confirmation.list.invoke({ conversation_id: 'conv-1' });
    await conversation.approval.check.invoke({ conversation_id: 'conv-1', action: 'shell read' });
    await conversation.approval.check.invoke({
      conversation_id: 'conv-1',
      action: 'shell read',
      command_type: 'read only',
    });

    expect(workspace).toEqual([
      {
        name: 'assets',
        fullPath: '/studio/project-one/assets',
        relativePath: 'assets',
        isDir: true,
        isFile: false,
        children: [
          {
            name: 'shot.txt',
            fullPath: '/studio/project-one/assets/shot.txt',
            relativePath: 'assets/shot.txt',
            isDir: false,
            isFile: true,
          },
        ],
      },
    ]);
    expect(httpBridgeMocks.httpRequest).toHaveBeenNthCalledWith(
      1,
      'GET',
      '/api/conversations/conv-1/workspace?path=assets&search=hero%20frame'
    );
    expect(httpBridgeMocks.httpRequest).toHaveBeenNthCalledWith(2, 'GET', '/api/conversations/conv-1/workspace?path=.');
    expect(httpBridgeMocks.calls).toEqual([
      {
        method: 'POST',
        path: '/api/conversations/conv-1/confirmations/call%2Fone/confirm',
        body: { msg_id: 'message-1', data: { choice: 'yes' }, always_allow: false },
      },
      {
        method: 'POST',
        path: '/api/conversations/conv-1/confirmations/call-two/confirm',
        body: { msg_id: 'message-2', data: null, always_allow: true },
      },
      { method: 'GET', path: '/api/conversations/conv-1/confirmations', body: undefined },
      {
        method: 'GET',
        path: '/api/conversations/conv-1/approvals/check?action=shell%20read',
        body: undefined,
      },
      {
        method: 'GET',
        path: '/api/conversations/conv-1/approvals/check?action=shell%20read&command_type=read%20only',
        body: undefined,
      },
    ]);
  });

  it('preserves a workspace request rejection as an observable transport failure', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    httpBridgeMocks.httpRequest.mockRejectedValueOnce(new Error('workspace unavailable'));

    await expect(
      conversation.getWorkspace.invoke({
        conversation_id: 'conv-1',
        workspace: '/studio/project-one',
        path: '/studio/project-one/assets',
      })
    ).rejects.toThrow('workspace unavailable');
  });

  it('builds bounded message-history queries for full and default cursor requests', async () => {
    const { database } = await import('@/common/adapter/ipcBridge');
    httpBridgeMocks.responses.set('/api/conversations?cursor=cursor-1&limit=25', {
      items: [],
      total: 0,
      has_more: false,
    });
    httpBridgeMocks.responses.set('/api/conversations', { items: [], total: 0, has_more: false });
    httpBridgeMocks.responses.set('/api/messages/search?keyword=hero%20frame&page=2&page_size=10', {
      items: [],
      total: 0,
      has_more: false,
    });
    httpBridgeMocks.responses.set('/api/messages/search?keyword=empty&page=1&page_size=50', {
      items: [],
      total: 0,
      has_more: false,
    });

    await database.getConversationMessages.invoke({
      conversation_id: 'conv-1',
      limit: 50,
      before: 'before-1',
      after: 'after-1',
      anchor_message_id: 'message-1',
      content_mode: 'full',
    });
    await database.getConversationMessages.invoke({ conversation_id: 'conv-2' });
    await database.getConversationMessage.invoke({ conversation_id: 'conv-1', message_id: 'message/one' });
    await database.getUserConversations.invoke({ cursor: 'cursor-1', limit: 25 });
    await database.getUserConversations.invoke({});
    await database.searchConversationMessages.invoke({ keyword: 'hero frame', page: 2, page_size: 10 });
    await database.searchConversationMessages.invoke({ keyword: 'empty' });

    expect(httpBridgeMocks.calls.map(({ path }) => path)).toEqual([
      '/api/conversations/conv-1/messages?limit=50&before=before-1&after=after-1&anchor_message_id=message-1&content_mode=full',
      '/api/conversations/conv-2/messages',
      '/api/conversations/conv-1/messages/message%2Fone',
      '/api/conversations?cursor=cursor-1&limit=25',
      '/api/conversations',
      '/api/messages/search?keyword=hero%20frame&page=2&page_size=10',
      '/api/messages/search?keyword=empty&page=1&page_size=50',
    ]);
  });

  it('maps preview targets and client settings without renderer-only field drift', async () => {
    const { previewHistory, systemSettings, webui } = await import('@/common/adapter/ipcBridge');
    const target = {
      workspace: '/studio/project-one',
      filePath: '/studio/project-one/brief.md',
      contentType: 'markdown' as const,
    };

    await previewHistory.list.invoke({ target } as never);
    await previewHistory.save.invoke({ target, content: '# Brief' } as never);
    await previewHistory.getContent.invoke({ target, snapshot_id: 'snapshot-1' } as never);
    await systemSettings.setNotificationEnabled.invoke({ enabled: true });
    await systemSettings.setCronNotificationEnabled.invoke({ enabled: false });
    await systemSettings.setKeepAwake.invoke({ enabled: true });
    await systemSettings.changeLanguage.invoke({ language: 'en-US' });
    await systemSettings.setSaveUploadToWorkspace.invoke({ enabled: false });
    await systemSettings.setAutoPreviewOfficeFiles.invoke({ enabled: true });
    await webui.changePassword.invoke({ newPassword: 'new password' });
    await webui.changeUsername.invoke({ newUsername: 'director' });

    expect(httpBridgeMocks.calls).toEqual([
      {
        method: 'POST',
        path: '/api/preview-history/list',
        body: {
          target: {
            workspace: target.workspace,
            filePath: target.filePath,
            contentType: undefined,
            content_type: 'markdown',
          },
        },
      },
      {
        method: 'POST',
        path: '/api/preview-history/save',
        body: {
          target: {
            workspace: target.workspace,
            filePath: target.filePath,
            contentType: undefined,
            content_type: 'markdown',
          },
          content: '# Brief',
        },
      },
      {
        method: 'POST',
        path: '/api/preview-history/get-content',
        body: {
          target: {
            workspace: target.workspace,
            filePath: target.filePath,
            contentType: undefined,
            content_type: 'markdown',
          },
          snapshot_id: 'snapshot-1',
        },
      },
      { method: 'PUT', path: '/api/settings/client', body: { notificationEnabled: true } },
      { method: 'PUT', path: '/api/settings/client', body: { cronNotificationEnabled: false } },
      { method: 'PUT', path: '/api/settings/client', body: { keepAwake: true } },
      { method: 'PATCH', path: '/api/settings', body: { language: 'en-US' } },
      { method: 'PUT', path: '/api/settings/client', body: { saveUploadToWorkspace: false } },
      { method: 'PUT', path: '/api/settings/client', body: { autoPreviewOfficeFiles: true } },
      { method: 'POST', path: '/api/webui/change-password', body: { new_password: 'new password' } },
      { method: 'POST', path: '/api/webui/change-username', body: { new_username: 'director' } },
    ]);
  });

  it('reads present and absent client settings through the backend query contract', async () => {
    const { systemSettings } = await import('@/common/adapter/ipcBridge');
    httpBridgeMocks.httpRequest.mockResolvedValueOnce({ keepAwake: true }).mockResolvedValueOnce(undefined);

    await expect(systemSettings.getKeepAwake.invoke()).resolves.toBe(true);
    await expect(systemSettings.getKeepAwake.invoke()).resolves.toBeUndefined();
    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledTimes(2);
    expect(httpBridgeMocks.httpRequest).toHaveBeenCalledWith('GET', '/api/settings/client?keys=keepAwake');
  });
});
