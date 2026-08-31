# Creative Studio 3 — the First frames panel

> Designer handoff received 2026-08-26. Two standalone bundles are committed beside the plan and are
> the authority for anything this document paraphrases:
>
> - **Handoff notes** — `docs/prds/creative-studio/creative-studio-3-first-frames-handoff-notes.html.txt`,
>   sha256 `a854abf83b0ffba2…ea340879`
> - **Hi-fi** — `docs/prds/creative-studio/creative-studio-3-first-frames-reference.html.txt`,
>   sha256 `0f95a879778b7043…bc8430f9`
>
> Both are JS-bundled pages: they render nothing without scripts, so read them in a browser rather
> than by stripping tags. This document is the specification of record; the assignment lives in
> [the MVP plan](../prds/creative-studio/creative-studio-3-mvp-plan.md).

## The idea in one line

Frames feed in on the left, the picture comes out on the right, and the divider between them is doing
real work.

## 1 · The two halves

**First frames are inputs.** The stills a Shot may begin on — imported by the user, generated, or
handed down as the last frame of the previous Shot. A Shot can hold several; exactly one is current.

**Current picture is the output.** The clip the engine last produced for this Shot, from whatever
frame was pinned at the time. Its own last frame travels forward, which is why the card carries a `→`
control reading _"send its last frame to Shot 2"_.

Nothing else belongs in this region.

## 2 · Current vs pinned — read this before implementing

The two bundles state the default differently, and the difference is load-bearing:

- The hi-fi annotates the strip **"The latest eligible image is the current first frame. Pin one to
  hold it."**
- The notes say **"exactly one is pinned as current, and changing the pin means the shot must render
  again."**

Read together: **current is automatic, pinning is a hold.** The newest eligible frame is current by
default; pinning freezes that choice against future arrivals. This matches the References model the
owner already ruled on — newest is current, current is approved, no separate approval act — so the
same rule now governs both surfaces.

This bears directly on the existing `seedStillId` field, which is `null` on every Shot in a live
project while `effectiveSeed` resolves the newest eligible asset from `shot.assetIds`
(`service/schema2/chain.ts:104-121`). **The behaviour the designer describes is what the code already
does.** `seedStillId` is the explicit hold. Implement the panel on top of that; do not introduce a
second notion of currency.

Note one existing asymmetry that the panel will make visible: a `boardStills`-collection asset is
**not** auto-eligible as current (`chain.ts:94` accepts only `assets` and `imports`) but _can_ be
pinned explicitly (`eligibleExplicitSeed` → `resolveStudioCanonicalBoardAssetV2`). A board still and
an imported still therefore behave differently in the strip. Decide deliberately whether the panel
surfaces that distinction or hides it; do not discover it at implementation time.

## 3 · Card anatomy

The picture carries the card; words are the smallest thing on it.

| Element            | Spec                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Thumbnail**      | 196×110 in the spec, **132×74 inside the panel**. 16:9, cover-cropped, dark backing so a light frame reads.    |
| **Caption**        | 9px mono under the picture: which frame on the left, origin on the right (generated, imported, from shot 2).   |
| **Pinned state**   | 2px orange border, `CURRENT` badge lower-left of the image, pin button stays lit. Three signals, no text.      |
| **Hover controls** | Full screen, pin, more — 30px glass buttons top-right, top scrim for contrast, 140ms fade, leave with pointer. |

The two bundles disagree on caption line count — notes say "one 9px mono line", hi-fi says "two mono
lines of 9px". Take the notes' **one line** with origin right-aligned; the hi-fi's own rendered
captions (`FRAME 1 · GENERATED`) are single-line, so the hi-fi's prose is the outlier.

## 4 · Space, and why the rail stays put

The frames sit as **one horizontal band, not a tall column**, so the timeline keeps its place at the
bottom of the panel. A Shot with eight frames is the same height as a Shot with two.

