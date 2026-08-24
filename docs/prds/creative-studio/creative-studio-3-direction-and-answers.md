# Creative Studio 3 — direction, and answers to engineering

Companion to `Creative Studio 3 - Beat and Shot.dc.html`. Written in response to the
review questions on that prototype. Where an answer changes CS2's contract, it says so.

Amended on 2026-08-18 after executable-plan review to close seed-pending authoring, trim-endpoint
conditioning, Bin ownership, route selection, spend authorization, and undo semantics.

**Approved product amendment — 2026-08-18:** the Bin has three reference kinds: `beat`, `shot`, and
`take`. A Shot reference and `park_shot` / `restore_shot` are the non-destructive path for removing
an individual rendered shot from active coverage. This approved ruling supersedes the earlier
two-kind-Bin answer and is incorporated throughout this document.

**Approved product amendment — 2026-08-23 (BUG-095):** §13.6 is the owner-approved contract for the
paid hard-cut topology transition. It closes the first-Shot, seed reuse, re-join conditioning,
cascade, generation-count, undo, and Director decisions left implicit by §13.1. For this operation
only, §13.6 supersedes any earlier reading that makes the cascade optional, treats `set_hard_cut` as
ordinary free authoring, or permits ordinary undo or a Director proposal.

**Approved product amendment — 2026-08-24 (BUG-121):** §14 is the owner-approved simple reference
workflow. It replaces independent per-Shot “reference image” generation with a project-level
character-first, background-second stage and adds **REFERENCES** immediately before **TABLE** in the
Studio workspace navigation.

**Approved product amendment — 2026-08-24 (authoring IA):** §15 is the owner-approved two-surface
authoring contract. A Beat has one **Story** text box and a Shot has one **Shooting script** text box.
It supersedes the user-facing Action, Look, Line, Narration, on-screen-text, derivation and inheritance
surfaces while preserving their existing content through migration.

---

## 1. What CS3 is

CS3 is not a new product. It is CS2's model corrected on three points that came out of
using it.

**The vocabulary was wrong, and the vocabulary was doing damage.** "Clip" is not film
vocabulary — it is NLE vocabulary, meaning _footage I acquired_. Our object is a planned,
continuous run of camera bounded by cuts, which is a **shot**. "Section" is a document
word. A 20–40s unit that lands one idea is a **beat**. So:

| CS2                           | Current CS3                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Section                       | **Beat**                                                                       |
| story line                    | **Story** — the Beat's one authored narrative text                             |
| visual prompt (section)       | no separate surface; relevant direction belongs in each Shot's shooting script |
| Clip                          | **Shot**                                                                       |
| shot prompt / narration       | **Shooting script** — the Shot's one authored production text                  |
| Take, Cut, Cast, Slate, Board | unchanged (already correct)                                                    |
| Shelf                         | **Bin**                                                                        |
| 0 clips                       | **no coverage**                                                                |
| stale link                    | **continuity break**                                                           |

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
- A no-coverage beat with a target exports a slate exactly `target` seconds long. A no-coverage
  beat whose target is still null is **duration pending**: it is valid authoring state, contributes
  no invented seconds, and blocks film render until the author or Director supplies a target.

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
per shot — and the user picks; default is the latest unpinned still. A newly authored or
re-split head is allowed to have no still yet: that is **seed pending**, not malformed data.
Seed-pending coverage remains editable but cannot submit a video generation. Importing a still
or completing a separately reviewed `seed_still` image job closes the gate. This is why every
project needs two live routes by construction (CS2 §4).

**Chains are strictly beat-scoped. Freeze it as an invariant.** Beats are therefore the unit
of parallelism: a project at the cap is 24 parallelisable groups rather than one long series.

**Reordering shots inside a beat rewrites the chain**, so it invalidates downstream frames —
**reorder inside a beat is not free.** Reordering _beats_ is free. These are different
operations and the UI must not make them look alike.

---

## 4. Derivation

> Superseded for the current authoring IA by §15. This section remains as historical rationale and
> migration input for projects created under the Action/Line contract.

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

> Superseded for the current authoring IA by §15. Existing narration and on-screen text are preserved
> inside the migrated Shooting script; they are no longer separate user-facing fields.

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

