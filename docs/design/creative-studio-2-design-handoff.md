# Creative Studio 2 — Design Handoff

A record of the design conversation for the people who will build it: the model, the
principles, the decisions we argued through (including the rejected ones), and the
questions still open.

> **Revised 13 Aug 2026** after engineering's response against `feat/studio-three-pane @ 87a998761`.
> Corrections are folded into the text below; §9 records what changed, the decisions their
> questions forced, and the two items now on the design side.

Companion documents:

- **Creative Studio 2 — Transition Plan** (`Creative Studio 2 - Transition Plan.dc.html`) — the four-phase sequence.
- **Table and Board (hi-fi)** (`Creative Studio 2 - Table and Board (hi-fi).dc.html`) — the target state, clickable.
- **Board and Cut — Wireframes** (`Board and Cut - Wireframes.dc.html`) — the alternatives considered, newest exploration first.

Source of truth for the current app: `khoapnt-vng/WePrompt`, branch `feat/studio-three-pane`.

---

## 1. The shape of the product

Creative Studio is **two components against one contract**:

1. **The Creative Director** — an agent that reasons about the work: interrogates the
   brief, proposes the shot spine, critiques the script against the brief, writes and
   rewrites visual prompts, and judges pacing.
2. **The app** — a working canvas the user drives directly.

Both act on the same project through the same tool surface (MCP). The director is not a
chat panel bolted onto an app; it is a second operator of the same controls. That is the
structural decision the whole design rests on.

### Target audience

The bet is **1–5 minute videos, 8–10 sections**: game trailers, feature walkthroughs,
training pieces. Not 5–15 second social clips (WePrompt will do them, but they are a
different product shape — CapCut territory).

VNGG (games) over VNG Corporate, for one reason: **a game studio already owns its
reference material.** Key art, character renders, environment captures, a style guide.
That turns the hardest problem — consistency — from a model problem into an ingest
problem. Corporate B-roll is the same product with the cast shelf empty.

---

## 2. Principles

**Order is the content.** Reading order equals play order, always. Nothing floats, nothing
can be arranged into a lie about the sequence.

**Free is direct; money asks once.** Every edit that costs nothing (writing, retiming,
reordering, rewriting prompts) the director may apply directly, with undo. Anything that
spends confirms first, always with what will run stated plainly. The assistant may never
trigger a paid call on its own.

**Undo is not optional.** Direct agent edits without reliable per-edit undo are worse than
proposals — that is a liability, not a collaborator. This constrains the MCP contract (see
§5).

**Two-layer transparency.** A plain-language summary of what the director did, with an
expandable log of the actual tool calls underneath.

**Say the consequence before it runs, never after.** Stale downstream clips, missing takes
exporting as slates, rule breaches — all surfaced ahead of the action.

**The unit of change is the shot, not the frame.** Anything wrong inside the frame is fixed
by regenerating, never by editing pixels. This is what keeps the product from drifting into
being a worse Premiere.

---

## 3. The model

### Objects

```
Project
├── Brief            (context + rules + cast + look + format)
├── Section          8–10 per project; the story beat
│   ├── story line   short description of what the section does
│   ├── visual prompt  the look every clip in it inherits
│   └── Clip         3–4 per section; one generation each
│       └── Take     one rendered attempt; several per clip
└── Cut              the assembly: order, trims, one music bed
```

**Why sections exist.** A 3-minute video is not 30 shots of 6s — it is 8–10 sections of
20–40s, and the engine cannot generate a section in one go. So one card cannot be one
generated clip. The level between is the single biggest structural difference from a
teaser-shaped tool.

**The clip is bounded at both ends.** The live binding (`bytedance/seedance-2.0`) runs
**4–15 seconds**. The ceiling shapes how many clips a section needs; the floor is the one
that changes the design. **There is no such thing as a 2-second clip.** A title snap or a
one-second cut-in must be a trim of a longer generation, or a still held on screen — never a
clip of its own. Duration inputs must refuse sub-4s at authoring time rather than at render,
which is after the money.

### The Brief is a CLAUDE.md, not a form

This is the sharpest idea in the design and the most defensible thing in the product.

- It is **loaded into every director turn**, not read when opened. Its job is to be small,
  human-readable and always in context.
- It **accumulates from conversation**: say "keep the kits generic" and the director offers
  to pin it as a rule. Nobody goes back to edit a brief form.
