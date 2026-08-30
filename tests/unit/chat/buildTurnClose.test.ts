/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildTurnClose,
  summarizeTurnDomainOutcomes,
} from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose';
import type { TurnWorkRecap } from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnWorkRecap';

const recap = (over: Partial<TurnWorkRecap>): TurnWorkRecap => ({
  status: 'completed',
  total: 3,
  completed: 3,
  failed: 0,
  pending: 0,
  canceled: 0,
  unfinished: 0,
  retries: 0,
  categories: [],
  ...over,
});

describe('buildTurnClose', () => {
  it('returns null while the turn is still active', () => {
    expect(buildTurnClose(recap({ status: 'active', pending: 1 }))).toBeNull();
  });

  it('returns null for a trivial single-action turn with nothing notable', () => {
    expect(buildTurnClose(recap({ status: 'completed', total: 1, completed: 1 }))).toBeNull();
  });

  it('produces a neutral completed close for a real turn', () => {
    const close = buildTurnClose(recap({ status: 'completed', total: 3, completed: 3 }));
    expect(close).not.toBeNull();
    expect(close!.tone).toBe('neutral');
    expect(close!.key).toMatch(/^messages\.toolActivity\.close\.completed\.v\d$/);
  });

  it('marks partial and failed closes as attention', () => {
    expect(buildTurnClose(recap({ status: 'partial', completed: 2, failed: 1 }))!.tone).toBe('attention');
    expect(buildTurnClose(recap({ status: 'failed', completed: 0, failed: 2 }))!.tone).toBe('attention');
  });

  it('is deterministic: same recap shape yields the same variant', () => {
    const a = buildTurnClose(recap({ status: 'completed', total: 4 }));
    const b = buildTurnClose(recap({ status: 'completed', total: 4 }));
    expect(a!.key).toBe(b!.key);
  });

  it('a single failed action is notable enough to close (not trivial)', () => {
    const close = buildTurnClose(recap({ status: 'failed', total: 1, completed: 0, failed: 1 }));
    expect(close).not.toBeNull();
    expect(close!.tone).toBe('attention');
  });

  it('keeps generic chat on the existing transport-only close path', () => {
    expect(buildTurnClose(recap({ status: 'completed', total: 1, completed: 1 }))).toBeNull();
    expect(buildTurnClose(recap({ status: 'completed' }))?.key).toMatch(
      /^messages\.toolActivity\.close\.completed\.v\d$/
    );
  });

  it.each([
    ['committed', 'committed'],
    ['pending_review', 'pendingReview'],
    ['waiting_authorization', 'waitingAuthorization'],
    ['action_required', 'actionRequired'],
    ['mixed_attention', 'mixedAttention'],
    ['needs_revision', 'needsRevision'],
    ['refused', 'refused'],
    ['unconfirmed', 'unconfirmed'],
    ['indeterminate', 'indeterminate'],
    ['observed', 'observed'],
    ['unknown', 'unknown'],
  ] as const)('uses the exact Studio close for %s', (outcome, key) => {
    expect(buildTurnClose(recap({ status: 'completed' }), undefined, outcome)).toEqual({
      key: `messages.toolActivity.close.studio.${key}`,
      tone: outcome === 'committed' || outcome === 'observed' ? 'neutral' : 'attention',
    });
  });

  it('lets failed and canceled transport outrank an optimistic Studio result', () => {
    expect(buildTurnClose(recap({ status: 'failed' }), undefined, 'committed')).toEqual({
      key: 'messages.toolActivity.close.studio.failed',
      tone: 'attention',
    });
    expect(buildTurnClose(recap({ status: 'canceled' }), undefined, 'committed')).toEqual({
      key: 'messages.toolActivity.close.studio.canceled',
      tone: 'neutral',
    });
  });

  it('keeps indeterminate Studio state ahead of transport retry guidance', () => {
    expect(buildTurnClose(recap({ status: 'canceled' }), undefined, 'unconfirmed')).toEqual({
      key: 'messages.toolActivity.close.studio.unconfirmed',
      tone: 'attention',
    });
    expect(buildTurnClose(recap({ status: 'partial' }), undefined, 'unknown')).toEqual({
      key: 'messages.toolActivity.close.studio.unknown',
      tone: 'attention',
    });
    expect(buildTurnClose(recap({ status: 'failed' }), undefined, 'unconfirmed')).toEqual({
      key: 'messages.toolActivity.close.studio.unconfirmed',
      tone: 'attention',
    });
    expect(buildTurnClose(recap({ status: 'failed' }), undefined, 'indeterminate')).toEqual({
      key: 'messages.toolActivity.close.studio.indeterminate',
      tone: 'attention',
    });
    expect(buildTurnClose(recap({ status: 'canceled' }), undefined, 'unknown')).toEqual({
      key: 'messages.toolActivity.close.studio.unknown',
      tone: 'attention',
    });
  });

  it('summarizes mixed domain outcomes conservatively', () => {
    expect(summarizeTurnDomainOutcomes([])).toBe('unknown');
    expect(summarizeTurnDomainOutcomes(['observed', 'committed'])).toBe('committed');
    expect(summarizeTurnDomainOutcomes(['committed', 'pending_review'])).toBe('pending_review');
    expect(summarizeTurnDomainOutcomes(['pending_review', 'waiting_authorization'])).toBe('action_required');
    expect(summarizeTurnDomainOutcomes(['waiting_authorization', 'failed'])).toBe('mixed_attention');
    expect(summarizeTurnDomainOutcomes(['committed', 'refused', 'failed'])).toBe('failed');
    expect(summarizeTurnDomainOutcomes(['canceled', 'unconfirmed'])).toBe('unconfirmed');
    expect(summarizeTurnDomainOutcomes(['failed', 'unknown'])).toBe('unknown');
    expect(summarizeTurnDomainOutcomes(['canceled', 'unknown'])).toBe('unknown');
    expect(summarizeTurnDomainOutcomes(['failed', 'unconfirmed'])).toBe('unconfirmed');
    expect(summarizeTurnDomainOutcomes(['failed', 'indeterminate'])).toBe('indeterminate');
  });

  it('lets a later exact command-status receipt resolve only the same earlier uncertainty', () => {
    expect(
      summarizeTurnDomainOutcomes([
        { outcome: 'unconfirmed', commandId: 'command_1' },
        { outcome: 'committed', commandId: 'command_1', resolvesCommandId: 'command_1' },
      ])
    ).toBe('committed');
    expect(
      summarizeTurnDomainOutcomes([
        { outcome: 'unconfirmed', commandId: 'command_1' },
        { outcome: 'committed', commandId: 'command_2', resolvesCommandId: 'command_2' },
      ])
    ).toBe('unconfirmed');
    expect(
      summarizeTurnDomainOutcomes([
        'failed',
        { outcome: 'committed', commandId: 'incumbent_1', resolvesCommandId: 'incumbent_1' },
      ])
    ).toBe('failed');
  });
});
