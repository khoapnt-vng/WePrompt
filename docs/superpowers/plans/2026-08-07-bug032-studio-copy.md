# BUG-032 Truthful Studio Assistant Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Describe the Creative Studio Write assistant as the one-shot storyboard drafting action it actually provides.

**Architecture:** Change one existing i18n leaf in every configured locale and add an exact locale contract test. Because an active Creative Studio branch owns the same files, execute only on that owner's immutable accepted/frozen head or let that owner apply the correction directly.

**Tech Stack:** JSON locale resources, i18next, TypeScript, Vitest 4.

## Global Constraints

- Initial status is `WAITING_DEPENDENCY`.
- Do not edit while `/Users/lap16603/Documents/WePrompt/.worktrees/creative-suite-sprint2` is dirty, changing, or not declared immutable by its owner.
- Safe path A: the Creative Studio owner applies this exact correction as a separate commit on its accepted branch.
- Safe path B: create `codex/bug032-studio-copy-r-${DONOR_SHORT}` from the literal frozen donor head.
- Owned paths are the 12 `conversation.json` locale files and `tests/unit/pages/studio/studioI18n.test.ts` only.
- Do not change `AssistantDock.tsx`, action behavior, provider/model labels, status, charge disclosure, feature flags, or future scene-assistance copy.
- Translations must mean only “Draft a storyboard from your brief.”
- Stop before push, merge request, merge, packaging, release, or `TASKS.md` reconciliation.

This plan is intentionally stored outside fresh worktrees at `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug032-studio-copy.md`. The Controller supplies that absolute path and its SHA-256 to either the Creative Studio owner (safe path A) or stores both in the dependent branch metadata (safe path B); the executing worker verifies the checksum before editing.

---

### Task 1: Prove the Creative Studio dependency is safe

**Files:**

- Read: `/Users/lap16603/Documents/WePrompt/.worktrees/creative-suite-sprint2`
- Modify: none

**Interfaces:**

- Consumes: the Creative Studio worktree's current branch, status, head, and owner declaration.
- Produces: imported immutable `CREATIVE_DONOR`, `DONOR_SHORT`, and durable dependent-branch metadata, or a `WAITING_DEPENDENCY` handoff.

- [ ] **Step 1: Record the current owner state**

Run:

```bash
CREATIVE_REPO=/Users/lap16603/Documents/WePrompt
CREATIVE_WT=/Users/lap16603/Documents/WePrompt/.worktrees/creative-suite-sprint2
git -C "$CREATIVE_WT" status --short --branch
git -C "$CREATIVE_WT" rev-parse HEAD
git -C "$CREATIVE_WT" diff --name-only origin/sprint2...HEAD -- \
  packages/desktop/src/renderer/services/i18n/locales \
  tests/unit/pages/studio/studioI18n.test.ts
```

Expected: the overlapping files are visible. Clean status alone is not an ownership release.

- [ ] **Step 2: Obtain the owner's immutable-head declaration**

The declaration must include the literal head, review verdict, and statement that no further Creative Studio edits will land on that head. If it is unavailable, stop and report BUG-032 as `WAITING_DEPENDENCY`; continue no locale work.

- [ ] **Step 3: Prove the declared head still matches disk**

From the Sprint recovery Controller worktree, set `CREATIVE_DONOR` and `CREATIVE_REF` to the literal values in the owner's declaration, then run:

```bash
CREATIVE_WT=/Users/lap16603/Documents/WePrompt/.worktrees/creative-suite-sprint2
test "$(git -C "$CREATIVE_WT" rev-parse HEAD)" = "$CREATIVE_DONOR"
test -z "$(git -C "$CREATIVE_WT" status --porcelain)"
DONOR_SHORT="$(git -C "$CREATIVE_WT" rev-parse --short=9 "$CREATIVE_DONOR")"
CONTROLLER_BRANCH="$(git branch --show-current)"
git config "branch.$CONTROLLER_BRANCH.codexCreativeDonor" "$CREATIVE_DONOR"
git config "branch.$CONTROLLER_BRANCH.codexCreativeRef" "$CREATIVE_REF"
git config "branch.$CONTROLLER_BRANCH.codexCreativeOwnerWorktree" "$CREATIVE_WT"
```