| Item                               | Ruling                                                                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONE FILE · STITCHED WITH THE BED` | Not in v1. It is ffmpeg-class concat + mix + fade work with no implementation owner, so the option is hidden. V1 offers the editor folder, still, and on-demand script exports; it never shows a control that fails.                                            |
| `MATCH TO`                         | v1 is **prompt-level**, therefore a re-render, therefore costed. The UI must say so — it currently reads as a free grade. A real colour pipeline is a separate, later decision.                                                                                 |
| Bed 3:04 vs cut 2:58               | **Fade out at the cut's end.** Never extend, never hard-truncate. The bed is one imported managed audio asset; this plan adds no audio-generation route.                                                                                                        |
| Export retention                   | Keep the last **5 per shape**, oldest evicted, listed in the assets drawer with its size. The existing write-admission safety cap still fails a write before mutation; it is not an eviction budget and never authorizes deleting takes or conditioning frames. |

---

## 7. Inherit or restate

> The Bin, spend and undo rulings in this section still apply. The Look authoring and inheritance
> rulings are superseded by §15.

**Bin = Shelf, and it inherits the hardened shelf invariants** (XOR ordered/Bin membership for
beats and shots; canonical take aliases; dependency-safe restoration; per-kind maxima). It has
exactly three reference kinds — `beat`, `shot`, and `take`.

- A beat reference preserves the beat and all of its coverage.
- A shot reference records both the shot ID and its original beat ID. `park_shot` removes the shot
  from that beat's active coverage and creates a `lifted` reference; `restore_shot` returns it to the
  same beat at an author-chosen current position.
- A take alias must be canonical, non-selected, and not used as a current seed or conditioning
  input.

Parking a shot changes membership, not ownership. Its authored line, takes, assets, jobs, spend
receipts, and frame/conditioning records remain attached to the shot. No park or restore operation
deletes or reparents paid media. A Shot Bin item references the existing shot record and therefore
remains inside the existing 96-shot project cap; it does not create a second shot budget.

- **Lifted** — was in the film, removed. ("Store walkthrough") Shot items are lifted in v1.
- **Alternate** — never in the film. ("Alternative cold open") Beat and take items may be alternate
  in v1.

**Limits** — carry CS2's, renamed: **24 beats**, **8 shots per beat**, **96 shots** per
project.

**The 25-word Look cap is soft.** The counter warns; word 26 is allowed. It is guidance about
what conditioning is for, not a predicate. Hard blocks on prose invite workarounds
(abbreviations, run-on compounds) that make the output worse. Rules are hard; guidance is
soft, and the Look is guidance.

**Spend.** One reviewed `prepare` → `confirm` protocol covers both seed-still and video-take jobs:

- Estimate = route unit price × billable units × generations, and it must be a **range**, not a
  point, once takes are in play. Image routes bill per generation; video routes bill per second.
  Quote the authorized pass and state that later revisions require a new quote.
- All three numbers in a gate — headline cost, generation count, button label — must come
  from **one set of shots**. In-flight work is context, never billed again.
- Persist an authorization-linked rate-card receipt per completed take. Do not claim provider-bill
  reconciliation without provider billing data.
- **A budget cap belongs in the Brief as a pinned policy.** "Keep this under $10" is checked against
  the quote's upper bound before dispatch, separately from content predicates such as forbidden
  terms. This is the honest answer to "I don't know what this will cost": you tell it what it may
  cost.

**Undo is a persisted, revision-aware authoring journal.** `RESET` only discards the renderer's
uncommitted draft and never reaches main. Every committed free authoring batch stores a bounded
validated before-fragment entry in the project revision; `undo_last` applies it through the same
reducer under expected-revision CAS only while the edited authoring fragments still match. It never
cancels, retries, or refunds paid work. Re-split, detach, beat/shot/take park and restore, trim,
reorder, seed selection, take selection, bed, and match-to are all covered.

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
2. **Route selection** — the Brief owns one image route and one video route selected from the
   sanitized catalog. A project is authorable with either missing, but a paid gate is blocked until
   the route required by that job is selected and ready.
3. **`PART DONE` recovery** — the resume affordance from §3.
4. **Target vs actual duration** — needs distinct visual treatment per §2.2.
5. **Narration fields** — see §5.
6. **Undo** — see §7.

---

## 10. Second round — blockers, contradictions, and the question I answered wrong

### 10.1 Conditioning-frame extraction is on the critical path

The chain cannot advance without the frame at the **played endpoint** of the selected upstream
take. That is not necessarily the provider's full-video last frame: after a ten-second take is
tail-trimmed to eight seconds, the next shot must start from the decoded eight-second endpoint.

**Ruling: the conditioning frame is a persisted, provenance-bound asset, not a runtime value and
not the Board poster.** It records the selected take asset and the exact trim endpoint it was
decoded from. A provider-returned last frame may satisfy extraction only when the selected take is
untrimmed and the provider output is for that exact immutable take. Otherwise main decodes the
managed video at the played endpoint. Renderer canvas capture may create a Board poster, but it is
never chain authority.

**Invariant: no chain advance without the exact conditioning frame on disk.** Because takes are
immutable and already on disk, a missing frame is re-extractable. Closing the window mid-chain
stalls the chain rather than losing it, and recovery asks whether the frame for the selected take
and trim endpoint exists. Changing take selection or tail trim invalidates that provenance and
queues a new local extraction before downstream submission.

Extraction is a **named, durable local lifecycle step** with `pending | extracting | ready | failed`
state. It is not a paid provider generation and does not masquerade as a render-job status.

### 10.2 Money: build the rate card, drop the reconciliation

Agreed, none of it exists. Three rulings:

**Price source is a config rate card** — per route, with an explicit currency and unit, owned by
whoever owns route bindings. Video routes are priced per second; image routes are priced per
generation. Not a provider API in v1. The UI must say the number comes from our rate card, not from
the provider.

**Drop reconciliation. It was theatre and the critique is correct** — if actual is computed
from the same table as the estimate, the two can only differ by generation count, which we
know before dispatch. The ">20% over, say so unprompted" rule is **withdrawn**.

**Replace it with a receipt, which is honest and useful.** Per take, persist what actually
ran: authorization, purpose, route, currency, rate unit/value, seconds where applicable,
generation index/count, and integer total. That gives the
assets drawer "this beat cost you N" without claiming to know your bill. If a provider later
returns real billing data, reconciliation becomes possible and can be added then.

The **budget cap as a pinned brief rule survives** — it is checked against _our_ estimate
before dispatch, which is a legitimate predicate regardless of what the provider reports.

The paid boundary is a two-step main-process protocol. `prepare` snapshots the project revision,
ordered seed/video generation lines, conditioning inputs, route IDs, requested generation counts,
rate-card digest, currency, and lower/upper minor-unit totals into an expiring quote. `confirm`
re-derives that quote inside the project queue; any changed input returns stale and spends nothing.
A successful confirm
persists one authorization plus all idempotent job records **before** the first provider call.
Recovery may dispatch only jobs named by that authorization. The per-batch budget compares the
quote's upper bound; revisions beyond the authorized generation count require a new quote.

### 10.3 The Bin contradiction: preserve text and ownership

> Superseded for new authoring by §15. Existing line history remains readable migration history; new
> revisions preserve Shooting script text instead of exposing Line detach and re-derive controls.

The critique is right that a detached line is a value and every hardened shelf invariant is
reference-shaped. So:

**Authored text is preserved as line history. The Bin stays reference-only.**

- Line history is **beat-scoped**, each entry recording the shot ordinal it was written
  against, the text, and a timestamp. Beat-scoped rather than shot-scoped so that
  re-splitting cannot orphan it.
- The ordinal is historical provenance in the fixed range 1–8; it is not required to be within the
  beat's current shot count. Shrinking coverage therefore cannot make preserved writing invalid.
- Restore is well-defined: pick an entry, choose a shot in that beat, it becomes that shot's
  line and marks it detached.
- Bounds live with the beat: a fixed cap of entries per beat, oldest evicted, and a per-entry
  length bound that is just the prompt field's bound.
- `StudioBinItem` is a union of three reference kinds: `beat`, `shot`, and `take`. A shot item carries
  its `shotId`, original `beatId`, and `lifted` reason; it contains no media bytes.
- Every shot is in exactly one place: present in its original beat's shot order — whether that beat
  is active or binned — or individually parked by one Shot Bin reference. It is never both.
  Restoring chooses a valid current position in that original beat.
- Parking retains the complete shot record and its authored and paid lineage. Takes, assets, jobs,
  receipts, frame extractions, and conditioning frames remain attached to the parked shot; there is
  no destructive take-deletion or ownership-transfer step.

§4 above is amended accordingly.

### 10.4 24, not 40

**Freeze 24 beats.** The "40-beat project" phrasing in §3 was quoting CS2's open question
about real project sizes, not asserting a cap. Corrected in the text.

### 10.5 Question 11, answered properly this time

> The Director and boundary-preservation rulings still apply. References to Action, Look and derived
> prompts are replaced by Story and Shooting script under §15.

I answered a different question. The density tiers ruling in §4 stands but is unrelated.

**"Split it differently" is an open-ended Director request, not a preset set.** It is
pre-picture work — reading the Action and the Look and proposing shot boundaries — so it is
free, and it is the single most valuable thing the director does after the spine.

**Its result is not persisted as a choice.** There is no split object. The result _is_ the
coverage: shot records with durations and derived prompts. Nothing to remember, nothing to
re-apply, no preference to store.

**Re-splitting never deletes, parks, or silently detaches persisted dependencies.** Takes, jobs,
seeds, conditioning frames, and match-to references belong to exact shots; if a re-split moved those
boundaries, the dependencies would no longer describe the authored film. So:

- The director's proposal must name every fixed shot **before** it applies, with the reason it is
  fixed, in the same review card as the proposed coverage.
- The accepted operation is always a **boundary-preserving split**: it may replace only
  dependency-free shots and leaves any shot with assets, jobs, selected/seed media, or another
  persisted reference at the same start/end offsets. The proposal lists those fixed shot IDs.
- If the author wants a fixed boundary gone, they explicitly `park_shot` first. That removes the shot
  from active coverage while preserving it, its original beat ownership, and all attached authored
  and paid lineage in the Bin. Parking is refused while the shot is the current match-to target,
  while it has a nonterminal job or frame extraction, or while downstream nonterminal work is
  actively consuming that shot, one of its takes, or one of its frames. Match-to must be cleared or
  retargeted explicitly; parking never does that silently. A terminal downstream conditioning
  snapshot is retained as historical lineage, does not block parking, and becomes stale against the
  post-park chain.
- Re-split then evaluates the post-park active coverage and remaining fixed shots. It never parks,
  restores, deletes, or reparents a shot or take implicitly.

**And the prototype's `WIDE · FULL DETAIL` label is wrong.** It is a debug readout of the
density tier that should never have been visible — it reads as a mode the user picked. Remove
it from the coverage bar header.

---

## 11. Third round — closing the orphan clause and folding in the frame ruling

### 11.1 Re-split parks, rather than deletes, a shot that has takes

The approved third-reference-kind amendment keeps the original safety goal: authors do not need a
destructive split in one gesture. Removing paid coverage is an explicit, reversible park operation,
separate from accepting a re-split proposal.

- A re-split proposal may only change dependency-free shots. Any shot with an asset, job,
  selected/seed media, conditioning-frame dependency, match target, or another persisted reference
  is a fixed point the split works around.
- If the author wants one of those boundaries gone, they first `park_shot`. The operation removes its
  ID from the original beat's active shot order and creates a Shot Bin reference containing that beat
  ID; the shot and its assets, jobs, receipts, takes, and frame records remain intact and resolvable.
- Parking may make downstream continuity stale because active coverage changed. That state remains
  visible and playable under the existing staleness rules; it is not repaired or re-rendered
  implicitly. `park_shot` refuses a current match-to target and any nonterminal job or extraction on
  the shot or downstream that is actively consuming the shot, take, or frame. Terminal downstream
  conditioning snapshots remain attached as historical lineage and become stale rather than
  blocking; match-to must be cleared or retargeted first.
- Re-split uses the post-park active coverage and its remaining fixed set. `restore_shot` returns the
  preserved shot to its original beat at a currently valid position and applies the same continuity
  and capacity checks as any other structural edit.
- The director's proposal states which shots it treated as fixed, so the constraint is visible
  rather than mysterious.

The Shot Bin reference is the ownership seam that prevents an orphan: nothing becomes dangling,
nothing paid is deleted, and no take has to be detached from the shot that produced it.

### 11.2 Render outputs, posters, and conditioning frames stay distinct

Stated for the contract, since the fork is easy to get wrong:

- Render outputs are read **by role, never array position**. A video take is canonical from its
  `primary` output. A provider `poster` is optional representative artwork; a third output must not
  change either selection.
- A Board poster lives in `thumbnails`. A conditioning frame lives in its own managed
  `conditioningFrames` collection and records `{ takeAssetId, endpointSeconds }` provenance.
- The local extraction record has its own lifecycle state and one conditioning-frame output. It is
  queued whenever an exact selected-take/endpoint frame is absent, including after tail trim.

**Storage:** flat `fileName`, location encoded by the collection — `isSafeFileName` rejects
separators and the store quarantines path-shaped keys. A take-relative path never appears in a
record.

**Takes are exempt from retention eviction. Pin it.** Export retention reaches exports only — never
takes, never seed stills, never conditioning frames. The existing project write-admission cap may
refuse a new managed write before mutation; it never selects existing authored or paid media for
deletion.

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

### 11.5 Closed empirically

Seedance returns `last_frame_url`, and the adapter already exposes it as an optional `poster` role.
That output may satisfy the conditioning-frame lifecycle only for the exact untrimmed take. The
design still requires local main-process decoding for trimmed endpoints and routes without that
output, so provider behavior is an optimization rather than an invariant.

---

## 12. Fourth round — the app bar in two panes (BUG-068)

Drawn answer: `Creative Studio 3 - App Bar in Two Panes.dc.html`. The arithmetic in the
question was right and one of its inputs was wrong — the title was measured as a fixed 206px
because §9 never gave a truncation rule. Answer 12.3 is therefore the load-bearing one.

### 12.1 The bar spans the Studio surface, above both panes

Everything in the bar is film-scoped: the project's name, the film's clock, the film's render
gate, the views of that film. Nothing in it is application-scoped, so it is the project's
header at any width. The rail is one of the project's two panes, not a sibling of the project.

The deciding reason is the toggle, not the fit. A bar inside the column reassembles itself on
a 378px jump every time someone opens or closes a conversation panel — title regrows, counts
return, Render label comes back. That makes a pane control read as an application-wide
change. **The bar must not move when the rail does.**

"Full width" means the **1211px Studio surface** (431 + 780 = 53 + 1158), not the 1492px
window; the 281px outside it is application chrome and stays outside.

**The rail gets no header.** Its collapse control is the leftmost element in the bar, aligned
to the rail's own left edge. That is the whole answer to "the rail gets a second header
beneath it": there is one header in the app.

### 12.2 The order, as bar width decreases

Principle: **shed what we derived before truncating what the user typed, and never change the
bar's height.** Thresholds are the bar's own width, so the ladder holds whether the bar spans
the surface or ever sits in a column. Rail toggle 28 + dot 22 + chips 156 + overflow 27 +
gaps 77 + padding 36 = 346 fixed.

| Rung | Fires below | Yields                                              | Minimum after        |
| ---- | ----------- | --------------------------------------------------- | -------------------- |
| 0    | —           | spacer to zero                                      | 961px (title at 320) |
| 1    | 961px       | title shrinks in its box, 320 → 128                 | 769px                |
| 2    | 769px       | stat strip drops `9 BEATS`                          | 699px                |
| 3    | 699px       | stat strip drops `5 READY`                          | 645px                |
| 4    | 645px       | `Render…` → glyph, still a visible button           | 603px                |
| 5    | 603px       | view chips leave the bar, head the workspace column | 436px floor          |

Never lost: rail toggle, project dot, title at 128px, the clock, the overflow.

At the widths being built, **no rung fires** — 1211 ≥ 961. The ladder is a floor spec.

Two candidates rejected, with reasons:

- **Stat strip under the title.** Takes the bar 56px → ~76px. Every view's top edge moves and
  the Table's sticky header moves with it, in both directions. Height stability beats two
  derived counts we can simply drop.
- **Overflow absorbs `Render…`.** Render spends money and is the reason the bar has a primary
  action. It may lose its label; it may not become invisible. The chips leave first, because
  they have somewhere honest to go.

### 12.3 Title truncation: a box, not a length

`flex: 0 1 auto`, **max 320px, min 128px**, one line, **tail ellipsis**. It fills what the bar
can spare and truncates past 320px however short the title is. The 128px floor is what makes
rung 2 exist.

- Full title always reachable without a click: the element's tooltip.
- Full title always readable in full as the **first row of the overflow menu**, where renaming
  already lives.
- **Tail only.** The identifying words in a user-typed title are at the front; middle
  truncation destroys the thing the rule protects.

Consequence for the original arithmetic: at 780px the box gets 178px and **the column bar
fits** — the title is the only thing that yields. The recommendation for 12.1 stands anyway,
on the reassembly argument rather than on 28px.

### 12.4 Expanded is a working state in the Table, a consulting state in the Board and the Cut

This follows from §1's division of labour: the director acts before the picture exists, the
human decides after it does. The Table is the pre-picture view — spine, coverage, actions,
looks, prompts — and that is where the rail is loud. The Board and the Cut are judgements
about pixels and motion, which the director cannot see.

So the rail's default **follows the view**, and is not a global preference:

| View  | Rail default | Design target |
| ----- | ------------ | ------------- |
| Table | expanded     | **780px**     |
| Board | collapsed    | **1158px**    |
| Cut   | collapsed    | **1158px**    |

A manual toggle **sticks per view, per project** and outranks the default from then on. Never
re-expand a rail the user closed.

Consequences for the two views in the question:

- **The Board does not need redrawing.** At 1158px, three-up gives 365px cards. Three is still
  the right answer; 250px was an artefact of designing the Board against the wrong target.
- **The Cut does not need redrawing.** It composes against 1158px, and preview versus side
  panel is not a real competition at that width.
- **The Table does need a rule, and it is drawn.** At 780px `ACTION` falls to ~200px and `LOOK`
  to ~160px — two narrow prose columns breaking at different points, with row height set by
  whichever wrapped worse. Ruling: **at 860px of column width and below, `LOOK` stops being a
  column and becomes a second line inside the `ACTION` cell.** The five fixed columns keep
  their widths; at 780px the merged cell is 374px.
  - Look line: Source Sans 3 12.5px, `#6E6553`, 3px under the Action, clamped to two lines
    with tail ellipsis. An empty look keeps its `#B4380F` prompt.
  - Header reads `ACTION · LOOK`. Both stay sortable. The beat panel is unaffected.
  - Threshold is measured the same way the coverage bar's density tiers are (§4).
  - Rationale: the Action is what the beat does, the Look is how it is conditioned. You read
    Actions in sequence and consult a Look only for the beat you are about to open. A
    subordinate line states that relationship; two columns pretend they are peers.

