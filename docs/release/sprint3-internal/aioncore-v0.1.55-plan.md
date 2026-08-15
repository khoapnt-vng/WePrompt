# AionCore v0.1.55 Internal Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task by task. For each behavior change, use `superpowers:test-driven-development`; for any unexpected failure, use `superpowers:systematic-debugging`; before claiming a gate or release output, use `superpowers:verification-before-completion`.

**Goal:** Release `khoapnt-vng/aioncore` `v0.1.55` as two complete, immutable, independently verifiable backend bundles with fail-closed OAuth refresh behavior and deterministic migration lineage.

**Architecture:** Persist the OAuth client identity alongside token state, make expired-token resolution return reauthentication rather than stale credentials, and exercise the same contract from connection tests and agent calls. Generate migration lineage from raw migrations, assemble target-native binaries and managed resources into a deterministic payload manifest, and publish only macOS ARM64 and Windows x64 assets whose source and extracted contents verify.

**Tech Stack:** Rust 2024, Rust 1.95.0, Cargo, cargo-nextest, SQLx/SQLite, oauth2, wiremock, Python 3 `unittest`, GitHub Actions, SHA-384 migration checksums, SHA-256 manifests.

**Spec:** `docs/release/sprint3-internal/readiness-design.md`

## Global Constraints

- Repository: `/Users/lap16603/Projects/.worktrees/aioncore-internal-v0.1.55` from exact base `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`.
- Do not edit a released migration. Add `028_oauth_token_client_id.sql`.
- Do not log access tokens, refresh tokens, authorization codes, client secrets, response payloads, or user data. Structured warning fields may include server URL and a bounded reason code.
- This plan's logging decision is: add structured warnings for expiry/refresh disposition and bundle validation failure, using identifiers/reason codes only; retain existing logging elsewhere.
- Do not publish, tag, push, or change branch protection until separately authorized.
- Do not replace a published asset or move an existing tag. A correction gets a new version and evidence cycle.
- Release targets are exactly `aarch64-apple-darwin` and `x86_64-pc-windows-msvc`.

---

## Task 1: Establish the v0.1.55 RC and Baseline Gates

**Files:**

- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `.release-please-manifest.json`
- Modify: `CHANGELOG.md`
- Test: existing workspace gates

- [ ] Verify the isolated worktree starts clean and exact:

```bash
cd /Users/lap16603/Projects/.worktrees/aioncore-internal-v0.1.55
test "$(git rev-parse HEAD)" = "9bd693b3b43cdb1003061de0e4f62259ab6f42ae"
test -z "$(git status --porcelain)"
rustc --version
cargo --version
python3 --version
```

- [ ] Run and save baseline results before modifying behavior:

```bash
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo nextest run --workspace
bash scripts/migration/check-immutability.test.sh
bash scripts/migration/check-immutability.sh
```

**Expected:** source gates pass or every pre-existing failure is recorded with command, environment, and exit code before work continues. A pre-existing failure is not treated as passing.

- [ ] Update the workspace version from `0.1.54` to `0.1.55` and reconcile the currently stale `.release-please-manifest.json` value from `0.1.50` to `0.1.55`. Regenerate `Cargo.lock` through Cargo, not manual checksum edits.
- [ ] Add the release note categories for OAuth safety and complete bundles. Do not claim acceptance before it is run.
- [ ] Verify every workspace crate resolves to `0.1.55`:

```bash
cargo metadata --no-deps --format-version 1 | python3 -c 'import json,sys; d=json.load(sys.stdin); bad=[(p["name"],p["version"]) for p in d["packages"] if p["source"] is None and p["version"]!="0.1.55"]; print(bad); raise SystemExit(bool(bad))'
```

- [ ] Commit the version-only change:

```bash
git add Cargo.toml Cargo.lock .release-please-manifest.json CHANGELOG.md
git diff --cached --check
git commit -m "chore(release): prepare AionCore v0.1.55"
```

## Task 2: Persist OAuth Client Identity

**Files:**

