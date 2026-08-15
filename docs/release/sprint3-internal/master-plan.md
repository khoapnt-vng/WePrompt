# Sprint 3 Internal Release Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task by task. Use `superpowers:test-driven-development` for every product or tooling change, `superpowers:systematic-debugging` for unexpected failures, and `superpowers:verification-before-completion` before each handoff.

**Goal:** Produce a decision-ready, unsigned Sprint 3 internal release for macOS ARM64 and Windows x64 from immutable WePrompt and AionCore baselines, without exposing Creative Studio or enabling auto-update.

**Architecture:** Release AionCore `v0.1.55` as a complete, immutable two-target backend bundle first. Pin one WePrompt RC to those exact assets, audit only named later fixes, then build and accept two desktop packages. Every stage emits machine-readable evidence consumed by the next stage; no branch name, green rerun, or partial platform result substitutes for exact-commit and exact-artifact proof.

**Tech Stack:** Rust 2024/Rust 1.95, Cargo/nextest, Python 3, Bun 1.3.14, TypeScript, Vitest, Electron/Electron Builder, Playwright, GitHub Actions, PowerShell, SHA-256/SHA-384.

**Spec:** `docs/release/sprint3-internal/readiness-design.md`

## Global Constraints

- Planning does not authorize source implementation, branch protection changes, tags, GitHub releases, asset replacement, pushes, or distribution.
- Backend source is only `khoapnt-vng/aioncore`; do not substitute `iOfficeAI/AionCore`.
- Start WePrompt at `634f49c21567d9bd987b04887eaa0c6126b86353` and AionCore at `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`.
- Work in isolated worktrees. Preserve dirty or unrelated user files. Stage explicit paths only.
- Build only `aarch64-apple-darwin`/macOS ARM64 and `x86_64-pc-windows-msvc`/Windows x64.
- Keep Creative Studio code in the tree but fail any internal build that enables it. Keep auto-update disabled.
- Never merge WePrompt `main` wholesale. Evaluate only the candidate commits named in the WePrompt RC plan.
- Never rerun a failed suite until every failure from that run has a recorded classification. A later green run does not erase an earlier red run.
- Run Windows packaged acceptance first. Missing native Windows evidence is a release no-go.
- BUG-017 prevents a plain **Go** while detection/recovery remains unbuilt. The only admissible outcomes are explicit **Conditional go** with accepted residual risk or **No-go**.
- A source, pin, migration, packaging, or build-toolchain change invalidates affected artifacts and evidence.

---

## Release Outputs and Handoffs

| Producer                 | Required immutable output                                                                                                    | Consumer                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| AionCore plan            | Accepted `v0.1.55` tag/commit, two release assets, archive hashes, extracted manifests, migration fingerprint                | WePrompt RC plan         |
| WePrompt RC plan         | Accepted RC commit, fix-audit decisions, deterministic source gates, complete full-suite ledger, two desktop artifact hashes | Packaged-acceptance plan |
| Packaged-acceptance plan | Two-platform acceptance matrix, known-issue record, evidence index, exact decision record                                    | Release owner            |

The canonical handoff directory in the WePrompt RC is `docs/release/sprint3-internal/`. The following committed records have fixed roles:

- `aioncore-v0.1.55.json`: AionCore release identity and target asset facts.
- `selected-fix-audit.md`: later-fix applicability and port decisions.
- `source-gates.json`: deterministic gate results for the exact WePrompt RC.
- `full-suite-ledger.json`: ordered Vitest attempts and per-failure dispositions.
- `artifact-index.json`: desktop package and embedded-backend identities.
- `acceptance-matrix.md`: scenario result and evidence link per target.
- `known-issues.md`: severity, owner, workaround, and release disposition.
- `evidence-index.json`: schema-validated inventory of the final evidence packet.
- `go-no-go.md`: exact artifact hashes and the release owner's explicit decision.

Records may begin on an RC task branch, but any value used for release must be regenerated on the final accepted commit. Do not hand-edit hashes or derive them from a mutable branch.

## Phase 0: Freeze Baselines and Create Isolated Worktrees

### Task 0.1: Record exact remote state

**Files:**

- Create in the release worktree: `docs/release/sprint3-internal/baselines.md`

- [ ] Fetch without changing either current checkout:

