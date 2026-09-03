You are applying the approved Creative Studio typography and colour system (branch codex/studio-typography). This is a TYPOGRAPHY AND COLOUR pass ONLY — do not change layout, structure, spacing rhythm, component composition, or copy. Same DOM, different type and colour.

WHY: the Studio surfaces render almost everything in Manrope at default weights and use the brand orange for body-level text (sidebar project names, card titles, breadcrumb links). The approved prototype uses a THREE-ROLE typeface system and reserves orange strictly for the primary CTA and small accents. All three typefaces are ALREADY LOADED in this app (verified live: `document.fonts` contains Manrope, Source Sans 3, IBM Plex Mono) — you are NOT adding font dependencies, only applying the right family per role.

ROLE TABLE — measured from the approved prototype's computed styles (authoritative):
| Role | Family | Size | Weight | Letter-spacing | Colour |
| Page heading (h1) | Manrope | 26px | 800 | -0.52px | rgb(31,29,27) |
| Primary CTA / button label | Manrope | 13.5px | 700 | normal | white on orange |
| Body / descriptions | Source Sans 3 | 14.5px | 400 | normal | rgb(94,87,71) |
| Card / list title | Source Sans 3 | 13px | 400 | normal | rgb(84,80,63) |
| Eyebrow + badge (uppercase labels) | IBM Plex Mono | 9.5px | 400 | 0.95px | contextual |
| Meta row (counts, durations, timestamps) | IBM Plex Mono | 11px | 400 | normal | rgb(110,101,83) |
Prototype page background: rgb(233,227,214).

⚠️ TOKENS, NOT HARDCODED VALUES. This repo forbids hardcoded colours; use existing semantic tokens/CSS variables wherever one matches (search `uno.config.ts` and the renderer style layer for the nearest existing ink/secondary/muted/accent tokens). Only introduce a new token if nothing suitable exists, and if you do, define it once in the shared layer — never inline a hex or rgb() in a component. The sizes/weights/tracking above may be expressed as a small set of reusable role classes in the Studio CSS modules; do not scatter one-off values.

WHERE TO APPLY (all Creative Studio surfaces):
1. EYEBROW/BADGE ROLE — every uppercase micro-label becomes IBM Plex Mono per the table. Known instances: `START FROM A SHAPE`, the pick-up-where-you-left-off section label, `STUDIO PROJECTS`, the sidebar `NO MEDIA CREDITS HERE` note heading, the poster badges (`SCRIPT ONLY`, the take/shot badge), the script table's column headers (SHOT · SCRIPT · VISUAL · OUTPUT), `RENDERING WITH` in the Produce engine bar, and the activity-row meta. Search for existing uppercase labels rather than trusting this list to be complete.
2. META ROLE — IBM Plex Mono 11px for count/duration/timestamp rows: library card meta (`3 shots · 15s · 5 hours ago`), take/scene counters, durations.
3. BODY + CARD TITLE — Source Sans 3 per the table.
4. COLOUR DISCIPLINE — orange is ONLY for the primary CTA and small accents (status dots, a lone `ALL` action link). Convert to ink/secondary tokens: sidebar Studio project names, library card titles, the "Back to project library" breadcrumb, and any other body-level text currently rendered in the brand orange. Do NOT change the primary buttons, the active phase-rail indicator, or status dots.

CONSTRAINTS: no layout/spacing/structure changes; no copy changes; Arco components only; TypeScript strict, no `any`; do not touch i18n keys. Keep every accessible name intact — if a label's element changes, its `aria-label`/association must survive. Both light and dark themes must remain legible: check your token choices in both, and state in FINDINGS.md what you verified.

VERIFY: `bunx tsc --noEmit`; `bun run test tests/unit/pages/studio`; `bun run lint:fix && bun run format`. Tests that assert on text content should be unaffected — if one breaks, you changed structure or copy, which is out of scope; revert that part.

Stage exact paths only — never `git add -A`, and do NOT commit FINDINGS.md. ONE commit: `style(studio): apply the three-role typography system and reserve orange for actions`. NEVER add AI signatures. Do NOT push. In FINDINGS.md list the tokens you used or added, every place you changed a colour off orange, and your dark-theme check.
