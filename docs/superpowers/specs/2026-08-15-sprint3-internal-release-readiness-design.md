# Sprint 3 Internal Release Readiness Design

**Date:** 2026-08-15

**Status:** Approved design; awaiting written-spec review

**Release type:** Internal, unsigned, manually distributed

## 1. Decision Summary

Prepare Sprint 3 as a narrowly hardened internal release. Do not merge WePrompt `main` wholesale and do not remove Creative Studio code. Build from immutable reviewed baselines, repair and publish the AionCore backend contract first, then pin WePrompt to that exact backend release and produce three unsigned desktop artifacts.

The release is held until the release owner explicitly signs off after reviewing packaged-runtime evidence.

## 2. Scope

### In scope

- WePrompt Sprint 3 stabilization from `khoapnt-vng/WePrompt` commit `634f49c21567d9bd987b04887eaa0c6126b86353`.
- AionCore `v0.1.55` preparation from `khoapnt-vng/aioncore` commit `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`.
- Selected release-critical fixes from later WePrompt work, ported only after source and behavior review.
- Unsigned internal packages for:
  - macOS ARM64
  - macOS x64
  - Windows x64
- Manual distribution with artifact hashes and installation instructions.
- Packaged acceptance covering migration safety, local authentication, chat streaming, MCP OAuth, OfficeCLI, presentation templates, restart behavior, Creative Studio exclusion, and disabled auto-update.

### Out of scope

- Public release, store submission, signing, notarization, or trusted-publisher setup.
- Auto-update feeds or automatic rollout.
- Creative Studio exposure, Studio provider calls, or integration of newer Studio branches.
- Linux and Windows ARM64 packages.
- Wholesale integration of WePrompt `main`.
- Feature expansion unrelated to release blockers.
- Use of upstream `iOfficeAI/AionCore`; the backend must come from `khoapnt-vng/aioncore`.

## 3. Immutable Baselines and Branch Model

| Component | Repository | Starting ref | Immutable commit | RC branch |
|---|---|---|---|---|
| WePrompt | `khoapnt-vng/WePrompt` | `ghk/sprint3` | `634f49c21567d9bd987b04887eaa0c6126b86353` | `release/internal-sprint3` |
| AionCore | `khoapnt-vng/aioncore` | current `v0.1.54` line | `9bd693b3b43cdb1003061de0e4f62259ab6f42ae` | `release/internal-v0.1.55` |

Before work begins, refresh remote refs and record the exact branch heads, ancestry, tags, and working-tree state. Create isolated worktrees from the immutable commits. RC branches must reject force pushes and direct release changes; bounded task branches merge through reviewed pull requests with required checks.

No branch name is sufficient evidence. Every review, dependency pin, artifact manifest, and acceptance record must identify exact commits.

## 4. Release Architecture

```mermaid
flowchart LR
    A["AionCore RC\nexact source commit"] --> B["Complete v0.1.55 backend bundle\n3 targets + manifest + hashes"]
    B --> C["WePrompt RC\nexact backend pin"]
    C --> D["Unsigned desktop packages\nmacOS ARM64, macOS x64, Windows x64"]
    D --> E["Packaged acceptance evidence"]
    E --> F{"Release owner sign-off"}
    F -->|Go| G["Manual internal distribution"]
    F -->|No-go| H["Hold artifacts and preserve evidence"]
```

The backend is independently releasable before WePrompt consumes it. WePrompt packaging must not download a mutable branch or infer backend contents. It consumes a versioned backend release unit whose source commit, checksums, and migration fingerprint are known in advance.

## 5. AionCore v0.1.55 Workstream

### 5.1 OAuth safety

The current backend can return and inject an expired access token when refresh is impossible or fails. The release must change this contract so that:

- Dynamically registered OAuth client identity is persisted with the token state or otherwise reliably recovered for refresh.
- Refresh uses the client identity associated with the issued token.
- An expired token without a valid refresh path produces an explicit reauthentication-required result.
- Refresh failure never falls back to injecting the expired token.
- Connection tests and actual agent tool calls use the same safe token contract.
- Automated tests cover valid token, successful refresh, missing refresh token, failed refresh, dynamic client identity, and reauthentication recovery.

### 5.2 Complete backend release unit

Each target bundle must contain:

