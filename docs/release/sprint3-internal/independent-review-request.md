# Sprint 3 internal RC independent review request

Status: **review required; not authorized to publish or package**

## Immutable review targets

- WePrompt executable candidate: `1a00f5fa6f446c57475426d260b0ee1ad0d19410`
- WePrompt evidence commit: `23a4070403de263ee4e67919969e1c42f575c6f3`
- WePrompt approved base: `634f49c21567d9bd987b04887eaa0c6126b86353`
- AionCore candidate: `e2931e953cbdfed146497e25ebf7bc3981b95193`
- AionCore approved base: `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`
- Intended AionCore version: `v0.1.55` (not tagged or published)

Review the exact commits, not branch names. Neither release branch has been pushed by this execution wave.

## Scope assertions to verify

1. WePrompt descends from the approved Sprint 3 base without wholesale `main` integration.
2. Creative Studio, auto-update, and Sentry are fail-closed for `WEPROMPT_INTERNAL_RELEASE=1`.
3. The manual RC workflow accepts one exact 40-character commit through a non-interpolated environment boundary, runs Windows x64 first, and permits only Windows x64 plus macOS ARM64 unsigned candidates.
4. Missing native Windows evidence is a no-go; macOS cannot waive it.
5. AionCore bundles contain the exact backend binary, immutable migration lineage, complete managed resources, and pinned OfficeCLI for only the two approved targets; only the GitHub release publisher has `contents: write`.
6. The package verifier rejects backend/hash/target drift, missing OfficeCLI/templates, a second runtime, and enabled excluded features.
7. The packaged-evidence validator enforces Windows-first acceptance, exact artifact identity, all 12 scenarios, all four Windows gates, sanitized hashed evidence, and the BUG-017 decision boundary.
8. The installation, known-issue, acceptance, and decision records do not pre-authorize release or weaken host security/data-preservation controls.
9. No AionCore tag, push, GitHub release, WePrompt workflow trigger, or desktop distribution has occurred.

## Evidence requiring reviewer disposition

### WePrompt full-suite attempt 1

- Commit: `3c20dd25b7d4f7a579b898c196b6370d0eb07d3b`
- Result: red; one unregistered test-harness failure.
- Failure: `StudioPage.dom.test.tsx` — `keeps batch generation available and explains an unreachable advisory fit`.
- Raw log SHA-256: `e1b48bda8a10ced125cb3be1333ae6945b7d091f704a9087492cc02c466b0703`
- Root-cause claim: the shared helper clicked the correctly disabled Fit button before the route catalog finished loading; the ignored disabled click left the bridge invocation at zero.
- Resolution: `6d4cca05628965bd041e9ec3a4693a7d11c1d2f5` waits for the existing enabled condition without increasing a timeout.
- Focused resolution log SHA-256: `2ef23f9a76ce25e05db1c069a95cc64760f72720b009d66cc47a297567c0da0e`.
- Later complete suites are retained, not replacements:
  - `6d4cca05628965bd041e9ec3a4693a7d11c1d2f5`: green, 630 files passed, 8,228 tests passed; raw SHA-256 `080f087b4e9d8710f49605a9a316ed159a86ffa26c0c54b3d897397e677560e8`.
  - `a14792b08b4098c2b4abc15f1e1f6391e72155f1`: green, 631 files passed, 8,241 tests passed; raw SHA-256 `746222bd7c9542842e6d2a75a1067ff4df31981b8b0bf3304a39ca8399c49942`.
  - `d878442010629b8e29685d59ed1132564b27ca01`: green, 632 files passed, 8,253 tests passed; raw SHA-256 `8cc0a6f0cddb1b55fc5c9abe7017ae80bfd58b1e433bfd79b1e20f472194345d`.
  - `1a00f5fa6f446c57475426d260b0ee1ad0d19410`: green, 632 files passed, 8,253 tests passed; raw SHA-256 `7b12d98890b6d35c7855dc9b8b598031d67b9f1586afb8782d85e92f47fdaca8`.

Required decision: inspect the failure, helper change, and ledger. If accepted, add a reviewer disposition with decision `accepted_test_fix`, rationale, reviewer identity, and UTC timestamp to attempt 1. Silence is not approval.

### AionCore retained and current full-suite attempts

- Superseded candidate `232456db3d2ade5933952f1463a5af977e135a15` retains a red/invalid first Nextest invocation because the PTY lost the failing test identity and output. It is not reclassified as green.
- Its recorded diagnostic invocation was green: 6,677 passed and 18 skipped; raw log SHA-256 `6441fc63c148afc3516b7d8b61a4e3fd7573e66d792a6e43723635078a37eea3`.
- Current candidate `e2931e953cbdfed146497e25ebf7bc3981b95193` has one complete exact-head invocation: 6,677 passed and 18 skipped; raw log SHA-256 `0781cf5b1884c130936f0ce2f0412f020687126937fcc1221d1ebf30809e4e53`.
- Current exact-head gates: format, workspace clippy with warnings denied, migration immutability, lineage, 31 release-script tests, macOS ARM64 release build, complete bundle verification, archive creation, fresh extraction, and extracted-bundle reverification are green.
- The local archive diagnostic retained a zero-byte premature archive and a create-only retry rejection before the separately named verified archive. Inspect `aioncore-build-attempts.json`; neither rejected artifact is eligible for release identity.
- No native Windows build evidence exists yet.

Required decision: inspect the retained invalid attempt, current single-run evidence, archive-attempt ledger, OfficeCLI pin, and write-permission scoping. Decide whether the current candidate is admissible for an authorization decision or requires a new source commit/gate run. Silence is not approval.

## Explicitly unresolved release blockers

- Native Windows x64 source, BUG-043 filesystem, packaged fail-closed, build, install, and content evidence are absent.
- AionCore tag/push/publish requires a separate release-owner authorization after independent review.
- `aioncore-v0.1.55.json` must be created only from independently downloaded published assets; it is intentionally absent.
- WePrompt cannot pin or package AionCore v0.1.55 until that verified handoff exists.
- BUG-017 remains P1 with runtime detection/recovery unbuilt. Only Conditional go or No-go is admissible unless it is implemented and accepted.
- Final installed-package acceptance and explicit release-owner decision have not occurred.

## Reviewer response template

```text
Reviewer:
Reviewed at (UTC):
WePrompt exact commit reviewed:
WePrompt attempt-1 disposition: accepted_test_fix | rejected
WePrompt rationale:
AionCore exact commit reviewed:
AionCore retained-attempt disposition: admissible_for_authorization | rejected
AionCore rationale:
Additional blockers/findings:
```
