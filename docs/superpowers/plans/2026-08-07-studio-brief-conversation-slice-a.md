# Creative Studio Slice A — Brief Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Brief conversation bound to a Studio project, with a Studio MCP server whose tools read the script and record whole-script proposals; the user accepts them through CAS-guarded cards in Brief.

**Architecture:** A new stdio MCP subprocess (`builtin-mcp-studio`, cloned from `knowledgeServer`'s per-conversation session pattern) writes durable proposal records into the store's existing `proposals/pending/` inbox, whose ledger, watcher, IPC and renderer data layer are all already built and wired. The renderer adds: a lazy curated-conversation creation flow, the conversation surface in `BriefPhase`, and proposal cards. Main stays the sole writer of project state.

**Tech Stack:** TypeScript strict, `@modelcontextprotocol/sdk` + zod (subprocess), Vitest 4 (`--project node` for main/subprocess, `--project dom` for renderer), Arco components, i18n across 12 locales.

**Design of record:** `docs/design/creative-studio-script-level-v1-design.md` (committed on Projects `sprint2`). Parent spec: `docs/design/creative-studio-brief-conversation-design.md` rev 3.

---

## Execution context (read first)

- **Repo:** the Documents clone — `/Users/lap16603/Documents/WePrompt`. Base branch **`creative-suite-sprint2`**. Create the working branch `codex/studio-slice-a` in a worktree (superpowers:using-git-worktrees). After `git worktree add`, run `bun install` in the worktree before believing any red gate.
- **Run node-project tests:** `bunx vitest run --project node <file>` · **dom-project:** `bunx vitest run --project dom <file>`.
- **Gates before any push:** `bunx tsc --noEmit`, `bun run lint:fix`, `bun run format`, and for i18n changes `bun run i18n:types && node scripts/check-i18n.js`. Push only via `just push`.
- **Known flake policy:** a full-suite failure on exactly `StudioPage.dom.test.tsx` "fits 18 seconds…" → rerun that file in isolation; if green, record against BUG-025 and proceed. Do not raise timeouts.
- **i18n:** every task that adds user-facing text must follow `.claude/skills/i18n/SKILL.md` (key naming, module registration, all-locale coverage). Keys in this plan are listed with en-US values; other locales get real translations, not copies.

### Measured facts this plan is built on (verify if anything looks off)

| Fact | Where |
| --- | --- |
| Proposal disk contract: slot `proposals/slots/<0..49>.slot` via `open('wx')` with `{schemaVersion:1, proposalId, reservedAt}`, then record at `proposals/pending/<proposalId>.json` written temp+`fs.link` (EEXIST = duplicate), ≤ 262,144 bytes | `store.ts:1330-1366`, `:1434-1463`, `:203-206` |
| Record shape: `{schemaVersion:1, id, projectId, status:'pending', baseRevision, payload, createdAt, decidedAt:null}`; payload `{kind:'replace_storyboard', sceneOrder, scenes}`; main re-validates every record on read and ignores malformed ones | `store.ts:1790-1799`, `:1384-1403` |
| Ids: `SAFE_ID = /^[A-Za-z0-9_-]+$/`, proposal id ≤ 256 chars → `crypto.randomUUID()` is valid | `store.ts:32`, `:313-315` |
| Watcher validates path segments + record, notifies once per status change; wired with reap at startup | `store.ts:1870-1920`, `runtime.ts:193` |
| Accept: idempotent, CAS at `proposal.baseRevision`, stale → `CreativeStudioStoreError('stale_project')` → bridge maps to `messageKey 'conversation.creativeStudio.errors.staleProject'`, code `stale_project` | `store.ts:1929-1954`, `creativeStudioBridge.ts:31,69-70` |
| Session-server pattern: main builds `ISessionMcpServer {id, name, transport:{type:'stdio', command:'node', args:[bundlePath], env}}` per project | `projectKnowledgeService.ts:925-950` |
| Bundle path helper: `getBuiltinMcpScriptPath(<script>)` from `@process/utils/initStorage`; script consts in `builtinMcp/constants.ts`; esbuild entries in `scripts/build-mcp-servers.js` (4 today) | `projectKnowledgeBridge.ts:19,39` |
| `createStudioBriefConversation(input, deps)` exists (renderer), applies allow-list, throws on snapshot drift; **zero callers** | `studio/components/PhaseShell/phases/studioBriefConversation.ts` |
| `useStudioProject` already loads + exposes `proposals`, subscribes `proposalUpdated` and `turnCompleted` scoped to `briefConversationId` | `useStudioProject.ts:104-163,180` |
| AionrsChat standalone prop mapping (what `ChatConversation` passes) | `ChatConversation.tsx:255-273` |
| Send a turn into an existing conversation: `ipcBridge.conversation.sendMessage.invoke({...})` | `AionrsSendBox.tsx:928` |
| Sidebar list owner (hide predicate goes here) | `renderer/hooks/context/ConversationHistoryContext.tsx` |
| One-shot draft-loss defect to fence: `proposeStoryboard` clears drafts without flushing | `useStoryboardEditor.ts:~1543` (existing discard test at `useStoryboardEditor.dom.test.ts:2279`) |
| Six auto-attach ids that must be absent from the snapshot | `builtin-image-gen`, `builtin-idp`, `builtin-vision`, `builtin-chrome-devtools`, `builtin-memory`, `builtin-tavily` (parent spec §4.1 rev 3) |

---

### Task 1: `STUDIO_ENV` contract module

**Files:**
- Create: `packages/desktop/src/common/studio/envKeys.ts`
- Test: covered by Task 2's parse tests (a constants-only module needs no own test)

- [ ] **Step 1: Write the module** (mirrors `common/knowledge/envKeys.ts` — both sides import it so a rename can never desync them)

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// The env-var contract between the main process (which builds the Studio
// session-MCP descriptor) and the Studio MCP subprocess (which reads it).
// Both sides import these so a rename can never silently desync the two ends.

export const STUDIO_ENV = {
  projectId: 'AIONUI_STUDIO_PROJECT_ID',
  projectDir: 'AIONUI_STUDIO_PROJECT_DIR',
  pendingDir: 'AIONUI_STUDIO_PENDING_DIR',
} as const;
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit` · Expected: clean

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/common/studio/envKeys.ts
git commit -m "feat(creative-studio): define the Studio MCP env contract"
```

---

### Task 2: proposal writer for the subprocess

The subprocess-side implementation of the measured disk contract. Main re-validates on read, so this writer's job is to be *accepted* by the real store — Task 3's conformance test proves that, not this one.

**Files:**
- Create: `packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts`
- Test: `tests/unit/process/creative-studio/studioProposalWriter.test.ts`

- [ ] **Step 1: Write the failing tests** (temp dirs; node project)

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  writeProposalRecord,
  StudioProposalWriteError,
} from '@process/resources/builtinMcp/studioProposalWriter';
import type { StudioProposalPayload } from '@/common/types/project/creativeStudioTypes';