```text
aioncore[.exe]
migration-lineage.json
managed-resources/
bundle-manifest.json
SHA256SUMS
```

`bundle-manifest.json` must include the repository, AionCore version, exact source commit, build target, build timestamp, migration-lineage fingerprint, and the path/hash of every bundled item. Migration lineage must be generated deterministically from the exact migration inputs used by the binary. Missing or mismatched members fail assembly.

### 5.3 Backend gates

The exact release candidate must pass:

- `cargo fmt --all -- --check`
- Clippy with warnings treated as failures for the release workspace
- Backend test suite, including new OAuth cases
- Migration immutability and deterministic-lineage validation
- Release build for all three targets
- Bundle content and checksum validation after extraction
- Tag-to-commit and manifest-to-commit verification

The `v0.1.55` tag is created only from the accepted RC commit. Retagging or replacing release assets is prohibited; any correction produces a new version.

## 6. WePrompt Sprint 3 Workstream

### 6.1 Exact backend integration

Update the packaged AionCore contract to `khoapnt-vng/aioncore` `v0.1.55`, recording:

- Peeled tag commit
- Expected archive checksum per target
- Expected bundle manifest schema
- Expected migration-lineage fingerprint

Packaging must fail closed if any expected member, checksum, source commit, target, or lineage fingerprint differs.

### 6.2 Selected release-fix audit

Do not merge `main`. Review the following later fixes against Sprint 3 and port the smallest behaviorally complete change only when the issue is reproducible or the packaged acceptance contract requires it:

- Live WebSocket authentication
- Backend session cookie and headerless request handling
- OfficeCLI packaged-resource resolution
- Presentation-template packaging paths
- Windows source-build and packaging support

For each candidate, record its source commit, dependency assumptions, Sprint 3 applicability, tests, and the final decision: ported, already present, replaced, or excluded. macOS signing/notarization changes are excluded from this unsigned release unless a non-signing portion is independently necessary.

### 6.3 Creative Studio exclusion

Creative Studio remains in the source tree but is unavailable in this release:

- The production build must not set `AIONUI_ENABLE_CREATIVE_STUDIO=1`.
- A release-configuration assertion must fail if the Studio flag is enabled.
- Navigation, direct routes, runtime startup, provider/job calls, and Studio-specific storage creation must remain inaccessible in packaged builds.
- No newer Creative Studio branch is merged into the RC.
- Packaged smoke evidence must verify absence, not merely rely on the default flag value.

### 6.4 Auto-update exclusion

Auto-update must be disabled in the internal release configuration. Packaged acceptance must verify that the application does not contact or offer an upstream update feed. Manual replacement is the only supported update path for this release.

### 6.5 WePrompt source gates

The exact WePrompt RC must pass:

- Frozen dependency installation
- Type checking
- Linting
- Formatting checks
- i18n validation
- Full Vitest suite
- Release-configuration assertions for Studio and auto-update
- Exact backend-pin and backend-bundle contract tests
- Package-content verification for each target

A green Sprint 3 source workflow is useful baseline evidence but does not replace these RC and packaged-runtime gates.

## 7. Build and Artifact Matrix

| Platform | Architecture | Backend member | Desktop artifact | Signing state |
|---|---|---|---|---|
| macOS | ARM64 | `aioncore` | Internal installer/archive | Unsigned |
| macOS | x64 | `aioncore` | Internal installer/archive | Unsigned |
| Windows | x64 | `aioncore.exe` | Internal installer/archive | Unsigned |

Each desktop artifact must be traceable to the exact WePrompt RC commit and the exact AionCore bundle. Store the desktop artifact hash, embedded backend hash, build log, toolchain versions, and package inventory together. Unsigned-install bypass instructions must be explicit and must not weaken runtime security controls.

## 8. Packaged Acceptance

Run acceptance on clean, representative machines or VMs for every target. Source-mode results do not substitute for packaged execution.

### Required scenarios

