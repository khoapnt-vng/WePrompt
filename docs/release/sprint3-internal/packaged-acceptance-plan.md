# Sprint 3 Packaged Acceptance and Release Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task by task. Use `superpowers:systematic-debugging` for every unexpected packaged failure and `superpowers:verification-before-completion` before presenting a release decision.

**Goal:** Prove or reject the exact unsigned Sprint 3 macOS ARM64 and Windows x64 artifacts on clean representative machines, assemble a tamper-evident evidence packet, and obtain an explicit release-owner decision.

**Architecture:** Acceptance is artifact-first and Windows-first. A schema-validated evidence index binds each scenario to exact desktop and embedded-backend hashes, environment, timestamps, logs, and tester disposition. Automated probes cover deterministic security/integrity contracts; human-observed steps cover OS installation and UX. Failed fixtures are preserved. BUG-017 remains a named P1 with a preservation-first workaround and cannot silently pass.

**Tech Stack:** Installed Electron packages, Playwright/Vitest probes, Node.js evidence scripts, PowerShell on Windows, macOS shell tools, SQLite fixture copies, SHA-256, GitHub Actions artifacts.

**Spec:** `docs/release/sprint3-internal/readiness-design.md`

## Global Constraints

- Test only artifacts named and hashed in `docs/release/sprint3-internal/artifact-index.json`.
- Run Windows x64 before macOS ARM64. A missing Windows host or unexercised Windows guard is a no-go.
- Use clean representative VMs/machines and fresh OS accounts where feasible. Record OS build, filesystem, CPU architecture, and tester.
- Use copies of Sprint 2 data and test OAuth accounts. Never use the only copy of user data or production credentials.
- Redact tokens, cookies, authorization codes, client secrets, message/file contents, and user paths from shareable evidence. Preserve required raw sensitive logs only in access-controlled storage.
- A scenario passes only when assertions and evidence are complete. `Skipped`, `Not run`, ambiguous, or missing evidence is not pass.
- Source-mode and synthetic-error tests do not substitute for packaged runtime behavior.
- Do not distribute before the final explicit decision.

---

## Task 1: Build the Evidence Harness Before Running Packages

**Files:**

- Create: `docs/release/sprint3-internal/acceptance-matrix.md`
- Create: `docs/release/sprint3-internal/known-issues.md`
- Create: `docs/release/sprint3-internal/installation.md`
- Create: `docs/release/sprint3-internal/go-no-go.md`
- Create: `docs/release/sprint3-internal/evidence-index.schema.json`
- Create: `scripts/release/create-evidence-index.js`
- Create: `scripts/release/validate-evidence-index.js`
- Create: `tests/unit/release/evidenceIndex.test.ts`

- [ ] Define IDs: `S01_INSTALL`, `S02_SPRINT2_MIGRATION`, `S03_LINEAGE_FAIL_CLOSED`, `S04_HTTP_WS_AUTH`, `S05_MCP_OAUTH_TOOL`, `S06_OAUTH_EXPIRY`, `S07_OFFICECLI`, `S08_PRESENTATION_TEMPLATES`, `S09_BUG017`, `S10_RESTART`, `S11_STUDIO_ABSENT`, `S12_UPDATE_ABSENT`.
- [ ] Define Windows gates: `W01_NATIVE_SOURCE`, `W02_BUG043_FILESYSTEM`, `W03_BUG043_PACKAGED_FAIL_CLOSED`, `W04_INSTALLED_BUNDLE`.
- [ ] Write failing validator tests requiring:

  - exact WePrompt/AionCore identities from artifact index;
  - exactly two platform records, Windows first;
  - every scenario once per platform;
  - status `pass`, `fail`, or `blocked` only;
  - UTC start/end, tester, machine/OS/filesystem, artifact hash, evidence hashes, and bounded notes;
  - failed/blocked reason, preserved-fixture hash/location, and owner;
  - no secret-like values;
  - all Windows gates pass before decision-ready status;
  - BUG-017 cannot be `pass` while runtime detection/recovery is unbuilt.

- [ ] Run the failing test, implement generator/validator, and rerun:

```bash
bunx vitest run tests/unit/release/evidenceIndex.test.ts
node scripts/release/validate-evidence-index.js tests/fixtures/release/evidence-index-valid.json
```

