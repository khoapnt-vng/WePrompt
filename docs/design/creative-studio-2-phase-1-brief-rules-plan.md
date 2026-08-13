# Creative Studio 2 — Phase 1: the Brief with enforced rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Creative Studio brief from inert prose into a governing document: a small list of pinned rules that the Creative Director sees on every turn and that main refuses to spend money against, surfaced before the confirm button rather than after the charge.

**Architecture:** Rules live as a required `rules` array on the project record (`project.json`) — the same CAS/revision-guarded store main already owns as sole writer. One pure module shared by both processes (`creativeStudioRules.ts`) owns the rule vocabulary, the scope-precedence resolver, the predicate evaluator, and the text block that carries rules into the model's context. Main enforces at `jobManager.resolveProvider`, the one point where every paid request's prompt comes into existence and which the Director provably cannot bypass; the renderer runs the _same_ pure evaluator to show the breach inside the generation review before Confirm is pressable. Rules reach the Director two ways, both derived from `project.json` and neither authoritative: pushed per turn as a Studio-owned `pinned_context` entry, and pulled fresh per call by `read_storyboard`.

**Tech Stack:** TypeScript, Electron (main/renderer split, IPC via `ipcBridge`), React 18 + Arco Design + CSS Modules/UnoCSS, Zod at the IPC boundary, Vitest + jsdom + Testing Library, i18next across 12 locales, MCP (`@modelcontextprotocol/sdk`) for the Studio tool server.

---

## Assumptions this plan is built on — read before writing code

### A1. The on-disk project folder is a dependency to sequence, NOT part of Phase 1

Phase 1 enforces rules against `project.json` only. There is **no** `brief.md` source file, no first-run folder-location prompt, no filesystem sync tolerance, and no one-writer heartbeat. The design handoff §8 promises Phase 1 is cheap — "prompt assembly plus a check step, no new media stack" — and a hand-editable folder with a location prompt, sync tolerance and a heartbeat is a different order of cost.

**What changes when the folder lands:**

- `project.json` stops being the source of truth for _prose_. `brief.md` becomes the source; `project.brief` becomes a derived cache. `rules` stay in `project.json` because they are structured, validated, and CAS-guarded — a hand-edited rules file cannot be validated before it is read, and an unreadable rules file silently disarms the money gate.
- `read_storyboard` (`studioServer.ts:112`) reads `<projectDir>/project.json` directly. When the folder lands it must additionally read `brief.md`, or the Director sees a stale brief. **Nothing else in Phase 1 moves.**
- The pin builder (Task 5) reads `brief` off the renderer project; it would read the folder-backed brief instead. Signature unchanged.

State this assumption in the MR description. Do not relitigate it.

### A2. Not in Phase 1

The section/clip/take data model (phase 2), the first-frame chain (phase 3), the Table/Board/Cut shell (phase 4), TTS, and the Engine Strip (`docs/design/creative-studio-2-engine-strip.md`).

### A3. Two recon findings were wrong. Corrected here.

1. **There is no `PROJECT_KEYS`.** Verified: `grep -rn "PROJECT_KEYS" packages/desktop/src/` returns nothing. `validateProject` (`store.ts:953`) checks the project record **field by field with no `hasExactKeys` call**; the exact-key Sets are `ROUTING_KEYS`, `SCENE_KEYS`, `ASSET_KEYS`, `MANAGED_ASSET_KEYS`, `CUT_KEYS`, `CUT_CLIP_KEYS`, `NORMALISED_RECT_KEYS`, `CUT_FILTER_KEYS`, `JOB_KEYS`, the connection sets and the proposal sets. **Adding `rules` to the project record moves zero key sets and needs no schema-version bump.** The inverse hazard is real though: an unknown top-level project key is _accepted and persisted and never read_, so a misspelt or misnested field validates fine and does nothing. Task 2 adds explicit validation to close that.

2. **An unreadable project is not silently skipped.** Verified: `readProject` (`store.ts:1763`) throws `storage_error`; `readAllProjects` (`store.ts:1781`) catches it, pushes the id into `quarantinedProjectIds`, logs `[CreativeStudio] Quarantined corrupt project manifest`, and surfaces it through `listQuarantinedProjectIds`. The **silent-skip** class is the _pending record_ families: `readProposalRecords` logs `Ignoring malformed proposal record` and drops it with nothing reaching the user (`store.ts:1464`). So project-scope rules sit in the loud-failure zone; a Director-proposed rule (Task 6) sits in the silent zone and must be validated against the store's limits by the subprocess itself.

### A4. The design's stated context mechanism does not exist, and the honest substitute is asymmetric

`preset_context` / `preset_rules` are **create-time only**. Verified: declared "System rules injected at initialization" (`storage.ts:480`) and "first-turn preset context" (`ipcBridge.ts:1995`); the only two write sites are inside `createOrRecoverConversation` (`useGuidSend.ts:788`, `:850`); `grep preset_context packages/desktop/src/process/` returns zero hits; the `POST /api/conversations/{id}/messages` body carries exactly `{content, files, loading_id, inject_skills, pinned_context}` (`ipcBridge.ts:363-372`) with no slot for it. Making it per-turn is an aioncore-fork change.

Worse: the Studio Director passes **neither**. `useBriefConversation.ts:106` sends `extra: { workspace: '', custom_workspace: false }`; `createStudioBriefConversation` adds only `studio_project_id` and the MCP selections (`studioBriefConversation.ts:82-87`). No assistant record, no `project_id`, so `resolveInjectedContext`'s global+project instructions never reach it either. **The Director today runs with no rules, no persona and no injected context whatsoever.** Phase 1 is "give the Director context for the first time".

The only per-turn field on the send wire is `pinned_context`, re-read fresh from the backend on **every** send (`AionrsSendBox.tsx:936` → `getConversationOrNull` → `GET /api/conversations/{id}`, then `getConversationPinnedContext` at `:941`). Its ceiling is **2,000 characters** per item (`MAX_CONTEXT_PIN_LENGTH`, `payloadSchemas.ts:25`), against a 16 KB brief limit (`creativeStudioService.ts:477`).

**Therefore Phase 1 pushes the RULES every turn and pulls the BRIEF on demand.** Rules are small and executable; they go in the pin verbatim. Brief prose is up to 16 KB and can never fit; the pin carries one sentence pointing at `read_storyboard`, which already returns `brief` fresh from disk on every call (`studioServer.ts:143`). Raising the cap means editing an app-wide constant that the context-compaction schema enforces — out of scope, and it would silently break compaction for every conversation.

**What this repo cannot prove:** what aioncore does with `pinned_context` — whether it enters every turn's prompt, where, with what authority. Grep of `docs/` returns nothing. Phase 1's _acceptance_ therefore rests on the two channels this repo can prove — `read_storyboard` (pull) and the main-side gate (enforcement) — with the pin as an additive best-effort that degrades to a no-op. Task 5 includes the out-of-band verification step and what to do with each answer.

### A5. Scope precedence in Phase 1: two layers, not three

The design says "what you say in the thread wins for that section, then project rules, then organisation rules (VNG-wide, locked)". Thread precedence is inherently _per section_, and sections are the phase-2 data model. Organisation scope has **no home**: `configKeys.ts` has no workspace/org/tenant tier, no admin channel, no server-side config fetch and no locking primitive anywhere.

Phase 1 therefore ships:

- **organisation** — a constant, code-resident, currently **empty** layer (`ORGANISATION_STUDIO_RULES`). Always evaluated, never editable, never removable, never persisted on the project record (the store refuses `scope: 'organisation'`). Present so the precedence machinery and its UI are real; the missing piece is a distribution channel, named honestly in the UI copy.
- **project** — user-authored and Director-proposed. Blocking when it carries a predicate.
- **thread** — a thread statement can only _add_ a rule, by being pinned to project scope. It can never waive one. This is deliberate: letting chat text waive a money gate inverts "the assistant may never trigger a paid call on its own".

Precedence is encoded once, in `resolveEffectiveStudioRules`: organisation first, then project rules whose case-folded text does not duplicate a locked one. A lower layer can never remove a higher layer's rule.

### A6. Convention debt, accepted deliberately

Two directories go from 10 to 11 direct children against the `.claude/skills/architecture` "max 10" rule: `packages/desktop/src/common/types/project/` and `packages/desktop/src/renderer/pages/studio/components/`. Every alternative pushes a _deeper_ directory over the same limit or buries a document-level surface inside a phase directory, and `common/` and `common/knowledge/` already sit at 12. The correct fix — a `creativeStudio/` subdirectory under `types/project/` — would touch ~40 import sites and is out of Phase 1 scope. Flag it in the MR description.

---

## File Structure

### Created

| Path                                                                                       | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/common/types/project/creativeStudioRules.ts`                         | The one shared, pure, dual-consumed module: rule/predicate types, `STUDIO_RULE_LIMITS`, the empty locked `ORGANISATION_STUDIO_RULES` layer, `resolveEffectiveStudioRules` (precedence), `foldForRuleMatch` + `evaluateStudioRules` (the predicate), `renderStudioRulesBlock` (model-facing text), `buildStudioBriefRulesPin` (the per-turn pin item). Imported by main (`jobManager`, `store`, `creativeStudioService`, `studioServer`) and renderer (`StudioPage`, `GenerationReviewModal`, `useBriefConversation`, the rules drawer). Follows the `creativeStudioOutputRole.ts` / `creativeStudioProposalDiff.ts` / `creativeStudioCanonicalTake.ts` precedent in the same directory. |
| `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.tsx`        | The persistent rules list: read, add, remove, scope badges, precedence explainer. An Arco `Drawer` opened from the work-area toolbar — the app frame, which survives the phase-4 Table/Board/Cut swap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.module.css` | Drawer layout. Semantic colour tokens only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/desktop/src/renderer/pages/studio/components/Rules/index.ts`                     | Barrel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/unit/process/creative-studio/types/rules.test.ts`                                   | Unit tests for the whole shared module: folding, tokenising, matching, precedence, block rendering, pin building.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx`                             | DOM tests for the drawer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Modified

| Path                                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/common/types/project/creativeStudioTypes.ts`                                                                                                                                                      | `rules: StudioBriefRule[]` **required** on `StudioProject` (:237-257) so the compiler forces every projection; `StudioProposalPayload` widened to a discriminated union; `StudioBriefRuleDraft` + `StudioSetBriefRulesRequest`; `'rule_breach'` added to `StudioCommandErrorCode`. |
| `packages/desktop/src/process/services/creative-studio/store.ts`                                                                                                                                                        | `migrateSchemaV1Project` (:897) defaults `rules: []`; `validateProject` (:953) validates it; `createProjectFromInput` (:1097) seeds it; `validateProposalPayload` (:390) branches on `kind`; new `PROPOSAL_PIN_RULE_PAYLOAD_KEYS`.                                                 |
| `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts`                                                                                                                                        | `toRendererProject` (:737) carries `rules`; new `setBriefRules` command; `applyProposalPayload` (:808) branches on `kind`; `rememberProposalDiff` (:967) skips non-storyboard payloads; `createRuleId` dep.                                                                        |
| `packages/desktop/src/process/services/creative-studio/jobManager.ts`                                                                                                                                                   | `'rule_breach'` added to `StudioJobManagerErrorCode` (:93); the gate inside `resolveProvider` (:578) immediately after the prompt is built and before `adapter.validateRequest`.                                                                                                   |
| `packages/desktop/src/process/bridge/creativeStudioBridge.ts`                                                                                                                                                           | `errorMessageKeys` (:26) gains `rule_breach`; the `setBriefRules` provider registration.                                                                                                                                                                                           |
| `packages/desktop/src/common/adapter/ipcBridge.ts`                                                                                                                                                                      | `setBriefRules` provider declared next to `updateProject` (:1232).                                                                                                                                                                                                                 |
| `packages/desktop/src/common/adapter/native/constants.ts`                                                                                                                                                               | `'creative-studio.set-brief-rules'` in `NATIVE_BRIDGE_PROVIDER_KEYS` (:76-111).                                                                                                                                                                                                    |
| `packages/desktop/src/common/adapter/native/payloadSchemas.ts`                                                                                                                                                          | `studioSetBriefRulesSchema` + its map entry (:709+).                                                                                                                                                                                                                               |
| `packages/desktop/src/common/types/project/creativeStudioProposalDiff.ts`                                                                                                                                               | `computeStudioProposalDiff` narrowed to the storyboard payload variant.                                                                                                                                                                                                            |
| `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`                                                                                                                                                     | `read_storyboard` view (:140) carries `rules`; new `propose_brief_rule` tool + handler; `read_storyboard` description says the rules are enforced.                                                                                                                                 |
| `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposalCard.tsx`                                                                                                                                  | `resolveProposalDiff` (:58) narrowed; a `pin_rule` render branch.                                                                                                                                                                                                                  |
| `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposals.tsx`                                                                                                                                     | `RULE_BREACH_INSTRUCTION` and an exported `sendDirectorInstruction` used by the breach feedback loop.                                                                                                                                                                              |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation.ts`                                                                                                                 | The pin sync effect: writes `buildStudioBriefRulesPin(...)` into `conversation.extra.context_handoff.pinned_context` on ready and on every project-revision change.                                                                                                                |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseHeader.tsx`                                                                                                                                | No signature change — the Rules button rides the existing `actions` slot.                                                                                                                                                                                                          |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseShell.tsx`                                                                                                                                 | `actions` becomes a fragment: the Rules button plus the phase CTA.                                                                                                                                                                                                                 |
| `packages/desktop/src/renderer/pages/studio/components/PhaseShell/types.ts`                                                                                                                                             | `BriefPhaseController` untouched; `StudioPhaseControllers` gains `openRules`.                                                                                                                                                                                                      |
| `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx`                                                                                                                            | `promptText` on `GenerationReviewScene`; per-scene breach alert; breach blocks Confirm; an "ask the Director" action.                                                                                                                                                              |
| `packages/desktop/src/renderer/pages/studio/components/index.ts`                                                                                                                                                        | Re-export `./Rules`.                                                                                                                                                                                                                                                               |
| `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`                                                                                                                                                             | `toReviewScene` supplies `promptText`; the drawer is mounted and `openRules` wired; the auto-submit path (:500-552) refuses on a breach and tells the Director.                                                                                                                    |
| `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` (12 files)                                                                                                                                    | The new `rules` group (37 keys) plus `errors.ruleBreach`.                                                                                                                                                                                                                          |
| `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`                                                                                                                                                            | Regenerated.                                                                                                                                                                                                                                                                       |
| `tests/unit/pages/studio/studioI18n.test.ts`                                                                                                                                                                            | `plannedGroups` gains `'rules'`; `rulesKeys` presence list; `pluralLogicalKeys` and `streamFullSentenceKeys` additions.                                                                                                                                                            |
| `tests/unit/process/creative-studio/store.test.ts`                                                                                                                                                                      | Migration, validation and proposal-payload-union coverage.                                                                                                                                                                                                                         |
| `tests/unit/process/creative-studio/creativeStudioService.test.ts`                                                                                                                                                      | `read_storyboard` payload, `setBriefRules`, rule-proposal accept.                                                                                                                                                                                                                  |
| `tests/unit/process/creative-studio/jobManager.test.ts`                                                                                                                                                                 | The gate on submit, batch and retry.                                                                                                                                                                                                                                               |
| `tests/unit/process/creative-studio/types/proposalDiff.test.ts`                                                                                                                                                         | Union narrowing.                                                                                                                                                                                                                                                                   |
| `tests/unit/process/bridge/nativePayloadSchemas.test.ts`                                                                                                                                                                | `VALID_PAYLOADS` and the invalid-payload lists.                                                                                                                                                                                                                                    |
| `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`                                                                                                                                                 | Breach display and the Confirm block.                                                                                                                                                                                                                                              |
| `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx`                                                                                                                                                       | The `pin_rule` card.                                                                                                                                                                                                                                                               |
| `tests/unit/pages/studio/StudioPhaseShell.dom.test.tsx`, `StudioAccessibleCopy.dom.test.tsx`, `tests/unit/e2e/creativeStudioSelectors.dom.test.tsx`, `tests/unit/pages/studio/Storyboard/Brief/BriefPhase.dom.test.tsx` | The four `StudioPhaseControllers` fixtures gain `openRules`. **Tests are not typechecked** (`tsconfig.json` `include` is `packages/desktop/src/**/*` only), so a missed fixture is a runtime `undefined`, not a compile error.                                                     |

---

## Task 1 — The shared rules module: vocabulary, precedence, predicate

**Files**

- Create: `packages/desktop/src/common/types/project/creativeStudioRules.ts`
- Create: `tests/unit/process/creative-studio/types/rules.test.ts`

### Step 1.1 — Write the failing test for folding and matching

- [ ] Create `tests/unit/process/creative-studio/types/rules.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { StudioBriefRule } from '@/common/types/project/creativeStudioRules';
import { evaluateStudioRules, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';

const rule = (overrides: Partial<StudioBriefRule> = {}): StudioBriefRule => ({
  id: 'rule_1',
  scope: 'project',
  text: 'Never show a competitor logo.',
  predicate: { kind: 'forbidden_terms', terms: ['acme'] },
  createdAt: '2026-08-13T00:00:00.000Z',
  ...overrides,
});

describe('evaluateStudioRules', () => {
  it('reports no breach when no rule carries a predicate', () => {
    const verdict = evaluateStudioRules([rule({ predicate: null })], 'An ACME billboard at dusk');

    expect(verdict.breaches).toEqual([]);
  });

  it('matches a forbidden term regardless of case', () => {
    const verdict = evaluateStudioRules([rule()], 'An ACME billboard at dusk');

    expect(verdict.breaches).toEqual([
      { ruleId: 'rule_1', ruleText: 'Never show a competitor logo.', scope: 'project', matchedTerm: 'acme' },
    ]);
  });

  it('does not match a term buried inside a longer word', () => {
    const verdict = evaluateStudioRules(
      [rule({ predicate: { kind: 'forbidden_terms', terms: ['logo'] } })],
      'A logotype study'
    );

    expect(verdict.breaches).toEqual([]);
  });

  it('matches a multi-word term only as a contiguous run', () => {
    const forbidden = rule({ predicate: { kind: 'forbidden_terms', terms: ['red carpet'] } });

    expect(evaluateStudioRules([forbidden], 'A red carpet at night').breaches).toHaveLength(1);
    expect(evaluateStudioRules([forbidden], 'A red rug and a carpet').breaches).toEqual([]);
  });

  it('does not fold diacritics, so accented words stay distinct', () => {
    const forbidden = rule({ predicate: { kind: 'forbidden_terms', terms: ['ca'] } });

    expect(evaluateStudioRules([forbidden], 'một con cá').breaches).toEqual([]);
    expect(evaluateStudioRules([forbidden], 'một ca nhạc').breaches).toHaveLength(1);
  });

  it('reports one breach per rule, naming the first term that matched', () => {
    const forbidden = rule({ predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] } });

    expect(evaluateStudioRules([forbidden], 'ACME and GLOBEX together').breaches).toEqual([
      { ruleId: 'rule_1', ruleText: 'Never show a competitor logo.', scope: 'project', matchedTerm: 'acme' },
    ]);
  });

  it('caps rule text and term length so a rule cannot smuggle a prompt', () => {
    expect(STUDIO_RULE_LIMITS).toEqual({ maxRules: 24, text: 240, maxTerms: 8, term: 64 });
  });
});
```

- [ ] Run it and see it fail on the missing module:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Failed to resolve import "@/common/types/project/creativeStudioRules"` and `Test Files  1 failed (1)`.

