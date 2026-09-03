# Per-Project Knowledge Base — Design Spec

**Date:** 2026-07-24
**Branch:** `feat/project-knowledge-base` (isolated worktree off `sprint1`)
**Status:** Design complete and approved; ready for implementation plan.
**Related:** Project Home (`renderer/pages/project/`, merged into `sprint1`), the global/project context injection seam (`resolveInjectedContext`), AionCore ownership notes.

---

## 1. Goal & summary

Users upload files that become a **shared, on-demand retrieval context for every conversation started in a project** — beyond today's per-conversation compaction (Claude.ai "Project Knowledge" style).

Instead of stuffing all knowledge into every prompt, the agent **pulls** relevant passages via an auto-attached MCP tool, `search_project_knowledge`. The knowledge set is **curated** (only files the user deliberately adds). Retrieval is **hybrid** (BM25 full-text + semantic embeddings). It ships **TS-only** as a built-in MCP "knowledge" server with **no AionCore fork**, keeping the tool contract and on-disk store format clean so a future AionCore-native engine is a drop-in swap (path B).

### Locked decisions (confirmed with user, carried from the prior brainstorm)

1. **On-demand retrieval**, not always-stuffed context — agent pulls chunks via `search_project_knowledge`.
2. **Curated** knowledge set — only deliberately-added files are indexed (not the whole workspace folder).
3. **Hybrid retrieval** — BM25 + semantic embeddings, merged/re-ranked.
4. **TS built-in MCP "knowledge" server**; no AionCore fork for v1; tool contract + store format kept B-ready.
5. **v1 boundary** — desktop conversations *started in a project* only; MCP tools frozen at session creation (KB edits apply to new chats); semantic half degrades to full-text if no embedding provider; per-install index (not synced).

### Verified foundation (against `sprint1` + AionCore v0.1.44 source, 2026-07-24)

- **Session MCP servers are per-conversation.** `extra.selected_session_mcp_servers` (`ISessionMcpServer = { id, name, transport }`) carries a full stdio transport `{ command, args, env }`. AionCore persists it into the conversation and spawns it per-conversation with its own **args + env** (`service.rs` → `factory/acp.rs` + `factory/aionrs.rs` → `ensure_stdio_launch`), for both `acp` and `aionrs` backends. → A pure per-project session server, carrying the project's store path + embed config in `env`, attaches **only** to project chats with **no backend change**.
- **Single send path.** `ProjectNewChatComposer` reuses `useGuidSend` unchanged, so all project chats flow through `useGuidSend.handleSend`. One hook point.
- **Reuse pieces present:** `OpenAIRotatingClient.createEmbedding()`; the `contextCompactionService` direct-provider DI pattern; `DocumentConverter.wordToMarkdown/excelToMarkdown` (ArrayBuffer→markdown; no PDF); embedding-capability detection `hasSpecificModelCapability(provider, model, 'embedding')`; the `builtinMcp/*.ts` → `scripts/build-mcp-servers.js` (esbuild) → `out/main/builtin-mcp-*.js` build path; storage resolver `path.join(cacheDir, STORAGE_PATH.<name>)`; `ForgeProject.{ id, workspace }` as the stable per-project key.

---

## 2. Architecture

Three cooperating pieces, split by process:

```
                 Renderer (Project Home)                 Main process                     Subprocess (per project chat)
┌──────────────────────────────────┐   ┌────────────────────────────────────┐   ┌────────────────────────────────┐
│ ProjectKnowledgeCard             │   │ projectKnowledgeService            │   │ builtin-mcp-knowledge.js       │
│  useProjectKnowledge(projectId)  │──▶│  ingest / list / remove / retry    │   │  (read-only search server)     │
│  add / list / remove / retry     │   │  buildSessionMcpServer(projectId)  │   │  reads AIONUI_KB_* env         │
│                                  │   │  ↳ owns the on-disk store          │   │  BM25 + cosine → RRF           │
│ useGuidSend.handleSend           │──▶│  getSessionMcpServer → descriptor  │──▶│  search_project_knowledge tool │
│  (attach when projectId set)     │   │                                    │   │                                │
└──────────────────────────────────┘   └────────────────────────────────────┘   └────────────────────────────────┘
                                                     │ reads/writes
                                                     ▼
                                   <cacheDir>/project-kb/<projectId>/   (the store)
```