- [ ] Write `installation.md`: checksum verification, unsigned OS prompts, install/uninstall paths, data-preservation warning, no auto-update, support contact. Do not globally disable runtime auth, firewall, or endpoint protection.
- [ ] Seed `known-issues.md` with BUG-017 P1 and the approved preservation-first workaround. Seed `go-no-go.md` with rules but no preselected decision/signature.
- [ ] Commit the harness/docs before acceptance.

## Task 2: Acquire, Hash, and Hold Candidate Artifacts

- [ ] Download both workflow artifacts into a new evidence directory containing the exact RC SHA. Never overwrite a prior run.
- [ ] Compute SHA-256 and compare to `artifact-index.json`:

```bash
node scripts/release/verify-internal-package.js --artifact-index docs/release/sprint3-internal/artifact-index.json --platform macos-arm64 --artifact-dir artifacts/sprint3-internal
```

```powershell
node scripts/release/verify-internal-package.js --artifact-index docs/release/sprint3-internal/artifact-index.json --platform windows-x64 --artifact-dir artifacts/sprint3-internal
```

- [ ] Verify workflow run, source SHA, target, unsigned state, build timestamp, and embedded backend with the package verifier.
- [ ] Mark artifacts `held / not approved`; expose them only to assigned testers.
- [ ] If a hash differs, stop and preserve downloaded bytes/metadata. Do not redownload until the mismatch is explained.

## Task 3: Prepare Clean Machines and Data Fixtures

**Files:**

- Create: `scripts/release/record-acceptance-environment.js`
- Create: `scripts/release/hash-fixture.js`
- Create: `tests/e2e/fixtures/release/README.md`

- [ ] Prepare one Windows x64 machine/VM on the shipped NTFS runtime and one Apple Silicon Mac on a supported macOS version. Record OS build, filesystem, architecture, snapshot ID, locale/timezone, probe runtimes, and network-capture method.
- [ ] Hash a read-only source copy of the last accepted Sprint 2 database. Create a separate writable copy per scenario/platform; never point the app at the source.
- [ ] Prepare controlled fixtures for wrong/missing lineage, OAuth lifecycle, OfficeCLI preview, and presentation templates. Commit only sanitized metadata.
- [ ] Configure bounded observation for localhost, the test MCP endpoints, Studio provider endpoints, and update domains. Do not collect unrelated user traffic.
- [ ] Snapshot clean machines before installation so failure scenarios start from known state.

## Task 4: Run Windows Entry Gates First

### Task 4.1: Native Windows source evidence (`W01_NATIVE_SOURCE`)

- [ ] Confirm native Windows ran on exact RC with frozen install, deterministic gates, full-suite policy, focused BUG-043, and release build.
- [ ] Validate its full-suite ledger; later green cannot erase earlier red.
- [ ] Attach run ID/URL, log hashes, runner image, exact commit, total attempts, and dispositions.

### Task 4.2: BUG-043 on shipped filesystem/runtime (`W02_BUG043_FILESYSTEM`)

- [ ] Run the exact replacement/hardlink test and capture sanitized path-stat and open-handle-stat fields:

```powershell
bunx vitest run tests/unit/process/services/officeArtifact/readiness/PresentationReadinessService.test.ts -t "rejects same-byte replacement and hardlink drift of the inspection path" --reporter=verbose
```

- [ ] Prove the test created/replaced the file and exercised hardlink identity on the installed-app filesystem. Unsupported/skipped hardlink operation is `blocked`, not pass.
- [ ] Confirm same-byte replacement and hardlink drift both prevent approval.

### Task 4.3: Packaged readiness fail-closed probe (`W03_BUG043_PACKAGED_FAIL_CLOSED`)

- [ ] Launch the installed package with the acceptance fixture and exercise valid, changed, missing, unsupported, and ambiguous identity evidence.
- [ ] Valid evidence proceeds; every other state blocks. Capture UI/backend result plus bounded identity diagnostics.
- [ ] If missing/ambiguous evidence proceeds, stop the release.

### Task 4.4: Installed backend bytes (`W04_INSTALLED_BUNDLE`)

