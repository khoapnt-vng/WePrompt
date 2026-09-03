# BUG-013 AionCore Schema Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that the AionCore bundled with the next WePrompt release opens every explicitly supported predecessor database on first startup without deleting, downgrading, or rewriting user data speculatively.

**Architecture:** Maintain a machine-readable manifest of released predecessor migration lineages and validate a candidate AionCore migration set as a checksum-identical extension of each supported lineage. Select and pin a backend only after that validator passes; otherwise fail packaging and block release.

**Tech Stack:** AionCore/SQLx SQLite migrations, Node.js CommonJS release scripts, Vitest 4, electron-builder, SHA-256 artifact provenance.

## Global Constraints

- Start from a fresh `origin/sprint2` containing `343b725c4`; do not work from the stale local checkout.
- The known evidence includes two divergent migration-34 histories associated with distributed builds `e582874c` and `a02c027b`. Both must be inventoried before declaring either supported or unsupported.
- Do not invent a numeric data floor. A supported lineage is defined by the exact ordered `(version, checksum)` sequence recorded by SQLx.
- Do not change `package.json#aioncoreVersion`, checksum pins, or trust anchors until the compatibility decision passes.
- If no candidate migration set contains every supported lineage as a checksum-identical prefix, output `incompatible`, leave the current pin unchanged, and block the release.
- Never run downgrade, delete, rebuild, or repair operations on a real profile. Platform tests use disposable copies with secrets and conversation content removed.
- Existing startup classification remains diagnostic-only; generic migration failure must not enter corruption recovery.

---

### Task 1: Declare the predecessor lineage manifest

**Files:**

- Create: `packages/shared-scripts/src/aioncore-schema-lineages.json`
- Create: `tests/unit/assets/aioncoreSchemaLineages.test.ts`
- Reference: `package.json`
- Reference: `packages/shared-scripts/src/aioncore-checksums.js`

**Manifest contract:**

```ts
type ReleasedMigrationLineage = {
  id: string;
  product: 'weprompt' | 'forge' | 'aionui';
  productVersion: string;
  backendVersion: string;
  backendArtifactSha256: string;
  distributionCommit: string;
  support: 'supported' | 'unsupported';
  supportReason?: string;
  migrations: Array<{ version: number; checksum: string }>;
};
```

- [ ] Collect immutable installers/backends actually distributed with the shared profile, including builds `e582874c` and `a02c027b`. Hash each backend artifact before inspection.
- [ ] Extract the ordered SQLx migration versions/checksums from those artifacts or sanitized disposable databases. Do not commit database files, paths, usernames, prompts, or credentials.
- [ ] Populate the manifest with concrete non-empty values and an explicit product-owner support decision for every distributed lineage. The test must reject duplicate IDs, duplicate versions within a lineage, missing provenance, blank checksums, and an unsupported entry without `supportReason`.
- [ ] Add a regression asserting that both known migration-34 histories are present and have different checksum sequences; do not collapse them by version number alone.
- [ ] Run `bunx vitest run tests/unit/assets/aioncoreSchemaLineages.test.ts`; expect it to fail before the manifest/validator fixture exists and pass after the concrete inventory is committed.
- [ ] Run `bun run test` and commit `test(release): declare supported schema lineages`.

### Task 2: Implement the fail-closed lineage validator

**Files:**

- Create: `packages/shared-scripts/src/aioncore-migration-lineage.js`
- Create: `tests/unit/assets/aioncoreMigrationLineage.test.ts`
- Modify: `tests/unit/assets/aioncoreSchemaLineages.test.ts`

**Interface:**

```js
validateTargetLineage({ predecessors, target })
// => { status: 'compatible' }
//  | { status: 'incompatible', conflicts: [{ lineageId, version, expectedChecksum, actualChecksum }] }
```

- [ ] Write failing tests for an exact extension, a missing migration, a changed checksum, reordered migrations, duplicate versions, divergent migration-34 predecessors, and a target that accepts one supported branch but not the other.
- [ ] Implement ordered prefix comparison using exact version and checksum equality. Ignore manifest entries only when `support === 'unsupported'` and a non-empty owner-approved reason exists.
- [ ] Make malformed, unreadable, or empty manifests throw and exit non-zero; never treat them as an empty compatible set.
- [ ] Expose a CLI mode that reads the committed predecessor manifest and a candidate target manifest and prints stable JSON without database content.
- [ ] Run `bunx vitest run tests/unit/assets/aioncoreMigrationLineage.test.ts tests/unit/assets/aioncoreSchemaLineages.test.ts`; expect all tests to pass.
- [ ] Run `bun run test` and commit `build(release): validate aioncore migration lineage`.

