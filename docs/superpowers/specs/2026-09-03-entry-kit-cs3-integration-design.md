# Short video templates for CS3

- **Date:** 2026-09-03
- **Source of the work:** `github.com/legacyrohuy/Video`, branch `feat/creative-studio-entry-kit`
  (tip `491f397`, base `d748641`). The entry kit was built against a CS2-era studio.
- **Target:** the shared CS3 production base, `codex/creative-studio-table-board-ui-design`
  (the four CS3 views, project schema 5, V2 IPC surface).
- **CS4:** deferred. This spec targets CS3 only.

## What we are building

A list of templates for short project videos. A person picks a template, gives a few inputs, one
clip is generated, and they watch it in the Cut view.

That is deliberately narrower than the entry kit it draws from. The source branch built a popup that
ran a five-step pipeline to a stitched multi-clip film without ever navigating away. We are taking
its template gallery and its brief composition, and replacing the pipeline with a single generation
that hands off to CS3's own views.

## Why CS3 needs it

CS3's studio library is a text box and nothing else: a header, a composer (textarea + aspect ratio +
duration + Start), then either a one-line empty state or a grid of project cards. A first-time user
has no idea what to type or what the product is for. CS3 has **no** entry surface — no templates, no
suggestions, no gallery.

The insertion point is unchanged from the source branch: CS3 kept `Library/` intact, and its
`Composer.tsx` is near-identical to the entry kit's pre-change baseline (same `sentence` /
`aspectRatio` / `targetDurationSeconds: 18` local state), differing only in taking
`CreateStudioProjectInputV2`.

## Decisions taken

Recorded as fixed; all three were made by the project owner during design.

1. **Rebuild the launch flow** rather than shipping the front door alone.
2. **Author deterministically.** No Director conversation, no proposal acceptance.
3. **Templates only, short, one shot.** Explore (24 worked examples across five shelves) and the
   quick-suggestion chips are out. The video is a single generated clip.

## Scope

**Ports:** the template gallery (`TemplateGallery`, `TemplateCard`, `TemplateModal`), the whole
`coverArt/` family, `data/templates.ts` + `data/templateCopy.ts` + `data/entrySettings.ts` +
`data/entryPlatforms.ts`, `composeInstruction`, `formatDuration`, `types.ts`, and the `Library/`
graft (three files).

**Dropped:** `QuickSuggestions`, `ExploreGallery`, `ExploreShelf`, `ExploreDetail`,
`data/exploreItems.ts`, `data/exploreCopy.ts`, `data/suggestions.ts`, `explore/exploreDetail.module.css`.
Explore's content is explicitly multi-clip — two examples are written as SECTION headings with
per-clip timestamps — so it would need re-authoring for one shot regardless.

**Not ported at all:** `runLaunch.ts` and the film export. See below.

The i18n `_pending` register and its scripts are independent of Studio and port on their own.

## The flow

**Phase A — free, re-runnable.**

1. `create-project` — `CreateStudioProjectInputV2` = `{ name, brief, aspectRatio,
   targetDurationSeconds, resolution }`
2. `set-rules` — the template's rules
3. `apply-authoring-batch` — `set_brief` + one `add_beat` + one `add_shot`
4. `get-generation-capability` — admission probe for the minted shot
5. `prepare-submission` — `baseChoices` holds that single shot

Ends holding `{ baseOnly, withCascade }`. Nothing has been spent.

**Capability is an admission probe, not a window probe.**
`StudioGenerationCapabilityRequestV2` takes `items: [{ target, purpose }]`, so it needs a shot that
already exists — which is why it follows the authoring batch rather than preceding it. It answers
"will Main admit this generation", returning `supportedItems` plus `blocks` carrying
`catalog_unloaded` / `no_engine` / `needs_setup` / `health` / `retired`. If our item is absent from
`supportedItems`, Phase A stops here with the block's reason, before anything is spent.

**The person authorizes the quote.**

**Phase B — paid, and very small.**

6. `confirm-submission` with the `baseOnly` quote id
7. Navigate to the project

That is the whole paid phase: one call and a navigation. CS3's own views own progress from there.

`prepare-submission` documents that an empty `cascadeChoices` asks main to derive a canonical
continuation, so a `withCascade` quote may come back. We ignore it and confirm `baseOnly` — a
single-shot video has nothing to continue.

### The single-shot spine

`StudioEditableBeat` is `{ title, story, targetSeconds }`. `StudioEditableShot` is
`{ shootingScript, durationSeconds }`. The renderer mints `beatId` and `shotId`, so the shot id is
known before `apply-authoring-batch` returns — which is what `prepare-submission` needs.

One beat, one shot. No merging, no section mapping, no positional beats.

**`shootingScript` is the composed brief** — `composeCreatorContext`'s output (tone, duration, frame,
format, the eight settings answers, the live clip window) followed by the template's `instruction`
verbatim. `composeInstruction` already builds exactly this string and ports unchanged.

