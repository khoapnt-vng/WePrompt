# WePrompt Sprint 3 Internal RC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task by task. Use `superpowers:test-driven-development` for all source and release-tooling changes, `superpowers:systematic-debugging` for failures, and `superpowers:verification-before-completion` before recording a gate as passed.

**Goal:** Create one reviewed WePrompt Sprint 3 RC that pins the exact accepted AionCore `v0.1.55` bundles, contains only justified release-critical ports, fails closed on Creative Studio/update exposure, and produces unsigned macOS ARM64 and Windows x64 packages with complete evidence.

**Architecture:** Keep the RC rooted at the immutable Sprint 3 commit. Consume a complete AionCore release unit through a strict manifest/checksum/lineage verifier, never a mutable branch or locally regenerated release resources. Audit named later commits individually, port only the smallest complete behavior, and make release configuration, CI flake triage, Windows risk gates, and package inventory executable contracts.

**Tech Stack:** Bun 1.3.14, TypeScript, Electron/Electron Builder, Vitest, Playwright, Node.js release scripts, GitHub Actions, PowerShell, SHA-256.

**Spec:** `docs/superpowers/specs/2026-08-15-sprint3-internal-release-readiness-design.md`

## Global Constraints

- Repository: `/Users/lap16603/Projects/.worktrees/weprompt-internal-sprint3` from exact base `634f49c21567d9bd987b04887eaa0c6126b86353`.
- Do not merge or rebase onto WePrompt `main`. Do not merge a Creative Studio branch.
- Do not finalize the backend pin until `docs/release/sprint3-internal/aioncore-v0.1.55.json` is generated from independently verified published assets.
- Preserve the lockfile and use `bun install --frozen-lockfile` for gates.
- Internal release means unsigned, no Sentry upload, no update feed, and manual distribution.
- Build exactly macOS ARM64 and Windows x64. Do not use a six-target `all` build.
- Every source change creates a new RC SHA and invalidates packages built from the prior SHA.
- Do not push, open PRs, or trigger external build/release workflows without separate authorization.

---

## Task 1: Establish RC Evidence Contracts

**Files:**

- Create: `docs/release/sprint3-internal/README.md`
- Create: `docs/release/sprint3-internal/baselines.md`
- Create: `docs/release/sprint3-internal/aioncore-v0.1.55.schema.json`
- Create: `docs/release/sprint3-internal/selected-fix-audit.md`
- Create: `scripts/release/validate-aioncore-release-record.js`
- Create: `tests/unit/release/aioncoreReleaseRecord.test.ts`

- [ ] Verify the isolated worktree and runtime versions:

```bash
cd /Users/lap16603/Projects/.worktrees/weprompt-internal-sprint3
test "$(git rev-parse HEAD)" = "634f49c21567d9bd987b04887eaa0c6126b86353"
test -z "$(git status --porcelain)"
bun --version
node --version
git show -s --format='%H %ad %s' --date=iso-strict HEAD
```

- [ ] Write the release README with approved targets, unsigned/manual distribution, explicit exclusions, evidence file meanings, and invalidation rules.
- [ ] Record exact base/remote observations in `baselines.md`; remote movement does not change the approved base.
- [ ] Define the AionCore record schema: schema version 1, repository/version/tag commit/fingerprint, exactly two target records, 64-hex hashes, no duplicate target/asset name, and no additional properties.
- [ ] Write failing tests for missing fields, uppercase/short hashes, duplicate targets, wrong repository/version, extra targets, and a valid two-target record.
- [ ] Run and see the missing validator fail:

```bash
bunx vitest run tests/unit/release/aioncoreReleaseRecord.test.ts
```

- [ ] Implement deterministic, field-specific validation and a nonzero CLI exit for invalid input.
- [ ] Rerun and commit only these paths:

```bash
bunx vitest run tests/unit/release/aioncoreReleaseRecord.test.ts
git add docs/release/sprint3-internal/README.md docs/release/sprint3-internal/baselines.md docs/release/sprint3-internal/aioncore-v0.1.55.schema.json docs/release/sprint3-internal/selected-fix-audit.md scripts/release/validate-aioncore-release-record.js tests/unit/release/aioncoreReleaseRecord.test.ts
git diff --cached --check
git commit -m "docs(release): establish Sprint 3 RC evidence contracts"
```

## Task 2: Audit Named Later Fixes Without Merging `main`

**Files:**

- Modify: `docs/release/sprint3-internal/selected-fix-audit.md`
- Test: focused files named per candidate below

