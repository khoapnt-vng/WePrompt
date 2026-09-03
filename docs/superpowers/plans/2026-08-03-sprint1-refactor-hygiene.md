# Sprint 1 Refactor & Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the mechanical merge pain measured in sprint 1 and close the three small, verified code gaps (vector-row duplication, optional `workspace`, unenforced coverage) — without restructuring any subsystem.

**Architecture:** Five independent, low-risk changes: (1) stop tracking the generated `i18n-keys.d.ts`, (2) add a semantic three-way merge driver for locale JSON plus `git rerere`, (3) make the knowledge embed pass upsert vector rows by chunk id, (4) make `workspace` required end-to-end on the three project-knowledge mutation channels, (5) ratchet coverage thresholds to the measured baseline as a manual guard (groundwork — see Task 5). No external API changes (Task 4 tightens one internal IPC contract); no file moves.

**Tech Stack:** Node scripts (CJS/ESM), git merge drivers/gitattributes, Zod schemas, Vitest 4, justfile.

---

## Context (evidence, 2026-08-03)

- **Base revision for ALL branches: refreshed `origin/sprint1` (`54cfef7a7` at review time — refetch before branching).** Sprint 1 = ~40 MRs, **999 files, +82,360/−12,505** since fork `78b9c079e`, measured at `origin/sprint1`. (Earlier figures 862/+73,472/−8,818 were the stale local HEAD `5bb330c57`; the delta is release/signing tooling.) Gates green at local HEAD: `tsc` clean, 4,827 unit tests pass, 409 e2e specs resolve, i18n check passes.
- Merge-pain autopsy: `i18n-keys.d.ts` (generated!) was hand-resolved in **13** merges; each `locales/*/conversation.json` in **8**; `ipcBridge.ts` in 6. No merge drivers configured, `rerere` off. i18n accounts for ~430 file-level collisions; application code is a distant second.
- Vector duplication (found by Codex review, verified by simulation against the real `store.ts`): after a `writeVectors`-succeeds/`writeChunks`-fails window, retry **appends** duplicate rows for the same chunk id. Bounded at 2× per stuck chunk and invisible to search (`readVectors` collapses through a `Map`). The fix stops the duplicate rows and file bloat; the repeat embed API call for stale-flagged chunks is inherent to the recovery (chunks.json genuinely lost the flags) and is NOT prevented. `removeSourceRows` (projectKnowledgeService.ts:346-356) already documents and defends against this exact stale-flag state — `embedMissingVectors` is the one spot that mishandles it.
- `workspace` optionality is a leftover the team already planned to remove — see the comment at ipcBridge.ts:997-999 ("Optional only until every renderer caller passes it"). All three renderer callers now pass it (`useProjectKnowledge.ts:80,91,102`); no caller in src or tests omits it. This is **contract cleanup, not a behavior fix**: the service already fail-fasts (`if (!workspace) throw` at projectKnowledgeService.ts:824,849,857,903), so the `?? ''` default never reached `knowledgeDirOf`. The change moves rejection to the schema boundary and makes the types honest.
- Coverage measured on the full suite: **55.29% statements / 50.40% branches / 51.15% functions / 56.22% lines**. Thresholds in `vitest.config.ts` are all 0 ("informational"). **Enforcement reality:** the GitHub coverage step is `continue-on-error: true` (`.github/workflows/pr-checks.yml:206-208`) — warning-only — and the actual MR remote is GitLab with **no tracked `.gitlab-ci.yml`**. Thresholds therefore gate local/manual `test:coverage` runs only, until the team wires a blocking pipeline (Task 5 states this honestly).

## Non-goals (deliberately deferred — do NOT expand scope)

- **Artifact pipeline (BUG-003/BUG-007) — already CLOSED on origin/sprint1.** The verified-bug-backlog merge (`342fa7521`, MR !47, 2026-08-01) fixed and verified the entire TASKS.md list — all 12 items are `[x]` in origin's tracked TASKS.md, including the PPTX delivery gate and scratch cleanup. The untracked TASKS.md in the stale local checkout predates that merge and still shows them open — trust origin. Nothing artifact-related belongs in this plan.
- **Decomposing `projectKnowledgeService.ts` (961 lines):** no additional verified KB bugs beyond the Task 3 duplicate-row defect; pure logic already lives in `common/knowledge/`. Revisit when KB next grows a feature.
- **Extracting a compaction coordinator from `useContextCompaction.ts`:** shipped, stable, most-tested unit in the repo; BUG-006's fix lives in sibling modules.
- **Relocating project storage to the main process:** projects live in renderer `localStorage`; binding `projectId → workspace` in main is a separate architectural project. The trusted-renderer assumption stays documented instead (Task 4 comment).
- **ipcBridge domain split:** optional follow-up; needs its own plan if taken up.

## Execution notes