### On-disk store (app-managed, per project)

`getProjectKbDir(projectId) = path.join(cacheDir, STORAGE_PATH.projectKb, projectId)` — new `STORAGE_PATH.projectKb = 'project-kb'`, resolver added to `initStorage.ts` beside `getAssistantsDir`/`getSkillsDir`.

```
<cacheDir>/project-kb/<projectId>/
  sources/<sourceId>/
    original.<ext>          # copy of the added file (curated snapshot)
    converted.md            # DocumentConverter output (for docx/xlsx); == original for md/txt
  index/
    chunks.json             # [{ chunkId, sourceId, chunkIndex, text, headingPath?, hasVector }]
    bm25.json               # inverted index + doc lengths + df/idf stats
    vectors.bin             # Float32 chunk embeddings, row-aligned to chunks.json (vector rows only)
    vectors.meta.json       # { dim, rowChunkIds: string[] } — maps vectors.bin rows → chunkIds
  manifest.json             # see below
```

`manifest.json`:
```jsonc
{
  "schemaVersion": 1,
  "projectId": "…",
  "embedding": { "model": "text-embedding-3-small", "dim": 1536 } | null,  // pinned at first embed; null = BM25-only
  "sources": [
    { "id": "…", "fileName": "hr-onboarding.docx", "contentHash": "sha256:…",
      "byteSize": 84213, "status": "ready", "chunkCount": 12, "vectorCount": 12,
      "addedAt": 1690000000000, "error": null }
  ]
}
```

### B-ready seam (path B swap surface)

Two contracts are frozen so an AionCore-native engine can replace the TS pieces without touching callers:
1. **The tool contract** — `search_project_knowledge` name, input, and result rendering (§4).
2. **The store format** — the directory layout + `manifest.json` above.

Everything else (chunker, BM25, embed, RRF, the subprocess) is internal and replaceable.

---

## 3. Ingestion (main process)

`projectKnowledgeService.ingest(projectId, filePaths[])`, runs in main, **background + non-blocking**, serialized per project (a simple per-project promise queue/lock so writes never interleave).

**Pipeline per file:**
1. **Validate & snapshot.** Reject unsupported types at add time (see §7). Compute `contentHash` (sha256). If a source with the same hash exists → no-op (dedupe). Copy the file into `sources/<sourceId>/original.<ext>`.
2. **Convert to markdown.** `.md`/`.txt` → as-is; `.docx` → `documentConverter.wordToMarkdown(buf)`; `.xlsx` → `documentConverter.excelToMarkdown(buf)`; `.pdf` → gated (see §7). Write `converted.md`.
3. **Chunk.** Split into ~500–1000-token chunks with ~15% overlap, preferring heading/paragraph boundaries; capture a `headingPath` breadcrumb (e.g. `"Onboarding > Visa letters"`) when markdown headings are present. Token estimate via a lightweight char/token heuristic (no tokenizer dependency in v1).
4. **BM25 index (first pass, immediate).** Tokenize + add chunks to the inverted index. Source becomes **searchable via BM25 as soon as this completes** — status `ready`.
5. **Embed (second pass, non-blocking).** Select the embedding provider/model (§5). Batch-embed chunks via `OpenAIRotatingClient.createEmbedding`; append rows to `vectors.bin` + `vectors.meta.json`; set `hasVector` on each chunk. If embedding fails (no provider / auth / rate-limit / network), the source **stays `ready`** (BM25-only); `vectorCount < chunkCount` signals "re-embed available".
6. **Persist manifest**; emit `projectKnowledge.updated`.