```bash
git -C /Users/lap16603/Projects/WePrompt fetch --prune ghk
git -C /Users/lap16603/Projects/AionCore fetch --no-tags https://github.com/khoapnt-vng/aioncore.git 9bd693b3b43cdb1003061de0e4f62259ab6f42ae
git ls-remote --heads --tags https://github.com/khoapnt-vng/aioncore.git
```

- [ ] Verify the approved commits exist and record their object types:

```bash
git -C /Users/lap16603/Projects/WePrompt cat-file -e 634f49c21567d9bd987b04887eaa0c6126b86353^{commit}
git -C /Users/lap16603/Projects/AionCore cat-file -e 9bd693b3b43cdb1003061de0e4f62259ab6f42ae^{commit}
git -C /Users/lap16603/Projects/WePrompt show -s --format='%H%n%P%n%ad%n%s' --date=iso-strict 634f49c21567d9bd987b04887eaa0c6126b86353
git -C /Users/lap16603/Projects/AionCore show -s --format='%H%n%P%n%ad%n%s' --date=iso-strict 9bd693b3b43cdb1003061de0e4f62259ab6f42ae
```

- [ ] Record `git status --short`, relevant remote branch heads, tags pointing at each commit, and ancestry checks in `baselines.md`. State explicitly that observations after the approved immutable commits are context, not a silent baseline change.

- [ ] Commit only the baseline record on the release orchestration branch:

```bash
git add docs/release/sprint3-internal/baselines.md
git diff --cached --check
git commit -m "docs(release): record Sprint 3 immutable baselines"
```

**Expected:** both `cat-file` commands exit 0; the record contains full 40-character SHAs and cleanly distinguishes base from current remote heads.

### Task 0.2: Create RC worktrees without disturbing existing checkouts

- [ ] Confirm each intended path is absent and each source checkout's current status has been saved:

```bash
test ! -e /Users/lap16603/Projects/.worktrees/weprompt-internal-sprint3
test ! -e /Users/lap16603/Projects/.worktrees/aioncore-internal-v0.1.55
git -C /Users/lap16603/Projects/WePrompt status --short
git -C /Users/lap16603/Projects/AionCore status --short
```

- [ ] Create release branches from immutable commits:

```bash
git -C /Users/lap16603/Projects/WePrompt worktree add -b release/internal-sprint3 /Users/lap16603/Projects/.worktrees/weprompt-internal-sprint3 634f49c21567d9bd987b04887eaa0c6126b86353
git -C /Users/lap16603/Projects/AionCore worktree add -b release/internal-v0.1.55 /Users/lap16603/Projects/.worktrees/aioncore-internal-v0.1.55 9bd693b3b43cdb1003061de0e4f62259ab6f42ae
```

- [ ] Verify exact worktree heads and clean status:

```bash
git -C /Users/lap16603/Projects/.worktrees/weprompt-internal-sprint3 rev-parse HEAD
git -C /Users/lap16603/Projects/.worktrees/aioncore-internal-v0.1.55 rev-parse HEAD
git -C /Users/lap16603/Projects/.worktrees/weprompt-internal-sprint3 status --short
git -C /Users/lap16603/Projects/.worktrees/aioncore-internal-v0.1.55 status --short
```

**Expected:** exact approved SHAs, empty status, and no mutation to the pre-existing checkouts.

## Phase 1: Execute AionCore v0.1.55 Plan

- [ ] Execute `docs/release/sprint3-internal/aioncore-v0.1.55-plan.md` in order.
- [ ] Do not start the final WePrompt backend pin until AionCore produces an immutable `v0.1.55` tag and all facts required by `aioncore-v0.1.55.json`.
- [ ] Independently download each published asset into a fresh temporary directory and run the bundle verifier after extraction.
- [ ] Compare the peeled tag commit, embedded `sourceCommit`, archive sidecar hash, payload hashes, and migration fingerprint. Any difference blocks the handoff.

**Phase exit evidence:** accepted AionCore RC commit; passing source gates; immutable tag; two verified full bundles; no asset replacement; OAuth fail-closed evidence.

## Phase 2: Execute WePrompt RC Plan

