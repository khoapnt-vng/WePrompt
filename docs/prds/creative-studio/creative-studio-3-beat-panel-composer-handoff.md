# Handoff: Beat panel — shot composer

## Overview

The beat panel is where a director works a single beat of a story: watch the beat, then build
its shots one at a time. Each shot is one card that holds its frame inputs, its prompt, and its
generate action. The whole beat can also be generated in one pass, chained, from the shot strip
at the bottom of the panel.

This handoff covers two things:

1. **Beat Panel Composer** — the panel, in its normal working state, with the full-screen frame viewer.
2. **Shot Composer States** — the same shot card in all eight states it can be in.

## About the design files

The HTML files in this bundle are **design references created in HTML** — prototypes showing the
intended look and behaviour. They are not production code to copy. Recreate them in WePrompt's
existing environment using its established components and patterns. If a value here conflicts
with an existing WePrompt component, prefer the component and tell design.

Both files open offline in a browser, no server needed.

## Fidelity

**High fidelity.** Colours, type, spacing, radii and copy are final unless design says otherwise.
Recreate the UI to match; the values below are exact.

---

## Screen 1 — Beat panel

File: `Beat Panel Composer (standalone).html`

Panel card: 1320px wide, white `#FFFFFF`, 1px border `#E4D9C6`, radius 14px,
shadow `0 30px 60px -30px rgba(20,24,31,0.35)`.

### Title bar

Row, 12px/18px padding, bottom border `#EFE7D8`. Left: beat name, 13.5px/700.
Right: `✕` close, mono 11px, `#8C7F6C`.

### Body — two columns, 16px gap, padding 16px 18px 12px

**Left column, 376px fixed:**

- Beat player. 212px tall, radius 11px, 1px `#E4D9C6`, image cover on `#14181F`.
- Control row: `Play beat` (11.5px/700, white on `#C9431A`, radius 8, padding 7/12,
  hover `#B03A14`), time `0:00 / 0:11` (mono 11px `#2A303B`), `PICTURE ONLY`
  (mono 8.5px, tracking 0.09em, `#8C7F6C`).
- Shortcut line: mono 8.5px `#8C7F6C` — `SPACE PLAY · ARROWS SEEK`.

**Right column, flexible — the shot card:**
Background `#FBF7F0`, 1px `#E4D9C6`, 3px left border `#C9431A` (the ON shot),
radius 12px, padding 13px 16px, column, 11px gap. Rows, in order:

1. **Identity row** (11px gap, centred): `ON` tag (mono 8px, tracking 0.09em, `#FFF6EF`
   on `#C9431A`, radius 5, padding 3/6) · shot name 13.5px/700, `white-space:nowrap;flex:none`
   · chain line (mono 8.5px `#8C7F6C`, `flex:1;min-width:0` — it absorbs the shrink):
   `HEAD OF THE CHAIN · NOTHING RUNS BEFORE IT` · status word (mono 8.5px, tint by state,
   nowrap) · `⋯` (mono 12px `#8C7F6C`).
2. **Frames row**: `padding-top:11px`, top border `#EFE7D8` (the row owns the offset — no
   per-child margins). Left: `FRAMES · 2 SET` (mono 8.5px `#8C7F6C`).
   Right: `Import` (11px/700 `#6E6553`, 1px `#CBD0D8`, radius 7, padding 4/9, hover `#F1EADC`).
3. **Slots**: `grid-template-columns:repeat(3,1fr)`, 8px gap, each 66px tall, radius 9px.
   - Filled: image cover on `#14181F`; start frame gets a 2px `#C9431A` border, others 1px `#E4D9C6`.
   - Empty: `#F1EADC` fill, 1px `#E4D9C6`, centred `▣` glyph 12px + label mono 7.5px nowrap;
     hover `#F6F1E7`, border `#C9431A`, text `#B4380F`.
   - Badge, bottom-left 5px: mono 7.5px, tracking 0.09em, nowrap, `#FFF6EF`, radius 4, padding 2/5.
     Start frame badge on `#C9431A`; other filled slots on `rgba(20,24,31,0.72)`.
     Labels: `START`, `END`, `REFS 2`.
4. **Prompt**: full-width textarea, 2 rows, no resize, Source Sans 3 12.5px/1.5 `#2A303B`,
   white, 1px `#E4D9C6`, radius 9, padding 8/10, focus border `#C9431A`.
   Placeholder: `Describe this shot, or reference a frame with @…`
5. **Action row**: `EDITED · NOT YET RUN` tag (hidden unless the prompt changed after a run) ·
   spacer · `Generate Shot 1` (11.5px/700, white on `#C9431A`, radius 8, padding 6/12).
   While running the label becomes `Cancel run` and the button goes `#8C2B0B` on `#FDF0E9`
   with a `#F0C6B0` border.

### Shot strip (bottom of the panel)

Card `#FBF7F0`, 1px `#E4D9C6`, radius 12, margin 0 18 18, padding 12/14, 9px gap.

