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

## Blocking a first-run user

- [ ] **[BUG-061][P1][Creative Studio] Every newly created project fails its first Director attach** — found 2026-08-21 by creating a project in the running app; **reproduced deterministically** on a second, clean project
  - Actual: immediately after "Create project", the Director rail shows "Director setup was interrupted before the conversation could be attached to this project." over "Creative Studio could not read or save this workspace." The project's `briefConversationId` stays `null` at revision 1. Clicking **Retry** fixes it every time.
  - Root cause: the renderer dictates the conversation id and then hard-asserts the result — `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorRail/index.tsx:444` builds `{ type: 'aionrs', id: input.conversationId, … }`, and line 479 throws `STORAGE_ERROR_KEY` when `conversation.id !== input.conversationId`. **aioncore does not honour the requested id.** It mints its own 8-hex short id, so the assertion can never hold on a fresh create.
  - Wire evidence, one project's creation: `GET /api/conversations/f8c487cf_eb02_4c96_ac44_4434206ddc24` → **404**, immediately followed by `POST /api/conversations` → **201** with `conversation_id=8a49d04b`. The requested id is a 36-char underscore-uuid; the assigned id is 8 hex characters.
  - Binding evidence, probed live through `creativeStudio.getProject`: before Retry `{revision: 1, briefConversationId: null}`; after Retry `{revision: 2, briefConversationId: "47b03580"}` — **aioncore's short id, not the uuid that was requested**. That is why Retry works: recovery matches the existing conversation by `extra.studio_project_id` and binds the real id, bypassing the equality check entirely.
  - The in-code comment at line 463 — "idempotent by deterministic id" — states an assumption this backend does not satisfy.
  - **Same defect class as BUG-046 and BUG-048, both already fixed, at a third site neither covered.** BUG-046 established that real conversation ids are 8-hex short ids across 35 live conversations while code validated RFC-4122 UUIDs; BUG-048 swept the runs and sources features. The Studio Director rail was not swept.
  - Why the suite is green: mocking `conversation.create` to echo back the requested id makes the assertion pass forever. This is the fixture-from-types-not-from-the-wire failure mode that hid all five EPIC-002 defects.
  - Fix direction: treat the id returned by `conversation.create` as authoritative and bind that; key recovery on `extra.studio_project_id`, which is already the mechanism that works. Do not simply delete the equality check — it exists to make create idempotent across a crash, so the idempotency story has to move to `studio_project_id` rather than disappear.

- [ ] **[BUG-063][P1][Creative Studio] There is no path in the UI to discover a bindable video model id** — found 2026-08-21 while configuring a video engine
  - Actual: "Add media model" → Video → OpenRouter → OpenRouter video rejects every model id offered anywhere in the UI. Searching the provider's model picker for `byte`, `seed`, or `seedance` returns only text models.
  - Root cause: **OpenRouter serves two disjoint catalogues**, verified live on 2026-08-21 — `https://openrouter.ai/api/v1/models` returns 418 text/LLM models, and `https://openrouter.ai/api/v1/videos/models` returns 24 video models (200 unauthenticated). The provider "Add Model" picker fetches the **text** catalogue via `POST /api/providers/fetch-models`, so a video model can never appear in it.
  - The media-model dialog's own Model field does not help either: its autocomplete is fed from `selectedCandidate.models` — the same text catalogue — with no filter by the selected integration (`StudioMediaModelsSection.tsx:173`). Choosing "OpenRouter video" still suggests GPT and Gemini ids.
  - Net effect: a user cannot configure video generation without reading `adapters/openRouterVideoAdapter.ts`. The six valid ids appear nowhere in the product.
  - Fix direction: when an integration declares a closed model set, the Model field should _be_ that set rather than free text over the wrong catalogue.

## Correctness and honesty of failures

- [ ] **[BUG-062][P2][Creative Studio] Three distinct Director failures all report "could not read or save this workspace"** — found 2026-08-21 while diagnosing BUG-061
  - `STORAGE_ERROR_KEY` is thrown for at least three unrelated causes in `DirectorRail/index.tsx`: a brief-session descriptor mismatch (~441), a created-conversation id mismatch (479), and an MCP snapshot mismatch (482). None of them is a storage failure.
  - Measured cost: the message sent diagnosis at the filesystem. Time was spent confirming whether `~/.aionui-dev-2` being a symlink to `Library/Application Support/Forge-Dev-2/aionui` was tripping a path-containment guard in `store.ts`. It was not.
  - That false trail is expensive **because a real bug of exactly that shape exists** — BUG-050, "workspace containment is lexical, so a symlinked data directory rejects files that are inside the workspace". A wrong error message that names a real neighbouring failure mode is worse than a generic one.
  - Fix direction: give each cause its own message key. Fixing BUG-061 removes one of the three throws but leaves the overload.