- [ ] Execute `docs/release/sprint3-internal/weprompt-rc-plan.md` in order.
- [ ] Consume AionCore identities from generated evidence, never from memory or a branch label.
- [ ] Require review for every selected-fix decision and every code port.
- [ ] Hold packaging if the full-suite ledger contains any unclassified failure, missing focused diagnostic, altered assertion, or undocumented rerun.

**Phase exit evidence:** exact WePrompt RC commit; exact AionCore pin; Studio/update fail-closed assertions; fix audit; deterministic gates; complete suite ledger; two package hashes and inventories.

## Phase 3: Execute Packaged Acceptance Plan

- [ ] Execute `docs/release/sprint3-internal/packaged-acceptance-plan.md` in order.
- [ ] Use copies of the last accepted Sprint 2 database. Preserve every failed fixture, bounded log set, and hash.
- [ ] Run Windows x64 gates and all Windows scenarios before macOS ARM64.
- [ ] Record BUG-017 as an open P1; do not turn a synthetic error payload into runtime acceptance.

**Phase exit evidence:** complete two-target matrix; Windows BUG-043 filesystem/runtime proof; no stale OAuth token; verified package contents; BUG-017 disposition; exact decision form.

## Phase 4: Decision and Manual Distribution

### Task 4.1: Freeze the decision candidate

- [ ] Recompute package SHA-256 values directly from the held artifacts and compare them to `artifact-index.json` and `evidence-index.json`.
- [ ] Verify no source commit, workflow, dependency lock, toolchain, AionCore asset, or package changed since evidence collection.
- [ ] Generate `go-no-go.md` with exactly one decision vocabulary: `Go`, `Conditional go`, or `No-go`.
- [ ] Because BUG-017 remains open under the approved design, reject `Go` unless exact-wire-shape detection/recovery was implemented and accepted before the decision. Otherwise offer only `Conditional go` or `No-go`.
- [ ] Require the release owner to enter name, UTC timestamp, exact two artifact hashes, BUG-017 acceptance text, and decision. Blank fields and silence mean `No-go`/held.

### Task 4.2: Distribute only after explicit approval

- [ ] If the decision is `No-go`, leave artifacts held, preserve the packet, and create a blocker list. Do not distribute.
- [ ] If the decision is `Conditional go`, include the BUG-017 limitation and preservation-first workaround verbatim in the internal release notes and installation message.
- [ ] Deliver only the two approved files and their matching checksums/instructions to the named internal audience.
- [ ] Do not create an update feed. Manual replacement is the only upgrade path.
- [ ] Record distribution timestamp, recipients/audience identifier, artifact hashes, and rollback contact without recording credentials or private user data.

## Release-Wide Stop Conditions

Stop immediately and invalidate the relevant phase when any of these occurs:

- The checked-out head differs from a recorded reviewed head.
- OAuth sends or returns an expired bearer after expiry/refresh failure.
- Migration lineage mismatch reaches database mutation.
- Bundle/archive identity cannot be tied to the exact backend source commit.
- Any complete-bundle member, checksum, or manifest field is missing or inconsistent.
- Studio or auto-update is enabled or contacted in a packaged build.
- HTTP or WebSocket auth can be bypassed.
- Windows native CI, BUG-043, install-time bundle verification, or packaged acceptance is absent.
- A suite failure is unknown, untriaged, or erased by a later green attempt.
- BUG-017 can enter destructive recovery or is omitted from the decision record.
- An already-published AionCore or desktop asset would need replacement under the same identity.

## Final Verification Checklist

- [ ] All exact SHAs in evidence resolve to commits in the named repositories.
- [ ] AionCore archive names, sidecar hashes, extracted manifests, payload hashes, and lineage fingerprint agree.
- [ ] WePrompt's embedded backend bytes equal the accepted AionCore payload bytes.
- [ ] Both desktop packages come from one accepted WePrompt RC commit.
- [ ] Only macOS ARM64 and Windows x64 appear in the release matrix.
- [ ] The full-suite ledger lists every attempt in chronological order, including red runs.
- [ ] Every required packaged scenario has per-target status and evidence.
- [ ] The Windows BUG-043 gate is native, packaged, and fail-closed on ambiguous evidence.
- [ ] BUG-017 owner, workaround, residual risk, and decision are present.
- [ ] The release owner explicitly names the exact artifact hashes.
- [ ] Distribution has not occurred before that signature.
