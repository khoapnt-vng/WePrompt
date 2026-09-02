# Rebase plan (rev 2) — `claude/phase6-status-vocabulary` onto the canonical V4 types

Branch at `51fad83b5`. Revised against the answers to Q1–Q3 and the snake_case correction.

**Three parts of this are no longer mechanical**, and they are the parts worth reading:
the legality matrix becomes canonical, stale-action derivation moves out of the renderer
entirely, and the token casing change renames locale leaves in twelve files.

**Blast radius stays small.** `git grep` finds one consumer of the module's exports —
`tests/unit/pages/studio/statusVocabulary.test.ts`. No renderer file imports it yet.

---

## 1. Identifier mapping, now complete

| Local declaration | Canonical target | Action |
|---|---|---|
| `MEMBER_STATUSES`, `StudioMemberStatus` | `STUDIO_CANVAS_MEMBER_STATUSES_V4` | import, delete local |
| `BLOCK_STATUSES`, `StudioBlockStatus` | `STUDIO_CANVAS_BLOCK_STATUSES_V4`, `StudioCanvasBlockStatusV4` | import, delete local |
| `STUDIO_BLOCK_KINDS`, `StudioBlockKind` | `STUDIO_CANVAS_BLOCK_KINDS_V4` | import, delete local |
| `KIND_LOCAL_BLOCK_STATUSES`, `blockStatusAllowedForKind` | `STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4` | **delete both — the matrix is the authority** |
| `StudioStaleCause` | `StudioMemberStalenessV4` | import, delete local |
| `StudioStaleAction` | `StudioCanvasStaleActionV4` | import, delete local |
| `STALE_ACTIONS`, `staleActionsFor` | — | **delete — Main derives the set** |
| `StudioFailureCost` (`'spent' \| 'notSpent'`) | `StudioCanvasFailureCostTruthV4` (`spent \| not_spent`) | import, delete local |
| — | `StudioCanvasFailureActionV4` | adopt as an addition |
| — | `StudioCanvasRecoveryActionV4` | adopt as an addition |

Surviving local declarations, presentation-only by design: `STATUS_I18N_ROOT`,
`StudioStatusLevel`, `STATUS_SHOWS_CONDITIONS`, `STATUS_CANCELLABLE_FOR_REFUND`, the key
builders, and `allStatusI18nKeys`.

---

## 2. The three non-mechanical consequences

### 2a. The renderer stops deriving stale actions

`STALE_ACTIONS` and `staleActionsFor()` are **deleted, not retyped.** Main derives the action
set from `StudioMemberStalenessV4` and the renderer presents only what is projected.

This is a real behavioural tightening, and it is better than what I wrote: the local table
was a second place where "words-stale offers Keep only" had to stay true. Deleting it makes
that impossible to contradict from the renderer.

It also changes what the test asserts. The existing test proves the renderer's table gives
the two causes different action sets. After the rebase there is no table, so the test becomes
**"the renderer renders exactly the projected actions and never adds one"** — a fixture
carrying a projected set, and an assertion that nothing outside it appears. That is a
stronger test than the one it replaces.

### 2b. Per-kind legality moves to the canonical matrix

`KIND_LOCAL_BLOCK_STATUSES` and `blockStatusAllowedForKind` are **deleted.**
`STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4` is the authority.

The test keeps its exactness requirement but changes its subject: instead of asserting the
local table's contents, it asserts the renderer consults the matrix and that the two
known-exact facts hold through it — `drafted` legal only on `document`, `rendering` legal
only on `cut`. If the matrix disagrees with either, the test fails and the matrix is what
gets examined, which is the right direction of authority.

### 2c. snake_case tokens rename the locale leaves

Canonical tokens are snake_case, so `needsBudget` → `needs_budget`, `readyToRender` →
`ready_to_render`, `notSpent` → `not_spent`.

**The house pattern already supports this**, which resolves it without a preference call.
The i18n skill says camelCase for key names, but en-US already carries **130 snake_case
leaves**, and Studio itself uses them wherever the leaf *is* a domain token —
`creativeStudio.scene.status.needs_title`, `needs_prompt`, `needs_selection`,
`needs_attention`, and `agentError.resolution.wait_for_current_response`. Leaves that mirror
a token go snake_case; prose keys stay camelCase.

So `statusKey()` can keep emitting `${root}.${level}.${token}` with no translation layer,
which is what keeps the vocabulary honest — the key *is* the token, so they cannot drift.

