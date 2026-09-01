# AionCore Release Artifact Contract

**Date:** 2026-08-11 · **Status:** proposed for T1.1 acceptance
**Scope:** defines the artifact set that may be pinned by WePrompt, the evidence required before a
pin changes, and the independent checks that connect AionCore source to packaged acceptance.
**See also:** [aioncore-sprint3-release-line.md](aioncore-sprint3-release-line.md),
[aioncore-build-provenance-handoff.md](aioncore-build-provenance-handoff.md), BUG-040 in
`TASKS.md`, and T1.1/T1.2 in [sprint3-plan.md](../readme/sprint3-plan.md).

---

## Reading rule

- **Verified current state** means the cited repository file says or enforces the claim at the
  cited lines. It does not mean an external artifact was re-downloaded for this record.
- **Proposed contract** means a requirement introduced by this record. It is not implemented merely
  because it is written here.
- **Gap** means current repository behavior or recorded release evidence does not satisfy the
  proposed contract.

No fixture, checked-in constant, generated manifest, or test that feeds a value back to the code
that owns that value is provenance authority. The repository's own Actions-artifact tests call out
this exact limitation (`tests/unit/assets/prepareAioncoreActionsArtifact.test.ts:134-140`), and the
release-line decision makes out-of-band publishing-host verification mandatory
(`docs/design/aioncore-sprint3-release-line.md:97-112`).

## Decision — a pin names a verified release set, not a binary

**Proposed contract.** One AionCore release set consists of one immutable tag and exact source
commit, one target archive per supported runtime, one `aioncore-checksums.txt` release sidecar, and
one `<asset>.cosign.bundle` sidecar per target archive. WePrompt may pin the release only after an
independent reviewer has connected all of those objects to the same source commit.

The target archive name follows the existing
`aioncore-<tag>-<architecture>-<platform>.tar.gz` convention, with `.zip` for Windows
(`packages/shared-scripts/src/prepare-aioncore.js:461-479`). Its top level contains exactly these
four entries:

```text
aioncore            # aioncore.exe on Windows
manifest.json
migration-lineage.json
managed-resources/
```

Files may not be hidden under an extra directory. They must be regular files or, for
`managed-resources/`, a directory contained by the archive root. This strict root layout is a
proposed rule. The current resolver searches recursively for the binary and lineage
(`packages/shared-scripts/src/prepare-aioncore.js:540-563`), so current acceptance of a nested
layout is not evidence that the proposed contract is met.

### Required contents and consumers