---

## 13. Fifth round — the three marks the Beat panel does not settle

Answers to the 2026-08-21 reading of `BEAT 03`. Sections 1–3 of that document are accepted as
written. Of the three forks, two are decided by rulings already in this document and are
restated here only because the drawing does not show them; 13.2 is new. This round is answers
only — the panel is not redrawn yet, and 13.4 lists what redrawing owes.

### 13.1 The line is state plus control — but the control is `HARD CUT`, not `CONTINUITY BREAK`

**Present and gated on every Shot that has a predecessor; sets `chainBreak: 'hard_cut'`.** Cutting on
a change is legitimate authoring, not an exception; an affordance that appears only when the system
noticed something cannot be found when a person wants it; and a permanent control needs no detector
in order to ship. The first Shot is already the Beat's natural chain head and has no hard-cut control
or topology transition.

But §3 already spent that word. Continuity break is **system-detected** — the frame a shot was
generated from no longer exists. A hard cut is **authored**. One line cannot be both, so the
line splits:

- **`CONTINUES FROM 02`** is state, and it stays state.
- **`HARD CUT`** is the control beside it: permanent, clickable, toggling. Once set, the state
  half must tell the truth about what it did — the shot is no longer downstream of anything,
  so it reads as a chain head and **starts from its own still**.
