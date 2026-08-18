# Creative Studio 3 — direction, and answers to engineering

Companion to `Creative Studio 3 - Beat and Shot.dc.html`. Written in response to the
review questions on that prototype. Where an answer changes CS2's contract, it says so.

---

## 1. What CS3 is

CS3 is not a new product. It is CS2's model corrected on three points that came out of
using it.

**The vocabulary was wrong, and the vocabulary was doing damage.** "Clip" is not film
vocabulary — it is NLE vocabulary, meaning _footage I acquired_. Our object is a planned,
continuous run of camera bounded by cuts, which is a **shot**. "Section" is a document
word. A 20–40s unit that lands one idea is a **beat**. So:

| CS2                           | CS3                                   |
| ----------------------------- | ------------------------------------- |
| Section                       | **Beat**                              |
| story line                    | **Action**                            |
| visual prompt (section)       | **Look** — conditioning, not a prompt |
| Clip                          | **Shot**                              |
| Take, Cut, Cast, Slate, Board | unchanged (already correct)           |
| Shelf                         | **Bin**                               |
| 0 clips                       | **no coverage**                       |
| stale link                    | **continuity break**                  |

Two words this buys us that CS2 lacked: **coverage** (the set of shots that covers a beat —
"does this beat have coverage" is the real question a `0 clips` count was failing to ask)
and **continuity** (what the first-frame chain protects).

The boundary that holds: **film words for what the user authors, machine words for what the
machine consumes.** Beat, shot, take, cut, coverage, continuity are film. Prompt, seed,
route, first frame, render stay machine. Do not dress "prompt" up as a "direction".

**The beat owns its own cut.** In CS2 the Cut owned all timing. In CS3 the beat's coverage
bar is also its cut: dragging a boundary changes what each shot _generates_, dragging a
shot's edge trims what _plays_. This is the shape of the change, and it narrows the Cut view
to film-level work only — beat order, one bed, match-to, export. The Cut can no longer reach
inside a beat. Three things move out of the Cut as a result: trims, retiming, and take
selection.

**The division of labour follows perception, not policy.** The director cannot watch 30
seconds of video and tell you a cut works — that judgement is about sub-second behaviour at
a boundary, and frame-sampled video understanding is weakest exactly there. It _can_ judge
stills and text. So:

- **Director** — anything derivable from text or stills: research, the spine, coverage,
  prompt writing and rewriting, rule checks, time arithmetic, last-frame/first-frame
  comparison.
- **Human** — anything needing motion: whether the cut works, which take is good, rhythm.

Stated as a rule: **the director acts before the picture exists; the human decides after it
does.** This replaces "free is direct, money asks once" as the _organising_ principle (that
rule still governs spend). It also explains, rather than laments, CS2 §8's observation that
the director's value drops once sections exist — it drops because pixels arrive and it
cannot see them.

---

## 2. The two answers that decide the plan's shape

### 2.1 The Director survives as a conversation — but not as the centre

Yes, keep one persistent Director conversation. It is absent from the prototype because it
was **deliberately left out of that build**, not because it was cut. Do not estimate from
its absence.

What changes:

- **It is a conversation, not a service.** Research, interrogating the brief, proposing the
  spine, writing coverage — these are multi-turn and they need history.
- **It lives in one place.** Drop the layout system that moves one conversation owner
  between docked, split, and narrow-full-screen without remounting. That machinery existed
  because the conversation was the product's centre. It is not: it is loudest before any
  picture exists and quiet afterwards. One docked rail, collapsible. **Task 8 shrinks to a
  collapsible rail.**
- **Task 5 gets more important, not less.** Every hand gesture in the new bar — trim,
  retime, reorder, select take, split coverage — must also exist as an MCP op, _including
  the ones the director should not call yet_. Build the tool surface for the director you
  will have in two years; expose the UI for the director you have now. An unused tool costs
  almost nothing; an operation that exists only as a mouse gesture costs a rewrite when
  video understanding lands.
- **Proposal cards survive.** Required actions do not: the two that mattered are now gates
  living in the views (the render gate, the chain gate), where the consequence is.