- Create: `crates/aionui-db/migrations/028_oauth_token_client_id.sql`
- Modify: `crates/aionui-db/src/models/oauth_token.rs`
- Modify: `crates/aionui-db/src/repository/oauth_token.rs`
- Modify: `crates/aionui-db/src/repository/sqlite_oauth_token.rs`
- Modify: `crates/aionui-db/tests/oauth_token_repository.rs`
- Modify: `crates/aionui-mcp/src/oauth_service.rs`
- Test: `crates/aionui-db/tests/oauth_token_repository.rs`

- [ ] Write failing DB repository tests for all of these contracts:
  - a token upsert/read round trip preserves `client_id=Some("dynamic-client")`;
  - legacy rows created without the new column value read as `client_id=None`;
  - updating token material does not silently replace the associated client identity with the global default;
  - migration 028 upgrades a database at migration 027 without changing existing token bytes.

- [ ] Run the focused test and confirm the new assertions fail for the missing field/schema:

```bash
cargo nextest run -p aionui-db --test oauth_token_repository
```

- [ ] Add nullable `client_id TEXT` in migration 028. Extend `OAuthTokenRow` with `client_id: Option<String>` and `UpsertOAuthTokenParams` with `client_id: Option<&str>`. Bind/select it explicitly in SQLite repository queries.
- [ ] Pass the client ID actually used by login/exchange into token persistence. This includes persisting the default client ID when it was the actual issuer identity; do not infer it later for a legacy row.
- [ ] Rerun focused DB tests and migration immutability checks:

```bash
cargo nextest run -p aionui-db --test oauth_token_repository
bash scripts/migration/check-immutability.test.sh
bash scripts/migration/check-immutability.sh
```

**Expected:** all focused tests pass; migrations 001-027 remain byte-identical; migration 028 is accepted as new.

- [ ] Commit:

```bash
git add crates/aionui-db/migrations/028_oauth_token_client_id.sql crates/aionui-db/src/models/oauth_token.rs crates/aionui-db/src/repository/oauth_token.rs crates/aionui-db/src/repository/sqlite_oauth_token.rs crates/aionui-db/tests/oauth_token_repository.rs crates/aionui-mcp/src/oauth_service.rs
git diff --cached --check
git commit -m "fix(oauth): persist issued client identity"
```

## Task 3: Make Expired Token Resolution Fail Closed

**Files:**

- Modify: `crates/aionui-mcp/Cargo.toml`
- Modify: `crates/aionui-mcp/src/oauth_service.rs`
- Modify: `crates/aionui-mcp/tests/oauth_integration.rs`
- Verify: `crates/aionui-ai-agent/src/factory/acp.rs`
- Verify: `crates/aionui-ai-agent/src/factory/aionrs.rs`

- [ ] Add `wiremock.workspace = true` under `aionui-mcp` dev-dependencies.
- [ ] Replace the existing test that expects an expired token to be returned. Write failing tests for:
  1. unexpired token returns the current access token;
  2. expired token plus matching persisted client ID and refresh token uses the refresh endpoint and returns/persists the new token;
  3. dynamic client ID, not `DEFAULT_CLIENT_ID`, is sent during refresh;
  4. expired token with no refresh token returns `Ok(None)`/reauthentication-required and never returns stale bytes;
  5. expired legacy token with `client_id=None` returns reauthentication-required without sending a refresh request;
  6. refresh HTTP/protocol failure returns reauthentication-required and never returns stale bytes;
  7. successful reauthentication persists the new client identity and restores connection/tool-call success.

- [ ] Confirm the focused tests fail against current behavior:

```bash
cargo nextest run -p aionui-mcp
```

- [ ] Change `refresh_token` to accept the persisted client identity explicitly. Change `get_token` so every unusable expired state returns the documented reauthentication result and cannot fall through to the old access token.
- [ ] Keep `bearer_for()` as the single bearer-construction boundary. Verify both ACP and AionRS factories call it rather than reading token storage directly.
- [ ] Add structured warnings with `server_url` and one of the bounded reason codes `missing_refresh_token`, `missing_client_id`, or `refresh_failed`. Do not include credential material or remote payloads.
- [ ] Run focused MCP and agent tests:

