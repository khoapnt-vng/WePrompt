# Creative Studio — the three-pane model

**Drafted:** 2026-08-11 · **Status:** design of record — §6 decisions all settled 2026-08-12; §7 still open
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

## 5. The Produce mock — rejected by D2, kept here for its copy

The clickthrough draws Produce as a **batch-confirm modal over a dimmed Write screen**. **D2 rejects this** — Produce stays a phase route. The modal is recorded because its _copy_ is worth taking:

> "Each shot's plate is its clip's first frame. Look at it now — this is the point of no return for the spend, not for the plate."

One row per shot: plate thumbnail (132×74), `Seedance 1.0 · 4s · 16:9`, and **`~5 cr`**. Footer totals and, critically, **names the exclusions**: "3 shots · 12s · ~15 cr total. Shots 03 and 04 are not here — neither has a plate." Button: "Render 3 shots".

The transferable part is that it **names what it is leaving out** rather than silently producing fewer shots than expected. That belongs on the Produce route's confirm step. The modal itself, and the part-navigation/part-action rail it implied, are not built.

## 6. Decisions — all four settled 2026-08-12

### ✅ D1 — The Director decides when to make an image

The Director has authority to generate images without a per-image approval. This supersedes J2's batch-approval gate (`97d6b47aa`, `bf7a985d4`, `a1cc6491e`), where queued reference requests waited for an explicit Accept.

🚨 **This must NOT be implemented by attaching the image-generation MCP to the Studio conversation.** That server reaches the provider directly, bypassing the job manager, the review modal and the per-project cap, and a snapshot test asserts its id — with five other auto-attach ids — is absent from the curated Studio conversation. That test is the spend fence and it stays.

The correct implementation is a **Studio MCP tool that submits an image job through the existing job manager**, so metering, the per-project cap, idempotency and the audit trail all continue to apply. The Director gains the _decision_, not a private channel to the provider.

That also answers the sub-question: **the per-project cap still applies**, because the job manager still enforces it. When the cap is reached the tool must fail with a reason the Director can relay in prose, not fail silently.

### ✅ D2 — Produce stays a phase route; the modal is not built

The clickthrough's Produce modal is **rejected**. `produce` remains a route with its own screen, engine bar and per-shot controls.

Consequences, all simplifying: the phase rail stays **pure navigation** rather than part-action; the engine-bar hover shipped today (`63f4566c8`) is **not** superseded and keeps its home; and the §8 re-homing list shrinks accordingly.

Worth borrowing from the mock even though the modal is not: its confirm step **names its exclusions** — "Shots 03 and 04 are not here — neither has a plate" — rather than silently producing fewer shots than the user expects. That copy belongs on the Produce route's own confirm. Optional, not blocking.

### ✅ D3 — No credit ledger

Out of scope. Cost is not priced in credits (`~5 cr`); the existing honest-cost lines stand. Any mock text showing credits is illustrative only and must not be transcribed into the build.

### ✅ D4 — Degrade the copy; do not add per-field attribution

No per-field authorship tracking. The stale card says only what a revision diff can honestly support.

So "Shot 02 duration · 4s → 5s · you, just now" is **not** implementable as drawn. What survives is the field, the two values, and the fact that the script moved — without asserting **who** or **when** unless the store already knows it.

⚠️ **Do not fabricate the actor.** In a single-user desktop app "you" is _probably_ true, but a proposal can also be superseded by an accepted proposal, which is not the user typing. Say what is known; drop what is not. The rest of the stale card — the `OUT OF DATE` badge, the plain-language consequence, and **"Ask again with my changes"** — is unaffected and is still the main win over today's fail-closed accept.

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

D1–D4 are settled (§6). Two questions in §7 remain — **collapse** and **narrow widths** — and both are shell-layout questions, so they block the pane work rather than the Director or proposal work.

Sequencing that follows from the decisions:

1. **Not blocked, can start:** the Director pane's contents — proposal card rationale, the stale card with its recompute action, outcome chips with Reopen, the pending strip, the composer scope chip.
2. **Blocked on §7:** the three-pane shell itself, since collapse and narrow-width behaviour change its structure.
3. **Needs a spike first:** D1's image tool. The Director gaining image authority while the spend fence holds is the one piece where a wrong implementation is expensive, and it is worth proving the job-manager route before building UI on top of it.
