/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Locale-parity and i18n contract for the Assembly/cut copy and the cross-kind accessible
 * names. This suite deliberately imports nothing from the application — it reads the locale
 * JSON and the i18n config off disk — so it can never be the thing that couples copy to a
 * runtime shape.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const localeRoot = join(root, 'packages/desktop/src/renderer/services/i18n/locales');

const readJson = (path: string): JsonObject => JSON.parse(readFileSync(path, 'utf8')) as JsonObject;

const config = readJson(join(root, 'packages/desktop/src/common/config/i18n-config.json'));
const locales = config.supportedLanguages as string[];
const referenceLocale = config.referenceLanguage as string;

const canvasOf = (locale: string): JsonObject => {
  const conversation = readJson(join(localeRoot, locale, 'conversation.json'));
  const studio = (conversation.creativeStudio ?? {}) as JsonObject;
  const pilot = (studio.pilot ?? {}) as JsonObject;
  return (pilot.canvas ?? {}) as JsonObject;
};

const flatten = (value: JsonObject, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (typeof child === 'string') out[path] = child;
    else if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(out, flatten(child as JsonObject, path));
    }
  }
  return out;
};

/** The two subtrees this change owns. */
const subtreesOf = (locale: string): Record<string, string> => {
  const canvas = canvasOf(locale);
  return {
    ...flatten((canvas.cut ?? {}) as JsonObject, 'cut'),
    ...flatten((canvas.accessibility ?? {}) as JsonObject, 'accessibility'),
  };
};

const placeholders = (value: string): string[] => (value.match(/\{\{[^}]+\}\}/gu) ?? []).toSorted();

const reference = subtreesOf(referenceLocale);
const referenceKeys = Object.keys(reference).toSorted();

describe('Assembly/cut copy — locale parity', () => {
  it('authors an identical key set in all twelve locales', () => {
    expect(locales).toHaveLength(12);
    expect(referenceKeys.length).toBeGreaterThan(0);
    for (const locale of locales) {
      expect(Object.keys(subtreesOf(locale)).toSorted(), locale).toEqual(referenceKeys);
    }
  });

  it('leaves no value empty in any locale', () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(subtreesOf(locale))) {
        expect(value.trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });
});

describe('Assembly/cut copy — interpolation', () => {
  it('keeps the placeholder set identical per key across every locale', () => {
    for (const [key, englishValue] of Object.entries(reference)) {
      const expected = placeholders(englishValue);
      for (const locale of locales) {
        const value = subtreesOf(locale)[key];
        expect(placeholders(value ?? ''), `${locale} ${key}`).toEqual(expected);
      }
    }
  });

  it('bakes no number, price, currency or rate into any translation', () => {
    // Handles, durations, counts, prices, currencies and rates arrive only as parameters.
    // A digit or currency mark in a translated value means one was typed into the copy.
    const forbidden = /[0-9٠-٩۰-۹$€£¥₩₺₽﷼]/u;
    for (const locale of locales) {
      for (const [key, value] of Object.entries(subtreesOf(locale))) {
        expect(forbidden.test(value), `${locale} ${key} = ${value}`).toBe(false);
      }
    }
  });

  it('composes a priced action from the status label rather than restating it', () => {
    // cut.actionWithPrice exists so the stale action word is never duplicated here.
    for (const locale of locales) {
      const value = subtreesOf(locale)['cut.actionWithPrice'];
      expect(placeholders(value ?? ''), locale).toEqual(['{{action}}', '{{price}}']);
    }
  });
});

describe('Assembly/cut copy — plural shape', () => {
  const pluralBases = referenceKeys.filter((key) => referenceKeys.includes(`${key}_one`));

  it('ships every plural as exactly base, _one and _other', () => {
    expect(pluralBases.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const keys = new Set(Object.keys(subtreesOf(locale)));
      for (const base of pluralBases) {
        expect(keys.has(base), `${locale} ${base}`).toBe(true);
        expect(keys.has(`${base}_one`), `${locale} ${base}_one`).toBe(true);
        expect(keys.has(`${base}_other`), `${locale} ${base}_other`).toBe(true);
      }
    }
  });

  it('adds no CLDR category, which would break the exact key set', () => {
    // This repo's contract is base/_one/_other everywhere. A correct-by-CLDR Slavic or
    // Arabic translation that adds _few or _many fails locale parity.
    for (const locale of locales) {
      for (const key of Object.keys(subtreesOf(locale))) {
        expect(/_(?:few|many|zero|two)$/u.test(key), `${locale} ${key}`).toBe(false);
      }
    }
  });
});

describe('Assembly/cut copy — placement', () => {
  it('places nothing under the workspace subtree', () => {
    // workspace has an exact-inventory contract test of its own; anything added there must be
    // registered in it, so this copy deliberately lives under pilot.canvas.
    for (const locale of locales) {
      const conversation = readJson(join(localeRoot, locale, 'conversation.json'));
      const studio = (conversation.creativeStudio ?? {}) as JsonObject;
      const workspace = new Set(Object.keys(flatten((studio.workspace ?? {}) as JsonObject)));
      // workspace has its own long-standing `cut` subtree from the deleted Cut view, so the
      // check is that THESE keys are absent there — not that no workspace key is cut-shaped.
      for (const key of referenceKeys) {
        expect(workspace.has(key), `${locale} workspace.${key}`).toBe(false);
      }
    }
  });

  it('does not redefine any status word a status subtree already owns', () => {
    // Status words have one home and the cut copy composes them. `status` is authored on a
    // sibling branch, so it is included when present rather than required — this guard has to
    // hold both before and after those branches meet.
    const canvas = canvasOf(referenceLocale);
    const statusLeaves = new Set(
      (['status', 'pieceStatus', 'jobStatus'] as const)
        .flatMap((subtree) => Object.values(flatten((canvas[subtree] ?? {}) as JsonObject)))
        .map((value) => value.toLowerCase())
    );
    expect(statusLeaves.size).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(reference)) {
      // A short label identical to a status word would be a second definition of it.
      if (placeholders(value).length === 0 && value.length < 24) {
        expect(statusLeaves.has(value.toLowerCase()), `${key} duplicates a status word`).toBe(false);
      }
    }
  });
});