- **A detected continuity break is a different mark in a different place**: the conditional
  alert row that already carries the tail-trim warning, where a detected problem belongs. It
  never occupies the state line, and it is never a control.

The consequence worth naming, because the drawing hides it: **severing is not free.** A shot
promoted to chain head needs a still on the image route (§3, `STARTS FROM THE STILL`), and its
existing take was generated from a first frame it no longer starts from. So `HARD CUT` is a
**gated** action in the render gate's shape — the third gate, after render and chain — not a
toggle that flips silently and bills later. Re-joining the chain is symmetrical and equally
gated.

### 13.2 `▸ RENDERS AS` is a read-only readout

> Superseded by §15's two-source prompt composition. The readout remains read-only but attributes its
> authored inputs to Story and Shooting script rather than Action, Look and Line.

**Read-only.** Three authoring surfaces stay three: Action, Look, Line. This is the whole
reason the answer is worth having — an editable resolved prompt would need a fourth detach
rule, and the follow-up the question correctly identified (does re-deriving overwrite a
hand-edited resolved prompt?) has no good answer. It does not arise if the composition is
never authored.

What it shows: the text actually sent to the route — Action, Look, Line, cast, references,
model binding, in dispatch order — with each part **attributed to the surface that owns it**.
That attribution is the feature. The readout answers "why did it render that", and then points
at the field to change. It is a debugging surface, not an authoring one.