- It has **scope levels**: organisation rules (VNG-wide, locked) and project rules, with
  explicit precedence — _what you say in the thread wins for that section, then project
  rules, then the organisation's_.
- **Rules are the executable part.** Prose is context; pinned rules are predicates run
  against every visual prompt before it renders. Everything else in the brief is context the
  director reads.
- New sections **inherit** format, length, look references and cast.

It is called "the Brief" because that is the word the users already use. The redesign's
change is that it stops being a form, not that it stops being a brief.

### Two views, no canvas

**Table** is the primary authoring view for this segment: story line, visual prompt, clips,
length, state. **Board** is the visual check: an ordered grid that wraps, drag to reorder,
three discrete card sizes instead of zoom. A **shelf** at the bottom of the board parks
things that are not in the video — alternative openings, cut sections, unattached refs;
deleting a section moves it there rather than destroying it.

We explicitly **cut the spatial canvas**. Reasoning in §4.

**Cut** is the third view: play the assembly, swap takes, trim, reorder, one imported music
bed, sections without clips holding their time as slates, plus _match to_ for colour drift.
It can change _when_ something plays; it can never change what is in the frame.

---

## 4. Decisions, with the reasoning

### Phases became views

The old Brief / Script / Produce / Review rail described four things that are not four
stages. Brief is an object, not a step. Script is the resting state of the product. Produce
is not a place but a **threshold** — money — which deserves a gate, not a tab. Review is a
**view mode** over the same objects.

What the rail was genuinely carrying is "what do I do next". That becomes a state readout
(`9 sections · 2:58 · 2 ready`) rather than navigation.

### No spatial canvas

A canvas buys free arrangement, spatial memory, and somewhere to park things. Only the
third is real here, and a shelf does it.

It costs a transform layer, coordinate math, drag with persisted positions, marquee
selection, hit-testing in transformed space, zoom-dependent rendering, fit/minimap, and
gesture handling — roughly an order of magnitude more than a grid with drag-to-reorder.
The larger cost is the ongoing tax: every subsequent feature must work at any zoom and
scroll position.

Two non-obvious savings: **the MCP surface gets simpler** — with a canvas, every tool that
adds a section must invent an x/y, and users will find the model's arrangements subtly
wrong; `add_section at index 3` is unambiguous. And **positions vanish from the state
file**, which is the one file that can conflict on a synced folder.

### The Cut assembles; it does not edit

Inside the line: play, swap takes, trim head/tail, reorder, retime, slates, one music bed,
export. Outside: multi-track timelines, keyframes, transitions beyond a cut, colour grading,
per-clip crop.

Today's Review inspector ships crop scale and exposure. Those come out — they invite users
to fix generation problems with editing tools, which produces worse results slower.

Where the real pain is: cut **rhythm** — two sections landing on the same beat, a title
running long. That is timing, which sits inside the line, and the director is better placed
to catch it than a trim handle is.

### Coherence is the product problem

A teaser fails because four clips look like four unrelated clips, not because the timeline
was hard to use. Prompt wording is the **weakest** lever. In order of what actually works:

1. **Last frame → first frame.** Render clip 1, feed its final frame as clip 2's starting
   image. The engine continues from a pixel state rather than a description. Within a
   section, clips are a _chain_, not a set.
2. **Shared conditioning.** Same cast image, look references, engine, aspect, seed family.
   Two clips with identical refs and sloppy prompts match better than two with careful
   prompts and different refs.
3. **Cut on a change, not through one.** Motion continuing across a cut always betrays a
   mismatch; an angle or scale change hides it. A writing rule the director applies when it
   splits a section.
4. **Match at the end.** Small colour/brightness drift is normal and belongs in the Cut.

**How images actually reach the models** (grounded in `docs/guides/creative-studio-provider-contract.md`):
the video side takes exactly one image, in the `first_frame` role, gated by
`supports_first_frame`. There is no separate character-reference input. So consistency is
two-stage: the **still** stage combines cast + look + prompt in an image model that accepts
several references; that still becomes clip 1's `first_frame`. Cast reaches the video model
as pixels, never as words.

Consequence: the cast image belongs to the _still_, not the clip. Attaching it to a video
clip on a route without `supports_first_frame` silently does nothing — the UI must say so
rather than pretend.

Consequence: **the still stage means every project needs at least two live routes** — an
image route and a video route — by construction. That makes route selection a prerequisite
for coherence, not a setting (see §9).

