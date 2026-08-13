/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TContextHandoffItem } from '@/common/config/storage';

/**
 * The executable part of the brief.
 *
 * Prose in `project.brief` is context the Director reads. A rule with a predicate is a check run
 * against every visual prompt before it renders, in the main process, where the Director cannot
 * reach it. A rule with `predicate: null` is prose that happens to be listed: the Director sees it,
 * nothing enforces it.
 *
 * Field names are deliberately plain. `containsForbiddenRendererField` (store.ts) walks the whole
 * project record recursively and refuses any key named path/filepath/url/apikey/credential/bytes/
 * base64 at any depth, and a project record that trips it becomes unreadable and is quarantined.
 */
export const STUDIO_RULE_LIMITS = {
  /** Total effective rules, organisation layer included. */
  maxRules: 24,
  /** One rule's human-readable sentence. */
  text: 240,
  maxTerms: 8,
  term: 64,
} as const;

/**
 * `organisation` rules are code-resident and locked; the store refuses them on a project record.
 * See A5 in the plan: there is no org-scope store, admin channel or locking primitive in this app,
 * so the layer exists to make precedence real, not to distribute anything yet.
 */
export type StudioBriefRuleScope = 'project' | 'organisation';

export type StudioBriefRulePredicate = {
  kind: 'forbidden_terms';
  terms: string[];
};

export type StudioBriefRule = {
  id: string;
  scope: StudioBriefRuleScope;
  text: string;
  predicate: StudioBriefRulePredicate | null;
  createdAt: string;
};

/** What the renderer sends when it replaces the project's rule list. Main mints scope and createdAt. */
export type StudioBriefRuleDraft = {
  id: string;
  text: string;
  predicate: StudioBriefRulePredicate | null;
};

export type StudioRuleBreach = {
  ruleId: string;
  ruleText: string;
  scope: StudioBriefRuleScope;
  matchedTerm: string;
};

export type StudioRuleVerdict = {
  breaches: StudioRuleBreach[];
};

/**
 * The VNG-wide layer. Empty on purpose — see A5. Rules added here apply to every project on the
 * machine, cannot be edited or removed in the UI, and are evaluated before project rules.
 */
export const ORGANISATION_STUDIO_RULES: readonly StudioBriefRule[] = [];

/**
 * Case-folds only. Diacritics are deliberately NOT stripped: folding them merges distinct
 * Vietnamese words (ca / cà / cá), and this product ships in Vietnamese. A user who wants both
 * forms forbidden lists both terms.
 */
export const foldForRuleMatch = (value: string): string => value.toLowerCase();

/**
 * Unicode word tokens. `\b` is ASCII-word-based and mis-segments Vietnamese and CJK, so it is not
 * used anywhere in this module.
 */
const RULE_TOKEN = /[\p{L}\p{N}]+/gu;

const tokenise = (value: string): string[] =>
  Array.from(foldForRuleMatch(value).matchAll(RULE_TOKEN), (match) => match[0]);

const containsRun = (haystack: readonly string[], needle: readonly string[]): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
};

/**
 * Runs every rule that has a predicate against one resolved prompt.
 *
 * Pure, synchronous and free: it is called in main before a paid request is built, and again in the
 * renderer to say the consequence before the user presses Confirm. Both callers must see the same
 * verdict, which is why this is one module and not two implementations.
 *
 * At most one breach per rule — the first term that matched. Listing every match would bury the
 * rule the user has to act on.
 */
export const evaluateStudioRules = (rules: readonly StudioBriefRule[], prompt: string): StudioRuleVerdict => {
  // The zero-rule case is the cheap fast path for every project until the user pins one. The
  // `?? ''` below guards untypechecked renderer fixtures built without `promptText`, even when rules
  // exist. Main is the real gate and always passes a real string, so coercing a fixture bug to an
  // empty prompt cannot let a paid render through; it only stops the renderer's memo from crashing.
  if (rules.length === 0) return { breaches: [] };
  const promptTokens = tokenise(prompt ?? '');
  const breaches: StudioRuleBreach[] = [];
  for (const rule of rules) {
    if (rule.predicate === null) continue;
    const matched = rule.predicate.terms.find((term) => containsRun(promptTokens, tokenise(term)));
    if (matched === undefined) continue;
    breaches.push({
      ruleId: rule.id,
      ruleText: rule.text,
      scope: rule.scope,
      matchedTerm: foldForRuleMatch(matched.trim()),
    });
  }
  return { breaches };
};

/**
 * Scope precedence, in one place.
 *
 * Organisation first, then project. A project rule whose text duplicates a locked one is dropped —
 * the locked rule is unremovable, so keeping both would show the user a rule they cannot delete
 * next to an identical one they can. A lower layer can never remove a higher layer's rule; the
 * thread layer (see A5) can only add, by being pinned to project scope.
 *
 * The `.slice` is a cap on EVALUATION, and while ORGANISATION_STUDIO_RULES is empty it can never
 * bite: the store already refuses a 25th project rule. It matters the day the org layer is
 * populated, because then a project rule past position 24 silently stops being enforced with no
 * signal anywhere. The drawer counts org + project against the same 24 (Step 8.2.2's `atLimit`) while
 * the store validator caps project rules at 24 alone, so the two layers disagree about the ceiling
 * by exactly ORGANISATION_STUDIO_RULES.length. Whoever fills that constant must reconcile them —
 * most likely by capping the store at `maxRules - ORGANISATION_STUDIO_RULES.length`.
 */
