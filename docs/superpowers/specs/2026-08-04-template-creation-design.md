# Template Creation Skill — Design Spec

> **SUPERSEDED** by `docs/design/template-creation-skill-plan.md` (2026-08-04), which
> carries the hardened revision (security snapshot model, privacy decision, durable
> proposal record, corrected runner/directory facts). This file is kept as the
> brainstorm record only.

**Date:** 2026-08-04
**Status:** superseded — see banner
**Related:** `docs/design/artifact-quality-epic-plan.md` (2B contract factoring is a prerequisite
for the pptx/docx content rules); `docs/design/wms-presentation-quality-incident.md`

## Summary

Users working on documents in WePrompt can ask, in chat, for a new presentation template
("save this deck as a template", "make me a template with our brand colors"). The agent
generates a template pack, WePrompt stages and validates it, and the user confirms via a
review card in chat before it appears in the Template Gallery.

## Decisions (settled during brainstorming)

| Question | Decision |
| --- | --- |
| Source | Both derivation modes; **artifact-first** is the primary flow (derive THEME.md + reference from the artifact in the conversation workspace); from-description also supported — see the format×source rule below |
| Formats | All three: html, pptx, docx — full parity with builtin packs |
| Registration | **Staged + user confirm** — never lands in the gallery without an explicit click |
| Sequencing | **After the epic's 2B contract factoring** — generated THEME.md is visual-system-only (palette, typography, layout catalog, motif, voice); the canonical layer supplies workflow/gates/follow-up rules |
| Mechanism | **Approach B: skill + staged files + marker block** (chosen over a native tool, which cannot reach ACP sessions, and over a button-driven wizard, which mismatches the chat-first framing) |

**Format × source rule:** pptx/docx templates are **artifact-derived only** — the
reference file must be a real artifact from the workspace; the skill never builds a
reference deck from scratch inside the template flow (that would duplicate the epic's
no-template generation path). From-description directly produces **html** templates only.
A from-description deck template composes naturally instead: generate the deck through the
normal flow (default pack path), iterate until happy, then "save this as a template."

## Architecture — end-to-end flow

```text
1. TRIGGER    Free-form chat request → template-creation skill activates
              (aionrs: auto-injected backend skill; ACP: workspace-discovered skill)

2. GENERATE   Agent, per skill instructions:
              - artifact-first: copies the source artifact as reference.pptx/.docx
                (html: no reference)
              - writes a VISUAL-SYSTEM-ONLY THEME.md
              - both files go into <workspace>/.template-staging/<slug>/
              - reply ends with a fenced marker block:
                ```template-proposal
                { "dir": ".template-staging/<slug>", "name": "...", "format": "pptx" }
                ```

3. STAGE      Renderer parses the marker → ipcBridge.presentationTemplates.stagePack
              → main-process staging module validates, derives the manifest,
                extracts sample tokens, renders the preview
              → returns StagedTemplateSummary or a typed rejection

4. REVIEW     Chat renders a review card (preview, name, format chip, description)
              with Add to gallery / Discard

5. COMMIT     Confirm → pack moves into userData/presentation-templates/,
              SWR list mutates, template appears in the gallery
```

**Trust boundary:** the agent produces *content* (THEME.md, reference file, marker); the
main-process service produces *structure* (manifest, id, preview, sample tokens,
validation). The agent never writes `template.json`.

## Components

### Main process — `packages/desktop/src/process/services/presentation-template/`

- **New `templateStaging.ts`** (+ test) beside the existing service, keeping the directory
  within the 10-child limit and `PresentationTemplateService.ts` focused:
  - `stagePack(dir)` — validate and summarize a staged pack
  - `commitStaged(id)` — re-validate cheaply, move into the store
  - `discardStaged(id)` — remove the staging dir
- Validation reuses `validateTemplateManifest` and `parseThemeTokens`; pptx/docx reference
  checks reuse the officecli runner owned by `OfficeArtifactService` (BUG-003 machinery) —
  no new shell plumbing.
- **Sample-token extraction:** `officecli view <reference> text` → distinctive proper
  nouns/numbers from the source artifact → stored in the pack. These are the "reference
  sample content" for future uses of the template, giving user packs the same
  leftover-content gate the builtins carry.
- **Preview:** html → existing `renderThemeThumbnailSvg`; pptx/docx → officecli screenshot
  of slide/page 1 saved as `preview.png` (summary pipeline already handles PNG).
- `bridge.ts`: three new providers.

### Common

- `ipcBridge.ts`: `presentation-templates.stage-pack`, `.commit-staged`,
  `.discard-staged`, following the existing endpoint conventions.
