/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  assistantToOption,
  filterTeamSupportedAssistants,
  resolveTeamAssistantLabel,
  resolveTeamMemberLabel,
  teamAssistantMatchesQuery,
} from '@/renderer/pages/team/components/assistantSelectUtils';
import type { Assistant } from '@/common/types/agent/assistantTypes';

describe('assistantSelectUtils', () => {
  it('localizes assistant option names for the active locale', () => {
    const bareAssistant = makeAssistant({
      id: 'bare-aionrs',
      name: 'Aion CLI',
      name_i18n: { 'zh-CN': 'Aion 命令行' },
      source: 'generated',
      preset_agent_type: 'aionrs',
    });

    const option = assistantToOption(bareAssistant, 'zh-CN');

    expect(option.name).toBe('Aion 命令行');
  });

  it('preserves backend-provided team availability for selectable assistants', () => {
    const remoteAssistant = makeAssistant({
      id: 'bare-remote',
      name: 'Remote Runner',
      source: 'generated',
      preset_agent_type: 'remote',
      team_selectable: true,
      team_block_reason: undefined,
    });

    const [option] = filterTeamSupportedAssistants([assistantToOption(remoteAssistant)]);

    expect(option.team_selectable).toBe(true);
    expect(option.team_block_reason).toBeUndefined();
  });

  it('keeps unchecked assistants selectable when backend projection allows team use', () => {
    const assistant = makeAssistant({
      id: 'unchecked',
      name: 'Unchecked',
      source: 'generated',
      preset_agent_type: 'aionrs',
      agent_status: 'unchecked',
      team_selectable: true,
    });

    const option = assistantToOption(assistant);

    expect(option.team_selectable).toBe(true);
  });

  /**
   * The picker row renders the Forge brand name while `option.name` keeps the
   * real catalog name so persisted team records stay stable. Any user-facing
   * string built from an option must therefore go through this helper, or it
   * names an assistant by a name that appears nowhere in the UI.
   */
  describe('resolveTeamAssistantLabel', () => {
    const t = ((key: string) =>
      ({ 'agent.brand.forgeChat': 'Forge Chat', 'agent.brand.forgeAssistant': 'Forge Assistant' })[key] ??
      key) as unknown as TFunction;

    it('renders the Forge brand name for a rebranded built-in', () => {
      expect(
        resolveTeamAssistantLabel(
          { id: 'aionui-assistant', name: 'AionUi Butler', brandKey: 'agent.brand.forgeAssistant' },
          t
        )
      ).toBe('Forge Assistant');
    });

    it('falls back to the catalog name when the assistant is not rebranded', () => {
      expect(resolveTeamAssistantLabel({ id: 'blocked-reviewer', name: 'Reviewer', brandKey: null }, t)).toBe(
        'Reviewer'
      );
    });

    it('falls back to the catalog name when no brand key is present at all', () => {
      expect(resolveTeamAssistantLabel({ id: 'custom-1', name: 'Scriptwriter' }, t)).toBe('Scriptwriter');
    });
  });

  /**
   * A team member's `assistant_name` is persisted at create time and is also
   * what `team.renameAgent` overwrites. So the brand label may only replace it
   * while it is still the untouched catalog name — a name the user typed
   * themselves always wins.
   */
  describe('resolveTeamMemberLabel', () => {
    const t = ((key: string) =>
      ({ 'agent.brand.forgeAssistant': 'WePrompt Assistant' })[key] ?? key) as unknown as TFunction;
    const options = [
      { id: 'aionui-assistant', name: 'AionUi Butler', brandKey: 'agent.brand.forgeAssistant' as const },
      { id: 'custom-1', name: 'Scriptwriter', brandKey: null },
    ];

    it('replaces the untouched catalog name with the brand label', () => {
      expect(
        resolveTeamMemberLabel({ assistant_id: 'aionui-assistant', assistant_name: 'AionUi Butler' }, options, t)
      ).toBe('WePrompt Assistant');
    });

    it('keeps a name the user typed via rename, never overriding it with the brand', () => {
      expect(
        resolveTeamMemberLabel({ assistant_id: 'aionui-assistant', assistant_name: 'Research Lead' }, options, t)
      ).toBe('Research Lead');
    });

    it('uses the brand label when the slot carries no name at all', () => {
      expect(resolveTeamMemberLabel({ assistant_id: 'aionui-assistant', assistant_name: '' }, options, t)).toBe(
        'WePrompt Assistant'
      );
    });

    it('keeps the persisted name for assistants that are not rebranded', () => {
      expect(resolveTeamMemberLabel({ assistant_id: 'custom-1', assistant_name: 'Scriptwriter' }, options, t)).toBe(
        'Scriptwriter'
      );
    });

    it('keeps the persisted name when the assistant is gone from the catalog', () => {
      expect(resolveTeamMemberLabel({ assistant_id: 'deleted-9', assistant_name: 'AionUi Butler' }, options, t)).toBe(
        'AionUi Butler'
      );
    });

    it('keeps the persisted name when the slot predates assistant identity', () => {
      expect(resolveTeamMemberLabel({ assistant_name: 'AionUi Butler' }, options, t)).toBe('AionUi Butler');
    });
  });

  /**
   * Search must match what the row displays. Filtering on the catalog name
   * alone means typing the visible brand name finds nothing.
   */
  describe('teamAssistantMatchesQuery', () => {
    const t = ((key: string) =>
      ({ 'agent.brand.forgeAssistant': 'WePrompt Assistant' })[key] ?? key) as unknown as TFunction;
    const butler = { id: 'aionui-assistant', name: 'AionUi Butler', brandKey: 'agent.brand.forgeAssistant' as const };

    it('matches the brand label the row actually shows', () => {
      expect(teamAssistantMatchesQuery(butler, 'weprompt', t)).toBe(true);
    });

    it('still matches the catalog name, so existing habits keep working', () => {
      expect(teamAssistantMatchesQuery(butler, 'aionui', t)).toBe(true);
    });

    it('does not match unrelated text', () => {
      expect(teamAssistantMatchesQuery(butler, 'scriptwriter', t)).toBe(false);
    });

    it('treats an empty query as matching everything', () => {
      expect(teamAssistantMatchesQuery(butler, '   ', t)).toBe(true);
    });
  });
});

function makeAssistant(
  overrides: Partial<Assistant> & Pick<Assistant, 'id' | 'name' | 'source' | 'preset_agent_type'>
): Assistant {
  return {
    id: overrides.id,
    source: overrides.source,
    name: overrides.name,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    preset_agent_type: overrides.preset_agent_type,
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    avatar: undefined,
    agent_status: 'online',
    team_selectable: true,
    team_block_reason: undefined,
    deletable: false,
    ...overrides,
  };
}