Two constraints follow:

- **It must read from the same compose function the job uses.** A readout assembled
  separately for display is a lie the moment dispatch changes, and it is a lie that costs
  money to discover.
- **It carries the derived line's staleness flag** (§4). A composition built against an older
  Action revision must say so on its face, or it teaches the wrong lesson.

If a prompt ever needs to say something the three surfaces cannot express, that belongs on the
**Line**, which already detaches and already has a defined history (§10.3, §11.4). Do not add a
second detach mechanism.

### 13.3 Inserting a shot extends the beat, and the `+` carries a price

**Extend.** §2.2 settles it: `actual` is derived from the shots, `target` is nullable authored
intent that never constrains. Insert a fourth shot into a 31s beat and the beat is 35s. The
target, if one was ever set, stays exactly where it was, and the widened gap between intent and
fact is the director's cue — the same cue a re-split produces. Nothing redistributes, because
nothing was ever a budget.

That answers the larger question the drawing was really asking: **beat duration is a total that
follows from the shots, not a target they must fit.** Every fit-to-target reading in the app is
advisory — the Table's `2s UNDER`, the film total in the Cut, the director's coverage
proposals. No engine anywhere solves for it. The single carved exception stands: a beat with no
coverage renders a slate `target` seconds long, the one place an authored number reaches the
renderer.

