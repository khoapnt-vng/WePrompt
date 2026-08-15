# Sprint 3 Internal Release Evidence

This directory is the tracked evidence index for the unsigned WePrompt Sprint 3 internal release. The approved desktop targets are exactly macOS ARM64 and Windows x64. Distribution is manual; this release has no signing, notarization, Sentry release upload, update feed, or auto-update publication.

Creative Studio is excluded from this release and must remain disabled at build and runtime policy boundaries. The source remains in the repository behind its feature flag; exclusion does not authorize removal or a Creative Studio branch merge.

## Evidence files

- `baselines.md` records immutable WePrompt and AionCore source observations. Later remote movement does not change an accepted baseline.
- `selected-fix-audit.md` records the disposition and evidence for every named later WePrompt fix. A branch or commit name alone is not evidence.
- `aioncore-v0.1.55.schema.json` defines the closed handoff-record shape for exactly two published AionCore assets.
- `aioncore-v0.1.55.json` is created only from independently downloaded and verified published assets. It does not exist until AionCore Task 8 is authorized and complete.
- `aioncore-test-attempts.json`, `aioncore-build-attempts.json`, and `aioncore-source-gates.json` retain ordered local backend diagnostics, including red attempts and their dispositions.
- `source-gates.json` and `full-suite-ledger.json` will bind WePrompt gate results to one exact RC commit and retain every full-suite attempt.
- `artifact-index.json` will bind the two final unsigned desktop packages to one WePrompt RC and one accepted AionCore release.
- `acceptance-matrix.md` defines the four mandatory Windows entry gates and the twelve ordered packaged scenarios for both targets.
- `evidence-index.schema.json`, `create-evidence-index.js`, and `validate-evidence-index.js` define and enforce the sanitized packaged-evidence packet. A static valid fixture lives under `tests/fixtures/release/`.
- `known-issues.md` records the explicit BUG-017 P1 disposition and preservation-first operator response.
- `installation.md` documents hash-first installation and removal without weakening host security or deleting user data.
- `go-no-go.md` is the unsigned owner-decision record. It contains no preselected decision.

## Invalidation rules

Any source change creates a new WePrompt RC SHA and invalidates packages built from the prior SHA. Changes to the backend record, migration lineage, package lock, release configuration, workflow, toolchain, packaging scripts, or AionCore assets invalidate all affected evidence and packages. Platform-specific changes invalidate that platform and any shared gate they touch.

Evidence silence is not approval. A red run remains part of the record after a later green run, and no release decision is implied by a branch name, local artifact, or unreviewed document.
