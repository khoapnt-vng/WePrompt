# Creative Studio 3 — bug list

> Found 2026-08-21 by **running the app** against the CS3 Task 13 head `4966e4778`
> (`codex/creative-studio-table-board-ui-design`), dev slot 2, Studio enabled, bundled aioncore 0.1.55.
>
> Every entry below was reproduced in the running application, not inferred from source. Where an
> entry claims a wire fact, the evidence is the dev log or a live probe through the renderer's own
> `ipcBridge`, quoted inline.
>
> **Id allocation:** `BUG-061`+ is allocated above `BUG-060`, the highest id on `ghk/sprint4` as of
> 2026-08-21. `sprint4` is active, so re-check for collision before folding these into the shared
> register.
>
> **Not in this list:** the `aria-current` gap on the view switch, which Task 13 closed — the switch is
> now `<nav aria-label="Workspace views">` with `aria-current="page"` on the active link.

## The CS4 triage contract

Every open entry carries a **CS4 triage** line. It is a disposition against the CS4 cutover, decided
2026-08-30, and it is **blocking**: parallel implementation does not start until every open entry has
one. The point is to stop work on surfaces CS4 deletes, without closing defects that outlive them.

**Nothing here is closed by a disposition.** The status semantics are the whole mechanism:

| Disposition               | What it means                                  | When the entry closes                                                                             |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **fix before CS4**        | A surviving dependency is broken               | When fixed; it blocks the named destination gate, and the base only when that destination says so |
| **absorb into CS4**       | CS4's own work subsumes it, at a named phase   | When that phase's acceptance evidence passes — not when the phase ships                           |
| **superseded by cutover** | The defect lives only in a surface CS4 deletes | When that surface is actually removed. Not before.                                                |
| **defer**                 | Real, but explicitly outside the pilot         | Not in this programme                                                                             |

**The distinction that matters is between a surface and a rule.** Pixels die with the four views;
rules about spend, provenance, the chain, refusals and Director behaviour do not. An entry whose
defect is drawn in a doomed view but whose _rule_ survives is **absorb**, not superseded.

**This was not a formality.** Of thirty entries, an adversarial pass overturned eleven — nearly all
of them from _superseded_ to _absorb_. The clearest was **BUG-182**: the cutover deletes the **fix**,
not the defect. `carriesPicture` and its only regression test both live inside `FirstFrames/`, so
closing that entry at cutover would tick it at the exact moment the product silently regresses to its
pre-fix state, with nothing left to catch it. That is the false closure this contract exists to
prevent.

**One entry is genuinely superseded**: BUG-173, first-cell alignment inside the Table. Nothing about
the store, spend, chain or provenance is implicated.

**Counts:** 3 fix-before-CS4 · 26 absorb · 1 superseded-by-cutover · 0 defer.

The two shared-base Tranche 0 blockers are **BUG-162** and **BUG-163**. They must land independently
on the current shared CS3 base, pass there, and reach CS4 only by merging that shared base afterward;
the current branch layout, a local duplicate, or a claimant label does not prove that sequence has
happened. **BUG-190** remains the third fix-before-CS4 entry, but it is a **Phase 5 Director-integration
entry prerequisite**, not a Phase 0 or Phase 1 blocker. **BUG-173** is the sole cutover-superseded
entry. Every absorbed entry below names the phase that owns its acceptance evidence; none is closed
merely because CS4 work starts.

Every triage block also carries a claimant field. `Unclaimed` is intentional at this planning
checkpoint; the implementing agent replaces it before the first code edit. A phase destination is
not a claim, and the list must not imply that paused or absent agents own work they have not reserved.

### Evidence that closes an absorbed entry

An `absorb` entry stays open until its destination phase produces evidence. "The phase shipped" is not
evidence. What counts, by phase:

| Phase                         | What closes an entry absorbed into it                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **1 · contracts**             | A test in the contract suite that fails without the change and passes with it, named in the entry.               |
| **2 · fixtures + extraction** | A fixture captured from a running backend replays the entry's reproduction.                                      |
| **3 · storage + projections** | A main-process test asserting the rule at the write boundary, so it cannot be deleted with a renderer component. |
| **4 · photo E2E**             | The Pilot 1 journey exercises the path the entry describes.                                                      |
| **5 · canvas UI**             | A DOM or accessibility test on the new surface, plus the twelve locales if the entry involves copy.              |
| **6 · film + modalities**     | The entry's own reproduction, re-run against the new surface.                                                    |

**The BUG-182 rule generalises: check whether the cutover deletes the FIX rather than the defect.**
Its guard and its only regression test both live inside a component CS4 removes, so closing it at
cutover would tick the entry at the moment the product regresses. Any entry whose evidence lives only
in a doomed file needs its evidence moved before that file dies.

## How this list is shared

Two agents work this list — one finds and files, one fixes — plus whoever is reviewing. It is a
single file on a single branch, so the rules below exist to keep that from turning into lost work.
They are here rather than in a chat transcript because a protocol nobody can read is not a protocol.

**Who writes what.**

- **Filing** — new entries, evidence, priority, and reproduction steps. Owned by whoever ran the
  thing and saw it break. Do not file an entry you have not reproduced.
- **Closing** — flipping `- [ ]` to `- [x]` and appending one line reading **Fixed by `<sha>`** with
  a sentence on what actually changed. Owned by whoever fixed it.

These touch different lines of the same entry, which is what makes concurrent work survivable. The
one place they collide is an entry being rewritten while it is being closed; if you are about to
rewrite an entry, close-or-comment first so the other side sees it.

**Which files belong to whom — nothing does, and the attempt is kept here so it is not repeated.**
An earlier revision of this section carried a table splitting the Studio source tree into a "Director
lane" and a "Workspace lane". It was written on 2026-08-30 from what each side had been editing, and
the work it was meant to coordinate contradicted it the same day. `ce06bb41d` — one ordinary feature,
sound during review — touched **21 source files in a single commit**: the IPC bridge, the native
payload schemas, the shared types, the Studio service, the Director's own tool server, nine files
under the Workspace views, and `openingTurn.ts`, the one file the table declared single-owner and
told the other side to leave alone. Across the four commits since the revert the tally is 14
Workspace-lane files, 4 service files, 3 DirectorRail files, the tool server, the shared type file,
and all 12 locale bundles. **Every boundary the table drew was crossed, most of them by one commit.**

**A file boundary cannot work here, which is different from saying this one was drawn wrong.**
Features in this codebase are vertical. Adding sound to review is not a renderer change: the
capability has to be declared in the tool schema, carried across IPC, persisted by the service, typed
in the shared file, translated into 12 locales, and only then rendered. Any lane drawn through that
stack cuts every feature in half. There is no better place to have drawn it.

**The deeper error was describing a split that does not exist.** The table imagined two agents
editing code in parallel. What is actually happening is a **role** split: one side implements across
the whole Studio surface, the other investigates, reproduces and files, and is not editing source at
all. A partition invented to separate two code editors, when there is one, adds a constraint without
removing a risk.

**What actually keeps concurrent work safe: claim the entry, not the file.**

- **Before starting an entry, say so in the entry** — one line naming who is taking it and when.
  That is the lock. It is per-defect, which is the unit work is actually organised in, and it costs
  one line instead of a taxonomy.
- **An entry in progress is not re-filed or rewritten by the other side.** Append findings as new
  bullets; do not restructure someone's entry underneath them.
- **Filing and closing stay separate**, exactly as above — they touch different lines, which is what
  makes the same entry survivable from two checkouts.

**Three merge hazards are real regardless of who owns what.** These are not ownership claims; they
are files where two concurrent edits cost more than a normal conflict.

- **`openingTurn.ts`** — editing `DIRECTOR_PRESET_RULES` changes `DIRECTOR_PRESET_RULES_PROFILE`,
  which makes every existing conversation stale and rewrites its rules on next open. Two people
  landing rule edits in the same window means repeated invalidation across the whole profile. (An
  earlier note here claimed the file is "one exported string constant" — it is not; it has five
  exports and a 127-line rules array. The textual-conflict argument was weak; the invalidation
  argument is the real one.)
- **`creativeStudioTypes.ts`** — both sides add fields. Say so in the entry before you start, not in
  the commit message afterwards.
- **The 12 locale bundles** — a repo test requires every referenced key to exist in all 12. Two
  agents adding keys in the same window conflict in twelve files at once and turn the contract test
  red for both. Land locale keys with the change that references them, never as a follow-up.

**What the `Lane:` line on an entry means now.** It names the **surface a fix would land on** —
Director tooling, Workspace UI, or the service — as a routing hint for whoever picks the entry up. It
is not an assignment and never was a good one; read it as "this is where to look first". Entries
before **BUG-179** have no such line, and adding one in a sweep is worse than leaving it off: let it
be written by whoever has just read the code.

**Id allocation.** Ids are global across the repository and are already inconsistent between branches
— `main` stopped at 030, `sprint2` at 041, `sprint4` at 060 — so two branches allocating the same
number is not hypothetical, it has happened. To keep it from happening here:

- **`BUG-061` through `BUG-079` are reserved to this list.** Nothing outside Creative Studio 3 takes
  a number in that range.
- Anyone needing a new id here takes the next free number **inside** that range, and nowhere else.
- **The range is now exhausted**: `BUG-061` through `BUG-079` are all allocated. New entries here take
  `BUG-080` upward.
- **The reservation did not hold, and the mechanism is the reason.** On 2026-08-21 at 11:52,
  `sprint4-consolidated` filed its own `BUG-061` and `BUG-062` into `TASKS.md` — an unhandled
  rejection escaping a gate run — while this list already used both numbers for the Director attach
  failure and the mislabelled storage error. Nobody did anything wrong: a reservation written into
  one branch's document cannot bind a branch that never reads it, so reserving a range here was never
  a reservation at all. **Two different defects now share each of `BUG-061` and `BUG-062` across two
  registers.** Renumbering is not proposed while Codex is working from these ids; the durable fix is a
  register-scoped prefix rather than competing for one global `BUG-nnn` space, and that is an owner
  decision.
- Before this list merges into a live register, re-check the max there. `sprint4` was at `BUG-060`
  when this range was chosen on 2026-08-21 and is still at `BUG-060`, but it is active, so verify
  rather than assume.

**Git discipline, because this file will be edited from two checkouts.**

- Rebase before pushing: `git pull --rebase` then `just push`. Never `--force`.
- Never amend a commit that has already been pushed. Amending is fine locally; once it is on the
  remote it belongs to everyone.
- Commit the list on its own. A documentation change riding along with a code fix makes the fix
  harder to revert and the list harder to read.

## Blocking a first-run user

- [x] **[BUG-061][P1][Creative Studio] Every newly created project fails its first Director attach** — **REOPENED and then FIXED 2026-08-21** — found 2026-08-21 by creating a project in the running app; **reproduced deterministically** on a second, clean project
  - Actual: immediately after "Create project", the Director rail shows "Director setup was interrupted before the conversation could be attached to this project." over "Creative Studio could not read or save this workspace." The project's `briefConversationId` stays `null` at revision 1. Clicking **Retry** fixes it every time.
  - Root cause: the renderer dictates the conversation id and then hard-asserts the result — `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorRail/index.tsx:444` builds `{ type: 'aionrs', id: input.conversationId, … }`, and line 479 throws `STORAGE_ERROR_KEY` when `conversation.id !== input.conversationId`. **aioncore does not honour the requested id.** It mints its own 8-hex short id, so the assertion can never hold on a fresh create.
  - Wire evidence, one project's creation: `GET /api/conversations/f8c487cf_eb02_4c96_ac44_4434206ddc24` → **404**, immediately followed by `POST /api/conversations` → **201** with `conversation_id=8a49d04b`. The requested id is a 36-char underscore-uuid; the assigned id is 8 hex characters.
  - Binding evidence, probed live through `creativeStudio.getProject`: before Retry `{revision: 1, briefConversationId: null}`; after Retry `{revision: 2, briefConversationId: "47b03580"}` — **aioncore's short id, not the uuid that was requested**. That is why Retry works: recovery matches the existing conversation by `extra.studio_project_id` and binds the real id, bypassing the equality check entirely.
  - The in-code comment at line 463 — "idempotent by deterministic id" — states an assumption this backend does not satisfy.
  - **Same defect class as BUG-046 and BUG-048, both already fixed, at a third site neither covered.** BUG-046 established that real conversation ids are 8-hex short ids across 35 live conversations while code validated RFC-4122 UUIDs; BUG-048 swept the runs and sources features. The Studio Director rail was not swept.
  - Why the suite is green: mocking `conversation.create` to echo back the requested id makes the assertion pass forever. This is the fixture-from-types-not-from-the-wire failure mode that hid all five EPIC-002 defects.
  - Fix direction: treat the id returned by `conversation.create` as authoritative and bind that; key recovery on `extra.studio_project_id`, which is already the mechanism that works. Do not simply delete the equality check — it exists to make create idempotent across a crash, so the idempotency story has to move to `studio_project_id` rather than disappear.
  - **Fixed by `ecc43f718`** — Director attach now binds the validated server-assigned id and uses complete project-claimant recovery to prevent duplicate conversations across retries and restarts.

- [x] **[BUG-063][P1][Creative Studio] There is no path in the UI to discover a bindable video model id** — found 2026-08-21 while configuring a video engine
  - Actual: "Add media model" → Video → OpenRouter → OpenRouter video rejects every model id offered anywhere in the UI. Searching the provider's model picker for `byte`, `seed`, or `seedance` returns only text models.
  - Root cause: **OpenRouter serves two disjoint catalogues**, verified live on 2026-08-21 — `https://openrouter.ai/api/v1/models` returns 418 text/LLM models, and `https://openrouter.ai/api/v1/videos/models` returns 24 video models (200 unauthenticated). The provider "Add Model" picker fetches the **text** catalogue via `POST /api/providers/fetch-models`, so a video model can never appear in it.
  - The media-model dialog's own Model field does not help either: its autocomplete is fed from `selectedCandidate.models` — the same text catalogue — with no filter by the selected integration (`StudioMediaModelsSection.tsx:173`). Choosing "OpenRouter video" still suggests GPT and Gemini ids.
  - Net effect: a user cannot configure video generation without reading `adapters/openRouterVideoAdapter.ts`. The six valid ids appear nowhere in the product.
  - Fix direction: when an integration declares a closed model set, the Model field should _be_ that set rather than free text over the wrong catalogue.
  - **Fixed by `ecc43f718`** — the main process now projects integration-scoped OpenRouter video candidates and the renderer enforces that closed set with a non-creatable selector.

  **REOPENED 2026-08-21 after verifying the fix by running it.** The id-equality assertion is gone and
  claimant recovery now keys on `extra.studio_project_id`, both of which were right. The symptom is
  unchanged: a brand-new project still shows the interrupted rail with `briefConversationId: null` at
  revision 1, reproduced twice on `d16bce78e`.

  **The cause moved rather than closed, and it is one line.** `hasExactDirectorMcpSnapshot` ends with

  ```ts
  return JSON.stringify(persistedDescriptor?.transport) === JSON.stringify(descriptor.transport);
  ```

  `JSON.stringify` is key-order sensitive. The freshly built descriptor serialises its transport in
  insertion order — `type, command, args, env`, with env in `PROJECT_ID, PROJECT_DIR, PENDING_DIR,
REFERENCE_PENDING_DIR, ROUTE_CATALOG` — while the same object read back through the conversation
  store comes out **alphabetically sorted**: `args, command, env, type`, with env in alphabetical
  order too. Same data, different string.

  **Measured against the live app**, both on the object the store returns and the one the descriptor
  call builds:
  - every top-level transport field: **identical** (`topLevelDiffs: []`)
  - every env value: **identical** (`envValueDiffs: []`)
  - key order: **different** (`envKeyOrderIdentical: false`)
  - `JSON.stringify(fresh) === JSON.stringify(persisted)`: **false**
  - the same comparison with keys sorted recursively: **true**

  Calling the exported predicates directly against live data isolates it exactly:
  `hasExactDirectorMcpSnapshot(conversation, projectId)` returns **true**,
  `hasExactDirectorMcpSnapshot(conversation, projectId, descriptor)` returns **false**, and
  `hasExactDirectorAuthoritySnapshot` returns **true**. Only the descriptor comparison fails, and the
  authority check — which compares the same seven fields individually rather than by serialisation —
  passes. That contrast is the whole diagnosis: field-by-field agrees, stringify does not.

  A trace of every Studio bridge call during a project creation confirms the consequence:
  `getBriefSessionServer` ok, `conversation.create` returns `de6cc5fb`, `getDirectorSessionAuthority`
  ok, and then nothing — `bindDirectorConversation` is never reached.

  **Fix direction:** compare the transport structurally, or canonicalise key order before serialising.
  The authority check beside it already does the former and is unaffected. Do not reintroduce the id
  assertion; that part of the fix was correct.

  **Same family as the original, one level down.** The first version assumed the backend would honour
  a supplied id; this one assumes the backend preserves key order through a round trip. Both are
  assumptions about a wire contract that unit fixtures satisfy and the real store does not — a
  fixture built in insertion order can never fail this comparison.

  **Fixed by the canonical comparison.** `hasExactDirectorMcpSnapshot` now compares the transport
  through a serialisation that orders own object keys recursively, leaving array order alone. Verified
  the way the bug was found — by creating projects in the running app. Three consecutive new projects
  bound their Director on creation, `briefConversationId` set at revision 2 with no Retry, where the
  same reproduction failed twice before.

  Two notes for anyone touching that predicate. The line above the comparison already used
  `hasExactKeys`, an order-insensitive key-set check, so the function was internally inconsistent —
  order-blind about which keys exist and order-sensitive about how they serialise. And array order is
  deliberately preserved but currently unprovable at this level: `hasSafeDirectorTransport` runs first
  and admits exactly one `args` entry, so no test can reach a two-element case through this predicate.
  An assertion claiming to cover it was written, found to pass for that reason rather than on merit,
  and removed.

- [x] **[BUG-077][P1][Creative Studio] A single disallowed operation silently refuses the whole Director batch, unnamed, and the user is told something untrue** — found 2026-08-21 watching the Director write a storyboard
  - Actual: the Director produced a complete three-Beat concept with narration, called `studio_apply_edits` three times in 18 seconds, was refused each time, and reported to the user: _"I wasn't able to save the storyboard because the current project disallows storyboard mutations."_ The Table still reads `No active beats yet` and the bar still reads `0 BEATS · 0 SHOTS`.
  - **That explanation is false.** `add_beat` and `add_shot` are both `direct` in `STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2`. The project allows storyboard mutations; the batch was refused for something else it contained.
  - **The refusal is all-or-nothing.** `operationBatchHasDispositionV2` is `operations.every((operation) => classify(operation.kind) === disposition)`, so one non-`direct` operation anywhere in the batch rejects every operation in it, including the Beats and Shots that were permitted.
  - **And it names nothing.** `studioServer.ts:1073` returns `errorResult('operation_not_permitted')` — a bare string, with no indication of which operation was refused or why. The Director cannot narrow the batch and retry, because it has not been told what to remove. It retried the identical batch twice, which the tool's own description forbids: _"Validation errors and unconfirmed results must not be retried."_ The refusal does not stop the retry it prohibits.
  - **The duration hypothesis is refuted.** It first looked like the Director was trying to widen the project's `0:18` target to fit a thirty-second plan, which would need the unpermitted `edit_project`. Asked to plan to eighteen seconds, it produced a tightened three-shot `0–6s / 6–12s / 12–18s` version — and was refused again, once, at 11:56:29, with the same outcome and the same false explanation. Whatever the batch carries, it is not a duration change.
  - **The batch is not recoverable after the fact, which is the part that makes this expensive.** The refusal happens before any I/O, so the dev log records the call and nothing about its contents. The rendered journal shows the Director's prose but no tool payload. So neither an engineer nor the Director can find out what was rejected: the information needed to fix it is destroyed by the same code path that rejects it.
  - Remaining candidates, none established: the Director produced a `Style:` line and a `Final on-screen title`, and persisting a house style would reach for `set_rules`, which is `operation_not_permitted`. Naming the operation in the refusal would settle it in one turn.
  - Three separable defects, worth splitting if they are taken separately: the refusal should name the offending operation; a batch of permitted operations should not be lost to one unpermitted one; and the model should not be able to report a project-level prohibition that does not exist.
  - **Fixed in this change.** `studio_apply_edits` now keeps the batch atomic but returns a bounded JSON refusal before ID or I/O. It names every rejected zero-based index, kind, disposition, and reason without echoing payload values; identifies the direct-capable indexes that never reached command evaluation; and gives truthful routing for proposal, unavailable, and independently valid direct subsets. Behavioral MCP tests cover the mixed batch, exact response, and poison-filesystem no-I/O boundary.

- [x] **[BUG-078][P1][Creative Studio] The Table's grid floor equals its fold threshold, so folding the Look can never make it fit and STATE is pushed off-screen** — found 2026-08-21 by seeding a project with nine Beats and looking at it
  - `Table.module.css` sets `.grid { min-inline-size: 860px }`. The Look folds at **860px and below**. The two numbers are the same, so the grid refuses to be narrower than the width at which it starts folding, and the fold can never achieve what it is for.
  - Measured at the Table's own design target: the scroll container is **690px**, the grid is **860px**, it overflows by **172px**, and `STATE` runs from 1453 to 1619 against a container that ends at 1448. **The whole STATE column is outside the visible area**, reachable only by horizontal scroll.
  - So the Table hides the one column that says whether a Beat is ready, in the view whose default is the narrow one. `0 READY` in the app bar is then the only readiness signal on screen.
  - **This is a gap in BUG-074's verification, and it is mine.** The fold was tested and mutation-proved — the heading merges, the cell merges, an unmeasured width does not fold — but nothing asserted the outcome the fold exists for: that the table fits its container afterwards. The tests verified the mechanism and not the purpose, which is the failure mode this list has recorded several times today.
  - Fix direction: the grid's floor has to be below the fold threshold, not equal to it, and a test should assert the folded table's `scrollWidth` does not exceed its container at the 780px target. Lowering the floor alone is not enough — the five remaining columns have to be shown to fit at 780px, which is what the designer's `ACTION cell 374px` figure implies.
  - **Fixed by `8a56d1d67`.** Folded columns now use semantic sizing with a 406px fixed total and no 860px floor; a real-shell browser oracle covers nested-scroll fit, maximum facts, STATE visibility, LTR/RTL, and focus across the six/seven-column transition.

- [x] **[BUG-079][P3][Creative Studio] The Table's LENGTH cell states two facts where the design states one** — found 2026-08-21
  - Built: every row reads `14s actual` over `No target` on two lines. The drawing reads `14s` on one, and `~24s target` only for the uncovered Beat that has no actual length.
  - So a Beat with real coverage carries a second line saying it has no target, which is noise on every populated row, and the row grows to two lines to say it.
  - The designer's ruling for the fold is explicit that the row keeps **one height class**. A permanent second line in LENGTH works against that on every row that has shots.
  - **Fixed by `8a56d1d67`.** LENGTH now renders exactly one coverage-authoritative fact: rounded actual duration for a Beat with Shots, otherwise its target duration or the matching pending state.

- [x] **[BUG-080][P2][Creative Studio] Board Beat titles are brand orange at 17px where the drawing has near-black at 13px** — found 2026-08-21 against a seeded project
  - Measured side by side. Drawing: `Manrope 600, 13px, #14181F`. Build: `Manrope 700, 17px, #F05A22`.
  - So the title is 1.3× the drawn size and rendered in the brand accent. Brand colour on a heading reads as an action, and every card carries one, so the Board's dominant signal becomes nine orange strings rather than nine pictures.
  - Same class as BUG-069, which fixed the workspace title and the view chips but not the Board card. Worth a sweep for other components still on the old scale rather than another single fix.
  - **Fixed by `8c2aaad54`.** Board Beat titles now render as neutral Manrope 600 at 13px in #14181F across rest, hover, focus, and active states, with a separate whole-card focus ring.

- [x] **[BUG-081][P2][Creative Studio] Every Board card carries five controls the drawing has none of, including a destructive one** — found 2026-08-21 against a seeded project
  - The drawn card is `01 · Cold open · action · look · 2 shots · 14s · READY` and **no buttons at all**. The built card exposes five: the title itself as a button, a drag handle, move-earlier, move-later, and **Lift Beat** styled as destructive.
  - Nine cards therefore show forty-five controls, with a destructive action permanently on the face of each. The drawing's Board is for looking — "picking takes is looking", in the designer's words for why the rail collapses there — and a wall of controls works against exactly that.
  - Reordering and lifting are real capabilities and are not in question. Where they surface is: the drawing puts none of them on the resting card.
  - **Fixed by `8c2aaad54`.** Each resting Board card now exposes one neutral whole-card Open target and no reorder or destructive chrome; the selected card alone reveals a bounded action group that preserves exact reorder, Lift confirmation/refusal, announcements, and focus-to-Bin behavior.

- [x] **[BUG-082][P1][Creative Studio] A generation quote refuses as `invalid_payload` and discards the reason the service already computed** — found 2026-08-21 trying to price one shot
  - `prepareSubmission` refuses every choice on a seeded project — both `seed_still` and `video_take`, identically — with `{ code: 'invalid_payload', messageKey: 'conversation.creativeStudio.errors.invalidPayload' }`. No generation can be priced, so none can be confirmed, so **nothing can be generated at all**.
  - **The payload is not invalid.** Validated against the real wire schema in the running app — `nativeBridgePayloadSchemas['creative-studio.prepare-submission'].safeParse(...)` returns `success: true`. The name of the error is wrong as well as unhelpful.
  - **The service knows exactly why and throws it away.** `rethrowPricingFailure` in `v2Service.ts` ends `throw invalid(\`Invalid Studio submission: ${error.code}\`)`, so the precise `StudioPricingErrorCodeV2`— one of`invalid_quote`, `inactive_shot`, `in_flight`, `duplicate_shot_purpose`, `invalid_dependency`, `invalid_prepare_request`, `invalid_reference`, `missing_conditioning`, `unsafe_total` — is in the thrown message and never reaches the renderer. Nothing is written to the dev log either.
  - So the one path in the product that spends money is also the one that cannot be diagnosed from outside the main process. An engineer with the running app, the bridge, and the source cannot determine which of nine conditions refused a quote.
  - Setup, for whoever picks this up: `bytedance/seedance-2.0` and `google/gemini-3-pro-image` are bound, both project routes are set by `choiceId`, the project holds nine Beats and sixteen Shots, no Takes exist, and every Beat reads `SEED PENDING`. `missing_conditioning` is the plausible code for `video_take` and does not explain `seed_still` failing the same way.
  - Third instance of one pattern today, after BUG-062 and BUG-077: a failure the code has already classified is delivered to the caller as a generic string. Worth treating as one systemic fix rather than three.

  **Diagnosed 2026-08-21 by temporary instrumentation, since it cannot be diagnosed any other way.** It took three separate log lines in main to learn one answer, which is the measure of the defect:
  1. Logging `error.message` in `toCommandError` gave `Invalid Studio submission: invalid_prepare_request` — the code the renderer never sees.
  2. Logging `error.stack` there was useless: `invalid()` constructs a fresh error, so the stack starts at the rethrow and the twenty possible origins are all still in play.
  3. Logging the _original_ error's stack inside `rethrowPricingFailure` finally named the thrower — `validateExactCascade`.
  - **The cause, once visible, is an API contract nothing states.** `prepareSubmission` requires the caller to pre-compute `cascadeChoices` and supply them in the exact order the service derives, and refuses the whole request if the arrays differ by length or order. A `seed_still` on a shot implies a `video_take` **on that same shot** plus every downstream shot to the next hard cut. Sending `cascadeChoices: []` — the obvious reading of "just price one still" — is invalid. Supplying the derived pair moved the request past validation on the first try.
  - So the caller must reimplement `deriveExpectedCascadePairs` to call the API at all, and gets one unnamed error if the reimplementation drifts. That is worth fixing alongside the message: either derive the cascade server-side, or return the expected set with the refusal.

  **Fixed 2026-08-21.** An empty cascade list on an ordinary prepare request now asks main to derive the canonical same-shot/downstream continuation with one generation per row; the canonical request is what pricing and the quote cache retain for confirmation. Reference handoffs remain seed-only, and a nonempty cascade list is still an exact customization that fails closed if incomplete, reordered, or otherwise noncanonical. Pricing failures now cross the service and IPC boundary only as `pricing_refused` plus one of nine allowlisted reasons. The spend gate retains that reason and maps it exhaustively to localized copy, while unknown classifications and attached provider diagnostics remain redacted behind the generic safe failure.

- [x] **[BUG-083][~~P1~~][Creative Studio] ~~Generation routes vanish after a restart~~ — WITHDRAWN 2026-08-21, this was not a product defect**
  - `listConnections` reports both media models bound and **validated**, with capabilities: `google/gemini-3-pro-image` at `2026-08-20T22:51:18Z` and `bytedance/seedance-2.0` at `2026-08-20T23:04:54Z`.
  - `listRoutes` for the same project returns **no options at all** — empty image and video route objects — and `prepareSubmission` fails with `provider_error` thrown from `listGenerationRoutes`, immediately after a successful `GET /api/providers`.
  - Earlier in the same session the same call returned one image option and one video option with full constraints, and the route `choiceId`s it produced were stored on the project. After restarting the app those ids no longer resolve, so a stored route cannot survive the process that created it.
  - With no routes there is no rate card, so nothing can be priced and nothing can be generated. This sits underneath BUG-082: even with the payload contract satisfied, generation is unreachable.
  - **A project's routes were cleared while establishing this.** Re-setting from a fresh `listRoutes` wrote nulls, because the fresh listing was empty. Anything that re-binds routes from a listing needs to refuse an empty one rather than persist the absence.

  **Withdrawn. The cause was an orphaned backend process of my own making, not the product.**
  `aioncore` survives `SIGTERM` — repeated restarts left a detached backend holding the HTTP ports, so
  each new app instance failed every `listProviders()` fetch and therefore produced no routes. The
  symptom was real and reproducible; the cause was the environment.
  - What proved it: after `kill -9` on every survivor and a start with exactly one `aioncore` process,
    `listRoutes` returns `routesOk: true` with options, `/api/providers` succeeds five times, and a
    quote prices normally. The earlier "clean start" was not clean — pid 41457 had survived the
    `SIGTERM` I believed had stopped it, and I checked the app processes without rechecking the
    backend.
  - **Worth keeping as an operational note rather than a bug:** stopping a dev instance requires
    `kill -9` on `bundled-aioncore`, and a surviving backend is invisible from the app's own logs — it
    presents as unexplained fetch failures inside main while the renderer looks healthy.
  - **One real defect stays visible underneath it**, already covered by BUG-082's pattern: the failure
    surfaced as `provider_error` with the cause discarded by `catch { throw new
CreativeStudioServiceError('provider_error'); }`. A single logged line would have shown
    `TypeError: fetch failed` immediately and saved the whole investigation.

- [x] **[BUG-084][P2][Creative Studio] Generated durations are floats and leak six decimal places into the UI** — found 2026-08-21, the first time real media existed
  - A `bytedance/seedance-2.0` take came back at **15.069002** seconds, not 15. Every surface that renders a duration with `{{seconds}}` therefore prints the float verbatim. On the Cut alone: the header chip reads **`178.069002s film`**, the Store Beat reads **`15.069002 actual`**, and the delta pill reads **`160.069002S OVER`**.
  - Seeded projects use whole seconds, so nothing showed this until a provider returned a real one. Every screenshot before today's generation was of integer data.
  - **The delta pill is mine.** `buildCutFilmSummary` returns `seconds: targetSeconds - filmSeconds` unrounded and `cut.film.over` renders it raw. `formatCutClock` rounds; the delta does not. The drawing reads `2s UNDER`.
  - Fix direction: round at the formatting boundary rather than at each call site. `cut.filmDuration`, `cut.actualDuration`, `cut.targetDuration` and `cut.film.under`/`over` all interpolate a raw number today.
  - Fixed 2026-08-21: generated-duration facts in Table, Board, Cut, Coverage and Take cards now use the i18n number formatter with zero fraction digits and no digit grouping. The projection and film-summary model retain provider precision for clocks, proportional layout and export authority; only the displayed fact is rounded.

- [x] **[BUG-085][P3][Creative Studio] The Cut's counts are unconditionally plural — "1 SLATES"** — found 2026-08-21
  - The film panel renders `9 BEATS · 16 SHOTS · 1 SLATES`. The drawing reads `1 SLATE`.
  - `cut.film.counts` is one string with three interpolations and no plural forms, so no count can ever agree. `cut.shotCount` in the same file does it correctly with `_one`/`_other`, so the pattern is established and this simply does not follow it.
  - Mine, from the app-bar work.
  - Fixed 2026-08-21: Beat, Shot and Slate counts are pluralized independently, then interpolated into the existing film-level ordering template so punctuation, order and bidirectional isolation remain translation-owned. Because this workspace copy currently falls back to en-US, its source-language one/other category is resolved before translation instead of applying the active locale's plural rules to English words.

- [x] **[BUG-086][P2][Creative Studio] The Cut's Beat rail is a row of tall cards, not the drawn filmstrip** — found 2026-08-21 with a populated project
  - Built: nine boxed cards roughly 100px wide and 480px tall, each carrying a drag handle and two move buttons, with titles wrapping mid-word — `Roadma p`, `Sign- off`.
  - Drawn: a single 64px-tall strip of segments proportional to Beat length, each showing a state-coloured number, the title, and the duration, with no controls on the segment.
  - The proportional sizing landed — all nine segments carry their flex-grow — but the segment itself is still the pre-existing reorder card, so the proportionality makes the cards narrow rather than making a filmstrip. Height and chrome are what remain.
  - Related to BUG-081 on the Board: the same reorder controls are on every card in both views, and the drawing has them on neither.
  - Fixed 2026-08-21: Cut now renders one flat 64px proportional filmstrip with state-coloured positions, single-line responsive titles and rounded localized durations. Selecting a segment exposes one external Move earlier/later pair, preserving exact canonical reorder, locking, drag, announcement and focus behavior without resting controls on every segment.

- [x] **[BUG-087][P2][Creative Studio] A trim handle renders on top of the Shot's duration label and splits the text** — found 2026-08-21 in the Beat panel, with a real Take
  - The label `15.069002s source` occupies x=317–460. The slider labelled **`Trim in for Shot 1`** — 18px wide, 138px tall — sits at x=349–367, **inside that span**, so the text reads as `15.0` ⎸ `002s source` with a black bar through it.
  - All 18px of the handle — its full width — lie inside the label's 143px span. Probed with an element filter corrected to the handle's real width; an earlier filter of `<= 6px` reported no overlap at all, which was the probe being wrong, not the panel being right.
  - The handle is not mispositioned: `aria-valuenow` is 1, and one second of a fifteen-second track lands about where it is drawn. The fault is that the duration label and the trim track are laid out in the same space, so any non-zero trim-in crosses the text.
  - It only appears once a Shot has a real source duration to label, which is why seeded data never showed it.
  - The drawing keeps the label inside the segment's top-left and the handles at its edges, where they cannot meet.
  - Fixed 2026-08-21: source/planning copy and continuity warnings occupy dedicated grid rows above a normal-flow 34px trim lane. The trim handles retain their exact percentage, keyboard, pointer, RTL and ARIA authority inside that lane, so a non-zero trim can no longer cross the label.

- [x] **[BUG-088][P2][Creative Studio] The Beat panel is a stacked form modal where the drawing is a full-bleed editor** — found 2026-08-21
  - At discovery, the build was a centred modal of stacked fields — Action, Look, Beat target, Save/Reset/Ask Director, then Shot cards with Line, Narration, On-screen text, Planned duration, hard-cut checkbox, and generation count.
  - The drawing called for a full-bleed editor with the Action and Look side by side under labelled rules (`ACTION · THE ONE THING YOU WRITE`, `LOOK · EVERY SHOT INHERITS IT` with a live `11 / 25 WORDS` counter), a large preview with a transport (`0:00 / 0:14`, `JOIN ◂`, `LOOP OFF`, `JOIN ▸`), a Shot pane stating provenance (`DERIVED FROM THE ACTION`, `WRITTEN FROM THE ACTION · EDIT TO DETACH`, `HEAD OF THE CHAIN · STARTS FROM THE STILL`), a Takes row, and a coverage strip of the Beat's Shots with keyboard hints — `EDGE · TRIM · FREE`, `BOUNDARY · COSTS A RE-RENDER`, `SPACE · PLAY`.
  - **Much of it is already built, and should not be rebuilt.** Probed in the live panel: a `<video>`, a poster `<img>`, two trim sliders, 22 buttons, a Takes row, a provenance line (`derived from`), and a word counter — worded `9 words · 25-word guidance only` rather than the drawing's `11 / 25 WORDS`, but present and live. This is a presentation gap, not a missing feature set.
  - Verified absent, by text probe of the open panel: any transport (no `0:00 / 0:14` clock, no `LOOP`, no `JOIN`, no play control), the cost hint `BOUNDARY · COSTS A RE-RENDER`, the keyboard hints (`SPACE`, `EDGE`, `BOUNDARY`), and the proportional coverage strip. The Shot provenance is partial — `derived from` is there, `HEAD OF THE CHAIN` and `EDIT TO DETACH` are not.
  - Action and Look are **stacked**, at y=240 and y=358, where the drawing sets them side by side under their two labelled rules.
  - The cost hint is the one absence that is not cosmetic: `BOUNDARY · COSTS A RE-RENDER` is the drawing telling a user which drag spends money, and nothing in the built panel says so. A user dragging a boundary today has no way to know it bills.
  - **Bounded cost-disclosure slice fixed 2026-08-22; BUG-088 remains open for the full-bleed editor and transport redesign.** The coverage editor now keeps `EDGE · TRIM · FREE` and `BOUNDARY · COSTS A RE-RENDER` visible beside the lanes, and every trim or boundary slider is described by the matching stable guidance. Existing pointer, keyboard, focus, and RTL mechanics are unchanged.
  - **Bounded authoring-band slice fixed 2026-08-22; BUG-088 remains open for the preview and transport redesign.** The Beat panel retains the frozen reference's 852px shell — “full-bleed” describes the editor composition inside that shell, not a viewport-wide modal. Within it, Action and Look now form the drawn 1.25:1 band under localized rule labels, with the live soft `N / 25 WORDS` counter. The build-only Beat target and editor actions sit in a separate row; at 760px and below, the same semantic and focus order stacks Action → Look → target → actions, including RTL. Draft, CAS, locking, coverage, generation and Take behavior are unchanged. The large preview, transport, and remaining provenance treatment are not part of this slice, so BUG-088 must not be closed.
  - **Bounded Shot-provenance slice fixed 2026-08-22; BUG-088 remains open for the preview and transport redesign.** Each Shot now separates chain state from the authored hard-cut control: a natural or authored head states that it starts from its still, while every continuation names the preceding Shot position. The Line field states whether editing will detach it from the Action, and the existing derivation readout uses the drawing's derived/detached language. Detected continuity staleness stays in the alert row, and the contained hard-cut control remains read-only pending BUG-095's paid gate. No draft, mutation, generation or persistence behavior changed.
  - **Bounded preview-and-transport slice fixed 2026-08-22.** The retained 852px editor gained one Beat-scoped, picture-only preview and clock. It resolves the exact selected video Take and trim for each Shot, uses a truthful planning slate only when that Shot has no selected Take, and fails the whole preview closed on ambiguous media authority. The free 18px seek rail is fused to the source-width Coverage lane with trim-aware piecewise mapping; Shot joins land 1.5s early, loop exactly ±2s, and the scoped Space/arrows/brackets/`L` shortcuts never intercept fields, sliders, or buttons. Seek decoding holds the canonical poster, media errors do not skip, and Beat/project/revision changes reset rather than auto-resume. Existing authoring, CAS, coverage mutation, generation, Take, and BUG-095 hard-cut containment behavior is unchanged.
  - **Completed 2026-08-23.** The Beat panel now uses a 1100px shell, a fixed 404px preview beside one flexible selected-Shot inspector on wide screens, and full-width 88px Coverage below. Coverage selection is non-mutating and inactive Shot cards remain mounted but hidden. Each segment renders localized, fail-closed state from exact current-wave jobs, passes provider progress through unchanged, and shows verified empty/on-disk/gone boundary markers. Stale Takes remain playable while only the affected boundary turns red. The Shot prompt guidance now sits in the header, Line is two rows, and the Takes summary plus three Shot controls share the wide action row. `NEXT UP`, `UNTOUCHED`, `SHOT xx · KEPT`, and `RENDERING · SHOWING THE STILL` are deliberately not emitted because current authority cannot prove them.

- [x] **[BUG-089][P1][Creative Studio] The composer asks what you want to make, then never tells the Director** — found 2026-08-21 by the owner, traced through the code
  - Type an intent into "What do you want to make?", press **Create project**, and you land on the Table with an **empty Director conversation and 0 beats / 0 shots**. The sentence you just wrote has to be typed a second time, into the rail, before anything happens.
  - The text is not discarded. `Composer.tsx:38` submits it as **both** `name` (sliced to 256 chars) and `brief`, and it is persisted on the project.
  - It simply never reaches the Director. The rail creates the conversation with `extra: { studio_project_id, workspace: '', custom_workspace: false, selected_mcp_server_ids: [], selected_session_mcp_servers: [descriptor] }` — no opening turn, and no preset context carrying the brief. See `DirectorRail/index.tsx:571-580`.
  - The Director _could_ find it: `read_storyboard` returns `brief: project.brief` (`studioServer.ts:860`). Nothing gives it a reason to call that on a project it has never been addressed about.
  - So the one question the product asks a new user is answered into a field the assistant cannot see, and the empty rail reads as the Director being broken rather than un-briefed. This is the first screen of the product and the first thing a pilot user will do.
  - Fixing it is a choice, not a mechanic, and the owner should make it: **(a)** send the brief as the conversation's opening user turn, so the Director answers immediately and the transcript shows why; **(b)** inject it as preset context, so it is present but silent and the Director still needs prompting; or **(c)** leave the rail empty and make the Table's empty state say what to do next. (a) matches what a user typing into a composer expects, and is the only one that makes the button's promise true.
  - **Owner chose (a). Fixed 2026-08-21.** The brief is seeded as the conversation's opening turn through the runtime's own first-turn channel — the one the Guid page uses when a chat starts from typed text — so the reply streams normally and the turn is visible in the transcript rather than hidden in a system prompt. Seeded only on a create this call actually made: a recovered claimant has already been briefed, and re-seeding it would repeat the brief and spend a second Director turn on every recovery.
  - The same change adds standing rules to the Director, at the owner's direction, telling it to ask before it builds rather than storyboard from one sentence.
  - **Verified live**, not just in tests: a new project seeded `A 20 second film about a courier who delivers a package to the wrong door`, the runtime cleared the seed key and set its processed marker, the Director read the project, and answered with three questions — who it is for, whether the wrong door plays as comedy or suspense, and what is in the package — instead of building. It also noticed the brief says 20 seconds while the project target is 18.

- [x] **[BUG-090][P2][Creative Studio] A new project's first Director action stops at a permission prompt** — found 2026-08-21 while verifying BUG-089 live
  - With the opening turn now sent, the Director's first move is `read_storyboard`, and the rail immediately shows **"I'd like to run a command · MCP aionui-creative-studio/read_storyboard · Yes, allow once / Yes, allow always / No (esc)"**. The turn sits unanswered until someone clicks; observed blocked for over three minutes.
  - So the first thing a new user sees, on the first screen, is a consent dialog for a **read-only** tool on a **built-in** server they did not install.
  - This is not caused by the opening turn — it is uncovered by it. Before, the Director never acted unprompted on a fresh project, so nobody reached the prompt this early.
  - **What is not established:** whether `aionui-creative-studio` is supposed to be in AionCore's `AUTO_APPROVE_MCP_SERVERS`. `builtinCapabilities.ts:224` documents that list as matching on the bare server name and selecting AllowAlways without prompting, and reserves every built-in name — but it reserves them for two stated reasons, and being reserved does not prove being auto-approved. The running AionCore prompts. Either the list does not contain the Studio server, or the dev binary lags the pinned version. **Check against the pinned AionCore before treating either as the cause.**
  - Worth separating from the fix: if reads were auto-approved, the whole first exchange would be silent and immediate, which is what the design implies.
  - **Root cause and unsafe shortcut ruled out 2026-08-22.** The Director is an Aionrs conversation, so AionCore's ACP-only `AUTO_APPROVE_MCP_SERVERS` is not on this path. Aionrs groups every MCP call under one `mcp` permission category, making “always allow” authorize mutating Studio tools too. Automating “allow once” in the renderer is also unsafe: the pinned confirmation endpoint resolves by `call_id`, does not atomically compare the expected message, server, tool and turn, and can accept a stale response after the pending call changes. Renderer-side server-name reservation is not an authority boundary because direct MCP registry writes bypass it. This rules out a text- or name-matched auto-click; if the accepted prompt is ever reopened, a robust silent path belongs in an identity-bound backend permission contract.
  - **Investigated 2026-08-22, and there is no lever in this repo.** `ISessionMcpServer` is only `id | name | transport`, so a descriptor cannot carry approval. `ICreateConversationParams` has no permission field — `permission` exists solely on `assistant.conversation_overrides`, and the Director is created without an assistant. The desktop writes no aioncore config. "Allow always" is a `confirm_key` answer that aioncore persists on its own side, with nothing here to pre-seed.
  - The 0.1.55 binary does expose `tools.auto_approve` and `tools.allow_list` under `ToolsConfig`, plus a `PermissionConfig` with `allow` and `deny`. So approval **is** configurable — just not from the desktop. None of the built-in server names appear as literals in the binary, so a hardcoded `AUTO_APPROVE_MCP_SERVERS` containing the Studio server does not exist in this build.
  - **Closed 2026-08-22 as accepted, not fixed.** The owner's call: one click per project on a read-only tool is a security prompt doing its job, and the alternatives all cost more than they save. Pre-answering it from the rail would grant consent on the user's behalf, and the underlying mechanism keys on the bare server **name** — which a user can claim by importing a server under it, so such an allowlist would not really be Studio-scoped. Giving the Director an assistant record would work through a supported path but drags in model, skill and MCP override semantics that would then need pinning.
  - Reopen if pilot users trip on it. The correct fix, when it is worth making, is in the AionCore fork's tools config, not here.

- [x] **[BUG-097][P1][Creative Studio] Auto-provisioning binds a video route the provider cannot serve, and the film stops dead at the video wave** — found 2026-08-22 in the end-to-end run
  - The run got all the way to real media: 3 Beats, 3 Shots, 0:12, three seed stills generated for $0.09. The second wave — the video takes — fails with **"The estimate could not be prepared or confirmed."**
  - Brief & rules then reads **Image route: `choice_000290ca…` Unavailable** and **Video route: (blank) Unavailable**. The image route worked minutes earlier for the stills.
  - The provider carries exactly three models — `openai/gpt-5.6-terra`, `~openai/gpt-mini-latest`, `google/gemini-3-pro-image`. **None of them is a video model.** A video route was bound anyway.
  - This is a defect in the connection provisioning I added for Slice 1a. `saveConnection` only runs after `validateConnection` returns ok, so either the probe passed for a model that cannot serve video, or the route was live at bind time and has since gone unavailable with nothing re-checking it. Both readings need the same remedy: a bound route must be re-validated before it is priced, or its loss must be reported as itself rather than as a failed estimate.
  - **Fixing the message is not enough.** `createConfiguredStudioRateCardV2` builds entries only for routes present in the catalogue snapshot, so a vanished route yields a pricing failure with no route named — an instance of BUG-093's class, one layer up.
  - Severity is P1 because it is terminal for the MVP: a user gets a script, pays for stills, and can never reach a film.
  - **Diagnosed and fixed 2026-08-22, and the first reading of it was wrong.** Pressing the Brief's own _Refresh routes_ turned `Image route: Unavailable` into **`OpenRouter · google/gemini-3-pro-image` — Ready**, and `Video route` into **Selection required**. So no route was ever bound badly. Two separate faults were wearing one symptom.
  - **Fault one: the shared catalogue went stale.** Provisioning re-read routes for its own binding but never refreshed the workspace's catalogue, so every bound choice id resolved to nothing and `selectionIssue` fell through to `retired` — rendering a working route as `Unavailable`. That also explains BUG-096: the raw `choice_…` id is simply what shows when a route cannot be resolved. It now calls `refetchRoutes` after provisioning.
  - **Fault two: partial success was silent.** The provider carries no video model, so provisioning satisfied image and failed video and said nothing. The user learned at the gate, as "the estimate could not be prepared", with no route named. It now reports the existing `videoRouteBlocked` message — _"Choose a ready video route before reviewing video generation. Seed-only work remains available."_ — which is exactly true and was already translated.
  - What is still true and not a defect: this provider genuinely cannot serve video, so this film cannot finish here. That is a setup fact the user can now see and act on, rather than a dead end at the gate.

- [x] **[BUG-098][P2][Creative Studio] A failed estimate names neither the route nor the reason** — found 2026-08-22 alongside BUG-097
  - The gate says only "The estimate could not be prepared or confirmed. Nothing was retried automatically." Nothing in the renderer console, nothing naming the route, no hint that a binding went unavailable.
  - The information exists: the Brief modal shows `Unavailable` against both routes at the same moment. The gate simply does not say it.
  - Minimum useful behaviour: when a quote fails because a bound route is missing or unavailable, say which route and offer the Brief's picker, rather than reporting a generic estimate failure.
  - **Fixed 2026-08-22.** A failed estimate now performs one read-only, project-scoped route-catalogue check. If a route required by the immutable estimate draft is not ready, the gate names the image route, video route, or both instead of showing the generic failure. It offers a direct **Brief & rules** action, opens the real route pickers, and refreshes their catalogue. If the diagnostic read itself fails, the original estimate failure remains fail-closed and nothing is retried or submitted automatically.

- [x] **[BUG-099][P1][Creative Studio] Connection provisioning never offers a video model, though twenty-one are available** — found 2026-08-22 completing the end-to-end run
  - Driving Settings → Add media model by hand, with Output type **Video** and Integration **OpenRouter video**, offers **21 models** on the same provider — `bytedance/seedance-2.0`, `google/veo-3.1`, `kwaivgi/kling-v3.0-pro`, `openai/sora-2-pro` and more. `bytedance/seedance-2.0` validated first time: _"Connection validated."_
  - So the models were reachable all along. The Slice 1a provisioning bound image and silently skipped video, and BUG-097 only made that visible — it did not make it work.
  - **Likely cause, not yet proven.** `planStudioConnections` joins a candidate group to an integration by `integrationLabelKey`. Video models come from a live `/videos/models` fetch rather than the provider's `models` list, so if `listConnectionCandidates` has not resolved that catalogue at the moment provisioning runs, there is no video group to plan against and the planner correctly produces nothing. That would make it a timing defect, not a logic one — worth confirming before fixing, because the two need different remedies.
  - Until it is fixed, a first-run user still needs one visit to Settings to bind a video model, which is the cliff Slice 1a existed to remove.
  - **Root-caused and fixed 2026-08-22, and the guessed cause was wrong.** There is no timing race: `listConnectionCandidates` awaits `refreshOpenRouterCatalog` before it builds anything. The fault is the shape of what it returns.
  - A candidate carries **two** model sources. `integrationModels` holds exactly one group — `openRouterVideo` — and every other integration draws from the candidate's own `models`. The Settings editor gets this right at `StudioMediaModelsSection.tsx:289`: `integrationModels?.models ?? (usesClosedCandidateModelSet ? [] : selectedCandidate.models)`.
  - `planStudioConnections` read **only** `integrationModels`. So it planned nothing for image — there is no image group to find — and nothing for video whenever that group came back empty. It was not "video was skipped": **provisioning planned neither kind**, and the image route that appeared to work was a binding left over from earlier in the session.
  - The planner now mirrors the editor: a group when the integration has one, the provider's models otherwise, and never a fallback for a closed integration whose own catalogue is authoritative. `CLOSED_CANDIDATE_MODEL_LABEL_KEYS` is now defined once and imported by both, because the two disagreeing is exactly how this happened.

- [x] **[BUG-100][P1][Creative Studio] A failed video render is displayed as still rendering, forever** — found 2026-08-22 attempting to finish the film
  - Confirmed **3 video takes on `bytedance/seedance-2.0`, $0.60**, 4 seconds each. All three Shots went to `Rendering` immediately and were **still `Rendering` 35 minutes later**. The Board states _"This item has generation work in progress. This item belongs to a generation request that is still active."_
  - **Nothing is happening.** `lsof` sampled every 5 seconds for 3 minutes — **0 of 36 samples** showed a single outbound TCP connection from Electron or aioncore. Every connection is to localhost. An earlier 40-second sample found the same.
  - **The subsystem logs nothing.** Zero lines in the dev log match studio jobs, the job manager, or submission — the log's last entry is Director traffic from 38 minutes earlier. There is no dispatch record, no poll record, no failure, and no timeout.
  - **The control rules out the pipeline as a whole**: the seed-still wave on this same project, same session, completed in about 45 seconds. Image generation works. This is specific to the video path.
  - So the money is committed and the film cannot finish, and nothing anywhere says why. Whether the request ever reached the provider is unknown from the outside, which is the first thing the fix has to make knowable.
  - Sibling of BUG-098 one stage later: that one is a quote that fails without naming a reason, this is a job that never resolves without naming one. A generation subsystem that spends money needs a dispatch log, a poll log, and a timeout that fails loudly.
  - **Root-caused and fixed 2026-08-22, and the title above was wrong.** Reading the persisted record settled it. The jobs did **not** stall — all three reached `needs_attention` and carried real errors: `shot_release` had `providerJobId=tpJGBDz8i1nfOj1tox6E` with `error.code = 'provider_unavailable'`, `shot_ripples` and `shot_drift` had no provider id and `error.code = 'submission_unknown'`. `updatedAt` was 07:03, nine minutes after `createdAt`. The render was over long before I started sampling; the absence of network traffic was the consequence, not the cause.
  - **The defect is that `needs_attention` was counted as work in flight.** `workspaceProjection.ts` listed it among `waiting_for_conditioning`, `queued_local`, `submitting`, `queued_remote` and `running`, so a Beat whose render had failed rendered as `Rendering` indefinitely. `needs_attention` appeared exactly once in the whole renderer — in that set — and there was no display state for it.
  - Fixed by splitting the predicate in two. `GENERATION_IN_FLIGHT_STATUSES` drives the display and excludes `needs_attention`; `GENERATION_BLOCKING_STATUSES` includes it and still stops a fresh submission, because such a job may already have been charged — which is why the record carries `duplicateChargeAcknowledged`. A `needs_attention` Beat state now exists and outranks `rendering`.
  - The app already had everything needed to say this: `providerUnavailable`, `submissionUnknown`, a retry flow and a duplicate-charge dialog, all translated. Only the projection was hiding it.
  - **Still open, and worth its own entry: the generation subsystem logs nothing.** No dispatch, poll, failure or timeout line exists anywhere. The only way to learn that three paid jobs had failed was to read `project.json` off disk.

- [x] **[BUG-101][P1][Creative Studio] The generation subsystem cannot be observed: zero log statements in the whole path** — found 2026-08-22, verified directly
  - `grep -cE 'console\.(log|warn|error|info|debug)'` returns **0** for both `jobManager.ts` and `v2Service.ts`. Between them these own dispatch, polling, provider calls, failure handling and every paid operation in Studio.
  - The consequence is not theoretical. Three paid jobs failed with `provider_unavailable` and `submission_unknown`, and the only way to discover that was reading `project.json` off disk. Nothing in the log, the console, or the UI said a provider had rejected anything.
  - A subsystem that spends money needs, at minimum: a dispatch line carrying the job id and provider job id, a line when a poll observes a terminal state, and a line for every error already modelled in `jobs.errors.*`. Those message keys exist and are translated into twelve locales; nothing writes them anywhere durable.
  - **Fixed 2026-08-22.** `console.*` in the main process is redirected into electron-log by `configureConsoleLog.ts`, so a plain prefixed line is already durable and already reaches the log a user sends with feedback. No new logging machinery was needed — only the lines.
  - Instrumented at chokepoints rather than scattered: `transitionFailureV2` and `transitionRemoteFailureV2` cover **every** failure path between them, plus the submit boundary and the wave-abort that leaves a job mid-`submitting` with no provider id. Each logs only when the transition actually took, because a refused mutate returns the job unchanged and a line for that would report a failure that never happened.
  - `formatStudioJobLog` is the single door. It drops absent fields rather than printing `null`, strips newlines so one value cannot forge a second plausible log line, and caps every value at 80 characters. The cap is a backstop, not a licence: the job record carries `requestSnapshot` and `requestPlan` holding full prompts, and the provider record carries a plaintext API key, so callers pass ids and codes only.
  - Audited what is now written: `jobId`, `projectId`, `providerJobId`, `purpose`, `kind`, `model`, `code`, and one fixed note. No credential, prompt or snapshot reaches the log.

- [x] **[BUG-102][P2][Creative Studio] Nothing retries a job that misses its dispatch: there is no run loop** — found 2026-08-22 by a parallel review, then verified directly
  - `jobManager.ts` contains no scheduler. Its only timer is `defaultSleep` at line 191, a backoff helper inside a poll, not a tick. `dispatchAuthorizedJobsV2` has exactly three call sites, all in `v2Service.ts` (1769, 2506, 2562), and every one is externally triggered.
  - So a job leaves `queued_local` only if something calls dispatch while it is there. A job that misses that call has nothing in the system that will ever pick it up again — it simply waits, and until BUG-100 was fixed it waited while displaying as `Rendering`.
  - **Original review hypothesis:** dispatch preparation is all-or-nothing, so one job failing preparation can abort the whole wave and leave its siblings in `queued_local` unmarked; and the video path runs a media-resolution step the seed-still path never runs, whose raw failure marks no job before aborting. Both would explain a partly-dispatched wave — two of my three jobs had no `providerJobId` at all.
  - **Fixed 2026-08-22.** Both suspected misses are now reproduced. A route-catalog failure on the second generation aborts the all-or-nothing preparation wave after leaving the first sibling in `queued_local`; a raw conditioning-media resolution exception aborts a video wave with every sibling still queued. Neither path calls the provider before preparation is complete.
  - The active backend-ready Studio runtime now owns one serialized five-second scan. It re-runs the existing durable recovery logic for the current supported project inventory, waits for each scan before scheduling the next, keeps the runtime active after a scan error, and aborts its wait during graph teardown. There is no renderer timer and no in-memory retry record.
  - `resumePendingJobsV2` now clears its single-flight promise after each scan instead of caching the first completed scan forever. Existing durable status, provider-job identity, controller and execution-reservation checks remain the duplicate-submission boundary: an active or already-remote job is polled or skipped, never blindly submitted again.
  - The swallowed dispatch error is now reported too: `v2Service.ts` discarded every failure with `.catch((): undefined => undefined)`. It still swallows, because a failed dispatch must not break the caller, but it says so first — with the error's **name**, never its message, since only `StudioJobManagerError` has a bounded one.

- [x] **[BUG-103][P1][Creative Studio] A failed render is unrecoverable: retry and cancel are built but reach no UI** — found 2026-08-22 by trying to render the failed shots again
  - The three video jobs from BUG-100 sit in `needs_attention`. Opening the Beat panel and pressing **Review video generation** opens the gate, and preparing the estimate refuses with: **"One selected generation is already in progress. Wait for it to finish or change the selection."**
  - It will never finish. `hasInFlightItem` (`pricing/estimate.ts:746-753`) tests `NONTERMINAL_STATUSES`, which contains `needs_attention`, so pricing raises `in_flight` and the shot cannot be re-quoted. The message asks the user to wait for a job that ended forty minutes earlier.
  - **The recovery exists and is simply not wired.** `cancelJob` and `retryJob` are on the service interface (`v2Service.ts:295-296`, implemented at `:2601`), backed by `cancelJobV2` / `retryJobV2` in the job manager (`jobManager.ts:109-110`). Neither appears on the renderer bridge, and neither is called anywhere under `pages/studio`. The job record even carries `duplicateChargeAcknowledged` for the confirmation this flow was meant to have, and `jobs.retry`, `jobs.retryConfirmationTitle` and `jobs.retryChargeTitle` are already translated into twelve locales.
  - So a shot whose render failed is permanently unrenderable, and the money spent on it is unrecoverable. There is no cancel, no retry, and no way to price a replacement.
  - Sequel to BUG-100, and the more serious half. That one made the failure _visible_; this one is why seeing it does not help. The fix is to expose what is already built, not to build it.
  - Note the blocking itself is defensible for `provider_unavailable`, where a remote job may still land — one of the three carried `providerJobId=tpJGBDz8i1nfOj1tox6E`. What is missing is the acknowledged escape, not the guard.
  - **Fixed 2026-08-22.** The native manifest and main bridge now expose strict `cancel-job` and `retry-job` commands, preserve bounded job-manager failures, and keep provider-job identity in main. Renderer project DTOs carry only exact `canCancel` / `canRetry` capabilities; the workspace projects only owned `needs_attention` jobs, and the Beat panel disables the dead-end Review action while showing the job error plus the permitted recovery controls.
  - Same-provider retry reclaims and polls the existing durable provider job without submitting or charging again. Multiple failed generation siblings can be reclaimed independently instead of falsely blocking one another as `busy`. A provider-cancellable job can be cancelled explicitly. An unknown submission with no provider id requires the existing duplicate-charge acknowledgement; that action only terminalizes the uncertain record and unlocks a fresh reviewed estimate — replacement work still cannot cross the quote/confirm spend gate.

- [x] **[BUG-104][P1][Creative Studio] A chain could not advance past its first Shot: the continuity frame was decoded through a non-seekable pipe** — found and fixed 2026-08-22
  - **Symptom.** One Beat, three Shots, cascade authorized at $0.63. The seed still succeeded and `shot_dawn_light` produced a real 1.3MB MP4. The two downstream Shots then sat at `waiting_for_conditioning` with the revision frozen and nothing in flight, and the only affordance left was **Cancel waiting item**.
  - **Root cause.** `runLocalDecode` hands ffmpeg the already-opened, identity-verified source as inherited descriptor 3 — deliberately, so ffmpeg reads exactly the bytes the caller hashed rather than whatever the path resolves to at open time. But it named that descriptor **`pipe:3`**, and ffmpeg's pipe protocol is unconditionally non-seekable. An MP4 whose `moov` atom follows its `mdat` needs a seek back to the sample data once the header is parsed; through a pipe that seek fails and the demuxer reports a partial file.
  - **The provider returns exactly that layout.** Atoms in the take the app produced: `ftyp, uuid, free, mdat, moov`. The real invocation exits **183** with `stream 0, offset 0x54dc: partial file`. Remuxed with `+faststart`, the identical command through the identical pipe succeeds.
  - **What it was not.** The stored `durationSeconds` (4.062993) exceeds the real media duration (4.042) by one AAC frame, so "we seek past the end" was the obvious theory. It is wrong: an endpoint two seconds _inside_ the video fails identically. The endpoint never mattered. The duration skew is real but harmless here — `trim=end=` beyond the last frame simply trims nothing — and is left alone.
  - **Fix.** `-fd 3 -i fd:` keeps the exact verified descriptor and allows the seek. It produces a byte-identical PNG to decoding the same file by seekable path. Passing the path instead would have been the smaller diff and the wrong one: the post-decode hash only proves our own descriptor's bytes, so a path would let ffmpeg read a file we never verified.
  - **Two things this exposed and did not fix.**
    1. **The failure was completely silent.** Zero lines in the dev log — `runLocalDecode` spawns with stderr `ignore` and `-loglevel error`, so ffmpeg's diagnosis is discarded. Diagnosing this needed disk forensics on `project.json`. BUG-101 instrumented submissions; frame extraction is the same gap, unclosed.
    2. **A failed extraction is a permanent dead end.** `advanceStudioWaitingBindingsV2` `continue`s past a `failed` extraction without re-queueing it, so nothing retries automatically and the run loop cannot help. That is correct for a genuinely undecodable file, but it meant one universal property of provider output stalled every chain with no path forward but Cancel.
  - **My first filing of this entry blamed Codex's run loop for not resuming the takes.** It resumes jobs, not extractions, and there was nothing to resume: the extraction had failed terminally. The run loop was never involved.
- [x] **[BUG-105][P2][Creative Studio] A continuity-frame failure was swallowed at both call sites, so the chain stalled with nothing in any log** — filed and fixed 2026-08-22 out of BUG-104
  - Two identical bare catches discarded the extraction error: `jobManager.ts` (_"The durable failed extraction remains visible to the explicit provider-free retry action"_) and `v2Service.ts` (_"The durable failed extraction and waiting jobs are the recoverable result"_). Both comments were true — the failure **is** durable and retryable — but neither wrote a line.
  - Underneath, `runLocalDecode` spawned ffmpeg with stderr `ignore`, so the decoder's own diagnosis was discarded before it could reach the catch. For BUG-104 that discarded text was `stream 0, offset 0x54dc: partial file` — the whole answer, thrown away. BUG-104 was diagnosed instead by reading `project.json` off disk and re-running ffmpeg by hand.
  - **Fix, both halves.** `StudioConditioningFrameError` now carries an optional `detail`; `runLocalDecode` pipes stderr, accumulates it under a 512-character cap, and attaches it to the failure it raises. `logStudioConditioningFrameFailure` writes `[CreativeStudio] conditioning_frame_failed projectId=… extractionId=… code=… detail=…` and is called from both catches.
  - The cap is load-bearing in two directions: it keeps one failure to one line, and the handler keeps draining past it, because an unread stderr pipe would eventually block the decoder itself.
  - **Verified:** the adapter carries and bounds the diagnosis, and the log line's shape — including a failure with no diagnosis and a non-`Error` throw — are covered by tests. The two call sites themselves are wired and read-verified but **not** covered by a call-site test: reaching them needs a two-item authorization fixture with a selected upstream take, which costs more than it proves for three wired lines. Worth adding if that fixture ever exists for another reason.
- [x] **[BUG-106][P1][Creative Studio] A finished film refused to play and would not say why** — found and fixed 2026-08-22 while verifying Slice 4
  - With all three Shots rendered and on disk, the Cut showed a disabled **Play film** and the sentence **"No film preview is available."** Nothing else. There was no way to learn what was missing, and no way to act from that screen.
  - **What was missing:** the last Shot's Take had never been chosen. Choosing a Take is what releases the next Shot's conditioning, so every earlier Shot gets chosen on the way through the chain — and the last Shot has nothing downstream to ask for it. Every film ends on a Shot nobody is prompted about.
  - `buildCutPlaybackSequence` refuses the whole sequence from about thirty different guards and returns a bare `null`, so the Cut had one sentence for all of them. Exactly one of those refusals is a normal state a director can act on; the rest are projection faults, where "choose a Take" would send someone looking for a button that cannot help.
  - **Fix:** `cutPlaybackShotsAwaitingTake` reports only Shots that have Takes but no chosen one. The Cut names it — _"Beat 1 · Shot 3 needs a Take chosen before the film can play."_ — or counts them when there is more than one, and keeps the old sentence for everything else. Verified live: the message named Shot 3, and naming was reversible through the Cut's own Undo.
  - **Deliberately not auto-selected.** Selecting the sole Take automatically would have removed the click entirely, and would also have released downstream generation without the take choice the cascade explicitly promised to wait for — spending authorized money on the user's behalf at a gate that says _"Waits for your take choice."_ Naming the missing choice costs one click and keeps that promise.
- [x] **[BUG-107][P1][Creative Studio] Cast and Look references were fully built and completely unreachable** — found and fixed 2026-08-22 while taking Slice 5
  - Everything existed except a way in. `creative-studio.choose-and-import-reference` and `detach-brief-reference` are implemented in main, registered in `creativeStudioBridge.ts`, present in the native payload schemas and the IPC constants. The Beat panel already renders a per-Shot reference picker. The `briefReferences` copy — _Project references_, Cast and Look headings, empty states, the six-reference limit, engine-capacity warnings — is authored and translated in **all twelve locales**.
  - **Nothing in the renderer called any of it.** Zero callers for either IPC; zero references to the `briefReferences` copy. `briefReferenceOptions` is derived from assets carrying `briefReferenceRole`, and the only thing that can set that role is the import nobody could reach — so the Beat panel's picker was permanently empty and no project could ever hold a reference.
  - **Fix:** `ProjectReferences`, rendered in the Brief & rules drawer. Add and remove per role, the project limit mirrored from `STUDIO_MAX_ACTIVE_BRIEF_REFERENCES` rather than reinvented, the bound engine's `maxConditioningImages` reported, and a cancelled file dialog treated as a decision rather than a failure.
  - **How a subject actually reaches a film:** a `video_take` request may not carry a Brief reference — `createStudioGenerationRequestTemplate` throws if it does. Only a `seed_still` can. So one Cast reference on a chain's head Shot propagates the subject through every Shot in that chain by conditioning, which is why the picker is per-Shot but the reference is per-project.
  - **Caught by an existing test, not by me:** the first wiring read `bound?.constraints.maxConditioningImages`, which guards the route but not its `constraints` — a field the catalogue can omit. Absent capacity is now unknown rather than zero, because zero would wrongly claim the engine refuses references outright.
  - **Not yet demonstrated:** Slice 5's acceptance is _two Shots in one Beat visibly sharing a subject_. The panel is live and its import reaches the real file dialog — verified in the running app, where clicking Add left the promise pending and both buttons correctly disabled — but choosing a file needs a native dialog that cannot be driven from here, so the generated half of the round trip is still unproven.
- [x] **[BUG-108][P2][Creative Studio] The Studio coverage gate is red, and nothing runs it** — measured 2026-08-22
  - `bun run test:coverage:creative-studio` enforces per-file thresholds of 80% lines and 80% branches over a reviewed manifest of executable Studio files. It fails on three:
    - `StudioPage.tsx` — branches **77.31%**
    - `Views/WorkspaceControls.tsx` — lines **66.66%**
    - `common/adapter/native/payloadSchemas.ts` — branches **76.66%**
  - **Nothing invokes it.** Not `just push`, which runs lint → format → typecheck → i18n → test; not any workflow in `.github/workflows/`. It exists only as a package script someone has to remember. That is why it has been red without anyone finding out.
  - **Whose it is, measured rather than assumed.** All three fail identically at `36f434918`, early on 2026-08-22 immediately after the inherited red branch was repaired, and again at `4029e54f7` before the Cut/Beat playback work landed. So it is inherited debt: neither the playback editors nor the MVP slices introduced it.
  - One honest exception: `StudioPage.tsx` branches drifted **78.31% → 77.31%** across the day's work. Already failing, made a point worse.
  - The two things worth deciding are separate. Whether to raise coverage on those three files is ordinary work. Whether a gate nobody runs should exist at all is the real question — an unrun gate is worse than no gate, because the manifest comment tells every later task to maintain a list whose failures nobody sees.
  - **Fixed 2026-08-23 without lowering or excluding anything.** Behavior tests now cover app-bar Render and canonical-rule adoption, exact Shot-lift/project-switch/Undo authority, and native bin/trim/diagnostic boundaries. The three former deficits are now `StudioPage.tsx` **81.15% branches (465/573)**, `WorkspaceControls.tsx` **88.88% lines (40/45)**, and `payloadSchemas.ts` **86.66% branches (52/60)**.
  - `just push` now replaces its redundant bare-suite dependency with the named Creative Studio coverage gate, and the blocking sprint3 workflow runs that same one full-suite invocation. BUG-030's teardown quarantine explicitly refuses Vitest coverage-threshold diagnostics, so a threshold failure cannot be mistaken for a post-green teardown.
  - **Verified by the exact gate:** exit 0; 652 files passed / 3 skipped; 9,414 tests passed / 24 skipped; aggregate reviewed-manifest coverage **91.13% lines / 84.54% branches**, with every file at or above 80%. One synchronous TypeScript contract compiler pass crossed the generic 10-second budget only under instrumented-suite contention (1.03s isolated), so that test alone now has a documented finite 30-second timeout; its workload and assertions are unchanged.
- [x] **[BUG-109][P1][Creative Studio] Video generation is globally serialised at one, so the drawn film-scale parallelism cannot happen** — measured 2026-08-22 while reviewing the chain handoff
  - `jobManager.ts:455` holds `semaphores = { image: new FifoSemaphore(2), video: new FifoSemaphore(1) }`. A per-project cap of two paid jobs in flight sits beside it (`jobManager.ts:95`), and **both** must be acquired before a submission. The job manager is a single app-wide instance held by the runtime's active graph, so the video semaphore is global — **one video generation at a time across every beat, every project, the whole application.**
  - The chain storyboard's film-scale panel draws four chains running side by side and asserts _"WORST CASE IS THE LONGEST CHAIN · NOT 11 GENERATIONS ADDED UP."_ Under this scheduler the worst case is exactly eleven generations added up. The handoff's own note that "nine chains is not nine simultaneous provider calls" is right in spirit and understates it: nine chains is one call.
  - **Measured, not estimated:** a video takes about two and a half minutes of provider time — 2.2, 2.9 and 2.6 minutes across the three takes of the 2026-08-22 film. Eleven generations serialised is therefore roughly half an hour, against the eight or so minutes the Beats would take side by side. An earlier revision of this entry claimed thirty-two minutes per video and five hours per film; that figure came from the gap between two moments someone happened to look, not from the provider, and is withdrawn.
  - The bookkeeping is not wrong — chains genuinely are Beat-scoped and the dependency line is real. What is wrong is that Beats being the unit of parallelism buys nothing in throughput while the global video cap is one.
  - **The question to answer before anyone estimates that panel:** is `FifoSemaphore(1)` a deliberate cost or provider-rate-limit guard, or a default nobody has revisited? If deliberate, the drawing must reflect it and the film-scale promise has to change. If not, this is the single highest-leverage number in the product.
  - Reviewed in full at [chain handoff review](../../design/creative-studio-3-chain-handoff-review.md).
  - **Fixed 2026-08-23** by naming both caps and raising video to 2, and **verified live the same day**: six Beats of a two-minute film rendered their seed stills in about seventy seconds side by side, where the old cap would have walked them single-file. The entry stayed open after the code landed; closing it now.

- [x] **[BUG-110][P1][Creative Studio] A definitive HTTP 400 is reported as an ambiguous submission, so the user is asked to risk a duplicate charge for a request that certainly never ran** — measured 2026-08-23
  - `mapStatusError` in `openRouterVideoAdapter.ts` handles 401/403 as `auth`, 429 as `rate_limited` and 5xx as `provider_unavailable`, then falls through: **every 4xx becomes `unknown`**. `jobManager.ts:1107` turns an `unknown` submit failure into `needs_attention` with code `submission_unknown`.
  - A 400 is the provider stating plainly that it rejected the request. It is the _least_ ambiguous outcome there is, and it is the one the product describes as unknown.
  - **What that costs the user.** The Shot lands in `needs_attention`, the only way forward is **Retry generation → Acknowledge and review estimate**, and that acknowledgement exists to accept the risk of paying twice. For a 400 there is no such risk. Observed live: two full retry cycles, both 400, both presented as possibly-submitted.
  - It also makes a permanent failure look transient. A 400 will fail identically every time, so the honest response is to stop and say why, not to offer a retry that cannot succeed.
  - Fix: map 4xx other than 429/401/403 to a definitive rejection code. `invalid_request` already exists in `StudioJobErrorCode` and is exactly this case.
  - **The billing invariant held throughout, which is the reassuring half.** Two $0.60 authorizations were confirmed and **nothing was billed** — the single spend receipt in the project is the seed still. That matches the proof behind BUG-109: the one site that writes a receipt fires on the transition into `running`, and a 400 never gets there.

  - **Fixed 2026-08-23**: 402 maps to `quota` and every other 4xx to `invalid_request`, both added to the adapters' sanitized union. Proven necessary the same day — a 402 stating "Insufficient credits" and a 400 naming a content-policy refusal were both being reported as outcomes the product could not determine. The entry stayed open after the code landed; closing it now.

- [x] **[BUG-111][P2][Creative Studio] A blocked run stated no reason, because provider tags were filtered by a fixed allowlist** — filed and fixed 2026-08-23
  - A character-brief run stopped twice on an HTTP 400 whose evidence read `errorCode: '400'`, `errorType: null`, `providerCode: null`, `messagePresent: true`. Nothing said why, and two retries were spent on a rejection that would never succeed.
  - **The fix I first proposed was wrong, and the existing test is what showed it.** `openRouterVideoAdapter.test.ts` feeds the provider message a prompt, an API key, a URL and a base64 data URI, then asserts none of it reaches the log. The redaction is deliberate and load-bearing: the provider echoes request material into `error.message`, so a bounded excerpt would have reintroduced a real leak. No length cap makes free text safe.
  - **What was actually lost was the tags, not the message.** `error.code`, `metadata.error_type` and `metadata.provider_code` are enum-like identifiers, and they were being dropped by membership in a fixed `SAFE_HTTP_ERROR_TAGS` set. A provider that emits a tag nobody enumerated therefore explains nothing.
  - **Fix:** gate on identifier _shape_ — `^[a-z][a-z0-9_]{0,39}$` — instead of a fixed list. No spaces, no punctuation, no scheme, so a prompt, URL, key or base64 payload cannot pass, while an unrecognised provider tag can. The allowlist is removed rather than left as dead code, and `error.message` stays fully redacted.
  - Tests pin both directions: an identifier-shaped tag nobody enumerated is surfaced, and a tag carrying free text, a URL or a data URI is still dropped. The original leak test is untouched and still passes.
- [x] **[BUG-112][P1][Creative Studio] Video generation is refused for any first frame that may contain a real person** — root cause measured 2026-08-23
  - The provider's own words, obtained by replaying the app's byte-exact payload once credits were healthy:
    `InputImageSensitiveContentDetected.PrivacyInformation` — _"The request failed because the input image 'content[1]' may contain real person."_
  - **`bytedance/seedance-2.0` rejects a first frame it believes depicts a real person.** That single fact explains every observation, including the one that nagged all day: the lake film rendered because it was dawn light on water with nobody in it; the harbour film has a woman in a red raincoat in every Shot and was refused five times.
  - **Four hypotheses were refuted by experiment before the truth arrived**, and each refutation prevented a wrong fix:
    1. _Seed encoding_ — a 94,585-byte JPEG failed identically to the 1.4MB PNG. The fix it implied was a transcode inside `resolveProviderInputV2`, a byte-integrity-checked path.
    2. _Prompt length_ — 600 characters failed identically to 1028.
    3. _The key's $50 cap_ — that cap belonged to a different key on a different account.
    4. _Account exhaustion_ — real, but a **separate and coincidental** condition affecting only the post-midnight curl replays. Swapping to a funded key ($976 available) produced the same 400, which is what finally proved the two were unrelated.
  - **Why it took five attempts to read one sentence.** OpenRouter forwards this upstream rejection by stringifying the origin provider's entire error object _inside_ `error.message`, leaving `metadata` empty — so `error_type` and `provider_code` were both genuinely absent, and the adapter redacts `message` because the provider echoes request material into it. The code that names the cause was inside the redacted field the whole time.
  - **Fixed here:** the evidence extractor now lifts the nested upstream `code` (`upstreamCode`) and the identifier gate admits dotted PascalCase, while the prose beside it — which names the request id and could name the prompt — still cannot travel. A rejection of this kind now names itself in the log on the first attempt.
  - **The product consequence is larger than this run and needs a decision.** Cast references exist to hold a _person_ consistent across Shots. If the bound video model refuses person-bearing first frames, then the cast half of Slice 5 cannot work on `seedance-2.0` at all — no matter how well the reference round trip is wired. Worth confirming against the model's documented policy, and worth knowing which allowlisted video models permit human subjects before promising cast consistency to pilot users.
- [x] **[BUG-113][P2][Creative Studio] A refused submission left the Shot with no way forward** — found and fixed 2026-08-23
  - Shot 3 of the bicycle film failed with `provider_unavailable` — a 5xx, unbilled, and by nature the failure most likely to succeed on a second attempt. The Shot sat in `needs_attention`, the coverage bar said so, and **nothing offered a retry**: no control in the Beat panel, every `Review video generation` in the spend gate disabled behind the same non-terminal job, and only Lift Shot or Lift Beat visible — both destructive.
  - **Cause.** `canRetryJobV2` required `providerJobId !== null` or `submission_unknown`. A submit the provider refused outright leaves neither, so the seam excluded exactly the case where retrying is safest: no provider job exists, none was created, and a retry cannot duplicate anything.
  - **Fix.** Retry is now also offered when the provider answered before taking the work — `provider_unavailable`, `rate_limited`, `quota`, `invalid_request`, `auth` — while `spendReceipt` is still null.
  - **Closed prematurely, and reopened the same day.** The first fix widened only `canRetryJobV2`, the predicate that decides whether to _offer_ retry. The executor still handled exactly two shapes — an unknown submission, or a `needs_attention` job with a provider job to reclaim — and fell through to `invalid_request` for anything else. So the button appeared and the click failed with _"The request contains invalid or incomplete information."_ **A button that promises a way forward and does not deliver one is worse than an honest dead end**, and only driving the real film found it.
  - The executor now terminalizes a refused submission the same way it terminalizes an unknown one — marking it `failed` so the gate can re-plan — but without demanding the duplicate-charge acknowledgement, because nothing was submitted and nothing can be billed twice.
  - **Deliberately excluded:** `submission_unknown` and `timeout`. Both are genuinely ambiguous — the request may have landed — so they keep the acknowledgement of duplicate-charge risk rather than gaining a quiet retry. The distinction the fix draws is refused-versus-unknown, not failed-versus-succeeded.
- [x] **[BUG-114][P1][Creative Studio] The film-wide Render refused any film longer than about 96 seconds** — found and fixed 2026-08-23 on the first two-minute film
  - An eight-Beat, thirty-Shot film could not be rendered at all. Pressing **Render…** produced only _"This exact selection cannot form a bounded generation graph. Keep the uncovered alternative or change the selection."_ — true, and unactionable.
  - **Cause.** `STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST` (24) caps **distinct Shot ids across the whole selection**, but `filmRenderBatchShotIds` counted only the _segment heads_ it named. Choosing a head commits its entire cascade to the end of its Beat, so eight heads silently dragged in all thirty Shots, blew the cap, and `selectionGateDraft` then refused the batch as unpayable.
  - The batch builder and the draft builder disagreed about what a selection costs. The builder said eight; the gate saw thirty.
  - **Why it survived until now.** Every earlier test film was a single Beat of three Shots, where heads and cascade coverage are close enough that the difference never shows. The bound only bites past 24 Shots — roughly **96 seconds** at four seconds a Shot — so the feature was broken for exactly the films worth making.
  - **Fix.** The batch now accumulates each segment's cascade coverage and stops before the cap, so it renders as much of the film as fits rather than refusing the whole thing. Verified live: the same film that produced no gate at all now opens at **23 shots selected**, quoting **29 generations · $4.78**, with the remaining two Beats left for a second pass.
  - A pre-existing test had encoded the old assumption — that a cap of one admits `shot_1`. It does not: choosing `shot_1` commits `shot_2` with it, so a cap of one admits no segment. That expectation is corrected rather than worked around, and a new property test pins the invariant that was actually violated: **whatever the batch returns must be a batch the spend gate accepts.**
- [x] **[BUG-115][P1][Creative Studio] Making a two-minute film costs about thirty manual interactions, and nothing batches** — measured 2026-08-23; closed 2026-08-26
  - The first film long enough to measure: 8 Beats, 30 Shots, 120 seconds. Reaching 20 rendered videos took **one Render, one estimate, one confirm, six Beat-panel opens with a seed choice each, roughly twenty take-choices, and several continuity-frame retries** — each one a modal open, a click, and a wait.
  - The cost is **linear in Shots** and there is no batch affordance anywhere: no "accept all takes in this Beat", no "keep going until something needs me". A twelve-second film needs three interactions and the design reads as careful; a two-minute film needs thirty and it reads as a grind.
  - **The gate is not wrong.** _"Waits for your take choice"_ is the promise that stops authorized money being spent ahead of a human, and it held all day — including through four provider failures. The problem is that the promise was sized for a film with three choices in it.
  - A pilot user asked to make two minutes today would not finish. Nothing is broken; the interaction budget simply runs out before the film does.
  - Worth deciding as design rather than patching: whether a Beat can be pre-authorised to advance its own chain unattended once its first take is chosen, which would take a 30-interaction film to about 8 without weakening the gate at a Beat boundary.
  - **Partial progress, 2026-08-23:** the implemented [one-Shot, one-picture model](../../design/creative-studio-3-take-removal.md) removes Take selection and generation-count decisions entirely, eliminating the largest measured source of manual interactions. BUG-115 remains open because film-wide batching, unattended Beat progression, and the remaining seed/recovery decisions are not yet closed by that model change.
  - **Closure audit, 2026-08-26:** the remaining pieces are now present in the schema-5 authority. Render builds the largest legal film-order batch, counts full cascades against the 24-Shot cap, and skips completed or in-flight segments. A confirmed quote freezes every downstream item in each selected Beat segment. Once the one human seed decision fixes that segment's first frame, the single canonical video output is selected by construction; Main extracts the trim-aware predecessor frame and advances the next quoted job without another take or spend decision. A later interaction is required only at the next independent seed, beyond the bounded request cap, or for explicit recovery from a real failure. This is the earlier proposed roughly one-interaction-per-Beat model, without weakening quote authority or silently substituting an unquoted frame.
  - **Regression evidence:** `filmRenderBatchShotIds` tests pin legal packing, completed-segment skipping, and gate acceptance; the lifecycle test _"advances an authorized Beat chain unattended after its one human seed decision"_ pins automatic seed → first picture → trim-aware predecessor-frame → next Shot dispatch under one authorization.
- [x] **[BUG-116][P1][Creative Studio] A partly-rendered film re-offered its finished Beats and could never reach the unfinished ones** — found and fixed 2026-08-23
  - With six of eight Beats rendered, pressing **Render…** selected **all 23 already-completed Shots** — `shot_gutter_01` through `shot_downriver_04`, every one succeeded — quoted **$4.60**, and **excluded Harbour Passage and Open Sea entirely**, the only two Beats that still needed rendering. Confirming would have paid twice for finished work and still left the film unfinished.
  - **Cause, and it was in the BUG-114 fix.** That change made the batch pack segments in film order until the cascade-expanded Shot cap. It never asked whether a segment needed anything, so the six finished Beats filled all 24 places and the two empty Beats behind them never got in.
  - So the two defects compound: before BUG-114 a long film could not be rendered at all; after it, a _partly-rendered_ long film re-charged its finished half forever.
  - **Fix.** A segment whose every Shot already has a Take is skipped, so "render the film" means render what is missing. The cap then falls to the Beats that need it.
  - **A second pass was needed, found the same way.** Skipping covered _segments_ still left the batch starting each incomplete segment at its **head** — so a Beat missing only its last Shot re-rendered the head and dragged the whole chain along. Measured live: the gate then chose `shot_drain_01` and `shot_stream_01`, both already rendered, when what was missing was `drain_04` and `stream_03/04`. The batch now starts at the first Shot still lacking a Take, whose upstream frame already exists.
  - **Caught only by driving a real film to a partly-rendered state.** Every prior test rendered from empty, where finished-versus-unfinished cannot differ, and the spend gate's own arithmetic was correct throughout — $4.60 was the true price of what it had selected. Nothing was wrong except _what_ it selected, which no amount of checking the total would reveal.
- [x] **[BUG-117][P1][Creative Studio] The Beat panel goes blind for the whole duration of a render, because three non-atomic reads are compared for exact equality** — diagnosed 2026-08-23
  - Mid-render, every Shot in the panel reads `STATUS UNAVAILABLE`, **Review video generation** is disabled, and three separate lines say the same thing: _"Current lift eligibility is unavailable"_, _"Save or reset every generation-affecting edit and refresh the current workspace before reviewing generation."_, _"Refresh the revision-matched workspace and chain status before reviewing a cost."_ Nothing the user can do clears it. It resolves only when the render stops.
  - **Cause.** `deriveWorkspaceShotSegmentState` returns `status_pending` whenever `statusReady` is false, and `statusReady` is all four status facts being valid at once. They cease to be valid together, because all four derive from snapshots nulled by a single check — `snapshot.projectRevision === project.revision`. **Exact** equality.
  - Those values arrive through **three independent IPC reads**. On each `projectUpdated`, `useStudioProject` fires `Promise.all([loadProject, loadWorkspace])`; `loadProject` is one round trip and `loadWorkspace` is two more under `Promise.allSettled`. Three reads of a store the render loop is actively mutating, then compared for exact agreement.
  - **The drift is one-directional.** `loadProject` pins the project revision monotonically — `current.revision > loaded.project.revision ? current : loaded.project` — while the status snapshots get no such pin. The project ratchets forward; the status can only lag behind it.
  - **There is no retry pressure.** The only refetch trigger is the next `projectUpdated`, which starts another three-way race that loses the same way. Agreement arrives only when the project goes quiet.
  - **Consequence.** The panel can describe a render only once there is nothing left to watch. The drawn coverage states that exist for precisely this moment — `RENDERING · 40%`, `WAITING ON THE FRAME`, the live per-Shot percentage — all require `statusReady`, so in practice they are close to unreachable.
  - **Historical pre–one-picture evidence.** During the finishing pass on the paper-boat film, the then-current `Select Take` affordance blinked in and out of existence: roughly half of about twenty scripted passes found no affordance at all while Shots were still uncovered, because each selection bumped the revision and dropped the panel back to `status_pending`. The one-picture model later removed that Take-selection UI, but not the underlying read race.
  - **The guard is right; the cadence is wrong.** An unready projection genuinely cannot be reasoned about, and failing closed is correct. The fix is that the project and its status should be **one read**, so there is nothing left to disagree about.
  - **Historical evidence (before the one-picture copy change).** Same Beat, mid-render with twelve generations in flight: all four Shots `STATUS UNAVAILABLE`. Settled at revision 504 with no code change: all four read `Rendered · 1 Take`.
  - **Fixed by `9c8eca0c5`.** `creative-studio.get-project-workspace` now returns the renderer project and both status projections from one Store project-authority snapshot. Ready boundary files are verified through the non-reentrant authority media seam and the snapshot is revalidated before return. The renderer installs or rejects all three values together, retains the last complete bundle while a refresh is pending, coalesces each `projectUpdated` burst into one active read plus one trailing read, and permits one bounded retry before failing closed. Exact revision guards remain as defense in depth.
- [x] **[BUG-118][P1][Creative Studio] Every Shot boundary stalls for about a second, because the first touch of a clip costs a second and nothing is prefetched** — measured 2026-08-23
  - Playing a Beat, or the film in the Cut, the picture freezes at each Shot boundary. Reported as _"the move is so choppy when switching between Shots"_.
  - **Measured in the running app**, loading real clips through `weprompt-studio://`:

    |                           | first load | repeat   |
    | ------------------------- | ---------- | -------- |
    | video A (2.6 MB)          | **991 ms** | **3 ms** |
    | video A again             | —          | 16 ms    |
    | video B (2.6 MB)          | **982 ms** | —        |
    | seed still (880 kB image) | 0 ms       | 0 ms     |

  - **It is not protocol overhead and not transfer size.** An 880 kB image through the same handler resolves in 0 ms. The cost is per-video decoder setup, paid once per clip and fully cached afterward — `canplay` fires **1 ms** after `loadedmetadata`, so nothing is waiting on buffering either. `preload='auto'` measures the same as `preload='metadata'`; the setting is irrelevant to this cost.
  - **The arithmetic.** One second of dead air on a four-second Shot, at all 30 seams — roughly **30 seconds of stall in a 122-second film**. This is not a perception problem.
  - **Both players are affected identically.** `BeatPlayer.tsx:827` and `CutPlayer.tsx:932` carry the same `key={…${state.segmentIndex}…}` and the same `preload='metadata'`, and neither file contains any prefetch, double-buffer, or next-segment warm-up. One fix, applied twice.
  - The `key` containing `segmentIndex` forces a full remount at each seam, but that is **not** the culprit — changing `src` on a retained element pays the same first-touch cost. Removing the remount alone would not help.
  - **Fix: prefetch segment N+1 while N plays.** The cost is one second, a Shot lasts four, and a warm clip loads in 3 ms. The repeat measurement was taken on a **freshly created element**, which is exactly the prefetch case — so warming an inert, visually clipped media element for the next segment moves that setup work ahead of the seam.
  - **Falsifiable check, ten seconds:** play the same Beat twice without reloading. The second pass should be markedly smoother, every clip now being warm. If it is not, this diagnosis is wrong.
  - Worth noting this makes the "no stitched film file" decision more defensible than it appeared. The seam cost is a warm-up problem with a cheap fix, not an inherent cost of clip-by-clip playback.
  - **Fixed by `9c8eca0c5`.** Beat and Cut now maintain one inert, visually clipped `<video preload="auto">` for the first future video, armed only after authoritative current playback begins or an active planning-slate clock exists. It scans across intervening slates and remains stable through time updates, pause, and natural advancement. Seek, retarget, project/plan revision change, current-media failure, and unmount pause it, remove its source, and reload it; the prewarm node has no transport event authority.
  - **Verification boundary.** Focused DOM tests prove arming, cross-slate targeting, stable identity, cleanup, and transport isolation, and the full suite and Creative Studio coverage gate are green. The targeted Electron check was attempted twice but the local backend timed out before the Studio route, so no product assertion ran and this closure does not claim Electron E2E green or a new measured seam-latency number.

- [x] **[BUG-119][P1][Creative Studio] A single `.DS_Store` permanently kills every export in a project, and opening an export folder is what creates it** — found and root-caused 2026-08-23
  - Reported as _"Create a folder does not do anything"_, then _"actually, all three buttons do not do anything"_. All three export shapes fail together.
  - **Cause.** `reprovePhysicalArtifactLedgers` in `schema2/exports/catalog.ts` walks **every** artifact on **every** export operation and re-captures its physical directory tree: `capturePhysicalTreeProof(artifact.rootPath, artifact.treeProof.nodes)` compared with `samePhysicalTreeProof(...)`, failing `storage_error` on any difference. A `.DS_Store` written into an artifact directory changes that tree, so the proof fails and the whole catalog operation is refused.
  - **It is not confined to creating.** The re-prove runs on the read path too, so **Refresh exports** fails identically and the catalog can never even load. Once one artifact directory is contaminated, the entire Exports panel is dead for that project until someone removes the file by hand, and nothing in the product says so.
  - **The product creates the poison itself.** macOS Finder writes `.DS_Store` the moment a folder is opened — which is precisely what the **Reveal export** affordance invites a person to do. Using the feature as designed breaks it permanently.
  - **Measured.** With `.DS_Store` present in `exports/` and in `exports/export_ceed88ed…/`, every button raised _"Creative Studio could not update its local data."_ and the catalog stayed at revision 5 with 4 artifacts. Removing those files and repeating with no other change: no alert on refresh, no alert on create, and the catalog advanced to **revision 6 with 5 artifacts**. Nothing else was touched between the two runs.
  - **Two things made this read as "does nothing".** The alert is easy to miss where it renders; and it is **sticky** — the same `actionErrorMessageKey` persistence noted in BUG-117 — so a stale error from an earlier action sits on screen and a fresh failure looks like no change at all. The first diagnostic pass attributed a leftover `invalidPayload` alert to a click that had not produced it.
  - **A key collision cost time and is worth knowing.** `creativeStudio.errors.storage` reads _"Creative Studio could not update its local data."_ and comes from the **main process** as `result.error.messageKey`; `creativeStudio.workspace.errors.storage` reads _"Creative Studio could not read or save this workspace."_ and is set by the **renderer's** own catch. They are different failures with near-identical names. Trace the component, never guess the key.
  - **Fix direction.** Exact directory-tree equality is the wrong contract for a folder the operating system and the user both touch. Prove an artifact against the manifest of files the catalog actually recorded — the artifact already carries `manifestSha256` — and ignore OS sidecar files, rather than demanding that nothing in the directory ever changes.
  - **Fixed by `eabd524b3`.** The catalog now treats only an exact, unmanifested `.DS_Store` as unmanaged Finder metadata. It must still be a no-follow regular file with one link and remains part of the operation's transient identity proof, but it is excluded from payload manifests, copies, capacity, and managed-byte accounting. Refresh preserves it instead of quarantining it; reveal and subsequent export publication continue to work. Manifest-recorded `.DS_Store` payloads, arbitrary extra files, directories, FIFOs, symlinks, hard links, missing/modified payloads, and in-operation replacement still fail closed.
  - **Verification.** Real-filesystem regressions cover the exports root, artifact roots, nested folders, refresh/repair, reveal, create, copy, byte accounting, unsafe node types, and concurrent mutation. The focused export catalog is 79/79; the full repository suite is 9,499 passed with 24 expected skips; Creative Studio coverage is 91.02% lines and 84.49% branches. No live Electron product assertion was rerun for this main-only fix.

- [x] **[BUG-120][P1][Creative Studio] The Director asks for approval without showing the changes, and an approval typed in chat cannot act on the proposal** — found 2026-08-24 by the owner on `da7d8c47a`, reproduced on both the initial storyboard proposal and a later revision
  - **Actual, initial proposal.** After the owner asked for a two-minute cartoon and answered the Director's questions, the chat said _"All done — everything went through as planned"_ while a still-pending card below it asked the owner to approve **16 proposed edits**. The review body contained only `set_brief`, five repeated `add_beat` rows and repeated `add_shot` rows. It showed none of the brief, Beat titles, actions, Looks, target durations, Shot lines, narration, on-screen text or ordering that acceptance would write.
  - **Actual, later proposal.** A proposal based on revision 13 asked for approval of five edits and rendered five indistinguishable `edit_beat` rows. The owner could not tell which Beats would change, which fields would change, or the before/after values.
  - **The data is present; the review drops it.** `StudioMutationOperationV2` carries the complete reviewable payload for these operations — `set_brief.brief`, `add_beat.beat`, `edit_beat.changes`, `add_shot.shot` and the ordering anchors. `DirectorProposalCard.tsx` renders rich content only for `apply_coverage` and `rederive_line`; every other operation falls through to `<code>{operation.kind}</code>`. This is presentation loss, not missing Director output.
  - **Chat is visually available but has no approval authority.** Typing _"approve"_ sends another message to AionCLI. The only acceptance caller in the renderer is the card button in `StudioPage.tsx`, which invokes `creativeStudio.acceptProposal` with the exact `proposalId`; there is no Director tool or deterministic chat-intent route for accepting or rejecting a pending proposal. The model can say it is done, but it cannot make that statement true.
  - **Why P1.** This is the explicit human sign-off boundary for a whole atomic mutation batch, but the human is shown only internal verb names. It therefore fails in both directions: accepting is uninformed, while refusing to accept stalls a first-run project after the user already asked the Director to create it. The long repeated list and off-screen buttons add work without adding review information.
  - **Fix direction.** Render a bounded human summary from the existing typed payload: the proposed brief; Beat and Shot identity/order; authored fields; and before → after values for edits. Keep raw operation kinds under optional technical details. Then either remove the separate gate for free, reversible authoring and expose Undo, or let a deterministic _Approve/Apply it/Reject_ chat intent action the one exact current proposal through the same IPC path. Chat approval must fail closed when there is no pending proposal, more than one candidate, a stale base revision or dirty workspace drafts; the Director must never approve its own output.
  - **Boundary that must not move.** This bug concerns free storyboard mutations. The reviewed `prepare` → human `confirm` spend boundary for image/video generation remains explicit and separate.
  - **Fixed.** Proposal review now presents the bounded authored brief, Beat and Shot identities and order, all supplied authored fields, and exact before → after values. Impossible review transitions fail closed, while raw operation kinds remain secondary technical detail. Exact human composer phrases such as _Approve_, _Apply it_ and _Reject_ deterministically action the sole current proposal through its existing IPC authority; attachments and ordinary chat stay on the model path. No-pending, multiple, stale, dirty and already-busy states all fail closed, and this route cannot enter the paid generation gate.
  - **Verification.** A live Electron pass staged a three-reference Director proposal against a fresh schema-v5 project and verified the visible reference order, type, prompt, assigned Shot identities and exact acceptance path. That pass exposed and fixed one raw `title` locale key before acceptance; the focused proposal-card suite is 30/30. The aggregate Creative Studio gate is green: 654 files and 9,871 tests passed, with 87.58% statements, 84.71% branches and 91.10% lines and no per-file threshold failures.

- [x] **[BUG-121][P1][Creative Studio] Reference-image generation succeeds and charges, but the completed images have no visible result handoff** — found 2026-08-24 by the owner on `da7d8c47a` after generating three references for Ming and Mei
  - **Actual.** The Director said it had queued three reference-image requests and told the owner to approve them in Creative Studio. After confirmation, the handoff card changed to _“Confirmed and submitted”_ and exposed no action, link, thumbnail, progress or completion state. The Table remained at **0 of 10 panels drawn**, its thumbnail cells stayed blank, and the three affected Shots still read **first frame pending**. From the visible product, the images appeared not to exist.
  - **The paid work succeeded.** Project `b3927323_0636_4fff_a00d_b49138e04c0f` contains one confirmed **$0.09** authorization and three `succeeded` `seed_still` jobs. Their JPEG assets are downloaded and owned by `shot_homework_stool`, `shot_shared_smile` and `shot_closing`; all three jobs have spend receipts and no error. This is not a provider or generation failure.
  - **The result is hidden behind a different object model.** `DirectorProposals.tsx` renders **Review** only while a handoff is `open`; after confirmation it replaces all controls with one status string. The generated assets are seed-still candidates, which `BeatPanel/index.tsx` renders only inside the corresponding Beat editor. The Table thumbnail column instead renders `WorkspaceBoardPanelProjection` from `boardAssetId`, so it truthfully stays blank but gives no indication that a different kind of image just completed.
  - **Why P1.** This is a paid first-run workflow with no completion handoff. A user can approve and be charged for successful media, then reasonably conclude that nothing happened and repeat the request. The internal distinction between reference seed stills and Board panels is not communicated anywhere in the path that initiated the work.
  - **Workaround.** Open **Mother’s Rhythm**, **Ming Steps In** or **Homeward Under the Stars** from the Table, then inspect the per-Shot **Seed stills** strip. The images belong respectively to **Homework stool**, **Shared smile** and **Closing**.
  - **Owner-approved direction.** The fix is the project-level reference workflow in `creative-studio-3-direction-and-answers.md` §14: `Brief → References → Table → Board → Cut/Render`, with **REFERENCES** immediately before **TABLE**. Generate and approve one sheet per named character first, then approve recurring backgrounds, then condition Shot generation on those stable assets. Keep the spend confirmation explicit; while work runs, show queued/running/succeeded/failed counts; after completion, show thumbnails and **Review references**, which opens the exact cards. Reference assets never occupy Board-panel thumbnails, and a completed or partial handoff remains actionable after confirmation and reload.
  - **Fixed.** Schema v5 adds durable project references and exact reference provenance on quotes, jobs, generated assets and Shots. The workspace order is now **REFERENCES | TABLE | BOARD | CUT**: character sheets are generated and approved first, recurring backgrounds second, and **Continue to Table** unlocks only when the required approvals exist. Confirmed handoffs survive reload with queued/running/succeeded/failed counts, thumbnails, exact-card review/highlight, retry and recovery actions. Shot generation conditions on the exact approved character and background assets, records those asset ids, and stops for an explicit background choice when the match is missing or ambiguous. Reference outputs remain isolated from Table/Board thumbnails and Shot seed readiness; the paid prepare → confirm boundary is unchanged.
  - **Verification.** A live Electron pass accepted the reference plan into a fresh two-Beat, three-Shot project and landed automatically on **References**. It verified character-first ordering, locked backgrounds, a disabled **Continue to Table**, and the missing-image-route guard; the guarded action created no job and did not advance the project revision. Real-store regressions also cover shared proxy-Shot ownership, quote provenance, reload, cancelled retry, parked anchors and refusal before quote, authorization, dispatch or mutation. The same aggregate gate above passed with no per-file threshold failures.

- [x] **[BUG-122][P1][Creative Studio] A project cannot add a newly discovered background after approving its character references** — found 2026-08-25 in the owner-driven real-model run on `3ac63eb9f`
  - **Actual.** Mei and Ming had approved character sheets, while **Backgrounds** said _“No recurring backgrounds are required.”_ The owner then asked the Director for the recurring dai-pai-dong background. The Director produced a complete prompt but reported that Creative Studio had rejected the change and instructed the owner to add the reference in **References**. That view exposed no add-background action, so both the chat path and the UI recovery path ended at the same empty state.
  - **Durable evidence.** Project `a5502dee_3834_48a0_bfa7_bd2597546506` retains a revision-14 command receipt decided at 14:06 local with `reasonCode: "invalid_operation"`, immediately before the 14:08 screenshot of this failure; a second invalid operation was retained later at revision 26. The approved character assets remained intact. The run eventually reached three approved references only after agent intervention, so the provider and image route were not the blocker.
  - **Why P1.** A background can become necessary only after the Director and owner inspect the story or generated character sheets. Freezing the initial answer to “no backgrounds” makes the character-first workflow a dead end at the exact handoff where the product tells the user how to recover.
  - **Fix direction.** References needs one explicit **Add background** path, and the typed plan operation needs an append/amend form that preserves existing reference ids, approvals, hashes and Shot bindings. Main must continue enforcing character-first ordering and human-only approval; recovery must not reset approved characters or replace the plan wholesale.
  - **Fixed.** References now exposes **Add background**, and both renderer and Director paths submit the same typed, background-only `amend_reference_plan` operation. Main appends fresh app-owned reference ids to a planned catalog without rebuilding it, preserving every existing reference, approved asset and hash, approval, and Shot binding. Aggregate ordering, uniqueness, plan state and revision checks fail closed; approval remains renderer-only and background generation remains gated behind character approval.
  - **Verification.** Focused reducer, bridge, Director-contract, MCP `tools/list`, service and DOM regressions cover a first background after an empty background plan, exact preservation of character authority and Shot bindings, duplicate/stale/invalid rejection, and the shared typed operation. Typecheck, i18n validation, the 1,477-test focused aggregate, and the 9,919-test Creative Studio coverage aggregate pass with all configured coverage thresholds.

- [x] **[BUG-123][P1][Creative Studio] An imported first frame is labelled current, then Pin fails as a storage error while an authorized video waits** — found 2026-08-25 in the same real-model run on `3ac63eb9f`
  - **Actual.** Shot 2 had an authorized `video_take` waiting on its generated hard-cut seed. Importing Shot 1's exact 1280×720 final frame succeeded, attached the asset to Shot 2 and displayed it as **Current first frame**. Clicking **Pin as first frame** then showed _“Creative Studio could not update its local data.”_ Project revision stayed 69 and `seedStillId` stayed `null`.
  - **The refusal is correct; the presentation is not.** A waiting authorization freezes the exact upstream seed that was quoted. `set_seed_still` therefore rejects an imported replacement that was not produced by that authorization, and nonterminal work also blocks the mutation. Letting the Pin change silently rewrite paid conditioning would violate spend and provenance authority.
  - **Why P1.** The UI offers and labels an action it cannot accept, then calls an authorization/dependency conflict a storage failure. A user cannot discover the supported recovery: cancel the unsubmitted waiting item, review a rejoin quote, confirm it, and let the app extract the predecessor's trim-aware final frame.
  - **Observed recovery.** Cancelling Shot 2 changed its waiting job to `cancelled` and its downstream Shot 3 job to durable `dependency_failed`; completed media and authorization history remained. The reviewed **Rejoin · 2 required generations · $0.40** path then extracted Shot 1's endpoint, rendered Shot 2, extracted Shot 2's endpoint, and rendered Shot 3. Both continuity boundaries ended `ready`, with all three four-second videos playable in the Beat.
  - **Fix direction.** While a waiting authorization freezes the seed, incompatible imported candidates must not claim to be current or expose a working-looking Pin. Explain the authorization lock, identify the required recovery, and offer one bounded **Cancel and review rejoin** route. Do not weaken quote revalidation or permit an unquoted frame substitution.
  - **Fixed.** The workspace now projects an exact revision-matched seed authorization lock from the same-Shot cascade authority. Imported candidates outside that frozen asset set are retained but neither labelled current nor offered as pinnable; the UI explains that authorized work locked the seed. The one bounded **Cancel and review rejoin** action cancels the waiting cascade once, refetches its committed revision and terminal propagation, then opens a fresh unprepared rejoin review. Ordinary review paths and forged seed mutations fail closed while the lock exists.
  - **Verification.** Focused projection, DOM, renderer orchestration and real-store service regressions cover locked imports, compatible candidates, cancellation propagation, downstream dependency failure, fresh quote review, stale confirmation refusal, trim-aware predecessor-frame extraction, reload persistence, preserved media/authorization/provenance and cause-specific copy. Typecheck, i18n validation, the 607-test focused aggregate and Creative Studio coverage pass. The opted-in fake-adapter Ming/Mei/dai-pai-dong E2E passes through exact Board and video dispatch; its stale schema-5 no-op style setup was corrected along the way.

- [x] **[BUG-124][P2][Creative Studio] Director approvals are parked outside the conversation that asked for them** — found 2026-08-25 by the owner on `f94926d6d`; closed 2026-08-26
  - **Actual.** The Director generated the `Mei & Ming Cast` reference and reported success. The approval affordance for it — a **Reference generation handoff** card carrying counts, a thumbnail and a **Review references** button — rendered under a separate **Reviewed Director output** heading at the foot of the Director rail, not in the transcript where the Director had been speaking. The owner had just been told in chat that work was done, then had to find the decision somewhere else.
  - **Mechanism.** `DirectorRail/index.tsx:1259` renders `reviewedOutput` as a **sibling of the chat transcript**, in its own region inside the rail's `<aside>` rather than inside the message flow. `DirectorRail.module.css:134` gives that region `flex: none` and `max-block-size: 42%`, so it is a fixed second panel: it does not scroll with the conversation, it permanently consumes up to two-fifths of the rail, and it is spatially detached from the message that produced it.
  - **Why P2.** Nothing is broken and no work is lost — the approval can be completed. But the product's stated interaction model is that the Director asks and the workspace records the answer, and a decision parked in a different region breaks the asking half of that. It also scales badly: every future approval class (Plan, Produce, Select) lands in the same fixed panel, competing for the same 42%.
  - **Fix direction.** Render the handoff as a structured card **inline in the transcript**, positioned at the point in the conversation where the Director raised it, scrolling with the messages. This does not weaken the approval contract: the card remains a structured workspace action with its own recorded receipt, so a typed "yes" still approves nothing. Retire the separate `reviewedOutput` region rather than adding a second surface, and keep the rail's vertical space for the conversation.
  - **Fixed by `2b07cfa96`.** Studio projects every proposal, reference request, generation handoff and review error as a stable timestamped inline item. `MessageList` merges those items with messages and artifacts in chronological order inside the one scrolling transcript. The Director rail passes the items into its durable conversation owner and no longer renders the fixed reviewed-output sibling panel; its bounded recovery notice retains an inline fallback only while the conversation itself is unavailable.
  - **Authority and regression evidence.** The structured cards retain their existing exact action callbacks and receipts. Composer interception remains limited to the bounded free-authoring proposal phrases; `yes`, ordinary chat and attachments cannot action a proposal or enter the paid generation gate. Focused message-list, Director-rail, Studio-page and accessible-copy coverage verifies chronological placement, transcript containment, multiple independent outputs, collapse without remounting, the unavailable-conversation fallback and explicit controls. The focused aggregate is green: 4 files and 256 tests passed.

- [x] **[BUG-125][P2][Creative Studio] The Director's proposal renders as an unstyled field-by-field dump with internal ids in every heading** — found 2026-08-26 by the owner on `6a473f334`; closed 2026-08-26
  - **Actual.** The reviewed proposal for a four-Beat storyboard reads as a nested outline: a heading `Reordered · Project · The Keeper · b552858f_4b3e_4f1d_ab3c_d6f6f174cf93`, an `Order` field whose before/after are the raw ids `beat_ascent`, `beat_lens`, `beat_lamp`, `beat_gallery`, then one `Added · Beat 1 · The Ascent · beat_ascent` section per Beat, each dumping `Title` / `Story` / `Beat target` / `Placement` / `Order` with an `After ·` prefix on every row. The owner has to read a diff format to answer a creative question.
  - **This is presentation, not data.** The review payload is correct and main-derived; every complaint below is in the one component that renders it.
  - **Mechanism — the card has no styling at all.** `DirectorProposalCard/index.tsx` is 202 lines containing exactly **one** `className` (`flex gap-8px`, on the button row), and there is no CSS module anywhere in `components/Shell/`. Everything else is bare semantic HTML at browser defaults: `<ol><li><section><h3>` then `<dl><dt><dd>`, with `<ol>` nested again inside `<dd>` for list values. Two consequences are visible in the screenshot — the default `<h3>` is set larger and heavier than the card's own `Director proposal` title, so each change outranks the card that owns it; and four levels of default `<dd>`/`<ol>` indentation stair-step the content rightward until the values sit in the middle of the card.
  - **Mechanism — the id is printed unconditionally.** `index.tsx:41` renders `{subject.id}` outside any ternary, so the internal id is appended even when a human title is present. Every heading therefore ends in `· beat_ascent` or, for the project row, a 36-character underscored uuid. The id is a debugging aid; the title beside it is the answer to what changed.
  - **Mechanism — no summary exists, though the string for one does.** `proposals.mutationCount` (`{{count}} proposed edits`, with `_one`/`_other` plurals) is authored in `en-US` and appears in `i18n-keys.d.ts`, but **grep finds no reference to it in any renderer source**. The card renders `Based on revision 12` and then the full list. Nothing tells the reader how many changes there are before they scroll, and nothing collapses.
  - **Why P2.** The proposal can be read and accepted, so no work is lost. But this is the Director's primary output and the owner's main decision surface — the moment the product's premise, a creative conversation, has to survive contact with the UI. It scales the wrong way: this was **four** Beats, and the plan's own target projects are larger. It also grows unbounded with no collapse, which is what makes BUG-124's fix — moving this card inline into the transcript — actively worse, since an unbounded outline now sits in the scrolling conversation.
  - **Fix direction.** Give the card a CSS module and stop relying on browser defaults: one type scale under the card title, and flat rows instead of nested `<dl>`/`<ol>` indentation. Lead with the already-authored `mutationCount` summary and collapse the per-change detail behind it. Drop `subject.id` from the visible heading — keep it in a `data-` attribute or a title tooltip, where the existing `data-proposal-change` / `data-proposal-field` hooks already live, so tests and debugging keep their handle. For an addition, every field is new by definition: render the value alone and reserve the `Before · / After ·` pairing for `edited`. Prefer resolved titles over ids in reorder values.
  - **Do not weaken.** The review must stay main-derived and revision-pinned, the `stale` / `unavailable` / `noChanges` states and the accept-blocked path must keep their current behaviour, and the structured accept/reject buttons remain the only way to action a proposal.
  - **Fixed.** The card now leads with a localized mutation count and keeps its flat, semantically styled detail rows collapsed until explicitly reviewed. Human titles replace visible project, Beat and Shot ids—including reorder values—while the original ids remain available only through diagnostic attributes and tooltips. Added values render directly; edited values retain the before/after comparison. Existing revision, stale-state and structured decision authority is unchanged.
  - **Verification.** Focused DOM and accessible-copy tests cover default collapse, expansion, resolved reorder labels, hidden-but-retained ids, direct additions and all accept blockers. All 12 locales carry the new review label and mutation-count forms. Typecheck, i18n validation and the full Creative Studio coverage manifest pass.

- [x] **[BUG-126][P2][Creative Studio] A content-filter rejection is reported as "The generation request is invalid", so the only sane response is a retry that can never succeed** — found 2026-08-26 by the owner on `6a473f334`; closed 2026-08-26
  - **Actual.** `shot_light_lamp` failed its video take. The job record stores `{"code":"invalid_request"}` and the product renders `jobs.errors.invalidRequest` — _"The generation request is invalid."_ The dev log holds the reason the app already knew:
    `upstreamCode: 'InputImageSensitiveContentDetected.PrivacyInformation'`, `httpStatus: 400`, `stableCode: 'invalid_request'`.
  - **What actually happened.** ByteDance refused to animate the **seed image**, not the request: that Shot's still was a tight, well-lit profile of the keeper's face, and seedance treats an identifiable face as privacy information. The other three chain heads passed — Shot 1 is shot from behind, Shot 2 is backlit and occluded, Shot 4 is a distant figure. So the filter is discriminating correctly and the app is the only thing that cannot say so.
  - **Mechanism.** `openRouterVideoAdapter.ts:222-229` maps on **HTTP status alone**: `if (status >= 400) return { code: 'invalid_request' }`. The response body is never consulted for the returned error. Meanwhile the same module _does_ parse the cause — `upstreamCode: nestedUpstreamCode(error?.message)` at `openRouterVideoAdapter.ts:487` — but only into the `OpenRouterHttpErrorEvidence` object that `defaultEmitHttpErrorEvidence` prints to the console. The information is extracted, logged, and then dropped from the `SanitizedProviderError` that reaches the job record, the renderer, and the user.
  - **Why this one costs money.** "The generation request is invalid" reads like a malformed call — a transient, retryable fault. The affordance the product offers is `retry-job`. Retrying re-submits the identical seed to the identical filter and fails identically, and a video take is the most expensive unit in the app: **60 minor units ($0.60) per 12-second retry** on this route. The actionable fix — reframe or regenerate the seed still so no identifiable face is present — is not derivable from anything the user can see. Cost measured in this run: the shot needed a rewritten shooting script and a fresh $0.03 seed still, neither of which the error suggested.
  - **This class is already filed twice, and the file already contains the lesson.** BUG-062 (three unrelated Director failures all reported as a storage error) and BUG-065 (media-model validation discarding its reason) are the same defect. Stronger still, the fix is pre-argued **in this very function's doc comment**: 402 was given its own code because _"four video submissions failed in a row and were reported as ambiguous; replaying the same submission returned a plain 402 'Insufficient credits' that the redacted bodies had given no way to see."_ A content-filter refusal is the same shape as that 402 — user-actionable, invisible, and expensive to rediscover — and it was left inside the `>= 400` catch-all.
  - **Fix direction.** Add a `content_rejected` (or similarly named) sanitized code, selected when a 4xx body carries a content/safety `upstreamCode`, and give it a message that names the input and the remedy: the **seed image** was refused, reframe or regenerate the still. Keep the mapping body-informed but still **status-first**, so an unrecognized body cannot downgrade a 401/402/429. `retry-job` should be withheld or clearly discouraged for this code, since an unchanged input provably cannot pass.
  - **Do not weaken.** `upstreamCode` reaches the log through `safeEvidenceTag` / `nestedUpstreamCode` precisely so raw provider prose never escapes; the fix must carry a **bounded enum**, not the provider's message string, into the job record and the UI. Do not widen the redaction boundary to solve a copy problem.
  - **Fixed.** OpenRouter video submission now recognizes the exact bounded upstream seed-image refusal as durable `content_rejected`, without changing the status authority of authentication, quota or rate-limit failures. The failed Shot remains visible with localized guidance to reframe or regenerate its still, and unchanged retry is withheld. Classification has a 50 ms body-read deadline; malformed or unknown bodies remain the generic sanitized refusal, and provider prose never enters persisted state or renderer copy.
  - **Verification.** Adapter tests cover recognized and unknown upstream codes, status-first mapping, redaction and stalled bodies. Job-manager, workspace-projection and Beat-panel tests cover persistence, no unchanged retry and visible remedy copy; locale inventory checks cover all 12 locales. Typecheck, i18n validation and the full Creative Studio coverage manifest pass.

- [x] **[BUG-127][P2][Creative Studio] When no project decodes, every generation surface fails as a bare `provider_error` that names neither the cause nor the fix** — found 2026-08-26 by the owner on `6a473f334`; closed 2026-08-26
  - **Actual.** Every generation-facing call failed with `provider_error` / `conversation.creativeStudio.errors.providerError`. Media models were bound and valid, the API key was good, and the provider itself was never contacted. The real cause: the library's **only** project failed `decodeStudioProjectManifestV2` and was swept into `quarantinedProjectIds`, leaving `supportedProjectIds` empty. Moving that one project directory aside and restarting brought the runtime up and made the identical calls succeed.
  - **Mechanism, both ends confirmed in source.** `runtime.ts:554` refuses to activate while `supportedProjectIds.length === 0`, and `runtime.ts:601-603` parks `activationState` at `'inactive'`. Every provider-facing accessor then runs `requireActiveGraph()`, which throws `new CreativeStudioStoreError('storage_error', 'Creative Studio runtime is not active')` (`runtime.ts:252-257`) — including `listProviders` at `runtime.ts:286`. That reaches `refreshGenerationRoutes` in `v2Service.ts:1517-1524`, whose `catch` **takes no argument**: it discards the error object entirely and throws a fresh `CreativeStudioServiceError('provider_error')`. The one sentence that identifies the fault is constructed, carried across two modules, and then dropped one frame before the user.
  - **The label is actively wrong, not merely vague.** `provider_error` names the one component that is provably innocent — no provider request is made in this state. It sends diagnosis to model bindings, API keys and network, which is where this run's time went, while the actual fault is a project file on local disk.
  - **What is NOT wrong.** The sweep isolates correctly: `store.ts:7912-7929` wraps each project in its own `try/catch`, pushes the failure to `quarantinedProjectIds`, and `continue`s. **A bad project does not abort its neighbours** — an earlier reading of this defect claimed it did, and that claim is withdrawn. `inspectProjectsV2` faithfully returns all three partitions. The inventory already knows the answer; nothing downstream ever asks it.
  - **Why P2.** Recoverable, no data loss, and a library with any decodable project never sees it. But it is unrecoverable _from inside the product_: the app has no surface reporting quarantined projects, so a user whose only project is quarantined sees a healthy Studio that refuses to generate, with an error pointing at the wrong subsystem. This is the same class as BUG-062, BUG-065 and BUG-126 — a distinct failure wearing a generic label — and the fourth instance in this file.
  - **Fix direction.** Two independent changes. **(1)** Stop laundering the cause: `refreshGenerationRoutes` should bind the caught error and preserve a runtime-inactive cause instead of collapsing every failure to `provider_error`; a bare `catch {}` over a cross-module call is what makes this unreadable. **(2)** Give the empty-inventory state its own reported condition. `inspectProjectsV2` already returns `quarantinedProjectIds` and `unsupportedProjectIds`; when nothing is supported and something is quarantined, say so and name the project, rather than presenting an inactive runtime as a provider fault.
  - **Do not weaken.** Keep the activation gate: refusing to activate with zero supported projects is correct, and quarantine must stay fail-closed. This is a reporting defect, not a licence to activate on unvalidated projects or to surface raw store paths in renderer copy.
  - **Still unexplained.** Why project `a5502dee_3834_48a0_bfa7_bd2597546506` fails to decode is not diagnosed — bisection found valid scalars, beats and shot fields. It is preserved at `~/weprompt-quarantined-projects/` with its original backup for whoever picks this up. That question is separate from this bug, which is about the report rather than the decode.
  - **Fixed.** Runtime inventory now retains the deterministic quarantined-project partition and emits bounded `project_quarantined` or `runtime_inactive` service causes before any provider access. Route and connection-candidate boundaries preserve those causes; the bridge carries only the safe project id, and media-model settings names that project with localized recovery copy. Local provider inventory and route-catalog failures now remain storage failures. The activation gate and per-project quarantine remain unchanged, and no store path crosses IPC.
  - **Error-class audit.** The eight original `provider_error` sites were reduced to three. Those three all follow an actual provider validation response that is malformed or outside the admitted bounded contract, so the generic provider label is honest. Missing rate-card configuration is now `invalid_route`; provider-list, route-inventory and candidate-list failures retain local runtime/storage causes; save-time revalidation keeps its seven-value sanitized reason. The generalized cause-preservation rule now lives beside `mapStatusError`.
  - **Verification.** Runtime, service, bridge, settings DOM and all-locale tests cover deterministic quarantine naming, safe IPC projection, storage/provider separation and save-time cause preservation. A focused TypeScript-AST guard detects a deliberately reintroduced bare-catch service-error launder and asserts the real `v2Service.ts` tree has none. Focused tests, typecheck, i18n validation, lint, format, Creative Studio coverage and the full repository suite pass.

- [x] **[BUG-128][P1][Creative Studio] Three generation blockers render their raw i18n key, so the one message explaining why paid work is blocked is unreadable** — found 2026-08-26 by the owner on `6dadd0fc3`, in the `Sunday Kitchen` real-model run
  - **Actual.** The **Review generation** dialog refused to enable _Prepare estimate_ and displayed, verbatim: `conversation.creativeStudio.references.bindings.unassigned: shot_market_01 · shot_market_02 · …` — the key itself, followed by 24 shot ids. The owner had no way to learn from the product that the shots needed reference bindings.
  - **Root cause, exact.** `Gate/generationBlockers.ts:128-136` passes three complete leaf keys to `t()` under a prefix that does not exist:
    - `conversation.creativeStudio.references.bindings.unassigned`
    - `conversation.creativeStudio.references.bindings.capacity`
    - `conversation.creativeStudio.references.bindings.invalid`
      The authored strings live under **`creativeStudio.workspace.referenceWorkflow.bindings.*`**. All three resolve to nothing, so i18next echoes the key. The correct paths exist and are already correctly used elsewhere — the Table panel renders _"This Shot has no reference decision yet."_ from the same string in the same session.
  - **Scope, measured.** A repo-wide sweep of `packages/desktop/src/renderer/pages/studio` found **exactly these three** broken leaf keys. Nine other unresolvable strings surfaced by the same sweep are `KEY_ROOT`-style **prefix constants** (e.g. `BeatPanel/index.tsx:32`) that are concatenated before use and are **not** defects. Do not "fix" those.
  - **Why P1 rather than P2.** This is the terminal message on the paid-generation gate. It fires exactly when the user is blocked, it names the failure in a string only a developer can decode, and the remedy — bind references to the listed shots — is not inferable from it. The owner was stopped twice by this in one session and needed the store inspected to proceed. Every other bug in this file leaves a working path; this one removes the only explanation at the moment of blockage.
  - **Why the type system missed it.** `i18n-keys.d.ts` contains **zero** occurrences of these three keys, so the generated union does know they are absent — but the call site builds a `{ key: string }` object rather than a typed key, so nothing checks it. The repo's own all-locales test also cannot catch this: it validates that _referenced keys exist in every locale_, and these are not registered as referenced keys at all.
  - **Fix direction.** Correct the three paths to `conversation.creativeStudio.workspace.referenceWorkflow.bindings.*`. Then close the hole: type the blocker `key` field against the generated key union so a nonexistent path fails typecheck rather than reaching a user. That second half is the point — the first half alone leaves the next occurrence undetectable.
  - **Do not weaken.** Do not add duplicate strings at the wrong path to make the existing call sites resolve; that would fork one message across two locations in twelve locales.
  - **Fixed.** The three blocker leaves now use the existing `workspace.referenceWorkflow.bindings.*` paths, and the blocker message contract uses the generated `I18nKey` union so another nonexistent leaf fails typecheck.
  - **Verification.** Focused blocker tests cover all three paths and TypeScript accepts only registered keys.

- [x] **[BUG-129][P2][Creative Studio] The Director asks the user to approve references that the product has already approved, and the request can never be satisfied** — found 2026-08-26 by the owner on `6dadd0fc3`
  - **Actual.** After generating references the Director wrote: _"Please confirm once you've approved the background-reference generation and their images show as current. Then I can bind the four approved references…"_ The owner replied `ok`; the Director repeated the request. The conversation could not advance.
  - **The state it was waiting for already held.** All four references carried a set `approvedAssetId`, no pending `candidateAssetId`, and all five generation jobs `succeeded`. There was nothing left to approve, and no UI affordance to approve it with, because approval is implicit.
  - **Mechanism.** The owner's References ruling — newest generated image is current, current is approved, no explicit Approve act — is implemented in the store. The Director's prompt still describes the superseded model in which a human approves a candidate. The Director cannot self-resolve: `approve_reference` is `operation_not_permitted` for it, so it correctly will not act, and instead waits forever on a human step that has no button.
  - **Why P2.** Recoverable by abandoning the conversation and driving the workspace directly — which is what unblocked this run — but that is not a route a user would find, and it strands the Director's entire binding-and-storyboard sequence behind it.
  - **Fix direction.** Bring the Director's reference vocabulary in line with implicit approval: it should verify `approvedAssetId` is set and proceed, treating a generated image as current. Where a human decision genuinely is wanted, it must be a structured card with a control, not a sentence asking for a confirmation the UI cannot express. Relatedly, the free-text `ok` did nothing — correctly, per the proposal-action contract — which is worth keeping in mind: the request was unanswerable _by design_ as well as by state.
  - **Fixed.** The Director rules now define successful generation as automatically current, explain the internal `approvedAssetId` name, require an immediate fresh read and continuation, and prohibit asking for chat approval or confirmation of a current image.
  - **Verification.** The ordered Director prompt contract asserts the automatic-current rule, the persisted-field interpretation, and the no-free-text-action boundary.
  - **Fix is unverified in practice as of 2026-08-26 evening — and the entry stays closed, because nothing here shows it failed.** A second occurrence was observed on the `Create a CINEMATIC STORYBOARD SHEET…` project (`6698ac0c…`): five background references all carried `approvedAssetId`, all five jobs succeeded, and the Director still wrote _"Once you approve the background-generation spend and the resulting images are confirmed, I'll bind the approved references"_. The owner's `ok` again advanced nothing, and the workspace had to be driven directly.
  - **That occurrence is not evidence against the fix.** Timestamps place it on the **pre-fix** build. The fixed build `b79254f6e` launched at 18:56 local and was reverted at 19:15 after BUG-136 quarantined every project; the reverted build `07566f7cc` — which predates this fix — has been running since. The reference jobs that produced the message above ran at **13:08:52Z / 20:08 local**, 53 minutes into the reverted build. The fixed Director rules were never loaded.
  - **What this means for whoever verifies.** The fixed build ran for roughly fourteen minutes and spent all of them quarantining projects, so **no fix in `b79254f6e` has been exercised against a working project** except BUG-128, which was confirmed by static check (all twelve keys in `generationBlockers.ts` resolve) rather than by use. Verification of this entry is therefore **blocked behind BUG-136**: the missing `dismissedSeedStillIds` migration must land before the fixed build can open an existing project at all.
  - **Practical note recorded so it is not rediscovered:** on any build predating this fix, the trap is live and the workaround is to bypass the Director conversation and drive references and bindings from the workspace directly.

- [x] **[BUG-130][P2][Creative Studio] The renderer blocks generation on a stale engine list while the backend reports every route ready** — found 2026-08-26 by the owner on `6dadd0fc3`
  - **Actual.** The **Review generation** dialog refused 15 shots with _"The engine list has not loaded yet."_ At that same moment a live probe through the renderer's own `ipcBridge` returned, for that exact project: `image: {status:'ready', selected:true, options:1, selectionIssue:null}` and `video: {status:'ready', selected:true, options:1, selectionIssue:null}`, with both connections present (`google/gemini-3-pro-image`, `bytedance/seedance-2.0`). The engine list was loaded; the dialog's copy of it was not.
  - **Reproduced across projects.** Both Studio projects in the library reported `ready` while the open dialog claimed otherwise, so this is not a per-project data fault.
  - **Impact.** A free, correct action — preparing an estimate — is gated on a snapshot that the dialog never refreshes. The only recovery found was closing and reopening the dialog. Nothing in the message suggests that, and the phrasing ("not loaded **yet**") implies waiting will help, which it does not.
  - **Fix direction.** Have the gate read current route state when it opens, or subscribe so a resolved catalogue clears the block without a reopen. If a genuinely-unloaded state must be represented, give it a retry affordance rather than an implied wait.
  - **Fixed.** Opening an unprepared gate now refreshes the route/capability pair, and the gate updates its exact disclosure in place when the revision-owned capability changes.
  - **Verification.** Reducer and Studio-page DOM tests prove a stale `catalog_unloaded` block starts disabled, clears after the current backend response, enables preparation, and keeps the same modal open.

- [x] **[BUG-131][P2][Platform] An invalid IPC payload makes `bridge.invoke` hang forever instead of rejecting** — found 2026-08-26 while driving Creative Studio through the renderer bridge
  - **Actual.** `applyAuthoringBatch` called with `expectedRevision: undefined` never settled. A `Promise.race` probe with an 8s and a 15s bound proved it: `getProject` returned normally, the mutation returned `APPLY HUNG`. No rejection, no timeout, no console error in the renderer.
  - **Mechanism.** Main-side payload validation rejects the operation and throws; the throw is not converted into a rejected promise on the renderer side, so the awaited call is abandoned in flight. The main process does log the cause — this run produced `[adapter] Native IPC payload validation failed {"providerKey":"creative-studio.edit-project","issues":[…]}` for an analogous call — but the renderer awaits forever.
  - **Cost.** Several minutes were spent diagnosing this as a Studio failure — the app was suspected of blocking mutations behind an open modal or a pending Director proposal — before the caller was found to be at fault. A rejection naming the field would have made it immediate. The same shape will strand any renderer caller that gets a payload wrong.
  - **This is adjacent to BUG-093, not a duplicate.** BUG-093 was about the _log line_ being unreadable and is closed. This is about the _renderer promise_ never settling, which no amount of log detail fixes.
  - **Fix direction.** Ensure a main-process throw during payload validation produces a rejected promise at the bridge boundary. Renderer-facing text stays generic; the requirement is that the call **settles**.
  - **Not a product-facing defect in normal use** — the shipped UI builds its own payloads — which is why it is P2 rather than higher. It matters for reliability and for anyone driving the bridge.
  - **Fixed.** Provider invokes now observe asynchronous native transport rejection, reject the caller with that generic transport error, and dispose the response listener; renderer-query invokes use the same settlement rule alongside their timeout.
  - **Verification.** Shared-bridge regression coverage proves an invalid native delivery rejects and that a late callback has no listener, while main-adapter security tests retain generic renderer errors and safe diagnostic paths.

- [x] **[BUG-132][P2][Creative Studio] A character reference generated as a four-panel contact sheet and was accepted as the canonical image** — found 2026-08-26 in the `Sunday Kitchen` run
  - **Actual.** The reference _"Faceless Lunar New Year Home Cook"_ was a single 1376×768 asset containing **four separate views** of the cook side by side. It was set as `approvedAssetId` and shown as **Current**, ready to condition every Shot bound to it.
  - **Measured, not eyeballed.** Mean absolute column difference at the 25%/50%/75% seams against the image's own median: **+192.7, +203.7, +97.4**. A clean single frame measures **≤ +9**; the regenerated replacement measured **+1.3, −1.2, +3.7**. The signature is unambiguous and cheap to compute.
  - **Same class as the known seed-still grid**, but on the reference surface, where the blast radius is larger: a character reference is bound to many Shots, so one grid poisons every Shot that inherits it rather than one Beat.
  - **What fixed it.** Rewriting the prompt with an explicit single-frame constraint — _"ONE SINGLE PHOTOGRAPH… not a grid, not a contact sheet, not a character sheet, not a turnaround, no panels, no split screen, no repeated figures"_ — then regenerating. The original prompt never said "grid"; it said _"character reference"_, which the image model reasonably reads as a character **sheet**. The superseded grid was correctly retained in `supersededAssetIds`.
  - **Fix direction.** Two independent halves. **(1)** Compose reference prompts with the single-frame constraint, since the word "reference" actively invites a sheet. **(2)** Detect it: the seam metric above is a handful of arithmetic on an image already in hand, and `seed_still_variation_grid` already exists as a failure code (`creativeStudioTypes.ts:96`) — extend that detection to reference images and refuse to set a grid as current.
  - **Do not weaken.** Detection must not reject legitimate images with strong central verticals; calibrate against the measured spread above (~+9 clean vs ~+190 grid) rather than a guessed threshold.
  - **Fixed.** Character and background composition now demand one unified photograph and prohibit sheets, turnarounds, panels and repeated figures. Before commit, seed and reference images are decoded at a bounded size and rejected when at least two quartile seams exceed the image's own median adjacent-column change by 48; a single strong central edge is admitted.
  - **Verification.** Pure seam tests cover a four-panel sheet and a one-edge composition; media and job-manager tests prove rejected seeds/references never become current while the paid reference failure and provenance remain valid. The shared error copy covers both surfaces in all 12 locales.
  - **REOPENED 2026-08-26 — both halves of the shipped fix are empirically insufficient.** Tested on a fresh project (`The Potter`, `ab864bb7…`) against the same image route. This is a correction of the original entry's own fix direction, which recommended exactly the two mechanisms that fail below.
  - **(1) Prompt constraints do not prevent the grid.** The character reference was composed with the constraint the fix prescribes, verbatim: _"ONE SINGLE PHOTOGRAPH… not a grid, not a contact sheet, not a character sheet, not a turnaround, no panels, no split screen, no repeated figures, no borders or dividing lines. Exactly one continuous image showing one person once."_ The model returned a **four-panel turnaround** — front, front-with-hands, side, back. A second attempt rewrote the prompt as a candid documentary scene of a specific moment ( _"A single candid documentary photograph, shot on a 50mm lens, of one moment in time… This is a photograph of a scene, NOT a reference sheet"_ ), naming an action and a camera position rather than a reference. It returned **another four-panel turnaround**, this time with the faces blurred — the model read "no visible face" as an instruction to blur. Two independent phrasings, two grids.
  - **(2) The seam metric returns a false negative on the common case.** That same turnaround measured **+2.3, −4.9, −2.9** at the 25/50/75% seams — comfortably inside the "clean ≤ +9" band the original entry calibrated, and nowhere near the +192/+204/+97 it was built from. **The metric detects discontinuity, not repetition.** The Lunar New Year grid had four unrelated compositions butted together, so the seams were hard edges. This one is four views of the same subject against a _continuous_ background — same wall, same bench line, same lighting running unbroken across all four panels — so there is no edge to find. A detector calibrated on the first kind is blind to the second, and the second is the one a "character reference" prompt actually produces.
  - **Sharper pattern, measured across four films.** Only **character** references grid. Every background reference generated in this session came back as a clean single frame: `Autumn French neighborhood market`, `Sunlit home kitchen and dining room`, `Lunar New Year street market`, `Quiet daylight pottery studio`. The trigger is the combination of a person and the concept of a _reference_, which the model reasonably resolves as a character sheet. Negation does not override it.
  - **The original "what fixed it" was luck, not mechanism.** The Lunar New Year reference that came back as a single frame was one regeneration of the same prompt family. Re-running that approach on a new project produced grids twice. One success out of three is consistent with sampling variance, not with the constraint working.
  - **Root cause found 2026-08-27, and it corrects this entry's central claim: the product was asking for the grid.** Until `3eefd4ad5`, the reference-image composition built by `generation/composition.ts` instructed the model, verbatim:

        Create one clean character reference sheet in a single image with front,
        three-quarter, side, and back views.

    A four-panel turnaround was therefore **the specified output**, not a model misbehaviour. Every anti-grid instruction written into a reference prompt was being appended to a hardcoded instruction demanding exactly a grid — which is why increasingly explicit wording never helped, and why **backgrounds never gridded**: their branch of the same function asked for a single environment image. The conclusion recorded above — _"prompt constraints do not prevent the grid"_ — was measured correctly but explained wrongly; the user's prompt was losing to the product's own.

  - **Already fixed by Codex in `3eefd4ad5`**, which rewrote both branches to demand one unified photograph and prohibit sheets, turnarounds, panels and split screens. The detection work remains correct and worth keeping — a model can still return a grid unbidden, and BUG-141 covers what happens when it does — but the dominant cause was the instruction, and it is gone.
  - **Revised fix direction.** Detection must find **repetition**, not seams: compare the image's vertical bands (halves, thirds, quarters) for near-duplicate subject placement and scale, and reject when several bands hold the same subject at the same size — that catches the continuous-background case the seam test misses. Keep the seam check as a cheap first pass for the discontinuous kind; it is correct, just not sufficient. Since prompting cannot be relied on, the product needs a response for a detected grid rather than only prevention: refuse to set it as `approvedAssetId` and regenerate, or crop to a single panel once repetition is located. Note also that `The Potter` proceeded successfully with **no character reference bound at all** — 30 shots carrying wardrobe description in their shooting scripts instead — which suggests character references may be optional for faceless subjects and is worth measuring before more effort goes into forcing them.
  - **Verification that would have caught this.** The shipped tests cover "a four-panel sheet and a one-edge composition" — both discontinuous. Add a fixture that is a four-panel turnaround on an unbroken background; the current seam test passes it, which is the bug.
  - **Third occurrence, 2026-08-26 evening, and the first in portrait.** A Trung Thu project (`65cb2f41…`, `aspectRatio: '9:16'`) produced `Nàng thơ Trung Thu` as a **four-view turnaround** — front, three-quarter, side, back — at 768×1376. So the grid is not tied to 16:9, and it now spans three independent projects and two aspect ratios. It was also invisible to the owner at first because BUG-138 cropped the preview to a horizontal band that excluded the four figures.
  - **Fixed after reopening.** Character-reference validation now retains the seam check and additionally compares normalized edge-layout features across thirds and quarters. Repeated subject placement on a continuous background is refused, while background references and seed stills keep the seam-only policy to avoid treating ordinary repeated scenery as a character sheet.
  - **Verification.** A continuous-background four-subject fixture is rejected only when repeated-subject analysis is requested, a single central subject is admitted, and media-store coverage proves character, background, and seed paths request the intended detection policy without weakening current-asset ownership.

- [x] **[BUG-133][P1][Creative Studio] Rendering a chain head on its own permanently strands its whole chain, and the only recovery is to pay for the head again** — found 2026-08-26 by the owner across two independent five-minute films
  - **Actual.** A Beat's first Shot was rendered by itself. Its four followers then showed `NO PICTURE` with nothing queued, and any attempt to generate them was refused at pricing with `pricing_refused / missing_conditioning`. Nothing in the product said why, and nothing offered a way forward.
  - **Mechanism, traced end to end.** A downstream Shot conditions on its predecessor's end frame. `currentConditioningInput` (`chain.ts:193-236`) resolves that frame **only by looking up an existing `frameExtractions` record** whose `status` is `ready` — it never creates one. `estimate.ts:688-703` then admits a base `video_take` only if one of three holds: a `seed_still` authorized earlier in the same request, the **predecessor's `video_take` authorized in the same request**, or a non-null `currentConditioningInput`. A head rendered alone satisfies none of them for its followers, because the extraction that would satisfy the third is only produced when downstream work was authorized alongside the head.
  - **Measured, both directions.** The film whose Beat 1 was submitted as base + cascade had **4 ready extractions** and advanced by itself. The film whose Beat 1 head was rendered alone had **0 extractions** and could not price a single follower. Same build, same routes, same session — the only difference is whether the cascade was authorized with the head.
  - **The dedicated recovery does not recover.** `creative-studio.retry-conditioning-frame` with the dependent Shot id returns `invalid_payload`: it retries an extraction that exists and failed, and cannot create one that was never requested. So the documented repair path is unavailable in exactly the state that needs it.
  - **Cost, measured.** The only route back is re-authorizing the head with its cascade, which re-renders a take that already succeeded. Three heads across two films had to be paid for twice: **$1.80 of pure repeat work**, and the user also loses the take they already reviewed, since the re-render is a different generation.
  - **Why P1.** It is silent, it is reachable from an ordinary action the UI actively offers (the Beat panel's per-Shot **Generate again** on a head), it costs real money to escape, and it strands four Shots per occurrence. Both films in this session hit it independently without the user doing anything unusual — the second time _after_ the failure mode was already understood, because nothing in the product warns about it.
  - **Fix direction.** Prefer extracting a take's endpoint whenever the take completes, so the frame exists regardless of what was authorized alongside it; that removes the trap rather than signposting it. If extraction must stay demand-driven, then `retry-conditioning-frame` should create a missing extraction rather than only retry a failed one, and the Beat panel must not present a head-only render as an ordinary action without saying it will strand the chain.
  - **Do not weaken.** Do not make followers generate without a real conditioning frame; the chain contract is what makes continuity work. This is about producing the frame, not about relaxing the requirement for one.
  - **Fixed.** Every successful video-take commit atomically creates the deterministic extraction record for its exact persisted duration minus current trim-out, independent of cascade authorization. The job manager attempts extraction and verification immediately, advances any matching waiter, and leaves decoder failure recoverable without changing the paid take's success.
  - **Verification.** Media-store coverage proves the standalone take creates the exact pending endpoint, and job-manager/recovery coverage proves extraction failures do not corrupt paid output and ready verified endpoints dispatch waiting followers.

- [x] **[BUG-134][P3][Creative Studio] The reference-capacity error counts characters and background together while the UI presents them as separate groups, so the number it reports does not match what the user can see** — found 2026-08-26 by the owner
  - **Actual.** Ten Shots showed _"3 references are selected, but the image route supports 2."_ The owner's response was reasonable and correct from the screen: **"why error? there are only 2 reference"** — the Table's binding editor lists references under two separate labelled headings, `CHARACTERS` (The Cook, Multigenerational dinner guests) and `BACKGROUND` (Sunlit home kitchen), with no combined total anywhere. Counting the visible groups gives 2; the validator counts the images, which is 3.
  - **The message is accurate.** `workspace.referenceWorkflow.bindings.capacity` renders `{{count}}` and `{{limit}}` faithfully, and `google/gemini-3-pro-image` does report `maxConditioningImages: 2`. This is a presentation gap, not a wrong computation, which is why it is P3.
  - **What it does not say.** That characters and background draw on one shared budget; which reference to drop; or that the background is a candidate for dropping at all. The user is told a total they cannot derive and left to guess the remedy.
  - **Worth noting:** the **video** route reports `maxConditioningImages: 0` with `supportsFirstFrame: true`, so this budget constrains board and seed images only. A user reading "the image route supports 2" has no way to know their video takes are unaffected.
  - **Fix direction.** Show the running total against the limit in the binding editor itself — a `2 / 2` style counter across both groups — so the constraint is visible before it is violated, and the error becomes a confirmation rather than a surprise. Naming the shared budget in the message would help too.
  - **Related:** the same `bindings.capacity` string is one of the three keys that `generationBlockers.ts` requests under a nonexistent prefix (BUG-128). It renders correctly here because the Table view uses the correct path; on the generation gate it renders as a raw key. Fixing BUG-128 does not fix this, and vice versa.
  - **Fixed.** The binding editor now shows one live `count / limit` counter explicitly labelled as the shared character-plus-background image-reference budget, and the over-capacity message names the same shared budget.
  - **Verification.** Table DOM tests cover an in-budget `2 / 2` character-plus-background selection and an over-budget `3 / 2` state; authored copy and placeholder parity pass for all 12 locales.

- [x] **[BUG-135][P2][Creative Studio] Every rendered Shot shows a black thumbnail, because the poster pipeline is fully built and never invoked** — found 2026-08-26 by the owner while watching a Beat render
  - **Actual.** In the Beat panel, the **Current picture** card for a Shot marked `RENDERED` is solid black. The owner reasonably read this as generation lag; it is not. The video is finished, downloaded, and playable.
  - **Ruled out, in order.** Media missing — no: all four rendered Shots in that Beat have real files on disk, 3.7–5.5 MB each. Window occluded and throttling paint (a documented hazard in this app) — no: the page reports `visibilityState: 'visible'`, `hidden: false`, and all six `<video>` elements are at `readyState: 4` with `videoWidth: 1280`, i.e. fully decoded. The clip genuinely opening on a dark frame — no: mean luminance of frame 0 is **96/255**, statistically identical to t=6s (97.7). The first frame is an ordinary well-lit kitchen.
  - **Root cause, exact.** `BeatPanel/index.tsx:856` renders `poster={currentPicturePosterUrl ?? undefined}` on a `<video preload='metadata'>`. With no poster and metadata-only preload, the element decodes no frame and paints black — correct browser behaviour. `currentPicturePosterUrl` derives from `posterAssetId`, which `workspaceProjection.ts:272-299` (`videoPosterId`) returns only when the producing job carries `outputAssetIdsByRole.poster` pointing at an owned asset in the **`thumbnails`** collection. Nothing ever puts one there.
  - **The capability exists end to end and has no caller.** `persistCapturedPoster` is declared at `ipcBridge.ts:1347`, handled in main at `creativeStudioBridge.ts:848`, implemented at `v2Service.ts:2702`, and has its own payload schema. **`grep` finds zero references to it anywhere under `packages/desktop/src/renderer`.** The renderer is the only place that could capture a poster from a playing `<video>`, so the asset is never produced.
  - **Measured across every project on this machine:** three projects, 108 assets total, collections are `assets` / `boardStills` / `conditioningFrames` — **zero `thumbnails`** — and **zero** jobs with a `poster` role. The path has never executed, so this is not an intermittent capture failure; it has never worked.
  - **Why P2.** Nothing is lost and no money is wasted: the films render correctly and the Cut and export use the real media. But it makes finished work look broken at the exact moment the user is watching progress, and it is indistinguishable from "still rendering" — which is precisely how it was reported. The projection, the service, the IPC, the schema and the `thumbnails` collection were all built for this and sit inert.
  - **Fix direction.** Either wire the renderer to capture a frame once a take's video is decoded and call `persistCapturedPoster` — the design the existing code clearly anticipates — or, if that is not wanted, stop paying for the dead pipeline and give the `<video>` a first frame to show instead (`preload='auto'`, or seek to a small offset on load). Do not do both half-way; the current state is the worst of the two, carrying the cost of the pipeline and the appearance of the bug.
  - **Do not weaken.** `videoPosterId`'s ownership checks — producing-job identity, single-occurrence output, `thumbnails` collection, `shot.assetIds` membership — are what keep an arbitrary image from being presented as a Shot's picture. A fix must produce a genuinely owned poster asset, not relax those checks.
  - **Related.** The blank beige preview panes in the same panel are the milder form of the same gap: media present and decoded, nothing painted.
  - **Fixed.** A posterless current video now eagerly decodes, captures its first readable frame to a bounded PNG, and invokes the existing typed poster-persistence command once for the exact projected Shot and current video. The renderer refuses stale or mismatched identities; Main's existing producing-job, collection, membership, and provenance checks remain unchanged.
  - **Verification.** Beat-panel DOM coverage proves the readable-frame event captures one 1280×720 PNG and de-duplicates later media events. Studio-page coverage proves the exact current identity reaches IPC and a superseded identity fails closed before IPC; existing service and media-store tests retain the owned-poster contract.

- [x] **[BUG-136][P1][Creative Studio] A required shot field shipped without a migration, so every project written before it becomes permanently unopenable** — found 2026-08-26 by the owner immediately after relaunching on `b79254f6e`
  - **HANDOFF TO CODEX — read this first; the detail is below.** Two independent breakages quarantine
    every pre-existing project. One is fixed, one is not.

    | #   | Breakage                                                                                                                                                  | State                                                                                                                            |
    | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
    | 1   | `dismissedSeedStillIds` migrated only in the live `shots` map, not in `undoHistory[].patches[].before` (`SHOT_BEFORE_KEYS` derives from `SHOT_KEYS`)      | **Fixed** on branch `fix/studio-legacy-manifest-traversal` — merge or rebuild on it. 6/6 focused, typecheck clean, lint 0 errors |
    | 2   | `validateComposition` **recomposes from current code** and demands exact equality, so `3eefd4ad5`'s prompt rewrite invalidated every job stored before it | **Open — yours.** Root-caused and proven; see the recommended fix below                                                          |

    **What to do, in order.**
    1. Take the branch for breakage 1 — it is necessary but not sufficient on its own.
    2. Fix breakage 2. Preferred: **stop validating stored compositions by recomputation.** A
       composition records what was _sent_; re-deriving it makes history depend on present code.
       Validate its shape and internal consistency, and keep `requestPlanCompositionEquals`
       (stored-to-stored) — that is the check that actually protects integrity. If recomputation must
       stay, bump `instructionProfile` when its text changes and recompose against **the profile the
       job recorded**, never the current one. Do **not** migrate stored prompts: that would falsify
       the record of what went to the provider.
    3. Add the regression test this entry has always lacked — a decode probe over
       `~/weprompt-archived-projects/2026-08-27-pre-migration/` (six projects, the only pre-migration
       data in existence). Existing fixtures pass because none carry undo history or a pre-`3eefd4ad5`
       job.

    **Before you start end-frame conditioning:** it adds a new required schema field, which is what
    caused breakage 1. Landing this first makes that migration correct by construction rather than by
    remembering. Also note breakage 2's general hazard — **generation prompt text is a breaking schema
    change** — which applies to any future wording edit in `generation/composition.ts`.

  - **Actual.** Relaunching the app on the fixed build quarantined **every project on the machine**:
    `[CreativeStudio] Quarantined corrupt schema-2 project manifest: b552858f… / 0b9a44d8… / b3e03d44… CreativeStudioStoreError: Malformed schema-2 Studio project manifest`, followed by `Schema-2 runtime activation failed`. With no supported project the runtime never activated, so every call failed and the whole feature was unusable. Three finished or in-progress films — one complete 25-shot 5:00 film, one at 23/25, one at 5/5 — were inaccessible.
  - **Root cause, exact.** `b79254f6e` added `dismissedSeedStillIds` to `SHOT_KEYS` (`validation.ts:168`), which is an **exact-key** set, and validates it with `isUniqueSafeIdArray(value.dismissedSeedStillIds)` (`validation.ts:650`). `undefined` fails that predicate, and an exact-key record rejects a shot that lacks the key. **Measured: 0 of 25 shots** in the newest project carried the field; no project written before this commit can, because nothing ever wrote it. So the check is not detecting corruption — it is rejecting every file the previous build produced.
  - **No migration exists.** There is no upgrade path that adds the field on load, and no schema-version bump to hang one from: the field was added to the schema-5 shape in place. A project therefore has no route from "written yesterday" to "valid today" other than being edited outside the app.
  - **The label is wrong in a costly way.** The failure reports **"Malformed manifest"** and quarantines, which reads as data corruption. The owner's first reaction was that three films had been damaged. Nothing is corrupt; the files are exactly as the previous build wrote them. A version-skew condition presented as corruption invites exactly the wrong recovery — restoring from backup or recreating work that is perfectly intact.
  - **Blast radius.** Total, and silent until launch: every project, every user who upgrades. It is strictly worse in kind than BUG-127, which needed a project to be independently undecodable; here the upgrade itself makes every project undecodable. Recovery required reverting the build.
  - **Why P1.** Complete loss of access to all existing work on upgrade, with a message that misattributes the cause. No spend is lost and no data is destroyed, which is the only reason this is not higher.
  - **Fix direction.** Add the field with a **migration on load** — default `dismissedSeedStillIds` to `[]` when absent, the same way legacy inline briefs were migrated for `brief.md` without changing their revision. Prefer tolerating the absent key in validation and normalizing at the boundary over demanding it in an exact-key set. If a required-key change is genuinely wanted, it needs a schema-version bump and an explicit upgrade step, not a silent quarantine.
  - **Do not weaken.** Keep quarantine fail-closed for genuinely malformed files, and keep `SHOT_KEYS` exact — the protection is real. The defect is the missing upgrade path and the misleading classification, not the strictness.
  - **Verification for whoever fixes it.** A project written by the previous build must open on the new build without hand-editing. The three projects that reproduced this are on the owner's machine at schema 5, revisions 191 / 597 / 661, each with `project.json.bak-20260826-*` backups taken before the diagnosis.
  - **Recorded so it is not re-derived:** the owner reverted the running app to `07566f7cc` to regain access. All three projects then loaded cleanly with image and video routes `ready`, confirming the files were never damaged.
  - **Fixed.** Manifest decoding now adds `dismissedSeedStillIds: []` only when that exact field is absent, before running the unchanged exact schema validator. The compatibility normalization is in-memory and does not alter project revision; a present malformed value is still quarantined.
  - **Verification.** Brief-file boundary tests open a previous-build manifest without the field at its original revision and continue rejecting the same manifest when the field is explicitly `null`.
  - **REOPENED 2026-08-27 — the migration is incomplete and every pre-migration project still quarantines.** Verified by launching the fixed build against the six projects written by the previous one: **all six** logged `Quarantined corrupt schema-2 project manifest`, and the runtime again failed to activate. The fix as shipped does not achieve its own stated verification criterion — _"a project written by the previous build must open on the new build without hand-editing."_
  - **Why the normalizer misses.** `normalizeLegacyShotFieldsV2` (`briefFile.ts:40-51`) walks **`project.shots`** and adds `dismissedSeedStillIds` where absent. That is correct and sufficient for the live shots. But shot-shaped records also live inside **`undoHistory[].patches[].before`**, and the normalizer never descends there. Measured on one project: 6 undo entries, 12 `shot_fields` patches, **7 legacy shot snapshots** with no `dismissedSeedStillIds`.
  - **The tightening was invisible because the key set is derived.** `validation.ts:358` defines `SHOT_BEFORE_KEYS = new Set([...SHOT_KEYS].filter((key) => key !== 'assetIds' && key !== 'jobIds'))`. Adding a required field to `SHOT_KEYS` therefore silently added it to undo-patch validation as well. This is the **same defect class as the original BUG-136, one level deeper**: a required-field addition propagating into a derived exact-key set that no migration covers.
  - **Same exposure for the second new field.** `attemptCount` on frame extractions received its own normalizer (`normalizeLegacyFrameExtractionFieldsV2`), also scoped to the live `project.frameExtractions` map. Any extraction-shaped record reachable from a patch or snapshot has the identical gap; audit rather than assume.
  - **Fix direction.** Normalize **every** location a shot- or extraction-shaped record can occupy, not just the live maps — walk `undoHistory[].patches[].before` (and `after`, if snapshots are ever stored there) with the same field-absent test. Better still, make the compatibility layer operate on a single traversal of the decoded document so a new required field cannot be migrated in one place and missed in another. Add a fixture project **containing undo history** written by the previous build; the current tests pass because their fixtures have none.
  - **Do not weaken.** Keep `SHOT_BEFORE_KEYS` derived from `SHOT_KEYS` — the derivation is correct and is what keeps undo patches honest. The defect is the migration's coverage, not the strictness.
  - **Correction, 2026-08-27 — the undo-history gap is real but is NOT the whole cause.** A candidate fix extending the normalizer to `undoHistory[].patches[].before` is pushed on branch **`fix/studio-legacy-manifest-traversal`** (6/6 focused tests, typecheck clean, lint 0 errors). It is **necessary but not sufficient**: with it applied, all six archived pre-migration projects **still fail to decode**. Whoever finishes this should not assume the traversal fix closes the entry.
  - **Where the remaining failure is, measured.** Instrumenting `validateStudioProjectV2` against a real archived project narrows it precisely: rejection happens at the asset/job gate (`validation.ts:1767`), on **`reference_image` jobs with status `succeeded`**. Clause-level tracing of `validateJob` shows three clauses failing together — `validateComposition`, `validateRequestPlan`, `validateRequestSnapshot` — which share the composition payload. Ruled out by direct comparison against a project written by the current build: every key set matches (job, composition, `COMPOSITION_INPUT_KEYS`, `COMPOSITION_REFERENCE_SOURCE_KEYS`, `REFERENCE_INPUT_KEYS`), `STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION` is unchanged at `1`, the instruction-profile identifier is unchanged at `.reference-character.v1`, and the changed `supersededVideoAssetIds` invariant is satisfied by all six projects. The remaining suspect is a value-level rule inside `validateComposition` reachable only for reference-image compositions; it was not isolated before this note was written, and the honest statement is that it is **not yet root-caused**.
  - **ROOT-CAUSED 2026-08-27 — the remainder of this bug is the BUG-132 fix.** `validateComposition` ends by **recomposing the generation from current code and requiring exact equality** with what was stored:

        return studioGenerationCompositionsEqualV2(composition, recomposeStudioGenerationV2(composition));

    `3eefd4ad5` rewrote the reference-image instruction text (the character-sheet wording that caused BUG-132). Every job stored before that commit therefore recomposes to different bytes and fails validation, which fails its project, which quarantines it. Proven by recomposing a real archived job: the strings diverge at **character 1213**, exactly at the prompt body — stored _"Create one clean character reference sheet in a single image with front, three-quarter, side, and back views…"_ versus the new anti-grid text. The two bugs are the same event: **fixing BUG-132 caused the remainder of BUG-136.**

  - **The general hazard, which outlives this instance: generation prompt text is a breaking schema change.** Because compositions are validated by recomputation, _any_ wording change to `generation/composition.ts` invalidates every stored job and every project containing one. Nothing in that file signals this, and the next prompt improvement will do it again. The `instructionProfile` identifier exists to version exactly this — but it was left at `.reference-character.v1` while its text changed, so the version no longer describes the content it names.
  - **Fix direction, in preference order.** **(1)** Stop validating stored compositions by recomputation — a composition is a _record of what was sent_, and re-deriving it makes history depend on present code. Validate its shape and internal consistency instead, and keep `requestPlanCompositionEquals` (stored-to-stored), which is the check that actually protects integrity. **(2)** If recomputation must stay, bump `instructionProfile` whenever its text changes (`.v1` → `.v2`) and recompose against the **profile the job recorded**, not the current one — that is what a versioned profile is for. **(3)** A migration that rewrites stored prompts is _not_ acceptable: it would falsify the record of what was actually sent to the provider.
  - **Do not weaken.** Keep `requestPlanCompositionEquals`. The defect is re-deriving history from current code, not comparing a job's own plan against its own composition.
  - **Reproduction corpus.** The six pre-migration projects are archived unmodified at `~/weprompt-archived-projects/2026-08-27-pre-migration/` and are the only pre-migration data that exists. A decode probe over that directory is the fastest regression test for this entry.
  - **Not blocking the owner.** The six affected projects are same-day throwaway test data and are being discarded rather than repaired; they are recorded only because they are the sole pre-migration corpus available to prove the fix. A real user with any undo history — that is, anyone who has edited a Beat or Shot — upgrades into the permanent quarantine this entry describes.
  - **Both breakages are fixed and in the working branch; closed 2026-08-28.** Breakage 1's `briefFile.ts` is byte-identical to `b5d654c97`, and breakage 2 was fixed by `50afef8bb`, which **deleted** the offending line — `if (!studioGenerationCompositionsEqualV2(composition, recomposeStudioGenerationV2(composition))) return false;` — and replaced it with the rule that prompt bytes are historical provider evidence and "must not reinterpret them with the current composer implementation". Verified live: all six projects in the store open, and `Plateau` (revision 1218) carries **97 stored jobs, every one with a composition**, all written before the prompt rewrite. `briefFile.test.ts` and `composition.test.ts` both pass.
  - **One limit on this verification, stated rather than glossed.** Breakage 1 is the undo-history traversal, and **no project in the store has any undo history** (`undoEntries: 0` on all six), so the fix is proven by its unit test and by file identity with the branch, not by live exercise. If a project with legacy undo entries appears, re-check it.
  - **A correction on how this was tracked.** This entry was repeatedly described as having an unmerged fix branch. That came from `git merge-base --is-ancestor`, which tests whether a branch _tip_ is an ancestor; the content had landed via different commits, so ancestry said "not merged" while the code said otherwise. Compare content, not ancestry.

- [x] **[BUG-137][P1][Creative Studio] A failed continuity frame is skipped by the resume path, so the chain behind it stalls silently and forever** — found 2026-08-26 across three films; the recovery is free and always worked, which is what makes the silence expensive
  - **Actual.** In the Beat panel a join shows `✕`, the next Shot reads **`NEVER DISPATCHED`**, and the two after it read `WAITING ON 03` / `WAITING ON 04`. Nothing is queued and nothing will ever run. The Shot's own video was never submitted, because the frame it would start from does not exist.
  - **Root cause, exact and deliberate.** `mediaStore.ts`, inside `resumeConditioningFramesV2` (defined at `mediaStore.ts:3605`), iterates every extraction and does:
    `if (extraction.status === 'failed') continue;`
    The resume path **explicitly excludes the one state that needs resuming.** Restarting the app does not recover it; the extraction stays `failed` indefinitely and every downstream Shot in that chain stays parked.
  - **Frequency, measured — updated 2026-08-26 evening as the session continued.** **5 failed extractions out of 70** created across six projects (~7%): `shot_lny_prep_02`, `shot_lny_table_01`, `shot_pot_wheel_02`, `shot_pot_kiln_02`, `shot_pot_trim_03`. The rate held steady as the denominator grew from 54 to 70, so ~7% is a stable property of the pipeline rather than a burst.
  - **Concentration is the sharper number.** In one six-Beat film (`The Potter`) **three of six Beats** broke a join — after Shot 2 twice and after Shot 3 once — inside a single 30-Shot run. A long project is therefore _more likely than not_ to hit this at least once, and likely to hit it repeatedly. The earlier count of four-in-54 understated it.
  - **Recovery remains perfect: 5 for 5, first attempt, zero cost.** Every occurrence was cleared by `retry-conditioning-frame` on the dependent Shot, with no re-render and no spend. There is now no plausible reading in which leaving this to a manual button is the right trade: the operation is free, local, idempotent, and has never once needed a second try.
  - **The recovery is free and reliable.** `creative-studio.retry-conditioning-frame` with the dependent Shot id recovered **every occurrence**, first attempt, every time. Frame extraction is local work against a video already on disk: no provider call, no spend, no quote. There is no cost argument for leaving it to a human.
  - **Nothing reports it.** No badge, no count, no notification. Each one was found only because the owner happened to open that Beat's panel. Two sat stalled for an unknown period while the rest of the film rendered around them and the top-level counts kept climbing, so the project looked healthy.
  - **The stalled state is visually indistinguishable from the healthy one.** `waiting_for_conditioning` is the correct, common status for a Shot legitimately queued behind its predecessor — in this run 17 Shots held it at once, all fine. A Shot stalled behind a _failed_ extraction shows the same status. There is no way to tell "waiting its turn" from "waiting forever" without inspecting `frameExtractions` in the store.
  - **Why P1.** Silent, frequent, permanent without manual intervention, and it strands up to `STUDIO_MAX_SHOTS_PER_BEAT - 1` paid-for Shots per occurrence. The user has already authorized and, in the cascade case, is waiting on work that will never run. Two of six Beats in one film means a long project is more likely to hit it than not.
  - **Fix direction.** Retry failed extractions **automatically**, with a bounded attempt count and backoff, both on resume and when the failure occurs — the operation is free, local, idempotent, and empirically succeeds on the first retry. The minimal change is to stop skipping `failed` in `resumeConditioningFramesV2` and give each extraction an attempt counter so a genuinely broken video cannot loop. Where attempts are exhausted, the Shot must **report** it: a chain stalled on a dead frame cannot keep wearing the same `waiting_for_conditioning` label as a healthy queue.
  - **Do not weaken.** Keep extraction verification strict — `currentConditioningInput` (`chain.ts:218-227`) validates the extraction's id, status, owning Shot, take asset and endpoint before use, and that is what stops a wrong frame conditioning a Shot. This is about retrying a failed extraction and surfacing an exhausted one, not about accepting an unverified frame.
  - **Related but distinct from BUG-133.** BUG-133 is an extraction that is **never created**, because a chain head was rendered alone; `retry-conditioning-frame` returns `invalid_payload` there and recovery costs a paid re-render. This is an extraction that **was created, ran, and failed**; the same call succeeds and costs nothing. The two share a symptom — a Shot that never dispatches — and have opposite remedies, which is a good reason for the UI to distinguish them.
  - **Fixed.** Continuity-frame records now carry a durable three-attempt counter. Resume includes failed records below the bound with 250ms/1s backoff, immediate post-render failure enters the same recovery path, verified recovery advances exact waiters, and an exhausted extraction remains a surfaced failed conditioning record rather than looping.
  - **Verification.** Media-store tests prove first-retry recovery and exact waiter-ready state, permanent decoder failure stops after three durable attempts and cannot restart on another resume, and validation rejects impossible attempt/status combinations. Existing conditioning-failure projection and recovery coverage retain the distinct failed-frame UI path.

- [x] **[BUG-138][P2][Creative Studio] Reference images are cover-cropped into a landscape box, so a 9:16 project can never see its own references whole — and full screen does not undo it** — found 2026-08-26 by the owner on a vertical Trung Thu project (`65cb2f41…`)
  - **Actual.** The owner opened a character reference full screen and saw an almost empty cream field with the tops of four hair buns along the bottom edge, and reported the image as cropped. The image is **not** cropped: the stored asset is 768×1376 (9:16 portrait, matching the project's `aspectRatio: '9:16'`) and contains the full figures with margin above and below. Every pixel is present on disk. The crop is applied at display time.
  - **Root cause, exact.** `References.module.css:114-118` sets on the preview image:
    `inline-size: 100%; block-size: 100%; object-fit: cover;`
    `cover` fills the box and discards the overflow. The box is effectively landscape, so a portrait asset is matched on width and loses its top and bottom. `References.module.css:210-215` compounds it for the history strip with a hardcoded `aspect-ratio: 16 / 10` plus the same `object-fit: cover`, so no portrait reference can be reviewed in history either.
  - **Full screen inherits the crop.** `FullscreenMediaFrame.module.css` styles only the wrapper — `.frame:fullscreen { inline-size: 100%; block-size: 100%; }` — and never overrides `object-fit`. The `cover` rule from `.preview img` therefore survives into full screen, which enlarges the same slice instead of revealing the frame. This is the one surface whose entire purpose is judging the whole image, and it is the one that fails hardest.
  - **This contradicts an approved specification.** The First Frames panel handoff, owner-approved 2026-08-26 and committed at `docs/design/creative-studio-3-first-frames-panel.md`, states of the full-screen view: _"the image sits contained, never cropped, so judgement happens on the whole frame."_ Whatever is built for First Frames must not inherit this rule, and the existing References surface should be brought in line rather than left as a counter-example.
  - **Why it matters beyond aesthetics.** A reference is the thing the user is asked to _judge_ before it conditions many Shots. In this project the cropped slice hid that the reference is a **four-view character turnaround** — the BUG-132 grid — because the four figures sat outside the visible band. A display that hides the defect the user is meant to catch turns a review step into a rubber stamp.
  - **Not portrait-specific in principle.** `cover` crops any asset whose ratio differs from its box. Portrait simply makes it total. A 16:9 asset in the `16 / 10` history box loses about 10% of its height silently, which is the same defect at a size nobody notices.
  - **Fix direction.** Use `object-fit: contain` for reference previews, history thumbnails and anything shown full screen, and let the box letterbox. Where a filled tile is wanted for layout density, keep `cover` on the small grid tile only and guarantee `contain` the moment the image is opened for judgement. Drive the preview box from the project's `aspectRatio` rather than a hardcoded `16 / 10`, so a 9:16 project gets a 9:16 frame.
  - **Do not weaken.** Do not "fix" this by upscaling or letterboxing the stored asset; the file is correct and must stay untouched. This is a CSS presentation defect only.
  - **Fixed.** References now receives the authoritative project aspect ratio and maps all five supported ratios to the current and history review frames. Current, historical and fullscreen images use `contain`; no stored media or provenance changes.
  - **Verification.** References DOM coverage proves portrait and square projects update the exact review ratio, while the CSS contract proves current, history and fullscreen paths remain contained rather than cropped.

- [x] **[BUG-139][P1][Creative Studio] The Director refuses to build the storyboard, claiming a permission it actually has, and never attempts the operation** — found 2026-08-26 by the owner on the `MY MY Studio` Trung Thu project (`65cb2f41…`)
  - **Actual.** Asked directly — _"just go one and make the video for me"_ — the Director replied that it wanted to but **"Studio hiện không cho mình quyền tạo shot hoặc khởi chạy render video trong project này"** ("Studio does not currently give me permission to create shots or start video renders in this project"), then handed the work back as a manual checklist for the owner to perform in the UI. The project still has **0 beats and 0 shots**.
  - **The claim is false for shots.** `directorCommandContracts.ts:296-303` is the frozen capability policy, and it classifies the relevant gestures as permitted:
    `add_beat: 'proposal'`, `add_shot: 'proposal'`, `edit_beat: 'proposal'`, `edit_shot: 'proposal'`, `apply_coverage: 'proposal'`.
    `proposal` means the Director authors the change and the owner accepts it — it is the designed path, not a denial. Only `operation_not_permitted` is a refusal, and none of the storyboard gestures carry it.
  - **It never tried.** All four proposal slots on disk are empty — `proposals/pending`, `proposals/slots`, `proposals/decisions`, `proposals/commits` all contain **0 files** — and the dev log records **no** `operation_not_permitted` and no Director command failure for this project. The Director did not attempt an operation and get refused; it declined pre-emptively on a premise it invented.
  - **The same Director does this correctly elsewhere.** On two other projects in the same session it authored complete **25-shot, five-Beat storyboards** as proposals, which the owner reviewed and accepted. So the capability demonstrably works and the refusal is inconsistent rather than environmental. Routes are also already set on this project (`imageRouteId` and `videoRouteId` both non-null), so no missing-engine condition explains it either.
  - **Half the claim is correct, and must stay correct.** The Director genuinely cannot start a render: paid generation is gated behind an owner-confirmed quote by the spend-governance ruling, and nothing here should change that. The defect is that a true statement about **render** was extended into a false statement about **authoring**, which are governed by different policies.
  - **Why P1.** Authoring the storyboard is the Director's central purpose. Refusing it converts the product's premise — describe a film in conversation and have it built — into a manual data-entry checklist, and does so while asserting a restriction the code does not impose. The owner cannot discover the truth without reading the capability table. This is worse than BUG-129: there the Director waited for a human step that did not exist; here it declines work it is authorised to do.
  - **Fix direction.** The Director's rules must state its capability table accurately: authoring gestures are `proposal` and it should emit them; only `edit_project`, `set_routes`, `set_seed_still`, `set_hard_cut`, `trim_shot`, `promote_board_panel`, `set_rules`, `set_reference_prompt`, `select_reference_image`, park/restore and `undo_last` are genuinely denied, and render is gated rather than forbidden. Where it truly cannot act it should name the specific operation and say what the owner must do; it must not generalise one denial into a refusal to author. If a capability summary is injected into the Director's context, it should be generated from `STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2` rather than written by hand, so the two cannot drift.
  - **Do not weaken.** Do not grant the Director direct writes for `add_shot`/`add_beat` to solve this; `proposal` is the correct disposition and owner review of structural changes is deliberate. The fix is accurate self-description, not more privilege.
  - **Fixed.** The exhaustive disposition map now lives in shared authority used by both Main enforcement and the Director's generated capability rules. The Director is explicitly told to author Beats, Shots and coverage through `propose_storyboard`, never to describe that reviewed path as denied, and to stop separately at human-controlled paid generation.
  - **Verification.** Contract tests retain the exact 33-operation frozen policy and denial paths. Opening-turn tests prove every operation appears under its derived disposition, Beat/Shot authoring is proposal-capable, and the same rules still forbid starting or confirming spend.

- [x] **[BUG-140][P1][Creative Studio] A film that needs no references can never render — the reference plan stays `unplanned`, so no Shot can ever be bound** — found 2026-08-27 on a fresh project created to exercise the new panels
  - **Actual.** A new project (`Panel Check`, 1 Beat, 3 Shots, 0:30 of 0:30, both routes `ready`) could not reach paid generation. Pricing refused with
    `pricing_refused / invalid_reference`, details `{"kind":"reference_binding","shotId":"ride_01","reason":"unassigned"}`, and every attempt to set a binding — including an explicitly empty one — was rejected.
  - **The product tells the user nothing is needed.** The redesigned References panel reports, correctly, _"This story has no named characters. Backgrounds can be reviewed now."_ and _"No recurring backgrounds are required."_ The brief describes a lone faceless cyclist; there is no named character and no recurring place. Nothing is missing, and the panel says so.
  - **Root cause.** `mutations/index.ts:1438-1444` guards the binding mutation with
    `draft.referencePlanStatus !== 'planned' → fail('invalid_operation')`. A project that never needed a reference plan never leaves `referencePlanStatus: 'unplanned'`, so **`set_shot_reference_binding` can never succeed**, `referenceBinding.status` stays `unassigned` for every Shot, and `estimate.ts` refuses the quote. Verified on disk: `referencePlanStatus: 'unplanned'`, `references: 0`, all three Shots `unassigned`, both routes set.
  - **The dead end is complete.** There is no user path out: the References panel offers `Add place` but not `Add character` (correctly — BUG-139's ruling), and adding a place the film does not need, purely to unlock binding, is a workaround rather than a fix. Nothing in the UI indicates that the _absence_ of references is what blocks generation.
  - **The refusal wears a generic label.** `set_shot_reference_binding` fails with `storage_error` / `conversation.creativeStudio.errors.storage` — nothing was read or written, and storage is not involved. This is the BUG-062 pattern again, on a mutation this time. Note the contrast: the _pricing_ refusal on the same project now carries structured `details` naming the exact Shot and reason, which is the error-class fix working well — the mutation path did not get the same treatment.
  - **Why P1.** A whole legitimate class of film — anything without named characters or recurring places — cannot be generated at all, and the product actively tells the user that this state is fine. It is silent, permanent without a workaround, and reachable by simply describing a story that has no cast.
  - **Fix direction.** Treat "no references required" as a **planned** state rather than an absent one: a project whose reference plan is deliberately empty should reach `referencePlanStatus: 'planned'` — either on explicit confirmation from the References panel ("nothing to reference for this film") or automatically once the Director's plan resolves to zero entries. Binding must then accept an empty binding (`characterReferenceIds: []`, `backgroundReferenceId: null`) and mark it `ready`. Separately, give the mutation a cause-specific failure — an unplanned reference plan is not a storage error.
  - **Do not weaken.** Keep the guard's intent: a Shot must not bind references that do not exist or are unapproved. The defect is that _no references at all_ is treated as _not yet ready_ rather than as a legitimate, complete plan.
  - **Live reproduction preserved.** Project `a72c7f92_6a43_4858_8bdc_f6fc9fea8f30` (`Panel Check`) is retained **unmodified** on the owner's machine at
    `~/Library/Application Support/Forge-Dev-2/config/creative-studio/a72c7f92_.../` specifically as the repro case — do not repair it. State: `referencePlanStatus: 'unplanned'`, `references: 0`, 1 Beat, 3 Shots all `referenceBinding.status === 'unassigned'`, `imageRouteId` and `videoRouteId` both set and reporting `ready`. It is the **only** project in the library, so the runtime activates cleanly and the dead end is reachable in one click from a fresh launch.
  - **Verification for whoever fixes it.** Against that project, unchanged: binding a Shot must succeed, and `Generate Shot 1` must reach a priced quote — without adding a reference the film does not need.
  - **A candidate fix is pushed and awaiting review on branch `fix/studio-empty-reference-binding`** (2026-08-27, not merged — the shared branch was in active use). It relaxes one guard in `mutations/index.ts`: an `set_shot_reference_binding` whose decision is empty (`characterReferenceIds: []` **and** `backgroundReferenceId: null`) no longer requires `referencePlanStatus === 'planned'`, because an empty decision references nothing and so has nothing to validate against a plan. A non-empty binding is still refused while unplanned; two tests cover both directions. Focused suite 39/39, typecheck clean, lint 0 errors.
  - **Verified live end to end, 2026-08-27.** The candidate fix was run in the actual app, not only under vitest. A fresh project (`Light on Water`, `dc0168b3…`) was created with a brief that names no characters and no recurring places — `referencePlanStatus: 'unplanned'`, zero references, three Shots — reproducing the exact dead-end condition. With the fix loaded:
    - binding all three Shots with an empty decision succeeded, each landing `referenceBinding.status: 'ready'` while the plan stayed **`unplanned`**;
    - `prepareSubmission` returned a priced quote (3 minor units for the seed) and `confirmSubmission` accepted it — the entry's stated pass condition;
    - the seed still generated, and a chained submission rendered **3 of 3 Shots, 30.2s against a 30s target, with zero failures** and the continuity chain flowing unaided.
      Total spend for the verification: $1.53. The reproduction project `Panel Check` was deliberately **left untouched** so the pre-fix dead end is still reproducible for review.
  - **Incidentally validated:** a no-reference film is a legitimate case the product previously could not make at all — landscape, abstract and object studies need no canonical characters or recurring places.
  - **Why not the obvious fix.** Adding a UI affordance that calls `set_reference_plan([])` also works — the engine accepts an empty plan and marks it `planned`, verified live — but it is a **one-way door**: `set_reference_plan` is only valid while `unplanned`, and `amend_reference_plan` accepts backgrounds only, so confirming "no references" would permanently prevent ever adding a character to that film. Relaxing the binding guard avoids forcing that irreversible choice. If the panel later grows an explicit "this film needs no references" affordance, it should not be built on `set_reference_plan` until characters can be appended.
  - **Fixed and verified live 2026-08-28.** The `bindsNothing` guard from `012caa7e9` is present at `mutations/index.ts:1464`. Live evidence needing no mutation: three projects — `68af3df4`, `a72c7f92`, `dc0168b3` — each have `referencePlanStatus: 'unplanned'`, **zero references**, **3 shots** and **0 unassigned**. Under the bug a film that plans no references could bind no Shot, so all three shots would be unassigned. Two of them additionally hold 8 and 4 jobs, so they have generated: the entry's "can never render" is disproven directly.

- [x] **[BUG-179][P1][Creative Studio] One unreadable project stops Creative Studio working for every project in the profile** — found 2026-08-30, reproduced and then worked around live
  - **Lane: the service.** The fix is the activation sweep in `directorCommandMailbox.ts` — Director-adjacent by filename, but it is the sweep that installs the graph rather than anything the Director calls, so start there and not in the rail.
  - **Actual.** With `Plateau` (`748ae58b…`) unreadable, a **brand-new, empty, perfectly valid project** showed _"Creative Studio generation is not ready. Open or create a supported project, then try again"_ with `STATUS UNAVAILABLE` in its header. The owner created that project specifically to get away from the broken one and it made no difference.
  - **Proved by removing the cause, not by reading the code.** Moving `Plateau` out of `config/creative-studio/` took the startup log from **4 quarantine lines and 1 `Schema-2 runtime activation failed` to zero of each**, and every remaining project became usable immediately. Moving it back reproduces the failure.
  - **The blast radius is the defect.** One project failing to load is expected and survivable; the failure escaping its own project is not. Every failure line names `748ae58b…` alone, yet the runtime graph is degraded for the whole profile, so the error the user sees is attached to whichever project they happen to open.
  - **It also destroys the diagnosis.** The message points at the project in front of the user, which is healthy, so the natural next step — make a fresh project — cannot work and looks like a second failure. It took most of a day to find the first time precisely because the symptom and the cause are never the same project.
  - **Fix direction.** The activation sweep must tolerate a project it cannot read, the same way the other sweeps already do, so an unreadable project is quarantined without taking the installed graph down with it. Whatever lands, the test is the live one above: hold a broken project alongside a healthy one and confirm the healthy one still generates.
  - **Fixed by `66eef8488`.** `snapshotPendingPage` now passes `tolerateProjectErrors: true`, matching the two sibling sweeps that always did. It was the only one of the three passing `false`, and being the Director processor's pre-start sweep — run by `start()` outside its own try block — its rejection reached `activate()`, whose catch degrades the whole runtime graph. The comment records the trade rather than claiming the skip is free: a skipped project's pending commands are absent from the pre-start set, which costs that one project its ordering, where throwing cost every project the runtime. The test asserts the blast radius, not merely that the call resolves — a healthy sibling's command must still come back — and was verified by reverting the flag, which fails it with the production error.

- [ ] **[BUG-180][P1][Creative Studio] The Director cannot storyboard a film that ends on an end card, and the refusal names neither the Shot nor the reason** — found 2026-08-29 by the owner on the first real use of a fresh project
  - **Lane: Director.** The refusal belongs at the tool boundary in `builtinMcp/studioServer.ts`, where the answer can tell the Director what to draft instead. The card half — naming the subject of a refused proposal — is Workspace, and is the same root as **BUG-187**.
  - **Actual.** The owner asked for an 18-second launch film. The Director drafted 3 Beats and 3 Shots and reported it _"recorded and pending your review"_. The card refused it — **"This proposed change is not valid for the current project"**, Accept disabled. The owner asked for a redraft; the Director produced an equivalent proposal that failed identically. The screen then read **"2 Director proposals cannot be accepted"** with no way forward.
  - **Root cause, from both proposal files on disk.** Each carries exactly one `chainBreak: 'hard_cut'`, on the end-card Shot. `apply_coverage`'s reducer refuses to create a Shot as a hard cut — `(existing === undefined && proposed.chainBreak === 'hard_cut') → fail('invalid_operation')` — and that one operation fails the **entire batch**.
  - **The proposals are not malformed.** Running the real `validateStudioProposedShotV2` over both files returns `valid` for all six Shots: exact key set, duration in range, `chainBreak` one of the two permitted values. **The shape validator accepts `hard_cut` and the reducer then refuses it**, so the Director's tool surface can emit an operation the engine will never apply.
  - **The Director was creatively right.** An end card must not continue from the previous Shot's last frame; a hard cut is exactly what it needs. The product has no way to express that at authoring time.
  - **It loops rather than failing once.** The refusal carries nothing the model can act on, so a redraft reproduces the same operation. Same honesty-of-failure family as **BUG-140**, **BUG-147**, **BUG-158**, **BUG-161** and **BUG-163**.
  - **The card cannot explain it either.** It identifies the proposal by raw UUID and summarises three Beats and three Shots as the single bullet **"Beat"** — the subject is resolved against the project, which is exactly the lookup that cannot succeed for a Beat the batch was going to create.
  - **Workaround.** Redraft with `chainBreak: 'none'` everywhere, accept, then cut the end card free from the Beat panel's continuity control — the owner-only spend-gated path that BUG-165 established as the only live route to `hard_cut`.
  - **Live reproduction.** Project `cecdd13e_293a…`, both records under `proposals/pending/`.
  - **Both halves re-verified live 2026-08-30 on current code, with a proposal made for the purpose.** The Director was asked for one new Beat, `Sign Off`, holding one 6-second end-card Shot as a hard cut. It produced exactly that — `add_beat sign-off` with `apply_coverage … chainBreak: 'hard_cut'` — recorded at the project's current revision 114, so nothing here is stale.
  - **The refusal still fires and still has no guard before it.** `chainBreak` passes the tool's own schema (`studioServer.ts:330`) and dies in the reducer (`mutations/index.ts:1760`). The card reads _"This proposed change is not valid for the current project."_
  - **The card still cannot say what failed: its only subject renders as the bare word `Beat`.** The name it needed — **Sign Off** — was sitting in the proposal's own `add_beat` operation the whole time. `refusalSubject` resolves a Beat's title from `project.beats[id]`, which is precisely the lookup that cannot succeed for a Beat the batch has not created yet.
  - **The adjacent branch was fixed on the same day, which shows how close this is.** `2c99f5e94` added a `reference` subject kind resolving `reference?.label`, three lines below the Beat branch in the same function. Whatever shape that fix takes for Beats — reading the title out of the batch, or passing the operations into `refusalSubject` — the reference case is the precedent.
  - **Contrast worth keeping, observed on one screen.** The same card renders two refusal paths very differently: the stale path says _"derived from revision 3, but the project is now revision 114"_ — specific and actionable — while the invalid path says only that something is not valid, plus a bare noun. The card is not the problem; the reason it is handed is.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — Assembly, film and later modalities.
    - **Rationale:** End-card authoring requires Beats, Shots and continuity, which Pilot 1 does not
      contain. The reducer's hard-cut rule and the proposal refusal language survive the deleted CS3
      views, so the defect is deferred to the phase that restores film composition rather than
      closed at cutover.
    - **Acceptance evidence:** A focused proposal test must create a new end-card Shot with
      `chainBreak: 'hard_cut'`, pass validation and apply atomically; a refusal test must name the
      proposed Beat and Shot plus the actionable reason. The Phase 6 fake-adapter film scenario must
      accept and render a film ending on that hard cut without a redraft loop.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-181][P2][Creative Studio] A pending proposal dies permanently the moment any generation makes progress** — found 2026-08-29, isolated by experiment
  - **Lane: Workspace.** `store.ts`, `proposalReview.ts` and the renderer's accept gates must change together. **Needs a field on `creativeStudioTypes.ts`**, which is shared — announced here rather than discovered in a merge.
  - **Actual.** `acceptProposalV2` requires an exact revision match (`store.ts:7732`). `jobs` and `assets` live **inside** the project document, and every project write bumps `revision` unconditionally (`store.ts:8133`, `:8210`) with an **opt-in** CAS that the job manager does not use. So a job ticking over invalidates a reviewed, paid draft.
  - **Reproduced, not inferred.** A probe seeded a project at revision 2, recorded a proposal at `baseRevision: 2`, then made a write touching **only** job state — `brief`, `beats` and `shots` asserted byte-identical afterwards. `acceptProposalV2` then failed `{"code":"stale_project"}` and stayed failed. A control run with no intervening write accepted cleanly.
  - **Terminal, not a race.** Nothing rebases a pending proposal's `baseRevision`, so the only exit is reject-and-re-propose. The renderer already models it as final: `proposalReview.ts:341-347` returns `status: 'stale'` and `StudioPage.tsx:3600-3607` refuses before it reaches main.
  - **Seen in ordinary use 2026-08-30, not only in the probe.** Two Director proposals on the promotion-video project sit permanently unacceptable — _"This review was derived from revision 3, but the project is now revision 114"_ — with **Accept proposal disabled** and only Reject or Prepare updated proposal left. Nobody deleted anything; the project simply moved on.
  - **Distinct from BUG-160, which names this only as a contributing factor.** BUG-160's fix direction — a persistent pending-proposals affordance — does not address it: a card that never scrolls away still cannot be accepted once the revision has moved.
  - **Fix direction, and why it is not a one-line change.** The fence has to ask whether anything a person **authored** changed, not whether the revision did. `baseRevision` is load-bearing in four more places: `:7753` (the reducer's own CAS), `:7761` (the accepted revision is `baseRevision + 1`, so accepting later would rewind the counter), `:721-722` (`appliedRevision === baseRevision + 1` as a hard invariant) and `:6104`/`:6136` (**crash-recovery replay**). Changing what `baseRevision` means changes how the system recovers from a crash mid-commit on paid work.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 1 for shared authoring authority; Phase 6 for proposal acceptance.
    - **Rationale:** The defect is caused by one revision counter covering both authored state and
      generation activity. Phase 1 must establish the shared authoring fence used by direct Pilot
      actions. When proposals return in Phase 6, their review must bind to that fence rather than the
      storage revision.
    - **Acceptance evidence:** Phase 1 tests must show that job progress, terminal job state and asset
      publication do not move the authoring authority while a genuine authoring change does. Phase 6
      proposal tests must accept after runtime-only activity, reject changed authored inputs,
      preserve monotonic storage revision and pass crash-recovery replay without rewinding state.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-182][P2][Creative Studio] The Beat panel can persist a pure-black poster, permanently replacing a Shot's preview** — found 2026-08-30 on disk, five real instances
  - **Lane: Workspace.** `FirstFrames/index.tsx` and its capture helper.
  - **Actual.** `Mochi Morning` has **3 of 3** thumbnails pure black and `Light on Water` **2 of 3**, all byte-identical (`31aac255…`, 17,713 bytes) against 325,896 bytes for a genuine poster. Every sampled pixel is `(0, 0, 0)`.
  - **Root cause.** `captureStudioVideoPoster` draws the video and calls `toDataURL` immediately, with **no check that anything was drawn**. It is bound to both `onCanPlay` and `onLoadedData` (`FirstFrames/index.tsx:390-391`), and `loadeddata` promises decoded data for the current position, not that a frame has been composited — so the draw can return a flat frame.
  - **Worse than capturing nothing.** `shotMedia` prefers a poster over the video, and the product has no way to invalidate one, so each blank capture pins its Shot to a black rectangle for good. Rendering the `<video>` — the behaviour when no poster exists — is strictly better.
  - **Fix direction.** Refuse a frame that is one flat colour before persisting it, so a bad capture degrades to no poster (recoverable, the tile keeps showing the video) rather than a permanent black one; and capture from a frame that has actually been presented rather than from `loadeddata`. Also worth deciding how an existing bad poster can be cleared — today nothing can.
  - **Half fixed by `f63224449`, and the entry stays open for the other half.** `carriesPicture` now reads the canvas back and refuses a single flat colour, alpha included, sampling ~4,096 pixels at an odd stride — an earlier form of this guard multiplied the stride by 997 and so sampled four pixels of a 720p frame, not the four thousand its comment claimed. Because the capture can now decline, both handlers go through a scheduler that retries on `requestVideoFrameCallback`, which also revives the `canPlay` binding: before the refusal, the `loadeddata` capture always succeeded and marked the key, so `canPlay` returned at its first line and was dead code. The existing test could not have caught any of this — it stubbed the context as `{ drawImage }` and a fixed data URL, so it could not tell a real frame from a blank one; both stubs now return pixels.
  - **Still open: the five posters already on disk.** Nothing in the product can clear or recapture one, so those Shots keep a black preview permanently. `commitCapturedPosterV2` (`mediaStore.ts:4688-4721`) has no null precondition and would already accept a replacement — unlike the provider-poster path — so only the renderer gate at `FirstFrames:397` prevents asking for one. That affordance needs new user-facing text in all twelve locales and is filed as **BUG-195**.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — clip media and film review.
    - **Rationale:** The Beat panel is removed, but the invariant is not: a captured poster may replace
      a usable moving preview only when it contains a presented picture. Phase 6 must carry the
      existing flat-frame protection into the replacement clip surface.
    - **Acceptance evidence:** Media-capture tests must reject opaque and transparent single-colour
      frames, wait for a presented video frame, and leave the current video preview usable after a
      rejected capture. A Phase 6 reload test must prove that no rejected poster was persisted or
      selected as current.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-183][P2][Creative Studio] Blocking messages name a control without saying where it is, and describe an activity the person is not doing** — found 2026-08-29 by the owner in References
  - **Lane: Workspace.** `StudioPage.tsx`, the banner components, and the `en-US` locale.
  - **Actual.** Working in **References**, the owner hit _"Refresh routes for the current project settings before reviewing a cost."_ Their reply was _"no idea about the error message"_.
  - **Three things wrong at once.** _Refresh routes_ is a real button, but it lives in the **More (⋮)** project menu beside the spend-cap fields (`WorkspaceProjectMenu.tsx:1920`), unmentioned. The sentence ends _"before reviewing a cost"_ while the owner was making reference images — this one key is raised from **eight** call sites covering quite different actions and every one shows that same wording. And nothing says what a route is, or why one is missing.
  - **Fix direction.** Say what is missing in the person's terms, put the control in the banner rather than describing its location, and separate the states: a catalogue that was never fetched (refreshing helps) from settings that match no available model (refreshing never will). The renderer can already tell those apart — `routeCatalog === null` never means "fetched and empty" — but the message does not.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 5 — canvas UI and Pilot 1 E2E.
    - **Rationale:** Cost review for a standalone photo can encounter the same missing-route states,
      but the eight CS3 banner call sites are replaced by per-capability canvas feedback. The new
      surface must distinguish an unfetched catalogue from settings that match no route.
    - **Acceptance evidence:** Focused UI tests must render separate copy and actions for “catalogue
      not loaded” and “no compatible route”; the recoverable state must expose its refresh action in
      place and the incompatible state must explain the setting to change. All twelve locales and the
      Pilot 1 route-recovery E2E must pass.
    - **Claimant:** Unclaimed.

- [x] **[BUG-184][P2][Creative Studio] The Director invents places in the UI, because nothing ever tells it what the surfaces are called** — found 2026-08-30 by the owner
  - **Lane: Director tooling.** The fix is a short, accurate surface map inside `openingTurn.ts` — one of the three merge hazards above, so land it on its own and not alongside other rule edits. Filed from the review side because that is where the invented names were caught; the fix is not a UI change.
  - **Actual.** Asked how to accept a proposal, the Director said to open _"the storyboard proposal card in the **storyboard panel**"_ and that it would appear _"beneath or alongside the **storyboard area**"_. **Neither string exists anywhere in the product.** The card is in the right-hand pane under the heading **Reviewed Director output**. The owner asked twice and still had to find it themselves.
  - **Root cause.** The Director's preset rules describe what it may do in detail and say to name where to look, but **zero** references to any real surface name appear anywhere in its instructions. It is asked to give directions around a UI it has never been shown, so it invents plausible ones.
  - **Distinct from BUG-183.** There the app knew the location and did not say it; here the Director cannot know it.
  - **The vocabulary is small and fixed**, which is what makes this cheap: four views named References, Table, Board and Cut; proposals under **Reviewed Director output** on a card headed **Director proposal** with **Accept proposal** / **Reject proposal** / **Prepare updated proposal**; film setup and **Refresh routes** in the **More** menu; **Render…** in the header.
  - **Related, and worth saying in the same breath.** The owner also asked _"can i just say accept"_. The Director correctly said no — acceptance is human-only by design — but it has no tool that could accept, so this will recur for every person who tries the obvious thing.
  - **Fixed by `6eb80d92d`.** `DIRECTOR_PRESET_RULES` now carries a map of the workspace: the four views, the Render button, the menu whose trigger reads **Project**, the _Reviewed Director output_ heading, the _Director proposal_ card and its two buttons, and the chat vocabulary that decides a proposal without touching a button — including that a paid recovery proposal can never be accepted from chat.
  - **Every name was read out of the shipped `en-US` bundle rather than taken from the plan, and that caught one.** The plan called the menu **More**; its trigger reads **Project**. Writing it down unchecked would have taught the Director a wrong name through the very fix meant to stop wrong names.
  - **The guard is as much the fix as the map.** A parameterised test asserts each name appears both in the rules and as a string the product ships — the coupling that was missing, so renaming a control now fails a test instead of silently making the Director wrong. It also pins the instruction to describe the action when a name is not known, without which an incomplete map becomes a new source of invented names.
  - **Deliberately not covered:** what sits inside the Project menu. Those strings could not be verified cheaply, and asserting them unchecked is the mistake this entry is about.

- [x] **[BUG-185][P2][Creative Studio] A project written before a schema bump becomes permanently unopenable, is reported as corrupt, and cannot be repaired by clearing files** — found 2026-08-29, retested 2026-08-30
  - **Lane: Workspace.** Only the diagnosability half is actionable — reporting a legacy record as corrupt. The unopenability itself is accepted cost under the owner's test-data ruling and is not work.
  - **Actual.** `Plateau`'s whole proposal family is schema **5** against a current **6** (`STUDIO_PROPOSAL_SCHEMA_VERSION_V2`, bumped by `916e8e51c` with no migration). The project is reported as a **corrupt manifest**, and it is the cause of **BUG-179**.
  - **"Corrupt" is wrong and costly.** `sidecarSchemaV2` already separates a legacy record (`unsupported_prototype_schema`) from a damaged one (`invalid`), but the reconciler reports both as **malformed**, so a routine schema bump is indistinguishable from storage corruption in the log. That misdirection is most of why BUG-179 took a day to find.
  - **Clearing the offending files does not converge — measured.** Removing the 12 residue files from `proposals/slots/` and `reference-requests/pending/` moved the error from _"pending publication residue is malformed"_ to _"**proposal** publication residue is malformed"_. An earlier attempt cleared two guards and reached a third. Every record in the family is schema 5, and the subsystem validates them all, so there is no small set of files to remove.
  - **Scope note.** Migration is deliberately not done during development while every project is throwaway test data, so a project becoming unopenable is an accepted cost. What is **not** accepted is BUG-179's blast radius, or reporting a legacy record as corrupt.
  - **Current state.** `Plateau` is held aside at `config/creative-studio-held-aside/748ae58b…` — 154 files, 137 MB, all 48 hardlinked files intact. It remains BUG-165's only reproduction.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 1 for the exact classifiers; Phase 3 for isolated runtime containment.
    - **Rationale:** Clean cutover intentionally makes schema-5 projects unsupported; it must not
      describe that expected result as corruption. Exact schema-6 validation must continue to
      distinguish unsupported legacy data from damaged current data without adding migration or
      compatibility defaults.
    - **Acceptance evidence:** Phase 1 decoder and reconciliation tests must classify a valid schema-5
      project as `unsupported_prototype_schema` and malformed schema-6 data as invalid. Phase 3 must
      quarantine each with distinct diagnostics while a healthy schema-6 sibling opens and runs. No
      schema-5 record may be rewritten or defaulted.
    - **Claimant:** Unclaimed.
  - **Fixed by `e1042cb7c`.** The schema-6 Pilot store now recognizes the complete, internally
    consistent composition-2 / authoring-fingerprint-1 clusters written before reference
    conditioning and reports them as **Unsupported** without accepting, defaulting, or rewriting
    them. Unknown or mixed nested versions remain **Quarantined**. The regression starts with a real
    confirmed generation record, rewrites every persisted version replica to the historical pair,
    verifies the manifest remains byte-for-byte unchanged, and separately proves that one mixed
    replica fails closed while a healthy schema-6 sibling still opens.

- [x] **[BUG-186][P3][Creative Studio] The first-frame viewer's counter is painted over by the close button** — found 2026-08-29, measured in the running app
  - **Lane: Workspace.** One rule in `FirstFrames.module.css`.
  - **Actual.** The viewer's top line puts a label left and the frame counter right. Arco positions a Modal's close button absolutely in that same corner, so the two overlap: `1 of 1` ran from x1206 to x1242 while the close icon began at x1230 — a 12px overlap eating the counter's last character. With ten frames it would eat the total.
  - **No layout inside the row can fix it.** The row is a flex `space-between`, so both children are placed correctly relative to each other; the close button is outside that flow. The corner has to be reserved — `.viewerTopline` currently sets `padding: 2px 6px` and nothing that accounts for the control.
  - **Fixed by `66eef8488`.** `.viewerTopline` now reserves the corner with `padding-inline-end: 24px`, putting the counter's right edge 44px in against an icon whose near edge is at 32px. Logical rather than physical on purpose: fa-IR is one of the twelve locales and Arco flips the close button under RTL (`right: initial; left: 20px`), so `padding-right` would have held open the corner the button had just left. Asserted against the stylesheet, since jsdom applies no CSS-module rules.

- [ ] **[BUG-187][P2][Creative Studio] A proposal is identified only by a raw UUID, in both the card and the Director's prose, and that id appears nowhere else a person can see** — found 2026-08-30 by the owner
  - **Lane: split.** The card is Workspace (`DirectorProposalCard`); the Director repeating the id in prose is Director lane and belongs with **BUG-184**, since both are about what the Director may say. Neither half fixes the other.
  - **Actual.** The review card's first line is _"Proposal ID: `0a00e892-4ce7-44e6-925c-6cc7408b3615`"_, and the Director repeats the same string in chat: _"The storyboard proposal is recorded and pending your review (Proposal `0a00e892-…`)"_. The owner's words: **"Proposal ID does not make any sense."**
  - **It identifies nothing.** That id appears on no Beat, no Shot, nowhere in the Table, Board or Cut. With one proposal it is noise; with two it is the only thing distinguishing them, and it is 36 characters of hex.
  - **The card knows enough to name it properly.** It already renders _"Based on revision 3"_ and _"6 proposed edits"_, and the proposal's own payload carries the Beat titles it would create. A person deciding whether to accept needs the shape of the change — _"3 Beats, 4 Shots, 16 seconds"_ or the Beat names — not the primary key.
  - **Same root as the refusal case in BUG-180**, where a rejected proposal's subject rendered as the bare word "Beat": both resolve identity against the project, which cannot name something the proposal has not created yet.
  - **Still present 2026-08-30**, on three cards at once — two stale proposals and one freshly refused — each headlining a full UUID. Unchanged by `2c99f5e94`, which improved refusal _subject_ naming without touching the card's identity line.
  - **Fix direction.** Lead the card with what the proposal does and keep the id for the machine — a `data-testid`, a copy affordance, or the details view. The Director should name the draft the way it described it, never the id; it has no way to know the id means nothing to the reader.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — post-Pilot Director proposals and review.
    - **Rationale:** Pilot 1 has no proposal-producing operation: photo preparation produces a quote
      and Piece rename is direct. When proposals return with later modalities, each must be
      identifiable to a person by its subject and effect; the immutable proposal ID remains machine
      provenance rather than the primary label.
    - **Acceptance evidence:** Proposal-card and Director-transcript tests must identify a proposed
      change by its Piece handle and concise effect, including a Piece not yet in the project. The raw
      UUID may appear only in details or machine attributes. Historical proposals must remain
      distinguishable without reading UUIDs, while the approved pending-proposal rule prevents two
      active proposals from competing.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-188][P2][Creative Studio] Accepting a proposal and then asking the Director about it reports an error for something that succeeded** — found 2026-08-30 by the owner
  - **Lane: Workspace.** `StudioPage.tsx:3697-3700` and the locale.
  - **Actual.** After the owner accepted the storyboard — which worked; the project went to **revision 4** with the Beat and its 4 Shots in the Table, and `proposals/decisions/` records `accepted` — the workspace showed the red banner **"There is no pending Director proposal to act on."**
  - **Mechanism.** `StudioPage.tsx:3697-3700`: a chat-driven decision with no explicit `proposalId` filters the catalogue to `status === 'pending'`, finds none because the proposal was just accepted, and raises `chatNoPending`. The sentence is literally true and completely misleading — the proposal the person meant did not go missing, it went through.
  - **Why it reads as failure.** It is rendered in the error banner, in the same place and styling as real blockers, immediately after a successful action. Nothing on screen says the accept worked; the Director's own message above still says "recorded and pending your review", which is stale history and correct, so the only fresh signal contradicts the outcome.
  - **The app can tell the difference.** A decision record exists for that proposal with `status: 'accepted'`, so "already accepted" is distinguishable from "never had one" without new state.
  - **Fix direction.** When a decision intent finds nothing pending but a recent decision exists for it, say so and say what changed — the Beats it added — rather than reporting an absence. Same honesty-of-failure family as **BUG-162**: the app has the facts and reports the wrong one.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — post-Pilot Director proposals and review.
    - **Rationale:** Pilot 1 deliberately creates no proposal. When a later approved operation brings
      proposals back, its renderer resolver must distinguish an already accepted decision from an
      absent proposal and report the recorded outcome and affected Piece directly.
    - **Acceptance evidence:** A focused decision-intent test must accept a proposal, repeat the
      decision request, and return an informational “already accepted” result naming the created or
      changed Piece. The error treatment must be reserved for a genuinely unknown proposal, and the
      accepted decision must remain correct after reload.
    - **Claimant:** Unclaimed.

- [x] **[BUG-189][P2][Creative Studio] The bordered view surface is shrunk to the window while its content is not, so every view's content spills outside its own box** — found 2026-08-30 by the owner, measured in the running app
  - **Lane: Workspace.** `Workspace.module.css`; verify all four views, since the surface is shared.
  - **Actual.** On the Board with two Beats, the bordered card that draws each view's surface measures **779px tall while its own content is 1649px** — `scrollHeight` 1649 against `clientHeight` 778. Its border, radius and background therefore paint around only the first half of the view, and the rest of the Beat cards sit outside it with no box around them. The owner's words: \_"the outer boxes do not cover all content."\* Measured the same way on the Cut.
  - **Root cause, confirmed from computed style, not inferred.** `.viewSurface` is a flex item of `.workScroll` (`display: flex; flex-direction: column; overflow: auto`), and it carries **`flex-shrink: 1`** — the default — with no `overflow` of its own. `.workPanel` above it is `flex: 1; overflow: hidden`, so the column has a bounded height and the flex algorithm compresses the surface to fit it. Content is not compressed, and `overflow: visible` lets it paint straight through the border.
  - **The scroll is on the wrong element for the border to follow.** `.workScroll` is what scrolls (`scrollHeight` 1678 against `clientHeight` 835), so scrolling moves the content past a border that stays the size of the window. The card is not a card so much as a 779px-tall frame the content happens to start inside.
  - **Why it reads as broken rather than as scrolling.** Every Beat below the fold appears un-carded, and the surface's own background stops mid-view, so the second Beat looks like it belongs to a different container. On the Board this is most of the screen: the second Beat card ends at y=1605 against a surface bottom of y=908.
  - **Fix direction.** The surface should take its content's height and let the ancestor scroll the whole card — `flex-shrink: 0` (or `flex: none`) on `.viewSurface` is the one-line form. If instead the card is meant to stay window-height and scroll internally, it needs its own `overflow` and the ancestor's must come off; what it cannot do is have neither. Worth checking every view, since the surface is shared by References, Table, Board and Cut.
  - **Fixed by `66eef8488`.** `.viewSurface` is now `flex: 0 0 auto`, so it takes its content's height instead of being compressed to the window. `min-block-size: 220px` stays as the empty-state floor — harmless once the item cannot shrink. Deliberately not given its own `overflow`: `.workScroll` already scrolls, and a second scroller here would nest two.

- [ ] **[BUG-190][P2][Creative Studio] A newly added built-in Director tool stops the Director dead on a permission prompt, for a read it is told to make routinely** — found 2026-08-30 in live testing
  - **Lane: Director.**
  - **Actual.** Asked to inspect a conditioning frame, the Director called `studio_get_conditioning_frame` and then sat at **`Thinking 3m 59s`**, blocked on _"I'd like to run a command … Choose an action: Yes, allow once / Yes, allow always / No"_. It resumed and completed the moment the prompt was answered.
  - **Why it matters more than an ordinary prompt.** The tool is read-only — it reads one frame out of the project's own directory — and `openingTurn.ts` now instructs the Director to call it **every time it revises a chained Shot after a failure**, which is the common case BUG-165 is about. A confirmation on every repair attempt trains people to click through MCP permission dialogs, which is exactly the habit the dialog exists to prevent.
  - **What is established.** The prompt fired for a **new** tool on a built-in server whose other tools (`read_storyboard`, `propose_storyboard`, `studio_apply_edits`) had been running all session without prompting. WePrompt never sets `AUTO_APPROVE_MCP_SERVERS`; the constant appears once in the tree, in a comment in `builtinCapabilities.ts:224`, describing AionCore behaviour.
  - **What was not established at filing.** Where the prior approvals were remembered — that state is AionCore's, not a file in the profile — and whether this was per-tool, first-use-per-server, or something else. The runtime-path investigation below resolves that mechanism; the original live observation remains solid.
  - **Runtime-path investigation 2026-08-30.** The Director uses Aionrs, not ACP. Aionrs presents every MCP
    proxy call to approval as the single `mcp` category, so **Allow always** covers mutating Studio
    tools and external MCP tools too. ACP's name-based auto-approval path is not involved. WePrompt's
    session descriptor carries no backend-authenticated trust or read-only approval identity, and the
    renderer cannot safely manufacture one.
  - **Permission-copy payload verified 2026-08-31.** A loopback-only real Director run crossed Aionrs,
    the built-in Studio MCP server, WebSocket delivery, and the renderer. The pending payload carried
    `command_type: "mcp"`, `action: "studio_get_project_status"`, and
    `description: "MCP aionui-creative-studio/studio_get_project_status: {\"detail\":false}"`; its
    permission card rendered **I'd like to use a tool**, not the exec-path copy. This closes the
    diagnostic-copy uncertainty only. The trusted-read consent oracle below remains open. Repeatable
    evidence lives in `tests/e2e/features/workspaces/director-mcp-permission.e2e.ts`.
  - **External prerequisite.** The accepted oracle requires AionCore/Aionrs to propagate both an exact
    backend-authenticated built-in server identity and MCP `readOnlyHint`, then bypass consent only
    when both match. An external or mutating tool must still prompt. That needs an AionCore/Aionrs
    release followed by WePrompt pin/checksum/provenance updates; it cannot be completed on this
    repository branch alone.
  - **Unsafe shortcuts rejected.** Do not auto-click the renderer prompt, trust the bare server name,
    accept a caller-forgeable `trusted` flag, approve the generic `mcp` category, or put the Director
    into a global permissive mode. Each would grant more authority than this read requires and fail
    the external-tool acceptance case.
  - **Fix direction.** A built-in server's tools should not need per-tool consent, or adding a tool to a trusted built-in should not silently reintroduce a prompt. Whichever way it lands, a Director blocked on consent must not look like a Director that is thinking.
  - **CS4 triage**
    - **Disposition:** Fix before CS4.
    - **Destination:** Phase 5 entry prerequisite — Director command integration and canvas cutover.
    - **Rationale:** Phases 1–4 register no production Director MCP tool and may proceed while the
      external trust contract is developed; Phase 1's Director-facing surface remains provisional.
      Phase 5 must not freeze the Director command surface, add a built-in tool, or cut the Director
      over until routine trusted reads can bypass consent without granting external or mutating MCP
      calls the same authority.
    - **Acceptance evidence:** An integration test must call an existing and then a newly registered
      read-only tool on the trusted built-in Studio server without a per-tool consent prompt, while an
      equivalent untrusted external tool still requires consent. A live Director run must execute the
      conditioning-frame read without pausing for approval.
    - **Claimant:** Unclaimed in WePrompt — the identity-bound AionCore/Aionrs contract and reviewed
      release must exist first; claim the Phase 5 pin and integration separately when it does.

- [ ] **[BUG-191][P2][Creative Studio] A Director turn can be blocked on a prompt for minutes with no sign of it anywhere in the workspace** — found 2026-08-30 in live testing
  - **Lane: Director.**
  - **Actual.** With the Creative Director rail collapsed, a turn ran, called a tool, and stopped on a permission prompt for **almost four minutes**. The workspace showed nothing: no badge on _Show the Creative Director_, no notice, no change to the Table. The message had been sent and accepted — the composer cleared — so from outside the rail the turn had simply vanished.
  - **The rail was not merely scrolled away, it had no layout at all.** Its composer was still in the DOM and still accepted a message; the rail contributed **zero characters** to the page's rendered text. So a person can send to the Director, collapse the rail, and have no way to learn that it is waiting on them.
  - **Why it compounds.** The thing it was waiting for was a consent dialog (**BUG-190**) that only exists inside the rail. Anyone who collapses the rail to see the Table — the natural thing to do while the Director works — cannot discover why nothing is happening.
  - **Fix direction.** The rail's toggle needs to carry state: a Director that is thinking, and especially one that is blocked on the person, should be visible from the workspace. "Blocked on you" and "working" are worth distinguishing; the first is the only one that will never resolve on its own.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 5 — retained Director rail and canvas shell.
    - **Rationale:** The collapsible rail survives the cutover, so its hidden working and blocked
      states remain observable only if the workspace toggle projects them. A prompt requiring human
      action must be distinct from ordinary in-flight work.
    - **Acceptance evidence:** Renderer tests must show `working` and `blocked on you` indicators on
      the collapsed-rail toggle, clear them at the correct terminal state, and reopen the rail to the
      blocking control. The Pilot 1 browser E2E must collapse the rail during a blocked turn and
      verify that the workspace still exposes the required action.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-192][P2][Creative Studio] The Director's composer advertises `@` file references, in a conversation whose workspace is empty by construction** — found 2026-08-30 by the owner
  - **Lane: Director.**
  - **Actual.** Typing `@wepr` in the Director composer returns _"The search result is empty."_ It always will. The composer's own hint reads _"Type / for commands, **@ to reference files**, ↑/↓ for message history"_ (`conversation.json:693`), and `@` searches the conversation's workspace — but a Studio Director conversation is created with `is_temporary_workspace: true` and a scratch directory that never receives user files.
  - **Verified on disk.** The workspace for this project's Director (`096873f9`) is `~/.aionui-dev-2/conversations/2026/08/29/aionrs-temp-096873f9/`, and it contains exactly one entry: a `.aionrs` directory. No user files, so `responseSearchWorkSpace` has nothing to match against, in this or any Studio conversation.
  - **What the owner was reaching for does not exist.** They typed `@wepr` next to a **WePrompt Premium** place carrying three photos, plainly expecting to reference it. Studio references, places, Beats and Shots are project entities, not workspace files, and `@` cannot reach any of them. The affordance offered is the one thing it cannot do; the thing the person wants has no affordance.
  - **Why it is worth more than hiding the hint.** The Director already talks about Shots and references by name in prose, and **BUG-187** is the same gap from the other side — a proposal identified by a raw UUID because nothing names project entities to the person. A `@` that completed Shot ids, Beat titles and reference labels would close both.
  - **Fix direction, cheapest first.** Stop advertising what cannot work: the hint is shared chat chrome, so the Studio rail needs its own. Better: point `@` at the project's own entities rather than the empty workspace. Note the composer is reused from the chat surface (`useSendBoxDraft`), so the hint and the search behaviour are both shared — changing them for Studio must not change them for ordinary chats.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 5 — Piece handles and Studio composer integration.
    - **Rationale:** Studio conversations intentionally have no user-file workspace, so advertising
      file completion is permanently false. CS4 supplies project entities with human handles, which
      the Studio composer can complete without changing ordinary chat file references.
    - **Acceptance evidence:** Studio composer tests must omit the empty-workspace file hint and
      resolve Piece handles from the current project, including Unicode handles and aliases. An
      ordinary chat regression test must retain file completion, and the Pilot 1 E2E must reference a
      Piece from the Director composer without exposing an internal ID.
    - **Claimant:** Unclaimed.
- [x] **[BUG-193][P2][Creative Studio] Review playback starts muted in every project, and the control that turns sound on reads as a status label rather than a button** — found 2026-08-30 by the owner, who reported the film had no audio
  - **Lane: Workspace UI.** `components/PlaybackAudio/index.tsx` and the `playbackAudio` locale block; the default lives in `hooks/useStudioPlaybackAudio.tsx`.
  - **Actual.** The owner played an 18-second film and heard nothing, and reasonably concluded the audio was missing. It was not: clicking the orange **Muted** in the transport flipped `video.muted` to `false` and the decoded-audio counter went from **3,986 to 71,406 bytes** during four seconds of playback. The sound was there the whole time.
  - **The audio is real, not a silent track.** `volumedetect` over the project's three shots gives mean **-15.5 / -16.7 / -20.1 dB** with peaks of **-2.6 to -4.4 dB** — ordinary programme level. Every shot carries a 44.1 kHz stereo AAC stream.
  - **Root cause 1: the button's visible text is its state, its action is only in the `aria-label`.** It renders `playbackAudio.muted` = **"Muted"** / `playbackAudio.audible` = **"Sound on"**, while `aria-label` carries `unmute` = **"Unmute"** / `mute` = **"Mute"**. So a screen-reader user is told what the control _does_, and a sighted user is shown only what the state _is_ — a status word sitting between a timecode and a volume slider, which is exactly where a caption would sit. The affordance is inverted relative to who needs it.
  - **Root cause 2: silent is the default, and it is remembered per project.** `DEFAULT_STUDIO_PLAYBACK_AUDIO` is `{ muted: true, volume: 1 }`, persisted under `weprompt.creativeStudio.playbackAudio.v1.<projectId>`. Each project therefore opens silent on its own, so learning the control once does not carry to the next film.
  - **Why this is worth fixing rather than filing as taste.** The feature it disables is _sound-aware review_ — the point of `ce06bb41d`. A reviewer who never finds the toggle reviews every take silently and cannot judge the thing the feature was built to expose. The owner is the person who commissioned it and still read the product as broken.
  - **Note on the default.** Muted-by-default is the right pattern for autoplay on the web, where browsers require it. Nothing autoplays here — playback is behind an explicit **Play film** press — so the constraint that justifies the default does not apply.
  - **Live evidence.** Project `cecdd13e_293a…` at revision 114, three shots, 0:18.
  - **Fixed by `4de19075a`.** The action string is now the button's visible content, and therefore its accessible name, so `aria-label` is dropped rather than duplicating it; `aria-pressed` describes the state being toggled, matching the Play buttons in the same group; and `type='text'` is gone so it carries Arco's default bordered chrome and looks like a control. `DEFAULT_STUDIO_PLAYBACK_AUDIO` is now audible — muted-by-default is correct on the web because browsers refuse to autoplay with sound, and nothing here autoplays. The now-unreferenced `muted`/`audible` strings were removed from all twelve locales. Six unit assertions and two e2e assertions pinned the silent default, one of them in a test name; all were updated.

- [ ] **[BUG-194][P2][Creative Studio] The audio bed is mixed into the exported film but excluded from every in-app preview, so a bed cannot be heard before it is paid for** — found 2026-08-30 while investigating BUG-193
  - **Lane: Workspace UI**, with a question for the service: the preview needs the bed's asset path and the same gain and fade the exporter applies.
  - **Actual.** The Cut transport states it plainly — _"Shot audio only — the music bed is excluded from this preview"_. The Audio bed card immediately below describes a bed as _"trimmed to the film and fades for the final two seconds"_, which is a description of something the reviewer cannot hear.
  - **Confirmed by reading the code, not inferred from the notice.** `bedAssetId` reaches `filmExporter.ts`, where ffmpeg mixes it — `[atakes][abed]amix=inputs=2:duration=first:normalize=0` with `volume=STUDIO_FILM_EXPORT_BED_GAIN` and `afade=t=out` (`filmExporter.ts:1177-1182`). It appears in **zero** playback files: `CutPlayer.tsx`, `BeatPlayer.tsx`, `useStudioPlaybackAudio.tsx` and `PlaybackAudio/index.tsx` reference it not once. The preview and the export therefore disagree about what the film sounds like.
  - **The consequence is spend, not just fidelity.** Choosing a bed, its level against the takes, and where the fade lands are all judgements about the finished film. Today the only way to hear any of them is to render — the reviewer approves audio decisions blind and finds out afterwards.
  - **Not currently reachable, which is why it is P2 and not higher.** No project on disk has a bed selected — `bedAssetId` is `null` on all eight — so nobody has hit this yet. It becomes a live defect the moment the first bed is imported.
  - **Related.** The exported-vs-previewed mismatch is the same family as the preview-fidelity items in **BUG-182** and **BUG-189**: the screen is not showing what the artefact will be.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — sound, film preview and export.
    - **Rationale:** The Cut player is removed, but review must still represent the audio bed that the
      exported film will contain. Sound returns with Assembly and must use the same timing, gain and
      end-of-cut rules in preview and export.
    - **Acceptance evidence:** A deterministic media test must mix a known bed into both preview and
      exported outputs and compare its start, duration, gain and fade against the persisted Assembly.
      The Phase 6 E2E must hear the bed before export, allow an explicit mute that does not alter the
      project, and reload with preview/export timing unchanged.
    - **Claimant:** Unclaimed.
- [ ] **[BUG-195][P3][Creative Studio] A Shot that already carries a bad poster has no way to get a good one** — split out of **BUG-182** on 2026-08-30 when the capture side was fixed
  - **Lane: Workspace UI**, with nothing needed from the service.
  - **Why it is separate.** `f63224449` stops a blank frame ever being persisted again, but says nothing about the five already on disk. Those Shots show a black preview in the Beat panel and on the Board tile, and it is also their `coverAssetId`, so the picture the Shot is known by is black.
  - **The main process would already accept a replacement.** `commitCapturedPosterV2` (`mediaStore.ts:4688-4721`) has no null precondition on the existing poster, unlike the provider-poster path at `:4241`. Only the renderer gate at `FirstFrames/index.tsx:397` — which shows the poster instead of the video once one exists — stops the product ever asking for a new capture.
  - **Which is why the fix is small but not free.** It needs a visible affordance and therefore new user-facing text in all twelve locales, plus a decision about whether recapture is manual or automatic when the stored poster is detected as flat.
  - **Not P2.** It affects five known Shots on one machine and has an operator workaround: delete the poster asset and reopen the Beat.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — clip-block media recovery.
    - **Rationale:** Removing the old viewer does not repair a persisted bad poster. The replacement
      clip block needs a bounded recovery action that can publish a better poster while retaining the
      prior asset and its provenance.
    - **Acceptance evidence:** Focused service and UI tests must replace an existing poster after a
      valid presented-frame capture, keep the old asset in lineage, select the replacement as current,
      and survive reload. A failed or flat recapture must leave the current poster untouched, and the
      recovery action and outcome must be present in all twelve locales.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-141][P2][Creative Studio] A detected variation grid is refused but still charged, and nothing breaks the loop — the user pays per rejection with no way out** — found 2026-08-27 on `Morning Post` (`2f363667…`), immediately after BUG-132's detection landed
  - **The detection itself is correct and is not the defect.** `studioImageHasVariationGridV2` (`mediaStore.ts:486-520`) does exactly what BUG-132's reopened fix direction asked: full-height seam separators **plus** a repeated-subject pass across thirds and quarters, cosine-similarity based, relative to the image's own adjacent-column baseline, with the repeated-layout pass opt-in so ordinary background repetition is not read as a character sheet. It caught a turnaround that the seam-only metric in the original entry provably missed. This entry is about what happens **after** it fires.
  - **Actual.** Generating the `The Postman` character reference produced a multi-panel grid. The panel refused it — _"The generated image contains a multi-panel variation grid and cannot be used as a current first frame or reference."_ — left the reference at `NO PHOTO` / `0 PHOTOS`, and re-enabled `Generate`. The job record shows the outcome:
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 4 for backend containment; Phase 5 for the recovery UI.
    - **Rationale:** The References card is removed, but a provider can still return a variation grid
      for a paid standalone-photo request. CS4 must quarantine that invalid output, bound any retry to
      the reviewed authorization and give the person a way to stop or choose a new quoted attempt.
    - **Acceptance evidence:** A fake-adapter test must return a grid, prove it never becomes the
      Piece's current asset, and prove no unquoted retry or duplicate authorization is created. Phase
      5 UI tests must show the paid outcome, offer one bounded recovery path, and exit the loop after
      cancellation, success or authorization exhaustion.
    - **Claimant:** Unclaimed.

      reference_image failed seed_still_variation_grid spendReceipt: YES

    **The refused generation was billed.** That is defensible in isolation — the provider generated an image and charged for it; only the app declined to use it — but it means every rejection costs money.

  - **And the model reliably produces grids for character references.** Measured across three projects and four independent attempts, with progressively more explicit prompts — including, on this occasion, a prompt that opens _"A single candid documentary photograph, one moment, one camera position. Not a grid, not a contact sheet, not a character sheet, no panels, no repeated figures."_ Prompt mitigation does not work; that was established when BUG-132 was reopened and this is the fourth confirmation. Backgrounds have never gridded.
  - **So the product now has a paid loop.** The reference stays empty, `Generate` is the only lit affordance, pressing it is likely to produce another grid, and each attempt bills. Nothing in the message names the cause as a model behaviour, suggests a different route, or mentions that `Import photo` sits beside the button and always works. The user is left pressing a button at cost.
  - **Why P2 rather than P1.** Nothing is lost or corrupted and the amount per attempt is small (3 minor units); the refusal is protecting the project from a poisoned reference, which is the correct outcome. It is filed because the escape hatch is missing, not because the guard is wrong.
  - **Fix direction.** Three parts, in order of value. **(1) Retry once automatically** on `seed_still_variation_grid` before surfacing anything — generation is stochastic and a second roll frequently is not a sheet; this is the same reasoning that made bounded auto-retry right for conditioning frames (BUG-137). **(2) Say what is actually happening after a repeat**: the model is returning character sheets for this prompt, and `Import photo` is the reliable path — name the remedy, per the error-message class. **(3) Consider not billing the user for it**: a generation the product refuses to hand over is, from the user's side, indistinguishable from one that failed — if the spend cannot be avoided, the receipt should at least be visible and explained rather than silent.
  - **Do not weaken.** Keep the refusal. A grid must never become a current reference or first frame — that is the whole point of BUG-132, and this entry exists because the guard worked.
  - **Live reproduction preserved.** `Morning Post` (`2f363667_3732_4eb9_b427_b5eb808ac4ce`) is retained unmodified: `referencePlanStatus: 'planned'`, two references planned, `The Postman` at `NO PHOTO` after two failed generations (one `submission_unknown`, uncharged; one `seed_still_variation_grid`, charged), both routes `ready`, 0 Beats. Pressing `Generate` on that card reproduces the loop.

- [ ] **[BUG-142][P2][Creative Studio] Every rendered Shot permanently claims `EDITED · NOT YET RUN`, because the composed prompt is compared against the Shot's script** — found 2026-08-27 driving the new Beat panel composer on a completed film
  - **Actual.** On `Light on Water` (`dc0168b3…`, 3/3 Shots rendered, 30s, nothing edited since it was authored), every rendered Shot card shows the **`EDITED · NOT YET RUN`** tag and offers a primary-weighted `Regenerate`. No prompt was ever edited on that project.
  - **Root cause, exact.** `workspaceProjection.ts:573-586`:
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 3 — Main projections over recorded generation provenance.
    - **Rationale:** The CS3 label is removed, but CS4 still needs to distinguish the output produced by
      a recorded request from work edited afterward. That comparison belongs in Main and must use the
      producing job's frozen prompt composition, never compare composed text with an authored script.
    - **Acceptance evidence:** Projection tests must classify an unchanged generated Piece as current,
      then classify it as edited only after an authored input changes. Reload and prompt-profile
      changes must not alter the status of historical output, and the comparison must use the
      producing job's stored composition and revision.
    - **Claimant:** Unclaimed.

      const currentPicturePrompt =
      currentVideo === null
      ? shot.shootingScript
      : (producingJobForAsset(project, shot, currentVideo.id)?.composition?.prompt ?? shot.shootingScript);
      …
      promptChanged: currentPicturePrompt !== shot.shootingScript,

    `composition.prompt` is the **fully composed generation prompt** — brief, rules, instruction profile, the `OUTPUT` block and the shooting script combined. `shot.shootingScript` is the Shot's own text alone. The two are different kinds of string and can never be equal, so `promptChanged` is **structurally always true** the moment a Shot has a current video. Measured on a real job: composed prompt **911** characters, shooting script **251**, never equal.

  - **The correct field is already stored one level down.** `composition.inputs.source.shootingScript` is the script **as fired**, and on the same job it is byte-identical to the Shot's current `shootingScript`. Comparing against that yields the intended `dirty = prompt !== promptRanWith` semantics from the composer handoff.
  - **Main already knows the truth.** `getProjectWorkspace` returns `workspaceStatus.dirtyShots: []` for this project — the main-side derivation (`deriveStudioDirtyShotsV2`, `chain.ts:280-315`) correctly reports nothing dirty. This is a renderer-side projection defect contradicting a correct main-side status, not a disagreement about state.
  - **Why it matters beyond a stray tag.** The composer handoff makes the tag load-bearing: _"Tags are exceptions… so a tag always means something needs attention"_, and an edited prompt is specified to **return primary weight to the button**. So the defect permanently nudges the user toward a **paid re-render** of work that is already correct and current, on every rendered Shot, while simultaneously destroying the tag's meaning — if it is always on, it signals nothing.
  - **Fix direction.** Compare `composition.inputs.source.shootingScript` against `shot.shootingScript`. Fall back to "not changed" when the producing job or its source is unavailable, rather than to `shot.shootingScript` against a composed prompt — an absent record is not evidence of an edit. Consider deriving this from the main-side `dirtyShots` instead, which is already correct and is the authority the rest of the workspace uses.
  - **Do not weaken.** Keep the tag itself and its rule that a tag means attention is needed; the defect is the comparison, not the concept. Note the same projection also computes `promptChanged` at `workspaceProjection.ts:447` from a draft value, which is a different and apparently correct path — do not conflate them.
  - **Live reproduction.** `Light on Water` (`dc0168b3_8386_4cb3_bd59_233afd364ce4`) is retained: 1 Beat, 3 Shots, all rendered, no prompt ever edited. Opening its Beat panel shows the tag on Shot 1 immediately.

- [x] **[BUG-143][P1][Creative Studio] Cancelling a film export during `analyzing` refuses the cancellation and then blames the user's media** — found 2026-08-27 driving the newly landed film export (`13ac6ee99`) on `Light on Water`; **fixed the same day**
  - **Actual.** Pressing Cancel while the export is in its `analyzing` phase does two wrong things at once: `cancelFilmExport` returns `{ status: 'cancellation_refused' }`, so **the UI changes nothing and Cancel looks dead**, and the render then terminates as `{ outcome: 'failed', reason: 'invalid_media' }`. The renderer maps that to `errors.invalidMedia` — _"The Cut contains stale, noncanonical, or invalid media. Review it before exporting."_ The media is fine: the same three Shots exported successfully four times in the same session.
  - **Reproduced twice, with a clean contrast case.** Driven over CDP against `dc0168b3…`, `trimTails: true` (which lengthens the analyzing window by one extra decode per Shot), cancelling the instant the phase reads `analyzing`:

    | Cancel during | `cancelFilmExport` returns | Terminal outcome                                 | User-visible message              |
    | ------------- | -------------------------- | ------------------------------------------------ | --------------------------------- |
    | `preparing`   | `cancelled`                | `outcome: 'cancelled'`                           | `errors.cancelled` — correct      |
    | `analyzing`   | **`cancellation_refused`** | **`outcome: 'failed', reason: 'invalid_media'`** | **`errors.invalidMedia` — false** |

    The `preparing` path proves the cancellation machinery itself is sound; the defect is phase-specific.

  - **Root cause, exact.** `filmExporter.ts:894` ends `probeMedia` with a bare catch:

        } catch {
          return fail('invalid_media');
        } finally {
          await handle.close();
        }

    It converts **any** thrown error into `invalid_media`, including the abort raised by cancellation. That fabricated failure then propagates: `cancelFilmExport` sees `outcome !== 'cancelled'` and reports `cancellation_refused`, so the refusal and the false diagnosis are the same event.

  - **Why P1.** It is a lie about the user's own work, on a control whose entire purpose is to stop safely, and it is trivially reachable — the analyzing window was ~1s on a 3-Shot film but scales with Shot count, so on the 25-Shot 5:00 film it is a wide target. A user who hits Cancel is told their Cut is corrupt and has no way to know it is not.
  - **This is the BUG-062 / BUG-140 class again**, one layer deeper: a specific, known cause being reported under a generic pre-existing code. Note the contrast with the rest of this feature, whose failure copy is unusually honest ("No partial export was published", "Completed project media was not changed") — this one path undoes that.
  - **Fix direction.** Do not catch-all into a diagnosis. Let the cancellation abort propagate as `cancelled` (or rethrow anything that is not a genuine probe failure) so `cancelFilmExport` can settle it as `cancelled`. Reserve `invalid_media` for media that was actually probed and found invalid. The same bare-catch shape should be checked for `child_settlement_failed`, which it also swallows.
  - **No collateral damage.** Verified after both cancellations: no partial export published, no orphaned `ffmpeg` process, no leftover temp files, catalog uncorrupted, project revision unchanged.
  - **Live reproduction.** `Light on Water` (`dc0168b3_8386_4cb3_bd59_233afd364ce4`), 1 Beat, 3 Shots, all rendered. Start an export with `trimTails: true`, poll `get-film-export-status` at ~50ms, and call `cancel-film-export` the first time `progress.phase === 'analyzing'`.
  - **Fixed.** `probeMedia`'s catch now rethrows an already-classified `StudioFilmExportErrorV2` instead of flattening every throwable into `invalid_media`; only genuinely unexpected errors (a malformed ffprobe payload, for instance) still become `invalid_media`. This follows the convention the same file already uses at `filmExporter.ts:607`, which rethrows `child_settlement_failed` for exactly this reason — line 894 simply did not follow it.
  - **Verified by test and live.** A regression test was written first and observed failing with `expected StudioFilmExportErrorV2: invalid_media to match object { code: 'cancelled' }`, then passing: `filmRuntime.test.ts`, _"reports a cancellation during media analysis as cancelled, not as invalid media"_. It aborts from the `analyzing` progress callback, which lands inside `probeMedia` while its child carries the same signal. Live on `dc0168b3…` after the fix, cancelling during **both** phases now returns `{ status: 'cancelled' }` with terminal `outcome: 'cancelled'` and the `errors.cancelled` message. Creative-studio suites 1783/1783, typecheck clean; a post-fix export is byte-identical (30507615) with the project revision unchanged and no orphaned `ffmpeg`.
  - **`child_settlement_failed` was swallowed by the same catch** and is now preserved too.

- [ ] **[BUG-144][P1][Creative Studio] Film export depends on an ffmpeg the product never ships, and the failure tells the user nothing they can do** — found 2026-08-27 auditing the film export runtime after verifying it live
  - **Actual.** `ffmpeg` is **not bundled and not a dependency**: there is no `ffmpeg-static`, no `extraResources`, and no build-config reference anywhere in the repo. `resolveStudioFfmpegBinaries` (`ffmpegBinaries.ts`) falls back to the bare string `'ffmpeg'`, resolved through `PATH`, with `FFMPEG_PATH` / `FFPROBE_PATH` as the only overrides.
  - **The PATH half is already handled.** `fixPath()` runs at `index.ts:169`, so a Finder-launched app does inherit the login shell's `PATH` — a machine that _has_ ffmpeg will find it. That mechanism is not the defect.
  - **The defect is that most machines will not have it at all.** For any user who has never installed ffmpeg, film export simply does not exist, and what they are told is `errors.unavailable`: _"This device does not have a verified FFmpeg film-export capability."_ That names an internal component, describes a capability check rather than a situation, and offers **no next step**. It is a dead end at first run.
  - **Verified working on this machine only because the dev app was launched from a shell with Homebrew on `PATH`** — `get-film-export-capability` returned `{ status: 'ready', encoder: 'h264_videotoolbox' }`. That is not evidence about a shipped build on a clean machine.
  - **Why P1.** This is the difference between a feature and a feature-for-developers. The Cut, the Board and the whole export assignment assume a film can be produced; on a stock machine the primary output of the product is unreachable.
  - **Fix direction, in preference order.** (1) Bundle a licence-compatible ffmpeg/ffprobe pair via `extraResources` and resolve it relative to the app before falling back to `PATH` — the resolver already supports an explicit path, so this is a resolution change, not a rewrite. (2) If bundling is rejected on licence or size grounds, the capability failure must become actionable: say ffmpeg was not found, say where the product looked, and offer either an install route or the `FFMPEG_PATH` override. Silence about a fixable precondition is the worst option.
  - **Measured 2026-08-27: an LGPL-only ffmpeg is sufficient, so bundling does not require a GPL decision.** This was the open question blocking the bundling call, and it is now settled by construction rather than by argument.
    - **Nothing this feature needs is GPL.** The encoder loop (`filmExporter.ts:735`) tries only five **hardware** encoders — `h264_videotoolbox`, `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf` — and returns `unavailable` if none probes clean. There is **no libx264 fallback anywhere in the file**; encoding is delegated to the OS or driver. Checking all 32 required components (20 filters, 1 encoder, 2 muxers, 5 demuxers, 2 protocols) against FFmpeg **n8.1.2's own `configure`**, which encodes gating as `<component>_deps="gpl"`: **none is gated on `gpl` or on `version3`.** The 33 GPL-gated components are an unrelated set (`delogo`, `hqdn3d`, `cropdetect`, `boxblur`, `eq`, …).
    - **Built and run, not merely reasoned about.** FFmpeg n8.1.2 was compiled from official source with `--disable-gpl --disable-nonfree --disable-version3 --enable-videotoolbox --enable-audiotoolbox`; configure reported **`License: LGPL version 2.1 or later`**, and the GPL-only filters are confirmed absent from the resulting binary. The product's own `createStudioFilmExporterV2(...).capability()` — the real probe, which encodes a test clip — returned **`{ status: 'ready', encoder: 'h264_videotoolbox' }`**.
    - **A complete export through those binaries is byte-identical to the GPL build's.** The app was relaunched with `FFMPEG_PATH`/`FFPROBE_PATH` pointed at the LGPL pair and a full dissolve + trim-tails export of `Light on Water` succeeded: 28005204 bytes, 665 frames, 27.708333s, `trimmedShotCount: 2`, decode clean. Its SHA-256 is **`dd3200875dd4631ee97e073c8bc213eab9a0afa83a5ac9ab305cedb09179b74f`** — **identical** to the film the GPL Homebrew build produced from the same revision and parameters. The GPL components contribute nothing to this feature.
    - **What this changes.** "Internal use only" is not needed as a licensing strategy, and the pilot should not bundle a convenient GPL build that has to be unpicked before the commercial date. Bundle the **LGPL v2.1 build**, and the same artifact carries through to commercial distribution.
    - **Still counsel's call, not engineering's.** LGPL obligations on commercial distribution remain — link dynamically, ship the LGPL source or a written offer, permit relinking, include the notices. H.264 **patent** licensing (Via LA) is a separate question from copyright; the encode path runs on OS/vendor hardware encoders, but shipping an H.264-producing product commercially is a legal question. Nothing above is legal advice.
  - **Related.** The dead-end wording is also item 7 of BUG-146; fixing the copy without deciding the bundling question only makes the dead end more polite.
  - **Bundle-ready resolver checkpoint (partial, not a fix).** Creative Studio now resolves one atomic pair in this order: injected test/development paths, environment paths (including the existing sibling derivation), a complete regular executable pair under `process.resourcesPath/bundled-ffmpeg/{platform}-{arch}/`, then the two bare `PATH` commands. Any injected or environment member opts out of the bundle so a render can never mix binaries from different sources. The runtime location, platform, architecture and file predicate are injectable for deterministic cross-platform tests.
  - **Still required before this bug can close.** This checkpoint deliberately adds no binaries, packaging configuration, project-schema field or migration. Distribution still needs approved and pinned LGPL-compatible `ffmpeg`/`ffprobe` artifacts for every supported target, build-time integrity/provenance checks, packaged-layout and installed-app verification, macOS signing/notarization evidence, applicable notices and source/relinking obligations, and the separate H.264 legal decision. Until those exist, packaged installs still fall through to the user or system `PATH`.
  - **DEFERRED by the owner, 2026-08-28.** Not closed and not being worked. The remaining step is a distribution decision — approved and pinned LGPL binaries, plus the counsel sign-off on LGPL obligations — rather than engineering work, so it should not sit in the actionable P1 queue.
  - **State when it was parked, so nobody re-derives it.** The resolver is already bundle-ready: `ffmpegBinaries.ts:74` looks in `resourcesPath/bundled-ffmpeg/<platform>-<arch>` first, then `FFMPEG_PATH`/`FFPROBE_PATH`, then bare `PATH`. The packaging hook exists too — `packages/desktop/electron-builder.yml:107` already declares `extraResources`, and the project ships `bundled-aioncore/<platform>-<arch>` by exactly this pattern, so ffmpeg would follow a route that is already proven in the build. What is missing is binaries and the decision to ship them, not a mechanism.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — packaged film export.
    - **Rationale:** Pilot 1 photo export needs no encoder. Film export returns in Phase 6, where the
      application must own a legally distributable FFmpeg/FFprobe capability rather than rely on a
      developer machine's `PATH`, and must distinguish unavailable from unsupported media.
    - **Acceptance evidence:** Distribution evidence must record the chosen build, licence notices
      and codec decision. A packaged-app E2E in an environment with no system FFmpeg must resolve the
      bundled binaries and export a valid film; unavailable and unsupported-capability tests must
      produce distinct, actionable messages without initiating spend.
    - **Claimant:** Unclaimed.

- [x] **[BUG-145][P2][Creative Studio] The film export dialog's checkbox renders on two rows, control above its own label** — found 2026-08-27 by the owner on first sight of the new dialog; **fixed the same day in `72084cc65`**
  - **Actual.** In `Export one film file`, the `Trim bounded quiet tails` checkbox rendered with the orange box on one row and its label stranded on the next. Measured live: the `<label class="arco-checkbox">` computed `display: grid`, height **42px**, box at `y=488` and text at `y=509`.
  - **Root cause.** `WorkspaceControls.module.css:54` styles stacked form fields with a bare descendant element selector:

        .modalBody label,
        .ruleEditor label,
        .ruleAddForm label { display: grid; gap: 6px; }

    Arco renders **Checkbox and Radio as `<label>`** (confirmed in `@arco-design/web-react/es/Checkbox/checkbox.js` and `Radio/radio.js`), so the rule intended for field captions also caught the control and split it across two grid rows. Switch renders a `<button>` and was never affected.

  - **Why it surfaced now.** `WorkspaceProjectMenu.tsx:1691` is the **first Checkbox ever placed inside `.modalBody`**. The CSS predates it (`7a3ed801e`); the export commit merely walked into it. The same trap was waiting for the first Radio.
  - **Fix.** An additive, CSS-only rule restoring Arco's own inline layout for `.arco-checkbox` and `.arco-radio` inside the three affected containers, using `:global()` per the project's Arco-override convention. `display: inline-block` was chosen over `inline-flex` after measuring all three candidates: it reproduces Arco's natural 8px control-to-text spacing exactly, where flex variants invented 14–16px.
  - **Verified live.** After HMR: height **22px**, 8px gap, control and text on the same row; the `Transitions` field label still correctly stacks at 60px. Both `WorkspaceProjectMenu.dom.test.tsx` suites green (84/84), `oxfmt --check` clean.
  - **Durable follow-up for the menu regroup.** The bare `label` selector remains. Give real field labels an explicit class rather than matching the element, and the override added here can be deleted.

- [x] **[BUG-146][P3][Creative Studio] Film export copy carries a factual error and collides with the name of a destructive operation** — found 2026-08-27 reviewing all 34 `filmExport.*` strings against the app's own vocabulary; **fixed the same day, in all twelve locales**
  - **Checked first, and withdrawn.** "Uncovered", "black slates", "authored" and "moved aside" are **established house vocabulary**, not jargon — "uncovered" appears 4× (`Open uncovered Beat`, `Keep uncovered — no generation cost`), "slate" 26× with an explicit definition string, "authored" 9×, and `editorFolderExport.successQuarantine` uses "moved aside" identically. Leave them.
  - **Strong as written, for the record.** Every `disabled.*` reason says what to _do_ ("Add a Beat before exporting a film"). The `phase.*` progress sequence is honest and is an improvement on the sibling export, which has none. Most errors carry a real reassurance clause. Preserve all of this.
  - **1 — `trimTails` collides with a destructive operation's name.** The label reads _"Trim bounded quiet tails (the final rendered Shot is protected)"_. Elsewhere, `beatPanel.coverage.tailTrimWarning` reads _"Tail trim breaks downstream continuity."_ Same words, opposite stakes: that one alters the project, this one only affects the exported file (verified — project revision unchanged across every export). A user who has seen the warning will reasonably fear the checkbox. "Bounded" is also the app's third unrelated use of that word ("bounded local review cache", "bounded generation graph"), and "(the final rendered Shot is protected)" explains an implementation carve-out inside a label. Suggest: **"Trim still tails from each Shot"**, helper text **"Affects the exported file only. The last Shot keeps its full length."**
  - **2 — `dissolve` states a duration the product does not deliver.** The option reads `"0.35s dissolves"`, and `STUDIO_FILM_EXPORT_DISSOLVE_SECONDS` is indeed `0.35`. But the engine snaps to whole frames: a real export recorded `requestedSeconds: 0.35, seconds: 0.3333` (8 frames at 24fps), and the rendered length confirms it — 28.375s of segments minus two 0.3333s overlaps = 27.708s. **This is a factual error in user-facing copy**, not a wording preference. Suggest "Cross dissolve" with no number, or the true snapped value.
  - **3 — "money" is the only occurrence in the app.** `noSpend` reads _"…does not generate media or spend money."_ The house term is "spend" (10 uses), and this string's own sibling already gets it right: `editorFolderExport.exporting` — _"Exporting… No media will be generated and nothing will be spent."_ Match the sibling.
  - **4 — pluralization is skipped.** `{{count}} tails trimmed` and `Older film exports moved aside: {{count}}` use bare counts, but `conversation.json` carries **74 `_one`/`_other` plural keys**. The sibling export has the same gap, so this is a pre-existing pattern in export copy rather than new.
  - **5 — three names for one action.** Menu `Export film…`, title `Export one film file`, button `Export film`. The "one" is spec language disambiguating from `Export editor folder…`, which is the menu's job. Make the title `Export film`.
  - **6 — the sibling surfaces a count and this does not.** `editorFolderExport.actionWithSlates` reads `"Export editor folder · {{count}} slates…"`. The film dialog says only that uncovered Shots become black slates, never how many, though it knows. Borrow the sibling's pattern.
  - **7 — `errors.unavailable` is a dead end.** _"This device does not have a verified FFmpeg film-export capability."_ names an internal component, gives no next step, and collapses two distinct engine codes (`ffmpeg_unavailable`, `unsupported_capabilities`). See **BUG-144** — this is the first-run experience on any machine without ffmpeg, so the copy fix and the bundling decision belong together.
  - **8 — `errors.staleAuthority` hedges around an engine imprecision.** _"The project **or** export catalog changed."_ The "or" exists because both cases report `stale_project` (**BUG-147**). Fix that and this can be specific. Note also that the sibling ends with a next step ("Review the current project before exporting again") while this one ends with reassurance ("No stale film was published") — it should carry both halves.
  - **Minor.** `transition: "Transitions"` is a plural label on a single-choice control.
  - **Sequencing.** These are en-US value changes, which strand 11 other locales on translations of different text, and the menu-regroup assignment restructures these dialogs anyway — so this belongs **with the regroup**. Items 2 and 4 are defects rather than taste and should land regardless of its timing.
  - **Fixed after the regroup landed.** Items 1-7 and the minor `transition` plural are done; item 8 is done in the half that does not depend on BUG-147. `filmExport` went from 34 to 42 leaves.
    - `title` **"Export one film file" → "Export film"**; `transition` → singular; `dissolve` **"0.35s dissolves" → "Cross dissolve"**, removing the duration the engine does not deliver; `noSpend` now matches the sibling's vocabulary — _"This runs on your machine. No media will be generated and nothing will be spent."_ — retiring the app's only use of "money".
    - `trimTails` → **"Trim still tails from each Shot"**, with a new `trimTailsHelp` line rendered under the control: _"Affects the exported file only. The last Shot keeps its full length."_ This is the item that mattered most, because `beatPanel.coverage.tailTrimWarning` uses the same words for an operation that **does** alter the project.
    - `errors.unavailable` now names the actual condition and a way out, keeping `FFMPEG_PATH` verbatim in every locale. `errors.staleAuthority` gained the missing next step; its "project **or** catalog" hedge stays until **BUG-147** gives the two causes distinct codes.
    - Three plural families added — `actionWithSlates`, `successFacts`, `successQuarantine` — and the film menu item now reports its slate count the way the editor-folder sibling already did.
  - **The repo's plural convention is not CLDR, and the test enforces that.** `studioI18n.test.ts` asserts **exact key-set equality across all eleven non-English locales**, so every locale carries exactly `base` + `_one` + `_other`: CJK repeat one string across all three, and ru-RU/uk-UA get two forms rather than `_few`/`_many`. Translating to CLDR-correct categories therefore **breaks the build**, in both directions — extra Slavic categories and omitted CJK `_one`. The existing Slavic entries solve the two-form squeeze with a **count-last construction** (`Предложено правок: {{count}}`) that stays grammatical for any number; the new strings follow it. Two hardcoded counters also had to move: the plural-family count `18 → 21`, and two `WorkspaceProjectMenu.dom.test.tsx` assertions that named `filmExport.action` where the slate-count variant now renders.
  - **Verified.** All twelve locales checked programmatically: identical key sets (42 leaves each), placeholders preserved per key against en-US, no empty or single-brace values, `FFMPEG_PATH` intact, and no locale left byte-identical to English. `studioI18n` 57/57, both menu DOM suites 84/84, typecheck clean, `check-i18n` passing. Confirmed live in the running app.
  - **The base key is a live fallback, not a spare copy — caught by an adversarial pass, not by the suite.** i18next resolves `key_<CLDR category>`, and when that key is absent it falls back to the **base** key, _not_ to `_other`. Ukrainian selects `few` for 2-4 and `many` for 5+, neither of which this repo's two-form convention defines, so uk-UA rendered its base string for every count from 2 upward. Measured with the repo's own i18next before the fix: `count=2` → _"2 заглушок"_, where Ukrainian requires _"2 заглушки"_. Every unit test was green throughout — the contract test asserts key **sets**, never rendered output.
    Fixed by pointing each Slavic base at the count-last `_other` wording, which is grammatical for any number; verified by rendering all twelve locales at counts 1, 2, 5 and 11. **Whenever a locale has CLDR categories this repo does not define, its base key must carry the count-agnostic form.**
  - **en-US was the weakest `trimTailsHelp` of the twelve.** All eleven translations independently added a clause the source lacked — de-DE _"das Projekt bleibt unverändert"_, es-ES _"el proyecto no cambia"_, ja-JP _"プロジェクトは変更されません"_. Since that clause is the entire reason this entry exists, en-US was raised to match: _"Affects the exported file only — the project is unchanged. The last Shot keeps its full length."_
  - **Open nit, not taken.** The two options of one `Select` disagree in number — `cut` is "Straight cuts" (plural, pre-existing) while `dissolve` is now "Cross dissolve" (singular), under a label that is now singular "Transition". Aligning them means retranslating `cut` in twelve locales, which is beyond this entry; flagged for whoever next touches this dialog.
  - **Deliberately left.** `editorFolderExport` still has the same un-pluralized `{{count}}` strings; that gap is pre-existing and outside this entry's scope. Item 6's count now appears only when the Cut actually has uncovered Shots.

- [x] **[BUG-147][P3][Creative Studio] A stale export catalog is reported as a stale project** — found 2026-08-27 probing the film export's concurrency guards; **fixed 2026-08-27**
  - **Actual.** `create-export` takes two independent revisions, `expectedRevision` (project) and `expectedCatalogRevision` (export catalog). Both guards work — neither stale value can publish — but **both refuse with the same code**: `{ ok: false, error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' } }`. Measured by sending each stale value separately against `dc0168b3…`.
  - **Why it matters.** The project was not stale in the second case; the catalog was. The two have different causes and different recoveries, and the copy is already contorted to cover both — `errors.staleAuthority` says _"The project **or** export catalog changed"_ precisely because the code cannot tell the caller which. This is the same honesty-of-failure class as BUG-140's `storage_error`, in a milder form.
  - **Fix direction.** Give the catalog conflict its own code (`stale_export_catalog`) and its own message, then let `errors.staleAuthority` stop hedging. Keep both guards exactly as strict as they are — the refusals are correct, only the label is wrong.
  - **The engine already knows the difference; it is flattened at one boundary.** `catalog.ts` raises a distinct `stale_catalog_revision` (`catalog.ts:865`, `:2668`, `:2939`), and `rethrowExportFailure` collapses it together with `stale_project_revision` into `CreativeStudioStoreError('stale_project', 'Studio export authority has changed')` at **`v2Service.ts:1696`**. So this is a one-site mapping change, not a redesign — the information survives right up to that line.
  - **Deliberately not taken on 2026-08-27.** The fix needs a new code on the shared `CreativeStudioStoreError` union, which `'stale_project'` reaches across **nine** non-test files (`store.ts`, `jobManager.ts`, `mediaStore.ts`, `creativeStudioBridge.ts`, `directorCommandProcessor.ts`, `directorCommandService.ts`, `v2Service.ts`, `StudioPage.tsx`, `creativeStudioTypes.ts`), plus a new key in all twelve locales. That is a shared-contract change, and it was judged a poor trade to make it unilaterally against a P3 while other work is in flight on the same surfaces. Whoever takes it should do it with **BUG-146 item 8**, since the copy fix depends on it.
  - **Fixed.** Catalog-revision conflicts now remain distinct as `stale_export_catalog` through the service, bridge, renderer, and asynchronous film-export terminal. Project-revision conflicts remain `stale_project`; both deterministic guards are unchanged. The editor-folder and film-export surfaces now give cause-specific recovery copy in all twelve locales.

- [x] **[BUG-148][P4][Creative Studio] An export artifact reports `fileCount: 1` for a folder holding three files** — found 2026-08-27 inspecting a completed film export on disk; **fixed 2026-08-27**
  - **Actual.** The catalog artifact for a completed film reports `fileCount: 1` and `byteSize: 30507615`, but the published folder contains **three** files: `film.mp4`, `manifest.json` and `artifact.json`. The count and the byte size describe the payload only.
  - **Why it is worth recording.** `fileCount` is a generic field shared with the editor-folder export, where it plausibly means every file. If it means "payload files" here and "all files" there, anything reading it across shapes is wrong for one of them. `manifest.json` already lists exactly one entry, so the payload count is derivable and unambiguous.
  - **Fix direction.** Either count every published file, or rename the field to what it measures. No behaviour depends on it today, which is why this is P4 — but decide before something does.
  - **Decision and clean cutover.** The contract now calls the field `payloadFileCount`: it counts manifest payload entries and deliberately excludes `manifest.json`, `artifact.json`, and other publication metadata. This exact-key change advances the independent export sidecar from schema 1 to schema 2, with no legacy alias or migration; schema-1 catalogs carrying the old ambiguous key are quarantined intact before a clean catalog begins.

- [x] **[BUG-149][WITHDRAWN — NOT A DEFECT][Creative Studio] A dissolve may cross a Beat boundary where the Cut should hard-cut** — raised 2026-08-27 from a code reading, **investigated and withdrawn the same day**
  - **Withdrawn. The hypothesis was wrong, and the current behaviour is correct.** It is recorded here rather than deleted because the reasoning error is worth not repeating.
  - **What the spec actually requires.** `creative-studio-3-film-export.md` gives the authoritative worked example — the assembly that was chosen was _"six clips"_ with _"0.35s cross-dissolve at each of **five** boundaries"_, i.e. a dissolve at **every** join. Beats are never named as transition boundaries anywhere in that document. There is therefore no requirement to hard-cut at a Beat boundary.
  - **What the code does.** `filmExporter.ts:1122-1131` sets `canDissolve` when the dissolve is non-zero, the index is greater than zero, **both** neighbours are `kind === 'shot'`, and `segment.chainBreak === 'none'`. So it dissolves at every Shot-to-Shot join except two exclusions, both of them right: a **slate** on either side never dissolves, and a join the director has explicitly marked as a hard cut never dissolves. `hard_cut` is authored deliberately through the `set_hard_cut` operation, so honouring it is the whole point.
  - **The reasoning error.** The hypothesis conflated two unrelated concepts that happen to share the `chainBreak` field. A **conditioning-chain head** (`shotIndex === 0` or `hard_cut`, `chain.ts:204`) decides which frame conditions the _next generation_. An **editorial transition boundary** decides whether the _edit_ cuts or dissolves. A new Beat starts a new conditioning chain — and that says nothing whatever about how the cut should read. Reusing one field for both made them look like the same rule.
  - **No live test was needed to settle it**, which is the second lesson: the original entry proposed an expensive multi-Beat reproduction when the specification and eleven lines of the gate answered the question directly. Read the contract before building the experiment.
  - **Filing it as `UNVERIFIED — NOT REPRODUCED` was correct** and is what kept it from becoming a fabricated defect in the record. Keep doing that for code-reading hypotheses.

- [x] **[BUG-150][P1][Creative Studio] The film-export commit decremented the export-catalog schema version from 5 to 1, so every catalog written before it is unreadable and its project can never export again** — found 2026-08-27 restoring the six archived pre-migration projects to verify BUG-136 live; **fixed 2026-08-27 under the zero-user clean-cutover direction**
  - **Root cause, exact.** `13ac6ee99` ("feat(studio): export one local film file") changed one line in `creativeStudioTypes.ts:177`:

        -export const STUDIO_EXPORT_SCHEMA_VERSION_V2 = 5 as const;
        +export const STUDIO_EXPORT_SCHEMA_VERSION_V2 = 1 as const;

    The version was **decremented**, presumably to restart the export catalog on its own counter rather than inherit the project's schema 5. `catalog.ts:715` and `:756` validate with `value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V2`, so every catalog on disk — all written with `5` — is now rejected. **No migration exists**, and because the number went _down_, no future bump can distinguish "old 5" from "future 5".

  - **Measured effect, precisely.** Three of the six archived projects carry an `exports-v2.json`. With them present:

    | project                                  | `getProject` | `listExports`               | film capability |
    | ---------------------------------------- | ------------ | --------------------------- | --------------- |
    | healthy, catalog written by current code | OK           | OK                          | OK              |
    | pre-migration **with** an old catalog    | OK           | **refused `storage_error`** | OK              |
    | pre-migration **without** a catalog      | OK           | OK                          | OK              |

    So the project still opens and is otherwise usable; what dies is **exports**. And because `createExport` requires an `expectedCatalogRevision` that only `listExports` can supply, the user cannot even form a valid export request — **the project can never export again**, and its existing export folders are orphaned on disk.

  - **It is as catastrophic as the log says: ONE stale catalog disables generation for the ENTIRE Studio.** Startup prints `[CreativeStudio] Schema-2 runtime activation failed: StudioExportCatalogErrorV2`, and the runtime never activates. Anything that needs the runtime is then dead **on every project**, including projects with a perfectly current catalog:

    |                                                     | with the 3 stale-catalog projects present | with them removed |
    | --------------------------------------------------- | ----------------------------------------- | ----------------- |
    | `prepareSubmission` on **healthy** `Light on Water` | **`runtime_inactive`**                    | **quotes**        |
    | `prepareSubmission` on **healthy** `Panel Check`    | **`runtime_inactive`**                    | **quotes**        |
    | activation at startup                               | fails                                     | clean             |

    Controlled both ways on the same build: removing the three projects restores generation, restoring them kills it again. **This is BUG-136's exact blast radius** — one unreadable record on disk takes the whole feature down for every project.

  - **Correction to my own first measurement.** I initially reported this as _"not as catastrophic as the log claims"_ on the grounds that `getProject`, `listExports` and `getFilmExportCapability` all still answered. That was wrong, and wrong in a specific way worth naming: those three calls are served **without runtime activation**, so they cannot detect an inactive runtime. Probing only the operations that happen to be reachable proves nothing about the ones that are not. The first call that actually needed the runtime — `prepareSubmission` — returned `runtime_inactive` immediately.
  - **The refusal wears the wrong label.** `listExports` reports `storage_error`; storage is fine and was read successfully. The catalog is a version the code declines to accept. Same honesty-of-failure class as BUG-140 and **BUG-147**.
  - **Why P1.** Anyone who ran an editor-folder export before this commit cannot generate **anything, in any project**, after upgrading — the whole Studio stops producing work, and the only clue is one startup log line that names an export catalog. The affected project also loses its export history permanently. In a pilot, one such user's machine is fully blocked.
  - **This is BUG-136's defect class, reintroduced by the very next commit** — a versioned record's schema changed with no migration for records already on disk. The BUG-136 handoff explicitly flagged this hazard for the film-export work. Worth noting the mechanism differed enough to dodge the lesson: BUG-136 was a _field_ added to an exact-key set, this is a _version constant_ moved backwards.
  - **Fix direction.** Restore `STUDIO_EXPORT_SCHEMA_VERSION_V2` to `5` and go **forward** to `6` if a break is genuinely needed, with a migration that accepts `5` and rewrites it. A decrement is not a version change, it is a collision — after this, `5` means both "written 2026-08-26" and "some future revision". If the catalog truly warrants an independent counter, it needs a distinct field name, not a reused one with a smaller number. Separately, give the refusal a cause-specific code, and scope the startup log line so an export-catalog problem does not announce itself as a runtime activation failure.
  - **Live reproduction.** The six archived projects at `~/weprompt-archived-projects/2026-08-27-pre-migration/` — restore with **`rsync -aH`**, not `cp -R`. Then `listExports` on `b552858f_4b3e_4f1d_ab3c_d6f6f174cf93` refuses. `6698ac0c…` and `ab864bb7…` reproduce it too; the other three have no catalog and are unaffected.
  - **Note for whoever restores that corpus.** `cp -R` breaks the hard links the pending-publication protocol depends on — the `.tmp` and `.ready` files are hard links to one inode (`nlink=3`), and `store.ts:2316` correctly quarantines the project when they are no longer the same physical file. That quarantine is the guard working, not a bug; it cost me a false alarm before I checked `stat`.
  - **Binding disposition superseding the migration proposal above.** The export catalog remains independently versioned from the project schema and protocol. The `payloadFileCount` exact-key cutover advances that sidecar to schema 2. Because Creative Studio has zero production users, no compatibility field or migration was added: both the old project-coupled schema-5 catalog and the immediately previous independent schema-1 catalog are moved intact, with their active export trees, into the existing quarantine before a clean current catalog begins. Recovery is isolated per project, so one unreadable export sidecar can no longer prevent the runtime from activating or generation from continuing in other projects; a failed quarantine remains retryable on a later inventory refresh.

- [x] **[BUG-151][P1][Creative Studio][OUT OF SCOPE — NO MIGRATION] A migrated project can never undo anything it did before the migration, and the Undo button stays enabled and errors on every click** — found 2026-08-27 by adversarial review of `79c34cf40`; **closed 2026-08-27 under the zero-user direction**
  - **Root cause.** `briefFile.ts:77` `normalizeLegacyUndoHistoryV2` defaults `dismissedSeedStillIds` into the stored Shot snapshot (`patch.before`) **and** into the live `shots` map, but passes `afterDigest` through **verbatim**. `afterDigest` is a hash _of a Shot snapshot_, computed over the whole record minus `assetIds`/`jobIds` (`mutations/index.ts:901`, `:906-917`). Adding a key changes the recomputed digest, so `verifyUndoDigest` (`:1088`) can never match and `applyUndoEntry` (`:1105-1108`) throws `undo_conflict`.
  - **What the user sees.** `workspaceStatus.ts:789-798` emits `undoTop` with **no digest check**, so `WorkspaceControls.tsx:358-366` renders an **enabled** "Undo …" button that fails on every press. Only the last entry is undoable and a failed undo does not pop it, so the **entire** pre-migration history is unreachable — not one step. The stale digest is re-serialized on the next persist, so it is permanent.
  - **Reproduced by execution.** A forged previous-build manifest decodes, both locations receive `dismissedSeedStillIds: []`, then `undo_last` throws `reasonCode: 'undo_conflict'` (stored `2985b0a7…` vs recomputed `c7203fec…`). A control run recomputing **only** `afterDigest` undoes successfully, isolating the digest as the sole cause.
  - **Why the commit's own test misses it.** The fixture uses a synthetic `afterDigest: 'a'.repeat(64)`, which only has to satisfy the hex-shape check.
  - **Scope and fix.** Affects any project edited on a build between `39302a957` and `42473b5a2`. No data loss, and the project still opens — a strict improvement on the pre-commit state where those manifests would not decode at all. Recomputing `afterDigest` at decode time makes `verifyUndoDigest` trivially pass and blunts the intervening-change guard; **dropping legacy `shot_fields` entries during migration is the conservative option**. Whichever is chosen, the Undo button must not offer an action that cannot succeed.
  - **Disposition.** Creative Studio has no production data to preserve and the binding direction is a clean schema-5 cutover with no migration or compatibility fields. Legacy undo-digest repair is therefore intentionally not implemented. Current schema-5 undo history remains covered by the existing exact-digest contract; this closure must not be read as weakening that guard.

- [x] **[BUG-152][P2][Creative Studio] Long project names no longer truncate, so the name paints over the workspace bar** — found 2026-08-27 by adversarial review of `f7a39ea2d`; **resolved 2026-08-27**
  - **Root cause.** `Workspace.module.css:51` moved `.projectTitle` from `overflow: hidden` to `display: flex; overflow: visible`, delegating the ellipsis to `.projectTitleText` (line 83). That class sits on a `<bdi>` inside an Arco button (`.arco-btn { display: inline-block }`), so the `<bdi>` is a non-replaced **inline** box — where `overflow` and `text-overflow` do nothing. Nothing clips. The comment at lines 45-48 still states the contract the code dropped.
  - **Measured in real Chrome** at a 600px bar: the `<bdi>` is 706.5px wide with its right edge at 787.1px while the `<h1>` ends at 304px; `appBar.scrollWidth` 785 vs `clientWidth` 600. The name paints over the stat strip and the view chips. The `onRename === undefined` bare-`<bdi>` branch overflows too (758 vs 600).
  - **Not an edge case.** `Composer.tsx:39` names every new project `brief.slice(0, 256)` — the first 256 characters of the typed brief — and 320px holds roughly 45 characters at Manrope 700 14.5px. **Nearly every Composer-created project overflows.**
  - **Confirmed a regression, not a pre-existing gap.** The identical markup under the previous CSS clips correctly (`h1` clientWidth 320 / scrollWidth 707, bar scrollWidth == clientWidth == 600). Adding `display: block` to `.projectTitleText` restores clipping.
  - Visual only — `title` and `aria-label` keep the accessible name — but it lands on the primary creation path, in the slice whose entire purpose was the drawn app bar. **No unit test can catch it: jsdom has no layout.**
  - **Resolution.** The title boundary clips again, and both the interactive and read-only paths now put their `<bdi>` in the same bounded block box. Focused DOM coverage guards the shared structure; the existing real-browser workspace E2E now renames to a 256-character title and asserts that its painted box stays within the heading while its content genuinely overflows.

- [x] **[BUG-153][P2][Creative Studio] The Cut target-duration editor drops keyboard focus on entry and on exit** — found 2026-08-27 by adversarial review of `f7a39ea2d`; **resolved 2026-08-27**
  - **Root cause.** `Cut/index.tsx:342` copies the repo's Edit → inline-editor → Save/Cancel pattern **without its focus management**: the `<InputNumber>` (341-352) has no `autoFocus`, and Save (353-362) and Cancel (363-376) unmount themselves without restoring focus to the Edit button. The only focus code in the file is filmstrip reorder (`:147-156`), which never touches this editor, and no ancestor recovers focus.
  - **Measured** with the repo's own harness: focus is on the EDIT button, then `<body>` after entering the editor, then `<body>` again after Cancel. A keyboard user must re-Tab from the top of the document past the Director rail, project menu, view tabs, transport and filmstrip to reach the revealed spinbutton; a screen-reader user gets no signal the editor opened. **WCAG 2.4.3, Level A.**
  - **The precedent is in the same commit.** `git log -S` confirms both this editor and the inline rename editor arrived in `f7a39ea2d`, and the rename one (`WorkspaceShell.tsx:146`) does `autoFocus` + `onFocus={(e) => e.target.select()}` correctly. `WorkspaceProjectMenu.tsx:715/772-778` and `Board/index.tsx:142-174` also restore focus. This control is the outlier.
  - The three existing target-editor tests (`CutView.dom.test.tsx` ~1715/1754/1779) assert call arguments and rendered text only, never `document.activeElement`. **Note for the fix:** the test file's Arco mock type (`InputNumberProps`, line 62) does not declare `autoFocus`, so a fix will silently drop the prop unless the mock is widened. Real Arco forwards it.
  - **Resolution.** The spinbutton now receives focus when editing starts. A one-shot return path restores focus to Edit after Cancel, a same-value Save, or a successful Save; a refused save remains focused in the retryable editor, and changing projects explicitly suppresses restoration. Focused DOM tests cover every branch, the Arco mock forwards `autoFocus`, and the workspace E2E asserts entry and successful-exit focus in the real component.

- [x] **[BUG-154][P3][Creative Studio] Blurring the inline project title with an empty name leaves the app bar stuck in an erroring editor** — found 2026-08-27 by adversarial review of `f7a39ea2d`; **resolved 2026-08-27**
  - `WorkspaceShell.tsx:101` — `commit()` returns early on `invalid` before any `setEditing(false)`, and the blur handler (line 154) only calls `void commit()`. Blurring with an empty or whitespace name neither commits nor exits edit mode, and while editing the `<h1>` renders only the input and the error span, so **the project name disappears from the bar**.
  - Click the title, select all, delete, click elsewhere → an empty red input plus "Enter a project name." and no title, on **every view** (`StudioPage.tsx:3691` keys the page by project id, so switching views re-renders the same instance rather than remounting). Probed: `{stillEditing: true, renameCalled: 0}`, and after navigating to Board, `editProjectCalls: 0`.
  - Trivially reachable — the field is autofocused and `onChange` accepts empty. Exits: click back in and press Escape, type a valid name, or wait for an unrelated mutation to bump `projectRevision` (the authority effect at 76-90 self-heals). Recoverable, no wrong write, accessible name survives on the `<h1>` — a UX trap, not a correctness failure.
  - Uncovered by design: `WorkspaceProjectTitle.dom.test.tsx:77-99` covers Enter-with-whitespace and Escape, `:56-75` covers blur-with-valid. The blur × invalid cell has no test.
  - **Resolution.** Invalid Enter still keeps the focused editor and visible validation message, while invalid blur now abandons the draft, clears its edit authority, and restores the canonical title without invoking Main. The focused title suite covers both branches.

- [x] **[BUG-155][P3][Creative Studio] The project title's CSS-module class never reaches the Arco button — two defects, one root cause** — found 2026-08-27 by adversarial review of `f7a39ea2d`; **resolved 2026-08-27**
  - Both are the house trap of styling an Arco `type='text'` Button with a bare module class. Compare **BUG-145**, the same family on a Checkbox.
  - **(a) Colour and hover underline are dead CSS.** `Workspace.module.css:71` — `.projectTitleButton { color: inherit }` is (0,1,0) and loses to `.arco-btn-text:not(.arco-btn-disabled)` (0,2,0, `arco.css:2715`); the hover rule at 76-77 is (0,3,0) and loses to (0,4,0) at `arco.css:2720`. Measured in Chrome: rest `rgb(22, 93, 255)`, hover still `rgb(22, 93, 255)` with a transparent bottom border. **The title paints brand blue instead of `--text-primary`, and the new hover underline never appears.** The `:focus-visible` half does work, because Arco's focus rule sets only `box-shadow`. The fix already exists in the repo twice — `StudioTypography.module.css:65` and `Board.module.css:158-162` guard with `:global(.arco-btn-text)` / `:not(:global(.arco-btn-disabled))`; `Workspace.module.css` is the sole omission.
  - **(b) The class is stripped entirely while pending.** `WorkspaceShell.tsx:186` — Arco's Trigger rebuilds any disabled button child as `<span className={props.className}><button className={undefined}>` (`Trigger/index.js:568-600`). Verified: pending=false → `<button class="… _projectTitleButton_…">`; pending=true → `<span class="_projectTitleButton_…"><button class="… arco-btn-disabled">`. The button loses `font: inherit`, its paddings and its size bounds, falling back to Arco's `padding: 0 15px` / 400-weight 14px. Start any owner mutation (`StudioPage.tsx:515, 815, 886, 1111, 1179, 1466, 1675`) and **the title visibly jumps size and ~11px sideways** for the duration, then jumps back.
  - Both cosmetic and transient; rename, tooltip, disabled semantics and keyboard focus all behave correctly. For (b), put the metrics on a wrapper the Trigger cannot strip, or express them as a descendant rule such as `.projectTitle :global(.arco-btn)`.
  - **Resolution.** Title-button metrics now target the real `.arco-btn.arco-btn-text` below the stable heading, so Tooltip's disabled wrapper cannot remove them. A higher-specificity enabled selector restores the inherited title colour and the hover/focus treatment without overriding Arco's disabled palette. Source-contract coverage guards both selectors and the real-Electron workspace scenario checks the computed title palette and hover underline.

- [x] **[BUG-156][P3][Creative Studio] The rename button's accessible name does not contain its visible label** — found 2026-08-27 by adversarial review of `f7a39ea2d`; **resolved 2026-08-27**
  - `WorkspaceShell.tsx:188` — `aria-label={renameLabel}` overrides content whose visible text is the project name. `renameProject` is the literal `'Rename project'` with no placeholder, so the accessible name and the visible label **share zero words**. Speech-input users saying the visible name cannot activate the control. **WCAG 2.5.3, Level A.**
  - The a11y tree reports `button "Rename project"` on a control that reads e.g. "Autumn Reel". The repo's own tests confirm the computed name — `WorkspaceProjectTitle.dom.test.tsx:36` and `creative-studio.e2e.ts:1602`.
  - The same commit gets it right elsewhere: `WorkspaceProjectMenu.tsx:780` uses `` `${t('common.edit')}: ${rule.text}` `` and `Cut/index.tsx:383` composes both. Narrow in impact — screen-reader and keyboard users get a correct name, and Voice Control's show-numbers fallback works.
  - **Fix note.** Composing the name turns three currently-passing assertions red (`WorkspaceProjectTitle.dom.test.tsx`, `StudioPage.dom.test.tsx:3517`, `creative-studio.e2e.ts:1602`). Leave the `<Input aria-label>` at line 148 alone — a text input has no visible label, so 2.5.3 does not apply.
  - **Resolution.** The button is now named “Rename project: [visible project name]”; the input keeps its concise action label. Component, page-owner, and browser selectors assert the composed button name.

- [x] **[BUG-157][P3][Creative Studio] The reference delete control's destructive styling is dead CSS, so an immediate, unconfirmed delete looks like an ordinary button** — found 2026-08-27 by adversarial review of `18ef05f4e`; **resolved 2026-08-27**
  - `References.module.css:360` sets `background: rgb(var(--danger-6))` and `color: rgb(var(--gray-1))` on `.removeControl`, but the element is an Arco `<Button type='secondary'>` (`References/index.tsx:438,455`), and `.arco-btn-secondary:not(.arco-btn-disabled)` (0,2,0, `arco.css:2529`) outranks the single-class module rule (0,1,0). Both the enabled and disabled branches lose. Reproduced in a browser with the module rule declared **last** — Arco still wins, so it is specificity, not sheet order, and no bundling change rescues it. Only the two colour declarations are dead; position, inset and z-index still apply.
  - **Why it is worth more than a wrong colour.** This delete has **no Popconfirm** — `onClick` calls `void removeImage(...)` immediately (`index.tsx:332-349`) — and it is icon-only, sitting 72px from the fullscreen toggle, which now renders identically. The glyph and the `aria-label` are the only remaining destructive signals.
  - **Third instance of one family**, after **BUG-145** (Checkbox rendered as `<label>`) and **BUG-155** (title button colour). The fix pattern already exists in the repo twice: `status='danger'` on the Button (`Board/index.tsx:415`) or a compound `:global()` selector covering both states (`Board.module.css:303`). `FullscreenMediaFrame.module.css:11-19` carries the same latent trap, unnoticed because both greys look alike.
  - jsdom cannot see computed colour, so no unit test can catch this; `ReferencesView.dom.test.tsx:257,284,302` assert only enabled/disabled state.
  - **Resolution.** The existing immediate action now uses Arco's native `status='danger'`; the dead module colour declarations are removed. No confirmation or removal behavior changed. Focused DOM coverage verifies the danger status remains present in both enabled and dependency-blocked states.

- [x] **[BUG-158][P3][Creative Studio] `removePhotoLocked` names two remedies that do not exist when the blocker is a Shot job** — found 2026-08-27 by adversarial review of `18ef05f4e`; **resolved 2026-08-27**
  - The tooltip reads _"Authorized work is using this photo. Finish or cancel that work before removing it."_ One branch of `removalBlocked` (`WorkspaceControls.tsx:188`) fires on `(job.canRetryDownload && usesAsset)`, where `canRetryDownload` means `status === 'failed' && error.code === 'download_failed'` (`v2Service.ts:1298`) — a **terminal** job that can be neither finished nor cancelled (`canCancelJobV2` returns false for `failed`), and that ordinary retry excludes (`canRetryJobV2` excludes `download_failed`).
  - **Scope, checked directly — narrower than first reported.** The review's claim that "no forward action is on screen at all" is **wrong for the common case**: the References panel renders its own **Retry download** button whenever the reference's _own_ latest job is in this state (`References/index.tsx:551-558`), right beside the blocked delete. The dead end only appears when the blocker is a **different** job — a Shot `seed_still` or `video_take` that consumed this reference — because that job's download recovery is gated on `purpose === 'board_still'` (`workspaceProjection.ts:1255`, `StudioPage.tsx:2186`). In that case the photo is unremovable with no on-screen remedy.
  - The block is authoritative, not cosmetic: `mutations/index.ts:1452-1462` mirrors the predicate and returns `dependency_blocked`, so main fails closed. That is correct design; the defect is that the copy names actions the user cannot take, and the cross-job case offers none.
  - Secondary looseness in the same predicate: the first branch also blocks removal for a job **generating a replacement** for the reference, which is not "using this photo". And the message never says _which_ job or where to find it, though the blocker is often a Shot job over in Table or Board.
  - **Fix direction.** Extend download recovery past `board_still` so the cross-job case has a remedy, and make the copy name the blocking job rather than prescribing two verbs that may not apply. No test references `removalBlocked` or `removePhotoLocked`.
  - **Resolution.** The renderer now derives a typed, deterministic list that mirrors Main's unchanged fail-closed deletion guard for the exact current approved asset. It distinguishes malformed canonical authority, an unresolved reference-image job, active exact-asset consumers, and failed-download recovery; Shot blockers carry one-based Beat/Shot positions and localized generation purpose. Every blocker is rendered. An active-film or reference-target failed download exposes **Retry download** through one typed recovery claim and the existing free `retryDownload` seam. Retained work instead carries its exact direct-Shot or containing-Beat Bin identity, explains which owner must be restored, and offers **Review in Board**. The page re-reads authority before either remedy. Retry revalidates canonical reference/asset provenance, immutable job creation identity, strict job ownership, active-film membership, failed-download capability, frozen composition input, and asset hash. Retained review revalidates the exact Bin owner and focuses that Board Bin row without writing or spending. Presentation positions are not authorization identity, so a harmless reorder does not stale recovery. Any Main-matching job with inconsistent renderer project/owner authority blocks non-actionably. Refused or stale recovery leaves the deletion lock intact and never opens generation review, creates a quote, confirms spend, or changes authoring.
  - **Verification.** Focused helper tests cover exact branch classification, direct-Shot and containing-Beat retained owners, current-asset matching, import and exact generated-producer provenance, wrong-project/unowned blockers, fail-closed malformed authority, and recovery-first/created-at/job-id ordering. References DOM coverage renders every blocker/copy variant, routes retained work to Board, limits direct retry to retryable recovery claims, and proves an unrelated failed replacement job does not block deleting the current photo. StudioPage tests cover exact fresh Bin navigation, stale/non-binned refusal, a higher-revision/reordered retry success with another blocker retained, plus stale owner, status, creation identity, current asset, hash, and frozen input refusal; service coverage proves retry-download does not touch pricing, authorization, or dispatch. All twelve locales carry placeholder-compatible blocker copy, and the new runtime helper is in the explicit Creative Studio coverage manifest.

- [x] **[BUG-159][P3][Creative Studio] `remove_reference_image` has no undo label in any of the twelve locales** — found 2026-08-27 by adversarial review of `18ef05f4e`; **resolved 2026-08-27**
  - A new persisted enum value reaches `undoHistory[].label` with no reader mapping. Single-op batches persist the raw `kind` (`mutations/index.ts:2140`) and `StudioPage.tsx:2735` sends exactly one op, so the stored label is the literal `'remove_reference_image'`. It renders through `t(...undoLabel.${label}, { defaultValue: ...undoLabel.unknown })` (`WorkspaceControls.tsx:412`), and the key is absent from all twelve locale files — while its sibling `select_reference_image` is present in all twelve.
  - **What the user sees.** Remove a reference photo, then read the Undo button: _"Undo: last authoring change"_ instead of naming the removal, in every language. Degrades gracefully via `defaultValue` — no raw key leak, no crash — which is why it is P3.
  - **Nothing guards it, and that is the durable point.** `studioI18n.test.ts:891-922` is a **hand-maintained literal list** that this commit did not extend, and the template-literal key defeats the typed key union. Deriving that list from `StudioMutationOperationV2['kind']` would have caught this at commit time and would catch every future operation kind automatically. Worth doing once rather than filing this bug again.
  - **Resolution.** A shared runtime inventory is derived from the already compile-time-exhaustive Director operation-disposition map, excluding only `undo_last`; the i18n inventory derives every single-operation undo key from it. The audit exposed four missing labels, not one: `remove_reference_image`, `dismiss_seed_still`, `select_video_take`, and `remove_video_take`. All four are authored in all twelve locales, and reducer tests assert that each accepted singleton persists its exact operation kind as the undo label.

- [ ] **[BUG-160][P2][Creative Studio] A pending Director proposal becomes unacceptable once later Director cards push its card out of the rail, and the chat fallback refuses to help** — found 2026-08-27 driving the Director as a user on `Plateau` (`748ae58b…`)
  - **Actual.** The Director proposed **36 shooting-script edits** across two proposals (32 + 4, correctly respecting `STUDIO_MAX_MUTATION_OPERATIONS`). Both persisted as `status: 'pending'`. Then a reference-generation handoff I approved produced newer cards in the Director rail, and the proposal card — the only surface carrying **Accept proposal** / **Reject proposal** — **disappeared entirely**. Scanned the full rail scroll range (0 → 6000px in 600px steps): no proposal card, and **zero Accept or Reject controls anywhere in the document**.
  - **The documented fallback refuses exactly this case.** `proposals.chatMultiplePending` reads _"More than one Director proposal is pending. **Use the buttons on the exact card.**"_ — so with two pending proposals the chat path deliberately defers to buttons that no longer exist. Asking the Director in chat to "Accept the pending proposal" produced no controls and no acceptance.
  - **Escalation: the work is not merely unreachable, it is unrecoverable.** Calling `acceptProposal` directly over IPC — the developer escape hatch no user has — refuses **both** proposals with `stale_project`. So there is no path, UI or otherwise, that can apply those 36 edits. The only remedy is to ask the Director to redo the whole turn.
  - **The work is not lost on disk, but it is dead.** Both proposals remain intact on disk under `proposals/`, `payload.operations` carrying all 36 `edit_shot` operations. `listProposals` still returns them as `pending`. There is simply no user action that can apply or discard them.
  - **Contributing factor: the accepted work invalidated its own proposals.** Both were built on revision 18; approving the reference regeneration the Director itself requested moved the project to revision 22. So even a surviving card would likely have shown `proposals.reviewStale`. The trap is that a Director turn which both proposes edits _and_ requests generation can invalidate its own proposal as soon as the user approves the generation — the two halves of one turn fight each other.
  - **Why P2.** A whole Director turn's work — 36 edits, minutes of model time — is destroyed by ordinary use, with no error and no explanation. The user is not told the proposal is gone; the card simply is not there any more. Recovering needs `acceptProposal` over IPC, which no user has.
  - **Fix direction.** A pending proposal needs a surface that does not depend on its position in a scrolling conversation — a persistent pending-proposals affordance in the workspace, not only a chat card. Separately, allow the chat path to disambiguate (accept by id, or "accept the most recent") rather than refusing whenever more than one is pending, and surface a stale proposal explicitly with a re-propose action instead of silently dropping it.
  - **How it was found, and why it matters.** Every earlier session drove the engine over IPC and never saw this. It appeared on the first attempt to use the Director the way a pilot user will: ask in plain language, approve what it asks for, then try to accept what it proposed. The engine was fine throughout; the product path was not.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — post-Pilot Director proposals and review.
    - **Rationale:** Pilot 1 has no proposal-producing operation, so it must not carry an empty review
      surface. When proposals return for later modalities, a pending proposal must remain discoverable
      and decidable independently of later Director messages, while stale proposals receive a visible
      re-proposal path rather than disappearing.
    - **Acceptance evidence:** UI tests must create multiple later Director messages and show that the
      pending proposal remains in its one review location with working accept and reject actions.
      Stale and refused proposals must remain visible with bounded update or dismissal actions, and
      reload must preserve the same catalogue and decision status.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-161][P2][Creative Studio] A refused Director proposal is reported as containing "an unsupported change", when nothing is unsupported and the real cause is explicable** — found 2026-08-27 driving the Director on `Plateau` (`748ae58b…`)
  - **Actual.** Asked to rewrite 36 existing shooting scripts, the Director proposed six `apply_coverage` operations, one per Beat. The card rendered **"This proposal contains an unsupported change and cannot be accepted."** with Accept disabled. `acceptProposal` returns `mutation_refused` / **`dependency_blocked`**, and `proposal.review` reports `status: 'unavailable'`, `reason: 'reducer_rejected'`.
  - **Nothing is unsupported.** `apply_coverage` is fully implemented (`mutations/index.ts:547`, `:1786`), and it is one of the six kinds the Director is **explicitly permitted to propose** (`STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2`, disposition `proposal`). The operation was also well-formed: all four required keys (`kind`, `beatId`, `shots`, `fixedShots`), six shots per Beat, `durationSeconds` and `chainBreak` matching the stored Shots exactly.
  - **The real cause, which the message never hints at.** `fixedReasons` (`mutations/index.ts:1067`) marks a Shot **fixed** when `shot.shootingScript.length > 0`. All 36 Shots had scripts, so `expectedFixed` was all 36 while the Director sent `fixedShots: []`, and `if (!sameValue(operation.fixedShots, expectedFixed)) fail('dependency_blocked')` refuses. Even with a correct `fixedShots`, the reducer then refuses any fixed Shot whose `shootingScript` differs from the stored one — so **`apply_coverage` can never rewrite an existing script**. It is a tool for filling in coverage on Shots that have none.
  - **Two defects, one symptom.**
    1. **The message is wrong and unactionable.** `proposals.reviewUnavailable` collapses a specific, explicable `dependency_blocked` into "unsupported change". A user cannot learn from it that the Shots already have scripts, that `apply_coverage` cannot touch them, or that `edit_shot` would work. This is the **fourth** instance this session of a precise cause reported under a generic label — see **BUG-140**, **BUG-147**, **BUG-158**.
    2. **The Director cannot avoid choosing it.** It has no way to know a Shot counts as "fixed", so nothing stops it selecting an operation that is structurally incapable of satisfying the request. It had used `edit_shot` correctly on its own first attempt; a later turn regressed to `apply_coverage` and burned an entire turn.
  - **Fix direction.** Surface the reducer's actual refusal code and subject on the proposal card — "these Shots already have scripts; `apply_coverage` cannot replace them" — rather than "unsupported change". Separately, either expose fixed-ness to the Director so it can pick a viable operation, or reject `apply_coverage` at proposal time with a message the Director can act on and retry from.
  - **Reproduction.** On a project whose Shots all have shooting scripts, ask the Director to rewrite them. Observed on `Plateau`; the refused proposal is `c38f15f6`.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — film capability contracts and proposal review.
    - **Rationale:** The current refusal arises from Beat and Shot coverage operations, which do not
      exist in Pilot 1. When film composition returns, the Director-visible capability and reducer
      must agree on legal changes, and every refusal must expose its precise cause and remedy.
    - **Acceptance evidence:** Capability tests must prove the Director cannot emit an operation that
      its reducer rejects as unsupported. Dependency-blocked fixtures must identify the fixed Shots,
      explain why replacement is refused and name the legal edit path; the proposal UI and Director
      transcript must preserve that same reason after reload.
    - **Claimant:** Unclaimed.

- [x] **[BUG-162][P3][Creative Studio] The Director reports "All done — everything went through as planned" when it has done nothing of the kind** — found 2026-08-27 across four Director turns on `Plateau`; **re-resolved 2026-08-31 after the durable-recap fix regressed on compacted read output**
  - **Actual.** The literal string _"All done — everything went through as planned. Tell me what you'd like to do next."_ was emitted at the end of turns where:
    - the reference plan had been created but **zero of 36 Shots were bound** (bindings were impossible at that point, because binding requires an approved reference — the sequencing was right, the claim was not);
    - a reference generation had only been **queued for the user's spend approval**, not performed;
    - a proposal had been created that the engine then **refused outright** (`dependency_blocked`, BUG-161) — nothing went through at all.
  - **Why it matters.** The message is the Director's turn-completion summary, so it is the main signal a user has that a turn achieved something. Asserting success while work is pending approval, impossible, or refused trains the user to distrust it, and hides the cases where they genuinely must act — approve a spend gate, accept a proposal, or re-ask.
  - **Note the contrast.** The Director's _structural_ behaviour was correct throughout: it stopped at every spend gate, refused to bind before approval, and respected the operation cap. Only the prose overclaims. This is a summary-generation problem, not a capability one.
  - **Fix direction.** The completion line should be derived from what actually committed in the turn — operations applied, proposals created and their review status, requests awaiting the user — rather than asserted. When a turn ends with the user owing an action, say which action.
  - **Resolved 2026-08-30 — the Director recap now follows durable Studio outcomes.** The Studio-owned Aionrs surface installs a scoped interpreter without changing generic chat. It recognizes only the exact built-in Studio tool identity, independently versioned command/proposal records, exact receipt shapes and the current Main-correlated proposal catalogue; stale, mismatched, replay-ambiguous, malformed or truncated evidence fails closed. A successful transport can no longer turn a pending proposal, queued generation request, refusal, cancellation or uncertain command into a success claim.
  - **Truthful lifecycle and next actions.** Committed, pending-review, waiting-authorization, stale, refused, failed, cancelled, unconfirmed, terminal-indeterminate, read-only and unknown results have distinct localized recaps. Mixed turns preserve pending human work and uncertainty rather than inviting an unsafe retry. Exact command-status receipts resolve only the same durable command identity; a busy result cannot borrow the incumbent command's later success. Plan-only Director activity emits no synthetic completion line.
  - **Focused evidence.** The final focused audit passes **331/331** tests across the recap builder, DOM summary, Director rail and Aionrs provider boundary. It includes accepted and reducer-refused proposals, queued reference authorization, failed and cancelled transport, terminal indeterminacy, stale/erroring catalogues, wrong sidecar versions, skipped revisions, malformed/truncated results, real `IMessageToolGroup → normalize → coalesce → interpreter` and `IMessageAcpToolCall → normalize → coalesce → interpreter` paths, conflicting retained proposal inputs, exact proposal/payload/review authority, busy-command isolation, uncertainty dominance, all 12 locales and generic-chat isolation. Typecheck, i18n generation/validation and diff checks pass; the explicit Creative Studio coverage manifest includes every changed runtime file.
  - **Regression root cause.** `turnRecap.ts` currently converts every terminal call carrying
    `_compact.truncated: true` to `unknown` before considering the exact Studio tool contract, and
    `buildTurnClose.ts` deliberately ranks `unknown` above `committed`. The Director rules require
    `studio_get_project_status` with `detail: true` immediately before acting; that exact read-only
    response routinely exceeds the roughly 4 KB persisted-preview threshold. A turn can therefore
    contain a valid durable mutation receipt followed by a successfully completed, compacted project
    status read, yet close with **"The Studio result could not be interpreted. Do not retry"** instead
    of reporting the proven commit. Flipping only the compaction marker while holding the payload and
    turn outcomes constant reproduces the regression.
  - **Narrow repair boundary.** An explicit compaction marker on a completed, exactly identified
    _observation-only_ Studio tool is benign only when a nonempty bounded preview remains. The bounded
    set is `read_storyboard`, `studio_get_conditioning_frame`, `studio_get_project_status` and
    `studio_list_routes`; none can commit or resolve a project mutation. Classify that case as
    `observed`, so it cannot erase a separately proven commit, pending review or waiting
    authorization. Do not infer this set as the complement of mutations. In particular,
    `studio_get_command_status` is a transport read that can resolve a prior mutation, so its
    truncated result remains `unknown`. A truncated `studio_get_proposal` resolves only when its
    exact bounded input identifies one proposal in the already validated current renderer catalogue;
    that catalogue supplies `pending_review`, `committed`, `refused`, or `needs_revision`. Missing,
    stale, duplicate, mismatched, or malformed input/catalogue authority remains `unknown`, as do
    truncated mutations, proposal-writing/reference-request tools, ambiguous Studio identity, and
    missing, empty, oversized, or unmarked malformed output.
  - **Required regression evidence.** Focused interpreter, aggregation and rendered-summary tests
    must prove: a durable commit plus a compacted detailed project-status read reports `committed` in
    either order; `pending_review` and `waiting_authorization` survive that same read without becoming
    `mixed_attention`; and a compacted observation-only call by itself reports `observed`. The inverse
    cases must prove that a compacted mutation or ambiguous read/mutation identity still outranks a
    separate commit as `unknown`, a compacted command-status call cannot resolve an earlier
    `unconfirmed` command; compacted proposal lookup resolves only through its exact requested id and
    current catalogue; and missing, mismatched, stale, or malformed proposal authority plus malformed
    unmarked read output remain `unknown`. Transport error and cancellation must continue to report
    `failed` and `canceled` before output inspection.
  - **Re-resolved independently on the shared CS3 base by `15d50a0b8`.** Compacted pure observations
    remain benign, while a compacted proposal read is authoritative only when every retained input is
    an exact, agreeing proposal identity and the current renderer catalogue has an exact
    proposal/payload/review envelope. Missing, conflicting or malformed authority stays `unknown`.
    Creative Studio coverage passed **673 files / 10,778 tests** with `turnRecap.ts` at **86.22% branch
    coverage**; the uninstrumented full suite passed the same 673 files and 10,778 tests.
  - **Fixed by `15d50a0b8`.** This repair was authored and reviewed on
    `fix/studio-director-phase-zero-base`, branched from the current shared CS3 base, before being
    admitted to the CS4 lineage.
  - **CS4 triage**
    - **Disposition:** Fix before CS4.
    - **Destination:** Prerequisite tranche before Phase 1.
    - **Rationale:** The shared turn recap treats transport completion as domain success. CS4 relies on
      the retained Director rail for capability outcomes, so building on this false success signal
      would make waiting authorizations look complete in Pilot 1 and refused proposals look complete
      in retained/shared Director flows.
    - **Acceptance evidence:** Focused recap tests must cover an accepted proposal, a reducer-refused
      proposal, a generation waiting for authorization, a failed tool and a cancelled tool, plus the
      compacted-read matrix above. Only a durable committed outcome may produce the committed recap;
      every other case must state its actual status and next action, while a benign compacted pure
      observation must not conceal a separately proven outcome.
    - **Claimant:** `fix/studio-director-phase-zero-base` — independent shared-CS3-base repair.

- [x] **[BUG-163][P2][Creative Studio] A Director conversation interrupted by an app restart never recovers, and the Retry button that promises to recover it does nothing** — found 2026-08-28 verifying `44cb0a16c` against pre-existing projects
  - **Actual.** After the app was killed mid-session, three existing projects show the Director rail in an error state: _"Director setup was interrupted before the conversation could be attached to this project. Creative Studio could not complete the Director attachment. **Retry to recover it safely.**"_ Clicking **Retry** changes nothing — polled for **two minutes**, the rail never gains a composer. The state **survives a full application restart**. `Retry` is the **only** affordance rendered; no start-fresh, no detach, no way to rebind.
  - **Not a regression in the new code.** A **brand-new project attaches in under 8 seconds** on the same build — composer present, Director already thinking. So the merged commits are fine; what fails is recovery of a conversation binding that was interrupted. Measured across the library: `Plateau` INTERRUPTED, `Mochi Morning` INTERRUPTED, `Light on Water` never finished "Starting the Creative Director…", `Attach Probe` (fresh) attached immediately.
  - **The MCP side is healthy.** `getDirectorSessionAuthority` returns a complete, correct authority for every affected project — `serverId`, `serverName: 'aionui-creative-studio'`, `scriptPath`, `projectDir`, `pendingDir`, `referencePendingDir` all resolve. The failure is confined to binding a conversation to the project, not to the Studio MCP server.
  - **Why P2 rather than P1.** Until `fba9b3cca`, this would have been unrecoverable in the strong sense: there was no renderer call site for `add_beat` or `add_shot`, so a project whose Director was dead could never gain shots by any means. That commit added user-side authoring (`WorkspaceControls.tsx:356`, `:390`), so an affected project can still be worked by hand. The Director — the only path for **Rule A**, drafting the storyboard — remains dead on it.
  - **What it costs in practice.** `Plateau` carries 36 Shots, 28 rendered and **$7.27** of paid work; it can no longer be directed. Any user whose app crashes, is force-quit, or is updated mid-Director-session loses the Director on that project permanently, having been told a button would fix it.
  - **The copy is the second defect.** "Retry to recover it safely" is a promise the control does not keep. Either the recovery must work, or the message must say the conversation cannot be recovered and offer to start a new one — this is the same honesty-of-failure family as **BUG-140**, **BUG-147**, **BUG-158** and **BUG-161**.
  - **Fix direction.** Give the interrupted state a real exit: rebind to a fresh conversation for the project, discarding the unrecoverable one, and say plainly that prior Director history is lost. Note `director.startFresh` exists as a concept in the codebase but is not rendered in this state. Whatever lands, the test is a live one — kill the app mid-Director-turn and reopen the project.
  - **Original live reproduction.** `Plateau` (`748ae58b…`) and `Mochi Morning` (`68af3df4…`) were both interrupted on 2026-08-28. That reproduction was consumed by the pre-revert live verification: those projects now carry the rules profile, and `Panel Check` supplied the proving stale conversation instead. Current-head verification therefore needs another stale-profile conversation or a newly interrupted setup rather than assuming the original two remain broken.
  - **Correction 2026-08-30 — the existing conversation is recoverable and must not be discarded.** A project with a `briefConversationId` reuses its bound conversation; it does not call the fresh-binding path. The failure is the stale Director-rules repair that runs before reuse.
  - **Root cause.** `conversation.update` is declared as returning a boolean, but the running backend has been measured returning the full persisted conversation record, and an empty successful HTTP body may resolve `undefined`. Transport failures throw. `refreshDirectorPresetRules` required the resolved value to be exactly `true`, so it aborted after a successful PATCH and never reached its proving readback. Retry repeated the same false test forever.
  - **Implemented 2026-08-30 — ignore the PATCH echo, not the proof.** A thrown PATCH still fails. Any resolved PATCH proceeds to a separate exact GET, and the rail attaches only after that record proves the conversation id, MCP snapshot, persisted project authority and current rules profile. The existing conversation and its history remain intact; no replacement conversation is created or rebound. The per-project/conversation/profile attempt cache still bounds automatic retries, while the explicit Retry button grants one new attempt.
  - **Focused evidence.** The current Director rail suite passes **96/96** tests covering the live full-record echo, an empty successful response, a thrown write, exact readback, explicit Retry without create/rebind, repeated history refreshes without a write loop, one shared proof across remount, and the irrecoverable dangling-authority path. That last path stops without creating and truthfully offers **Start fresh**; it creates a replacement only after the click.
  - **Resolved 2026-08-30 — current-head live restart/recovery passed.** On branch head `296c7c579992`, the opt-in Electron E2E created a new Studio project in the fixture's disposable `aionui-e2e-state-*` profile and registered a loopback-only deterministic OpenAI-compatible SSE provider. It let AionCore persist the Director conversation while withholding the create response from the renderer, completed one real local turn, preserved its two message ids, forced the saved rules profile stale, and sent `SIGKILL` to Electron before attachment. No paid provider or existing project was used.
  - **Restart proof and recovery oracle.** The fixture observed the dead process and relaunched against the same isolated profile: Electron pid **92561 → 92664** and renderer-discovered backend port **57997 → 58019**. The rail found the one unbound claimant and stopped in the interrupted state rather than creating or looping. **Retry** rebound the exact conversation `c2561185`; its two original message ids survived, exact readback proved the current profile `studio-director-rules-v1:2d7e:f4e014d5`, the catalogue still contained exactly one claimant for project `cc51513d_da7e_449d_bec7_7cc824844fc6`, and a new composer turn finished through the local provider, growing history from **2 → 4**. Provider turn count was exactly **2**. Playwright reported **2 passed (30.0s)**. Teardown removed the disposable project/profile data; a late managed-tool task recreated only an empty staging-directory skeleton, which the verification moved to Trash, then confirmed the original `aionui-e2e-state-bX2nSi` path absent.
  - **Fixed by `0d9a8e01f0`.** The repair keeps the existing Director conversation as the only claimant, distrusts the PATCH echo, proves persisted authority and rules by exact readback, bounds automatic attempts, and lets an explicit retry reuse the same candidate.
  - **Separate platform follow-on.** The shared `conversation.update` bridge is still globally declared `Promise<boolean>` although successful writes can return a record or no body. This Director path is safe because it distrusts the echo and re-reads; other callers that branch on the declared boolean need a separate endpoint-contract audit rather than a broad change hidden inside this repair.
  - **CS4 triage: fixed before CS4.** CS4 keeps the Director rail and its conversation binding unchanged, and the cutover rewrites `DIRECTOR_PRESET_RULES`, which drives exactly this stale-rules repair path. The runtime fix `0d9a8e01f0` is already an ancestor of the shared CS3 base, and the current-head live kill-and-reopen pass above is complete. The deterministic restart harness is retained in the independent Tranche 0 branch as regression evidence. _Closed; no longer blocks Phase 2._ Claimant: complete.

- [x] **[BUG-164][P3][Creative Studio] Undecidable Director proposals accumulate forever in the new proposal surface, and the only way to clear one is to reject it individually** — found 2026-08-28 verifying BUG-160's fix (`195c3e345`) on `Plateau`
  - **Resolved 2026-08-28.** One terminal proposal remains visible for immediate recovery; an accumulation of two or more verified stale or reducer-refused proposals collapses into one counted disclosure. Expanding it preserves each exact proposal, its refusal/staleness evidence, **Prepare updated proposal**, and individual Reject. Refreshing, unverified, and in-flight proposals never enter the collapsed group, and no proposal is automatically rejected or discarded.
  - **This is BUG-160's fix working, with an unhandled consequence.** Proposals no longer evict from the Director transcript, which was the whole defect. But nothing ever retires one, so the surface now shows **every proposal ever left undecided**, permanently, at the top of the rail.
  - **Actual.** `Plateau` displays **four** proposal cards, all created 2026-08-27, against a project now at revision **1033**:

    | id         | ops                | base | why it is still here                     |
    | ---------- | ------------------ | ---- | ---------------------------------------- |
    | `4ded2271` | 32 `edit_shot`     | 18   | staled before it could be accepted       |
    | `52bbd596` | 4 `edit_shot`      | 18   | its sibling, staled by the same event    |
    | `c38f15f6` | 6 `apply_coverage` | 22   | refused by the reducer (**BUG-161**)     |
    | `19b651f4` | 18 `edit_shot`     | 22   | staled the instant its pair was accepted |

    Every one reports `review.status: 'stale'`, so **Accept is disabled on all four** — they are not merely old, they are permanently unacceptable. The only way to remove one is **Reject**, pressed once per card. There is no dismiss-all, no age-based retirement, and no automatic retirement of a proposal whose review can never become `ready` again.

  - **Escalation, observed 2026-08-28: they displace the view, not just clutter it.** With four stale proposals pending on `Plateau`, opening the **Board** renders the proposal stack where the Beat rows and Shot tiles should be — beat headers disappear from the page entirely. The accumulation is not confined to the Director rail; it crowds out the monitoring surface the user opened.
  - **The count only grows.** These four came from a single afternoon's work. A project worked across several sessions accumulates one card per abandoned Director turn, forever, above the content the rail exists to show.
  - **Not a defect: the accepted ones are correctly hidden.** Worth recording because it looks wrong on disk. The proposal records for `ac3c2826` and `931974f1` still read `status: 'pending'` in their own files; their decisions live in **separate sibling records** (`{decidedAt, proposalId, status}`). Main reconciles the two on read — `listProposals` reports both as `accepted` — so the renderer's `pendingDirectorProposals` filter (`DirectorProposals.tsx:47-48`), which tests `status === 'pending'` with no join, is correct. **Verified, and deliberately not filed as a second bug.**
  - **Fix direction.** Retire a proposal automatically once its review can never return to `ready` — a stale proposal on a revision the project has moved far past is not a decision the user still owes. If some record is wanted, collapse them into a count or a disclosure rather than a stack of cards. Failing that, at minimum offer a bulk dismiss. **Prepare updated proposal** (the new re-propose action) is the right primary for a stale card; Reject should not be the only way to reach an empty list.
  - **Live reproduction.** `Plateau` (`748ae58b_386f_452c_b4b1_6c3819fb02ed`) holds all four as of 2026-08-28. Do not clear them; they are the repro. Note the Director on this project is also un-attachable — see **BUG-163** — so the cards cannot currently be re-proposed either.
  - **Held aside 2026-08-30** at `config/creative-studio-held-aside/748ae58b…` and no longer visible in the app, because leaving it in place broke Creative Studio for every project in the profile (**BUG-179**). Move the folder back to reproduce.

- [ ] **[BUG-165][P1][Creative Studio] Chained video generation — the continuity chain, the product's central mechanism — succeeds only about a third of the time; prompt authoring lacked sight of the inherited frame** — found 2026-08-28 investigating a shot that "keeps failing" on `Plateau`
  - **Measured over 84 real generation attempts on one 36-shot film:**
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — continuity-aware film generation.
    - **Rationale:** Chained video and inherited frames are outside the one-photo pilot but remain a
      core film rule. Phase 6 must give the Director the exact reviewed predecessor frame and preserve
      its selection in the quoted request rather than relying on prompt-only repair.
    - **Acceptance evidence:** A trim-aware fake-adapter scenario must extract the predecessor's
      reviewed terminal frame, expose it to Director troubleshooting, freeze its asset ID and hash in
      the quote, and dispatch exactly that frame after revalidation. Cancellation, retry and reload
      tests must never substitute an unquoted frame; the film E2E must complete a multi-Shot chain.
    - **Claimant:** Unclaimed.

    | path                                                          | attempts | succeeded | rate    |
    | ------------------------------------------------------------- | -------- | --------- | ------- |
    | `seed_still` (image, unconditioned)                           | 8        | 7         | **88%** |
    | `video_take` conditioned on a **seed still** (Beat head)      | 7        | 6         | **86%** |
    | `video_take` conditioned on a **predecessor frame** (chained) | 69       | 22        | **32%** |

    Same model (`bytedance/seedance-2.0`), same project, same session. The only variable that moves the success rate is whether the take is conditioned on a **predecessor frame** rather than a seed still.

  - **It is not the shot, and not the content.** The user reported one shot as "keeping failing" (`sh_clash_3`, 8 failures). It is not special: `sh_clash_2` needed **11 attempts to succeed once**, and `sh_escalation_3` has failed **19 times**. I tested and rejected a content-moderation hypothesis — violence vocabulary does not predict failure. `sh_escalation_3` fails repeatedly with **zero** violent words, while `sh_power_2` ("kicks"), `sh_power_6` ("fists"), `sh_turn_6`, `sh_finish_2` and `sh_finish_5` (all "fist") rendered successfully. Mean violent-word count is 0.25 for rendered shots and 2.00 for failing ones — a difference produced by a single shot, not a signal.
  - **It is not our concurrency either.** Peak in-flight was 4-5 jobs, capped structurally by the chain (a Beat cannot render its next Shot until the previous one lands). Rate limiting has its own code (`429 → rate_limited`, `openRouterVideoAdapter.ts:233`) and never appeared once.
  - **Every failure reaches the provider and then dies.** All 46 failed jobs carry a real `providerJobId`, so the submission was accepted and the _generation_ failed. All are billed **0**, so no money is lost — the cost is entirely time and completion.
  - **Provider evidence correction.** The adapter now records sanitized evidence when a successful poll response carries a terminal failure. The observed Seedance responses had no error code, upstream code, or message at all, so these jobs honestly remain `unknown`; there is no hidden provider detail left to recover.
  - **Why P1.** The continuity chain _is_ Creative Studio: every Shot after the first in a Beat is conditioned on its predecessor's last frame, and that is the feature that makes a film rather than a pile of clips. At 32% it takes ~3 paid-but-free-on-failure attempts per Shot, and a 36-Shot film needed **84 attempts to place 35 takes**. Two Shots never landed at all after 8 and 19 tries. Without an automatic retry loop — which the app does not have; I had to write one — a user simply sees Shots that will not render.
  - **The original diagnostic and escape-hatch work is already present.** Terminal provider evidence is retained, and a human can review a paid hard cut/reseed or rejoin through the continuity spend gate. The free reducer still refuses `set_hard_cut` deliberately: changing continuity can require a paid seed and therefore remains owner-only.
  - **Root cause, partly established by experiment 2026-08-28: a chained prompt can contradict the frame it must start from.** A chained Shot's first frame is fixed by its predecessor's last frame, but the Director writes every prompt **without ever seeing that frame**. When the prompt describes a composition the frame cannot become, the model fails silently and deterministically.
    - `sh_escalation_3` had failed **19 consecutive times**. Its conditioning frame is a low-angle wide of floating boulders in which KAEL does not appear at all; its prompt demanded _"Close camera tracks from KAEL's bronze forearm guards to his hands"_. Rewritten to open on the frame as given and crane to find him, it rendered **on the first attempt**. At the measured 32% base rate, 19 straight failures is roughly a 1-in-1400 event, so this was not luck.
    - **The rule for chained prompts:** describe where the frame already is, then move. Never open on a subject the predecessor's last frame does not contain.
  - **A second, distinct cause remains unidentified.** `sh_clash_3` has now failed **15 times with zero successes**, five of them with a frame-aware rewrite. Its frame _does_ contain both characters in a composition the prompt can plausibly reach, so prompt contradiction does not explain every failure. Re-rendering the predecessor to obtain a different frame also failed — `sh_clash_2` itself failed on that attempt (12 attempts, 1 success across its life), so no new frame was produced and the retry ran against the same one.
  - **The provider supplies no reason, and that is now proven rather than assumed.** The adapter was fixed to emit evidence when a poll reports failure (previously only HTTP errors were reported, so a `200` carrying `status: 'failed'` was silent). The evidence returns `errorCode: null`, `upstreamCode: null`, `messagePresent: false` — **Seedance reports failure with no error object at all.** The fix is worth keeping: it proves there is nothing to extract, and will surface a reason the moment one is sent, including the `InputImageSensitiveContentDetected` case the adapter already anticipates.
  - **Implemented 2026-08-30 — exact frame sight for an existing chained Shot.** `studio_get_conditioning_frame` accepts only the dependent Shot ID. The app derives the active predecessor, selected take and trim-aware endpoint, returns the exact ready `conditioningFrames` image only after bounded path, size, MIME signature and SHA-256 verification, and reasserts project authority after the read. Missing, pending, failed and non-chained states are typed and text-only. The Director is instructed to start a revision from what the frame already shows, then move; it cannot select a path or asset, write, generate, quote, authorize, or spend through this tool.
  - **Compatibility limit.** The evidence is MCP image content. The Director is instructed to stop and state the limitation when its active model cannot inspect that image; the rail does not currently restrict model selection to vision-capable models. A live Director-model ingestion pass remains required before claiming this slice works on every configured model.
  - **Still open — first-run chain workflow.** The downstream prompt and quote freeze before its predecessor frame exists, so this read can repair an existing failed chained Shot but cannot make the initial cascade frame-aware. Completing that prevention requires a product choice: defer downstream prompt authoring/quote until the frame exists, add a reviewed frame-aware rewrite and reconfirmation step, or choose another explicit workflow. Silently changing the frozen prompt after authorization is not acceptable.
  - **Still open — bounded automatic retry requires a pricing decision.** A second provider attempt needs a second authorization idempotency key and therefore `generationCount: 2`. Today that count is legal only for reference images, whose quote deliberately reserves the retry in its upper bound. Extending it to chained video honestly doubles the displayed upper bound for the common paid action even though measured failures billed zero; reusing one key is unsafe. Product must choose the quoted presentation before engineering enables this.
  - **Live reproduction.** `Plateau` (`748ae58b_386f_452c_b4b1_6c3819fb02ed`) retains all 84 job records with their conditioning inputs, plus two Shots that never rendered — `sh_clash_3` (8 failures) and `sh_escalation_3` (19). Do not clear them.
  - **Moved 2026-08-30, and it is no longer visible in the app.** `Plateau` now sits at `config/creative-studio-held-aside/748ae58b…`, intact — 154 files, 137 MB, all 48 hardlinked files preserved — because leaving it in place broke Creative Studio for every project in the profile (**BUG-179**). Move the folder back into `config/creative-studio/` to reproduce; expect BUG-179 to return with it until that entry is fixed.
  - **Item 1 is now implemented and, on the configured model, does nothing — measured live 2026-08-30.** `studio_get_conditioning_frame` (`5a5a9ea6d`) resolves the predecessor's exact trimmed last frame and returns it to the Director as an inline image. Driven end to end on `Light on Water` shot `water_02`, the tool **succeeded** — the turn reported _Finished the next step_ — and the Director then answered:

    > I can't inspect the returned image in this interface, so I can't truthfully describe the horizon, water surface, or any disturbance on it.

  - **Corrected after further testing: the frame reaches the model intact, and the model is vision-capable on paper. It still will not look.** Three facts, each measured in the correct conversation (`8860aef1`):
    - **The attachment arrives.** Asked to report only what it received, the Director returned `mimeType: image/png`, `byteSize: 288390`, `sha256: 34bcd878…` and _"Yes. A separate image/png attachment accompanied the result text."_ Those match the file on disk byte for byte and hash for hash. The MCP image block is delivered.
    - **The model accepts image input.** OpenRouter lists `openai/gpt-5.6-terra` with `input_modalities: file, image, text`, tool support, and a 1,050,000-token context.
    - **It nevertheless refuses to read it**, twice, in different words: _"I can't inspect the returned image in this interface"_ and _"I can't inspect the attached image here."_
  - **Narrowed 2026-08-30: the tool result reaches the model; only its image half does not.** Asked to report the result rather than the picture, the Director quoted `mimeType: image/png`, `byteSize: 288390` and `sha256: 34bcd878ac31f465dfd5b0519db8fea61331c241dd0b5904f0ac7f97a733b22a` — all three matching the file on disk exactly. So the **text** content block of the tool result is delivered and read. Asked three separate times, in the correct conversation, to look at the accompanying image, it refused each time. The failure is specific to the `{ type: 'image' }` content block, not to tool results in general.
  - **Where it is lost was not determined, and the available instrumentation cannot determine it.** `AIONUI_DUMP_PROMPTS=1` adds `--dump-prompts`, but it writes exactly two files per turn — the system prompt and the initial input — both **before** any tool executes; there is no dump of the provider request that follows a tool result. AionCore logs no request bodies at debug level, and it is a separate binary whose source is not in this repository. The remaining route is intercepting TLS to a third-party API, which is not worth doing casually.
  - **What would settle it**, in increasing cost: a dump point in AionCore after tool results are folded into the next request; or its source, to read how MCP `image` content is converted for the provider. Until then the three live hypotheses are that AionCore drops the binary when building the request, that it forwards it in a shape OpenRouter ignores, or that the model declines images arriving in a tool-result role.
  - **So this is not a plumbing bug in Studio's own code and not a routing decision, which is what it first looked like.** An earlier note here claimed the configured model could not inspect images; that was wrong and is retracted. Whatever is stopping it sits between a delivered attachment and a capable model — a provider-side modality flag, how the MCP image part is framed on the request to OpenRouter, or the model declining images that arrive as tool results rather than as user content. The comparison against a user-attached image was attempted and could not be run: the composer's attachment path is a native dialog that `DOM.setFileInputFiles` does not drive.

  - **The test was designed to catch a confabulation, and did not find one.** The frame chosen shows a distinct concentric ripple ring, while that Shot's own shooting script says _"Glassy still sea … unbroken"_ — so a model reciting the script rather than reading the image would have described stillness. It refused instead. The guardrail in `openingTurn.ts` — _"If your active model cannot inspect the attached image, state that limitation and do not submit a frame-aware revision"_ — held.
  - **The guardrail did its job, and that is now the only reason this is not silently wrong.** Codex's rule — _"If your active model cannot inspect the attached image, state that limitation and do not submit a frame-aware revision"_ — is what turned an invisible failure into a visible one. Without it the Director would have described a frame it never read.
  - **That guarantee still lives in a prompt, and it was one trial.** `requiresVisualInput: true` is emitted in the tool's metadata and consumed by **nothing**: there is no capability check anywhere in the tree. A model that believes it can see would produce exactly this entry's original failure — a prompt contradicting the frame — with more confidence than before, because it now believes it has looked. Worth enforcing where the model is chosen rather than where it is instructed.

- [ ] **[BUG-166][P2][Creative Studio] No Board Shot tile can ever show a preview image, because nothing in the product ever captures a poster** — found 2026-08-28 by the owner on the new Board monitoring (`629293142`)
  - **Actual.** Every tile on the new Board renders an empty placeholder where its picture should be, including Shots that are `RENDERED` and have a playable MP4 on disk. Measured on `Plateau`: **0 of 30 rendered Shots carry a `posterAssetId`**, and the whole project's `thumbnails/` directory holds a single file.
  - **Root cause.** `boardShotTiles.ts:152` returns a picture only when `shot.currentPicture?.posterAssetId` is set. That field is written by the `creative-studio.persist-captured-poster` bridge call — which exists in `native/constants.ts:110`, `ipcBridge.ts:1362` and `payloadSchemas.ts:1008` and has **zero call sites anywhere in `packages/desktop/src`**. Nothing captures a poster, so nothing ever sets the field, so no tile can ever have a picture.
  - **Third dead-binding of this shape.** The declaration exists end to end — wire name, provider, payload schema — with no caller. Compare `retryJobDownload`, which looked identical until a grep on the correct identifier found its three callers; this one has none under any spelling.
  - **Why it matters more on the Board than it did before.** The Table showed one panel per Beat, so a missing picture was a gap. The Board is _thirty-six_ tiles whose entire purpose is to let the user see the film arriving; without pictures it is a status list with large empty rectangles. The design's own rule — "the panel column reports the state of the film without a status column: a drawing means not shot yet, a frame means shot" — cannot function at all.
  - **Fix direction.** Decide who captures the poster and when. The likely intent is a renderer canvas-capture at first playback, which would mean a Shot only gains a picture once someone plays it — acceptable for the Cut, useless for a monitor. A monitor wants the frame extracted at render time, and the chain already extracts a last frame per Shot (`frameExtractions`), so a first-frame extraction on the same path is the cheap option.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — generated clip blocks and poster projection.
    - **Rationale:** The old Board tile is deleted, but every clip block still needs a stable preview.
      CS4 must project a valid current poster when available and fall back to playable footage when it
      is not, using Main-owned media rather than view-local capture state.
    - **Acceptance evidence:** A video-generation integration test must publish a poster or the video
      fallback, project it onto the corresponding clip block, and retain it after reload. Fixtures
      with no poster, a rejected flat poster and a superseded poster must each select the correct
      preview without displaying an empty tile.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-167][P3][Creative Studio] Every Board tile claims its blocker details are unavailable for about a minute after the view opens** — found 2026-08-28 alongside BUG-166
  - **Actual.** On opening the Board, all 36 tiles render _"Blocker details are unavailable for this project revision."_ — including `RENDERED` Shots with no blockers at all. Measured after a reload: the message was on **36 of 36** tiles continuously for **56 seconds** before any tile showed real blocker content.
  - **Root cause.** `boardShotTiles.ts:236` sets `blockersAvailable: status !== null`, and `projectStatus` starts as `null` in `useStudioProject.ts:295` until its fetch resolves. `Board/index.tsx:221` renders the unavailable copy whenever the flag is false, so the empty initial state and a genuine per-revision mismatch are indistinguishable.
  - **The data is fine.** Invoked directly, `getProjectStatus` returns a complete object whose `projectRevision` **matches** the project's current revision exactly (1215 = 1215), with `blockerCount: 1` and all six stages. The wiring is also correct — `BoardView` accepts `projectStatus` and passes it to `deriveBoardShotTiles` at `Board/index.tsx:292`. Nothing is broken except what the user is told during the wait.
  - **Fix direction.** Distinguish "not loaded yet" from "unavailable for this revision". A loading state should be quiet — no copy at all, or a skeleton — and the alarming sentence reserved for the case it actually describes. Note the message names a revision mismatch that, in the observed case, was not occurring.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 5 — capability status in the canvas shell.
    - **Rationale:** CS4 removes Board tiles but still loads Main-owned capability state
      asynchronously. An initial or refreshing projection is not an unavailable capability, and the
      canvas must keep last-known good status while a refresh is in flight.
    - **Acceptance evidence:** Projection and UI tests must distinguish uninitialised, refreshing and
      unavailable states; refreshing must retain the previous status and must never render blocker
      copy. A cold Pilot 1 E2E must show a neutral loading state and transition once to the resolved
      capability without flashing “unavailable”.
    - **Claimant:** Unclaimed.

- [x] **[BUG-168][P1][Creative Studio] The Director rail retries its attach in an unbounded loop, rewriting a 7.6 KB payload ~25 times a second** — found 2026-08-28 by the owner ("the director rail keeps fluttering") on `Plateau`
  - **Actual.** The rail visibly flickers because it alternates between two states several times a second — _"Starting the Creative Director…"_ and _"Director setup was interrupted before the conversation could be attached to this project. Retry to recover it safely."_ Sampled 30 times at 350 ms, only those two states ever appear. It is not a rendering glitch; it is the attach being retried forever.
  - **Measured cost.** The app log grows **~9 KB per second**. In a 2000-line window: **667** `Conversation updated` events, **654** `PATCH /api/conversations/…` responses, and a matching stream of `GET /api/conversations`. The cycle is **PATCH → Conversation updated → GET → PATCH**, roughly 25 times per second, indefinitely.
  - **Correction on the CPU figure (2026-08-28).** This entry originally reported "Electron main 219.6% CPU, renderer 58.5%". That reading came from `ps`, whose `%cpu` on macOS is an **average over the process lifetime**, not current usage — inflated here by the dev-server bundling at launch. A 5-second `sample` of the same process while it was said to be at 272% found **every thread blocked in an idle wait** (`kevent64`, `mach_msg2_trap`, `semaphore_wait_trap`) across all 3374 samples. Treat the percentages as unmeasured. The loop itself is not in doubt — it rests on the event and log counts above, which were counted directly.
  - **What is being written each time.** `DIRECTOR_PRESET_RULES` is **7,609 characters**. `refreshDirectorPresetRules` (`DirectorRail/index.tsx:550-564`) guards with `if (conversation.extra.preset_rules === DIRECTOR_PRESET_RULES) return conversation;` — measured live, that equality is **false** — then PATCHes the full 7.6 KB and, on success, returns `withCurrentDirectorPresetRules(conversation)`, a **locally patched copy rather than a re-read**. If the persisted value does not come back byte-identical, the next pass fails the same guard and writes again. Roughly 190 KB/s of writes to the local API.
  - **The defect is the absence of a bound, not the mismatch.** Whatever makes the stored value differ — merge semantics on `merge_extra: true`, normalisation in aioncore, or a genuinely failed write — a reconciliation that can never converge must not retry at frame rate forever. There is no attempt counter, no backoff, and no give-up state in `refreshDirectorPresetRules`.
  - **It compounds BUG-163.** The two states it alternates between are precisely BUG-163's interrupted-attach message and the starting message, so this loop only appears on a project whose Director binding was interrupted. That also explains why BUG-163's **Retry** button appeared to do nothing when pressed: the attach was already retrying continuously, so a manual retry changed nothing observable.
  - **Why P1.** It makes the Director rail unusable on any affected project, and it writes hundreds of times per second to the conversation store. A user would experience it as the app becoming sluggish for no stated reason.
  - **Fix direction.** Bound the reconciliation: attempt once per mount, compare against a **re-read** rather than a locally patched copy, and stop after a small number of failures with a stated error instead of spinning. Separately, find why a 7.6 KB `preset_rules` write does not read back equal — that is the underlying mismatch, and **BUG-163**'s recovery cannot work until it is understood.
  - **Live reproduction.** `Plateau` (`748ae58b_386f_452c_b4b1_6c3819fb02ed`) reproduces on open, immediately. Conversation id `7c717bfd`.
  - **Fixed in `73213308b`.** Verified live 2026-08-28 on `Plateau`: **0** `PATCH /api/conversations` and **0** `GET /api/conversations` in a 20-second window on the Director rail, with app-log growth of **1,390 bytes** (~70 B/s) against the ~9 KB/s the loop produced. The rail no longer alternates.

- [x] **[BUG-169][P2][Creative Studio] A Shot that already holds usable footage reads FAILED on the Board when a later attempt fails, pushing the user toward a re-render they do not need** — found 2026-08-28 on the new Board monitoring
  - **Actual.** `sh_clash_2` on `Plateau` has `videoAssetId` set — a playable, current take from the one attempt of twelve that succeeded. A later re-render failed. Its Board tile reads **`FAILED`**, with no indication that the Shot has footage at all.
  - **The Shot's own state is being overwritten by its most recent job outcome.** Those are different things. A Shot with a current video _is_ rendered; a failed retry is an attempt that did not replace it. The design's six words (`NOT READY · READY TO RENDER · QUEUED · RENDERING · RENDERED · FAILED`) describe the Shot, and the same handoff already establishes the pattern for exactly this case — **`STALE` is a qualifier on a rendered Shot, not a seventh state**, because "a stale shot still plays". A failed retry over good footage is the same shape and wants the same treatment.
  - **Why it costs money.** The Board is where the design puts generation, so a tile reading `FAILED` is an invitation to re-render. Doing so spends on a Shot that already has a current take, and — given **BUG-165**, where chained generation succeeds about a third of the time — is quite likely to fail again and leave the user worse off than if they had done nothing. This is the **BUG-142** hazard on a new surface: a status that permanently nudges toward paid work that is not needed.
  - **It also hides real information.** With the film at 29 of 36 rendered, a user scanning the Board cannot tell which Shots genuinely have no footage from which merely had a retry fail. Those demand opposite actions.
  - **Fix direction.** Derive the tile's status from the Shot, not from its latest job: a Shot with a current `videoAssetId` is `RENDERED`, and a failed most-recent attempt is a qualifier on it — the same relationship `STALE` already has. Reserve `FAILED` for a Shot with no usable take. If the failed retry should be visible, mark it the way staleness is marked, not by replacing the word.
  - **Live reproduction.** `Plateau` (`748ae58b_386f_452c_b4b1_6c3819fb02ed`), Shot 2.2: 12 attempts, 1 success, `videoAssetId` set, latest attempt failed, tile reads `FAILED`.
  - **Fixed in `0f63fcc93`.** Verified live 2026-08-28: `sh_clash_2` still holds `videoAssetId 1b53938c…`, and its Board tile now reads **`RENDERED · LATEST ATTEMPT FAILED`** — the Shot's own state with the failed retry as a qualifier, exactly the `STALE` relationship the entry asked for. Board-wide: **30 RENDERED** against 30 Shots that have video, and FAILED left on only the 2 with none.

- [x] **[BUG-170][P2][Creative Studio] Every project card reports "Project status unavailable" for ~2 seconds each time the Library window is focused** — found 2026-08-28 verifying `5afc5cf1c`, the commit that adds the feature
  - **Actual.** Returning to the Library — an `alt-tab` back to the app, or any window focus — makes **all six** project cards replace their status with _"Project status unavailable"_. Measured over three trials by dispatching a single `focus` event and polling the rendered `data-status` at 100 ms: the flash lasted **1.59 s, 2.23 s and 2.00 s**, then every card settled back to its true value (`in_progress`, `not_started`, `in_progress`, `not_started`, `in_progress`, `blocked`). It recurs on every focus, not just first load.
  - **Root cause.** `StudioLibrary.tsx:57` calls `setProjectStatuses({})` at the top of `performRefreshProjects`, clearing every status before the re-read starts. `ProjectCard` renders the unavailable copy for a `null` status, so the cleared window is displayed as an error. The effect at `StudioLibrary.tsx:146-167` registers `window.addEventListener('focus', refreshOnFocus)`, so an ordinary focus runs the whole clear-and-refetch cycle. The cards themselves stay mounted throughout — `setProjects` happens before the status round-trip and is not cleared — so the user sees populated cards carrying an error line.
  - **The data is fine.** Invoked directly for all six projects, `getProjectStatus` returns a complete object every time: `projectRevision` matches the revision from `listProjects.projectRevisions` exactly (1216=1216, 3=3, 96=96, 5=5, 62=62, 16=16), `detail` is `null`, seven stages, and the recomputed blocker total equals the declared `blockerCount`. Running the component's own `exactStudioProjectStatusV2` against that live data returns a **valid** status for every project, and `structuredClone` of it succeeds. Neither validation gate is rejecting anything — the only `null` is the one the refresh writes itself.
  - **Same defect class as BUG-167, on a second surface.** BUG-167 is this exact confusion on the Board: an unloaded status rendered with copy that asserts unavailability. Here it is worse in one respect — the Board's version is a one-time wait after opening the view, while this one repeats every time the owner returns to the window, so the Library's headline feature reads as broken during normal use.
  - **Fix direction.** Distinguish "not loaded yet" from "unavailable", as BUG-167 requires. Preferably do not clear at all: keep the previous statuses visible while the re-read is in flight and swap them on arrival, since they are almost always still correct. Both fixes want the same shape and should land together.
  - **Live reproduction.** Open the Library with any projects present, focus another window, focus the app again — every card shows the message for about two seconds. Also reproducible without touching the window by dispatching a `focus` event.
  - **Fixed in `5ba629312`.** Verified live 2026-08-28: against a real six-card baseline (`in_progress, not_started, in_progress, not_started, in_progress, blocked`), three dispatched `focus` events produced **no `unavailable` state within 3s each**, where the bug flashed for 1.59-2.23s every time. `EMPTY_LIBRARY_SNAPSHOT` is now the initial state only; the refresh swaps on arrival instead of clearing.

- [ ] **[BUG-171][P3][Creative Studio] Every view is wrapped in a card that repeats the view's own name, so the work area opens with two nested boxes saying the same thing** — found 2026-08-28 by the owner on References and the Table
  - **Actual.** The work area renders an outer bordered surface titled **References**, whose only child is another bordered card headed _"References · CANONICAL IMAGES"_. The Table has the identical shape: an outer surface titled **Table**, containing a card headed _"Story authoring and recovery"_. Measured live, the outer element is `_viewSurface_` at 979×261 with a 12px radius and its own border, and the inner card carries a second border and radius immediately inside it.
  - **Why it is worth fixing.** The outer box contributes a title the app bar already supplies — the active view is named in the view chips and the project is named in the bar above — so it spends a full border, a radius and a heading to repeat something stated twice already. On References it produces the word "References" twice within ~90px of vertical space. The nesting also costs horizontal room the Table needs: the outer surface is 979px inside a window where the panes row is wider.
  - **Fix direction.** One surface per view, not two. Either the outer wrapper keeps the border and the inner card loses it, or the inner card is the only surface and the outer becomes a plain layout container. The view's name should appear once — and given the chips already name it, the stronger option is for the card to carry its own working title (_"Story authoring and recovery"_, _"Canonical images"_) and drop the echo of the view name entirely.
  - **Confirmed on the Board too (2026-08-28).** `<h2>Board</h2>` at **21.75px/700** sits directly above `<h2>Beat board</h2>` at **20px/700** — two headings of nearly the same size and identical weight, stacked, saying the same thing. Cut still needs checking.
  - **The measurement exposes an inverted type hierarchy, which is the deeper problem.** The project title is `<h1>Plateau</h1>` at **14.5px**, while both of these `<h2>`s render at 20-21.75px. The page's most important label is its smallest, and the least informative labels are its largest. Fixing the duplication without fixing the scale would leave a single heading that is still louder than the project it belongs to.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 5 — canvas information hierarchy.
    - **Rationale:** The four nested CS3 view cards are deleted, but redundant container labels and an
      inverted title hierarchy would be equally harmful on the new canvas. Pilot 1 should establish
      one workspace surface and make project and Piece content more prominent than navigation chrome.
    - **Acceptance evidence:** DOM tests must find one main canvas landmark, one project heading and no
      wrapper heading that repeats the selected workspace. Responsive visual evidence at wide and
      narrow widths, including RTL, must show the project and Piece titles above navigation chrome in
      the semantic and visual hierarchy.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-172][P2][Creative Studio] The canonical reference image — the one thing the References view exists to show — is clipped to a third of itself, while the thumbnails are too small to judge** — found 2026-08-28 by the owner on `Plateau`
  - **Actual, measured live.** The hero image for KAEL is a **1376×768** asset rendered into an `<img>` box of **866×484** inside a container of **868×157**. `.pictureBand` sets `overflow: hidden`, so **327px — 67% of the rendered image — is clipped**. On a full-body character sheet the visible third is head and chest; the legs, footwear and full silhouette are cut off, and the thumbnail beside it shows a complete standing figure that the hero never displays.
  - **Root cause.** `References.module.css:302` fixes `.pictureBand { block-size: 156px }` while `:311-314` gives `.pictureBand img { inline-size: 100%; block-size: 100%; object-fit: contain }`. The `object-fit: contain` is inert here: the band is a grid with `place-items: center`, and `inline-size: 100%` (868px) together with the image's own 16:9 aspect resolves the element's height to 484px, which overflows the 157px band and is clipped by `overflow: hidden`. `contain` fits content inside the element box, and it is the element box that is too tall.
  - **The thumbnails are the opposite problem.** `.take img` (`:453-458`) is **54×38** with `object-fit: cover`. That is a ~25× downscale from 1376px wide, cropped on top of it. At that size two takes of the same character are indistinguishable, which defeats the choice the strip exists to support — picking which image becomes canonical.
  - **Why P2.** A reference image is the product's mechanism for character consistency; every Shot is bound to it. If the owner cannot see the whole reference, they cannot tell whether the character is right, and the binding they approve is one they have not fully seen.
  - **Fix direction.** Let the band take the image's aspect rather than a fixed 156px — the assets are a known 16:9, so an `aspect-ratio` on the band would show the whole frame with no clipping and no letterboxing. If a fixed height must stay, constrain the image with `max-block-size: 100%` so `contain` can do its job. Separately, give the take strip enough size to compare two images; 54px is below the threshold where a full-body figure carries any detail.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — reference media on Assembly and film blocks.
    - **Rationale:** The CS3 References view is removed, but film work still requires people to judge
      canonical references and their candidates. Phase 6 must display the entire persisted frame at
      a useful comparison size instead of inheriting fixed-height cropping.
    - **Acceptance evidence:** Reference-block DOM and visual tests must show a complete 16:9 canonical
      image with no clipped pixels and candidates large enough to distinguish at supported desktop
      widths. The same assertions must pass at the narrow breakpoint and in RTL, and selecting a
      candidate must not change its fitted geometry.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-173][P2][Creative Studio] Shot sub-rows are not indented under their Beat, so the Table's two levels are visually indistinguishable** — found 2026-08-28 by the owner on the new Table planning view
  - **Actual, measured live.** With Beat 1 expanded, its six Shot rows and the Beat rows above and below all report the **same** first-cell left edge (`344px`) and the **same** `padding-left` (`12px`). There is no indent, no rule, and no gutter separating a Shot from a Beat.
  - **It is worse than a missing indent, because the numbering collides.** Beats number `01, 02, 03…` and Shots restart at `01, 02, 03…` within each Beat. With identical alignment, the expanded table reads `01 Arrival` / `01 CHAIN HEAD` / `02 ← SHOT 1` / … / `02 First clash` — two different `01`s and two different `02`s at the same indentation, one a Beat and one a Shot. The only cue that a row is a Shot is the content of its second column.
  - **Why it matters now.** Slice 2 added these sub-rows precisely so the story can be planned in the Table. Structure is the thing the owner is reading for, and structure is what the flat alignment hides.
  - **Fix direction.** Indent the Shot rows' first cell so the hierarchy is visible without reading the text, and consider carrying the Beat number into the Shot position (`1.1`, `1.2`) the way the Board tiles already do — the Board renders `2.2` for Beat 2 Shot 2, so the vocabulary already exists and the two views would agree.
  - **CS4 triage**
    - **Disposition:** Superseded by cutover.
    - **Destination:** Phase 5 — removal of the CS3 Table surface.
    - **Rationale:** The defect is solely the alignment of Beat and Shot rows in the Table. It carries
      no surviving store, spend, provenance or interaction rule, and CS4 does not present film
      hierarchy in that table.
    - **Acceptance evidence:** The Phase 5 source audit and renderer navigation test must prove that
      the Table route, view switch entry, row renderer and stylesheet are absent from the shipped
      Creative Studio surface. The bug stays open until that cutover evidence passes.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-174][P3][Creative Studio] The Table's per-row move controls should be removed** — found 2026-08-28, requested by the owner
  - **Actual.** Every Beat row carries three controls in the `#` column — a drag handle plus two arrows — labelled _"Reorder Arrival at position 1"_, _"Move 1. Arrival earlier"_ and _"Move 1. Arrival later"_. Counted live on a six-Beat project: **28 move buttons** in the view. They occupy the full height of the `#` column and are the most visually prominent thing in the leftmost column, competing with the position number itself.
  - **Why remove rather than restyle.** Reordering is not how this product is meant to be driven: the Director owns structure, and `reorder_beats` / `reorder_shots` are `direct` operations it can perform on request. Three permanent controls per row spend the Table's scarcest column on an action that is rare and available by asking.
  - **Scope note — remove the controls, not the capability.** The underlying reorder operations stay; this is about the row chrome. Removing the buttons must not remove the only keyboard path to reordering if one exists, so check whether these are the sole accessible route before deleting them — if they are, the replacement needs to be reachable too, not merely absent.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — Assembly and film-structure interaction.
    - **Rationale:** The Table's 28 controls disappear at cutover, but film structure will return as
      Assembly blocks. Reordering remains a Director-owned capability and must not reappear as
      permanent per-row chrome; any human alternative must remain keyboard accessible.
    - **Acceptance evidence:** Phase 6 DOM tests must find no always-visible move controls on every
      Beat or Shot block, while Director reorder tests preserve the typed operation and deterministic
      result. Keyboard and screen-reader evidence must cover the bounded human reorder path, if one is
      exposed, without removing the Director capability.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-175][P3][Creative Studio] The Beat's name is the smallest text on the Board, smaller than every label around it** — found 2026-08-28 by the owner on `Plateau`
  - **Actual, measured live.** The Beat name _"Arrival"_ renders as a `<span>` at **13px/600**. Around it: `Beat board` at 20px/700, `Board` at 21.75px/700, and even the project title `Plateau` at 14.5px. The Beat's own name — the only text on the card that identifies which part of the film this is — is smaller than all of them.
  - **Why it is the wrong way round.** `Board` and `Beat board` are chrome; they say what screen you are on, which the view chips already say. `Arrival` is content. The card is a Beat, so its name is the thing a reader scans for when finding a place in a 6-Beat, 35-Shot film, and it is currently set below body size while two redundant headings above it are set at 20px+.
  - **Fix direction.** Promote the Beat name to the card's dominant label and demote the section headings, which **BUG-171** proposes removing outright. The two are best fixed together: deleting the duplicate heading frees exactly the visual weight the Beat name needs.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — Beat and Assembly block hierarchy.
    - **Rationale:** The Board is removed, but film blocks still need content-first hierarchy. A Beat's
      authored name must remain the dominant label, with generic section chrome demoted or omitted.
    - **Acceptance evidence:** Semantic and visual tests must make each Beat name the block heading and
      give it greater prominence than generic film or section labels. A multi-Beat responsive
      screenshot must demonstrate that Beats can be scanned by name at wide, narrow and RTL layouts
      without duplicated headings.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-176][P2][Creative Studio] Only an 19px-tall strip of the Beat card opens the Beat — the card itself is not clickable** — found 2026-08-28 by the owner on `Plateau`
  - **Actual, measured live.** The only interactive element in the Beat header is an Arco text `<button>` of **712×19px** wrapping the name. The Beat card is a large panel — header, description, shot counts, and a row of Shot tiles — and none of it responds; the owner must hit a 19-pixel-tall band to open the Beat.
  - **Why P2.** This is the Board's primary navigation. Every Beat is entered through it, and a 19px target is below any reasonable pointer-accuracy threshold — the WCAG target-size guidance is 24px as an absolute floor, and this is a target people hit repeatedly rather than once. It reads as a broken card: the whole panel looks interactive, so clicks land on it and nothing happens.
  - **Fix direction.** Make the card the target. Keep one accessible control as the semantic handle — a card-filling `<button>`, or the existing button stretched over the card via a `::after` overlay so the accessible name stays on the name element — and leave the interior Shot tiles and action buttons as their own targets above it. Do not simply attach an `onClick` to the container: that would leave the card unreachable by keyboard, which the current button at least supports.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — Beat and Assembly block navigation.
    - **Rationale:** The inaccessible CS3 card is deleted before Pilot 1, so it does not block CS4.
      When Beats return, the replacement block must make its apparent card target real without
      swallowing nested Shot or action controls.
    - **Acceptance evidence:** Pointer tests must open a Beat from the card body with a target of at
      least 24 by 24 CSS pixels; keyboard tests must open it with Enter and Space from one correctly
      named control. Nested Shot and action controls must perform only their own actions, and the
      accessibility tree must contain no duplicate card links.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-177][P3][Creative Studio] The first-frame viewer opens as a modal on top of the Beat panel, stacking two scrims and two close affordances** — found 2026-08-28 by the owner
  - **Actual.** Opening a frame from the Beat panel renders an Arco `Modal` (`BeatPanel/FirstFrames/index.tsx:456`) over the already-open Beat panel. The result is two dimmed layers: the Beat panel is visible but greyed behind the viewer, its heading (`BEAT 1 · Arrival`), its `Play` button and its Shot rows all half-legible at the edges of the screen and none of them reachable. The owner's description was _"pop up over pop up"_.
  - **Why it reads as broken rather than layered.** Everything behind the viewer stays visible enough to look interactive but is inert, and there are two exits — the viewer's `×` and the Beat panel's own dismissal — with no indication which one the Escape key will take. The content behind is also mostly dead space: the viewer is centred and the Beat panel shows through as fragments down both sides.
  - **Fix direction.** The frame viewer is a detail of the Beat, not a separate context, so it wants to open **within** the Beat panel rather than over it — replacing the panel's content with a back affordance, or expanding in place. If it must stay a modal, it should cover the panel completely rather than leaving a half-lit frame around it, and only one scrim should be painted.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 6 — first-frame detail inside film blocks.
    - **Rationale:** Both CS3 layers are removed, but first-frame inspection returns with film. The new
      detail experience must have one navigation context, one scrim at most and an unambiguous back or
      close action rather than stacking a viewer modal over a panel.
    - **Acceptance evidence:** UI tests must open frame detail from a Beat, assert that no second modal
      or scrim is mounted, and return to the same Beat and focus origin with Escape and the visible back
      control. A browser screenshot must show no inert, half-visible panel controls behind the detail
      surface.
    - **Claimant:** Unclaimed.

- [ ] **[BUG-178][P2][Creative Studio] The same fixed-height-plus-`cover` pattern clips images in a third place, and it is now a systemic layout bug rather than three separate ones** — found 2026-08-28 by the owner on the Shot's frame tiles
  - **Actual.** The `Start` tile in a Shot's FRAMES row shows only the upper band of the frame; the same image rendered beside it under `CURRENT PICTURE` shows the whole thing. `FirstFrames.module.css` fixes `block-size: 74px` with `overflow: hidden` (`:107-109`) and `object-fit: cover` (`:121`), so a 16:9 frame is cropped to a letterbox strip.
  - **This is the third instance of one pattern.** **BUG-172** records the same thing twice over in References — the canonical image clipped to 33% of itself in a 157px band, and the 54×38 take thumbnails cropped by `cover`. Here it is again in a different component. In every case a fixed `block-size` is combined with `object-fit: cover` or an unconstrained image, and `overflow: hidden` removes whatever does not fit.
  - **Why it matters more than a crop.** All three surfaces exist so the owner can _judge an image_ — is this the right character, is this the right first frame, is this the frame the next Shot should continue from. Cropping is the one transformation that defeats that purpose, and it is being applied by default to every image in the product.
  - **Fix direction.** Treat this as one fix, not three. Studio's generated assets are a known 16:9, so image containers should carry `aspect-ratio: 16 / 9` and let width drive height, with `object-fit: contain` as the default and `cover` reserved for places where a deliberate crop is wanted (there may be none). A shared image-frame component would stop the pattern recurring in the next surface. See **BUG-172**.
  - **CS4 triage**
    - **Disposition:** Absorb into CS4.
    - **Destination:** Phase 5 — shared Pilot 1 media-frame component.
    - **Rationale:** The three reported CS3 instances are removed, but default cropping would defeat an
      image-first Pilot 1. The canvas needs one aspect-driven frame primitive whose container geometry
      and image fit together, rather than a fixed-height band with hidden overflow.
    - **Acceptance evidence:** Component geometry tests and browser screenshots must show the complete
      generated or imported photo at every supported canvas width, including portrait and landscape
      request ratios and RTL. No judgement surface may use deliberate cropping unless its contract
      names that crop, and the Pilot 1 E2E must compare the displayed image with the persisted asset.
    - **Claimant:** Unclaimed.

### Verified live 2026-08-25 — schema-v5 real-model run

- Exact build: `3ac63eb9f`; project: `a5502dee_3834_48a0_bfa7_bd2597546506`; OpenRouter image and first-frame-capable video routes.
- End state: one 12-second Beat, three four-second rendered videos, two ready continuity-frame extractions, and successful Beat playback.
- **Not a product bug:** OpenRouter returned HTTP 403 _“Key limit exceeded (total limit)”_ for the first account key. Replacing the exhausted account route cleared it; the app had surfaced the provider body and did not mis-submit work.
- **Needs another reproduction before filing:** Settings briefly showed _“Could not load media models”_ while the provider rows themselves were present. Refresh and route completion later worked, and this run did not retain a cause-specific failure record.
- **Withdrawn false alarm:** the accessibility snapshot contained _“Unable to play media”_ while the owner could play the Beat. User-observed playback and three canonical selected videos are authoritative; no playback defect is filed from that string.

## Correctness and honesty of failures

- [x] **[BUG-062][P2][Creative Studio] Three distinct Director failures all report "could not read or save this workspace"** — found 2026-08-21 while diagnosing BUG-061
  - `STORAGE_ERROR_KEY` is thrown for at least three unrelated causes in `DirectorRail/index.tsx`: a brief-session descriptor mismatch (~441), a created-conversation id mismatch (479), and an MCP snapshot mismatch (482). None of them is a storage failure.
  - Measured cost: the message sent diagnosis at the filesystem. Time was spent confirming whether `~/.aionui-dev-2` being a symlink to `Library/Application Support/Forge-Dev-2/aionui` was tripping a path-containment guard in `store.ts`. It was not.
  - That false trail is expensive **because a real bug of exactly that shape exists** — BUG-050, "workspace containment is lexical, so a symlinked data directory rejects files that are inside the workspace". A wrong error message that names a real neighbouring failure mode is worse than a generic one.
  - Fix direction: give each cause its own message key. Fixing BUG-061 removes one of the three throws but leaves the overload.
  - **Fixed by `ecc43f718`** — Director setup now reports cause-specific safe messages for session verification, interrupted attachment, and genuine storage failures.

- [x] **[BUG-065][P2][Creative Studio] Media-model validation discards the reason it failed** — found 2026-08-21
  - The adapter distinguishes `unsupported`, `auth`, `timeout` and `unknown` (`openRouterVideoAdapter.ts:404`), and the IPC result carries the code. `StudioMediaModelsSection.tsx:243` collapses every outcome to `null`, and the dialog renders one string: "Connection validation failed."
  - So "this model does not support video" and "your API key was rejected" are indistinguishable in the product. Combined with BUG-063, a user given a wrong model id has no signal telling them the id is the problem.
  - Same anti-pattern as BUG-062: a distinct failure wearing a generic label. Two independent instances of it in one session.
  - **Fixed by `b01c565ee`** — validation now carries a seven-value, body-free failure reason through the service and IPC boundary to localized dialog and row-level messages.

- [x] **[BUG-091][P3][Creative Studio] The Cut states the film, the target and the gap between them in two different formats** — found 2026-08-21 while verifying BUG-084
  - The film summary reads **`The film · 2:57 · of 0:18 target · 159s over`**. The total and the target are clocks; the difference between those same two numbers is raw seconds. A reader has to convert in their head to check that the third number follows from the first two.
  - Source: `Cut/index.tsx:269-286` renders `filmClock` and `ofTarget` through `formatCutClock`, then renders the delta through `cut.film.over` / `cut.film.under`, whose strings end in a literal `s`.
  - **Not a Codex regression, and not new.** The `{{seconds}}s` strings predate their change — they only added the rounding that BUG-084 asked for. The mixed format came in with the film summary I wrote, so this is mine.
  - The app bar already sets the house format for film-level durations: `{{film}} of {{target}} target` rendered as clocks. Making the delta a clock too would match it. The counter-argument is that `2:39 over` reads worse than `159s over` for a small gap — so this is a judgement call, not an obvious correction.
  - **Owner decision and fix, 2026-08-22:** film-level totals, targets and deltas all use the same `m:ss` clock (`2:57 · of 0:18 target · 2:39 over`). Raw seconds remain appropriate for Shot-level trims and timing controls. The two delta phrases are localized with a `{{clock}}` placeholder in every configured locale.

- [x] **[BUG-092][P2][Platform] Presentation-run recovery can never work: the IPC schema demands a UUID, conversation ids are eight characters** — found 2026-08-21, root-caused with a probe in a restarted dev build
  - Every project creation throws an unhandled page error. The rejected call is **`presentation-runs.list-recoverable`**, and the failing field is `conversation_id`:
    `issues=[{"validation":"regex","code":"invalid_string","path":["conversation_id"]}]`
  - `payloadSchemas.ts:185-187` requires a strict RFC-4122 UUID: `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`. Read straight from the running backend, the six most recent conversation ids are `d0921953`, `a4aad241`, `b27504a8`, `7c5d6c3b`, `1b6c08c2`, `3adcd3af` — **eight hex characters, none of them a UUID**.
  - So this is not an edge case with a bad id. **No conversation can ever satisfy the schema**, and the call fails 100% of the time. Recovering an interrupted presentation run is dead: `usePresentationTemplates.ts:234` catches the rejection and shows `recovery.loadError`, or nothing when `showFailure` is false.
  - The renderer mints `uuid(36)` when it _asks_ for a conversation; aioncore mints its own short id and that is what is stored. The schema was written against the request, not against the record.
  - **Fourth recurrence of the UUID-vs-short-id class** in this codebase. Loosening this one regex fixes this call and leaves the class intact — worth deciding on a canonical id type rather than patching the fourth site.
  - **Fixed by `fa777eb6b`.** Presentation conversation ids now accept canonical eight-hex backend ids and legacy UUIDs across IPC, storage, and renderer recovery, while server-assigned Guid conversations use crash-safe claimant and revoke-proof recovery without weakening strict non-conversation ids.

- [x] **[BUG-093][P2][Platform] The IPC payload rejection names neither the operation nor the field** — found 2026-08-21
  - `[adapter] Native IPC request rejected: invalid operation payload`, and nothing else. Eight occurrences in one dev log with no way to tell them apart.
  - `parseNativeBridgePayload` (`payloadSchemas.ts:905-911`) has **both** `providerKey` and `result.error.issues` in scope and throws them away.
  - The cost is concrete: identifying BUG-092 needed a temporary probe, an app restart, and a rebuild, because nothing in the message, the log or the renderer console said which of the 140 operations had failed. Adding the operation name and the zod issue path would have made it a ten-second read.
  - Renderer-facing text should stay generic — this is main-process logging, not a user message.
  - **Fixed by `fa777eb6b`.** Native IPC payload rejection now logs the provider key plus bounded schema issue codes and paths through a value-free side channel while preserving the generic renderer error.

- [x] **[BUG-094][P3][Platform] A version-skewed backend binary is reported to the user as a missing-files installation problem** — found 2026-08-21, hit while restarting the dev app
  - `~/.cargo/bin/aioncore` is **0.1.44**; the bundled binary is **0.1.55**. The dev Electron's `Resources` has no `bundled-aioncore`, so `resolveBinaryPath` falls through to the system PATH and picks the older one, which cannot open a database migrated by the newer one — `BOOTSTRAP_DATA_INIT_FAILED stage="database.open"`.
  - The window then reads **"WePrompt installation is incomplete — this installation is missing required local resources"** and advises a reinstall. Nothing was missing; a binary was too old. A reinstall would not have fixed it.
  - `backendStartupFailure.ts` classifies carefully — architecture mismatch, incomplete installation, database lineage, recoverable corruption — but `stage="database.open"` matches none of them and lands in a bucket whose copy asserts missing files. `classifyIncompleteInstallation` even guards on `isPackaged === true`, so in dev it cannot be the intended classification.
  - Honest framing: I reached this by restarting the dev app, not through normal use. It would still reach a packaged user after a downgrade, and the advice it gives them is wrong.
  - Dev workaround, no repo change: put the bundled binary first on PATH.
  - **Fixed by `fa777eb6b`.** Unclassified backend startup and database-open failures now use neutral localized startup copy and diagnostics instead of asserting an incomplete installation, while proven missing-resource failures retain their specific guidance.

- [x] **[BUG-095][P2][Creative Studio] Severing the chain is a free toggle where the ruling makes it a gated, costed action** — found 2026-08-21 reconciling the designer's fifth round against the build
  - §13.1 rules that `HARD CUT` is a permanent authored control, and that **severing is not free**: the shot becomes a chain head, so it needs a still on the image route, and its existing take was generated from a first frame it no longer starts from. It is to be gated in the render gate's shape — the third gate after render and chain — and re-joining is symmetrical and equally gated.
  - The build dispatches it as an ordinary authoring mutation. `StudioPage.tsx:537` sends `{ kind: 'set_hard_cut', shotId, hardCut }` through `applyAuthoringBatch`, and `mutations/index.ts:1496` applies it with no quote, no confirmation and no still.
  - **Partial credit where it is due.** The mutation calls `touchShot` on the shot, which reaches the projection's `dirtyShotIds` and renders the shot `stale` (`workspaceProjection.ts:746`). So the take is marked, not silently kept. And `hasBoundNonterminalJob` blocks the toggle while a job is in flight on that shot. What is missing is the money, not the bookkeeping.
  - Missing against the ruling: the gate itself, the still cost quoted before the toggle, the still actually being produced on the image route, and the same treatment on re-join.
  - One existing guard is worth keeping in view: `directorCommandContracts.ts:297` already classifies `set_hard_cut` as `proposal`, so the Director cannot sever a chain on its own. The gap is the human's click, not the Director's.
  - **Stale as filed, corrected 2026-08-22.** The Shot-provenance slice made the hard-cut control **read-only**: it is now a disabled checkbox reflecting canonical state inside a labelled group. So severing is not a free toggle — it cannot be done at all. The ruling in §13.1 still stands and the gate still has to be built; what changed is that the risk is now an absent capability rather than an unpriced one.
  - **Bounded fail-closed containment fixed 2026-08-22; BUG-095 remains open for the atomic paid gate.** The Beat panel preserves the canonical checked or unchecked hard-cut state but now marks changes unavailable, with localized copy explaining that a reviewed estimate for replacement media must come first. The renderer no longer exposes a free `set_hard_cut` action, new Director commands cannot propose it, and the mutation authority rejects direct toggles, coverage-authored hard-cut transitions and exact undo reversals before persistence. A valid pre-fix pending proposal remains readable but cannot be accepted or publish decision/project bytes. This containment prevents another unquoted chain change; it does not supply the required still, replacement video, mandatory cascade, quote confirmation or re-join workflow, so the bug must not be closed.
  - **Owner-approved contract recorded 2026-08-23; BUG-095 remains open until GREEN verification.** The first Shot has no toggle. A sever atomically pins and reuses its exact eligible seed or generates one still whose authorized output requires human binding, then replaces the target video; a re-join clears the seed selection and waits on the predecessor's free trim-aware frame extraction before replacing the target video. Both directions mandatorily replace every downstream video through the next hard cut, with exactly one generation per required item and no optional base/cascade quote. Confirmation atomically commits topology, authorization and jobs; all pre-commit refusal/failure paths are zero-byte, while post-confirm lifecycle failures remain durable and never roll topology back. Ordinary undo is absent—the inverse is another paid transition—and the Director remains forbidden. Direction §13.6 and the implementation-plan authority pin carry the full contract.
  - **Fixed 2026-08-23.** The Beat panel now opens one reviewed, localized sever/re-join gate for every non-first Shot. Main derives and revalidates the sole mandatory quote, distrusts the renderer's seed hint, and atomically commits topology, authorization, jobs and re-join extraction authority before dispatch. Exact seed selection, trim-aware predecessor binding, restart recovery, corrupt/missing continuity-frame repair and every free/Director/undo bypass fail closed. Verification is GREEN for TypeScript, formatting, i18n, lint (zero errors), the production package, and the thresholded full suite: 652 files and 9,480 tests passed, with every listed file above 80% lines and branches. The focused five-case Electron lifecycle was attempted but could not reach the Studio route: the local backend stayed at port 0 because the SHA-verified pinned AionCore v0.1.51 archive lacks the required `migration-lineage.json` and was correctly rejected. No E2E product assertion ran, so this note does not claim E2E GREEN.

- [x] **[BUG-096][P3][Creative Studio] The Brief's route pickers show an opaque choice id where a model name belongs** — found 2026-08-22 verifying Slice 1a
  - With both routes bound, the pickers read `choice_000290ca7fd86013f59825d5` and `choice_442687563c09dd91be3844cb`. A person cannot tell which model their film will be rendered with, or whether the two are even the same provider.
  - It matters more now than it did: before auto-binding, a user picked the route themselves and knew what they chose. A route bound on their behalf is only accountable if it says what it bound.
  - The catalogue entry already carries `providerName` and `model` beside `choiceId`, so the label exists — it is the display that falls back to the id.
  - **Not a labelling defect at all. Closed 2026-08-22 with BUG-097.** The raw id is what the picker shows when a bound route resolves to nothing in the catalogue. With the catalogue refreshed after binding, the same picker reads `OpenRouter · google/gemini-3-pro-image`. No display change was needed.

## Coverage and polish

- [x] **[BUG-064][P2][Creative Studio] The video allowlist covers 6 of the 24 models OpenRouter serves, with no way to extend it** — found 2026-08-21, verified against the live catalogue
  - `OPENROUTER_VIDEO_MODELS` (`openRouterVideoAdapter.ts:44`) allowlists six. All six are real and currently served — verified individually, so this is not a stale-identifier bug: `google/veo-3.1-lite`, `google/veo-3.1-fast`, `kwaivgi/kling-v3.0-std`, `kwaivgi/kling-v3.0-pro`, `bytedance/seedance-2.0`, `bytedance/seedance-2.0-fast`.
  - Live and unbindable: `openai/sora-2-pro`, `google/veo-3.1` (full), `bytedance/seedance-2.5`, `bytedance/seedance-1-5-pro`, `bytedance/seedance-2.0-mini`, `runway/gen-4.5`, `runway/aleph-2`, `minimax/hailuo-3`, `minimax/hailuo-2.3`, `alibaba/wan-2.7`, `alibaba/wan-2.6`, `alibaba/happyhorse-1.1`, `alibaba/happyhorse-1.0`, `kwaivgi/kling-video-o1`, `black-forest-labs/flux-3-video`, `black-forest-labs/flux-video-upscale`, `x-ai/grok-imagine-video-1.5`, `x-ai/grok-imagine-video`.
  - **`bytedance/seedance-2.0` is the only allowlisted OpenRouter model that supports a first frame**, so the CS3 continuity chain currently rests on one binding. If it is unavailable to an account, first-frame continuity is unreachable through OpenRouter.
  - The allowlist itself is defensible — each entry carries duration bounds, resolutions, ratios and a first-frame flag that the catalogue does not expose, and the adapter needs those facts. The defect is that it is hardcoded with no admission path, and it has already drifted behind the catalogue.
  - **Fixed by `b01c565ee`** — OpenRouter video models are now admitted from a strict live catalogue with durable discrete capabilities, refresh-race fencing, and final pre-submit revalidation.

- [x] **[BUG-066][P3][Creative Studio] The Cut view renders a duplicated "Cut" heading** — found 2026-08-21, confirmed by DOM inspection of all three views
  - Cut emits two `H2 "Cut"` — the view wrapper's heading and the panel's own `cut.title` (`Views/Cut/index.tsx:207`). Table emits one heading; Board's second heading is "Beat board", so neither sibling collides.
  - Live heading trees: Table `[H1 project, H2 "Table"]`; Board `[H1 project, H2 "Board", H2 "Beat board", H2 "Bin"]`; Cut `[H1 project, H2 "Cut", H2 "Cut", H3 …]`.
  - Also an accessibility defect: two identical sibling headings at the same level give screen-reader users no way to tell the wrapper from the panel.
  - **Fixed by `d1f99a2b0`** — Cut now relies on the workspace's single canonical level-two heading while retaining its independently named Film Cut region, with integrated DOM and E2E heading-count coverage.

- [x] **[BUG-067][P2][Creative Studio] Project settings and Brief controls render inline beneath every view instead of from the shared app bar** — found 2026-08-21
  - Task 8 requires the project-settings editor and requires routes plus spend policy in Brief; removing
    those controls would violate the functional contract. The placement defect was that one shared form
    appeared inline beneath Table, Board and Cut even though the pinned prototype puts Brief & rules
    behind the app-bar overflow.
  - **Fixed 2026-08-21** — the app bar now owns one accessible More menu. Project settings and Brief,
    routes, spend policy, and rules open in separate project-scoped modals; none of those forms render
    inside the three view mains. Drafts survive view changes, modal cancellation, project navigation,
    storage failures, and close/save coordination without duplicating mutations.

- [x] **[BUG-075][P2][Creative Studio] The Brief's rules are edited as raw JSON in a textarea** — found 2026-08-21 by driving the running app
  - The workspace renders a field labelled `Project rule drafts (JSON)` holding a textarea whose value is `[]`, beside a `Save rules` button. It is built at `StudioPage.tsx:161` as `JSON.stringify(projectRuleDrafts(project), null, 2)`, so the internal draft array is the user surface.
  - **The design has no JSON editing surface anywhere.** The prototype contains six occurrences of the string `json`, and all six are inside base64 image data rather than any label or control.
  - The plan does specify `set_rules` carrying `StudioBriefRuleDraft[]`, but that is the wire contract between renderer and reducer. Nothing in it asks for the array to be typed by hand.
  - What this costs a user: a malformed paste is a parse failure they have to debug with no schema to consult, and a rule is authored by writing an internal shape correctly rather than by saying what the rule is. It is the one place in the workspace where the product asks someone to be a programmer.
  - Distinct from BUG-067, which is about the settings forms being in the workspace at all. This entry stands even if those forms move: wherever rules are edited, they should not be edited as JSON.

  **How rules are actually presented, measured in the prototype 2026-08-21.** Not a JSON array: a
  stack of cards inside the Brief panel, under the heading `RULES · RUN AGAINST EVERY PROMPT BEFORE
IT RENDERS` (IBM Plex Mono 9px, 0.9px tracking, `#8C7F6C`). Each card carries the rule in prose, a
  scope badge on the leading edge — `ORG` or `PROJECT`, Plex Mono 8px, 0.48px tracking, `#6E6553` —
  and a state on the trailing edge: `LOCKED` in `#A0937E` for an org rule the project cannot edit, or
  `1 BREACH FIXED` in `#2E7D5B`, the same green the READY state uses.
  So a rule has a scope and a lifecycle, and the textarea expresses neither. An org-locked rule is not
  even editable, which a free-text JSON field cannot represent.
  - **Fixed 2026-08-21** — rules are structured prose cards with explicit scope and enforcement state,
    typed forbidden-term chips, locked organisation rules, project-rule add/edit/remove actions,
    semantic validation, revision-guarded authoritative updates, unified undo, ambiguity-safe adoption,
    and focus recovery. Legacy `brief.rules` JSON drafts are retired without overwriting authority;
    bounded project-scoped draft persistence and close protection preserve unfinished human input.

- [x] **[BUG-076][P2][Creative Studio] The Brief is a string in a JSON blob, not the hand-editable `brief.md` the design promises** — found 2026-08-21 by driving the pinned prototype against the build
  - The designed Brief panel names the artefact **`brief.md`** (Manrope 700 15px), says it is `LOADED INTO EVERY DIRECTOR TURN`, and closes with `HAND-EDITABLE · THE APP READS IT, AN OUTSIDE EDIT IS RESPECTED`. That is a promise about a file on disk, not about a field.
  - The build has no such file. `brief.md` appears nowhere in the source, the brief is a `string` on the project record, and a project directory on disk holds exactly `commands`, `project.json`, `proposals` and `reference-requests`.
  - So the two halves of the promise are both missing: there is nothing for someone to open in an editor, and nothing to notice if they did. The brief can only be changed through the app.
  - This is a product behaviour rather than a fidelity gap, which is why it is filed separately from BUG-067. Moving the Brief into the overflow panel satisfies 067 and leaves this untouched.
  - Worth an owner decision before it is built: a hand-editable file that the app re-reads is a different persistence story from a field inside the CAS-guarded project record, and the two have to agree about who wins when both change.
  - **Owner decision and fix, 2026-08-22:** `brief.md` is now the sole prose authority. The serialized project manifest retains only revision/digest metadata; runtime `project.brief` is hydrated from the file, and legacy inline manifests migrate without changing their revision. App writes use exact manifest-and-file CAS plus a durable bounded transaction receipt, so restart recovery completes an interrupted pair without dropping sibling mutations. A clean outside edit advances the project revision and notifies the renderer; an outside edit that races an unsaved app draft hits the existing explicit draft-conflict state and blocks saving. Concurrent file edits win without silent overwrite or auto-merge. The Director, MCP storyboard and media authority readers all validate the same file-backed project generation, while unsafe, missing, oversized or malformed current files fail closed.

## Visual fidelity against the design

> Compared 2026-08-21 against `creative-studio-3-beat-and-shot-reference.html.txt`,
> sha256 `642c8b16…0846ee` — matching the hash pinned in the implementation plan. The prototype was
> served locally and measured through the DOM; the built app was measured the same way over CDP, so
> every number below is a like-for-like computed style, not an eyeball estimate.
>
> **These are a specification gap, not a regression.** The implementation plan references the
> prototype once, as "an offline bundle of the prototype the review was conducted against" — context
> for the direction document. No task in the plan carries a typography, token, layout, or
> visual-fidelity requirement, and the view tasks (10–13) specify behaviour and data only. The views
> were built to the spec that existed. Closing this gap needs its own task; it is not rework of
> Tasks 10–13 against a standard they were given.

- [x] **[BUG-068][P1][Creative Studio] The designed app bar was never built; identity, stats, view switch and the primary action are separate stacked blocks** — found 2026-08-21
  - Design: one compact bar carrying, in order — a project colour dot, the title, a stat strip `9 BEATS · 2:58 OF 3:00 · 5 READY`, a right-aligned `TABLE BOARD CUT` segmented control, a primary `Render…` button, and an overflow `⋯`.
  - Built: a large `H1` project title, a `0 beats · 0 shots` line beneath it, then a separate row of view links. No stat strip (probed: absent), no `Render…` control anywhere in the workspace (probed: zero buttons matching /render/), no overflow menu.
  - The stat strip is the only place the design surfaces **duration against target** (`2:58 OF 3:00`) and **readiness count**. Both are load-bearing for the costed render gate, and neither has a home in the built UI.
  - **Unblocked 2026-08-21 by the designer's answer** (`creative-studio-3-app-bar-answer.html.txt`, sha256 `4a00962a…52b0d6`). The bar **spans the Studio surface above both panes** — measured at **1211px** on a 1492px window, which is the window less the 281px of application chrome outside the Studio. It does not sit inside the workspace column and it does not move when the rail toggles.
  - The child order gains one element at the front: **the rail's collapse control is now the leftmost thing in the bar** (`⇤`), and **the rail loses its own header entirely**. Order is now: collapse control, project dot, title, stat strip, flexible spacer, view chips, `Render…`, overflow.
  - Container is unchanged from the original prototype and re-measured on the answer: height **54px**, `padding: 11px 18px`, `gap: 11px`, background `rgb(251, 247, 240)`, `border-bottom: 1px solid rgb(228, 217, 198)`. The answer's prose says 56px; the computed value in both drawings is 54px. Treat 54px as authoritative and the prose as rounding.
  - **Touches `DirectorRail/index.tsx`** to delete its `<header>` and relocate the toggle. That is the same file as BUG-061 and BUG-062. Different regions — the throw sites are near line 479, the header near line 999 — so git will usually merge cleanly, but sequence it after those two rather than alongside.

  **Built 2026-08-21.** The bar spans the Studio surface above both panes and does not move when the
  rail is toggled. Measured live at 1178px wide and 55px tall against the drawn 54px. Order as drawn:
  the rail's collapse control, the project dot, the title, the stat strip, the flexible spacer, then
  the view chips. The rail lost its own header, and its collapse state now lives in the shell.

  The stat strip finally has a home for the two facts nothing else surfaced — the film against its
  target and the ready count — reading `0 BEATS · 0 SHOTS  0:00 OF 0:18 TARGET  0 READY` on an empty
  project. The title is a box with the drawn 320px ceiling, 128px floor and tail ellipsis.

  **Two controls are deliberately not built.** `Render…` has no action to invoke: no render provider
  exists in the IPC bridge, and inventing one would be inventing a spend control. The overflow `⋯`
  has nothing to hold until it does. Both are the costed render gate's work, not fidelity work, and
  the bar leaves room for them exactly where the drawing puts them.

  **Two defects found only by looking at it, after every test passed.** The shell was a flex row, so
  the bar laid out _beside_ the panes at 753px wide and 828px tall rather than above them. And the
  bar and the active chip were bothwhite — the same token — so the active view was marked with nothing.
  jsdom applies no CSS-module rules, so neither was visible to any test until an assertion was added
  for each: that the shell is a column, and that the chip's ground differs from the bar's.

  **The overflow's payload is now known** (2026-08-21): Rename, Brief & rules, Assets with a count,
  Export…, Engines, Move project…. It was left unbuilt because it had nothing to hold; it now has six
  items, three of which — Brief & rules, Assets, Engines — already exist elsewhere in the build.

- [x] **[BUG-069][P1][Creative Studio] The type scale is roughly double the design throughout** — found 2026-08-21, measured
  - Project title: design **Manrope 700 at 14.5px**; built **Manrope 700 at 29px** — exactly 2×.
  - Largest type anywhere: design **23px**; built **29px**.
  - The three typefaces are already correct and loaded in both — Manrope, IBM Plex Mono, Source Sans 3. Nothing needs adding. What diverges is the scale, and it is what makes the built UI read as a settings page rather than a dense production tool.

  **Fixed by `d16bce78e`.** The project title was inheriting a 29px heading default; it is now set at
  the drawn Manrope 700 14.5px. A test asserts no rule in the workspace stylesheet exceeds 23px, the
  largest type anywhere in the drawing.

- [x] **[BUG-070][P1][Creative Studio] The view switch uses the wrong type treatment and sits in the wrong place** — found 2026-08-21, measured
  - Design: `IBM Plex Mono`, **9.5px**, uppercase, `letter-spacing: 0.08em`, chips inside the app bar, right-aligned.
  - Built: `Source Sans 3`, **14.5px**, sentence case, `letter-spacing: normal`, pills on their own row below the title, left-aligned.
  - The underlying markup is sound — `<nav aria-label="Workspace views">` with `aria-current="page"`. This is styling and placement only.
  - **Placement answered 2026-08-21: the chips live in the app bar**, right-aligned, before `Render…`. They only leave it at rung 5 of the yield ladder, below a **603px** bar — a width the product never reaches, since the bar spans 1211px. Build them in the bar and treat the ladder's rung 5 as a later concern.
  - The capitals are authored into the prototype's strings, which compute `text-transform: none`. Do not copy that — use `text-transform: uppercase` and keep the key in sentence case, or the eleven fallback locales and every caseless script inherit English casing.

  **Fixed in two parts.** `d16bce78e` gave the chips the drawn treatment — IBM Plex Mono 9.5px with
  0.76px tracking, 6px corners, 5x11 padding — and marked the active one by its ground rather than by
  weight, since both compute 400 in the drawing and bolding one reflows the row on every view change.
  The capitals are a CSS transform rather than typed into the strings, so the eleven locales that fall
  back to en-US and every caseless script do not inherit English casing; a test asserts both halves.
  `ad0d5d201` then placed them in the app bar, which is where the drawing puts them and which could
  not happen until the bar existed.

- [x] **[BUG-071][P1][Creative Studio] The Cut view is a settings form; the design is a playback editor** — found 2026-08-21
  - Design (dark surface): a large preview panel badged `BEAT 01 · Cold open`; a transport row with play, `0:00 / 2:58`, and `PICTURE ONLY — THE BED IS MUTED HERE`; a right `THE FILM` panel showing `2:58` against `OF 3:00 TARGET` with a `2s UNDER` pill and `9 BEATS · 16 SHOTS · 1 SLATE`; a `MATCH TO` panel with reference thumbnails and `03 · SHOT 01 IS THE REFERENCE`; an inline warning row `BEAT 05 — No coverage. It exports as a 24s slate.` with an `OPEN THE BEAT` action; a numbered filmstrip of every beat in play order with per-beat durations; and an audio-bed waveform strip labelled `bed-season4.wav · 3:04 · ONE BED · AUTO-DUCKED`.
  - Built (light surface): a card with a duplicated `Cut` heading, a `0s film` chip, and three stacked form panels — Audio bed, Match To, Exports — made of dropdowns and buttons.
  - Every concept in the design is represented in the build, so the data layer is not the problem. The presentation is a different artifact: the design lets you _watch_ the film and see the timeline; the build lets you _configure_ it.
  - The filmstrip and the transport are the two pieces with no counterpart at all in the build, and they are the ones that make the Cut a cut.
  - **Target width answered 2026-08-21: 1158px, not 780px.** The Cut defaults to a **collapsed** rail, because judging a cut is watching and the preview should be the largest thing on screen. So this is a straight build of the drawn Cut at full width — **it needs no redraw**, and the re-proportioning worry recorded earlier does not apply to it.
  - **Bounded truthful picture-player slice fixed 2026-08-22; BUG-071 remains open for the full drawn Cut composition.** Cut now derives one revision-bound picture sequence in authoritative Beat/Shot order. It plays only exact canonical selected Takes from trim-in through trim-out, treats only an empty targeted Beat as a slate, and disables the whole player when covered media or duration/order authority is incomplete. Media failure and project/reorder revision changes pause/reset instead of skipping, shortening, looping, or auto-resuming. The preview is explicitly picture-only and muted; bed playback, filmstrip seek/Open Beat, full Match To/reference treatment, waveform, and the remaining layout redesign are not part of this slice.
  - **Fixed 2026-08-22 under the later navigation-and-judgement commission.** The filmstrip body remains the structural select/reorder surface and now carries its separate fused 18px time rail. Film and keyboard seeks resolve through exact video/slate offsets; Beat-boundary controls land 1.5s before a join, `L` loops ±2s, and boundary actions no-op instead of reversing direction. Match To now has canonical managed thumbnails, slate warnings and the selected filmstrip Beat can open the existing Beat editor, and the bed is shown truthfully as a silent, from-zero extent applied only on export. The later commission supersedes the original waveform/filename/`AUTO-DUCKED` drawing: no bed audio plays in preview and no unsupported promise is shown. Poster-backed seek loading, media failure, stale events, and revision/reorder resets remain fail-closed and never skip, shorten, loop, or spend.

- [x] **[BUG-072][P3][Creative Studio] The Board's S/M/L density control is not in the design** — found 2026-08-21
  - The built Board carries an `S` / `M` / `L` toggle beside "Beat board". The prototype's Board has no density control — probed across the document, absent.
  - The design instead fixes a three-column grid of 16:9 image cards, each with a beat-number badge, title, description, a state pill, and a `2 SHOTS · 14s` footer. A no-coverage beat renders as a diagonal-striped placeholder rather than a photo.
  - **Resolved 2026-08-21, and it does not invert.** The Board defaults to a **collapsed** rail at **1158px**, where the designer confirms "three-up holds at 365px cards, so the Board needs no new column count". The density control was not a latent answer to a narrow column; there is no narrow column. Remove it unless it is wanted on its own merits.
  - **Fixed by `8c2aaad54`.** Board now removes the S/M/L density control and holds three equal 16:9 columns at the collapsed-rail target, with deterministic two-column compact and one-column narrow fallbacks.

## Open — whether the bar should span the chat pane

Raised by the owner on 2026-08-21, looking at the built bar: the top bar should not cover the chat
panel. **Left as built for now, by the owner's call.**

Recorded rather than actioned because it reopens the designer's Answer 1, which spans the bar across
both panes and gives its reasons: everything the bar carries is film-scoped, and a bar living inside
the workspace column would reassemble itself across a 378px jump every time the rail is toggled,
making a pane control read as an application-wide change.

Checked first, and it is not a rendering fault. The rail's top edge sits at exactly the bar's bottom
edge — 101px — with no overlap. The bar spans by design.

If it is revisited, note what moves with it. A bar scoped to the workspace lives in 799px rather than
1230px, which puts it back inside the yield ladder's range where rungs begin to fire, and BUG-070's
chip placement follows the bar wherever it goes. A smaller option was offered and not taken: keep the
span and give the chat pane its own heading back, since it currently has no identity at all — the
rail lost its header to the bar and shows blank space above a composer.

## Settled — the rail stays, and the bar heads the project

**The rail stays.** Decided by the owner on 2026-08-21. Plan Task 9 mandates "one docked collapsible
Director rail"; the prototype had no such rail on any screen. The plan wins. Do not file the rail's
presence as a fidelity defect and do not remove it while closing BUG-068 through BUG-074.

**The bar spans, and the rail loses its header.** Answered by the designer on 2026-08-21 in
`creative-studio-3-app-bar-answer.html.txt`, sha256 `4a00962a…52b0d6`. Everything the bar carries is
film-scoped — the project's name, the film's clock, the film's render gate, the views of that film —
so the bar is the project's header and both panes sit under it. The rail is one of the project's two
panes, not a sibling of the project. The deciding argument is the toggle: a bar inside the column
would reassemble itself across a 378px jump every time someone opened or closed a conversation panel,
making a pane control read as an application-wide change.

**The 28px shortfall is resolved, and my arithmetic had a wrong input.** The earlier finding — that
the bar needs 808px and the column offers 780px — was correct arithmetic on a fixed 206px title,
because the prototype gave no truncation rule. There is one now: the title is a box, `flex: 0 1 auto`,
**320px ceiling, 128px floor**, one line, tail ellipsis, verified against the drawing as
`max-width: 320px; text-overflow: ellipsis; white-space: nowrap`. At a 780px bar the title is spared
178px and yields; nothing else has to. Note the drawing carries the ceiling but not the floor — it
renders at 1211px where nothing fires — so **the 128px floor has to be added in implementation**, or
rung 2 below has no trigger.

**The yield ladder, for when the bar is narrow.** Thresholds are the bar's own width. Shed what we
derived before truncating what the user typed, and never change the bar's height.

| Rung | Fires below | What yields                                                              | Minimum after      |
| ---- | ----------- | ------------------------------------------------------------------------ | ------------------ |
| 0    | —           | flexible spacer goes to zero                                             | 961px at title 320 |
| 1    | 961px       | title shrinks inside its box, 320px to 128px                             | 769px at title 128 |
| 2    | 769px       | stat strip drops `9 BEATS` — derived, and the Table shows it             | 699px              |
| 3    | 699px       | stat strip drops `5 READY`; the clock stays, it is the film's constraint | 645px              |
| 4    | 645px       | `Render…` loses its label and becomes the glyph                          | 603px              |
| 5    | 603px       | view chips leave the bar and head the workspace column                   | 436px floor        |

**At the width we build — 1211px — no rung fires.** Two alternatives were considered and rejected:
putting the stat strip under the title, because it takes the bar from 54px to about 76px and moves
every view's top edge and the Table's sticky header; and letting the overflow absorb `Render…`,
because it is the one action in the bar that spends money and the one the bar exists to offer. It may
lose its label; it may not become invisible.

**The rail's default follows the view, and is not a global preference.**

| View  | Rail default  | Design target | Why                                                                           |
| ----- | ------------- | ------------- | ----------------------------------------------------------------------------- |
| Table | **Expanded**  | 780px         | Pre-picture work. Writing coverage is a conversation.                         |
| Board | **Collapsed** | 1158px        | Picking takes is looking.                                                     |
| Cut   | **Collapsed** | 1158px        | Judging a cut is watching; the preview should be the largest thing on screen. |

A manual toggle sticks **per view, per project** and outranks the default from then on. Never
re-expand a rail the user closed — that is the named failure mode. This is new behaviour rather than
a fidelity fix, so it is filed as BUG-073.

- [x] **[BUG-073][P2][Creative Studio] The rail's default should follow the view, and a manual toggle should stick per view and per project** — filed 2026-08-21 from the designer's answer
  - Today the rail is expanded everywhere with a single toggle and no persistence.
  - Required: Table defaults expanded, Board and Cut default collapsed. A manual toggle overrides the default and persists **per view, per project**. A rail the user closed is never re-expanded automatically.
  - The persistence scope is the part to get right: per project alone would make the Table's default fight the Board's, and a global preference would defeat the point of a per-view default.
  - New behaviour, not a fidelity fix. It is what makes the 1158px targets in BUG-071 and BUG-072 real — without it every view renders at 780px and the two collapsed-target views are wrong by default.

  **Built 2026-08-21, and the design targets are now real rather than nominal.** Measured live with
  nothing stored: the Table opens the rail and leaves the workspace **790px**, the Board and the Cut
  shut it and leave **1177px**. The drawn targets are 780px and 1158px; the difference is this window
  being a little wider than the 1492px the designer measured at.

  A choice outranks the default from then on and is scoped to one view of one project. Opening the
  rail in the Board keeps it open there on return, while the Cut keeps its own default and the Table
  keeps its own — verified in that order, in the running app. That scoping is what stops the default
  re-opening a rail somebody shut, which the designer named as the failure mode to avoid.

  Both rules are mutation-proved: flattening the default to one global value fails the per-view test,
  and letting the default outrank a stored choice fails the persistence test.

  One consequence worth knowing. The preference persists, so a test that toggles the rail now decides
  the starting state of every test after it. `StudioPage.dom.test.tsx` clears `localStorage` between
  tests for that reason — it passed in isolation and failed in suite position until it did.

- [x] **[BUG-074][P2][Creative Studio] The Table needs its 860px Look-folding rule** — filed 2026-08-21, **ruled by the designer the same day; unblocked**
  - The Table is the one view that defaults to an **expanded** rail, so 780px is its design target rather than a degraded state. At that width the designer measures `ACTION` at about 200px and `LOOK` at about 160px.
  - **The ruling: at 860px of column width and below, the `LOOK` column folds into the `ACTION` cell as a second line.** One threshold, one change. Nothing else moves — the five fixed columns keep their widths, the row keeps one height class, and the Beat panel is unaffected. At a 780px column the merged Action cell is 374px.
  - **Spec**, transcribed from the designer's drawing:
    - Threshold: **860px of column width, measured the same way the coverage bar's density tiers are** — that is `getBoundingClientRect().width` fed through a `ResizeObserver`, with a pure function deciding the tier. `CoverageBar.tsx:116-121` and `coverageDensityForWidth` are the working precedent; follow them rather than inventing a second measurement style.
    - Look line: **Source Sans 3 12.5px, `#6E6553`**, 3px below the Action, clamped to two lines with tail ellipsis.
    - An empty Look keeps its **`#B4380F`** prompt — the `No look written yet` state the built Table already renders through `styles.lookMissing`.
    - Header reads `ACTION · LOOK`. Both remain sortable.
  - **Why the Look is the one that folds**, in the designer's terms: the Action is what the Beat does, the Look is how it is conditioned. Reading a table you scan the Actions in sequence and consult a Look only for the Beat you are about to open. A subordinate line states that relationship; two columns pretend they are peers.
  - The columnar alternative at 780px was drawn and rejected: two narrow prose columns side by side at 198px and 156px, each breaking at a different point, with row height set by whichever wrapped worse — one Beat wrapping to three lines in a 156px cell to say something the reader is not looking at yet.
  - **The build already has most of the pieces.** `Views/Table/index.tsx` renders a `look` cell with a `lookMissing` variant and an existing `table.lookMissing` key. What it lacks is the width measurement and the fold.

  **Provenance — read this before treating the spec above as pinned.** Every other design authority here is a committed file with a recorded hash: the prototype `642c8b16…0846ee`, the app-bar answer `4a00962a…52b0d6`. **This ruling arrived as a screenshot, so there is nothing to pin and the spec above is a transcription.** Three of its claims were verified against the pinned prototype and hold exactly: `#6E6553` at Source Sans 3 12.5px is already the Look column's computed style, `#B4380F` is already the row's no-coverage colour, and 12.5px is used by no other face. So the tokens introduce nothing new and the transcription is corroborated where it can be. The unverifiable parts are the two numbers that exist only in the drawing — the **860px** threshold and the **3px** offset. Ask the designer for the standalone HTML before building, or accept those two as transcribed.

  **Fixed by `c503c8f9d`.** At 860px of column width and below the Look folds into the Action cell as
  a second line, measured the way the coverage bar's density tiers are. An unmeasured width does not
  fold, so the folded form is not rendered and then undone on every mount. The empty-Look prompt was
  aligned with the drawing at the same time — it now keeps the warning colour the row's NO COVERAGE
  state uses, in both the folded and columnar forms, where it had been the muted text colour.

## The designer's fifth round — what it settles, and what the build already satisfies

`creative-studio-3-direction-and-answers.md` §12–13 arrived 2026-08-21 and answers the three Beat
panel questions. Four of its rulings are checkable against the build today; all four now hold.

| Ruling                                            | Build                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| §13.5 the density tier's name must not be visible | holds — `CoverageDensity` is an internal type, and `WIDE · FULL DETAIL` exists only in the prototype |
| §5 `AUTO-DUCKED` must come out                    | holds — absent                                                                                       |
| §13.5 the 25-word Look cap is soft                | holds — `BeatPanel/index.tsx:1149` warns above 25 and never blocks                                   |
| §13.1 severing the chain is gated and costed      | holds — the atomic paid sever/re-join gate closed BUG-095 on 2026-08-23                              |

The answers also carry remaining work the drawing does not yet show, listed in §13.4 and not filed as
defects because nothing was built wrong: `RENDERS AS` gaining per-part attribution and a staleness
flag, and the join `+` gaining a conditional quote.

Both carry a constraint worth keeping visible when they are built. `RENDERS AS` **must read
from the same compose function the job uses** (§13.2) — a readout assembled separately for display is
a lie the moment dispatch changes, and one that costs money to discover. And the join `+` quotes
**only mid-beat** (§13.3); at the end of the beat nothing moves and it is free, because a cost hint on
every marker is decoration, and decoration beside a price teaches people to stop reading prices.

§13.3 also settles the question that reached furthest: **beat duration is a total that follows from
the shots, not a target they must fit.** Inserting extends the beat; nothing redistributes. Every
fit-to-target reading in the app is advisory, with one carved exception — a beat with no coverage
renders a slate `target` seconds long, the only place an authored number reaches the renderer.

## Answered — the navigation and judgement commission

The designer replied 2026-08-22 with `creative-studio-3-navigation-and-judgement.html.txt`
(sha256 `e04987cc5f7e7371…`), an interactive drawing covering BUG-071 and BUG-088 together. **Written
answers are promised as §14 of the direction document and have not arrived yet** — the drawing
forward-references them. Everything below is read from the drawing itself.

**The seek answer, and it dissolves the conflict.** _"A strip's body owns structure. A rail under it
owns time."_ There is **no separate scrubber**: the filmstrip gains an **18px rail fused inside its own
border**, ticked at every Beat boundary. The body keeps select-and-reorder; the rail seeks. So §12.4 is
not reversed — the Cut still does not need redrawing, it needs a rail — and the filmstrip stops being
a control that pretends not to be a timeline.

**Seek is free, and says so.** The price list gains a third row: `▭ RAIL · SEEK · FREE` beside
`↔ EDGE · TRIM · FREE` and `↔ BOUNDARY · COSTS A RE-RENDER`. _"Seek is free at every scale."_

**The audio row was redrawn to what we store, not what was wished for.** Every constraint accepted:
_"an asset, a position, a duration. No filename, no waveform, no ducking, and no lane inside the
timeline."_ The bed moves **below** the film rather than into it, because _"the bed is a property of
the export"_. It reads `ASSET 4C1F · 3:04 · FROM 0:00`, `SILENT IN PREVIEW`,
`EXTENT AND POSITION ONLY · APPLIED ON EXPORT · FADES OUT AT THE CUT'S END`. A `bedRow` prop offers
three densities — `extent | line | none`.

**The Beat transport is Beat-scoped, and the seam problem is answered.** _"Three files, one clock — a
seek inside a Beat resolves to a shot and an offset into its take. The transport is Beat-scoped because
the chain is."_

**Joins get buttons, and that is the judgement act.** _"Scrubbing finds a moment; a join is a place you
return to."_ `◂ JOIN` lands 1.5s before a join; `L` loops ±2s across it. The drawing labels this
_"the judgement state… this is what the human is for"_ — §1's division of labour made operable.

**Both bad landings are drawn**, which is what makes this buildable: a seek into a still-decoding clip
holds a **poster** (_"the clock is already right… never a blank frame and never a rewind"_), and a seek
into an uncovered Beat lands instantly on the slate, which counts its own time.

**Keyboard:** `SPACE` play · `← →` 1s · `⇧ ← →` 0.2s · `[ ]` join · `L` loop.

Neither bug is closed by a drawing. Both now have one.

## Verification notes

### Verified live 2026-08-22 — a new project is generable from birth

After BUG-097 and BUG-099, a project created from the composer, on a machine with one provider and
no Studio connections, ends up with:

| Route | Reads                                                |
| ----- | ---------------------------------------------------- |
| Image | `OpenRouter · google/gemini-3-pro-image` — **Ready** |
| Video | `OpenRouter · bytedance/seedance-2.0` — **Ready**    |

No visit to Settings, and no "Unavailable". The video route is `seedance-2.0` specifically — the only
model in `MANAGED_FIRST_FRAME_MODELS` — so the picker's `supportsFirstFrame` preference is doing its
job against a real catalogue rather than only against fixtures.

That is Slices 1 and 1a complete, and it took three live runs to get there: the first bound nothing
and looked like it bound image, the second bound image but not video, the third binds both.

### Verified live 2026-08-22 — Slice 1a, connection provisioning

Driven in an instance that had exactly the failure it targets: one provider (OpenRouter) configured,
no Studio connection bound, and both route pickers reading `Selection required` with zero options.

Creating one project from the composer now produces:

| Field                            | Before               | After                             |
| -------------------------------- | -------------------- | --------------------------------- |
| Image route                      | `Selection required` | `choice_000290ca7fd86013f59825d5` |
| Video route                      | `Selection required` | `choice_442687563c09dd91be3844cb` |
| `Selection required` occurrences | 2                    | **0**                             |

Both cliffs are gone in one pass: the connection was provisioned and the routes were bound, without a
visit to Settings.

**Not verified:** that the chosen video route is first-frame-capable. The picker would not open its
option list under automation, so the capability behind that choice id was not read. The unit tests
prove the picker prefers `supportsFirstFrame` when more than one video route exists; whether more
than one existed here is unknown.

### Verified live 2026-08-22 — the Table and Board round

Codex's five closures measured in the running app, since all five are layout claims and jsdom applies
no CSS.

| Bug     | Claim                             | What the DOM reported                                                                                                  |
| ------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| BUG-078 | folded Table fits, no 860px floor | folded grid **406px** total, `gridOverflow 0`, document overflow **0**; the header merges to `Action · Look` per §12.4 |
| BUG-079 | LENGTH states one fact            | `14s`, `22s`, `31s`, `26s`, and `~24s target` — and the two forms differ, which is also §2.2's requirement             |
| BUG-080 | titles neutral 13px               | `rgb(20, 24, 31)` = `#14181F`, `13px`, weight `600`                                                                    |
| BUG-081 | one control per resting card      | 10 buttons for 9 Beats — one `Open <beat>` each plus a global undo; nothing destructive                                |
| BUG-072 | no S/M/L control                  | absent; `grid-template-columns: 309.3px 309.3px 309.3px`, three equal columns                                          |

**One false alarm of mine, recorded so it is not re-raised.** With the rail dragged to 721px on a
1390px window the `STATE` header sits at x=1454, past the viewport, which looks exactly like BUG-078's
symptom. It is not. The table has its own `overflow-x: auto` container scrollable by 128px and the
document does not scroll at all — a 280px work column simply cannot show a 406px table, and scrolling
inside the container while the body stays put is what the repo's own responsive rule asks for. The
symptom was my extreme rail width, not the fix.

### Verified live 2026-08-21, after Codex's fixes

Measured in the running app against the project that holds real generated media, because none of
these four can be proved by a test that renders into jsdom.

| Bug     | Claim                       | What the DOM reported                                            |
| ------- | --------------------------- | ---------------------------------------------------------------- |
| BUG-084 | durations rounded           | `15s source`; no six-decimal float anywhere in the Cut           |
| BUG-085 | counts pluralized           | `1 Slate`, `9 Beats`, `16 Shots`, `2 Shots`                      |
| BUG-086 | flat proportional filmstrip | 64px tall, 9 segments each 62px, widths 76→167 tracking duration |
| BUG-087 | handle off the label        | label y 671–690, handles y 723–753, zero overlapping elements    |

BUG-087 is worth a note: the handles sit at x 349–367, still inside the label's horizontal span. The
fix works by putting them in a different grid row, not by moving them sideways — so a future change
that collapses those rows brings the defect straight back.

Codex also removed `FILMSTRIP_TITLE_MIN_WIDTH_PX = 112` and `filmstripShowsTitle` in favour of a CSS
rule. That was the right call: 112 was a midpoint I guessed between two observed widths and flagged
as needing the designer's confirmation, and it is better gone than pinned by a test.

- The unit suite is green on the files touched here — `studioI18n.test.ts` and `CutView.dom.test.tsx` pass, 17 tests. None of the seven bugs above is caught by a test, and BUG-061 is actively hidden by one.
- The 11 non-`en-US` locales are missing the new Cut keys **by design**, pinned by `studioI18n.test.ts` — "defers all 11 translations and falls each locale back to the complete en-US workspace". Not a bug; recorded so it is not filed as one.
- A project named `race repro probe` was left in the slot-2 Studio library by the BUG-061 reproduction.

## Appendix — the designed app bar, measured

Extracted from the hash-pinned prototype at a 1280px window on 2026-08-21. Every value is a computed
style read off the rendered document, so these are the design's actual numbers rather than a reading
of the picture. Recorded here because BUG-068, BUG-069 and BUG-070 are not implementable without them.

**Container.** One `flex` row, `align-items: center`, `gap: 11px`, `padding: 11px 18px`, resolved
height **54px**, background `rgb(251, 247, 240)`, `border-bottom: 1px solid rgb(228, 217, 198)`,
spanning the full window (1272px of 1280px).

**Children, in order** — a project dot, the title, the stat strip, a flexible spacer that absorbs all
slack (464px at this width), then the view chips, the primary action, and the overflow:

| Element             | Type          | Size   | Weight | Tracking | Colour                      | Box                               |
| ------------------- | ------------- | ------ | ------ | -------- | --------------------------- | --------------------------------- |
| Project dot         | —             | —      | —      | —        | `rgb(236, 99, 56)`          | 22×22, radius 6px                 |
| Project title       | Manrope       | 14.5px | 700    | −0.145px | `rgb(20, 24, 31)`           | —                                 |
| Stat strip          | IBM Plex Mono | 9.5px  | 400    | 0.57px   | `rgb(110, 101, 83)`         | —                                 |
| View chip, inactive | IBM Plex Mono | 9.5px  | 400    | 0.76px   | `rgb(140, 127, 108)`        | transparent, radius 6px, pad 5×11 |
| View chip, active   | IBM Plex Mono | 9.5px  | 400    | 0.76px   | `rgb(42, 48, 59)`           | white, radius 6px, pad 5×11       |
| `Render…`           | Manrope       | 12px   | 700    | normal   | white on `rgb(201, 67, 26)` | radius 8px, pad 7×13              |
| Overflow `⋯`        | IBM Plex Mono | 12px   | 400    | normal   | `rgb(110, 101, 83)`         | radius 8px, pad 5×9               |

**Two notes for whoever implements it.**

The uppercase in `TABLE` / `BOARD` / `CUT` and in the stat strip is **authored into the strings**, not
applied by CSS — every one of these computes `text-transform: none`. Do not copy that. Casing baked
into an `en-US` value is wrong for the eleven locales that fall back to it and wrong for any locale
whose script has no case. Use `text-transform: uppercase` and leave the key in sentence case.

The bar spans the full window in the prototype, which has no Director rail. With the rail kept, the
spanning question in the Settled section above has to be answered before these numbers can be
applied — the 464px spacer is what makes the layout work, and it is the first thing to go when the
content column drops to 780px.