Expected: both checks pass and the literal owner declaration is durable in Controller branch metadata. If either fails, return to `WAITING_DEPENDENCY`.

- [ ] **Step 4: Import and verify the frozen donor object without mutating either remote**

Run from the Sprint recovery Controller worktree. Set `CREATIVE_REF` to the literal branch/ref in the owner's declaration, then recover the Sprint base from the Controller's branch metadata:

```bash
CREATIVE_REPO=/Users/lap16603/Documents/WePrompt
CONTROLLER_BRANCH="$(git branch --show-current)"
S2_BASE="$(git config --get "branch.$CONTROLLER_BRANCH.codexBase")"
CREATIVE_DONOR="$(git config --get "branch.$CONTROLLER_BRANCH.codexCreativeDonor")"
CREATIVE_REF="$(git config --get "branch.$CONTROLLER_BRANCH.codexCreativeRef")"
test -n "$S2_BASE"
test -n "$CREATIVE_DONOR"
test -n "$CREATIVE_REF"
git fetch --no-tags "$CREATIVE_REPO" "$CREATIVE_REF"
test "$(git rev-parse FETCH_HEAD)" = "$CREATIVE_DONOR"
git cat-file -e "$CREATIVE_DONOR^{commit}"
git merge-base --is-ancestor "$S2_BASE" "$CREATIVE_DONOR"
```

Expected: the local fetch imports only from the separate clone, `FETCH_HEAD` is the declared donor, the commit object exists in the Controller repository, and the current Sprint recovery base is its ancestor. If ancestry fails, do not rebase or reconcile here; return BUG-032 to `WAITING_DEPENDENCY` until Creative Studio supplies an accepted head based on the current Sprint base.

- [ ] **Step 5: Select one ownership path**

Choose exactly one path. Each command block independently recovers the Controller evidence; values do not depend on an earlier shell.

**Safe path A — owner applies the copy.** Before dispatch, persist the same evidence in the separate Creative Studio repository:

```bash
CONTROLLER_BRANCH="$(git branch --show-current)"
S2_BASE="$(git config --get "branch.$CONTROLLER_BRANCH.codexBase")"
CREATIVE_DONOR="$(git config --get "branch.$CONTROLLER_BRANCH.codexCreativeDonor")"
CREATIVE_WT="$(git config --get "branch.$CONTROLLER_BRANCH.codexCreativeOwnerWorktree")"
PLAN_PATH=/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug032-studio-copy.md
PLAN_SHA="$(shasum -a 256 "$PLAN_PATH" | awk '{print $1}')"
OWNER_BRANCH="$(git -C "$CREATIVE_WT" branch --show-current)"
git -C "$CREATIVE_WT" config "branch.$OWNER_BRANCH.codexBase" "$S2_BASE"
git -C "$CREATIVE_WT" config "branch.$OWNER_BRANCH.codexDonor" "$CREATIVE_DONOR"
git -C "$CREATIVE_WT" config "branch.$OWNER_BRANCH.codexOwnerWorktree" "$CREATIVE_WT"
git -C "$CREATIVE_WT" config "branch.$OWNER_BRANCH.codexSafePath" owner
git -C "$CREATIVE_WT" config "branch.$OWNER_BRANCH.codexPlanPath" "$PLAN_PATH"
git -C "$CREATIVE_WT" config "branch.$OWNER_BRANCH.codexPlanSha256" "$PLAN_SHA"
```

Then send the owner Tasks 2–3 and keep the dependent worker read-only.

