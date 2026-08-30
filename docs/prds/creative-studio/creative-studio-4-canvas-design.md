# Creative Studio 4 — the canvas

**Date:** 2026-08-30 · **Status:** draft for owner review · **Supersedes:** the four-view workspace IA
**Grounded in:** a twelve-agent survey of the product at `b1a0fb627`, each area independently checked

---

## What this is

CS4 changes what Creative Studio _is on screen_, and what it _is for_.

Today it is a film tool: a workspace of four views over a Beat and Shot model, where every generated
thing must hang off a Shot. CS4 is a **multi-modal studio** — photo, sound, video — where the unit is
a **named artifact** produced by a **capability**, and a film is one composition over artifacts
rather than the container everything lives inside.

Two pivots, one architecture:

1. **The workspace becomes a canvas of named blocks.** Each block holds finished work and carries a
   `#` handle. Nothing on the canvas is an empty container. The Director presents only what is ready
   for review.
2. **Creation is composable capability blocks.** A Director invokes capabilities and names their
   outputs, rather than driving a fixed pipeline.

**Standalone artifacts are first-class.** A person can make one photo. That is the load-bearing
requirement: if a photo needs a film scaffolded around it, nothing else in this document works.

---

## Why: the diagnosis, measured

The owner's complaint was "many screens with no content, and no clear call to action — will the
Director do this, or do I click something?". The survey confirms it exactly, and the numbers are
worse than the complaint.

A newly created project has `beatOrder: []`, `beats: {}`, `shots: {}`, `references: {}`,
`referenceOrder: []`, `referencePlanStatus: 'unplanned'`, `bin: []`, `imageRouteId: null`,
`videoRouteId: null`. Every one of the four readiness stages therefore derives `not_started`, so
**all four views are locked at the moment a person first arrives.**

What they see is one paragraph:

> **The Director starts here**
> The Director will draft the first plan from your brief. Review it here when it arrives.

And the four locked views, if addressed directly, say:

| View       | Copy                                                           |
| ---------- | -------------------------------------------------------------- |
| References | "Nothing to review until the Director plans references."       |
| Table      | "Nothing to arrange until the Director drafts the storyboard." |
| Board      | "Nothing to produce until the Table is set."                   |
| Cut        | "Nothing to cut until Shots are produced."                     |

**Every one of those sentences says the Director will do it, and offers the person no action.** That
is the confusion, in the product's own words. Meanwhile the only enabled control in the app bar —
`Render…` — answers an empty project with _"Nothing is ready to render yet"_.

This is not a copy problem. The screens are empty because the model requires a film to exist before
anything can. The canvas is the fix because it inverts the relationship: blocks exist because
something was made, so there is no state in which the app shows you a container for work you have
not done.

---

## The model

Three concepts. Only the first is new.

### Artifact

A named, finished thing: a picture, a clip, a sound, a document. It has a `#` handle, a kind, the
bytes, and — recorded but not necessarily shown — what produced it, what conditioned it, and what it
cost.

**Artifacts do not require a film.** This is the one real addition to the store. Today `Shot` is the
only owner of generated media and every asset hangs off one. CS4 makes an artifact ownable by the
project directly, with Shot membership becoming one optional relationship among several.

### Capability

Something that makes artifacts: an image route, a video route, a bed import, an export. A capability
declares its inputs, its outputs, and what it records. It is invoked by the Director or by the
person, and its output lands on the canvas as a block.

**A capability produces "a named artifact of some kind", never "a picture or a clip".** This costs
nothing today and is the difference between parking voice and blocking it.

### Composition

An ordered arrangement of artifacts that makes a larger work. A film is a composition. So is a
character sheet, or a set of environment plates. Beats and Shots become the structure _of the film
composition_, not the structure of the app.

---

## What is kept

The survey's most useful finding is how much of CS4 already exists.

**The store keeps its provenance, unchanged.** Schema 2 already records, durably and per job: a
frozen `StudioGenerationCompositionV2` carrying brief, rules, story, shooting script and the exact
reference assets with sha256; `requestSnapshot.conditioningInput` naming the seed still or
predecessor frame; asset-side `producerJobId`, `compositionDigest` and
`generationReferenceAssetIds`; `spendReceipt` for cost; `supersededVideoAssetIds` for supersession;
`chainBreak` and derived chain state. **None of this is displayed by the canvas while everything is
current, and none of it stops being recorded.** That is the whole of the A-surface decision.