- **Header row**: `Shots in this beat` (12.5px/700, nowrap) · rule line (mono 8.5px `#8C7F6C`):
  `EACH SHOT STARTS ON THE LAST FRAME OF THE ONE BEFORE` · spacer ·
  **`Generate all 3 · chained`** (11.5px/700, white on `#C9431A`, radius 8, padding 6/12).
  While the chain runs: button reads `Stop the chain` (`#8C2B0B` on `#FDF0E9`, border `#F0C6B0`)
  and the rule line becomes `RUNNING IN ORDER · EACH SHOT STARTS ON THE LAST FRAME BEFORE IT`.
- **Shot chips**: equal-width cards, 4px gap. Active chip has a 3px `#C9431A` left border,
  `#FDF0E9` fill, `#F0C6B0` border on the other three sides, name 11.5px/700 `#8C2B0B`,
  `ON` tag, status mono 8.5px. Inactive chips: 1px `#E4D9C6`, radius 7. Between chips sits a
  22px `✕` cell (mono 10px `#8C7F6C`, 1px `#E4D9C6`, radius 6) — remove the join between shots.
- **Timeline**: 5px bar `#EFE7D8`, radius 3, with an 11px playhead dot (white, 2px `#C9431A`).
- **Plan row**: three equal cells, radius 7, padding 7, mono 9px, centred. Active `#F7D9CC`/`#8C2B0B`,
  others `#F1EADC`/`#6E6553`.

### Full-screen frame viewer

Opens from a filled slot, from `⛶` on a slot hover, or from `⛶ FULL SCREEN VIEW`.
Fixed overlay, `rgba(12,14,18,0.94)`, column layout.

- **Top bar**: frame name (mono 9px `#B9AF9E`) · `CURRENT START FRAME` badge (mono 8px,
  `#FFF6EF` on `#C9431A`, shown only when this frame is the pinned start frame) · spacer ·
  counter `1 / 3` (mono 9px `#8C8375`) · `✕` (32px, radius 9, hover `rgba(255,255,255,0.12)`).
- **Stage**: `contain` on black, radius 12, max-height `calc(100vh - 250px)`, flanked by
  44px round `‹` / `›` buttons (`rgba(255,255,255,0.09)`, hover `0.2`).
  While regenerating: opacity 0.45, `saturate(0.4)`, 200ms.
- **Prompt block**, max 760px: label `PROMPT FOR THIS FRAME` · `EDITED · NOT YET RUN` tag ·
  run note. Textarea 2 rows on `rgba(255,255,255,0.07)`, 1px `rgba(255,255,255,0.18)`, radius 10,
  text `#F1EADC`, focus border `#C9431A`. Beside it: `Regenerate frame` (white on `#C9431A`;
  while running `Regenerating…`, muted) and `Cancel run` below it while running.
- **Action row**: `Pin as start frame` → `Pinned as start frame` (lit: `#F5C6B2` on
  `rgba(201,67,26,0.22)`, border `rgba(240,198,176,0.5)`) · `Download` · `Remove` (`#E9A98F`).
- **Filmstrip**: 84×48 thumbs, radius 7; current one 2px `#C9431A` and full opacity, others
  1px `rgba(255,255,255,0.18)` at 0.55.
- **Shortcut line**: `← → FRAMES · P PIN · R REGENERATE · ESC CLOSE`.

---

## Screen 2 — Shot composer states

File: `Shot Composer States (standalone).html`

Eight cards, identical row structure, `repeat(auto-fill,minmax(430px,1fr))`, 18px gap.
The shape never changes between states — only the status word, the slots, the tag beside the
button, the button itself, and an optional mono footnote.

| #   | State              | Status word (tint)          | Slots              | Button                                                           | Footnote                                                                                                |
| --- | ------------------ | --------------------------- | ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 01  | Not ready          | `NOT READY` `#8A6A18`       | all empty          | `Generate Shot 1`, inert (`#A79C89` on `#F1EADC`, `not-allowed`) | `A START FRAME IS REQUIRED BEFORE THE SHOT CAN RUN`                                                     |
| 02  | Ready to render    | `READY TO RENDER` `#6E6553` | start only         | `Generate Shot 1`, filled                                        | —                                                                                                       |
| 03  | All three filled   | `READY TO RENDER` `#6E6553` | start + end + refs | `Generate Shot 2`, filled                                        | `END FRAME SET · THE SHOT HAS TO LAND ON THAT PICTURE`                                                  |
| 04  | Rendering          | `RENDERING · 40%` `#2A5FA8` | start only         | `Cancel run`                                                     | `RUNNING WITH THE PROMPT AS FIRED · EDITS APPLY NEXT RUN`                                               |
| 05  | Rendered           | `RENDERED` `#2E7D5B`        | start only         | `Regenerate`, outlined                                           | `ITS LAST FRAME IS NOW SHOT 2’S START FRAME`                                                            |
| 06  | Edited after a run | `RENDERED` `#2E7D5B`        | start only         | `Regenerate`, filled                                             | tag `EDITED · NOT YET RUN`                                                                              |
| 07  | Queued in a chain  | `QUEUED` `#2A5FA8`          | all empty          | `Remove from chain`, outlined                                    | `START FRAME ARRIVES WHEN SHOT 1 FINISHES`                                                              |
| 08  | Failed             | `FAILED` `#8C2B0B`          | start only         | `Try again`, filled                                              | tag `NOTHING WAS CHARGED`, footnote `THE ENGINE RETURNED NOTHING · THE CHAIN STOPPED HERE` in `#8C2B0B` |

