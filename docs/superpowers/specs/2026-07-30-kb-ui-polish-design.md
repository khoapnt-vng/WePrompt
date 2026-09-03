# KB UI Polish — eight improvements

**Date:** 2026-07-30 (items 6–8 added same day from the user's annotated screenshot)
**Scope decision (user):** items 1–5 below plus three screenshot-driven additions (6–8). Citation click-through and the stale-chat hint are explicitly deferred — do not build them here.
**Base:** `origin/sprint1` (must already contain the Knowledge Base folder work — verify `knowledgeFolderHint` exists in en-US `conversation.json` before starting).

Items 1–5 live in `ProjectKnowledgeCard.tsx` + `useProjectKnowledge.ts` + locales; item 6 touches the sidebar (`GroupedHistory`), item 7 touches the Knowledge and Files card headers, item 8 is card-local. **Goal: zero new IPC channels** — every item below is achievable with bindings that already exist. If you find yourself adding a `bridge.buildProvider` channel, stop and reconsider; that path costs allowlist + Zod + sibling-mock updates and none of these items should need it.

Read the CURRENT card/service on sprint1 first — Stream D changed signatures (mutating IPC calls now carry a `workspace` param; the card has preview/Trash-delete/Refresh/folderMissing/progress states). Do not work from stale assumptions.

## 1. "Embed all" backfill action (observed pain)

**Problem:** files indexed before an embedding model was configured sit at `vectorCount < chunkCount` forever unless the user clicks Retry per row (or removes and re-adds). Observed live: the user did exactly that dance.

**Fix:** when ≥1 source has `status === 'ready' && vectorCount < chunkCount`, show an **"Embed all"** text button in the footer/summary area. On click, call the existing `retrySource` for each such source (sequentially is fine — the service queue serializes anyway, and the embed pass picks up ALL missing vectors across sources in one sweep, so later calls cheaply no-op). No new IPC.

**Honest edge:** if no embedding model is configured, the embed pass no-ops (it logs why, since the logging fix). The button may appear to do nothing — acceptable because item 2 gives the user the fix path right next to it. Disable the button while any source is `indexing`/mid-progress to avoid stacking.

## 2. Actionable "semantic off"

**Problem:** the footer says *"semantic off — no embedding model configured"* and offers nothing. Resolving it once took a provider-API round trip.

**Fix:** make the state actionable — render the semantic-off fragment with an inline link/button that navigates to the **model-provider settings page**. Find the real route by reading the router config / settings pages (the provider management UI exists — grep for where `mode.listProviders` or the provider settings component is routed; do not guess the path). Splitting the i18n string is allowed: e.g. keep `knowledgeSemanticOff` and add `knowledgeSemanticOffAction` ("Add an embedding model") as the link text.

## 3. "Passages" tooltip (user asked what it means)

Wrap the green passages `Tag` in an Arco `Tooltip`: new key `knowledgePassagesTooltip`, e.g. *"This file was split into searchable passages. The assistant retrieves the most relevant ones when it answers."* Keep it one sentence; no jargon ("chunks", "BM25").

## 4. Reveal folder

The card *mentions* the Knowledge Base folder (`knowledgeFolderHint`) but offers no way to open it. Add a header action calling `ipcBridge.shell.showItemInFolder.invoke(<workspace>/Knowledge Base)` — same pattern `ProjectFilesCard` uses for the workspace. **Reuse the existing `projectHome.revealInFolder` i18n key** (zero locale work). Hide the action when the card is in the `folderMissing` state.

## 5. Drag & drop files onto the card

**Investigate first, and descope with evidence if the preload doesn't cooperate.** Electron 37 removed `File.path`; renderer code needs `webUtils.getPathForFile(file)`, which must be exposed via preload in a sandboxed renderer. Check whether the app already has a drop-file pattern (grep for `getPathForFile`, `webUtils`, `onDrop` in the renderer and preload). If a bridge exists, mirror it; if it requires a preload change, that is a small, legitimate addition (preload files are in `packages/desktop/src/preload/`) — but if it balloons, ship items 1–4 and report the drop item back with what you found rather than forcing it.

Behaviour when it works: `onDragOver` highlights the card (semantic tokens only — e.g. a `border-primary`-style accent, no hex); `onDrop` filters to supported extensions (read the live list from the card's existing filter: md/txt/docx/xlsx/pdf), passes paths to the existing `addSources` (with its post-D `workspace` param), ignores directories, and does nothing on an empty/unsupported drop. Do not accept drops in the `folderMissing` state.

## 6. Fix the sidebar project-row action buttons (screenshot annotation 1)

**Problem (observed):** the project row's two hover actions in the sidebar — the `Plus` (new chat in project) and `MoreOne` (menu) buttons at `renderer/pages/conversation/GroupedHistory/index.tsx` (~lines 676 and 700 on current sprint1) — render as oversized, detached boxes that overlap the row's edge instead of sitting inline. See the user's screenshot: they look broken next to the "testing" project row.

**Fix:** make them compact inline icon buttons, vertically centred in the row, right-aligned, appearing on hover/selection, with no layout shift and no overlap — matching how other sidebar rows (e.g. `ConversationRow.tsx`'s `MoreOne` at ~line 418) present their actions. This is a styling/structure fix, not a behaviour change: both actions keep their current handlers exactly.

## 7. Icon buttons for card header actions (screenshot annotation 2)

**Problem:** the Knowledge card header uses plain text buttons ("Refresh", "Add files") and the Files card header uses a text button ("Reveal in folder"). The user wants icons.

**Fix:** convert these header actions to compact **icon buttons** from `@icon-park/react` (the repo's icon set — e.g. `Refresh`, `Plus` or `Upload`, `FolderOpen`), each wrapped in an Arco `Tooltip` carrying the existing i18n label, and each with an `aria-label` from the same key so accessibility does not regress. Apply to: Knowledge card (Refresh, Add files, plus the new Reveal action from item 4) and the Files card (Reveal in folder). Keep row-level actions (Retry / Delete file) as text — they are contextual and the annotation targeted the headers.

**Do not confuse this with per-file *type* icons on source rows** — those were considered and rejected earlier; still out of scope.

## 8. Remove the "Note" tag (screenshot annotation 3)

**Problem:** a `ready` source carrying a non-fatal note (e.g. truncation) currently renders an extra `Note` tag (`ProjectKnowledgeCard.tsx` ~lines 153–157, key `knowledgeStatusNote`). The user wants it gone — it reads as clutter next to file names.

**Fix:** delete the standalone Note tag. Do not discard the information: when a ready source has a non-fatal `error`, append that text to the **passages tooltip** built in item 3 (one tooltip per ready row: the passages explanation, plus the note when present). Remove the now-unused `knowledgeStatusNote` key from en-US **and all 11 other locales** (check nothing else references it first), and update any test asserting the tag.

## Cross-cutting

- **i18n:** every new string in en-US **and all 11 other locales**; `bun run i18n:types` + `node scripts/check-i18n.js` must pass. Match each locale's existing register (reuse each file's existing terms for "model", "settings", "folder").
- **Tests:** extend the existing card dom-test file, mirroring its mocking style: Embed-all appears only for partial sources and calls retrySource per pending source; semantic-off link navigates (mock the router); tooltip renders; reveal action invokes `showItemInFolder` with the right joined path and hides on folderMissing; drop calls addSources with filtered paths (simulate `DataTransfer` — if `webUtils` is involved, inject/mock it).
- **Gate:** full `bun run test`, `bunx tsc --noEmit`, `bun run lint:fix` (0 errors; ~847-warning baseline), scoped `bunx oxfmt`. Conventional Commits, no AI signatures, no push/MR without approval.
- **Live check:** with the dev app — see Embed all backfill a real BM25-only source after adding a model; click the semantic-off link and land on provider settings; hover the tooltip; reveal the folder in Finder; drag a real file in.

## Out of scope (do not build)

Citation click-through; stale-chat hint; file-type icons; any retrieval/service behaviour change; any new MCP tool or tool-description change; extraction quality; the VLM-OCR stream.
