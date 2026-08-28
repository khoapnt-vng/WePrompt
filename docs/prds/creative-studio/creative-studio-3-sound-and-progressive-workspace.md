# Creative Studio 3 — sound, and a work area that fills up

Two pieces of work, planned against the code as it stands on `5ec55e48f`. Both turn out to be
mostly wiring that already exists rather than new machinery, so the slices are small. Every claim
below was measured or read out of the source, and the measurements are recorded inline so the next
person does not have to repeat them.

---

## Piece 1 — Sound: narration, voice, SFX

### What is already true

This is the finding that sets the scope. **Shot videos already carry audio.** Probed with `ffprobe`
against the live store:

| Shot video  | Streams               | Loudness                       |
| ----------- | --------------------- | ------------------------------ |
| `a579576d…` | h264 + **aac stereo** | —                              |
| `a892526a…` | h264 + **aac stereo** | —                              |
| `eef5a2be…` | h264 + aac stereo     | mean −59.6 dB, max −40.5 dB    |
| `950a77bc…` | h264 + aac stereo     | mean −54.0 dB, max −31.6 dB    |
| `e88a852e…` | h264 + aac stereo     | mean −51.8 dB, max −34.3 dB    |
| `377ccb10…` | h264 + aac stereo     | **mean −18.6 dB, max −4.9 dB** |

Every Shot has an AAC stereo stream. Three sit at the noise floor — silent output wearing an audio
stream — and one carries real programme audio. That split is not random: the adapter already
catalogues it as `silentOutput` per model (`openRouterVideoAdapter.ts:158`,
`supportsAudio: !constraints.silentOutput`), surfaces it as `audioModes: ['audio'] | ['none']`
(`:653`), and the settings UI already shows it as a tag.

So sound is not missing from the product. It is **inaudible**, in exactly three places:

- `BeatPanel/BeatPlayer.tsx:913` — `<video … muted>`
- `BeatPanel/BeatPlayer.tsx:1007` — `<video … muted>`
- `Views/Board/index.tsx:177` — `<video … muted>`

And the export end is finished already. `creativeStudioTypes.ts:1185-1200` defines a complete audio
contract: AAC, 48k stereo, 192 kbps, `silenceForMissingStreams: true`, a per-Shot gain, and an
optional music bed with `bedGain`, `bedFadeOutSeconds` and a `triangular` fade curve, crossfaded on
dissolves. `StudioMediaKindV2` already includes `'audio'`.

**What is genuinely missing is only this:** the Director never writes sound into the script, and the
review surfaces never let you hear what arrived.

### Decisions

**D1 — Sound direction goes in `shootingScript`, not in a new Shot field.** A new required field on
the Shot is the exact shape of BUG-136, BUG-150 and BUG-151: a schema change shipped without a
migration, which permanently bricks every project written before it. `SHOT_KEYS` drives
`SHOT_BEFORE_KEYS`, so the undo history has to migrate too — that is what BUG-136 is still open on
today. For "just the minimal", the shooting script is already free text the model writes and the
Table already renders; sound direction belongs in it. Revisit only if sound needs to be
independently editable or validated.

**D2 — Never offer sound a model cannot produce.** `silentOutput` is already known per route, so a
Shot bound to a silent model should say so rather than present a dead control. This is the
BUG-142/167/169 lesson: a control that implies something untrue is worse than no control.

### Slices

**S1 — Make sound audible in review.** _(small)_
Remove the hardcoded `muted` from the three players; add a mute/volume control that persists per
project, defaulting to **muted** so nothing surprises the owner mid-session. Do not autoplay with
sound. This alone makes the `−18.6 dB` Shot above audible for the first time.

**S2 — Say whether a Shot has sound.** _(small)_
Two distinct facts, and they must not be conflated: the bound route is silent-only
(`silentOutput`), or the route supports audio but this Shot's stream is effectively silent. The
first is knowable before generating and belongs next to the binding; the second is a property of
the file. Reuse the `audioModes` capability already catalogued.

**S3 — The Director writes sound into the script.** _(small, prompt-side)_
Extend the Director's drafting instructions so a shooting script carries what is heard as well as
what is seen — narration, dialogue, ambience, hits. No schema change (D1). Note the constraint from
memory: KB/tool output is user-visible in the work journal, so model-facing guidance belongs in the
**tool description**, not in emitted text.

**S4 — Music bed selection.** _(optional, deferred)_
The export contract already accepts `bedAssetId` with gain and fade. Nothing in the UI sets it.
This is a real feature but not part of "minimal", and it needs an asset-import path for audio —
`StudioMediaKindV2` allows `'audio'` but no ingestion route exists. Park until S1–S3 land.

### What this deliberately does not do

No audio generation, no TTS, no per-Shot audio re-render, no waveform editing. If a model produces
silence, the product says so and moves on.

