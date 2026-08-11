/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  fromBackendAssistant,
  fromBackendTeam,
  fromBackendTeamRunAck,
  fromBackendTeamRunEvent,
  fromBackendTeamRunState,
  normalizeTeamStatus,
  TeamMemberModelUnresolvedError,
  toBackendAssistant,
} from '@/common/adapter/teamMapper';

describe('teamMapper', () => {
  describe('normalizeTeamStatus', () => {
    it.each([
      ['pending', 'pending'],
      ['idle', 'idle'],
      ['working', 'active'],
      ['thinking', 'active'],
      ['tool_use', 'active'],
      ['completed', 'completed'],
      ['error', 'failed'],
      ['unknown', 'idle'],
      [undefined, 'idle'],
    ] as const)('maps backend status %s to UI status %s', (raw, expected) => {
      expect(normalizeTeamStatus(raw)).toBe(expected);
    });
  });

  it('uses normalized status when mapping backend agents', () => {
    const assistant = fromBackendAssistant({
      slot_id: 'slot-1',
      conversation_id: 'conversation-1',
      role: 'teammate',
      backend: 'claude',
      name: 'Worker',
      status: 'thinking',
    });

    expect(assistant.status).toBe('active');
  });

  it('maps backend agent fields into assistant-first frontend runtime fields', () => {
    const assistant = fromBackendAssistant({
      slot_id: 'slot-1',
      conversation_id: 'conversation-1',
      role: 'teammate',
      assistant_backend: 'codex',
      backend: 'claude',
      assistant_name: 'Writer',
      agent_type: 'claude',
      agent_name: 'Worker',
      status: 'idle',
    });

    expect(assistant.assistant_backend).toBe('codex');
    expect(assistant.assistant_name).toBe('Writer');
    expect(assistant).not.toHaveProperty('agent_type');
    expect(assistant).not.toHaveProperty('agent_name');
  });

  it('prefers assistant-first team response fields while keeping legacy aliases hydrated', () => {
    const team = fromBackendTeam({
      id: 'team-1',
      name: 'Alpha',
      workspace: '/tmp/ws',
      workspace_mode: 'shared',
      leader_assistant_id: 'slot-lead',
      assistants: [
        {
          slot_id: 'slot-lead',
          conversation_id: 'conv-1',
          role: 'leader',
          assistant_backend: 'codex',
          assistant_name: 'Lead',
          status: 'idle',
        },
      ],
      created_at: 1,
      updated_at: 2,
    });

    expect(team.leader_assistant_id).toBe('slot-lead');
    expect(team.leader_agent_id).toBe('slot-lead');
    expect(team.assistants).toHaveLength(1);
    expect(team.agents).toHaveLength(1);
  });

  it('prefers the concrete backend over generic agent_type when hydrating assistant runtime fields', () => {
    const assistant = fromBackendAssistant({
      slot_id: 'slot-1',
      conversation_id: 'conversation-1',
      role: 'teammate',
      backend: 'claude',
      agent_type: 'acp',
      agent_name: 'Worker',
      status: 'idle',
    });

    expect(assistant.assistant_backend).toBe('claude');
    expect(assistant).not.toHaveProperty('conversation_type');
  });

  it('hydrates assistant identity from assistant_id', () => {
    expect(
      fromBackendAssistant({
        slot_id: 'slot-1',
        conversation_id: 'conversation-1',
        role: 'teammate',
        backend: 'aionrs',
        name: 'Worker',
        assistant_id: 'assistant-1',
      }).assistant_id
    ).toBe('assistant-1');
  });

  it('ignores legacy custom_agent_id when assistant_id is absent from the backend payload', () => {
    expect(
      fromBackendAssistant({
        slot_id: 'slot-2',
        conversation_id: 'conversation-2',
        role: 'teammate',
        backend: 'aionrs',
        name: 'Worker',
        custom_agent_id: 'assistant-legacy',
      }).assistant_id
    ).toBeUndefined();
  });

  it('preserves assistant identity when serializing agents back to the backend payload', () => {
    expect(
      toBackendAssistant({
        role: 'leader',
        assistant_backend: 'aionrs',
        assistant_name: 'Aion CLI',
        status: 'pending',
        assistant_id: 'assistant-1',
        model: 'kimi-k2.6',
      })
    ).toMatchObject({
      name: 'Aion CLI',
      role: 'lead',
      assistant_id: 'assistant-1',
      model: 'kimi-k2.6',
    });
  });

  /**
   * This mapper used to substitute the literal 'default' for a missing model.
   * For aionrs that value resolves to no provider, so the slot was persisted
   * with `use_model:null` and its runtime died during warmup with an empty
   * error — 13ms after create, far from the caller that forgot the model.
   */
  it('rejects team payloads whose model was never resolved instead of substituting a placeholder', () => {
    expect(() =>
      toBackendAssistant({
        role: 'leader',
        assistant_backend: 'aionrs',
        assistant_name: 'Aion CLI',
        status: 'pending',
        assistant_id: 'assistant-1',
      })
    ).toThrow(TeamMemberModelUnresolvedError);
  });

  it('passes an explicitly chosen model through verbatim, including the ACP "default" sentinel', () => {
    expect(
      toBackendAssistant({
        role: 'teammate',
        assistant_backend: 'claude',
        assistant_name: 'Claude Code',
        status: 'pending',
        assistant_id: 'assistant-claude',
        model: 'default',
      })
    ).toMatchObject({ model: 'default' });
  });

  it('omits backend for new assistant-led payloads so the backend can derive it from assistant identity', () => {
    expect(
      toBackendAssistant({
        role: 'teammate',
        assistant_backend: 'codex',
        assistant_name: 'Writer',
        status: 'pending',
        assistant_id: 'assistant-writer',
        model: 'gpt-5',
      })
    ).not.toHaveProperty('backend');
  });

  it('rejects new team payloads without assistant identity', () => {
    expect(() =>
      toBackendAssistant({
        role: 'teammate',
        assistant_backend: 'acp',
        assistant_name: 'Legacy Worker',
        status: 'pending',
        model: 'claude',
      })
    ).toThrow('assistant_id is required');
  });

  // Older aioncore builds omit `slot_work` / `session_generation` from run
  // payloads entirely, so these fields arrive absent rather than empty.
  describe('run payload normalization', () => {
    const slotWork = {
      slot_id: 'lead',
      role: 'lead',
      state: 'running',
      queued_foreground_count: 0,
      queued_background_count: 0,
      active_turn_id: null,
      active_turn_started_at_ms: null,
      active_turn_elapsed_ms: null,
      active_turn_slow: null,
      active_turn_slow_threshold_ms: null,
      blocked_reason: null,
      team_run_id: 'run-1',
    };

    describe('fromBackendTeamRunState', () => {
      it('fills in slot work and session generation the backend never sent', () => {
        expect(fromBackendTeamRunState({ active_run: null })).toEqual({
          session_generation: null,
          active_run: null,
          slot_work: [],
        });
      });

      it('preserves slot work the backend did send', () => {
        const snapshot = fromBackendTeamRunState({
          session_generation: 'generation-2',
          active_run: null,
          slot_work: [slotWork],
        });

        expect(snapshot.slot_work).toEqual([slotWork]);
        expect(snapshot.session_generation).toBe('generation-2');
      });

      it('normalizes slot work nested inside an active run', () => {
        const snapshot = fromBackendTeamRunState({ active_run: { team_id: 'team-1', team_run_id: 'run-1' } });

        expect(snapshot.active_run?.slot_work).toEqual([]);
        expect(snapshot.active_run?.team_run_id).toBe('run-1');
      });

      it.each([
        ['an empty response body', undefined],
        ['a null response body', null],
        ['a non-array slot_work', { active_run: null, slot_work: 'unexpected' }],
      ])('yields a usable snapshot for %s', (_label, raw) => {
        expect(fromBackendTeamRunState(raw)).toEqual({
          session_generation: null,
          active_run: null,
          slot_work: [],
        });
      });
    });

    describe('fromBackendTeamRunEvent', () => {
      it('defaults absent slot work to an empty array', () => {
        expect(fromBackendTeamRunEvent({ team_id: 'team-1', status: 'running' })).toEqual({
          team_id: 'team-1',
          status: 'running',
          slot_work: [],
        });
      });

      it.each([
        ['null', null],
        ['undefined', undefined],
      ])('defaults %s slot work to an empty array', (_label, slot_work) => {
        expect(fromBackendTeamRunEvent({ team_id: 'team-1', slot_work }).slot_work).toEqual([]);
      });

      it('keeps slot work the backend did send', () => {
        expect(fromBackendTeamRunEvent({ team_id: 'team-1', slot_work: [slotWork] }).slot_work).toEqual([slotWork]);
      });
    });

    describe('fromBackendTeamRunAck', () => {
      it('normalizes the run nested in an ack', () => {
        const ack = fromBackendTeamRunAck({
          enqueue_status: 'queued',
          message_id: 'message-1',
          run: { team_id: 'team-1', team_run_id: 'run-1' },
        });

        expect(ack.run.slot_work).toEqual([]);
        expect(ack.enqueue_status).toBe('queued');
      });

      it('yields a run object even when the ack has no run at all', () => {
        expect(fromBackendTeamRunAck({ enqueue_status: 'accepted' }).run.slot_work).toEqual([]);
      });
    });
  });
});
