# Sprint 2 Bug-Fix Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile MR !98 and land BUG-041, BUG-036, and BUG-032 as separately reviewed, full-suite-gated Sprint 2 changes, followed by an honest register closeout.

**Architecture:** Treat the existing commits as immutable donor evidence, not accepted heads. Replay each bounded slice onto the latest accepted `origin/sprint2`, prove the behavior with focused tests, run renderer/i18n and repository-wide gates, then merge before admitting the next slice. Keep BUG-032 separate from BUG-036 even though they touch the same locale files.

**Tech Stack:** Git worktrees, GitLab CLI, Bun, Vitest 4, TypeScript, Oxfmt, Oxlint, i18next.

## Global Constraints

- Target branch is `sprint2`; refresh it after every accepted merge.
- Push only through `just push`; never call `git push` directly.
- Run the full suite at every slice merge, including docs-only register slices.
- Preserve the user's untracked `.agents/`, `.claude/e2e-locale-audit.raw.md`, and `dashboard.html` in the main checkout.
- Do not force-push, rewrite donor branches, enable Creative Studio, or touch backend, IPC, migration, packaging, or release paths.
- Use all languages from `packages/desktop/src/common/config/i18n-config.json`; the current set is `zh-CN`, `en-US`, `ja-JP`, `zh-TW`, `ko-KR`, `tr-TR`, `ru-RU`, `uk-UA`, `pt-BR`, `de-DE`, `es-ES`, and `fa-IR`.
- Stop if a donor depends on an excluded commit, the same unresolved full-suite failure repeats twice, or a branch needs non-fast-forward publication.
- `docs/superpowers/` is gitignored by repository policy; this plan is local execution state and must not be force-added.

---

### Task 1: Recover and merge MR !98

**Files:**
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: `origin/sprint2@51ceb0c802d460f24d97529d8d42f5f4c5d4a3fe`, local donor `docs/studio-bug-wave@594c1e64b`.
- Produces: a merged register head containing BUG-041, the Controller's Studio bug-wave decision, the third BUG-027-family sighting, and corrected BUG-016/A0+ facts.

- [ ] **Step 1: Verify the source branch is recoverable without rewriting history**

  In `/Users/lap16603/Projects/WePrompt/.worktrees/dr3-backend-bump`, run:

  ```bash
  git branch --show-current
  git status --short
  git rev-parse HEAD
  git rev-list --left-right --count origin/sprint2...HEAD
  ```

  Require branch `docs/studio-bug-wave`, a clean tracked tree, HEAD `594c1e64b`, and divergence `0 1`. Verify MR !98 has no remote SHA; recreating the missing source branch is a fast-forward publication, not a force-push.

- [ ] **Step 2: Correct BUG-016's stale test note**

  Replace the BUG-016 sentence claiming no test pins thinking exclusion with:

  ```markdown
  - Deliberate accompanying change: thinking rows no longer contribute to the turn recap, making the recap provider-independent rather than varying with whether a provider supplies subjects. `MessageToolGroupSummary.dom.test.tsx` pins the subject-bearing and subjectless cases through `keeps the turn recap independent of provider thinking subjects`.
  ```

- [ ] **Step 3: Correct the A0+/3 status without overstating acceptance**

  Replace the `A0+/3 ... not started` sentence with a merged-status record containing these exact facts:

  ```markdown
  **A0+/3 merged 2026-08-08 via `!94`** (`f40828e0b`, merge `b5bee6529`): the assistant-side directive and both-backend send-time composition are integrated. The live AionRS + ACP creation smoke was not run, so EPIC-002 remains Active until create → review card → hash-bound confirm → gallery is exercised on both backends.
  ```

- [ ] **Step 4: Validate the register diff**

  ```bash
  git diff --check
  git diff -- TASKS.md
  rg -n "BUG-041|A0\+/3 merged|provider thinking subjects|Third family sighting" TASKS.md
  ```

  Require a one-file `TASKS.md` diff and no premature Done status.

- [ ] **Step 5: Commit the reconciliation**

  ```bash
  git add TASKS.md
  git commit -m "docs(tasks): reconcile the Sprint 2 bug wave"
  ```

- [ ] **Step 6: Run the mandatory publication gate and recreate the MR source**

  ```bash
  just push -u origin docs/studio-bug-wave
  ```

  Require zero lint errors, clean formatting/typecheck, the entire Vitest suite green, and a successful push.

- [ ] **Step 7: Verify and merge MR !98**

  ```bash
  glab mr view 98
  glab mr merge 98 --remove-source-branch
  git fetch origin
  git merge-base --is-ancestor HEAD origin/sprint2
  ```

  Stop if GitLab still reports conflicts or the exact pushed head is not the merged ancestor.