- [ ] Locate installed AionCore through the app's package layout, not an assumed build directory.
- [ ] Run the Windows support verifier and compare binary, manifest, lineage, and resource hashes to accepted indices.
- [ ] Confirm target `x86_64-pc-windows-msvc` and no out-of-scope backend is loadable.

All four gates must pass. If any fail/block, stop overall acceptance; macOS cannot waive Windows.

## Task 5: Run the Required Matrix on Windows, Then macOS

For each scenario, start from its snapshot/fixture, record UTC times, capture bounded logs/screenshots, hash evidence, and enter `pass`, `fail`, or `blocked`. Complete Windows first, then repeat on macOS ARM64 with fresh fixtures.

### S01_INSTALL: checksum, unsigned install, first launch

- [ ] Recompute artifact hash; follow only `installation.md`; record OS warnings/bypass steps.
- [ ] Confirm clean install/first launch, local backend startup, and installed package verification.

### S02_SPRINT2_MIGRATION: copied accepted database

- [ ] Record pre-launch SHA-256, size, schema/user-version, table counts, and sanitized invariant row counts.
- [ ] Launch once, wait for completion, then record post-launch hash/schema/counts and migration log.
- [ ] Verify required data remains and only expected schema changes occurred. Preserve the migrated copy; unexplained rebuild/count change fails.

### S03_LINEAGE_FAIL_CLOSED: real mismatch before mutation

- [ ] Start with fresh hashed DB copy and alter/remove installed lineage via the supported fixture mechanism without changing DB.
- [ ] Launch packaged app. Startup must stop with recoverable diagnostic before mutation.
- [ ] Recompute DB hash/structure; it must match pre-launch exactly.
- [ ] Restore lineage and confirm normal startup. Synthetic error injection is supplementary only.

### S04_HTTP_WS_AUTH: local HTTP and chat streaming

- [ ] Unauthenticated HTTP, headerless/sessionless request, and unauthenticated WebSocket are rejected.
- [ ] Authenticate in packaged UI; complete HTTP operation and authenticated chat plus presentation/speech WebSocket path.
- [ ] Inspect bounded logs/capture for credential leakage.

### S05_MCP_OAUTH_TOOL: login, connection, actual tool

- [ ] Use controlled MCP test service/account with the real authorization/DCR flow.
- [ ] Complete login, connection test, and one benign authenticated tool through actual agent path.
- [ ] Verify one stored identity supports connection and tool; no tokens enter evidence.

### S06_OAUTH_EXPIRY: refresh and reauthentication

- [ ] Exercise unexpired token, successful refresh using associated client identity, and post-refresh tool success.
- [ ] Force refresh failure. App requires reauthentication; server-side evidence proves expired token never reaches tool endpoint.
- [ ] Complete reauthentication and recover connection/tool call.
- [ ] Missing refresh token and legacy missing-client-ID states also fail closed.

### S07_OFFICECLI: packaged discovery and preview

- [ ] Ensure host `PATH` cannot mask packaged lookup.
- [ ] Open benign fixture and run packaged preview; record resolved executable/resource hash/path.
- [ ] Host-PATH fallback, missing resource, or preview failure fails.

### S08_PRESENTATION_TEMPLATES: inventory and access

- [ ] Compare installed template inventory to package manifest.
- [ ] Open one bundled template through packaged workflow.
- [ ] All runtime lookups stay inside installed resources, never a development checkout.

### S09_BUG017: known-issue disposition, not false pass

- [ ] Confirm baseline unit evidence that access loss/`SQLITE_CANTOPEN` cannot enter corruption backup-and-rebuild.
- [ ] Do not inject invented AionCore payload and call it packaged recovery acceptance.
- [ ] If exact runtime wire shape remains unobserved/unbuilt, mark `blocked` with `runtime classification and recovery UX unbuilt`; separately link proven safeguard.
- [ ] Workaround: stop activity, preserve/hash DB copy, collect bounded logs, restart/retry; never delete/rebuild without confirmed corruption and explicit consent.
- [ ] Name WePrompt and AionCore owners and record release owner's risk acceptance/rejection.

### S10_RESTART: quit and persisted state