For each candidate, record source commit, changed paths, dependency assumptions, baseline reproduction/contract need, smallest complete patch, focused tests before/after, and one decision: `ported`, `already present`, `replaced`, or `excluded`.

- [ ] Fetch named commits as review objects and verify the RC head remains unchanged:

```bash
git fetch --prune ghk main
git cat-file -e 8c66c75ac^{commit}
git cat-file -e 95d8dd4ed^{commit}
git cat-file -e 1a310731b^{commit}
git cat-file -e 642665720^{commit}
git cat-file -e c2c7de286^{commit}
git cat-file -e 7820b7f93^{commit}
git cat-file -e 4865c1ef0^{commit}
git cat-file -e 8cafd02c4^{commit}
git cat-file -e 6e6b0834c^{commit}
git cat-file -e 371f0875b^{commit}
git cat-file -e 7a4c3cc79^{commit}
test "$(git merge-base HEAD 634f49c21567d9bd987b04887eaa0c6126b86353)" = "634f49c21567d9bd987b04887eaa0c6126b86353"
```

- [ ] Review live WebSocket authentication candidate `8c66c75ac`: `httpBridge.ts`, `PresentationRuntimeEventClient.ts`, `SpeechStreamClient.ts`, and their three focused tests. Port only if RC WebSockets omit the local credential or packaged acceptance requires the later behavior.
- [ ] Review `95d8dd4ed`, focusing on the session-cookie/headerless request behavior in `packages/desktop/src/index.ts`. Exclude unrelated `WeixinConfigForm.tsx` formatting unless a separately reproduced failure requires it.
- [ ] Review OfficeCLI candidates `1a310731b` and `642665720` together. Prefer release-carried `managed-resources/`; do not duplicate local generation. Port runner/service resolution only if its packaged-path test fails.
- [ ] Review presentation-template path candidate `c2c7de286` against `packages/desktop/electron-builder.yml` and final inventory.
- [ ] Review Windows candidates `7820b7f93`, `4865c1ef0`, `8cafd02c4`, `6e6b0834c`, and `371f0875b`; split mixed commits into independently justified decisions.
- [ ] Record mac signing/notarization candidate `7a4c3cc79` as `excluded`. A needed non-signing hunk becomes a separately documented candidate.
- [ ] Inspect exact diffs, never a whole-commit cherry-pick as review:

```bash
git diff 634f49c21567d9bd987b04887eaa0c6126b86353 8c66c75ac -- packages/desktop/src/common/adapter/httpBridge.ts
git show --stat --oneline 95d8dd4ed 1a310731b 642665720 c2c7de286 7820b7f93 4865c1ef0 8cafd02c4 6e6b0834c 371f0875b 7a4c3cc79
```

- [ ] Commit the audit before any port. Each port later updates its row with the new RC commit.

```bash
git add docs/release/sprint3-internal/selected-fix-audit.md
git diff --cached --check
git commit -m "docs(release): audit Sprint 3 release-fix candidates"
```

## Task 3: Pin and Verify the Complete AionCore v0.1.55 Bundle

**Files:**

- Create: `docs/release/sprint3-internal/aioncore-v0.1.55.json`
- Modify: `package.json`
- Modify: `packages/shared-scripts/src/prepare-aioncore.js`
- Modify: `packages/shared-scripts/src/aioncore-checksums.js`
- Modify: `packages/shared-scripts/src/aioncore-migration-lineage.json`
- Modify: `packages/shared-scripts/src/verify-bundled-aioncore-resources.js`
- Modify: `packages/desktop/src/index.ts`
- Modify: `resources/windows/support/verify-bundled-aioncore-install.ps1`
- Test: `tests/unit/assets/prepareAioncoreActionsArtifact.test.ts`
- Test: `tests/unit/assets/prepareAioncoreLocalBundle.test.ts`
- Test: `tests/unit/assets/verifyAioncoreArtifactDigest.test.ts`
- Test: `tests/unit/assets/verifyBundledAioncoreResources.test.ts`
- Test: `tests/unit/assets/aioncoreLineageRejection.test.ts`
- Test: `tests/unit/assets/verifyBundledAioncoreInstallScript.test.ts`
- Test: `tests/unit/bootstrap/backendInstallDiagnostics.test.ts`

- [ ] Generate `aioncore-v0.1.55.json` from independently downloaded bytes/manifests and validate it:

```bash
node scripts/release/validate-aioncore-release-record.js docs/release/sprint3-internal/aioncore-v0.1.55.json
```

