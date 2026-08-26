# Creative Studio 3 — the Beat panel shot composer

> Designer handoff received 2026-08-26 evening. Three files are committed beside the plan and are
> the authority for anything this document paraphrases:
>
> - **Handoff notes** — `docs/prds/creative-studio/creative-studio-3-beat-panel-composer-handoff.md`
>   (the designer's own README, verbatim)
> - **Beat Panel Composer** — `docs/prds/creative-studio/creative-studio-3-beat-panel-composer.html.txt`,
>   sha256 `c1875fae52a9e604…85c3b488`
> - **Shot Composer States** — `docs/prds/creative-studio/creative-studio-3-shot-composer-states.html.txt`,
>   sha256 `f879f1cf53f0424f…9db04e6b`
>
> The designer states the fidelity is **high** — "colours, type, spacing, radii and copy are final
> unless design says otherwise" — and that the HTML is a reference to recreate with WePrompt's
> existing components, not code to copy. Both files open offline.
>
> This document records what the handoff asks for, what it **conflicts with**, and what **cannot be
> built on the current stack**. It is not a restatement of the README; read that for exact values.

## 1 · Read this first — the handoff supersedes work already shipped

This is the **same surface** as the First Frames panel handoff captured earlier the same day. The
designer's own README names its sources as `First Frames Panel - Hi-fi.dc.html` and
`First Frames Panel - States.dc.html`, so this is that design's next revision.

**Codex has already implemented the earlier one** (`42473b5a2 feat(studio): implement First Frames
panel`). This revision is not a restyle of it — it changes the data model:

| | First Frames (built) | Beat Panel Composer (this handoff) |
| --- | --- | --- |
| Frames region | an **open list** of candidate stills, horizontally scrolling, N per Shot | **three fixed slots**: start frame, end frame, image refs |
| Which one is used | newest eligible is current; **pin** holds it | the **start** slot is the input, by position |
| Height behaviour | fixed 178px band, strip scrolls sideways | three equal cells, region height constant "whatever is filled" |
| Status words | **four** | **six** (adds `QUEUED`, `FAILED`) |
| Beat-level action | none | **`Generate all 3 · chained`** above the shot strip |

This apparent conflict is resolved by the owner's ruling below (§1a): the slot geometry is adopted
as the **view**, and the shipped list-with-pin remains the **model**. §2 "Current vs pinned" in
[the First Frames panel doc](creative-studio-3-first-frames-panel.md#2--current-vs-pinned--read-this-before-implementing)
is **re-confirmed**, not retired. (That is §2 of the design doc, *not* owner ruling 2 — the
staleness tag — which this handoff leaves unaffected.)

## 1a · Owner ruling, 2026-08-26 night — slots are the view, the list is the model

The owner's direction: **preserve as much of the shipped implementation as possible, improve the
UX, and make the panel serve both flows equally — chaining a whole Beat, and generating shots one
at a time.** The reconciliation that satisfies all three:

**The three-slot card is adopted as the shot's at-a-glance surface. The START slot _displays_ the
shot's effective start frame — computed exactly as today** (`effectiveSeed`, `chain.ts:104`: the
pinned `seedStillId` wins, else the newest eligible asset, else the inherited predecessor frame).
**Clicking the slot opens the candidate picker, which is the shipped First Frames band re-parented**
— the same open list, the same newest-is-current default, the same pin-to-hold, the same import
tile, the same full-screen viewer. Nothing in the store changes: `seedStillId`, `assetIds`
eligibility, `referenceBinding` and extraction records all keep their meanings and their tests.

What this preserves of the shipped work: the entire model layer, the projection, the full-screen
viewer, the prompt-as-fired rule, import plumbing, and every main-side test. What gets rebuilt is
renderer-only: the always-visible band becomes the slot's picker, and the card takes the eight-row
composer layout. (The alternative — keeping the band always visible under the slots — was
considered and declined: the handoff's fixed-height rationale is sound, and the band survives
intact one click away.)

The other two slots follow the same view-over-model principle:

- **END** — inert placeholder per the earlier ruling in §2 below; lights up when the bound route
  reports last-frame support.
- **REFS** — a view of the existing `referenceBinding`, showing the live `count / limit` budget
  (the BUG-134 counter Codex has since shipped); clicking opens the existing binding editor.

### Both flows, one mechanism

Flexibility between chain-the-Beat and one-shot-at-a-time is not a mode switch; it falls out of the
START slot telling the truth for follower shots:

| START slot shows | Meaning | Serves |
| --- | --- | --- |
| the frame, badge `FROM SHOT N` | predecessor rendered, extraction ready | either flow — the shot is independently generatable |
| `ARRIVES WHEN SHOT N FINISHES` | healthy queue behind an in-flight predecessor | the chain flow (composer state 07 as drawn) |
| `START FRAME FAILED` + a **Fix — free** button | extraction failed and auto-retry exhausted its bounded attempts | both — recovery is `retry-conditioning-frame`, measured free and reliable |
| a pinned or imported still | a deliberate **hard cut** — priced through the `continuityChange` prepare shape | one-at-a-time, intentionally breaking the chain |

Because every successful take now **atomically creates its endpoint extraction** (BUG-133's fix,
landed in `4e56f8f6f`), shots rendered one at a time compose into chains after the fact, and a
chain can be entered or left per-shot. Rendering Shot 1 alone immediately gives Shot 2 a real
`FROM SHOT 1` start frame; pinning a fresh still onto Shot 4 mid-Beat cuts the chain there, priced,
and the chips show the cut.

### The dead chain wears FAILED, and the button differentiates

This resolves the queue-state blocker without breaking the handoff's six-word rule. A chain whose
start frame will never arrive is not `QUEUED` — that label would lie — it is **`FAILED`**, which is
honest ("the chain stopped here" is the handoff's own framing for state 08). The **button carries
the state**, per the handoff's own principle: a conditioning-frame failure gets **`Fix start frame —
free`** (one click, no spend, no re-render); an engine failure keeps **`Try again`** (a paid
re-render). The tag beside the button distinguishes them the same way: `START FRAME FAILED ·
RECOVERY IS FREE` versus `NOTHING WAS CHARGED`. With BUG-137's bounded auto-retry landed, the free
case should now be rare — the state exists for retry exhaustion, and for the honesty of never
showing a permanent wait as a queue.


## 2 · The end frame — owner ruling: build the slot now as a placeholder

**Owner ruling, 2026-08-26:** *"Use the End slot as a placeholder now. With Seedance 2.5 or MiniMax,
we will have that capability."* Build the three-cell geometry as drawn, with the end slot present and
inert, and light it up when a capable model is bound. The recommendation this section originally
carried — omit the slot — is withdrawn.

**What does not exist today**, recorded so the placeholder is built honestly rather than discovered
to be dead later:

- **No schema field.** A Shot carries `seedStillId`, `chainBreak`, `trimInSeconds`, `trimOutSeconds`,
  `referenceBinding`, `assetIds`, `videoAssetId` and the superseded lists. There is no `endFrame`,
  `lastFrame` or equivalent anywhere in `creativeStudioTypes.ts`.
- **No adapter path.** `openRouterVideoAdapter.ts:676` sends exactly one frame and hardcodes
  `frame_type: 'first_frame'`. There is no last-frame request shape.
- **No provider capability read.** `openRouterVideoAdapter.ts:363` derives `supportsFirstFrame` from
  the provider catalogue's frame list; only `first_frame` is ever consulted, and the gate is narrowed
  further by `MANAGED_FIRST_FRAME_MODELS`, which today contains a **single** model:
  `bytedance/seedance-2.0`.
- **The route says so at runtime.** The bound video route reports `maxConditioningImages: 0` with
  `supportsFirstFrame: true` — one conditioning frame, at the start, nothing else.

### What "placeholder" has to mean here

The states board deliberately teaches that **a filled slot changes the run** — state 03's footnote is
`END FRAME SET · THE SHOT HAS TO LAND ON THAT PICTURE`. A placeholder that accepts an image and
silently ignores it would therefore teach a falsehood, and would be the more expensive kind of bug:
the user pays for a take that lands wherever the model chose, having been told it would land on their
picture.

So the slot ships **visible and clearly not yet active**:

1. **Render the third cell** in the three-across grid so the region keeps its height and the layout
   matches the handoff.
2. **Do not accept an image into it** while the bound model cannot honour one — or if it accepts one,
   never present that image as affecting the run.
3. **Say why, once, in the slot**: the end frame needs an engine that supports it, and the bound
   engine does not. Name the condition, not the model, so the copy survives a new binding.
4. **Suppress state 03's footnote** until the capability is live. `END FRAME SET · THE SHOT HAS TO
   LAND ON THAT PICTURE` must never appear while the run cannot honour it.
5. **Gate on capability, not on a model list.** The unlock condition is the bound route reporting
   last-frame support, read the same way `supportsFirstFrame` already is. Hard-coding
   `seedance-2.5` or a MiniMax id repeats the `MANAGED_FIRST_FRAME_MODELS` pattern and will need
   editing for the model after that.

### What lighting it up will take

When a capable model is bound, this is not a UI change — it is a schema field, an adapter request
shape carrying a second frame with its own `frame_type`, a capability read for last-frame support,
validation and quoting for the new input, and a decision about what happens when a Shot with an end
frame is re-bound to a model that cannot use one. Worth scoping as its own task rather than folding
into the composer build.

## 3 · The handoff contradicts itself on the status vocabulary

The **states board** and the README both specify **six** words — not ready, ready to render, queued,
rendering, rendered, failed — and the board renders all eight cards against them.

The **panel prototype** still carries the previous rule, annotated in its own margin:
*"SHOT STATUS · FOUR WORDS — Not ready. Ready to render. Rendering. Rendered. Nothing else appears
in the slots."*

Take the **six**, since the README is the newer authority and the states board implements it. The
panel prototype's annotation is stale; flag it back to design so the two files agree.

## 4 · What is verified true — and what the run data contradicts

This handoff is unusually checkable, because the same behaviours were exercised across six real
projects on the same day. Recorded so nobody re-derives it.

**Confirmed correct.**

- **`NOTHING WAS CHARGED` on failure (state 08).** True and worth keeping. Every failed job observed
  across four films — provider 5xx, content refusal, `dependency_failed` — carried **no**
  `spendReceipt`. The copy is honest.
- **`THE CHAIN STOPPED HERE` (state 08).** Matches the real cascade: a failed Shot propagates
  `dependency_failed` to its followers, which is exactly "the chain stopped here".
- **Prompt-as-fired rule.** Already the owner-settled rule from the First Frames handoff and
  unchanged here.

**Contradicted by observed behaviour — the queue state is not always temporary.**

State 07 says a chained Shot waits with empty slots and that
**`START FRAME ARRIVES WHEN SHOT 1 FINISHES`**. That is the happy path. In practice the start frame
sometimes **never arrives**: the predecessor's endpoint extraction fails, is skipped by the resume
path, and the Shot waits permanently (**BUG-137**; measured **5 failures in 70 extractions**, with
three of six Beats affected in a single film). A separate failure mode strands the chain when a head
is rendered alone and no extraction is ever created (**BUG-133**).

The design as drawn has **no state for "the start frame will never arrive"**, and `QUEUED` is
indistinguishable from it — which is how both defects went unnoticed until a Beat panel was opened
by chance. **Resolved in §1a:** the dead chain wears `FAILED` with a `Fix start frame — free`
action. Since this was written, both pipeline defects were fixed (`4e56f8f6f`): extractions are
created atomically with every successful take and auto-retried with a bounded attempt count, so the
state now covers retry exhaustion rather than a routine occurrence.

**Unavailable on the current route.**

State 04 draws `RENDERING · 40%`. `openRouterVideoAdapter` returns bare `{status:'queued'}` /
`{status:'running'}` with no progress; only `mediaGatewayAdapter` parses 0–100. Render the
percentage **when present** and a determinate-free state otherwise, as already recorded for the
First Frames panel.

## 5 · The designer's open question, answered from run data

> *"Does chaining skip already-rendered shots or re-run the whole beat?"*

Today it **re-runs, and it charges.** Re-authorising a chain whose head is already rendered prices
the head again — measured at 60 minor units per 12-second take — because `estimate.ts:688-703`
admits a base `video_take` only if a seed or the **predecessor's take is authorised in the same
request**, or a ready extraction already exists. Recovering three stranded chains this way cost
**$1.80** in repeat renders of Shots that had already succeeded, and each re-render replaces a take
the owner had already reviewed.

**Recommendation: chaining should skip Shots that are already rendered and current**, running only
the gaps, and `Generate all 3 · chained` should say how many Shots will actually run and what it will
cost before it is pressed. The machinery to do it exists — a ready extraction already satisfies the
admission test — so this is a pricing-path change, not new capability.

## 6 · Smaller notes for whoever builds it

- **The `✕` between chips** — "remove the join between shots" — is `set_hard_cut`. It is
  `operation_not_permitted` for the Director (`directorCommandContracts.ts`), so it is an
  owner-only control, and there is a dedicated `continuityChange` prepare shape
  (`{ shotId, hardCut, requiresSeedGeneration }`) that prices the consequences. Use that rather than
  a bare mutation; breaking a join can require a new seed and re-renders.
- **`Generate all 3 · chained` stays within limits.** A chained beat is one base choice plus its
  followers, and `STUDIO_MAX_SHOTS_PER_BEAT` is 8, so the request is 1 base + up to 7 cascade. Note
  separately that **base choices are capped at 4** — a limit with no named constant that reports
  `invalid_prepare_request` — which does not bite chaining but does bite any multi-head submission.
- **Image refs are capped at two conditioning images total**, counted across characters **and**
  background (`maxConditioningImages: 2` on the image route). A `REFS 2` badge plus a background
  binding is already at the limit; the slot UI should show the budget rather than let the user
  discover it in an error (**BUG-134**).
- **Prototype durations are 4s** (`4S PLAN`); the shipped minimum is `STUDIO_MIN_SHOT_SECONDS = 4`
  and the maximum 15, so the drawn value is legal but is not a default to copy.
- **Panel width is 1320px**, matching the First Frames handoff and the same open question: the
  shipped Beat panel is `min(1100px, calc(100vw - 32px))`. Owner ruling 5 in the First Frames doc
  already moved the cap to 1320; this handoff assumes that ruling has landed.

## 7 · What this does not change

Spend governance is untouched. `Generate Shot N`, `Regenerate`, `Try again` and
`Generate all N · chained` all enter the existing prepare/confirm quote path. Filling a slot,
pinning, removing a join and editing a prompt remain free. `Cancel run` and `Stop the chain` must
not be able to spend.