Rules across the set:

- **Six status words only**: not ready, ready to render, queued, rendering, rendered, failed.
  One place — top right of the header. Tinted, never bold.
- **The button carries the state.** Inert Generate when inputs are missing, filled Generate when
  ready, Cancel run mid-flight, outlined Regenerate once rendered, filled again the moment the
  prompt drifts from what was fired.
- **Tags are exceptions.** The area beside the button is empty in ordinary states; it fills only
  for `EDITED · NOT YET RUN` and for a failure, so a tag always means something needs attention.
- Non-active shots drop the `ON` tag and use a `#E4D9C6` left border instead of `#C9431A`.

Note 07 and 08 are design proposals, not observed behaviour — confirm queue and failure
semantics before building them.

---

## Interactions & behaviour

- **Fill a slot** — click an empty slot opens the picker; `Import` opens the library.
  Start frame is required; end frame and refs are optional and never nag.
- **Hover a filled slot** — `⛶` full screen, `⇄` replace, `⋯` more. Controls fade in over 140ms
  with a 3px rise, on a top scrim `linear-gradient(180deg,rgba(20,24,31,0.42),transparent 52%)`.
  Empty slots have no hover controls.
- **Edit the prompt** — always editable, including mid-run. A run keeps the words it was fired
  with; editing after a run shows `EDITED · NOT YET RUN` and returns primary weight to the button.
- **Generate one shot** — button switches to `Cancel run` for the duration (2.6s in the prototype).
- **Generate the beat chained** — shots run in order, each starting on the last frame of the one
  before. `Stop the chain` halts after the shot in flight; finished shots keep their pictures.
  Open question for product: does chaining skip already-rendered shots or re-run the whole beat?
- **Full-screen viewer** — `←` `→` move between the three images the shot holds (start frame plus
  its two refs), `P` pins, `R` regenerates, `Esc` closes.

## State management

Per shot: `startFrame`, `endFrame`, `refs[]`, `prompt`, `promptRanWith`, `status`
(`not_ready | ready | queued | rendering | rendered | failed`), `picture`.
Derived: `ready = !!startFrame`, `dirty = status === 'rendered' && prompt !== promptRanWith`.

Per beat: `shots[]`, `activeShotId`, `chainRunning`.
Chain sets each shot's `startFrame` from the previous shot's last frame as it completes.

Viewer: `openFrameIndex`, `pinnedFrameId`, `regenerating`.

## Design tokens

Colours

- Page `#F1EADC` · card `#FBF7F0` · white `#FFFFFF` · empty slot `#F1EADC` · picture ground `#14181F`
- Borders `#E4D9C6`, `#EFE7D8` (inner rules), `#CBD0D8` (outlined buttons), `#D6C9B2` (dashed)
- Accent `#C9431A`, hover `#B03A14`, dark text `#8C2B0B`, tint fill `#FDF0E9`, tint border `#F0C6B0`
- Text `#14181F` primary · `#2A303B` body · `#4A5262` secondary · `#6E6553` muted · `#8C7F6C` mono · `#A79C89` disabled
- Status: rendered `#2E7D5B` · rendering/queued `#2A5FA8` · not ready `#8A6A18` · failed `#8C2B0B`

Type

- Manrope — UI and headings. 24/800 page title, 13.5/700 card title, 12.5/700 section, 11.5/700 button, 11/700 small button.
- Source Sans 3 — prose and prompts. 14/1.6, 13/1.55, 12.5/1.5.
- IBM Plex Mono — labels, status, badges. 9px tracking 0.09–0.12em, 8.5px, 8px, 7.5px on slot badges.

Radius 4 (badge) · 5 (tag) · 7 (small button) · 8 (button) · 9 (slot, input) · 11 (player) · 12 (card) · 14 (panel)
Spacing 4 · 7 · 8 · 9 · 11 · 12 · 16 · 18 · 22 · 34
Shadows panel `0 30px 60px -30px rgba(20,24,31,0.35)` · hovered thumb `0 14px 26px -16px rgba(20,24,31,0.55)`
Transitions 140ms ease on hover affordances, 200ms ease on the viewer stage.

## Assets

Placeholder stills in `assets/` (`shot-01`, `shot-03`, `shot-04`, `harbour-wide`, `harbour-figure`).
They stand in for generated frames — do not ship them.

## Files

- `Beat Panel Composer (standalone).html` — the panel plus the full-screen viewer.
- `Shot Composer States (standalone).html` — the eight-state board.
- Sources in the design project: `First Frames Panel - Hi-fi.dc.html`, `First Frames Panel - States.dc.html`.
