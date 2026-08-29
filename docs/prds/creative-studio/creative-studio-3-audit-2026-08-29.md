# Creative Studio 3 — audit of the 2026-08-29 fix sweep

Twelve commits landed between 07:38 and 10:39 on 2026-08-29 (`916e8e51c..701e28a7b`), closing a large
part of the UI backlog. This is what an audit of that range found, how to fix each item, and how to
launch the app on this machine to check any of it live.

**How the audit ran.** Five parallel lanes — the repo's own gate, the three UI commits, the three
behaviour commits, the doc claims, and the seven known hazard classes — then every finding was handed
to an independent agent instructed to _refute_ it. 25 findings were raised; **12 survived**, 13 were
refuted. Deduplicated (three lanes found the same critical defect independently), that is **8 distinct
defects**.

**What the sweep got right, first.** Tests grew **+415/−68** against source **+306/−238**, with three
new test files. No source file was deleted. The one new i18n key, `table.shotPosition`, is present in
all twelve locales, and the four now-dead reorder keys were correctly dropped from the contract list.
`lint`, `oxfmt --check`, `tsc --noEmit`, `check-i18n` and the i18n and IPC-parity contract tests all
pass. The problem is not sloppiness; it is one blind spot that the test design cannot see through.

---

## C1 · CRITICAL — the Beat preview lost its aspect ratio entirely

**Found independently by three lanes. This is a regression introduced by the commit meant to fix
framing.**

`9231b0545` changed `.beatPreview` from a literal `aspect-ratio: 16 / 9` to
`aspect-ratio: var(--studio-frame-aspect-ratio)`.

- The property is declared in **exactly one place**: `.root` and its five
  `.root[data-aspect-ratio='…']` mappings in
  `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/WorkspaceControls.module.css:6-28`,
  stamped at `WorkspaceControls.tsx:489-494`.
- **BeatPanel is not a DOM descendant of that div.** `BeatPanel/index.tsx:1502` renders an Arco
  `<Modal className={styles.modal} …>` with **no `getPopupContainer`**, and Arco defaults it to
  `() => document.body`, rendering the subtree through a `Portal`. React portals preserve the _React_
  tree; CSS custom-property inheritance is **DOM**-based.
- So `var(--studio-frame-aspect-ratio)` resolves to nothing, there is no fallback, the declaration is
  invalid at computed-value time, and `aspect-ratio` (non-inherited, initial `auto`) collapses to
  `auto`.

**Why it is a regression rather than an incomplete fix.** A 16:9 project's Beat preview was correctly
shaped before and is now unconstrained; portrait and square projects gain nothing. `.beatPreview` is
`display: grid` with only an implicit auto row, so the `<video className={styles.previewMedia}>` child
at `block-size: 100%` resolves against an indefinite height and the box takes the asset's intrinsic
height — e.g. 1376px for a 9:16 take — inside a modal capped at `max-block-size: min(78vh, 920px)`
with `overflow: auto`.

**Note the doc claim this contradicts.** BUG-138's closing note asserts _"A base `.root` value keeps
`var()` from ever resolving empty and silently collapsing a box to `aspect-ratio: auto`."_ That base
value sits on the one div the portal escapes, so it cannot prevent precisely the collapse it names.

**Why no test caught it, and why that matters more than the bug.** Every BeatPanel and SpendGate DOM
suite replaces Arco's `Modal` with an inline `<div>` (e.g.
`tests/unit/pages/studio/workspace/BeatPanel.dom.test.tsx:141-153`), which puts the subtree back
inside the controls div and makes the property reachable. And the new guard,
`tests/unit/pages/studio/studioImageFraming.test.ts`, is a **source-text sweep of `*.module.css`
files** — it accepts any `aspect-ratio: var(…)` as correct without checking the variable is reachable.
The mock hides the defect and the guard cannot see it.

**Scope: one live box, not two.** `BeatPanel.module.css` has two users of the property —
`.mediaPreview` at line 344 and `.beatPreview` at line 533 — but `.mediaPreview` has **zero `.tsx`
references** and is dead CSS. Only `.beatPreview` is broken in the running app. Delete `.mediaPreview`
rather than fixing it; it was counted as one of the "seven converted boxes" in the commit's own tally,
so that number is one higher than the live surfaces it changed.

### Fix

Two options; do **both**, because they fail differently.

1. **Make the property reachable inside the portal.** Stamp `data-aspect-ratio={project.aspectRatio}`
   on the Modal's own `<section className={styles.root}>` (`BeatPanel/index.tsx:1512`) and add the
   same six declarations to `BeatPanel.module.css`. References already does exactly this with its own
   `--studio-reference-aspect-ratio` on its own root — the pattern is established.
2. **Give every `var()` use an explicit fallback**: `aspect-ratio: var(--studio-frame-aspect-ratio, 16 / 9)`.
   This bounds the blast radius of any future portal, and turns a silent collapse into a wrong-but-shaped
   box.