```bash
cargo nextest run -p aionui-mcp
cargo nextest run -p aionui-ai-agent
```

- [ ] Search for bypasses and leaked sensitive fields:

```bash
rg -n 'access_token|refresh_token|bearer_for|get_token\(' crates/aionui-mcp crates/aionui-ai-agent
rg -n 'tracing::(debug|info|warn|error)!.*(access_token|refresh_token|authorization|client_secret)' crates
```

**Expected:** the first search confirms agent bearer use through the safe boundary; the second returns no sensitive logging statements.

- [ ] Commit:

```bash
git add crates/aionui-mcp/Cargo.toml crates/aionui-mcp/src/oauth_service.rs crates/aionui-mcp/tests/oauth_integration.rs Cargo.lock
git diff --cached --check
git commit -m "fix(oauth): require reauthentication after unsafe refresh"
```

## Task 4: Generate Deterministic Migration Lineage

**Files:**

- Create: `scripts/migration/generate-lineage.py`
- Create: `scripts/migration/test_generate_lineage.py`
- Create: `migration-lineage.json`
- Modify: `.github/workflows/ci.yml`

The generator contract is fixed:

- sort migrations by numeric filename prefix;
- `version` is the numeric prefix;
- `description` is the filename stem after the prefix with underscores converted to spaces;
- each entry checksum is lowercase SHA-384 of the raw SQL bytes;
- `fingerprint` is lowercase SHA-256 of the compact UTF-8 JSON serialization of the ordered `entries` array;
- the top-level document contains `schemaVersion: 1`, `minimumSupportedVersion: 19`, `latestVersion`, `entryCount`, `fingerprint`, and `entries`.

- [ ] Write failing Python unit tests for ordering, raw-byte checksum sensitivity, compact-JSON fingerprint, duplicate version rejection, malformed filename rejection, a missing version in the 001-latest sequence, and deterministic repeated output.
- [ ] Run and observe failure because the generator does not exist:

```bash
python3 -m unittest scripts.migration.test_generate_lineage -v
```

- [ ] Implement the generator using only the Python standard library. It must write atomically when an output path is supplied and support `--check migration-lineage.json` without modifying files.
- [ ] Generate and verify the repository lineage:

```bash
python3 -m unittest scripts.migration.test_generate_lineage -v
python3 scripts/migration/generate-lineage.py --migrations crates/aionui-db/migrations --output migration-lineage.json
python3 scripts/migration/generate-lineage.py --migrations crates/aionui-db/migrations --check migration-lineage.json
```

- [ ] Independently verify shape and migration 028 inclusion:

```bash
python3 -c 'import json; d=json.load(open("migration-lineage.json")); assert d["schemaVersion"]==1; assert d["minimumSupportedVersion"]==19; assert d["latestVersion"]==28; assert d["entryCount"]==28; assert len(d["fingerprint"])==64; assert all(len(e["checksum"])==96 for e in d["entries"])'
```

- [ ] Add the unit test and `--check` command to CI after migration immutability. A changed migration or stale lineage must fail CI.
- [ ] Commit:

```bash
git add scripts/migration/generate-lineage.py scripts/migration/test_generate_lineage.py migration-lineage.json .github/workflows/ci.yml
git diff --cached --check
git commit -m "build(migrations): generate deterministic lineage"
```

## Task 5: Assemble and Verify Complete Backend Bundles

**Files:**

- Create: `scripts/release/assemble_bundle.py`
- Create: `scripts/release/verify_bundle.py`
- Create: `scripts/release/test_assemble_bundle.py`
- Verify: `crates/aionui-app/src/commands/cmd_prepare_managed_resources.rs`
- Verify: `crates/aionui-app/src/cli.rs`

Bundle layout is exactly:

```text
aioncore[.exe]
migration-lineage.json
managed-resources/
bundle-manifest.json
SHA256SUMS
```

To avoid self-referential hashes, `bundle-manifest.json` enumerates and hashes every payload file (binary, lineage, and every regular managed-resource file) but excludes itself and `SHA256SUMS`. `SHA256SUMS` hashes all payload files plus `bundle-manifest.json` and excludes itself.

