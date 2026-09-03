# Stream D — Knowledge Base Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a visible `Knowledge Base/` folder inside each project workspace the source of truth for the project knowledge base — synced by diff, watched live, migrated from the private store — with preview/open/trash-delete UX and an agent-readable path advertised in the tool description.

**Architecture:** A pure scan module (`folderScan.ts`) reads + hashes the folder top-level with ignore/symlink/oversize rules; `projectKnowledgeService.syncFolder` migrates old store snapshots into the folder, diffs scan vs manifest by fileName+hash, and reuses the existing ingest pipeline (which now reads source bytes from the folder, keeping `converted.md` as cache/recovery). A debounced `fs.watch` module schedules syncs; the renderer registers watches (registry lives in localStorage). New/changed IPC channels are added to BOTH `NATIVE_BRIDGE_PROVIDER_KEYS` and `nativeBridgePayloadSchemas`. The card gains preview drawer, Open original, trash-backed Delete file, Refresh, and a folderMissing state; passages jargon is removed per user decisions (2026-07-29): clean ready rows, degraded-only footer, hover-revealed icons, right-side drawer.

**Tech Stack:** TypeScript (root tsconfig = `noImplicitAny` only, NOT strict), Vitest 4, Arco Design + UnoCSS, Electron `shell.trashItem`, Node `fs.watch`.

**Safety invariant (non-negotiable):** a missing/unreadable folder is an ERROR STATE (`folderMissing`), never a deletion signal. Sync performs ZERO index deletions unless the folder was successfully read. The test proving this is written FIRST and must be shown to fail when the guard is removed.

**Ground rules (from coordination doc):** never `git stash`; new bridge channels need `NATIVE_BRIDGE_PROVIDER_KEYS` + `nativeBridgePayloadSchemas` entries; Apache-2.0 `/** @license */` header on new files; lint baseline 847 warnings / 0 errors — judge by errors; scoped `bunx oxfmt <files>` only; no AI signatures in commits; do not push without approval.

---

## File map

**New:**
- `packages/desktop/src/common/knowledge/constants.ts` — `KNOWLEDGE_FOLDER_NAME` (shared: service, subprocess, renderer). Dir goes 9→10 children (at limit, OK).
- `packages/desktop/src/process/services/projectKnowledge/folderScan.ts` — scan/filter/hash.
- `packages/desktop/src/process/services/projectKnowledge/knowledgeFolderWatcher.ts` — debounced recursive watch manager.
- `packages/desktop/src/renderer/pages/project/components/KnowledgeSourcePreview.tsx` — the drawer.
- `packages/desktop/src/renderer/hooks/useKnowledgeFolderWatchers.ts` — boot registration (verify dir ≤10 first; fallback `renderer/pages/project/hooks/`).
- Tests: `tests/unit/knowledge/folderScan.test.ts`, `tests/unit/knowledge/folderSync.test.ts`, `tests/unit/knowledge/knowledgeFolderWatcher.test.ts`.

**Modified:**
- `common/knowledge/types.ts` (+`folderMissing?` on manifest), `common/types/project/knowledgeTypes.ts` (list result +`folderMissing`, summary −`passageCount`).
- `common/adapter/ipcBridge.ts`, `common/adapter/native/constants.ts`, `common/adapter/native/payloadSchemas.ts`.
- `process/services/projectKnowledge/projectKnowledgeService.ts` (syncFolder, migration, folder-reading processPending, trash delete, getSourceText).
- `process/bridge/projectKnowledgeBridge.ts` (new handlers, watcher instance, electron `shell.trashItem` dep).
- `process/resources/builtinMcp/knowledgeServer.ts` (description rewrite).
- `renderer/pages/project/hooks/useProjectKnowledge.ts` (takes `project`, +syncNow/folderMissing/preview), `renderer/pages/project/components/ProjectKnowledgeCard.tsx` (redesign), `renderer/pages/guid/hooks/useGuidSend.ts` (fire-and-forget sync), `renderer/main.tsx` (mount boot hook).
- `locales/*/conversation.json` ×12 + `bun run i18n:types`.
- Tests updated: `projectKnowledgeService.test.ts`, `projectKnowledgeBridge.test.ts`, `knowledgeServerEnv.test.ts`, `ProjectKnowledgeCard.dom.test.tsx`, `useProjectKnowledge.dom.test.ts`, `useGuidSend.dom.test.ts`.

**API surface changes (service):**
```ts
syncFolder(projectId: string, workspace: string): Promise<void>          // NEW — the backbone
getSourceText(projectId: string, sourceId: string): Promise<{ text: string; truncated: boolean }>  // NEW
addSources(projectId, filePaths, workspace)                              // +workspace: copy into folder, then sync
removeSource(projectId, sourceId, workspace)                             // +workspace: trash file, then remove rows
retrySource(projectId, sourceId, workspace)                              // +workspace: processPending reads folder files
```
Watcher is a separate module owned by the bridge; `watchFolder`/`unwatchFolder` are IPC-level, not service methods.

**Key semantic decisions (locked):**
- Source identity: manifest keyed by `fileName`; new sourceIds derive from `sha256(fileName + '\n' + contentHash).slice(0,12)` so two same-content files under different names never collide. Existing ids are never recomputed (no chunk churn).
- Same name + same hash + status `failed` → stays failed (manual Retry is the path; prevents re-reading a scanned 50-page PDF on every sync). Hash change always re-ingests.
- Oversize files (>15MB): scan stats before hashing, pseudo-hash `oversize:<byteSize>`, failed row, never read fully.
- `processPending` read errors: if the KB folder itself is gone → abort pass, set folderMissing, rows stay `indexing` (next sync rescues). If folder OK but one file unreadable → that source `failed`.
- Migration runs inside syncFolder before the scan; creates the folder only when workspace exists AND store snapshots remain to export. `folderMissing` is only set when `manifest.sources.length > 0`.
- Trash failure → keep index rows (no zombie re-index); file-already-gone → remove rows anyway.
- Preview reads `converted.md` only (it IS the indexed text, works while folder missing); 200k char cap.

