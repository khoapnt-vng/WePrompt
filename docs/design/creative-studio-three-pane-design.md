# Creative Studio — the three-pane model

**Drafted:** 2026-08-11 · **Status:** design of record — **all decisions settled 2026-08-12**; implementation plan at `docs/superpowers/plans/2026-08-12-studio-three-pane.md`
**Source of truth:** the Claude clickthrough `Creative Studio - Write (Clickthrough).dc.html` (62 pages). Where this document and the clickthrough disagree, the clickthrough wins and this document is wrong.
**Reconciled against:** `integration/studio-director` @ `9baa9ceb9` ([PR #19](https://github.com/khoapnt-vng/WePrompt/pull/19))

---

## 1. The model

Studio becomes three **collapsible** panes: **side menu · Director conversation · work panel**.

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

The correct implementation is a **Studio MCP tool that submits an image job through the existing job manager**, so route validation, idempotency, the audit trail and concurrency pacing all continue to apply. The Director gains the _decision_, not a private channel to the provider.

> ### ⚠️ Correction, 2026-08-12 — an earlier draft of this section was wrong
>
> It claimed "the per-project cap still applies". **There is no per-project spend cap, and there never was.** Verified by spike:
>
> - `MAX_IN_FLIGHT_PAID_JOBS_PER_PROJECT = 2` (`jobManager.ts:50`, used at `:393`) is a **`FifoSemaphore`** — a _concurrency_ limit. Jobs beyond it **queue**; they are never refused.
> - `submitScenes` gates on batch ≤24 scenes, prompt ≤4KB and a revision match. No total ceiling.
> - `GenerationReviewModal` **discloses** cost and enforces nothing.
> - `RemoteMediaBudget` is a media _download_ budget; `quota` / `rate_limited` are _provider_ error codes. Neither is a spend control of ours.
>
> So before D1, image spend was bounded by exactly two things: **the human pressing Accept** in the review modal, and **the spend fence** keeping the agent away from the provider. D1 removes the first.

### ✅ D1a — No spend cap is added (decided 2026-08-12)

Cost is explicitly not a concern at this stage. **No ceiling is introduced**, and the consequence is recorded here so it is a known position rather than something discovered later:

**After D1, nothing bounds the total number of images the Director can generate.** The remaining controls are concurrency pacing (2 in flight per project, which slows but never stops) and the fact that every generated image is visible in the transcript. There is no refusal path, so the tool needs no "capped" failure copy.

If cost later matters, the enforcement point already exists — `submitScenes` is the single funnel every paid job passes through, and a ceiling belongs there rather than in the tool or the UI.

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

## 7. Shell behaviour and scope

### ✅ Collapse — settled 2026-08-12: the shell is collapsible and expandable

Panes collapse and expand. This **overrides the clickthrough**, which draws fixed panes with no control — the mock shows one width, not the whole behaviour.

Since collapse is user-driven, the choice has to persist; a pane that reopens itself on every navigation is worse than no control. Existing precedent to follow rather than reinvent: the app sidebar already has a "Collapse sidebar" control.

### ✅ Scope — settled 2026-08-12: the work area is one app, and only Brief and Write change now

**The work area is a single application hosting all four phases**, not four screens sharing a frame. It owns its own flow, navigation and controls, and the Director drives it through MCP.

**Produce and Review keep their current content this round.** They live inside the new shell and gain nothing else; they are fixed later. This is a deliberate deferral, not an oversight — Review in particular has an outstanding commission that says its cut strip is not to be built until drawn.

### ✅ Brief's work-panel content — settled 2026-08-12: the brief text stays

**Brief's work panel keeps the brief itself — the constraints row plus the brief text as an editable document.** Chosen on cost: it is the only option that is _net deletion_, and it is explicitly provisional, to be revisited once the shell is real.

Measured against `BriefPhase.tsx` as it stands, all of it already exists — the brief `Input.TextArea` (`:179`, capped at `MAX_PROJECT_BRIEF_CHARS`, 16KB), the duration `InputNumber` (`:110`), the aspect `Select` (`:139`). Implementing this means **removing** the two things that move to the Director pane — `StudioConversationSurface` (`:168`) and `BriefProposalCard` — and keeping the rest. No new components.

The alternatives cost more:

- _Show the script as it stands_ needs a **read-only variant of the Write table**, which does not exist, and leaves two screens showing the same table.
- _Drop Brief as a phase_ touches `studioPhaseRoute.ts`, `studioPhaseCompletion.ts`, `resolveStudioEntryPhase`, i18n keys and two test files that assert the four-phase set — and contradicts the §7 decision to treat the four phases as one app.

Nothing here forecloses either alternative later: the brief textarea is independent of the script table, so swapping Brief's content is a local change.

_Context for that decision._ Moving the conversation to the shell leaves Brief without its main content, and the clickthrough never draws it: the mock shows `Brief ✓` as a completed step with Write active, so Brief's own work-area is undrawn.

Today Brief holds three things — the constraints (duration, aspect), the conversation, and the proposal cards. Under this design the conversation **and** the proposal cards move to the Director pane (§3, §4). What remains for Brief's work panel is a compact constraints row, which is close to an empty screen.

### ✅ Narrow widths — settled 2026-08-12: collapse subsumes them, on the existing breakpoints

Reuse `useStudioLayoutMode.ts`'s existing modes rather than inventing new ones — they are already built, tested and shipped:

| Mode      | Width        | Side menu                 | Director pane                           |
| --------- | ------------ | ------------------------- | --------------------------------------- |
| `inline`  | `> 1120px`   | user preference           | user preference, **pushes** content     |
| `drawer`  | `820–1120px` | user preference           | force-collapsed; expanding **overlays** |
| `compact` | `≤ 820px`    | force-collapsed; overlays | force-collapsed; overlays               |

🚨 **The load-bearing rule: auto-collapse must never overwrite the stored preference.** Width-driven collapse is a _presentation_ override, not a change of intent. If narrowing the window writes `collapsed` into storage, then widening it again leaves the pane shut and the user's choice is silently destroyed — worse than having no control. Keep the preference and the effective state as two separate values, and derive the effective one from `max(preference, width constraint)`.

The mock's 1340px min-width is **not** adopted as a hard minimum. It is the width the mock happens to be drawn at; the app must remain usable below it.

Overlay behaviour at `drawer` is not new work — `AssistantDock` already switches between inline and Arco `Drawer` presentation on exactly this breakpoint.

> ⚠️ **Correction, 2026-08-12.** An earlier draft said `AssistantDock` keeps its drawer children mounted while closed, and cited it as precedent. **It does not** — it passes `unmountOnExit`. Arco's `Drawer` also defers mounting until first open. Both defaults tear down the subtree, which would drop a reply streaming into a shut overlay, so the Studio shell passes `mountOnEnter={false}` **and** `unmountOnExit={false}` explicitly. Caught by a test, not by reading.

## 8. What this supersedes from work shipped 2026-08-11

Not wasted, but re-homed — worth stating so the cost is visible:

| Shipped today                                                 | Under this design                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Phase rail centred in the app header (`2a95fcf87`)            | Rail moves **inside the work panel**, under a breadcrumb                                 |
| Project title + inline rename in the app header (`eca1c1242`) | Becomes the work-panel **breadcrumb**                                                    |
| Save state in the app header                                  | Becomes the **`SAVED` chip** in the work-panel header                                    |
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

## 9. Audit round 1 — the Director pane must BE the chat (2026-08-12)

Walked the built shell against two Claude Design reference screens (entry screen; project
screen). The headline finding supersedes parts of §3.

### The finding

`StudioConversationSurface` already renders `AionrsChat` — the same component the main chat
uses. Once a Director conversation exists, the thread and composer are already identical to
the rest of the app. **The discrepancy is entirely the first-message state.**

`useBriefConversation` creates the conversation lazily inside `sendFirstMessage`, so before
you have sent anything there is no conversation to hand `AionrsChat`. `DirectorPane` fills
that gap with a hand-rolled `Input.TextArea` + Send button: no attach, no model picker, no
permission selector, no `/` commands, no `@` file references, no `↑/↓` history.

### D5 — Create the Director conversation eagerly on project open

Settled by the reference: Claude Design's project screen shows a completed exchange on a
brand-new project, so the conversation is created up front rather than on first send.

Do the same. Mount `AionrsChat` from the moment the project opens and **delete the stub
composer entirely**. Not a lookalike — the same component. Lookalikes drift.

Two consequences, accepted:

- A conversation record exists per Studio project from open, including projects never used.
- The MCP set freezes at conversation-create time, so it freezes earlier. For Studio this is
  better: the tool set is fixed before the user types.

### D6 — The scope chip lives on the composer, and is NOT dropped

An earlier note suggested dropping §3's scope chip and letting `@` carry shot references.
The reference contradicts this: Claude Design puts a scope chip (`Design System ⌄`) as a
header row on the composer itself, above the input. So `SHOT 03 ▾` belongs there, as a
composer header row — not inline, and not dropped.

### D7 — Drop the Director pane's header block

The reference's left pane has no avatar, no assistant name, no subtitle: just the project
name above the thread.

§3.1 justified `SAME CONVERSATION AS YOUR BRIEF` as load-bearing — a user reaching Write had
no other way to know the thread persisted. That reasoning is now obsolete: it was written
when the conversation lived inside Brief. An always-on pane demonstrates continuity by never
going away, so the subtitle explains something the UI no longer hides.

Removing it also reclaims the vertical space the `CD` monogram and two lines of text occupy
at the top of a pane whose scarce axis is height.

### D8 — The work panel names its own state

The reference's work area reads `No file open ⌄` — the panel says what it is showing and
offers a way to change it, independent of the conversation. Our work panel is phase-driven
and has no equivalent. Worth considering whether the breadcrumb should carry that role.

### Not in this round

Stale proposal card, outcome chips with Reopen, and the pending strip are still unbuilt and
were excluded from the walkthrough. The proposal **rationale** field remains blocked on a
cross-process slice: `StudioProposal` has no such field and `validateProposalRecord`
exact-matches its keys.

## 10. Audit round 1, continued — D10 and D11 (2026-08-12)

### ✅ D10 — Remove Write's writing assistant

The Director is always on. A second assistant inside Write is a redundant surface offering a
subset of what the pane beside it already does, and it currently renders as a near-empty
drawer whose only content is a disabled action and a "currently unavailable" notice.

Delete it: the drawer, its trigger, its styles and its copy.

**⚠️ Two consequences that must be handled in the same change, not after it.**

**1. It is the fallback target of "Suggest visual".** `WritePhase` (fixed in `5bbb371d2`)
focuses the Director's composer and, when focus does not land — pane collapsed, or overlay
shut below 1120px — falls back to Write's own assistant. Deleting the assistant without
redirecting that fallback reintroduces the exact silent no-op `5bbb371d2` fixed.

The new fallback must be to **reveal the Director** — expand the pane, or open the overlay —
and then focus its composer. That is what "always on" implies, and it removes the need for a
fallback surface at all. The guard test must assert the reveal, not merely that no error
occurred.

**2. The drawer owns "Draft storyboard".** This is wired to `editor.proposeStoryboard`, a real
capability, not just copy. Removing the drawer strands it unless it lands somewhere.

Preferred resolution: **nowhere.** The Director already holds the Studio MCP tools and can
draft a storyboard conversationally, which is the whole premise of the single-Director model.
Before deleting, confirm the Director can actually reach that capability — if it cannot, this
decision blocks on giving it one, because losing drafting entirely is not acceptable.

Note also the observed "Storyboard drafting is currently unavailable" state: drafting is gated
on configured text-model routing. Whatever replaces the entry point must degrade as legibly.

### 🔶 D11 — Model change in the work-area toolbar: DEFERRED

Explicitly parked by the product owner, recorded so it is a known open question rather than an
oversight.

A work-area toolbar menu carrying "change model" would make **three** places a model can be
chosen: Produce's engine bar (which D2 ruled keeps its home), `AionrsChat`'s own picker in the
Director pane, and the toolbar. That is not obviously wrong — they may govern different things
— but it is not settled, and D2 would have to be revisited to settle it.

Nothing in D9 may depend on this. The toolbar shell and the progress bar are additive and do
not touch model routing, so they proceed; the menu's contents wait.

## 11. The architecture, stated plainly (2026-08-12)

Two sentences from the product owner, recorded verbatim because they generate every decision
so far and the ones still open:

> The Director is an assistant, with Studio MCP capability. Users chat with the Director; the
> Director can do the work in the Studio workspace.
>
> The Studio workspace is an app — a canvas where a video-creation workflow is designed.

### What this means structurally

**Two components, one boundary.**

- **The conversation pane is the app's ordinary assistant surface.** `AionrsChat`, unmodified.
  Nothing Studio-specific may live in its UI — the Studio-ness enters entirely through the MCP
  tool set attached to the conversation. (D5 and D7 are this principle applied; D10 removes the
  last duplicate assistant surface.)
- **The workspace is a document app.** The document is the CAS-guarded project store; main is
  its sole writer; the four phases are _views of the document_, not steps of a wizard.
- **The bridge is a transaction protocol, not shared UI.** Tools PROPOSE; the human ACCEPTS;
  main writes. Proposal cards are the Director's output and ride beside the conversation.

### The sorting rule

For any piece of chrome, ask what it governs:

1. **The assistant** → conversation pane. (Its model picker already lives in its composer.)
2. **The document as a whole** — identity, save state, in-flight paid work, advisories,
   handoff → the app frame, i.e. the D9 toolbar.
3. **One view's behaviour** — engine facts, per-shot controls, cut resync → that view.
4. **Nothing (duplicates the assistant)** → delete. (D10, Brief's old column, the stub composer.)

This rule, applied to the 2026-08-12 chrome survey, produces D9 below. It also dissolves the
model-change ambiguity that forced D11: "change the model" was three different sentences —
the assistant's model (pane, exists), the document's engines (view, engine bar per D2), and a
settings handoff (a toolbar menu may carry one without owning either). D11 stays parked; it
is only smaller now.

### ✅ D9 — The work-area toolbar

**Decided.** One toolbar across the top of the work panel: document identity on the left,
document state and actions on the right. It replaces `StudioPhaseHeader` (which is the toolbar,
grown up) rather than sitting beside it.

- **Left:** the existing breadcrumb and inline-rename project title (both already in
  `StudioPhaseHeader.tsx:78-140`), plus a document subtitle in the reference's "62 pages"
  position — Studio's honest equivalent is shot count and duration ("5 shots · 15s").
- **Right:** the SAVED chip (`:143`); a **project-level activity indicator** (see below); the
  phase primary action (the existing `actions` slot, `StudioPhaseShell.tsx:60-96`); an overflow
  menu whose contents are **deferred per D11**.
- **The phase rail stays a second row** for now. It is the app's view switcher, so it belongs
  to the frame conceptually, but folding it into the bar is layout, not architecture, and the
  rail is load-bearing for a11y (`aria-current='step'`, completion markers).

**The activity indicator is the substantive new thing.** The survey's verdict: _nothing
resembling project-level progress exists._ `useStudioJobs` is mounted at page level
(`StudioPage.tsx:276`) but rendered only inside Produce's feed; cut-render progress is only a
button label inside Review. The toolbar gets the aggregate — "N generating", "Rendering 42%" —
with the per-job detail staying where it is (rule 3: the feed is Produce's view detail).

**Prerequisite plumbing, non-optional:** `useStudioRender` is subscribed _inside_
`ReviewPhase.tsx:30`, so today an in-flight render becomes unobservable the moment the user
leaves Review. Under the app framing that is a document-level process trapped in a view — the
subscription hoists to `StudioPage` alongside `useStudioJobs`, and Review consumes it from
there. This is the survey's most consequential finding.

**What D9 explicitly does not do:**

- Does not touch the engine bar (D2 stands; its spend-relevant facts — `maxDurationSeconds`
  reshaping the script — must stay ambient in Produce, and `EngineBar.tsx:74` /
  `ConnectEngineCard.tsx:34` carry Produce's `data-studio-phase-heading` focus target, which
  must not be orphaned).
- Does not decide the overflow menu's contents (D11).
- Does not move Produce's job feed or Review's render controls.
- Deletes Brief's duplicate save-state readout (`BriefPhase.tsx:177-186`) — rule 2 says the
  frame owns save state, and two live `role=status` readouts of the same fact is a defect.

**Two survey flags recorded while they are cheap:**

- `GenerationControls.tsx` is dead code (not mounted anywhere) with the same live-looking shape
  as the SceneCard/StoryboardPanel trap. Candidate for deletion in any nearby slice.
- `useStudioModels.ts:232` `autoSelectSoleRoute` writes `project.routing` with no user gesture —
  a deliberate convenience, but it is the one writer that bypasses the propose/accept protocol,
  and anyone reasoning from "the human approves document writes" must know it exists.