### Task 3: Select and pin a compatible AionCore candidate

**Files:**

- Modify only after a compatible result: `package.json`
- Modify only after independent hash verification: `packages/shared-scripts/src/aioncore-checksums.js`
- Modify only for a verified Forge-signed candidate: `packages/shared-scripts/src/aioncore-trust.js`
- Modify: `packages/shared-scripts/src/prepare-aioncore.js`
- Modify: `tests/unit/assets/verifyAioncoreArtifactDigest.test.ts`
- Modify: `tests/unit/assets/verifyAioncoreCosignSignature.test.ts`
- Modify: `tests/unit/assets/prepareAioncoreActionsArtifact.test.ts`

- [ ] For each candidate, record its ordered migration manifest and run the Task 2 CLI against every supported predecessor.
- [ ] If the result is `incompatible`, attach the conflicts to release evidence and stop this task without changing pins.
- [ ] For a compatible candidate, independently download/hash every supported platform asset, verify its signing provenance, then add exact committed digest/trust entries.
- [ ] Update `package.json#aioncoreVersion` only in the same commit as the verified pins and candidate lineage evidence.
- [ ] Add tests proving an unpinned/mismatched artifact and a lineage-incompatible artifact both abort preparation.
- [ ] Run:

```bash
bunx vitest run tests/unit/assets/verifyAioncoreArtifactDigest.test.ts tests/unit/assets/verifyAioncoreCosignSignature.test.ts tests/unit/assets/prepareAioncoreActionsArtifact.test.ts tests/unit/assets/aioncoreMigrationLineage.test.ts
bun run test
```

- [ ] Commit `build(aioncore): pin schema-compatible runtime` only when every command exits 0.

### Task 4: Make compatibility a packaging and release gate

**Files:**

- Modify: `scripts/afterPack.js`
- Modify: `tests/unit/assets/afterPackAioncoreIsolation.test.ts`
- Modify: `tests/unit/releasePackagingConfig.test.ts`
- Modify: `packages/desktop/src/process/startup/backendStartupFailure.ts`
- Modify: `tests/unit/process/startup/backendStartupFailure.test.ts`

- [ ] Write a failing after-pack test where a correctly hashed binary has an incompatible migration manifest; assert packaging exits non-zero before producing a releasable result.
- [ ] Invoke the lineage validator from `afterPack.js` against the bundled candidate provenance. Keep artifact integrity, signature, resource completeness, and schema compatibility as separate named failures.
- [ ] Preserve actionable migration-failure classification in startup diagnostics while proving it never calls `recoverCorruptedDatabase` or deletes files.
- [ ] Run the focused suites, `just check`, `bun run test`, and `bun run test:coverage`.
- [ ] Commit `build(release): gate schema compatibility`.

### Task 5: Execute the disposable platform upgrade matrix

- [ ] Prepare sanitized disposable profiles for every supported lineage; retain only migration metadata and synthetic application records.
- [ ] On macOS ARM, macOS Intel, and Windows, run clean install plus upgrade/restart for each lineage. Record installer hash, bundled backend hash/version, starting lineage ID, startup result, and post-start SQLx migration rows.
- [ ] Prove clean startup, preserved synthetic records, idempotent second startup, and safe actionable failure for every intentionally unsupported lineage.
- [ ] Do not mark BUG-013 complete until every supported lineage/platform row passes. A missing platform result keeps the release blocked.

## Final Acceptance

- The release contract names every supported distributed predecessor by exact migration checksums and provenance.
- Both known migration-34 histories are explicitly resolved; neither is silently discarded.
- The selected target is a checksum-identical extension of every supported lineage.
- Package creation fails on missing, malformed, or incompatible lineage evidence.
- Startup migration failure remains non-destructive and cannot enter corruption recovery.
- All supported upgrade rows pass on disposable macOS ARM, macOS Intel, and Windows profiles.

