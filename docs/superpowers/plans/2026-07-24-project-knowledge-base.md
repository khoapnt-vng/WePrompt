# Per-Project Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users add files to a project's knowledge base; every conversation started in that project gets an auto-attached `search_project_knowledge` MCP tool that retrieves relevant passages via hybrid BM25 + embedding search.

**Architecture:** Pure retrieval cores (chunker/BM25/RRF/embed/store) live in `common/knowledge/` so both the main-process ingestion service and the esbuild-bundled MCP subprocess share them. Main owns the per-project store (`<cacheDir>/project-kb/<projectId>/`) and exposes `ipcBridge.projectKnowledge.*`; the renderer adds a Knowledge card to Project Home and a ~10-line attach hook in `useGuidSend` that injects a **pure session MCP server** (full stdio transport with `AIONUI_KB_*` env) into `extra.selected_session_mcp_servers` — AionCore spawns it per-conversation; no backend change.

**Tech Stack:** TypeScript strict, Vitest 4, `@modelcontextprotocol/sdk` + `zod` (already deps — **zero new npm packages**), esbuild via `scripts/build-mcp-servers.js`, Arco + UnoCSS for UI, i18n across 12 locales.

**Worktree:** `/Users/lap16603/Projects/WePrompt-projectkb`, branch `feat/project-knowledge-base` (off `origin/sprint1`). Run all commands from this directory.

**Spec:** `docs/superpowers/specs/2026-07-24-project-knowledge-base-design.md` (gitignored, local). Locked constants (spec §11 defaults resolved): PDF **deferred** (unsupported); BM25 **in-repo**; per-file cap **15 MB**; max **2,000 chunks/source**; payload cap **12,000 chars**; `max_results` default 6 clamp 1..20; BM25/vector top-K 30 each; RRF k=60; chunks ~3,200 chars with 400-char overlap; embed batch 32.

**Conscious deviation from spec wording:** ingestion embeds via a shared `embedCore.ts` (plain `fetch`, injected `fetchImpl` — the `visionCore.ts` pattern) instead of `OpenAIRotatingClient.createEmbedding`, so main and the subprocess share ONE embed path and the esbuild bundle stays lean. `OpenAIRotatingClient` is untouched.

**Commit rule (AGENTS.md):** Conventional Commits, **NEVER add AI signatures** (no Co-Authored-By / Generated-with lines).

**Verify environment before Task 1:** `git -C /Users/lap16603/Projects/WePrompt-projectkb branch --show-current` → `feat/project-knowledge-base`; `bun install` already done (if `bun run test tests/unit/renderer/useGuidSend.dom.test.ts` fails on missing deps, run `bun install` first).

---

## File map (whole feature)

| Path | Role |
| --- | --- |
| `packages/desktop/src/common/knowledge/types.ts` | Chunk/hit/manifest/index types (Node-free) |
| `packages/desktop/src/common/knowledge/store.ts` | Store layout + manifest/chunks/bm25/vectors read-write (Node fs; main + subprocess only) |
| `packages/desktop/src/common/knowledge/chunker.ts` | Markdown → chunks with heading paths |
| `packages/desktop/src/common/knowledge/bm25.ts` | Tokenizer (unicode + CJK bigrams), BM25 build/search |
| `packages/desktop/src/common/knowledge/rrf.ts` | Reciprocal Rank Fusion |
| `packages/desktop/src/common/knowledge/embedCore.ts` | OpenAI-compatible `/embeddings` via fetch + cosine |
| `packages/desktop/src/common/knowledge/searchCore.ts` | Load store, hybrid search, MCP text formatting |
| `packages/desktop/src/common/types/project/knowledgeTypes.ts` | Renderer-safe DTOs (`IKnowledgeSourceDto`, summary) |
| `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts` | Thin stdio MCP entry (mirrors `visionServer.ts`) |
| `packages/desktop/src/process/services/projectKnowledge/embedProviderPicker.ts` | Pick embedding provider/model from configured providers |
| `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts` | Ingestion queue, list/add/remove/retry, session-server descriptor |
| `packages/desktop/src/process/bridge/projectKnowledgeBridge.ts` | `initProjectKnowledgeBridge()` glue |
| `packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts` | Card data hook |
| `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx` | The Knowledge card |
| Modified: `common/adapter/ipcBridge.ts`, `process/bridge/index.ts`, `process/utils/initStorage.ts`, `scripts/build-mcp-servers.js`, `renderer/pages/guid/hooks/useGuidSend.ts`, `renderer/pages/project/ProjectHomePage.tsx`, `renderer/pages/project/components/ProjectHeader.tsx`, `renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts`, 12× `renderer/services/i18n/locales/*/conversation.json` | |

Tests mirror: `tests/unit/knowledge/*.test.ts`, `tests/unit/renderer/*.dom.test.ts(x)`.

---

### Task 1: Knowledge types + on-disk store module

**Files:**
- Create: `packages/desktop/src/common/knowledge/types.ts`
- Create: `packages/desktop/src/common/knowledge/store.ts`
- Test: `tests/unit/knowledge/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/knowledge/store.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KnowledgeChunk, KnowledgeManifest } from '@/common/knowledge/types';
import {
  createEmptyManifest,
  readBm25,
  readChunks,
  readManifest,
  readVectors,
  writeBm25,
  writeChunks,
  writeManifest,
  writeVectors,
} from '@/common/knowledge/store';

describe('knowledge store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kb-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the store does not exist', async () => {
    expect(await readManifest(path.join(dir, 'nope'))).toBeNull();
    expect(await readChunks(path.join(dir, 'nope'))).toEqual([]);
    expect(await readVectors(path.join(dir, 'nope'))).toBeNull();
  });

  it('round-trips the manifest', async () => {
    const manifest: KnowledgeManifest = createEmptyManifest('proj-1');
    manifest.embedding = { model: 'text-embedding-3-small', dim: 4 };
    manifest.sources.push({
      id: 'abc123',
      fileName: 'notes.md',
      contentHash: 'sha256:deadbeef',
      byteSize: 42,
      status: 'ready',
      chunkCount: 2,
      vectorCount: 2,
      addedAt: 1700000000000,
      error: null,
    });
    await writeManifest(dir, manifest);
    expect(await readManifest(dir)).toEqual(manifest);
  });

  it('round-trips chunks and bm25 index', async () => {
    const chunks: KnowledgeChunk[] = [
      { chunkId: 'abc123#0', sourceId: 'abc123', chunkIndex: 0, text: 'hello world', hasVector: false },
      { chunkId: 'abc123#1', sourceId: 'abc123', chunkIndex: 1, text: 'goodbye', headingPath: 'A > B', hasVector: true },
    ];
    await writeChunks(dir, chunks);
    expect(await readChunks(dir)).toEqual(chunks);

    const bm25 = { totalDocs: 2, avgDocLen: 1.5, docLens: { 'abc123#0': 2, 'abc123#1': 1 }, postings: { hello: [['abc123#0', 1]] } };
    await writeBm25(dir, bm25 as never);
    expect(await readBm25(dir)).toEqual(bm25);
  });

  it('round-trips vectors as Float32 rows keyed by chunkId', async () => {
    const rows: Array<[string, Float32Array]> = [
      ['abc123#0', new Float32Array([0.1, 0.2, 0.3, 0.4])],
      ['abc123#1', new Float32Array([1, 0, 0, 0])],
    ];
    await writeVectors(dir, 4, rows);
    const loaded = await readVectors(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.dim).toBe(4);
    expect([...loaded!.rows.keys()]).toEqual(['abc123#0', 'abc123#1']);
    expect(Array.from(loaded!.rows.get('abc123#0')!)).toEqual([0.10000000149011612, 0.20000000298023224, 0.30000001192092896, 0.4000000059604645]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/store.test.ts`
Expected: FAIL — cannot resolve `@/common/knowledge/types` / `@/common/knowledge/store`.

- [ ] **Step 3: Implement types.ts**

```ts
// packages/desktop/src/common/knowledge/types.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared types for the per-project knowledge base. Node-free: safe to import
// from renderer type positions, though runtime knowledge modules (store,
// searchCore, …) are main-process/subprocess only.

export type KnowledgeSourceStatus = 'indexing' | 'ready' | 'failed' | 'unsupported';

export type KnowledgeChunk = {
  chunkId: string; // `${sourceId}#${chunkIndex}`
  sourceId: string;
  chunkIndex: number;
  text: string;
  headingPath?: string; // "Onboarding > Visa letters"
  hasVector: boolean;
};

export type KnowledgeHit = {
  sourceId: string;
  sourceName: string;
  chunkIndex: number;
  text: string;
  score: number;
  headingPath?: string;
};

export type KnowledgeManifestSource = {
  id: string;
  fileName: string;
  contentHash: string; // "sha256:<hex>"
  byteSize: number;
  status: KnowledgeSourceStatus;
  chunkCount: number;
  vectorCount: number;
  addedAt: number;
  error: string | null;
};

export type KnowledgeManifest = {
  schemaVersion: 1;
  projectId: string;
  /** Pinned at first successful embed; null = BM25-only. */
  embedding: { model: string; dim: number } | null;
  sources: KnowledgeManifestSource[];
};

export type Bm25Index = {
  totalDocs: number;
  avgDocLen: number;
  docLens: Record<string, number>;
  /** term -> [chunkId, termFrequency][] */
  postings: Record<string, Array<[string, number]>>;
};
```

- [ ] **Step 4: Implement store.ts**

```ts
// packages/desktop/src/common/knowledge/store.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// On-disk store for one project's knowledge base. This layout is the frozen
// "path B" seam (see the design spec): a future AionCore-native engine reads
// the same directory. Node-side only (main process + the knowledge MCP
// subprocess) — never import from renderer runtime code.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Bm25Index, KnowledgeChunk, KnowledgeManifest } from './types';

export const storePaths = (storeDir: string) => ({
  sourcesDir: path.join(storeDir, 'sources'),
  sourceDir: (sourceId: string) => path.join(storeDir, 'sources', sourceId),
  indexDir: path.join(storeDir, 'index'),
  chunksFile: path.join(storeDir, 'index', 'chunks.json'),
  bm25File: path.join(storeDir, 'index', 'bm25.json'),
  vectorsFile: path.join(storeDir, 'index', 'vectors.bin'),
  vectorsMetaFile: path.join(storeDir, 'index', 'vectors.meta.json'),
  manifestFile: path.join(storeDir, 'manifest.json'),
});

export const createEmptyManifest = (projectId: string): KnowledgeManifest => ({
  schemaVersion: 1,
  projectId,
  embedding: null,
  sources: [],
});

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

// Write to a temp sibling then rename, so a crash mid-write never leaves a
// truncated JSON file behind.
const writeFileAtomic = async (file: string, data: string | Uint8Array): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
};

export const readManifest = (storeDir: string): Promise<KnowledgeManifest | null> =>
  readJson<KnowledgeManifest>(storePaths(storeDir).manifestFile);

export const writeManifest = (storeDir: string, manifest: KnowledgeManifest): Promise<void> =>
  writeFileAtomic(storePaths(storeDir).manifestFile, JSON.stringify(manifest, null, 2));

export const readChunks = async (storeDir: string): Promise<KnowledgeChunk[]> =>
  (await readJson<KnowledgeChunk[]>(storePaths(storeDir).chunksFile)) ?? [];

export const writeChunks = (storeDir: string, chunks: KnowledgeChunk[]): Promise<void> =>
  writeFileAtomic(storePaths(storeDir).chunksFile, JSON.stringify(chunks));

export const readBm25 = (storeDir: string): Promise<Bm25Index | null> =>
  readJson<Bm25Index>(storePaths(storeDir).bm25File);

export const writeBm25 = (storeDir: string, index: Bm25Index): Promise<void> =>
  writeFileAtomic(storePaths(storeDir).bm25File, JSON.stringify(index));

export type KnowledgeVectors = { dim: number; rows: Map<string, Float32Array> };

export const readVectors = async (storeDir: string): Promise<KnowledgeVectors | null> => {
  const paths = storePaths(storeDir);
  const meta = await readJson<{ dim: number; rowChunkIds: string[] }>(paths.vectorsMetaFile);
  if (!meta || meta.dim <= 0) return null;
  let raw: Buffer;
  try {
    raw = await fs.readFile(paths.vectorsFile);
  } catch {
    return null;
  }
  const expected = meta.rowChunkIds.length * meta.dim * 4;
  if (raw.byteLength !== expected) return null; // corrupt — caller treats as no vectors
  const rows = new Map<string, Float32Array>();
  meta.rowChunkIds.forEach((chunkId, i) => {
    const offset = raw.byteOffset + i * meta.dim * 4;
    rows.set(chunkId, new Float32Array(raw.buffer.slice(offset, offset + meta.dim * 4)));
  });
  return { dim: meta.dim, rows };
};