### 2.2 Beat duration: authored **target**, derived **actual**, never the same field

CS2's rule stands — duration is derived from shots and is never a competing
author-editable value. What was missing is a second, different thing:

- **`actual`** = sum of shots' played duration (source minus trims). Derived, authoritative,
  what the Cut and the film total use. Beat 03 = 31s because 10+10+11.
- **`target`** = nullable authored **intent**, not a constraint. Beat 05's 24s is this. It
  is what the director works toward when it proposes coverage, and it is what "2s UNDER"
  compares the film against. It never constrains shot durations and the engine never has to
  satisfy it.

Consequences, all deliberate:

- Shot durations stay free within **4–15s**. Nothing forces them to sum to the target.
- The two must be **visually distinct**. In the prototype they currently render identically
  in `LENGTH`, which is the defect this answer exists to prevent. Target should read as an
  intent (e.g. `~24s target`), actual as a fact (`24s`).
- Re-splitting coverage changes `actual` and leaves `target` alone. That is the point: the
  gap between them is the director's cue.
- A no-coverage beat's slate **is** `target` seconds long. So it is a promise, and it is the
  only case where an authored number reaches the renderer.

---

## 3. The chain

**Re-rendering shot N marks N+1…end stale, not invalid.** Stale is a state, not an error —
they still play. Cascade is opt-in and must be _quoted_: the render gate cannot show a flat
total when the honest choice is "this shot, or this shot and the 2 downstream". Two lines,
two prices. This is a required change to the gate as drawn.

**`CONTINUITY BREAK` is system-detected**, and only that: the frame a shot was generated
from no longer exists, because upstream was re-rendered or had its tail trimmed. An
author-chosen break in the chain is a _different thing_ and needs its own name — call it a
**hard cut** — because "cut on a change, not through one" means authors legitimately want
breaks. Conflating the two makes a deliberate choice look like an error.

**Tail trims break continuity; head trims do not.** Trimming a shot's tail changes the frame
the next shot started from. Trimming the head discards frames just after the seed frame and
nothing downstream depends on them. So trim is free in money and asymmetric in continuity:
head always free, tail free only on the last shot of a beat. The prototype implements this
warning.

**Mid-chain failure: keep the partial, bill only completed generations, resume from the
break.** `PART DONE` needs a resume affordance, which is undrawn — that is a real gap, not
an inference.

**`STARTS FROM THE STILL`**: the head shot of every beat conditions on a still generated
from cast + look + that shot's prompt on the **image route**. Stills are takes too — several
per shot — and the user picks; default is the latest. This is why every project needs two
live routes by construction (CS2 §4).

**Chains are strictly beat-scoped. Freeze it as an invariant.** Beats are therefore the unit
of parallelism: a project at the cap is 24 parallelisable groups rather than one long series.

**Reordering shots inside a beat rewrites the chain**, so it invalidates downstream frames —
**reorder inside a beat is not free.** Reordering _beats_ is free. These are different
operations and the UI must not make them look alike.

---

## 4. Derivation

**Detach is reversible.** `RE-DERIVE FROM THE ACTION` is in the beat panel. On re-derive the
hand-written line goes to the beat's **line history** — not the Bin. See §10.3.

**Editing the Action** leaves detached lines untouched and marks derived lines stale against
the Action's revision. **Re-splitting** writes detached text to line history. No path
discards authored text — that is the rule, and §10.3 says where it goes.

**Derived text is stored, not recomputed.** It must survive offline, be diffable, and be
readable in `script.md`. Therefore it carries a staleness flag against the Action revision,
same mechanism as the chain's staleness.

**`WIDE` / `MEDIUM` / `NARROW` are not presets or Director requests.** They are automatic
density tiers computed from the measured pixel width of the coverage bar — the whole bar
commits to one tier, taken from its narrowest segment, the same way the Board has three card
sizes instead of zoom. Nothing to persist, nothing to choose.

---

## 5. Narration — explicit ruling