**Project status drives the canvas.** `projectStudioStatusV2` is a pure, main-side derivation
returning seven stages — `brief · engines · references · storyboard · bindings · production · cut` —
each `not_started | in_progress | complete | blocked`, with blockers carrying `{cause, where,
remedy}` and remedies already typed as free-fix versus paid. Which blocks exist, which are ready, and
what a person can do about a stuck one are all _renderings of this_. The canvas must not invent a
parallel readiness model.

**The frame around the canvas survives.** `WorkspaceShell` already draws the app bar, the resizable
Director rail and the work panel; the four views are its `children` — a single insertion point. The
canvas replaces the contents of one `<main>`.

**The spend contract survives.** Two gates only — money beyond the envelope, and irreversible change.
Everything else is shown, not asked.

---

## What changes

**The four views stop existing as destinations.** `STUDIO_VIEWS` is a cross-process constant: the
main process builds its unsaved-work close-preflight regex from it, and a URL segment main does not
match closes the window with no prompt and loses drafts. Removing views is therefore a two-process
change that must land atomically with the route pattern, not a renderer edit.

**The proposal gets one home.** Today the same `DirectorProposalCard` renders in two places at once —
the work panel inbox and the Director rail. On a canvas of finished work, a pending proposal is by
definition the one thing that is _not_ finished. It gets a single, distinct home.

**Blocks are named, and Shots have no name today.** A Shot carries `shootingScript` and a position,
and nothing else. If blocks carry `#` handles, the spec must say where a handle comes from: derived
from position, taken from the first words of the script, or authored. **Decision: handles are
authored, defaulting to a derived slug.** A person can rename a block; that is what makes it
referable in conversation.

---

## Multi-modal scope

| Mode      | Today                                                 | CS4                                                                                                                       |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Photo** | Four adapters, four job purposes, full provenance     | Re-presentation. A photo becomes standalone rather than Shot-owned.                                                       |
| **Video** | Wired, with a derived continuity chain                | Re-presentation, plus the ffmpeg dependency below.                                                                        |
| **Sound** | One imported WAV bed, mixed into export at fixed gain | Re-presentation of the bed. **No generation exists** — no TTS, no music, no SFX route.                                    |
| **Voice** | Nothing                                               | **Parked.** Out of scope. The capability interface must not assume visual output, so it slots in later without a rewrite. |

"Multi-modal studio" is therefore two-thirds repositioning and one-third new capability. The spec
does not pretend four equal modes exist.

---

## Decisions the owner must make

These four collide with existing rulings or have no implementation. They are listed rather than
silently resolved.

### 1. The credit counter reverses D3

The reference app shows `✦ 412 Renew` in the corner. Decision D3 (2026-08-12) says: _"No credit
ledger — out of scope. Cost is not priced in credits; any mock text showing credits is illustrative
only and must not be transcribed into the build."_

There is also no data source. No balance, wallet, or spent-to-date value exists anywhere in the
store, main, or the renderer — only `StudioSpendPolicy.maxPerBatchMinorUnits`, a per-batch ceiling
with no drawdown, and per-job `spendReceipt` rows.

**Options:** (a) a currency budget envelope, drawn down by summing receipts — compatible with D3 and
derivable from what exists; (b) adopt credits as a real product unit, reversing D3; (c) no corner
readout.
**Recommendation: (a).** It gives the reference's calm without reopening a ruling.

### 2. ffmpeg gates four capabilities, not one

BUG-144 describes film export. The survey found the dependency is far wider:

- **Video ingestion.** Every downloaded take is probed for duration, and a probe failure **discards
  an already-paid result**. On a stock machine a pilot user pays for a clip and is told the provider
  returned nothing.
- **Continuity frames.** The last frame is decoded locally except on one BytePlus path at an
  untrimmed endpoint.
- **Audio bed import.** Requires ffprobe _and_ a full decode; failure surfaces as `invalid_media`,
  which reads as "your file is broken".
- **Film export.** Also requires 20 named filters, 5 demuxers, 2 muxers, the aac encoder, and a
  hardware encoder — there is no software x264 fallback, so a VM gets no film even with ffmpeg
  installed.

The resolver is already bundle-ready and the electron-builder hook exists. **This is a packaging
decision — pin, download and sign LGPL binaries — not a mechanism to build.** Until it is made, the
canvas rule "blocks hold finished work" is false on any machine without Homebrew ffmpeg.

**The editor-folder export is the fallback deliverable**: it copies each take plus a slate PNG,
`script.md` and `timeline.json`, without stitching, and needs no encoder.

