/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { composeInstruction } from '@renderer/pages/studio/components/EntryKit/lib/composeInstruction';
import type { StudioProjectSettings } from '@renderer/pages/studio/components/EntryKit/types';

/** Every answer left as the person found it: nothing here was opened or chosen. */
const untouchedSettings: StudioProjectSettings = {
  mediaSource: 'generated_clips',
  generativeStyle: null,
  language: null,
  backgroundMusic: null,
  subtitles: 'none',
  voice: null,
  watermarkText: null,
  audioPreference: 'best_available',
};

const TEMPLATE_INSTRUCTION =
  'Open on the product held still, then a single push-in.\nEnd on the logo card.\nNever cut away from the hands.';

const compose = (overrides: Partial<Parameters<typeof composeInstruction>[0]> = {}): string =>
  composeInstruction({
    instruction: TEMPLATE_INSTRUCTION,
    toneLabel: 'Playful',
    durationLabel: '8 seconds',
    formatLabel: 'TikTok',
    aspectRatio: '9:16',
    about: 'a linen tote bag',
    settings: untouchedSettings,
    lookCount: 0,
    clipWindow: { minDurationSeconds: 4, maxDurationSeconds: 12 },
    ...overrides,
  });

const lineStartingWith = (composed: string, prefix: string): string | undefined =>
  composed.split('\n').find((line) => line.startsWith(prefix));

describe('composeInstruction', () => {
  it('carries the template instruction through verbatim, as the final passage', () => {
    const composed = compose();
    expect(composed).toContain(TEMPLATE_INSTRUCTION);
    expect(composed.endsWith(TEMPLATE_INSTRUCTION)).toBe(true);
  });

  it('states the connected engine clip window using the numbers the engine reported', () => {
    const composed = compose({ clipWindow: { minDurationSeconds: 4, maxDurationSeconds: 12 } });
    const windowLine = lineStartingWith(composed, 'Engine clip window:');
    expect(windowLine).toBeDefined();
    expect(windowLine).toContain('4');
    expect(windowLine).toContain('12');
  });

  /** The bug this replaces: forty templates hardcoded one engine's window into their own prose. */
  it('states a different engine window without falling back to the numbers of another', () => {
    const composed = compose({ clipWindow: { minDurationSeconds: 2, maxDurationSeconds: 6 } });
    const windowLine = lineStartingWith(composed, 'Engine clip window:');
    expect(windowLine).toContain('2');
    expect(windowLine).toContain('6');
    expect(windowLine).not.toContain('12');
  });

  it('says the window is unknown rather than inventing one when nothing is connected', () => {
    const composed = compose({ clipWindow: null });
    const windowLine = lineStartingWith(composed, 'Engine clip window:');
    expect(windowLine).toBeDefined();
    expect(windowLine).toMatch(/unknown/iu);
    expect(windowLine).not.toMatch(/\d/u);
  });

  it('states an empty subject as unspecified instead of leaving the line out', () => {
    const composed = compose({ about: '   ' });
    const aboutLine = lineStartingWith(composed, "What it's about:");
    expect(aboutLine).toBeDefined();
    expect(aboutLine).toMatch(/not specified/iu);
  });

  it('quotes the subject the creator actually gave', () => {
    const composed = compose({ about: '  a linen tote bag  ' });
    expect(composed).toContain('What it\'s about: "a linen tote bag"');
  });

  it('omits every setting the creator never opened', () => {
    const composed = compose({ settings: untouchedSettings });
    expect(composed).not.toMatch(/Background music/iu);
    expect(composed).not.toMatch(/^Language:/mu);
    expect(composed).not.toMatch(/Subtitles:/iu);
    expect(composed).not.toMatch(/^Voice:/mu);
    expect(composed).not.toMatch(/Watermark/iu);
    expect(composed).not.toMatch(/Generative style/iu);
  });

  it('states the settings the creator did choose', () => {
    const composed = compose({
      settings: {
        ...untouchedSettings,
        backgroundMusic: 'upbeat synth',
        language: 'Vietnamese',
        subtitles: 'burned_in',
        voice: 'warm female',
        watermarkText: 'ACME',
        generativeStyle: 'Claymation',
        audioPreference: 'silent',
      },
    });
    expect(composed).toContain('upbeat synth');
    expect(composed).toContain('Vietnamese');
    expect(composed).toMatch(/Subtitles:.*burned/iu);
    expect(composed).toContain('warm female');
    expect(composed).toContain('ACME');
    expect(composed).toContain('Claymation');
    expect(composed).toMatch(/Audio:.*silent/iu);
  });

  it('mentions look references only when some are attached, and counts them singular', () => {
    expect(compose({ lookCount: 0 })).not.toMatch(/Look references/iu);
    expect(compose({ lookCount: 1 })).toMatch(/1 image\b/u);
    expect(compose({ lookCount: 3 })).toMatch(/3 images\b/u);
  });

  it('returns one string with the creator preamble ahead of the template instruction', () => {
    const composed = compose();
    expect(typeof composed).toBe('string');
    const preambleIndex = composed.indexOf('Context from the creator:');
    const instructionIndex = composed.indexOf(TEMPLATE_INSTRUCTION);
    expect(preambleIndex).toBe(0);
    expect(instructionIndex).toBeGreaterThan(preambleIndex);
  });

  it('states the creator picks that the template prose no longer carries itself', () => {
    const composed = compose({
      toneLabel: 'Playful',
      durationLabel: '8 seconds',
      formatLabel: 'TikTok',
      aspectRatio: '9:16',
    });
    const contextLine = composed.split('\n')[0];
    expect(contextLine).toContain('playful');
    expect(contextLine).toContain('8 seconds');
    expect(contextLine).toContain('9:16');
    expect(contextLine).toContain('TikTok');
  });
});