| Release object                  | Proposed location and format                                                                                                                                                                                                                                                                                                                                                                                    | Current consumer requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | State at this record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native binary                   | Archive root: `aioncore` on macOS/Linux or `aioncore.exe` on Windows; one regular executable for the archive's target                                                                                                                                                                                                                                                                                           | The resolver derives the name from the platform (`prepare-aioncore.js:144-146`), requires it after extraction (`prepare-aioncore.js:787-790`, `868-871`), and the final-bundle verifier requires it under `bundled-aioncore/<runtimeKey>/` (`verify-bundled-aioncore-resources.js:17-30`, `854-864`).                                                                                                                                                                                                                                     | **Verified current requirement.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Exact source commit             | Archive-root `manifest.json`, UTF-8 JSON with a trailing newline. It carries the existing fields `platform`, `arch`, `version`, `generatedAt`, `sourceType`, `source`, `migrationLineage`, and `files`; `source.headSha` is mandatory and is the full 40-character lowercase commit that the immutable tag resolves to. `files` is exactly the binary name, `migration-lineage.json`, and `managed-resources/`. | The current manifest builder already emits those top-level fields and file list (`prepare-aioncore.js:128-130`, `164-174`), and the Actions path already records `source.headSha` (`prepare-aioncore.js:960-972`). The final verifier currently checks only platform, architecture, and lineage (`verify-bundled-aioncore-resources.js:110-157`).                                                                                                                                                                                         | **Proposed archive requirement and stronger source check. Gap:** release downloads do not populate `source.headSha`, and WePrompt generates the root manifest after download (`prepare-aioncore.js:1045-1057`) rather than consuming a signed one.                                                                                                                                                                                                                                                                                                                                                                           |
| Migration lineage               | Archive root: `migration-lineage.json`, UTF-8 JSON. Its format is the repository's accepted document: `schemaVersion`, `minimumSupportedVersion`, `latestVersion`, `entryCount`, `fingerprint`, and ordered `entries` of `version`, `description`, `filename`, and `checksum` (`packages/shared-scripts/src/aioncore-migration-lineage.json:1-11`).                                                             | All three remote resolvers require the file inside the extracted archive and deep-compare it with WePrompt's accepted lineage (`prepare-aioncore.js:148-161`, `747-753`, `787-795`, `868-875`). The final verifier repeats the deep comparison (`verify-bundled-aioncore-resources.js:159-195`).                                                                                                                                                                                                                                          | **Verified current requirement. Gap closed 2026-09-01:** AionCore now copies `migration-lineage.json` to the archive root (`assemble_bundle.py:152`), and WePrompt's accepted document was updated to AionCore's canonical schema-29 lineage, which added a `filename` field per entry. The two were briefly incompatible: the consumer deep-compares the whole document, so an unreconciled `filename` key would have refused every archive on all five resolver paths. The earlier record that no release-line archive contained this file (`TASKS.md:52-57`; `aioncore-build-provenance-handoff.md:20-25`) is superseded. |
| Managed resources               | Archive root: the complete `managed-resources/` tree produced for that exact binary and target, including `managed-resources/manifest.json`. The nested manifest is UTF-8 JSON using verifier-supported schema 1 or 2. Every path declared by it must be relative, contained, and present.                                                                                                                      | The final verifier requires the directory and its regular-file manifest (`verify-bundled-aioncore-resources.js:790-851`, `854-869`). Schema 1 requires matching runtime data, managed Node, and the required `codex-acp` and `claude-agent-acp` tools (`verify-bundled-aioncore-resources.js:6-15`, `308-365`, `368-510`). Schema 2 requires a supported runtime, managed Node, and the required `claude` and `codex` CLIs plus every declared file and directory (`verify-bundled-aioncore-resources.js:567-609`, `611-732`, `734-787`). | **Verified final-bundle requirement. Gap:** remote archives are not consumed as the authority for these resources. Packaging currently executes the downloaded binary to create them (`prepare-aioncore.js:389-408`, `1035-1057`). The release archive and its signature therefore do not currently cover the resources that reach the app.                                                                                                                                                                                                                                                                                  |
| SHA-256 checksums               | Release sidecar, not an archive member: `aioncore-checksums.txt`. Proposed canonical format is one line per target archive: 64 lowercase hexadecimal characters, two ASCII spaces, the exact asset filename, then LF. It covers every target archive in the release.                                                                                                                                            | The release path verifies the whole downloaded archive against an independently committed digest before extraction (`prepare-aioncore.js:221-268`). The repository explicitly treats the value in `aioncore-checksums.js`, not the unsigned release sidecar, as its trust anchor and requires a local cross-check when regenerating it (`aioncore-checksums.js:1-36`).                                                                                                                                                                    | **Verified archive-digest enforcement and pins for all six `v0.1.51` archives; one macOS ARM archive was independently cross-verified** (`aioncore-checksums.js:53-70`). **Proposed sidecar format.** The repository does not establish the current publisher's exact text formatting, so this format becomes binding only for artifacts built under this contract.                                                                                                                                                                                                                                                          |
| Signing and provenance evidence | Release sidecar: `<asset>.cosign.bundle`, produced for the exact archive bytes. The archive's root manifest is therefore inside the signed payload. The accepted signer workflow identity and OIDC issuer are independently recorded in WePrompt.                                                                                                                                                               | The Forge resolver downloads that exact sidecar name, obtains the pinned identity and issuer, and runs `cosign verify-blob` before extraction (`prepare-aioncore.js:819-876`). The trust-map contract explains why identity plus issuer, rather than a release-adjacent unsigned file, is the trust anchor (`aioncore-trust.js:1-24`).                                                                                                                                                                                                    | **Verified mechanism, but not for the current pin. Gap:** `aioncore-trust.js` contains a trust anchor only for `v0.1.43` (`aioncore-trust.js:44-60`), not `v0.1.51`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