1. Verify artifact checksum, documented unsigned-install flow, clean installation, and first launch.
2. Launch with a copy of the last accepted Sprint 2 database and verify successful migration without data loss.
3. Inject missing or mismatched migration lineage and verify startup fails before database mutation, with a recoverable diagnostic.
4. Verify local HTTP authentication and authenticated WebSocket/chat streaming.
5. Complete MCP OAuth login, connection test, and an actual authenticated tool call.
6. Exercise token expiry, successful refresh, failed refresh, and reauthentication recovery; confirm no expired token is sent.
7. Exercise packaged OfficeCLI discovery and preview.
8. Verify packaged presentation-template inventory and access paths.
9. Quit cleanly, relaunch, and verify persisted sessions and data remain valid.
10. Verify Creative Studio is absent from navigation, inaccessible by direct route, and causes no Studio provider traffic or storage initialization.
11. Verify auto-update is disabled and no upstream update prompt or feed access occurs.
12. Collect application/backend logs, screenshots where useful, timestamps, artifact hashes, and tester result for every scenario.

Acceptance failures must preserve the affected database and logs for diagnosis. Test fixtures must use copies; never use the only copy of user data.

## 9. Evidence and Decision Gate

The release evidence packet must contain:

- Scope statement and explicit exclusions
- Exact WePrompt and AionCore base/head commits
- Pull request list and selected-fix audit
- CI results for both exact RC heads
- Backend and desktop bundle manifests and SHA-256 hashes
- Toolchain and build-environment record
- Per-platform packaged acceptance matrix
- Known issues with severity, workaround, owner, and disposition
- Rollback/recovery instructions and preserved-data locations
- Draft internal installation instructions

The final decision record has three possible outcomes:

- **Go:** release owner explicitly approves the exact artifact hashes.
- **Conditional go:** permitted only for a documented non-security, non-data-integrity limitation with owner, workaround, and accepted risk.
- **No-go:** artifacts remain held; no distribution occurs.

Silence, elapsed time, partial platform success, or CI reruns do not constitute approval.

## 10. Stop Conditions and Invalidation Rules

Stop the release and return to the relevant gate if any of the following occurs:

- A migration-lineage failure mutates the database or cannot recover safely.
- An expired OAuth token is injected after refresh failure.
- Artifact content cannot be traced to the recorded source commits.
- Required bundle members or checksums are missing or inconsistent.
- Creative Studio or auto-update is enabled in a production package.
- Local authentication can be bypassed for HTTP or WebSocket traffic.
- Any target fails a required package or acceptance scenario.
- A release artifact is replaced without a new version and evidence cycle.

Any source change invalidates artifacts built from the prior commit. A backend pin, migration input, release configuration, packaging script, or build-toolchain change invalidates all affected package evidence. A platform-specific change invalidates at least that platform and any shared-gate evidence it touches.

## 11. Principal Risks and Controls

| Risk | Control |
|---|---|
| Sprint 3 and `main` have diverged | Narrow RC from immutable Sprint 3 commit; audited ports only |
| Backend release branch or assets drift | Exact commits, immutable tag, manifests, checksums, no asset replacement |
| Backend archive omits runtime contract files | Complete release unit plus extracted-content validation |
| OAuth refresh sends stale credentials | Correct client persistence, fail-closed token contract, end-to-end expiry tests |
| Unsigned packages confuse testers or trigger OS warnings | Internal-only scope, checksum verification, explicit per-OS install instructions |
| Hidden flag exposes Creative Studio | Build assertion plus packaged absence and traffic checks |
| Source tests create false confidence | Three-target packaged acceptance is mandatory |
| Dirty local checkout contaminates release work | Isolated worktrees, narrow staging, recorded commits, reproducible inventories |

## 12. Execution Order

1. Freeze and record exact repository baselines and create protected RC branches/worktrees.
2. Make AionCore `v0.1.55` independently releasable: OAuth safety, lineage generation, complete bundles, and green gates.
3. Publish immutable backend RC artifacts and verify them after extraction.
4. Pin WePrompt to the exact backend release and audit/port only approved release fixes.
5. Pass WePrompt source and packaging gates with Studio and auto-update assertions.
6. Build all three unsigned desktop artifacts from one accepted WePrompt RC commit.
7. Run the full packaged acceptance matrix and assemble the evidence packet.
8. Present exact artifact hashes and evidence to the release owner for explicit go/no-go sign-off.
9. On approval, distribute manually to the internal audience; otherwise hold all artifacts.

This sequence is intentionally fail-closed: incomplete evidence delays distribution, and no technical gate can substitute for the final human decision.