### 3. The canvas replaces work that shipped today

Progressive workspace readiness landed on 2026-08-30 as the answer to the same four-empty-rooms
complaint, and the four-view order is an owner-approved product amendment from 2026-08-24. CS4
supersedes both. This should be an explicit decision, not a silent overwrite.

### 4. What a pilot user must be able to finish

Undecided, and it sets the scope of everything above. A finished film requires resolving (2). One
photo requires almost nothing beyond the canvas itself.

---

## Migration

**None.** All existing projects are test data. CS4 refuses anything that is not current-schema; there
are no versioned reads, no dual-write, and no compatibility shims. Anyone holding work in a CS3
project loses it at the switch — an accepted cost, recorded here so it is not rediscovered later.

This licenses the deletion of the schema-1 detection, quarantine and legacy-reporting machinery in
`store.ts` (~149 references), which is where three of this month's defects lived.

---

## The work, in two lanes

Two agents work this in parallel. A file-based split does not work in this codebase: one ordinary
feature commit recently touched 21 files spanning the tool schema, IPC, the service, shared types,
twelve locale bundles and the renderer. **Features here are vertical, so any lane drawn through the
stack cuts every feature in half.**

The split is therefore on a **seam**, and the seam is written first.

### Task zero — one agent, not split

1. **Freeze the artifact and capability contract.** The types, the IPC shape, and what a capability
   must record when it produces something.
2. **Capture fixtures from a running backend.** Not hand-written from the type definitions. An epic
   in this repo passed 8,200 green tests having never once worked, because every fixture was built
   from types and schemas rather than from the wire. This is the difference between two lanes that
   integrate on day one and two lanes that integrate on the last day.
3. **Carve the two giants along the seam CS4 needs anyway.** `store.ts` is 9,684 lines and
   `StudioPage.tsx` is 4,507; every substantive task routes through one or both, so two agents would
   collide constantly. Split store into artifacts / capabilities / proposals / spend behind the
   existing API, and StudioPage into per-block components. **As the seam work, not as a separate
   refactor.**
4. **Delete the back-compat surface** the no-migration decision just made dead.
5. **Retire the CS2 prose-pinned docs.** `documentation.test.ts` asserts exact sentences from seven
   CS2 design documents, which is why editing a planning doc can turn the suite red. CS2 is closed.

### Then two lanes

**Lane A — behind the seam.** Capabilities, generation, provenance, spend, standalone artifacts in
the store, project status as the canvas's readiness source.

**Lane B — in front of the seam.** The canvas, blocks, block handles, the Director's presentation
model, the single proposal home, the app-bar readout.

Both work against the frozen contract and the wire-derived fixtures.

### The rule that keeps them apart

Claim the entry, not the file. One line in the work item naming who took it and when. Three files
remain genuine merge hazards regardless of lane: `openingTurn.ts` (rule edits invalidate every
conversation's preset profile), `creativeStudioTypes.ts`, and the twelve locale bundles (a contract
test requires every referenced key in all twelve, so two agents adding keys conflict twelve times at
once).

---

## Traps

- **`STUDIO_VIEWS` is a two-process contract.** Changing it without the main-process route pattern
  loses unsaved drafts silently.
- **The Director's rules now name the UI.** `DIRECTOR_PRESET_RULES` was given a map of the workspace
  on 2026-08-30 — the four views, the Render button, the Project menu, the proposal card and its
  buttons — with a test asserting every name exists in the shipped locale bundle. **A canvas rewrite
  invalidates that map and will fail that test.** That is the test working as designed: update the
  map in the same change.
- **In-flight work is not finished work.** Statuses `awaiting_spend`, `running`, `partially_failed`
  and `failed` are real and common. A canvas whose stated rule is "blocks hold finished work" must
  say where they appear.
- **`toRendererJob` strips `requestSnapshot`.** Main records per-clip conditioning durably, but the
  renderer never receives it. Disclosure later is not free: it needs an IPC change.
- **Two sessionStorage draft stores** hold real unsaved user work, keyed by a field vocabulary tied
  to today's forms.
- **The film export action must vanish, not fail,** when the local encoder contract is unavailable —
  a carried-forward ruling that it never shows a control that fails.

---

## Out of scope

Voice generation. `strictNullChecks`. Any change to the ~98.6% upstream surface. Migration of
existing projects. The nine open CS3 bug entries, which stay with the other agent.
