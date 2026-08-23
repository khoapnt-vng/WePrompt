# Beat Panel Repair — design review handoff

Deliverable: [beat-panel-repair.html](./beat-panel-repair.html) (single HTML file, opens in a browser, no setup).

## Reviewer's note (verbatim)

> Attached: Beat Panel Repair (single HTML file, opens in a browser, no setup).
>
> I went through the four screenshots you sent. It's one board, three parts:
>
> **1a** — the screenshots marked up, 25 findings, each with the fix beside it. They come down to five causes: the panel sets its own font sizes instead of composing `StudioTypography.module.css` (everything lands ~1.4× the rest of Studio), status strings ship as UI copy, disabled-plus-a-paragraph is used as a default state, two scroll columns where one has nothing to say, and save being per-card — which is why every other action needs a "save first" gate.
>
> **1b** — the panel redrawn at 1100px, in the state that's hardest to lay out (shot 1 rendering, 2 and 3 waiting). Plus the alert row and footer for five other states, a words-to-change table, and the order I'd do the work in. Start with 00 and 01 — the IA change and the single scroll. Both are cheap and everything else sits better afterwards.
>
> **2 and 3** — two IA questions we settled while reviewing. Action / Look / Line read as three prompts because they're drawn as three identical textareas; only Line is a prompt. So Line becomes Prompt, Look becomes a constraint strip, Action becomes a plan that surfaces only when it disagrees with the prompts (3c). Nothing about the schema changes.
>
> Two things I need from you:
>
> 1. What does Lift mean — promoting a take into the film, or removing one? If it's removal, the whole rename column is wrong.
> 2. Which branch is this panel on? It isn't on `feat/studio-three-pane`, so the findings name symptoms rather than files. Point me at it and I'll redo the audit against real lines.

## Answers to the two questions (added at commit time, from the code)

1. **Lift is removal.** It moves a Shot or Beat out of active coverage into the Bin, preserving authored and paid work. The en-US copy is unambiguous: `lift.shotBodyNoStale` = "Authored and paid work stays with this Shot. Lift it from active coverage?", `lift.shotSucceeded` = "Shot moved to the Bin.", `lift.beatBodyNoStale` = "… Lift it from the active film?" (`packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json`, `lift` block near line 1896). Per the reviewer's own caveat, **this means the board's rename column is wrong** and needs a pass before anyone implements those renames.
2. **The panel lives on this branch**, `codex/creative-studio-table-board-ui-design`, under `packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/` (main component `index.tsx`, plus `BeatPanel.module.css`, `BeatPlayer.tsx`, `CoverageBar.tsx`, `coverageGeometry.ts`, `beatPlaybackSequence.ts`). It is not on `feat/studio-three-pane`, which is why the audit found no files there.
