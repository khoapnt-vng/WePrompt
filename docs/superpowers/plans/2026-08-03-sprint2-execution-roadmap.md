# Sprint 2 TODO Execution Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Sprint 2 issue register into independently shippable work, resolve the P0 upgrade blocker first, and prevent a partially implemented presentation pipeline from being described as delivery-ready.

**Architecture:** Work in isolated branches from the current `origin/sprint2`, with one merge request per independently revertible contract. Shared contracts land before runtime/UI consumers. The presentation feature remains disabled until its app-owned run, exact-hash gate, rendered review, and honest lifecycle are complete.

**Tech Stack:** Electron, strict TypeScript, Bun, Vitest 4, AionCore/SQLx SQLite migrations, OfficeCLI, Arco UI, i18next, electron-builder.

## Global Constraints

- Fetch first, then create every implementation worktree from `origin/sprint2`. Before editing, verify `git merge-base --is-ancestor 343b725c4 HEAD` exits 0; otherwise stop with `STALE_BASE`.
- Preserve the current dirty checkout and its untracked `TASKS.md`, `.agents/`, `.claude/e2e-locale-audit.raw.md`, `dashboard.html`, and `docs/design/wms-presentation-quality-incident.md`.
- Treat `origin/sprint2:TASKS.md` as the authoritative closed Sprint 1 history. Adopt the local Sprint 2 register through a dedicated documentation MR; do not overwrite or reopen BUG-001–BUG-012.
- MRs !51–!56 are merged Sprint 2 foundations. Reuse them; do not recreate their refactor work.
- Do not combine unrelated bugs in one commit or MR. A shared-contract MR may precede multiple consumer MRs.
- Use TDD for changed behavior. Before every implementation commit, run the focused tests and `bun run test`; before an MR, also run `just check` and `bun run test:coverage`.
- All changed user-facing text must use i18n keys in all 12 configured locales, followed by `bun run i18n:types` and `node scripts/check-i18n.js`.
- Do not test migrations or SQLite recovery against real user data. Use immutable artifact inventories, synthetic databases, or disposable copies.
- Do not push unless explicitly asked. When asked, use `just push`, never `git push`.
- `docs/superpowers/` is intentionally ignored. Do not force-add these planning files.

---

### Task 1: Establish the tracked Sprint 2 contract

**Files:**

- Modify in a dedicated documentation branch: `TASKS.md`
- Reference: `docs/design/wms-presentation-quality-incident.md`

- [ ] Fetch `origin`, create a fresh worktree from `origin/sprint2`, and pass the ancestry check above.
- [ ] Merge the Sprint 2 register above the preserved closed Sprint 1 entries; correct stale `origin/sprint1` statements to `origin/sprint2` evidence and keep BUG-017 labeled as an investigation until reproduced.
- [ ] Add BUG-018 and retain the EPIC-001 release boundary: no default presentation path until grounding, canonical routing, deterministic gating, rendered review, and readiness UX are all present.
- [ ] Mark !51–!56 as completed foundations rather than open TODOs.
- [ ] Run `bunx oxfmt --check TASKS.md docs/design/wms-presentation-quality-incident.md` and commit only the documentation files with `docs(sprint2): adopt verified work register`.

### Task 2: Run Wave 1 in parallel

These work items do not share runtime code and may proceed in separate worktrees:

| Lane | Plan | Exit condition |
| --- | --- | --- |
| Release blocker | [BUG-013 schema compatibility](2026-08-03-bug013-aioncore-schema-compatibility.md) | Every declared predecessor is a checksum-identical prefix of the selected target, or the release is explicitly blocked. |
| Packaging | [BUG-014 packaging and handoff](2026-08-03-bug014-packaged-template-handoff.md) Task 1 | The package build fails if any of the exact eight binary references is absent. |
| UI quick fix | [BUG-016 thinking fallback](2026-08-03-bug016-thinking-fallback.md) Task 1 | Missing/unsafe Kimi subjects render localized activity without exposing reasoning content. |
| Reliability | [INV-017 SQLite access investigation](2026-08-03-inv017-sqlite-access-investigation.md) | Destructive recovery remains impossible for generic SQLite code 14; one-day matrix yields a repro or a bounded evidence report. |