Note for anyone reading the source branch's design notes: templates carry **no section spine**. The
founding document proposed seeding one ("level C"), but `StudioTemplate` is
`{ id, category, artFormat, formats, aspectRatio, durationsSeconds, rules }` — rules and a prose
instruction, no sections. There is nothing to merge, which is why the spine builder is trivial here.

### Durations come from the clip window

The source branch offers a fixed 14-value ladder from 15s to 210s, and asserts in
`entryKit.test.ts` that **no template target is under twenty seconds** — with the rationale written
into the type: a sub-20s recommendation "would be recommending a video whose section layer holds
exactly one clip."

One clip is now the goal, so that invariant inverts. The offered durations become the engine's own
window, and the test becomes a ceiling at `capability.maxDurationSeconds` rather than a floor at 20s.
This also retires the two-ladder inconsistency between `Composer.tsx`'s `DURATION_GUESSES` and
`types.ts`'s `STUDIO_ENTRY_DURATIONS`: both are replaced by window-derived values.

**Who owns duration validity.** The modal needs a window to offer durations before a project
exists, and the only one available comes from `list-routes` — display-only, and possibly stale. It is
not the authority. **Main is:** `add_shot` is rejected with `invalid_shot_duration`
(`STUDIO_MUTATION_REASONS_V2`) if the duration does not fit, so a stale display window costs a failed
free call at step 3 and never a wrong charge. This is a better guarantee than the source branch had,
where a stale window silently widened a renderer-side spend allowance.

### The quote

`prepare-submission` returns `{ baseOnly, withCascade }`. Each quote carries `id`, `expiresAt`,
`currency`, `baseItems`, `cascadeItems`, `lowerMinorUnits`, `upperMinorUnits` and a `budget` verdict.
`confirm-submission` takes `{ projectId, quoteId, expectedRevision }`.

This replaces the source popup's silent Proceed, which stated a clip count and no price. CS3 hands us
the price, so the panel states it.

An expired quote re-prepares silently, because Phase A is free. If the re-prepared range differs from
what was displayed, the change is surfaced rather than swapped underneath the person.

### Reaching the Cut view

Cut is addressable via `studioViewPath(projectId, 'cut')`, but `studioViewReadiness` gates it on
`stageHasContent(status, 'cut')`, and `StudioPage` runs an effect that resolves a ready view and
navigates with `replace: true`. So navigating to Cut at confirm time would be bounced — at that
moment the cut stage is empty.

Phase B therefore navigates to the **project**, and Cut becomes reachable when the shot produces
content. Whether the app then advances to Cut on its own depends on `resolveStudioEntryView`'s
precedence between the remembered last view and the first ready view; that is a verification item
below, not an assumption.

## What is deleted, and which review defects become moot

A max-effort review of the source branch reported fifteen findings, two of them must-fix spend
defects. The narrowed flow removes the code they lived in:

- **`runLaunch.ts` is not ported.** With no in-popup wait, there is no `awaitJobs`, no `awaitCut`, no
  `cancelActiveJobs`, and no abort watcher. That deletes the confirmed defect where
  `cancelActiveJobs` advanced the CAS revision by `revision += 1` while CAS-free job-status writes
  advanced the same counter — one interleaved progress write poisoned the loop and the remaining paid
  jobs kept billing. It also deletes the cut-abort gap, where `awaitCut` checked abort only inside a
  progress event and never cancelled the render.
- **`shotBudget`, `ABSOLUTE_SHOT_CEILING`, `UNKNOWN_WINDOW_BUDGET` and `submittedProjects` go.** The
  quote is the spend authority and the `quoteId` is the idempotency key. This retires the confirmed
  stale-`clipWindow` defect, whose whole consequence was falling back to a 12-shot allowance.
- **The film export and the ffmpeg dependency leave the happy path.** A single generated clip *is*
  the video: `StudioAssetV2` is a managed, playable file, and `create-export` turns out to be
  deliverable packaging (`film` / `still` / `script` / `editor_folder`) rather than video production.
  The source branch's own build report records the cut failing at the last step on a machine without
  ffmpeg — after the shots had been paid for. That failure mode is now unreachable.
- **Partial-failure handling and cascade go.** One shot either renders or it does not.

Spend safety that remains: a synchronous latch so a double click cannot reach `confirm-submission`
twice, backed by the `quoteId` being single-use at main.

Fixed while porting, because the files are being touched anyway:

- The five ported CSS modules are renamed to `ComponentName.module.css`; lowerCamelCase matches
  neither pattern allowed by `AGENTS.md`, and every pre-existing studio module complies.
- The three hardcoded colors in the ported `templateModal` and `coverArt` modules become
  `var(--studio-take-text)`, which the same branch already uses for the identical need.
- The duplicated modal chrome shared between `templateModal` and the new confirm panel uses
  `composes:`, as those files already do for typography.
- `../../../studioRouteConstraints` imports use the `@renderer/*` alias.
- `formatDurationClock` reconciles with the existing `formatRuntime`
  (`PhaseShell/StudioPhaseShell.tsx`), which handles hours and guards non-finite input.
- `projectArtFormat`'s bespoke polynomial hash uses its sibling `makeRng`'s FNV-1a instead of a
  second hash scheme.
