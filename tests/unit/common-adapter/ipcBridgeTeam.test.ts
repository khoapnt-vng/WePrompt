/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
          body: mapBody && params !== undefined ? mapBody(params as Params) : undefined,
        });
        return (responses.has(resolvedPath) ? responses.get(resolvedPath) : { active_run: null }) as Data;
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

describe('ipcBridge team adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.calls.length = 0;
    httpBridgeMocks.responses.clear();
  });

  it('getRunState calls GET /api/teams/{team_id}/run-state', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.getRunState.invoke({ team_id: 'team-1' });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'GET',
      path: '/api/teams/team-1/run-state',
      body: undefined,
    });
  });

  // The mocked backend answers `{ active_run: null }` — the literal payload
  // older aioncore builds return, with `slot_work` absent rather than empty.
  it('getRunState hands consumers an array of slot work even when the backend omits it', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    const snapshot = await team.getRunState.invoke({ team_id: 'team-1' });

    expect(snapshot).toEqual({ session_generation: null, active_run: null, slot_work: [] });
  });

  it('sendMessage hands consumers an ack whose run carries slot work', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    const ack = await team.sendMessage.invoke({ team_id: 'team-1', input: 'hello' });

    expect(ack.run.slot_work).toEqual([]);
  });

  it('run events are mapped rather than forwarded raw', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    expect(team.runUpdated.on).toBeDefined();
    expect(httpBridgeMocks.wsMappedEmitter).toHaveBeenCalledWith('team.runUpdated', expect.any(Function));
    expect(httpBridgeMocks.wsEmitter).not.toHaveBeenCalledWith('team.runUpdated');
  });

  it('team.create posts canonical agents payload', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.create.invoke({
      user_id: 'user-1',
      name: 'Alpha',
      workspace: '/tmp/ws',
      workspace_mode: 'shared',
      agents: [
        {
          role: 'leader',
          assistant_name: 'Lead',
          assistant_id: 'assistant-lead',
          model: 'claude-sonnet-4',
        },
      ],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/teams',
      body: {
        name: 'Alpha',
        workspace: '/tmp/ws',
        agents: [
          {
            name: 'Lead',
            role: 'lead',
            model: 'claude-sonnet-4',
            assistant_id: 'assistant-lead',
          },
        ],
      },
    });
    expect(JSON.stringify(httpBridgeMocks.calls.at(-1)?.body)).not.toContain('assistants');
  });

  it('omits an empty optional workspace from the create contract', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await team.create.invoke({
      user_id: 'user-1',
      name: 'Alpha',
      workspace: '',
      workspace_mode: 'shared',
      agents: [
        {
          role: 'teammate',
          assistant_name: 'Writer',
          assistant_id: 'assistant-writer',
          model: 'claude-sonnet-4',
        },
      ],
    });

    expect(httpBridgeMocks.calls.at(-1)).toEqual({
      method: 'POST',
      path: '/api/teams',
      body: {
        name: 'Alpha',
        agents: [
          {
            name: 'Writer',
            role: 'teammate',
            model: 'claude-sonnet-4',
            assistant_id: 'assistant-writer',
          },
        ],
      },
    });
  });

  it('projects team, member, session, and cancellation identities into exact backend routes', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');
    httpBridgeMocks.responses.set('/api/teams?user_id=user%2Fone', []);
    httpBridgeMocks.responses.set('/api/teams/team-1', { id: 'team-1', agents: [] });
    httpBridgeMocks.responses.set('/api/teams/team-1/agents', {
      slot_id: 'slot-1',
      role: 'teammate',
      assistant_name: 'Writer',
    });
    httpBridgeMocks.responses.set('/api/teams/team-1/agents/slot-1/messages', { run: {} });

    await team.list.invoke({ user_id: 'user/one' });
    await team.get.invoke({ id: 'team-1' });
    await team.remove.invoke({ id: 'team-2' });
    await team.addAgent.invoke({
      team_id: 'team-1',
      assistant: {
        role: 'teammate',
        assistant_name: 'Writer',
        assistant_id: 'assistant-writer',
        model: 'claude-sonnet-4',
      },
    });
    await team.removeAgent.invoke({ team_id: 'team-1', slot_id: 'slot-2' });
    await team.stop.invoke({ team_id: 'team-1' });
    await team.ensureSession.invoke({ team_id: 'team-1' });
    await team.getConfigOptions.invoke({ team_id: 'team-1', conversation_id: 'conversation/one' });
    await team.activeLease.invoke({ team_id: 'team-1' });
    await team.renameAgent.invoke({ team_id: 'team-1', slot_id: 'slot-1', new_name: 'Editor' });
    await team.renameTeam.invoke({ id: 'team-1', name: 'Editorial' });
    await team.setSessionMode.invoke({ team_id: 'team-1', session_mode: 'coordinate' });
    await team.sendMessageToAgent.invoke({
      team_id: 'team-1',
      slot_id: 'slot-1',
      input: 'Revise the ending',
      files: ['brief.md'],
    });
    await team.cancelRun.invoke({
      team_id: 'team-1',
      team_run_id: 'run-1',
      target_slot_id: 'slot-1',
      reason: 'superseded',
    });
    await team.cancelChildTurn.invoke({
      team_id: 'team-1',
      team_run_id: 'run-1',
      slot_id: 'slot-1',
      reason: 'superseded',
    });
    await team.pauseSlotWork.invoke({
      team_id: 'team-1',
      team_run_id: 'run-1',
      slot_id: 'slot-1',
      reason: 'review',
    });

    expect(httpBridgeMocks.calls).toEqual([
      { method: 'GET', path: '/api/teams?user_id=user%2Fone', body: undefined },
      { method: 'GET', path: '/api/teams/team-1', body: undefined },
      { method: 'DELETE', path: '/api/teams/team-2', body: undefined },
      {
        method: 'POST',
        path: '/api/teams/team-1/agents',
        body: {
          assistant: {
            name: 'Writer',
            role: 'teammate',
            model: 'claude-sonnet-4',
            assistant_id: 'assistant-writer',
          },
        },
      },
      { method: 'DELETE', path: '/api/teams/team-1/agents/slot-2', body: undefined },
      { method: 'DELETE', path: '/api/teams/team-1/session', body: undefined },
      { method: 'POST', path: '/api/teams/team-1/session', body: undefined },
      {
        method: 'GET',
        path: '/api/teams/team-1/conversations/conversation%2Fone/config-options',
        body: undefined,
      },
      { method: 'POST', path: '/api/teams/team-1/active-lease', body: undefined },
      { method: 'PATCH', path: '/api/teams/team-1/agents/slot-1/name', body: { name: 'Editor' } },
      { method: 'PATCH', path: '/api/teams/team-1/name', body: { name: 'Editorial' } },
      { method: 'POST', path: '/api/teams/team-1/session-mode', body: { mode: 'coordinate' } },
      {
        method: 'POST',
        path: '/api/teams/team-1/agents/slot-1/messages',
        body: { content: 'Revise the ending', files: ['brief.md'] },
      },
      {
        method: 'POST',
        path: '/api/teams/team-1/runs/run-1/cancel',
        body: { target_slot_id: 'slot-1', reason: 'superseded' },
      },
      {
        method: 'POST',
        path: '/api/teams/team-1/runs/run-1/agents/slot-1/cancel',
        body: { reason: 'superseded' },
      },
      {
        method: 'POST',
        path: '/api/teams/team-1/runs/run-1/agents/slot-1/pause',
        body: { reason: 'review' },
      },
    ]);
  });

  it('rejects a team member whose model was not resolved before transport', async () => {
    const { team } = await import('@/common/adapter/ipcBridge');

    await expect(
      team.create.invoke({
        user_id: 'user-1',
        name: 'Invalid team',
        workspace: '/tmp/ws',
        workspace_mode: 'shared',
        agents: [
          {
            role: 'leader',
            assistant_name: 'Lead',
            assistant_id: 'assistant-lead',
            model: '',
          },
        ],
      })
    ).rejects.toThrow('no model resolved for this team slot');
  });
});