const payload: StudioProposalPayload = {
  kind: 'replace_storyboard',
  sceneOrder: ['scene_1'],
  scenes: {
    scene_1: {
      title: 'Sunrise over the terraces',
      purpose: 'Open on the origin of the coffee',
      visualPrompt: 'Golden hour over mountain coffee terraces, mist in the valleys',
      narration: 'It starts at 1,600 meters.',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 5,
      referenceAssetId: null,
    },
  },
};

describe('studioProposalWriter', () => {
  let proposalRoot: string;
  let pendingDir: string;
  let slotsDir: string;

  beforeEach(async () => {
    proposalRoot = await mkdtemp(path.join(tmpdir(), 'studio-proposals-'));
    pendingDir = path.join(proposalRoot, 'pending');
    slotsDir = path.join(proposalRoot, 'slots');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(slotsDir, { recursive: true });
  });

  it('writes a pending record and a slot reservation', async () => {
    const record = await writeProposalRecord({
      pendingDir,
      projectId: 'project_1',
      baseRevision: 3,
      payload,
    });
    expect(record.status).toBe('pending');
    expect(record.baseRevision).toBe(3);
    const written = JSON.parse(await readFile(path.join(pendingDir, `${record.id}.json`), 'utf8'));
    expect(written).toEqual(record);
    const slots = await readdir(slotsDir);
    expect(slots).toHaveLength(1);
    const slot = JSON.parse(await readFile(path.join(slotsDir, slots[0]), 'utf8'));
    expect(slot).toMatchObject({ schemaVersion: 1, proposalId: record.id });
  });

  it('fails typed when every slot is taken, without writing a record', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        writeFile(path.join(slotsDir, `${index}.slot`), JSON.stringify({ schemaVersion: 1, proposalId: 'x', reservedAt: 'now' }))
      )
    );
    await expect(
      writeProposalRecord({ pendingDir, projectId: 'project_1', baseRevision: 1, payload })
    ).rejects.toMatchObject({ code: 'capacity' } satisfies Partial<StudioProposalWriteError>);
    expect(await readdir(pendingDir)).toHaveLength(0);
  });

  it('releases its slot when the record write fails', async () => {
    // Pre-create the record path as a DIRECTORY so fs.link fails after the slot is reserved.
    const collidingId = 'fixed_id_for_collision';
    await mkdir(path.join(pendingDir, `${collidingId}.json`));
    await expect(
      writeProposalRecord({ pendingDir, projectId: 'project_1', baseRevision: 1, payload, proposalId: collidingId })
    ).rejects.toMatchObject({ code: 'storage' });
    expect(await readdir(slotsDir)).toHaveLength(0);
  });

  it('rejects a record over the byte cap without touching disk', async () => {
    const huge = { ...payload, scenes: { scene_1: { ...payload.scenes.scene_1, narration: 'x'.repeat(300 * 1024) } } };
    await expect(
      writeProposalRecord({ pendingDir, projectId: 'project_1', baseRevision: 1, payload: huge })
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(await readdir(pendingDir)).toHaveLength(0);
    expect(await readdir(slotsDir)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioProposalWriter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the writer**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Subprocess-side writer for the Studio proposal inbox. Implements the disk
// contract the main-process store enforces on read (store.ts): an O_EXCL slot
// file caps pending records per project, and the record itself is written
// exclusively (temp + link) so an id can never be overwritten. Main re-validates
// every record on read; the conformance test proves this writer satisfies it.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { StudioProposal, StudioProposalPayload } from '@/common/types/project/creativeStudioTypes';

const MAX_RECORD_BYTES = 256 * 1024; // store.ts STUDIO_PROPOSAL_MAX_RECORD_BYTES
const MAX_PENDING_PER_PROJECT = 50; // store.ts STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT

export type StudioProposalWriteErrorCode = 'capacity' | 'too_large' | 'storage';

export class StudioProposalWriteError extends Error {
  constructor(
    public readonly code: StudioProposalWriteErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type WriteProposalInput = {
  pendingDir: string;
  projectId: string;
  baseRevision: number;
  payload: StudioProposalPayload;
  /** Test seam; production omits it and gets a UUID. */
  proposalId?: string;
};

const slotsDirOf = (pendingDir: string): string => path.join(path.dirname(pendingDir), 'slots');

const reserveSlot = async (slotsDir: string, proposalId: string): Promise<string> => {
  const reservation = JSON.stringify({ schemaVersion: 1, proposalId, reservedAt: new Date().toISOString() });
  for (let index = 0; index < MAX_PENDING_PER_PROJECT; index += 1) {
    const file = path.join(slotsDir, `${index}.slot`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, 'wx');
      await handle.writeFile(reservation, { encoding: 'utf8' });
      await handle.sync();
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw new StudioProposalWriteError('storage', error instanceof Error ? error.message : 'slot write failed');
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  }
  throw new StudioProposalWriteError('capacity', 'Proposal inbox is full for this project');
};

export const writeProposalRecord = async (input: WriteProposalInput): Promise<StudioProposal> => {
  const record: StudioProposal = {
    schemaVersion: 1,
    id: input.proposalId ?? randomUUID(),
    projectId: input.projectId,
    status: 'pending',
    baseRevision: input.baseRevision,
    payload: input.payload,
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) {
    throw new StudioProposalWriteError('too_large', 'Proposal record exceeds the size cap');
  }
  const slotsDir = slotsDirOf(input.pendingDir);
  const slotFile = await reserveSlot(slotsDir, record.id);
  const file = path.join(input.pendingDir, `${record.id}.json`);
  const temporaryFile = `${file}.${process.pid}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporaryFile, 'wx');
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.link(temporaryFile, file);
    await fs.rm(temporaryFile);
    return record;
  } catch (error) {
    await handle?.close().catch((): undefined => undefined);
    await fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
    await fs.rm(slotFile, { force: true }).catch((): undefined => undefined);
    throw new StudioProposalWriteError('storage', error instanceof Error ? error.message : 'record write failed');
  }
};
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioProposalWriter.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts tests/unit/process/creative-studio/studioProposalWriter.test.ts
git commit -m "feat(creative-studio): add the subprocess proposal writer"
```

---

### Task 3: conformance — the real store accepts subprocess-written records

This is the drift net: if the store's contract ever changes, this fails loudly instead of proposals silently vanishing.

**Files:**
- Test: `tests/unit/process/creative-studio/studioProposalConformance.test.ts`

- [ ] **Step 1: Write the test.** Construct the real store against a temp root exactly the way `tests/unit/process/creative-studio/store.test.ts` does (copy its factory/boot lines verbatim — do not invent a new harness). Then:

```typescript
// Shape (adapt store construction from store.test.ts):
it('lists and watches a record written by the subprocess writer', async () => {
  // 1. Create a project through the real store API (gives a real projectId + revision 1).
  // 2. Resolve the project's proposals dirs by calling store.listProposals(projectId) once
  //    (creates nothing) and then locating `<root>/<projectId>/proposals/`; mkdir pending/ + slots/
  //    if absent — mirrors what proposalDirectories(createIfMissing=true) produces.
  // 3. writeProposalRecord({ pendingDir, projectId, baseRevision: 1, payload });
  // 4. expect((await store.listProposals(projectId)).map(p => p.id)).toContain(record.id)
  // 5. Register store.watchProposals(listener); touch the record's mtime or write a second
  //    record; await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(projectId, expect.any(String)))
});

it('acceptProposal applies a subprocess-written record under CAS', async () => {
  // write record at baseRevision 1 → store.acceptProposal(projectId, record.id, applyFn)
  // → applied: true. Then bump the project revision, write another record at the OLD
  // revision, and expect acceptProposal to reject with code 'stale_project'.
});

it('ignores a malformed record without failing the listing', async () => {
  // write raw garbage JSON at pending/zzz.json → listProposals still returns the valid record only.
});
```

- [ ] **Step 2: Run — expect the suite to fail only on missing pieces you then fix in the test (the writer and store are done).** When green:

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioProposalConformance.test.ts`
Expected: 3 passed

- [ ] **Step 3: Commit**

```bash
git add tests/unit/process/creative-studio/studioProposalConformance.test.ts
git commit -m "test(creative-studio): prove subprocess proposal writes conform to the store contract"
```

---

### Task 4: the Studio MCP server

**Files:**
- Create: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/constants.ts` (append)
- Modify: `scripts/build-mcp-servers.js` (append one entry)
- Test: `tests/unit/process/creative-studio/studioServer.test.ts`

- [ ] **Step 1: Append constants** (mirror the IDP/vision block in `constants.ts`)

```typescript
export const BUILTIN_STUDIO_NAME = 'aionui-creative-studio';
export const BUILTIN_STUDIO_SCRIPT = 'builtin-mcp-studio';
```

- [ ] **Step 2: Write the failing tests** — test the exported handlers directly, the way `knowledgeServer`'s testable split works (`createSearchHandler` precedent, `knowledgeServer.ts:92`):

```typescript
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseStudioServerEnv,
  createReadStoryboardHandler,
  createProposeStoryboardHandler,
} from '@process/resources/builtinMcp/studioServer';
import { STUDIO_ENV } from '@/common/studio/envKeys';

// Minimal on-disk project fixture: only the fields read_storyboard projects.
const projectFixture = {
  schemaVersion: 1,
  id: 'project_1',
  revision: 7,
  name: 'Coffee teaser',
  brief: 'A 10-second teaser for a mountain coffee brand',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  sceneOrder: ['scene_1'],
  scenes: {
    scene_1: {
      id: 'scene_1',
      title: 'Sunrise',
      purpose: '',
      visualPrompt: '',
      narration: '',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 5,
      referenceAssetId: null,
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: { generation: 0 },
    },
  },
  assets: {},
  jobs: {},
};

describe('studioServer', () => {
  it('parses env only when all three keys are present', () => {
    expect(parseStudioServerEnv({})).toBeNull();
    const env = {
      [STUDIO_ENV.projectId]: 'project_1',
      [STUDIO_ENV.projectDir]: '/tmp/p',
      [STUDIO_ENV.pendingDir]: '/tmp/p/proposals/pending',
    };
    expect(parseStudioServerEnv(env)).toEqual({
      projectId: 'project_1',
      projectDir: '/tmp/p',
      pendingDir: '/tmp/p/proposals/pending',
    });
  });

  it('read_storyboard returns revision, settings and scenes; never operational state', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(projectFixture));
    const handler = createReadStoryboardHandler({ projectId: 'project_1', projectDir: dir, pendingDir: '' });
    const result = await handler({});
    const text = result.content[0].text;
    expect(text).toContain('"revision": 7');
    expect(text).toContain('Sunrise');
    expect(text).not.toContain('jobIds'); // operational state stays main-owned
  });

  it('propose_storyboard validates input, writes a record, and reports recorded — never accepted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(projectFixture));
    const pendingDir = path.join(dir, 'proposals', 'pending');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(path.join(dir, 'proposals', 'slots'), { recursive: true });
    const handler = createProposeStoryboardHandler({ projectId: 'project_1', projectDir: dir, pendingDir });
    const result = await handler({
      base_revision: 7,
      scene_order: ['scene_1'],
      scenes: {
        scene_1: {
          title: 'Sunrise over the terraces',
          purpose: 'Origin',
          visualPrompt: 'Golden hour terraces',
          narration: 'It starts at 1,600 meters.',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
        },
      },
    });
    const text = result.content[0].text;
    expect(text).toContain('recorded');
    expect(text).not.toMatch(/accepted|applied/i);
  });

  it('propose_storyboard fails typed on a base_revision that does not match the project file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(projectFixture));
    const pendingDir = path.join(dir, 'proposals', 'pending');
    await mkdir(pendingDir, { recursive: true });
    const handler = createProposeStoryboardHandler({ projectId: 'project_1', projectDir: dir, pendingDir });
    const result = await handler({ base_revision: 3, scene_order: ['scene_1'], scenes: { scene_1: projectFixture.scenes.scene_1 } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('read_storyboard'); // tells the model to re-read first
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioServer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement `studioServer.ts`.** Clone `knowledgeServer.ts`'s structure exactly (license header, testable handler factories, `main()` with `McpServer` + `StdioServerTransport`, the `require.main === module` boot guard with the same comment). Content:

```typescript
// Key pieces (full file follows knowledgeServer.ts's skeleton):

export type StudioServerEnv = { projectId: string; projectDir: string; pendingDir: string };

export function parseStudioServerEnv(env: Record<string, string | undefined>): StudioServerEnv | null {
  const projectId = env[STUDIO_ENV.projectId];
  const projectDir = env[STUDIO_ENV.projectDir];
  const pendingDir = env[STUDIO_ENV.pendingDir];
  if (!projectId || !projectDir || !pendingDir) return null;
  return { projectId, projectDir, pendingDir };
}

// read_storyboard: read `${projectDir}/project.json`, JSON.parse, and project a
// bounded view — { revision, name, brief, aspectRatio, targetDurationSeconds,
// sceneOrder, scenes: { [id]: { title, purpose, visualPrompt, narration,
// onScreenText, mediaKind, durationSeconds, hasReference: referenceAssetId !== null,
// hasSelectedTake: selectedAssetId !== null } } }.
// NEVER include assets, jobs, jobIds, assetIds, reviewState, routing.
// Return { content: [{ type: 'text', text: JSON.stringify(view, null, 2) }] }.
// Errors (missing/unreadable file) → { isError: true } with a plain message.

// propose_storyboard input schema (zod, in main()'s server.tool registration):
//   base_revision: z.number().int().positive()
//     .describe('The revision you saw in read_storyboard. Re-read if your last read is stale.')
//   scene_order: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).min(1).max(24)
//   scenes: z.record(z.string().regex(/^[A-Za-z0-9_-]+$/), z.object({
//     title: z.string().max(256),
//     purpose: z.string().max(2048),
//     visualPrompt: z.string().max(4096),
//     narration: z.string().max(4096),
//     onScreenText: z.string().max(1024),
//     mediaKind: z.enum(['image', 'video']),
//     durationSeconds: z.number().int().min(1).max(60),
//     referenceAssetId: z.string().regex(/^[A-Za-z0-9_-]+$/).nullable(),
//   }).strict())
// Handler:
//   1. Cross-check scene_order and scenes keys match exactly (same set, no dupes) → typed error.
//   2. Read project.json; if parsed.revision !== base_revision → isError with a message that
//      names read_storyboard ("The project is at revision N; you proposed against R.
//      Call read_storyboard and redraft."). This preserves 'computed against', it does not rebase.
//   3. writeProposalRecord({ pendingDir, projectId, baseRevision: base_revision, payload:
//      { kind: 'replace_storyboard', sceneOrder: scene_order, scenes } }).
//   4. Return text: `Proposal ${record.id} recorded for the user to review. It has NOT been
//      applied; the user decides. Do not describe it as accepted.`
//   5. StudioProposalWriteError → isError with the writer's message ('capacity' tells the model
//      the inbox is full and to stop proposing).

// main(): const server = new McpServer({ name: BUILTIN_STUDIO_NAME, version: '1.0.0' });
// register both tools with descriptions:
//   read_storyboard — "Read the Studio project's current script: revision, settings, and every
//     scene's editable fields plus whether it has a reference image and a selected take.
//     Always call this before proposing."
//   propose_storyboard — "Record a complete replacement script as a proposal the user reviews
//     in Brief. Requires base_revision from your latest read_storyboard. The proposal is a
//     whole-script replacement: include EVERY scene you want to keep, not only changes."
```

- [ ] **Step 5: Run to verify pass**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioServer.test.ts`
Expected: 4 passed

- [ ] **Step 6: Add the bundle entry** in `scripts/build-mcp-servers.js`, after the knowledge entry, mirroring it exactly:

```javascript
    {
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/studioServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-studio.js'),
    },
```

- [ ] **Step 7: Build the bundles and smoke the stdio boot**

Run: `node scripts/build-mcp-servers.js && ls out/main/builtin-mcp-studio.js`
Expected: file exists.
Then: `echo '' | node out/main/builtin-mcp-studio.js` — expected: process starts and waits (no crash); Ctrl-C/timeout is fine. A missing-env boot must not throw: tools answer with the unavailable message, mirroring `knowledgeServer`'s null-config behaviour.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/process/resources/builtinMcp/studioServer.ts packages/desktop/src/process/resources/builtinMcp/constants.ts scripts/build-mcp-servers.js tests/unit/process/creative-studio/studioServer.test.ts
git commit -m "feat(creative-studio): add the builtin-mcp-studio server with read and propose tools"
```

---

### Task 5: byte-unchanged guarantee — tool calls never write project state

**Files:**
- Test: append to `tests/unit/process/creative-studio/studioServer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
it('no tool call changes project.json — main stays the sole writer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
  const projectFile = path.join(dir, 'project.json');
  await writeFile(projectFile, JSON.stringify(projectFixture));
  const pendingDir = path.join(dir, 'proposals', 'pending');
  await mkdir(pendingDir, { recursive: true });
  await mkdir(path.join(dir, 'proposals', 'slots'), { recursive: true });
  const before = await readFile(projectFile, 'utf8');

  const env = { projectId: 'project_1', projectDir: dir, pendingDir };
  await createReadStoryboardHandler(env)({});
  await createProposeStoryboardHandler(env)({
    base_revision: 7,
    scene_order: ['scene_1'],
    scenes: { scene_1: { title: 'x', purpose: '', visualPrompt: '', narration: '', onScreenText: '', mediaKind: 'image', durationSeconds: 5, referenceAssetId: null } },
  });

  expect(await readFile(projectFile, 'utf8')).toBe(before);
});
```

- [ ] **Step 2: Run to verify pass** (it should pass immediately; if it fails, the server has a write path it must not have)

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioServer.test.ts`
Expected: 5 passed

- [ ] **Step 3: Commit**

```bash
git add tests/unit/process/creative-studio/studioServer.test.ts
git commit -m "test(creative-studio): prove Studio tools never write project state"
```

---

### Task 6: main-side session descriptor + IPC

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (one added read-oriented method)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (one method + dep)
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts` (one provider + dep wiring)
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts` (one provider binding)
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (service interface entry)
- Test: append to `tests/unit/process/creative-studio/store.test.ts` and the service test file that covers `creativeStudioService` (find it via `grep -rln "acceptProposal" tests/unit/process/creative-studio/`)

- [ ] **Step 1: Failing store test** — `resolveProposalPaths(projectId)` returns the project dir and pending dir, creating `proposals/{pending,decisions,slots}` if missing; unknown project → `not_found`.

- [ ] **Step 2: Implement in `store.ts`** next to the other proposal methods, reusing the existing helpers (do not duplicate path logic):

```typescript
async resolveProposalPaths(projectId: string): Promise<{ projectDir: string; pendingDir: string }> {
  if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
  return enqueue(projectId, async () => {
    const root = await canonicalRoot();
    const project = await projectDirectory(root, projectId, false);
    if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    const directories = await proposalDirectories(root, projectId, true);
    if (directories === null) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal storage is unavailable');
    }
    return { projectDir: project, pendingDir: directories.pending };
  });
},
```

Add the signature to the store's interface block (`store.ts:236` area).

- [ ] **Step 3: Failing service test** — `getBriefSessionServer({projectId})` returns `{ id: 'studio-brief-<projectId>', name: BUILTIN_STUDIO_NAME, transport: { type: 'stdio', command: 'node', args: [<script path>], env: <the three STUDIO_ENV keys> } }`.

- [ ] **Step 4: Implement in `creativeStudioService.ts`** (new dep `getStudioServerScriptPath: () => string`; mirror how other service methods are declared at `creativeStudioTypes.ts:676` area):

```typescript
async getBriefSessionServer(input: StudioProjectRequest): Promise<ISessionMcpServer> {
  const paths = await deps.store.resolveProposalPaths(input.projectId);
  return {
    id: `studio-brief-${input.projectId}`,
    name: BUILTIN_STUDIO_NAME,
    transport: {
      type: 'stdio',
      command: 'node',
      args: [deps.getStudioServerScriptPath()],
      env: {
        [STUDIO_ENV.projectId]: input.projectId,
        [STUDIO_ENV.projectDir]: paths.projectDir,
        [STUDIO_ENV.pendingDir]: paths.pendingDir,
      },
    },
  };
},
```

- [ ] **Step 5: Wire the bridge + ipcBridge.** In `creativeStudioBridge.ts`, pass `getStudioServerScriptPath: () => getBuiltinMcpScriptPath(BUILTIN_STUDIO_SCRIPT)` (import from `@process/utils/initStorage`, mirroring `projectKnowledgeBridge.ts:39`), and register the provider. In `ipcBridge.ts`, next to the other creativeStudio bindings (`:1191` area):

```typescript
getBriefSessionServer: bridge.buildProvider<StudioCommandResult<ISessionMcpServer>, StudioProjectRequest>(
  'creative-studio.get-brief-session-server'
),
```

- [ ] **Step 6: Run both test files + typecheck**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/ && bunx tsc --noEmit`
Expected: all pass, tsc clean

- [ ] **Step 7: Commit**

```bash
git add -A packages/desktop/src tests/unit/process/creative-studio
git commit -m "feat(creative-studio): expose the Brief session-server descriptor over IPC"
```

---

### Task 7: hide Brief conversations from the general sidebar

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/context/ConversationHistoryContext.tsx`
- Test: the dom test file covering that context (find via `grep -rln "ConversationHistoryContext" tests/unit/`; create `tests/unit/renderer/hooks/ConversationHistoryContext.dom.test.tsx` if none)

- [ ] **Step 1: Failing test** — a conversation whose `extra.studio_project_id` is set does not appear in the exposed list; an ordinary conversation does.

- [ ] **Step 2: Implement** — at the single point where the context ingests the fetched list, filter:

```typescript
const visibleConversations = conversations.filter(
  (conversation) => !(conversation.extra as { studio_project_id?: string } | undefined)?.studio_project_id
);
```

Keep the filter at ingestion (one place), not per-consumer. Do not touch the team/cron hooks — they operate on their own lists.

- [ ] **Step 3: Run the test + the full context/sidebar suite for the file you touched.** Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add -A packages/desktop/src/renderer tests/unit
git commit -m "feat(creative-studio): keep Brief conversations out of the general chat list"
```

---

### Task 8: Brief conversation creation on first send

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/hooks/useBriefConversation.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/studioBriefConversation.ts` (only if the caller needs an exported helper it lacks)
- Test: `tests/unit/pages/studio/BriefConversation.dom.test.tsx`

The hook owns the state machine BriefPhase renders: `absent → creating → ready(conversation) | dangling`.

- [ ] **Step 1: Failing tests** (mock `ipcBridge` the way `StudioPage.dom.test.tsx` does — copy its mock scaffolding):

```typescript
// 1. 'creates the curated conversation on first send, binds it, and sends the first message'
//    - project.briefConversationId === null
//    - call hook.sendFirstMessage('Make me a coffee teaser')
//    - assert order: getBriefSessionServer → conversation.create (via createStudioBriefConversation)
//      → creativeStudio.bindBriefConversation → conversation.sendMessage
//    - assert the created conversation's extra.selected_session_mcp_servers === [descriptor]
//      and extra.studio_project_id === project.id
// 2. 'asserts the persisted snapshot: exact allow-list AND each auto-attach id absent'
//    - feed a mock create response whose snapshot contains the six auto-attach ids
//    - expect sendFirstMessage to reject (createStudioBriefConversation's drift guard throws)
//    - the six ids asserted ABSENT individually: builtin-image-gen, builtin-idp, builtin-vision,
//      builtin-chrome-devtools, builtin-memory, builtin-tavily
//    - AND the image-gen client boundary (parent spec §8: a snapshot assertion alone is not enough):
//      every persisted session server transport's args must reference builtin-mcp-studio.js only —
//      assert none contains 'builtin-mcp-image-gen.js', 'builtin-mcp-idp.js', or 'builtin-mcp-vision.js'
//      (use the isBuiltinImageGenTransport helper from builtinMcp/constants.ts for the image-gen check)
// 3. 'opening Brief without sending creates nothing' — render, wait, assert zero create calls
// 4. 'a dangling briefConversationId yields the dangling state with a recreate affordance'
//    - project.briefConversationId set, but the conversation is absent from the history list
//    - hook state === 'dangling'; recreate() clears local state so the next send re-creates+rebinds
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL — hook not found.

- [ ] **Step 3: Implement the hook**

```typescript
export type BriefConversationState =
  | { kind: 'absent' }
  | { kind: 'creating' }
  | { kind: 'ready'; conversation: TChatConversation }
  | { kind: 'dangling'; conversationId: string };

// sendFirstMessage(text):
//   1. const descriptorResult = await ipcBridge.creativeStudio.getBriefSessionServer.invoke({ projectId });
//      (result.ok === false → surface result.error.messageKey and stay 'absent')
//   2. const conversation = await createStudioBriefConversation({
//        studioProjectId: projectId,
//        mcpServerAllowlist: [descriptor.id],
//        availableMcpServers: [{ ...descriptor, builtin: true, enabled: true } as IMcpServer],
//        ...conversationDefaults,   // name: project name; platform/model assembled the same way
//      });                          // useGuidSend.ts:793 assembles them for ordinary chats — copy that
//   3. await ipcBridge.creativeStudio.bindBriefConversation.invoke({ projectId, expectedRevision, conversationId: conversation.id });
//   4. await ipcBridge.conversation.sendMessage.invoke({ ... });  // exact payload per AionrsSendBox.tsx:928
//   5. setState({ kind: 'ready', conversation });
// Dangling detection: when project.briefConversationId is set, look the conversation up in
// ConversationHistoryContext (Task 7's provider still HOLDS studio conversations if you filter
// only the exposed list — expose a lookup that sees them, or fetch by id if a getter exists).
// NOTE: verify at implementation time which lookup is available; the context is the source of truth.
```

**Verification checkpoint (manual, once):** `bindBriefConversation`'s request shape is at `creativeStudioTypes.ts:513` — confirm whether it takes `expectedRevision` and match it. If binding fails after creation succeeded, surface the error and treat the conversation as dangling — never leave a created-but-unbound conversation silent.

- [ ] **Step 4: Run to verify pass.** Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop/src/renderer/pages/studio tests/unit/pages/studio
git commit -m "feat(creative-studio): create the curated Brief conversation on first send"
```

---

### Task 9: mount the conversation surface in BriefPhase

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/BriefPhase.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/BriefPhase.module.css`
- Test: `tests/unit/pages/studio/BriefConversation.dom.test.tsx` (extend)

- [ ] **Step 1: Failing tests**

```typescript
// 1. 'absent state renders the intent composer and the form controls' — name/duration/aspect stay;
//    the six-row intent TextArea is replaced by the conversation composer (TextArea + send Button).
// 2. 'ready state mounts the conversation surface' — with a ready conversation, AionrsChat's
//    container appears (assert on a stable landmark, e.g. the send box role/testid AionrsChat renders).
// 3. 'dangling state shows the notice and the start-fresh action'.
```

- [ ] **Step 2: Implement.** BriefPhase keeps the form column (name / duration / aspect — the existing `styles.form` fields minus the intent TextArea) and adds a conversation column:

- `absent`: an Arco `Input.TextArea` (prefill hint: the project's existing `brief` text) + primary send Button → `useBriefConversation.sendFirstMessage`.
- `ready`: mount `AionrsChat` directly with the prop mapping `ChatConversation.tsx:255-273` uses — `conversation_id`, `conversation`, `workspace: conversation.extra.workspace`, `session_mode`, `loadedSkills/loadedMcpServers/loadedMcpStatuses` from `conversation.extra`, `session_mcp_servers: conversation.extra.session_mcp_servers`. Omit `ChatLayout` — Brief provides the frame. **If AionrsChat proves to require a ChatLayout-provided context at runtime, wrap the minimal provider it needs rather than pulling in the full layout — and record which one in the commit message.**
- `dangling`: notice + "Start a new conversation" (Arco Button) → `recreate()`.
- The existing **Draft storyboard** flow is Write's; Brief adds nothing here, and the form's save/validation/footer behaviour must not regress (`StudioPage.dom.test.tsx` guards it).

- [ ] **Step 3: Run the new tests + the existing Brief coverage**

Run: `bunx vitest run --project dom tests/unit/pages/studio/BriefConversation.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx`
Expected: all pass (BUG-025 policy applies to the known flaky test only in full-suite position)

- [ ] **Step 4: Dev smoke (required before commit).** Launch the dev app, open a Studio project's Brief, send a message, and confirm: conversation created once, reply streams, `~/Library/Application Support/Forge-Dev/config/creative-studio/<projectId>/proposals/` exists after asking for a script. This is the one integration seam a dom test cannot prove.

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop/src/renderer/pages/studio tests/unit/pages/studio
git commit -m "feat(creative-studio): mount the Brief conversation surface"
```

---

### Task 10: proposal cards with accept and reject

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/BriefProposalCard.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/BriefPhase.tsx` (render the pending list)
- Modify: the controller plumbing so BriefPhase receives `proposals` + accept/reject callbacks (follow how `controller.project` flows from `useStudioProject` through `StudioPage.tsx` into `BriefPhaseController` — `PhaseShell/types.ts`)
- Test: `tests/unit/pages/studio/BriefProposalCard.dom.test.tsx`

- [ ] **Step 1: Failing tests**

```typescript
// 1. 'renders the change summary against the current script' — proposal adding scene_2 and
//    editing scene_1's narration vs a 1-scene project → card shows "1 added · 0 removed · 1 changed"
//    and lists scene titles. (Summary = compare payload.sceneOrder/scenes with project.scenes:
//    added = in payload not in project; removed = in project not in payload; changed = same id,
//    any editable field differs.)
// 2. 'accept invokes acceptProposal and announces success' — mock ok:true; assert invoke payload
//    { projectId, proposalId } and a polite live-region update.
// 3. 'stale accept fails closed and offers re-propose' — mock { ok:false, error:{ code:'stale_project',
//    messageKey:'conversation.creativeStudio.errors.staleProject' } } → card shows the stale message
//    and a re-propose button; project UNCHANGED (no refetch mutation assertions beyond the error path).
// 4. 'reject invokes rejectProposal' and the card reflects the rejected state.
// 5. 'accept with unsaved drafts flushes first; a failed flush refuses and leaves the proposal pending'
//    — hasUnsavedSceneDrafts true + flushAllSceneDrafts resolving { ok:false } → acceptProposal NOT
//    invoked, refusal message shown. THIS TEST MUST FAIL if someone wires accept without the guard.
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL — component not found.

- [ ] **Step 3: Implement.** Card contents: created-at, base-revision line, the diff summary, Accept (primary) / Reject (secondary) Arco Buttons, statuses for `pending/accepted/rejected/expired`. Accept handler order:

```typescript
if (editor.hasUnsavedSceneDrafts) {
  const flushed = await editor.flushAllSceneDrafts();
  if (!flushed.ok) { setRefusal('conversation.creativeStudio.brief.proposalFlushRefused'); return; }
}
const result = await ipcBridge.creativeStudio.acceptProposal.invoke({ projectId, proposalId });
if (result.ok === false) {
  if (result.error.code === 'stale_project') setStale(true); // shows re-propose affordance
  else setErrorKey(result.error.messageKey);
  return;
}
// success: proposalUpdated + projectUpdated refresh the hook state; announce politely.
```

Re-propose = send a prefilled turn into the Brief conversation via the same `conversation.sendMessage` invoke Task 8 uses: *"The script changed since your last proposal (it is now at a newer revision). Call read_storyboard and redraft your proposal against the current script."*

Check `flushAllSceneDrafts`'s actual `SceneDraftFlushResult` shape (`useStoryboardEditor.ts:95`) and match it — do not assume `{ok}` blindly.

- [ ] **Step 4: Run to verify pass.** Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop/src/renderer/pages/studio tests/unit/pages/studio
git commit -m "feat(creative-studio): review Brief proposals with fail-closed acceptance"
```

---

### Task 11: fence the one-shot draft-loss defect

Parent spec §7's requirement: the retained **Draft storyboard** path must stop clearing unsaved drafts without flushing.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/useStoryboardEditor.ts` (the `proposeStoryboard` callback, ~`:1543`)
- Test: `tests/unit/pages/studio/` — extend the file that already proves the discard (`useStoryboardEditor.dom.test.ts:2279`)

- [ ] **Step 1: Write the failing test** — seed an unsaved scene draft, run `proposeStoryboard(true)`, assert the typed content SURVIVES into the drafted result (or the operation refuses) instead of being cleared. Model it as the inverse of the existing discard test — same setup, opposite assertion.

- [ ] **Step 2: Run to verify it fails on current behaviour.** Expected: FAIL (drafts are cleared today — that is the bug).

- [ ] **Step 3: Implement** — at the top of `proposeStoryboard`, before `runDraftIntent`:

```typescript
if (dirtySceneIdsRef.current.size > 0) {
  const flushed = await flushAllSceneDrafts();
  if (!flushed.ok) return false; // refuse: never silently drop typed content
}
```

(Adapt the `.ok` check to the real `SceneDraftFlushResult` shape.) Update the OLD discard test to assert the new contract, with a comment naming this plan + parent spec §7 as the reason the assertion flipped — an unexplained flipped assertion reads as a test bent to pass.

- [ ] **Step 4: Run the full editor suite**

Run: `bunx vitest run --project dom tests/unit/pages/studio/`
Expected: all pass, including the flipped test

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop/src/renderer/pages/studio tests/unit/pages/studio
git commit -m "fix(creative-studio): flush scene drafts before storyboard drafting can replace them"
```

---

### Task 12: i18n for every new string

**Files:**
- Modify: the locale JSON for all 12 languages + regenerate types (the `i18n` skill names the exact files and module registration)

- [ ] **Step 1: Load the project i18n skill** (`.claude/skills/i18n/SKILL.md`) and follow its workflow for these keys (en-US values shown; translate the rest properly):

```text
conversation.creativeStudio.brief.composerPlaceholder   = "Describe the video you want…"
conversation.creativeStudio.brief.composerSend          = "Send"
conversation.creativeStudio.brief.conversationTitle     = "Brief conversation"
conversation.creativeStudio.brief.danglingNotice        = "This project's brief conversation is no longer available."
conversation.creativeStudio.brief.danglingStartFresh    = "Start a new conversation"
conversation.creativeStudio.brief.proposalTitle         = "Proposed script"
conversation.creativeStudio.brief.proposalSummary       = "{{added}} added · {{removed}} removed · {{changed}} changed"
conversation.creativeStudio.brief.proposalAccept        = "Accept script"
conversation.creativeStudio.brief.proposalReject        = "Reject"
conversation.creativeStudio.brief.proposalAccepted      = "Script applied"
conversation.creativeStudio.brief.proposalRejected      = "Rejected"
conversation.creativeStudio.brief.proposalStale         = "The script changed while this proposal was waiting. Ask for a redraft."
conversation.creativeStudio.brief.proposalRepropose     = "Ask for a redraft"
conversation.creativeStudio.brief.proposalFlushRefused  = "Your unsaved edits could not be saved, so the proposal was not applied. Fix the edits and try again."
```

`proposalSummary` carries three counts — if any locale renders it with plural-sensitive words, follow the skill's CLDR plural guidance (ru/uk at counts 1/2/5 must be tested).

- [ ] **Step 2: Regenerate and validate**

Run: `bun run i18n:types && node scripts/check-i18n.js`
Expected: both clean

- [ ] **Step 3: Run the dom suites again** (key references compile through `i18n-keys.d.ts`)

Run: `bunx tsc --noEmit && bunx vitest run --project dom tests/unit/pages/studio/`
Expected: clean, all pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(creative-studio): localize the Brief conversation surface"
```

---

### Task 13: full gates + live acceptance

- [ ] **Step 1: Full quality gates in a quiet window** (load < 8, no competing vitest):

```bash
bunx tsc --noEmit && bun run lint:fix && bun run format && bun run test
```

Expected: green. BUG-025 policy applies if exactly the known test fails in full-suite position.

- [ ] **Step 2: Live acceptance in the dev app** (mirrors the design's §6):
  1. Fresh Studio project → Brief → send "A 10-second teaser for a mountain coffee brand".
  2. Assistant asks/answers in prose; ask it to draft the script.
  3. A proposal card appears **without any manual refresh** (watcher → `proposalUpdated`).
  4. Restart the app → the card is still there (durable record).
  5. Type into a Write scene field, come back to Brief, accept → typed content survives (flush) and the script applies.
  6. Edit the project elsewhere to bump the revision, then accept an old proposal → fails closed with the stale message; re-propose sends the prefilled turn.
  7. Sidebar shows no Brief conversation; the six auto-attach servers are absent from the conversation's persisted snapshot (inspect the conversation record).
  8. Delete the conversation record (simulate dangling) → Brief shows the notice and recovers via Start fresh.
  9. If a tool-incapable model is configured for chat: the conversation still streams prose, no error state appears, and the Write phase's Draft storyboard button still works (design §2.3's degrade path). Skip with a note if no such model is available.

- [ ] **Step 3: Record the acceptance evidence** in the working notes (screens/paths/ids), then push:

```bash
just push -u origin codex/studio-slice-a
```

Expected: every gate green; verify the push by ref equality, not exit code.

---

## Explicitly out of scope (do not drift into it)

Slice P (`outputRole`, reference pool, SceneInspector affordances); the chip question card; any second proposal payload kind; allow-list widening (KB search etc.); the Write assistant surface; orphan-conversation reaping; any change to `GenerationReviewModal` or the job pipeline.

## Risk register (ordered)

1. **AionrsChat standalone mount** (Task 9) — the one seam a unit test can't prove; hence the mandatory dev smoke before its commit. Fallback is wrapping the minimal missing provider, not adopting ChatLayout.
2. **Conversation-creation params** (Task 8) — assemble platform/model exactly as `useGuidSend.ts:793` does; a wrong `platform` value produces a conversation the Studio surface can't drive.
3. **Store contract drift** — covered by Task 3's conformance test; if it ever reds, fix the writer, never loosen the store.
4. **`SceneDraftFlushResult` shape** (Tasks 10/11) — check `useStoryboardEditor.ts:95` before wiring the guards.