export const writeVectors = async (storeDir: string, dim: number, rows: Array<[string, Float32Array]>): Promise<void> => {
  const paths = storePaths(storeDir);
  const buf = Buffer.alloc(rows.length * dim * 4);
  rows.forEach(([, vec], i) => {
    Buffer.from(vec.buffer, vec.byteOffset, dim * 4).copy(buf, i * dim * 4);
  });
  await writeFileAtomic(paths.vectorsFile, buf);
  await writeFileAtomic(paths.vectorsMetaFile, JSON.stringify({ dim, rowChunkIds: rows.map(([id]) => id) }));
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint, typecheck, commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/common/knowledge/types.ts packages/desktop/src/common/knowledge/store.ts tests/unit/knowledge/store.test.ts
git commit -m "feat(knowledge): add knowledge base types and on-disk store module"
```

---

### Task 2: Markdown chunker

**Files:**
- Create: `packages/desktop/src/common/knowledge/chunker.ts`
- Test: `tests/unit/knowledge/chunker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/knowledge/chunker.test.ts
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '@/common/knowledge/chunker';

describe('chunkMarkdown', () => {
  it('returns a single chunk for a short document', () => {
    const chunks = chunkMarkdown('Just a short note.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('Just a short note.');
    expect(chunks[0].headingPath).toBeUndefined();
  });

  it('returns no chunks for empty/whitespace input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('labels a chunk with the deepest heading it contains', () => {
    const md = ['# Onboarding', '', '## Visa letters', '', 'How to request a visa letter.'].join('\n');
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('Onboarding > Visa letters');
    expect(chunks[0].text).toContain('How to request a visa letter.');
  });

  it('a chunk absorbing a new top-level heading takes the new path', () => {
    const md = ['# A', '', 'x'.repeat(4000), '', '# B', '', 'under b'].join('\n');
    const chunks = chunkMarkdown(md, { maxChars: 3200, overlapChars: 400 });
    const last = chunks[chunks.length - 1];
    expect(last.text).toContain('under b');
    expect(last.headingPath).toBe('B'); // heading-only chunks inherit; absorbed headings override
    expect(chunks[0].headingPath).toBe('A');
  });

  it('splits long documents into overlapping chunks under the size cap', () => {
    const paragraph = 'word '.repeat(200).trim(); // ~1000 chars
    const md = Array.from({ length: 10 }, () => paragraph).join('\n\n'); // ~10k chars
    const chunks = chunkMarkdown(md, { maxChars: 3200, overlapChars: 400 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(3200);
    // overlap: a marker taken from inside the previous chunk's 400-char tail
    // must reappear at the start of the next chunk
    for (let i = 1; i < chunks.length; i++) {
      const marker = chunks[i - 1].text.slice(-200, -170);
      expect(chunks[i].text).toContain(marker);
    }
  });

  it('hard-splits a single oversized block', () => {
    const chunks = chunkMarkdown('x'.repeat(10000), { maxChars: 3200, overlapChars: 400 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(3200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/chunker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement chunker.ts**

```ts
// packages/desktop/src/common/knowledge/chunker.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Split markdown into retrieval chunks. Pure — no Node APIs.
// Heuristic sizing: ~4 chars/token, so 3,200 chars ≈ the spec's ~800-token
// target with a 400-char (~100-token) overlap between adjacent chunks.

export type ChunkerOptions = { maxChars?: number; overlapChars?: number };
export type RawChunk = { text: string; headingPath?: string };

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

export const chunkMarkdown = (markdown: string, options: ChunkerOptions = {}): RawChunk[] => {
  const maxChars = options.maxChars ?? 3200;
  const overlapChars = options.overlapChars ?? 400;

  // Blocks = heading lines or blank-line-separated paragraphs, in order.
  type Block = { text: string; heading?: { level: number; title: string } };
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ text });
    paragraph = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ text: line.trim(), heading: { level: heading[1].length, title: heading[2].trim() } });
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  if (blocks.length === 0) return [];

  const chunks: RawChunk[] = [];
  const headingStack: Array<{ level: number; title: string }> = [];
  const currentPath = () => (headingStack.length ? headingStack.map((h) => h.title).join(' > ') : undefined);

  let buffer = '';
  let bufferPath: string | undefined;
  const flushChunk = () => {
    const text = buffer.trim();
    if (text) chunks.push({ text, headingPath: bufferPath });
    buffer = '';
  };
  const startNewBuffer = (withOverlapFrom?: string) => {
    buffer = withOverlapFrom ? `${withOverlapFrom.slice(-overlapChars)}\n` : '';
    bufferPath = currentPath();
  };

  startNewBuffer();
  for (const block of blocks) {
    if (block.heading) {
      while (headingStack.length && headingStack[headingStack.length - 1].level >= block.heading.level) {
        headingStack.pop();
      }
      headingStack.push(block.heading);
    }
    // Hard-split blocks that alone exceed the cap.
    const pieces: string[] = [];
    if (block.text.length > maxChars) {
      for (let i = 0; i < block.text.length; i += maxChars - overlapChars) {
        pieces.push(block.text.slice(i, i + maxChars));
      }
    } else {
      pieces.push(block.text);
    }
    for (const piece of pieces) {
      if (buffer && buffer.length + piece.length + 1 > maxChars) {
        const prevText = buffer;
        flushChunk();
        startNewBuffer(prevText);
      }
      if (!buffer) bufferPath = currentPath();
      buffer = buffer ? `${buffer}\n${piece}` : piece;
      // A chunk that absorbs a heading is labeled by that (deepest) heading —
      // more useful for citations than the path where the buffer started.
      if (block.heading) bufferPath = currentPath();
      // A hard-split piece may still overflow with the overlap prefix attached.
      if (buffer.length > maxChars) {
        buffer = buffer.slice(-maxChars);
      }
    }
  }
  flushChunk();
  return chunks;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/chunker.test.ts`
Expected: PASS. If the overlap assertion proves brittle against the implementation, keep the implementation contract (each chunk ≤ maxChars; later chunks begin with the previous chunk's tail) and adjust the assertion to test that contract directly — do not weaken the size cap or drop overlap.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/common/knowledge/chunker.ts tests/unit/knowledge/chunker.test.ts
git commit -m "feat(knowledge): add markdown chunker with heading paths and overlap"
```

---

### Task 3: Tokenizer + BM25

**Files:**
- Create: `packages/desktop/src/common/knowledge/bm25.ts`
- Test: `tests/unit/knowledge/bm25.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/knowledge/bm25.test.ts
import { describe, expect, it } from 'vitest';
import { buildBm25Index, searchBm25, tokenize } from '@/common/knowledge/bm25';
import type { KnowledgeChunk } from '@/common/knowledge/types';

const chunk = (id: string, text: string): KnowledgeChunk => ({
  chunkId: id,
  sourceId: id.split('#')[0],
  chunkIndex: Number(id.split('#')[1]),
  text,
  hasVector: false,
});

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics, keeping diacritics', () => {
    expect(tokenize('Hello, World! Xin chào Việt-Nam 42')).toEqual(['hello', 'world', 'xin', 'chào', 'việt', 'nam', '42']);
  });

  it('splits CJK runs into bigrams', () => {
    expect(tokenize('知识库')).toEqual(['知识', '识库']);
    expect(tokenize('a知识b')).toEqual(['a', '知识', 'b']);
    expect(tokenize('中')).toEqual(['中']);
  });
});

describe('bm25', () => {
  const corpus = [
    chunk('s1#0', 'visa letter process for business trips to Singapore'),
    chunk('s1#1', 'expense reports must be filed within thirty days'),
    chunk('s2#0', 'the visa application requires a letter from HR'),
    chunk('s2#1', 'office wifi password rotation policy'),
  ];
  const index = buildBm25Index(corpus);

  it('computes corpus stats', () => {
    expect(index.totalDocs).toBe(4);
    expect(Object.keys(index.docLens)).toHaveLength(4);
    expect(index.avgDocLen).toBeGreaterThan(0);
  });

  it('ranks documents containing more query terms higher', () => {
    const results = searchBm25(index, tokenize('visa letter'), 4);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.chunkId);
    expect(ids.slice(0, 2)).toEqual(expect.arrayContaining(['s1#0', 's2#0']));
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('returns empty for no-match and empty queries', () => {
    expect(searchBm25(index, tokenize('quantum blockchain'), 5)).toEqual([]);
    expect(searchBm25(index, [], 5)).toEqual([]);
  });

  it('respects topK', () => {
    expect(searchBm25(index, tokenize('the visa letter process policy'), 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/bm25.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bm25.ts**

```ts
// packages/desktop/src/common/knowledge/bm25.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Minimal BM25 (Okapi, k1=1.2 b=0.75) over knowledge chunks. Pure — no Node
// APIs. The tokenizer handles space-separated scripts (incl. Vietnamese
// diacritics) via unicode property classes and CJK runs via char bigrams.

import type { Bm25Index, KnowledgeChunk } from './types';

const K1 = 1.2;
const B = 0.75;
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
const CJK_SPLIT_RE = /([぀-ヿ㐀-䶿一-鿿豈-﫿]+)/u;

export const tokenize = (text: string): string[] => {
  const runs = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];
  for (const run of runs) {
    for (const segment of run.split(CJK_SPLIT_RE)) {
      if (!segment) continue;
      if (CJK_RE.test(segment[0])) {
        const chars = [...segment];
        if (chars.length === 1) tokens.push(segment);
        else for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
      } else {
        tokens.push(segment);
      }
    }
  }
  return tokens;
};

export const buildBm25Index = (chunks: KnowledgeChunk[]): Bm25Index => {
  const docLens: Record<string, number> = {};
  const postings: Record<string, Array<[string, number]>> = {};
  let totalLen = 0;
  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    docLens[chunk.chunkId] = tokens.length;
    totalLen += tokens.length;
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const [term, count] of tf) {
      (postings[term] ??= []).push([chunk.chunkId, count]);
    }
  }
  const totalDocs = chunks.length;
  return { totalDocs, avgDocLen: totalDocs > 0 ? totalLen / totalDocs : 0, docLens, postings };
};

export type Bm25Result = { chunkId: string; score: number };

export const searchBm25 = (index: Bm25Index, queryTokens: string[], topK: number): Bm25Result[] => {
  if (index.totalDocs === 0 || queryTokens.length === 0) return [];
  const scores = new Map<string, number>();
  for (const term of new Set(queryTokens)) {
    const posting = index.postings[term];
    if (!posting) continue;
    const df = posting.length;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));
    for (const [chunkId, tf] of posting) {
      const docLen = index.docLens[chunkId] ?? 0;
      const denom = tf + K1 * (1 - B + (B * docLen) / (index.avgDocLen || 1));
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + (idf * (tf * (K1 + 1))) / denom);
    }
  }
  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/bm25.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/common/knowledge/bm25.ts tests/unit/knowledge/bm25.test.ts
git commit -m "feat(knowledge): add tokenizer and in-repo BM25 index"
```

---

### Task 4: Reciprocal Rank Fusion

**Files:**
- Create: `packages/desktop/src/common/knowledge/rrf.ts`
- Test: `tests/unit/knowledge/rrf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/knowledge/rrf.test.ts
import { describe, expect, it } from 'vitest';
import { fuseRrf } from '@/common/knowledge/rrf';

describe('fuseRrf', () => {
  it('ranks items appearing high in both lists above single-list items', () => {
    const fused = fuseRrf([[{ chunkId: 'a' }, { chunkId: 'b' }, { chunkId: 'c' }], [{ chunkId: 'b' }, { chunkId: 'd' }]], 10);
    expect(fused[0].chunkId).toBe('b'); // rank 2 + rank 1 beats everything
    expect(fused.map((f) => f.chunkId)).toContain('d');
    // no duplicates
    expect(new Set(fused.map((f) => f.chunkId)).size).toBe(fused.length);
  });

  it('degrades to the single list order when only one list is non-empty', () => {
    const fused = fuseRrf([[{ chunkId: 'x' }, { chunkId: 'y' }], []], 10);
    expect(fused.map((f) => f.chunkId)).toEqual(['x', 'y']);
  });

  it('respects topN and returns descending scores', () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ chunkId: `c${i}` }));
    const fused = fuseRrf([list], 3);
    expect(fused).toHaveLength(3);
    expect(fused[0].score).toBeGreaterThan(fused[2].score);
  });

  it('returns empty for no input', () => {
    expect(fuseRrf([[], []], 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/rrf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement rrf.ts**

```ts
// packages/desktop/src/common/knowledge/rrf.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Reciprocal Rank Fusion: score(d) = Σ_lists 1/(k + rank). Rank-only, so BM25
// and cosine lists fuse without score normalization, and an empty semantic
// list degrades to exactly the BM25 ranking. Pure — no Node APIs.

const RRF_K = 60;

export type RrfInput = { chunkId: string };
export type RrfResult = { chunkId: string; score: number };

export const fuseRrf = (lists: RrfInput[][], topN: number): RrfResult[] => {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, i) => {
      scores.set(item.chunkId, (scores.get(item.chunkId) ?? 0) + 1 / (RRF_K + i + 1));
    });
  }
  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/rrf.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/common/knowledge/rrf.ts tests/unit/knowledge/rrf.test.ts
git commit -m "feat(knowledge): add reciprocal rank fusion"
```

---

### Task 5: Embedding client core

**Files:**
- Create: `packages/desktop/src/common/knowledge/embedCore.ts`
- Test: `tests/unit/knowledge/embedCore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/knowledge/embedCore.test.ts
import { describe, expect, it, vi } from 'vitest';
import { cosineSim, embedTexts } from '@/common/knowledge/embedCore';

const CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'text-embedding-3-small' };

const okResponse = (embeddings: number[][]) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ data: embeddings.map((e, index) => ({ index, embedding: e })) }),
});

describe('embedTexts', () => {
  it('POSTs to /embeddings with auth and returns vectors in order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse([[1, 0], [0, 1]]));
    const result = await embedTexts(['a', 'b'], CONFIG, { fetchImpl: fetchImpl as never });
    expect(result).toEqual([[1, 0], [0, 1]]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/embeddings');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toEqual({ model: CONFIG.model, input: ['a', 'b'] });
  });

  it('batches more than 32 inputs into sequential requests', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const inputs = JSON.parse(init.body).input as string[];
      return okResponse(inputs.map(() => [1]));
    });
    const texts = Array.from({ length: 70 }, (_, i) => `t${i}`);
    const result = await embedTexts(texts, CONFIG, { fetchImpl: fetchImpl as never });
    expect(result).toHaveLength(70);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 32 + 32 + 6
  });

  it('throws a descriptive error on HTTP failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    await expect(embedTexts(['a'], CONFIG, { fetchImpl: fetchImpl as never })).rejects.toThrow(/401/);
  });

  it('strips a trailing slash from baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse([[1]]));
    await embedTexts(['a'], { ...CONFIG, baseUrl: 'https://api.example.com/v1/' }, { fetchImpl: fetchImpl as never });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/v1/embeddings');
  });
});

describe('cosineSim', () => {
  it('computes cosine similarity', () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSim([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
  });

  it('returns 0 for zero vectors or length mismatch', () => {
    expect(cosineSim([0, 0], [1, 0])).toBe(0);
    expect(cosineSim([1], [1, 0])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/embedCore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement embedCore.ts**

```ts
// packages/desktop/src/common/knowledge/embedCore.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// OpenAI-compatible /embeddings client. Plain fetch with an injectable
// fetchImpl (the visionCore.ts pattern) so main-process ingestion and the
// bundled knowledge MCP subprocess share one embed path. Pure Node-free.

export type EmbedConfig = { baseUrl: string; apiKey: string; model: string };

const BATCH_SIZE = 32;

export const embedTexts = async (
  texts: string[],
  config: EmbedConfig,
  deps?: { fetchImpl?: typeof fetch }
): Promise<number[][]> => {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const url = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`;
  const all: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const input = texts.slice(start, start + BATCH_SIZE);
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input }),
    });
    const body = await resp.text();
    if (!resp.ok) throw new Error(`Embedding request failed (HTTP ${resp.status}): ${body.slice(0, 300)}`);
    const parsed = JSON.parse(body) as { data?: Array<{ index: number; embedding: number[] }> };
    if (!parsed.data || parsed.data.length !== input.length) {
      throw new Error('Embedding response did not include one vector per input.');
    }
    const ordered = [...parsed.data].sort((a, b) => a.index - b.index);
    all.push(...ordered.map((d) => d.embedding));
  }
  return all;
};

export const cosineSim = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/embedCore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/common/knowledge/embedCore.ts tests/unit/knowledge/embedCore.test.ts
git commit -m "feat(knowledge): add fetch-based embedding client and cosine similarity"
```

---

### Task 6: Search core (load store → hybrid search → MCP text)

**Files:**
- Create: `packages/desktop/src/common/knowledge/searchCore.ts`
- Test: `tests/unit/knowledge/searchCore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/knowledge/searchCore.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBm25Index } from '@/common/knowledge/bm25';
import { formatHitsAsText, loadStore, searchKnowledge } from '@/common/knowledge/searchCore';
import { createEmptyManifest, writeBm25, writeChunks, writeManifest, writeVectors } from '@/common/knowledge/store';
import type { KnowledgeChunk, KnowledgeHit } from '@/common/knowledge/types';

const CHUNKS: KnowledgeChunk[] = [
  { chunkId: 's1#0', sourceId: 's1', chunkIndex: 0, text: 'visa letter process for business trips', headingPath: 'HR > Visa', hasVector: true },
  { chunkId: 's1#1', sourceId: 's1', chunkIndex: 1, text: 'expense reports are due in thirty days', hasVector: true },
  { chunkId: 's2#0', sourceId: 's2', chunkIndex: 0, text: 'wifi password rotation schedule', hasVector: true },
];

const seedStore = async (dir: string, withVectors: boolean) => {
  const manifest = createEmptyManifest('proj-1');
  manifest.sources.push(
    { id: 's1', fileName: 'hr.md', contentHash: 'sha256:1', byteSize: 10, status: 'ready', chunkCount: 2, vectorCount: withVectors ? 2 : 0, addedAt: 1, error: null },
    { id: 's2', fileName: 'it.md', contentHash: 'sha256:2', byteSize: 10, status: 'ready', chunkCount: 1, vectorCount: withVectors ? 1 : 0, addedAt: 1, error: null }
  );
  if (withVectors) manifest.embedding = { model: 'test-embed', dim: 2 };
  await writeManifest(dir, manifest);
  await writeChunks(dir, CHUNKS);
  await writeBm25(dir, buildBm25Index(CHUNKS));
  if (withVectors) {
    await writeVectors(dir, 2, [
      ['s1#0', new Float32Array([1, 0])],
      ['s1#1', new Float32Array([0, 1])],
      ['s2#0', new Float32Array([0.7, 0.7])],
    ]);
  }
};

describe('searchCore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kb-search-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loadStore throws when the store is missing', async () => {
    await expect(loadStore(path.join(dir, 'missing'))).rejects.toThrow();
  });

  it('finds passages by keyword (BM25-only store)', async () => {
    await seedStore(dir, false);
    const store = await loadStore(dir);
    const hits = await searchKnowledge(store, 'visa letter', { maxResults: 3 });
    expect(hits[0].sourceName).toBe('hr.md');
    expect(hits[0].text).toContain('visa letter process');
    expect(hits[0].headingPath).toBe('HR > Visa');
  });

  it('fuses semantic results when an embed function is provided', async () => {
    await seedStore(dir, true);
    const store = await loadStore(dir);
    const embed = vi.fn().mockResolvedValue([1, 0]); // nearest to s1#0
    const hits = await searchKnowledge(store, 'travel authorization document', { maxResults: 2, embed });
    expect(embed).toHaveBeenCalledWith('travel authorization document');
    expect(hits.map((h) => h.sourceId)).toContain('s1');
  });

  it('degrades to BM25 when the embed function rejects', async () => {
    await seedStore(dir, true);
    const store = await loadStore(dir);
    const embed = vi.fn().mockRejectedValue(new Error('boom'));
    const hits = await searchKnowledge(store, 'visa letter', { maxResults: 3, embed });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text).toContain('visa letter');
  });

  it('returns empty for a blank query', async () => {
    await seedStore(dir, false);
    const store = await loadStore(dir);
    expect(await searchKnowledge(store, '   ', { maxResults: 3 })).toEqual([]);
  });
});

