# KB Citation Click-through

**Date:** 2026-07-30
**Decisions (user):** citations are clickable in **both** surfaces — the assistant's answer text and the search tool's result block — and clicking opens the existing preview drawer **scrolled to the cited section**.
**Base:** `origin/sprint1`. **Sequencing note:** the UI-polish stream (8 items) and the gemma-text-render bug task may be in flight; this stream overlaps them only on locale files and possibly `MessageText.tsx` — prefer starting after UI-polish merges, and check `git log` for message-rendering changes before branching.

## 1. Problem

The agent cites sources (`[1] hop-dong-ctv-scan.pdf — Pages 1–3` in the tool block; "File nguồn: `hop-dong-ctv-scan.pdf`" in prose) but nothing is clickable. Trust in retrieval comes from being able to check its work; today that means manually opening Project Home and hunting.

## 2. Architecture — recognize known fileNames, never parse model prose

For a conversation whose extra carries `project_id` (discovery: confirm the accessor in the conversation page/MessageList context), fetch `listSources(projectId)` once (cache per conversation; refresh on `projectKnowledge.updated`). Then:

- **Recognition is exact-match on known fileNames** (full name including extension). No NLP, no reliance on the model's citation style. Extensions make false positives effectively impossible; basename identity is unique per project (flat-v1 rule).
- **Non-project chats: zero work** — no project_id, no fetch, no processing.

### The rendering mechanism (the crux)

Assistant text renders through `MessageText.tsx` → `MarkdownView` (`components/Markdown/index.tsx`, shadow-root). Do **not** post-process the shadow DOM (fragile under streaming re-renders). Instead, **pre-process the markdown string** before it reaches MarkdownView: wrap each recognized fileName occurrence as a markdown link with a custom scheme:

- plain occurrence: `hop-dong.pdf` → `[hop-dong.pdf](weprompt-kb://open?file=hop-dong.pdf)`
- **backticked occurrence (observed in real output):** `` `hop-dong.pdf` `` → ``[`hop-dong.pdf`](weprompt-kb://open?file=…)`` — code spans are valid inside link text; this case MUST be handled or the most common real citation style stays dead.
- occurrences already inside a markdown link or inside fenced code blocks: skip (don't nest/corrupt).

**Discovery step (do first):** how `Markdown/index.tsx` handles `<a>` clicks today (presumably `shell.openExternal` for http). Add a branch intercepting the `weprompt-kb://` scheme BEFORE any external handling — it must never leak to `openExternal`. URL-encode fileNames in the scheme.

### The tool-result block

The search tool's output format is ours (`formatHitsAsText`). Extract the citation-line contract into a **Node-free shared module** `common/knowledge/citationFormat.ts`: the `[n] fileName — headingPath` line format (builder used by `searchCore.formatHitsAsText`, parser used by the renderer). The renderer must NOT import `searchCore` (it pulls Node fs). A round-trip test locks the two ends together so the format can never silently drift. The tool block's preprocessing attaches the parsed `headingPath` as an `anchor` param in the link — this is what powers scroll-to-section.

### Click → drawer

A small controller in the conversation page mounts the **existing `KnowledgeSourcePreview`** (pure props, already reusable) and on citation click: resolve fileName → sourceId from the cached source list → `getSourceText(projectId, sourceId)` → open drawer. `onOpenOriginal` = `shell.openFile('<workspace>/Knowledge Base/<fileName>')` (workspace comes from the same conversation extra). **Source no longer exists** (removed/renamed): show an i18n toast ("This file is no longer in the knowledge base") and do nothing else.

### Scroll-to-section

Drawer content renders in a shadow root. After the preview text loads, scroll to the anchor: match the cited headingPath's most specific segment (e.g. `Page 2` → the `## Page 2` heading; heading trails → first heading whose text matches the last segment). Query via the drawer container's `shadowRoot`; if no match, open at top (never error). Prose clicks (no anchor) open at top.

## 3. Behaviour details

- Streaming: preprocessing is a pure string transform per render — memoize per message content. Linkified text appearing mid-stream is fine.
- Idempotence: the transform must be safe to run on already-linkified text (it skips inside links).
- Only `ready` sources are clickable-resolvable; if a fileName matches a non-ready source, still open the drawer path and let `getSourceText` failure show the drawer's existing failed state.
- Performance: a project has few sources; exact-match scanning per message is trivial. Build one regex per source list (escape names), rebuilt only when the list changes.

## 4. Files

- **New:** `common/knowledge/citationFormat.ts` (Node-free: line builder + parser + anchor helpers); a renderer util `linkifyKnownSources.ts` (pure) + a conversation-level preview controller component.
- **Modified:** `searchCore.ts` (use the shared builder — output must stay byte-identical; assert in tests), `Markdown/index.tsx` (custom-scheme interception), `MessageText.tsx` and the tool-result rendering site (apply the transform), conversation page (mount controller), locales (toast key ×12).
- **Zero new IPC channels** — `listSources` + `getSourceText` + `shell.openFile` all exist.
- **Do not touch:** `knowledgeServer.ts` behaviour, retrieval, the card.

## 5. Tests

- `linkifyKnownSources`: plain hit, backticked hit, inside existing link (skip), inside fenced block (skip), multiple files, name-with-regex-chars, idempotence, empty source list → identity.
- `citationFormat` round-trip: `formatHitsAsText` output parses back to `{fileName, headingPath}` for every hit — and a fixture test that fails if the format changes on either side.
- Controller dom-test: click → drawer opens with fetched text; missing source → toast; anchor scroll helper unit-tested with a fake shadow tree.
- Live verification (required): re-run the Stream E scenario — a project chat citing `hop-dong-ctv-scan.pdf` — and click the citation in BOTH surfaces; verify scroll lands on the cited page heading; remove the file, click again, see the toast.

## 6. Out of scope

Highlighting the exact passage text inside the preview; prev/next navigation across multiple citations; citations for non-KB files (workspace files, URLs); any change to the tool's output wording (the format module must preserve it byte-for-byte).
