/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest';

import {
  PresentationScopeResolver,
  type PresentationScopeResolverOptions,
} from '@/process/services/presentation-template/run/service';

const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const SHORT_CONVERSATION_ID = 'd0921953';
const PRINCIPAL_ID = 'desktop-local-principal';
const TEAM_USER_ID = 'system_default_user';

const conversation = (type: string = 'aionrs', workspace: unknown = '/workspace', id: string = CONVERSATION_ID) => ({
  id,
  type,
  extra: { workspace },
});

const team = (conversationIds: readonly string[], userId: string = TEAM_USER_ID) => ({
  id: 'team-1',
  user_id: userId,
  assistants: conversationIds.map((conversation_id, index) => ({
    slot_id: `slot-${index}`,
    conversation_id,
  })),
});

function createHarness(overrides: Partial<PresentationScopeResolverOptions> = {}) {
  const getConversation = vi.fn(async () => conversation());
  const listTeams = vi.fn(async () => []);
  const classifyLookupError = vi.fn((error: unknown) => {
    if (error === 'forbidden') return 'RUN_FORBIDDEN' as const;
    if (error === 'missing') return 'RUN_NOT_FOUND' as const;
    return null;
  });
  const resolver = new PresentationScopeResolver({
    getConversation,
    listTeams,
    classifyLookupError,
    teamUserId: TEAM_USER_ID,
    ...overrides,
  });
  return { resolver, getConversation, listTeams, classifyLookupError };
}

describe('PresentationScopeResolver', () => {
  it('is exported from the main-process presentation service boundary', async () => {
    const serviceModule = await import('@/process/services/presentation-template/run/service');

    expect(Reflect.get(serviceModule, 'PresentationScopeResolver')).toBeTypeOf('function');
  });

  it.each(['aionrs', 'acp'] as const)('resolves an authoritative individual %s conversation', async (runtime) => {
    const harness = createHarness({ getConversation: async () => conversation(runtime) });

    await expect(
      harness.resolver.resolve({ conversationId: CONVERSATION_ID, principalId: PRINCIPAL_ID })
    ).resolves.toEqual({
      ok: true,
      conversationId: CONVERSATION_ID,
      principalId: PRINCIPAL_ID,
      scope: 'individual',
      runtime,
      workspace: '/workspace',
    });
    expect(harness.listTeams).toHaveBeenCalledWith({ userId: TEAM_USER_ID });
  });

  it('classifies team ownership only from authoritative assistants membership', async () => {
    const harness = createHarness({
      getConversation: async () => ({ ...conversation(), isTeamSend: false, team_id: null }),
      listTeams: async () => [team([CONVERSATION_ID])],
    });

    await expect(
      harness.resolver.resolve({ conversationId: CONVERSATION_ID, principalId: PRINCIPAL_ID })
    ).resolves.toMatchObject({
      ok: true,
      scope: 'team',
    });
  });

  it('canonicalizes a backend conversation id across lookup, record, and team authority', async () => {
    const getConversation = vi.fn(async () =>
      conversation('aionrs', '/workspace', SHORT_CONVERSATION_ID.toUpperCase())
    );
    const harness = createHarness({
      getConversation,
      listTeams: async () => [team([SHORT_CONVERSATION_ID.toUpperCase()])],
    });

    await expect(
      harness.resolver.resolve({ conversationId: SHORT_CONVERSATION_ID.toUpperCase(), principalId: PRINCIPAL_ID })
    ).resolves.toEqual({
      ok: true,
      conversationId: SHORT_CONVERSATION_ID,
      principalId: PRINCIPAL_ID,
      scope: 'team',
      runtime: 'aionrs',
      workspace: '/workspace',
    });
    expect(getConversation).toHaveBeenCalledWith({ conversationId: SHORT_CONVERSATION_ID });
  });

  it('accepts the unambiguous legacy agents transport alias as authoritative membership', async () => {
    const authoritativeTeam = team([CONVERSATION_ID]);
    const { assistants, ...rawTeam } = authoritativeTeam;
    const harness = createHarness({
      listTeams: async () => [{ ...rawTeam, agents: assistants }],
    });

    await expect(
      harness.resolver.resolve({ conversationId: CONVERSATION_ID, principalId: PRINCIPAL_ID })
    ).resolves.toMatchObject({
      ok: true,
      scope: 'team',
    });
  });

  it('preserves an unsupported runtime for the service policy to reject', async () => {
    const harness = createHarness({ getConversation: async () => conversation('codex') });

    await expect(
      harness.resolver.resolve({ conversationId: CONVERSATION_ID, principalId: PRINCIPAL_ID })
    ).resolves.toMatchObject({
      ok: true,
      runtime: 'codex',
    });
  });

  it('withholds a missing or non-absolute workspace without weakening conversation scope', async () => {
    const harness = createHarness({ getConversation: async () => conversation('acp', '../foreign') });

    await expect(
      harness.resolver.resolve({ conversationId: CONVERSATION_ID, principalId: PRINCIPAL_ID })
    ).resolves.toMatchObject({
      ok: true,
      workspace: null,
    });
  });

  it.each([
    ['enumeration rejection', async () => Promise.reject(new Error('offline'))],
    ['non-array enumeration', async () => ({})],
    ['foreign principal enumeration', async () => [team([], 'another-user')]],
    ['missing assistants enumeration', async () => [{ id: 'team-1', user_id: TEAM_USER_ID }]],
    [
      'ambiguous assistants and agents aliases',
      async () => [{ ...team([CONVERSATION_ID]), agents: team([CONVERSATION_ID]).assistants }],
    ],
    ['malformed assistant conversation id', async () => [team(['../foreign'])]],
    [
      'ambiguous duplicate membership',
      async () => [team([CONVERSATION_ID]), { ...team([CONVERSATION_ID]), id: 'team-2' }],
    ],
  ] as const)('fails closed when %s cannot prove owner-to-team scope', async (_reason, listTeams) => {
    const harness = createHarness({ listTeams });

    await expect(
      harness.resolver.resolve({ conversationId: CONVERSATION_ID, principalId: PRINCIPAL_ID })
    ).resolves.toEqual({
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
    });
  });

  it.each([
    ['forbidden', 'RUN_FORBIDDEN'],
    ['missing', 'RUN_NOT_FOUND'],
    ['offline', 'SCOPE_UNAVAILABLE'],
  ] as const)('maps an authoritative conversation lookup %s before team enumeration', async (error, code) => {
    const harness = createHarness({ getConversation: async () => Promise.reject(error) });

    await expect(
      harness.resolver.resolve({ conversationId: CONVERSATION_ID, principalId: PRINCIPAL_ID })
    ).resolves.toEqual({
      ok: false,
      code,
    });
    expect(harness.listTeams).not.toHaveBeenCalled();
  });

  it.each([
    ['path-shaped request id', '../foreign', conversation()],
    ['foreign conversation response', CONVERSATION_ID, { ...conversation(), id: OTHER_CONVERSATION_ID }],
    ['missing conversation runtime', CONVERSATION_ID, { id: CONVERSATION_ID, extra: { workspace: '/workspace' } }],
    ['non-object conversation extra', CONVERSATION_ID, { id: CONVERSATION_ID, type: 'aionrs', extra: null }],
  ] as const)('fails closed for %s before accepting scope', async (_reason, conversationId, response) => {
    const harness = createHarness({ getConversation: async () => response });

    await expect(harness.resolver.resolve({ conversationId, principalId: PRINCIPAL_ID })).resolves.toEqual({
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
    });
  });
});