---

### Task 2: Review, prove, and merge BUG-041

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/TemplateGallery/directive.ts`
- Test: `packages/desktop/src/renderer/components/chat/TemplateGallery/directive.test.ts`
- Test: `tests/unit/renderer/presentation-template/templatedSendParser.test.ts`
- Test: `tests/unit/renderer/presentation-template/usePresentationTemplates.dom.test.tsx`

**Interfaces:**
- Consumes: donor `codex/bug041-vietnamese-intent@8a9fb286e`, accepted post-!98 `origin/sprint2`.
- Produces: Vietnamese intent recognition that injects the existing model-facing template-creation directive without broad ambiguous bare-form matching.

- [ ] **Step 1: Refresh the existing isolated BUG-041 worktree**

  In `/Users/lap16603/Projects/WePrompt/.worktrees/bug041-vi-intent`, run:

  ```bash
  git status --short
  git fetch origin
  git merge origin/sprint2
  git diff --check origin/sprint2...HEAD
  ```

  The merge may add only register ancestry; stop on a content conflict.

- [ ] **Step 2: Audit precision and scope**

  Confirm the complete diff is exactly the four declared files. Require tests for accented Vietnamese, decomposed Unicode, ASCII phrases anchored by `template`/`theme`, English compatibility, and rejection of ambiguous `luu ... mau`.

- [ ] **Step 3: Prove the regression test would catch removal of the fix**

  Temporarily restore only `directive.ts` from the commit before `8a9fb286e`, leaving donor tests present:

  ```bash
  git restore --source=8a9fb286e^ -- packages/desktop/src/renderer/components/chat/TemplateGallery/directive.ts
  bun run test -- packages/desktop/src/renderer/components/chat/TemplateGallery/directive.test.ts tests/unit/renderer/presentation-template/templatedSendParser.test.ts tests/unit/renderer/presentation-template/usePresentationTemplates.dom.test.tsx
  ```

  Require failures in Vietnamese creation-intent cases. Restore the accepted implementation:

  ```bash
  git restore --source=HEAD -- packages/desktop/src/renderer/components/chat/TemplateGallery/directive.ts
  ```

- [ ] **Step 4: Run focused GREEN and renderer/i18n gates**

  ```bash
  bun run test -- packages/desktop/src/renderer/components/chat/TemplateGallery/directive.test.ts tests/unit/renderer/presentation-template/templatedSendParser.test.ts tests/unit/renderer/presentation-template/usePresentationTemplates.dom.test.tsx
  bun run i18n:types
  node scripts/check-i18n.js
  bunx tsc --noEmit
  git diff --check
  ```

- [ ] **Step 5: Commit generated-file changes only if i18n generation changed them**

  If `i18n-keys.d.ts` is unchanged, create no commit. If it changes solely because the checked-in file was stale, stop and separate that unrelated drift instead of adding it to BUG-041.

- [ ] **Step 6: Run `just push` and open the atomic MR**

  ```bash
  just push -u origin codex/bug041-vietnamese-intent
  ```

  Create an MR targeting `sprint2` titled `fix(templates): match Vietnamese creation intent`, using `.github/pull_request_template.md`. The body must state the precision policy, exact four-file scope, RED/GREEN evidence, full-suite count, and absence of locale changes.

- [ ] **Step 7: Merge and verify ancestry**

  Merge only after exact-head review finds no P0-P2 issue. Fetch `origin`, verify the accepted source head is an ancestor of `origin/sprint2`, and record the MR/merge SHA for Task 5.

---

### Task 3: Split, prove, and merge BUG-036

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/ReviewPhase.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Preview/CutEditor/CutTimeline.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Preview/ReviewCut.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Preview/StudioExportModal.tsx`
- Modify: all 12 `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` files
- Test: `tests/unit/pages/studio/Generation/ReviewPhase.dom.test.tsx`
- Test: `tests/unit/pages/studio/StudioExport.dom.test.tsx`
- Test: `tests/unit/pages/studio/studioI18n.test.ts`

**Interfaces:**
- Consumes: four donor commits `a6bb2fe83`, `19b82d873`, `5ab010304`, and `ebd5d3849`; accepted post-BUG-041 `origin/sprint2`.
- Produces: the four BUG-036 accessibility/localization fixes, excluding BUG-032.