Keep `narration` and `onScreenText` as authored fields on the Shot. Do **not** drop them:
CS2 has them, users may have typed into them, and dropping them is a migration with data
loss for no gain.

But be honest about them: they have **no downstream consumer** until TTS lands, and the
prototype does not draw them. Two immediate consequences:

1. **`AUTO-DUCKED` is wrong today and must come out.** There is nothing to duck for. It
   returns with voice.
2. This is the product's biggest functional gap, not a cosmetic one. A three-minute _feature
   walkthrough_ is a narrated format by definition. Without voice the tool produces a mood
   piece with a music bed. The audio lane is its own sequence, not a step in this one.

---

## 6. Cut capabilities — descope honestly

| Item                               | Ruling                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONE FILE · STITCHED WITH THE BED` | ffmpeg-class (concat + mix + fade), spiked out and unbuilt. Needs a scope and an owner. If it cannot ship, the Cut offers the **editor folder only** and the one-file option is hidden — never shown and failing. |
| `MATCH TO`                         | v1 is **prompt-level**, therefore a re-render, therefore costed. The UI must say so — it currently reads as a free grade. A real colour pipeline is a separate, later decision.                                   |
| Bed 3:04 vs cut 2:58               | **Fade out at the cut's end.** Never extend, never hard-truncate.                                                                                                                                                 |
| Export retention                   | Keep the last **5 per shape**, oldest evicted, counts against project size, listed in the assets drawer with its size.                                                                                            |

---

## 7. Inherit or restate

**Bin = Shelf, and it inherits the hardened shelf invariants** (XOR membership, alias must be
a canonical non-selected non-cut take, per-kind maxima). Two item kinds, and both must be
labelled — the prototype tags one and not the other:

- **Lifted** — was in the film, removed. ("Store walkthrough")
- **Alternate** — never in the film. ("Alternative cold open")

**Limits** — carry CS2's, renamed: **24 beats**, **8 shots per beat**, **96 shots** per
project.

**The 25-word Look cap is soft.** The counter warns; word 26 is allowed. It is guidance about
what conditioning is for, not a predicate. Hard blocks on prose invite workarounds
(abbreviations, run-on compounds) that make the output worse. Rules are hard; guidance is
soft, and the Look is guidance.

**Spend.** Two paid entry points, one predicate set:

- Estimate = route price × seconds × generations, and it must be a **range**, not a point,
  once takes are in play. Nobody gets 16 shots right first time; a quote that says $6.40 and
  bills $18 is worse than no quote. Quote the first pass and state that revisions are extra.
- All three numbers in a gate — headline cost, generation count, button label — must come
  from **one set of shots**. In-flight work is context, never billed again.
- Reconcile after: actual charge per take in the assets drawer; if actual exceeds estimate by
  more than 20%, say so unprompted.
- **A budget cap belongs in the Brief as a pinned rule.** "Keep this under $10" is a
  predicate checked before dispatch, the same mechanism as "no real club crests". This is the
  honest answer to "I don't know what this will cost": you tell it what it may cost.

**Undo is still the open gap.** `RESET` in the beat bar means: revert _this beat's_ shot
lengths, trims, and derived prompts to last saved. Nothing else. Everything else needs the
revision-aware undo from CS2 §5, and CS3 adds destructive moves CS2 did not have —
re-split, detach, lift, changing match-to. The Bin protects beats, takes, and (per §4 above)
authored text. It does not protect coverage or joins. Those need undo.

---

## 8. Take the simplification

**CS3 claims schema 2.** Agreed, and for the reason given: no user has ever persisted a
schema-2 record, the cutover is Task 6, work is at Task 3, and Studio is behind
`AIONUI_ENABLE_CREATIVE_STUDIO`, off by default. Deleting a version, a sniff branch, and an
unsupported state is worth more than the tidiness of a version number that matches the
product name.

---

## 9. Still undrawn, and known to be

Listed so nobody estimates around a gap they think is a decision:

1. **The Director rail** — deliberately out of the prototype.
2. **Route selection** — still the design item from CS2 §9.
3. **`PART DONE` recovery** — the resume affordance from §3.
4. **Target vs actual duration** — needs distinct visual treatment per §2.2.
5. **Narration fields** — see §5.
6. **Undo** — see §7.

---

## 10. Second round — blockers, contradictions, and the question I answered wrong

### 10.1 Frame extraction is on the critical path. §6 was wrong to imply otherwise.

Correct: the chain cannot advance without the last frame of the previous take, so this is
core authoring, not export. §6's descoping applies to **stitch/mix/fade** only.

**Ruling: the last frame is a persisted asset, not a runtime value.** On take completion,
write `beats/<n>/shot-<k>/take-<t>/last-frame.png` into the project folder. Nothing in the
chain reads a frame from memory.

That one decision dissolves the renderer/main problem. Source order of preference:

1. **Provider-returned last frame** — check Seedance first. If it returns one, prefer it: it
   is the pixels the engine actually ended on, not our re-decode of a compressed file.
2. **Main-process decode** — for headless, window-closed, and recovery paths.
3. **Renderer canvas capture** — `useStudioVideoPosterCapture.ts`, already proven untainted
   by the poster spike. Cheapest, and fine as the happy path.

**Invariant: no chain advance without the frame asset on disk.** Because takes are immutable
and already on disk, a missing frame is always **re-extractable** — so closing the window
mid-chain stalls the chain rather than losing it, and job recovery is "is the frame file
there? if not, extract it" rather than "re-render". Main needs a decode path, but only as a
recovery step, not as the primary loop.

This does mean frame extraction must be a **named job step** with its own state, not a side
effect of render completion.

### 10.2 Money: build the rate card, drop the reconciliation

Agreed, none of it exists. Three rulings:

**Price source is a config rate card** — per route, per second, with an explicit currency
field, owned by whoever owns route bindings. Not a provider API in v1. The UI must say the
number comes from our rate card, not from the provider.

**Drop reconciliation. It was theatre and the critique is correct** — if actual is computed
from the same table as the estimate, the two can only differ by generation count, which we
know before dispatch. The ">20% over, say so unprompted" rule is **withdrawn**.

**Replace it with a receipt, which is honest and useful.** Per take, persist what actually
ran: route, seconds, generation count, and the rate in force at the time. That gives the
assets drawer "this beat cost you N" without claiming to know your bill. If a provider later
returns real billing data, reconciliation becomes possible and can be added then.

The **budget cap as a pinned brief rule survives** — it is checked against _our_ estimate
before dispatch, which is a legitimate predicate regardless of what the provider reports.

### 10.3 The Bin contradiction: take the second option

The critique is right that a detached line is a value and every hardened shelf invariant is
reference-shaped. So:

**Authored text is preserved as line history. The Bin stays reference-only.**

- Line history is **beat-scoped**, each entry recording the shot ordinal it was written
  against, the text, and a timestamp. Beat-scoped rather than shot-scoped so that
  re-splitting cannot orphan it.
- Restore is well-defined: pick an entry, choose a shot in that beat, it becomes that shot's
  line and marks it detached.
- Bounds live with the beat: a fixed cap of entries per beat, oldest evicted, and a per-entry
  length bound that is just the prompt field's bound.
- `StudioShelfItem` stays a union of two reference kinds. No third kind, no bytes, no new
  invariants.

§4 above is amended accordingly.

### 10.4 24, not 40

**Freeze 24 beats.** The "40-beat project" phrasing in §3 was quoting CS2's open question
about real project sizes, not asserting a cap. Corrected in the text.

### 10.5 Question 11, answered properly this time

I answered a different question. The density tiers ruling in §4 stands but is unrelated.

**"Split it differently" is an open-ended Director request, not a preset set.** It is
pre-picture work — reading the Action and the Look and proposing shot boundaries — so it is
free, and it is the single most valuable thing the director does after the spine.

**Its result is not persisted as a choice.** There is no split object. The result _is_ the
coverage: shot records with durations and derived prompts. Nothing to remember, nothing to
re-apply, no preference to store.

**Re-splitting a beat that has rendered takes never bins them silently.** Takes belong to
shots; if a re-split moves shot boundaries, existing takes correspond to nothing. So:

- The director's proposal must state what becomes orphaned **before** it applies, by name and
  count, in the same shape as the render gate.
- Orphaned takes go to the **Bin** as `asset` items — reference-shaped, so §7's invariants
  hold unchanged.
- If the user declines, the director proposes a **boundary-preserving split**: re-split only
  the shots with no takes, and leave rendered shots alone. This is usually what they wanted,
  and it should probably be the default offer rather than the fallback.

**And the prototype's `WIDE · FULL DETAIL` label is wrong.** It is a debug readout of the
density tier that should never have been visible — it reads as a mode the user picked. Remove
it from the coverage bar header.

---

## 11. Third round — closing the orphan clause and folding in the frame ruling

### 11.1 Re-split cannot delete a shot that has takes

Taking the second option, and the reasoning holds: authors do not need a destructive split in
one gesture. Deleting coverage that cost money is a decision worth its own step, and it
already has defined semantics.

- A re-split proposal **may only change boundaries of shots with no takes.** Shots with takes
  are fixed points the split works around.
- If the author wants those boundaries gone, they delete the shot explicitly first — Task 2's
  dependency-free deletion — and then re-split.
- The director's proposal states which shots it treated as fixed, so the constraint is visible
  rather than mysterious.

No third Bin kind, no dangling `clipId`, no schema change. §10.5's orphan clause is
withdrawn: nothing becomes orphaned because nothing is deleted.

### 11.2 Extraction is its own job with a single output

Stated for the contract, since the fork is easy to get wrong:

- The **render job keeps exactly two outputs** — take, poster — so `canonicalVideoPosterV2`
  and everything reading `outputAssetIds[1]` is untouched. Adding last-frame as a third
  output breaks the Board cover and the library card silently. Do not.
- **Frame extraction is a distinct job with one output**, queued on render completion,
  depending on the take.
- It needs **its own `StudioJobStatus` value** (the set is closed and exactly validated), not
  a sub-state smuggled into an existing one.

**Storage:** flat `fileName`, location encoded by the collection — `isSafeFileName` rejects
separators and the store quarantines path-shaped keys. And it gets a **fifth collection of its
own**, not `thumbnails`: a conditioning input and a representative frame are different things
with different lifetimes, and conflating them means an eviction or a regeneration policy
written for one silently applies to the other.

**Takes are exempt from eviction. Pin it.** §6's retention and project-size accounting reach
**exports only** — never takes, never conditioning frames. "A missing frame is always
re-extractable" is true only while the take video survives; if eviction can reach takes,
recovery silently becomes re-render, which is recovery that costs money.

### 11.3 Money, folded in

- **Pricing is its own subsystem, not a rule variant.** `validateRulePredicate` accepts
  exactly `forbidden_terms`; a budget check has a different input (a batch estimate), a
  different site (pre-dispatch, not per prompt), and a different breach shape. It survives as
  a brief-level rule in the _user's_ mental model while being a separate mechanism in the
  code.
- **Budget scope in v1 is per batch**, i.e. per render gate. "Under $10" means this run. The
  project-total reading is the more useful one and needs receipts to exist first — sequence it
  after.
- **Receipts store the rate value, not a card reference**, so a card update cannot rewrite
  history. The **job** is the home: it is the thing that spent.

### 11.4 Line history bounds, and its relationship to RESET

- **Bounds:** 20 entries per beat, oldest evicted; per-entry length bound is the prompt
  field's existing bound. Same shape as every other bounded string in the record.
- **History is the undo substrate for text.** RESET is not: RESET reverts this beat's shot
  lengths, trims, and derived prompts to the last saved revision, and it **writes nothing to
  history** — it is a revision operation, not an authoring one. History records author intent
  (a line someone wrote and then replaced); RESET discards uncommitted state. Two mechanisms,
  two jobs, and the distinction is what keeps RESET from being a way to lose writing.

### 11.5 Open empirically

Whether Seedance returns a last frame. Worth checking early because it is free information
and the better source if it exists, but the design does not depend on it.
