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

## Coverage and polish

- [x] **[BUG-064][P2][Creative Studio] The video allowlist covers 6 of the 24 models OpenRouter serves, with no way to extend it** — found 2026-08-21, verified against the live catalogue
  - `OPENROUTER_VIDEO_MODELS` (`openRouterVideoAdapter.ts:44`) allowlists six. All six are real and currently served — verified individually, so this is not a stale-identifier bug: `google/veo-3.1-lite`, `google/veo-3.1-fast`, `kwaivgi/kling-v3.0-std`, `kwaivgi/kling-v3.0-pro`, `bytedance/seedance-2.0`, `bytedance/seedance-2.0-fast`.
  - Live and unbindable: `openai/sora-2-pro`, `google/veo-3.1` (full), `bytedance/seedance-2.5`, `bytedance/seedance-1-5-pro`, `bytedance/seedance-2.0-mini`, `runway/gen-4.5`, `runway/aleph-2`, `minimax/hailuo-3`, `minimax/hailuo-2.3`, `alibaba/wan-2.7`, `alibaba/wan-2.6`, `alibaba/happyhorse-1.1`, `alibaba/happyhorse-1.0`, `kwaivgi/kling-video-o1`, `black-forest-labs/flux-3-video`, `black-forest-labs/flux-video-upscale`, `x-ai/grok-imagine-video-1.5`, `x-ai/grok-imagine-video`.
  - **`bytedance/seedance-2.0` is the only allowlisted OpenRouter model that supports a first frame**, so the CS3 continuity chain currently rests on one binding. If it is unavailable to an account, first-frame continuity is unreachable through OpenRouter.
  - The allowlist itself is defensible — each entry carries duration bounds, resolutions, ratios and a first-frame flag that the catalogue does not expose, and the adapter needs those facts. The defect is that it is hardcoded with no admission path, and it has already drifted behind the catalogue.
  - **Fixed by `b01c565ee`** — OpenRouter video models are now admitted from a strict live catalogue with durable discrete capabilities, refresh-race fencing, and final pre-submit revalidation.

- [ ] **[BUG-066][P3][Creative Studio] The Cut view renders a duplicated "Cut" heading** — found 2026-08-21, confirmed by DOM inspection of all three views
  - Cut emits two `H2 "Cut"` — the view wrapper's heading and the panel's own `cut.title` (`Views/Cut/index.tsx:207`). Table emits one heading; Board's second heading is "Beat board", so neither sibling collides.
  - Live heading trees: Table `[H1 project, H2 "Table"]`; Board `[H1 project, H2 "Board", H2 "Beat board", H2 "Bin"]`; Cut `[H1 project, H2 "Cut", H2 "Cut", H3 …]`.
  - Also an accessibility defect: two identical sibling headings at the same level give screen-reader users no way to tell the wrapper from the panel.

- [ ] **[BUG-067][P2][Creative Studio] The project-settings and spend-policy forms are not in the design at all, and render under all three views** — found 2026-08-21; **open question resolved 2026-08-21 against the prototype**
  - "Project settings" and "Brief, routes, and spend policy" render identically below Table, Board and Cut.
  - This entry originally asked whether the repetition was intentional. It is worse than repetition: the hash-pinned prototype contains **no project-settings surface anywhere** — probed for `project settings`, `spend policy` and `aspect ratio` across the whole document, all absent.
  - So the question is not which view should host the form, but whether the form belongs in the workspace at all. Resolve with the designer before moving it.

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

- [ ] **[BUG-071][P1][Creative Studio] The Cut view is a settings form; the design is a playback editor** — found 2026-08-21
  - Design (dark surface): a large preview panel badged `BEAT 01 · Cold open`; a transport row with play, `0:00 / 2:58`, and `PICTURE ONLY — THE BED IS MUTED HERE`; a right `THE FILM` panel showing `2:58` against `OF 3:00 TARGET` with a `2s UNDER` pill and `9 BEATS · 16 SHOTS · 1 SLATE`; a `MATCH TO` panel with reference thumbnails and `03 · SHOT 01 IS THE REFERENCE`; an inline warning row `BEAT 05 — No coverage. It exports as a 24s slate.` with an `OPEN THE BEAT` action; a numbered filmstrip of every beat in play order with per-beat durations; and an audio-bed waveform strip labelled `bed-season4.wav · 3:04 · ONE BED · AUTO-DUCKED`.
  - Built (light surface): a card with a duplicated `Cut` heading, a `0s film` chip, and three stacked form panels — Audio bed, Match To, Exports — made of dropdowns and buttons.
  - Every concept in the design is represented in the build, so the data layer is not the problem. The presentation is a different artifact: the design lets you _watch_ the film and see the timeline; the build lets you _configure_ it.
  - The filmstrip and the transport are the two pieces with no counterpart at all in the build, and they are the ones that make the Cut a cut.
  - **Target width answered 2026-08-21: 1158px, not 780px.** The Cut defaults to a **collapsed** rail, because judging a cut is watching and the preview should be the largest thing on screen. So this is a straight build of the drawn Cut at full width — **it needs no redraw**, and the re-proportioning worry recorded earlier does not apply to it.

- [ ] **[BUG-072][P3][Creative Studio] The Board's S/M/L density control is not in the design** — found 2026-08-21
  - The built Board carries an `S` / `M` / `L` toggle beside "Beat board". The prototype's Board has no density control — probed across the document, absent.
  - The design instead fixes a three-column grid of 16:9 image cards, each with a beat-number badge, title, description, a state pill, and a `2 SHOTS · 14s` footer. A no-coverage beat renders as a diagonal-striped placeholder rather than a photo.
  - **Resolved 2026-08-21, and it does not invert.** The Board defaults to a **collapsed** rail at **1158px**, where the designer confirms "three-up holds at 365px cards, so the Board needs no new column count". The density control was not a latent answer to a narrow column; there is no narrow column. Remove it unless it is wanted on its own merits.

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

- [ ] **[BUG-073][P2][Creative Studio] The rail's default should follow the view, and a manual toggle should stick per view and per project** — filed 2026-08-21 from the designer's answer
  - Today the rail is expanded everywhere with a single toggle and no persistence.
  - Required: Table defaults expanded, Board and Cut default collapsed. A manual toggle overrides the default and persists **per view, per project**. A rail the user closed is never re-expanded automatically.
  - The persistence scope is the part to get right: per project alone would make the Table's default fight the Board's, and a global preference would defeat the point of a per-view default.
  - New behaviour, not a fidelity fix. It is what makes the 1158px targets in BUG-071 and BUG-072 real — without it every view renders at 780px and the two collapsed-target views are wrong by default.

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

## Verification notes

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