**And the `+` quotes before it acts** — but conditionally, because position decides:

| Insert at           | What moves                                                           | Cost                                                                                   |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A join, mid-beat    | the boundary on both sides; the following shot's first frame changes | quoted, with the §3 cascade range — base if nothing downstream goes, higher if it does |
| The end of the beat | nothing; the new shot chains off an unchanged last frame             | free, a fresh slate                                                                    |

So a mid-beat `+` shows a cost hint and opens the gate; the trailing `+` does not. A hint on
every marker regardless of position is decoration, and decoration next to a price teaches
people to stop reading prices.

### 13.4 What the redraw owes

Carried as work, not as open questions:

1. The state line splits — `CONTINUES FROM 02` as state, `HARD CUT` as a permanent gated
   control, the detected break relocated to the alert row.
2. The hard-cut gate itself: still cost, invalidated take, symmetrical re-join.
3. `RENDERS AS` gains per-part attribution and a staleness flag.
4. The join `+` gains a conditional quote.

### 13.5 Two of the ungrounded claims, grounded

From the reading's own list of claims with no code behind them:

- **The 25-word Look ceiling is soft** and already ruled so in §7 — the counter warns, word 26
  is allowed. The drawing's `10 / 25 WORDS` is guidance, not a predicate, and the redraw should
  not let it look like a limit.
- **The coverage strip's density tiers** are §4's measured tiers, computed from the bar's pixel
  width, nothing to persist and nothing to choose — and per §10.5 the tier's name should not be
  visible at all. If `WIDE · FULL DETAIL` is still in the build, that is the bug, not the tier.

The **Beat-scoped transport** stays a drawing-only claim, and it should: `0:20 / 0:31` against a
31s beat is right, and `JOIN ◂ / JOIN ▸` is the correct unit for judging whether two clips
actually join. It has no code behind it because nothing has been built there yet.

### 13.6 Owner-approved paid hard-cut contract — 2026-08-23

This is one narrow exception to the ordinary render gate and its optional cascade. It applies only to
a non-first active Shot whose authored topology changes from continuation to hard cut (**sever**) or
from hard cut to continuation (**re-join**).

**First Shot.** The first Shot of a Beat is already a natural segment head. It has no toggle, creates
no quote, and is not a valid target for either transition.

**One topology gate, one exact graph.** Prepare snapshots the expected project revision, target Shot,
direction (`none` → `hard_cut` or `hard_cut` → `none`), current topology, exact conditioning
authority, exact ordered generation graph, routes, rates, and total. Confirm is the sole authority. It
re-derives all of that inside the project queue; any mismatch is stale. One successful durable commit
atomically changes `chainBreak` and persists the spend authorization plus every required job before
the first provider dispatch. The transition never travels through the free authoring reducer.

Closing or declining the gate, prepare refusal, quote expiry, stale confirmation, confirmation
validation failure, or persistence failure before that atomic commit changes no project bytes and
creates no authorization or job. After a successful durable confirmation, extraction and provider
lifecycle failures are recorded normally and never roll back topology or authorization.

**Sever.** Reuse the exact effective seed still when the target Shot already has one eligible under the
normal seed rules, and atomically write that asset as the canonical `seedStillId` in the transition
commit. This deliberately converts moving latest-unpinned semantics into the exact conditioning
authority the user confirmed. Otherwise the graph contains exactly one new `seed_still` generation on
the image route and the transition leaves `seedStillId` null until the human binds a primary output of
that authorized item; the dependent target video waits. In both cases the graph contains exactly one
replacement `video_take` for the target Shot, conditioned on that exact existing or newly selected
seed.

**Re-join.** Clear the target Shot's `seedStillId`; the still asset remains immutable history. The
replacement target video conditions on the predecessor's exact trim-aware played-endpoint frame. If
that frame is not on disk, the existing free extraction lifecycle is a prerequisite and must complete
before provider dispatch. Re-join never schedules a paid generation for the predecessor.

**Mandatory downstream.** Sever and re-join both include exactly one replacement `video_take` for
every downstream Shot up to, but not including, the next authored hard cut. There is no base-only or
optional-cascade quote for this gate. Every required seed/video item has generation count one; requests
for alternates use the ordinary render gate instead. Existing human take-selection barriers still
bind symbolic downstream dependencies; the hard-cut gate does not silently choose among Takes.

**No ordinary reversal paths.** A confirmed transition writes no ordinary authoring undo entry.
Reversing it is the opposite paid topology transition through a new prepare/confirm gate; it is not
`undo_last`. The current Director cannot apply or propose either transition, and accepting a legacy
pending proposal cannot open, manufacture, or confirm this spend authority.