- [ ] Write failing tests for the bundle assembler/verifier:
  - accepted Unix and Windows binary names;
  - exact top-level member set;
  - manifest fields `schemaVersion`, `repository`, `version`, `sourceCommit`, `target`, `builtAt`, `migrationLineage`, and sorted `files`;
  - missing or extra payload file rejection;
  - wrong file hash, lineage fingerprint, source commit, version, or target rejection;
  - symlink, absolute path, `..` path escape, duplicate normalized path, and unsorted manifest rejection;
  - checksum-file coverage exactly equals payload plus manifest;
  - deterministic manifest bytes when the supplied build timestamp and input bytes are identical.

- [ ] Confirm the tests fail before implementation:

```bash
python3 -m unittest scripts.release.test_assemble_bundle -v
```

- [ ] Implement assembler and independent verifier using the standard library. Require `builtAt` as an explicit UTC RFC3339 input captured by CI; do not read local wall time inside deterministic serialization.
- [ ] Build a local macOS ARM64 release candidate on an ARM64 Mac and exercise the existing managed-resource command:

```bash
cargo build --release --target aarch64-apple-darwin -p aionui-app
rm -rf target/release-bundle-aarch64-apple-darwin
target/aarch64-apple-darwin/release/aioncore --data-dir target/release-data-aarch64-apple-darwin prepare-managed-resources --bundle-out target/release-managed-aarch64-apple-darwin
python3 scripts/release/assemble_bundle.py --binary target/aarch64-apple-darwin/release/aioncore --lineage migration-lineage.json --managed-resources target/release-managed-aarch64-apple-darwin --output target/release-bundle-aarch64-apple-darwin --repository khoapnt-vng/aioncore --version 0.1.55 --source-commit "$(git rev-parse HEAD)" --target aarch64-apple-darwin --built-at 2026-08-15T00:00:00Z
python3 scripts/release/verify_bundle.py --bundle target/release-bundle-aarch64-apple-darwin --repository khoapnt-vng/aioncore --version 0.1.55 --source-commit "$(git rev-parse HEAD)" --target aarch64-apple-darwin
```

Do not use the fixed example timestamp for released artifacts; CI supplies the actual UTC job timestamp and records it.

- [ ] Run unit tests and reject extra files deliberately in a copied fixture to prove fail-closed behavior.
- [ ] Commit:

```bash
git add scripts/release/assemble_bundle.py scripts/release/verify_bundle.py scripts/release/test_assemble_bundle.py
git diff --cached --check
git commit -m "build(release): assemble complete backend bundles"
```

