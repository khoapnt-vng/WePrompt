# Delta after the sound rows — what changes in the six decisions

The designer delivered the sound rows. Four items move. One of them is evidence on the
blocking conflict in decision 2.

---

## Decision 2 — new evidence, and it cuts your way

I said the conflict turned on "can one Piece belong to several Assemblies?" The sound rows
answer a related question that partly settles it, and it favours your model.

The designer's §1 states a **general rule for one kind owning an attribute about another**:

> "The level is not a property of the sound. It is a property of **the film's use of the
> sound** … the owner carries the control; the subject carries the fact."

So the `cut` carries the level control and the `sound` block states the fact as plain text —
`−6 dB under #the_cut`. They add that audio members carry a **time anchor** (the Beat it starts
under) rather than chain position.

**Both of those are per-film facts about a Piece, and something must persist them.** That is
exactly your "Assembly owns an explicit ordered list of member bindings" — a binding is where
per-use attributes live. Their own rule and your proposal are the same idea arriving from
opposite ends.

Which means the earlier claim that the cut **"stores nothing"** is already false as delivered:
it stores at least a level and a time anchor per member. The remaining question is narrower
than it was — **not whether the Assembly stores per-member facts (it demonstrably must), only
whether order is among them.**

My read: put it to the designer as that narrower question. Their "reading order is play order"
argument may still hold for picture while bindings carry the rest.

Still unanswered and still gating the freeze: **can one Piece be in several Assemblies?** If
yes, both the level and the time anchor must be per-binding, not per-Piece — which is a schema
consequence, not a UI one.

---

## Decision 4 — export must not treat audio like picture

Your rule: _"Missing/failed members block export."_ As written this blocks a film that has no
narration yet, and the designer explicitly rules the opposite:

> "`PARTIAL` therefore counts **picture only**, and an audio shortfall is stated as fact in the
> cut's audio lane — _'narration for Beat 2 — not generated'_ — never as a block-level status.
> **A film is not incomplete because nobody has recorded a voice yet.**"

> "Missing picture is a hole … Missing sound is a film that plays, silent, at full length."

**Amend to:** missing or failed **picture** members block export; missing audio does not, and
is recorded as a fact in the export's provenance rather than as a gate. Your
stale-with-acknowledgement clause is the right precedent for how to record it.

This also means `PARTIAL` is picture-scoped in the schema, not a general completeness flag.

---

## Decision 3 — one word, two causes, two action sets

Staleness stands, with a trap the designer flagged specifically so it is not implemented
globally:

> "`STALE` appears at both levels with one meaning — 'plays, but off the chain' — which is a
> **chain fact**. Audio has no chain and still stales, from a script edit. Same word, two
> causes, and the pairing differs: chain-stale offers **Re-render chain / Keep**; words-stale
> offers **only Keep**, because there is no chain to re-render."

And a scoping fact that simplifies Wave 1:

> "Reordering audio is always free (there is no chain to rewrite); audio never goes `STALE`
> from a reorder, only from a script edit; and audio is therefore **outside Ruling 1b
> entirely**."

So the priced/warned intra-Beat case cannot arise for audio at all. They add the condition
under which that breaks: if a future audio route ever conditions the next line on the previous
one, the row must be reopened.

---

## New: a canvas-wide behavioural rule that is not in any decision

> "**Playback is exclusive and never automatic.** Starting any sound stops every other sound
> and the cut; nothing on the canvas ever plays unbidden."

Their reasoning: pictures can be looked at forty at a time, audio cannot be heard two at a
time, "so the canvas must enforce what the eye enforces for free." Without it, a person
scrubbing a clip while a music bed plays hears a mix that is not in the film.

This needs an owner somewhere in Wave 1 or 3 — it is canvas state, not a sound-block property.

---

## Ruling 2 — both my inferences confirmed, with two scopings

I marked two entries **†** as inferred. Both confirmed, both narrower than I had them:

- **`READY TO RENDER`** — member level, and it appears _only_ where a member could start and a
  person has not said go. Not a resting state, never on a member nobody asked for.
  **Distinguished from `QUEUED` by one fact: no money is committed.**
- **`DRAFTED`** — block level, **kind-local to `document`**, paired with `CURRENT`. Their
  warning is worth heeding: mark it kind-local on the list "or it will be implemented as
  available to six kinds and used by one."

Plus the `STALE` note above, which belongs on the fixed list.

**D2 is fully answered**, including a case it only half-anticipated: a route that runs and
returns silence is `FAILED · returned silence · spent` — "the only failure in the product that
costs money and produces a file" — and **Retry is absent**, because retrying spends again for
the same answer.

---

## Schema fields this implies for the freeze

Not decisions, but consequences to have in hand before schema 7 closes:

- audio members carry a **time anchor** (Beat), not chain position;
- the **level** is a per-film fact about a sound and must persist somewhere the `cut` owns;
- **`PARTIAL` is picture-scoped**;
- generated sound holds `NEEDS BUDGET · PROPOSED · QUEUED · GENERATING · RENDERED · STALE ·
FAILED` — and notably **never `RENDERING`**, because mixing is the `cut`'s operation and the
  two never appear on the same block. That keeps the refund distinction legible: cancelling on
  a sound block always returns money.

---

## Three things the designer has offered you to overrule

1. The waveform sheds first and entirely — "I am calling it decoration."
2. `PARTIAL` counts picture only, so a film with no sound at all reads as whole. "Defensible,
   and it will surprise someone."
3. Exclusive playback stops the cut when a person plays a sound block. "Correct for hearing,
   mildly rude in use."