**Hash-incremental.** Re-adding an unchanged file (same hash) is a no-op. A changed file (new hash, same path/name) re-ingests that one source and replaces its chunks/vectors. Removing a source deletes its `sources/<id>/` dir and its chunk/vector rows, then rewrites `chunks.json`/`bm25.json`/`vectors.*`.

**Rebuild.** `manifest.schemaVersion` mismatch or a corrupt/partial index → rebuild the whole `index/` from the retained `sources/*/converted.md` without re-downloading anything.

---

## 4. Retrieval tool contract — `search_project_knowledge`

The knowledge subprocess (`builtin-mcp-knowledge.js`) is a lean, **read-only** MCP stdio server modeled on `visionServer.ts`. It reads its target store + embed config from env, exposes exactly one tool.

### Env (set per conversation by the descriptor builder, §5)
```
AIONUI_KB_PROJECT_ID     required
AIONUI_KB_STORE_DIR      required — absolute path to <cacheDir>/project-kb/<projectId>
AIONUI_KB_EMBED_BASE_URL optional — omitted ⇒ BM25-only at query time
AIONUI_KB_EMBED_API_KEY  optional
AIONUI_KB_EMBED_MODEL    optional — MUST equal manifest.embedding.model (one vector space)
```

### Tool description (teaches the agent *when* to call)
> "Search this project's curated knowledge base — documents the user deliberately added to the project — for passages relevant to a question. Call this whenever the request may depend on project-specific facts, files, specs, policies, or prior decisions you don't already know. Returns the most relevant passages with their source filenames so you can cite them."

### Input
```ts
{
  query: string,          // required — natural-language question or keywords
  max_results?: number,   // optional — default 6, clamped to 1..20
}
```
No filters in v1 (YAGNI).

### Internal result type (B-ready seam)
```ts
type KnowledgeHit = {
  sourceId: string;
  sourceName: string;    // original filename → the citation
  chunkIndex: number;
  text: string;          // full chunk text (payload-capped across all hits)
  score: number;         // fused RRF score
  headingPath?: string;  // optional location hint
};
```

