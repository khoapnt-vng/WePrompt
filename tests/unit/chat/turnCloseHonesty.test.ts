/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The turn close is app-authored, not agent prose, and it is chosen from `recap.status` alone.
 * That status is derived from transport counts — `completed` means every tool call returned
 * without an error, and nothing more. It carries no signal that the turn achieved what the person
 * asked for, so the close must not claim it did.
 *
 * BUG-162: a Director turn that recorded a proposal and changed nothing still closed with
 * "All done — everything went through as planned", because every tool call had returned cleanly.
 */

const enUs = (): Record<string, string> => {
  const messages = JSON.parse(
    readFileSync(join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales/en-US/messages.json'), 'utf8')
  ) as { toolActivity: { close: { completed: Record<string, string> } } };
  return messages.toolActivity.close.completed;
};

/** Phrases that assert the goal was met, which the recap cannot know. */
const OVERCLAIMS = [
  /as planned/i,
  /\bworking\b/i,
  /came together/i,
  /\bsuccessful/i,
  /\bsucceeded\b/i,
  /everything (?:went|worked)/i,
  /\ball sorted\b/i,
];

describe('turn close honesty', () => {
  it('has completed variants to check, so a rename never silently empties this guard', () => {
    const variants = Object.values(enUs());
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((copy) => copy.trim().length > 0)).toBe(true);
  });

  it('never claims the turn achieved anything, only that its steps ran without failing', () => {
    const offenders: string[] = [];
    for (const [variant, copy] of Object.entries(enUs())) {
      for (const overclaim of OVERCLAIMS) {
        if (overclaim.test(copy)) offenders.push(`${variant}: ${overclaim.source} → ${copy}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still reads as a completion, which is what the journal design asks of it', () => {
    // MessageToolGroupSummary asserts a warm close with /done|finished|came together/i, and
    // "came together" is an overclaim, so every variant must carry one of the other two.
    for (const [variant, copy] of Object.entries(enUs())) {
      expect(/\bdone\b|\bfinished\b/i.test(copy), `${variant}: ${copy}`).toBe(true);
    }
  });
});