- [ ] Quit normally; confirm processes exit.
- [ ] Relaunch with migrated data; verify sessions/config and representative data.
- [ ] Reverify backend identity; no unexpected recovery/reinstall path.

### S11_STUDIO_ABSENT: navigation, route, traffic, storage

- [ ] Studio absent from navigation/commands; known direct route/deep link inaccessible.
- [ ] No Studio runtime/job/provider traffic during acceptance.
- [ ] Storage before/after shows no Studio-specific DB/directory/key initialization.
- [ ] Compiled policy/inventory proves flag false; default value alone is insufficient.

### S12_UPDATE_ABSENT: no feed, prompt, or contact

- [ ] Run across normal update-check window and exercise About/settings trigger surfaces.
- [ ] No update prompt/UI and no upstream update-feed request.
- [ ] Compiled/runtime config contains no feed; notes state manual replacement only.

## Task 6: Triage Failures Without Destroying Evidence

- [ ] On failure stop the scenario and preserve DB copy, installed state, logs, capture, screenshots, and environment.
- [ ] Hash evidence before diagnosis. Keep raw sensitive material controlled; packet contains sanitized hashes/status/counts.
- [ ] Classify product defect, artifact mismatch, environment/infrastructure, or unknown. Unknown blocks.
- [ ] Do not rerun seeking green. State a diagnostic question and link new attempt to original failure.
- [ ] Any source/packaging fix creates new RC/artifact and restarts affected gates. Never overwrite old evidence.

## Task 7: Assemble and Validate the Decision Packet

- [ ] Generate `evidence-index.json` from artifact/environment/matrix/evidence hashes, suite ledger, known issues, and source/build runs.
- [ ] Validate:

```bash
node scripts/release/validate-evidence-index.js docs/release/sprint3-internal/evidence-index.json
node scripts/release/validate-full-suite-ledger.js docs/release/sprint3-internal/full-suite-ledger.json
node scripts/release/verify-internal-package.js --artifact-index docs/release/sprint3-internal/artifact-index.json
```

- [ ] Confirm packet contains scope/exclusions, exact SHAs, port audit, both native CI results, every suite attempt, backend/desktop manifests/hashes, toolchains, per-platform results, known issues, recovery, and install instructions.
- [ ] Secret-scan the shareable packet and manually review flagged field names/values.
- [ ] Independent reviewer traces one artifact, one embedded backend file, one scenario, and one suite failure from hash to source/evidence.

## Task 8: Obtain Explicit Decision

- [ ] Recompute both desktop hashes immediately before review and put them in `go-no-go.md`.
- [ ] Apply rules:

  - `Go` only if every required issue is closed and BUG-017 exact runtime detection/recovery is built and accepted;
  - `Conditional go` only if BUG-017 non-destructive invariant is proven, residual risk is availability/recovery UX only, owners/workaround are named, and owner explicitly accepts;
  - `No-go` for data-integrity uncertainty, auth bypass, stale token, Studio/update exposure, mismatch, unknown suite failure, missing Windows evidence, failed scenario, or incomplete packet.

- [ ] Require owner name, UTC time, decision, exact two hashes, and explicit BUG-017 acceptance/rejection. Silence/blanks are not approval.
- [ ] On `No-go`, hold artifacts and publish only blocker list internally.
- [ ] On authorized `Conditional go`/`Go`, distribute exactly approved hashes with checksum/install/known-issue docs. Record audience/time. Do not create update feed.

## Packaged Acceptance Completion Criteria

- [ ] Both artifacts match recorded hashes and exact RC/backend identities.
- [ ] All four Windows entry gates pass before macOS counts.
- [ ] Every scenario has non-ambiguous per-target result and hashed evidence.
- [ ] Lineage mismatch fails before DB mutation; failed fixtures remain recoverable.
- [ ] HTTP/WebSocket auth and MCP expiry/refresh fail closed.
- [ ] OfficeCLI/templates resolve only from installed resources.
- [ ] Studio/update absent in UI, routes/config, traffic, and storage behavior.
- [ ] BUG-017 remains explicit unless observed-wire-shape recovery was built and accepted.
- [ ] Evidence index validates and reviewer traces artifacts to sources.
- [ ] Owner explicitly approves/rejects exact hashes; no distribution on silence.