The checksum and cosign bundle are release sidecars rather than archive members because an archive
cannot contain a stable checksum or signature of its own final bytes. Both still belong to the
release set and are mandatory acceptance inputs.

## Acceptance conditions — all are mandatory before pinning

**Proposed contract.** Reject the artifact if any condition below is absent, unverifiable, or
inconsistent:

1. **Reviewed source.** The AionCore change is reviewed and accepted onto the protected release
   lineage, then cut as a new immutable tag. A moving branch head is not a release pin; this follows
   the accepted branch/tag policy (`docs/design/aioncore-sprint3-release-line.md:71-86`).
2. **Publishing-host resolvability.** The tag resolves to the built SHA, and that full SHA is
   advertised by the publishing host. A failing publishing-host lookup rejects the artifact. This
   check is in addition to checksums and signing (`docs/design/aioncore-sprint3-release-line.md:97-108`).
3. **Passing source gate.** The AionCore gate passes on that exact SHA before release artifacts are
   signed. The release evidence records the host, immutable run identifier, conclusion, and
   `head_sha`. WePrompt's current Actions resolver already rejects a run unless it is completed,
   successful, and at the accepted commit (`prepare-aioncore.js:675-697`); the same facts must be
   independently obtained rather than inferred from a fixture.
4. **Exact signed layout.** Every target archive has exactly the four top-level entries defined
   above. The root manifest's `source.headSha` equals the tag target and gate `head_sha`; its platform
   and architecture equal the archive target. The cosign bundle verifies the archive against the
   independently accepted workflow identity and issuer before extraction or execution.
5. **Independent SHA-256.** The reviewer downloads each release archive, calculates its SHA-256
   locally, compares it with `aioncore-checksums.txt`, and records the locally calculated value in
   the WePrompt pin. A value copied only from the publishing job or its sidecar is insufficient.
6. **Lineage equality.** The archive's `migration-lineage.json` parses and deep-equals the accepted
   WePrompt document. A filename alone, a fingerprint alone, or a generated fixture is insufficient.
7. **Managed-resource completeness.** The archive's `managed-resources/manifest.json` is a supported
   schema for the exact runtime, all declared paths remain inside the tree, and the production
   verifier reports no missing resources or failures.
8. **Exact WePrompt pin.** One change pins the immutable tag, full source commit, independently
   calculated archive digest for each shipped target, and signer identity/issuer. A version-only
   pin, a branch name, or a SHA that was not resolved on the publishing host is rejected.
9. **Packaged acceptance.** After pinning, signed macOS ARM and Windows packages are built from the
   pinned release set, installed from scratch, and upgraded from the supported prior database. The
   packaged application starts the real bundled AionCore, exercises lineage preflight, preserves
   user data on rejection, and completes the release acceptance checks. A debug-injected failure
   object does not satisfy this condition.

The repository's current packaged test sets
`AIONUI_DEBUG_BACKEND_STARTUP_FAILURE=backend_database_lineage_incompatible` rather than starting a
real incompatible backend (`tests/e2e/specs/installation-integrity.e2e.ts:76-97`). The workflow does
run that test against a package (`.github/workflows/_build-reusable.yml:584-592`), but it remains UI
recovery evidence, not the packaged acceptance required by condition 9.

## Required chain and current link status

The release-complete chain is:

```text
WePrompt PR
  -> AionCore change
  -> accepted release-line commit and immutable tag
  -> passing AionCore gate at that commit
  -> signed target archive
  -> independently verified checksum and provenance
  -> exact WePrompt tag + source + digest + signer pin
  -> real packaged clean-install and upgrade acceptance
```

