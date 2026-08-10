# AionCore Build & Provenance — Handoff to Platform (khoapnt)

> **Superseded for the Sprint 3 release-line decision (2026-08-10).** See
> [aioncore-sprint3-release-line.md](aioncore-sprint3-release-line.md) for the accepted tag, corrected
> BUG-013 provenance, branch/tag policy, and required build-SHA control. The historical handoff
> below is retained unchanged for context.

**Date:** 2026-08-08 · **From:** minhtq (Controller) · **Status:** decision requested
**Companions:** [epic003-backend-decision-record.md](epic003-backend-decision-record.md) (DR-1/2/3),
BUG-040 in `TASKS.md`, held branch `chore/aioncore-v0162-bump`.
Every claim below was verified against code, upstream trees, or live API this week — file references
are to `origin/sprint2` unless stated.

## TL;DR

1. **WePrompt has no GitLab CI.** There is no `.gitlab-ci.yml`; every pipeline — build, release,
   and the native packaging acceptance — is a GitHub Actions workflow under `.github/workflows/`,
   inherited from the AionUi fork. code.vng.vn cannot execute those files, so none of it runs on
   our GitLab MRs.
2. **As of `!79` (merged 2026-08-08), default packaging fails closed.** `prepare-aioncore.js:785`
   now requires `migration-lineage.json` **inside the downloaded AionCore release archive**, and
   upstream's release archives contain **only the binary** (verified against upstream
   `release.yml`: `tar -czf … binary_name`). Every standard packaging attempt fails with
   _"AionCore release asset … is missing a valid migration-lineage.json document"_ until artifacts
   in the new format exist.
3. **The fix is prepared and waiting for a human dispatch:** a Forge-Aion workflow branch
   (`forge-v0162`) that builds pinned upstream `v0.1.62`, bundles the lineage file into each
   archive, cosign-signs everything, and publishes the release WePrompt's default resolver expects.
4. **Recommendation: transfer `minhtq1234/Forge-Aion` to a VNG-controlled GitHub organization.**
   It is currently a private repo under a personal account, and it is on the critical path of
   every future AionCore ship.

## Map: how the AionCore binary reaches the app

`packages/shared-scripts/src/prepare-aioncore.js` supports three sources, all fail-closed:

| Path                                                | Trigger                         | Verification                                                                                                      | State today                                                                                  |
| --------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GitHub **releases** (upstream `iOfficeAI/AionCore`) | default                         | sha256 pins in `aioncore-checksums.js` + (since `!79`) lineage file in the archive                                | **How `v0.1.50` ships. Broken since `!79`** — upstream archives carry no lineage file        |
| GitHub **Actions artifact**                         | `AIONUI_BACKEND_RUN_ID` env     | run `head_sha` must equal `ACCEPTED_AIONCORE_SOURCE_COMMIT`                                                       | Unusable: the accepted SHA was fabricated (BUG-040) — rejects everything; fix rides the bump |
| **Forge mirror** (`minhtq1234/Forge-Aion` releases) | trust-map entry for the version | cosign keyless verify against pinned workflow identity + GitHub OIDC issuer (`aioncore-trust.js`), then checksums | Proven end-to-end once (`v0.1.43-forge-poc`); dormant since 2026-07-08                       |

After download, packaging runs the binary itself to generate `managed-resources/`
(`prepare-aioncore.js:383-392`) and `verify-bundled-aioncore-resources.js` checks the bundle
(binary + `migration-lineage.json` + `managed-resources/`) against the repo's accepted lineage.

## What Forge-Aion actually is