- JSDoc on exported functions and components that lack it.

Deferred: the `_pending` register's advisory-only 90-day expiry, and the `i18nPending.js` /
`i18n-pending.js` naming collision. Both predate this work and neither blocks it.

`Layout.tsx` still needs its `id` and `relative` so Arco portals the template modal below the title
bar. That change makes the app layout a containing block for absolutely-positioned descendants across
the shell, so it needs a visual pass over the sidebar, dropdowns and popovers — the review flagged it
as plausible-but-unverified and that stands.

## The editorial work

This is the largest cost and it is writing, not code.

The 40 templates are authored for multi-clip videos: `durationsSeconds` runs `[150, 180, 210]`,
`[60, 90, 120]`, `[45, 60, 75]`, `[20, 25, 30]`. Their prose instructions assume multi-section
structure. A short single-shot catalogue is **different content, not a subset of this one** — every
template needs its duration and its instruction re-authored for one clip.

Template quality decides whether the feature is worth anything, so this is the work to protect. Code
can land against a handful of re-authored templates; the rest is editorial throughput.

## Testing

The source branch's 57 tests cover catalogue shape and pure arithmetic. Nothing covered
orchestration, which is why both spend defects passed its gate. The narrowed flow is small enough to
cover properly.

**Pure, no mocks.**

- the spine yields exactly one beat and one shot
- the shot's duration equals the chosen duration and sits inside the authoritative window
- `shootingScript` contains the composed context and ends with the template's instruction verbatim
- every template's durations fit within one clip of the window (the inverted invariant)
- minted ids are unique and match main's accepted format

**Phase A, fake bridge.**

- the five calls occur in order, and `baseChoices` holds exactly the minted shot id
- `expectedRevision` is threaded from each commit result into the next call, asserted explicitly —
  assuming it was the root of the revision defect
- a duration exceeding the authoritative window stops at step 2 with **no paid call attempted**
- a failure at each step stops on that step with no paid call attempted
- a `set-rules` failure is non-fatal and leaves a usable project, preserving the source's choice

**Phase B.**

- `confirm-submission` fires exactly once per launch, including across a remount
- a double click reaches it once
- an expired quote re-prepares instead of confirming a dead quote
- confirm failure leaves the project intact and navigable

**DOM.** The confirm panel renders the price range, currency, itemization, budget verdict and expiry.
The template modal's inputs produce the brief the spine expects.

### Repo-specific testing constraints

- **No timing assertions.** Concurrent work on this machine inflates test durations by one to two
  orders of magnitude, so timeout-sensitive assertions are load artifacts waiting to be filed as
  bugs. Nothing here needs a timer, which is one benefit of dropping the in-popup wait.
- **`tests/` is not typechecked.** `tsconfig.json` includes `packages/desktop/src/**/*` and a few
  configs only, so a fake bridge whose payloads drift from the real V2 types fails nowhere. Fakes are
  built from the actual exported types and constants, and payload assertions compare against values
  derived from those constants.
- **Arco disabled buttons.** Arco relocates `className` onto a wrapper `<span>` when a Button is
  disabled, so disabled-state assertions must not assume the class lands on the button.
- **i18n mocks.** A mock supplying only `{ t }` breaks anything reading `i18n.language`.

### i18n sequencing

A repo test requires every referenced key to exist in all 12 locales (`en-US` is the reference), so
each task ships its locale entries in the same commit; batching translations at the end would design
in a red window. Untranslated English is declared in each locale's `_pending.json` through the
register being ported. Model-facing text — the shooting script and the brief — stays an English
constant beside the code that sends it, per the audience rule in `AGENTS.md`.

The cross-slice contracts (`studioI18n`, `StudioAccessibleCopy`, `StudioPage`) belong to no single
slice, and some inventories store keys unprefixed so grep misses them. Adding an entry surface
touches those lists; they are updated in the same change rather than discovered at the gate.

## Verification items

Settle these before writing the corresponding code, not after.

1. **Renderer-minted ids.** `add_shot` and `add_beat` have the renderer supply the id. This repo has a
   recurring defect class where the renderer dictates an id and the backend mints its own — at least
   three occurrences, most recently on Director attach. Check main's accepted id format against its
   validator before writing the spine builder.
2. **Reaching Cut.** Read `resolveStudioEntryView`'s precedence between the remembered last view and
   the first ready view, and confirm what the person sees between confirm and the clip existing.
3. **`StudioRendererBudgetVerdictV2`.** Read its vocabulary before writing the confirm panel copy; it
   gates what the panel may claim.
4. **`set_routes`.** Confirm a single-shot deterministic path needs no route selection, which it
   should not, since no storyboard model is called.

## Out of scope

- CS4, and any accommodation for the cutover.
- The Director conversation and the proposal ledger. The popup neither binds nor accepts.
- Multi-clip videos, stitching, and the film export.
- Explore and quick suggestions.
- Reference images at create time. The source branch excluded this; the ordering problem it
  documented (a command needs `projectId` + `expectedRevision`, which exist only after creation) is
  unchanged on CS3.
