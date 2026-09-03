# Knowledge Base Follow-ups — Coordination & Handoff

**Date:** 2026-07-28
**Purpose:** Hand off three parallel work streams to fresh implementation sessions.
**Context:** MR !5 (`feat/project-knowledge-base` → `sprint1`) is **open, not merged**. It shipped the per-project knowledge base: hybrid BM25 + embedding retrieval exposed to project chats via an auto-attached `search_project_knowledge` MCP tool. Smoke-tested end to end in the dev app.

Read this file first. Each stream then has its own design doc.

---

## 1. The streams

| Stream | Scope | Design doc | Base branch |
| --- | --- | --- | --- |
| **A — PDF ingestion** | text-layer PDFs via `pdfjs-dist` + scanned PDFs via GreenNode IDP OCR, with page caps, per-source progress, partial-progress persistence | `2026-07-28-kb-pdf-ingestion-design.md` | `feat/project-knowledge-base` |
| **B — Eval harness** | measurable retrieval quality; Vietnamese + English fixture | `2026-07-28-kb-eval-harness-design.md` | `feat/project-knowledge-base` |
| **C — Persona-absorption fix** | relabel the injected-context wrapper so user profile text stops being read as the assistant's identity | inline in §4 below | `sprint1` |

**These three are safe to run concurrently.** Everything else in the backlog is not — see §3.

## 2. Why only three

File-footprint analysis. Streams A, and the deferred items 3/4/5, all mutate the same two files:

- `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts`
- `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx` (+ 12 locale files)

Running them together produces merge conflicts, not throughput. Stream B is near-isolated (new fixture + runner; `searchCore` already exposes a programmatic entry point). Stream C touches an unrelated subsystem entirely.

**File ownership while the streams are live:**

| File | Owner |
| --- | --- |
| `projectKnowledgeService.ts` | **Stream A exclusively** |
| `ProjectKnowledgeCard.tsx` + `locales/*/conversation.json` | **Stream A exclusively** |
| `knowledgeServer.ts`, `searchCore.ts` | read-only for A and B |
| new `tests/eval/**` | **Stream B exclusively** |
| `resolveInjectedContext.ts` (+ its test) | **Stream C exclusively** |

If a stream needs to touch a file it doesn't own, stop and coordinate rather than editing.

## 3. Deferred — queue behind Stream A

Do **not** start these concurrently; they collide with A.

1. **Auto-embed backfill / "Embed all"** — when an embedding model first becomes available, embed every BM25-only source. Strongly evidence-backed: during the 2026-07-28 smoke test the user configured the model *after* indexing, and the only recovery was remove-and-re-add. Every first-time user hits this ordering. **Best folded into Stream A's branch**, since it touches the same ingestion code.
2. **Stop persisting the user's provider API key** in conversation extras (short-lived token, or have the subprocess fetch from main at startup). Currently at parity with the vision/idp/image-gen servers, but those carry vendor-scoped keys and this is the user's own general provider key.
3. **Embedding provider-id pinning + dimension check** — the manifest pins a model *name* only; a provider edit can silently swap embedding spaces when dimensions coincide.
4. **UX**: actionable "semantic off" (link to model settings), stale-chat hint when knowledge changes mid-conversation, citation click-through, a tooltip explaining "passages".
5. **Reranker** (`qwen/qwen3-reranker-8b`, already on the VNG MaaS endpoint) — deliberately demoted. At the current corpus size, top-K already exceeds the whole corpus, so there is no reordering headroom and no measurable delta. Revisit **after** Stream A grows corpora and Stream B can measure it.

## 4. Stream C — full spec (small enough to inline)

**Problem, observed live.** `packages/desktop/src/common/chat/buildInjectedContext.ts` renders each layer as `[{label}]\n{text}`. `resolveInjectedContext.ts` passes `label: 'Your instructions'` for the global per-user context. Users write that field in the first person about *themselves* — the Profile page invites exactly that. Result observed on 2026-07-28: a user profile reading *"I am a Head of AI Product at VNG… my role is under the office of Digital Transformation"* produced an assistant that introduced itself as *"the Head of AI Product under the Digital Transformation office."* The model adopted the user's identity as its own persona.

Confirmed from a prompt dump — the entire system prompt for that chat was 446 bytes and consisted solely of this block, so there is no other candidate source.

**Fix.** Change the label so it describes *whose* information this is. The field legitimately holds a mix of self-description ("I work with HR and Legal") and preferences ("always answer in Vietnamese"), so the label must accommodate both without implying the assistant's identity. Suggested: `About the user you are helping`.

Leave the project layer's label (`Project: {name}`) unchanged — it is already unambiguous.

**Files:** `packages/desktop/src/renderer/pages/guid/hooks/resolveInjectedContext.ts` and its existing test (`buildInjectedContext.test.ts` covers the builder; check whether a resolve-level test asserts the literal label).

**Tests:** update any assertion on the old literal; add one asserting the new label wraps the global tier. Do **not** change `buildInjectedContext` itself — it is a generic label/text joiner and is correct as written.

**Verification.** Unit tests are necessary but not sufficient, because the bug is behavioural. Verify in the dev app: set a first-person Profile context, start a chat, and confirm the assistant no longer introduces itself as the user. AionCore's `dump_prompts` feature writes the assembled prompt to `<dataDir>/prompt-dumps` — that is ground truth for what actually reached the model.