### Step 1.2 — Write the module's vocabulary and evaluator

- [ ] Create `packages/desktop/src/common/types/project/creativeStudioRules.ts`:

```ts
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
  const promptTokens = tokenise(prompt);
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
```

- [ ] Run it and see it pass:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  7 passed (7)`.

### Step 1.3 — Write the failing test for precedence

- [ ] Append to `tests/unit/process/creative-studio/types/rules.test.ts` (and add `resolveEffectiveStudioRules` and `ORGANISATION_STUDIO_RULES` to the import at the top):

```ts
describe('resolveEffectiveStudioRules', () => {
  it('ships with an empty organisation layer, because there is nowhere to distribute one from', () => {
    expect(ORGANISATION_STUDIO_RULES).toEqual([]);
  });

  it('puts organisation rules first, then project rules', () => {
    const organisation = [rule({ id: 'org_1', scope: 'organisation', text: 'No competitor brands.' })];
    const project = [rule({ id: 'rule_2', text: 'Keep the kits generic.' })];

    const effective = resolveEffectiveStudioRules(project, organisation);

    expect(effective.map((entry) => entry.id)).toEqual(['org_1', 'rule_2']);
  });

  it('drops a project rule that duplicates a locked one, so the locked one always wins', () => {
    const organisation = [rule({ id: 'org_1', scope: 'organisation', text: 'No competitor brands.' })];
    const project = [rule({ id: 'rule_2', text: '  no COMPETITOR brands.  ', predicate: null })];

    const effective = resolveEffectiveStudioRules(project, organisation);

    expect(effective.map((entry) => entry.id)).toEqual(['org_1']);
  });

  it('truncates at the cap with organisation rules kept, so a locked rule can never be pushed out', () => {
    const organisation = [rule({ id: 'org_1', scope: 'organisation', text: 'Locked.' })];
    const project = Array.from({ length: STUDIO_RULE_LIMITS.maxRules }, (_, index) =>
      rule({ id: `rule_${index}`, text: `Project rule ${index}.` })
    );

    const effective = resolveEffectiveStudioRules(project, organisation);

    expect(effective).toHaveLength(STUDIO_RULE_LIMITS.maxRules);
    expect(effective[0].id).toBe('org_1');
  });
});
```

- [ ] Run it and see it fail:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `resolveEffectiveStudioRules is not a function` on four tests.

### Step 1.4 — Implement precedence

- [ ] Append to `creativeStudioRules.ts`:

```ts
/**
 * Scope precedence, in one place.
 *
 * Organisation first, then project. A project rule whose text duplicates a locked one is dropped —
 * the locked rule is unremovable, so keeping both would show the user a rule they cannot delete
 * next to an identical one they can. A lower layer can never remove a higher layer's rule; the
 * thread layer (see A5) can only add, by being pinned to project scope.
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
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Tests  11 passed (11)`.

### Step 1.5 — Write the failing test for the context block and the pin

- [ ] Append (and extend the import with `renderStudioRulesBlock`, `buildStudioBriefRulesPin`, `STUDIO_BRIEF_RULES_PIN_ID`, `STUDIO_BRIEF_RULES_PIN_MAX_CHARS`):

```ts
describe('renderStudioRulesBlock', () => {
  it('says nothing when there are no rules, so an empty list costs no context', () => {
    expect(renderStudioRulesBlock([])).toBe('');
  });

  it('numbers the rules, marks the enforced ones and names their terms', () => {
    const block = renderStudioRulesBlock([
      rule({
        id: 'org_1',
        scope: 'organisation',
        text: 'No competitor brands.',
        predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] },
      }),
      rule({ id: 'rule_2', text: 'Keep the kits generic.', predicate: null }),
    ]);

    expect(block).toBe(
      [
        'PROJECT RULES — enforced before any paid render. A visual prompt that breaks an enforced rule is refused before it costs anything.',
        '1. [organisation, enforced] No competitor brands. (forbidden words: acme, globex)',
        '2. [project, context only] Keep the kits generic.',
      ].join('\n')
    );
  });
});

describe('buildStudioBriefRulesPin', () => {
  it('carries the rules and points at read_storyboard for the brief prose', () => {
    const pin = buildStudioBriefRulesPin({ rules: [rule({ predicate: null })], now: 1_700_000_000_000 });

    expect(pin).not.toBeNull();
    expect(pin?.id).toBe(STUDIO_BRIEF_RULES_PIN_ID);
    expect(pin?.source).toBe('manual');
    expect(pin?.created_at).toBe(1_700_000_000_000);
    expect(pin?.content).toContain('1. [project, context only] Never show a competitor logo.');
    expect(pin?.content).toContain('Call read_storyboard for the full brief.');
  });

  it('keeps the newlines, because the pinned-context helpers would collapse them', () => {
    const pin = buildStudioBriefRulesPin({ rules: [rule()], now: 1 });

    expect(pin?.content.split('\n').length).toBeGreaterThan(2);
  });

  it('returns null when there are no rules, so no pin is written at all', () => {
    expect(buildStudioBriefRulesPin({ rules: [], now: 1 })).toBeNull();
  });

  it('stays inside the per-pin character ceiling and says how many rules it dropped', () => {
    const rules = Array.from({ length: STUDIO_RULE_LIMITS.maxRules }, (_, index) =>
      rule({ id: `rule_${index}`, text: 'x'.repeat(STUDIO_RULE_LIMITS.text) })
    );

    const pin = buildStudioBriefRulesPin({ rules, now: 1 });

    expect(pin?.content.length).toBeLessThanOrEqual(STUDIO_BRIEF_RULES_PIN_MAX_CHARS);
    expect(pin?.content).toMatch(/\+\d+ more rules? — call read_storyboard\./);
  });
});
```

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `renderStudioRulesBlock is not a function`.

### Step 1.6 — Implement the block and the pin

- [ ] Append to `creativeStudioRules.ts`:

```ts
const RULES_BLOCK_HEADING =
  'PROJECT RULES — enforced before any paid render. A visual prompt that breaks an enforced rule is refused before it costs anything.';
const RULES_BLOCK_FOOTER = 'Call read_storyboard for the full brief.';

const ruleLine = (rule: StudioBriefRule, position: number): string => {
  const enforcement = rule.predicate === null ? 'context only' : 'enforced';
  const terms = rule.predicate === null ? '' : ` (forbidden words: ${rule.predicate.terms.join(', ')})`;
  return `${position}. [${rule.scope}, ${enforcement}] ${rule.text}${terms}`;
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
 * written here rides every subsequent Director turn with no send-path patch. Two hard constraints
 * are load-bearing:
 *
 * - The 2,000-character ceiling means the 16 KB brief cannot travel this way. Rules go in whole
 *   because they are the executable part; prose is pointed at instead. See A4.
 * - `addPinnedContext`/`updatePinnedContext` in pinnedContext.ts run `cleanText`, which collapses
 *   ALL whitespace including newlines. This builder returns the item literally so the caller can
 *   bypass those helpers; a rules list flattened to one line is unreadable to the model and to us.
 */
export const buildStudioBriefRulesPin = (input: {
  rules: readonly StudioBriefRule[];
  now: number;
}): TContextHandoffItem | null => {
  if (input.rules.length === 0) return null;
  const lines: string[] = [];
  let used = RULES_BLOCK_HEADING.length + RULES_BLOCK_FOOTER.length + 2;
  let dropped = 0;
  input.rules.forEach((rule, index) => {
    const line = ruleLine(rule, index + 1);
    // 32 characters reserved for the overflow line this may still have to add.
    if (dropped > 0 || used + line.length + 1 > STUDIO_BRIEF_RULES_PIN_MAX_CHARS - 48) {
      dropped += 1;
      return;
    }
    lines.push(line);
    used += line.length + 1;
  });
  const overflow = dropped === 0 ? [] : [`+${dropped} more rule${dropped === 1 ? '' : 's'} — call read_storyboard.`];
  return {
    id: STUDIO_BRIEF_RULES_PIN_ID,
    title: 'Project rules',
    content: [RULES_BLOCK_HEADING, ...lines, ...overflow, RULES_BLOCK_FOOTER].join('\n'),
    // `contextPinSchema` is .strict() with source: z.enum(['manual','context_md']). A Studio-specific
    // value would be rejected by the context-compaction schema, so the pin reuses 'manual' and is
    // identified by its fixed id instead.
    source: 'manual',
    created_at: input.now,
    updated_at: input.now,
  };
};
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/types/rules.test.ts
```

Expected: `Tests  16 passed (16)`.

### Step 1.7 — Commit

- [ ] `git add packages/desktop/src/common/types/project/creativeStudioRules.ts tests/unit/process/creative-studio/types/rules.test.ts`
- [ ] `git commit -m "feat(creative-studio): add the brief rules vocabulary, precedence and predicate"`

---

## Task 2 — Persist rules on the project record, in migration order

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (:237-257)
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (:170-183, :897-933, :953-1086, :1097-1114)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (:737-768)
- Test: `tests/unit/process/creative-studio/store.test.ts`

**The order is load-bearing.** `readProject` runs `migrateSchemaV1Project(raw)` at `store.ts:1768` and _then_ `validateProject(migrated)` at `:1769`. `migrateSchemaV1Project` returns the value untouched only when `!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.jobs)` — and any record failing those also fails `validateProject` for unrelated reasons. So defaulting `rules` in the migrator makes it safe to validate `rules` as **required** in the same change: every record that could otherwise have passed now arrives with the field. Do not invert this. Tightening validation first makes every existing `project.json` throw `storage_error` and get quarantined.

### Step 2.1 — Write the failing migration test

- [ ] Find the existing project-record fixture helper in `tests/unit/process/creative-studio/store.test.ts` (search for `schemaVersion: 1` near the top) and add:

```ts
it('reads a project written before rules existed and defaults them to an empty list', async () => {
  const { store, root } = await createStore();
  const created = await store.createProject(projectInput());
  const file = path.join(root, created.id, 'project.json');
  const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  delete raw.rules;
  await fs.writeFile(file, JSON.stringify(raw), 'utf8');

  const reread = await store.getProject(created.id);

  expect(reread?.rules).toEqual([]);
  expect(await store.listQuarantinedProjectIds()).toEqual([]);
});

it('refuses a rules array that breaks the shape, rather than persisting it unread', async () => {
  const { store, root } = await createStore();
  const created = await store.createProject(projectInput());
  const file = path.join(root, created.id, 'project.json');
  const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  raw.rules = [
    {
      id: 'rule_1',
      scope: 'project',
      text: 'x',
      predicate: { kind: 'nope', terms: [] },
      createdAt: '2026-08-13T00:00:00.000Z',
    },
  ];
  await fs.writeFile(file, JSON.stringify(raw), 'utf8');

  await expect(store.getProject(created.id)).rejects.toMatchObject({ code: 'storage_error' });
});

it('refuses an organisation-scoped rule on the project record, because that layer is code-resident', async () => {
  const { store, root } = await createStore();
  const created = await store.createProject(projectInput());
  const file = path.join(root, created.id, 'project.json');
  const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  raw.rules = [
    { id: 'rule_1', scope: 'organisation', text: 'x', predicate: null, createdAt: '2026-08-13T00:00:00.000Z' },
  ];
  await fs.writeFile(file, JSON.stringify(raw), 'utf8');

  await expect(store.getProject(created.id)).rejects.toMatchObject({ code: 'storage_error' });
});
```

Use whatever the file's existing `createStore()` / `projectInput()` helpers are named; check the top of the file and match them exactly. `path` and `fs` (`node:fs/promises`) are already imported there.

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/store.test.ts
```

Expected: the first new test fails with `expected undefined to deeply equal []`; the other two fail because a malformed/organisation rules array is accepted.

### Step 2.2 — Declare the field, required

- [ ] In `creativeStudioTypes.ts`, add the import and the field:

```ts
import type { StudioBriefRule } from './creativeStudioRules';
```

and inside `StudioProject`, immediately after `brief: string;`:

```ts
  /**
   * The executable part of the brief. REQUIRED, not optional: `StudioRendererProject` is
   * `Omit<StudioProject, 'jobs' | 'routing'> & …` and `toRendererProject` declares that return
   * type, so a required field makes omitting it from the projection a tsc error. Optional and it
   * would be persisted, validated, visible to the MCP tools and silently invisible to the renderer —
   * the documented `outputRole` trap (see the warning at :144-149).
   */
  rules: StudioBriefRule[];
```

- [ ] Also re-export the rule types from this module so consumers have one import site:

```ts
export type {
  StudioBriefRule,
  StudioBriefRuleDraft,
  StudioBriefRulePredicate,
  StudioBriefRuleScope,
  StudioRuleBreach,
  StudioRuleVerdict,
} from './creativeStudioRules';
```

- [ ] Confirm the compiler now names every site that must move:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: errors at `store.ts` `createProjectFromInput` (missing `rules`) and `creativeStudioService.ts` `toRendererProject` (missing `rules`). If `toRendererProject` is NOT flagged, stop — the field was declared optional and the silent-drop trap is live.

### Step 2.3 — Migrate, validate, seed

- [ ] In `store.ts`, add to the imports:

```ts
import { STUDIO_RULE_LIMITS, type StudioBriefRule } from '@/common/types/project/creativeStudioRules';
```

- [ ] Add the key sets next to `PROPOSAL_SCENE_KEYS` (~:195):

```ts
const BRIEF_RULE_KEYS = new Set(['id', 'scope', 'text', 'predicate', 'createdAt']);
const BRIEF_RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
```

- [ ] Add the validators next to `validateProposalScene` (~:372):