- [ ] **[BUG-065][P2][Creative Studio] Media-model validation discards the reason it failed** — found 2026-08-21
  - The adapter distinguishes `unsupported`, `auth`, `timeout` and `unknown` (`openRouterVideoAdapter.ts:404`), and the IPC result carries the code. `StudioMediaModelsSection.tsx:243` collapses every outcome to `null`, and the dialog renders one string: "Connection validation failed."
  - So "this model does not support video" and "your API key was rejected" are indistinguishable in the product. Combined with BUG-063, a user given a wrong model id has no signal telling them the id is the problem.
  - Same anti-pattern as BUG-062: a distinct failure wearing a generic label. Two independent instances of it in one session.

## Coverage and polish

- [ ] **[BUG-064][P2][Creative Studio] The video allowlist covers 6 of the 24 models OpenRouter serves, with no way to extend it** — found 2026-08-21, verified against the live catalogue
  - `OPENROUTER_VIDEO_MODELS` (`openRouterVideoAdapter.ts:44`) allowlists six. All six are real and currently served — verified individually, so this is not a stale-identifier bug: `google/veo-3.1-lite`, `google/veo-3.1-fast`, `kwaivgi/kling-v3.0-std`, `kwaivgi/kling-v3.0-pro`, `bytedance/seedance-2.0`, `bytedance/seedance-2.0-fast`.
  - Live and unbindable: `openai/sora-2-pro`, `google/veo-3.1` (full), `bytedance/seedance-2.5`, `bytedance/seedance-1-5-pro`, `bytedance/seedance-2.0-mini`, `runway/gen-4.5`, `runway/aleph-2`, `minimax/hailuo-3`, `minimax/hailuo-2.3`, `alibaba/wan-2.7`, `alibaba/wan-2.6`, `alibaba/happyhorse-1.1`, `alibaba/happyhorse-1.0`, `kwaivgi/kling-video-o1`, `black-forest-labs/flux-3-video`, `black-forest-labs/flux-video-upscale`, `x-ai/grok-imagine-video-1.5`, `x-ai/grok-imagine-video`.
  - **`bytedance/seedance-2.0` is the only allowlisted OpenRouter model that supports a first frame**, so the CS3 continuity chain currently rests on one binding. If it is unavailable to an account, first-frame continuity is unreachable through OpenRouter.
  - The allowlist itself is defensible — each entry carries duration bounds, resolutions, ratios and a first-frame flag that the catalogue does not expose, and the adapter needs those facts. The defect is that it is hardcoded with no admission path, and it has already drifted behind the catalogue.

- [ ] **[BUG-066][P3][Creative Studio] The Cut view renders a duplicated "Cut" heading** — found 2026-08-21, confirmed by DOM inspection of all three views
  - Cut emits two `H2 "Cut"` — the view wrapper's heading and the panel's own `cut.title` (`Views/Cut/index.tsx:207`). Table emits one heading; Board's second heading is "Beat board", so neither sibling collides.
  - Live heading trees: Table `[H1 project, H2 "Table"]`; Board `[H1 project, H2 "Board", H2 "Beat board", H2 "Bin"]`; Cut `[H1 project, H2 "Cut", H2 "Cut", H3 …]`.
  - Also an accessibility defect: two identical sibling headings at the same level give screen-reader users no way to tell the wrapper from the panel.

- [ ] **[BUG-067][P3][Creative Studio] Project settings and the spend-policy panel render under all three views** — found 2026-08-21; **confirm intent before fixing**
  - "Project settings" and "Brief, routes, and spend policy" render identically below Table, Board and Cut. Confirmed present in all three.
  - Neither the CS3 implementation plan nor the direction document places these panels in a specific view, so this may be deliberate shared chrome rather than leftover scaffold from the Task 7 placeholder. It reads as the latter because the panels sit inside the same card as the view body.
  - Resolve against the prototype (`creative-studio-3-beat-and-shot-reference.html.txt`) before changing anything.

## Verification notes

- The unit suite is green on the files touched here — `studioI18n.test.ts` and `CutView.dom.test.tsx` pass, 17 tests. None of the seven bugs above is caught by a test, and BUG-061 is actively hidden by one.
- The 11 non-`en-US` locales are missing the new Cut keys **by design**, pinned by `studioI18n.test.ts` — "defers all 11 translations and falls each locale back to the complete en-US workspace". Not a bug; recorded so it is not filed as one.
- A project named `race repro probe` was left in the slot-2 Studio library by the BUG-061 reproduction.
