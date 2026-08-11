# Creative Studio — the three-pane model

**Drafted:** 2026-08-11 · **Status:** design of record, pending four decisions in §6
**Source of truth:** the Claude clickthrough `Creative Studio - Write (Clickthrough).dc.html` (62 pages). Where this document and the clickthrough disagree, the clickthrough wins and this document is wrong.
**Reconciled against:** `integration/studio-director` @ `9baa9ceb9` ([PR #19](https://github.com/khoapnt-vng/WePrompt/pull/19))

---

## 1. The model

Studio becomes three fixed panes: **side menu · Director conversation · work panel**.

The conversation is **always on**, on the left, at shell level — not a per-phase component. The work panel is **an app with its own flow and controls** which the Director can also drive through MCP. The phase rail lives _inside_ the work panel, under a breadcrumb, rather than in the application header.

The line the design draws, and it is the important one:

> "The Director proposes; nothing reaches the script until you accept. Images are the one thing here that spends."

So the agent has two distinct capabilities with different consequences: it **proposes** script changes (nothing is written until the user accepts) and it **makes images** (which charge). Video is not made in Write at all.

## 2. Layout, measured from the clickthrough

| Region               | Spec                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| Container            | min-width **1340px**, radius 18px, bg `#F4EEE2`, border `#E0D8C7`      |
| Side menu            | **212px** fixed · bg `#EDE6D7` · border-right `#E1D9C8`                |
| Director pane        | **352px** fixed · bg `#F0EADD` · border-right `#E4DCCB`                |
| Work panel           | `flex:1`, `min-width:0`                                                |
| Work-panel header    | **56px** · breadcrumb `Creative Studio / <project>` + `SAVED` chip     |
| Script table columns | Shot **56px** · Script **200px** · Visual **320px** · Output **120px** |
| Produce modal        | **600px**, `max-height:88%`, overlay `rgba(31,29,27,.45)`              |

**Typography:** Manrope (display/labels), IBM Plex Mono (eyebrows, data, status), Source Sans 3 (body).
**Accent:** `#C9431A` primary, `#EC6338` bright. Text `#1F1D1B`, secondary `#54503F`, muted `#6E6553`.

All three typefaces are already loaded in the app, so no font work is implied.

## 3. Director pane — the parts

Top to bottom:

1. **Header** — `CD` avatar, "Creative Director", and the subtitle `SAME CONVERSATION AS YOUR BRIEF`. One thread across phases, stated in the UI.
2. **Transcript** — user messages right-aligned in bubbles; assistant messages as plain prose, no bubble. Thinking state is three shimmering dots plus a _specific_ label ("Reading the script"), not a generic spinner.
3. **Proposal card** — see §4.
4. **Outcome chips** — `APPLIED · JUST NOW · SHOT 03`, or `DISCARDED · JUST NOW` with a **Reopen** action. Compact rows, not full cards.
5. **Pending strip** — above the composer: `1 PROPOSAL WAITING`, subtitle "Shot 03 · visual · ready to accept", and an inline **Accept**. So a proposal is actionable without scrolling the transcript.
6. **Composer** — a **scope chip** (`SHOT 03 ▾`) binding the message to a shot, and placeholder "Ask for a change, or ask for an image…".
7. **Standing footnote** — the propose/spend sentence quoted in §1, permanently visible.

The side menu also carries a **`THIS STEP`** box pinned to its bottom: "Images are charged. Video is not made here." Phase-specific spend guidance, outside the work panel.

## 4. The proposal card, and why it is better than what we shipped

**Clean state** shows a per-field diff with a reason:

```
SHOT 03 · VISUAL
Aerial, drifting. Smoke columns, no readable signage.        (struck through)
Ground level, handheld. Debris past the lens, the skyline losing a building behind him.
Why: aerials read as news footage. From the ground it reads as threat.
─────
Shots 01, 02, 04, 05 unchanged
[Accept the script]  [Discard]
```

Two things here we do not have. **A rationale field** — the Director explains _why_, which is the part a director would actually say. And **"N unchanged" as prose** rather than a count.

**Stale state** is a significant advance on our fail-closed accept:

```
PROPOSED SCRIPT · OUT OF DATE                    OUT OF DATE
This was written against the script as it stood a moment ago. You've
changed shot 02 since, so accepting it would put your change back the
way it was.
┌ WHAT MOVED UNDER IT ────────────────────┐
│ Shot 02 duration · 4s → 5s · you, just now │
└──────────────────────────────────────────┘
[Ask again with my changes]  [Discard]
```

It names the field, both values, **the actor, and the time**, states the consequence in plain language, and offers a **recompute** rather than only refusing. Today we fail closed and offer a prefilled re-propose turn; this is the same safety with far better explanation.

## 5. Produce becomes a modal, not a route

Produce is a **batch-confirm modal over a dimmed Write screen**, titled "Produce N shots":

> "Each shot's plate is its clip's first frame. Look at it now — this is the point of no return for the spend, not for the plate."

One row per shot: plate thumbnail (132×74), `Seedance 1.0 · 4s · 16:9`, and **`~5 cr`**. Footer totals and, critically, **names the exclusions**: "3 shots · 12s · ~15 cr total. Shots 03 and 04 are not here — neither has a plate." Button: "Render 3 shots".

Consequences: the phase rail becomes **part navigation, part action** (step 3 opens a modal), and shots without plates are silently excluded from spend but _loudly_ named in the copy.

## 6. Four decisions required before implementation

### D1 — Asking for an image spends immediately

The composer invites "ask for an image", images charge, and the transcript shows the Director having already made two. That **removes the batch-approval gate we shipped in J2** (`97d6b47aa`), where assistant-queued reference requests waited for an explicit Accept in a review modal.

Defensible: images are cheap relative to video, and video stays gated behind the Produce modal. But it is a deliberate loosening of an existing control, and it should be chosen, not inherited. **Sub-question:** does the per-project cap still apply, and what happens when it is reached mid-conversation?

### D2 — Produce as a modal replaces Produce as a phase route

Today `produce` is a route with its own screen (`studioPhaseRoute.ts`, `ProducePhase.tsx`) and its own engine bar. As a modal, that screen's other content — engine selection, the per-shot generation controls — needs a home or needs dropping. **Which?**

### D3 — Credits become the cost unit

The modal prices in `~5 cr`. We have no credit ledger; we show honest-cost lines. This is a subsystem (balance, decrement, failure accounting, what happens on a partial batch) and it was already an open decision from the earlier redesign critique. **Is the ledger in scope, or do we show currency/opaque cost until it exists?**

### D4 — Per-field attribution

"Shot 02 duration · 4s → 5s · **you, just now**" requires knowing which field changed, from what, by whom, and when. We have store revisions, not per-field authorship. **Do we add attribution, or degrade the copy to what a revision diff can honestly say?**

## 7. Unanswered by the clickthrough

- **Collapse.** The brief called the three areas collapsible; the clickthrough shows fixed panes with no collapse control. Wanted or dropped?
- **Narrow widths.** Container min-width is 1340px. Today `useStudioLayoutMode.ts` defines `inline > 1120`, `drawer 820–1120`, `compact ≤ 820`. The design says nothing about either smaller mode.
- **Review.** Not in this clickthrough. It has its own outstanding commission, which explicitly says the cut strip is not to be built until drawn.

## 8. What this supersedes from work shipped 2026-08-11

Not wasted, but re-homed — worth stating so the cost is visible:

| Shipped today                                                 | Under this design                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Phase rail centred in the app header (`2a95fcf87`)            | Rail moves **inside the work panel**, under a breadcrumb                                 |
| Project title + inline rename in the app header (`eca1c1242`) | Becomes the work-panel **breadcrumb**                                                    |
| Save state in the app header                                  | Becomes the **`SAVED` chip** in the work-panel header                                    |
| Engine bar collapsed to a hover chip (`63f4566c8`)            | Produce is a modal; the engine bar's home is D2                                          |
| Script table `112px / 1.3fr / 1.7fr / 0.8fr`                  | Fixed `56 / 200 / 320 / 120`                                                             |
| OUTPUT cell states                                            | Product-language states: "Ready to produce" / "Needs an image before it can be produced" |

Kept and reinforced: the propose-only invariant, main-computed per-field diffs (`ea28f0fdf`), pending-only proposal cards (`3af963de7`), the reserved-name guard, and the "Waiting for your approval" indicator.

## 9. One architectural win

Making the Director a **shell-level pane** means exactly **one mount that never unmounts on phase change**. The multi-mount risk that gated this work disappears: there is no third mount point, and no phase switch can tear down a streaming reply.

The A15 phase-switch-mid-stream smoke passed on 2026-08-11 against the harder two-mount case in both `inline` and `drawer` layouts, with no loss, no duplication and no double-persist across a reload. Under this design that smoke becomes a regression guard rather than a gate.

## 10. Next step

Answer D1–D4 and the two §7 questions, then write the implementation plan. Do not start tasks before D1 and D2 — they decide whether the spend model and the Produce surface change, and both touch code that multiple phases share.
