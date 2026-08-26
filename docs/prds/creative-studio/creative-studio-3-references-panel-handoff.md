# Handoff: References panel

## Overview

The References panel is where a director builds the canonical images a story reuses: one
reference per named character, one per background that recurs. Each reference holds several
photos ("takes"); one is current, and every photo is auto-named so it can be called by name
from a shot prompt.

This panel runs before the board and before any first frame. Nothing generates downstream until
the references are bound.

## About the design file

`References Panel (standalone).html` is a **design reference created in HTML** — a prototype of
the intended look and behaviour, not production code to copy. Recreate it in WePrompt using its
existing components and patterns. If a value here conflicts with an existing component, prefer
the component and tell design. Opens offline in a browser, no server needed.

**Fidelity: high.** Colours, type, spacing, radii and copy are final unless design says otherwise.

It shares its design language with the beat panel composer handoff — same card shape, same status
vocabulary, same accent. Build them as one family.

---

## Layout

Panel card: max 1000px wide, white `#FFFFFF`, 1px `#E4D9C6`, radius 14px,
shadow `0 30px 60px -30px rgba(20,24,31,0.35)`.

### Title bar

Padding 12/18, bottom border `#EFE7D8`. `References` 13.5px/700 ·
`CANONICAL IMAGES` mono 8.5px `#8C7F6C` nowrap · spacer · `✕`.

### Intro row (padding 16/18)

Left: one sentence, Source Sans 3 13px/1.55 `#4A5262`, max-width 520px.
Right column, 230px fixed:

- Progress bar — 5px track `#EFE7D8` radius 3, fill `#C9431A`, width = share of references
  that have a photo, 200ms ease.
- Below it: counter `2 / 3 SET` (mono 8.5px `#8C7F6C`, nowrap) · spacer ·
  **Bind to all shots** (11px/700, radius 7, padding 4/9).
  - Incomplete → inert `#A79C89` on `#F1EADC`, border `#E4D9C6`.
  - Complete → white on `#C9431A`.
  - Bound → `Bound to all shots`, `#2E7D5B` on `#EAF3ED`, border `#C3DFCE`.

### Groups

Two groups, `Characters` then `Places`. Group header: 12px top padding, top border `#EFE7D8`,
title 12.5px/700 nowrap · note mono 8.5px `#8C7F6C` (`ONE REFERENCE PER NAMED CHARACTER ·
SEVERAL PHOTOS EACH`) · `+ Add character` / `+ Add place` (11px/700 `#6E6553`, 1px `#CBD0D8`,
radius 7, padding 4/9, hover fill `#F1EADC` border `#C9431A` text `#B4380F`).

---

## The reference card

Same row structure as the shot card in the beat panel: identity → picture → strip → prompt → action.
Background `#FBF7F0`, 1px `#E4D9C6`, radius 12px, padding 13px 16px, 11px gap,
3px left border — `#C9431A` when the reference has a photo, `#E4D9C6` when it does not.

1. **Identity row** — 7px status dot (`#C9431A` filled / `#D6C9B2` empty) · **name as an inline
   text input** (Manrope 13.5px/700, transparent background, no border; dashed `#D6C9B2` underline
   while empty; width tracks the value) · meta line (mono 8.5px `#8C7F6C`, `flex:1;min-width:0`)
   · status word · `✕` removes the reference (hover `#8C2B0B`).
2. **Picture band** — full width, 156px tall when filled, 108px when empty, radius 10px.
   - Filled: `background:#EFE7D8 url(photo) center/contain no-repeat`, 1px `#E4D9C6`.
     **`contain`, not `cover`** — references arrive in every aspect ratio, so the picture is
     matted whole onto the parchment ground rather than cropped. Leftover space must read as
     matting; never use a dark ground here, which reads as a void.
   - Empty: `#F1EADC`, 1px dashed `#D6C9B2`, centred `▣` + `GENERATE OR IMPORT A PHOTO`
     (mono 8px). The whole band is the click target and adds a photo — no dead affordance.
   - Generating: opacity 0.5, `saturate(0.4)`, 200ms.
   - Badge, bottom-left 8px: `CURRENT · @wren-01` — mono 8px, `#FFF6EF` on `#C9431A`, radius 5,
     padding 3/6, nowrap.
   - Hover (filled only): top scrim `linear-gradient(180deg,rgba(20,24,31,0.28),transparent)`
     and three 28px controls at top-right, `rgba(20,24,31,0.62)` + `blur(6px)`, fading in over
     140ms with a 3px rise: `⛶` full screen · `↓` download · `✕` remove this take (hover `#8C2B0B`).
3. **Take strip** — 6px gap, wrapping. Each take is a column: 54×38 thumb (radius 7, cover) with
   its handle under it (mono 9px). Current take: 2px `#C9431A` border, opacity 1, handle `#B4380F`.
   Others: 1px `#E4D9C6`, opacity 0.68, handle `#8C7F6C`. Clicking anywhere in the column makes
   that take current. Then a 54×38 dashed `+` tile (adds a photo, hover `#FDF0E9`), then the
   count (`2 PHOTOS`, mono 8.5px). The `+` tile and count are pushed up 15px to sit level with
   the thumbs, not the handles.
4. **Prompt** — full-width textarea, 2 rows, no resize, Source Sans 3 12.5px/1.5 `#2A303B`,
   white, 1px `#E4D9C6`, radius 9, padding 8/10, focus border `#C9431A`.
   Placeholders: characters — `Describe the character once — build, age, clothing, and nothing
about the scene.`; places — `Describe the place once — light, weather, and what is always in
frame.`
5. **Action row** — state tag · spacer · `Import photo` (outlined 11px/700) ·
   primary button. Labels: `Generate` (no photo) → `Generate another` (has one) →
   `Generate again` (prompt edited) → `Cancel run` (in flight).