**Scope guard:** this is a labelling fix. It is *not* the place to redesign the two-tier context feature.

## 5. Branch and worktree setup

Decision taken: **stack on the unmerged branch now** rather than wait for !5 to merge. Accepted cost: if review changes !5, streams A and B rebase. !5 is self-contained and already passed two review rounds plus a live smoke test, so churn is unlikely.

Per the repo's shared-working-tree hazard, **each stream gets its own git worktree** — never share a HEAD.

```bash
# Stream A
git -C /Users/lap16603/Projects/WePrompt worktree add \
  /Users/lap16603/Projects/WePrompt-kb-pdf \
  -b feat/kb-pdf-ingestion origin/feat/project-knowledge-base

# Stream B
git -C /Users/lap16603/Projects/WePrompt worktree add \
  /Users/lap16603/Projects/WePrompt-kb-eval \
  -b feat/kb-eval-harness origin/feat/project-knowledge-base

# Stream C
git -C /Users/lap16603/Projects/WePrompt worktree add \
  /Users/lap16603/Projects/WePrompt-persona \
  -b fix/injected-context-label origin/sprint1
```

Then `bun install` in each (worktrees do not share `node_modules`).

**MR targets:** A and B target `feat/project-knowledge-base` if !5 is still open when they finish (keeping the stack intact), or `sprint1` once !5 merges. C targets `sprint1` directly and can merge independently.

## 6. Ground rules for every stream

Carried from the KB build; these were all earned the hard way.

- **Never `git stash`** — the stash stack is shared across worktrees and other sessions. Use a temporary WIP commit.
- **`docs/superpowers/` is gitignored.** Never force-add these docs.
- **No AI signatures** in commits (no `Co-Authored-By`, no "Generated with"). Conventional Commits.
- **New files start with the Apache-2.0 `/** @license */` header.** No `// path/to/file` first-line comment.
- **TypeScript reality check:** the root `tsconfig.json` sets only `noImplicitAny` — **not** full `strict`, and `strictNullChecks` is off. Nullability bugs will not surface as compile errors. Do not rely on the compiler for null safety. Expect to add explicit return annotations on some `.then()`/`.catch()` callbacks (TS7011).
- **Lint baseline is 847 warnings, 0 errors.** Judge by errors and exit code, not warning volume.
- **`bunx oxfmt <files>` scoped** — never repo-wide `bun run format` mid-stream.
- **Any new `bridge.buildProvider` IPC channel** must also be added to `NATIVE_BRIDGE_PROVIDER_KEYS` (`common/adapter/native/constants.ts`) **and** given a Zod entry in `nativeBridgePayloadSchemas`, or `common/adapter/main.ts` rejects it at runtime with "operation is not allowed". Unit tests will not catch this; only the full suite does. Also add a `vi.mock` in `tests/unit/process/contextCompactionBridge.test.ts`, which mocks every sibling bridge init.
- **`identifierSchema` in the payload schemas has no charset restriction.** Anything interpolated into a filesystem path needs the local `safeIdSchema` pattern plus a `path.resolve` containment check.
- **Run the full suite before claiming done** — `bun run test`. There is a known ~2-test intermittent flake; re-run once to distinguish it from a real failure.
- **The full gate is `just push`** (lint-strict → fmt-check → typecheck → i18n-check → test). Do not push without explicit user approval.

## 7. Useful environment facts

- **Store location:** `~/.aionui-config-dev/project-kb/<projectId>/` in dev — this is `cacheDir` (`getConfigPath()`), **not** the Forge-Dev app-data dir. Easy to waste time looking in the wrong place.
- **Dev launch:** `bun run dev` from the stream's own worktree. Confirm vite takes `:5173`; if it lands on `:5174` another dev server is running and the window will be pinned to a stale bundle.
- **Only one dev app at a time** — instances share the Forge-Dev SQLite DB.
- **MCP bundles rebuild automatically** in dev via `buildMcpServersPlugin` (`closeBundle` → `scripts/build-mcp-servers.js`). A new conversation picks up a rebuilt subprocess without restarting the app.
- **The provider on this machine** is VNG MaaS (`https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1`), serving 38 models including `baai/bge-m3` (embeddings, auto-picked, good for Vietnamese), `qwen/qwen3-embedding-8b`, `openai/text-embedding-3-large`, and `qwen/qwen3-reranker-8b`.
- **`PUT /api/providers/{id}`** accepts a partial update — and **echoes the API key in plaintext** in its response. Avoid dumping that response into logs or transcripts.
- **Inspecting a live MCP server** is easy and worth doing: pipe `initialize` + `tools/list` JSON-RPC lines into `node out/main/builtin-mcp-<name>.js` with the right env, and read what the model actually sees.

## 8. The single most important lesson from the KB build

Every layer of unit testing and two rounds of subagent review passed — and the feature still did nothing useful on first real use, because the agent read the tool description, assumed "project" meant the working directory, ran `grep`, found nothing, and asked the user to paste the document.

**A tool that is perfectly wired but unconvincing to the model is indistinguishable from a broken one.** For any stream that changes what the agent sees:

- Say plainly what the built-in tools *cannot* reach.
- Name the actual content (listing attached filenames in the tool description was the decisive fix).
- Verify by reading the live `tools/list` output, not the source.
- Then confirm in a real chat that the model actually calls it.