- [ ] **Step 1: Create a fresh isolated replay worktree**

  From the main repository, verify `.worktrees/` is ignored, derive the branch
  suffix from the refreshed Sprint 2 SHA, and create the replay worktree:

  ```bash
  git check-ignore -q .worktrees
  git fetch origin
  bug036_base_short=$(git rev-parse --short=9 origin/sprint2)
  bug036_branch_name="codex/bug036-review-a11y-r-$bug036_base_short"
  bug036_worktree_path=".worktrees/bug036-review-a11y-r-$bug036_base_short"
  git worktree add "$bug036_worktree_path" -b "$bug036_branch_name" origin/sprint2
  ```

  Do not mutate the donor branch `codex/bug036-review-a11y`.

- [ ] **Step 2: Replay only BUG-036's four commits**

  ```bash
  git cherry-pick a6bb2fe83 19b82d873 5ab010304 ebd5d3849
  ```

  Require exactly 19 changed paths and verify `d2c2cae5b` is not an ancestor of the replay head.

- [ ] **Step 3: Install dependencies if the worktree cannot resolve them**

  ```bash
  bun install --frozen-lockfile
  ```

  The lockfile must remain unchanged.

- [ ] **Step 4: Prove the focused tests reject the pre-fix production surface**

  Temporarily restore the four production components from the refreshed base while retaining the donor tests/locales:

  ```bash
  git restore --source=origin/sprint2 -- packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/ReviewPhase.tsx packages/desktop/src/renderer/pages/studio/components/Preview/CutEditor/CutTimeline.tsx packages/desktop/src/renderer/pages/studio/components/Preview/ReviewCut.tsx packages/desktop/src/renderer/pages/studio/components/Preview/StudioExportModal.tsx
  bun run test -- tests/unit/pages/studio/Generation/ReviewPhase.dom.test.tsx tests/unit/pages/studio/StudioExport.dom.test.tsx tests/unit/pages/studio/studioI18n.test.ts
  ```

  Require failures covering the accessibility descriptions, focus return, counted missing-shot message, or localized timestamp. Restore the four files from `HEAD`.

- [ ] **Step 5: Run focused GREEN and locale validation**

  ```bash
  bun run test -- tests/unit/pages/studio/Generation/ReviewPhase.dom.test.tsx tests/unit/pages/studio/StudioExport.dom.test.tsx tests/unit/pages/studio/studioI18n.test.ts
  bun run i18n:types
  node scripts/check-i18n.js
  bunx tsc --noEmit
  bun run format:check
  git diff --check
  ```

- [ ] **Step 6: Review the exact four outcomes**

  Confirm accessibility assertions use roles/descriptions rather than `data-review-state`; Escape returns focus to the opener; `noRenderableShots` is in the plural invariant with real count behavior; and visible timestamps are localized while the `<time datetime>` value remains ISO.

- [ ] **Step 7: Publish and merge BUG-036**

  Run:

  ```bash
  bug036_branch_name=$(git branch --show-current)
  just push -u origin "$bug036_branch_name"
  ```

  Open an MR titled `fix(studio): address Review accessibility and localization`, merge only after exact-head review, fetch `origin/sprint2`, and verify the accepted head is an ancestor. Record the MR/merge SHA for Task 5.

---

### Task 4: Add the BUG-032 mapping test, replay, and merge

**Files:**
- Modify: all 12 `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` files
- Test: `tests/unit/pages/studio/studioI18n.test.ts`

**Interfaces:**
- Consumes: donor `d2c2cae5b`, accepted post-BUG-036 `origin/sprint2`.
- Produces: exact truthful assistant-description copy in all supported locales, independently reviewable from BUG-036.

- [ ] **Step 1: Create a fresh post-BUG-036 worktree**

  From the main repository, create a branch and worktree whose suffix is the
  first nine characters of the refreshed post-BUG-036 Sprint 2 SHA:

  ```bash
  git fetch origin
  bug032_base_short=$(git rev-parse --short=9 origin/sprint2)
  bug032_branch_name="codex/bug032-truthful-copy-r-$bug032_base_short"
  bug032_worktree_path=".worktrees/bug032-truthful-copy-r-$bug032_base_short"
  git worktree add "$bug032_worktree_path" -b "$bug032_branch_name" origin/sprint2
  ```

  Run `bun install --frozen-lockfile` only if dependencies are unresolved.