Option 2 alone would leave portrait projects wrong-but-shaped rather than correct, so it is a
safety net, not the fix. Option 1 alone leaves the next portaled surface to rediscover this.

### Test that would actually catch it

The existing guard cannot; it reads CSS text. Add a DOM test that renders BeatPanel with the **real,
unmocked** Arco `Modal`, then asserts the resolved value:

```ts
// must NOT mock @arco-design/web-react's Modal
const el = document.querySelector('[data-beat-preview]') as HTMLElement;
expect(getComputedStyle(el).aspectRatio).not.toBe('auto');
```

jsdom does not do layout, but it _does_ resolve custom properties through the DOM tree, which is
exactly the mechanism that breaks here. If that proves unreliable, assert the cheaper invariant: the
element carrying `aspect-ratio: var(--studio-frame-aspect-ratio)` has an ancestor declaring it.

### Verify live

Open a Beat on a **9:16 or 1:1** project (see _Launching_ below) and compare the preview box against
the Board tile for the same Shot. Before the fix the Beat preview will be tall and scrolling; after,
both agree.

---

## M1 · MAJOR — the Table's new indent leaves 2px for the Shot number

`6e33b66e9` added:

```css
.shotRow .shotCell[data-grid-column='0'] {
  padding-inline-start: 32px;
}
```

The position column is hard-pinned: `Table/index.tsx:30-35` sets `fixedInlineSize: 46`,
`index.tsx:615-628` emits `<col style={{ inlineSize: '46px' }}>`, and `Table.module.css:60` sets
`table-layout: fixed`, so it cannot grow — the flexible `story` column absorbs all slack. Shot cells
carry `.cell` too, which sets `box-sizing: border-box; padding-inline: 12px`.

**46 − 32 − 12 = 2px of content box**, for a string that is no longer `01` but `t('…table.shotPosition')`
→ `"1.1"`, at 10px mono ≈ 18px wide. `.cell` also sets `overflow-wrap: anywhere`, so it breaks per
character into a three-line `1 / . / 1` stack, each glyph still overflowing.

The commit's stated goal was to _make the two levels legible_. The added test asserts the CSS text
only, so it passes.

### Fix

Widen the position column for the indent it now carries — `fixedInlineSize: 46` → about **`78`**
(32 indent + 12 + ~18 glyph + 12 end padding + slack), updating the `<col>` width with it. Or move the
indent onto an inner wrapper so it does not eat the fixed column's content box. Prefer the first: the
indent is the point of the change, and the column was sized for a two-character number that no longer
exists.

### Verify live

Table view, expand any Beat, look at the `#` column on a Shot row: the number must read `1.1` on one
line.

---

## M2 · MAJOR — the backlog's P2/P3 split is wrong

`creative-studio-3-consolidated-backlog.md:6` states `2 P1, 6 P2, 6 P3`. The real open split is
**2 P1, 7 P2, 5 P3**.

The totals (118 filed / 104 closed / 14 open) _are_ correct, as is the "12 of 14 carry a landed fix"
claim. Only the tier split is wrong — and it is the number that drives what gets scheduled next.

**Fix:** recount and correct the line. The file's own header promises counts are read from the bug
list rather than tallied by hand, so the recount should be scripted, not eyeballed.

---

## M3 · MAJOR — the backlog presents six closed bugs as open work

Section 2 lists 18 ids, matching the superseded 18-open figure rather than the current 14. Six are
`- [x]` closed in the bug list: **BUG-141, BUG-142, BUG-160, BUG-161, BUG-164, BUG-167**. Meanwhile
the one genuinely open P2 that no cluster covers is missing entirely.

This is the exact failure the file was created to prevent: it is the single view someone plans from,
so six closed items would be re-picked up and one real one would stay invisible.

**Fix:** regenerate section 2 from the bug list rather than editing it by hand.

---

## m1 · MINOR — dead symbols left by the move-control removal

`oxlint` reports four warnings introduced by `6e33b66e9` in `Views/Table/index.tsx`: `ArrowDown`,
`ArrowUp` and `Drag` imported at line 7 and never used, and `reorderingBeatId` declared at line 313
and never read. `no-unused-vars` is `warn` in `.oxlintrc.json`, so the gate stays green.

The substance of BUG-174 is sound — no move controls remain, and the keyboard route survives at
`index.tsx:470-476` (Alt+ArrowUp/ArrowDown/Home/End on the position cell).

**But one thing was lost with it.** `reorderLocked` used to disable all three buttons while a reorder
was in flight; that was the only visible in-flight signal. It is now `reorderPendingRef`, a ref, so it
causes no render and silently swallows a second keypress with no feedback.

**Fix:** delete the three imports and the dead state; then either restore a visible pending signal on
the keyboard route or accept the silence deliberately and note it.

---

## m2 · MINOR — focus after a reorder targets a stale index

