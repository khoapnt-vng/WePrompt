# Creative Studio 3 — the Director as first responder

> Owner direction, 2026-08-27: _"You took a lot of actions to drive our testing. How many of that
> can we teach the Director? He should be able to troubleshoot."_
>
> This document answers with an inventory. On 2026-08-26 an operator drove four films end to end
> through the renderer bridge and performed **fourteen distinct kinds of troubleshooting action**.
> Each is classified below against the Director's real surface — the frozen capability table in
> `directorCommandContracts.ts` and the typed Studio MCP surface — into what it can already do,
> what it should be granted, what it may only propose, and what it must never do.

## The charter in one line

**Diagnose freely · repair freely when the repair is free · propose when it costs · never confirm
its own spend.** This is the owner's spend-governance ruling applied to recovery: the confirmation
that guards money stays with the human; everything that guards nothing should not wait for one.

## The inventory

| #   | Action performed on 2026-08-26                                      | Verdict                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Diagnose a dead runtime (quarantine emptying `supportedProjectIds`) | **Product's job.** BUG-127's fix now names the cause. Owner-level; the Director cannot and need not see other projects.                                                                                                           |
| 2   | Read route/selection state per project                              | **Already can** — `studio_list_routes`.                                                                                                                                                                                           |
| 3   | Select engines (`set_routes`)                                       | **Stays owner.** Spend steering; `operation_not_permitted` is correct.                                                                                                                                                            |
| 4   | Fix a target-duration mismatch (`edit_project`)                     | **Gap.** Not permitted _and no proposal path exists_, so the Director cannot even suggest fixing a mismatch it detects itself (18s target vs its own 30s plan). Recommend: proposal disposition for the editable settings.        |
| 5   | Author a storyboard when the conversation stalls                    | **Already can** (`proposal`). It falsely believes otherwise — BUG-139; a rules fix, not a grant.                                                                                                                                  |
| 6   | Bind references per Shot; repair over-budget bindings               | **Already can** — `set_shot_reference_binding` is `direct`. Teach the rule it violated: `maxConditioningImages` counts characters **and** background together.                                                                    |
| 7   | Rewrite a reference prompt after a grid and regenerate              | **Split.** Requesting generation exists (`studio_request_reference_images`); editing the prompt is `operation_not_permitted`. Recommend proposal disposition for `set_reference_prompt`; generation itself is spend → propose.    |
| 8   | Seed chain heads (`seed_still`)                                     | **Propose-quote.** Paid; Director prepares, owner confirms.                                                                                                                                                                       |
| 9   | Submit chains base+cascade (incl. the undocumented base-cap of 4)   | **Propose-quote.** Same. Teach the shape rules: chained beat = 1 base + followers; heads need seeds; base choices cap at 4.                                                                                                       |
| 10  | Retry a failed continuity frame (free, 5-for-5 first attempt)       | **Grant.** Free, local, idempotent. Mostly obsolete since `4e56f8f6f` auto-retries with a bounded count — the residual case is exhaustion, and that is precisely when a first responder should look before the owner is bothered. |
| 11  | Terminalize a refused submission (`retryJob`), then resubmit        | **Split.** Terminalizing a _refused_ job is free and safe → grant. A _submission-unknown_ job requires the duplicate-charge acknowledgement → owner. The resubmit is spend → propose-quote.                                       |
| 12  | Hard cut + reseed after `content_rejected`                          | **Propose-quote.** `set_hard_cut` stays denied; the `continuityChange` prepare shape prices the consequence, which is exactly what a proposal should carry. The BUG-123 "cancel and review rejoin" flow is the pattern.           |
| 13  | Image forensics (grid seams, frame brightness, file probes)         | **Product's job.** BUG-132's reopened fix direction puts repetition detection in the engine, where it runs on every image — not in an agent that has to think to look.                                                            |
| 14  | Monitor job / extraction / failure states across a film             | **The missing read.** The Director has no visibility into any of it. This is the single grant that unlocks the rest.                                                                                                              |

**Score: 3 already possible (2, 5, 6) · 1 rules fix (5/BUG-139) · 3 free grants (10, 11a, 14) ·
5 propose-quote (7b, 8, 9, 11b, 12) · 3 stay with product or owner (1, 3, 13) · 1 disposition gap (4, 7a).**

## What to build

1. **Implemented and verified 2026-08-28 — `studio_get_project_status(detail: true)`, the diagnosis
   read.** It returns per-Shot status and current media, the latest job with its **cause-specific
   error code**, extraction states including `failed`/exhausted, and active quotes. Everything in
   it already crosses the IPC boundary for the workspace; this is a read, not a power.
2. **Implemented and verified 2026-08-28 — free recovery operations, dispositioned `direct`:**
   `retry_conditioning_frame` and `terminalize_refused_job` (refused shape only — no
   `providerJobId`, no job `spendReceipt`; the submission-unknown shape keeps its owner-only
   acknowledgement). The dedicated singleton `studio_apply_free_fix` command accepts only those
   two typed operations, rederives an exact fresh `studio_get_project_status(detail: true)` remedy
   in Main, and requires tagged commit attribution before reporting success. Neither path creates
   a quote, authorization, job, generation request, or spend; conditioning recovery can only
   resume work that the owner already authorized. Both were verified free and deterministic
   across every occurrence on 2026-08-26.
3. **Recovery proposals that carry a prepared quote.** The proposal card pattern exists; extend it so
   the Director can attach a prepared (free) quote — "Shot 4's seed was refused by the content
   filter; rejoining costs $1.23 — Confirm / Reject." The owner's Confirm remains the only spend.
   This composes with the "show the estimate" assignment: same principle, the number arrives before
   the permission question.
4. **Proposal dispositions for `edit_project`'s editable settings and `set_reference_prompt`** — the
   two places the Director can diagnose a defect it is forbidden even to propose fixing.
5. **Teach the rules it broke or missed, in its rules text:** the conditioning budget (item 6), the
   chain shape rules (item 9), and its own capability table — generated from
   `STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2`, per BUG-139's fix direction, so self-description
   cannot drift again.

## What not to build

- **No autonomous spend, ever.** Not retries that re-render, not "small" seeds. The 2026-08-26 run
  put real numbers on why the propose-quote split is right: every free recovery succeeded first try,
  and every paid mistake (a re-rendered head, a duplicate charge risk) was the kind a human should
  see a number for first.
- **No forensics in the agent.** Detection that should run on every image belongs in the pipeline.
- **No cross-project reach.** The Director's blast radius stays one project.
- Honest scope note: **the best troubleshooter is the pipeline.** Half of what was done by hand on
  2026-08-26 was made obsolete the same night by `4e56f8f6f` (extraction-on-completion, bounded
  auto-retry). The Director is the responder for the residue — exhaustion, refusals, content
  rejections — not a substitute for fixing failure classes at the source.
