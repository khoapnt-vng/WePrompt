# Sprint 3 Internal Release Decision

No decision is preselected. Complete this record only after the held artifact index, full-suite ledger, independent reviews, native package evidence, and `evidence-index.json` are complete and mutually consistent.

## Immutable candidate identity

| Item                        | Exact value                           |
| --------------------------- | ------------------------------------- |
| WePrompt commit             | _Pending final held package identity_ |
| AionCore version            | `v0.1.55`                             |
| AionCore commit             | _Pending authorized published record_ |
| Windows x64 package SHA-256 | _Pending held artifact index_         |
| macOS ARM64 package SHA-256 | _Pending held artifact index_         |
| Artifact-index SHA-256      | _Pending held artifact index_         |
| Evidence-index SHA-256      | _Pending completed acceptance packet_ |

Do not substitute a branch name, tag name, local path, or verbal confirmation for an exact hash.

## Required release-owner checks

- [ ] Independent AionCore review is complete, and publication of the exact reviewed commit was explicitly authorized before its tag/assets were used.
- [ ] Independent WePrompt review is complete, including every retained red full-suite attempt and its disposition.
- [ ] The full-suite ledger validates on the exact packaged WePrompt commit; a later green did not erase an earlier red.
- [ ] `artifact-index.json` contains exactly Windows x64 first and macOS ARM64 second and remains `held_not_approved` until this decision.
- [ ] All four native Windows entry gates passed before macOS acceptance began.
- [ ] All scenarios except the explicit BUG-017 disposition passed on both installed packages.
- [ ] Creative Studio, auto-update, update publication, and Sentry release behavior are absent/disabled.
- [ ] The evidence packet contains no credentials, authentication headers, user-home paths, or unsanitized customer data.
- [ ] Distribution remains internal, unsigned, and manual.

## Decision rules

Choose exactly one:

- **Go** — permitted only if BUG-017 runtime classification and recovery are built and accepted (`bug017RuntimeRecoveryBuilt: true`) and every required gate and scenario passes on both targets.
- **Conditional go** — permitted only if BUG-017 alone is blocked because recovery remains unbuilt, all other evidence passes, and the owner explicitly accepts the P1 residual risk and preservation-first response in this record.
- **No-go** — required for any other failed/blocked item, identity mismatch, missing native Windows evidence, missing independent review, unclassified full-suite failure, destructive BUG-017 result, absent owner acceptance, or evidence inconsistency.

Silence and an unsigned decision record are not approval. Creating this file, building packages, or moving artifacts does not authorize distribution.

## Owner decision

Decision (`Go`, `Conditional go`, or `No-go`):

Residual-risk statement (required for Conditional go):

Approved internal audience and distribution location:

Release owner name:

Release owner signature/record reference:

Decision UTC timestamp:

Evidence packet location and SHA-256:
