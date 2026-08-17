# Phase 3a plan — review

Reviewed against `feat/creative-studio-2` @ `28e66a222`. Claims checked against the tree.

**Verdict: approve the mechanism and the gates; change one type decision; and put one strategic
question to the owner that the plan currently answers by constraint rather than by decision.**

The plan is accurate. Every file it names exists, every symbol it assumes exists, `common/types/project`
does hold 12 children so adding none is right, the 30 MB budget is real, and **Task 1's premise is
exactly correct** — `StudioRendererJob` explicitly omits `'outputRole'` and `sanitizeJob` contains
zero references to it, so both whitelists drop it as claimed.

It also absorbed the `tsc`-does-not-typecheck-tests finding from the S1.5 review and applies it
correctly. That is the right instinct, and it makes the one type decision below more surprising.

---

## 1. Strategic — the plan forecloses the question that was open, by constraint

Global Constraints say: _"Do not add Seedance/OpenRouter direct multi-reference video input… or a
generic direct/fallback mode switch."_ That defers the exact thing that might make the still stage
unnecessary on our live route, and it is stated as a given rather than as one of the nine decisions
put up for approval.

Provider neutrality is a real product value and the two-stage still works on every route, so this is
a **defensible** answer. But it is an answer to _"is 3a the right shape at all?"_, and the owner
should choose it knowingly rather than inherit it from a constraints list. The nine lean decisions
all concern reference-management detail; none is _"build the still stage even where the video engine
accepts references directly."_

### The argument the plan should be making

Provider neutrality is the weaker half of the case. The stronger one is **composition with 3b**, and
the plan does not state it:

- The still stage puts a clip in **`first_frame` mode**. Phase 3b's chain — clip 2 starting from clip
  1's last frame — **is** `first_frame` mode. Same mechanism, so they compose end to end:
  still → clip 1 → chain → clip 2 → clip 3.
- Direct references put a clip in **multi-reference mode**, which is mutually exclusive with
  `first_frame`. The moment you want chaining you have to leave that mode anyway.

So the trade is not "neutral but expensive versus specific but cheap". It is that **the cheap path
does not extend into the next phase and the expensive one does**. Building direct references first
would mean building a mechanism 3b then has to switch out of.

The honest cost of the recommended answer, stated plainly so nobody rediscovers it: **two paid calls
per shot where one might do** — roughly 60 rather than 30 provider calls for a nine-section project
at 3–4 clips each — and a still that is an image model's interpretation of the cast rather than the
cast photographs themselves.

**Ask for that decision explicitly.** If the answer is yes, everything downstream in this plan
stands unchanged — and the reason is recorded, so it is not re-litigated in three weeks by someone
who notices the doubled call count.

## 2. Type — make `StudioRouteConstraints.maxConditioningImages` optional, not required

The plan makes the connection-level field optional (`maxConditioningImages?`) and the route-level
field **required**, then spends a whole step (Task 4 Step 4) manually repairing fixtures because
`tsc` cannot find them.

**34 files construct route constraints.** None is typechecked. A required field there is the single
largest silent-breakage surface in the slice, and it is protected only by a grep and an implementer's
diligence.

Optional with `?? 0` at read sites gets the same truthfulness — the plan already rules that absent
means `0` for legacy bindings, so absent meaning `0` for a fixture is consistent rather than a
loophole — at a fraction of the risk. `providerResolver.imageConstraints` already reads
`binding.capabilities.maxConditioningImages ?? 0`; use the same shape one level up.

If the field stays required, the fixture sweep must be a named acceptance item with a count, not a
step, because a missed fixture surfaces several tasks later as `undefined` rather than as a failure
at the point of change.

## 3. Budget — the 30 MB aggregate is a tightening, and it will be felt

Today 30 MB is applied **per image** (`imageAdapter.ts:128`, and `FIRST_FRAME_MAX_BYTES` in the video
adapter). The plan makes it the **aggregate across up to six** conditioning images — about 5 MB each.

That is the safer choice and I agree with it. But it is a behaviour change, and 5 MB is comfortable
for web-sourced images and tight for camera-original cast photography, which is exactly what a game
studio has. The consequence should be **stated in the Brief UI before import**, not surfaced as a
validation error after the user has chosen six files.

## 4. Smaller notes

**Decision 9 modifies a spend path.** Narrowing the Director's auto-submit so a request that would
consume cast/look images diverts to review is a genuine improvement — it closes a disclosure gap this
slice creates. It also touches the one path that spends without a per-spend confirm. The plan already
requires that the zero-reference path keep its de-duplication, pre-await fencing and
consume-before-pay ordering; make that a byte-for-byte diff check in Task 9's safety review, not only
a test.

**`rg` is available**, so Task 4's shape search runs as written.

**Task 9's MCP change is well-scoped** — returning `{id, label, role}` and the concrete
`referenceAssetId` finally closes the `hasReference` gap that has been open and sequenced-past twice.
Good that it landed somewhere.

---

## What is right and should not be softened

The **gate ordering**. The experiment runs before implementation, with three named outcomes and a
stop condition for two of them. The **fourth paid generation** for multi-image capacity is correctly
separated from the experiment's three and correctly refuses to claim support without it — _"if only
two are tested, the truthful route max is two; every unverified family remains 0"_ is exactly the
right standard.

The **two-stage spend**. Two separately authorized paid actions, no confirmation hiding two provider
calls, cast/look never crossing the video adapter boundary.

**Main derives active reference IDs from canonical state**, never from the request, renderer, or an
MCP tool. That is the correct authority boundary and it is stated three times.

**Durable provenance frozen before submission**, with restart simulation in the tests and a rule that
completion never reconstructs provenance from then-current state. That is the difference between a
plate you can trust and one that lies about its inputs.

**Legacy tolerance throughout** — absent provenance is _unknown_, not invalid or stale; a legacy
binding is `0`, not "probably supported"; no schema bump; no forced re-purchase of a still.

## Estimate

12–17 hand-days is consistent with this session's calibration of roughly one hand-day per hour of
elapsed session time, and with S1.5's 9 tasks landing in ~10.75 h. Expect **12–17 hours of session
time** plus the two human/provider checkpoints, which do not compress.