### Hybrid merge — Reciprocal Rank Fusion
- Run **BM25 top-K** and **semantic top-K** (query embedding vs. `vectors.bin`, cosine over a linear scan — fine for a curated set of hundreds–low-thousands of chunks) in parallel; K ≈ 30 each.
- Fuse: `score(chunk) = Σ_lists 1/(RRF_K + rank_in_list)` with `RRF_K = 60`. No score normalization needed (BM25 vs. cosine aren't comparable).
- **Clean degrade:** no embed env, or `manifest.embedding == null`, or a query-embed error ⇒ the semantic list is empty ⇒ fusion is exactly the BM25 ranking.
- Return the top `max_results` after fusion, deduped by `chunkId`.

### Output rendering (MCP `content`)
```
Found 3 passage(s) in the project knowledge base for "visa letter process":

[1] hr-onboarding.docx — Onboarding > Visa letters
<chunk text…>

[2] policy-2025.md
<chunk text…>
```
- **Empty** → `No relevant passages found in the project knowledge base for "<query>".` (agent falls back rather than hallucinating).
- **Store missing/unreadable** → `{ isError: true }` + `Project knowledge base is unavailable.` (agent proceeds without it).
- **Payload cap** ≈ 12k chars total; if fused hits exceed it, drop lowest-ranked and append `(N more passage(s) omitted.)`.

The subprocess loads the store once and caches it in-process for the session's lifetime.

---

## 5. Project-scoped auto-attach (main + one renderer hook)

### Descriptor builder (main)
`projectKnowledgeService.getSessionMcpServer(projectId): ISessionMcpServer | null`:
- Read `manifest.json`. **If no source has `status: "ready"` → return `null`** (don't attach an empty KB; keeps ordinary project chats clean).
- Resolve the query-embed config from the **manifest-pinned** `embedding.model` (find the configured provider whose `models` include it; supply its `base_url`/`api_key`). If it can't be resolved → omit the embed env (BM25-only), index still queryable.
- Return:
```ts
{
  id: `project-kb-${projectId}`,
  name: 'aionui-project-knowledge',
  transport: {
    type: 'stdio',
    command: 'node',
    args: [getBuiltinMcpScriptPath('builtin-mcp-knowledge')],
    env: { AIONUI_KB_PROJECT_ID, AIONUI_KB_STORE_DIR, AIONUI_KB_EMBED_* },
  },
}
```

### Embedding provider/model selection (auto-detect + manifest-pin)
At **first embed** for a project, pick the first configured provider that has a model where `hasSpecificModelCapability(provider, model, 'embedding') === true`; **pin that model id into `manifest.embedding`**. Ingestion and query embedding then always use that same model → one consistent vector space. Changing the pinned model requires a rebuild (re-embed). No new settings UI in v1. No embedding-capable provider anywhere ⇒ `manifest.embedding = null` ⇒ BM25-only.

### The single renderer hook (`useGuidSend.handleSend`)
```ts
// projectId already resolved in this hook
const kb = projectId
  ? await ipcBridge.projectKnowledge.getSessionMcpServer.invoke(projectId).catch(() => null)
  : null;
```
Append `kb` (when non-null) to `selected_session_mcp_servers` in **both** the `acp` and `aionrs` `conversation.create` calls. Do **not** add it to `mcp_ids`/`selected_mcp_server_ids` (those reference MCP-repo rows; the KB server is a pure session server). Dedupe by `name` defensively. `ProjectNewChatComposer` is untouched (it reuses this hook).

**Why this is the whole story:** the server never registers in the MCP repo and is never `enabled`, so it's invisible to the picker and absent from every non-project chat; AionCore spawns it per-conversation with the project's `env`; frozen-at-creation means later KB edits show up only in new chats — exactly the v1 boundary.

### IPC surface (`ipcBridge.projectKnowledge.*`, all main-owned, camelCase)
| Binding | Signature | Notes |
| --- | --- | --- |
| `listSources` | `(projectId) → { sources: KnowledgeSource[], summary }` | card data |
| `addSources` | `(projectId, filePaths[]) → void` | async ingestion; emits updates |
| `removeSource` | `(projectId, sourceId) → void` | deletes snapshot + rows |
| `retrySource` | `(projectId, sourceId) → void` | re-embed / re-ingest a failed source |
| `getSessionMcpServer` | `(projectId) → ISessionMcpServer \| null` | descriptor builder above |

`summary = { fileCount, chunkCount, semantic: 'on' | 'off' }`. **No snake_case-mapper hazard** — these are our own main-process handlers with no AionCore DTO round-trip, so casing is controlled end-to-end (a test still asserts the returned shape is camelCase, per project discipline).

---

## 6. Knowledge UI (Project Home)

New right-rail card **`ProjectKnowledgeCard`** (`renderer/pages/project/components/`), placed **above** `ProjectFilesCard`. Rail order: Instructions → **Knowledge** → Files. Mirrors `ProjectFilesCard` structure exactly: Arco `Card` with `title` + `extra` action, a data hook, and loading/error/empty/content states; UnoCSS utility classes + semantic tokens; `data-testid`s; Arco components only (`Card`, `Button`, `Spin`, `Alert`, `Tag`, `Popconfirm`) — no raw interactive HTML.

**Data hook** `useProjectKnowledge(projectId)` (shaped like `useProjectFiles`): `{ sources, summary, loading, error, addSources, removeSource, retrySource, refetch }`. Subscribes to the main→renderer `projectKnowledge.updated` push (via the existing `emitter`, mirroring `chat.history.refresh`) and refetches; also refetches on mount and after add/remove. While any source is `indexing`, the card shows in-progress affordances.

**Card contents:**
- **Title** `conversation.projectHome.knowledge` + **`extra` "Add files"** → `dialog.showOpen` (multi-select, filtered to supported extensions) → `addSources`.
- **Source rows:** type icon + filename + status `Tag`: `indexing` (spinner) / `ready` (`"12 passages"`) / `failed` (reason via tooltip + a retry `Button`) / `unsupported`. Per-row remove via `Popconfirm` → `removeSource`.
- **Summary line:** `"3 files · 47 passages · semantic on"`, or `"semantic off — no embedding model configured"` (surfaces the §5 degrade state).
- **Empty state:** "Add documents to build this project's knowledge base. The assistant searches them automatically in every project chat." + Add button.
- **Error state:** `Alert` (store unreadable) with a rebuild action.

**i18n:** new `conversation.projectHome.knowledge*` keys authored in English and added across all 12 locales; `scripts/check-i18n.js` + `bun run i18n:types` must pass.

**`KnowledgeSource` DTO:** `{ id, fileName, byteSize, status: 'indexing'|'ready'|'failed'|'unsupported', chunkCount, addedAt, error? }`.

---

## 7. Errors & edge cases

| Case | Handling |
| --- | --- |
| No embedding provider configured | `manifest.embedding = null`; BM25-only; UI "semantic off"; retrieval still works (RRF ⇒ BM25 ranking). |
| Embedding fails mid-ingestion | Non-blocking: source stays `ready` (BM25-only), `vectorCount < chunkCount`; `retrySource` re-embeds. |
| Unsupported file type | Rejected at add with a clear message; no source created. Supported v1: `.md`, `.txt`, `.docx`, `.xlsx`. |
| PDF | Gated on a text-extraction lib. If none is added in v1, `.pdf` is **unsupported** with an explicit message. (Decision point for the plan: add a lib vs. defer — default **defer**.) |
| Large file | Per-file size cap (skip/warn beyond a threshold) and a max-chunks-per-source cap; truncate with a note in the source's status. |
| Duplicate add | Dedupe by `contentHash`; unchanged re-add = no-op; changed = re-ingest that source. |
| File edited/deleted on disk after adding | Unaffected — we index the copied snapshot in `sources/`. |
| Corrupt / schema-drift index | Rebuild `index/` from retained `converted.md`; `manifest.schemaVersion` gates. |
| Concurrent ingestion | Per-project serialization (lock/queue). |
| Store missing at query time | Subprocess returns `isError` "unavailable"; chat proceeds. |
| Project deleted | Delete `<cacheDir>/project-kb/<projectId>/` on project removal. (If a delete hook isn't available, an orphaned dir is harmless — cleaned on rebuild/GC; noted as minor.) |
| Empty/whitespace query | Graceful "no results". |
| Oversized result payload | Char cap + "(N more omitted)". |
| Embed API key in subprocess env | Accepted (mirrors `AIONUI_VISION_*`/`greennode-idp`); never logged. |

---

## 8. Testing (Vitest 4; project target ≥ 80%)

**Unit (pure cores):**
- Chunker — size/overlap, heading-path capture, tiny/huge/no-heading docs.
- BM25 — tokenize/index/score + ranking on a fixed corpus.
- RRF merge — correct fusion, dedupe, single-list degrade.
- Embedding-provider picker — selects expected provider/model via `hasSpecificModelCapability`; none → `null`.
- Descriptor builder — correct `ISessionMcpServer` (env keys, script path); **`null` when no `ready` source**; embed env omitted when pinned model unresolved.
- Result formatter — `KnowledgeHit[]` → MCP text (citations, empty, truncation).
- Manifest + hash-incremental — unchanged=skip, changed=reindex, remove=cleanup.

**Integration:**
- Ingestion end-to-end on a temp store — `.md` + `.docx` → snapshot copied, chunks/BM25/vectors written, manifest correct; remove cleans up.
- Knowledge MCP server — spawn against a temp `AIONUI_KB_STORE_DIR`; `search_project_knowledge` returns a relevant chunk + citation; BM25-only mode (no embed env) still returns; missing store → `isError`.
- `useGuidSend` attach — with `projectId` + a mocked ready descriptor, the KB session server appears in `selected_session_mcp_servers` and **not** in `mcp_ids`; no `projectId` → absent; `null` descriptor (empty index) → absent.
- IPC round-trips — `listSources`/`addSources`/`removeSource`/`retrySource`; assert **camelCase** returned shape.

**Renderer:** `ProjectKnowledgeCard` states (loading/empty/list/error), add/remove/retry interactions (mocked IPC), status-`Tag` rendering, refetch on the `projectKnowledge.updated` event.

**i18n:** `check-i18n.js` passes across 12 locales.

---

## 9. Scope & non-goals

**In (v1):** desktop project chats; curated file **add / list / remove / retry**; hybrid BM25 + embeddings with clean degrade; auto-attached `search_project_knowledge`; index-status UI on Project Home.

**Out (explicit non-goals):**
- Non-project chats, and channel / WebUI / cron / specialized-assistant chats (MCP attaches differently there; tools frozen at creation).
- Whole-workspace auto-indexing (curated only).
- Re-indexing **already-open** chats when the KB changes (frozen-at-creation ⇒ new chats only).
- Cross-device / synced index (per-install).
- A `list_project_knowledge` tool, reranker models, a citation-chip UI, PDF OCR — future.
- An AionCore-native retrieval engine (path B — seam kept ready, not built).
- In-app editing/versioning of knowledge files (add/remove only; an edit = remove + re-add).

---

## 10. Module inventory (created / changed)

**New — main process (`packages/desktop/src/process/`):**
- `resources/builtinMcp/knowledgeServer.ts` — the read-only MCP search server (RRF over BM25 + cosine).
- `services/projectKnowledge/` — `projectKnowledgeService.ts` (ingest/list/remove/retry/getSessionMcpServer), `chunker.ts`, `bm25.ts`, `rrf.ts`, `store.ts` (manifest + index read/write), `embedProvider.ts` (picker + `createEmbedding` wrapper). *(Shared pure pieces — `bm25.ts`, `rrf.ts`, `chunker.ts` — live where both the service and the subprocess can import them; keep them dependency-light so esbuild can bundle the subprocess.)*
- `initStorage.ts` — add `STORAGE_PATH.projectKb` + `getProjectKbDir(projectId)`.
- `scripts/build-mcp-servers.js` — add the `builtin-mcp-knowledge` esbuild entry.

**New — renderer (`packages/desktop/src/renderer/pages/project/`):**
- `components/ProjectKnowledgeCard.tsx` (+ `.module.css` if needed).
- `hooks/useProjectKnowledge.ts`.

**Changed:**
- `common/adapter/ipcBridge.ts` (+ main handler registration) — the `projectKnowledge.*` bindings + `ISessionMcpServer`/`KnowledgeSource` types.
- `renderer/pages/guid/hooks/useGuidSend.ts` — the ~6-line attach hook (both create calls).
- `renderer/pages/project/ProjectHomePage.tsx` — render `ProjectKnowledgeCard` in the rail.
- `common/config/i18n` + `locales/` — `conversation.projectHome.knowledge*` keys (12 locales).
- Project-delete path — best-effort store cleanup.

**Reused unchanged:** `DocumentConverter`, `OpenAIRotatingClient.createEmbedding`, `hasSpecificModelCapability`, the `emitter` push pattern, the `ProjectFilesCard` card pattern, `getBuiltinMcpScriptPath`.

---

## 11. Open decisions for the plan

1. **PDF** — add a text-extraction lib now, or defer (mark `.pdf` unsupported)? **Default: defer.**
2. **BM25** — minimal in-repo implementation vs. a small vendored dependency in the bundled subprocess. **Default: in-repo** (≈100 lines, no new runtime dep, keeps the esbuild bundle self-contained).
3. **Per-file size / max-chunks caps** — pick concrete thresholds during planning.
