# Creative Studio 2 — engineering response to the design handoff

A reply to _Creative Studio 2 — Design Handoff_, its transition plan, and the Board/Cut
wireframes.

Everything below was checked against **`feat/studio-three-pane` @ `87a998761`**, the branch the
handoff names as source of truth, and against a real end-to-end production run on that build
(chat → script → four generated video shots → rendered cut). Claims are marked **verified** where I
confirmed them in code or in a running app, and **unconfirmed** where I could not.

**Verdict:** the model is sound and the contract change in §5 is aimed at exactly the right
thing. Three items in the handoff are stale or wrong, and four things are missing that will
otherwise be discovered during the build rather than before it. One of the four sits inside the
critical path of the phase the handoff itself calls most important.

---

## 1. What holds up

| Handoff claim                                                         | Result                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose_storyboard` is a whole-script replace                        | **Verified.** The tool's own description reads _"The proposal is a whole-script replacement: include EVERY scene you want to keep, not only changes"_ (`studioServer.ts:288`). §5 is correctly targeted. |
| `narration` is authored everywhere and goes nowhere downstream        | **Verified.** It appears in no adapter and nowhere in `renderService`. §6's framing of voice as its own lane is right.                                                                                   |
| One image, in the `first_frame` role, gated by `supports_first_frame` | **Verified**, and better than the handoff assumes — see below.                                                                                                                                           |
| Today's Review inspector ships crop scale and exposure                | **Verified** in the running app (also contrast, saturation, temperature).                                                                                                                                |
| `docs/guides/creative-studio-provider-contract.md`                    | Exists.                                                                                                                                                                                                  |

**§5 "capability honesty" is a smaller job than it reads.** The gate already exists and is already
live: `routeSupportsScene` (`components/Generation/routeSupport.ts:44`) refuses a reference when the
route lacks `supportsFirstFrame`, and it is called from `StudioPage.tsx:108`. What is missing is the
_explanation_ in the UI, not the enforcement.

---

## 2. Three corrections

### 2.1 The engine floor is 4 seconds, and nothing in the design accounts for it

The handoff says "every engine caps around 10s". The live binding is `bytedance/seedance-2.0` at
**4–15 seconds** (`minDurationSeconds: 4`, `maxDurationSeconds: 15`).

The ceiling being 15 rather than 10 is a detail. **The floor is not.** There is no such thing as a
two-second title snap or a one-second cut-in _as a clip_. Any beat shorter than 4s has to be a trim
of a longer generation, a still held on screen, or nothing.

This is a constraint on §3's object model, and it is load-bearing for open question 2. It is also
not theoretical: adding a closing shot in the current app defaults it to **3s**, below the floor,
with no warning at authoring time — it fails at render.

### 2.2 The "known live defect" in §5 looks already fixed

`GenerationReviewModal.tsx:175` selects `audioOn` when any route reports non-silent output,
`audioOff` when all known policies are silent, and shows nothing when the policy is unknown. It
branches on `scene.route.silentOutput`; it is not unconditional.

If the defect is real, it is upstream — in how `silentOutput` is derived for a given adapter — not
in the modal's copy. As written, the item would send someone to fix code that already conditions.
Worth re-confirming with the case that produced it before it enters a plan.

### 2.3 One thing the render actually does that the design should know

The rendered mp4 carries an **AAC audio track** even though both video bindings report
`audioModes: ["none"]`. Harmless, and possibly deliberate for container compatibility — but "the
output has no audio track" is the wrong way to describe it. The picture has no sound; the file has a
silent track.

---

## 3. Four gaps to close before build

### 3.1 Route selection is a prerequisite for §5, and the handoff does not mention it

**This is the most important item in this document.**

Today, binding a second model of one media kind makes that kind unusable. `resolveSoleRouteAdoptions`
adopts a route only when it is the **sole** candidate for its role, so two video bindings leave
`routing.video: null`, every video scene reports no generation route, and generation is blocked.

There is no way to resolve it in the app. The route picker lives in `GenerationControls`, which **is
never rendered anywhere** — it appears only in its own file and its test. Produce shows the read-only
`EngineBar`, whose "Change engines" navigates to Settings, which manages _bindings_, not the
project's route _selection_. The only cure is deleting bindings until one remains, then reopening the
project.

This was hit in normal use during a demo rehearsal, not by probing.

**Creative Studio 2 makes it worse, not better.** The still stage (image model) plus clips (video
model) means every project needs at least two live routes by construction, and per-section engine
choice multiplies it. A money gate cannot be built on a routing layer that can silently have no
route.

### 3.2 The migration hazard is the proposal ledger, not the project file

`store.ts` validates records against exact key sets — `SCENE_KEYS`, `ASSET_KEYS`, `CUT_KEYS`,
`ROUTING_KEYS`, `MANAGED_ASSET_KEYS` — and `validateProposalRecord` (`store.ts:407`) rejects unknown
keys outright.

Introducing `Section` and `Take` moves every one of those in lockstep, and **proposals already
persisted on disk become unreadable** unless the record is versioned first. §5 promises a migration
per phase; this is the specific thing that will break, and it breaks silently — an unreadable
proposal is skipped, not reported.

### 3.3 Undo has to be revision-aware

§2 makes undo non-negotiable and §5 asks for inverse operations. The store is CAS-guarded, main is
the sole writer, and the revision counter bumps on **every** persist. An inverse computed at
revision 14 is not valid at revision 19.

The shape that works is _apply the inverse as a new forward operation under a fresh guard_, not an
undo stack replaying stored inverses. Worth stating in §5, or the naive stack will be built and will
fail intermittently under exactly the conditions the design cares about — a director making several
edits while the user is also typing.

### 3.4 Is the project folder writable, or only readable?

§4 says an editor who never opens WePrompt can work the folder. It does not say what happens when
that person **edits** `script.md`.

If the human-readable files are derived from `.studio/` state, a text edit is silently lost on the
next write. If they are source, `.studio/` is a cache and must be rebuildable from them. That single
decision determines the file format, the sync story, and whether "readable on disk" is a real promise
or a marketing one. It cannot be deferred past phase 1.

**Related, smaller:** §4 removes crop and exposure from the Cut, but those values are persisted per
clip and the store validates them. Removing the UI without a data decision leaves values nothing can
edit and the renderer still honours. Decide: drop from the model, or keep and honour.

The exact constants (corrected 13 Aug — an earlier draft of this document wrongly named `CUT_KEYS`):

```
CUT_CLIP_KEYS        = {id, sceneId, assetId, sourceInSeconds, sourceOutSeconds, crop, filters}
NORMALISED_RECT_KEYS = {x, y, width, height}
CUT_FILTER_KEYS      = {id, amount}
CUT_FILTER_IDS       = {exposure, contrast, saturation, temperature}
```

plus the filter union at `creativeStudioTypes.ts:200-203`. `CUT_KEYS` itself
(`{id, name, orderMode, clipOrder, clips}`) is untouched.

⚠️ **Dropping them is two ordered steps, not one.** Validation is `hasExactKeys`, so the moment
`crop`/`filters` leave `CUT_CLIP_KEYS`, any cut record still carrying them fails validation and is
**skipped silently** — the user's cut disappears rather than losing its grade. The migration must
strip the fields from persisted cuts _first_, and only then may the key set tighten. This is the
same hazard as the proposal ledger in §3.2, applied to cuts.

---

## 4. The open questions

### Q2 — where section duration comes from: **sum it from the clips**

Given a hard 4s floor and 15s ceiling per clip, a freely typed section duration cannot always be
honoured — 20s is three clips or two, but 7s is one clip and a trim, and 3s is impossible. Typing a
target invites numbers the engine cannot produce, and the failure surfaces at render, which is after
the money.

Sum from clips, show the total, and let the director propose a **clip split** to reach a target
length. That keeps the target as an intent the director works toward rather than a value the model
must satisfy.

### Q1 — TTS routes: **procurement, not a sprint**

There is no text-to-speech in the app, and the provider contract carries image and video roles only.
`voice` is a genuinely new media role with a new adapter, new capability flags, and new spend
accounting. Nothing reachable with keys users already hold.

### Q3 — 9 sections or 40: **I cannot answer it, but here is what breaks at 40**

The board grid is fine at 40; that is not the constraint. Two other things are:

- **Generation is sequential.** Four video shots submitted together ran strictly one at a time,
  each taking minutes. At 40 sections × 3–4 clips that is 120–160 generations in series — hours,
  not minutes, and the first-frame chain _requires_ head-to-tail ordering within a section, so it
  cannot be fully parallelised away.
- **The brief-in-every-turn premise degrades.** A brief that is loaded into every director turn has
  to stay small. That is comfortable at 9 sections and questionable at 40, where the script alone
  is most of the context.

Worth answering before the build, as the handoff says — and the sequential-generation figure is
probably the more decisive half of the answer.

### Q4 — will users trust a director that edits directly?

Not answerable from here, but one measurement is relevant. A single director turn that read the
script, listed routes and proposed a storyboard took **82 seconds** (first visible output at 2.1s,
no errors). That is acceptable for "propose the spine". It is **not** acceptable for "retime section
3", which the user can do themselves in five seconds.

So the free-is-direct principle probably wants scoping by _tedium_, not by _cost_: the director
should own bulk work (retime everything, rewrite nine prompts against a changed rule, split a
section into clips) and stay out of single-field edits. Otherwise the direct-edit path will feel
slower than doing it by hand, which is the failure mode §8 worries about, arriving by a different
road.

---

## 5. On the sequencing

The handoff's closing bet — _if only two phases happen, one and three_ — is right on priority and
incomplete on dependency.

Phase 3 (coherence) rests on the first-frame chain. The chain rests on `supports_first_frame` being
true for the route **and** on the still stage existing, which means at least two working routes per
project. Today a project can end up with no video route at all and no in-app way to fix it (§3.1).

**So the routing work is inside phase 3's critical path, not beside it.** If phases 1 and 3 are the
two that ship, §3.1 ships with them.

---

## 6. What would help from the design side

1. **A route-selection surface.** Where does a user choose between two video engines, and what does
   it look like when a project needs an image route _and_ a video route? The picker component
   already exists in code and was never wired to anything — it is a design question, not an
   engineering one.
2. **A decision on the folder's writability** (§3.4), because the file format follows from it.
3. **The stale badge and the chain break**, which wireframe 9c covers — that is the clearest part of
   the whole set and I would build from it as-is.

---

## Appendix — overlap with live defects

Three items from a defect list compiled during a demo rehearsal on this branch intersect this
design directly. They should be tracked once, not twice:

- **Two bindings of one media kind disables that kind** — §3.1 above. Blocker.
- **A cut can be rendered while shots are still generating**, producing a short film with no warning
  (measured: 14.14s rendered against an 18s storyboard). `renderService` already computes
  `missingSceneIds` on every outcome; it is simply not surfaced. Relevant to §4's "say the
  consequence before it runs".
- **A sub-4-second clip is authorable but unproducible** — §2.1 above.

Two further items are fixed on this branch and need no design input: the crop overlay swallowing
clicks on the Review player, and the Director toggle reading as the breadcrumb's back button.