### Status words

`NO PHOTO` `#8A6A18` · `CURRENT SET` `#2E7D5B` · `GENERATING` `#2A5FA8`.
One place: right of the identity row, mono 8.5px, never bold.

### Tags

Beside the button, and only for exceptions: `RUNNING · ADDS A NEW PHOTO`
(`#2A5FA8` on `#EDF2FA`, border `#C9D8EE`) and `EDITED · NOT YET RUN`
(`#B4380F` on `#FDF0E9`, border `#F0C6B0`). Empty in ordinary states.

---

## Auto-naming photos

Every photo gets a handle from **the reference's name plus the order it was made**:

    slug(name) + '-' + zeroPadded(index + 1)   →   @wren-01, @wren-02, @harbour-pier-01

- `slug` = lowercase, non-alphanumeric runs collapse to `-`, leading/trailing `-` trimmed.
- Unnamed cards fall back to `@character-NN` / `@place-NN`.
- Renaming a reference re-slugs all its photos immediately — handles are derived, never stored.
- Handles appear under each thumb, in the picture badge (`CURRENT · @wren-01`), and as the
  full-screen title.

**Open for dev/product:** handles are display-only in this prototype — nothing parses `@wren-02`
out of a shot prompt yet. Two decisions needed:

1. Autocomplete in the shot prompt (trigger on `@`, list current references and their photos).
2. Collision rule — two references both named "Wren" currently both produce `@wren-01`.
   Suggest suffixing the later one (`@wren-2-01`) or refusing the duplicate name at entry.
3. If handles are ever persisted (e.g. quoted in an old prompt), renaming must not silently
   break them — either keep an alias or block the rename.

## Interactions

- **Add a reference** — `+ Add character` / `+ Add place` appends an unnamed card at the end of its
  group, meta `NEW CHARACTER · NAME IT, THEN DESCRIBE IT`. Name inline, describe, generate.
- **Add a photo** — the `+` tile, `Import photo`, the primary Generate, or clicking an empty band.
  Generate **appends** a take and makes it current rather than overwriting, so a new look can be
  compared before it is adopted. Prototype run takes 2.6s.
- **Switch current** — click any thumb column. The band, badge and everything downstream follow.
- **Remove** — `✕` on the picture drops the current take; `✕` in the identity row drops the
  whole reference. Both recount the progress bar and bind button.
- **Full screen** — `⛶` or the filled band. Overlay `rgba(12,14,18,0.94)`, handle as the title,
  `CURRENT REFERENCE` badge, image `contain` on black, max-height `calc(100vh - 200px)`,
  footer `ESC CLOSE · R REGENERATE`.
- **Bind** — pushes the current set to every shot. Inert until every reference has a photo.
  A prompt that names a photo outright should win over the bound one.

## State management

Per reference: `id`, `name`, `meta`, `takes[]` (image refs, order is meaningful — handles derive
from it), `cur` (index of the current take), `prompt`, `ran` (the prompt the last run fired with).
Derived: `filled = takes.length > 0`, `dirty = filled && prompt !== ran`,
`handle(i) = '@' + slug(name) + '-' + pad(i+1)`.

Panel: `characters[]`, `places[]`, `bound`, `runningId`, `openPhoto`.
`done = all.filter(filled).length`; bind enabled only when `done === all.length`.

## Design tokens

Colours

- Page `#F1EADC` · card `#FBF7F0` · white `#FFFFFF` · mat / empty `#EFE7D8`, `#F1EADC`
- Borders `#E4D9C6`, `#EFE7D8` (inner rules), `#CBD0D8` (outlined buttons), `#D6C9B2` (dashed)
- Accent `#C9431A`, dark text `#8C2B0B`, tint fill `#FDF0E9`, tint border `#F0C6B0`
- Text `#14181F` primary · `#2A303B` body · `#4A5262` secondary · `#6E6553` muted ·
  `#8C7F6C` mono · `#A79C89` disabled / placeholder
- Status: set `#2E7D5B` (on `#EAF3ED`, border `#C3DFCE`) · running `#2A5FA8` (on `#EDF2FA`,
  border `#C9D8EE`) · missing `#8A6A18`

Type

- Manrope — UI. 13.5/700 card title and name input, 12.5/700 group title, 11.5/700 button,
  11/700 small button.
- Source Sans 3 — prose and prompts. 13/1.55, 12.5/1.5.
- IBM Plex Mono — labels and handles. 9px handles, 8.5px labels tracking 0.08–0.09em, 8px badges.

Radius 5 (badge) · 7 (thumb, small button) · 8 (hover control) · 9 (input) · 10 (band) ·
12 (card) · 14 (panel)
Spacing 3 · 6 · 7 · 8 · 10 · 11 · 12 · 14 · 16 · 18 · 34
Transitions 140ms ease on hover affordances · 200ms ease on the progress bar and generating state

## Assets

Placeholder stills in `assets/` — do not ship them. They are also why the band mats rather than
crops: `harbour-figure.png` is 256×130 and `harbour-wide.png` is 520×136, and neither matches the
band's ratio. Real references will vary just as much.

## Files

- `References Panel (standalone).html` — the panel, plus the notes explaining the rules.
- Source in the design project: `References Panel - Hi-fi.dc.html`.
- Companion: `design_handoff_beat_panel_composer/` — the beat panel and shot composer states.
