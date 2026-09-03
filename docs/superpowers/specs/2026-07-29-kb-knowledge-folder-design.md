# Stream D — The Knowledge Base Folder (visible, agent-readable knowledge)

**Date:** 2026-07-29
**Branch:** `feat/kb-knowledge-folder` (worktree `WePrompt-kb-folder`), off `sprint1` **after Stream A merges** — see §11.
**Read first:** `2026-07-28-kb-followups-coordination.md` (ground rules, environment facts). Background: `2026-07-24-project-knowledge-base-design.md`.

## 1. Problem

Two observed gaps in the shipped knowledge base:

1. **The user cannot open an indexed file.** Files are snapshot-copied into the private store (`~/.aionui-config-dev/project-kb/<id>/sources/`); the card offers only Retry/Remove. After upload, the document effectively disappears from the user's reach.
2. **The agent cannot read a whole document.** `search_project_knowledge` returns top-K passages, never a document, and the snapshots live outside the workspace where file tools cannot reach. "Summarise this contract" / "list every invoice number" are unanswerable by construction.

## 2. Decisions taken (user, 2026-07-29)

- **A visible `Knowledge Base/` folder inside the project workspace is the source of truth.** Not a mirror; not an internal store.
- **Live file watching** on that folder, not just manual refresh.
- **Both open paths for the user:** an in-app preview of the indexed text, plus "Open original" in the OS default app.
- **No new MCP tool.** The agent reads whole documents with its existing file tools because the files are now inside the workspace.

## 3. Layout & source of truth

```
<project workspace>/
└── Knowledge Base/            ← fixed English name, NOT localised (it is a path
    ├── policy.md                 the agent reads and that travels with the project)
    └── contract-2026.pdf
```

The private store becomes **index-only**: `manifest.json`, `index/*`, and each source's `converted.md` (kept — it is both a conversion cache and the text-recovery fallback if the folder is lost). `sources/<id>/original.<ext>` is **no longer stored** after migration (§8).

**v1 identity is flat:** only top-level files in `Knowledge Base/` are indexed. Subfolders are ignored (silently, documented) because the manifest keys sources by basename and today's replace-by-fileName logic assumes unique names. Nested-folder support = follow-up, requires relative-path identity end to end.

**Durability note (accepted trade):** knowledge moves from app-managed data to a user-managed folder — in the reference install, one inside `~/Downloads`. The index + `converted.md` cache survive folder loss (text recoverable), the originals do not. §6's missing-folder guard prevents the worse failure (index wipe).

## 4. Sync — the backbone (the watcher is an enhancement, not the mechanism)

One idempotent operation, `syncFolder(projectId, workspace)`, enqueued on the **existing per-project serialized queue**:

1. Read `Knowledge Base/` (top level only). **If the folder is missing or unreadable → STOP: mark the project's knowledge state `folderMissing`, emit `updated`, and perform NO deletions.** A transient unmount, a Downloads cleanup, or a renamed workspace must surface as an error state — never as "all files were deleted". This is the design's most dangerous failure mode; the guard is non-negotiable.
2. Filter: ignore `.DS_Store`, dotfiles, `~$*` Office lock files, unsupported extensions (those get an `unsupported` row as today), and **symlinks that resolve outside the folder** (`lstat` + `realpath` containment — a link to `~/.ssh/...` must never be indexed into prompts).
3. Diff against the manifest by fileName + content hash:
   - new / changed hash → ingest via the existing pipeline (register → convert → chunk → BM25 → embed);
   - present + same hash → no-op;
   - in manifest but not in folder (and folder read succeeded) → remove index rows (no Trash — the file is already gone).
4. Persist + `onUpdated` as today.

**Sync triggers:** (a) Project Home mount, (b) the card's manual Refresh action, (c) watcher events (§5), (d) **fire-and-forget on project-chat creation** — it cannot be awaited (ingestion can take seconds-to-minutes; blocking send is unacceptable), so the descriptor uses whatever is `ready` at creation, same frozen-at-creation boundary as today; the sync benefits the *next* chat.

## 5. Watcher

New injectable main-process module (e.g. `process/services/projectKnowledge/knowledgeFolderWatcher.ts`) using Node's recursive `fs.watch`. **Do not use aioncore's watch endpoints** — verified: `fileWatch.startWatch` is `RecursiveMode::NonRecursive` per-file (and has zero WePrompt consumers), `workspaceOfficeWatch` is hardcoded to Office-file creation events.

- Debounce ~1s per project and coalesce bursts (a 30-file paste = one sync, not 30). Events do nothing but schedule `syncFolder` on the queue — no separate concurrency model.
- **Lifecycle problem to solve explicitly:** the project registry lives in **renderer localStorage** (`forge.projects.v1`), so main cannot enumerate projects at boot. The renderer registers watches: on app start (project list load) and on project create/relink/delete, call a new `projectKnowledge.watchFolder` / `unwatchFolder` IPC. Main keeps a projectId → {workspace, watcher} map; re-registration with a changed workspace path swaps the watcher.
- Watcher failure (e.g. folder deleted) must degrade to the §4 sync-points, not crash: catch, mark degraded, retry registration on next sync.