---

## Piece 2 — A work area that starts blank and fills up

### The problem, restated

All four views — References, Table, Board, Cut — exist from the moment a project is created, each
showing an empty frame. The owner is asked to choose between four empty rooms before anything has
happened.

### What is already true

`STUDIO_VIEWS = ['references', 'table', 'board', 'cut']` (`creativeStudioTypes.ts:28`).

Three mechanisms already exist that this work should extend rather than replace:

1. **A view-less entry already exists.** `studioProjectPath(projectId)` returns `/studio/:id` with
   no view segment, documented as _"A view-less entry lets the loaded project decide whether
   first-time reference work comes first."_ The deferred-decision route is already there.
2. **The entry decision is already a function.** `defaultStudioView(hasReferenceWork)` →
   `'references' | 'table'`, and `resolveStudioEntryView` prefers a remembered choice
   (`readLastStudioView`) over the default. Content-awareness slots into this one function.
3. **The content signal already exists and is already computed.** `getProjectStatus` returns seven
   stages — `brief, engines, references, storyboard, bindings, production, cut` — each in state
   `not_started | in_progress | complete | blocked`. They map onto the views almost one to one:

   | View       | Backing stage(s)         |
   | ---------- | ------------------------ |
   | References | `references`             |
   | Table      | `storyboard`, `bindings` |
   | Board      | `production`             |
   | Cut        | `cut`                    |

   No new read model is needed. A view has content when its stage is not `not_started`.

### The trap that must be respected

`STUDIO_VIEWS` is shared with the **main process**, which builds a regex from it to gate the
unsaved-work preflight. The comment at `creativeStudioBridge.ts:249-253` states the consequence
plainly: _"a Studio document parked on a segment it does not match closes with no prompt and loses
the drafts."_

**Therefore: do not invent a new `/studio/:id/start` segment.** A blank state must render on the
existing view-less path (`/studio/:id`), which the preflight already covers, or the feature ships a
silent data-loss bug. This is the same false boundary recorded in memory — "renderer-only" is not a
real boundary for the view vocabulary.

### Decisions

**D3 — Unready views stay visible but disabled, with a reason.** Hiding them would make the product
feel like it is growing new features at random and would hide the shape of the work. The complaint
is emptiness, not the existence of the chips. A disabled chip that says why — _"Nothing to produce
until the Table is set"_ — teaches the sequence instead of concealing it.

**D4 — Auto-reveal, but never yank.** When the Director produces content, move the owner to that
view **only if they have not made an explicit view choice for this project**. `rememberStudioView`
already records explicit choices, so the rule is: auto-advance while `readLastStudioView` is null;
stop the moment the owner chooses for themselves. Switching a view under someone mid-edit is the
kind of thing BUG-160 taught us to avoid.

### Slices

**S5 — Per-view readiness derived from status stages.** _(small)_
One pure function: status → which views have content. Fully unit-testable with no UI. Land it
first so the rest is wiring.

**S6 — A blank work area with instruction copy.** _(small)_
On `/studio/:id` with every stage `not_started`, render a single quiet panel telling the owner what
happens next — the Director drafts from the brief — instead of four empty frames. Reuses the
existing view-less route, so the main-process preflight already covers it (see the trap above).

**S7 — Disable the views that have nothing.** _(small)_
Apply S5 to the view chips. A disabled chip carries the reason. Direct navigation to a not-ready
view must be handled explicitly: render its empty state with the same reason, never a blank frame
and never a silent redirect that loses the URL.

**S8 — Auto-advance on first content.** _(medium)_
Apply D4. The risky part is not the navigation but the guard, so the tests are the point: an owner
who has chosen a view is never moved.

**S9 — Retire the References one-time transition.** _(small, cleanup)_
`hasOpenedStudioReferences` and its storage key exist to fire a one-time first-run jump to
References. Once S5–S8 land, that is a second mechanism doing the same job from a worse signal
(local storage rather than project state). Removing it prevents the two from disagreeing.

---

## Sequencing

S1 → S2 → S3 are independent of S5 → S9 and can run in parallel; they touch disjoint files.

Within Piece 2 the order matters: **S5 first** (the signal), then S6/S7 (which consume it), then S8
(which needs S7's readiness to be trustworthy), then S9 (which is only safe once S8 replaces it).

Two open bugs sit adjacent to this work and should be fixed alongside rather than around:
**BUG-167** and **BUG-170** are both "not loaded yet" rendered as an assertion of unavailability.
S6 introduces a third empty-state surface, so the three want one shared treatment — a quiet loading
state that never claims something is unavailable when it is merely not fetched.

## Estimate

Piece 1: S1–S3 are each under half a day; S4 is deferred.
Piece 2: S5–S7 under half a day each, S8 about a day for the guard and its tests, S9 an hour.