## Task 6: Narrow and Harden the Release Workflow

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/release/test_release_workflow.py`

- [ ] Write `scripts/release/test_release_workflow.py` first. It must prove the release matrix contains exactly `aarch64-apple-darwin` and `x86_64-pc-windows-msvc`, calls both lineage and bundle verifiers, and contains neither `--clobber` nor any asset-overwrite path. Run it against the baseline and confirm it fails on the six-target matrix and `--clobber`.
- [ ] Update the build matrix to the two approved targets only for `v0.1.55` internal release execution.
- [ ] After each native binary build, execute that binary's `prepare-managed-resources` command on the same runner, assemble the complete bundle, verify it, archive it, extract the archive into a fresh directory, and verify again.
- [ ] Use archive names:

```text
aioncore-v0.1.55-aarch64-apple-darwin.tar.gz
aioncore-v0.1.55-x86_64-pc-windows-msvc.zip
```

- [ ] Generate `aioncore-checksums.txt` from the two final archives. Upload without `--clobber`. If the release or any named asset already exists, stop with an error.
- [ ] Add a prepare-release assertion that the tag is exactly `v0.1.55`, the workspace version is `0.1.55`, and `git rev-parse HEAD` equals the peeled tag commit recorded in metadata.
- [ ] Upload each extracted `bundle-manifest.json` and workflow logs as evidence artifacts in addition to the GitHub release assets.
- [ ] Keep signing/cosign absent. Record unsigned state in release notes.
- [ ] Run local workflow-contract tests and YAML parsing, then commit:

```bash
python3 -m unittest discover -s scripts/release -p 'test_*.py' -v
git diff --check
git add .github/workflows/release.yml .github/workflows/ci.yml scripts/release
git diff --cached --check
git commit -m "ci(release): publish immutable two-target bundles"
```

## Task 7: Run Exact-Head Source Gates and Review

- [ ] Freeze the candidate commit and record it:

```bash
git rev-parse HEAD
git status --short
```

- [ ] Run fresh gates on that exact commit:

```bash
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo nextest run --workspace
bash scripts/migration/check-immutability.test.sh
bash scripts/migration/check-immutability.sh
python3 -m unittest scripts.migration.test_generate_lineage -v
python3 scripts/migration/generate-lineage.py --migrations crates/aionui-db/migrations --check migration-lineage.json
python3 -m unittest discover -s scripts/release -p 'test_*.py' -v
cargo build --release --target aarch64-apple-darwin -p aionui-app
```

- [ ] Require independent review of OAuth state transitions, migration 028, no-sensitive-logging decision, manifest/checksum semantics, path safety, and workflow immutability.
- [ ] Apply review fixes on new commits and rerun all affected gates. Any source change changes the candidate SHA.
- [ ] Record exact command, start/end UTC time, runner/toolchain, exit code, and log artifact for every gate.

## Task 8: Tag, Publish, and Produce the WePrompt Handoff

This task requires explicit authorization after Task 7. Without it, stop with a reviewed RC commit and do not tag/push/publish.

- [ ] Confirm `v0.1.55` does not exist locally or remotely and the target release has no assets:

```bash
git tag --list v0.1.55
git ls-remote --tags https://github.com/khoapnt-vng/aioncore.git refs/tags/v0.1.55 refs/tags/v0.1.55^{}
gh release view v0.1.55 --repo khoapnt-vng/aioncore
```

**Expected:** tag queries are empty and `gh release view` reports no release. Any existing object is a stop condition, not permission to overwrite.

- [ ] After explicit authorization, create an annotated tag on the reviewed commit, push it once, and monitor the release workflow. Do not invoke a second publishing path concurrently.
- [ ] Download the two assets plus `aioncore-checksums.txt` to a fresh temporary directory, verify archive checksums, extract, and run `verify_bundle.py` with the peeled tag commit and target.
- [ ] Create the WePrompt handoff record `docs/release/sprint3-internal/aioncore-v0.1.55.json` on the WePrompt RC. Its schema is:

```json
{
  "schemaVersion": 1,
  "repository": "khoapnt-vng/aioncore",
  "version": "v0.1.55",
  "tagCommit": "40 lowercase hex characters",
  "migrationLineageFingerprint": "64 lowercase hex characters",
  "assets": [
    {
      "target": "aarch64-apple-darwin or x86_64-pc-windows-msvc",
      "name": "published archive name",
      "sha256": "64 lowercase hex characters",
      "binarySha256": "64 lowercase hex characters",
      "bundleManifestSha256": "64 lowercase hex characters"
    }
  ]
}
```

- [ ] Generate these values from downloaded bytes and manifests with a script or exact shell tools. Never type hash values from a browser or copy them from an unverified run.
- [ ] Validate: exactly two unique targets; tag commit equals both manifests' `sourceCommit`; version and fingerprint agree; archive hashes equal `aioncore-checksums.txt`; extracted verification passes.

## AionCore Completion Criteria

- [ ] The release commit descends from the approved base and is independently reviewed.
- [ ] OAuth never returns or injects an expired token after missing/failed refresh.
- [ ] Dynamic client identity round-trips through migration 028 and refresh.
- [ ] Both agent factories use the safe bearer contract.
- [ ] Migration lineage is deterministic, current through 028, and CI-enforced.
- [ ] Both target bundles contain only the required top-level members and verify after extraction.
- [ ] Manifests and checksums have non-circular, tested coverage semantics.
- [ ] The workflow cannot overwrite an existing tag/release asset.
- [ ] If authorized, `v0.1.55`, both archive hashes, and both extracted manifests all resolve to the same accepted source commit.