Consequence: **re-rendering a clip makes everything downstream stale.** Stale is a state,
not an error — the clips still play — and the user is told before the re-render runs, with
the choice to leave them or re-render the chain.

### Export, not handoff

Three shapes: **one file** (stitched, bed muxed, slates burned), an **editor folder**
(numbered clips + script + audio, for someone who will finish it properly), and a **still**
frame. Exports are **versioned artefacts kept with the project**, not one-shot downloads —
"which file did I send them?" needs an answer.

Export is not a peer of Render in the top bar. It costs nothing and happens once, so it
lives in the project menu (and at the end of the Cut). The top bar holds one money control
and the view switch.

### The project is a folder on disk

```
~/Movies/WePrompt/<project>/
├── brief.md            the rules, the look, the cast list
├── script.md           one section per heading, human-readable
├── sections/01_cold-open/clip-1.mp4 …
├── refs/ · cast/ · audio/ · exports/
└── .studio/            state, revisions, job history   (ours alone)
```

Named so an editor who never opens WePrompt can work the folder. The assets drawer is a
view of it, with reveal-in-Finder and no import step. The director reads this folder and
writes nowhere else.

**Folder location:** asked once at first run (default `~/Movies/WePrompt/`), never again —
project creation must not become a save dialog. The path is always visible in the assets
drawer, renaming the project renames the folder, and _Move project…_ exists for people who
care.

**Two machines: tolerate, do not support.** People will put this in Drive or Dropbox.
Takes, stills and refs are immutable — written once, never modified — so sync handles ~90%
of the folder by construction. Add a heartbeat file in `.studio/` for one-writer-at-a-time
("open on Khoa's MacBook — open read-only, or take over"; stale heartbeat means takeover),
and atomic state writes with reload-on-conflict, never auto-merge. Do **not** build
real-time collaboration or a merge UI; that is a server, and a deliberate later decision.

**Folder not found** (unplugged drive, moved folder) is a state, not data loss: the script,
brief and rules survive because they are text we also keep. Offer _locate_ or _work without
media_; never look empty and never silently recreate the folder.

---

## 5. What this asks of engineering

**The one contract change that gates everything else.** `propose_storyboard` today is a
whole-script replace. Direct director edits with per-edit undo need a **granular apply with
inverse operations** — `apply_script_changes` taking a list of ops (`add_section`,
`edit_prompt`, `retime`, `reorder`, …), each returning its inverse, applied against a
revision guard. Without this the "everything free is direct" principle cannot ship, and the
director falls back to proposals.

**Undo is revision-aware, not a stack.** The revision counter bumps on every persist, so an
inverse computed at revision 14 is not valid at 19. Undo applies the inverse as a **new
forward operation under a fresh guard** — never a stored-inverse replay. A naive stack fails
intermittently under exactly the conditions this design cares about: the director editing
while the user types.

**Version the proposal record before the model moves.** `validateProposalRecord` rejects
unknown keys outright, and `SCENE_KEYS` / `CUT_KEYS` / `ROUTING_KEYS` move in lockstep with
any section/take change. Proposals already on disk become unreadable, and an unreadable
proposal is skipped rather than reported — a silent failure. Versioning the record is part of
phase 2, before the model change lands.

**Data model:** section → clips → takes. Existing scenes migrate to sections holding one
clip each. Every phase ships with a migration; no export-and-reimport is ever asked of
users.

**Render pipeline:** rule check before dispatch; chain ordering (head to tail within a
section); frame extraction for `first_frame`; staleness as a first-class state.

**Capability honesty:** the gate already exists and already refuses the reference
(`routeSupport.ts`). What is missing is the _explanation_ in the UI — say the chain is
unavailable on this route, rather than dropping it silently.

**Route selection has no surface.** Two bindings of one media kind leaves the project with no
route and generation blocked, with no in-app cure. The picker component exists in code and was
never wired to anything. This sits inside phase 3's critical path — see §9.

**Render must refuse to lie about completeness.** A cut can currently be rendered while shots
are still generating, producing a short film with no warning. `renderService` already computes
`missingSceneIds`; it is simply not surfaced. Same principle as the export gap warning: say the
consequence before it runs.

---

## 6. Deliberately not in scope