---

### Task 0: Base sync + branch hygiene

**Files:** none (git only)

- [ ] **Step 0.1: Inspect the 2 commits origin/sprint1 is ahead by**

```bash
git -C /Users/lap16603/Projects/WePrompt-kb-folder fetch origin && git -C /Users/lap16603/Projects/WePrompt-kb-folder log --oneline --stat HEAD..origin/sprint1
```
Expected: unrelated-to-KB commits (e.g. persona label fix / eval harness). If they touch `projectKnowledgeService.ts` / `ProjectKnowledgeCard.tsx` / locales knowledge keys, STOP and report before proceeding.

- [ ] **Step 0.2: Fast-forward**

```bash
git -C /Users/lap16603/Projects/WePrompt-kb-folder merge --ff-only origin/sprint1 && bunx tsc --noEmit
```
Expected: `Fast-forward`, tsc clean.

---

### Task 1: `KNOWLEDGE_FOLDER_NAME` + folder scan module (TDD)

**Files:**
- Create: `packages/desktop/src/common/knowledge/constants.ts`
- Create: `packages/desktop/src/process/services/projectKnowledge/folderScan.ts`
- Test: `tests/unit/knowledge/folderScan.test.ts`

- [ ] **Step 1.1: Write the failing tests** — cover: missing folder → `{ok:false, reason:'missing'}`; unreadable (a FILE at the folder path) → not-ok; ignore `.DS_Store`, dotfiles, `~$lock.docx`; subdirectories ignored; unsupported extension listed in `unsupported`; supported file hashed `sha256:<hex>` with byteSize; oversize file → `oversize` entry with pseudo-hash, content never hashed; symlink resolving outside folder skipped entirely; symlink resolving inside folder included.

- [ ] **Step 1.2: Run to verify failure** — `bun run test tests/unit/knowledge/folderScan.test.ts` → FAIL (module not found).

- [ ] **Step 1.3: Implement** `constants.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// The visible knowledge folder inside a project workspace. Fixed English name,
// deliberately NOT localised: it is a path the agent reads in tool output and
// it must stay stable when the project moves between machines/locales.
export const KNOWLEDGE_FOLDER_NAME = 'Knowledge Base';
```

`folderScan.ts` — full implementation:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Reads the top level of a project's `Knowledge Base/` folder and classifies
// every entry, hashing supported files. Pure with respect to the manifest —
// the sync diff lives in projectKnowledgeService. A failed read is a distinct
// result, NEVER an empty listing: callers must treat {ok:false} as "unknown",
// not "no files" (the missing-folder deletion guard depends on it).

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SUPPORTED_KNOWLEDGE_EXTENSIONS = new Set(['md', 'txt', 'docx', 'xlsx', 'pdf']);
export const MAX_KNOWLEDGE_FILE_BYTES = 15 * 1024 * 1024;

export type KnowledgeScanEntry = {
  fileName: string;
  byteSize: number;
  /** `sha256:<hex>`, or `oversize:<byteSize>` for files beyond the cap (never read). */
  contentHash: string;
  kind: 'supported' | 'oversize';
};

export type KnowledgeFolderScan =
  | { ok: true; entries: KnowledgeScanEntry[]; unsupported: string[] }
  | { ok: false; reason: 'missing' | 'unreadable' };

const isIgnoredName = (name: string): boolean =>
  name.startsWith('.') || name.startsWith('~$');

