# Reply — the six Phase 6 decisions

Reviewed against the designer's Phase 6 grammar-extension delivery (received after your
message), the CS4 canvas design, and the code at `9a7188cd9`.

**Four of six I'd take as written or with a small refinement. One has a direct conflict with
the delivery that must be settled before schema 7 freezes. One collides with a product rule.**

---

## 2 — Assembly ownership and order · **conflict, settle before freezing**

This is the only one I'd block on.

Your proposal: _"An Assembly owns an explicit ordered list of member bindings; reordering
changes the Assembly, not the Pieces."_

The designer's delivery says the opposite, citing CS3:

> "The film has no order of its own. The storyboard's reading order **is** play order; the cut
> plays 'shots in story order' and **stores nothing**. So there was never a second order on the
> canvas to reconcile — there is one order, it lives in one block, and the canvas orders blocks
> on a different axis entirely (dependency), which no person and no Director ever hand-edits."

They also derive a rule from it that we have accepted into Ruling 1: **canvas block order is
nobody's to edit — not a person's, and not the Director's** — because a run is derived from
adjacency in canvas order, and hand-editable adjacency collapses that derivation into a group
field by another name.

**What the code says today.** Schema 6 has exactly one order and no grouping at all:

```
pieceOrder: string[]                       // one flat, project-level order
pieces: Record<string, StudioPieceV2>      // project-owned, as you propose
memberOf / groupId / assemblyId / members  // none of these exist
```

So "Pieces remain project-owned and reusable" is already true and needs no decision. The live
question is narrower and sharper than either document states: **an Assembly-owned ordered list
would be a second stored order alongside `pieceOrder`.**

**The question neither document answers, and the one that decides this:**

> **Can one Piece belong to several Assemblies at the same time?**

- **If yes** — you are right and the designer's model cannot hold. Two Assemblies containing
  the same Piece in different positions require per-Assembly order by construction. Then say
  explicitly what `pieceOrder` is _for_ once Assemblies own order, because keeping both is how
  we end up with two orders that disagree.
- **If no** — the designer is right, the Assembly needs no order field, and adding one creates
  exactly the second order the canvas is built to avoid.

I have no view on which is the better product; I have a strong view that it must be answered
before schema 7 freezes, because it is the difference between `StudioAssemblyV2` having an
order field and not having one.

---

## 6 — Piece replacement and history · **collides with a product rule**

Your proposal retains the newest five versions per Piece as bounded superseded provenance.

The bound conflicts with a rule the designer surfaced from CS3 while correcting their own
delivered spec:

> "Delete does not exist in this product. CS3: _'nothing here is in the film; nothing here is
> lost.'_ … Mine was the only document with a delete in it."

They accordingly replaced the one bulk act from **delete** to **lift to bin**, and flagged that
the bin needs a canvas-level home the grammar never gave it.

Bounded retention means the sixth version _is_ deleted, silently, by a rule rather than by a
person. Two ways out, and I have no preference:

1. Qualify the rule — "nothing is lost" means nothing _current_ is lost, and superseded assets
   are explicitly exempt. Say so, because it is a real narrowing.
2. Route superseded assets to the bin the designer is now specifying, so the bound governs
   what leaves the Piece rather than what is destroyed.

Also worth stating plainly: **is five a product decision or a storage one?** If it is storage,
it will be argued again the first time someone loses a version they wanted.

---

## 1 — Schema 6 → 7, no migration · **agree, with one gap**

Right, and consistent with the 5 → 6 cutover. Bumping the envelope is also the correct general
fix for a defect class we hit tonight.

**The gap:** it does not close the defect that is live _now_. `f962f705e` moved
`STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3` 2→3 and
`STUDIO_AUTHORING_FINGERPRINT_VERSION_V3` 1→2 while `STUDIO_PROJECT_SCHEMA_VERSION_V3` stayed
at 6. `validation.ts` strict-compares those at 2986, 2990, 3073 and 3206, and because the
envelope did not move, the store cannot see the change and classifies the record as
**quarantined** (damaged current data) rather than **unsupported** (legacy data).

Reproduced in the running app: two real projects with generated photos now sit under
_"Projects that need recovery — these projects could not be decoded safely"_, delete-only, no
name, no counts. That is a regression against BUG-185's own open CS4 Phase-1 acceptance
criterion, which accepts unopenability as cost but explicitly refuses reporting a legacy record
as corrupt.

Bumping to 7 for Phase 6 does not reclassify those. They need either an envelope bump now or
the nested-version classifier.

---

## 3 — Staleness · **agree, no changes**