---

## 14. Sixth round — references before Shots

The first reference workflow generated three independent seed stills for three Shots. All three paid
jobs succeeded, but each image reinvented the characters and environment, and the completed assets
were hidden inside the affected Beat panels. That is the wrong production order and an incomplete
result handoff.

### 14.1 The simple flow

The approved order is:

`Brief → References → Table → Board → Cut/Render`

References is a persistent workspace tab, placed first in the existing workspace navigation:

`REFERENCES | TABLE | BOARD | CUT`

The separate **Render** action stays where it is. First-time reference work opens **REFERENCES**
automatically, but later updates never pull the user away from another active workspace. Once every
required reference is approved, the view exposes **Continue to Table**.

### 14.2 One page, two sections

**Characters first.** The Director derives the named characters from the approved Brief. The page
shows one card per character, and each card holds one generated character sheet with **Approve** and
**Regenerate**. A sheet may contain several views in one image, but it is one asset and one approval
decision. There are no costume variants, expression libraries, or multiple identity branches in this
version.

**Backgrounds second.** When every required character sheet is approved, the page offers a small set
of recurring location references. Each location card has the same **Approve** and **Regenerate**
decision. A story with no named characters starts here. Lighting variants, prop libraries, masks and
layers remain out.

### 14.3 Composition, not literal compositing

Shot generation automatically conditions on the approved character sheets for characters present in
the Shot and the approved background matching its location. The Shot prompt remains the composition
instruction. The output is a Shot candidate that follows the existing first-frame review path; it is
not a new character or background reference.

This version does not literally cut out a foreground and merge it over a background. If the location
match is missing or ambiguous, generation stops and asks the user to choose instead of silently
dropping the reference.

Every generated Shot records the exact reference asset ids used. Approved references stay stable
until the user explicitly generates and approves a replacement. A pending candidate never replaces
approved conditioning authority.

### 14.4 The result returns to where it belongs

The Director handoff remains actionable after spend confirmation and across reload:

- before confirmation, it names the scope and price;
- while running, it shows queued, running, succeeded and failed counts;
- after completion, it shows thumbnails and **Review references**;
- on partial failure, it preserves successful results and retries only failed items.

**Review references** switches to **REFERENCES**, scrolls to the exact generated cards and briefly
highlights them. Reference assets never occupy the Table's Board-panel thumbnail slot. In this first
version, the Table gains no per-row reference controls; **REFERENCES** is the one durable place to
review or replace project references.

The existing prepare/confirm spend boundary remains mandatory for every generation and separate from
free authoring approval.

### 14.5 The Director proposes; the app binds

This is deliberately hybrid. It is not a prompt-only Director behavior and it is not a manual
assignment form that discards the Director's understanding of the story.

**The Director owns semantic choice.** After character and background references are approved, the
Director proposes one typed binding for every active Shot: the Shot id, zero or more character
reference ids, and one background reference id when the Shot has a location. Its skill instructions
teach when to call that tool, but the tool accepts only ids from the app-provided catalogue of
approved project references. The Director cannot invent a label or resolve an asset by prose at
dispatch time.

**The app owns authority.** It validates ownership, role, approval, Shot membership and route
reference capacity; persists the binding as project state; displays it in a **Shot bindings** section
under Characters and Backgrounds; and lets the user correct it as free, reversible authoring. There
is no extra proposal approval card for a binding change.

**Generation consumes the persisted binding.** **Draw next batch** and first-frame preparation read
the exact stored references instead of asking the Director again. The spend review shows and freezes
those ids with the authored Shot and route. Any binding, approval, asset, route or capacity change
makes confirmation stale. Missing, ambiguous, unapproved, stale or over-capacity bindings block the
affected Shot with a specific recovery action; the app never falls back to an unconditioned request.

Every resulting job and asset records the exact reference ids used. This is the boundary in one
sentence: **the Director proposes meaning; the app enforces truth.**

The current contracts do not satisfy it. `studio_request_reference_images` carries only Shot ids,
Board request construction hard-codes `referenceInput: null`, and pricing rejects a non-null
reference on `board_still`. Instructions alone therefore cannot deliver this flow; typed project,
Director-tool, pricing, request and provenance contracts must change together.

---

## 15. Seventh round — one Story per Beat, one Shooting script per Shot

The current editor exposes its internal composition model as authoring vocabulary: Action, Look,
Line, Narration, on-screen text, inheritance, derivation and detachment. That asks the author to
understand how the app assembles a prompt before they can describe a film. It also makes the Table
and Beat panel read like forms rather than a script.

The approved boundary is smaller:

- a **Beat tells the Story**;
- a **Shot has a Shooting script**;
- the app composes provider prompts from those texts and the project's approved production context.

These are the only two user-facing authored prose objects. Prompt composition, revisions, reference
ids and provider instructions remain structured application state rather than additional writing
surfaces.

### 15.1 Beat authoring: Story

Every Beat has one multiline **Story** text box. It describes the narrative moment covered by the
Beat: what happens, what changes, and what the audience should understand. It is not required to
follow a schema or fill a checklist. Location, lighting, sound, dialogue and voiceover belong in the
Shooting script of the exact Shot where they occur.