describe('formatHitsAsText', () => {
  const hit = (i: number, text: string): KnowledgeHit => ({ sourceId: 's1', sourceName: 'hr.md', chunkIndex: i, text, score: 1 / (i + 1), headingPath: i === 0 ? 'HR > Visa' : undefined });

  it('renders numbered citations with heading paths', () => {
    const text = formatHitsAsText('visa', [hit(0, 'alpha'), hit(1, 'beta')]);
    expect(text).toContain('Found 2 passage(s)');
    expect(text).toContain('[1] hr.md — HR > Visa');
    expect(text).toContain('alpha');
    expect(text).toContain('[2] hr.md');
    expect(text).toContain('beta');
  });

  it('renders the empty message', () => {
    expect(formatHitsAsText('nada', [])).toBe('No relevant passages found in the project knowledge base for "nada".');
  });

  it('caps the payload and reports omissions', () => {
    const hits = Array.from({ length: 6 }, (_, i) => hit(i, 'x'.repeat(5000)));
    const text = formatHitsAsText('big', hits, { payloadCapChars: 12000 });
    expect(text.length).toBeLessThanOrEqual(12200); // cap + trailing note
    expect(text).toMatch(/\d+ more passage\(s\) omitted\./);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/searchCore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement searchCore.ts**

```ts
// packages/desktop/src/common/knowledge/searchCore.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Read-side of the knowledge base: load a project store, run hybrid
// BM25 + cosine retrieval fused with RRF, and format hits as MCP tool text.
// Node-side (fs via store.ts) — used by the knowledge MCP subprocess.

import { searchBm25, tokenize } from './bm25';
import { cosineSim } from './embedCore';
import { fuseRrf } from './rrf';
import { readBm25, readChunks, readManifest, readVectors, type KnowledgeVectors } from './store';
import type { Bm25Index, KnowledgeChunk, KnowledgeHit, KnowledgeManifest } from './types';

const CANDIDATES_PER_LIST = 30;
const DEFAULT_PAYLOAD_CAP = 12000;

export type KnowledgeStoreData = {
  manifest: KnowledgeManifest;
  chunks: Map<string, KnowledgeChunk>;
  bm25: Bm25Index;
  vectors: KnowledgeVectors | null;
  sourceNameById: Map<string, string>;
};

export const loadStore = async (storeDir: string): Promise<KnowledgeStoreData> => {
  const manifest = await readManifest(storeDir);
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error(`Knowledge store missing or unsupported at ${storeDir}`);
  }
  const chunkList = await readChunks(storeDir);
  const bm25 = (await readBm25(storeDir)) ?? { totalDocs: 0, avgDocLen: 0, docLens: {}, postings: {} };
  const vectors = await readVectors(storeDir);
  return {
    manifest,
    chunks: new Map(chunkList.map((c) => [c.chunkId, c])),
    bm25,
    vectors,
    sourceNameById: new Map(manifest.sources.map((s) => [s.id, s.fileName])),
  };
};

export type SearchOptions = {
  maxResults: number;
  /** Embeds the query; omit (or let it reject) for BM25-only. */
  embed?: (query: string) => Promise<number[]>;
};

export const searchKnowledge = async (
  store: KnowledgeStoreData,
  query: string,
  options: SearchOptions
): Promise<KnowledgeHit[]> => {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 && query.trim() === '') return [];

  const bm25List = searchBm25(store.bm25, queryTokens, CANDIDATES_PER_LIST);

  let semanticList: Array<{ chunkId: string }> = [];
  if (options.embed && store.vectors && store.vectors.rows.size > 0) {
    try {
      const queryVector = await options.embed(query);
      semanticList = [...store.vectors.rows.entries()]
        .map(([chunkId, vec]) => ({ chunkId, score: cosineSim(queryVector, vec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, CANDIDATES_PER_LIST);
    } catch {
      semanticList = []; // degrade cleanly to BM25-only
    }
  }

  return fuseRrf([bm25List, semanticList], options.maxResults)
    .map(({ chunkId, score }) => {
      const chunk = store.chunks.get(chunkId);
      if (!chunk) return null;
      return {
        sourceId: chunk.sourceId,
        sourceName: store.sourceNameById.get(chunk.sourceId) ?? chunk.sourceId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score,
        headingPath: chunk.headingPath,
      } satisfies KnowledgeHit;
    })
    .filter((hit): hit is KnowledgeHit => hit !== null);
};

export const formatHitsAsText = (
  query: string,
  hits: KnowledgeHit[],
  options?: { payloadCapChars?: number }
): string => {
  if (hits.length === 0) {
    return `No relevant passages found in the project knowledge base for "${query}".`;
  }
  const cap = options?.payloadCapChars ?? DEFAULT_PAYLOAD_CAP;
  const parts: string[] = [`Found ${hits.length} passage(s) in the project knowledge base for "${query}":`];
  let used = parts[0].length;
  let rendered = 0;
  for (const [i, hit] of hits.entries()) {
    const header = hit.headingPath ? `[${i + 1}] ${hit.sourceName} — ${hit.headingPath}` : `[${i + 1}] ${hit.sourceName}`;
    const block = `\n\n${header}\n${hit.text}`;
    if (used + block.length > cap && rendered > 0) break;
    parts.push(block);
    used += block.length;
    rendered++;
  }
  if (rendered < hits.length) {
    parts.push(`\n\n(${hits.length - rendered} more passage(s) omitted.)`);
  }
  return parts.join('');
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/searchCore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/common/knowledge/searchCore.ts tests/unit/knowledge/searchCore.test.ts
git commit -m "feat(knowledge): add store loader, hybrid search, and MCP text formatting"
```

---

### Task 7: Knowledge MCP server entry + build wiring + store dir resolver

**Files:**
- Create: `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/constants.ts` (append)
- Modify: `scripts/build-mcp-servers.js` (add 4th entry)
- Modify: `packages/desktop/src/process/utils/initStorage.ts` (STORAGE_PATH + resolver + export)
- Test: `tests/unit/knowledge/knowledgeServerEnv.test.ts`

- [ ] **Step 1: Write the failing test (env parsing only — the rest is covered by searchCore tests)**

```ts
// tests/unit/knowledge/knowledgeServerEnv.test.ts
import { describe, expect, it } from 'vitest';
import { parseKnowledgeServerEnv } from '@/process/resources/builtinMcp/knowledgeServer';

describe('parseKnowledgeServerEnv', () => {
  it('returns null without a store dir', () => {
    expect(parseKnowledgeServerEnv({})).toBeNull();
  });

  it('parses store config without embed config', () => {
    const parsed = parseKnowledgeServerEnv({ AIONUI_KB_PROJECT_ID: 'p1', AIONUI_KB_STORE_DIR: '/tmp/kb/p1' });
    expect(parsed).toEqual({ projectId: 'p1', storeDir: '/tmp/kb/p1', embed: null });
  });

  it('includes embed config only when all three embed vars are set', () => {
    const base = { AIONUI_KB_PROJECT_ID: 'p1', AIONUI_KB_STORE_DIR: '/tmp/kb/p1', AIONUI_KB_EMBED_BASE_URL: 'https://x/v1', AIONUI_KB_EMBED_API_KEY: 'k' };
    expect(parseKnowledgeServerEnv(base)!.embed).toBeNull();
    expect(parseKnowledgeServerEnv({ ...base, AIONUI_KB_EMBED_MODEL: 'm' })!.embed).toEqual({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/knowledgeServerEnv.test.ts`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Implement knowledgeServer.ts (mirror `visionServer.ts` structure)**

```ts
// packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Built-in MCP server exposing search over one project's knowledge base.
// Standalone stdio process; reads AIONUI_KB_* env vars set per conversation
// by the project-knowledge session-server descriptor (main process).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { embedTexts, type EmbedConfig } from '@/common/knowledge/embedCore';
import { formatHitsAsText, loadStore, searchKnowledge, type KnowledgeStoreData } from '@/common/knowledge/searchCore';
import { BUILTIN_KNOWLEDGE_NAME } from './constants';

export type KnowledgeServerEnv = {
  projectId: string;
  storeDir: string;
  embed: EmbedConfig | null;
};

export function parseKnowledgeServerEnv(env: Record<string, string | undefined>): KnowledgeServerEnv | null {
  const storeDir = env.AIONUI_KB_STORE_DIR;
  if (!storeDir) return null;
  const baseUrl = env.AIONUI_KB_EMBED_BASE_URL;
  const apiKey = env.AIONUI_KB_EMBED_API_KEY;
  const model = env.AIONUI_KB_EMBED_MODEL;
  return {
    projectId: env.AIONUI_KB_PROJECT_ID ?? '',
    storeDir,
    embed: baseUrl && apiKey && model ? { baseUrl, apiKey, model } : null,
  };
}

const TOOL_DESCRIPTION = `Search this project's curated knowledge base — documents the user deliberately added to the project — for passages relevant to a question. Call this whenever the request may depend on project-specific facts, files, specs, policies, or prior decisions you don't already know. Returns the most relevant passages with their source filenames so you can cite them.

Input:
- query: natural-language question or keywords.
- max_results: optional, defaults to 6 (max 20).

Output: the most relevant passages, each cited with its source filename.`;

async function main() {
  const config = parseKnowledgeServerEnv(process.env);
  const server = new McpServer({ name: BUILTIN_KNOWLEDGE_NAME, version: '1.0.0' });

  let storePromise: Promise<KnowledgeStoreData> | null = null;
  const getStore = () => (storePromise ??= loadStore(config!.storeDir));

  server.tool(
    'search_project_knowledge',
    TOOL_DESCRIPTION,
    {
      query: z.string().describe('Natural-language question or keywords to search for.'),
      max_results: z.number().int().optional().describe('Maximum passages to return (default 6, max 20).'),
    },
    async ({ query, max_results }) => {
      if (!config) {
        return { content: [{ type: 'text' as const, text: 'Project knowledge base is unavailable.' }], isError: true };
      }
      let store: KnowledgeStoreData;
      try {
        store = await getStore();
      } catch {
        storePromise = null; // allow retry on a later call
        return { content: [{ type: 'text' as const, text: 'Project knowledge base is unavailable.' }], isError: true };
      }
      const maxResults = Math.min(20, Math.max(1, max_results ?? 6));
      const embed =
        config.embed && store.manifest.embedding
          ? async (q: string) => (await embedTexts([q], config.embed!))[0]
          : undefined;
      const hits = await searchKnowledge(store, query, { maxResults, embed });
      return { content: [{ type: 'text' as const, text: formatHitsAsText(query, hits) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start the stdio loop when executed as the bundle entry, so importing
// parseKnowledgeServerEnv from tests does not boot a server. The typeof guard
// matters: under vitest's ESM transform a bare `require` reference throws
// (same pattern as getBuiltinMcpBaseDir in initStorage.ts).
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error) => {
    console.error('[KnowledgeMCP] Fatal error:', error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Append constants to `constants.ts`**

```ts
// append to packages/desktop/src/process/resources/builtinMcp/constants.ts
export const BUILTIN_KNOWLEDGE_ID = 'builtin-project-knowledge';
export const BUILTIN_KNOWLEDGE_NAME = 'aionui-project-knowledge';
export const BUILTIN_KNOWLEDGE_SCRIPT = 'builtin-mcp-knowledge';
```

- [ ] **Step 5: Add the esbuild entry to `scripts/build-mcp-servers.js`** (inside the `Promise.all` array, after the visionServer entry)

```js
    esbuild.build({
      ...SHARED_OPTIONS,
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-knowledge.js'),
    }),
```

- [ ] **Step 6: Add the store root resolver to `initStorage.ts`**

In the `STORAGE_PATH` object (line ~38), add:

```ts
  projectKb: 'project-kb',
```

Next to `getCronSkillsDir` (line ~305), add:

```ts
/**
 * Root directory for per-project knowledge-base stores.
 * Each project gets {getProjectKbRootDir()}/{projectId}/ (see common/knowledge/store.ts).
 */
const getProjectKbRootDir = () => {
  return path.join(cacheDir, STORAGE_PATH.projectKb);
};
```

And extend the export line (~454):

```ts
export { getAssistantsDir, getSkillsDir, getCronSkillsDir, getProjectKbRootDir, BUILTIN_IMAGE_GEN_ID, getBuiltinMcpScriptPath };
```

- [ ] **Step 7: Run tests + build script**

Run: `bun run test tests/unit/knowledge/knowledgeServerEnv.test.ts` → PASS.
Run: `node scripts/build-mcp-servers.js` → exits 0 and `ls out/main/builtin-mcp-knowledge.js` exists. (If esbuild complains about the `@/` alias: the script sets `tsconfig`, which maps paths — the three existing servers rely on the same mechanism, so a failure here means a typo in the import, not missing config.)

- [ ] **Step 8: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts packages/desktop/src/process/resources/builtinMcp/constants.ts scripts/build-mcp-servers.js packages/desktop/src/process/utils/initStorage.ts tests/unit/knowledge/knowledgeServerEnv.test.ts
git commit -m "feat(knowledge): add builtin knowledge MCP server entry and store dir resolver"
```

---

### Task 8: Embedding provider picker

**Files:**
- Create: `packages/desktop/src/process/services/projectKnowledge/embedProviderPicker.ts`
- Test: `tests/unit/knowledge/embedProviderPicker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/knowledge/embedProviderPicker.test.ts
import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { pickEmbeddingModel, resolveEmbedConfigForModel } from '@/process/services/projectKnowledge/embedProviderPicker';

const provider = (over: Partial<IProvider>): IProvider =>
  ({ id: 'p1', platform: 'openai', name: 'P', base_url: 'https://api.x.com/v1', api_key: 'sk-1', models: [], ...over }) as IProvider;

describe('pickEmbeddingModel', () => {
  it('picks the first embedding-capable model across providers', () => {
    const providers = [
      provider({ id: 'chat', models: ['gpt-4o'] }),
      provider({ id: 'embed', models: ['gpt-4o-mini', 'text-embedding-3-small'] }),
    ];
    expect(pickEmbeddingModel(providers)).toEqual({ providerId: 'embed', model: 'text-embedding-3-small' });
  });

  it('returns null when no provider has an embedding model', () => {
    expect(pickEmbeddingModel([provider({ models: ['gpt-4o', 'claude-3-haiku'] })])).toBeNull();
  });

  it('skips providers missing base_url or api_key', () => {
    const providers = [
      provider({ id: 'nokey', api_key: '', models: ['text-embedding-3-small'] }),
      provider({ id: 'ok', models: ['bge-large-zh'] }),
    ];
    expect(pickEmbeddingModel(providers)).toEqual({ providerId: 'ok', model: 'bge-large-zh' });
  });
});

describe('resolveEmbedConfigForModel', () => {
  it('builds an EmbedConfig from the provider owning the pinned model', () => {
    const providers = [provider({ id: 'e', models: ['text-embedding-3-small'], api_key: 'sk-a,sk-b' })];
    expect(resolveEmbedConfigForModel(providers, 'text-embedding-3-small')).toEqual({
      baseUrl: 'https://api.x.com/v1',
      apiKey: 'sk-a', // first key only — the subprocess has no rotation
      model: 'text-embedding-3-small',
    });
  });

  it('returns null when the pinned model is no longer configured', () => {
    expect(resolveEmbedConfigForModel([provider({ models: ['gpt-4o'] })], 'text-embedding-3-small')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/embedProviderPicker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement embedProviderPicker.ts**

```ts
// packages/desktop/src/process/services/projectKnowledge/embedProviderPicker.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Auto-detect which configured provider/model to use for knowledge-base
// embeddings, and resolve the pinned model back to a live EmbedConfig.

import type { IProvider } from '@/common/config/storage';
import { hasSpecificModelCapability } from '@/common/utils/modelCapabilities';
import type { EmbedConfig } from '@/common/knowledge/embedCore';

const isUsable = (provider: IProvider): boolean => Boolean(provider.base_url?.trim() && provider.api_key?.trim());

/** First embedding-capable model across usable providers, or null. */
export const pickEmbeddingModel = (providers: IProvider[]): { providerId: string; model: string } | null => {
  for (const provider of providers) {
    if (!isUsable(provider)) continue;
    for (const model of provider.models ?? []) {
      if (hasSpecificModelCapability(provider, model, 'embedding') === true) {
        return { providerId: provider.id, model };
      }
    }
  }
  return null;
};

/** Resolve a pinned embedding model to a fetchable config (first API key only). */
export const resolveEmbedConfigForModel = (providers: IProvider[], model: string): EmbedConfig | null => {
  const provider = providers.find((p) => isUsable(p) && (p.models ?? []).includes(model));
  if (!provider) return null;
  const apiKey = provider.api_key.split(/[,\n]/)[0].trim();
  if (!apiKey) return null;
  return { baseUrl: provider.base_url, apiKey, model };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/embedProviderPicker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/process/services/projectKnowledge/embedProviderPicker.ts tests/unit/knowledge/embedProviderPicker.test.ts
git commit -m "feat(knowledge): add embedding provider auto-detection"
```

---

### Task 9: Project knowledge service — DTOs, add + list

**Files:**
- Create: `packages/desktop/src/common/types/project/knowledgeTypes.ts`
- Create: `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts`
- Test: `tests/unit/knowledge/projectKnowledgeService.test.ts`

The service is dependency-injected for tests: temp store root, fake providers, fake embedder, fake document converter. Per-project work is serialized on a promise-chain queue; `addSources` resolves after the sources are **registered** (visible as `indexing`) and continues indexing in the background; tests await `whenIdle(projectId)`.

- [ ] **Step 1: Create the renderer-safe DTO types**

```ts
// packages/desktop/src/common/types/project/knowledgeTypes.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KnowledgeSourceStatus } from '@/common/knowledge/types';

export type IKnowledgeSourceDto = {
  id: string;
  fileName: string;
  byteSize: number;
  status: KnowledgeSourceStatus;
  chunkCount: number;
  vectorCount: number;
  addedAt: number;
  error: string | null;
};

export type IProjectKnowledgeSummary = {
  fileCount: number;
  passageCount: number;
  semantic: 'on' | 'off';
};

export type IProjectKnowledgeListResult = {
  sources: IKnowledgeSourceDto[];
  summary: IProjectKnowledgeSummary;
};
```

(`KnowledgeSourceStatus` is a type-only import from a Node-free module — safe for the renderer.)

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/knowledge/projectKnowledgeService.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readChunks, readManifest } from '@/common/knowledge/store';
import type { IProvider } from '@/common/config/storage';
import { createProjectKnowledgeService, type ProjectKnowledgeService } from '@/process/services/projectKnowledge/projectKnowledgeService';

const EMBED_PROVIDER = {
  id: 'embed',
  platform: 'openai',
  name: 'E',
  base_url: 'https://api.x.com/v1',
  api_key: 'sk-1',
  models: ['text-embedding-3-small'],
} as IProvider;

describe('projectKnowledgeService', () => {
  let root: string;
  let inbox: string;
  let service: ProjectKnowledgeService;
  let embedMock: ReturnType<typeof vi.fn>;
  let updates: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'kb-svc-root-'));
    inbox = mkdtempSync(path.join(tmpdir(), 'kb-svc-in-'));
    embedMock = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]));
    updates = [];
    service = createProjectKnowledgeService({
      storeRootDir: root,
      listProviders: async () => [EMBED_PROVIDER],
      embedTextsImpl: embedMock as never,
      convertToMarkdown: async () => {
        throw new Error('not used for md/txt');
      },
      getServerScriptPath: () => '/out/main/builtin-mcp-knowledge.js',
      onUpdated: (projectId) => updates.push(projectId),
    });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(inbox, { recursive: true, force: true });
  });

  const addFile = async (name: string, content: string): Promise<string> => {
    const p = path.join(inbox, name);
    await writeFile(p, content, 'utf8');
    return p;
  };

  it('ingests a markdown file end-to-end (register → ready → embedded)', async () => {
    const file = await addFile('notes.md', '# Visa\n\nThe visa letter process requires HR sign-off.');
    await service.addSources('proj-1', [file]);
    // registration is synchronous within addSources: row visible as indexing or beyond
    const registered = await service.listSources('proj-1');
    expect(registered.sources).toHaveLength(1);
    await service.whenIdle('proj-1');

    const { sources, summary } = await service.listSources('proj-1');
    expect(sources[0]).toMatchObject({ fileName: 'notes.md', status: 'ready', error: null });
    expect(sources[0].chunkCount).toBeGreaterThan(0);
    expect(sources[0].vectorCount).toBe(sources[0].chunkCount);
    expect(summary).toEqual({ fileCount: 1, passageCount: sources[0].chunkCount, semantic: 'on' });

    const manifest = await readManifest(path.join(root, 'proj-1'));
    expect(manifest!.embedding).toEqual({ model: 'text-embedding-3-small', dim: 3 });
    const chunks = await readChunks(path.join(root, 'proj-1'));
    expect(chunks.some((c) => c.text.includes('visa letter process'))).toBe(true);
    expect(updates.filter((p) => p === 'proj-1').length).toBeGreaterThanOrEqual(2);
  });

  it('stays ready with BM25 only when embedding fails', async () => {
    embedMock.mockRejectedValue(new Error('rate limited'));
    const file = await addFile('a.md', 'expense policy: thirty day deadline');
    await service.addSources('proj-1', [file]);
    await service.whenIdle('proj-1');
    const { sources, summary } = await service.listSources('proj-1');
    expect(sources[0].status).toBe('ready');
    expect(sources[0].vectorCount).toBe(0);
    expect(summary.semantic).toBe('off');
  });

  it('marks unsupported extensions and oversized files without indexing them', async () => {
    const pdf = await addFile('doc.pdf', 'x');
    const big = await addFile('big.txt', 'x'.repeat(16 * 1024 * 1024));
    await service.addSources('proj-1', [pdf, big]);
    await service.whenIdle('proj-1');
    const { sources } = await service.listSources('proj-1');
    const byName = Object.fromEntries(sources.map((s) => [s.fileName, s]));
    expect(byName['doc.pdf'].status).toBe('unsupported');
    expect(byName['big.txt'].status).toBe('failed');
    expect(byName['big.txt'].error).toMatch(/15 MB/);
  });

  it('dedupes an unchanged re-add by content hash', async () => {
    const file = await addFile('same.md', 'identical content');
    await service.addSources('proj-1', [file]);
    await service.whenIdle('proj-1');
    await service.addSources('proj-1', [file]);
    await service.whenIdle('proj-1');
    expect((await service.listSources('proj-1')).sources).toHaveLength(1);
  });

  it('converts docx via the injected converter', async () => {
    const svc = createProjectKnowledgeService({
      storeRootDir: root,
      listProviders: async () => [],
      embedTextsImpl: embedMock as never,
      convertToMarkdown: async () => '# From Docx\n\nconverted body text',
      getServerScriptPath: () => '/x.js',
      onUpdated: () => {},
    });
    const file = await addFile('spec.docx', 'binary-ish');
    await svc.addSources('proj-2', [file]);
    await svc.whenIdle('proj-2');
    const { sources } = await svc.listSources('proj-2');
    expect(sources[0].status).toBe('ready');
    const chunks = await readChunks(path.join(root, 'proj-2'));
    expect(chunks[0].text).toContain('converted body text');
  });

  it('listSources returns empty result for an unknown project', async () => {
    expect(await service.listSources('nope')).toEqual({
      sources: [],
      summary: { fileCount: 0, passageCount: 0, semantic: 'off' },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test tests/unit/knowledge/projectKnowledgeService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement projectKnowledgeService.ts (add/list portion)**

```ts
// packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Main-process owner of per-project knowledge stores: registration + ingestion
// pipeline (snapshot → convert → chunk → BM25 → embed), listing, removal,
// retry, and the per-conversation session-MCP descriptor. All work for one
// project is serialized on a promise-chain queue.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ISessionMcpServer, IProvider } from '@/common/config/storage';
import type { IKnowledgeSourceDto, IProjectKnowledgeListResult } from '@/common/types/project/knowledgeTypes';
import { chunkMarkdown } from '@/common/knowledge/chunker';
import { buildBm25Index } from '@/common/knowledge/bm25';
import { embedTexts as defaultEmbedTexts, type EmbedConfig } from '@/common/knowledge/embedCore';
import {
  createEmptyManifest,
  readChunks,
  readManifest,
  readVectors,
  storePaths,
  writeBm25,
  writeChunks,
  writeManifest,
  writeVectors,
} from '@/common/knowledge/store';
import type { KnowledgeChunk, KnowledgeManifest, KnowledgeManifestSource } from '@/common/knowledge/types';
import { pickEmbeddingModel, resolveEmbedConfigForModel } from './embedProviderPicker';
import { BUILTIN_KNOWLEDGE_NAME } from '@process/resources/builtinMcp/constants';

const SUPPORTED_EXTENSIONS = new Set(['md', 'txt', 'docx', 'xlsx']);
const CONVERTED_EXTENSIONS = new Set(['docx', 'xlsx']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CHUNKS_PER_SOURCE = 2000;

export type ProjectKnowledgeServiceDeps = {
  storeRootDir: string;
  listProviders: () => Promise<IProvider[]>;
  /** Convert a .docx/.xlsx buffer to markdown (DocumentConverter in prod). */
  convertToMarkdown: (buffer: ArrayBuffer, extension: 'docx' | 'xlsx') => Promise<string>;
  embedTextsImpl?: typeof defaultEmbedTexts;
  getServerScriptPath: () => string;
  onUpdated: (projectId: string) => void;
};

export type ProjectKnowledgeService = {
  listSources: (projectId: string) => Promise<IProjectKnowledgeListResult>;
  addSources: (projectId: string, filePaths: string[]) => Promise<void>;
  removeSource: (projectId: string, sourceId: string) => Promise<void>;
  retrySource: (projectId: string, sourceId: string) => Promise<void>;
  removeStore: (projectId: string) => Promise<void>;
  getSessionMcpServer: (projectId: string) => Promise<ISessionMcpServer | null>;
  /** Resolves when all queued work for the project has finished (tests). */
  whenIdle: (projectId: string) => Promise<void>;
};

export const createProjectKnowledgeService = (deps: ProjectKnowledgeServiceDeps): ProjectKnowledgeService => {
  const embedTexts = deps.embedTextsImpl ?? defaultEmbedTexts;
  const queues = new Map<string, Promise<void>>();

  const storeDirOf = (projectId: string) => path.join(deps.storeRootDir, projectId);

  /** Serialize work per project; returns the enqueued job's promise. */
  const enqueue = <T>(projectId: string, job: () => Promise<T>): Promise<T> => {
    const prev = queues.get(projectId) ?? Promise.resolve();
    const run = prev.then(job, job);
    queues.set(
      projectId,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  };

  const loadManifest = async (projectId: string): Promise<KnowledgeManifest> =>
    (await readManifest(storeDirOf(projectId))) ?? createEmptyManifest(projectId);

  const saveManifest = async (projectId: string, manifest: KnowledgeManifest): Promise<void> => {
    await writeManifest(storeDirOf(projectId), manifest);
    deps.onUpdated(projectId);
  };

  const toDto = (source: KnowledgeManifestSource): IKnowledgeSourceDto => ({
    id: source.id,
    fileName: source.fileName,
    byteSize: source.byteSize,
    status: source.status,
    chunkCount: source.chunkCount,
    vectorCount: source.vectorCount,
    addedAt: source.addedAt,
    error: source.error,
  });

  const listSources = async (projectId: string): Promise<IProjectKnowledgeListResult> => {
    const manifest = await loadManifest(projectId);
    const sources = manifest.sources.map(toDto);
    return {
      sources,
      summary: {
        fileCount: sources.length,
        passageCount: sources.reduce((sum, s) => sum + s.chunkCount, 0),
        semantic: manifest.embedding && sources.some((s) => s.vectorCount > 0) ? 'on' : 'off',
      },
    };
  };

  /** Register new sources (visible immediately as indexing/unsupported/failed). */
  const registerSources = async (projectId: string, filePaths: string[]): Promise<void> => {
    const storeDir = storeDirOf(projectId);
    const manifest = await loadManifest(projectId);
    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);
      const extension = path.extname(fileName).slice(1).toLowerCase();
      const addedAt = Date.now();
      const baseSource: KnowledgeManifestSource = {
        id: '',
        fileName,
        contentHash: '',
        byteSize: 0,
        status: 'indexing',
        chunkCount: 0,
        vectorCount: 0,
        addedAt,
        error: null,
      };
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        manifest.sources.push({ ...baseSource, id: `unsupported-${addedAt}-${manifest.sources.length}`, status: 'unsupported', error: 'Unsupported file type. Supported: .md, .txt, .docx, .xlsx' });
        continue;
      }
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(filePath);
      } catch {
        manifest.sources.push({ ...baseSource, id: `failed-${addedAt}-${manifest.sources.length}`, status: 'failed', error: 'Could not read the file.' });
        continue;
      }
      if (buffer.byteLength > MAX_FILE_BYTES) {
        manifest.sources.push({ ...baseSource, id: `failed-${addedAt}-${manifest.sources.length}`, byteSize: buffer.byteLength, status: 'failed', error: 'File exceeds the 15 MB limit.' });
        continue;
      }
      const contentHash = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
      if (manifest.sources.some((s) => s.contentHash === contentHash && s.status !== 'failed')) {
        continue; // unchanged re-add — no-op
      }
      const sourceId = contentHash.slice(7, 19);
      // Replace a previous version of the same file name (changed content).
      const previous = manifest.sources.find((s) => s.fileName === fileName && s.contentHash && s.contentHash !== contentHash);
      if (previous) await removeSourceRows(projectId, manifest, previous.id);
      const sourceDir = storePaths(storeDir).sourceDir(sourceId);
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, `original.${extension}`), buffer);
      manifest.sources.push({ ...baseSource, id: sourceId, contentHash, byteSize: buffer.byteLength });
    }
    await saveManifest(projectId, manifest);
  };

  /** Drop a source's chunks/vectors/files; caller persists the manifest. */
  const removeSourceRows = async (projectId: string, manifest: KnowledgeManifest, sourceId: string): Promise<void> => {
    const storeDir = storeDirOf(projectId);
    const remaining = (await readChunks(storeDir)).filter((c) => c.sourceId !== sourceId);
    await writeChunks(storeDir, remaining);
    await writeBm25(storeDir, buildBm25Index(remaining));
    const vectors = await readVectors(storeDir);
    if (vectors) {
      const rows = [...vectors.rows.entries()].filter(([chunkId]) => remaining.some((c) => c.chunkId === chunkId && c.hasVector));
      await writeVectors(storeDir, vectors.dim, rows);
    }
    await fs.rm(storePaths(storeDir).sourceDir(sourceId), { recursive: true, force: true });
    manifest.sources = manifest.sources.filter((s) => s.id !== sourceId);
  };

  /** Index all sources currently in `indexing` state, then run the embed pass. */
  const processPending = async (projectId: string): Promise<void> => {
    const storeDir = storeDirOf(projectId);
    let manifest = await loadManifest(projectId);
    const pending = manifest.sources.filter((s) => s.status === 'indexing');
    for (const source of pending) {
      try {
        const extension = path.extname(source.fileName).slice(1).toLowerCase();
        const originalPath = path.join(storePaths(storeDir).sourceDir(source.id), `original.${extension}`);
        const buffer = await fs.readFile(originalPath);
        let markdown: string;
        if (CONVERTED_EXTENSIONS.has(extension)) {
          markdown = await deps.convertToMarkdown(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
            extension as 'docx' | 'xlsx'
          );
        } else {
          markdown = buffer.toString('utf8');
        }
        await fs.writeFile(path.join(storePaths(storeDir).sourceDir(source.id), 'converted.md'), markdown, 'utf8');
        let raw = chunkMarkdown(markdown);
        let truncated = false;
        if (raw.length > MAX_CHUNKS_PER_SOURCE) {
          raw = raw.slice(0, MAX_CHUNKS_PER_SOURCE);
          truncated = true;
        }
        const newChunks: KnowledgeChunk[] = raw.map((c, i) => ({
          chunkId: `${source.id}#${i}`,
          sourceId: source.id,
          chunkIndex: i,
          text: c.text,
          headingPath: c.headingPath,
          hasVector: false,
        }));
        const others = (await readChunks(storeDir)).filter((c) => c.sourceId !== source.id);
        const all = [...others, ...newChunks];
        await writeChunks(storeDir, all);
        await writeBm25(storeDir, buildBm25Index(all));
        source.status = 'ready';
        source.chunkCount = newChunks.length;
        source.error = truncated ? `Truncated to ${MAX_CHUNKS_PER_SOURCE} passages.` : null;
      } catch (error) {
        source.status = 'failed';
        source.error = error instanceof Error ? error.message : 'Indexing failed.';
      }
      await saveManifest(projectId, manifest);
    }
    // Embed pass (non-blocking semantics: failures leave sources ready, BM25-only).
    manifest = await embedMissingVectors(projectId, manifest);
    await saveManifest(projectId, manifest);
  };

  const embedMissingVectors = async (projectId: string, manifest: KnowledgeManifest): Promise<KnowledgeManifest> => {
    const storeDir = storeDirOf(projectId);
    const chunks = await readChunks(storeDir);
    const missing = chunks.filter((c) => !c.hasVector);
    if (missing.length === 0) return manifest;
    try {
      const providers = await deps.listProviders();
      let model = manifest.embedding?.model ?? null;
      if (!model) model = pickEmbeddingModel(providers)?.model ?? null;
      if (!model) return manifest; // no embedding provider anywhere — BM25-only
      const config = resolveEmbedConfigForModel(providers, model);
      if (!config) return manifest;
      const vectors = await embedTexts(
        missing.map((c) => c.text),
        config
      );
      const dim = vectors[0]?.length ?? 0;
      if (dim === 0) return manifest;
      if (!manifest.embedding) manifest.embedding = { model, dim };
      const existing = await readVectors(storeDir);
      const rows = existing && existing.dim === manifest.embedding.dim ? [...existing.rows.entries()] : [];
      missing.forEach((chunk, i) => {
        rows.push([chunk.chunkId, Float32Array.from(vectors[i])]);
        chunk.hasVector = true;
      });
      await writeVectors(storeDir, manifest.embedding.dim, rows);
      await writeChunks(storeDir, chunks);
      for (const source of manifest.sources) {
        source.vectorCount = chunks.filter((c) => c.sourceId === source.id && c.hasVector).length;
      }
    } catch {
      // Embedding is best-effort: sources stay ready with vectorCount < chunkCount.
    }
    return manifest;
  };

  const addSources = async (projectId: string, filePaths: string[]): Promise<void> => {
    const registered = enqueue(projectId, () => registerSources(projectId, filePaths));
    void enqueue(projectId, () => processPending(projectId));
    await registered;
  };

  // removeSource / retrySource / removeStore / getSessionMcpServer are added in Tasks 10–11.
  const removeSource = async (projectId: string, sourceId: string): Promise<void> =>
    enqueue(projectId, async () => {
      const manifest = await loadManifest(projectId);
      if (!manifest.sources.some((s) => s.id === sourceId)) return;
      await removeSourceRows(projectId, manifest, sourceId);
      await saveManifest(projectId, manifest);
    });

  const retrySource = async (projectId: string, sourceId: string): Promise<void> =>
    enqueue(projectId, async () => {
      const manifest = await loadManifest(projectId);
      const source = manifest.sources.find((s) => s.id === sourceId);
      if (!source) return;
      if (source.status === 'failed' && source.contentHash) {
        source.status = 'indexing';
        source.error = null;
        await saveManifest(projectId, manifest);
      }
      await processPending(projectId);
    });

  const removeStore = async (projectId: string): Promise<void> =>
    enqueue(projectId, async () => {
      await fs.rm(storeDirOf(projectId), { recursive: true, force: true });
      deps.onUpdated(projectId);
    });

  const getSessionMcpServer = async (projectId: string): Promise<ISessionMcpServer | null> => {
    const manifest = await readManifest(storeDirOf(projectId));
    if (!manifest) return null;
    if (!manifest.sources.some((s) => s.status === 'ready' && s.chunkCount > 0)) return null;
    const env: Record<string, string> = {
      AIONUI_KB_PROJECT_ID: projectId,
      AIONUI_KB_STORE_DIR: storeDirOf(projectId),
    };
    if (manifest.embedding) {
      const config = await deps
        .listProviders()
        .then((providers) => resolveEmbedConfigForModel(providers, manifest.embedding!.model))
        .catch((): EmbedConfig | null => null);
      if (config) {
        env.AIONUI_KB_EMBED_BASE_URL = config.baseUrl;
        env.AIONUI_KB_EMBED_API_KEY = config.apiKey;
        env.AIONUI_KB_EMBED_MODEL = config.model;
      }
    }
    return {
      id: `project-kb-${projectId}`,
      name: BUILTIN_KNOWLEDGE_NAME,
      transport: { type: 'stdio', command: 'node', args: [deps.getServerScriptPath()], env },
    };
  };

  const whenIdle = (projectId: string): Promise<void> => queues.get(projectId) ?? Promise.resolve();

  return { listSources, addSources, removeSource, retrySource, removeStore, getSessionMcpServer, whenIdle };
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test tests/unit/knowledge/projectKnowledgeService.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/common/types/project/knowledgeTypes.ts packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts tests/unit/knowledge/projectKnowledgeService.test.ts
git commit -m "feat(knowledge): add project knowledge service with ingestion pipeline"
```

---

### Task 10: Service — remove, retry, descriptor tests

`removeSource`/`retrySource`/`removeStore`/`getSessionMcpServer` were implemented in Task 9; this task locks their behavior with tests.

**Files:**
- Test: `tests/unit/knowledge/projectKnowledgeServiceLifecycle.test.ts`
- Modify (only if a test exposes a bug): `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts`

- [ ] **Step 1: Write the failing/locking tests**

```ts
// tests/unit/knowledge/projectKnowledgeServiceLifecycle.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readChunks } from '@/common/knowledge/store';
import type { IProvider } from '@/common/config/storage';
import { createProjectKnowledgeService, type ProjectKnowledgeService } from '@/process/services/projectKnowledge/projectKnowledgeService';

const EMBED_PROVIDER = {
  id: 'embed',
  platform: 'openai',
  name: 'E',
  base_url: 'https://api.x.com/v1',
  api_key: 'sk-1',
  models: ['text-embedding-3-small'],
} as IProvider;

describe('projectKnowledgeService lifecycle', () => {
  let root: string;
  let inbox: string;
  let embedMock: ReturnType<typeof vi.fn>;
  let providers: IProvider[];
  let service: ProjectKnowledgeService;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'kb-life-root-'));
    inbox = mkdtempSync(path.join(tmpdir(), 'kb-life-in-'));
    embedMock = vi.fn(async (texts: string[]) => texts.map(() => [0.5, 0.5]));
    providers = [EMBED_PROVIDER];
    service = createProjectKnowledgeService({
      storeRootDir: root,
      listProviders: async () => providers,
      embedTextsImpl: embedMock as never,
      convertToMarkdown: async () => '# converted',
      getServerScriptPath: () => '/out/main/builtin-mcp-knowledge.js',
      onUpdated: () => {},
    });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(inbox, { recursive: true, force: true });
  });

  const seed = async (name: string, content: string): Promise<string> => {
    const p = path.join(inbox, name);
    await writeFile(p, content, 'utf8');
    await service.addSources('p1', [p]);
    await service.whenIdle('p1');
    const { sources } = await service.listSources('p1');
    return sources.find((s) => s.fileName === name)!.id;
  };

  it('removeSource drops chunks, vectors, snapshot dir, and manifest row', async () => {
    const keepId = await seed('keep.md', 'keep this content');
    const dropId = await seed('drop.md', 'drop this content');
    await service.removeSource('p1', dropId);
    await service.whenIdle('p1');
    const { sources } = await service.listSources('p1');
    expect(sources.map((s) => s.id)).toEqual([keepId]);
    const chunks = await readChunks(path.join(root, 'p1'));
    expect(chunks.every((c) => c.sourceId === keepId)).toBe(true);
    expect(existsSync(path.join(root, 'p1', 'sources', dropId))).toBe(false);
  });

  it('retrySource re-embeds a ready source with missing vectors', async () => {
    embedMock.mockRejectedValueOnce(new Error('down'));
    const id = await seed('a.md', 'alpha beta gamma');
    expect((await service.listSources('p1')).sources[0].vectorCount).toBe(0);
    await service.retrySource('p1', id);
    await service.whenIdle('p1');
    expect((await service.listSources('p1')).sources[0].vectorCount).toBeGreaterThan(0);
  });

  it('retrySource re-runs a failed source from its snapshot', async () => {
    // Force a conversion failure, then let retry succeed.
    let fail = true;
    const svc = createProjectKnowledgeService({
      storeRootDir: root,
      listProviders: async () => [],
      embedTextsImpl: embedMock as never,
      convertToMarkdown: async () => {
        if (fail) throw new Error('converter crashed');
        return '# ok now';
      },
      getServerScriptPath: () => '/x.js',
      onUpdated: () => {},
    });
    const p = path.join(inbox, 'spec.docx');
    await writeFile(p, 'binary');
    await svc.addSources('p2', [p]);
    await svc.whenIdle('p2');
    let list = await svc.listSources('p2');
    expect(list.sources[0].status).toBe('failed');
    fail = false;
    await svc.retrySource('p2', list.sources[0].id);
    await svc.whenIdle('p2');
    list = await svc.listSources('p2');
    expect(list.sources[0].status).toBe('ready');
  });

  it('removeStore deletes the whole project directory', async () => {
    await seed('a.md', 'content');
    expect(existsSync(path.join(root, 'p1'))).toBe(true);
    await service.removeStore('p1');
    expect(existsSync(path.join(root, 'p1'))).toBe(false);
  });

  describe('getSessionMcpServer', () => {
    it('returns null with no store or no ready sources', async () => {
      expect(await service.getSessionMcpServer('p1')).toBeNull();
      const p = path.join(inbox, 'bad.pdf');
      await writeFile(p, 'x');
      await service.addSources('p1', [p]);
      await service.whenIdle('p1');
      expect(await service.getSessionMcpServer('p1')).toBeNull();
    });

    it('builds a stdio session server with full embed env', async () => {
      await seed('a.md', 'searchable content here');
      const server = await service.getSessionMcpServer('p1');
      expect(server).toMatchObject({ id: 'project-kb-p1', name: 'aionui-project-knowledge' });
      expect(server!.transport).toEqual({
        type: 'stdio',
        command: 'node',
        args: ['/out/main/builtin-mcp-knowledge.js'],
        env: {
          AIONUI_KB_PROJECT_ID: 'p1',
          AIONUI_KB_STORE_DIR: path.join(root, 'p1'),
          AIONUI_KB_EMBED_BASE_URL: 'https://api.x.com/v1',
          AIONUI_KB_EMBED_API_KEY: 'sk-1',
          AIONUI_KB_EMBED_MODEL: 'text-embedding-3-small',
        },
      });
    });

    it('omits embed env when the pinned model is no longer resolvable', async () => {
      await seed('a.md', 'content');
      providers = []; // provider got deleted after indexing
      const server = await service.getSessionMcpServer('p1');
      expect(server).not.toBeNull();
      const env = (server!.transport as { env: Record<string, string> }).env;
      expect(env.AIONUI_KB_EMBED_BASE_URL).toBeUndefined();
      expect(env.AIONUI_KB_STORE_DIR).toBe(path.join(root, 'p1'));
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun run test tests/unit/knowledge/projectKnowledgeServiceLifecycle.test.ts`
Expected: PASS if Task 9's implementation is correct; if any test fails, fix `projectKnowledgeService.ts` until green (the tests are the contract — do not weaken them).

- [ ] **Step 3: Run the whole knowledge suite**

Run: `bun run test tests/unit/knowledge`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add tests/unit/knowledge/projectKnowledgeServiceLifecycle.test.ts packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts
git commit -m "test(knowledge): lock remove/retry/store-cleanup/descriptor behavior"
```

---

### Task 11: IPC bindings + main bridge glue

**Files:**
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts` (append a namespace; `export * as ipcBridge` in `common/index.ts` picks it up automatically)
- Create: `packages/desktop/src/process/bridge/projectKnowledgeBridge.ts`
- Modify: `packages/desktop/src/process/bridge/index.ts` (register in `initAllBridges`)

No new unit test: the service is fully tested (Tasks 9–10) and this layer is declaration + one-line delegation, matching the repo's other untested bridge glue (`dialogBridge`, `themeBridge`, …). `tsc` enforces the type seam; the renderer-side contract is exercised by Task 12's and Task 13's tests through mocks of these bindings.

- [ ] **Step 1: Append the namespace to `ipcBridge.ts`** (after the `localContextCompaction` block, ~line 970)

```ts
// ---------------------------------------------------------------------------
// Project knowledge base — served by the main process (no aioncore endpoints)
// ---------------------------------------------------------------------------

export const projectKnowledge = {
  listSources: bridge.buildProvider<IProjectKnowledgeListResult, { projectId: string }>('project-knowledge.list-sources'),
  addSources: bridge.buildProvider<void, { projectId: string; filePaths: string[] }>('project-knowledge.add-sources'),
  removeSource: bridge.buildProvider<void, { projectId: string; sourceId: string }>('project-knowledge.remove-source'),
  retrySource: bridge.buildProvider<void, { projectId: string; sourceId: string }>('project-knowledge.retry-source'),
  removeStore: bridge.buildProvider<void, { projectId: string }>('project-knowledge.remove-store'),
  getSessionMcpServer: bridge.buildProvider<ISessionMcpServer | null, { projectId: string }>(
    'project-knowledge.get-session-mcp-server'
  ),
  updated: bridge.buildEmitter<{ projectId: string }>('project-knowledge.updated'),
};
```

Add the type import at the top of the file with the other `../types/` imports:

```ts
import type { IProjectKnowledgeListResult } from '../types/project/knowledgeTypes';
```

(`ISessionMcpServer` is already imported from `../config/storage`.)

- [ ] **Step 2: Create `projectKnowledgeBridge.ts`**

```ts
// packages/desktop/src/process/bridge/projectKnowledgeBridge.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Wires ipcBridge.projectKnowledge.* to the main-process knowledge service.
// The service is created lazily so initStorage's cacheDir is resolved first.

import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import type { IProvider } from '@/common/config/storage';
import { documentConverter } from '@/common/chat/document/DocumentConverter';
import { getBuiltinMcpScriptPath, getProjectKbRootDir } from '@process/utils/initStorage';
import { BUILTIN_KNOWLEDGE_SCRIPT } from '@process/resources/builtinMcp/constants';
import {
  createProjectKnowledgeService,
  type ProjectKnowledgeService,
} from '@process/services/projectKnowledge/projectKnowledgeService';

let service: ProjectKnowledgeService | null = null;

const getService = (): ProjectKnowledgeService => {
  service ??= createProjectKnowledgeService({
    storeRootDir: getProjectKbRootDir(),
    listProviders: () => httpRequest<IProvider[]>('GET', '/api/providers'),
    convertToMarkdown: (buffer, extension) =>
      extension === 'docx' ? documentConverter.wordToMarkdown(buffer) : documentConverter.excelToMarkdown(buffer),
    getServerScriptPath: () => getBuiltinMcpScriptPath(BUILTIN_KNOWLEDGE_SCRIPT),
    onUpdated: (projectId) => ipcBridge.projectKnowledge.updated.emit({ projectId }),
  });
  return service;
};

export function initProjectKnowledgeBridge(): void {
  ipcBridge.projectKnowledge.listSources.provider(({ projectId }) => getService().listSources(projectId));
  ipcBridge.projectKnowledge.addSources.provider(({ projectId, filePaths }) => getService().addSources(projectId, filePaths));
  ipcBridge.projectKnowledge.removeSource.provider(({ projectId, sourceId }) => getService().removeSource(projectId, sourceId));
  ipcBridge.projectKnowledge.retrySource.provider(({ projectId, sourceId }) => getService().retrySource(projectId, sourceId));
  ipcBridge.projectKnowledge.removeStore.provider(({ projectId }) => getService().removeStore(projectId));
  ipcBridge.projectKnowledge.getSessionMcpServer.provider(({ projectId }) => getService().getSessionMcpServer(projectId));
}
```

- [ ] **Step 3: Register in `process/bridge/index.ts`**

```ts
import { initProjectKnowledgeBridge } from './projectKnowledgeBridge';
```

and inside `initAllBridges` add:

```ts
  initProjectKnowledgeBridge();
```

Also re-export at the bottom alongside the others: add `initProjectKnowledgeBridge` to the `export { ... }` list.

- [ ] **Step 4: Typecheck + full suite**

Run: `bunx tsc --noEmit` → clean.
Run: `bun run test` → all pass (nothing should regress; this task adds no behavior change without callers).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix
git add packages/desktop/src/common/adapter/ipcBridge.ts packages/desktop/src/process/bridge/projectKnowledgeBridge.ts packages/desktop/src/process/bridge/index.ts
git commit -m "feat(knowledge): expose projectKnowledge IPC bindings from the main process"
```

---

### Task 12: Auto-attach in `useGuidSend`

**Files:**
- Modify: `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts`
- Test: `tests/unit/renderer/useGuidSend.dom.test.ts` (extend)

- [ ] **Step 1: Extend the test file's `@/common` mock and add failing tests**

In `tests/unit/renderer/useGuidSend.dom.test.ts`, add a module-scope mock fn and extend the existing `vi.mock('@/common', …)` factory:

```ts
const kbGetSessionMcpServerMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: {
        invoke: (...args: unknown[]) => createConversationInvokeMock(...args),
      },
    },
    projectKnowledge: {
      getSessionMcpServer: {
        invoke: (...args: unknown[]) => kbGetSessionMcpServerMock(...args),
      },
    },
  },
}));
```

Reset it in the existing `beforeEach`:

```ts
    kbGetSessionMcpServerMock.mockReset();
    kbGetSessionMcpServerMock.mockResolvedValue(null);
```

Append a new describe block at the end of the file:

```ts
describe('useGuidSend project knowledge attach', () => {
  const KB_SERVER = {
    id: 'project-kb-p1',
    name: 'aionui-project-knowledge',
    transport: { type: 'stdio', command: 'node', args: ['/out/main/builtin-mcp-knowledge.js'], env: { AIONUI_KB_PROJECT_ID: 'p1', AIONUI_KB_STORE_DIR: '/store/p1' } },
  };

  it('does not query the KB descriptor for non-project chats', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });
    expect(kbGetSessionMcpServerMock).not.toHaveBeenCalled();
  });

  it('appends the KB session server for a project chat (acp path)', async () => {
    kbGetSessionMcpServerMock.mockResolvedValue(KB_SERVER);
    const deps = createDeps();
    deps.projectId = 'p1';
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });
    expect(kbGetSessionMcpServerMock).toHaveBeenCalledWith({ projectId: 'p1' });
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.extra.selected_session_mcp_servers).toEqual(expect.arrayContaining([KB_SERVER]));
    // Pure session server: never referenced by repo-row id lists.
    expect(payload.extra.selected_mcp_server_ids ?? []).not.toContain(KB_SERVER.id);
    expect(payload.assistant?.conversation_overrides?.mcp_ids ?? []).not.toContain(KB_SERVER.id);
  });

  it('appends the KB session server for a project chat (aionrs path)', async () => {
    kbGetSessionMcpServerMock.mockResolvedValue(KB_SERVER);
    const deps = createDeps();
    deps.projectId = 'p1';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { id: 'prov', platform: 'openai', name: 'P', base_url: 'https://x', api_key: 'k', use_model: 'gpt-4o' } as never;
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.extra.selected_session_mcp_servers).toEqual(expect.arrayContaining([KB_SERVER]));
  });

  it('creates the conversation without the KB server when the descriptor is null or rejects', async () => {
    kbGetSessionMcpServerMock.mockRejectedValue(new Error('ipc down'));
    const deps = createDeps();
    deps.projectId = 'p1';
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });
    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    const payload = createConversationInvokeMock.mock.calls[0][0];
    const servers = (payload.extra.selected_session_mcp_servers ?? []) as Array<{ name: string }>;
    expect(servers.some((s) => s.name === 'aionui-project-knowledge')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify the new block fails**

Run: `bun run test tests/unit/renderer/useGuidSend.dom.test.ts`
Expected: the three new attach tests FAIL (`kbGetSessionMcpServerMock` never called / server absent); existing tests still PASS.

- [ ] **Step 3: Implement the attach in `useGuidSend.ts`**

Add `ISessionMcpServer` to the existing type import from `@/common/config/storage`:

```ts
import type { IMcpServer, ISessionMcpServer, TProviderWithModel } from '@/common/config/storage';
```

Directly under the `resolveInjectedContext` call (line ~193, after `const injectedContext = …`), add:

```ts
    // Project knowledge base: attach the per-project search server as a pure
    // session MCP (full stdio transport, never a repo-registered row) so the
    // agent can retrieve from the project's curated documents. Only attaches
    // for project chats whose knowledge index has at least one ready source.
    const kbSessionServer = projectId
      ? await ipcBridge.projectKnowledge.getSessionMcpServer.invoke({ projectId }).catch(() => null)
      : null;
    const withKbServer = (servers: ISessionMcpServer[]): ISessionMcpServer[] =>
      kbSessionServer && !servers.some((server) => server.name === kbSessionServer.name)
        ? [...servers, kbSessionServer]
        : servers;
```

In the **aionrs** create call, change:

```ts
            selected_session_mcp_servers: selectedSessionMcpServersToSend,
```

to:

```ts
            selected_session_mcp_servers: withKbServer(selectedSessionMcpServersToSend),
```

In the **acp** create call, change:

```ts
          selected_session_mcp_servers:
            selectedMcpServerIds !== undefined ? selectedSessionMcpServers : selectedSessionMcpServersToSend,
```

to:

```ts
          selected_session_mcp_servers: withKbServer(
            selectedMcpServerIds !== undefined ? selectedSessionMcpServers : selectedSessionMcpServersToSend
          ),
```

- [ ] **Step 4: Run the test file**

Run: `bun run test tests/unit/renderer/useGuidSend.dom.test.ts`
Expected: ALL tests pass (old + new).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts tests/unit/renderer/useGuidSend.dom.test.ts
git commit -m "feat(knowledge): auto-attach the project knowledge MCP server to project chats"
```

---

### Task 13: `useProjectKnowledge` renderer hook

**Files:**
- Create: `packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts`
- Test: `tests/unit/renderer/useProjectKnowledge.dom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/useProjectKnowledge.dom.test.ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProjectKnowledgeListResult } from '@/common/types/project/knowledgeTypes';
import { useProjectKnowledge } from '@/renderer/pages/project/hooks/useProjectKnowledge';

const listSourcesMock = vi.fn();
const addSourcesMock = vi.fn();
const removeSourceMock = vi.fn();
const retrySourceMock = vi.fn();
let updatedListener: ((payload: { projectId: string }) => void) | null = null;
const offMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    projectKnowledge: {
      listSources: { invoke: (...args: unknown[]) => listSourcesMock(...args) },
      addSources: { invoke: (...args: unknown[]) => addSourcesMock(...args) },
      removeSource: { invoke: (...args: unknown[]) => removeSourceMock(...args) },
      retrySource: { invoke: (...args: unknown[]) => retrySourceMock(...args) },
      updated: {
        on: (listener: (payload: { projectId: string }) => void) => {
          updatedListener = listener;
          return offMock;
        },
      },
    },
  },
}));

const RESULT: IProjectKnowledgeListResult = {
  sources: [
    { id: 's1', fileName: 'a.md', byteSize: 10, status: 'ready', chunkCount: 3, vectorCount: 3, addedAt: 1, error: null },
  ],
  summary: { fileCount: 1, passageCount: 3, semantic: 'on' },
};

describe('useProjectKnowledge', () => {
  beforeEach(() => {
    listSourcesMock.mockReset().mockResolvedValue(RESULT);
    addSourcesMock.mockReset().mockResolvedValue(undefined);
    removeSourceMock.mockReset().mockResolvedValue(undefined);
    retrySourceMock.mockReset().mockResolvedValue(undefined);
    offMock.mockReset();
    updatedListener = null;
  });

  it('loads sources on mount', async () => {
    const { result } = renderHook(() => useProjectKnowledge('p1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listSourcesMock).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(result.current.sources).toHaveLength(1);
    expect(result.current.summary?.semantic).toBe('on');
    expect(result.current.error).toBe(false);
  });

  it('sets error when listSources rejects', async () => {
    listSourcesMock.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useProjectKnowledge('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
  });

  it('refetches when an updated event for this project arrives, ignores others', async () => {
    const { result } = renderHook(() => useProjectKnowledge('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listSourcesMock).toHaveBeenCalledTimes(1);
    act(() => updatedListener?.({ projectId: 'other' }));
    expect(listSourcesMock).toHaveBeenCalledTimes(1);
    act(() => updatedListener?.({ projectId: 'p1' }));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalledTimes(2));
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useProjectKnowledge('p1'));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
    unmount();
    expect(offMock).toHaveBeenCalled();
  });

  it('addSources invokes IPC then refetches', async () => {
    const { result } = renderHook(() => useProjectKnowledge('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.addSources(['/tmp/x.md']);
    });
    expect(addSourcesMock).toHaveBeenCalledWith({ projectId: 'p1', filePaths: ['/tmp/x.md'] });
    expect(listSourcesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('removeSource and retrySource invoke IPC then refetch', async () => {
    const { result } = renderHook(() => useProjectKnowledge('p1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.removeSource('s1');
      await result.current.retrySource('s1');
    });
    expect(removeSourceMock).toHaveBeenCalledWith({ projectId: 'p1', sourceId: 's1' });
    expect(retrySourceMock).toHaveBeenCalledWith({ projectId: 'p1', sourceId: 's1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/renderer/useProjectKnowledge.dom.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement useProjectKnowledge.ts**

```ts
// packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IKnowledgeSourceDto, IProjectKnowledgeSummary } from '@/common/types/project/knowledgeTypes';
import { useCallback, useEffect, useState } from 'react';

export type UseProjectKnowledgeResult = {
  sources: IKnowledgeSourceDto[];
  summary: IProjectKnowledgeSummary | null;
  loading: boolean;
  error: boolean;
  addSources: (filePaths: string[]) => Promise<void>;
  removeSource: (sourceId: string) => Promise<void>;
  retrySource: (sourceId: string) => Promise<void>;
  refetch: () => Promise<void>;
};

/**
 * Data hook for the Project Home Knowledge card. Loads the project's
 * knowledge sources, refetches on the main process's `projectKnowledge.updated`
 * push (ingestion progresses in the background), and wraps the mutating IPC
 * calls with an eager refetch so the card reflects registration immediately.
 */
export const useProjectKnowledge = (projectId: string): UseProjectKnowledgeResult => {
  const [sources, setSources] = useState<IKnowledgeSourceDto[]>([]);
  const [summary, setSummary] = useState<IProjectKnowledgeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const result = await ipcBridge.projectKnowledge.listSources.invoke({ projectId });
      setSources(result.sources);
      setSummary(result.summary);
      setError(false);
    } catch (fetchError) {
      console.error('Failed to load project knowledge:', fetchError);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refetch();
    const unsubscribe = ipcBridge.projectKnowledge.updated.on((payload) => {
      if (payload.projectId === projectId) void refetch();
    });
    return unsubscribe;
  }, [projectId, refetch]);

  const addSources = useCallback(
    async (filePaths: string[]) => {
      await ipcBridge.projectKnowledge.addSources.invoke({ projectId, filePaths });
      await refetch();
    },
    [projectId, refetch]
  );

  const removeSource = useCallback(
    async (sourceId: string) => {
      await ipcBridge.projectKnowledge.removeSource.invoke({ projectId, sourceId });
      await refetch();
    },
    [projectId, refetch]
  );

  const retrySource = useCallback(
    async (sourceId: string) => {
      await ipcBridge.projectKnowledge.retrySource.invoke({ projectId, sourceId });
      await refetch();
    },
    [projectId, refetch]
  );

  return { sources, summary, loading, error, addSources, removeSource, retrySource, refetch };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/renderer/useProjectKnowledge.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts tests/unit/renderer/useProjectKnowledge.dom.test.ts
git commit -m "feat(knowledge): add useProjectKnowledge hook for the Project Home card"
```

---

### Task 14: `ProjectKnowledgeCard` + Project Home slot + en-US i18n

**Files:**
- Create: `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx`
- Modify: `packages/desktop/src/renderer/pages/project/ProjectHomePage.tsx` (add rail slot)
- Modify: `packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json` (add keys inside the existing `"projectHome"` object)
- Test: `tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx`

Arco components only (no raw interactive HTML); UnoCSS utilities + semantic tokens; every user-facing string through `t()`.

- [ ] **Step 1: Add en-US keys** — inside the existing `projectHome` object in `renderer/services/i18n/locales/en-US/conversation.json`:

```json
"knowledge": "Knowledge",
"knowledgeAdd": "Add files",
"knowledgeEmpty": "Add documents to build this project's knowledge base. The assistant searches them automatically in every project chat.",
"knowledgeSummary": "{{files}} files · {{passages}} passages",
"knowledgeSemanticOn": "semantic search on",
"knowledgeSemanticOff": "semantic off — no embedding model configured",
"knowledgePassages": "{{count}} passages",
"knowledgeStatusIndexing": "Indexing…",
"knowledgeStatusFailed": "Failed",
"knowledgeStatusUnsupported": "Unsupported",
"knowledgeRetry": "Retry",
"knowledgeRemove": "Remove",
"knowledgeRemoveConfirm": "Remove this file from the knowledge base?",
"knowledgeError": "The knowledge base is unavailable.",
"knowledgeSupportedTypes": "Supported: .md, .txt, .docx, .xlsx"
```

- [ ] **Step 2: Write the failing card test**

```tsx
// tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import type { IKnowledgeSourceDto } from '@/common/types/project/knowledgeTypes';

const useProjectKnowledgeMock = vi.fn();
const showOpenMock = vi.fn();

vi.mock('@/renderer/pages/project/hooks/useProjectKnowledge', () => ({
  useProjectKnowledge: (...args: unknown[]) => useProjectKnowledgeMock(...args),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: { showOpen: { invoke: (...args: unknown[]) => showOpenMock(...args) } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts && 'count' in opts ? `${key}:${opts.count}` : key) }),
}));

import ProjectKnowledgeCard from '@/renderer/pages/project/components/ProjectKnowledgeCard';

const PROJECT = { id: 'p1', name: 'P', workspace: '/w', created_at: 1, updated_at: 1 } as ForgeProject;

const source = (over: Partial<IKnowledgeSourceDto>): IKnowledgeSourceDto => ({
  id: 's1',
  fileName: 'a.md',
  byteSize: 10,
  status: 'ready',
  chunkCount: 3,
  vectorCount: 3,
  addedAt: 1,
  error: null,
  ...over,
});

const hookResult = (over: Partial<ReturnType<typeof baseHook>> = {}) => ({ ...baseHook(), ...over });
const baseHook = () => ({
  sources: [] as IKnowledgeSourceDto[],
  summary: { fileCount: 0, passageCount: 0, semantic: 'off' as const },
  loading: false,
  error: false,
  addSources: vi.fn(),
  removeSource: vi.fn(),
  retrySource: vi.fn(),
  refetch: vi.fn(),
});

describe('ProjectKnowledgeCard', () => {
  beforeEach(() => {
    useProjectKnowledgeMock.mockReset();
    showOpenMock.mockReset();
  });

  it('renders the empty state', () => {
    useProjectKnowledgeMock.mockReturnValue(hookResult());
    render(<ProjectKnowledgeCard project={PROJECT} />);
    expect(screen.getByTestId('project-knowledge-card')).toBeTruthy();
    expect(screen.getByText('conversation.projectHome.knowledgeEmpty')).toBeTruthy();
  });

  it('renders loading state', () => {
    useProjectKnowledgeMock.mockReturnValue(hookResult({ loading: true }));
    render(<ProjectKnowledgeCard project={PROJECT} />);
    expect(screen.getByTestId('project-knowledge-loading')).toBeTruthy();
  });

  it('renders error state', () => {
    useProjectKnowledgeMock.mockReturnValue(hookResult({ error: true }));
    render(<ProjectKnowledgeCard project={PROJECT} />);
    expect(screen.getByText('conversation.projectHome.knowledgeError')).toBeTruthy();
  });

  it('renders source rows with status-appropriate affordances', () => {
    useProjectKnowledgeMock.mockReturnValue(
      hookResult({
        sources: [
          source({ id: 'ok', fileName: 'ready.md', status: 'ready', chunkCount: 5 }),
          source({ id: 'run', fileName: 'busy.md', status: 'indexing' }),
          source({ id: 'bad', fileName: 'broken.docx', status: 'failed', error: 'converter crashed' }),
        ],
        summary: { fileCount: 3, passageCount: 5, semantic: 'on' },
      })
    );
    render(<ProjectKnowledgeCard project={PROJECT} />);
    expect(screen.getByText('ready.md')).toBeTruthy();
    expect(screen.getByText('conversation.projectHome.knowledgePassages:5')).toBeTruthy();
    expect(screen.getByText('conversation.projectHome.knowledgeStatusIndexing')).toBeTruthy();
    expect(screen.getByText('conversation.projectHome.knowledgeStatusFailed')).toBeTruthy();
    expect(screen.getByText('conversation.projectHome.knowledgeRetry')).toBeTruthy();
    // The summary line concatenates summary + semantic status into one text
    // node, so match by substring rather than exact text.
    expect(screen.getByText(/knowledgeSemanticOn/)).toBeTruthy();
  });

  it('opens the file dialog and forwards picked paths to addSources', async () => {
    const hook = hookResult();
    useProjectKnowledgeMock.mockReturnValue(hook);
    showOpenMock.mockResolvedValue(['/tmp/a.md', '/tmp/b.docx']);
    render(<ProjectKnowledgeCard project={PROJECT} />);
    await userEvent.click(screen.getByText('conversation.projectHome.knowledgeAdd'));
    await waitFor(() => expect(hook.addSources).toHaveBeenCalledWith(['/tmp/a.md', '/tmp/b.docx']));
    expect(showOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openFile', 'multiSelections'] })
    );
  });

  it('retry button calls retrySource', async () => {
    const hook = hookResult({ sources: [source({ id: 'bad', status: 'failed' })] });
    useProjectKnowledgeMock.mockReturnValue(hook);
    render(<ProjectKnowledgeCard project={PROJECT} />);
    await userEvent.click(screen.getByText('conversation.projectHome.knowledgeRetry'));
    expect(hook.retrySource).toHaveBeenCalledWith('bad');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement ProjectKnowledgeCard.tsx**

```tsx
// packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IKnowledgeSourceDto } from '@/common/types/project/knowledgeTypes';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import { Alert, Button, Card, Popconfirm, Spin, Tag, Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectKnowledge } from '../hooks/useProjectKnowledge';

export type ProjectKnowledgeCardProps = {
  project: ForgeProject;
};

const SUPPORTED_EXTENSIONS = ['md', 'txt', 'docx', 'xlsx'];

/**
 * Project Home knowledge card: the curated set of documents indexed into this
 * project's knowledge base. Every chat started in the project can search them
 * via the auto-attached `search_project_knowledge` MCP tool; this card is the
 * manage surface (add / list with index status / retry / remove).
 */
const ProjectKnowledgeCard: React.FC<ProjectKnowledgeCardProps> = ({ project }) => {
  const { t } = useTranslation();
  const { sources, summary, loading, error, addSources, removeSource, retrySource } = useProjectKnowledge(project.id);

  const handleAdd = async (): Promise<void> => {
    const picked = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('conversation.projectHome.knowledge'), extensions: SUPPORTED_EXTENSIONS }],
    });
    if (!picked || picked.length === 0) return;
    try {
      await addSources(picked);
    } catch (addError) {
      console.error('Failed to add knowledge sources:', addError);
    }
  };

  const renderStatus = (source: IKnowledgeSourceDto): React.ReactNode => {
    switch (source.status) {
      case 'indexing':
        return <Tag size='small'>{t('conversation.projectHome.knowledgeStatusIndexing')}</Tag>;
      case 'ready':
        return (
          <Tag size='small' color='green'>
            {t('conversation.projectHome.knowledgePassages', { count: source.chunkCount })}
          </Tag>
        );
      case 'failed':
        return (
          <span className='flex items-center gap-4px'>
            <Tooltip content={source.error ?? undefined}>
              <Tag size='small' color='red'>
                {t('conversation.projectHome.knowledgeStatusFailed')}
              </Tag>
            </Tooltip>
            <Button type='text' size='mini' onClick={() => void retrySource(source.id)}>
              {t('conversation.projectHome.knowledgeRetry')}
            </Button>
          </span>
        );
      case 'unsupported':
        return (
          <Tooltip content={t('conversation.projectHome.knowledgeSupportedTypes')}>
            <Tag size='small'>{t('conversation.projectHome.knowledgeStatusUnsupported')}</Tag>
          </Tooltip>
        );
    }
  };

  return (
    <Card
      data-testid='project-knowledge-card'
      title={t('conversation.projectHome.knowledge')}
      extra={
        <Button type='text' size='mini' onClick={() => void handleAdd()}>
          {t('conversation.projectHome.knowledgeAdd')}
        </Button>
      }
    >
      {loading ? (
        <div data-testid='project-knowledge-loading' className='flex items-center justify-center py-24px'>
          <Spin />
        </div>
      ) : error ? (
        <Alert type='warning' content={t('conversation.projectHome.knowledgeError')} />
      ) : sources.length === 0 ? (
        <div className='py-20px text-center text-13px text-t-secondary'>
          {t('conversation.projectHome.knowledgeEmpty')}
        </div>
      ) : (
        <div className='flex flex-col gap-8px'>
          <div className='max-h-280px overflow-y-auto flex flex-col gap-6px'>
            {sources.map((source) => (
              <div key={source.id} data-testid={`knowledge-source-${source.id}`} className='flex items-center justify-between gap-8px'>
                <span className='min-w-0 flex-1 truncate text-13px text-t-primary' title={source.fileName}>
                  {source.fileName}
                </span>
                {renderStatus(source)}
                <Popconfirm
                  title={t('conversation.projectHome.knowledgeRemoveConfirm')}
                  onOk={() => void removeSource(source.id)}
                >
                  <Button type='text' size='mini' status='danger'>
                    {t('conversation.projectHome.knowledgeRemove')}
                  </Button>
                </Popconfirm>
              </div>
            ))}
          </div>
          <span className='border-t border-t-light pt-8px text-center text-11px text-t-tertiary'>
            {summary
              ? `${t('conversation.projectHome.knowledgeSummary', { files: summary.fileCount, passages: summary.passageCount })} · ${summary.semantic === 'on' ? t('conversation.projectHome.knowledgeSemanticOn') : t('conversation.projectHome.knowledgeSemanticOff')}`
              : null}
          </span>
        </div>
      )}
    </Card>
  );
};

export default ProjectKnowledgeCard;
```

- [ ] **Step 5: Add the rail slot in `ProjectHomePage.tsx`**

Import:

```tsx
import ProjectKnowledgeCard from './components/ProjectKnowledgeCard';
```

Between the instructions slot and the files slot in the rail:

```tsx
          <div data-testid='project-knowledge-slot'>
            <ProjectKnowledgeCard project={project} />
          </div>
```

- [ ] **Step 6: Run tests + i18n type generation**

Run: `bun run test tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx` → PASS.
Run: `bun run test tests/unit/renderer` → no regressions (ProjectHomePage tests may assert rail slots; update any snapshot/slot-order assertion to include `project-knowledge-slot`).
Run: `bun run i18n:types` → regenerates types cleanly.

- [ ] **Step 7: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx packages/desktop/src/renderer/pages/project/ProjectHomePage.tsx packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx
git add -A packages/desktop/src/renderer/services/i18n # generated types, if tracked
git commit -m "feat(knowledge): add Knowledge card to Project Home"
```

---

### Task 15: Store cleanup on project delete

**Files:**
- Modify: `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx` (delete handler, ~line 131)
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts` (~line 277)

- [ ] **Step 1: Wire cleanup into both delete paths**

In `ProjectHeader.tsx`, after the successful `removeProject(project.id);` call add:

```ts
          void ipcBridge.projectKnowledge.removeStore.invoke({ projectId: project.id }).catch(() => {});
```

(`ipcBridge` is already imported in this file.)

In `useConversationActions.ts` (~line 277), after `const removedProject = removeProjectTarget.projectId ? removeProject(removeProjectTarget.projectId) : true;` add:

```ts
      if (removeProjectTarget.projectId) {
        void ipcBridge.projectKnowledge.removeStore.invoke({ projectId: removeProjectTarget.projectId }).catch(() => {});
      }
```

If `ipcBridge` is not imported in `useConversationActions.ts`, add `import { ipcBridge } from '@/common';` (check existing imports first — it likely already imports it for conversation actions).

- [ ] **Step 2: Check existing tests still pass; extend mocks if they fail**

Run: `bun run test tests/unit/renderer`
Expected: PASS. If a test fails because the mocked `@/common` lacks `projectKnowledge.removeStore`, add `projectKnowledge: { removeStore: { invoke: vi.fn().mockResolvedValue(undefined) } }` to that test's mock factory — the `.catch(() => {})` keeps production defensive, but a missing mock key throws synchronously at property access.

- [ ] **Step 3: Commit**

```bash
bun run lint:fix && bunx tsc --noEmit
git add -A packages/desktop/src/renderer tests/unit/renderer
git commit -m "feat(knowledge): clean up the knowledge store when a project is deleted"
```

---

### Task 16: Localize the 11 remaining locales + full gate

**Files:**
- Modify: `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`

- [ ] **Step 1: Add translations**

For each of the 11 locales, add the same 15 `projectHome.knowledge*` keys added to en-US in Task 14, translated naturally into that language (keep `{{count}}`, `{{files}}`, `{{passages}}` placeholders verbatim; keep the file-extension list `.md, .txt, .docx, .xlsx` untranslated). Follow the tone of the surrounding `projectHome.*` entries in each file.

- [ ] **Step 2: Validate i18n**

Run: `node scripts/check-i18n.js` → passes (all locales in parity).
Run: `bun run i18n:types` → clean.

- [ ] **Step 3: Full gate**

```bash
bun run lint:fix
bun run format
bunx tsc --noEmit
bun run test
node scripts/check-i18n.js
```

Expected: everything green (lint may print pre-existing *warnings* — only errors matter, per AGENTS.md).

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/services/i18n/locales
git commit -m "feat(knowledge): localize project knowledge strings across 12 locales"
```

---

### Task 17: Live smoke test in the dev app (manual, with the user)

Not a code task — a verification checklist before the MR. Requires a dev run (`bun run dev`) with at least one provider configured (see the dev-run notes: FORGE_ keys or a manually-added provider; an embedding-capable model makes the semantic half testable, otherwise expect BM25-only).

- [ ] 1. Open a project's Home page → Knowledge card shows the empty state.
- [ ] 2. Add a `.md` file → row appears (`Indexing…` → `N passages`); summary line correct.
- [ ] 3. Add a `.docx` → converts and becomes ready; add a `.pdf` → `Unsupported`.
- [ ] 4. Start a **new chat from the project** → ask a question answerable only from the added document → the agent calls `search_project_knowledge` (visible in the tool activity) and answers with the document's content, citing the filename.
- [ ] 5. Start a chat **outside** the project → confirm the tool is absent.
- [ ] 6. Remove the source → new project chats no longer attach the server (empty KB → no tool).
- [ ] 7. `rm` nothing / no embedding provider variant: temporarily remove the embedding-capable provider → new chats still search (BM25-only), summary shows "semantic off".

Record any issues; fix-forward with focused commits.

---

## Final integration (after all tasks green)

Per the repo flow (AGENTS.md + team convention): push with the gate and open the MR into `sprint1`.

```bash
just push -u origin feat/project-knowledge-base
glab mr create --source-branch feat/project-knowledge-base --target-branch sprint1 \
  --title "feat(knowledge): per-project knowledge base with hybrid retrieval" \
  --description "$(cat mr-body.md)" --yes
```

(Compose `mr-body.md` from `.github/pull_request_template.md`, checking only what was actually run. Do **not** push or open the MR without the user's explicit go-ahead.)

---

## Self-review notes (spec → plan coverage)

- Spec §2 store layout/architecture → Tasks 1, 7. §3 ingestion pipeline → Task 9 (register/process/embed, hash dedupe, caps) + Task 10 (retry/remove). §4 tool contract → Tasks 6, 7 (signature, RRF, degrade, payload cap, empty/missing-store messages). §5 auto-attach → Tasks 10 (descriptor), 11 (IPC), 12 (useGuidSend). §6 UI → Tasks 13, 14. §7 edge cases → distributed: unsupported/oversize/dedupe (Task 9), embed-fail-stays-ready (Tasks 9, 10), corrupt vectors tolerated (Task 1 readVectors), missing store at query (Tasks 6, 7), project delete (Task 15), empty query (Task 6), payload cap (Task 6), serialized ingestion (Task 9 queue). §8 testing → every task. §9 scope → no task exceeds it.
- Deliberately not implemented from spec §7: schemaVersion-drift **rebuild** (v1 ships schemaVersion 1 only; `loadStore` rejects non-1 rather than rebuilding — noted as future work in the MR body).
- Type-consistency: `ISessionMcpServer` reused from `common/config/storage`; `IKnowledgeSourceDto`/`IProjectKnowledgeListResult` defined once in Task 9 Step 1 and imported everywhere; service factory name `createProjectKnowledgeService` and method names identical across Tasks 9–13.
