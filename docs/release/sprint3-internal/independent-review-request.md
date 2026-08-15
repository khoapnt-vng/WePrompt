# Sprint 3 internal RC independent review request

Status: **review required; not authorized to publish or package**

## Immutable review targets

- WePrompt executable candidate: `a14792b08b4098c2b4abc15f1e1f6391e72155f1`
- WePrompt evidence commit: `2d73aa55cc941fae4db97cea355e6a7fe309b454`
- WePrompt approved base: `634f49c21567d9bd987b04887eaa0c6126b86353`
- AionCore candidate: `232456db3d2ade5933952f1463a5af977e135a15`
- AionCore approved base: `9bd693b3b43cdb1003061de0e4f62259ab6f42ae`
- Intended AionCore version: `v0.1.55` (not tagged or published)

Review the exact commits, not branch names. Neither release branch has been pushed by this execution wave.

## Scope assertions to verify

1. WePrompt descends from the approved Sprint 3 base without wholesale `main` integration.
2. Creative Studio, auto-update, and Sentry are fail-closed for `WEPROMPT_INTERNAL_RELEASE=1`.
3. The manual RC workflow accepts one exact 40-character commit, runs Windows x64 first, and permits only Windows x64 plus macOS ARM64 unsigned candidates.
4. Missing native Windows evidence is a no-go; macOS cannot waive it.
5. AionCore bundles contain the exact backend binary, immutable migration lineage, complete managed resources, and pinned OfficeCLI for only the two approved targets.
6. The package verifier rejects backend/hash/target drift, missing OfficeCLI/templates, a second runtime, and enabled excluded features.
7. No AionCore tag, push, GitHub release, WePrompt workflow trigger, or desktop distribution has occurred.

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

Required decision: inspect the failure, helper change, and ledger. If accepted, add a reviewer disposition with decision `accepted_test_fix`, rationale, reviewer identity, and UTC timestamp to attempt 1. Silence is not approval.

### AionCore full-suite attempt 1

- Candidate: `232456db3d2ade5933952f1463a5af977e135a15`.
- First Nextest invocation: red/invalid evidence because the PTY lost the failing test identity and output. It remains retained and is not reclassified as green.
- Recorded diagnostic invocation: green, 6,677 passed and 18 skipped; raw log SHA-256 `6441fc63c148afc3516b7d8b61a4e3fd7573e66d792a6e43723635078a37eea3`.
- Other exact-head gates: format, workspace clippy, migration immutability, lineage, 30 release-script tests, macOS ARM64 release build, and complete bundle smoke are green.
- No native Windows build evidence exists yet.

Required decision: inspect the retained invalid attempt and the durable diagnostic evidence. Decide whether the candidate is admissible for an authorization decision or requires a new source commit/gate run. Silence is not approval.

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