- **One MR per task — five total** (CONTRIBUTING.md Rule 1: exactly one change that cannot be further decomposed): `chore/i18n-untracked-types` (T1), `build/locale-json-merge-driver` (T2), `fix/kb-vector-upsert` (T3), `fix/kb-workspace-required` (T4), `test/coverage-ratchet` (T5). Push each with `just push -u origin <branch>` — never `git push`.
- **Every branch starts from a fresh worktree off refreshed `origin/sprint1`** (`git fetch origin && git worktree add <dir> origin/sprint1 -b <branch>`). Do NOT build on the user's main checkout — it is behind origin and carries untracked working files (`dashboard.html`, `TASKS.md`, …).
- **Recommended order: T3 → T1 → T2 → T4 → T5** (bugfix first; T5 strictly last, re-measured).
- **Every task runs the full gate in its own worktree before committing** — `just check && bun run test` (lint, format-check, typecheck, i18n, full suite). Five independent branches mean no shared "final verification"; `just push` re-runs the same gate per branch as the backstop.
- Fresh worktrees need `bun install` before any gate is believable (stale `node_modules` reads as a red gate).
- Commit messages: Conventional Commits, **no AI signatures of any kind**.
- `docs/superpowers/` is gitignored — this plan file itself is never committed.
- Rollout note for Task 1 (include in the MR description): after pulling, teammates must run `bun run i18n:types` (or `bun install`) once, because the tracked copy of `i18n-keys.d.ts` disappears from their working tree.

---

### Task 1: Stop tracking the generated `i18n-keys.d.ts`

The file is fully derived from `locales/` (sorted keys, deterministic, idempotent — `scripts/generate-i18n-types.js:57,91`). Tracking it caused 13 hand-resolved merges. Untrack it; generate it in `postinstall` and before typecheck in the push gate.

**Files:**
- Modify: `.gitignore`
- Modify: `scripts/postinstall.js`
- Modify: `justfile` (line 330, `push` recipe dependency order)
- Delete from index (keep on disk): `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`

- [ ] **Step 1: Add the ignore rule**

Append to `.gitignore` (after the existing generated-file entries around line 208):

```gitignore
# Generated from locales/ by scripts/generate-i18n-types.js (see postinstall)
packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
```

- [ ] **Step 2: Untrack the file (keeps the local copy)**

```bash
git rm --cached packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
```

Expected: `rm 'packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts'` and the file still exists on disk (`ls` it to confirm).

- [ ] **Step 3: Generate on install**

In `scripts/postinstall.js`, inside `runPostInstall()`'s `try` block, add the generation call **before** the `isCI` branch (CI skips the rebuild branch but still needs the types for typecheck):

```js
function runPostInstall() {
  try {
    // i18n key types are generated, not tracked — every install must produce
    // them before any typecheck can run (CI and local alike).
    execSync('node scripts/generate-i18n-types.js', { stdio: 'inherit' });

    // Check if we're in a CI environment
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
```

(Only the two new lines + comment are added; everything else stays.)

**Origin-version notes:** on `origin/sprint1` the catch block ends with `throw e` (postinstall now fails loudly — a behavior change vs the stale local copy), and `tests/unit/build-scripts/postinstall.test.ts` pins that: local `bunx` failure → non-zero exit; `CI=true` → exit 0. The generation line is compatible with both tests — `generate-i18n-types.js` runs via `node` directly, and its `formatOutputFile` swallows formatter failures internally, so a shimmed/broken `bunx` cannot fail generation. A genuine generation failure (broken locales) now fails the install loudly, which is consistent with origin's fail-loud change.

- [ ] **Step 4: Make the typecheck recipe self-sufficient**

Both `just push` (line 330) and `just check` (line ~326) run `typecheck` BEFORE `i18n-check`, so reordering one gate would leave the other cold-broken. Instead, make `typecheck` generate its own prerequisite (generation is idempotent and skips the write when up to date). In `justfile` change:

```just
# Type check
typecheck:
    bunx tsc --noEmit
```

to:

```just
# Type check (i18n key types are generated, not tracked — produce them first)
typecheck:
    bun run i18n:types
    bunx tsc --noEmit
```

`push` and `check` dependency lists stay untouched. (`i18n-check` also regenerates — the second run is a no-op content compare.)

- [ ] **Step 5: Verify a cold regeneration works**

```bash
rm packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
bun run i18n:types
bunx tsc --noEmit
node scripts/check-i18n.js
bunx vitest run tests/unit/build-scripts/postinstall.test.ts
git check-ignore -v packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
```

Expected: `✅ i18n key types generated`, tsc exits 0, check-i18n passes, the postinstall policy tests pass (2 passed), and `check-ignore` prints the new `.gitignore` rule. Note: until Step 6's commit, `git status` still shows the file as a *staged deletion* — that's the `git rm --cached` from Step 2, not a problem. After the commit the tree is clean while the file exists on disk.

- [ ] **Step 6: Full gate, then commit**

```bash
just check && bun run test
git add .gitignore scripts/postinstall.js justfile
git commit -m "chore(i18n): stop tracking the generated i18n-keys.d.ts

Generated from locales/ on install and in the push gate instead.
Hand-resolved in 13 sprint-1 merges for zero information.
After pulling: run 'bun run i18n:types' (or 'bun install') once."
```

---

### Task 2: Semantic merge driver for locale JSON + `git rerere`

Locale files are nested JSON where parallel branches add disjoint keys; git's line merge conflicts on adjacent additions. A key-level three-way merge resolves those automatically and reports only true same-key conflicts. Driver config is per-clone, so it's registered by a `just git-setup` recipe (server-side GitLab merges never run drivers — the win is in the local rebase/resolve flow where all 8× conversation.json conflicts actually happened).

**Fail-closed rule:** the ANCESTOR defaults to `{}` only when it reads successfully AND is empty (git passes an empty temp file for `%O` on add/add). Malformed or unreadable content in ANY of the three inputs — ancestor included, since a lost ancestor means deletions can't be distinguished from additions — exits non-zero WITHOUT writing `%A`. Never overwrite content we could not fully reason about.

