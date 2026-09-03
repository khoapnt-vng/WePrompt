/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTurnClose } from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose';
import type {
  TurnWorkRecap,
  TurnWorkRecapStatus,
} from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnWorkRecap';

/**
 * The close is app-authored, not agent prose, and is selected from journal state. An inactive
 * journal can contain calls that never reported a terminal result, while even a terminal tool
 * result does not prove the person's request succeeded or failed. Copy may describe only the
 * response boundary and the evidence visible in Technical Details.
 *
 * BUG-162: a Director turn that recorded a proposal and changed nothing closed with
 * "All done — everything went through as planned".
 */

const LOCALES = [
  'de-DE',
  'en-US',
  'es-ES',
  'fa-IR',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'tr-TR',
  'uk-UA',
  'zh-CN',
  'zh-TW',
] as const;
const TERMINAL_STATUSES = ['completed', 'recovered', 'partial', 'failed', 'canceled'] as const;
type TerminalStatus = (typeof TERMINAL_STATUSES)[number];
type CloseCatalog = Record<TerminalStatus, Record<string, string>>;
const EXPECTED_VARIANTS: Record<TerminalStatus, string[]> = {
  completed: ['v1', 'v2', 'v3'],
  recovered: ['v1', 'v2'],
  partial: ['v1', 'v2'],
  failed: ['v1', 'v2'],
  canceled: ['v1'],
};

/* Exact snapshots keep approved translations honest without pretending an English regex can
 * validate eleven other languages. Update a digest only after a human reviews that locale's copy. */
const APPROVED_CLOSE_DIGESTS: Record<(typeof LOCALES)[number], string> = {
  'de-DE': '7030335ff4337cc621b5b6f158dc5ab92af172dc697b40159f77719a5af9b970',
  'en-US': '3b1a10ed1d9c88d7c1297a7db6335f308f63f6860d6b96ef2d7c65ecbfb13ba7',
  'es-ES': 'b3a411baa0195757dd63660aed7231b4a976fcd0875645e4818f47c0429fd3f8',
  'fa-IR': '41521b3f204dbbc0a668d9bc6f92d169df6f9503ebc12eb51d5aca94f5409a76',
  'ja-JP': '26b85fad3dc96a57f37ddeeb5ab0b9c5bb84ca29a9083b6f39453e44574d31a3',
  'ko-KR': '9915e1f0c57dda4990089778fe7282ad8be4ea723738c9cfe87ce79a839c4ccb',
  'pt-BR': '6db01e3a99537d5ad6998d9d8987822e3615f4c5a63117dc9b009a08e6129709',
  'ru-RU': '59b425a17e76cca320765f19907f1e7733a9579236c65e51f11645827a022580',
  'tr-TR': 'f61fb2f3d95286a3cb6a9362ac942668719ab77fcf9a459e157b6c5280ff09b3',
  'uk-UA': 'd317db2aaeb0b3268561aa4d5cc0ba88df06ca0a9e49e34cda5e98788530cd7d',
  'zh-CN': '849646729d0a2548ff79a45962953b0d07fec33f61dcd8fb18fcf6604a8df7d2',
  'zh-TW': '599d1bec22718661fca2e6a1656217e895cac8081b6013758711fc9b635ed125',
};

const closeCatalog = (locale: (typeof LOCALES)[number]): CloseCatalog => {
  const messages = JSON.parse(
    readFileSync(
      join(process.cwd(), `packages/desktop/src/renderer/services/i18n/locales/${locale}/messages.json`),
      'utf8'
    )
  ) as { toolActivity: { close: CloseCatalog } };
  return messages.toolActivity.close;
};

const recap = (status: Exclude<TurnWorkRecapStatus, 'active'>): TurnWorkRecap => ({
  status,
  total: 3,
  completed: status === 'failed' || status === 'canceled' ? 0 : 2,
  failed: status === 'failed' || status === 'partial' ? 1 : 0,
  pending: 0,
  canceled: status === 'canceled' ? 1 : 0,
  unfinished: status === 'completed' || status === 'recovered' ? 0 : 1,
  retries: status === 'recovered' ? 1 : 0,
  categories: [],
});

