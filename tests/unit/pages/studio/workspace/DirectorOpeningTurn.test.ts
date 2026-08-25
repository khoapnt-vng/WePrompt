/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DIRECTOR_PRESET_RULES,
  directorOpeningTurn,
  directorOpeningTurnStorageKey,
  seedDirectorOpeningTurn,
} from '@/renderer/pages/studio/components/Workspace/DirectorRail/openingTurn';

/** A storage double. jsdom's Storage is a Proxy, so spying on the real one silently no-ops. */
const storageDouble = (): Storage & { written: Record<string, string> } => {
  const written: Record<string, string> = {};
  return {
    written,
    getItem: (key: string) => written[key] ?? null,
    setItem: (key: string, value: string) => {
      written[key] = value;
    },
    removeItem: (key: string) => {
      delete written[key];
    },
    clear: () => {
      for (const key of Object.keys(written)) delete written[key];
    },
    key: () => null,
    length: 0,
  } as Storage & { written: Record<string, string> };
};

describe('the Director opening turn', () => {
  it('carries the brief the person typed into the composer', () => {
    expect(directorOpeningTurn('  A dog finds a lost shoe  ')).toBe('A dog finds a lost shoe');
  });

  it('has nothing to say when the brief is blank', () => {
    // A project can reach the rail with an empty brief through paths the composer does not own.
    // Sending an empty turn would spend a Director turn to say nothing.
    expect(directorOpeningTurn('')).toBeNull();
    expect(directorOpeningTurn('   \n  ')).toBeNull();
  });

  it('seeds under the key AionrsSendBox actually reads', () => {
    // The key template is written out by hand in two other files. A third hand-written copy that
    // drifts would seed a key nobody reads, and the failure is silent: no opening turn, no error.
    const consumer = readFileSync(
      resolve(process.cwd(), 'packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx'),
      'utf8'
    );
    const template = /`([a-z_]+)\$\{conversation_id\}`/.exec(consumer);
    expect(template, 'AionrsSendBox no longer builds the key this way').not.toBeNull();
    expect(directorOpeningTurnStorageKey('conv_1')).toBe(`${template![1]}conv_1`);
  });

  it('writes a payload the consumer can parse', () => {
    const storage = storageDouble();
    expect(seedDirectorOpeningTurn('conv_1', 'A dog finds a lost shoe', storage)).toBe(true);
    const raw = storage.written[directorOpeningTurnStorageKey('conv_1')];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toEqual({ input: 'A dog finds a lost shoe' });
  });

  it('does not seed a blank brief', () => {
    const storage = storageDouble();
    expect(seedDirectorOpeningTurn('conv_1', '   ', storage)).toBe(false);
    expect(Object.keys(storage.written)).toHaveLength(0);
  });

  it('reports failure rather than throwing when storage refuses the write', () => {
    // A rail that cannot seed must still attach. Losing the opening turn costs a retype; throwing
    // here would lose the Director entirely.
    const refusing = {
      ...storageDouble(),
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    } as unknown as Storage;
    expect(() => seedDirectorOpeningTurn('conv_1', 'A dog finds a lost shoe', refusing)).not.toThrow();
    expect(seedDirectorOpeningTurn('conv_1', 'A dog finds a lost shoe', refusing)).toBe(false);
  });
});

describe('the Director preset rules', () => {
  it('tells the Director to ask before it builds', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/ask/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/before/i);
  });

  it('names the two tools it must not reach for unprompted', () => {
    // Naming them is what makes the instruction actionable; "do not act" alone is advice.
    expect(DIRECTOR_PRESET_RULES).toContain('studio_apply_edits');
    expect(DIRECTOR_PRESET_RULES).toContain('propose_storyboard');
  });

  it('leaves the free reads free, so asking well is not also blocked', () => {
    expect(DIRECTOR_PRESET_RULES).toContain('read_storyboard');
  });

  it('keeps a recorded proposal pending until a later read proves human acceptance', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/pending human review/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/never claim.*applied/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/cannot approve or reject your own proposal/i);
  });

  it('spells out the ordered app-owned approved-reference workflow', () => {
    const orderedSteps = [
      'Call read_storyboard at the agreed revision',
      'set_reference_plan through studio_apply_edits',
      'Request character reference images first',
      'approve character candidates',
      'request background reference images',
      'approve background candidates',
      'Call read_storyboard again',
      'set_shot_reference_binding through studio_apply_edits',
    ];
    let previous = -1;
    for (const step of orderedSteps) {
      const index = DIRECTOR_PRESET_RULES.indexOf(step);
      expect(index, step).toBeGreaterThan(previous);
      previous = index;
    }
    expect(DIRECTOR_PRESET_RULES).toMatch(/do not invent\s+reference IDs/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/app owns them/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/request only records work for human review; it does not\s+generate media/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/approve_reference is\s+human-only and renderer-only/i);
    expect(DIRECTOR_PRESET_RULES).toMatch(/once for\s+each active Shot/i);
  });

  it('answers in the language the person writes in, since the rules themselves are English', () => {
    expect(DIRECTOR_PRESET_RULES).toMatch(/language/i);
  });
});