```ts
const validateBriefRulePredicate = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, BRIEF_RULE_PREDICATE_KEYS) &&
    value.kind === 'forbidden_terms' &&
    Array.isArray(value.terms) &&
    value.terms.length > 0 &&
    value.terms.length <= STUDIO_RULE_LIMITS.maxTerms &&
    value.terms.every((term) => isNonEmptyString(term) && term.length <= STUDIO_RULE_LIMITS.term) &&
    new Set(value.terms).size === value.terms.length);

/**
 * A rule on the project record is always project-scoped. The organisation layer is code-resident
 * (ORGANISATION_STUDIO_RULES) and is refused here on purpose: a locked rule cached on disk could be
 * edited out of the file by hand, which is exactly what "locked" must not mean.
 */
const validateBriefRule = (value: unknown): value is StudioBriefRule =>
  isRecord(value) &&
  hasExactKeys(value, BRIEF_RULE_KEYS) &&
  isSafeId(value.id) &&
  value.scope === 'project' &&
  isNonEmptyString(value.text) &&
  value.text.length <= STUDIO_RULE_LIMITS.text &&
  validateBriefRulePredicate(value.predicate) &&
  isCanonicalIsoTimestamp(value.createdAt);

const validateBriefRules = (value: unknown): value is StudioBriefRule[] =>
  Array.isArray(value) &&
  value.length <= STUDIO_RULE_LIMITS.maxRules &&
  value.every(validateBriefRule) &&
  new Set(value.map((rule) => (rule as StudioBriefRule).id)).size === value.length;
```

- [ ] Extend `migrateSchemaV1Project`. Replace its final `return` (`store.ts:932`) with:

```ts
// Defaulted here, before validateProject runs at readProject, so a manifest written before rules
// existed reads back rather than being quarantined. The migrator is unconditional for any record
// that could otherwise pass validation, which is what makes it safe to validate `rules` as
// required in the same change.
const rulesMissing = !Object.hasOwn(value, 'rules');
return changed || routing !== value.routing || rulesMissing
  ? { ...value, jobs, routing, ...(rulesMissing ? { rules: [] } : {}) }
  : value;
```

- [ ] In `validateProject`, add to the second condition block (after `!isString(value.brief) ||`):

```ts
    !validateBriefRules(value.rules) ||
```

- [ ] In `createProjectFromInput`, add after `brief: input.brief,`:

```ts
  rules: [],
```

- [ ] Run and see the store tests pass:

```
bun run test tests/unit/process/creative-studio/store.test.ts
```

Expected: `Test Files  1 passed (1)`, all three new tests green.

### Step 2.4 — Carry rules through the renderer projection

- [ ] In `creativeStudioService.ts` `toRendererProject`, add after `brief: project.brief,`:

```ts
    rules: project.rules.map((rule) => ({
      ...rule,
      predicate: rule.predicate === null ? null : { ...rule.predicate, terms: [...rule.predicate.terms] },
    })),
```

- [ ] Confirm the compiler is clean:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: no output.

### Step 2.5 — Commit

- [ ] `git commit -am "feat(creative-studio): persist brief rules on the project record"`

---

## Task 3 — The set-rules command, end to end

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/adapter/native/constants.ts` (:76-111)
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts` (:434-448 region, :709+ map)
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts` (:1232)
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts` (:323)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts`
- Test: `tests/unit/process/bridge/nativePayloadSchemas.test.ts`, `tests/unit/process/creative-studio/creativeStudioService.test.ts`

**Why a dedicated command and not `update_project`.** `flushProjectDraft` (`useStoryboardEditor.ts:1245`) resends **every** draft field on every flush and dirty-tracks per _field_, so a rules array would be one field clobbered wholesale whenever a Director pin races a brief keystroke. `bindBriefConversation` (`creativeStudioService.ts:1336`) is the precedent: its own command, its own CAS on `expectedRevision`, no draft involvement.

### Step 3.1 — Write the failing schema test

- [ ] In `tests/unit/process/bridge/nativePayloadSchemas.test.ts`, add to `VALID_PAYLOADS` right after the `'creative-studio.update-project'` entry (:242):

```ts
  'creative-studio.set-brief-rules': {
    projectId: 'project_1',
    expectedRevision: 1,
    rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } }],
  },
```

- [ ] Add to the invalid-payload list that starts at :1064:

```ts
  ['creative-studio.set-brief-rules', 'missing expected revision', { projectId: 'project_1', rules: [] }],
  [
    'creative-studio.set-brief-rules',
    'unknown predicate kind',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: [{ id: 'rule_1', text: 'x', predicate: { kind: 'regex', terms: ['x'] } }],
    },
  ],
  [
    'creative-studio.set-brief-rules',
    'too many rules',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: Array.from({ length: 25 }, (_, index) => ({ id: `rule_${index}`, text: 'x', predicate: null })),
    },
  ],
```

- [ ] Run and see it fail:

```
bun run test tests/unit/process/bridge/nativePayloadSchemas.test.ts
```

Expected: `every manifested provider has a payload schema` fails naming `creative-studio.set-brief-rules`, and the manifest-parity assertion fails because the key is absent from `NATIVE_BRIDGE_PROVIDER_KEYS`.

### Step 3.2 — Declare the request type

- [ ] In `creativeStudioTypes.ts`, next to `StudioBindBriefConversationRequest`:

```ts
/** Replaces the project's whole rule list. Main mints scope and createdAt; ids come from the caller. */
export type StudioSetBriefRulesRequest = StudioProjectRequest & {
  expectedRevision: number;
  rules: StudioBriefRuleDraft[];
};
```

### Step 3.3 — Register the channel and its schema

- [ ] In `constants.ts`, add after `'creative-studio.update-project',`:

```ts
  'creative-studio.set-brief-rules',
```

- [ ] In `payloadSchemas.ts`, add above `studioUpdateProjectSchema` (:434):

```ts
const studioBriefRulePredicateSchema = z
  .object({
    kind: z.literal('forbidden_terms'),
    terms: z.array(z.string().trim().min(1).max(64)).min(1).max(8),
  })
  .strict();
const studioSetBriefRulesSchema = z
  .object({
    projectId: safeIdSchema,
    expectedRevision: studioExpectedRevisionSchema,
    rules: z
      .array(
        z
          .object({
            id: safeIdSchema,
            text: z.string().trim().min(1).max(240),
            predicate: studioBriefRulePredicateSchema.nullable(),
          })
          .strict()
      )
      .max(24),
  })
  .strict();
```

- [ ] Add to the schema map after `'creative-studio.update-project': studioUpdateProjectSchema,`:

```ts
  'creative-studio.set-brief-rules': studioSetBriefRulesSchema,
```

- [ ] In `ipcBridge.ts`, add after the `updateProject` provider (:1234):

```ts
  setBriefRules: bridge.buildProvider<StudioCommandResult<StudioRendererProject>, StudioSetBriefRulesRequest>(
    'creative-studio.set-brief-rules'
  ),
```

and add `StudioSetBriefRulesRequest` to the type import from `creativeStudioTypes`.

- [ ] Run and see the schema test pass:

```
bun run test tests/unit/process/bridge/nativePayloadSchemas.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 3.4 — Write the failing service test

