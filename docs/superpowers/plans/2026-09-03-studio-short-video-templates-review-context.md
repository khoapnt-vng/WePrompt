# Review context: short video templates for CS3

**For:** a reviewer who knows the CS3 codebase.
**Reviewing:** [the spec](../specs/2026-09-03-entry-kit-cs3-integration-design.md) and
[the plan](2026-09-03-studio-short-video-templates.md).
**Date:** 2026-09-03

## What you are being asked to check

The spec and plan were written by someone who learned CS3 by reading it in a single session. The
product decisions came from the project owner and are settled. **What needs your eyes is my model of
CS3.** Every claim I make about your code is listed below with the file and line I read it from, so
you can falsify one in seconds rather than reconstructing my reasoning.

If a claim in §3 is wrong, the plan task that depends on it is wrong. That mapping is given
explicitly so you can jump straight to the damage.

## 1. Where this work comes from

The feature is a port. Its source is an "entry kit" built on a **CS2-era** studio, living in a
private monorepo mirror on a personal GitHub account:

- Repo: `github.com/legacyrohuy/Video` (private; `legacyrohuy` is admin, `minhtq1234` has write)
- Branch: `feat/creative-studio-entry-kit`, tip `491f397`, base `d748641`
- Layout: a monorepo with `aioncore/` and `WePrompt/` side by side, so every source path is prefixed
  `WePrompt/`

That repo runs **no CI** — its workflow files sit at `aioncore/.github/` and `WePrompt/.github/`, and
GitHub only reads `.github/workflows/` at the repository root. So the source branch's green gate was
local only. Its design notes are in `Brainstorm/` and are in Vietnamese.

To read source files:

```bash
git remote add entrykit https://github.com/legacyrohuy/Video.git
git fetch entrykit feat/creative-studio-entry-kit
git show "entrykit/feat/creative-studio-entry-kit:WePrompt/packages/desktop/src/renderer/pages/studio/components/EntryKit/types.ts"
```

Brace the ref. Unbraced, zsh parses `$REF:t...` as a history modifier and returns empty output with
no error — this cost real time during design.

## 2. What the feature is, and what it deliberately is not

**Is:** a gallery of templates for short videos. Pick one, fill a few inputs, authorize a price, one
clip is generated, watch it in the Cut view.

**Is not**, and please do not review for these:

- No Director conversation and no proposal ledger. The flow never calls `bind-director-conversation`,
  `list-proposals` or `accept-proposal`. Authoring is deterministic via `apply-authoring-batch`.
- No multi-clip video, no stitching, no film export, no ffmpeg on the happy path.
- No CS4. Deferred by the owner; the plan makes no accommodation for the cutover.
- No Explore gallery and no quick suggestions. Dropped from the source kit (~2,162 lines).

Three owner decisions drove that shape and are not open for review: rebuild the launch flow rather
than shipping the gallery alone; author deterministically; templates only, short, one shot.

## 3. Claims I make about CS3 — please falsify

Ordered by how much a wrong answer costs. All paths are on
`codex/creative-studio-table-board-ui-design`; `T` = `packages/desktop/src/common/types/project/creativeStudioTypes.ts`.

### High cost if wrong

| # | Claim | Read from | Breaks if wrong |
|---|---|---|---|
| 1 | `get-generation-capability` is an **admission** probe taking `items: [{target, purpose}]`. **Reviewer refinement:** the ordering is right but the reason is over-broad — the probe is invoked on every route/revision refresh, and on a brand-new project the item builder yields `[]`, which passes. | `T:2495`, `T:2461`, `T:2472` | Ordering stands. |
| 2 | Spend is quote-gated: `prepare-submission` → `{baseOnly, withCascade}`, and `confirm-submission` takes `{projectId, quoteId, expectedRevision}` — so **`quoteId` is a single-use authorization** and main rejects a replay. | `T:757`, `T:824`, `T:770` | Task 4. The entire spend guard is `confirmed.add(quoteId)`. If a quote can be confirmed twice, that guard is insufficient and needs main-side backing. |
| 3 | Main owns shot-duration validity and rejects `add_shot` with `invalid_shot_duration`. | `STUDIO_MUTATION_REASONS_V2`, `T:2514` | The spec's claim that a stale display window costs a failed free call rather than a wrong charge. If main does not validate, the renderer must, and the stale-window defect returns. |
| 4 | ~~`video_take` is a real `StudioJobPurpose`, so a shot generates video directly.~~ **CORRECTED:** the purpose exists, but a take cannot generate from nothing — refused twice as `missing_conditioning` (`estimate.ts:754`, `:815`). Base on `seed_still`; the derived cascade is the same shot's take (`estimate.ts:430`). | `T:42`, `estimate.ts:410/430/502/754/815`, `generationRequest.ts:165`, `projectStatus.ts:887` | Was the load-bearing error. Now fixed in the spec and Tasks 2-3, 5. |
| 5 | The renderer mints `beatId`/`shotId`, and main accepts `/^[A-Za-z0-9_-]{1,256}$/`, so `crypto.randomUUID()` is valid. | `T:1722`, `T:1733`, `jobManager.ts:50` | Task 2. This repo has had at least three defects where the renderer dictated an id and the backend minted its own; I believe this operation shape makes it legitimate here, but you would know. |