- [ ] Assign one owner per lane and record its branch, MR, and evidence link in the tracked `TASKS.md` entry.
- [ ] Do not let packaging/UI completion override the BUG-013 release hold.

### Task 3: Run Wave 2 after the relevant Wave 1 contracts

- [ ] Complete BUG-013 target selection, binary provenance, package gate, and disposable upgrade smokes. Do not ship if the lineage validator says `incompatible`.
- [ ] Complete BUG-014 initial-message handoff only after its packaging inventory is merged.
- [ ] Implement the first EPIC-001 slice from [the presentation plan](2026-08-03-sprint2-presentation-artifact-quality.md): app-owned lifecycle, private staging, fail-closed grounding, exact-hash deterministic gating, and minimal non-ready recovery UX behind `PRESENTATION_RUN_V1_ENABLED = false`.
- [ ] Confirm the first EPIC-001 slice stops at `Rendered exact hash`, returns `REVIEW_REQUIRED`, blocks WePrompt download/delivery, and leaves **Open in system app** as recovery only.

### Task 4: Run Wave 3 contract-first runtime fixes

| Order | Plan | Dependency rule |
| --- | --- | --- |
| 1 | [BUG-018 provider failure contract](2026-08-03-bug018-provider-failure-contract.md) | Canonical envelope before health, App Operations, and conversation consumers. |
| 2 | [BUG-015 token usage accounting](2026-08-03-bug015-token-usage-accounting.md) | Occupancy/consumption types and ledger semantics before AionRS/ACP adapters and UI. |
| 3 | Presentation canonical routing | BUG-014 packaging must be present; route template and explicit no-template PPTX requests through the same app-owned run. |

- [ ] Keep BUG-018 structured-category mapping independent from BUG-017 local-data failures.
- [ ] Stop BUG-018 rather than parsing human-readable provider messages if AionCore does not emit the canonical failure field.
- [ ] Stop the ACP part of BUG-015 rather than deriving per-turn consumption from a context occupancy snapshot when no canonical event exists.

### Task 5: Run Wave 4 presentation quality release

- [ ] Implement rendered visual QA, bounded repair cycles, and structured review evidence from the presentation plan.
- [ ] Implement the complete lifecycle UI: `Preflight → Grounded → Planned → Generated → Validated → Gated → Rendered exact hash → Reviewed → Delivery ready`.
- [ ] Enable default presentation routing only after canonical routing, visual QA, exact-hash review, and download/delivery enforcement are merged and verified together.
- [ ] Verify template and no-template PPTX flows in existing AionRS/ACP conversations and Guid first-send; keep DOCX behavior outside this epic.

### Task 6: Release verification and closeout

- [ ] From a clean worktree at the proposed release commit, run:

```bash
just check
bun run test
bun run test:coverage
```

- [ ] Build the packaged app and run the platform matrix required by BUG-013 and BUG-014 on macOS ARM, macOS Intel, and Windows using disposable profiles.
- [ ] Record exact artifact hashes, AionCore version/provenance, predecessor lineage IDs, test counts, skipped tests, and platform results in the release evidence.
- [ ] Close only issue IDs whose acceptance evidence is attached. Leave unreproduced INV-017 findings as investigation results, not a claimed product fix.

## Suggested Sprint Commitment

- **Committed:** BUG-013, BUG-014, BUG-016 Task 1, and INV-017 safety/reproduction work.
- **Parallel foundation if separately staffed:** EPIC-001 app-owned staging/grounding/exact-hash slice, kept feature-flagged and non-ready.
- **Next contract wave:** BUG-018, then BUG-015.
- **Follow-on release:** canonical no-template presentation routing, rendered visual QA, bounded repair, complete readiness UX, then feature enablement.

## Final Acceptance

- A schema-incompatible AionCore build cannot pass packaging or release gates.
- Missing packaged templates fail the build; first-send payloads are removed only after successful execution.
- Missing usage is never displayed as authoritative zero, and occupancy is never summed as turn consumption.
- Missing/unsafe thinking subjects remain visibly active without automatically exposing reasoning content.
- Provider overload, quota, setup, connectivity, and general failures remain distinct through every consumer.
- SQLite code 14 never authorizes database deletion or rebuild.
- No presentation candidate is labeled or delivered as ready before exact-hash visual review and app-owned publication.