- [ ] In `tests/unit/process/creative-studio/creativeStudioService.test.ts`, add (matching the file's existing `createService()`/fixture helper names):

```ts
it('replaces the rule list, stamps project scope, and preserves createdAt for a rule that stays', async () => {
  const { service } = await createService({ createRuleId: () => 'rule_minted' });
  const project = await service.createProject(projectInput());

  const first = await service.setBriefRules({
    projectId: project.id,
    expectedRevision: project.revision,
    rules: [{ id: 'rule_1', text: '  Keep the kits generic.  ', predicate: null }],
  });
  const createdAt = first.rules[0].createdAt;

  const second = await service.setBriefRules({
    projectId: project.id,
    expectedRevision: first.revision,
    rules: [
      { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
      { id: 'rule_2', text: 'No competitor logos.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } },
    ],
  });

  expect(second.rules).toEqual([
    { id: 'rule_1', scope: 'project', text: 'Keep the kits generic.', predicate: null, createdAt },
    {
      id: 'rule_2',
      scope: 'project',
      text: 'No competitor logos.',
      predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    },
  ]);
});

it('refuses a stale revision rather than clobbering a concurrent edit', async () => {
  const { service } = await createService();
  const project = await service.createProject(projectInput());

  await expect(
    service.setBriefRules({ projectId: project.id, expectedRevision: project.revision + 5, rules: [] })
  ).rejects.toMatchObject({ code: 'stale_project' });
});
```

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `service.setBriefRules is not a function`.

### Step 3.5 — Implement the service command and the provider

- [ ] In `creativeStudioService.ts`, add `createRuleId?: () => string;` to `CreativeStudioServiceDeps` (~:205) and inside the factory next to `createSceneId` (:955):

```ts
const createRuleId = deps.createRuleId ?? randomUUID;
```

- [ ] Add `setBriefRules(input: StudioSetBriefRulesRequest): Promise<StudioRendererProject>;` to the `CreativeStudioService` interface, and the implementation next to `bindBriefConversation` (:1336):

```ts
    async setBriefRules(input: StudioSetBriefRulesRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (!Array.isArray(input.rules) || input.rules.length > STUDIO_RULE_LIMITS.maxRules) {
        throw invalid('Invalid Studio rule list');
      }
      if (new Set(input.rules.map((rule) => rule.id)).size !== input.rules.length) {
        throw invalid('Invalid Studio rule list');
      }
      for (const rule of input.rules) {
        assertSafeId(rule.id, 'rule id');
        assertText(rule.text, STUDIO_RULE_LIMITS.text, 'rule text', true);
        if (rule.predicate === null) continue;
        if (
          rule.predicate.kind !== 'forbidden_terms' ||
          !Array.isArray(rule.predicate.terms) ||
          rule.predicate.terms.length === 0 ||
          rule.predicate.terms.length > STUDIO_RULE_LIMITS.maxTerms
        ) {
          throw invalid('Invalid Studio rule predicate');
        }
        for (const term of rule.predicate.terms) assertText(term, STUDIO_RULE_LIMITS.term, 'rule term', true);
      }
      const timestamp = new Date().toISOString();
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const existing = new Map(project.rules.map((rule) => [rule.id, rule]));
            return {
              ...project,
              rules: input.rules.map((draft) => ({
                id: draft.id,
                scope: 'project' as const,
                text: draft.text.trim(),
                predicate:
                  draft.predicate === null
                    ? null
                    : { kind: 'forbidden_terms' as const, terms: draft.predicate.terms.map((term) => term.trim()) },
                createdAt: existing.get(draft.id)?.createdAt ?? timestamp,
              })),
            };
          },
          input.expectedRevision
        )
      );
    },
```

Add `STUDIO_RULE_LIMITS` and `StudioSetBriefRulesRequest` to the imports. `createRuleId` is unused here on purpose — Task 6 uses it.

- [ ] In `creativeStudioBridge.ts`, add after the `updateProject` provider (:325):

```ts
ipcBridge.creativeStudio.setBriefRules.provider((input) =>
  runCommand(() => dependencies.getService().setBriefRules(input))
);
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 3.6 — Commit

- [ ] `git commit -am "feat(creative-studio): add the set-brief-rules command"`

---

## Task 4 — `read_storyboard` carries the rules

**Files**

- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts` (:112-155, :274-280)
- Test: `tests/unit/process/creative-studio/creativeStudioService.test.ts` (the `read_storyboard` payload assertions, ~:4537)

The frozen `AIONUI_STUDIO_ROUTE_CATALOG` env snapshot is the reason rules must not go anywhere near the MCP env: verified that the descriptor is serialised at `creativeStudioService.ts:1158`, persisted into `conversation.extra.session_mcp_servers` at `studioBriefConversation.ts:86`, and never rewritten anywhere in the repo — and because `briefConversationId` is persisted on the project, the conversation survives restarts and is never recreated. Anything in the env is frozen at first project open for the life of the project. `readProject` (`studioServer.ts:108`) re-reads `project.json` on **every** tool call. Rules go there.

### Step 4.1 — Write the failing test

- [ ] Locate the `read_storyboard` payload assertion block in `tests/unit/process/creative-studio/creativeStudioService.test.ts` (search for `hasSelectedTake`) and add alongside it:

```ts
it('shows the Director the project rules, fresh from disk on every call', async () => {
  const { service, root } = await createService();
  const project = await service.createProject(projectInput());
  await service.setBriefRules({
    projectId: project.id,
    expectedRevision: project.revision,
    rules: [{ id: 'rule_1', text: 'No competitor logos.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } }],
  });

  const handler = createReadStoryboardHandler({
    projectId: project.id,
    projectDir: path.join(root, project.id),
    pendingDir: path.join(root, project.id, 'proposals', 'pending'),
    referencePendingDir: path.join(root, project.id, 'reference-requests', 'pending'),
    routeCatalog: null,
  });
  const view = JSON.parse((await handler({})).content[0].text) as { rules: unknown };

  expect(view.rules).toEqual([
    { scope: 'project', text: 'No competitor logos.', enforced: true, forbiddenTerms: ['acme'] },
  ]);
});
```

Import `createReadStoryboardHandler` from `@process/resources/builtinMcp/studioServer` at the top if it is not already imported.

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `expected undefined to deeply equal [ … ]`.

### Step 4.2 — Add rules to the tool view

- [ ] In `studioServer.ts`, add the import:

```ts
import { resolveEffectiveStudioRules } from '@/common/types/project/creativeStudioRules';
```

- [ ] Inside `createReadStoryboardHandler`, immediately before `const view = {`:

```ts
// Rule ids are not exposed: the Director never addresses a rule by id, and an id in the
// context is one more thing it can hallucinate back at us. Text is the handle.
const rules = resolveEffectiveStudioRules(project.rules).map((rule) => ({
  scope: rule.scope,
  text: rule.text,
  enforced: rule.predicate !== null,
  ...(rule.predicate === null ? {} : { forbiddenTerms: rule.predicate.terms }),
}));
```

- [ ] Add `rules,` to the `view` object, immediately after `brief: project.brief,`.

- [ ] Update the tool description so the model knows what the rules are for. Replace the `read_storyboard` description string (:277) with:

```ts
    "Read the Studio project's current script and its governing rules: revision, settings, the brief, the pinned rules, and every scene's editable fields plus whether it has a reference image and a selected take. Always call this before proposing, and before answering any question about what this project may or may not show. A rule marked enforced is checked against every visual prompt before anything is generated: a prompt that breaks one is refused and nothing is charged.",
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 4.3 — Commit

- [ ] `git commit -am "feat(creative-studio): show the Director its project rules through read_storyboard"`

---

## Task 5 — The per-turn pin

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation.ts`
- Test: `tests/unit/pages/studio/Storyboard/Brief/useBriefConversation.dom.test.ts` (create if absent; check for an existing sibling first with `ls tests/unit/pages/studio/Storyboard/Brief/`)

### Step 5.0 — Verify the mechanism out of band (blocking on the _claim_, not the code)

- [ ] Confirm against the VNG aioncore fork (`code.vng.vn/dto/aioncore`, branch `fix/mcp-oauth-discovery`) what `POST /api/conversations/{id}/messages`'s `pinned_context` does: whether it enters every turn's prompt, where, and with what authority. This repo proves only that the field is sent per turn.
- [ ] Record the answer in the MR description. The code below ships either way:
  - **Injected per turn** → Phase 1 delivers the design's core claim for rules. Say so.
  - **Ignored, or only used at compaction** → the pin is inert; `read_storyboard` (Task 4) plus the breach feedback loop (Task 11) are the delivered channels, and "loaded into every turn" is downgraded honestly in the MR. Do **not** remove the pin: it costs one effect and becomes correct the moment the backend honours it.
- [ ] Do not block the rest of the plan on this. Nothing else depends on the answer.

### Step 5.1 — Write the failing test

- [ ] Create `tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn(async () => true);
const getBriefSessionServer = vi.fn();
const bindBriefConversation = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { update: { invoke: update }, create: { invoke: vi.fn() } },
    creativeStudio: {
      getBriefSessionServer: { invoke: getBriefSessionServer },
      bindBriefConversation: { invoke: bindBriefConversation },
    },
  },
}));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: [], error: null }),
}));
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({ current_model: { id: 'p', use_model: 'm' }, modelList: [] }),
}));

const conversation = {
  id: 'conversation_brief',
  type: 'aionrs' as const,
  extra: { workspace: '', custom_workspace: false, studio_project_id: 'project_1' },
};

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({ allConversations: [conversation] }),
}));

import { useBriefConversation } from '@/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation';

const project = (revision: number, rules: unknown[]) =>
  ({ id: 'project_1', name: 'Launch film', revision, briefConversationId: 'conversation_brief', rules }) as never;

describe('the Studio brief rules pin', () => {
  beforeEach(() => {
    update.mockClear();
  });

  it('writes the rules into pinned_context when the conversation is ready', async () => {
    renderHook(() =>
      useBriefConversation(
        project(3, [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'No competitor logos.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ])
      )
    );

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [payload] = update.mock.calls[0] as [{ id: string; merge_extra?: boolean; updates: Record<string, never> }];
    expect(payload.id).toBe('conversation_brief');
    expect(payload.merge_extra).toBe(true);
    const pins = (
      payload.updates as never as { context_handoff: { pinned_context: { id: string; content: string }[] } }
    ).context_handoff.pinned_context;
    expect(pins).toHaveLength(1);
    expect(pins[0].id).toBe('studio_brief_rules');
    expect(pins[0].content).toContain('No competitor logos.');
  });

  it('does not rewrite the pin when nothing about the rules changed', async () => {
    const rules = [
      {
        id: 'rule_1',
        scope: 'project',
        text: 'No competitor logos.',
        predicate: null,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ];
    const { rerender } = renderHook(
      ({ revision }: { revision: number }) => useBriefConversation(project(revision, rules)),
      {
        initialProps: { revision: 3 },
      }
    );

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    rerender({ revision: 4 });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });
});
```

Adjust the mocked module paths if the hook's own imports differ; read the top of `useBriefConversation.ts` and mirror them exactly. The `extra` shape must satisfy `resolveBoundState`'s `conversation?.type === 'aionrs'` check.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts
```

Expected: `expected "spy" to be called 1 times, but got 0 times`.

### Step 5.2 — Implement the pin sync

- [ ] In `useBriefConversation.ts`, add the imports:

```ts
import {
  buildStudioBriefRulesPin,
  resolveEffectiveStudioRules,
  STUDIO_BRIEF_RULES_PIN_ID,
} from '@/common/types/project/creativeStudioRules';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
```

- [ ] Add, inside `useBriefConversation` after `const [attempt, setAttempt] = useState(0);`:

```ts
/**
 * Keeps one Studio-owned entry in the Director conversation's `pinned_context`.
 *
 * `pinned_context` is the only field on the send wire that is recomputed from a fresh server read
 * on every message (AionrsSendBox re-GETs the conversation, then forwards the pins), so a write
 * here rides every subsequent turn with no send-path patch. `preset_context`/`preset_rules` cannot
 * do this: they are captured once at conversation create and the send body has no slot for them.
 *
 * Three details are load-bearing:
 * - `merge_extra` so a patch never drops the rest of `extra`.
 * - Non-Studio pins are preserved and the Studio pin is replaced in place by its fixed id, so a
 *   user pin can never be clobbered and the Studio pin can never be duplicated.
 * - The item is built literally rather than through addPinnedContext/updatePinnedContext, whose
 *   `cleanText` collapses ALL whitespace including newlines and would flatten the rule list.
 *
 * Re-asserted on every rules change and whenever the conversation becomes ready, which covers the
 * realistic ways the pin could be lost: this store is not CAS-guarded and Studio does not own it.
 */
const lastSyncedPinRef = useRef<string | null>(null);
const conversationId = state.kind === 'ready' ? state.conversation.id : null;
const effectiveRules = useMemo(() => resolveEffectiveStudioRules(project.rules), [project.rules]);

useEffect(() => {
  if (conversationId === null || state.kind !== 'ready') return;
  const pin = buildStudioBriefRulesPin({ rules: effectiveRules, now: Date.now() });
  const signature = pin === null ? '' : pin.content;
  if (lastSyncedPinRef.current === signature) return;
  lastSyncedPinRef.current = signature;
  const existing = getConversationPinnedContext(state.conversation).filter(
    (item) => item.id !== STUDIO_BRIEF_RULES_PIN_ID
  );
  void ipcBridge.conversation.update
    .invoke({
      id: conversationId,
      merge_extra: true,
      updates: {
        extra: { context_handoff: { pinned_context: pin === null ? existing : [...existing, pin] } },
      } as never,
    })
    // A failed pin write costs the Director its rule list for this turn, nothing more: the money
    // gate is in main and read_storyboard still carries the rules. Retrying on the next change.
    .catch(() => {
      lastSyncedPinRef.current = null;
    });
}, [conversationId, effectiveRules, state]);
```

If `useMemo`/`useRef` are not already imported in this file, add them.

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  2 passed (2)`.

Note: the test asserts `updates.context_handoff`, the implementation writes `updates.extra.context_handoff`. **Read the `merge_extra` contract in `ipcBridge.ts:336-347` and `buildContextHandoffExtraPatch` (`contextConversationUpdate.ts:35`) and make the test match whichever nesting that helper actually produces.** Do not guess; the PATCH body spreads `updates` directly, so the wrong nesting writes a field nothing reads and the test would have to be wrong to pass.

### Step 5.3 — Commit

- [ ] `git commit -am "feat(creative-studio): carry the brief rules into every Director turn"`

---

## Task 6 — The Director proposes a rule, on the existing propose/accept protocol

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (:274-278)
- Modify: `packages/desktop/src/common/types/project/creativeStudioProposalDiff.ts` (:46-53)
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (:194, :390-405)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (:808-840, :967-978, :1194-1204)
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Test: `tests/unit/process/creative-studio/store.test.ts`, `tests/unit/process/creative-studio/types/proposalDiff.test.ts`, `tests/unit/process/creative-studio/creativeStudioService.test.ts`

**Reuse is viable, verified, and cheap.** `writeProposalRecord` (`studioProposalWriter.ts:28`) is already generic over `StudioProposalPayload`; `store.acceptProposal` (`store.ts:2182`) takes the apply function as a **parameter**; the `list-proposals` / `accept-proposal` / `reject-proposal` channels and their schemas already exist, so this task adds **zero** IPC and needs no `nativePayloadSchemas` edit; and the card already mounts in the Director pane, which survives phase change. Four things block it and all four are in code we own:

1. `PROPOSAL_PAYLOAD_KEYS` is exact and `validateProposalPayload` requires `kind === 'replace_storyboard'` and `sceneOrder.length > 0`. A rule payload would be written to disk and then **skipped with only a log line** (`store.ts:1464`) — the silent-failure class. Fixed by branching the validator on `kind` in this task, before any rule record can be written.
2. `computeStudioProposalDiff` reads `payload.sceneOrder` unconditionally. `tsc` catches it once the union lands (discriminated-union narrowing works with `strict` off — `tsconfig.json` sets only `noImplicitAny`).
3. Rule and storyboard proposals share one 50-slot queue (`STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT`, `store.ts:212`; `MAX_PENDING_PER_PROJECT`, `studioPendingRecordWriter.ts:13`). Accepted: rule proposals are rare and single-record, and the tool refuses on `capacity` with a message the Director can read.
4. `acceptProposal` CASes on `proposal.baseRevision`. Accepted and defensible: the Director pins a rule against the script it saw, and the card's existing "repropose" path (`DirectorProposalCard.tsx:58`, `DirectorProposals.tsx:58`) already handles staleness.

### Step 6.1 — Write the failing store test

- [ ] Add to `tests/unit/process/creative-studio/store.test.ts`:

```ts
it('accepts a pin_rule proposal record and refuses one with an unknown key', async () => {
  const { store, root } = await createStore();
  const created = await store.createProject(projectInput());
  const pendingDir = path.join(root, created.id, 'proposals', 'pending');
  await fs.mkdir(path.join(root, created.id, 'proposals', 'slots'), { recursive: true });
  await fs.mkdir(pendingDir, { recursive: true });

  const good = {
    schemaVersion: 1,
    id: 'proposal_rule',
    projectId: created.id,
    status: 'pending',
    baseRevision: created.revision,
    payload: { kind: 'pin_rule', rule: { text: 'Keep the kits generic.', predicate: null } },
    createdAt: '2026-08-13T00:00:00.000Z',
    decidedAt: null,
  };
  await fs.writeFile(path.join(pendingDir, 'proposal_rule.json'), JSON.stringify(good), 'utf8');
  await fs.writeFile(
    path.join(pendingDir, 'proposal_bad.json'),
    JSON.stringify({ ...good, id: 'proposal_bad', payload: { ...good.payload, sceneOrder: [] } }),
    'utf8'
  );

  const proposals = await store.listProposals(created.id);

  expect(proposals.map((proposal) => proposal.id)).toEqual(['proposal_rule']);
});
```

- [ ] Add to `tests/unit/process/creative-studio/types/proposalDiff.test.ts`:

```ts
it('is not offered a rule payload: only the storyboard variant has an order to diff', () => {
  // @ts-expect-error a pin_rule payload has no sceneOrder, and the compiler must say so.
  computeStudioProposalDiff({ sceneOrder: [], scenes: {} }, { kind: 'pin_rule', rule: { text: 'x', predicate: null } });
});
```

- [ ] Run both and see them fail:

```
bun run test tests/unit/process/creative-studio
```

Expected: the store test fails with `[ 'proposal_rule', 'proposal_bad' ]` vs `[ 'proposal_rule' ]` — no, it fails with `[]` vs `[ 'proposal_rule' ]`, because today's validator rejects both. The diff test fails with `Unused '@ts-expect-error' directive`.

### Step 6.2 — Widen the payload union

- [ ] In `creativeStudioTypes.ts`, replace `StudioProposalPayload` (:274-278) with:

```ts
/** A complete replacement for the editable storyboard region named by a proposal. */
export type StudioReplaceStoryboardProposalPayload = {
  kind: 'replace_storyboard';
  sceneOrder: string[];
  scenes: Record<string, StudioEditableScene>;
};

/**
 * One rule the Director wants pinned to the project.
 *
 * A rule pin rides the proposal protocol rather than a new pending-record family: the writer, the
 * slot reservation, the CAS on accept, the decision ledger, the three IPC channels and the card in
 * the Director pane all already exist and are all kind-agnostic. What is NOT kind-agnostic is
 * `validateProposalPayload` — see store.ts — which is why the discriminant must be validated
 * per-kind before any record of this shape reaches disk.
 */
export type StudioPinRuleProposalPayload = {
  kind: 'pin_rule';
  rule: {
    text: string;
    predicate: StudioBriefRulePredicate | null;
  };
};

export type StudioProposalPayload = StudioReplaceStoryboardProposalPayload | StudioPinRuleProposalPayload;
```

- [ ] In `creativeStudioProposalDiff.ts`, change the import and the signature:

```ts
import type {
  StudioEditableScene,
  StudioEditableSceneField,
  StudioProposalDiff,
  StudioProposalSceneChange,
  StudioReplaceStoryboardProposalPayload,
} from './creativeStudioTypes';
```

```ts
export const computeStudioProposalDiff = (
  current: StudioProposalDiffSource,
  payload: StudioReplaceStoryboardProposalPayload
): StudioProposalDiff => {
```

- [ ] Run the compiler to enumerate the narrow sites:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: errors in `creativeStudioService.ts` (`rememberProposalDiff`, `applyProposalPayload`) and `DirectorProposalCard.tsx` (`resolveProposalDiff`, and the `payload.sceneOrder` list render).

### Step 6.3 — Branch the store validator

- [ ] In `store.ts`, replace `const PROPOSAL_PAYLOAD_KEYS = new Set(['kind', 'sceneOrder', 'scenes']);` with:

```ts
const PROPOSAL_STORYBOARD_PAYLOAD_KEYS = new Set(['kind', 'sceneOrder', 'scenes']);
const PROPOSAL_PIN_RULE_PAYLOAD_KEYS = new Set(['kind', 'rule']);
const PROPOSAL_RULE_KEYS = new Set(['text', 'predicate']);
```

- [ ] Replace `validateProposalPayload` (:390-405) with:

```ts
const validateStoryboardProposalPayload = (value: Record<string, unknown>): boolean => {
  if (!isRecord(value.scenes) || !hasExactKeys(value, PROPOSAL_STORYBOARD_PAYLOAD_KEYS)) return false;
  const scenes = value.scenes;
  const sceneOrder = value.sceneOrder;
  if (!asArrayOfSafeIds(sceneOrder)) return false;
  const sceneIds = Object.keys(scenes);
  return (
    sceneOrder.length > 0 &&
    sceneOrder.length <= 24 &&
    new Set(sceneOrder).size === sceneOrder.length &&
    sceneIds.length === sceneOrder.length &&
    sceneIds.every((sceneId) => sceneOrder.includes(sceneId) && validateProposalScene(scenes[sceneId]))
  );
};

const validatePinRuleProposalPayload = (value: Record<string, unknown>): boolean =>
  hasExactKeys(value, PROPOSAL_PIN_RULE_PAYLOAD_KEYS) &&
  isRecord(value.rule) &&
  hasExactKeys(value.rule, PROPOSAL_RULE_KEYS) &&
  isNonEmptyString(value.rule.text) &&
  value.rule.text.length <= STUDIO_RULE_LIMITS.text &&
  validateBriefRulePredicate(value.rule.predicate);

const validateProposalPayload = (value: unknown): value is StudioProposalPayload => {
  if (!isRecord(value) || containsForbiddenRendererField(value)) return false;
  if (value.kind === 'replace_storyboard') return validateStoryboardProposalPayload(value);
  if (value.kind === 'pin_rule') return validatePinRuleProposalPayload(value);
  return false;
};
```

- [ ] Run and see the store test pass:

```
bun run test tests/unit/process/creative-studio/store.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 6.4 — Branch the service apply and skip the diff

- [ ] In `creativeStudioService.ts`, replace `applyProposalPayload`'s signature and prepend the branch:

```ts
const applyProposalPayload = (
  project: StudioProject,
  payload: StudioProposalPayload,
  minted: { ruleId: string; timestamp: string }
): StudioProject => {
  if (payload.kind === 'pin_rule') {
    const text = payload.rule.text.trim();
    // Idempotent: accepting a duplicate is a no-op rather than an error, because the user pressing
    // Accept twice, or pinning a rule they already had, is not a failure they can act on.
    const duplicate = resolveEffectiveStudioRules(project.rules).some(
      (rule) => foldForRuleMatch(rule.text.trim()) === foldForRuleMatch(text)
    );
    if (duplicate) return project;
    if (project.rules.length >= STUDIO_RULE_LIMITS.maxRules) throw invalid('Studio rule limit reached');
    return {
      ...project,
      rules: [
        ...project.rules,
        {
          id: minted.ruleId,
          scope: 'project' as const,
          text,
          predicate:
            payload.rule.predicate === null
              ? null
              : { kind: 'forbidden_terms' as const, terms: payload.rule.predicate.terms.map((term) => term.trim()) },
          createdAt: minted.timestamp,
        },
      ],
    };
  }
  const proposedIds = new Set(payload.sceneOrder);
  // …existing body unchanged from here…
```

Add `foldForRuleMatch` and `resolveEffectiveStudioRules` to the imports.

- [ ] Narrow `rememberProposalDiff` (:967). Insert immediately after `if (frozen !== undefined) return frozen;`:

```ts
// Only a storyboard replace has an order to diff. A rule pin has no positional shape at all.
if (proposal.payload.kind !== 'replace_storyboard') return undefined;
```

- [ ] Update the accept call site (:1197):

```ts
const accepted = await deps.store.acceptProposal(input.projectId, input.proposalId, (project, payload) =>
  applyProposalPayload(project, payload, { ruleId: createRuleId(), timestamp: new Date().toISOString() })
);
```

- [ ] Run the compiler:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: only `DirectorProposalCard.tsx` errors remain (fixed in Task 7).

### Step 6.5 — Write the failing MCP-tool test

- [ ] Add to `tests/unit/process/creative-studio/creativeStudioService.test.ts`:

```ts
it('records a rule the user reviews, and generates nothing', async () => {
  const { service, root } = await createService({ createRuleId: () => 'rule_minted' });
  const project = await service.createProject(projectInput());
  const handler = createProposeBriefRuleHandler({
    projectId: project.id,
    projectDir: path.join(root, project.id),
    pendingDir: path.join(root, project.id, 'proposals', 'pending'),
    referencePendingDir: path.join(root, project.id, 'reference-requests', 'pending'),
    routeCatalog: null,
  });

  const result = await handler({
    base_revision: project.revision,
    text: 'Keep the kits generic.',
    forbidden_terms: ['acme'],
  });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain('recorded for user review');
  const [proposal] = await service.listProposals({ projectId: project.id });
  expect(proposal.payload).toEqual({
    kind: 'pin_rule',
    rule: { text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } },
  });

  const accepted = await service.acceptProposal({ projectId: project.id, proposalId: proposal.id });
  expect(accepted.project.rules).toEqual([
    {
      id: 'rule_minted',
      scope: 'project',
      text: 'Keep the kits generic.',
      predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    },
  ]);
});

it('refuses a rule drafted against a stale revision instead of pinning the wrong thing', async () => {
  const { service, root } = await createService();
  const project = await service.createProject(projectInput());
  const handler = createProposeBriefRuleHandler({
    projectId: project.id,
    projectDir: path.join(root, project.id),
    pendingDir: path.join(root, project.id, 'proposals', 'pending'),
    referencePendingDir: path.join(root, project.id, 'reference-requests', 'pending'),
    routeCatalog: null,
  });

  const result = await handler({ base_revision: project.revision + 1, text: 'x', forbidden_terms: [] });

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('read_storyboard');
});
```

Import `createProposeBriefRuleHandler` from `@process/resources/builtinMcp/studioServer`.

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `createProposeBriefRuleHandler is not exported by …/studioServer.ts`.

### Step 6.6 — Add the MCP tool

- [ ] In `studioServer.ts`, add the imports:

```ts
import { STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
```

- [ ] Add the input type next to `ProposeStoryboardInput` (:43):

```ts
export type ProposeBriefRuleInput = {
  base_revision: number;
  text: string;
  forbidden_terms: string[];
};
```

- [ ] Add the handler after `createProposeStoryboardHandler`:

```ts
/**
 * Records a rule for the user to pin. The tool never writes the project: main is the sole writer of
 * the CAS-guarded store, and the user decides.
 *
 * Every limit here is the store's limit, not this tool's preference. The record goes straight to the
 * pending directory and is validated only when the store reads it back, so a field this schema
 * admits and `validateBriefRulePredicate` refuses is written to disk, reported to the Director as
 * "recorded for user review", and then dropped on read with nothing but a log line — see the
 * warning above STUDIO_EDITABLE_SCENE_LIMITS, which `purpose` learned the hard way.
 */
export function createProposeBriefRuleHandler(
  config: StudioServerEnv | null
): (input: ProposeBriefRuleInput) => Promise<StudioToolResult> {
  return async ({ base_revision, text, forbidden_terms }) => {
    if (!config) return errorResult('Creative Studio project is unavailable.');
    const trimmed = text.trim();
    if (trimmed.length === 0) return errorResult('A rule needs text.');
    if (trimmed.length > STUDIO_RULE_LIMITS.text) {
      return errorResult(`A rule must be at most ${STUDIO_RULE_LIMITS.text} characters.`);
    }
    const terms = forbidden_terms.map((term) => term.trim()).filter((term) => term.length > 0);
    if (new Set(terms).size !== terms.length) return errorResult('forbidden_terms must not repeat a word.');
    try {
      const project = await readProject(config);
      if (project.revision !== base_revision) {
        return errorResult(
          `The project is at revision ${project.revision}; you proposed against ${base_revision}. ` +
            'Call read_storyboard and redraft.'
        );
      }
      if (project.rules.length >= STUDIO_RULE_LIMITS.maxRules) {
        return errorResult(`This project already holds the maximum of ${STUDIO_RULE_LIMITS.maxRules} rules.`);
      }
      const record = await writeProposalRecord({
        pendingDir: config.pendingDir,
        projectId: config.projectId,
        baseRevision: base_revision,
        payload: {
          kind: 'pin_rule',
          rule: { text: trimmed, predicate: terms.length === 0 ? null : { kind: 'forbidden_terms', terms } },
        },
      });
      return {
        content: [
          {
            type: 'text',
            text: `Rule ${record.id} recorded for user review; nothing is pinned until the user accepts it.`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof StudioProposalWriteError) return errorResult(error.message);
      return errorResult(
        `Creative Studio rule could not be recorded: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

- [ ] Register it in `registerStudioTools`, after `propose_storyboard`:

```ts
server.tool(
  'propose_brief_rule',
  'Record one project rule for the user to pin. Use it when the user states a standing constraint ("keep the kits generic", "never show a competitor logo") — offer to pin it, then call this. Requires base_revision from your latest read_storyboard. A rule with forbidden_terms is ENFORCED: main refuses any visual prompt containing one of those words before anything is generated, so only list words that must never appear. Leave forbidden_terms empty for a rule that is guidance you should follow but nothing can check. This pins nothing on its own; the user decides.',
  {
    base_revision: z
      .number()
      .int()
      .positive()
      .describe('The revision you saw in read_storyboard. Re-read if your last read is stale.'),
    text: z
      .string()
      .min(1)
      .max(STUDIO_RULE_LIMITS.text)
      .describe('One sentence, in the user’s own words where possible.'),
    forbidden_terms: z
      .array(z.string().min(1).max(STUDIO_RULE_LIMITS.term))
      .max(STUDIO_RULE_LIMITS.maxTerms)
      .describe('Words that must never appear in a visual prompt. Empty for an unenforced rule.'),
  },
  createProposeBriefRuleHandler(config)
);
```

- [ ] Also fix the stale sentence in `propose_storyboard`'s description (:288): replace `"a proposal the user reviews in Brief"` with `"a proposal the user reviews in the Director pane"`. Proposals moved out of Brief; the tool has been lying to the model since.

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio
```

Expected: `Test Files  11 passed (11)` (or whatever the current count is — no failures).

### Step 6.7 — Commit

- [ ] `git commit -am "feat(creative-studio): let the Director propose a rule through the proposal protocol"`

---

## Task 7 — The proposal card renders a rule pin

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposalCard.tsx` (:58-63, :143-170)
- Test: `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx`

### Step 7.1 — Write the failing DOM test

- [ ] Add to `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx` (match the file's existing `renderCard` / fixture helpers):

```ts
it('shows a rule pin as the rule itself, with its enforced words, and no shot diff', async () => {
  const { getByText, queryByText } = renderCard({
    proposal: proposalFixture({
      payload: {
        kind: 'pin_rule',
        rule: { text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] } },
      },
    }),
  });

  expect(getByText('Rule to pin')).toBeInTheDocument();
  expect(getByText('Keep the kits generic.')).toBeInTheDocument();
  expect(getByText('Forbidden words: acme, globex')).toBeInTheDocument();
  expect(queryByText(/shot/i)).not.toBeInTheDocument();
});

it('does not compute a shot diff for a rule pin, even at a stale revision', async () => {
  const { queryByText } = renderCard({
    project: projectFixture({ revision: 9 }),
    proposal: proposalFixture({
      baseRevision: 3,
      payload: { kind: 'pin_rule', rule: { text: 'Keep the kits generic.', predicate: null } },
    }),
  });

  expect(queryByText('The change this proposal would make is no longer knowable.')).not.toBeInTheDocument();
});
```

Use the actual en-US strings for the two new keys once Task 12 lands them; until then the assertions fail on the missing copy, which is the intended failing state.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx
```

Expected: `Unable to find an element with the text: Rule to pin`.

### Step 7.2 — Branch the card

- [ ] In `DirectorProposalCard.tsx`, narrow `resolveProposalDiff`:

```ts
const resolveProposalDiff = (project: StudioRendererProject, proposal: StudioProposal): StudioProposalDiff | null => {
  // A rule pin has no positional shape, so there is nothing to diff and nothing to be unknowable about.
  if (proposal.payload.kind !== 'replace_storyboard') return null;
  const frozen = normaliseStudioProposalDiff(proposal.diff);
  if (frozen !== undefined) return frozen;
  if (project.revision !== proposal.baseRevision) return null;
  return computeStudioProposalDiff(project, proposal.payload);
};
```

- [ ] Add a rule branch. Immediately before the existing `return (` at the end of the component, insert:

```ts
  if (proposal.payload.kind === 'pin_rule') {
    const { rule } = proposal.payload;
    return (
      <Card title={t('conversation.creativeStudio.rules.proposalTitle')}>
        <p>{t('conversation.creativeStudio.rules.proposalBody')}</p>
        <p>{rule.text}</p>
        {rule.predicate !== null && (
          <p>{t('conversation.creativeStudio.rules.proposalTerms', { terms: rule.predicate.terms.join(fieldSeparator) })}</p>
        )}
        <div className='flex gap-8px'>
          <Button type='primary' loading={pending} onClick={() => void accept()}>
            {t('conversation.creativeStudio.brief.proposalAccept')}
          </Button>
          <Button disabled={pending} onClick={() => void reject()}>
            {t('conversation.creativeStudio.brief.proposalReject')}
          </Button>
        </div>
        {messageKey !== null && (
          <div role='status' aria-live='polite'>
            {t(messageKey)}
          </div>
        )}
        {stale && (
          <Button onClick={() => void onRepropose()}>{t('conversation.creativeStudio.brief.proposalRepropose')}</Button>
        )}
      </Card>
    );
  }
```

- [ ] Confirm the compiler is clean:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: no output. `proposal.payload.sceneOrder` in the storyboard branch is now narrowed by the early return.

- [ ] Run the DOM test (it stays red until Task 12 adds the copy; that is expected and noted here so nobody "fixes" it by hardcoding English):

```
bun run test tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx
```

Expected: the two new tests fail on missing i18n keys, rendering the raw key. All pre-existing tests in the file pass.

### Step 7.3 — Commit

- [ ] `git commit -am "feat(creative-studio): render a rule pin in the Director proposal card"`

---

## Task 8 — The rules drawer

**Files**

- Create: `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.tsx`, `StudioRulesDrawer.module.css`, `index.ts`
- Create: `tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/index.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/types.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseShell.tsx` (:104-137)
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify the four `StudioPhaseControllers` fixtures

**Why not in Brief.** `docs/design/creative-studio-2-engine-strip.md:54` already disqualified Brief for the engine picker on exactly this test — "CS2's shell is Table / Board / Cut and Brief is not one of the three", and the three-pane record calls Brief's work panel "explicitly provisional" (`creative-studio-three-pane-design.md:158`). The same sentence disqualifies it here. Brief is also a _draft_ surface: anything sited next to the brief textarea inherits `beforeMutation` (`StudioPage.tsx:300-306`), which force-saves the user's prose mid-sentence and silently refuses the write when a flush fails. Rules govern the document, so they belong to the frame (category 2 in the three-pane sorting rule at `:340-361`).

**Why not the Director pane.** The pane is a fixed 352px and `.proposals` is already capped at `max-height: 45%` with its own scroll (`DirectorPane.module.css:42-50`). An unbounded list there fights the proposal card for half a column. The pane is right for the _card_, wrong for the _list_.

### Step 8.1 — Write the failing DOM test

- [ ] Create `tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StudioRulesDrawer } from '@/renderer/pages/studio/components/Rules';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const project = (rules: unknown[] = []) => ({ id: 'project_1', revision: 4, rules }) as never;

describe('StudioRulesDrawer', () => {
  it('lists the locked organisation layer as unremovable and the project rules as removable', () => {
    render(
      <StudioRulesDrawer
        visible
        project={project([
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the kits generic.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ])}
        organisationRules={[
          {
            id: 'org_1',
            scope: 'organisation',
            text: 'No competitor brands.',
            predicate: { kind: 'forbidden_terms', terms: ['acme'] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ]}
        onClose={vi.fn()}
        onSetRules={vi.fn()}
      />
    );

    expect(screen.getByText('No competitor brands.')).toBeInTheDocument();
    expect(screen.getByText('Keep the kits generic.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'conversation.creativeStudio.rules.removeAccessible' })).toHaveLength(
      1
    );
  });

  it('sends the whole list with the new rule appended, carrying the project revision', async () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer
        visible
        project={project([
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the kits generic.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ])}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
      />
    );

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.textLabel'), {
      target: { value: 'No competitor logos.' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.rules.termsLabel'), {
      target: { value: 'acme, globex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    await waitFor(() => expect(onSetRules).toHaveBeenCalledTimes(1));
    expect(onSetRules.mock.calls[0][0]).toEqual([
      { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
      {
        id: expect.any(String),
        text: 'No competitor logos.',
        predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] },
      },
    ]);
  });

  it('refuses an empty rule and never calls the command', () => {
    const onSetRules = vi.fn(async () => true);
    render(
      <StudioRulesDrawer visible project={project()} organisationRules={[]} onClose={vi.fn()} onSetRules={onSetRules} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.invalidText');
    expect(onSetRules).not.toHaveBeenCalled();
  });

  it('refuses to add past the cap, so the store never rejects a write the UI allowed', () => {
    const onSetRules = vi.fn(async () => true);
    const rules = Array.from({ length: 24 }, (_, index) => ({
      id: `rule_${index}`,
      scope: 'project',
      text: `Rule ${index}.`,
      predicate: null,
      createdAt: '2026-08-13T00:00:00.000Z',
    }));
    render(
      <StudioRulesDrawer
        visible
        project={project(rules)}
        organisationRules={[]}
        onClose={vi.fn()}
        onSetRules={onSetRules}
      />
    );

    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.add' })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.rules.limitReached')).toBeInTheDocument();
  });
});
```

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx
```

Expected: `Failed to resolve import "@/renderer/pages/studio/components/Rules"`.

### Step 8.2 — Build the drawer

- [ ] Create `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.module.css`:

```css
.body {
  composes: body from '../../StudioTypography.module.css';
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.description {
  margin: 0;
  color: var(--color-text-2);
}

.list {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rule {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--color-border-2);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--color-bg-2);
}

.ruleCopy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.ruleText {
  margin: 0;
  color: var(--text-primary);
}

.ruleMeta {
  composes: meta from '../../StudioTypography.module.css';
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--color-text-3);
}

.form {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--color-border-2);
  padding-top: 16px;
}

.label {
  composes: meta from '../../StudioTypography.module.css';
}

.help,
.limit {
  margin: 0;
  color: var(--color-text-3);
  font-size: 12px;
}

.error {
  color: var(--color-danger-6);
  font-size: 12px;
}
```

- [ ] Create `packages/desktop/src/renderer/pages/studio/components/Rules/StudioRulesDrawer.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Drawer, Input, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ORGANISATION_STUDIO_RULES,
  STUDIO_RULE_LIMITS,
  type StudioBriefRule,
  type StudioBriefRuleDraft,
} from '@/common/types/project/creativeStudioRules';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import styles from './StudioRulesDrawer.module.css';

export type StudioRulesDrawerProps = {
  visible: boolean;
  project: Pick<StudioRendererProject, 'id' | 'revision' | 'rules'>;
  /** Injected so tests can exercise the locked layer while it ships empty. */
  organisationRules?: readonly StudioBriefRule[];
  pending?: boolean;
  errorMessageKey?: string | null;
  onClose: () => void;
  onSetRules: (rules: StudioBriefRuleDraft[]) => Promise<boolean>;
};

const toDraft = (rule: StudioBriefRule): StudioBriefRuleDraft => ({
  id: rule.id,
  text: rule.text,
  predicate: rule.predicate === null ? null : { kind: 'forbidden_terms', terms: [...rule.predicate.terms] },
});

const parseTerms = (value: string): string[] => {
  const terms = value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return [...new Set(terms)];
};

/**
 * The document's rule list.
 *
 * It lives in the app frame rather than in a phase for two reasons written down elsewhere: CS2's
 * shell is Table / Board / Cut and Brief is not one of the three (engine-strip.md:54), and Brief is
 * a draft surface whose every mutation forces a project-draft flush (StudioPage beforeMutation).
 * Rules govern the whole document, so the frame owns them and they survive the phase-4 swap.
 *
 * Writes go through the dedicated set-brief-rules command, never through the project draft: the
 * draft resends every field on every flush and dirty-tracks per field, so a rules array there is
 * clobbered wholesale whenever a Director pin races a brief keystroke.
 */
export const StudioRulesDrawer: React.FC<StudioRulesDrawerProps> = ({
  visible,
  project,
  organisationRules = ORGANISATION_STUDIO_RULES,
  pending = false,
  errorMessageKey = null,
  onClose,
  onSetRules,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [terms, setTerms] = useState('');
  const [invalid, setInvalid] = useState<'text' | 'terms' | null>(null);
  const parsedTerms = parseTerms(terms);
  const atLimit = organisationRules.length + project.rules.length >= STUDIO_RULE_LIMITS.maxRules;

  const add = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > STUDIO_RULE_LIMITS.text) {
      setInvalid('text');
      return;
    }
    if (
      parsedTerms.length > STUDIO_RULE_LIMITS.maxTerms ||
      parsedTerms.some((term) => term.length > STUDIO_RULE_LIMITS.term)
    ) {
      setInvalid('terms');
      return;
    }
    setInvalid(null);
    const draft: StudioBriefRuleDraft = {
      id: window.crypto.randomUUID().replaceAll('-', '_'),
      text: trimmed,
      predicate: parsedTerms.length === 0 ? null : { kind: 'forbidden_terms', terms: parsedTerms },
    };
    if (await onSetRules([...project.rules.map(toDraft), draft])) {
      setText('');
      setTerms('');
    }
  };

  const remove = async (ruleId: string): Promise<void> => {
    await onSetRules(project.rules.filter((rule) => rule.id !== ruleId).map(toDraft));
  };

  return (
    <Drawer
      visible={visible}
      title={t('conversation.creativeStudio.rules.title')}
      width={480}
      footer={null}
      onCancel={onClose}
    >
      <div className={styles.body}>
        <p className={styles.description}>{t('conversation.creativeStudio.rules.description')}</p>
        <p className={styles.description}>{t('conversation.creativeStudio.rules.precedence')}</p>

        {organisationRules.length === 0 && project.rules.length === 0 ? (
          <p className={styles.description}>{t('conversation.creativeStudio.rules.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {[...organisationRules, ...project.rules].map((rule) => (
              <li key={rule.id} className={styles.rule}>
                <div className={styles.ruleCopy}>
                  <p className={styles.ruleText}>{rule.text}</p>
                  <div className={styles.ruleMeta}>
                    <Tag>
                      {t(
                        rule.scope === 'organisation'
                          ? 'conversation.creativeStudio.rules.scope.organisation'
                          : 'conversation.creativeStudio.rules.scope.project'
                      )}
                    </Tag>
                    <Tag>
                      {t(
                        rule.predicate === null
                          ? 'conversation.creativeStudio.rules.contextOnlyBadge'
                          : 'conversation.creativeStudio.rules.enforcedBadge'
                      )}
                    </Tag>
                    {rule.scope === 'organisation' && (
                      <Tag>{t('conversation.creativeStudio.rules.scope.organisationLocked')}</Tag>
                    )}
                    {rule.predicate !== null && <span>{rule.predicate.terms.join(', ')}</span>}
                  </div>
                </div>
                {rule.scope === 'project' && (
                  <Button
                    type='text'
                    status='danger'
                    disabled={pending}
                    aria-label={t('conversation.creativeStudio.rules.removeAccessible', { rule: rule.text })}
                    onClick={() => void remove(rule.id)}
                  >
                    {t('conversation.creativeStudio.rules.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.form}>
          <label htmlFor='studio-rule-text' className={styles.label}>
            {t('conversation.creativeStudio.rules.textLabel')}
          </label>
          <Input
            id='studio-rule-text'
            value={text}
            error={invalid === 'text'}
            maxLength={STUDIO_RULE_LIMITS.text}
            placeholder={t('conversation.creativeStudio.rules.textPlaceholder')}
            aria-label={t('conversation.creativeStudio.rules.textLabel')}
            onChange={setText}
          />
          {invalid === 'text' && (
            <span role='alert' className={styles.error}>
              {t('conversation.creativeStudio.rules.invalidText')}
            </span>
          )}

          <label htmlFor='studio-rule-terms' className={styles.label}>
            {t('conversation.creativeStudio.rules.termsLabel')}
          </label>
          <Input
            id='studio-rule-terms'
            value={terms}
            error={invalid === 'terms'}
            placeholder={t('conversation.creativeStudio.rules.termsPlaceholder')}
            aria-label={t('conversation.creativeStudio.rules.termsLabel')}
            onChange={setTerms}
          />
          <p className={styles.help}>{t('conversation.creativeStudio.rules.termsHelp')}</p>
          {invalid === 'terms' && (
            <span role='alert' className={styles.error}>
              {t('conversation.creativeStudio.rules.invalidTerms')}
            </span>
          )}

          {atLimit && <p className={styles.limit}>{t('conversation.creativeStudio.rules.limitReached')}</p>}
          {errorMessageKey !== null && (
            <span role='alert' className={styles.error}>
              {t(errorMessageKey)}
            </span>
          )}
          <Button type='primary' loading={pending} disabled={atLimit || pending} onClick={() => void add()}>
            {t('conversation.creativeStudio.rules.add')}
          </Button>
        </div>
      </div>
    </Drawer>
  );
};
```

- [ ] Create `packages/desktop/src/renderer/pages/studio/components/Rules/index.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export { StudioRulesDrawer, type StudioRulesDrawerProps } from './StudioRulesDrawer';
```

- [ ] Add `export * from './Rules';` to `packages/desktop/src/renderer/pages/studio/components/index.ts`.

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx
```

Expected: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.

- [ ] Run the stylesheet gate, which reads every `composes:` path off disk:

```
bun run test tests/unit/pages/studio/studioStylesheetComposes.test.ts
```

Expected: `Test Files  1 passed (1)`. If it fails, the `composes` relative path is wrong — `Rules/` sits two levels under `pages/studio`, so `../../StudioTypography.module.css` is correct.

### Step 8.3 — Mount it from the frame

- [ ] In `components/PhaseShell/types.ts`, add to `StudioPhaseControllers`:

```ts
  /** Opens the document's rule list. The frame owns it, so every phase can reach it. */
  openRules: () => void;
```

- [ ] In `StudioPhaseShell.tsx`, change the `actions` prop:

```tsx
        actions={
          <>
            <Button size='small' disabled={navigationDisabled} onClick={controller.openRules}>
              {t('conversation.creativeStudio.rules.open')}
            </Button>
            {headerAction}
          </>
        }
```

`Button` is already imported there; check and add if not. "Rules" does not match the e2e's `phaseCtaPattern` (`/^(Start writing|Continue to Produce|Review cut|Prepare handoff)$/`), so `page.getByRole('button', { name: phaseCtaPattern })).toHaveCount(1)` (`creative-studio.e2e.ts:261`) stays satisfied.

- [ ] In `StudioPage.tsx`, add state, the handler, and the mount:

```tsx
const [rulesOpen, setRulesOpen] = useState(false);
const [rulesPending, setRulesPending] = useState(false);
const [rulesErrorMessageKey, setRulesErrorMessageKey] = useState<string | null>(null);

const setBriefRules = useCallback(
  async (rules: StudioBriefRuleDraft[]): Promise<boolean> => {
    if (project === null) return false;
    setRulesPending(true);
    setRulesErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.setBriefRules.invoke({
        projectId: project.id,
        expectedRevision: project.revision,
        rules,
      });
      if (result.ok === false) {
        setRulesErrorMessageKey(result.error.messageKey);
        return false;
      }
      studioProject.applyProject(result.data);
      return true;
    } finally {
      setRulesPending(false);
    }
  },
  [project, studioProject]
);
```

Use whatever the page's existing "adopt a fresh renderer project" call is named — search `StudioPage.tsx` for how `updateProject`'s result is applied and mirror it exactly. Then, next to `<GenerationReviewModal … />`:

```tsx
{
  project !== null && (
    <StudioRulesDrawer
      visible={rulesOpen}
      project={project}
      pending={rulesPending}
      errorMessageKey={rulesErrorMessageKey}
      onClose={() => setRulesOpen(false)}
      onSetRules={setBriefRules}
    />
  );
}
```

and add `openRules: () => setRulesOpen(true),` to the controllers object.

- [ ] Add `openRules: vi.fn(),` to all four `StudioPhaseControllers` fixtures:
  - `tests/unit/e2e/creativeStudioSelectors.dom.test.tsx` (:181-213)
  - `tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx` (:141-261)
  - `tests/unit/pages/studio/StudioPhaseShell.dom.test.tsx`
  - `tests/unit/pages/studio/Storyboard/Brief/BriefPhase.dom.test.tsx`

**Tests are not typechecked** (`tsconfig.json` `include` is `packages/desktop/src` only), so a missed fixture yields a runtime `undefined` handler, not a compile error. Grep to be sure: `grep -rln "requestTransition" tests/unit | sort`.

- [ ] Run the fixtures' owners:

```
bun run test tests/unit/pages/studio tests/unit/e2e/creativeStudioSelectors.dom.test.tsx
```

Expected: no failures other than the i18n keys still missing (Task 12). In particular `resolves every layout selector in the spec to exactly one element` and `matches nothing when no shell advisory is raised` must both stay green — the Rules button adds no `role="alert"` and no `data-studio-*` hook.

### Step 8.4 — Commit

- [ ] `git commit -am "feat(creative-studio): add the document rules drawer to the work-area toolbar"`

---

## Task 9 — The gate main cannot be talked out of

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts` (:93-100, :575-590)
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (:503-520)
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts` (:26-45)
- Test: `tests/unit/process/creative-studio/jobManager.test.ts`

**Why `resolveProvider` and nowhere else.** It is the only point where `(project, scene, resolved prompt, output role, resolved route)` are all in hand: `baseRequest.prompt = (output.role === 'reference' ? output.referencePrompt : scene.visualPrompt).trim()` at `jobManager.ts:579`. It is on **both** paid entry points — `submitScenes` (`:1297`) and `retryJob` (`:1498`) — so a check in `creativeStudioService.submitScenes` would miss retry entirely. And for `outputRole: 'reference'` the prompt exists **only in the request**, never on the durable record (see the comment at `:1436`), so a check reading `scene.visualPrompt` from the store cannot see reference-plate prompts at all. It runs before `persistPreparedJobs` (`:1300`) and before `trackRun(… runSubmission …)` (`:1302`), so a breach costs nothing.

**Why the renderer is not enough.** `StudioPage.tsx:500-552` auto-submits Director-queued reference requests **with no modal and no human confirm**. The Director itself cannot submit — `registerStudioTools` exposes four (now five) tools and none is a paid call — but the renderer path it triggers is real spend.

Also do not repeat `batchSceneIsReady`'s mistake: it is applied only when `input.mode === 'batch'` (`creativeStudioService.ts:1911`), so single-mode submissions skip it. `resolveProvider` covers single, batch and retry by construction.

### Step 9.1 — Write the failing test

- [ ] Add to `tests/unit/process/creative-studio/jobManager.test.ts` (match the file's existing harness helpers):

```ts
it('refuses a submission whose visual prompt breaks an enforced rule, before anything is spent', async () => {
  const harness = await createHarness();
  await harness.setRules([
    {
      id: 'rule_1',
      scope: 'project',
      text: 'No competitor logos.',
      predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      createdAt: '2026-08-13T00:00:00.000Z',
    },
  ]);
  await harness.setScenePrompt('scene_1', 'An ACME billboard at dusk');

  await expect(harness.submitScene('scene_1')).rejects.toMatchObject({ code: 'rule_breach' });
  expect(harness.adapter.submit).not.toHaveBeenCalled();
  expect(Object.keys((await harness.getProject()).jobs)).toEqual([]);
});

it('refuses a reference plate whose own prompt breaks a rule, which the durable record never holds', async () => {
  const harness = await createHarness();
  await harness.setRules([
    {
      id: 'rule_1',
      scope: 'project',
      text: 'No competitor logos.',
      predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      createdAt: '2026-08-13T00:00:00.000Z',
    },
  ]);
  await harness.setScenePrompt('scene_1', 'A clean studio plate');

  await expect(
    harness.submitScene('scene_1', { outputRole: 'reference', referencePrompt: 'An ACME logo, centred' })
  ).rejects.toMatchObject({ code: 'rule_breach' });
  expect(harness.adapter.submit).not.toHaveBeenCalled();
});

it('refuses a retry that would resend a breaching prompt', async () => {
  const harness = await createHarness();
  await harness.setScenePrompt('scene_1', 'An ACME billboard at dusk');
  const job = await harness.submitScene('scene_1');
  await harness.failJob(job.id, 'provider_error');
  await harness.setRules([
    {
      id: 'rule_1',
      scope: 'project',
      text: 'No competitor logos.',
      predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      createdAt: '2026-08-13T00:00:00.000Z',
    },
  ]);

  await expect(harness.retryJob(job.id)).rejects.toMatchObject({ code: 'rule_breach' });
});

it('lets a prompt through when the rule carries no predicate', async () => {
  const harness = await createHarness();
  await harness.setRules([
    {
      id: 'rule_1',
      scope: 'project',
      text: 'Keep the kits generic.',
      predicate: null,
      createdAt: '2026-08-13T00:00:00.000Z',
    },
  ]);
  await harness.setScenePrompt('scene_1', 'A generic kit on a plain background');

  await expect(harness.submitScene('scene_1')).resolves.toMatchObject({ sceneId: 'scene_1' });
});
```

If the harness has no `setRules`, add one that writes through the store's `updateProject`. Read the file's existing helper block and extend it in the same style rather than inventing a parallel one.

- [ ] Run and see it fail:

```
bun run test tests/unit/process/creative-studio/jobManager.test.ts
```

Expected: the first three fail because the promise resolves instead of rejecting.

### Step 9.2 — Add the code and the gate

- [ ] In `creativeStudioTypes.ts`, add to `StudioCommandErrorCode` after `'invalid_route'`:

```ts
  | 'rule_breach'
```

- [ ] In `jobManager.ts`, add to `StudioJobManagerErrorCode` after `'invalid_route'`:

```ts
  | 'rule_breach'
```

`toCommandError` (`creativeStudioBridge.ts:56`) maps `StudioJobManagerError.code` straight through for every code except `invalid_request`, so no mapping change is needed — but `errorMessageKeys` is a `Record` over the union and the compiler will demand the entry.

- [ ] In `creativeStudioBridge.ts`, add to `errorMessageKeys`:

```ts
  rule_breach: 'conversation.creativeStudio.errors.ruleBreach',
```

- [ ] In `jobManager.ts`, add the import:

```ts
import { evaluateStudioRules, resolveEffectiveStudioRules } from '@/common/types/project/creativeStudioRules';
```

- [ ] Insert the gate in `resolveProvider`, immediately after `if (!baseRequest.prompt) invalidRequest();` (:586):

```ts
/**
 * The money gate for pinned rules.
 *
 * Here and nowhere else: this is the only point where the resolved prompt exists for BOTH paid
 * entry points (submitScenes and retryJob) and for both output roles — a reference plate's
 * prompt lives only in the request, never on the durable record, so a check that read
 * scene.visualPrompt from the store would not see it. It is also strictly before
 * persistPreparedJobs and trackRun, so a breach costs nothing.
 *
 * The renderer runs the same evaluator to say the consequence before Confirm is pressable. This
 * one exists because the Director's queued reference requests are auto-submitted with no modal.
 */
const breaches = evaluateStudioRules(resolveEffectiveStudioRules(project.rules), baseRequest.prompt).breaches;
if (breaches.length > 0) throw new StudioJobManagerError('rule_breach');
```

- [ ] Run and see it pass:

```
bun run test tests/unit/process/creative-studio/jobManager.test.ts
```

Expected: `Test Files  1 passed (1)`.

- [ ] Confirm the compiler is clean:

```
bunx tsc --noEmit -p tsconfig.json
```

Expected: no output.

### Step 9.3 — Commit

- [ ] `git commit -am "feat(creative-studio): refuse a paid render that breaks a pinned rule"`

---

## Task 10 — Say the consequence before it runs

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx` (:37-45, :159-215, :270-350)
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` (:82-124, :500-552)
- Test: `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`

The breach alert goes **inside the modal**, which Arco portals to `body`. It must not be a direct child of the phase shell: the e2e asserts `[data-studio-phase-shell] > [role="alert"]` has count 0 when no advisory is raised (`creative-studio.e2e.ts:588`, guarded by `creativeStudioSelectors.dom.test.tsx:325`), and `assertStudioInvariants` caps visible alerts at one. Reuse the existing per-scene `<Alert type='error'>` shape and the existing `disabledReason` `role="status"` slot; add no new alert outside the modal.

### Step 10.1 — Write the failing DOM test

- [ ] Add to `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`:

```ts
it('names the breached rule on the shot and blocks Confirm before anything is charged', () => {
  renderModal({
    scenes: [reviewScene({ id: 'scene_1', title: 'Opening', promptText: 'An ACME billboard' })],
    ruleBreachesBySceneId: {
      scene_1: [{ ruleId: 'rule_1', ruleText: 'No competitor logos.', scope: 'project', matchedTerm: 'acme' }],
    },
  });

  expect(screen.getByText('conversation.creativeStudio.rules.breachScene')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
  expect(screen.getByText('conversation.creativeStudio.rules.breachBlockedConfirm')).toBeInTheDocument();
});

it('offers to hand the breach to the Director rather than leaving a dead end', () => {
  const onAskDirector = vi.fn();
  renderModal({
    scenes: [reviewScene({ id: 'scene_1', title: 'Opening', promptText: 'An ACME billboard' })],
    ruleBreachesBySceneId: {
      scene_1: [{ ruleId: 'rule_1', ruleText: 'No competitor logos.', scope: 'project', matchedTerm: 'acme' }],
    },
    onAskDirector,
  });

  fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.rules.breachAskDirector' }));

  expect(onAskDirector).toHaveBeenCalledTimes(1);
});

it('leaves Confirm alone when no rule is breached', () => {
  renderModal({ scenes: [reviewScene({ id: 'scene_1', title: 'Opening', promptText: 'A clean plate' })] });

  expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeEnabled();
});
```

Extend the file's `reviewScene()` helper with `promptText` and its `renderModal()` with the two new props.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx
```

Expected: `Unable to find an element with the text: conversation.creativeStudio.rules.breachScene`.

### Step 10.2 — Wire the modal

- [ ] In `GenerationReviewModal.tsx`, add to `GenerationReviewScene`:

```ts
/**
 * The exact string main will send as the prompt: the reference plate's own prompt for
 * outputRole 'reference', the scene's visual prompt otherwise. It mirrors jobManager's
 * `output.role === 'reference' ? output.referencePrompt : scene.visualPrompt`, because a rule
 * verdict computed against a different string than main checks is worse than no verdict.
 */
promptText: string;
```

- [ ] Add to `GenerationReviewModalProps`:

```ts
  /** Breaches computed by the page with the same shared evaluator main uses. */
  ruleBreachesBySceneId?: Record<string, StudioRuleBreach[]>;
  /** Hands the breach to the Director. Absent hides the affordance. */
  onAskDirector?: () => void;
```

and import `StudioRuleBreach` from `@/common/types/project/creativeStudioRules`.

- [ ] Destructure `ruleBreachesBySceneId = {}` and `onAskDirector` in the component signature.

- [ ] Inside the `useMemo`, add before the `return`:

```ts
const ruleBreached = scenes.some((scene) => (ruleBreachesBySceneId[scene.id] ?? []).length > 0);
```

add `ruleBreached,` to the returned object, add `&& !ruleBreached` to `canConfirm`, and add `ruleBreachesBySceneId` to the dependency array.

- [ ] Inside the per-scene `<article>`, after the existing invalid-route `<Alert>` block, add:

```tsx
{
  (ruleBreachesBySceneId[scene.id] ?? []).map((breach) => (
    <Alert
      key={breach.ruleId}
      className='mt-10px'
      type='error'
      content={t('conversation.creativeStudio.rules.breachScene', {
        rule: breach.ruleText,
        term: breach.matchedTerm,
      })}
    />
  ));
}
```

- [ ] Replace the `disabledReason` derivation with:

```ts
const disabledReason = review.ruleBreached
  ? 'conversation.creativeStudio.rules.breachBlockedConfirm'
  : review.missingRoute || review.invalidRoute
    ? 'conversation.creativeStudio.review.disabledMissingRoutes'
    : null;
```

- [ ] Add the escape hatch next to `disabledReason`'s render:

```tsx
{
  review.ruleBreached && onAskDirector !== undefined && (
    <div>
      <Button onClick={onAskDirector}>{t('conversation.creativeStudio.rules.breachAskDirector')}</Button>
    </div>
  );
}
```

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx
```

Expected: `Test Files  1 passed (1)`.

### Step 10.3 — Supply the prompt and the verdict from the page

- [ ] In `StudioPage.tsx` `toReviewScene`, add after `durationSeconds: scene.durationSeconds,`:

```ts
    promptText: outputRole === 'reference' ? (referencePrompt ?? '') : scene.visualPrompt,
```

- [ ] Add the verdict, memoised on the review and the project's rules:

```tsx
const effectiveRules = useMemo(() => (project === null ? [] : resolveEffectiveStudioRules(project.rules)), [project]);
const ruleBreachesBySceneId = useMemo(() => {
  if (generationReview === null) return {};
  const breaches: Record<string, StudioRuleBreach[]> = {};
  for (const scene of generationReview.scenes) {
    const verdict = evaluateStudioRules(effectiveRules, scene.promptText);
    if (verdict.breaches.length > 0) breaches[scene.id] = verdict.breaches;
  }
  return breaches;
}, [effectiveRules, generationReview]);
```

- [ ] Pass both to the modal:

```tsx
ruleBreachesBySceneId = { ruleBreachesBySceneId };
onAskDirector = { askDirectorAboutBreaches };
```

(`askDirectorAboutBreaches` lands in Task 11. Until then pass `undefined` and the affordance stays hidden.)

- [ ] Guard the auto-submit path. In the queued-reference effect (:500-552), insert immediately after `const submission = collectSubmittableRoutes(review.scenes);` and its null check:

```ts
// The Director's queued reference requests are the one paid path with no human confirm, so the
// rule check happens here too. Main refuses this batch anyway; going through the modal instead
// means the user sees WHICH rule blocked WHICH shot rather than a bare refusal, and the queued
// requests survive to be answered.
const breached = review.scenes.some(
  (scene) => evaluateStudioRules(resolveEffectiveStudioRules(project.rules), scene.promptText).breaches.length > 0
);
if (breached) {
  openQueuedReferenceReview();
  return;
}
```

- [ ] Add the imports (`evaluateStudioRules`, `resolveEffectiveStudioRules`, `type StudioRuleBreach`, `type StudioBriefRuleDraft`, `StudioRulesDrawer`) and `useMemo` if missing.

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio
```

Expected: no failures other than the missing i18n keys (Task 12).

### Step 10.4 — Commit

- [ ] `git commit -am "feat(creative-studio): surface a rule breach before the money gate"`

---

## Task 11 — The breach feedback loop

**Files**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposals.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Test: `tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx`

This is the channel that works regardless of what aioncore does with `pinned_context`: when a prompt breaks a rule, the Director is told, in the turn where it matters, with the rule quoted. `DirectorProposals.repropose` (`:58-63`) is the exact shape — a verbatim instruction sent through `conversation.sendMessage` with `pinned_context` attached.

### Step 11.1 — Write the failing test

- [ ] Add to `tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx`:

```ts
it('quotes the rule and the shot when handing a breach to the Director', async () => {
  await sendDirectorInstruction({
    conversation,
    instruction: describeRuleBreachInstruction([
      { sceneTitle: 'Opening', ruleText: 'No competitor logos.', matchedTerm: 'acme' },
    ]),
  });

  expect(sendMessage).toHaveBeenCalledTimes(1);
  const [payload] = sendMessage.mock.calls[0] as [{ input: string; conversation_id: string }];
  expect(payload.conversation_id).toBe('conversation_brief');
  expect(payload.input).toContain('No competitor logos.');
  expect(payload.input).toContain('Opening');
  expect(payload.input).toContain('acme');
  expect(payload.input).toContain('Rewrite');
});
```

Import `describeRuleBreachInstruction` and `sendDirectorInstruction` from the component module.

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx
```

Expected: `describeRuleBreachInstruction is not exported`.

### Step 11.2 — Extract the sender and add the instruction

- [ ] In `DirectorProposals.tsx`, replace the private `repropose` with an exported helper and add the breach instruction:

```ts
export type StudioRuleBreachReport = {
  sceneTitle: string;
  ruleText: string;
  matchedTerm: string;
};

/**
 * Sent verbatim when a rule blocked a render. English, like REPROPOSE_INSTRUCTION and every other
 * model-facing literal in Studio: localising the model's instructions makes its behaviour depend on
 * the UI language. This is also the channel that does not depend on anything aioncore does with
 * pinned_context — the Director learns the rule at the moment it matters.
 */
export const describeRuleBreachInstruction = (reports: readonly StudioRuleBreachReport[]): string =>
  [
    'A pinned project rule blocked this render before anything was charged. Nothing was generated.',
    ...reports.map(
      (report) =>
        `- Shot "${report.sceneTitle}" breaks the rule "${report.ruleText}" (the word "${report.matchedTerm}").`
    ),
    'Rewrite the visual prompts so they satisfy the rule, then propose the change. Do not ask to remove the rule.',
  ].join('\n');

/** One send site for every Studio-initiated Director turn, so pinned_context is never forgotten. */
export const sendDirectorInstruction = async (input: {
  conversation: StudioBriefConversation;
  instruction: string;
}): Promise<void> => {
  await ipcBridge.conversation.sendMessage.invoke({
    input: input.instruction,
    conversation_id: input.conversation.id,
    files: [],
    pinned_context: getConversationPinnedContext(input.conversation),
  });
};
```

- [ ] Rewrite the component's `repropose` to use it:

```ts
const repropose = async (): Promise<void> => {
  if (conversation.state.kind !== 'ready') return;
  await sendDirectorInstruction({ conversation: conversation.state.conversation, instruction: REPROPOSE_INSTRUCTION });
};
```

Import `StudioBriefConversation` from `../PhaseShell/phases/brief/useBriefConversation`.

- [ ] In `StudioPage.tsx`, add the handler and pass it to the modal:

```tsx
const askDirectorAboutBreaches = useCallback((): void => {
  if (generationReview === null || briefConversation.state.kind !== 'ready') return;
  const reports = generationReview.scenes.flatMap((scene) =>
    (ruleBreachesBySceneId[scene.id] ?? []).map((breach) => ({
      sceneTitle: scene.title,
      ruleText: breach.ruleText,
      matchedTerm: breach.matchedTerm,
    }))
  );
  if (reports.length === 0) return;
  void sendDirectorInstruction({
    conversation: briefConversation.state.conversation,
    instruction: describeRuleBreachInstruction(reports),
  });
  setGenerationReview(null);
}, [briefConversation.state, generationReview, ruleBreachesBySceneId]);
```

`briefConversation` is the value the page already provides to `BriefConversationProvider`; find that call and reuse the same handle rather than calling the hook a second time (`useBriefConversation` guards one start per project with a module-scope map, but a second instance is still a second subscriber).

- [ ] Run and see it pass:

```
bun run test tests/unit/pages/studio
```

Expected: no failures other than the missing i18n keys.

### Step 11.3 — Commit

- [ ] `git commit -am "feat(creative-studio): tell the Director which rule blocked which shot"`

---

## Task 12 — The i18n work

**Files**

- Modify: `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,en-US,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`
- Modify: `tests/unit/pages/studio/studioI18n.test.ts` (:16-40, :229-244, :246-270, and the presence-list block near :383)
- Modify: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts` (generated)

**Measured budget, not estimated.** Verified against the repo today: 12 locales, reference `en-US`, 463 string leaves under `conversation.creativeStudio`, **429** after filtering plural variants (that is the cap denominator), so the cap is `Math.max(4, floor(429 × 0.05)) = 21`. Copied-English leaves per locale right now: de-DE 12 (headroom 9), tr-TR 8, pt-BR 8, es-ES 5, ru-RU 4, uk-UA 4, ko-KR 2, zh-CN/zh-TW/ja-JP/fa-IR 1.

This task adds **38 reference keys**: 37 under a new `rules` group and one, `errors.ruleBreach`, in the existing `errors` group. The denominator becomes 467, so the cap rises to 23 and de-DE's headroom becomes 11 — already partly spent by existing loanwords. **Machine-copying English fails the build.** 21 of the 38 are full sentences and go on `streamFullSentenceKeys`, where the tolerance is zero (`studioI18n.test.ts:546`). One is plural (`rules.breachSummary`), and each plural logical key costs **38 authored strings**, not 12 (26 variants across the 12 locales — measured with `Intl.PluralRules` — plus 12 fallback bases), with ru-RU/uk-UA `_one`/`_few`/`_many` required to be mutually distinct (`:660-666`).

Totals: **482 strings authored, 442 of them non-English.** Budget the translation pass accordingly; it is the largest single cost in this plan.

**One new group, not four nested homes.** The vocabulary genuinely spans Brief (authoring), the Director pane (the pin card) and the money gate (the breach). Scattering one concept across `phase.brief` / `brief` / `errors` / `phase.shared` is how the "four distinct keys all reading Report Issue" collision class gets made. One line in `plannedGroups` now beats a permanent naming hazard — and moving keys later costs a second 12-locale round.

### Step 12.1 — Write the failing gate edits

- [ ] In `studioI18n.test.ts`, add `'rules',` to `plannedGroups` in sorted position (between `'routing'` and `'scene'`).

- [ ] Add the presence list next to `briefKeys` (:42):

```ts
const rulesKeys = [
  'rules.title',
  'rules.open',
  'rules.description',
  'rules.precedence',
  'rules.empty',
  'rules.textLabel',
  'rules.textPlaceholder',
  'rules.termsLabel',
  'rules.termsPlaceholder',
  'rules.termsHelp',
  'rules.add',
  'rules.remove',
  'rules.removeAccessible',
  'rules.invalidText',
  'rules.invalidTerms',
  'rules.limitReached',
  'rules.saveFailed',
  'rules.scope.project',
  'rules.scope.organisation',
  'rules.scope.organisationLocked',
  'rules.enforcedBadge',
  'rules.enforcedHelp',
  'rules.contextOnlyBadge',
  'rules.contextOnlyHelp',
  'rules.breachHeading',
  'rules.breachScene',
  'rules.breachSummary',
  'rules.breachBlockedConfirm',
  'rules.breachAskDirector',
  'rules.breachAsked',
  'rules.autoSubmitBlocked',
  'rules.proposalTitle',
  'rules.proposalBody',
  'rules.proposalTerms',
  'rules.proposalDuplicate',
  'rules.organisationUndistributed',
  'errors.ruleBreach',
] as const;
```

- [ ] In the `defines the complete planned group…` test, add the loop next to the `briefKeys` one:

```ts
for (const key of rulesKeys) {
  expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
}
```

- [ ] Add `'rules.breachSummary',` to `pluralLogicalKeys` (:229).

- [ ] Add the 20 non-plural full sentences to `streamFullSentenceKeys` (:246):

```ts
  'rules.description',
  'rules.precedence',
  'rules.empty',
  'rules.textPlaceholder',
  'rules.termsPlaceholder',
  'rules.termsHelp',
  'rules.removeAccessible',
  'rules.invalidText',
  'rules.invalidTerms',
  'rules.limitReached',
  'rules.saveFailed',
  'rules.enforcedHelp',
  'rules.contextOnlyHelp',
  'rules.breachScene',
  'rules.breachBlockedConfirm',
  'rules.breachAsked',
  'rules.autoSubmitBlocked',
  'rules.proposalBody',
  'rules.proposalDuplicate',
  'rules.organisationUndistributed',
  'errors.ruleBreach',
```

- [ ] Run and see it fail:

```
bun run test tests/unit/pages/studio/studioI18n.test.ts
```

Expected: `expected [ … 23 groups ] to deeply equal [ … 24 groups ]` plus `Missing conversation.creativeStudio.rules.title` and 37 more.

### Step 12.2 — Author the reference copy

- [ ] Add to `en-US/conversation.json` under `creativeStudio`, in sorted group position:

```json
    "rules": {
      "title": "Rules",
      "open": "Rules",
      "description": "Rules are the part of your brief that gets checked. A rule with forbidden words is enforced: a shot whose prompt contains one is refused before it costs anything.",
      "precedence": "Organisation rules apply everywhere and cannot be changed here. Project rules apply to this project. Anything you say in the conversation becomes a rule only when you pin it.",
      "empty": "No rules yet. Add one here, or tell the Director what to keep to and it will offer to pin it.",
      "textLabel": "Rule",
      "textPlaceholder": "One sentence, for example: keep the kits generic.",
      "termsLabel": "Forbidden words",
      "termsPlaceholder": "Separate words with commas, for example: acme, globex",
      "termsHelp": "Leave this empty for guidance the Director should follow but nothing can check.",
      "add": "Pin rule",
      "remove": "Remove",
      "removeAccessible": "Remove the rule {{rule}}",
      "invalidText": "A rule needs one sentence of up to 240 characters.",
      "invalidTerms": "Use up to 8 forbidden words, each of at most 64 characters.",
      "limitReached": "This project already holds the maximum of 24 rules. Remove one to add another.",
      "saveFailed": "The rule could not be saved. Someone else changed this project — reopen Rules and try again.",
      "scope": {
        "project": "Project",
        "organisation": "Organisation",
        "organisationLocked": "Locked"
      },
      "enforcedBadge": "Enforced",
      "enforcedHelp": "Checked against every shot's prompt before anything is generated.",
      "contextOnlyBadge": "Context only",
      "contextOnlyHelp": "The Director reads this rule, but nothing checks it automatically.",
      "breachHeading": "Blocked by a rule",
      "breachScene": "This shot breaks the rule “{{rule}}” — its prompt contains “{{term}}”.",
      "breachSummary_one": "{{count}} shot breaks a rule.",
      "breachSummary_other": "{{count}} shots break a rule.",
      "breachBlockedConfirm": "Nothing has been charged. Change the prompt, or ask the Director to rewrite it.",
      "breachAskDirector": "Ask the Director to fix it",
      "breachAsked": "The Director has been told which rule blocked which shot.",
      "autoSubmitBlocked": "The Director asked for reference images that break a rule, so nothing was generated. Review them here.",
      "proposalTitle": "Rule to pin",
      "proposalBody": "The Director suggests adding this rule to the project. Nothing is pinned until you accept.",
      "proposalTerms": "Forbidden words: {{terms}}",
      "proposalDuplicate": "This project already holds that rule, so nothing changed.",
      "organisationUndistributed": "No organisation rules have been distributed to this workspace yet."
    },
```

- [ ] Add to the existing `errors` group in `en-US/conversation.json`:

```json
      "ruleBreach": "A pinned rule blocked this render, and nothing was charged. Open Rules to see which one.",
```

- [ ] Run and confirm the reference is complete but the other locales are not:

```
bun run test tests/unit/pages/studio/studioI18n.test.ts
```

Expected: the planned-group and presence assertions pass; the parity test fails with `zh-CN is missing: errors.ruleBreach, rules.add, …` for all 11 non-reference locales.

### Step 12.3 — Translate all 11 non-reference locales

- [ ] For each of `zh-CN, ja-JP, zh-TW, ko-KR, tr-TR, ru-RU, uk-UA, pt-BR, de-DE, es-ES, fa-IR`, add the same `rules` group and `errors.ruleBreach` with **genuine translations**. Non-negotiable constraints, each enforced by a specific assertion:
  - Every `{{placeholder}}` must appear, spelled identically, in the same order (`studioI18n.test.ts:538-544`).
  - No value may equal its English counterpart for any of the 21 `streamFullSentenceKeys` additions (`:546-549`) — zero tolerance, no cap.
  - `rules.breachSummary` needs every plural suffix the locale requires: 1 form for zh-CN/zh-TW/ja-JP/ko-KR, 2 for tr-TR/de-DE/fa-IR, 3 for pt-BR/es-ES, 4 for ru-RU/uk-UA (`_one`/`_few`/`_many`/`_other`). The ru-RU and uk-UA `_one`/`_few`/`_many` templates must be **mutually distinct** (`:660-666`) and none may equal the English template (`:630`).
  - No value may be empty or whitespace (`:533-535`).
  - The `“ ”` curly quotes in `breachScene` are fine to replace with the locale's own quotation marks (e.g. `「」` for ja-JP, `«»` for ru-RU) — that is expected, not a placeholder mismatch.

- [ ] Run the whole i18n gate:

```
bun run test tests/unit/pages/studio/studioI18n.test.ts
```

Expected: `Test Files  1 passed (1)`. Any `leaves too much English copy` failure names the exact keys — translate those, do not raise the cap.

### Step 12.4 — Regenerate the key types and run the repo-wide copy sweeps

- [ ] Regenerate and verify:

```
bun run i18n:types && node scripts/check-i18n.js
```

Expected: `i18n:types` rewrites `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`; `check-i18n.js` prints no errors and exits 0. Both run in the CI gate (`.github/workflows/sprint3-pr-gate.yml:77-79`), so a stale generated file reds the build.

- [ ] Run the raw-key sweep, which renders all four phases in all 12 locales and fails on any visible `conversation.creativeStudio.` string or accessible name:

```
bun run test tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx
```

Expected: `Test Files  1 passed (1)`. Note it renders **without** `BriefConversationProvider` (the hook is mocked at `:60-66`), so any new surface reading a React context must degrade like `BriefConversationContext`'s `ABSENT` fallback (`:45-60`) rather than throw. The drawer reads no context, so this should pass unchanged.

- [ ] Re-run the two tests that were deliberately left red:

```
bun run test tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx
```

Expected: both green. Update the two `DirectorProposalCard` assertions to the real en-US strings (`Rule to pin`, `Forbidden words: acme, globex`) now that the copy exists.

### Step 12.5 — Commit

- [ ] `git commit -am "feat(creative-studio): add the rules copy in twelve locales"`

---

## Task 13 — Migration proof and the whole-suite gate

**Files**

- Test: `tests/unit/process/creative-studio/store.test.ts`, `tests/unit/process/creative-studio/creativeStudioService.test.ts`
- Modify: `docs/design/creative-studio-2-phase-1-brief-rules-plan.md` (this file — record the Step 5.0 answer)

The handoff promises a migration per phase and no user is ever asked to export and reimport. Task 2 delivered it (`migrateSchemaV1Project` defaults `rules: []` before validation). This task proves it end to end and closes the gate.

### Step 13.1 — Write the end-to-end migration test

- [ ] Add to `tests/unit/process/creative-studio/creativeStudioService.test.ts`:

```ts
it('opens a project written before rules existed, and the first rule write rewrites the record', async () => {
  const { service, root } = await createService();
  const project = await service.createProject(projectInput());
  const file = path.join(root, project.id, 'project.json');
  const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  delete raw.rules;
  await fs.writeFile(file, JSON.stringify(raw), 'utf8');

  const reopened = await service.getProject({ projectId: project.id });
  expect(reopened.rules).toEqual([]);
  expect(await service.listProjects()).toMatchObject({ quarantinedProjectIds: [] });

  const written = await service.setBriefRules({
    projectId: project.id,
    expectedRevision: reopened.revision,
    rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: null }],
  });
  const persisted = JSON.parse(await fs.readFile(file, 'utf8')) as { rules: unknown[]; revision: number };

  expect(persisted.rules).toHaveLength(1);
  expect(persisted.revision).toBe(written.revision);
});
```

Match the file's own `getProject` / `listProjects` result shapes; if `listProjects` returns a bare array, drop that assertion and use `store.listQuarantinedProjectIds()` instead as in Step 2.1.

- [ ] Run and see it pass (Task 2 already implemented the behaviour; this proves it at the service boundary):

```
bun run test tests/unit/process/creative-studio/creativeStudioService.test.ts
```

Expected: `Test Files  1 passed (1)`.

### Step 13.2 — Close the gate

- [ ] Run the whole suite in one invocation, never just the touched directory:

```
bun run test
```

Expected: `Test Files` all passed, `Tests` all passed with the pre-existing skips. Baseline before this work was **624 files / 8,126 passed / 19 skipped** — re-measure on `main` if the number differs rather than assuming a regression, and remember that BUG-043's readiness hardlink guard is a known intermittent that occasionally reds the job. Re-run once before investigating.

- [ ] Run the rest of the gate, in the CI order:

```
bunx tsc --noEmit -p tsconfig.json && bun run lint && bun run format:check && bun run i18n:types && node scripts/check-i18n.js
```

Expected: no output from `tsc`; `oxlint` reports no errors; `oxfmt --check` reports no files needing formatting; `check-i18n.js` exits 0. If `format:check` complains, run `bun run format` and re-commit — do not hand-fix.

- [ ] Prove the e2e specs still compile and resolve (no display needed):

```
bunx playwright test --list tests/e2e/features/workspaces/creative-studio.e2e.ts
```

Expected: the spec's test titles listed with no import or compile error. `--list` is the only e2e signal available without a display, and no test file in this repo is typechecked by `tsc`.

### Step 13.3 — Record the Step 5.0 answer and commit

- [ ] Write the aioncore `pinned_context` answer from Step 5.0 into this document's A4 section and into the MR description, together with the two convention-debt overages from A6.
- [ ] `git commit -am "test(creative-studio): prove the rules migration and close the gate"`
- [ ] **Do not push.** This worktree is explicitly no-push.

---

## Self-Review

### Spec coverage against the Phase 1 definition

| Requirement (from the handoff)                                                                 | Where it is implemented                                                                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "A CLAUDE.md, not a form" — small, human-readable, always in context                           | Task 1 (`renderStudioRulesBlock`), Task 4 (`read_storyboard` view), Task 5 (the pin)                                                                     | Met, **asymmetrically**: rules are pushed every turn, brief prose is pulled. A4 states why and what would change.                                                                                                                                                                                                                                                                          |
| "Loaded into every director turn, not read when opened"                                        | Task 5 (`pinned_context`, the only per-turn field on the send wire) + Task 4 (fresh per tool call) + Task 11 (told at the moment it matters)             | Met for **rules**. Not met for 16 KB brief prose — impossible against a 2,000-char pin ceiling. Named honestly, with the aioncore verification as Step 5.0.                                                                                                                                                                                                                                |
| "Accumulates from conversation — the director offers to pin it as a rule"                      | Task 6 (`propose_brief_rule` + payload union), Task 7 (the card)                                                                                         | Met, on the existing propose/accept protocol. Four blockers verified and each addressed.                                                                                                                                                                                                                                                                                                   |
| "Scope levels with explicit precedence"                                                        | Task 1 (`resolveEffectiveStudioRules`, `ORGANISATION_STUDIO_RULES`), Task 8 (scope badges + `rules.precedence`)                                          | Met for project + organisation. **Thread precedence is deferred**, with the reason in A5: it is inherently per-section and sections are phase 2. Organisation ships as a locked, empty layer because no distribution channel exists in this codebase.                                                                                                                                      |
| "Rules are the executable part — predicates run against every visual prompt before it renders" | Task 9 (`resolveProvider`), Task 10 (renderer pre-flight)                                                                                                | Met. Covers single, batch, retry and reference plates; the Director cannot bypass it.                                                                                                                                                                                                                                                                                                      |
| "Everything else in the brief is context the director reads"                                   | `predicate: null` rules and `project.brief` — Task 1's `contextOnlyBadge`, Task 4's `enforced: false`                                                    | Met.                                                                                                                                                                                                                                                                                                                                                                                       |
| "New sections inherit format, length, look references and cast"                                | —                                                                                                                                                        | **Gap, deliberate.** Sections are the phase-2 data model. Also collides with `propose_storyboard` being a whole-script replacement (`studioServer.ts:289`): an accepted proposal replaces every scene, so per-section inheritance needs the apply path to preserve section state, which does not exist yet. Recorded here so phase 2 inherits the constraint rather than rediscovering it. |
| "Say the consequence before it runs, never after"                                              | Task 10 (breach named on the shot, Confirm disabled, inside the modal, before submit)                                                                    | Met.                                                                                                                                                                                                                                                                                                                                                                                       |
| "Free is direct; money asks once"                                                              | Task 9 (the check is a pure synchronous function before `persistPreparedJobs` and `trackRun`)                                                            | Met — the check costs nothing and runs before the charge.                                                                                                                                                                                                                                                                                                                                  |
| "The assistant may never trigger a paid call on its own"                                       | Unchanged: the five MCP tools are all proposers. Task 10 additionally makes the auto-submit path fall back to the modal on a breach instead of spending. | Met, and strengthened.                                                                                                                                                                                                                                                                                                                                                                     |
| "§8: cheap — prompt assembly plus a check step, no new media stack"                            | No media code touched. The costs are the 482-string i18n pass (Task 12) and the payload-union widening (Task 6).                                         | Met, with the real cost centre named rather than hidden.                                                                                                                                                                                                                                                                                                                                   |
| A migration per phase; no user exports and reimports                                           | Task 2 (defaulted in `migrateSchemaV1Project`, which runs before `validateProject`), Task 13 (proved end to end)                                         | Met.                                                                                                                                                                                                                                                                                                                                                                                       |

### Placeholder scan

Every task states its files, shows real code for every step that changes code, and gives a real command with its expected output. Checked specifically for the failure modes named in the brief:

- **No "TBD", no "add appropriate error handling", no "write tests for the above".** Every test body is written out.
- **No "similar to Task N".** The `pinned_context` write is spelled out in Task 5; the `sendDirectorInstruction` shape is spelled out again in Task 11 rather than cross-referenced. The three `createProposeBriefRuleHandler` config objects in Task 6 are written in full each time.
- **Every type and function is defined before use.** `StudioBriefRule`, `StudioBriefRuleDraft`, `StudioBriefRulePredicate`, `StudioRuleBreach`, `StudioRuleVerdict`, `STUDIO_RULE_LIMITS`, `ORGANISATION_STUDIO_RULES`, `foldForRuleMatch`, `evaluateStudioRules`, `resolveEffectiveStudioRules`, `renderStudioRulesBlock`, `buildStudioBriefRulesPin`, `STUDIO_BRIEF_RULES_PIN_ID`, `STUDIO_BRIEF_RULES_PIN_MAX_CHARS` — all Task 1. `StudioSetBriefRulesRequest` — Task 3, before its provider. `StudioReplaceStoryboardProposalPayload` / `StudioPinRuleProposalPayload` — Task 6, before the validator branches. `ProposeBriefRuleInput` / `createProposeBriefRuleHandler` — Task 6, before registration. `StudioRuleBreachReport` / `describeRuleBreachInstruction` / `sendDirectorInstruction` — Task 11, before `StudioPage` calls them.
- **Three places deliberately leave a test red across tasks**, and each says so in the step: the two `DirectorProposalCard` assertions and the drawer's key assertions wait for Task 12's copy, and `onAskDirector` is passed `undefined` until Task 11. Fixing them early by hardcoding English would break the i18n gate.
- **Four places instruct the implementer to read the repo rather than trust this document**, because the exact local names could not be pinned from outside: the `createStore()`/`projectInput()`/`createService()` helper names in the three test files, the `merge_extra` nesting produced by `buildContextHandoffExtraPatch` (Step 5.2), the page's "adopt a fresh renderer project" call (Step 8.3), and the `jobManager.test.ts` harness helpers (Step 9.1). Each says what to look at and what the failure looks like if it is guessed wrong. That is a deliberate instruction, not a placeholder.

### Type consistency across tasks

- `StudioProject.rules` is **required** (Task 2). This is what makes `toRendererProject`'s omission a compile error, because `StudioRendererProject` is `Omit<StudioProject, 'jobs' | 'routing'> & {…}` and `toRendererProject` declares that return type. Step 2.2 includes an explicit stop-check: if `tsc` does not flag the projection, the field was declared optional and the silent-drop trap is live.
- `StudioBriefRule.scope` is `'project' | 'organisation'` in the type; the store validator admits only `'project'` (Step 2.3), and the organisation layer is code-resident. A store test asserts the refusal, so the two cannot drift silently.
- `evaluateStudioRules` is called with the **effective** rule list in all four call sites (Task 9 main, Task 10 modal verdict, Task 10 auto-submit, Task 5 pin), always via `resolveEffectiveStudioRules`. Calling it with raw `project.rules` would skip the organisation layer; that is the one consistency invariant a reviewer should check by grep: `grep -rn "evaluateStudioRules" packages/desktop/src` must show `resolveEffectiveStudioRules` on every line or the line above.
- `GenerationReviewScene.promptText` (Task 10) mirrors `jobManager.ts:579` exactly — `outputRole === 'reference' ? (referencePrompt ?? '') : scene.visualPrompt`. A different expression here would show a verdict against a different string than main checks, which is worse than showing none. The comment on the field says so.
- `'rule_breach'` is added to **both** `StudioJobManagerErrorCode` and `StudioCommandErrorCode` (Task 9). `toCommandError` passes job-manager codes straight through for everything but `invalid_request`, and `errorMessageKeys` is a `Record` over the command union, so the compiler forces the copy key. Verified against the actual mapping at `creativeStudioBridge.ts:56-74`.
- `StudioProposalPayload`'s union means `computeStudioProposalDiff` takes only the storyboard variant. Three call sites narrow: `rememberProposalDiff` (early return, Task 6), `resolveProposalDiff` (early return, Task 7), and the card's `payload.sceneOrder` list render (narrowed by Task 7's early return). `tsc` finds all three; Step 6.2 runs it explicitly to enumerate them.
- `buildStudioBriefRulesPin` returns `TContextHandoffItem | null` with `source: 'manual'` and a fixed `id`. Both are forced by facts, not taste: `contextPinSchema` is `.strict()` with `source: z.enum(['manual','context_md'])` (`payloadSchemas.ts:89-97`), so a Studio-specific source would be rejected by the compaction schema the moment Studio ever compacts; and the fixed id is the only way to rewrite in place without touching user pins, since the Director pane never mounts `ContextHandoffPanel` and the user cannot reach the pin UI (the conversation is filtered out of chat history by `ConversationHistoryContext.tsx:27`).

### Fixed during review

- The pin originally carried a truncated brief head as well as the rules. Removed: a 16 KB brief truncated to fit 2 KB alongside the rules is a misleading half-brief, and `read_storyboard` returns the whole thing fresh. The pin now carries rules plus one pointer sentence, and A4 states the asymmetry plainly instead of papering over it.
- `evaluateStudioRules` originally folded diacritics. Removed: folding merges distinct Vietnamese words (ca / cà / cá) and this product ships in Vietnamese. A test pins the behaviour and the code says why.
- The rules list was originally sited in `BriefPhase`. Moved to the frame after finding that `engine-strip.md:54` had already disqualified Brief on the identical shell-survival test, and that anything next to the brief textarea inherits the `beforeMutation` force-flush.
- Rules were originally going to ride `StudioProjectDraft`. Removed: `flushProjectDraft` resends every draft field on every flush and dirty-tracks per field, so a Director pin racing a brief keystroke would clobber the whole array. Replaced with the dedicated CAS'd `set-brief-rules` command modelled on `bindBriefConversation`.
- Both recon reports listed `PROJECT_KEYS` as an exact-key Set that must move. It does not exist. Corrected in A3; the correction removes a schema-version bump and a migration hazard from the cost,