describe('ipcBridge channel adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.calls.length = 0;
    httpBridgeMocks.responses.clear();
  });

  it('normalizes legacy and current channel records while preserving canonical settings routes', async () => {
    const { channel } = await import('@/common/adapter/ipcBridge');
    httpBridgeMocks.responses.set('/api/channel/plugins', [
      {
        plugin_id: 'plugin-current',
        type: 'telegram',
        name: 'Telegram',
        enabled: true,
        connected: true,
        active_users: 2,
        has_token: true,
      },
      {
        id: 'plugin-legacy',
        plugin_type: 'slack',
        name: 'Slack',
        enabled: false,
      },
    ]);
    httpBridgeMocks.responses.set('/api/channel/pairings', [
      {
        code: 'pair-1',
        platform_user_id: 'user-1',
        platform_type: 'telegram',
        requested_at: 10,
        expires_at: 20,
      },
    ]);
    httpBridgeMocks.responses.set('/api/channel/users', [
      {
        id: 'user-1',
        platform_user_id: 'telegram-1',
        platform_type: 'telegram',
        authorized_at: 10,
      },
    ]);
    httpBridgeMocks.responses.set('/api/channel/sessions', [
      {
        id: 'session-1',
        user_id: 'user-1',
        agent_type: 'aionrs',
        chat_id: 'chat-1',
        created_at: 10,
        last_activity: 20,
      },
    ]);

    const plugins = await channel.getPluginStatus.invoke();
    const pairings = await channel.getPendingPairings.invoke();
    const users = await channel.getAuthorizedUsers.invoke();
    const sessions = await channel.getActiveSessions.invoke();
    await channel.getPlatformSettings.invoke({ platform: 'teams/enterprise' });
    await channel.setAssistantSetting.invoke({
      platform: 'teams/enterprise',
      assistant: { assistant_id: 'assistant-1' },
    } as never);
    await channel.setDefaultModelSetting.invoke({
      platform: 'teams/enterprise',
      default_model: { provider_id: 'provider-1', model: 'model-1' },
    } as never);

    expect(plugins).toEqual([
      expect.objectContaining({
        id: 'plugin-current',
        type: 'telegram',
        connected: true,
        activeUsers: 2,
        hasToken: true,
      }),
      expect.objectContaining({
        id: 'plugin-legacy',
        type: 'slack',
        connected: false,
        activeUsers: 0,
        hasToken: false,
      }),
    ]);
    expect(pairings).toEqual([
      expect.objectContaining({ code: 'pair-1', platformUserId: 'user-1', platformType: 'telegram' }),
    ]);
    expect(users).toEqual([
      expect.objectContaining({ id: 'user-1', platformUserId: 'telegram-1', platformType: 'telegram' }),
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({ id: 'session-1', user_id: 'user-1', agent_type: 'aionrs', chatId: 'chat-1' }),
    ]);
    expect(httpBridgeMocks.calls.slice(-3)).toEqual([
      { method: 'GET', path: '/api/channel/settings/teams%2Fenterprise', body: undefined },
      {
        method: 'PUT',
        path: '/api/channel/settings/teams%2Fenterprise/assistant',
        body: { assistant_id: 'assistant-1' },
      },
      {
        method: 'PUT',
        path: '/api/channel/settings/teams%2Fenterprise/default-model',
        body: { provider_id: 'provider-1', model: 'model-1' },
      },
    ]);
  });

  it('normalizes channel websocket events before renderer delivery', async () => {
    const { channel } = await import('@/common/adapter/ipcBridge');
    const pairingListener = vi.fn();
    const statusListener = vi.fn();
    const userListener = vi.fn();
    channel.pairingRequested.on(pairingListener);
    channel.pluginStatusChanged.on(statusListener);
    channel.userAuthorized.on(userListener);

    (channel.pairingRequested.emit as unknown as (raw: unknown) => void)({
      code: 'pair-1',
      platform_user_id: 'user-1',
      platform_type: 'telegram',
      requested_at: 10,
      expires_at: 20,
    });
    (channel.pluginStatusChanged.emit as unknown as (raw: unknown) => void)({
      plugin_id: 'plugin-1',
      status: { id: 'plugin-1', plugin_type: 'telegram', name: 'Telegram', enabled: true },
    });
    (channel.userAuthorized.emit as unknown as (raw: unknown) => void)({
      id: 'user-1',
      platform_user_id: 'telegram-1',
      platform_type: 'telegram',
      authorized_at: 10,
    });

    expect(pairingListener).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'pair-1', platformUserId: 'user-1', platformType: 'telegram' })
    );
    expect(statusListener).toHaveBeenCalledWith({
      plugin_id: 'plugin-1',
      status: expect.objectContaining({ id: 'plugin-1', type: 'telegram', connected: false }),
    });
    expect(userListener).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', platformUserId: 'telegram-1', platformType: 'telegram' })
    );
  });
});