| Link                                                               | Verified current state                                                                                                                                                                                                                                                                                                                                                                         | Contract verdict                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WePrompt PR → AionCore change                                      | T1.1/T1.2 define the required work, but this repository contains no durable PR-to-AionCore-change identifier for the next backend-dependent release (`docs/readme/sprint3-plan.md:184-211`).                                                                                                                                                                                                   | **Does not yet exist for the next release.**                                                                                                              |
| AionCore change → accepted release-line commit/tag                 | The accepted current release-line record names immutable tag `v0.1.51` and its full commit and records independent resolution on both hosts (`docs/design/aioncore-sprint3-release-line.md:12-30`).                                                                                                                                                                                            | **Exists for the current source pin.** It does not prove a future change is accepted.                                                                     |
| Accepted commit → passing AionCore gate                            | The Actions resolver knows how to require `status=completed`, `conclusion=success`, and the exact `head_sha` (`prepare-aioncore.js:675-697`). No AionCore gate run for the current release is recorded in this repository.                                                                                                                                                                     | **Mechanism exists; evidence link not established here.**                                                                                                 |
| Passing gate → signed artifact                                     | WePrompt can verify Forge cosign bundles (`prepare-aioncore.js:819-876`). The current `v0.1.51` pin has no signer entry (`aioncore-trust.js:44-60`).                                                                                                                                                                                                                                           | **Does not exist for the current pin.**                                                                                                                   |
| Signed artifact → independent checksum and provenance verification | All six `v0.1.51` archive digests are pinned and one macOS ARM archive was independently cross-verified (`aioncore-checksums.js:53-70`); its source tag has independent host resolution (`aioncore-sprint3-release-line.md:12-30`). There is no `v0.1.51` signature to verify, and the archive lacks the required lineage.                                                                     | **Partial only; contract fails.**                                                                                                                         |
| Independently verified artifact → exact WePrompt pin               | `package.json` pins `v0.1.51` (`package.json:276`); `ACCEPTED_AIONCORE_SOURCE_COMMIT` pins the tag's full commit (`prepare-aioncore.js:38-42`); per-target digests are pinned (`aioncore-checksums.js:60-70`).                                                                                                                                                                                 | **Source and digest pins exist, but they point to a non-conforming, unsigned release set. They may not be treated as an accepted artifact-contract pin.** |
| Exact pin → packaged acceptance                                    | The build workflow invokes `prepareAioncore` before packaging (`.github/workflows/_build-reusable.yml:385-395`) and has a packaged recovery step (`.github/workflows/_build-reusable.yml:584-592`). The archive lacks lineage, so default preparation fails first; the recovery test then injects the failure instead of exercising AionCore. BUG-040 records both defects (`TASKS.md:52-57`). | **Does not exist. Release remains blocked.**                                                                                                              |

## Known gaps — current reality, not roadmap claims

1. **Blocking: no current release-line archive contains `migration-lineage.json`.** WePrompt requires
   it inside every release, Actions, and Forge archive before packaging can continue
   (`prepare-aioncore.js:747-753`, `787-795`, `868-875`). The repository's audited record says the
   publisher's `release.yml` archives the binary alone (`TASKS.md:52-57`). This record does not claim
   that an unmerged generator or workflow has fixed the publisher.
2. **Managed resources are outside the signed release boundary.** Current packaging executes the
   downloaded binary and generates `managed-resources/` locally (`prepare-aioncore.js:389-408`,
   `1035-1057`). The proposed archive-carried resources and their provenance are not implemented.
3. **The signed source manifest is absent.** Current release downloads produce a WePrompt-side
   `manifest.json` after extraction; only the Actions path records `source.headSha`
   (`prepare-aioncore.js:960-972`, `1045-1057`). The released bytes do not currently carry the
   source assertion that their signature must cover.
4. **Current signing evidence does not cover the current pin.** The verifier exists, but the only
   checked-in signer trust anchor is for `v0.1.43`, not `v0.1.51`
   (`aioncore-trust.js:44-60`).
5. **The release-side checksum format is not established by this repository.** The repository
   names `aioncore-checksums.txt` and independently pins archive digests, but does not contain a
   publisher copy whose byte format can be inspected (`aioncore-checksums.js:10-36`). The canonical
   line format in this contract is therefore proposed.