**Safe path B — dependent worker.** Create the branch from the imported donor and persist the same evidence:

```bash
CONTROLLER_BRANCH="$(git branch --show-current)"
S2_BASE="$(git config --get "branch.$CONTROLLER_BRANCH.codexBase")"
CREATIVE_DONOR="$(git config --get "branch.$CONTROLLER_BRANCH.codexCreativeDonor")"
CREATIVE_WT="$(git config --get "branch.$CONTROLLER_BRANCH.codexCreativeOwnerWorktree")"
DONOR_SHORT="$(git rev-parse --short=9 "$CREATIVE_DONOR")"
PLAN_PATH=/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug032-studio-copy.md
PLAN_SHA="$(shasum -a 256 "$PLAN_PATH" | awk '{print $1}')"
BUG032_BRANCH="codex/bug032-studio-copy-r-$DONOR_SHORT"
BUG032_WT=".worktrees/bug032-studio-copy-r-$DONOR_SHORT"
git worktree add -b "$BUG032_BRANCH" "$BUG032_WT" "$CREATIVE_DONOR"
git config "branch.$BUG032_BRANCH.codexBase" "$S2_BASE"
git config "branch.$BUG032_BRANCH.codexDonor" "$CREATIVE_DONOR"
git config "branch.$BUG032_BRANCH.codexOwnerWorktree" "$CREATIVE_WT"
git config "branch.$BUG032_BRANCH.codexSafePath" dependent
git config "branch.$BUG032_BRANCH.codexPlanPath" "$PLAN_PATH"
git config "branch.$BUG032_BRANCH.codexPlanSha256" "$PLAN_SHA"
git -C "$BUG032_WT" status --short
test "$(git -C "$BUG032_WT" rev-parse HEAD)" = "$CREATIVE_DONOR"
```

Expected: the selected worktree is clean at the exact donor and carries durable base/donor/path/checksum metadata.

- [ ] **Step 6: Run the selected worker bootstrap guard**

From the selected safe-path worktree:

```bash
BRANCH="$(git branch --show-current)"
RECORDED_BASE="$(git config --get "branch.$BRANCH.codexBase")"
CREATIVE_DONOR="$(git config --get "branch.$BRANCH.codexDonor")"
SAFE_PATH="$(git config --get "branch.$BRANCH.codexSafePath")"
PLAN_PATH="$(git config --get "branch.$BRANCH.codexPlanPath")"
PLAN_SHA="$(git config --get "branch.$BRANCH.codexPlanSha256")"
test -n "$RECORDED_BASE"
case "$SAFE_PATH" in
  owner | dependent) ;;
  *) exit 1 ;;
esac
test "$(git rev-parse HEAD)" = "$CREATIVE_DONOR"
test "$(git merge-base "$RECORDED_BASE" HEAD)" = "$RECORDED_BASE"
test -z "$(git status --porcelain)"
test "$PLAN_PATH" = "/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug032-studio-copy.md"
test "$(shasum -a 256 "$PLAN_PATH" | awk '{print $1}')" = "$PLAN_SHA"
```

Expected: every check exits 0. Do not rely on Task 1 shell variables in the worker session.

### Task 2: Freeze the truthful 12-locale copy contract

**Files:**

- Modify: `tests/unit/pages/studio/studioI18n.test.ts:280-342`

**Interfaces:**

- Consumes: `loadConversationLocale(locale)` and `flattenStringLeaves`.
- Produces: exact, locale-specific expected values for `phase.write.assistantDescription`.

- [ ] **Step 1: Add the approved locale matrix**

Add:

```typescript
const writeAssistantDescriptionByLocale = {
  'de-DE': 'Erstelle aus deinem Briefing einen Storyboard-Entwurf.',
  'en-US': 'Draft a storyboard from your brief.',
  'es-ES': 'Crea un guion gráfico a partir de tu briefing.',
  'fa-IR': 'بر اساس بریف خود یک استوری‌بورد تهیه کنید.',
  'ja-JP': 'ブリーフをもとにストーリーボードを作成します。',
  'ko-KR': '브리프를 바탕으로 스토리보드를 작성합니다.',
  'pt-BR': 'Crie um storyboard a partir do seu briefing.',
  'ru-RU': 'Создайте раскадровку на основе брифа.',
  'tr-TR': 'Briefinizden bir storyboard oluşturun.',
  'uk-UA': 'Створіть розкадрування на основі брифу.',
  'zh-CN': '根据你的创作简报起草分镜脚本。',
  'zh-TW': '根據你的創作簡報起草分鏡腳本。',
} as const;
```

- [ ] **Step 2: Add the exact contract test**

```typescript
it.each(Object.entries(writeAssistantDescriptionByLocale))(
  'keeps the %s Write assistant promise within its one-shot capability',
  (locale, expected) => {
    const creativeStudio = loadConversationLocale(locale).creativeStudio;
    expect(isJsonObject(creativeStudio)).toBe(true);
    if (!isJsonObject(creativeStudio)) return;

    expect(flattenStringLeaves(creativeStudio)['phase.write.assistantDescription']).toBe(expected);
  }
);
```

- [ ] **Step 3: Run the exact test and verify RED**

Run:

```bash
bunx vitest run tests/unit/pages/studio/studioI18n.test.ts -t "one-shot capability"
```

Expected: all 12 cases fail against the broader current promises.

### Task 3: Replace only the 12 assistant descriptions

**Files:**

- Modify: `packages/desktop/src/renderer/services/i18n/locales/de-DE/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/es-ES/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/fa-IR/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/ja-JP/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/ko-KR/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/pt-BR/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/ru-RU/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/tr-TR/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/uk-UA/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/zh-CN/conversation.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/zh-TW/conversation.json`
- Test: `tests/unit/pages/studio/studioI18n.test.ts`

**Interfaces:**

- Consumes: the locale matrix from Task 2.
- Produces: identical narrow product meaning in every supported language.

- [ ] **Step 1: Replace one leaf per locale**

Set `conversation.creativeStudio.phase.write.assistantDescription` to the corresponding exact value in `writeAssistantDescriptionByLocale`. Change no sibling key.

- [ ] **Step 2: Run the complete Studio locale contract**

Run:

```bash
bunx vitest run tests/unit/pages/studio/studioI18n.test.ts
```

Expected: all Studio locale tests pass, including parity, non-empty, translated, placeholder, plural, and exact one-shot-copy checks.

- [ ] **Step 3: Run adjacent AssistantDock regressions**

Run:

```bash
bunx vitest run tests/unit/pages/studio/Storyboard/AssistantDock.dom.test.tsx
```

Expected: provider/model labels and charge disclosure remain unchanged and all tests pass.

- [ ] **Step 4: Format and statically verify the exact paths**

Run:

```bash
bunx oxfmt --write \
  packages/desktop/src/renderer/services/i18n/locales/*/conversation.json \
  tests/unit/pages/studio/studioI18n.test.ts
bunx oxfmt --check \
  packages/desktop/src/renderer/services/i18n/locales/*/conversation.json \
  tests/unit/pages/studio/studioI18n.test.ts
bunx oxlint tests/unit/pages/studio/studioI18n.test.ts
bunx tsc --noEmit
bun run i18n:types
node scripts/check-i18n.js
git diff --check
```

Expected: every command exits 0. Generated i18n types stay unchanged because no key was added.

- [ ] **Step 5: Re-prove the selected path before the broad gate**

Run from either selected worktree:

```bash
BRANCH="$(git branch --show-current)"
RECORDED_BASE="$(git config --get "branch.$BRANCH.codexBase")"
CREATIVE_DONOR="$(git config --get "branch.$BRANCH.codexDonor")"
CREATIVE_WT="$(git config --get "branch.$BRANCH.codexOwnerWorktree")"
SAFE_PATH="$(git config --get "branch.$BRANCH.codexSafePath")"
git cat-file -e "$CREATIVE_DONOR^{commit}"
test "$(git merge-base "$RECORDED_BASE" "$CREATIVE_DONOR")" = "$RECORDED_BASE"
test "$(git merge-base "$CREATIVE_DONOR" HEAD)" = "$CREATIVE_DONOR"
test "$(git rev-parse HEAD)" = "$CREATIVE_DONOR"
git diff --name-only "$CREATIVE_DONOR"
case "$SAFE_PATH" in
  dependent)
    test "$(git -C "$CREATIVE_WT" rev-parse HEAD)" = "$CREATIVE_DONOR"
    test -z "$(git -C "$CREATIVE_WT" status --porcelain)"
    ;;
  owner)
    test "$(pwd -P)" = "$(cd "$CREATIVE_WT" && pwd -P)"
    ;;
  *) exit 1 ;;
esac
```

Expected: both ancestry checks pass and the working-tree diff lists only the 12 locale files plus `studioI18n.test.ts`. On safe path B, the external owner also remains clean at the exact declared donor; any owner-head advance or dirty state returns BUG-032 to `WAITING_DEPENDENCY`. On safe path A, the executing worktree itself is the declared owner and no dependent worker exists.

- [ ] **Step 6: Hand the focused/static-green candidate to the Controller**

Report donor head, branch/head, dirty paths, focused totals, and static results. Wait for the serialized full-suite token.

- [ ] **Step 7: Run the full suite when authorized**

Run:

```bash
bun run test
```

Expected: exit 0. Record passed/skipped totals.

- [ ] **Step 8: Recheck the selected path after the broad suite**

Rerun all of Step 5. On safe path B, an external-owner change returns the lane to `WAITING_DEPENDENCY`. On safe path A, any new diff outside the 13 owned paths is a scope stop. Do not stage or commit on either failure.

- [ ] **Step 9: Stage exactly the 13 owned paths and commit**

Run:

```bash
git add \
  packages/desktop/src/renderer/services/i18n/locales/de-DE/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/es-ES/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/fa-IR/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/ja-JP/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/ko-KR/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/pt-BR/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/ru-RU/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/tr-TR/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/uk-UA/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/zh-CN/conversation.json \
  packages/desktop/src/renderer/services/i18n/locales/zh-TW/conversation.json \
  tests/unit/pages/studio/studioI18n.test.ts
git diff --cached --check
git commit -m "fix(studio): align write assistant copy"
```

Expected: one copy-only commit and clean tracked status.

- [ ] **Step 10: Freeze the exact selected-path head for review**

Run:

```bash
git status --short
test -z "$(git status --porcelain)"
git rev-parse HEAD
BRANCH="$(git branch --show-current)"
CREATIVE_DONOR="$(git config --get "branch.$BRANCH.codexDonor")"
CREATIVE_WT="$(git config --get "branch.$BRANCH.codexOwnerWorktree")"
SAFE_PATH="$(git config --get "branch.$BRANCH.codexSafePath")"
test "$(git merge-base "$CREATIVE_DONOR" HEAD)" = "$CREATIVE_DONOR"
case "$SAFE_PATH" in
  dependent)
    test "$(git -C "$CREATIVE_WT" rev-parse HEAD)" = "$CREATIVE_DONOR"
    test -z "$(git -C "$CREATIVE_WT" status --porcelain)"
    ;;
  owner)
    test "$(pwd -P)" = "$(cd "$CREATIVE_WT" && pwd -P)"
    ;;
  *) exit 1 ;;
esac
git diff --name-status "$CREATIVE_DONOR"...HEAD
```

Expected: only the 13 owned paths differ from the frozen donor. The review handoff must include the selected safe path plus both donor and candidate hashes.
