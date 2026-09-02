# Ruling 2 (revised) — the canvas status vocabulary

Supersedes the Ruling 2 section of the original two-ruling memo. Revised against the
designer's Phase 6 grammar-extension delivery, which materially changed what is being
decided.

## What changed since the first draft

The first draft framed this as one question — what the running state is called. The
delivery establishes that this is **the second-biggest problem**, and names three larger
ones.

**Three words already mean the same condition.** CS3 ships **`SLATE`** ("shots without a
render hold their time as slates · 4 slates · 0:27"). The delivered grammar coined
**`STILLED`** on `board` and drew honest dashed gaps on `cut`. **`PARTIAL`** names the same
fact at block level. Three names, one condition, across two documents.

**A whole state is missing.** The prototype ships **`QUEUED · 2ND`** with "waits on 1.2's
last frame" and a **Move to front** action, plus **`READY TO RENDER`** and a percent-with-ETA.
The first draft listed none of them. The designer's argument is the decisive one:

> "A queue is not a run — money is committed, nothing is happening, and there is an action."

Video queues are long. Unlisted, this gets invented per-surface.

**The count was wrong.** The grammar's own preamble says two additions; there are **five**.

**And there is a real localization bug in the delivered spec**, not a preference: status
strings are translated in sentence case and uppercased in CSS, which mangles Turkish dotted
i, German ß and Greek accents.

## The rule

### 2a — One canvas-scoped vocabulary

Collapse the four view-scoped duplicate sets into **one canvas-scoped vocabulary during the
cutover**, while the deleted views' keys are still uncommitted. Designer concurs.

**Keep exactly one thing the view-scoped keys had:** a failure carries **a reason and a
cost-truth** — "rule breach · visible branding · not spent".

> "A failure that does not say whether money went is a failure a person cannot act on, and
> my delivered `FAILED` chip has room for neither."

So `FAILED` is not a bare chip. It is a chip plus a reason and an explicit statement of
whether money was spent.

### 2b — The running state is two states, not one word

**`GENERATING`** for provider work. **`RENDERING`** for local composition.

The designer's addition is the load-bearing part, and it is why these must never collapse
back into one word:

- **Generating** has conditions to show and money at stake. Region 4 is **present**. It can
  be **cancelled for a refund**.
- **Rendering** has neither. Region 4 is **absent**. There is nothing to refund.

The two words carry a behavioural difference, not a cosmetic one.

### 2c — `SLATE` at member level, `PARTIAL` at block level, `STILLED` retires

**`SLATE`** wins at member level: it ships, it is a film word, and it says "holds its time",
which is the whole content of the state.

**`PARTIAL`** stays at block level and survives video unchanged — a partly-rendered film is
exactly a film with slates in it. That answers the original 2c question. The sound rows add a
scope: **`PARTIAL` counts picture only.** Audio has no `SLATE` and holds no time of its own, so
a film missing sound is not partial — it plays silent at full length.

**`STILLED` retires.** This is the designer dropping their own coinage and recommending it;
accept it.

### 2d — `QUEUED` and `READY TO RENDER` join the fixed list

`QUEUED` carries its position (`QUEUED · 2ND`), its dependency ("waits on 1.2's last frame")
and its action (**Move to front**).

`READY TO RENDER` is member level and narrower than it first reads: it appears **only where a
member could start and a person has not said go**. It is not a resting state and never appears
on a member nobody has asked for. It differs from `QUEUED` by exactly one fact — **no money is
committed.**

### 2e — Uppercasing is disabled for four locales

`text-transform: none` for `:lang(tr)`, `:lang(az)`, `:lang(de)` and `:lang(el)`.

## The fixed list

Handing this to the designer and to implementation as settled. Level assignment follows the
delivery. The two entries previously marked **†** as my inference were **confirmed by the
designer's sound-rows delivery**, both with a narrower scope than I had them — carried below.

**Member level**

| Status | Meaning | Notes |
|---|---|---|
| `SLATE` | holds its time, no render yet | replaces `STILLED` |
| `QUEUED` | committed, waiting | carries position + dependency + Move to front |
| `READY TO RENDER` | could start, nobody has said go | **no money committed** — that is the whole difference from `QUEUED`. Not a resting state; never on a member nobody asked for |
| `GENERATING` | provider work in flight | region 4 present; cancellable for refund |
| `RENDERING` | local composition in flight | region 4 absent; nothing to refund |
| `RENDERED` | done | |
| `STALE` | superseded input | **two causes, two action sets — see below** |
| `FAILED` | failed | **must** carry reason + cost-truth, e.g. `FAILED · returned silence · spent` |

**Block level**

| Status | Meaning | Notes |
|---|---|---|
| `NEEDS BUDGET` | quoted, not commissioned | region 4 **is** the quote |
| `PROPOSED` | offered, not accepted | now available to `board` and `cut` too |
| `PARTIAL` | some members rendered | **counts picture only** — an audio shortfall is never a block status |
| `DRAFTED` | | **kind-local to `document`**, paired with `CURRENT`. Mark it kind-local on the list or it ships available to six kinds and used by one |
| `RENDERED` · `IMPORTED` · `CURRENT` · `STALE` · `FAILED` | | existing words |

## Three notes the list must carry

**`STALE` is one word with two causes and two action sets.** Chain-stale — "plays, but off the
chain" — is a chain fact and pairs with **Re-render chain / Keep**. Words-stale, which is how
audio stales (from a script edit), pairs with **Keep only**, because there is no chain to
re-render. The designer flagged this specifically so the chain pairing is not implemented
globally.

**`RENDERING` never appears on a `sound` block.** Mixing is the `cut`'s operation — the sound
is an unchanged input and what is being composed is the film. So `RENDERING` lives on the `cut`
and `GENERATING` on the sound, and the two never appear on the same block. This is what keeps
the refund distinction legible: cancelling anything on a sound block always returns money, and
no control on a sound block can imply otherwise.

**`PARTIAL` is picture-scoped.** Missing picture is a hole; missing sound is a film that plays,
silent, at full length. An audio shortfall is stated as a fact in the cut's audio lane
("narration for Beat 2 — not generated"), never as a block-level status. This has an export
consequence beyond the vocabulary: missing audio must not block export.

## What this costs, and why it is paid now

A repo test requires every referenced key to exist in **all twelve locales**. The vocabulary
therefore cannot be reconciled at the end of Phase 6 — each task ships its own translations.
Settling the list now means each key is written once, in twelve locales, deliberately.

Settling it later means writing some keys twice and discovering the Turkish, German and Greek
uppercasing defect in QA rather than in a spec.

## Consequence for the sequence

This ruling **gates the Phase 6 commission**, not only implementation: commission question 1
asks which statuses the quote block can hold, and that is this list. It gates roughly a third
of the commission.

It also gates the eleven table corrections, two of which (`cut` gains `FAILED`; `board` gains
`PROPOSED` and `NEEDS BUDGET`) are status-matrix changes that cannot be applied against a
moving vocabulary.