**rerere scope (be honest in docs):** `git rerere` records resolutions keyed on conflict-marker hunks. Driver-reported locale conflicts are marker-free (the file holds best-effort merged JSON), so rerere does NOT learn them — it helps the *ordinary* code conflicts (`ipcBridge.ts` was hand-resolved in 6 sprint-1 merges). Both tools ship in one recipe because both are per-clone git config, not because they cover the same conflicts.

**Placement (directory ratchet):** NOT `scripts/` — it has 41 direct children and the ratchet forbids making an existing violation worse. The script goes in `packages/shared-scripts/src/` (4 files; invoked by file path, so the package's `exports` map is irrelevant). The test goes in the existing `tests/unit/build-scripts/` — on `origin/sprint1` it holds 4 files (afterSign, checkAudit, postinstall, windows-fast-build-script), so a 5th stays within the ≤10 rule.

**Files:**
- Create: `packages/shared-scripts/src/merge-locale-json.mjs`
- Test: `tests/unit/build-scripts/mergeLocaleJson.test.ts`
- Modify: `.gitattributes` (append)
- Modify: `justfile` (add `git-setup` recipe; extend `setup`)
- Modify: `ONBOARDING.md` (one setup line)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/build-scripts/mergeLocaleJson.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(process.cwd(), 'packages/shared-scripts/src/merge-locale-json.mjs');

describe('merge-locale-json driver', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'locale-merge-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  type Json = Record<string, unknown>;
  /** Writes JSON (or a raw string verbatim, for malformed/empty fixtures). */
  const write = (name: string, value: Json | string): string => {
    const p = path.join(dir, name);
    writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
    return p;
  };
  /** Runs the driver like git does: node script %O %A %B %P. */
  const run = (
    base: Json | string,
    ours: Json | string,
    theirs: Json | string
  ): { code: number; oursRaw: string; stderr: string } => {
    const o = write('base.json', base);
    const a = write('ours.json', ours);
    const b = write('theirs.json', theirs);
    let code = 0;
    let stderr = '';
    try {
      execFileSync('node', [SCRIPT, o, a, b, 'locales/en-US/conversation.json'], { stdio: 'pipe' });
    } catch (error) {
      const e = error as { status?: number; stderr?: Buffer };
      code = e.status ?? 1;
      stderr = e.stderr?.toString() ?? '';
    }
    return { code, oursRaw: readFileSync(a, 'utf8'), stderr };
  };
  const merged = (r: { oursRaw: string }): Json => JSON.parse(r.oursRaw) as Json;

  it('merges disjoint key additions from both sides cleanly', () => {
    const base = { welcome: { title: 'Hi' } };
    const r = run(base, { welcome: { title: 'Hi', oursNew: 'A' } }, { welcome: { title: 'Hi', theirsNew: 'B' } });
    expect(r.code).toBe(0);
    expect(merged(r)).toEqual({ welcome: { title: 'Hi', oursNew: 'A', theirsNew: 'B' } });
    // ours ordering first, theirs-only keys appended
    expect(Object.keys((merged(r) as { welcome: Json }).welcome)).toEqual(['title', 'oursNew', 'theirsNew']);
  });

  it('takes their edit when ours is untouched', () => {
    const r = run({ a: { k: 'old' } }, { a: { k: 'old' } }, { a: { k: 'new' } });
    expect(r.code).toBe(0);
    expect(merged(r)).toEqual({ a: { k: 'new' } });
  });

  it('exits 1 and lists the key path when both sides edit the same key differently', () => {
    const r = run({ a: { k: 'old' } }, { a: { k: 'mine' } }, { a: { k: 'theirs' } });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('a.k');
    // best-effort content keeps ours so the working tree stays valid JSON
    expect(merged(r)).toEqual({ a: { k: 'mine' } });
  });

  it('drops a key deleted on one side when the other side left it untouched, conflicts otherwise', () => {
    const base = { a: { gone: 'x', edited: 'x' } };
    const clean = run(base, { a: { gone: 'x', edited: 'x' } }, { a: { edited: 'x' } });
    expect(clean.code).toBe(0);
    expect(merged(clean)).toEqual({ a: { edited: 'x' } });

    const conflicted = run(base, { a: { gone: 'CHANGED', edited: 'x' } }, { a: { edited: 'x' } });
    expect(conflicted.code).toBe(1);
    expect(conflicted.stderr).toContain('a.gone');
  });

  it('fails closed on malformed OURS: exit 2, file left byte-identical', () => {
    const brokenOurs = '{ "a": "1", }';
    const r = run({ a: '1' }, brokenOurs, { a: '1', b: '2' });
    expect(r.code).toBe(2);
    expect(r.oursRaw).toBe(brokenOurs); // never overwritten
    expect(r.stderr).toContain('ours');
  });

  it('fails closed on malformed THEIRS without touching ours', () => {
    const ours = { a: '1', mine: 'M' };
    const r = run({ a: '1' }, ours, 'not json at all');
    expect(r.code).toBe(2);
    expect(merged(r)).toEqual(ours);
    expect(r.stderr).toContain('theirs');
  });

  it('handles add/add with an empty ancestor file (git %O on both-sides-new)', () => {
    const r = run('', { a: 'A' }, { b: 'B' });
    expect(r.code).toBe(0);
    expect(merged(r)).toEqual({ a: 'A', b: 'B' });
  });

  it('treats arrays atomically: one-sided replace wins, two-sided divergence conflicts', () => {
    const oneSided = run({ list: ['a', 'b'] }, { list: ['a', 'b'] }, { list: ['z'] });
    expect(oneSided.code).toBe(0);
    expect(merged(oneSided)).toEqual({ list: ['z'] });

    const diverged = run({ list: ['a'] }, { list: ['a', 'mine'] }, { list: ['a', 'theirs'] });
    expect(diverged.code).toBe(1);
    expect(diverged.stderr).toContain('list');
  });

  it('conflicts when both sides replace the same scalar with different structures', () => {
    const diverged = run({ k: 'scalar' }, { k: { a: 1 } }, { k: { b: 2 } });
    expect(diverged.code).toBe(1);
    expect(diverged.stderr).toContain('k');
    expect(merged(diverged)).toEqual({ k: { a: 1 } }); // ours kept

    const identical = run({ k: 'scalar' }, { k: { a: 1 } }, { k: { a: 1 } });
    expect(identical.code).toBe(0);
    expect(merged(identical)).toEqual({ k: { a: 1 } });
  });

  it('fails closed on a malformed (non-empty) ancestor', () => {
    const ours = { a: 'mine' };
    const r = run('{ broken', ours, { a: 'theirs' });
    expect(r.code).toBe(2);
    expect(merged(r)).toEqual(ours); // ours untouched
    expect(r.stderr).toContain('ancestor');
  });

  it('merges keys named after Object.prototype members instead of dropping them', () => {
    // Raw fixtures: a TS object literal with __proto__ would set the
    // prototype in the test itself instead of creating a data key.
    const r = run('', '{\n  "constructor": "C"\n}\n', '{\n  "__proto__": "P",\n  "toString": "T"\n}\n');
    expect(r.code).toBe(0);
    const result = merged(r);
    expect(Object.keys(result).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(result['toString']).toBe('T');
    expect(result['constructor']).toBe('C');
  });

  it('drives a real git merge: clean on disjoint keys, conflicted state on same-key edits', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'locale-merge-git-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
    const file = path.join(repo, 'x.json');
    const commitJson = (value: Json, message: string): void => {
      writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
      git('commit', '-qam', message);
    };
    try {
      git('init', '-q');
      git('config', 'user.email', 'test@test.local');
      git('config', 'user.name', 'test');
      git('config', 'merge.locale-json.driver', `node ${SCRIPT} %O %A %B %P`);
      writeFileSync(path.join(repo, '.gitattributes'), '*.json merge=locale-json\n');
      writeFileSync(file, JSON.stringify({ a: '1' }, null, 2) + '\n');
      git('add', '-A');
      git('commit', '-qm', 'base');

      git('checkout', '-qb', 'left');
      commitJson({ a: '1', left: 'L' }, 'left');
      git('checkout', '-q', '-');
      commitJson({ a: '1', right: 'R' }, 'right');
      git('merge', '-q', 'left'); // disjoint adds -> clean, no conflict
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: '1', right: 'R', left: 'L' });

      git('checkout', '-qb', 'left2');
      commitJson({ a: 'L2', right: 'R', left: 'L' }, 'left2');
      git('checkout', '-q', '-');
      commitJson({ a: 'R2', right: 'R', left: 'L' }, 'right2');
      expect(() => git('merge', 'left2')).toThrow(); // same-key edit -> real conflict
      expect(git('ls-files', '-u')).not.toBe(''); // path recorded as unmerged
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
bunx vitest run tests/unit/build-scripts/mergeLocaleJson.test.ts
```

Expected: FAIL — the script file does not exist yet, so node exits 1 with `Cannot find module` on every case (the exit-2 and real-git cases fail on wrong code/thrown merge; none pass).

- [ ] **Step 3: Implement the driver**

Create `packages/shared-scripts/src/merge-locale-json.mjs`:

```js
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Three-way key-level merge for nested locale JSON.
// Registered as a git merge driver (see `just git-setup`):
//   git config merge.locale-json.driver "node packages/shared-scripts/src/merge-locale-json.mjs %O %A %B %P"
// Git calls it with the ancestor (%O), ours (%A), theirs (%B) and the display
// path (%P); the merged result must be written back to %A. Exit 0 = clean,
// exit 1 = true same-key conflicts (listed on stderr, ours kept in the file so
// the working tree stays parseable while the path is marked unmerged),
// exit 2 = unparseable input (fail closed: %A is left untouched).
import { readFileSync, writeFileSync } from 'node:fs';

const [, , basePath, oursPath, theirsPath, displayPath = '(locale file)'] = process.argv;

const bail = (what, error) => {
  console.error(
    `[merge-locale-json] ${displayPath}: cannot ${what} (${error instanceof Error ? error.message : error}); leaving the file for manual merge`
  );
  process.exit(2);
};

// The ANCESTOR may be EMPTY — git hands an empty temp file for %O when the
// file was added on both sides. A malformed ancestor is different: without it
// we cannot tell deletions from additions (guessing resurrects deleted keys),
// so bail without touching ours.
const parseAncestor = (file) => {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    bail('read ancestor', error);
  }
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    bail('parse ancestor', error);
  }
};

// OURS/THEIRS are live content: if either cannot be parsed, overwriting %A
// with reconstructed data would destroy it. Report and bail without writing.
const parseSideOrExit = (file, side) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    bail(`parse ${side}`, error);
  }
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Semantic deep equality — key order must not count as a change (JSON.stringify
// would flag a reordered-but-identical subtree as edited).
const same = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => same(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    return aKeys.length === Object.keys(b).length && aKeys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return false;
};

const conflicts = [];

const merge = (base, ours, theirs, keyPath) => {
  if (isObject(ours) && isObject(theirs)) {
    // Both sides replaced a non-object base (scalar/array/null) with
    // structures: recursing would silently interleave two unrelated
    // restructurings, so this conflicts unless the replacements are identical.
    if (base !== undefined && !isObject(base)) {
      if (same(ours, theirs)) return ours;
      conflicts.push(`${keyPath} (both sides replaced a value with different structures)`);
      return ours;
    }
    const baseObj = isObject(base) ? base : {};
    // Null prototype + Object.hasOwn throughout: locale keys are arbitrary
    // strings, and `in` / plain `{}` mishandle names like "toString" or
    // "__proto__" (prototype-chain hits and setter side effects drop keys).
    const out = Object.create(null);
    // ours ordering first, theirs-only keys appended in theirs' order —
    // keeps human-grouped en-US files stable across merges.
    const keys = [...Object.keys(ours), ...Object.keys(theirs).filter((k) => !Object.hasOwn(ours, k))];
    for (const key of keys) {
      const childPath = keyPath ? `${keyPath}.${key}` : key;
      const inBase = Object.hasOwn(baseObj, key);
      const baseVal = inBase ? baseObj[key] : undefined;
      if (Object.hasOwn(ours, key) && Object.hasOwn(theirs, key)) {
        out[key] = merge(baseVal, ours[key], theirs[key], childPath);
      } else if (Object.hasOwn(ours, key)) {
        if (!inBase) out[key] = ours[key]; // we added it
        else if (same(baseVal, ours[key])) {
          // they deleted it and we never touched it — accept the deletion
        } else {
          conflicts.push(`${childPath} (deleted in theirs, edited in ours)`);
          out[key] = ours[key];
        }
      } else {
        if (!inBase) out[key] = theirs[key]; // they added it
        else if (same(baseVal, theirs[key])) {
          // we deleted it and they never touched it — accept the deletion
        } else {
          conflicts.push(`${childPath} (deleted in ours, edited in theirs)`);
          out[key] = theirs[key];
        }
      }
    }
    return out;
  }
  if (same(ours, theirs)) return ours;
  if (same(base, theirs)) return ours; // only we changed it
  if (same(base, ours)) return theirs; // only they changed it
  conflicts.push(`${keyPath} (edited differently on both sides)`);
  return ours;
};

const merged = merge(parseAncestor(basePath), parseSideOrExit(oursPath, 'ours'), parseSideOrExit(theirsPath, 'theirs'), '');
writeFileSync(oursPath, JSON.stringify(merged, null, 2) + '\n');

if (conflicts.length > 0) {
  console.error(`[merge-locale-json] ${displayPath}: ${conflicts.length} key conflict(s):`);
  for (const conflict of conflicts) console.error(`  - ${conflict}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bunx vitest run tests/unit/build-scripts/mergeLocaleJson.test.ts
```

Expected: 12 passed (4 merge-semantics, 3 fail-closed [ours/theirs/ancestor], add/add empty ancestor, arrays-atomic, scalar→structure conflict, prototype-named keys, real-git).

- [ ] **Step 5: Wire up gitattributes and the setup recipe**

Append to `.gitattributes`:

```gitattributes

# Locale JSON: key-level three-way merge — register the driver once per clone
# with `just git-setup` (unregistered clones silently fall back to line merge).
packages/desktop/src/renderer/services/i18n/locales/**/*.json merge=locale-json
```

In `justfile`, change line 117 and add a recipe next to `setup`:

```just
# Full setup: install deps + rebuild native modules + git config
setup: install rebuild-native git-setup

# One-time per-clone git config: locale merge driver + reuse recorded conflict resolutions
git-setup:
    git config merge.locale-json.name "key-level locale JSON merge"
    git config merge.locale-json.driver "node packages/shared-scripts/src/merge-locale-json.mjs %O %A %B %P"
    git config rerere.enabled true
```

In `ONBOARDING.md`, find the environment-setup portion (grep for `just setup` or `bun install`) and add immediately after it:

```markdown
Existing clones: run `just git-setup` once. It registers the locale-JSON merge
driver (auto-resolves disjoint locale-key additions) and enables `git rerere`
(replays your recorded resolutions of ordinary marker conflicts — note it does
not learn the driver's marker-free locale conflicts). Both are per-clone.
```

- [ ] **Step 6: Verify the recipe registers the driver**

Real-merge behavior (clean AND conflicted) is covered by the `drives a real git merge` test in Step 1; here just confirm the recipe wires this clone:

```bash
just git-setup
git config --get merge.locale-json.driver
git config --get rerere.enabled
```

Expected: prints `node packages/shared-scripts/src/merge-locale-json.mjs %O %A %B %P` and `true`.

- [ ] **Step 7: Full gates, then commit**

```bash
bun run lint:fix && bun run format && just check && bun run test
git add packages/shared-scripts/src/merge-locale-json.mjs tests/unit/build-scripts/mergeLocaleJson.test.ts .gitattributes justfile ONBOARDING.md
git commit -m "build(git): add key-level locale JSON merge driver and rerere setup

Each locales/*/conversation.json was hand-resolved in 8 sprint-1 merges;
disjoint key additions now merge cleanly, true same-key conflicts are
listed by path, and unparseable sides fail closed without touching the
file. Registered per-clone via 'just git-setup'."
```

---

### Task 3: Upsert vector rows on re-embed (fix the duplicate-row recovery bug)

`embedMissingVectors` (projectKnowledgeService.ts:603-635) appends to an array keyed by nothing; after a `writeVectors`-succeeds/`writeChunks`-fails window, retry appends a second row for the same chunk id. `removeSourceRows` already documents this stale-flag state — mirror its reasoning by keying on chunk id.

**Files:**
- Modify: `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts:603-635`
- Test: `tests/unit/knowledge/projectKnowledgeService.test.ts`

- [ ] **Step 1: Write the failing regression test**

Add to `tests/unit/knowledge/projectKnowledgeService.test.ts` (after the `'stays ready with BM25 only when embedding fails'` test; `readChunks`, `writeChunks`, `readVectors`, `readFileSync` are already imported):

```ts
  it('re-embeds stale hasVector chunks by upserting rows, never duplicating chunk ids', async () => {
    // Full ingest: source ready, every chunk embedded, vectors on disk.
    const file = await addFile('policy.md', 'travel policy: submit the visa letter request early');
    await service.addSources('proj-1', [file], workspace);
    await service.whenIdle('proj-1');
    const storeDir = path.join(root, 'proj-1');
    const chunks = await readChunks(storeDir);
    expect(chunks.length).toBeGreaterThan(0);

    // Simulate the documented partial-write window (see removeSourceRows):
    // writeVectors succeeded but the follow-up writeChunks did not, so
    // chunks.json claims "no vector" while vectors.bin already has the rows.
    await writeChunks(
      storeDir,
      chunks.map((c) => ({ ...c, hasVector: false }))
    );

    // Any queue pass ends with the embed step re-running for "missing" chunks.
    await service.syncFolder('proj-1', workspace);
    await service.whenIdle('proj-1');

    const meta = JSON.parse(readFileSync(path.join(storeDir, 'index', 'vectors.meta.json'), 'utf8')) as {
      rowChunkIds: string[];
    };
    // One row per chunk: a duplicate id means recovery appended instead of upserting.
    expect(meta.rowChunkIds.length).toBe(chunks.length);
    expect(new Set(meta.rowChunkIds).size).toBe(meta.rowChunkIds.length);
    const vectors = await readVectors(storeDir);
    expect(vectors!.rows.size).toBe(chunks.length);
  });
```

- [ ] **Step 2: Run it to verify it fails for the right reason**

```bash
bunx vitest run tests/unit/knowledge/projectKnowledgeService.test.ts -t 'upserting rows'
```

Expected: FAIL on `meta.rowChunkIds.length` — received is `2 × chunks.length` (every chunk id duplicated), not a setup error.

- [ ] **Step 3: Switch the accumulator from array-append to Map-upsert**

In `projectKnowledgeService.ts`, `embedMissingVectors`, change (current code shown first):

```ts
      // Read the existing rows once; the loop below appends to this array and
      // rewrites the file after every batch, so a failure part-way through
      // keeps everything embedded so far and Retry resumes from there.
      let rows: Array<[string, Float32Array]> | null = null;
```

to:

```ts
      // Read the existing rows once; the loop below upserts into this map and
      // rewrites the file after every batch, so a failure part-way through
      // keeps everything embedded so far and Retry resumes from there. Keyed
      // by chunk id because hasVector can lag reality (writeVectors succeeds,
      // then writeChunks fails — the same stale-flag window removeSourceRows
      // defends against): a retried chunk must replace its row, not append a
      // duplicate.
      let rows: Map<string, Float32Array> | null = null;
```

then:

```ts
        if (rows === null) {
          const existing = await readVectors(storeDir);
          rows = existing && existing.dim === embedding.dim ? [...existing.rows.entries()] : [];
        }
        batch.forEach((chunk, i) => {
          rows!.push([chunk.chunkId, Float32Array.from(vectors[i])]);
          chunk.hasVector = true;
        });
        await writeVectors(storeDir, embedding.dim, rows);
```

to:

```ts
        if (rows === null) {
          const existing = await readVectors(storeDir);
          rows = existing && existing.dim === embedding.dim ? new Map(existing.rows) : new Map();
        }
        batch.forEach((chunk, i) => {
          rows!.set(chunk.chunkId, Float32Array.from(vectors[i]));
          chunk.hasVector = true;
        });
        await writeVectors(storeDir, embedding.dim, [...rows!.entries()]);
```

- [ ] **Step 4: Run the test to verify it passes, then the whole knowledge suite**

```bash
bunx vitest run tests/unit/knowledge/projectKnowledgeService.test.ts
bunx vitest run tests/unit/knowledge
```

Expected: all pass (the existing resume-from-partial-embed behavior is unchanged — the map preserves prior rows exactly like the array did).

- [ ] **Step 5: Full gate and commit**

```bash
bun run lint:fix && bun run format && just check && bun run test
git add packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts tests/unit/knowledge/projectKnowledgeService.test.ts
git commit -m "fix(knowledge): upsert vector rows on re-embed instead of appending duplicates

After a writeVectors-succeeds/writeChunks-fails window, the retry pass
appended a second row for each stale-flagged chunk id. Search was
unaffected (readVectors collapses by id) but the vectors file bloated.
Key the accumulator by chunk id, mirroring the stale-flag defense
already documented in removeSourceRows. The repeat embed request for
stale-flagged chunks remains — that is the recovery, not the bug."
```

---

### Task 4: Require `workspace` on project-knowledge mutation channels

Completes the team's own TODO (ipcBridge.ts:997-999). **Contract cleanup, not a behavior fix:** the service already rejects empty workspaces at runtime (`if (!workspace) throw` — projectKnowledgeService.ts:824,849,857,903), so no CWD-relative path was reachable. The change moves rejection to the schema boundary (earlier, structured) and makes the bridge types honest so the `?? ''` defaults can go.

**Files:**
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts` (3 schemas)
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts` (3 signatures + comment, ~lines 997-1015)
- Modify: `packages/desktop/src/process/bridge/projectKnowledgeBridge.ts` (3 providers)
- Test: `tests/unit/process/bridge/nativePayloadSchemas.test.ts`

- [ ] **Step 1: Add failing rejection fixtures**

In `tests/unit/process/bridge/nativePayloadSchemas.test.ts`, in the invalid-payload table (rows around lines 380-391, keep the existing format), add:

```ts
  ['project-knowledge.add-sources', 'omitted workspace', { projectId: 'project-1', filePaths: ['/tmp/work/notes.md'] }],
  ['project-knowledge.remove-source', 'omitted workspace', { projectId: 'project-1', sourceId: 'a1b2c3d4e5f6' }],
  ['project-knowledge.retry-source', 'omitted workspace', { projectId: 'project-1', sourceId: 'a1b2c3d4e5f6' }],
```

(The valid fixtures at lines 84-99 already include `workspace`, so they keep passing.)

- [ ] **Step 2: Run to verify the three new rows fail**

```bash
bunx vitest run tests/unit/process/bridge/nativePayloadSchemas.test.ts
```

Expected: exactly 3 failures — the schemas still accept payloads without `workspace`.

- [ ] **Step 3: Make the schemas require workspace**

In `payloadSchemas.ts`, drop `.optional()` from all three (target state):

```ts
  'project-knowledge.add-sources': z
    .object({
      projectId: safeIdSchema,
      filePaths: z.array(pathSchema).max(MAX_PROJECT_KB_FILE_PATHS),
      workspace: pathSchema,
    })
    .strict(),
  'project-knowledge.remove-source': z
    .object({ projectId: safeIdSchema, sourceId: safeIdSchema, workspace: pathSchema })
    .strict(),
```

and the same for `'project-knowledge.retry-source'`:

```ts
  'project-knowledge.retry-source': z
    .object({ projectId: safeIdSchema, sourceId: safeIdSchema, workspace: pathSchema })
    .strict(),
```

- [ ] **Step 4: Tighten the renderer-facing types**

In `ipcBridge.ts`, `projectKnowledge` export (~line 993): replace the stale comment

```ts
  // `workspace` is the project workspace path; the `Knowledge Base/` folder
  // inside it is the source of truth for knowledge files. Optional only until
  // every renderer caller passes it (typed required again in the card work).
```

with

```ts
  // `workspace` is the project workspace path; the `Knowledge Base/` folder
  // inside it is the source of truth for knowledge files. Required end-to-end:
  // the native schema rejects payloads without it. NOTE the main process
  // trusts the renderer's projectId→workspace pairing (projects live in
  // renderer localStorage); ownership binding in main is a separate project.
```

and make `workspace` required in the three payload generics — target state (lines 1000, 1003, 1009):

```ts
  addSources: bridge.buildProvider<void, { projectId: string; filePaths: string[]; workspace: string }>(
    'project-knowledge.add-sources'
  ),
  removeSource: bridge.buildProvider<void, { projectId: string; sourceId: string; workspace: string }>(
    'project-knowledge.remove-source'
  ),
```

```ts
  retrySource: bridge.buildProvider<void, { projectId: string; sourceId: string; workspace: string }>(
    'project-knowledge.retry-source'
  ),
```

**WARNING:** `ipcBridge.ts` has 15+ other `workspace?: string` occurrences (fs, office, ppt-preview blocks). Touch ONLY the three lines above — never replace_all across the file.

- [ ] **Step 5: Drop the bridge defaults**

In `projectKnowledgeBridge.ts` (~lines 78-86), remove the three `?? ''`:

```ts
  ipcBridge.projectKnowledge.addSources.provider(({ projectId, filePaths, workspace }) =>
    getService().addSources(projectId, filePaths, workspace)
  );
  ipcBridge.projectKnowledge.removeSource.provider(({ projectId, sourceId, workspace }) =>
    getService().removeSource(projectId, sourceId, workspace)
  );
  ipcBridge.projectKnowledge.retrySource.provider(({ projectId, sourceId, workspace }) =>
    getService().retrySource(projectId, sourceId, workspace)
  );
```

- [ ] **Step 6: Verify everything**

```bash
bunx vitest run tests/unit/process/bridge/nativePayloadSchemas.test.ts
bunx vitest run tests/unit/knowledge
bunx tsc --noEmit
```

Expected: all pass, tsc clean (tests are NOT typechecked by tsc — the vitest run is the drift guard here).

- [ ] **Step 7: Full gate and commit**

```bash
bun run lint:fix && bun run format && just check && bun run test
git add packages/desktop/src/common/adapter/native/payloadSchemas.ts packages/desktop/src/common/adapter/ipcBridge.ts packages/desktop/src/process/bridge/projectKnowledgeBridge.ts tests/unit/process/bridge/nativePayloadSchemas.test.ts
git commit -m "refactor(ipc): require workspace on project-knowledge mutation payloads

Completes the TODO left on the bridge types: every caller already passes
workspace and the service fail-fasts on empty values, so this is contract
cleanup — schema-level rejection plus honest types replace the
empty-string fallbacks in the bridge. No behavior change for valid
callers; payloads omitting workspace are now rejected at the schema
instead of throwing inside the service."
```

---

### Task 5: Coverage threshold groundwork (a manual guard, NOT enforcement)

**Runs LAST, branched from the then-current sprint1 tip** — Tasks 1-4 add tests, and origin has gained thousands of test lines since 2026-08-03 (e.g. the bug-backlog merge alone: +3,162), so the 2026-08-03 measurement (55.29 / 50.40 / 51.15 / 56.22) is illustrative only. Expect materially different numbers.

**What this is and is not:** it turns `bun run test:coverage` into a threshold guard wherever someone runs it — locally, `just test-coverage`, any future pipeline. It does **not** close "unenforced coverage": coverage is absent from `just push`, the GitHub coverage step is `continue-on-error: true` (`pr-checks.yml:206-208`), and the GitLab remote that MRs actually target has no tracked `.gitlab-ci.yml`. Real enforcement is a team decision with two very different price tags — flipping the GitHub step to blocking is one line (but changes CI for every open MR at once), while GitLab enforcement means building a pipeline from scratch. Both are deliberately out of scope here. Note the floor-minus-one pinning tolerates up to ~2 points of drift by design; the guard catches regression **below the configured floor**, not "any regression."

**Files:**
- Modify: `vitest.config.ts` (~lines 89-96)

- [ ] **Step 1: Assert you are ON the tip, then remeasure (idle machine)**

```bash
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/sprint1)" && echo "ON TIP $(git rev-parse --short HEAD)" || echo "STALE — rebase onto origin/sprint1 before measuring"
bun run test:coverage
```

Expected: `ON TIP <hash>` — do NOT measure on a stale HEAD; rebase first if the check prints STALE. Then a coverage summary block; **record all four percentages**. Known caveat: one 2026-08-03 run exited 1 under heavy machine load while the plain suite was green — timeout failures under instrumentation on a loaded machine are a documented flake class in this repo (concurrent sessions inflate durations 15-150×). If it fails: check for competing vitest processes, re-run once idle. Only proceed on a green run; if a failure reproduces on an idle machine, STOP and report the failing test instead of raising timeouts.

- [ ] **Step 2: Pin the thresholds at floor(measured) − 1**

Compute each threshold as `floor(measured percentage) − 1` (e.g. 55.29 → 54). With the 2026-08-03 numbers that yields 54/49/50/55 — substitute your remeasured values. In `vitest.config.ts` change:

```ts
      // Thresholds apply to the included file set.
      // Keeping them informational until coverage ramps up across all files.
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
```

to (with YOUR remeasured floors):

```ts
      // Thresholds apply to the included file set.
      // Ratchet toward the project's ≥80% target (AGENTS.md): pinned one
      // point under the measured baseline (remeasure and update when
      // raising) so a test:coverage run fails on regression BELOW this
      // floor (floor−1 tolerates ~2 points of drift by design). Raise as
      // coverage grows — never lower. NOTE: the GitHub coverage job is
      // continue-on-error and GitLab has no pipeline, so this is a manual
      // guard until the team wires a blocking CI step.
      thresholds: {
        statements: 54,
        branches: 49,
        functions: 50,
        lines: 55,
      },
```

- [ ] **Step 3: Verify the gate passes at the new floor**

```bash
bun run test:coverage
```

Expected: exit 0, no threshold errors.

- [ ] **Step 4: Prove the gate actually bites (temporary, then revert)**

Temporarily set `lines: 99` in `vitest.config.ts`, run `bun run test:coverage`, expect a non-zero exit with a threshold error naming `lines`. Revert to the pinned value. (Do not commit the probe.)

- [ ] **Step 5: Commit**

```bash
just check && bun run test
git add vitest.config.ts
git commit -m "test(coverage): pin thresholds at the measured baseline as a manual guard

Pinned one point under measured actuals so a test:coverage run fails on
regression below the floor, groundwork toward the 80% project target.
Not CI enforcement: the GitHub step is continue-on-error and GitLab has
no pipeline — wiring a blocking gate is a separate team decision."
```

- [ ] **Step 6: MR description must state the enforcement gap**

In the MR body, note explicitly: "This is groundwork — a manual threshold guard on `test:coverage` runs, not CI enforcement. The GitHub coverage step remains `continue-on-error: true` (flipping it is one line but affects every open MR), and GitLab enforcement would mean building a pipeline. Both are separate team decisions."

---

## Per-branch verification (there is no shared final gate)

Each of the five branches is verified independently — the full gate runs inside its own worktree before the commit step of each task, and `just push -u origin <branch>` re-runs lint → format-check → typecheck → i18n → tests as the backstop before anything leaves the machine. Open each MR into `sprint1` using the PR template — checklists filled honestly.