This aligns with the delivery closely enough that the two were plainly derived from the same
constraint. Their presentation, which needs no invention because CS3 ships it:

> the affected member goes **"stale · it plays, but off the chain"** with **Re-render chain**
> beside **Keep**. "Keep is a real option, and it is why this can be presented as a consequence
> rather than a gate."

Your "free deterministic recuts may happen automatically" matches their `cut` row exactly —
"re-cut (free, and per ruling 4 it happens without asking)".

One dependency: the free/priced split is **Ruling 1b**, still unsigned. Intra-Beat reorder is
priced and warned; Beat-scale reorder is free. Wave 1 contains staleness, so Ruling 1 gates
Wave 1.

---

## 4 — Export · **agree, one presentation detail**

Matches the delivered `cut` row: **"No Download until whole — an export that would fail is
absent."**

The detail worth carrying into implementation: the affordance is **absent**, not disabled. A
disabled Download invites the question "why"; an absent one does not arise.

Your stale-with-acknowledgement extension is a genuine addition and I would take it. It pairs
with **Keep** from decision 3 — a person who keeps a stale member has already made the
judgement once, and export should record it rather than re-ask.

---

## 5 — Director proposals · **agree, two refinements from the delivery**

One pending per project matches the designer's canvas-wide slot, and the reasoning they give is
worth having in the contract because it is not about scale:

> "The slot exists so a person is never asked two questions at once."

**Refinement A — a proposal across existing blocks is not one proposal.**

> "A proposal that spans several existing blocks is not one proposal — it is several, and it
> must be said as several or refused. A proposal that _creates_ work always creates a container
> for it, and the container wears the status."

So "storyboard these eight Beats" is **one proposed `board` with eight unproduced members**,
not eight proposed blocks. This has a schema consequence: the proposal targets one block, and
the multi-block case you might otherwise design for does not exist.

**Refinement B — refusal is spoken, not silent.**

> "A second proposal cannot be made while one is unanswered — the Director says so in words
> rather than the canvas refusing silently."

Also note two status-matrix corrections that land in the same area: `board` and `cut` both gain
`PROPOSED` and `NEEDS BUDGET`. The delivered matrix denied them, which the designer identified
as their own error.

Sidecar versioning: agreed, and the canvas design already requires it — "Phase 6 must version
it if a later approved proposal operation changes its shape or authority."

---

## On the waves

The shape is right. Three notes.

**Sound: design now, build in Wave 3.** The designer was explicit — _"Phase 6 invalidates the
delivered `sound` row whether or not the commission mentions it. I need it in scope, or it
ships wrong."_ The delivered row says `IMPORTED` only, never runs, never fails, never proposed;
Phase 6 adds generated voice, narration and SFX that run, fail, stale and can be proposed. The
rows must be specified now even if implemented last, or Wave 1's grammar is built against a row
known to be wrong. An addendum bringing sound into the commission is drafted.

**Video in Wave 2 is a port, not a switch.** The Pilot is image-only today: `jobs.ts` hardcodes
`mediaKind: 'image'`, the adapter registry is built with `{ image: { workspaceDir: rootDir } }`
alone, and `pilotProductionRuntime.ts` has zero references to `filmExporter`, Seedance,
OpenRouter or the media gateway. All the video and film machinery lives in `v2Service.ts` —
4,506 lines, reachable from no bridge, already orphaned. Wave 2 is re-homing that into the V3
contracts, and I would size it accordingly.

**ffmpeg packaging has open shipping questions.** `ffmpegBinaries.ts` resolves from config or
`resourcesPath` and otherwise falls back to bare `ffmpeg` on PATH, and it appears in no
packaging config. Bundling, per-platform binaries, size and licensing are all unresolved. Wave
3 is the right home; it just is not only integration work.

**And Ruling 1 gates Wave 1**, via staleness.

---

## Summary

| #   | Decision                       | Verdict                                                                  |
| --- | ------------------------------ | ------------------------------------------------------------------------ |
| 1   | Schema 6 → 7, no migration     | Agree — but it does not fix the live quarantine misclassification        |
| 2   | Assembly owns ordered bindings | **Conflict** — answer "can a Piece be in several Assemblies?" first      |
| 3   | Staleness                      | Agree as written; gated by Ruling 1b                                     |
| 4   | Export                         | Agree; affordance absent, not disabled                                   |
| 5   | Director proposals             | Agree; multi-block proposals are refused, and refusal is spoken          |
| 6   | Piece history, newest five     | **Collides** with "nothing is lost"; route to the bin or narrow the rule |