### Medium cost if wrong

| # | Claim | Read from | Breaks if wrong |
|---|---|---|---|
| 6 | `set_rules: 'operation_not_permitted'` in `STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2` is the **Director's** authority map, not the renderer's — the renderer has a dedicated `set-rules` IPC. | `T:1765`, `ipcBridge.ts:1355` | Task 3's rules step, and a product argument in the spec (a template pinning rules does something the AI categorically cannot). |
| 7 | Cut cannot be navigated to at confirm time — **conclusion holds, attribution was wrong**. The `replace: true` effect runs only on first entry with no remembered choice. The real gates are a disabled Cut tab and a not-ready pane in `components/Workspace/WorkspaceShell.tsx`. And nobody is *ever* advanced to Cut: `STUDIO_VIEWS` is `['references','table','board','cut']` scanned in fixed order, so Table always wins. | `T:28`, `studioPhaseRoute.ts:64-67`, `WorkspaceShell.tsx` | Task 10 now designs the hand-off explicitly instead of delegating to the router. |
| 8 | A single clip needs no export — **holds**. But the corollary "ffmpeg leaves the happy path" does **not**: no video take persists without a successful ffprobe duration probe, any failure becoming `invalid_media`. Accurate form: *no ffmpeg encode or mux is needed to watch one clip.* | `T:1151`, `T:1401`, `mediaStore.ts:4431` | Corrected in the spec. ffmpeg remains a hard prerequisite, and the failure lands after payment unless surfaced earlier. |
| 9 | An empty `cascadeChoices` asks main to **derive** a cascade rather than meaning "none". | `T:762-763` | Task 3 passes `[]` and confirms `baseOnly` regardless. If empty means something else, the quote we authorize may not be the one we think. |
| 10 | `applyAuthoringBatch` returns `{projectId, projectRevision, createdBeatIds, createdShotIds}`, and `StudioEditableBeat`/`StudioEditableShot` are `{title, story, targetSeconds}` / `{shootingScript, durationSeconds}`. | `T:1022`, `T:1599-1601` | Task 2's payloads. |

### Lower cost, but please confirm

| # | Claim | Read from |
|---|---|---|
| 11 | `StudioRendererBudgetVerdictV2` has exactly four kinds: `no_policy`, `within_cap`, `over_cap`, `currency_mismatch`. Task 5's panel handles all four. | `T:805` |
| 12 | The quote itemizes engine and price: `StudioRendererQuotedGenerationV2` carries `route`, `durationSeconds`, `oneGenerationMinorUnits`, `requestedTotalMinorUnits`. | `T:792` |
| 13 | `tests/` is not in `tsconfig.json`'s `include` — but "no test file is typechecked" **overreached**. 16 `*.test.ts` files live under `packages/desktop/src/**` and are in scope. Accurate: none of the 657 under `tests/` are typechecked; the 16 co-located ones are. | `tsconfig.json` |
| 14 | 12 locales, `en-US` reference, and a repo test requires every referenced key in all of them. | `i18n-config.json` |

## 4. Corrections already made — do not re-derive these

Four things I got wrong and fixed. Listed so you don't spend time rediscovering them.

1. **"Eight of thirteen bridge calls are missing from CS3."** Wrong. I grepped CS2-era names and read
   renames as removals. Only `proposeStoryboard` has no equivalent; `setBriefRules`→`set-rules`,
   `renderCut`→`create-export`, `renderProgress`→`get-film-export-status`,
   `cancelRender`→`cancel-film-export`, `submitScenes`→`prepare-submission`/`confirm-submission`.
2. **Capability probe ordering.** I first put it before the authoring batch, "corrected" it during a
   self-review on the false assumption that it returns a clip window, then corrected it back after
   reading `StudioGenerationCapabilityRequestV2`. It follows the batch. See claim 1.
3. **"Templates carry an authored section spine."** Wrong. `StudioTemplate` is
   `{id, category, artFormat, formats, aspectRatio, durationsSeconds, rules}`. The source's founding
   doc *proposed* spine seeding ("level C"); what shipped seeds rules plus a prose instruction. This
   is why the spine builder is trivial and why `shootingScript` is the composed brief.
4. **"Navigate to Cut on success."** Not possible at confirm time. See claim 7.