6. **The current resolver is looser than the proposed archive layout.** It recursively finds the
   binary and lineage (`prepare-aioncore.js:540-563`) and does not reject extra top-level entries.
7. **A passing AionCore source gate is not evidenced here.** WePrompt's run gate exists, but the
   external AionCore workflow definition and an accepted run identifier are not in this repository.
8. **Packaged lineage acceptance is synthetic.** The package is real, but the failure is injected;
   no seeded database starts the real bundled backend and reaches lineage rejection
   (`installation-integrity.e2e.ts:76-97`).
9. **The recorded generator is not on an accepted publishing line.** The historical handoff says
   the lineage-producing workflow was prepared on a private Forge-Aion branch awaiting dispatch
   (`aioncore-build-provenance-handoff.md:76-93`). This repository cannot establish that it was
   merged, run, or published.

## Independent verification recipe

Run these commands in a clean checkout of WePrompt. Obtain `PUBLISHING_REPO`, `TAG`, `ASSET`,
`ASSET_URL`, `CHECKSUMS_URL`, `BUNDLE_URL`, `PLATFORM`, `ARCH`, `IDENTITY`, and `ISSUER` from the
publishing host and reviewed release record, not from a test fixture or from values proposed by the
build author.

### 1. Resolve the immutable source on the publishing host

```bash
VERIFY_REPO="$(mktemp -d)"
git -C "$VERIFY_REPO" init -q
git -C "$VERIFY_REPO" fetch --no-tags "$PUBLISHING_REPO" "tag $TAG"
BUILT_SHA="$(git -C "$VERIFY_REPO" rev-parse 'FETCH_HEAD^{commit}')"
test "$(printf '%s' "$BUILT_SHA" | wc -c | tr -d ' ')" = 40
git ls-remote "$PUBLISHING_REPO" | awk '{print $1}' | grep -Fxq "$BUILT_SHA"
```

Record the resulting `BUILT_SHA` with the review. Do not paste a candidate SHA into the command
before the host has returned it.

### 2. Download the release set and calculate the archive digest locally

```bash
VERIFY_DOWNLOAD="$(mktemp -d)"
cd "$VERIFY_DOWNLOAD"
curl -fsSLO --proto '=https' --proto-redir '=https' "$ASSET_URL"
curl -fsSLO --proto '=https' --proto-redir '=https' "$CHECKSUMS_URL"
curl -fsSLO --proto '=https' --proto-redir '=https' "$BUNDLE_URL"

ACTUAL_SHA256="$(shasum -a 256 "$ASSET" | awk '{print $1}')"
test "$(printf '%s' "$ACTUAL_SHA256" | wc -c | tr -d ' ')" = 64
grep -Fxq "$ACTUAL_SHA256  $ASSET" aioncore-checksums.txt
```

The value eligible for `aioncore-checksums.js` is `ACTUAL_SHA256`, calculated by the reviewer. The
release sidecar is a comparison input, not the authority.

### 3. Verify signer identity before extraction

```bash
cosign verify-blob \
  --bundle "$ASSET.cosign.bundle" \
  --certificate-identity "$IDENTITY" \
  --certificate-oidc-issuer "$ISSUER" \
  "$ASSET"

cp "$ASSET" "$ASSET.tampered"
printf x >> "$ASSET.tampered"
if cosign verify-blob \
  --bundle "$ASSET.cosign.bundle" \
  --certificate-identity "$IDENTITY" \
  --certificate-oidc-issuer "$ISSUER" \
  "$ASSET.tampered"; then
  echo 'tampered artifact unexpectedly verified' >&2
  exit 1
fi
```

The genuine archive must return zero and the modified copy must return non-zero. This mirrors the
production verifier arguments (`prepare-aioncore.js:326-358`) without trusting the build that
produced the bundle.

### 4. Extract only after checksum and signature verification, then enforce the layout