Renaming leaves in twelve locales is a mechanical rename of key paths with values untouched.
It is its own commit and needs `i18n:types` plus `check-i18n` after.

---

## 3. `queued` and `generating` at block level — a classification I need to make

The exhaustive block set includes `queued` and `generating`, which my local list had as
member-only. The compile-time tables will expose both, as intended. Classifying them:

- **`generating` at block level shows conditions.** Region 4 exists while a block is
  generating, and the whole point of the `GENERATING`/`RENDERING` split is that provider work
  has conditions to show. Consistent with the member classification.
- **`queued` at block level shows no conditions and is not refundable.** Same reasoning as
  the member case: committed, started nothing, nothing to reverse.

**Both are proposals, not assertions.** They follow from the signed ruling rather than from
anything canonical, so if either is wrong it is an owner correction and I would rather be told
than assume. The structural change is that `STATUS_SHOWS_CONDITIONS` and
`STATUS_CANCELLABLE_FOR_REFUND` become keyed by level *and* status rather than by member
status alone, since the same token now exists at both levels and may behave differently.

That also removes the last need for `AUTHORED_AT_LEVEL`: with `rendering` canonical at block
level and `queued`/`generating` present at both, every token's authored key follows its
level directly.

---

## 4. Ordered steps

Each ends green. Nothing is left half-migrated across a commit boundary.

**Step 0 — confirm the checkpoint.** Verify all nine identifiers resolve before touching
anything; stop on a partial checkpoint rather than working around it.

```bash
git fetch ghk
for id in STUDIO_CANVAS_MEMBER_STATUSES_V4 STUDIO_CANVAS_BLOCK_STATUSES_V4 \
          StudioCanvasBlockStatusV4 STUDIO_CANVAS_BLOCK_KINDS_V4 \
          STUDIO_CANVAS_BLOCK_STATUS_MATRIX_V4 StudioMemberStalenessV4 \
          StudioCanvasStaleActionV4 StudioCanvasFailureActionV4 \
          StudioCanvasRecoveryActionV4 StudioCanvasFailureCostTruthV4; do
  printf '%-42s %s\n' "$id" \
    "$(git grep -c "$id" ghk/codex/creative-studio-4-pilot -- packages/desktop/src/common | head -1)"
done
```

**Step 1 — rebase.** Onto the Wave 1 commit. Conflicts expected only in
`services/i18n/index.ts`; take theirs and re-apply both `documentElement.lang` assignments,
keeping the synchronous one above `.init()` and the handler one above its early return.

**Step 2 — import the unions, delete the locals.** Retype the behaviour tables by level and
status. A token added upstream then fails to compile until classified. That failure is the
mechanism, not an obstacle.

**Step 3 — delete the derivation and the matrix copy.** Remove `STALE_ACTIONS`,
`staleActionsFor`, `KIND_LOCAL_BLOCK_STATUSES`, `blockStatusAllowedForKind`. Rewrite the two
affected tests as described in 2a and 2b.

**Step 4 — rename the locale leaves to snake_case** in all twelve, values untouched. Then
`bun run i18n:types && node scripts/check-i18n.js`.

**Step 5 — adopt the failure and recovery action keys.** New strings in en-US plus the
eleven others, with the same reuse-the-locale's-existing-term pass. Own commit.

**Step 6 — delete `AUTHORED_AT_LEVEL` and the `PENDING REBASE` header.** After step 4 the
divergence no longer exists; the header would be the only remaining untruth in the file.

---

## 5. Verification

```bash
bunx tsc --noEmit
bunx vitest run tests/unit/pages/studio/statusVocabulary.test.ts \
                tests/unit/renderer/i18nDocumentLanguage.dom.test.ts
bunx vitest run tests/unit/pages/studio
bun run i18n:types && node scripts/check-i18n.js
bun run test:coverage:creative-studio     # the file must stay at 100/100
just push ghk claude/phase6-status-vocabulary
```

Two cautions, each already paid for once in this work:

- **A failing test under load is a load artifact until proven otherwise.** This suite inflates
  badly while a coverage run competes; I misread exactly that as causation earlier. Re-run
  idle before concluding anything.
- **Judge `just push` by an exit code you echoed yourself.** The wrapper's has misreported
  twice here.

---

## 6. Rollback

Every step is its own commit and nothing imports the module yet, so rollback is
`git reset --hard 51fad83b5` and a force-push of this branch alone. The coverage manifest
entry is inert if the file is absent.