export const scanKnowledgeFolder = async (folderPath: string): Promise<KnowledgeFolderScan> => {
  let dirents;
  try {
    dirents = await fs.readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, reason: code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  const resolvedFolder = path.resolve(folderPath);
  const entries: KnowledgeScanEntry[] = [];
  const unsupported: string[] = [];
  for (const dirent of dirents) {
    const name = dirent.name;
    if (isIgnoredName(name)) continue;
    if (dirent.isDirectory()) continue; // v1: top-level files only
    const fullPath = path.join(folderPath, name);
    if (dirent.isSymbolicLink()) {
      // Containment: a link pointing outside the folder (e.g. ~/.ssh/…) must
      // never be indexed into prompts. Also skip links whose target is gone
      // or is a directory.
      let real: string;
      try {
        real = await fs.realpath(fullPath);
      } catch {
        continue;
      }
      if (!real.startsWith(resolvedFolder + path.sep)) continue;
      try {
        if (!(await fs.stat(fullPath)).isFile()) continue;
      } catch {
        continue;
      }
    } else if (!dirent.isFile()) {
      continue;
    }
    const extension = path.extname(name).slice(1).toLowerCase();
    if (!SUPPORTED_KNOWLEDGE_EXTENSIONS.has(extension)) {
      unsupported.push(name);
      continue;
    }
    let byteSize: number;
    try {
      byteSize = (await fs.stat(fullPath)).size;
    } catch {
      continue; // vanished mid-scan — the next sync sees the settled state
    }
    if (byteSize > MAX_KNOWLEDGE_FILE_BYTES) {
      entries.push({ fileName: name, byteSize, contentHash: `oversize:${byteSize}`, kind: 'oversize' });
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(fullPath);
    } catch {
      continue;
    }
    entries.push({
      fileName: name,
      byteSize: buffer.byteLength,
      contentHash: `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
      kind: 'supported',
    });
  }
  return { ok: true, entries, unsupported };
};
```

- [ ] **Step 1.4: Run tests** → PASS.
- [ ] **Step 1.5: Commit** — `feat(knowledge): add knowledge folder scan with ignore and symlink containment rules`

---

### Task 2: THE GUARD + syncFolder diff (TDD — guard test first)

**Files:**
- Modify: `common/knowledge/types.ts` (manifest `folderMissing?: boolean`), `common/types/project/knowledgeTypes.ts` (`IProjectKnowledgeListResult.folderMissing: boolean`; drop `passageCount` from summary)
- Modify: `projectKnowledgeService.ts`
- Test: `tests/unit/knowledge/folderSync.test.ts` (new), update `projectKnowledgeService.test.ts`

- [ ] **Step 2.1: Write THE failing guard test first** (temp dirs like the existing service suite; a `syncedProject(files)` helper creates workspace + `Knowledge Base/` + files, runs `syncFolder`, waits `whenIdle`):
  - `missing folder performs ZERO deletions and flags folderMissing`: sync 2 files to ready → `rmSync(kbDir, {recursive:true})` → `syncFolder` again → expect both sources still listed, `readChunks` non-empty, `listSources(...).folderMissing === true`.
  - `unreadable folder (replaced by a file) also performs zero deletions`.
  - Recovery: restore folder with same files → sync → `folderMissing === false`, sources unchanged (same ids — no re-ingest churn).
- [ ] **Step 2.2: Add the happy-path diff tests**: new file indexed; changed hash re-ingested (new chunks searchable, old row replaced); unchanged = no-op (ids and updates count stable); vanished file (folder still readable) → rows removed; unsupported extension in folder → `unsupported` row, removed when file removed; oversize → failed row with 15 MB message; same-hash failed row stays failed; empty-manifest + missing folder → NOT folderMissing (benign new project).
- [ ] **Step 2.3: Run** → FAIL (`syncFolder` not a function).
- [ ] **Step 2.4: Implement** in `projectKnowledgeService.ts`:
  - `import { scanKnowledgeFolder, type KnowledgeScanEntry } from './folderScan'` (+ DI `scanFolderImpl?`), `import { KNOWLEDGE_FOLDER_NAME } from '@/common/knowledge/constants'`.
  - `const knowledgeDirOf = (workspace: string) => path.join(workspace, KNOWLEDGE_FOLDER_NAME);`
  - `const deriveSourceId = (fileName, contentHash) => createHash('sha256').update(\`${fileName}\n${contentHash}\`).digest('hex').slice(0, 12);`
  - `syncFolder(projectId, workspace)` = `enqueue(registerFromFolder)` then `void enqueue(processPending(projectId, workspace))` (mirror addSources’ two-job shape). `registerFromFolder`:

```ts
const registerFromFolder = async (projectId: string, workspace: string): Promise<void> => {
  const manifest = await loadManifest(projectId);
  await migrateStoreSnapshots(projectId, manifest, workspace); // Task 3 (no-op stub until then)
  const scan = await scanFolder(knowledgeDirOf(workspace));
  if (!scan.ok) {
    // THE GUARD. A transient unmount, Downloads cleanup, or renamed workspace
    // must surface as an error state — never as "all files were deleted".
    // No row removal of any kind may happen on this path.
    const missing = manifest.sources.length > 0;
    if (manifest.folderMissing !== missing) {
      manifest.folderMissing = missing;
      await saveManifest(projectId, manifest);
    } else {
      deps.onUpdated(projectId);
    }
    return;
  }
  if (manifest.folderMissing) manifest.folderMissing = false;
  const seen = new Set<string>();
  for (const entry of scan.entries) {
    seen.add(entry.fileName);
    const existing = manifest.sources.find((s) => s.fileName === entry.fileName);
    if (existing && existing.contentHash === entry.contentHash) continue; // no-op (incl. failed: Retry is the path)
    if (existing) await removeSourceRows(projectId, manifest, existing.id);
    const base = { fileName: entry.fileName, byteSize: entry.byteSize, contentHash: entry.contentHash,
      chunkCount: 0, vectorCount: 0, addedAt: Date.now() };
    manifest.sources.push(entry.kind === 'oversize'
      ? { ...base, id: deriveSourceId(entry.fileName, entry.contentHash), status: 'failed', error: 'File exceeds the 15 MB limit.' }
      : { ...base, id: deriveSourceId(entry.fileName, entry.contentHash), status: 'indexing', error: null });
  }
  for (const name of scan.unsupported) {
    seen.add(name);
    if (manifest.sources.some((s) => s.fileName === name)) continue;
    manifest.sources.push({ id: deriveSourceId(name, 'unsupported'), fileName: name, contentHash: '', byteSize: 0,
      status: 'unsupported', chunkCount: 0, vectorCount: 0, addedAt: Date.now(),
      error: `Unsupported file type. ${SUPPORTED_EXTENSIONS_HINT}` });
  }
  for (const source of [...manifest.sources]) {
    if (!seen.has(source.fileName)) await removeSourceRows(projectId, manifest, source.id); // reachable ONLY after scan.ok
  }
  await saveManifest(projectId, manifest);
};
```

  - `processPending(projectId, workspace)`: replace the `original.<ext>` read with `path.basename(source.fileName)` under `knowledgeDirOf(workspace)`; on read error: `stat(knowledgeDir)` — folder gone → set folderMissing=true, save, `return` (rows stay `indexing`); folder OK → source `failed` `'Could not read the file.'`. After successful read: if buffer hash ≠ `source.contentHash` → update hash/byteSize (file changed between scan and read; index what exists). Keep converted.md write + chunk/BM25/embed passes untouched.
  - `retrySource(projectId, sourceId, workspace)` passes workspace through.
  - `listSources` returns `folderMissing: manifest.folderMissing === true` and summary without `passageCount`.
  - Update existing `projectKnowledgeService.test.ts` expectations: summary shape, addSources/retrySource signatures (this task changes retry; addSources changes in Task 5 — keep old addSources working against the store-snapshot path until Task 5 REPLACES registerSources; if interim duplication hurts, fold Task 5 into this task rather than leaving dead paths).
- [ ] **Step 2.5: Run full knowledge suite** → PASS.
- [ ] **Step 2.6: Guard mutation check** — temporarily replace the `if (!scan.ok)` early-return with `scan = {ok:true, entries:[], unsupported:[]}` → run → guard test MUST FAIL → restore → PASS. Record in commit message body that the mutation check was performed.
- [ ] **Step 2.7: Commit** — `feat(knowledge): sync knowledge folder by fileName+hash diff with missing-folder guard`

---

### Task 3: One-time migration of store snapshots (TDD)

**Files:** `projectKnowledgeService.ts` (`migrateStoreSnapshots`), tests in `folderSync.test.ts`

- [ ] **Step 3.1: Failing tests**: seed a store via the OLD path (write `sources/<id>/original.md` + manifest row directly with store helpers) → sync → file exported to `Knowledge Base/<fileName>` with identical bytes; store original deleted; manifest hash unchanged (no re-ingest — status still ready, same id); folder already has same-hash file → snapshot deleted, nothing written; folder has different-hash file under that name → snapshot exported as `name (from knowledge base).ext` AND both index; export-verify failure (make target dir read-only or inject write failure) → store original NOT deleted; workspace missing → no migration, no folder created, folderMissing set (sources exist).
- [ ] **Step 3.2: Run** → FAIL.
- [ ] **Step 3.3: Implement** `migrateStoreSnapshots(projectId, manifest, workspace)`:

```ts
// One-time, per project: export legacy store snapshots into the visible
// folder, verify by re-hash, and only then delete the store original.
// converted.md and index rows are untouched (straight exports keep the
// manifest hash, so no re-index churn).
const migrateStoreSnapshots = async (projectId, manifest, workspace) => {
  const storeDir = storeDirOf(projectId);
  const candidates = [];
  for (const source of manifest.sources) {
    if (!source.contentHash.startsWith('sha256:')) continue;
    const ext = path.extname(source.fileName).slice(1).toLowerCase();
    const snapshotPath = path.join(storePaths(storeDir).sourceDir(source.id), `original.${ext}`);
    try { await fs.access(snapshotPath); } catch { continue; }
    candidates.push({ source, snapshotPath, ext });
  }
  if (candidates.length === 0) return;
  try { if (!(await fs.stat(workspace)).isDirectory()) return; } catch { return; } // folderMissing handled by scan
  const kbDir = knowledgeDirOf(workspace);
  await fs.mkdir(kbDir, { recursive: true });
  for (const { source, snapshotPath, ext } of candidates) {
    try {
      const buffer = await fs.readFile(snapshotPath);
      const hash = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
      let targetName = source.fileName;
      const targetPath = path.join(kbDir, path.basename(targetName));
      const existing = await fs.readFile(targetPath).then(
        (b): string => `sha256:${createHash('sha256').update(b).digest('hex')}`,
        (): null => null
      );
      if (existing === hash) { await fs.rm(snapshotPath, { force: true }); continue; }
      if (existing !== null) {
        const base = path.basename(targetName, path.extname(targetName));
        targetName = `${base} (from knowledge base).${ext}`;
      }
      const exportPath = path.join(kbDir, path.basename(targetName));
      await fs.writeFile(exportPath, buffer);
      const verify = await fs.readFile(exportPath);
      if (`sha256:${createHash('sha256').update(verify).digest('hex')}` !== hash) continue; // keep snapshot
      await fs.rm(snapshotPath, { force: true });
    } catch (error) {
      console.warn(`[projectKnowledge] snapshot export failed for ${source.fileName}:`, error instanceof Error ? error.message : error);
    }
  }
};
```
(Note: suffixed exports get indexed as a NEW source by the normal scan diff on the same sync pass.)
- [ ] **Step 3.4: Run** → PASS. **Step 3.5: Commit** — `feat(knowledge): migrate private-store snapshots into the knowledge folder`

---

### Task 4: Delete-file (trash) + getSourceText (TDD)

**Files:** `projectKnowledgeService.ts`, deps `+ trashItem: (filePath: string) => Promise<void>`, tests in `folderSync.test.ts`

- [ ] **Step 4.1: Failing tests**: removeSource trashes `Knowledge Base/<fileName>` via injected mock then removes rows; file already gone → rows removed, trash not called (or tolerated); trash throws → rows KEPT, error propagates; **`fs.rm` is never invoked on a path inside the workspace** (spy on `fs.rm` — every call must target the store dir); getSourceText returns converted.md text; 200k cap sets `truncated: true`; missing converted.md → throws.
- [ ] **Step 4.2: Run** → FAIL.
- [ ] **Step 4.3: Implement**:

```ts
const removeSource = (projectId, sourceId, workspace) =>
  enqueue(projectId, async () => {
    const manifest = await loadManifest(projectId);
    const source = manifest.sources.find((s) => s.id === sourceId);
    if (!source) return;
    const filePath = path.join(knowledgeDirOf(workspace), path.basename(source.fileName));
    const exists = await fs.access(filePath).then(() => true, () => false);
    // Trash BEFORE dropping rows: if trashing fails the row must survive,
    // otherwise the watcher would immediately re-index a file the user asked
    // to delete. NEVER fs.rm here — the file belongs to the user.
    if (exists) await deps.trashItem(filePath);
    await removeSourceRows(projectId, manifest, sourceId);
    await saveManifest(projectId, manifest);
  });

const MAX_PREVIEW_CHARS = 200_000;
const getSourceText = async (projectId, sourceId) => {
  const manifest = await loadManifest(projectId);
  const source = manifest.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error('Source not found.');
  const converted = path.join(storePaths(storeDirOf(projectId)).sourceDir(sourceId), 'converted.md');
  const text = await fs.readFile(converted, 'utf8');
  return text.length > MAX_PREVIEW_CHARS
    ? { text: text.slice(0, MAX_PREVIEW_CHARS), truncated: true }
    : { text, truncated: false };
};
```
- [ ] **Step 4.4: Run** → PASS. **Step 4.5: Commit** — `feat(knowledge): trash-backed delete-file and indexed-text preview read`

---

### Task 5: addSources copies into the folder (TDD)

**Files:** `projectKnowledgeService.ts` (replace `registerSources` with copy-then-sync), tests

- [ ] **Step 5.1: Failing tests**: addSources(files, workspace) copies picked files into `Knowledge Base/` (created if needed) and indexes them from there (store has NO `original.<ext>`); picking a file already inside the folder does not self-copy; name collision with different content overwrites (replace-by-fileName semantic, matches previous behavior); unchanged re-add no-op. Update legacy tests that asserted snapshot-store behavior (`registerSources` paths, unsupported/oversize picks now surface via scan rows).
- [ ] **Step 5.2: Run** → FAIL. **Step 5.3: Implement**: register job = `mkdir kbDir` + for each picked path: `const dest = path.join(kbDir, path.basename(p)); if (path.resolve(p) !== path.resolve(dest)) await fs.copyFile(p, dest);` then run `registerFromFolder`; delete the old `registerSources` body. `addSources` keeps the two-job shape (await registration, void processPending).
- [ ] **Step 5.4: Run full knowledge suite** → PASS. **Step 5.5: Commit** — `feat(knowledge): route added files through the knowledge folder as source of truth`

---

### Task 6: Watcher module (TDD, fake timers)

**Files:** Create `knowledgeFolderWatcher.ts`; test `knowledgeFolderWatcher.test.ts`

- [ ] **Step 6.1: Failing tests** (inject `watchImpl`; `vi.useFakeTimers`): burst of N events → exactly one `onSync` after debounce (default 1000ms); events for two projects debounce independently; re-watch same workspace → no re-open; changed workspace → old watcher closed, new opened; `watchImpl` throws (ENOENT) → no crash, entry degraded, next `watch()` retries; `unwatch` closes + cancels pending timer; `dispose` closes all.
- [ ] **Step 6.2: Run** → FAIL. **Step 6.3: Implement**:

```ts
/**
 * @license … (Apache-2.0 header)
 */

// Debounced fs.watch manager for the per-project `Knowledge Base/` folders.
// Events carry no data downstream — they only schedule a folder sync, so the
// sync's own scan/diff/guard semantics stay the single source of truth.
// Registration is renderer-driven (the project registry lives in renderer
// localStorage; main cannot enumerate projects at boot).

import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { KNOWLEDGE_FOLDER_NAME } from '@/common/knowledge/constants';

export type KnowledgeFolderWatcherDeps = {
  onSync: (projectId: string, workspace: string) => void;
  watchImpl?: typeof watch;
  debounceMs?: number;
};
export type KnowledgeFolderWatcher = {
  watch: (projectId: string, workspace: string) => void;
  unwatch: (projectId: string) => void;
  dispose: () => void;
};

type Entry = { workspace: string; watcher: FSWatcher | null; timer: NodeJS.Timeout | null };

export const createKnowledgeFolderWatcher = (deps: KnowledgeFolderWatcherDeps): KnowledgeFolderWatcher => {
  const watchImpl = deps.watchImpl ?? watch;
  const debounceMs = deps.debounceMs ?? 1000;
  const entries = new Map<string, Entry>();

  const close = (entry: Entry): void => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    try { entry.watcher?.close(); } catch { /* already dead */ }
    entry.watcher = null;
  };

  const schedule = (projectId: string, entry: Entry): void => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { entry.timer = null; deps.onSync(projectId, entry.workspace); }, debounceMs);
  };

  const watchProject = (projectId: string, workspace: string): void => {
    const existing = entries.get(projectId);
    if (existing && existing.workspace === workspace && existing.watcher) return; // idempotent (and the degraded-retry path when watcher is null)
    if (existing) close(existing);
    const entry: Entry = { workspace, watcher: null, timer: null };
    entries.set(projectId, entry);
    try {
      const watcher = watchImpl(path.join(workspace, KNOWLEDGE_FOLDER_NAME), { recursive: true, persistent: false }, () => schedule(projectId, entry));
      watcher.on('error', () => close(entry)); // degrade; retried on the next watch() call after a sync
      entry.watcher = watcher;
    } catch {
      // Folder absent (not created yet / deleted). Sync-points still cover the
      // project; the bridge re-calls watch() after every sync, which retries.
    }
  };

  return {
    watch: watchProject,
    unwatch: (projectId) => { const e = entries.get(projectId); if (e) { close(e); entries.delete(projectId); } },
    dispose: () => { for (const e of entries.values()) close(e); entries.clear(); },
  };
};
```
- [ ] **Step 6.4: Run** → PASS. **Step 6.5: Commit** — `feat(knowledge): debounced knowledge-folder watcher module`

---

### Task 7: IPC plumbing — the two traps

**Files:** `common/adapter/ipcBridge.ts`, `common/adapter/native/constants.ts`, `common/adapter/native/payloadSchemas.ts`, `process/bridge/projectKnowledgeBridge.ts`; test `projectKnowledgeBridge.test.ts`

- [ ] **Step 7.1: Failing test additions**: every channel below present in `NATIVE_BRIDGE_PROVIDER_KEYS` AND `nativeBridgePayloadSchemas`; schema round-trips (valid payload accepted, extra key rejected via `.strict()`, traversal projectId rejected).
- [ ] **Step 7.2: Implement**:
  - ipcBridge additions/changes:

```ts
addSources: bridge.buildProvider<void, { projectId: string; filePaths: string[]; workspace: string }>('project-knowledge.add-sources'),
removeSource: bridge.buildProvider<void, { projectId: string; sourceId: string; workspace: string }>('project-knowledge.remove-source'),
retrySource: bridge.buildProvider<void, { projectId: string; sourceId: string; workspace: string }>('project-knowledge.retry-source'),
syncFolder: bridge.buildProvider<void, { projectId: string; workspace: string }>('project-knowledge.sync-folder'),
watchFolder: bridge.buildProvider<void, { projectId: string; workspace: string }>('project-knowledge.watch-folder'),
unwatchFolder: bridge.buildProvider<void, { projectId: string }>('project-knowledge.unwatch-folder'),
getSourceText: bridge.buildProvider<{ text: string; truncated: boolean }, { projectId: string; sourceId: string }>('project-knowledge.get-source-text'),
```
  - constants.ts: add `'project-knowledge.sync-folder'`, `'project-knowledge.watch-folder'`, `'project-knowledge.unwatch-folder'`, `'project-knowledge.get-source-text'`.
  - payloadSchemas.ts: `const projectKnowledgeFolderSchema = z.object({ projectId: safeIdSchema, workspace: pathSchema }).strict();` used by sync/watch; unwatch = projectIdSchema; get-source-text = sourceRefSchema; add-sources/remove-source/retry-source gain `workspace: pathSchema`.
  - Bridge: `import { shell } from 'electron'`; deps `+ trashItem: (filePath) => shell.trashItem(filePath)`; module-level watcher `createKnowledgeFolderWatcher({ onSync: (projectId, workspace) => { void getService().syncFolder(projectId, workspace).then(() => watcher.watch(projectId, workspace)).catch(...) } })`; handlers: syncFolder → `service.syncFolder` then `watcher.watch` (registration retry after success); watchFolder → `watcher.watch` + fire-and-forget initial `syncFolder` (boot catch-up); unwatchFolder → `watcher.unwatch`; removeStore handler also `watcher.unwatch(projectId)`.
- [ ] **Step 7.3: Run bridge + full knowledge tests** → PASS (no `contextCompactionBridge.test.ts` change needed — no new bridge init added).
- [ ] **Step 7.4: Commit** — `feat(knowledge): expose folder sync, watch, preview, and trash-delete over IPC`

---

### Task 8: Tool description rewrite

**Files:** `knowledgeServer.ts`; test `knowledgeServerEnv.test.ts` (or wherever `buildToolDescription` is covered)

- [ ] **Step 8.1: Failing test**: description names `Knowledge Base/` as readable with file tools; no longer claims documents are unreachable by file tools; still lists attached filenames.
- [ ] **Step 8.2: Implement** — replace `TOOL_DESCRIPTION_BASE`:

```
Search the documents in this project's knowledge base for passages relevant to a question.

USE THIS FIRST — before file listing, glob, or grep — when the user asks about specs, reports, policies, requirements, decisions, or any other project document: it searches every document at once and returns the most relevant passages with their source filenames.

For whole-document questions (summarise X, list every item in Y, read the full contract), search first to identify the right file, then read it directly: each knowledge document is an ordinary file at "Knowledge Base/<fileName>" inside the working directory, readable with your file tools.

Input:
- query: natural-language question or keywords.
- max_results: optional, defaults to 6 (max 20).

Output: the most relevant passages, each cited with its source filename so you can attribute your answer.
```
- [ ] **Step 8.3: Run** → PASS. **Step 8.4: Commit** — `feat(knowledge): advertise whole-document reads via the knowledge folder in the tool description`

---

### Task 9: Renderer hook (`useProjectKnowledge`)

**Files:** `useProjectKnowledge.ts`; test `useProjectKnowledge.dom.test.ts`

- [ ] Signature `useProjectKnowledge(project: ForgeProject)`; state `+ folderMissing: boolean`; mount effect fires `void syncFolder({projectId, workspace})` (in addition to refetch/subscribe, re-runs when workspace changes); returns `+ syncNow()` (awaits syncFolder then refetch), `+ getSourceText(sourceId)`; `addSources`/`removeSource`/`retrySource` pass `workspace: project.workspace`. TDD: update/extend the dom test (mount fires syncFolder; syncNow invokes IPC; folderMissing surfaces; mutations carry workspace).
- [ ] Commit — `feat(knowledge): folder-aware project knowledge hook with sync-on-mount`

---

### Task 10: Card redesign + preview drawer + EN i18n

**Files:** `ProjectKnowledgeCard.tsx`, create `KnowledgeSourcePreview.tsx`, `locales/en-US/conversation.json`, run `bun run i18n:types`; test `ProjectKnowledgeCard.dom.test.tsx`

Per user decisions: **clean ready rows** (no tag when ready & no progress; tags only indexing/failed/unsupported/embedding-progress), **footer only when degraded** (`summary.semantic === 'off'` and ≥1 source → `knowledgeSemanticOff` line; nothing otherwise), **hover-revealed icon actions** (`group` row: Open-original + Delete icons `opacity-0 group-hover:opacity-100 focus:opacity-100`, Arco `Tooltip` labels, `@icon-park/react` icons e.g. `Share`/`Delete`; Retry stays a visible text button on failed/embed-gap rows), **right-side Drawer preview** (row click → Drawer w/ fileName title, honesty note, `MarkdownView` body — note: shadow root in tests; truncated → `knowledgePreviewTruncated`; load error → `knowledgePreviewError` Alert; footer "Open original" button).

- [ ] **Step 10.1: Failing card tests**: ready row renders NO passages tag; footer absent when semantic on, present when off; row click opens drawer and calls getSourceText; Open original → `ipcBridge.shell.openFile` with `<workspace>/Knowledge Base/<fileName>`; Delete file → Popconfirm (confirm text includes fileName) → removeSource; Refresh button → syncNow; folderMissing → warning Alert + Relink (opens dialog → `updateProject`) while rows remain rendered; embedding progress tag still shown.
- [ ] **Step 10.2: Implement** card + drawer. Header `extra`: Refresh + Add files (text buttons). Keep `data-testid` conventions. Relink handler mirrors `ProjectFilesCard.handleRelink` (dialog.showOpen → updateProject → syncNow).
- [ ] **Step 10.3: EN keys** (module `conversation`, under `projectHome`): add `knowledgeRefresh` 'Refresh', `knowledgeOpenOriginal` 'Open original', `knowledgeDeleteFile` 'Delete file', `knowledgeDeleteConfirm` 'Move "{{fileName}}" to the Trash? It will also be removed from the knowledge base.', `knowledgeFolderMissingTitle` 'Knowledge Base folder not found', `knowledgeFolderMissingBody` 'The folder may have been moved or deleted. Your indexed knowledge is preserved — restore the folder or relink the project, then refresh.', `knowledgeFolderHint` 'Files live in the "Knowledge Base" folder inside the project folder. Anything you drop there is indexed automatically.', `knowledgePreviewNote` 'This is the indexed text the assistant searches — not the original layout.', `knowledgePreviewTruncated` 'Preview truncated — open the original for the full document.', `knowledgePreviewError` 'Could not load the indexed text.'; change `knowledgeProgressEmbedding` → 'Embedding {{done}}/{{total}}…'; REMOVE `knowledgePassages`, `knowledgeSummary`, `knowledgeSemanticOn`, `knowledgeRemove`, `knowledgeRemoveConfirm`. Reuse `folderMissingRelink` ('Relink folder'). Empty state gains `knowledgeFolderHint` sub-line.
- [ ] **Step 10.4:** `bun run i18n:types` + run card tests → PASS. **Step 10.5: Commit** — `feat(knowledge): folder-aware knowledge card with preview drawer and trash delete`

---

### Task 11: Boot watch registration + chat-creation sync

**Files:** create `useKnowledgeFolderWatchers.ts` (check `renderer/hooks/` ≤10 children first), modify `renderer/main.tsx` (`Main`), `useGuidSend.ts`; tests: new dom test + extend `useGuidSend.dom.test.ts`

- [ ] Hook: `useProjects()` list → effect diffs previous vs current ids: watchFolder for new/changed-workspace, unwatchFolder for removed; all `.catch(() => {})`. Mount `useKnowledgeFolderWatchers()` inside `Main` (beside `repairAllCronJobTimeZonesOnce`, gated on `ready`).
- [ ] `useGuidSend`: right before the `getSessionMcpServer` block —

```ts
// Fire-and-forget folder sync: ingestion can take seconds-to-minutes, so it
// must never block sending. This chat uses whatever is ready NOW (frozen at
// creation); the sync benefits the next chat.
if (projectId) {
  const projectWorkspace = findProjectById(projectId)?.workspace;
  if (projectWorkspace) void ipcBridge.projectKnowledge.syncFolder.invoke({ projectId, workspace: projectWorkspace }).catch(() => {});
}
```
  (mock `syncFolder` in the guid-send test's ipcBridge mock; assert called for project chats, absent otherwise.)
- [ ] Commit — `feat(knowledge): register folder watchers at boot and sync on chat creation`

---

### Task 12: 12-locale i18n

**Files:** `locales/<lang>/conversation.json` ×11 remaining (zh-CN, ja-JP, zh-TW, ko-KR, tr-TR, ru-RU, uk-UA, pt-BR, de-DE, es-ES, fa-IR)

- [ ] Invoke the project `i18n` skill; translate the Task-10 key set into each locale (keep `{{fileName}}`/`{{done}}`/`{{total}}` placeholders and the literal folder name "Knowledge Base" untranslated in `knowledgeFolderHint` since the folder name is fixed English); delete the removed keys everywhere.
- [ ] `bun run i18n:types && node scripts/check-i18n.js` → PASS. Commit — `feat(knowledge): localize knowledge-folder strings across all locales`

---

### Task 13: Full gate

- [ ] `bun run test` (full suite; known ~2-test flake — re-run once to distinguish), `bunx tsc --noEmit`, `bun run lint:fix` (0 errors; warnings ≈ baseline), scoped `bunx oxfmt` on every touched file, `node scripts/check-i18n.js`.
- [ ] Re-run the Step 2.6 guard mutation check one final time on the finished code.
- [ ] Commit any fixups — `chore(knowledge): gate fixups` (or fold into prior commits via new commits, no rewrites).

---

### Task 14: Live verification (REQUIRED — the project once shipped wired-but-useless)

Dev store: `~/.aionui-config-dev/project-kb/<projectId>/`. Only one dev app at a time; `bun run dev` from THIS worktree; vite must take :5173.

- [ ] Migration: open a project that has pre-existing store sources → `Knowledge Base/` appears in the workspace with the files; `sources/*/original.*` gone from the store; card still lists sources as ready (no re-index churn).
- [ ] Finder drop: copy a new .md into the folder via Finder → within ~2s the card shows it indexing → ready, no UI interaction.
- [ ] Whole-document chat: new project chat, ask "summarise <file> in full" → transcript shows `search_project_knowledge` then a file-tool read of `Knowledge Base/<file>`. (Ground truth: `tools/list` via piping JSON-RPC into `node out/main/builtin-mcp-knowledge.js`.)
- [ ] Guard live: move `Knowledge Base/` to Trash → card shows folder-missing warning, rows intact; restore folder → Refresh → recovers, folderMissing clears, no re-ingest of unchanged files.
- [ ] Card UX: row click previews indexed text; Open original opens the OS app; Delete file lands the file in Trash and removes the row; no "passages" text anywhere.

---

## Live verification results (2026-07-29, dev app from this worktree)

All required checks passed. Evidence:

1. **Migration** — on boot, the existing dev project's 6 sources exported to
   `~/Downloads/untitled folder/Knowledge Base/`; all 6 store `original.*` files deleted after
   hash-verify; manifest unchanged (same ids, statuses, chunk/vector counts) → no re-index churn.
2. **Finder drop** — a new `.md` copied into the folder was `ready` with a vector in ~8s, with zero
   UI interaction (watcher → debounce → sync → ingest → embed).
3. **Whole-document chat** — ground truth from `aionrs-sessions/sessions/06fc3bcd/state.json`:
   `search_project_knowledge` → `Glob **/vendor-agreement-zephyr.md` →
   `Read /Users/…/Knowledge Base/vendor-agreement-zephyr.md`. The agent's own reasoning cited the
   filename from the tool description's listing. Answer contained all 3 invoice numbers.
   Also verified the description via live `tools/list` on the built subprocess, not source.
4. **THE GUARD** — folder moved away → watcher-triggered sync set `folderMissing: true`, kept all 7
   sources `ready` and every chunk on disk; card rendered the warning + path + Relink above the
   still-listed rows. **Zero deletions.**
5. **Recovery** — folder restored → `folderMissing` cleared automatically, no re-ingestion.
6. **Preview drawer** — indexed text rendered inside MarkdownView's shadow root, honesty note and
   Open original present.
7. **Trash delete** — confirmation named the file; row removed; Finder confirms
   `vendor-agreement-zephyr.md` is in the Trash (reversible, not destroyed).
8. **No passage jargon** — `/passage/i` does not match anywhere in the rendered card.

Caveat: `~/.Trash` is unreadable from the agent sandbox, so check 7 used Finder (`osascript`) rather
than a directory listing.

### Deviations from the plan, and why

- **Task 5 folded into Task 2.** Keeping the old snapshot-based `registerSources` alongside the new
  folder diff would have left two contradictory ingestion paths mid-branch; replacing it in the same
  commit kept the pipeline coherent.
- **`trashItem` is an optional dep that throws when needed but absent**, rather than required — the
  root tsconfig does not typecheck tests, so a required field would have failed at runtime in the
  six existing test construction sites instead of at compile time. Production always supplies it
  (bridge test pins that).
- **`fs.rm`-never assertion is behavioural, not a spy.** `vi.spyOn` cannot patch an ESM namespace
  ("Module namespace is not configurable"), so the test asserts the file survives a no-op
  `trashItem` — stronger, since it tests the outcome rather than the call.
- **`watchFolder` also runs one catch-up sync.** Not in the spec's trigger list; without it, changes
  made while the app was closed would wait for the next Project Home mount.
- **`knowledgeStatusNote` tag added.** A `ready` source can carry a non-fatal note (e.g. "Truncated
  to 50 pages"); with the passage tag gone there was nowhere to surface it, so a tooltip-only "Note"
  tag keeps it discoverable without reintroducing jargon.
- **Native manifest ordering.** `nativePayloadSchemas.test.ts` compares `NATIVE_BRIDGE_PROVIDER_KEYS`
  against the `bridge.buildProvider` literals *in source order* and needs a valid fixture per
  channel. Only the full suite catches this — worth knowing for the next stream that adds a channel.

## Self-review checklist (done at plan time)

- Spec §3 layout/flat-v1 → Tasks 1, 2 (subdir ignore, basename identity). §4 sync+triggers → Tasks 2, 9, 11 (+watchFolder initial sync for boot catch-up — deviation: spec doesn't list boot sync; justified as watcher catch-up, note in MR). §5 watcher+lifecycle → Tasks 6, 7, 11. §6 UX → Task 10 (+user's 2026-07-29 passages-removal decisions). §7 tool description → Task 8. §8 migration → Task 3. §9 IPC traps → Task 7. §10 tests → per-task TDD + Task 14 live. §11 sequencing → Task 0.
- Deviations from spec, both user-approved or forced by reality: (1) passages UI removal + degraded-only footer + hover icons + drawer (user, 2026-07-29); (2) `getSourceText` returns `{text, truncated}` not bare string (i18n-able truncation note); (3) summary loses `passageCount` (nothing renders it).
- Type consistency: `syncFolder(projectId, workspace)` everywhere; `removeSource(projectId, sourceId, workspace)`; scan entry `{fileName, byteSize, contentHash, kind}`; DTO list result `{sources, summary:{fileCount, semantic}, folderMissing}`.