/** Phrases from the retired copy that claimed an unsupported result for the user's request. */
const OVERCLAIMS = [
  /as planned/i,
  /\ball (?:the )?steps?\b/i,
  /\ball sorted\b/i,
  /\ba couple\b/i,
  /\bdidn't go through\b/i,
  /\bdone\b/i,
  /\beverything\b/i,
  /\bfinish(?:ed)?\b/i,
  /\bin place\b/i,
  /\bmost\b/i,
  /\bpick (?:it|this) back up\b/i,
  /\btry again\b/i,
  /\bsucceed(?:ed)?\b/i,
  /\bsuccess(?:ful|fully)?\b/i,
  /\bwasn't able to finish\b/i,
  /\bwithout (?:an? )?errors?\b/i,
];

describe('turn close honesty', () => {
  it('keeps every emitted close family complete in all supported locales', () => {
    for (const locale of LOCALES) {
      const catalog = closeCatalog(locale);
      expect(Object.keys(catalog).toSorted(), locale).toEqual([...TERMINAL_STATUSES].toSorted());
      for (const status of TERMINAL_STATUSES) {
        const variants = Object.values(catalog[status]);
        expect(Object.keys(catalog[status]).toSorted(), `${locale}.${status}`).toEqual(EXPECTED_VARIANTS[status]);
        expect(
          variants.every((copy) => copy.trim().length > 0 && !copy.includes('{{')),
          `${locale}.${status}`
        ).toBe(true);
      }
    }
  });

  it('matches the human-approved copy exactly in every supported locale', () => {
    for (const locale of LOCALES) {
      const digest = createHash('sha256')
        .update(JSON.stringify(closeCatalog(locale)))
        .digest('hex');
      expect(digest, locale).toBe(APPROVED_CLOSE_DIGESTS[locale]);
    }
  });

  it('resolves every terminal recap to a localized key that exists in every locale', () => {
    for (const status of TERMINAL_STATUSES) {
      const close = buildTurnClose(recap(status));
      expect(close).not.toBeNull();
      const prefix = `messages.toolActivity.close.${status}.`;
      expect(close!.key.startsWith(prefix), close!.key).toBe(true);
      const variant = close!.key.slice(prefix.length);
      for (const locale of LOCALES) {
        expect(closeCatalog(locale)[status][variant], `${locale}.${status}.${variant}`).toBeTruthy();
      }
    }
  });

  it('never claims an unsupported outcome for the user request in English', () => {
    const offenders: string[] = [];
    for (const [status, variants] of Object.entries(closeCatalog('en-US'))) {
      for (const [variant, copy] of Object.entries(variants)) {
        for (const overclaim of OVERCLAIMS) {
          if (overclaim.test(copy)) offenders.push(`${status}.${variant}: ${overclaim.source} → ${copy}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('anchors every English variant to the observable response boundary', () => {
    for (const [status, variants] of Object.entries(closeCatalog('en-US'))) {
      for (const [variant, copy] of Object.entries(variants)) {
        expect(/\bresponse\b/i.test(copy), `${status}.${variant}: ${copy}`).toBe(true);
        expect(/\bconcludes?\b|\bends?\b|\bended\b|\bend\b/i.test(copy), `${status}.${variant}: ${copy}`).toBe(true);
      }
    }
  });

  it('limits status-specific English wording to evidence recorded in Technical Details', () => {
    const catalog = closeCatalog('en-US');
    expect(Object.values(catalog.completed).every((copy) => /ready/i.test(copy))).toBe(true);
    expect(
      Object.values(catalog.recovered).every(
        (copy) => /earlier error/i.test(copy) && /followed by completion|completed after/i.test(copy)
      )
    ).toBe(true);
    expect(Object.values(catalog.partial).every((copy) => /completed/.test(copy) && /error|failed/.test(copy))).toBe(
      true
    );
    expect(Object.values(catalog.failed).every((copy) => /reported (?:an error|errors?)/.test(copy))).toBe(true);
    expect(Object.values(catalog.canceled).every((copy) => /did not report completion/.test(copy))).toBe(true);
  });
});