A **private GitHub repo under minhtq's personal account**, created 2026-07-07, dormant since
2026-07-08. It holds a snapshot of the team's AionCore branches plus one workflow
(`forge-build-sign.yml`): a **supply-chain proof-of-concept** — build AionCore from source, sign
the artifact with cosign (keyless/Sigstore, tied to the workflow's GitHub OIDC identity), publish.
WePrompt pins that identity in `aioncore-trust.js`, so packaging can prove an artifact came from
exactly that workflow and nothing else. The PoC proved the chain once, single target, for
`v0.1.43`. It is not the frontend "Forge" brand — same name, unrelated thing.

## This week's findings that make it urgent

- **BUG-040:** `!79`'s `ACCEPTED_AIONCORE_SOURCE_COMMIT` names a commit that exists nowhere —
  fabricated by a sandboxed agent, greened by self-referential tests. Consequence: what we ship
  today (`v0.1.50`, stock upstream) has **no verifiable provenance at all** — the trust map has no
  entry for it.
- **The read-only audit of `!79`** confirmed the migration lineage itself is real (three
  independent derivations) but found the packaged recovery acceptance is synthetic (skips AionCore
  startup, excluded from `bun run test`) and the native CI cannot pass with upstream archives.
- **Packaging symptom table** — if your packaging attempts failed, match the symptom:

| Symptom                                                               | Cause                                                                | Since              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| `…release asset … is missing a valid migration-lineage.json document` | upstream archive has no lineage file; `!79` requires it              | 2026-08-08 (`!79`) |
| `…does not match accepted source commit 260dbbc05…`                   | fabricated pin on the Actions path (BUG-040)                         | 2026-08-08 (`!79`) |
| sha256/pinned-digest rejection on a version bump                      | no entry for the new version in `aioncore-checksums.js`              | always (by design) |
| cosign verify failure or "no trust anchor" on a Forge download        | `aioncore-trust.js` has only a `v0.1.43` entry                       | always (by design) |
| "CI passed" evidence missing for GitLab MRs                           | there is no GitLab CI; the GitHub workflows never run on code.vng.vn | since the fork     |

## The v0.1.62 plan already in flight

- **WePrompt side:** branch `chore/aioncore-v0162-bump` (held, green, `611568a44` + hardening):
  lineage extended 27→37 (generator reproduces the shipped 27 byte-for-byte — verified three
  independent ways), pins moved to `v0.1.62` / `35707c0a…` (the upstream release commit),
  checksums/trust deliberately untouched until real artifacts exist.
- **Forge side:** branch `forge-v0162` prepared locally (worktree `/tmp/forge-v0162`, awaiting
  minhtq's commit+push — the permission layer rightly refused to let an agent push to the signing
  repo). The workflow: six-target matrix mirroring upstream's at `v0.1.62` (runners, cross pin,
  rustflags, MSVC fix), **source repo and commit hardcoded** (an input-selectable source would let
  one trusted identity sign arbitrary code), lineage generated once in a dedicated job by a script
  proven byte-identical against both known-good lineages, archives = binary + lineage (flat),
  cosign bundle per asset, release tag `v0.1.62-forge-poc` to match the default resolver.
- **After dispatch:** verify one asset with `cosign verify-blob` (and that a tampered byte fails),
  then record the run's identity (`…forge-build-sign.yml@refs/heads/forge-v0162`) in
  `aioncore-trust.js` and the published sha256s in `aioncore-checksums.js` — values read from the
  release by a human, never from agent output (the BUG-040 rule). Then the bump branch goes to
  packaged acceptance on macOS ARM/Intel and Windows.

## Recommendations (in order)

1. **Dispatch the `v0.1.62` build from Forge-Aion as-is** to unblock packaging this sprint. The
   trust chain there is proven; rebuilding it elsewhere mid-sprint repeats the BUG-040 lesson in
   reverse.
2. **Transfer `Forge-Aion` to a VNG-controlled GitHub organization.** Keyless signing, macOS/
   Windows managed runners, and the proven verify chain all survive a transfer; the only WePrompt
   change is the identity string in `aioncore-trust.js`. What it fixes: bus factor of one, no
   org-level access control or audit trail, and shipped-binary provenance rooted in a personal
   account.
3. **Decide the long-term CI home deliberately, not by inheritance.** Staying on GitHub (org-owned)
   is the low-cost path. Moving builds to code.vng.vn requires: macOS/Windows runner hardware,
   key-based cosign (protected CI variables) or a private Sigstore deployment, and reworking
   `aioncore-trust.js` from identity-pinning to key-pinning. That is an infrastructure project —
   schedule it, don't drift into it.
4. **Same decision, one level up, for WePrompt's own CI:** the `.github/workflows/` inheritance
   means our release and acceptance pipelines don't run against GitLab MRs. Whatever home is
   chosen for Forge should answer this too.

## Open questions for khoapnt

1. Does VNG already have a GitHub organization we can transfer into, and who administers it?
2. Do code.vng.vn runners include macOS hardware today? (If yes, recommendation 3's cost drops.)
3. Who besides minhtq should hold dispatch rights on the signing workflow after transfer?
4. Were your packaging failures matching any row of the symptom table above? If a symptom is
   missing from it, that is a new finding — please add it to BUG-040's thread rather than working
   around it.