- [ ] Write failing tests requiring exact fork/version, target-selected archive SHA, the required five top-level members, manifest identity/fingerprint equality, all payload/checksum verification, and rejection of extra/missing members, symlinks, path escape, target mix-up, mutable fallback, wrong source commit, and stale lineage.
- [ ] Require release mode to consume included managed resources and never execute the downloaded binary to regenerate them. Keep nested `managed-resources/manifest.json` distinct from top-level `bundle-manifest.json`.
- [ ] Run focused tests and confirm old assumptions fail:

```bash
bunx vitest run tests/unit/assets/prepareAioncoreActionsArtifact.test.ts tests/unit/assets/prepareAioncoreLocalBundle.test.ts tests/unit/assets/verifyAioncoreArtifactDigest.test.ts tests/unit/assets/verifyBundledAioncoreResources.test.ts tests/unit/assets/aioncoreLineageRejection.test.ts tests/unit/assets/verifyBundledAioncoreInstallScript.test.ts tests/unit/bootstrap/backendInstallDiagnostics.test.ts
```

- [ ] Set the package pin and constants only from the validated record. Copy the released lineage document; do not reconstruct it in WePrompt.
- [ ] Refactor release mode to download, checksum, safely extract, validate, and stage the complete bundle. A local-development path may remain only if it cannot be selected by `WEPROMPT_INTERNAL_RELEASE=1`.
- [ ] Update startup, JS verification, Windows installed verification, and diagnostics to require `bundle-manifest.json` and the exact lineage fingerprint.
- [ ] Rerun and search for stale/upstream pins:

```bash
bunx vitest run tests/unit/assets/prepareAioncoreActionsArtifact.test.ts tests/unit/assets/prepareAioncoreLocalBundle.test.ts tests/unit/assets/verifyAioncoreArtifactDigest.test.ts tests/unit/assets/verifyBundledAioncoreResources.test.ts tests/unit/assets/aioncoreLineageRejection.test.ts tests/unit/assets/verifyBundledAioncoreInstallScript.test.ts tests/unit/bootstrap/backendInstallDiagnostics.test.ts
rg -n 'v0\.1\.51|d4d8e877|iOfficeAI/AionCore' package.json packages/shared-scripts packages/desktop/src/index.ts resources/windows/support
```

**Expected:** tests pass and no active release pin targets the old/upstream backend; historical fixture text is explicitly labelled.

- [ ] Commit the pin and verifier together with explicit paths after inspecting cached diff.

## Task 4: Make Studio and Auto-Update Exclusions Fail Closed

**Files:**

- Modify: `packages/desktop/src/common/update/updatePolicy.ts`
- Modify: `packages/desktop/electron.vite.config.ts`
- Modify: `packages/desktop/src/common/config/constants.ts`
- Modify: `.github/workflows/_build-reusable.yml`
- Modify: `tests/unit/process/updatePolicy.test.ts`
- Modify: `tests/unit/process/buildPolicyConfig.test.ts`
- Modify: `tests/unit/releasePackagingConfig.test.ts`
- Create: `tests/unit/release/internalReleaseExclusions.test.ts`

- [ ] Write failing tests: internal release rejects `AIONUI_ENABLE_CREATIVE_STUDIO=1`, any update feed/base URL, and Sentry upload/release secrets; absent values resolve disabled; development retains existing behavior; compiled config retains the assertion.
- [ ] Run focused tests and observe missing Studio assertion failure:

```bash
bunx vitest run tests/unit/process/updatePolicy.test.ts tests/unit/process/buildPolicyConfig.test.ts tests/unit/releasePackagingConfig.test.ts tests/unit/release/internalReleaseExclusions.test.ts
```

- [ ] Extend the typed release environment with `AIONUI_ENABLE_CREATIVE_STUDIO`. Resolve exclusions in one policy boundary used by Electron Vite and the reusable workflow.
- [ ] Add workflow preflight that logs only enabled/disabled feature names and fails before install/build when a forbidden value is configured.
- [ ] Ensure internal jobs set no update URL and run no update-publish step.
- [ ] Rerun focused tests, inspect the diff, and commit as `build(release): enforce internal feature exclusions`.

## Task 5: Port Only Approved Auth and Packaged-Resource Fixes

Execute only rows whose audit decision is `ported`.

### Task 5.1: Auth transport port, if approved

- [ ] Add focused failing tests so HTTP and both WebSocket clients share the local session/auth contract, headerless/sessionless requests cannot bypass auth, and credentials never enter logs.
- [ ] Run:

```bash
bunx vitest run tests/unit/common-adapter/httpBridge.test.ts tests/unit/process/services/presentation-template/lifecycle/PresentationRuntimeEventClient.test.ts tests/unit/renderer/speechStreamClient.dom.test.ts
```

- [ ] Port the smallest complete behavior from `8c66c75ac`/`95d8dd4ed`, rerun, update the audit row, and commit with source commits in the body.

### Task 5.2: OfficeCLI port, if approved

**Files:** Modify `officeCliRunner.ts`, `OfficeArtifactService.ts`, and `officeCliRunner.test.ts`; create `tests/unit/assets/officecliAssetName.test.ts` if the accepted contract needs the later asset-name coverage.

- [ ] First test packaged lookup from the complete managed-resource root, Windows naming, missing-resource failure, and refusal to fall back to unrelated host `PATH` for internal release.
- [ ] Port only required resolution behavior from `1a310731b`. Mark `642665720` replaced when the accepted backend bundle carries the resource.
- [ ] Rerun focused tests, update audit, and commit.

### Task 5.3: Template path port, if approved

- [ ] Make `tests/unit/releasePackagingConfig.test.ts` fail when templates are absent or builder/runtime paths disagree.
- [ ] Port only required `electron-builder.yml` mapping from `c2c7de286`, rerun, update audit, and commit.

## Task 6: Make Windows an Equal Source Gate and Higher-Risk Runtime Gate

**Files:**

- Create: `.github/workflows/sprint3-internal-rc.yml`
- Modify: `.github/workflows/build-manual.yml`
- Modify: `.github/workflows/_build-reusable.yml`
- Modify if approved: files from `7820b7f93`, `4865c1ef0`, `8cafd02c4`, `6e6b0834c`, `371f0875b`
- Test: `tests/unit/releasePackagingConfig.test.ts`
- Test: `tests/unit/process/services/officeArtifact/readiness/PresentationReadinessService.test.ts`

- [ ] Write workflow-contract tests requiring exactly macOS ARM64 plus Windows x64, `internal_release: true`, no signing/update/Studio, and exact caller-supplied commit SHA rather than a branch default.
- [ ] Add native Windows x64 source job on `windows-2022`: Bun 1.3.14, frozen install, typecheck, lint, format, i18n, deterministic tests, controlled full suite, focused BUG-043, package build, installed-content verification.
- [ ] Add macOS ARM64 equivalent on `macos-15`.
- [ ] Add `internal-two-target` manual choice or use the dedicated RC workflow as the only release entry; never use six-target `all`.
- [ ] On Windows, capture focused BUG-043 path-stat/handle-stat evidence:

```powershell
bunx vitest run tests/unit/process/services/officeArtifact/readiness/PresentationReadinessService.test.ts -t "rejects same-byte replacement and hardlink drift of the inspection path" --reporter=verbose
```

- [ ] Add packaged readiness probe: missing, unsupported, or ambiguous identity evidence must block approval. Skipped hardlink capability is failure, not pass.
- [ ] Run workflow-contract tests and commit workflow/Windows changes separately from unrelated ports.

## Task 7: Encode the BUG-046 Full-Suite Policy

**Files:**

- Create: `docs/release/sprint3-internal/known-flakes.json`
- Create: `scripts/release/run-vitest-gate.js`
- Create: `scripts/release/validate-full-suite-ledger.js`
- Create: `tests/unit/release/vitestGateLedger.test.ts`
- Modify: `.github/workflows/sprint3-pr-gate.yml`
- Modify: `.github/workflows/sprint3-internal-rc.yml`

- [ ] Encode only frozen signatures: BUG-027's two exact jobManager tests; BUG-030's post-green TeamSiderSection teardown; BUG-043's exact readiness test; BUG-046's StudioPage `fitStoryboardToGoal` wait and PresentationSourceGrantStore sightings. Exclude BUG-025 and the fixed broker timer case.
- [ ] Write failing ledger tests: first red retained after later green; unknown blocks; exact signature requires focused diagnostic and reviewer disposition; new test name is unknown; altered assertions rejected; required metadata/log hash present; total run count equals ordered attempts.
- [ ] Implement one full invocation per commit/runner. Capture command, commit, runner/OS, Bun/Node, UTC start/end, exit code, failed files/tests, raw-log SHA-256, and available load evidence.
- [ ] Wrapper stops after nonzero and emits triage-required state; it never auto-reruns. Focused diagnostics link to an item/question and never change the original exit code.
- [ ] Remove the old “re-run the job” guidance and BUG-030 conversion to success. Upload raw/clean logs, register, and ledger even on failure.
- [ ] Validate and commit:

```bash
bunx vitest run tests/unit/release/vitestGateLedger.test.ts
node scripts/release/validate-full-suite-ledger.js tests/fixtures/release/full-suite-ledger-valid.json
git add docs/release/sprint3-internal/known-flakes.json scripts/release/run-vitest-gate.js scripts/release/validate-full-suite-ledger.js tests/unit/release/vitestGateLedger.test.ts .github/workflows/sprint3-pr-gate.yml .github/workflows/sprint3-internal-rc.yml
git diff --cached --check
git commit -m "ci(test): record and triage every full-suite result"
```

## Task 8: Run Source Gates on the Exact RC

**Files:**

- Create from the gate wrapper: `docs/release/sprint3-internal/source-gates.json`
- Create from the gate wrapper: `docs/release/sprint3-internal/full-suite-ledger.json`

- [ ] Install and run deterministic gates on macOS, then the same gates in native Windows CI:

```bash
bun --version
node --version
bun install --frozen-lockfile
bunx tsc --noEmit
bun run lint
bun run format:check
bun run i18n:types
node scripts/check-i18n.js
git diff --exit-code -- packages/desktop/src/common/i18n
bunx vitest run tests/unit/release tests/unit/assets tests/unit/process/updatePolicy.test.ts tests/unit/process/buildPolicyConfig.test.ts tests/unit/releasePackagingConfig.test.ts
```

- [ ] Run the full suite once per runner through the wrapper's fixed interface. On nonzero, stop and triage every failure before any diagnostic run:

```bash
node scripts/release/run-vitest-gate.js --register docs/release/sprint3-internal/known-flakes.json --ledger docs/release/sprint3-internal/full-suite-ledger.json --log-dir artifacts/sprint3-internal/vitest -- bun run test
```
- [ ] For exact known signatures, run only that exact test as a recorded diagnostic with a stated question. Do not raise timeout or change assertions.
- [ ] Validate the completed ledger; unknown, missing reviewer disposition, or hidden attempt blocks:

```bash
node scripts/release/validate-full-suite-ledger.js docs/release/sprint3-internal/full-suite-ledger.json
```

- [ ] Commit source-gate metadata/ledger only after logs have stable evidence URLs or checksummed artifact paths. Do not commit sensitive raw logs.

## Task 9: Build and Inventory the Two Unsigned Packages

**Files:**

- Create: `scripts/release/verify-internal-package.js`
- Create: `scripts/release/create-artifact-index.js`
- Create: `tests/unit/release/internalPackageInventory.test.ts`
- Create after authorized builds: `docs/release/sprint3-internal/artifact-index.json`

- [ ] Write failing inventory tests requiring exact WePrompt RC commit; exact AionCore tag commit/binary hash/manifest/fingerprint; internal/unsigned policy; Studio/update disabled; expected template/OfficeCLI resources; no out-of-scope architecture.
- [ ] Implement verification for unpacked/app archive and installed Windows contents. Reject unexpected backend bytes, absent templates, enabled flags/update config, or forbidden target.
- [ ] Run the inventory contract test before any external build:

```bash
bunx vitest run tests/unit/release/internalPackageInventory.test.ts
```
- [ ] After authorization, trigger the dedicated workflow with the exact 40-character RC SHA, never a branch.
- [ ] Build exactly `macos-15/arm64/unsigned` and `windows-2022/x64/unsigned`.
- [ ] On native runners verify contents before upload, install/extract fresh, verify installed contents, and compute desktop plus embedded-backend SHA-256.
- [ ] Upload inventory, build log, tool versions, verifier output, source-gate evidence. Generate `artifact-index.json` from bytes/metadata and validate two targets, one RC, one backend, unsigned state, unique names/hashes.

## WePrompt RC Completion Criteria

- [ ] RC descends from the approved base without wholesale `main` integration.
- [ ] Every named later fix has reviewed disposition; each port has focused red/green evidence.
- [ ] Backend record, tag, archives, manifests, staged bytes, and startup fingerprint agree.
- [ ] Release mode never regenerates managed resources from a downloaded binary.
- [ ] Studio and update/Sentry fail before build when enabled.
- [ ] macOS ARM64 and Windows x64 deterministic source gates pass on exact RC.
- [ ] Full-suite ledger retains all attempts and has no unknown/undisposed failure.
- [ ] Native Windows BUG-043 evidence is fail-closed.
- [ ] Two unsigned packages from one RC pass content verification.
- [ ] No tag, public release, update feed, or distribution occurred under this plan.
