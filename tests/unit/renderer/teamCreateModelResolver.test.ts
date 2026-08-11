/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAssistantMock = vi.fn();
const listProvidersMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      get: {
        invoke: (...args: unknown[]) => getAssistantMock(...args),
      },
    },
    mode: {
      listProviders: {
        invoke: (...args: unknown[]) => listProvidersMock(...args),
      },
    },
  },
}));

import { TeamMemberModelUnresolvedError } from '@/common/adapter/teamMapper';
import { resolveDefaultTeamAgentModel } from '@/renderer/pages/team/components/teamCreateModelResolver';

describe('resolveDefaultTeamAgentModel', () => {
  beforeEach(() => {
    getAssistantMock.mockReset();
    listProvidersMock.mockReset();
    listProvidersMock.mockResolvedValue([]);
  });

  it('prefers the assistant fixed default model over agent-level fallbacks', async () => {
    getAssistantMock.mockResolvedValue({
      defaults: {
        model: { mode: 'fixed', value: 'claude-sonnet-4-5-20250514' },
      },
      preferences: {
        last_model_id: 'claude-opus-4-1-20250805',
      },
    });

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-fixed',
      })
    ).resolves.toBe('claude-sonnet-4-5-20250514');
  });

  it('uses the assistant remembered auto model before falling back to backend defaults', async () => {
    getAssistantMock.mockResolvedValue({
      defaults: {
        model: { mode: 'auto' },
      },
      preferences: {
        last_model_id: 'gemini-2.5-pro',
      },
    });

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-auto',
      })
    ).resolves.toBe('gemini-2.5-pro');
  });

  it('falls back to the assistant engine backend when no assistant-owned model is stored', async () => {
    getAssistantMock.mockResolvedValue({
      defaults: {
        model: { mode: 'auto' },
      },
      preferences: {
        last_model_id: undefined,
      },
      engine: {
        agent_id: 'cc126dd5',
        agent: {
          id: 'cc126dd5',
          type: 'acp',
          source: 'builtin',
          acp_backend: 'gemini',
        },
      },
    });

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-gemini',
      })
    ).resolves.toBe('auto');
  });

  it('uses the provided assistant backend when detail lookup fails', async () => {
    getAssistantMock.mockRejectedValue(new Error('lookup failed'));

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-gemini',
        assistant_backend: 'gemini',
      })
    ).resolves.toBe('auto');
  });

  /**
   * A freshly seeded catalog stores `default_model_mode='auto'` with no
   * `default_model_value` and no `last_model_id` for every builtin aionrs
   * assistant, so this is the *common* state, not an edge case. aionrs needs a
   * real model id: the literal 'default' resolves to no provider, aioncore
   * persists `use_model:null`, and the slot runtime never starts.
   */
  describe('aionrs assistants without a stored model', () => {
    const aionrsAssistantNeverUsed = {
      defaults: { model: { mode: 'auto' } },
      preferences: { last_model_id: undefined },
      engine: {
        agent_id: '632f31d2',
        agent: { type: 'aionrs', source: 'internal' },
      },
    };

    it('resolves the first usable provider model instead of the literal "default"', async () => {
      getAssistantMock.mockResolvedValue(aionrsAssistantNeverUsed);
      listProvidersMock.mockResolvedValue([
        { id: 'cd722893', name: 'Moonshot (Global)', platform: 'custom', models: ['kimi-k2.6', 'kimi-k3'] },
      ]);

      await expect(resolveDefaultTeamAgentModel({ assistant_id: 'aionui-assistant' })).resolves.toBe('kimi-k2.6');
    });

    it('skips disabled providers so it never picks a model the team model selector hides', async () => {
      getAssistantMock.mockResolvedValue(aionrsAssistantNeverUsed);
      listProvidersMock.mockResolvedValue([
        { id: 'disabled-1', name: 'Retired', platform: 'custom', models: ['kimi-k2.6'], enabled: false },
        { id: 'enabled-1', name: 'Moonshot', platform: 'custom', models: ['kimi-k3'], enabled: true },
      ]);

      await expect(resolveDefaultTeamAgentModel({ assistant_id: 'aionui-assistant' })).resolves.toBe('kimi-k3');
    });

    it('skips models the user disabled and image-only models that cannot drive a chat', async () => {
      getAssistantMock.mockResolvedValue(aionrsAssistantNeverUsed);
      listProvidersMock.mockResolvedValue([
        {
          id: 'openrouter-1',
          name: 'OpenRouter',
          platform: 'custom',
          models: ['google/gemini-3-pro-image', 'seed-2.0-lite'],
          model_enabled: { 'seed-2.0-lite': false },
        },
        { id: 'moonshot-1', name: 'Moonshot', platform: 'custom', models: ['kimi-k2.6'] },
      ]);

      await expect(resolveDefaultTeamAgentModel({ assistant_id: 'aionui-assistant' })).resolves.toBe('kimi-k2.6');
    });

    it('fails fast naming the cause when no provider offers a usable model', async () => {
      getAssistantMock.mockResolvedValue(aionrsAssistantNeverUsed);
      listProvidersMock.mockResolvedValue([]);

      await expect(resolveDefaultTeamAgentModel({ assistant_id: 'aionui-assistant' })).rejects.toBeInstanceOf(
        TeamMemberModelUnresolvedError
      );
    });

    it('fails fast rather than falling back to "default" when the provider lookup itself fails', async () => {
      getAssistantMock.mockResolvedValue(aionrsAssistantNeverUsed);
      listProvidersMock.mockRejectedValue(new Error('providers unavailable'));

      await expect(resolveDefaultTeamAgentModel({ assistant_id: 'aionui-assistant' })).rejects.toBeInstanceOf(
        TeamMemberModelUnresolvedError
      );
    });

    it('keeps "default" as the legal ACP sentinel, which needs no provider model', async () => {
      getAssistantMock.mockResolvedValue({
        defaults: { model: { mode: 'auto' } },
        preferences: { last_model_id: undefined },
        engine: { agent_id: '2d23ff1c', agent: { type: 'acp', source: 'builtin', acp_backend: 'claude' } },
      });

      await expect(resolveDefaultTeamAgentModel({ assistant_id: 'assistant-claude' })).resolves.toBe('default');
      expect(listProvidersMock).not.toHaveBeenCalled();
    });
  });
});