```bash
EXTRACTED="$(mktemp -d)"
case "$ASSET" in
  *.zip) unzip -q "$ASSET" -d "$EXTRACTED" ;;
  *.tar.gz) tar -xzf "$ASSET" -C "$EXTRACTED" ;;
  *) echo 'unsupported artifact type' >&2; exit 1 ;;
esac

test "$(find "$EXTRACTED" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 4
test -f "$EXTRACTED/manifest.json" && test ! -L "$EXTRACTED/manifest.json"
test -f "$EXTRACTED/migration-lineage.json" && test ! -L "$EXTRACTED/migration-lineage.json"
test -d "$EXTRACTED/managed-resources" && test ! -L "$EXTRACTED/managed-resources"
case "$PLATFORM" in
  win32) test -f "$EXTRACTED/aioncore.exe" && test ! -L "$EXTRACTED/aioncore.exe" ;;
  darwin|linux) test -f "$EXTRACTED/aioncore" && test ! -L "$EXTRACTED/aioncore" ;;
  *) echo 'unsupported platform' >&2; exit 1 ;;
esac
```

### 5. Compare source and lineage without using fixtures as authority

```bash
node - "$EXTRACTED/manifest.json" "$BUILT_SHA" "$PLATFORM" "$ARCH" <<'NODE'
const fs = require('fs');
const [manifestPath, builtSha, platform, arch] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!/^[0-9a-f]{40}$/.test(manifest?.source?.headSha)) process.exit(1);
if (manifest.source.headSha !== builtSha) process.exit(1);
if (manifest.platform !== platform || manifest.arch !== arch) process.exit(1);
const binary = platform === 'win32' ? 'aioncore.exe' : 'aioncore';
const expectedFiles = [binary, 'migration-lineage.json', 'managed-resources/'];
if (JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) process.exit(1);
NODE

node - "$EXTRACTED/migration-lineage.json" \
  "$OLDPWD/packages/shared-scripts/src/aioncore-migration-lineage.json" <<'NODE'
const fs = require('fs');
const [releasedPath, acceptedPath] = process.argv.slice(2);
const released = JSON.parse(fs.readFileSync(releasedPath, 'utf8'));
const accepted = JSON.parse(fs.readFileSync(acceptedPath, 'utf8'));
if (JSON.stringify(released) !== JSON.stringify(accepted)) process.exit(1);
NODE
```

The accepted lineage file is the reviewed WePrompt contract. A generated copy in the artifact's
build workspace is not an independent comparison source.

### 6. Run the production resource verifier against the extracted bytes

```bash
VERIFY_STAGE="$(mktemp -d)"
RUNTIME_KEY="$PLATFORM-$ARCH"
mkdir -p "$VERIFY_STAGE/resources/bundled-aioncore/$RUNTIME_KEY"
cp -R "$EXTRACTED/." "$VERIFY_STAGE/resources/bundled-aioncore/$RUNTIME_KEY/"

node - "$OLDPWD" "$VERIFY_STAGE/resources" "$PLATFORM" "$ARCH" <<'NODE'
const path = require('path');
const [projectRoot, resourcesDir, platform, arch] = process.argv.slice(2);
const verifier = require(path.join(
  projectRoot,
  'packages/shared-scripts/src/verify-bundled-aioncore-resources.js',
));
const result = verifier.verifyBundledAioncoreResources({
  resourcesDir,
  electronPlatformName: platform,
  targetArch: arch,
});
if (result.missing.length || result.failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
NODE
```

Only after all six stages pass may a WePrompt pin change be reviewed. Packaged acceptance remains a
separate later link: this repository does not yet contain a command that starts a deliberately
incompatible real bundled AionCore database and proves the required rejection/preservation path.

## Evidence this repository cannot determine alone

- Whether the AionCore publisher has merged the lineage generator or changed `release.yml` since
  the audited record.
- The current external AionCore gate definition, accepted run identifier, runner evidence, and
  whether it passed for an artifact candidate.
- A signer identity and issuer for any release newer than the sole `v0.1.43` trust-map entry.
- Real artifact digests or source commits for a future release. Those values must be obtained and
  checked during review; this contract intentionally supplies none.
- Whether a future signed package passes clean install, prior-database upgrade, real AionCore
  lineage rejection, preservation, and recovery on macOS ARM and Windows.