export const resolveEffectiveStudioRules = (
  projectRules: readonly StudioBriefRule[],
  organisationRules: readonly StudioBriefRule[] = ORGANISATION_STUDIO_RULES
): StudioBriefRule[] => {
  const locked = new Set(organisationRules.map((rule) => foldForRuleMatch(rule.text.trim())));
  const effective = [
    ...organisationRules,
    ...projectRules.filter((rule) => !locked.has(foldForRuleMatch(rule.text.trim()))),
  ];
  return effective.slice(0, STUDIO_RULE_LIMITS.maxRules);
};

const RULES_BLOCK_HEADING =
  'PROJECT RULES — enforced before any paid render. A visual prompt that breaks an enforced rule is refused before it costs anything.';
const RULES_BLOCK_FOOTER = 'Call read_storyboard for the full brief.';

const ruleLine = (rule: StudioBriefRule, position: number): string => {
  const enforcement = rule.predicate === null ? 'context only' : 'enforced';
  const terms =
    rule.predicate === null
      ? ''
      : ` (forbidden words: ${rule.predicate.terms.map((term) => term.replace(/\s+/g, ' ').trim()).join(', ')})`;
  return `${position}. [${rule.scope}, ${enforcement}] ${rule.text.replace(/\s+/g, ' ').trim()}${terms}`;
};

/**
 * The model-facing rendering of the rules.
 *
 * English, not i18n. It is prompt text, like `propose_storyboard`'s tool description and
 * `REPROPOSE_INSTRUCTION` — every other model-facing literal in Studio is English, and localising
 * one of them makes the model's behaviour depend on the UI language.
 */
export const renderStudioRulesBlock = (rules: readonly StudioBriefRule[]): string =>
  rules.length === 0 ? '' : [RULES_BLOCK_HEADING, ...rules.map((rule, index) => ruleLine(rule, index + 1))].join('\n');

/** A fixed id so the Studio-owned pin is rewritten in place and can never be confused for a user pin. */
export const STUDIO_BRIEF_RULES_PIN_ID = 'studio_brief_rules';

/**
 * `MAX_CONTEXT_PIN_LENGTH` in payloadSchemas.ts. Restated here rather than imported because that
 * module is the IPC schema layer, but the number is the same and the context-compaction schema
 * enforces it — a longer pin would be rejected the first time Studio ever compacts.
 */
export const STUDIO_BRIEF_RULES_PIN_MAX_CHARS = 2_000;

/**
 * The one per-turn context surface Studio can reach without an aioncore change.
 *
 * `pinned_context` is re-read fresh from the backend on every send (AionrsSendBox), so a pin
 * written here rides every subsequent Director turn with no send-path patch. Two facts are
 * load-bearing:
 *
 * - 2,000 characters is the cap on ONE pin's content (`MAX_CONTEXT_PIN_LENGTH`), and
 *   `pinned_context` holds up to 20 of them (`MAX_CONTEXT_PINS`), so the channel's real ceiling is
 *   ~40,000 characters and a 16 KB brief WOULD fit across ~9 pins. This builder emits one pin
 *   carrying the rules and a pointer sentence because that is the CHOICE recorded in A4's RECORDED
 *   DECISION — push the rules, pull the prose — not because the brief cannot travel this way. If a
 *   later phase reverses that decision, this is the function that changes shape.
 * - `addPinnedContext`/`updatePinnedContext` in pinnedContext.ts run `cleanText`, which collapses
 *   ALL whitespace including newlines. This builder returns the item literally so the caller can
 *   bypass those helpers; a rules list flattened to one line is unreadable to the model and to us.
 *
 * The pushed channel degrades to a pointer well before the 24-rule cap: at 240-character rule texts
 * only about six lines fit 2,000 characters and the rest collapse into
 * `+N more rules — call read_storyboard.`. That is deliberate, and it is another reason acceptance
 * rests on the pull channel and the main-side gate rather than on this one.
 */
export const buildStudioBriefRulesPin = (input: {
  rules: readonly StudioBriefRule[];
  now: number;
}): TContextHandoffItem | null => {
  if (input.rules.length === 0) return null;
  const kept: StudioBriefRule[] = [];
  let used = RULES_BLOCK_HEADING.length + RULES_BLOCK_FOOTER.length + 2;
  let dropped = 0;
  input.rules.forEach((rule, index) => {
    const line = ruleLine(rule, index + 1);
    // 48 characters reserved for the overflow line this may still have to add.
    if (dropped > 0 || used + line.length + 1 > STUDIO_BRIEF_RULES_PIN_MAX_CHARS - 48) {
      dropped += 1;
      return;
    }
    kept.push(rule);
    used += line.length + 1;
  });
  const overflow = dropped === 0 ? [] : [`+${dropped} more rule${dropped === 1 ? '' : 's'} — call read_storyboard.`];
  return {
    id: STUDIO_BRIEF_RULES_PIN_ID,
    title: 'Project rules',
    // The block is rendered by renderStudioRulesBlock, not re-assembled here: one definition of the
    // model-facing rule format, and the pin is a consumer of it rather than a second implementation
    // that can drift. The numbering matches because dropping is suffix-only — once `dropped > 0`
    // every later rule is dropped too, so `kept` is always a prefix of `input.rules` and
    // renderStudioRulesBlock's 1..n numbering is the same numbering measured above.
    content: [renderStudioRulesBlock(kept), ...overflow, RULES_BLOCK_FOOTER].join('\n'),
    // `contextPinSchema` is .strict() with source: z.enum(['manual','context_md']). A Studio-specific
    // value would be rejected by the context-compaction schema, so the pin reuses 'manual' and is
    // identified by its fixed id instead.
    source: 'manual',
    created_at: input.now,
    updated_at: input.now,
  };
};