## 5. Open questions — all four now answered by review

Kept for the record; each is resolved in the spec and plan.

1. **`set_routes` required?** Yes, measured: a fresh project has both route ids null and
   `prepare-submission` returns `invalid_route` at step 5 (not a step-4 capability block). Both routes
   are set, since a seed still is image work.
2. **What happens between confirm and the clip?** The person stays on Table (or References). Nothing
   advances them to Cut, ever. Designed explicitly now.
3. **Quote expiry.** Enforced at four layers including the spend boundary. Two conventions exist;
   this feature copies the proposal-card pattern (proactive check, formatted timestamp, *Refresh*).
4. **`Layout.tsx` blast radius.** Zero sites would visibly move. Put `relative` on
   `ArcoLayout.Content` rather than `.app-shell` to keep the eight sider and titlebar sites out of
   scope entirely. Not verified by rendering.

## 5b. Original open questions (superseded)

1. **Does a fresh project need `set_routes` before `prepare-submission` will price it?** The plan has
   an explicit verification step (Task 3, step 4) rather than an assumption. My reading is that main
   resolves routes and answers `no_engine` via a capability block, but I could not prove it. If a
   route must be set, a fourth operation joins the spine batch.
2. **What does `resolveStudioEntryView` do between confirm and the clip existing?** It weighs a
   remembered last view against the first ready view. For a brand-new project with one queued job, I
   do not know what the person sees, or whether they are advanced to Cut automatically when the shot
   lands. This is the feature's payoff moment.
3. **Quote expiry policy.** `expiresAt` is displayed but not enforced; the plan defers a re-prepare.
   Is there an existing convention for expired quotes in CS3's own UI that this should match?
4. **`Layout.tsx` gaining `relative`.** Task 11 makes the app layout a containing block so Arco
   portals the modal below the title bar. 55 files under `pages/`/`components/` contain
   absolutely-positioned elements and jsdom cannot catch layout. You will know faster than I can
   measure whether this is safe.

## 6. What the source branch's own review found

A max-effort review of `feat/creative-studio-entry-kit` produced 15 findings, two of them confirmed
spend defects. **Both lived in code the plan does not port**, so they are retired by construction
rather than fixed — but you should know they existed, because the source is otherwise high quality and
it would be reasonable to wonder why `runLaunch.ts` is being thrown away.

- `cancelActiveJobs` advanced the CAS revision with `revision += 1` while CAS-free job-status writes
  advanced the same counter. One interleaved progress write went stale, `attempt()` swallowed the
  `stale_project` error, and every remaining paid job kept billing after the popup closed — the exact
  failure the function was written to prevent.
- `clipWindow` was fetched once on mount with `[]` deps and never refreshed. Because Settings is a
  modal, the library never remounts, so connecting an engine afterwards left the window null, dropping
  the spend guard to a 12-shot fallback against a valid bound of 3 — and telling the model no engine
  was connected.

Neither was caught by its 57 tests, because those covered catalogue shape and pure arithmetic and
nothing covered the orchestrator. That is why the plan front-loads tests on the four new modules, and
why Task 3 explicitly asserts the revision is threaded from each commit result rather than
incremented.

The other 13 findings were cleanup: CSS modules named in lowerCamelCase (which matches neither
pattern `AGENTS.md` allows), five hardcoded colors where a `--studio-take-text` token already existed,
~45 byte-identical duplicated CSS lines across three modal stylesheets, `t` in three `useMemo`
dependency arrays in a file that documents `t` as unstable, and a second bespoke hash beside
`makeRng`. The plan fixes these while porting the affected files, since it is touching them anyway.

## 7. Where I would spend your review time

1. **Claims 1–5.** A wrong answer there invalidates a task.
2. **Task 3 (`prepareLaunch.ts`).** The only place that sequences your protocol. Everything else is
   presentation or a single call.
3. **Open question 1 (`set_routes`).** The most likely thing to make the flow fail on first run.
4. **Task 11's blast radius.** The only change outside the studio.

Tasks 1 and 6–9 are ports with enumerated mechanical edits; skim them for convention slips rather
than logic.

## 8. Size

~410 lines of new source, ~790 of new tests, ~3,874 ported with small edits, ~2,162 of the source kit
dropped. Twelve tasks, 71 steps. Tasks 2–5 are independent of the ports and of each other.

Two costs sit outside the plan because they are not code: roughly 1,700 locale entries (~140 keys ×
12 locales), and re-authoring all 40 templates — `templateCopy.ts` carries six prose fields each, and
the instructions run ~200 lines written for multi-section videos. Template quality decides whether
this feature is worth anything.

If you want to de-risk before the catalogue rewrite: Tasks 1–5 plus a stub gallery prove the whole
quote-and-confirm path end to end with one hand-authored template.
