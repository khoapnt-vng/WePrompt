/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildTurnClose } from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose';
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

  it.each(['completed', 'recovered', 'partial', 'failed', 'canceled'] as const)(
    'selects the matching localized family for %s journal evidence',
    (status) => {
      expect(buildTurnClose(recap({ status }))!.key).toMatch(
        new RegExp(`^messages\\.toolActivity\\.close\\.${status}\\.v\\d$`)
      );
    }
  );

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
});