`index.tsx:548` does `cellRefs.current[destination]?.position?.focus(…)` in a `finally`, immediately
after `await authoringActions.reorderBeats(nextOrder)` — an IPC round trip. `cellRefs` is indexed by
_rendered_ row (`index.tsx:802-805`). If the re-render has not flushed, focus lands on the other
Beat's cell and then travels with it to the wrong row.

**Fix:** focus by Beat id after the projection updates (a `useEffect` keyed on the new order), not by
positional index inside `finally`.

---

## m3 · MINOR — Board and Beat panel can orphan a poster

Both surfaces gate on `currentPicture.posterAssetId === null` read from the _renderer_ projection, and
neither write carries an `expectedRevision`. Open the Board (capture starts), click into the Shot
while it is in flight (the Beat panel renders a `<video>` precisely because the poster is still null,
and captures too) — two writes, one wins, the loser's asset is referenced by nothing.

Silent, unbounded disk growth on a very common interaction, with an asset no UI can show or remove.

**Fix:** carry `expectedRevision` on the poster write so the loser is rejected by the CAS guard, or
single-flight capture per Shot id in main.

---

## m4 · MINOR — three locales flip from formal to informal address

`bfb9ce418` reworded the turn-close strings. In **de-DE**, `completed` now reads _"Sag mir, was du als
Nächstes möchtest"_ (du-form) while its untouched siblings in the same `close` object stay formal —
`failed.v1` _"Die Details finden Sie unten"_. Same flip in **tr-TR** and **fa-IR**.

So the assistant addresses a German or Turkish user informally when the turn succeeds and formally
when it fails, in consecutive messages in one conversation.

**Fix:** restore formal address in the three reworded strings to match their siblings. The commit
already flags the eleven translations as needing a native pass; this is the specific defect to fix
in it.

---

## Launching Creative Studio on this machine

Studio is behind a flag, the dev database is encrypted, and there are only two Electron slots. All
three bite. This exact line works:

```bash
cd /Users/lap16603/Projects/WePrompt/.worktrees/cs2-table-board-ui-design
AC=/Applications/WePrompt.app/Contents/Resources/bundled-aioncore/darwin-arm64
env PATH="$AC:$PATH" AIONUI_MULTI_INSTANCE=1 AIONUI_ENABLE_CREATIVE_STUDIO=1 just dev
```

**Why each part is load-bearing** — each was learned by getting it wrong on 2026-08-28:

| Part                                | Without it                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AIONUI_ENABLE_CREATIVE_STUDIO=1`   | The app boots but the Studio route does not exist. The Library renders nothing and it looks like a data failure.                                                                                                                                                                          |
| `AIONUI_MULTI_INSTANCE=1`           | Uses slot 1 (`~/.aionui-dev`), whose DB is at a migration the available aioncore cannot open. Slot 2 (`~/.aionui-dev-2`) holds the six test projects, including `Plateau`.                                                                                                                |
| `PATH` prepend to aioncore ≥ 0.1.55 | The dev DB is **encrypted** (there is a 32-byte `.aionui-enc-key` beside it). PATH `aioncore` is 0.1.44 and the repo's bundled 0.1.53 also fails — both with `BOOTSTRAP_DATA_INIT_FAILED stage=database.open … (code: 26) file is not a database`. That reads like corruption and is not. |

**Do not "fix" the database.** `file is not a database` here means _encrypted_, not _corrupt_. Moving
or resetting it destroys the test corpus.

**Success signals** in the log — wait for all three:

```
[aioncore] AIONCORE_LISTENING {"host":"127.0.0.1","port":…}
[CDP] Remote debugging server ready at http://127.0.0.1:9230
[AionUi] Renderer did-finish-load
```

If the window shows _"Local backend could not start"_ after aioncore reports listening, the renderer
rendered before the backend came up and does not retry: reload the window rather than restarting.

**Other prerequisites.** `ffmpeg` must be on `PATH` for film export (Homebrew is fine — the product
does not ship one; that is BUG-144). Media generation needs the bindings under **Settings → Model →
Creative Studio media models**; `FORGE_*` env keys are a different subsystem and do _not_ gate Studio.

### Driving it for verification

CDP is on `127.0.0.1:9230`. Two traps that cost hours:

- **Content lives in shadow roots.** `document.body.innerText` misses it — walk `shadowRoot`
  recursively or you will conclude a rendered element is absent.
- **A route change lands after the `Runtime.evaluate` that triggered it returns.** Read
  `location.hash` in a _later_ call, or you will wrongly conclude a click did nothing.

Test projects in slot 2, with the ratios that matter for **C1**:

| Project    | Id prefix  | Useful for                                                  |
| ---------- | ---------- | ----------------------------------------------------------- |
| `Plateau`  | `748ae58b` | 36 Shots, 30 with video, 6 Beats — Table, Board, Beat panel |
| others (5) | —          | check `project.aspectRatio` for a non-16:9 one to test C1   |

**C1 cannot be judged on a 16:9 project**: `auto` and `16 / 9` look similar when the asset is itself
16:9. Use a portrait or square project, or temporarily set one, and compare the Beat preview against
the Board tile for the same Shot.
