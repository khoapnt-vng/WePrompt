# S2 — Table view gets dedicated Length and State columns

Worktree `/Users/lap16603/Projects/WePrompt/.worktrees/s2`, branch `feat/studio-s2-table-columns`,
based on `324325e04`. Renderer-only. **One commit.** Never `git push` / `just push`. No AI signatures.

## Findings that change the brief

1. **State is not "only implied".** `ScriptRow.tsx:441-444` already renders an explicit readiness chip
   (`<span role='status' data-readiness={status}>`) inside the OUTPUT zone, with all seven
   `StudioSceneStatus` labels present and distinctly translated in all twelve locales
   (`scene.status.*`), enforced by `studioI18n.test.ts` ("words every scene readiness state
   distinctly"). So this slice **promotes an existing chip to its own column**; it does not create a
   state display, and it needs **no new status keys**.
2. **One status variant is genuinely uncovered — in CSS, not i18n.** `write.module.css:372-388` gives
   dot colours to `ready`, `generated`, `generating`, `needs_prompt`, `needs_selection`,
   `needs_attention`. **`needs_title` has no rule** and falls through to the neutral
   `--color-fill-4`, even though it is the same class of gap as `needs_prompt` (warning). Fix as part
   of "cover every variant".
3. **Two pre-existing e2e defects, same test step, both from `e637cf6b0`.** The e2e is only
   `--list`ed in this repo's gates (`--list` proves specs compile, never that locators resolve), so
   nothing caught either.
   - `creative-studio.e2e.ts:493` asserts
     `getByRole('status').filter({ hasText: 'Needs title' })`. Playwright `hasText` is a substring
     match and the shipped string is **"Needs a title"** — matches nothing.
   - `creative-studio.e2e.ts:477` asserts the header via
     `scriptTable.locator('div[aria-hidden="true"] > span')`. **No element in the script table has
     `aria-hidden`** — the header row is a plain `<div className={styles.tableHeader}>`. The only
     `aria-hidden` nodes are IconPark icon spans and the readiness dot span, none of which are a
     `div` with `span` children. Matches nothing.

   Correct both while the same block is being edited, and flag them as
   unverified-by-execution — nothing in this slice's gates runs a browser.
4. Brief path nit: the components are under
   `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/write/`, not
   `packages/desktop/src/renderer/components/PhaseShell/`.

## Column layout

Six columns, DOM order == visual order == compact stacking order:

| # | `data-script-zone` | Header key | Contents |
|---|---|---|---|
| 1 | `timing` | `phase.write.shotColumn` | drag handle, shot number, row actions (up/down/remove) |
| 2 | `script` | `phase.write.scriptColumn` | title, narration, More-details disclosure |
| 3 | `visual` | `phase.write.visualColumn` | visual prompt, Suggest a visual, reference slot |
| 4 | `output` | `phase.write.outputColumn` | media-kind Select, row error alert, conflict retry/discard |
| 5 | `length` | `phase.write.lengthColumn` | **moved** duration Select + its invalid-duration alert |
| 6 | `state`  | `phase.write.stateColumn`  | **moved** readiness chip |

**Why OUTPUT sits between VISUAL and LENGTH.** Media kind determines the duration bounds
(`durationBoundsByMediaKind`; `updateMediaKind` clamps `durationSeconds` into the new range), so the
two controls that interact belong side by side. It also keeps the design's `… length · state`
adjacency, with state last as the derived column.

**Nothing else moves.** The row error alert and conflict retry/discard stay in OUTPUT: they are
*save* state, and `WritePhase.dom.test.tsx:436` ("keeps row readiness without repeating the scene
save status") exists precisely to keep the two apart.

### Header row: name the columns, and hide the decoration

Each header `<span>` gets `data-script-column='<zone>'` carrying the **same six values** as
`data-script-zone`. The header-detaches-from-its-column failure then becomes directly assertable —
the list of `data-script-column` values must equal the list of `data-script-zone` values in every
row — instead of being inferred from positions. This is the same convention the rows already use
(`WritePhase.dom.test.tsx:416` selects zones by attribute, never by CSS-module class, because Vitest
stubs CSS modules).

The header `<div>` also gets `aria-hidden='true'`. It is a purely visual grid of six words with no
programmatic relationship to any cell — this is a div grid, not a `<table>`, so there is no
header/cell association to lose — and every control inside a row already carries its own accessible
name (`inspector.durationLabel`, `titleLabel`, `narrationLabel`, `visualPromptLabel`,
`mediaKindLabel`, plus `role="status"` on readiness). Marking it decorative stops a screen reader
reciting six unattached words ahead of the rows, and it is what the existing e2e locator in finding 3
already assumed was true.

### Grid tracks

`.tableHeader, .scriptRow`:

```css
grid-template-columns: 56px minmax(176px, 1.4fr) minmax(220px, 2fr) 120px 96px 140px;
min-width: 808px;   /* 56 + 176 + 220 + 120 + 96 + 140 */
```

`.scriptRowItem { min-width: 808px }` to match.

The two text columns become `minmax(min, fr)` rather than fixed. Reasoning:

- Six fixed tracks summing past 820px would put a scrollbar inside `.tableScroll` for the whole lower
  half of `drawer` mode. 808px of minima fits inside the 820px `compact` threshold
  (`useStudioLayoutMode.COMPACT_MAX_WIDTH`) minus the table's 1px borders, so the table stops
  scrolling exactly where it starts stacking.
- The current fixed 696px list also leaves dead gutter at `inline` width (>1120px); `fr` reclaims it
  for the two columns that want the room.

Degradation per mode (the hook measures the phase element, not the viewport):

- `inline` (> 1120px): all six tracks, script/visual absorb the slack 1.4 : 2.
- `drawer` (821–1120px): all six tracks at or near their minima; no horizontal scrolling.
- `compact` (≤ 820px): unchanged existing mechanism — `.tableHeader` hidden, grid collapses to
  `minmax(0, 1fr)`, `min-width` released to 0, per-zone `h4` `.compactZoneHeading` shown, and row
  actions / reference slot become permanently visible. The two new zones join that stack and get
  their own headings.

Any residual overflow is contained by `.tableScroll { overflow-x: auto }`; the page body never
scrolls sideways.

## New i18n keys (2 keys × 12 locales, same commit)

Append under `conversation.creativeStudio.phase.write`, immediately after `outputColumn`, so the diff
is a pure insertion and cannot collide with the parallel S1 branch.

| locale | `lengthColumn` | `stateColumn` |
|---|---|---|
| en-US | Length | State |
| de-DE | Dauer | Status |
| es-ES | Duración | Estado |
| fa-IR | مدت | وضعیت |
| ja-JP | 長さ | 状態 |
| ko-KR | 길이 | 상태 |
| pt-BR | Duração | Estado |
| ru-RU | Длительность | Статус |
| tr-TR | Süre | Durum |
| uk-UA | Тривалість | Статус |
| zh-CN | 时长 | 状态 |
| zh-TW | 時間 | 狀態 |

Each `lengthColumn` reuses the duration vocabulary that locale already ships in
`inspector.durationLabel` / `scene.duration`, so the header and the control's accessible name agree.
en-US uses the design's word "Length" against `scene.duration` = "Duration" — a deliberate,
en-US-only split. No locale value equals its en-US counterpart, so the copied-English cap
(`max(4, 5%)`) is untouched, and both are short labels, not full sentences.

## Files

1. `…/phases/write/ScriptTable.tsx` — two more header `<span>`s, in order; `data-script-column` on
   all six; `aria-hidden='true'` on the header row.
2. `…/phases/write/ScriptRow.tsx` — new `length` and `state` zones; duration control + its
   `srOnly` label + invalid-duration alert moved out of the timing zone **verbatim** (one write path,
   `updateDuration` → `onUpdate` → `flushIfTitleValid`); readiness chip moved out of the output zone
   verbatim, including the `draft.title` empty override that renders `phase.write.needsTitle`.
3. `…/phases/write/write.module.css` — six tracks + `min-width`; `.lengthZone { align-items:
   flex-start }` so the chip hugs its content the way it did in `.timingZone`; `needs_title` added to
   the warning dot group; `.readiness { align-items: flex-start }` + `.readinessDot
   { margin-block-start: 0.4em }` so the dot sits on the first line when a long label wraps in the
   140px track (de/ru/uk will wrap).
4. 12 × `renderer/services/i18n/locales/*/conversation.json`.
5. `renderer/services/i18n/i18n-keys.d.ts` — regenerated, never hand-edited.
6. `tests/unit/pages/studio/studioI18n.test.ts` — insert `phase.write.lengthColumn` and
   `phase.write.stateColumn` into `phaseKeys` after `phase.write.outputColumn`. **Add only. Do not
   reorder or reformat** — S1 edits the same array.
7. `tests/unit/pages/studio/studioStylesheetComposes.test.ts` — rewrite the grid assertion.
8. `tests/unit/pages/studio/Storyboard/WritePhase.dom.test.tsx` — update + extend.
9. `tests/e2e/features/workspaces/creative-studio.e2e.ts` — six header labels, located via
   `[data-script-column]`; fix the `Needs title` → `Needs a title` filter. Do not touch any other
   step in this file.

## Tests (write first)

`studioStylesheetComposes.test.ts` — replace "keeps the header and scene cells aligned to the fixed
696px table width" with a version that (a) reads the one rule shared by `.tableHeader` and
`.scriptRow`, (b) asserts it declares **six** tracks, and (c) asserts `min-width` equals the **sum of
the track minima** parsed out of the track list, so the declared width can never drift from the
tracks. Keep `.scriptRowItem`'s `min-width` equal to the same number.

`WritePhase.dom.test.tsx`:

- **header/body parity** — the six `[data-script-column]` values equal the six `[data-script-zone]`
  values of every row, in order, and the header spans render the six column keys in that same order.
  This is the jsdom-visible half of the "header detaches from its column" failure; the CSS half is
  the stylesheet test.
- update the existing zone-order assertion (line ~417) to the six-zone list.
- update the existing compact `h4` assertion (line ~451) to the six heading keys in order.
- **length column owns the duration control** — the combobox named
  `inspector.durationLabel` resolves inside `[data-script-zone="length"]`, and so does the
  `inspector.invalidDuration` alert for an out-of-range draft.
- **state column owns readiness** — the `role="status"` chip carrying `data-readiness` resolves
  inside `[data-script-zone="state"]`, and the OUTPUT zone no longer contains it.
- **every variant renders** — parametrised over all seven `StudioSceneStatus` values, assert the
  state cell renders that variant's own `scene.status.*` key (not blank, not a shared string). Guards
  the brief's "a status with no label renders blank" risk against future variants.
- keep every existing duration test green *unchanged* — they query by accessible name, so they prove
  the move preserved the single write path rather than duplicating it.

## Gates (all must pass before committing)

```
bunx tsc --noEmit
bun run test tests/unit/pages/studio
bun run i18n:types && node scripts/check-i18n.js
bun run lint --quiet && bun run format
bunx playwright test --list tests/e2e/features/workspaces/creative-studio.e2e.ts
```

`lint` emits ~1190 pre-existing warnings — judge by exit code. **Do not** run the full `bun run
test`, `bun run dev`, or any server; a sibling worktree owns the only Electron slot.

## Do not

- Rename `phases/write/` or the `phase.write.*` key group (S1 collision).
- Reorder or reformat the locale files or the `phaseKeys` array — add only.
- Touch the data model, IPC, `packages/desktop/src/process/`, or the MCP surface.
- Build a second duration write path or a second readiness derivation.
- Raw interactive HTML; Arco only. `type` over `interface`.