- **A spatial canvas.** An ordered grid does the job at 8–10 sections for a fraction of the cost.
- **NLE features** — multi-track, keyframes, grading, per-clip crop.
- **Aspect-ratio variant sets** (one cut → 16:9, 9:16, square, per-language). Real value for
  game trailers, and the obvious next thing after the four phases — but its own decision.
- **Voiceover / TTS.** There is no text-to-speech in the app today; `narration` is authored
  everywhere and goes nowhere downstream. The audio-lane brief already sets the shape:
  per-section TTS, one imported music bed, film-wide mix with one auto-duck, generated music
  out, `voice` as a fourth media role. It is a lane of its own, not a step in this sequence.
  Note this changes the `LENGTH` column: derived read time only becomes true once TTS
  returns real durations.

---

## 7. Open questions

1. **Which TTS routes are reachable with keys users already have?** Determines whether voice
   is a sprint or a procurement exercise.
2. ~~Where does section duration come from?~~ **Settled: sum it from the clips.** With a hard
   4–15s clip range, a freely typed section length invites numbers the engine cannot produce.
   The section shows the sum; a target length is an _intent the director works toward_ by
   proposing a clip split, not a value the model must satisfy.
3. **Does a real VNGG project have 9 sections or 40?** Everything here is designed for the
   former. The grid holds at 40; two other things do not. **Generation is sequential** —
   40 sections × 3–4 clips is 120–160 generations in series, hours rather than minutes, and the
   first-frame chain requires head-to-tail order within a section so it cannot be fully
   parallelised away. And **the brief-in-every-turn premise degrades** when the script itself is
   most of the context. Answer before the build.
4. **Will users trust a director that edits directly**, or will they want proposals? We chose
   direct-with-undo because it is faster and feels like a collaborator — but it only survives
   if the model's judgement is good. If its rewrites are mediocre, people will not ask for
   proposals; they will stop using the director.

   **Refinement forced by latency.** A director turn measured 82 seconds. That is fine for
   "propose the spine" and absurd for "retime section 3", which the user does in five. So the
   free-is-direct principle scopes by **tedium, not cost**: the director owns bulk work — retime
   everything, rewrite nine prompts against a changed rule, split a section into clips — and
   stays out of single-field edits. First output at ~2s means progressive display is doing real
   work and must survive into the new shell.

---

## 8. Honest assessment

**Strongest:** the brief with enforced rules. It is the one thing nobody else is doing, it
gets more valuable with scale, and it is cheap — prompt assembly plus a check step, no new
media stack.

**Second strongest:** the money rule. Free is direct, paid confirms. Simple enough to hold in
your head, and it protects against what kills these products: quiet spend.

**Biggest risk:** output quality is upstream of everything we designed. A good board and a
clean cut do not help if four generated clips do not look like they belong in the same film.
That is why phase 3 exists and why it should not be deferred.

**Watch:** the director's value is highest at the start — interrogating the brief, proposing
the spine — and drops once sections exist. There is a real chance the rail is empty space for
most of a session.

**If only two phases happen: one and three.** A tool that produces four matching clips inside
the old shell beats a beautiful shell around four that do not match.

---

## 9. Revisions after engineering review (13 Aug 2026)

Checked against `feat/studio-three-pane @ 87a998761` and a real end-to-end run.

### Corrected in this document

- **Clip duration is 4–15s, not "caps around 10s".** The floor is the consequential half: sub-4s
  beats are trims or stills, never clips. Folded into §3.
- **The "silent output" defect claim is withdrawn.** The review modal does branch on
  `silentOutput`; if the symptom is real it is upstream in how that flag is derived. Removed
  from §5 rather than sending someone to already-conditioned code.
- **Capability honesty is smaller than described** — enforcement exists, explanation does not.
- **Noted, not a defect:** rendered files carry a silent AAC track. The picture has no sound; the
  file has a silent track. Worth saying precisely in copy.

### Decisions their questions forced

**Section duration sums from clips.** See §7 Q2.

**The folder is readable, and selectively writable.** The promise needs a boundary, so:

| Path                                                    | Direction   | Meaning                                                                                                                                                     |
| ------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brief.md`                                              | **source**  | Hand-edited. The app reads it; an outside edit is respected. The CLAUDE.md analogy requires this — a brief you cannot edit in a text editor is not a brief. |
| media folders (`sections/`, `refs/`, `cast/`, `audio/`) | **source**  | Drop a file in Finder, it appears. Files are immutable once written.                                                                                        |
| `script.md`                                             | **derived** | A readable mirror, rewritten on every change and labelled as such in a header comment. Editing it is not a way to change the script.                        |
| `.studio/`                                              | **ours**    | State, revisions, job history. Rebuildable in part, authoritative for order and links.                                                                      |

Rationale: brief text and media are things humans author, so they must round-trip. The script
carries structure (order, clip boundaries, chain links, take selection) that a text file cannot
hold losslessly, so parsing it back invites silent loss. If engineering wants script.md writable
later, that is a format decision — a real schema — not a default.

**Crop and exposure: drop from the model.** Removing the UI while `CUT_KEYS` still admits the
values leaves data nothing can edit and a renderer that still honours it. Migration zeroes them and
the keys come out. Any pre-existing non-default values are worth a one-time note to the user rather
than silent loss.

### Sequencing change

**Route selection joins phase 3's critical path.** Coherence needs an image route and a video route
live simultaneously, and today two bindings of one kind can leave a project with no route and no
in-app cure. If phases 1 and 3 are the two that ship, route selection ships with them.

### Now on the design side

1. **A route-selection surface** — where a user picks between two video engines, what it looks like
   when a project needs an image route _and_ a video route, and what the no-route state says. To
   design next.
2. **Wireframe 9c (stale badge, chain break) is approved to build as-is.**

### Phase 3a: provider-neutral still stage — owner decisions (15 Aug 2026)

The owner approves the following Phase 3a reference-management contract. This approves the product
decisions, not provider spend or broad provider capability claims. The separate still-to-clip
admission gate is complete for the route-specific **On the Pitch** OpenRouter control: its Q1 frame-0
comparison passed and the Q2 owner verdict was **“different but feel like the same for sure”**. It
therefore admits Phase 3a Task 1, while each paid still and clip keeps its existing explicit
confirmation.

The separate multi-input image-capacity proof subsequently passed through the reviewed product path
for exact provider `d1ff983b`, adapter `weprompt-image-v1`, model
`google/gemini-3-pro-image`, at a maximum of two ordered inputs. Task 8.5 is complete for that exact
tuple; every near miss remains fail-closed at zero. A later cartoon reference still independently
succeeded with the same Cast-then-Look count. This narrow evidence does not transfer to another
provider, adapter, model or integration, and does not establish direct-video multi-reference input.
The final Task 9 different-action/two-clip acceptance remains deferred.

1. All active Brief references apply to every new reference plate; 3a has no per-scene subset picker.
2. Cast and look are organisational roles, not provider parameters. Main orders cast before look, then
   `createdAt`, then `id`, and the paid plate review names the ordered inputs.
3. Six is the application ceiling for active Brief references. A route may truthfully admit fewer
   (including zero); a seventh import is refused without mutation until one is detached.
4. Import gives each reference a stable, sanitized basename label, suffixing duplicates under the
   project revision guard. Rename and reorder are deferred.
5. “Remove from Brief” is non-destructive: it clears the Brief classification while retaining the
   project-level managed import. This slice adds neither delete-file nor reclassification browsing.
6. A generated reference plate durably records its admitted visual prompt, ordered Brief-reference
   IDs, aspect ratio, and resolution. Complete provenance becomes out of date when any of those
   frame-defining inputs changes; legacy or incomplete provenance remains usable with freshness
   reported as unknown. This is not Phase 3b predecessor or continuation staleness.
7. Spend stays two-stage: the user separately confirms the named still with its named cast/look inputs,
   then the named clip with its selected first frame. One confirmation never hides two provider calls.
8. Changing Brief references does not delete a plate or invalidate completed takes. It may mark a
   selected generated plate out of date for a future clip render, for which the user may retain it.
9. A queued Director reference request auto-submits only with no active Brief references. If it would
   use cast or look inputs, it opens the same exact paid review as a user-initiated plate; this is a
   Phase 3a / Level 0 rule, not a budget, grant, or run-envelope model.
10. Phase 3a uses a still stage even where a video route may later offer direct references: cast/look
    inputs condition only the image plate, and the video route receives only that selected plate as
    its first frame. This preserves a provider-neutral path compatible with the planned Phase 3b
    chain and does not assert support, incompatibility, or cost for any unverified provider route.

Phase 3a stays on the current flat scene model. It does not add sections, the Phase 3b last-frame
chain, filesystem watching or a new cast/refs folder workflow, a direct-video reference mode, or
Director write, selection, polling, budget, or run-grant authority.
