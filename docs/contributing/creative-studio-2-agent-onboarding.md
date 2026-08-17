# Creative Studio 2 — onboarding for Codex

Read this before your first task. It is written from what has actually cost time on this codebase,
not from the architecture diagram.

You have no skill system here. `AGENTS.md` points at `.claude/skills/*/SKILL.md` — **read those files
directly as ordinary Markdown** when they apply (`architecture`, `i18n`, `testing`).

---

## 1. What the product is

WePrompt is a thin Electron fork of AionUi (~98.6% upstream). **Creative Studio** is its own surface:
you describe a video, an agent proposes a shot list, you edit it, generate takes from image and video
providers, assemble a cut, and export.

**Creative Studio 2** is a redesign in flight. Two ideas carry it:

- **The Brief is a CLAUDE.md, not a form.** Prose is context; _pinned rules_ are predicates checked
  against every visual prompt **before money is spent**. This shipped in phase 1.
- **Phases became views.** The old Brief → Write → Produce → Review rail was a lie: Brief is an
  object, Produce is a threshold (money), Review is a view mode. It is now a switch —
  **Table · Board · Cut** — with Brief as a header drawer. This shipped as slice S1.

Target work: 1–5 minute videos, game trailers and feature walkthroughs for VNG Games. Not 5-second
social clips.

## 2. Where things stand

|                                                           | state                                        |
| --------------------------------------------------------- | -------------------------------------------- |
| Phase 1 — brief with enforced rules                       | **shipped**, on `ghk/feat/creative-studio-2` |
| S1 — the view switch                                      | **shipped**, merged `42d66772f`, pushed      |
| S2 — Table's Length/State columns                         | in flight, worktree `.worktrees/s2`          |
| C5/C6 — money control to the top bar, state readout       | in flight, worktree `.worktrees/cs2`         |
| Phase 2 — section → clip → take model, Table/Board proper | not started                                  |

Baseline to hold: **641 test files / 8,610 tests passed, 19 skipped.**

**Read these, in the repo:** `docs/design/creative-studio-2-walking-skeleton.md` (why navigation came
first, and what is deliberately out of scope), `creative-studio-2-s1-plan.md` (what landed and what
each commit decided), `creative-studio-2-programme-plan.md` (the phase sequence and its corrections).

## 3. Non-negotiables

- **Never `git push` or `just push`.** Commit locally. Pushing is the user's decision, every time.
- **NEVER add AI signatures.** No `Co-Authored-By`, no "Generated with". This is checked by eye and
  it is a hard rule.
- **Never weaken the spend fence.** There is exactly **one** spend — `studioJobs.submitScenes`
  against a provider. Rendering the cut is _not_ money: it shells out to a local `ffmpeg`. Any change
  that widens what can spend, or removes a confirm, needs to be raised, not made.
- **Arco components only** (`@arco-design/web-react`) — no raw `<button>`, `<input>`, `<select>`.
  Icons from `@icon-park/react`.
- **All user-facing text through i18n keys, all twelve locales in the same commit.**
- Main process (`src/process/`) must not use DOM APIs; renderer (`src/renderer/`) must not use Node
  APIs; shared code lives in `src/common/`. Cross-process traffic goes through the IPC bridge.
- Conventional Commit subjects. `type` over `interface`. Path aliases `@/`, `@process/`, `@renderer/`.

## 4. The traps — this is the section that matters

Each of these has already cost real time here.

**"Renderer-only" is a claim to verify, not a scope you can assume.** `STUDIO_ROUTE_PATTERN` in
`packages/desktop/src/process/bridge/creativeStudioBridge.ts` hardcoded the four view names and gates
the **unsaved-scene-drafts dialog on window close and quit**. Renaming routes without it would have
discarded users' work _with the whole suite still green_, because the bridge test defaulted its URL
to a name that matched the old regex. `STUDIO_VIEWS` is now one shared constant in
`common/types/project/creativeStudioTypes.ts` that the renderer, that regex and the e2e spec all
derive from. **Never reintroduce a second literal list.** Before believing any boundary claim, grep
`src/process/` for the names involved.

