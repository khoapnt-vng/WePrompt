# AionCore Sprint 3 Release-Line Decision Record

**Date:** 2026-08-10 · **Status:** accepted (Controller: minhtq)
**Scope:** defines the immutable AionCore source pin for Sprint 3, corrects the superseded
release-line and Sprint 2 provenance statements, and establishes the branch/tag and build
acceptance controls for the next release.
**See also:** [aioncore-build-provenance-handoff.md](aioncore-build-provenance-handoff.md),
BUG-040 in `TASKS.md`, and T0.2 in [sprint3-plan.md](../readme/sprint3-plan.md).

---

## Creative Studio 4 pilot amendment — `v0.1.55`

**Date:** 2026-09-02 · **Status:** accepted for the internal macOS ARM64 and Windows x64 pilot

The current pilot source pin is immutable tag `v0.1.55` at
`ef6e1dd199e884fdf2df95d494b2c51b97006656` on
`github.com/khoapnt-vng/aioncore`. It supersedes the Sprint 3 `v0.1.51` pin for pilot builds without
rewriting the historical Sprint 3 decision below. The release workflow accepts that exact tag and
commit only and publishes exactly `aarch64-apple-darwin` and `x86_64-pc-windows-msvc` complete
bundles. WePrompt separately pins the tag, full source commit, migration lineage, allowed runtime
keys, and independently calculated archive digests.

This is an unsigned internal release. Public distribution remains subject to the signing and
packaged acceptance requirements in [aioncore-artifact-contract.md](aioncore-artifact-contract.md).

## Decision — Sprint 3 ships the `v0.1.51` tag

The Sprint 3 AionCore release line is tag `v0.1.51`, whose target is
`d4d8e87714690cdb230ab7a6987de3ceacbea275`. The tag resolves to that exact commit on both
`code.vng.vn/dto/aioncore` and `github.com/khoapnt-vng/aioncore`.
`ACCEPTED_AIONCORE_SOURCE_COMMIT` matches this commit.

Verify each host independently from a clean clone or temporary repository:

```bash
git fetch --no-tags https://code.vng.vn/dto/aioncore.git tag v0.1.51
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = d4d8e87714690cdb230ab7a6987de3ceacbea275

git fetch --no-tags https://github.com/khoapnt-vng/aioncore.git tag v0.1.51
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = d4d8e87714690cdb230ab7a6987de3ceacbea275
```

Both checks must pass. A matching tag name on only one host, a matching branch name, or a test
fixture containing the expected value is not provenance evidence.

## Corrections to the superseded working record

### The designated release branch was wrong

The working record designated `fix/mcp-oauth-discovery` at
`fbe0ac6bcccf0eb3bd7db095568fb4de2096ce42` as the release line and instructed the team to
protect it. That is superseded. The shipped commit is not on that branch's tip lineage; it is the
`v0.1.51` tag on `security/pilot-hardening-d01-d06`. Protecting
`fix/mcp-oauth-discovery` would protect a branch from which nothing ships.

The two trees differ only in the version metadata in `Cargo.toml` and `Cargo.lock` (`0.1.50`
versus `0.1.51`). This was a provenance-naming error, not a substantive source-content
difference.

### The release line was described as a branch head

The instruction to "merge accepted changes back into the release line" is superseded. The
release line is the immutable `v0.1.51` tag, not a moving branch head.
`security/pilot-hardening-d01-d06` has already advanced past the pinned commit on GitHub to
`v0.1.52` at `9b418ea3`. Accepted work lands on a protected branch and is cut as a new tag; only
that new tag and its exact commit can become the next pin.

### The BUG-013 Sprint 2 source pin was fabricated

The Sprint 2 backend table attributed BUG-013 to
`260dbbc05d5c8d079fb60e0e9578d4250b6e4338`. That statement is superseded. The commit is not
recoverable from `iOfficeAI/AionCore`, `khoapnt-vng/aioncore`, or
`code.vng.vn/dto/aioncore`; fetch-by-SHA checks with a passing positive control found it on none
of the three hosts, and the GitLab remote has no merge-request ref for it. BUG-013 therefore has
**no recoverable AionCore source commit**.

The BUG-015 row remains valid: `2a9a02e27` is a real commit on the GitHub contributor fork via
PR #808.

| Sprint 2 item | Corrected AionCore provenance                                                 |
| ------------- | ----------------------------------------------------------------------------- |
| BUG-013       | No recoverable source commit; the previously recorded full SHA was fabricated |
| BUG-015       | `2a9a02e27`, present on the GitHub contributor fork via PR #808               |

## Branch and tag policy

1. Protect `security/pilot-hardening-d01-d06`, not `fix/mcp-oauth-discovery`, as the branch that
   carries the current release lineage. Require reviewed changes before they land there.
2. Treat the protected branch as the place where future release work lands, not as the released
   source pin. A branch head can advance; an accepted release pin must name an immutable tag and
   its exact commit.
3. After accepted changes land, cut a new tag. Verify that tag and its commit on the publishing
   host, verify the release artifacts and checksums, and only then update
   `ACCEPTED_AIONCORE_SOURCE_COMMIT` and the desktop release pin.
4. Never move or reuse an accepted tag. If a release must change, cut a new tag and record a new
   decision.

For Sprint 3, the accepted pin remains `v0.1.51` at
`d4d8e87714690cdb230ab7a6987de3ceacbea275`, regardless of later commits on
`security/pilot-hardening-d01-d06`.

## Deliberately forgone at this pin

`v0.1.52` is `v0.1.51` plus exactly two commits: the version bump and
`b2c329d fix(mcp): send stored OAuth token on MCP connection test`.

Keeping `v0.1.51` deliberately gives up that MCP OAuth connection-test fix in exchange for using
the release whose checksums are already cross-verified. Reconsider the fix at the next tag bump;
do not silently treat the moving branch head or `v0.1.52` as the accepted Sprint 3 source.

## Required release control — resolve the built SHA on the publishing host

After every build, and before accepting any artifact, assert that the built source SHA resolves
on the publishing host:

```bash
git ls-remote https://github.com/khoapnt-vng/aioncore.git | grep -q "$BUILT_SHA"
```

A failing command rejects the artifact. Record the built SHA and the publishing-host result with
the release evidence. This check is required in addition to artifact checksum and signing
verification; it does not replace them.

No test fixture, checked-in constant, generated manifest, or self-referential test may be the
authority for a provenance value. Provenance must be established against the publishing host
after the build.