## 6. Card & UX changes

- **Row click → in-app preview**: Arco Modal (or drawer) rendering the source's indexed text — `converted.md` for docx/xlsx/pdf, the file itself for md/txt — via the existing markdown renderer. Frame it honestly as *"indexed text"*: for a scanned PDF this is the extraction, not the original layout, and seeing exactly what the index sees is a retrieval-debugging feature. (Note for tests: `MarkdownView` renders into a shadow root.)
- **"Open original"** action per row → `shell.openFile` on `<workspace>/Knowledge Base/<fileName>` — now genuinely the user's original.
- **"Remove" becomes "Delete file"**, confirmed by name, implemented with `shell.trashItem` (reversible, platform-native) — never `fs.rm`. Trash the file, then remove index rows synchronously; the watcher's subsequent event no-ops via the hash diff.
- **`folderMissing` state**: warning + Relink affordance, mirroring `ProjectFilesCard`'s existing missing-workspace pattern. Index is preserved while missing.
- **Refresh** action in the card header (next to Add files).
- **Add files** keeps working and now copies the picked files INTO `Knowledge Base/` (creating it if needed), then indexes — one consistent truth.
- The workspace Files card will now show the `Knowledge Base/` folder in its tree. Expected and good; no change there.

## 7. Agent access & tool description

No new tool. Files are workspace-reachable, so read/glob/grep work. **The composition must be advertised or the model won't find it** (hard-won lesson): `search_project_knowledge`'s description gains a line — after finding relevant passages, the full documents are ordinary files at `Knowledge Base/<fileName>` inside the working directory, readable with file tools for whole-document questions. Keep the dynamic filename listing.

Consequence to state in the MR: the agent can also *write* into that folder; anything it writes gets indexed (caps apply). That is a feature ("save this summary to the knowledge base") and a risk (junk accumulation) — accepted for v1.

## 8. Migration (one-time, per project, inside `syncFolder`)

When the manifest has sources whose `sources/<id>/original.<ext>` still exists in the store:

1. Ensure `Knowledge Base/` exists (only when the workspace itself exists — otherwise `folderMissing`, no migration).
2. For each snapshot: if the folder already has that fileName with the **same hash** → nothing to export; **different hash** → export the snapshot under a suffixed name (`name (from knowledge base).ext`) so nothing is silently lost, and let both index; otherwise write the file, **verify by re-hash**, then delete the store original.
3. Manifest hashes are unchanged for straight exports → no re-index churn.

## 9. IPC & schema changes (remember the two traps)

Mutating calls now need the workspace path (main cannot derive it): extend `addSources`/`removeSource` params with `workspace`; add `syncFolder`, `watchFolder`, `unwatchFolder`, and `getSourceText(projectId, sourceId) → string` (preview). Every new/changed channel must be added to `NATIVE_BRIDGE_PROVIDER_KEYS` **and** `nativeBridgePayloadSchemas` (`safeIdSchema` for ids, `pathSchema` for workspace, `.strict()`), or it is dead at runtime with "operation is not allowed". Update the `contextCompactionBridge.test.ts` sibling-mock if a new bridge init is added.

## 10. Testing

- **Sync diff unit tests** (temp dirs, injected deps): new/changed/unchanged/vanished; **missing folder → zero deletions + `folderMissing`** (the load-bearing test — verify it fails if the guard is removed); ignore rules; outside-pointing symlink skipped; unsupported extension row.
- **Watcher**: debounce/coalesce with fake timers; events land on the serialized queue; watcher death degrades without crashing.
- **Migration**: straight export, same-hash no-op, different-hash suffix, hash-verify-before-delete.
- **Delete flow**: `trashItem` injected/mocked; index rows removed; `fs.rm` never called on user files.
- **Card**: preview opens with indexed text; Open original invokes `shell.openFile` with the right path; folderMissing state; Refresh triggers sync.
- **Live verification (required):** drop a file into the folder via Finder → indexed without touching the app UI; agent answers a whole-document question by reading `Knowledge Base/<file>` after a search; delete the folder → card shows the missing state and the index survives; restore → recovers. Full gate + 12-locale i18n for all new strings.

## 11. Sequencing & scope

**Queue strictly behind Stream A** — this stream rewrites the same exclusively-owned files (`projectKnowledgeService.ts`, `ProjectKnowledgeCard.tsx`, locales) and must build on A's `progress` field rather than invent a sibling. Step 0 for the implementing session: `git fetch` and confirm Stream A's work is in `origin/sprint1` (look for `packages/desktop/src/common/knowledge/pdfExtract.ts`); if present, `git reset --hard origin/sprint1` (this branch starts with 0 commits, so reset is safe); if absent, **stop and ask the user** rather than starting a collision.

**Out of scope:** nested folders, citation click-through (the preview modal is its groundwork), watching arbitrary extra folders, any retrieval/ranking change, sync across machines. **In scope** is exactly: the folder, sync + watcher, migration, preview + open + trash-delete, the tool-description line, IPC plumbing, tests, i18n.
