# Creative Studio 3 — the Beat panel: how the flow works, and three things it does not settle

Written 2026-08-21 against the designer's Beat panel drawing (`BEAT 03 · Card evolution`, 31s, three
Shots) and checked against the code where the code has an opinion.

Two audiences. For the **designer**, sections 1–2 state what we believe so the questions in section 4
can be answered briefly rather than re-explained from scratch. For **anyone implementing**, section 3
lists where each claim is grounded, so a disagreement can be settled by reading rather than arguing.

---

## 1. The spine: one human sentence per Beat

A Beat asks a person for exactly one thing — the **Action**, labelled in the drawing as _the one thing
you write_:

> Show a card levelling past its cap, and its art changing as it does.

Everything below it is derived:

```
Action  ──derives──▶  Shot Lines  ──renders──▶  Takes
```

Shot 03 carries both halves of that contract on its face: `DERIVED FROM THE ACTION`, and above the
Line, `WRITTEN FROM THE ACTION · EDIT TO DETACH`.

**Detaching is the load-bearing part.** A Line starts attached to the Action and is rewritten whenever
the Action is re-derived. Typing in it detaches it, and from then on re-deriving leaves it alone. That
is what makes `✧ Split it differently` safe to offer at any time: it re-splits the attached Lines and
never destroys words a person actually wrote.

## 2. The parts, and why each is shaped that way

### The Look is a beat-level constant

`LOOK · EVERY SHOT INHERITS IT`. It is not styling — it is the binding that makes three separately
generated clips read as one film. It carries the prose, the reference thumbnails, the cast
(`CAST · THE STRIKER`) and the model binding (`SEEDANCE-2.0 · 16:9`).

The `10 / 25 WORDS` counter is a discipline device rather than a limit for its own sake: a Look that
sprawls stops being a constraint a model can honour across every Shot.

### Shots chain by first frame

A Shot's first frame is the previous Shot's last frame — Shot 03 says `CONTINUES FROM 02` — unless a
hard cut severs the chain. The head of a chain starts from the seed still instead.

This chain is not a nicety. It is what the entire cost model rests on.

### A Shot with no Take still holds its place

```
SLATE · NO TAKE YET
HOLDS 11s IN THE CUT
```

An unrendered Shot is not absent from the film; it occupies its eleven seconds as a slate. So runtime
is honest from the first minute, before anything has been paid for. This is why the Cut can say
`2:57 of 0:18` on a project that has barely any media.

### The coverage strip is the Beat's timeline

Three segments, proportional to duration, each showing its own state at a glance:
`RENDERED · 2 TAKES`, `RENDERING · 40%`, `NO TAKE · READY`.

### The two drags, and why the footer is a price list

```
↔ EDGE     · TRIM     · FREE
↔ BOUNDARY · COSTS A RE-RENDER
```

Both look like dragging the edge of a segment. They are different operations:

| Drag            | What it changes                                   | Cost        | Why                                     |
| --------------- | ------------------------------------------------- | ----------- | --------------------------------------- |
| **Edge / trim** | in and out points **inside footage already held** | free        | nothing new has to be made              |
| **Boundary**    | what each Shot must **contain**                   | a re-render | the footage no longer depicts that span |

And because Shots chain first-frame, re-rendering Shot 02 changes Shot 03's starting frame, so 03 may
have to go too. That is the **cascade**, and it is why a quote comes back as a range: the base cost if
nothing cascades, a higher one if it does.

So that footer line is not a keyboard legend. It is a price list, placed directly under the control
that charges you. Nothing in the built panel currently says this.

### The transport is Beat-scoped

`0:20 / 0:31` against a 31s Beat — the playhead is inside this Beat, not the film. `JOIN ◂` and
`JOIN ▸` jump between boundaries, which is the right unit when what you are judging is whether two
clips actually join.

---

## 3. Where each claim is grounded

| Claim                                        | Source                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shots chain, and a hard cut severs it        | `chainBreak: 'none' \| 'hard_cut'` — `creativeStudioTypes.ts:309,327`                          |
| Breaking the chain is an explicit operation  | `{ kind: 'set_hard_cut', shotId, hardCut }` — `creativeStudioTypes.ts:1199`                    |
| Trimming is a plain mutation, not a render   | `{ kind: 'trim_shot', shotId, trimInSeconds, trimOutSeconds }` — `creativeStudioTypes.ts:1201` |
| Re-rendering can cascade down the chain      | `deriveExpectedCascadePairs` — `pricing/estimate.ts:325`                                       |
| A quote is separate from a charge            | `prepareSubmission` quotes free; `confirmSubmission` is the paid call                          |
| The Director can read the project unprompted | `read_storyboard` returns `brief` — `studioServer.ts:860`                                      |

Claims drawn only from the drawing, with no code behind them yet: the word counter's 25-word ceiling,
the Beat-scoped transport, and the coverage strip's density tiers.

---

## 4. Three things the drawing does not settle

Each is a fork the build cannot straddle.

### 4.1 `CONTINUES FROM 02 · CONTINUITY BREAK` — state and control, or state and warning?

The two halves sit on one line and read two opposite ways.

- **State plus control.** "This Shot continues from 02", and _Continuity break_ is the affordance that
  severs it. Then it is always present, always clickable, and it sets `chainBreak: 'hard_cut'`.
- **State plus warning.** "This Shot is meant to continue from 02, and continuity is currently
  broken." Then it is conditional, inert, and something has to detect the break and raise it.

One is a permanent button; the other an occasional alert. They cannot both be built.

### 4.2 `▸ RENDERS AS` — what does the disclosure show, and can it be edited?

Our reading is the resolved prompt actually sent to the model: Action, Look, Line, cast and references
composed into one text.

If that is right, the follow-up matters more than the feature itself — **is it read-only or
editable?** Editable makes it a fourth authoring surface beside Action, Look and Line, and it would
need its own detach rule: once a person edits the resolved prompt, does re-deriving the Line still
overwrite it?

### 4.3 The `+` on the join markers — insert a Shot, and at whose expense?

We read it as "insert a Shot at this join". Two things follow that the drawing does not settle.

- Inserting mid-chain changes the boundary on both sides, and the footer rules that a boundary **costs
  a re-render**. The `+` carries no cost hint. Should it — or is an inserted Shot always a fresh slate
  with nothing to invalidate?
- Does inserting **extend** the Beat past its 31s, or **redistribute** the existing 31s across four
  Shots?

The second half of 4.3 is the one worth pressing. It is not really about the `+`: it decides whether
Beat duration is a **target the Shots must fit** or a **total that follows from them**, and that
reaches the Table, the Cut, and every fit-to-target calculation in the app.
