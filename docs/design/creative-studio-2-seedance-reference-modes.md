# Seedance 2.0 takes up to 9 references — and the two coherence mechanisms are mutually exclusive

Recorded 2026-08-14. Engine capabilities below come from the user's reading of the BytePlus Video
Generation API and are **not verified from this machine**; our own side is verified against the tree.
The distinction matters, because the two halves disagree.

---

## What the engine accepts, per the API docs

| mode                                | inputs per task                                                     | output  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| text-to-video                       | prompt                                                              | 1 video |
| first-frame image-to-video          | 1 image + optional prompt                                           | 1 video |
| first-and-last-frame                | 2 images + optional prompt                                          | 1 video |
| **Seedance 2.0 reference-to-video** | **up to 9 images**, plus optional video/audio references and prompt | 1 video |

Seedance 2.0 additionally allows 0–3 reference videos and 0–3 reference audio files (15 s combined
each; audio cannot be used alone).

**And the constraint that matters most: first/last-frame mode and multi-reference mode are mutually
exclusive.** `first_frame` / `last_frame` cannot be submitted alongside `reference_image` entries in
the same task.

## What we actually send, verified

- `mediaGatewayAdapter.firstFramePayload` returns a **single-element** array,
  `[{ role: 'first_frame', mime_type, data_base64 }]`, and nothing else.
- `StudioScene.referenceAssetId` is **one nullable id**. There is no place to put a second reference.
- `docs/guides/creative-studio-provider-contract.md` defines the `first_frame` role only.
  `supports_first_frame` is optional and defaults to false.

So the design handoff's line — _"the video side takes exactly one image, in the `first_frame` role…
there is no separate character-reference input"_ — is **true of our contract and false of the
engine**. It was a statement about our plumbing that has been read as a statement about the model.

---

## What follows, in order of how much it changes

### 1. The two-stage still may be unnecessary on this engine

Phase 3a exists because the video model was believed to take one image, so cast and look had to be
compressed into a single still by an image model first. If the video engine accepts up to nine
references directly, that compression step is optional on Seedance 2.0 — and skipping it removes a
paid generation per shot and a whole class of "the still didn't capture the cast" failures.

This does not delete 3a. Multi-reference is engine-specific; a route without it still needs the
still. But it changes 3a from _the_ mechanism to _a fallback_, and that is a scope question worth
answering before 12–17 days are committed.

### 2. Chaining and shared conditioning cannot both apply to one clip

The handoff ranks coherence levers: **(1) last frame → first frame**, **(2) shared conditioning —
same cast image, look references**, then cutting on a change, then matching in the Cut. It treats 1
and 2 as complementary and cumulative.

On Seedance 2.0 they are **mutually exclusive per task**. A clip is either chained or referenced, not
both.

The implication is specific and unpleasant: if clip 1 establishes the look via references and clips
2…n inherit it via the chain, then **cast fidelity for every clip after the first depends entirely on
the chain not drifting** — there is no reference image pulling it back. A single bad continuation
propagates to the end of the section with nothing to correct it.

That is a real design decision, not a detail, and it lands in **Phase 3b**, which is specified as
head-to-tail chaining within a section.

### 3. The experiment's scope is now narrower than the question

`creative-studio-2-still-to-clip-experiment.md` tests still → `first_frame`, which is exactly what we
can send today, so it remains valid and worth running. But it no longer covers the whole hypothesis:
it cannot test multi-reference, because the adapter has no way to send more than one image.

Testing multi-reference needs contract work — a second role, a scene able to hold several references,
and adapter support. Worth scoping only after the decision in (1).

---

## What to do with this

**Verify the engine claims against the provider we actually call.** We reach Seedance through
OpenRouter's video integration, not BytePlus directly. Whether OpenRouter exposes `reference_image`
at all, and whether it forwards 1–9 images, is an unknown and is the first thing to check — the whole
of (1) and (2) rests on it. Our route capability flag today is a single boolean,
`supports_first_frame`; there is no `supports_reference_images` to inspect.

**Then take the scope question to the designer**, because it changes what 3a is for.

**And do not silently update the handoff.** It is the design source of record; its claim was a
reasonable reading of our own contract. This file is the correction, and the handoff should be
amended by whoever owns it rather than by an implementer.