The Beat title, target duration, active Shot count and state remain compact metadata outside the text
box. They are not headings the author must reproduce inside Story.

Example:

```text
Ming walks home from school through a busy 1985 Hong Kong neighbourhood, carrying the gold stars
from his spelling test. He approaches his mother's dai pai dong as the evening rush begins.
```

There is no separate Beat-level Action or Look. Project-wide visual intent stays in the Brief;
approved character and background identity stays in References; Shot-specific production direction
belongs in that Shot's Shooting script.

### 15.2 Shot authoring: Shooting script

Every Shot has one multiline **Shooting script** text box. It contains the production instruction for
that exact Shot. Authors and the Director may write ordinary prose or use lightweight labels such as:

```text
Location: A crowded Hong Kong market street outside a dai pai dong.

Lighting: Late-afternoon sunlight transitioning into warm neon.

Shot direction: Wide eye-level establishing shot. Ming emerges from the school crowd, checks the
gold stars on his spelling test and walks toward the market lane. Static camera with people crossing
the foreground.

Sound / voice: Street traffic, distant vendors and bicycle bells. Voiceover: "When I was eight, I
thought my mother's day began when the lights came on."
```

Location, lighting, shot direction, sound and voice are writing aids inside one text box, not separate
fields, tabs, modes or validation requirements. The author may omit a label, change the order or use
one paragraph. Empty optional detail never blocks free authoring.

Shot number, planned duration, chain state, reference bindings, generation state, Takes and paid
lineage remain structured metadata outside the text. Those values have deterministic behavior and
must not be inferred from prose.

### 15.3 The clean Table and Beat panel

The Table's authoring columns become:

`PANEL | BEAT | STORY | SHOTS | LENGTH | STATE`

**STORY** replaces the peer Action and Look columns. It is the text authors scan to understand the
film in sequence. The Table does not display a second visual-direction line and does not expose
prompt or derivation state.

Opening a Beat presents one Story editor above its coverage. Selecting a Shot presents one Shooting
script editor beside the preview. The panel removes the separate Action, Look, Line, Narration and
on-screen-text editors, the Look word counter, and the Line derivation/detach controls. Existing
transport, duration, continuity, reference, Take and spend controls retain their current authority.

### 15.4 Prompt composition is derived, not authored

The app creates a provider-specific prompt from one versioned input package:

1. project format and Brief-level style;
2. exact approved character and background reference ids bound to the Shot;
3. the owning Beat's Story;
4. the Shot's Shooting script;
5. output-purpose, aspect-ratio, model and route instructions.

The prompt is not a third source of truth. A read-only **Technical details** / **Renders as** surface
may show the exact composed prompt for diagnosis, but normal authoring never asks the user to edit it.
The readout and dispatch must call the same composition function. Prepared quotes freeze the exact
input revisions, reference ids and composed prompt; any source or binding change makes confirmation
stale before spend.

Composition may wrap the two texts differently for a Board still, seed still, video Take or future
audio output, but it does not create new authoring fields. Jobs and assets retain the frozen prompt
and exact inputs used so an old output remains explainable after Story or Shooting script changes.

### 15.5 Director and human authority

The Director may propose adding or revising Story and Shooting script text. A proposal review shows
the actual text diff grouped by Beat and Shot; a list of opaque operation names is insufficient. The
human accepts or rejects the proposal before the free authoring mutation commits.

The Director may also propose semantic reference bindings under §14.5. The app still validates and
persists ids, checks route capacity, owns spend confirmation, composes prompts and dispatches jobs.
Instructions cannot bypass those deterministic boundaries.

Changing Story does not silently rewrite Shooting scripts. Because the current Story participates
directly in prompt composition, new generation uses the new Story immediately. The Director may
propose corresponding script edits when asked, but no background derivation overwrites authored Shot
text.

### 15.6 Existing-project migration and preservation

Migration is deterministic and lossless:

- Beat `Action` becomes Story.
- Beat `Look` is copied into each active and parked Shot's Shooting script under `Visual direction:`.
- A no-coverage Beat's nonempty `Look` remains in a hidden legacy migration archive until its first
  Shot is created, when it is copied once into that Shooting script.
- Shot `Line` is copied under `Shot direction:`.
- Nonempty `Narration` is copied under `Voiceover:`.
- Nonempty on-screen text is copied under `On-screen text:`.
- Existing Shot text order, Takes, assets, jobs, receipts, reference bindings, chain state and
  revisions remain attached to their current owners.
- Existing line-history entries remain readable in Technical details as legacy history and are never
  discarded. New Shooting script edits use the ordinary revision-aware authoring undo contract and
  do not create or expose Line detach or re-derive controls.

The migration is idempotent and records its schema version. Reopening a migrated project never
duplicates a Look, Line, narration or on-screen-text block. If any legacy text cannot be represented,
the project fails closed with a recovery path instead of dropping prose.

### 15.7 Acceptance boundary

The amendment is complete only when:

1. the Table exposes Story rather than Action and Look;
2. the Beat panel exposes exactly one Story box and one Shooting script box for the selected Shot;
3. no normal authoring surface shows Line, Narration, on-screen text, inheritance, derivation or
   detachment as independent concepts;
4. existing authored content survives migration exactly once;
5. proposal review shows the Story and Shooting script text that acceptance will write;
6. the generation readout and dispatch use the same composed prompt and frozen inputs;
7. reference, continuity, spend and paid-media provenance rules remain enforced.
