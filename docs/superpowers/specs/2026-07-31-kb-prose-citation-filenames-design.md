# KB prose citations: cite by exact filename

**Date:** 2026-07-31
**Status:** approved
**Found by:** KB epic integration acceptance pass (sprint1)

## Problem

Clickable KB citations in assistant *prose* only appear when the model writes a
knowledge source's exact `fileName`. In live testing with MiniMax M2.5, one of
two answers cited its source as "Sổ tay nhân viên 2026" — the document's title —
instead of `so-tay-nhan-vien-2026.pdf`, so that answer offered the reader **no
clickable source at all**. The other turn wrote the filename and linkified
correctly.

The cause is a prompt gap, not a matcher bug. `buildToolDescription`
(`packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts`) closes
with a passive line:

> Output: the most relevant passages, each cited with its source filename so you
> can attribute your answer.

That states what the *tool* does. It never tells the model how to cite in its
own answer. Meanwhile the passage text handed to the model frequently contains
the document's human title as a heading, so the model has a prettier-looking
string than the filename and picks it.

The tool-result block is unaffected: `ToolOutputCitations` recognises the
`[n] fileName — section` headers emitted by `formatHitsAsText`, so those
citations always work and additionally carry a page anchor.

## Decision

Fix this on the **model side** — instruct the model to cite by exact filename.
Do **not** loosen `linkifyKnownSources`.

`linkifyKnownSources.ts` is deliberately "blind to model prose — only exact
known names ever match". That exactness is what stops it turning arbitrary words
into links, and it is pinned by `tests/unit/knowledge/linkifyKnownSources.test.ts`.
Fuzzy-matching prose would trade a precise, tested component for a guess.

### Where the instruction goes

The tool description is the only prompt surface for KB guidance —
`search_project_knowledge` appears in just two files and there is no separate KB
system prompt. Within that, two placements were considered:

| Placement | Verdict |
| --- | --- |
| `TOOL_DESCRIPTION_BASE` (tool description) | **Chosen.** Invisible to the user, no per-call token cost, present for the whole conversation. |
| `formatHitsAsText` preamble (tool output) | Rejected. More proximate to the point of use, but `ToolOutputCitations` renders tool output into the user's work journal as `<pre>` text, so the instruction would show up as prompt-engineering clutter on every search — and it would consume `payloadCapChars` budget. |

The description is less *recent* than the tool result when the model writes its
answer, which is the accepted trade for keeping the journal clean. If live
testing shows the rule still being ignored, adding a reminder to the tool output
is the documented fallback — with its user-visible cost taken knowingly.

## Change

Replace the closing line of `TOOL_DESCRIPTION_BASE` with an explicit, normative
rule that names the three ways this actually fails (title, translated title,
vague reference) and states the mechanism, since compliance improves when the
reason is given:

```
Output: the most relevant passages, each headed by "[n] <fileName> — <section>".

CITE BY fileName. When you attribute a claim in your answer, write the fileName
exactly as it appears in that header — "annual-report-2026.pdf", never the
document's title ("Annual Report 2026"), a translation of it, or a vague
reference ("the report"). The app turns an exact fileName into a link the user
can click to open the source; anything else stays plain text and the user cannot
reach the document.
```

(Quoting uses `"` rather than backticks: `TOOL_DESCRIPTION_BASE` is a template
literal, and double quotes are already how the surrounding text quotes paths, so
nothing needs escaping. The shipped string is one line per paragraph; it is
wrapped here only for readability.)

Files touched:

- `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts` —
  the description text.
- `tests/unit/knowledge/knowledgeServerEnv.test.ts` — assertions in the existing
  `describe('buildToolDescription')` block.

Nothing else changes. `linkifyKnownSources.ts`, `citationFormat.ts`,
`searchCore.ts`, and `ToolOutputCitations.tsx` are untouched.

## Verification

Unit tests can only prove the instruction *ships*, not that it *works*. Both
levels are required:

1. **Unit** — two cases in `describe('buildToolDescription')`, matching that
   file's existing assertion style: the `[n] <fileName> — <section>` header
   format is stated, and citing by title is forbidden.
2. **Live** — ask a KB-backed project a question whose answer comes from a
   specific page, then confirm the *answer text* linkifies (not just the tool
   block). Full manual recipe is in memory under `weprompt-kb-epic-acceptance`.

## Deferred: page anchors in prose

Prose links are anchor-less by design: `linkifyKnownSources` calls
`buildKbCitationHref(plainName)` with no anchor, so a prose citation opens the
preview drawer at the top even when the passage is on page 7. Page-precise
navigation currently lives in the tool-result block, which always carries
`— Pages N–M`.

This is **deliberately left open**, not closed. Landing on page 1 of a 40-page
handbook is real friction, and the machinery mostly exists already —
`buildKbCitationHref(fileName, anchor?)` accepts an anchor, and
`resolveAnchorHeadingText` already maps `Pages 1–3` → `Page 1`.

Making it work would need the model to emit a strictly-formatted page suffix
(`annual-report-2026.pdf (Pages 7–8)`) and `linkifyKnownSources` to fold that
suffix into an anchor. Note this need **not** loosen prose matching: the name
match stays exact and anchored, with the suffix only enriching an
already-certain match, so no new prose words become links.

The reason to defer rather than ship it now: a **hallucinated page number is
worse than no anchor**, because it takes the reader confidently to the wrong
place. Filename compliance should be shown to hold before page compliance is
asked for on top of it. Revisit once there is live evidence the citation rule is
being followed.