| Measure         | Value        | Why                                                                 |
| --------------- | ------------ | ------------------------------------------------------------------- |
| Panel width     | 1320         | 1180 truncated the shot prompt and left no room for a fourth frame. |
| Frames band     | **178 tall** | Fixed. Overflow scrolls horizontally; the band never grows.         |
| Frame tile      | 132×74       | Four fit before scrolling, import tile pinned at the end.           |
| Current picture | 190×107      | Deliberately larger than a frame — it is the Shot's actual output.  |
| Import tile     | 64×74        | Also the drop target for files dragged onto the band.               |

## 5 · Which Shot is on

One orange thread, three places: an `ON` tag and orange left edge on the Shot header, a `SHOT 1` chip
on the First frames label, and the matching rail segment tinted with its own `ON` tag and warm plan
block. Every other Shot in the rail stays neutral. **Nothing else in the panel uses that tint.**

## 6 · Shot status — four words

The rail and the Shot header say the same word. There is no fifth state and no compound phrasing.

| Word                | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| **NOT READY**       | No first frame pinned. The Shot cannot be sent to the engine. |
| **READY TO RENDER** | A frame is pinned. Nothing has run yet.                       |
| **RENDERING**       | In flight, with percentage when the engine reports it.        |
| **RENDERED**        | A current picture exists for the Shot.                        |

**`RENDERING` percentage is not available on the current route.** `openRouterVideoAdapter` returns
bare `{status:'queued'}` / `{status:'running'}` with no progress (lines 686, 690); only
`mediaGatewayAdapter` parses a 0–100 `progress`. The plumbing exists end to end — `progress?: number`
on both the adapter result and the job record — so the panel should render the percentage **when
present** and a determinate-free state otherwise. Do not design a bar that requires a number the
provider never sends.

## 7 · Full-screen frame view

Opens from `⛶` on any thumbnail, or by clicking the frame. Overlay covers the viewport at 94% black;
the image sits **contained, never cropped**, so judgement happens on the whole frame.

- **Navigate** — arrows either side, a filmstrip of the Shot's frames along the bottom, a counter
  top-right. The strip highlights the frame you are on.
- **Pin** — the primary action. Becomes a lit _"Pinned as first frame"_; the `CURRENT FIRST FRAME`
  badge appears in the top bar. The card behind the overlay updates immediately.
- **Regenerate** — fires with the prompt as written. The stage dims while it runs and a _Cancel run_
  appears.
- **Download, Remove** — secondary, outlined. Remove is the only warm-tinted destructive control.

**Keyboard:** `←` `→` move between frames, `P` pins, `R` regenerates, `Esc` closes. `R` is suppressed
while the prompt field has focus.

## 8 · Prompts and runs — one rule

> The prompt is always visible and always editable, including mid-run. A run uses the text as it was
> when fired; edits made afterwards do not change the job in flight. Once the run ends, if the text no
> longer matches what was fired, the field is tagged **EDITED · NOT YET RUN**.

The designer states this should hold **anywhere else a render is fired**, not only here.

The frame prompt lives under the image in full screen; the Shot prompt lives on one line in the Shot
header, beside the status. Both primary buttons become _Cancel run_ while working. The Shot button is
labelled by its target — **"Generate Shot 1"**, not "Generate again" — so it is clear what will be
spent.

## 9 · Settled — owner rulings, 2026-08-26

The designer's four questions and engineering's fifth were put to the owner with code evidence and
ruled on together. The through-line, and the reason the rulings read alike: **newest is current,
pinning is a hold, history is free, divergence is a tag, and spending is always the same gate.** A
user learns that rule once — on references — and it now holds for frames, takes, and prompts.

### Ruling 1 — Takes: replace, with retained history

Generating a Shot **replaces** the current picture; it never accumulates takes beside it. One Shot →
one `videoAssetId` stands, exactly as the take-removal spec (`1750f9627`) settled. But replacement is
not destruction: the store already pushes the outgoing current into `supersededVideoAssetIds` on
every completed take (`mediaStore.ts:4038`), and a validation invariant guards that list
(`validation.ts:2076`). So the designer's "replace or add?" was a false choice — the answer is the
References model verbatim: **one current pointer plus a superseded history.**