- `presentationTemplate.ts`: `StagedTemplateSummary` type; **additive** optional manifest
  field `sampleTokens: string[]` (older packs without it remain valid).

### Renderer

- **`templateProposalParser.ts`** in `renderer/utils/chat/` — third sibling of
  `skillSuggestParser` / `templatedSendParser`. Same defensive posture: unparseable or
  absent marker → message renders unchanged; never hide content that cannot be classified.
- **Review card** following the skill-suggest pattern: `MessageTemplateProposal.tsx` +
  `TemplateProposalCard.tsx` in `conversation/Messages/components/` (TemplateGallery dir
  is at the 10-child limit — documented in `usePresentationTemplates.ts`).
- All card text via i18n keys under `conversation.presentationTemplates.proposal.*`.

### Skill content (bundled resource)

Instructions covering: how to analyze an artifact's visual system, what a
visual-system-only THEME.md contains (palette, typography, layout catalog, motif, voice —
explicitly NOT workflow/gates/follow-up sections), the staging-dir layout, and the marker
contract.

Delivery per platform:

- **aionrs:** registered in the backend skill registry and auto-injected like officecli —
  NOT opt-in via Skills Hub (opt-in availability is the trap the incident doc identified).
- **ACP (Claude Code):** ACP agents discover skills themselves; WePrompt materializes the
  skill file into the conversation workspace. ⚠ Requires a short verification spike
  (same family as epic spike V.2).

## Error handling

The marker block is agent-generated content — `stagePack` treats it as untrusted input:

- **Path containment:** `dir` must resolve inside the conversation workspace (reject
  traversal, absolute paths, symlink escapes). Derived id must pass `TEMPLATE_ID_RE`.
- **Typed rejections rendered in chat:** missing/unparseable THEME.md (no extractable
  colors/fonts), reference failing `officecli validate`, missing reference for pptx/docx.
  The card shows a failed state with the reason so the user can ask the agent to retry —
  silent failure would read as WePrompt ignoring the request.
- **Corrupt reference = hard reject.** A bad reference file would poison every future use
  of the template. No fallback.
- **Preview failure = soft.** Screenshot failure falls back to the theme-token SVG
  thumbnail; preview is informational.

Lifecycle:

- **Commit re-validates** (files may change between staging and confirm — the agent keeps
  working in the same workspace).
- **Card is idempotent across history renders:** queries staged state at render time —
  committed → "Added" state; staging dir gone → disabled state. Re-rendering never
  re-stages.
- **Collisions** reuse the existing `uniqueId` suffixing.
- **Discard / conversation deletion** clean the staging dir. Nothing persists outside the
  gallery except by explicit commit.
- **Contract text in generated THEME.md** (model drift): accepted, not policed — the skill
  instructs against it, the user reviews via the card, and the canonical 2B layer supplies
  the real contract regardless.

## Testing

- **`templateStaging` unit tests** (bulk of coverage): valid staging per format; every
  typed rejection including path traversal; token extraction; preview fallback; commit
  re-validation; discard cleanup. officecli runner mocked at the `OfficeArtifactService`
  test seam.
- **Parser tests** mirroring `directive.test.ts`: valid marker, malformed JSON, missing
  fields, no marker → null.
- **Card tests:** proposed / committed / failed / disabled states; confirm/discard IPC
  calls (mind the Arco Modal-spread mock trap).
- **Manifest schema:** `sampleTokens` additive — packs without it still validate.
- **Cross-checks:** `bun run i18n:types` + `node scripts/check-i18n.js`; add the three new
  endpoints to the exhaustive IPC fixture suite.
- **Skill content:** not unit-testable — live smoke test per platform (the ACP discovery
  spike doubles as this), later folded into the epic's V.4 eval harness as a
  template-creation scenario.

## Dependencies & sequencing

1. **2B contract factoring** (artifact-quality epic) — prerequisite for the
   visual-system-only content rule for pptx/docx templates. The staging machinery itself
   has no 2B dependency.
2. **ACP skill-discovery spike** — verify workspace materialization reaches Claude Code
   sessions (pairs with epic spike V.2).
3. Existing machinery reused as-is: pack store + sync, `uniqueId`, `validateTemplateManifest`,
   `parseThemeTokens`, thumbnail rendering, officecli runner, marker-parser pattern,
   skill-suggest card pattern.

## Out of scope (v1)

- Gallery management via chat (rename / edit / delete) — the gallery UI handles removal.
- Button-driven trigger from the artifact preview toolbar (possible later addition; the
  staging machinery is trigger-agnostic).
- Template sharing/export between users.
- Editing a builtin template into a user variant ("fork this builtin").