**A test that cannot fail is worse than one that fails.** After any removal, ask of every touched
assertion: _could this still fail?_ Asserting the absence of a thing that no longer exists anywhere
is the signature. Five such tests were found in one commit here. Delete or re-point them — and prove
your own new guards fail, by temporarily reverting the fix and watching them go red. That standard
has caught real gaps in this repo.

**The i18n contract is stricter than the script.** `scripts/check-i18n.js` only _warns_ on missing
keys. The hard gate is a test — `tests/unit/pages/studio/studioI18n.test.ts` — which asserts exact
parity across twelve locales, non-empty values, matching placeholders, **zero** copied new
full-sentence keys, and at most `max(4, 5%)` copied English. It also holds exact key-list arrays, an
exact `plannedGroups` set, and a contract that each view's focused heading is worded exactly as its
switch label. Extend all of them in the same commit. Any new countable key must be registered in
`pluralLogicalKeys`, or Slavic locales fail on missing plural categories.

**Line numbers drift within the hour.** Several sessions commit to this branch. Cite **symbols**, and
re-read a file before editing it — three citations went stale in under an hour when a sibling merged.

**jsdom does no layout and mocks CSS modules.** The only instrument that can see a CSS fact is a
stylesheet-parsing test (`tests/unit/pages/studio/studioStylesheetComposes.test.ts` is the pattern).
Strip comments before parsing — the prose in these stylesheets names the very declarations under
test. **No test in this repo detects dead CSS**, so deleting a component means deleting its classes
by hand.

**Arco specifics that have bitten.** `Trigger` (so Tooltip, Popover, Popconfirm, Dropdown) wraps a
**disabled child in a `<span>` and copies your className onto it** — `Button` itself does not, so the
trap only fires when something Trigger-based wraps a disabled control. And
`.arco-btn-text:not(.arco-btn-disabled)` outranks a bare CSS-module class, so a background on a text
Button silently does nothing; compound Arco selectors like `.arco-btn-text.arco-btn-disabled` can
_tie_ your rule, leaving injection order to decide.

**Dead code that looks alive.** `GenerationControls` is rendered only by its own 393-line test.
`Storyboard/` holds more of the same. Take helpers from them; do not revive them.

**The Studio e2e spec cannot currently reach its assertions** — several accessible names it clicks
match no string in the app, and it is conditionally skipped, so it has never gated anything. Treat
`bunx playwright test --list` as a compile check only. Do not conclude you broke it.

**`readySceneIds.length` counts down.** It means "ready _to generate_" and goes to zero as shots are
generated. The "done" number is `selectedAssetCount`. Using the obvious one gives a readout that runs
backwards.

**Run the whole suite at a slice merge, not just your directory.** Repo-wide invariant tests — the
kind asserting two files agree — live outside your slice and are exactly what a focused run misses.
A parity test once sat red on the integration branch for four slices because nobody ran it.

## 5. How to work

Gates, before every commit:

```
bunx tsc --noEmit
bun run test <the directories you touched>
bun run i18n:types && node scripts/check-i18n.js
bun run lint --quiet && bun run format
```

`lint` reports **~1,190 pre-existing warnings**. Those are not failures — judge by exit code and the
error count. Run the full `bun run test` only when asked; it takes ~4 minutes and concurrent runs on
this machine inflate each other 15–150×, so **counts are the signal, duration is not**.

Work test-first where behaviour is testable. One coherent commit per task; a partial commit leaves
the app broken. Do not run `bun run dev` or start servers — the sandbox cannot bind sockets, and a
dev instance may already own the single Electron slot.

## 6. When the brief is wrong, say so

Briefs in this project have been corrected by their implementers **six times**, and every correction
was worth more than the work it interrupted. Among them: that a template drawer "already solved"
dialog accessibility when it had no `role="dialog"` at all; that a named test was vacuous when it was
still load-bearing for one more commit; that a warned-about parity failure could not happen because
the keys were never in that list; and that Arco wraps disabled buttons when it is Trigger that does.

Verify the claims in your brief against the code. If one is wrong, **state it plainly in your report
rather than working around it.** Being told the premise was wrong is more useful than a workaround
that silently encodes it.

Your report should carry: the commit SHA, what you touched grouped by area, **every test you deleted
and why**, how you made any new guard falsifiable, and anything you could not finish.