Consequences: the current picture card gets **no switcher and no take number** — the card stays
"picture first, words last". Previous takes are reachable in the full-screen picture view (Ruling 3),
and re-pointing to an older take is **free**, like reverting to an older reference image. Re-pointing
changes the last frame that feeds the next Shot, which downstream surfaces report through Ruling 2 —
not by blocking the revert.

### Ruling 2 — Staleness is the prompt rule, generalized

The designer already invented the pattern for text: _a run uses the prompt as fired; if the field no
longer matches, it is tagged `EDITED · NOT YET RUN`._ The same rule now covers pictures. A rendered
Shot whose effective first frame no longer matches the one its take was fired from carries a tag of
the same family — **`FIRST FRAME CHANGED · NOT RE-RUN`** — on the current picture card; a downstream
inherited-frame tile whose source's last frame has changed carries the same treatment on the tile.

Divergence is an **attribute tag, never a fifth status word**. `RENDERED` plus a stale tag coexist;
the four-word vocabulary is untouched.

Implementation must consume the existing main-side machinery, not recompute freshness in the
renderer: `studioConditioningInputsEqual` and the `continuity_stale` cause already exist
(`chain.ts:292-296`), the board-panel status already ships typed `staleCauses`
(`workspaceStatus.ts:246-256`), and the workspace projection already maps them to
`current | stale`. Extend that pattern to the video take; do not invent a parallel one.

### Ruling 3 — The current picture gets its own full-screen view, and it is where history lives

Symmetric with the frame view: 94% black overlay, media contained never cropped, the **Shot prompt**
underneath (editable under the one prompt rule), primary action **"Generate Shot N"** behind the
existing spend gate, becoming _Cancel run_ mid-flight. The clip plays in the frame; reuse
`FullscreenMediaFrame.tsx`.

The filmstrip along the bottom navigates **takes** — current first, then `supersededVideoAssetIds`,
newest to oldest — instead of frames. Choosing an older take re-points `videoAssetId` and costs
nothing. This is deliberately the same gesture as choosing an older reference image, and it is what
lets Ruling 1 keep the card clean: history exists, but it lives where judgement happens.

### Ruling 4 — The `⋯` menus, exactly

Menu items never spend. Anything paid goes through the prepare/confirm gate; the menus are free
actions only.

**Frame `⋯`:** `Download` · `Copy prompt` (generated frames only — imported and inherited frames have
none) · `Remove` (the warm-tinted destructive action, consistent with the full-screen view).

**Rejected from the designer's candidates:** _Duplicate_ — a frame has no mutable state of its own,
so a duplicate is an indistinguishable tile, pure clutter. _Replace_ — the import tile plus Remove
already compose it. _Reveal in library_ — no such surface exists in Studio; if a jump to the Assets
drawer is wanted later, that is a separate ask.

**Current picture `⋯`** (composed from Rulings 1 and 3, same no-spend rule): `Download` ·
`Previous takes` (opens the full-screen view on the history strip) · `Remove take` (per the
take-removal spec: clears the one `videoAssetId` its write registered).

### Ruling 5 — The panel widens to 1320

The shipped Beat panel is `min(1100px, calc(100vw - 32px))`, capped at 1100
(`BeatPanel.module.css:3-4`). At 1100, the frames region sitting beside the beat player fits **three**
tiles before scrolling, not the designed four. The designer justified 1320 on measured grounds — 1180
truncated the shot prompt and left no room for a fourth frame — so the cap moves to **1320**:
`min(1320px, calc(100vw - 32px))`.

The band's fixed **178px height** is adopted exactly as drawn. Below a 1320 viewport the strip simply
shows fewer tiles and scrolls; no layout jump, no height change. One check owed at implementation:
the widening affects the whole Beat panel, so verify the existing content — coverage bar, shots list,
player — renders correctly at 1320, since nothing else may silently assume 1100.

## What this does not change

Spend governance is untouched. A regenerate or a Generate Shot from this panel enters the existing
prepare/confirm quote path; the panel is a surface over that flow, not a new way to spend. Pinning a
frame is free and remains free.
