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
- [ ] **[BUG-109][P1][Creative Studio] Video generation is globally serialised at one, so the drawn film-scale parallelism cannot happen** — measured 2026-08-22 while reviewing the chain handoff
  - `jobManager.ts:455` holds `semaphores = { image: new FifoSemaphore(2), video: new FifoSemaphore(1) }`. A per-project cap of two paid jobs in flight sits beside it (`jobManager.ts:95`), and **both** must be acquired before a submission. The job manager is a single app-wide instance held by the runtime's active graph, so the video semaphore is global — **one video generation at a time across every beat, every project, the whole application.**
  - The chain storyboard's film-scale panel draws four chains running side by side and asserts _"WORST CASE IS THE LONGEST CHAIN · NOT 11 GENERATIONS ADDED UP."_ Under this scheduler the worst case is exactly eleven generations added up. The handoff's own note that "nine chains is not nine simultaneous provider calls" is right in spirit and understates it: nine chains is one call.
  - **Measured, not estimated:** the video in the 2026-08-22 end-to-end run took roughly thirty-two minutes of wall clock. Eleven generations serialised is about five hours, against the ninety minutes a longest-chain reading implies. A pilot user watching a nine-Beat film render would wait most of a working day.
  - The bookkeeping is not wrong — chains genuinely are Beat-scoped and the dependency line is real. What is wrong is that Beats being the unit of parallelism buys nothing in throughput while the global video cap is one.
  - **The question to answer before anyone estimates that panel:** is `FifoSemaphore(1)` a deliberate cost or provider-rate-limit guard, or a default nobody has revisited? If deliberate, the drawing must reflect it and the film-scale promise has to change. If not, this is the single highest-leverage number in the product.
  - Reviewed in full at [chain handoff review](../../design/creative-studio-3-chain-handoff-review.md).
- [ ] **[BUG-110][P1][Creative Studio] A definitive HTTP 400 is reported as an ambiguous submission, so the user is asked to risk a duplicate charge for a request that certainly never ran** — measured 2026-08-23
  - `mapStatusError` in `openRouterVideoAdapter.ts` handles 401/403 as `auth`, 429 as `rate_limited` and 5xx as `provider_unavailable`, then falls through: **every 4xx becomes `unknown`**. `jobManager.ts:1107` turns an `unknown` submit failure into `needs_attention` with code `submission_unknown`.
  - A 400 is the provider stating plainly that it rejected the request. It is the _least_ ambiguous outcome there is, and it is the one the product describes as unknown.
  - **What that costs the user.** The Shot lands in `needs_attention`, the only way forward is **Retry generation → Acknowledge and review estimate**, and that acknowledgement exists to accept the risk of paying twice. For a 400 there is no such risk. Observed live: two full retry cycles, both 400, both presented as possibly-submitted.
  - It also makes a permanent failure look transient. A 400 will fail identically every time, so the honest response is to stop and say why, not to offer a retry that cannot succeed.
  - Fix: map 4xx other than 429/401/403 to a definitive rejection code. `invalid_request` already exists in `StudioJobErrorCode` and is exactly this case.
  - **The billing invariant held throughout, which is the reassuring half.** Two $0.60 authorizations were confirmed and **nothing was billed** — the single spend receipt in the project is the seed still. That matches the proof behind BUG-109: the one site that writes a receipt fires on the transition into `running`, and a 400 never gets there.

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
