/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type StudioAspectRatio,
} from '@/common/types/project/creativeStudioTypes';
import { findShortTemplate, STUDIO_SHORT_TEMPLATES } from '@renderer/pages/studio/components/EntryKit/data/templates';
import { fillTemplateSlots, STUDIO_TEMPLATE_CATEGORIES } from '@renderer/pages/studio/components/EntryKit/types';

/** The id shape `validation.ts`, `jobManager.ts` and every studio bridge check agree on. */
const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Every member of `StudioAspectRatio`, mirrored because the union has no runtime companion.
 *
 * `satisfies` ties this list to the union for a reader, but not for the gate: the repo's
 * `tsc --noEmit` only includes `packages/desktop/src`, so no test file is ever typechecked. The
 * runtime assertion below is the part that actually catches a template naming a frame nothing renders.
 */
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const satisfies readonly StudioAspectRatio[];

/**
 * Any `{{...}}` slot, matched literally.
 *
 * Deliberately not tolerant of whitespace or case: `fillTemplateSlots` substitutes the exact string
 * `{{subject}}` and nothing else, so `{{ subject }}` is just as broken as `{{tone}}` — it would ship
 * to the model verbatim, as braces the model has to interpret.
 */
const SLOT_PATTERN = /\{\{[^}]*\}\}/g;

const unknownSlots = (text: string): string[] =>
  (text.match(SLOT_PATTERN) ?? []).filter((slot) => slot !== '{{subject}}');

describe('STUDIO_SHORT_TEMPLATES', () => {
  /** Without this, every per-template assertion below would pass by having nothing to assert on. */
  it('ships at least one template', () => {
    expect(STUDIO_SHORT_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('gives every template a distinct id', () => {
    const ids = STUDIO_SHORT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const template of STUDIO_SHORT_TEMPLATES) {
    describe(template.id, () => {
      it('has an id the main process will accept', () => {
        expect(template.id).toMatch(SAFE_STUDIO_ID);
      });

      it('sits on a shelf the gallery renders', () => {
        expect(STUDIO_TEMPLATE_CATEGORIES).toContain(template.category);
      });

      it('asks for a frame the studio can render', () => {
        expect(ASPECT_RATIOS).toContain(template.aspectRatio);
      });

      it('carries a whole-second length the store will store', () => {
        expect(Number.isInteger(template.defaultDurationSeconds)).toBe(true);
        expect(template.defaultDurationSeconds).toBeGreaterThanOrEqual(STUDIO_MIN_SHOT_SECONDS);
        expect(template.defaultDurationSeconds).toBeLessThanOrEqual(STUDIO_MAX_SHOT_SECONDS);
      });

      it('names the person and the shot in prose, not an empty string', () => {
        expect(template.name.trim().length).toBeGreaterThan(0);
        expect(template.tagline.trim().length).toBeGreaterThan(0);
        expect(template.instruction.trim().length).toBeGreaterThan(0);
        expect(template.shootingScript.trim().length).toBeGreaterThan(0);
      });

      /** A slot nothing fills reaches the model as literal braces, which reads as noise, not a gap. */
      it('leaves no slot behind that fillTemplateSlots cannot fill', () => {
        expect(unknownSlots(template.instruction)).toEqual([]);
        expect(unknownSlots(template.shootingScript)).toEqual([]);
      });

      /** The asset is resolved against a bundled directory, so a path here would escape it. */
      it('names its first frame as a bare filename', () => {
        expect(template.firstFrameAsset.length).toBeGreaterThan(0);
        expect(template.firstFrameAsset).not.toContain('/');
        expect(template.firstFrameAsset).not.toContain('\\');
        expect(template.firstFrameAsset).not.toContain('..');
      });
    });
  }
});

describe('findShortTemplate', () => {
  it('returns the entry a known id names', () => {
    const [first] = STUDIO_SHORT_TEMPLATES;
    expect(findShortTemplate(first.id)).toBe(first);
  });

  it('returns null rather than undefined for an id nothing ships', () => {
    expect(findShortTemplate('no-such-template')).toBeNull();
  });

  it('returns null for an empty id', () => {
    expect(findShortTemplate('')).toBeNull();
  });
});

describe('fillTemplateSlots', () => {
  it('substitutes the subject into the slot', () => {
    expect(fillTemplateSlots('A shot of {{subject}}.', 'a brass kettle')).toBe('A shot of a brass kettle.');
  });

  it('substitutes every occurrence, not only the first', () => {
    expect(fillTemplateSlots('{{subject}} lit so {{subject}} reads clearly.', 'a kettle')).toBe(
      'a kettle lit so a kettle reads clearly.'
    );
  });

  it('trims the subject before substituting it', () => {
    expect(fillTemplateSlots('Show {{subject}}.', '  a kettle  ')).toBe('Show a kettle.');
  });

  /** Silence reads to a model as "no constraint"; saying the subject is missing makes it ask. */
  it('says the subject is unspecified rather than leaving a gap for an empty subject', () => {
    expect(fillTemplateSlots('Show {{subject}}.', '')).toBe('Show an unspecified subject.');
  });

  it('says the subject is unspecified for a whitespace-only subject', () => {
    expect(fillTemplateSlots('Show {{subject}}.', '   ')).toBe('Show an unspecified subject.');
  });

  it('leaves text without a slot untouched', () => {
    expect(fillTemplateSlots('No slot here.', 'a kettle')).toBe('No slot here.');
  });

  /** `replaceAll` would read `$&` in the replacement as a back-reference and duplicate the slot. */
  it('treats a subject containing replacement patterns as literal text', () => {
    expect(fillTemplateSlots('Show {{subject}}.', 'a $& sign')).toBe('Show a $& sign.');
  });
});