- [ ] **Step 2: Add an exact 12-locale RED test before replaying the donor**

  Add this mapping to `studioI18n.test.ts` and assert every configured locale resolves exactly to it:

  ```typescript
  const truthfulAssistantDescriptions = {
    'zh-CN': '根据创作简报生成故事板草稿。',
    'en-US': 'Draft a storyboard from your brief.',
    'ja-JP': 'ブリーフをもとにストーリーボードの下書きを作成します。',
    'zh-TW': '根據創作簡報產生分鏡腳本草稿。',
    'ko-KR': '브리프를 바탕으로 스토리보드 초안을 만듭니다.',
    'tr-TR': 'Kısa açıklamanızdan bir storyboard taslağı oluşturun.',
    'ru-RU': 'Создайте черновик раскадровки на основе брифа.',
    'uk-UA': 'Створіть чернетку розкадрування на основі брифу.',
    'pt-BR': 'Crie um rascunho de storyboard a partir do seu briefing.',
    'de-DE': 'Erstelle aus deinem Briefing einen Storyboard-Entwurf.',
    'es-ES': 'Crea un borrador de storyboard a partir de tu brief.',
    'fa-IR': 'از شرح مختصر خود یک پیش‌نویس استوری‌بورد بسازید.',
  } as const;
  ```

  The test must compare the mapping's sorted keys to `i18nConfig.supportedLanguages` and compare each locale's `phase.write.assistantDescription` leaf to the exact approved string.

- [ ] **Step 3: Run RED**

  ```bash
  bun run test -- tests/unit/pages/studio/studioI18n.test.ts
  ```

  Require failure because the current locale files still overpromise story structure, shot ideas, and prompts.

- [ ] **Step 4: Commit the RED test**

  ```bash
  git add tests/unit/pages/studio/studioI18n.test.ts
  git commit -m "test(studio): pin truthful assistant copy"
  ```

- [ ] **Step 5: Replay the locale-only donor**

  ```bash
  git cherry-pick d2c2cae5b
  ```

  Require exactly the 12 locale JSON files in the donor commit and no component behavior change.

- [ ] **Step 6: Run GREEN and all i18n/static gates**

  ```bash
  bun run test -- tests/unit/pages/studio/studioI18n.test.ts
  bun run i18n:types
  node scripts/check-i18n.js
  bunx tsc --noEmit
  bun run format:check
  git diff --check
  ```

- [ ] **Step 7: Publish and merge BUG-032**

  ```bash
  bug032_branch_name=$(git branch --show-current)
  just push -u origin "$bug032_branch_name"
  ```

  Open an MR titled `fix(studio): make assistant dock copy truthful`, and merge
  only after exact-head review. Fetch and verify ancestry; record the MR/merge
  SHA for Task 5.

---

### Task 5: Close the canonical register and stabilize

**Files:**
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: exact accepted MR/source/merge SHAs from Tasks 2-4 and the post-BUG-032 Sprint 2 tip.
- Produces: an honest canonical register and final wave checkpoint.

- [ ] **Step 1: Create the docs-only closeout worktree**

  ```bash
  git fetch origin
  closeout_base_short=$(git rev-parse --short=9 origin/sprint2)
  closeout_branch_name="docs/sprint2-bug-wave-closeout-r-$closeout_base_short"
  closeout_worktree_path=".worktrees/sprint2-bug-wave-closeout-r-$closeout_base_short"
  git worktree add "$closeout_worktree_path" -b "$closeout_branch_name" origin/sprint2
  ```

- [ ] **Step 2: Update only merged facts**

  Move BUG-041, BUG-036, and BUG-032 to Done with their exact MR, source-head, merge-head, focused-test, i18n, and full-suite evidence. Preserve BUG-024, BUG-037, BUG-028, BUG-027, and BUG-030 as open. Keep EPIC-002 Active until the AionRS + ACP live creation smoke passes.

- [ ] **Step 3: Verify register integrity**

  ```bash
  git diff --check
  git diff -- TASKS.md
  rg -n "BUG-041|BUG-036|BUG-032|BUG-024|BUG-037|BUG-028|BUG-027|BUG-030|EPIC-002" TASKS.md
  ```

  Confirm each of BUG-041/036/032 appears exactly once as a checkbox entry and every referenced commit exists in `origin/sprint2` ancestry.

- [ ] **Step 4: Commit, gate, publish, and merge the closeout**

  ```bash
  git add TASKS.md
  git commit -m "docs(tasks): close the Sprint 2 bug-fix wave"
  closeout_branch_name=$(git branch --show-current)
  just push -u origin "$closeout_branch_name"
  ```

  Open and merge the docs-only MR after verifying its exact head and full-suite gate.

- [ ] **Step 5: Final stabilization verification**

  Fetch `origin/sprint2`, verify all five accepted source heads are ancestors, run `bun run test` on the final integrated tip, and report the final test count, remaining open bug IDs, and any unexecuted packaged/live acceptance separately.
