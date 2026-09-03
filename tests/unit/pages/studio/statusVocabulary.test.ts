import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import i18nConfig from '@/common/config/i18n-config.json';
import {
  STUDIO_CANVAS_BLOCK_KINDS_V4,
  STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4,
  STUDIO_CANVAS_BLOCK_STATUSES_V4,
  STUDIO_CANVAS_MEMBER_STATUSES_V4,
} from '@/common/types/project/creativeStudioTypes';
import {
  FAILURE_COST_KEYS,
  FAILURE_REASON_KEYS,
  RECOVERY_ACTION_KEYS,
  STATUS_BEHAVIOR,
  allStatusI18nKeys,
  recoveryActionKeys,
  statusKey,
} from '@renderer/pages/studio/components/Pilot/Phase6/statusVocabulary';

type JsonObject = Record<string, unknown>;
const localeRoot = join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');
const loadConversation = (locale: string): JsonObject =>
  JSON.parse(readFileSync(join(localeRoot, locale, 'conversation.json'), 'utf8')) as JsonObject;
const resolve = (conversation: JsonObject, key: string): unknown => {
  let cursor: unknown = conversation;
  for (const segment of key.replace(/^conversation\./u, '').split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as JsonObject)[segment];
  }
  return cursor;
};
const placeholders = (value: string): string[] => (value.match(/\{\{[^}]+\}\}/gu) ?? []).toSorted();
const leafKeys = (value: JsonObject, prefix = ''): string[] =>
  Object.entries(value).flatMap(([name, child]) => {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    return typeof child === 'object' && child !== null ? leafKeys(child as JsonObject, path) : [path];
  });

describe('Phase 6 canvas status vocabulary', () => {
  it('defers kind legality to the canonical Main matrix', () => {
    expect(STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4.document).toContain('drafted');
    expect(STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4.cut).toContain('rendering');
    for (const kind of STUDIO_CANVAS_BLOCK_KINDS_V4.filter((candidate) => candidate !== 'document')) {
      const statuses =
        kind === 'sound'
          ? [
              ...STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4.sound.imported,
              ...STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4.sound.generated,
            ]
          : STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4[kind];
      expect(statuses, kind).not.toContain('drafted');
    }
    for (const kind of STUDIO_CANVAS_BLOCK_KINDS_V4.filter((candidate) => candidate !== 'cut')) {
      const statuses =
        kind === 'sound'
          ? [
              ...STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4.sound.imported,
              ...STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4.sound.generated,
            ]
          : STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4[kind];
      expect(statuses, kind).not.toContain('rendering');
    }
  });

  it('classifies every canonical status at its level', () => {
    expect(Object.keys(STATUS_BEHAVIOR.member).toSorted()).toEqual([...STUDIO_CANVAS_MEMBER_STATUSES_V4].toSorted());
    expect(Object.keys(STATUS_BEHAVIOR.block).toSorted()).toEqual([...STUDIO_CANVAS_BLOCK_STATUSES_V4].toSorted());
    expect(STATUS_BEHAVIOR.member.generating).toEqual({ showsConditions: true, cancellableForRefund: true });
    expect(STATUS_BEHAVIOR.block.generating).toEqual({ showsConditions: true, cancellableForRefund: true });
    expect(STATUS_BEHAVIOR.block.rendering).toEqual({ showsConditions: false, cancellableForRefund: false });
    expect(STATUS_BEHAVIOR.block.queued).toEqual({ showsConditions: false, cancellableForRefund: false });
  });

  it('presents exactly Main-projected actions without deriving another action', () => {
    expect(recoveryActionKeys(['keep'])).toEqual([RECOVERY_ACTION_KEYS.keep]);
    expect(recoveryActionKeys(['re_render_chain', 'keep'])).toEqual([
      RECOVERY_ACTION_KEYS.re_render_chain,
      RECOVERY_ACTION_KEYS.keep,
    ]);
    expect(recoveryActionKeys(['retry'])).toEqual([RECOVERY_ACTION_KEYS.retry]);
  });

  it('uses canonical snake_case tokens directly in typed keys', () => {
    expect(statusKey('block', 'needs_budget')).toMatch(/\.block\.needs_budget$/u);
    expect(statusKey('member', 'ready_to_render')).toMatch(/\.member\.ready_to_render$/u);
    expect(FAILURE_COST_KEYS.not_spent).toMatch(/\.not_spent$/u);
    expect(FAILURE_REASON_KEYS.returned_silence).toMatch(/\.returned_silence$/u);
    expect(RECOVERY_ACTION_KEYS.re_render_chain).toMatch(/\.re_render_chain$/u);
  });
});

describe('Phase 6 canvas status vocabulary locales', () => {
  it('authors the exact inventory in all twelve locales', () => {
    expect(i18nConfig.supportedLanguages).toHaveLength(12);
    const expected = allStatusI18nKeys().toSorted();
    expect(new Set(expected).size).toBe(expected.length);
    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversation(locale);
      for (const key of expected) {
        const value = resolve(conversation, key);
        expect(typeof value, `${locale} ${key}`).toBe('string');
        expect((value as string).trim(), `${locale} ${key}`).not.toBe('');
      }
      const status = resolve(conversation, 'conversation.creativeStudio.pilot.canvas.status') as JsonObject;
      const authored = leafKeys(status)
        .map((suffix) => `conversation.creativeStudio.pilot.canvas.status.${suffix}`)
        .toSorted();
      expect(authored, `${locale} exact status inventory`).toEqual(expected);
    }
  });

  it('keeps interpolation parameters identical in every locale', () => {
    const reference = loadConversation(i18nConfig.referenceLanguage);
    for (const key of allStatusI18nKeys()) {
      const expected = placeholders(resolve(reference, key) as string);
      for (const locale of i18nConfig.supportedLanguages) {
        expect(placeholders(resolve(loadConversation(locale), key) as string), `${locale} ${key}`).toEqual(expected);
      }
    }
  });

  it('authors rendering at block level only', () => {
    const keys = allStatusI18nKeys();
    expect(keys).toContain(statusKey('block', 'rendering'));
    expect(keys).not.toContain('conversation.creativeStudio.pilot.canvas.status.member.rendering');
  });
});

describe('Phase 6 canvas status CSS', () => {
  const css = readFileSync(
    join(
      process.cwd(),
      'packages/desktop/src/renderer/pages/studio/components/Pilot/Phase6/statusVocabulary.module.css'
    ),
    'utf8'
  );

  it('uppercases in CSS except for the four signed locale exceptions', () => {
    expect(css).toContain('text-transform: uppercase');
    for (const lang of ['tr', 'az', 'de', 'el']) expect(css).toContain(`.statusChip:lang(${lang})`);
    expect(css).toContain('text-transform: none');
  });

  it('publishes the document language before the loaded-resource early return', () => {
    const source = readFileSync(join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/index.ts'), 'utf8');
    const assignment = source.indexOf('document.documentElement.lang = normalizedLang');
    const earlyReturn = source.indexOf("if (i18n.hasResourceBundle(normalizedLang, 'translation')) return;");
    expect(assignment).toBeGreaterThan(-1);
    expect(assignment).toBeLessThan(earlyReturn);
  });
});
